/* Muse — an organizer submits an event ("Cadastrar evento", cadastrar.html).  Vercel Node function.
 *
 * POST /api/submit  { event: {title, cat, start, end, time, venue, city, uf, price, priceText, kids, url, desc},
 *                     contact: {name, email, phone}, website (honeypot) }
 * Checks without any AI: known category, real dates within the next 6 months, a municipality that exists
 * (coordinates come from cities.json), a link that opens, no adults-only wording. Stores the submission
 * as "unconfirmed" and e-mails the organizer a confirmation link (api/confirm.mjs); after that it waits
 * for the Muse owner's approval (admin.html). Limits: 5 submissions per network per day, 10 open per e-mail.
 */
import { normalizeCandidate, checkUrl, brToday, addDays } from '../scripts/events.mjs';
import { cities, hash, rpc, json, clientIp, randomToken, sha, sendMail, SITE, esc } from './_lib.mjs';

const HORIZON_DAYS = 183;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

const CAT_PT = { music: 'Música', food: 'Gastronomia', festas: 'Festas populares', kids: 'Infantil', outdoor: 'Ao ar livre', fairs: 'Feiras' };

export async function POST(request) {
  if (!process.env.MUSE_FN_SECRET) return json({ status: 'off' }, 503);
  if (!process.env.RESEND_API_KEY) return json({ status: 'mail_off' }, 503);
  let body; try { body = await request.json(); } catch { return json({ status: 'bad', field: 'form' }, 400); }
  if (body && body.website) return json({ status: 'ok' }); // honeypot: bots fill every field; pretend success
  const e = (body && body.event) || {}, c = (body && body.contact) || {};

  const name = String(c.name || '').trim().slice(0, 120), email = String(c.email || '').trim().slice(0, 200);
  const phone = String(c.phone || '').trim().slice(0, 40);
  if (name.length < 2) return json({ status: 'bad', field: 'name' }, 400);
  if (!EMAIL_RE.test(email)) return json({ status: 'bad', field: 'email' }, 400);

  const today = brToday();
  const raw = {
    title: e.title, cat: e.cat, start: e.start, end: e.end || e.start, time: e.time || null, venue: e.venue,
    city: e.city, uf: String(e.uf || '').toUpperCase(), price: e.price, priceText: e.priceText || null,
    kids: e.kids ? 'yes' : 'unknown', url: e.url, d: { pt: String(e.desc || '').trim().slice(0, 220) },
  };
  if (!raw.d.pt || raw.d.pt.length < 20) return json({ status: 'bad', field: 'desc' }, 400);
  const { idx } = await cities();
  const r = normalizeCandidate(raw, { cities: idx, src: 'organizer', today, until: addDays(today, HORIZON_DAYS) });
  if (!r.ok) {
    const why = r.why || '';
    const field = /city/.test(why) ? 'city' : /url/.test(why) ? 'url' : /cat/.test(why) ? 'cat' : /title/.test(why) ? 'title'
      : /adults/.test(why) ? 'adults' : 'dates';
    return json({ status: 'bad', field }, 400);
  }
  const ev = r.ev;
  const page = await checkUrl(ev.url, 8000);
  if (!page.ok) return json({ status: 'bad', field: 'url_down' }, 400);
  if (page.img) ev.img = page.img;
  ev.org = true; // shown as "Cadastrado pelo organizador"

  const token = randomToken();
  let res;
  try {
    res = await rpc('muse_submit', { p_event: ev, p_name: name, p_email: email, p_phone: phone,
      p_token_hash: sha(token), p_ip: hash('ip:' + clientIp(request)) });
  } catch (err) { console.error(err.message); return json({ status: 'error' }, 502); }
  if (!res || res.status !== 'ok') return json({ status: res ? res.status : 'error' }, res && res.status === 'limited' ? 429 : 502);

  const link = `${SITE}/api/confirm?t=${encodeURIComponent(token)}`;
  const when = ev.start === ev.end ? ev.start.split('-').reverse().join('/') : `${ev.start.split('-').reverse().join('/')} a ${ev.end.split('-').reverse().join('/')}`;
  try {
    await sendMail({
      to: email,
      subject: `Confirme o cadastro: ${ev.t}`,
      text: `Olá, ${name}!\n\nRecebemos o cadastro de "${ev.t}" (${when}, ${ev.city}/${ev.uf}) no Muse.\nPara confirmar, abra este link:\n${link}\n\nDepois da confirmação, o evento passa por uma revisão rápida e aparece no app para as famílias da região.\nSe não foi você, ignore este e-mail.\n\nMuse — passeios em família\n${SITE}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1e1640">
        <h2 style="margin:0 0 12px">Confirme o cadastro no Muse</h2>
        <p>Olá, ${esc(name)}! Recebemos o cadastro de:</p>
        <p style="background:#fff3d6;border-radius:12px;padding:12px 14px"><b>${esc(ev.t)}</b><br>${esc(CAT_PT[ev.cat] || '')} · ${esc(when)} · ${esc(ev.city)}/${esc(ev.uf)}</p>
        <p><a href="${esc(link)}" style="display:inline-block;background:#ff3d7f;color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:12px">Confirmar cadastro</a></p>
        <p style="font-size:14px">Depois da confirmação, o evento passa por uma revisão rápida e aparece no app para as famílias da região.</p>
        <p style="font-size:13px;color:#6a6488">Se não foi você, ignore este e-mail.<br>Muse — passeios em família · <a href="${SITE}">${SITE.replace('https://', '')}</a></p></div>`,
    });
  } catch (err) { console.error('mail', err.message); return json({ status: 'mail_error' }, 502); }
  console.log(`submission ${res.id}: "${ev.t}" ${ev.city}/${ev.uf} ${ev.start}`);
  return json({ status: 'ok' });
}
