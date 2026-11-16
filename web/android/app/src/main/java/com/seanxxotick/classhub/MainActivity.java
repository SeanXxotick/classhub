package com.seanxxotick.classhub;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** The shell around the hosted web app. It also hands shared links and invite links to the web app. */
public class MainActivity extends BridgeActivity {
    private static final String PREFS = "classhub";
    private static final String LOADED_ONCE = "loadedOnce";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Sharing and saving files for the web app (2.0.2). Registered before the bridge starts.
        registerPlugin(ClassHubNativePlugin.class);
        super.onCreate(savedInstanceState);
        watchFirstLoad();
        open(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        open(intent);
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
