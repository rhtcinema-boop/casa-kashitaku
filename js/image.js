// casa 貸卓 — 収支一覧の画像(PNG)生成と共有
(function (g) {
  const K = g.Kashitaku;
  const PY = (g.KASHITAKU_CONFIG || {}).POINT_YEN || 10000;

  // agg: Kashitaku.aggregate の結果, date: 'YYYY-MM-DD', opts: { title }
  // 誰も参加していないゲームは列ごと出さない。トナメは IN・OUT・収支・IN回数・順位 の順
  function renderSummary(agg, date, opts) {
    opts = opts || {};
    const t = agg.totals, dl = agg.dealer.bac;
    const players = agg.players.filter(p => p.bac.in || p.bac.out || p.cash.in || p.cash.out || p.tour.in || p.tour.out || p.name);
    const fp = v => v.toLocaleString('ja-JP');
    const sp = v => (v > 0 ? '+' : '') + fp(v || 0);
    const colorOf = v => v > 0 ? '#007aff' : v < 0 ? '#ff3b30' : '#8e8e93';
    const DIM = 'rgba(60,60,67,.25)', BLACK = '#000000';
    // どのゲームに参加者がいたか
    const has = {
      bac: agg.players.some(p => p.bac.in || p.bac.out),
      cash: agg.players.some(p => p.cash.in || p.cash.out),
      tour: agg.players.some(p => p.tour.e + p.tour.re),
    };
    // 列: v = 各行の値、tot = 一番下(差額)の値、c = 色、dim = 薄くするか
    const cols = [
      { t: 'No', w: 60, a: 'center', v: p => p.no, tot: () => '' },
      { t: '名前', w: 180, a: 'left', bold: true, v: p => p.name || '(未登録)', tot: () => '差額(全員+ディーラー)' },
      { t: '合計収支', w: 130, a: 'right', big: true, v: p => sp(p.total), c: p => colorOf(p.total), tot: () => sp(t.allDiff) },
    ];
    if (has.bac) cols.push(
      { t: 'バカラ IN', w: 110, a: 'right', hc: '#007aff', v: p => fp(p.bac.in), dim: p => !p.bac.in, tot: () => fp(Math.round((t.bac.in + dl.in) * 10) / 10) },
      { t: '収支', w: 100, a: 'right', v: p => sp(p.bac.pl), c: p => colorOf(p.bac.pl), tot: () => sp(t.bacDiff) });
    if (has.cash) cols.push(
      { t: 'リング IN', w: 110, a: 'right', hc: '#30b0c7', v: p => fp(p.cash.in), dim: p => !p.cash.in, tot: () => fp(t.cash.in) },
      { t: '収支', w: 100, a: 'right', v: p => sp(p.cash.pl), c: p => colorOf(p.cash.pl), tot: () => sp(t.cash.pl) });
    if (has.tour) cols.push(
      { t: 'トナメ IN', w: 100, a: 'right', hc: '#5856d6', v: p => fp(p.tour.in), dim: p => !p.tour.in, tot: () => fp(t.tour.in) },
      { t: 'OUT', w: 90, a: 'right', hc: '#5856d6', v: p => fp(p.tour.out), dim: p => !p.tour.out, tot: () => fp(t.tour.out) },
      { t: '収支', w: 100, a: 'right', v: p => sp(p.tour.pl), c: p => colorOf(p.tour.pl), tot: () => sp(t.tour.pl) },
      { t: 'IN回数', w: 80, a: 'right', hc: '#5856d6', v: p => p.tour.e + p.tour.re, dim: p => !(p.tour.e + p.tour.re), tot: () => t.tour.e + t.tour.re },
      { t: '順位', w: 70, a: 'center', hc: '#5856d6', v: p => p.tour.rank || (p.tour.e + p.tour.re && !p.tour.alive ? '-' : ''), tot: () => '' });

    const tableW = cols.reduce((a, cl) => a + cl.w, 0);
    const W = Math.max(760, tableW + 80);
    const scale = 2, rowH = 54, headH = 150, footH = 200;
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
    fitFill(x, opts.title || 'casa 貸卓  収支一覧', 40, 44, W - 80);
    x.fillStyle = '#8e8e93'; x.font = font(18);
    fitFill(x, `${date}   ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} 現在   単位: 万円`, 40, 74, W - 80);
    let cx = 40; cols.forEach(cl => { cl.x = cx; cx += cl.w; });
    const colX = cl => cl.a === 'right' ? cl.x + cl.w - 8 : cl.a === 'center' ? cl.x + cl.w / 2 : cl.x + 8;
    const right = 40 + tableW;
    // ヘッダー
    let y = headH - 30;
    x.fillStyle = 'rgba(120,120,128,.1)'; x.fillRect(40, y - 20, tableW, 40);
    x.font = font(15, 700);
    cols.forEach(cl => { x.fillStyle = cl.hc || '#3c3c43'; x.textAlign = cl.a; fitFill(x, cl.t, colX(cl), y, cl.w - 8); });
    y += 20 + rowH / 2;
    // 各プレイヤー
    players.forEach((p, i) => {
      if (i % 2) { x.fillStyle = 'rgba(0,0,0,.025)'; x.fillRect(40, y - rowH / 2, tableW, rowH); }
      x.strokeStyle = 'rgba(60,60,67,.12)'; x.beginPath(); x.moveTo(40, y + rowH / 2); x.lineTo(right, y + rowH / 2); x.stroke();
      cols.forEach(cl => {
        x.textAlign = cl.a;
        x.font = font(cl.big ? 22 : 19, cl.big || cl.bold ? 700 : 400);
        x.fillStyle = cl.dim && cl.dim(p) ? DIM : cl.c ? cl.c(p) : BLACK;
        fitFill(x, String(cl.v(p)), colX(cl), y, cl.w - 12);
      });
      y += rowH;
    });
    // 一番下: 差額
    x.fillStyle = 'rgba(0,122,255,.08)'; x.fillRect(40, y - rowH / 2, tableW, rowH);
    x.font = font(19, 700); x.fillStyle = '#007aff';
    cols.forEach(cl => { x.textAlign = cl.a; fitFill(x, String(cl.tot()), colX(cl), y, cl.w - 12); });
    y += rowH;
    // フッター: 参加者がいたゲームだけ
    const house = -t.players;
    x.textAlign = 'left'; x.font = font(16); x.fillStyle = '#8e8e93';
    const shop = [has.bac && `バカラ ${sp(-t.bac.pl)}`, has.cash && `リング ${sp(-t.cash.pl)}`, has.tour && `トーナメント ${sp(-t.tour.pl)}`].filter(Boolean);
    let fy = y + 20;
    if (shop.length) { fitFill(x, `店側収支   ${shop.join('   ')}`, 40, fy, W - 80); fy += 30; }
    if (dl.in || dl.out) { fitFill(x, `バカラディーラー チップ   補充 ${fp(dl.in)} / 回収 ${fp(dl.out)}   差 ${sp(K.round1(dl.in - dl.out))}`, 40, fy, W - 80); fy += 26; }
    const pz = K.parsePrizes(agg.config);
    if (has.tour && pz.length) fitFill(x, `プライズ   ${pz.map((v, i) => `${K.rankLabel(i)} ${fp(v)}`).join('   ')}   (計 ${fp(pz.reduce((a, b) => a + b, 0))} / プール ${fp(t.tour.in)})`, 40, fy, W - 80);
    x.font = font(30, 700); x.fillStyle = colorOf(house);
    fitFill(x, `店側合計 ${sp(house)}万  (${K.signedYen(house, PY)})`, 40, y + 120, W - 80);
    return c;
  }

  // maxW に収まるまで文字を小さくして描く(列からはみ出さない)
  function fitFill(x, text, px, py, maxW) {
    const base = x.font, m = base.match(/(\d+(?:\.\d+)?)px/);
    let size = m ? parseFloat(m[1]) : 16;
    while (size > 8 && x.measureText(text).width > maxW) { size -= 1; x.font = base.replace(/\d+(?:\.\d+)?px/, size + 'px'); }
    x.fillText(text, px, py);
    x.font = base;
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
