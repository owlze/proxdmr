import { getCountryInfo, getCallCountryInfo, getFlagBadgeHtml, formatCallerDisplay, getCleanTgDesc, formatHistoryTime, getHistoryTimeMode, setHistoryTimeMode, adjustPttDescFontSize , cleanName } from '../core/formatters.js?v=2.9.787';
import { showToast } from '../core/toast.js?v=2.9.699';
import { logSelection } from './log-selection.js?v=2.9.805';

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
  const V_OVERSCAN = 16;
  const V_REUSE_MARGIN = 6;
  let _filteredLogCalls = [];
  let _lastLogViewKey = "";
  let _vRowHeight = 35;
  let _vRowHeightMeasured = false;
  let _vRenderedStart = -1;
  let _vRenderedEnd = -1;
  let _vSpacerTop = null;
  let _vViewport = null;
  let _vSpacerBottom = null;
  let _vScrollRaf = null;
  let _vResizeObserver = null;
  let _vNeedsRenderOnShow = false;
  let _vLastMeta = { isMobile: false, effectiveHid: "all", isAsc: false };
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
      const sUnit = (typeof window !== "undefined" && window.t) ? window.t("live.sec", {}, "s") : "s";
      const ticks = document.querySelectorAll(".live-duration-tick");
      ticks.forEach(el => {
        const start = parseFloat(el.dataset.start);
        if (start && !isNaN(start)) {
          const sec = Math.max(0, nowSec - start).toFixed(1);
          el.textContent = `🔴 ${sec}${sUnit}`;
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
      ? (window.activeHotspotId || ((window.currentHotspots || []).find(h => !h.hidden) || {}).id || "default")
      : window.currentLogHotspotId;

    const targetCard = (effectiveHid && effectiveHid !== "all")
      ? (document.querySelector(`.radio-container[data-hotspot-id="${effectiveHid}"]:not(.collapsed)`) || document.querySelector(".radio-container:not(.collapsed)"))
      : document.querySelector(".radio-container:not(.collapsed)");

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
        const targetRect = targetCard.getBoundingClientRect();
        const cardH = Math.round((targetRect && targetRect.height) || targetCard.offsetHeight || 0);
        if (cardH <= 100) return;

        const panelRect = liveMonitorPanel.getBoundingClientRect();
        let desiredH = cardH;
        // Match parent floor when History starts higher than its parent card in the same desktop row
        if (
          panelRect &&
          panelRect.width > 0 &&
          targetRect &&
          panelRect.top < targetRect.top - 0.5 &&
          targetRect.bottom > panelRect.top &&
          Math.abs(panelRect.left - targetRect.left) > 20
        ) {
          desiredH = Math.max(cardH, Math.round(targetRect.bottom - panelRect.top));
        }

        const roundedH = `${desiredH}px`;
        if (liveMonitorPanel.style.height !== roundedH) {
          liveMonitorPanel.style.setProperty("--desktop-log-height", roundedH);
          liveMonitorPanel.style.height = roundedH;
          liveMonitorPanel.style.maxHeight = roundedH;
        }
      };

      syncHeight();
      if (typeof window.syncDesktopHotspotsTopAlignment === "function") {
        window.syncDesktopHotspotsTopAlignment();
      }

      if (window.ResizeObserver && targetCard) {
        pcCardResizeObserver = new ResizeObserver(() => {
          if (pcCardRaf) cancelAnimationFrame(pcCardRaf);
          pcCardRaf = requestAnimationFrame(() => {
            syncHeight();
            if (typeof window.scheduleDesktopHotspotsTopAlignment === "function") {
              window.scheduleDesktopHotspotsTopAlignment();
            }
          });
        });
        pcCardResizeObserver.observe(targetCard);
      }
    } else {
      liveMonitorPanel.classList.remove("pc-height-hotspot");
      liveMonitorPanel.style.removeProperty("--desktop-log-height");
      liveMonitorPanel.style.height = "";
      liveMonitorPanel.style.maxHeight = "";
      if (typeof window.syncDesktopHotspotsTopAlignment === "function") {
        window.syncDesktopHotspotsTopAlignment();
      }
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

    const toolbarEl = document.getElementById("proxdmrTopToolbar");
    const toolbarH = toolbarEl ? (toolbarEl.offsetHeight || toolbarEl.getBoundingClientRect().height || 0) : 0;
    const isVisibleCard = targetCard && !targetCard.classList.contains("collapsed");
    const cardH = isVisibleCard ? (targetCard.offsetHeight || targetCard.getBoundingClientRect().height) : 0;
    const gap = 5;
    const bottomSafe = 5;
    const topOffset = toolbarH ? (toolbarH + 5) : 5;
    let logH;
    if (logPcHeightMode === "hotspot") {
      const availableSpace = viewportH - cardH - gap - bottomSafe - topOffset;
      logH = Math.max(160, Math.floor(availableSpace));
    } else {
      logH = Math.max(260, Math.floor(viewportH - topOffset - 16));
    }

    liveMonitorPanel.style.setProperty("--mobile-log-height", `${logH}px`);
    liveMonitorPanel.style.height = `${logH}px`;
    liveMonitorPanel.style.maxHeight = `${logH}px`;

    const anchorTarget = isVisibleCard ? targetCard : liveMonitorPanel;
    const targetRect = anchorTarget.getBoundingClientRect();
    const currentScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    const targetTop = targetRect.top + currentScrollY;
    const targetScrollY = Math.max(0, Math.floor(targetTop - topOffset));

    window.scrollTo({
      top: targetScrollY,
      behavior: smoothScroll ? "smooth" : "auto"
    });
  }

  function handleFullscreenOrResize() {
    if (!isLogVisible || !liveMonitorPanel) return;
    if (window.innerWidth <= 768) {
      adjustMobileLogHeight(null, false);
      if (typeof window.syncDesktopHotspotsTopAlignment === "function") {
        window.syncDesktopHotspotsTopAlignment();
      }
    } else {
      applyDesktopLogHeight();
      if (typeof window.scheduleDesktopHotspotsTopAlignment === "function") {
        window.scheduleDesktopHotspotsTopAlignment();
      }
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
      const curHsObj = (window.currentHotspots || []).find(h => h.id === cardHotspotId);
      const isCurNoTs = ["allstar", "ysf", "m17"].includes((curHsObj?.network_type || "").toLowerCase());
      if (isCurNoTs || (isHotspotChanged && isSmartVersion())) {
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

      const defaultHsLabel = window.t ? window.t("hotspots.default_name", {}, "Hotspot") : "Hotspot";
      const hsList = (window.currentHotspots && (window.currentHotspots || []).length) ? window.currentHotspots : [{ id: "default", name: "Main 📻" }];
      hsList.forEach(hs => {
        const isActive = (window.currentLogHotspotId === hs.id);
        const label = hs.name || hs.callsign || defaultHsLabel;
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
          const tabHsObj = (window.currentHotspots || []).find(h => h.id === window.currentLogHotspotId);
          const isTabNoTs = ["allstar", "ysf", "m17"].includes((tabHsObj?.network_type || "").toLowerCase());
          if (isTabNoTs) {
            logFilter = "all";
            syncLogFilterUI();
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
      const defaultHsLabel = window.t ? window.t("hotspots.default_name", {}, "Hotspot") : "Hotspot";
      if (isMobile) {
        const effectiveHid = (!window.currentLogHotspotId || window.currentLogHotspotId === "all")
          ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
          : window.currentLogHotspotId;
        const hsObj = (window.currentHotspots || []).find(h => h.id === effectiveHid);
        liveTitleText.textContent = hsObj ? hsObj.name : defaultHsLabel;
      } else if (window.currentLogHotspotId === "all") {
        liveTitleText.textContent = window.t ? window.t("live.tab_all_hotspots", {}, "Все хотспоты") : "Все хотспоты";
      } else {
        const hsObj = (window.currentHotspots || []).find(h => h.id === window.currentLogHotspotId);
        liveTitleText.textContent = hsObj ? hsObj.name : defaultHsLabel;
      }
    }
  }

  function isSmartVersion() {
    return window.innerWidth <= 768 || document.body.classList.contains("is-apk-mode");
  }

  function isHistoryNoTsNetwork() {
    const isMobile = window.innerWidth <= 768;
    const rawHid = window.currentLogHotspotId;
    const effectiveHid = (isMobile && (!rawHid || rawHid === "all"))
      ? (window.activeHotspotId || ((window.currentHotspots || []).find(h => !h.hidden) || {}).id || "default")
      : (rawHid || "all");
    if (!effectiveHid || effectiveHid === "all") return false;
    const hs = (window.currentHotspots || []).find(h => h.id === effectiveHid);
    if (!hs) return false;
    const net = (hs.network_type || "").toLowerCase();
    return net === "allstar" || net === "ysf" || net === "m17";
  }

  function syncLogFilterUI() {
    const isNoTs = isHistoryNoTsNetwork();
    const cycleBtn = document.getElementById("logFilterTsCycleBtn");
    const cycleImg = document.getElementById("logFilterTsCycleImg");

    if (isNoTs) {
      logFilter = "all";
      if (cycleBtn) {
        cycleBtn.classList.add("hidden");
        cycleBtn.style.setProperty("display", "none", "important");
      }
      if (liveMonitorPanel) {
        liveMonitorPanel.classList.add("is-no-ts-network");
      }
    } else {
      if (cycleBtn) {
        cycleBtn.classList.remove("hidden");
        cycleBtn.style.removeProperty("display");
      }
      if (liveMonitorPanel) {
        liveMonitorPanel.classList.remove("is-no-ts-network");
      }
    }

    if (!isNoTs && cycleBtn && cycleImg) {
      if (logFilter === "1") {
        cycleImg.src = "/static/img/Bu1.png?v=2.9.310";
        cycleImg.alt = "TS1";
        cycleBtn.title = window.t ? window.t("live.btn_filter_ts1_title", {}, "Фильтр TS: только TS1 (клик: переключить на TS2)") : "Фильтр TS: только TS1 (клик: переключить на TS2)";
      } else if (logFilter === "2") {
        cycleImg.src = "/static/img/Bu2.png?v=2.9.310";
        cycleImg.alt = "TS2";
        cycleBtn.title = window.t ? window.t("live.btn_filter_ts2_title", {}, "Фильтр TS: только TS2 (клик: переключить на оба TS)") : "Фильтр TS: только TS2 (клик: переключить на оба TS)";
      } else {
        cycleImg.src = "/static/img/Bu1+2.png?v=2.9.310";
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

  function resolveLiveMonitorTargetContext() {
    const isMobile = window.innerWidth <= 768;
    const rawHid = window.currentLogHotspotId;
    const effectiveHid = (isMobile && (!rawHid || rawHid === "all"))
      ? (window.activeHotspotId || ((window.currentHotspots || []).find(h => !h.hidden) || {}).id || "default")
      : (rawHid || "all");
    const radiosGrid = document.getElementById("radiosGrid");
    const searchRoot = radiosGrid || document;

    let targetCard = null;
    if (effectiveHid && effectiveHid !== "all") {
      targetCard =
        searchRoot.querySelector(`.radio-container[data-hotspot-id="${effectiveHid}"]:not(.collapsed)`) ||
        searchRoot.querySelector(`.radio-container[data-hotspot-id="${effectiveHid}"]`) ||
        null;
    }
    if (!targetCard && (isMobile || effectiveHid !== "all")) {
      targetCard = searchRoot.querySelector(".radio-container:not(.collapsed)") || null;
    }
    return { isMobile, effectiveHid, radiosGrid, targetCard };
  }

  function syncLiveMonitorPlacement() {
    if (!liveMonitorPanel) return { isMobile: window.innerWidth <= 768, effectiveHid: window.currentLogHotspotId || "all", radiosGrid: null, targetCard: null };
    const ctx = resolveLiveMonitorTargetContext();
    const { radiosGrid, targetCard } = ctx;
    if (!radiosGrid) return ctx;

    if (isLogVisible) {
      if (targetCard && targetCard.parentElement === radiosGrid) {
        if (targetCard.nextElementSibling !== liveMonitorPanel) {
          targetCard.after(liveMonitorPanel);
        }
      } else if (liveMonitorPanel.parentElement !== radiosGrid || radiosGrid.lastElementChild !== liveMonitorPanel) {
        radiosGrid.appendChild(liveMonitorPanel);
      }
    }
    return ctx;
  }

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
    if (visibilityChanged && isLogVisible) {
      pushNavState("drawer", "liveMonitorPanel");
    } else if (!isLogVisible) {
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

    const { isMobile, effectiveHid, targetCard } = syncLiveMonitorPlacement();

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
      if (visibilityChanged || _vNeedsRenderOnShow) {
        _vNeedsRenderOnShow = false;
        renderLogList();
        requestAnimationFrame(() => {
          if (isLogVisible) renderVirtualWindow(false);
        });
      }
    } else {
      cleanupPcCardResizeObserver();
      liveMonitorPanel.classList.remove("pc-height-hotspot");
      liveMonitorPanel.style.removeProperty("--desktop-log-height");
      liveMonitorPanel.style.removeProperty("--mobile-log-height");
      liveMonitorPanel.style.height = "";
      liveMonitorPanel.style.maxHeight = "";
    }

    if (!isMobile) {
      if (typeof window.syncDesktopHotspotsTopAlignment === "function") {
        window.syncDesktopHotspotsTopAlignment();
      }
      if (typeof window.scheduleDesktopHotspotsTopAlignment === "function") {
        window.scheduleDesktopHotspotsTopAlignment();
      }
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
    _vRowHeightMeasured = false;
    _vRenderedStart = -1;
    _vRenderedEnd = -1;
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
        if (typeof window.scheduleDesktopHotspotsTopAlignment === "function") {
          window.scheduleDesktopHotspotsTopAlignment();
        }
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
    // No 24h time cutoff — virtual scroll handles tens of thousands of rows at O(1) DOM cost
    if (heardCalls.length > 50000) {
      heardCalls.splice(50000);
    }
  }

  // Periodic safety-cap check for call log buffer
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
      if (isHistoryNoTsNetwork()) return;
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
        heardCalls = heardCalls.filter(c => String(c.id) !== String(msg.call_id));
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
    if (!msg) return;
    let updated = false;
    heardCalls.forEach(c => {
      const match = (msg.call_id && String(c.id) === String(msg.call_id)) || (!msg.call_id && msg.src_id && c.src_id === msg.src_id);
      if (match) {
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
    91: "Worldwide",
    92: "Europe",
    113: "English WW",
    250: "Russia (General / CIS)",
    2501: "Russia 1 (National)",
    2502: "Moscow & Moscow Region",
    2503: "St. Petersburg & NWFD",
    2504: "Central Federal District",
    2505: "Southern & Caucasus FD",
    2506: "Volga Federal District",
    2507: "Ural Federal District",
    2508: "Siberian Federal District",
    2509: "Far Eastern Federal District",
    25011: "Kaliningrad Oblast",
    25020: "ROSHAM Conference",
    25033: "Leningrad Oblast",
    250601: "Volgograd Oblast",
    250602: "Rostov Oblast",
    250603: "Armenia / Repeater",
    250641: "Krasnodar Krai",
    250647: "Stavropol Krai",
    250907: "Primorsky Krai",
    262: "Germany (National)",
    310: "USA (TAC 310)",
    9990: "Parrot (Echo Test)",
    4000: "Disconnect (Unlink)",
  };
  window.TG_NAMES = window.TG_NAMES;
  window.TGIF_TG_NAMES = window.TGIF_TG_NAMES || {
    777: "TGIF Multi-Lang",
    31665: "TGIF The Mothership",
    9990: "Parrot (Echo Test)",
    4000: "Disconnect (Unlink)"
  };
  window.ADN_TG_NAMES = window.ADN_TG_NAMES || {
    91: "Worldwide",
    92: "Europe",
    250: "Russia National",
    9990: "Parrot (Echo Test)",
    4000: "Disconnect (Unlink)"
  };
  window.FREEDMR_TG_NAMES = window.FREEDMR_TG_NAMES || {};
  window.DMRPLUS_TG_NAMES = window.DMRPLUS_TG_NAMES || {
    4530: "Reflector 4530 RU (Russia / CIS)",
    4001: "Reflector 4001 DL (Germany General)",
    4020: "Reflector 4020 HB9 (Switzerland German)",
    4030: "Reflector 4030 OE (Austria National)",
    4400: "Reflector 4400 UK (United Kingdom Call)",
    4500: "Reflector 4500 EA (Spain National)",
    4700: "Reflector 4700 US (North America)",
    4800: "Reflector 4800 PY (Brazil National)"
  };

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
    const localTgifCache = localStorage.getItem("proxdmr_tgif_tg_names_cache");
    if (localTgifCache) {
      const parsedTgif = JSON.parse(localTgifCache);
      if (parsedTgif && typeof parsedTgif === "object") {
        Object.assign(window.TGIF_TG_NAMES, parsedTgif);
      }
    }
    const localAdnCache = localStorage.getItem("proxdmr_adn_tg_names_cache");
    if (localAdnCache) {
      const parsedAdn = JSON.parse(localAdnCache);
      if (parsedAdn && typeof parsedAdn === "object") {
        Object.assign(window.ADN_TG_NAMES, parsedAdn);
      }
    }
    const localFreeDmrCache = localStorage.getItem("proxdmr_freedmr_tg_names_cache");
    if (localFreeDmrCache) {
      const parsedFdmr = JSON.parse(localFreeDmrCache);
      if (parsedFdmr && typeof parsedFdmr === "object") {
        Object.assign(window.FREEDMR_TG_NAMES, parsedFdmr);
      }
    }
    const localDmrPlusCache = localStorage.getItem("proxdmr_dmrplus_tg_names_cache");
    if (localDmrPlusCache) {
      const parsedDmrp = JSON.parse(localDmrPlusCache);
      if (parsedDmrp && typeof parsedDmrp === "object") {
        Object.assign(window.DMRPLUS_TG_NAMES, parsedDmrp);
      }
    }
  } catch (e) {
    console.warn("Could not load local TG names cache:", e);
  }

  // Fetch updated catalog from backend
  async function syncTgNamesFromServer(networkType = "bm") {
    try {
      const netParam = encodeURIComponent(String(networkType || "bm").toLowerCase());
      const resp = await fetch(`/api/tg/names?network=${netParam}`);
      const data = await resp.json();
      if (data.status === "ok") {
        if (data.names) {
          if (netParam === "adn") {
            Object.assign(window.ADN_TG_NAMES, data.names);
            try { localStorage.setItem("proxdmr_adn_tg_names_cache", JSON.stringify(window.ADN_TG_NAMES)); } catch (_) {}
          } else if (netParam === "freedmr") {
            Object.assign(window.FREEDMR_TG_NAMES, data.names);
            try { localStorage.setItem("proxdmr_freedmr_tg_names_cache", JSON.stringify(window.FREEDMR_TG_NAMES)); } catch (_) {}
          } else if (netParam === "dmrplus") {
            Object.assign(window.DMRPLUS_TG_NAMES, data.names);
            try { localStorage.setItem("proxdmr_dmrplus_tg_names_cache", JSON.stringify(window.DMRPLUS_TG_NAMES)); } catch (_) {}
          } else {
            Object.keys(data.names).forEach(k => {
              const cleaned = getCleanTgDesc(k, data.names[k]);
              if (cleaned) {
                window.TG_NAMES[k] = cleaned;
              } else if (data.names[k]) {
                window.TG_NAMES[k] = data.names[k];
              }
            });
            try { localStorage.setItem("proxdmr_tg_names_cache", JSON.stringify(window.TG_NAMES)); } catch (_) {}
          }
        }
        if (data.tgif_names && typeof data.tgif_names === "object") {
          Object.assign(window.TGIF_TG_NAMES, data.tgif_names);
          try { localStorage.setItem("proxdmr_tgif_tg_names_cache", JSON.stringify(window.TGIF_TG_NAMES)); } catch (_) {}
        }
        if (data.freedmr_names && typeof data.freedmr_names === "object") {
          Object.assign(window.FREEDMR_TG_NAMES, data.freedmr_names);
          try { localStorage.setItem("proxdmr_freedmr_tg_names_cache", JSON.stringify(window.FREEDMR_TG_NAMES)); } catch (_) {}
        }
        if (data.adn_names && typeof data.adn_names === "object") {
          Object.assign(window.ADN_TG_NAMES, data.adn_names);
          try { localStorage.setItem("proxdmr_adn_tg_names_cache", JSON.stringify(window.ADN_TG_NAMES)); } catch (_) {}
        }
        if (data.dmrplus_names && typeof data.dmrplus_names === "object") {
          Object.assign(window.DMRPLUS_TG_NAMES, data.dmrplus_names);
          try { localStorage.setItem("proxdmr_dmrplus_tg_names_cache", JSON.stringify(window.DMRPLUS_TG_NAMES)); } catch (_) {}
        }
        if (typeof data.adn_last_sync_ts === "number" && data.adn_last_sync_ts > 0) {
          try { localStorage.setItem("proxdmr_adn_tg_last_sync_ts", String(data.adn_last_sync_ts)); } catch (_) {}
        }
        if (typeof window.updateTgDisplay === "function") window.updateTgDisplay();
        if (typeof window.renderQuickMemButtons === "function") window.renderQuickMemButtons();
      }
      return data;
    } catch (e) {
      console.debug("Background TG names sync skipped:", e);
      return null;
    }
  }
  window.syncTgNamesFromServer = syncTgNamesFromServer;
  syncTgNamesFromServer();

  function ensureVirtualScaffold() {
    if (!logList) return false;
    if (_vSpacerTop && _vViewport && _vSpacerBottom && _vViewport.parentElement === logList) {
      return true;
    }
    logList.innerHTML = "";
    _vSpacerTop = document.createElement("div");
    _vSpacerTop.className = "log-virtual-spacer log-virtual-spacer-top";
    _vSpacerTop.setAttribute("aria-hidden", "true");
    _vViewport = document.createElement("div");
    _vViewport.className = "log-virtual-viewport";
    _vSpacerBottom = document.createElement("div");
    _vSpacerBottom.className = "log-virtual-spacer log-virtual-spacer-bottom";
    _vSpacerBottom.setAttribute("aria-hidden", "true");
    logList.appendChild(_vSpacerTop);
    logList.appendChild(_vViewport);
    logList.appendChild(_vSpacerBottom);
    return true;
  }

  function buildRowRenderContext() {
    const tFn = (typeof window !== "undefined" && typeof window.t === "function") ? window.t : null;
    const myCall = ((window.radioState && window.radioState.callsign) || (document.getElementById("callsignDisplay") && document.getElementById("callsignDisplay").textContent) || "").trim().toUpperCase();
    const myDmrId = (window.radioState && window.radioState.dmr_id) || "";
    const hotspotsMap = new Map();
    const hsList = window.currentHotspots || [];
    for (let i = 0; i < hsList.length; i++) {
      if (hsList[i] && hsList[i].id != null) {
        hotspotsMap.set(String(hsList[i].id), hsList[i]);
      }
    }
    const recMgr = window.recordingsManager || null;
    return {
      nowSec: Date.now() / 1000,
      isMobile: _vLastMeta.isMobile,
      showHsBadge: (!_vLastMeta.isMobile && window.currentLogHotspotId === "all"),
      hotspotsMap,
      myCall,
      myDmrId: String(myDmrId),
      isMyCall: Boolean(myCall && myCall !== "N0CALL" && myCall !== "---"),
      formatFn: (typeof window !== "undefined" && typeof window.formatHistoryTime === "function")
        ? window.formatHistoryTime
        : (typeof formatHistoryTime === "function" ? formatHistoryTime : null),
      resolveCity: (typeof window !== "undefined" && typeof window.resolveCityName === "function") ? window.resolveCityName : null,
      resolveCountry: (typeof window !== "undefined" && typeof window.resolveCountryDisplayName === "function") ? window.resolveCountryDisplayName : null,
      getNetType: (typeof window !== "undefined" && typeof window.getHotspotNetworkType === "function") ? window.getHotspotNetworkType : null,
      getRawTgName: (typeof window !== "undefined" && typeof window.getNetworkRawTgName === "function") ? window.getNetworkRawTgName : null,
      recMgr,
      activeCallId: recMgr ? recMgr.getActiveCallId() : null,
      selectedIds: (logSelection && logSelection.selectedIds) ? logSelection.selectedIds : null,
      tFn,
      sUnit: tFn ? tFn("live.sec", {}, "с") : "с",
      txTooltip: tFn ? tFn("live.tx_tooltip", {}, "Моя передача (TX)") : "Моя передача (TX)",
      myTxTitle: tFn ? tFn("live.my_tx_title", {}, "Моя передача (TX)") : "Моя передача (TX)",
      aslLinkModeTitle: tFn ? tFn("live.asl_link_mode_tooltip", {}, "Режим линка: приём и передача (RX/TX)") : "Режим линка: приём и передача (RX/TX)",
      tgSpecial91: tFn ? tFn("tg_special.91", {}, "Worldwide") : "Worldwide",
      tgSpecial92: tFn ? tFn("countries.EU", {}, "Europe") : "Europe",
      privateCallLabel: tFn ? tFn("live.private_call", {}, "Личный") : "Личный",
      hasTransTitle: tFn ? tFn("live.has_transcription", {}, "Текст передачи") : "Текст передачи",
      playTooltip: tFn ? tFn("recordings.play_tooltip", {}, "Прослушать запись") : "Прослушать запись",
      timeToggleTooltip: tFn ? tFn("live.time_toggle_tooltip", {}, "Время вызова: нажмите для переключения LOC ↔ UTC") : "Время вызова: нажмите для переключения LOC ↔ UTC"
    };
  }

  function renderSingleLogRowHtml(c, ctx) {
    const isTx = Boolean(c.is_tx);
    const country = getCallCountryInfo(c);
    const flagHtml = isTx
      ? `<span class="tx-mic-icon" title="${ctx.txTooltip}">\u{1F399}\u{FE0F}</span>`
      : getFlagBadgeHtml(country, false, country.flag);
    const isForeign = !isTx && (String(c.src_id) !== ctx.myDmrId);
    const validTa = (c.talker_alias && c.talker_alias.trim()) ? c.talker_alias.trim() : "";
    const isLeakedTa = isForeign && ctx.isMyCall && (validTa.toUpperCase() === ctx.myCall || validTa.toUpperCase().startsWith(ctx.myCall + " "));
    const effectiveTa = isLeakedTa ? "" : validTa;

    const baseCaller = formatCallerDisplay(c.src_callsign, c.src_name, effectiveTa, c.src_id, c.caller_display);
    const callNetType = ctx.getNetType ? ctx.getNetType(c.hotspot_id) : "bm";
    const idStr = String(c.id || "");
    const isAllStarCall = (c.network_type === "allstar" || callNetType === "allstar" || idStr.startsWith("asl_"));
    const isYsfCall = (c.network_type === "ysf" || callNetType === "ysf" || idStr.startsWith("ysf_") || String(c.dst_name || "").startsWith("YSF #"));
    const isM17Call = (c.network_type === "m17" || callNetType === "m17" || idStr.startsWith("m17_"));
    const isDstarCall = (c.network_type === "dstar" || callNetType === "dstar" || idStr.startsWith("dstar_"));
    const isSvxCall = (c.network_type === "svx" || callNetType === "svx" || idStr.startsWith("svx_"));
    const isPrivateCall = !isAllStarCall && !isYsfCall && !isM17Call && !isDstarCall && !isSvxCall && (c.call_type !== "GROUP");
    const isNonMccNet = (callNetType === "tgif" || callNetType === "xlx" || isYsfCall || isM17Call || isDstarCall);
    const tgCountry = (!isPrivateCall && !isNonMccNet && !isAllStarCall) ? getCountryInfo(c.dst_id) : null;

    let isDiffCountry = false;
    let tgFlagHtml = "";
    let tgCountryName = "";
    let tgText = "";
    let tgDisplayHtml = "";
    let tgDesc = "";
    let tgDescHtml = "";
    let tgCellTitle = "";

    const hsKey = String(c.hotspot_id || "default");
    const hsObj = ctx.hotspotsMap.get(hsKey) || null;

    if (isAllStarCall) {
      const targetNode = c.dst_id || (hsObj && hsObj.allstar_node) || (window.radioState && window.radioState.allstar_node) || "1999";
      tgText = `Node ${targetNode}`;
      tgDisplayHtml = `<span class="asl-node-badge-text">Node <strong>${targetNode}</strong></span>`;
      tgDesc = "RX/TX";
      tgDescHtml = `<span class="asl-link-mode-badge" title="${ctx.aslLinkModeTitle}">RX/TX</span>`;
      tgCellTitle = ctx.tFn ? ctx.tFn("live.asl_target_node_title", { node: targetNode }, `Целевой узел: Node ${targetNode} (RX/TX)`) : `Целевой узел: Node ${targetNode} (RX/TX)`;
    } else if (isYsfCall) {
      const ysfRoomId = String(c.dst_id || "25000").trim();
      const ysfRoomName = String(c.dst_name || c.talker_alias || `YSF #${ysfRoomId}`).trim();
      tgText = `#${ysfRoomId}`;
      tgDisplayHtml = `<span class="ysf-room-badge-text">#<strong>${ysfRoomId}</strong></span>`;
      tgDesc = ysfRoomName;
      tgCellTitle = `${ysfRoomName} (#${ysfRoomId})`;
    } else if (isDstarCall || isM17Call) {
      const netLabel = isDstarCall ? "D-STAR" : "M17";
      const refName = String(c.dst_name || (c.dst_id ? `${netLabel} ${c.dst_id}` : netLabel)).trim();
      tgText = refName;
      tgDisplayHtml = `<span class="ysf-room-badge-text"><strong>${refName}</strong></span>`;
      tgDesc = "";
      tgCellTitle = refName;
    } else {
      tgText = isPrivateCall ? `ID ${c.dst_id}` : `${c.dst_id}`;
      tgDisplayHtml = isPrivateCall ? `ID <span class="dmr-id-text">${c.dst_id}</span>` : `${c.dst_id}`;

      if (!isPrivateCall && tgCountry) {
        const callerKey = String(country?.iso || country?.name_en || country?.name || "").trim().toLowerCase();
        const tgKey = String(tgCountry?.iso || tgCountry?.name_en || tgCountry?.name || "").trim().toLowerCase();
        const isTgGlobal = Boolean(tgCountry.iso === "GLOBAL" || tgCountry.flag === "🌐" || tgKey === "global" || tgKey.includes("worldwide"));

        if (isTgGlobal) {
          if (callerKey && callerKey !== "global") isDiffCountry = true;
        } else if (tgKey && tgKey !== "global") {
          if (callerKey !== tgKey) isDiffCountry = true;
        }

        if (isDiffCountry) {
          const locTgCountry = ctx.resolveCountry ? ctx.resolveCountry(tgCountry) : (tgCountry.name || "");
          tgFlagHtml = `<span class="tg-flag" title="${locTgCountry || ''}">${getFlagBadgeHtml(tgCountry, c.dst_id === 9990)}</span>`;
          if (!isTgGlobal && locTgCountry) {
            tgCountryName = locTgCountry;
          } else if (c.dst_id === 91) {
            tgCountryName = ctx.tgSpecial91;
          } else if (c.dst_id === 92) {
            tgCountryName = ctx.tgSpecial92;
          }
        }
      }

      if (!isPrivateCall) {
        const netRaw = ctx.getRawTgName
          ? ctx.getRawTgName(c.dst_id, callNetType)
          : ((typeof window.TG_NAMES !== "undefined" && window.TG_NAMES[c.dst_id]) || "");
        const rawName = netRaw || c.talkgroup_name || c.dst_name || "";
        let cleaned = "";
        if (rawName || isNonMccNet) {
          cleaned = typeof getCleanTgDesc === "function" ? getCleanTgDesc(c.dst_id, rawName, null, callNetType) : rawName;
        }

        if (isDiffCountry) {
          if (tgCountryName) {
            if (cleaned) {
              const lowerCleaned = cleaned.toLowerCase();
              const lowerCountry = tgCountryName.toLowerCase();
              tgDesc = (lowerCleaned.startsWith(lowerCountry) || lowerCleaned.includes(lowerCountry))
                ? cleaned
                : `${tgCountryName} ${cleaned}`;
            } else {
              tgDesc = tgCountryName;
            }
          } else {
            tgDesc = cleaned;
          }
        } else if (cleaned) {
          const shortDesc = isNonMccNet ? cleaned : cleaned.split(/[\(\/]/)[0].trim();
          tgDesc = shortDesc || cleaned;
        }
      } else {
        const userObj = (typeof USER_CALLSIGNS !== "undefined" && USER_CALLSIGNS[c.dst_id]) || null;
        if (userObj && (userObj.callsign || userObj.name)) {
          tgDesc = `${userObj.callsign || ''} ${userObj.name || ''}`.trim();
        } else {
          tgDesc = ctx.privateCallLabel;
        }
      }

      const tgCountryDisp = tgCountry
        ? (ctx.resolveCountry ? ctx.resolveCountry(tgCountry) : (tgCountry.name || ""))
        : "";
      tgDescHtml = tgDesc ? `<span class="tg-desc-text" title="${tgDesc}">${tgDesc}</span>` : "";
      tgCellTitle = `${tgText}${isDiffCountry && tgCountryDisp ? ' [' + tgCountryDisp + ']' : ''}${tgDesc ? ' — ' + tgDesc : ''}`;
    }

    const activeClass = c.active ? (isTx ? " active-call active-tx-call" : " active-call") : "";
    const txRowClass = isTx ? " is-tx-row" : "";
    const timeStr = ctx.formatFn
      ? ctx.formatFn(c.timestamp || ctx.nowSec)
      : (c.time_str || (new Date((c.timestamp || ctx.nowSec) * 1000)).toTimeString().substring(0, 8));
    const elapsed = Math.max(0, ctx.nowSec - (c.timestamp || ctx.nowSec)).toFixed(1);
    const durStr = c.active
      ? `<span class="live-duration-tick duration-active" data-start="${c.timestamp}">🔴 ${elapsed}${ctx.sUnit}</span>`
      : `<span class="duration-text" style="color: #ffffff;">${c.duration ? c.duration + ctx.sUnit : '—'}</span>`;

    const rawCityStr = (c.city || "").trim();
    const locCity = (rawCityStr && ctx.resolveCity) ? ctx.resolveCity(rawCityStr) : rawCityStr;
    const locCountry = ctx.resolveCountry ? ctx.resolveCountry(country) : (country?.name || "");
    const locationInfo = (isTx && !isAllStarCall) ? "" : (locCity ? (locCountry ? `${locCity}, ${locCountry}` : locCity) : locCountry);
    const plainTitle = `${(isTx ? '[TX] ' : '')}${baseCaller.replace(/<[^>]+>/g, '')}${locationInfo ? ' - ' + locationInfo : ''}`;

    const hsBadge = (ctx.showHsBadge && hsObj)
      ? `<span class="log-hs-badge" title="${hsObj.name}">${hsObj.name}</span>`
      : "";

    let callerNameLine = "";
    if (effectiveTa) {
      callerNameLine = effectiveTa.replace(/\s*\(\s*\d{3,8}\s*\)$/, "").trim();
    } else if (c.src_callsign && c.src_callsign.trim() && c.src_callsign !== "---" && !c.src_callsign.startsWith("ID:")) {
      const call = c.src_callsign.trim().toUpperCase();
      const cName = typeof cleanName === "function" ? cleanName(c.src_name) : (c.src_name || "").trim();
      callerNameLine = (cName && cName.toUpperCase() !== call) ? `${call} ${cName}` : call;
    } else if (c.caller_display && c.caller_display.trim() && c.caller_display !== "---") {
      const raw = c.caller_display.replace(/<[^>]+>/g, "").trim();
      const mParen = raw.match(/^(.*?)\s*\(\s*(\d{3,8})\s*\)$/);
      callerNameLine = mParen ? mParen[1].trim() : raw;
    }
    if (!callerNameLine || (isForeign && ctx.isMyCall && callerNameLine.toUpperCase() === ctx.myCall)) {
      if (c.src_callsign && c.src_callsign.trim() && c.src_callsign !== "---" && !c.src_callsign.startsWith("ID:")) {
        const call = c.src_callsign.trim().toUpperCase();
        const cName = typeof cleanName === "function" ? cleanName(c.src_name) : (c.src_name || "").trim();
        callerNameLine = (cName && cName.toUpperCase() !== call) ? `${call} ${cName}` : call;
      } else {
        callerNameLine = c.src_id ? `ID: ${c.src_id}` : "---";
      }
    }

    if (isAllStarCall && callerNameLine) {
      callerNameLine = callerNameLine.replace(/^[\uD83C-\uDBFF\uDC00-\uDFFF\u2600-\u27BF\uFE00-\uFE0F\s]+/, '').trim();
    }

    const validId = c.src_id && String(c.src_id) !== "0" && String(c.src_id) !== "---" ? String(c.src_id) : "";
    let stationSubHtml = "";
    if (isAllStarCall) {
      const nodeStr = validId ? `<span class="asl-station-node">#${validId}</span>` : "";
      const locDetail = locCity || (locCountry && locCountry !== "Unknown" ? locCountry : "");
      const locSpan = locDetail ? `<span class="station-country">(${locDetail})</span>` : "";
      stationSubHtml = [nodeStr, locSpan].filter(Boolean).join(" ");
    } else {
      const dmrIdHtml = validId ? `<span class="dmr-id-text">${validId}</span>` : "";
      const locText = locationInfo ? `<span class="station-country">(${locationInfo})</span>` : "";
      stationSubHtml = [dmrIdHtml, locText].filter(Boolean).join(" ");
    }

    const srcType = c.source_type || 'VoIP';
    const slotHtml = isAllStarCall
      ? `<span class="asl-cell-badge asl-cell-badge-${srcType.toLowerCase()}" title="${ctx.tFn ? ctx.tFn("live.asl_source_type_tooltip", { type: srcType }, `Источник вызова: ${srcType}`) : `Источник вызова: ${srcType}`}">${srcType}</span>`
      : (isYsfCall
        ? `<span class="ysf-cell-badge" title="C4FM / YSF">C4FM</span>`
        : (isDstarCall
          ? `<span class="ysf-cell-badge" title="D-STAR">D-STAR</span>`
          : (isM17Call
            ? `<span class="ysf-cell-badge" title="M17">M17</span>`
            : (isSvxCall
              ? `<span class="ysf-cell-badge" title="SVXReflector">SVX</span>`
              : `<span class="slot-text-ts${c.slot}">TS${c.slot}</span>`))));

    const hasTranscription = Boolean(c.transcription && c.transcription.trim());
    const flagClass = hasTranscription ? "station-flag has-transcription" : "station-flag";
    const transMarkerHtml = hasTranscription
      ? `<span class="log-text-marker" data-call-id="${c.id}" title="${ctx.hasTransTitle}"></span>`
      : "";

    const hasRec = Boolean(ctx.recMgr && ctx.recMgr.hasRecording(c.id));
    const isCurPlaying = Boolean(ctx.recMgr && ctx.recMgr.isPlayingCall(c.id));
    const isCurRecRow = Boolean(ctx.activeCallId && String(ctx.activeCallId) === idStr);
    const recRowClass = isCurRecRow ? " is-playing-rec" : "";
    const selRowClass = (ctx.selectedIds && ctx.selectedIds.has(idStr)) ? " is-selected" : "";
    const playBtnHtml = hasRec ? `<button type="button" class="log-play-btn${isCurPlaying ? ' playing' : ''}" data-call-id="${c.id}" title="${ctx.playTooltip}"><img src="/static/img/Log_PLAY.png" class="log-play-img" alt="Play"></button>` : '';
    const tgLinkTitle = isAllStarCall
      ? (ctx.tFn ? ctx.tFn("live.asl_node_title", { node: c.dst_id }, `Node ${c.dst_id}`) : `Node ${c.dst_id}`)
      : (isYsfCall
        ? (ctx.tFn ? ctx.tFn("live.tune_ysf_title", { room: tgText }, `Перейти в комнату ${tgText}`) : `Перейти в комнату ${tgText}`)
        : (ctx.tFn ? ctx.tFn("live.tune_title", { tg: tgText, slot: c.slot }) : `Tune to ${tgText} (TS${c.slot})`));

    return `<div class="live-call-row${txRowClass}${activeClass}${recRowClass}${selRowClass}" data-id="${c.id}" data-hid="${hsKey}" data-net="${callNetType}"><div class="live-row-desktop"><div class="cell-station" title="${plainTitle}" data-radio-id="${c.src_id}" data-callsign="${c.src_callsign || ''}" data-name="${c.src_name || ''}"><span class="${flagClass}" data-call-id="${c.id}" title="${isTx ? ctx.myTxTitle : locCountry}">${flagHtml}</span>${transMarkerHtml}<div class="station-text-wrap" data-radio-id="${c.src_id}"><div class="station-name-line">${isTx ? '<span class="log-tx-badge">TX</span>' : ''}${callerNameLine}${hsBadge}</div><div class="station-sub-line">${stationSubHtml}</div></div></div><div class="cell-tg" title="${tgCellTitle}"><div class="tg-line-top"><span class="tg-plain-link btn-quick-tune-tg ${isAllStarCall ? 'is-asl-node' : (isYsfCall ? 'is-ysf-room' : (isPrivateCall ? 'is-id' : 'is-tg'))}" data-tg="${c.dst_id}" data-slot="${c.slot}" data-hid="${hsKey}" title="${tgLinkTitle}">${tgDisplayHtml}</span>${tgFlagHtml}</div><div class="tg-line-sub">${tgDescHtml || '<span class="tg-desc-none">—</span>'}</div></div><div class="cell-slot">${slotHtml}</div><div class="cell-play">${playBtnHtml}</div><div class="cell-duration"><div class="dur-line-top" style="color: #ffffff;">${durStr}</div><div class="dur-line-sub" title="${ctx.timeToggleTooltip}">${timeStr}</div></div></div></div>`;
  }

  function renderVirtualWindow(force = false) {
    if (!logList || !isLogVisible) return;
    const total = _filteredLogCalls.length;
    if (total === 0) return;
    if (!ensureVirtualScaffold()) return;

    const rowH = _vRowHeight > 16 ? _vRowHeight : 35;
    const scrollTop = Math.max(0, logList.scrollTop || 0);
    const viewH = logList.clientHeight || 600;
    const visStart = Math.max(0, Math.floor(scrollTop / rowH));
    const visEnd = Math.min(total, Math.ceil((scrollTop + viewH) / rowH));

    if (!force && _vRenderedStart >= 0 && _vRenderedEnd >= 0) {
      const safeTop = Math.max(0, visStart - V_REUSE_MARGIN);
      const safeBottom = Math.min(total, visEnd + V_REUSE_MARGIN);
      if (_vRenderedStart <= safeTop && _vRenderedEnd >= safeBottom) {
        return;
      }
    }

    let startIdx = Math.max(0, visStart - V_OVERSCAN);
    // Keep startIdx even so CSS :nth-child(even) zebra striping never flickers while scrolling
    startIdx = startIdx & ~1;
    const endIdx = Math.min(total, visEnd + V_OVERSCAN);

    const ctx = buildRowRenderContext();
    const parts = new Array(endIdx - startIdx);
    for (let i = startIdx; i < endIdx; i++) {
      parts[i - startIdx] = renderSingleLogRowHtml(_filteredLogCalls[i], ctx);
    }

    _vSpacerTop.style.height = `${Math.round(startIdx * rowH)}px`;
    _vSpacerBottom.style.height = `${Math.round(Math.max(0, total - endIdx) * rowH)}px`;
    _vViewport.innerHTML = parts.join("");
    _vRenderedStart = startIdx;
    _vRenderedEnd = endIdx;

    // Measure actual CSS row height once per viewport layout so scroll geometry is pixel-exact
    if (!_vRowHeightMeasured && _vViewport.firstElementChild) {
      const rect = _vViewport.firstElementChild.getBoundingClientRect();
      const measured = rect && rect.height ? rect.height : 0;
      if (measured >= 20 && measured <= 120) {
        _vRowHeightMeasured = true;
        if (Math.abs(measured - _vRowHeight) > 0.25) {
          const oldRowH = _vRowHeight;
          const wasPinnedBottom = _vLastMeta.isAsc && (logList.scrollHeight - logList.scrollTop <= (logList.clientHeight || 600) + 60);
          _vRowHeight = measured;
          _vSpacerTop.style.height = `${Math.round(startIdx * _vRowHeight)}px`;
          _vSpacerBottom.style.height = `${Math.round(Math.max(0, total - endIdx) * _vRowHeight)}px`;
          if (wasPinnedBottom) {
            logList.scrollTop = Math.max(0, total * _vRowHeight - (logList.clientHeight || 600));
          } else if (scrollTop > 0) {
            logList.scrollTop = Math.max(0, Math.round(scrollTop * (_vRowHeight / oldRowH)));
          }
        }
      }
    }
  }

  function scrollToLogCallId(callId, opts = null) {
    if (!logList || !callId || !isLogVisible) return null;
    const strId = String(callId);
    const idx = _filteredLogCalls.findIndex(c => String(c.id) === strId);
    if (idx === -1) return null;

    const rowH = _vRowHeight > 16 ? _vRowHeight : 35;
    const viewH = logList.clientHeight || 400;
    const rowTop = idx * rowH;
    const rowBottom = rowTop + rowH;
    const curTop = logList.scrollTop || 0;
    const curBottom = curTop + viewH;
    const align = (opts && opts.align) || "nearest";

    if (align === "center") {
      logList.scrollTop = Math.max(0, Math.round(rowTop - (viewH - rowH) / 2));
    } else if (rowTop < curTop) {
      logList.scrollTop = Math.max(0, Math.round(rowTop - rowH));
    } else if (rowBottom > curBottom) {
      logList.scrollTop = Math.max(0, Math.round(rowBottom - viewH + rowH));
    }

    renderVirtualWindow(true);
    const escId = (typeof CSS !== "undefined" && typeof CSS.escape === "function")
      ? CSS.escape(strId)
      : strId.replace(/["\\]/g, "\\$&");
    return logList.querySelector(`.live-call-row[data-id="${escId}"]`);
  }

  function initLogVirtualScroll() {
    if (!logList || logList._virtualScrollWired) return;
    logList._virtualScrollWired = true;
    logList.style.overflowAnchor = "none";

    logList.addEventListener("scroll", () => {
      if (_vScrollRaf) return;
      _vScrollRaf = requestAnimationFrame(() => {
        _vScrollRaf = null;
        renderVirtualWindow(false);
        const pop = document.getElementById("logTranscriptionPopover");
        if (pop && pop.classList.contains("is-visible") && logTableScrollWrap) {
          logTableScrollWrap.dispatchEvent(new Event("scroll"));
        }
      });
    }, { passive: true });

    // Single delegated click handler for Play and Quick-Tune TG (0 per-row listener overhead!)
    logList.addEventListener("click", (e) => {
      const playBtn = e.target && e.target.closest ? e.target.closest(".log-play-btn") : null;
      if (playBtn) {
        e.stopPropagation();
        const cid = playBtn.dataset.callId;
        if (window.recordingsManager && cid) {
          window.recordingsManager.playByCallId(cid);
        }
        return;
      }

      const tuneBtn = e.target && e.target.closest ? e.target.closest(".btn-quick-tune-tg") : null;
      if (tuneBtn) {
        if (window.__proxdmr_log_swipe_active) return;
        e.stopPropagation();
        const tg = parseInt(tuneBtn.dataset.tg, 10);
        const slot = parseInt(tuneBtn.dataset.slot, 10);
        const hid = tuneBtn.dataset.hid;
        if (hid && typeof window.switchActiveHotspot === "function") window.switchActiveHotspot(hid);
        if (tuneBtn.classList.contains("is-asl-node")) return;
        if (tuneBtn.classList.contains("is-ysf-room")) {
          if (tg > 0 && typeof window.connectYsfRoomById === "function") {
            const card = hid ? document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`) : null;
            window.connectYsfRoomById(String(tg), `YSF #${tg}`, card);
          }
          return;
        }
        if (tg > 0) {
          if (slot === 1 || slot === 2) {
            if (typeof window.setActiveSlot === "function") window.setActiveSlot(slot, true);
          }
          if (typeof window.setTg === "function") window.setTg(tg, true);
        }
      }
    });

    if (typeof window !== "undefined" && typeof window.ResizeObserver === "function") {
      _vResizeObserver = new ResizeObserver(() => {
        if (!isLogVisible) return;
        if (_vScrollRaf) cancelAnimationFrame(_vScrollRaf);
        _vScrollRaf = requestAnimationFrame(() => {
          _vScrollRaf = null;
          renderVirtualWindow(false);
        });
      });
      _vResizeObserver.observe(logList);
    }
  }

  function renderLogList() {
    if (!logList) return;
    const isMobile = window.innerWidth <= 768;
    const effectiveHid = (isMobile && (!window.currentLogHotspotId || window.currentLogHotspotId === "all"))
      ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
      : (window.currentLogHotspotId || "all");

    const totalHs = (window.currentHotspots || []).length;
    const resolveHid = typeof window.resolveHotspotId === "function" ? window.resolveHotspotId : (h => h || "default");
    const effResolved = resolveHid(effectiveHid);

    const curHsObj = (window.currentHotspots || []).find(h => h.id === effectiveHid);
    const curNetType = (curHsObj?.network_type || "").toLowerCase();
    const isAslSelected = (effectiveHid !== "all") && (curNetType === "allstar");
    const isYsfSelected = (effectiveHid !== "all") && (curNetType === "ysf");
    const isM17Selected = (effectiveHid !== "all") && (curNetType === "m17");
    const isNoTsNetwork = isAslSelected || isYsfSelected || isM17Selected;

    if (isNoTsNetwork) {
      logFilter = "all";
    }

    if (liveMonitorPanel) {
      liveMonitorPanel.classList.toggle("is-no-ts-network", isNoTsNetwork);
    }

    // Dynamic headers and controls for AllStar vs YSF vs DMR
    const colStationEl = document.querySelector(".live-table-header .col-station");
    const colTgEl = document.querySelector(".live-table-header .col-tg");
    const colSlotEl = document.querySelector(".live-table-header .col-slot");
    const tsCycleBtn = document.getElementById("logFilterTsCycleBtn");

    if (colStationEl) {
      colStationEl.textContent = isAslSelected
        ? (window.t ? window.t("live.col_asl_station", {}, "ОПЕРАТОР / УЗЕЛ") : "ОПЕРАТОР / УЗЕЛ")
        : (isYsfSelected
          ? (window.t ? window.t("live.col_ysf_station", {}, "ОПЕРАТОР / ПОЗЫВНОЙ") : "ОПЕРАТОР / ПОЗЫВНОЙ")
          : (window.t ? window.t("live.col_station", {}, "Оператор / DMR ID") : "Оператор / DMR ID"));
    }
    if (colTgEl) {
      colTgEl.textContent = isAslSelected
        ? (window.t ? window.t("live.col_asl_target", {}, "ЦЕЛЕВОЙ УЗЕЛ") : "ЦЕЛЕВОЙ УЗЕЛ")
        : (isYsfSelected
          ? (window.t ? window.t("live.col_ysf_target", {}, "КОМНАТА") : "КОМНАТА")
          : (window.t ? window.t("live.col_tg", {}, "Группа") : "Группа"));
    }
    if (colSlotEl) {
      colSlotEl.textContent = isAslSelected
        ? (window.t ? window.t("live.col_asl_type", {}, "ТИП") : "ТИП")
        : (isYsfSelected
          ? (window.t ? window.t("live.col_ysf_mode", {}, "ТИП") : "ТИП")
          : (window.t ? window.t("live.col_slot", {}, "Слот") : "Слот"));
    }
    if (tsCycleBtn) {
      if (isNoTsNetwork) {
        tsCycleBtn.classList.add("hidden");
        tsCycleBtn.style.setProperty("display", "none", "important");
      } else {
        tsCycleBtn.classList.remove("hidden");
        tsCycleBtn.style.removeProperty("display");
      }
    }

    if (typeof window.getLogSortOrderForHotspot === "function") {
      const savedOrder = window.getLogSortOrderForHotspot(effectiveHid);
      if (window.__proxdmrLogSortOrder !== savedOrder) {
        window.__proxdmrLogSortOrder = savedOrder;
        if (window.recordingsManager && typeof window.recordingsManager.updateSortUI === "function") {
          window.recordingsManager.updateSortUI();
        }
      }
    }

    const txWord = (logSearchQuery && typeof window !== "undefined" && window.t)
      ? String(window.t("live.tx_search_word", {}, "tx")).toLowerCase()
      : "tx";

    const filtered = heardCalls.filter(c => {
      if (totalHs > 1 && (isMobile || effectiveHid !== "all")) {
        const callHidResolved = resolveHid(c.hotspot_id);
        if (callHidResolved !== effResolved) return false;
      }
      if (!isNoTsNetwork && logFilter !== "all" && c.slot.toString() !== logFilter) return false;
      if (logSearchQuery) {
        const isTxMatch = c.is_tx && (logSearchQuery === "tx" || "передача".includes(logSearchQuery) || (txWord && txWord.includes(logSearchQuery)));
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

    const isAsc = (window.__proxdmrLogSortOrder === "asc");
    const prevLen = _filteredLogCalls.length;
    const prevFirstId = prevLen > 0 ? String(_filteredLogCalls[0].id) : "";
    const prevScrollTop = logList.scrollTop || 0;
    const wasAtBottom = (logList.scrollHeight - prevScrollTop <= (logList.clientHeight || 600) + 50);

    if (isAsc) {
      filtered.reverse();
    }

    _filteredLogCalls = filtered;
    _vLastMeta = { isMobile, effectiveHid, isAsc };

    if (logCountBadge) logCountBadge.textContent = filtered.length;

    // When History panel is closed, skip DOM work completely (0ms cost during background calls)
    if (!isLogVisible) {
      _vNeedsRenderOnShow = true;
      return;
    }

    if (filtered.length === 0) {
      let emptyMsg = window.t ? window.t("live.empty_waiting") : "Ожидание активности в сети BM...";
      if (logSearchQuery) {
        emptyMsg = window.t ? window.t("live.empty_not_found") : "Ничего не найдено по запросу";
      } else if (isMobile || effectiveHid !== "all") {
        const hsObj = (window.currentHotspots || []).find(h => h.id === effectiveHid);
        emptyMsg = window.t ? window.t("live.empty_hotspot", { name: hsObj ? hsObj.name : "хотспоте" }) : `Ожидание активности на ${hsObj ? hsObj.name : "хотспоте"}...`;
      }
      _vSpacerTop = null;
      _vViewport = null;
      _vSpacerBottom = null;
      _vRenderedStart = -1;
      _vRenderedEnd = -1;
      logList.innerHTML = `<div class="log-empty-msg">${emptyMsg}</div>`;
      return;
    }

    const curViewKey = `${effectiveHid}|${logFilter}|${logSearchQuery}|${isAsc ? "asc" : "desc"}`;
    const viewChanged = (curViewKey !== _lastLogViewKey);
    _lastLogViewKey = curViewKey;

    const rowH = _vRowHeight > 16 ? _vRowHeight : 35;
    const newTotalH = filtered.length * rowH;
    const viewH = logList.clientHeight || 600;
    const newFirstId = String(filtered[0].id);

    ensureVirtualScaffold();

    if (viewChanged) {
      _vSpacerTop.style.height = "0px";
      _vSpacerBottom.style.height = `${Math.round(newTotalH)}px`;
      logList.scrollTop = isAsc ? Math.max(0, Math.round(newTotalH - viewH)) : 0;
    } else if (isAsc) {
      if (wasAtBottom || prevLen === 0) {
        _vSpacerBottom.style.height = `${Math.round(newTotalH)}px`;
        logList.scrollTop = Math.max(0, Math.round(newTotalH - viewH));
      }
    } else {
      // desc (newest at top): preserve visual anchor if user scrolled down to read history
      const addedCount = filtered.length - prevLen;
      if (prevScrollTop > 8 && addedCount > 0 && prevFirstId && newFirstId !== prevFirstId) {
        logList.scrollTop = Math.max(0, Math.round(prevScrollTop + addedCount * rowH));
      }
    }

    renderVirtualWindow(true);

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
window.getFilteredLogCalls = () => _filteredLogCalls;
window.getFilteredLogCallIds = () => _filteredLogCalls.map(c => String(c.id));
window.scrollToLogCallId = scrollToLogCallId;

initLogVirtualScroll();
initLogSwipe();
logSelection.init();
window.syncLiveMonitorPlacement = syncLiveMonitorPlacement;
window.updateLogVisibility = updateLogVisibility;
window.syncLogFilterUI = syncLogFilterUI;
window.renderLogHotspotTabs = renderLogHotspotTabs;
window.pruneHeardCalls = pruneHeardCalls;
window.handleLogHeightOnFullscreenOrResize = handleLogHeightOnFullscreenOrResize;
window.handleFullscreenOrResize = handleFullscreenOrResize;
window.__proxdmr = window.__proxdmr || {};
window.__proxdmr.syncLiveMonitorPlacement = syncLiveMonitorPlacement;
window.__proxdmr.addOrUpdateCall = addOrUpdateCall;
window.__proxdmr.endCall = endCall;
window.__proxdmr.resolveCaller = resolveCaller;
window.__proxdmr.renderLogList = renderLogList;
window.__proxdmr.getFilteredLogCalls = window.getFilteredLogCalls;
window.__proxdmr.getFilteredLogCallIds = window.getFilteredLogCallIds;
window.__proxdmr.scrollToLogCallId = scrollToLogCallId;
window.__proxdmr.getHeardCalls = () => heardCalls;
window.__proxdmr.setHeardCalls = (c) => { heardCalls = Array.isArray(c) ? c : []; renderLogList(); };
window.__proxdmr.clearHeardCalls = () => { heardCalls = []; renderLogList(); };
window.addOrUpdateCall = addOrUpdateCall;
window.endCall = endCall;
window.resolveCaller = resolveCaller;
Object.defineProperty(window, 'isTranscriptionSummaryOpen', { get: () => isTranscriptionSummaryOpen, set: (v) => isTranscriptionSummaryOpen = v, configurable: true });
window.handleCardLogClick = handleCardLogClick;

// Delegated click handler for Log Drawer / History button across all cards and static elements
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-log-drawer");
    if (!btn) return;
    e.stopPropagation();
    const card = btn.closest(".radio-container");
    const cid = card ? (card.dataset.hotspotId || (typeof window !== "undefined" && window.activeHotspotId) || "default") : ((typeof window !== "undefined" && window.activeHotspotId) || "default");
    if (typeof window !== "undefined" && typeof window.handleCardLogClick === "function") {
      window.handleCardLogClick(cid);
    }
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("languageChanged", () => {
    if (typeof renderLogHotspotTabs === "function") renderLogHotspotTabs();
    if (typeof syncLogFilterUI === "function") syncLogFilterUI();
    if (typeof updateLogVisibility === "function") updateLogVisibility(false);
    if (typeof renderLogList === "function") renderLogList();
  });
}
