(function() {
  const VISITOR_KEY = 'bradescoVisitorId';
  const RECENT_WINDOW_MS = 30 * 60 * 1000;
  const STALE_CLIENT_MS = 45000;

  function makeId() {
    return 'v_' + Math.random().toString(36).slice(2, 10);
  }

  function getVisitorId() {
    let visitorId = localStorage.getItem(VISITOR_KEY);
    if (!visitorId) {
      visitorId = makeId();
      localStorage.setItem(VISITOR_KEY, visitorId);
    }
    return visitorId;
  }

  function getRegion() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
    } catch (e) {
      return 'America/Sao_Paulo';
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function getFirebaseDb() {
    const config = window.BRADESCO_FIREBASE_CONFIG;
    if (!config || !config.databaseURL) return null;

    await loadScript('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.12.5/firebase-database-compat.js');

    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }

    return firebase.database();
  }

  function summarizeByRegion(clients) {
    const grouped = {};
    clients.forEach(client => {
      const region = client.region || 'Desconhecido';
      grouped[region] = (grouped[region] || 0) + 1;
    });
    return Object.keys(grouped)
      .map(region => ({ region, count: grouped[region] }))
      .sort((a, b) => b.count - a.count);
  }

  function buildStats(sessionsSnapshot, visitsSnapshot) {
    const now = Date.now();
    const sessions = sessionsSnapshot || {};
    const visits = visitsSnapshot || {};
    const clients = Object.keys(sessions)
      .map(id => ({ id, ...sessions[id] }))
      .filter(client => Number(client.lastSeen || 0) >= now - STALE_CLIENT_MS)
      .sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0));
    const regions = summarizeByRegion(clients);
    const recent = Object.values(visits).filter(visit => {
      return Number(visit.lastSeen || visit.firstSeen || 0) >= now - RECENT_WINDOW_MS;
    }).length;

    return {
      type: 'stats',
      generatedAt: new Date().toISOString(),
      total: Object.keys(visits).length,
      online: clients.length,
      clients,
      top: regions[0] ? regions[0].region : '-',
      recent,
      regions
    };
  }

  async function connectFirebaseVisitor(page) {
    const db = await getFirebaseDb();
    if (!db) return false;

    const id = getVisitorId();
    const sessionRef = db.ref(`sessions/${id}`);
    const visitRef = db.ref(`visits/${id}`);

    function payload() {
      return {
        id,
        region: getRegion(),
        page: page || document.title || 'Pagina acessada',
        connectedAt: firebase.database.ServerValue.TIMESTAMP,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
      };
    }

    visitRef.transaction(current => current || {
      id,
      firstSeen: firebase.database.ServerValue.TIMESTAMP
    }).then(() => {
      visitRef.update({
        region: getRegion(),
        page: page || document.title || 'Pagina acessada',
        lastSeen: firebase.database.ServerValue.TIMESTAMP
      });
    });

    sessionRef.set(payload());
    sessionRef.onDisconnect().remove();

    const timer = setInterval(() => {
      const update = {
        region: getRegion(),
        page: page || document.title || 'Pagina acessada',
        lastSeen: firebase.database.ServerValue.TIMESTAMP
      };
      sessionRef.update(update);
      visitRef.update(update);
    }, 15000);

    window.addEventListener('beforeunload', () => {
      clearInterval(timer);
      sessionRef.remove();
    });

    return true;
  }

  async function connectFirebaseDashboard(onStats) {
    const db = await getFirebaseDb();
    if (!db) return false;

    let sessions = {};
    let visits = {};

    function emit() {
      onStats(buildStats(sessions, visits));
    }

    db.ref('sessions').on('value', snapshot => {
      sessions = snapshot.val() || {};
      emit();
    });

    db.ref('visits').on('value', snapshot => {
      visits = snapshot.val() || {};
      emit();
    });

    return true;
  }

  function connectWebSocketVisitor(page) {
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = location.host || 'localhost:3000';
    const defaultUrl = `${wsProtocol}//${wsHost}`;
    const wsUrl = (window.BRADESCO_WS_URL || defaultUrl).replace(/\/$/, '');
    const visitorId = getVisitorId();
    let socket;
    let pingTimer;

    function sendPresence(type) {
      try {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({
          type,
          role: 'visitor',
          id: visitorId,
          page: page || document.title || 'Pagina acessada',
          region: getRegion()
        }));
      } catch (e) {}
    }

    function connect() {
      try {
        socket = new WebSocket(wsUrl);
      } catch (e) {
        return setTimeout(connect, 2000);
      }

      socket.addEventListener('open', () => {
        sendPresence('join');
        clearInterval(pingTimer);
        pingTimer = setInterval(() => sendPresence('ping'), 15000);
      });
      socket.addEventListener('close', () => {
        clearInterval(pingTimer);
        setTimeout(connect, 2000);
      });
    }

    window.addEventListener('beforeunload', () => {
      try {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'leave', id: visitorId }));
        }
      } catch (e) {}
    });

    connect();
  }

  function connectWebSocketDashboard(onStats) {
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = location.host || 'localhost:3000';
    const defaultUrl = `${wsProtocol}//${wsHost}`;
    const wsUrl = (window.BRADESCO_WS_URL || defaultUrl).replace(/\/$/, '');
    const dashboardId = 'dashboard_' + Math.random().toString(36).slice(2, 10);
    let socket;

    function connect() {
      socket = new WebSocket(wsUrl);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'join', role: 'dashboard', id: dashboardId }));
      });
      socket.addEventListener('message', ev => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'stats') onStats(msg);
        } catch (e) {}
      });
      socket.addEventListener('close', () => setTimeout(connect, 2000));
    }

    connect();
  }

  window.BradescoRealtime = {
    async connectVisitor(page) {
      const usingFirebase = await connectFirebaseVisitor(page);
      if (!usingFirebase) connectWebSocketVisitor(page);
    },
    async connectDashboard(onStats) {
      const usingFirebase = await connectFirebaseDashboard(onStats);
      if (!usingFirebase) connectWebSocketDashboard(onStats);
    }
  };
})();
