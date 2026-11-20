// casa 貸卓 — 押し間違い防止(スマホ・iPad 共通)
// 「押したボタンと違うボタンが反応する」を防ぐ。
// ・ダブルタップの拡大を止める(2回目のタップが消えたり、ずれたりしない)
// ・指を置いた後に画面が作り直されて、指の下が別のボタンに変わったら、そのタップは無視する
// ・出てきたばかり/動いたばかりのボタンは、少しのあいだ押せない(閉じた直後の下の画面、開いた直後の画面も同じ)
// ・お知らせ(トースト)が消えた直後は、その場所のタップを無視する
// ・指が触れているあいだと離した直後は、裏の自動更新を待たせる(TapGuard.busy())
(function (g) {
  const FRESH_MS = 350;  // 出てきた・動いたボタンを押せるようになるまで
  const QUIET_MS = 450;  // 指を離してから、裏の更新を待たせる時間
  const CLICKABLE = 'button, a[href], input, select, textarea, summary, label, [data-close], [data-draw-close], [role="button"], .cell';

  const css = document.createElement('style');
  css.textContent = 'html{touch-action:manipulation}button,a,summary,label,.cell,[role="button"]{touch-action:manipulation;-webkit-touch-callout:none}';
  (document.head || document.documentElement).appendChild(css);

  const now = () => performance.now();
  const born = new WeakMap(); // ボタン → 出てきた/動いた時刻
  let seen = new Set();       // 前回の「ボタンの種類@位置」
  let floats = [];            // 前回見えていたお知らせ [{ el, rect }]
  let gone = [];              // 消えたお知らせの場所 [{ rect, t }]

  function keyOf(el) {
    if (el.id) return '#' + el.id;
    let k = el.tagName;
    for (const a of el.attributes) if (a.name.startsWith('data-')) k += ' ' + a.name + '=' + a.value;
    return k === el.tagName ? k + ' ' + (el.textContent || '').trim().slice(0, 24) : k;
  }
  // 変形(アニメーション)とスクロールに左右されない位置と大きさ
  function pos(el) {
    let x = 0, y = 0, n = el;
    while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return Math.round(x) + ',' + Math.round(y) + ',' + el.offsetWidth + 'x' + el.offsetHeight;
  }
  const shown = el => el.getClientRects().length > 0;
  // いちばん手前に出ている画面(シート・パスコードなど)。その外のボタンは覆われていて押せない
  function topLayer() {
    let top = null, z = -Infinity;
    document.querySelectorAll('[data-overlay]').forEach(o => {
      if (!shown(o)) return;
      const zi = parseInt(getComputedStyle(o).zIndex, 10) || 0;
      if (zi >= z) { z = zi; top = o; }
    });
    return top;
  }
  function snapshot() {
    const t = now(), layer = topLayer(), next = new Set();
    document.querySelectorAll(CLICKABLE).forEach(el => {
      if (!shown(el)) return;
      if (layer && !layer.contains(el) && !el.closest('[data-float]')) return;
      const id = keyOf(el) + '@' + pos(el);
      next.add(id);
      if (!seen.has(id)) born.set(el, t);
    });
    seen = next;
    // お知らせが消えたら、その場所をしばらく押せなくする(下のボタンを押してしまわないように)
    const nowFloats = [];
    document.querySelectorAll('[data-float]').forEach(el => { if (shown(el)) nowFloats.push({ el, rect: el.getBoundingClientRect() }); });
    floats.forEach(f => { if (!nowFloats.some(n => n.el === f.el)) gone.push({ rect: f.rect, t }); });
    floats = nowFloats;
    gone = gone.filter(x => t - x.t < FRESH_MS);
  }

  let pending = false;
  const schedule = () => { if (pending) return; pending = true; Promise.resolve().then(() => { pending = false; snapshot(); }); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled', 'open'] });
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule); else schedule();

  const pick = t => (t && t.closest) ? t.closest(CLICKABLE) : null;
  let down = null, pressing = 0, lastUp = 0;
  window.addEventListener('pointerdown', e => {
    if (pending) { pending = false; snapshot(); } // 直前の作り直しを反映してから判定
    const t = now(), el = pick(e.target);
    let block = !!(el && born.has(el) && t - born.get(el) < FRESH_MS);
    if (!block) block = gone.some(x => t - x.t < FRESH_MS && e.clientX >= x.rect.left && e.clientX <= x.rect.right && e.clientY >= x.rect.top && e.clientY <= x.rect.bottom);
    down = { el, t, block };
    pressing++;
  }, true);
  const up = () => { pressing = Math.max(0, pressing - 1); lastUp = now(); };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('click', e => {
    if (!e.isTrusted || e.detail === 0) return; // キーボード・プログラムからのクリックはそのまま
    const d = down; down = null;
    if (!d || now() - d.t > 3000) return;
    const el = pick(e.target);
    // 指を置いたボタンと、指を離したときのボタンが違う(途中で画面が作り直された) → 無視
    if (d.block || d.el !== el || (d.el && !d.el.isConnected)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // 中身が変わっても高さが変わらないように、出てくる可能性のある中身のうち一番高いものの高さを返す
  // (数字は幅のいちばん広い 8 にそろえて、同じ形のものは1回だけ測る)
  function tallest(box, htmls) {
    if (!box || !box.parentNode || !box.clientWidth) return 0;
    const probe = box.cloneNode(false);
    probe.removeAttribute('id'); probe.removeAttribute('style');
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:${box.getBoundingClientRect().width}px;min-height:0;height:auto`;
    box.parentNode.appendChild(probe);
    let max = 0;
    for (const h of new Set(htmls.map(x => String(x).replace(/[0-9]/g, '8')))) { probe.innerHTML = h; max = Math.max(max, probe.offsetHeight); }
    probe.remove();
    return Math.ceil(max);
  }

  g.TapGuard = {
    tallest,
    // 指が触れている、または離した直後なら true(このあいだは画面を作り直さない)
    busy: () => (pressing > 0 && down && now() - down.t < 5000) || now() - lastUp < QUIET_MS,
    refresh: snapshot,
  };
})(window);
