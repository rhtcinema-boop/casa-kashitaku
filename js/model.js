// casa 貸卓 — 集計ロジック(スマホ・PC・GAS で共通の考え方)
// tx: { id, ts, date, no, game: 'bac'|'cash'|'tour'|'dealer', type: 'in'|'out'|'entry'|'reentry'|'prize', pt(万), by }
// 1万 = 1万円。IN は買い込み/エントリー、OUT は精算/賞金。ディーラーは game='dealer' で IN=補充(+/-)、OUT=回収。
(function (g) {
  const GAMES = { bac: 'バカラ', cash: 'リング', tour: 'トーナメント', dealer: 'ディーラー' };
  const TYPES = { in: 'IN', out: 'OUT', entry: 'エントリー', reentry: 'リエントリー', prize: '賞金' };

  function emptyPlayer(no, name) {
    return {
      no, name: name || '',
      bac: { ins: [], in: 0, out: 0, pl: 0 },
      cash: { ins: [], in: 0, out: 0, pl: 0 },
      tour: { e: 0, re: 0, ins: [], in: 0, out: 0, pl: 0 },
      total: 0,
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
      if (t.game === 'tour') {
        if (t.type === 'entry') { p.tour.e += 1; p.tour.ins.push(pt); p.tour.in += pt; }
        else if (t.type === 'reentry') { p.tour.re += 1; p.tour.ins.push(pt); p.tour.in += pt; }
        else if (t.type === 'prize' || t.type === 'out') p.tour.out += pt;
      } else if (t.game === 'bac' || t.game === 'cash') {
        const s = p[t.game];
        if (t.type === 'in') { s.ins.push(pt); s.in += pt; } else if (t.type === 'out') s.out += pt;
      }
    }
    for (const p of map.values()) {
      p.bac.pl = p.bac.out - p.bac.in;
      p.cash.pl = p.cash.out - p.cash.in;
      p.tour.pl = p.tour.out - p.tour.in;
      p.total = p.bac.pl + p.cash.pl + p.tour.pl;
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
    for (const k of ['bac', 'cash', 'tour']) totals[k].pl = totals[k].out - totals[k].in; // プレイヤー側収支
    totals.players = totals.bac.pl + totals.cash.pl + totals.tour.pl;
    totals.house = -totals.players; // 店側
    totals.tourPool = totals.tour.in; // プライズプール(万)
    return { players: list, dealer, totals, config: config || {} };
  }

  function fmtPt(pt) { pt = pt || 0; return (pt < 0 ? '-' : '') + Math.abs(pt).toLocaleString('ja-JP') + '万'; }
  function fmtYen(pt, pointYen) { const y = pt * (pointYen || 10000); return (y < 0 ? '-' : '') + '¥' + Math.abs(y).toLocaleString('ja-JP'); }
  function signedPt(pt) { return (pt > 0 ? '+' : '') + fmtPt(pt); }
  function signedYen(pt, py) { return (pt > 0 ? '+' : '') + fmtYen(pt, py); }
  function todayJST() {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function describeTx(t) {
    const g = GAMES[t.game] || t.game;
    if (t.game === 'dealer') return `ディーラー チップ${t.type === 'in' ? '補充' : '回収'} ${signedPt(t.pt)}`;
    return `${g} ${TYPES[t.type] || t.type} ${fmtPt(t.pt)}`;
  }

  // プライズ: config.prizes は "203,149,105" のようなカンマ区切り(万)
  function parsePrizes(config) {
    const s = String((config || {}).prizes || '').trim();
    if (!s) return [];
    return s.split(',').map(v => Number(String(v).trim())).filter(v => !isNaN(v));
  }
  const rankLabel = i => ['1st', '2nd', '3rd'][i] || `${i + 1}th`;

  g.Kashitaku = { GAMES, TYPES, aggregate, emptyPlayer, fmtPt, fmtYen, signedPt, signedYen, todayJST, describeTx, parsePrizes, rankLabel };
})(typeof window !== 'undefined' ? window : globalThis);
