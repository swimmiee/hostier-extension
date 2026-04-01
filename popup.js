const HOSTAY_URL = "https://hostay.vercel.app";
const msg = chrome.i18n.getMessage.bind(chrome.i18n);

const PLATFORM_COOKIES = {
  THIRTY_THREE_M2: {
    url: "https://web.33m2.co.kr/",
    name: "__Secure-session-token",
    firebaseSessionName: "__firebase_session",
    loginUrl: "https://web.33m2.co.kr/sign-in",
    homeUrl: "https://web.33m2.co.kr/host/main",
    ttlDays: 30,
    label: "33m2",
    indicatorId: "indicator-33m2",
    btnId: "btn-33m2",
  },
  ENKORSTAY: {
    url: "https://host.enko.kr/",
    name: "host.access.token",
    loginUrl: "https://host.enko.kr/signin",
    ttlDays: 365,
    label: "EnkorStay",
    indicatorId: "indicator-enkorstay",
    btnId: "btn-enkorstay",
  },
  LIVEANYWHERE: {
    url: "https://console.liveanywhere.me/",
    name: "rtoken",
    loginUrl:
      "https://account.liveanywhere.me/?returnUrl=https://console.liveanywhere.me",
    ttlDays: 30,
    label: "LiveAnywhere",
    indicatorId: "indicator-liveanywhere",
    btnId: "btn-liveanywhere",
  },
};

async function loadStatus() {
  try {
    const res = await fetch(`${HOSTAY_URL}/api/platform-connections`, {
      credentials: "include",
    });
    if (!res.ok) {
      if (res.status === 401) {
        document.getElementById("userEmail").textContent = msg("pleaseLogin");
      }
      return;
    }
    const data = await res.json();

    const sessionRes = await fetch(`${HOSTAY_URL}/api/auth/session`, {
      credentials: "include",
    });
    if (sessionRes.ok) {
      const session = await sessionRes.json();
      if (session?.user?.email) {
        document.getElementById("userEmail").textContent = session.user.email;
      }
    }

    const connectedPlatforms = new Set(
      data.connections
        .filter((c) => c.status === "ACTIVE")
        .map((c) => c.platform),
    );
    for (const [platform, config] of Object.entries(PLATFORM_COOKIES)) {
      setConnected(config, connectedPlatforms.has(platform));
    }
  } catch (e) {
    console.error("[hostay] Failed to load status:", e);
  }
}

function setConnected(config, connected) {
  const indicator = document.getElementById(config.indicatorId);
  const btn = document.getElementById(config.btnId);
  btn.classList.remove("loading");
  indicator.classList.remove("loading");

  if (connected) {
    indicator.textContent = "●";
    indicator.classList.add("connected");
    btn.textContent = msg("connected");
    btn.classList.add("connected");
    btn.disabled = true;
  } else {
    indicator.textContent = "○";
    indicator.classList.remove("connected");
    btn.textContent = msg("connect");
    btn.classList.remove("connected");
    btn.disabled = false;
  }
}

/**
 * 33m2의 Firebase refresh token을 IndexedDB에서 읽는다.
 * Firebase Auth는 firebaseLocalStorageDb > firebaseLocalStorage에 저장.
 */
async function getFirebaseRefreshToken() {
  try {
    const [tab] = await chrome.tabs.query({ url: "https://web.33m2.co.kr/*" });
    if (!tab) return null;

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

    return result?.result || null;
  } catch (e) {
    console.log("[hostay] Failed to read Firebase refresh token:", e);
    return null;
  }
}

async function handleMissing33m2RefreshToken(config) {
  await chrome.tabs.create({ url: config.homeUrl || config.url });
  alert(
    "33m2 연결에 필요한 refresh token을 읽지 못했습니다. 로그인된 33m2 탭을 연 상태에서 다시 연결해주세요.",
  );
}

async function connectPlatform(platform) {
  const config = PLATFORM_COOKIES[platform];

  try {
    const cookie = await chrome.cookies.get({
      url: config.url,
      name: config.name,
    });

    if (cookie && cookie.value) {
      const tokenExpiresAt = cookie.expirationDate
        ? new Date(cookie.expirationDate * 1000).toISOString()
        : new Date(Date.now() + config.ttlDays * 86400000).toISOString();

      // 33m2인 경우 Firebase refresh token도 캡처
      let refreshToken = null;
      let firebaseSessionToken = null;
      if (platform === "THIRTY_THREE_M2") {
        refreshToken = await getFirebaseRefreshToken();
        if (!refreshToken) {
          await handleMissing33m2RefreshToken(config);
          return;
        }

        const firebaseSessionCookie = await chrome.cookies.get({
          url: config.url,
          name: config.firebaseSessionName,
        });
        firebaseSessionToken = firebaseSessionCookie?.value || null;
      }

      const res = await fetch(`${HOSTAY_URL}/api/platform-connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          platform,
          token: cookie.value,
          refreshToken,
          firebaseSessionToken,
          tokenExpiresAt,
        }),
      });

      if (res.ok) {
        setConnected(config, true);
        return;
      }

      const errorBody = await res.json().catch(() => null);
      if (
        platform === "THIRTY_THREE_M2" &&
        errorBody?.code === "MISSING_33M2_REFRESH_TOKEN"
      ) {
        await handleMissing33m2RefreshToken(config);
        return;
      }
    }
  } catch (e) {
    console.log("[hostay] Cookie check failed, opening login page:", e);
  }

  // 연결 대기 플래그 설정 → background의 쿠키 리스너가 감지하면 전송
  chrome.storage.local.set({ [`pending_${platform}`]: true });
  chrome.tabs.create({ url: config.loginUrl });
}

document.getElementById("btn-33m2").addEventListener("click", () => {
  connectPlatform("THIRTY_THREE_M2");
});

document.getElementById("btn-enkorstay").addEventListener("click", () => {
  connectPlatform("ENKORSTAY");
});

document.getElementById("btn-liveanywhere").addEventListener("click", () => {
  connectPlatform("LIVEANYWHERE");
});

document.getElementById("openWebsite").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: HOSTAY_URL });
});

// i18n: set initial text from locale
document.getElementById("userEmail").textContent = msg("loginRequired");
document.getElementById("openWebsite").textContent = msg("openWebsite");
for (const config of Object.values(PLATFORM_COOKIES)) {
  const btn = document.getElementById(config.btnId);
  const indicator = document.getElementById(config.indicatorId);
  btn.classList.add("loading");
  btn.disabled = true;
  indicator.classList.add("loading");
}

loadStatus();
