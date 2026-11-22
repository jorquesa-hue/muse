/* Muse — owner's approval queue. Open once as admin.html#k=<ADMIN_TOKEN>; the key is then kept on this device. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAT = { music: '🎶 Música', food: '🍲 Gastronomia', festas: '🎉 Festa popular', kids: '🧒 Infantil', outdoor: '🌳 Ao ar livre', fairs: '🛍️ Feira' };
  const ST = { pending: 'Aguardando você', unconfirmed: 'E-mail não confirmado', approved: 'Aprovado', rejected: 'Recusado' };
  const br = (d) => (d ? d.split('-').reverse().join('/') : '');

  const fromHash = new URLSearchParams(location.hash.slice(1)).get('k');
  if (fromHash) { try { localStorage.setItem('muse-admin', fromHash); } catch (e) {} history.replaceState(null, '', location.pathname); }
  let key = fromHash; try { key = key || localStorage.getItem('muse-admin'); } catch (e) {}

  async function api(method, body) {
    const r = await fetch('/api/admin', { method, headers: { 'x-admin-key': key || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r.json().catch(() => ({ status: 'error' }));
  }

  function askKey() {
    $('sub').textContent = 'Cole a chave de administração:';
    $('list').innerHTML = '<input id="k" type="password" autocomplete="off"><button class="yes" id="go" type="button">Entrar</button>';
    $('go').onclick = () => { key = $('k').value.trim(); try { localStorage.setItem('muse-admin', key); } catch (e) {} load(); };
  }

  function card(x) {
    const e = x.event || {};
    const when = e.start === e.end ? br(e.start) : `${br(e.start)} a ${br(e.end)}`;
    return `<div class="card ${esc(x.status)}"><span class="tag ${esc(x.status)}">${esc(ST[x.status] || x.status)}</span>
      <h2>${esc(e.t)}</h2>
      <div class="meta">${esc(CAT[e.cat] || e.cat)} · ${esc(when)}${e.time ? ' · ' + esc(e.time) : ''}</div>
      <div class="meta">📍 ${esc(e.venue || '')} — ${esc(e.city)}/${esc(e.uf)} · ${e.price === 'free' ? 'Gratuito' : esc(e.priceText || 'Pago')}${e.kids === 'yes' ? ' · bom para crianças' : ''}</div>
      <div class="desc">${esc((e.d && e.d.pt) || '')}</div>
      <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.url)}</a>
      ${e.img ? `<img src="${esc(e.img)}" alt="" loading="lazy">` : ''}
      <div class="contact">Enviado por ${esc(x.contact_name)} · ${esc(x.contact_email)}${x.contact_phone ? ' · ' + esc(x.contact_phone) : ''} · ${esc(new Date(x.created_at).toLocaleString('pt-BR'))}</div>
      ${x.status === 'pending' || x.status === 'rejected' || x.status === 'approved' ? `<div class="row">
        ${x.status !== 'approved' ? `<button class="yes" data-id="${x.id}" data-ok="1" type="button">✓ Aprovar e publicar</button>` : ''}
        ${x.status !== 'rejected' ? `<button class="no" data-id="${x.id}" data-ok="0" type="button">${x.status === 'approved' ? 'Tirar do ar' : '✕ Recusar'}</button>` : ''}
      </div>` : ''}</div>`;
  }

  async function load() {
    if (!key) return askKey();
    $('sub').textContent = 'Carregando…';
    const r = await api('GET');
    if (r.status === 'forbidden') { try { localStorage.removeItem('muse-admin'); } catch (e) {} key = null; return askKey(); }
    if (r.status !== 'ok') { $('sub').textContent = 'Não foi possível carregar. Tente de novo.'; return; }
    const items = r.items || [];
    const n = items.filter((x) => x.status === 'pending').length;
    $('sub').textContent = n ? `${n} aguardando sua aprovação` : 'Nada aguardando aprovação 🎉';
    $('list').innerHTML = items.length ? items.map(card).join('') : '<p>Nenhum cadastro ainda.</p>';
  }

  $('list').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-id]'); if (!b) return;
    b.disabled = true; b.textContent = '…';
    const r = await api('POST', { id: +b.dataset.id, approve: b.dataset.ok === '1' });
    if (r.status !== 'approved' && r.status !== 'rejected') alert('Não deu certo. Tente de novo.');
    load();
  });
  load();
})();
