// casa バカラ罫線 — 計算・描画・モニター同期(road.html と monitor.html で共通)
(function (g) {
  // ---------- 計算 ----------
  function analyze(hands) {
    const cols = []; let lead = 0;
    for (const h of hands) {
      if (h.r === 'T') { if (cols.length) { const c = cols[cols.length - 1]; c[c.length - 1].ties++; } else lead++; continue; }
      const e = { r: h.r, ties: 0, bp: h.bp, pp: h.pp, nat: h.nat }, last = cols[cols.length - 1];
      if (last && last[0].r === h.r) last.push(e); else cols.push([e]);
    }
    if (cols.length) cols[0][0].ties += lead;
    const der = { 1: [], 2: [], 3: [] }, lens = [];
    cols.forEach((col, c) => col.forEach((_, r) => { lens[c] = r + 1; for (const k of [1, 2, 3]) { const v = derive(lens, c, r, k); if (v) der[k].push(v); } }));
    return { cols, der, lens, lead };
  }
  // 下三路: k=1 大眼仔, 2 小路, 3 小強路。R=赤, L=青
  function derive(lens, c, r, k) {
    if (r === 0) { if (c - 1 - k < 0) return null; return lens[c - 1] === lens[c - 1 - k] ? 'R' : 'L'; }
    if (c - k < 0) return null;
    return lens[c - k] === r ? 'L' : 'R';
  }
  function predict(a, w) {
    const L = a.lens.slice(); let c, r;
    if (a.cols.length && a.cols[a.cols.length - 1][0].r === w) { c = a.cols.length - 1; r = L[c]; } else { c = a.cols.length; r = 0; }
    L[c] = r + 1;
    return [1, 2, 3].map(k => derive(L, c, r, k));
  }
  function group(seq) { const out = []; for (const v of seq) { const l = out[out.length - 1]; if (l && l[0].v === v) l.push({ v }); else out.push([{ v }]); } return out; }
  // 6段で下が埋まったら右へ曲げる(ドラゴンテール)
  function place(cols, rows = 6) {
    const occ = new Set(), cells = []; let start = -1, maxc = -1;
    for (const col of cols) {
      let c = start + 1; while (occ.has(c + ',0')) c++; start = c;
      let r = 0, turned = false;
      col.forEach((e, i) => {
        if (i > 0) { if (!turned && r + 1 < rows && !occ.has(c + ',' + (r + 1))) r++; else { turned = true; c++; } }
        occ.add(c + ',' + r); cells.push({ c, r, e }); maxc = Math.max(maxc, c);
      });
    }
    return { cells, ncols: maxc + 1 };
  }
  function counts(hands) {
    const n = { B: 0, P: 0, T: 0, bp: 0, pp: 0, nat: 0 };
    hands.forEach(h => { n[h.r]++; if (h.bp) n.bp++; if (h.pp) n.pp++; if (h.nat) n.nat++; });
    return n;
  }

  // ---------- 描画 ----------
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif';
  // box を渡すと、その幅いっぱいまでマス目を引く。cols は最低限の列数
  function setup(cv, cols, rows, cell, box) {
    const fit = box ? Math.floor((box.clientWidth - 1) / cell) : 0;
    const n = Math.max(cols + 1, fit, 1), W = n * cell, H = rows * cell, d = window.devicePixelRatio || 1;
    cv.width = (W + 1) * d; cv.height = (H + 1) * d; cv.style.width = (W + 1) + 'px'; cv.style.height = (H + 1) + 'px';
    const x = cv.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, W + 1, H + 1);
    x.strokeStyle = css('--grid'); x.lineWidth = 1;
    for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * cell + .5, 0); x.lineTo(i * cell + .5, H + 1); x.stroke(); }
    for (let i = 0; i <= rows; i++) { x.beginPath(); x.moveTo(0, i * cell + .5); x.lineTo(W + 1, i * cell + .5); x.stroke(); }
    return x;
  }
  const colorOf = v => css(v === 'B' || v === 'R' ? '--banker' : v === 'P' || v === 'L' ? '--player' : '--green');
  function pairs(x, px, py, s, e) {
    const rad = Math.max(2.5, s * .11);
    if (e.bp) { x.fillStyle = css('--banker'); x.beginPath(); x.arc(px + s * .2, py + s * .2, rad, 0, 7); x.fill(); }
    if (e.pp) { x.fillStyle = css('--player'); x.beginPath(); x.arc(px + s * .8, py + s * .8, rad, 0, 7); x.fill(); }
    if (e.nat) { // ナチュラル: 右上に黄色の星
      const cx = px + s * .8, cy = py + s * .2, R = Math.max(3.5, s * .15), r2 = R * .45;
      x.fillStyle = css('--natural'); x.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r2 : R; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      x.closePath(); x.fill(); x.lineWidth = Math.max(1, s * .03); x.strokeStyle = 'rgba(0,0,0,.55)'; x.stroke();
    }
  }
  function mark(x, kind, v, px, py, s) {
    const cx = px + s / 2, cy = py + s / 2, c = colorOf(v);
    x.strokeStyle = c; x.fillStyle = c;
    if (kind === 'ring') { x.lineWidth = Math.max(2.4, s * .15); x.beginPath(); x.arc(cx, cy, s * .32, 0, 7); x.stroke(); }
    else if (kind === 'dot') { x.beginPath(); x.arc(cx, cy, s * .36, 0, 7); x.fill(); }
    else { x.lineWidth = Math.max(2.6, s * .18); x.lineCap = 'round'; x.beginPath(); x.moveTo(px + s * .24, py + s * .76); x.lineTo(px + s * .76, py + s * .24); x.stroke(); }
  }
  function drawBead(cv, hands, s, box, minCols) {
    const rows = 6, n = Math.ceil(hands.length / rows);
    const x = setup(cv, Math.max(n - 1, minCols || 0), rows, s, box);
    x.font = `800 ${Math.round(s * .46)}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    hands.forEach((h, i) => {
      const px = Math.floor(i / rows) * s + .5, py = (i % rows) * s + .5;
      x.fillStyle = colorOf(h.r); x.beginPath(); x.arc(px + s / 2, py + s / 2, s * .4, 0, 7); x.fill();
      x.fillStyle = '#fff'; x.fillText(h.r, px + s / 2, py + s / 2 + 1); pairs(x, px, py, s, h);
    });
  }
  function drawBig(cv, a, s, box) {
    const p = place(a.cols), x = setup(cv, p.ncols, 6, s, box);
    const lastCell = p.cells[p.cells.length - 1];
    p.cells.forEach(({ c, r, e }) => {
      const px = c * s + .5, py = r * s + .5; mark(x, 'ring', e.r, px, py, s);
      if (e.ties) {
        x.strokeStyle = css('--green'); x.lineWidth = Math.max(3, s * .13); x.lineCap = 'round';
        x.beginPath(); x.moveTo(px + s * .22, py + s * .78); x.lineTo(px + s * .78, py + s * .22); x.stroke();
        if (e.ties > 1) { x.fillStyle = css('--green'); x.font = `800 ${Math.round(s * .4)}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(e.ties, px + s / 2, py + s / 2 + 1); }
      }
      pairs(x, px, py, s, e);
    });
    return lastCell ? { x: lastCell.c * s, y: lastCell.r * s, s } : null;
  }
  function drawDerived(cv, seq, kind, s, box) {
    const p = place(group(seq)), x = setup(cv, p.ncols, 6, s, box);
    p.cells.forEach(({ c, r, e }) => mark(x, kind, e.v, c * s + .5, r * s + .5, s));
  }
  function drawAsk(cv, pr, s) {
    const d = window.devicePixelRatio || 1;
    cv.width = 3 * s * d; cv.height = s * d; cv.style.width = 3 * s + 'px'; cv.style.height = s + 'px';
    const x = cv.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, 3 * s, s);
    ['ring', 'dot', 'slash'].forEach((k, i) => {
      if (pr[i]) mark(x, k, pr[i], i * s, 0, s);
      else { x.fillStyle = css('--text2'); x.beginPath(); x.arc(i * s + s / 2, s / 2, 2, 0, 7); x.fill(); }
    });
    const words = pr.map(v => v === 'R' ? '赤' : v === 'L' ? '青' : '－').join('・');
    cv.setAttribute('aria-label', '大眼仔・小路・小強路 ' + words);
    return words;
  }
  // 罫線を右端(最新)までスクロール。マス目の境目にそろえる
  function scrollEnd(el, cell) { el.scrollLeft = Math.ceil(Math.max(0, el.scrollWidth - el.clientWidth) / cell) * cell; }

  // ---------- モニター同期(貸卓の Apps Script に保存) ----------
  // 1ゲーム1文字: a〜x = 結果(B/P/T)×8 + ナチュラル×4 + Bペア×2 + Pペア
  const R3 = ['B', 'P', 'T'];
  const encode = hands => hands.map(h => String.fromCharCode(97 + R3.indexOf(h.r) * 8 + (h.nat ? 4 : 0) + (h.bp ? 2 : 0) + (h.pp ? 1 : 0))).join('');
  const decode = s => [...(s || '')].map(ch => { const n = ch.charCodeAt(0) - 97; return { r: R3[n >> 3], nat: !!(n & 4), bp: !!(n & 2), pp: !!(n & 1) }; }).filter(h => h.r);
  const URL_ = (g.KASHITAKU_CONFIG || {}).GAS_URL || '';
  async function timed(url, init, ms) {
    // 古いブラウザ(AbortController なし)では時間切れなしで送る
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), ms || 8000) : 0;
    try { return await fetch(url, ctl ? Object.assign({ signal: ctl.signal }, init) : init); } finally { clearTimeout(t); }
  }
  async function pull() {
    if (!URL_) throw new Error('no server');
    const r = await timed(`${URL_}?road=1&_=${Date.now()}`, { cache: 'no-store' });
    const j = await r.json(); if (j.error) throw new Error(j.error);
    return { hands: decode(j.hands), rev: j.rev || 0, ts: j.ts || 0 };
  }
  async function push(hands) {
    if (!URL_) throw new Error('no server');
    const r = await timed(URL_, { method: 'POST', body: JSON.stringify({ op: 'road', hands: encode(hands) }), headers: { 'Content-Type': 'text/plain;charset=utf-8' } }, 15000);
    const j = await r.json(); if (j.error) throw new Error(j.error);
    return j;
  }

  g.Road = { analyze, predict, counts, drawBead, drawBig, drawDerived, drawAsk, scrollEnd, encode, decode, pull, push, hasServer: !!URL_ };
})(window);
