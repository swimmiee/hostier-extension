const statusEl = document.getElementById("status");
const config = globalThis.HOSTIER_EXTENSION_CONFIG;
const reloadUrl = chrome.runtime.getURL("dev-reload.json");

let lastVersion = null;
let started = false;

function setStatus(title, body) {
  statusEl.innerHTML = `<strong>${title}</strong><br>${body}`;
}

async function readReloadMarker() {
  const response = await fetch(`${reloadUrl}?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  return response.json().catch(() => null);
}

async function tick() {
  if (config?.target !== "dev") {
    setStatus("비활성화", "이 helper는 dev target에서만 동작합니다.");
    return;
  }

  const marker = await readReloadMarker().catch(() => null);
  if (!marker?.version) {
    setStatus("watcher 대기 중", "아직 dev watcher가 시작되지 않았습니다.");
    return;
  }

  if (!started) {
    started = true;
    lastVersion = marker.version;
    setStatus(
      "watch 중",
      `마지막 변경: ${marker.reason ?? "unknown"} · ${marker.updatedAt ?? ""}`,
    );
    return;
  }

  if (marker.version !== lastVersion) {
    lastVersion = marker.version;
    setStatus(
      "reload 중",
      `변경 감지: ${marker.reason ?? "unknown"} · 확장을 다시 불러오는 중입니다.`,
    );
    chrome.runtime.sendMessage({ type: "HOSTIER_DEV_RELOAD" });
    return;
  }

  setStatus(
    "watch 중",
    `마지막 변경: ${marker.reason ?? "unknown"} · ${marker.updatedAt ?? ""}`,
  );
}

setInterval(() => {
  void tick();
}, 1000);

void tick();
