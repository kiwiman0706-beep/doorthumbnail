package jp.yaegaki.omoide;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.CalendarContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import jp.co.kingjim.tepraprint.sdk.TepraPrint;
import jp.co.kingjim.tepraprint.sdk.TepraPrintCallback;
import jp.co.kingjim.tepraprint.sdk.TepraPrintConnectionStatus;
import jp.co.kingjim.tepraprint.sdk.TepraPrintDiscoverPrinter;
import jp.co.kingjim.tepraprint.sdk.TepraPrintParameterKey;
import jp.co.kingjim.tepraprint.sdk.TepraPrintPrintSpeed;
import jp.co.kingjim.tepraprint.sdk.TepraPrintPrintingPhase;
import jp.co.kingjim.tepraprint.sdk.TepraPrintStatusError;
import jp.co.kingjim.tepraprint.sdk.TepraPrintTapeCut;
import jp.co.kingjim.tepraprint.sdk.TepraPrintTapeWidth;

public class MainActivity extends Activity {
    private static final int REQUEST_FILE_CHOOSER = 401;
    private static final int REQUEST_TEPRA_SEARCH = 402;
    private static final int REQUEST_WIFI_PERMISSION = 403;
    private static final int REQUEST_CALENDAR_PERMISSION = 404;
    private static final int REQUEST_PHOTO_PERMISSION = 405;
    private static final int REQUEST_PHOTO_SEARCH = 406;
    private static final int REQUEST_BACKUP_FILE = 407;
    private static final long MAX_RESTORE_ENTRY_BYTES = 25L * 1024L * 1024L;
    private static final long MAX_RESTORE_TOTAL_BYTES = 1024L * 1024L * 1024L;
    private static final String PREFS = "omoide_native";
    private static final String INSTAX_PACKAGE = "com.fujifilm.instaxminiLink";
    private static final String[] PRINTER_KEYS = {
            TepraPrintDiscoverPrinter.PRINTER_INFO_NAME,
            TepraPrintDiscoverPrinter.PRINTER_INFO_PRODUCT,
            TepraPrintDiscoverPrinter.PRINTER_INFO_USBMDL,
            TepraPrintDiscoverPrinter.PRINTER_INFO_HOST,
            TepraPrintDiscoverPrinter.PRINTER_INFO_PORT,
            TepraPrintDiscoverPrinter.PRINTER_INFO_TYPE,
            TepraPrintDiscoverPrinter.PRINTER_INFO_DOMAIN,
            TepraPrintDiscoverPrinter.PRINTER_INFO_SERIAL_NUMBER,
            TepraPrintDiscoverPrinter.PRINTER_INFO_DEVICE_CLASS,
            TepraPrintDiscoverPrinter.PRINTER_INFO_DEVICE_STATUS
    };

    private WebView webView;
    private WebView printWebView;
    private ValueCallback<Uri[]> filePathCallback;
    private TepraPrint tepraPrint;
    private Map<String, String> printerInfo;
    private final ExecutorService printExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService mediaExecutor = Executors.newSingleThreadExecutor();
    private Runnable permissionGrantedAction;
    private int pendingPermissionRequest;
    private String permissionDeniedMessage;
    private Bitmap activeLabelBitmap;
    private volatile boolean tepraPrinting;
    private boolean pageReady;
    private final ArrayList<SharedImageRequest> pendingSharedImages = new ArrayList<>();
    private BackupSession backupSession;
    private RestoreSession restoreSession;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);
        configureWebView();

        tepraPrint = new TepraPrint(this);
        tepraPrint.setCallback(new PrintCallback());
        printerInfo = loadPrinterInformation();

        webView.loadUrl("file:///android_asset/index.html");
        queueSharedIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        queueSharedIntent(intent);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(false);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    openExternal(uri);
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                notifyNativeInfo();
                flushSharedImages();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams fileChooserParams) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    Intent intent = fileChooserParams.createIntent();
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                    return true;
                } catch (Exception error) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "ファイルを選択できません", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception error) {
            Toast.makeText(this, "リンクを開けません", Toast.LENGTH_SHORT).show();
        }
    }

    private JSONObject nativeInfo() {
        JSONObject object = new JSONObject();
        try {
            object.put("native", true);
            object.put("sdkVersion", TepraPrint.getVersion());
            object.put("printerSelected", printerInfo != null && !printerInfo.isEmpty());
            object.put("printerName", selectedPrinterName());
            object.put("printerHost", printerInfo == null ? "" : valueOrEmpty(printerInfo.get(TepraPrintDiscoverPrinter.PRINTER_INFO_HOST)));
            object.put("appVersion", "1.1.0");
            object.put("calendarImport", true);
            object.put("datePhotoSearch", true);
            object.put("zipBackup", true);
        } catch (JSONException ignored) {
        }
        return object;
    }

    private void notifyNativeInfo() {
        if (webView == null) return;
        String script = "window.onAndroidNativeReady && window.onAndroidNativeReady(" + nativeInfo() + ");";
        webView.evaluateJavascript(script, null);
    }

    private String selectedPrinterName() {
        if (printerInfo == null) return "";
        String name = printerInfo.get(TepraPrintDiscoverPrinter.PRINTER_INFO_NAME);
        if (TextUtils.isEmpty(name)) name = printerInfo.get(TepraPrintDiscoverPrinter.PRINTER_INFO_PRODUCT);
        return valueOrEmpty(name);
    }

    private static String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }

    private void startPrinterSearch() {
        ensureWifiPermission(() -> startActivityForResult(new Intent(this, SearchActivity.class), REQUEST_TEPRA_SEARCH));
    }

    private void ensureWifiPermission(Runnable action) {
        ArrayList<String> missing = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
                missing.add(Manifest.permission.NEARBY_WIFI_DEVICES);
            }
        } else {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
            }
        }
        if (missing.isEmpty()) {
            action.run();
            return;
        }
        requestRuntimePermissions(missing, REQUEST_WIFI_PERMISSION, action,
                "SR5900Pの検索には付近のWi‑Fi機器の権限が必要です");
    }

    private void ensureCalendarPermission(Runnable action) {
        if (checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED) {
            action.run();
            return;
        }
        ArrayList<String> permissions = new ArrayList<>();
        permissions.add(Manifest.permission.READ_CALENDAR);
        requestRuntimePermissions(permissions, REQUEST_CALENDAR_PERMISSION, action,
                "カレンダーの読み込みにはカレンダー権限が必要です");
    }

    private void ensurePhotoPermission(Runnable action) {
        ArrayList<String> permissions = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 34) {
            boolean all = checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED;
            boolean selected = checkSelfPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED;
            if (all || selected) {
                action.run();
                return;
            }
            permissions.add(Manifest.permission.READ_MEDIA_IMAGES);
            permissions.add(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED) {
                action.run();
                return;
            }
            permissions.add(Manifest.permission.READ_MEDIA_IMAGES);
        } else {
            if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
                action.run();
                return;
            }
            permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        requestRuntimePermissions(permissions, REQUEST_PHOTO_PERMISSION, action,
                "日付から写真を探すには写真へのアクセス権限が必要です");
    }

    private void requestRuntimePermissions(List<String> permissions, int requestCode,
                                           Runnable action, String deniedMessage) {
        permissionGrantedAction = action;
        pendingPermissionRequest = requestCode;
        permissionDeniedMessage = deniedMessage;
        requestPermissions(permissions.toArray(new String[0]), requestCode);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != pendingPermissionRequest) return;
        boolean granted;
        if (requestCode == REQUEST_PHOTO_PERMISSION && Build.VERSION.SDK_INT >= 34) {
            granted = checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED;
        } else {
            granted = grantResults.length > 0;
            for (int result : grantResults) granted &= result == PackageManager.PERMISSION_GRANTED;
        }
        Runnable action = permissionGrantedAction;
        String deniedMessage = permissionDeniedMessage;
        permissionGrantedAction = null;
        permissionDeniedMessage = null;
        pendingPermissionRequest = 0;
        if (granted && action != null) {
            action.run();
        } else {
            if (requestCode == REQUEST_WIFI_PERMISSION) {
                notifyTepraStatus("error", deniedMessage, 0);
            } else {
                notifyNativeMessage("error", deniedMessage);
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        if (requestCode == REQUEST_TEPRA_SEARCH && resultCode == RESULT_OK && data != null) {
            HashMap<String, String> selected = new HashMap<>();
            for (String key : PRINTER_KEYS) selected.put(key, valueOrEmpty(data.getStringExtra(key)));
            printerInfo = selected;
            savePrinterInformation(selected);
            notifyNativeInfo();
            notifyTepraStatus("selected", selectedPrinterName() + "を選択しました", 0);
            return;
        }
        if (requestCode == REQUEST_PHOTO_SEARCH && resultCode == RESULT_OK && data != null) {
            ArrayList<String> rawUris = data.getStringArrayListExtra(PhotoSearchActivity.EXTRA_RESULT_URIS);
            ArrayList<Uri> uris = new ArrayList<>();
            if (rawUris != null) {
                for (String raw : rawUris) {
                    try { uris.add(Uri.parse(raw)); } catch (Exception ignored) { }
                }
            }
            if (!uris.isEmpty()) {
                processIncomingUris(uris,
                        data.getStringExtra(PhotoSearchActivity.EXTRA_EVENT_TITLE),
                        data.getStringExtra(PhotoSearchActivity.EXTRA_EVENT_KEY),
                        data.getLongExtra(PhotoSearchActivity.EXTRA_EVENT_START, 0L));
            }
            return;
        }
        if (requestCode == REQUEST_BACKUP_FILE && resultCode == RESULT_OK && data != null && data.getData() != null) {
            readBackupFile(data.getData());
        }
    }

    private void queueSharedIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        if (intent.getType() == null || !intent.getType().startsWith("image/")) return;
        Set<String> seen = new HashSet<>();
        ArrayList<Uri> uris = new ArrayList<>();
        ClipData clip = intent.getClipData();
        if (clip != null) {
            for (int index = 0; index < clip.getItemCount(); index++) {
                Uri uri = clip.getItemAt(index).getUri();
                if (uri != null && seen.add(uri.toString())) uris.add(uri);
            }
        }
        if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> extras;
            if (Build.VERSION.SDK_INT >= 33) {
                extras = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
            } else {
                extras = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            }
            if (extras != null) {
                for (Uri uri : extras) if (uri != null && seen.add(uri.toString())) uris.add(uri);
            }
        } else {
            Uri uri;
            if (Build.VERSION.SDK_INT >= 33) {
                uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            } else {
                uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            }
            if (uri != null && seen.add(uri.toString())) uris.add(uri);
        }
        if (uris.isEmpty()) return;
        synchronized (pendingSharedImages) {
            for (Uri uri : uris) pendingSharedImages.add(new SharedImageRequest(uri, "", "", 0L));
        }
        flushSharedImages();
        intent.setAction(null);
    }

    private void flushSharedImages() {
        if (!pageReady) return;
        ArrayList<SharedImageRequest> requests;
        synchronized (pendingSharedImages) {
            if (pendingSharedImages.isEmpty()) return;
            requests = new ArrayList<>(pendingSharedImages);
            pendingSharedImages.clear();
        }
        ArrayList<Uri> uris = new ArrayList<>();
        for (SharedImageRequest request : requests) uris.add(request.uri);
        processIncomingUris(uris, "", "", 0L);
    }

    private void processIncomingUris(List<Uri> uris, String eventTitle, String eventKey, long eventStart) {
        if (uris == null || uris.isEmpty()) return;
        mediaExecutor.execute(() -> {
            int imported = 0;
            for (Uri uri : uris) {
                try {
                    JSONObject payload = createImagePayload(uri, eventTitle, eventKey, eventStart);
                    imported += 1;
                    runOnUiThread(() -> {
                        if (webView == null) return;
                        String script = "window.onAndroidSharedImage && window.onAndroidSharedImage(" + payload + ");";
                        webView.evaluateJavascript(script, null);
                    });
                } catch (Exception ignored) {
                }
            }
            int finishedCount = imported;
            runOnUiThread(() -> {
                if (webView == null) return;
                webView.evaluateJavascript("window.onAndroidSharedImagesFinished && window.onAndroidSharedImagesFinished("
                        + finishedCount + ");", null);
                if (finishedCount == 0) Toast.makeText(this, "写真を読み込めませんでした", Toast.LENGTH_LONG).show();
            });
        });
    }

    private JSONObject createImagePayload(Uri uri, String eventTitle, String eventKey, long eventStart) throws Exception {
        String name = queryDisplayName(uri);
        long takenAt = queryTakenAt(uri);
        if (takenAt <= 0) takenAt = queryExifTakenAt(uri);
        if (takenAt <= 0) takenAt = System.currentTimeMillis();

        ImageDecoder.Source source = ImageDecoder.createSource(getContentResolver(), uri);
        Bitmap bitmap = ImageDecoder.decodeBitmap(source, (decoder, info, ignored) -> {
            int width = info.getSize().getWidth();
            int height = info.getSize().getHeight();
            int max = Math.max(width, height);
            if (max > 1800) {
                float scale = 1800f / max;
                decoder.setTargetSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
            }
            decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
        });
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 88, output)) throw new IOException("画像を圧縮できません");
        bitmap.recycle();

        JSONObject payload = new JSONObject();
        payload.put("id", UUID.randomUUID().toString());
        payload.put("name", TextUtils.isEmpty(name) ? "shared-photo.jpg" : name);
        payload.put("takenAt", takenAt);
        payload.put("eventTitle", valueOrEmpty(eventTitle));
        payload.put("eventKey", valueOrEmpty(eventKey));
        payload.put("eventStart", eventStart);
        payload.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
        return payload;
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String value = cursor.getString(0);
                if (!TextUtils.isEmpty(value)) return value;
            }
        } catch (Exception ignored) {
        }
        return "shared-photo.jpg";
    }

    private long queryTakenAt(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri,
                new String[]{MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.DATE_ADDED},
                null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                long taken = cursor.isNull(0) ? 0L : cursor.getLong(0);
                if (taken > 0) return taken;
                long added = cursor.isNull(1) ? 0L : cursor.getLong(1);
                if (added > 0) return added * 1000L;
            }
        } catch (Exception ignored) {
        }
        return 0L;
    }

    private long queryExifTakenAt(Uri uri) {
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) return 0L;
            ExifInterface exif = new ExifInterface(input);
            String raw = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL);
            if (TextUtils.isEmpty(raw)) raw = exif.getAttribute(ExifInterface.TAG_DATETIME);
            if (TextUtils.isEmpty(raw)) return 0L;
            SimpleDateFormat format = new SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US);
            Date parsed = format.parse(raw);
            return parsed == null ? 0L : parsed.getTime();
        } catch (Exception ignored) {
            return 0L;
        }
    }

    private void requestCalendarEvents(int year, int month) {
        if (year < 1900 || year > 2200 || month < 1 || month > 12) {
            notifyNativeMessage("error", "年月が正しくありません");
            return;
        }
        ensureCalendarPermission(() -> queryCalendarEvents(year, month));
    }

    private void queryCalendarEvents(int year, int month) {
        mediaExecutor.execute(() -> {
            JSONObject result = new JSONObject();
            JSONArray events = new JSONArray();
            try {
                Calendar begin = Calendar.getInstance();
                begin.clear();
                begin.set(year, month - 1, 1, 0, 0, 0);
                Calendar end = (Calendar) begin.clone();
                end.add(Calendar.MONTH, 1);
                String[] projection = {
                        CalendarContract.Instances.EVENT_ID,
                        CalendarContract.Instances.TITLE,
                        CalendarContract.Instances.BEGIN,
                        CalendarContract.Instances.END,
                        CalendarContract.Instances.ALL_DAY,
                        CalendarContract.Instances.EVENT_LOCATION,
                        CalendarContract.Instances.CALENDAR_DISPLAY_NAME,
                        CalendarContract.Instances.CALENDAR_ID
                };
                try (Cursor cursor = CalendarContract.Instances.query(
                        getContentResolver(), projection, begin.getTimeInMillis(), end.getTimeInMillis())) {
                    if (cursor != null) {
                        while (cursor.moveToNext()) {
                            long eventId = cursor.getLong(0);
                            String title = cursor.getString(1);
                            long starts = cursor.getLong(2);
                            long ends = cursor.getLong(3);
                            boolean allDay = cursor.getInt(4) != 0;
                            String location = cursor.getString(5);
                            String calendarName = cursor.getString(6);
                            long calendarId = cursor.getLong(7);
                            if (TextUtils.isEmpty(title)) title = "予定";
                            SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd", Locale.JAPAN);
                            if (allDay) day.setTimeZone(TimeZone.getTimeZone("UTC"));
                            JSONObject item = new JSONObject();
                            item.put("key", calendarId + ":" + eventId + ":" + starts);
                            item.put("eventId", eventId);
                            item.put("title", title);
                            item.put("start", starts);
                            item.put("end", ends);
                            item.put("day", day.format(new Date(starts)));
                            item.put("allDay", allDay);
                            item.put("location", valueOrEmpty(location));
                            item.put("calendar", valueOrEmpty(calendarName));
                            events.put(item);
                        }
                    }
                }
                result.put("year", year);
                result.put("month", month);
                result.put("events", events);
            } catch (Exception error) {
                try {
                    result.put("year", year);
                    result.put("month", month);
                    result.put("events", events);
                    result.put("error", "カレンダーを読み込めませんでした");
                } catch (JSONException ignored) {
                }
            }
            JSONObject callbackResult = result;
            runOnUiThread(() -> {
                if (webView != null) webView.evaluateJavascript(
                        "window.onAndroidCalendarEvents && window.onAndroidCalendarEvents(" + callbackResult + ");", null);
            });
        });
    }

    private void launchPhotoSearch(long startMillis, long endMillis,
                                   String eventTitle, String eventKey, long eventStart) {
        if (startMillis <= 0 || endMillis <= startMillis) {
            notifyNativeMessage("error", "写真を探す期間が正しくありません");
            return;
        }
        long maximumRange = 370L * 24L * 60L * 60L * 1000L;
        long safeEnd = Math.min(endMillis, startMillis + maximumRange);
        ensurePhotoPermission(() -> {
            Intent intent = new Intent(this, PhotoSearchActivity.class);
            intent.putExtra(PhotoSearchActivity.EXTRA_START, startMillis);
            intent.putExtra(PhotoSearchActivity.EXTRA_END, safeEnd);
            intent.putExtra(PhotoSearchActivity.EXTRA_EVENT_TITLE, valueOrEmpty(eventTitle));
            intent.putExtra(PhotoSearchActivity.EXTRA_EVENT_KEY, valueOrEmpty(eventKey));
            intent.putExtra(PhotoSearchActivity.EXTRA_EVENT_START, eventStart);
            startActivityForResult(intent, REQUEST_PHOTO_SEARCH);
        });
    }

    private void notifyNativeMessage(String state, String message) {
        runOnUiThread(() -> {
            if (webView == null) return;
            webView.evaluateJavascript("window.onAndroidNativeMessage && window.onAndroidNativeMessage("
                    + JSONObject.quote(valueOrEmpty(state)) + "," + JSONObject.quote(valueOrEmpty(message)) + ");", null);
        });
    }

    private void savePrinterInformation(Map<String, String> information) {
        SharedPreferences.Editor editor = getSharedPreferences(PREFS, MODE_PRIVATE).edit().clear();
        for (String key : PRINTER_KEYS) editor.putString(key, valueOrEmpty(information.get(key)));
        editor.apply();
    }

    private Map<String, String> loadPrinterInformation() {
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String name = preferences.getString(TepraPrintDiscoverPrinter.PRINTER_INFO_NAME, "");
        if (TextUtils.isEmpty(name)) return null;
        HashMap<String, String> information = new HashMap<>();
        for (String key : PRINTER_KEYS) information.put(key, preferences.getString(key, ""));
        return information;
    }

    private void requestTepraPrint(String dateText, String eventText, int desiredTapeWidth, int labelLengthMm) {
        if (printerInfo == null || printerInfo.isEmpty()) {
            notifyTepraStatus("error", "先にSR5900Pを検索して選択してください", 0);
            return;
        }
        if (tepraPrinting) {
            notifyTepraStatus("error", "現在の印刷が終わるまでお待ちください", 0);
            return;
        }
        ensureWifiPermission(() -> performTepraPrint(dateText, eventText, desiredTapeWidth, labelLengthMm));
    }

    private void performTepraPrint(String dateText, String eventText, int desiredTapeWidth, int labelLengthMm) {
        tepraPrinting = true;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        notifyTepraStatus("checking", "SR5900Pとテープを確認しています…", 0);
        Map<String, String> selected = new HashMap<>(printerInfo);
        printExecutor.execute(() -> {
            try {
                tepraPrint.setPrinterInformation(selected);
                Map<String, Integer> status = tepraPrint.fetchPrinterStatus();
                int error = status == null || status.isEmpty()
                        ? TepraPrintStatusError.ConnectionFailed
                        : tepraPrint.getDeviceErrorFromStatus(status);
                if (error != TepraPrintStatusError.NoError) {
                    finishTepraPrint(false, errorMessage(error), 0);
                    return;
                }

                int tapeWidth = tepraPrint.getTapeWidthFromStatus(status);
                int tapeWidthMm = tapeWidthToMillimeters(tapeWidth);
                if (tapeWidth == TepraPrintTapeWidth.None || tapeWidth == TepraPrintTapeWidth.Unknown || tapeWidthMm == 0) {
                    finishTepraPrint(false, "テープカートリッジを確認してください", 0);
                    return;
                }

                int resolution = tepraPrint.getResolution();
                int printableHeight = tepraPrint.getPrintableSizeFromTape(tapeWidth);
                if (resolution <= 0 || printableHeight <= 0) {
                    finishTepraPrint(false, "ラベルの印刷サイズを取得できませんでした", tapeWidthMm);
                    return;
                }

                activeLabelBitmap = createLabelBitmap(dateText, eventText, printableHeight, resolution, labelLengthMm);
                Map<String, Object> parameters = new HashMap<>();
                parameters.put(TepraPrintParameterKey.Copies, 1);
                parameters.put(TepraPrintParameterKey.TapeCut, TepraPrintTapeCut.EachLabel);
                parameters.put(TepraPrintParameterKey.HalfCut, tepraPrint.isSupportHalfCut());
                parameters.put(TepraPrintParameterKey.PrintSpeed, TepraPrintPrintSpeed.PrintSpeedHigh);
                parameters.put(TepraPrintParameterKey.Density, 0);
                parameters.put(TepraPrintParameterKey.TapeWidth, tapeWidth);
                parameters.put(TepraPrintParameterKey.PriorityPrintSetting, false);
                parameters.put(TepraPrintParameterKey.HalfCutContinuous, false);

                String widthNote = desiredTapeWidth > 0 && desiredTapeWidth != tapeWidthMm
                        ? "（設定" + desiredTapeWidth + "mm／装着" + tapeWidthMm + "mm）"
                        : "（" + tapeWidthMm + "mm）";
                notifyTepraStatus("sending", "ラベルを送信しています…" + widthNote, tapeWidthMm);
                tepraPrint.doPrint(activeLabelBitmap, parameters);
            } catch (Exception error) {
                finishTepraPrint(false, "印刷を開始できませんでした：" + valueOrEmpty(error.getMessage()), 0);
            }
        });
    }

    private Bitmap createLabelBitmap(String rawDate, String rawEvent, int height, int resolution, int requestedLengthMm) {
        String date = TextUtils.isEmpty(rawDate) ? "年月" : rawDate.trim();
        String event = TextUtils.isEmpty(rawEvent) ? "" : rawEvent.trim().replace('\n', '／');
        int lengthMm = Math.max(30, Math.min(80, requestedLengthMm <= 0 ? 46 : requestedLengthMm));
        int width = Math.max(height * 3, Math.round(lengthMm / 25.4f * resolution));
        int padding = Math.max(6, height / 11);

        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);

        Paint datePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        datePaint.setColor(Color.BLACK);
        datePaint.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
        datePaint.setTextSize(Math.max(18f, height * 0.25f));

        float measuredDate = datePaint.measureText(date);
        int dividerX = (int) Math.min(width * 0.42f, Math.max(width * 0.27f, measuredDate + padding * 2f));
        Paint.FontMetrics dateMetrics = datePaint.getFontMetrics();
        float dateBaseline = (height - dateMetrics.bottom - dateMetrics.top) / 2f;
        canvas.drawText(date, padding, dateBaseline, datePaint);

        Paint divider = new Paint(Paint.ANTI_ALIAS_FLAG);
        divider.setColor(Color.BLACK);
        divider.setStrokeWidth(Math.max(1f, height / 90f));
        canvas.drawLine(dividerX, padding, dividerX, height - padding, divider);

        if (!event.isEmpty()) {
            int eventLeft = dividerX + padding;
            int eventWidth = Math.max(1, width - eventLeft - padding);
            TextPaint eventPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
            eventPaint.setColor(Color.BLACK);
            eventPaint.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL));
            float baseSize = height >= 140 ? height * 0.215f : height * 0.29f;
            if (event.length() > 24) baseSize *= 0.86f;
            eventPaint.setTextSize(Math.max(14f, baseSize));
            int maxLines = height >= 120 ? 2 : 1;
            StaticLayout layout = StaticLayout.Builder.obtain(event, 0, event.length(), eventPaint, eventWidth)
                    .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                    .setIncludePad(false)
                    .setLineSpacing(0f, 1f)
                    .setEllipsize(TextUtils.TruncateAt.END)
                    .setMaxLines(maxLines)
                    .build();
            canvas.save();
            canvas.translate(eventLeft, Math.max(padding, (height - layout.getHeight()) / 2f));
            layout.draw(canvas);
            canvas.restore();
        }
        return bitmap;
    }

    private int tapeWidthToMillimeters(int tapeWidth) {
        if (tapeWidth == TepraPrintTapeWidth.Normal_4mm) return 4;
        if (tapeWidth == TepraPrintTapeWidth.Normal_6mm) return 6;
        if (tapeWidth == TepraPrintTapeWidth.Normal_9mm) return 9;
        if (tapeWidth == TepraPrintTapeWidth.Normal_12mm) return 12;
        if (tapeWidth == TepraPrintTapeWidth.Normal_18mm) return 18;
        if (tapeWidth == TepraPrintTapeWidth.Normal_24mm || tapeWidth == TepraPrintTapeWidth.Cable_24mm) return 24;
        if (tapeWidth == TepraPrintTapeWidth.Normal_36mm || tapeWidth == TepraPrintTapeWidth.Cable_36mm) return 36;
        return 0;
    }

    private String errorMessage(int error) {
        if (error == TepraPrintStatusError.ConnectionFailed) return "SR5900Pへ接続できません。同じWi‑Fiに接続されているか確認してください";
        if (error == TepraPrintStatusError.NoTapeCartridge) return "テープカートリッジが入っていません";
        if (error == TepraPrintStatusError.CoverOpen) return "SR5900Pのカバーが開いています";
        if (error == TepraPrintStatusError.TapeEnd) return "テープがなくなりました";
        if (error == TepraPrintStatusError.CutterError) return "カッターエラーです";
        if (error == TepraPrintStatusError.OtherUsing || error == TepraPrintStatusError.DeviceUsing) return "SR5900Pはほかの端末で使用中です";
        if (error == TepraPrintStatusError.FirmwareUpdating) return "SR5900Pの更新が終わるまでお待ちください";
        if (error == TepraPrintStatusError.HeadOverheated || error == TepraPrintStatusError.TemperatureError) return "SR5900Pの温度が下がるまでお待ちください";
        return "SR5900Pエラー（" + Integer.toHexString(error) + "）";
    }

    private void finishTepraPrint(boolean success, String message, int tapeWidthMm) {
        tepraPrinting = false;
        runOnUiThread(() -> {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (activeLabelBitmap != null) {
                activeLabelBitmap.recycle();
                activeLabelBitmap = null;
            }
            notifyTepraStatus(success ? "success" : "error", message, tapeWidthMm);
        });
    }

    private void notifyTepraStatus(String state, String message, int tapeWidthMm) {
        runOnUiThread(() -> {
            if (webView == null) return;
            String script = "window.onTepraPrintStatus && window.onTepraPrintStatus("
                    + JSONObject.quote(state) + "," + JSONObject.quote(message) + "," + tapeWidthMm + ");";
            webView.evaluateJavascript(script, null);
        });
    }

    private void shareImageWithInstax(String dataUrl, String filename, String title) {
        printExecutor.execute(() -> {
            Uri uri = null;
            try {
                byte[] bytes = decodeDataUrl(dataUrl);
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, sanitizeFilename(filename, "omoide-instax.jpg"));
                values.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/OmoideTimeline");
                uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("共有画像の保存先を作成できません");
                try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                    if (output == null) throw new IOException("共有画像の保存先を開けません");
                    output.write(bytes);
                }
                Uri sharedUri = uri;
                runOnUiThread(() -> launchInstaxShare(sharedUri, title));
            } catch (Exception error) {
                if (uri != null) getContentResolver().delete(uri, null, null);
                runOnUiThread(() -> Toast.makeText(this, "画像を共有できませんでした", Toast.LENGTH_LONG).show());
            }
        });
    }

    private void launchInstaxShare(Uri uri, String title) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("image/jpeg");
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        Intent instax = new Intent(send).setPackage(INSTAX_PACKAGE);
        try {
            if (getPackageManager().resolveActivity(instax, PackageManager.MATCH_DEFAULT_ONLY) != null) {
                startActivity(instax);
            } else {
                startActivity(Intent.createChooser(send, "instax mini Linkへ共有"));
            }
        } catch (Exception error) {
            startActivity(Intent.createChooser(send, "画像を共有"));
        }
    }

    private void saveFileToDevice(String dataUrl, String mimeType, String filename) {
        printExecutor.execute(() -> {
            Uri uri = null;
            try {
                byte[] bytes = decodeDataUrl(dataUrl);
                String type = TextUtils.isEmpty(mimeType) ? "application/octet-stream" : mimeType.split(";")[0];
                boolean image = type.startsWith("image/");
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, sanitizeFilename(filename, image ? "omoide.jpg" : "omoide-file"));
                values.put(MediaStore.MediaColumns.MIME_TYPE, type);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/OmoideTimeline");
                Uri collection = image ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI : MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                uri = getContentResolver().insert(collection, values);
                if (uri == null) throw new IOException("保存先を作成できません");
                try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                    if (output == null) throw new IOException("保存先を開けません");
                    output.write(bytes);
                }
                runOnUiThread(() -> Toast.makeText(this, "端末に保存しました", Toast.LENGTH_SHORT).show());
            } catch (Exception error) {
                if (uri != null) getContentResolver().delete(uri, null, null);
                runOnUiThread(() -> Toast.makeText(this, "ファイルを保存できませんでした", Toast.LENGTH_LONG).show());
            }
        });
    }

    private synchronized String beginBackupFile(String manifestJson, String filename) {
        abortBackupSession();
        Uri uri = null;
        try {
            JSONObject manifest = new JSONObject(manifestJson);
            if (!"omoide-timeline".equals(manifest.optString("app"))) throw new IOException("バックアップ形式が不正です");
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME,
                    sanitizeFilename(filename, "omoide-backup.omoide.zip"));
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/zip");
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/OmoideTimeline");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("保存先を作成できません");
            OutputStream raw = getContentResolver().openOutputStream(uri);
            if (raw == null) throw new IOException("保存先を開けません");
            ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(raw));
            String token = UUID.randomUUID().toString();
            backupSession = new BackupSession(token, uri, zip);
            writeZipEntry(zip, "manifest.json", manifestJson.getBytes(StandardCharsets.UTF_8));
            backupSession.paths.add("manifest.json");
            return token;
        } catch (Exception error) {
            if (backupSession != null) {
                abortBackupSession();
            } else if (uri != null) {
                getContentResolver().delete(uri, null, null);
            }
            notifyNativeMessage("error", "バックアップを開始できませんでした");
            return "";
        }
    }

    private synchronized boolean addBackupPhoto(String token, String path, String dataUrl) {
        if (backupSession == null || !backupSession.token.equals(token)) return false;
        try {
            String safePath = safeArchivePath(path);
            if (!safePath.startsWith("photos/") || backupSession.paths.contains(safePath)) return false;
            byte[] bytes = decodeDataUrl(dataUrl);
            if (bytes.length > MAX_RESTORE_ENTRY_BYTES) throw new IOException("画像が大きすぎます");
            if (backupSession.totalBytes + bytes.length > MAX_RESTORE_TOTAL_BYTES) throw new IOException("バックアップが大きすぎます");
            writeZipEntry(backupSession.zip, safePath, bytes);
            backupSession.paths.add(safePath);
            backupSession.totalBytes += bytes.length;
            return true;
        } catch (Exception error) {
            notifyNativeMessage("error", "バックアップへ写真を追加できませんでした");
            return false;
        }
    }

    private synchronized boolean finishBackupFile(String token) {
        if (backupSession == null || !backupSession.token.equals(token)) return false;
        BackupSession session = backupSession;
        backupSession = null;
        try {
            session.zip.finish();
            session.zip.close();
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(session.uri, values, null, null);
            notifyNativeMessage("success", "ZIPバックアップをダウンロードへ保存しました");
            return true;
        } catch (Exception error) {
            try { session.zip.close(); } catch (Exception ignored) { }
            getContentResolver().delete(session.uri, null, null);
            notifyNativeMessage("error", "バックアップを保存できませんでした");
            return false;
        }
    }

    private synchronized void abortBackupSession() {
        if (backupSession == null) return;
        try { backupSession.zip.close(); } catch (Exception ignored) { }
        getContentResolver().delete(backupSession.uri, null, null);
        backupSession = null;
    }

    private void writeZipEntry(ZipOutputStream zip, String path, byte[] bytes) throws IOException {
        ZipEntry entry = new ZipEntry(path);
        entry.setTime(System.currentTimeMillis());
        zip.putNextEntry(entry);
        zip.write(bytes);
        zip.closeEntry();
    }

    private String safeArchivePath(String raw) throws IOException {
        if (raw == null) throw new IOException("パスがありません");
        String path = raw.replace('\\', '/');
        if (path.startsWith("/") || path.contains("../") || path.equals("..") || path.length() > 240) {
            throw new IOException("不正なパスです");
        }
        return path;
    }

    private void chooseBackupFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/zip", "application/json", "application/octet-stream"});
        try {
            startActivityForResult(intent, REQUEST_BACKUP_FILE);
        } catch (Exception error) {
            notifyNativeMessage("error", "バックアップファイルを選べませんでした");
        }
    }

    private void readBackupFile(Uri uri) {
        notifyNativeMessage("working", "バックアップを確認しています…");
        mediaExecutor.execute(() -> {
            try (BufferedInputStream input = new BufferedInputStream(getContentResolver().openInputStream(uri))) {
                input.mark(8);
                int first = input.read();
                int second = input.read();
                input.reset();
                if (first == 'P' && second == 'K') {
                    parseZipBackup(uri);
                } else {
                    byte[] bytes = readLimited(input, 250L * 1024L * 1024L);
                    String json = new String(bytes, StandardCharsets.UTF_8);
                    JSONObject payload = new JSONObject(json);
                    if (!"omoide-timeline".equals(payload.optString("app"))) throw new IOException("このアプリのバックアップではありません");
                    runOnUiThread(() -> {
                        if (webView != null) webView.evaluateJavascript(
                                "window.onAndroidLegacyBackup && window.onAndroidLegacyBackup(" + JSONObject.quote(json) + ");", null);
                    });
                }
            } catch (Exception error) {
                notifyNativeMessage("error", "バックアップを読み込めませんでした");
            }
        });
    }

    private void parseZipBackup(Uri uri) throws Exception {
        clearRestoreSession();
        File directory = new File(getCacheDir(), "omoide-restore-" + UUID.randomUUID());
        if (!directory.mkdirs()) throw new IOException("一時フォルダーを作成できません");
        Map<String, File> files = new HashMap<>();
        String manifestJson = null;
        long total = 0L;
        int entryCount = 0;
        try (InputStream raw = getContentResolver().openInputStream(uri);
             ZipInputStream zip = new ZipInputStream(new BufferedInputStream(raw))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++entryCount > 6000) throw new IOException("ファイル数が多すぎます");
                if (entry.isDirectory()) {
                    zip.closeEntry();
                    continue;
                }
                String path = safeArchivePath(entry.getName());
                if ("manifest.json".equals(path)) {
                    byte[] bytes = readLimited(zip, 10L * 1024L * 1024L);
                    total += bytes.length;
                    manifestJson = new String(bytes, StandardCharsets.UTF_8);
                } else if (path.startsWith("photos/")) {
                    File target = new File(directory, String.format(Locale.US, "%05d.bin", entryCount));
                    long copied;
                    try (OutputStream output = new BufferedOutputStream(new FileOutputStream(target))) {
                        copied = copyLimited(zip, output, MAX_RESTORE_ENTRY_BYTES);
                    }
                    total += copied;
                    if (total > MAX_RESTORE_TOTAL_BYTES) throw new IOException("バックアップが大きすぎます");
                    files.put(path, target);
                }
                zip.closeEntry();
            }
        } catch (Exception error) {
            deleteTree(directory);
            throw error;
        }
        if (TextUtils.isEmpty(manifestJson)) {
            deleteTree(directory);
            throw new IOException("manifest.jsonがありません");
        }
        JSONObject manifest = new JSONObject(manifestJson);
        if (!"omoide-timeline".equals(manifest.optString("app")) || manifest.optInt("version") < 2) {
            deleteTree(directory);
            throw new IOException("対応していないバックアップです");
        }
        restoreSession = new RestoreSession(directory, files);
        String readyManifest = manifestJson;
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(
                    "window.onAndroidBackupReady && window.onAndroidBackupReady(" + JSONObject.quote(readyManifest) + ");", null);
        });
    }

    private synchronized String getBackupPhotoDataUrl(String rawPath) {
        if (restoreSession == null) return "";
        try {
            String path = safeArchivePath(rawPath);
            File file = restoreSession.files.get(path);
            if (file == null || !file.isFile()) return "";
            byte[] bytes;
            try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
                bytes = readLimited(input, MAX_RESTORE_ENTRY_BYTES);
            }
            String mime = path.toLowerCase(Locale.US).endsWith(".png") ? "image/png" : "image/jpeg";
            return "data:" + mime + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
        } catch (Exception error) {
            return "";
        }
    }

    private synchronized void clearRestoreSession() {
        if (restoreSession == null) return;
        deleteTree(restoreSession.directory);
        restoreSession = null;
    }

    private byte[] readLimited(InputStream input, long limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        copyLimited(input, output, limit);
        return output.toByteArray();
    }

    private long copyLimited(InputStream input, OutputStream output, long limit) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        long total = 0L;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > limit) throw new IOException("ファイルが大きすぎます");
            output.write(buffer, 0, read);
        }
        return total;
    }

    private void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        // Restore files always live under this app's cache directory.
        file.delete();
    }

    private byte[] decodeDataUrl(String dataUrl) throws IOException {
        int comma = dataUrl == null ? -1 : dataUrl.indexOf(',');
        if (comma < 0 || !dataUrl.substring(0, comma).contains(";base64")) throw new IOException("データ形式が不正です");
        return Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
    }

    private String sanitizeFilename(String filename, String fallback) {
        String value = TextUtils.isEmpty(filename) ? fallback : filename;
        return value.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private void printHtmlDocument(String html, String jobName) {
        runOnUiThread(() -> {
            printWebView = new WebView(this);
            printWebView.getSettings().setJavaScriptEnabled(true);
            printWebView.setWebViewClient(new WebViewClient() {
                private boolean started;

                @Override
                public void onPageFinished(WebView view, String url) {
                    if (started) return;
                    started = true;
                    view.postDelayed(() -> {
                        PrintManager manager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                        PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(
                                TextUtils.isEmpty(jobName) ? "おもいで年表" : jobName);
                        PrintAttributes attributes = new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                .build();
                        manager.print(TextUtils.isEmpty(jobName) ? "おもいで年表" : jobName, adapter, attributes);
                    }, 450);
                }
            });
            printWebView.loadDataWithBaseURL("file:///android_asset/", html, "text/html", StandardCharsets.UTF_8.name(), null);
        });
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript("window.androidHandleBack ? window.androidHandleBack() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() {
        if (tepraPrint != null && tepraPrinting) tepraPrint.cancelPrint();
        abortBackupSession();
        clearRestoreSession();
        printExecutor.shutdownNow();
        mediaExecutor.shutdownNow();
        if (webView != null) webView.destroy();
        if (printWebView != null) printWebView.destroy();
        super.onDestroy();
    }

    private class AndroidBridge {
        @JavascriptInterface
        public String getNativeInfo() {
            return nativeInfo().toString();
        }

        @JavascriptInterface
        public void searchTepra() {
            runOnUiThread(MainActivity.this::startPrinterSearch);
        }

        @JavascriptInterface
        public void printTepraLabel(String dateText, String eventText, int tapeWidth, int labelLengthMm) {
            runOnUiThread(() -> requestTepraPrint(dateText, eventText, tapeWidth, labelLengthMm));
        }

        @JavascriptInterface
        public void shareImage(String dataUrl, String filename, String title) {
            shareImageWithInstax(dataUrl, filename, title);
        }

        @JavascriptInterface
        public void saveFile(String dataUrl, String mimeType, String filename) {
            saveFileToDevice(dataUrl, mimeType, filename);
        }

        @JavascriptInterface
        public void printHtml(String html, String jobName) {
            printHtmlDocument(html, jobName);
        }

        @JavascriptInterface
        public void requestCalendarEvents(int year, int month) {
            runOnUiThread(() -> MainActivity.this.requestCalendarEvents(year, month));
        }

        @JavascriptInterface
        public void searchPhotos(long startMillis, long endMillis,
                                 String eventTitle, String eventKey, long eventStart) {
            runOnUiThread(() -> launchPhotoSearch(startMillis, endMillis, eventTitle, eventKey, eventStart));
        }

        @JavascriptInterface
        public String beginBackup(String manifestJson, String filename) {
            return beginBackupFile(manifestJson, filename);
        }

        @JavascriptInterface
        public boolean addBackupPhoto(String token, String path, String dataUrl) {
            return MainActivity.this.addBackupPhoto(token, path, dataUrl);
        }

        @JavascriptInterface
        public boolean finishBackup(String token) {
            return finishBackupFile(token);
        }

        @JavascriptInterface
        public void cancelBackup(String token) {
            synchronized (MainActivity.this) {
                if (backupSession != null && backupSession.token.equals(token)) abortBackupSession();
            }
        }

        @JavascriptInterface
        public void chooseBackupFile() {
            runOnUiThread(MainActivity.this::chooseBackupFile);
        }

        @JavascriptInterface
        public String getBackupPhoto(String path) {
            return getBackupPhotoDataUrl(path);
        }

        @JavascriptInterface
        public void clearBackupRestore() {
            MainActivity.this.clearRestoreSession();
        }
    }

    private static class SharedImageRequest {
        final Uri uri;
        final String eventTitle;
        final String eventKey;
        final long eventStart;

        SharedImageRequest(Uri uri, String eventTitle, String eventKey, long eventStart) {
            this.uri = uri;
            this.eventTitle = eventTitle;
            this.eventKey = eventKey;
            this.eventStart = eventStart;
        }
    }

    private static class BackupSession {
        final String token;
        final Uri uri;
        final ZipOutputStream zip;
        final Set<String> paths = new HashSet<>();
        long totalBytes;

        BackupSession(String token, Uri uri, ZipOutputStream zip) {
            this.token = token;
            this.uri = uri;
            this.zip = zip;
        }
    }

    private static class RestoreSession {
        final File directory;
        final Map<String, File> files;

        RestoreSession(File directory, Map<String, File> files) {
            this.directory = directory;
            this.files = files;
        }
    }

    private class PrintCallback implements TepraPrintCallback {
        @Override
        public void onChangePrintOperationPhase(TepraPrint print, int phase) {
            if (phase == TepraPrintPrintingPhase.Prepare) {
                notifyTepraStatus("printing", "印刷データを準備しています…", 0);
            } else if (phase == TepraPrintPrintingPhase.Processing) {
                notifyTepraStatus("printing", "SR5900Pへ送信しています…", 0);
            } else if (phase == TepraPrintPrintingPhase.WaitingForPrint) {
                notifyTepraStatus("printing", "SR5900Pで印刷しています…", 0);
            } else if (phase == TepraPrintPrintingPhase.Complete) {
                finishTepraPrint(true, "テプラの印刷が完了しました", 0);
            }
        }

        @Override
        public void onSuspendPrintOperation(TepraPrint print, int errorStatus, int deviceStatus) {
            runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
                    .setTitle("テプラ印刷を再開しますか？")
                    .setMessage(errorMessage(deviceStatus != 0 ? deviceStatus : errorStatus))
                    .setPositiveButton("再開", (dialog, which) -> print.resumeOfPrint())
                    .setNegativeButton("中止", (dialog, which) -> {
                        print.cancelPrint();
                        finishTepraPrint(false, "印刷を中止しました", 0);
                    })
                    .setCancelable(false)
                    .show());
        }

        @Override
        public void onAbortPrintOperation(TepraPrint print, int errorStatus, int deviceStatus) {
            int error = deviceStatus != 0 ? deviceStatus : errorStatus;
            finishTepraPrint(false, errorMessage(error), 0);
        }

        @Override
        public void onChangeTapeFeedOperationPhase(TepraPrint print, int phase) {
        }

        @Override
        public void onAbortTapeFeedOperation(TepraPrint print, int errorStatus, int deviceStatus) {
        }
    }
}
