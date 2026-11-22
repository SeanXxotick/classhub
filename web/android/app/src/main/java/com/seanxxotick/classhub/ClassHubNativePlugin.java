package com.seanxxotick.classhub;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;

import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * What the app's web view cannot do by itself: open Android's share sheet, save an exported file
 * (timetable image, ledger CSV, attendance Excel, invite QR) to Downloads, match the Android status
 * and navigation bars to ClassHub's theme, and trigger native haptic feedback.
 */
@CapacitorPlugin(name = "ClassHubNative")
public class ClassHubNativePlugin extends Plugin {
    private static final long SHARED_CACHE_MAX_AGE_MS = 24L * 60 * 60 * 1000;

    /** Shares a text (an invite message) to the app the user picks: Messenger, Gmail, Telegram and so on. */
    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text", "");
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        String subject = call.getString("subject", "");
        if (!subject.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, subject);
        getActivity().startActivity(Intent.createChooser(send, call.getString("title", "Share")));
        call.resolve();
    }

    /**
     * Saves a file to Downloads and answers where "downloads". Android 9 and older would need a storage
     * permission for that, so there the file goes to the share sheet instead and the answer is "shared".
     */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "ClassHub file");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        byte[] bytes;
        try {
            bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("The file could not be read.");
            return;
        }
        try {
            JSObject answer = new JSObject();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IllegalStateException("no uri");
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("no stream");
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
                answer.put("where", "downloads");
            } else {
                shareBytes(name, mimeType, bytes, "Save or send " + name);
                answer.put("where", "shared");
            }
            call.resolve(answer);
        } catch (Exception e) {
            call.reject("The file could not be saved. Check that the phone has free space and try again.");
        }
    }

    /** Sends a file (the invite QR image, PDF, Office file, etc.) to the app the user picks. */
    @PluginMethod
    public void shareFile(PluginCall call) {
        try {
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            shareBytes(call.getString("name", "ClassHub file"), call.getString("mimeType", "application/octet-stream"), bytes, call.getString("title", "Share"));
            call.resolve();
        } catch (Exception e) {
            call.reject("The file could not be shared.");
        }
    }

    /** Matches Android's status bar and navigation bar colors and icon contrast to ClassHub's Light/Dark theme. */
    @PluginMethod
    public void setSystemBars(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        String colorHex = call.getString("color", dark ? "#0f141c" : "#f6f8fb");
        int parsed;
        try {
            parsed = Color.parseColor(colorHex);
        } catch (IllegalArgumentException e) {
            parsed = Color.parseColor(dark ? "#0f141c" : "#f6f8fb");
        }
        final int barColor = parsed;
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            if (window == null) return;
            window.setStatusBarColor(barColor);
            window.setNavigationBarColor(barColor);
            window.getDecorView().setBackgroundColor(barColor);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            if (controller != null) {
                controller.setAppearanceLightStatusBars(!dark);
                controller.setAppearanceLightNavigationBars(!dark);
            }
        });
        call.resolve();
    }

    /** Subtle native haptic feedback on key actions (marking done, saving, confirming). */
    @PluginMethod
    public void haptic(PluginCall call) {
        String style = call.getString("style", "light");
        getActivity().runOnUiThread(() -> {
            View webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) return;
            int code;
            if ("confirm".equals(style) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                code = HapticFeedbackConstants.CONFIRM;
            } else {
                code = HapticFeedbackConstants.CLOCK_TICK;
            }
            webView.performHapticFeedback(code);
        });
        call.resolve();
    }

    private void shareBytes(String name, String mimeType, byte[] bytes, String title) throws Exception {
        File dir = new File(getContext().getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("no folder");
        pruneOldSharedFiles(dir);
        File file = new File(dir, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mimeType);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.setClipData(ClipData.newRawUri(name, uri));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().startActivity(Intent.createChooser(send, title));
    }

    /** Removes cached shared files older than 24 hours so app storage does not grow over time. */
    private void pruneOldSharedFiles(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - SHARED_CACHE_MAX_AGE_MS;
        for (File f : files) {
            if (f.isFile() && f.lastModified() < cutoff) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }
}
