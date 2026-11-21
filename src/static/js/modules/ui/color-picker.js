/**
 * ProxDMR - Custom HSV Color Picker (modules/ui/color-picker.js)
 * Drop-in replacement for native <input type="color"> dialogs across desktop & Android WebView.
 */

const STYLE_ID = "proxdmrColorPickerStyles";
const BACKDROP_ID = "proxdmrColorPickerBackdrop";
const NAV_MODAL_ID = "proxdmrColorPicker";

export const PRESET_PALETTES = {
  accent: [
    "#111113", "#2563EB", "#6D5DF6", "#10984B", "#E5484D",
    "#E58E0B", "#6B7280", "#0D9488", "#DB2777", "#9A5B2F",
  ],
  bgDark: [
    "#0F1115", "#111113", "#0B1220", "#101827", "#141923",
    "#0D1B1E", "#181320", "#1B1714", "#1E222B", "#000000",
  ],
  bgLight: [
    "#F4F6F8", "#FFFFFF", "#F1F5F9", "#EEF2FF", "#ECFEFF",
    "#F0FDF4", "#FEFCE8", "#FFF7ED", "#FDF2F8", "#E5E7EB",
  ],
  toolbarDark: [
    "#0037B4", "#001B43", "#0F172A", "#1E3A8A", "#1D4ED8",
    "#0E7490", "#065F46", "#4C1D95", "#7F1D1D", "#111827",
  ],
  toolbarLight: [
    "#F4F7FB", "#DBE6F4", "#FFFFFF", "#E0E7FF", "#CFFAFE",
    "#DCFCE7", "#FEF3C7", "#FCE7F3", "#E2E8F0", "#CBD5E1",
  ],
  vfoDark: [
    "#22272E", "#1C2128", "#111827", "#1C5B2B", "#12421F",
    "#18682C", "#092110", "#065F46", "#1E3A8A", "#27272A",
  ],
  vfoLight: [
    "#F8FAFC", "#F1F5F9", "#E2E8F0", "#DCFCE7", "#BBF7D0",
    "#9DDCB3", "#78CA95", "#E0F2FE", "#FEF3C7", "#FFFFFF",
  ],
  vfoTx: [
    "#591515", "#360C0C", "#7F1D1D", "#450A0A", "#991B1B",
    "#B91C1C", "#7C2D12", "#FEE2E2", "#FECACA", "#FCA5A5",
  ],
};

export function normalizeHex(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return "#" + s.toLowerCase();
}

export function hexToRgb(hex) {
  const norm = normalizeHex(hex) || "#000000";
  const n = parseInt(norm.slice(1), 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

export function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v) => clamp(v).toString(16).padStart(2, "0");
  return "#" + toHex(r) + toHex(g) + toHex(b);
}

export function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) {
      h = ((gn - bn) / d) % 6;
    } else if (max === gn) {
      h = (bn - rn) / d + 2;
    } else {
      h = (rn - gn) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h, s, v };
}

export function hsvToRgb(h, s, v) {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const vv = Math.max(0, Math.min(100, v)) / 100;

  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;

  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 60) {
    rp = c; gp = x; bp = 0;
  } else if (hh < 120) {
    rp = x; gp = c; bp = 0;
  } else if (hh < 180) {
    rp = 0; gp = c; bp = x;
  } else if (hh < 240) {
    rp = 0; gp = x; bp = c;
  } else if (hh < 300) {
    rp = x; gp = 0; bp = c;
  } else {
    rp = c; gp = 0; bp = x;
  }

  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

export function getPresetsForInput(inputEl) {
  const id = (inputEl && inputEl.id) || "";
  if (id === "optBgColorPicker") {
    const lightTab = typeof document !== "undefined" ? document.getElementById("themeBgTabLight") : null;
    const isLight = Boolean(
      lightTab && (
        lightTab.classList.contains("active") ||
        lightTab.getAttribute("aria-selected") === "true"
      )
    );
    return isLight ? PRESET_PALETTES.bgLight : PRESET_PALETTES.bgDark;
  }
  if (id === "optToolbarBgTopPicker" || id === "optToolbarBgBottomPicker") {
    const tbLight = typeof document !== "undefined" ? document.getElementById("toolbarBgTabLight") : null;
    const isLight = Boolean(tbLight && tbLight.classList.contains("active"));
    return isLight ? PRESET_PALETTES.toolbarLight : PRESET_PALETTES.toolbarDark;
  }
  if (id === "optToolbarBgTopLightPicker" || id === "optToolbarBgBottomLightPicker") {
    return PRESET_PALETTES.toolbarLight;
  }
  if (id.startsWith("optTsTx")) {
    return PRESET_PALETTES.vfoTx;
  }
  if (id.startsWith("optTsStandby") || id.startsWith("optTsActive") || id.startsWith("optTsMuted")) {
    const tsLight = typeof document !== "undefined" ? document.getElementById("tsColorsTabLight") : null;
    const isLight = Boolean(tsLight && tsLight.classList.contains("active"));
    return isLight ? PRESET_PALETTES.vfoLight : PRESET_PALETTES.vfoDark;
  }
  return PRESET_PALETTES.accent;
}

const CSS_TEXT = `
#${BACKDROP_ID} {
  --pxcp-card-bg: #00494F;
  --pxcp-card-border: 1px solid rgba(255, 255, 255, 0.22);
  --pxcp-card-shadow: 0 18px 44px rgba(0, 0, 0, 0.58);
  --pxcp-hex-bg: #003439;
  --pxcp-text: #f0f6fc;
  --pxcp-muted: #9ad1d4;
  --pxcp-active-ring: #ffffff;
  position: fixed;
  inset: 0;
  z-index: 10120;
  display: none;
  background: transparent;
  pointer-events: auto;
}
#${BACKDROP_ID}.is-open {
  display: block;
}
[data-theme="light"] #${BACKDROP_ID} {
  --pxcp-card-bg: #ffffff;
  --pxcp-card-border: 1px solid rgba(15, 23, 42, 0.08);
  --pxcp-card-shadow: 0 14px 36px rgba(15, 23, 42, 0.18);
  --pxcp-hex-bg: #f3f4f6;
  --pxcp-text: #111827;
  --pxcp-muted: #6b7280;
  --pxcp-active-ring: #111827;
}
#${BACKDROP_ID} .pxcp-panel {
  position: fixed;
  width: 288px;
  padding: 14px;
  border-radius: 18px !important;
  overflow: visible;
  background: var(--pxcp-card-bg);
  border: var(--pxcp-card-border);
  box-shadow: var(--pxcp-card-shadow);
  color: var(--pxcp-text);
  box-sizing: border-box;
  font-family: inherit;
  user-select: none;
}
@media (max-width: 540px) {
  #${BACKDROP_ID}.is-open {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.38);
    padding: 12px;
  }
  #${BACKDROP_ID} .pxcp-panel {
    position: relative !important;
    left: auto !important;
    top: auto !important;
    width: min(300px, calc(100vw - 24px));
  }
}
#${BACKDROP_ID} .pxcp-sv-area {
  position: relative;
  width: 100%;
  height: 170px;
  border-radius: 14px !important;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  cursor: crosshair;
  box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.16);
}
#${BACKDROP_ID} .pxcp-sv-white,
#${BACKDROP_ID} .pxcp-sv-black {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
#${BACKDROP_ID} .pxcp-sv-white {
  background: linear-gradient(to right, #ffffff 0%, rgba(255, 255, 255, 0) 100%);
}
#${BACKDROP_ID} .pxcp-sv-black {
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, #000000 100%);
}
#${BACKDROP_ID} .pxcp-sv-thumb {
  position: absolute;
  width: 22px;
  height: 22px;
  border-radius: 50% !important;
  border: 3px solid #ffffff;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45);
  transform: translate(-50%, -50%);
  pointer-events: none;
  box-sizing: border-box;
}
#${BACKDROP_ID} .pxcp-hue-track {
  position: relative;
  margin-top: 14px;
  width: 100%;
  height: 14px;
  border-radius: 999px !important;
  background: linear-gradient(
    to right,
    #ff0000 0%,
    #ffff00 17%,
    #00ff00 33%,
    #00ffff 50%,
    #0000ff 67%,
    #ff00ff 83%,
    #ff0000 100%
  );
  touch-action: none;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.16);
}
#${BACKDROP_ID} .pxcp-hue-thumb {
  position: absolute;
  top: 50%;
  width: 22px;
  height: 22px;
  border-radius: 50% !important;
  border: 3px solid #ffffff;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.4);
  transform: translate(-50%, -50%);
  pointer-events: none;
  box-sizing: border-box;
}
#${BACKDROP_ID} .pxcp-hex-row {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 12px !important;
  background: var(--pxcp-hex-bg);
}
#${BACKDROP_ID} .pxcp-hex-swatch {
  width: 28px;
  height: 28px;
  border-radius: 8px !important;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.22);
}
#${BACKDROP_ID} .pxcp-hex-hash {
  color: var(--pxcp-muted);
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
  user-select: none;
}
#${BACKDROP_ID} .pxcp-hex-input {
  width: 100%;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--pxcp-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 0;
}
#${BACKDROP_ID} .pxcp-presets {
  margin-top: 14px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 4px;
  padding: 2px 0;
  align-items: center;
  justify-items: center;
}
#${BACKDROP_ID} .pxcp-preset-btn {
  width: 100%;
  max-width: 22px;
  aspect-ratio: 1 / 1;
  height: auto;
  min-width: 0;
  box-sizing: border-box;
  padding: 0;
  border: none;
  border-radius: 50% !important;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.22);
  transition: transform 0.1s ease, box-shadow 0.12s ease;
}
#${BACKDROP_ID} .pxcp-preset-btn:hover {
  transform: scale(1.08);
}
#${BACKDROP_ID} .pxcp-preset-btn.is-active {
  box-shadow: 0 0 0 2px var(--pxcp-card-bg), 0 0 0 3.5px var(--pxcp-active-ring);
}
#${BACKDROP_ID} .pxcp-dual-header {
  display: none;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}
#${BACKDROP_ID}.is-dual .pxcp-dual-header {
  display: flex;
}
#${BACKDROP_ID} .pxcp-dual-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--pxcp-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.2;
}
#${BACKDROP_ID} .pxcp-dual-sample {
  width: 100%;
  height: 28px;
  border-radius: 10px !important;
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
}
[data-theme="light"] #${BACKDROP_ID} .pxcp-dual-sample {
  border-color: rgba(15, 23, 42, 0.22);
}
#${BACKDROP_ID} .pxcp-dual-slots {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
#${BACKDROP_ID} .pxcp-dual-slot-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border-radius: 10px !important;
  border: 1px solid rgba(128, 128, 128, 0.28);
  background: var(--pxcp-hex-bg);
  color: var(--pxcp-text);
  cursor: pointer;
  min-width: 0;
  text-align: left;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
#${BACKDROP_ID} .pxcp-dual-slot-btn.is-active {
  border-color: #58a6ff;
  box-shadow: 0 0 0 1.5px rgba(88, 166, 255, 0.45);
}
#${BACKDROP_ID} .pxcp-dual-slot-swatch {
  width: 20px;
  height: 20px;
  border-radius: 6px !important;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.3);
}
#${BACKDROP_ID} .pxcp-dual-slot-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
#${BACKDROP_ID} .pxcp-dual-slot-name {
  font-size: 11px;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${BACKDROP_ID} .pxcp-dual-slot-hex {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  color: var(--pxcp-muted);
  line-height: 1.2;
}
`;

let _initialized = false;
let _backdropEl = null;
let _panelEl = null;
let _dualHeaderEl = null;
let _dualTitleEl = null;
let _dualSampleEl = null;
let _dualTopBtnEl = null;
let _dualBottomBtnEl = null;
let _dualTopSwatchEl = null;
let _dualBottomSwatchEl = null;
let _dualTopHexEl = null;
let _dualBottomHexEl = null;
let _svAreaEl = null;
let _svThumbEl = null;
let _hueTrackEl = null;
let _hueThumbEl = null;
let _hexSwatchEl = null;
let _hexInputEl = null;
let _presetsEl = null;

let _activeInput = null;
let _activeAnchor = null;
let _dualMode = false;
let _dualActiveSlot = "top";
let _dualInputs = { top: null, bottom: null };
let _hsv = { h: 0, s: 100, v: 100 };
let _initialHex = "#000000";
let _lastCommittedHex = "#000000";
let _lastInputEmitMs = 0;
let _throttleTimer = null;
let _navPushed = false;

function _injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS_TEXT;
  document.head.appendChild(style);
}

function _wrapBackHandler() {
  if (typeof window === "undefined") return;
  const orig = window.handleAppBack;
  if (typeof orig === "function" && !orig.__pxcpWrapped) {
    const wrapped = function (...args) {
      if (isColorPickerOpen()) {
        closeColorPicker(true);
        return true;
      }
      return orig.apply(this, args);
    };
    wrapped.__pxcpWrapped = true;
    window.handleAppBack = wrapped;
  }
}

export function isColorPickerOpen() {
  return Boolean(_backdropEl && _backdropEl.classList.contains("is-open") && _activeInput);
}

function _currentHex() {
  const { r, g, b } = hsvToRgb(_hsv.h, _hsv.s, _hsv.v);
  return rgbToHex(r, g, b);
}

function _getThrottleMs(inputEl) {
  const id = (inputEl && inputEl.id) || "";
  if (id.startsWith("editHsBrandColor")) return 120;
  return 50;
}

function _dispatchToInput(hex, emitChange) {
  if (!_activeInput) return;
  if (_activeInput.value.toLowerCase() !== hex.toLowerCase()) {
    _activeInput.value = hex;
  }
  _activeInput.dispatchEvent(new Event("input", { bubbles: true }));
  if (emitChange && hex.toLowerCase() !== _lastCommittedHex.toLowerCase()) {
    _lastCommittedHex = hex;
    _activeInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function _scheduleThrottledInput(hex) {
  if (!_activeInput) return;
  const interval = _getThrottleMs(_activeInput);
  const now = Date.now();
  const elapsed = now - _lastInputEmitMs;

  if (elapsed >= interval) {
    if (_throttleTimer) {
      clearTimeout(_throttleTimer);
      _throttleTimer = null;
    }
    _lastInputEmitMs = now;
    _dispatchToInput(hex, false);
  } else if (!_throttleTimer) {
    _throttleTimer = setTimeout(() => {
      _throttleTimer = null;
      if (!_activeInput) return;
      _lastInputEmitMs = Date.now();
      _dispatchToInput(_currentHex(), false);
    }, interval - elapsed);
  }
}

function _flushFinalSync(forceChange = true) {
  if (_throttleTimer) {
    clearTimeout(_throttleTimer);
    _throttleTimer = null;
  }
  if (!_activeInput) return;
  const hex = _currentHex();
  _lastInputEmitMs = Date.now();
  _dispatchToInput(hex, forceChange);
}

function _updateDualSampleUI() {
  if (!_dualMode || !_dualSampleEl) return;
  const curHex = _currentHex();
  const topRaw = (_dualActiveSlot === "top") ? curHex : (_dualInputs.top && _dualInputs.top.value);
  const botRaw = (_dualActiveSlot === "bottom") ? curHex : (_dualInputs.bottom && _dualInputs.bottom.value);
  const topHex = normalizeHex(topRaw) || "#000000";
  const botHex = normalizeHex(botRaw) || "#000000";

  _dualSampleEl.style.background = `linear-gradient(180deg, ${topHex} 0%, ${botHex} 100%)`;
  if (_dualTopSwatchEl) _dualTopSwatchEl.style.backgroundColor = topHex;
  if (_dualBottomSwatchEl) _dualBottomSwatchEl.style.backgroundColor = botHex;
  if (_dualTopHexEl) _dualTopHexEl.textContent = topHex.toUpperCase();
  if (_dualBottomHexEl) _dualBottomHexEl.textContent = botHex.toUpperCase();
  if (_dualTopBtnEl) _dualTopBtnEl.classList.toggle("is-active", _dualActiveSlot === "top");
  if (_dualBottomBtnEl) _dualBottomBtnEl.classList.toggle("is-active", _dualActiveSlot === "bottom");
}

function _renderVisuals(updateHexInput = true) {
  if (!_panelEl) return;
  const hex = _currentHex();
  const pureHue = `hsl(${Math.round(_hsv.h)}, 100%, 50%)`;

  _svAreaEl.style.backgroundColor = pureHue;
  _svThumbEl.style.left = `${Math.max(0, Math.min(100, _hsv.s))}%`;
  _svThumbEl.style.top = `${Math.max(0, Math.min(100, 100 - _hsv.v))}%`;
  _svThumbEl.style.backgroundColor = hex;

  _hueThumbEl.style.left = `${Math.max(0, Math.min(100, (_hsv.h / 360) * 100))}%`;
  _hueThumbEl.style.backgroundColor = pureHue;

  _hexSwatchEl.style.backgroundColor = hex;
  if (updateHexInput && document.activeElement !== _hexInputEl) {
    _hexInputEl.value = hex.slice(1).toUpperCase();
  }

  _updateDualSampleUI();

  const buttons = _presetsEl.querySelectorAll(".pxcp-preset-btn");
  buttons.forEach((btn) => {
    const presetHex = (btn.dataset.hex || "").toLowerCase();
    btn.classList.toggle("is-active", presetHex === hex.toLowerCase());
  });
}

function _renderPresets(inputEl) {
  if (!_presetsEl) return;
  const palette = getPresetsForInput(inputEl);
  _presetsEl.innerHTML = "";
  const cur = _currentHex().toLowerCase();

  palette.forEach((color) => {
    const norm = normalizeHex(color) || "#000000";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pxcp-preset-btn" + (norm === cur ? " is-active" : "");
    btn.dataset.hex = norm;
    btn.style.backgroundColor = norm;
    btn.title = norm.toUpperCase();
    btn.setAttribute("aria-label", norm.toUpperCase());
    btn.addEventListener("click", () => {
      _setFromHex(norm, true);
      _flushFinalSync(true);
    });
    _presetsEl.appendChild(btn);
  });
}

function _setFromHex(hex, updateHexInput = true) {
  const norm = normalizeHex(hex);
  if (!norm) return;
  const { r, g, b } = hexToRgb(norm);
  const next = rgbToHsv(r, g, b);
  // Preserve current Hue when selecting grayscale/black/white
  _hsv = {
    h: next.s > 0.01 ? next.h : _hsv.h,
    s: next.s,
    v: next.v,
  };
  _renderVisuals(updateHexInput);
}

function _positionPanel() {
  if (!_panelEl || !isColorPickerOpen()) return;
  if (window.innerWidth <= 540) {
    _panelEl.style.left = "";
    _panelEl.style.top = "";
    return;
  }

  const margin = 12;
  const gap = 8;
  const anchor = _activeAnchor || _activeInput;
  const anchorRect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  const panelRect = _panelEl.getBoundingClientRect();
  const pw = panelRect.width || 288;
  const ph = panelRect.height || 340;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = Math.round((vw - pw) / 2);
  let top = Math.round((vh - ph) / 2);

  if (anchorRect && (anchorRect.width > 0 || anchorRect.height > 0)) {
    left = anchorRect.left;
    if (left + pw > vw - margin) {
      left = anchorRect.right - pw;
    }
    left = Math.max(margin, Math.min(vw - pw - margin, left));

    top = anchorRect.bottom + gap;
    if (top + ph > vh - margin) {
      const aboveTop = anchorRect.top - ph - gap;
      if (aboveTop >= margin) {
        top = aboveTop;
      } else {
        top = Math.max(margin, vh - ph - margin);
      }
    }
  }

  _panelEl.style.left = `${Math.round(left)}px`;
  _panelEl.style.top = `${Math.round(top)}px`;
}

function _bindPointerDrag(el, onMovePoint, onEnd) {
  let dragging = false;

  const update = (e) => {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const rx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ry = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onMovePoint(rx, ry);
  };

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    try {
      el.setPointerCapture(e.pointerId);
    } catch (_) {}
    update(e);
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    e.preventDefault();
    update(e);
  });

  const finish = (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}
    if (typeof onEnd === "function") onEnd();
  };

  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);
}

function _ensureDom() {
  if (_backdropEl || typeof document === "undefined") return;
  _injectStyles();

  const backdrop = document.createElement("div");
  backdrop.id = BACKDROP_ID;
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", "Color Picker");
  backdrop.setAttribute("data-no-pxi", "true");

  backdrop.innerHTML = `
    <div class="pxcp-panel">
      <div class="pxcp-dual-header">
        <div class="pxcp-dual-title"></div>
        <div class="pxcp-dual-sample" aria-hidden="true"></div>
        <div class="pxcp-dual-slots">
          <button type="button" class="pxcp-dual-slot-btn is-active" data-slot="top">
            <span class="pxcp-dual-slot-swatch" data-role="top-swatch"></span>
            <span class="pxcp-dual-slot-meta">
              <span class="pxcp-dual-slot-name" data-i18n="general.toolbar_bg_top">Верхний цвет</span>
              <span class="pxcp-dual-slot-hex" data-role="top-hex">#000000</span>
            </span>
          </button>
          <button type="button" class="pxcp-dual-slot-btn" data-slot="bottom">
            <span class="pxcp-dual-slot-swatch" data-role="bottom-swatch"></span>
            <span class="pxcp-dual-slot-meta">
              <span class="pxcp-dual-slot-name" data-i18n="general.toolbar_bg_bottom">Нижний цвет</span>
              <span class="pxcp-dual-slot-hex" data-role="bottom-hex">#000000</span>
            </span>
          </button>
        </div>
      </div>
      <div class="pxcp-sv-area">
        <div class="pxcp-sv-white"></div>
        <div class="pxcp-sv-black"></div>
        <div class="pxcp-sv-thumb"></div>
      </div>
      <div class="pxcp-hue-track">
        <div class="pxcp-hue-thumb"></div>
      </div>
      <div class="pxcp-hex-row">
        <span class="pxcp-hex-swatch"></span>
        <span class="pxcp-hex-hash">#</span>
        <input type="text" class="pxcp-hex-input" maxlength="7" spellcheck="false" autocomplete="off" aria-label="HEX color">
      </div>
      <div class="pxcp-presets"></div>
    </div>
  `;

  document.body.appendChild(backdrop);

  _backdropEl = backdrop;
  _panelEl = backdrop.querySelector(".pxcp-panel");
  _dualHeaderEl = backdrop.querySelector(".pxcp-dual-header");
  _dualTitleEl = backdrop.querySelector(".pxcp-dual-title");
  _dualSampleEl = backdrop.querySelector(".pxcp-dual-sample");
  _dualTopBtnEl = backdrop.querySelector('.pxcp-dual-slot-btn[data-slot="top"]');
  _dualBottomBtnEl = backdrop.querySelector('.pxcp-dual-slot-btn[data-slot="bottom"]');
  _dualTopSwatchEl = backdrop.querySelector('[data-role="top-swatch"]');
  _dualBottomSwatchEl = backdrop.querySelector('[data-role="bottom-swatch"]');
  _dualTopHexEl = backdrop.querySelector('[data-role="top-hex"]');
  _dualBottomHexEl = backdrop.querySelector('[data-role="bottom-hex"]');
  _svAreaEl = backdrop.querySelector(".pxcp-sv-area");
  _svThumbEl = backdrop.querySelector(".pxcp-sv-thumb");
  _hueTrackEl = backdrop.querySelector(".pxcp-hue-track");
  _hueThumbEl = backdrop.querySelector(".pxcp-hue-thumb");
  _hexSwatchEl = backdrop.querySelector(".pxcp-hex-swatch");
  _hexInputEl = backdrop.querySelector(".pxcp-hex-input");
  _presetsEl = backdrop.querySelector(".pxcp-presets");

  const switchDualSlot = (slot) => {
    if (!_dualMode) return;
    const targetSlot = (slot === "bottom") ? "bottom" : "top";
    if (targetSlot === _dualActiveSlot) return;
    _flushFinalSync(true);
    _dualActiveSlot = targetSlot;
    _activeInput = _dualInputs[_dualActiveSlot];
    if (_activeInput) {
      const slotHex = normalizeHex(_activeInput.value) || "#000000";
      _initialHex = slotHex;
      _lastCommittedHex = slotHex;
      _setFromHex(slotHex, true);
      _renderPresets(_activeInput);
      _updateDualSampleUI();
    }
  };
  if (_dualTopBtnEl) _dualTopBtnEl.addEventListener("click", () => switchDualSlot("top"));
  if (_dualBottomBtnEl) _dualBottomBtnEl.addEventListener("click", () => switchDualSlot("bottom"));

  _panelEl.addEventListener("click", (e) => e.stopPropagation());

  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) {
      e.preventDefault();
      closeColorPicker(false);
    }
  });

  _bindPointerDrag(
    _svAreaEl,
    (rx, ry) => {
      _hsv.s = rx * 100;
      _hsv.v = (1 - ry) * 100;
      _renderVisuals(true);
      _scheduleThrottledInput(_currentHex());
    },
    () => _flushFinalSync(true)
  );

  _bindPointerDrag(
    _hueTrackEl,
    (rx) => {
      _hsv.h = rx * 360;
      _renderVisuals(true);
      _scheduleThrottledInput(_currentHex());
    },
    () => _flushFinalSync(true)
  );

  _hexInputEl.addEventListener("input", () => {
    const cleaned = _hexInputEl.value.replace(/^#/, "");
    if (cleaned !== _hexInputEl.value) {
      _hexInputEl.value = cleaned;
    }
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      _setFromHex("#" + cleaned, false);
      _scheduleThrottledInput(_currentHex());
    }
  });

  const commitHexInput = () => {
    const norm = normalizeHex(_hexInputEl.value);
    if (norm) {
      _setFromHex(norm, true);
      _flushFinalSync(true);
    } else {
      _hexInputEl.value = _currentHex().slice(1).toUpperCase();
    }
  };

  _hexInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitHexInput();
      _hexInputEl.blur();
    }
  });
  _hexInputEl.addEventListener("blur", commitHexInput);
}

function _resolveAnchor(inputEl) {
  if (!inputEl) return null;
  if (inputEl.id === "optBgColorPicker") {
    return document.getElementById("bgColorPreview") || inputEl;
  }
  const swatch = inputEl.closest(".toolbar-bg-swatch");
  if (swatch) return swatch;
  return inputEl;
}

function _loadActiveDualSlotUI(titleText) {
  if (_dualTitleEl) {
    _dualTitleEl.textContent = titleText || "";
    _dualTitleEl.style.display = titleText ? "block" : "none";
  }
  const topTxt = (typeof window !== "undefined" && window.t) ? window.t("general.toolbar_bg_top", {}, "Верхний цвет") : "Верхний цвет";
  const botTxt = (typeof window !== "undefined" && window.t) ? window.t("general.toolbar_bg_bottom", {}, "Нижний цвет") : "Нижний цвет";
  if (_dualTopBtnEl) {
    const lbl = _dualTopBtnEl.querySelector(".pxcp-dual-slot-name");
    if (lbl) lbl.textContent = topTxt;
  }
  if (_dualBottomBtnEl) {
    const lbl = _dualBottomBtnEl.querySelector(".pxcp-dual-slot-name");
    if (lbl) lbl.textContent = botTxt;
  }
}

export function openDualColorPicker(topInputEl, bottomInputEl, anchorEl = null, initialSlot = "top", titleText = "") {
  if (!topInputEl || !bottomInputEl || topInputEl.disabled || bottomInputEl.disabled) return;
  _ensureDom();
  _wrapBackHandler();

  if (isColorPickerOpen()) {
    _flushFinalSync(true);
  }

  _dualMode = true;
  _dualInputs = { top: topInputEl, bottom: bottomInputEl };
  _dualActiveSlot = (initialSlot === "bottom") ? "bottom" : "top";
  const activeEl = _dualInputs[_dualActiveSlot];
  _activeInput = activeEl;
  _activeAnchor = anchorEl || _resolveAnchor(activeEl);

  const startHex = normalizeHex(activeEl.value) || "#000000";
  _initialHex = startHex;
  _lastCommittedHex = startHex;
  const { r, g, b } = hexToRgb(startHex);
  _hsv = rgbToHsv(r, g, b);

  _backdropEl.classList.add("is-dual");
  _loadActiveDualSlotUI(titleText);
  _renderPresets(activeEl);
  _renderVisuals(true);
  _backdropEl.classList.add("is-open");
  _positionPanel();

  if (!_navPushed && typeof window !== "undefined" && typeof window.pushNavState === "function") {
    try {
      window.pushNavState("modal", NAV_MODAL_ID);
      _navPushed = true;
    } catch (_) {}
  }
}

export function openColorPicker(inputEl, anchorEl = null) {
  if (!inputEl || inputEl.disabled || inputEl.dataset.nativeColor === "true") return;
  _ensureDom();
  _wrapBackHandler();

  if (isColorPickerOpen()) {
    _flushFinalSync(true);
  }

  _dualMode = false;
  _dualInputs = { top: null, bottom: null };
  _dualActiveSlot = "top";
  _backdropEl.classList.remove("is-dual");

  _activeInput = inputEl;
  _activeAnchor = anchorEl || _resolveAnchor(inputEl);

  const startHex = normalizeHex(inputEl.value) || "#000000";
  _initialHex = startHex;
  _lastCommittedHex = startHex;

  const { r, g, b } = hexToRgb(startHex);
  _hsv = rgbToHsv(r, g, b);

  _renderPresets(inputEl);
  _renderVisuals(true);
  _backdropEl.classList.add("is-open");
  _positionPanel();

  if (!_navPushed && typeof window !== "undefined" && typeof window.pushNavState === "function") {
    try {
      window.pushNavState("modal", NAV_MODAL_ID);
      _navPushed = true;
    } catch (_) {}
  }
}

export function closeColorPicker(fromNavBack = false) {
  if (!isColorPickerOpen()) return;
  _flushFinalSync(_currentHex().toLowerCase() !== _initialHex.toLowerCase());

  _backdropEl.classList.remove("is-open", "is-dual");
  _dualMode = false;
  _dualInputs = { top: null, bottom: null };
  _activeInput = null;
  _activeAnchor = null;

  if (_navPushed && !fromNavBack && typeof window !== "undefined" && typeof window.notifyNavClosed === "function") {
    try {
      window.notifyNavClosed();
    } catch (_) {}
  }
  _navPushed = false;
}

function _handleDocumentClickCapture(e) {
  const target = e.target;
  if (!target || typeof target.closest !== "function") return;
  if (_backdropEl && _backdropEl.contains(target)) return;

  // Click inside any dual-gradient container/preview opens the 2-color gradient dialog
  const dualHolder = target.closest("[data-dual-top][data-dual-bottom]");
  if (dualHolder) {
    const topEl = document.getElementById(dualHolder.dataset.dualTop);
    const botEl = document.getElementById(dualHolder.dataset.dualBottom);
    const clickedPreview = target.closest(".dual-gradient-preview, .toolbar-bg-preview-bar");
    const clickedColorItem = target.closest("label.toolbar-bg-picker-item[for]");
    if (topEl && botEl && (clickedPreview || clickedColorItem || target === topEl || target === botEl)) {
      e.preventDefault();
      e.stopPropagation();
      let initialSlot = "top";
      if (target === botEl || (clickedColorItem && clickedColorItem.htmlFor === botEl.id)) {
        initialSlot = "bottom";
      }
      const anchor = clickedPreview || (clickedColorItem && clickedColorItem.querySelector(".toolbar-bg-swatch")) || dualHolder;
      const dualTitle = dualHolder.dataset.dualTitleI18n && window.t
        ? window.t(dualHolder.dataset.dualTitleI18n, {}, dualHolder.dataset.dualTitle || "")
        : (dualHolder.dataset.dualTitle || "");
      openDualColorPicker(topEl, botEl, anchor, initialSlot, dualTitle);
      return;
    }
  }

  // Direct click on <input type="color">
  if (target.tagName === "INPUT" && target.type === "color") {
    if (target.disabled || target.dataset.nativeColor === "true") return;
    e.preventDefault();
    e.stopPropagation();
    if (target.id === "optBgColorPicker") {
      const radio = document.getElementById("optBgColor");
      if (radio && !radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    openColorPicker(target, _resolveAnchor(target));
    return;
  }

  // Click on #bgColorPreview area inside #bgCardColor
  const bgPreview = target.closest("#bgColorPreview");
  if (bgPreview) {
    const bgPicker = document.getElementById("optBgColorPicker");
    if (bgPicker && !bgPicker.disabled && bgPicker.dataset.nativeColor !== "true") {
      e.preventDefault();
      e.stopPropagation();
      const radio = document.getElementById("optBgColor");
      if (radio && !radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
      }
      openColorPicker(bgPicker, bgPreview);
      return;
    }
  }

  // Click on <label for="..."> linked to <input type="color">
  const label = target.closest("label[for]");
  if (label && label.htmlFor) {
    const linked = document.getElementById(label.htmlFor);
    if (
      linked &&
      linked.tagName === "INPUT" &&
      linked.type === "color" &&
      !linked.disabled &&
      linked.dataset.nativeColor !== "true"
    ) {
      e.preventDefault();
      e.stopPropagation();
      const anchor = label.querySelector(".toolbar-bg-swatch") || _resolveAnchor(linked);
      openColorPicker(linked, anchor);
    }
  }
}

export function initColorPicker() {
  if (_initialized || typeof document === "undefined") return;
  _initialized = true;
  _injectStyles();
  _wrapBackHandler();

  document.addEventListener("click", _handleDocumentClickCapture, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isColorPickerOpen()) {
      e.preventDefault();
      e.stopPropagation();
      closeColorPicker(false);
    }
  }, true);

  window.addEventListener("resize", _positionPanel, { passive: true });
  window.addEventListener("scroll", _positionPanel, { passive: true, capture: true });

  window.ProxDMRColorPicker = {
    open: openColorPicker,
    openDual: openDualColorPicker,
    close: () => closeColorPicker(false),
    isOpen: isColorPickerOpen,
  };
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { initColorPicker(); }, { once: true });
  } else {
    initColorPicker();
  }
}
