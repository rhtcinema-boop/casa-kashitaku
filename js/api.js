// casa 貸卓 — データ層(ローカル優先 + まとめて同期)
// 操作はすべて端末内に即反映し、未同期キュー(pending)に積む。
// 「同期」でキューを Apps Script にまとめて送り(op:'batch')、返ってきた最新状態を取り込む。
// GAS_URL が空ならテストモード(同期 = 端末内で確定するだけ)。
(function (g) {
  const CFG = g.KASHITAKU_CONFIG || {};
  const HAS_GAS = !!CFG.GAS_URL;
  const LS_KEY = 'kt.v2';
  const DEFAULT_CONFIG = { tourFee: 20, reentryFee: 20 };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const deviceId = (() => {
    try {
      let id = localStorage.getItem('kt.device');
      if (!id) { id = Math.random().toString(36).slice(2, 8); localStorage.setItem('kt.device', id); }
      return id;
    } catch (e) { return 'x'; }
  })();
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------- 保存 ----------
  let db;
  function load() {
    try { db = JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch (e) { db = null; }
    if (!db || typeof db !== 'object' || !db.days) db = { days: {}, dates: [] };
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (e) { /* 容量不足など */ } }
  function day(date) {
    if (!db.days[date]) db.days[date] = { server: { players: [], txs: [], config: clone(DEFAULT_CONFIG) }, pending: [], syncedAt: 0 };
    return db.days[date];
  }
  load();

  // ---------- 操作の適用(純粋関数) ----------
  function applyOp(st, op) {
    switch (op.op) {
      case 'register': {
        const no = Number(op.no), i = st.players.findIndex(p => Number(p.no) === no);
        if (!op.name) { if (i >= 0) st.players.splice(i, 1); }
        else if (i >= 0) st.players[i].name = op.name; else st.players.push({ no, name: op.name });
        break;
      }
      case 'tx': if (!st.txs.some(t => t.id === op.tx.id)) st.txs.push(clone(op.tx)); break;
      case 'undo': st.txs = st.txs.filter(t => t.id !== op.id); break;
      case 'config': st.config = Object.assign({}, st.config, op.config); break;
    }
    return st;
  }

  // ---------- 表示用の状態 ----------
  function view(date) {
    const d = day(date);
    const st = d.pending.reduce(applyOp, clone(d.server));
    st.config = Object.assign(clone(DEFAULT_CONFIG), st.config || {});
    st.date = date;
    st.pendingCount = d.pending.length;
    st.pendingTotal = Object.values(db.days).reduce((a, x) => a + x.pending.length, 0);
    st.syncedAt = d.syncedAt;
    st.dates = [...new Set([...(db.dates || []), ...Object.keys(db.days), date])].sort().reverse();
    st.mode = HAS_GAS ? 'gas' : 'local';
    return st;
  }

  function push(date, op) {
    op.opId = uid();
    day(date).pending.push(op);
    save();
    return view(date);
  }

  // ---------- 同期 ----------
  let syncing = null;           // 実行中の Promise
  const inFlight = new Set();   // 送信中の opId

  async function gasGet(date) {
    const r = await fetch(`${CFG.GAS_URL}?date=${encodeURIComponent(date)}&_=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }
  async function gasPost(body) {
    body.by = deviceId;
    const r = await fetch(CFG.GAS_URL, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }
  function takeServer(date, s) {
    const d = day(date);
    d.server = { players: s.players || [], txs: s.txs || [], config: s.config || clone(DEFAULT_CONFIG) };
    d.syncedAt = Date.now();
    if (s.dates) db.dates = s.dates;
  }

  // 全日付の未同期分を送り、current の最新を取り込む
  function sync(current) {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const dates = Object.keys(db.days).filter(k => db.days[k].pending.length);
        for (const date of dates) {
          const d = day(date);
          const ops = d.pending.slice();
          if (!HAS_GAS) { d.server = ops.reduce(applyOp, clone(d.server)); d.pending = d.pending.filter(o => !ops.includes(o)); d.syncedAt = Date.now(); save(); continue; }
          ops.forEach(o => inFlight.add(o.opId));
          try {
            const s = await gasPost({ op: 'batch', date, ops });
            const sent = new Set(ops.map(o => o.opId));
            d.pending = d.pending.filter(o => !sent.has(o.opId));
            takeServer(date, s);
            save();
          } catch (e) {
            // 届いたかどうか分からない(返事だけ途切れた可能性)→ 印を付けて、削除時は必ず取り消しも送る
            ops.forEach(o => { o.maybeSent = true; });
            save();
            throw e;
          } finally { ops.forEach(o => inFlight.delete(o.opId)); }
        }
        if (HAS_GAS && !dates.includes(current)) { takeServer(current, await gasGet(current)); save(); }
        if (!HAS_GAS) { day(current).syncedAt = Date.now(); save(); }
        return view(current);
      } finally { syncing = null; }
    })();
    return syncing;
  }

  g.KashitakuAPI = {
    mode: HAS_GAS ? 'gas' : 'local',
    deviceId,
    // 端末内の状態(通信なし)
    getState: async (date) => view(date),
    view,
    isSyncing: () => !!syncing,
    sync,
    // サーバーの状態を直接読む(PC ボード用)
    fetchState: async (date) => {
      if (!HAS_GAS) return view(date);
      const s = await gasGet(date);
      s.mode = 'gas';
      s.config = Object.assign(clone(DEFAULT_CONFIG), s.config || {});
      return s;
    },
    register: async (date, no, name) => {
      const d = day(date);
      // 未送信の同じ番号の登録は置き換える
      d.pending = d.pending.filter(o => !(o.op === 'register' && Number(o.no) === Number(no) && !inFlight.has(o.opId)));
      return push(date, { op: 'register', no: Number(no), name: String(name || '') });
    },
    addTx: async (date, tx) => {
      const t = Object.assign({}, tx, { id: uid(), ts: Date.now(), date, by: deviceId, table: tx.table || '' });
      const st = push(date, { op: 'tx', tx: t });
      st._lastId = t.id;
      return st;
    },
    undo: async (date, id) => {
      const d = day(date);
      const i = d.pending.findIndex(o => o.op === 'tx' && o.tx.id === id && !inFlight.has(o.opId));
      if (i >= 0) {
        const wasMaybeSent = d.pending[i].maybeSent;
        d.pending.splice(i, 1); save();                 // 未送信ならキューから消すだけ
        if (!wasMaybeSent) return view(date);
      }
      return push(date, { op: 'undo', id });            // 送信済み(かもしれない)ものはシートでも取り消す
    },
    setConfig: async (date, config) => push(date, { op: 'config', config }),
    // 全消去はすぐに実行(テスト後の片付け用)
    clearDay: async (date) => {
      if (HAS_GAS) await gasPost({ op: 'clearDay', date });
      delete db.days[date];
      db.dates = (db.dates || []).filter(x => x !== date);
      save();
      return view(date);
    },
    _applyOp: applyOp,
  };
})(typeof window !== 'undefined' ? window : globalThis);
