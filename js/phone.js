// casa 貸卓 — スマホ入力画面
(() => {
  const K = Kashitaku, API = KashitakuAPI, CFG = KASHITAKU_CONFIG;
  const PY = CFG.POINT_YEN || 10000;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cls = v => v > 0 ? 'plus' : v < 0 ? 'minus' : 'zero';

  let date = localStorage.getItem('kt.date') || K.todayJST();
  let game = 'bac';
  let state = null, agg = null;
  let tab = 'input';
  let openNo = null;     // シートで開いている番号
  let lastTx = null;     // トーストの取り消し用
  let busy = false;
  let rosterSig = null;

  // ---------- 読み込み ----------
  async function refresh(st) {
    try {
      state = st || await API.getState(date);
      agg = K.aggregate(state.players, state.txs, state.config);
      setStatus(true);
      render();
    } catch (e) {
      setStatus(false, e.message);
    }
  }
  function setStatus(ok, msg) {
    $('#status').innerHTML = ok
      ? `<b>${API.mode === 'gas' ? 'シート接続中' : 'テストモード'}</b><br>${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} 更新`
      : `<b class="off">接続エラー</b><br>${esc(msg || '')}`;
  }
  const playerOf = no => agg.players.find(p => p.no === no) || K.emptyPlayer(no, (state.players.find(p => Number(p.no) === no) || {}).name);
  const nameOf = no => (state.players.find(p => Number(p.no) === no) || {}).name || '';
  const isReg = no => state.players.some(p => Number(p.no) === no);

  // ---------- 描画 ----------
  function render() {
    $('#hDate').textContent = date + (date === K.todayJST() ? '(今日)' : '');
    document.querySelectorAll('#games button').forEach(b => b.classList.toggle('on', b.dataset.game === game));
    renderGrid();
    renderLog();
    renderSum();
    renderSet();
    if (openNo != null && $('#sheet').classList.contains('show')) renderPanel();
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
    let html = '';
    for (let no = 1; no <= CFG.MAX_NO; no++) {
      const p = playerOf(no), reg = isReg(no);
      const s = p[game];
      let st = '';
      if (game === 'tour') { const n = s.e + s.re; if (n) st = `${n}回 ${s.in}万`; }
      else if (s.in || s.out) st = `${s.in}万${s.out ? ` → ${s.out}` : ''}`;
      const act = !!st;
      html += `<button class="cell g-${game} ${reg ? 'reg' : 'empty'} ${act ? 'act' : ''}" data-no="${no}">
        <div class="n">${no}</div>
        <div class="nm">${reg ? esc(p.name || '') : '—'}</div>
        ${st ? `<div class="st">${st}</div>` : ''}
      </button>`;
    }
    grid.innerHTML = html;
  }

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
      setTimeout(() => $('#nameInput').focus(), 50);
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
        <button class="btn in" data-act="reentry">リエントリー<br><small>${state.config.reentryFee ?? state.config.tourFee ?? 20}万</small></button>
        <button class="btn out full" data-act="prize">賞金</button></div>`;
    } else {
      statHtml = `<div class="stat">
        <div><span>合計 IN</span><b>${s.in}<small> 万</small></b></div>
        <div><span>OUT</span><b>${s.out}<small> 万</small></b></div>
        <div><span>収支</span><b class="${cls(s.pl)}">${K.signedPt(s.pl)}</b></div></div>`;
      actsHtml = `<div class="acts"><button class="btn in" data-act="in">IN</button><button class="btn out" data-act="out">OUT</button></div>`;
    }
    // この人・このゲームの入力履歴(2回タップで削除)
    const mine = state.txs.filter(t => Number(t.no) === no && t.game === game).sort((a, b) => b.ts - a.ts);
    const hist = mine.length ? `<div class="card log mini">${mine.map(t => `<div class="row"><div class="t">${(K.TYPES[t.type] || t.type)} <b>${t.pt}万</b> <i style="display:inline;margin-left:6px">${new Date(t.ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</i></div><button data-del="${t.id}">削除</button></div>`).join('')}</div>` : '';
    el.innerHTML = `<button class="close" data-close>✕</button>
      <h2 class="g-${game}">${no} ${esc(p.name)} <small><span class="tag">${K.GAMES[game]}</span></small></h2>
      ${statHtml}${pad ? renderPad(p) : actsHtml + hist}`;
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
    lastTx = null; toast('送信中…', label);
    try {
      const st = await API.addTx(date, tx);
      await refresh(st);
      const p = tx.game === 'dealer' ? null : playerOf(Number(tx.no));
      // 自分が今送った入力(取り消し用)
      lastTx = st.txs.find(t => t.id === st._lastId) || null;
      let t2 = '';
      if (p) {
        const s = p[tx.game];
        if (tx.game === 'tour') t2 = `合計 ${s.e + s.re}回 ／ IN ${s.in}万 ／ 収支 ${K.signedPt(s.pl)}`;
        else t2 = `合計 IN ${s.in}万 ／ OUT ${s.out}万 ／ 収支 ${K.signedPt(s.pl)}`;
      } else {
        const d = agg.dealer[tx.table || 'bac'];
        t2 = `補充 ${d.in}万 ／ 回収 ${d.out}万`;
      }
      toast(`${p ? `No.${p.no} ${esc(p.name)} ` : ''}${label}`, t2);
    } catch (e) { toast('送信できませんでした', e.message, true); }
    finally { busy = false; }
  }

  let toastTimer;
  function toast(t1, t2, err) {
    const el = $('#toast');
    $('#toastT1').innerHTML = t1; $('#toastT2').textContent = t2;
    el.classList.toggle('err', !!err); el.classList.add('show');
    $('#toastUndo').style.display = err || !lastTx ? 'none' : '';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 6000);
  }

  // ---------- イベント ----------
  $('#games').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; game = b.dataset.game; pad = null; render(); });
  $('#grid').addEventListener('click', e => { const c = e.target.closest('.cell'); if (c) { pad = null; openSheet(Number(c.dataset.no)); } });
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
      pad = { type: a, value: '', allowNeg: false, neg: false }; return renderPanel();
    }
    if (t.closest('[data-rename]')) {
      const cur = nameOf(openNo);
      $('#panel').innerHTML = `<button class="close" data-close>✕</button><h2>No.${openNo} <small>名前の変更</small></h2>
        <form class="nameform" id="nameForm"><input id="nameInput" value="${esc(cur)}" autocomplete="off"><button class="btn gold" type="submit">保存</button></form>`;
      setTimeout(() => $('#nameInput').focus(), 50); return;
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
    const id = lastTx.id; lastTx = null; $('#toast').classList.remove('show');
    try { await refresh(await API.undo(date, id)); toast('取り消しました', ''); } catch (e) { toast('取り消せませんでした', e.message, true); }
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
  $('#setDate').addEventListener('change', e => { date = e.target.value || K.todayJST(); localStorage.setItem('kt.date', date); refresh(); });
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
    try { const st = await API.register(date, no, name); state = st; agg = K.aggregate(st.players, st.txs, st.config); inp.classList.toggle('saved', !!name); }
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
    try { await refresh(await API.clearDay(date)); toast('消去しました', ''); } catch (e) { toast('消去できませんでした', e.message, true); }
  });
  $('#makeImage').addEventListener('click', async () => {
    const c = KashitakuImage.renderSummary(agg, date);
    $('#preview').innerHTML = ''; $('#preview').appendChild(c);
    const r = await KashitakuImage.shareCanvas(c, `casa貸卓_${date}.png`);
    if (r === 'downloaded') toast('画像を保存しました', '写真/ダウンロードを確認してください');
  });

  // 定期更新(他のスマホの入力を拾う)
  setInterval(() => { if (!document.hidden && !busy && !$('#sheet').classList.contains('show')) refresh(); }, API.mode === 'gas' ? 15000 : 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
})();
