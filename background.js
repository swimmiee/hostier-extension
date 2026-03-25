// Hostroom Chrome Extension — Background Service Worker
// 플랫폼 쿠키 변경을 감지하고 토큰을 서버로 전송한다.

const HOSTROOM_URL = "https://hostroom.vercel.app";

const PLATFORM_COOKIES = {
  THIRTY_THREE_M2: {
    url: "https://web.33m2.co.kr",
    name: "__Secure-session-token",
    loginUrl: "https://web.33m2.co.kr/sign-in",
    homeUrl: "https://web.33m2.co.kr/host/main",
    ttlDays: 30,
  },
  ENKORSTAY: {
    url: "https://host.enko.kr",
    name: "host.access.token",
    loginUrl: "https://host.enko.kr/signin",
    homeUrl: "https://host.enko.kr",
    ttlDays: 365,
  },
  LIVEANYWHERE: {
    url: "https://console.liveanywhere.me",
    name: "rtoken",
    loginUrl: "https://account.liveanywhere.me",
    homeUrl: "https://console.liveanywhere.me/host",
    ttlDays: 30,
  },
};

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

    const res = await fetch(`${HOSTROOM_URL}/api/platform-connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        platform,
        token: cookie.value,
        tokenExpiresAt,
      }),
    });

    if (res.ok) {
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

// 쿠키 변경 감지
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
