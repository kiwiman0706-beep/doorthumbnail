package jp.yaegaki.omoide;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import jp.co.kingjim.tepraprint.sdk.TepraPrintDiscoverConnectionType;
import jp.co.kingjim.tepraprint.sdk.TepraPrintDiscoverPrinter;
import jp.co.kingjim.tepraprint.sdk.TepraPrintDiscoverPrinterCallback;

public class SearchActivity extends Activity implements TepraPrintDiscoverPrinterCallback {
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

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Map<String, String>> printers = new ArrayList<>();
    private final List<String> rows = new ArrayList<>();
    private ArrayAdapter<String> adapter;
    private TepraPrintDiscoverPrinter discoverer;
    private TextView statusView;
    private ProgressBar progressBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("SR5900Pを探す");
        setContentView(buildContentView());
        startSearch();
    }

    private LinearLayout buildContentView() {
        int padding = dp(20);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(padding, padding, padding, padding);
        root.setBackgroundColor(Color.rgb(247, 249, 252));

        TextView title = new TextView(this);
        title.setText("同じWi‑Fi上のSR5900P");
        title.setTextColor(Color.rgb(16, 35, 63));
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title, matchWrap());

        TextView guide = new TextView(this);
        guide.setText("スマートフォンとテプラを同じWi‑Fiに接続してください。見つかった機器をタップすると登録できます。");
        guide.setTextColor(Color.rgb(79, 96, 117));
        guide.setTextSize(14);
        guide.setLineSpacing(0, 1.25f);
        LinearLayout.LayoutParams guideParams = matchWrap();
        guideParams.setMargins(0, dp(8), 0, dp(16));
        root.addView(guide, guideParams);

        LinearLayout searchingRow = new LinearLayout(this);
        searchingRow.setOrientation(LinearLayout.HORIZONTAL);
        searchingRow.setGravity(Gravity.CENTER_VERTICAL);
        progressBar = new ProgressBar(this);
        searchingRow.addView(progressBar, new LinearLayout.LayoutParams(dp(28), dp(28)));
        statusView = new TextView(this);
        statusView.setText("検索しています…");
        statusView.setTextColor(Color.rgb(16, 112, 105));
        statusView.setTextSize(14);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        statusParams.setMargins(dp(10), 0, 0, 0);
        searchingRow.addView(statusView, statusParams);
        root.addView(searchingRow, matchWrap());

        ListView listView = new ListView(this);
        listView.setDividerHeight(dp(8));
        listView.setBackgroundColor(Color.TRANSPARENT);
        adapter = new ArrayAdapter<String>(this, android.R.layout.simple_list_item_1, rows) {
            @Override
            public android.view.View getView(int position, android.view.View convertView, ViewGroup parent) {
                TextView view = (TextView) super.getView(position, convertView, parent);
                view.setTextColor(Color.rgb(16, 35, 63));
                view.setTextSize(16);
                view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
                view.setPadding(dp(14), dp(12), dp(14), dp(12));
                view.setBackgroundColor(Color.WHITE);
                return view;
            }
        };
        listView.setAdapter(adapter);
        listView.setOnItemClickListener((parent, view, position, id) -> selectPrinter(position));
        LinearLayout.LayoutParams listParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        listParams.setMargins(0, dp(14), 0, dp(14));
        root.addView(listView, listParams);

        Button retry = new Button(this);
        retry.setAllCaps(false);
        retry.setText("もう一度探す");
        retry.setTextColor(Color.WHITE);
        retry.setTextSize(15);
        retry.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        retry.setBackgroundColor(Color.rgb(16, 35, 63));
        retry.setOnClickListener(view -> startSearch());
        root.addView(retry, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));
        return root;
    }

    private void startSearch() {
        stopSearch();
        printers.clear();
        rows.clear();
        if (adapter != null) adapter.notifyDataSetChanged();
        progressBar.setVisibility(android.view.View.VISIBLE);
        statusView.setText("検索しています…");

        List<String> types = Arrays.asList("_pdl-datastream._tcp.local.");
        List<String> models = Arrays.asList("(KING JIM TEPRA PRO SR5900P)");
        EnumSet<TepraPrintDiscoverConnectionType> connectionTypes =
                EnumSet.of(TepraPrintDiscoverConnectionType.ConnectionTypeNetwork);
        discoverer = new TepraPrintDiscoverPrinter(types, models, connectionTypes);
        discoverer.setCallback(this);
        discoverer.enableMulticastOnWifi(this);
        discoverer.startDiscover(this);

        handler.postDelayed(() -> {
            if (printers.isEmpty() && discoverer != null) {
                progressBar.setVisibility(android.view.View.GONE);
                statusView.setText("見つかりません。同じWi‑Fiへの接続とSR5900Pの電源を確認し、「もう一度探す」を押してください。");
            }
        }, 12000);
    }

    @Override
    public void onFindPrinter(TepraPrintDiscoverPrinter source, Map<String, String> printer) {
        HashMap<String, String> found = new HashMap<>();
        for (String key : PRINTER_KEYS) found.put(key, value(printer.get(key)));
        String identifier = found.get(TepraPrintDiscoverPrinter.PRINTER_INFO_HOST) + "|"
                + found.get(TepraPrintDiscoverPrinter.PRINTER_INFO_NAME);

        handler.post(() -> {
            for (Map<String, String> existing : printers) {
                String existingIdentifier = existing.get(TepraPrintDiscoverPrinter.PRINTER_INFO_HOST) + "|"
                        + existing.get(TepraPrintDiscoverPrinter.PRINTER_INFO_NAME);
                if (identifier.equals(existingIdentifier)) return;
            }
            printers.add(found);
            String name = found.get(TepraPrintDiscoverPrinter.PRINTER_INFO_NAME);
            if (TextUtils.isEmpty(name)) name = "SR5900P";
            String host = found.get(TepraPrintDiscoverPrinter.PRINTER_INFO_HOST);
            rows.add(TextUtils.isEmpty(host) ? name : name + "\n" + host);
            adapter.notifyDataSetChanged();
            progressBar.setVisibility(android.view.View.GONE);
            statusView.setText("見つかりました。使用するSR5900Pをタップしてください。");
        });
    }

    @Override
    public void onRemovePrinter(TepraPrintDiscoverPrinter source, Map<String, String> printer) {
        String host = value(printer.get(TepraPrintDiscoverPrinter.PRINTER_INFO_HOST));
        String name = value(printer.get(TepraPrintDiscoverPrinter.PRINTER_INFO_NAME));
        handler.post(() -> {
            for (int index = printers.size() - 1; index >= 0; index--) {
                Map<String, String> existing = printers.get(index);
                if (host.equals(value(existing.get(TepraPrintDiscoverPrinter.PRINTER_INFO_HOST)))
                        && name.equals(value(existing.get(TepraPrintDiscoverPrinter.PRINTER_INFO_NAME)))) {
                    printers.remove(index);
                    rows.remove(index);
                }
            }
            adapter.notifyDataSetChanged();
        });
    }

    private void selectPrinter(int position) {
        if (position < 0 || position >= printers.size()) return;
        Intent result = new Intent();
        Map<String, String> selected = printers.get(position);
        for (String key : PRINTER_KEYS) result.putExtra(key, value(selected.get(key)));
        setResult(RESULT_OK, result);
        finish();
    }

    private void stopSearch() {
        handler.removeCallbacksAndMessages(null);
        if (discoverer != null) {
            discoverer.stopDiscover();
            discoverer.disableMulticastOnWifi();
            discoverer = null;
        }
    }

    @Override
    protected void onDestroy() {
        stopSearch();
        super.onDestroy();
    }

    private static String value(String value) {
        return value == null ? "" : value;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }
}
