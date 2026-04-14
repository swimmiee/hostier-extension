(function initPageGuard33m2(root) {
  const FLAG = "__HOSTIER_33M2_PAGE_GUARD_ACTIVE__";
  if (root[FLAG]) {
    return;
  }
  root[FLAG] = true;

  const {
    matchesLogoutText,
  } = root.HostierPageGuard33M2Shared || {};

  const MESSAGE_TYPES = {
    GET_BROWSER_SESSION: "HOSTIER_GET_33M2_BROWSER_SESSION",
    SAFE_LOGOUT: "HOSTIER_SAFE_LOGOUT_33M2",
  };
  const CONTAINER_ID = "hostier-33m2-safe-logout-root";

  let shadowRoot = null;
  let toastEl = null;
  let overlayBackdropEl = null;
  let overlayEl = null;
  let overlayCloseButtonEl = null;
  let overlayTitleEl = null;
  let overlayBodyEl = null;
  let overlaySafeButtonEl = null;
  let overlayNativeButtonEl = null;
  let pendingNativeLogoutTarget = null;
  let allowNativeLogoutUntil = 0;
  let toastTimerId = 0;

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }

          resolve(response ?? { ok: false, error: "empty_response" });
        });
      } catch (error) {
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  function getContainer() {
    let container = document.getElementById(CONTAINER_ID);
    if (container) {
      return container;
    }

    container = document.createElement("div");
    container.id = CONTAINER_ID;
    container.dataset.hostier33m2Control = "true";
    container.style.position = "fixed";
    container.style.top = "0";
    container.style.left = "0";
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.zIndex = "2147483647";
    container.style.pointerEvents = "none";
    shadowRoot = container.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .hostier-shell {
          pointer-events: none;
          position: fixed;
          inset: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .hostier-toast {
          position: fixed;
          right: 20px;
          bottom: 20px;
          display: none;
          max-width: min(84vw, 320px);
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(15, 23, 42, 0.12);
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 18px 42px rgba(15, 23, 42, 0.18);
          backdrop-filter: blur(12px);
          color: #0f172a;
          font-size: 12px;
          line-height: 1.45;
          pointer-events: auto;
        }

        .hostier-toast[data-open="true"] {
          display: block;
        }

        .hostier-overlay-backdrop {
          position: fixed;
          inset: 0;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(15, 23, 42, 0.18);
          pointer-events: auto;
        }

        .hostier-overlay-backdrop[data-open="true"] {
          display: flex;
        }

        .hostier-overlay {
          display: none;
          width: min(86vw, 360px);
          padding: 16px;
          border-radius: 20px;
          border: 1px solid rgba(15, 23, 42, 0.12);
          background: rgba(255, 255, 255, 0.98);
          box-shadow: 0 18px 42px rgba(15, 23, 42, 0.22);
          color: #0f172a;
          pointer-events: auto;
        }

        .hostier-overlay[data-open="true"] {
          display: block;
        }

        .hostier-overlay-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
        }

        .hostier-overlay-title {
          font-size: 15px;
          font-weight: 700;
          line-height: 1.35;
        }

        .hostier-overlay-close {
          width: 32px;
          height: 32px;
          border: 0;
          border-radius: 999px;
          background: #f3f4f6;
          color: #475569;
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
          flex-shrink: 0;
        }

        .hostier-overlay-body {
          font-size: 13px;
          line-height: 1.5;
          color: #475569;
        }

        .hostier-overlay-actions {
          display: flex;
          gap: 10px;
          margin-top: 14px;
        }

        .hostier-overlay-actions button {
          flex: 1;
          border-radius: 12px;
          border: 0;
          padding: 11px 12px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }

        .hostier-safe {
          background: #2f6f43;
          color: #fff;
        }

        .hostier-native {
          background: #f3f4f6;
          color: #0f172a;
        }

        .hostier-safe:hover,
        .hostier-safe:focus-visible {
          background: #285f39;
        }

        .hostier-native:hover,
        .hostier-native:focus-visible {
          background: #e5e7eb;
        }
      </style>
      <div class="hostier-shell" data-hostier-33m2-control="true">
        <div class="hostier-toast" id="hostier-33m2-toast" data-hostier-33m2-control="true"></div>
        <div class="hostier-overlay-backdrop" id="hostier-33m2-overlay-backdrop" data-hostier-33m2-control="true">
          <div class="hostier-overlay" id="hostier-33m2-overlay" data-hostier-33m2-control="true">
            <div class="hostier-overlay-head" data-hostier-33m2-control="true">
              <div class="hostier-overlay-title" id="hostier-33m2-overlay-title" data-hostier-33m2-control="true"></div>
              <button type="button" class="hostier-overlay-close" id="hostier-33m2-overlay-close" data-hostier-33m2-control="true" aria-label="닫기">×</button>
            </div>
            <div class="hostier-overlay-body" id="hostier-33m2-overlay-body" data-hostier-33m2-control="true"></div>
            <div class="hostier-overlay-actions" data-hostier-33m2-control="true">
              <button type="button" class="hostier-safe" id="hostier-33m2-overlay-safe" data-hostier-33m2-control="true">Hostier 안전 로그아웃</button>
              <button type="button" class="hostier-native" id="hostier-33m2-overlay-native" data-hostier-33m2-control="true">33m2 로그아웃 계속</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(container);
    toastEl = shadowRoot.getElementById("hostier-33m2-toast");
    overlayBackdropEl = shadowRoot.getElementById("hostier-33m2-overlay-backdrop");
    overlayEl = shadowRoot.getElementById("hostier-33m2-overlay");
    overlayCloseButtonEl = shadowRoot.getElementById("hostier-33m2-overlay-close");
    overlayTitleEl = shadowRoot.getElementById("hostier-33m2-overlay-title");
    overlayBodyEl = shadowRoot.getElementById("hostier-33m2-overlay-body");
    overlaySafeButtonEl = shadowRoot.getElementById("hostier-33m2-overlay-safe");
    overlayNativeButtonEl = shadowRoot.getElementById("hostier-33m2-overlay-native");

    overlayBackdropEl.addEventListener("click", (event) => {
      if (event.target === overlayBackdropEl) {
        closeOverlay();
      }
    });
    overlayCloseButtonEl.addEventListener("click", () => {
      closeOverlay();
    });
    overlaySafeButtonEl.addEventListener("click", () => {
      void runSafeLogout();
    });
    overlayNativeButtonEl.addEventListener("click", () => {
      continueNativeLogout();
    });

    return container;
  }

  function setOverlayOpen(open) {
    getContainer();
    if (overlayBackdropEl) {
      overlayBackdropEl.dataset.open = open ? "true" : "false";
    }
    if (overlayEl) {
      overlayEl.dataset.open = open ? "true" : "false";
    }
  }

  function closeOverlay() {
    pendingNativeLogoutTarget = null;
    setOverlayOpen(false);
  }

  function showToast(message) {
    getContainer();
    if (!toastEl) {
      return;
    }

    if (toastTimerId) {
      clearTimeout(toastTimerId);
    }
    toastEl.textContent = message;
    toastEl.dataset.open = "true";
    toastTimerId = setTimeout(() => {
      toastEl.dataset.open = "false";
      toastTimerId = 0;
    }, 2400);
  }

  async function runSafeLogout() {
    getContainer();
    setOverlayOpen(false);
    showToast("Hostier 안전 로그아웃을 진행하고 있습니다.");

    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.SAFE_LOGOUT,
    });

    if (!response?.ok) {
      showToast("안전 로그아웃에 실패했습니다. 다시 시도해주세요.");
      return;
    }

    showToast("안전 로그아웃을 완료했습니다.");
  }

  function continueNativeLogout() {
    const target = pendingNativeLogoutTarget;
    pendingNativeLogoutTarget = null;
    setOverlayOpen(false);
    if (!target || !target.isConnected) {
      return;
    }

    allowNativeLogoutUntil = Date.now() + 1000;
    queueMicrotask(() => {
      target.click();
    });
  }

  function isOwnControl(target) {
    return Boolean(target?.closest?.("[data-hostier-33m2-control='true']"));
  }

  function isLikelyLogoutElement(element) {
    if (!element || isOwnControl(element)) {
      return false;
    }

    const candidateText = [
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
    ];

    return candidateText.some((value) => matchesLogoutText?.(value));
  }

  function findLogoutTarget(start) {
    let current = start instanceof Element ? start : start?.parentElement;
    while (current && current !== document.body) {
      if (isLikelyLogoutElement(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function showNativeLogoutIntercept(target) {
    getContainer();
    pendingNativeLogoutTarget = target;
    if (overlayTitleEl) {
      overlayTitleEl.textContent = "33m2 로그아웃 전에 Hostier 안전 로그아웃을 쓰는 편이 안전합니다.";
    }
    if (overlayBodyEl) {
      overlayBodyEl.textContent = "33m2 기본 로그아웃은 저장된 Hostier 연결을 더 빨리 무효화할 수 있습니다. Hostier 안전 로그아웃을 먼저 쓰면 브라우저 세션만 정리하고 저장된 연결은 최대한 유지합니다.";
    }
    setOverlayOpen(true);
  }

  document.addEventListener("click", (event) => {
    if (Date.now() < allowNativeLogoutUntil) {
      allowNativeLogoutUntil = 0;
      return;
    }

    const target = findLogoutTarget(event.target);
    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    showNativeLogoutIntercept(target);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeOverlay();
    }
  });

})(typeof globalThis !== "undefined" ? globalThis : this);
