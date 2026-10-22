// casa 貸卓 — スマホ入力画面
(() => {
  const K = Kashitaku, API = KashitakuAPI, CFG = KASHITAKU_CONFIG;
  const PY = CFG.POINT_YEN || 10000;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cls = v => v > 0 ? 'plus' : v < 0 ? 'minus' : 'zero';

  // 日付: 基本は今日(営業日)。設定で変えた日付は、その営業日のあいだだけ有効
  let date = (() => {
    try { const s = JSON.parse(localStorage.getItem('kt.date2') || 'null'); if (s && s.on === K.todayJST() && s.date) return s.date; } catch (e) { }
    return K.todayJST();
  })();
  let game = 'bac';
  let state = null, agg = null;
  let tab = 'input';
  let openNo = null;     // シートで開いている番号
  let lastTx = null;     // トーストの取り消し用
  let busy = false;
  let rosterSig = null;

  // ---------- 読み込み ----------
  async function refresh(st) {
    state = st || API.view(date);
    agg = K.aggregate(state.players, state.txs, state.config);
    setStatus();
    render();
    if (st) scheduleSync(); // 入力・削除・設定のあとは自動で送る
  }
  // ---------- 同期(自動) ----------
  // 入力が止まって2秒後に送信、15秒ごとに他の端末の入力を取り込む。同期ボタンで今すぐも可。
  let syncAgain = false, syncTimer = null, manualSync = false, lastSyncError = false;
  function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => doSync(true), 2000); }
  async function doSync(quiet) {
    if (!quiet) manualSync = true;
    if (API.isSyncing()) { syncAgain = true; setStatus(); return; } // 終わったらもう一度
    clearTimeout(syncTimer);
    const d0 = date;
    const promise = API.sync(date);
    setStatus();
    try {
      await promise;
      lastSyncError = false;
      safeRender(); // 同期中に日付が変わっても、今の日付を表示する
      if (manualSync) toast('同期しました', '他の端末と同じ状態です');
    } catch (e) {
      lastSyncError = true;
      safeRender();
      if (manualSync) toast('同期できませんでした', '入力は端末に残っています。電波が戻ると自動で送ります', true);
    }
    manualSync = false;
    if (syncAgain || date !== d0) { syncAgain = false; doSync(true); }
    else setStatus();
  }
  // 「消す?」の確認中は画面を作り直さない(押し間違い防止)
  function safeRender() {
    const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (typing || document.querySelector('[data-del].arm')) { state = API.view(date); agg = K.aggregate(state.players, state.txs, state.config); setStatus(); return; }
    refresh();
  }
  const hm = t => new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  function setStatus() {
    const n = state.pendingTotal || 0, btn = $('#syncBtn');
    btn.classList.toggle('dirty', n > 0);
    const busyNow = API.isSyncing() && (manualSync || n > 0);
    btn.classList.toggle('spin', busyNow);
    btn.classList.toggle('err', lastSyncError && n > 0);
    $('#syncCount').textContent = busyNow ? '送信中…' : n ? (lastSyncError ? `未送信 ${n}` : `送信待ち ${n}`) : (state.syncedAt ? `${hm(state.syncedAt)} 共有済` : '未同期');
    $('#status').textContent = API.mode === 'gas' ? '' : 'テストモード';
  }
  const playerOf = no => agg.players.find(p => p.no === no) || K.emptyPlayer(no, (state.players.find(p => Number(p.no) === no) || {}).name);
  const nameOf = no => (state.players.find(p => Number(p.no) === no) || {}).name || '';
  const isReg = no => state.players.some(p => Number(p.no) === no);

  // ---------- 描画 ----------
  function render() {
    { const [y, m, d] = date.split('-').map(Number), wd = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; $('#hDate').textContent = `${m}月${d}日(${wd})` + (date === K.todayJST() ? '' : ' 別の日'); }
    $('#hSheet').href = CFG.SHEET_URL || '#';
    document.querySelectorAll('#games button').forEach(b => b.classList.toggle('on', b.dataset.game === game));
    renderGrid();
    renderLog();
    renderSum();
    renderSet();
    if (openNo != null && openNo !== 0 && $('#sheet').classList.contains('show')) renderPanel(); // 0 = ディーラーの入力中(作り直さない)
  }

  function renderGrid() {
    const grid = $('#grid'), dealer = $('#dealerBox');
    if (game === 'dealer') {
      grid.style.display = 'none'; dealer.style.display = 'block';
      const d = agg.dealer;
      $('#dealerStat').innerHTML = `補充 合計 <b>${K.fmtPt(d.bac.in)}</b> ／ 回収 合計 <b>${K.fmtPt(d.bac.out)}</b> ／ 手元差 <b>${K.signedPt(d.bac.in - d.bac.out)}</b>${d.bac.ins.length ? `<div class="ins">${d.bac.ins.map(v => `<span class="${v < 0 ? 'neg' : ''}">${v}</span>`).join('')}</div>` : ''}`;
      return;
    }
    grid.style.display = 'grid'; dealer.style.display = 'none';
    const tb = $('#tourBar'), tt = agg.totals.tour;
    tb.style.display = game === 'tour' ? 'grid' : 'none';
    if (game === 'tour') tb.innerHTML = `<div><span>総エントリー</span><b>${tt.e + tt.re}</b></div><div><span>残り</span><b>${tt.active}<small>人</small></b></div><div><span>プール</span><b>${tt.in}<small>万</small></b></div>`;
    // 設定で名前を登録した人だけ表示(登録を消しても、このゲームに入力がある人は残す)
    const nos = new Set(state.players.map(p => Number(p.no)));
    state.txs.forEach(t => { if (t.game === game && t.no !== '' && t.no != null) nos.add(Number(t.no)); });
    const list = [...nos].filter(n => n > 0).sort((a, b) => a - b);
    if (!list.length) {
      grid.innerHTML = `<div class="nogrid">まだ誰も登録されていません<br><button class="btn gold" data-goto="set">設定で会計札と名前を登録</button></div>`;
      grid.style.gridAutoRows = '';
      return;
    }
    let html = '';
    for (const no of list) {
      const p = playerOf(no), reg = isReg(no);
      const s = p[game];
      let st = '';
      if (game === 'tour') { const n = s.e + s.re; if (n) st = s.alive ? `${n}回 ${s.in}万` : (s.out ? `賞金 ${s.out}万` : '飛び'); }
      else if (s.in || s.out) st = `${s.in}万${s.out ? ` → ${s.out}` : ''}`;
      const act = !!st;
      html += `<button class="cell g-${game} ${reg ? 'reg' : 'empty'} ${act ? 'act' : ''}" data-no="${no}">
        <div class="n">${no}</div>
        <div class="nm">${reg ? esc(p.name || '') : '(未登録)'}</div>
        ${st ? `<div class="st">${st}</div>` : ''}
      </button>`;
    }
    grid.innerHTML = html;
    fitGrid(list.length);
  }

  // 1行5人で、画面の残りの高さいっぱいに広げる(多いときはスクロール)
  let gridCount = 0;
  function fitGrid(count) {
    gridCount = count;
    const grid = $('#grid'); if (!grid || grid.style.display === 'none' || !count) return;
    const rows = Math.ceil(count / 5), gap = 8;
    const navH = ($('nav') || {}).offsetHeight || 70;
    const avail = window.innerHeight - grid.getBoundingClientRect().top - navH - 12;
    const cellW = (grid.clientWidth - gap * 4) / 5;
    // 高さは「画面の残り ÷ 行数」。ただし縦長になりすぎないよう幅の1.3倍まで
    const h = Math.max(96, Math.min(220, cellW * 1.3, Math.floor((avail - gap * (rows - 1)) / rows)));
    grid.style.gridAutoRows = h + 'px';
  }
  window.addEventListener('resize', () => fitGrid(gridCount));

  function renderLog() {
    const txs = [...state.txs].sort((a, b) => b.ts - a.ts);
    $('#logList').innerHTML = txs.length ? txs.map(t => `
      <div class="row">
        <div class="t">${t.game === 'dealer' ? '' : `<b>No.${t.no}</b> ${esc(nameOf(Number(t.no)))} `}<span class="tag g-${t.game}">${K.describeTx(t)}</span>
          <i>${new Date(t.ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}${t.by ? ` ・ ${esc(t.by)}` : ''}</i></div>
        <button data-del="${t.id}">削除</button>
      </div>`).join('') : '<div class="empty">まだ入力はありません</div>';
  }

  function renderSum() {
    const t = agg.totals;
    $('#sumStat').innerHTML = `
      <div><span>T エントリー</span><b>${t.tour.e + t.tour.re}<small> 回</small></b></div>
      <div><span>プライズプール</span><b>${t.tour.in}<small> 万</small></b></div>
      <div><span>店側合計</span><b class="${cls(t.house)}">${K.signedPt(t.house)}</b></div>
      <div><span>バカラ 店側</span><b class="${cls(-t.bac.pl)}">${K.signedPt(-t.bac.pl)}</b></div>
      <div><span>リング 店側</span><b class="${cls(-t.cash.pl)}">${K.signedPt(-t.cash.pl)}</b></div>
      <div><span>T 店側</span><b class="${cls(-t.tour.pl)}">${K.signedPt(-t.tour.pl)}</b></div>`;
    const list = agg.players.filter(p => p.name || p.bac.in || p.cash.in || p.tour.in || p.bac.out || p.cash.out || p.tour.out);
    $('#sumList').innerHTML = list.length ? list.map(p => `
      <div class="row"><small class="num">${p.no}</small>
        <div>${esc(p.name || '(未登録)')}<i>バカラ ${p.bac.in}万 ${K.signedPt(p.bac.pl)} ／ リング ${p.cash.in}万 ${K.signedPt(p.cash.pl)} ／ T ${p.tour.e + p.tour.re}回 ${K.signedPt(p.tour.pl)}</i></div>
        <b class="num ${cls(p.total)}">${K.signedPt(p.total)}</b></div>`).join('') : '<div class="empty">まだ入力はありません</div>';
  }

  function renderSet() {
    $('#setDate').value = date;
    $('#setTourFee b').textContent = state.config.tourFee ?? 20;
    $('#setReFee b').textContent = state.config.reentryFee ?? state.config.tourFee ?? 20;
    // プライズ
    const prizes = K.parsePrizes(state.config);
    $('#prizeRows').innerHTML = prizes.map((v, i) => `<div class="prize-r"><span style="color:var(--dim)">${K.rankLabel(i)}</span><b class="num">${v.toLocaleString('ja-JP')} 万</b><button class="btn" data-prize="${i}" style="padding:8px 12px">変更</button></div>`).join('')
      || '<div class="prize-r" style="color:var(--dim);font-size:13px;grid-template-columns:1fr">まだ設定がありません。「順位を追加」で賞金を入れてください。</div>';
    const ptotal = prizes.reduce((a, b) => a + b, 0), pool = agg.totals.tour.in;
    $('#prizeTotal').textContent = `${ptotal.toLocaleString('ja-JP')} 万`;
    $('#prizeInfo').textContent = `プライズプール(T の IN 合計) ${pool} 万 ／ 差 ${K.signedPt(pool - ptotal)}`;
    // 会計札と名前
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#rosterRows')) return; // 入力中は作り直さない
    const sig = state.players.map(p => `${p.no}:${p.name}`).sort().join('|');
    if (sig === rosterSig && $('#rosterRows').children.length) return; // 変更が無ければ作り直さない
    rosterSig = sig;
    let html = '';
    for (let no = 1; no <= CFG.MAX_NO; no++) {
      const nm = nameOf(no);
      html += `<div class="r"><small>${no}</small><input data-no="${no}" value="${esc(nm)}" class="${nm ? 'saved' : ''}" placeholder="—" autocomplete="off" autocapitalize="off" enterkeyhint="next"></div>`;
    }
    $('#rosterRows').innerHTML = html;
    $('#setMode').textContent = API.mode === 'gas' ? 'Google シート' : 'この端末のみ(テスト)';
    $('#setModeInfo').textContent = API.mode === 'gas' ? '入力はシートに即時保存' : 'config.js に GAS_URL を入れると共有されます';
    $('#openSheet').href = CFG.SHEET_URL || '#';
  }

  // ---------- プレイヤーシート ----------
  function openSheet(no) { openNo = no; $('#sheet').classList.add('show'); renderPanel(); }
  function closeSheet() { $('#sheet').classList.remove('show'); openNo = null; pad = null; }

  let pad = null; // { type:'in'|'out'|'prize'|'entry'|'reentry', dealerTable?, value:'' }
  function renderPanel() {
    const no = openNo, p = playerOf(no), reg = isReg(no);
    const el = $('#panel');
    if (!reg) {
      el.innerHTML = `<button class="close" data-close>✕</button>
        <h2>No.${no} <small>未登録</small></h2>
        <div class="sub" style="text-align:left;margin-top:10px">この会計札のお客さんの名前を登録してください。</div>
        <form class="nameform" id="nameForm"><input id="nameInput" placeholder="名前" autocomplete="off" autocapitalize="off"><button class="btn gold" type="submit">登録</button></form>`;
      setTimeout(() => { const i = document.querySelector('#nameInput'); if (i) i.focus(); }, 50);
      return;
    }
    const s = p[game];
    let statHtml, actsHtml;
    if (game === 'tour') {
      statHtml = `<div class="stat">
        <div><span>回数</span><b>${s.e + s.re}<small> 回</small></b></div>
        <div><span>合計 IN</span><b>${s.in}<small> 万</small></b></div>
        <div><span>収支</span><b class="${cls(s.pl)}">${K.signedPt(s.pl)}</b></div></div>`;
      actsHtml = `<div class="acts">
        <button class="btn in" data-act="entry">エントリー<br><small>${state.config.tourFee ?? 20}万</small></button>
        <button class="btn re" data-act="reentry">リエントリー<br><small>${state.config.reentryFee ?? state.config.tourFee ?? 20}万</small></button>
        <button class="btn bust" data-act="bust" ${s.alive ? '' : 'disabled'}>飛び</button>
        <button class="btn out" data-act="prize">賞金</button></div>`;
    } else {
      statHtml = `<div class="stat">
        <div><span>合計 IN</span><b>${s.in}<small> 万</small></b></div>
        <div><span>OUT</span><b>${s.out}<small> 万</small></b></div>
        <div><span>収支</span><b class="${cls(s.pl)}">${K.signedPt(s.pl)}</b></div></div>`;
      actsHtml = `<div class="acts"><button class="btn in" data-act="in">IN</button><button class="btn out" data-act="out">OUT</button></div>`;
    }
    // この人・このゲームの入力履歴(2回タップで削除)
    const mine = state.txs.filter(t => Number(t.no) === no && t.game === game).sort((a, b) => b.ts - a.ts);
    const hist = mine.length ? `<div class="card log mini">${mine.map(t => `<div class="row"><div class="t">${t.type === 'prize' && t.table ? t.table + ' ' : ''}${(K.TYPES[t.type] || t.type)} ${t.type === 'bust' ? '' : `<b>${t.pt}万</b>`} <i style="display:inline;margin-left:6px">${new Date(t.ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</i></div><button data-del="${t.id}">削除</button></div>`).join('')}</div>` : '';
    el.innerHTML = `<button class="close" data-close>✕</button>
      <h2 class="g-${game}">${no} ${esc(p.name)} <small><span class="tag">${K.GAMES[game]}</span></small></h2>
      ${statHtml}${pad ? (pad.type === 'rank' ? renderRanks() : renderPad(p)) : actsHtml + hist}`;
  }

  // 賞金: 順位を押すだけ。すでに出た順位は「済」で押せない
  function renderRanks() {
    const prizes = K.parsePrizes(state.config);
    if (!prizes.length) return `<div class="empty">設定タブでプライズ(順位ごとの賞金)を入れてください</div>
      <div class="confirm" style="grid-template-columns:1fr"><button class="btn" data-padcancel>戻る</button></div>`;
    const done = {};
    state.txs.filter(t => t.game === 'tour' && t.type === 'prize' && t.table).forEach(t => { done[t.table] = t.no; });
    return `<div class="ranks">${prizes.map((v, i) => {
      const label = K.rankLabel(i), who = done[label];
      return `<button class="btn rank" data-rank="${i}" ${who != null ? 'disabled' : ''}><span>${label}</span><b>${v}万</b>${who != null ? `<i>済 ${who}番</i>` : ''}</button>`;
    }).join('')}</div>
      <div class="confirm" style="grid-template-columns:1fr"><button class="btn" data-padcancel>戻る</button></div>`;
  }

  function renderPad(p) {
    const label = { in: 'IN', out: 'OUT', prize: '賞金', dealerIn: '補充', dealerOut: '回収' }[pad.type] || pad.type;
    const v = pad.value;
    const n = Number(v || 0) * (pad.neg ? -1 : 1);
    const s = p ? p[game] : null;
    let after = '';
    if (s && pad.type === 'in') after = `合計 IN → ${s.in + n}万`;
    if (s && (pad.type === 'out' || pad.type === 'prize')) after = `収支 → ${K.signedPt(s.out + n - s.in)}`;
    const quick = pad.type === 'in' || pad.type === 'dealerIn' ? [10, 20, 30, 50, 100] : [50, 100, 200, 300, 500];
    return `<div class="pad show">
      <div class="disp"><div><div class="lbl">${label}</div><b class="num">${pad.neg ? '-' : ''}${v || 0}<small> 万</small></b></div><small>${after}</small></div>
      <div class="quick">${quick.map(q => `<button data-q="${q}">+${q}</button>`).join('')}</div>
      <div class="keys">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => `<button data-k="${k}">${k}</button>`).join('')}
        <button class="fn" data-k="neg">${pad.allowNeg ? '±' : ''}</button><button data-k="0">0</button><button class="fn" data-k="bs">⌫</button>
      </div>
      <div class="confirm"><button class="btn" data-padcancel>戻る</button><button class="btn gold" data-padok ${n === 0 ? 'disabled' : ''}>${label} ${n ? n + '万' : ''} 確定</button></div>
    </div>`;
  }

  // ---------- 送信 ----------
  async function send(tx, label) {
    if (busy) return; busy = true;
    try {
      const st = await API.addTx(date, tx);
      await refresh(st);
      const p = tx.game === 'dealer' ? null : playerOf(Number(tx.no));
      // 自分が今記録した入力(取り消し用)
      const mineTx = st.txs.find(t => t.id === st._lastId) || null;
      let t2 = '';
      if (p) {
        const s = p[tx.game];
        if (tx.game === 'tour') t2 = `合計 ${s.e + s.re}回 ／ IN ${s.in}万 ／ 収支 ${K.signedPt(s.pl)}`;
        else t2 = `合計 IN ${s.in}万 ／ OUT ${s.out}万 ／ 収支 ${K.signedPt(s.pl)}`;
      } else {
        const d = agg.dealer[tx.table || 'bac'];
        t2 = `補充 ${d.in}万 ／ 回収 ${d.out}万`;
      }
      toast(`${p ? `No.${p.no} ${esc(p.name)} ` : ''}${label}`, t2, false, mineTx);
    } catch (e) { toast('記録できませんでした', e.message, true); }
    finally { busy = false; }
  }

  let toastTimer;
  // undoTx を渡したときだけ「取り消し」を出す(他のお知らせで古い入力を消さないため)
  function toast(t1, t2, err, undoTx) {
    lastTx = (!err && undoTx) ? { id: undoTx.id, date } : null;
    const el = $('#toast');
    $('#toastT1').innerHTML = t1; $('#toastT2').textContent = t2;
    el.classList.toggle('err', !!err); el.classList.add('show');
    $('#toastUndo').style.display = err || !lastTx ? 'none' : '';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), err ? 8000 : 4000);
  }

  // ---------- イベント ----------
  $('#games').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; game = b.dataset.game; pad = null; render(); });
  $('#grid').addEventListener('click', e => {
    const g = e.target.closest('[data-goto]'); if (g) return document.querySelector(`#nav [data-tab="${g.dataset.goto}"]`).click();
    const c = e.target.closest('.cell'); if (c) { pad = null; openSheet(Number(c.dataset.no)); }
  });
  $('#dealerBox').addEventListener('click', e => {
    const b = e.target.closest('[data-dealer]'); if (!b) return;
    openNo = 0; pad = { type: b.dataset.type === 'in' ? 'dealerIn' : 'dealerOut', table: b.dataset.dealer, value: '', allowNeg: true, neg: false };
    $('#sheet').classList.add('show');
    $('#panel').innerHTML = `<button class="close" data-close>✕</button><h2 class="g-dealer">ディーラー チップ <small><span class="tag">${b.dataset.type === 'in' ? '補充' : '回収'}</span></small></h2>${renderPad(null)}`;
  });
  $('#sheet').addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-close]')) return closeSheet();
    const act = t.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'entry' || a === 'reentry') {
        const fee = a === 'entry' ? (state.config.tourFee ?? 20) : (state.config.reentryFee ?? state.config.tourFee ?? 20);
        return send({ no: openNo, game: 'tour', type: a, pt: Number(fee) }, `${a === 'entry' ? 'エントリー' : 'リエントリー'} +1(${fee}万)`);
      }
      if (a === 'bust') return send({ no: openNo, game: 'tour', type: 'bust', pt: 0 }, '飛び');
      pad = a === 'prize' ? { type: 'rank' } : { type: a, value: '', allowNeg: false, neg: false }; return renderPanel();
    }
    const rk = t.closest('[data-rank]');
    if (rk) {
      const i = Number(rk.dataset.rank), pt = K.parsePrizes(state.config)[i], label = K.rankLabel(i);
      pad = null;
      return send({ no: openNo, game: 'tour', type: 'prize', pt, table: label }, `${label} 賞金 ${pt}万`);
    }
    if (t.closest('[data-rename]')) {
      const cur = nameOf(openNo);
      $('#panel').innerHTML = `<button class="close" data-close>✕</button><h2>No.${openNo} <small>名前の変更</small></h2>
        <form class="nameform" id="nameForm"><input id="nameInput" value="${esc(cur)}" autocomplete="off"><button class="btn gold" type="submit">保存</button></form>`;
      setTimeout(() => { const i = document.querySelector('#nameInput'); if (i) i.focus(); }, 50); return;
    }
    const k = t.closest('[data-k]');
    if (k && pad) {
      const key = k.dataset.k;
      if (key === 'bs') pad.value = pad.value.slice(0, -1);
      else if (key === 'neg') { if (pad.allowNeg) pad.neg = !pad.neg; }
      else if (pad.value.length < 6) pad.value = (pad.value + key).replace(/^0+(?=\d)/, '');
      return openNo === 0 ? rerenderDealerPad() : renderPanel();
    }
    const q = t.closest('[data-q]');
    if (q && pad) { pad.value = String(Number(pad.value || 0) + Number(q.dataset.q)); return openNo === 0 ? rerenderDealerPad() : renderPanel(); }
    if (t.closest('[data-padcancel]')) { pad = null; return openNo === 0 ? closeSheet() : renderPanel(); }
    if (t.closest('[data-padok]') && pad) {
      const n = Number(pad.value || 0) * (pad.neg ? -1 : 1);
      if (!n) return;
      const p = pad; pad = null;
      if (openNo === 0) {
        closeSheet();
        return send({ game: 'dealer', table: 'bac', type: p.type === 'dealerIn' ? 'in' : 'out', pt: n }, `ディーラー チップ${p.type === 'dealerIn' ? '補充' : '回収'} ${K.signedPt(n)}`);
      }
      const no = openNo;
      closeSheet();
      const label = { in: `IN ${n}万`, out: `OUT ${n}万`, prize: `賞金 ${n}万` }[p.type];
      return send({ no, game, type: p.type === 'prize' ? 'prize' : p.type, pt: n }, label);
    }
  });
  function rerenderDealerPad() { const h2 = $('#panel h2').outerHTML; $('#panel').innerHTML = `<button class="close" data-close>✕</button>${h2}${renderPad(null)}`; }
  $('#sheet').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#nameInput').value.trim(); if (!name) return;
    try { const st = await API.register(date, openNo, name); await refresh(st); renderPanel(); toast(`No.${openNo} ${esc(name)} を登録しました`, ''); }
    catch (err) { toast('登録できませんでした', err.message, true); }
  });
  $('#toastUndo').addEventListener('click', async () => {
    if (!lastTx) return;
    const { id, date: d } = lastTx; lastTx = null; $('#toast').classList.remove('show');
    try { await API.undo(d, id); refresh(); scheduleSync(); toast('取り消しました', ''); } catch (e) { toast('取り消せませんでした', e.message, true); }
  });
  // 削除: 1回目で「消す?」に変わり、3秒以内にもう1回で削除
  async function delTap(b) {
    if (!b.classList.contains('arm')) {
      document.querySelectorAll('[data-del].arm').forEach(x => { x.classList.remove('arm'); x.textContent = '削除'; });
      b.classList.add('arm'); b.textContent = '消す?';
      setTimeout(() => { if (b.isConnected) { b.classList.remove('arm'); b.textContent = '削除'; } }, 3000);
      return;
    }
    b.disabled = true;
    try { await refresh(await API.undo(date, b.dataset.del)); toast('削除しました', ''); } catch (err) { toast('削除できませんでした', err.message, true); }
  }
  $('#logList').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b) delTap(b); });
  $('#sheet').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b) { e.stopPropagation(); delTap(b); } }, true);
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    tab = b.dataset.tab;
    document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
    ['input', 'log', 'sum', 'set'].forEach(k => $('#tab-' + k).classList.toggle('hide', k !== tab));
    if (tab !== 'sum') $('#preview').innerHTML = '';
    refresh();
  });
  $('#setDate').addEventListener('change', e => { date = e.target.value || K.todayJST(); localStorage.setItem('kt.date2', JSON.stringify({ date, on: K.todayJST() })); rosterSig = null; refresh(); doSync(true); });
  async function askFee(key, label) {
    const cur = state.config[key] ?? 20;
    const v = prompt(`${label}(万)`, cur);
    if (v == null || v === '' || isNaN(Number(v))) return;
    try { await refresh(await API.setConfig(date, { [key]: Number(v) })); } catch (e) { toast('保存できませんでした', e.message, true); }
  }
  // プライズ編集
  async function savePrizes(arr) {
    try { await refresh(await API.setConfig(date, { prizes: arr.join(',') })); } catch (e) { toast('保存できませんでした', e.message, true); }
  }
  $('#prizeBox').addEventListener('click', e => {
    const b = e.target.closest('[data-prize]'); if (!b) return;
    const arr = K.parsePrizes(state.config); const i = Number(b.dataset.prize);
    const v = prompt(`${K.rankLabel(i)} の賞金(万)`, arr[i]);
    if (v == null || v === '' || isNaN(Number(v))) return;
    arr[i] = Number(v); savePrizes(arr);
  });
  $('#prizeAdd').addEventListener('click', () => {
    const arr = K.parsePrizes(state.config);
    const v = prompt(`${K.rankLabel(arr.length)} の賞金(万)`, '');
    if (v == null || v === '' || isNaN(Number(v))) return;
    arr.push(Number(v)); savePrizes(arr);
  });
  $('#prizeDel').addEventListener('click', () => { const arr = K.parsePrizes(state.config); if (!arr.length) return; arr.pop(); savePrizes(arr); });
  // 会計札と名前: 欄を離れたら保存
  $('#rosterRows').addEventListener('change', async e => {
    const inp = e.target.closest('input[data-no]'); if (!inp) return;
    const no = Number(inp.dataset.no), name = inp.value.trim();
    if (name === nameOf(no)) return;
    if (!name && !isReg(no)) return;
    try { const st = await API.register(date, no, name); state = st; agg = K.aggregate(st.players, st.txs, st.config); inp.classList.toggle('saved', !!name); setStatus(); scheduleSync(); }
    catch (err) { toast('保存できませんでした', err.message, true); }
  });
  $('#rosterRows').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = [...document.querySelectorAll('#rosterRows input')]; const i = inputs.indexOf(e.target);
    if (i >= 0 && inputs[i + 1]) inputs[i + 1].focus(); else e.target.blur();
  });
  $('#setTourFee').addEventListener('click', () => askFee('tourFee', 'エントリー 1 回の金額'));
  $('#setReFee').addEventListener('click', () => askFee('reentryFee', 'リエントリー 1 回の金額'));
  $('#clearDay').addEventListener('click', async () => {
    if (!confirm(`${date} のデータをすべて消去します。元に戻せません。よろしいですか?`)) return;
    if (!confirm('本当に消去しますか?')) return;
    try { await refresh(await API.clearDay(date)); rosterSig = null; refresh(); toast('消去しました', ''); } catch (e) { toast('消去できませんでした', e.message, true); }
  });
  $('#makeImage').addEventListener('click', async () => {
    const c = KashitakuImage.renderSummary(agg, date);
    $('#preview').innerHTML = ''; $('#preview').appendChild(c);
    const r = await KashitakuImage.shareCanvas(c, `casa貸卓_${date}.png`);
    if (r === 'downloaded') toast('画像を保存しました', '写真/ダウンロードを確認してください');
  });

  $('#syncBtn').addEventListener('click', () => doSync(false));
  // お知らせはタップで閉じる(取り消しボタン以外)
  $('#toast').addEventListener('click', e => { if (!e.target.closest('#toastUndo')) $('#toast').classList.remove('show'); });
  // 開いたときに1回だけ同期(他のスマホの入力を取り込む)
  refresh();
  doSync(true);
  setInterval(() => { if (!document.hidden) doSync(true); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) doSync(true); });
  window.addEventListener('online', () => doSync(true));
})();
