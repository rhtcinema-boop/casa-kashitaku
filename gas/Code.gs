/**
 * casa 貸卓 — Google Apps Script バックエンド
 *
 * このスクリプトはスプレッドシートに「コンテナバインド」で貼り付けて、
 * 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *   実行ユーザー: 自分 / アクセスできるユーザー: 全員
 * でデプロイし、表示された URL(…/exec)を config.js の GAS_URL に入れる。
 *
 * タブ構成(無ければ自動作成):
 *   ログ   … 全操作の追記ログ(取り消しは deleted=1)
 *   名簿   … 日付ごとの 会計番号→名前
 *   設定   … 日付ごとの トーナメント金額など
 *   YYYY-MM-DD … その日の集計表(「総収支」タブと同じ並び)。書き込みごとに作り直す
 */

var LOG_HEAD = ['id', 'ts', 'date', 'no', 'name', 'game', 'table', 'type', 'pt', 'by', 'deleted'];
var ROSTER_HEAD = ['date', 'no', 'name'];
var CONFIG_HEAD = ['date', 'key', 'value'];
var MAX_INS = 12; // IN 内訳の列数(総収支タブに合わせる)

function doGet(e) {
  var date = (e && e.parameter && e.parameter.date) || todayJST();
  return json(state(date));
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var date = body.date || todayJST();
    switch (body.op) {
      case 'register': register(date, body.no, body.name); break;
      case 'tx': addTx(date, body.tx, body.by); break;
      case 'undo': undo(date, body.id); break;
      case 'config': setConfig(date, body.config || {}); break;
      case 'newDay': ensureDaySheet(date); break;
      case 'clearDay': clearDay(date); break;
      case 'batch': batch(date, body.ops || [], body.by); break;
      default: return json({ error: 'unknown op: ' + body.op });
    }
    if (body.op !== "clearDay") renderDay(date);
    return json(state(date));
  } catch (err) {
    return json({ error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------- 読み出し ----------
function state(date) {
  var ss = SpreadsheetApp.getActive();
  var log = rowsOf(sheet(ss, 'ログ', LOG_HEAD));
  var roster = rowsOf(sheet(ss, '名簿', ROSTER_HEAD));
  var cfgRows = rowsOf(sheet(ss, '設定', CONFIG_HEAD));
  var txs = log.filter(function (r) { return r.date === date && !Number(r.deleted); }).map(function (r) {
    return { id: r.id, ts: Number(r.ts), date: r.date, no: Number(r.no), game: r.game, table: r.table || '', type: r.type, pt: Number(r.pt), by: r.by };
  });
  var players = roster.filter(function (r) { return r.date === date; }).map(function (r) { return { no: Number(r.no), name: String(r.name) }; });
  var config = { tourFee: 20, reentryFee: 20 };
  cfgRows.filter(function (r) { return r.date === date; }).forEach(function (r) { config[r.key] = isNaN(Number(r.value)) ? r.value : Number(r.value); });
  var dates = {};
  log.forEach(function (r) { dates[r.date] = 1; });
  roster.forEach(function (r) { dates[r.date] = 1; });
  dates[date] = 1;
  return { date: date, players: players, txs: txs, config: config, dates: Object.keys(dates).sort().reverse(), serverTime: Date.now() };
}

// ---------- 書き込み ----------
function register(date, no, name) {
  var sh = sheet(SpreadsheetApp.getActive(), '名簿', ROSTER_HEAD);
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (dstr(vals[i][0]) === date && Number(vals[i][1]) === Number(no)) {
      if (!name) sh.deleteRow(i + 1); else sh.getRange(i + 1, 3).setValue(name);
      return;
    }
  }
  if (name) sh.appendRow([date, Number(no), name]);
}

// まとめて反映(スマホの「同期」)。同じ id の入力は二重に記録しない
function batch(date, ops, by) {
  var ss = SpreadsheetApp.getActive();
  var logSh = sheet(ss, 'ログ', LOG_HEAD);
  var logVals = logSh.getDataRange().getValues();
  var idRow = {};
  for (var i = 1; i < logVals.length; i++) idRow[String(logVals[i][0])] = i + 1;
  var names = {};
  rowsOf(sheet(ss, '名簿', ROSTER_HEAD)).forEach(function (r) { if (r.date === date) names[Number(r.no)] = r.name; });
  var newRows = [], newIdx = {};
  ops.forEach(function (op) {
    if (op.op === 'register') { register(date, op.no, op.name); names[Number(op.no)] = op.name; }
    else if (op.op === 'config') setConfig(date, op.config || {});
    else if (op.op === 'tx') {
      var tx = op.tx || {}, id = String(tx.id || Utilities.getUuid());
      if (idRow[id] || newIdx[id] != null) return;
      var dealer = tx.game === 'dealer';
      newIdx[id] = newRows.length;
      newRows.push([id, Number(tx.ts) || Date.now(), date, dealer ? '' : Number(tx.no), dealer ? '' : (names[Number(tx.no)] || ''), tx.game, tx.table || '', tx.type, Number(tx.pt) || 0, tx.by || by || '', 0]);
    } else if (op.op === 'undo') {
      var uid = String(op.id);
      if (idRow[uid]) logSh.getRange(idRow[uid], 11).setValue(1);
      else if (newIdx[uid] != null) newRows[newIdx[uid]][10] = 1;
    }
  });
  if (newRows.length) {
    var start = logSh.getLastRow() + 1;
    logSh.getRange(start, 1, newRows.length, 3).setNumberFormat('@');
    logSh.getRange(start, 1, newRows.length, LOG_HEAD.length).setValues(newRows.map(function (r) { r[0] = String(r[0]); r[1] = String(r[1]); return r; }));
  }
}

function addTx(date, tx, by) {
  var ss = SpreadsheetApp.getActive();
  var sh = sheet(ss, 'ログ', LOG_HEAD);
  var name = '';
  if (tx.game !== 'dealer') {
    var roster = rowsOf(sheet(ss, '名簿', ROSTER_HEAD));
    roster.forEach(function (r) { if (r.date === date && Number(r.no) === Number(tx.no)) name = r.name; });
  }
  sh.appendRow([tx.id || Utilities.getUuid(), Date.now(), date, tx.game === 'dealer' ? '' : Number(tx.no), name, tx.game, tx.table || '', tx.type, Number(tx.pt), by || '', 0]);
}

function undo(date, id) {
  var sh = sheet(SpreadsheetApp.getActive(), 'ログ', LOG_HEAD);
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(id)) { sh.getRange(i + 1, 11).setValue(1); return; }
  }
}

function setConfig(date, config) {
  var sh = sheet(SpreadsheetApp.getActive(), '設定', CONFIG_HEAD);
  var vals = sh.getDataRange().getValues();
  Object.keys(config).forEach(function (k) {
    for (var i = 1; i < vals.length; i++) {
      if (dstr(vals[i][0]) === date && String(vals[i][1]) === k) { sh.getRange(i + 1, 3).setNumberFormat('@').setValue(String(config[k])); return; }
    }
    sh.appendRow([date, k, '']);
    sh.getRange(sh.getLastRow(), 1, 1, 3).setNumberFormat('@').setValues([[date, k, String(config[k])]]);
    vals.push([date, k, config[k]]);
  });
}

function clearDay(date) {
  var ss = SpreadsheetApp.getActive();
  ['ログ', '名簿', '設定'].forEach(function (n) {
    var sh = ss.getSheetByName(n); if (!sh) return;
    var vals = sh.getDataRange().getValues();
    for (var i = vals.length - 1; i >= 1; i--) {
      var dcol = n === 'ログ' ? 2 : 0;
      if (dstr(vals[i][dcol]) === date) sh.deleteRow(i + 1);
    }
  });
  var day = ss.getSheetByName(date); if (day) ss.deleteSheet(day);
}

// ---------- 日別タブの描画(総収支タブと同じ並び) ----------
function ensureDaySheet(date) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(date);
  if (!sh) { sh = ss.insertSheet(date, 0); }
  return sh;
}

function renderDay(date) {
  var st = state(date);
  var agg = aggregate(st.players, st.txs);
  var sh = ensureDaySheet(date);
  sh.clearContents();

  var head1 = ['番号', '名前', '', '合計収支', '', '番号', 'BACCARAT'];
  for (var i = 1; i < MAX_INS; i++) head1.push('');
  head1 = head1.concat(['', '', '', '', '番号', 'CASH']);
  for (i = 1; i < MAX_INS; i++) head1.push('');
  head1 = head1.concat(['', '', '', '', '番号', 'TOURNAMENT', '', '', '', '']);
  var head2 = ['', '', '', '', '', '', 'IN 内訳(万表記)'];
  for (i = 1; i < MAX_INS; i++) head2.push('');
  head2 = head2.concat(['IN 合計', 'OUT', '収支', '', '', 'IN 内訳(万表記)']);
  for (i = 1; i < MAX_INS; i++) head2.push('');
  head2 = head2.concat(['IN 合計', 'OUT', '収支', '', '', 'E数', 'IN合計', 'OUT', '収支', '順位']);

  var rows = [head1, head2];
  var blank = function (n) { var a = []; for (var k = 0; k < n; k++) a.push(''); return a; };
  var yen = function (pt) { return Math.round(pt * 10000); };
  var ins = function (arr) { var out = []; for (var k = 0; k < MAX_INS; k++) out.push(k < arr.length ? arr[k] : ''); if (arr.length > MAX_INS) { out[MAX_INS - 1] = arr.slice(MAX_INS - 1).reduce(function (a, b) { return a + b; }, 0); } return out; };
  agg.players.forEach(function (p) {
    var r = [p.no, p.name, '', yen(p.total), '', p.no].concat(ins(p.bac.ins), [yen(p.bac.in), yen(p.bac.out), yen(p.bac.pl), '', p.no], ins(p.cash.ins), [yen(p.cash.in), yen(p.cash.out), yen(p.cash.pl), '', p.no, p.tour.e + p.tour.re, yen(p.tour.in), yen(p.tour.out), yen(p.tour.pl), p.tour.rank || (p.tour.e + p.tour.re && !p.tour.alive ? '-' : '')]);
    rows.push(r);
  });
  // ディーラー行(バカラ卓・リング卓の補充/回収)
  var d = agg.dealer;
  var dealerTotal = d.bac.pl;
  rows.push(['', 'バカラディーラー', '', yen(dealerTotal), '', ''].concat(ins(d.bac.ins), [yen(d.bac.in), yen(d.bac.out), yen(d.bac.pl), '', ''], blank(MAX_INS), ['', '', '', '', '', '', '', '', '', '']));
  var t = agg.totals;
  rows.push(['差額', '', '', yen(t.players + dealerTotal), '', '合計'].concat(blank(MAX_INS), [yen(t.bac.in + d.bac.in), yen(t.bac.out + d.bac.out), yen(t.bac.pl + d.bac.pl), '', '合計'], blank(MAX_INS), [yen(t.cash.in), yen(t.cash.out), yen(t.cash.pl), '', '合計', t.tour.e + t.tour.re, yen(t.tour.in), yen(t.tour.out), yen(t.tour.pl), '']));

  var width = rows[0].length;
  rows = rows.map(function (r) { while (r.length < width) r.push(''); return r.slice(0, width); });
  sh.getRange(1, 1, rows.length, width).setValues(rows);
  sh.getRange(1, 1, 2, width).setFontWeight('bold');
  sh.getRange(3, 4, rows.length - 2, 1).setNumberFormat('#,##0');
  [MAX_INS + 7, MAX_INS + 8, MAX_INS + 9, 2 * MAX_INS + 12, 2 * MAX_INS + 13, 2 * MAX_INS + 14, 2 * MAX_INS + 18, 2 * MAX_INS + 19, 2 * MAX_INS + 20].forEach(function (c) {
    sh.getRange(3, c, rows.length - 2, 1).setNumberFormat('#,##0');
  });
  sh.setFrozenRows(2);
  sh.setFrozenColumns(2);
}

// model.js と同じ集計
function aggregate(players, txs) {
  var map = {};
  var mk = function (no, name) { return { no: no, name: name || '', bac: { ins: [], in: 0, out: 0, pl: 0 }, cash: { ins: [], in: 0, out: 0, pl: 0 }, tour: { e: 0, re: 0, ins: [], in: 0, out: 0, pl: 0, alive: false, rank: '' }, total: 0 }; };
  players.forEach(function (p) { map[p.no] = mk(p.no, p.name); });
  var dealer = { bac: { ins: [], in: 0, out: 0, pl: 0 }, cash: { ins: [], in: 0, out: 0, pl: 0 } };
  txs.slice().sort(function (a, b) { return a.ts - b.ts; }).forEach(function (t) {
    var pt = Number(t.pt) || 0;
    if (t.game === 'dealer') {
      var tbl = t.table === 'cash' ? dealer.cash : dealer.bac;
      if (t.type === 'in') { tbl.ins.push(pt); tbl.in += pt; } else tbl.out += pt;
      return;
    }
    if (!map[t.no]) map[t.no] = mk(t.no, '');
    var p = map[t.no];
    if (t.game === 'tour') {
      if (t.type === 'entry') { p.tour.e++; p.tour.ins.push(pt); p.tour.in += pt; p.tour.alive = true; }
      else if (t.type === 'reentry') { p.tour.re++; p.tour.ins.push(pt); p.tour.in += pt; p.tour.alive = true; }
      else if (t.type === 'bust') p.tour.alive = false;
      else { p.tour.out += pt; p.tour.alive = false; if (t.table) p.tour.rank = t.table; }
    } else if (p[t.game]) {
      if (t.type === 'in') { p[t.game].ins.push(pt); p[t.game].in += pt; } else p[t.game].out += pt;
    }
  });
  var list = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a.no - b.no; });
  list.forEach(function (p) {
    p.bac.pl = p.bac.out - p.bac.in; p.cash.pl = p.cash.out - p.cash.in; p.tour.pl = p.tour.out - p.tour.in;
    p.total = p.bac.pl + p.cash.pl + p.tour.pl;
  });
  dealer.bac.pl = dealer.bac.out - dealer.bac.in; dealer.cash.pl = dealer.cash.out - dealer.cash.in;
  var sum = function (k, f) { return list.reduce(function (a, p) { return a + f(p[k]); }, 0); };
  var totals = {
    bac: { in: sum('bac', function (s) { return s.in; }), out: sum('bac', function (s) { return s.out; }) },
    cash: { in: sum('cash', function (s) { return s.in; }), out: sum('cash', function (s) { return s.out; }) },
    tour: { e: sum('tour', function (s) { return s.e; }), re: sum('tour', function (s) { return s.re; }), in: sum('tour', function (s) { return s.in; }), out: sum('tour', function (s) { return s.out; }) },
  };
  ['bac', 'cash', 'tour'].forEach(function (k) { totals[k].pl = totals[k].out - totals[k].in; });
  totals.players = totals.bac.pl + totals.cash.pl + totals.tour.pl;
  return { players: list, dealer: dealer, totals: totals };
}

// ---------- ユーティリティ ----------
function sheet(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(head); sh.setFrozenRows(1); sh.getRange("A:C").setNumberFormat("@"); }
  return sh;
}
function rowsOf(sh) {
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  var head = vals[0];
  return vals.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {}; head.forEach(function (h, i) { o[h] = r[i] instanceof Date ? r[i].getTime() : r[i]; if (h === 'date' && r[i] instanceof Date) o[h] = Utilities.formatDate(r[i], 'Asia/Tokyo', 'yyyy-MM-dd'); }); return o;
  });
}
function dstr(v) { return v instanceof Date ? Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd") : String(v); }
function todayJST() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }
function json(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
