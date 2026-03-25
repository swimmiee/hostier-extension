// Hostroom Chrome Extension — Background Service Worker
// 플랫폼 쿠키 변경을 감지하고 토큰을 서버로 전송한다.
// 또한 주기적으로 모든 쿠키를 재캡처하여 서버의 토큰을 최신 상태로 유지한다.

const HOSTROOM_URL = "https://hostroom.vercel.app";

const PLATFORM_COOKIES = {
  THIRTY_THREE_M2: {
    url: "https://web.33m2.co.kr/",
    name: "__Secure-session-token",
    loginUrl: "https://web.33m2.co.kr/sign-in",
    homeUrl: "https://web.33m2.co.kr/host/main",
    ttlDays: 30,
  },
  ENKORSTAY: {
    url: "https://host.enko.kr/",
    name: "host.access.token",
    loginUrl: "https://host.enko.kr/signin",
    homeUrl: "https://host.enko.kr",
    ttlDays: 365,
  },
  LIVEANYWHERE: {
    url: "https://console.liveanywhere.me/",
    name: "rtoken",
    loginUrl: "https://account.liveanywhere.me/?returnUrl=https://console.liveanywhere.me",
    homeUrl: "https://console.liveanywhere.me/host",
    ttlDays: 30,
  },
};

// 주기적 동기화 간격 (분)
const SYNC_INTERVAL_MINUTES = 120; // 2시간

/**
 * Hostroom 세션 쿠키를 읽어서 Cookie 헤더로 포함하여 fetch.
 */
async function fetchWithSession(url, options = {}) {
  const cookies = await chrome.cookies.getAll({ url: HOSTROOM_URL });
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Cookie: cookieHeader,
    },
  });
}

/**
 * 특정 플랫폼의 쿠키를 읽고 서버로 전송한다.
 */
async function captureAndSendToken(platform) {
  const config = PLATFORM_COOKIES[platform];
  if (!config) return;

  try {
    const cookie = await chrome.cookies.get({
      url: config.url,
      name: config.name,
    });

    if (!cookie || !cookie.value) return;

    const tokenExpiresAt = cookie.expirationDate
      ? new Date(cookie.expirationDate * 1000).toISOString()
      : new Date(Date.now() + config.ttlDays * 86400000).toISOString();

    const res = await fetchWithSession(`${HOSTROOM_URL}/api/platform-connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        token: cookie.value,
        tokenExpiresAt,
      }),
    });

    if (res.ok) {
      console.log(`[Hostroom] ${platform} token synced`);
      chrome.storage.local.set({
        [`connection_${platform}`]: {
          status: "ACTIVE",
          updatedAt: new Date().toISOString(),
        },
      });
    }
  } catch (e) {
    console.error(`[Hostroom] Failed to send ${platform} token:`, e);
  }
}

/**
 * 모든 플랫폼의 쿠키를 재캡처하여 서버에 전송.
 * 33m2 같은 플랫폼의 내부 accessToken이 짧은 TTL(~3시간)이므로,
 * 브라우저의 최신 쿠키를 주기적으로 서버에 동기화해야 한다.
 */
async function syncAllTokens() {
  console.log("[Hostroom] Periodic token sync started");
  for (const platform of Object.keys(PLATFORM_COOKIES)) {
    await captureAndSendToken(platform);
  }
  console.log("[Hostroom] Periodic token sync complete");
}

// 쿠키 변경 감지 — 즉시 동기화
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.removed) return;

  const cookie = changeInfo.cookie;

  for (const [platform, config] of Object.entries(PLATFORM_COOKIES)) {
    const hostname = new URL(config.url).hostname;
    const cookieDomain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
    if (cookie.name === config.name && hostname.endsWith(cookieDomain)) {
      console.log(`[Hostroom] Detected ${platform} cookie change`);
      captureAndSendToken(platform);
      break;
    }
  }
});

// 주기적 알람 설정 — 2시간마다 모든 토큰 재동기화
chrome.alarms.create("syncTokens", {
  delayInMinutes: 1, // 확장 시작 1분 후 첫 실행
  periodInMinutes: SYNC_INTERVAL_MINUTES,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "syncTokens") {
    syncAllTokens();
  }
});

// 확장 설치/업데이트 시 즉시 동기화
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Hostroom] Extension installed/updated — syncing tokens");
  syncAllTokens();
});

// 웹페이지에서 확장으로 플랫폼 연결 요청
chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (message.type !== "CONNECT_PLATFORM") {
      sendResponse({ success: false, error: "Unknown message type" });
      return true;
    }

    const platform = message.platform;
    const config = PLATFORM_COOKIES[platform];
    if (!config) {
      sendResponse({ success: false, error: "Unknown platform" });
      return true;
    }

    // Try existing cookie first, then open login page
    chrome.cookies.get({ url: config.url, name: config.name })
      .then(async (cookie) => {
        if (cookie && cookie.value) {
          await captureAndSendToken(platform);
          sendResponse({ success: true });
        } else {
          await chrome.tabs.create({ url: config.loginUrl });
          sendResponse({ success: false, error: "LOGIN_REQUIRED" });
        }
      })
      .catch((e) => {
        sendResponse({ success: false, error: e.message || "Unknown error" });
      });

    return true; // keep channel open for async response
  }
);
