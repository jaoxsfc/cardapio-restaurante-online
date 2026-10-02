import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addItem, cents, escapeHTML, formatOrder, restoreCart, totals, validOptions, whatsappURL } from '../src/cart.js';

const catalog = JSON.parse(await readFile(new URL('../data/products.json', import.meta.url), 'utf8'));
const config = JSON.parse(await readFile(new URL('../data/config.json', import.meta.url), 'utf8'));
const item = { id: 'test-item', productId: 'combo-kuro', quantity: 2, optionIds: ['tare'], notes: 'Sem wasabi' };

test('delivery, modifiers and quantity are charged exactly in integer cents', () => {
  assert.deepEqual(totals([item], catalog, config), { subtotal: 18580, delivery: 700, total: 19280, count: 2 });
  assert.equal(cents(89.9), 8990);
});
test('pickup and an empty cart never incur a delivery charge', () => {
  assert.equal(totals([item], catalog, config, 'pickup').total, 18580);
  assert.equal(totals([], catalog, config).total, 0);
});
test('identical customization merges while different instructions stay separate', () => {
  assert.equal(addItem([item], { ...item, quantity: 1 })[0].quantity, 3);
  assert.equal(addItem([item], { ...item, notes: 'Com wasabi' }).length, 2);
  assert.equal(addItem([{ ...item, quantity: 98 }], { ...item, quantity: 5 })[0].quantity, 99);
});
test('restoration removes stale products and invalid quantities and modifiers', () => {
  const restored = restoreCart([item, null, { ...item, productId: 'removed' }, { ...item, quantity: -1 }, { ...item, quantity: 1000, optionIds: ['cream', 'tare', 'tare', 'invalid'] }], catalog);
  assert.equal(restored.length, 2);
  assert.equal(restored[1].quantity, 99);
  assert.deepEqual(restored[1].optionIds, ['tare']);
  assert.deepEqual(restoreCart({}, catalog), []);
});
test('conflicting customization is resolved when restoring data', () => {
  const hot = catalog.products.find(product => product.id === 'hot-philly');
  assert.deepEqual(validOptions(hot, ['cream', 'no-cream'], catalog.options), ['cream']);
});
test('WhatsApp message contains item totals, instructions and delivery details', () => {
  const message = formatOrder([item], catalog, config, { customer: ' Ana ', fulfillment: 'delivery', address: 'Rua A, 12', payment: 'Pix', notes: 'Campainha 2' });
  assert.match(message, /Nome: Ana/);
  assert.match(message, /2× Combo Kuro/);
  assert.match(message, /Molho tarê extra/);
  assert.match(message, /Sem wasabi/);
  assert.match(message, /TOTAL: R\$\s192,80/);
  assert.match(message, /Endereço: Rua A, 12/);
  assert.match(message, /Campainha 2/);
});
test('pickup message excludes delivery address and shows zero fee', () => {
  const message = formatOrder([item], catalog, config, { customer: 'Ana', fulfillment: 'pickup', address: 'Not used', payment: 'Dinheiro', notes: '' });
  assert.doesNotMatch(message, /Endereço:/);
  assert.match(message, /Retirada no local \(sem taxa\)/);
});
test('WhatsApp requires a configured number and URL preserves all message characters', () => {
  assert.equal(whatsappURL('', 'Pedido'), null);
  assert.equal(whatsappURL('123', 'Pedido'), null);
  const url = new URL(whatsappURL('+55 (11) 99999-9999', 'Salmão & molho\n2×'));
  assert.equal(url.pathname, '/5511999999999');
  assert.equal(url.searchParams.get('text'), 'Salmão & molho\n2×');
});
test('dynamic content escapes markup before rendering', () => {
  assert.equal(escapeHTML('<script>"&\''), '&lt;script&gt;&quot;&amp;&#39;');
});
