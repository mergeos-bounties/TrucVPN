const DEFAULT_DAEMON_URL = "http://127.0.0.1:17888";

browser.runtime.onMessage.addListener(async (message) => {
  try {
    const payload = await handleMessage(message);
    return { ok: true, ...payload };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

async function handleMessage(message) {
  switch (message?.type) {
    case "set-daemon-url":
      await setDaemonUrl(message.daemonUrl);
      return await snapshot();
    case "refresh":
      return await snapshot();
    case "connect": {
      const status = await api("/api/connect", {
        method: "POST",
        body: JSON.stringify({ exit_id: message.exitId || undefined })
      });
      await setBrowserProxy(status);
      return await snapshot();
    }
    case "disconnect":
      await api("/api/disconnect", { method: "POST", body: "{}" }).catch(() => null);
      await clearBrowserProxy();
      return await snapshot();
    default:
      throw new Error("Unknown extension message");
  }
}

async function snapshot() {
  const [status, catalog, daemonUrl] = await Promise.all([
    api("/api/status"),
    api("/api/exits"),
    getDaemonUrl()
  ]);
  if (status.connected) {
    await setBrowserProxy(status);
  } else {
    await clearBrowserProxy();
  }
  return { status, exits: catalog.exits || [], daemonUrl };
}

async function api(path, options = {}) {
  const daemonUrl = await getDaemonUrl();
  const response = await fetch(daemonUrl + path, {
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

async function setBrowserProxy(status) {
  const http = status.http || { host: "127.0.0.1", port: 17881 };
  const socks = status.socks || { host: "127.0.0.1", port: 17880 };
  await browser.proxy.settings.set({
    value: {
      proxyType: "manual",
      http: http.host || "127.0.0.1",
      httpPort: Number(http.port || 17881),
      ssl: http.host || "127.0.0.1",
      sslPort: Number(http.port || 17881),
      socks: socks.host || "127.0.0.1",
      socksPort: Number(socks.port || 17880),
      socksVersion: 5,
      passthrough: "localhost, 127.0.0.1"
    }
  });
}

async function clearBrowserProxy() {
  await browser.proxy.settings.clear({});
}

async function getDaemonUrl() {
  const data = await browser.storage.local.get("daemonUrl");
  return normalizeDaemonUrl(data.daemonUrl || DEFAULT_DAEMON_URL);
}

async function setDaemonUrl(value) {
  await browser.storage.local.set({ daemonUrl: normalizeDaemonUrl(value || DEFAULT_DAEMON_URL) });
}

function normalizeDaemonUrl(value) {
  let next = String(value || DEFAULT_DAEMON_URL).trim();
  if (!next.startsWith("http://") && !next.startsWith("https://")) {
    next = "http://" + next;
  }
  return next.replace(/\/+$/, "");
}
