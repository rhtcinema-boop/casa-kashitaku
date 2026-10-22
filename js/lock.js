// casa 貸卓 — 4桁の PIN でアプリを開く(端末ごとに1回入れれば次から不要)
// PIN そのものはコードに書かず、ハッシュだけで照合する。
(function () {
  const HASH = '6f5c5bdc722b048f2d13e9a46bc90be675c2a1d50d8f855407d04ca586615567';
  const KEY = 'kt.unlock';
  // 設定の「この端末をロック」から呼ぶ
  window.KashitakuLock = { lock() { try { localStorage.removeItem(KEY); } catch (e) { } location.reload(); } };
  let ok = false;
  try { ok = localStorage.getItem(KEY) === HASH; } catch (e) { }
  if (ok) return;

  const css = `
  #ktLock { position: fixed; inset: 0; z-index: 1000; background: var(--bg, #f2f2f7); color: var(--text, #000); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 24px; font-family: -apple-system, "Hiragino Sans", sans-serif; user-select: none; -webkit-user-select: none; }
  #ktLock h1 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text2, #8e8e93); letter-spacing: .04em; }
  #ktLock .ttl { font-size: 26px; font-weight: 700; }
  #ktLock .dots { display: flex; gap: 18px; height: 18px; }
  #ktLock .dots i { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--blue, #007aff); }
  #ktLock .dots i.on { background: var(--blue, #007aff); }
  #ktLock .dots.ng { animation: ktShake .35s; }
  @keyframes ktShake { 20%, 60% { transform: translateX(-10px); } 40%, 80% { transform: translateX(10px); } }
  #ktLock .keys { display: grid; grid-template-columns: repeat(3, 84px); gap: 16px; }
  #ktLock .keys button { width: 84px; height: 84px; border-radius: 50%; border: 0; background: var(--fill, rgba(120,120,128,.12)); color: var(--text, #000); font-size: 34px; font-weight: 400; font-family: inherit; cursor: pointer; }
  #ktLock .keys button:active { background: var(--fill2, rgba(120,120,128,.3)); }
  #ktLock .keys button.fn { background: transparent; font-size: 18px; color: var(--blue, #007aff); }
  #ktLock .msg { height: 20px; font-size: 15px; color: var(--red, #ff3b30); }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'ktLock';
  el.innerHTML = `<h1>CASA 貸卓</h1><div class="ttl">パスコードを入力</div>
    <div class="dots"><i></i><i></i><i></i><i></i></div><div class="msg"></div>
    <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}<button class="fn" data-n="c">クリア</button><button data-n="0">0</button><button class="fn" data-n="b">削除</button></div>`;
  const mount = () => { document.body.appendChild(el); document.documentElement.style.overflow = 'hidden'; };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  let code = '';
  const dots = () => el.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i < code.length));
  async function hash(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('casa-kashitaku:' + s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function check() {
    const h = await hash(code);
    if (h === HASH) {
      try { localStorage.setItem(KEY, HASH); } catch (e) { }
      el.remove(); document.documentElement.style.overflow = '';
      return;
    }
    const d = el.querySelector('.dots'); d.classList.remove('ng'); void d.offsetWidth; d.classList.add('ng');
    el.querySelector('.msg').textContent = 'パスコードが違います';
    code = ''; setTimeout(dots, 300);
  }
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    const n = b.dataset.n;
    el.querySelector('.msg').textContent = '';
    if (n === 'c') code = ''; else if (n === 'b') code = code.slice(0, -1); else if (code.length < 4) code += n;
    dots();
    if (code.length === 4) check();
  });
  // 外付けキーボードでも入力できる
  document.addEventListener('keydown', e => {
    if (!document.getElementById('ktLock')) return;
    if (/^[0-9]$/.test(e.key) && code.length < 4) { code += e.key; dots(); if (code.length === 4) check(); }
    if (e.key === 'Backspace') { code = code.slice(0, -1); dots(); }
  });
})();
