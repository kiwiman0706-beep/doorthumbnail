package jp.yaegaki.omoide;

import android.app.Activity;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.LruCache;
import android.util.Size;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A small, offline MediaStore picker limited to the requested event/month date range. */
public class PhotoSearchActivity extends Activity {
    public static final String EXTRA_START = "startMillis";
    public static final String EXTRA_END = "endMillis";
    public static final String EXTRA_EVENT_TITLE = "eventTitle";
    public static final String EXTRA_EVENT_KEY = "eventKey";
    public static final String EXTRA_EVENT_START = "eventStart";
    public static final String EXTRA_RESULT_URIS = "resultUris";
    private static final int MAX_SELECTION = 24;

    private final List<Uri> photos = new ArrayList<>();
    private final Set<String> selected = new LinkedHashSet<>();
    private final ExecutorService queryExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService thumbnailExecutor = Executors.newFixedThreadPool(3);
    private final LruCache<String, Bitmap> thumbnails = new LruCache<>(80);
    private PhotoAdapter adapter;
    private Button addButton;
    private TextView statusText;
    private TextView emptyText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(16, 35, 63));
        getWindow().setNavigationBarColor(Color.rgb(16, 35, 63));
        setContentView(createContentView());
        loadPhotos();
    }

    private View createContentView() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(237, 242, 247));

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(10), dp(10), dp(10), dp(10));
        bar.setBackgroundColor(Color.rgb(16, 35, 63));

        Button cancel = makeButton("戻る", false);
        cancel.setOnClickListener(view -> finish());
        bar.addView(cancel, new LinearLayout.LayoutParams(dp(70), dp(44)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(dp(10), 0, dp(8), 0);
        TextView title = new TextView(this);
        title.setText("日付付近の写真");
        title.setTextColor(Color.WHITE);
        title.setTextSize(18);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        TextView subtitle = new TextView(this);
        String event = getIntent().getStringExtra(EXTRA_EVENT_TITLE);
        subtitle.setText(event == null || event.trim().isEmpty() ? "この月に撮った写真" : event);
        subtitle.setTextColor(Color.rgb(190, 205, 222));
        subtitle.setTextSize(12);
        subtitle.setSingleLine(true);
        titles.addView(title);
        titles.addView(subtitle);
        bar.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        addButton = makeButton("追加 0", true);
        addButton.setEnabled(false);
        addButton.setOnClickListener(view -> returnSelection());
        bar.addView(addButton, new LinearLayout.LayoutParams(dp(90), dp(44)));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        statusText = new TextView(this);
        statusText.setText("写真を探しています…");
        statusText.setTextColor(Color.rgb(87, 105, 126));
        statusText.setTextSize(13);
        statusText.setPadding(dp(14), dp(10), dp(14), dp(8));
        root.addView(statusText);

        FrameLayout content = new FrameLayout(this);
        GridView grid = new GridView(this);
        grid.setNumColumns(3);
        grid.setHorizontalSpacing(dp(3));
        grid.setVerticalSpacing(dp(3));
        grid.setPadding(dp(3), dp(3), dp(3), dp(16));
        grid.setClipToPadding(false);
        grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);
        adapter = new PhotoAdapter(this);
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((parent, view, position, id) -> toggle(photos.get(position)));
        content.addView(grid, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        emptyText = new TextView(this);
        emptyText.setText("この期間に撮影された写真は見つかりませんでした");
        emptyText.setTextColor(Color.rgb(87, 105, 126));
        emptyText.setTextSize(15);
        emptyText.setGravity(Gravity.CENTER);
        emptyText.setPadding(dp(30), dp(30), dp(30), dp(30));
        emptyText.setVisibility(View.GONE);
        content.addView(emptyText, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return root;
    }

    private Button makeButton(String text, boolean accent) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(13);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setPadding(dp(6), 0, dp(6), 0);
        GradientDrawable background = new GradientDrawable();
        background.setCornerRadius(dp(9));
        background.setColor(accent ? Color.rgb(21, 153, 143) : Color.rgb(34, 57, 86));
        background.setStroke(dp(1), accent ? Color.rgb(21, 153, 143) : Color.rgb(91, 111, 137));
        button.setBackground(background);
        return button;
    }

    private void loadPhotos() {
        long start = getIntent().getLongExtra(EXTRA_START, 0L);
        long end = getIntent().getLongExtra(EXTRA_END, System.currentTimeMillis());
        queryExecutor.execute(() -> {
            String[] projection = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DATE_TAKEN,
                    MediaStore.Images.Media.DATE_ADDED
            };
            String selection = "(" + MediaStore.Images.Media.DATE_TAKEN + " BETWEEN ? AND ?) OR (("
                    + MediaStore.Images.Media.DATE_TAKEN + " IS NULL OR " + MediaStore.Images.Media.DATE_TAKEN
                    + " = 0) AND " + MediaStore.Images.Media.DATE_ADDED + " BETWEEN ? AND ?)";
            String[] args = {
                    String.valueOf(start), String.valueOf(end),
                    String.valueOf(start / 1000L), String.valueOf(end / 1000L)
            };
            try (Cursor cursor = getContentResolver().query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    projection, selection, args,
                    MediaStore.Images.Media.DATE_TAKEN + " DESC")) {
                if (cursor != null) {
                    int idIndex = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                    while (cursor.moveToNext() && photos.size() < 600) {
                        photos.add(ContentUris.withAppendedId(
                                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                                cursor.getLong(idIndex)));
                    }
                }
                runOnUiThread(() -> {
                    statusText.setText(photos.isEmpty() ? "0枚" : photos.size() + "枚見つかりました（最大24枚選択）");
                    emptyText.setVisibility(photos.isEmpty() ? View.VISIBLE : View.GONE);
                    adapter.notifyDataSetChanged();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    statusText.setText("写真を読み込めませんでした");
                    emptyText.setText("写真へのアクセス権限をご確認ください");
                    emptyText.setVisibility(View.VISIBLE);
                });
            }
        });
    }

    private void toggle(Uri uri) {
        String key = uri.toString();
        if (selected.contains(key)) {
            selected.remove(key);
        } else if (selected.size() >= MAX_SELECTION) {
            Toast.makeText(this, "一度に選べるのは24枚までです", Toast.LENGTH_SHORT).show();
            return;
        } else {
            selected.add(key);
        }
        addButton.setText("追加 " + selected.size());
        addButton.setEnabled(!selected.isEmpty());
        adapter.notifyDataSetChanged();
    }

    private void returnSelection() {
        Intent result = new Intent();
        result.putStringArrayListExtra(EXTRA_RESULT_URIS, new ArrayList<>(selected));
        result.putExtra(EXTRA_EVENT_TITLE, getIntent().getStringExtra(EXTRA_EVENT_TITLE));
        result.putExtra(EXTRA_EVENT_KEY, getIntent().getStringExtra(EXTRA_EVENT_KEY));
        result.putExtra(EXTRA_EVENT_START, getIntent().getLongExtra(EXTRA_EVENT_START, 0L));
        setResult(RESULT_OK, result);
        finish();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        queryExecutor.shutdownNow();
        thumbnailExecutor.shutdownNow();
        super.onDestroy();
    }

    private class PhotoAdapter extends BaseAdapter {
        private final Context context;

        PhotoAdapter(Context context) {
            this.context = context;
        }

        @Override public int getCount() { return photos.size(); }
        @Override public Object getItem(int position) { return photos.get(position); }
        @Override public long getItemId(int position) { return position; }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            Cell cell;
            if (convertView == null) {
                FrameLayout frame = new FrameLayout(context);
                frame.setBackgroundColor(Color.rgb(218, 226, 235));
                frame.setLayoutParams(new GridView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(126)));
                ImageView image = new ImageView(context);
                image.setScaleType(ImageView.ScaleType.CENTER_CROP);
                frame.addView(image, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                TextView check = new TextView(context);
                check.setGravity(Gravity.CENTER);
                check.setTextSize(18);
                check.setTypeface(check.getTypeface(), android.graphics.Typeface.BOLD);
                FrameLayout.LayoutParams checkParams = new FrameLayout.LayoutParams(dp(34), dp(34), Gravity.TOP | Gravity.END);
                checkParams.setMargins(0, dp(6), dp(6), 0);
                frame.addView(check, checkParams);
                cell = new Cell(frame, image, check);
                frame.setTag(cell);
                convertView = frame;
            } else {
                cell = (Cell) convertView.getTag();
            }
            Uri uri = photos.get(position);
            String key = uri.toString();
            cell.image.setTag(key);
            cell.image.setImageDrawable(null);
            boolean isSelected = selected.contains(key);
            cell.check.setText(isSelected ? "✓" : "");
            GradientDrawable badge = new GradientDrawable();
            badge.setShape(GradientDrawable.OVAL);
            badge.setColor(isSelected ? Color.rgb(21, 153, 143) : Color.argb(120, 16, 35, 63));
            badge.setStroke(dp(2), Color.WHITE);
            cell.check.setTextColor(Color.WHITE);
            cell.check.setBackground(badge);
            Bitmap cached = thumbnails.get(key);
            if (cached != null) {
                cell.image.setImageBitmap(cached);
            } else {
                thumbnailExecutor.execute(() -> {
                    try {
                        Bitmap bitmap = getContentResolver().loadThumbnail(uri, new Size(360, 360), null);
                        thumbnails.put(key, bitmap);
                        runOnUiThread(() -> {
                            if (key.equals(cell.image.getTag())) cell.image.setImageBitmap(bitmap);
                        });
                    } catch (Exception ignored) {
                    }
                });
            }
            return convertView;
        }
    }

    private static class Cell {
        final View root;
        final ImageView image;
        final TextView check;

        Cell(View root, ImageView image, TextView check) {
            this.root = root;
            this.image = image;
            this.check = check;
        }
    }
}
