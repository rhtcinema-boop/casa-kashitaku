// casa 貸卓 — バックエンド接続。GAS_URL があれば Apps Script、無ければ端末内保存(テストモード)。
// どちらも同じ形の state を返す: { date, players:[{no,name}], txs:[tx], config:{tourFee,reentryFee}, dates:[...] }
(function (g) {
  const CFG = g.KASHITAKU_CONFIG || {};
  const deviceId = (() => {
    try {
      let id = localStorage.getItem('kt.device');
      if (!id) { id = Math.random().toString(36).slice(2, 8); localStorage.setItem('kt.device', id); }
      return id;
    } catch (e) { return 'x'; }
  })();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- テストモード(localStorage) ----------
  const LS_KEY = 'kt.local.v1';
  function lsLoad() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || { days: {} }; } catch (e) { return { days: {} }; } }
  function lsSave(db) { localStorage.setItem(LS_KEY, JSON.stringify(db)); }
  function lsDay(db, date) {
    if (!db.days[date]) db.days[date] = { players: [], txs: [], config: { tourFee: 20, reentryFee: 20 } };
    return db.days[date];
  }
  function lsState(db, date) {
    const d = lsDay(db, date);
    return { date, players: d.players, txs: d.txs.filter(t => !t.deleted), config: d.config, dates: Object.keys(db.days).sort().reverse(), mode: 'local' };
  }
  const local = {
    async get(date) { return lsState(lsLoad(), date); },
    async post(body) {
      const db = lsLoad(); const d = lsDay(db, body.date);
      switch (body.op) {
        case 'register': {
          const i = d.players.findIndex(p => Number(p.no) === Number(body.no));
          if (i >= 0) d.players[i].name = body.name; else d.players.push({ no: Number(body.no), name: body.name });
          break;
        }
        case 'tx': d.txs.push({ ...body.tx, id: uid(), ts: Date.now(), by: deviceId }); break;
        case 'undo': { const t = d.txs.find(t => t.id === body.id); if (t) t.deleted = true; break; }
        case 'config': Object.assign(d.config, body.config); break;
        case 'newDay': break;
        case 'clearDay': delete db.days[body.date]; lsSave(db); return lsState(db, body.date);
      }
      lsSave(db);
      return lsState(db, body.date);
    },
  };

  // ---------- Apps Script ----------
  const gas = {
    async get(date) {
      const r = await fetch(`${CFG.GAS_URL}?date=${encodeURIComponent(date)}&_=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      j.mode = 'gas';
      return j;
    },
    async post(body) {
      body.by = deviceId;
      if (body.op === 'tx') body.tx = { ...body.tx, id: uid() };
      const r = await fetch(CFG.GAS_URL, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      j.mode = 'gas';
      return j;
    },
  };

  const backend = CFG.GAS_URL ? gas : local;

  g.KashitakuAPI = {
    mode: CFG.GAS_URL ? 'gas' : 'local',
    deviceId,
    getState: (date) => backend.get(date),
    register: (date, no, name) => backend.post({ op: 'register', date, no, name }),
    addTx: (date, tx) => backend.post({ op: 'tx', date, tx: { ...tx, date } }),
    undo: (date, id) => backend.post({ op: 'undo', date, id }),
    setConfig: (date, config) => backend.post({ op: 'config', date, config }),
    newDay: (date) => backend.post({ op: 'newDay', date }),
    clearDay: (date) => backend.post({ op: 'clearDay', date }),
  };
})(window);
