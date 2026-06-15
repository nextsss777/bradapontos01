const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const DATA_FILE = path.join(__dirname, 'visits.json');
const RECENT_WINDOW_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 30000;
const STALE_CLIENT_MS = 45000;

let visits = [];
let seen = new Set();

try {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const obj = JSON.parse(raw);
  seen = new Set(obj.seen || []);
  visits = Array.isArray(obj.visits)
    ? obj.visits
    : Array.from(seen).map(id => ({ id, firstSeen: Date.now(), lastSeen: Date.now() }));
} catch (e) {
  // ignore, will create file on first persist
}

const app = express();
app.get('/health', (req, res) => {
  res.json({ ok: true, online: clients.size, total: seen.size });
});
app.use(express.static(__dirname));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const clients = new Map();

function persist() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      total: seen.size,
      seen: Array.from(seen),
      visits
    }, null, 2));
  } catch (e) {
    console.error('Erro ao persistir dados:', e.message);
  }
}

function safeText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback;
}

function computeTopRegion(list) {
  const counts = {};
  list.forEach(client => {
    const region = client.region || 'Desconhecido';
    counts[region] = (counts[region] || 0) + 1;
  });
  const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return sorted[0] || '-';
}

function summarizeByRegion(list) {
  const grouped = new Map();

  list.forEach(client => {
    const region = client.region || 'Desconhecido';
    const entry = grouped.get(region) || { region, count: 0 };
    entry.count += 1;
    grouped.set(region, entry);
  });

  return Array.from(grouped.values()).sort((a, b) => b.count - a.count);
}

function getVisit(id) {
  return visits.find(visit => visit.id === id);
}

function recordVisit(client) {
  const timestamp = Date.now();
  let visit = getVisit(client.id);

  if (!visit) {
    visit = {
      id: client.id,
      firstSeen: timestamp,
      lastSeen: timestamp,
      region: client.region,
      page: client.page
    };
    visits.push(visit);
  }

  visit.lastSeen = timestamp;
  visit.region = client.region;
  visit.page = client.page;

  if (!seen.has(client.id)) {
    seen.add(client.id);
  }

  persist();
}

function compactClients() {
  const cutoff = Date.now() - STALE_CLIENT_MS;
  let changed = false;

  clients.forEach((client, id) => {
    if (client.lastSeen < cutoff || client.ws.readyState !== WebSocket.OPEN) {
      clients.delete(id);
      changed = true;
    }
  });

  return changed;
}

function broadcastStats() {
  compactClients();

  const clientsArr = Array.from(clients.values());
  const clientsInfo = clientsArr.map(client => ({
    id: client.id,
    region: client.region,
    page: client.page,
    connectedAt: client.connectedAt,
    lastSeen: client.lastSeen
  })).sort((a, b) => b.lastSeen - a.lastSeen);

  const recentCutoff = Date.now() - RECENT_WINDOW_MS;
  const recent = visits.filter(visit => Number(visit.lastSeen || visit.firstSeen || 0) >= recentCutoff).length;

  const msg = JSON.stringify({
    type: 'stats',
    generatedAt: new Date().toISOString(),
    total: seen.size,
    online: clientsInfo.length,
    clients: clientsInfo,
    top: computeTopRegion(clientsInfo),
    recent,
    regions: summarizeByRegion(clientsInfo)
  });

  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'join') {
        const id = msg.id || ('v_' + Math.random().toString(36).slice(2, 10));
        const role = msg.role === 'dashboard' ? 'dashboard' : 'visitor';

        ws._visitorId = id;
        ws._role = role;

        if (role === 'visitor') {
          const client = {
            ws,
            id,
            region: safeText(msg.region, 'Desconhecido'),
            page: safeText(msg.page, 'Pagina inicial'),
            connectedAt: Date.now(),
            lastSeen: Date.now()
          };

          clients.set(id, client);
          recordVisit(client);
        }

        broadcastStats();
      } else if (msg.type === 'ping') {
        if (ws._role === 'visitor' && ws._visitorId && clients.has(ws._visitorId)) {
          const client = clients.get(ws._visitorId);
          client.lastSeen = Date.now();
          if (msg.page) client.page = safeText(msg.page, client.page);
          recordVisit(client);
        }
        broadcastStats();
      } else if (msg.type === 'leave') {
        const id = msg.id;
        if (id && clients.has(id)) {
          clients.delete(id);
          broadcastStats();
        }
      }
    } catch (e) {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    if (ws._role === 'visitor' && ws._visitorId && clients.has(ws._visitorId)) {
      clients.delete(ws._visitorId);
      broadcastStats();
    }
  });
});

setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
  broadcastStats();
}, HEARTBEAT_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
