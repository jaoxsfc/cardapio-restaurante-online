import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
const runtimeDirectory = resolve(root, '.runtime');
const eventsFile = resolve(runtimeDirectory, 'restaurant-events.json');
let eventQueue;

async function loadEvents() {
  if (eventQueue) return eventQueue;
  try { eventQueue = JSON.parse(await readFile(eventsFile, 'utf8')); }
  catch { eventQueue = []; }
  return eventQueue;
}

async function saveEvents() {
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(eventsFile, JSON.stringify(eventQueue, null, 2), 'utf8');
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

async function readJSON(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new Error('PAYLOAD_TOO_LARGE');
  }
  return JSON.parse(body || '{}');
}

function calculateBill(events, table) {
  const tableEvents = events.filter(event => event.table === table);
  const lastClosedBill = tableEvents.filter(event => event.type === 'bill' && event.status === 'done').sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))[0];
  const cutoff = lastClosedBill ? (lastClosedBill.updatedAt || lastClosedBill.createdAt) : '';
  const orders = tableEvents.filter(event => event.type === 'order' && (!cutoff || event.createdAt > cutoff));
  const aLaCarte = orders.filter(event => event.diningMode !== 'rodizio').reduce((sum, event) => sum + (Number(event.total) || 0), 0);
  const rodizioOrders = orders.filter(event => event.diningMode === 'rodizio');
  const rodizioCover = rodizioOrders.length ? Number(rodizioOrders.at(-1).coverTotal) || 0 : 0;
  const rodizioExtras = rodizioOrders.reduce((sum, event) => sum + (Number(event.total) || 0), 0);
  const itemCount = orders.reduce((sum, event) => sum + (event.items || []).reduce((count, item) => count + (Number(item.quantity) || 0), 0), 0);
  return { table, orderCount: orders.length, itemCount, aLaCarte, rodizioCover, rodizioExtras, total: aLaCarte + rodizioCover + rodizioExtras };
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/api/restaurant/bill' && request.method === 'GET') {
      const table = String(url.searchParams.get('table') || '').replace(/\D/g, '').slice(0, 4);
      if (!table) return json(response, 400, { error: 'Informe a mesa para calcular a conta.' });
      return json(response, 200, { bill: calculateBill(await loadEvents(), table) });
    }
    if (pathname === '/api/restaurant/events') {
      const events = await loadEvents();
      if (request.method === 'GET') {
        const table = String(url.searchParams.get('table') || '').replace(/\D/g, '');
        const filtered = table ? events.filter(event => event.table === table) : events;
        return json(response, 200, { events: filtered.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
      }
      if (request.method === 'POST') {
        const input = await readJSON(request);
        const table = String(input.table || '').replace(/\D/g, '').slice(0, 4);
        if (!table || !['order', 'waiter', 'bill'].includes(input.type)) return json(response, 400, { error: 'Mesa ou tipo de solicitação inválido.' });
        const event = { id: randomUUID(), type: input.type, table, status: input.type === 'order' ? 'preparing' : 'new', createdAt: new Date().toISOString() };
        if (input.type === 'order') Object.assign(event, { customer: String(input.customer || '').slice(0, 80), payment: String(input.payment || '').slice(0, 60), notes: String(input.notes || '').slice(0, 300), total: Number(input.total) || 0, diningMode: input.diningMode === 'rodizio' ? 'rodizio' : 'a-la-carte', guests: Math.max(1, Math.min(30, Number(input.guests) || 1)), coverTotal: Number(input.coverTotal) || 0, items: Array.isArray(input.items) ? input.items.slice(0, 99) : [] });
        if (input.type === 'bill') event.bill = calculateBill(events, table);
        events.push(event); await saveEvents();
        return json(response, 201, { event });
      }
      response.writeHead(405, { Allow: 'GET, POST' }); return response.end();
    }
    const eventMatch = pathname.match(/^\/api\/restaurant\/events\/([a-f0-9-]+)$/i);
    if (eventMatch && request.method === 'PATCH') {
      const events = await loadEvents();
      const event = events.find(item => item.id === eventMatch[1]);
      if (!event) return json(response, 404, { error: 'Solicitação não encontrada.' });
      const input = await readJSON(request);
      if (!['new', 'accepted', 'preparing', 'ready', 'done'].includes(input.status)) return json(response, 400, { error: 'Status inválido.' });
      event.status = input.status; event.updatedAt = new Date().toISOString(); await saveEvents();
      return json(response, 200, { event });
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); return response.end(); }
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root.endsWith(sep) ? root : `${root}${sep}`) || !types[extname(file)] || pathname.split('/').some(part => part.startsWith('.') || part === 'node_modules' || part === 'tests') || pathname === '/package-lock.json') {
      response.writeHead(403); return response.end('Acesso negado');
    }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500);
    response.end('Arquivo indisponível');
  }
}).listen(port, '0.0.0.0', () => console.log(`Kuro Sushi disponível em http://localhost:${port}`));
