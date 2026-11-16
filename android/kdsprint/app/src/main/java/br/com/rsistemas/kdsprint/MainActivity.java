package br.com.rsistemas.kdsprint;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.Activity;
import android.os.Bundle;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.widget.Button;
import android.widget.LinearLayout;

import java.nio.charset.StandardCharsets;

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
        LinearLayout tela = new LinearLayout(this);
        tela.setOrientation(LinearLayout.VERTICAL);
        tela.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        Button testeUsb = new Button(this);
        testeUsb.setText("Testar Bematech (APK → USB)");
        testeUsb.setAllCaps(false);
        testeUsb.setOnClickListener(v -> testarUsb(testeUsb));
        tela.addView(testeUsb, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(tela);
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

    private void testarUsb(Button botao) {
        if (!impressora.hasPermission()) {
            impressora.requestPermission();
            new AlertDialog.Builder(this)
                    .setTitle("Teste APK → USB")
                    .setMessage("Conecte a Bematech e autorize o acesso USB. Toque novamente para imprimir sem depender do KDS.")
                    .setPositiveButton("Entendi", null).show();
            return;
        }
        botao.setEnabled(false);
        new Thread(() -> {
            byte[] via = ("\u001b@\u001ba\u0001\u001bE\u0001TESTE APK -> BEMATECH\n"
                    + "\u001bE\u0000Comunicacao USB direta.\n"
                    + "Sem pedido e sem KDS.\n\n\n\u001dV\u0000")
                    .getBytes(StandardCharsets.US_ASCII);
            boolean ok = impressora.print(via);
            String erro = impressora.getLastError();
            runOnUiThread(() -> {
                botao.setEnabled(true);
                if (isFinishing() || isDestroyed()) return;
                new AlertDialog.Builder(this)
                        .setTitle("Teste APK → USB")
                        .setMessage(ok ? "Bytes enviados à Bematech. Confira se a via saiu." :
                                "A impressão direta falhou: " + (erro.isEmpty() ? "verifique USB e impressora" : erro))
                        .setPositiveButton("Fechar", null).show();
            });
        }).start();
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
        public String getLastError() {
            return paginaConfiavel ? impressora.getLastError() : "Página não autorizada";
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
