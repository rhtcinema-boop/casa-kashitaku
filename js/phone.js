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

  // ---------- 文字が見切れないように縮める ----------
  function fitScreen() {
    fitText($('#hDate'), { min: 14 });
    fitAll('.cell', { min: 8 });
    fitAll('.tourbar b, .stat b', { min: 12 });
  }
  function fitPanel() { fitAll('#panel .stat b, #panel .ranks .rank b, #panel .pad .disp b', { min: 12 }); }
  window.addEventListener('resize', () => { fitScreen(); fitPanel(); });

  // ---------- 描画 ----------
  function render() {
    { const [y, m, d] = date.split('-').map(Number), wd = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; $('#hDate').textContent = `${m}月${d}日(${wd})` + (date === K.todayJST() ? '' : ' 別の日'); }
    $('#hSheet').href = CFG.SHEET_URL || '#';
    document.querySelectorAll('#games button').forEach(b => b.classList.toggle('on', b.dataset.game === game));
    renderGrid();
    renderLog();
    renderSum();
    renderPlayers();
    renderSet();
    if (openNo != null && $('#sheet').classList.contains('show')) { if (openNo > 0) renderPanel(); else if (openNo === 0 && !pad) renderDealer(); } // 0 = ディーラー(テンキー入力中は作り直さない)、-1 = 3枚目判定
    fitScreen();
  }

  function renderGrid() {
    const grid = $('#grid');
    grid.style.display = 'grid';
    const tb = $('#tourBar'), tt = agg.totals.tour;
    tb.style.display = game === 'tour' ? 'grid' : 'none';
    if (game === 'tour') tb.innerHTML = `<div><span>総エントリー</span><b>${tt.e + tt.re}</b></div><div><span>残り</span><b>${tt.active}<small>人</small></b></div>`;
    // 設定で名前を登録した人だけ表示(登録を消しても、このゲームに入力がある人は残す)
    const nos = new Set(state.players.map(p => Number(p.no)));
    state.txs.forEach(t => { if (t.game === game && t.no !== '' && t.no != null) nos.add(Number(t.no)); });
    const list = [...nos].filter(n => n > 0).sort((a, b) => a - b);
    // バカラは先頭に「ディーラー」のマス(チップの補充・回収)
    let html = '';
    if (game === 'bac') {
      const d = agg.dealer.bac, used = d.in || d.out;
      html += `<button class="cell g-dealer dealer-cell ${used ? 'act' : ''}" data-dealer-open>
        <div class="n dl">ディーラー</div>
        <div class="st">${used ? `手元 ${K.signedPt(K.round1(d.in - d.out))}` : 'チップ'}</div>
      </button>
      <button class="cell g-dealer draw-cell" data-draw-open>
        <div class="n dl">3枚目</div>
        <div class="st">判定</div>
      </button>`;
    }
    if (!list.length) {
      grid.innerHTML = html + `<div class="nogrid">まだ誰も登録されていません<br><button class="btn gold" data-goto="set">設定で会計札と名前を登録</button></div>`;
      grid.style.gridAutoRows = '';
      if (game === 'bac') fitGrid(2);
      return;
    }
    for (const no of list) {
      const p = playerOf(no), reg = isReg(no);
      const s = p[game];
      let st = '';
      if (game === 'tour') { const n = s.e + s.re; if (n) st = s.alive ? `${n}回 ${s.in}万` : (s.rank ? `${s.rank} ${K.fmtPt(s.out)}` : s.out ? `賞金 ${K.fmtPt(s.out)}` : '飛び'); }
      else if (s.in || s.out) st = `${s.in}万${s.out ? ` → ${s.out}` : ''}`;
      const act = !!st;
      const out = p.home || (game === 'tour' ? (s.e + s.re > 0 && !s.alive) : !!s.done); // 帰宅・飛び・順位確定・OUT 済みは少し暗く
      html += `<button class="cell g-${game} ${reg ? 'reg' : 'empty'} ${act ? 'act' : ''} ${out ? 'out' : ''}" data-no="${no}">
        <div class="n">${no}</div>
        <div class="nm">${reg ? esc(p.name || '') : '(未登録)'}</div>
        ${st ? `<div class="st">${st}</div>` : ''}
      </button>`;
    }
    grid.innerHTML = html;
    fitGrid(list.length + (game === 'bac' ? 2 : 0));
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

  // 遊んだゲームだけ並べる(0万のゲームは出さない)
  function sumParts(p) {
    const parts = [];
    if (p.bac.in || p.bac.out) parts.push(`バカラ IN ${K.fmtPt(p.bac.in)} ${K.signedPt(p.bac.pl)}`);
    if (p.cash.in || p.cash.out) parts.push(`リング IN ${K.fmtPt(p.cash.in)} ${K.signedPt(p.cash.pl)}`);
    if (p.tour.e + p.tour.re) parts.push(`トナメ ${p.tour.e + p.tour.re}回${p.tour.rank ? ` <b class="rk">${p.tour.rank}</b>` : ''} ${K.signedPt(p.tour.pl)}`);
    return parts.join(' ／ ') || 'まだ入力なし';
  }
  // ---------- プレイヤー一覧(全ゲーム終了ボタン付き) ----------
  // その人のまだ終わっていないゲーム
  function pendingGames(p) {
    const q = [];
    if (p.bac.in && !p.bac.done) q.push('bac');
    if (p.cash.in && !p.cash.done) q.push('cash');
    if (p.tour.e + p.tour.re && p.tour.alive) q.push('tour');
    return q;
  }
  function renderPlayers() {
    const nos = new Set(state.players.map(p => Number(p.no)));
    state.txs.forEach(t => { if (t.game !== 'dealer' && t.no !== '' && t.no != null) nos.add(Number(t.no)); });
    const list = [...nos].filter(n => n > 0).sort((a, b) => a - b).map(n => playerOf(n));
    const gone = list.filter(p => p.home).length;
    $('#plStat').innerHTML = `<div><span>登録</span><b>${list.length}<small> 人</small></b></div><div><span>在店</span><b>${list.length - gone}<small> 人</small></b></div><div><span>帰宅</span><b>${gone}<small> 人</small></b></div>`;
    if (!list.length) { $('#plList').innerHTML = '<div class="empty">まだ誰も登録されていません</div>'; return; }
    $('#plList').innerHTML = list.map(p => {
      const pend = pendingGames(p), chips = [];
      if (p.bac.in || p.bac.out) chips.push(`<span class="g-bac ${p.bac.done ? '' : 'live'}">バカラ ${p.bac.done ? '終了' : 'プレイ中'} ${K.signedPt(p.bac.pl)}</span>`);
      if (p.cash.in || p.cash.out) chips.push(`<span class="g-cash ${p.cash.done ? '' : 'live'}">リング ${p.cash.done ? '終了' : 'プレイ中'} ${K.signedPt(p.cash.pl)}</span>`);
      if (p.tour.e + p.tour.re) chips.push(`<span class="g-tour ${p.tour.alive ? 'live' : ''}">トナメ ${p.tour.alive ? 'プレイ中' : (p.tour.rank || '飛び')} ${K.signedPt(p.tour.pl)}</span>`);
      const any = chips.length;
      return `<div class="pl ${p.home ? 'gone' : ''}">
        <div class="no">${p.no}</div>
        <div><div class="nm">${esc(p.name || '(未登録)')}${any ? `<small class="${cls(p.total)}">${K.signedPt(p.total)}</small>` : ''}</div>
          <div class="chips">${chips.join('') || '<span>まだ遊んでいません</span>'}</div></div>
        ${p.home ? `<button class="btn" disabled>帰宅済み</button>` : `<button class="btn ${pend.length ? 'gold' : ''}" data-endall="${p.no}">${pend.length ? '全ゲーム終了して帰宅' : '帰宅'}</button>`}
      </div>`;
    }).join('');
  }
  $('#plList').addEventListener('click', e => {
    const b = e.target.closest('[data-endall]'); if (!b) return;
    openSheet(Number(b.dataset.endall));
    startHome();
  });

  function renderSum() {
    const t = agg.totals;
    $('#sumStat').innerHTML = `
      <div><span>トナメ エントリー</span><b>${t.tour.e + t.tour.re}<small> 回</small></b></div>
      <div><span>プライズプール</span><b>${t.tour.in}<small> 万</small></b></div>
      <div><span>店側合計</span><b class="${cls(t.house)}">${K.signedPt(t.house)}</b></div>
      <div><span>バカラ 店側</span><b class="${cls(-t.bac.pl)}">${K.signedPt(-t.bac.pl)}</b></div>
      <div><span>リング 店側</span><b class="${cls(-t.cash.pl)}">${K.signedPt(-t.cash.pl)}</b></div>
      <div><span>トナメ 店側</span><b class="${cls(-t.tour.pl)}">${K.signedPt(-t.tour.pl)}</b></div>`;
    const list = agg.players.filter(p => p.name || p.bac.in || p.cash.in || p.tour.in || p.bac.out || p.cash.out || p.tour.out);
    $('#sumList').innerHTML = list.length ? list.map(p => `
      <div class="row"><small class="num">${p.no}</small>
        <div><span class="sum-nm">${esc(p.name || '(未登録)')}</span><b class="num sum-tot ${cls(p.total)}">${K.signedPt(p.total)}</b><i>${sumParts(p)}</i></div></div>`).join('') : '<div class="empty">まだ入力はありません</div>';
  }

  function renderSet() {
    $('#setDate').value = date;
    $('#setTourFee b').textContent = state.config.tourFee ?? 20;
    $('#setReFee b').textContent = state.config.reentryFee ?? state.config.tourFee ?? 20;
    // 適用中のプライズ
    const prizes = K.parsePrizes(state.config);
    const pool = agg.totals.tour.in;
    $('#prizeRows').innerHTML = prizes.map((v, i) => `<div class="prize-r"><span class="lbl">${K.rankLabel(i)}</span>${jumpHtml(prizes, i)}<b class="num">${K.fmtPt(v)}</b></div>`).join('')
      || '<div class="prize-r" style="color:var(--text2);font-size:15px;grid-template-columns:1fr">まだ確定していません。上の「自動計算」から作れます。</div>';
    const ptotal = K.round1(prizes.reduce((a, b) => a + b, 0));
    $('#prizeTotal').textContent = K.fmtPt(ptotal);
    $('#prizeTextRow').classList.toggle('hide', !prizes.length);
    $('#prizeInfo').textContent = prizes.length ? `プール ${K.fmtPt(pool)} ／ 差 ${K.signedPt(K.round1(pool - ptotal))}` : '';
    renderCalcHead();
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
  function closeSheet() { $('#sheet').classList.remove('show'); openNo = null; pad = null; home = null; }

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
    const g = (pad && pad.game) || game; // 帰宅の途中は、いま終了させているゲーム
    const s = p[g];
    let statHtml, actsHtml;
    const homeBtn = p.home ? `<button class="btn home full" disabled>帰宅済み</button>` : `<button class="btn home full" data-act="home">帰宅${pendingGames(p).length ? '(全ゲームを終了)' : ''}</button>`;
    if (g === 'tour') {
      statHtml = `<div class="stat">
        <div><span>回数</span><b>${s.e + s.re}<small> 回</small></b></div>
        <div><span>合計 IN</span><b>${s.in}<small> 万</small></b></div>
        <div><span>収支</span><b class="${cls(s.pl)}">${K.signedPt(s.pl)}</b></div></div>`;
      actsHtml = `<div class="acts">
        <button class="btn in" data-act="entry">エントリー<br><small>${state.config.tourFee ?? 20}万</small></button>
        <button class="btn re" data-act="reentry">リエントリー<br><small>${state.config.reentryFee ?? state.config.tourFee ?? 20}万</small></button>
        <button class="btn bust full" data-act="bust" ${s.alive ? '' : 'disabled'}>${s.rank ? `${s.rank} で終了` : '飛び(順位を選ぶ)'}</button>${homeBtn}</div>`;
    } else {
      statHtml = `<div class="stat">
        <div><span>合計 IN</span><b>${s.in}<small> 万</small></b></div>
        <div><span>OUT</span><b>${s.out}<small> 万</small></b></div>
        <div><span>収支</span><b class="${cls(s.pl)}">${K.signedPt(s.pl)}</b></div></div>`;
      actsHtml = `<div class="acts"><button class="btn in" data-act="in">IN</button><button class="btn out" data-act="out">OUT</button>${homeBtn}</div>`;
    }
    // この人・このゲームの入力履歴(2回タップで削除)
    const mine = state.txs.filter(t => Number(t.no) === no && t.game === g).sort((a, b) => b.ts - a.ts);
    const hist = mine.length ? `<div class="card log mini">${mine.map(t => `<div class="row"><div class="t">${t.type === 'prize' && t.table ? t.table + ' ' : ''}${(K.TYPES[t.type] || t.type)} ${t.type === 'bust' ? '' : `<b>${t.pt}万</b>`} <i style="display:inline;margin-left:6px">${new Date(t.ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</i></div><button data-del="${t.id}">削除</button></div>`).join('')}</div>` : '';
    el.innerHTML = `<button class="close" data-close>✕</button>
      <h2 class="g-${g}">${no} ${esc(p.name)} <small><span class="tag">${K.GAMES[g]}</span></small></h2>
      ${home ? `<div class="pick-h home-h">帰宅: ${K.GAMES[g]}を終了<small>あと ${home.queue.length} ゲーム(${home.queue.map(x => K.GAMES[x]).join('・')})</small></div>` : ''}
      ${statHtml}${pad ? (pad.type === 'rank' ? renderRanks() : renderPad(p)) : actsHtml + hist}`;
    fitPanel();
  }

  // 賞金: 順位を押すだけ。すでに出た順位は「済」で押せない
  // 飛び → 順位を選ぶ。おすすめ = 今の残り人数(その人が飛ぶと、その順位で終わる)
  function renderRanks() {
    const prizes = K.parsePrizes(state.config);
    const done = {};
    state.txs.filter(t => t.game === 'tour' && t.type === 'prize' && t.table).forEach(t => { done[t.table] = t.no; });
    const remain = agg.totals.tour.active, sugg = remain >= 1 && remain <= prizes.length ? remain - 1 : -1;
    return `<div class="pick-h">順位を選んでください<small>残り ${remain}人${sugg >= 0 ? ` → この人は ${K.rankLabel(sugg)}` : ' → まだ入賞圏外'}</small></div>
      <div class="ranks">${prizes.map((v, i) => {
      const label = K.rankLabel(i), who = done[label];
      return `<button class="btn rank ${i === sugg ? 'sugg' : ''}" data-rank="${i}" ${who != null ? 'disabled' : ''}><span>${label}</span><b>${K.fmtPt(v)}</b>${who != null ? `<i>済 ${who}番</i>` : ''}</button>`;
    }).join('')}</div>
      <div class="acts"><button class="btn bust ${sugg < 0 ? 'sugg' : ''}" data-act="bustOut">圏外で飛び<br><small>賞金なし</small></button><button class="btn" data-padcancel>戻る</button></div>`;
  }

  function renderPad(p) {
    const label = (pad.home ? K.GAMES[pad.game] + ' ' : '') + ({ in: 'IN', out: 'OUT', prize: '賞金', dealerIn: '補充', dealerOut: '回収' }[pad.type] || pad.type);
    const v = pad.value;
    const n = Number(v || 0) * (pad.neg ? -1 : 1);
    const s = p ? p[pad.game || game] : null;
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
      <div class="confirm"><button class="btn" data-padcancel>戻る</button><button class="btn gold" data-padok ${n === 0 && !pad.allowZero ? 'disabled' : ''}>${label} ${n || pad.allowZero ? n + '万' : ''} 確定</button></div>
    </div>`;
  }

  // ---------- 帰宅: 終わっていないゲームを順番に終了させる ----------
  // バカラ・リング: IN があって OUT がまだ → OUT を入力(0 でも可)。トーナメント: 続行中 → 順位か圏外。
  let home = null; // { no, queue: ['bac','cash','tour'] }
  function startHome() {
    const p = playerOf(openNo), q = pendingGames(p);
    if (p.home && !q.length) return toast('すでに帰宅済みです', `No.${p.no} ${esc(p.name)}`);
    home = { no: openNo, queue: q };
    nextHome();
  }
  async function nextHome() {
    if (!home) return;
    if (!home.queue.length) {
      const no = home.no; home = null; pad = null; closeSheet();
      await send({ no, game: 'home', type: 'home', pt: 0 }, '帰宅');
      const p = playerOf(no);
      return toast(`No.${p.no} ${esc(p.name)} 帰宅しました`, `合計収支 ${K.signedPt(p.total)}`);
    }
    const g = home.queue[0];
    if (g === 'tour') {
      if (!K.parsePrizes(state.config).length) { // プライズ未確定ならそのまま飛び
        await send({ no: home.no, game: 'tour', type: 'bust', pt: 0 }, 'トーナメント 飛び(帰宅)');
        home.queue.shift(); return nextHome();
      }
      pad = { type: 'rank', game: 'tour', home: true };
    } else {
      pad = { type: 'out', game: g, value: '', allowNeg: false, neg: false, allowZero: true, home: true };
    }
    renderPanel();
  }
  async function homeDone(tx, label) { await send(tx, label); home.queue.shift(); nextHome(); }

  // ---------- 送信 ----------
  // 追加系(エントリー・飛び・順位など)はパネルを閉じてから記録
  function sendClose(tx, label) { closeSheet(); return send(tx, label); }
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
    if (e.target.closest('[data-dealer-open]')) { pad = null; return openDealer(); }
    if (e.target.closest('[data-draw-open]')) { pad = null; return openDraw(); }
    const c = e.target.closest('.cell'); if (c) { pad = null; openSheet(Number(c.dataset.no)); }
  });
  // ---------- バカラ 3枚目の判定(ディーラー補助) ----------
  // 最初の2枚は合計(0〜9)だけ、3枚目からは引いたカードの数字をテンキーで入れる。サイドベットなし、バンカー6は配当半分。
  const draw = { pt: null, bt: null, p3: null, b3: null, order: [] }; // order: 入れた順(1枚戻す用)
  function openDraw() { openNo = -1; pad = null; $('#sheet').classList.add('show'); renderDraw(); }
  function renderDraw() {
    const r = K.bacNext2(draw.pt, draw.bt, draw.p3, draw.b3);
    const box = (v, key) => v != null ? `<b class="bd-v">${v}</b>` : `<b class="bd-v empty ${r.need === key ? 'next' : ''}">${r.need === key ? '?' : '—'}</b>`;
    const hand = (side, name) => {
      const two = side === 'p' ? draw.pt : draw.bt, third = side === 'p' ? draw.p3 : draw.b3;
      const total = two == null ? '' : (two + (third || 0)) % 10;
      const turn = r.need === (side === 'p' ? 'pt' : 'bt') || r.need === side + '3';
      const win = r.done && r.winner === (side === 'p' ? 'player' : 'banker');
      return `<div class="bd-hand ${side} ${turn ? 'turn' : ''} ${win ? 'win' : ''}">
        <div class="bd-name">${name}</div>
        <div class="bd-row"><span>2枚の合計</span>${box(two, side === 'p' ? 'pt' : 'bt')}</div>
        <div class="bd-row"><span>3枚目</span>${box(third, side + '3')}</div>
        <b class="bd-total">${total}</b></div>`;
    };
    const res = !r.done ? `<div class="bd-msg">${r.need === 'p3' || r.need === 'b3' ? '引く → ' : ''}<b>${r.step}</b> を入力</div>`
      : r.winner === 'tie' ? `<div class="bd-msg done tie">タイ <small>${r.pt} 対 ${r.bt}</small></div>`
      : r.winner === 'player' ? `<div class="bd-msg done player">プレイヤーの勝ち <small>${r.pt} 対 ${r.bt}</small></div>`
      : `<div class="bd-msg done banker">バンカーの勝ち <small>${r.bt} 対 ${r.pt}</small>${r.banker6 ? '<em>バンカー6 → 配当は半分</em>' : ''}</div>`;
    const third = r.need === 'p3' || r.need === 'b3';
    $('#panel').innerHTML = `<button class="close" data-close>✕</button>
      <h2 class="g-dealer">3枚目の判定 <small>サイドベットなし・バンカー6あり</small></h2>
      <div class="bd-hands">${hand('p', 'プレイヤー')}${hand('b', 'バンカー')}</div>
      ${res}
      ${r.reasons.length ? `<ul class="bd-why">${r.reasons.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
      ${r.done ? '' : `<div class="bd-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-draw-n="${n}">${n}${third && n === 1 ? '<small>A</small>' : ''}</button>`).join('')}<span></span><button data-draw-n="0">0${third ? '<small>10・J・Q・K</small>' : ''}</button><span></span></div>`}
      <div class="acts"><button class="btn" data-draw-undo ${draw.order.length ? '' : 'disabled'}>1つ戻す</button><button class="btn gold" data-draw-reset>次のゲーム</button></div>
      <details class="bd-rule"><summary>引く条件の早見表</summary>
        <table><tr><th>プレイヤー</th><td>0〜5 → 引く ／ 6・7 → 引かない ／ 8・9 → ナチュラル</td></tr>
        <tr><th>バンカー(プレイヤーが引かない)</th><td>0〜5 → 引く ／ 6・7 → 引かない</td></tr>
        <tr><th>バンカー 0〜2</th><td>いつも引く</td></tr>
        <tr><th>バンカー 3</th><td>プレイヤーの3枚目が 8 以外なら引く</td></tr>
        <tr><th>バンカー 4</th><td>プレイヤーの3枚目が 2〜7 なら引く</td></tr>
        <tr><th>バンカー 5</th><td>プレイヤーの3枚目が 4〜7 なら引く</td></tr>
        <tr><th>バンカー 6</th><td>プレイヤーの3枚目が 6・7 なら引く</td></tr>
        <tr><th>バンカー 7</th><td>引かない</td></tr>
        <tr><th>点数</th><td>A=1、10・J・Q・K=0、合計の下1桁</td></tr></table>
      </details>`;
    fitPanel();
  }
  function drawNum(n) {
    const r = K.bacNext2(draw.pt, draw.bt, draw.p3, draw.b3);
    if (r.done || !r.need) return;
    draw[r.need] = n; draw.order.push(r.need);
    renderDraw();
  }

  // ---------- バカラディーラー(チップの補充・回収) ----------
  function openDealer() { openNo = 0; pad = null; $('#sheet').classList.add('show'); renderDealer(); }
  function renderDealer() {
    const d = agg.dealer.bac;
    const mine = state.txs.filter(t => t.game === 'dealer').sort((a, b) => b.ts - a.ts);
    const hist = mine.length ? `<div class="card log mini">${mine.map(t => `<div class="row"><div class="t">${t.type === 'in' ? '補充' : '回収'} <b>${K.signedPt(t.pt)}</b> <i style="display:inline;margin-left:6px">${new Date(t.ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</i></div><button data-del="${t.id}">削除</button></div>`).join('')}</div>` : '';
    $('#panel').innerHTML = `<button class="close" data-close>✕</button>
      <h2 class="g-dealer">バカラディーラー</h2>
      <div class="stat">
        <div><span>補充 合計</span><b>${K.fmtPt(d.in)}</b></div>
        <div><span>回収 合計</span><b>${K.fmtPt(d.out)}</b></div>
        <div><span>手元差</span><b>${K.signedPt(K.round1(d.in - d.out))}</b></div></div>
      <div class="stat">
        <div><span>プレイヤー</span><b class="${cls(agg.totals.bac.pl)}">${K.signedPt(agg.totals.bac.pl)}</b></div>
        <div><span>ディーラー</span><b class="${cls(d.pl)}">${K.signedPt(d.pl)}</b></div>
        <div class="${agg.totals.bacDiff ? 'diff-ng' : 'diff-ok'}"><span>差額</span><b>${K.signedPt(agg.totals.bacDiff)}</b><small>${agg.totals.bacDiff ? 'ずれあり' : '一致'}</small></div></div>
      <div class="acts"><button class="btn in" data-dealer="bac" data-type="in">チップ 補充</button><button class="btn out" data-dealer="bac" data-type="out">チップ 回収</button></div>${hist}`;
    fitPanel();
  }
  $('#sheet').addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-close]')) return closeSheet();
    const dn = t.closest('[data-draw-n]'); if (dn) return drawNum(Number(dn.dataset.drawN));
    if (t.closest('[data-draw-undo]')) { const k = draw.order.pop(); if (k) draw[k] = null; return renderDraw(); }
    if (t.closest('[data-draw-reset]')) { draw.pt = draw.bt = draw.p3 = draw.b3 = null; draw.order = []; return renderDraw(); }
    const db = t.closest('[data-dealer]');
    if (db) {
      pad = { type: db.dataset.type === 'in' ? 'dealerIn' : 'dealerOut', table: 'bac', value: '', allowNeg: true, neg: false };
      $('#panel').innerHTML = `<button class="close" data-close>✕</button><h2 class="g-dealer">バカラディーラー <small><span class="tag">チップ${db.dataset.type === 'in' ? '補充' : '回収'}</span></small></h2>${renderPad(null)}`;
      return fitPanel();
    }
    const act = t.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'entry' || a === 'reentry') {
        const fee = a === 'entry' ? (state.config.tourFee ?? 20) : (state.config.reentryFee ?? state.config.tourFee ?? 20);
        return sendClose({ no: openNo, game: 'tour', type: a, pt: Number(fee) }, `${a === 'entry' ? 'エントリー' : 'リエントリー'} +1(${fee}万)`);
      }
      // 飛び: プライズが確定していれば順位を選ぶ。無ければそのまま飛び
      if (a === 'bust') {
        if (!K.parsePrizes(state.config).length) return sendClose({ no: openNo, game: 'tour', type: 'bust', pt: 0 }, '飛び');
        pad = { type: 'rank' }; return renderPanel();
      }
      if (a === 'home') { pad = null; return startHome(); }
      if (a === 'bustOut') { pad = null; if (home) return homeDone({ no: home.no, game: 'tour', type: 'bust', pt: 0 }, 'トーナメント 飛び(圏外)'); return sendClose({ no: openNo, game: 'tour', type: 'bust', pt: 0 }, '飛び(圏外)'); }
      pad = { type: a, value: '', allowNeg: false, neg: false }; return renderPanel();
    }
    const rk = t.closest('[data-rank]');
    if (rk) {
      const i = Number(rk.dataset.rank), pt = K.parsePrizes(state.config)[i], label = K.rankLabel(i);
      pad = null;
      if (home) return homeDone({ no: home.no, game: 'tour', type: 'prize', pt, table: label }, `${label} で終了 賞金 ${K.fmtPt(pt)}`);
      return sendClose({ no: openNo, game: 'tour', type: 'prize', pt, table: label }, `${label} で終了 賞金 ${K.fmtPt(pt)}`);
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
    if (t.closest('[data-padcancel]')) { pad = null; home = null; return openNo === 0 ? renderDealer() : renderPanel(); }
    if (t.closest('[data-padok]') && pad) {
      const n = Number(pad.value || 0) * (pad.neg ? -1 : 1);
      if (!n && !pad.allowZero) return;
      const p = pad; pad = null;
      if (p.home && home) return homeDone({ no: home.no, game: p.game, type: 'out', pt: n }, `${K.GAMES[p.game]} OUT ${n}万(帰宅)`);
      if (openNo === 0) {
        closeSheet();
        return send({ game: 'dealer', table: 'bac', type: p.type === 'dealerIn' ? 'in' : 'out', pt: n }, `バカラディーラー チップ${p.type === 'dealerIn' ? '補充' : '回収'} ${K.signedPt(n)}`);
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
    ['input', 'players', 'log', 'sum', 'set'].forEach(k => $('#tab-' + k).classList.toggle('hide', k !== tab));
    if (tab !== 'sum') $('#preview').innerHTML = '';
    window.scrollTo(0, 0); // タブを押したら一番上から
    refresh();
  });
  $('#setDate').addEventListener('change', e => { date = e.target.value || K.todayJST(); localStorage.setItem('kt.date2', JSON.stringify({ date, on: K.todayJST() })); rosterSig = null; refresh(); doSync(true); });
  async function askFee(key, label) {
    const cur = state.config[key] ?? 20;
    const v = prompt(`${label}(万)`, cur);
    if (v == null || v === '' || isNaN(Number(v))) return;
    try { await refresh(await API.setConfig(date, { [key]: Number(v) })); } catch (e) { toast('保存できませんでした', e.message, true); }
  }
  // ---------- プライズ傾斜の自動計算 ----------
  // X = 入賞人数、Y = 最低賞金。自動計算 → 金額を手で直す → 確定で順位に適用。
  // 下書き(pc.draft)は確定するまで端末の中だけ(自動同期で消えないよう、画面の作り直しでも触らない)
  const pc = { x: null, y: null, draft: null };
  function pcDefaults() {
    if (pc.x == null) pc.x = Number(state.config.prizeX) || 6;
    if (pc.y == null) pc.y = Number(state.config.prizeY) || Number(state.config.tourFee ?? 20) * 2;
  }
  function renderCalcHead() {
    pcDefaults();
    const pool = agg.totals.tour.in, t = agg.totals.tour;
    $('#pcPool').textContent = K.fmtPt(pool);
    $('#pcPoolInfo').textContent = `トーナメントの IN 合計(${t.e + t.re} エントリー)`;
    $('#pcX').textContent = pc.x + '人';
    $('#pcY').textContent = pc.y + '万';
    const r = K.calcPrizes(pool, pc.x, pc.y);
    $('#pcA').textContent = r.error ? r.error : `${K.round1(r.a)}万`;
    $('#pcA').classList.toggle('pc-warn', !!r.error);
    if (pc.draft) renderDraftSum();
  }
  function renderDraft() {
    $('#pcDraft').classList.toggle('hide', !pc.draft);
    if (!pc.draft) return;
    $('#pcRows').innerHTML = pc.draft.map((v, i) => `<div class="prize-r"><span class="lbl">${K.rankLabel(i)}</span><span data-jump="${i}"></span><input data-pi="${i}" inputmode="decimal" value="${v}"></div>`).join('');
    renderDraftSum();
  }
  // プライズジャンプ = 1つ下の順位との差(1つ上がるといくら増えるか)
  function jumpOf(list, i) { return i < list.length - 1 ? K.round1((Number(list[i]) || 0) - (Number(list[i + 1]) || 0)) : null; }
  function jumpHtml(list, i) { const j = jumpOf(list, i); return `<span class="jump ${j != null && j < 0 ? 'neg' : ''}">${j == null ? '' : `ジャンプ ${K.signedPt(j)}`}</span>`; }
  function renderDraftSum() {
    document.querySelectorAll('#pcRows [data-jump]').forEach(el => { const i = Number(el.dataset.jump), j = jumpOf(pc.draft, i); el.className = 'jump' + (j != null && j < 0 ? ' neg' : ''); el.textContent = j == null ? '' : `ジャンプ ${K.signedPt(j)}`; });
    const sum = K.round1(pc.draft.reduce((a, b) => a + (Number(b) || 0), 0)), pool = agg.totals.tour.in, diff = K.round1(pool - sum);
    $('#pcSum').textContent = K.fmtPt(sum);
    $('#pcDiff').textContent = diff === 0 ? 'プールとぴったり' : `プールとの差 ${K.signedPt(diff)}`;
    $('#pcDiff').classList.toggle('pc-warn', diff !== 0);
  }
  $('#prizeCalc').addEventListener('click', e => {
    const b = e.target.closest('.stepper button');
    if (b) {
      const k = b.closest('.stepper').dataset.k, d = Number(b.dataset.d);
      pcDefaults();
      if (k === 'x') pc.x = Math.max(1, Math.min(50, pc.x + d));
      if (k === 'y') pc.y = Math.max(0, pc.y + d);
      return renderCalcHead();
    }
    if (e.target.closest('#pcCalc')) {
      const r = K.calcPrizes(agg.totals.tour.in, pc.x, pc.y);
      if (r.error) return toast('計算できません', r.error, true);
      pc.draft = r.prizes.slice();
      return renderDraft();
    }
    if (e.target.closest('#pcApply')) {
      if (!pc.draft) return;
      const vals = pc.draft.map(v => K.round1(Number(v)));
      if (vals.some(v => !(v >= 0))) return toast('金額を確認してください', '数字でない欄があります', true);
      API.setConfig(date, { prizes: vals.join(','), prizeX: pc.x, prizeY: pc.y }).then(st => {
        pc.draft = null; renderDraft(); refresh(st);
        toast('プライズを確定しました', vals.map((v, i) => `${K.rankLabel(i)} ${v}`).join(' ／ '));
      });
    }
  });
  // ---------- プライズをテキストで出す(LINE などに貼る用) ----------
  // 1位から順に、円の金額をカンマ区切りで1行ずつ(順位・単位・見出しなし) 例: 1,150,000
  function prizeText(list) {
    return list.map(v => Math.round(v * 10000).toLocaleString('ja-JP')).join('\n');
  }
  async function shareText(text) {
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast('コピーしました', 'LINE などに貼り付けできます'); return; } catch (e) { }
    // どちらも使えないときは選択できる形で出す
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:8px;right:8px;top:30%;height:40%;z-index:60;font-size:16px;border-radius:12px;padding:12px';
    document.body.appendChild(ta); ta.select(); setTimeout(() => ta.remove(), 15000);
    toast('長押しでコピーしてください', '', false);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-prize-text]'); if (!b) return;
    const draft = b.dataset.prizeText === 'draft';
    const list = draft ? (pc.draft || []).map(v => Number(v) || 0) : K.parsePrizes(state.config);
    if (!list.length) return toast('プライズがまだありません', '自動計算してから出せます', true);
    shareText(prizeText(list));
  });
  $('#prizeCalc').addEventListener('input', e => {
    const inp = e.target.closest('input[data-pi]'); if (!inp || !pc.draft) return;
    pc.draft[Number(inp.dataset.pi)] = inp.value.replace(/[^0-9.]/g, '');
    renderDraftSum();
  });
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
  $('#lockNow').addEventListener('click', () => { if (window.KashitakuLock) KashitakuLock.lock(); });
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
