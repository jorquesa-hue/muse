/* Muse — organizer submission form (cadastrar.html). Validates in the page, then POST /api/submit. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let CITIES = null, picked = null;

  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date(); const max = new Date(); max.setDate(max.getDate() + 183);
  ['start', 'end'].forEach((id) => { $(id).min = ymd(today); $(id).max = ymd(max); });

  $('desc').addEventListener('input', () => { $('descN').textContent = $('desc').value.length; });
  $('price').addEventListener('change', () => { $('priceTextWrap').hidden = $('price').value !== 'paid'; });

  /* city autocomplete over the 5,570 municipalities (same file the app uses) */
  async function cities() {
    if (CITIES) return CITIES;
    const j = await (await fetch('cities.json')).json();
    CITIES = j.c.map(([n, uf, , , cap]) => ({ n, uf, cap, f: fold(n) }));
    return CITIES;
  }
  function showAC(items) {
    const ac = $('ac');
    if (!items.length) { ac.innerHTML = '<button type="button" disabled>Nenhuma cidade encontrada</button>'; ac.hidden = false; return; }
    ac.innerHTML = items.map((c, i) => `<button type="button" data-i="${i}"><span>${esc(c.n)}</span><span class="uf">${esc(c.uf)}</span></button>`).join('');
    ac.hidden = false; ac._items = items;
  }
  $('city').addEventListener('input', async () => {
    picked = null; $('city').classList.remove('bad');
    const q = fold($('city').value); if (q.length < 2) { $('ac').hidden = true; return; }
    const cs = await cities();
    const starts = [], inner = [];
    for (const c of cs) { if (c.f.startsWith(q)) starts.push(c); else if (c.f.includes(' ' + q)) inner.push(c); }
    const rank = (a, b) => b.cap - a.cap || a.n.length - b.n.length;
    showAC(starts.sort(rank).concat(inner.sort(rank)).slice(0, 8));
  });
  $('ac').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-i]'); if (!b) return;
    picked = $('ac')._items[+b.dataset.i]; $('city').value = `${picked.n} / ${picked.uf}`; $('ac').hidden = true;
    $('cityHint').textContent = 'Cidade escolhida ✓';
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.city')) $('ac').hidden = true; });

  const FIELD_MSG = {
    title: 'Confira o nome do evento.', cat: 'Escolha uma categoria.', dates: 'Confira as datas: o evento precisa acontecer nos próximos 6 meses e o fim não pode ser antes do início.',
    city: 'Escolha a cidade na lista.', url: 'Confira o link: ele precisa começar com https://', url_down: 'Não conseguimos abrir o link. Confira se ele está certo e público.',
    desc: 'Escreva uma descrição com pelo menos 20 caracteres.', name: 'Informe seu nome ou o da organização.', email: 'Confira o e-mail.',
    adults: 'O Muse é só para eventos abertos a famílias (nada +18).', form: 'Algo deu errado com o formulário. Tente de novo.',
  };
  const FIELD_EL = { title: 'title', cat: 'cat', dates: 'start', city: 'city', url: 'url', url_down: 'url', desc: 'desc', name: 'name', email: 'email' };
  function say(kind, text) { $('msg').innerHTML = `<div class="msg ${kind}">${esc(text)}</div>`; $('msg').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  function bad(field) {
    document.querySelectorAll('.bad').forEach((x) => x.classList.remove('bad'));
    const el = FIELD_EL[field] && $(FIELD_EL[field]); if (el) el.classList.add('bad');
    say('err', FIELD_MSG[field] || FIELD_MSG.form);
  }

  $('f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = (id) => $(id).value.trim();
    if (v('title').length < 3) return bad('title');
    if (!v('cat')) return bad('cat');
    if (!v('start') || (v('end') && v('end') < v('start'))) return bad('dates');
    if (v('desc').length < 20) return bad('desc');
    if (!v('venue')) { $('venue').classList.add('bad'); return say('err', 'Informe o local do evento.'); }
    if (!picked) return bad('city');
    if (!/^https?:\/\/\S+\.\S+/.test(v('url'))) return bad('url');
    if (v('name').length < 2) return bad('name');
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v('email'))) return bad('email');
    if (!$('terms').checked) return say('err', 'Marque a confirmação no fim do formulário.');

    const btn = $('send'); btn.disabled = true; btn.textContent = 'Enviando…';
    let res = null;
    try {
      const r = await fetch('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        event: { title: v('title'), cat: v('cat'), start: v('start'), end: v('end') || v('start'), time: v('time') || null, venue: v('venue'),
          city: picked.n, uf: picked.uf, price: v('price'), priceText: v('price') === 'paid' ? v('priceText') : 'Gratuito',
          kids: $('kids').checked, url: v('url'), desc: v('desc') },
        contact: { name: v('name'), email: v('email'), phone: v('phone') }, website: $('website').value,
      }) });
      res = await r.json().catch(() => null);
    } catch (e) { res = null; }
    btn.disabled = false; btn.textContent = 'Enviar cadastro';
    const st = res && res.status;
    if (st === 'ok') {
      $('f').hidden = true;
      say('ok', `Quase lá! Enviamos um link para ${v('email')}. Abra o e-mail e confirme o cadastro (veja também a caixa de spam). Depois de uma revisão rápida, o evento aparece no Muse.`);
    } else if (st === 'bad') bad(res.field);
    else if (st === 'limited') say('err', 'Muitos cadastros seguidos deste aparelho ou e-mail. Tente de novo amanhã.');
    else if (st === 'mail_off' || st === 'off') say('err', 'O cadastro de eventos ainda está sendo ativado. Tente de novo em breve.');
    else say('err', 'Não conseguimos enviar agora. Verifique sua conexão e tente de novo.');
  });
})();
