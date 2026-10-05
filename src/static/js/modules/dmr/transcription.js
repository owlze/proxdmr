import { getCountryInfo, getFlagBadgeHtml, formatCallerDisplay, formatHistoryTime, getHistoryTimeMode } from '../core/formatters.js';
import { showToast } from '../core/toast.js';

/**
 * ProxDMR Transcription & 24h Summary Module
 * Handles call log transcription popovers, tooltips, and the 24h Book Summary
 */

// --- Call Log Transcription Popover / Tooltip State ---
let logTranscriptionPopover = null;
let currentLogTxCallId = null;
let currentLogTxTriggerEl = null;
let isLogTxPinned = false;
let logTxHideTimeout = null;

// --- 24-Hour Call Log Transcription Summary State ---
let txSummarySortOrder = (typeof localStorage !== "undefined" && localStorage.getItem("proxdmr_tx_summary_sort")) || "desc"; // Default: matches exact sequence displayed in log (newest at top)

export function updateTxSummarySortUI() {
  const sortBtn = document.getElementById("btnSortTxSummary");
  if (!sortBtn) return;
  const isAsc = (txSummarySortOrder === "asc");
  sortBtn.classList.toggle("active", isAsc);
  sortBtn.classList.toggle("is-asc", isAsc);
  sortBtn.classList.toggle("is-desc", !isAsc);
  const titleKey = isAsc ? "log.sort_newest_bottom" : "log.sort_newest_top";
  const titleDefault = isAsc ? "Сортировка: новые внизу" : "Сортировка: новые вверху";
  const title = (window.t ? window.t(titleKey, {}, titleDefault) : titleDefault);
  sortBtn.title = title;
  sortBtn.setAttribute("aria-label", title);
  const svg = sortBtn.querySelector("svg");
  if (svg) {
    svg.style.transform = isAsc ? "rotate(180deg)" : "rotate(0deg)";
    svg.style.transition = "transform 0.2s ease";
  }
}

/**
 * Format raw transcription text with callsign highlighting and tag styling
 */
export function formatCaptionHtml(rawText) {
  if (!rawText) return "";
  const escapeHtml = (str) => {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const nonCallWords = new Set(["TS1", "TS2", "TG9", "FM1", "FM2", "VFO1", "VFO2", "RX1", "RX2", "TX1", "TX2", "MP3", "H264"]);
  const hamCallRegex = /\b(?=[A-Z0-9]{3,10}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]+(?:\/[A-Z0-9]+)?\b/g;

  const callRegex = /<call>([\s\S]*?)<\/call>/gi;
  let parts = [];
  let lastIndex = 0;
  let match;
  while ((match = callRegex.exec(rawText)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: rawText.slice(lastIndex, match.index) });
    }
    parts.push({ type: "call", content: match[1].trim() });
    lastIndex = callRegex.lastIndex;
  }
  if (lastIndex < rawText.length) {
    parts.push({ type: "text", content: rawText.slice(lastIndex) });
  }

  let html = "";
  for (const part of parts) {
    if (part.type === "call") {
      const cleanCall = escapeHtml(part.content.toUpperCase().replace(/[^A-Z0-9/]/g, ""));
      if (cleanCall) {
        html += `<span class="vfo-call-tag">${cleanCall}</span>`;
      }
    } else {
      let escaped = escapeHtml(part.content);
      escaped = escaped.replace(hamCallRegex, (m) => {
        if (nonCallWords.has(m)) return m;
        return `<span class="vfo-call-tag">${m}</span>`;
      });
      html += escaped;
    }
  }
  return html;
}

/**
 * Russian noun pluralization helper
 */
export function getNounPlural(num, one, two, five) {
  let n = Math.abs(num);
  n %= 100;
  if (n >= 5 && n <= 20) return five;
  n %= 10;
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return two;
  return five;
}

/**
 * Calculates effective timeslot for the transcription summary
 */
export function getEffectiveSummarySlot() {
  const logFilter = (typeof window.logFilter !== "undefined") ? window.logFilter : "all";
  if (logFilter === "1") return 1;
  if (logFilter === "2") return 2;

  const isMobile = window.innerWidth <= 768;
  const currentLogHotspotId = window.currentLogHotspotId;
  const activeHotspotId = window.activeHotspotId;
  const currentHotspots = window.currentHotspots || [];

  const effectiveHid = (isMobile && (!currentLogHotspotId || currentLogHotspotId === "all"))
    ? (activeHotspotId || (currentHotspots[0] && currentHotspots[0].id) || "default")
    : currentLogHotspotId;

  const targetCard = (effectiveHid && effectiveHid !== "all")
    ? (document.querySelector(`.radio-container[data-hotspot-id="${effectiveHid}"]`) || document.querySelector(".radio-container"))
    : document.querySelector(".radio-container");

  const cardSlot = (targetCard && targetCard._activeSlot) ||
                   (typeof window.getHotspotSlot === "function" && window.getHotspotSlot(effectiveHid)) ||
                   window.activeSlot || 1;
  return cardSlot;
}

// --- Popover Positioning & Lifecycle ---

export function positionLogTxPopover(targetEl) {
  if (!targetEl || !logTranscriptionPopover) return;
  const rect = targetEl.getBoundingClientRect();
  const popoverWidth = Math.min(360, window.innerWidth - 24);
  logTranscriptionPopover.style.width = `${popoverWidth}px`;

  const popHeight = logTranscriptionPopover.offsetHeight || 140;

  let left = rect.left;
  if (left + popoverWidth > window.innerWidth - 12) {
    left = window.innerWidth - popoverWidth - 12;
  }
  if (left < 12) left = 12;

  let top = rect.bottom + 6;
  if (top + popHeight > window.innerHeight - 10) {
    const spaceAbove = rect.top - 6;
    if (spaceAbove >= popHeight || spaceAbove > (window.innerHeight - rect.bottom)) {
      top = Math.max(10, rect.top - popHeight - 6);
    }
  }

  logTranscriptionPopover.style.left = `${Math.round(left)}px`;
  logTranscriptionPopover.style.top = `${Math.round(top)}px`;
}

export function showLogTranscriptionPopover(targetEl, callId, pin = false) {
  if (!targetEl || !callId) return;
  const heardCalls = window.heardCalls || [];
  const call = heardCalls.find(x => String(x.id) === String(callId));
  if (!call || !call.transcription || !call.transcription.trim()) {
    hideLogTranscriptionPopover(true);
    return;
  }

  if (!logTranscriptionPopover) {
    logTranscriptionPopover = document.getElementById("logTranscriptionPopover");
    if (!logTranscriptionPopover) {
      logTranscriptionPopover = document.createElement("div");
      logTranscriptionPopover.id = "logTranscriptionPopover";
      logTranscriptionPopover.className = "log-tx-popover";
      document.body.appendChild(logTranscriptionPopover);
      bindLogTxPopoverEvents();
    }
  }

  if (logTxHideTimeout) {
    clearTimeout(logTxHideTimeout);
    logTxHideTimeout = null;
  }

  currentLogTxTriggerEl = targetEl;
  currentLogTxCallId = call.id;
  isLogTxPinned = pin;

  const langBadge = call.transcription_lang ? call.transcription_lang.toUpperCase() : "AI";
  const callerDisplay = formatCallerDisplay(call.src_callsign, call.src_name, call.talker_alias, call.src_id, call.caller_display);
  const cleanCaller = (callerDisplay || "").replace(/<[^>]+>/g, "").trim();
  const isPrivateCall = call.call_type !== "GROUP";
  const tgInfo = isPrivateCall ? `ID ${call.dst_id}` : `TG ${call.dst_id}`;
  const slotInfo = `TS${call.slot}`;

  logTranscriptionPopover.innerHTML = `
    <div class="log-tx-popover-header">
      <div class="log-tx-popover-meta">
        <span class="log-tx-popover-badge">${langBadge}</span>
        <span class="log-tx-popover-station" title="${cleanCaller}">${cleanCaller}</span>
        <span class="log-tx-popover-tg">${tgInfo} • ${slotInfo}</span>
      </div>
      <button type="button" class="log-tx-popover-close" title="${window.t ? window.t("common.close", {}, "Закрыть") : "Закрыть"}">✕</button>
    </div>
    <div class="log-tx-popover-body">${formatCaptionHtml(call.transcription)}</div>
  `;

  positionLogTxPopover(targetEl);
  logTranscriptionPopover.classList.add("is-visible");
}

export function hideLogTranscriptionPopover(force = false) {
  if (logTxHideTimeout) {
    clearTimeout(logTxHideTimeout);
    logTxHideTimeout = null;
  }
  if (!force && isLogTxPinned) return;

  if (logTranscriptionPopover) {
    logTranscriptionPopover.classList.remove("is-visible");
  }
  currentLogTxCallId = null;
  currentLogTxTriggerEl = null;
  isLogTxPinned = false;
}

export function scheduleHideLogTxPopover() {
  if (logTxHideTimeout) clearTimeout(logTxHideTimeout);
  if (isLogTxPinned) return;
  logTxHideTimeout = setTimeout(() => {
    hideLogTranscriptionPopover(true);
  }, 220);
}

export function updateLogTranscriptionPopoverIfActive(callEntry) {
  if (!callEntry || !logTranscriptionPopover) return;
  if (logTranscriptionPopover.classList.contains("is-visible") && String(currentLogTxCallId) === String(callEntry.id)) {
    const bodyEl = logTranscriptionPopover.querySelector(".log-tx-popover-body");
    if (bodyEl) {
      bodyEl.innerHTML = formatCaptionHtml(callEntry.transcription);
    }
    if (currentLogTxTriggerEl) {
      positionLogTxPopover(currentLogTxTriggerEl);
    }
  }
}

export function bindLogTxPopoverEvents() {
  if (!logTranscriptionPopover) return;

  logTranscriptionPopover.addEventListener("mouseenter", () => {
    if (logTxHideTimeout) {
      clearTimeout(logTxHideTimeout);
      logTxHideTimeout = null;
    }
  });

  logTranscriptionPopover.addEventListener("mouseleave", () => {
    if (!isLogTxPinned) scheduleHideLogTxPopover();
  });

  logTranscriptionPopover.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.closest(".log-tx-popover-close")) {
      hideLogTranscriptionPopover(true);
    }
  });
}

export function initLogTranscriptionTooltip() {
  const logList = document.getElementById("logList");
  if (!logList || logList._logTxTooltipWired) return;
  logList._logTxTooltipWired = true;

  if (!logTranscriptionPopover) {
    logTranscriptionPopover = document.getElementById("logTranscriptionPopover");
    if (!logTranscriptionPopover) {
      logTranscriptionPopover = document.createElement("div");
      logTranscriptionPopover.id = "logTranscriptionPopover";
      logTranscriptionPopover.className = "log-tx-popover";
      document.body.appendChild(logTranscriptionPopover);
      bindLogTxPopoverEvents();
    }
  }

  // Delegated mouse hover
  logList.addEventListener("mouseover", (e) => {
    const trigger = e.target.closest(".log-text-marker, .station-flag.has-transcription");
    if (!trigger) return;
    const callId = trigger.dataset.callId;
    if (!callId) return;
    if (isLogTxPinned && currentLogTxTriggerEl === trigger) return;
    if (logTxHideTimeout) {
      clearTimeout(logTxHideTimeout);
      logTxHideTimeout = null;
    }
    showLogTranscriptionPopover(trigger, callId, false);
  });

  // Delegated mouse out
  logList.addEventListener("mouseout", (e) => {
    const trigger = e.target.closest(".log-text-marker, .station-flag.has-transcription");
    if (!trigger) return;
    const related = e.relatedTarget;
    if (related && trigger.contains(related)) return;
    scheduleHideLogTxPopover();
  });

  // Delegated click / tap
  logList.addEventListener("click", (e) => {
    if (window.__proxdmr_log_swipe_active) return;
    const trigger = e.target.closest(".log-text-marker, .station-flag.has-transcription");
    if (trigger) {
      const callId = trigger.dataset.callId;
      if (!callId) return;
      e.stopPropagation();
      if (isLogTxPinned && currentLogTxTriggerEl === trigger) {
        hideLogTranscriptionPopover(true);
      } else {
        showLogTranscriptionPopover(trigger, callId, true);
      }
      return;
    }
    
    if (window.recordingsManager && (typeof window.recordingsManager.isPlayerOpen === "function" ? window.recordingsManager.isPlayerOpen() : (window.recordingsManager.panel && window.recordingsManager.panel.style.display !== "none"))) {
      const row = e.target.closest(".live-call-row");
      if (row && !e.target.closest(".btn-quick-tune-tg, .log-play-btn, .station-flag, .log-text-marker")) {
        const callId = row.dataset.id;
        if (callId && window.recordingsManager.hasRecording(callId)) {
          e.stopPropagation();
          window.recordingsManager.playByCallId(callId);
        }
      }
    }
  });

  // Close on click outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#logTranscriptionPopover, .log-text-marker, .station-flag.has-transcription")) {
      hideLogTranscriptionPopover(true);
    }
  });

  // Close on tap outside on mobile
  document.addEventListener("touchstart", (e) => {
    if (!e.target.closest("#logTranscriptionPopover, .log-text-marker, .station-flag.has-transcription")) {
      hideLogTranscriptionPopover(true);
    }
  }, { passive: true });

  // Track table scrolling to adjust position or hide if scrolled offscreen
  const scrollWrap = document.getElementById("logTableScrollWrap");
  if (scrollWrap) {
    scrollWrap.addEventListener("scroll", () => {
      if (logTranscriptionPopover && logTranscriptionPopover.classList.contains("is-visible") && currentLogTxTriggerEl) {
        const r = currentLogTxTriggerEl.getBoundingClientRect();
        if (r.top < 40 || r.bottom > window.innerHeight - 20) {
          hideLogTranscriptionPopover(true);
        } else {
          positionLogTxPopover(currentLogTxTriggerEl);
        }
      }
    }, { passive: true });
  }
}

// --- 24-Hour Transcription Summary TTS Reader ---

export class SummaryTtsReader {
  constructor() {
    this.isPlaying = false;
    this.currentIndex = -1;
    this.currentCallId = null;
    this.selectedCallId = null;
    this.lastReadCallId = null;
    this.activeHotspotId = null;
    this.activeSlot = null;
    this.currentAudioHandle = null;
    this.currentAudioEl = null;
    this.prefetchedAudio = new Map();
    this.playToken = 0;
    this.soloMuteSnapshot = null;

    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        if (this.isPlaying) this.stop(false);
      });
      window.addEventListener("pagehide", () => {
        if (this.isPlaying) this.stop(false);
      });
    }
  }

  getAllHotspotIds() {
    const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
    const hidSet = new Set();
    const resHid = (typeof window.resolveHotspotId === "function") ? window.resolveHotspotId : (id => id || "default");
    hidSet.add(resHid("default"));
    if (Array.isArray(hsList)) {
      hsList.forEach(hs => {
        if (hs && hs.id) hidSet.add(resHid(hs.id));
      });
    }
    if (typeof document !== "undefined") {
      document.querySelectorAll(".radio-container[data-hotspot-id]").forEach(el => {
        if (el.dataset.hotspotId) hidSet.add(resHid(el.dataset.hotspotId));
      });
    }
    return Array.from(hidSet);
  }

  applySoloMute(enable) {
    if (enable) {
      if (this.soloMuteSnapshot) return;
      this.soloMuteSnapshot = new Map();
      const allHids = this.getAllHotspotIds();
      allHids.forEach(hid => {
        [1, 2].forEach(slot => {
          const key = `${hid}_ts${slot}`;
          const wasMuted = (typeof window.getHotspotMute === "function") ? window.getHotspotMute(hid, slot) : false;
          this.soloMuteSnapshot.set(key, wasMuted);
          if (!wasMuted && typeof window.setHotspotMute === "function") {
            window.setHotspotMute(hid, slot, true);
          }
        });
      });
      if (typeof window.updateHotspotCardMuteUI === "function") {
        window.updateHotspotCardMuteUI(null);
      }
    } else {
      if (!this.soloMuteSnapshot) return;
      const snapshot = this.soloMuteSnapshot;
      this.soloMuteSnapshot = null;
      snapshot.forEach((wasMuted, key) => {
        const idx = key.lastIndexOf("_ts");
        if (idx !== -1) {
          const hid = key.substring(0, idx);
          const slot = parseInt(key.substring(idx + 3), 10) || 1;
          const curMute = (typeof window.getHotspotMute === "function") ? window.getHotspotMute(hid, slot) : false;
          if (curMute !== wasMuted && typeof window.setHotspotMute === "function") {
            window.setHotspotMute(hid, slot, wasMuted);
          }
        }
      });
      if (typeof window.updateHotspotCardMuteUI === "function") {
        window.updateHotspotCardMuteUI(null);
      }
    }
  }

  getChronologicalPlaylist() {
    const heardCalls = window.heardCalls || [];
    const currentLogHotspotId = window.currentLogHotspotId;
    const activeHotspotId = window.activeHotspotId;
    const currentHotspots = window.currentHotspots || [];
    const logFilter = (typeof window.logFilter !== "undefined") ? window.logFilter : "all";
    const logSearchQuery = (window.logSearchQuery || "").toLowerCase().trim();
    const isMobile = window.innerWidth <= 768;
    const effectiveHid = (isMobile && (!currentLogHotspotId || currentLogHotspotId === "all"))
      ? (activeHotspotId || (currentHotspots[0] && currentHotspots[0].id) || "default")
      : currentLogHotspotId;

    const nowSec = Date.now() / 1000;
    const cutoff48h = nowSec - (48 * 3600);

    const filtered = heardCalls.filter(c => {
      if (!c.transcription || !c.transcription.trim()) return false;
      const ts = c.timestamp || 0;
      if (ts < cutoff48h) return false;

      if (isMobile || effectiveHid !== "all") {
        const callHid = c.hotspot_id || "default";
        if (callHid !== effectiveHid) return false;
      }

      if (logFilter === "1" || logFilter === "2") {
        if (c.slot.toString() !== logFilter) return false;
      }

      if (logSearchQuery) {
        const isTxMatch = c.is_tx && (logSearchQuery === "tx" || "передача".includes(logSearchQuery));
        const call = (c.src_callsign || "").toLowerCase();
        const name = (c.src_name || "").toLowerCase();
        const idStr = (c.src_id || "").toString();
        const tgStr = (c.dst_id || "").toString();
        const ta = (c.talker_alias || "").toLowerCase();
        const trText = (c.transcription || "").toLowerCase();
        if (!(isTxMatch || call.includes(logSearchQuery) || name.includes(logSearchQuery) || idStr.includes(logSearchQuery) || tgStr.includes(logSearchQuery) || ta.includes(logSearchQuery) || trText.includes(logSearchQuery))) {
          return false;
        }
      }

      return true;
    });

    // User Request #2: ALWAYS read in CHRONOLOGICAL order (from oldest to newest)
    return [...filtered].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  toggle() {
    if (this.isPlaying) {
      this.stop(true);
    } else {
      this.start();
    }
  }

  start() {
    const playlist = this.getChronologicalPlaylist();
    if (playlist.length === 0) {
      const slotLabel = (window.logFilter === "1") ? "TS1" : ((window.logFilter === "2") ? "TS2" : "TS1+TS2");
      if (typeof showToast === "function") {
        showToast(window.t ? window.t("live.tts_no_text", { slot: slotLabel }, `Нет распознанного текста для чтения в ${slotLabel}`) : `Нет распознанного текста для чтения в ${slotLabel}`, 2500);
      }
      return;
    }

    this.isPlaying = true;
    this.playToken++;
    this.updateButtonUi();

    // User Request #3: start from selected item (clicked by mouse/finger) or last read item
    let startIndex = 0;
    const targetId = this.selectedCallId || this.lastReadCallId;
    if (targetId) {
      const foundIdx = playlist.findIndex(c => c.id === targetId);
      if (foundIdx !== -1) {
        startIndex = foundIdx;
      }
    }

    const firstCall = playlist[startIndex];
    const initialHid = (firstCall && firstCall.hotspot_id) || window.currentLogHotspotId || window.activeHotspotId || "default";
    const initialSlot = (firstCall && firstCall.slot) || (window.logFilter === "2" ? 2 : 1);
    this.activeHotspotId = (typeof window.resolveHotspotId === "function") ? window.resolveHotspotId(initialHid) : initialHid;
    this.activeSlot = parseInt(initialSlot, 10) || 1;

    // Apply Solo mode if enabled (mutes all audio channels across all hotspots)
    const s = window.transcriberSettings || {};
    const soloMode = (s.tts_mute_others !== false);
    if (soloMode) {
      this.applySoloMute(true);
    }

    this.applyDucking(true);
    this.playItemAtIndex(startIndex, playlist, this.playToken);
  }

  selectOrPlay(callId) {
    if (!callId) return;
    this.selectedCallId = callId;
    if (this.isPlaying) {
      const playlist = this.getChronologicalPlaylist();
      const idx = playlist.findIndex(c => c.id === callId);
      if (idx !== -1) {
        this.stopCurrentAudioOnly();
        this.playToken++;
        this.playItemAtIndex(idx, playlist, this.playToken);
        return;
      }
    }
    this.updateDomHighlight();
  }

  stop(keepSelection = true) {
    this.isPlaying = false;
    this.playToken++;
    this.stopCurrentAudioOnly();
    this.applyDucking(false);

    if (keepSelection && this.currentCallId) {
      this.selectedCallId = this.currentCallId;
    }
    this.currentCallId = null;
    this.activeHotspotId = null;
    this.activeSlot = null;

    // Restore channels if Solo mode was active
    this.applySoloMute(false);

    this.updateButtonUi();
    this.updateDomHighlight();
  }

  stopCurrentAudioOnly() {
    if (this.currentAudioHandle && typeof this.currentAudioHandle.stop === "function") {
      try { this.currentAudioHandle.stop(); } catch (_) {}
      this.currentAudioHandle = null;
    }
    if (this.currentAudioEl) {
      try {
        this.currentAudioEl.pause();
        this.currentAudioEl.currentTime = 0;
        this.currentAudioEl.src = "";
      } catch (_) {}
      this.currentAudioEl = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
  }

  applyDucking(enable) {
    const player = window.dmrAudioPlayer || window.audioPlayer;
    if (!player || !player.channels) return;
    const s = window.transcriberSettings || {};
    const soloMode = (s.tts_mute_others !== false);
    const rawDuck = (s.tts_ducking_level !== undefined && s.tts_ducking_level !== null)
      ? s.tts_ducking_level
      : 0.80;
    const duckLevel = enable
      ? Math.max(0.0, Math.min(1.0, Number(rawDuck)))
      : 1.0;
    const activeHid = this.activeHotspotId || "default";
    const activeSlot = parseInt(this.activeSlot, 10) || 1;

    try {
      player.channels.forEach((channel, hidKey) => {
        const isSameHid = (hidKey === activeHid || (activeHid === "default" && hidKey === "default"));
        [1, 2].forEach(slot => {
          const isTargetSlot = isSameHid && slot === activeSlot;
          if (!enable) {
            channel.setSlotDucking(slot, false, 1.0, 0.15);
          } else if (isTargetSlot) {
            channel.setSlotDucking(slot, duckLevel < 0.999, duckLevel, 0.15);
          } else if (soloMode) {
            channel.setSlotDucking(slot, true, 0.0, 0.15);
          } else {
            channel.setSlotDucking(slot, duckLevel < 0.999, duckLevel, 0.15);
          }
        });
      });
    } catch (e) {
      console.warn("[Summary TTS] Ducking error:", e);
    }
  }

  updateButtonUi() {
    const btn = document.getElementById("btnTtsTxSummary");
    if (!btn) return;
    if (this.isPlaying) {
      btn.textContent = window.t ? window.t("live.tts_stop_btn", {}, "⏹ Стоп") : "⏹ Стоп";
      btn.classList.add("is-reading");
      btn.title = window.t ? window.t("live.tts_stop_title", {}, "Остановить чтение стенограммы (ПКМ / длинное нажатие — настройки)") : "Остановить чтение стенограммы (ПКМ / длинное нажатие — настройки)";
    } else {
      btn.textContent = window.t ? window.t("live.tts_read_btn", {}, "▶ TTS Читать") : "▶ TTS Читать";
      btn.classList.remove("is-reading");
      btn.title = window.t ? window.t("live.summary_tts_title", {}, "Читать стенограмму (ПКМ / длинное нажатие — настройки)") : "Читать стенограмму (ПКМ / длинное нажатие — настройки)";
    }
  }

  updateDomHighlight() {
    const bodyEl = document.getElementById("logTxSummaryBody");
    if (!bodyEl) return;
    const items = bodyEl.querySelectorAll(".tx-summary-item");
    items.forEach(el => {
      const id = el.getAttribute("data-call-id");
      const isReading = this.isPlaying && id === this.currentCallId;
      const isSelected = !this.isPlaying && id === this.selectedCallId;

      el.classList.toggle("is-reading", Boolean(isReading));
      el.classList.toggle("is-selected", Boolean(isSelected));

      if (isReading) {
        try {
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (_) {}
      }
    });
  }

  prefetchNext(nextCall) {
    if (!nextCall || !nextCall.id || this.prefetchedAudio.has(nextCall.id)) return;
    const s = window.transcriberSettings || {};
    const eng = s.tts_engine || "gemini";
    if (eng === "browser") return;
    const rawText = (nextCall.transcription || "")
      .replace(/<call>[\s\S]*?<\/call>/gi, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!rawText) return;

    const callId = nextCall.id;
    fetch("/api/transcriber/tts-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: rawText,
        engine: eng,
        voice: (eng === "piper") ? ((s.tts_voice === "__download__" || !s.tts_voice) ? "" : s.tts_voice) : (s.tts_voice === "auto" ? "Puck" : (s.tts_voice || "Puck")),
        speed: 1.1,
        target_lang: (s.target_lang && s.target_lang !== "none") ? s.target_lang : "ru"
      })
    })
    .then(r => r.json())
    .then(res => {
      if (res && res.status === "ok" && res.audio_base64) {
        this.prefetchedAudio.set(callId, res.audio_base64);
      }
    })
    .catch(() => {});
  }

  async playItemAtIndex(index, playlist, token) {
    if (!this.isPlaying || token !== this.playToken) return;

    if (index >= playlist.length) {
      if (typeof showToast === "function") {
        showToast(window.t ? window.t("live.tts_finished", {}, "📖 Чтение стенограммы завершено") : "📖 Чтение стенограммы завершено", 2500);
      }
      this.stop(false);
      return;
    }

    const call = playlist[index];
    this.currentIndex = index;
    this.currentCallId = call.id;
    this.lastReadCallId = call.id;
    this.updateDomHighlight();

    const callHid = (typeof window.resolveHotspotId === "function")
      ? window.resolveHotspotId(call.hotspot_id || window.currentLogHotspotId || window.activeHotspotId || "default")
      : (call.hotspot_id || "default");
    const callSlot = parseInt(call.slot, 10) || (window.logFilter === "2" ? 2 : 1);
    if (this.activeHotspotId !== callHid || this.activeSlot !== callSlot) {
      this.activeHotspotId = callHid;
      this.activeSlot = callSlot;
      this.applyDucking(true);
    }

    // User Request #1: Option A (Only speech text, no callsigns or metadata)
    let rawText = (call.transcription || "")
      .replace(/<call>[\s\S]*?<\/call>/gi, "")
      .replace(/<[^>]+>/g, "")
      .trim();

    if (!rawText) {
      this.playItemAtIndex(index + 1, playlist, token);
      return;
    }

    if (index + 1 < playlist.length) {
      this.prefetchNext(playlist[index + 1]);
    }

    const s = window.transcriberSettings || {};
    const engine = s.tts_engine || "gemini";
    const speed = 1.1;
    const voice = s.tts_voice || "auto";
    const targetLang = (s.target_lang && s.target_lang !== "none") ? s.target_lang : "ru";

    const onDone = () => {
      if (!this.isPlaying || token !== this.playToken || this.currentCallId !== call.id) return;
      setTimeout(() => {
        this.playItemAtIndex(index + 1, playlist, token);
      }, 150);
    };

    if (engine === "browser") {
      this.playBrowserText(rawText, targetLang, speed, onDone);
      return;
    }

    let audioBase64 = this.prefetchedAudio.get(call.id);
    if (!audioBase64) {
      try {
        const resp = await fetch("/api/transcriber/tts-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: rawText,
            engine: engine,
            voice: (engine === "piper") ? ((voice === "__download__" || !voice) ? "" : voice) : (voice === "auto" ? "Puck" : voice),
            speed: speed,
            target_lang: targetLang
          })
        });
        const res = await resp.json();
        if (!this.isPlaying || token !== this.playToken || this.currentCallId !== call.id) return;
        if (res.status === "ok" && res.audio_base64) {
          audioBase64 = res.audio_base64;
        } else {
          console.warn("[Summary TTS] Synthesis error:", res);
          setTimeout(onDone, 300);
          return;
        }
      } catch (err) {
        console.warn("[Summary TTS] Fetch exception:", err);
        setTimeout(onDone, 300);
        return;
      }
    }

    this.playAudioBase64(audioBase64, engine, speed, onDone, callHid, callSlot);
  }

  playAudioBase64(audioBase64, engine, speed, onDone, targetHid = null, targetSlot = null) {
    try {
      const binaryString = atob(audioBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const player = window.dmrAudioPlayer || window.audioPlayer;
      const effectiveRate = (engine === "piper") ? 1.0 : speed;

      if (player && typeof player.playTtsAudio === "function") {
        let ended = false;
        const cb = () => {
          if (ended) return;
          ended = true;
          this.currentAudioHandle = null;
          onDone();
        };

        const hid = targetHid || this.activeHotspotId || "default";
        const slot = parseInt(targetSlot || this.activeSlot, 10) || 1;

        player.playTtsAudio(hid, slot, bytes.buffer, effectiveRate, cb, { bypassSlotMute: true })
          .then(handle => {
            if (!this.isPlaying) {
              if (handle && handle.stop) handle.stop();
              return;
            }
            this.currentAudioHandle = handle;
          })
          .catch(err => {
            console.warn("[Summary TTS] playTtsAudio failed, using HTML5 Audio:", err);
            this.playFallbackAudio(bytes, effectiveRate, onDone);
          });
        return;
      }

      this.playFallbackAudio(bytes, effectiveRate, onDone);
    } catch (e) {
      console.error("[Summary TTS] Audio decode error:", e);
      onDone();
    }
  }

  playFallbackAudio(bytes, speed, onDone) {
    try {
      const blob = new Blob([bytes.buffer], { type: "audio/wav" });
      const blobUrl = URL.createObjectURL(blob);
      const audio = new Audio(blobUrl);
      this.currentAudioEl = audio;
      audio.preservesPitch = true;
      audio.playbackRate = speed;

      const cleanup = () => {
        try { URL.revokeObjectURL(blobUrl); } catch (_) {}
        this.currentAudioEl = null;
      };

      let ended = false;
      const cb = () => {
        if (ended) return;
        ended = true;
        cleanup();
        onDone();
      };

      audio.onended = cb;
      audio.onerror = cb;
      const p = audio.play();
      if (p !== undefined) {
        p.catch(cb);
      }
    } catch (e) {
      console.error("[Summary TTS] Fallback play error:", e);
      onDone();
    }
  }

  playBrowserText(text, targetLang, speed, onDone) {
    if (!window.speechSynthesis) {
      onDone();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const clean = (typeof window.cleanTextForClientTts === "function")
        ? window.cleanTextForClientTts(text, targetLang)
        : text;
      const ut = new SpeechSynthesisUtterance(clean);
      ut.rate = Math.max(0.7, Math.min(2.0, speed));
      if (targetLang && targetLang !== "none") {
        ut.lang = targetLang.substring(0, 2);
      }
      let ended = false;
      const cb = () => {
        if (ended) return;
        ended = true;
        onDone();
      };
      ut.onend = cb;
      ut.onerror = cb;
      window.speechSynthesis.speak(ut);
    } catch (e) {
      console.error("[Summary TTS] Browser speech error:", e);
      onDone();
    }
  }
}

export const summaryTtsReader = new SummaryTtsReader();

// --- 24-Hour Transcription Summary (Book Mode 📖) ---

export function toggleTranscriptionSummary(show = null) {
  if (show === null) {
    window.isTranscriptionSummaryOpen = !window.isTranscriptionSummaryOpen;
  } else {
    window.isTranscriptionSummaryOpen = Boolean(show);
  }
  const isOpen = window.isTranscriptionSummaryOpen;

  if (isOpen) {
    if (typeof window.recordingsManager !== "undefined" && typeof window.recordingsManager.closePlayer === "function") {
      window.recordingsManager.closePlayer();
    }
  }

  const summaryBtn = document.getElementById("logTranscriptionSummaryBtn");
  const summaryImg = document.getElementById("logTxSummaryImg");
  const scrollWrap = document.getElementById("logTableScrollWrap");
  const summaryWrap = document.getElementById("logTranscriptionSummaryWrap");

  if (summaryBtn) {
    summaryBtn.classList.toggle("active", isOpen);
    summaryBtn.title = isOpen
      ? (window.t ? window.t("live.summary_close_title", {}, "Закрыть сводку распознанного текста") : "Закрыть сводку распознанного текста")
      : (window.t ? window.t("live.summary_open_title", {}, "Сводка распознанного текста за последние 24ч (клик: открыть/закрыть)") : "Сводка распознанного текста за последние 24ч (клик: открыть/закрыть)");
  }
  if (summaryImg) {
    summaryImg.src = isOpen ? "/static/img/TXT_On.png?v=2.9.81" : "/static/img/TXT_Off.png?v=2.9.81";
    summaryImg.alt = isOpen ? "TXT On" : "TXT Off";
  }

  if (scrollWrap && summaryWrap) {
    if (isOpen) {
      scrollWrap.style.display = "none";
      summaryWrap.style.display = "flex";
      renderTranscriptionSummary();
    } else {
      if (summaryTtsReader && summaryTtsReader.isPlaying) {
        summaryTtsReader.stop();
      }
      summaryWrap.style.display = "none";
      scrollWrap.style.display = "";
    }
  }
}

export function renderTranscriptionSummary() {
  const summaryWrap = document.getElementById("logTranscriptionSummaryWrap");
  const bodyEl = document.getElementById("logTxSummaryBody");
  if (!summaryWrap || !bodyEl || summaryWrap.style.display === "none") return;

  const currentLogHotspotId = window.currentLogHotspotId;
  const activeHotspotId = window.activeHotspotId;
  const currentHotspots = window.currentHotspots || [];
  const heardCalls = window.heardCalls || [];
  const logFilter = (typeof window.logFilter !== "undefined") ? window.logFilter : "all";
  const logSearchQuery = window.logSearchQuery || "";

  const isMobile = window.innerWidth <= 768;
  const effectiveHid = (isMobile && (!currentLogHotspotId || currentLogHotspotId === "all"))
    ? (activeHotspotId || (currentHotspots[0] && currentHotspots[0].id) || "default")
    : currentLogHotspotId;

  const timeMode = (typeof getHistoryTimeMode === "function") ? getHistoryTimeMode() : "LOC";
  const timeBadgeEl = document.getElementById("logTxSummaryTimeBadge");
  if (timeBadgeEl) {
    timeBadgeEl.textContent = timeMode;
    timeBadgeEl.className = `log-tx-summary-time-badge is-${timeMode.toLowerCase()}`;
    timeBadgeEl.title = window.t ? window.t("live.time_badge_summary", { mode: timeMode }, `Время в стенограмме: ${timeMode}. Нажмите для смены LOC ↔ UTC`) : `Время в стенограмме: ${timeMode}. Нажмите для смены LOC ↔ UTC`;
  }

  updateTxSummarySortUI();

  const nowSec = Date.now() / 1000;
  const cutoff48h = nowSec - (48 * 3600); // 48 hours retention for transcribed calls

  const filtered = heardCalls.filter(c => {
    if (!c.transcription || !c.transcription.trim()) return false;
    const ts = c.timestamp || 0;
    if (ts < cutoff48h) return false;

    if (isMobile || effectiveHid !== "all") {
      const callHid = c.hotspot_id || "default";
      if (callHid !== effectiveHid) return false;
    }

    if (logFilter === "1" || logFilter === "2") {
      if (c.slot.toString() !== logFilter) return false;
    }

    if (logSearchQuery) {
      const isTxMatch = c.is_tx && (logSearchQuery === "tx" || "передача".includes(logSearchQuery));
      const call = (c.src_callsign || "").toLowerCase();
      const name = (c.src_name || "").toLowerCase();
      const idStr = (c.src_id || "").toString();
      const tgStr = (c.dst_id || "").toString();
      const ta = (c.talker_alias || "").toLowerCase();
      const trText = (c.transcription || "").toLowerCase();
      if (!(isTxMatch || call.includes(logSearchQuery) || name.includes(logSearchQuery) || idStr.includes(logSearchQuery) || tgStr.includes(logSearchQuery) || ta.includes(logSearchQuery) || trText.includes(logSearchQuery))) {
        return false;
      }
    }

    return true;
  });

  const countEl = document.getElementById("logTxSummaryCountBadge");
  if (countEl) {
    const curLang = (typeof window !== "undefined" && window.i18n && window.i18n.currentLang) || "ru";
    let countStr = "";
    if (curLang === "ru") {
      const plural = getNounPlural(filtered.length, "запись", "записи", "записей");
      countStr = `${filtered.length} ${plural}`;
    } else if (curLang === "uk") {
      const plural = getNounPlural(filtered.length, "запис", "записи", "записів");
      countStr = `${filtered.length} ${plural}`;
    } else {
      countStr = (window.t ? window.t("log.records_count", { count: filtered.length }, `${filtered.length} records`) : `${filtered.length} records`);
    }
    countEl.title = countStr;
    countEl.textContent = countStr;
  }

  const slotLabel = (logFilter === "1") ? "TS1" : ((logFilter === "2") ? "TS2" : "TS1+TS2");

  if (filtered.length === 0) {
    bodyEl.innerHTML = `
      <div class="log-tx-summary-empty">
        <div style="font-size: 1.6rem; margin-bottom: 8px;">📝</div>
        <div>${window.t ? window.t("live.summary_no_text_24h", { slot: slotLabel }, `За последние 24 часа распознанного текста в ${slotLabel} нет.`) : `За последние 24 часа распознанного текста в ${slotLabel} нет.`}</div>
      </div>
    `;
    return;
  }

  let sorted;
  if (txSummarySortOrder === "asc") {
    sorted = [...filtered].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  } else {
    sorted = [...filtered].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  const html = sorted.map(c => {
    const isTx = Boolean(c.is_tx);
    const formatFn = (typeof window !== "undefined" && typeof window.formatHistoryTime === "function")
      ? window.formatHistoryTime
      : (typeof formatHistoryTime === "function" ? formatHistoryTime : null);
    const timeStr = formatFn
      ? formatFn(c.timestamp || nowSec)
      : (c.time_str || (new Date((c.timestamp || nowSec) * 1000)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    const baseCaller = formatCallerDisplay(c.src_callsign, c.src_name, c.talker_alias, c.src_id, c.caller_display);
    const cleanCaller = (baseCaller || "").replace(/<[^>]+>/g, "").trim();
    const isPrivateCall = c.call_type !== "GROUP";
    const tgInfo = isPrivateCall ? `ID ${c.dst_id}` : `TG ${c.dst_id}`;
    const slotInfo = `TS${c.slot}`;

    const country = getCountryInfo(c.src_id, c.src_callsign);
    const flagHtml = isTx ? "🎙️ " : (country && country.flag ? `${country.flag} ` : "");

    const hsObj = currentHotspots.find(h => h.id === (c.hotspot_id || "default"));
    const hsTag = (effectiveHid === "all" && hsObj) ? `<span class="log-hs-badge" style="margin-left:4px;">${hsObj.name}</span>` : "";

    const langBadge = c.transcription_lang ? `<span class="tx-summary-lang-badge">${c.transcription_lang.toUpperCase()}</span>` : "";
    const textHtml = formatCaptionHtml(c.transcription);

    return `
      <div class="tx-summary-item" data-call-id="${c.id}">
        <div class="tx-summary-item-header">
          <span class="tx-summary-time" title="Время: нажмите для переключения LOC ↔ UTC">${timeStr}</span>
          <span class="tx-summary-station">${flagHtml}${cleanCaller}</span>
          <span class="tx-summary-tg">${tgInfo} • ${slotInfo}</span>
          ${hsTag}
          ${langBadge}
        </div>
        <div class="tx-summary-text">${textHtml}</div>
      </div>
    `;
  }).join("");

  const prevScrollTop = bodyEl.scrollTop;
  bodyEl.innerHTML = html;
  if (prevScrollTop > 0) {
    bodyEl.scrollTop = prevScrollTop;
  }
  if (summaryTtsReader) {
    summaryTtsReader.updateDomHighlight();
    summaryTtsReader.updateButtonUi();
  }
}

export function copyTranscriptionSummary() {
  const isMobile = window.innerWidth <= 768;
  const currentLogHotspotId = window.currentLogHotspotId;
  const activeHotspotId = window.activeHotspotId;
  const currentHotspots = window.currentHotspots || [];
  const heardCalls = window.heardCalls || [];
  const logFilter = (typeof window.logFilter !== "undefined") ? window.logFilter : "all";
  const logSearchQuery = window.logSearchQuery || "";

  const effectiveHid = (isMobile && (!currentLogHotspotId || currentLogHotspotId === "all"))
    ? (activeHotspotId || (currentHotspots[0] && currentHotspots[0].id) || "default")
    : currentLogHotspotId;

  const nowSec = Date.now() / 1000;
  const cutoff24h = nowSec - 86400;

  const filtered = heardCalls.filter(c => {
    if (!c.transcription || !c.transcription.trim()) return false;
    const ts = c.timestamp || 0;
    if (ts < cutoff24h) return false;

    if (isMobile || effectiveHid !== "all") {
      const callHid = c.hotspot_id || "default";
      if (callHid !== effectiveHid) return false;
    }

    if (logFilter === "1" || logFilter === "2") {
      if (c.slot.toString() !== logFilter) return false;
    }

    if (logSearchQuery) {
      const isTxMatch = c.is_tx && (logSearchQuery === "tx" || "передача".includes(logSearchQuery));
      const call = (c.src_callsign || "").toLowerCase();
      const name = (c.src_name || "").toLowerCase();
      const idStr = (c.src_id || "").toString();
      const tgStr = (c.dst_id || "").toString();
      const ta = (c.talker_alias || "").toLowerCase();
      const trText = (c.transcription || "").toLowerCase();
      if (!(isTxMatch || call.includes(logSearchQuery) || name.includes(logSearchQuery) || idStr.includes(logSearchQuery) || tgStr.includes(logSearchQuery) || ta.includes(logSearchQuery) || trText.includes(logSearchQuery))) {
        return false;
      }
    }

    return true;
  });

  const slotLabel = (logFilter === "1") ? "TS1" : ((logFilter === "2") ? "TS2" : "TS1+TS2");

  if (filtered.length === 0) {
    if (typeof showToast === "function") showToast(window.t ? window.t("live.summary_no_text_copy", { slot: slotLabel }, `Нет распознанного текста для копирования в ${slotLabel}`) : `Нет распознанного текста для копирования в ${slotLabel}`, 2500);
    return;
  }

  let sorted;
  if (txSummarySortOrder === "asc") {
    sorted = [...filtered].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  } else {
    sorted = [...filtered].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  const lines = sorted.map(c => {
    const formatFn = (typeof window !== "undefined" && typeof window.formatHistoryTime === "function")
      ? window.formatHistoryTime
      : (typeof formatHistoryTime === "function" ? formatHistoryTime : null);
    const timeStr = formatFn
      ? formatFn(c.timestamp || nowSec)
      : (c.time_str || (new Date((c.timestamp || nowSec) * 1000)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    const baseCaller = formatCallerDisplay(c.src_callsign, c.src_name, c.talker_alias, c.src_id, c.caller_display);
    const cleanCaller = (baseCaller || "").replace(/<[^>]+>/g, "").trim();
    const isPrivateCall = c.call_type !== "GROUP";
    const tgInfo = isPrivateCall ? `ID ${c.dst_id}` : `TG ${c.dst_id}`;
    const rawText = (c.transcription || "").replace(/<call>([\s\S]*?)<\/call>/gi, "$1").trim();
    const plainCaller = cleanCaller.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    return `[${timeStr}] ${plainCaller} (${tgInfo}, TS${c.slot}): ${rawText}`;
  }).join("\n\n");

  const onCopied = () => {
    if (typeof showToast === "function") showToast(window.t ? window.t("live.summary_copied_toast", { slot: slotLabel }, `📋 Стенограмма ${slotLabel} (24ч) скопирована в буфер!`) : `📋 Стенограмма ${slotLabel} (24ч) скопирована в буфер!`, 3000);
    const copyBtn = document.getElementById("btnCopyTxSummary");
    if (copyBtn) {
      copyBtn.textContent = window.t ? window.t("live.summary_copied", {}, "✅ Скопировано!") : "✅ Скопировано!";
      setTimeout(() => { copyBtn.textContent = window.t ? window.t("live.summary_copy_btn", {}, "Копировать") : "Копировать"; }, 2000);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(lines).then(onCopied).catch(err => {
      console.warn("Clipboard API failed, using fallback:", err);
      fallbackCopy(lines, onCopied);
    });
  } else {
    fallbackCopy(lines, onCopied);
  }
}

function fallbackCopy(text, cb) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    if (cb) cb();
  } catch (e) {
    console.error("Fallback copy failed:", e);
  }
  document.body.removeChild(ta);
}

export function initLogTranscriptionSummary() {
  const summaryWrap = document.getElementById("logTranscriptionSummaryWrap");
  if (summaryWrap && summaryWrap._summaryWired) return;
  if (summaryWrap) summaryWrap._summaryWired = true;

  const summaryBtn = document.getElementById("logTranscriptionSummaryBtn");
  const closeBtn = document.getElementById("btnCloseTxSummary");
  const copyBtn = document.getElementById("btnCopyTxSummary");
  const sortBtn = document.getElementById("btnSortTxSummary");
  const ttsBtn = document.getElementById("btnTtsTxSummary");
  const bodyEl = document.getElementById("logTxSummaryBody");

  if (ttsBtn) {
    const LONG_PRESS_MS = 450;
    let pressTimer = null;
    let isLongPress = false;
    let startX = 0;
    let startY = 0;

    const getTargetSlot = () => {
      if (window.logFilter === "1") return 1;
      if (window.logFilter === "2") return 2;
      return null;
    };

    const openTtsSettings = () => {
      const openFn = (typeof window !== "undefined" && (window.openTtsQuickSettingsPopover || (window.__proxdmr && window.__proxdmr.openTtsQuickSettingsPopover))) || null;
      if (typeof openFn === "function") {
        openFn(ttsBtn, null, getTargetSlot());
      }
    };

    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      ttsBtn.classList.remove("vfo-tts-pressing");
    };

    const startPress = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      isLongPress = false;
      startX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      startY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
      ttsBtn.classList.add("vfo-tts-pressing");

      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        pressTimer = null;
        isLongPress = true;
        ttsBtn.classList.remove("vfo-tts-pressing");
        if (typeof window.triggerHaptic === "function") {
          window.triggerHaptic(35);
        }
        openTtsSettings();
      }, LONG_PRESS_MS);
    };

    const movePress = (e) => {
      if (!pressTimer) return;
      const curX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const curY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
      if (Math.hypot(curX - startX, curY - startY) > 10) {
        cancelPress();
      }
    };

    ttsBtn.addEventListener("pointerdown", startPress);
    ttsBtn.addEventListener("pointermove", movePress);
    ttsBtn.addEventListener("pointerup", cancelPress);
    ttsBtn.addEventListener("pointercancel", cancelPress);
    ttsBtn.addEventListener("pointerleave", cancelPress);

    // ПКМ (Right Click)
    ttsBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelPress();
      openTtsSettings();
    });

    // Обычный клик: переключение чтения (если не было длинного нажатия)
    ttsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isLongPress) {
        isLongPress = false;
        return;
      }
      summaryTtsReader.toggle();
    });

    // Клавиатура (Space / Enter с Shift/Alt или зажатием)
    let keyTimer = null;
    let isKeyLongPress = false;
    ttsBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (e.repeat) return;
        if (e.shiftKey || e.altKey) {
          e.preventDefault();
          openTtsSettings();
          return;
        }
        isKeyLongPress = false;
        keyTimer = setTimeout(() => {
          keyTimer = null;
          isKeyLongPress = true;
          openTtsSettings();
        }, LONG_PRESS_MS);
      }
    });
    ttsBtn.addEventListener("keyup", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (keyTimer) {
          clearTimeout(keyTimer);
          keyTimer = null;
        }
        if (isKeyLongPress) {
          isKeyLongPress = false;
          e.preventDefault();
        }
      }
    });
  }

  if (bodyEl) {
    bodyEl.addEventListener("click", (e) => {
      if (e.target.closest(".tx-summary-time")) return;
      const itemEl = e.target.closest(".tx-summary-item");
      if (!itemEl) return;
      const callId = itemEl.getAttribute("data-call-id");
      if (!callId) return;
      summaryTtsReader.selectOrPlay(callId);
    });
  }

  if (summaryBtn) {
    summaryBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTranscriptionSummary();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTranscriptionSummary(false);
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyTranscriptionSummary();
    });
  }

  if (sortBtn) {
    sortBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      txSummarySortOrder = (txSummarySortOrder === "desc") ? "asc" : "desc";
      if (typeof localStorage !== "undefined") {
        try { localStorage.setItem("proxdmr_tx_summary_sort", txSummarySortOrder); } catch (err) {}
      }
      updateTxSummarySortUI();
      renderTranscriptionSummary();
    });
  }
  updateTxSummarySortUI();

  if (summaryWrap) {
    let holdTimer = null;
    let startX = 0;
    let startY = 0;
    let hasMoved = false;

    const startHold = (clientX, clientY, target) => {
      if (target && target.closest("button, a, input, textarea")) {
        return;
      }
      startX = clientX;
      startY = clientY;
      hasMoved = false;
      if (holdTimer) clearTimeout(holdTimer);
      summaryWrap.classList.add("is-holding");
      holdTimer = setTimeout(() => {
        summaryWrap.classList.remove("is-holding");
        if (!hasMoved && window.isTranscriptionSummaryOpen) {
          toggleTranscriptionSummary(false);
          if (navigator.vibrate) navigator.vibrate(50);
          if (typeof showToast === "function") showToast(window.t ? window.t("live.summary_closed_toast", {}, "📖 Сводка стенограммы закрыта") : "📖 Сводка стенограммы закрыта", 2000);
        }
      }, 600);
    };

    const moveHold = (clientX, clientY) => {
      if (!holdTimer) return;
      const dx = Math.abs(clientX - startX);
      const dy = Math.abs(clientY - startY);
      if (dx > 10 || dy > 10) {
        hasMoved = true;
        clearTimeout(holdTimer);
        holdTimer = null;
        summaryWrap.classList.remove("is-holding");
      }
    };

    const cancelHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      summaryWrap.classList.remove("is-holding");
    };

    summaryWrap.addEventListener("touchstart", (e) => {
      if (e.touches && e.touches.length === 1) {
        startHold(e.touches[0].clientX, e.touches[0].clientY, e.target);
      }
    }, { passive: true });

    summaryWrap.addEventListener("touchmove", (e) => {
      if (e.touches && e.touches.length === 1) {
        moveHold(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    summaryWrap.addEventListener("touchend", cancelHold, { passive: true });
    summaryWrap.addEventListener("touchcancel", cancelHold, { passive: true });

    summaryWrap.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        startHold(e.clientX, e.clientY, e.target);
      }
    });

    summaryWrap.addEventListener("mousemove", (e) => {
      moveHold(e.clientX, e.clientY);
    });

    summaryWrap.addEventListener("mouseup", cancelHold);
    summaryWrap.addEventListener("mouseleave", cancelHold);
  }
}

// Auto-bind on DOM ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initLogTranscriptionTooltip();
      initLogTranscriptionSummary();
    });
  } else {
    initLogTranscriptionTooltip();
    initLogTranscriptionSummary();
  }
}

// Global exposure for compatibility
if (typeof window !== "undefined") {
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.updateLogTranscriptionPopoverIfActive = updateLogTranscriptionPopoverIfActive;
  window.__proxdmr.toggleTranscriptionSummary = toggleTranscriptionSummary;
  window.__proxdmr.renderTranscriptionSummary = renderTranscriptionSummary;
  window.__proxdmr.summaryTtsReader = summaryTtsReader;

  window.formatCaptionHtml = formatCaptionHtml;
  window.toggleTranscriptionSummary = toggleTranscriptionSummary;
  window.renderTranscriptionSummary = renderTranscriptionSummary;
  window.updateLogTranscriptionPopoverIfActive = updateLogTranscriptionPopoverIfActive;
  window.summaryTtsReader = summaryTtsReader;
}
