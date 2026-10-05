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
  const saveBtn = popup.querySelector(".btn-tot-save");
  const cancelBtn = popup.querySelector(".btn-tot-cancel");
  const closeBtn = popup.querySelector(".tot-config-close");

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
  window.formatTotDuration = formatTotDuration;
  window.openTotConfigModal = openTotConfigModal;
  window.closeTotConfigModal = closeTotConfigModal;
}
