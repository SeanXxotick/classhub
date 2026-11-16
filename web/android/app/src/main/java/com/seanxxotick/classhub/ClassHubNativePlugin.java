package com.seanxxotick.classhub;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * What the app's web view cannot do by itself (from 2.0.2): open Android's share sheet, and save an exported
 * file (timetable image, ledger CSV, attendance Excel, invite QR) to Downloads. The web app calls it as
 * "ClassHubNative" and falls back when an older APK does not have it.
 */
@CapacitorPlugin(name = "ClassHubNative")
public class ClassHubNativePlugin extends Plugin {

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

    /** Sends a file (the invite QR image) to the app the user picks. */
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

    private void shareBytes(String name, String mimeType, byte[] bytes, String title) throws Exception {
        File dir = new File(getContext().getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("no folder");
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
}
