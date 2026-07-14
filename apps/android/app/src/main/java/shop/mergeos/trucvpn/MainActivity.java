package shop.mergeos.trucvpn;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String PREFS = "trucvpn";
    private static final String PREF_DAEMON_URL = "daemon_url";
    private static final String DEFAULT_DAEMON_URL = "http://10.0.2.2:17888";

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    private SharedPreferences prefs;
    private EditText daemonUrl;
    private TextView stateLabel;
    private TextView statusMeta;
    private TextView errorLabel;
    private LinearLayout exitsList;
    private Button connectButton;
    private Button disconnectButton;
    private String selectedExitId;
    private boolean connected;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        buildUi();
        refresh();
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        super.onDestroy();
    }

    private void buildUi() {
        int pagePadding = dp(20);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(color("#F5F7FA"));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pagePadding, dp(18), pagePadding, dp(28));
        scroll.addView(root, new ScrollView.LayoutParams(
            ScrollView.LayoutParams.MATCH_PARENT,
            ScrollView.LayoutParams.WRAP_CONTENT
        ));

        TextView title = text("TrucVPN", 32, "#111827", Typeface.BOLD);
        TextView subtitle = text("Native control for MRGMinner residential exits", 15, "#667085", Typeface.NORMAL);
        root.addView(title);
        root.addView(subtitle);
        root.addView(space(16));

        LinearLayout statusCard = card();
        stateLabel = text("Checking daemon", 24, "#111827", Typeface.BOLD);
        statusMeta = text("Waiting for status...", 14, "#667085", Typeface.NORMAL);
        statusMeta.setLineSpacing(0, 1.18f);
        statusCard.addView(stateLabel);
        statusCard.addView(space(8));
        statusCard.addView(statusMeta);
        root.addView(statusCard);

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        controls.setPadding(0, dp(12), 0, 0);
        connectButton = button("Connect", true);
        disconnectButton = button("Disconnect", false);
        Button refreshButton = button("Refresh", false);
        controls.addView(connectButton, weightParams());
        controls.addView(space(8));
        controls.addView(disconnectButton, weightParams());
        controls.addView(space(8));
        controls.addView(refreshButton, weightParams());
        statusCard.addView(controls);

        connectButton.setOnClickListener(view -> connect());
        disconnectButton.setOnClickListener(view -> disconnect());
        refreshButton.setOnClickListener(view -> refresh());

        LinearLayout settingsCard = card();
        settingsCard.addView(sectionTitle("Daemon"));
        daemonUrl = new EditText(this);
        daemonUrl.setSingleLine(true);
        daemonUrl.setText(prefs.getString(PREF_DAEMON_URL, DEFAULT_DAEMON_URL));
        daemonUrl.setTextColor(color("#111827"));
        daemonUrl.setHintTextColor(color("#98A2B3"));
        daemonUrl.setHint(DEFAULT_DAEMON_URL);
        daemonUrl.setTextSize(14);
        daemonUrl.setPadding(dp(12), dp(10), dp(12), dp(10));
        daemonUrl.setBackground(inputBackground());
        settingsCard.addView(daemonUrl);
        root.addView(space(12));
        root.addView(settingsCard);

        LinearLayout exitsCard = card();
        exitsCard.addView(sectionTitle("Exits"));
        exitsList = new LinearLayout(this);
        exitsList.setOrientation(LinearLayout.VERTICAL);
        exitsCard.addView(exitsList);
        root.addView(space(12));
        root.addView(exitsCard);

        errorLabel = text("", 14, "#B42318", Typeface.BOLD);
        root.addView(space(12));
        root.addView(errorLabel);

        setContentView(scroll);
    }

    private void refresh() {
        persistDaemonUrl();
        runAsync(() -> {
            DaemonClient client = client();
            JSONObject status = client.get("/api/status");
            JSONArray exits = client.get("/api/exits").optJSONArray("exits");
            main.post(() -> {
                errorLabel.setText("");
                renderStatus(status);
                renderExits(exits == null ? new JSONArray() : exits);
            });
        });
    }

    private void connect() {
        persistDaemonUrl();
        runAsync(() -> {
            JSONObject body = new JSONObject();
            if (selectedExitId != null && !selectedExitId.isEmpty()) {
                body.put("exit_id", selectedExitId);
            }
            JSONObject status = client().post("/api/connect", body);
            main.post(() -> {
                errorLabel.setText("");
                renderStatus(status);
                refresh();
            });
        });
    }

    private void disconnect() {
        persistDaemonUrl();
        runAsync(() -> {
            client().post("/api/disconnect", new JSONObject());
            main.post(() -> {
                connected = false;
                errorLabel.setText("");
                refresh();
            });
        });
    }

    private void renderStatus(JSONObject status) {
        connected = status.optBoolean("connected", false);
        connectButton.setEnabled(!connected);
        disconnectButton.setEnabled(connected);
        styleButton(connectButton, true, !connected);
        styleButton(disconnectButton, false, connected);

        if (!connected) {
            stateLabel.setText("Disconnected");
            statusMeta.setText(status.optString("hint", "Start the daemon, choose an exit, then connect."));
            return;
        }

        JSONObject exit = status.optJSONObject("exit");
        JSONObject socks = status.optJSONObject("socks");
        JSONObject http = status.optJSONObject("http");
        JSONObject traffic = status.optJSONObject("traffic");

        stateLabel.setText("Protected");
        statusMeta.setText(String.format(Locale.US,
            "Exit: %s\nSOCKS5: %s:%s\nHTTP: %s:%s\nTraffic: %s bytes\nMRG cost: %s",
            exit == null ? "unknown" : exit.optString("name", exit.optString("id", "unknown")),
            socks == null ? "127.0.0.1" : socks.optString("host", "127.0.0.1"),
            socks == null ? "17880" : String.valueOf(socks.optInt("port", 17880)),
            http == null ? "127.0.0.1" : http.optString("host", "127.0.0.1"),
            http == null ? "17881" : String.valueOf(http.optInt("port", 17881)),
            traffic == null ? "0" : String.valueOf(traffic.optLong("bytes_total", 0)),
            traffic == null ? "0" : String.valueOf(traffic.optDouble("estimated_mrg_cost", 0))
        ));
    }

    private void renderExits(JSONArray exits) {
        exitsList.removeAllViews();
        for (int i = 0; i < exits.length(); i++) {
            JSONObject raw = exits.optJSONObject(i);
            if (raw == null) {
                continue;
            }
            ExitNode exit = ExitNode.fromJson(raw);
            View row = exitRow(exit);
            exitsList.addView(row);
            if (i < exits.length() - 1) {
                exitsList.addView(space(8));
            }
        }
    }

    private View exitRow(ExitNode exit) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dp(14), dp(12), dp(14), dp(12));
        row.setBackground(cardBackground(exit.id.equals(selectedExitId)));

        TextView name = text(exit.name, 16, "#111827", Typeface.BOLD);
        String latency = exit.latencyMs >= 0 ? exit.latencyMs + "ms" : "?ms";
        String load = exit.load >= 0 ? String.format(Locale.US, "%.0f%%", exit.load * 100) : "?";
        TextView meta = text(
            exit.id + " - " + exit.region + " - " + exit.protocol + " - " + latency + " - load " + load,
            13,
            "#667085",
            Typeface.NORMAL
        );
        TextView type = text(exit.residential ? "Residential exit" : "Local direct", 12, "#0E8A5F", Typeface.BOLD);
        row.addView(name);
        row.addView(space(4));
        row.addView(meta);
        row.addView(space(4));
        row.addView(type);
        row.setOnClickListener(view -> {
            selectedExitId = exit.id;
            refresh();
        });
        return row;
    }

    private void runAsync(ThrowingRunnable runnable) {
        io.submit(() -> {
            try {
                main.post(() -> errorLabel.setText(""));
                runnable.run();
            } catch (Exception err) {
                main.post(() -> errorLabel.setText(err.getMessage()));
            }
        });
    }

    private DaemonClient client() {
        return new DaemonClient(daemonUrl.getText().toString());
    }

    private void persistDaemonUrl() {
        prefs.edit().putString(PREF_DAEMON_URL, daemonUrl.getText().toString().trim()).apply();
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(16), dp(18), dp(16));
        card.setBackground(cardBackground(false));
        return card;
    }

    private TextView sectionTitle(String value) {
        TextView view = text(value, 18, "#111827", Typeface.BOLD);
        view.setPadding(0, 0, 0, dp(10));
        return view;
    }

    private TextView text(String value, int sp, String color, int style) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color(color));
        view.setTypeface(Typeface.DEFAULT, style);
        return view;
    }

    private Button button(String label, boolean primary) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        styleButton(button, primary, true);
        button.setPadding(dp(8), dp(8), dp(8), dp(8));
        return button;
    }

    private View space(int dp) {
        View view = new View(this);
        view.setLayoutParams(new LinearLayout.LayoutParams(dp(dp), dp(dp)));
        return view;
    }

    private LinearLayout.LayoutParams weightParams() {
        return new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
    }

    private GradientDrawable cardBackground(boolean selected) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(18));
        bg.setStroke(dp(selected ? 2 : 1), color(selected ? "#0E8A5F" : "#D0D5DD"));
        return bg;
    }

    private GradientDrawable inputBackground() {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), color("#D0D5DD"));
        return bg;
    }

    private GradientDrawable buttonBackground(boolean primary) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color(primary ? "#0E8A5F" : "#FFFFFF"));
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), color(primary ? "#0E8A5F" : "#D0D5DD"));
        return bg;
    }

    private void styleButton(Button button, boolean primary, boolean enabled) {
        if (!enabled) {
            button.setTextColor(color("#98A2B3"));
            button.setBackground(disabledButtonBackground());
            return;
        }
        button.setTextColor(primary ? Color.WHITE : color("#111827"));
        button.setBackground(buttonBackground(primary));
    }

    private GradientDrawable disabledButtonBackground() {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color("#F2F4F7"));
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), color("#D0D5DD"));
        return bg;
    }

    private int color(String hex) {
        return Color.parseColor(hex);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
