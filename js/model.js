// casa 貸卓 — 集計ロジック(スマホ・PC・GAS で共通の考え方)
// tx: { id, ts, date, no, game: 'bac'|'cash'|'tour'|'dealer', type: 'in'|'out'|'entry'|'reentry'|'prize', pt(万), by }
// 1万 = 1万円。IN は買い込み/エントリー、OUT は精算/賞金。ディーラーは game='dealer' で IN=補充(+/-)、OUT=回収。
(function (g) {
  const GAMES = { bac: 'バカラ', cash: 'リング', tour: 'トーナメント', dealer: 'バカラディーラー' };
  const TYPES = { in: 'IN', out: 'OUT', entry: 'エントリー', reentry: 'リエントリー', prize: '賞金', bust: '飛び', home: '帰宅' };

  function emptyPlayer(no, name) {
    return {
      no, name: name || '',
      bac: { ins: [], in: 0, out: 0, pl: 0, done: false },
      cash: { ins: [], in: 0, out: 0, pl: 0, done: false },
      tour: { e: 0, re: 0, ins: [], in: 0, out: 0, pl: 0, alive: false, rank: '' },
      total: 0,
      home: false,   // 帰宅ボタンを押した(また IN・エントリーしたら在店に戻る)
    };
  }

  // players: [{no,name}], txs: [tx] (deleted 除外済み), config: {tourFee, reentryFee}
  function aggregate(players, txs, config) {
    const map = new Map();
    players.forEach(p => map.set(Number(p.no), emptyPlayer(Number(p.no), p.name)));
    const dealer = { bac: { ins: [], in: 0, out: 0, pl: 0 }, cash: { ins: [], in: 0, out: 0, pl: 0 } };
    const sorted = [...txs].sort((a, b) => a.ts - b.ts);
    for (const t of sorted) {
      const pt = Number(t.pt) || 0;
      if (t.game === 'dealer') {
        const tbl = t.table === 'cash' ? dealer.cash : dealer.bac;
        if (t.type === 'in') { tbl.ins.push(pt); tbl.in += pt; } else tbl.out += pt;
        continue;
      }
      const no = Number(t.no);
      if (!map.has(no)) map.set(no, emptyPlayer(no, ''));
      const p = map.get(no);
      if (t.type === 'home') { p.home = true; continue; }
      if (t.type === 'in' || t.type === 'entry' || t.type === 'reentry') p.home = false;
      if (t.game === 'tour') {
        if (t.type === 'entry') { p.tour.e += 1; p.tour.ins.push(pt); p.tour.in += pt; p.tour.alive = true; }
        else if (t.type === 'reentry') { p.tour.re += 1; p.tour.ins.push(pt); p.tour.in += pt; p.tour.alive = true; }
        else if (t.type === 'bust') p.tour.alive = false;
        else if (t.type === 'prize' || t.type === 'out') { p.tour.out += pt; p.tour.alive = false; if (t.table) p.tour.rank = t.table; }
      } else if (t.game === 'bac' || t.game === 'cash') {
        const s = p[t.game];
        if (t.type === 'in') { s.ins.push(pt); s.in += pt; s.done = false; } else if (t.type === 'out') { s.out += pt; s.done = true; } // OUT したら終了、また IN したら復帰
      }
    }
    const rd = v => Math.round(v * 1000) / 1000; // 小数の賞金(166.8万など)の足し算誤差を消す
    for (const p of map.values()) {
      for (const k of ['bac', 'cash', 'tour']) { p[k].in = rd(p[k].in); p[k].out = rd(p[k].out); p[k].pl = rd(p[k].out - p[k].in); }
      p.total = rd(p.bac.pl + p.cash.pl + p.tour.pl);
    }
    dealer.bac.pl = dealer.bac.out - dealer.bac.in;
    dealer.cash.pl = dealer.cash.out - dealer.cash.in;
    const list = [...map.values()].sort((a, b) => a.no - b.no);
    const sum = (k, f) => list.reduce((a, p) => a + f(p[k]), 0);
    const totals = {
      bac: { in: sum('bac', s => s.in), out: sum('bac', s => s.out) },
      cash: { in: sum('cash', s => s.in), out: sum('cash', s => s.out) },
      tour: { e: sum('tour', s => s.e), re: sum('tour', s => s.re), in: sum('tour', s => s.in), out: sum('tour', s => s.out) },
    };
    for (const k of ['bac', 'cash', 'tour']) { totals[k].in = rd(totals[k].in); totals[k].out = rd(totals[k].out); totals[k].pl = rd(totals[k].out - totals[k].in); } // プレイヤー側収支
    totals.players = rd(totals.bac.pl + totals.cash.pl + totals.tour.pl);
    totals.house = -totals.players; // 店側
    totals.tourPool = totals.tour.in; // プライズプール(万)
    totals.tour.active = list.filter(p => p.tour.alive).length; // 残り人数
    totals.tour.players = list.filter(p => p.tour.e + p.tour.re > 0).length;
    return { players: list, dealer, totals, config: config || {} };
  }

  function fmtPt(pt) { pt = pt || 0; return (pt < 0 ? '-' : '') + Math.abs(pt).toLocaleString('ja-JP') + '万'; }
  function fmtYen(pt, pointYen) { const y = Math.round(pt * (pointYen || 10000)); return (y < 0 ? '-' : '') + '¥' + Math.abs(y).toLocaleString('ja-JP'); }
  function signedPt(pt) { return (pt > 0 ? '+' : '') + fmtPt(pt); }
  function signedYen(pt, py) { return (pt > 0 ? '+' : '') + fmtYen(pt, py); }
  // 営業日(日本時間)。朝6時までは前の日として扱う(深夜0時をまたいでも同じ日)
  const DAY_CUTOFF_HOUR = 6;
  function todayJST(now) {
    const d = new Date((now || Date.now()) + (9 - DAY_CUTOFF_HOUR) * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function describeTx(t) {
    const g = GAMES[t.game] || t.game;
    if (t.game === 'dealer') return `バカラディーラー チップ${t.type === 'in' ? '補充' : '回収'} ${signedPt(t.pt)}`;
    if (t.type === 'home') return '帰宅';
    if (t.type === 'bust') return `${g} 飛び`;
    if (t.type === 'prize' && t.table) return `${g} ${t.table} 賞金 ${fmtPt(t.pt)}`;
    return `${g} ${TYPES[t.type] || t.type} ${fmtPt(t.pt)}`;
  }

  // プライズ: config.prizes は "203,149,105" のようなカンマ区切り(万)
  function parsePrizes(config) {
    const s = String((config || {}).prizes || '').trim();
    if (!s) return [];
    return s.split(',').map(v => Number(String(v).trim())).filter(v => !isNaN(v));
  }
  const rankLabel = i => ['1st', '2nd', '3rd'][i] || `${i + 1}th`;

  // プライズの傾斜計算(単位: 万。内部は円の整数で計算)
  // X = 入賞人数、Y = 最下位の賞金。元のシート「プライズ」タブと同じ規則:
  //   下から 1,2,3,4,5,6… 番目 = Y + 0a, 1a, 3a, 6a, 10a, 15a …(重みは三角数 k(k+1)/2。上に行くほど差が広がる)
  //   a は合計がプールになるよう自動で決める(重みの合計 = (X-1)X(X+1)/6)。
  // 1位以外は 5万円単位に切り捨て(万の位 0〜4 → 0、5〜9 → 5)、切り捨てた分はすべて 1位に足す。
  // 戻り値: { prizes: [1位, 2位, …](万), a(万), error }
  function calcPrizes(poolMan, X, Y) {
    const pool = Math.round(poolMan * 10000), y = Math.round(Y * 10000);
    X = Math.floor(X);
    if (!(X >= 1)) return { prizes: [], a: 0, error: '入賞人数を1人以上にしてください' };
    if (!(pool > 0)) return { prizes: [], a: 0, error: 'まだエントリーがありません' };
    if (X === 1) return { prizes: [pool / 10000], a: 0, error: '' };
    const weight = k => k * (k + 1) / 2;                       // 下から k 番目(0 始まり)の重み
    const steps = (X - 1) * X * (X + 1) / 6;                   // 重みの合計(X=6 なら 35)
    const aYen = (pool - X * y) / steps;
    if (aYen < 0) return { prizes: [], a: aYen / 10000, error: `最低賞金が高すぎます(最大 ${Math.floor(pool / X / 10000)}万)` };
    const bottomUp = [];
    for (let k = 0; k < X; k++) bottomUp.push(y + weight(k) * aYen);
    const top = bottomUp.reverse();                               // [1位, 2位, …]
    const UNIT = 50000;                                              // 5万円
    const rest = top.slice(1).map(v => Math.floor(v / UNIT) * UNIT); // 1位以外: 5万円単位に切り捨て
    const first = pool - rest.reduce((s, v) => s + v, 0);           // 余りは 1位へ
    return { prizes: [first, ...rest].map(v => v / 10000), a: aYen / 10000, error: '' };
  }
  // 万の小数(0.1 = 1,000円)を見やすく
  const round1 = v => Math.round(v * 10) / 10;

  g.Kashitaku = { GAMES, TYPES, aggregate, emptyPlayer, fmtPt, fmtYen, signedPt, signedYen, todayJST, describeTx, parsePrizes, rankLabel, calcPrizes, round1 };
})(typeof window !== 'undefined' ? window : globalThis);
