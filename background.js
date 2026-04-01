// hostay Chrome Extension — Background Service Worker
// 플랫폼 쿠키 변경을 감지하고 토큰을 서버로 전송한다.
// 또한 주기적으로 모든 쿠키를 재캡처하여 서버의 토큰을 최신 상태로 유지한다.

const HOSTAY_URL = "https://hostay.vercel.app";

const PLATFORM_COOKIES = {
  THIRTY_THREE_M2: {
    url: "https://web.33m2.co.kr/",
    name: "__Secure-session-token",
    firebaseSessionName: "__firebase_session",
    loginUrl: "https://web.33m2.co.kr/sign-in",
    homeUrl: "https://web.33m2.co.kr/host/main",
    ttlDays: 30,
    label: "33m2",
  },
  ENKORSTAY: {
    url: "https://host.enko.kr/",
    name: "host.access.token",
    loginUrl: "https://host.enko.kr/signin",
    homeUrl: "https://host.enko.kr",
    ttlDays: 365,
    label: "EnkorStay",
  },
  LIVEANYWHERE: {
    url: "https://console.liveanywhere.me/",
    name: "rtoken",
    loginUrl:
      "https://account.liveanywhere.me/?returnUrl=https://console.liveanywhere.me",
    homeUrl: "https://console.liveanywhere.me/host",
    ttlDays: 30,
    label: "LiveAnywhere",
  },
};

// 주기적 동기화 간격 (분)
// 33m2의 JWT가 ~1시간 TTL이므로 30분마다 동기화
const SYNC_INTERVAL_MINUTES = 30;

/**
 * hostay 세션 쿠키를 읽어서 Cookie 헤더로 포함하여 fetch.
 */
async function fetchWithSession(url, options = {}) {
  const cookies = await chrome.cookies.getAll({ url: HOSTAY_URL });
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
 * 33m2는 /api/auth/refresh가 실제 세션 갱신 엔드포인트다.
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
    const firebaseSessionCookie = config.firebaseSessionName
      ? await chrome.cookies.get({
          url: config.url,
          name: config.firebaseSessionName,
        })
      : null;
    const cookieHeader = [
      `${config.name}=${currentCookie.value}`,
      firebaseSessionCookie?.value
        ? `${config.firebaseSessionName}=${firebaseSessionCookie.value}`
        : null,
    ]
      .filter(Boolean)
      .join("; ");

    const res =
      platform === "THIRTY_THREE_M2"
        ? await fetch("https://web.33m2.co.kr/api/auth/refresh", {
            method: "POST",
            headers: {
              Cookie: cookieHeader,
              "Content-Type": "application/json",
            },
            body: "{}",
            redirect: "manual",
          })
        : await fetch(config.homeUrl, {
            headers: { Cookie: `${config.name}=${currentCookie.value}` },
            redirect: "follow",
          });

    // fetch 후 브라우저가 쿠키를 업데이트했는지 확인
    // (service worker fetch에서는 Set-Cookie 헤더 접근 불가)
    const freshCookie = await chrome.cookies.get({
      url: config.url,
      name: config.name,
    });

    if (freshCookie && freshCookie.value !== currentCookie.value) {
      console.log(`[hostay] ${platform} session refreshed (cookie changed)`);
    } else {
      console.log(
        `[hostay] ${platform} session refresh: no cookie change (status=${res.status})`,
      );
    }
  } catch (e) {
    console.log(`[hostay] ${platform} session refresh failed:`, e.message || e);
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
      console.log(`[hostay] No ${config.name} cookie found for ${platform}`);
      return;
    }

    const tokenExpiresAt = cookie.expirationDate
      ? new Date(cookie.expirationDate * 1000).toISOString()
      : new Date(Date.now() + config.ttlDays * 86400000).toISOString();

    // 33m2인 경우 Firebase refresh token도 캡처 시도
    let refreshToken = undefined;
    let firebaseSessionToken = undefined;
    if (platform === "THIRTY_THREE_M2") {
      try {
        const firebaseSessionCookie = await chrome.cookies.get({
          url: config.url,
          name: config.firebaseSessionName,
        });
        firebaseSessionToken = firebaseSessionCookie?.value || undefined;

        const [tab] = await chrome.tabs.query({
          url: "https://web.33m2.co.kr/*",
        });
        if (tab) {
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              return new Promise((resolve) => {
                const req = indexedDB.open("firebaseLocalStorageDb");
                req.onsuccess = () => {
                  const db = req.result;
                  const tx = db.transaction("firebaseLocalStorage", "readonly");
                  const store = tx.objectStore("firebaseLocalStorage");
                  const getAll = store.getAll();
                  getAll.onsuccess = () => {
                    const extractRefreshToken = (entry) => {
                      const candidates = [
                        entry?.value?.stsTokenManager?.refreshToken,
                        entry?.value?.user?.stsTokenManager?.refreshToken,
                        entry?.value?.spipiRefreshToken,
                        entry?.value?.refreshToken,
                        entry?.stsTokenManager?.refreshToken,
                      ];

                      return (
                        candidates.find(
                          (candidate) =>
                            typeof candidate === "string" &&
                            candidate.length > 0 &&
                            candidate.split(".").length !== 3,
                        ) || null
                      );
                    };

                    const token = getAll.result
                      .map(extractRefreshToken)
                      .find(Boolean);
                    resolve(token || null);
                  };
                  getAll.onerror = () => resolve(null);
                };
                req.onerror = () => resolve(null);
              });
            },
          });
          refreshToken = result?.result || undefined;
        }
      } catch (e) {
        console.log(`[hostay] Failed to read Firebase refresh token:`, e);
      }
    }

    const res = await fetchWithSession(
      `${HOSTAY_URL}/api/platform-connections`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          token: cookie.value,
          refreshToken,
          firebaseSessionToken,
          tokenExpiresAt,
        }),
      },
    );

    if (res.ok) {
      console.log(`[hostay] ${platform} token synced`);
      chrome.storage.local.set({
        [`connection_${platform}`]: {
          status: "ACTIVE",
          updatedAt: new Date().toISOString(),
        },
      });
      return { ok: true };
    } else {
      const errorBody = await res.json().catch(() => null);
      console.warn(
        `[hostay] ${platform} token sync failed: ${res.status}`,
        errorBody,
      );

      if (
        platform === "THIRTY_THREE_M2" &&
        errorBody?.code === "MISSING_33M2_REFRESH_TOKEN"
      ) {
        chrome.notifications.create(`missing_refresh_${platform}`, {
          type: "basic",
          title: "hostay",
          message:
            "33m2 refresh token을 읽지 못했습니다. 로그인된 33m2 탭을 연 상태에서 다시 연결해주세요.",
          iconUrl: "icon48.png",
        });
      }

      return {
        ok: false,
        status: res.status,
        errorCode: errorBody?.code,
      };
    }
  } catch (e) {
    console.error(`[hostay] Failed to send ${platform} token:`, e);
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * 서버에 이미 연결된 플랫폼 목록을 가져온다.
 */
async function getConnectedPlatforms() {
  try {
    const res = await fetchWithSession(
      `${HOSTAY_URL}/api/platform-connections`,
    );
    if (!res.ok) return new Set();
    const data = await res.json();
    return new Set(data.connections.map((c) => c.platform));
  } catch {
    return new Set();
  }
}

/**
 * 서버에 이미 연결된 플랫폼의 쿠키만 재캡처하여 전송.
 * 연결되지 않은 플랫폼은 건너뛴다 (유저가 직접 "연결하기"를 눌러야 함).
 */
async function syncAllTokens() {
  console.log("[hostay] Periodic token sync started");

  const connected = await getConnectedPlatforms();
  if (connected.size === 0) {
    console.log("[hostay] No connected platforms, skipping sync");
    return;
  }

  // 33m2 세션 갱신 시도 (JWT가 짧은 TTL이므로)
  if (connected.has("THIRTY_THREE_M2")) {
    await refreshSessionCookie("THIRTY_THREE_M2");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  for (const platform of connected) {
    await captureAndSendToken(platform);
  }
  console.log("[hostay] Periodic token sync complete");
}

// 쿠키 변경 감지 — 연결 중이거나 이미 연결된 플랫폼만 동기화
chrome.cookies.onChanged.addListener(async (changeInfo) => {
  if (changeInfo.removed) return;

  const cookie = changeInfo.cookie;

  for (const [platform, config] of Object.entries(PLATFORM_COOKIES)) {
    const hostname = new URL(config.url).hostname;
    const cookieDomain = cookie.domain.startsWith(".")
      ? cookie.domain.slice(1)
      : cookie.domain;
    if (cookie.name === config.name && hostname.endsWith(cookieDomain)) {
      // 연결 대기 중(pending) 또는 이미 연결된 플랫폼만 처리
      const storage = await chrome.storage.local.get(`pending_${platform}`);
      const isPending = !!storage[`pending_${platform}`];

      if (isPending) {
        console.log(
          `[hostay] Detected ${platform} cookie after login — connecting`,
        );
        await captureAndSendToken(platform);
        chrome.storage.local.remove(`pending_${platform}`);
        const label = PLATFORM_COOKIES[platform]?.label || platform;
        chrome.notifications.create(`connected_${platform}`, {
          type: "basic",
          title: "hostay",
          message: chrome.i18n.getMessage("connectionComplete", [label]),
          iconUrl: "icon48.png",
        });
      } else {
        const connected = await getConnectedPlatforms();
        if (connected.has(platform)) {
          console.log(`[hostay] Detected ${platform} cookie change — syncing`);
          captureAndSendToken(platform);
        }
      }
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

// 확장 설치/업데이트 시 — 이미 연결된 플랫폼만 동기화
chrome.runtime.onInstalled.addListener(() => {
  console.log(
    "[hostay] Extension installed/updated — syncing connected platforms",
  );
  syncAllTokens();
});

// 웹페이지에서 확장으로 플랫폼 연결 요청
chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (message.type === "OPEN_POPUP") {
      chrome.windows.create({
        url: chrome.runtime.getURL("popup.html"),
        type: "popup",
        width: 400,
        height: 520,
        focused: true,
      });
      sendResponse({ success: true });
      return true;
    }

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
    chrome.cookies
      .get({ url: config.url, name: config.name })
      .then(async (cookie) => {
        if (cookie && cookie.value) {
          const result = await captureAndSendToken(platform);
          if (result?.ok) {
            sendResponse({ success: true });
          } else {
            sendResponse({
              success: false,
              error: result?.errorCode || "TOKEN_SYNC_FAILED",
            });
          }
        } else {
          await chrome.tabs.create({ url: config.loginUrl });
          sendResponse({ success: false, error: "LOGIN_REQUIRED" });
        }
      })
      .catch((e) => {
        sendResponse({ success: false, error: e.message || "Unknown error" });
      });

    return true; // keep channel open for async response
  },
);
