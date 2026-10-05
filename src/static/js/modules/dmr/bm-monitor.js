import { getCountryInfo, getFlagBadgeHtml, formatCallerDisplay, getCleanTgDesc, formatHistoryTime, getHistoryTimeMode, setHistoryTimeMode, adjustPttDescFontSize , cleanName } from '../core/formatters.js';
import { showToast } from '../core/toast.js';
import { logSelection } from './log-selection.js';

  // --- BrandMeister Live Activity Monitor ---
  const logCountBadge = document.getElementById("logCountBadge");
  const logFilterBtns = document.querySelectorAll(".log-filter-btn");
  const logHotspotTabs = document.getElementById("logHotspotTabs");
  const logList = document.getElementById("logList");
  const logSearchInput = document.getElementById("logSearchInput");
  const logTableScrollWrap = document.getElementById("logTableScrollWrap");
  const liveMonitorPanel = document.getElementById("liveMonitorPanel");
  let lastRxStation = null;
  let lastRxSignalTimestamp = 0;
  
let heardCalls = [];
Object.defineProperty(window, 'heardCalls', {
  get: () => heardCalls,
  set: (v) => heardCalls = v,
  configurable: true
});

  let logFilter = "all";
  let logSearchQuery = "";
  let liveTickerInterval = null;

  function ensureLiveTicker() {
    if (liveTickerInterval) return;
    liveTickerInterval = setInterval(() => {
      const hasActive = heardCalls.some(c => c.active);
      if (!hasActive) {
        clearInterval(liveTickerInterval);
        liveTickerInterval = null;
        return;
      }

      const nowSec = Date.now() / 1000;
      let stateChanged = false;

      // Close any calls that exceeded reasonable DMR talkgroup TOT (120s)
      heardCalls.forEach(c => {
        if (c.active && c.timestamp) {
          const elapsed = nowSec - c.timestamp;
          if (elapsed > 120) {
            c.active = false;
            c.duration = Number(elapsed.toFixed(1));
            stateChanged = true;
          }
        }
      });

      if (stateChanged) {
        renderLogList();
        return;
      }

      // Update only live duration tickers (no full DOM rebuild)
      const ticks = document.querySelectorAll(".live-duration-tick");
      ticks.forEach(el => {
        const start = parseFloat(el.dataset.start);
        if (start && !isNaN(start)) {
          const sec = Math.max(0, nowSec - start).toFixed(1);
          el.textContent = `🔴 ${sec}с`;
        }
      });
    }, 500);
  }

  // Live Monitor Panel Visibility & Per-Hotspot Log State
  // Requirement: on startup (both Web and APK), log history is always closed
  try {
    localStorage.removeItem("proxdmr_log_visible");
  } catch (_) {}
  let isLogVisible = false;
Object.defineProperty(window, 'isLogVisible', { get: () => isLogVisible, set: (v) => isLogVisible = v, configurable: true });
  window.currentLogHotspotId = "default";

  window.getLogSortOrderForHotspot = function(hid) {
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    const targetHid = (!hid || (isMobile && hid === "all"))
      ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
      : hid;
    try {
      const val = localStorage.getItem("proxdmr_log_sort_" + targetHid);
      if (val === "asc" || val === "desc") return val;
    } catch (_) {}
    return "desc";
  };

  window.setLogSortOrderForHotspot = function(hid, order) {
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    const targetHid = (!hid || (isMobile && hid === "all"))
      ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
      : hid;
    try {
      localStorage.setItem("proxdmr_log_sort_" + targetHid, order);
    } catch (_) {}
  };

  window.syncLogSortOrderForCurrentHotspot = function() {
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    const curHid = (isMobile && (!window.currentLogHotspotId || window.currentLogHotspotId === "all"))
      ? (window.activeHotspotId || "default")
      : (window.currentLogHotspotId || "all");
    const order = window.getLogSortOrderForHotspot(curHid);
    window.__proxdmrLogSortOrder = order;
    if (window.recordingsManager && typeof window.recordingsManager.updateSortUI === "function") {
      window.recordingsManager.updateSortUI();
    }
  };

  let logPcHeightMode = localStorage.getItem("proxdmr_log_pc_height_mode") || "screen";
  let pcCardResizeObserver = null;
  let pcCardRaf = null;
  let isTranscriptionSummaryOpen = false;

  function cleanupPcCardResizeObserver() {
    if (pcCardRaf) {
      cancelAnimationFrame(pcCardRaf);
      pcCardRaf = null;
    }
    if (pcCardResizeObserver) {
      pcCardResizeObserver.disconnect();
      pcCardResizeObserver = null;
    }
  }

  function applyDesktopLogHeight() {
    if (!liveMonitorPanel) return;
    const isMobile = window.innerWidth <= 768;
    if (isMobile) return;

    cleanupPcCardResizeObserver();

    const toggleBtn = document.getElementById("logHeightToggleBtn");

    if (!isLogVisible) {
      liveMonitorPanel.classList.remove("pc-height-hotspot");
      liveMonitorPanel.style.removeProperty("--desktop-log-height");
      liveMonitorPanel.style.height = "";
      liveMonitorPanel.style.maxHeight = "";
      return;
    }

    const effectiveHid = (!window.currentLogHotspotId || window.currentLogHotspotId === "all")
      ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
      : window.currentLogHotspotId;

    const targetCard = (effectiveHid && effectiveHid !== "all")
      ? (document.querySelector(`.radio-container[data-hotspot-id="${effectiveHid}"]`) || document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container"))
      : (document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container"));

    if (logPcHeightMode === "hotspot") {
      liveMonitorPanel.classList.add("pc-height-hotspot");
      if (toggleBtn) {
        toggleBtn.classList.remove("is-screen-mode");
        toggleBtn.classList.add("is-hotspot-mode");
        const tip = window.t ? window.t("live.btn_height_to_screen") : "Высота лога: По высоте хотспота (нажмите для растягивания до конца экрана)";
        toggleBtn.title = tip;
      }

      const syncHeight = () => {
        if (!targetCard || !isLogVisible || window.innerWidth <= 768) return;
        const targetH = targetCard.offsetHeight || targetCard.getBoundingClientRect().height;
        if (targetH > 100) {
          const roundedH = `${Math.round(targetH)}px`;
          if (liveMonitorPanel.style.height !== roundedH) {
            liveMonitorPanel.style.setProperty("--desktop-log-height", roundedH);
            liveMonitorPanel.style.height = roundedH;
            liveMonitorPanel.style.maxHeight = roundedH;
          }
        }
      };

      syncHeight();

      if (window.ResizeObserver && targetCard) {
        pcCardResizeObserver = new ResizeObserver(() => {
          if (pcCardRaf) cancelAnimationFrame(pcCardRaf);
          pcCardRaf = requestAnimationFrame(() => {
            syncHeight();
          });
        });
        pcCardResizeObserver.observe(targetCard);
      }
    } else {
      liveMonitorPanel.classList.remove("pc-height-hotspot");
      liveMonitorPanel.style.removeProperty("--desktop-log-height");
      liveMonitorPanel.style.height = "";
      liveMonitorPanel.style.maxHeight = "";
      if (toggleBtn) {
        toggleBtn.classList.remove("is-hotspot-mode");
        toggleBtn.classList.add("is-screen-mode");
        const tip = window.t ? window.t("live.btn_height_to_hotspot") : "Высота лога: До конца экрана (нажмите для выравнивания по высоте хотспота)";
        toggleBtn.title = tip;
      }
    }
  }

  function adjustMobileLogHeight(card = null, smoothScroll = false) {
    if (!liveMonitorPanel || !isLogVisible) return;
    if (window.innerWidth > 768) return;

    cleanupPcCardResizeObserver();

    const effectiveHid = (!window.currentLogHotspotId || window.currentLogHotspotId === "all")
      ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
      : window.currentLogHotspotId;

    const targetCard = card ||
      (effectiveHid && effectiveHid !== "all"
        ? (document.querySelector(`.radio-container[data-hotspot-id="${effectiveHid}"]`) || document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container"))
        : (document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container")));

    if (!targetCard) return;

    targetCard.classList.add("hotspot-compact-mode");

    const viewportH = (window.visualViewport && window.visualViewport.height)
      ? window.visualViewport.height
      : window.innerHeight;

    const toggleBtn = document.getElementById("logHeightToggleBtn");
    if (toggleBtn) {
      if (logPcHeightMode === "hotspot") {
        toggleBtn.classList.remove("is-screen-mode");
        toggleBtn.classList.add("is-hotspot-mode");
        const tip = window.t ? window.t("live.btn_height_to_screen") : "Высота лога: По высоте хотспота (нажмите для растягивания до конца экрана)";
        toggleBtn.title = tip;
      } else {
        toggleBtn.classList.remove("is-hotspot-mode");
        toggleBtn.classList.add("is-screen-mode");
        const tip = window.t ? window.t("live.btn_height_to_hotspot") : "Высота лога: До конца экрана (нажмите для выравнивания по высоте хотспота)";
        toggleBtn.title = tip;
      }
    }

    const cardH = targetCard.offsetHeight || targetCard.getBoundingClientRect().height;
    const gap = 5;
    const bottomSafe = 5;
    const topOffset = 5;
    let logH;
    if (logPcHeightMode === "hotspot") {
      const availableSpace = viewportH - cardH - gap - bottomSafe - topOffset;
      logH = Math.max(160, Math.floor(availableSpace));
    } else {
      logH = Math.max(260, Math.floor(viewportH - 70));
    }

    liveMonitorPanel.style.setProperty("--mobile-log-height", `${logH}px`);
    liveMonitorPanel.style.height = `${logH}px`;
    liveMonitorPanel.style.maxHeight = `${logH}px`;

    const cardRect = targetCard.getBoundingClientRect();
    const currentScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    const cardTop = cardRect.top + currentScrollY;
    const targetScrollY = Math.max(0, Math.floor(cardTop - topOffset));

    window.scrollTo({
      top: targetScrollY,
      behavior: smoothScroll ? "smooth" : "auto"
    });
  }

  function handleFullscreenOrResize() {
    if (!isLogVisible || !liveMonitorPanel) return;
    if (window.innerWidth <= 768) {
      adjustMobileLogHeight(null, false);
    } else {
      applyDesktopLogHeight();
    }
  }

  window.handleLogHeightOnFullscreenOrResize = function() {
    handleFullscreenOrResize();
    setTimeout(handleFullscreenOrResize, 120);
    setTimeout(handleFullscreenOrResize, 350);
  };

  function handleCardLogClick(cardHotspotId) {
    if (!cardHotspotId) cardHotspotId = "default";
    if (isLogVisible && window.currentLogHotspotId === cardHotspotId) {
      isLogVisible = false;
      updateLogVisibility(true);
    } else {
      const isHotspotChanged = (window.currentLogHotspotId !== cardHotspotId);
      window.currentLogHotspotId = cardHotspotId;
      localStorage.setItem("proxdmr_log_hotspot", window.currentLogHotspotId);
      if (typeof window.syncLogSortOrderForCurrentHotspot === "function") {
        window.syncLogSortOrderForCurrentHotspot();
      }
      isLogVisible = true;
      if (isHotspotChanged && isSmartVersion()) {
        logFilter = "all";
        syncLogFilterUI();
      }
      updateLogVisibility(true);
      renderLogHotspotTabs();
      renderLogList();
      if (typeof renderTranscriptionSummary === "function" && isTranscriptionSummaryOpen) {
        renderTranscriptionSummary();
      }

      if (window.innerWidth <= 768) {
        const targetCard = (cardHotspotId && cardHotspotId !== "all")
          ? (document.querySelector(`.radio-container[data-hotspot-id="${cardHotspotId}"]`) || document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container"))
          : (document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container"));
        adjustMobileLogHeight(targetCard, true);
        setTimeout(() => adjustMobileLogHeight(targetCard, false), 60);
      }
    }
  }

  function renderLogHotspotTabs() {
    const isMobile = window.innerWidth <= 768;
    const tabsContainer = document.getElementById("logHotspotTabs");
    if (tabsContainer) {
      const allHsLabel = window.t ? window.t("live.tab_all_hotspots") : "Все хотспоты";
      let html = `<button type="button" class="log-hs-tab-btn ${window.currentLogHotspotId === "all" ? "active" : ""}" data-hid="all">${allHsLabel}</button>`;

      const hsList = (window.currentHotspots && (window.currentHotspots || []).length) ? window.currentHotspots : [{ id: "default", name: "Main 📻" }];
      hsList.forEach(hs => {
        const isActive = (window.currentLogHotspotId === hs.id);
        const label = hs.name || hs.callsign || "Хотспот";
        html += `<button type="button" class="log-hs-tab-btn ${isActive ? "active" : ""}" data-hid="${hs.id}">${label}</button>`;
      });

      tabsContainer.innerHTML = html;

      tabsContainer.querySelectorAll(".log-hs-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          window.currentLogHotspotId = btn.dataset.hid;
          localStorage.setItem("proxdmr_log_hotspot", window.currentLogHotspotId);
          if (typeof window.syncLogSortOrderForCurrentHotspot === "function") {
            window.syncLogSortOrderForCurrentHotspot();
          }
          renderLogHotspotTabs();
          updateLogVisibility(false);
          renderLogList();
          if (typeof renderTranscriptionSummary === "function" && isTranscriptionSummaryOpen) {
            renderTranscriptionSummary();
          }
        });
      });
    }

    const liveTitleText = document.getElementById("liveTitleText");
    if (liveTitleText) {
      if (isMobile) {
        const effectiveHid = (!window.currentLogHotspotId || window.currentLogHotspotId === "all")
          ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
          : window.currentLogHotspotId;
        const hsObj = (window.currentHotspots || []).find(h => h.id === effectiveHid);
        liveTitleText.textContent = hsObj ? hsObj.name : "Хотспот";
      } else if (window.currentLogHotspotId === "all") {
        liveTitleText.textContent = window.t ? window.t("live.tab_all_hotspots", {}, "Все хотспоты") : "Все хотспоты";
      } else {
        const hsObj = (window.currentHotspots || []).find(h => h.id === window.currentLogHotspotId);
        liveTitleText.textContent = hsObj ? hsObj.name : "Хотспот";
      }
    }
  }

  function isSmartVersion() {
    return window.innerWidth <= 768 || document.body.classList.contains("is-apk-mode");
  }

  function syncLogFilterUI() {
    const cycleBtn = document.getElementById("logFilterTsCycleBtn");
    const cycleImg = document.getElementById("logFilterTsCycleImg");
    if (cycleBtn && cycleImg) {
      if (logFilter === "1") {
        cycleImg.src = "/static/img/Bu1.png?v=2.9.81";
        cycleImg.alt = "TS1";
        cycleBtn.title = window.t ? window.t("live.btn_filter_ts1_title", {}, "Фильтр TS: только TS1 (клик: переключить на TS2)") : "Фильтр TS: только TS1 (клик: переключить на TS2)";
      } else if (logFilter === "2") {
        cycleImg.src = "/static/img/Bu2.png?v=2.9.81";
        cycleImg.alt = "TS2";
        cycleBtn.title = window.t ? window.t("live.btn_filter_ts2_title", {}, "Фильтр TS: только TS2 (клик: переключить на оба TS)") : "Фильтр TS: только TS2 (клик: переключить на оба TS)";
      } else {
        cycleImg.src = "/static/img/Bu1+2.png?v=2.9.81";
        cycleImg.alt = "TS1+2";
        cycleBtn.title = window.t ? window.t("live.btn_filter_both_title", {}, "Фильтр TS: оба TS (клик: переключить на TS1)") : "Фильтр TS: оба TS (клик: переключить на TS1)";
      }
    }

    const ts1Btn = document.querySelector('.log-filter-btn[data-filter="1"]');
    const ts2Btn = document.querySelector('.log-filter-btn[data-filter="2"]');

    if (logFilter === "all") {
      if (ts1Btn) ts1Btn.classList.add("active");
      if (ts2Btn) ts2Btn.classList.add("active");
    } else if (logFilter === "1") {
      if (ts1Btn) ts1Btn.classList.add("active");
      if (ts2Btn) ts2Btn.classList.remove("active");
    } else if (logFilter === "2") {
      if (ts1Btn) ts1Btn.classList.remove("active");
      if (ts2Btn) ts2Btn.classList.add("active");
    }
  }

  let _prevLogVisible = null;

  function updateLogVisibility(savePreference = true) {
    if (!liveMonitorPanel) return;
    const isSmart = isSmartVersion();
    const visibilityChanged = (_prevLogVisible === null || _prevLogVisible !== isLogVisible);
    _prevLogVisible = isLogVisible;

    if (visibilityChanged) {
      if (isSmart) {
        logFilter = "all";
      }
      syncLogFilterUI();
    }

    liveMonitorPanel.classList.toggle("hidden", !isLogVisible);
    if (isLogVisible) {
      pushNavState("drawer", "liveMonitorPanel");
    } else {
      // 1. При закрытии истории воспроизведение останавливается
      if (window.recordingsManager) {
        if (typeof window.recordingsManager.closePlayer === "function") {
          window.recordingsManager.closePlayer();
        } else if (window.recordingsManager.audio) {
          window.recordingsManager.audio.pause();
          window.recordingsManager.updatePlayState(false);
        }
      }
      // 2. При закрытии журнала вызовов выключаем режим выбора и полностью отменяем все выбранные элементы
      if (logSelection && typeof logSelection.clearSelection === "function") {
        logSelection.clearSelection();
      } else if (window.logSelection && typeof window.logSelection.clearSelection === "function") {
        window.logSelection.clearSelection();
      }
    }

    const isMobile = window.innerWidth <= 768;
    const effectiveHid = (isMobile && (!window.currentLogHotspotId || window.currentLogHotspotId === "all"))
      ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
      : window.currentLogHotspotId;

    // Reposition liveMonitorPanel immediately after calling hotspot card
    const targetCard = (effectiveHid && effectiveHid !== "all")
      ? (document.querySelector(`.radio-container[data-hotspot-id="${effectiveHid}"]`) || document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container"))
      : (document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container"));

    if (isLogVisible && targetCard && liveMonitorPanel) {
      if (targetCard.nextElementSibling !== liveMonitorPanel) {
        targetCard.after(liveMonitorPanel);
      }
    }

    document.querySelectorAll(".radio-container").forEach(card => {
      const cId = card.dataset.hotspotId || "default";
      const isCurrent = isLogVisible && (effectiveHid === cId || (!isMobile && effectiveHid === "all"));
      const btn = card.querySelector(".btn-log-drawer");
      if (btn) {
        btn.classList.toggle("active", isCurrent);
        btn.title = isCurrent ? (window.t ? window.t("live.btn_log_hide_title", {}, "Скрыть журнал вызовов") : "Скрыть журнал вызовов") : (window.t ? window.t("live.btn_log_show_title", {}, "Показать журнал вызовов для этого хотспота") : "Показать журнал вызовов для этого хотспота");
      }

      if (isMobile && isLogVisible && (card === targetCard)) {
        card.classList.add("hotspot-compact-mode");
      } else {
        card.classList.remove("hotspot-compact-mode");
      }
    });

    if (isLogVisible) {
      if (isMobile) {
        adjustMobileLogHeight(targetCard, false);
      } else {
        applyDesktopLogHeight();
      }
    } else {
      cleanupPcCardResizeObserver();
      liveMonitorPanel.classList.remove("pc-height-hotspot");
      liveMonitorPanel.style.removeProperty("--desktop-log-height");
      liveMonitorPanel.style.removeProperty("--mobile-log-height");
      liveMonitorPanel.style.height = "";
      liveMonitorPanel.style.maxHeight = "";
    }

    if (savePreference) {
      localStorage.setItem("proxdmr_log_visible", isLogVisible.toString());
    }
  }

  // Set initial state from saved preference
  updateLogVisibility(false);
  renderLogHotspotTabs();

  // Listen to window resize to update mobile compact mode dynamically and PTT desc font size
  window.addEventListener("resize", () => {
    updateLogVisibility(false);
    renderLogHotspotTabs();
    syncLogFilterUI();
    renderLogList();
    handleFullscreenOrResize();
    document.querySelectorAll(".radio-container").forEach(card => {
      const descEl = card.querySelector(".ptt-target-desc");
      const infoEl = card.querySelector(".ptt-target-info");
      if (descEl && descEl.textContent) {
        const fn = (typeof adjustPttDescFontSize === "function") ? adjustPttDescFontSize : ((typeof window !== "undefined" && typeof window.adjustPttDescFontSize === "function") ? window.adjustPttDescFontSize : null);
        if (fn) fn(descEl, infoEl, descEl.textContent);
      }
    });
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      handleFullscreenOrResize();
    });
  }

  const logHeightToggleBtn = document.getElementById("logHeightToggleBtn");
  if (logHeightToggleBtn) {
    logHeightToggleBtn.addEventListener("click", () => {
      logPcHeightMode = (logPcHeightMode === "hotspot") ? "screen" : "hotspot";
      localStorage.setItem("proxdmr_log_pc_height_mode", logPcHeightMode);
      if (window.innerWidth <= 768) {
        adjustMobileLogHeight(null, true);
      } else {
        applyDesktopLogHeight();
      }
    });
  }

  const closeLogBtn = document.getElementById("closeLogBtn");
  if (closeLogBtn) {
    closeLogBtn.addEventListener("click", () => {
      isLogVisible = false;
      updateLogVisibility(true);
    });
  }

  if (logSearchInput) {
    logSearchInput.addEventListener("input", (e) => {
      logSearchQuery = e.target.value.toLowerCase().trim();
      renderLogList();
      if (typeof renderTranscriptionSummary === "function" && isTranscriptionSummaryOpen) {
        renderTranscriptionSummary();
      }
    });
  }

  function pruneHeardCalls() {
    const cutoff = (Date.now() / 1000) - 86400; // 24 hours retention
    // Remove old entries in-place (reverse loop to avoid index shift)
    for (let i = heardCalls.length - 1; i >= 0; i--) {
      const c = heardCalls[i];
      if ((c.timestamp || 0) < cutoff && !c.transcription) {
        heardCalls.splice(i, 1);
      }
    }
    if (heardCalls.length > 2000) {
      heardCalls.splice(2000);
    }
  }

  // Auto-prune calls older than 24h every minute
  setInterval(() => {
    const prevLen = heardCalls.length;
    pruneHeardCalls();
    if (heardCalls.length !== prevLen) {
      renderLogList();
      if (typeof renderTranscriptionSummary === "function" && isTranscriptionSummaryOpen) {
        renderTranscriptionSummary();
      }
    }
  }, 60000);

  const logFilterTsCycleBtn = document.getElementById("logFilterTsCycleBtn");
  if (logFilterTsCycleBtn) {
    logFilterTsCycleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (logFilter === "all") {
        logFilter = "1";
      } else if (logFilter === "1") {
        logFilter = "2";
      } else {
        logFilter = "all";
      }
      syncLogFilterUI();
      renderLogList();
      if (typeof renderTranscriptionSummary === "function" && isTranscriptionSummaryOpen) {
        renderTranscriptionSummary();
      }
    });
  }

  logFilterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetFilter = btn.dataset.filter;
      if (logFilter === targetFilter) {
        logFilter = "all";
      } else {
        logFilter = targetFilter;
      }
      syncLogFilterUI();
      renderLogList();
      if (typeof renderTranscriptionSummary === "function" && isTranscriptionSummaryOpen) {
        renderTranscriptionSummary();
      }
    });
  });

  const colHeadDur = document.getElementById("logColHeadDur");
  if (colHeadDur) {
    colHeadDur.addEventListener("click", (e) => {
      if (e.target && e.target.closest("#recSortBtn")) {
        return;
      }
      e.stopPropagation();
      if (typeof window.switchHistoryTimeMode === "function") {
        window.switchHistoryTimeMode();
      }
    });
  }

  function addOrUpdateCall(call) {
    if (!call || !call.id) return;
    const nowSec = Date.now() / 1000;
    const callHid = call.hotspot_id || "default";

    // RULE OF DMR: Only ONE call can be active per timeslot ON A SPECIFIC HOTSPOT!
    if (call.active) {
      heardCalls.forEach(c => {
        const cHid = c.hotspot_id || "default";
        if (cHid === callHid && c.id !== call.id && c.slot === call.slot && c.active) {
          c.active = false;
          if (!c.duration && c.timestamp) {
            c.duration = Math.max(0.5, Number((nowSec - c.timestamp).toFixed(1)));
          }
        }
      });
    }

    const existingIndex = heardCalls.findIndex(c => c.id === call.id);
    if (existingIndex >= 0) {
      const existing = heardCalls[existingIndex];
      const transcription = call.transcription || existing.transcription || "";
      const transcription_lang = call.transcription_lang || existing.transcription_lang || "";
      heardCalls[existingIndex] = {
        ...existing,
        ...call,
        hotspot_id: callHid,
        transcription,
        transcription_lang
      };
    } else {
      heardCalls.unshift({ ...call, hotspot_id: callHid });
      pruneHeardCalls();
    }
    renderLogList();
    if (typeof renderTranscriptionSummary === "function" && isTranscriptionSummaryOpen) {
      renderTranscriptionSummary();
    }
    if (call.active) {
      const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${callHid}"]`);
      if (targetCard) {
        if (typeof window.updateCardRxLiveBanner === "function") window.updateCardRxLiveBanner(targetCard, call);
      }
    }
  }

  function endCall(msg) {
    if (!msg) return;
    const nowSec = Date.now() / 1000;
    const resolveHid = typeof window.resolveHotspotId === "function" ? window.resolveHotspotId : (h => h || "default");
    const msgHid = resolveHid(msg.hotspot_id);

    if (msg.discard || (msg.duration !== undefined && msg.duration < 0.5)) {
      if (msg.call_id) {
        heardCalls = heardCalls.filter(c => c.id !== msg.call_id);
      } else if (msg.slot && msg.hotspot_id) {
        heardCalls = heardCalls.filter(c => !(resolveHid(c.hotspot_id) === msgHid && c.slot === msg.slot && c.active));
      }
    } else {
      let matched = false;
      heardCalls.forEach(c => {
        if (msg.call_id && c.id === msg.call_id) {
          c.active = false;
          c.duration = msg.duration !== undefined ? msg.duration : Math.max(0.5, Number((nowSec - (c.timestamp || nowSec)).toFixed(1)));
          matched = true;
        }
      });
      if (!matched && msg.slot && msg.hotspot_id) {
        heardCalls.forEach(c => {
          if (resolveHid(c.hotspot_id) === msgHid && c.slot === msg.slot && c.active) {
            c.active = false;
            c.duration = msg.duration !== undefined ? msg.duration : Math.max(0.5, Number((nowSec - c.timestamp).toFixed(1)));
          }
        });
      }
    }
    renderLogList();
    if (typeof renderTranscriptionSummary === "function" && isTranscriptionSummaryOpen) {
      renderTranscriptionSummary();
    }
  }

  function resolveCaller(msg) {
    if (!msg || !msg.src_id) return;
    let updated = false;
    heardCalls.forEach(c => {
      if (c.src_id === msg.src_id) {
        if (msg.src_callsign) c.src_callsign = msg.src_callsign;
        if (msg.src_name) c.src_name = msg.src_name;
        if (msg.talker_alias) c.talker_alias = msg.talker_alias;
        if (msg.city) c.city = msg.city;
        c.caller_display = msg.caller_display;
        updated = true;
      }
    });
    if (updated) {
      renderLogList();
      if (typeof renderTranscriptionSummary === "function" && isTranscriptionSummaryOpen) {
        renderTranscriptionSummary();
      }
    }
  }

  window.TG_NAMES = {
    91: "Worldwide (Весь мир)",
    92: "Europe (Европа)",
    113: "English WW",
    250: "Россия (Общий / CIS)",
    2501: "Россия 1 (National)",
    2502: "Москва и Московская обл.",
    2503: "Санкт-Петербург и СЗФО",
    2504: "Центральный ФО",
    2505: "Южный & Кавказский ФО",
    2506: "Приволжский ФО",
    2507: "Уральский ФО",
    2508: "Сибирский ФО",
    2509: "Дальневосточный ФО",
    25011: "Калининградская обл.",
    25020: "Конференция РОСХАМ",
    25033: "Ленинградская обл.",
    250601: "Волгоградская обл.",
    250602: "Ростовская обл.",
    250603: "Армения / Репитер",
    250641: "Краснодарский край",
    250647: "Ставропольский край",
    250907: "Приморский край",
    262: "Германия (National)",
    310: "США (TAC 310)",
    9990: "Parrot (Эхо-тест)",
    4000: "Отключение (Unlink)",
  };
  window.TG_NAMES = window.TG_NAMES;

  // Populate Russian regional talkgroups 250001 - 250099 into window.TG_NAMES
  if (typeof BM_RUSSIA_REGIONS === "object") {
    Object.keys(BM_RUSSIA_REGIONS).forEach((code) => {
      const tgNum = `2500${code}`;
      if (!window.TG_NAMES[tgNum]) {
        window.TG_NAMES[tgNum] = BM_RUSSIA_REGIONS[code];
      }
    });
  }

  // Hydrate TG names from persistent local storage
  try {
    const localTgCache = localStorage.getItem("proxdmr_tg_names_cache");
    if (localTgCache) {
      const parsed = JSON.parse(localTgCache);
      if (parsed && typeof parsed === "object") {
        Object.keys(parsed).forEach(k => {
          const cleaned = getCleanTgDesc(k, parsed[k]);
          if (cleaned) {
            window.TG_NAMES[k] = cleaned;
          } else if (parsed[k]) {
            window.TG_NAMES[k] = parsed[k];
          }
        });
      }
    }
  } catch (e) {
    console.warn("Could not load local TG names cache:", e);
  }

  // Fetch updated catalog from backend
  async function syncTgNamesFromServer() {
    try {
      const resp = await fetch("/api/tg/names");
      const data = await resp.json();
      if (data.status === "ok" && data.names) {
        Object.keys(data.names).forEach(k => {
          const cleaned = getCleanTgDesc(k, data.names[k]);
          if (cleaned) {
            window.TG_NAMES[k] = cleaned;
          } else if (data.names[k]) {
            window.TG_NAMES[k] = data.names[k];
          }
        });
        localStorage.setItem("proxdmr_tg_names_cache", JSON.stringify(window.TG_NAMES));
        if (typeof window.updateTgDisplay === "function") window.updateTgDisplay();
        if (typeof window.renderQuickMemButtons === "function") window.renderQuickMemButtons();
      }
    } catch (e) {
      console.debug("Background TG names sync skipped:", e);
    }
  }
  syncTgNamesFromServer();

  function renderLogList() {
    if (!logList) return;
    const isMobile = window.innerWidth <= 768;
    const effectiveHid = (isMobile && (!window.currentLogHotspotId || window.currentLogHotspotId === "all"))
      ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
      : (window.currentLogHotspotId || "all");

    const totalHs = (window.currentHotspots || []).length;
    const resolveHid = typeof window.resolveHotspotId === "function" ? window.resolveHotspotId : (h => h || "default");
    const effResolved = resolveHid(effectiveHid);

    const filtered = heardCalls.filter(c => {
      if (totalHs > 1 && (isMobile || effectiveHid !== "all")) {
        const callHidResolved = resolveHid(c.hotspot_id);
        if (callHidResolved !== effResolved) return false;
      }
      if (logFilter !== "all" && c.slot.toString() !== logFilter) return false;
      if (logSearchQuery) {
        const isTxMatch = c.is_tx && (logSearchQuery === "tx" || "передача".includes(logSearchQuery));
        const call = (c.src_callsign || "").toLowerCase();
        const name = (c.src_name || "").toLowerCase();
        const idStr = (c.src_id || "").toString();
        const tgStr = (c.dst_id || "").toString();
        const ta = (c.talker_alias || "").toLowerCase();
        const trText = (c.transcription || "").toLowerCase();
        return isTxMatch ||
               call.includes(logSearchQuery) || 
               name.includes(logSearchQuery) || 
               idStr.includes(logSearchQuery) || 
               tgStr.includes(logSearchQuery) ||
               ta.includes(logSearchQuery) ||
               trText.includes(logSearchQuery);
      }
      return true;
    });

    if (logCountBadge) logCountBadge.textContent = filtered.length;

    if (filtered.length === 0) {
      let emptyMsg = window.t ? window.t("live.empty_waiting") : "Ожидание активности в сети BM...";
      if (logSearchQuery) {
        emptyMsg = window.t ? window.t("live.empty_not_found") : "Ничего не найдено по запросу";
      } else if (isMobile || effectiveHid !== "all") {
        const hsObj = (window.currentHotspots || []).find(h => h.id === effectiveHid);
        emptyMsg = window.t ? window.t("live.empty_hotspot", { name: hsObj ? hsObj.name : "хотспоте" }) : `Ожидание активности на ${hsObj ? hsObj.name : "хотспоте"}...`;
      }
      logList.innerHTML = `<div class="log-empty-msg">${emptyMsg}</div>`;
      return;
    }

    const nowSec = Date.now() / 1000;

    if (typeof window.getLogSortOrderForHotspot === "function") {
      const savedOrder = window.getLogSortOrderForHotspot(effectiveHid);
      if (window.__proxdmrLogSortOrder !== savedOrder) {
        window.__proxdmrLogSortOrder = savedOrder;
        if (window.recordingsManager && typeof window.recordingsManager.updateSortUI === "function") {
          window.recordingsManager.updateSortUI();
        }
      }
    }

    const maxVisible = 300;
    const toRender = filtered.slice(0, maxVisible);
    if (window.__proxdmrLogSortOrder === "asc") {
      toRender.reverse();
    }

    let html = toRender.map(c => {
      const isTx = Boolean(c.is_tx);
      const country = getCountryInfo(c.src_id, c.src_callsign);
      const flagHtml = isTx 
        ? `<span class="tx-mic-icon" title="${window.t ? window.t("live.tx_tooltip", {}, "Моя передача (TX)") : "Моя передача (TX)"}">\u{1F399}\u{FE0F}</span>` 
        : getFlagBadgeHtml(country, false, country.flag);
      const myCall = ((window.radioState && window.radioState.callsign) || (document.getElementById("callsignDisplay") && document.getElementById("callsignDisplay").textContent) || "").trim().toUpperCase();
      const myDmrId = (window.radioState && window.radioState.dmr_id) || "";
      const isMyCall = Boolean(myCall && myCall !== "N0CALL" && myCall !== "---");
      const isForeign = !isTx && (String(c.src_id) !== String(myDmrId));
      const validTa = (c.talker_alias && c.talker_alias.trim()) ? c.talker_alias.trim() : "";
      const isLeakedTa = isForeign && isMyCall && (validTa.toUpperCase() === myCall || validTa.toUpperCase().startsWith(myCall + " "));
      const effectiveTa = isLeakedTa ? "" : validTa;

      const baseCaller = formatCallerDisplay(c.src_callsign, c.src_name, effectiveTa, c.src_id, c.caller_display);
      const callerDisplay = isTx ? `<span class="log-tx-badge">TX</span>${baseCaller}` : baseCaller;
      const isPrivateCall = c.call_type !== "GROUP";
      const tgText = isPrivateCall ? `ID ${c.dst_id}` : `${c.dst_id}`;
      const tgDisplayHtml = isPrivateCall ? `ID <span class="dmr-id-text">${c.dst_id}</span>` : `${c.dst_id}`;

      const callerCountry = getCountryInfo(c.src_id, c.src_callsign);
      const tgCountry = !isPrivateCall ? getCountryInfo(c.dst_id) : null;

      let isDiffCountry = false;
      let tgFlagHtml = "";
      let tgCountryName = "";

      if (!isPrivateCall && tgCountry) {
        const callerName = (callerCountry && callerCountry.name) ? callerCountry.name.trim().toLowerCase() : "";
        const targetCountryName = (tgCountry.name) ? tgCountry.name.trim().toLowerCase() : "";

        if (targetCountryName === "global" || targetCountryName.includes("worldwide")) {
          if (callerName && callerName !== "global") {
            isDiffCountry = true;
          }
        } else if (targetCountryName && targetCountryName !== "global") {
          if (callerName !== targetCountryName) {
            isDiffCountry = true;
          }
        }

        if (isDiffCountry) {
          tgFlagHtml = `<span class="tg-flag" title="${tgCountry.name || ''}">${getFlagBadgeHtml(tgCountry, c.dst_id === 9990)}</span>`;
          if (tgCountry.name && tgCountry.name !== "Global") {
            tgCountryName = tgCountry.name;
          } else if (c.dst_id === 91) {
            tgCountryName = "Worldwide";
          } else if (c.dst_id === 92) {
            tgCountryName = "Europe";
          }
        }
      }

      let tgDesc = "";
      if (!isPrivateCall) {
        const rawName = (typeof window.TG_NAMES !== "undefined" && window.TG_NAMES[c.dst_id]) || c.talkgroup_name || c.dst_name || "";
        let cleaned = "";
        if (rawName) {
          cleaned = typeof getCleanTgDesc === "function" ? getCleanTgDesc(c.dst_id, rawName) : rawName;
        }

        if (isDiffCountry) {
          if (tgCountryName) {
            if (cleaned) {
              const lowerCleaned = cleaned.toLowerCase();
              const lowerCountry = tgCountryName.toLowerCase();
              if (lowerCleaned.startsWith(lowerCountry) || lowerCleaned.includes(lowerCountry)) {
                tgDesc = cleaned;
              } else {
                tgDesc = `${tgCountryName} ${cleaned}`;
              }
            } else {
              tgDesc = tgCountryName;
            }
          } else {
            tgDesc = cleaned;
          }
        } else {
          if (cleaned) {
            const shortDesc = cleaned.split(/[\(\/]/)[0].trim();
            tgDesc = shortDesc || cleaned;
          }
        }
      } else {
        const userObj = (typeof USER_CALLSIGNS !== "undefined" && USER_CALLSIGNS[c.dst_id]) || null;
        if (userObj && (userObj.callsign || userObj.name)) {
          tgDesc = `${userObj.callsign || ''} ${userObj.name || ''}`.trim();
        } else {
          tgDesc = window.t ? window.t("live.private_call", {}, "Личный") : "Личный";
        }
      }

      const tgDescHtml = tgDesc ? `<span class="tg-desc-text" title="${tgDesc}">${tgDesc}</span>` : "";
      const tgCellTitle = `${tgText}${isDiffCountry && tgCountry?.name ? ' [' + tgCountry.name + ']' : ''}${tgDesc ? ' — ' + tgDesc : ''}`;
      const activeClass = c.active ? (isTx ? " active-call active-tx-call" : " active-call") : "";
      const txRowClass = isTx ? " is-tx-row" : "";
      const formatFn = (typeof window !== "undefined" && typeof window.formatHistoryTime === "function")
        ? window.formatHistoryTime
        : (typeof formatHistoryTime === "function" ? formatHistoryTime : null);
      const timeStr = formatFn
        ? formatFn(c.timestamp || nowSec)
        : (c.time_str || (new Date((c.timestamp || nowSec) * 1000)).toTimeString().substring(0, 8));
      const elapsed = Math.max(0, nowSec - (c.timestamp || nowSec)).toFixed(1);
      const sUnit = window.t ? window.t("live.sec", {}, "с") : "с";
      const durStr = c.active 
        ? `<span class="live-duration-tick duration-active" data-start="${c.timestamp}">🔴 ${elapsed}${sUnit}</span>` 
        : `<span class="duration-text" style="color: #ffffff;">${c.duration ? c.duration + sUnit : '—'}</span>`;

      const locationInfo = isTx ? "" : (c.city ? `${c.city}, ${country.name}` : country.name);
      const plainTitle = `${(isTx ? '[TX] ' : '')}${baseCaller.replace(/<[^>]+>/g, '')}${locationInfo ? ' - ' + locationInfo : ''}`;
      
      const hsObj = (window.currentHotspots || []).find(h => h.id === (c.hotspot_id || "default"));
      const hsBadge = (!isMobile && window.currentLogHotspotId === "all" && hsObj) 
        ? `<span class="log-hs-badge" title="${hsObj.name}">${hsObj.name}</span>` 
        : "";

      // Caller name extraction: Callsign & Name, without parentheses ID (as ID is on line 2)
      let callerNameLine = "";
      if (effectiveTa) {
        callerNameLine = effectiveTa.replace(/\s*\(\s*\d{3,8}\s*\)$/, "").trim();
      } else if (c.src_callsign && c.src_callsign.trim() && c.src_callsign !== "---" && !c.src_callsign.startsWith("ID:")) {
        const call = c.src_callsign.trim().toUpperCase();
        const cName = typeof cleanName === "function" ? cleanName(c.src_name) : (c.src_name || "").trim();
        callerNameLine = (cName && cName.toUpperCase() !== call) ? `${call} ${cName}` : call;
      } else if (c.caller_display && c.caller_display.trim() && c.caller_display !== "---") {
        let raw = c.caller_display.replace(/<[^>]+>/g, "").trim();
        const mParen = raw.match(/^(.*?)\s*\(\s*(\d{3,8})\s*\)$/);
        callerNameLine = mParen ? mParen[1].trim() : raw;
      }
      if (!callerNameLine || (isForeign && isMyCall && callerNameLine.toUpperCase() === myCall)) {
        if (c.src_callsign && c.src_callsign.trim() && c.src_callsign !== "---" && !c.src_callsign.startsWith("ID:")) {
          const call = c.src_callsign.trim().toUpperCase();
          const cName = typeof cleanName === "function" ? cleanName(c.src_name) : (c.src_name || "").trim();
          callerNameLine = (cName && cName.toUpperCase() !== call) ? `${call} ${cName}` : call;
        } else {
          callerNameLine = c.src_id ? `ID: ${c.src_id}` : "---";
        }
      }

      // Line 2: DMR ID + country/location
      const validId = c.src_id && String(c.src_id) !== "0" && String(c.src_id) !== "---" ? String(c.src_id) : "";
      const dmrIdHtml = validId ? `<span class="dmr-id-text">${validId}</span>` : "";
      const locText = locationInfo ? `<span class="station-country">(${locationInfo})</span>` : "";
      const stationSubHtml = [dmrIdHtml, locText].filter(Boolean).join(" ");

      const hasTranscription = Boolean(c.transcription && c.transcription.trim());
      const flagClass = hasTranscription ? "station-flag has-transcription" : "station-flag";
      const transMarkerHtml = hasTranscription 
        ? `<span class="log-text-marker" data-call-id="${c.id}" title="${window.t ? window.t("live.has_transcription", {}, "Текст передачи") : "Текст передачи"}"></span>` 
        : "";

      const hasRec = Boolean(window.recordingsManager && window.recordingsManager.hasRecording(c.id));
      const isCurPlaying = Boolean(window.recordingsManager && window.recordingsManager.isPlayingCall(c.id));
      const activeCallId = window.recordingsManager ? window.recordingsManager.getActiveCallId() : null;
      const isCurRecRow = Boolean(activeCallId && String(activeCallId) === String(c.id));
      const recRowClass = isCurRecRow ? " is-playing-rec" : "";
      const playBtnHtml = hasRec ? `<button type="button" class="log-play-btn${isCurPlaying ? ' playing' : ''}" data-call-id="${c.id}" title="${window.t ? window.t("recordings.play_tooltip", {}, "Прослушать запись") : "Прослушать запись"}"><img src="/static/img/Log_PLAY.png" class="log-play-img" alt="Play"></button>` : '';

      return `
        <div class="live-call-row${txRowClass}${activeClass}${recRowClass}" data-id="${c.id}">
          <!-- Desktop 4-column 2-line layout -->
          <div class="live-row-desktop">
            <div class="cell-station" title="${plainTitle}" data-radio-id="${c.src_id}" data-callsign="${c.src_callsign || ''}" data-name="${c.src_name || ''}">
              <span class="${flagClass}" data-call-id="${c.id}" title="${isTx ? (window.t ? window.t("live.my_tx_title", {}, "Моя передача (TX)") : "Моя передача (TX)") : country.name}">${flagHtml}</span>
              ${transMarkerHtml}
              <div class="station-text-wrap" data-radio-id="${c.src_id}">
                <div class="station-name-line">${isTx ? '<span class="log-tx-badge">TX</span>' : ''}${callerNameLine}${hsBadge}</div>
                <div class="station-sub-line">${stationSubHtml}</div>
              </div>
            </div>
            <div class="cell-tg" title="${tgCellTitle}">
              <div class="tg-line-top">
                <span class="tg-plain-link btn-quick-tune-tg ${isPrivateCall ? 'is-id' : 'is-tg'}" data-tg="${c.dst_id}" data-slot="${c.slot}" data-hid="${c.hotspot_id || 'default'}" title="${window.t ? window.t("live.tune_title", { tg: tgText, slot: c.slot }) : `Tune to ${tgText} (TS${c.slot})`}">
                  ${tgDisplayHtml}
                </span>
                ${tgFlagHtml}
              </div>
              <div class="tg-line-sub">
                ${tgDescHtml || '<span class="tg-desc-none">—</span>'}
              </div>
            </div>
            <div class="cell-slot">
              <span class="slot-text-ts${c.slot}">TS${c.slot}</span>
            </div>
            <div class="cell-play">
              ${playBtnHtml}
            </div>
            <div class="cell-duration">
              <div class="dur-line-top" style="color: #ffffff;">
                ${durStr}
              </div>
              <div class="dur-line-sub" title="${window.t ? window.t('live.time_toggle_tooltip', {}, 'Время вызова: нажмите для переключения LOC ↔ UTC') : 'Время вызова: нажмите для переключения LOC ↔ UTC'}">
                ${timeStr}
              </div>
            </div>
          </div>

          <!-- Mobile layout (matches desktop 5-column 2-line structure) -->
          <div class="live-row-mobile">
            <span class="${flagClass}" data-call-id="${c.id}" title="${isTx ? (window.t ? window.t("live.my_tx_title", {}, "Моя передача (TX)") : "Моя передача (TX)") : country.name}">${flagHtml}</span>
            ${transMarkerHtml}
            <div class="station-text-wrap" data-radio-id="${c.src_id}">
              <div class="station-name-line">${isTx ? '<span class="log-tx-badge">TX</span>' : ''}${callerNameLine}${hsBadge}</div>
              <div class="station-sub-line">${stationSubHtml}</div>
            </div>
            <div class="cell-tg" title="${tgCellTitle}">
              <div class="tg-line-top">
                <span class="tg-plain-link btn-quick-tune-tg ${isPrivateCall ? 'is-id' : 'is-tg'}" data-tg="${c.dst_id}" data-slot="${c.slot}" data-hid="${c.hotspot_id || 'default'}">${tgDisplayHtml}</span>
                ${tgFlagHtml}
              </div>
              <div class="tg-line-sub">${tgDescHtml || '—'}</div>
            </div>
            <div class="cell-slot">
              <span class="slot-text-ts${c.slot}">TS${c.slot}</span>
            </div>
            <div class="cell-play">
              ${playBtnHtml}
            </div>
            <div class="cell-duration">
              <div class="dur-line-top" style="color: #ffffff;">${durStr}</div>
              <div class="dur-line-sub" title="${window.t ? window.t('live.time_toggle_tooltip', {}, 'Время вызова: нажмите для переключения LOC ↔ UTC') : 'Время вызова: нажмите для переключения LOC ↔ UTC'}">${timeStr}</div>
            </div>
          </div>
        </div>
      `;
    }).join("");

    if (filtered.length > maxVisible) {
      html += `<div class="log-more-hint" style="text-align:center; padding:10px 0; font-size:0.75rem; color:var(--text-muted, #8b949e); opacity:0.85;">${window.t ? window.t("live.more_records_hint", { shown: maxVisible, total: filtered.length }, `Показаны последние ${maxVisible} из ${filtered.length} записей за сутки`) : `Показаны последние ${maxVisible} из ${filtered.length} записей за сутки`}</div>`;
    }
    const scrollWrap = document.getElementById("logTableScrollWrap");
    const wasAtBottom = scrollWrap && (scrollWrap.scrollHeight - scrollWrap.scrollTop <= scrollWrap.clientHeight + 50);
    logList.innerHTML = html;

    

    if (window.__proxdmrLogSortOrder === "asc" && scrollWrap) {
      if (wasAtBottom || filtered.length === toRender.length) {
        scrollWrap.scrollTop = scrollWrap.scrollHeight;
      }
    }
    if (window.recordingsManager && typeof window.recordingsManager.updateActiveRowHighlight === "function") {
      window.recordingsManager.updateActiveRowHighlight();
    }

    // Play recording buttons listener
    logList.querySelectorAll(".log-play-btn").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const cid = btn.dataset.callId;
        if (window.recordingsManager && cid) {
          window.recordingsManager.playByCallId(cid);
        }
      };
    });

    // Quick tune listener
    logList.querySelectorAll(".btn-quick-tune-tg").forEach(btn => {
      btn.onclick = (e) => {
        if (window.__proxdmr_log_swipe_active) return;
        e.stopPropagation();
        const tg = parseInt(btn.dataset.tg, 10);
        const slot = parseInt(btn.dataset.slot, 10);
        const hid = btn.dataset.hid;
        if (hid && typeof window.switchActiveHotspot === "function") window.switchActiveHotspot(hid);
        if (tg > 0) {
          if (slot === 1 || slot === 2) {
            if (typeof window.setActiveSlot === "function") window.setActiveSlot(slot, true);
          }
          if (typeof window.setTg === "function") window.setTg(tg, true);
        }
      };
    });

    ensureLiveTicker();
    if (logSelection && typeof logSelection.updateUI === "function") {
      logSelection.updateUI();
    }
  }

  function initLogSwipe() {
    const scrollWrap = document.getElementById("logTableScrollWrap");
    const monitorPanel = document.getElementById("liveMonitorPanel");
    if (!scrollWrap) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let initialScrollLeft = 0;
    let isTracking = false;
    let isHorizontalMove = false;
    let hasMoved = false;

    const startSwipe = (clientX, clientY, target) => {
      if (target && target.closest("input, select, textarea, .log-filter-btn, .log-filter-ts-cycle-btn, #logFilterTsCycleBtn, .icon-btn")) {
        return false;
      }
      touchStartX = clientX;
      touchStartY = clientY;
      touchStartTime = performance.now();
      initialScrollLeft = scrollWrap.scrollLeft;
      isTracking = true;
      isHorizontalMove = false;
      hasMoved = false;
      return true;
    };

    const moveSwipe = (clientX, clientY, e) => {
      if (!isTracking) return;
      const dx = clientX - touchStartX;
      const dy = clientY - touchStartY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (!isHorizontalMove) {
        if (absDx > 6 && absDx > absDy * 0.7) {
          isHorizontalMove = true;
        } else if (absDy > 8 && absDy > absDx) {
          isTracking = false;
          return;
        }
      }

      if (isHorizontalMove) {
        hasMoved = true;
        if (e && e.cancelable) e.preventDefault();
        scrollWrap.scrollLeft = initialScrollLeft - dx;
      }
    };

    const endSwipe = (clientX) => {
      if (!isTracking) return;
      isTracking = false;

      const dx = clientX - touchStartX;
      const dt = performance.now() - touchStartTime;
      const maxScroll = Math.max(0, scrollWrap.scrollWidth - scrollWrap.clientWidth);

      // Fast swipe detection: registration of touch and coordinate change faster than 120ms
      const isFastSwipe = Math.abs(dx) >= 12 && dt <= 120;
      const isHighVelocity = Math.abs(dx) >= 20 && (Math.abs(dx) / Math.max(1, dt) > 0.3);

      if (isFastSwipe || isHighVelocity) {
        if (dx < 0) {
          // Swiped left -> smoothly scroll right to reveal Time column
          scrollWrap.scrollTo({ left: maxScroll, behavior: "smooth" });
        } else {
          // Swiped right -> smoothly scroll left to return to Station & TG
          scrollWrap.scrollTo({ left: 0, behavior: "smooth" });
        }
      } else if (hasMoved && maxScroll > 0) {
        // Drag snap
        if (dx < -30) {
          scrollWrap.scrollTo({ left: maxScroll, behavior: "smooth" });
        } else if (dx > 30) {
          scrollWrap.scrollTo({ left: 0, behavior: "smooth" });
        }
      }

      if (hasMoved && Math.abs(dx) > 10) {
        window.__proxdmr_log_swipe_active = true;
        setTimeout(() => {
          window.__proxdmr_log_swipe_active = false;
        }, 120);
      }
    };

    // Touch events for mobile/tablet screens
    const touchTarget = monitorPanel || scrollWrap;
    touchTarget.addEventListener("touchstart", (e) => {
      if (e.touches && e.touches.length === 1) {
        startSwipe(e.touches[0].clientX, e.touches[0].clientY, e.target);
      }
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
      if (isTracking && e.touches && e.touches.length === 1) {
        moveSwipe(e.touches[0].clientX, e.touches[0].clientY, e);
      }
    }, { passive: false });

    window.addEventListener("touchend", (e) => {
      if (isTracking && e.changedTouches && e.changedTouches.length > 0) {
        endSwipe(e.changedTouches[0].clientX);
      }
    }, { passive: true });

    window.addEventListener("touchcancel", () => {
      isTracking = false;
    }, { passive: true });

    // Mouse drag support on PC
    scrollWrap.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        startSwipe(e.clientX, e.clientY, e.target);
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (isTracking) {
        moveSwipe(e.clientX, e.clientY, e);
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (isTracking) {
        endSwipe(e.clientX);
      }
    });
  }





// --- Global Exports for Monolith Compatibility ---
Object.defineProperty(window, 'lastRxStation', { get: () => lastRxStation, set: (v) => lastRxStation = v, configurable: true });
Object.defineProperty(window, 'lastRxSignalTimestamp', { get: () => lastRxSignalTimestamp, set: (v) => lastRxSignalTimestamp = v, configurable: true });
Object.defineProperty(window, 'logFilter', { get: () => logFilter, set: (v) => logFilter = v, configurable: true });
Object.defineProperty(window, 'logSearchQuery', { get: () => logSearchQuery, set: (v) => logSearchQuery = v, configurable: true });
window.renderLogList = renderLogList;
window.ensureLiveTicker = ensureLiveTicker;

initLogSwipe();
logSelection.init();
window.updateLogVisibility = updateLogVisibility;
window.syncLogFilterUI = syncLogFilterUI;
window.renderLogHotspotTabs = renderLogHotspotTabs;
window.pruneHeardCalls = pruneHeardCalls;
window.handleLogHeightOnFullscreenOrResize = handleLogHeightOnFullscreenOrResize;
window.handleFullscreenOrResize = handleFullscreenOrResize;
window.__proxdmr = window.__proxdmr || {};
window.__proxdmr.addOrUpdateCall = addOrUpdateCall;
window.__proxdmr.endCall = endCall;
window.__proxdmr.resolveCaller = resolveCaller;
window.__proxdmr.renderLogList = renderLogList;
window.__proxdmr.getHeardCalls = () => heardCalls;
window.__proxdmr.setHeardCalls = (c) => { heardCalls = Array.isArray(c) ? c : []; renderLogList(); };
window.__proxdmr.clearHeardCalls = () => { heardCalls = []; renderLogList(); };
window.addOrUpdateCall = addOrUpdateCall;
window.endCall = endCall;
window.resolveCaller = resolveCaller;
Object.defineProperty(window, 'isTranscriptionSummaryOpen', { get: () => isTranscriptionSummaryOpen, set: (v) => isTranscriptionSummaryOpen = v, configurable: true });
window.handleCardLogClick = handleCardLogClick;



