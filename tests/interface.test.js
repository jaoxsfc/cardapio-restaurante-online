import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

test('customer can identify a table, customize food, send an order and request service', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', pretendToBeVisual: true });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.FormData = window.FormData;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  const restaurantEvents = [];
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).includes('/api/restaurant/bill')) {
      const orders = restaurantEvents.filter(event => event.type === 'order');
      const total = orders.reduce((sum, event) => sum + event.total, 0);
      const itemCount = orders.flatMap(event => event.items).reduce((sum, item) => sum + item.quantity, 0);
      return new Response(JSON.stringify({ bill: { table: '12', orderCount: orders.length, itemCount, aLaCarte: total, rodizioCover: 0, rodizioExtras: 0, total } }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (String(path).includes('/api/restaurant/events')) {
      if (options.method === 'POST') {
        const event = { id: String(restaurantEvents.length + 1), status: 'new', createdAt: new Date().toISOString(), ...JSON.parse(options.body) };
        restaurantEvents.push(event);
        return new Response(JSON.stringify({ event }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ events: restaurantEvents }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(await readFile(new URL(`../${path.replace(/^\.\//, '')}`, import.meta.url), 'utf8'));
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  const $ = selector => window.document.querySelector(selector);
  const click = selector => { assert.ok($(selector), selector); $(selector).click(); };
  await import('../src/app.js');
  for (let tries = 0; tries < 100 && !$('.product-card'); tries++) await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(window.document.querySelectorAll('.category-tab').length, 10);
  assert.equal(window.document.querySelectorAll('.product-card').length, 4);
  $('#search').value = 'sashimi';
  $('#search').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.ok($('[data-product="sashimi-salmon"]'), 'search includes other categories');
  click('[data-category="combos"]');
  click('[data-product="combo-kuro"]');
  assert.ok($('#product-dialog').open);
  click('#product-form input[value="tare"]');
  click('#product-plus');
  assert.match($('#product-total').textContent, /185,80/);
  $('#product-notes').value = 'Sem wasabi <script>bad</script>';
  click('#product-form button[type="submit"]');
  assert.equal($('#product-dialog').open, false);
  assert.equal($('.cart-count').textContent, '2');
  assert.equal($('#floating-cart').hidden, false);
  assert.equal(JSON.parse(localStorage.getItem('kuro-sushi-cart-v1'))[0].quantity, 2);

  click('#floating-cart');
  assert.equal($('#checkout-button').disabled, false);
  assert.match($('#order-summary').textContent, /185,80/);
  assert.equal($('#cart-items script'), null, 'instructions are safely escaped');
  $('#checkout-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.ok($('#service-dialog').open, 'table identification opens before sending');
  $('#table-input').value = '12';
  $('#table-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal($('#table-number').textContent, '12');
  assert.equal(localStorage.getItem('kuro-sushi-table-v1'), '12');
  click('#service-dialog [data-close]');

  click('#floating-cart');
  $('#checkout-form').elements.customer.value = 'Ana';
  $('#checkout-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(restaurantEvents[0].type, 'order');
  assert.equal(restaurantEvents[0].table, '12');
  assert.equal(restaurantEvents[0].customer, 'Ana');
  assert.equal(restaurantEvents[0].items[0].quantity, 2);
  assert.equal($('#empty-cart').hidden, false);
  assert.equal($('#floating-cart').hidden, true);

  click('#floating-service');
  assert.equal($('#service-dialog').open, true, 'floating service button opens table assistance');
  click('[data-service="waiter"]');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(restaurantEvents[1].type, 'waiter');
  assert.equal(restaurantEvents[1].table, '12');
  click('[data-service="bill"]');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match($('#bill-preview-content').textContent, /185,80/);
  click('#confirm-bill');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(restaurantEvents[2].type, 'bill');
  click('input[name="diningMode"][value="rodizio"]');
  $('#guest-count').value = '2';
  $('#table-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match($('#dining-mode-label').textContent, /Rodízio/);
  assert.match($('#dining-mode-label').textContent, /2 pessoas/);
  assert.equal($('#customer-field').hidden, true);
  assert.equal($('#payment-field').hidden, true);
  click('#service-dialog [data-close]');

  click('[data-category="hot-rolls"]');
  click('[data-product="hot-philly"]');
  assert.equal($('#product-total').textContent, 'Incluso');
  click('#product-form input[value="no-cream"]');
  click('#product-form input[value="cream"]');
  assert.equal($('#product-form input[value="no-cream"]').checked, false);
  assert.match($('#product-total').textContent, /4,00/);
  click('#product-dialog [data-close]');
  dom.window.close();
});
