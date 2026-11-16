package br.com.rsistemas.kdsprint;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;

import br.com.rsistemas.kdsprint.print.UsbPrinter;

public final class MainActivity extends Activity {
    private static final String KDS_URL = "https://novo-ecossistema.vercel.app/kds.html";
    private volatile boolean paginaConfiavel;
    private WebView webView;
    private UsbPrinter impressora;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        impressora = new UsbPrinter(this);
        webView = new WebView(this);
        setContentView(webView);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings ajustes = webView.getSettings();
        ajustes.setJavaScriptEnabled(true);
        ajustes.setDomStorageEnabled(true);
        ajustes.setAllowFileAccess(false);
        ajustes.setAllowContentAccess(false);
        ajustes.setJavaScriptCanOpenWindowsAutomatically(false);
        ajustes.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new PonteImpressao(), "AndroidPrint");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !KDS_URL.equals(request.getUrl().toString());
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                paginaConfiavel = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                paginaConfiavel = KDS_URL.equals(url);
            }
        });
        webView.loadUrl(KDS_URL);
        // Solicita autorização antes do primeiro aceite para que a via saia
        // automaticamente quando a Bematech já está conectada ao Android.
        impressora.requestPermission();
    }

    private final class PonteImpressao {
        @JavascriptInterface
        public boolean connect() {
            return paginaConfiavel && impressora.requestPermission();
        }

        @JavascriptInterface
        public boolean isConnected() {
            return paginaConfiavel && impressora.hasPermission();
        }

        @JavascriptInterface
        public boolean print(String base64) {
            if (!paginaConfiavel || base64 == null || base64.length() > 22000) return false;
            try {
                byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
                return bytes.length > 0 && bytes.length <= 16000 && impressora.print(bytes);
            } catch (IllegalArgumentException erro) {
                return false;
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        paginaConfiavel = false;
        webView.destroy();
        super.onDestroy();
    }
}
