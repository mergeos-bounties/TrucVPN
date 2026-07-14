package shop.mergeos.trucvpn;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class DaemonClient {
    private final String baseUrl;

    DaemonClient(String baseUrl) {
        this.baseUrl = normalizeBaseUrl(baseUrl);
    }

    JSONObject get(String path) throws IOException, JSONException {
        return request("GET", path, null);
    }

    JSONObject post(String path, JSONObject body) throws IOException, JSONException {
        return request("POST", path, body == null ? new JSONObject() : body);
    }

    private JSONObject request(String method, String path, JSONObject body) throws IOException, JSONException {
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(2500);
        connection.setReadTimeout(6000);
        connection.setRequestProperty("Accept", "application/json");

        if (body != null) {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
        }

        int status = connection.getResponseCode();
        String raw = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
        if (status >= 400) {
            throw new IOException(errorMessage(raw, status));
        }
        if (raw.trim().isEmpty()) {
            return new JSONObject();
        }
        return new JSONObject(raw);
    }

    private static String read(InputStream input) throws IOException {
        if (input == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private static String errorMessage(String raw, int status) {
        try {
            JSONObject json = new JSONObject(raw);
            return json.optString("error", "Daemon returned HTTP " + status);
        } catch (JSONException ignored) {
            return "Daemon returned HTTP " + status;
        }
    }

    private static String normalizeBaseUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) {
            value = "http://10.0.2.2:17888";
        }
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://" + value;
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }
}
