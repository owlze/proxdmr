  import { triggerHaptic } from '../core/haptic.js';

  // --- Long Press & Visual Feedback Subsystem ---
  export function showLongPressEffect(x, y) {
    if (typeof x !== "number" || typeof y !== "number") return;
    const ring = document.createElement("div");
    ring.className = "long-press-ring";
    ring.style.left = `${Math.round(x)}px`;
    ring.style.top = `${Math.round(y)}px`;
    document.body.appendChild(ring);

    triggerHaptic(40);

    const removeRing = () => {
      if (ring.parentNode) {
        ring.parentNode.removeChild(ring);
      }
    };

    ring.addEventListener("animationend", removeRing, { once: true });
    setTimeout(removeRing, 900);
  }

  export function attachLongPress(target, onLongPress, options = {}) {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return null;

    const delay = typeof options.delay === "number" ? options.delay : 250;
    const showEffect = options.showEffect !== false;
    let timer = null;
    let isLongPressActive = false;
    let startX = 0;
    let startY = 0;
    let lastCoords = { x: 0, y: 0 };

    function getCoords(e) {
      if (e && typeof e.clientX === "number" && typeof e.clientY === "number" && (e.clientX !== 0 || e.clientY !== 0)) {
        return { x: e.clientX, y: e.clientY };
      }
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      isLongPressActive = false;
      const coords = getCoords(e);
      startX = coords.x;
      startY = coords.y;
      lastCoords = coords;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        isLongPressActive = true;
        timer = null;

        if (showEffect) {
          showLongPressEffect(lastCoords.x, lastCoords.y);
        }

        setTimeout(() => {
          const customEvt = new CustomEvent("longpress", {
            bubbles: true,
            cancelable: true,
            detail: { x: lastCoords.x, y: lastCoords.y, originalEvent: e }
          });
          el.dispatchEvent(customEvt);

          if (typeof onLongPress === "function") {
            try {
              onLongPress(e, el, lastCoords);
            } catch (err) {
              console.error("Error in long-press callback:", err);
            }
          }
        }, showEffect ? 800 : 0);
      }, delay);
    }

    function onPointerMove(e) {
      if (!timer) return;
      const coords = getCoords(e);
      lastCoords = coords;
      const dx = Math.abs(coords.x - startX);
      const dy = Math.abs(coords.y - startY);
      if (dx > 12 || dy > 12) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function onPointerUp(e) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (isLongPressActive) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => { isLongPressActive = false; }, 80);
      } else if (typeof options.onClick === "function") {
        options.onClick(e, el);
      }
    }

    function onPointerCancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      isLongPressActive = false;
    }

    function onContextMenu(e) {
      if (isLongPressActive || timer) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
    el.addEventListener("contextmenu", onContextMenu);

    return function unbind() {
      if (timer) clearTimeout(timer);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }

  // Delegated automatic handler for elements with data-long-press or .has-long-press
  document.addEventListener("pointerdown", (e) => {
    const targetEl = e.target && e.target.closest && e.target.closest("[data-long-press], .has-long-press");
    if (!targetEl || targetEl._longPressAttached) return;
    targetEl._longPressAttached = true;
    attachLongPress(targetEl, null);
  }, { passive: true });

    
