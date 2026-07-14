package shop.mergeos.trucvpn;

import org.json.JSONObject;

final class ExitNode {
    final String id;
    final String name;
    final String region;
    final String protocol;
    final boolean residential;
    final int latencyMs;
    final double load;

    private ExitNode(String id, String name, String region, String protocol, boolean residential, int latencyMs, double load) {
        this.id = id;
        this.name = name;
        this.region = region;
        this.protocol = protocol;
        this.residential = residential;
        this.latencyMs = latencyMs;
        this.load = load;
    }

    static ExitNode fromJson(JSONObject json) {
        return new ExitNode(
            json.optString("id", ""),
            json.optString("name", json.optString("id", "Exit")),
            json.optString("region", ""),
            json.optString("protocol", ""),
            json.optBoolean("residential", false),
            json.optInt("latency_ms", -1),
            json.optDouble("load", -1)
        );
    }
}
