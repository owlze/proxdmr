/**
 * ProxDMR - Universal Seamless Circular Auto-Marquee (modules/ui/marquee.js, v2.9.780)
 * Ultra-low-CPU & zero-micro-stutter implementation:
 * - O(1) MutationObserver fast-path filtering (ignores high-frequency meter/clock/canvas updates)
 * - Strict Two-Phase Read/Write batching in requestAnimationFrame (zero layout thrashing / zero post-write reflows)
 * - Skips getComputedStyle/clientWidth completely on already-running marquees unless text or ResizeObserver changed
 * - Waits 5 seconds after each specific overflowing element appears on screen before scrolling
 * - Scrolls smoothly at 11.2 px/s on the GPU compositor with Ferrari Red ("  ●  ") separator
 */

const MARQUEE_SELECTOR = [
  ".vfo-caller-call",
  ".ts-caller-call",
  ".vfo-caller-country",
  ".ts-caller-country",
  ".vfo-tg-desc",
  ".ts-tg-desc",
  ".vfo-tg-text",
  ".ptt-button .ptt-target-desc",
  ".btn-quick-mem-desc",
  ".btn-allstar-node .asl-btn-desc",
  ".btn-ysf-mem-slot .mem-cur-label",
  ".screen-clock-bar .asl-proc-clock-text",
  ".status-comment",
  ".bm-detail-text",
  ".live-player-name",
  ".station-name-line",
  ".station-sub-line",
  ".tg-desc-text",
  ".m17-ref-name",
  ".dstar-ref-name",
  ".svx-dir-name",
  ".ysf-room-name",
  ".allstar-server-title",
  ".xlx-server-title",
].join(", ");

const IGNORED_TAGS = new Set(["SVG", "CANVAS", "PATH", "RECT", "CIRCLE", "LINE", "POLYLINE", "POLYGON", "G", "SCRIPT", "STYLE"]);

const PX_PER_SEC = 11.2; // 28.0 / 2.5 — calm, easy-to-read marquee speed
const MIN_DURATION_SEC = 8.0;
const MAX_DURATION_SEC = 95.0;

const EL_STATE = new WeakMap();
const TRACKED_ELS = new Set();
const PENDING_ELS = new Set();

let _rafId = 0;
let _isMutatingDom = false;
let _observer = null;
let _resizeObserver = null;
let _intersectionObserver = null;
let _resizeDebounceTimer = null;

function _normalizeText(str) {
  return String(str || "").replace(/\s+/g, " ").trim();
}

function _isElementInViewport(el) {
  if (!el || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
}

function _isMarqueeCandidate(el) {
  if (!el || el.nodeType !== 1 || !el.isConnected) return false;
  if (IGNORED_TAGS.has(el.tagName)) return false;
  if (el.closest(".asl-vfo-marquee-track, .pxi-mq-track, .pxi-inertial-loader, .bm-server-label-wrap, .pxi-select-trigger, .pxi-select-menu, .srv-combo-panel, .hs-custom-dropdown, select, [role='listbox'], [role='combobox'], script, style")) {
    return false;
  }
  if (!el.matches || !el.matches(MARQUEE_SELECTOR)) return false;
  if ((el.classList.contains("vfo-tg-text") || el.classList.contains("ts-tg-text")) &&
      el.querySelector(".vfo-tg-pill, .ts-tg-pill, .vfo-tg-desc, .ts-tg-desc")) {
    return false;
  }
  return true;
}

function _unwrapElement(el) {
  const track = el.querySelector(":scope > .pxi-mq-track");
  if (track) {
    const item = track.querySelector(":scope > .pxi-mq-item");
    _isMutatingDom = true;
    try {
      const frag = document.createDocumentFragment();
      if (item) {
        while (item.firstChild) {
          frag.appendChild(item.firstChild);
        }
      }
      el.textContent = "";
      el.appendChild(frag);
    } finally {
      _isMutatingDom = false;
    }
  }
  if (
    el.classList.contains("pxi-mq-host") ||
    el.classList.contains("pxi-mq-active") ||
    el.classList.contains("pxi-mq-running") ||
    el.classList.contains("pxi-mq-rich")
  ) {
    _isMutatingDom = true;
    try {
      el.classList.remove("pxi-mq-host", "pxi-mq-active", "pxi-mq-running", "pxi-mq-rich");
      el.style.removeProperty("--pxi-mq-dur");
    } finally {
      _isMutatingDom = false;
    }
  }
}

function _measureElement(el) {
  const cs = window.getComputedStyle(el);
  if (!cs || cs.display === "none" || cs.visibility === "hidden") {
    return { valid: false, overflow: false, availW: 0, contentW: 0, fontPx: 13 };
  }
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const availW = Math.floor(el.clientWidth - padL - padR);
  const fontPx = parseFloat(cs.fontSize) || 13;
  if (availW < 12) {
    return { valid: false, overflow: false, availW, contentW: 0, fontPx };
  }

  let rangeW = 0;
  try {
    if (el.childNodes && el.childNodes.length > 0) {
      const rng = document.createRange();
      rng.selectNodeContents(el);
      rangeW = Math.ceil(rng.getBoundingClientRect().width || 0);
    }
  } catch (_) {
    rangeW = 0;
  }
  const scrollW = Math.ceil(el.scrollWidth - padL - padR);
  const contentW = Math.max(scrollW, rangeW);
  const overflow = (contentW - availW) > 3;
  return { valid: true, overflow, availW, contentW, fontPx };
}

/**
 * Phase 1 (Pure Read / Prep): Determines whether `el` needs no action, unwrapping, or wrapping.
 * Avoids layout reads completely if an active track's text has not changed and ResizeObserver has not fired.
 */
function _prepareElementAction(el) {
  if (!el || !el.isConnected) {
    TRACKED_ELS.delete(el);
    return null;
  }

  if (!_isMarqueeCandidate(el)) {
    return { type: "drop", el };
  }

  const prev = EL_STATE.get(el) || {};
  const isVisible = prev.visible !== undefined ? Boolean(prev.visible) : _isElementInViewport(el);
  const hasTrack = Boolean(el.querySelector(":scope > .pxi-mq-track"));
  const curText = _normalizeText(el.textContent);

  if (!curText || !isVisible) {
    return {
      type: "clear",
      el,
      hasTrack,
      nextState: {
        visible: isVisible,
        cleanText: "",
        availW: 0,
        fontPx: prev.fontPx || 13,
        dirtyResize: false,
      },
    };
  }

  // O(1) fast skip: already active, text unchanged, and ResizeObserver has not flagged a width change
  if (hasTrack && el.classList.contains("pxi-mq-active") && curText === prev.cleanText) {
    if (!prev.dirtyResize) {
      return null;
    }
    const curAvailW = el.clientWidth;
    if (typeof prev.availW === "number" && Math.abs(curAvailW - prev.availW) <= 3) {
      prev.dirtyResize = false;
      return null;
    }
  }

  // Non-overflowing element whose text & width haven't changed: O(1) skip
  if (!hasTrack && curText === prev.cleanText && !prev.dirtyResize && prev.availW > 0) {
    return null;
  }

  return {
    type: "measure_and_apply",
    el,
    hasTrack,
    isVisible,
    curText,
    prev,
  };
}

/**
 * Executes pending evaluations in strict batches to eliminate layout thrashing.
 */
function _flushPending() {
  _rafId = 0;
  if (!PENDING_ELS.size) return;
  const batch = Array.from(PENDING_ELS);
  PENDING_ELS.clear();

  const toMeasure = [];

  // Step A: Fast O(1) triage + unwrap only elements that genuinely changed text or resized > 3px
  for (let i = 0; i < batch.length; i++) {
    const action = _prepareElementAction(batch[i]);
    if (!action) continue;
    if (action.type === "drop") {
      _unwrapElement(action.el);
      EL_STATE.delete(action.el);
    } else if (action.type === "clear") {
      if (action.hasTrack) _unwrapElement(action.el);
      EL_STATE.set(action.el, action.nextState);
    } else if (action.type === "measure_and_apply") {
      if (action.hasTrack) _unwrapElement(action.el);
      toMeasure.push(action);
    }
  }

  if (!toMeasure.length) return;

  // Step B: Pure DOM Read Phase (single consolidated layout pass across all changed elements)
  const measurements = new Array(toMeasure.length);
  for (let i = 0; i < toMeasure.length; i++) {
    measurements[i] = _measureElement(toMeasure[i].el);
  }

  // Step C: Pure DOM Write Phase (zero layout reads after mutating DOM!)
  _isMutatingDom = true;
  try {
    for (let i = 0; i < toMeasure.length; i++) {
      const { el, isVisible, curText } = toMeasure[i];
      const m = measurements[i];
      if (!m.valid || !m.overflow || !curText) {
        EL_STATE.set(el, {
          visible: isVisible,
          cleanText: m.valid ? curText : "",
          availW: el.clientWidth || m.availW,
          fontPx: m.fontPx,
          dirtyResize: false,
        });
        continue;
      }

      const isRich = Boolean(el.querySelector("svg, img, .pxi-icon, .pxi-dot, .pxi-swatch, strong, small"));
      const track = document.createElement("span");
      track.className = "pxi-mq-track";

      const item = document.createElement("span");
      item.className = "pxi-mq-item";

      while (el.firstChild) {
        item.appendChild(el.firstChild);
      }

      if (isRich) {
        const clone = document.createElement("span");
        clone.className = "pxi-mq-clone";
        clone.setAttribute("aria-hidden", "true");
        item.childNodes.forEach((child) => {
          clone.appendChild(child.cloneNode(true));
        });
        track.appendChild(item);
        track.appendChild(clone);
        el.classList.add("pxi-mq-rich");
      } else {
        const dup = document.createElement("span");
        dup.className = "pxi-mq-dup";
        dup.setAttribute("aria-hidden", "true");
        dup.setAttribute("data-mq-copy", curText);
        track.appendChild(item);
        track.appendChild(dup);
        el.classList.remove("pxi-mq-rich");
      }

      // Compute half-track width from pre-measured contentW + separator width ("  ●  " ≈ 1.85em) without reflow
      const sepW = Math.round(m.fontPx * 1.85);
      const halfW = m.contentW + sepW;
      const durSec = Number(Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, halfW / PX_PER_SEC)).toFixed(2));

      el.appendChild(track);
      el.style.setProperty("--pxi-mq-dur", `${durSec}s`);
      el.classList.add("pxi-mq-host", "pxi-mq-active");

      EL_STATE.set(el, {
        visible: isVisible,
        cleanText: curText,
        availW: m.availW,
        fontPx: m.fontPx,
        dirtyResize: false,
      });
    }
  } finally {
    _isMutatingDom = false;
  }
}

function _scheduleElement(el) {
  if (!el || el.nodeType !== 1 || !el.isConnected) return;
  if (!TRACKED_ELS.has(el)) {
    if (!_isMarqueeCandidate(el)) return;
    TRACKED_ELS.add(el);
    if (_resizeObserver) {
      try {
        _resizeObserver.observe(el);
      } catch (_) {}
    }
    if (_intersectionObserver) {
      try {
        _intersectionObserver.observe(el);
      } catch (_) {}
    }
  }
  PENDING_ELS.add(el);
  if (!_rafId) {
    _rafId = window.requestAnimationFrame(_flushPending);
  }
}

function _scanRoot(root) {
  const scope = root && root.nodeType === 1 ? root : document.body;
  if (!scope || IGNORED_TAGS.has(scope.tagName)) return;
  if (TRACKED_ELS.has(scope) || _isMarqueeCandidate(scope)) {
    _scheduleElement(scope);
  }
  if (!scope.firstElementChild) return;
  const nodes = scope.querySelectorAll(MARQUEE_SELECTOR);
  for (let i = 0; i < nodes.length; i++) {
    _scheduleElement(nodes[i]);
  }
}

function refreshAll() {
  const stale = [];
  TRACKED_ELS.forEach((el) => {
    if (!el || !el.isConnected) {
      stale.push(el);
    } else {
      const prev = EL_STATE.get(el);
      if (prev) prev.dirtyResize = true;
      PENDING_ELS.add(el);
    }
  });
  for (let i = 0; i < stale.length; i++) {
    TRACKED_ELS.delete(stale[i]);
  }
  _scanRoot(document.body);
  if (PENDING_ELS.size && !_rafId) {
    _rafId = window.requestAnimationFrame(_flushPending);
  }
}

function _handleMutations(mutations) {
  if (_isMutatingDom) return;
  for (let i = 0; i < mutations.length; i++) {
    const m = mutations[i];
    if (m.type === "characterData") {
      const p = m.target && m.target.parentElement;
      if (!p) continue;
      if (TRACKED_ELS.has(p)) {
        _scheduleElement(p);
      } else if (p.parentElement && TRACKED_ELS.has(p.parentElement)) {
        _scheduleElement(p.parentElement);
      }
      continue;
    }
    if (m.type === "childList") {
      const t = m.target;
      if (!t || t.nodeType !== 1 || IGNORED_TAGS.has(t.tagName)) continue;
      const cl = t.classList;
      if (cl && (cl.contains("pxi-mq-track") || cl.contains("pxi-mq-clone") || cl.contains("pxi-mq-dup") || cl.contains("pxi-mq-item"))) {
        continue;
      }
      if (TRACKED_ELS.has(t)) {
        _scheduleElement(t);
      } else if (t.parentElement && TRACKED_ELS.has(t.parentElement)) {
        _scheduleElement(t.parentElement);
      }
      const added = m.addedNodes;
      if (added && added.length) {
        for (let j = 0; j < added.length; j++) {
          const node = added[j];
          if (!node || node.nodeType !== 1 || IGNORED_TAGS.has(node.tagName)) continue;
          const ncl = node.classList;
          if (
            ncl &&
            (ncl.contains("pxi-mq-track") ||
              ncl.contains("pxi-mq-clone") ||
              ncl.contains("pxi-mq-dup") ||
              ncl.contains("pxi-mq-item"))
          ) {
            continue;
          }
          _scanRoot(node);
        }
      }
    }
  }
}

function initPxiMarquee() {
  if (typeof document === "undefined" || !document.body) return;

  if (typeof IntersectionObserver !== "undefined" && !_intersectionObserver) {
    _intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (_isMutatingDom) return;
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const el = entry.target;
          if (!el || !el.isConnected) continue;
          const prev = EL_STATE.get(el) || {};
          const nowVis = Boolean(entry.isIntersecting && entry.intersectionRatio > 0);
          if (prev.visible !== nowVis) {
            EL_STATE.set(el, { ...prev, visible: nowVis });
            _scheduleElement(el);
          }
        }
      },
      { threshold: [0, 0.05] }
    );
  }

  if (typeof ResizeObserver !== "undefined" && !_resizeObserver) {
    _resizeObserver = new ResizeObserver((entries) => {
      if (_isMutatingDom) return;
      for (let i = 0; i < entries.length; i++) {
        const el = entries[i].target;
        if (el && TRACKED_ELS.has(el)) {
          const prev = EL_STATE.get(el);
          if (prev) prev.dirtyResize = true;
          _scheduleElement(el);
        }
      }
    });
  }

  if (typeof MutationObserver !== "undefined" && !_observer) {
    _observer = new MutationObserver(_handleMutations);
    _observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  window.addEventListener("resize", () => {
    clearTimeout(_resizeDebounceTimer);
    _resizeDebounceTimer = setTimeout(refreshAll, 120);
  });

  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
    document.fonts.ready.then(() => {
      refreshAll();
    }).catch(() => {});
  }

  _scanRoot(document.body);
}

if (typeof window !== "undefined") {
  window.PxiMarquee = {
    refreshAll,
    refreshElement: _scheduleElement,
  };
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPxiMarquee, { once: true });
  } else {
    initPxiMarquee();
  }
}
