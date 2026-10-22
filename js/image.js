// casa 貸卓 — 収支一覧の画像(PNG)生成と共有
(function (g) {
  const K = g.Kashitaku;
  const PY = (g.KASHITAKU_CONFIG || {}).POINT_YEN || 10000;

  // agg: Kashitaku.aggregate の結果, date: 'YYYY-MM-DD', opts: { title }
  function renderSummary(agg, date, opts) {
    opts = opts || {};
    const players = agg.players.filter(p => p.bac.in || p.bac.out || p.cash.in || p.cash.out || p.tour.in || p.tour.out || p.name);
    const scale = 2;
    const W = 1200;
    const rowH = 54, headH = 150, footH = 200;
    const H = headH + rowH * (players.length + 2) + footH;
    const c = document.createElement('canvas');
    c.width = W * scale; c.height = H * scale;
    const x = c.getContext('2d');
    x.scale(scale, scale);
    // 背景
    const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#f2f2f7');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.textBaseline = 'middle';
    const font = (sz, w) => `${w || 400} ${sz}px -apple-system, "Hiragino Sans", "Helvetica Neue", sans-serif`;
    // タイトル
    x.fillStyle = '#007aff'; x.font = font(24, 700); x.textAlign = 'left';
    x.fillText(opts.title || 'casa 貸卓  収支一覧', 40, 44);
    x.fillStyle = '#8e8e93'; x.font = font(18);
    x.fillText(`${date}   ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} 現在   単位: 万円`, 40, 74);
    // 列
    const cols = [
      { k: 'no', t: 'No', w: 60, a: 'center' }, { k: 'name', t: '名前', w: 200, a: 'left' },
      { k: 'bacIn', t: 'バカラ IN', w: 110, a: 'right', col: '#007aff' }, { k: 'bacPl', t: '収支', w: 100, a: 'right' },
      { k: 'cashIn', t: 'リング IN', w: 110, a: 'right', col: '#30b0c7' }, { k: 'cashPl', t: '収支', w: 100, a: 'right' },
      { k: 'tourE', t: 'T 回数', w: 80, a: 'right', col: '#5856d6' }, { k: 'tourIn', t: 'T IN', w: 90, a: 'right', col: '#5856d6' }, { k: 'tourPl', t: '収支', w: 100, a: 'right' },
      { k: 'total', t: '合計収支', w: 130, a: 'right' },
    ];
    let cx = 40; cols.forEach(cl => { cl.x = cx; cx += cl.w; });
    const colX = cl => cl.a === 'right' ? cl.x + cl.w - 8 : cl.a === 'center' ? cl.x + cl.w / 2 : cl.x + 8;
    // ヘッダー
    let y = headH - 30;
    x.fillStyle = 'rgba(120,120,128,.1)'; x.fillRect(40, y - 20, W - 80, 40);
    x.font = font(15, 700);
    cols.forEach(cl => { x.fillStyle = cl.col || '#3c3c43'; x.textAlign = cl.a; x.fillText(cl.t, colX(cl), y); });
    y += 20 + rowH / 2;
    const fp = v => v.toLocaleString('ja-JP');
    const sp = v => (v > 0 ? '+' : '') + fp(v || 0);
    const colorOf = v => v > 0 ? '#007aff' : v < 0 ? '#ff3b30' : '#8e8e93';
    players.forEach((p, i) => {
      if (i % 2) { x.fillStyle = 'rgba(0,0,0,.025)'; x.fillRect(40, y - rowH / 2, W - 80, rowH); }
      x.strokeStyle = 'rgba(60,60,67,.12)'; x.beginPath(); x.moveTo(40, y + rowH / 2); x.lineTo(W - 40, y + rowH / 2); x.stroke();
      const vals = { no: p.no, name: p.name || '(未登録)', bacIn: fp(p.bac.in), bacPl: sp(p.bac.pl), cashIn: fp(p.cash.in), cashPl: sp(p.cash.pl), tourE: p.tour.e + p.tour.re, tourIn: fp(p.tour.in), tourPl: sp(p.tour.pl), total: sp(p.total) };
      cols.forEach(cl => {
        x.textAlign = cl.a;
        x.font = font(cl.k === 'total' ? 22 : 19, cl.k === 'total' || cl.k === 'name' ? 700 : 400);
        x.fillStyle = /Pl|total/.test(cl.k) ? colorOf(p[cl.k === 'total' ? 'total' : cl.k.replace('Pl', '')].pl ?? p.total) : '#000000';
        if (cl.k === 'total') x.fillStyle = colorOf(p.total);
        if ((cl.k === 'bacIn' && !p.bac.in) || (cl.k === 'cashIn' && !p.cash.in) || (cl.k === 'tourIn' && !p.tour.in) || (cl.k === 'tourE' && !(p.tour.e + p.tour.re))) x.fillStyle = 'rgba(60,60,67,.25)';
        x.fillText(String(vals[cl.k]), colX(cl), y);
      });
      y += rowH;
    });
    // 合計行
    const t = agg.totals;
    x.fillStyle = 'rgba(0,122,255,.08)'; x.fillRect(40, y - rowH / 2, W - 80, rowH);
    x.font = font(19, 700); x.fillStyle = '#007aff';
    const tv = { no: '', name: 'プレイヤー合計', bacIn: fp(t.bac.in), bacPl: sp(t.bac.pl), cashIn: fp(t.cash.in), cashPl: sp(t.cash.pl), tourE: t.tour.e + t.tour.re, tourIn: fp(t.tour.in), tourPl: sp(t.tour.pl), total: sp(t.players) };
    cols.forEach(cl => { x.textAlign = cl.a; x.fillText(String(tv[cl.k]), colX(cl), y); });
    y += rowH;
    // フッター: 店側
    const d = agg.dealer;
    const house = -t.players;
    x.textAlign = 'left'; x.font = font(16); x.fillStyle = '#8e8e93';
    x.fillText(`店側収支   バカラ ${sp(-t.bac.pl)}   リング ${sp(-t.cash.pl)}   トーナメント ${sp(-t.tour.pl)}`, 40, y + 20);
    x.fillText(`バカラ ディーラー チップ   補充 ${fp(d.bac.in)} / 回収 ${fp(d.bac.out)}   差 ${sp(d.bac.in - d.bac.out)}`, 40, y + 50);
    const pz = K.parsePrizes(agg.config);
    if (pz.length) x.fillText(`プライズ   ${pz.map((v, i) => `${K.rankLabel(i)} ${fp(v)}`).join('   ')}   (計 ${fp(pz.reduce((a, b) => a + b, 0))} / プール ${fp(t.tour.in)})`, 40, y + 76);
    x.font = font(30, 700); x.fillStyle = colorOf(house);
    x.fillText(`店側合計 ${sp(house)}万  (${K.signedYen(house, PY)})`, 40, y + 120);
    return c;
  }

  async function shareCanvas(canvas, filename) {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancel'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return 'downloaded';
  }

  g.KashitakuImage = { renderSummary, shareCanvas };
})(window);
