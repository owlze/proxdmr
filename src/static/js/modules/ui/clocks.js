/**
 * ProxDMR - Station Clocks & Time Display Subsystem
 * Handles LOC / UTC time calculation, DOM updates across clock elements,
 * history time mode toggling (LOC <-> UTC), and clock click interactions.
 */

import {
  getHistoryTimeMode,
  setHistoryTimeMode,
  updateClockBarActiveState
} from "../core/formatters.js";
import { showToast } from "../core/toast.js";

/**
 * Update LOC and UTC clocks across the DOM
 */
export function updateClocks() {
  const now = new Date();
  const locHours = String(now.getHours()).padStart(2, "0");
  const locMins = String(now.getMinutes()).padStart(2, "0");
  const utcHours = String(now.getUTCHours()).padStart(2, "0");
  const utcMins = String(now.getUTCMinutes()).padStart(2, "0");
  const locStr = `${locHours}:${locMins}`;
  const utcStr = `${utcHours}:${utcMins}`;

  document.querySelectorAll(".loc-time-display").forEach(el => el.textContent = locStr);
  document.querySelectorAll(".utc-time-display").forEach(el => el.textContent = utcStr);

  const locTimeDisplay = document.getElementById("locTimeDisplay");
  const utcTimeDisplay = document.getElementById("utcTimeDisplay");
  const timeDisplay = document.getElementById("timeDisplay");

  if (locTimeDisplay) locTimeDisplay.textContent = locStr;
  if (utcTimeDisplay) utcTimeDisplay.textContent = utcStr;
  if (timeDisplay) timeDisplay.textContent = locStr;

  updateClockBarActiveState();
}

/**
 * Switch history display time mode between LOC and UTC
 * @param {string|null} [targetMode=null] "LOC" | "UTC"
 */
export function switchHistoryTimeMode(targetMode = null) {
  const getFn = (typeof window !== "undefined" && typeof window.getHistoryTimeMode === "function")
    ? window.getHistoryTimeMode
    : getHistoryTimeMode;
  const setFn = (typeof window !== "undefined" && typeof window.setHistoryTimeMode === "function")
    ? window.setHistoryTimeMode
    : setHistoryTimeMode;

  const curMode = getFn();
  const nextMode = targetMode ? targetMode.toUpperCase() : (curMode === "LOC" ? "UTC" : "LOC");

  if (setFn) {
    setFn(nextMode);
  } else {
    if (typeof window !== "undefined") window.__proxdmr_history_time_mode = nextMode;
    try { localStorage.setItem("proxdmr_history_time_mode", nextMode); } catch (_) {}
  }

  updateClockBarActiveState();

  const desc = nextMode === "LOC" ? (window.t ? window.t("clocks.loc_desc", {}, "Местное время (LOC)") : "Местное время (LOC)") : (window.t ? window.t("clocks.utc_desc", {}, "Время по Гринвичу (UTC)") : "Время по Гринвичу (UTC)");
  showToast(window.t ? window.t("clocks.toast_switched", { desc }, `🕒 История переключена на ${desc}`) : `🕒 История переключена на ${desc}`, 2000);

  // Re-render BrandMeister Last Heard monitor list
  if (typeof window !== "undefined" && typeof window.renderLogList === "function") {
    window.renderLogList();
  }

  // Re-render Transcription summary modal if open
  if (typeof window !== "undefined" && typeof window.renderTranscriptionSummary === "function") {
    window.renderTranscriptionSummary();
  }

  // Re-render player time badge if active
  if (typeof window !== "undefined" && window.recordingsManager && typeof window.recordingsManager.updateTimeBadge === "function") {
    window.recordingsManager.updateTimeBadge();
  }
}

let _clocksWired = false;

/**
 * Initialize clock click event delegation and periodic update loop
 */
export function initStationClocks() {
  if (_clocksWired) return;
  _clocksWired = true;

  document.addEventListener("click", (e) => {
    const locClock = e.target.closest(".screen-clock-loc");
    if (locClock) {
      e.preventDefault();
      e.stopPropagation();
      switchHistoryTimeMode("LOC");
      return;
    }

    const utcClock = e.target.closest(".screen-clock-utc");
    if (utcClock) {
      e.preventDefault();
      e.stopPropagation();
      switchHistoryTimeMode("UTC");
      return;
    }

    if (e.target.closest("#recSortBtn")) {
      return;
    }

    const colDur = e.target.closest("#logColHeadDur, .col-head.col-dur");
    if (colDur) {
      e.preventDefault();
      e.stopPropagation();
      switchHistoryTimeMode();
      return;
    }

    const summaryBadge = e.target.closest("#logTxSummaryTimeBadge");
    if (summaryBadge) {
      e.preventDefault();
      e.stopPropagation();
      switchHistoryTimeMode();
      return;
    }

    const txTime = e.target.closest(".tx-summary-time");
    if (txTime) {
      e.preventDefault();
      e.stopPropagation();
      switchHistoryTimeMode();
      return;
    }

    const durSub = e.target.closest(".dur-line-sub");
    if (durSub) {
      e.preventDefault();
      e.stopPropagation();
      switchHistoryTimeMode();
      return;
    }
  });

  updateClocks();

  // Update clocks every second, aligned to second boundary
  function scheduleClockTick() {
    const msUntilNextSecond = 1000 - (Date.now() % 1000);
    setTimeout(() => {
      updateClocks();
      setInterval(updateClocks, 1000);
    }, msUntilNextSecond);
  }
  scheduleClockTick();
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.updateClocks = updateClocks;
  window.switchHistoryTimeMode = switchHistoryTimeMode;
  window.initStationClocks = initStationClocks;

  window.__proxdmr = window.__proxdmr || {};
  Object.assign(window.__proxdmr, {
    updateClocks,
    switchHistoryTimeMode,
    initStationClocks
  });
}
