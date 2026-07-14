let selectedExitId = null;

const els = {
  dot: document.getElementById("state-dot"),
  label: document.getElementById("state-label"),
  meta: document.getElementById("status-meta"),
  connect: document.getElementById("connect"),
  disconnect: document.getElementById("disconnect"),
  daemonUrl: document.getElementById("daemon-url"),
  exits: document.getElementById("exits"),
  error: document.getElementById("error")
};

els.connect.addEventListener("click", () => connect());
els.disconnect.addEventListener("click", () => disconnect());
els.daemonUrl.addEventListener("change", () => send("set-daemon-url", { daemonUrl: els.daemonUrl.value }).then(render));

refresh();

async function refresh() {
  render(await send("refresh"));
}

async function connect() {
  render(await send("connect", { exitId: selectedExitId }));
}

async function disconnect() {
  render(await send("disconnect"));
}

async function send(type, payload = {}) {
  els.error.textContent = "";
  const response = await browser.runtime.sendMessage({ type, ...payload });
  if (!response.ok) {
    throw new Error(response.error || "TrucVPN extension error");
  }
  return response;
}

function render(payload) {
  const status = payload.status || {};
  const exits = payload.exits || [];
  els.daemonUrl.value = payload.daemonUrl || "";
  els.dot.classList.toggle("on", Boolean(status.connected));
  els.label.textContent = status.connected ? "Protected" : "Disconnected";
  els.connect.disabled = Boolean(status.connected);
  els.disconnect.disabled = !status.connected;

  const http = status.http || { host: "127.0.0.1", port: 17881 };
  const traffic = status.traffic || {};
  const rows = status.connected
    ? [
        ["Exit", status.exit?.name || status.exit?.id || "unknown"],
        ["HTTP", `${http.host}:${http.port}`],
        ["Bytes", String(traffic.bytes_total || 0)],
        ["MRG", String(traffic.estimated_mrg_cost || 0)]
      ]
    : [["Hint", status.hint || "Start trucvpn daemon"]];
  els.meta.innerHTML = rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("");

  els.exits.innerHTML = "";
  for (const exit of exits) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "exit" + (selectedExitId === exit.id ? " selected" : "");
    button.innerHTML = `
      <strong>${escapeHtml(exit.name || exit.id)}</strong>
      <span>${escapeHtml(exit.id)} - ${escapeHtml(exit.region || "auto")} - ${escapeHtml(exit.protocol || "proxy")}</span>
    `;
    button.addEventListener("click", () => {
      selectedExitId = exit.id;
      render(payload);
    });
    els.exits.appendChild(button);
  }
}

window.addEventListener("unhandledrejection", (event) => {
  els.error.textContent = event.reason?.message || "Unexpected extension error";
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
