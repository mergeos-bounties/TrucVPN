const DEFAULT_DAEMON_URL = "http://127.0.0.1:17888";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
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
  await proxySet({
    mode: "fixed_servers",
    rules: {
      singleProxy: {
        scheme: "http",
        host: http.host || "127.0.0.1",
        port: Number(http.port || 17881)
      },
      bypassList: ["<local>", "127.0.0.1", "localhost"]
    }
  });
}

async function clearBrowserProxy() {
  await new Promise((resolve, reject) => {
    chrome.proxy.settings.clear({ scope: "regular" }, () => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve();
    });
  });
}

async function proxySet(value) {
  await new Promise((resolve, reject) => {
    chrome.proxy.settings.set({ value, scope: "regular" }, () => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve();
    });
  });
}

async function getDaemonUrl() {
  const data = await chromeStorageGet("daemonUrl");
  return normalizeDaemonUrl(data.daemonUrl || DEFAULT_DAEMON_URL);
}

async function setDaemonUrl(value) {
  await chromeStorageSet({ daemonUrl: normalizeDaemonUrl(value || DEFAULT_DAEMON_URL) });
}

function normalizeDaemonUrl(value) {
  let next = String(value || DEFAULT_DAEMON_URL).trim();
  if (!next.startsWith("http://") && !next.startsWith("https://")) {
    next = "http://" + next;
  }
  return next.replace(/\/+$/, "");
}

function chromeStorageGet(key) {
  return new Promise((resolve) => chrome.storage.local.get(key, resolve));
}

function chromeStorageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}
