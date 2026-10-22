// casa 貸卓 — 文字が枠からはみ出さないように、収まるまで文字を小さくする
// 使い方: fitText(要素, { min: 最小px })。子要素の文字サイズを em で指定しておくと、まとめて縮む。
(function (g) {
  function overflowing(el) {
    return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  }
  function fitText(el, opts) {
    if (!el || !el.isConnected || !el.clientWidth) return;
    const min = (opts && opts.min) || 9;
    el.style.fontSize = '';
    let fs = parseFloat(getComputedStyle(el).fontSize) || 16;
    let guard = 40;
    while (guard-- > 0 && fs > min && overflowing(el)) {
      fs = Math.max(min, fs - (fs > 20 ? 2 : 1));
      el.style.fontSize = fs + 'px';
    }
  }
  function fitAll(selector, opts, root) {
    (root || document).querySelectorAll(selector).forEach(el => fitText(el, opts));
  }
  g.fitText = fitText;
  g.fitAll = fitAll;
})(window);
