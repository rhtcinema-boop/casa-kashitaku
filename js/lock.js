// casa 貸卓 — 4桁のパスコード
// ・アプリを開くたびに毎回たずねる(端末には覚えさせない)
// ・ほかのアプリに切り替えて 30 秒以上たってから戻ったときも、もう一度たずねる
// パスコードそのものはコードに書かず、ハッシュだけで照合する。
(function () {
  const HASH = '6f5c5bdc722b048f2d13e9a46bc90be675c2a1d50d8f855407d04ca586615567';
  const AWAY_MS = 30 * 1000;
  try { localStorage.removeItem('kt.unlock'); } catch (e) { } // 以前の「覚える」設定を消す

  const css = `
  #ktLock { position: fixed; inset: 0; z-index: 1000; background: var(--bg, #f2f2f7); color: var(--text, #000); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 24px; font-family: -apple-system, "Hiragino Sans", sans-serif; user-select: none; -webkit-user-select: none; }
  #ktLock h1 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text2, #8e8e93); letter-spacing: .04em; }
  #ktLock .ttl { font-size: 26px; font-weight: 700; }
  #ktLock .dots { display: flex; gap: 18px; height: 18px; }
  #ktLock .dots i { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--blue, #007aff); }
  #ktLock .dots i.on { background: var(--blue, #007aff); }
  #ktLock .dots.ng { animation: ktShake .35s; }
  @keyframes ktShake { 20%, 60% { transform: translateX(-10px); } 40%, 80% { transform: translateX(10px); } }
  #ktLock .keys { display: grid; grid-template-columns: repeat(3, min(84px, 26vw)); gap: min(16px, 4vw); }
  #ktLock .keys button { width: min(84px, 26vw); height: min(84px, 26vw); border-radius: 50%; border: 0; background: var(--fill, rgba(120,120,128,.12)); color: var(--text, #000); font-size: 34px; font-weight: 400; font-family: inherit; cursor: pointer; }
  #ktLock .keys button:active { background: var(--fill2, rgba(120,120,128,.3)); }
  #ktLock .keys button.fn { background: transparent; font-size: 18px; color: var(--blue, #007aff); }
  #ktLock .msg { height: 20px; font-size: 15px; color: var(--red, #ff3b30); }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  let el = null, code = '';
  const dots = () => el && el.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i < code.length));
  async function hash(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('casa-kashitaku:' + s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function show() {
    if (el) return;
    code = '';
    el = document.createElement('div'); el.id = 'ktLock';
    el.innerHTML = `<h1>CASA 貸卓</h1><div class="ttl">パスコードを入力</div>
      <div class="dots"><i></i><i></i><i></i><i></i></div><div class="msg"></div>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}<button class="fn" data-n="c">クリア</button><button data-n="0">0</button><button class="fn" data-n="b">削除</button></div>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-n]'); if (!b) return;
      press(b.dataset.n);
    });
    const mount = () => { document.body.appendChild(el); document.documentElement.style.overflow = 'hidden'; };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
  function hide() { if (el) el.remove(); el = null; code = ''; document.documentElement.style.overflow = ''; }
  function press(n) {
    if (!el) return;
    el.querySelector('.msg').textContent = '';
    if (n === 'c') code = ''; else if (n === 'b') code = code.slice(0, -1); else if (code.length < 4) code += n;
    dots();
    if (code.length === 4) check();
  }
  async function check() {
    if ((await hash(code)) === HASH) return hide();
    const d = el.querySelector('.dots'); d.classList.remove('ng'); void d.offsetWidth; d.classList.add('ng');
    el.querySelector('.msg').textContent = 'パスコードが違います';
    code = ''; setTimeout(dots, 300);
  }
  // 外付けキーボードでも入力できる
  document.addEventListener('keydown', e => {
    if (!el) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    if (e.key === 'Backspace') press('b');
  });
  // 開くたびに表示
  show();
  // ほかのアプリから 30 秒以上たって戻ったら、もう一度
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) show();
  });
  window.addEventListener('pageshow', e => { if (e.persisted) show(); }); // 戻るボタン等でキャッシュから復帰したとき
  window.KashitakuLock = { lock: show };
})();
