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
    private LinearLayout statusCard;
    private LinearLayout statusStats;
    private TextView stateLabel;
    private TextView statusCaption;
    private TextView exitStat;
    private TextView proxyStat;
    private TextView trafficStat;
    private TextView mrgStat;
    private TextView errorLabel;
    private LinearLayout exitsList;
    private Button connectButton;
    private Button disconnectButton;
    private Button refreshButton;
    private String selectedExitId;
    private boolean connected;
    private JSONArray currentExits = new JSONArray();

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
        scroll.setBackgroundColor(color("#EEF3F7"));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pagePadding, dp(18), pagePadding, dp(30));
        scroll.addView(root, new ScrollView.LayoutParams(
            ScrollView.LayoutParams.MATCH_PARENT,
            ScrollView.LayoutParams.WRAP_CONTENT
        ));

        root.addView(hero());
        root.addView(space(16));

        statusCard = card(dp(20), dp(18));
        statusCard.setBackground(statusBackground(false));
        statusCard.addView(statusHeader());

        statusCaption = text("Waiting for daemon status.", 15, "#667085", Typeface.NORMAL);
        statusCaption.setLineSpacing(dp(2), 1.05f);
        statusCaption.setPadding(0, dp(10), 0, 0);
        statusCard.addView(statusCaption);

        statusStats = new LinearLayout(this);
        statusStats.setOrientation(LinearLayout.VERTICAL);
        statusStats.setPadding(0, dp(14), 0, 0);
        exitStat = statTile(statusStats, "Exit", "Not connected");
        proxyStat = statTile(statusStats, "Proxy", "127.0.0.1:17881");
        trafficStat = statTile(statusStats, "Traffic", "0 bytes");
        mrgStat = statTile(statusStats, "MRG cost", "0.0");
        statusCard.addView(statusStats);

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        controls.setPadding(0, dp(16), 0, 0);
        connectButton = button("Connect", true);
        disconnectButton = button("Disconnect", false);
        refreshButton = button("Refresh", false);
        controls.addView(connectButton, weightParams());
        controls.addView(space(8));
        controls.addView(disconnectButton, weightParams());
        controls.addView(space(8));
        controls.addView(refreshButton, weightParams());
        statusCard.addView(controls);
        root.addView(statusCard);

        connectButton.setOnClickListener(view -> connect());
        disconnectButton.setOnClickListener(view -> disconnect());
        refreshButton.setOnClickListener(view -> refresh());

        LinearLayout settingsCard = card(dp(18), dp(16));
        settingsCard.addView(sectionTitle("Daemon", "Local API endpoint used by native clients."));
        daemonUrl = new EditText(this);
        daemonUrl.setSingleLine(true);
        daemonUrl.setText(prefs.getString(PREF_DAEMON_URL, DEFAULT_DAEMON_URL));
        daemonUrl.setTextColor(color("#111827"));
        daemonUrl.setHintTextColor(color("#98A2B3"));
        daemonUrl.setHint(DEFAULT_DAEMON_URL);
        daemonUrl.setTextSize(14);
        daemonUrl.setPadding(dp(14), dp(12), dp(14), dp(12));
        daemonUrl.setBackground(inputBackground());
        settingsCard.addView(daemonUrl);
        root.addView(space(12));
        root.addView(settingsCard);

        LinearLayout exitsCard = card(dp(18), dp(16));
        exitsCard.addView(sectionTitle("Exit network", "Residential routes ranked by latency and load."));
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

    private LinearLayout hero() {
        LinearLayout hero = new LinearLayout(this);
        hero.setOrientation(LinearLayout.VERTICAL);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        TextView mark = text("TV", 18, "#FFFFFF", Typeface.BOLD);
        mark.setGravity(Gravity.CENTER);
        mark.setBackground(roundedBackground("#0E8A5F", "#0E8A5F", 18));
        row.addView(mark, new LinearLayout.LayoutParams(dp(52), dp(52)));
        row.addView(space(12));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView title = text("TrucVPN", 34, "#101828", Typeface.BOLD);
        TextView subtitle = text("Native control for MRGMinner residential exits", 15, "#667085", Typeface.NORMAL);
        copy.addView(title);
        copy.addView(subtitle);
        row.addView(copy, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        hero.addView(row);

        LinearLayout chips = new LinearLayout(this);
        chips.setOrientation(LinearLayout.HORIZONTAL);
        chips.setPadding(0, dp(14), 0, 0);
        chips.addView(featureChip("Daemon"));
        chips.addView(space(8));
        chips.addView(featureChip("Proxy"));
        chips.addView(space(8));
        chips.addView(featureChip("MRG"));
        hero.addView(chips);
        return hero;
    }

    private LinearLayout statusHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView eyebrow = text("SECURE TUNNEL", 11, "#0E8A5F", Typeface.BOLD);
        eyebrow.setLetterSpacing(0.08f);
        stateLabel = text("Checking", 30, "#101828", Typeface.BOLD);
        copy.addView(eyebrow);
        copy.addView(stateLabel);
        header.addView(copy, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView badge = text("Ready", 12, "#0E8A5F", Typeface.BOLD);
        badge.setGravity(Gravity.CENTER);
        badge.setPadding(dp(12), dp(7), dp(12), dp(7));
        badge.setBackground(roundedBackground("#E7F8EF", "#BFE8D2", 999));
        header.addView(badge);
        return header;
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
        styleButton(refreshButton, false, true);

        if (!connected) {
            statusCard.setBackground(statusBackground(false));
            stateLabel.setText("Disconnected");
            stateLabel.setTextColor(color("#101828"));
            statusCaption.setText(status.optString("hint", "Start the daemon, choose an exit, then connect."));
            statusCaption.setTextColor(color("#667085"));
            exitStat.setText("Not connected");
            proxyStat.setText("127.0.0.1:17881");
            trafficStat.setText("0 bytes");
            mrgStat.setText("0.0");
            return;
        }

        JSONObject exit = status.optJSONObject("exit");
        JSONObject socks = status.optJSONObject("socks");
        JSONObject http = status.optJSONObject("http");
        JSONObject traffic = status.optJSONObject("traffic");

        String exitName = exit == null ? "unknown" : exit.optString("name", exit.optString("id", "unknown"));
        String socksEndpoint = endpoint(socks, "127.0.0.1", 17880);
        String httpEndpoint = endpoint(http, "127.0.0.1", 17881);
        String bytes = traffic == null ? "0" : String.valueOf(traffic.optLong("bytes_total", 0));
        String mrg = traffic == null ? "0" : String.valueOf(traffic.optDouble("estimated_mrg_cost", 0));

        statusCard.setBackground(statusBackground(true));
        stateLabel.setText("Protected");
        stateLabel.setTextColor(color("#FFFFFF"));
        statusCaption.setText("Traffic is routed through TrucVPN local proxies.");
        statusCaption.setTextColor(color("#C9F0DD"));
        exitStat.setText(exitName);
        proxyStat.setText("HTTP " + httpEndpoint + "\nSOCKS5 " + socksEndpoint);
        trafficStat.setText(bytes + " bytes");
        mrgStat.setText(mrg);
    }

    private String endpoint(JSONObject json, String fallbackHost, int fallbackPort) {
        if (json == null) {
            return fallbackHost + ":" + fallbackPort;
        }
        return json.optString("host", fallbackHost) + ":" + json.optInt("port", fallbackPort);
    }

    private void renderExits(JSONArray exits) {
        currentExits = exits;
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
                exitsList.addView(space(10));
            }
        }
    }

    private View exitRow(ExitNode exit) {
        boolean selected = exit.id.equals(selectedExitId);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), dp(13), dp(14), dp(13));
        row.setBackground(roundedBackground(selected ? "#ECFDF3" : "#FFFFFF", selected ? "#0E8A5F" : "#D0D5DD", 18));

        View strip = new View(this);
        strip.setBackground(roundedBackground(exit.residential ? "#0E8A5F" : "#667085", exit.residential ? "#0E8A5F" : "#667085", 999));
        row.addView(strip, new LinearLayout.LayoutParams(dp(4), dp(56)));
        row.addView(space(12));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView name = text(exit.name, 16, "#101828", Typeface.BOLD);
        String latency = exit.latencyMs >= 0 ? exit.latencyMs + "ms" : "?ms";
        String load = exit.load >= 0 ? String.format(Locale.US, "%.0f%%", exit.load * 100) : "?";
        TextView meta = text(
            exit.region + " - " + exit.protocol + " - load " + load,
            13,
            "#667085",
            Typeface.NORMAL
        );
        TextView type = text(exit.residential ? "Residential route" : "Local direct", 12, "#0E8A5F", Typeface.BOLD);
        copy.addView(name);
        copy.addView(space(4));
        copy.addView(meta);
        copy.addView(space(5));
        copy.addView(type);
        row.addView(copy, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView latencyPill = text(latency, 12, "#101828", Typeface.BOLD);
        latencyPill.setGravity(Gravity.CENTER);
        latencyPill.setPadding(dp(9), dp(6), dp(9), dp(6));
        latencyPill.setBackground(roundedBackground("#F2F4F7", "#E4E7EC", 999));
        row.addView(latencyPill);
        row.setOnClickListener(view -> {
            selectedExitId = exit.id;
            renderExits(currentExits);
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

    private LinearLayout card(int horizontalPadding, int verticalPadding) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(horizontalPadding, verticalPadding, horizontalPadding, verticalPadding);
        card.setBackground(roundedBackground("#FFFFFF", "#D0D5DD", 22));
        return card;
    }

    private LinearLayout sectionTitle(String title, String subtitle) {
        LinearLayout group = new LinearLayout(this);
        group.setOrientation(LinearLayout.VERTICAL);
        group.setPadding(0, 0, 0, dp(12));
        group.addView(text(title, 20, "#101828", Typeface.BOLD));
        TextView note = text(subtitle, 13, "#667085", Typeface.NORMAL);
        note.setPadding(0, dp(3), 0, 0);
        group.addView(note);
        return group;
    }

    private TextView statTile(LinearLayout parent, String label, String value) {
        LinearLayout tile = new LinearLayout(this);
        tile.setOrientation(LinearLayout.VERTICAL);
        tile.setPadding(dp(13), dp(10), dp(13), dp(10));
        tile.setBackground(roundedBackground("#F8FAFC", "#E4E7EC", 16));

        TextView labelView = text(label, 11, "#667085", Typeface.BOLD);
        labelView.setLetterSpacing(0.06f);
        TextView valueView = text(value, 14, "#101828", Typeface.BOLD);
        valueView.setPadding(0, dp(4), 0, 0);
        valueView.setLineSpacing(0, 1.05f);
        tile.addView(labelView);
        tile.addView(valueView);
        parent.addView(tile);
        parent.addView(space(8));
        return valueView;
    }

    private TextView featureChip(String label) {
        TextView chip = text(label, 12, "#0E8A5F", Typeface.BOLD);
        chip.setGravity(Gravity.CENTER);
        chip.setPadding(dp(12), dp(7), dp(12), dp(7));
        chip.setBackground(roundedBackground("#E7F8EF", "#BFE8D2", 999));
        return chip;
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
        button.setMinHeight(dp(48));
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

    private GradientDrawable statusBackground(boolean isConnected) {
        if (isConnected) {
            GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[] { color("#0B3324"), color("#0E8A5F") }
            );
            bg.setCornerRadius(dp(24));
            return bg;
        }
        return roundedBackground("#FFFFFF", "#D0D5DD", 24);
    }

    private GradientDrawable inputBackground() {
        return roundedBackground("#FFFFFF", "#D0D5DD", 14);
    }

    private GradientDrawable buttonBackground(boolean primary) {
        return roundedBackground(primary ? "#0E8A5F" : "#FFFFFF", primary ? "#0E8A5F" : "#D0D5DD", 14);
    }

    private void styleButton(Button button, boolean primary, boolean enabled) {
        if (!enabled) {
            button.setTextColor(color("#98A2B3"));
            button.setBackground(roundedBackground("#F2F4F7", "#D0D5DD", 14));
            return;
        }
        button.setTextColor(primary ? Color.WHITE : color("#101828"));
        button.setBackground(buttonBackground(primary));
    }

    private GradientDrawable roundedBackground(String fill, String stroke, int radiusDp) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color(fill));
        bg.setCornerRadius(dp(radiusDp));
        bg.setStroke(dp(1), color(stroke));
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
