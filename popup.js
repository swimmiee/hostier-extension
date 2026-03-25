const HOSTROOM_URL = "https://hostroom.vercel.app";

const PLATFORM_COOKIES = {
  THIRTY_THREE_M2: {
    url: "https://web.33m2.co.kr/",
    name: "__Secure-session-token",
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
    homeUrl: "https://host.enko.kr",
    ttlDays: 365,
    label: "EnkorStay",
    indicatorId: "indicator-enkorstay",
    btnId: "btn-enkorstay",
  },
  LIVEANYWHERE: {
    url: "https://console.liveanywhere.me/",
    name: "rtoken",
    loginUrl: "https://account.liveanywhere.me/?returnUrl=https://console.liveanywhere.me",
    homeUrl: "https://console.liveanywhere.me/host",
    ttlDays: 30,
    label: "LiveAnywhere",
    indicatorId: "indicator-liveanywhere",
    btnId: "btn-liveanywhere",
  },
};

/**
 * Hostroom 세션 쿠키를 읽어서 Cookie 헤더로 포함하여 fetch.
 * Chrome 확장에서 cross-origin credentials: "include"가 안 되므로 직접 처리.
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

async function loadStatus() {
  try {
    const res = await fetchWithSession(`${HOSTROOM_URL}/api/platform-connections`);
    if (!res.ok) {
      if (res.status === 401) {
        document.getElementById("userEmail").textContent = "Hostroom에 로그인해주세요";
      }
      return;
    }
    const data = await res.json();

    const sessionRes = await fetchWithSession(`${HOSTROOM_URL}/api/auth/session`);
    if (sessionRes.ok) {
      const session = await sessionRes.json();
      if (session?.user?.email) {
        document.getElementById("userEmail").textContent = session.user.email;
      }
    }

    for (const conn of data.connections) {
      const config = PLATFORM_COOKIES[conn.platform];
      if (!config) continue;
      setConnected(config, conn.status === "ACTIVE");
    }
  } catch (e) {
    console.error("[Hostroom] Failed to load status:", e);
  }
}

function setConnected(config, connected) {
  const indicator = document.getElementById(config.indicatorId);
  const btn = document.getElementById(config.btnId);

  if (connected) {
    indicator.textContent = "●";
    indicator.classList.add("connected");
    btn.textContent = "연결됨";
    btn.classList.add("connected");
    btn.disabled = true;
  } else {
    indicator.textContent = "○";
    indicator.classList.remove("connected");
    btn.textContent = "연결하기";
    btn.classList.remove("connected");
    btn.disabled = false;
  }
}

async function connectPlatform(platform) {
  const config = PLATFORM_COOKIES[platform];

  // 먼저 쿠키가 이미 있는지 확인
  try {
    const cookie = await chrome.cookies.get({
      url: config.url,
      name: config.name,
    });

    if (cookie && cookie.value) {
      const tokenExpiresAt = cookie.expirationDate
        ? new Date(cookie.expirationDate * 1000).toISOString()
        : new Date(Date.now() + config.ttlDays * 86400000).toISOString();

      const res = await fetchWithSession(
        `${HOSTROOM_URL}/api/platform-connections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform,
            token: cookie.value,
            tokenExpiresAt,
          }),
        },
      );

      if (res.ok) {
        setConnected(config, true);
        chrome.storage.local.set({
          [`connection_${platform}`]: {
            status: "ACTIVE",
            updatedAt: new Date().toISOString(),
          },
        });
        return;
      }
    }
  } catch (e) {
    console.log("[Hostroom] Cookie check failed, opening login page:", e);
  }

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
  chrome.tabs.create({ url: HOSTROOM_URL });
});

chrome.storage.onChanged.addListener((changes) => {
  for (const [key] of Object.entries(changes)) {
    if (key.startsWith("connection_")) {
      loadStatus();
      break;
    }
  }
});

loadStatus();
