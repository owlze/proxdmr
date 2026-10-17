// Toast and HUD Notifications

export function showCenterHudToast(text, duration = 2000) {
  const old = document.getElementById("proxdmrCenterHudToast");
  if (old) old.remove();

  const hud = document.createElement("div");
  hud.id = "proxdmrCenterHudToast";
  hud.style.cssText = [
    "position: fixed;",
    "top: 50%;",
    "left: 50%;",
    "transform: translate(-50%, -50%) scale(0.85);",
    "z-index: 100000;",
    "background: rgba(18, 22, 30, 0.94);",
    "border: 1.5px solid rgba(255, 255, 255, 0.22);",
    "box-shadow: 0 16px 48px rgba(0, 0, 0, 0.75), 0 0 20px rgba(0,0,0,0.3);",
    "color: #ffffff;",
    "padding: 16px 28px;",
    "border-radius: 16px;",
    "font-size: 1.25rem;",
    "font-weight: 700;",
    "letter-spacing: 0.5px;",
    "text-align: center;",
    "white-space: nowrap;",
    "backdrop-filter: blur(14px);",
    "-webkit-backdrop-filter: blur(14px);",
    "pointer-events: none;",
    "user-select: none;",
    "opacity: 0;",
    "transition: opacity 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);"
  ].join("");

  hud.textContent = text;
  document.body.appendChild(hud);

  requestAnimationFrame(() => {
    hud.style.opacity = "1";
    hud.style.transform = "translate(-50%, -50%) scale(1)";
  });

  setTimeout(() => {
    hud.style.opacity = "0";
    hud.style.transform = "translate(-50%, -50%) scale(0.92)";
    setTimeout(() => {
      if (hud.parentNode) hud.remove();
    }, 300);
  }, duration);
}

/**
 * Strip emojis, symbols, and pictographs from text for clean minimal toasts
 * @param {string} text
 * @returns {string}
 */
export function stripToastEmojis(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/[\p{Extended_Pictographic}\u2700-\u27BF\u2600-\u26FF\u2300-\u23FF\u2B50\u20E3\uFE00-\uFE0F✓✔✕✖✗✘▶⏸⏹⏺]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Show a short toast notification.
 * On PC (>768px): Anchored at the bottom of the HotSpot card to which it belongs.
 * On smartphone (<=768px): Centered at the bottom of the screen.
 *
 * @param {string} msg Message text
 * @param {number} duration Duration in ms (default: 3500)
 * @param {HTMLElement|string|null} targetCardOrId Optional target card element or hotspot id
 */
export function showToast(msg, duration = 3500, targetCardOrId = null) {
  let dur = (typeof duration === "number" && !isNaN(duration)) ? duration : 3500;
  if (typeof duration !== "number" && !targetCardOrId) {
    if (typeof duration === "string" && (duration.startsWith("hs") || (typeof document !== "undefined" && document.querySelector(`.radio-container[data-hotspot-id="${duration}"]`)))) {
      targetCardOrId = duration;
      dur = 3500;
    }
  }

  const isMobile = (typeof window !== "undefined") && window.innerWidth <= 768;

  // Resolve target hotspot card
  let targetCard = null;
  if (!isMobile && typeof document !== "undefined") {
    if (targetCardOrId) {
      if (targetCardOrId instanceof Element) {
        targetCard = (typeof targetCardOrId.closest === "function") ? targetCardOrId.closest(".radio-container") : targetCardOrId;
      } else if (typeof targetCardOrId === "string") {
        targetCard = document.querySelector(`.radio-container[data-hotspot-id="${targetCardOrId}"]`);
      }
    }
    if (!targetCard) {
      const activeEl = document.activeElement;
      if (activeEl && typeof activeEl.closest === "function") {
        targetCard = activeEl.closest(".radio-container");
      }
    }
    if (!targetCard && typeof window !== "undefined" && window.activeHotspotId) {
      targetCard = document.querySelector(`.radio-container[data-hotspot-id="${window.activeHotspotId}"]`);
    }
    if (!targetCard) {
      targetCard = document.querySelector(".radio-container.active-hotspot") ||
                   document.querySelector(".radio-container:not(.collapsed)") ||
                   document.querySelector(".radio-container");
    }
  }

  // Determine container ID
  const containerId = (targetCard && !isMobile)
    ? ("toastContainer_hs_" + (targetCard.dataset.hotspotId || "default"))
    : "toastContainer";

  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    container.className = "proxdmr-toast-container";
    document.body.appendChild(container);
  }

  // Update container position
  const updateContainerPosition = () => {
    if (isMobile || !targetCard) {
      container.style.cssText = [
        "position: fixed;",
        "bottom: 24px;",
        "left: 50%;",
        "transform: translateX(-50%);",
        "z-index: 99999;",
        "pointer-events: none;",
        "display: flex;",
        "flex-direction: column;",
        "gap: 8px;",
        "align-items: center;",
        "width: max-content;",
        "max-width: 90vw;"
      ].join("");
    } else {
      const rect = targetCard.getBoundingClientRect();
      const centerX = Math.round(rect.left + rect.width / 2);
      const effectiveBottom = Math.min(window.innerHeight - 14, rect.bottom);
      const bottomOffset = Math.max(14, Math.round(window.innerHeight - effectiveBottom + 12));
      const maxW = Math.max(260, Math.round(rect.width - 24));

      container.style.cssText = [
        "position: fixed;",
        `bottom: ${bottomOffset}px;`,
        `left: ${centerX}px;`,
        "transform: translateX(-50%);",
        "z-index: 99999;",
        "pointer-events: none;",
        "display: flex;",
        "flex-direction: column;",
        "gap: 8px;",
        "align-items: center;",
        "width: max-content;",
        `max-width: ${maxW}px;`
      ].join("");
    }
  };

  updateContainerPosition();

  // Keep position in sync during scrolls/resizes while toasts are visible
  if (!container._hasPositionWatcher && !isMobile && targetCard) {
    container._hasPositionWatcher = true;
    const reposHandler = () => {
      if (document.getElementById(containerId)) {
        updateContainerPosition();
      } else {
        window.removeEventListener("scroll", reposHandler, true);
        window.removeEventListener("resize", reposHandler);
      }
    };
    window.addEventListener("scroll", reposHandler, true);
    window.addEventListener("resize", reposHandler);
    container._reposHandler = reposHandler;
  }

  // Create toast element
  const toast = document.createElement("div");
  toast.className = "proxdmr-toast-item";
  toast.style.cssText = [
    "background: #ff6b2b;",
    "border: 1px solid rgba(0, 0, 0, 0.15);",
    "box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(255, 107, 43, 0.25);",
    "color: #ffffff;",
    "text-shadow: 1.5px 1.5px 1px rgba(0, 0, 0, 0.75);",
    "padding: 5px 14px;",
    "border-radius: 6px;",
    "font-size: 0.84rem;",
    "font-weight: 600;",
    "line-height: 1.25;",
    "text-align: center;",
    "backdrop-filter: blur(8px);",
    "-webkit-backdrop-filter: blur(8px);",
    "transition: opacity 0.25s ease, transform 0.25s ease;",
    "opacity: 0;",
    "transform: translateY(8px);",
    "pointer-events: auto;",
    "max-width: 100%;",
    "word-break: break-word;",
    "box-sizing: border-box;"
  ].join("");

  toast.textContent = stripToastEmojis(msg);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => {
      toast.remove();
      if (container && container.childNodes.length === 0 && container.id !== "toastContainer") {
        if (container._reposHandler) {
          window.removeEventListener("scroll", container._reposHandler, true);
          window.removeEventListener("resize", container._reposHandler);
        }
        container.remove();
      }
    }, 250);
  }, dur);
}

if (typeof window !== "undefined") {
  window.showToast = showToast;
  window.showCenterHudToast = showCenterHudToast;
  window.stripToastEmojis = stripToastEmojis;
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.showToast = showToast;
  window.__proxdmr.showCenterHudToast = showCenterHudToast;
  window.__proxdmr.stripToastEmojis = stripToastEmojis;
}
