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
// 33m2의 JWT가 ~1시간 TTL이므로 30분마다 동기화
const SYNC_INTERVAL_MINUTES = 30;

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
 * 33m2 세션 쿠키 갱신을 트리거한다.
 * 33m2는 Next.js 앱으로, 페이지 요청 시 미들웨어가 세션 JWT를 갱신해줌.
 * 확장의 host_permissions 덕분에 fetch에 쿠키가 포함됨.
 * 서버가 Set-Cookie로 새 JWT를 보내면 브라우저가 쿠키를 업데이트함.
 */
async function refreshSessionCookie(platform) {
  const config = PLATFORM_COOKIES[platform];
  if (!config) return;

  try {
    // 현재 쿠키를 읽어서 직접 Cookie 헤더로 전송
    const currentCookie = await chrome.cookies.get({
      url: config.url,
      name: config.name,
    });
    if (!currentCookie || !currentCookie.value) return;

    const res = await fetch(config.homeUrl, {
      headers: { Cookie: `${config.name}=${currentCookie.value}` },
      redirect: "follow",
    });

    // Set-Cookie 응답 헤더에서 새 토큰 추출
    const setCookie = res.headers.get("set-cookie") || "";
    const match = setCookie.match(new RegExp(`${config.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]+)`));

    if (match && match[1] !== currentCookie.value) {
      console.log(`[Hostroom] ${platform} session refreshed via Set-Cookie`);
      return;  // cookies.onChanged 리스너가 자동으로 captureAndSendToken 호출
    }

    // Set-Cookie가 없으면 getAll로 브라우저가 쿠키를 업데이트했는지 확인
    const freshCookie = await chrome.cookies.get({
      url: config.url,
      name: config.name,
    });

    if (freshCookie && freshCookie.value !== currentCookie.value) {
      console.log(`[Hostroom] ${platform} session refreshed (cookie changed)`);
    } else {
      console.log(`[Hostroom] ${platform} session refresh: no cookie change (status=${res.status})`);
    }
  } catch (e) {
    console.log(`[Hostroom] ${platform} session refresh failed:`, e.message || e);
  }
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

    if (!cookie || !cookie.value) {
      console.log(`[Hostroom] No ${config.name} cookie found for ${platform}`);
      return;
    }

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
    } else {
      console.warn(`[Hostroom] ${platform} token sync failed: ${res.status}`);
    }
  } catch (e) {
    console.error(`[Hostroom] Failed to send ${platform} token:`, e);
  }
}

/**
 * 모든 플랫폼의 쿠키를 재캡처하여 서버에 전송.
 * 33m2의 JWT가 ~1시간 TTL이므로, 먼저 세션 갱신을 시도한 후 캡처한다.
 */
async function syncAllTokens() {
  console.log("[Hostroom] Periodic token sync started");

  // 33m2 세션 갱신 시도 (JWT가 짧은 TTL이므로)
  await refreshSessionCookie("THIRTY_THREE_M2");
  // 갱신 후 쿠키 변경이 반영될 시간 대기
  await new Promise((resolve) => setTimeout(resolve, 1000));

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

// 주기적 알람 설정 — 30분마다 모든 토큰 재동기화
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
