/* TrucVPN dashboard */
let selectedExit = null;

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
  return data;
}

function renderStatus(s) {
  const dot = document.getElementById("dot");
  const label = document.getElementById("state-label");
  const meta = document.getElementById("status-meta");
  const connected = Boolean(s.connected);
  dot.className = "dot " + (connected ? "on" : "off");
  label.textContent = connected ? "Connected" : "Disconnected";
  const rows = [];
  if (connected) {
    rows.push(["Exit", s.exit?.id || "—"]);
    rows.push(["Protocol", s.exit?.protocol || "—"]);
    rows.push(["SOCKS5", `${s.socks?.host}:${s.socks?.port}`]);
    rows.push(["HTTP", `${s.http?.host}:${s.http?.port}`]);
    rows.push(["Bytes", String(s.traffic?.bytes_total ?? 0)]);
    rows.push(["Est. MRG cost", String(s.traffic?.estimated_mrg_cost ?? 0)]);
  } else {
    rows.push(["Hint", s.hint || "Connect to start local VPN proxies"]);
  }
  meta.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join("");
  document.getElementById("btn-connect").disabled = connected;
  document.getElementById("btn-disconnect").disabled = !connected;
}

function renderExits(exits) {
  const root = document.getElementById("exits");
  root.innerHTML = "";
  for (const e of exits) {
    const el = document.createElement("div");
    el.className = "exit" + (selectedExit === e.id ? " selected" : "");
    el.innerHTML = `
      <div>
        <div><strong>${escapeHtml(e.name || e.id)}</strong>
          ${e.residential ? '<span class="badge res">residential</span>' : '<span class="badge">local</span>'}
        </div>
        <div class="meta">${escapeHtml(e.id)} · ${escapeHtml(e.protocol || "")} · ${e.latency_ms ?? "?"}ms · load ${e.load ?? "—"}</div>
      </div>
      <div class="meta">${escapeHtml(e.region || "")}</div>`;
    el.onclick = () => {
      selectedExit = e.id;
      renderExits(exits);
    };
    root.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function refresh() {
  try {
    const [status, exits] = await Promise.all([api("/api/status"), api("/api/exits")]);
    renderStatus(status);
    renderExits(exits.exits || []);
  } catch (err) {
    document.getElementById("state-label").textContent = err.message;
  }
}

document.getElementById("btn-connect").onclick = async () => {
  try {
    await api("/api/connect", {
      method: "POST",
      body: JSON.stringify({ exit_id: selectedExit || undefined })
    });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
};

document.getElementById("btn-disconnect").onclick = async () => {
  try {
    await api("/api/disconnect", { method: "POST", body: "{}" });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
};

refresh();
setInterval(refresh, 3000);
