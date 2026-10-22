// casa 貸卓 — 自動テスト(node tests/run.js)
// 本物の gas/Code.gs を、Google スプレッドシートを真似たモックの上で動かし、
// js/model.js と js/api.js(同期キュー)と組み合わせて通しで確認する。
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');

// ---------- Google Sheets のモック ----------
function makeSheets() {
  const sheets = [];
  const isDateText = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  function Sheet(name) {
    const sh = { name, rows: [], fmt: {} };
    const conv = (r, c, v) => (isDateText(v) && sh.fmt[r + ':' + c] !== '@') ? new Date(v + 'T00:00:00+09:00') : v; // Sheets は日付っぽい文字を日付にする
    const ensure = (r, c) => { while (sh.rows.length < r) sh.rows.push([]); const row = sh.rows[r - 1]; while (row.length < c) row.push(''); };
    const range = (r, c, nr = 1, nc = 1) => ({
      setValue(v) { ensure(r, c); sh.rows[r - 1][c - 1] = conv(r, c, v); return this; },
      setValues(vs) { vs.forEach((row, i) => row.forEach((v, j) => { ensure(r + i, c + j); sh.rows[r + i - 1][c + j - 1] = conv(r + i, c + j, v); })); return this; },
      setNumberFormat(f) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.fmt[(r + i) + ':' + (c + j)] = f; return this; },
      setFontWeight() { return this; },
    });
    Object.assign(sh, {
      getName: () => name,
      appendRow(vals) { const r = sh.rows.length + 1; sh.rows.push([]); vals.forEach((v, j) => { ensure(r, j + 1); sh.rows[r - 1][j] = conv(r, j + 1, v); }); },
      getDataRange() { const w = Math.max(1, ...sh.rows.map(x => x.length)); return { getValues: () => sh.rows.length ? sh.rows.map(x => { const y = x.slice(); while (y.length < w) y.push(''); return y; }) : [['']] }; },
      getRange(a, b, c, d) {
        if (typeof a === 'string') { // "A:C"
          const col = ch => ch.charCodeAt(0) - 64; const [x, y] = a.split(':');
          return { setNumberFormat(f) { for (let r = 1; r <= 2000; r++) for (let cc = col(x); cc <= col(y); cc++) sh.fmt[r + ':' + cc] = f; return this; } };
        }
        return range(a, b, c, d);
      },
      getLastRow: () => sh.rows.length,
      deleteRow(r) { sh.rows.splice(r - 1, 1); const nf = {}; Object.entries(sh.fmt).forEach(([k, v]) => { const [rr, cc] = k.split(':').map(Number); if (rr < r) nf[k] = v; else if (rr > r) nf[(rr - 1) + ':' + cc] = v; }); sh.fmt = nf; },
      setFrozenRows() {}, setFrozenColumns() {},
      clearContents() { sh.rows = []; },
    });
    return sh;
  }
  const ss = {
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet(n, idx) { const s = Sheet(n); if (idx === 0) sheets.unshift(s); else sheets.push(s); return s; },
    deleteSheet(s) { sheets.splice(sheets.indexOf(s), 1); },
  };
  return { ss, sheets };
}

function loadGas() {
  const mock = makeSheets();
  const ctx = {
    SpreadsheetApp: { getActive: () => mock.ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => 'u' + Math.random().toString(36).slice(2),
      formatDate: (d, tz, f) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return this; }, s }) },
    Date, JSON, Math, Number, String, Object, isNaN,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'gas/Code.gs'), 'utf8'), ctx);
  const call = {
    get: date => JSON.parse(ctx.doGet({ parameter: { date } }).s),
    post: body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).s),
  };
  return { ctx, mock, call };
}

// ---------- ブラウザ側(model.js + api.js)を読み込む ----------
function loadClient(gas, opts = {}) {
  const store = Object.assign({}, opts.store || {});
  const win = {
    KASHITAKU_CONFIG: { GAS_URL: opts.local ? '' : 'https://gas.example/exec', MAX_NO: 50, POINT_YEN: 10000 },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  };
  let fail = false, delay = 0, loseReply = false;
  win.fetch = async (url, init) => {
    if (fail) throw new Error('offline');
    if (delay) await new Promise(r => setTimeout(r, delay));
    const body = init && init.method === 'POST' ? gas.call.post(JSON.parse(init.body)) : gas.call.get(new URL(url).searchParams.get('date'));
    if (loseReply) throw new Error('reply lost'); // シートには届いたが返事が途切れた
    return { ok: true, json: async () => body };
  };
  const ctx = vm.createContext({ window: win, localStorage: win.localStorage, fetch: (...a) => win.fetch(...a), URL, Date, JSON, Math, Object, Number, String, Set, Promise, setTimeout, console });
  ctx.globalThis = ctx;
  for (const f of ['js/model.js', 'js/api.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  return { K: win.Kashitaku || ctx.Kashitaku, API: win.KashitakuAPI, store, setFail: v => { fail = v; }, setDelay: v => { delay = v; }, setLoseReply: v => { loseReply = v; } };
}

// ---------- テスト ----------
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const D = '2099-02-01';

test('集計: バカラ・リング・トーナメント・ディーラー', async () => {
  const { K } = loadClient(loadGas());
  const a = K.aggregate([{ no: 1, name: 'A' }], [
    { id: 1, ts: 1, no: 1, game: 'bac', type: 'in', pt: 50 }, { id: 2, ts: 2, no: 1, game: 'bac', type: 'out', pt: 80 },
    { id: 3, ts: 3, no: 1, game: 'cash', type: 'in', pt: 30 },
    { id: 4, ts: 4, no: 2, game: 'tour', type: 'entry', pt: 20 }, { id: 5, ts: 5, no: 2, game: 'tour', type: 'bust', pt: 0 },
    { id: 6, ts: 6, no: 2, game: 'tour', type: 'reentry', pt: 20 }, { id: 7, ts: 7, no: 2, game: 'tour', type: 'prize', pt: 60, table: '1st' },
    { id: 8, ts: 8, game: 'dealer', table: 'bac', type: 'in', pt: -400 },
  ], {});
  assert.deepStrictEqual([a.players[0].bac.pl, a.players[0].cash.pl, a.players[0].total], [30, -30, 0]);
  assert.deepStrictEqual([a.players[1].tour.e, a.players[1].tour.re, a.players[1].tour.pl, a.players[1].tour.alive], [1, 1, 20, false]);
  assert.strictEqual(a.totals.tour.active, 0);
  assert.strictEqual(a.totals.house, -20);
  assert.strictEqual(a.dealer.bac.in, -400);
});

test('残り人数: 飛び→リエントリーで復活、賞金で終了', async () => {
  const { K } = loadClient(loadGas());
  const t = (ts, no, type, pt = 20) => ({ id: ts, ts, no, game: 'tour', type, pt });
  const a = K.aggregate([], [t(1, 1, 'entry'), t(2, 2, 'entry'), t(3, 3, 'entry'), t(4, 2, 'bust', 0), t(5, 3, 'bust', 0), t(6, 3, 'reentry')], {});
  assert.strictEqual(a.totals.tour.e + a.totals.tour.re, 4);
  assert.strictEqual(a.totals.tour.active, 2);
});

test('入力は即時に端末へ反映され、同期まで送らない', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  let posts = 0; const f = c.API; const orig = gas.call.post; gas.call.post = b => { posts++; return orig(b); };
  await f.register(D, 1, 'イトウ');
  await f.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 50 });
  const v = f.view(D);
  assert.strictEqual(v.txs.length, 1); assert.strictEqual(v.pendingCount, 2); assert.strictEqual(posts, 0);
  const s = await f.sync(D);
  assert.strictEqual(posts, 1, 'まとめて1回で送る');
  assert.strictEqual(s.pendingCount, 0);
  const server = gas.call.get(D);
  assert.strictEqual(server.txs.length, 1); assert.strictEqual(server.players[0].name, 'イトウ');
});

test('同期: 日付タブが総収支と同じ並びで作られる', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  await c.API.register(D, 7, 'テスト');
  await c.API.addTx(D, { no: 7, game: 'bac', type: 'in', pt: 30 });
  await c.API.addTx(D, { no: 7, game: 'tour', type: 'entry', pt: 20 });
  await c.API.sync(D);
  const day = gas.mock.ss.getSheetByName(D).rows;
  assert.strictEqual(day[0][0], '番号'); assert.strictEqual(day[2][1], 'テスト');
  assert.strictEqual(day[2][3], -500000);               // 合計収支
  assert.strictEqual(day[2][18], 300000);               // バカラ IN 合計
  assert.strictEqual(day[2][40], 1);                    // T E数
});

test('同じ入力を2回送っても二重記録しない(通信やり直し対策)', async () => {
  const gas = loadGas();
  const op = { op: 'tx', opId: 'o1', tx: { id: 'fixed1', ts: 1, no: 1, game: 'bac', type: 'in', pt: 10 } };
  gas.call.post({ op: 'batch', date: D, ops: [op] });
  gas.call.post({ op: 'batch', date: D, ops: [op] });
  assert.strictEqual(gas.call.get(D).txs.length, 1);
});

test('未同期の入力を削除すると送らずに消える', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  const st = await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  await c.API.undo(D, st._lastId);
  assert.strictEqual(c.API.view(D).pendingCount, 0);
  await c.API.sync(D);
  assert.strictEqual(gas.call.get(D).txs.length, 0);
});

test('同期済みの入力を削除すると次の同期でシートからも消える', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  const st = await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  await c.API.sync(D);
  await c.API.undo(D, st._lastId);
  assert.strictEqual(c.API.view(D).txs.length, 0);
  await c.API.sync(D);
  assert.strictEqual(gas.call.get(D).txs.length, 0);
});

test('同期中に追加した入力は消えずに次の同期で送られる', async () => {
  const gas = loadGas(); const c = loadClient(gas); c.setDelay(30);
  await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  const p = c.API.sync(D);
  await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 20 });
  await p;
  assert.strictEqual(c.API.view(D).txs.length, 2, '画面には2件');
  assert.strictEqual(c.API.view(D).pendingCount, 1);
  c.setDelay(0); await c.API.sync(D);
  assert.strictEqual(gas.call.get(D).txs.length, 2);
});

test('同期中に送信中の入力を削除しても、取り消しとして次で送られる', async () => {
  const gas = loadGas(); const c = loadClient(gas); c.setDelay(30);
  const st = await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  const p = c.API.sync(D);
  await c.API.undo(D, st._lastId);
  await p;
  c.setDelay(0); await c.API.sync(D);
  assert.strictEqual(gas.call.get(D).txs.length, 0);
  assert.strictEqual(c.API.view(D).txs.length, 0);
});

test('電波なしで同期しても入力は残り、あとで送れる', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  c.setFail(true);
  await assert.rejects(c.API.sync(D));
  assert.strictEqual(c.API.view(D).pendingCount, 1);
  c.setFail(false); await c.API.sync(D);
  assert.strictEqual(gas.call.get(D).txs.length, 1);
});

test('アプリを開き直しても未同期の入力は残る', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  const reopened = loadClient(gas, { store: c.store }); // 同じ端末の保存内容で読み込み直す
  assert.strictEqual(reopened.API.view(D).pendingCount, 1);
});

test('2台のスマホの入力が同期で合わさる', async () => {
  const gas = loadGas(); const a = loadClient(gas), b = loadClient(gas);
  await a.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  await b.API.addTx(D, { no: 2, game: 'cash', type: 'in', pt: 20 });
  await a.API.sync(D); await b.API.sync(D); await a.API.sync(D);
  assert.strictEqual(a.API.view(D).txs.length, 2); assert.strictEqual(b.API.view(D).txs.length, 2);
});

test('名前の変更・削除、設定(プライズ)が日付セルの自動変換に負けない', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  await c.API.register(D, 3, 'A'); await c.API.sync(D);
  await c.API.register(D, 3, 'B'); await c.API.setConfig(D, { prizes: '203,149,105', tourFee: 30 }); await c.API.sync(D);
  let s = gas.call.get(D);
  assert.deepStrictEqual(s.players, [{ no: 3, name: 'B' }]);
  assert.strictEqual(s.config.prizes, '203,149,105'); assert.strictEqual(s.config.tourFee, 30);
  await c.API.register(D, 3, ''); await c.API.sync(D);
  assert.deepStrictEqual(gas.call.get(D).players, []);
});

test('書式なしで作られた既存のタブ(本番と同じ状態)でも正しく動く', async () => {
  const gas = loadGas();
  // 旧バージョンが作ったタブ: テキスト書式なし → 日付が日付型に化ける
  const mk = (n, head) => { const s = gas.mock.ss.insertSheet(n); s.appendRow(head); };
  mk('ログ', ['id', 'ts', 'date', 'no', 'name', 'game', 'table', 'type', 'pt', 'by', 'deleted']);
  mk('名簿', ['date', 'no', 'name']); mk('設定', ['date', 'key', 'value']);
  const c = loadClient(gas);
  await c.API.register(D, 1, 'A'); await c.API.setConfig(D, { prizes: '60,40' });
  const st = await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  await c.API.sync(D);
  assert.ok(gas.mock.ss.getSheetByName('名簿').rows[1][0] instanceof Date, '名簿の日付は日付型に化けている');
  await c.API.register(D, 1, 'B'); await c.API.setConfig(D, { prizes: '70,40' }); await c.API.undo(D, st._lastId);
  await c.API.sync(D);
  const s = gas.call.get(D);
  assert.deepStrictEqual(s.players, [{ no: 1, name: 'B' }]);
  assert.strictEqual(s.config.prizes, '70,40');
  assert.strictEqual(s.txs.length, 0);
  assert.strictEqual(gas.mock.ss.getSheetByName('名簿').rows.length, 2, '名前変更で行が増えない');
  await c.API.clearDay(D);
  assert.strictEqual(gas.mock.ss.getSheetByName('名簿').rows.length, 1);
});

test('未同期の同じ番号の名前登録は最後の1件だけ送る', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  await c.API.register(D, 1, 'X'); await c.API.register(D, 1, 'Y');
  assert.strictEqual(c.API.view(D).pendingCount, 1);
  await c.API.sync(D);
  assert.strictEqual(gas.call.get(D).players[0].name, 'Y');
});

test('全消去で端末とシートの両方から消える', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  await c.API.register(D, 1, 'A'); await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 }); await c.API.sync(D);
  await c.API.clearDay(D);
  const s = gas.call.get(D);
  assert.strictEqual(s.txs.length + s.players.length, 0);
  assert.strictEqual(gas.mock.ss.getSheetByName(D), null);
  assert.strictEqual(c.API.view(D).txs.length, 0);
});

test('テストモード(GAS なし)でも同期ボタンで確定できる', async () => {
  const gas = loadGas(); const c = loadClient(gas, { local: true });
  await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  const s = await c.API.sync(D);
  assert.strictEqual(s.pendingCount, 0); assert.strictEqual(s.txs.length, 1);
});

test('別の日付の未同期分も同期で送られる', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  await c.API.addTx('2099-02-02', { no: 1, game: 'bac', type: 'in', pt: 10 });
  await c.API.sync(D);
  assert.strictEqual(gas.call.get('2099-02-02').txs.length, 1);
  assert.strictEqual(c.API.view(D).pendingTotal, 0);
});

test('返事が途切れた同期のあとで削除しても、シートからも消える', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  const st = await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  c.setLoseReply(true);
  await assert.rejects(c.API.sync(D));
  c.setLoseReply(false);
  assert.strictEqual(gas.call.get(D).txs.length, 1, 'シートには届いている');
  await c.API.undo(D, st._lastId);
  assert.strictEqual(c.API.view(D).txs.length, 0);
  await c.API.sync(D);
  assert.strictEqual(gas.call.get(D).txs.length, 0, '削除がシートにも届く');
  assert.strictEqual(c.API.view(D).txs.length, 0, '同期後も復活しない');
});

test('返事が途切れた入力を再送しても二重にならない', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  c.setLoseReply(true); await assert.rejects(c.API.sync(D)); c.setLoseReply(false);
  await c.API.sync(D);
  assert.strictEqual(gas.call.get(D).txs.length, 1);
});

test('営業日は朝6時で切り替わる(深夜0時をまたいでも同じ日)', async () => {
  const { K } = loadClient(loadGas());
  const jst = s => Date.parse(s + '+09:00');
  assert.strictEqual(K.todayJST(jst('2099-05-01T23:30:00')), '2099-05-01');
  assert.strictEqual(K.todayJST(jst('2099-05-02T02:00:00')), '2099-05-01');
  assert.strictEqual(K.todayJST(jst('2099-05-02T06:00:00')), '2099-05-02');
});

test('取り消しの id は自分の入力を指す', async () => {
  const gas = loadGas(); const c = loadClient(gas);
  const st = await c.API.addTx(D, { no: 1, game: 'bac', type: 'in', pt: 10 });
  assert.ok(st.txs.find(t => t.id === st._lastId));
});

(async () => {
  let ok = 0, ng = 0;
  for (const t of tests) {
    try { await t.fn(); ok++; console.log('  ✓ ' + t.name); }
    catch (e) { ng++; console.log('  ✗ ' + t.name + '\n    ' + (e && e.stack || e).split('\n').slice(0, 3).join('\n    ')); }
  }
  console.log(`\n${ok} passed, ${ng} failed`);
  process.exit(ng ? 1 : 0);
})();
