// Toast and HUD Notifications

// Short toasts: hold on screen for 1.6s, then smooth fade-out for 0.8s
const TOAST_HOLD_MS = 1300;
const TOAST_FADE_MS = 350;

export function showCenterHudToast(text, duration = TOAST_HOLD_MS) {
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
    "background: #0a5f2e;",
    "border: 1.5px solid rgba(255, 255, 255, 0.22);",
    "box-shadow: 0 14px 40px rgba(0, 0, 0, 0.65), 0 0 18px rgba(0, 255, 102, 0.28);",
    "color: #ffffff;",
    "text-shadow: none;",
    "padding: 16px 28px;",
    "border-radius: 0px;",
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
    hud.style.transition = `opacity ${TOAST_FADE_MS}ms ease-out, transform ${TOAST_FADE_MS}ms ease-out`;
    hud.style.opacity = "0";
    hud.style.transform = "translate(-50%, -50%) scale(0.96)";
    setTimeout(() => {
      if (hud.parentNode) hud.remove();
    }, TOAST_FADE_MS + 40);
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
 * Show a short toast notification centered on the target Hotspot card (or screen center if global)
 * with dark green background, white text, 1.6s pause and 0.8s fade-out.
 *
 * @param {string} msg Message text
 * @param {number} duration Duration in ms (default: 1000)
 * @param {HTMLElement|string|null} targetCardOrId Optional target card element or hotspot id
 */
export function showToast(msg, duration = TOAST_HOLD_MS, targetCardOrId = null) {
  let dur = (typeof duration === "number" && !isNaN(duration) && duration > 4500) ? duration : TOAST_HOLD_MS;
  if (typeof duration !== "number" && !targetCardOrId) {
    if (typeof duration === "string" && (duration.startsWith("hs") || (typeof document !== "undefined" && document.querySelector(`.radio-container[data-hotspot-id="${duration}"]`)))) {
      targetCardOrId = duration;
      dur = TOAST_HOLD_MS;
    }
  }

  // 1. Resolve target hotspot card
  let targetCard = null;
  if (typeof document !== "undefined") {
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
    // Also try to extract hotspot name/callsign/id from msg if formatted as [Name] or [callsign]
    if (!targetCard && typeof msg === "string") {
      const match = msg.match(/^\[(.*?)\]/);
      if (match && match[1]) {
        const hsKey = match[1].trim().toLowerCase();
        const allCards = document.querySelectorAll(".radio-container");
        for (const c of allCards) {
          const hid = (c.dataset.hotspotId || "").toLowerCase();
          const hsObj = (window.currentHotspots || []).find(h => (h.id || "").toLowerCase() === hid);
          const name = (hsObj?.name || "").toLowerCase();
          const call = (hsObj?.callsign || "").toLowerCase();
          if (name === hsKey || call === hsKey || hid === hsKey) {
            targetCard = c;
            break;
          }
        }
      }
    }
    // Also check if message starts with "Name: TS..." (e.g. from triggerQuickUnlink4000)
    if (!targetCard && typeof msg === "string") {
      const matchColon = msg.match(/^([^:\n]+):\s*TS[12]/);
      if (matchColon && matchColon[1]) {
        const hsKey = matchColon[1].trim().toLowerCase();
        const allCards = document.querySelectorAll(".radio-container");
        for (const c of allCards) {
          const hid = (c.dataset.hotspotId || "").toLowerCase();
          const hsObj = (window.currentHotspots || []).find(h => (h.id || "").toLowerCase() === hid);
          const name = (hsObj?.name || "").toLowerCase();
          const call = (hsObj?.callsign || "").toLowerCase();
          if (name === hsKey || call === hsKey || hid === hsKey) {
            targetCard = c;
            break;
          }
        }
      }
    }
    if (!targetCard && typeof window !== "undefined" && window.activeHotspotId) {
      targetCard = document.querySelector(`.radio-container[data-hotspot-id="${window.activeHotspotId}"]`);
    }
    if (!targetCard && typeof document !== "undefined") {
      targetCard = document.querySelector(".radio-container.active-hotspot") ||
                   document.querySelector(".radio-container:not(.collapsed)");
    }
  }

  // 2. Container setup (per hotspot card or global)
  const containerId = targetCard
    ? ("toastContainer_hs_" + (targetCard.dataset.hotspotId || "default"))
    : "toastContainer";

  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    container.className = "proxdmr-toast-container";
    document.body.appendChild(container);
  }

  // 3. Position update: top 1/5 (~20%) of targetCard, or 20% of viewport
  const updateContainerPosition = () => {
    if (targetCard && targetCard.isConnected) {
      const rect = targetCard.getBoundingClientRect();
      const centerX = Math.round(rect.left + rect.width / 2);
      const topY = Math.round(rect.top + rect.height * 0.20);
      const maxW = Math.max(220, Math.round(rect.width - 24));

      container.style.cssText = [
        "position: fixed;",
        `top: ${topY}px;`,
        `left: ${centerX}px;`,
        "transform: translate(-50%, -50%);",
        "z-index: 99999;",
        "pointer-events: none;",
        "display: flex;",
        "flex-direction: column;",
        "gap: 8px;",
        "align-items: center;",
        "justify-content: center;",
        "width: max-content;",
        `max-width: ${maxW}px;`
      ].join("");
    } else {
      container.style.cssText = [
        "position: fixed;",
        "top: 20%;",
        "left: 50%;",
        "transform: translate(-50%, -50%);",
        "z-index: 99999;",
        "pointer-events: none;",
        "display: flex;",
        "flex-direction: column;",
        "gap: 8px;",
        "align-items: center;",
        "justify-content: center;",
        "width: max-content;",
        "max-width: min(90vw, 480px);"
      ].join("");
    }
  };

  updateContainerPosition();

  // Keep position pinned to card center during scrolls / window resizing
  if (!container._hasPositionWatcher && targetCard) {
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

  const cleanMsg = stripToastEmojis(msg);
  // Deduplicate: if an identical toast message is already active in this container, ignore duplicate call
  const existingToasts = container.querySelectorAll(".proxdmr-toast-item");
  for (const t of existingToasts) {
    if (t.textContent === cleanMsg) {
      return;
    }
  }

  // 4. Create toast item with theme-aware styling
  const isLight = (typeof document !== "undefined") && (
    document.documentElement.getAttribute("data-theme") === "light" ||
    document.body.classList.contains("theme-light") ||
    document.body.getAttribute("data-theme") === "light"
  );
  const bgCol = isLight ? "#000000" : "#ffffff";
  const textCol = isLight ? "#ffffff" : "#000000";
  const borderCol = isLight ? "#16a34a" : "#22c55e";
  const shadowCol = isLight
    ? "0 10px 28px rgba(0, 0, 0, 0.45), 0 2px 12px rgba(22, 163, 74, 0.35)"
    : "0 10px 28px rgba(0, 0, 0, 0.25), 0 2px 12px rgba(34, 197, 94, 0.3)";

  const toast = document.createElement("div");
  toast.className = "proxdmr-toast-item";
  toast.style.cssText = [
    `background: ${bgCol};`,
    `border: 2px solid ${borderCol};`,
    `box-shadow: ${shadowCol};`,
    `color: ${textCol};`,
    "text-shadow: none;",
    "padding: 7px 16px;",
    "border-radius: 0px;",
    "font-size: 0.86rem;",
    "font-weight: 700;",
    "line-height: 1.3;",
    "text-align: center;",
    "backdrop-filter: blur(10px);",
    "-webkit-backdrop-filter: blur(10px);",
    "transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);",
    "opacity: 0;",
    "transform: scale(0.92);",
    "pointer-events: auto;",
    "max-width: 100%;",
    "word-break: break-word;",
    "box-sizing: border-box;"
  ].join("");

  toast.textContent = cleanMsg;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "scale(1)";
  });

  // Smooth fade-out disappearance (350ms)
  setTimeout(() => {
    toast.style.transition = `opacity ${TOAST_FADE_MS}ms ease-out, transform ${TOAST_FADE_MS}ms ease-out`;
    toast.style.opacity = "0";
    toast.style.transform = "scale(0.96)";
    setTimeout(() => {
      toast.remove();
      if (container && container.childNodes.length === 0) {
        if (container._reposHandler) {
          window.removeEventListener("scroll", container._reposHandler, true);
          window.removeEventListener("resize", container._reposHandler);
        }
        container.remove();
      }
    }, TOAST_FADE_MS + 20);
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
