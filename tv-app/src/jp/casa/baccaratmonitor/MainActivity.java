package jp.casa.baccaratmonitor;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.speech.tts.TextToSpeech;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyStore;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * casa バカラ モニター(Fire TV 用)。スロットのアプリと同じ作り:
 * - 画面(monitor.html など)はアプリに内蔵して https://appassets.androidplatform.net/www/ から出す。
 *   古い Fire Stick でも、公開サイトの証明書に関係なく必ず映る。
 * - 新しい版は公開サイトから自分で取ってきて差し替える(起動15秒後と10分ごと)。URL もアプリもそのまま。
 *   古い端末向けに Let's Encrypt のルート証明書(ISRG Root X1/X2)を同梱して確認する。
 * - 結果のデータは Google(Apps Script)から 1 秒ごとに取る(画面側の処理)。
 * - 画面を消さない。描画が落ちても作り直す。
 * - リモコン: 決定=設定(画面サイズ)、戻る=設定を閉じる、メニュー=読み直し。アプリの終了はホームボタン。
 * - 判定の読み上げ: テレビ本体の読み上げ機能(TextToSpeech、日本語)を画面から window.casaTTS.speak(文) で使う。
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String BASE = "https://" + HOST + "/www/";
    private static final String SITE = "https://rhtcinema-boop.github.io/casa-kashitaku/";
    private static final String[] FILES = { "monitor.html", "config.js", "js/road-core.js", "ver.txt" };
    private static final long UPDATE_EVERY = 10 * 60 * 1000L;

    private final Handler handler = new Handler();
    private WebView web;
    private volatile File liveDir;
    // 更新はアプリ全体で1本だけ(画面を作り直しても古い処理と重ならないように)
    private static final Object FILE_LOCK = new Object();
    private static volatile boolean updBusy = false;
    private volatile boolean destroyed = false;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;

    /** 画面(monitor.html)から呼ぶ読み上げ。WebView の中では speechSynthesis が使えないため */
    public class Speaker {
        @JavascriptInterface public boolean ready() { return ttsReady; }
        @JavascriptInterface public void speak(String text) {
            if (ttsReady && text != null) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "casa");
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#05080a"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " casaTV");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                view.post(new Runnable() { public void run() { recreate(); } });
                return true;
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost()); // 外のページへは移動しない
            }
        });
        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            public void onInit(int status) {
                if (status != TextToSpeech.SUCCESS) return;
                int r = tts.setLanguage(Locale.JAPAN);
                ttsReady = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
            }
        });
        web.addJavascriptInterface(new Speaker(), "casaTTS");
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);
        web.requestFocus();
        hideBars();
        pickLive();
        load();
        handler.postDelayed(updater, 15000);
    }

    private void load() {
        if (destroyed) return;
        web.loadUrl(BASE + "monitor.html?app=1");
    }

    // ---------- 内蔵の画面を出す ----------
    private WebResourceResponse serve(Uri u) {
        if (u == null || !HOST.equals(u.getHost())) return null; // Google など外への通信はそのまま
        String path = u.getPath();
        if (path == null || !path.startsWith("/www/")) return notFound();
        String rel = path.substring(5);
        if (rel.length() == 0) rel = "monitor.html";
        if (rel.contains("..")) return notFound();
        InputStream in = null;
        File dir = liveDir;
        try {
            if (dir != null) {
                File f = new File(dir, rel);
                if (f.isFile()) in = new FileInputStream(f);
            }
            if (in == null) in = getAssets().open("www/" + rel);
        } catch (IOException e) {
            return notFound();
        }
        String mime = "application/octet-stream", enc = "utf-8";
        if (rel.endsWith(".html")) mime = "text/html";
        else if (rel.endsWith(".js")) mime = "application/javascript";
        else if (rel.endsWith(".css")) mime = "text/css";
        else if (rel.endsWith(".json")) mime = "application/json";
        else if (rel.endsWith(".txt")) mime = "text/plain";
        else if (rel.endsWith(".png")) { mime = "image/png"; enc = null; }
        Map<String, String> h = new HashMap<String, String>();
        h.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, enc, 200, "OK", h, in);
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    // ---------- 自動アップデート(中身だけ差し替え) ----------
    private final Runnable updater = new Runnable() {
        public void run() {
            startUpdate();
            handler.postDelayed(this, UPDATE_EVERY);
        }
    };

    private static long verNum(String v) {
        try { return Long.parseLong(v.replaceAll("[^0-9]", "")); } catch (Exception e) { return 0; }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        } finally { in.close(); }
    }

    private String bundledVersion() {
        try { return new String(readAll(getAssets().open("www/ver.txt")), "UTF-8").trim(); } catch (Exception e) { return ""; }
    }

    private static String liveVersion(File dir) {
        try { return new String(readAll(new FileInputStream(new File(dir, "ver.txt"))), "UTF-8").trim(); } catch (Exception e) { return ""; }
    }

    private static void wipe(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) wipe(k);
        f.delete();
    }

    /** 起動時: 取り込んだ版が内蔵版より新しく、中身がそろっているときだけ使う(新しい APK を入れたら内蔵版に戻る) */
    private void pickLive() {
        synchronized (FILE_LOCK) {
            File live = new File(getFilesDir(), "www-live");
            if (live.isDirectory() && verNum(liveVersion(live)) > verNum(bundledVersion()) && complete(live)) liveDir = live;
            else { wipe(live); liveDir = null; }
        }
    }

    /** 取り込んだファイルが全部あって空でない(電源断などで壊れていない) */
    private static boolean complete(File dir) {
        for (String f : FILES) {
            File x = new File(dir, f);
            if (!x.isFile() || x.length() == 0) return false;
        }
        try { return new String(readAll(new FileInputStream(new File(dir, "monitor.html"))), "UTF-8").contains("</html>"); }
        catch (Exception e) { return false; }
    }

    private void startUpdate() {
        synchronized (FILE_LOCK) {
            if (updBusy) return;
            updBusy = true;
        }
        new Thread(new Runnable() {
            public void run() {
                try {
                    boolean changed;
                    synchronized (FILE_LOCK) { changed = doUpdate(); }
                    if (changed) handler.post(new Runnable() { public void run() { load(); } });
                } catch (Throwable e) {
                    // 通信できないときは今の版のまま。次の回にまた試す
                } finally {
                    updBusy = false;
                }
            }
        }).start();
    }

    /** 新しい版があれば取り込んで true。1ファイルでも取れなければ何も変えない */
    private boolean doUpdate() throws Exception {
        String bust = "_=" + System.currentTimeMillis();
        String remote = new String(http(SITE + "ver.txt?" + bust), "UTF-8").trim();
        File cur = liveDir;
        String now = cur != null ? liveVersion(cur) : bundledVersion();
        if (verNum(remote) <= verNum(now)) return false;
        File stage = new File(getFilesDir(), "www-new");
        wipe(stage);
        for (String f : FILES) {
            byte[] body = http(SITE + f + "?" + bust);
            if (body.length == 0) throw new IOException("empty " + f);
            if (f.equals("monitor.html") && !new String(body, "UTF-8").contains("</html>")) throw new IOException("broken");
            File out = new File(stage, f);
            File dir = out.getParentFile();
            if (dir != null) dir.mkdirs();
            FileOutputStream os = new FileOutputStream(out);
            try { os.write(body); os.getFD().sync(); } finally { os.close(); } // 電源が切れても中途半端なファイルを残さない
        }
        // 取っている途中で公開が切り替わったら(新旧が混ざるおそれ)、今回は見送る
        String after = new String(http(SITE + "ver.txt?" + bust + "b"), "UTF-8").trim();
        if (!after.equals(remote) || !liveVersion(stage).equals(remote) || !complete(stage)) { wipe(stage); return false; }
        File live = new File(getFilesDir(), "www-live");
        liveDir = null;
        wipe(live);
        if (!stage.renameTo(live)) throw new IOException("rename");
        liveDir = live;
        return true;
    }

    private SSLSocketFactory sslFactory;

    private byte[] http(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        if (c instanceof HttpsURLConnection) ((HttpsURLConnection) c).setSSLSocketFactory(ssl());
        try {
            c.setConnectTimeout(10000);
            c.setReadTimeout(20000);
            c.setUseCaches(false);
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            return readAll(c.getInputStream());
        } finally { c.disconnect(); }
    }

    /** 端末の証明書 + 同梱の ISRG Root X1/X2。古い Fire Stick でも公開サイト(Let's Encrypt)を確認できる */
    private synchronized SSLSocketFactory ssl() throws Exception {
        if (sslFactory != null) return sslFactory;
        TrustManagerFactory sysF = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        sysF.init((KeyStore) null);
        final X509TrustManager sys = firstX509(sysF.getTrustManagers());
        KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
        ks.load(null, null);
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        String[] certs = getAssets().list("certs");
        if (certs != null) for (String name : certs) {
            InputStream in = getAssets().open("certs/" + name);
            try { ks.setCertificateEntry(name, cf.generateCertificate(in)); } finally { in.close(); }
        }
        TrustManagerFactory extraF = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        extraF.init(ks);
        final X509TrustManager extra = firstX509(extraF.getTrustManagers());
        X509TrustManager both = new X509TrustManager() {
            public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                sys.checkClientTrusted(chain, authType);
            }
            public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                try { sys.checkServerTrusted(chain, authType); }
                catch (CertificateException e) { extra.checkServerTrusted(chain, authType); }
            }
            public X509Certificate[] getAcceptedIssuers() {
                X509Certificate[] a = sys.getAcceptedIssuers(), b = extra.getAcceptedIssuers();
                X509Certificate[] r = new X509Certificate[a.length + b.length];
                System.arraycopy(a, 0, r, 0, a.length);
                System.arraycopy(b, 0, r, a.length, b.length);
                return r;
            }
        };
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(null, new TrustManager[] { both }, null);
        sslFactory = ctx.getSocketFactory();
        return sslFactory;
    }

    private static X509TrustManager firstX509(TrustManager[] tms) {
        for (TrustManager t : tms) if (t instanceof X509TrustManager) return (X509TrustManager) t;
        throw new IllegalStateException("no X509TrustManager");
    }

    // ---------- 画面・リモコン ----------
    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    private void js(String code) {
        web.evaluateJavascript(code, null);
    }

    /** リモコンのキーは WebView に渡る前に横取りして画面へ送る(スロットと同じ。WebView が握って届かないことがある) */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_UP) js("window.casaBack && window.casaBack()");
            return true; // 戻るではアプリを終了しない(終了はホームボタン)
        }
        if (code == KeyEvent.KEYCODE_MENU) {
            if (down && event.getRepeatCount() == 0) load();
            return true;
        }
        String name = null;
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: name = "ArrowUp"; break;
            case KeyEvent.KEYCODE_DPAD_DOWN: name = "ArrowDown"; break;
            case KeyEvent.KEYCODE_DPAD_LEFT: name = "ArrowLeft"; break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: name = "ArrowRight"; break;
            case KeyEvent.KEYCODE_DPAD_CENTER: case KeyEvent.KEYCODE_ENTER: case KeyEvent.KEYCODE_BUTTON_A:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: case KeyEvent.KEYCODE_MEDIA_PLAY: name = "Enter"; break;
        }
        if (name != null) {
            // 決定の長押し(押しっぱなしの連続入力)で設定が開いたり閉じたりしないように、決定は1回目だけ送る
            if (down && (event.getRepeatCount() == 0 || !"Enter".equals(name))) js("window.casaKey && window.casaKey('" + name + "')");
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() { /* dispatchKeyEvent で処理済み */ }

    @Override
    protected void onResume() {
        super.onResume();
        web.resumeTimers();
        web.onResume();
        hideBars();
        // 戻ってきたら描き直す(Fire TV ではキャンバスの中身が消えることがある)
        web.postDelayed(new Runnable() { public void run() { js("window.casaRedraw && window.casaRedraw()"); } }, 600);
    }

    @Override
    protected void onPause() {
        // ホーム画面などに切り替えたら、取得と読み上げを止める
        web.onPause();
        web.pauseTimers();
        if (tts != null) tts.stop();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        if (tts != null) tts.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
