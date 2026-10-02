import { addItem, cents, escapeHTML, money, restoreCart, unitPrice, validOptions } from './cart.js';

const STORAGE_KEY = 'kuro-sushi-cart-v1';
const TABLE_KEY = 'kuro-sushi-table-v1';
const MODE_KEY = 'kuro-sushi-dining-mode-v1';
const GUESTS_KEY = 'kuro-sushi-guests-v1';
const descriptions = {
  combos: 'Para dividir. Ou não.',
  entradas: 'Enquanto o sushi não chega.',
  quentes: 'Da chapa e do fogo direto para a mesa.',
  temakis: 'Uma mão só. Um pedido inteiro.',
  'hot-rolls': 'Crocante. Quente. Acaba rápido.',
  sashimis: 'Salmão, corte e nada para esconder.',
  sushis: 'Arroz no ponto e peixe bem cortado.',
  makis: 'Clássicos enrolados para todos os gostos.',
  sobremesas: 'Um final doce para fechar a experiência.',
  bebidas: 'Entre uma peça e outra.',
};

// Imagens locais por família: representam melhor os pratos e não dependem
// de links externos que podem mudar ou deixar de funcionar.
const categoryImages = {
  quentes: './assets/menu/hot-dishes.jpg',
  temakis: './assets/menu/temaki-assortment.jpg',
  'hot-rolls': './assets/menu/hot-rolls.jpg',
  sashimis: './assets/menu/sashimi-assortment.jpg',
  sushis: './assets/menu/nigiri-assortment.jpg',
  makis: './assets/menu/maki-assortment.jpg',
  sobremesas: './assets/menu/desserts.jpg',
};

const productImages = {
  sunomono: './assets/menu/cold-starters.jpg',
  edamame: './assets/menu/cold-starters.jpg',
  gyoza: './assets/menu/fried-appetizers.jpg',
  'harumaki-cheese': './assets/menu/fried-appetizers.jpg',
  'squid-dore': './assets/menu/fried-appetizers.jpg',
  'breaded-shrimp': './assets/menu/fried-appetizers.jpg',
  shimeji: './assets/menu/mushrooms.jpg',
  'shiitake-butter': './assets/menu/mushrooms.jpg',
  missoshiru: './assets/menu/miso-soup.jpg',
  'green-tea': './assets/menu/japanese-drinks.jpg',
  'lychee-juice': './assets/menu/japanese-drinks.jpg',
};

function productImage(product) {
  return productImages[product.id] || categoryImages[product.category] || product.image;
}
const checkout = document.getElementById('checkout-form');
let catalog, config, categoryId, selectedProduct;
let cart = [];
let search = '';
let quantity = 1;
let toastTimer;
let lastFocus;
let storageWarning = false;
let tableNumber = '';
let diningMode = 'a-la-carte';
let guests = 1;
let currentBill = null;

function toast(message) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 3200);
}

function saveCart() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  } catch {
    if (!storageWarning) {
      toast('Se sair da página, seu pedido não fica salvo.');
      storageWarning = true;
    }
  }
}

function setTable(value) {
  tableNumber = String(value || '').replace(/\D/g, '').slice(0, 4);
  if (tableNumber) localStorage.setItem(TABLE_KEY, tableNumber);
  document.querySelectorAll('#table-number, .current-table').forEach(element => { element.textContent = tableNumber || '—'; });
  document.getElementById('table-input').value = tableNumber;
  document.getElementById('service-actions').hidden = !tableNumber;
}

function isRodizioIncluded(product) {
  return diningMode === 'rodizio' && config?.rodizio?.enabled && config.rodizio.includedCategories.includes(product.category);
}

function restaurantUnitPrice(item) {
  const product = catalog.products.find(product => product.id === item.productId);
  if (!isRodizioIncluded(product)) return unitPrice(item, catalog);
  return item.optionIds.reduce((sum, id) => sum + cents(catalog.options.find(option => option.id === id)?.price || 0), 0);
}

function restaurantSummary() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const extras = cart.reduce((sum, item) => sum + restaurantUnitPrice(item) * item.quantity, 0);
  const cover = diningMode === 'rodizio' ? cents(config.rodizio.pricePerPerson) * guests : 0;
  return { count, extras, cover, total: extras + cover };
}

function setDiningExperience(mode, guestCount = 1) {
  diningMode = mode === 'rodizio' && config?.rodizio?.enabled ? 'rodizio' : 'a-la-carte';
  guests = Math.max(1, Math.min(30, Number(guestCount) || 1));
  localStorage.setItem(MODE_KEY, diningMode);
  localStorage.setItem(GUESTS_KEY, String(guests));
  document.querySelectorAll('input[name="diningMode"]').forEach(input => { input.checked = input.value === diningMode; });
  document.getElementById('guest-count').value = guests;
  document.getElementById('guest-field').hidden = diningMode !== 'rodizio';
  document.getElementById('dining-mode-label').textContent = diningMode === 'rodizio' ? `Rodízio · ${guests} ${guests === 1 ? 'pessoa' : 'pessoas'}` : 'À la carte';
  document.getElementById('customer-field').hidden = diningMode === 'rodizio';
  document.getElementById('payment-field').hidden = diningMode === 'rodizio';
  document.getElementById('kitchen-note-field').classList.toggle('rodizio-note', diningMode === 'rodizio');
  if (catalog) { renderProducts(); updateCartBadge(); }
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível falar com a equipe.');
  return data;
}

const eventLabels = { order: 'Pedido enviado', waiter: 'Garçom solicitado', bill: 'Conta solicitada' };
const statusLabels = { new: 'Recebido', accepted: 'Em atendimento', preparing: 'Na cozinha', ready: 'Pronto', done: 'Concluído' };

async function renderActivity() {
  const list = document.getElementById('activity-list');
  if (!tableNumber) { list.innerHTML = '<p class="muted">Identifique sua mesa para acompanhar os pedidos.</p>'; return; }
  list.innerHTML = '<p class="muted">Atualizando…</p>';
  try {
    const { events } = await api(`./api/restaurant/events?table=${encodeURIComponent(tableNumber)}`);
    list.innerHTML = events.length ? events.slice(0, 6).map(item => `<article class="activity-item"><strong>${escapeHTML(eventLabels[item.type] || 'Solicitação')}</strong><span>${new Date(item.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span><span class="activity-status">${escapeHTML(statusLabels[item.status] || item.status)}</span></article>`).join('') : '<p class="muted">Nenhuma solicitação nesta mesa ainda.</p>';
  } catch (error) { list.innerHTML = `<p class="form-error">${escapeHTML(error.message)}</p>`; }
}

function openService() {
  closeBillPreview();
  setTable(tableNumber);
  renderActivity();
  openDialog('#service-dialog');
  if (!tableNumber) setTimeout(() => document.getElementById('table-input').focus(), 0);
}

function closeBillPreview() {
  const preview = document.getElementById('bill-preview');
  if (!preview) return;
  preview.hidden = true;
  document.getElementById('service-actions').hidden = !tableNumber;
}

async function showBillPreview() {
  const preview = document.getElementById('bill-preview');
  const content = document.getElementById('bill-preview-content');
  const confirm = document.getElementById('confirm-bill');
  preview.hidden = false;
  document.getElementById('service-actions').hidden = true;
  content.innerHTML = '<p class="muted">Calculando consumo da mesa…</p>';
  confirm.disabled = true;
  try {
    ({ bill: currentBill } = await api(`./api/restaurant/bill?table=${encodeURIComponent(tableNumber)}`));
    const rows = [
      currentBill.aLaCarte ? ['Pedidos à la carte', currentBill.aLaCarte] : null,
      currentBill.rodizioCover ? ['Rodízio da mesa', currentBill.rodizioCover] : null,
      currentBill.rodizioExtras ? ['Adicionais do rodízio', currentBill.rodizioExtras] : null,
    ].filter(Boolean);
    content.innerHTML = rows.length ? `<div class="bill-consumption"><p>${currentBill.orderCount} ${currentBill.orderCount === 1 ? 'pedido' : 'pedidos'} · ${currentBill.itemCount} ${currentBill.itemCount === 1 ? 'item' : 'itens'}</p>${rows.map(([label, value]) => `<div><span>${label}</span><strong>${money(value)}</strong></div>`).join('')}<div class="bill-total"><span>Total da mesa</span><strong>${money(currentBill.total)}</strong></div></div>` : '<div class="bill-empty"><strong>Nenhum consumo em aberto.</strong><p>Se algo estiver faltando, chame o garçom para conferir.</p></div>';
    confirm.disabled = currentBill.total <= 0;
  } catch (error) { content.innerHTML = `<p class="form-error">${escapeHTML(error.message)}</p>`; }
}

function normalizeText(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function imageFallback(event) {
  if (event.target.tagName === 'IMG' && !event.target.classList.contains('image-fallback')) {
    event.target.classList.add('image-fallback');
    event.target.src = './assets/fallback.svg';
  }
}
document.addEventListener('error', imageFallback, true);
document.querySelectorAll('img').forEach(img => { if (img.complete && !img.naturalWidth) imageFallback({ target: img }); });

function openDialog(id) {
  lastFocus = document.activeElement;
  document.querySelector(id).showModal();
  document.body.style.overflow = 'hidden';
}

document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('close', () => { document.body.style.overflow = ''; lastFocus?.focus(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
});
document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]');
  if (close) document.getElementById(close.dataset.close).close();
});


function renderProducts() {
  const category = catalog.categories.find(category => category.id === categoryId);
  const term = normalizeText(search);
  const products = catalog.products.filter(product => term
    ? normalizeText(`${product.name} ${product.description}`).includes(term)
    : product.category === categoryId);
  document.getElementById('category-title').textContent = search ? 'Sua busca' : category.name;
  document.getElementById('category-description').textContent = search ? `Tudo que tem “${search}” por aqui.` : descriptions[categoryId] || 'Escolha seus favoritos.';
  document.getElementById('product-count').textContent = `${products.length} ${products.length === 1 ? 'opção' : 'opções'}`;
  document.getElementById('products').innerHTML = products.length ? products.map((product, index) => `<button class="product-card ${product.featured && !search ? 'product-featured' : ''}" data-product="${escapeHTML(product.id)}" aria-label="Personalizar ${escapeHTML(product.name)}, ${money(cents(product.price))}">
    <div class="product-image"><img src="${escapeHTML(productImage(product))}" alt="Foto ilustrativa de ${escapeHTML(product.name)}" loading="lazy" decoding="async"><span class="pieces">${escapeHTML(product.pieces)}</span></div>
    <div class="product-body">
      <div class="product-kicker">
        <span class="dish-number">/${String(index + 1).padStart(2, '0')}</span>
        ${product.badge ? `<span class="product-badge">${escapeHTML(product.badge)}</span>` : ''}
      </div>
      <h4>${escapeHTML(product.name)}</h4>
      <p>${escapeHTML(product.description)}</p>
      ${product.serves ? `<span class="serves">${escapeHTML(product.serves)}</span>` : ''}
      <div class="product-meta">
        <span class="product-price">${isRodizioIncluded(product) ? '<span class="included-price">Incluso no rodízio</span>' : `<small>R$</small> ${money(cents(product.price)).replace(/^R\$\s*/, '')}`}</span>
        <span class="add-icon"><span>Escolher</span><span aria-hidden="true">+</span></span>
      </div>
    </div>
  </button>`).join('') : '<div class="empty-state"><span aria-hidden="true">⌕</span><h3>Nada com esse nome por aqui.</h3><p>Tenta salmão, combo ou temaki.</p><button id="clear-search" class="secondary">Ver cardápio</button></div>';
}

function openProduct(productId) {
  const product = catalog.products.find(product => product.id === productId);
  if (!product) return;
  selectedProduct = product;
  quantity = 1;
  const options = catalog.options.filter(option => product.options.includes(option.id));
  document.getElementById('product-modal-content').innerHTML = `
    <div class="modal-image">
      <img src="${escapeHTML(productImage(product))}" alt="Foto ilustrativa de ${escapeHTML(product.name)}">
      <button class="icon-button" data-close="product-dialog" aria-label="Fechar personalização">×</button>
    </div>
    <form id="product-form" class="modal-body">
      <div class="eyebrow">DO SEU JEITO</div>
      <h2 id="product-modal-title">${escapeHTML(product.name)}</h2>
      <p class="modal-description">${escapeHTML(product.description)}</p>
      <div class="modal-meta">
        <strong>${isRodizioIncluded(product) ? 'Incluso no rodízio' : money(cents(product.price))}</strong>
        <span>· ${escapeHTML(product.pieces)}</span>
        ${product.serves ? `<span>· ${escapeHTML(product.serves)}</span>` : ''}
      </div>
      ${options.length ? `<fieldset class="option-fieldset">
        <legend>Quer mudar algo? <small>(opcional)</small></legend>
        ${options.map(option => `<label class="option-row">
          <input type="checkbox" name="option" value="${escapeHTML(option.id)}">
          <span>${escapeHTML(option.name)}</span>
          <span>${option.price ? `+ ${money(cents(option.price))}` : 'Sem custo'}</span>
        </label>`).join('')}
      </fieldset>` : ''}
      <label class="notes-label" for="product-notes">Recado pra cozinha <small>(opcional)</small></label>
      <textarea id="product-notes" maxlength="200" rows="2" placeholder="Ex.: sem wasabi"></textarea>
      <div class="modal-footer">
        <div class="quantity-control">
          <button type="button" id="product-minus" aria-label="Diminuir quantidade" disabled>−</button>
          <output id="product-quantity" aria-live="polite">1</output>
          <button type="button" id="product-plus" aria-label="Aumentar quantidade">+</button>
        </div>
        <button type="submit" class="primary">Adicionar <span id="product-total">${money(cents(product.price))}</span></button>
      </div>
    </form>`;
  document.getElementById('product-form').addEventListener('change', event => {
    if (event.target.name !== 'option') return;
    const checked = event.target;
    if (checked.checked) {
      const option = catalog.options.find(option => option.id === checked.value);
      for (const input of document.querySelectorAll('#product-form input[name=option]')) {
        const other = catalog.options.find(option => option.id === input.value);
        if (input !== checked && (option.conflictsWith?.includes(input.value) || other.conflictsWith?.includes(option.id))) input.checked = false;
      }
    }
    updateProductTotal();
  });
  document.getElementById('product-minus').addEventListener('click', () => { quantity = Math.max(1, quantity - 1); updateProductTotal(); });
  document.getElementById('product-plus').addEventListener('click', () => { quantity = Math.min(99, quantity + 1); updateProductTotal(); });
  document.getElementById('product-form').addEventListener('submit', event => {
    event.preventDefault();
    cart = addItem(cart, { productId: product.id, quantity: quantity, optionIds: selectedOptions(), notes: document.getElementById('product-notes').value.trim() });
    saveCart(); updateCartBadge();
    document.getElementById('product-dialog').close();
    toast(`${product.name} entrou no pedido.`);
  });
  updateProductTotal();
  openDialog('#product-dialog');
}

function selectedOptions() { return validOptions(selectedProduct, [...document.querySelectorAll('#product-form input[name=option]:checked')].map(input => input.value), catalog.options); }
function updateProductTotal() {
  document.getElementById('product-quantity').value = quantity;
  document.getElementById('product-minus').disabled = quantity === 1;
  document.getElementById('product-plus').disabled = quantity === 99;
  const value = restaurantUnitPrice({ productId: selectedProduct.id, optionIds: selectedOptions() }) * quantity;
  document.getElementById('product-total').textContent = isRodizioIncluded(selectedProduct) && value === 0 ? 'Incluso' : money(value);
}

function updateCartBadge() {
  const summary = restaurantSummary();
  document.querySelectorAll('.cart-count').forEach(badge => { badge.textContent = summary.count; });
  document.getElementById('floating-total').textContent = diningMode === 'rodizio' && summary.extras === 0 ? 'Incluso' : money(summary.extras);
  document.getElementById('floating-cart').hidden = summary.count === 0;
}

function updateOrderSummary() {
  const summary = restaurantSummary();
  if (diningMode === 'rodizio') {
    document.getElementById('order-summary').innerHTML = `<div class="rodizio-summary-heading"><span>Rodízio ativo</span><strong>${guests} ${guests === 1 ? 'pessoa' : 'pessoas'}</strong></div><div class="summary-row"><span>${summary.count} ${summary.count === 1 ? 'item' : 'itens'} nesta rodada</span><span>Inclusos</span></div><div class="summary-row rodizio-extras"><span>Adicionais e itens fora do rodízio</span><strong>${money(summary.extras)}</strong></div><p class="rodizio-order-help">O valor do rodízio entra uma única vez na conta da mesa. Aqui você envia somente esta rodada para a cozinha.</p>`;
    return;
  }
  document.getElementById('order-summary').innerHTML = `<div class="summary-row"><span>${summary.count} ${summary.count === 1 ? 'item' : 'itens'} para a mesa ${escapeHTML(tableNumber || '—')}</span><span>${money(summary.extras)}</span></div><div class="summary-row total"><span>Total do pedido</span><strong>${money(summary.total)}</strong></div>`;
}

function renderCart() {
  const hasItems = cart.length > 0;
  checkout.hidden = !hasItems;
  document.getElementById('empty-cart').hidden = hasItems;
  document.getElementById('checkout-error').textContent = '';
  document.getElementById('cart-items').innerHTML = cart.map(item => {
    const product = catalog.products.find(product => product.id === item.productId);
    const optionNames = item.optionIds.map(id => catalog.options.find(option => option.id === id)?.name).filter(Boolean);
    const itemValue = restaurantUnitPrice(item) * item.quantity;
    return `<article class="cart-item"><img src="${escapeHTML(productImage(product))}" alt="" loading="lazy"><div class="cart-item-info"><h3>${escapeHTML(product.name)}</h3>${optionNames.length ? `<p>${escapeHTML(optionNames.join(' · '))}</p>` : ''}${item.notes ? `<p>Obs.: ${escapeHTML(item.notes)}</p>` : ''}<strong class="cart-item-price">${isRodizioIncluded(product) && itemValue === 0 ? 'Incluso no rodízio' : money(itemValue)}</strong><div class="cart-item-controls"><div class="quantity-control"><button type="button" data-cart-action="minus" data-item="${escapeHTML(item.id)}" aria-label="Diminuir quantidade de ${escapeHTML(product.name)}">−</button><output aria-label="Quantidade">${item.quantity}</output><button type="button" data-cart-action="plus" data-item="${escapeHTML(item.id)}" aria-label="Aumentar quantidade de ${escapeHTML(product.name)}" ${item.quantity === 99 ? 'disabled' : ''}>+</button></div><button type="button" class="remove-item" data-cart-action="remove" data-item="${escapeHTML(item.id)}" aria-label="Remover ${escapeHTML(product.name)}">Remover</button></div></div></article>`;
  }).join('');
  document.getElementById('checkout-button').disabled = false;
  updateOrderSummary();
}

function restaurantOrder() {
  if (!cart.length) return null;
  if (!tableNumber) { document.getElementById('cart-dialog').close(); openService(); toast('Primeiro, informe o número da mesa.'); return null; }
  const details = Object.fromEntries(new FormData(checkout));
  const summary = restaurantSummary();
  return {
    type: 'order', table: tableNumber, customer: details.customer?.trim() || '', payment: details.payment,
    notes: details.notes?.trim() || '', total: summary.extras, diningMode, guests, coverTotal: summary.cover,
    items: cart.map(item => {
      const product = catalog.products.find(product => product.id === item.productId);
      return { name: product.name, quantity: item.quantity, notes: item.notes, options: item.optionIds.map(id => catalog.options.find(option => option.id === id)?.name).filter(Boolean), unitPrice: restaurantUnitPrice(item), includedInRodizio: isRodizioIncluded(product) };
    })
  };
}

async function init() {
  document.getElementById('year').textContent = new Date().getFullYear();
  try {
    const responses = await Promise.all([fetch('./data/products.json'), fetch('./data/config.json')]);
    if (responses.some(response => !response.ok)) throw new Error('Falha ao carregar dados.');
    [catalog, config] = await Promise.all(responses.map(response => response.json()));
    if (!catalog.categories?.length || !Array.isArray(catalog.products) || !Array.isArray(catalog.options)) throw new Error('Invalid catalog.');
    categoryId = catalog.categories[0].id;
    try { cart = restoreCart(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'), catalog); } catch { cart = []; }
    const tableFromUrl = new URLSearchParams(window.location.search).get('mesa');
    setTable(tableFromUrl || localStorage.getItem(TABLE_KEY) || '');
    document.getElementById('rodizio-option').hidden = !config.rodizio?.enabled;
    if (config.rodizio?.enabled) document.getElementById('rodizio-price').textContent = `${money(cents(config.rodizio.pricePerPerson))} por pessoa`;
    setDiningExperience(localStorage.getItem(MODE_KEY) || 'a-la-carte', localStorage.getItem(GUESTS_KEY) || 1);
    document.getElementById('categories').innerHTML = catalog.categories.map((category, index) => `<button class="category-tab" data-category="${escapeHTML(category.id)}" aria-pressed="${categoryId === category.id}"><span class="category-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>${escapeHTML(category.name)}</button>`).join('');
    renderProducts();
    updateCartBadge();
    document.getElementById('categories').addEventListener('click', event => {
      const tab = event.target.closest('[data-category]');
      if (!tab) return;
      categoryId = tab.dataset.category; search = ''; document.getElementById('search').value = '';
      document.getElementById('categories').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button === tab)));
      renderProducts(); tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    document.getElementById('search').addEventListener('input', event => { search = event.target.value.trim(); renderProducts(); });
    document.getElementById('products').addEventListener('click', event => {
      const product = event.target.closest('[data-product]');
      if (product) openProduct(product.dataset.product);
      if (event.target.closest('#clear-search')) { search = ''; document.getElementById('search').value = ''; renderProducts(); document.getElementById('search').focus(); }
    });
    document.querySelectorAll('.cart-trigger').forEach(button => button.addEventListener('click', () => { renderCart(); openDialog('#cart-dialog'); }));
    document.getElementById('cart-items').addEventListener('click', event => {
      const button = event.target.closest('[data-cart-action]');
      if (!button) return;
      const { item: id, cartAction: action } = button.dataset;
      cart = cart.flatMap(item => {
        if (item.id !== id) return [item];
        if (action === 'remove' || (action === 'minus' && item.quantity === 1)) return [];
        return [{ ...item, quantity: Math.min(99, item.quantity + (action === 'plus' ? 1 : -1)) }];
      });
      saveCart(); updateCartBadge(); renderCart();
      const nextFocus = [...document.getElementById('cart-items').querySelectorAll('[data-cart-action]')].find(element => element.dataset.item === id && element.dataset.cartAction === action);
      (nextFocus || document.querySelector('#cart-dialog [data-close]')).focus();
    });
    checkout.addEventListener('input', event => { if (event.target.setCustomValidity) event.target.setCustomValidity(''); });
    checkout.addEventListener('submit', async event => {
      event.preventDefault();
      const order = restaurantOrder();
      if (!order) return;
      const button = document.getElementById('checkout-button');
      button.disabled = true; button.firstChild.textContent = 'Enviando para a cozinha… ';
      try {
        await api('./api/restaurant/events', { method: 'POST', body: JSON.stringify(order) });
        cart = []; saveCart(); updateCartBadge(); renderCart();
        document.getElementById('cart-dialog').close();
        toast(`Pedido da mesa ${tableNumber} enviado para a cozinha.`);
      } catch (error) { document.getElementById('checkout-error').textContent = error.message; }
      finally { button.disabled = false; button.firstChild.textContent = 'Enviar para a cozinha '; }
    });
    document.getElementById('table-trigger').addEventListener('click', openService);
    document.querySelectorAll('.service-trigger').forEach(button => button.addEventListener('click', openService));
    document.querySelector('[data-view="menu"]').addEventListener('click', () => document.getElementById('menu').scrollIntoView());
    document.getElementById('table-form').addEventListener('change', event => { if (event.target.name === 'diningMode') document.getElementById('guest-field').hidden = event.target.value !== 'rodizio'; });
    document.getElementById('table-form').addEventListener('submit', event => { event.preventDefault(); setTable(event.currentTarget.elements.table.value); setDiningExperience(event.currentTarget.elements.diningMode.value, event.currentTarget.elements.guests.value); renderActivity(); toast(`Mesa ${tableNumber} · ${diningMode === 'rodizio' ? 'Rodízio confirmado' : 'À la carte'}.`); });
    document.getElementById('service-actions').addEventListener('click', async event => {
      const button = event.target.closest('[data-service]');
      if (!button || !tableNumber) return;
      if (button.dataset.service === 'bill') { await showBillPreview(); return; }
      button.disabled = true;
      try { await api('./api/restaurant/events', { method: 'POST', body: JSON.stringify({ type: button.dataset.service, table: tableNumber }) }); toast('Garçom chamado. Já avisamos a equipe.'); await renderActivity(); }
      catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    });
    document.getElementById('close-bill-preview').addEventListener('click', closeBillPreview);
    document.getElementById('cancel-bill').addEventListener('click', closeBillPreview);
    document.getElementById('confirm-bill').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true; button.textContent = 'Solicitando…';
      try { await api('./api/restaurant/events', { method: 'POST', body: JSON.stringify({ type: 'bill', table: tableNumber }) }); closeBillPreview(); toast(`Conta de ${money(currentBill.total)} solicitada para a mesa ${tableNumber}.`); await renderActivity(); }
      catch (error) { toast(error.message); button.disabled = false; }
      finally { button.textContent = 'Confirmar e pedir a conta'; }
    });
    document.getElementById('refresh-activity').addEventListener('click', renderActivity);
  } catch (error) {
    console.error(error);
    document.getElementById('products').innerHTML = '<div class="fatal-error"><h3>O cardápio não abriu por aqui.</h3><p>Dá uma atualizada na página. Se continuar, chama a gente.</p><button class="primary" id="reload">Atualizar cardápio</button></div>';
    document.getElementById('reload').addEventListener('click', () => window.location.reload());
    document.querySelectorAll('.cart-trigger').forEach(button => { button.disabled = true; });
  }
}
init();
