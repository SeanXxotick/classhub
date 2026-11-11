package com.seanxxotick.classhub;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/** The shell around the hosted web app. It also hands shared links and invite links to the web app. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        open(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        open(intent);
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
