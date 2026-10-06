/**
 * ProxDMR - PTT Parameters (TOT Timer & Button Mode) Configuration & State
 * Module: modules/ptt/tot.js
 */

let activeTotModalOverlay = null;

/**
 * Retrieve configured TOT limit in seconds for a given hotspot
 * Valid range: 10 - 300 seconds. Default: 60 seconds.
 * @param {string|null} hid
 * @returns {number}
 */
export function getHotspotTot(hid = null) {
  let cid = "default";
  if (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") {
    cid = window.resolveHotspotId(hid || window.activeHotspotId || "default");
  } else if (hid) {
    cid = String(hid);
  }

  const stored = localStorage.getItem("proxdmr_tot_sec_" + cid) || localStorage.getItem("proxdmr_tot_sec");
  if (stored !== null) {
    const val = parseInt(stored, 10);
    if (!isNaN(val) && val >= 10 && val <= 300) {
      return val;
    }
  }
  return 60; // Default: 60 seconds
}

/**
 * Save TOT limit in seconds for a hotspot
 * @param {string|null} hid
 * @param {number|string} seconds
 * @returns {number}
 */
export function setHotspotTot(hid, seconds) {
  let cid = "default";
  if (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") {
    cid = window.resolveHotspotId(hid || window.activeHotspotId || "default");
  } else if (hid) {
    cid = String(hid);
  }

  let val = parseInt(seconds, 10);
  if (isNaN(val)) val = 60;
  val = Math.max(10, Math.min(300, val));

  localStorage.setItem("proxdmr_tot_sec_" + cid, String(val));
  localStorage.setItem("proxdmr_tot_sec", String(val));
  return val;
}

/**
 * Format TOT duration:
 * For <= 60 seconds: returns `${sec} ${secUnit}` (e.g. "60 сек" or "45 сек")
 * For > 60 seconds: returns "мин:сек" (e.g. "1:05", "1:30", "1:55", "5:00")
 * @param {number|string} sec
 * @param {string|null} secUnit
 * @returns {string}
 */
export function formatTotDuration(sec, secUnit = null) {
  const s = parseInt(sec, 10);
  const unit = secUnit || (window.t ? window.t("recordings.sec_unit", {}, "сек") : "сек");
  if (isNaN(s)) return `0 ${unit}`;
  if (s <= 60) {
    return `${s} ${unit}`;
  }
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

/**
 * Retrieve configured PTT button mode: "hold" (Удержание) or "toggle" (Переключение)
 * Default: "hold"
 * @param {string|null} hid
 * @returns {"hold"|"toggle"}
 */
export function getHotspotPttMode(hid = null) {
  let cid = "default";
  if (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") {
    cid = window.resolveHotspotId(hid || window.activeHotspotId || "default");
  } else if (hid) {
    cid = String(hid);
  }

  const stored = localStorage.getItem("proxdmr_ptt_mode_" + cid) || localStorage.getItem("proxdmr_ptt_mode");
  if (stored === "toggle") {
    return "toggle";
  }
  return "hold";
}

/**
 * Save PTT button mode: "hold" or "toggle"
 * @param {string|null} hid
 * @param {string} mode
 * @returns {"hold"|"toggle"}
 */
export function setHotspotPttMode(hid, mode) {
  let cid = "default";
  if (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") {
    cid = window.resolveHotspotId(hid || window.activeHotspotId || "default");
  } else if (hid) {
    cid = String(hid);
  }

  const safeMode = (mode === "toggle") ? "toggle" : "hold";
  localStorage.setItem("proxdmr_ptt_mode_" + cid, safeMode);
  localStorage.setItem("proxdmr_ptt_mode", safeMode);
  return safeMode;
}

export const DEFAULT_ROGER_BEEP_PATTERN = "600-110-33, 840-50-15";

/**
 * Retrieve configured Roger Beep enabled flag for a hotspot
 * @param {string|null} hid
 * @returns {boolean}
 */
export function getHotspotRogerBeep(hid = null) {
  let cid = "default";
  if (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") {
    cid = window.resolveHotspotId(hid || window.activeHotspotId || "default");
  } else if (hid) {
    cid = String(hid);
  }

  const stored = localStorage.getItem("proxdmr_roger_beep_" + cid);
  if (stored !== null) {
    return stored === "true" || stored === "1";
  }
  const globalStored = localStorage.getItem("proxdmr_roger_beep");
  if (globalStored !== null) {
    return globalStored === "true" || globalStored === "1";
  }
  return false;
}

/**
 * Save configured Roger Beep enabled flag for a hotspot
 * @param {string|null} hid
 * @param {boolean} enabled
 * @returns {boolean}
 */
export function setHotspotRogerBeep(hid, enabled) {
  let cid = "default";
  if (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") {
    cid = window.resolveHotspotId(hid || window.activeHotspotId || "default");
  } else if (hid) {
    cid = String(hid);
  }

  const boolVal = Boolean(enabled);
  localStorage.setItem("proxdmr_roger_beep_" + cid, String(boolVal));
  localStorage.setItem("proxdmr_roger_beep", String(boolVal));
  return boolVal;
}

/**
 * Retrieve configured Roger Beep pattern for a hotspot
 * @param {string|null} hid
 * @returns {string}
 */
export function getHotspotRogerBeepPattern(hid = null) {
  let cid = "default";
  if (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") {
    cid = window.resolveHotspotId(hid || window.activeHotspotId || "default");
  } else if (hid) {
    cid = String(hid);
  }

  const stored = localStorage.getItem("proxdmr_roger_beep_pat_" + cid) || localStorage.getItem("proxdmr_roger_beep_pat");
  if (stored && stored.trim().length > 0) {
    return stored.trim();
  }
  return DEFAULT_ROGER_BEEP_PATTERN;
}

/**
 * Save configured Roger Beep pattern for a hotspot
 * @param {string|null} hid
 * @param {string} pattern
 * @returns {string}
 */
export function setHotspotRogerBeepPattern(hid, pattern) {
  let cid = "default";
  if (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") {
    cid = window.resolveHotspotId(hid || window.activeHotspotId || "default");
  } else if (hid) {
    cid = String(hid);
  }

  const pat = (typeof pattern === "string" && pattern.trim()) ? pattern.trim() : DEFAULT_ROGER_BEEP_PATTERN;
  localStorage.setItem("proxdmr_roger_beep_pat_" + cid, pat);
  localStorage.setItem("proxdmr_roger_beep_pat", pat);
  return pat;
}

/**
 * Parse tone pattern string into array of { freq, durationMs, volPct }
 * Format: 600-110-33, 840-50-15 (freq-dur-vol separated by comma, semicolon or space)
 * @param {string} patternStr
 * @returns {Array<{freq: number, durationMs: number, volPct: number}>}
 */
export function parseTonePattern(patternStr) {
  if (!patternStr || typeof patternStr !== "string" || !patternStr.trim()) {
    return [
      { freq: 600, durationMs: 110, volPct: 33 },
      { freq: 840, durationMs: 50, volPct: 15 }
    ];
  }
  const raw = patternStr.trim().replace(/\s*-\s*/g, "-");
  const tokens = raw.split(/[,;\s]+/).filter(Boolean);
  const tones = [];
  let i = 0;
  while (i < tokens.length && tones.length < 7) {
    const t = tokens[i];
    if (t.includes("-")) {
      const parts = t.split("-").filter(Boolean);
      try {
        const freq = parseFloat(parts[0]);
        const dur = parts.length > 1 ? parseInt(parts[1], 10) : 80;
        const volPct = parts.length > 2 ? parseFloat(parts[2]) : 30.0;
        if (!isNaN(freq) && freq > 0) {
          tones.push({
            freq,
            durationMs: Math.max(5, Math.min(2000, isNaN(dur) ? 80 : dur)),
            volPct: Math.max(1, Math.min(100, isNaN(volPct) ? 30 : volPct))
          });
        }
      } catch (e) {}
      i++;
    } else if (i + 1 < tokens.length && !tokens[i + 1].includes("-")) {
      // Legacy pair: freq dur
      try {
        const freq = parseFloat(tokens[i]);
        const dur = parseInt(tokens[i + 1], 10);
        if (!isNaN(freq) && freq > 0) {
          tones.push({
            freq,
            durationMs: Math.max(5, Math.min(2000, isNaN(dur) ? 80 : dur)),
            volPct: 30.0
          });
          i += 2;
          continue;
        }
      } catch (e) {}
      i++;
    } else {
      i++;
    }
  }
  return tones.length > 0 ? tones : [
    { freq: 600, durationMs: 110, volPct: 33 },
    { freq: 840, durationMs: 50, volPct: 15 }
  ];
}

/**
 * Play Roger Beep locally using Web Audio API
 * @param {string} patternStr
 */
export function playLocalRogerBeep(patternStr) {
  try {
    const tones = parseTonePattern(patternStr);
    if (!tones || tones.length === 0) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass && !window.audioCtx) return;

    let ctx = window.audioCtx;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContextClass();
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    let startTime = ctx.currentTime + 0.01;
    tones.forEach((tone) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(tone.freq, startTime);

      const durSec = tone.durationMs / 1000.0;
      const targetVol = Math.max(0.01, Math.min(1.0, tone.volPct / 100.0)) * 0.4;
      const attackSec = Math.min(0.005, durSec * 0.1);
      const releaseSec = Math.min(0.005, durSec * 0.1);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(targetVol, startTime + attackSec);
      gain.gain.setValueAtTime(targetVol, startTime + durSec - releaseSec);
      gain.gain.linearRampToValueAtTime(0.0001, startTime + durSec);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + durSec);

      startTime += durSec;
    });
  } catch (err) {
    console.warn("[PTT] Failed to play local roger beep:", err);
  }
}

/**
 * Open the PTT Parameters mini panel / modal configuration dialog
 * @param {string|null} hid
 * @param {HTMLElement|null} anchorEl
 */
export function openTotConfigModal(hid = null, anchorEl = null) {
  closeTotConfigModal();

  let cid = "default";
  if (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") {
    cid = window.resolveHotspotId(hid || window.activeHotspotId || "default");
  } else if (hid) {
    cid = String(hid);
  }

  const currentTot = getHotspotTot(cid);
  const currentMode = getHotspotPttMode(cid);

  const overlay = document.createElement("div");
  overlay.className = "tot-config-overlay";

  const popup = document.createElement("div");
  popup.className = "tot-config-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-modal", "true");

  // Header: "Параметры PTT"
  const header = document.createElement("div");
  header.className = "tot-config-header";
  header.innerHTML = `
    <div class="tot-config-title">
      <span class="tot-config-icon">⚙️</span>
      <span>${window.t ? window.t("ptt.params_title", {}, "Параметры PTT") : "Параметры PTT"}</span>
    </div>
    <button type="button" class="tot-config-close" aria-label="${window.t ? window.t("buttons.close", {}, "Закрыть") : "Закрыть"}">&times;</button>
  `;

  // Body
  const body = document.createElement("div");
  body.className = "tot-config-body";

  // 1. PTT Mode Row: "Удержание" / "Переключение"
  const modeContainer = document.createElement("div");
  modeContainer.className = "ptt-mode-container";
  modeContainer.innerHTML = `
    <span class="ptt-mode-title">PTT:</span>
    <div class="ptt-mode-options">
      <label class="ptt-mode-opt">
        <input type="checkbox" id="chkPttHold" class="ptt-mode-chk" ${currentMode === "hold" ? "checked" : ""}>
        <span>${window.t ? window.t("ptt.mode_hold", {}, "Удержание") : "Удержание"}</span>
      </label>
      <label class="ptt-mode-opt">
        <input type="checkbox" id="chkPttToggle" class="ptt-mode-chk" ${currentMode === "toggle" ? "checked" : ""}>
        <span>${window.t ? window.t("ptt.mode_toggle", {}, "Переключение") : "Переключение"}</span>
      </label>
    </div>
  `;

  const divider = document.createElement("div");
  divider.className = "ptt-config-divider";

  // 2. TOT Description & Input
  const desc = document.createElement("div");
  desc.className = "tot-config-desc";
  desc.textContent = window.t
    ? window.t("ptt.tot_desc", {}, "Ограничение времени непрерывной передачи TX (от 10 до 300 сек, по умолчанию 60с):")
    : "Ограничение времени непрерывной передачи TX (от 10 до 300 сек, по умолчанию 60с):";

  const secUnit = window.t ? window.t("recordings.sec_unit", {}, "сек") : "сек";

  let initialTot = parseInt(currentTot, 10);
  if (isNaN(initialTot) || initialTot < 10) initialTot = 60;
  if (initialTot > 300) initialTot = 300;
  initialTot = Math.round(initialTot / 5) * 5;
  initialTot = Math.max(10, Math.min(300, initialTot));

  const sliderContainer = document.createElement("div");
  sliderContainer.className = "tot-slider-container";
  sliderContainer.innerHTML = `
    <div class="tot-slider-row">
      <div class="tot-slider-track-wrap">
        <input type="range" id="totRangeInput" class="tot-range-slider" min="10" max="300" step="5" value="${initialTot}">
        <div class="tot-slider-scale">
          <span>${formatTotDuration(10, secUnit)}</span>
          <span>${formatTotDuration(300, secUnit)}</span>
        </div>
      </div>
      <span id="totValueDisplay" class="tot-value-display">${formatTotDuration(initialTot, secUnit)}</span>
    </div>
  `;

  const presetsRow = document.createElement("div");
  presetsRow.className = "tot-presets-row";
  const presets = [30, 45, 60, 90];
  presets.forEach((sec) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tot-preset-btn" + (sec === initialTot ? " active" : "");
    btn.textContent = formatTotDuration(sec, secUnit);
    btn.dataset.sec = String(sec);
    presetsRow.appendChild(btn);
  });

  body.appendChild(modeContainer);
  body.appendChild(divider);
  body.appendChild(desc);
  body.appendChild(sliderContainer);
  body.appendChild(presetsRow);

  const divider2 = document.createElement("div");
  divider2.className = "ptt-config-divider";
  divider2.style.margin = "12px 0 10px 0";

  const currentRogerBeep = getHotspotRogerBeep(cid);
  const currentRogerPattern = getHotspotRogerBeepPattern(cid);

  const rogerContainer = document.createElement("div");
  rogerContainer.className = "ptt-roger-container";
  rogerContainer.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
      <label class="ptt-mode-opt" style="font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; margin: 0;">
        <input type="checkbox" id="chkRogerBeep" class="ptt-mode-chk" ${currentRogerBeep ? "checked" : ""}>
        <span>${window.t ? window.t("ptt.roger_beep", {}, "Роджер-бип (сигнал окончания передачи)") : "Роджер-бип (сигнал окончания передачи)"}</span>
      </label>
    </div>
    <div style="margin-top: 8px;">
      <input type="text" id="txtRogerBeepPattern" class="rec-text-input" value="${currentRogerPattern}" placeholder="600-110-33, 840-50-15" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: 6px; font-family: monospace; font-size: 0.85rem; transition: opacity 0.15s ease; ${currentRogerBeep ? '' : 'opacity: 0.55;'}">
      <div class="tot-config-desc" style="margin-top: 5px; font-size: 0.72rem; color: var(--text-muted, #8b949e); line-height: 1.3;">
        ${window.t ? window.t("ptt.roger_beep_hint", {}, "Формат тонов: частота-длительность-громкость через запятую (напр. 600-110-33, 840-50-15)") : "Формат тонов: частота-длительность-громкость через запятую (напр. 600-110-33, 840-50-15)"}
      </div>
    </div>
  `;

  body.appendChild(divider2);
  body.appendChild(rogerContainer);

  // Footer
  const footer = document.createElement("div");
  footer.className = "tot-config-footer";
  footer.innerHTML = `
    <button type="button" class="btn-tot-cancel">${window.t ? window.t("buttons.cancel", {}, "Отмена") : "Отмена"}</button>
    <button type="button" class="btn-tot-save">${window.t ? window.t("buttons.save", {}, "✓ Сохранить") : "✓ Сохранить"}</button>
  `;

  popup.appendChild(header);
  popup.appendChild(body);
  popup.appendChild(footer);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  activeTotModalOverlay = overlay;

  const rangeInput = popup.querySelector("#totRangeInput");
  const valueDisplay = popup.querySelector("#totValueDisplay");
  const chkHold = popup.querySelector("#chkPttHold");
  const chkToggle = popup.querySelector("#chkPttToggle");
  const chkRoger = popup.querySelector("#chkRogerBeep");
  const txtRogerPattern = popup.querySelector("#txtRogerBeepPattern");
  const saveBtn = popup.querySelector(".btn-tot-save");
  const cancelBtn = popup.querySelector(".btn-tot-cancel");
  const closeBtn = popup.querySelector(".tot-config-close");

  chkRoger.addEventListener("change", () => {
    txtRogerPattern.style.opacity = chkRoger.checked ? "1" : "0.55";
  });

  // Mutually exclusive checkboxes
  chkHold.addEventListener("change", () => {
    if (!chkHold.checked) {
      chkHold.checked = true; // Always keep one mode selected
      return;
    }
    chkToggle.checked = false;
  });

  chkToggle.addEventListener("change", () => {
    if (!chkToggle.checked) {
      chkToggle.checked = true; // Always keep one mode selected
      return;
    }
    chkHold.checked = false;
  });

  const syncState = (val) => {
    valueDisplay.textContent = formatTotDuration(val, secUnit);
    presetsRow.querySelectorAll(".tot-preset-btn").forEach((b) => {
      b.classList.toggle("active", parseInt(b.dataset.sec, 10) === val);
    });
  };

  rangeInput.addEventListener("input", () => {
    const val = parseInt(rangeInput.value, 10);
    syncState(val);
  });

  presetsRow.addEventListener("click", (e) => {
    const pBtn = e.target.closest(".tot-preset-btn");
    if (!pBtn) return;
    const sec = parseInt(pBtn.dataset.sec, 10);
    if (!isNaN(sec)) {
      rangeInput.value = String(sec);
      syncState(sec);
      rangeInput.focus();
    }
  });

  const doSave = () => {
    let val = parseInt(rangeInput.value, 10);
    if (isNaN(val)) val = 60;
    val = Math.max(10, Math.min(300, val));
    const savedTot = setHotspotTot(cid, val);

    const chosenMode = chkToggle.checked ? "toggle" : "hold";
    setHotspotPttMode(cid, chosenMode);

    const rogerChecked = chkRoger.checked;
    const rogerPatternVal = txtRogerPattern.value.trim() || DEFAULT_ROGER_BEEP_PATTERN;
    setHotspotRogerBeep(cid, rogerChecked);
    setHotspotRogerBeepPattern(cid, rogerPatternVal);

    closeTotConfigModal();
    if (typeof window.showToast === "function") {
      const modeStr = chosenMode === "toggle"
        ? (window.t ? window.t("ptt.mode_toggle", {}, "Переключение") : "Переключение")
        : (window.t ? window.t("ptt.mode_hold", {}, "Удержание") : "Удержание");
      const formattedTot = formatTotDuration(savedTot, secUnit);
      window.showToast(
        window.t
          ? window.t("ptt.params_saved_toast", { tot: formattedTot, mode: modeStr }, `✓ Параметры PTT сохранены (TOT: ${formattedTot}, ${modeStr})`)
          : `✓ Параметры PTT сохранены (TOT: ${formattedTot}, ${modeStr})`,
        2500
      );
    }
  };

  saveBtn.addEventListener("click", doSave);
  cancelBtn.addEventListener("click", closeTotConfigModal);
  closeBtn.addEventListener("click", closeTotConfigModal);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeTotConfigModal();
    }
  });

  const handleKeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeTotConfigModal();
    } else if (e.key === "Enter" && (e.target === rangeInput || e.target === popup || e.target.closest(".tot-config-popup"))) {
      e.preventDefault();
      doSave();
    }
  };
  window.addEventListener("keydown", handleKeydown);
  overlay._keydownHandler = handleKeydown;

  // Auto-focus slider
  setTimeout(() => {
    try {
      rangeInput.focus();
    } catch (err) {}
  }, 50);
}

/**
 * Close PTT parameters / TOT modal if currently open
 */
export function closeTotConfigModal() {
  if (activeTotModalOverlay) {
    if (activeTotModalOverlay._keydownHandler) {
      window.removeEventListener("keydown", activeTotModalOverlay._keydownHandler);
    }
    activeTotModalOverlay.classList.add("closing");
    const el = activeTotModalOverlay;
    activeTotModalOverlay = null;
    setTimeout(() => {
      try {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      } catch (err) {}
    }, 150);
  }
}

if (typeof window !== "undefined") {
  window.getHotspotTot = getHotspotTot;
  window.setHotspotTot = setHotspotTot;
  window.getHotspotPttMode = getHotspotPttMode;
  window.setHotspotPttMode = setHotspotPttMode;
  window.getHotspotRogerBeep = getHotspotRogerBeep;
  window.setHotspotRogerBeep = setHotspotRogerBeep;
  window.getHotspotRogerBeepPattern = getHotspotRogerBeepPattern;
  window.setHotspotRogerBeepPattern = setHotspotRogerBeepPattern;
  window.parseTonePattern = parseTonePattern;
  window.playLocalRogerBeep = playLocalRogerBeep;
  window.formatTotDuration = formatTotDuration;
  window.openTotConfigModal = openTotConfigModal;
  window.closeTotConfigModal = closeTotConfigModal;
}
