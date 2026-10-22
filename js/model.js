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
    dealer.bac.in = rd(dealer.bac.in); dealer.bac.out = rd(dealer.bac.out); dealer.bac.pl = rd(dealer.bac.out - dealer.bac.in);
    totals.bacDiff = rd(totals.bac.pl + dealer.bac.pl);  // バカラ: プレイヤー収支合計 + ディーラー収支(合っていれば 0)
    totals.allDiff = rd(totals.players + dealer.bac.pl); // 全体の差額(元シートの「差額」行と同じ)
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

  // ---------- バカラ 3枚目の判定(標準ルール・サイドベットなし) ----------
  // p, b: プレイヤー/バンカーのカードの点(A=1, 2〜9, 10・J・Q・K=0)を配った順に
  // 配る順: P1 → B1 → P2 → B2 → (P3) → (B3)
  // 戻り値: { need: 'p'|'b'|null, step: 次に入れるカードの説明, reasons: [判定の理由], done, pt, bt, winner, banker6, natural }
  const bacTotal = cards => cards.reduce((a, c) => a + c, 0) % 10;
  function bacNext(p, b) {
    const r = { need: null, step: '', reasons: [], done: false, pt: bacTotal(p), bt: bacTotal(b), winner: '', banker6: false, natural: false };
    if (p.length < 1) return Object.assign(r, { need: 'p', step: 'プレイヤー 1枚目' });
    if (b.length < 1) return Object.assign(r, { need: 'b', step: 'バンカー 1枚目' });
    if (p.length < 2) return Object.assign(r, { need: 'p', step: 'プレイヤー 2枚目' });
    if (b.length < 2) return Object.assign(r, { need: 'b', step: 'バンカー 2枚目' });
    const pt2 = bacTotal(p.slice(0, 2)), bt2 = bacTotal(b.slice(0, 2));
    if (pt2 >= 8 || bt2 >= 8) {
      r.natural = true;
      r.reasons.push(`ナチュラル(${pt2 >= 8 ? 'プレイヤー ' + pt2 : ''}${pt2 >= 8 && bt2 >= 8 ? '・' : ''}${bt2 >= 8 ? 'バンカー ' + bt2 : ''})→ どちらも引かない`);
      return finish(r, p.slice(0, 2), b.slice(0, 2));
    }
    // プレイヤー: 0〜5 は引く、6・7 は引かない
    let p3 = null;
    if (pt2 <= 5) {
      r.reasons.push(`プレイヤー ${pt2} → 引く(0〜5 は引く)`);
      if (p.length < 3) return Object.assign(r, { need: 'p', step: 'プレイヤー 3枚目' });
      p3 = p[2];
    } else r.reasons.push(`プレイヤー ${pt2} → 引かない(6・7 は引かない)`);
    // バンカー
    let bDraw, why;
    if (p3 === null) { bDraw = bt2 <= 5; why = bDraw ? '(プレイヤーが引かないとき、0〜5 は引く)' : '(プレイヤーが引かないとき、6・7 は引かない)'; }
    else if (bt2 <= 2) { bDraw = true; why = '(0〜2 はいつも引く)'; }
    else if (bt2 === 3) { bDraw = p3 !== 8; why = '(3 はプレイヤーの3枚目が 8 以外なら引く)'; }
    else if (bt2 === 4) { bDraw = p3 >= 2 && p3 <= 7; why = '(4 はプレイヤーの3枚目が 2〜7 なら引く)'; }
    else if (bt2 === 5) { bDraw = p3 >= 4 && p3 <= 7; why = '(5 はプレイヤーの3枚目が 4〜7 なら引く)'; }
    else if (bt2 === 6) { bDraw = p3 === 6 || p3 === 7; why = '(6 はプレイヤーの3枚目が 6・7 なら引く)'; }
    else { bDraw = false; why = '(7 は引かない)'; }
    r.reasons.push(`バンカー ${bt2}${p3 !== null ? `・プレイヤーの3枚目 ${p3}` : ''} → ${bDraw ? '引く' : '引かない'}${why}`);
    if (bDraw && b.length < 3) return Object.assign(r, { need: 'b', step: 'バンカー 3枚目' });
    return finish(r, p.slice(0, p3 === null ? 2 : 3), b.slice(0, bDraw ? 3 : 2));
  }
  function finish(r, p, b) {
    r.done = true; r.pt = bacTotal(p); r.bt = bacTotal(b);
    r.winner = r.pt > r.bt ? 'player' : r.bt > r.pt ? 'banker' : 'tie';
    r.banker6 = r.winner === 'banker' && r.bt === 6; // バンカー6 で勝ち → 配当は半分
    return r;
  }

  // 入れ方を簡単にした版: 最初の2枚は「合計(0〜9)」だけ、3枚目からは引いたカードの数字(0〜9)
  // pt, bt: 2枚の合計、p3, b3: 3枚目の数字(未入力は null)
  function bacNext2(pt, bt, p3, b3) {
    if (pt == null) return { need: 'pt', step: 'プレイヤー 2枚の合計', reasons: [], done: false };
    if (bt == null) return { need: 'bt', step: 'バンカー 2枚の合計', reasons: [], done: false };
    const r = bacNext([pt, 0].concat(p3 == null ? [] : [p3]), [bt, 0].concat(b3 == null ? [] : [b3]));
    if (r.need === 'p') { r.need = 'p3'; r.step = 'プレイヤーが引いた3枚目の数字'; }
    if (r.need === 'b') { r.need = 'b3'; r.step = 'バンカーが引いた3枚目の数字'; }
    return r;
  }

  g.Kashitaku = { GAMES, TYPES, aggregate, emptyPlayer, fmtPt, fmtYen, signedPt, signedYen, todayJST, describeTx, parsePrizes, rankLabel, calcPrizes, round1, bacNext, bacNext2, bacTotal };
})(typeof window !== 'undefined' ? window : globalThis);
