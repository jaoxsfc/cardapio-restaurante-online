const board = document.getElementById('team-board');
const labels = { order: 'Pedido da cozinha', waiter: 'Chamado de garçom', bill: 'Solicitação de conta' };
const statusLabels = { new: 'Novo', accepted: 'Em atendimento', preparing: 'Em preparo', ready: 'Pronto para servir', done: 'Concluído' };
let events = [];
let filter = 'open';

function escapeHTML(value = '') { const node = document.createElement('div'); node.textContent = String(value); return node.innerHTML; }
function money(cents) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Falha ao atualizar o painel.');
  return data;
}
function nextActions(event) {
  if (event.status === 'done') return '';
  if (event.type === 'order') {
    if (event.status === 'preparing') return `<button data-status="ready">Marcar como pronto</button>`;
    if (event.status === 'ready') return `<button data-status="done">Pedido entregue</button>`;
  }
  if (event.status === 'new') return `<button data-status="accepted">Assumir atendimento</button>`;
  return `<button data-status="done">Concluir</button>`;
}
function render() {
  const visible = events.filter(event => filter === 'all' || (filter === 'open' ? event.status !== 'done' : event.type === filter));
  document.getElementById('open-count').textContent = events.filter(event => event.status !== 'done').length;
  board.innerHTML = visible.length ? visible.map(event => `<article class="team-card type-${escapeHTML(event.type)}" data-event="${escapeHTML(event.id)}">
    <header><div><span class="team-type">${escapeHTML(labels[event.type] || event.type)}</span><h2>Mesa ${escapeHTML(event.table)}</h2>${event.diningMode === 'rodizio' ? `<span class="rodizio-badge">Rodízio · ${Number(event.guests) || 1} ${Number(event.guests) === 1 ? 'pessoa' : 'pessoas'}</span>` : ''}</div><span class="team-time">${new Date(event.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></header>
    ${event.type === 'order' ? `<div class="team-order-items">${(event.items || []).map(item => `<div><strong>${Number(item.quantity) || 1}× ${escapeHTML(item.name)} ${item.includedInRodizio ? '<span class="item-included">incluso</span>' : ''}</strong>${item.options?.length ? `<small>${escapeHTML(item.options.join(' · '))}</small>` : ''}${item.notes ? `<small>Obs.: ${escapeHTML(item.notes)}</small>` : ''}</div>`).join('')}</div><div class="team-order-meta"><span>${escapeHTML(event.customer || 'Cliente não identificado')}</span><strong>${event.diningMode === 'rodizio' && !event.total ? 'Sem adicionais' : money(event.total)}</strong></div>${event.notes ? `<p class="team-note">Recado: ${escapeHTML(event.notes)}</p>` : ''}` : event.type === 'bill' && event.bill ? `<div class="team-bill"><span>Total conferido pelo cliente</span><strong>${money(event.bill.total)}</strong><small>${event.bill.orderCount} ${event.bill.orderCount === 1 ? 'pedido' : 'pedidos'} · ${event.bill.itemCount} ${event.bill.itemCount === 1 ? 'item' : 'itens'}</small></div>` : '<p class="team-request-copy">A mesa aguarda retorno da equipe.</p>'}
    <footer><span class="status status-${escapeHTML(event.status)}">${escapeHTML(statusLabels[event.status] || event.status)}</span>${nextActions(event)}</footer>
  </article>`).join('') : '<div class="team-empty"><span aria-hidden="true">✓</span><h2>Tudo em dia por aqui.</h2><p>Não há solicitações neste filtro.</p></div>';
}
async function refresh() {
  try { ({ events } = await api('./api/restaurant/events')); render(); }
  catch (error) { board.innerHTML = `<div class="fatal-error"><h3>O painel não atualizou.</h3><p>${escapeHTML(error.message)}</p></div>`; }
}
document.querySelector('.team-filters').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]'); if (!button) return;
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  render();
});
board.addEventListener('click', async event => {
  const button = event.target.closest('[data-status]'); if (!button) return;
  const card = button.closest('[data-event]'); button.disabled = true;
  try { await api(`./api/restaurant/events/${card.dataset.event}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) }); await refresh(); }
  catch (error) { button.disabled = false; button.textContent = error.message; }
});
document.getElementById('team-refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 5000);
