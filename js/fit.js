// casa 貸卓 — 文字が枠からはみ出さないように、収まるまで文字を小さくする
// 使い方: fitText(要素, { min: 最小px })。子要素の文字サイズを em で指定しておくと、まとめて縮む。
(function (g) {
  function overflowing(el, widthOnly) {
    return el.scrollWidth > el.clientWidth + 1 || (!widthOnly && el.scrollHeight > el.clientHeight + 1);
  }
  function fitText(el, opts) {
    if (!el || !el.isConnected || !el.clientWidth) return;
    const min = (opts && opts.min) || 9;
    el.style.fontSize = '';
    let fs = parseFloat(getComputedStyle(el).fontSize) || 16;
    let guard = 40;
    const wo = !!(opts && opts.widthOnly); // 高さを決めてある所は横だけ見る(文字の上下のはみ出しで小さくしない)
    while (guard-- > 0 && fs > min && overflowing(el, wo)) {
      fs = Math.max(min, fs - (fs > 20 ? 2 : 1));
      el.style.fontSize = fs + 'px';
    }
  }
  function fitAll(selector, opts, root) {
    (root || document).querySelectorAll(selector).forEach(el => fitText(el, opts));
  }
  // 1行に収める: 入りきらなければ文字を小さくする(元の大きさの ratio 倍まで)。それでも無理なら折り返す
  // まとめて読んでからまとめて書く(画面の再計算を何度もさせない)
  function fitLines(els, opts) {
    const ratio = (opts && opts.ratio) || .6, min = (opts && opts.min) || 9;
    els = [...els].filter(el => el && el.isConnected);
    els.forEach(el => { el.style.fontSize = ''; el.style.whiteSpace = 'nowrap'; });
    const m = els.map(el => ({ el, sw: el.scrollWidth, cw: el.clientWidth, fs: parseFloat(getComputedStyle(el).fontSize) || 16 }));
    m.forEach(x => {
      if (!x.cw || x.sw <= x.cw + 1) return;
      const fs = Math.floor(x.fs * (x.cw - 1) / x.sw * 10) / 10;
      if (fs < Math.max(min, x.fs * ratio)) x.el.style.whiteSpace = ''; // 小さくしすぎるくらいなら折り返す
      else x.el.style.fontSize = fs + 'px';
    });
  }
  g.fitText = fitText;
  g.fitLines = fitLines;
  g.fitAll = fitAll;
})(window);
