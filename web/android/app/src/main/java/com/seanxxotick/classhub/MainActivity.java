package com.seanxxotick.classhub;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** The shell around the hosted web app. It also hands shared links, invite links, and back presses to the web app. */
public class MainActivity extends BridgeActivity {
    private static final String PREFS = "classhub";
    private static final String LOADED_ONCE = "loadedOnce";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Sharing, saving files, system bar sync, and haptics for the web app. Registered before the bridge starts.
        registerPlugin(ClassHubNativePlugin.class);
        super.onCreate(savedInstanceState);
        applySystemBarInsets();
        wireBackButton();
        watchFirstLoad();
        open(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        open(intent);
    }

    /**
     * Pads the root view for status bar, navigation bar, and soft keyboard insets so content is never drawn
     * under system bars on Android 15/16+ edge-to-edge screens.
     */
    private void applySystemBarInsets() {
        View content = findViewById(android.R.id.content);
        if (content == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }

    /**
     * Lets the web app handle Back first (close an open dialog/menu, or navigate back in React Router).
     * Minimizes the app instead of killing the activity when already on the root screen, so reopening is instant.
     */
    private void wireBackButton() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    moveTaskToBack(true);
                    return;
                }
                webView.evaluateJavascript(
                    "(function(){ return typeof window.__classhubBack === 'function' ? window.__classhubBack() : 'fallback'; })()",
                    value -> {
                        if ("\"handled\"".equals(value)) return;
                        if ("\"exit\"".equals(value)) {
                            moveTaskToBack(true);
                            return;
                        }
                        if (webView.canGoBack()) webView.goBack();
                        else moveTaskToBack(true);
                    }
                );
            }
        });
    }

    /**
     * The "ClassHub cannot load" page (offline.html in the APK), only while the app has never loaded on this
     * phone. After one good load the web app's offline cache has a saved copy, so a failed start is left to
     * it. 2.0.2 used Capacitor's errorPath instead, which also showed the page when that saved copy was there
     * (the start page reports an error offline even though the offline cache answers it).
     */
    private void watchFirstLoad() {
        if (getBridge() == null) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        final String host = Uri.parse(getBridge().getServerUrl()).getHost();
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            private boolean failed = false;

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                failed = false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (!request.isForMainFrame()) return;
                failed = true;
                if (!prefs.getBoolean(LOADED_ONCE, false)) showOfflinePage(view);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Uri page = Uri.parse(url);
                boolean ours = host != null && host.equalsIgnoreCase(page.getHost()) && !"/offline.html".equals(page.getPath());
                if (ours && !failed && !prefs.getBoolean(LOADED_ONCE, false)) prefs.edit().putBoolean(LOADED_ONCE, true).apply();
            }
        });
    }

    /** offline.html from the APK, shown at the site's address so its Try again button can load the site. */
    private void showOfflinePage(WebView view) {
        try (InputStream in = getAssets().open("public/offline.html")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            String base = getBridge().getServerUrl() + "/offline.html";
            view.loadDataWithBaseURL(base, out.toString(StandardCharsets.UTF_8.name()), "text/html", "UTF-8", null);
        } catch (Exception e) {
            // Without the page, Android's own error shows, as in 2.0.1.
        }
    }

    /** Opens /share for a shared text, or the same path for an invite link. */
    private void open(Intent intent) {
        if (intent == null || getBridge() == null) return;
        String base = getBridge().getServerUrl();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            String title = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (text == null) return;
            Uri target = Uri.parse(base).buildUpon().path("/share")
                .appendQueryParameter("text", text)
                .appendQueryParameter("title", title == null ? "" : title)
                .build();
            getBridge().getWebView().loadUrl(target.toString());
        } else if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            String path = intent.getData().getPath();
            if (path != null && path.startsWith("/join")) {
                getBridge().getWebView().loadUrl(Uri.parse(base).buildUpon().path(path).build().toString());
            }
        }
    }
}
