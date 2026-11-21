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
    "border-radius: 10px !important;",
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
 * Show a short toast notification in the visible viewport area below #proxdmrTopToolbar
 * and horizontally centered relative to the toolbar's midpoint (both desktop and mobile),
 * clamped within viewport bounds so collapsed cards never pull toasts off-screen.
 *
 * @param {string} msg Message text
 * @param {number} duration Duration in ms (default: TOAST_HOLD_MS)
 * @param {HTMLElement|string|null} targetCardOrId Legacy target hint / error marker
 */
export function showToast(msg, duration = TOAST_HOLD_MS, targetCardOrId = null) {
  let dur = (typeof duration === "number" && !isNaN(duration) && duration > 4500) ? duration : TOAST_HOLD_MS;
  if (typeof duration !== "number" && !targetCardOrId && typeof duration === "string") {
    if (duration === "error") {
      targetCardOrId = duration;
    }
    dur = TOAST_HOLD_MS;
  }

  if (typeof document === "undefined") return;
  const hostRoot = document.body || document.documentElement;
  if (!hostRoot) return;

  // 1. Unified toast container (keeps auth-pending / auth-locked CSS exemptions active)
  const containerId = "toastContainer";
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    container.className = "toast-container proxdmr-toast-container";
    hostRoot.appendChild(container);
  } else {
    container.className = "toast-container proxdmr-toast-container";
  }

  // 2. Position below #proxdmrTopToolbar centered on its horizontal midpoint, clamped to visible viewport
  const updateContainerPosition = () => {
    const win = typeof window !== "undefined" ? window : null;
    const vw = (win && win.innerWidth) || document.documentElement?.clientWidth || 360;
    const vh = (win && win.innerHeight) || document.documentElement?.clientHeight || 640;

    const toolbarEl = document.getElementById("proxdmrTopToolbar");
    let tbRect = null;
    if (toolbarEl && toolbarEl.isConnected) {
      const tbStyle = win && typeof win.getComputedStyle === "function" ? win.getComputedStyle(toolbarEl) : null;
      const tbVisible = !tbStyle || (tbStyle.display !== "none" && tbStyle.visibility !== "hidden" && tbStyle.visibility !== "collapse");
      if (tbVisible) {
        const r = toolbarEl.getBoundingClientRect();
        if (r && r.width > 40 && r.height > 0) {
          tbRect = r;
        }
      }
    }

    const maxW = tbRect
      ? Math.max(200, Math.min(vw - 16, Math.round(tbRect.width - 12), 520))
      : Math.max(200, Math.min(vw - 16, 460));

    const rawCenterX = (tbRect && tbRect.right > 0 && tbRect.left < vw)
      ? (tbRect.left + tbRect.width / 2)
      : (vw / 2);
    const rawTopY = tbRect
      ? Math.round(tbRect.bottom + 8)
      : 16;

    container.style.cssText = [
      "position: fixed;",
      `top: ${rawTopY}px;`,
      `left: ${Math.round(rawCenterX)}px;`,
      "transform: translateX(-50%);",
      "z-index: 99999;",
      "pointer-events: none;",
      "display: flex;",
      "flex-direction: column;",
      "gap: 8px;",
      "align-items: center;",
      "justify-content: flex-start;",
      "width: max-content;",
      `max-width: ${maxW}px;`
    ].join("");

    const measuredW = Math.min(maxW, container.offsetWidth || 0);
    const halfW = measuredW / 2;
    const minCenterX = Math.min(vw / 2, 8 + halfW);
    const maxCenterX = Math.max(vw / 2, vw - 8 - halfW);
    const clampedCenterX = Math.round(Math.max(minCenterX, Math.min(rawCenterX, maxCenterX)));

    const measuredH = container.offsetHeight || 44;
    const maxTopY = Math.max(10, vh - measuredH - 10);
    const clampedTopY = Math.round(Math.max(10, Math.min(rawTopY, maxTopY)));

    container.style.left = `${clampedCenterX}px`;
    container.style.top = `${clampedTopY}px`;
  };

  updateContainerPosition();

  // Keep position pinned inside visible screen below toolbar during scrolls / resizes
  if (!container._hasPositionWatcher && typeof window !== "undefined") {
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
      updateContainerPosition();
      return;
    }
  }

  // 3. Create toast item with theme-aware styling and error red background support
  const isError = (typeof duration === "object" && duration?.type === "error") ||
                  (typeof targetCardOrId === "object" && targetCardOrId?.type === "error") ||
                  (typeof duration === "string" && duration === "error") ||
                  (typeof targetCardOrId === "string" && targetCardOrId === "error");
  const isLight = (
    document.documentElement?.getAttribute("data-theme") === "light" ||
    document.body?.classList?.contains("theme-light") ||
    document.body?.getAttribute("data-theme") === "light"
  );

  let bgCol = isLight ? "#000000" : "#ffffff";
  let textCol = isLight ? "#ffffff" : "#000000";
  let borderCol = isLight ? "#16a34a" : "#22c55e";
  let shadowCol = isLight
    ? "0 10px 28px rgba(0, 0, 0, 0.45), 0 2px 12px rgba(22, 163, 74, 0.35)"
    : "0 10px 28px rgba(0, 0, 0, 0.25), 0 2px 12px rgba(34, 197, 94, 0.3)";

  if (isError) {
    bgCol = "#b91c1c";
    textCol = "#ffffff";
    borderCol = "#ef4444";
    shadowCol = "0 10px 28px rgba(0, 0, 0, 0.55), 0 2px 14px rgba(239, 68, 68, 0.45)";
  }

  const toast = document.createElement("div");
  toast.className = "proxdmr-toast-item";
  toast.style.cssText = [
    `background: ${bgCol};`,
    `border: 2px solid ${borderCol};`,
    `box-shadow: ${shadowCol};`,
    `color: ${textCol};`,
    "text-shadow: none;",
    "padding: 7px 16px;",
    "border-radius: 10px !important;",
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
  updateContainerPosition();

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
