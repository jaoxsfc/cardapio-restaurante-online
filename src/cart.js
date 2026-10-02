const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const cents = value => Math.round(Number(value) * 100);
export const money = value => currency.format(value / 100);
export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function validOptions(product, ids, options) {
  const selected = [...new Set(ids)].filter(id => product.options.includes(id) && options.some(option => option.id === id));
  return selected.filter(id => !options.some(option => selected.includes(option.id) && option.conflictsWith?.includes(id)));
}

export function unitPrice(item, catalog) {
  const product = catalog.products.find(product => product.id === item.productId);
  if (!product) return 0;
  return cents(product.price) + item.optionIds.reduce((total, id) => total + cents(catalog.options.find(option => option.id === id)?.price || 0), 0);
}

export function totals(items, catalog, config, fulfillment = 'delivery') {
  const subtotal = items.reduce((total, item) => total + unitPrice(item, catalog) * item.quantity, 0);
  const delivery = items.length && fulfillment === 'delivery' ? cents(config.deliveryFee) : 0;
  return { subtotal, delivery, total: subtotal + delivery, count: items.reduce((sum, item) => sum + item.quantity, 0) };
}

export function restoreCart(raw, catalog) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const product = catalog.products.find(product => product.id === item.productId);
    if (!product || !Number.isInteger(item.quantity) || item.quantity < 1) return [];
    return [{ id: typeof item.id === 'string' ? item.id : crypto.randomUUID(), productId: product.id, quantity: Math.min(item.quantity, 99), optionIds: validOptions(product, Array.isArray(item.optionIds) ? item.optionIds : [], catalog.options), notes: typeof item.notes === 'string' ? item.notes.slice(0, 200) : '' }];
  });
}

export function addItem(items, incoming) {
  const options = [...incoming.optionIds].sort().join('|');
  const same = items.find(item => item.productId === incoming.productId && item.notes === incoming.notes && [...item.optionIds].sort().join('|') === options);
  if (same) return items.map(item => item.id === same.id ? { ...item, quantity: Math.min(99, item.quantity + incoming.quantity) } : item);
  return [...items, { ...incoming, id: crypto.randomUUID() }];
}

export function formatOrder(items, catalog, config, details) {
  const summary = totals(items, catalog, config, details.fulfillment);
  const lines = [`*Oi, ${config.name}! Meu pedido:*`, '', `Nome: ${details.customer.trim()}`, `Receber: ${details.fulfillment === 'delivery' ? 'Entrega' : 'Retirada'}`];
  if (details.fulfillment === 'delivery') lines.push(`Endereço: ${details.address.trim()}`);
  lines.push('', '*ITENS*');
  items.forEach((item, index) => {
    const product = catalog.products.find(product => product.id === item.productId);
    lines.push(`${index + 1}. ${item.quantity}× ${product.name} — ${money(unitPrice(item, catalog) * item.quantity)}`);
    if (item.optionIds.length) lines.push(`   Personalização: ${item.optionIds.map(id => catalog.options.find(option => option.id === id)?.name).filter(Boolean).join(', ')}`);
    if (item.notes) lines.push(`   Observação: ${item.notes}`);
  });
  lines.push('', `Subtotal: ${money(summary.subtotal)}`, `Entrega: ${details.fulfillment === 'pickup' ? 'Retirada no local (sem taxa)' : money(summary.delivery)}`, `*TOTAL: ${money(summary.total)}*`, `Pagamento: ${details.payment}`);
  if (details.notes.trim()) lines.push(`Observação do pedido: ${details.notes.trim()}`);
  lines.push('', 'Me confirma o prazo quando puder. Valeu!');
  return lines.join('\n');
}

export function whatsappURL(number, message) {
  const phone = String(number).replace(/\D/g, '');
  if (!/^[1-9]\d{9,14}$/.test(phone)) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
