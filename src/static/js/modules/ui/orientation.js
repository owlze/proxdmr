import { pendingPings, connectWebSocket } from '../network/ws.js';

/**
 * Screen Orientation Lock & Shield Management
 */
export function initOrientationLock() {
  function tryLock() {
    try {
      if (window.screen && window.screen.orientation && typeof window.screen.orientation.lock === "function") {
        window.screen.orientation.lock("portrait-primary").catch(() => {
          if (typeof window.screen.orientation.lock === "function") {
            window.screen.orientation.lock("portrait").catch(() => {});
          }
        });
      }
    } catch (_) {}
  }

  tryLock();

  const onFirstGesture = () => {
    tryLock();
    window.removeEventListener("touchstart", onFirstGesture, true);
    window.removeEventListener("click", onFirstGesture, true);
  };
  window.addEventListener("touchstart", onFirstGesture, { capture: true, passive: true });
  window.addEventListener("click", onFirstGesture, { capture: true, passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      tryLock();
      if (pendingPings && typeof pendingPings.clear === "function") {
        pendingPings.clear();
      }
      if (typeof window.runSystemLinkCheck === "function") {
        window.runSystemLinkCheck();
      } else if (!window.isManualGwDisconnect && (!window.ws || window.ws.readyState === WebSocket.CLOSED || window.ws.readyState === WebSocket.CLOSING)) {
        console.log("[Visibility] Resumed from background, reconnecting WebSocket...");
        connectWebSocket();
      }
    }
  });

  window.addEventListener("online", () => {
    if (typeof window.runSystemLinkCheck === "function") {
      window.runSystemLinkCheck();
    } else if (!window.isManualGwDisconnect && (!window.ws || window.ws.readyState === WebSocket.CLOSED || window.ws.readyState === WebSocket.CLOSING)) {
      console.log("[Network] Online event detected, reconnecting WebSocket...");
      connectWebSocket();
    }
  });

  const btnDismiss = document.getElementById("btnDismissOrientationShield");
  if (btnDismiss) {
    btnDismiss.addEventListener("click", () => {
      document.body.classList.add("allow-landscape");
      try {
        sessionStorage.setItem("proxdmr_allow_landscape", "1");
      } catch (_) {}
    });
  }

  try {
    if (sessionStorage.getItem("proxdmr_allow_landscape") === "1") {
      document.body.classList.add("allow-landscape");
    }
  } catch (_) {}

  if (window.matchMedia) {
    const portraitQuery = window.matchMedia("(orientation: portrait)");
    const handleOrientationChange = (e) => {
      if (e.matches) {
        document.body.classList.remove("allow-landscape");
        try {
          sessionStorage.removeItem("proxdmr_allow_landscape");
        } catch (_) {}
        tryLock();
      }
    };
    if (portraitQuery && portraitQuery.addEventListener) {
      portraitQuery.addEventListener("change", handleOrientationChange);
    } else if (portraitQuery && portraitQuery.addListener) {
      portraitQuery.addListener(handleOrientationChange);
    }
  }
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.initOrientationLock = initOrientationLock;
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.initOrientationLock = initOrientationLock;
}
