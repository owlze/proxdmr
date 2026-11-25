/**
 * ProxDMR - Hotspots Management Subsystem (modules/dmr/hotspots.js)
 * Manages multi-hotspot configuration, DOM radio card creation and rendering,
 * hotspot switching, BrandMeister master server dropdowns, and hotspot settings forms.
 */

import { safeEscapeHtml, escapeHtml, isoToEmoji, getLocalizedCountryName, getCountryInfo, getFlagBadgeHtml, getCleanTgDesc, getHotspotNetworkType } from '../core/formatters.js?v=2.9.787';
import { showToast } from '../core/toast.js?v=2.9.699';
import { pushNavState, notifyNavClosed } from '../ui/navigation.js?v=2.9.614';
import { openBmBenchmarkModal } from './bm-benchmark.js?v=2.9.826';
import { openBmTgStaticModal, dropDynamicTGs } from './bm-static-manager.js?v=2.9.798';
import {
  cycleHotspotPan,
  focusHotspotTsAudio,
  toggleHotspotMute,
  toggleHotspotAutoRecord,
  setupMutePanButtonEvents,
  updateCardMuteUI,
  updateCardPanUI,
  updateCardTsAudioModeUI,
  updateCardRecUI,
  updateAllHotspotRecUI
} from '../audio/routing.js?v=2.9.792';
import {
  setupSlotLongPress,
  setupSlotTranscribeClick,
  setupSlotTtsClick,
  updateSlotLangBadge,
  updateSlotTtsBadge,
  isSlotTranscribeActive,
  isSlotTtsActive,
  syncCardSlotTranscribeUI,
  syncAllTranscribeSlotsToServer,
  disableHotspotTranscribe,
  setupCaptionBoxLongPress,
  ensureCaptionFontControls,
  setupCaptionBoxPinchZoom
} from './transcriber.js?v=2.9.821';
import {
  startTransmission,
  stopTransmission,
  blinkPttLocked,
  isPttLocked,
  togglePttLock,
  updatePttLockUI,
  openTotConfigModal,
  getHotspotPttMode,
  checkPttConnectionStatus,
  notifyPttConnectionBlocked
} from '../ptt/engine.js?v=2.9.792';
import { wireCardStatusInteractions, renderHotspotAuxStatusBadge, checkBmApiStatus, updateHotspotGwStatus, triggerHotspotGwAction, isHotspotGwDisconnected } from '../network/watchdog.js?v=2.9.765';

const isYsfOnlineStatus = (status) => {
  const u = String(status || "").trim().toUpperCase();
  return Boolean(u && u !== "STANDBY" && u !== "DISCONNECTED" && u !== "OFFLINE" && u !== "ERROR" && u !== "AUTH_FAILED");
};
import { getDmrNetworkProfile, getNetworkServersList, renderNetworkBadgeElement, updateCardNetworkBadge, refreshFreeDmrServers, refreshAdnServers, refreshDmrPlusServers, refreshYsfServers, refreshM17Servers, refreshDstarServers, refreshSvxServers, sortServersForDropdown, getBmServerInfo, resolveCardMasterInfo } from './bm-banner.js?v=2.9.826';
import { getServerCollectionValue, hasServerCollectionKey, setServerCollectionKey, deleteServerCollectionKey } from '../settings/sync.js?v=2.9.826';
import { checkServerApkUpdate, updateApkUpdateUI } from '../core/updater.js?v=2.9.711';
import { showLongPressEffect } from '../ui/long-press.js?v=2.9.711';

// Accessors for app functions and state
const resolveHotspotId = (id) => (window.resolveHotspotId ? window.resolveHotspotId(id) : id);
const isHotspotCollapsed = (id) => (window.isHotspotCollapsed ? window.isHotspotCollapsed(id) : false);
const isHotspotLiveCollapsed = (id) => (window.isHotspotLiveCollapsed ? window.isHotspotLiveCollapsed(id) : false);
const updateBmStatus = (st, dt, hid) => { if (window.updateBmStatus) window.updateBmStatus(st, dt, hid); };
const updateCardBmBanner = (card, hs) => { if (window.updateCardBmBanner) window.updateCardBmBanner(card, hs); };
const refreshAllCardsBmBanner = () => { if (window.refreshAllCardsBmBanner) window.refreshAllCardsBmBanner(); };
const updateCardTgDisplay = (card) => { if (window.updateCardTgDisplay) window.updateCardTgDisplay(card); };
const updateTgDisplay = () => { if (window.updateTgDisplay) window.updateTgDisplay(); };
const getHotspotVolume = (cid) => (window.getHotspotVolume ? window.getHotspotVolume(cid) : 100);
const setHotspotVolume = (cid, v) => { if (window.setHotspotVolume) window.setHotspotVolume(cid, v); };
const getHotspotAgc = (cid) => (window.getHotspotAgc ? window.getHotspotAgc(cid) : false);
const setHotspotAgc = (cid, v) => { if (window.setHotspotAgc) window.setHotspotAgc(cid, v); };
const getHotspotLoop = (cid) => (window.getHotspotLoop ? window.getHotspotLoop(cid) : false);
const setHotspotLoop = (cid, v) => { if (window.setHotspotLoop) window.setHotspotLoop(cid, v); };
const setHotspotAudioMute = (cid, v) => { if (window.setHotspotAudioMute) window.setHotspotAudioMute(cid, v); };
const updateHotspotVolumeAndMuteUI = (cid) => { if (window.updateHotspotVolumeAndMuteUI) window.updateHotspotVolumeAndMuteUI(cid); };
const getHotspotTg = (cid, s) => (window.getHotspotTg ? window.getHotspotTg(cid, s) : 91);
const setHotspotTg = (cid, s, tg, n) => { if (window.setHotspotTg) window.setHotspotTg(cid, s, tg, n); };
const getHotspotPttTarget = (cid) => (window.getHotspotPttTarget ? window.getHotspotPttTarget(cid) : { id: 2501, type: "TG" });
const setHotspotPttTarget = (cid, tid, type) => { if (window.setHotspotPttTarget) window.setHotspotPttTarget(cid, tid, type); };
const getHotspotSlot = (cid) => (window.getHotspotSlot ? window.getHotspotSlot(cid) : 2);
const setCardSlot = (c, s, n) => { if (window.setCardSlot) window.setCardSlot(c, s, n); };
const updateCardPttHint = (c) => { if (window.updateCardPttHint) window.updateCardPttHint(c); };
const updateCardPttHintForSlot = (c, s) => { if (window.updateCardPttHintForSlot) window.updateCardPttHintForSlot(c, s); };
const openCallIdModal = (...args) => { if (window.openCallIdModal) window.openCallIdModal(...args); };
const openMyContactsModal = (...args) => { if (window.openMyContactsModal) window.openMyContactsModal(...args); };
const openSearchTgIdModal = (...args) => { if (window.openSearchTgIdModal) window.openSearchTgIdModal(...args); };
const openTgTxUseModal = (...args) => { if (window.openTgTxUseModal) window.openTgTxUseModal(...args); };
const selectHotspotTargetId = (cid, hname) => { if (window.selectHotspotTargetId) window.selectHotspotTargetId(cid, hname); };
const handleCardLogClick = (e, cid) => { if (window.handleCardLogClick) window.handleCardLogClick(e, cid); };
const handleMuteButtonClick = (...args) => { if (window.handleMuteButtonClick) window.handleMuteButtonClick(...args); };
const handleMuteButtonDblClick = (...args) => { if (window.handleMuteButtonDblClick) window.handleMuteButtonDblClick(...args); };
const handleOfflineTranscribeClick = (e, btn, cid) => { if (window.handleOfflineTranscribeClick) window.handleOfflineTranscribeClick(e, btn, cid); };
const toggleHotspotCollapse = (cid) => { if (window.toggleHotspotCollapse) window.toggleHotspotCollapse(cid); };
const collapseHotspot = (...args) => { if (window.collapseHotspot) window.collapseHotspot(...args); };
const expandHotspot = (cid) => { if (window.expandHotspot) window.expandHotspot(cid); };
const resetHotspot = (cid) => { if (window.resetHotspot) window.resetHotspot(cid); };
const renderLogHotspotTabs = () => { if (window.renderLogHotspotTabs) window.renderLogHotspotTabs(); };
const ensureValidContactsGateway = (hs) => { if (window.ensureValidContactsGateway) window.ensureValidContactsGateway(hs); };
const updateContactsGatewaySummary = () => { if (window.updateContactsGatewaySummary) window.updateContactsGatewaySummary(); };
const saveContactsToServer = (silent) => { if (window.saveContactsToServer) window.saveContactsToServer(silent); };
const syncThemeBgTabs = (t) => { if (window.syncThemeBgTabs) window.syncThemeBgTabs(t); };
const isApkClient = () => (window.isApkClient ? window.isApkClient() : false);
const isHotspotFullyOnline = (h) => (window.isHotspotFullyOnline ? window.isHotspotFullyOnline(h) : false);
const initQuickAssign = () => { if (window.initQuickAssign) window.initQuickAssign(); };
const t = (key, fallback) => (window.t ? window.t(key, fallback) : (fallback || key));

export const DEFAULT_NETWORK_BRAND_COLORS = {
  bm: { dark: "#ee7334", light: "#ea580c" },
  tgif: { dark: "#00ccf8", light: "#00ccf8" },
  freedmr: { dark: "#34d399", light: "#059669" },
  adn: { dark: "#1ddee0", light: "#1ddee0" },
  ysf: { dark: "#c084fc", light: "#7c3aed" },
  m17: { dark: "#e5499b", light: "#db2777" },
  dstar: { dark: "#2520d4", light: "#2520d4" },
  svx: { dark: "#86e400", light: "#86e400" },
  dmrplus: { dark: "#c4b5fd", light: "#7c3aed" },
  xlx: { dark: "#fbbf24", light: "#d97706" },
  allstar: { dark: "#ebebeb", light: "#ebebeb" },
  custom: { dark: "#cbd5e1", light: "#475569" }
};

function _hexToRgbTuple(hex) {
  const clean = String(hex || "").trim().replace(/^#/, "");
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 0,
      parseInt(clean[1] + clean[1], 16) || 0,
      parseInt(clean[2] + clean[2], 16) || 0
    ];
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16) || 0,
      parseInt(clean.slice(2, 4), 16) || 0,
      parseInt(clean.slice(4, 6), 16) || 0
    ];
  }
  return [148, 163, 184];
}

function _isLightBrandHex(hex) {
  const [r, g, b] = _hexToRgbTuple(hex);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 152;
}

export function getNetworkBrandColor(netType, theme = "dark") {
  const clean = (netType || "bm").toLowerCase();
  const customColors = window.__networkBrandColors || {};
  if (customColors[clean] && customColors[clean][theme]) {
    return customColors[clean][theme];
  }
  const def = DEFAULT_NETWORK_BRAND_COLORS[clean] || DEFAULT_NETWORK_BRAND_COLORS.custom;
  return def[theme] || def.dark;
}

export function isNetworkColorEnabled() {
  return window.__enableNetworkColors !== false;
}

export function applyCardBrandColors(card, netType) {
  if (!card) return;
  const isEnabled = isNetworkColorEnabled();
  card.classList.toggle("is-neutral-gray", !isEnabled);
  if (!isEnabled) {
    card.style.removeProperty("--card-net-accent");
    card.style.removeProperty("--card-net-border");
    card.style.removeProperty("--card-net-border-solid");
    card.style.removeProperty("--card-net-glow");
    card.style.removeProperty("--card-net-glow-strong");
    return;
  }
  const isLight = document.documentElement.getAttribute("data-theme") === "light" || document.body.getAttribute("data-theme") === "light";
  const theme = isLight ? "light" : "dark";
  const accent = getNetworkBrandColor(netType, theme);
  const [r, g, b] = _hexToRgbTuple(accent);
  card.style.setProperty("--card-net-accent", accent);
  card.style.setProperty("--card-net-border", `rgba(${r}, ${g}, ${b}, 0.68)`);
  card.style.setProperty("--card-net-border-solid", accent);
  card.style.setProperty("--card-net-glow", `rgba(${r}, ${g}, ${b}, 0.26)`);
  card.style.setProperty("--card-net-glow-strong", `rgba(${r}, ${g}, ${b}, 0.56)`);
}

// State
export let bmMastersList = window.bmMastersList || [];
window.bmMastersList = bmMastersList;
try {
  Object.defineProperty(window, "bmMastersList", {
    get: () => bmMastersList,
    set: (v) => { bmMastersList = v; },
    configurable: true
  });
} catch (_) {}

export let currentHotspots = window.currentHotspots || [];
export let activeHotspotId = window.activeHotspotId || "default";

export function setCurrentHotspots(val) {
  const arr = Array.isArray(val) ? val : [];
  currentHotspots = arr;
  window.currentHotspots = arr;
  return arr;
}

export function setActiveHotspotId(val) {
  const id = val || "default";
  activeHotspotId = id;
  window.activeHotspotId = id;
  if (typeof window !== "undefined") {
    if (window.audioPlayer && typeof window.audioPlayer.syncSingleHotspotAudioMute === "function") {
      try { window.audioPlayer.syncSingleHotspotAudioMute(id); } catch (_) {}
    }
    if (typeof window.syncActiveAudioRxPreset === "function") {
      try { window.syncActiveAudioRxPreset(id); } catch (_) {}
    }
  }
  return id;
}

try {
  Object.defineProperty(window, "currentHotspots", {
    get: () => currentHotspots,
    set: (v) => {
      const arr = Array.isArray(v) ? v : [];
      currentHotspots = arr;
    },
    configurable: true
  });
} catch (_) {}

try {
  Object.defineProperty(window, "activeHotspotId", {
    get: () => activeHotspotId,
    set: (v) => {
      activeHotspotId = v || "default";
    },
    configurable: true
  });
} catch (_) {}


  // --- Hotspots Management ---
  var _firstHotspotsLoad = true;
  var _hotspotsLoadedOnce = false;
export async function loadHotspots() {
    try {
      const res = await fetch("/api/hotspots");
      const data = await res.json();
      const prevById = new Map((Array.isArray(currentHotspots) ? currentHotspots : []).map(h => [String(h.id), h]));
      const rawHotspots = (data.hotspots || []).map(h => {
        const prev = prevById.get(String(h.id));
        if (prev) {
          if (prev._aslCarrierRx !== undefined && (!h.ts1 || !h.ts1.active)) {
            h._aslCarrierRx = prev._aslCarrierRx;
            h._aslLastRxAudioMs = prev._aslLastRxAudioMs;
            h._aslRxActiveNode = prev._aslRxActiveNode;
            h._aslKeyedNodes = prev._aslKeyedNodes;
          }
          if (prev._ysfCarrierRx !== undefined && (!h.ts1 || !h.ts1.active)) {
            h._ysfCarrierRx = prev._ysfCarrierRx;
            h._ysfRxActiveRoom = prev._ysfRxActiveRoom;
            h._ysfLastRxDgId = prev._ysfLastRxDgId;
            h._ysfLastRxCaller = prev._ysfLastRxCaller;
            h._ysfLastRxAudioMs = prev._ysfLastRxAudioMs;
          }
        }
        return h;
      });
      setCurrentHotspots(rawHotspots);
      _hotspotsLoadedOnce = true;
      const curHs = currentHotspots;
      const firstVisibleHs = curHs.find(h => !h.hidden) || curHs[0] || null;
      const rawTargetActive = data.active_hotspot_id;
      const targetActive = (rawTargetActive && curHs.some(h => h.id === rawTargetActive && !h.hidden))
        ? rawTargetActive
        : ((firstVisibleHs && firstVisibleHs.id) || "default");
      setActiveHotspotId(targetActive);

      curHs.forEach(hs => {
        const cid = resolveHotspotId(hs.id);
        if (hs.auto_record !== undefined) {
          try {
            localStorage.setItem(`proxdmr_autorec_${cid}`, hs.auto_record ? "1" : "0");
          } catch (_) {}
        }
      });

      // Сервер (hs.collapsed) — эталон, с сохранением клиентского live-collapsed состояния пока сервер держит хотспот активным
      let visibleOrderIdx = 0;
      curHs.forEach((hs) => {
        const cid = resolveHotspotId(hs.id);
        const vIdx = !hs.hidden ? visibleOrderIdx++ : -1;
        const serverCollapsed = (typeof hs.collapsed === "boolean") ? hs.collapsed : (vIdx > 0);
        const isLive = !hs.hidden && !serverCollapsed && isHotspotLiveCollapsed(cid);
        const isCollapsed = serverCollapsed || isLive;
        try {
          localStorage.setItem(`proxdmr_collapsed_${cid}`, isCollapsed ? "true" : "false");
          if (hs.hidden || serverCollapsed) {
            localStorage.setItem(`proxdmr_live_collapsed_${cid}`, "false");
          }
        } catch (_) {}

        hs.collapsed = isCollapsed;
        hs.isLiveCollapsed = Boolean(isCollapsed && isLive);
        if (isCollapsed && !isLive) {
          hs.status = "DISCONNECTED";
          hs.detail = window.t ? window.t("status.bm_collapsed_detail", {}, "Collapsed / disconnected") : "Collapsed / disconnected";
        }
      });

      if (targetActive && curHs.some(h => h.id === targetActive && !h.hidden && (!isHotspotCollapsed(h.id) || isHotspotLiveCollapsed(h.id)))) {
        setActiveHotspotId(targetActive);
      } else if (!curHs.some(h => h.id === activeHotspotId && !h.hidden) || (isHotspotCollapsed(activeHotspotId) && !isHotspotLiveCollapsed(activeHotspotId))) {
        const firstOpen = curHs.find(h => !h.hidden && (!isHotspotCollapsed(h.id) || isHotspotLiveCollapsed(h.id)));
        if (firstOpen) {
          setActiveHotspotId(firstOpen.id);
        } else if (firstVisibleHs) {
          setActiveHotspotId(firstVisibleHs.id);
        }
      }
      try { localStorage.setItem("proxdmr_active_hotspot_id", activeHotspotId); } catch (_) {}

      renderHotspotSelect();
      renderHotspotsList();
      renderRadiosGrid();
      applyActiveHotspotToUI();
      renderToolbarHotspotSlots();
      if (typeof window !== "undefined") {
        if (typeof window.syncActiveAudioRxPreset === "function") {
          try { window.syncActiveAudioRxPreset(activeHotspotId); } catch (_) {}
        }
        if (typeof window.syncActiveAudioTxPreset === "function") {
          try { window.syncActiveAudioTxPreset(activeHotspotId); } catch (_) {}
        }
      }
      const curHsEl = document.getElementById("editHsId");
      const curHsId = curHsEl ? curHsEl.value : activeHotspotId;
      const curHsObj = curHs.find(h => h.id === curHsId) || curHs[0];
      if (curHsObj) {
        if (typeof updateEditHsToolbarUI === "function") {
          updateEditHsToolbarUI(curHsObj);
        }
        if (typeof populateEditHotspotFormFields === "function") {
          populateEditHotspotFormFields(curHsObj);
        }
      }
      if (typeof ensureValidContactsGateway === "function") {
        ensureValidContactsGateway();
      }
      if (typeof updateContactsGatewaySummary === "function") {
        updateContactsGatewaySummary();
      }
      if (typeof syncAllTranscribeSlotsToServer === "function") {
        syncAllTranscribeSlotsToServer();
      }
      if (typeof checkBmApiStatus === "function") {
        checkBmApiStatus();
      }
      if (!bmMastersList.length) {
        fetchBmMasters();
      }
    } catch (e) {
      console.error("[HOTSPOTS] Failed to load hotspots:", e);
    }
  }
export function renderHotspotSelect() {
    const headerHotspotSelect = document.getElementById("headerHotspotSelect");
    if (!headerHotspotSelect) return;
    const currentHotspots = (window.currentHotspots || []).filter(hs => !hs.hidden);
    const activeHotspotId = window.activeHotspotId || "default";
    headerHotspotSelect.innerHTML = "";
    currentHotspots.forEach(hs => {
      const opt = document.createElement("option");
      opt.value = hs.id;
      const isCollapsed = isHotspotCollapsed(hs.id);
      const isLive = isHotspotLiveCollapsed(hs.id);
      const isOnline = (!isCollapsed || isLive) && hs.status === "ONLINE";
      const statusIcon = isOnline ? "🟢" : "⚪";
      const bgSuffix = window.t ? window.t("hotspots.suffix_collapsed_bg", {}, " (in background)") : " (in background)";
      const colSuffix = window.t ? window.t("hotspots.suffix_collapsed", {}, " (collapsed)") : " (collapsed)";
      const suffix = isCollapsed ? (isLive ? bgSuffix : colSuffix) : "";
      opt.textContent = `${statusIcon} ${hs.name} (${hs.effective_id || hs.dmr_id})${suffix}`;
      if (hs.id === activeHotspotId) opt.selected = true;
      headerHotspotSelect.appendChild(opt);
    });
  }
export function switchActiveHotspot(newId) {
    const curActiveId = (typeof window !== "undefined" && window.activeHotspotId) || null;
    if (!newId || newId === curActiveId) return;
    if (typeof window !== "undefined") {
      window.activeHotspotId = newId;
      if (window.audioPlayer && typeof window.audioPlayer.syncSingleHotspotAudioMute === "function") {
        try { window.audioPlayer.syncSingleHotspotAudioMute(newId); } catch (_) {}
      }
    }
    try {
      localStorage.setItem("proxdmr_active_hotspot_id", newId);
    } catch (_) {}
    fetch("/api/hotspots/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: newId })
    }).catch(e => console.error("Failed to switch active hotspot:", e));

    const curHs = (typeof window !== "undefined" && window.currentHotspots) || [];
    const targetHs = curHs.find(h => h.id === newId);
    if (targetHs) {
      const targetNet = (targetHs.network_type || "").toLowerCase();
      const isXlx = (targetNet === "xlx");
      const t1 = targetHs.default_tg_ts1 || 91;
      const t2 = isXlx ? 9 : (targetHs.default_tg_ts2 || 2501);
      if (typeof window !== "undefined") {
        window.tgTs1 = t1;
        window.tgTs2 = t2;
      }
      localStorage.setItem("proxdmr_tg_ts1", t1.toString());
      localStorage.setItem("proxdmr_tg_ts2", t2.toString());
    }
    applyActiveHotspotToUI();
    if (typeof window.syncLogSortOrderForCurrentHotspot === "function") {
      window.syncLogSortOrderForCurrentHotspot();
    }
    if (typeof window.updateHotspotTsAudioModeUI === "function") {
      window.updateHotspotTsAudioModeUI(newId);
    }
    if (typeof window.updateHotspotCardMuteUI === "function") {
      window.updateHotspotCardMuteUI(newId);
    }
    document.querySelectorAll(".radio-container").forEach(c => {
      const isAct = c.dataset.hotspotId === newId;
      c.classList.toggle("active-hotspot", isAct);
      if (isAct && targetHs && (targetHs.network_type || "").toLowerCase() === "xlx") {
        if (typeof setCardSlot === "function") {
          setCardSlot(c, 2, false);
        }
      }
    });
    if (typeof updatePttLockUI === "function") {
      updatePttLockUI();
    }
    updateHotspotVolumeAndMuteUI(newId);
    if (typeof window !== "undefined") {
      if (typeof window.syncActiveAudioRxPreset === "function") {
        try { window.syncActiveAudioRxPreset(newId); } catch (_) {}
      }
      if (typeof window.syncActiveAudioTxPreset === "function") {
        try { window.syncActiveAudioTxPreset(newId); } catch (_) {}
      }
    }
  }
export function triggerAddNewHotspot() {
    const callsignDisplay = document.getElementById("callsignDisplay");
    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    if (currentHotspots.length >= 30) {
      const msg30 = window.t ? window.t("hotspots.limit_reached_30", {}, "Maximum total number of virtual hotspots is 30.") : "Maximum total number of virtual hotspots is 30.";
      if (window.showAppAlert) {
        const limTitle = window.t ? window.t("hotspots.limit_title", {}, "Hotspot Limit") : "Hotspot Limit";
        window.showAppAlert(msg30, { title: limTitle, icon: "⚠️" });
      } else {
        alert(msg30);
      }
      return;
    }
    const activeCount = currentHotspots.filter(h => !h.hidden).length;
    const shouldBeHidden = activeCount >= 7;
    const settingsModal = document.getElementById("settingsModal");
    if (settingsModal) {
      settingsModal.classList.add("active");
      pushNavState("modal", "settingsModal");
    }
    const tabButtons = document.querySelectorAll("#settingsModal .tab-btn");
    const tabContents = document.querySelectorAll("#settingsModal .tab-content");
    tabButtons.forEach(b => b.classList.remove("active"));
    tabContents.forEach(c => c.classList.remove("active"));
    const editTabBtn = document.querySelector('#settingsModal [data-tab="tab-edit-hs"]');
    if (editTabBtn) editTabBtn.classList.add("active");
    const editTab = document.getElementById("tab-edit-hs");
    if (editTab) editTab.classList.add("active");
    try {
      localStorage.setItem("proxdmr_settings_last_tab", "tab-edit-hs");
    } catch (_) {}

    const usedSsids = new Set(currentHotspots.filter(h => (h.network_type || "bm") === "bm").map(h => Number(h.bm_ssid)));
    let nextSsid = 1;
    while (usedSsids.has(nextSsid)) {
      nextSsid++;
    }
    const baseHs = currentHotspots[0] || {};
    openEditHotspotForm({
      id: "",
      name: "",
      callsign: baseHs.callsign || (callsignDisplay && callsignDisplay.textContent !== "N0CALL" ? callsignDisplay.textContent : ""),
      talker_alias: "",
      send_talker_alias: true,
      dmr_id: baseHs.dmr_id || "",
      bm_ssid: nextSsid,
      network_type: "bm",
      rpto_options: "",
      xlx_module: "D",
      bm_password: "",
      bm_api_key: "",
      bm_master_host: "2322.master.brandmeister.network",
      bm_master_port: 62031,
      default_tg_ts1: 9990,
      default_tg_ts2: 9990,
      duplex: true,
      autoconnect: true,
      auto_tg_bm: true,
      auto_record: true,
      allstar_node: "1999",
      allstar_always_online: true,
      hidden: shouldBeHidden
    });
    if (shouldBeHidden) {
      const hintMsg = window.t ? window.t("hotspots.new_hs_auto_hidden", {}, "Активных хотспотов уже 7 — новый хотспот создан со статусом «Исключен из списка живых»") : "Активных хотспотов уже 7 — новый хотспот создан со статусом «Исключен из списка живых»";
      showToast(hintMsg, "info", 4500);
    }
  }

export function saveCurrentSettingsState() {
  const modal = document.getElementById("settingsModal");
  if (!modal || !modal.classList.contains("active")) return;
  const activeBtn = modal.querySelector(".tab-btn.active");
  if (activeBtn && activeBtn.dataset.tab) {
    const curTabId = activeBtn.dataset.tab;
    try {
      localStorage.setItem("proxdmr_settings_last_tab", curTabId);
    } catch (_) {}
    const modalBody = modal.querySelector(".settings-modal-body");
    if (modalBody) {
      try {
        localStorage.setItem(`proxdmr_settings_scroll_${curTabId}`, String(modalBody.scrollTop));
        localStorage.setItem("proxdmr_settings_last_scroll", String(modalBody.scrollTop));
      } catch (_) {}
    }
    const activeEl = document.activeElement;
    if (activeEl && activeEl.id && modal.contains(activeEl)) {
      if (!activeEl.classList.contains("tab-btn") && activeEl.id !== "closeSettingsBtn") {
        try {
          localStorage.setItem("proxdmr_settings_last_focus", activeEl.id);
          localStorage.setItem(`proxdmr_settings_focus_${curTabId}`, activeEl.id);
        } catch (_) {}
      }
    }
  }
}

export function openHotspotSettings(hs, tabToActivate = null) {
    if (typeof window.closePrimaryModals === "function") {
      window.closePrimaryModals("settingsModal");
    }
    const curHotspots = window.currentHotspots || currentHotspots || [];
    const curActiveId = window.activeHotspotId || activeHotspotId || "default";
    if (!hs) hs = curHotspots.find(h => h.id === curActiveId) || curHotspots[0];
    const modal = document.getElementById("settingsModal");
    if (modal) {
      modal.style.display = "flex";
      modal.classList.add("active");
    }
    pushNavState("modal", "settingsModal");

    const validTabs = ["tab-account", "tab-appearance", "tab-edit-hs", "tab-general", "tab-transcriber"];
    let savedTab = null;
    try {
      savedTab = localStorage.getItem("proxdmr_settings_last_tab");
    } catch (_) {}
    if (tabToActivate === "tab-hotspots") tabToActivate = "tab-edit-hs";
    if (savedTab === "tab-hotspots") savedTab = "tab-edit-hs";
    if (tabToActivate === "tab-admin") {
      tabToActivate = "tab-account";
      try { localStorage.setItem("proxdmr_account_subtab", "account-subtab-users"); } catch (_) {}
    }
    if (savedTab === "tab-admin") {
      savedTab = "tab-account";
      try { localStorage.setItem("proxdmr_account_subtab", "account-subtab-users"); } catch (_) {}
    }
    let targetTabId = tabToActivate;
    if (!targetTabId || !validTabs.includes(targetTabId)) {
      targetTabId = (savedTab && validTabs.includes(savedTab)) ? savedTab : "tab-account";
    }

    const allTabBtns = modal ? modal.querySelectorAll(".tab-btn") : document.querySelectorAll("#settingsModal .tab-btn");
    const allTabContents = modal ? modal.querySelectorAll(".tab-content") : document.querySelectorAll("#settingsModal .tab-content");
    allTabBtns.forEach(b => b.classList.remove("active"));
    allTabContents.forEach(c => c.classList.remove("active"));

    const activeBtn = (modal ? modal.querySelector(`[data-tab="${targetTabId}"]`) : null) ||
                      (modal ? modal.querySelector('[data-tab="tab-account"]') : null) ||
                      document.querySelector(`[data-tab="${targetTabId}"]`);
    if (activeBtn) {
      activeBtn.classList.add("active");
      if (typeof activeBtn.scrollIntoView === "function") {
        try {
          activeBtn.scrollIntoView({ behavior: "instant", inline: "nearest", block: "nearest" });
        } catch (_) {}
      }
    }
    const activeTab = document.getElementById(targetTabId) || document.getElementById("tab-account");
    if (activeTab) activeTab.classList.add("active");
    if (typeof updateSettingsHeaderSaveBtn === "function") {
      updateSettingsHeaderSaveBtn();
    }

    const effectiveTab = activeTab ? activeTab.id : targetTabId;
    if (effectiveTab === "tab-account") {
      if (typeof window.restoreAccountSubtab === "function") {
        window.restoreAccountSubtab();
      }
    }
    if (effectiveTab === "tab-transcriber") {
      const keysFrame = document.getElementById("geminiApiKeysFrame");
      if (keysFrame) keysFrame.classList.add("collapsed");
    }
    try {
      localStorage.setItem("proxdmr_settings_last_tab", effectiveTab);
    } catch (_) {}

    const modalBody = document.querySelector("#settingsModal .settings-modal-body");
    let savedScroll = 0;
    let savedFocusId = null;
    try {
      savedScroll = parseInt(
        localStorage.getItem(`proxdmr_settings_scroll_${effectiveTab}`) ||
        localStorage.getItem("proxdmr_settings_last_scroll") || "0",
        10
      );
      savedFocusId = localStorage.getItem(`proxdmr_settings_focus_${effectiveTab}`) ||
                     localStorage.getItem("proxdmr_settings_last_focus");
    } catch (_) {}

    const restoreTabState = () => {
      if (modalBody && savedScroll > 0) {
        modalBody.scrollTop = savedScroll;
      }
      if (savedFocusId) {
        const focusEl = document.getElementById(savedFocusId);
        if (focusEl && focusEl.closest(`#${effectiveTab}`) && typeof focusEl.focus === "function") {
          try {
            focusEl.focus({ preventScroll: true });
          } catch (_) {}
        }
      }
    };
    requestAnimationFrame(restoreTabState);
    setTimeout(restoreTabState, 40);

    try {
      if (hs) {
        populateEditHotspotFormFields(hs);
      }
    } catch (err) {
      console.warn("[SETTINGS] Error populating hotspot fields:", err);
    }
    try {
      if (typeof syncThemeBgTabs === "function") {
        syncThemeBgTabs(typeof window !== "undefined" ? window.currentTheme : "default");
      }
    } catch (err) {
      console.warn("[SETTINGS] Error syncing theme background tabs:", err);
    }
    try {
      if (typeof updateApkUpdateUI === "function") {
        updateApkUpdateUI();
      }
    } catch (err) {
      console.warn("[SETTINGS] Error updating APK UI:", err);
    }
    try {
      if (typeof checkServerApkUpdate === "function") {
        checkServerApkUpdate();
      }
    } catch (err) {
      console.warn("[SETTINGS] Error checking server APK update:", err);
    }
  }

function setupCollapseButtonLongPress(btn, cid) {
  if (!btn || btn._hasLongPress) return;
  btn._hasLongPress = true;

  let timer = null;
  let didLongPress = false;
  let startX = 0;
  let startY = 0;

  function cancelTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function getCoords(e) {
    if (e && typeof e.clientX === "number" && typeof e.clientY === "number" && (e.clientX !== 0 || e.clientY !== 0)) {
      return { x: e.clientX, y: e.clientY };
    }
    const rect = btn.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    didLongPress = false;
    cancelTimer();

    const coords = getCoords(e);
    startX = coords.x;
    startY = coords.y;

    const card = btn.closest(".radio-container");
    const rawCid = cid || (card && card.dataset.hotspotId) || (card && card.id === "radioContainer" ? "default" : null);
    const resolvedCid = typeof resolveHotspotId === "function" ? resolveHotspotId(rawCid) : rawCid;
    const isCollapsed = Boolean(
      (card && card.classList.contains("collapsed")) ||
      (typeof isHotspotCollapsed === "function" && (isHotspotCollapsed(resolvedCid) || isHotspotCollapsed(rawCid))) ||
      (typeof window.isHotspotCollapsed === "function" && (window.isHotspotCollapsed(resolvedCid) || window.isHotspotCollapsed(rawCid)))
    );

    if (isCollapsed) {
      // Длинное удержание на свёрнутом хотспоте: отправка в архив (hidden: true) — равноправно для любого хотспота, включая №1
      timer = setTimeout(async () => {
        timer = null;
        didLongPress = true;
        try {
          if (typeof showLongPressEffect === "function") {
            showLongPressEffect(coords.x, coords.y);
          } else if (navigator.vibrate) {
            navigator.vibrate([40, 60, 40]);
          }
        } catch (_) {}

        const currentHotspots = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : (window.currentHotspots || [])) || [];
        const existingIndex = currentHotspots.findIndex(h =>
          (typeof resolveHotspotId === "function" ? resolveHotspotId(h.id) === resolvedCid : h.id === resolvedCid) ||
          h.id === rawCid ||
          h.id === resolvedCid
        );
        const existing = existingIndex >= 0 ? currentHotspots[existingIndex] : null;

        if (!existing) {
          console.warn("[HOTSPOTS] Target hotspot not found to disable:", resolvedCid);
          return;
        }

        const hsName = existing.name || existing.callsign || (window.t ? window.t("hotspots.name_prefix", { num: existingIndex + 1 }, `Hotspot #${existingIndex + 1}`) : `Hotspot #${existingIndex + 1}`);
        const titleText = window.t ? window.t("hotspots.archive_confirm_title", {}, "Archive hotspot") : "Archive hotspot";
        const confirmMsg = window.t
          ? window.t("hotspots.archive_confirm_msg", { name: hsName }, `Are you sure you want to archive hotspot "${hsName}"?`)
          : `Are you sure you want to archive hotspot "${hsName}"?`;
        const confirmBtnText = window.t ? window.t("hotspots.btn_to_archive", {}, "Archive") : "Archive";
        const cancelBtnText = window.t ? window.t("buttons.cancel", {}, "Cancel") : "Cancel";

        const confirmed = typeof window.showAppConfirm === "function"
          ? await window.showAppConfirm({
              title: titleText,
              icon: "📦",
              message: confirmMsg,
              confirmText: confirmBtnText,
              cancelText: cancelBtnText,
              confirmStyle: "primary"
            })
          : (typeof confirm === "function" ? confirm(confirmMsg) : true);

        if (!confirmed) {
          return;
        }

        if (card) {
          card.style.transition = "opacity 0.25s ease, transform 0.25s ease";
          card.style.opacity = "0.35";
          card.style.transform = "scale(0.98)";
        }

        try {
          if (typeof disableHotspotTranscribe === "function") {
            disableHotspotTranscribe(existing.id, true);
          }
          if (typeof setHotspotAudioMute === "function") {
            setHotspotAudioMute(existing.id, true);
          }
          const ap = typeof getAudioPlayer === "function" ? getAudioPlayer() : (window.audioPlayer || null);
          if (ap && ap.resetHotspot) {
            ap.resetHotspot(existing.id);
          }

          const preArchiveActiveId = typeof getActiveHotspotId === "function"
            ? getActiveHotspotId()
            : (typeof window !== "undefined" ? window.activeHotspotId : null);
          if (typeof window !== "undefined" && typeof window.closeLogIfOpenForHotspot === "function") {
            window.closeLogIfOpenForHotspot(existing.id, {
              previousActiveHotspotId: preArchiveActiveId,
              skipRefreshIfKeptOpen: true
            });
          }

          if (preArchiveActiveId === existing.id) {
            const nextOpen = (currentHotspots || []).find(h => !h.hidden && h.id !== existing.id);
            if (nextOpen && typeof switchActiveHotspot === "function") {
              switchActiveHotspot(nextOpen.id);
            }
          }

          const resp = await fetch(`/api/hotspots/${encodeURIComponent(existing.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...existing, hidden: true })
          });
          if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.detail || resp.statusText);
          }
          existing.hidden = true;

          const archivedMsg = (typeof window.t === "function")
            ? window.t("hotspots.hs_archived_toast", { name: hsName }, `Хотспот «${hsName}» отправлен в архив`)
            : `Хотспот «${hsName}» отправлен в архив`;
          if (typeof showToast === "function") {
            showToast(archivedMsg, "info", 3000);
          }

          if (typeof loadHotspots === "function") {
            await loadHotspots();
          }
        } catch (err) {
          console.error("[HOTSPOTS] Failed to turn off collapsed hotspot on long-press:", err);
          if (card) {
            card.style.opacity = "";
            card.style.transform = "";
          }
          if (typeof showToast === "function") {
            const turnOffErr = window.t ? window.t("hotspots.turn_off_err", {}, "Error turning off hotspot") : "Error turning off hotspot";
            showToast(err.message || turnOffErr, "error", 4000);
          }
        }
      }, 500);
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      didLongPress = true;
      try {
        if (typeof showLongPressEffect === "function") {
          showLongPressEffect(coords.x, coords.y);
        } else if (navigator.vibrate) {
          navigator.vibrate(40);
        }
      } catch (_) {}

      // Trigger LIVE COLLAPSE (keep running in background, keep audio, keep log)
      if (typeof window.collapseHotspot === "function") {
        window.collapseHotspot(resolvedCid || cid, { isLive: true });
      } else if (typeof collapseHotspot === "function") {
        collapseHotspot(resolvedCid || cid, { isLive: true });
      }
    }, 450);
  });

  btn.addEventListener("pointermove", (e) => {
    if (!timer) return;
    const coords = getCoords(e);
    const dx = Math.abs(coords.x - startX);
    const dy = Math.abs(coords.y - startY);
    if (dx > 20 || dy > 20) {
      cancelTimer();
    }
  });

  btn.addEventListener("pointerup", (e) => {
    cancelTimer();
    if (didLongPress) {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => { didLongPress = false; }, 800);
      return;
    }
  });

  btn.addEventListener("pointercancel", () => {
    cancelTimer();
    didLongPress = false;
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (didLongPress) {
      didLongPress = false;
      return;
    }
    const card = btn.closest(".radio-container");
    const rawCid = cid || (card && card.dataset.hotspotId) || (card && card.id === "radioContainer" ? "default" : null);
    const resolvedCid = typeof resolveHotspotId === "function" ? resolveHotspotId(rawCid) : rawCid;
    const isDefAlias = (typeof window !== "undefined" && typeof window.isPrimaryDefaultAlias === "function")
      ? window.isPrimaryDefaultAlias(resolvedCid)
      : (resolvedCid === "default");

    const lastAction = (typeof window !== "undefined" && window._lastHotspotCollapseActionTimes && (window._lastHotspotCollapseActionTimes[resolvedCid] || window._lastHotspotCollapseActionTimes[rawCid] || (isDefAlias ? window._lastHotspotCollapseActionTimes["default"] : 0))) || 0;
    if (Date.now() - lastAction < 600) {
      return;
    }
    const curHotspots = typeof getCurrentHotspots === "function" ? getCurrentHotspots() : (window.currentHotspots || []);
    const targetHsForCol = curHotspots.find(h => (typeof resolveHotspotId === "function" ? resolveHotspotId(h.id) === resolvedCid : h.id === resolvedCid) || h.id === rawCid);
    if (targetHsForCol && targetHsForCol._aslDynamicMatrixMode) {
      targetHsForCol._aslDynamicMatrixMode = false;
      targetHsForCol._aslDismissedUnlisted = new Set((targetHsForCol.asl_unlisted_links || []).map(l => String(l.node).trim()));
    }
    const isCollapsed = Boolean(
      (card && card.classList.contains("collapsed")) ||
      (typeof isHotspotCollapsed === "function" && (isHotspotCollapsed(resolvedCid) || isHotspotCollapsed(rawCid))) ||
      (typeof window.isHotspotCollapsed === "function" && (window.isHotspotCollapsed(resolvedCid) || window.isHotspotCollapsed(rawCid)))
    );
    if (isCollapsed) {
      if (typeof window.expandHotspot === "function") {
        window.expandHotspot(resolvedCid || rawCid);
      } else if (typeof expandHotspot === "function") {
        expandHotspot(resolvedCid || rawCid);
      }
    } else {
      if (typeof window.collapseHotspot === "function") {
        window.collapseHotspot(resolvedCid || rawCid, { isLive: false });
      } else if (typeof toggleHotspotCollapse === "function") {
        toggleHotspotCollapse(resolvedCid || rawCid);
      }
    }
  });

  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

let _pcHotspotAlignRaf = 0;
let _isSyncingPcHotspotAlign = false;
const _observedPcAlignTargets = typeof WeakSet === "function" ? new WeakSet() : null;

function resolveDesktopLogOwnerCardInGrid(radiosGrid) {
  if (!radiosGrid) return null;
  const effectiveHid = (!window.currentLogHotspotId || window.currentLogHotspotId === "all")
    ? (window.activeHotspotId || ((window.currentHotspots || []).find(h => !h.hidden) || {}).id || "default")
    : window.currentLogHotspotId;

  if (effectiveHid && effectiveHid !== "all") {
    const resolvedId = resolveHotspotId(effectiveHid);
    const direct =
      radiosGrid.querySelector(`.radio-container[data-hotspot-id="${effectiveHid}"]:not(.collapsed)`) ||
      (resolvedId && resolvedId !== effectiveHid
        ? radiosGrid.querySelector(`.radio-container[data-hotspot-id="${resolvedId}"]:not(.collapsed)`)
        : null);
    if (direct) return direct;
  }
  return radiosGrid.querySelector(".radio-container:not(.collapsed)") || null;
}

function setDesktopLogPanelHeightPx(logPanel, px) {
  if (!logPanel || !(px > 100)) return;
  const roundedH = `${Math.round(px)}px`;
  if (logPanel.style.height !== roundedH) {
    logPanel.style.setProperty("--desktop-log-height", roundedH);
    logPanel.style.height = roundedH;
    logPanel.style.maxHeight = roundedH;
  }
}

export function syncDesktopHotspotsTopAlignment() {
  if (_isSyncingPcHotspotAlign) return;
  const radiosGrid = document.getElementById("radiosGrid");
  if (!radiosGrid) return;

  _isSyncingPcHotspotAlign = true;
  try {
    radiosGrid.querySelectorAll(".radio-container, .live-monitor-container").forEach((el) => {
      el.classList.remove("is-pc-top-row-lifted", "is-pc-col-lifted");
      el.style.removeProperty("--pc-toolbar-lift");
      el.style.removeProperty("--pc-col-lift");
    });

    if (typeof window === "undefined" || window.innerWidth <= 768) return;

    const toolbar = document.getElementById("proxdmrTopToolbar");
    if (!toolbar) return;

    const toolbarRect = toolbar.getBoundingClientRect();
    if (!toolbarRect || toolbarRect.width <= 0 || toolbarRect.height <= 0) return;

    const visibleItems = Array.from(radiosGrid.children).filter((el) => {
      if (!el || !el.classList) return false;
      if (el.classList.contains("radio-container")) {
        return !el.classList.contains("collapsed");
      }
      if (el.id === "liveMonitorPanel" || el.classList.contains("live-monitor-container")) {
        return !el.classList.contains("hidden");
      }
      return false;
    });

    const logPanel = document.getElementById("liveMonitorPanel");
    const isHotspotHeightLog = Boolean(
      logPanel &&
      !logPanel.classList.contains("hidden") &&
      logPanel.classList.contains("pc-height-hotspot")
    );
    const logOwnerCard = isHotspotHeightLog ? resolveDesktopLogOwnerCardInGrid(radiosGrid) : null;

    if (visibleItems.length < 2) {
      if (isHotspotHeightLog && logOwnerCard && logPanel.parentElement === radiosGrid) {
        const ownerH = Math.round(logOwnerCard.getBoundingClientRect().height || logOwnerCard.offsetHeight || 0);
        setDesktopLogPanelHeightPx(logPanel, ownerH);
      }
      return;
    }

    // Group un-lifted items into natural Flexbox rows
    const rows = [];
    for (const item of visibleItems) {
      const rect = item.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const lastRow = rows.length ? rows[rows.length - 1] : null;
      if (!lastRow || Math.abs(rect.top - lastRow.naturalTop) > 6) {
        rows.push({ naturalTop: rect.top, entries: [{ el: item, rect }] });
      } else {
        lastRow.entries.push({ el: item, rect });
      }
    }
    if (!rows.length) return;

    const colCount = rows[0].entries.length;
    if (colCount < 2) {
      // Single-column narrow desktop: restore History card-height match to owner card
      if (isHotspotHeightLog && logOwnerCard && logPanel.parentElement === radiosGrid) {
        const ownerH = Math.round(logOwnerCard.getBoundingClientRect().height || logOwnerCard.offsetHeight || 0);
        setDesktopLogPanelHeightPx(logPanel, ownerH);
      }
      return;
    }

    const gridStyle = (typeof window.getComputedStyle === "function") ? window.getComputedStyle(radiosGrid) : null;
    const parsedGap = gridStyle ? parseFloat(gridStyle.rowGap || gridStyle.gap || "16") : 16;
    const rowGap = (!Number.isNaN(parsedGap) && parsedGap >= 0) ? parsedGap : 16;

    const apkBanner = document.getElementById("androidApkBanner");
    const bannerRect = (apkBanner && apkBanner.offsetParent !== null && apkBanner.style.display !== "none")
      ? apkBanner.getBoundingClientRect()
      : null;
    const hasVisibleBanner = Boolean(bannerRect && bannerRect.width > 0 && bannerRect.height > 0);

    const firstRect = rows[0].entries[0].rect;
    const toolbarLiftPx = Math.max(0, Number((firstRect.top - toolbarRect.top).toFixed(2)));
    const colLefts = rows[0].entries.map((entry) => entry.rect.left);
    const colBottoms = new Array(colCount).fill(firstRect.top);
    const placements = new Map();

    for (let r = 0; r < rows.length; r++) {
      const rowEntries = rows[r].entries;
      const rowBaseTop = (r === 0)
        ? firstRect.top
        : rowEntries[0].el.getBoundingClientRect().top;

      const resolvedInRow = [];
      for (let c = 0; c < rowEntries.length; c++) {
        const entry = rowEntries[c];
        const el = entry.el;

        // Match column index by horizontal position to stay resilient across wraps
        let colIdx = (c < colCount) ? c : (c % colCount);
        let bestDist = Infinity;
        for (let k = 0; k < colLefts.length; k++) {
          const dist = Math.abs(entry.rect.left - colLefts[k]);
          if (dist < bestDist) {
            bestDist = dist;
            colIdx = k;
          }
        }

        let desiredTop = rowBaseTop;
        if (r === 0) {
          const blockedByBanner = hasVisibleBanner &&
            bannerRect.right > entry.rect.left + 10 &&
            bannerRect.left < entry.rect.right - 10;
          if (colIdx > 0 && toolbarLiftPx > 0.5 && !blockedByBanner && entry.rect.left > firstRect.left + 10) {
            el.style.setProperty("--pc-toolbar-lift", `${toolbarLiftPx}px`);
            el.classList.add("is-pc-top-row-lifted");
            desiredTop = rowBaseTop - toolbarLiftPx;
          }
        } else {
          const targetTop = colBottoms[colIdx] + rowGap;
          const colLiftPx = Number((rowBaseTop - targetTop).toFixed(2));
          if (colLiftPx > 0.5) {
            el.style.setProperty("--pc-col-lift", `${colLiftPx}px`);
            el.classList.add("is-pc-col-lifted");
            desiredTop = rowBaseTop - colLiftPx;
          }
        }

        resolvedInRow.push({ el, colIdx, desiredTop });
      }

      // First finalize all non-log items in Row r so same-row owner floor is known
      let logItemInfo = null;
      for (const itemInfo of resolvedInRow) {
        if (isHotspotHeightLog && itemInfo.el === logPanel) {
          logItemInfo = itemInfo;
          continue;
        }
        const finalRect = itemInfo.el.getBoundingClientRect();
        colBottoms[itemInfo.colIdx] = finalRect.bottom;
        placements.set(itemInfo.el, {
          top: finalRect.top,
          bottom: finalRect.bottom,
          height: finalRect.height,
          rowIdx: r,
          colIdx: itemInfo.colIdx
        });
      }

      // Then align pc-height-hotspot History bottom to its owner card's floor ("родительский пол")
      if (logItemInfo) {
        if (logOwnerCard) {
          const ownerInfo = placements.get(logOwnerCard);
          const ownerRect = logOwnerCard.getBoundingClientRect();
          const ownerHeight = Math.round((ownerInfo ? ownerInfo.height : 0) || ownerRect.height || logOwnerCard.offsetHeight || 0);
          const ownerTop = ownerInfo ? ownerInfo.top : ownerRect.top;
          const ownerBottom = ownerInfo ? ownerInfo.bottom : ownerRect.bottom;
          const sameRowAsOwner = Boolean(ownerInfo && ownerInfo.rowIdx === r);

          let desiredLogH = ownerHeight;
          if (sameRowAsOwner && logItemInfo.desiredTop < ownerTop - 0.5 && ownerBottom > logItemInfo.desiredTop) {
            desiredLogH = Math.max(ownerHeight, Math.round(ownerBottom - logItemInfo.desiredTop));
          }
          setDesktopLogPanelHeightPx(logPanel, desiredLogH);
        }
        const finalLogRect = logItemInfo.el.getBoundingClientRect();
        colBottoms[logItemInfo.colIdx] = finalLogRect.bottom;
        placements.set(logItemInfo.el, {
          top: finalLogRect.top,
          bottom: finalLogRect.bottom,
          height: finalLogRect.height,
          rowIdx: r,
          colIdx: logItemInfo.colIdx
        });
      }
    }
  } finally {
    _isSyncingPcHotspotAlign = false;
  }
}

export function scheduleDesktopHotspotsTopAlignment() {
  if (typeof window === "undefined") return;
  if (_pcHotspotAlignRaf && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(_pcHotspotAlignRaf);
  }
  if (typeof window.requestAnimationFrame === "function") {
    _pcHotspotAlignRaf = window.requestAnimationFrame(() => {
      _pcHotspotAlignRaf = 0;
      syncDesktopHotspotsTopAlignment();
    });
  } else {
    syncDesktopHotspotsTopAlignment();
  }
}

function ensureDesktopHotspotsAlignmentObserver() {
  if (typeof window === "undefined") return;
  if (!window._pcHotspotAlignObserverWired) {
    window._pcHotspotAlignObserverWired = true;
    window.addEventListener("resize", scheduleDesktopHotspotsTopAlignment);
    if (typeof window.ResizeObserver === "function") {
      const ro = new window.ResizeObserver(() => {
        if (_isSyncingPcHotspotAlign) return;
        scheduleDesktopHotspotsTopAlignment();
      });
      window._pcHotspotAlignResizeObserver = ro;
    }
  }
  const ro = window._pcHotspotAlignResizeObserver;
  if (!ro) return;
  const observeOnce = (el) => {
    if (!el) return;
    if (_observedPcAlignTargets && _observedPcAlignTargets.has(el)) return;
    if (_observedPcAlignTargets) _observedPcAlignTargets.add(el);
    ro.observe(el);
  };
  observeOnce(document.getElementById("proxdmrTopToolbar"));
  const radiosGrid = document.getElementById("radiosGrid");
  observeOnce(radiosGrid);
  observeOnce(document.getElementById("androidApkBanner"));
  if (radiosGrid) {
    radiosGrid.querySelectorAll(":scope > .radio-container, :scope > .live-monitor-container").forEach(observeOnce);
  }
}

let _isSyncingCollapsedStacks = false;

export function syncCollapsedHotspotStacks() {
  if (_isSyncingCollapsedStacks) return;
  const radiosGrid = document.getElementById("radiosGrid");
  if (!radiosGrid) return;

  _isSyncingCollapsedStacks = true;
  try {
    // 1. Ensure no legacy .collapsed-hotspots-stack wrappers remain
    radiosGrid.querySelectorAll(".collapsed-hotspots-stack").forEach(stack => {
      while (stack.firstChild) {
        radiosGrid.insertBefore(stack.firstChild, stack);
      }
      stack.remove();
    });

    // 2. Keep all mounted .radio-container cards strictly in displayHotspots order
    const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length)
      ? window.currentHotspots
      : (Array.isArray(currentHotspots) && currentHotspots.length ? currentHotspots : []);
    const displayHotspots = allHs.filter(h => !h.hidden).slice(0, 7);
    displayHotspots.forEach((hs) => {
      const card = radiosGrid.querySelector(`.radio-container[data-hotspot-id="${hs.id}"]`);
      if (card) {
        radiosGrid.appendChild(card);
      }
    });

    // 3. Toggle empty workspace hint if all hotspots are archived
    const emptyHint = document.getElementById("archivedWorkspaceEmptyHint");
    if (emptyHint) {
      emptyHint.style.display = (_hotspotsLoadedOnce && displayHotspots.length === 0) ? "flex" : "none";
    }

    // 4. Both desktop & mobile dock visible #liveMonitorPanel immediately after its owner hotspot card inside #radiosGrid
    if (typeof window !== "undefined" && typeof window.syncLiveMonitorPlacement === "function") {
      window.syncLiveMonitorPlacement();
    }

    // 5. Keep top toolbar slots & 1s process cycle synchronized
    if (typeof renderToolbarHotspotSlots === "function") {
      renderToolbarHotspotSlots();
    }

    // 6. Keep Desktop cards #2+ on Row 1 aligned flush to top toolbar top edge
    ensureDesktopHotspotsAlignmentObserver();
    syncDesktopHotspotsTopAlignment();

    if (!radiosGrid._collapsedStackObserver && typeof window.MutationObserver !== "undefined") {
      radiosGrid._collapsedStackObserver = new MutationObserver((mutations) => {
        if (_isSyncingCollapsedStacks) return;
        let shouldSync = false;
        for (const m of mutations) {
          if (m.type === "attributes" && m.attributeName === "class" && m.target && m.target.classList && m.target.classList.contains("radio-container")) {
            const isCol = m.target.classList.contains("collapsed");
            const prevCol = m.target.dataset._prevCollapsedState === "1";
            if (isCol !== prevCol) {
              m.target.dataset._prevCollapsedState = isCol ? "1" : "0";
              shouldSync = true;
            }
          }
        }
        if (shouldSync) {
          syncCollapsedHotspotStacks();
        }
      });
      radiosGrid.querySelectorAll(".radio-container").forEach(c => {
        c.dataset._prevCollapsedState = c.classList.contains("collapsed") ? "1" : "0";
      });
      radiosGrid._collapsedStackObserver.observe(radiosGrid, {
        subtree: true,
        attributes: true,
        attributeFilter: ["class"]
      });
    } else {
      radiosGrid.querySelectorAll(".radio-container").forEach(c => {
        c.dataset._prevCollapsedState = c.classList.contains("collapsed") ? "1" : "0";
      });
    }
  } finally {
    _isSyncingCollapsedStacks = false;
  }
}

export async function linkHotspotXlxModule(cid, moduleLetter) {
  const allHs = (window.currentHotspots || []);
  const hs = allHs.find(h => h.id === cid) || allHs[0];
  const hsName = hs ? hs.name : cid;

  if (!moduleLetter) {
    // Unlink (TG 4000)
    try {
      const resp = await fetch("/api/bm/static-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotspot_id: cid,
          slot: 2,
          talkgroup: 4000,
          talkgroups: [4000]
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (data.status === "ok") {
        if (hs) hs.xlx_module = "";
        const toastMsg = window.t
          ? window.t("quick_assign.xlx_module_unlinked", { name: hsName }, `✅ [${hsName}] TS2: XLX module unlinked (TG 4000)`)
          : `✅ [${hsName}] TS2: XLX module unlinked (TG 4000)`;
        showToast(toastMsg, 2500);
        renderRadiosGrid();
      } else {
        showToast(
          data.detail || data.message || (window.t ? window.t("xlx.unlink_err", {}, "Module unlink error") : "Module unlink error"),
          3000
        );
      }
    } catch (e) {
      console.error("[XLX] Unlink failed:", e);
      showToast(window.t ? window.t("xlx.net_unlink_err", {}, "Network error while unlinking module") : "Network error while unlinking module", 2500);
    }
    return;
  }

  const modClean = String(moduleLetter).trim().toUpperCase().slice(0, 1);
  const modCode = modClean.charCodeAt(0);
  if (modCode < 65 || modCode > 90) return;
  const modTg = 4001 + (modCode - 65);

  try {
    const resp = await fetch("/api/bm/static-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotspot_id: cid,
        slot: 2,
        talkgroup: modTg,
        talkgroups: [modTg]
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (data.status === "ok") {
      if (hs) hs.xlx_module = modClean;
      const toastMsg = window.t
        ? window.t("quick_assign.xlx_module_set_toast", { name: hsName, module: modClean, tg: modTg }, `✅ [${hsName}] TS2: Подключен модуль XLX ${modClean} (TG ${modTg})`)
        : `✅ [${hsName}] TS2: Подключен модуль XLX ${modClean} (TG ${modTg})`;
      showToast(toastMsg, 2500);
      renderRadiosGrid();
    } else {
      showToast(data.detail || data.message || (window.t ? window.t("xlx.link_err", {}, "Error linking module") : "Error linking module"), 3000);
    }
  } catch (e) {
    console.error("[XLX] Link module failed:", e);
    showToast(window.t ? window.t("xlx.net_switch_err", {}, "Network error switching module") : "Network error switching module", 2500);
  }
}

export function openXlxAllModulesPopover(cid, anchorEl, currentMod = "") {
  document.querySelectorAll(".xlx-all-modules-popover").forEach(el => el.remove());
  const popover = document.createElement("div");
  popover.className = "xlx-all-modules-popover";
  const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  allLetters.forEach(letter => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `xlx-popover-tile ${letter === currentMod ? "active" : ""}`;
    tile.textContent = letter;
    const tgNum = 4001 + (letter.charCodeAt(0) - 65);
    tile.title = window.t ? window.t("xlx.mod_tile_title", { mod: letter, tg: tgNum }, `Module ${letter} (TG ${tgNum})`) : `Module ${letter} (TG ${tgNum})`;
    tile.onclick = (e) => {
      e.stopPropagation();
      popover.remove();
      linkHotspotXlxModule(cid, letter);
    };
    popover.appendChild(tile);
  });

  document.body.appendChild(popover);
  const rect = anchorEl.getBoundingClientRect();
  popover.style.top = `${window.scrollY + rect.bottom + 6}px`;
  popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 290, window.scrollX + rect.left - 80))}px`;

  const onDocClick = (e) => {
    if (!popover.contains(e.target) && e.target !== anchorEl) {
      popover.remove();
      document.removeEventListener("click", onDocClick);
    }
  };
  setTimeout(() => document.addEventListener("click", onDocClick), 50);
}

export function updateCardXlxPanel(card, hs) {
  if (!card) return;
  const targetHs = hs || (card.dataset.hotspotId ? (getCurrentHotspots().find(h => h.id === card.dataset.hotspotId) || null) : null) || (getCurrentHotspots()[0] || null);
  const isXlxNet = ((targetHs && targetHs.network_type) || card.dataset.networkType || "bm").toLowerCase() === "xlx";
  card.classList.toggle("card-net-xlx", isXlxNet);

  const cardCid = (targetHs && targetHs.id) || card.dataset.hotspotId || "default";
  if (typeof updateCardTsAudioModeUI === "function") {
    updateCardTsAudioModeUI(card, cardCid);
  } else if (typeof window !== "undefined" && typeof window.updateCardTsAudioModeUI === "function") {
    window.updateCardTsAudioModeUI(card, cardCid);
  }

  const vfoTs1 = card.querySelector(".vfo-ts1-row");
  const vfoTs2 = card.querySelector(".vfo-ts2-row");
  let vfoXlx = card.querySelector(".vfo-xlx-row");

  const oldModBar = card.querySelector(".xlx-modules-card-bar");
  if (oldModBar) oldModBar.remove();

  if (isXlxNet) {
    if (vfoTs1) vfoTs1.style.setProperty("display", "none", "important");

    if (!vfoXlx) {
      vfoXlx = document.createElement("div");
      vfoXlx.className = "vfo-row vfo-xlx-row";
      if (vfoTs2 && vfoTs2.parentElement) {
        vfoTs2.parentElement.insertBefore(vfoXlx, vfoTs2);
      } else if (vfoTs1 && vfoTs1.parentElement) {
        vfoTs1.parentElement.appendChild(vfoXlx);
      } else {
        const screenEl = card.querySelector(".radio-screen") || card;
        screenEl.appendChild(vfoXlx);
      }
    } else {
      vfoXlx.style.removeProperty("display");
    }

    const curMod = String((targetHs && targetHs.xlx_module) || "").trim().toUpperCase().slice(0, 1) || "D";
    const commonMods = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const isExtendedMod = curMod > "J";
    const cid = (targetHs && targetHs.id) || card.dataset.hotspotId || "default";
    const modLabel = window.t
      ? window.t("hotspots.xlx_module_bar_label", {}, "Модуль:")
      : "Модуль:";

    const selectEl = card.querySelector(".bm-server-select");
    const selectHost = selectEl && selectEl.value && selectEl.value !== "__TEST_SERVERS__" ? selectEl.value : "";
    const srvRaw = (targetHs && targetHs.bm_master_host) || selectHost || (targetHs && targetHs.custom_server_host) || (targetHs && targetHs.xlx_reflector) || (targetHs && targetHs.bm_master_name) || "";
    const srvInfo = typeof getBmServerInfo === "function" ? getBmServerInfo(srvRaw, "xlx") : (typeof resolveCardMasterInfo === "function" ? resolveCardMasterInfo(srvRaw, "xlx") : null);
    const cCode = srvInfo && srvInfo.countryCode && srvInfo.countryCode !== "GLOBAL" ? srvInfo.countryCode : "";
    const flag = cCode ? isoToEmoji(cCode) : "🌐";
    const serverName = (srvInfo && srvInfo.displayName) || (targetHs && targetHs.xlx_reflector) || (targetHs && targetHs.bm_master_name) || "XLX Reflector";
    const serverHost = (srvInfo && srvInfo.host) || (targetHs && targetHs.custom_server_host) || srvRaw || "";
    const hostDetail = serverHost && serverHost !== serverName ? ` (${serverHost})` : "";

    vfoXlx.innerHTML = `
      <div class="xlx-server-info-bar">
        <div class="xlx-server-left">
          <span class="xlx-server-icon">📡</span>
          <span class="xlx-server-flag">${flag}</span>
          <span class="xlx-server-title" title="${safeEscapeHtml(serverName + hostDetail)}"><strong>${safeEscapeHtml(serverName)}</strong><small>${safeEscapeHtml(hostDetail)}</small></span>
        </div>
        <div class="xlx-server-right">
          <span class="xlx-proto-pill">MMDVM · TS2</span>
        </div>
      </div>
      <div class="xlx-main-controls">
        <div class="xlx-modules-grid">
          ${commonMods.map(m => {
            const mTg = 4001 + (m.charCodeAt(0) - 65);
            const mTitle = window.t ? window.t("xlx.mod_tile_title", { mod: m, tg: mTg }, `Module ${m} (TG ${mTg})`) : `Module ${m} (TG ${mTg})`;
            return `<button type="button" class="btn-xlx-mod ${m === curMod ? 'active-xlx-mod' : ''}" data-module="${m}" title="${safeEscapeHtml(mTitle)}">${m}</button>`;
          }).join("")}
        </div>
        <div class="xlx-controls-col">
          <div class="xlx-active-mod-pill ${isExtendedMod ? 'active-xlx-mod' : ''}" role="button" tabindex="0" title="${window.t ? window.t("xlx.current_mod_title", { mod: curMod }, `Текущий модуль: ${curMod}. Кликните для выбора любого модуля A–Z`) : `Текущий модуль: ${curMod}. Кликните для выбора любого модуля A–Z`}">${modLabel} <strong>${curMod}</strong></div>
          <div class="xlx-actions-row">
            <button type="button" class="btn-xlx-all ${isExtendedMod ? 'active-xlx-mod' : ''}" title="${window.t ? window.t("xlx.all_mods_title", {}, `Все 26 модулей A–Z (выбор в 1 клик)`) : `Все 26 модулей A–Z (выбор в 1 клик)`}">🔤 ${isExtendedMod ? curMod : 'A–Z'} ▾</button>
            <button type="button" class="btn-xlx-unlink" title="${window.t ? window.t("xlx.unlink_title", {}, `Отключить модуль (Unlink TG 4000)`) : `Отключить модуль (Unlink TG 4000)`}">🔌 4000</button>
          </div>
        </div>
      </div>
    `;

    vfoXlx.querySelectorAll(".btn-xlx-mod").forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        linkHotspotXlxModule(cid, b.dataset.module);
      };
    });

    const modPill = vfoXlx.querySelector(".xlx-active-mod-pill");
    if (modPill) {
      modPill.onclick = (e) => {
        e.stopPropagation();
        openXlxAllModulesPopover(cid, modPill, curMod);
      };
    }

    const btnAll = vfoXlx.querySelector(".btn-xlx-all");
    if (btnAll) {
      btnAll.onclick = (e) => {
        e.stopPropagation();
        openXlxAllModulesPopover(cid, btnAll, curMod);
      };
    }

    const btnUnlink = vfoXlx.querySelector(".btn-xlx-unlink");
    if (btnUnlink) {
      btnUnlink.onclick = (e) => {
        e.stopPropagation();
        linkHotspotXlxModule(cid, null);
      };
    }

    if (typeof updateCardPttHint === "function") {
      updateCardPttHint(card);
    }
  } else {
    if (vfoTs1) vfoTs1.style.removeProperty("display");
    if (vfoXlx) vfoXlx.style.setProperty("display", "none", "important");
  }
}

export async function linkHotspotDmrPlusReflector(cid, reflectorNum) {
  const allHs = (window.currentHotspots || []);
  const hs = allHs.find(h => h.id === cid) || allHs[0];
  const hsName = hs ? hs.name : cid;
  const num = parseInt(reflectorNum, 10);

  if (!num || num === 4000) {
    try {
      const resp = await fetch("/api/bm/static-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotspot_id: cid,
          slot: 2,
          talkgroup: 4000,
          talkgroups: [4000]
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (data.status === "ok") {
        if (hs) hs.dmrplus_reflector = "";
        const unlinkedText = window.t ? window.t("dmrplus.ref_unlinked", {}, "Unlinked") : "Unlinked";
        showToast(
          window.t
            ? window.t("dmrplus.ref_unlinked_toast", { name: hsName, status: unlinkedText }, `✅ [${hsName}] TS2: DMR+ Reflector ${unlinkedText} (4000 Unlink)`)
            : `✅ [${hsName}] TS2: DMR+ Reflector ${unlinkedText} (4000 Unlink)`,
          2500
        );
        renderRadiosGrid();
      } else {
        showToast(data.detail || data.message || (window.t ? window.t("dmrplus.unlink_err", {}, "Error unlinking reflector") : "Error unlinking reflector"), 3000);
      }
    } catch (e) {
      console.error("[DMR+] Unlink failed:", e);
      showToast(window.t ? window.t("dmrplus.net_unlink_err", {}, "Network error unlinking reflector") : "Network error unlinking reflector", 2500);
    }
    return;
  }

  if (num === 5000) {
    try {
      const resp = await fetch("/api/bm/static-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotspot_id: cid,
          slot: 2,
          talkgroup: 5000,
          talkgroups: [5000]
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (data.status === "ok") {
        showToast(
          window.t
            ? window.t("dmrplus.status_req_toast", { name: hsName }, `ℹ️ [${hsName}] TS2: Reflector status requested (5000 Status)`)
            : `ℹ️ [${hsName}] TS2: Reflector status requested (5000 Status)`,
          2500
        );
      } else {
        showToast(data.detail || data.message || (window.t ? window.t("dmrplus.status_err", {}, "Error requesting status") : "Error requesting status"), 3000);
      }
    } catch (e) {
      console.error("[DMR+] Status request failed:", e);
      showToast(window.t ? window.t("dmrplus.net_status_err", {}, "Network error requesting status") : "Network error requesting status", 2500);
    }
    return;
  }

  try {
    const resp = await fetch("/api/bm/static-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotspot_id: cid,
        slot: 2,
        talkgroup: num,
        talkgroups: [num]
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (data.status === "ok") {
      if (hs) hs.dmrplus_reflector = String(num);
      const toastMsg = window.t
        ? window.t("dmrplus.ref_linked_toast", { ref: num }, `Linked to reflector ${num} (Voice on TG 9)`)
        : `Linked to reflector ${num} (Voice on TG 9)`;
      showToast(`✅ [${hsName}] TS2: ${toastMsg}`, 2500);
      renderRadiosGrid();
    } else {
      showToast(data.detail || data.message || (window.t ? window.t("dmrplus.link_err", {}, "Error linking reflector") : "Error linking reflector"), 3000);
    }
  } catch (e) {
    console.error("[DMR+] Link reflector failed:", e);
    showToast(window.t ? window.t("dmrplus.net_switch_err", {}, "Network error switching reflector") : "Network error switching reflector", 2500);
  }
}

export function updateCardDmrPlusPanel(card, hs) {
  if (!card) return;
  const targetHs = hs || (card.dataset.hotspotId ? (getCurrentHotspots().find(h => h.id === card.dataset.hotspotId) || null) : null) || (getCurrentHotspots()[0] || null);
  const isDmrPlusNet = ((targetHs && targetHs.network_type) || card.dataset.networkType || "bm").toLowerCase() === "dmrplus";
  card.classList.toggle("card-net-dmrplus", isDmrPlusNet);

  let dmrPlusBar = card.querySelector(".dmrplus-reflector-bar");

  if (!isDmrPlusNet) {
    if (dmrPlusBar) dmrPlusBar.remove();
    return;
  }

  const vfoTs2 = card.querySelector(".vfo-ts2-row");
  if (!dmrPlusBar) {
    dmrPlusBar = document.createElement("div");
    dmrPlusBar.className = "dmrplus-reflector-bar";
    if (vfoTs2 && vfoTs2.nextSibling) {
      vfoTs2.parentNode.insertBefore(dmrPlusBar, vfoTs2.nextSibling);
    } else if (vfoTs2) {
      vfoTs2.parentNode.appendChild(dmrPlusBar);
    } else {
      const screenEl = card.querySelector(".radio-screen") || card;
      screenEl.appendChild(dmrPlusBar);
    }
  }

  const cid = (targetHs && targetHs.id) || card.dataset.hotspotId || "default";
  const curRef = String((targetHs && targetHs.dmrplus_reflector) || "").trim();

  const refNames = {
    "4530": "RU",
    "4001": "DL",
    "4030": "OE",
    "4020": "HB",
    "4400": "UK",
    "4500": "EA",
    "4700": "US",
    "4800": "PT"
  };
  const curRefSuffix = refNames[curRef] ? ` ${refNames[curRef]}` : "";
  const curRefDisplay = curRef ? `${curRef}${curRefSuffix}` : (window.t ? window.t("dmrplus.ref_unlinked", {}, "Отключен") : "Отключен");

  const refLabel = window.t ? window.t("dmrplus.reflector_label", {}, "Рефлектор:") : "Рефлектор:";
  const unlinkTitle = window.t ? window.t("dmrplus.unlink_btn", {}, "4000 Отключить") : "4000 Отключить";
  const statusTitle = window.t ? window.t("dmrplus.status_btn", {}, "5000 Статус") : "5000 Статус";
  const quickTitle = window.t ? window.t("dmrplus.quick_ref_title", {}, "Быстрое переключение рефлектора DMR+") : "Быстрое переключение рефлектора DMR+";

  dmrPlusBar.innerHTML = `
    <div class="dmrplus-ref-header">
      <div class="dmrplus-ref-current" title="${window.t ? window.t("dmrplus.ref_current_title", {}, `Current TS2 reflector (Voice on TG 9)`) : `Current TS2 reflector (Voice on TG 9)`}">
        <span class="dmrplus-ref-icon">📡</span>
        <span class="dmrplus-ref-label">${refLabel}</span>
        <span class="dmrplus-ref-badge ${curRef ? 'active' : 'unlinked'}">${curRefDisplay}</span>
      </div>
      <div class="dmrplus-ref-actions">
        <button type="button" class="btn-dmrplus-action btn-dmrplus-unlink" title="${unlinkTitle}">🔌 4000</button>
        <button type="button" class="btn-dmrplus-action btn-dmrplus-status" title="${statusTitle}">ℹ️ 5000</button>
        <button type="button" class="btn-dmrplus-action btn-dmrplus-custom" title="${window.t ? window.t("dmrplus.ref_custom_title", {}, `Enter reflector number (4001–4999)`) : `Enter reflector number (4001–4999)`}">🔢 4xxx</button>
      </div>
    </div>
    <div class="dmrplus-ref-quick-row">
      <span class="dmrplus-quick-label" title="${quickTitle}">⚡</span>
      <div class="dmrplus-quick-btns">
        <button type="button" class="btn-dmrplus-quick ${curRef === '4530' ? 'active' : ''}" data-ref="4530" title="${safeEscapeHtml(window.t ? window.t("dmrplus.quick_4530_title", {}, "4530 RU (Russia / CIS)") : "4530 RU (Russia / CIS)")}">🇷🇺 4530</button>
        <button type="button" class="btn-dmrplus-quick ${curRef === '4001' ? 'active' : ''}" data-ref="4001" title="${safeEscapeHtml(window.t ? window.t("dmrplus.quick_4001_title", {}, "4001 DL (Germany general)") : "4001 DL (Germany general)")}">🇩🇪 4001</button>
        <button type="button" class="btn-dmrplus-quick ${curRef === '4030' ? 'active' : ''}" data-ref="4030" title="${safeEscapeHtml(window.t ? window.t("dmrplus.quick_4030_title", {}, "4030 OE (Austria)") : "4030 OE (Austria)")}">🇦🇹 4030</button>
        <button type="button" class="btn-dmrplus-quick ${curRef === '4400' ? 'active' : ''}" data-ref="4400" title="${safeEscapeHtml(window.t ? window.t("dmrplus.quick_4400_title", {}, "4400 UK (United Kingdom)") : "4400 UK (United Kingdom)")}">🇬🇧 4400</button>
        <button type="button" class="btn-dmrplus-quick ${curRef === '4700' ? 'active' : ''}" data-ref="4700" title="${safeEscapeHtml(window.t ? window.t("dmrplus.quick_4700_title", {}, "4700 US (North America)") : "4700 US (North America)")}">🇺🇸 4700</button>
        <button type="button" class="btn-dmrplus-quick ${curRef === '4800' ? 'active' : ''}" data-ref="4800" title="${safeEscapeHtml(window.t ? window.t("dmrplus.quick_4800_title", {}, "4800 PT (Brazil)") : "4800 PT (Brazil)")}">🇧🇷 4800</button>
      </div>
    </div>
  `;

  dmrPlusBar.querySelectorAll(".btn-dmrplus-quick").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      linkHotspotDmrPlusReflector(cid, btn.dataset.ref);
    };
  });

  const btnUnlink = dmrPlusBar.querySelector(".btn-dmrplus-unlink");
  if (btnUnlink) {
    btnUnlink.onclick = (e) => {
      e.stopPropagation();
      linkHotspotDmrPlusReflector(cid, 4000);
    };
  }

  const btnStatus = dmrPlusBar.querySelector(".btn-dmrplus-status");
  if (btnStatus) {
    btnStatus.onclick = (e) => {
      e.stopPropagation();
      linkHotspotDmrPlusReflector(cid, 5000);
    };
  }

  const btnCustom = dmrPlusBar.querySelector(".btn-dmrplus-custom");
  if (btnCustom) {
    btnCustom.onclick = (e) => {
      e.stopPropagation();
      const promptText = window.t ? window.t("dmrplus.prompt_reflector", {}, "Введите номер рефлектора DMR+ (4001–4999):") : "Введите номер рефлектора DMR+ (4001–4999):";
      const userVal = prompt(promptText, curRef || "4530");
      if (userVal !== null && userVal.trim()) {
        const parsed = parseInt(userVal.trim(), 10);
        if (!isNaN(parsed) && parsed > 0) {
          linkHotspotDmrPlusReflector(cid, parsed);
        }
      }
    };
  }
}



export function openAllStarDtmfPopover(cid, anchorEl) {
  document.querySelectorAll(".allstar-dtmf-popover").forEach(el => el.remove());
  const popover = document.createElement("div");
  popover.className = "allstar-dtmf-popover";

  const keys = [
    ["1", "2", "3", "A"],
    ["4", "5", "6", "B"],
    ["7", "8", "9", "C"],
    ["*", "0", "#", "D"]
  ];

  let html = `<div class="dtmf-popover-header"><span>⌨️ DTMF Keypad</span><button type="button" class="btn-close-dtmf">✕</button></div>`;
  html += `<div class="dtmf-grid">`;
  keys.forEach(row => {
    html += `<div class="dtmf-row">`;
    row.forEach(k => {
      html += `<button type="button" class="btn-dtmf-key" data-key="${k}">${k}</button>`;
    });
    html += `</div>`;
  });
  html += `</div>`;
  html += `<div class="dtmf-quick-actions">
    <button type="button" class="btn-dtmf-cmd" data-cmd="*70" title="Node Status">ℹ️ *70</button>
    <button type="button" class="btn-dtmf-cmd" data-cmd="*81" title="Say Time">⏰ *81</button>
    <button type="button" class="btn-dtmf-cmd" data-cmd="*73" title="Unlink All">🔌 *73</button>
  </div>`;

  popover.innerHTML = html;
  document.body.appendChild(popover);

  const rect = anchorEl.getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.top = `${Math.min(window.innerHeight - 250, rect.bottom + 6)}px`;
  popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 220, rect.left - 40))}px`;
  popover.style.zIndex = "10050";

  const sendDtmfKey = (k) => {
    const ws = (typeof getWs === "function" ? getWs() : window.ws);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "allstar_dtmf", hotspot_id: cid, digit: k }));
    }
    if (typeof showToast === "function") {
      showToast(`DTMF: ${k}`, "info", 1000);
    }
  };

  popover.querySelectorAll(".btn-dtmf-key").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      sendDtmfKey(btn.dataset.key);
    };
  });

  popover.querySelectorAll(".btn-dtmf-cmd").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const cmd = btn.dataset.cmd;
      if (cmd === "*73") {
        const hsObj = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(h => resolveHotspotId(h.id) === cid || h.id === cid);
        if (hsObj) {
          hsObj._aslDynamicMatrixMode = false;
          hsObj.asl_unlisted_links = [];
          if (hsObj._aslDismissedUnlisted) hsObj._aslDismissedUnlisted.clear();
        }
      }
      for (const ch of cmd) {
        sendDtmfKey(ch);
      }
    };
  });

  popover.querySelector(".btn-close-dtmf").onclick = (e) => {
    e.stopPropagation();
    popover.remove();
  };

  const onDocClick = (e) => {
    if (!popover.contains(e.target) && e.target !== anchorEl) {
      popover.remove();
      document.removeEventListener("click", onDocClick);
    }
  };
  setTimeout(() => document.addEventListener("click", onDocClick), 50);
}

function renderActiveLinkChipsHtml(targetHs, cid) {
  const activeLinks = (targetHs && targetHs.asl_links) || [];
  const connNode = String((targetHs && (targetHs.connected_node || targetHs.target_node)) || "").trim();
  const isLinked = Boolean(connNode && connNode !== "0");

  const list = (activeLinks.length > 0)
    ? activeLinks
    : (isLinked ? [{ node: connNode, mode: (typeof window.getHotspotAslMode === "function" ? window.getHotspotAslMode(cid) : "*2"), flag: "🌐", clients: targetHs.asl_online_count || 1 }] : []);

  if (!list.length) return "";

  return list.map(lk => {
    const isConnecting = (lk.connecting === true || lk.status === "connecting");
    const isTx = (lk.mode === "*3");
    let chipClass = "asl-chip-mode-monitor";
    let modeLabel = window.t ? window.t("asl.chip_mode_monitor", {}, "*2 Monitor (Green)") : "*2 Monitor (Green)";
    if (isConnecting) {
      chipClass = "asl-chip-mode-connecting";
      modeLabel = window.t ? window.t("asl.chip_mode_connecting", {}, "Connecting (up to 9s)...") : "Connecting (up to 9s)...";
    } else if (isTx) {
      chipClass = "asl-chip-mode-tx";
      modeLabel = window.t ? window.t("asl.chip_mode_tx", {}, "*3 RX/TX (Red)") : "*3 RX/TX (Red)";
    }
    const cleanNode = safeEscapeHtml(lk.node);
    const titleText = isConnecting
      ? (window.t ? window.t("asl.chip_title_connecting", { node: cleanNode }, `Node #${cleanNode}: Connecting (waiting up to 9s)... Click ✕: cancel`) : `Node #${cleanNode}: Connecting (waiting up to 9s)... Click ✕: cancel`)
      : (window.t ? window.t("asl.chip_title_linked", { node: cleanNode, mode: modeLabel }, `Node #${cleanNode}: ${modeLabel}. Click: switch mode, Click ✕: disconnect`) : `Node #${cleanNode}: ${modeLabel}. Click: switch mode, Click ✕: disconnect`);
    const clientCountStr = (!isConnecting && lk.clients !== undefined) ? ` (${lk.clients})` : "";
    return `
      <div class="asl-link-chip ${chipClass}" data-node="${cleanNode}" data-mode="${safeEscapeHtml(lk.mode || "*2")}" data-connecting="${isConnecting ? "1" : "0"}" title="${safeEscapeHtml(titleText)}">
        <span class="chip-flag">${safeEscapeHtml(lk.flag || "🌐")}</span>
        <span class="chip-text">${cleanNode}${clientCountStr}</span>
        <span class="chip-del" data-del-node="${cleanNode}" title="${safeEscapeHtml(window.t ? window.t("asl.unlink_chip_title", { node: cleanNode }, `Disconnect node #${cleanNode}`) : `Disconnect node #${cleanNode}`)}">✕</span>
      </div>
    `;
  }).join("");
}

function setupActiveLinkChipHandlers(linksBar, cid, targetHs, card) {
  if (!linksBar) return;
  linksBar.querySelectorAll(".chip-del").forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nodeToDel = btn.dataset.delNode;
      if (!nodeToDel) return;
      fetch("/api/allstar/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hotspot_id: cid, target_node: nodeToDel })
      })
      .then(r => r.json())
      .then(() => {
        if (typeof showToast === "function") {
          showToast(window.t ? window.t("asl.node_disconnected_toast", { node: nodeToDel }, `Node #${nodeToDel} disconnected`) : `Node #${nodeToDel} disconnected`, "info", 1500);
        }
        if (targetHs && targetHs.asl_links) {
          targetHs.asl_links = targetHs.asl_links.filter(x => String(x.node) !== String(nodeToDel));
          targetHs.asl_online_count = targetHs.asl_links.length;
          targetHs.connected_node = targetHs.asl_links.length > 0 ? targetHs.asl_links[0].node : "";
          targetHs.is_asl_linked = Boolean(targetHs.connected_node);
          if (targetHs.is_asl_linked) {
            targetHs.status = "ONLINE";
            if (typeof updateBmStatus === "function") updateBmStatus("ONLINE", `Node ${targetHs.connected_node}`, cid);
          } else {
            targetHs.status = "ONLINE";
            const aslActiveMsg = window.t ? window.t("asl.status_active", {}, "AllStarLink active") : "AllStarLink active";
            if (typeof updateBmStatus === "function") updateBmStatus("ONLINE", targetHs.allstar_node ? `Node ${targetHs.allstar_node}` : aslActiveMsg, cid);
          }
        }
        if (typeof window.updateCardAllStarPanel === "function") {
          window.updateCardAllStarPanel(card, targetHs);
        }
        if (typeof window.updateCardBmBanner === "function") {
          window.updateCardBmBanner(card, targetHs);
        }
      })
      .catch(() => {});
    };
  });

  linksBar.querySelectorAll(".asl-link-chip").forEach(chip => {
    chip.onclick = (e) => {
      e.stopPropagation();
      if (chip.classList.contains("asl-chip-mode-connecting")) {
        if (typeof showToast === "function") {
          const cNode = chip.dataset.node || "";
          showToast(window.t ? window.t("asl.node_still_connecting_toast", { node: cNode }, `Node #${cNode} is still connecting (9s timeout)...`) : `Node #${cNode} is still connecting (9s timeout)...`, "info", 1500);
        }
        return;
      }
      const nodeNum = chip.dataset.node;
      const curMode = chip.dataset.mode || "*2";
      const nextMode = (curMode === "*2") ? "*3" : "*2";
      const nextName = (nextMode === "*3")
        ? (window.t ? window.t("asl.chip_mode_tx_short", {}, "RX/TX (*3, Red)") : "RX/TX (*3, Red)")
        : (window.t ? window.t("asl.chip_mode_monitor_short", {}, "Monitor (*2, Green)") : "Monitor (*2, Green)");

      if (targetHs) {
        targetHs._aslConnectingNodes = targetHs._aslConnectingNodes || new Map();
        targetHs.asl_links = targetHs.asl_links || [];

        // STRICT GUARD: When switching chip to *3 mode, demote any other *3 node on UI with dashed green
        if (nextMode === "*3") {
          targetHs.asl_links.forEach(lk => {
            const otherN = String(lk.node).trim();
            if (otherN !== String(nodeNum).trim() && lk.mode === "*3") {
              lk.connecting = true;
              lk.mode = "*2";
              targetHs._aslConnectingNodes.set(otherN, { mode: "*2", startedAt: Date.now() });
            }
          });
        }

        targetHs._aslConnectingNodes.set(String(nodeNum).trim(), { mode: nextMode, startedAt: Date.now() });
        const item = targetHs.asl_links.find(x => String(x.node).trim() === String(nodeNum).trim());
        if (item) {
          item.mode = nextMode;
          item.connecting = true;
        }
        syncAslMatrixButtonsState(card, targetHs);
        if (typeof window.updateCardAllStarPanel === "function") {
          window.updateCardAllStarPanel(card, targetHs);
        }
      }

      fetch("/api/allstar/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotspot_id: cid,
          target_node: nodeNum,
          mode: nextMode
        })
      })
      .then(r => r.json())
      .then(() => {
        if (typeof showToast === "function") {
          showToast(window.t ? window.t("asl.node_switching_mode_toast", { node: nodeNum, mode: nextName }, `Node #${nodeNum}: switching to ${nextName}...`) : `Node #${nodeNum}: switching to ${nextName}...`, "info", 1800);
        }
        setTimeout(() => { if (typeof fetchAslLinks === "function") fetchAslLinks(); }, 400);
      })
      .catch(() => {});
    };
  });
}


export async function fetchDirectAslNodeStats(nodeStr) {
  const n = String(nodeStr || "").trim();
  if (!n || !/^\d+$/.test(n) || n === "1999" || n === "9998" || n === "9999") {
    return null;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(`https://stats.allstarlink.org/api/stats/${encodeURIComponent(n)}`, {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const json = await res.json();
    const data = (json && (json.stats?.data || json.stats || json.data)) || {};

    const linked = data.linkedNodes || data.links || [];
    const links_count = Array.isArray(linked) ? linked.length : (parseInt(data.links_count, 10) || 0);
    const keyed = Boolean(data.keyed);
    const uptimeSec = Math.max(1, parseInt(data.apprptuptime, 10) || 0);
    const txSec = Math.max(0, parseInt(data.totaltxtime, 10) || 0);
    const keyups = Math.max(0, parseInt(data.totalkeyups, 10) || 0);

    let tx_duty_pct = 0.0;
    let keyups_per_hour = 0.0;
    if (uptimeSec >= 60) {
      tx_duty_pct = Math.round(Math.min(100.0, (txSec / uptimeSec) * 100.0) * 10) / 10;
      keyups_per_hour = Math.round((keyups / Math.max(0.1, uptimeSec / 3600.0)) * 10) / 10;
    }

    let traffic_level = "low";
    if (keyed) {
      traffic_level = "live";
    } else if (tx_duty_pct >= 8.0 || keyups_per_hour >= 35.0 || links_count >= 20) {
      traffic_level = "high";
    } else if (tx_duty_pct >= 1.5 || keyups_per_hour >= 6.0 || links_count >= 3) {
      traffic_level = "medium";
    }

    const telemetry = {
      node: n,
      online: true,
      links_count,
      keyed,
      traffic_level,
      tx_duty_pct,
      keyups_per_hour,
      checked_stats: true,
      checked_at: Math.floor(Date.now() / 1000)
    };

    // Feed back to backend asynchronously so server cache and other clients get fresh data
    fetch("/api/allstar/feed-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node: n, stats: data })
    }).catch(() => {});

    return telemetry;
  } catch (e) {
    clearTimeout(timeoutId);
    return null;
  }
}

let _isProcessingDirectStatsQueue = false;

export async function processDirectStatsQueue(nodesList, card, targetHs) {
  if (_isProcessingDirectStatsQueue || !Array.isArray(nodesList) || !nodesList.length) return;
  _isProcessingDirectStatsQueue = true;
  try {
    for (const rawNode of nodesList) {
      const n = String(rawNode).trim();
      if (!n || n === "1999" || n === "9998" || n === "9999") continue;

      // Check if already refreshed recently (within 5 minutes)
      const existing = (window._aslGlobalNodeProbeCache && window._aslGlobalNodeProbeCache[n]) || null;
      if (existing && existing.checked_stats && (Date.now() - (existing.checked_at || 0) * 1000) < 300000) {
        continue;
      }

      try {
        const direct = await fetchDirectAslNodeStats(n);
        if (direct && targetHs) {
          targetHs._aslNodeProbeMap = targetHs._aslNodeProbeMap || {};
          const cur = targetHs._aslNodeProbeMap[n] || { node: n, online: true, pong: true };
          Object.assign(cur, direct);
          targetHs._aslNodeProbeMap[n] = cur;
          if (window._aslGlobalNodeProbeCache) {
            window._aslGlobalNodeProbeCache[n] = cur;
          }
          if (card) {
            syncAslMatrixButtonsState(card, targetHs);
          }
        }
      } catch (err) {
        console.debug(`[ALLSTAR] Direct stats error for #${n}:`, err);
      }

      // Sequential pacing with random delay 250-1000 ms strictly per user instruction
      const delay = Math.floor(250 + Math.random() * 750);
      await new Promise(r => setTimeout(r, delay));
    }
  } finally {
    _isProcessingDirectStatsQueue = false;
  }
}

const _aslMatrixProbeStateByCid = new Map();

export async function probeAslMatrixNodes(card, targetHs, force = false) {
  if (!card || !targetHs) return;
  // Бэкенд опрашивает максимум 35 узлов, а HTTP-статистику — только при ≤ 20: опрашиваем ТОЛЬКО текущий экран памяти
  const cid = targetHs.id || card.dataset.hotspotId || "default";
  const stateKey = resolveHotspotId(cid) || cid;
  const probePage = getAslMatrixPage(cid, targetHs);
  const nowMs = Date.now();
  const probeState = _aslMatrixProbeStateByCid.get(stateKey) || { inFlight: false, lastTs: 0, lastPage: null };
  if (
    !force &&
    probeState.lastPage === probePage &&
    (probeState.inFlight || (nowMs - probeState.lastTs < 5000))
  ) {
    return;
  }
  let buttons = card.querySelectorAll(`.asl-page[data-page="${probePage}"] .btn-allstar-node`);
  if (!buttons.length) buttons = card.querySelectorAll(".btn-allstar-node");
  if (!buttons.length) return;

  const nodes = [];
  buttons.forEach(b => {
    if (b.dataset.role === "dtmf") return;
    const n = String(b.dataset.node || "").trim();
    if (n && n !== "0") nodes.push(n);
  });
  if (!nodes.length) return;

  probeState.inFlight = true;
  probeState.lastTs = nowMs;
  probeState.lastPage = probePage;
  _aslMatrixProbeStateByCid.set(stateKey, probeState);
  try {
    const res = await fetch("/api/allstar/matrix-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hotspot_id: cid, nodes, force: Boolean(force) })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.nodes) {
        window._aslGlobalNodeProbeCache = window._aslGlobalNodeProbeCache || {};
        Object.assign(window._aslGlobalNodeProbeCache, data.nodes);
        targetHs._aslNodeProbeMap = Object.assign(targetHs._aslNodeProbeMap || {}, data.nodes);
        syncAslMatrixButtonsState(card, targetHs);

        // Fallback: check if memory buttons have online nodes with 0 links due to server stats block
        const needsDirect = Object.entries(data.nodes)
          .filter(([n, p]) => (
            p && p.online && p.links_count === 0 && (data.stats_api_ok === false || !p.checked_stats) && n !== "1999" && n !== "9998" && n !== "9999"
          ))
          .map(([n]) => n);

        if (needsDirect.length > 0) {
          processDirectStatsQueue(needsDirect, card, targetHs);
        }
      }
    }
  } catch (err) {
    console.debug("[ALLSTAR] Matrix probe error:", err);
  } finally {
    probeState.inFlight = false;
  }
}

if (typeof window !== "undefined" && !window._aslMatrixProbeInterval) {
  window._aslMatrixProbeInterval = setInterval(() => {
    if (window.isSessionPausedByAnotherDevice) return;
    try {
      const hsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []);
      const aslHs = hsList.find(h => ((h && h.network_type) || "").toLowerCase() === "allstar");
      if (!aslHs) return;
      const cid = aslHs.id || "default";
      const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
      if (card && typeof probeAslMatrixNodes === "function") {
        probeAslMatrixNodes(card, aslHs, false);
      }
    } catch (_) {}
  }, 120000); // 2 minutes (gentle background poll)
}


// =========================================================================
// ASL CONNECTION LIFECYCLE PROCEDURES & STATUS BANNER
// =========================================================================

const ASL_PROC_FALLBACK_TEXTS = {
  disc_init: "Disconnecting #{node}: sending reset...",
  disc_all_init: "Resetting links (*73): sending command...",
  disc_closing: "Disconnecting #{node}: closing IAX2 channel...",
  disc_ok: "✓ Node #{node} disconnected (channel closed)",
  disc_all_ok: "✓ All nodes disconnected (channel clear)",
  disc_timeout: "✕ Disconnect failed #{node}: channel timeout",
  conn_dns: "Node #{node}: resolving address in ASL database...",
  conn_dns_fail: "✕ Connection failed #{node}: node not found in ASL DNS",
  conn_calling: "Node #{node} ({ip}): requesting IAX2 ({mode})...",
  conn_token: "Node #{node}: verifying token (CTOKEN)...",
  conn_verifying: "Node #{node}: answer received, awaiting hub admission...",
  conn_ok: "✓ Node #{node}: accepted and connected ({mode})",
  conn_rejected: "✕ Rejected #{node}: call reset by remote hub (HANGUP)",
  conn_timeout: "✕ Unreachable #{node} ({ip}): no answer (timeout)"
};

export function formatAslProcMessage(data) {
  if (!data) return "";
  const code = data.code || "";
  const node = data.node || "";
  const mode = data.mode || "*2";
  const ip = data.ip || "";
  const key = "asl_proc." + code;
  const fb = (ASL_PROC_FALLBACK_TEXTS[code] || data.text || "")
    .replace(/\{node\}/g, node).replace(/\{mode\}/g, mode).replace(/\{ip\}/g, ip);

  let text = "";
  if (code && typeof window.t === "function") {
    text = window.t(key, { node, mode, ip }, fb);
  }
  if (!text || text === key) {
    text = fb;
  }
  return text || data.text || code;
}

export function setAslProcBannerState(card, {
  active = true,
  text = "",
  tone = "neutral",
  autoHideMs = 0,
  fadeOutMs = 2000
} = {}) {
  if (!card) return;
  const clockBar = card.querySelector(".screen-clock-bar");
  if (!clockBar) return;

  let bannerEl = clockBar.querySelector(".asl-proc-clock-banner");
  if (!bannerEl) {
    bannerEl = document.createElement("div");
    bannerEl.className = "asl-proc-clock-banner";
    bannerEl.setAttribute("aria-live", "polite");
    bannerEl.setAttribute("aria-hidden", "true");
    const span = document.createElement("span");
    span.className = "asl-proc-clock-text";
    bannerEl.appendChild(span);
    clockBar.appendChild(bannerEl);
  }
  let textEl = bannerEl.querySelector(".asl-proc-clock-text");
  if (!textEl) {
    textEl = document.createElement("span");
    textEl.className = "asl-proc-clock-text";
    bannerEl.textContent = "";
    bannerEl.appendChild(textEl);
  }

  if (card._aslBannerHideTimer) {
    clearTimeout(card._aslBannerHideTimer);
    card._aslBannerHideTimer = null;
  }
  if (card._aslBannerFadeTimer) {
    clearTimeout(card._aslBannerFadeTimer);
    card._aslBannerFadeTimer = null;
  }

  // На случай вызова после устаревших состояний в .screen-top-bar снимаем старые классы
  const screenTopBar = card.querySelector(".screen-top-bar");
  const modeBadge = card.querySelector(".mode-badge");
  if (screenTopBar) {
    screenTopBar.classList.remove("asl-proc-banner-active");
  }
  if (modeBadge) {
    modeBadge.classList.remove("asl-tone-neutral", "asl-tone-positive", "asl-tone-negative");
  }

  if (!active) {
    clockBar.classList.remove("asl-proc-clock-active");
    bannerEl.classList.remove(
      "asl-proc-banner-active",
      "asl-proc-banner-fading",
      "asl-tone-neutral",
      "asl-tone-positive",
      "asl-tone-negative"
    );
    bannerEl.style.removeProperty("--asl-fade-ms");
    bannerEl.setAttribute("aria-hidden", "true");
    return;
  }

  const safeFadeMs = (typeof fadeOutMs === "number" && fadeOutMs > 0) ? fadeOutMs : 2000;
  clockBar.classList.add("asl-proc-clock-active");
  bannerEl.classList.remove(
    "asl-proc-banner-fading",
    "asl-tone-neutral",
    "asl-tone-positive",
    "asl-tone-negative"
  );
  bannerEl.style.setProperty("--asl-fade-ms", `${safeFadeMs}ms`);
  bannerEl.classList.add("asl-proc-banner-active", `asl-tone-${tone}`);
  bannerEl.setAttribute("aria-hidden", "false");
  textEl.textContent = text;
  bannerEl.title = text;

  if (autoHideMs > 0) {
    card._aslBannerHideTimer = setTimeout(() => {
      card._aslBannerHideTimer = null;
      bannerEl.classList.add("asl-proc-banner-fading");
      card._aslBannerFadeTimer = setTimeout(() => {
        card._aslBannerFadeTimer = null;
        clockBar.classList.remove("asl-proc-clock-active");
        bannerEl.classList.remove(
          "asl-proc-banner-active",
          "asl-proc-banner-fading",
          "asl-tone-neutral",
          "asl-tone-positive",
          "asl-tone-negative"
        );
        bannerEl.style.removeProperty("--asl-fade-ms");
        bannerEl.setAttribute("aria-hidden", "true");
      }, safeFadeMs);
    }, autoHideMs);
  }
}

export function aslDisconnectNodeProcedure(cid, targetNode = "all", {
  showStatusBanner = true,
  showCardEffects = true
} = {}) {
  const card = document.querySelector(`.dmr-card[data-hotspot-id="${cid}"]`) || document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) || document.querySelector(".dmr-card");
  const hsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : (window.currentHotspots || []));
  const targetHs = hsList.find(h => String(h.id) === String(cid)) || hsList[0] || null;
  const cleanN = String(targetNode || "").trim();

  if (targetHs) {
    if (!targetHs._aslDisconnectingNodes) {
      targetHs._aslDisconnectingNodes = new Set();
    }
    if (cleanN && cleanN !== "all") {
      targetHs._aslDisconnectingNodes.add(cleanN);
    } else {
      targetHs._aslDisconnectingNodes.add("all");
      if (Array.isArray(targetHs.asl_links)) {
        targetHs.asl_links.forEach(l => { if (l && l.node) targetHs._aslDisconnectingNodes.add(String(l.node).trim()); });
      }
      if (targetHs.connected_node) {
        targetHs._aslDisconnectingNodes.add(String(targetHs.connected_node).trim());
      }
    }

    if (showCardEffects && card) {
      syncAslMatrixButtonsState(card, targetHs);
    }
  }

  if (showStatusBanner && card) {
    const isAll = (!cleanN || cleanN === "all" || cleanN === "*73");
    const initCode = isAll ? "disc_all_init" : "disc_init";
    const initMsg = formatAslProcMessage({ code: initCode, node: cleanN });
    setAslProcBannerState(card, { active: true, text: initMsg, tone: "neutral", autoHideMs: 0 });
  }

  const ws = (typeof getWs === "function" ? getWs() : window.ws);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "allstar_disconnect_node",
      hotspot_id: cid,
      node: cleanN,
      show_status_banner: showStatusBanner,
      show_card_effects: showCardEffects
    }));
  } else {
    fetch("/api/allstar/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotspot_id: cid,
        target_node: cleanN,
        show_status_banner: showStatusBanner,
        show_card_effects: showCardEffects
      })
    }).catch(e => console.warn("[ASL] Disconnect fetch error:", e));
  }
}

export function aslConnectNodeProcedure(cid, targetNode, mode = "*2", {
  showStatusBanner = true,
  showCardEffects = true,
  fromDice = false
} = {}) {
  const card = document.querySelector(`.dmr-card[data-hotspot-id="${cid}"]`) || document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) || document.querySelector(".dmr-card");
  const hsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : (window.currentHotspots || []));
  const targetHs = hsList.find(h => String(h.id) === String(cid)) || hsList[0] || null;
  if (!fromDice && targetHs && targetHs._aslDiceRolling) {
    stopAslDiceSearch(cid, card, targetHs, { immediateAbort: true, silent: true });
  }
  const cleanN = String(targetNode || "").trim();
  const isEchoNode = (cleanN === "1999" || cleanN === "9999");
  const cleanMode = (isEchoNode || mode === "*3" || mode === "perm" || mode === "transceive") ? "*3" : "*2";

  if (targetHs) {
    const existingNode = String(targetHs.connected_node || (Array.isArray(targetHs.asl_links) && targetHs.asl_links[0] && targetHs.asl_links[0].node) || "").trim();
    const isSameNode = existingNode && cleanN && (existingNode === cleanN);
    const hasExisting = Boolean(targetHs.connected_node || (Array.isArray(targetHs.asl_links) && targetHs.asl_links.length > 0));

    if (isSameNode) {
      if (targetHs._aslDisconnectingNodes) targetHs._aslDisconnectingNodes.delete(cleanN);
      if (!targetHs._aslConnectingNodes) targetHs._aslConnectingNodes = new Map();
      targetHs._aslConnectingNodes.set(cleanN, { mode: cleanMode, startedAt: Date.now() });
    } else if (hasExisting) {
      if (!targetHs._aslDisconnectingNodes) targetHs._aslDisconnectingNodes = new Set();
      if (targetHs.connected_node) targetHs._aslDisconnectingNodes.add(String(targetHs.connected_node).trim());
      if (Array.isArray(targetHs.asl_links)) {
        targetHs.asl_links.forEach(l => { if (l && l.node) targetHs._aslDisconnectingNodes.add(String(l.node).trim()); });
      }
      if (!targetHs._aslConnectingNodes) targetHs._aslConnectingNodes = new Map();
      targetHs._aslConnectingNodes.set(cleanN, { mode: cleanMode, startedAt: Date.now() });
    } else {
      if (!targetHs._aslConnectingNodes) targetHs._aslConnectingNodes = new Map();
      targetHs._aslConnectingNodes.set(cleanN, { mode: cleanMode, startedAt: Date.now() });
    }

    targetHs._aslLinkMode = cleanMode;
    if (typeof window.setHotspotAslMode === "function") {
      window.setHotspotAslMode(cid, cleanMode);
    }
    if (typeof window.updateHotspotTsAudioModeUI === "function") {
      window.updateHotspotTsAudioModeUI(cid);
    }

    if (showCardEffects && card) {
      syncAslMatrixButtonsState(card, targetHs);
    }
  }

  if (showStatusBanner && card) {
    const initMsg = formatAslProcMessage({ code: "conn_dns", node: cleanN, mode: cleanMode });
    setAslProcBannerState(card, { active: true, text: initMsg, tone: "neutral", autoHideMs: 0 });
  }

  const ws = (typeof getWs === "function" ? getWs() : window.ws);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "allstar_connect_node",
      hotspot_id: cid,
      node: cleanN,
      mode: cleanMode,
      show_status_banner: showStatusBanner,
      show_card_effects: showCardEffects
    }));
  } else {
    fetch("/api/allstar/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotspot_id: cid,
        target_node: cleanN,
        mode: cleanMode,
        show_status_banner: showStatusBanner,
        show_card_effects: showCardEffects
      })
    }).catch(e => console.warn("[ASL] Connect fetch error:", e));
  }
}

export function syncAslMatrixButtonsState(card, targetHs) {
  if (!card || !targetHs) return;
  const buttons = card.querySelectorAll(".btn-allstar-node");
  if (!buttons.length) return;

  const rawLinks = Array.isArray(targetHs.asl_links) ? targetHs.asl_links : [];
  const linkedModesMap = new Map();
  const connectingModesMap = new Map();
  const keyedSet = new Set();

  if (targetHs._aslConnectingNodes instanceof Map) {
    const now = Date.now();
    for (const [cn, info] of targetHs._aslConnectingNodes.entries()) {
      if (now - info.startedAt < 30000) {
        connectingModesMap.set(cn, info.mode === "*3" ? "*3" : "*2");
      } else {
        targetHs._aslConnectingNodes.delete(cn);
      }
    }
  }

  if (rawLinks.length > 0) {
    rawLinks.forEach(lk => {
      if (lk && lk.node) {
        const cn = String(lk.node).trim();
        const mode = lk.mode === "*3" ? "*3" : "*2";
        if (lk.connecting || lk.status === "connecting") {
          connectingModesMap.set(cn, mode);
        } else {
          linkedModesMap.set(cn, mode);
          if (targetHs._aslConnectingNodes instanceof Map) {
            targetHs._aslConnectingNodes.delete(cn);
          }
          if (lk.keyed) {
            keyedSet.add(cn);
          }
        }
      }
    });
  } else {
    const connNode = String(targetHs.connected_node || targetHs.target_node || "").trim();
    if (connNode && connNode !== "0") {
      const cid = targetHs.id || card.dataset.hotspotId || "default";
      const fallbackMode = (typeof window.getHotspotAslMode === "function" ? window.getHotspotAslMode(cid) : "*2");
      linkedModesMap.set(connNode, fallbackMode);
      if (targetHs._aslConnectingNodes instanceof Map) {
        targetHs._aslConnectingNodes.delete(connNode);
      }
    }
  }

  if (targetHs._aslRxActiveNode) {
    keyedSet.add(String(targetHs._aslRxActiveNode).trim());
  }
  if (Array.isArray(targetHs._aslKeyedNodes)) {
    targetHs._aslKeyedNodes.forEach(kn => keyedSet.add(String(kn).trim()));
  }

  const matrixNodeSet = new Set();
  const probeMap = Object.assign({}, window._aslGlobalNodeProbeCache || {}, targetHs._aslNodeProbeMap || {});
  const disconnectingSet = targetHs._aslDisconnectingNodes || new Set();
  buttons.forEach(btn => {
    if (btn.dataset.role === "dtmf") {
      btn.classList.add("asl-node-role-dtmf");
      const connsEl = btn.querySelector(".asl-btn-conns");
      if (connsEl) {
        connsEl.className = "asl-btn-conns asl-conns-dtmf";
        connsEl.textContent = "DTMF";
      }
      return;
    }
    const n = String(btn.dataset.node || "").trim();
    if (n) matrixNodeSet.add(n);
    const linkMode = n ? (linkedModesMap.get(n) || "") : "";
    const connMode = n ? (connectingModesMap.get(n) || "") : "";
    const isDisconnecting = Boolean(n && (disconnectingSet.has(n) || disconnectingSet.has("all")));
    const isEstablished = !isDisconnecting && Boolean(linkMode === "*2" || linkMode === "*3");
    const isConnecting = !isDisconnecting && !isEstablished && Boolean(connMode);

    btn.dataset.linkMode = isEstablished ? linkMode : (isConnecting ? connMode : "");
    btn.dataset.connecting = isConnecting ? "true" : "false";

    btn.classList.toggle("asl-node-linked-monitor", isEstablished && linkMode === "*2");
    btn.classList.toggle("asl-node-linked-tx", isEstablished && linkMode === "*3");

    btn.classList.toggle("asl-node-connecting", isConnecting);
    btn.classList.toggle("asl-node-connecting-monitor", isConnecting && connMode === "*2");
    btn.classList.toggle("asl-node-connecting-tx", isConnecting && connMode === "*3");
    btn.classList.toggle("asl-node-disconnecting", isDisconnecting);

    // Bright blue RX talking glow on memory matrix cards is disabled
    btn.classList.remove("asl-node-rx-talking");

    const descEl = btn.querySelector(".asl-btn-desc");
    const descTxt = descEl ? (descEl.textContent || "").trim() : "";
    const isSetupPlaceholder = !descTxt || descTxt === "[настроить]" || descTxt === "[setup]" || Boolean(window.i18n && window.i18n.isTranslationOf("asl.configure_node_btn", descTxt));
    const label = !isSetupPlaceholder ? descEl.textContent : "";

    const connsEl = btn.querySelector(".asl-btn-conns");
    const probe = n ? probeMap[n] : null;

    if (connsEl) {
      if (isDisconnecting) {
        connsEl.className = "asl-btn-conns asl-conns-connecting";
        connsEl.textContent = "...";
        connsEl.title = window.t ? window.t("asl.conns_disconnecting", { node: n }, `Disconnecting node #${n}...`) : `Disconnecting node #${n}...`;
        btn.classList.remove("asl-node-offline");
      } else if (isConnecting) {
        connsEl.className = "asl-btn-conns asl-conns-connecting";
        connsEl.textContent = "...";
        connsEl.title = window.t ? window.t("asl.conns_connecting", { node: n }, `Connecting to node #${n}...`) : `Connecting to node #${n}...`;
        btn.classList.remove("asl-node-offline");
      } else if (!n || !probe) {
        connsEl.className = "asl-btn-conns asl-conns-hidden";
        connsEl.textContent = "";
        btn.classList.remove("asl-node-offline");
      } else if (!probe.online && linkMode !== "*2" && linkMode !== "*3") {
        btn.classList.add("asl-node-offline");
        connsEl.className = "asl-btn-conns asl-conns-offline";
        connsEl.textContent = "OFF";
        connsEl.title = window.t ? window.t("asl.probe_offline", {}, "Node unavailable / Offline") : "Node unavailable / Offline";
      } else {
        btn.classList.remove("asl-node-offline");
        const isLoc = (n === "1999" || n === "9998" || n === "9999");
        const linksNum = isLoc ? "LOC" : (probe.links_count !== undefined ? probe.links_count : 0);
        const isStale = Boolean(probe.is_stale && !isLoc);
        let connsClass = "asl-conns-zero";
        let connsText = String(linksNum);
        let connsTitle = window.t ? window.t("asl.conns_count", { count: linksNum }, `Active connections: ${linksNum}`) : `Active connections: ${linksNum}`;

        if (isLoc) {
          connsClass = "asl-conns-zero";
          connsText = "LOC";
          connsTitle = window.t ? window.t("asl.conns_echo", {}, "Local Echo / Parrot") : "Local Echo / Parrot";
        } else if (isStale) {
          connsClass = "asl-conns-stale";
          connsText = String(linksNum);
          let ageStr = "";
          if (probe.stats_age_sec !== undefined && probe.stats_age_sec !== null) {
            const m = Math.floor(probe.stats_age_sec / 60);
            const h = Math.floor(m / 60);
            ageStr = h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
          }
          connsTitle = window.t ? window.t("asl.conns_high_activity", { count: linksNum }, `High activity: ${linksNum} connections`) : `High activity: ${linksNum} connections`;
        } else if (probe.keyed) {
          connsClass = "asl-conns-hot";
          connsText = `• ${linksNum}`;
          connsTitle = window.t ? window.t("asl.conns_live_now", {}, "On the air right now 🔥") : "On the air right now 🔥";
        } else if (probe.traffic_level === "high" || (typeof linksNum === "number" && linksNum >= 10)) {
          connsClass = "asl-conns-hot";
          connsTitle = window.t ? window.t("asl.conns_high_activity", { count: linksNum }, `High activity: ${linksNum} connections`) : `High activity: ${linksNum} connections`;
        } else if (probe.traffic_level === "medium" || (typeof linksNum === "number" && linksNum > 0)) {
          connsClass = "asl-conns-active";
          connsTitle = window.t ? window.t("asl.conns_count", { count: linksNum }, `Active connections: ${linksNum}`) : `Active connections: ${linksNum}`;
        } else {
          connsClass = "asl-conns-zero";
          connsText = "0";
          connsTitle = window.t ? window.t("asl.conns_count", { count: 0 }, "Active connections: 0") : "Active connections: 0";
        }

        connsEl.className = `asl-btn-conns ${connsClass}`;
        connsEl.textContent = connsText;
        connsEl.title = connsTitle;
      }
    }

    if (n) {
      let probeSuffix = "";
      if (probe) {
        if (!probe.online && linkMode !== "*2" && linkMode !== "*3") {
          const offLbl = window.t ? window.t("asl.probe_offline", {}, "Node unavailable / Offline") : "Node unavailable / Offline";
          probeSuffix = ` · [⚠️ ${offLbl}]`;
        } else {
          const pInfo = [];
          const connCountStr = window.t ? window.t("asl.conns_count", { count: probe.links_count || 0 }, `Active connections: ${probe.links_count || 0}`) : `Active connections: ${probe.links_count || 0}`;
          pInfo.push(connCountStr);
          if (probe.rtt_ms) pInfo.push(`${probe.rtt_ms}ms`);
          if (probe.tx_duty_pct) {
            const airStr = window.t ? window.t("asl.probe_air", { pct: probe.tx_duty_pct }, `Air: ${probe.tx_duty_pct}%`) : `Air: ${probe.tx_duty_pct}%`;
            pInfo.push(airStr);
          }
          const onlineWord = window.t ? window.t("asl.probe_online", {}, "Online") : "Online";
          probeSuffix = ` · [${onlineWord} · ${pInfo.join(" · ")}]`;
        }
      }
      const lblPrefix = label ? label + " " : "";
      if (linkMode === "*2") {
        btn.title = window.t ? window.t("asl.node_tooltip_monitor", { label: lblPrefix, node: n, probe: probeSuffix }, `${lblPrefix}(#${n}) [Monitor *2] — Click: disconnect node (*1), Hold: action menu${probeSuffix}`) : `${lblPrefix}(#${n}) [Monitor *2] — Click: disconnect node (*1), Hold: action menu${probeSuffix}`;
      } else if (linkMode === "*3") {
        btn.title = window.t ? window.t("asl.node_tooltip_tx", { label: lblPrefix, node: n, probe: probeSuffix }, `${lblPrefix}(#${n}) [Transceive *3] — Click: disconnect node (*1), Hold: action menu${probeSuffix}`) : `${lblPrefix}(#${n}) [Transceive *3] — Click: disconnect node (*1), Hold: action menu${probeSuffix}`;
      } else {
        btn.title = window.t ? window.t("asl.node_tooltip_idle", { label: lblPrefix, node: n, probe: probeSuffix }, `${lblPrefix}(#${n}) - Click: connect, Hold: edit${probeSuffix}`) : `${lblPrefix}(#${n}) - Click: connect, Hold: edit${probeSuffix}`;
      }
    }
  });

  // Индикатор экранов: точка подсвечивается (has-link), если на этом экране есть подключённый узел
  const pageSegs = card.querySelectorAll(".asl-notch-seg");
  if (pageSegs.length) {
    const linkedPages = new Set();
    buttons.forEach(b => {
      if (b.dataset.linkMode === "*2" || b.dataset.linkMode === "*3") {
        const pgEl = b.closest(".asl-page");
        if (pgEl) linkedPages.add(String(pgEl.dataset.page));
      }
    });
    pageSegs.forEach(seg => seg.classList.toggle("has-link", linkedPages.has(String(seg.dataset.page))));
  }

  const unlistedLinks = rawLinks.filter(lk => lk && lk.node && !matrixNodeSet.has(String(lk.node).trim()));
  targetHs.asl_unlisted_links = unlistedLinks;
  updateAslVfoHeader(card, targetHs);
}


// =========================================================================
// ASL MATRIX CARD CONTEXT MENU & MOVE MODE HELPERS
// =========================================================================

const _activeAslMenuCleanups = new Set();
let _activeAslMoveCleanup = null;

export function clearAslMoveCancelListener() {
  if (typeof _activeAslMoveCleanup === "function") {
    try { _activeAslMoveCleanup(); } catch (_) {}
    _activeAslMoveCleanup = null;
  }
}

export function closeAslCardContextMenu(card, targetHs = null) {
  // 1. Всегда вызываем все зарегистрированные cleanup-колбэки на document
  // (даже если сам DOM-элемент .asl-card-context-menu уже был удалён через innerHTML!)
  _activeAslMenuCleanups.forEach(fn => {
    try { fn(); } catch (_) {}
  });
  _activeAslMenuCleanups.clear();

  // 2. Удаляем все DOM-элементы меню
  document.querySelectorAll(".asl-card-context-menu").forEach(el => el.remove());

  if (targetHs) {
    targetHs._aslOpenMenuIdx = null;
  }
}

export function getAslStoredNodes(cid) {
  let raw = null;
  if (hasServerCollectionKey("asl_quick_nodes", cid)) {
    raw = getServerCollectionValue("asl_quick_nodes", cid);
  } else if (hasServerCollectionKey("asl_quick_nodes", "global")) {
    raw = getServerCollectionValue("asl_quick_nodes", "global");
  }
  if (Array.isArray(raw)) return raw;
  try {
    const lsRaw = localStorage.getItem(`proxdmr_asl_quick_nodes_${cid}`) || localStorage.getItem("proxdmr_asl_quick_nodes_global");
    if (lsRaw) {
      const parsed = JSON.parse(lsRaw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return null;
}

export function saveAslUserNodes(cid, userNodes) {
  try {
    const padded = Array.isArray(userNodes) ? userNodes : [];
    setServerCollectionKey("asl_quick_nodes", cid, padded, "proxdmr_asl_quick_nodes_", true);
    setServerCollectionKey("asl_quick_nodes", "global", padded, "proxdmr_asl_quick_nodes_", true);
  } catch (e) {
    console.warn("Failed to save ASL quick nodes:", e);
  }
}

// ── Память узлов ASL: 3 экрана по 20 ячеек (5 рядов × 4 колонки) ──────────────
export const ASL_PAGE_SIZE = 20;
export const ASL_PAGE_COUNT = 3;
export const ASL_MEMORY_SIZE = ASL_PAGE_SIZE * ASL_PAGE_COUNT;
const ASL_PAGE_LS_PREFIX = "proxdmr_asl_matrix_page_";

export function makeEmptyAslCell() {
  return { node: "", label: "", flag: "➕", scan: false };
}

// Дополняет/обрезает массив ячеек ровно до ASL_MEMORY_SIZE (60) пустыми ячейками
export function padAslNodes(list) {
  const out = Array.isArray(list) ? list.slice(0, ASL_MEMORY_SIZE) : [];
  while (out.length < ASL_MEMORY_SIZE) out.push(makeEmptyAslCell());
  return out;
}

// Текущий экран памяти (0..2): сначала в памяти хотспота, затем localStorage
export function getAslMatrixPage(cid, hs) {
  let p = (hs && Number.isInteger(hs._aslMatrixPage)) ? hs._aslMatrixPage : null;
  if (p === null) {
    try {
      p = parseInt(localStorage.getItem(ASL_PAGE_LS_PREFIX + cid) || "0", 10);
    } catch (_) {
      p = 0;
    }
  }
  if (!Number.isInteger(p) || p < 0 || p >= ASL_PAGE_COUNT) p = 0;
  if (hs) hs._aslMatrixPage = p;
  return p;
}

// Устанавливает экран (любое целое число приводится по кругу к 0..2) и запоминает его
export function setAslMatrixPageValue(cid, hs, page) {
  const v = ((page % ASL_PAGE_COUNT) + ASL_PAGE_COUNT) % ASL_PAGE_COUNT;
  if (hs) hs._aslMatrixPage = v;
  try {
    localStorage.setItem(ASL_PAGE_LS_PREFIX + cid, String(v));
  } catch (_) {}
  return v;
}

// Для внешних модулей (contacts.js): переключить экран и перерисовать панель
if (typeof window !== "undefined") {
  window.setAslMatrixPageForCid = (cid, page) => {
    const hsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []);
    const hs = hsList.find(h => h.id === cid) || null;
    setAslMatrixPageValue(cid, hs, page);
    const cardEl = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
    if (cardEl && typeof window.updateCardAllStarPanel === "function") {
      window.updateCardAllStarPanel(cardEl, hs || undefined);
    }
  };
}


export function openAslCardEditPopover({ idx, cid, card, targetHs, userNodes }) {
  document.querySelectorAll(".asl-card-edit-popover").forEach(el => el.remove());
  if (typeof closeAslCardContextMenu === "function") {
    closeAslCardContextMenu(card, targetHs);
  }

  const matrixContainer = card.querySelector(`#aslMatrixContainer_${cid}`) || card.querySelector(".asl-matrix-container") || card;
  matrixContainer.style.position = "relative";

  const curItem = userNodes[idx] || { node: "", label: "", flag: "🌐", role: "node", scan: false };
  const initialIsDtmf = isAslDtmfCard(curItem);
  let selectedRole = initialIsDtmf ? "dtmf" : "node";

  const pop = document.createElement("div");
  pop.className = "asl-card-edit-popover";
  pop.innerHTML = `
    <div class="asl-edit-header">
      <span class="asl-edit-title">${curItem.node ? (window.t ? window.t("asl.edit_cell_title", { idx: idx + 1 }, `✎ Ячейка #${idx + 1}`) : `✎ Ячейка #${idx + 1}`) : (window.t ? window.t("asl.add_cell_title", { idx: idx + 1 }, `➕ Добавить в ячейку #${idx + 1}`) : `➕ Добавить в ячейку #${idx + 1}`)}</span>
      <button type="button" class="asl-edit-close" title="${window.t ? window.t("asl.edit_close_esc", {}, "Закрыть (Esc)") : "Закрыть (Esc)"}">✕</button>
    </div>

    <div class="asl-edit-role-switch">
      <button type="button" class="asl-role-pill ${selectedRole === "node" ? "active-node" : ""}" data-role="node">
        ${window.t ? window.t("asl.role_node_pill", {}, "🌐 Узел") : "🌐 Узел"}
      </button>
      <button type="button" class="asl-role-pill ${selectedRole === "dtmf" ? "active-dtmf" : ""}" data-role="dtmf">
        ${window.t ? window.t("asl.role_dtmf_pill", {}, "☎️ DTMF Макрос") : "☎️ DTMF Макрос"}
      </button>
    </div>

    <div class="asl-edit-row asl-edit-row-autocomplete">
      <label class="asl-edit-label" id="aslEditCodeLabel">${selectedRole === "dtmf" ? (window.t ? window.t("asl.edit_dtmf_label", {}, "Команда DTMF:") : "Команда DTMF:") : (window.t ? window.t("asl.edit_node_label", {}, "Номер узла:") : "Номер узла:")}</label>
      <input type="text" class="asl-edit-input" id="aslEditNodeInput" value="${safeEscapeHtml(curItem.node || "")}" placeholder="${selectedRole === "dtmf" ? (window.t ? window.t("asl.dtmf_placeholder", {}, "Напр. *81, *70, 73#") : "Напр. *81, *70, 73#") : (window.t ? window.t("contacts.ph_asl_node", {}, "напр. 45113") : "Напр. 41522, 28554")}" autocomplete="off" />
      <div class="asl-edit-autocomplete-dropdown" id="aslEditAutocompleteDropdown" style="display:none;"></div>
    </div>

    <div class="asl-edit-row">
      <label class="asl-edit-label">${window.t ? window.t("asl.edit_caption_label", {}, "Подпись:") : "Подпись:"}</label>
      <input type="text" class="asl-edit-input" id="aslEditLabelInput" value="${safeEscapeHtml(curItem.label || "")}" placeholder="${window.t ? window.t("asl.label_placeholder", {}, "Короткое имя") : "Короткое имя"}" maxlength="18" autocomplete="off" />
    </div>

    <div class="asl-edit-actions">
      <button type="button" class="asl-edit-btn asl-edit-cancel">${window.t ? window.t("buttons.cancel", {}, "Отмена") : "Отмена"}</button>
      <button type="button" class="asl-edit-btn asl-edit-save">${window.t ? window.t("buttons.save", {}, "Сохранить") : "Сохранить"}</button>
    </div>
  `;

  const stopEv = (e) => e.stopPropagation();
  pop.addEventListener("pointerdown", stopEv);
  pop.addEventListener("mousedown", stopEv);
  pop.addEventListener("click", stopEv);

  matrixContainer.appendChild(pop);

  const nodeInput = pop.querySelector("#aslEditNodeInput");
  const labelInput = pop.querySelector("#aslEditLabelInput");
  const codeLabel = pop.querySelector("#aslEditCodeLabel");

  const applyRoleUI = (role) => {
    selectedRole = role;
    pop.querySelectorAll(".asl-role-pill").forEach(b => {
      b.classList.toggle("active-node", b.dataset.role === "node" && role === "node");
      b.classList.toggle("active-dtmf", b.dataset.role === "dtmf" && role === "dtmf");
    });
    if (role === "dtmf") {
      if (codeLabel) codeLabel.textContent = window.t ? window.t("asl.edit_dtmf_label", {}, "Команда DTMF:") : "Команда DTMF:";
      if (nodeInput) nodeInput.placeholder = window.t ? window.t("asl.dtmf_placeholder", {}, "Напр. *81, *70, 73#") : "Напр. *81, *70, 73#";
    } else {
      if (codeLabel) codeLabel.textContent = window.t ? window.t("asl.edit_node_label", {}, "Номер узла:") : "Номер узла:";
      if (nodeInput) nodeInput.placeholder = window.t ? window.t("contacts.ph_asl_node", {}, "напр. 45113") : "Напр. 41522";
    }
  };

  pop.querySelectorAll(".asl-role-pill").forEach(btn => {
    btn.onclick = () => applyRoleUI(btn.dataset.role);
  });

  // ASL Autocomplete search dropdown logic
  const autoDropdown = pop.querySelector("#aslEditAutocompleteDropdown");
  let autoTimer = null;
  let autoAbort = null;

  const hideAutocomplete = () => {
    if (autoDropdown) {
      autoDropdown.style.display = "none";
      autoDropdown.innerHTML = "";
    }
  };

  // Автопереключение в роль DTMF при вводе *, #, A-D + поиск узлов
  nodeInput.addEventListener("input", () => {
    const val = (nodeInput.value || "").trim();
    if (/[*#ABCDabcd]/.test(val) && selectedRole !== "dtmf") {
      applyRoleUI("dtmf");
      hideAutocomplete();
      return;
    }
    if (selectedRole === "dtmf" || val.length < 2) {
      hideAutocomplete();
      return;
    }
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => {
      if (autoAbort) autoAbort.abort();
      autoAbort = new AbortController();
      try {
        const res = await fetch(`/api/allstar/nodes?q=${encodeURIComponent(val)}&limit=5`, { signal: autoAbort.signal });
        if (!res.ok) return;
        const data = await res.json();
        const list = (data && data.nodes) || [];
        if (!list.length || !autoDropdown) {
          hideAutocomplete();
          return;
        }
        autoDropdown.innerHTML = list.map(item => {
          const isEL = String(item.node).trim().startsWith("3") && String(item.node).trim().length >= 5;
          return `
            <div class="asl-auto-item" data-node="${safeEscapeHtml(item.node)}" data-name="${safeEscapeHtml(item.callsign || item.name || '')}" data-flag="${safeEscapeHtml(item.flag || '🌐')}">
              
              <span class="asl-auto-flag">${item.flag || '🌐'}</span>
              <strong class="asl-auto-node">#${item.node}</strong>
              <span class="asl-auto-title">${safeEscapeHtml(item.callsign ? item.callsign + ' · ' + (item.name || '') : item.name || '')}</span>
            </div>
          `;
        }).join("");
        autoDropdown.style.display = "block";

        autoDropdown.querySelectorAll(".asl-auto-item").forEach(el => {
          el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const chosenNode = el.dataset.node;
            const chosenName = el.dataset.name;
            const chosenFlag = el.dataset.flag;
            if (nodeInput) nodeInput.value = chosenNode;
            if (labelInput && (!labelInput.value || labelInput.value.trim() === "" || labelInput.value.startsWith("Node"))) {
              labelInput.value = chosenName.slice(0, 18);
            }
            curItem.flag = chosenFlag;
            hideAutocomplete();
          });
        });
      } catch (e) {
        if (e.name !== "AbortError") hideAutocomplete();
      }
    }, 180);
  });

  const closePop = () => {
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    pop.remove();
  };

  const savePop = () => {
    const trimmedNode = (nodeInput.value || "").trim();
    if (!trimmedNode) {
      userNodes[idx] = { node: "", label: "", flag: "➕", role: "node", scan: false };
    } else {
      const finalRole = selectedRole;
      let finalFlag = "🌐";
      if (finalRole === "dtmf") {
        finalFlag = "☎️";
      } else if (curItem.flag && curItem.flag !== "➕" && curItem.flag !== "☎️") {
        finalFlag = curItem.flag;
      }
      userNodes[idx] = {
        node: trimmedNode,
        label: (labelInput.value || "").trim(),
        flag: finalFlag,
        role: finalRole,
        scan: finalRole === "dtmf" ? false : Boolean(curItem.scan),
        prefMode: curItem.prefMode
      };
    }
    saveAslUserNodes(cid, userNodes);
    closePop();
    updateCardAllStarPanel(card, targetHs);
  };

  pop.querySelector(".asl-edit-close").onclick = closePop;
  pop.querySelector(".asl-edit-cancel").onclick = closePop;
  pop.querySelector(".asl-edit-save").onclick = savePop;

  const onOutside = (e) => {
    if (!pop.contains(e.target)) closePop();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePop();
    } else if (e.key === "Enter") {
      e.preventDefault();
      savePop();
    }
  };

  setTimeout(() => {
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    nodeInput.focus();
    nodeInput.select();
  }, 20);
}

export function openAslCardContextMenu({
  btn, idx, cid, card, targetHs, userNodes,
  triggerConnect, triggerDisconnectNode, isNodeCurrentlyLinked
}) {
  closeAslCardContextMenu(card, targetHs);

  // Если до этого был включён режим Move — сбрасываем его слушатель
  clearAslMoveCancelListener();
  if (targetHs && targetHs._aslMovingIdx !== null && targetHs._aslMovingIdx !== undefined) {
    targetHs._aslMovingIdx = null;
    card.querySelectorAll(".asl-node-moving-source, .asl-node-move-target").forEach(el => {
      el.classList.remove("asl-node-moving-source", "asl-node-move-target");
    });
    card.querySelectorAll(".asl-matrix-grid").forEach(gridEl => gridEl.classList.remove("asl-matrix-move-mode"));
  }

  const matrixContainer = card.querySelector(`#aslMatrixContainer_${cid}`) || card.querySelector(".asl-matrix-container");
  if (!matrixContainer) return;
  matrixContainer.style.position = "relative";

  const item = userNodes[idx];
  if (!item || !item.node) return;
  const cleanNode = String(item.node).trim();
  if (targetHs) {
    targetHs._aslOpenMenuIdx = idx;
  }

  // Текущий эффективный режим
  const currentMode = String(btn.dataset.linkMode || item.prefMode || (targetHs && targetHs._aslLinkMode) || "2");
  const isScanActive = Boolean(item.scan);
  const isCurrentlyTx = (currentMode === "*3" || currentMode === "3");

  const isDtmf = isAslDtmfCard(item);
  const nextScanActionText = isScanActive ? "OFF" : "ON";
  const scanTitle = isScanActive
    ? (window.t ? window.t("asl.scan_exclude_title", {}, "Exclude node from scanning (turn OFF)") : "Exclude node from scanning (turn OFF)")
    : (window.t ? window.t("asl.scan_include_title", {}, "Include node in scanning (turn ON)") : "Include node in scanning (turn ON)");

  const menu = document.createElement("div");
  menu.className = "asl-card-context-menu";
  if (isDtmf) {
    const tRoleDtmf = window.t ? window.t("asl.ctx_switch_node", {}, "Сменить роль: переключить на обычный узел (ХН)") : "Сменить роль: переключить на обычный узел (ХН)";
    const tRoleLabel = window.t ? window.t("asl.ctx_role_label", {}, "Роль") : "Роль";
    const tRoleBadge = window.t ? window.t("asl.ctx_role_dtmf_to_node", {}, "DTMF ➔ ХН") : "DTMF ➔ ХН";
    const tEditDtmf = window.t ? window.t("asl.ctx_edit_dtmf", {}, "Редактировать код DTMF и описание") : "Редактировать код DTMF и описание";
    const tMoveCard = window.t ? window.t("asl.ctx_move", {}, "Переместить карточку в другую ячейку") : "Переместить карточку в другую ячейку";
    const tDeleteCard = window.t ? window.t("asl.ctx_delete", {}, "Удалить карточку из ячейки") : "Удалить карточку из ячейки";
    menu.innerHTML = `
      <div class="asl-card-context-header">☎️ ${safeEscapeHtml(cleanNode)}</div>
      <button type="button" class="asl-card-context-btn" data-action="toggle-role" title="${tRoleDtmf}">
        <span class="ctx-btn-label">${tRoleLabel}</span>
        <span class="ctx-btn-badge ctx-badge-dtmf">${tRoleBadge}</span>
      </button>
      <button type="button" class="asl-card-context-btn" data-action="edit" title="${tEditDtmf}">
        <span class="ctx-btn-label">Edit</span>
        <span class="ctx-btn-icon">✎</span>
      </button>
      <button type="button" class="asl-card-context-btn" data-action="move" title="${tMoveCard}">
        <span class="ctx-btn-label">Move</span>
        <span class="ctx-btn-icon">✥</span>
      </button>
      <button type="button" class="asl-card-context-btn" data-action="delete" title="${tDeleteCard}">
        <span class="ctx-btn-label">Delete</span>
        <span class="ctx-btn-icon">✕</span>
      </button>
    `;
  } else {
    const tTxRx = window.t ? window.t("asl.ctx_toggle_txrx", {}, "Переключить режим Monitor (*2) / Transceive (*3)") : "Переключить режим Monitor (*2) / Transceive (*3)";
    const tRoleNode = window.t ? window.t("asl.ctx_switch_dtmf", {}, "Сменить роль: переключить на макрос DTMF") : "Сменить роль: переключить на макрос DTMF";
    const tRoleLabel = window.t ? window.t("asl.ctx_role_label", {}, "Роль") : "Роль";
    const tRoleBadge = window.t ? window.t("asl.ctx_role_node_to_dtmf", {}, "ХН ➔ DTMF") : "ХН ➔ DTMF";
    const tEditNode = window.t ? window.t("asl.ctx_edit_node", {}, "Редактировать номер узла, название и флаг") : "Редактировать номер узла, название и флаг";
    const tMoveCard = window.t ? window.t("asl.ctx_move", {}, "Переместить карточку в другую ячейку") : "Переместить карточку в другую ячейку";
    const tDiscon = window.t ? window.t("asl.ctx_disconnect", {}, "Отключиться от этого узла (ХН)") : "Отключиться от этого узла (ХН)";
    const tDeleteCard = window.t ? window.t("asl.ctx_delete", {}, "Удалить карточку из ячейки") : "Удалить карточку из ячейки";
    menu.innerHTML = `
      <div class="asl-card-context-header">#${safeEscapeHtml(cleanNode)}</div>
      <button type="button" class="asl-card-context-btn ${isCurrentlyTx ? "mode-tx" : "mode-rx"}" data-action="txrx" title="${tTxRx}">
        <span class="ctx-btn-label">TX-RX</span>
        <span class="ctx-btn-badge">${isCurrentlyTx ? "*3" : "*2"}</span>
      </button>
      <button type="button" class="asl-card-context-btn" data-action="toggle-role" title="${tRoleNode}">
        <span class="ctx-btn-label">${tRoleLabel}</span>
        <span class="ctx-btn-badge ctx-badge-node">${tRoleBadge}</span>
      </button>
      <button type="button" class="asl-card-context-btn" data-action="edit" title="${tEditNode}">
        <span class="ctx-btn-label">Edit</span>
        <span class="ctx-btn-icon">✎</span>
      </button>
      <button type="button" class="asl-card-context-btn" data-action="move" title="${tMoveCard}">
        <span class="ctx-btn-label">Move</span>
        <span class="ctx-btn-icon">✥</span>
      </button>
      <button type="button" class="asl-card-context-btn ${!isScanActive ? "scan-active" : ""}" data-action="scan" title="${scanTitle}">
        <span class="ctx-btn-label">Scan</span>
        <span class="ctx-btn-badge">${nextScanActionText}</span>
      </button>
      <button type="button" class="asl-card-context-btn" data-action="disconnect" title="${tDiscon}">
        <span class="ctx-btn-label">Disconnect</span>
        <span class="ctx-btn-icon">⏏</span>
      </button>
      <button type="button" class="asl-card-context-btn" data-action="delete" title="${tDeleteCard}">
        <span class="ctx-btn-label">Delete</span>
        <span class="ctx-btn-icon">✕</span>
      </button>
    `;
  }

  const stopMenuPointer = (ev) => {
    ev.stopPropagation();
  };
  menu.addEventListener("pointerdown", stopMenuPointer);
  menu.addEventListener("mousedown", stopMenuPointer);
  menu.addEventListener("touchstart", stopMenuPointer, { passive: true });

  matrixContainer.appendChild(menu);

  const contRect = matrixContainer.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();

  let left = (btnRect.right - contRect.left) + 6;
  if (left + menuRect.width > contRect.width - 4) {
    left = (btnRect.left - contRect.left) - menuRect.width - 6;
  }
  left = Math.max(4, Math.min(left, contRect.width - menuRect.width - 4));

  const maxTop = Math.max(2, contRect.height - menuRect.height - 14);
  let top = (btnRect.top - contRect.top) + (btnRect.height / 2) - (menuRect.height / 2) - 12;
  top = Math.max(2, Math.min(top, maxTop));

  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;

  const onOutsidePointerDown = (e) => {
    if (!menu.isConnected) {
      cleanupThisMenu();
      return;
    }
    if (!menu.contains(e.target)) {
      closeAslCardContextMenu(card, targetHs);
    }
  };

  const onKeyDown = (e) => {
    if (!menu.isConnected) {
      cleanupThisMenu();
      return;
    }
    if (e.key === "Escape") {
      closeAslCardContextMenu(card, targetHs);
      if (targetHs && targetHs._aslMovingIdx !== null && targetHs._aslMovingIdx !== undefined) {
        targetHs._aslMovingIdx = null;
        updateCardAllStarPanel(card, targetHs);
      }
    }
  };

  function cleanupThisMenu() {
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    _activeAslMenuCleanups.delete(cleanupThisMenu);
  }

  _activeAslMenuCleanups.add(cleanupThisMenu);
  document.addEventListener("pointerdown", onOutsidePointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);

  let actionHandled = false;
  const executeMenuAction = (ev) => {
    const actionBtn = ev.target.closest(".asl-card-context-btn");
    if (!actionBtn) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (actionHandled) return;
    actionHandled = true;

    const action = actionBtn.dataset.action;

    if (action === "toggle-role") {
      closeAslCardContextMenu(card, targetHs);
      item.role = isDtmf ? "node" : "dtmf";
      if (item.role === "dtmf") {
        item.scan = false;
        item.flag = "☎️";
      } else if (item.flag === "☎️") {
        item.flag = "🌐";
      }
      saveAslUserNodes(cid, userNodes);
      updateCardAllStarPanel(card, targetHs);
      if (typeof showToast === "function") {
        const roleMsg = item.role === "dtmf"
          ? (window.t ? window.t("asl.slot_role_dtmf_toast", { node: cleanNode }, `Slot «${cleanNode}»: role DTMF macro`) : `Slot «${cleanNode}»: role DTMF macro`)
          : (window.t ? window.t("asl.slot_role_hn_toast", { node: cleanNode }, `Slot #${cleanNode}: role HN (node connect)`) : `Slot #${cleanNode}: role HN (node connect)`);
        showToast(roleMsg, "info", 2000);
      }
    } else if (action === "edit") {
      closeAslCardContextMenu(card, targetHs);
      openAslCardEditPopover({ idx, cid, card, targetHs, userNodes });
    } else if (action === "txrx") {
      closeAslCardContextMenu(card, targetHs);
      const nextMode = isCurrentlyTx ? "*2" : "*3";
      item.prefMode = nextMode === "*3" ? "3" : "2";
      if (targetHs) targetHs._aslLinkMode = nextMode;
      btn.dataset.linkMode = nextMode;
      saveAslUserNodes(cid, userNodes);
      if (typeof window.setHotspotAslMode === "function") {
        window.setHotspotAslMode(cid, nextMode);
      }
      if (typeof window.updateHotspotTsAudioModeUI === "function") {
        window.updateHotspotTsAudioModeUI(cid);
      }

      if (typeof aslConnectNodeProcedure === "function") {
        aslConnectNodeProcedure(cid, cleanNode, nextMode, { showStatusBanner: true, showCardEffects: true });
      } else if (typeof window.aslConnectNodeProcedure === "function") {
        window.aslConnectNodeProcedure(cid, cleanNode, nextMode, { showStatusBanner: true, showCardEffects: true });
      }
      updateCardAllStarPanel(card, targetHs);
    } else if (action === "move") {
      closeAslCardContextMenu(card, targetHs);
      if (targetHs) targetHs._aslMovingIdx = idx;
      updateCardAllStarPanel(card, targetHs);
    } else if (action === "delete") {
      closeAslCardContextMenu(card, targetHs);
      if (isNodeCurrentlyLinked()) {
        if (typeof aslDisconnectNodeProcedure === "function") {
          aslDisconnectNodeProcedure(cid, cleanNode, { showStatusBanner: true, showCardEffects: true });
        } else if (typeof window.aslDisconnectNodeProcedure === "function") {
          window.aslDisconnectNodeProcedure(cid, cleanNode, { showStatusBanner: true, showCardEffects: true });
        }
      }
      if (targetHs) {
        if (!targetHs._aslDismissedUnlisted) targetHs._aslDismissedUnlisted = new Set();
        targetHs._aslDismissedUnlisted.add(cleanNode);
      }
      userNodes[idx] = { node: "", label: "", flag: "➕", scan: false };
      saveAslUserNodes(cid, userNodes);
      updateCardAllStarPanel(card, targetHs);
    } else if (action === "disconnect") {
      closeAslCardContextMenu(card, targetHs);
      if (typeof triggerDisconnectNode === "function") {
        triggerDisconnectNode(cleanNode);
      } else if (typeof aslDisconnectNodeProcedure === "function") {
        aslDisconnectNodeProcedure(cid, cleanNode, { showStatusBanner: true, showCardEffects: true });
      } else if (typeof window.aslDisconnectNodeProcedure === "function") {
        window.aslDisconnectNodeProcedure(cid, cleanNode, { showStatusBanner: true, showCardEffects: true });
      }
    } else if (action === "scan") {
      item.scan = !Boolean(item.scan);
      saveAslUserNodes(cid, userNodes);
      closeAslCardContextMenu(card, targetHs);
      updateCardAllStarPanel(card, targetHs);
      if (typeof showToast === "function") {
        const scanStateLabel = item.scan
          ? (window.t ? window.t("common.on", {}, "ON") : "ON")
          : (window.t ? window.t("common.off", {}, "OFF") : "OFF");
        const scanMsg = window.t
          ? window.t("asl.slot_scan_toggle_toast", { node: cleanNode, state: scanStateLabel }, `Scan for #${cleanNode}: ${scanStateLabel}`)
          : `Scan for #${cleanNode}: ${scanStateLabel}`;
        showToast(scanMsg, "info", 1800);
      }
    }
  };

  menu.addEventListener("click", executeMenuAction);
}


// =========================================================================
// ASL MATRIX CARD ROLES (NODE vs DTMF) & SCAN ENGINE
// =========================================================================

export function isAslDtmfCard(item) {
  if (!item || !item.node) return false;
  if (item.role === "dtmf") return true;
  if (item.role === "node") return false;
  return /[*#ABCDabcd]/.test(String(item.node).trim());
}

export function executeAslDtmfMacroAction(cid, card, btn, digits) {
  if (!digits) return;
  const chips = card ? card.querySelectorAll(".asl-link-chip") : [];
  let isTxModeActive = false;
  chips.forEach(chip => {
    if (chip.dataset.mode === "*3" || chip.dataset.node === "1999") {
      isTxModeActive = true;
    }
  });
  if (!isTxModeActive) {
    const curHs = (typeof window !== "undefined" && window.currentHotspots ? window.currentHotspots : []).find(h => h.id === cid);
    if (curHs && (curHs._aslLinkMode === "*3" || curHs.connected_node === "1999")) {
      isTxModeActive = true;
    }
  }

  if (!isTxModeActive) {
    if (typeof setAslProcBannerState === "function") {
      setAslProcBannerState(card, {
        active: true,
        text: window.t ? window.t("asl.scan_dtmf_tx_unavailable", {}, "✕ Передача DTMF недоступна: переведите узел в режим TX-RX (*3)") : "✕ Передача DTMF недоступна: переведите узел в режим TX-RX (*3)",
        tone: "negative",
        autoHideMs: 4000
      });
    }
    if (navigator.vibrate) {
      try { navigator.vibrate([40, 40, 40]); } catch (_) {}
    }
    return;
  }

  if (btn) {
    btn.classList.add("asl-dtmf-sending");
    setTimeout(() => { btn.classList.remove("asl-dtmf-sending"); }, 1500);
  }

  if (window.ws && window.ws.readyState === WebSocket.OPEN) {
    window.ws.send(JSON.stringify({
      type: "allstar_dtmf_macro",
      hotspot_id: cid,
      digits: digits
    }));
  }
}

const DEFAULT_ASL_SCAN_CONFIG = {
  mode: "timer",
  timerHoldSec: 15,
  releaseHoldSec: 3,
  dwellSec: 5
};

export function getAslScanConfig(cid) {
  try {
    let parsed = null;
    if (hasServerCollectionKey("asl_scan_cfg", cid)) {
      parsed = getServerCollectionValue("asl_scan_cfg", cid);
    } else if (hasServerCollectionKey("asl_scan_cfg", "global")) {
      parsed = getServerCollectionValue("asl_scan_cfg", "global");
    }
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed) {
      const raw = localStorage.getItem(`proxdmr_asl_scan_cfg_${cid}`) || localStorage.getItem("proxdmr_asl_scan_cfg_global");
      if (raw) parsed = JSON.parse(raw);
    }
    if (parsed && typeof parsed === "object") {
      return {
        mode: (parsed.mode === "wait" || parsed.mode === "timer") ? parsed.mode : "timer",
        timerHoldSec: Math.max(5, Math.min(120, parseInt(parsed.timerHoldSec, 10) || 15)),
        releaseHoldSec: Math.max(1, Math.min(45, parseInt(parsed.releaseHoldSec, 10) || 3)),
        dwellSec: 5
      };
    }
  } catch (_) {}
  return { ...DEFAULT_ASL_SCAN_CONFIG };
}

export function saveAslScanConfig(cid, cfg) {
  try {
    setServerCollectionKey("asl_scan_cfg", cid, cfg, "proxdmr_asl_scan_cfg_", true);
    setServerCollectionKey("asl_scan_cfg", "global", cfg, "proxdmr_asl_scan_cfg_", true);
  } catch (_) {}
}

const DEFAULT_ASL_DICE_CONFIG = {
  continueOnFail: true,
  continueOnSilence: false,
  silenceWaitSec: 10
};

function _normalizeAslDiceConfig(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  const waitParsed = parseInt(src.silenceWaitSec, 10);
  const clampedWait = Number.isFinite(waitParsed)
    ? Math.max(1, Math.min(60, waitParsed))
    : DEFAULT_ASL_DICE_CONFIG.silenceWaitSec;
  return {
    continueOnFail: src.continueOnFail === undefined ? DEFAULT_ASL_DICE_CONFIG.continueOnFail : Boolean(src.continueOnFail),
    continueOnSilence: src.continueOnSilence === undefined ? DEFAULT_ASL_DICE_CONFIG.continueOnSilence : Boolean(src.continueOnSilence),
    silenceWaitSec: clampedWait
  };
}

export function getAslDiceConfig(cid) {
  try {
    let parsed = null;
    if (hasServerCollectionKey("asl_dice_cfg", cid)) {
      parsed = getServerCollectionValue("asl_dice_cfg", cid);
    } else if (hasServerCollectionKey("asl_dice_cfg", "global")) {
      parsed = getServerCollectionValue("asl_dice_cfg", "global");
    }
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed && typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(`proxdmr_asl_dice_cfg_${cid}`) || localStorage.getItem("proxdmr_asl_dice_cfg_global");
      if (raw) parsed = JSON.parse(raw);
    }
    if (parsed && typeof parsed === "object") {
      return _normalizeAslDiceConfig(parsed);
    }
  } catch (_) {}
  return { ...DEFAULT_ASL_DICE_CONFIG };
}

export function saveAslDiceConfig(cid, cfg) {
  const normalized = _normalizeAslDiceConfig(cfg);
  try {
    setServerCollectionKey("asl_dice_cfg", cid, normalized, "proxdmr_asl_dice_cfg_", true);
    setServerCollectionKey("asl_dice_cfg", "global", normalized, "proxdmr_asl_dice_cfg_", true);
  } catch (_) {}
  return normalized;
}

export function syncAslDiceButtonUI(card, targetHs) {
  const isRolling = Boolean(targetHs && targetHs._aslDiceRolling);
  const idleTitle = window.t
    ? window.t("asl.dice_btn_title", {}, "Случайный активный узел ASL (клик — старт/стоп, удержание/ПКМ — настройки)")
    : "Случайный активный узел ASL (клик — старт/стоп, удержание/ПКМ — настройки)";
  const stopTitle = window.t
    ? window.t("asl.dice_btn_stop_title", {}, "Нажмите для остановки поиска случайного узла ASL")
    : "Нажмите для остановки поиска случайного узла ASL";
  const root = card || document;
  root.querySelectorAll(".vfo-allstar-row .btn-allstar-dice:not(.btn-adn-dice)").forEach(btn => {
    btn.classList.toggle("dice-rolling", isRolling);
    btn.disabled = false;
    const tLabel = isRolling ? stopTitle : idleTitle;
    btn.title = tLabel;
    btn.setAttribute("aria-label", tLabel);
  });
}

export function stopAslDiceSearch(cid, card, targetHs, { immediateAbort = false, finishInnerIteration = false, silent = false } = {}) {
  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
  const resolvedHs = targetHs || curHsList.find(h => h && h.id === cid) || curHsList[0] || null;
  const effCard = card || (resolvedHs ? (document.querySelector(`.dmr-card[data-hotspot-id="${resolvedHs.id}"]`) || document.querySelector(`.radio-container[data-hotspot-id="${resolvedHs.id}"]`)) : null);
  if (!resolvedHs || !resolvedHs._aslDiceRolling) {
    if (effCard && resolvedHs) {
      syncAslDiceButtonUI(effCard, resolvedHs);
    }
    return;
  }

  resolvedHs._aslDiceStopRequested = true;

  if (immediateAbort || !finishInnerIteration) {
    resolvedHs._aslDiceRunId = (resolvedHs._aslDiceRunId || 0) + 1;
    resolvedHs._aslDiceRolling = false;
    if (effCard) {
      syncAslDiceButtonUI(effCard, resolvedHs);
      if (!silent) {
        setAslProcBannerState(effCard, {
          active: true,
          text: window.t ? window.t("asl.dice_stopped", {}, "⏹ Поиск случайного узла ASL остановлен") : "⏹ Поиск случайного узла ASL остановлен",
          tone: "neutral",
          autoHideMs: 4000,
          fadeOutMs: 2000
        });
      }
    }
  } else {
    if (effCard && !silent) {
      setAslProcBannerState(effCard, {
        active: true,
        text: window.t ? window.t("asl.dice_stopping", {}, "⏹ Остановка поиска (завершение текущей попытки)...") : "⏹ Остановка поиска (завершение текущей попытки)...",
        tone: "neutral",
        autoHideMs: 0
      });
    }
  }
}

export function isAslNodeRxActive(card, targetHs) {
  const nowMs = Date.now();
  const nowSec = nowMs / 1000;

  // 1. Проверяем реальное поступление голосовых PCM-пакетов за последние 950 мс
  if (card && card._lastRx && card._lastRx[1] && card._lastRx[1].lastAudioTime) {
    if ((nowSec - card._lastRx[1].lastAudioTime) < 0.95) {
      return true;
    }
  }
  if (targetHs && targetHs._aslLastRxAudioMs) {
    if ((nowMs - targetHs._aslLastRxAudioMs) < 950) {
      return true;
    }
  }

  // 2. Проверяем активный флаг keyed в списке подключённых линков
  if (targetHs && Array.isArray(targetHs.asl_links)) {
    if (targetHs.asl_links.some(lk => lk && lk.keyed)) {
      return true;
    }
  }

  // 3. Проверяем флаг несущей allstar_carrier, только если звук не прекратился давно
  if (targetHs && targetHs._aslCarrierRx) {
    const lastAudioMs = targetHs._aslLastRxAudioMs || ((card?._lastRx?.[1]?.lastAudioTime || 0) * 1000);
    if (!lastAudioMs || (nowMs - lastAudioMs) < 1500) {
      return true;
    }
  }

  return false;
}

export function stopAslMatrixScan(cid, card, targetHs, { keepCurrentLink = true, silent = false } = {}) {
  if (targetHs) {
    targetHs._aslScanActive = false;
    targetHs._aslScanRunId = (targetHs._aslScanRunId || 0) + 1;
    targetHs._aslScanningNode = "";
  }
  if (card) {
    const scanBtn = card.querySelector(".btn-allstar-scan");
    if (scanBtn) scanBtn.classList.remove("scan-running");
    card.querySelectorAll(".btn-allstar-node.asl-node-scanning-now").forEach(b => {
      b.classList.remove("asl-node-scanning-now");
    });
    if (!silent) {
      setAslProcBannerState(card, {
        active: true,
        text: window.t ? window.t("asl.scan_stopped", {}, "⏹ Сканирование остановлено") : "⏹ Сканирование остановлено",
        tone: "neutral",
        autoHideMs: 4000
      });
    }
  }
  if (!keepCurrentLink && typeof aslDisconnectNodeProcedure === "function") {
    aslDisconnectNodeProcedure(cid, "all", { showStatusBanner: false, showCardEffects: true });
  }
}

export async function startAslMatrixScan(cid, card, targetHs, userNodes) {
  if (!card || !targetHs) return;
  if (targetHs._aslDiceRolling) {
    stopAslDiceSearch(cid, card, targetHs, { immediateAbort: true, silent: true });
  }

  const scanTargets = (userNodes || []).filter(item => item && item.node && item.scan && !isAslDtmfCard(item));
  if (scanTargets.length === 0) {
    setAslProcBannerState(card, {
      active: true,
      text: window.t ? window.t("asl.scan_no_nodes", {}, "✕ Нет узлов для сканирования: включите Scan: ON в меню карточек") : "✕ Нет узлов для сканирования: включите Scan: ON в меню карточек",
      tone: "negative",
      autoHideMs: 4000
    });
    if (navigator.vibrate) {
      try { navigator.vibrate([40, 40, 40]); } catch (_) {}
    }
    return;
  }

  const runId = (targetHs._aslScanRunId || 0) + 1;
  targetHs._aslScanRunId = runId;
  targetHs._aslScanActive = true;

  const scanBtn = card.querySelector(".btn-allstar-scan");
  if (scanBtn) scanBtn.classList.add("scan-running");

  const isStillRunning = () => Boolean(targetHs._aslScanActive && targetHs._aslScanRunId === runId);
  const sleepMs = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  let cursor = 0;

  while (isStillRunning()) {
    const currentTargets = (userNodes || []).filter(item => item && item.node && item.scan && !isAslDtmfCard(item));
    if (currentTargets.length === 0) {
      stopAslMatrixScan(cid, card, targetHs, { keepCurrentLink: false });
      return;
    }

    const targetItem = currentTargets[cursor % currentTargets.length];
    cursor = (cursor + 1) % currentTargets.length;
    const nodeNum = String(targetItem.node).trim();
    targetHs._aslScanningNode = nodeNum;

    card.querySelectorAll(".btn-allstar-node").forEach(b => {
      b.classList.toggle("asl-node-scanning-now", String(b.dataset.node || "").trim() === nodeNum);
    });

    // Сбрасываем индикаторы приёма от предыдущего узла перед новым подключением
    const connStartedAt = Date.now();
    targetHs._aslCarrierRx = false;
    targetHs._aslLastRxAudioMs = 0;
    targetHs._aslRxActiveNode = "";
    targetHs._aslKeyedNodes = [];
    if (card._lastRx && card._lastRx[1]) {
      card._lastRx[1].active = false;
      card._lastRx[1].lastAudioTime = 0;
    }
    const vfoRowClean = card.querySelector(".vfo-allstar-row");
    if (vfoRowClean) vfoRowClean.classList.remove("allstar-rx-active");

    // 1. Подключаемся к узлу в режиме *2 (Monitor)
    aslConnectNodeProcedure(cid, nodeNum, "*2", {
      showStatusBanner: true,
      showCardEffects: true
    });

    let waitConnMs = 0;
    let isConnected = false;
    while (waitConnMs < 6500 && isStillRunning()) {
      if (
        targetHs.connected_node === nodeNum ||
        (Array.isArray(targetHs.asl_links) && targetHs.asl_links.some(l => String(l.node).trim() === nodeNum && !l.connecting))
      ) {
        isConnected = true;
        break;
      }
      if (
        waitConnMs >= 1000 &&
        targetHs._aslConnectingNodes &&
        !targetHs._aslConnectingNodes.has(nodeNum) &&
        !targetHs.connected_node
      ) {
        break;
      }
      await sleepMs(200);
      waitConnMs += 200;
    }

    if (!isStillRunning()) return;

    if (!isConnected) {
      await sleepMs(350);
      continue;
    }

    const cfg = getAslScanConfig(cid);

    // РЕЖИМ 1: «⏱ ТАЙМЕР» — отсчитывает заданное в настройках время timerHoldSec (например, 25 сек)
    if (cfg.mode === "timer") {
      const totalHoldMs = (cfg.timerHoldSec || 15) * 1000;
      let elapsedHold = 0;
      while (elapsedHold < totalHoldMs && isStillRunning()) {
        const activeNow = isAslNodeRxActive(card, targetHs);
        const remSec = Math.ceil((totalHoldMs - elapsedHold) / 1000);
        setAslProcBannerState(card, {
          active: true,
          text: activeNow
            ? (window.t ? window.t("asl.scan_timer_air", { node: nodeNum, sec: remSec }, `🔍 Скан #${nodeNum} [Эфир · Таймер: ${remSec}с]`) : `🔍 Скан #${nodeNum} [Эфир · Таймер: ${remSec}с]`)
            : (window.t ? window.t("asl.scan_timer_idle", { node: nodeNum, sec: remSec }, `🔍 Скан #${nodeNum} [Таймер: ${remSec}с]`) : `🔍 Скан #${nodeNum} [Таймер: ${remSec}с]`),
          tone: activeNow ? "positive" : "neutral",
          autoHideMs: 0
        });
        await sleepMs(250);
        elapsedHold += 250;
      }
    } else {
      // РЕЖИМ 2: «🎙 ОЖИДАНИЕ» — ждёт активность dwellSec (5с), при наличии речи держит до конца передачи + releaseHoldSec
      const dwellMs = (cfg.dwellSec || 5) * 1000;
      let elapsedDwell = 0;
      let activityDetected = Boolean(
        (targetHs._aslLastRxAudioMs && targetHs._aslLastRxAudioMs >= connStartedAt + 250) ||
        isAslNodeRxActive(card, targetHs)
      );

      while (!activityDetected && elapsedDwell < dwellMs && isStillRunning()) {
        if (isAslNodeRxActive(card, targetHs)) {
          activityDetected = true;
          break;
        }
        const remSec = Math.ceil((dwellMs - elapsedDwell) / 1000);
        setAslProcBannerState(card, {
          active: true,
          text: window.t ? window.t("asl.scan_waiting", { node: nodeNum, sec: remSec }, `🔍 Скан #${nodeNum}: ожидание (${remSec}с)...`) : `🔍 Скан #${nodeNum}: ожидание (${remSec}с)...`,
          tone: "neutral",
          autoHideMs: 0
        });
        await sleepMs(200);
        elapsedDwell += 200;
      }

      if (!isStillRunning()) return;

      if (!activityDetected) {
        aslDisconnectNodeProcedure(cid, nodeNum, { showStatusBanner: false, showCardEffects: true });
        await sleepMs(250);
        continue;
      }

      let releaseElapsedMs = 0;
      const releaseTargetMs = (cfg.releaseHoldSec || 3) * 1000;

      while (releaseElapsedMs < releaseTargetMs && isStillRunning()) {
        const activeCfg = getAslScanConfig(cid);
        const curReleaseTargetMs = (activeCfg.releaseHoldSec || 3) * 1000;
        if (isAslNodeRxActive(card, targetHs)) {
          releaseElapsedMs = 0;
          setAslProcBannerState(card, {
            active: true,
            text: window.t ? window.t("asl.scan_air_active", { node: nodeNum }, `🔍 Скан #${nodeNum} [Активность в эфире]`) : `🔍 Скан #${nodeNum} [Активность в эфире]`,
            tone: "positive",
            autoHideMs: 0
          });
        } else {
          const remRelease = Math.ceil(Math.max(0, curReleaseTargetMs - releaseElapsedMs) / 1000);
          setAslProcBannerState(card, {
            active: true,
            text: window.t ? window.t("asl.scan_release", { node: nodeNum, sec: remRelease }, `🔍 Скан #${nodeNum} [Отпускание: ${remRelease}с]`) : `🔍 Скан #${nodeNum} [Отпускание: ${remRelease}с]`,
            tone: "neutral",
            autoHideMs: 0
          });
          releaseElapsedMs += 250;
          if (releaseElapsedMs >= curReleaseTargetMs) break;
        }
        await sleepMs(250);
      }
    }

    if (!isStillRunning()) return;

    // По завершении удержания отключаем текущий узел и переходим к следующему
    aslDisconnectNodeProcedure(cid, nodeNum, { showStatusBanner: false, showCardEffects: true });
    await sleepMs(250);
  }
}

export function openAslScanSettingsPopover(cid, anchorEl, card) {
  document.querySelectorAll(".asl-scan-settings-popover, .ysf-scan-settings-popover, .ysf-dice-settings-popover, .adn-dice-settings-popover, .asl-dice-settings-popover, .ysf-scan-backdrop").forEach(el => el.remove());
  if (!anchorEl || !card) return;

  const cfg = getAslScanConfig(cid);
  const secUnit = window.t ? window.t("live.sec", {}, "s") : "s";
  const titleTxt = window.t ? window.t("asl.scan_settings_title", {}, "⚙️ Настройки сканирования ASL") : "⚙️ Настройки сканирования ASL";
  const timerBtnTxt = window.t ? window.t("asl.scan_mode_timer", {}, "⏱ Таймер") : "⏱ Таймер";
  const waitBtnTxt = window.t ? window.t("asl.scan_mode_wait", {}, "🎙 Ожидание") : "🎙 Ожидание";
  const timerBtnTip = window.t ? window.t("asl.scan_mode_timer_tip", {}, "Фиксированное время на активном узле") : "Фиксированное время на активном узле";
  const waitBtnTip = window.t ? window.t("asl.scan_mode_wait_tip", {}, "До окончания передачи + таймер отпускания") : "До окончания передачи + таймер отпускания";
  const timerLbl = window.t ? window.t("asl.scan_timer_label", {}, "Таймер активности (сек):") : "Таймер активности (сек):";
  const releaseLbl = window.t ? window.t("asl.scan_release_label", {}, "Таймер отпускания (сек):") : "Таймер отпускания (сек):";

  const popover = document.createElement("div");
  popover.className = "asl-scan-settings-popover";
  popover.innerHTML = `
    <div class="scan-popover-title">
      <span>${safeEscapeHtml(titleTxt)}</span>
      <span class="scan-popover-close">✕</span>
    </div>
    <div class="scan-mode-toggle">
      <button type="button" class="scan-mode-btn ${cfg.mode === "timer" ? "active" : ""}" data-mode="timer" title="${safeEscapeHtml(timerBtnTip)}">
        ${safeEscapeHtml(timerBtnTxt)}
      </button>
      <button type="button" class="scan-mode-btn ${cfg.mode === "wait" ? "active" : ""}" data-mode="wait" title="${safeEscapeHtml(waitBtnTip)}">
        ${safeEscapeHtml(waitBtnTxt)}
      </button>
    </div>
    <div class="scan-field-group scan-group-timer" style="display: ${cfg.mode === "timer" ? "block" : "none"};">
      <div class="scan-field-label">
        <span>${safeEscapeHtml(timerLbl)}</span>
        <span class="scan-field-val" id="aslScanTimerVal">${cfg.timerHoldSec}${safeEscapeHtml(secUnit)}</span>
      </div>
      <input type="range" id="aslScanTimerRange" min="5" max="120" step="5" value="${cfg.timerHoldSec}">
    </div>
    <div class="scan-field-group scan-group-wait" style="display: ${cfg.mode === "wait" ? "block" : "none"};">
      <div class="scan-field-label">
        <span>${safeEscapeHtml(releaseLbl)}</span>
        <span class="scan-field-val" id="aslScanReleaseVal">${cfg.releaseHoldSec}${safeEscapeHtml(secUnit)}</span>
      </div>
      <input type="range" id="aslScanReleaseRange" min="1" max="45" step="1" value="${cfg.releaseHoldSec}">
    </div>
  `;

  popover.querySelector(".scan-popover-close").onclick = (e) => {
    e.stopPropagation();
    popover.remove();
  };

  const timerGroup = popover.querySelector(".scan-group-timer");
  const waitGroup = popover.querySelector(".scan-group-wait");

  popover.querySelectorAll(".scan-mode-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      popover.querySelectorAll(".scan-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      cfg.mode = btn.dataset.mode;
      timerGroup.style.display = (cfg.mode === "timer") ? "block" : "none";
      waitGroup.style.display = (cfg.mode === "wait") ? "block" : "none";
      saveAslScanConfig(cid, cfg);
    };
  });

  const timerRange = popover.querySelector("#aslScanTimerRange");
  const timerVal = popover.querySelector("#aslScanTimerVal");
  if (timerRange) {
    timerRange.oninput = (e) => {
      e.stopPropagation();
      cfg.timerHoldSec = parseInt(timerRange.value, 10);
      if (timerVal) timerVal.textContent = `${cfg.timerHoldSec}${secUnit}`;
      saveAslScanConfig(cid, cfg);
    };
  }

  const releaseRange = popover.querySelector("#aslScanReleaseRange");
  const releaseVal = popover.querySelector("#aslScanReleaseVal");
  if (releaseRange) {
    releaseRange.oninput = (e) => {
      e.stopPropagation();
      cfg.releaseHoldSec = parseInt(releaseRange.value, 10);
      if (releaseVal) releaseVal.textContent = `${cfg.releaseHoldSec}${secUnit}`;
      saveAslScanConfig(cid, cfg);
    };
  }

  const stopProp = (e) => e.stopPropagation();
  popover.addEventListener("pointerdown", stopProp);
  popover.addEventListener("mousedown", stopProp);
  popover.addEventListener("click", stopProp);

  const vfoRow = card.querySelector(".vfo-allstar-row") || card;
  vfoRow.style.position = "relative";
  vfoRow.appendChild(popover);

  const rect = anchorEl.getBoundingClientRect();
  const vfoRect = vfoRow.getBoundingClientRect();
  popover.style.left = `${Math.max(4, Math.min(vfoRect.width - 270, rect.left - vfoRect.left))}px`;
  popover.style.top = `${Math.round(rect.bottom - vfoRect.top + 6)}px`;

  const onOutsideClick = (e) => {
    if (!popover.contains(e.target) && e.target !== anchorEl) {
      document.removeEventListener("pointerdown", onOutsideClick, true);
      popover.remove();
    }
  };
  setTimeout(() => {
    document.addEventListener("pointerdown", onOutsideClick, true);
  }, 20);
}

export function openAslDiceSettingsPopover(arg1, arg2, arg3) {
  let cid = "";
  let card = null;
  let anchorEl = null;
  if (arg1 && typeof arg1 === "object") {
    cid = arg1.cid || "default";
    card = arg1.card || null;
    anchorEl = arg1.anchorEl || (card ? card.querySelector(".vfo-allstar-row .btn-allstar-dice:not(.btn-adn-dice)") : null);
  } else {
    cid = arg1 || "default";
    anchorEl = arg2 || null;
    card = arg3 || null;
    if (!anchorEl && card) anchorEl = card.querySelector(".vfo-allstar-row .btn-allstar-dice:not(.btn-adn-dice)");
  }

  document.querySelectorAll(".asl-scan-settings-popover, .ysf-scan-settings-popover, .ysf-dice-settings-popover, .adn-dice-settings-popover, .asl-dice-settings-popover, .ysf-scan-backdrop").forEach(el => el.remove());
  if (!anchorEl || !card) return;

  const cfg = getAslDiceConfig(cid);
  const secUnit = window.t ? window.t("live.sec", {}, "с") : "с";
  const titleTxt = window.t ? window.t("asl.dice_settings_title", {}, "🎲 Случайный узел ASL") : "🎲 Случайный узел ASL";
  const chkFailTxt = window.t ? window.t("asl.dice_continue_on_fail", {}, "Продолжать при неудачном коннекте") : "Продолжать при неудачном коннекте";
  const getChkSilenceTxt = (sec) => window.t
    ? window.t("asl.dice_continue_on_silence", { sec: `${sec} ${secUnit}` }, `Продолжать при отсутствии общения в течение ${sec} сек.`)
    : `Продолжать при отсутствии общения в течение ${sec} сек.`;
  const sliderLblTxt = window.t ? window.t("asl.dice_silence_wait_label", {}, "Пауза детектирования разговоров:") : "Пауза детектирования разговоров:";

  const popover = document.createElement("div");
  popover.className = "asl-scan-settings-popover asl-dice-settings-popover";
  popover.innerHTML = `
    <div class="scan-popover-title">
      <span>${safeEscapeHtml(titleTxt)}</span>
      <span class="scan-popover-close">✕</span>
    </div>
    <label class="dice-chk-row">
      <input type="checkbox" id="aslDiceContinueOnFail"${cfg.continueOnFail ? " checked" : ""}>
      <span>${safeEscapeHtml(chkFailTxt)}</span>
    </label>
    <label class="dice-chk-row">
      <input type="checkbox" id="aslDiceContinueOnSilence"${cfg.continueOnSilence ? " checked" : ""}>
      <span id="aslDiceSilenceChkText">${safeEscapeHtml(getChkSilenceTxt(cfg.silenceWaitSec))}</span>
    </label>
    <div class="scan-field-group dice-silence-slider-group${cfg.continueOnSilence ? "" : " is-disabled-hint"}">
      <div class="scan-field-label">
        <span>${safeEscapeHtml(sliderLblTxt)}</span>
        <span class="scan-field-val" id="aslDiceSilenceVal">${cfg.silenceWaitSec}${safeEscapeHtml(secUnit)}</span>
      </div>
      <input type="range" id="aslDiceSilenceRange" min="1" max="60" step="1" value="${cfg.silenceWaitSec}">
    </div>
  `;

  const vfoRow = card.querySelector(".vfo-allstar-row") || card;

  const onOutsideClick = (e) => {
    if (!popover.isConnected) {
      document.removeEventListener("pointerdown", onOutsideClick, true);
      return;
    }
    const curVfo = card.querySelector(".vfo-allstar-row") || vfoRow;
    const curAnchor = (curVfo && curVfo.querySelector(".btn-allstar-dice:not(.btn-adn-dice)")) || anchorEl;
    if (!popover.contains(e.target) && e.target !== curAnchor && !(curAnchor && curAnchor.contains && curAnchor.contains(e.target))) {
      closePopover();
    }
  };

  const closePopover = () => {
    document.removeEventListener("pointerdown", onOutsideClick, true);
    popover.remove();
  };

  popover.querySelector(".scan-popover-close").onclick = (e) => {
    e.stopPropagation();
    closePopover();
  };

  const chkFail = popover.querySelector("#aslDiceContinueOnFail");
  const chkSilence = popover.querySelector("#aslDiceContinueOnSilence");
  const chkSilenceText = popover.querySelector("#aslDiceSilenceChkText");
  const silenceGroup = popover.querySelector(".dice-silence-slider-group");
  const silenceRange = popover.querySelector("#aslDiceSilenceRange");
  const silenceVal = popover.querySelector("#aslDiceSilenceVal");

  if (chkFail) {
    chkFail.onchange = (e) => {
      e.stopPropagation();
      cfg.continueOnFail = Boolean(chkFail.checked);
      saveAslDiceConfig(cid, cfg);
    };
  }

  if (chkSilence) {
    chkSilence.onchange = (e) => {
      e.stopPropagation();
      cfg.continueOnSilence = Boolean(chkSilence.checked);
      if (silenceGroup) {
        silenceGroup.classList.toggle("is-disabled-hint", !cfg.continueOnSilence);
      }
      saveAslDiceConfig(cid, cfg);
    };
  }

  if (silenceRange) {
    silenceRange.oninput = (e) => {
      e.stopPropagation();
      cfg.silenceWaitSec = Math.max(1, Math.min(60, parseInt(silenceRange.value, 10) || 10));
      if (silenceVal) silenceVal.textContent = `${cfg.silenceWaitSec}${secUnit}`;
      if (chkSilenceText) chkSilenceText.textContent = getChkSilenceTxt(cfg.silenceWaitSec);
      saveAslDiceConfig(cid, cfg);
    };
  }

  const stopProp = (e) => e.stopPropagation();
  popover.addEventListener("pointerdown", stopProp);
  popover.addEventListener("mousedown", stopProp);
  popover.addEventListener("click", stopProp);

  vfoRow.style.position = "relative";
  vfoRow.appendChild(popover);

  const rect = anchorEl.getBoundingClientRect();
  const vfoRect = vfoRow.getBoundingClientRect();
  const popWidth = popover.offsetWidth || 274;
  const maxLeft = Math.max(4, vfoRect.width - popWidth - 4);
  popover.style.left = `${Math.max(4, Math.min(maxLeft, rect.left - vfoRect.left))}px`;
  popover.style.top = `${Math.round(rect.bottom - vfoRect.top + 6)}px`;

  setTimeout(() => {
    document.addEventListener("pointerdown", onOutsideClick, true);
  }, 20);
}

function isValidPublicAslNodeClient(nodeStr) {
  const s = String(nodeStr || "").trim();
  if (!/^\d+$/.test(s)) return false;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 2000 || n === 9998 || n === 9999) return false;
  if (s.length >= 7 && s.startsWith("3")) return false;
  return n <= 2999999;
}

function parseKeyedHtmlClientFallback(rawHtml) {
  if (!rawHtml || typeof rawHtml !== "string") return [];
  const tbodyMatch = rawHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const bodyHtml = tbodyMatch ? tbodyMatch[1] : rawHtml;
  const rowMatches = bodyHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const stripTags = (frag) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = String(frag || "").replace(/<[^>]+>/g, " ");
    return (tmp.textContent || "").replace(/\s+/g, " ").trim();
  };

  const results = [];
  const seen = new Set();
  for (const rowHtml of rowMatches) {
    const tds = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = tdRe.exec(rowHtml)) !== null) {
      tds.push(m[1]);
    }
    if (tds.length < 6) continue;
    const nodeMatch = tds[0].match(/\/stats\/(\d+)/);
    const nodeStr = nodeMatch ? nodeMatch[1] : stripTags(tds[0]);
    if (!isValidPublicAslNodeClient(nodeStr) || seen.has(nodeStr)) continue;
    seen.add(nodeStr);

    const rawCall = stripTags(tds[2]);
    const shortCall = rawCall ? rawCall.split(/\s+/)[0].trim() : "";
    const pageLoc = stripTags(tds[5]);
    const connHtml = tds.length >= 7 ? tds[6] : "";

    const linkedNodes = [];
    const connRe = /\/stats\/(\d+)/g;
    let cm;
    while ((cm = connRe.exec(connHtml)) !== null) {
      const cn = cm[1];
      if (cn !== nodeStr && isValidPublicAslNodeClient(cn) && !linkedNodes.includes(cn)) {
        linkedNodes.push(cn);
      }
    }

    let cityClean = pageLoc ? pageLoc.split(",")[0].split("/")[0].trim() : "";
    if (/^\d+$/.test(cityClean)) cityClean = "";

    const cInfo = getCountryInfo("", shortCall, pageLoc);
    const flag = (cInfo && cInfo.flag) ? cInfo.flag : "🌐";

    let label = "";
    if (shortCall && cityClean && cityClean.toLowerCase() !== shortCall.toLowerCase()) {
      label = `${shortCall} · ${cityClean}`;
    } else if (shortCall) {
      label = shortCall;
    } else if (cityClean) {
      label = cityClean;
    } else {
      label = `Node ${nodeStr}`;
    }

    results.push({
      node: nodeStr,
      callsign: shortCall || `Node ${nodeStr}`,
      label,
      location: pageLoc,
      city: cityClean,
      flag,
      public_links_count: linkedNodes.length,
      linked_nodes: linkedNodes.slice(0, 12)
    });
  }
  return results;
}

async function fetchActiveKeyedAslNodes() {
  try {
    const controller = new AbortController();
    const tId = setTimeout(() => controller.abort(), 11500);
    const res = await fetch("/api/allstar/keyed", { signal: controller.signal });
    clearTimeout(tId);
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.nodes) && data.nodes.length > 0) {
        return data.nodes;
      }
    }
  } catch (_) {}

  // Browser direct fallback (stats.allstarlink.org sends Access-Control-Allow-Origin: *)
  try {
    const controller = new AbortController();
    const tId = setTimeout(() => controller.abort(), 11500);
    const res = await fetch("https://stats.allstarlink.org/stats/keyed", {
      signal: controller.signal,
      headers: { "Accept": "text/html" }
    });
    clearTimeout(tId);
    if (res.ok) {
      const rawHtml = await res.text();
      return parseKeyedHtmlClientFallback(rawHtml);
    }
  } catch (_) {}

  return [];
}

async function rollRandomKeyedAslNode(cid, card, targetHs, userNodes, diceBtn) {
  if (!card || !targetHs) return;
  if (targetHs._aslDiceRolling) return;

  if (targetHs._aslScanActive) {
    stopAslMatrixScan(cid, card, targetHs, { keepCurrentLink: true, silent: true });
  }

  const runId = (targetHs._aslDiceRunId || 0) + 1;
  targetHs._aslDiceRunId = runId;
  targetHs._aslDiceRolling = true;
  targetHs._aslDiceStopRequested = false;

  const getLiveCard = () =>
    document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) ||
    document.querySelector(`.dmr-card[data-hotspot-id="${cid}"]`) ||
    card;

  syncAslDiceButtonUI(getLiveCard(), targetHs);

  const triedNodes = new Set();
  const MAX_DICE_ATTEMPTS = 20;
  const isRunTokenValid = () => Boolean(targetHs && targetHs._aslDiceRunId === runId);
  const isLoopAlive = () => Boolean(isRunTokenValid() && targetHs._aslDiceRolling && !targetHs._aslDiceStopRequested);
  const cancellablePause = async (ms) => {
    const steps = Math.max(1, Math.ceil(ms / 50));
    for (let i = 0; i < steps; i++) {
      if (!isLoopAlive()) return false;
      await new Promise(r => setTimeout(r, 50));
    }
    return isLoopAlive();
  };

  let connectedOk = false;
  let stoppedByUser = false;
  let stoppedByConfig = false;
  let lastWasSilenceExhausted = false;
  let cachedActiveList = null;

  try {
    for (let attempt = 1; attempt <= MAX_DICE_ATTEMPTS; attempt++) {
      if (!isLoopAlive()) {
        stoppedByUser = Boolean(targetHs._aslDiceStopRequested);
        break;
      }

      const effCard = getLiveCard();
      setAslProcBannerState(effCard, {
        active: true,
        text: attempt === 1
          ? (window.t ? window.t("asl.dice_searching", {}, "🎲 Поиск случайного активного узла ASL...") : "🎲 Поиск случайного активного узла ASL...")
          : (window.t ? window.t("asl.dice_retry", { attempt, max: MAX_DICE_ATTEMPTS }, `🎲 Повторный поиск узла ASL (${attempt}/${MAX_DICE_ATTEMPTS})...`) : `🎲 Повторный поиск узла ASL (${attempt}/${MAX_DICE_ATTEMPTS})...`),
        tone: "neutral",
        autoHideMs: 0
      });

      if (!cachedActiveList || attempt === 1) {
        const activeListPromise = fetchActiveKeyedAslNodes();
        const minAnimPromise = attempt === 1 ? new Promise(resolve => setTimeout(resolve, 450)) : Promise.resolve();
        const [fetchedList] = await Promise.all([activeListPromise, minAnimPromise]);
        if (!isRunTokenValid()) break;
        if (Array.isArray(fetchedList) && fetchedList.length > 0) {
          cachedActiveList = fetchedList;
        }
      }

      if (targetHs._aslDiceStopRequested) {
        stoppedByUser = true;
        break;
      }

      const activeList = Array.isArray(cachedActiveList) ? cachedActiveList : [];
      const ownNode = String((targetHs && targetHs.allstar_node) || "").trim();

      const connectedSet = new Set();
      if (targetHs) {
        if (targetHs.connected_node) connectedSet.add(String(targetHs.connected_node).trim());
        if (Array.isArray(targetHs.asl_links)) {
          targetHs.asl_links.forEach(lk => {
            if (lk && lk.node) connectedSet.add(String(lk.node).trim());
          });
        }
      }

      const baseCandidates = activeList.filter(item => {
        const n = String((item && item.node) || "").trim();
        if (!isValidPublicAslNodeClient(n)) return false;
        if (ownNode && n === ownNode) return false;
        return true;
      });

      const untriedCandidates = baseCandidates.filter(it => !triedNodes.has(String(it.node).trim()));
      const sourceList = untriedCandidates.length > 0 ? untriedCandidates : baseCandidates;
      const nonConnected = sourceList.filter(it => !connectedSet.has(String(it.node).trim()));
      const poolBase = nonConnected.length > 0 ? nonConnected : sourceList;

      if (!poolBase.length) {
        const emptyMsg = window.t
          ? window.t("asl.dice_empty_toast", {}, "🎲 Сейчас нет доступных активных узлов на stats.allstarlink.org/stats/keyed")
          : "🎲 Сейчас нет доступных активных узлов на stats.allstarlink.org/stats/keyed";
        if (typeof showToast === "function") {
          showToast(emptyMsg, "warning", 2800, effCard);
        }
        setAslProcBannerState(effCard, {
          active: true,
          text: emptyMsg,
          tone: "negative",
          autoHideMs: 4000,
          fadeOutMs: 2000
        });
        break;
      }

      if (!window._aslDiceRecentMap) window._aslDiceRecentMap = {};
      const recentArr = Array.isArray(window._aslDiceRecentMap[cid]) ? window._aslDiceRecentMap[cid] : [];
      const recentSet = new Set(recentArr);

      const diceTargetIdx = getAslMatrixPage(cid, targetHs) * ASL_PAGE_SIZE + (ASL_PAGE_SIZE - 1);
      const preset0to18 = new Set(
        (Array.isArray(userNodes) ? userNodes.filter((_, i) => i !== diceTargetIdx) : [])
          .map(u => String((u && u.node) || "").trim())
          .filter(Boolean)
      );

      const tier1 = poolBase.filter(it => (Number(it.public_links_count) || 0) >= 1 && !preset0to18.has(it.node) && !recentSet.has(it.node));
      const tier2 = poolBase.filter(it => (Number(it.public_links_count) || 0) >= 1 && !preset0to18.has(it.node));
      const tier3 = poolBase.filter(it => !preset0to18.has(it.node) && !recentSet.has(it.node));
      const tier4 = poolBase.filter(it => !preset0to18.has(it.node));
      const tier5 = poolBase.filter(it => !recentSet.has(it.node));

      const finalPool = tier1.length ? tier1
        : (tier2.length ? tier2
        : (tier3.length ? tier3
        : (tier4.length ? tier4
        : (tier5.length ? tier5 : poolBase))));

      const chosen = finalPool[Math.floor(Math.random() * finalPool.length)];
      const chosenNode = String(chosen.node).trim();
      const chosenFlag = (chosen.flag && chosen.flag !== "➕" && chosen.flag !== "☎️") ? chosen.flag : "🌐";
      const chosenLabel = String(chosen.label || chosen.callsign || `Node ${chosenNode}`).trim();
      triedNodes.add(chosenNode);

      const updatedRecent = [chosenNode, ...recentArr.filter(x => x !== chosenNode)].slice(0, 10);
      window._aslDiceRecentMap[cid] = updatedRecent;

      if (targetHs._aslDiceStopRequested) {
        stoppedByUser = true;
        break;
      }

      if (targetHs) {
        targetHs._aslDynamicMatrixMode = false;
        targetHs._aslMovingIdx = null;
        targetHs.asl_unlisted_links = [];
        if (targetHs._aslDismissedUnlisted) targetHs._aslDismissedUnlisted.clear();
        if (!targetHs._aslDisconnectingNodes) targetHs._aslDisconnectingNodes = new Set();
        if (targetHs.connected_node) targetHs._aslDisconnectingNodes.add(String(targetHs.connected_node).trim());
        if (Array.isArray(targetHs.asl_links)) {
          targetHs.asl_links.forEach(l => { if (l && l.node) targetHs._aslDisconnectingNodes.add(String(l.node).trim()); });
        }
      }

      if (Array.isArray(userNodes) && userNodes.length > diceTargetIdx && !preset0to18.has(chosenNode)) {
        userNodes[diceTargetIdx] = {
          node: chosenNode,
          label: chosenLabel,
          flag: chosenFlag,
          role: "node",
          scan: false
        };
        saveAslUserNodes(cid, userNodes);
      }

      const cardBeforeConn = getLiveCard();
      updateCardAllStarPanel(cardBeforeConn, targetHs);

      // Сбрасываем старые флаги приёма перед новым подключением
      targetHs._aslCarrierRx = false;
      targetHs._aslLastRxAudioMs = 0;
      targetHs._aslRxActiveNode = "";
      targetHs._aslKeyedNodes = [];
      if (cardBeforeConn && cardBeforeConn._lastRx && cardBeforeConn._lastRx[1]) {
        cardBeforeConn._lastRx[1].active = false;
        cardBeforeConn._lastRx[1].lastAudioTime = 0;
      }
      const vfoRowClean = cardBeforeConn ? cardBeforeConn.querySelector(".vfo-allstar-row") : null;
      if (vfoRowClean) vfoRowClean.classList.remove("allstar-rx-active");

      // Строго режим Монитора (*2) от кубика
      aslConnectNodeProcedure(cid, chosenNode, "*2", {
        showStatusBanner: true,
        showCardEffects: true,
        fromDice: true
      });

      let waitConnMs = 0;
      let isConnected = false;
      while (waitConnMs < 12000 && isLoopAlive()) {
        const linkedInArray = Array.isArray(targetHs.asl_links) && targetHs.asl_links.some(l => String(l.node).trim() === chosenNode && !l.connecting);
        if (String(targetHs.connected_node || "").trim() === chosenNode || linkedInArray) {
          isConnected = true;
          break;
        }
        const stillConnecting = Boolean(targetHs._aslConnectingNodes instanceof Map && targetHs._aslConnectingNodes.has(chosenNode));
        if (waitConnMs >= 300 && !stillConnecting) {
          break;
        }
        await new Promise(r => setTimeout(r, 150));
        waitConnMs += 150;
      }
      if (!isRunTokenValid()) break;

      if (isConnected) {
        const curCfg = getAslDiceConfig(cid);
        const liveCard = getLiveCard();
        if (!curCfg.continueOnSilence) {
          connectedOk = true;
          if (typeof showToast === "function") {
            const toastMsg = window.t
              ? window.t(
                  "asl.dice_rolled_toast",
                  { node: chosenNode, flag: chosenFlag, label: chosenLabel },
                  `🎲 Случайный узел: ${chosenFlag} #${chosenNode} (${chosenLabel}) — Монитор *2`
                )
              : `🎲 Случайный узел: ${chosenFlag} #${chosenNode} (${chosenLabel}) — Монитор *2`;
            showToast(toastMsg, "info", 2800, liveCard);
          }
          break;
        }

        // Режим «Продолжать при отсутствии общения в течение N секунд»
        let elapsedSilenceMs = 0;
        let speechDetected = isAslNodeRxActive(liveCard, targetHs);
        let cfgWaitDisabled = false;
        const stepMs = 150;
        while (!speechDetected && isLoopAlive()) {
          const liveCfg = getAslDiceConfig(cid);
          if (!liveCfg.continueOnSilence) {
            cfgWaitDisabled = true;
            break;
          }
          const waitTotalMs = Math.max(1, liveCfg.silenceWaitSec) * 1000;
          if (elapsedSilenceMs >= waitTotalMs) break;

          if (isAslNodeRxActive(getLiveCard(), targetHs)) {
            speechDetected = true;
            break;
          }

          const remSec = Math.max(1, Math.ceil((waitTotalMs - elapsedSilenceMs) / 1000));
          setAslProcBannerState(getLiveCard(), {
            active: true,
            text: window.t
              ? window.t("asl.dice_wait_speech", { node: chosenNode, sec: remSec }, `🎲 #${chosenNode} подключён — ожидание речи (${remSec}с)...`)
              : `🎲 #${chosenNode} подключён — ожидание речи (${remSec}с)...`,
            tone: "neutral",
            autoHideMs: 0
          });

          await new Promise(r => setTimeout(r, stepMs));
          elapsedSilenceMs += stepMs;
        }
        if (!isRunTokenValid()) break;

        const postWaitCard = getLiveCard();
        if (!speechDetected && isAslNodeRxActive(postWaitCard, targetHs)) {
          speechDetected = true;
        }

        if (speechDetected || cfgWaitDisabled) {
          connectedOk = true;
          if (speechDetected) {
            setAslProcBannerState(postWaitCard, {
              active: true,
              text: window.t
                ? window.t("asl.dice_speech_found", { node: chosenNode }, `🔊 #${chosenNode}: обнаружена речь в эфире`)
                : `🔊 #${chosenNode}: обнаружена речь в эфире`,
              tone: "positive",
              autoHideMs: 4000,
              fadeOutMs: 1800
            });
          }
          if (typeof showToast === "function") {
            const toastMsg = window.t
              ? window.t(
                  "asl.dice_rolled_toast",
                  { node: chosenNode, flag: chosenFlag, label: chosenLabel },
                  `🎲 Случайный узел: ${chosenFlag} #${chosenNode} (${chosenLabel}) — Монитор *2`
                )
              : `🎲 Случайный узел: ${chosenFlag} #${chosenNode} (${chosenLabel}) — Монитор *2`;
            showToast(toastMsg, speechDetected ? "success" : "info", 3000, postWaitCard);
          }
          break;
        }

        if (targetHs._aslDiceStopRequested || !isLoopAlive()) {
          stoppedByUser = true;
          break;
        }

        const afterWaitCfg = getAslDiceConfig(cid);
        if (!afterWaitCfg.continueOnSilence) {
          connectedOk = true;
          break;
        }

        if (attempt < MAX_DICE_ATTEMPTS) {
          setAslProcBannerState(postWaitCard, {
            active: true,
            text: window.t
              ? window.t("asl.dice_silence_retry", { node: chosenNode, sec: afterWaitCfg.silenceWaitSec, attempt: attempt + 1, max: MAX_DICE_ATTEMPTS }, `🔇 #${chosenNode}: тишина (${afterWaitCfg.silenceWaitSec}с) — следующий (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`)
              : `🔇 #${chosenNode}: тишина (${afterWaitCfg.silenceWaitSec}с) — следующий (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`,
            tone: "neutral",
            autoHideMs: 0
          });
          const keepGoing = await cancellablePause(250);
          if (!keepGoing) {
            stoppedByUser = Boolean(isRunTokenValid() && targetHs._aslDiceStopRequested);
            break;
          }
          continue;
        }

        lastWasSilenceExhausted = true;
        setAslProcBannerState(postWaitCard, {
          active: true,
          text: window.t
            ? window.t("asl.dice_silence_exhausted", { max: MAX_DICE_ATTEMPTS }, `🔇 Не найдено активной речи среди ${MAX_DICE_ATTEMPTS} случайных узлов`)
            : `🔇 Не найдено активной речи среди ${MAX_DICE_ATTEMPTS} случайных узлов`,
          tone: "negative",
          autoHideMs: 4500,
          fadeOutMs: 2000
        });
        break;
      }

      if (targetHs._aslDiceStopRequested) {
        stoppedByUser = true;
        break;
      }

      const liveFailCard = getLiveCard();
      const failCfg = getAslDiceConfig(cid);
      if (!failCfg.continueOnFail) {
        stoppedByConfig = true;
        const failMsg = window.t
          ? window.t("asl.dice_fail_stopped", { node: chosenNode }, `✕ #${chosenNode} недоступен — повтор при сбое отключён`)
          : `✕ #${chosenNode} недоступен — повтор при сбое отключён`;
        setAslProcBannerState(liveFailCard, {
          active: true,
          text: failMsg,
          tone: "negative",
          autoHideMs: 4000,
          fadeOutMs: 2000
        });
        if (typeof showToast === "function") {
          showToast(failMsg, "warning", 2800, liveFailCard);
        }
        break;
      }

      if (attempt < MAX_DICE_ATTEMPTS) {
        setAslProcBannerState(liveFailCard, {
          active: true,
          text: window.t
            ? window.t("asl.dice_retry", { attempt: attempt + 1, max: MAX_DICE_ATTEMPTS }, `🎲 Повторный поиск узла ASL (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`)
            : `🎲 Повторный поиск узла ASL (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`,
          tone: "neutral",
          autoHideMs: 0
        });
        const keepGoing = await cancellablePause(350);
        if (!keepGoing) {
          stoppedByUser = Boolean(isRunTokenValid() && targetHs._aslDiceStopRequested);
          break;
        }
      } else {
        setAslProcBannerState(liveFailCard, {
          active: true,
          text: window.t
            ? window.t("asl.dice_exhausted", { max: MAX_DICE_ATTEMPTS }, `✕ Не удалось подключиться ни к одному из ${MAX_DICE_ATTEMPTS} случайных узлов`)
            : `✕ Не удалось подключиться ни к одному из ${MAX_DICE_ATTEMPTS} случайных узлов`,
          tone: "negative",
          autoHideMs: 4000,
          fadeOutMs: 2000
        });
      }
    }
  } catch (err) {
    console.warn("[ASL] Dice roll error:", err);
    if (isRunTokenValid() && !targetHs._aslDiceStopRequested && typeof showToast === "function") {
      const diceErrMsg = window.t
        ? window.t("asl.dice_roll_error", { error: err.message || err }, `✕ Ошибка «Кубика» ASL: ${err.message || err}`)
        : `✕ Ошибка «Кубика» ASL: ${err.message || err}`;
      showToast(diceErrMsg, "error", 2500, getLiveCard());
    }
  } finally {
    if (isRunTokenValid()) {
      const wasStopped = stoppedByUser || Boolean(targetHs._aslDiceStopRequested);
      targetHs._aslDiceRolling = false;
      targetHs._aslDiceStopRequested = false;
      const liveCardEnd = getLiveCard();
      syncAslDiceButtonUI(liveCardEnd, targetHs);
      if (wasStopped && !connectedOk && !stoppedByConfig && !lastWasSilenceExhausted) {
        setAslProcBannerState(liveCardEnd, {
          active: true,
          text: window.t ? window.t("asl.dice_stopped", {}, "⏹ Поиск случайного узла ASL остановлен") : "⏹ Поиск случайного узла ASL остановлен",
          tone: "neutral",
          autoHideMs: 4000,
          fadeOutMs: 2000
        });
      }
    }
  }
}

export function getAslNodeShortInfo(nodeStr, targetHs = null, cid = "default") {
  const cleanN = String(nodeStr || "").trim();
  if (!cleanN || cleanN === "0") {
    return { label: "", flag: "" };
  }

  let label = "";
  let flag = "";

  // 1. Поиск в пользовательской матрице ячеек памяти
  try {
    const parsed = getAslStoredNodes(cid);
    if (Array.isArray(parsed)) {
      const found = parsed.find(u => u && String(u.node).trim() === cleanN);
      if (found) {
        const rawLbl = String(found.label || "").trim();
        if (rawLbl && rawLbl !== "[настроить]" && rawLbl !== "[setup]" && rawLbl !== "Свободно" && rawLbl !== "Empty") {
          label = rawLbl;
        }
        if (found.flag && found.flag !== "➕") {
          flag = String(found.flag).trim();
        }
      }
    }
  } catch (_) {}

  // 2. Поиск в активных линках хотспота (обогащённых бэкендом из allstar_dir_mgr)
  if (!label && targetHs && Array.isArray(targetHs.asl_links)) {
    const lk = targetHs.asl_links.find(l => l && String(l.node).trim() === cleanN);
    if (lk) {
      const rawName = String(lk.name || lk.callsign || lk.city || "").trim();
      if (rawName && !rawName.startsWith(`Node ${cleanN}`)) {
        label = rawName;
      }
      if (lk.flag && lk.flag !== "➕") {
        flag = String(lk.flag).trim();
      }
    }
  }

  // 3. Поиск в глобальном справочнике узлов AllStarLink
  if (!label) {
    let dirItem = null;
    if (typeof window !== "undefined" && typeof window.findAslDirectoryNode === "function") {
      dirItem = window.findAslDirectoryNode(cleanN);
    } else if (typeof window !== "undefined" && typeof window.getAllStarNodesDirectory === "function") {
      const dir = window.getAllStarNodesDirectory();
      if (Array.isArray(dir)) {
        dirItem = dir.find(d => d && String(d.node).trim() === cleanN);
      }
    }
    if (dirItem) {
      const dName = String(dirItem.name || dirItem.hub || dirItem.callsign || "").trim();
      if (dName && !dName.startsWith(`Node ${cleanN}`)) {
        label = dName;
      }
      if (dirItem.flag && dirItem.flag !== "➕") {
        flag = String(dirItem.flag).trim();
      }
    }
  }

  // 4. Локальное эхо Parrot
  if (!label && cleanN === "1999") {
    label = "Parrot Echo";
    if (!flag) flag = "🦜";
  }

  return { label, flag };
}

export function updateAslVfoHeader(card, hs = null) {
  if (!card) return;
  const targetHs = hs || (card.dataset.hotspotId ? (getCurrentHotspots().find(h => h.id === card.dataset.hotspotId) || null) : null) || (getCurrentHotspots()[0] || null);
  const callsignEl = card.querySelector(".callsign-display");
  if (!callsignEl) return;

  const myCall = String((targetHs && targetHs.callsign) || "N0CALL").trim();
  const connNode = String((targetHs && (targetHs.connected_node || targetHs.target_node)) || "").trim();
  const isLinked = Boolean(connNode && connNode !== "0");
  const cid = (targetHs && targetHs.id) || card.dataset.hotspotId || "default";

  const aslHeaderBadge = card.querySelector(".asl-header-status-badge");
  if (aslHeaderBadge) {
    aslHeaderBadge.className = `asl-header-status-badge ${isLinked ? "asl-badge-linked" : "asl-badge-idle"}`;
    aslHeaderBadge.title = isLinked 
      ? (window.t ? window.t("asl.header_badge_linked", {}, "Подключен к сети ASL3 (активен линк)") : "Подключен к сети ASL3 (активен линк)")
      : (window.t ? window.t("asl.header_badge_standby", {}, "Узел ASL3 в режиме ожидания (нет активных линков)") : "Узел ASL3 в режиме ожидания (нет активных линков)");
  }

  // 1. Режим ожидания: ТОЛЬКО свой позывной, шрифтом на пункт больше, без точек и надписи "Ожидание"
  if (!isLinked) {
    const idleKey = `idle_${myCall}`;
    if (callsignEl._lastAslVfoKey === idleKey) return;
    callsignEl._lastAslVfoKey = idleKey;
    callsignEl.classList.remove("has-asl-marquee");
    callsignEl.innerHTML = `<span class="asl-vfo-callsign asl-vfo-standby">${safeEscapeHtml(myCall)}</span>`;
    callsignEl.removeAttribute("title");
    return;
  }

  // 2. Режим подключения: вместо позывного выводится название узла с его ID
  const { label, flag } = getAslNodeShortInfo(connNode, targetHs, cid);
  let displayTitle = "";
  if (label && label !== connNode) {
    displayTitle = `${label} (${connNode})`;
  } else {
    displayTitle = window.t ? window.t("asl.node_fallback", { node: connNode }, `Node #${connNode}`) : `Node #${connNode}`;
  }

  const flagHtml = flag ? `<span class="asl-vfo-hub-flag">${safeEscapeHtml(flag)}</span> ` : "";
  const countStr = (targetHs && targetHs.asl_online_count !== undefined && targetHs.asl_online_count > 1) ? ` (${targetHs.asl_online_count})` : "";

  const vfoKey = `linked_${connNode}_${displayTitle}_${countStr}_${flag}`;
  if (callsignEl._lastAslVfoKey === vfoKey) {
    return;
  }
  callsignEl._lastAslVfoKey = vfoKey;

  const itemHtml = `<span class="asl-vfo-marquee-item">${flagHtml}<strong class="asl-vfo-target-node">${safeEscapeHtml(displayTitle)}</strong>${countStr}</span>`;

  callsignEl.innerHTML = `<div class="asl-vfo-marquee-track"><div class="asl-vfo-marquee-inner">${itemHtml}</div></div>`;
  callsignEl.title = window.t
    ? window.t("asl.vfo_tooltip_node", { node: connNode, label: displayTitle }, `Узел #${connNode}: ${displayTitle}`)
    : `Узел #${connNode}: ${displayTitle}`;

  // 3. Замер переполнения для бесшовной бесконечной бегущей строки (Seamless Infinite Marquee)
  requestAnimationFrame(() => {
    const track = callsignEl.querySelector(".asl-vfo-marquee-track");
    const inner = callsignEl.querySelector(".asl-vfo-marquee-inner");
    const item = callsignEl.querySelector(".asl-vfo-marquee-item");
    if (!track || !inner || !item) return;

    const itemWidth = Math.ceil(item.getBoundingClientRect().width || item.scrollWidth);
    const trackWidth = Math.floor(track.getBoundingClientRect().width || track.clientWidth);
    const diff = itemWidth - trackWidth;
    if (diff > 4) {
      const sep = `<span class="asl-vfo-marquee-sep" aria-hidden="true">&nbsp;---&nbsp;</span>`;
      inner.innerHTML = `${itemHtml}${sep}${itemHtml}${sep}`;
      callsignEl.classList.add("has-asl-marquee");
      track.classList.add("asl-marquee-active");
      const halfWidth = Math.max(100, Math.round(inner.scrollWidth / 2));
      const durSec = Math.max(7, Math.min(30, Math.round(halfWidth / 28)));
      track.style.setProperty("--asl-marquee-dur", `${durSec}s`);
    } else {
      callsignEl.classList.remove("has-asl-marquee");
      track.classList.remove("asl-marquee-active");
      track.style.removeProperty("--asl-marquee-dur");
    }
  });
}

// YSF Matrix and Dashboard block for hotspots.js
export const YSF_PAGE_SIZE = 20;
export const YSF_PAGE_COUNT = 3;
export const YSF_MEMORY_SIZE = YSF_PAGE_SIZE * YSF_PAGE_COUNT;
const YSF_PAGE_LS_PREFIX = "proxdmr_ysf_matrix_page_";

export const DEFAULT_YSF_MATRIX_ROOMS = [
  { room: "25000", label: "YSF-Russia", flag: "🇷🇺", scan: false },
  { room: "21080", label: "America-Link", flag: "🇺🇸", scan: false },
  { room: "20000", label: "Europe-Link", flag: "🇪🇺", scan: false },
  { room: "26200", label: "DL-Germany", flag: "🇩🇪", scan: false },
  { room: "23400", label: "UK-YSF", flag: "🇬🇧", scan: false },
  { room: "20800", label: "France-YSF", flag: "🇫🇷", scan: false },
  { room: "22200", label: "Italy-YSF", flag: "🇮🇹", scan: false },
  { room: "28400", label: "Bulgaria-YSF", flag: "🇧🇬", scan: false },
  { room: "20200", label: "Hellas-YSF", flag: "🇬🇷", scan: false },
  { room: "72400", label: "Brazil-YSF", flag: "🇧🇷", scan: false },
  { room: "26800", label: "Portugal-YSF", flag: "🇵🇹", scan: false },
  { room: "21400", label: "Spain-YSF", flag: "🇪🇸", scan: false },
  { room: "26000", label: "Poland-YSF", flag: "🇵🇱", scan: false },
  { room: "20400", label: "Netherlands", flag: "🇳🇱", scan: false },
  { room: "20600", label: "Belgium-YSF", flag: "🇧🇪", scan: false },
  { room: "24000", label: "Sweden-YSF", flag: "🇸🇪", scan: false },
  { room: "24200", label: "Norway-YSF", flag: "🇳🇴", scan: false },
  { room: "23800", label: "Denmark-YSF", flag: "🇩🇰", scan: false },
  { room: "24400", label: "Finland-YSF", flag: "🇫🇮", scan: false },
  { room: "9999", label: "YSF-Parrot", flag: "🦜", scan: false }
];

export function makeEmptyYsfCell() {
  return { room: "", label: "", flag: "➕", scan: false };
}

export function padYsfRooms(list) {
  const out = Array.isArray(list) ? list.slice(0, YSF_MEMORY_SIZE) : [];
  while (out.length < YSF_MEMORY_SIZE) out.push(makeEmptyYsfCell());
  return out;
}

export function getYsfMatrixPage(cid, hs) {
  let p = (hs && Number.isInteger(hs._ysfMatrixPage)) ? hs._ysfMatrixPage : null;
  if (p === null) {
    try {
      p = parseInt(localStorage.getItem(YSF_PAGE_LS_PREFIX + cid) || "0", 10);
    } catch (_) {
      p = 0;
    }
  }
  if (!Number.isInteger(p) || p < 0 || p >= YSF_PAGE_COUNT) p = 0;
  if (hs) hs._ysfMatrixPage = p;
  return p;
}

export function setYsfMatrixPageValue(cid, hs, page) {
  const v = ((page % YSF_PAGE_COUNT) + YSF_PAGE_COUNT) % YSF_PAGE_COUNT;
  if (hs) hs._ysfMatrixPage = v;
  try {
    localStorage.setItem(YSF_PAGE_LS_PREFIX + cid, String(v));
  } catch (_) {}
  return v;
}

export function getYsfMatrixRooms(cid) {
  try {
    let parsed = null;
    if (hasServerCollectionKey("ysf_matrix", cid)) {
      parsed = getServerCollectionValue("ysf_matrix", cid);
    } else if (hasServerCollectionKey("ysf_matrix", "global")) {
      parsed = getServerCollectionValue("ysf_matrix", "global");
    }
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed) {
      const raw = localStorage.getItem(`proxdmr_ysf_matrix_${cid}`) || localStorage.getItem("proxdmr_ysf_matrix_global");
      if (raw) parsed = JSON.parse(raw);
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      return padYsfRooms(parsed.map(item => {
        const rId = String(item.room || item.node || item.id || "").trim();
        const rLabel = String(item.label || item.name || "").trim();
        let rFlag = String(item.flag || "").trim();
        if (rId && (!rFlag || rFlag === "➕" || rFlag === "🌐" || rFlag === "null")) {
          const detected = detectYsfCountryFlag(rId, rLabel);
          if (detected && detected.flag && detected.flag !== "➕") {
            rFlag = detected.flag;
          }
        }
        if (!rFlag) rFlag = rId ? "🌐" : "➕";
        const rTypeOvr = String(item.type_override || item.reflector_type_override || "").trim().toLowerCase();
        return {
          room: rId,
          label: rLabel,
          flag: rFlag,
          scan: Boolean(item.scan),
          type_override: (rTypeOvr === "single" || rTypeOvr === "multi_standard" || rTypeOvr === "multi_mutant") ? rTypeOvr : ""
        };
      }));
    }
  } catch (_) {}
  return padYsfRooms([...DEFAULT_YSF_MATRIX_ROOMS]);
}

export function saveYsfMatrixRooms(cid, rooms) {
  try {
    const padded = padYsfRooms(rooms);
    setServerCollectionKey("ysf_matrix", cid, padded, "proxdmr_ysf_matrix_", true);
    setServerCollectionKey("ysf_matrix", "global", padded, "proxdmr_ysf_matrix_", true);
  } catch (_) {}
}

const DEFAULT_YSF_SCAN_CONFIG = {
  mode: "timer",
  timerHoldSec: 15,
  releaseHoldSec: 3,
  dwellSec: 5
};

export function getYsfScanConfig(cid) {
  try {
    let parsed = null;
    if (hasServerCollectionKey("ysf_scan_cfg", cid)) {
      parsed = getServerCollectionValue("ysf_scan_cfg", cid);
    } else if (hasServerCollectionKey("ysf_scan_cfg", "global")) {
      parsed = getServerCollectionValue("ysf_scan_cfg", "global");
    }
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed && typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(`proxdmr_ysf_scan_cfg_${cid}`) || localStorage.getItem("proxdmr_ysf_scan_cfg_global");
      if (raw) parsed = JSON.parse(raw);
    }
    if (parsed && typeof parsed === "object") {
      return {
        mode: (parsed.mode === "wait" || parsed.mode === "timer") ? parsed.mode : "timer",
        timerHoldSec: Math.max(5, Math.min(120, parseInt(parsed.timerHoldSec, 10) || 15)),
        releaseHoldSec: Math.max(1, Math.min(45, parseInt(parsed.releaseHoldSec, 10) || 3)),
        dwellSec: 5
      };
    }
  } catch (_) {}
  return { ...DEFAULT_YSF_SCAN_CONFIG };
}

export function saveYsfScanConfig(cid, cfg) {
  try {
    setServerCollectionKey("ysf_scan_cfg", cid, cfg, "proxdmr_ysf_scan_cfg_", true);
    setServerCollectionKey("ysf_scan_cfg", "global", cfg, "proxdmr_ysf_scan_cfg_", true);
  } catch (_) {}
}

const DEFAULT_YSF_DICE_CONFIG = {
  continueOnFail: true,
  continueOnSilence: false,
  silenceWaitSec: 10
};

function _normalizeYsfDiceConfig(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  const waitParsed = parseInt(src.silenceWaitSec, 10);
  const clampedWait = Number.isFinite(waitParsed)
    ? Math.max(1, Math.min(60, waitParsed))
    : DEFAULT_YSF_DICE_CONFIG.silenceWaitSec;
  return {
    continueOnFail: src.continueOnFail === undefined ? DEFAULT_YSF_DICE_CONFIG.continueOnFail : Boolean(src.continueOnFail),
    continueOnSilence: src.continueOnSilence === undefined ? DEFAULT_YSF_DICE_CONFIG.continueOnSilence : Boolean(src.continueOnSilence),
    silenceWaitSec: clampedWait
  };
}

export function getYsfDiceConfig(cid) {
  try {
    let parsed = null;
    if (hasServerCollectionKey("ysf_dice_cfg", cid)) {
      parsed = getServerCollectionValue("ysf_dice_cfg", cid);
    } else if (hasServerCollectionKey("ysf_dice_cfg", "global")) {
      parsed = getServerCollectionValue("ysf_dice_cfg", "global");
    }
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed && typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(`proxdmr_ysf_dice_cfg_${cid}`) || localStorage.getItem("proxdmr_ysf_dice_cfg_global");
      if (raw) parsed = JSON.parse(raw);
    }
    if (parsed && typeof parsed === "object") {
      return _normalizeYsfDiceConfig(parsed);
    }
  } catch (_) {}
  return { ...DEFAULT_YSF_DICE_CONFIG };
}

export function saveYsfDiceConfig(cid, cfg) {
  const normalized = _normalizeYsfDiceConfig(cfg);
  try {
    setServerCollectionKey("ysf_dice_cfg", cid, normalized, "proxdmr_ysf_dice_cfg_", true);
    setServerCollectionKey("ysf_dice_cfg", "global", normalized, "proxdmr_ysf_dice_cfg_", true);
  } catch (_) {}
  return normalized;
}

const DEFAULT_ADN_DICE_CONFIG = {
  continueOnFail: true,
  continueOnSilence: false,
  silenceWaitSec: 10
};

function _normalizeAdnDiceConfig(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  const waitParsed = parseInt(src.silenceWaitSec, 10);
  const clampedWait = Number.isFinite(waitParsed)
    ? Math.max(1, Math.min(60, waitParsed))
    : DEFAULT_ADN_DICE_CONFIG.silenceWaitSec;
  return {
    continueOnFail: src.continueOnFail === undefined ? DEFAULT_ADN_DICE_CONFIG.continueOnFail : Boolean(src.continueOnFail),
    continueOnSilence: src.continueOnSilence === undefined ? DEFAULT_ADN_DICE_CONFIG.continueOnSilence : Boolean(src.continueOnSilence),
    silenceWaitSec: clampedWait
  };
}

export function getAdnDiceConfig(cid) {
  try {
    let parsed = null;
    if (hasServerCollectionKey("adn_dice_cfg", cid)) {
      parsed = getServerCollectionValue("adn_dice_cfg", cid);
    } else if (hasServerCollectionKey("adn_dice_cfg", "global")) {
      parsed = getServerCollectionValue("adn_dice_cfg", "global");
    }
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed && typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(`proxdmr_adn_dice_cfg_${cid}`) || localStorage.getItem("proxdmr_adn_dice_cfg_global");
      if (raw) parsed = JSON.parse(raw);
    }
    if (parsed && typeof parsed === "object") {
      return _normalizeAdnDiceConfig(parsed);
    }
  } catch (_) {}
  return { ...DEFAULT_ADN_DICE_CONFIG };
}

export function saveAdnDiceConfig(cid, cfg) {
  const normalized = _normalizeAdnDiceConfig(cfg);
  try {
    setServerCollectionKey("adn_dice_cfg", cid, normalized, "proxdmr_adn_dice_cfg_", true);
    setServerCollectionKey("adn_dice_cfg", "global", normalized, "proxdmr_adn_dice_cfg_", true);
  } catch (_) {}
  return normalized;
}

export function isYsfRoomRxActive(card, targetHs) {
  const nowMs = Date.now();
  const nowSec = nowMs / 1000;

  // 1. Реальное поступление голосовых PCM-пакетов за последние 950 мс
  if (card && card._lastRx && card._lastRx[1] && card._lastRx[1].lastAudioTime) {
    if ((nowSec - card._lastRx[1].lastAudioTime) < 0.95) {
      return true;
    }
  }
  if (targetHs && targetHs._ysfLastRxAudioMs) {
    if ((nowMs - targetHs._ysfLastRxAudioMs) < 950) {
      return true;
    }
  }

  // 2. Флаг несущей ysf_carrier / VFO RX / _lastRx[1].active, только если звук не прекратился давно
  const ts1Row = card ? card.querySelector(".vfo-ts1-row") : null;
  const domRx = Boolean(ts1Row && ts1Row.classList.contains("vfo-rx-active"));
  const dsRx = Boolean(card && card.dataset && card.dataset.rxState === "rx");
  const stateRx = Boolean(targetHs && (targetHs._ysfCarrierRx || targetHs.state === "RX" || targetHs.status === "RX"));
  const lastRxActive = Boolean(card && card._lastRx && card._lastRx[1] && card._lastRx[1].active);
  if (stateRx || domRx || dsRx || lastRxActive) {
    const lastAudioMs = (targetHs && targetHs._ysfLastRxAudioMs) || ((card?._lastRx?.[1]?.lastAudioTime || 0) * 1000);
    if (!lastAudioMs || (nowMs - lastAudioMs) < 1500) {
      return true;
    }
  }

  return false;
}

export function isAdnSlotRxActive(card, targetHs, slot) {
  const nowMs = Date.now();
  const nowSec = nowMs / 1000;
  const s = Number(slot) === 1 ? 1 : 2;

  if (card && card._lastRx && card._lastRx[s] && card._lastRx[s].lastAudioTime) {
    if ((nowSec - card._lastRx[s].lastAudioTime) < 0.95) {
      return true;
    }
  }
  if (targetHs && targetHs._adnLastRxAudioMs) {
    if ((nowMs - targetHs._adnLastRxAudioMs) < 950) {
      return true;
    }
  }

  const tsRow = card ? card.querySelector(s === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row") : null;
  const domRx = Boolean(tsRow && tsRow.classList.contains("vfo-rx-active"));
  const lastRxActive = Boolean(card && card._lastRx && card._lastRx[s] && card._lastRx[s].active);
  if (domRx || lastRxActive) {
    const lastAudioTime = card && card._lastRx && card._lastRx[s] ? card._lastRx[s].lastAudioTime : 0;
    const lastAudioMs = (targetHs && targetHs._adnLastRxAudioMs) || (lastAudioTime ? lastAudioTime * 1000 : 0);
    if (!lastAudioMs || (nowMs - lastAudioMs) < 1500) {
      return true;
    }
  }

  return false;
}

export function stopYsfMatrixScan(cid, card, targetHs, { keepCurrentLink = true, silent = false } = {}) {
  if (targetHs) {
    targetHs._ysfScanActive = false;
    targetHs._ysfScanRunId = (targetHs._ysfScanRunId || 0) + 1;
    targetHs._ysfScanningRoom = "";
  }
  if (card) {
    const btn = card.querySelector(".btn-ysf-scan");
    if (btn) btn.classList.remove("scan-running");
    card.querySelectorAll(".btn-ysf-room-cell.ysf-node-scanning-now, .btn-ysf-room-cell.asl-node-scanning-now").forEach(el => {
      el.classList.remove("ysf-node-scanning-now");
      el.classList.remove("asl-node-scanning-now");
    });
    if (!silent) {
      setAslProcBannerState(card, {
        active: true,
        text: window.t ? window.t("ysf.scan_stopped", {}, "⏹ Сканирование YSF остановлено") : "⏹ Сканирование YSF остановлено",
        tone: "neutral",
        autoHideMs: 4000
      });
    }
  }
  if (!keepCurrentLink && typeof ysfDisconnectProcedure === "function") {
    ysfDisconnectProcedure(cid, card, { showStatusBanner: false });
  }
}

export async function startYsfMatrixScan(cid, card, targetHs, rooms) {
  if (!card || !targetHs) return;
  if (targetHs._ysfDiceRolling) {
    stopYsfDiceSearch(cid, card, targetHs, { immediateAbort: true, silent: true });
  }

  const initialRooms = Array.isArray(rooms) ? rooms : getYsfMatrixRooms(cid);
  const scanTargets = (initialRooms || []).filter(item => item && item.room && item.scan);
  if (scanTargets.length === 0) {
    setAslProcBannerState(card, {
      active: true,
      text: window.t ? window.t("ysf.scan_no_rooms", {}, "✕ Нет комнат для сканирования: включите Scan в свойствах ячеек") : "✕ Нет комнат для сканирования: включите Scan в свойствах ячеек",
      tone: "negative",
      autoHideMs: 4000
    });
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try { navigator.vibrate([40, 40, 40]); } catch (_) {}
    }
    return;
  }

  const runId = (targetHs._ysfScanRunId || 0) + 1;
  targetHs._ysfScanRunId = runId;
  targetHs._ysfScanActive = true;

  const scanBtn = card.querySelector(".btn-ysf-scan");
  if (scanBtn) scanBtn.classList.add("scan-running");

  const isStillRunning = () => Boolean(targetHs._ysfScanActive && targetHs._ysfScanRunId === runId);
  const sleepMs = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  let cursor = 0;

  while (isStillRunning()) {
    const hasStoredRooms = hasServerCollectionKey("ysf_matrix", cid) ||
      (typeof localStorage !== "undefined" && Boolean(localStorage.getItem(`proxdmr_ysf_matrix_${cid}`)));
    const liveRooms = hasStoredRooms ? getYsfMatrixRooms(cid) : (initialRooms || []);
    const currentTargets = (liveRooms || []).filter(item => item && item.room && item.scan);
    if (currentTargets.length === 0) {
      stopYsfMatrixScan(cid, card, targetHs, { keepCurrentLink: false });
      return;
    }

    const targetItem = currentTargets[cursor % currentTargets.length];
    cursor = (cursor + 1) % currentTargets.length;
    const roomNum = String(targetItem.room).trim();
    const roomLabel = String(targetItem.label || "").trim();
    targetHs._ysfScanningRoom = roomNum;

    card.querySelectorAll(".btn-ysf-room-cell").forEach(b => {
      const isMatch = String(b.dataset.room || "").trim() === roomNum;
      b.classList.toggle("ysf-node-scanning-now", isMatch);
      b.classList.toggle("asl-node-scanning-now", isMatch);
    });

    // Сбрасываем индикаторы приёма от предыдущей комнаты перед новым подключением
    const connStartedAt = Date.now();
    targetHs._ysfCarrierRx = false;
    targetHs._ysfLastRxAudioMs = 0;
    targetHs._ysfRxActiveRoom = "";
    targetHs._ysfKeyedRooms = [];
    if (card._lastRx && card._lastRx[1]) {
      card._lastRx[1].active = false;
      card._lastRx[1].lastAudioTime = 0;
    }
    const ts1Clean = card.querySelector(".vfo-ts1-row");
    if (ts1Clean) ts1Clean.classList.remove("vfo-rx-active");

    // 1. Подключаемся к выбранной комнате YSF
    ysfConnectRoomProcedure(roomNum, roomLabel, card, "", 42000, { fromScan: true });

    let waitConnMs = 0;
    let isConnected = false;
    while (waitConnMs < 6500 && isStillRunning()) {
      const curRoom = String(targetHs.ysf_room || "").trim();
      const connectingRoom = String(targetHs._ysfConnectingRoom || "").trim();
      if (curRoom === roomNum && isYsfOnlineStatus(targetHs.status) && connectingRoom !== roomNum) {
        isConnected = true;
        break;
      }
      if (waitConnMs >= 1000 && connectingRoom !== roomNum && curRoom !== roomNum) {
        break;
      }
      await sleepMs(200);
      waitConnMs += 200;
    }

    if (!isStillRunning()) return;

    if (!isConnected) {
      await sleepMs(350);
      continue;
    }

    const cfg = getYsfScanConfig(cid);

    // РЕЖИМ 1: «⏱ ТАЙМЕР» — фиксированное время на активной комнате
    if (cfg.mode === "timer") {
      let elapsedHold = 0;
      while (isStillRunning()) {
        const activeCfg = getYsfScanConfig(cid);
        const totalHoldMs = (activeCfg.timerHoldSec || 15) * 1000;
        if (elapsedHold >= totalHoldMs) break;
        const activeNow = isYsfRoomRxActive(card, targetHs);
        const remSec = Math.ceil((totalHoldMs - elapsedHold) / 1000);
        setAslProcBannerState(card, {
          active: true,
          text: activeNow
            ? (window.t ? window.t("ysf.scan_timer_air", { room: roomNum, sec: remSec }, `🔍 Скан #${roomNum} [Эфир · Таймер: ${remSec}с]`) : `🔍 Скан #${roomNum} [Эфир · Таймер: ${remSec}с]`)
            : (window.t ? window.t("ysf.scan_timer_idle", { room: roomNum, sec: remSec }, `🔍 Скан #${roomNum} [Таймер: ${remSec}с]`) : `🔍 Скан #${roomNum} [Таймер: ${remSec}с]`),
          tone: activeNow ? "positive" : "neutral",
          autoHideMs: 0
        });
        await sleepMs(250);
        elapsedHold += 250;
      }
    } else {
      // РЕЖИМ 2: «🎙 ОЖИДАНИЕ» — ждёт активность dwellSec (5с), при наличии речи держит до конца передачи + releaseHoldSec
      const dwellMs = (cfg.dwellSec || 5) * 1000;
      let elapsedDwell = 0;
      let activityDetected = Boolean(
        (targetHs._ysfLastRxAudioMs && targetHs._ysfLastRxAudioMs >= connStartedAt + 250) ||
        isYsfRoomRxActive(card, targetHs)
      );

      while (!activityDetected && elapsedDwell < dwellMs && isStillRunning()) {
        if (isYsfRoomRxActive(card, targetHs)) {
          activityDetected = true;
          break;
        }
        const remSec = Math.ceil((dwellMs - elapsedDwell) / 1000);
        setAslProcBannerState(card, {
          active: true,
          text: window.t ? window.t("ysf.scan_waiting", { room: roomNum, sec: remSec }, `🔍 Скан #${roomNum}: ожидание (${remSec}с)...`) : `🔍 Скан #${roomNum}: ожидание (${remSec}с)...`,
          tone: "neutral",
          autoHideMs: 0
        });
        await sleepMs(200);
        elapsedDwell += 200;
      }

      if (!isStillRunning()) return;

      if (!activityDetected) {
        if (currentTargets.length === 1) {
          await ysfDisconnectProcedure(cid, card, { showStatusBanner: false });
        }
        await sleepMs(250);
        continue;
      }

      let releaseElapsedMs = 0;
      while (isStillRunning()) {
        const activeCfg = getYsfScanConfig(cid);
        const curReleaseTargetMs = (activeCfg.releaseHoldSec || 3) * 1000;
        if (releaseElapsedMs >= curReleaseTargetMs) break;
        if (isYsfRoomRxActive(card, targetHs)) {
          releaseElapsedMs = 0;
          setAslProcBannerState(card, {
            active: true,
            text: window.t ? window.t("ysf.scan_air_active", { room: roomNum }, `🔍 Скан #${roomNum} [Активность в эфире]`) : `🔍 Скан #${roomNum} [Активность в эфире]`,
            tone: "positive",
            autoHideMs: 0
          });
        } else {
          const remRelease = Math.ceil(Math.max(0, curReleaseTargetMs - releaseElapsedMs) / 1000);
          setAslProcBannerState(card, {
            active: true,
            text: window.t ? window.t("ysf.scan_release", { room: roomNum, sec: remRelease }, `🔍 Скан #${roomNum} [Отпускание: ${remRelease}с]`) : `🔍 Скан #${roomNum} [Отпускание: ${remRelease}с]`,
            tone: "neutral",
            autoHideMs: 0
          });
          releaseElapsedMs += 250;
          if (releaseElapsedMs >= curReleaseTargetMs) break;
        }
        await sleepMs(250);
      }
    }

    if (!isStillRunning()) return;

    if (currentTargets.length === 1) {
      await ysfDisconnectProcedure(cid, card, { showStatusBanner: false });
    }
    await sleepMs(250);
  }
}

export function openYsfScanSettingsPopover(arg1, arg2, arg3) {
  let cid = "";
  let card = null;
  let anchorEl = null;
  if (arg1 && typeof arg1 === "object") {
    cid = arg1.cid || "default";
    card = arg1.card || null;
    anchorEl = arg1.anchorEl || (card ? card.querySelector(".btn-ysf-scan") : null);
  } else {
    cid = arg1 || "default";
    anchorEl = arg2 || null;
    card = arg3 || null;
    if (!anchorEl && card) anchorEl = card.querySelector(".btn-ysf-scan");
  }

  document.querySelectorAll(".asl-scan-settings-popover, .ysf-scan-settings-popover, .ysf-scan-backdrop").forEach(el => el.remove());
  if (!anchorEl || !card) return;

  const cfg = getYsfScanConfig(cid);
  const secUnit = window.t ? window.t("live.sec", {}, "s") : "s";
  const titleTxt = window.t ? window.t("ysf.scan_settings_title", {}, "⚙️ Настройки сканирования YSF") : "⚙️ Настройки сканирования YSF";
  const timerBtnTxt = window.t ? window.t("ysf.scan_mode_timer", {}, "⏱ Таймер") : "⏱ Таймер";
  const waitBtnTxt = window.t ? window.t("ysf.scan_mode_wait", {}, "🎙 Ожидание") : "🎙 Ожидание";
  const timerBtnTip = window.t ? window.t("ysf.scan_mode_timer_tip", {}, "Фиксированное время на активной комнате") : "Фиксированное время на активной комнате";
  const waitBtnTip = window.t ? window.t("ysf.scan_mode_wait_tip", {}, "До окончания передачи + таймер отпускания") : "До окончания передачи + таймер отпускания";
  const timerLbl = window.t ? window.t("ysf.scan_timer_label", {}, "Таймер активности (сек):") : "Таймер активности (сек):";
  const releaseLbl = window.t ? window.t("ysf.scan_release_label", {}, "Таймер отпускания (сек):") : "Таймер отпускания (сек):";

  const popover = document.createElement("div");
  popover.className = "asl-scan-settings-popover";
  popover.innerHTML = `
    <div class="scan-popover-title">
      <span>${safeEscapeHtml(titleTxt)}</span>
      <span class="scan-popover-close">✕</span>
    </div>
    <div class="scan-mode-toggle">
      <button type="button" class="scan-mode-btn ${cfg.mode === "timer" ? "active" : ""}" data-mode="timer" title="${safeEscapeHtml(timerBtnTip)}">
        ${safeEscapeHtml(timerBtnTxt)}
      </button>
      <button type="button" class="scan-mode-btn ${cfg.mode === "wait" ? "active" : ""}" data-mode="wait" title="${safeEscapeHtml(waitBtnTip)}">
        ${safeEscapeHtml(waitBtnTxt)}
      </button>
    </div>
    <div class="scan-field-group scan-group-timer" style="display: ${cfg.mode === "timer" ? "block" : "none"};">
      <div class="scan-field-label">
        <span>${safeEscapeHtml(timerLbl)}</span>
        <span class="scan-field-val" id="ysfScanTimerVal">${cfg.timerHoldSec}${safeEscapeHtml(secUnit)}</span>
      </div>
      <input type="range" id="ysfScanTimerRange" min="5" max="120" step="5" value="${cfg.timerHoldSec}">
    </div>
    <div class="scan-field-group scan-group-wait" style="display: ${cfg.mode === "wait" ? "block" : "none"};">
      <div class="scan-field-label">
        <span>${safeEscapeHtml(releaseLbl)}</span>
        <span class="scan-field-val" id="ysfScanReleaseVal">${cfg.releaseHoldSec}${safeEscapeHtml(secUnit)}</span>
      </div>
      <input type="range" id="ysfScanReleaseRange" min="1" max="45" step="1" value="${cfg.releaseHoldSec}">
    </div>
  `;

  const vfoRow = card.querySelector(".vfo-ysf-row") || card;

  const onOutsideClick = (e) => {
    if (!popover.isConnected) {
      document.removeEventListener("pointerdown", onOutsideClick, true);
      return;
    }
    const curAnchor = (vfoRow && vfoRow.querySelector(".btn-ysf-scan")) || anchorEl;
    if (!popover.contains(e.target) && e.target !== curAnchor && !(curAnchor && curAnchor.contains && curAnchor.contains(e.target))) {
      closePopover();
    }
  };

  const closePopover = () => {
    document.removeEventListener("pointerdown", onOutsideClick, true);
    popover.remove();
  };

  popover.querySelector(".scan-popover-close").onclick = (e) => {
    e.stopPropagation();
    closePopover();
  };

  const timerGroup = popover.querySelector(".scan-group-timer");
  const waitGroup = popover.querySelector(".scan-group-wait");

  popover.querySelectorAll(".scan-mode-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      popover.querySelectorAll(".scan-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      cfg.mode = btn.dataset.mode;
      timerGroup.style.display = (cfg.mode === "timer") ? "block" : "none";
      waitGroup.style.display = (cfg.mode === "wait") ? "block" : "none";
      saveYsfScanConfig(cid, cfg);
    };
  });

  const timerRange = popover.querySelector("#ysfScanTimerRange");
  const timerVal = popover.querySelector("#ysfScanTimerVal");
  if (timerRange) {
    timerRange.oninput = (e) => {
      e.stopPropagation();
      cfg.timerHoldSec = parseInt(timerRange.value, 10);
      if (timerVal) timerVal.textContent = `${cfg.timerHoldSec}${secUnit}`;
      saveYsfScanConfig(cid, cfg);
    };
  }

  const releaseRange = popover.querySelector("#ysfScanReleaseRange");
  const releaseVal = popover.querySelector("#ysfScanReleaseVal");
  if (releaseRange) {
    releaseRange.oninput = (e) => {
      e.stopPropagation();
      cfg.releaseHoldSec = parseInt(releaseRange.value, 10);
      if (releaseVal) releaseVal.textContent = `${cfg.releaseHoldSec}${secUnit}`;
      saveYsfScanConfig(cid, cfg);
    };
  }

  const stopProp = (e) => e.stopPropagation();
  popover.addEventListener("pointerdown", stopProp);
  popover.addEventListener("mousedown", stopProp);
  popover.addEventListener("click", stopProp);

  vfoRow.style.position = "relative";
  vfoRow.appendChild(popover);

  const rect = anchorEl.getBoundingClientRect();
  const vfoRect = vfoRow.getBoundingClientRect();
  popover.style.left = `${Math.max(4, Math.min(vfoRect.width - 270, rect.left - vfoRect.left))}px`;
  popover.style.top = `${Math.round(rect.bottom - vfoRect.top + 6)}px`;

  setTimeout(() => {
    document.addEventListener("pointerdown", onOutsideClick, true);
  }, 20);
}

export function openYsfDiceSettingsPopover(arg1, arg2, arg3) {
  let cid = "";
  let card = null;
  let anchorEl = null;
  if (arg1 && typeof arg1 === "object") {
    cid = arg1.cid || "default";
    card = arg1.card || null;
    anchorEl = arg1.anchorEl || (card ? card.querySelector(".btn-ysf-dice") : null);
  } else {
    cid = arg1 || "default";
    anchorEl = arg2 || null;
    card = arg3 || null;
    if (!anchorEl && card) anchorEl = card.querySelector(".btn-ysf-dice");
  }

  document.querySelectorAll(".asl-scan-settings-popover, .ysf-scan-settings-popover, .ysf-dice-settings-popover, .adn-dice-settings-popover, .asl-dice-settings-popover, .ysf-scan-backdrop").forEach(el => el.remove());
  if (!anchorEl || !card) return;

  const cfg = getYsfDiceConfig(cid);
  const secUnit = window.t ? window.t("live.sec", {}, "с") : "с";
  const titleTxt = window.t ? window.t("ysf.dice_settings_title", {}, "🎲 Случайный рефлектор YSF") : "🎲 Случайный рефлектор YSF";
  const chkFailTxt = window.t ? window.t("ysf.dice_continue_on_fail", {}, "Продолжать при неудачном коннекте") : "Продолжать при неудачном коннекте";
  const getChkSilenceTxt = (sec) => window.t
    ? window.t("ysf.dice_continue_on_silence", { sec: `${sec} ${secUnit}` }, `Продолжать при отсутствии общения в течение ${sec} сек.`)
    : `Продолжать при отсутствии общения в течение ${sec} сек.`;
  const sliderLblTxt = window.t ? window.t("ysf.dice_silence_wait_label", {}, "Пауза детектирования разговоров:") : "Пауза детектирования разговоров:";

  const popover = document.createElement("div");
  popover.className = "asl-scan-settings-popover ysf-dice-settings-popover";
  popover.innerHTML = `
    <div class="scan-popover-title">
      <span>${safeEscapeHtml(titleTxt)}</span>
      <span class="scan-popover-close">✕</span>
    </div>
    <label class="dice-chk-row">
      <input type="checkbox" id="ysfDiceContinueOnFail"${cfg.continueOnFail ? " checked" : ""}>
      <span>${safeEscapeHtml(chkFailTxt)}</span>
    </label>
    <label class="dice-chk-row">
      <input type="checkbox" id="ysfDiceContinueOnSilence"${cfg.continueOnSilence ? " checked" : ""}>
      <span id="ysfDiceSilenceChkText">${safeEscapeHtml(getChkSilenceTxt(cfg.silenceWaitSec))}</span>
    </label>
    <div class="scan-field-group dice-silence-slider-group${cfg.continueOnSilence ? "" : " is-disabled-hint"}">
      <div class="scan-field-label">
        <span>${safeEscapeHtml(sliderLblTxt)}</span>
        <span class="scan-field-val" id="ysfDiceSilenceVal">${cfg.silenceWaitSec}${safeEscapeHtml(secUnit)}</span>
      </div>
      <input type="range" id="ysfDiceSilenceRange" min="1" max="60" step="1" value="${cfg.silenceWaitSec}">
    </div>
  `;

  const vfoRow = card.querySelector(".vfo-ysf-row") || card;

  const onOutsideClick = (e) => {
    if (!popover.isConnected) {
      document.removeEventListener("pointerdown", onOutsideClick, true);
      return;
    }
    const curAnchor = (vfoRow && vfoRow.querySelector(".btn-ysf-dice")) || anchorEl;
    if (!popover.contains(e.target) && e.target !== curAnchor && !(curAnchor && curAnchor.contains && curAnchor.contains(e.target))) {
      closePopover();
    }
  };

  const closePopover = () => {
    document.removeEventListener("pointerdown", onOutsideClick, true);
    popover.remove();
  };

  popover.querySelector(".scan-popover-close").onclick = (e) => {
    e.stopPropagation();
    closePopover();
  };

  const chkFail = popover.querySelector("#ysfDiceContinueOnFail");
  const chkSilence = popover.querySelector("#ysfDiceContinueOnSilence");
  const chkSilenceText = popover.querySelector("#ysfDiceSilenceChkText");
  const silenceGroup = popover.querySelector(".dice-silence-slider-group");
  const silenceRange = popover.querySelector("#ysfDiceSilenceRange");
  const silenceVal = popover.querySelector("#ysfDiceSilenceVal");

  if (chkFail) {
    chkFail.onchange = (e) => {
      e.stopPropagation();
      cfg.continueOnFail = Boolean(chkFail.checked);
      saveYsfDiceConfig(cid, cfg);
    };
  }

  if (chkSilence) {
    chkSilence.onchange = (e) => {
      e.stopPropagation();
      cfg.continueOnSilence = Boolean(chkSilence.checked);
      if (silenceGroup) {
        silenceGroup.classList.toggle("is-disabled-hint", !cfg.continueOnSilence);
      }
      saveYsfDiceConfig(cid, cfg);
    };
  }

  if (silenceRange) {
    silenceRange.oninput = (e) => {
      e.stopPropagation();
      cfg.silenceWaitSec = Math.max(1, Math.min(60, parseInt(silenceRange.value, 10) || 10));
      if (silenceVal) silenceVal.textContent = `${cfg.silenceWaitSec}${secUnit}`;
      if (chkSilenceText) chkSilenceText.textContent = getChkSilenceTxt(cfg.silenceWaitSec);
      saveYsfDiceConfig(cid, cfg);
    };
  }

  const stopProp = (e) => e.stopPropagation();
  popover.addEventListener("pointerdown", stopProp);
  popover.addEventListener("mousedown", stopProp);
  popover.addEventListener("click", stopProp);

  vfoRow.style.position = "relative";
  vfoRow.appendChild(popover);

  const rect = anchorEl.getBoundingClientRect();
  const vfoRect = vfoRow.getBoundingClientRect();
  const popWidth = popover.offsetWidth || 274;
  const maxLeft = Math.max(4, vfoRect.width - popWidth - 4);
  popover.style.left = `${Math.max(4, Math.min(maxLeft, rect.left - vfoRect.left))}px`;
  popover.style.top = `${Math.round(rect.bottom - vfoRect.top + 6)}px`;

  setTimeout(() => {
    document.addEventListener("pointerdown", onOutsideClick, true);
  }, 20);
}

export function openAdnDiceSettingsPopover(arg1, arg2, arg3) {
  let cid = "";
  let card = null;
  let anchorEl = null;
  if (arg1 && typeof arg1 === "object") {
    cid = arg1.cid || "default";
    card = arg1.card || null;
    anchorEl = arg1.anchorEl || (card ? card.querySelector(".btn-adn-dice") : null);
  } else {
    cid = arg1 || "default";
    anchorEl = arg2 || null;
    card = arg3 || null;
    if (!anchorEl && card) anchorEl = card.querySelector(".btn-adn-dice");
  }

  document.querySelectorAll(".asl-scan-settings-popover, .ysf-scan-settings-popover, .ysf-dice-settings-popover, .adn-dice-settings-popover, .asl-dice-settings-popover, .ysf-scan-backdrop").forEach(el => el.remove());
  if (!anchorEl || !card) return;

  const cfg = getAdnDiceConfig(cid);
  const secUnit = window.t ? window.t("live.sec", {}, "с") : "с";
  const titleTxt = window.t ? window.t("adn.dice_settings_title", {}, "🎲 Случайная TG ADN") : "🎲 Случайная TG ADN";
  const chkFailTxt = window.t ? window.t("adn.dice_continue_on_fail", {}, "Продолжать при неудачном коннекте") : "Продолжать при неудачном коннекте";
  const getChkSilenceTxt = (sec) => window.t
    ? window.t("adn.dice_continue_on_silence", { sec: `${sec} ${secUnit}` }, `Продолжать при отсутствии общения в течение ${sec} сек.`)
    : `Продолжать при отсутствии общения в течение ${sec} сек.`;
  const sliderLblTxt = window.t ? window.t("adn.dice_silence_wait_label", {}, "Пауза детектирования разговоров:") : "Пауза детектирования разговоров:";

  const popover = document.createElement("div");
  popover.className = "asl-scan-settings-popover ysf-dice-settings-popover adn-dice-settings-popover";
  popover.innerHTML = `
    <div class="scan-popover-title">
      <span>${safeEscapeHtml(titleTxt)}</span>
      <span class="scan-popover-close">✕</span>
    </div>
    <label class="dice-chk-row">
      <input type="checkbox" id="adnDiceContinueOnFail"${cfg.continueOnFail ? " checked" : ""}>
      <span>${safeEscapeHtml(chkFailTxt)}</span>
    </label>
    <label class="dice-chk-row">
      <input type="checkbox" id="adnDiceContinueOnSilence"${cfg.continueOnSilence ? " checked" : ""}>
      <span id="adnDiceSilenceChkText">${safeEscapeHtml(getChkSilenceTxt(cfg.silenceWaitSec))}</span>
    </label>
    <div class="scan-field-group dice-silence-slider-group${cfg.continueOnSilence ? "" : " is-disabled-hint"}">
      <div class="scan-field-label">
        <span>${safeEscapeHtml(sliderLblTxt)}</span>
        <span class="scan-field-val" id="adnDiceSilenceVal">${cfg.silenceWaitSec}${safeEscapeHtml(secUnit)}</span>
      </div>
      <input type="range" id="adnDiceSilenceRange" min="1" max="60" step="1" value="${cfg.silenceWaitSec}">
    </div>
  `;

  const container = card.querySelector(".card-screen") || card;

  const onOutsideClick = (e) => {
    if (!popover.isConnected) {
      document.removeEventListener("pointerdown", onOutsideClick, true);
      return;
    }
    const curAnchor = (card && card.querySelector(".btn-adn-dice")) || anchorEl;
    if (!popover.contains(e.target) && e.target !== curAnchor && !(curAnchor && curAnchor.contains && curAnchor.contains(e.target))) {
      closePopover();
    }
  };

  const closePopover = () => {
    document.removeEventListener("pointerdown", onOutsideClick, true);
    popover.remove();
  };

  popover.querySelector(".scan-popover-close").onclick = (e) => {
    e.stopPropagation();
    closePopover();
  };

  const chkFail = popover.querySelector("#adnDiceContinueOnFail");
  const chkSilence = popover.querySelector("#adnDiceContinueOnSilence");
  const chkSilenceText = popover.querySelector("#adnDiceSilenceChkText");
  const silenceGroup = popover.querySelector(".dice-silence-slider-group");
  const silenceRange = popover.querySelector("#adnDiceSilenceRange");
  const silenceVal = popover.querySelector("#adnDiceSilenceVal");

  if (chkFail) {
    chkFail.onchange = (e) => {
      e.stopPropagation();
      cfg.continueOnFail = Boolean(chkFail.checked);
      saveAdnDiceConfig(cid, cfg);
    };
  }

  if (chkSilence) {
    chkSilence.onchange = (e) => {
      e.stopPropagation();
      cfg.continueOnSilence = Boolean(chkSilence.checked);
      if (silenceGroup) {
        silenceGroup.classList.toggle("is-disabled-hint", !cfg.continueOnSilence);
      }
      saveAdnDiceConfig(cid, cfg);
    };
  }

  if (silenceRange) {
    silenceRange.oninput = (e) => {
      e.stopPropagation();
      cfg.silenceWaitSec = Math.max(1, Math.min(60, parseInt(silenceRange.value, 10) || 10));
      if (silenceVal) silenceVal.textContent = `${cfg.silenceWaitSec}${secUnit}`;
      if (chkSilenceText) chkSilenceText.textContent = getChkSilenceTxt(cfg.silenceWaitSec);
      saveAdnDiceConfig(cid, cfg);
    };
  }

  const stopProp = (e) => e.stopPropagation();
  popover.addEventListener("pointerdown", stopProp);
  popover.addEventListener("mousedown", stopProp);
  popover.addEventListener("click", stopProp);

  container.style.position = "relative";
  container.appendChild(popover);

  const rect = anchorEl.getBoundingClientRect();
  const contRect = container.getBoundingClientRect();
  const popWidth = popover.offsetWidth || 274;
  const maxLeft = Math.max(4, contRect.width - popWidth - 4);
  popover.style.left = `${Math.max(4, Math.min(maxLeft, rect.left - contRect.left))}px`;
  popover.style.top = `${Math.round(rect.bottom - contRect.top + 6)}px`;

  setTimeout(() => {
    document.addEventListener("pointerdown", onOutsideClick, true);
  }, 20);
}

function _ysfIsoToEmoji(code) {
  if (!code || code.length !== 2) return "";
  const c = code.toUpperCase();
  if (c === "EU") return "🇪🇺";
  const cp1 = 127397 + c.charCodeAt(0);
  const cp2 = 127397 + c.charCodeAt(1);
  return String.fromCodePoint(cp1, cp2);
}

export function detectYsfCountryFlag(roomId, currentName = "") {
  const sId = String(roomId || "").trim();
  const cName = String(currentName || "").trim();
  if (!sId) return { flag: "➕", name: "", countryCode: "" };

  let found = null;
  const list = (typeof window !== "undefined" && typeof window.getNetworkServersList === "function"
    ? window.getNetworkServersList("ysf")
    : ((window && window._dmrServersCache && window._dmrServersCache["ysf"]) || [])) || [];

  if (Array.isArray(list) && list.length > 0) {
    found = list.find(r => String(r.id || "").trim() === sId || (sId.length < 5 && String(r.id || "").trim() === sId.padStart(5, "0")));
  }

  if (!found && typeof window !== "undefined" && Array.isArray(window.DEFAULT_YSF_BOOKMARKS)) {
    found = window.DEFAULT_YSF_BOOKMARKS.find(r => String(r.id || "").trim() === sId || (sId.length < 5 && String(r.id || "").trim() === sId.padStart(5, "0")));
  }

  if (found) {
    if (typeof window !== "undefined" && typeof window.resolveYsfRoomInfo === "function") {
      const info = window.resolveYsfRoomInfo(found);
      if (info && info.flag && info.flag !== "🌐") {
        return {
          flag: info.flag,
          name: info.refName || found.reflector_name || found.name || cName || `Room ${sId}`,
          countryCode: info.cCode || found.country_code || ""
        };
      }
    }
    const cCode = String(found.country_code || found.country || "").toUpperCase();
    if (cCode && cCode !== "XX" && cCode !== "GLOBAL") {
      const em = _ysfIsoToEmoji(cCode);
      if (em) {
        return {
          flag: em,
          name: found.reflector_name || found.name || cName || `Room ${sId}`,
          countryCode: cCode
        };
      }
    }
  }

  // 1. Проверка префикса страны из названия комнаты (например, "AU-AUS REPEATER", "RU-RUSSIA", "US-Texas")
  const isoPrefixMatch = cName.match(/^([A-Za-z]{2})[-_ ]/);
  if (isoPrefixMatch) {
    const iso = isoPrefixMatch[1].toUpperCase();
    const em = _ysfIsoToEmoji(iso);
    if (em) {
      return { flag: em, name: cName, countryCode: iso };
    }
  }

  // 2. Ключевые слова в названии комнаты
  const lowerName = cName.toLowerCase();
  if (lowerName.includes("aus") || lowerName.includes("australia")) {
    return { flag: "🇦🇺", name: cName, countryCode: "AU" };
  }
  if (lowerName.includes("russia") || lowerName.includes("moscow") || lowerName.includes("россия")) {
    return { flag: "🇷🇺", name: cName, countryCode: "RU" };
  }
  if (lowerName.includes("texas") || lowerName.includes("calnet") || lowerName.includes("america") || lowerName.includes("usa")) {
    return { flag: "🇺🇸", name: cName, countryCode: "US" };
  }
  if (lowerName.includes("fusiontech")) {
    return { flag: "🇺🇸", name: cName, countryCode: "US" };
  }
  if (lowerName.includes("spain") || lowerName.includes("espana")) {
    return { flag: "🇪🇸", name: cName, countryCode: "ES" };
  }
  if (lowerName.includes("germany") || lowerName.includes("deutschland")) {
    return { flag: "🇩🇪", name: cName, countryCode: "DE" };
  }
  if (lowerName.includes("uk") || lowerName.includes("britain") || lowerName.includes("england")) {
    return { flag: "🇬🇧", name: cName, countryCode: "GB" };
  }
  if (lowerName.includes("france")) {
    return { flag: "🇫🇷", name: cName, countryCode: "FR" };
  }
  if (lowerName.includes("italy") || lowerName.includes("italia")) {
    return { flag: "🇮🇹", name: cName, countryCode: "IT" };
  }
  if (lowerName.includes("japan")) {
    return { flag: "🇯🇵", name: cName, countryCode: "JP" };
  }
  if (lowerName.includes("poland") || lowerName.includes("polska")) {
    return { flag: "🇵🇱", name: cName, countryCode: "PL" };
  }
  if (lowerName.includes("brazil") || lowerName.includes("brasil")) {
    return { flag: "🇧🇷", name: cName, countryCode: "BR" };
  }
  if (lowerName.includes("canada")) {
    return { flag: "🇨🇦", name: cName, countryCode: "CA" };
  }
  if (lowerName.includes("parrot")) {
    return { flag: "🦜", name: cName, countryCode: "" };
  }

  // 3. Fallback lookup by 3-digit ITU/MCC prefix
  if (sId.length >= 3) {
    const pfx = sId.substring(0, 3);
    const _tr = (k, def) => (window.t ? window.t(k, {}, def) : def);
    const MCC_FLAGS = {
      "250": { flag: "🇷🇺", name: _tr("countries.russia", "Russia") },
      "255": { flag: "🇺🇦", name: _tr("countries.ukraine", "Ukraine") },
      "262": { flag: "🇩🇪", name: _tr("countries.germany", "Germany") },
      "208": { flag: "🇫🇷", name: _tr("countries.france", "France") },
      "222": { flag: "🇮🇹", name: _tr("countries.italy", "Italy") },
      "234": { flag: "🇬🇧", name: _tr("countries.uk", "United Kingdom") },
      "235": { flag: "🇬🇧", name: _tr("countries.uk", "United Kingdom") },
      "214": { flag: "🇪🇸", name: _tr("countries.spain", "Spain") },
      "268": { flag: "🇵🇹", name: _tr("countries.portugal", "Portugal") },
      "204": { flag: "🇳🇱", name: _tr("countries.netherlands", "Netherlands") },
      "206": { flag: "🇧🇪", name: _tr("countries.belgium", "Belgium") },
      "228": { flag: "🇨🇭", name: _tr("countries.switzerland", "Switzerland") },
      "232": { flag: "🇦🇹", name: _tr("countries.austria", "Austria") },
      "260": { flag: "🇵🇱", name: _tr("countries.poland", "Poland") },
      "284": { flag: "🇧🇬", name: _tr("countries.bulgaria", "Bulgaria") },
      "286": { flag: "🇹🇷", name: _tr("countries.turkey", "Turkey") },
      "310": { flag: "🇺🇸", name: _tr("countries.usa", "USA") },
      "311": { flag: "🇺🇸", name: _tr("countries.usa", "USA") },
      "312": { flag: "🇺🇸", name: _tr("countries.usa", "USA") },
      "313": { flag: "🇺🇸", name: _tr("countries.usa", "USA") },
      "314": { flag: "🇺🇸", name: _tr("countries.usa", "USA") },
      "315": { flag: "🇺🇸", name: _tr("countries.usa", "USA") },
      "316": { flag: "🇺🇸", name: _tr("countries.usa", "USA") },
      "302": { flag: "🇨🇦", name: _tr("countries.canada", "Canada") },
      "440": { flag: "🇯🇵", name: _tr("countries.japan", "Japan") },
      "505": { flag: "🇦🇺", name: _tr("countries.australia", "Australia") }
    };
    if (MCC_FLAGS[pfx]) {
      return {
        flag: MCC_FLAGS[pfx].flag,
        name: cName || `YSF-${MCC_FLAGS[pfx].name}`,
        countryCode: pfx
      };
    }
  }

  return {
    flag: sId ? "🌐" : "➕",
    name: cName || (sId ? (window.t ? window.t("ysf.room_label", { id: sId }, `Room ${sId}`) : `Room ${sId}`) : ""),
    countryCode: ""
  };
}

let _activeYsfMenuCleanups = new Set();
let _ysfMoveCancelDocListener = null;

export function clearYsfMoveCancelListener() {
  if (_ysfMoveCancelDocListener) {
    document.removeEventListener("click", _ysfMoveCancelDocListener, true);
    _ysfMoveCancelDocListener = null;
  }
}

export function closeYsfCardContextMenu(card, targetHs = null) {
  _activeYsfMenuCleanups.forEach(fn => {
    try { fn(); } catch (_) {}
  });
  _activeYsfMenuCleanups.clear();

  document.querySelectorAll(".asl-card-context-menu").forEach(el => el.remove());

  if (targetHs) {
    targetHs._ysfOpenMenuIdx = null;
  }
}

export function openYsfCardContextMenu({ btn, idx, cid, card, targetHs, rooms }) {
  closeYsfCardContextMenu(card, targetHs);
  clearYsfMoveCancelListener();

  if (targetHs && targetHs._ysfMovingIdx !== null && targetHs._ysfMovingIdx !== undefined) {
    targetHs._ysfMovingIdx = null;
    card.querySelectorAll(".asl-node-moving-source, .asl-node-move-target").forEach(el => {
      el.classList.remove("asl-node-moving-source", "asl-node-move-target");
    });
    card.querySelectorAll(".asl-matrix-grid").forEach(gridEl => gridEl.classList.remove("asl-matrix-move-mode"));
  }

  const matrixContainer = card.querySelector(`#ysfMatrixContainer_${cid}`) || card.querySelector(".ysf-matrix-container") || card.querySelector(".asl-matrix-container");
  if (!matrixContainer) return;
  matrixContainer.style.position = "relative";

  const item = rooms[idx];
  if (!item || !item.room) return;
  const cleanRoom = String(item.room).trim();
  if (targetHs) {
    targetHs._ysfOpenMenuIdx = idx;
  }

  const isScanActive = Boolean(item.scan);
  const nextScanActionText = isScanActive ? "OFF" : "ON";
  const scanTitle = isScanActive
    ? (window.t ? window.t("ysf.ctx_scan_off", {}, "Exclude room from scan (switch OFF)") : "Exclude room from scan (switch OFF)")
    : (window.t ? window.t("ysf.ctx_scan_on", {}, "Include room in scan (switch ON)") : "Include room in scan (switch ON)");

  const activeRoom = String((targetHs && targetHs.ysf_room) || (card && card.dataset.ysfRoom) || "").trim();
  const isCurrentlyConnected = Boolean(activeRoom && cleanRoom === activeRoom && targetHs && isYsfOnlineStatus(targetHs.status));

  const menu = document.createElement("div");
  menu.className = "asl-card-context-menu";

  const tEdit = window.t ? window.t("ysf.ctx_edit_room", {}, "Edit room ID, name and country flag") : "Edit room ID, name and country flag";
  const tMove = window.t ? window.t("ysf.ctx_move_room", {}, "Move tile to another cell") : "Move tile to another cell";
  const tDiscon = window.t ? window.t("ysf.ctx_disconnect", {}, "Disconnect from this YSF room") : "Disconnect from this YSF room";
  const tDelete = window.t ? window.t("ysf.ctx_delete_cell", {}, "Clear cell") : "Clear cell";

  // СТРОКИ TX-RX И РОЛЬ ИСКЛЮЧЕНЫ СОГЛАСНО ТРЕБОВАНИЮ ПОЛЬЗОВАТЕЛЯ!
  menu.innerHTML = `
    <div class="asl-card-context-header">#${safeEscapeHtml(cleanRoom)}</div>
    <button type="button" class="asl-card-context-btn" data-action="edit" title="${tEdit}">
      <span class="ctx-btn-label">Edit</span>
      <span class="ctx-btn-icon">✎</span>
    </button>
    <button type="button" class="asl-card-context-btn" data-action="move" title="${tMove}">
      <span class="ctx-btn-label">Move</span>
      <span class="ctx-btn-icon">✥</span>
    </button>
    <button type="button" class="asl-card-context-btn ${!isScanActive ? "scan-active" : ""}" data-action="scan" title="${scanTitle}">
      <span class="ctx-btn-label">Scan</span>
      <span class="ctx-btn-badge">${nextScanActionText}</span>
    </button>
    <button type="button" class="asl-card-context-btn" data-action="disconnect" title="${tDiscon}">
      <span class="ctx-btn-label">Disconnect</span>
      <span class="ctx-btn-icon">⏏</span>
    </button>
    <button type="button" class="asl-card-context-btn" data-action="delete" title="${tDelete}">
      <span class="ctx-btn-label">Delete</span>
      <span class="ctx-btn-icon">✕</span>
    </button>
  `;

  const stopMenuPointer = (ev) => { ev.stopPropagation(); };
  menu.addEventListener("pointerdown", stopMenuPointer);
  menu.addEventListener("mousedown", stopMenuPointer);
  menu.addEventListener("touchstart", stopMenuPointer, { passive: true });

  matrixContainer.appendChild(menu);

  const contRect = matrixContainer.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();

  let left = (btnRect.right - contRect.left) + 6;
  if (left + menuRect.width > contRect.width - 4) {
    left = (btnRect.left - contRect.left) - menuRect.width - 6;
  }
  left = Math.max(4, Math.min(left, contRect.width - menuRect.width - 4));

  const maxTop = Math.max(2, contRect.height - menuRect.height - 14);
  let top = (btnRect.top - contRect.top) + (btnRect.height / 2) - (menuRect.height / 2) - 12;
  top = Math.max(2, Math.min(top, maxTop));

  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;

  const onOutsidePointerDown = (e) => {
    if (!menu.isConnected) { cleanupThisMenu(); return; }
    if (!menu.contains(e.target)) { closeYsfCardContextMenu(card, targetHs); }
  };

  const onKeyDown = (e) => {
    if (!menu.isConnected) { cleanupThisMenu(); return; }
    if (e.key === "Escape") {
      closeYsfCardContextMenu(card, targetHs);
      if (targetHs && targetHs._ysfMovingIdx !== null && targetHs._ysfMovingIdx !== undefined) {
        targetHs._ysfMovingIdx = null;
        updateCardYsfPanel(card, targetHs);
      }
    }
  };

  function cleanupThisMenu() {
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    _activeYsfMenuCleanups.delete(cleanupThisMenu);
  }

  _activeYsfMenuCleanups.add(cleanupThisMenu);
  document.addEventListener("pointerdown", onOutsidePointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);

  let actionHandled = false;
  const executeMenuAction = (ev) => {
    const actionBtn = ev.target.closest(".asl-card-context-btn");
    if (!actionBtn) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (actionHandled) return;
    actionHandled = true;

    const action = actionBtn.dataset.action;

    if (action === "edit") {
      closeYsfCardContextMenu(card, targetHs);
      openYsfCardEditPopover({ idx, cid, card, targetHs, rooms });
    } else if (action === "move") {
      closeYsfCardContextMenu(card, targetHs);
      if (targetHs) targetHs._ysfMovingIdx = idx;
      updateCardYsfPanel(card, targetHs);
    } else if (action === "scan") {
      item.scan = !Boolean(item.scan);
      saveYsfMatrixRooms(cid, rooms);
      closeYsfCardContextMenu(card, targetHs);
      updateCardYsfPanel(card, targetHs);
      if (typeof showToast === "function") {
        const scanMsg = item.scan
          ? (window.t ? window.t("ysf.scan_room_on", { room: cleanRoom }, `Room #${cleanRoom}: Scan ON`) : `Room #${cleanRoom}: Scan ON`)
          : (window.t ? window.t("ysf.scan_room_off", { room: cleanRoom }, `Room #${cleanRoom}: Scan OFF`) : `Room #${cleanRoom}: Scan OFF`);
        showToast(scanMsg, "info", 1800);
      }
    } else if (action === "disconnect") {
      closeYsfCardContextMenu(card, targetHs);
      if (typeof window.ysfDisconnectProcedure === "function") {
        window.ysfDisconnectProcedure(cid, card, { showStatusBanner: true });
      } else {
        fetch("/api/ysf/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hotspot_id: cid })
        }).catch(() => {});
      }
    } else if (action === "delete") {
      closeYsfCardContextMenu(card, targetHs);
      if (isCurrentlyConnected) {
        if (typeof window.ysfDisconnectProcedure === "function") {
          window.ysfDisconnectProcedure(cid, card, { showStatusBanner: true });
        }
      }
      rooms[idx] = makeEmptyYsfCell();
      saveYsfMatrixRooms(cid, rooms);
      updateCardYsfPanel(card, targetHs);
      if (typeof showToast === "function") {
        const clrMsg = window.t
          ? window.t("ysf.slot_cleared_toast", { num: idx + 1 }, `Slot #${idx + 1} cleared`)
          : `Slot #${idx + 1} cleared`;
        showToast(clrMsg, "info", 1800);
      }
    }
  };

  menu.addEventListener("click", executeMenuAction);
}

export function openYsfCardEditPopover({ idx, cid, card, targetHs, rooms }) {
  document.querySelectorAll(".asl-card-edit-popover, .ysf-card-edit-backdrop").forEach(el => el.remove());
  const curItem = rooms[idx] || makeEmptyYsfCell();
  let initialFlag = curItem.flag;
  if (curItem.room && (!initialFlag || initialFlag === "➕" || initialFlag === "🌐")) {
    const detected = detectYsfCountryFlag(curItem.room, curItem.label);
    if (detected && detected.flag && detected.flag !== "➕") {
      initialFlag = detected.flag;
    }
  }

  const backdrop = document.createElement("div");
  backdrop.className = "asl-matrix-modal-backdrop ysf-card-edit-backdrop is-visible";
  backdrop.style.zIndex = "99999";

  const pop = document.createElement("div");
  pop.className = "asl-card-edit-popover ysf-card-edit-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-modal", "true");
  pop.style.position = "relative";
  pop.style.top = "auto";
  pop.style.left = "auto";
  pop.style.transform = "none";
  pop.style.width = "min(320px, calc(100vw - 32px))";
  pop.style.maxHeight = "calc(100vh - 40px)";
  pop.style.overflowY = "auto";

  pop.innerHTML = `
    <div class="asl-edit-header">
      <span class="asl-edit-title">✎ ${window.t ? window.t("ysf.edit_cell_title", { idx: idx + 1 }, `Ячейка #${idx + 1}`) : `Ячейка #${idx + 1}`}</span>
      <button type="button" class="asl-edit-close" title="${window.t ? window.t("buttons.close", {}, "Закрыть") : "Закрыть"}">✕</button>
    </div>
    <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; font-size: 13px;">
      <label style="display: flex; flex-direction: column; gap: 4px;">
        <span style="opacity: 0.85; font-size: 11px; font-weight: 600;">${window.t ? window.t("ysf.room_id_label", {}, "Номер комнаты (ID):") : "Номер комнаты (ID):"}</span>
        <input type="text" class="asl-edit-input ysf-edit-room-id" maxlength="5" value="${safeEscapeHtml(curItem.room || "")}" placeholder="25000" style="height: 28px;" autocomplete="off" />
      </label>
      <label style="display: flex; flex-direction: column; gap: 4px;">
        <span style="opacity: 0.85; font-size: 11px; font-weight: 600;">${window.t ? window.t("ysf.room_name_label", {}, "Название комнаты:") : "Название комнаты:"}</span>
        <input type="text" class="asl-edit-input ysf-edit-room-name" maxlength="24" value="${safeEscapeHtml(curItem.label || "")}" placeholder="YSF-Russia" style="height: 28px;" autocomplete="off" />
      </label>
      <label style="display: flex; flex-direction: column; gap: 4px;">
        <span style="opacity: 0.85; font-size: 11px; font-weight: 600;">${window.t ? window.t("ysf.room_flag_label", {}, "Флаг / Иконка:") : "Флаг / Иконка:"}</span>
        <input type="text" class="asl-edit-input ysf-edit-room-flag" maxlength="6" value="${safeEscapeHtml(initialFlag || "🌐")}" placeholder="🇷🇺" style="height: 28px; width: 70px; text-align: center;" autocomplete="off" />
      </label>
      <label style="display: flex; flex-direction: column; gap: 4px;">
        <span style="opacity: 0.85; font-size: 11px; font-weight: 600;">${window.t ? window.t("ysf.reflector_type_label", {}, "Тип рефлектора:") : "Тип рефлектора:"}</span>
        <select class="asl-edit-input ysf-edit-room-type" style="height: 30px;">
          ${(() => {
            const curOvr = (curItem.room && typeof window.getYsfRoomTypeOverride === "function" ? window.getYsfRoomTypeOverride(curItem.room) : "") || curItem.type_override || "auto";
            return `
              <option value="auto"${curOvr === "auto" || !curOvr ? " selected" : ""}>⚙ ${window.t ? window.t("ysf.type_opt_auto", {}, "Авто (по каталогу / эфиру)") : "Авто (по каталогу / эфиру)"}</option>
              <option value="single"${curOvr === "single" ? " selected" : ""}>${window.t ? window.t("ysf.type_opt_single", {}, "Однокомнатный (Тип 1 · DG-ID 00)") : "Однокомнатный (Тип 1 · DG-ID 00)"}</option>
              <option value="multi_standard"${curOvr === "multi_standard" ? " selected" : ""}>🟠 ${window.t ? window.t("ysf.type_opt_standard", {}, "Стандартный хаб (Тип 2 · YCS / FCS)") : "Стандартный хаб (Тип 2 · YCS / FCS)"}</option>
              <option value="multi_mutant"${curOvr === "multi_mutant" ? " selected" : ""}>🔴 ${window.t ? window.t("ysf.type_opt_mutant", {}, "Мутант (Тип 3 · pYSF3 / DG-ID)") : "Мутант (Тип 3 · pYSF3 / DG-ID)"}</option>
            `;
          })()}
        </select>
      </label>
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-top: 4px;">
        <input type="checkbox" class="ysf-edit-scan" ${curItem.scan ? "checked" : ""} />
        <span>${window.t ? window.t("ysf.include_in_scan", {}, "Включить в сканирование (Scan: ON)") : "Включить в сканирование (Scan: ON)"}</span>
      </label>
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px;">
        <button type="button" class="btn-ysf-cell-clear btn-danger" style="padding: 6px 12px; font-size: 12px; border-radius: 4px; border: none; cursor: pointer;">${window.t ? window.t("common.clear", {}, "Очистить") : "Очистить"}</button>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn-ysf-cell-cancel btn-secondary" style="padding: 6px 12px; font-size: 12px; border-radius: 4px; border: none; cursor: pointer;">${window.t ? window.t("common.cancel", {}, "Отмена") : "Отмена"}</button>
          <button type="button" class="btn-ysf-cell-save btn-primary" style="padding: 6px 14px; font-size: 12px; border-radius: 4px; border: none; cursor: pointer;">${window.t ? window.t("common.save", {}, "Сохранить") : "Сохранить"}</button>
        </div>
      </div>
    </div>
  `;

  const closeDialog = () => backdrop.remove();
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeDialog();
    }
  };
  document.addEventListener("keydown", onKey, { once: true });

  pop.querySelector(".asl-edit-close").onclick = closeDialog;
  pop.querySelector(".btn-ysf-cell-cancel").onclick = closeDialog;
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeDialog();
  });

  pop.querySelector(".btn-ysf-cell-clear").onclick = () => {
    rooms[idx] = makeEmptyYsfCell();
    saveYsfMatrixRooms(cid, rooms);
    closeDialog();
    updateCardYsfPanel(card, targetHs);
  };

  const saveAction = () => {
    const rId = pop.querySelector(".ysf-edit-room-id").value.trim();
    const rName = pop.querySelector(".ysf-edit-room-name").value.trim();
    let rFlag = pop.querySelector(".ysf-edit-room-flag").value.trim();
    const rScan = pop.querySelector(".ysf-edit-scan").checked;
    const typeSel = pop.querySelector(".ysf-edit-room-type");
    const rTypeVal = typeSel ? String(typeSel.value || "auto").trim().toLowerCase() : "auto";
    const effOverride = (rTypeVal === "single" || rTypeVal === "multi_standard" || rTypeVal === "multi_mutant") ? rTypeVal : "";

    if (!rFlag) rFlag = rId ? "🌐" : "➕";

    if (rId) {
      if (typeof window.setYsfRoomTypeOverride === "function") {
        window.setYsfRoomTypeOverride(rId, effOverride || "auto");
      } else if (effOverride) {
        setServerCollectionKey("ysf_room_types", rId, effOverride, null, false);
      } else {
        deleteServerCollectionKey("ysf_room_types", rId, null);
      }
    }

    rooms[idx] = {
      room: rId,
      label: rName || (rId ? `Room ${rId}` : ""),
      flag: rFlag,
      scan: Boolean(rScan && rId),
      type_override: effOverride
    };
    saveYsfMatrixRooms(cid, rooms);
    closeDialog();
    updateCardYsfPanel(card, targetHs);
    syncCardYsfDgIdBar(card, targetHs);
  };

  pop.querySelector(".btn-ysf-cell-save").onclick = saveAction;
  pop.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveAction();
      }
    });
  });

  backdrop.appendChild(pop);
  document.body.appendChild(backdrop);

  const idInp = pop.querySelector(".ysf-edit-room-id");
  const nameInp = pop.querySelector(".ysf-edit-room-name");
  const flagInp = pop.querySelector(".ysf-edit-room-flag");

  if (idInp && flagInp) {
    idInp.addEventListener("input", () => {
      const val = idInp.value.trim();
      if (!val) {
        flagInp.value = "➕";
        return;
      }
      const detected = detectYsfCountryFlag(val, nameInp ? nameInp.value.trim() : "");
      if (detected && detected.flag && detected.flag !== "➕") {
        flagInp.value = detected.flag;
      }
      if (nameInp && (!nameInp.value.trim() || nameInp.value.startsWith("Room ") || nameInp.value.startsWith("YSF-"))) {
        if (detected && detected.name) {
          nameInp.value = detected.name;
        }
      }
    });
  }

  setTimeout(() => {
    if (idInp) {
      idInp.focus();
      idInp.select();
    }
  }, 30);
}

export function openYsfMatrixManageModal(cid, card, targetHs, rooms) {
  const existing = document.getElementById("ysfMatrixManageModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "ysfMatrixManageModal";
  modal.className = "asl-matrix-modal-backdrop";
  const tm = (key, fallback) => (window.t ? window.t(key, {}, fallback) : fallback);
  modal.innerHTML = `
    <div class="asl-matrix-modal-card" role="dialog" aria-modal="true">
      <div class="asl-modal-header">
        <div class="asl-modal-title-wrap">
          <span class="asl-modal-icon">⚙️</span>
          <h3 class="asl-modal-title">${tm("ysf.mem_modal_title", "YSF Room Memory")}</h3>
        </div>
        <button type="button" class="asl-modal-close" title="${tm("buttons.close", "Close")}">✕</button>
      </div>
      <p class="asl-modal-subtitle">${tm("ysf.mem_modal_subtitle", "Choose an action for the 60-slot room memory (3 pages of 20):")}</p>

      <div class="asl-modal-actions">
        <button type="button" class="asl-modal-btn asl-btn-reset-zero" data-action="zero">
          <span class="asl-btn-action-icon">🧹</span>
          <div class="asl-btn-action-text">
            <strong>${tm("ysf.mem_zero_title", "Clear All 60 Slots")}</strong>
            <small>${tm("ysf.mem_zero_desc", "Clear all 3 pages completely (all slots become [+] Empty)")}</small>
          </div>
        </button>

        <button type="button" class="asl-modal-btn asl-btn-reset-page" data-action="clear_page">
          <span class="asl-btn-action-icon">📄</span>
          <div class="asl-btn-action-text">
            <strong>${tm("ysf.mem_clear_page_title", "Clear Current Page")}</strong>
            <small>${tm("ysf.mem_clear_page_desc", "Clear only the 20 slots on the currently viewed page")}</small>
          </div>
        </button>

        <button type="button" class="asl-modal-btn asl-btn-reset-default" data-action="default">
          <span class="asl-btn-action-icon">🔄</span>
          <div class="asl-btn-action-text">
            <strong>${tm("ysf.mem_default_title", "Restore Default List")}</strong>
            <small>${tm("ysf.mem_default_desc", "Reset memory to the default set of popular YSF rooms")}</small>
          </div>
        </button>
      </div>

      <div class="asl-modal-footer">
        <button type="button" class="asl-modal-cancel-btn">${tm("common.cancel", "Отмена")}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("is-visible"));

  const closeModal = () => {
    modal.classList.remove("is-visible");
    setTimeout(() => { modal.remove(); }, 200);
  };

  modal.querySelector(".asl-modal-close").addEventListener("click", closeModal);
  modal.querySelector(".asl-modal-cancel-btn").addEventListener("click", closeModal);

  modal.querySelectorAll(".asl-modal-btn").forEach(b => {
    b.addEventListener("click", () => {
      const act = b.dataset.action;
      if (act === "zero") {
        const cleared = Array.from({ length: YSF_MEMORY_SIZE }, () => makeEmptyYsfCell());
        saveYsfMatrixRooms(cid, cleared);
        updateCardYsfPanel(card, targetHs);
        closeModal();
      } else if (act === "clear_page") {
        const curPage = getYsfMatrixPage(cid, targetHs);
        const updated = [...rooms];
        for (let i = curPage * YSF_PAGE_SIZE; i < (curPage + 1) * YSF_PAGE_SIZE; i++) {
          updated[i] = makeEmptyYsfCell();
        }
        saveYsfMatrixRooms(cid, updated);
        updateCardYsfPanel(card, targetHs);
        closeModal();
      } else if (act === "default") {
        const defRooms = padYsfRooms([...DEFAULT_YSF_MATRIX_ROOMS]);
        saveYsfMatrixRooms(cid, defRooms);
        updateCardYsfPanel(card, targetHs);
        closeModal();
      }
    });
  });
}

export function syncYsfDiceButtonUI(card, targetHs) {
  const isRolling = Boolean(targetHs && targetHs._ysfDiceRolling);
  const idleTitle = window.t ? window.t("ysf.dice_btn_title", {}, "Случайная активная комната YSF (Dice). Удержание: настройки") : "Случайная активная комната YSF (Dice). Удержание: настройки";
  const stopTitle = window.t ? window.t("ysf.dice_btn_stop_title", {}, "Нажмите для остановки поиска случайного рефлектора") : "Нажмите для остановки поиска случайного рефлектора";
  const root = card || document;
  root.querySelectorAll(".btn-ysf-dice").forEach(btn => {
    btn.classList.toggle("dice-rolling", isRolling);
    btn.disabled = false;
    const tLabel = isRolling ? stopTitle : idleTitle;
    btn.title = tLabel;
    btn.setAttribute("aria-label", tLabel);
  });
}

export function stopYsfDiceSearch(cid, card, targetHs, { immediateAbort = false, finishInnerIteration = false, silent = false } = {}) {
  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
  const resolvedHs = targetHs || curHsList.find(h => h && h.id === cid) || curHsList[0] || null;
  const effCard = card || (resolvedHs ? (document.querySelector(`.dmr-card[data-hotspot-id="${resolvedHs.id}"]`) || document.querySelector(`.radio-container[data-hotspot-id="${resolvedHs.id}"]`)) : null);
  if (!resolvedHs || !resolvedHs._ysfDiceRolling) {
    if (effCard && resolvedHs) {
      syncYsfDiceButtonUI(effCard, resolvedHs);
    }
    return;
  }

  resolvedHs._ysfDiceStopRequested = true;

  if (immediateAbort || !finishInnerIteration) {
    resolvedHs._ysfDiceRunId = (resolvedHs._ysfDiceRunId || 0) + 1;
    resolvedHs._ysfDiceRolling = false;
    if (effCard) {
      syncYsfDiceButtonUI(effCard, resolvedHs);
      if (!silent) {
        setAslProcBannerState(effCard, {
          active: true,
          text: window.t ? window.t("ysf.dice_stopped", {}, "⏹ Поиск случайного рефлектора остановлен") : "⏹ Поиск случайного рефлектора остановлен",
          tone: "neutral",
          autoHideMs: 4000,
          fadeOutMs: 2000
        });
      }
    }
    try {
      window.dispatchEvent(new CustomEvent("proxdmr:ysf-dice-abort", { detail: { hotspot_id: resolvedHs.id || cid } }));
    } catch (_) {}
  } else {
    // Завершение текущей внутренней итерации перед полной остановкой
    if (effCard && !silent) {
      setAslProcBannerState(effCard, {
        active: true,
        text: window.t ? window.t("ysf.dice_stopping", {}, "⏹ Остановка поиска (завершение текущей попытки)...") : "⏹ Остановка поиска (завершение текущей попытки)...",
        tone: "neutral",
        autoHideMs: 0
      });
    }
  }
}

export function syncAdnDiceButtonUI(card, targetHs) {
  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
  const resolveBtnNet = (btnEl) => {
    const hostCard = (btnEl && btnEl.closest) ? (btnEl.closest(".radio-container, .dmr-card") || card) : card;
    const cid = (targetHs && targetHs.id) || (hostCard && hostCard.dataset && hostCard.dataset.hotspotId) || "";
    const matchedHs = targetHs || (cid ? curHsList.find(h => h && h.id === cid) : null);
    const rawNet = (matchedHs && matchedHs.network_type)
      || (hostCard && hostCard.dataset && hostCard.dataset.networkType)
      || (hostCard && hostCard.classList && hostCard.classList.contains("card-net-adn") ? "adn" : "")
      || "";
    return {
      isAdn: String(rawNet).trim().toLowerCase() === "adn",
      hs: matchedHs
    };
  };

  const idleTitle = window.t ? window.t("adn.dice_btn_title", {}, "Случайная активная TG ADN (клик — старт/стоп, удержание/ПКМ — настройки)") : "Случайная активная TG ADN (клик — старт/стоп, удержание/ПКМ — настройки)";
  const stopTitle = window.t ? window.t("adn.dice_btn_stop_title", {}, "Остановить поиск активной TG ADN") : "Остановить поиск активной TG ADN";
  const root = card || document;
  root.querySelectorAll(".btn-adn-dice").forEach(btn => {
    const { isAdn, hs: resolvedHs } = resolveBtnNet(btn);
    if (!isAdn) {
      if (resolvedHs && resolvedHs._adnDiceRolling) {
        resolvedHs._adnDiceStopRequested = true;
        resolvedHs._adnDiceRunId = (resolvedHs._adnDiceRunId || 0) + 1;
        resolvedHs._adnDiceRolling = false;
      }
      btn.classList.remove("dice-rolling");
      btn.style.setProperty("display", "none", "important");
      btn.disabled = true;
      return;
    }
    btn.style.removeProperty("display");
    const isRolling = Boolean(resolvedHs && resolvedHs._adnDiceRolling);
    btn.classList.toggle("dice-rolling", isRolling);
    btn.disabled = false;
    const tLabel = isRolling ? stopTitle : idleTitle;
    btn.title = tLabel;
    btn.setAttribute("aria-label", tLabel);
  });
}

export function stopAdnDiceSearch(cid, card, targetHs, { immediateAbort = false, silent = false } = {}) {
  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
  const resolvedHs = targetHs || curHsList.find(h => h && h.id === cid) || curHsList[0] || null;
  const effCard = card || (resolvedHs ? (document.querySelector(`.dmr-card[data-hotspot-id="${resolvedHs.id}"]`) || document.querySelector(`.radio-container[data-hotspot-id="${resolvedHs.id}"]`)) : null);
  if (!resolvedHs || !resolvedHs._adnDiceRolling) {
    if (effCard && resolvedHs) {
      syncAdnDiceButtonUI(effCard, resolvedHs);
    }
    return;
  }

  resolvedHs._adnDiceStopRequested = true;
  resolvedHs._adnDiceRunId = (resolvedHs._adnDiceRunId || 0) + 1;
  resolvedHs._adnDiceRolling = false;
  if (effCard) {
    syncAdnDiceButtonUI(effCard, resolvedHs);
    if (!silent) {
      setAslProcBannerState(effCard, {
        active: true,
        text: window.t ? window.t("adn.dice_stopped", {}, "⏹ Поиск случайной TG ADN остановлен") : "⏹ Поиск случайной TG ADN остановлен",
        tone: "neutral",
        autoHideMs: 4000,
        fadeOutMs: 2000
      });
    }
  }
  try {
    window.dispatchEvent(new CustomEvent("proxdmr:adn-dice-abort", { detail: { hotspot_id: resolvedHs.id || cid } }));
  } catch (_) {}
}

export async function ysfConnectRoomProcedure(roomId, roomName = "", card = null, roomHost = "", roomPort = 42000, { fromScan = false, fromDice = false, awaitOutcome = false } = {}) {
  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
  const cid = card ? (card.dataset.hotspotId || "default") : (window.activeHotspotId || "default");
  const targetHs = curHsList.find(h => h && h.id === cid) || curHsList[0];
  if (!targetHs) return { ok: false, reason: "no_hotspot" };

  const effCard = card || document.querySelector(`.dmr-card[data-hotspot-id="${cid}"]`) || document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) || document.getElementById("radioContainer");
  if (!fromScan && targetHs._ysfScanActive) {
    stopYsfMatrixScan(cid, effCard, targetHs, { keepCurrentLink: true, silent: true });
  }
  if (!fromDice && targetHs._ysfDiceRolling) {
    stopYsfDiceSearch(cid, effCard, targetHs, { immediateAbort: true, silent: true });
  }
  const sRoomId = String(roomId).trim();
  const ysfList = (typeof window._getYsfServersList === "function" ? window._getYsfServersList() : []) || [];
  const room = ysfList.find(r => String(r.id).trim() === sRoomId) || { id: sRoomId, host: "", name: roomName };
  const rName = room.reflector_name || room.name || roomName || `YSF #${sRoomId}`;
  let hostStr = roomHost || room.host || "";
  if (hostStr && (/^\d+$/.test(hostStr.trim()) || hostStr.trim() === "ysf.brandmeister.ru")) {
    hostStr = "";
  }

  const seqAtStart = (targetHs._ysfActionSeq = (targetHs._ysfActionSeq || 0) + 1);
  targetHs.isManualBmDisconnect = false;
  if (typeof window !== "undefined" && (cid === window.activeHotspotId || targetHs.id === window.activeHotspotId)) {
    window.isManualBmDisconnect = false;
  }
  targetHs._ysfConnectingRoom = sRoomId;
  targetHs._ysfDisconnectingRoom = null;
  targetHs._ysfConnectingStartedAt = Date.now();
  if (effCard) {
    syncYsfMatrixButtonsState(effCard, targetHs);
  }

  const prevRoom = String(targetHs.ysf_room || "").trim();
  const prevOnline = String(targetHs.status || "").toUpperCase() === "ONLINE";
  if (prevOnline && prevRoom && prevRoom !== sRoomId && effCard) {
    setAslProcBannerState(effCard, {
      active: true,
      text: window.t
        ? window.t("ysf.disconnecting_unlink", { room: prevRoom }, `Disconnecting #${prevRoom}: sending unlink command (YSFU Unlink)...`)
        : `Disconnecting #${prevRoom}: sending unlink command (YSFU Unlink)...`,
      tone: "neutral",
      autoHideMs: 0
    });
    await new Promise(r => setTimeout(r, 450));
  }

  if (effCard) {
    setAslProcBannerState(effCard, {
      active: true,
      text: window.t
        ? window.t("ysf.searching_registry", { room: sRoomId }, `Reflector #${sRoomId}: looking up address in YSF registry...`)
        : `Reflector #${sRoomId}: looking up address in YSF registry...`,
      tone: "neutral",
      autoHideMs: 0
    });
  }

  const ws = (typeof getWs === "function" ? getWs() : window.ws);
  if (ws && ws.readyState === WebSocket.OPEN) {
    let outcomePromise = null;
    if (awaitOutcome) {
      outcomePromise = new Promise(resolve => {
        let settled = false;
        let timeoutTimer = null;
        let wsCheckTimer = null;
        const cleanup = () => {
          window.removeEventListener("proxdmr:ysf-proc-result", onResult);
          window.removeEventListener("proxdmr:ysf-dice-abort", onAbort);
          if (timeoutTimer) clearTimeout(timeoutTimer);
          if (wsCheckTimer) clearInterval(wsCheckTimer);
        };
        const finish = (res) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(res);
        };
        const onResult = (ev) => {
          const d = ev && ev.detail;
          if (!d || d.hotspot_id !== cid || d.proc !== "connect") return;
          if (d.room_id && String(d.room_id).trim() !== sRoomId) return;
          finish({
            ok: d.state === "done",
            code: d.code || "",
            text: d.text || ""
          });
        };
        const onAbort = (ev) => {
          const d = ev && ev.detail;
          if (d && d.hotspot_id && d.hotspot_id !== cid) return;
          finish({ ok: false, aborted: true });
        };
        window.addEventListener("proxdmr:ysf-proc-result", onResult);
        window.addEventListener("proxdmr:ysf-dice-abort", onAbort);
        wsCheckTimer = setInterval(() => {
          const curWs = (typeof getWs === "function" ? getWs() : window.ws);
          if (!curWs || curWs.readyState !== WebSocket.OPEN) {
            finish({ ok: false, reason: "ws_closed" });
          }
        }, 400);
        timeoutTimer = setTimeout(() => {
          finish({ ok: false, reason: "timeout" });
        }, 12000);
      });
    }

    ws.send(JSON.stringify({
      type: "ysf_connect_room",
      hotspot_id: cid,
      room_id: sRoomId,
      room_name: rName,
      host: hostStr,
      port: Number(roomPort) || 42000
    }));

    if (outcomePromise) {
      return await outcomePromise;
    }
    return { ok: true };
  } else {
    // Локальная эмуляция этапов с последующим HTTP PUT
    let fallbackFinished = false;
    const stepTimers = [];
    if (effCard) {
      stepTimers.push(setTimeout(() => {
        if (fallbackFinished) return;
        setAslProcBannerState(effCard, {
          active: true,
          text: window.t
            ? window.t("ysf.proc_dns", { room: sRoomId, host: hostStr }, `Reflector #${sRoomId} (${hostStr}:42000): resolving DNS...`)
            : `Reflector #${sRoomId} (${hostStr}:42000): resolving DNS...`,
          tone: "neutral",
          autoHideMs: 0
        });
      }, 350));
      stepTimers.push(setTimeout(() => {
        if (fallbackFinished) return;
        setAslProcBannerState(effCard, {
          active: true,
          text: window.t
            ? window.t("ysf.proc_ysfp", { room: sRoomId }, `Reflector #${sRoomId}: sending YSFP (Keepalive handshake)...`)
            : `Reflector #${sRoomId}: sending YSFP (Keepalive handshake)...`,
          tone: "neutral",
          autoHideMs: 0
        });
      }, 750));
      stepTimers.push(setTimeout(() => {
        if (fallbackFinished) return;
        const csLabel = targetHs.callsign || "ProxDMR";
        setAslProcBannerState(effCard, {
          active: true,
          text: window.t
            ? window.t("ysf.proc_ysfi", { room: sRoomId, callsign: csLabel }, `Reflector #${sRoomId}: registering station YSFI (${csLabel})...`)
            : `Reflector #${sRoomId}: registering station YSFI (${csLabel})...`,
          tone: "neutral",
          autoHideMs: 0
        });
      }, 1150));
      stepTimers.push(setTimeout(() => {
        if (fallbackFinished) return;
        setAslProcBannerState(effCard, {
          active: true,
          text: window.t
            ? window.t("ysf.proc_ysfs", { room: sRoomId }, `Reflector #${sRoomId}: requesting participants status YSFS...`)
            : `Reflector #${sRoomId}: requesting participants status YSFS...`,
          tone: "neutral",
          autoHideMs: 0
        });
      }, 1550));
    }

    try {
      targetHs.ysf_room = sRoomId;
      targetHs.ysf_room_id = sRoomId;
      targetHs.ysf_name = rName;
      targetHs.ysf_room_name = rName;
      if (hostStr) {
        targetHs.bm_master_host = hostStr;
        targetHs.ysf_host = hostStr;
      }
      targetHs.ysf_port = Number(roomPort) || 42000;
      const resp = await fetch(`/api/hotspots/${encodeURIComponent(targetHs.id)}?reconnect=1`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...targetHs,
          bm_master_host: hostStr || "",
          ysf_host: hostStr || "",
          ysf_port: Number(roomPort) || 42000,
          ysf_room: sRoomId,
          ysf_room_id: sRoomId,
          ysf_name: rName,
          ysf_room_name: rName
        })
      });
      fallbackFinished = true;
      stepTimers.forEach(t => clearTimeout(t));
      if (targetHs._ysfActionSeq !== seqAtStart) {
        return { ok: false, aborted: true };
      }
      targetHs._ysfConnectingRoom = null;

      let putData = null;
      if (resp.ok) {
        try { putData = await resp.json(); } catch (_) {}
      }
      const hsStatus = String(putData?.hotspot?.status || "").toUpperCase();
      const connectedOk = resp.ok && hsStatus !== "DISCONNECTED" && hsStatus !== "OFFLINE" && hsStatus !== "ERROR";

      if (connectedOk) {
        if (putData && putData.hotspot) {
          Object.assign(targetHs, putData.hotspot);
        }
        targetHs.status = "ONLINE";
        if (effCard) {
          setAslProcBannerState(effCard, {
            active: true,
            text: window.t
              ? window.t("ysf.proc_connected", { room: sRoomId, name: rName }, `✓ Reflector #${sRoomId} (${rName}): connected`)
              : `✓ Reflector #${sRoomId} (${rName}): connected`,
            tone: "positive",
            autoHideMs: 4000,
            fadeOutMs: 2000
          });
          syncYsfMatrixButtonsState(effCard, targetHs);
          if (typeof window.updateCardYsfPanel === "function") {
            window.updateCardYsfPanel(effCard, targetHs);
          }
          if (typeof window.updateCardPttHint === "function") {
            window.updateCardPttHint(effCard);
          }
        }
        return { ok: true };
      } else {
        targetHs.status = "DISCONNECTED";
        if (effCard) {
          setAslProcBannerState(effCard, {
            active: true,
            text: resp.ok
              ? (window.t
                  ? window.t("ysf.proc_failed", { room: sRoomId, status: hsStatus || "OFFLINE" }, `✕ Reflector #${sRoomId}: connection failed (${hsStatus || "OFFLINE"})`)
                  : `✕ Reflector #${sRoomId}: connection failed (${hsStatus || "OFFLINE"})`)
              : (window.t
                  ? window.t("ysf.proc_http_err", { room: sRoomId, code: resp.status }, `✕ Error #${sRoomId}: server returned HTTP ${resp.status}`)
                  : `✕ Error #${sRoomId}: server returned HTTP ${resp.status}`),
            tone: "negative",
            autoHideMs: 4000,
            fadeOutMs: 2000
          });
          syncYsfMatrixButtonsState(effCard, targetHs);
        }
        return { ok: false, reason: resp.ok ? (hsStatus || "offline") : `http_${resp.status}` };
      }
    } catch (e) {
      fallbackFinished = true;
      stepTimers.forEach(t => clearTimeout(t));
      targetHs._ysfConnectingRoom = null;
      targetHs.status = "DISCONNECTED";
      if (effCard) {
        setAslProcBannerState(effCard, {
          active: true,
          text: window.t
            ? window.t("ysf.proc_conn_err", { room: sRoomId, error: e.message || e }, `✕ Error #${sRoomId}: connection failure (${e.message || e})`)
            : `✕ Error #${sRoomId}: connection failure (${e.message || e})`,
          tone: "negative",
          autoHideMs: 4000,
          fadeOutMs: 2000
        });
        syncYsfMatrixButtonsState(effCard, targetHs);
      }
      return { ok: false, reason: e.message || "fetch_error" };
    }
  }
}

export async function ysfDisconnectProcedure(cid, card = null, { showStatusBanner = true } = {}) {
  const effCard = card || document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) || document.getElementById("radioContainer");
  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
  const targetHs = curHsList.find(h => h && h.id === cid) || curHsList[0];
  const curRoom = targetHs ? String(targetHs.ysf_room || targetHs._ysfConnectingRoom || "").trim() : "";

  const seqAtDisc = targetHs ? (targetHs._ysfActionSeq = (targetHs._ysfActionSeq || 0) + 1) : 0;
  if (targetHs) {
    targetHs.isManualBmDisconnect = true;
    if (typeof window !== "undefined" && (cid === window.activeHotspotId || targetHs.id === window.activeHotspotId)) {
      window.isManualBmDisconnect = true;
    }
    targetHs._ysfDisconnectingRoom = curRoom || "all";
    targetHs._ysfConnectingRoom = null;
    targetHs._ysfDashOpen = false;
  }
  if (effCard && targetHs) {
    syncYsfMatrixButtonsState(effCard, targetHs);
  }

  if (effCard && showStatusBanner) {
    setAslProcBannerState(effCard, {
      active: true,
      text: curRoom
        ? (window.t ? window.t("ysf.proc_disconnecting", { room: curRoom }, `Disconnecting #${curRoom}: sending unlink command (YSFU)...`) : `Disconnecting #${curRoom}: sending unlink command (YSFU)...`)
        : (window.t ? window.t("ysf.proc_disconnecting_all", {}, "Disconnecting YSF: resetting link...") : "Disconnecting YSF: resetting link..."),
      tone: "neutral",
      autoHideMs: 0
    });
  }

  try {
    const resp = await fetch("/api/ysf/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hotspot_id: cid })
    });
    const res = await resp.json();
    if (res && res.status === "ok") {
      if (targetHs && targetHs._ysfActionSeq !== seqAtDisc) {
        return;
      }
      if (targetHs) {
        targetHs.status = "DISCONNECTED";
        targetHs.ysf_room = "";
        targetHs.ysf_room_id = "";
        targetHs.ysf_name = "";
        targetHs.ysf_room_name = "";
        targetHs.ysf_host = "";
        targetHs.bm_master_host = "";
        targetHs._ysfDisconnectingRoom = null;
        targetHs.isManualBmDisconnect = true;
        if (typeof window !== "undefined" && (cid === window.activeHotspotId || targetHs.id === window.activeHotspotId)) {
          window.isManualBmDisconnect = true;
        }
      }
      updateBmStatus("DISCONNECTED", window.t ? window.t("status.disconnected", {}, "Disconnected") : "Disconnected", cid);
      if (effCard) {
        effCard.dataset.ysfRoom = "";
        if (showStatusBanner) {
          setAslProcBannerState(effCard, {
            active: true,
            text: curRoom
              ? (window.t ? window.t("ysf.proc_disconnected_room", { room: curRoom }, `✓ Reflector #${curRoom} disconnected (channel clear)`) : `✓ Reflector #${curRoom} disconnected (channel clear)`)
              : (window.t ? window.t("ysf.proc_disconnected_standby", {}, "✓ YSF disconnected (STANDBY)") : "✓ YSF disconnected (STANDBY)"),
            tone: "positive",
            autoHideMs: 4000
          });
        }
        if (typeof window.updateCardYsfPanel === "function") {
          window.updateCardYsfPanel(effCard, targetHs);
        }
        syncYsfMatrixButtonsState(effCard, targetHs);
        updateCardPttHint(effCard);
      }
    } else if (targetHs) {
      targetHs._ysfDisconnectingRoom = null;
    }
  } catch (err) {
    if (targetHs) targetHs._ysfDisconnectingRoom = null;
    if (effCard && showStatusBanner) {
      setAslProcBannerState(effCard, {
        active: true,
        text: window.t
          ? window.t("ysf.proc_disconnect_err", { error: err.message || err }, `✕ YSF disconnect error: ${err.message || err}`)
          : `✕ YSF disconnect error: ${err.message || err}`,
        tone: "negative",
        autoHideMs: 4000
      });
    }
  }
}

export function syncYsfMatrixButtonsState(card, targetHs) {
  if (!card || !targetHs) return;
  const buttons = card.querySelectorAll(".btn-ysf-room-cell");
  if (!buttons.length) return;

  const probeMap = Object.assign({}, window._ysfGlobalRoomProbeCache || {}, targetHs._ysfRoomProbeMap || {});
  const activeRoom = String(targetHs.ysf_room || (card && card.dataset.ysfRoom) || "").trim();
  const connectingRoom = String(targetHs._ysfConnectingRoom || "").trim();
  const disconnectingRoom = String(targetHs._ysfDisconnectingRoom || "").trim();
  const scanningRoom = (targetHs._ysfScanActive && targetHs._ysfScanningRoom) ? String(targetHs._ysfScanningRoom).trim() : "";
  const keyedSet = new Set();
  if (targetHs._ysfRxActiveRoom) keyedSet.add(String(targetHs._ysfRxActiveRoom).trim());
  if (Array.isArray(targetHs._ysfKeyedRooms)) {
    targetHs._ysfKeyedRooms.forEach(kr => keyedSet.add(String(kr).trim()));
  }

  buttons.forEach(btn => {
    const r = String(btn.dataset.room || "").trim();
    const connsEl = btn.querySelector(".asl-btn-conns");

    if (!r) {
      if (connsEl) {
        connsEl.className = "asl-btn-conns asl-conns-hidden";
        connsEl.textContent = "";
      }
      btn.classList.remove(
        "asl-node-offline",
        "asl-node-linked-monitor",
        "asl-node-connecting",
        "asl-node-connecting-monitor",
        "asl-node-disconnecting",
        "asl-node-scanning-now",
        "ysf-node-scanning-now",
        "active-room",
        "active-asl-node"
      );
      return;
    }

    const isDisconnecting = Boolean(disconnectingRoom && (r === disconnectingRoom || disconnectingRoom === "all"));
    const isEstablished = !isDisconnecting && Boolean(activeRoom && r === activeRoom && isYsfOnlineStatus(targetHs.status));
    const isConnecting = !isDisconnecting && !isEstablished && Boolean(connectingRoom && r === connectingRoom);
    const isScanningNow = Boolean(scanningRoom && r === scanningRoom);

    btn.classList.toggle("asl-node-linked-monitor", isEstablished);
    btn.classList.toggle("active-room", isEstablished);
    btn.classList.toggle("active-asl-node", isEstablished);

    btn.classList.toggle("asl-node-connecting", isConnecting);
    btn.classList.toggle("asl-node-connecting-monitor", isConnecting);
    btn.classList.toggle("asl-node-disconnecting", isDisconnecting);
    btn.classList.toggle("asl-node-scanning-now", isScanningNow);
    btn.classList.toggle("ysf-node-scanning-now", isScanningNow);

    if (!connsEl) return;

    const probe = probeMap[r];

    if (isDisconnecting) {
      connsEl.className = "asl-btn-conns asl-conns-connecting";
      connsEl.textContent = "...";
      connsEl.title = window.t
        ? window.t("ysf.disconnecting_room", { room: r }, `Disconnecting room #${r}...`)
        : `Disconnecting room #${r}...`;
      btn.classList.remove("asl-node-offline");
    } else if (isConnecting) {
      connsEl.className = "asl-btn-conns asl-conns-connecting";
      connsEl.textContent = "...";
      connsEl.title = window.t
        ? window.t("ysf.connecting_room", { room: r }, `Connecting to room #${r}...`)
        : `Connecting to room #${r}...`;
      btn.classList.remove("asl-node-offline");
    } else if (!probe) {
      connsEl.className = "asl-btn-conns asl-conns-hidden";
      connsEl.textContent = "";
      btn.classList.remove("asl-node-offline");
    } else if (!probe.online && r !== activeRoom) {
      btn.classList.add("asl-node-offline");
      connsEl.className = "asl-btn-conns asl-conns-offline";
      connsEl.textContent = "OFF";
      connsEl.title = window.t
        ? window.t("ysf.reflector_offline", {}, "Reflector unreachable / Offline")
        : "Reflector unreachable / Offline";
    } else {
      btn.classList.remove("asl-node-offline");
      const isKeyed = Boolean(probe.keyed || keyedSet.has(r));
      const linksNum = probe.connections !== undefined ? probe.connections : (probe.online_count || 0);

      let connsClass = "asl-conns-zero";
      let connsText = String(linksNum);
      let connsTitle = window.t
        ? window.t("ysf.connected_nodes", { count: linksNum }, `Connected nodes: ${linksNum}`)
        : `Connected nodes: ${linksNum}`;

      if (isKeyed) {
        connsClass = "asl-conns-hot";
        connsText = `• ${linksNum}`;
        connsTitle = window.t
          ? window.t("ysf.on_air_now", { count: linksNum }, `On air right now 🔥 (${linksNum} nodes)`)
          : `On air right now 🔥 (${linksNum} nodes)`;
      } else if (typeof linksNum === "number" && linksNum > 0) {
        connsClass = "asl-conns-active";
        connsTitle = window.t
          ? window.t("ysf.connected_waiting", { count: linksNum }, `Connected nodes: ${linksNum} (idle)`)
          : `Connected nodes: ${linksNum} (idle)`;
      } else {
        connsClass = "asl-conns-zero";
        connsText = "0";
        connsTitle = window.t
          ? window.t("ysf.connections_zero", {}, "Connections: 0")
          : "Connections: 0";
      }

      connsEl.className = `asl-btn-conns ${connsClass}`;
      connsEl.textContent = connsText;
      connsEl.title = connsTitle;
    }
  });
}

const _ysfMatrixProbeStateByCid = new Map();

export async function probeYsfMatrixRooms(card, targetHs, force = false) {
  if (!card || !targetHs) return;
  const cid = targetHs.id || card.dataset.hotspotId || "default";
  const stateKey = resolveHotspotId(cid) || cid;
  const probePage = getYsfMatrixPage(cid, targetHs);
  const nowMs = Date.now();
  const probeState = _ysfMatrixProbeStateByCid.get(stateKey) || { inFlight: false, lastTs: 0, lastPage: null };
  if (
    !force &&
    probeState.lastPage === probePage &&
    (probeState.inFlight || (nowMs - probeState.lastTs < 5000))
  ) {
    return;
  }
  let buttons = card.querySelectorAll(`.ysf-page[data-page="${probePage}"] .btn-ysf-room-cell`);
  if (!buttons.length) buttons = card.querySelectorAll(".btn-ysf-room-cell");
  if (!buttons.length) return;

  const rooms = [];
  buttons.forEach(b => {
    const r = String(b.dataset.room || "").trim();
    if (r && r !== "0") rooms.push(r);
  });
  if (!rooms.length) return;

  probeState.inFlight = true;
  probeState.lastTs = nowMs;
  probeState.lastPage = probePage;
  _ysfMatrixProbeStateByCid.set(stateKey, probeState);
  try {
    const res = await fetch("/api/ysf/matrix-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hotspot_id: cid, rooms, force: Boolean(force) })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.rooms) {
        window._ysfGlobalRoomProbeCache = window._ysfGlobalRoomProbeCache || {};
        Object.assign(window._ysfGlobalRoomProbeCache, data.rooms);
        targetHs._ysfRoomProbeMap = Object.assign(targetHs._ysfRoomProbeMap || {}, data.rooms);
        syncYsfMatrixButtonsState(card, targetHs);
      }
    }
  } catch (err) {
    console.debug("[YSF] Matrix probe error:", err);
  } finally {
    probeState.inFlight = false;
  }
}

let _ysfDashFastPollTimer = null;

export function isYsfDashAutoOpenEnabled(cid = "default") {
  try {
    let v = hasServerCollectionKey("ysf_dash_auto", cid)
      ? getServerCollectionValue("ysf_dash_auto", cid)
      : localStorage.getItem(`proxdmr_ysf_dash_auto_${cid}`);
    if (v === null || v === undefined || v === "") return true;
    if (v === false || v === 0 || v === "0" || v === "false") return false;
    return v === true || v === 1 || v === "1" || v === "true";
  } catch (_) {
    return true;
  }
}

export function setYsfDashAutoOpenEnabled(cid = "default", enabled = true) {
  try {
    setServerCollectionKey("ysf_dash_auto", cid, enabled ? "1" : "0", "proxdmr_ysf_dash_auto_", false);
  } catch (_) {}
}

export async function renderYsfDashboard(card, targetHs, cid) {
  if (!card) return;
  const effCid = cid || (targetHs && targetHs.id) || card.dataset.hotspotId || "default";
  const dashViewport = card.querySelector(`#ysfDashGridViewport_${effCid}`) || card.querySelector(".ysf-dash-grid-viewport");
  const notchDashBadge = card.querySelector(`#ysfNotchDashBadge_${effCid}`) || card.querySelector(".ysf-notch-dash-badge");
  const matrixContainer = card.querySelector(".ysf-matrix-container");
  const sliderContainer = card.querySelector(".ysf-slider-container");
  const dashPair = card.querySelector(`.ysf-dash-pair`);

  const isDashOpen = Boolean(targetHs && targetHs._ysfDashOpen);
  if (matrixContainer) matrixContainer.classList.toggle("is-dash-view", isDashOpen);
  if (sliderContainer) sliderContainer.classList.toggle("is-dash-mode", isDashOpen);
  if (dashPair) dashPair.classList.toggle("dash-open", isDashOpen);

  if (!isDashOpen) {
    if (_ysfDashFastPollTimer) {
      clearInterval(_ysfDashFastPollTimer);
      _ysfDashFastPollTimer = null;
    }
    return;
  }

  try {
    const res = await fetch(`/api/ysf/connected?hotspot_id=${encodeURIComponent(effCid)}`);
    const data = await res.json();
    if (data && data.status === "ok") {
      const onlineCount = data.online_count || 0;
      const caller = data.caller || "";
      const lastHeard = Array.isArray(data.last_heard) ? data.last_heard : [];
      const currentRoom = data.room_id || (targetHs && (targetHs.ysf_room || targetHs.config?.ysf_room)) || "";

      if (notchDashBadge) {
        if (data.connected && currentRoom) {
          notchDashBadge.textContent = `ROOM #${currentRoom} · [👥 ${onlineCount}]`;
        } else {
          notchDashBadge.textContent = "DASHBOARD 4×5";
        }
      }

      if (!dashViewport) return;

      if (!data.connected) {
        dashViewport.innerHTML = `<div class="asl-dash-grid-empty" style="padding: 24px 12px; text-align: center; opacity: 0.7; font-size: 13px;">${window.t ? window.t("ysf.dash_disconnected", {}, "Хотспот YSF в режиме ожидания. Подключитесь к комнате для просмотра участников") : "Хотспот YSF в режиме ожидания. Подключитесь к комнате для просмотра участников"}</div>`;
        return;
      }

      if (lastHeard.length === 0) {
        dashViewport.innerHTML = `<div class="asl-dash-grid-empty" style="padding: 24px 12px; text-align: center; opacity: 0.7; font-size: 13px;">${window.t ? window.t("ysf.dash_no_participants", {}, `[👥 ${onlineCount} узлов в комнате #${currentRoom}]. Ожидание активности в эфире...`) : `[👥 ${onlineCount} узлов в комнате #${currentRoom}]. Ожидание активности в эфире...`}</div>`;
        return;
      }

      dashViewport.innerHTML = lastHeard.map(item => {
        const cCall = safeEscapeHtml(item.callsign || "");
        const isTalking = caller && caller.toUpperCase() === cCall.toUpperCase();
        const countryInfo = (typeof getCountryInfo === "function") ? getCountryInfo(0, cCall) : null;
        const flag = (countryInfo && countryInfo.flag) ? countryInfo.flag : "🌐";
        const timeStr = safeEscapeHtml(item.time_str || "");

        const cls = [
          "btn-allstar-node",
          "btn-ysf-room-cell",
          "asl-dash-tile",
          "participant-card",
          isTalking ? "asl-dash-tile-talking" : "",
          "asl-dash-tile-heard"
        ].filter(Boolean).join(" ");

        return `
          <button type="button" class="${cls}" data-callsign="${cCall}" title="${cCall} (${timeStr}) — ${isTalking ? (window.t ? window.t("ysf.dash_state_talking", {}, "Talking") : "Talking") : (window.t ? window.t("ysf.dash_state_heard", {}, "Was on air") : "Was on air")}">
            <div class="asl-btn-header">
              <span class="asl-btn-flag">${flag}</span>
              <strong class="asl-btn-num">${cCall}</strong>
            </div>
            <div class="asl-btn-footer">
              <span class="asl-dash-desc-line">${timeStr || (isTalking ? (window.t ? window.t("ysf.dash_talking", {}, "TALKING") : "TALKING") : (window.t ? window.t("ysf.dash_active", {}, "ACTIVE") : "ACTIVE"))}</span>
            </div>
          </button>
        `;
      }).join("");

      dashViewport.querySelectorAll(".asl-dash-tile").forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const cs = btn.dataset.callsign || "";
          if (cs && typeof window.openCallIdModal === "function") {
            window.openCallIdModal(cs);
          }
        };
      });

      if (!_ysfDashFastPollTimer) {
        _ysfDashFastPollTimer = setInterval(() => {
          if (!targetHs || !targetHs._ysfDashOpen) {
            clearInterval(_ysfDashFastPollTimer);
            _ysfDashFastPollTimer = null;
            return;
          }
          renderYsfDashboard(card, targetHs, effCid);
        }, 4000);
      }
    }
  } catch (err) {
    // network error ignore
  }
}

export function getYsfRoomShortInfo(roomId, targetHs = null, cid = "default") {
  const cleanId = String(roomId || "").trim();
  if (!cleanId) return { label: "", flag: "🌐" };

  // 1. Проверяем сохранённые ячейки матрицы комнат
  try {
    const rooms = getYsfMatrixRooms(cid);
    const matched = rooms.find(r => r && String(r.room).trim() === cleanId && r.room);
    if (matched) {
      return {
        label: matched.label || `YSF #${cleanId}`,
        flag: (matched.flag && matched.flag !== "➕") ? matched.flag : "🌐"
      };
    }
  } catch (_) {}

  // 2. Проверяем каталог/кэш серверов YSF
  try {
    const ysfList = (typeof window !== "undefined" && typeof window.getNetworkServersList === "function" 
      ? window.getNetworkServersList("ysf") 
      : ((window._dmrServersCache && window._dmrServersCache["ysf"]) || [])) || [];
    
    const found = ysfList.find(r => {
      const rIdStr = String(r.id || "").trim();
      return rIdStr === cleanId || (parseInt(rIdStr, 10) === parseInt(cleanId, 10));
    });

    if (found) {
      if (typeof window.resolveYsfRoomInfo === "function") {
        const info = window.resolveYsfRoomInfo(found);
        return {
          label: info.refName || found.reflector_name || found.name || `YSF #${cleanId}`,
          flag: info.flag || "🌐"
        };
      }
      return {
        label: found.reflector_name || found.name || `YSF #${cleanId}`,
        flag: "🌐"
      };
    }
  } catch (_) {}

  // 3. Данные из объекта targetHs
  const hsName = targetHs ? String(targetHs.ysf_name || targetHs.config?.ysf_name || "").trim() : "";
  if (hsName) {
    if (typeof window.resolveYsfRoomInfo === "function") {
      const info = window.resolveYsfRoomInfo({ id: cleanId, name: hsName });
      return {
        label: info.refName || hsName,
        flag: info.flag || "🌐"
      };
    }
    return { label: hsName, flag: "🌐" };
  }

  return { label: `YSF #${cleanId}`, flag: "🌐" };
}

export function updateYsfVfoHeader(card, hs = null) {
  if (!card) return;
  const targetHs = hs || (card.dataset.hotspotId ? (getCurrentHotspots().find(h => h.id === card.dataset.hotspotId) || null) : null) || (getCurrentHotspots()[0] || null);
  const callsignEl = card.querySelector(".callsign-display");
  if (!callsignEl) return;

  const isYsfNet = ((targetHs && targetHs.network_type) || card.dataset.networkType || "").toLowerCase() === "ysf";
  if (!isYsfNet) return;

  const myCall = String((targetHs && targetHs.callsign) || "N0CALL").trim();
  const cid = (targetHs && targetHs.id) || card.dataset.hotspotId || "default";

  const isDisconnected = Boolean(targetHs && (!isYsfOnlineStatus(targetHs.status) || !targetHs.ysf_room));
  const connRoom = isDisconnected ? "" : String((targetHs && (targetHs.ysf_room || targetHs.ysf_room_id || targetHs.config?.ysf_room || targetHs.room_id)) || "").trim();
  const isLinked = Boolean(connRoom && connRoom !== "0");

  // 1. Режим ожидания (Standby): позывной радиостанции
  if (!isLinked) {
    const idleKey = `ysf_idle_${myCall}`;
    if (callsignEl._lastYsfVfoKey === idleKey) return;
    callsignEl._lastYsfVfoKey = idleKey;
    callsignEl.classList.remove("has-asl-marquee");
    callsignEl.innerHTML = `<span class="ysf-vfo-callsign ysf-vfo-standby">${safeEscapeHtml(myCall)}</span>`;
    callsignEl.removeAttribute("title");
    return;
  }

  // 2. Режим подключения: флаг, ID, Имя/название рефлектора
  const { label, flag } = getYsfRoomShortInfo(connRoom, targetHs, cid);
  const displayTitle = label ? `${label}` : `YSF #${connRoom}`;

  const vfoKey = `ysf_linked_${connRoom}_${displayTitle}_${flag}`;
  if (callsignEl._lastYsfVfoKey === vfoKey) return;
  callsignEl._lastYsfVfoKey = vfoKey;

  const flagHtml = `<span class="ysf-vfo-ref-flag">${safeEscapeHtml(flag)}</span>`;
  const idHtml = `<strong class="ysf-vfo-ref-id">#${safeEscapeHtml(connRoom)}</strong>`;
  const nameHtml = `<span class="ysf-vfo-ref-name">${safeEscapeHtml(displayTitle)}</span>`;

  const itemHtml = `<span class="asl-vfo-marquee-item ysf-vfo-marquee-item">${flagHtml} ${idHtml} ${nameHtml}</span>`;

  callsignEl.innerHTML = `<div class="asl-vfo-marquee-track"><div class="asl-vfo-marquee-inner">${itemHtml}</div></div>`;
  callsignEl.title = window.t
    ? window.t("ysf.vfo_tooltip_reflector", { id: connRoom, name: displayTitle }, `Рефлектор YSF #${connRoom}: ${displayTitle}`)
    : `Рефлектор YSF #${connRoom}: ${displayTitle}`;

  // 3. Бесшовная бесконечная бегущая строка при переполнении
  requestAnimationFrame(() => {
    const track = callsignEl.querySelector(".asl-vfo-marquee-track");
    const inner = callsignEl.querySelector(".asl-vfo-marquee-inner");
    const item = callsignEl.querySelector(".asl-vfo-marquee-item");
    if (!track || !inner || !item) return;

    const itemWidth = Math.ceil(item.getBoundingClientRect().width || item.scrollWidth);
    const trackWidth = Math.floor(track.getBoundingClientRect().width || track.clientWidth);
    const diff = itemWidth - trackWidth;
    if (diff > 4) {
      const sep = `<span class="asl-vfo-marquee-sep" aria-hidden="true">&nbsp;---&nbsp;</span>`;
      inner.innerHTML = `${itemHtml}${sep}${itemHtml}${sep}`;
      callsignEl.classList.add("has-asl-marquee");
      track.classList.add("asl-marquee-active");
      const halfWidth = Math.max(100, Math.round(inner.scrollWidth / 2));
      const durSec = Math.max(7, Math.min(30, Math.round(halfWidth / 28)));
      track.style.setProperty("--asl-marquee-shift", `-${halfWidth}px`);
      track.style.setProperty("--asl-marquee-duration", `${durSec}s`);
    } else {
      callsignEl.classList.remove("has-asl-marquee");
      track.classList.remove("asl-marquee-active");
    }
  });
}

const YSF_STARTER_DG_IDS = ["01", "02", "03", "05", "09", "10", "13", "20", "24", "65", "79", "90"];
const YSF_STARTER_DG_ID_OPT = YSF_STARTER_DG_IDS.join(";") + ";";
const _YSF_MR_DETECT_RE = /(?:^|[^A-Z0-9])(YCS|FCS)(?:[0-9]{0,4}|[^A-Z0-9]|$)/i;

function _parseYsfDgIdList(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "00" || s.toLowerCase() === "all") return [];
  const out = [];
  for (const tok of s.split(/[;,\s]+/)) {
    const t = tok.trim();
    if (!t || !/^\d+$/.test(t)) continue;
    const n = parseInt(t, 10);
    if (n >= 1 && n <= 99 && !out.includes(n)) {
      out.push(n);
      if (out.length >= 12) break;
    }
  }
  return out;
}

const _YSF_MUTANT_DETECT_RE = /(?:^|[^A-Z0-9])(PYSF3|PYSFREFLECTOR3|YSFREFLECTOR3|MULTI[-_\s]?STREAM|DG[-_]?ID(?:_ENABLE|S|\d{1,2})?)(?:[^A-Z0-9]|$)/i;

function _findYsfCatalogRoom(roomId) {
  const sId = String(roomId || "").trim();
  if (!sId) return null;
  const ysfList = (typeof window !== "undefined" && typeof window.getNetworkServersList === "function"
    ? window.getNetworkServersList("ysf")
    : ((typeof window !== "undefined" && window._dmrServersCache && window._dmrServersCache["ysf"]) || [])) || [];
  let hit = Array.isArray(ysfList)
    ? ysfList.find(r => String(r.id || "").trim() === sId || (sId.length < 5 && String(r.id || "").trim() === sId.padStart(5, "0")))
    : null;
  if (!hit && typeof window !== "undefined" && Array.isArray(window.DEFAULT_YSF_BOOKMARKS)) {
    hit = window.DEFAULT_YSF_BOOKMARKS.find(r => String(r.id || "").trim() === sId || (sId.length < 5 && String(r.id || "").trim() === sId.padStart(5, "0"))) || null;
  }
  return hit || null;
}

export function resolveYsfMatrixCellTypeInfo(roomId, cellItem = null, targetHs = null) {
  const sId = String(roomId || "").trim();
  if (!sId) return { reflectorType: "single", isMultiroom: false, kind: "", override: "" };

  const catRoom = _findYsfCatalogRoom(sId);
  const collectionOverride = (typeof window !== "undefined" && typeof window.getYsfRoomTypeOverride === "function")
    ? window.getYsfRoomTypeOverride(sId)
    : String(getServerCollectionValue("ysf_room_types", sId) || "").trim().toLowerCase();
  const cellOverride = cellItem && typeof cellItem === "object"
    ? String(cellItem.type_override || "").trim().toLowerCase()
    : "";
  const effectiveOverride = (collectionOverride === "single" || collectionOverride === "multi_standard" || collectionOverride === "multi_mutant")
    ? collectionOverride
    : ((cellOverride === "single" || cellOverride === "multi_standard" || cellOverride === "multi_mutant") ? cellOverride : "");

  const activeHsId = targetHs ? String(targetHs.ysf_room || targetHs.ysf_room_id || targetHs.config?.ysf_room_id || "").trim() : "";
  const isSameActive = Boolean(targetHs && activeHsId && activeHsId === sId);

  const synthetic = {
    id: sId,
    name: (catRoom && catRoom.name) || (cellItem && cellItem.label) || (isSameActive && (targetHs.ysf_name || targetHs.ysf_room_name)) || "",
    reflector_name: (catRoom && catRoom.reflector_name) || (cellItem && cellItem.label) || "",
    description: (catRoom && catRoom.description) || "",
    host: (catRoom && catRoom.host) || (isSameActive && targetHs.ysf_host) || "",
    multiroom_kind: (catRoom && catRoom.multiroom_kind) || (isSameActive && targetHs.ysf_multiroom_kind) || "",
    reflector_type: (isSameActive && targetHs.ysf_reflector_type === "multi_mutant")
      ? "multi_mutant"
      : ((catRoom && catRoom.reflector_type) || ""),
    room_type_override: effectiveOverride,
  };

  if (typeof window !== "undefined" && typeof window.classifyYsfReflector === "function") {
    return window.classifyYsfReflector(synthetic, sId);
  }
  const fields = [synthetic.name, synthetic.reflector_name, synthetic.description, synthetic.host];
  let stdK = "";
  let mutK = "";
  for (const f of fields) {
    if (!f) continue;
    const up = String(f).toUpperCase();
    if (!stdK) { const ms = up.match(_YSF_MR_DETECT_RE); if (ms) stdK = ms[1].toUpperCase(); }
    if (!mutK) { const mm = up.match(_YSF_MUTANT_DETECT_RE); if (mm) mutK = mm[1].toUpperCase(); }
  }
  if (effectiveOverride === "single") return { reflectorType: "single", isMultiroom: false, kind: "", override: "single" };
  if (effectiveOverride === "multi_standard") return { reflectorType: "multi_standard", isMultiroom: true, kind: stdK || "YCS", override: "multi_standard" };
  if (effectiveOverride === "multi_mutant") return { reflectorType: "multi_mutant", isMultiroom: true, kind: mutK || "MANUAL", override: "multi_mutant" };
  if (stdK) return { reflectorType: "multi_standard", isMultiroom: true, kind: stdK, override: "" };
  if (mutK) return { reflectorType: "multi_mutant", isMultiroom: true, kind: mutK, override: "" };
  if (synthetic.reflector_type === "multi_mutant") return { reflectorType: "multi_mutant", isMultiroom: true, kind: synthetic.multiroom_kind || "LIVE_DGID", override: "" };
  return { reflectorType: "single", isMultiroom: false, kind: "", override: "" };
}

function _getYsfHsMultiroomInfo(targetHs) {
  if (!targetHs) return { isMultiroom: false, reflectorType: "single", kind: "" };
  const rid = String(targetHs.ysf_room || targetHs.ysf_room_id || targetHs.config?.ysf_room_id || "").trim();
  const resolved = resolveYsfMatrixCellTypeInfo(rid, null, targetHs);
  if (resolved.override === "single") {
    return { isMultiroom: false, reflectorType: "single", kind: "" };
  }
  if (resolved.isMultiroom) {
    return { isMultiroom: true, reflectorType: resolved.reflectorType, kind: resolved.kind || "YCS" };
  }
  if (targetHs.ysf_is_multiroom === true) {
    const fallbackType = targetHs.ysf_reflector_type === "multi_mutant" ? "multi_mutant" : "multi_standard";
    return { isMultiroom: true, reflectorType: fallbackType, kind: targetHs.ysf_multiroom_kind || (fallbackType === "multi_mutant" ? "LIVE_DGID" : "YCS") };
  }
  return { isMultiroom: false, reflectorType: "single", kind: "" };
}

export async function applyYsfDgIdLive(cid, payload = {}, card = null) {
  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
  const targetHs = curHsList.find(h => h && h.id === cid) || curHsList[0];
  if (!targetHs) return { ok: false };
  const effCard = card || document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) || document.getElementById("radioContainer");
  const roomId = String(payload.room_id || targetHs.ysf_room || targetHs.ysf_room_id || targetHs.config?.ysf_room_id || "25000").trim();
  const body = { hotspot_id: cid, room_id: roomId };
  if (Object.prototype.hasOwnProperty.call(payload, "rx_dg_id")) {
    body.rx_dg_id = String(payload.rx_dg_id || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(payload, "tx_dg_id")) {
    body.tx_dg_id = payload.tx_dg_id;
  }
  try {
    const resp = await fetch("/api/ysf/dg-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      let errMsg = `HTTP ${resp.status}`;
      try { const ej = await resp.json(); if (ej && ej.detail) errMsg = ej.detail; } catch (_) {}
      if (typeof showToast === "function") showToast(`✕ ${errMsg}`, "error", effCard);
      return { ok: false };
    }
    const res = await resp.json();
    if (res && res.hotspot) {
      Object.assign(targetHs, res.hotspot);
    } else if (res) {
      if (res.rx_dg_id !== undefined) targetHs.ysf_dg_id = res.rx_dg_id;
      if (res.tx_dg_id !== undefined) targetHs.ysf_tx_dg_id = res.tx_dg_id;
    }
    if (effCard) {
      syncCardYsfDgIdBar(effCard, targetHs);
      if (typeof window.updateCardPttHint === "function") window.updateCardPttHint(effCard);
    }
    return { ok: true, data: res };
  } catch (err) {
    const errMsg = window.t ? window.t("ysf.dgid_error", { err: err.message || err }, `✕ DG-ID error: ${err.message || err}`) : `✕ DG-ID error: ${err.message || err}`;
    if (typeof showToast === "function") showToast(errMsg, "error", effCard);
    return { ok: false };
  }
}

export function isYsfTxDgIdPromptRequired(cid) {
  const resId = resolveHotspotId(cid || (typeof window !== "undefined" && window.activeHotspotId) || "default");
  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
  const hs = curHsList.find(h => h && (h.id === resId || h.id === cid)) || curHsList[0];
  if (!hs) return false;
  if (String(hs.network_type || "").toLowerCase() !== "ysf") return false;
  const txVal = Number(hs.ysf_tx_dg_id || hs.config?.ysf_tx_dg_id || 0);
  if (txVal >= 1 && txVal <= 99) return false;
  const mrInfo = _getYsfHsMultiroomInfo(hs);
  const rxIds = _parseYsfDgIdList(hs.ysf_dg_id || hs.config?.ysf_dg_id || "");
  return mrInfo.isMultiroom || rxIds.length > 1;
}

function _closeYsfDgIdPresetsMenus() {
  document.querySelectorAll(".ysf-dgid-presets-menu").forEach(el => el.remove());
}

function _openYsfDgIdPresetsMenu(anchorBtn, cid, card, targetHs) {
  const existing = document.querySelector(".ysf-dgid-presets-menu");
  const sameAnchor = existing && existing._anchorBtn === anchorBtn;
  _closeYsfDgIdPresetsMenus();
  if (sameAnchor) return;

  const mrInfo = _getYsfHsMultiroomInfo(targetHs);
  const curRx = String(targetHs.ysf_dg_id || (mrInfo.isMultiroom ? YSF_STARTER_DG_ID_OPT : "00")).trim();
  const menu = document.createElement("div");
  menu.className = "ysf-dgid-presets-menu";
  menu._anchorBtn = anchorBtn;

  const titleEl = document.createElement("div");
  titleEl.className = "ysf-dgid-presets-title";
  titleEl.textContent = mrInfo.isMultiroom
    ? (window.t ? window.t("ysf.dgid_presets_title_hub", { kind: mrInfo.kind || "Hub" }, `${mrInfo.kind || "Hub"} DG-ID subscription (YSFO):`) : `${mrInfo.kind || "Hub"} DG-ID subscription (YSFO):`)
    : (window.t ? window.t("ysf.dgid_presets_title_rx", {}, "RX DG-ID subscription (YSFO):") : "RX DG-ID subscription (YSFO):");
  menu.appendChild(titleEl);

  const btn12 = document.createElement("button");
  btn12.type = "button";
  btn12.className = "btn-ysf-preset-wide";
  btn12.textContent = window.t ? window.t("ysf.dgid_preset_12_btn", {}, "★ 12 popular (01..90;)") : "★ 12 popular (01..90;)";
  btn12.addEventListener("click", async () => {
    _closeYsfDgIdPresetsMenus();
    const r = await applyYsfDgIdLive(cid, { rx_dg_id: YSF_STARTER_DG_ID_OPT }, card);
    if (r.ok && typeof showToast === "function") {
      showToast(window.t ? window.t("ysf.ysfo_updated_12", {}, "✓ YSFO updated: subscribed to 12 popular DG-IDs") : "✓ YSFO updated: subscribed to 12 popular DG-IDs", "success", card);
    }
  });
  menu.appendChild(btn12);

  const btnAll = document.createElement("button");
  btnAll.type = "button";
  btnAll.className = "btn-ysf-preset-wide";
  btnAll.textContent = mrInfo.isMultiroom
    ? (window.t ? window.t("ysf.dgid_all_unsupported", {}, "00 — ALL (not supported in YCS/FCS/DG-ID)") : "00 — ALL (not supported in YCS/FCS/DG-ID)")
    : (window.t ? window.t("ysf.dgid_all_listen", {}, "00 — Listen to all channels (ALL)") : "00 — Listen to all channels (ALL)");
  btnAll.disabled = mrInfo.isMultiroom;
  btnAll.addEventListener("click", async () => {
    _closeYsfDgIdPresetsMenus();
    const r = await applyYsfDgIdLive(cid, { rx_dg_id: "00", tx_dg_id: null }, card);
    if (r.ok && typeof showToast === "function") {
      showToast(window.t ? window.t("ysf.ysfo_updated_all", {}, "✓ YSFO updated: mode 00 (ALL)") : "✓ YSFO updated: mode 00 (ALL)", "success", card);
    }
  });
  menu.appendChild(btnAll);

  const grid = document.createElement("div");
  grid.className = "ysf-dgid-presets-grid";
  const curParsed = _parseYsfDgIdList(curRx);
  for (const dStr of YSF_STARTER_DG_IDS) {
    const num = parseInt(dStr, 10);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-ysf-preset-num" + (curParsed.length === 1 && curParsed[0] === num ? " is-active" : "");
    btn.textContent = dStr;
    btn.title = window.t ? window.t("ysf.dgid_listen_only_title", { id: dStr }, `Listen only to DG-ID ${dStr}`) : `Listen only to DG-ID ${dStr}`;
    btn.addEventListener("click", async () => {
      _closeYsfDgIdPresetsMenus();
      const r = await applyYsfDgIdLive(cid, { rx_dg_id: `${dStr};` }, card);
      if (r.ok && typeof showToast === "function") {
        showToast(window.t ? window.t("ysf.ysfo_updated_single", { id: dStr }, `✓ YSFO updated: RX DG-ID ${dStr}`) : `✓ YSFO updated: RX DG-ID ${dStr}`, "success", card);
      }
    });
    grid.appendChild(btn);
  }
  menu.appendChild(grid);

  document.body.appendChild(menu);
  const rect = anchorBtn.getBoundingClientRect();
  const mw = menu.offsetWidth || 266;
  const mh = menu.offsetHeight || 220;
  let left = Math.max(8, Math.min(window.innerWidth - mw - 8, rect.right - mw));
  let top = (rect.bottom + mh + 10 <= window.innerHeight) ? (rect.bottom + 4) : Math.max(8, rect.top - mh - 4);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;

  const onOutside = (ev) => {
    if (!menu.contains(ev.target) && ev.target !== anchorBtn) {
      _closeYsfDgIdPresetsMenus();
      document.removeEventListener("pointerdown", onOutside, true);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0);
}

export function closeYsfTxDgIdModal() {
  const modal = document.getElementById("ysfTxDgIdModal");
  if (!modal) return;
  modal.classList.remove("active");
}

export function openYsfTxDgIdModal(cid) {
  const modal = document.getElementById("ysfTxDgIdModal");
  if (!modal) return;
  const resId = resolveHotspotId(cid || window.activeHotspotId || "default");
  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
  const targetHs = curHsList.find(h => h && (h.id === resId || h.id === cid)) || curHsList[0];
  if (!targetHs) return;

  const card = document.querySelector(`.radio-container[data-hotspot-id="${targetHs.id}"]`) || document.getElementById("radioContainer");
  const roomId = String(targetHs.ysf_room || targetHs.ysf_room_id || "25000").trim();
  const roomName = String(targetHs.ysf_name || targetHs.ysf_room_name || `YSF #${roomId}`).trim();
  const mrInfo = _getYsfHsMultiroomInfo(targetHs);

  const hubBadge = document.getElementById("ysfTxDgIdHubBadge");
  if (hubBadge) {
    hubBadge.style.display = mrInfo.isMultiroom ? "inline-flex" : "none";
    hubBadge.classList.toggle("is-multi-standard", mrInfo.reflectorType === "multi_standard");
    hubBadge.classList.toggle("is-multi-mutant", mrInfo.reflectorType === "multi_mutant");
    hubBadge.textContent = `${mrInfo.kind || "MULTI"} · 01–99`;
  }
  const subEl = document.getElementById("ysfTxDgIdRoomSubtitle");
  if (subEl) {
    subEl.textContent = window.t
      ? window.t("ysf.tx_dgid_subtitle_dynamic", { id: roomId, name: roomName }, `#${roomId} ${roomName} — which DG-ID would you like to transmit on?`)
      : `#${roomId} ${roomName} — which DG-ID would you like to transmit on?`;
  }

  const lastRxWrap = document.getElementById("ysfTxDgIdLastRxWrap");
  const lastRxDg = Number(targetHs._ysfLastRxDgId || targetHs.ysf_rx_dg_id || 0);
  const lastRxCaller = String(targetHs._ysfLastRxCaller || "").trim();
  if (lastRxWrap) {
    lastRxWrap.innerHTML = "";
    if (lastRxDg >= 1 && lastRxDg <= 99) {
      lastRxWrap.style.display = "";
      const btnLast = document.createElement("button");
      btnLast.type = "button";
      btnLast.className = "btn-ysf-tx-lastrx";
      const dgStr = String(lastRxDg).padStart(2, "0");
      btnLast.textContent = lastRxCaller
        ? (window.t ? window.t("ysf.tx_dgid_reply_caller", { caller: lastRxCaller, dgid: dgStr }, `🎙️ Reply to ${lastRxCaller} on DG-ID ${dgStr}`) : `🎙️ Reply to ${lastRxCaller} on DG-ID ${dgStr}`)
        : (window.t ? window.t("ysf.tx_dgid_reply_active", { dgid: dgStr }, `🎙️ Reply to active RX DG-ID ${dgStr}`) : `🎙️ Reply to active RX DG-ID ${dgStr}`);
      btnLast.addEventListener("click", () => _selectTxDgId(lastRxDg));
      lastRxWrap.appendChild(btnLast);
    } else {
      lastRxWrap.style.display = "none";
    }
  }

  const curTx = Number(targetHs.ysf_tx_dg_id || 0);
  const rxIds = _parseYsfDgIdList(targetHs.ysf_dg_id || "");
  const rxSet = new Set(rxIds);
  const gridSet = new Set(rxIds);
  for (const s of YSF_STARTER_DG_IDS) gridSet.add(parseInt(s, 10));
  if (curTx >= 1 && curTx <= 99) gridSet.add(curTx);
  if (lastRxDg >= 1 && lastRxDg <= 99) gridSet.add(lastRxDg);
  const sortedGridIds = Array.from(gridSet).sort((a, b) => a - b);

  async function _selectTxDgId(chosenNum) {
    const num = parseInt(chosenNum, 10);
    if (isNaN(num) || num < 1 || num > 99) {
      if (typeof showToast === "function") showToast(window.t ? window.t("ysf.tx_dgid_invalid", {}, "Enter a valid DG-ID from 01 to 99") : "Enter a valid DG-ID from 01 to 99", "error");
      return;
    }
    closeYsfTxDgIdModal();
    const r = await applyYsfDgIdLive(targetHs.id, { tx_dg_id: num }, card);
    if (r.ok && typeof showToast === "function") {
      const dgPad = String(num).padStart(2, "0");
      showToast(window.t ? window.t("ysf.tx_dgid_selected", { dgid: dgPad, room: roomId }, `✓ TX DG-ID ${dgPad} selected for #${roomId} — press PTT to transmit`) : `✓ TX DG-ID ${dgPad} selected for #${roomId} — press PTT to transmit`, "success", 3200);
    }
  }

  const gridEl = document.getElementById("ysfTxDgIdGrid");
  if (gridEl) {
    gridEl.innerHTML = "";
    for (const num of sortedGridIds) {
      const dgStr = String(num).padStart(2, "0");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-ysf-tx-pick" + (num === curTx ? " is-selected" : "");
      const subLbl = num === curTx
        ? (window.t ? window.t("ysf.tx_dgid_tx_active", {}, "TX active") : "TX active")
        : (rxSet.has(num) ? (window.t ? window.t("ysf.tx_dgid_listening", {}, "Listening ✓") : "Listening ✓") : "DG-ID");
      btn.innerHTML = `<strong>${dgStr}</strong><small>${safeEscapeHtml(subLbl)}</small>`;
      btn.addEventListener("click", () => _selectTxDgId(num));
      gridEl.appendChild(btn);
    }
  }

  const customInp = document.getElementById("ysfTxDgIdCustomInput");
  if (customInp) {
    customInp.value = (curTx >= 1 && curTx <= 99) ? String(curTx).padStart(2, "0") : "";
  }
  const btnCustom = document.getElementById("btnYsfTxDgIdCustomApply");
  if (btnCustom) {
    btnCustom.onclick = () => {
      if (customInp) _selectTxDgId(customInp.value);
    };
  }
  if (customInp) {
    customInp.onkeydown = (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        _selectTxDgId(customInp.value);
      }
    };
  }

  const btnClear = document.getElementById("btnYsfTxDgIdClear");
  if (btnClear) {
    btnClear.style.display = (curTx >= 1 && curTx <= 99) ? "" : "none";
    btnClear.onclick = async () => {
      closeYsfTxDgIdModal();
      const r = await applyYsfDgIdLive(targetHs.id, { tx_dg_id: null }, card);
      if (r.ok && typeof showToast === "function") {
        showToast(window.t ? window.t("ysf.tx_dgid_cleared", {}, "TX DG-ID cleared — you will be asked to choose an ID before transmitting") : "TX DG-ID cleared — you will be asked to choose an ID before transmitting", "info", card);
      }
    };
  }

  const btnCloseX = document.getElementById("closeYsfTxDgIdModalBtn");
  const btnCancel = document.getElementById("btnYsfTxDgIdCancel");
  if (btnCloseX) btnCloseX.onclick = closeYsfTxDgIdModal;
  if (btnCancel) btnCancel.onclick = closeYsfTxDgIdModal;
  modal.onclick = (ev) => {
    if (ev.target === modal) closeYsfTxDgIdModal();
  };

  modal.classList.add("active");
}

export function syncCardYsfDgIdBar(card, hs = null) {
  if (!card) return;
  const targetHs = hs || (card.dataset.hotspotId ? (getCurrentHotspots().find(h => h.id === card.dataset.hotspotId) || null) : null) || (getCurrentHotspots()[0] || null);
  const bar = card.querySelector(".ysf-dgid-bar");
  if (!bar) return;

  const isYsfNet = ((targetHs && targetHs.network_type) || card.dataset.networkType || "bm").toLowerCase() === "ysf";
  if (!isYsfNet || !targetHs) {
    bar.style.setProperty("display", "none", "important");
    return;
  }
  bar.style.removeProperty("display");

  const cid = targetHs.id || card.dataset.hotspotId || "default";
  const mrInfo = _getYsfHsMultiroomInfo(targetHs);
  bar.classList.toggle("is-multiroom", mrInfo.isMultiroom);
  bar.classList.toggle("is-multi-standard", mrInfo.reflectorType === "multi_standard");
  bar.classList.toggle("is-multi-mutant", mrInfo.reflectorType === "multi_mutant");

  const hubTag = bar.querySelector(".ysf-dgid-hub-tag");
  if (hubTag) {
    hubTag.textContent = mrInfo.isMultiroom ? `${mrInfo.kind || "YCS"} 01-99` : "DG-ID";
    hubTag.title = mrInfo.reflectorType === "multi_mutant"
      ? (window.t ? window.t("ysf.dgid_hub_mutant_title", { kind: mrInfo.kind || "DG-ID" }, `Non-standard multi-room reflector (${mrInfo.kind || "DG-ID"} mutant): DG-ID 01–99 subscription (YSFO)`) : `Non-standard multi-room reflector (${mrInfo.kind || "DG-ID"} mutant): DG-ID 01–99 subscription (YSFO)`)
      : (mrInfo.isMultiroom
        ? (window.t ? window.t("ysf.dgid_hub_standard_title", { kind: mrInfo.kind || "YCS" }, `Standard multi-room hub ${mrInfo.kind || "YCS"}: DG-ID 01–99 subscription (YSFO)`) : `Standard multi-room hub ${mrInfo.kind || "YCS"}: DG-ID 01–99 subscription (YSFO)`)
        : (window.t ? window.t("ysf.dgid_single_title", {}, "DG-ID channel mode (YSFO)") : "DG-ID channel mode (YSFO)"));
  }

  const liveRxEl = bar.querySelector(".ysf-rx-dgid-live");
  const rxLiveId = Number(targetHs.ysf_rx_dg_id || 0);
  if (liveRxEl) {
    if (targetHs._ysfCarrierRx && rxLiveId >= 1 && rxLiveId <= 99) {
      liveRxEl.style.display = "";
      liveRxEl.textContent = `RX:${String(rxLiveId).padStart(2, "0")}`;
    } else {
      liveRxEl.style.display = "none";
    }
  }

  const rxInput = bar.querySelector(".ysf-dgid-rx-input");
  const rxVal = String(targetHs.ysf_dg_id || (mrInfo.isMultiroom ? YSF_STARTER_DG_ID_OPT : "00")).trim();
  if (rxInput && document.activeElement !== rxInput) {
    rxInput.value = rxVal;
  }

  const txBtn = bar.querySelector(".btn-ysf-tx-dgid");
  const txValSpan = bar.querySelector(".ysf-tx-dgid-val");
  if (txBtn && txValSpan) {
    const txVal = Number(targetHs.ysf_tx_dg_id || 0);
    const rxList = _parseYsfDgIdList(rxVal);
    const needsPrompt = (mrInfo.isMultiroom || rxList.length > 1) && !(txVal >= 1 && txVal <= 99);
    txBtn.classList.toggle("is-tx-set", txVal >= 1 && txVal <= 99);
    txBtn.classList.toggle("needs-tx-choice", needsPrompt);
    if (txVal >= 1 && txVal <= 99) {
      txValSpan.textContent = String(txVal).padStart(2, "0");
    } else if (needsPrompt) {
      txValSpan.textContent = "?";
    } else {
      txValSpan.textContent = "00";
    }
  }

  if (!bar._ysfDgIdWired) {
    bar._ysfDgIdWired = true;
    const commitRx = async () => {
      if (!rxInput) return;
      const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
      const val = rxInput.value.trim();
      const res = await applyYsfDgIdLive(curCid, { rx_dg_id: val }, card);
      if (res.ok && typeof showToast === "function") {
        const shown = String(res.data?.rx_dg_id || val || "00").replace(/;+$/, "");
        showToast(window.t ? window.t("ysf.ysfo_sent_live", { dgid: shown }, `✓ YSFO sent without reconnect: DG-ID ${shown}`) : `✓ YSFO sent without reconnect: DG-ID ${shown}`, "success", card);
      }
    };
    const btnApply = bar.querySelector(".btn-ysf-dgid-apply");
    const btnPresets = bar.querySelector(".btn-ysf-dgid-presets");
    if (btnApply) {
      btnApply.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        commitRx();
      });
    }
    if (rxInput) {
      rxInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          commitRx();
        }
      });
    }
    if (btnPresets) {
      btnPresets.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
        const curHs = (getCurrentHotspots().find(h => h && h.id === curCid)) || targetHs;
        _openYsfDgIdPresetsMenu(btnPresets, curCid, card, curHs);
      });
    }
    if (txBtn) {
      txBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
        openYsfTxDgIdModal(curCid);
      });
    }
  }
}

export function updateCardYsfPanel(card, hs) {
  if (!card) return;
  const targetHs = hs || (card.dataset.hotspotId ? (getCurrentHotspots().find(h => h.id === card.dataset.hotspotId) || null) : null) || (getCurrentHotspots()[0] || null);
  const isYsfNet = ((targetHs && targetHs.network_type) || card.dataset.networkType || "bm").toLowerCase() === "ysf";
  card.classList.toggle("card-net-ysf", isYsfNet);
  syncCardYsfDgIdBar(card, targetHs);
  if (typeof updateCardM17Panel === "function") {
    updateCardM17Panel(card, targetHs);
  }
  if (typeof updateCardDstarPanel === "function") {
    updateCardDstarPanel(card, targetHs);
  }
  if (typeof updateCardSvxPanel === "function") {
    updateCardSvxPanel(card, targetHs);
  }
  if (!isYsfNet) {
    const existingYsfRow = card.querySelector(".vfo-ysf-row");
    if (existingYsfRow) existingYsfRow.style.setProperty("display", "none", "important");
    const orphanDashPair = card.querySelector(".vfo-ts1-row .ysf-dash-pair");
    if (orphanDashPair) orphanDashPair.remove();
    const btnContactsRestore = card.querySelector("#btnMyContactsMain") || card.querySelector(".btn-my-contacts");
    if (btnContactsRestore && !card.classList.contains("card-net-allstar")) {
      const lblRestore = btnContactsRestore.querySelector(".ptt-side-label");
      if (lblRestore) {
        lblRestore.textContent = window.t ? window.t("contacts.button_label", {}, "Контакты") : "Контакты";
        lblRestore.setAttribute("data-i18n", "contacts.button_label");
      }
      btnContactsRestore.title = window.t ? window.t("contacts.btn_title", {}, "Контакты и группы (телефонная книга DMR ID и TG)") : "Контакты и группы (телефонная книга DMR ID и TG)";
      btnContactsRestore.setAttribute("data-i18n-title", "contacts.btn_title");
    }
    return;
  }

  card.dataset.networkType = "ysf";
  const cid = (targetHs && targetHs.id) || card.dataset.hotspotId || "default";

  // Скрываем TS2 и API rows (YSF — симплекс без слотов, панель активности TS1 должна быть ВСЕГДА видима)
  const vfoTs1 = card.querySelector(".vfo-ts1-row");
  const vfoTs2 = card.querySelector(".vfo-ts2-row");
  const apiRow = card.querySelector(".api-status-row");
  if (vfoTs1) vfoTs1.style.removeProperty("display");
  if (vfoTs2) vfoTs2.style.setProperty("display", "none", "important");
  if (apiRow) apiRow.style.setProperty("display", "none", "important");

  // Обновляем строку статуса экрана (флаг, ID, название рефлектора)
  updateYsfVfoHeader(card, targetHs);

  // 1. Создаем или находим vfoYsf row
  let vfoYsf = card.querySelector(".vfo-ysf-row");
  if (!vfoYsf) {
    vfoYsf = document.createElement("div");
    vfoYsf.className = "vfo-row vfo-ysf-row card-net-ysf";
    if (vfoTs2 && vfoTs2.parentElement) {
      vfoTs2.parentElement.insertBefore(vfoYsf, vfoTs2);
    } else {
      const screenEl = card.querySelector(".radio-screen") || card;
      screenEl.appendChild(vfoYsf);
    }
  } else {
    vfoYsf.style.removeProperty("display");
  }

  // 2. Данные активной комнаты (при Standby / отключении — пусто, без ложного фолбэка на #25000)
  const isOnlineYsf = Boolean(targetHs && isYsfOnlineStatus(targetHs.status));
  const rawRoomId = String((targetHs && (targetHs.ysf_room || targetHs.ysf_room_id || targetHs.config?.ysf_room || targetHs.room_id)) || "").trim();
  const activeRoomId = (isOnlineYsf && rawRoomId) ? rawRoomId : "";
  const activeRoomName = activeRoomId
    ? String((targetHs && (targetHs.ysf_name || targetHs.ysf_room_name || targetHs.config?.ysf_name)) || `YSF #${activeRoomId}`).trim()
    : (window.t ? window.t("ysf.standby_desc", {}, "Отключён (STANDBY)") : "Отключён (STANDBY)");

  // 3. Быстрый ввод ID и кнопка PTT
  const quickInp = card.querySelector(".quick-tg-input");
  const quickBox = card.querySelector(".quick-tg-box");
  const quickApply = card.querySelector(".btn-quick-tg-apply");
  const ysfDialTip = window.t ? window.t("ysf.quick_dial_tip", {}, "Быстрый переход в комнату YSF по номеру ID (Enter для подключения)") : "Быстрый переход в комнату YSF по номеру ID (Enter для подключения)";
  if (quickInp) {
    quickInp.placeholder = "ID #";
    quickInp.maxLength = 5;
    quickInp.setAttribute("title", ysfDialTip);
    quickInp.setAttribute("data-i18n-title", "ysf.quick_dial_tip");
  }
  if (quickBox) {
    quickBox.setAttribute("title", ysfDialTip);
    quickBox.setAttribute("data-i18n-title", "ysf.quick_dial_tip");
  }
  if (quickApply) {
    quickApply.setAttribute("title", ysfDialTip);
    quickApply.setAttribute("data-i18n-title", "ysf.quick_dial_tip");
  }

  const pttTargetInfo = card.querySelector("#pttTargetInfo") || card.querySelector(".ptt-target-info");
  const pttTargetDesc = card.querySelector("#pttTargetDesc") || card.querySelector(".ptt-target-desc");
  if (pttTargetInfo) pttTargetInfo.textContent = activeRoomId ? `#${activeRoomId}` : "#---";
  if (pttTargetDesc) pttTargetDesc.textContent = activeRoomName;

  // 4. Кнопка «Контакты» -> «Избранное» (с синхронизацией data-i18n и без перекрытия обработчиков)
  const btnContacts = card.querySelector("#btnMyContactsMain") || card.querySelector(".btn-my-contacts");
  if (btnContacts) {
    const lbl = btnContacts.querySelector(".ptt-side-label");
    if (lbl) {
      lbl.textContent = window.t ? window.t("contacts.ysf_bookmarks", {}, "Избранное") : "Избранное";
      lbl.setAttribute("data-i18n", "contacts.ysf_bookmarks");
    }
    btnContacts.title = window.t ? window.t("contacts.ysf_bookmarks_title", {}, "Избранные комнаты YSF") : "Избранные комнаты YSF";
    btnContacts.setAttribute("data-i18n-title", "contacts.ysf_bookmarks_title");
    btnContacts.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.openMyContactsModal === "function") {
        window.openMyContactsModal(cid, "ysf_bookmarks");
      }
    };
  }

  // 5. Загружаем память комнат
  const rooms = getYsfMatrixRooms(cid);
  const ysfCurPage = getYsfMatrixPage(cid, targetHs);

  const prevSlider = vfoYsf.querySelector(".ysf-slider-container");
  const wasTextView = prevSlider ? prevSlider.classList.contains("is-text-view") : false;
  const prevStreamEl = vfoYsf.querySelector(".ysf-caption-stream");
  const prevStreamNodes = prevStreamEl ? Array.from(prevStreamEl.childNodes) : [];
  const prevStreamEntries = prevStreamEl && Array.isArray(prevStreamEl._entries) ? prevStreamEl._entries : null;
  const prevLastCallKey = prevStreamEl ? prevStreamEl._lastCallKey : null;
  const prevLastCallId = prevStreamEl ? prevStreamEl._lastCallId : null;
  const prevLastMsgTime = prevStreamEl ? prevStreamEl._lastMsgTime : null;
  const prevBoxEl = vfoYsf.querySelector(".asl-live-caption-box");
  const prevUserScrolled = prevBoxEl ? Boolean(prevBoxEl._isUserScrolled) : false;
  const prevScanPopover = vfoYsf.querySelector(".asl-scan-settings-popover");

  const scanBtnTitle = window.t ? window.t("ysf.scan_btn_title", {}, "Клик: запуск/остановка сканирования комнат (Scan: ON). Удержание: настройки") : "Клик: запуск/остановка сканирования комнат (Scan: ON). Удержание: настройки";
  const unlinkTitle = window.t ? window.t("ysf.unlink_title", {}, "Отключиться от комнаты YSF (Off). Удержание: меню памяти ячеек") : "Отключиться от комнаты YSF (Off). Удержание: меню памяти ячеек";
  const diceBtnTitle = window.t ? window.t("ysf.dice_btn_title", {}, "Случайная активная комната YSF (Dice). Удержание: настройки") : "Случайная активная комната YSF (Dice). Удержание: настройки";
  const dashBtnTitle = window.t ? window.t("asl.dash_btn_title", {}, "Открыть / закрыть дашборд подключенного рефлектора (список участников и индикация говорящего)") : "Открыть / закрыть дашборд подключенного рефлектора (список участников и индикация говорящего)";
  const dashChkTitle = window.t ? window.t("asl.dash_auto_title", {}, "Автооткрытие дашборда при подключении к рефлектору") : "Автооткрытие дашборда при подключении к рефлектору";
  const dashBtnLabel = window.t ? window.t("asl.dash_btn_label", {}, "Дашборд") : "Дашборд";
  const isAutoOpen = isYsfDashAutoOpenEnabled(cid);

  vfoYsf.innerHTML = `
    <div class="asl-top-section ysf-top-section">
      <div class="allstar-top-left-actions ysf-top-left-actions">
        <button type="button" class="btn-allstar-scan btn-ysf-scan${targetHs && targetHs._ysfScanActive ? " scan-running" : ""}" title="${safeEscapeHtml(scanBtnTitle)}">
          <span class="asl-scan-dot"></span>
          <span class="asl-action-text">Scan</span>
        </button>
        <button type="button" class="btn-allstar-unlink btn-ysf-unlink" title="${safeEscapeHtml(unlinkTitle)}">
          <span class="asl-action-text">Off</span>
        </button>
        <button type="button" class="btn-allstar-dice btn-ysf-dice${targetHs && targetHs._ysfDiceRolling ? " dice-rolling" : ""}" title="${safeEscapeHtml(diceBtnTitle)}" aria-label="${safeEscapeHtml(diceBtnTitle)}">
          <svg class="asl-dice-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect class="dice-border" x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fill-opacity="0.14"/>
            <circle class="dice-dot dot-1" cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>
            <circle class="dice-dot dot-2" cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/>
            <circle class="dice-dot dot-3" cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
            <circle class="dice-dot dot-4" cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/>
            <circle class="dice-dot dot-5" cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/>
          </svg>
        </button>
      </div>
      <div class="vfo-pipeline-stage asl-pipeline-stage">
        <div class="vfo-pipeline-icon icon-mic" title="Speech transcription (ASR)" data-i18n-title="vfo.pipeline_asr_title">
          <svg class="pipeline-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor" fill-opacity="0.2"/>
            <line x1="9" y1="5" x2="15" y2="5"/>
            <line x1="9" y1="8" x2="15" y2="8"/>
            <path d="M5 10a7 7 0 0 0 14 0"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
          </svg>
        </div>
        <div class="vfo-pipeline-icon icon-trans" title="Text translation" data-i18n-title="vfo.pipeline_trans_title">
          <svg class="pipeline-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="17 1 21 5 17 9"/>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <polyline points="7 23 3 19 7 15"/>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
        </div>
        <div class="vfo-pipeline-icon icon-tts" title="Speech synthesis (TTS)" data-i18n-title="vfo.pipeline_tts_title">
          <svg class="pipeline-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" fill-opacity="0.25"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
        </div>
      </div>
      <div class="allstar-top-right-actions">
        <span class="vfo-tts-badge asl-top-badge" id="vfoYsfTtsBadge_${cid}" role="button" tabindex="0" title="Speech synthesis (TTS): click to toggle, hold to select voice" data-i18n-title="vfo.tts_single_title">
          <span class="tts-icon-spk">🔊</span>
          <span class="tts-lang-code">RUS</span>
        </span>
        <span class="vfo-lang-badge asl-top-badge" id="vfoYsfLangBadge_${cid}" role="button" tabindex="0" title="Transcriber: click to toggle, hold for settings" data-i18n-title="vfo.transcriber_single_title">
          <span class="lang-icon-mic">🎙️</span>
          <span class="lang-code-text">TXT</span>
        </span>
      </div>
    </div>

    <div class="asl-slider-container ysf-slider-container" id="ysfSliderContainer_${cid}">
      <div class="asl-text-panel ysf-text-panel" id="ysfTextPanel_${cid}" inert>
        <div class="asl-live-caption-box vfo-caption-box" id="ysfCaptionBox_${cid}" title="AI Speech Transcript" data-i18n-title="vfo.caption_box_title">
          <div class="vfo-caption-stream asl-caption-stream ysf-caption-stream" id="ysfCaptionStream_${cid}" data-i18n-empty="transcriber.waiting_speech" data-empty-text="🎙️ Waiting for speech..."></div>
        </div>
      </div>

      <div class="asl-dock-notch ysf-dock-notch" id="ysfDockNotch_${cid}" title="${window.t ? window.t("ysf.notch_title", {}, "Swipe down or click: transcript text") : "Swipe down or click: transcript text"}" aria-label="${window.t ? window.t("ysf.notch_title", {}, "Swipe down or click: transcript text") : "Swipe down or click: transcript text"}" data-i18n-title="ysf.notch_title" data-i18n-aria-label="ysf.notch_title" role="button" tabindex="0">
        <span class="asl-notch-pages ysf-notch-pages" aria-hidden="true">${[0, 1, 2].map(pg => `<i class="asl-notch-seg ysf-notch-seg${pg === ysfCurPage ? " is-active" : ""}" data-page="${pg}"></i>`).join("")}</span>
        <span class="asl-notch-dash-badge ysf-notch-dash-badge" id="ysfNotchDashBadge_${cid}" aria-hidden="true">DASHBOARD 4×5</span>
      </div>

      <div class="asl-matrix-container ysf-matrix-container${targetHs && targetHs._ysfDashOpen ? " is-dash-view" : ""}" id="ysfMatrixContainer_${cid}">
        <div class="asl-pages-viewport ysf-pages-viewport" id="ysfPagesViewport_${cid}">
        ${[0, 1, 2].map(pg => {
          const pgPos = ((pg - ysfCurPage + 4) % 3) - 1;
          const isMoveModeActive = Boolean(targetHs && targetHs._ysfMovingIdx !== null && targetHs._ysfMovingIdx !== undefined);
          return `<div class="asl-matrix-grid asl-page ysf-matrix-grid ysf-page${isMoveModeActive ? " asl-matrix-move-mode" : ""}" data-page="${pg}" style="--asl-pos:${pgPos};"${pgPos !== 0 ? ' inert aria-hidden="true"' : ''}>
          ${rooms.slice(pg * YSF_PAGE_SIZE, (pg + 1) * YSF_PAGE_SIZE).map((rItem, li) => {
            const idx = pg * YSF_PAGE_SIZE + li;
            const isEmpty = !rItem || !rItem.room;
            const cleanRoom = !isEmpty ? String(rItem.room).trim() : "";
            const isConn = !isEmpty && Boolean(targetHs && targetHs._ysfConnectingRoom && cleanRoom === String(targetHs._ysfConnectingRoom).trim());
            const isDisc = !isEmpty && Boolean(targetHs && targetHs._ysfDisconnectingRoom && (cleanRoom === String(targetHs._ysfDisconnectingRoom).trim() || targetHs._ysfDisconnectingRoom === "all"));
            const isActive = !isEmpty && !isDisc && Boolean(activeRoomId) && cleanRoom === activeRoomId && isOnlineYsf;
            const isScanOn = Boolean(rItem && rItem.scan && !isEmpty);

            let rFlag = isEmpty ? "➕" : (rItem.flag || "🌐");
            if (!isEmpty && (rFlag === "➕" || rFlag === "🌐")) {
              const detected = detectYsfCountryFlag(cleanRoom, rItem.label);
              if (detected && detected.flag && detected.flag !== "➕") {
                rFlag = detected.flag;
                rItem.flag = rFlag;
              }
            }

            const rNum = cleanRoom ? safeEscapeHtml(cleanRoom) : (window.t ? window.t("asl.empty_node_btn", {}, "Empty") : "Empty");
            const setupLbl = window.t ? window.t("asl.configure_node_btn", {}, "[setup]") : "[setup]";
            const rDesc = (rItem && rItem.label) ? safeEscapeHtml(rItem.label) : (isEmpty ? safeEscapeHtml(setupLbl) : "");

            const isMovingSource = (isMoveModeActive && targetHs._ysfMovingIdx === idx);
            const isMoveTarget = (isMoveModeActive && !isMovingSource);

            const cellTypeInfo = !isEmpty
              ? resolveYsfMatrixCellTypeInfo(cleanRoom, rItem, targetHs)
              : { reflectorType: "single", isMultiroom: false, kind: "" };
            const cellType = cellTypeInfo.reflectorType || "single";
            const cellKind = cellTypeInfo.kind || (cellType === "multi_mutant" ? "PYSF3" : "YCS");

            let typeTitleSuffix = "";
            let typeDotHtml = "";
            let cellTypeCls = "";
            if (!isEmpty) {
              if (cellType === "multi_standard") {
                cellTypeCls = " ysf-cell-type-standard";
                typeTitleSuffix = ` · ${window.t ? window.t("ysf.cell_tip_standard", { kind: cellKind }, `Standard multi-room hub (${cellKind} · DG-ID 01–99)`) : `Standard multi-room hub (${cellKind} · DG-ID 01–99)`}`;
                typeDotHtml = '<span class="ysf-cell-type-dot ysf-cell-type-dot--standard" aria-hidden="true"></span>';
              } else if (cellType === "multi_mutant") {
                cellTypeCls = " ysf-cell-type-mutant";
                typeTitleSuffix = ` · ${window.t ? window.t("ysf.cell_tip_mutant", { kind: cellKind }, `Non-standard multi-room reflector (mutant ${cellKind} / DG-ID)`) : `Non-standard multi-room reflector (mutant ${cellKind} / DG-ID)`}`;
                typeDotHtml = '<span class="ysf-cell-type-dot ysf-cell-type-dot--mutant" aria-hidden="true"></span>';
              } else {
                typeTitleSuffix = ` · ${window.t ? window.t("ysf.cell_tip_single", {}, "Single-room reflector (DG-ID 00)") : "Single-room reflector (DG-ID 00)"}`;
              }
            }

            let titleTip = isEmpty
              ? (window.t ? window.t("ysf.empty_cell_title", { idx: idx + 1 }, `Cell #${idx + 1}: Empty — Click/Hold: configure`) : `Cell #${idx + 1}: Empty — Click/Hold: configure`)
              : (window.t ? window.t("ysf.room_cell_title", { room: cleanRoom, desc: rDesc, suffix: typeTitleSuffix }, `Room #${cleanRoom} (${rDesc})${typeTitleSuffix} — Click: connect, Right click / Hold: menu`) : `Room #${cleanRoom} (${rDesc})${typeTitleSuffix} — Click: connect, Right click / Hold: menu`);
            if (isMovingSource) {
              titleTip = window.t ? window.t("ysf.move_source_title", { room: cleanRoom }, `Moving #${cleanRoom}... Click target cell`) : `Moving #${cleanRoom}... Click target cell`;
            } else if (isMoveTarget) {
              const srcRoom = rooms[targetHs._ysfMovingIdx]?.room;
              titleTip = isEmpty
                ? (window.t ? window.t("ysf.move_to_empty", { room: srcRoom }, `Move #${srcRoom} here`) : `Move #${srcRoom} here`)
                : (window.t ? window.t("ysf.swap_with", { room: cleanRoom }, `Swap places with #${cleanRoom}`) : `Swap places with #${cleanRoom}`);
            }

            let stateCls = "";
            if (isActive) stateCls = " asl-node-linked-monitor active-room active-asl-node";
            else if (isConn) stateCls = " asl-node-connecting asl-node-connecting-monitor";
            else if (isDisc) stateCls = " asl-node-disconnecting";
            if (!isEmpty && targetHs && targetHs._ysfScanActive && targetHs._ysfScanningRoom && cleanRoom === String(targetHs._ysfScanningRoom).trim()) {
              stateCls += " asl-node-scanning-now ysf-node-scanning-now";
            }
            if (isMovingSource) stateCls += " asl-node-moving-source";
            if (isMoveTarget) stateCls += " asl-node-move-target";

            const rightClusterHtml = (isScanOn || typeDotHtml)
              ? `<span class="asl-btn-right-cluster">${isScanOn ? '<span class="asl-btn-scan-badge">S</span>' : ''}${typeDotHtml}</span>`
              : '';

            return `
              <button type="button" class="btn-allstar-node btn-ysf-room-cell${stateCls}${cellTypeCls}${isEmpty ? " asl-node-empty" : ""}${isScanOn ? " asl-node-scan-on" : ""}" data-room="${cleanRoom}" data-idx="${idx}" data-reflector-type="${cellType}" title="${safeEscapeHtml(titleTip)}">
                <div class="asl-btn-header">
                  <span class="asl-btn-flag">${rFlag}</span>
                  <strong class="asl-btn-num">${rNum}</strong>
                  ${rightClusterHtml}
                </div>
                <div class="asl-btn-footer">
                  <span class="asl-btn-conns asl-conns-hidden"></span>
                  <small class="asl-btn-desc">${rDesc}</small>
                </div>
              </button>
            `;
          }).join("")}
          </div>`;
        }).join("")}
        </div>
        <div class="asl-dash-grid-viewport ysf-dash-grid-viewport" id="ysfDashGridViewport_${cid}"></div>
      </div>
    </div>
  `;

  // Размещаем кнопку [Дашборд ☑] внутри верхнего баннера активности вызова (.vfo-ts1-row) справа снизу
  if (vfoTs1) {
    vfoTs1.querySelectorAll(".ysf-dash-pair").forEach(el => el.remove());
    const dashPairEl = document.createElement("div");
    dashPairEl.className = `control-pair-btn ysf-dash-pair allstar-dash-pair${targetHs && targetHs._ysfDashOpen ? " dash-open" : ""}`;
    dashPairEl.id = `ysfDashPair_${cid}`;
    dashPairEl.innerHTML = `
      <button type="button" class="btn-action-trigger btn-ysf-dash-trigger btn-asl-dash-trigger" title="${safeEscapeHtml(dashBtnTitle)}">
        <span class="btn-action-label">${safeEscapeHtml(dashBtnLabel)}</span>
      </button>
      <div class="preset-dropdown-wrapper ysf-dash-auto-wrap asl-dash-auto-wrap" title="${safeEscapeHtml(dashChkTitle)}">
        <label class="asl-dash-auto-label">
          <input type="checkbox" class="chk-ysf-dash-auto chk-asl-dash-auto"${isAutoOpen ? " checked" : ""} aria-label="${safeEscapeHtml(dashChkTitle)}" />
        </label>
      </div>
    `;
    vfoTs1.appendChild(dashPairEl);
  }

  // Настраиваем встраиваемый транскрибатор / TTS прямо в .vfo-ysf-row (как в AllStarLink)
  vfoYsf.setAttribute("data-slot", "1");
  setupSlotTranscribeClick(vfoYsf, 1);
  setupSlotTtsClick(vfoYsf, 1);
  const ysfTs1TranscribeActive = isSlotTranscribeActive(cid, 1);
  const ysfTs1TtsActive = isSlotTtsActive(cid, 1);
  vfoYsf.classList.toggle("has-transcribe", ysfTs1TranscribeActive);
  updateSlotLangBadge(vfoYsf, 1, ysfTs1TranscribeActive);
  updateSlotTtsBadge(vfoYsf, 1, ysfTs1TtsActive);

  if (prevStreamNodes.length > 0) {
    const nextStream = vfoYsf.querySelector(".ysf-caption-stream");
    if (nextStream) {
      prevStreamNodes.forEach(n => nextStream.appendChild(n));
      if (prevStreamEntries) nextStream._entries = prevStreamEntries;
      nextStream._lastCallKey = prevLastCallKey;
      nextStream._lastCallId = prevLastCallId;
      nextStream._lastMsgTime = prevLastMsgTime;
    }
  }

  const ysfCaptionBox = vfoYsf.querySelector(".asl-live-caption-box");
  if (ysfCaptionBox) {
    ysfCaptionBox._isUserScrolled = prevUserScrolled;
    ensureCaptionFontControls(ysfCaptionBox);
    setupCaptionBoxPinchZoom(ysfCaptionBox);
    if (typeof setupCaptionBoxLongPress === "function") {
      setupCaptionBoxLongPress(vfoYsf, 1);
    }
  }

  const sliderContainer = vfoYsf.querySelector(".ysf-slider-container");
  const textPanel = vfoYsf.querySelector(".ysf-text-panel");
  const dockNotch = vfoYsf.querySelector(".ysf-dock-notch");
  const matrixContainer = vfoYsf.querySelector(".ysf-matrix-container");

  const setYsfTextView = (isText) => {
    if (!sliderContainer) return;
    if (isText) {
      sliderContainer.classList.add("is-text-view");
      if (textPanel) textPanel.removeAttribute("inert");
      if (matrixContainer) matrixContainer.setAttribute("inert", "");
      if (dockNotch) {
        dockNotch.title = window.t ? window.t("ysf.notch_title_matrix", {}, "Свайп вверх или клик: Память комнат YSF") : "Свайп вверх или клик: Память комнат YSF";
        dockNotch.setAttribute("aria-label", dockNotch.title);
      }
    } else {
      sliderContainer.classList.remove("is-text-view");
      if (textPanel) textPanel.setAttribute("inert", "");
      if (matrixContainer) matrixContainer.removeAttribute("inert");
      if (dockNotch) {
        dockNotch.title = window.t ? window.t("ysf.notch_title", {}, "Свайп вниз или клик: текст транскрибации") : "Свайп вниз или клик: текст транскрибации";
        dockNotch.setAttribute("aria-label", dockNotch.title);
      }
    }
    if (vfoYsf) {
      vfoYsf.scrollTop = 0;
      vfoYsf.scrollLeft = 0;
    }
  };

  vfoYsf.setYsfTextView = setYsfTextView;
  setYsfTextView(Boolean(wasTextView || ysfTs1TranscribeActive));

  // Автоматическое переключение экрана при изменении статуса транскрибации (MutationObserver)
  if (vfoYsf._transcribeObserver) {
    try { vfoYsf._transcribeObserver.disconnect(); } catch (_) {}
  }
  let prevHasTranscribe = vfoYsf.classList.contains("has-transcribe");
  const ysfObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes" && m.attributeName === "class") {
        const curHasTranscribe = vfoYsf.classList.contains("has-transcribe");
        if (curHasTranscribe !== prevHasTranscribe) {
          prevHasTranscribe = curHasTranscribe;
          setYsfTextView(curHasTranscribe);
        }
      }
    }
  });
  ysfObserver.observe(vfoYsf, { attributes: true, attributeFilter: ["class"] });
  vfoYsf._transcribeObserver = ysfObserver;

  // Автоматическое переключение на панель текста при включении озвучки речи (TTS)
  const ysfTtsBadge = vfoYsf.querySelector(".vfo-tts-badge");
  if (ysfTtsBadge) {
    ysfTtsBadge.addEventListener("click", () => {
      setTimeout(() => {
        if (typeof isSlotTtsActive === "function" && isSlotTtsActive(cid, 1)) {
          setYsfTextView(true);
        }
      }, 60);
    });
  }

  // Защита от паразитного скролла контейнера VFO при Tab-навигации
  vfoYsf.scrollTop = 0;
  vfoYsf.scrollLeft = 0;
  if (!vfoYsf._ysfScrollGuardWired) {
    vfoYsf._ysfScrollGuardWired = true;
    vfoYsf.addEventListener("scroll", () => {
      if (vfoYsf.scrollTop !== 0) vfoYsf.scrollTop = 0;
      if (vfoYsf.scrollLeft !== 0) vfoYsf.scrollLeft = 0;
    }, { passive: true });
    vfoYsf.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const sc = vfoYsf.querySelector(".ysf-slider-container");
        if (sc && sc.classList.contains("is-text-view") && typeof vfoYsf.setYsfTextView === "function") {
          vfoYsf.setYsfTextView(false);
        }
      }
    });
  }

  // Pages layout & drag
  const pagesViewport = vfoYsf.querySelector(".ysf-pages-viewport");
  const pageEls = pagesViewport ? Array.from(pagesViewport.querySelectorAll(".ysf-page")) : [];
  const notchSegs = Array.from(vfoYsf.querySelectorAll(".ysf-notch-seg"));
  let ysfPage = ysfCurPage;

  const layoutYsfPages = (page, animate) => {
    pageEls.forEach((el, pg) => {
      const oldPos = parseInt(el.style.getPropertyValue("--asl-pos") || "0", 10);
      const newPos = ((pg - page + 4) % 3) - 1;
      const noAnim = !animate || Math.abs(newPos - oldPos) === 2;
      if (noAnim) el.classList.add("no-anim");
      el.style.setProperty("--asl-pos", String(newPos));
      el.toggleAttribute("inert", newPos !== 0);
      el.setAttribute("aria-hidden", newPos !== 0 ? "true" : "false");
      if (noAnim) {
        void el.offsetWidth;
        el.classList.remove("no-anim");
      }
    });
    notchSegs.forEach((seg, pg) => seg.classList.toggle("is-active", pg === page));
  };

  const resetYsfPagesDrag = () => {
    if (!pagesViewport) return;
    pagesViewport.classList.remove("is-dragging");
    pagesViewport.style.setProperty("--asl-drag", "0px");
  };

  const goYsfPage = (delta) => {
    if (!pagesViewport) return;
    ysfPage = setYsfMatrixPageValue(cid, targetHs, ysfPage + delta);
    document.querySelectorAll(".asl-card-edit-popover").forEach(el => el.remove());
    resetYsfPagesDrag();
    layoutYsfPages(ysfPage, true);
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try { navigator.vibrate(12); } catch (_) {}
    }
    probeYsfMatrixRooms(card, targetHs, false);
  };

  let wasSwipeGesture = false;
  let activeYsfPressTimer = null;
  const cancelActiveCellPress = () => {
    if (activeYsfPressTimer) {
      clearTimeout(activeYsfPressTimer);
      activeYsfPressTimer = null;
    }
  };

  // Notch clicks, keyboard and notch swipe
  if (dockNotch) {
    let notchStartY = 0;
    let isNotchTracking = false;

    dockNotch.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      isNotchTracking = true;
      notchStartY = e.clientY;
      try { dockNotch.setPointerCapture(e.pointerId); } catch (_) {}
    });
    dockNotch.addEventListener("pointermove", (e) => {
      if (!isNotchTracking) return;
      const dy = e.clientY - notchStartY;
      const isCurText = sliderContainer && sliderContainer.classList.contains("is-text-view");
      if (!isCurText && dy > 20) {
        isNotchTracking = false;
        wasSwipeGesture = true;
        setTimeout(() => { wasSwipeGesture = false; }, 320);
        try { dockNotch.releasePointerCapture(e.pointerId); } catch (_) {}
        setYsfTextView(true);
      } else if (isCurText && dy < -20) {
        isNotchTracking = false;
        wasSwipeGesture = true;
        setTimeout(() => { wasSwipeGesture = false; }, 320);
        try { dockNotch.releasePointerCapture(e.pointerId); } catch (_) {}
        setYsfTextView(false);
      }
    });
    dockNotch.addEventListener("pointerup", (e) => {
      isNotchTracking = false;
      try { dockNotch.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    dockNotch.addEventListener("pointercancel", (e) => {
      isNotchTracking = false;
      try { dockNotch.releasePointerCapture(e.pointerId); } catch (_) {}
    });

    dockNotch.addEventListener("click", (e) => {
      e.stopPropagation();
      if (wasSwipeGesture) return;
      const segTarget = e.target.closest(".ysf-notch-seg");
      if (segTarget && segTarget.dataset.page !== undefined) {
        const targetPg = parseInt(segTarget.dataset.page, 10);
        if (Number.isInteger(targetPg)) {
          ysfPage = setYsfMatrixPageValue(cid, targetHs, targetPg);
          layoutYsfPages(ysfPage, true);
          probeYsfMatrixRooms(card, targetHs, false);
        }
        return;
      }

      const dashBadge = e.target.closest(".ysf-notch-dash-badge");
      if (dashBadge) {
        if (targetHs) targetHs._ysfDashOpen = !targetHs._ysfDashOpen;
        renderYsfDashboard(card, targetHs, cid);
        return;
      }

      const isCurText = sliderContainer && sliderContainer.classList.contains("is-text-view");
      setYsfTextView(!isCurText);
    });
    dockNotch.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const isCurText = sliderContainer && sliderContainer.classList.contains("is-text-view");
        setYsfTextView(!isCurText);
      }
    });
  }

  // Horizontal (X -> pages) & Vertical (Y swipe down -> text panel) gestures on matrix
  if (matrixContainer) {
    let mStartX = 0;
    let mStartY = 0;
    let mTracking = false;
    let mCaptured = false;
    let mAxis = null;
    let mLastDx = 0;
    let mStartTs = 0;

    const startMatrixDrag = (clientY, clientX) => {
      mTracking = true;
      mCaptured = false;
      mAxis = null;
      mLastDx = 0;
      mStartTs = Date.now();
      mStartY = clientY;
      mStartX = clientX;
    };

    const moveMatrixDrag = (clientY, clientX, pointerId, targetEl) => {
      if (!mTracking) return;
      const rDx = clientX - mStartX;
      const rDy = clientY - mStartY;
      const adx = Math.abs(rDx);
      const ady = Math.abs(rDy);

      if (!mAxis && Math.max(adx, ady) > 12) {
        mAxis = adx > ady ? "x" : "y";
        cancelActiveCellPress();
        if (!mCaptured && targetEl && pointerId !== undefined) {
          mCaptured = true;
          try { targetEl.setPointerCapture(pointerId); } catch (_) {}
        }
        if (mAxis === "x" && pagesViewport) {
          pagesViewport.classList.add("is-dragging");
        }
      }

      if (mAxis === "x" && pagesViewport) {
        const w = pagesViewport.clientWidth || 1;
        mLastDx = Math.max(-w, Math.min(w, rDx));
        pagesViewport.style.setProperty("--asl-drag", mLastDx + "px");
        return;
      }

      if (mAxis === "y" && rDy > 25 && rDy > adx * 0.9) {
        mTracking = false;
        cancelActiveCellPress();
        wasSwipeGesture = true;
        setTimeout(() => { wasSwipeGesture = false; }, 320);
        if (targetEl && pointerId !== undefined) {
          try { targetEl.releasePointerCapture(pointerId); } catch (_) {}
        }
        setYsfTextView(true);
      }
    };

    const finishSwipe = (pointerId, targetEl) => {
      const wasTracking = mTracking;
      mTracking = false;
      if (mCaptured && targetEl && pointerId !== undefined) {
        try { targetEl.releasePointerCapture(pointerId); } catch (_) {}
      }
      mCaptured = false;

      if (wasTracking && mAxis === "x" && pagesViewport) {
        const w = pagesViewport.clientWidth || 1;
        const dt = Math.max(1, Date.now() - mStartTs);
        const absDx = Math.abs(mLastDx);
        const pass = absDx > w * 0.22 || ((absDx / dt) > 0.45 && absDx > 24);
        wasSwipeGesture = true;
        setTimeout(() => { wasSwipeGesture = false; }, 320);
        if (pass) {
          goYsfPage(mLastDx < 0 ? 1 : -1);
        } else {
          resetYsfPagesDrag();
        }
      }
      mAxis = null;
    };

    matrixContainer.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      startMatrixDrag(e.clientY, e.clientX);
    });
    matrixContainer.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse" && e.buttons === 0 && mTracking) {
        finishSwipe(e.pointerId, matrixContainer);
        return;
      }
      moveMatrixDrag(e.clientY, e.clientX, e.pointerId, matrixContainer);
    });
    matrixContainer.addEventListener("pointerup", (e) => finishSwipe(e.pointerId, matrixContainer));
    matrixContainer.addEventListener("pointercancel", (e) => finishSwipe(e.pointerId, matrixContainer));

    matrixContainer.addEventListener("touchstart", (e) => {
      if (e.touches && e.touches[0]) {
        startMatrixDrag(e.touches[0].clientY, e.touches[0].clientX);
      }
    }, { passive: true });
    matrixContainer.addEventListener("touchmove", (e) => {
      if (e.touches && e.touches[0]) {
        moveMatrixDrag(e.touches[0].clientY, e.touches[0].clientX);
      }
    }, { passive: true });
    matrixContainer.addEventListener("touchend", () => finishSwipe(), { passive: true });
    matrixContainer.addEventListener("touchcancel", () => finishSwipe(), { passive: true });
  }

  // Swipe UP on textPanel -> return to room matrix (with .caption-font-ctrl protection)
  if (textPanel) {
    let textStartY = 0;
    let textStartX = 0;
    let isTextTracking = false;

    const startTextDrag = (clientY, clientX) => {
      isTextTracking = true;
      textStartY = clientY;
      textStartX = clientX;
    };

    const moveTextDrag = (clientY, clientX, pointerId, targetEl) => {
      if (!isTextTracking) return;
      const dy = textStartY - clientY; // > 0 при движении вверх
      const dx = Math.abs(clientX - textStartX);
      if (dy > 25 && dy > dx * 0.9) {
        isTextTracking = false;
        wasSwipeGesture = true;
        setTimeout(() => { wasSwipeGesture = false; }, 320);
        if (targetEl && pointerId !== undefined) {
          try { targetEl.releasePointerCapture(pointerId); } catch (_) {}
        }
        setYsfTextView(false);
      }
    };

    const endTextDrag = (pointerId, targetEl) => {
      isTextTracking = false;
      if (targetEl && pointerId !== undefined) {
        try { targetEl.releasePointerCapture(pointerId); } catch (_) {}
      }
    };

    textPanel.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest(".caption-font-ctrl")) return;
      startTextDrag(e.clientY, e.clientX);
      try { textPanel.setPointerCapture(e.pointerId); } catch (_) {}
    });
    textPanel.addEventListener("pointermove", (e) => {
      moveTextDrag(e.clientY, e.clientX, e.pointerId, textPanel);
    });
    textPanel.addEventListener("pointerup", (e) => endTextDrag(e.pointerId, textPanel));
    textPanel.addEventListener("pointercancel", (e) => endTextDrag(e.pointerId, textPanel));

    textPanel.addEventListener("touchstart", (e) => {
      if (e.target && e.target.closest && e.target.closest(".caption-font-ctrl")) return;
      if (e.touches && e.touches[0]) {
        startTextDrag(e.touches[0].clientY, e.touches[0].clientX);
      }
    }, { passive: true });
    textPanel.addEventListener("touchmove", (e) => {
      if (e.touches && e.touches[0]) {
        moveTextDrag(e.touches[0].clientY, e.touches[0].clientX);
      }
    }, { passive: true });
    textPanel.addEventListener("touchend", () => endTextDrag(), { passive: true });
    textPanel.addEventListener("touchcancel", () => endTextDrag(), { passive: true });
  }

  // Room cells click, long press & context menu
  vfoYsf.querySelectorAll(".btn-ysf-room-cell").forEach(cellBtn => {
    const idx = parseInt(cellBtn.dataset.idx, 10);
    let pressTimer = null;
    let isLongPress = false;

    const startPress = () => {
      isLongPress = false;
      cancelActiveCellPress();
      pressTimer = setTimeout(() => {
        isLongPress = true;
        activeYsfPressTimer = null;
        const rId = cellBtn.dataset.room;
        if (!rId) {
          openYsfCardEditPopover({ idx, cid, card, targetHs, rooms });
        } else {
          openYsfCardContextMenu({ btn: cellBtn, idx, cid, card, targetHs, rooms });
        }
      }, 550);
      activeYsfPressTimer = pressTimer;
    };

    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        if (activeYsfPressTimer === pressTimer) {
          activeYsfPressTimer = null;
        }
        pressTimer = null;
      }
    };

    cellBtn.addEventListener("pointerdown", startPress);
    cellBtn.addEventListener("pointerup", cancelPress);
    cellBtn.addEventListener("pointerleave", cancelPress);
    cellBtn.addEventListener("pointercancel", cancelPress);

    cellBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelPress();
      if (isLongPress) return;
      const rId = cellBtn.dataset.room;
      if (!rId) {
        openYsfCardEditPopover({ idx, cid, card, targetHs, rooms });
      } else {
        openYsfCardContextMenu({ btn: cellBtn, idx, cid, card, targetHs, rooms });
      }
    });

    cellBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isLongPress || wasSwipeGesture) return;

      // Обработка режима перемещения (Move)
      if (targetHs && targetHs._ysfMovingIdx !== null && targetHs._ysfMovingIdx !== undefined) {
        clearYsfMoveCancelListener();
        const sourceIdx = Number(targetHs._ysfMovingIdx);
        const targetIdx = idx;
        targetHs._ysfMovingIdx = null;

        if (
          Number.isInteger(sourceIdx) &&
          sourceIdx >= 0 && sourceIdx < YSF_MEMORY_SIZE &&
          targetIdx >= 0 && targetIdx < YSF_MEMORY_SIZE &&
          sourceIdx !== targetIdx
        ) {
          const temp = rooms[sourceIdx];
          rooms[sourceIdx] = rooms[targetIdx];
          rooms[targetIdx] = temp;
          saveYsfMatrixRooms(cid, rooms);
          if (typeof showToast === "function") {
            const movedRoom = temp && temp.room ? `#${temp.room}` : (window.t ? window.t("ysf.slot_num_label", { num: sourceIdx + 1 }, `slot #${sourceIdx + 1}`) : `slot #${sourceIdx + 1}`);
            showToast(window.t ? window.t("ysf.room_moved_toast", { room: movedRoom, target: targetIdx + 1 }, `Room ${movedRoom} moved to slot #${targetIdx + 1}`) : `Room ${movedRoom} moved to slot #${targetIdx + 1}`, "info", 2000);
          }
        }
        updateCardYsfPanel(card, targetHs);
        return;
      }

      const rId = String(cellBtn.dataset.room || "").trim();
      if (!rId) {
        openYsfCardEditPopover({ idx, cid, card, targetHs, rooms });
        return;
      }

      const activeRoom = String((targetHs && (targetHs.ysf_room || targetHs.ysf_room_id)) || (card && card.dataset.ysfRoom) || "").trim();
      const connectingRoom = String((targetHs && targetHs._ysfConnectingRoom) || "").trim();
      const disconnectingRoom = String((targetHs && targetHs._ysfDisconnectingRoom) || "").trim();
      const isDisconnectingNow = Boolean(disconnectingRoom && (disconnectingRoom === rId || disconnectingRoom === "all"));
      const isCurrentlyConnected = !isDisconnectingNow && Boolean(
        (activeRoom && activeRoom === rId && targetHs && isYsfOnlineStatus(targetHs.status)) ||
        (connectingRoom && connectingRoom === rId)
      );

      if (isCurrentlyConnected) {
        if (targetHs && targetHs._ysfScanActive) {
          stopYsfMatrixScan(cid, card, targetHs, { keepCurrentLink: true, silent: true });
        }
        if (targetHs && targetHs._ysfDiceRolling) {
          stopYsfDiceSearch(cid, card, targetHs, { immediateAbort: true, silent: true });
        }
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try { navigator.vibrate(45); } catch (_) {}
        }
        ysfDisconnectProcedure(cid, card, { showStatusBanner: true });
        return;
      }

      const item = rooms[idx];
      if (typeof window.connectYsfRoomById === "function") {
        window.connectYsfRoomById(rId, (item && item.label) || "", card);
      }
    });
  });

  // Отмена режима перемещения карточки (Move) при клике вне матрицы
  clearYsfMoveCancelListener();
  if (targetHs && targetHs._ysfMovingIdx !== null && targetHs._ysfMovingIdx !== undefined) {
    const onMoveCancelClick = (e) => {
      if (!targetHs || targetHs._ysfMovingIdx === null || targetHs._ysfMovingIdx === undefined) {
        clearYsfMoveCancelListener();
        return;
      }
      if (!e.target.closest(".asl-matrix-grid") && !e.target.closest(".asl-card-context-menu")) {
        clearYsfMoveCancelListener();
        targetHs._ysfMovingIdx = null;
        updateCardYsfPanel(card, targetHs);
      }
    };
    const timerId = setTimeout(() => {
      document.addEventListener("click", onMoveCancelClick, true);
      _ysfMoveCancelDocListener = onMoveCancelClick;
    }, 100);
  }

  // Action: Scan
  const btnScan = vfoYsf.querySelector(".btn-ysf-scan");
  if (btnScan) {
    let scanHoldTimer = null;
    let scanLong = false;
    const cancelScanHold = () => {
      if (scanHoldTimer) {
        clearTimeout(scanHoldTimer);
        scanHoldTimer = null;
      }
    };
    btnScan.addEventListener("pointerdown", (e) => {
      if (e && e.button !== undefined && e.button !== 0) return;
      scanLong = false;
      cancelScanHold();
      scanHoldTimer = setTimeout(() => {
        scanLong = true;
        scanHoldTimer = null;
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try { navigator.vibrate([40, 30, 40]); } catch (_) {}
        }
        openYsfScanSettingsPopover({ cid, card, targetHs, anchorEl: btnScan });
      }, 550);
    });
    btnScan.addEventListener("pointerup", cancelScanHold);
    btnScan.addEventListener("pointerleave", cancelScanHold);
    btnScan.addEventListener("pointercancel", cancelScanHold);

    btnScan.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelScanHold();
      openYsfScanSettingsPopover({ cid, card, targetHs, anchorEl: btnScan });
    });

    btnScan.addEventListener("click", (e) => {
      e.stopPropagation();
      if (scanLong) {
        scanLong = false;
        return;
      }
      if (targetHs && targetHs._ysfScanActive) {
        stopYsfMatrixScan(cid, card, targetHs, { keepCurrentLink: true });
      } else {
        startYsfMatrixScan(cid, card, targetHs, rooms);
      }
    });
  }

  // Action: Off (Unlink)
  const btnOff = vfoYsf.querySelector(".btn-ysf-unlink");
  if (btnOff) {
    let offHoldTimer = null;
    let offLong = false;
    btnOff.addEventListener("pointerdown", () => {
      offLong = false;
      offHoldTimer = setTimeout(() => {
        offLong = true;
        openYsfMatrixManageModal(cid, card, targetHs, rooms);
      }, 550);
    });
    const cancelOffHold = () => {
      if (offHoldTimer) { clearTimeout(offHoldTimer); offHoldTimer = null; }
    };
    btnOff.addEventListener("pointerup", cancelOffHold);
    btnOff.addEventListener("pointerleave", cancelOffHold);
    btnOff.addEventListener("pointercancel", cancelOffHold);

    btnOff.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (offLong) return;
      if (targetHs && targetHs._ysfScanActive) {
        stopYsfMatrixScan(cid, card, targetHs, { keepCurrentLink: true, silent: true });
      }
      if (targetHs && targetHs._ysfDiceRolling) {
        stopYsfDiceSearch(cid, card, targetHs, { immediateAbort: true, silent: true });
      }
      await ysfDisconnectProcedure(cid, card);
    });
  }

  // Action: Dice (Случайный активный рефлектор: клик — старт/стоп, удержание/ПКМ — мини-настройки)
  const btnDice = vfoYsf.querySelector(".btn-ysf-dice");
  if (btnDice) {
    let diceHoldTimer = null;
    let diceLong = false;
    let diceDownX = 0;
    let diceDownY = 0;
    const cancelDiceHold = () => {
      if (diceHoldTimer) {
        clearTimeout(diceHoldTimer);
        diceHoldTimer = null;
      }
    };
    btnDice.addEventListener("pointerdown", (e) => {
      if (e && e.button !== undefined && e.button !== 0) return;
      diceLong = false;
      diceDownX = e.clientX || 0;
      diceDownY = e.clientY || 0;
      cancelDiceHold();
      diceHoldTimer = setTimeout(() => {
        diceLong = true;
        diceHoldTimer = null;
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try { navigator.vibrate([40, 30, 40]); } catch (_) {}
        }
        openYsfDiceSettingsPopover({ cid, card, targetHs, anchorEl: btnDice });
      }, 550);
    });
    btnDice.addEventListener("pointermove", (e) => {
      if (!diceHoldTimer) return;
      const dx = (e.clientX || 0) - diceDownX;
      const dy = (e.clientY || 0) - diceDownY;
      if ((dx * dx + dy * dy) > 100) {
        cancelDiceHold();
      }
    });
    btnDice.addEventListener("pointerup", cancelDiceHold);
    btnDice.addEventListener("pointerleave", cancelDiceHold);
    btnDice.addEventListener("pointercancel", cancelDiceHold);
    btnDice.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelDiceHold();
      openYsfDiceSettingsPopover({ cid, card, targetHs, anchorEl: btnDice });
    });

    btnDice.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (diceLong) {
        diceLong = false;
        return;
      }
      if (!targetHs) return;

      // Повторное нажатие во время поиска: мягкая остановка после завершения текущей внутренней итерации
      if (targetHs._ysfDiceRolling) {
        stopYsfDiceSearch(cid, card, targetHs, { finishInnerIteration: true });
        return;
      }

      // 1. Если запущен сканер матрицы YSF, тихо останавливаем его
      if (targetHs._ysfScanActive) {
        stopYsfMatrixScan(cid, card, targetHs, { keepCurrentLink: true, silent: true });
      }

      const runId = (targetHs._ysfDiceRunId || 0) + 1;
      targetHs._ysfDiceRunId = runId;
      targetHs._ysfDiceRolling = true;
      targetHs._ysfDiceStopRequested = false;
      syncYsfDiceButtonUI(card, targetHs);

      const triedIds = new Set();
      const MAX_DICE_ATTEMPTS = 20;
      const isRunTokenValid = () => Boolean(targetHs && targetHs._ysfDiceRunId === runId);
      const isLoopAlive = () => Boolean(isRunTokenValid() && targetHs._ysfDiceRolling && !targetHs._ysfDiceStopRequested);
      const cancellablePause = async (ms) => {
        const steps = Math.max(1, Math.ceil(ms / 50));
        for (let i = 0; i < steps; i++) {
          if (!isLoopAlive()) return false;
          await new Promise(r => setTimeout(r, 50));
        }
        return isLoopAlive();
      };

      let connectedOk = false;
      let stoppedByUser = false;
      let stoppedByConfig = false;
      let lastWasSilenceExhausted = false;

      try {
        for (let attempt = 1; attempt <= MAX_DICE_ATTEMPTS; attempt++) {
          if (!isLoopAlive()) {
            stoppedByUser = Boolean(targetHs._ysfDiceStopRequested);
            break;
          }

          setAslProcBannerState(card, {
            active: true,
            text: attempt === 1
              ? (window.t ? window.t("ysf.dice_searching", {}, "🎲 Поиск случайного активного рефлектора...") : "🎲 Поиск случайного активного рефлектора...")
              : (window.t ? window.t("ysf.dice_retry", { attempt, max: MAX_DICE_ATTEMPTS }, `🎲 Повторный поиск рефлектора (${attempt}/${MAX_DICE_ATTEMPTS})...`) : `🎲 Повторный поиск рефлектора (${attempt}/${MAX_DICE_ATTEMPTS})...`),
            tone: "neutral",
            autoHideMs: 0
          });

          const excludeQs = triedIds.size > 0
            ? `?exclude=${encodeURIComponent(Array.from(triedIds).join(","))}`
            : "";
          const resp = await fetch(`/api/ysf/dice${excludeQs}`);
          if (!isRunTokenValid()) break;

          const data = await resp.json();
          if (!isRunTokenValid()) break;

          if (!(data && data.status === "ok" && data.room && data.room.id)) {
            if (targetHs._ysfDiceStopRequested) {
              stoppedByUser = true;
              break;
            }
            if (typeof showToast === "function") {
              showToast(window.t ? window.t("ysf.dice_empty_toast", {}, "🎲 Нет доступных активных комнат YSF") : "🎲 Нет доступных активных комнат YSF", "warning", 2500, card);
            }
            setAslProcBannerState(card, {
              active: true,
              text: window.t ? window.t("ysf.dice_empty_toast", {}, "🎲 Нет доступных активных комнат YSF") : "🎲 Нет доступных активных комнат YSF",
              tone: "negative",
              autoHideMs: 4000,
              fadeOutMs: 2000
            });
            break;
          }

          const r = data.room;
          const rId = String(r.id).trim();
          const rName = r.name || r.reflector_name || `YSF #${rId}`;
          const rHost = r.host || "";
          const rPort = parseInt(r.port, 10) || 42000;
          const rClients = r.connections || r.online_count || data.online_count || 0;
          triedIds.add(rId);

          // Если нажали стоп во время подбора комнаты — завершаем итерацию до начала нового UDP-коннекта
          if (targetHs._ysfDiceStopRequested) {
            stoppedByUser = true;
            break;
          }

          // 2. Определяем флаг страны
          const flagInfo = (typeof detectYsfCountryFlag === "function")
            ? detectYsfCountryFlag(rId, rName)
            : { flag: "🌐" };
          const rFlag = flagInfo.flag || "🌐";

          // 3. Записываем выпавший рефлектор в правую нижнюю ячейку ТЕКУЩЕГО экрана памяти (как в ASL)
          const curPage = getYsfMatrixPage(cid, targetHs);
          const diceTargetIdx = curPage * YSF_PAGE_SIZE + (YSF_PAGE_SIZE - 1);
          const curRooms = getYsfMatrixRooms(cid);

          const presetRooms = new Set(
            curRooms.filter((_, i) => i !== diceTargetIdx)
              .map(u => String((u && u.room) || "").trim())
              .filter(Boolean)
          );

          if (Array.isArray(curRooms) && curRooms.length > diceTargetIdx && !presetRooms.has(rId)) {
            curRooms[diceTargetIdx] = {
              room: rId,
              label: rName,
              flag: rFlag,
              scan: false
            };
            saveYsfMatrixRooms(cid, curRooms);
            updateCardYsfPanel(card, targetHs);
          }

          // Сбрасываем старые флаги приёма перед новым подключением, чтобы не принять прошлую передачу за новую
          targetHs._ysfCarrierRx = false;
          targetHs._ysfLastRxAudioMs = 0;
          targetHs._ysfRxActiveRoom = "";
          targetHs._ysfKeyedRooms = [];
          if (card._lastRx && card._lastRx[1]) {
            card._lastRx[1].active = false;
            card._lastRx[1].lastAudioTime = 0;
          }
          const ts1Clean = card.querySelector(".vfo-ts1-row");
          if (ts1Clean) ts1Clean.classList.remove("vfo-rx-active");

          // 4. Запускаем подключение и дожидаемся фактического результата (done/failed)
          let connRes = { ok: false };
          if (typeof window.connectYsfRoomById === "function") {
            connRes = await window.connectYsfRoomById(rId, rName, card, rHost, rPort, {
              fromDice: true,
              awaitOutcome: true
            });
          }
          if (!isRunTokenValid()) break;

          if (connRes && connRes.ok) {
            const curCfg = getYsfDiceConfig(cid);
            if (!curCfg.continueOnSilence) {
              connectedOk = true;
              if (typeof showToast === "function") {
                const callerPart = data.active_caller ? ` (${data.active_caller})` : "";
                const liveHint = data.live_rx
                  ? (window.t ? window.t("ysf.dice_live_air", { caller: callerPart }, ` 🔥 on air${callerPart}`) : ` 🔥 on air${callerPart}`)
                  : (window.t ? window.t("ysf.dice_quiet_now", {}, " (currently quiet in room)") : " (currently quiet in room)");
                const toastMsg = window.t
                  ? window.t("ysf.dice_connected_toast", { room: rId, name: rName, clients: rClients, hint: liveHint }, `🎲 Random reflector: #${rId} (${rName}) [👥 ${rClients}]${liveHint}`)
                  : `🎲 Random reflector: #${rId} (${rName}) [👥 ${rClients}]${liveHint}`;
                showToast(toastMsg, data.live_rx ? "success" : "info", 3200, card);
              }
              break;
            }

            // Режим «Продолжать при отсутствии общения в течение N секунд»
            let elapsedSilenceMs = 0;
            let speechDetected = isYsfRoomRxActive(card, targetHs);
            let cfgWaitDisabled = false;
            const stepMs = 150;
            while (!speechDetected && isLoopAlive()) {
              const liveCfg = getYsfDiceConfig(cid);
              if (!liveCfg.continueOnSilence) {
                cfgWaitDisabled = true;
                break;
              }
              const waitTotalMs = Math.max(1, liveCfg.silenceWaitSec) * 1000;
              if (elapsedSilenceMs >= waitTotalMs) break;

              if (isYsfRoomRxActive(card, targetHs)) {
                speechDetected = true;
                break;
              }

              const remSec = Math.max(1, Math.ceil((waitTotalMs - elapsedSilenceMs) / 1000));
              setAslProcBannerState(card, {
                active: true,
                text: window.t
                  ? window.t("ysf.dice_wait_speech", { room: rId, sec: remSec }, `🎲 #${rId} connected — waiting for speech (${remSec}s)...`)
                  : `🎲 #${rId} connected — waiting for speech (${remSec}s)...`,
                tone: "neutral",
                autoHideMs: 0
              });

              await new Promise(r => setTimeout(r, stepMs));
              elapsedSilenceMs += stepMs;
            }
            if (!isRunTokenValid()) break;

            if (!speechDetected && isYsfRoomRxActive(card, targetHs)) {
              speechDetected = true;
            }

            if (speechDetected || cfgWaitDisabled) {
              connectedOk = true;
              if (speechDetected) {
                setAslProcBannerState(card, {
                  active: true,
                  text: window.t
                    ? window.t("ysf.dice_speech_found", { room: rId }, `🔊 #${rId}: active speech detected`)
                    : `🔊 #${rId}: active speech detected`,
                  tone: "positive",
                  autoHideMs: 4000,
                  fadeOutMs: 1800
                });
              }
              if (typeof showToast === "function") {
                const callerPart = data.active_caller ? ` (${data.active_caller})` : "";
                const liveHint = speechDetected
                  ? (window.t ? window.t("ysf.dice_live_air", { caller: callerPart }, ` 🔥 on air${callerPart}`) : ` 🔥 on air${callerPart}`)
                  : (window.t ? window.t("ysf.dice_silence_disabled", {}, " (silence mode disabled)") : " (silence mode disabled)");
                const toastMsg = window.t
                  ? window.t("ysf.dice_connected_toast", { room: rId, name: rName, clients: rClients, hint: liveHint }, `🎲 Random reflector: #${rId} (${rName}) [👥 ${rClients}]${liveHint}`)
                  : `🎲 Random reflector: #${rId} (${rName}) [👥 ${rClients}]${liveHint}`;
                showToast(toastMsg, speechDetected ? "success" : "info", 3200, card);
              }
              break;
            }

            if (targetHs._ysfDiceStopRequested || !isLoopAlive()) {
              stoppedByUser = true;
              break;
            }

            const afterWaitCfg = getYsfDiceConfig(cid);
            if (!afterWaitCfg.continueOnSilence) {
              connectedOk = true;
              break;
            }

            if (attempt < MAX_DICE_ATTEMPTS) {
              setAslProcBannerState(card, {
                active: true,
                text: window.t
                  ? window.t("ysf.dice_silence_retry", { room: rId, sec: afterWaitCfg.silenceWaitSec, attempt: attempt + 1, max: MAX_DICE_ATTEMPTS }, `🔇 #${rId}: silent (${afterWaitCfg.silenceWaitSec}s) — trying next (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`)
                  : `🔇 #${rId}: silent (${afterWaitCfg.silenceWaitSec}s) — trying next (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`,
                tone: "neutral",
                autoHideMs: 0
              });
              const keepGoing = await cancellablePause(250);
              if (!keepGoing) {
                stoppedByUser = Boolean(isRunTokenValid() && targetHs._ysfDiceStopRequested);
                break;
              }
              continue;
            }

            lastWasSilenceExhausted = true;
            setAslProcBannerState(card, {
              active: true,
              text: window.t
                ? window.t("ysf.dice_silence_exhausted", { max: MAX_DICE_ATTEMPTS }, `🔇 No active speech found across ${MAX_DICE_ATTEMPTS} random reflectors`)
                : `🔇 No active speech found across ${MAX_DICE_ATTEMPTS} random reflectors`,
              tone: "negative",
              autoHideMs: 4500,
              fadeOutMs: 2000
            });
            break;
          }

          if (targetHs._ysfDiceStopRequested) {
            stoppedByUser = true;
            break;
          }

          const failCfg = getYsfDiceConfig(cid);
          if (!failCfg.continueOnFail) {
            stoppedByConfig = true;
            setAslProcBannerState(card, {
              active: true,
              text: window.t
                ? window.t("ysf.dice_fail_stopped", { room: rId }, `✕ #${rId} unreachable — retry on failure is disabled`)
                : `✕ #${rId} unreachable — retry on failure is disabled`,
              tone: "negative",
              autoHideMs: 4000,
              fadeOutMs: 2000
            });
            if (typeof showToast === "function") {
              showToast(
                window.t
                  ? window.t("ysf.dice_fail_stopped", { room: rId }, `✕ #${rId} unreachable — retry on failure is disabled`)
                  : `✕ #${rId} unreachable — retry on failure is disabled`,
                "warning",
                2800,
                card
              );
            }
            break;
          }

          if (attempt < MAX_DICE_ATTEMPTS) {
            setAslProcBannerState(card, {
              active: true,
              text: window.t
                ? window.t("ysf.dice_retry", { attempt: attempt + 1, max: MAX_DICE_ATTEMPTS }, `🎲 Retrying reflector search (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`)
                : `🎲 Retrying reflector search (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`,
              tone: "neutral",
              autoHideMs: 0
            });
            const keepGoing = await cancellablePause(350);
            if (!keepGoing) {
              stoppedByUser = Boolean(isRunTokenValid() && targetHs._ysfDiceStopRequested);
              break;
            }
          } else {
            setAslProcBannerState(card, {
              active: true,
              text: window.t
                ? window.t("ysf.dice_exhausted", { max: MAX_DICE_ATTEMPTS }, `✕ Failed to connect to any of ${MAX_DICE_ATTEMPTS} random reflectors`)
                : `✕ Failed to connect to any of ${MAX_DICE_ATTEMPTS} random reflectors`,
              tone: "negative",
              autoHideMs: 4000,
              fadeOutMs: 2000
            });
          }
        }
      } catch (err) {
        console.warn("[YSF] Dice roll error:", err);
        if (isRunTokenValid() && !targetHs._ysfDiceStopRequested && typeof showToast === "function") {
          const diceErrMsg = window.t
            ? window.t("ysf.dice_roll_error", { error: err.message || err }, `✕ Dice roll error: ${err.message || err}`)
            : `✕ Dice roll error: ${err.message || err}`;
          showToast(diceErrMsg, "error", 2500, card);
        }
      } finally {
        if (isRunTokenValid()) {
          const wasStopped = stoppedByUser || Boolean(targetHs._ysfDiceStopRequested);
          targetHs._ysfDiceRolling = false;
          targetHs._ysfDiceStopRequested = false;
          syncYsfDiceButtonUI(card, targetHs);
          if (wasStopped && !connectedOk && !stoppedByConfig && !lastWasSilenceExhausted) {
            setAslProcBannerState(card, {
              active: true,
              text: window.t ? window.t("ysf.dice_stopped", {}, "⏹ Поиск случайного рефлектора остановлен") : "⏹ Поиск случайного рефлектора остановлен",
              tone: "neutral",
              autoHideMs: 4000,
              fadeOutMs: 2000
            });
          }
        }
      }
    });
  }

  // Directory button
  const btnYsfDir = card.querySelector(".btn-ysf-rooms-dir");
  if (btnYsfDir && !btnYsfDir._wiredYsf) {
    btnYsfDir._wiredYsf = true;
    btnYsfDir.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof window.openMyContactsModal === "function") {
        window.openMyContactsModal(cid, "ysf_dir");
      }
    });
  }

  // Presets M1-M5
  if (typeof window.renderQuickMemButtons === "function") {
    window.renderQuickMemButtons(targetHs ? targetHs.id : null);
  }

  const ysfDashPair = (vfoTs1 && vfoTs1.querySelector(".ysf-dash-pair")) || card.querySelector(".ysf-dash-pair");
  if (ysfDashPair) {
    const triggerBtn = ysfDashPair.querySelector(".btn-ysf-dash-trigger");
    const autoWrap = ysfDashPair.querySelector(".ysf-dash-auto-wrap");
    const autoChk = ysfDashPair.querySelector(".chk-ysf-dash-auto");

    if (triggerBtn) {
      triggerBtn.onclick = (e) => {
        e.stopPropagation();
        if (targetHs) {
          targetHs._ysfDashOpen = !targetHs._ysfDashOpen;
          ysfDashPair.classList.toggle("dash-open", targetHs._ysfDashOpen);
        }
        renderYsfDashboard(card, targetHs, cid);
      };
    }

    if (autoWrap && autoChk) {
      autoWrap.onclick = (e) => {
        e.stopPropagation();
        if (e.target !== autoChk && !(e.target && e.target.closest && e.target.closest("label"))) {
          autoChk.checked = !autoChk.checked;
          autoChk.dispatchEvent(new Event("change"));
        }
      };
      autoChk.onchange = (e) => {
        e.stopPropagation();
        const en = Boolean(autoChk.checked);
        setYsfDashAutoOpenEnabled(cid, en);
        if (typeof showToast === "function") {
          const msg = en
            ? (window.t ? window.t("ysf.dash_auto_on_toast", {}, "✅ Автооткрытие дашборда рефлектора YSF включено") : "✅ Автооткрытие дашборда рефлектора YSF включено")
            : (window.t ? window.t("ysf.dash_auto_off_toast", {}, "⚪ Автооткрытие дашборда рефлектора YSF выключено") : "⚪ Автооткрытие дашборда рефлектора YSF выключено");
          showToast(msg);
        }
      };
    }
  }

  // Initial dashboard / status poll
  renderYsfDashboard(card, targetHs, cid);
  syncYsfMatrixButtonsState(card, targetHs);
  probeYsfMatrixRooms(card, targetHs, false);
  if (prevScanPopover) {
    vfoYsf.style.position = "relative";
    vfoYsf.appendChild(prevScanPopover);
  }
}

export async function startAdnDiceSearch(cid, card, targetHs, btnDice) {
  if (!card || !targetHs) return;

  const isSimplex = (targetHs.duplex === false || (targetHs.config && targetHs.config.duplex === false));
  const activeSlotNum = Number(card._activeSlot || (typeof getHotspotSlot === "function" ? getHotspotSlot(cid) : 2));
  const targetSlot = isSimplex ? 2 : (activeSlotNum === 1 ? 1 : 2);

  const runId = (targetHs._adnDiceRunId || 0) + 1;
  targetHs._adnDiceRunId = runId;
  targetHs._adnDiceRolling = true;
  targetHs._adnDiceStopRequested = false;
  syncAdnDiceButtonUI(card, targetHs);

  const triedIds = new Set();
  const MAX_DICE_ATTEMPTS = 20;
  const isRunTokenValid = () => Boolean(targetHs && targetHs._adnDiceRunId === runId);
  const isLoopAlive = () => Boolean(isRunTokenValid() && targetHs._adnDiceRolling && !targetHs._adnDiceStopRequested);
  const cancellablePause = async (ms) => {
    const steps = Math.max(1, Math.ceil(ms / 50));
    for (let i = 0; i < steps; i++) {
      if (!isLoopAlive()) return false;
      await new Promise(r => setTimeout(r, 50));
    }
    return isLoopAlive();
  };

  let connectedOk = false;
  let stoppedByUser = false;
  let stoppedByConfig = false;
  let lastWasSilenceExhausted = false;

  try {
    for (let attempt = 1; attempt <= MAX_DICE_ATTEMPTS; attempt++) {
      if (!isLoopAlive()) {
        stoppedByUser = Boolean(targetHs._adnDiceStopRequested);
        break;
      }

      setAslProcBannerState(card, {
        active: true,
        text: attempt === 1
          ? (window.t ? window.t("adn.dice_searching", {}, "🎲 Поиск случайной активной TG ADN...") : "🎲 Поиск случайной активной TG ADN...")
          : (window.t ? window.t("adn.dice_retry", { attempt, max: MAX_DICE_ATTEMPTS }, `🎲 Повторный поиск TG ADN (${attempt}/${MAX_DICE_ATTEMPTS})...`) : `🎲 Повторный поиск TG ADN (${attempt}/${MAX_DICE_ATTEMPTS})...`),
        tone: "neutral",
        autoHideMs: 0
      });

      const excludeQs = triedIds.size > 0
        ? `?exclude=${encodeURIComponent(Array.from(triedIds).join(","))}`
        : "";
      const resp = await fetch(`/api/adn/dice${excludeQs}`);
      if (!isRunTokenValid()) break;

      const data = await resp.json().catch(() => null);
      if (!isRunTokenValid()) break;

      if (!(data && data.status === "ok" && data.talkgroup && data.talkgroup.tg)) {
        if (targetHs._adnDiceStopRequested) {
          stoppedByUser = true;
          break;
        }
        if (typeof showToast === "function") {
          showToast(window.t ? window.t("adn.dice_empty_toast", {}, "🎲 Сейчас нет доступных активных TG ADN") : "🎲 Сейчас нет доступных активных TG ADN", "warning", 2500, card);
        }
        setAslProcBannerState(card, {
          active: true,
          text: window.t ? window.t("adn.dice_empty_toast", {}, "🎲 Сейчас нет доступных активных TG ADN") : "🎲 Сейчас нет доступных активных TG ADN",
          tone: "negative",
          autoHideMs: 4000,
          fadeOutMs: 2000
        });
        break;
      }

      const tgId = Number(data.talkgroup.tg);
      const tgName = data.talkgroup.name || `TG ${tgId}`;
      const activeCaller = data.active_caller || (data.talkgroup.talker && data.talkgroup.talker.call) || "";
      triedIds.add(tgId);

      if (targetHs._adnDiceStopRequested) {
        stoppedByUser = true;
        break;
      }

      if (card._lastRx && card._lastRx[targetSlot]) {
        card._lastRx[targetSlot].active = false;
        card._lastRx[targetSlot].lastAudioTime = 0;
      }
      const targetTsRow = card.querySelector(targetSlot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
      if (targetTsRow) targetTsRow.classList.remove("vfo-rx-active");

      // Подключение через назначение статической TG на targetSlot:
      // Шаг А: снять текущую динамику TG 4000
      try {
        await fetch("/api/bm/drop-dynamic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hotspot_id: cid, slot: targetSlot })
        });
      } catch (_) {}
      if (!isRunTokenValid()) break;

      // Шаг Б: получить текущую статику слота и удалить другие группы
      try {
        const curStaticResp = await fetch(`/api/bm/static-groups?hotspot_id=${encodeURIComponent(cid)}`);
        if (curStaticResp.ok) {
          const stData = await curStaticResp.json().catch(() => null);
          if (stData && (stData.ts1 || stData.ts2)) {
            const currentSlotList = (targetSlot === 1 ? stData.ts1 : stData.ts2) || [];
            const toDelete = currentSlotList
              .map(item => Number(typeof item === "object" ? item.talkgroup : item))
              .filter(id => Number.isFinite(id) && id > 0 && id !== tgId);
            if (toDelete.length > 0) {
              await fetch("/api/bm/static-groups", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hotspot_id: cid, slot: targetSlot, talkgroups: toDelete })
              });
            }
          }
        }
      } catch (_) {}
      if (!isRunTokenValid()) break;

      // Шаг В: назначить новую статическую TG
      let assignOk = false;
      try {
        const postResp = await fetch("/api/bm/static-groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hotspot_id: cid, slot: targetSlot, talkgroups: [tgId] })
        });
        const postData = await postResp.json().catch(() => ({}));
        if (postResp.ok && postData.status === "ok") {
          assignOk = true;
          if (postData.rpto_options && targetHs) {
            targetHs.rpto_options = postData.rpto_options;
          }
          if (targetSlot === 1) {
            targetHs.tg_ts1 = tgId;
          } else {
            targetHs.tg_ts2 = tgId;
          }
          if (typeof renderRadiosGrid === "function") {
            renderRadiosGrid();
          }
        }
      } catch (_) {}
      if (!isRunTokenValid()) break;

      if (assignOk) {
        const curCfg = getAdnDiceConfig(cid);
        if (!curCfg.continueOnSilence) {
          connectedOk = true;
          if (typeof showToast === "function") {
            const callerPart = activeCaller ? ` (${activeCaller})` : "";
            const liveHint = data.live_rx
              ? (window.t ? window.t("adn.dice_live_air", { caller: callerPart }, ` 🔥 в эфире${callerPart}`) : ` 🔥 в эфире${callerPart}`)
              : (window.t ? window.t("adn.dice_quiet_now", {}, " (сейчас тихо)") : " (сейчас тихо)");
            const toastMsg = window.t
              ? window.t("adn.dice_connected_toast", { slot: targetSlot, tg: tgId, name: tgName, hint: liveHint }, `🎲 Случайная TG ADN: TS${targetSlot} · TG ${tgId} (${tgName})${liveHint}`)
              : `🎲 Случайная TG ADN: TS${targetSlot} · TG ${tgId} (${tgName})${liveHint}`;
            showToast(toastMsg, data.live_rx ? "success" : "info", 3200, card);
          }
          setAslProcBannerState(card, {
            active: true,
            text: window.t
              ? window.t("adn.dice_connected_toast", { slot: targetSlot, tg: tgId, name: tgName, hint: "" }, `🎲 TS${targetSlot} · TG ${tgId} (${tgName})`)
              : `🎲 TS${targetSlot} · TG ${tgId} (${tgName})`,
            tone: "positive",
            autoHideMs: 4000,
            fadeOutMs: 1800
          });
          break;
        }

        // Режим ожидания речи
        let elapsedSilenceMs = 0;
        let speechDetected = isAdnSlotRxActive(card, targetHs, targetSlot);
        let cfgWaitDisabled = false;
        const stepMs = 150;
        while (!speechDetected && isLoopAlive()) {
          const liveCfg = getAdnDiceConfig(cid);
          if (!liveCfg.continueOnSilence) {
            cfgWaitDisabled = true;
            break;
          }
          const waitTotalMs = Math.max(1, liveCfg.silenceWaitSec) * 1000;
          if (elapsedSilenceMs >= waitTotalMs) break;

          if (isAdnSlotRxActive(card, targetHs, targetSlot)) {
            speechDetected = true;
            break;
          }

          const remSec = Math.max(1, Math.ceil((waitTotalMs - elapsedSilenceMs) / 1000));
          setAslProcBannerState(card, {
            active: true,
            text: window.t
              ? window.t("adn.dice_wait_speech", { slot: targetSlot, tg: tgId, sec: remSec }, `🎲 TS${targetSlot} TG ${tgId}: ожидание речи (${remSec}с)...`)
              : `🎲 TS${targetSlot} TG ${tgId}: ожидание речи (${remSec}с)...`,
            tone: "neutral",
            autoHideMs: 0
          });

          await new Promise(r => setTimeout(r, stepMs));
          elapsedSilenceMs += stepMs;
        }
        if (!isRunTokenValid()) break;

        if (!speechDetected && isAdnSlotRxActive(card, targetHs, targetSlot)) {
          speechDetected = true;
        }

        if (speechDetected || cfgWaitDisabled) {
          connectedOk = true;
          if (speechDetected) {
            setAslProcBannerState(card, {
              active: true,
              text: window.t
                ? window.t("adn.dice_speech_found", { slot: targetSlot, tg: tgId }, `🔊 TS${targetSlot} TG ${tgId}: обнаружена речь в эфире`)
                : `🔊 TS${targetSlot} TG ${tgId}: обнаружена речь в эфире`,
              tone: "positive",
              autoHideMs: 4000,
              fadeOutMs: 1800
            });
          }
          if (typeof showToast === "function") {
            const callerPart = activeCaller ? ` (${activeCaller})` : "";
            const liveHint = speechDetected
              ? (window.t ? window.t("adn.dice_live_air", { caller: callerPart }, ` 🔥 в эфире${callerPart}`) : ` 🔥 в эфире${callerPart}`)
              : (window.t ? window.t("adn.dice_silence_disabled", {}, " (режим тишины отключён)") : " (режим тишины отключён)");
            const toastMsg = window.t
              ? window.t("adn.dice_connected_toast", { slot: targetSlot, tg: tgId, name: tgName, hint: liveHint }, `🎲 Случайная TG ADN: TS${targetSlot} · TG ${tgId} (${tgName})${liveHint}`)
              : `🎲 Случайная TG ADN: TS${targetSlot} · TG ${tgId} (${tgName})${liveHint}`;
            showToast(toastMsg, speechDetected ? "success" : "info", 3200, card);
          }
          break;
        }

        if (targetHs._adnDiceStopRequested || !isLoopAlive()) {
          stoppedByUser = true;
          break;
        }

        const afterWaitCfg = getAdnDiceConfig(cid);
        if (!afterWaitCfg.continueOnSilence) {
          connectedOk = true;
          break;
        }

        if (attempt < MAX_DICE_ATTEMPTS) {
          setAslProcBannerState(card, {
            active: true,
            text: window.t
              ? window.t("adn.dice_silence_retry", { tg: tgId, sec: afterWaitCfg.silenceWaitSec, attempt: attempt + 1, max: MAX_DICE_ATTEMPTS }, `🔇 TG ${tgId}: тишина (${afterWaitCfg.silenceWaitSec}с) — следующая (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`)
              : `🔇 TG ${tgId}: тишина (${afterWaitCfg.silenceWaitSec}с) — следующая (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`,
            tone: "neutral",
            autoHideMs: 0
          });
          const keepGoing = await cancellablePause(250);
          if (!keepGoing) {
            stoppedByUser = Boolean(isRunTokenValid() && targetHs._adnDiceStopRequested);
            break;
          }
          continue;
        }

        lastWasSilenceExhausted = true;
        setAslProcBannerState(card, {
          active: true,
          text: window.t
            ? window.t("adn.dice_silence_exhausted", { max: MAX_DICE_ATTEMPTS }, `🔇 Не найдено активной речи среди ${MAX_DICE_ATTEMPTS} случайных TG ADN`)
            : `🔇 Не найдено активной речи среди ${MAX_DICE_ATTEMPTS} случайных TG ADN`,
          tone: "negative",
          autoHideMs: 4500,
          fadeOutMs: 2000
        });
        break;
      }

      if (targetHs._adnDiceStopRequested) {
        stoppedByUser = true;
        break;
      }

      const failCfg = getAdnDiceConfig(cid);
      if (!failCfg.continueOnFail) {
        stoppedByConfig = true;
        setAslProcBannerState(card, {
          active: true,
          text: window.t
            ? window.t("adn.dice_fail_stopped", { tg: tgId }, `✕ TG ${tgId}: ошибка подключения — повтор при сбое отключён`)
            : `✕ TG ${tgId}: ошибка подключения — повтор при сбое отключён`,
          tone: "negative",
          autoHideMs: 4000,
          fadeOutMs: 2000
        });
        if (typeof showToast === "function") {
          showToast(
            window.t
              ? window.t("adn.dice_fail_stopped", { tg: tgId }, `✕ TG ${tgId}: ошибка подключения — повтор при сбое отключён`)
              : `✕ TG ${tgId}: ошибка подключения — повтор при сбое отключён`,
            "warning",
            2800,
            card
          );
        }
        break;
      }

      if (attempt < MAX_DICE_ATTEMPTS) {
        setAslProcBannerState(card, {
          active: true,
          text: window.t
            ? window.t("adn.dice_retry", { attempt: attempt + 1, max: MAX_DICE_ATTEMPTS }, `🎲 Повторный поиск TG ADN (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`)
            : `🎲 Повторный поиск TG ADN (${attempt + 1}/${MAX_DICE_ATTEMPTS})...`,
          tone: "neutral",
          autoHideMs: 0
        });
        const keepGoing = await cancellablePause(350);
        if (!keepGoing) {
          stoppedByUser = Boolean(isRunTokenValid() && targetHs._adnDiceStopRequested);
          break;
        }
      } else {
        setAslProcBannerState(card, {
          active: true,
          text: window.t
            ? window.t("adn.dice_exhausted", { max: MAX_DICE_ATTEMPTS }, `✕ Не удалось подключиться ни к одной из ${MAX_DICE_ATTEMPTS} случайных TG ADN`)
            : `✕ Не удалось подключиться ни к одной из ${MAX_DICE_ATTEMPTS} случайных TG ADN`,
          tone: "negative",
          autoHideMs: 4000,
          fadeOutMs: 2000
        });
      }
    }
  } catch (err) {
    console.warn("[ADN] Dice roll error:", err);
    if (isRunTokenValid() && !targetHs._adnDiceStopRequested && typeof showToast === "function") {
      const diceErrMsg = window.t
        ? window.t("adn.dice_roll_error", { error: err.message || err }, `✕ Ошибка «Кубика» ADN: ${err.message || err}`)
        : `✕ Ошибка «Кубика» ADN: ${err.message || err}`;
      showToast(diceErrMsg, "error", 2500, card);
    }
  } finally {
    if (isRunTokenValid()) {
      const wasStopped = stoppedByUser || Boolean(targetHs._adnDiceStopRequested);
      targetHs._adnDiceRolling = false;
      targetHs._adnDiceStopRequested = false;
      syncAdnDiceButtonUI(card, targetHs);
      if (wasStopped && !connectedOk && !stoppedByConfig && !lastWasSilenceExhausted) {
        setAslProcBannerState(card, {
          active: true,
          text: window.t ? window.t("adn.dice_stopped", {}, "⏹ Поиск случайной TG ADN остановлен") : "⏹ Поиск случайной TG ADN остановлен",
          tone: "neutral",
          autoHideMs: 4000,
          fadeOutMs: 2000
        });
      }
    }
  }
}

export function setupAdnDiceButton(card, cid, hs) {
  if (!card) return;
  const btnDice = card.querySelector(".btn-adn-dice");
  if (!btnDice || btnDice._wiredAdnDice) return;
  btnDice._wiredAdnDice = true;

  const isCardAdnNetwork = () => {
    const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
    const targetHs = curHsList.find(h => h && h.id === cid) || hs || null;
    const rawNet = (targetHs && targetHs.network_type)
      || (card.dataset && card.dataset.networkType)
      || (card.classList && card.classList.contains("card-net-adn") ? "adn" : "")
      || "";
    return String(rawNet).trim().toLowerCase() === "adn";
  };

  let diceHoldTimer = null;
  let diceLong = false;
  let diceDownX = 0;
  let diceDownY = 0;
  const cancelDiceHold = () => {
    if (diceHoldTimer) {
      clearTimeout(diceHoldTimer);
      diceHoldTimer = null;
    }
  };

  btnDice.addEventListener("pointerdown", (e) => {
    if (!isCardAdnNetwork()) return;
    if (e && e.button !== undefined && e.button !== 0) return;
    diceLong = false;
    diceDownX = e.clientX || 0;
    diceDownY = e.clientY || 0;
    cancelDiceHold();
    diceHoldTimer = setTimeout(() => {
      diceLong = true;
      diceHoldTimer = null;
      if (!isCardAdnNetwork()) return;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate([40, 30, 40]); } catch (_) {}
      }
      openAdnDiceSettingsPopover({ cid, card, targetHs: hs, anchorEl: btnDice });
    }, 550);
  });

  btnDice.addEventListener("pointermove", (e) => {
    if (!diceHoldTimer) return;
    const dx = (e.clientX || 0) - diceDownX;
    const dy = (e.clientY || 0) - diceDownY;
    if ((dx * dx + dy * dy) > 100) {
      cancelDiceHold();
    }
  });

  btnDice.addEventListener("pointerup", cancelDiceHold);
  btnDice.addEventListener("pointerleave", cancelDiceHold);
  btnDice.addEventListener("pointercancel", cancelDiceHold);
  btnDice.addEventListener("contextmenu", (e) => {
    if (!isCardAdnNetwork()) return;
    e.preventDefault();
    e.stopPropagation();
    cancelDiceHold();
    openAdnDiceSettingsPopover({ cid, card, targetHs: hs, anchorEl: btnDice });
  });

  btnDice.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!isCardAdnNetwork()) return;
    if (diceLong) {
      diceLong = false;
      return;
    }
    const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
    const targetHs = curHsList.find(h => h && h.id === cid) || hs || curHsList[0] || null;
    if (!targetHs || String(targetHs.network_type || "").toLowerCase() !== "adn") return;

    if (targetHs._adnDiceRolling) {
      stopAdnDiceSearch(cid, card, targetHs);
      return;
    }

    startAdnDiceSearch(cid, card, targetHs, btnDice);
  });
}

export function updateCardAllStarPanel(card, hs) {
  if (!card) return;
  const targetHs = hs || (card.dataset.hotspotId ? (getCurrentHotspots().find(h => h.id === card.dataset.hotspotId) || null) : null) || (getCurrentHotspots()[0] || null);
  const isAllStarNet = ((targetHs && targetHs.network_type) || card.dataset.networkType || "bm").toLowerCase() === "allstar";
  card.classList.toggle("card-net-allstar", isAllStarNet);
  if (isAllStarNet) {
    card.dataset.networkType = "allstar";
  }

  const vfoTs1 = card.querySelector(".vfo-ts1-row");
  const vfoTs2 = card.querySelector(".vfo-ts2-row");
  let vfoAllStar = card.querySelector(".vfo-allstar-row");

  if (isAllStarNet) {
    if (vfoTs1) vfoTs1.style.setProperty("display", "none", "important");
    if (vfoTs2) vfoTs2.style.setProperty("display", "none", "important");
    const apiRow = card.querySelector(".api-status-row");
    if (apiRow) apiRow.style.setProperty("display", "none", "important");

    if (!vfoAllStar) {
      vfoAllStar = document.createElement("div");
      vfoAllStar.className = "vfo-row vfo-allstar-row";
      if (vfoTs2 && vfoTs2.parentElement) {
        vfoTs2.parentElement.insertBefore(vfoAllStar, vfoTs2);
      } else {
        const screenEl = card.querySelector(".radio-screen") || card;
        screenEl.appendChild(vfoAllStar);
      }
    } else {
      vfoAllStar.style.removeProperty("display");
    }

    const cid = (targetHs && targetHs.id) || card.dataset.hotspotId || "default";
    const ownNode = String((targetHs && (targetHs.config?.allstar_node || targetHs.allstar_node || targetHs.node_number)) || "45113").trim();
    const connNode = String((targetHs && (targetHs.connected_node || targetHs.target_node)) || "").trim();
    const isLinked = Boolean(connNode && connNode !== "0");

    // Запрос активных линков с бэкенда при рендере
    const fetchAslLinks = () => {
      fetch(`/api/allstar/connected?hotspot_id=${encodeURIComponent(cid)}`)
        .then(r => r.json())
        .then(data => {
          if (data && data.status === "ok") {
            const nodes = data.connected_nodes || [];
            const links = data.links || [];
            targetHs.asl_links = links;
            targetHs.asl_online_count = data.online_count || links.filter(l => !l.connecting).length || nodes.length;
            const establishedFirst = nodes[0] || (links.find(l => !l.connecting) && links.find(l => !l.connecting).node) || "";
            if (establishedFirst || targetHs.asl_online_count > 0) {
              targetHs.connected_node = establishedFirst;
              targetHs.is_asl_linked = Boolean(establishedFirst);
            }
            if (data.rtt !== null && data.rtt !== undefined && !isNaN(Number(data.rtt)) && Number(data.rtt) > 0) {
              const rttInt = Math.round(Number(data.rtt));
              if (typeof window !== "undefined") {
                if (!window.cachedBmPings) window.cachedBmPings = {};
                window.cachedBmPings[cid] = rttInt;
              }
              if (targetHs.connected_node) {
                const hKey = `asl_node_${targetHs.connected_node}`;
                if (typeof window !== "undefined") {
                  if (!window.cachedBmHostPings) window.cachedBmHostPings = {};
                  window.cachedBmHostPings[hKey] = rttInt;
                  if (!window.cachedBmHostLosses) window.cachedBmHostLosses = {};
                  window.cachedBmHostLosses[hKey] = 0.0;
                }
              }
            }
            updateAslVfoHeader(card, targetHs);
            if (Array.isArray(links)) {
              links.forEach(lk => {
                if (lk && lk.node) {
                  const cn = String(lk.node).trim();
                  if (lk.connecting || lk.status === "connecting") {
                    if (targetHs._aslConnectingNodes instanceof Map) {
                      const ex = targetHs._aslConnectingNodes.get(cn);
                      targetHs._aslConnectingNodes.set(cn, {
                        mode: lk.mode || (ex && ex.mode) || "*2",
                        startedAt: ex ? ex.startedAt : Date.now()
                      });
                    }
                  } else {
                    if (targetHs._aslConnectingNodes instanceof Map) {
                      targetHs._aslConnectingNodes.delete(cn);
                    }
                  }
                }
              });
            }
            if (targetHs.is_asl_linked) {
              targetHs.status = "ONLINE";
              if (typeof updateBmStatus === "function") {
                updateBmStatus("ONLINE", `Node ${targetHs.connected_node || ""}`, cid);
              }
            } else if (targetHs.status === "ONLINE" || targetHs.status === "CONNECTING") {
              targetHs.status = "ONLINE";
              if (typeof updateBmStatus === "function") {
                const aslActiveLabel = window.t ? window.t("asl.status_active", {}, "AllStarLink active") : "AllStarLink active";
                updateBmStatus("ONLINE", (data.own_node || targetHs.allstar_node) ? `Node ${data.own_node || targetHs.allstar_node}` : aslActiveLabel, cid);
              }
            }
            if (typeof updateCardBmBanner === "function") {
              updateCardBmBanner(card, targetHs);
            }
            // If in dynamic matrix mode or unlisted links present, re-render panel if structure changed
            if ((targetHs._aslDynamicMatrixMode || (targetHs.asl_unlisted_links && targetHs.asl_unlisted_links.length > 0)) && !card.querySelector(".asl-card-context-menu")) {
              updateCardAllStarPanel(card, targetHs);
            } else {
              syncAslMatrixButtonsState(card, targetHs);
            }
            const linksBar = card.querySelector(".asl-active-links-bar");
            if (linksBar) {
              linksBar.innerHTML = renderActiveLinkChipsHtml(targetHs, cid);
              setupActiveLinkChipHandlers(linksBar, cid, targetHs, card);
            }
          }
        })
        .catch(() => {});
    };

    if (targetHs && targetHs._aslInitialFetchDone !== true) {
      targetHs._aslInitialFetchDone = true;
      fetchAslLinks();
    }

    // Задача 1: Полное удаление выпадающего списка серверов (.bm-server-label-wrap) и установка чистой плашки
    const labelWrap = card.querySelector(".bm-server-label-wrap");
    if (labelWrap) {
      labelWrap.style.setProperty("display", "none", "important");
    }
    const infoBanner = card.querySelector(".bm-info-banner") || (labelWrap && labelWrap.parentElement);
    let aslHeaderBadge = card.querySelector(".asl-header-status-badge");
    if (!aslHeaderBadge && infoBanner) {
      aslHeaderBadge = document.createElement("span");
      aslHeaderBadge.className = "asl-header-status-badge";
      if (labelWrap && labelWrap.parentElement === infoBanner) {
        infoBanner.insertBefore(aslHeaderBadge, labelWrap);
      } else {
        infoBanner.prepend(aslHeaderBadge);
      }
    }
    if (aslHeaderBadge) {
      aslHeaderBadge.style.removeProperty("display");
      aslHeaderBadge.textContent = `Node ${ownNode}`;
      aslHeaderBadge.className = `asl-header-status-badge ${isLinked ? "asl-badge-linked" : "asl-badge-idle"}`;
      aslHeaderBadge.title = isLinked 
        ? (window.t ? window.t("asl.header_badge_linked", {}, "Подключен к сети ASL3 (активен линк)") : "Подключен к сети ASL3 (активен линк)")
        : (window.t ? window.t("asl.header_badge_standby", {}, "Узел ASL3 в режиме ожидания (нет активных линков)") : "Узел ASL3 в режиме ожидания (нет активных линков)");
    }

    // Задача 2: Верхняя статусная строка VFO (между STANDBY и E2E)
    updateAslVfoHeader(card, targetHs);

    // Configurable quick nodes (stored in localStorage) - 5x4 матрица памяти (20 узлов)
    const DEFAULT_NODES = [
      // Ряд 1 (Отображается в основном доке)
      { node: "1999",   label: "Parrot Echo",flag: "🦜" },
      { node: "41522",  label: "HUBNet UK",  flag: "🇬🇧" },
      { node: "27339",  label: "East Coast", flag: "🇺🇸" },
      { node: "2143",   label: "WAN RS",     flag: "🇺🇸" },
      // Ряд 2
      { node: "2000",   label: "Western Ref",flag: "🇺🇸" },
      { node: "51010",  label: "World Conf", flag: "🌐" },
      { node: "28554",  label: "RU3AID Hub", flag: "🇷🇺" },
      { node: "2560",   label: "WIN System", flag: "🇺🇸" },
      // Ряд 3
      { node: "2462",   label: "Alaska Net", flag: "🇺🇸" },
      { node: "52495",  label: "DL-Nordwest",flag: "🇩🇪" },
      { node: "52319",  label: "Canada Hub", flag: "🇨🇦" },
      { node: "27170",  label: "Florida Hub",flag: "🇺🇸" },
      // Ряд 4
      { node: "53085",  label: "PA Hub",     flag: "🇺🇸" },
      { node: "53431",  label: "Alabama Net",flag: "🇺🇸" },
      { node: "289890", label: "PA-Wide",    flag: "🇺🇸" },
      { node: "41413",  label: "Santiago Pk",flag: "🇺🇸" },
      // Ряд 5
      { node: "47280",  label: "Georgia Net",flag: "🇺🇸" },
      { node: "42821",  label: "Germany DL", flag: "🇩🇪" },
      { node: "487571", label: "Australia",  flag: "🇦🇺" },
      { node: "500691", label: "Texas Hub",  flag: "🇺🇸" }
    ];

    const getDefaultNodes = (targetCid) => {
      try {
        let parsed = null;
        if (hasServerCollectionKey("asl_default_nodes", targetCid)) {
          parsed = getServerCollectionValue("asl_default_nodes", targetCid);
        } else if (hasServerCollectionKey("asl_default_nodes", "global")) {
          parsed = getServerCollectionValue("asl_default_nodes", "global");
        }
        if (typeof parsed === "string") parsed = JSON.parse(parsed);
        if (!parsed) {
          const customDef = localStorage.getItem(`proxdmr_asl_default_nodes_${targetCid}`) || localStorage.getItem("proxdmr_asl_default_nodes_global");
          if (customDef) parsed = JSON.parse(customDef);
        }
        if (Array.isArray(parsed) && (parsed.length === 20 || parsed.length === ASL_MEMORY_SIZE)) return padAslNodes(parsed);
      } catch (_) {}
      return padAslNodes([...DEFAULT_NODES]);
    };

    const activeDefaults = getDefaultNodes(cid);
    let userNodes = [...activeDefaults];
    try {
      const parsed = getAslStoredNodes(cid);
      if (Array.isArray(parsed) && parsed.length > 0) {
          const seen = new Set();
          userNodes = activeDefaults.map((defNode, idx) => {
            let item = parsed[idx];
            if (!item) return { ...defNode, scan: false };
            let nodeStr = String(item.node || "").trim();
            if (!nodeStr) {
              return { node: "", label: item.label || "", flag: item.flag || "➕", scan: Boolean(item.scan), role: item.role || "node" };
            }
            if (nodeStr === "2502") {
              item = { node: "28554", label: "RU3AID Hub", flag: "🇷🇺", scan: item.scan };
              nodeStr = "28554";
            }
            if (nodeStr === "1999") {
              item.label = "Parrot Echo";
              item.flag = "🦜";
            }
            if (nodeStr === "9999") {
              item = { node: "2000", label: "Western Ref", flag: "🇺🇸", scan: item.scan };
              nodeStr = "2000";
            }
            if (seen.has(nodeStr)) {
              return { ...defNode, scan: false };
            }
            seen.add(nodeStr);
            const itemRole = item.role || (/[*#ABCDabcd]/.test(nodeStr) ? "dtmf" : "node");
            return {
              node: nodeStr,
              label: item.label || "",
              flag: (itemRole === "dtmf" ? "☎️" : (item.flag || "🌐")),
              scan: Boolean(item.scan),
              role: itemRole,
              prefMode: (item.prefMode === "2" || item.prefMode === "3") ? item.prefMode : undefined
            };
          });
      }
    } catch (e) {}

    const isAddMode = (typeof window.isHotspotAslAddMode === "function") ? window.isHotspotAslAddMode(cid) : false;

    // Build linked modes map and compute unlisted links
    const linkedModesMap = new Map();
    const rawLinks = Array.isArray(targetHs && targetHs.asl_links) ? targetHs.asl_links : [];
    if (rawLinks.length > 0) {
      rawLinks.forEach(lk => {
        if (lk && lk.node) {
          linkedModesMap.set(String(lk.node).trim(), lk.mode === "*3" ? "*3" : "*2");
        }
      });
    } else if (isLinked && connNode) {
      const fallbackMode = (typeof window.getHotspotAslMode === "function" ? window.getHotspotAslMode(cid) : "*2");
      linkedModesMap.set(connNode, fallbackMode);
    }

    const presetNodeMap = new Map();
    userNodes.forEach(u => {
      const cn = String(u.node || "").trim();
      if (cn) presetNodeMap.set(cn, u);
    });

    const disconnectingSet = (targetHs && targetHs._aslDisconnectingNodes instanceof Set)
      ? targetHs._aslDisconnectingNodes
      : null;

    const unlistedLinks = rawLinks.filter(lk => {
      if (!lk || !lk.node) return false;
      const cn = String(lk.node).trim();
      if (disconnectingSet && disconnectingSet.has(cn)) return false;
      return !presetNodeMap.has(cn);
    });

    if (targetHs) {
      targetHs.asl_unlisted_links = unlistedLinks;
      if (unlistedLinks.length > 0) {
        const hasNewUnlisted = unlistedLinks.some(l => !targetHs._aslDismissedUnlisted || !targetHs._aslDismissedUnlisted.has(String(l.node).trim()));
        targetHs._aslDynamicMatrixMode = Boolean(hasNewUnlisted);
      } else {
        targetHs._aslDynamicMatrixMode = false;
      }
    }

    // Сохраняем все 20 пользовательских пресетов на их фиксированных позициях (0..19).
    // Если поступают внешние незаписанные линки (unlistedLinks), они занимают только свободные ячейки (!node),
    // никогда не скрывая и не сдвигая настроенные ячейки пользователя!
    const displayNodes = userNodes.map(u => ({ ...u }));
    if (unlistedLinks.length > 0) {
      let unlistedIdx = 0;
      for (let i = 0; i < displayNodes.length && unlistedIdx < unlistedLinks.length; i++) {
        if (!displayNodes[i].node) {
          const lk = unlistedLinks[unlistedIdx++];
          const cleanN = String(lk.node).trim();
          const extFallbackLabel = lk.direction === "IN"
            ? (window.t ? window.t("asl.external_inbound", {}, "Inbound") : "Inbound")
            : (window.t ? window.t("asl.external_node", {}, "External") : "External");
          displayNodes[i] = {
            node: cleanN,
            label: lk.callsign || lk.name || lk.city || extFallbackLabel,
            flag: lk.flag || "🌐",
            isExternal: true
          };
        }
      }
    }

    const prevSliderContainer = vfoAllStar.querySelector(".asl-slider-container");
    const wasTextView = prevSliderContainer ? prevSliderContainer.classList.contains("is-text-view") : false;
    const prevStreamEl = vfoAllStar.querySelector(".asl-caption-stream");
    const prevStreamNodes = prevStreamEl ? Array.from(prevStreamEl.childNodes) : [];
    const prevAslPopover = vfoAllStar.querySelector(".asl-scan-settings-popover");

    closeAslCardContextMenu(card, targetHs);
    clearAslMoveCancelListener();

    const diceBtnTitle = (targetHs && targetHs._aslDiceRolling)
      ? (window.t ? window.t("asl.dice_btn_stop_title", {}, "Нажмите для остановки поиска случайного узла ASL") : "Нажмите для остановки поиска случайного узла ASL")
      : (window.t
          ? window.t("asl.dice_btn_title", {}, "Случайный активный узел ASL (клик — старт/стоп, удержание/ПКМ — настройки)")
          : "Случайный активный узел ASL (клик — старт/стоп, удержание/ПКМ — настройки)");

    const aslCurPage = getAslMatrixPage(cid, targetHs);
    const aslMoveClass = (targetHs && targetHs._aslMovingIdx !== null && targetHs._aslMovingIdx !== undefined) ? "asl-matrix-move-mode" : "";

    vfoAllStar.innerHTML = `
      <div class="allstar-top-section">
        <div class="allstar-top-left-actions">
          <button type="button" class="btn-allstar-scan" title="${window.t ? window.t("asl.scan_btn_title", {}, "Клик: запуск/остановка сканирования узлов (Scan: ON). Удержание: настройки сканирования") : "Клик: запуск/остановка сканирования узлов (Scan: ON). Удержание: настройки сканирования"}" data-i18n-title="asl.scan_btn_title">
            <span class="asl-scan-dot"></span>
            <span class="asl-action-text">Scan</span>
          </button>
          <button type="button" class="btn-allstar-unlink" title="${window.t ? window.t("asl.unlink_all_title", {}, "Разорвать все линки (*73). Удержание — меню памяти узлов") : "Разорвать все линки (*73). Удержание — меню памяти узлов"}" data-i18n-title="asl.unlink_all_title">
            <span class="asl-action-text">*73</span>
          </button>
          <button type="button" class="btn-allstar-dice${targetHs && targetHs._aslDiceRolling ? " dice-rolling" : ""}" title="${safeEscapeHtml(diceBtnTitle)}" aria-label="${safeEscapeHtml(diceBtnTitle)}" data-i18n-title="asl.dice_btn_title" data-i18n-aria-label="asl.dice_btn_title">
            <svg class="asl-dice-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect class="dice-border" x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fill-opacity="0.14"/>
              <circle class="dice-dot dot-1" cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>
              <circle class="dice-dot dot-2" cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/>
              <circle class="dice-dot dot-3" cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
              <circle class="dice-dot dot-4" cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/>
              <circle class="dice-dot dot-5" cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/>
            </svg>
          </button>
        </div>
        <div class="vfo-pipeline-stage asl-pipeline-stage">
          <div class="vfo-pipeline-icon icon-mic" title="Speech transcription (ASR)" data-i18n-title="vfo.pipeline_asr_title">
            <svg class="pipeline-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor" fill-opacity="0.2"/>
              <line x1="9" y1="5" x2="15" y2="5"/>
              <line x1="9" y1="8" x2="15" y2="8"/>
              <path d="M5 10a7 7 0 0 0 14 0"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
            </svg>
          </div>
          <div class="vfo-pipeline-icon icon-trans" title="Text translation" data-i18n-title="vfo.pipeline_trans_title">
            <svg class="pipeline-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="17 1 21 5 17 9"/>
              <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
              <polyline points="7 23 3 19 7 15"/>
              <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
          </div>
          <div class="vfo-pipeline-icon icon-tts" title="Speech synthesis (TTS)" data-i18n-title="vfo.pipeline_tts_title">
            <svg class="pipeline-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" fill-opacity="0.25"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
          </div>
        </div>
        <div class="allstar-top-right-actions">
          <span class="vfo-tts-badge asl-top-badge" id="vfoTtsBadge_${cid}" role="button" tabindex="0" title="Speech synthesis (TTS): click to toggle, hold to select voice" data-i18n-title="vfo.tts_single_title">
            <span class="tts-icon-spk">🔊</span>
            <span class="tts-lang-code">RUS</span>
          </span>
          <span class="vfo-lang-badge asl-top-badge" id="vfoLangBadge_${cid}" role="button" tabindex="0" title="Transcriber: click to toggle, hold for settings" data-i18n-title="vfo.transcriber_single_title">
            <span class="lang-icon-mic">🎙️</span>
            <span class="lang-code-text">TXT</span>
          </span>
        </div>
      </div>

      <div class="asl-slider-container" id="aslSliderContainer_${cid}">
        <!-- Top section: Speech transcript text drawer (collapsed by default) -->
        <div class="asl-text-panel" id="aslTextPanel_${cid}" inert>
          <div class="asl-live-caption-box vfo-caption-box" id="aslCaptionBox_${cid}" title="AI Speech Transcript" data-i18n-title="vfo.caption_box_title">
            <div class="vfo-caption-stream asl-caption-stream" id="aslCaptionStream_${cid}" data-i18n-empty="transcriber.waiting_speech" data-empty-text="🎙️ Waiting for speech..."></div>
          </div>
        </div>

        <!-- Notch splitter handle -->
        <div class="asl-dock-notch" id="aslDockNotch_${cid}" title="${window.t ? window.t("asl.notch_title", {}, "Swipe down or click: transcript text") : "Swipe down or click: transcript text"}" role="button" tabindex="0" aria-label="${window.t ? window.t("asl.notch_title", {}, "Swipe down or click: transcript text") : "Swipe down or click: transcript text"}" data-i18n-title="asl.notch_title" data-i18n-aria-label="asl.notch_title">
          <span class="asl-notch-pages" aria-hidden="true">${[0, 1, 2].map(pg => `<i class="asl-notch-seg${pg === aslCurPage ? " is-active" : ""}" data-page="${pg}" title="${window.t ? window.t("asl.page_indicator_title", { page: pg + 1, total: ASL_PAGE_COUNT }, `Page ${pg + 1} of ${ASL_PAGE_COUNT}`) : `Page ${pg + 1} of ${ASL_PAGE_COUNT}`}"></i>`).join("")}</span>
          <span class="asl-notch-dash-badge" id="aslNotchDashBadge_${cid}" aria-hidden="true">DASHBOARD 4×5</span>
        </div>

        <!-- Bottom section: Node memory slots (3 pages 4x5) OR Node dashboard (scrollable 4x5 matrix) -->
        <div class="asl-matrix-container${targetHs && targetHs._aslDashMatrixOpen ? " is-dash-view" : ""}" id="aslMatrixContainer_${cid}">
          <div class="asl-pages-viewport" id="aslPagesViewport_${cid}">
          ${[0, 1, 2].map(pg => {
            const pgPos = ((pg - aslCurPage + 4) % 3) - 1;
            return `<div class="asl-matrix-grid asl-page ${aslMoveClass}" data-page="${pg}" style="--asl-pos:${pgPos};"${pgPos !== 0 ? ' inert aria-hidden="true"' : ''}>
            ${displayNodes.slice(pg * ASL_PAGE_SIZE, (pg + 1) * ASL_PAGE_SIZE).map((pn, li) => {
              const idx = pg * ASL_PAGE_SIZE + li;
              const isEmpty = !pn.node;
              const isExternal = Boolean(pn.isExternal);
              const isDynamicEmpty = Boolean(pn.isDynamicEmpty);
              const cleanNode = !isEmpty ? String(pn.node).trim() : "";
              const linkMode = cleanNode ? (linkedModesMap.get(cleanNode) || "") : "";
              const stateClass = linkMode === "*3"
                ? "asl-node-linked-tx"
                : (linkMode === "*2" ? "asl-node-linked-monitor" : "");
              const externalClass = isExternal ? "asl-node-external-lilac" : "";
              const dynamicEmptyClass = isDynamicEmpty ? "asl-node-dynamic-slot" : "";
              const emptyNodeWord = window.t ? window.t("asl.empty_node_btn", {}, "Свободно") : "Свободно";
              const cfgHintWord = window.t ? window.t("asl.configure_node_btn", {}, "[настроить]") : "[настроить]";
              const nodeNum = cleanNode ? safeEscapeHtml(cleanNode) : emptyNodeWord;
              const nodeDesc = pn.label ? safeEscapeHtml(pn.label) : (isEmpty ? cfgHintWord : "");
              const isDtmf = !isEmpty && isAslDtmfCard(pn);
              const isScanOn = Boolean(pn.scan) && !isEmpty && !isDtmf;
              const roleClass = isDtmf ? "asl-node-role-dtmf" : "";
              const nodeFlag = isEmpty ? "➕" : (isDtmf ? "☎️" : (pn.flag || "🌐"));
              const isActive = !isEmpty && cleanNode === connNode;

              const isMoveModeActive = (targetHs && targetHs._aslMovingIdx !== null && targetHs._aslMovingIdx !== undefined);
              const isMovingSource = (isMoveModeActive && targetHs._aslMovingIdx === idx);
              const isMoveTarget = (isMoveModeActive && !isMovingSource);

              let titleText = "";
              const pnLabel = safeEscapeHtml(pn.label || "");
              const pfx = pnLabel ? pnLabel + " " : "";
              if (isMovingSource) {
                titleText = window.t ? window.t("asl.move_source_title", { node: cleanNode }, `Перемещение #${cleanNode}: выберите ячейку для переноса (клик по этой ячейке отменяет перенос)`) : `Перемещение #${cleanNode}: выберите ячейку для переноса (клик по этой ячейке отменяет перенос)`;
              } else if (isMoveModeActive) {
                const srcNode = displayNodes[targetHs._aslMovingIdx]?.node || "";
                titleText = isEmpty ? (window.t ? window.t("asl.move_to_empty", { node: srcNode }, `Перенести #${srcNode} в эту свободную ячейку`) : `Перенести #${srcNode} в эту свободную ячейку`) : (window.t ? window.t("asl.swap_with", { node: cleanNode }, `Поменять местами с #${cleanNode}`) : `Поменять местами с #${cleanNode}`);
              } else if (isEmpty) {
                titleText = isDynamicEmpty ? (window.t ? window.t("asl.empty_slot_dynamic", {}, "Свободный слот") : "Свободный слот") : (window.t ? window.t("asl.empty_cell_title", { idx: idx + 1 }, `Ячейка #${idx + 1}: Свободно - Клик: настроить узел`) : `Ячейка #${idx + 1}: Свободно - Клик: настроить узел`);
              } else if (isDtmf) {
                titleText = window.t ? window.t("asl.dtmf_tooltip", { code: nodeNum }, `Макрос DTMF «${nodeNum}» — Клик: передать DTMF (авто-TX), Удержание: меню действий`) : `Макрос DTMF «${nodeNum}» — Клик: передать DTMF (авто-TX), Удержание: меню действий`;
              } else if (linkMode === "*2") {
                titleText = window.t ? window.t("asl.node_tooltip_monitor_menu", { label: pfx, node: cleanNode }, `${pfx}(#${cleanNode}) [Монитор *2] — Клик: отключить узел (*1), Удержание: меню действий`) : `${pfx}(#${cleanNode}) [Монитор *2] — Клик: отключить узел (*1), Удержание: меню действий`;
              } else if (linkMode === "*3") {
                titleText = window.t ? window.t("asl.node_tooltip_tx_menu", { label: pfx, node: cleanNode }, `${pfx}(#${cleanNode}) [Передача *3] — Клик: отключить узел (*1), Удержание: меню действий`) : `${pfx}(#${cleanNode}) [Передача *3] — Клик: отключить узел (*1), Удержание: меню действий`;
              } else {
                titleText = window.t ? window.t("asl.node_tooltip_menu", { label: pfx, node: cleanNode }, `${pfx}(#${cleanNode}) - Клик: подключить, Удержание: меню действий`) : `${pfx}(#${cleanNode}) - Клик: подключить, Удержание: меню действий`;
              }
              const scanBadgeTitle = window.t ? window.t("asl.scan_badge_on", {}, "Scan: ВКЛ") : "Scan: ВКЛ";
              return `
                <button type="button" class="btn-allstar-node ${stateClass} ${externalClass} ${dynamicEmptyClass} ${isActive ? "active-asl-node" : ""} ${isEmpty ? "asl-node-empty" : ""} ${isMovingSource ? "asl-node-moving-source" : ""} ${isMoveTarget ? "asl-node-move-target" : ""} ${isScanOn ? "asl-node-scan-on" : ""} ${roleClass}" data-node="${cleanNode}" data-link-mode="${linkMode}" data-idx="${idx}" data-role="${isDtmf ? "dtmf" : "node"}" ${isExternal ? 'data-external="1"' : ''} title="${titleText}">
                  <div class="asl-btn-header">
                    <span class="asl-btn-flag">${nodeFlag}</span>
                    <strong class="asl-btn-num">${nodeNum}</strong>
                    ${isScanOn ? `<span class="asl-btn-scan-badge" title="${scanBadgeTitle}">S</span>` : ''}
                  </div>
                  <div class="asl-btn-footer">
                    ${isDtmf ? '<span class="asl-btn-conns asl-conns-dtmf">DTMF</span>' : '<span class="asl-btn-conns asl-conns-hidden"></span>'}
                    <small class="asl-btn-desc">${nodeDesc}</small>
                  </div>
                </button>
              `;
            }).join("")}
            </div>`;
          }).join("")}
          </div>
          <div class="asl-dash-grid-viewport" id="aslDashGridViewport_${cid}"></div>
        </div>
      </div>
    `;

    vfoAllStar.setAttribute("data-slot", "1");
    setupSlotTranscribeClick(vfoAllStar, 1);
    setupSlotTtsClick(vfoAllStar, 1);
    const aslTs1TranscribeActive = isSlotTranscribeActive(cid, 1);
    const aslTs1TtsActive = isSlotTtsActive(cid, 1);
    vfoAllStar.classList.toggle("has-transcribe", aslTs1TranscribeActive);
    updateSlotLangBadge(vfoAllStar, 1, aslTs1TranscribeActive);
    updateSlotTtsBadge(vfoAllStar, 1, aslTs1TtsActive);

    // Восстанавливаем накопленные сообщения живой транскрибации при обновлении матрицы
    if (prevStreamNodes.length > 0) {
      const nextStreamEl = vfoAllStar.querySelector(".asl-caption-stream");
      if (nextStreamEl) {
        prevStreamNodes.forEach(node => nextStreamEl.appendChild(node));
      }
    }

    // Управление шрифтом в окне транскрибации ASL (правый нижний угол)
    const aslCaptionBox = vfoAllStar.querySelector(".asl-live-caption-box");
    if (aslCaptionBox) {
      ensureCaptionFontControls(aslCaptionBox);
      setupCaptionBoxPinchZoom(aslCaptionBox);
    }

    // Manual refresh button removed - background automatic polling is active

    // Сразу синхронно применяем закэшированные бейджи коннектов и активные статусы до отрисовки кадра браузером
    syncAslMatrixButtonsState(card, targetHs);
    probeAslMatrixNodes(card, targetHs, false);

    // Управление шторкой ASL: Переключение между Матрицей 5x4 (по умолчанию) и Окном транскрибации речи
    const sliderContainer = vfoAllStar.querySelector(".asl-slider-container");
    const textPanel = vfoAllStar.querySelector(".asl-text-panel");
    const dockNotch = vfoAllStar.querySelector(".asl-dock-notch");
    const matrixContainer = vfoAllStar.querySelector(".asl-matrix-container");

    const setAslTextView = (isText) => {
      if (!sliderContainer) return;
      if (isText) {
        sliderContainer.classList.add("is-text-view");
        if (textPanel) textPanel.removeAttribute("inert");
        if (matrixContainer) matrixContainer.setAttribute("inert", "");
        if (dockNotch) {
          const mTitle = window.t ? window.t("asl.notch_title_matrix", {}, "Swipe up or click: Node Memory") : "Swipe up or click: Node Memory";
          dockNotch.title = mTitle;
          dockNotch.setAttribute("aria-label", mTitle);
        }
      } else {
        sliderContainer.classList.remove("is-text-view");
        if (textPanel) textPanel.setAttribute("inert", "");
        if (matrixContainer) matrixContainer.removeAttribute("inert");
        if (dockNotch) {
          const tTitle = window.t ? window.t("asl.notch_title", {}, "Swipe down or click: transcription text") : "Swipe down or click: transcription text";
          dockNotch.title = tTitle;
          dockNotch.setAttribute("aria-label", tTitle);
        }
      }
      if (vfoAllStar) {
        vfoAllStar.scrollTop = 0;
        vfoAllStar.scrollLeft = 0;
      }
    };

    vfoAllStar.setAslTextView = setAslTextView;
    if (wasTextView) {
      setAslTextView(true);
    }

    // Автоматическое переключение экрана при изменении статуса транскрибации (MutationObserver)
    if (vfoAllStar._transcribeObserver) {
      try { vfoAllStar._transcribeObserver.disconnect(); } catch (_) {}
    }
    let prevHasTranscribe = vfoAllStar.classList.contains("has-transcribe");
    const aslObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "class") {
          const curHasTranscribe = vfoAllStar.classList.contains("has-transcribe");
          if (curHasTranscribe !== prevHasTranscribe) {
            prevHasTranscribe = curHasTranscribe;
            setAslTextView(curHasTranscribe);
          }
        }
      }
    });
    aslObserver.observe(vfoAllStar, { attributes: true, attributeFilter: ["class"] });
    vfoAllStar._transcribeObserver = aslObserver;

    // Автоматическое переключение на панель текста при включении озвучки речи (TTS)
    const aslTtsBadge = vfoAllStar.querySelector(".vfo-tts-badge");
    if (aslTtsBadge) {
      aslTtsBadge.addEventListener("click", () => {
        setTimeout(() => {
          if (typeof isSlotTtsActive === "function" && isSlotTtsActive(cid, 1)) {
            setAslTextView(true);
          }
        }, 60);
      });
    }

    // Защита от паразитного скролла контейнера VFO при Tab-навигации
    if (vfoAllStar) {
      vfoAllStar.scrollTop = 0;
      vfoAllStar.scrollLeft = 0;
      vfoAllStar.addEventListener("scroll", () => {
        if (vfoAllStar.scrollTop !== 0) vfoAllStar.scrollTop = 0;
        if (vfoAllStar.scrollLeft !== 0) vfoAllStar.scrollLeft = 0;
      }, { passive: true });
    }

    // --- Экраны памяти узлов: 3 × (5×4), горизонтальный свайп по кругу ---
    const pagesViewport = vfoAllStar.querySelector(".asl-pages-viewport");
    const pageEls = pagesViewport ? Array.from(pagesViewport.querySelectorAll(".asl-page")) : [];
    const notchSegs = Array.from(vfoAllStar.querySelectorAll(".asl-notch-seg"));
    let aslPage = getAslMatrixPage(cid, targetHs);

    // Расставляет страницы по позициям -1 / 0 / +1 (по кругу). Страница, «перепрыгивающая» с -1 на +1 (или наоборот),
    // переставляется БЕЗ анимации, чтобы не пролетать через центр.
    const layoutAslPages = (page, animate) => {
      pageEls.forEach((el, pg) => {
        const oldPos = parseInt(el.style.getPropertyValue("--asl-pos") || "0", 10);
        const newPos = ((pg - page + 4) % 3) - 1;
        const noAnim = !animate || Math.abs(newPos - oldPos) === 2;
        if (noAnim) el.classList.add("no-anim");
        el.style.setProperty("--asl-pos", String(newPos));
        el.toggleAttribute("inert", newPos !== 0);
        el.setAttribute("aria-hidden", newPos !== 0 ? "true" : "false");
        if (noAnim) {
          void el.offsetWidth; // зафиксировать позицию без transition
          el.classList.remove("no-anim");
        }
      });
      notchSegs.forEach((seg, pg) => seg.classList.toggle("is-active", pg === page));
    };

    const resetAslPagesDrag = () => {
      if (!pagesViewport) return;
      pagesViewport.classList.remove("is-dragging");
      pagesViewport.style.setProperty("--asl-drag", "0px");
    };

    // delta = +1 (следующий экран, свайп влево) или -1 (предыдущий, свайп вправо)
    const goAslPage = (delta) => {
      if (!pagesViewport) return;
      aslPage = setAslMatrixPageValue(cid, targetHs, aslPage + delta);
      closeAslCardContextMenu(card, targetHs);
      document.querySelectorAll(".asl-card-edit-popover").forEach(el => el.remove());
      resetAslPagesDrag();
      layoutAslPages(aslPage, true);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate(12); } catch (_) {}
      }
      // Опрос статуса — только по узлам нового текущего экрана (бэкенд: > 20 узлов = без HTTP-статистики)
      probeAslMatrixNodes(card, targetHs, false);
    };

    // Глобальный флаг свайпа, чтобы клик по кнопке не срабатывал после жеста свайпа
    let wasSwipeGesture = false;
    let activePressTimer = null;

    const cancelActivePress = () => {
      if (activePressTimer) {
        clearTimeout(activePressTimer);
        activePressTimer = null;
      }
    };

    // --- Обработка жестов для Матрицы ---
    // Ось жеста фиксируется после 12 px: горизонтальная (x) — листание экранов памяти по кругу,
    // вертикальная (y) — свайп ВНИЗ открывает окно текста (как раньше).
    let matrixStartY = 0;
    let matrixStartX = 0;
    let isMatrixTracking = false;
    let isMatrixCaptured = false;
    let matrixAxis = null; // "x" | "y" | null
    let matrixLastDx = 0;
    let matrixStartTs = 0;

    const startMatrixDrag = (clientY, clientX) => {
      isMatrixTracking = true;
      isMatrixCaptured = false;
      matrixAxis = null;
      matrixLastDx = 0;
      matrixStartTs = Date.now();
      matrixStartY = clientY;
      matrixStartX = clientX;
    };

    const moveMatrixDrag = (clientY, clientX, pointerId, targetEl) => {
      if (!isMatrixTracking) return;
      const rawDx = clientX - matrixStartX;
      const dy = clientY - matrixStartY; // > 0 при движении вниз
      const dx = Math.abs(rawDx);

      if (!matrixAxis && Math.max(dx, Math.abs(dy)) > 12) {
        matrixAxis = dx > Math.abs(dy) ? "x" : "y";
        cancelActivePress();
        if (!isMatrixCaptured && targetEl && pointerId !== undefined) {
          isMatrixCaptured = true;
          try { targetEl.setPointerCapture(pointerId); } catch (_) {}
        }
        if (matrixAxis === "x" && pagesViewport) {
          pagesViewport.classList.add("is-dragging");
        }
      }

      if (matrixAxis === "x" && pagesViewport) {
        const w = pagesViewport.clientWidth || 1;
        matrixLastDx = Math.max(-w, Math.min(w, rawDx));
        pagesViewport.style.setProperty("--asl-drag", matrixLastDx + "px");
        return;
      }

      if (matrixAxis === "y" && dy > 25 && dy > dx * 0.9) {
        isMatrixTracking = false;
        cancelActivePress();
        wasSwipeGesture = true;
        setTimeout(() => { wasSwipeGesture = false; }, 320);
        if (targetEl && pointerId !== undefined) {
          try { targetEl.releasePointerCapture(pointerId); } catch (_) {}
        }
        setAslTextView(true);
      }
    };

    const endMatrixDrag = (pointerId, targetEl) => {
      const wasTracking = isMatrixTracking;
      isMatrixTracking = false;
      if (isMatrixCaptured && targetEl && pointerId !== undefined) {
        try { targetEl.releasePointerCapture(pointerId); } catch (_) {}
      }
      isMatrixCaptured = false;

      // Завершение горизонтального свайпа (защита от двойного вызова pointerup + touchend: только при wasTracking)
      if (wasTracking && matrixAxis === "x" && pagesViewport) {
        const w = pagesViewport.clientWidth || 1;
        const dt = Math.max(1, Date.now() - matrixStartTs);
        const absDx = Math.abs(matrixLastDx);
        const velocity = absDx / dt; // px/мс
        const passed = absDx > w * 0.22 || (velocity > 0.45 && absDx > 24);
        wasSwipeGesture = true;
        setTimeout(() => { wasSwipeGesture = false; }, 320);
        if (passed) {
          goAslPage(matrixLastDx < 0 ? 1 : -1);
        } else {
          resetAslPagesDrag();
        }
      }
      matrixAxis = null;
    };

    if (matrixContainer) {
      matrixContainer.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        startMatrixDrag(e.clientY, e.clientX);
        // Не вызываем setPointerCapture на pointerdown, чтобы не ломать клики мыши
      });
      matrixContainer.addEventListener("pointermove", (e) => {
        // Мышь: кнопку отпустили вне контейнера — жест завершён
        if (e.pointerType === "mouse" && e.buttons === 0 && isMatrixTracking) {
          endMatrixDrag(e.pointerId, matrixContainer);
          return;
        }
        moveMatrixDrag(e.clientY, e.clientX, e.pointerId, matrixContainer);
      });
      matrixContainer.addEventListener("pointerup", (e) => {
        endMatrixDrag(e.pointerId, matrixContainer);
      });
      matrixContainer.addEventListener("pointercancel", (e) => {
        endMatrixDrag(e.pointerId, matrixContainer);
      });

      // Touch fallback для максимальной совместимости
      matrixContainer.addEventListener("touchstart", (e) => {
        if (e.touches && e.touches[0]) {
          startMatrixDrag(e.touches[0].clientY, e.touches[0].clientX);
        }
      }, { passive: true });
      matrixContainer.addEventListener("touchmove", (e) => {
        if (e.touches && e.touches[0]) {
          moveMatrixDrag(e.touches[0].clientY, e.touches[0].clientX);
        }
      }, { passive: true });
      matrixContainer.addEventListener("touchend", () => endMatrixDrag(), { passive: true });
      matrixContainer.addEventListener("touchcancel", () => endMatrixDrag(), { passive: true });
    }

    // --- Обработка жестов для Текстового окна (Свайп ВВЕРХ -> возврат к матрице) ---
    let textStartY = 0;
    let textStartX = 0;
    let isTextTracking = false;

    const startTextDrag = (clientY, clientX) => {
      isTextTracking = true;
      textStartY = clientY;
      textStartX = clientX;
    };

    const moveTextDrag = (clientY, clientX, pointerId, targetEl) => {
      if (!isTextTracking) return;
      const dy = textStartY - clientY; // > 0 при движении вверх
      const dx = Math.abs(clientX - textStartX);
      if (dy > 25 && dy > dx * 0.9) {
        isTextTracking = false;
        wasSwipeGesture = true;
        setTimeout(() => { wasSwipeGesture = false; }, 320);
        if (targetEl && pointerId !== undefined) {
          try { targetEl.releasePointerCapture(pointerId); } catch (_) {}
        }
        setAslTextView(false);
      }
    };

    const endTextDrag = (pointerId, targetEl) => {
      isTextTracking = false;
      if (targetEl && pointerId !== undefined) {
        try { targetEl.releasePointerCapture(pointerId); } catch (_) {}
      }
    };

    if (textPanel) {
      textPanel.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        startTextDrag(e.clientY, e.clientX);
        try { textPanel.setPointerCapture(e.pointerId); } catch (_) {}
      });
      textPanel.addEventListener("pointermove", (e) => {
        moveTextDrag(e.clientY, e.clientX, e.pointerId, textPanel);
      });
      textPanel.addEventListener("pointerup", (e) => {
        endTextDrag(e.pointerId, textPanel);
      });
      textPanel.addEventListener("pointercancel", (e) => {
        endTextDrag(e.pointerId, textPanel);
      });

      // Touch fallback
      textPanel.addEventListener("touchstart", (e) => {
        if (e.touches && e.touches[0]) {
          startTextDrag(e.touches[0].clientY, e.touches[0].clientX);
        }
      }, { passive: true });
      textPanel.addEventListener("touchmove", (e) => {
        if (e.touches && e.touches[0]) {
          moveTextDrag(e.touches[0].clientY, e.touches[0].clientX);
        }
      }, { passive: true });
      textPanel.addEventListener("touchend", () => endTextDrag(), { passive: true });
      textPanel.addEventListener("touchcancel", () => endTextDrag(), { passive: true });
    }

    // --- Обработка клика и свайпа на самой плашке-разделителе (Notch handle) ---
    if (dockNotch) {
      let notchStartY = 0;
      let isNotchTracking = false;

      dockNotch.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        isNotchTracking = true;
        notchStartY = e.clientY;
        try { dockNotch.setPointerCapture(e.pointerId); } catch (_) {}
      });
      dockNotch.addEventListener("pointermove", (e) => {
        if (!isNotchTracking) return;
        const dy = e.clientY - notchStartY;
        const isCurrentText = sliderContainer ? sliderContainer.classList.contains("is-text-view") : false;
        // Тянем вниз из режима матрицы -> открываем текст
        if (!isCurrentText && dy > 20) {
          isNotchTracking = false;
          wasSwipeGesture = true;
          setTimeout(() => { wasSwipeGesture = false; }, 320);
          try { dockNotch.releasePointerCapture(e.pointerId); } catch (_) {}
          setAslTextView(true);
        }
        // Тянем вверх из режима текста -> открываем матрицу
        else if (isCurrentText && dy < -20) {
          isNotchTracking = false;
          wasSwipeGesture = true;
          setTimeout(() => { wasSwipeGesture = false; }, 320);
          try { dockNotch.releasePointerCapture(e.pointerId); } catch (_) {}
          setAslTextView(false);
        }
      });
      dockNotch.addEventListener("pointerup", (e) => {
        isNotchTracking = false;
        try { dockNotch.releasePointerCapture(e.pointerId); } catch (_) {}
      });
      dockNotch.addEventListener("pointercancel", (e) => {
        isNotchTracking = false;
        try { dockNotch.releasePointerCapture(e.pointerId); } catch (_) {}
      });

      dockNotch.addEventListener("click", (e) => {
        e.stopPropagation();
        if (wasSwipeGesture) return;
        const isCurrentText = sliderContainer ? sliderContainer.classList.contains("is-text-view") : false;
        setAslTextView(!isCurrentText);
      });
      dockNotch.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const isCurrentText = sliderContainer ? sliderContainer.classList.contains("is-text-view") : false;
          setAslTextView(!isCurrentText);
        }
      });
    }

    // Закрытие текстового окна по клавише Escape
    vfoAllStar.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sliderContainer && sliderContainer.classList.contains("is-text-view")) {
        setAslTextView(false);
      }
    });

    // --- Модальное окно управления памятью узлов AllStarLink ---
    const openAslMatrixManageModal = (targetCid, targetCard, hsData, currentNodes) => {
      const existing = document.getElementById("aslMatrixManageModal");
      if (existing) existing.remove();

      const modal = document.createElement("div");
      modal.id = "aslMatrixManageModal";
      modal.className = "asl-matrix-modal-backdrop";
      const tm = (key, fallback) => (window.t ? window.t(key, {}, fallback) : fallback);
      modal.innerHTML = `
        <div class="asl-matrix-modal-card" role="dialog" aria-modal="true" aria-labelledby="aslModalTitle">
          <div class="asl-modal-header">
            <div class="asl-modal-title-wrap">
              <span class="asl-modal-icon">⚙️</span>
              <h3 id="aslModalTitle" class="asl-modal-title">${tm("asl.mem_modal_title", "Память Узлов AllStarLink")}</h3>
            </div>
            <button type="button" class="asl-modal-close" title="${tm("asl.edit_close_esc", "Закрыть (Esc)")}">✕</button>
          </div>
          <p class="asl-modal-subtitle">${tm("asl.mem_modal_subtitle", "Выберите действие для памяти из 60 ячеек (3 экрана по 20):")}</p>

          <div class="asl-modal-actions">
            <button type="button" class="asl-modal-btn asl-btn-reset-zero" data-action="zero">
              <span class="asl-btn-action-icon">🧹</span>
              <div class="asl-btn-action-text">
                <strong>${tm("asl.mem_zero_title", "Сброс в «ноль»")}</strong>
                <small>${tm("asl.mem_zero_desc", "Полная очистка всех 60 ячеек (все ячейки станут [+] Свободно)")}</small>
              </div>
            </button>

            <button type="button" class="asl-modal-btn asl-btn-reset-default" data-action="default">
              <span class="asl-btn-action-icon">🔄</span>
              <div class="asl-btn-action-text">
                <strong>${tm("asl.mem_default_title", "Сброс в «по умолчанию»")}</strong>
                <small>${tm("asl.mem_default_desc", "Восстановить сохранённый шаблон по умолчанию (или базовый список из 20 узлов)")}</small>
              </div>
            </button>

            <button type="button" class="asl-modal-btn asl-btn-save-default" data-action="save_default">
              <span class="asl-btn-action-icon">💾</span>
              <div class="asl-btn-action-text">
                <strong>${tm("asl.mem_save_default_title", "Сохранить текущую как «по умолчанию»")}</strong>
                <small>${tm("asl.mem_save_default_desc", "Перезаписать всю память (3 экрана) в качестве нового шаблона по умолчанию ⭐")}</small>
              </div>
            </button>
          </div>

          <div class="asl-modal-footer">
            <button type="button" class="asl-modal-cancel-btn">${tm("asl.mem_cancel", "Отмена")}</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      requestAnimationFrame(() => modal.classList.add("is-visible"));

      const closeModal = () => {
        modal.classList.remove("is-visible");
        setTimeout(() => { modal.remove(); }, 200);
      };

      modal.querySelector(".asl-modal-close").addEventListener("click", closeModal);
      modal.querySelector(".asl-modal-cancel-btn").addEventListener("click", closeModal);
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });

      const onKey = (e) => {
        if (e.key === "Escape") {
          closeModal();
          document.removeEventListener("keydown", onKey);
        }
      };
      document.addEventListener("keydown", onKey);

      modal.querySelectorAll(".asl-modal-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const act = btn.dataset.action;
          if (act === "zero") {
            const emptyNodes = Array.from({ length: ASL_MEMORY_SIZE }, () => makeEmptyAslCell());
            saveAslUserNodes(targetCid, emptyNodes);
            closeModal();
            updateCardAllStarPanel(targetCard, hsData);
            if (typeof showToast === "function") {
              showToast(tm("asl.mem_toast_zero", "Память узлов очищена (все 60 ячеек пусты)"), "info", 3000);
            }
          } else if (act === "default") {
            const defNodes = getDefaultNodes(targetCid);
            saveAslUserNodes(targetCid, defNodes);
            closeModal();
            updateCardAllStarPanel(targetCard, hsData);
            if (typeof showToast === "function") {
              showToast(tm("asl.mem_toast_default", "Память узлов сброшена к значениям по умолчанию"), "success", 3000);
            }
          } else if (act === "save_default") {
            const tplNodes = padAslNodes(currentNodes);
            setServerCollectionKey("asl_default_nodes", targetCid, tplNodes, "proxdmr_asl_default_nodes_", true);
            setServerCollectionKey("asl_default_nodes", "global", tplNodes, "proxdmr_asl_default_nodes_", true);
            closeModal();
            if (typeof showToast === "function") {
              showToast(tm("asl.mem_toast_saved_default", "Текущая память сохранена как новый шаблон по умолчанию ⭐"), "success", 3500);
            }
          }
        });
      });
    };

    // Connect / disconnect node on click / context menu on long-press (для всех кнопок матрицы)
    vfoAllStar.querySelectorAll(".btn-allstar-node").forEach(btn => {
      let isLongPress = false;
      const idx = parseInt(btn.dataset.idx, 10);

      const isNodeCurrentlyLinked = () => {
        const n = String(btn.dataset.node || "").trim();
        if (!n) return false;
        if (btn.dataset.linkMode === "*2" || btn.dataset.linkMode === "*3") return true;
        if (btn.dataset.connecting === "true") return true;
        if (targetHs && targetHs._aslConnectingNodes instanceof Map && targetHs._aslConnectingNodes.has(n)) return true;
        if (targetHs && String(targetHs.connected_node || "").trim() === n) return true;
        if (targetHs && Array.isArray(targetHs.asl_links)) {
          return targetHs.asl_links.some(x => String(x.node).trim() === n);
        }
        return false;
      };

      const triggerDisconnectNode = (nodeToDisc) => {
        const cleanN = String(nodeToDisc || "").trim();
        if (!cleanN) return;
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try { navigator.vibrate(45); } catch (_) {}
        }
        aslDisconnectNodeProcedure(cid, cleanN, { showStatusBanner: true, showCardEffects: true });
      };

      const clearAllHoldTimers = () => {
        cancelActivePress();
      };

      const triggerConnect = () => {
        const n = btn.dataset.node;
        if (!n) return;
        const cleanTargetN = String(n).trim();
        const isEchoNode = (cleanTargetN === "1999" || cleanTargetN === "9999");

        if (isEchoNode) {
          if (targetHs) targetHs._aslLinkMode = "*3";
          btn.dataset.linkMode = "*3";
          if (typeof window.setHotspotAslMode === "function") {
            window.setHotspotAslMode(cid, "*3");
          }
          if (typeof window.updateHotspotTsAudioModeUI === "function") {
            window.updateHotspotTsAudioModeUI(cid);
          }
          aslConnectNodeProcedure(cid, cleanTargetN, "*3", { showStatusBanner: true, showCardEffects: true });
          return;
        }

        const currentMode = (typeof window.getHotspotAslMode === "function") ? window.getHotspotAslMode(cid) : "*2";
        aslConnectNodeProcedure(cid, cleanTargetN, currentMode, { showStatusBanner: true, showCardEffects: true });
      };

      const triggerEdit = () => {
        openAslCardEditPopover({ idx, cid, card, targetHs, userNodes });
      };

      const startHold = (e) => {
        isLongPress = false;
        clearAllHoldTimers();

        activePressTimer = setTimeout(() => {
          isLongPress = true;
          if (!btn.dataset.node) {
            triggerEdit();
          } else {
            openAslCardContextMenu({
              btn, idx, cid, card, targetHs, userNodes,
              triggerConnect, triggerDisconnectNode, isNodeCurrentlyLinked
            });
          }
        }, 650);
      };

      const endHold = (e) => {
        clearAllHoldTimers();
        if (isLongPress) {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      };

      btn.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        startHold(e);
      });
      btn.addEventListener("touchstart", (e) => {
        startHold(e);
      }, { passive: true });
      btn.addEventListener("mouseup", (e) => endHold(e));
      btn.addEventListener("touchend", (e) => endHold(e));
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isLongPress) return;
        if (!btn.dataset.node) {
          triggerEdit();
        } else {
          openAslCardContextMenu({
            btn, idx, cid, card, targetHs, userNodes,
            triggerConnect, triggerDisconnectNode, isNodeCurrentlyLinked
          });
        }
      });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isLongPress || wasSwipeGesture) {
          e.preventDefault();
          isLongPress = false;
          return;
        }

        // Если активен режим переноса карточки (Move)
        if (targetHs && targetHs._aslMovingIdx !== null && targetHs._aslMovingIdx !== undefined) {
          clearAslMoveCancelListener();
          const sourceIdx = Number(targetHs._aslMovingIdx);
          const targetIdx = idx;
          targetHs._aslMovingIdx = null;

          if (
            Number.isInteger(sourceIdx) &&
            sourceIdx >= 0 && sourceIdx < ASL_MEMORY_SIZE &&
            targetIdx >= 0 && targetIdx < ASL_MEMORY_SIZE &&
            sourceIdx !== targetIdx
          ) {
            const temp = userNodes[sourceIdx];
            userNodes[sourceIdx] = userNodes[targetIdx] || { node: "", label: "", flag: "➕", scan: false };
            userNodes[targetIdx] = temp;
            saveAslUserNodes(cid, userNodes);
          }

          updateCardAllStarPanel(card, targetHs);
          return;
        }

        // Если ячейка пустая -> открываем настройку узла
        const clickedNode = String(btn.dataset.node || "").trim();
        if (!clickedNode) {
          triggerEdit();
          return;
        }

        // Если это карточка DTMF-макроса!
        if (btn.dataset.role === "dtmf") {
          executeAslDtmfMacroAction(cid, card, btn, clickedNode);
          return;
        }

        // Если карточка уже законекчена (или подключается) -> одинарный клик производит её дисконнект
        if (isNodeCurrentlyLinked()) {
          if (targetHs && targetHs._aslScanActive) {
            stopAslMatrixScan(cid, card, targetHs, { keepCurrentLink: false, silent: true });
          }
          triggerDisconnectNode(clickedNode);
          return;
        }

        // Ручной клик по ноде останавливает активное сканирование
        if (targetHs && targetHs._aslScanActive) {
          stopAslMatrixScan(cid, card, targetHs, { keepCurrentLink: true, silent: true });
        }

        triggerConnect();
      });
    });

    // Scan button
    const scanBtn = vfoAllStar.querySelector(".btn-allstar-scan");
    if (scanBtn) {
      if (targetHs && targetHs._aslScanActive) {
        scanBtn.classList.add("scan-running");
      }
      let scanHoldTimer = null;
      let isScanLongPress = false;

      const startScanHold = (e) => {
        isScanLongPress = false;
        if (scanHoldTimer) clearTimeout(scanHoldTimer);
        scanHoldTimer = setTimeout(() => {
          isScanLongPress = true;
          scanHoldTimer = null;
          if (navigator.vibrate) {
            try { navigator.vibrate([40, 30, 40]); } catch (_) {}
          }
          openAslScanSettingsPopover(cid, scanBtn, card);
        }, 550);
      };

      const clearScanHold = () => {
        if (scanHoldTimer) {
          clearTimeout(scanHoldTimer);
          scanHoldTimer = null;
        }
      };

      scanBtn.addEventListener("pointerdown", startScanHold);
      scanBtn.addEventListener("pointerup", clearScanHold);
      scanBtn.addEventListener("pointercancel", clearScanHold);
      scanBtn.addEventListener("pointerleave", clearScanHold);

      scanBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearScanHold();
        openAslScanSettingsPopover(cid, scanBtn, card);
      });

      scanBtn.onclick = (e) => {
        e.stopPropagation();
        if (isScanLongPress) {
          isScanLongPress = false;
          return;
        }
        if (targetHs && targetHs._aslScanActive) {
          stopAslMatrixScan(cid, card, targetHs, { keepCurrentLink: true });
        } else {
          startAslMatrixScan(cid, card, targetHs, userNodes);
        }
      };
    }

    // Unlink button: клик — *73 (разорвать все линки), долгое удержание (900 мс) — окно «Память Узлов»
    const unlinkBtn = vfoAllStar.querySelector(".btn-allstar-unlink");
    if (unlinkBtn) {
      const UNLINK_HOLD_MS = 900;
      let unlinkHoldTimer = null;
      let unlinkHoldFired = false;

      const clearUnlinkHold = () => {
        if (unlinkHoldTimer) {
          clearTimeout(unlinkHoldTimer);
          unlinkHoldTimer = null;
        }
        unlinkBtn.classList.remove("is-holding");
      };

      const startUnlinkHold = (e) => {
        if (e && e.button !== undefined && e.button !== 0) return;
        unlinkHoldFired = false;
        clearUnlinkHold();
        unlinkBtn.classList.add("is-holding");
        unlinkHoldTimer = setTimeout(() => {
          unlinkHoldTimer = null;
          unlinkHoldFired = true;
          unlinkBtn.classList.remove("is-holding");
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            try { navigator.vibrate([40, 40, 40]); } catch (_) {}
          }
          closeAslCardContextMenu(card, targetHs);
          openAslMatrixManageModal(cid, card, targetHs, userNodes);
        }, UNLINK_HOLD_MS);
      };

      unlinkBtn.addEventListener("pointerdown", startUnlinkHold);
      ["pointerup", "pointerleave", "pointercancel"].forEach(evtName => {
        unlinkBtn.addEventListener(evtName, clearUnlinkHold);
      });
      unlinkBtn.addEventListener("contextmenu", (e) => e.preventDefault());

      unlinkBtn.onclick = (e) => {
        e.stopPropagation();
        if (unlinkHoldFired) {
          // Удержание уже открыло окно памяти — этот «хвостовой» клик НЕ должен разрывать линки
          unlinkHoldFired = false;
          e.preventDefault();
          return;
        }
        if (targetHs && targetHs._aslScanActive) {
          stopAslMatrixScan(cid, card, targetHs, { keepCurrentLink: false, silent: true });
        }
        if (targetHs && targetHs._aslDiceRolling) {
          stopAslDiceSearch(cid, card, targetHs, { immediateAbort: true, silent: true });
        }
        aslDisconnectNodeProcedure(cid, "all", { showStatusBanner: true, showCardEffects: true });
      };
    }

    // Random active node (Dice) button: клик — старт/стоп, удержание/ПКМ — настройки
    const diceBtn = vfoAllStar.querySelector(".btn-allstar-dice:not(.btn-adn-dice)");
    if (diceBtn) {
      let diceHoldTimer = null;
      let diceLong = false;
      let diceDownX = 0;
      let diceDownY = 0;
      const cancelDiceHold = () => {
        if (diceHoldTimer) {
          clearTimeout(diceHoldTimer);
          diceHoldTimer = null;
        }
      };

      diceBtn.addEventListener("pointerdown", (e) => {
        if (e && e.button !== undefined && e.button !== 0) return;
        diceLong = false;
        diceDownX = e.clientX || 0;
        diceDownY = e.clientY || 0;
        cancelDiceHold();
        diceHoldTimer = setTimeout(() => {
          diceLong = true;
          diceHoldTimer = null;
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            try { navigator.vibrate([40, 30, 40]); } catch (_) {}
          }
          openAslDiceSettingsPopover({ cid, card, targetHs, anchorEl: diceBtn });
        }, 550);
      });

      diceBtn.addEventListener("pointermove", (e) => {
        if (!diceHoldTimer) return;
        const dx = (e.clientX || 0) - diceDownX;
        const dy = (e.clientY || 0) - diceDownY;
        if ((dx * dx + dy * dy) > 100) {
          cancelDiceHold();
        }
      });

      diceBtn.addEventListener("pointerup", cancelDiceHold);
      diceBtn.addEventListener("pointerleave", cancelDiceHold);
      diceBtn.addEventListener("pointercancel", cancelDiceHold);
      diceBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelDiceHold();
        openAslDiceSettingsPopover({ cid, card, targetHs, anchorEl: diceBtn });
      });

      diceBtn.onclick = (e) => {
        e.stopPropagation();
        if (diceLong) {
          diceLong = false;
          return;
        }
        if (targetHs && targetHs._aslDiceRolling) {
          stopAslDiceSearch(cid, card, targetHs, { finishInnerIteration: true });
          return;
        }
        rollRandomKeyedAslNode(cid, card, targetHs, userNodes, diceBtn);
      };
    }



    // Отмена режима Move при клике мимо матрицы
    clearAslMoveCancelListener();
    if (targetHs && targetHs._aslMovingIdx !== null && targetHs._aslMovingIdx !== undefined) {
      const onMoveCancelClick = (e) => {
        if (!targetHs || targetHs._aslMovingIdx === null || targetHs._aslMovingIdx === undefined) {
          clearAslMoveCancelListener();
          return;
        }
        if (!e.target.closest(".asl-matrix-grid") && !e.target.closest(".asl-card-context-menu")) {
          clearAslMoveCancelListener();
          targetHs._aslMovingIdx = null;
          updateCardAllStarPanel(card, targetHs);
        }
      };
      const timerId = setTimeout(() => {
        document.addEventListener("click", onMoveCancelClick, true);
      }, 30);
      _activeAslMoveCleanup = () => {
        clearTimeout(timerId);
        document.removeEventListener("click", onMoveCancelClick, true);
      };
    }

    // Add button removed - strict single-node mode enforced

    // "Dashboard node" + Auto-Open Checkbox pair setup for AllStar
    const audioRxPair = card.querySelector(".control-pair-btn.audio-rx-pair");
    const oldCtcssPair = card.querySelector(".control-pair-btn.allstar-ctcss-pair");
    if (oldCtcssPair) oldCtcssPair.remove();
    const oldCodecPair = card.querySelector(".control-pair-btn.allstar-codec-pair");
    if (oldCodecPair) oldCodecPair.remove();

    const dsdPair = card.querySelector(".control-pair-btn.dsd-pair, .control-pair-btn.ambe-pair");
    if (dsdPair) dsdPair.style.display = "none";

    let dashPair = card.querySelector(".control-pair-btn.allstar-dash-pair");
    if (!dashPair && audioRxPair && audioRxPair.parentElement) {
      const btnTitle = window.t
        ? window.t("asl.dash_btn_title", {}, "Открыть / закрыть дашборд подключенного узла (список всех участников хаба и индикация говорящего)")
        : "Открыть / закрыть дашборд подключенного узла (список всех участников хаба и индикация говорящего)";
      const chkTitle = window.t
        ? window.t("asl.dash_auto_title", {}, "Автооткрытие дашборда узла при подключении")
        : "Автооткрытие дашборда узла при подключении";
      const btnLabel = window.t
        ? window.t("asl.dash_btn_label", {}, "Dashboard")
        : "Dashboard";

      dashPair = document.createElement("div");
      dashPair.className = "control-pair-btn allstar-dash-pair";
      dashPair.innerHTML = `
        <button type="button" class="btn-action-trigger btn-asl-dash-trigger" title="${safeEscapeHtml(btnTitle)}" data-i18n-title="asl.dash_btn_title">
          <span class="btn-action-label" data-i18n="asl.dash_btn_label">${safeEscapeHtml(btnLabel)}</span>
        </button>
        <div class="preset-dropdown-wrapper asl-dash-auto-wrap" title="${safeEscapeHtml(chkTitle)}" data-i18n-title="asl.dash_auto_title">
          <label class="asl-dash-auto-label">
            <input type="checkbox" class="chk-asl-dash-auto" aria-label="${safeEscapeHtml(chkTitle)}" />
          </label>
        </div>
      `;
      audioRxPair.parentElement.insertBefore(dashPair, audioRxPair);
    }

    if (dashPair) {
      dashPair.style.display = "inline-flex";
      const isDashOpenForCard = Boolean(targetHs && targetHs._aslDashMatrixOpen);
      dashPair.classList.toggle("dash-open", isDashOpenForCard);
      if (sliderContainer) {
        sliderContainer.classList.toggle("is-dash-mode", isDashOpenForCard);
      }
      if (isDashOpenForCard) {
        renderAslNodeDashboard(cid);
      }

      const actionTrigger = dashPair.querySelector(".btn-asl-dash-trigger");
      const autoWrap = dashPair.querySelector(".asl-dash-auto-wrap");
      const autoChk = dashPair.querySelector(".chk-asl-dash-auto");

      const isAutoOpen = isAslDashAutoOpenEnabled(cid);
      if (autoChk) {
        autoChk.checked = isAutoOpen;
      }

      // Keep backend CTCSS 300Hz HPF filter enabled by default (once per WS session)
      const ws = (typeof getWs === "function" ? getWs() : window.ws);
      if (ws && ws.readyState === WebSocket.OPEN && targetHs && targetHs._sentAslCtcssWs !== ws) {
        targetHs._sentAslCtcssWs = ws;
        ws.send(JSON.stringify({ type: "allstar_ctcss_filter", hotspot_id: cid, enabled: true }));
      }

      if (actionTrigger && !actionTrigger._wired) {
        actionTrigger._wired = true;
        actionTrigger.onclick = (e) => {
          e.stopPropagation();
          if (typeof window.toggleAslNodeDashboard === "function") {
            window.toggleAslNodeDashboard(cid);
          }
        };
      }

      if (autoWrap && autoChk && !autoChk._wired) {
        autoChk._wired = true;
        autoWrap.onclick = (e) => {
          e.stopPropagation();
          if (e.target !== autoChk && !(e.target && e.target.closest && e.target.closest("label"))) {
            autoChk.checked = !autoChk.checked;
            autoChk.dispatchEvent(new Event("change"));
          }
        };
        autoChk.onchange = (e) => {
          e.stopPropagation();
          const enabled = Boolean(autoChk.checked);
          setAslDashAutoOpenEnabled(cid, enabled);
          if (typeof showToast === "function") {
            const msgOn = window.t
              ? window.t("asl.dash_auto_on_toast", {}, "✅ Автооткрытие дашборда узла при коннекте включено")
              : "✅ Автооткрытие дашборда узла при коннекте включено";
            const msgOff = window.t
              ? window.t("asl.dash_auto_off_toast", {}, "⏸️ Автооткрытие дашборда узла при коннекте отключено")
              : "⏸️ Автооткрытие дашборда узла при коннекте отключено";
            showToast(enabled ? msgOn : msgOff, "info", 2000);
          }
        };
      }
    }

    // Wire Contacts button on AllStar card to open contacts filtered for AllStar
    const contactsBtn = card.querySelector(".btn-my-contacts") || card.querySelector(".btn-open-contacts");
    if (contactsBtn) {
      const cLbl = contactsBtn.querySelector(".ptt-side-label");
      if (cLbl) {
        cLbl.textContent = window.t ? window.t("contacts.button_label", {}, "Контакты") : "Контакты";
        cLbl.setAttribute("data-i18n", "contacts.button_label");
      }
      contactsBtn.title = window.t ? window.t("contacts.btn_open_title", {}, "Справочник контактов и узлов AllStarLink") : "Справочник контактов и узлов AllStarLink";
      contactsBtn.setAttribute("data-i18n-title", "contacts.btn_open_title");
      contactsBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof window.openMyContactsModal === "function") {
          window.openMyContactsModal(cid, "dmr");
        }
      };
    }

    // Single-channel VU meter tooltips (no TS1 / TS2)
    const vuWrap = card.querySelector(".screen-clock-vu");
    const vuTs1Track = card.querySelector(".clock-vu-track.track-ts1");
    const singleVuTip = window.t ? window.t("vfo.vu_single_title", {}, "Индикатор уровня звука") : "Индикатор уровня звука";
    if (vuWrap) {
      vuWrap.setAttribute("title", singleVuTip);
      vuWrap.setAttribute("data-i18n-title", "vfo.vu_single_title");
    }
    if (vuTs1Track) {
      vuTs1Track.setAttribute("title", singleVuTip);
      vuTs1Track.setAttribute("data-i18n-title", "vfo.vu_single_title");
    }

    // Unified ASL Nodes Directory button wiring
    const btnAslDir = card.querySelector(".btn-asl-nodes-dir");
    if (btnAslDir && !btnAslDir._aslWired) {
      btnAslDir._aslWired = true;
      btnAslDir.onclick = (e) => {
        e.stopPropagation();
        if (typeof window.openMyContactsModal === "function") {
          window.openMyContactsModal(cid, "allstar_dir");
        }
      };
    }

    // Quick direct dial placeholder and tooltips for AllStar
    const quickInput = card.querySelector(".quick-tg-input");
    const quickBox = card.querySelector(".quick-tg-box");
    const quickApply = card.querySelector(".btn-quick-tg-apply");
    const aslDialTip = window.t ? window.t("asl.quick_dial_node_tip", {}, "Быстрый набор номера ноды AllStarLink (Enter для подключения)") : "Быстрый набор номера ноды AllStarLink (Enter для подключения)";
    if (quickInput) {
      quickInput.placeholder = "Node #";
      quickInput.setAttribute("title", aslDialTip);
      quickInput.setAttribute("data-i18n-title", "asl.quick_dial_node_tip");
    }
    if (quickBox) {
      quickBox.setAttribute("title", aslDialTip);
      quickBox.setAttribute("data-i18n-title", "asl.quick_dial_node_tip");
    }
    if (quickApply) {
      quickApply.setAttribute("title", aslDialTip);
      quickApply.setAttribute("data-i18n-title", "asl.quick_dial_node_tip");
    }

    // Direct JS visibility toggle for ASL directory button
    const btnSrch = card.querySelector(".btn-srch-tg-id");
    if (btnSrch) btnSrch.style.display = "none";
    if (btnAslDir) btnAslDir.style.display = "flex";

    if (typeof window.updateCardTsAudioModeUI === "function") {
      window.updateCardTsAudioModeUI(card, cid);
    }

    if (typeof updateCardPttHint === "function") {
      updateCardPttHint(card);
    }
    if (typeof window.renderQuickMemButtons === "function") {
      window.renderQuickMemButtons(cid);
    }
    if (prevAslPopover) {
      vfoAllStar.style.position = "relative";
      vfoAllStar.appendChild(prevAslPopover);
    }
  } else {
    const labelWrap = card.querySelector(".bm-server-label-wrap");
    if (labelWrap) labelWrap.style.removeProperty("display");
    const selectEl = card.querySelector(".bm-server-select");
    if (selectEl) selectEl.style.removeProperty("display");
    const aslHeaderBadge = card.querySelector(".asl-header-status-badge");
    if (aslHeaderBadge) aslHeaderBadge.style.display = "none";
    const btnSrch = card.querySelector(".btn-srch-tg-id");
    const btnAslDir = card.querySelector(".btn-asl-nodes-dir");
    if (btnSrch) btnSrch.style.removeProperty("display");
    if (btnAslDir) btnAslDir.style.display = "none";
    if (vfoAllStar) vfoAllStar.style.setProperty("display", "none", "important");
    if (!card.classList.contains("card-net-xlx")) {
      if (vfoTs1) vfoTs1.style.removeProperty("display");
    }
    if (vfoTs2) vfoTs2.style.removeProperty("display");
    const isM17Card = card.classList.contains("card-net-m17") || (card.dataset.networkType === "m17");
    const dsdPair = card.querySelector(".control-pair-btn.dsd-pair, .control-pair-btn.ambe-pair");
    if (dsdPair) {
      if (isM17Card) {
        dsdPair.style.setProperty("display", "none", "important");
      } else {
        dsdPair.style.removeProperty("display");
      }
    }
    const codecPair = card.querySelector(".control-pair-btn.allstar-codec-pair");
    const ctcssPair = card.querySelector(".control-pair-btn.allstar-ctcss-pair");
    const dashPair = card.querySelector(".control-pair-btn.allstar-dash-pair");
    if (codecPair) codecPair.style.display = "none";
    if (ctcssPair) ctcssPair.style.display = "none";
    if (dashPair) dashPair.style.display = "none";
    if (!isM17Card) {
      const m17DashPair = card.querySelector(".control-pair-btn.m17-dash-pair");
      const m17DashDrawer = card.querySelector(".m17-dash-drawer");
      const m17Triple = card.querySelector(".btn-m17-triple");
      if (m17DashPair) m17DashPair.style.display = "none";
      if (m17DashDrawer) m17DashDrawer.style.display = "none";
      if (m17Triple) m17Triple.style.display = "none";
    }

    const isYsfCard = card.classList.contains("card-net-ysf") || (card.dataset.networkType === "ysf");
    const quickInput = card.querySelector(".quick-tg-input");
    const quickBox = card.querySelector(".quick-tg-box");
    const quickApply = card.querySelector(".btn-quick-tg-apply");
    const vuWrap = card.querySelector(".screen-clock-vu");
    const vuTs1Track = card.querySelector(".clock-vu-track.track-ts1");

    if (isYsfCard) {
      const ysfDialTip = window.t ? window.t("ysf.quick_dial_tip", {}, "Быстрый переход в комнату YSF по номеру ID (Enter для подключения)") : "Быстрый переход в комнату YSF по номеру ID (Enter для подключения)";
      if (quickInput) {
        quickInput.placeholder = "ID #";
        quickInput.setAttribute("title", ysfDialTip);
        quickInput.setAttribute("data-i18n-title", "ysf.quick_dial_tip");
      }
      if (quickBox) {
        quickBox.setAttribute("title", ysfDialTip);
        quickBox.setAttribute("data-i18n-title", "ysf.quick_dial_tip");
      }
      if (quickApply) {
        quickApply.setAttribute("title", ysfDialTip);
        quickApply.setAttribute("data-i18n-title", "ysf.quick_dial_tip");
      }
      const singleVuTip = window.t ? window.t("vfo.vu_single_title", {}, "Индикатор уровня звука") : "Индикатор уровня звука";
      if (vuWrap) {
        vuWrap.setAttribute("title", singleVuTip);
        vuWrap.setAttribute("data-i18n-title", "vfo.vu_single_title");
      }
      if (vuTs1Track) {
        vuTs1Track.setAttribute("title", singleVuTip);
        vuTs1Track.setAttribute("data-i18n-title", "vfo.vu_single_title");
      }
    } else {
      const tgBoxTip = window.t ? window.t("ptt.quick_tg_box_title", {}, "Быстрый набор TG на передачу (введите номер и нажмите Enter или кнопку)") : "Быстрый набор TG на передачу (введите номер и нажмите Enter или кнопку)";
      const tgApplyTip = window.t ? window.t("ptt.quick_tg_apply_title", {}, "Установить TalkGroup для передачи") : "Установить TalkGroup для передачи";
      if (quickInput) {
        quickInput.placeholder = "TG #";
        quickInput.setAttribute("title", tgBoxTip);
        quickInput.setAttribute("data-i18n-title", "ptt.quick_tg_box_title");
      }
      if (quickBox) {
        quickBox.setAttribute("title", tgBoxTip);
        quickBox.setAttribute("data-i18n-title", "ptt.quick_tg_box_title");
      }
      if (quickApply) {
        quickApply.setAttribute("title", tgApplyTip);
        quickApply.setAttribute("data-i18n-title", "ptt.quick_tg_apply_title");
      }
      const vuDualTip = window.t ? window.t("clocks.vu_title", {}, "Индикаторы уровня TS1 / TS2") : "Индикаторы уровня TS1 / TS2";
      const vuTs1Tip = window.t ? window.t("vfo.vu_bar_title", {}, "Уровень звука TS1") : "Уровень звука TS1";
      if (vuWrap) {
        vuWrap.setAttribute("title", vuDualTip);
        vuWrap.setAttribute("data-i18n-title", "clocks.vu_title");
      }
      if (vuTs1Track) {
        vuTs1Track.setAttribute("title", vuTs1Tip);
        vuTs1Track.setAttribute("data-i18n-title", "vfo.vu_bar_title");
      }
    }
  }
}


export function ensureTopToolbarControls() {
    const toolbar = document.getElementById("proxdmrTopToolbar");
    if (!toolbar) return;
    const rightCluster = toolbar.querySelector("#toolbarRightCluster") || toolbar;

    const isApk = (typeof window.isProxDmrApkMode === "function")
      ? window.isProxDmrApkMode()
      : Boolean(
          (window.AndroidBridge && (
            typeof window.AndroidBridge.exitApp === "function" ||
            typeof window.AndroidBridge.exitAppWithTexts === "function"
          )) ||
          (document.body && document.body.classList.contains("is-apk-mode")) ||
          (document.documentElement && document.documentElement.classList.contains("is-apk-mode"))
        );

    const themeBtn = toolbar.querySelector("#themeToggleBtn, .theme-toggle-btn");
    if (themeBtn) {
      themeBtn.style.removeProperty("display");
      if (typeof window.wireThemeToggleButton === "function") {
        window.wireThemeToggleButton(themeBtn);
      }
      if (typeof window.applyThemeUI === "function") {
        const activeTheme = (typeof window.getTheme === "function") ? window.getTheme() : (document.documentElement.getAttribute("data-theme") || "dark");
        window.applyThemeUI(activeTheme);
      }
    }

    if (isApk) {
      if (document.body) document.body.classList.add("is-apk-mode");
      if (document.documentElement) document.documentElement.classList.add("is-apk-mode");
      rightCluster.querySelectorAll(".fullscreen-toggle-btn:not(.android-exit-btn)").forEach(el => el.remove());

      let exitBtn = rightCluster.querySelector(".android-exit-btn");
      if (!exitBtn) {
        exitBtn = document.createElement("button");
        exitBtn.type = "button";
        exitBtn.className = "fullscreen-toggle-btn android-exit-btn";
        exitBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        rightCluster.appendChild(exitBtn);
      }
      exitBtn.style.removeProperty("display");
      const exitTitle = (typeof window.t === "function")
        ? window.t("app.quit_title", {}, "Полный выход из приложения")
        : "Полный выход из приложения";
      exitBtn.title = exitTitle;
      exitBtn.setAttribute("aria-label", exitTitle);
      if (typeof window.wireAndroidExitButton === "function") {
        window.wireAndroidExitButton(exitBtn);
      }
    } else {
      rightCluster.querySelectorAll(".android-exit-btn").forEach(el => el.remove());
      let fsBtn = rightCluster.querySelector(".fullscreen-toggle-btn:not(.android-exit-btn)");
      if (!fsBtn) {
        fsBtn = document.createElement("button");
        fsBtn.type = "button";
        fsBtn.className = "fullscreen-toggle-btn";
        fsBtn.setAttribute("data-i18n-title", "vfo.fullscreen_enter_title");
        fsBtn.setAttribute("data-i18n-aria-label", "vfo.fullscreen_enter_title");
        fsBtn.innerHTML = `
          <svg class="fullscreen-icon enter" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
          <svg class="fullscreen-icon exit" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
            <path d="M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6l7 7M10 4v6m0 0H4m6 0L3 3m10 7h6m-6 0V4m0 6l7-7"/>
          </svg>
        `;
        rightCluster.appendChild(fsBtn);
      }
      fsBtn.style.removeProperty("display");
      if (typeof window.updateFullscreenButtonsUI === "function") {
        window.updateFullscreenButtonsUI();
      }
    }
}

export function ensurePrimaryHotspotHeaderButtons(card, _isPrimaryIgnored) {
    if (!card) return;
    if (card.id === "radioContainer" && (_hotspotsLoadedOnce || (card.dataset.hotspotId && card.dataset.hotspotId !== "default"))) {
      card.removeAttribute("id");
    }
    card.classList.remove("is-primary-fixed", "is-draggable-hotspot");
    const headerBrandRow = card.querySelector(".header-brand-row");
    if (!headerBrandRow) return;
    card.querySelectorAll(".brand-logo-wrap").forEach(el => el.remove());
    headerBrandRow.querySelectorAll("#themeToggleBtn, .theme-toggle-btn, .fullscreen-toggle-btn, .android-exit-btn, .hotspot-delete-btn").forEach(el => el.remove());
    ensureTopToolbarControls();
}

export function renderRadiosGrid() {
    const radiosGrid = document.getElementById("radiosGrid");
    if (!radiosGrid) return;

    radiosGrid.querySelectorAll(".collapsed-hotspots-stack").forEach(stack => {
      while (stack.firstChild) {
        radiosGrid.insertBefore(stack.firstChild, stack);
      }
      stack.remove();
    });

    ensureTopToolbarControls();

    const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length)
      ? window.currentHotspots
      : (Array.isArray(currentHotspots) && currentHotspots.length ? currentHotspots : []);
    const displayHotspots = allHs.filter(h => !h.hidden).slice(0, 7);
    const emptyHint = document.getElementById("archivedWorkspaceEmptyHint");

    if (!displayHotspots.length) {
      if (_hotspotsLoadedOnce) {
        radiosGrid.querySelectorAll(".radio-container").forEach(c => c.remove());
        if (emptyHint) emptyHint.style.display = "flex";
      } else {
        const staticCard = document.getElementById("radioContainer") || radiosGrid.querySelector(".radio-container");
        if (staticCard) ensurePrimaryHotspotHeaderButtons(staticCard, false);
        if (emptyHint) emptyHint.style.display = "none";
      }
      if (typeof renderToolbarHotspotSlots === "function") {
        renderToolbarHotspotSlots();
      }
      return;
    }

    if (emptyHint) emptyHint.style.display = "none";

    const template = document.getElementById("radioCardTemplate");
    const existingCards = Array.from(radiosGrid.querySelectorAll(".radio-container"));
    const allowedIds = new Set(displayHotspots.map(h => h.id));

    // Remove archived or deleted cards (including SSR #radioContainer if its hotspot was archived/deleted)
    existingCards.forEach((c) => {
      const cid = c.dataset.hotspotId;
      if (cid && !allowedIds.has(cid)) {
        c.remove();
      }
    });

    displayHotspots.forEach((hs, idx) => {
      let card = radiosGrid.querySelector(`.radio-container[data-hotspot-id="${hs.id}"]`);
      if (!card && template) {
        card = template.content.firstElementChild.cloneNode(true);
        card.dataset.hotspotId = hs.id;
        card.dataset.networkType = (hs.network_type || "bm").toLowerCase();
        if (window.I18N) window.I18N.apply(card);
        radiosGrid.appendChild(card);
      }
      if (!card) return;
      const cardCid = resolveHotspotId(card.dataset.hotspotId || hs.id || "default");

      // Keep strict DOM order matching displayHotspots (idx === 0 has zero special anchoring)
      if (card.parentElement === radiosGrid) {
        radiosGrid.appendChild(card);
      }

      // All hotspots are equal (no card dragging; reordering is in Top Toolbar & Archive Modal)
      card.classList.remove("is-primary-fixed", "is-draggable-hotspot");
      ensurePrimaryHotspotHeaderButtons(card, false);

      card.classList.toggle("active-hotspot", hs.id === activeHotspotId);

      // Collapse state sync
      const isCollapsed = isHotspotCollapsed(hs.id);
      const isLive = isHotspotLiveCollapsed(hs.id);
      card.classList.toggle("collapsed", isCollapsed);
      card.classList.toggle("live-collapsed", isCollapsed && isLive);
      const collapseBtn = card.querySelector(".hotspot-collapse-btn");
      if (collapseBtn) {
        collapseBtn.title = isCollapsed
          ? (window.t ? window.t("vfo.hotspot_expand_title", {}, "Expand this hotspot (hold: move to archive)") : "Expand this hotspot (hold: move to archive)")
          : (window.t ? window.t("vfo.hotspot_collapse_title", {}, "Collapse this hotspot (hold: collapse without disconnecting)") : "Collapse this hotspot (hold: collapse without disconnecting)");
      }

      // Populate text (hide header name badge when name is empty or auto-generated "Хотспот #N" / "Hotspot #N")
      const nameBadge = card.querySelector(".hotspot-name-badge");
      if (nameBadge) {
        nameBadge.removeAttribute("data-i18n");
        const rawHsName = String((hs && hs.name) || "").trim();
        const isAutoDefaultName = !rawHsName || /^(?:хотспот|hotspot)\s*#?\s*\d+$/i.test(rawHsName);
        if (isAutoDefaultName) {
          nameBadge.textContent = "";
          nameBadge.title = "";
          nameBadge.style.display = "none";
          nameBadge.classList.remove("is-online");
        } else {
          nameBadge.style.display = "";
          nameBadge.textContent = rawHsName;
          nameBadge.title = rawHsName;
          nameBadge.classList.toggle("is-online", (!isCollapsed || isLive) && isHotspotFullyOnline(hs));
        }
      }

      const duplexBadge = card.querySelector(".duplex-badge");
      if (duplexBadge) duplexBadge.textContent = "DUPLEX";

      const isAslNet = ((hs && hs.network_type) || card.dataset.networkType || "").toLowerCase() === "allstar";
      const isYsfNet = ((hs && hs.network_type) || card.dataset.networkType || "").toLowerCase() === "ysf";
      const csDisplay = card.querySelector(".callsign-display");
      if (csDisplay && !isAslNet && !isYsfNet) {
        if (!csDisplay.dataset.rawCallsign) csDisplay.dataset.rawCallsign = hs.callsign || "N0CALL";
        const effCs = (window.localizeDemoText ? window.localizeDemoText(hs.callsign) : hs.callsign) || "N0CALL";
        csDisplay.textContent = effCs;
      }

      const idDisplay = card.querySelector(".dmr-id-display");
      if (idDisplay) idDisplay.textContent = `ID: ${hs.effective_id || hs.dmr_id || 0}`;

      const netTypeLower = ((hs && hs.network_type) || card.dataset.networkType || "bm").toLowerCase();
      ["bm", "tgif", "freedmr", "xlx", "dmrplus", "allstar", "custom", "adn", "ysf"].forEach(n => {
        card.classList.toggle(`card-net-${n}`, netTypeLower === n);
      });
      card.dataset.networkType = netTypeLower;
      applyCardBrandColors(card, netTypeLower);
      try {
        if (hs && hs.id) {
          localStorage.setItem(`proxdmr_net_type_${hs.id}`, netTypeLower);
        }
      } catch (_) {}

      updateCardBmBanner(card, hs);

      const isXlxNet = netTypeLower === "xlx";
      card.classList.toggle("card-net-xlx", isXlxNet);

      const isDmrPlusNet = netTypeLower === "dmrplus";
      card.classList.toggle("card-net-dmrplus", isDmrPlusNet);

      updateCardXlxPanel(card, hs);
      updateCardDmrPlusPanel(card, hs);
      updateCardAllStarPanel(card, hs);
      updateCardYsfPanel(card, hs);
      syncAdnDiceButtonUI(card, hs);
      setupAdnDiceButton(card, card.dataset.hotspotId || hs.id, hs);
      if (isXlxNet) {
        setCardSlot(card, 2, false);
      }

      // PTT button TS1 disabled badge for XLX
      const cardPttEl = card.querySelector(".ptt-button");
      if (cardPttEl) {
        const ts1PttBadge = cardPttEl.querySelector(".ptt-slot-ts1");
        if (ts1PttBadge) ts1PttBadge.classList.toggle("ptt-slot-disabled", isXlxNet);
      }

      const tg1Num = card.querySelector(".tg-ts1-num");
      if (tg1Num) {
        const cid = card.dataset.hotspotId || hs.id;
        if (netTypeLower === "ysf") {
          const ysfRoomNum = hs.ysf_room || hs.ysf_room_id || "";
          tg1Num.textContent = ysfRoomNum ? `#${ysfRoomNum}` : "#---";
          tg1Num.style.cursor = "default";
          tg1Num.removeAttribute("title");
          tg1Num.onclick = null;
        } else {
          const curTg1 = getHotspotTg(cid, 1);
          tg1Num.textContent = `TG ${curTg1}`;
          tg1Num.style.cursor = "pointer";
          tg1Num.title = window.t ? window.t("hotspots.tg1_select_title", {}, "Кликните для выбора группы или ID на TS1") : "Кликните для выбора группы или ID на TS1";
          tg1Num.onclick = (e) => {
            e.stopPropagation();
            const curNet = String(getHotspotNetworkType(card) || (hs && hs.network_type) || "bm").toLowerCase();
            if (curNet === "ysf") return;
            if (curNet === "xlx") {
              const warnMsg = window.t
                ? window.t("hotspots.xlx_ts1_blocked_toast", {}, "В сети XLX таймслот 1 не поддерживается протоколом. Используйте TS2.")
                : "В сети XLX таймслот 1 не поддерживается протоколом. Используйте TS2.";
              showToast(warnMsg, 3000);
              return;
            }
            switchActiveHotspot(cid);
            setCardSlot(card, 1, true);
            openTgTxUseModal(1, cid);
          };
        }
      }

      const tg2Num = card.querySelector(".tg-ts2-num");
      if (tg2Num) {
        const cid = card.dataset.hotspotId || hs.id;
        const curNet = netTypeLower;
        if (curNet === "ysf") {
          const ysfRoomNum = hs.ysf_room || hs.ysf_room_id || "";
          tg2Num.textContent = ysfRoomNum ? `#${ysfRoomNum}` : "#---";
          tg2Num.style.cursor = "default";
          tg2Num.removeAttribute("title");
          tg2Num.onclick = null;
        } else if (curNet === "dmrplus") {
          tg2Num.textContent = "TG 9 (Reflector)";
          tg2Num.style.cursor = "pointer";
          tg2Num.title = window.t ? window.t("dmrplus.ts2_voice_hint", {}, "Голос на TS2 всегда в TG 9") : "Голос на TS2 всегда в TG 9";
          tg2Num.onclick = (e) => {
            e.stopPropagation();
            switchActiveHotspot(cid);
            setCardSlot(card, 2, true);
            openTgTxUseModal(2, cid);
          };
        } else if (curNet === "xlx") {
          tg2Num.textContent = "TG 9 (Reflector)";
          tg2Num.style.cursor = "pointer";
          tg2Num.title = window.t ? window.t("hotspots.xlx_ts2_voice_hint", {}, "В сети XLX связь ведётся на TS2 / TG 9") : "В сети XLX связь ведётся на TS2 / TG 9";
          tg2Num.onclick = (e) => {
            e.stopPropagation();
            switchActiveHotspot(cid);
            setCardSlot(card, 2, true);
          };
        } else {
          const curTg2 = getHotspotTg(cid, 2);
          tg2Num.textContent = `TG ${curTg2}`;
          tg2Num.style.cursor = "pointer";
          tg2Num.title = window.t ? window.t("hotspots.tg2_select_title", {}, "Кликните для выбора группы или ID на TS2") : "Кликните для выбора группы или ID на TS2";
          tg2Num.onclick = (e) => {
            e.stopPropagation();
            switchActiveHotspot(cid);
            setCardSlot(card, 2, true);
            openTgTxUseModal(2, cid);
          };
        }
      }

      // Hydrate active server RX slot state onto card before updating mode badge & REC UI
      if (isAslNet) {
        const aslActive = Boolean((hs.ts1 && hs.ts1.active) || hs._aslCarrierRx || (card._lastRx && card._lastRx[1] && card._lastRx[1].active));
        if (aslActive) {
          if (!card._lastRx) card._lastRx = {};
          card._lastRx[1] = Object.assign({ slot: 1, network_type: "allstar" }, card._lastRx[1] || {}, {
            active: true,
            src_id: (hs.ts1 && hs.ts1.src_id) || (card._lastRx[1] && card._lastRx[1].src_id) || 0,
            src_callsign: (hs.ts1 && hs.ts1.src_callsign) || (card._lastRx[1] && card._lastRx[1].src_callsign) || "",
            lastAudioTime: (hs.ts1 && hs.ts1.last_seen) || (card._lastRx[1] && card._lastRx[1].lastAudioTime) || (Date.now() / 1000),
          });
          const vfoAsl = card.querySelector(".vfo-allstar-row");
          if (vfoAsl) vfoAsl.classList.add("allstar-rx-active");
          if (typeof window.updateCardModeBadge === "function") window.updateCardModeBadge(card);
        }
      } else {
        let hydratedRx = false;
        [1, 2].forEach(sNum => {
          const st = sNum === 1 ? hs.ts1 : hs.ts2;
          const isSlotLive = Boolean((st && st.active) || (sNum === 1 && isYsfNet && hs._ysfCarrierRx));
          if (isSlotLive) {
            hydratedRx = true;
            if (!card._lastRx) card._lastRx = {};
            card._lastRx[sNum] = Object.assign(
              { slot: sNum, network_type: netTypeLower },
              card._lastRx[sNum] || {},
              st || {},
              {
                active: true,
                timestamp: (st && st.last_seen) || (card._lastRx[sNum] && card._lastRx[sNum].timestamp) || (Date.now() / 1000),
                lastAudioTime: (st && st.last_seen) || (card._lastRx[sNum] && card._lastRx[sNum].lastAudioTime) || (Date.now() / 1000),
              }
            );
            const vfoRow = card.querySelector(sNum === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
            const rxTag = card.querySelector(sNum === 1 ? ".vfo-ts1-rx" : ".vfo-ts2-rx");
            if (vfoRow) vfoRow.classList.add("vfo-rx-active");
            if (rxTag) rxTag.classList.add("active");
          }
        });
        if (hydratedRx) {
          updateCardTgDisplay(card);
          if (typeof window.updateCardModeBadge === "function") window.updateCardModeBadge(card);
        }
      }

      // Update per-hotspot mute and pan state in UI
      updateCardMuteUI(card, hs.id);
      updateCardPanUI(card, hs.id);
      updateCardRecUI(card, hs.id);
      if (typeof updateHotspotGwStatus === "function") {
        const isWsOpen = Boolean(window.ws && window.ws.readyState === WebSocket.OPEN);
        updateHotspotGwStatus(hs.id, isWsOpen);
      }
      if (window.recordingsManager && typeof window.recordingsManager.updateCardTranscribeUI === "function") {
        window.recordingsManager.updateCardTranscribeUI(hs.id);
      }

      // Delete button is removed from card header (deletion is exclusively handled in Hotspot Settings)
      const delBtn = card.querySelector(".hotspot-delete-btn");
      if (delBtn) {
        delBtn.remove();
      }

      // Status badges
      updateBmStatus(hs.status, hs.detail, hs.id);

      const apiBadge = card.querySelector(".api-status-badge");
      const apiDetail = card.querySelector(".api-detail-text");
      const apiRow = card.querySelector(".api-status-row");
      const netType = ((hs && hs.network_type) || "bm").toLowerCase();

      if (netType !== "bm" && netType !== "tgif") {
        renderHotspotAuxStatusBadge(card, hs);
      } else {
        const isTgif = (netType === "tgif");
        const apiDomain = isTgif ? "api.tgif.network" : "api.brandmeister.network";
        const netShort = isTgif ? "TGIF" : "BM";
        const netVersion = isTgif ? "v1" : "v2";
        const hasApiKey = Boolean(hs.bm_api_key && hs.bm_api_key.trim().length > 8);

        if (!hasApiKey) {
          hs._apiStatus = "NO_KEY";
        } else if (!hs._apiStatus) {
          hs._apiStatus = "CHECKING";
        }

        const apiStatus = hs._apiStatus || (hasApiKey ? "CHECKING" : "NO_KEY");
        let apiBadgeClass = "status-offline bm-offline";
        let apiBadgeText = "API:OFFLINE";
        let apiComment = window.t ? window.t("status.api_no_key_detail", {}, "Key not configured (click to enter)") : "Key not configured (click to enter)";
        let apiTooltip = window.t
          ? window.t("status.api_no_key_tooltip", { net: netShort }, `⚪ ${netShort} API: Key not configured. Click to enter`)
          : `⚪ ${netShort} API: Key not configured. Click to enter`;

        if (apiStatus === "ONLINE") {
          apiBadgeClass = "status-online bm-online";
          apiBadgeText = "API:ONLINE";
          apiComment = hs._apiDetail
            ? `${apiDomain} (${hs._apiDetail})`
            : (window.t ? window.t("status.api_authorized_domain", { domain: apiDomain }, `${apiDomain} (Authorized)`) : `${apiDomain} (Authorized)`);
          apiTooltip = window.t
            ? window.t("status.api_authorized_tooltip", { net: netShort, ver: netVersion }, `🟢 ${netShort} API ${netVersion}: Authorized. Click to re-check`)
            : `🟢 ${netShort} API ${netVersion}: Authorized. Click to re-check`;
        } else if (apiStatus === "CHECKING") {
          apiBadgeClass = "status-connecting bm-connecting";
          apiBadgeText = "API:CHECKING";
          apiComment = isTgif
            ? (window.t ? window.t("status.api_checking_tgif", {}, "Checking TGIF token...") : "Checking TGIF token...")
            : (window.t ? window.t("status.api_checking_detail", {}, "Checking v2 token...") : "Checking v2 token...");
          apiTooltip = window.t
            ? window.t("status.api_checking_tooltip", { net: netShort }, `🟡 ${netShort} API: Checking connection...`)
            : `🟡 ${netShort} API: Checking connection...`;
        } else if (apiStatus === "AUTH_FAILED") {
          apiBadgeClass = "status-error bm-error";
          apiBadgeText = "API:AUTH FAIL";
          apiComment = hs._apiDetail || (isTgif
            ? (window.t ? window.t("status.api_auth_tgif_detail", {}, "Invalid TGIF token (401)") : "Invalid TGIF token (401)")
            : (window.t ? window.t("status.api_auth_detail", {}, "Invalid token (401 Unauthorized)") : "Invalid token (401 Unauthorized)"));
          apiTooltip = window.t
            ? window.t("status.api_auth_tooltip", { net: netShort, comment: apiComment }, `🔴 ${netShort} API: ${apiComment}. Click to configure`)
            : `🔴 ${netShort} API: ${apiComment}. Click to configure`;
        } else if (apiStatus === "NO_KEY") {
          apiBadgeClass = "status-offline bm-offline";
          apiBadgeText = "API:NO KEY";
          apiComment = window.t ? window.t("status.api_no_key_detail", {}, "Key not configured (click to enter)") : "Key not configured (click to enter)";
          apiTooltip = window.t
            ? window.t("status.api_no_key_tooltip", { net: netShort }, `⚪ ${netShort} API: Key not configured. Click to enter`)
            : `⚪ ${netShort} API: Key not configured. Click to enter`;
        } else if (apiStatus === "OFFLINE" || apiStatus === "ERROR") {
          apiBadgeClass = "status-error bm-error";
          apiBadgeText = "API:ERROR";
          apiComment = hs._apiDetail || (window.t ? window.t("status.api_server_unreachable", { domain: apiDomain }, `Server ${apiDomain} unreachable`) : `Server ${apiDomain} unreachable`);
          apiTooltip = window.t
            ? window.t("status.api_error_tooltip", { net: netShort, comment: apiComment }, `🔴 ${netShort} API: ${apiComment}. Click to re-check`)
            : `🔴 ${netShort} API: ${apiComment}. Click to re-check`;
        }

        if (apiBadge) {
          apiBadge.className = `status-badge bm-badge api-status-badge ${apiBadgeClass}`;
          apiBadge.textContent = apiBadgeText;
          apiBadge.title = apiTooltip;
        }
        if (apiDetail) {
          apiDetail.textContent = apiComment;
          apiDetail.title = apiTooltip;
        }
        if (apiRow) {
          apiRow.title = apiTooltip;
        }
      }

      // Wire card events
      if (!card._cardWired) {
        card._cardWired = true;

        card.addEventListener("click", (e) => {
          const cardCid = resolveHotspotId(card.dataset.hotspotId || hs.id);
          if (isHotspotCollapsed(cardCid) || card.classList.contains("collapsed")) {
            if (e.target.closest("button, input, select, a, .theme-toggle-btn, #themeToggleBtn, .hotspot-collapse-btn, .fullscreen-toggle-btn, .header-settings-btn, .header-bm-upload-indicator")) {
              return;
            }
            const lastAction = (typeof window !== "undefined" && window._lastHotspotCollapseActionTimes && (window._lastHotspotCollapseActionTimes[cardCid] || window._lastHotspotCollapseActionTimes["default"])) || 0;
            if (Date.now() - lastAction < 700) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            toggleHotspotCollapse(cardCid);
            return;
          }
          if (!e.target.closest("button") && !e.target.closest("input") && !e.target.closest("select") && !e.target.closest(".toggle-control") && !e.target.closest(".header-bm-upload-indicator")) {
            switchActiveHotspot(hs.id);
          }
        });

        const btnAdd = card.querySelector(".btn-add-hotspot");
        if (btnAdd) {
          btnAdd.addEventListener("click", (e) => {
            e.stopPropagation();
            triggerAddNewHotspot();
          });
        }

        const btnSet = card.querySelector(".btn-settings, .header-settings-btn");
        if (btnSet) {
          btnSet.onclick = (e) => {
            if (e) {
              e.preventDefault();
              e.stopPropagation();
            }
            const cid = card.dataset.hotspotId || hs.id;
            switchActiveHotspot(cid);
            const curHs = currentHotspots.find(h => h.id === cid) || hs;
            openHotspotSettings(curHs);
          };
        }

        const btnRec = card.querySelector(".header-rec-btn");
        if (btnRec) {
          btnRec.onclick = (e) => {
            e.stopPropagation();
            const cid = resolveHotspotId(card.dataset.hotspotId || hs.id);
            toggleHotspotAutoRecord(cid);
          };
        }

        const btnTranscribe = card.querySelector(".btn-hs-transcribe");
        if (btnTranscribe) {
          btnTranscribe.onclick = (e) => {
            e.stopPropagation();
            const cid = resolveHotspotId(card.dataset.hotspotId || hs.id);
            if (window.recordingsManager) {
              window.recordingsManager.handleOfflineTranscribeClick(cid);
            }
          };
          if (window.recordingsManager && typeof window.recordingsManager.updateCardTranscribeUI === "function") {
            window.recordingsManager.updateCardTranscribeUI(resolveHotspotId(card.dataset.hotspotId || hs.id));
          }
        }

        const btnLog = card.querySelector(".btn-log-drawer");
        if (btnLog) {
          btnLog.onclick = (e) => {
            e.stopPropagation();
            const currentCid = card.dataset.hotspotId || hs.id;
            handleCardLogClick(currentCid);
          };
        }
        wireCardStatusInteractions(card, hs);

        const handleHotspotManageAction = (cid) => {
          const curHs = (window.currentHotspots || []).find(h => h.id === cid) || hs;
          const curNet = ((curHs && curHs.network_type) || "bm").toLowerCase();
          if (curNet !== "bm" && curNet !== "tgif" && curNet !== "freedmr" && curNet !== "adn" && curNet !== "xlx") {
            openHotspotSettings(curHs, "tab-edit-hs");
            setTimeout(() => {
              const targetId = "editHsRptoOptions";
              const el = document.getElementById(targetId);
              if (el && typeof el.focus === "function") {
                el.focus();
                if (typeof el.scrollIntoView === "function") {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }
            }, 140);
            showToast(window.t ? window.t("hotspots.rpto_manage_hint", {}, "⚙️ Задайте статические группы (TS1 / TS2) в поле RPTO Options и нажмите «Отправить»") : "⚙️ Задайте статические группы (TS1 / TS2) в поле RPTO Options и нажмите «Отправить»", 3200);
            return;
          }
          openBmTgStaticModal(cid);
        };

        const btnStatic = card.querySelector(".btn-bm-static-edit");
        if (btnStatic) {
          if (netType === "tgif") {
            btnStatic.title = window.t ? window.t("hotspots.manage_tg_tgif_title", {}, "Manage TGIF TalkGroups (Static / Dynamic)") : "Manage TGIF TalkGroups (Static / Dynamic)";
          } else if (netType === "freedmr") {
            btnStatic.title = window.t ? window.t("hotspots.manage_tg_freedmr_title", {}, "Manage FreeDMR TalkGroups (Static / Dynamic)") : "Manage FreeDMR TalkGroups (Static / Dynamic)";
          } else if (netType === "adn") {
            btnStatic.title = window.t ? window.t("hotspots.manage_tg_adn_title", {}, "Manage ADN TalkGroups (Static / Dynamic)") : "Manage ADN TalkGroups (Static / Dynamic)";
          } else if (netType === "xlx") {
            btnStatic.title = window.t ? window.t("hotspots.manage_xlx_title", {}, "Manage XLX Modules (A–Z / TG 9)") : "Manage XLX Modules (A–Z / TG 9)";
          } else if (netType === "bm") {
            btnStatic.title = window.t ? window.t("hotspots.manage_tg_bm_title", {}, "Manage BM TalkGroups (Static / Dynamic)") : "Manage BM TalkGroups (Static / Dynamic)";
          }
          btnStatic.onclick = (e) => {
            e.stopPropagation();
            const cid = card.dataset.hotspotId || hs.id;
            handleHotspotManageAction(cid);
          };
        }

        const btnReset = card.querySelector(".btn-bm-dynamic-reset");
        if (btnReset) {
          btnReset.onclick = async (e) => {
            e.stopPropagation();
            const cid = card.dataset.hotspotId || hs.id;
            await dropDynamicTGs(cid, btnReset);
          };
        }

        const btnSrch = card.querySelector(".btn-srch-tg-id");
        if (btnSrch) {
          if (netType === "tgif") {
            btnSrch.title = window.t ? window.t("hotspots.srch_tgif_title", {}, "TG: search groups | Manage: TGIF TG management | ID: callsign/ID lookup") : "TG: search groups | Manage: TGIF TG management | ID: callsign/ID lookup";
          } else if (netType === "freedmr") {
            btnSrch.title = window.t ? window.t("hotspots.srch_freedmr_title", {}, "TG: search groups | Manage: FreeDMR TG management | ID: callsign/ID lookup") : "TG: search groups | Manage: FreeDMR TG management | ID: callsign/ID lookup";
          } else if (netType === "adn") {
            btnSrch.title = window.t ? window.t("hotspots.srch_adn_title", {}, "TG: search groups | Manage: ADN TG management | ID: callsign/ID lookup") : "TG: search groups | Manage: ADN TG management | ID: callsign/ID lookup";
          } else if (netType === "xlx") {
            btnSrch.title = window.t ? window.t("hotspots.srch_xlx_title", {}, "TG: search groups | Manage: XLX module management | ID: callsign/ID lookup") : "TG: search groups | Manage: XLX module management | ID: callsign/ID lookup";
          } else if (netType === "bm") {
            btnSrch.title = window.t ? window.t("hotspots.srch_bm_title", {}, "TG: search groups | Manage: BM TG management | ID: callsign/ID lookup") : "TG: search groups | Manage: BM TG management | ID: callsign/ID lookup";
          }
          btnSrch.onclick = (e) => {
            e.stopPropagation();
            const cid = card.dataset.hotspotId || hs.id;
            switchActiveHotspot(cid);
            const slot = card._activeSlot || getHotspotSlot(cid);
            const actionTarget = e.target.closest("[data-action]");
            const action = actionTarget ? actionTarget.dataset.action : null;

            if (action === "manage") {
              handleHotspotManageAction(cid);
              return;
            }
            if (action === "tg" || action === "id") {
              openSearchTgIdModal(slot, cid, action);
              return;
            }

            // Fallback by click position for 3 segments: TG -- Manage -- ID
            const rect = btnSrch.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / (rect.width || 1);
            if (ratio < 0.33) {
              openSearchTgIdModal(slot, cid, "tg");
            } else if (ratio < 0.67) {
              handleHotspotManageAction(cid);
            } else {
              openSearchTgIdModal(slot, cid, "id");
            }
          };
        }

        const btnContacts = card.querySelector(".btn-my-contacts");
        if (btnContacts) {
          btnContacts.onclick = (e) => {
            e.stopPropagation();
            const cid = card.dataset.hotspotId || hs.id;
            const hsBtnNet = String(getHotspotNetworkType(card) || getHotspotNetworkType(cid) || "").toLowerCase();
            const curNet = (hsBtnNet && hsBtnNet !== "bm") ? hsBtnNet : String(card.dataset.networkType || (hs && hs.network_type) || hsBtnNet || "bm").toLowerCase();
            switchActiveHotspot(cid);
            openMyContactsModal(cid, curNet === "ysf" ? "ysf_bookmarks" : "dmr");
          };
        }

        const btnAslNodesDir = card.querySelector(".btn-asl-nodes-dir");
        if (btnAslNodesDir) {
          btnAslNodesDir.onclick = (e) => {
            e.stopPropagation();
            const cid = card.dataset.hotspotId || hs.id;
            switchActiveHotspot(cid);
            if (typeof openMyContactsModal === "function") {
              openMyContactsModal(cid, "allstar_dir");
            }
          };
        }

        const btnTg = card.querySelector(".btn-tg-use");
        if (btnTg) {
          btnTg.onclick = (e) => {
            e.stopPropagation();
            const cid = card.dataset.hotspotId || hs.id;
            switchActiveHotspot(cid);
            const slot = card._activeSlot || getHotspotSlot(cid);
            openTgTxUseModal(slot, cid);
          };
        }

        const btnCall = card.querySelector(".btn-call-id");
        if (btnCall) {
          btnCall.onclick = (e) => {
            e.stopPropagation();
            const cid = card.dataset.hotspotId || hs.id;
            switchActiveHotspot(cid);
            const slot = card._activeSlot || getHotspotSlot(cid);
            openCallIdModal(slot, cid);
          };
        }

        const vfo1 = card.querySelector(".vfo-ts1-row");
        if (vfo1) {
          vfo1.addEventListener("click", (e) => {
            const hsVfoNet = String(getHotspotNetworkType(card) || "").toLowerCase();
            const curNet = (hsVfoNet && hsVfoNet !== "bm") ? hsVfoNet : String(card.dataset.networkType || (hs && hs.network_type) || hsVfoNet || "bm").toLowerCase();
            if (curNet === "xlx") {
              e.stopPropagation();
              e.preventDefault();
              const warnMsg = window.t
                ? window.t("hotspots.xlx_ts1_blocked_toast", {}, "В сети XLX таймслот 1 не поддерживается протоколом. Используйте TS2.")
                : "В сети XLX таймслот 1 не поддерживается протоколом. Используйте TS2.";
              showToast(warnMsg, 3000);
              return;
            }
            if (vfo1._suppressClickUntil && Date.now() < vfo1._suppressClickUntil) {
              e.stopPropagation();
              e.preventDefault();
              return;
            }
            if (e.target.closest("button") || e.target.closest(".slot-badge") || e.target.closest(".vfo-lang-badge") || e.target.closest(".vfo-tts-badge") || e.target.closest(".caption-font-ctrl") || e.target.closest(".ysf-dash-pair") || e.target.closest(".vfo-mute-btn")) return;
            const cid = card.dataset.hotspotId || hs.id;

            if (curNet === "ysf" || curNet === "allstar" || curNet === "m17" || curNet === "dstar" || curNet === "svx") {
              switchActiveHotspot(cid);
              return;
            }

            // Always focus audio onto TS1 whenever any non-button area of the TS1 frame is tapped
            switchActiveHotspot(cid);
            setCardSlot(card, 1, true);
            focusHotspotTsAudio(cid, 1);

            // Check if clicked on caller ID or caller callsign
            const callerTarget = e.target.closest(".ts-caller-id") || e.target.closest(".ts-caller-call");
            if (callerTarget) {
              const rid = parseInt(callerTarget.dataset.radioId || callerTarget.textContent.replace(/\D/g, ""), 10);
              if (rid > 0) {
                e.stopPropagation();
                e.preventDefault();
                selectHotspotTargetId(card, cid, 1, rid, "CALLER", callerTarget);
                return;
              }
            }

            // Check if clicked on TG pill or TG text
            const tgTarget = e.target.closest(".ts-tg-pill") || e.target.closest(".ts-tg-text");
            if (tgTarget) {
              const tgPill = tgTarget.closest(".ts-tg-pill") || tgTarget.querySelector(".ts-tg-pill") || tgTarget;
              const rawTg = tgPill.dataset.tg || tgTarget.dataset.tgId || (tgTarget.textContent.match(/\d+/) || [0])[0];
              const tg = parseInt(rawTg, 10);
              if (tg > 0) {
                e.stopPropagation();
                e.preventDefault();
                selectHotspotTargetId(card, cid, 1, tg, "TG", tgPill);
                return;
              }
            }
          });
          const badge1 = vfo1.querySelector(".slot-badge");
          if (badge1) {
            badge1.style.cursor = "pointer";
            badge1.title = window.t ? window.t("hotspots.tg1_badge_title", {}, "Выбрать группу передачи для TS1 (справочник TG)") : "Выбрать группу передачи для TS1 (справочник TG)";
            const openModal1 = (e) => {
              const hsBadgeNet = String(getHotspotNetworkType(card) || "").toLowerCase();
              const curNet = (hsBadgeNet && hsBadgeNet !== "bm") ? hsBadgeNet : String(card.dataset.networkType || (hs && hs.network_type) || hsBadgeNet || "bm").toLowerCase();
              if (curNet === "ysf" || curNet === "allstar") {
                e.stopPropagation();
                e.preventDefault();
                return;
              }
              if (curNet === "xlx") {
                e.stopPropagation();
                e.preventDefault();
                const warnMsg = window.t
                  ? window.t("hotspots.xlx_ts1_blocked_toast", {}, "В сети XLX таймслот 1 не поддерживается протоколом. Используйте TS2.")
                  : "В сети XLX таймслот 1 не поддерживается протоколом. Используйте TS2.";
                showToast(warnMsg, 3000);
                return;
              }
              if (vfo1._suppressClickUntil && Date.now() < vfo1._suppressClickUntil) {
                e.stopPropagation();
                e.preventDefault();
                return;
              }
              e.stopPropagation();
              const cid = card.dataset.hotspotId || hs.id;
              switchActiveHotspot(cid);
              setCardSlot(card, 1, true);
              openTgTxUseModal(1, cid);
            };
            badge1.addEventListener("click", openModal1);
            badge1.addEventListener("keydown", (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openModal1(e);
              }
            });
          }
          if (typeof setupSlotLongPress === "function") {
            setupSlotLongPress(vfo1, 1);
          }
        }

        const vfo2 = card.querySelector(".vfo-ts2-row");
        if (vfo2) {
          vfo2.addEventListener("click", (e) => {
            if (vfo2._suppressClickUntil && Date.now() < vfo2._suppressClickUntil) {
              e.stopPropagation();
              e.preventDefault();
              return;
            }
            if (e.target.closest("button") || e.target.closest(".slot-badge") || e.target.closest(".vfo-lang-badge") || e.target.closest(".vfo-tts-badge") || e.target.closest(".caption-font-ctrl") || e.target.closest(".ysf-dash-pair") || e.target.closest(".vfo-mute-btn")) return;
            const cid = card.dataset.hotspotId || hs.id;

            // Always focus audio onto TS2 whenever any non-button area of the TS2 frame is tapped
            switchActiveHotspot(cid);
            setCardSlot(card, 2, true);
            focusHotspotTsAudio(cid, 2);

            // Check if clicked on caller ID or caller callsign
            const callerTarget = e.target.closest(".ts-caller-id") || e.target.closest(".ts-caller-call");
            if (callerTarget) {
              const rid = parseInt(callerTarget.dataset.radioId || callerTarget.textContent.replace(/\D/g, ""), 10);
              if (rid > 0) {
                e.stopPropagation();
                e.preventDefault();
                selectHotspotTargetId(card, cid, 2, rid, "CALLER", callerTarget);
                return;
              }
            }

            // Check if clicked on TG pill or TG text
            const tgTarget = e.target.closest(".ts-tg-pill") || e.target.closest(".ts-tg-text");
            if (tgTarget) {
              const tgPill = tgTarget.closest(".ts-tg-pill") || tgTarget.querySelector(".ts-tg-pill") || tgTarget;
              const rawTg = tgPill.dataset.tg || tgTarget.dataset.tgId || (tgTarget.textContent.match(/\d+/) || [0])[0];
              const tg = parseInt(rawTg, 10);
              if (tg > 0) {
                e.stopPropagation();
                e.preventDefault();
                selectHotspotTargetId(card, cid, 2, tg, "TG", tgPill);
                return;
              }
            }
          });
          const badge2 = vfo2.querySelector(".slot-badge");
          if (badge2) {
            badge2.style.cursor = "pointer";
            badge2.title = window.t ? window.t("hotspots.tg2_badge_title", {}, "Выбрать группу передачи для TS2 (справочник TG)") : "Выбрать группу передачи для TS2 (справочник TG)";
            const openModal2 = (e) => {
              if (vfo2._suppressClickUntil && Date.now() < vfo2._suppressClickUntil) {
                e.stopPropagation();
                e.preventDefault();
                return;
              }
              e.stopPropagation();
              const cid = card.dataset.hotspotId || hs.id;
              switchActiveHotspot(cid);
              setCardSlot(card, 2, true);
              openTgTxUseModal(2, cid);
            };
            badge2.addEventListener("click", openModal2);
            badge2.addEventListener("keydown", (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openModal2(e);
              }
            });
          }
          if (typeof setupSlotLongPress === "function") {
            setupSlotLongPress(vfo2, 2);
          }
        }

        if (typeof syncCardSlotTranscribeUI === "function") {
          syncCardSlotTranscribeUI(card, hs.id);
        }

        const muteTs1 = card.querySelector(".btn-mute-ts1");
        if (muteTs1) {
          setupMutePanButtonEvents(muteTs1, card, 1);
        }
        const muteTs2 = card.querySelector(".btn-mute-ts2");
        if (muteTs2) {
          setupMutePanButtonEvents(muteTs2, card, 2);
        }
        const panTs1 = card.querySelector(".btn-pan-ts1");
        if (panTs1) {
          panTs1.onclick = (e) => {
            e.stopPropagation();
            const cid = resolveHotspotId(card.dataset.hotspotId || hs.id);
            cycleHotspotPan(cid, 1);
          };
        }
        const panTs2 = card.querySelector(".btn-pan-ts2");
        if (panTs2) {
          panTs2.onclick = (e) => {
            e.stopPropagation();
            const cid = resolveHotspotId(card.dataset.hotspotId || hs.id);
            cycleHotspotPan(cid, 2);
          };
        }

        const cid = card.dataset.hotspotId || hs.id;
        const volSlider = card.querySelector(".volume-slider");
        const volVal = card.querySelector(".volume-val");
        const volMute = card.querySelector(".volume-mute-toggle");
        if (volSlider) {
          const curVol = getHotspotVolume(cid);
          volSlider.max = 100;
          volSlider.value = curVol;
          const ratio = Math.max(0, Math.min(1, curVol / 100));
          const wrap = card.querySelector(".volume-slider-v-wrap");
          if (wrap) wrap.style.setProperty("--vol-ratio", ratio.toFixed(3));
          volSlider.style.setProperty("--vol-ratio", ratio.toFixed(3));
          if (volVal) volVal.textContent = `${curVol}%`;
          if (window.audioPlayer && audioPlayer.setHotspotVolume) {
            audioPlayer.setHotspotVolume(cid, curVol / 100.0);
          }

          const handleVolInput = () => {
            const val = parseInt(volSlider.value, 10);
            const safeVal = isNaN(val) ? 80 : Math.max(0, Math.min(100, val));
            const r = Math.max(0, Math.min(1, safeVal / 100));
            const w = card.querySelector(".volume-slider-v-wrap") || volSlider.closest(".volume-slider-v-wrap");
            if (w) w.style.setProperty("--vol-ratio", r.toFixed(3));
            volSlider.style.setProperty("--vol-ratio", r.toFixed(3));
            if (volVal) volVal.textContent = `${safeVal}%`;
            const currentCid = card.dataset.hotspotId || hs.id;
            setHotspotVolume(currentCid, safeVal);
          };
          volSlider.oninput = handleVolInput;
          volSlider.onchange = handleVolInput;
        }
        if (volMute) {
          if (typeof window.bindMuteButtonLongPress === "function") {
            window.bindMuteButtonLongPress(volMute, () => (card.dataset.hotspotId || hs.id));
          }
          volMute.onclick = (e) => {
            const currentCid = card.dataset.hotspotId || hs.id;
            handleMuteButtonClick(e, currentCid);
          };
          volMute.ondblclick = (e) => {
            const currentCid = card.dataset.hotspotId || hs.id;
            handleMuteButtonDblClick(e, currentCid);
          };
        }

        const cardPttBtn = card.querySelector(".ptt-button");
        if (cardPttBtn) {
          let lockPressTimer = null;
          let isLockLongPressed = false;
          let lockPressStartX = 0;
          let lockPressStartY = 0;
          let pttHoldStartTimer = null;
          let lastPttTapTime = 0;
          let lastPttTapSlot = 0;
          const PTT_DOUBLE_TAP_MS = 320;
          const PTT_HOLD_DELAY_MS = 180;

          let holdSlideOriginX = 0;
          let holdSlideOriginY = 0;
          let holdSlideSlot = 2;
          let holdSlideHasTimeslots = true;
          let isHoldSlideTracking = false;
          const HOLD_SLIDE_LOCK_THRESHOLD_PX = 52;

          const removePttSlideLockGuide = () => {
            document.querySelectorAll(".ptt-slide-lock-guide").forEach(el => el.remove());
            isHoldSlideTracking = false;
          };

          const clearPttHoldLatchUI = (btnEl) => {
            removePttSlideLockGuide();
            const targets = btnEl ? [btnEl] : document.querySelectorAll(".ptt-button");
            targets.forEach(b => {
              b._isHoldLatched = false;
              b._latchedSlot = 0;
              b.classList.remove("ptt-hold-latched", "latched-slot-1", "latched-slot-2", "latched-slot-single");
              b.querySelectorAll(".ptt-latched-banner").forEach(el => el.remove());
            });
            if (typeof window !== "undefined") {
              window.isPttHoldLatched = false;
            }
          };

          const showPttSlideLockGuide = (clientX, clientY, slot, hasTimeslots) => {
            removePttSlideLockGuide();
            const rect = cardPttBtn.getBoundingClientRect();
            let minX = rect.left + 26;
            let maxX = rect.right - 26;
            if (hasTimeslots) {
              const midX = rect.left + rect.width / 2;
              if (slot === 1) {
                maxX = Math.max(minX, midX - 10);
              } else {
                minX = Math.min(maxX, midX + 10);
              }
            }
            const anchorX = Math.max(minX, Math.min(maxX, clientX));
            const anchorY = Math.min(clientY - 12, rect.top + 10);

            const slotLabel = hasTimeslots ? `TS${slot}` : "TX";
            const slotClass = hasTimeslots ? `slot-ts${slot}` : "slot-single";

            const guide = document.createElement("div");
            guide.className = `ptt-slide-lock-guide ${slotClass}`;
            guide.style.left = `${Math.round(anchorX)}px`;
            guide.style.top = `${Math.round(anchorY)}px`;
            guide.style.setProperty("--slide-progress", "0");
            guide.innerHTML = `
              <div class="slide-lock-header">
                <span class="slide-lock-icon">🔓</span>
                <span class="slide-lock-slot-pill">${slotLabel}</span>
              </div>
              <div class="slide-lock-arrows">
                <span>⌃</span>
                <span>⌃</span>
              </div>
            `;
            document.body.appendChild(guide);
            isHoldSlideTracking = true;
          };

          cardPttBtn.addEventListener("pointerdown", (e) => {
            const cid = resolveHotspotId(card.dataset.hotspotId || hs.id || "default");
            const rect = cardPttBtn.getBoundingClientRect();
            const relX = e.clientX - rect.left;
            const relY = e.clientY - rect.top;

            // 1. Branch: Lock icon tapped/clicked? (hit zone matches lock icon: ~44x48 area from top-left)
            const isLockHit = (relX >= 0 && relX <= 44 && relY >= 0 && relY <= Math.min(48, rect.height)) ||
                              !!(e.target && e.target.closest && e.target.closest(".ptt-lock-icon"));

            if (isLockHit) {
              e.preventDefault();
              e.stopPropagation();
              isLockLongPressed = false;
              lockPressStartX = e.clientX;
              lockPressStartY = e.clientY;

              const lockIconEl = cardPttBtn.querySelector(".ptt-lock-icon");
              if (lockIconEl) lockIconEl.classList.add("lock-pressing");

              if (lockPressTimer) {
                clearTimeout(lockPressTimer);
                lockPressTimer = null;
              }
              lockPressTimer = setTimeout(() => {
                isLockLongPressed = true;
                lockPressTimer = null;
                const li = cardPttBtn.querySelector(".ptt-lock-icon");
                if (li) li.classList.remove("lock-pressing");
                if (navigator.vibrate) {
                  try { navigator.vibrate([40, 30, 40]); } catch (err) {}
                }
                openTotConfigModal(cid, li || cardPttBtn);
              }, 450);
              return;
            }

            if (hs && hs._aslScanActive) {
              stopAslMatrixScan(cid, card, hs, { keepCurrentLink: true, silent: true });
            }
            if (hs && hs._aslDiceRolling) {
              stopAslDiceSearch(cid, card, hs, { immediateAbort: true, silent: true });
            }
            if (hs && hs._ysfScanActive) {
              stopYsfMatrixScan(cid, card, hs, { keepCurrentLink: true, silent: true });
            }
            if (hs && hs._ysfDiceRolling) {
              stopYsfDiceSearch(cid, card, hs, { immediateAbort: true, silent: true });
            }
            if (hs && hs._adnDiceRolling) {
              stopAdnDiceSearch(cid, card, hs, { immediateAbort: true, silent: true });
            }

            if (cardPttBtn._isHoldLatched || (typeof window !== "undefined" && window.isPttHoldLatched)) {
              e.preventDefault();
              e.stopPropagation();
              clearPttHoldLatchUI(cardPttBtn);
              cardPttBtn.classList.remove("active", "tx-slot-1", "tx-slot-2", "hover-slot-1", "hover-slot-2");
              updateCardPttHint(card);
              if (typeof window.stopTransmission === "function") {
                window.stopTransmission();
              } else {
                stopTransmission();
              }
              return;
            }

            // 2. Branch: Lock status check - if locked, blink button border + vibrate, DO NOT TRANSMIT!
            if (isPttLocked(cid)) {
              e.preventDefault();
              e.stopPropagation();
              blinkPttLocked(cardPttBtn);
              return;
            }

            // 2b. Branch: Connection protection - GW and BM must both be connected!
            const conn = (typeof window.checkPttConnectionStatus === "function")
              ? window.checkPttConnectionStatus(cid)
              : checkPttConnectionStatus(cid);
            if (!conn.ok) {
              e.preventDefault();
              e.stopPropagation();
              if (typeof window.notifyPttConnectionBlocked === "function") {
                window.notifyPttConnectionBlocked(conn, cardPttBtn);
              } else {
                notifyPttConnectionBlocked(conn, cardPttBtn);
              }
              return;
            }

            // 2c. Branch: YSF Multi-Room / Multi-DG-ID TX prompt ("в лоб") до захвата указателя и микрофона
            if (isYsfTxDgIdPromptRequired(cid)) {
              e.preventDefault();
              e.stopPropagation();
              openYsfTxDgIdModal(cid);
              return;
            }

            // Determine targetSlot based on left (TS1) vs right (TS2) click coordinate
            const hsPttNet = String(getHotspotNetworkType(card) || "").toLowerCase();
            const netType = (hsPttNet && hsPttNet !== "bm") ? hsPttNet : String(card.dataset.networkType || (hs && hs.network_type) || hsPttNet || "bm").toLowerCase();
            const isAllStar = netType === "allstar";
            const isYsf = netType === "ysf";
            const isXlx = netType === "xlx";
            const targetSlot = (isAllStar || isXlx) ? 2 : (isYsf ? 1 : ((relX < (rect.width / 2)) ? 1 : 2));
            const now = Date.now();

            // Проверка на ДВОЙНОЙ ТАП (<= 320 мс)
            if ((now - lastPttTapTime) <= PTT_DOUBLE_TAP_MS) {
              e.preventDefault();
              e.stopPropagation();
              lastPttTapTime = 0;
              if (pttHoldStartTimer) {
                clearTimeout(pttHoldStartTimer);
                pttHoldStartTimer = null;
              }
              cardPttBtn.classList.remove("active", "tx-slot-1", "tx-slot-2", "hover-slot-1", "hover-slot-2");
              if (typeof window.stopTransmission === "function") {
                window.stopTransmission({ silentCancel: true });
              }
              if (isAllStar) {
                const ws = (typeof getWs === "function" ? getWs() : window.ws);
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "allstar_dtmf", hotspot_id: cid, digit: "*73" }));
                }
                if (typeof showToast === "function") {
                  showToast("DTMF: *73 (Unlink All)", "info", 1500);
                }
                const targetHs = (getCurrentHotspots().find(h => h.id === cid) || null);
                if (targetHs) {
                  targetHs.connected_node = "";
                  targetHs.is_asl_linked = false;
                  updateCardAllStarPanel(card, targetHs);
                }
                return;
              }
              if (isYsf) {
                return;
              }
              setCardSlot(card, targetSlot, true);
              switchActiveHotspot(cid);
              if (typeof window.triggerQuickUnlink4000 === "function") {
                window.triggerQuickUnlink4000(cid, targetSlot);
              }
              return;
            }

            lastPttTapTime = now;
            lastPttTapSlot = targetSlot;

            const pttMode = (typeof window.getHotspotPttMode === "function") ? window.getHotspotPttMode(cid) : getHotspotPttMode(cid);

            // In "toggle" mode:
            if (pttMode === "toggle") {
              e.preventDefault();
              e.stopPropagation();
              if (typeof window !== "undefined" && (window.isPttPressed || window.isTransmissionStarting)) {
                cardPttBtn.classList.remove("active", "tx-slot-1", "tx-slot-2", "hover-slot-1", "hover-slot-2");
                stopTransmission();
                return;
              }
              setCardSlot(card, targetSlot, true);
              cardPttBtn.classList.remove("hover-slot-1", "hover-slot-2");
              cardPttBtn.classList.remove("tx-slot-1", "tx-slot-2");
              cardPttBtn.classList.add(`tx-slot-${targetSlot}`);
              switchActiveHotspot(cid);
              if (pttHoldStartTimer) clearTimeout(pttHoldStartTimer);
              pttHoldStartTimer = setTimeout(() => {
                pttHoldStartTimer = null;
                startTransmission(cid, targetSlot);
              }, PTT_HOLD_DELAY_MS);
              return;
            }

            // In "hold" mode:
            e.preventDefault();
            try {
              cardPttBtn.setPointerCapture(e.pointerId);
            } catch (err) {}
            setCardSlot(card, targetSlot, true);
            cardPttBtn.classList.remove("hover-slot-1", "hover-slot-2");
            cardPttBtn.classList.remove("tx-slot-1", "tx-slot-2");
            cardPttBtn.classList.add(`tx-slot-${targetSlot}`);
            switchActiveHotspot(cid);

            const hsHoldNet = String(getHotspotNetworkType(card) || "").toLowerCase();
            const netTypeHold = (hsHoldNet && hsHoldNet !== "bm") ? hsHoldNet : String(card.dataset.networkType || (hs && hs.network_type) || hsHoldNet || "bm").toLowerCase();
            const hasTimeslots = (netTypeHold !== "allstar" && netTypeHold !== "xlx" && netTypeHold !== "ysf");
            holdSlideOriginX = e.clientX;
            holdSlideOriginY = e.clientY;
            holdSlideSlot = targetSlot;
            holdSlideHasTimeslots = hasTimeslots;
            clearPttHoldLatchUI(cardPttBtn);
            isHoldSlideTracking = true;

            if (pttHoldStartTimer) clearTimeout(pttHoldStartTimer);
            pttHoldStartTimer = setTimeout(() => {
              pttHoldStartTimer = null;
              startTransmission(cid, targetSlot);
              if (!cardPttBtn._isHoldLatched) {
                showPttSlideLockGuide(holdSlideOriginX, holdSlideOriginY, holdSlideSlot, holdSlideHasTimeslots);
              }
            }, PTT_HOLD_DELAY_MS);
          });

          cardPttBtn.addEventListener("pointermove", (e) => {
            if (isHoldSlideTracking && !cardPttBtn._isHoldLatched) {
              const upDy = holdSlideOriginY - e.clientY;
              const progress = Math.min(1, Math.max(0, upDy / HOLD_SLIDE_LOCK_THRESHOLD_PX));
              const guideEl = document.querySelector(".ptt-slide-lock-guide");
              if (guideEl) {
                guideEl.style.setProperty("--slide-progress", progress.toFixed(2));
              }

              if (upDy >= HOLD_SLIDE_LOCK_THRESHOLD_PX) {
                const cid = resolveHotspotId(card.dataset.hotspotId || hs.id || "default");
                if (pttHoldStartTimer) {
                  clearTimeout(pttHoldStartTimer);
                  pttHoldStartTimer = null;
                  startTransmission(cid, holdSlideSlot);
                }
                removePttSlideLockGuide();
                cardPttBtn._isHoldLatched = true;
                cardPttBtn._latchedSlot = holdSlideSlot;
                if (typeof window !== "undefined") {
                  window.isPttHoldLatched = true;
                }

                const latchClass = holdSlideHasTimeslots ? `latched-slot-${holdSlideSlot}` : "latched-slot-single";
                cardPttBtn.classList.add("ptt-hold-latched", latchClass);

                const slotLabel = holdSlideHasTimeslots ? `TS${holdSlideSlot}` : "TX";
                let banner = cardPttBtn.querySelector(".ptt-latched-banner");
                if (!banner) {
                  banner = document.createElement("span");
                  banner.className = "ptt-latched-banner";
                  cardPttBtn.appendChild(banner);
                }
                banner.textContent = window.t
                  ? window.t("ptt.slot_latched_banner", { slot: slotLabel }, `🔒 ${slotLabel} LATCHED`)
                  : `🔒 ${slotLabel} LATCHED`;

                if (navigator.vibrate) {
                  try { navigator.vibrate([35, 40, 60]); } catch (_) {}
                }
              }
              return;
            }

            if (lockPressTimer) {
              const dist = Math.hypot(e.clientX - lockPressStartX, e.clientY - lockPressStartY);
              if (dist > 14) {
                clearTimeout(lockPressTimer);
                lockPressTimer = null;
                const lockIconEl = cardPttBtn.querySelector(".ptt-lock-icon");
                if (lockIconEl) lockIconEl.classList.remove("lock-pressing");
              }
            }

            // When not actively transmitting, provide hover hint based on cursor X position (left -> TS1, right -> TS2)
            if (!(typeof window !== "undefined" && (window.isPttPressed || window.isPttHoldLatched)) && !cardPttBtn._isHoldLatched) {
              const rect = cardPttBtn.getBoundingClientRect();
              const relX = e.clientX - rect.left;
              if (relX >= 0 && relX <= rect.width) {
                const hsHoverNet = String(getHotspotNetworkType(card) || "").toLowerCase();
                const netType = (hsHoverNet && hsHoverNet !== "bm") ? hsHoverNet : String(card.dataset.networkType || (hs && hs.network_type) || hsHoverNet || "bm").toLowerCase();
                const isAllStar = netType === "allstar";
                const isYsf = netType === "ysf";
                const isXlx = netType === "xlx";
                if (isAllStar || isYsf) {
                  cardPttBtn.classList.remove("hover-slot-1", "hover-slot-2");
                  return;
                }
                const hoverSlot = isXlx ? 2 : ((relX < (rect.width / 2)) ? 1 : 2);
                const wasSlot1 = cardPttBtn.classList.contains("hover-slot-1");
                const wasSlot2 = cardPttBtn.classList.contains("hover-slot-2");
                const prevSlot = wasSlot1 ? 1 : (wasSlot2 ? 2 : 0);
                cardPttBtn.classList.toggle("hover-slot-1", !isXlx && hoverSlot === 1);
                cardPttBtn.classList.toggle("hover-slot-2", hoverSlot === 2);
                if (prevSlot !== hoverSlot) {
                  updateCardPttHintForSlot(card, hoverSlot);
                }
              }
            }
          });

          cardPttBtn.addEventListener("pointerup", (e) => {
            removePttSlideLockGuide();
            if (cardPttBtn._isHoldLatched) {
              e.preventDefault();
              try {
                if (cardPttBtn.hasPointerCapture && cardPttBtn.hasPointerCapture(e.pointerId)) {
                  cardPttBtn.releasePointerCapture(e.pointerId);
                }
              } catch (err) {}
              return;
            }

            const lockIconEl = cardPttBtn.querySelector(".ptt-lock-icon");
            if (lockIconEl) lockIconEl.classList.remove("lock-pressing");

            const cid = resolveHotspotId(card.dataset.hotspotId || hs.id || "default");
            const pttMode = (typeof window.getHotspotPttMode === "function") ? window.getHotspotPttMode(cid) : getHotspotPttMode(cid);

            if (lockPressTimer) {
              clearTimeout(lockPressTimer);
              lockPressTimer = null;
              if (!isLockLongPressed) {
                // Short tap on lock icon -> toggle PTT lock!
                e.preventDefault();
                e.stopPropagation();
                togglePttLock(cid);
                return;
              }
            }

            if (isLockLongPressed) {
              isLockLongPressed = false;
              e.preventDefault();
              e.stopPropagation();
              return;
            }

            const rect = cardPttBtn.getBoundingClientRect();
            const relX = e.clientX - rect.left;
            const relY = e.clientY - rect.top;
            const isLockHit = (relX >= 0 && relX <= 44 && relY >= 0 && relY <= Math.min(48, rect.height)) ||
                              !!(e.target && e.target.closest && e.target.closest(".ptt-lock-icon"));

            if (isLockHit) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }

            // In "toggle" mode, pointerup must not stop transmission or strip active TX slot highlight
            if (pttMode === "toggle") {
              e.preventDefault();
              e.stopPropagation();
              return;
            }

            if (pttHoldStartTimer) {
              clearTimeout(pttHoldStartTimer);
              pttHoldStartTimer = null;
            }

            e.preventDefault();
            try {
              if (cardPttBtn.hasPointerCapture && cardPttBtn.hasPointerCapture(e.pointerId)) {
                cardPttBtn.releasePointerCapture(e.pointerId);
              }
            } catch (err) {}

            cardPttBtn.classList.remove("active", "tx-slot-1", "tx-slot-2");
            updateCardPttHint(card);

            if (typeof window !== "undefined" && (window.isPttPressed || window.isTransmissionStarting)) {
              stopTransmission();
            }
          });

          cardPttBtn.addEventListener("pointercancel", (e) => {
            removePttSlideLockGuide();
            if (cardPttBtn._isHoldLatched) {
              return;
            }

            if (lockPressTimer) {
              clearTimeout(lockPressTimer);
              lockPressTimer = null;
            }
            isLockLongPressed = false;
            const lockIconEl = cardPttBtn.querySelector(".ptt-lock-icon");
            if (lockIconEl) lockIconEl.classList.remove("lock-pressing");

            cardPttBtn.classList.remove("hover-slot-1", "hover-slot-2");

            const cid = resolveHotspotId(card.dataset.hotspotId || hs.id || "default");
            const pttMode = (typeof window.getHotspotPttMode === "function") ? window.getHotspotPttMode(cid) : getHotspotPttMode(cid);
            if (pttMode === "toggle") {
              return;
            }

            if (pttHoldStartTimer) {
              clearTimeout(pttHoldStartTimer);
              pttHoldStartTimer = null;
            }

            cardPttBtn.classList.remove("active", "tx-slot-1", "tx-slot-2");
            updateCardPttHint(card);

            e.preventDefault();
            try {
              if (cardPttBtn.hasPointerCapture && cardPttBtn.hasPointerCapture(e.pointerId)) {
                cardPttBtn.releasePointerCapture(e.pointerId);
              }
            } catch (err) {}
            stopTransmission();
          });

          cardPttBtn.addEventListener("pointerleave", (e) => {
            if (lockPressTimer) {
              clearTimeout(lockPressTimer);
              lockPressTimer = null;
            }
            const lockIconEl = cardPttBtn.querySelector(".ptt-lock-icon");
            if (lockIconEl) lockIconEl.classList.remove("lock-pressing");

            if (cardPttBtn._isHoldLatched || (typeof window !== "undefined" && window.isPttHoldLatched)) {
              return;
            }

            cardPttBtn.classList.remove("hover-slot-1", "hover-slot-2");
            updateCardPttHint(card);

            const cid = resolveHotspotId(card.dataset.hotspotId || hs.id || "default");
            const pttMode = (typeof window.getHotspotPttMode === "function") ? window.getHotspotPttMode(cid) : getHotspotPttMode(cid);
            if (pttMode === "toggle") {
              return;
            }

            if (pttHoldStartTimer) {
              clearTimeout(pttHoldStartTimer);
              pttHoldStartTimer = null;
            }

            if ((typeof window !== "undefined" && (window.isPttPressed || window.isTransmissionStarting)) && (!cardPttBtn.hasPointerCapture || !cardPttBtn.hasPointerCapture(e.pointerId))) {
              cardPttBtn.classList.remove("active", "tx-slot-1", "tx-slot-2");
              stopTransmission();
            }
          });

          cardPttBtn.addEventListener("dblclick", (e) => {
            e.preventDefault();
            e.stopPropagation();
          });
          cardPttBtn.addEventListener("contextmenu", (e) => {
            e.preventDefault();
          });

          const cardLockIcon = card.querySelector(".ptt-lock-icon");
          if (cardLockIcon) {
            cardLockIcon.addEventListener("contextmenu", (e) => {
              e.preventDefault();
              e.stopPropagation();
            });
          }
        }

        // Prevent clicks on toggle controls from bubbling to rows/cards
        card.querySelectorAll(".toggle-control").forEach((ctrl) => {
          ctrl.addEventListener("click", (e) => {
            e.stopPropagation();
          });
        });

        const cardAgc = card.querySelector(".agc-toggle");
        if (cardAgc) {
          const agcActive = getHotspotAgc(cardCid);
          cardAgc.checked = agcActive;
          cardAgc.onclick = (e) => { e.stopPropagation(); };
          cardAgc.onchange = () => {
            setHotspotAgc(cardCid, cardAgc.checked);
          };
        }

        const cardTsModeBtn = card.querySelector(".ts-audio-mode-btn");
        if (cardTsModeBtn && typeof window.setupTsAudioModeButton === "function") {
          window.setupTsAudioModeButton(cardTsModeBtn, card, cardCid);
          if (typeof window.updateCardTsAudioModeUI === "function") {
            window.updateCardTsAudioModeUI(card, cardCid);
          }
        }

        const collapseBtn = card.querySelector(".hotspot-collapse-btn");
        if (collapseBtn) {
          setupCollapseButtonLongPress(collapseBtn, cardCid);
        }

        const cardAdnDice = card.querySelector(".btn-adn-dice");
        if (cardAdnDice) {
          setupAdnDiceButton(card, cardCid, hs);
        }

        // Quick TG Direct Dial (Быстрый набор TG) + Live TG Preview Quote Popup
        const quickInput = card.querySelector(".quick-tg-input");
        const quickApply = card.querySelector(".btn-quick-tg-apply");
        const quickBox = quickInput ? quickInput.closest(".quick-tg-box") : null;
        let previewPopup = quickBox ? quickBox.querySelector(".quick-tg-preview-popup") : null;
        if (quickBox && !previewPopup) {
          previewPopup = document.createElement("div");
          previewPopup.className = "quick-tg-preview-popup";
          previewPopup.setAttribute("aria-live", "polite");
          quickBox.appendChild(previewPopup);
        }

        let previewDebounceTimer = null;
        let previewBlurTimer = null;
        if (!window._quickTgPreviewCache) {
          window._quickTgPreviewCache = {};
        }

        const hideQuickPreview = () => {
          if (previewDebounceTimer) {
            clearTimeout(previewDebounceTimer);
            previewDebounceTimer = null;
          }
          if (previewPopup) {
            previewPopup.classList.remove("visible");
          }
        };

        const renderQuickPreview = () => {
          if (!quickInput || !previewPopup) return;
          const hsQuickNet = String(getHotspotNetworkType(card) || "").toLowerCase();
          const netType = (hsQuickNet && hsQuickNet !== "bm") ? hsQuickNet : String(card.dataset.networkType || (hs && hs.network_type) || hsQuickNet || "bm").toLowerCase();

          if (netType === "dstar") {
            const rawVal = quickInput.value.trim().toUpperCase();
            if (!rawVal) {
              hideQuickPreview();
              return;
            }
            if (/^[A-Z]$/.test(rawVal)) {
              const modHint = window.t ? window.t("dstar.quick_change_mod_hint", {}, "Сменить модуль на текущем рефлекторе (Enter ⏎)") : "Сменить модуль на текущем рефлекторе (Enter ⏎)";
              previewPopup.innerHTML = `
                <div class="quick-tg-preview-inner" style="display:flex;align-items:center;gap:8px;">
                  <span style="font-size:1.1rem;">🔄</span>
                  <div style="display:flex;flex-direction:column;">
                    <div style="font-weight:700;color:#38bdf8;">Module ${rawVal}</div>
                    <div style="font-size:0.75rem;color:#8b949e;">${safeEscapeHtml(modHint)}</div>
                  </div>
                </div>
              `;
              previewPopup.classList.add("visible");
              return;
            }
            const parts = rawVal.split(/\s+/);
            const refQuery = parts[0];
            const modQuery = parts[1] ? parts[1].slice(0, 1) : "B";
            const dstarList = (typeof window !== "undefined" && typeof window.getNetworkServersList === "function" ? window.getNetworkServersList("dstar") : ((window._dmrServersCache && window._dmrServersCache["dstar"]) || [])) || [];
            const found = dstarList.find(r => {
              const des = String(r.designator || r.id || "").toUpperCase();
              return des === refQuery || des.startsWith(refQuery);
            });
            if (found) {
              const des = String(found.designator || found.id);
              const connHint = window.t ? window.t("dstar.quick_connect_hint", { ref: des, mod: modQuery }, `Подключиться к ${des} модуль ${modQuery} (Enter ⏎)`) : `Подключиться к ${des} модуль ${modQuery} (Enter ⏎)`;
              previewPopup.innerHTML = `
                <div class="quick-tg-preview-inner" style="display:flex;align-items:center;gap:8px;">
                  <span style="font-size:1.1rem;">🌐</span>
                  <div style="display:flex;flex-direction:column;">
                    <div style="font-weight:700;color:#38bdf8;">${des} ${modQuery} · ${safeEscapeHtml(found.name || des)}</div>
                    <div style="font-size:0.75rem;color:#8b949e;">${safeEscapeHtml(connHint)}</div>
                  </div>
                </div>
              `;
            } else {
              const notFoundTxt = window.t ? window.t("dstar.quick_not_found", { ref: refQuery }, `Рефлектор ${refQuery} не найден в D-STAR`) : `Рефлектор ${refQuery} не найден в D-STAR`;
              previewPopup.innerHTML = `
                <div class="quick-tg-preview-inner" style="display:flex;align-items:center;gap:6px;color:#ff7b72;">
                  <span>⚠️</span>
                  <span style="font-size:0.8rem;font-weight:600;">${safeEscapeHtml(notFoundTxt)}</span>
                </div>
              `;
            }
            previewPopup.classList.add("visible");
            return;
          }

          if (netType === "svx") {
            const cleanDigits = quickInput.value.replace(/\D/g, "");
            if (quickInput.value !== cleanDigits) quickInput.value = cleanDigits;
            if (!cleanDigits && cleanDigits !== "0") {
              hideQuickPreview();
              return;
            }
            const tgNum = parseInt(cleanDigits, 10);
            const tgLabel = (tgNum === 0) ? "TG 0 (Standby)" : `TG ${tgNum}`;
            const svxHint = window.t ? window.t("svx.quick_select_tg_hint", {}, "Выбрать разговорную группу SVX (Enter ⏎)") : "Выбрать разговорную группу SVX (Enter ⏎)";
            previewPopup.innerHTML = `
              <div class="quick-tg-preview-inner" style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:1.1rem;">📻</span>
                <div style="display:flex;flex-direction:column;">
                  <div style="font-weight:700;color:#10b981;">${tgLabel}</div>
                  <div style="font-size:0.75rem;color:#8b949e;">${safeEscapeHtml(svxHint)}</div>
                </div>
              </div>
            `;
            previewPopup.classList.add("visible");
            return;
          }

          const cleanDigits = quickInput.value.replace(/\D/g, "");
          if (quickInput.value !== cleanDigits) {
            quickInput.value = cleanDigits;
          }
          const num = parseInt(cleanDigits, 10);
          if (!cleanDigits || isNaN(num) || num <= 0 || num > 9999999) {
            hideQuickPreview();
            return;
          }
          if (netType === "allstar") {
            let nodesDir = [];
            if (typeof window.getAllStarNodesDirectory === "function") {
              nodesDir = window.getAllStarNodesDirectory();
            } else {
              try {
                const s = localStorage.getItem("proxdmr_allstar_directory");
                if (s) nodesDir = JSON.parse(s);
              } catch (e) {}
            }
            if (!Array.isArray(nodesDir) || nodesDir.length === 0) {
              nodesDir = [
                { node: "1999",  name: "Local Echo", hub: "Local Loopback Echo Audio Test", country: "ECHO", flag: "🔄" },
                { node: "41522", name: "HUBNet UK", hub: "National AllStar Repeater Network", country: "UK", flag: "🇬🇧" },
                { node: "27339", name: "East Coast Reflector", hub: "WAN Repeater System Hub", country: "US", flag: "🇺🇸" },
                { node: "2143",  name: "WAN RS", hub: "Western Area Repeater Network", country: "US", flag: "🇺🇸" },
                { node: "9999",  name: "AllStar Parrot", hub: "Global Parrot Repeater", country: "GLOBAL", flag: "🦜" },
                { node: "51010", name: "World Conference", hub: "International ASL Bridge", country: "GLOBAL", flag: "🌐" },
                { node: "2502",  name: "ASL Russia", hub: (window.t ? window.t("asl.dir_russia_hub", {}, "AllStarLink Node Russia") : "AllStarLink Node Russia"), country: "RU", flag: "🇷🇺" },
                { node: "52495", name: "ASL Germany", hub: "DL AllStarLink Repeater Network", country: "DE", flag: "🇩🇪" }
              ];
            }

            const found = nodesDir.find(item => String(item.node) === String(num));
            const flag = found ? (found.flag || "🌐") : "🌐";
            const nodeTitle = found ? (found.name || `Node ${num}`) : `Node ${num}`;
            const nodeDesc = found ? (found.hub || found.country || "AllStarLink Hub") : (num === 1999 ? "Local Echo" : (num === 9999 ? "Parrot" : "AllStarLink Node"));

            previewPopup.innerHTML = `
              <div class="quick-tg-pop-header">
                <span class="quick-tg-pop-flag">${flag}</span>
                <span class="quick-tg-pop-badge is-tg" style="background:#0284c7;color:#fff;">Node ${num}</span>
                <span class="quick-tg-pop-country">AllStarLink</span>
                <span class="quick-tg-pop-tx-hint">TX ⏎</span>
              </div>
              <div class="quick-tg-pop-quote is-known">
                <strong>${safeEscapeHtml(nodeTitle)}</strong>
                <span class="quick-tg-pop-sub">${safeEscapeHtml(nodeDesc)}</span>
              </div>
            `;
            previewPopup.classList.add("visible");
            return;
          } else if (netType === "ysf") {
            const ysfList = (typeof window !== "undefined" && typeof window.getNetworkServersList === "function" ? window.getNetworkServersList("ysf") : ((window._dmrServersCache && window._dmrServersCache["ysf"]) || [])) || [];
            const found = ysfList.find(r => {
              const rIdStr = String(r.id || "").trim();
              return rIdStr === cleanDigits || (parseInt(rIdStr, 10) === num);
            });

            if (found) {
              const info = (typeof window.resolveYsfRoomInfo === "function") ? window.resolveYsfRoomInfo(found) : { flag: "🌐", refName: found.name || `YSF #${num}` };
              const flag = info.flag || "🌐";
              const rName = info.refName || found.reflector_name || found.name || `YSF #${found.id}`;
              const rDesc = found.description || found.host || "";
              previewPopup.innerHTML = `
                <div class="quick-tg-preview-inner" style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 1.1rem;">${flag}</span>
                  <div style="display: flex; flex-direction: column; overflow: hidden;">
                    <div style="font-weight: 700; color: #c084fc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">#${found.id} ${rName}</div>
                    ${rDesc ? `<div style="font-size: 0.75rem; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${rDesc}</div>` : ""}
                  </div>
                </div>
              `;
            } else {
              const notFoundYsfTxt = window.t
                ? window.t("ysf.room_not_found_preview", { room: cleanDigits }, `Room #${cleanDigits} not found in YSF`)
                : `Room #${cleanDigits} not found in YSF`;
              previewPopup.innerHTML = `
                <div class="quick-tg-preview-inner" style="display: flex; align-items: center; gap: 6px; color: #ff7b72;">
                  <span>⚠️</span>
                  <span style="font-size: 0.8rem; font-weight: 600;">${safeEscapeHtml(notFoundYsfTxt)}</span>
                </div>
              `;
            }
            previewPopup.classList.add("visible");
            return;
          }

          const cache = window._quickTgPreviewCache || {};
          const userCalls = (typeof window !== "undefined" && window.USER_CALLSIGNS) || {};
          const u = userCalls[num];
          const isPrivate = Boolean(u || num > 999999);

          const formatUserLoc = (usr) => {
            if (!usr) return "";
            const parts = [];
            if (usr.city) parts.push(usr.city);
            if (usr.state && usr.state !== usr.city) parts.push(usr.state);
            if (usr.country && usr.country !== usr.state && usr.country !== usr.city) parts.push(usr.country);
            return parts.join(", ");
          };

          const formatUserPrefixHint = (usr) => {
            if (!usr) return "";
            const uid = usr.radio_id !== undefined ? usr.radio_id : usr.id;
            const cs = (usr.callsign || "").trim();
            const nm = (usr.name || "").trim();
            const loc = [usr.city, usr.country].filter(Boolean).join(", ");
            const details = [nm, loc].filter(Boolean).join(", ");
            const exPrefix = window.t ? window.t("tgtx.example_prefix", {}, "↳ Ex.:") : "↳ Ex.:";
            return `<span class="quick-tg-pop-sub">${safeEscapeHtml(exPrefix)} <b>ID ${safeEscapeHtml(String(uid))}</b> — <strong>${safeEscapeHtml(cs)}</strong>${details ? ` (${safeEscapeHtml(details)})` : ""}</span>`;
          };

          if (isPrivate) {
            const cInfo = getCountryInfo(num, u?.callsign || "", u?.country || "");
            const flagHtml = getFlagBadgeHtml(cInfo, false);
            const cLabel = (cInfo && cInfo.name && cInfo.name !== "Global") ? cInfo.name : "DMR ID";
            let quoteHtml = "";
            let isKnown = false;
            const idCacheEntry = cache["id_" + num];
            const isIdNotFound = (idCacheEntry === "not_found" || (idCacheEntry && idCacheEntry.status === "not_found"));
            const idPrefixUser = (idCacheEntry && typeof idCacheEntry === "object") ? idCacheEntry.prefixUser : null;

            if (u && (u.callsign || u.name)) {
              isKnown = true;
              const cs = (u.callsign || "").trim();
              const nm = (u.name || "").trim();
              const loc = formatUserLoc(u);
              quoteHtml = `<span class="quick-tg-pop-main"><strong>${safeEscapeHtml(cs)}</strong>${nm ? ` — ${safeEscapeHtml(nm)}` : ""}</span>` +
                (loc ? `<span class="quick-tg-pop-sub">${safeEscapeHtml(loc)}</span>` : "");
            } else if (isIdNotFound) {
              const notFoundTxt = window.t ? window.t("tgtx.private_id_custom", {}, "Private call DMR ID (not in RadioID)") : "Private call DMR ID (not in RadioID)";
              quoteHtml = `<span class="quick-tg-pop-main">${safeEscapeHtml(notFoundTxt)}</span>` +
                (idPrefixUser ? formatUserPrefixHint(idPrefixUser) : "");
            } else {
              const searchTxt = window.t ? window.t("tgtx.private_id_searching", {}, "Private call DMR ID • searching callsign...") : "Private call DMR ID • searching callsign...";
              quoteHtml = `<span class="quick-tg-pop-main">${safeEscapeHtml(searchTxt)}</span>`;
              if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
              previewDebounceTimer = setTimeout(async () => {
                try {
                  const res = await fetch(`/api/dmr/users/search?q=${encodeURIComponent(String(num))}&limit=8`);
                  const data = await res.json();
                  const list = (data && data.results) || [];
                  const getUid = (it) => Number(it && (it.radio_id !== undefined ? it.radio_id : it.id));
                  const exact = list.find(it => getUid(it) === num);
                  const prefixUser = list.find(it => getUid(it) !== num && String(getUid(it)).startsWith(String(num)));
                  if (exact) {
                    const normUser = Object.assign({}, exact, { id: num, radio_id: num });
                    if (!window.USER_CALLSIGNS) window.USER_CALLSIGNS = {};
                    window.USER_CALLSIGNS[num] = normUser;
                    try { localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify(window.USER_CALLSIGNS)); } catch (_) {}
                    cache["id_" + num] = { status: "found", prefixUser: prefixUser || null };
                  } else {
                    cache["id_" + num] = { status: "not_found", prefixUser: prefixUser || null };
                  }
                } catch (_) {
                  cache["id_" + num] = { status: "not_found", prefixUser: null };
                }
                if (quickInput && quickInput.value.replace(/\D/g, "") === String(num)) {
                  renderQuickPreview();
                }
              }, 120);
            }

            previewPopup.innerHTML = `
              <div class="quick-tg-pop-header">
                <span class="quick-tg-pop-flag">${flagHtml}</span>
                <span class="quick-tg-pop-badge is-id">ID ${num}</span>
                <span class="quick-tg-pop-country">${safeEscapeHtml(cLabel)}</span>
                <span class="quick-tg-pop-tx-hint">TX ⏎</span>
              </div>
              <div class="quick-tg-pop-quote ${isKnown ? "is-known" : "is-unknown"}">
                ${quoteHtml}
              </div>
            `;
            previewPopup.classList.add("visible");
            return;
          }

          // TalkGroup (1 .. 999999)
          const isParrot = (num === 9990);
          const tgNames = (typeof window !== "undefined" && window.TG_NAMES) || {};
          const parrotDefault = window.t ? window.t("tgtx.parrot_echo_name", {}, "Parrot / Echo (Echo Test)") : "Parrot / Echo (Echo Test)";
          const rawName = tgNames[num] ? String(tgNames[num]).trim() : (isParrot ? parrotDefault : "");
          const cleanDesc = getCleanTgDesc(num, rawName);
          const cInfo = (num >= 100 || rawName) ? getCountryInfo(num, "", "") : { name: "Global", name_en: "", flag: "🌐" };
          const flagHtml = getFlagBadgeHtml(cInfo, isParrot);
          const echoLabel = window.t ? window.t("tgtx.echo_test", {}, "Echo Test") : "Echo Test";
          const cLabel = isParrot ? echoLabel : ((cInfo && cInfo.name && cInfo.name !== "Global") ? cInfo.name : "TalkGroup");

          let quoteHtml = "";
          let isKnown = false;

          if (cleanDesc) {
            isKnown = true;
            const cached = cache["tg_" + num];
            quoteHtml = `<span class="quick-tg-pop-main">«${safeEscapeHtml(cleanDesc)}»</span>` +
              (cached && cached.prefixUser ? formatUserPrefixHint(cached.prefixUser) : "");
          } else if (cache["tg_" + num]) {
            const cached = cache["tg_" + num];
            if (cached.exactName) {
              isKnown = true;
              quoteHtml = `<span class="quick-tg-pop-main">«${safeEscapeHtml(cached.exactName)}»</span>` +
                (cached.prefixUser ? formatUserPrefixHint(cached.prefixUser) : "");
            } else {
              const customTxt = window.t ? window.t("tgtx.custom_group_hint", { tg: num }, `Группа TG ${num} (вне справочника)`) : `Группа TG ${num} (вне справочника)`;
              const exPfx = window.t ? window.t("tgtx.example_prefix", {}, "↳ Напр.:") : "↳ Напр.:";
              quoteHtml = `<span class="quick-tg-pop-main">${safeEscapeHtml(customTxt)}</span>` +
                (cached.prefix ? `<span class="quick-tg-pop-sub">${safeEscapeHtml(exPfx)} <b>TG ${safeEscapeHtml(String(cached.prefix.tg))}</b> — ${safeEscapeHtml(cached.prefix.desc)}</span>` : "") +
                (cached.prefixUser ? formatUserPrefixHint(cached.prefixUser) : "");
            }
          } else {
            const typingTxt = window.t ? window.t("tgtx.typing_group_hint", { tg: num }, `Группа TG ${num} • проверка...`) : `Группа TG ${num} • проверка...`;
            quoteHtml = `<span class="quick-tg-pop-main">${safeEscapeHtml(typingTxt)}</span>`;
            if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
            previewDebounceTimer = setTimeout(async () => {
              try {
                const promises = [
                  fetch(`/api/tg/search?q=${encodeURIComponent(String(num))}&limit=8`).then(r => r.json()).catch(() => null)
                ];
                if (num >= 100) {
                  promises.push(
                    fetch(`/api/dmr/users/search?q=${encodeURIComponent(String(num))}&limit=5`).then(r => r.json()).catch(() => null)
                  );
                }
                const [data, userData] = await Promise.all(promises);
                const list = (data && data.results) || [];
                const exact = list.find(r => Number(r.tg) === num);
                const prefixItem = list.find(r => Number(r.tg) !== num && String(r.tg).startsWith(String(num)));
                let exactClean = "";
                if (exact && exact.name) {
                  exactClean = getCleanTgDesc(num, exact.name) || exact.name;
                  if (!window.TG_NAMES) window.TG_NAMES = {};
                  window.TG_NAMES[num] = exact.name;
                }
                let prefixObj = null;
                if (prefixItem) {
                  const pDesc = getCleanTgDesc(prefixItem.tg, prefixItem.name) || prefixItem.name || ("TG " + prefixItem.tg);
                  prefixObj = { tg: prefixItem.tg, desc: pDesc };
                }
                let prefixUser = null;
                if (userData && Array.isArray(userData.results)) {
                  const getUid = (it) => Number(it && (it.radio_id !== undefined ? it.radio_id : it.id));
                  const exactUser = userData.results.find(it => getUid(it) === num);
                  if (exactUser && !exactClean) {
                    const normUser = Object.assign({}, exactUser, { id: num, radio_id: num });
                    if (!window.USER_CALLSIGNS) window.USER_CALLSIGNS = {};
                    window.USER_CALLSIGNS[num] = normUser;
                    try { localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify(window.USER_CALLSIGNS)); } catch (_) {}
                  }
                  prefixUser = userData.results.find(it => getUid(it) !== num && String(getUid(it)).startsWith(String(num))) || null;
                }
                cache["tg_" + num] = { exactName: exactClean, prefix: prefixObj, prefixUser };
              } catch (_) {
                cache["tg_" + num] = { exactName: "", prefix: null, prefixUser: null };
              }
              if (quickInput && quickInput.value.replace(/\D/g, "") === String(num)) {
                renderQuickPreview();
              }
            }, 120);
          }

          previewPopup.innerHTML = `
            <div class="quick-tg-pop-header">
              <span class="quick-tg-pop-flag">${flagHtml}</span>
              <span class="quick-tg-pop-badge is-tg">TG ${num}</span>
              <span class="quick-tg-pop-country">${safeEscapeHtml(cLabel)}</span>
              <span class="quick-tg-pop-tx-hint">TX ⏎</span>
            </div>
            <div class="quick-tg-pop-quote ${isKnown ? "is-known" : "is-unknown"}">
              ${quoteHtml}
            </div>
          `;
          previewPopup.classList.add("visible");
        };

        const applyQuick = () => {
          if (!quickInput) return;
          const valStr = quickInput.value.trim();
          const val = parseInt(valStr, 10);
          const cid = card.dataset.hotspotId || hs.id;
          const slot = card._activeSlot || getHotspotSlot(cid);
          const hsApplyNet = String(getHotspotNetworkType(card) || getHotspotNetworkType(cid) || "").toLowerCase();
          const netType = (hsApplyNet && hsApplyNet !== "bm") ? hsApplyNet : String(card.dataset.networkType || (hs && hs.network_type) || hsApplyNet || "bm").toLowerCase();
          hideQuickPreview();

          if (netType === "allstar") {
            if (!isNaN(val) && val > 0 && val <= 9999999) {
              switchActiveHotspot(cid);
              const ws = (typeof getWs === "function" ? getWs() : window.ws);
              const currentMode = (typeof window.getHotspotAslMode === "function") ? window.getHotspotAslMode(cid) : "*2";
              aslConnectNodeProcedure(cid, String(val), currentMode, { showStatusBanner: true, showCardEffects: true });
              if (typeof showToast === "function") {
                const mLabel = (currentMode === "*2") ? "Monitor" : "RX/TX";
                const addLabel = isAdd ? " [+]" : "";
                const connToast = window.t
                  ? window.t("asl.connecting_node_toast", { node: val, mode: `${mLabel}${addLabel}` }, `Connecting to node #${val} (${mLabel}${addLabel})...`)
                  : `Connecting to node #${val} (${mLabel}${addLabel})...`;
                showToast(connToast, "info", 2000);
              }
              quickInput.value = "";
              quickInput.placeholder = "Node #";
              const box = quickInput.closest(".quick-tg-box");
              if (box) {
                box.style.borderColor = "#38bdf8";
                box.style.boxShadow = "0 0 10px rgba(56, 189, 248, 0.4)";
                setTimeout(() => {
                  if (box) {
                    box.style.borderColor = "";
                    box.style.boxShadow = "";
                  }
                }, 600);
              }
            }
            return;
          }

          if (netType === "ysf") {
            const rawVal = quickInput.value.trim();
            if (!rawVal) return;
            const cleanNum = parseInt(rawVal, 10);
            if (isNaN(cleanNum) || cleanNum <= 0) {
              if (typeof showToast === "function") {
                showToast(window.t ? window.t("ysf.invalid_room_id_toast", {}, "Enter a valid YSF room number (numeric ID)") : "Enter a valid YSF room number (numeric ID)", "error", card);
              }
              return;
            }

            const ysfList = (typeof window !== "undefined" && typeof window.getNetworkServersList === "function" ? window.getNetworkServersList("ysf") : ((window._dmrServersCache && window._dmrServersCache["ysf"]) || [])) || [];
            const matchedRoom = ysfList.find(r => {
              const rIdStr = String(r.id || "").trim();
              return rIdStr === rawVal || (parseInt(rIdStr, 10) === cleanNum);
            });

            const box = quickInput.closest(".quick-tg-box");

            if (!matchedRoom) {
              if (box) {
                box.style.borderColor = "#ff2a38";
                box.style.boxShadow = "0 0 10px rgba(255, 42, 56, 0.5)";
                setTimeout(() => {
                  if (box) {
                    box.style.borderColor = "";
                    box.style.boxShadow = "";
                  }
                }, 800);
              }
              if (typeof showToast === "function") {
                showToast(window.t ? window.t("ysf.room_not_in_dir_toast", { room: rawVal }, `YSF room #${rawVal} not found in directory`) : `YSF room #${rawVal} not found in directory`, "error", card);
              }
              return;
            }

            switchActiveHotspot(cid);
            quickInput.value = "";
            quickInput.placeholder = "ID #";

            if (box) {
              box.style.borderColor = "#2ea043";
              box.style.boxShadow = "0 0 10px rgba(46, 160, 67, 0.4)";
              setTimeout(() => {
                if (box) {
                  box.style.borderColor = "";
                  box.style.boxShadow = "";
                }
              }, 600);
            }

            if (typeof window.connectYsfRoomById === "function") {
              window.connectYsfRoomById(matchedRoom.id, matchedRoom.reflector_name || matchedRoom.name, card);
            }
            return;
          }

          if (netType === "dstar") {
            const rawVal = quickInput.value.trim().toUpperCase();
            if (!rawVal) return;
            switchActiveHotspot(cid);
            if (/^[A-Z]$/.test(rawVal)) {
              if (typeof _sendDstarModuleUpdate === "function") {
                _sendDstarModuleUpdate(card, cid, { module: rawVal });
              }
            } else {
              const parts = rawVal.split(/\s+/);
              const refQuery = parts[0];
              const modQuery = parts[1] ? parts[1].slice(0, 1) : "B";
              const dstarList = (typeof window !== "undefined" && typeof window.getNetworkServersList === "function" ? window.getNetworkServersList("dstar") : ((window._dmrServersCache && window._dmrServersCache["dstar"]) || [])) || [];
              const found = dstarList.find(r => String(r.designator || r.id || "").toUpperCase() === refQuery);
              if (found) {
                if (typeof connectDstarRef === "function") connectDstarRef(card, cid, found, modQuery);
              } else {
                if (typeof connectDstarRef === "function") connectDstarRef(card, cid, { designator: refQuery, id: refQuery, host: refQuery, port: 30001, protocol: "dextra" }, modQuery);
              }
            }
            quickInput.value = "";
            return;
          }

          if (netType === "svx") {
            const rawVal = quickInput.value.trim();
            if (!rawVal) return;
            const tgNum = parseInt(rawVal, 10);
            if (isNaN(tgNum) || tgNum < 0) return;
            switchActiveHotspot(cid);
            if (typeof selectSvxTg === "function") selectSvxTg(card, cid, tgNum);
            quickInput.value = "";
            return;
          }

          if (!isNaN(val) && val > 0 && val <= 9999999) {
            if (hs && hs._adnDiceRolling) {
              stopAdnDiceSearch(cid, card, hs, { immediateAbort: true, silent: true });
            }
            switchActiveHotspot(cid);
            setHotspotTg(cid, slot, val, true);
            quickInput.value = "";
            quickInput.placeholder = "TG #";
            const box = quickInput.closest(".quick-tg-box");
            if (box) {
              box.style.borderColor = "#2ea043";
              box.style.boxShadow = "0 0 10px rgba(46, 160, 67, 0.4)";
              setTimeout(() => {
                if (box) {
                  box.style.borderColor = "";
                  box.style.boxShadow = "";
                }
              }, 600);
            }
          }
        };

        if (previewPopup) {
          previewPopup.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            applyQuick();
            if (quickInput && typeof quickInput.blur === "function") {
              quickInput.blur();
            }
          });
        }

        if (quickInput) {
          quickInput.addEventListener("input", () => {
            if (previewBlurTimer) {
              clearTimeout(previewBlurTimer);
              previewBlurTimer = null;
            }
            renderQuickPreview();
          });
          quickInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyQuick();
              quickInput.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              hideQuickPreview();
              quickInput.blur();
            }
          });
          quickInput.addEventListener("focus", () => {
            if (previewBlurTimer) {
              clearTimeout(previewBlurTimer);
              previewBlurTimer = null;
            }
            const cid = card.dataset.hotspotId || hs.id;
            switchActiveHotspot(cid);
            if (quickInput.value.trim()) {
              renderQuickPreview();
            }
          });
          quickInput.addEventListener("blur", () => {
            previewBlurTimer = setTimeout(() => {
              hideQuickPreview();
            }, 160);
          });
        }

        if (quickApply) {
          quickApply.addEventListener("click", (e) => {
            e.stopPropagation();
            applyQuick();
          });
        }
      }

      // Sync Log Drawer button active state on every card render
      const btnLog = card.querySelector(".btn-log-drawer");
      if (btnLog) {
        const cid = card.dataset.hotspotId || hs.id;
        const isMobile = window.innerWidth <= 768;
        const curLogHid = typeof window.currentLogHotspotId !== "undefined" ? window.currentLogHotspotId : "all";
        const effectiveHid = (isMobile && (!curLogHid || curLogHid === "all"))
          ? (activeHotspotId || (currentHotspots[0] && currentHotspots[0].id) || "default")
          : curLogHid;
        const resolveHid = typeof window.resolveHotspotId === "function" ? window.resolveHotspotId : (h => h || "default");
        const isCurrent = Boolean(window.isLogVisible && (resolveHid(effectiveHid) === resolveHid(cid) || (!isMobile && effectiveHid === "all")));
        btnLog.classList.toggle("active", isCurrent);
        btnLog.title = isCurrent ? (window.t ? window.t("hotspots.log_hide_title", {}, "Скрыть журнал вызовов") : "Скрыть журнал вызовов") : (window.t ? window.t("hotspots.log_show_title", {}, "Показать журнал вызовов для этого хотспота") : "Показать журнал вызовов для этого хотспота");
      }

      // Initialize slot selection and talkgroup displays on this specific card
      const curCardSlot = card._activeSlot || getHotspotSlot(hs.id);
      setCardSlot(card, curCardSlot, false);
      updateCardTgDisplay(card);

      // Ensure static Quick TG / ID / Node placeholder
      const isAslCard = card.classList.contains("card-net-allstar") || ((hs.network_type || "bm").toLowerCase() === "allstar");
      const isYsfCard = card.classList.contains("card-net-ysf") || ((hs.network_type || "bm").toLowerCase() === "ysf");
      const quickInp = card.querySelector(".quick-tg-input");
      if (quickInp) {
        quickInp.placeholder = isYsfCard ? "ID #" : (isAslCard ? "Node #" : "TG #");
      }

      // Sync volume & mute UI on this card
      updateHotspotVolumeAndMuteUI(hs.id);

      // Sync PTT lock state on this card
      const cLockIcon = card.querySelector(".ptt-lock-icon");
      if (cLockIcon) {
        cLockIcon.classList.toggle("locked", isPttLocked(hs.id));
      }

      // Keep bottom toggles in sync with saved/active state
      const chkAgc = card.querySelector(".agc-toggle");
      if (chkAgc) {
        chkAgc.checked = getHotspotAgc(hs.id);
      }
      if (typeof window.updateCardTsAudioModeUI === "function") {
        window.updateCardTsAudioModeUI(card, hs.id);
      }
      const isCardCollapsed = isHotspotCollapsed(hs.id);
      const isCardLive = isHotspotLiveCollapsed(hs.id);
      card.classList.toggle("collapsed", isCardCollapsed);
      card.classList.toggle("live-collapsed", isCardCollapsed && isCardLive);
      const cBtn = card.querySelector(".hotspot-collapse-btn");
      if (cBtn) {
        cBtn.title = isCardCollapsed
          ? (window.t ? window.t("vfo.hotspot_expand_title", {}, "Expand this hotspot (hold: move to archive)") : "Expand this hotspot (hold: move to archive)")
          : (window.t ? window.t("vfo.hotspot_collapse_title", {}, "Collapse this hotspot (hold: collapse without disconnect)") : "Collapse this hotspot (hold: collapse without disconnect)");
      }
      const nBadge = card.querySelector(".hotspot-name-badge");
      if (isCardCollapsed && !isCardLive) {
        if (nBadge) nBadge.classList.remove("is-online");
        setHotspotAudioMute(hs.id, true);
        if (window.audioPlayer && audioPlayer.resetHotspot) {
          audioPlayer.resetHotspot(hs.id);
        }
        if (hs.status === "ONLINE" || hs.status === "CONNECTING" || hs.status === "AUTHENTICATING") {
          const collapsedDet = window.t ? window.t("status.bm_collapsed_detail", {}, "Collapsed / disconnected") : "Collapsed / disconnected";
          hs.status = "DISCONNECTED";
          hs.detail = collapsedDet;
          updateBmStatus("DISCONNECTED", collapsedDet, hs.id);
          fetch(`/api/hotspots/${hs.id}/collapse`, { method: "POST" }).catch(() => {});
          const curWs = (typeof window !== "undefined" && window.ws) || null;
          if (curWs && curWs.readyState === WebSocket.OPEN) {
            curWs.send(JSON.stringify({ type: "hotspot_collapse", hotspot_id: hs.id, collapsed: true }));
          }
        }
      } else if (isCardCollapsed && isCardLive) {
        if (nBadge && isHotspotFullyOnline(hs)) {
          nBadge.classList.add("is-online");
        }
      }
    });

    syncCollapsedHotspotStacks();
    if (typeof window !== "undefined" && window._lastServerCpuMetrics && typeof window.updateServerCpuIndicator === "function") {
      window.requestAnimationFrame(() => window.updateServerCpuIndicator(window._lastServerCpuMetrics));
    }

    renderLogHotspotTabs();
    initQuickAssign();
    if (typeof updatePttLockUI === "function") {
      updatePttLockUI();
    }
    if (typeof window !== "undefined") {
      if (typeof window.updateAmbePresetUI === "function") {
        try { window.updateAmbePresetUI(); } catch (_) {}
      }
      if (typeof window.updateAudioRxPresetUI === "function") {
        try { window.updateAudioRxPresetUI(); } catch (_) {}
      }
      if (typeof window.updateAudioTxPresetUI === "function") {
        try { window.updateAudioTxPresetUI(); } catch (_) {}
      }
    }
    if (typeof window.updateLogVisibility === "function") {
      window.updateLogVisibility(false);
    }
    syncDesktopHotspotsTopAlignment();
  }
export function applyActiveHotspotToUI() {
    const hs = currentHotspots.find(h => h.id === activeHotspotId) || currentHotspots[0];
    if (!hs) return;

    const activeNet = getHotspotNetworkType(hs);
    if (activeNet === "adn") {
      refreshAdnServers(false);
    } else if (activeNet === "dmrplus") {
      refreshDmrPlusServers(false);
    }

    // Respect unified saved talkgroup from localStorage, or fall back to hotspot config defaults
    const savedTg = parseInt(localStorage.getItem(`proxdmr_tg_${hs.id}`) || localStorage.getItem("proxdmr_tg") || localStorage.getItem("proxdmr_tg_ts2") || localStorage.getItem("proxdmr_tg_ts1"), 10);
    const unifiedTg = (!isNaN(savedTg) && savedTg > 0) ? savedTg : (hs.default_tg || hs.default_tg_ts2 || hs.default_tg_ts1 || 2501);

    tgTs1 = unifiedTg;
    tgTs2 = unifiedTg;
    localStorage.setItem(`proxdmr_tg_${hs.id}`, unifiedTg.toString());
    localStorage.setItem("proxdmr_tg", unifiedTg.toString());
    localStorage.setItem("proxdmr_tg_ts1", unifiedTg.toString());
    localStorage.setItem("proxdmr_tg_ts2", unifiedTg.toString());

    updateTgDisplay();
    updateBmStatus(hs.status, hs.detail, hs.id);
  }
export function renderHotspotsList() {
    const hotspotsListContainer = document.getElementById("hotspotsListContainer");
    if (!hotspotsListContainer) return;
    const currentHotspots = window.currentHotspots || [];
    const activeHotspotId = window.activeHotspotId || "default";
    hotspotsListContainer.innerHTML = "";
    if (!currentHotspots.length) {
      const emptyHs = window.t ? window.t("hotspots.empty_configured", {}, "No configured hotspots") : "No configured hotspots";
      hotspotsListContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem;">${emptyHs}</div>`;
      return;
    }

    currentHotspots.forEach(hs => {
      const card = document.createElement("div");
      card.className = "hotspot-card" + (hs.id === activeHotspotId ? " active-card" : "");

      const isCollapsed = isHotspotCollapsed(hs.id);
      const isLive = isHotspotLiveCollapsed(hs.id);
      const isOnline = (!isCollapsed || isLive) && hs.status === "ONLINE";
      const hsNet = (hs.network_type || "bm").toLowerCase();
      let netTag = "BM";
      let autoTgDisabledKey = "hotspots.auto_tg_bm_disabled_title";
      let autoTgCardTextKey = "hs_edit.auto_tg_bm";
      let autoTgCardTextFallback = "Auto BM TG";
      if (hsNet === "tgif") {
        netTag = "TGIF";
        autoTgDisabledKey = "hotspots.auto_tg_tgif_disabled_title";
        autoTgCardTextKey = "hs_edit.auto_tg_tgif";
        autoTgCardTextFallback = "Auto TGIF TG";
      } else if (hsNet === "freedmr") {
        netTag = "FreeDMR";
        autoTgDisabledKey = "hotspots.auto_tg_freedmr_disabled_title";
        autoTgCardTextKey = "hs_edit.auto_tg_freedmr";
        autoTgCardTextFallback = "Auto FreeDMR TG";
      } else if (hsNet === "adn") {
        netTag = "ADN";
        autoTgDisabledKey = "hotspots.auto_tg_adn_disabled_title";
        autoTgCardTextKey = "hs_edit.auto_tg_adn";
        autoTgCardTextFallback = "Auto ADN TG";
      } else if (hsNet === "xlx") {
        netTag = "XLX";
        autoTgDisabledKey = "hotspots.auto_tg_xlx_disabled_title";
        autoTgCardTextKey = "hs_edit.auto_tg_xlx";
        autoTgCardTextFallback = "Auto-connect XLX";
      }
      const lockTitle = window.t
        ? window.t(autoTgDisabledKey, {}, `Auto ${netTag} TG disabled`)
        : `Auto ${netTag} TG disabled`;
      const lockIcon = !isAutoTgBm ? `<span class="hs-lock-icon" style="margin-left: 6px; font-size: 0.95em; vertical-align: middle;" title="${lockTitle}">🔒</span>` : '';
      const collapsedBgText = window.t ? window.t("hotspots.badge_collapsed_bg", {}, "🟢 COLLAPSED (BG)") : "🟢 COLLAPSED (BG)";
      const collapsedText = window.t ? window.t("hotspots.badge_collapsed", {}, "⚪ COLLAPSED") : "⚪ COLLAPSED";
      const statusBadge = isCollapsed
        ? (isLive
            ? `<span style='color: #00e676; font-size: 0.75rem; font-weight: bold;'>${collapsedBgText}</span>`
            : `<span style='color: var(--text-muted); font-size: 0.75rem;'>${collapsedText}</span>`)
        : (isOnline
          ? "<span style='color: var(--color-green); font-size: 0.75rem; font-weight: bold;'>🟢 ONLINE</span>"
          : "<span style='color: var(--text-muted); font-size: 0.75rem;'>⚪ OFFLINE</span>");

      const autoRecTitle = window.t ? window.t("hs_edit.auto_record", {}, "Auto-record TS1/2") : "Auto-record TS1/2";
      card.innerHTML = `
        <div class="hotspot-card-header">
          <div class="hotspot-card-title">
            <span>${escapeHtml(hs.name)}</span>${lockIcon}
            ${statusBadge}
          </div>
          <span class="hotspot-card-meta">${escapeHtml(window.localizeDemoText ? window.localizeDemoText(hs.callsign) : hs.callsign)} | ${hs.effective_id || hs.dmr_id}</span>
        </div>
        <div class="hotspot-card-meta">
          ${escapeHtml(hs.bm_master_host)}:${hs.bm_master_port}
        </div>
        <div class="hotspot-card-actions" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
          <div class="hotspot-card-btns" style="display: flex; align-items: center; gap: 6px;">
            <button class="btn-card-action primary btn-toggle-conn" data-id="${hs.id}">
              ${isOnline ? (window.t ? window.t("hotspots.btn_disconnect", {}, "Disconnect") : "Disconnect") : (window.t ? window.t("hotspots.btn_connect", {}, "🔗 Connect") : "🔗 Connect")}
            </button>
            <button class="btn-card-action btn-edit-hs" data-id="${hs.id}">✏️ ${window.t ? window.t("buttons.edit", {}, "Edit") : "Edit"}</button>
            ${currentHotspots.length > 1 ? `<button class="btn-card-action danger btn-del-hs" data-id="${hs.id}">🗑️</button>` : ""}
          </div>
          <div class="hs-card-toggles-row" style="display: flex; align-items: center; gap: 10px; margin-left: auto; flex-wrap: wrap;">
            ${(hsNet === "bm") ? `
            <label class="hs-card-autotg-label" style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; cursor: pointer; user-select: none; color: var(--text-primary, #c9d1d9);">
              <input type="checkbox" class="chk-hs-autotg" data-id="${hs.id}" ${isAutoTgBm ? 'checked' : ''} style="cursor: pointer; width: 15px; height: 15px; accent-color: #58a6ff;">
              <span>${window.t ? window.t(autoTgCardTextKey, {}, autoTgCardTextFallback) : autoTgCardTextFallback}</span>
            </label>` : ""}
            <label class="hs-card-autorec-label" style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; cursor: pointer; user-select: none; color: var(--text-primary, #c9d1d9);" title="${escapeHtml(autoRecTitle)}" data-i18n-title="hs_edit.auto_record">
              <input type="checkbox" class="chk-hs-autorec" data-id="${hs.id}" ${hs.auto_record !== false ? 'checked' : ''} style="cursor: pointer; width: 15px; height: 15px; accent-color: #ef4444;">
              <span data-i18n="hs_edit.auto_record">${escapeHtml(autoRecTitle)}</span>
            </label>
          </div>
        </div>
      `;

      const toggleConnBtn = card.querySelector(".btn-toggle-conn");
      if (toggleConnBtn) {
        toggleConnBtn.onclick = async () => {
          if (isCollapsed) {
            await expandHotspot(hs.id);
            return;
          }
          const action = isOnline ? "disconnect" : "connect";
          await fetch(`/api/hotspots/${hs.id}/${action}`, { method: "POST" });
          loadHotspots();
        };
      }

      const editHsBtn = card.querySelector(".btn-edit-hs");
      if (editHsBtn) {
        editHsBtn.onclick = () => {
          openEditHotspotForm(hs);
        };
      }

      const delBtn = card.querySelector(".btn-del-hs");
      if (delBtn) {
        delBtn.onclick = async () => {
          const fallbackDel = `Delete hotspot "${hs.name}"?`;
          const ok = await (window.showAppConfirm ? window.showAppConfirm({
            title: window.t ? window.t("hotspots.delete_confirm_title", {}, "Delete hotspot") : "Delete hotspot",
            icon: "🗑️",
            message: window.t ? window.t("hotspots.delete_confirm_msg", { name: hs.name }, fallbackDel) : fallbackDel,
            confirmText: window.t ? window.t("buttons.delete", {}, "Delete") : "Delete",
            confirmStyle: "danger"
          }) : Promise.resolve(confirm(window.t ? window.t("hotspots.delete_confirm_msg", { name: hs.name }, fallbackDel) : fallbackDel)));
          if (ok) {
            if (typeof disableHotspotTranscribe === "function") {
              disableHotspotTranscribe(hs.id, true);
            }
            await fetch(`/api/hotspots/${hs.id}`, { method: "DELETE" });
            const gw = (typeof window !== "undefined" && window.contactsGateway) || null;
            if (gw && (String(gw.hotspot_id) === String(hs.id) || resolveHotspotId(gw.hotspot_id) === resolveHotspotId(hs.id))) {
              gw.hotspot_id = "default";
              saveContactsToServer();
            }
            loadHotspots();
          }
        };
      }

      const autoTgChk = card.querySelector(".chk-hs-autotg");
      if (autoTgChk) {
        autoTgChk.onclick = async (e) => {
          e.stopPropagation();
          const newVal = autoTgChk.checked;
          hs.auto_tg_bm = newVal;
          try {
            const res = await fetch(`/api/hotspots/${hs.id}/auto-tg-bm`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: newVal })
            });
            if (res.ok) {
              let netKeyOn = "hotspots.auto_tg_bm_on";
              let netKeyOff = "hotspots.auto_tg_bm_off";
              if (hsNet === "tgif") {
                netKeyOn = "hotspots.auto_tg_tgif_on";
                netKeyOff = "hotspots.auto_tg_tgif_off";
              } else if (hsNet === "freedmr") {
                netKeyOn = "hotspots.auto_tg_freedmr_on";
                netKeyOff = "hotspots.auto_tg_freedmr_off";
              } else if (hsNet === "xlx") {
                netKeyOn = "hotspots.auto_tg_xlx_on";
                netKeyOff = "hotspots.auto_tg_xlx_off";
              }
              const toastMsg = newVal
                ? (window.t ? window.t(netKeyOn, { name: hs.name }, `✅ [${hs.name}]: Auto ${netTag} TG enabled`) : `✅ [${hs.name}]: Auto ${netTag} TG enabled`)
                : (window.t ? window.t(netKeyOff, { name: hs.name }, `🔒 [${hs.name}]: Auto ${netTag} TG disabled`) : `🔒 [${hs.name}]: Auto ${netTag} TG disabled`);
              showToast(toastMsg, 2500);
            }
          } catch (err) {
            console.error("Failed to toggle auto_tg_bm:", err);
          }
          renderHotspotsList();
        };
      }

      const autoRecChk = card.querySelector(".chk-hs-autorec");
      if (autoRecChk) {
        autoRecChk.onclick = async (e) => {
          e.stopPropagation();
          const newVal = autoRecChk.checked;
          hs.auto_record = newVal;
          try {
            localStorage.setItem(`proxdmr_autorec_${resolveHotspotId(hs.id)}`, newVal ? "1" : "0");
          } catch (_) {}
          updateAllHotspotRecUI();
          try {
            const res = await fetch(`/api/hotspots/${hs.id}/auto-record`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: newVal })
            });
            if (res.ok) {
              showToast(
                newVal
                  ? (window.t ? window.t("hotspots.autorec_on", { name: hs.name }, `✅ [${hs.name}]: Call auto-recording enabled`) : `✅ [${hs.name}]: Call auto-recording enabled`)
                  : (window.t ? window.t("hotspots.autorec_off", { name: hs.name }, `⏸️ [${hs.name}]: Call auto-recording disabled`) : `⏸️ [${hs.name}]: Call auto-recording disabled`),
                2500
              );
            }
          } catch (err) {
            console.error("Failed to toggle auto_record:", err);
          }
          renderHotspotsList();
        };
      }

      hotspotsListContainer.appendChild(card);
    });
  }
export async function fetchBmMasters() {
    try {
      const resp = await fetch("/api/dmr/servers?network_type=bm");
      if (resp.ok) {
        const data = await resp.json();
        const list = (data && Array.isArray(data.servers)) ? data.servers : (data && Array.isArray(data.masters) ? data.masters : []);
        if (list.length > 0) {
          window._dmrServersCache = window._dmrServersCache || {};
          window._dmrServersCache["bm"] = list;
          window._dmrServersCacheVer = Date.now();
          bmMastersList = list;
          window.bmMastersList = bmMastersList;
          if (window.__proxdmr) window.__proxdmr.bmMastersList = bmMastersList;
          const editHsHost = document.getElementById("editHsHost");
          renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "bm");
          refreshAllCardsBmBanner();
        }
      }
    } catch (e) {
      console.warn("Не удалось загрузить список серверов BM:", e);
    }
  }
export function renderBmMastersDropdown(currentHost, networkTypeOverride = null) {
    const editHsMasterSelect = document.getElementById("editHsMasterSelect");
    if (!editHsMasterSelect) return;
    const editHsHost = document.getElementById("editHsHost");
    const editHsNetworkType = document.getElementById("editHsNetworkType");
    const netType = (networkTypeOverride || (editHsNetworkType ? editHsNetworkType.value : "bm") || "bm").toLowerCase();
    const profile = getDmrNetworkProfile(netType);
    const hostVal = (currentHost !== undefined && currentHost !== null) ? currentHost : (editHsHost ? editHsHost.value : "");
    editHsMasterSelect.dataset.networkType = netType;
    editHsMasterSelect.innerHTML = "";

    if (netType === "allstar") {
      editHsMasterSelect.innerHTML = "";
      const masterSelectGroup = document.getElementById("editHsMasterSelectGroup");
      if (masterSelectGroup) masterSelectGroup.style.display = "none";
      return;
    }

    if (netType !== "custom") {
      const benchOpt = document.createElement("option");
      benchOpt.value = "__TEST_SERVERS__";
      benchOpt.textContent = window.t ? window.t("hotspots.bench_opt", {}, "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)") : "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)";
      editHsMasterSelect.appendChild(benchOpt);
    }

    const netName = profile.shortName || profile.shortLabel || (netType ? netType.toUpperCase() : "DMR");
    const defOpt = document.createElement("option");
    defOpt.value = "";
    defOpt.textContent = netType === "bm"
      ? (window.t ? window.t("hs_edit.master_select_prompt") : "🌍 Выберите страну / сервер BM...")
      : (window.t ? window.t("hs_edit.master_select_net_prompt", { net: netName }, `🌐 Выберите сервер ${netName}...`) : `🌐 Выберите сервер ${netName}...`);
    editHsMasterSelect.appendChild(defOpt);

    let matched = false;
    const cleanCurrent = (hostVal || "").trim().toLowerCase();

    const curLang = (window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "en";
    const recTag = window.t ? window.t("bm.master_recommended", {}, "⭐ [Recommended]") : "⭐ [Recommended]";
    const intlLabel = window.t ? window.t("common.international", {}, "International") : "International";
    const msUnit = window.t ? window.t("ping.unit_ms", {}, "ms") : "ms";
    const deadLabel = window.t ? window.t("server_probe.no_reply", {}, "🔴 NO REPLY") : "🔴 NO REPLY";

    const cached = window._dmrServersCache && window._dmrServersCache[netType];
    const rawServers = (Array.isArray(cached) && cached.length > 0)
      ? cached
      : (netType === "bm"
          ? (Array.isArray(bmMastersList) && bmMastersList.length ? bmMastersList : (typeof getNetworkServersList === "function" ? getNetworkServersList("bm") : []))
          : (typeof getNetworkServersList === "function" ? getNetworkServersList(netType) : []));

    const servers = typeof sortServersForDropdown === "function" ? sortServersForDropdown(rawServers) : rawServers;

    if (Array.isArray(servers)) {
      servers.forEach(m => {
        if (!m) return;
        const opt = document.createElement("option");
        opt.value = m.host || "";
        if (m.port) opt.dataset.port = String(m.port);
        if (m.password) opt.dataset.password = String(m.password);
        if (m.designator || m.id) opt.dataset.designator = String(m.designator || m.id);
        if (m.server_type) opt.dataset.serverType = String(m.server_type);
        if (m.protocol) opt.dataset.protocol = String(m.protocol);

        let cCode = (m.country_code || m.country || "").toUpperCase();
        let refName = (m.reflector_name || "").trim();
        const rawName = (m.name || "").trim();

        if (netType === "ysf") {
          if (!refName || !cCode || cCode === "GLOBAL") {
            const match = rawName.match(/^([A-Za-z]{2})[-_ ]\s*(.*)$/);
            if (match) {
              if (!cCode || cCode === "GLOBAL") cCode = match[1].toUpperCase();
              if (!refName) refName = match[2].trim();
            }
          }
          if (!cCode) cCode = "XX";
          if (m.id) opt.dataset.roomId = String(m.id);
        }

        const isGlobalOrXx = !cCode || cCode === "GLOBAL" || cCode === "XX";
        const flag = m.flag || (!isGlobalOrXx ? isoToEmoji(cCode) : "🌐");
        const recSuffix = m.recommended ? ` ${recTag}` : "";

        let itemCore = "";
        if (netType === "m17") {
          const eng = String(m.server_type || "mrefd").toUpperCase();
          const mods = Array.isArray(m.modules) && m.modules.length ? m.modules.join("") : "AC";
          const downTag = m.is_down ? "🔴 " : "";
          itemCore = `${downTag}${flag} ${m.designator || m.id || "M17"} [${eng}] (${mods}) — ${m.name || m.host || ""}`;
        } else if (netType === "dstar") {
          const proto = String(m.protocol || "dextra").toUpperCase();
          const desig = m.designator || m.id || "D-STAR";
          const countryName = !isGlobalOrXx
            ? getLocalizedCountryName(cCode, m.country_name || m.country || "", curLang)
            : "";
          const descPart = (m.name && m.name !== desig && m.name !== `${desig} Reflector`)
            ? m.name
            : (countryName || `${desig} Reflector`);
          itemCore = `${flag} ${desig} [${proto}] — ${descPart} (${m.host || ""})`;
        } else if (netType === "svx") {
          const countryName = !isGlobalOrXx
            ? getLocalizedCountryName(cCode, m.country_name || m.country || "SVX", curLang)
            : (m.country_name || "SVX");
          const srvName = m.name || m.id || countryName;
          itemCore = `${flag} ${countryName} — ${srvName} (${m.host || ""}:${m.port || 5300})`;
        } else if (netType === "ysf") {
          const localizedCountry = !isGlobalOrXx
            ? getLocalizedCountryName(cCode, cCode, curLang)
            : intlLabel;
          const targetName = refName || localizedCountry;
          const idTag = m.id ? ` #${m.id}` : "";
          itemCore = `${flag} ${cCode} ${targetName}${idTag} (${m.host || ""})`;
        } else {
          const countryName = cCode !== "GLOBAL"
            ? getLocalizedCountryName(cCode, m.country_name || m.country || profile.shortLabel || profile.shortName || "DMR", curLang)
            : (m.country_name || m.country || profile.shortLabel || profile.shortName || "DMR");
          const prefixLabel = netType === "bm" ? `BM ${m.id || ""}` : (m.name || m.id || "");
          const labelMid = prefixLabel ? `${prefixLabel} ` : "";
          itemCore = `${flag} ${countryName} — ${labelMid}(${m.host || ""})`;
        }

        const st = (m.state || "").toLowerCase();
        const isDead = ["no_reply", "refused", "dns_fail"].includes(st) ||
                       (m.udp_ok === false && m.avg_ping == null && m.udp_ms == null) ||
                       (m.loss_pct !== undefined && m.loss_pct >= 100);
        const pingVal = (m.udp_ms !== undefined && m.udp_ms !== null) ? m.udp_ms : ((m.avg_ping !== undefined && m.avg_ping !== null) ? m.avg_ping : null);

        if (isDead) {
          opt.textContent = `${deadLabel} · ${itemCore}`;
          opt.style.color = "#ef4444";
          opt.dataset.dead = "1";
        } else if (pingVal !== null && !isNaN(pingVal)) {
          opt.textContent = `⚡ ${Math.round(pingVal)} ${msUnit} · ${itemCore}${recSuffix}`;
          opt.dataset.ping = String(Math.round(pingVal));
        } else {
          opt.textContent = `${itemCore}${recSuffix}`;
        }

        const mHost = (m.host || "").toLowerCase();
        const mIp = (m.ip || "").toLowerCase();
        if (cleanCurrent && (cleanCurrent === mHost || cleanCurrent === mIp)) {
          opt.selected = true;
          matched = true;
        }
        editHsMasterSelect.appendChild(opt);
      });
    }

    if (!matched && cleanCurrent) {
      const customOpt = document.createElement("option");
      customOpt.value = cleanCurrent;
      customOpt.textContent = (netType === "freedmr" || netType === "adn")
        ? (window.t ? window.t("hs_edit.custom_outdated_opt", { host: cleanCurrent }, `⚠️ Custom / outdated: ${cleanCurrent}`) : `⚠️ Custom / outdated: ${cleanCurrent}`)
        : (window.t ? window.t("hs_edit.master_custom_with_host", { host: cleanCurrent }, `✏️ Enter custom address (${cleanCurrent})`) : `✏️ Enter custom address (${cleanCurrent})`);
      customOpt.selected = true;
      editHsMasterSelect.appendChild(customOpt);
    } else {
      const customOpt = document.createElement("option");
      customOpt.value = "CUSTOM";
      customOpt.textContent = window.t ? window.t("hs_edit.master_custom_option", {}, "✏️ Enter custom address manually (another server / IP)") : "✏️ Enter custom address manually (another server / IP)";
      editHsMasterSelect.appendChild(customOpt);
    }
  }

export function buildRptoFromCurrentFormFields(netTypeOverride) {
  const editHsNetworkType = document.getElementById("editHsNetworkType");
  const cleanType = (netTypeOverride || (editHsNetworkType && editHsNetworkType.value) || "bm").toLowerCase();
  const editHsId = document.getElementById("editHsId");

  if (cleanType === "dmrplus") {
    const refEl = document.getElementById("editHsDmrPlusRef");
    const relinkEl = document.getElementById("editHsDmrPlusRelink");
    const startRef = parseInt(refEl ? refEl.value : "4530", 10) || 4530;
    const relinkTime = parseInt(relinkEl ? relinkEl.value : "60", 10) || 60;
    const parts = [`StartRef=${startRef}`, `RelinkTime=${relinkTime}`];
    return parts.join(";") + ";";
  }

  if (cleanType === "freedmr" || cleanType === "adn" || cleanType === "custom") {
    const curId = editHsId ? editHsId.value.trim() : "";
    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    const curHs = currentHotspots.find(h => h.id === curId);
    const isSimplex = curHs && curHs.duplex === false;

    const parts = [];
    if (isSimplex) {
      // Simplex Hotspots can only use TS2
      const activeTg = (tg2 > 0 && tg2 !== 9990) ? tg2 : ((tg1 > 0 && tg1 !== 9990) ? tg1 : 0);
      if (activeTg > 0) parts.push(`TS2=${activeTg}`);
    } else {
      if (tg1 > 0 && tg1 !== 9990) parts.push(`TS1=${tg1}`);
      if (tg2 > 0 && tg2 !== 9990 && tg2 !== tg1) parts.push(`TS2=${tg2}`);
      if (tg1 === tg2 && tg1 > 0) {
        const dupKey = (cleanType === "adn") ? "adn.dup_slot_toast" : "freedmr.dup_slot_toast";
        const defDup = (cleanType === "adn")
          ? `ADN Systems does not allow the same TG on both slots — TG ${tg1} was kept on TS1 only`
          : `FreeDMR does not allow the same TG on both slots — TG ${tg1} was kept on TS1 only`;
        const dupMsg = window.t
          ? window.t(dupKey, { tg: tg1 }, defDup)
          : defDup;
        showToast(dupMsg, 2800);
      }
    }

    // Merge smart defaults (TIMER=10, VOICE=0, SINGLE=0, DIAL=0) with user-provided options in #editHsRptoOptions
    const editHsRptoOptions = document.getElementById("editHsRptoOptions");
    const existingRpto = editHsRptoOptions ? (editHsRptoOptions.value || "") : "";
    const userOpts = {};
    if (existingRpto) {
      existingRpto.split(";").forEach(chunk => {
        chunk = chunk.trim();
        if (chunk && chunk.includes("=")) {
          const [k, v] = chunk.split("=", 2);
          const kUp = k.trim().toUpperCase();
          if (kUp !== "TS1" && kUp !== "TS2") {
            userOpts[kUp] = v.trim();
          }
        }
      });
    }

    const defaultOpts = {
      "DIAL": "0",
      "TIMER": "10",
      "VOICE": "0",
      "SINGLE": "0"
    };

    const finalOpts = { ...defaultOpts, ...userOpts };
    for (const [k, v] of Object.entries(finalOpts)) {
      if (v !== "") parts.push(`${k}=${v}`);
    }

    return parts.join(";") + ";";
  }

  return "";
}

export function applyEditHsNetworkTypeUI(netType, options = {}) {
    const cleanType = (netType || "bm").toLowerCase();
    const profile = getDmrNetworkProfile(cleanType);
    const editHsId = document.getElementById("editHsId");
    const isNewHotspot = options.isNewHotspot !== undefined
      ? Boolean(options.isNewHotspot)
      : (!editHsId || !editHsId.value || editHsId.value === "__new__");

    const xlxEl = document.getElementById("editHsXlxModule");
    const curMod = ((xlxEl && xlxEl.value) ? xlxEl.value : "D").toUpperCase().slice(0, 1) || "D";
    const modTg = 4000 + Math.max(1, Math.min(26, curMod.charCodeAt(0) - 64));

    const hasBmApi = Boolean(profile.hasBmApi || profile.supportsBmApi || cleanType === "bm");
    const hasRpto = Boolean(profile.hasRpto || profile.supportsRpto || cleanType === "freedmr" || cleanType === "adn" || cleanType === "dmrplus" || cleanType === "custom");
    const hasXlxModule = Boolean(profile.hasXlxModule || profile.supportsXlxModule || cleanType === "xlx");
    const fullName = profile.fullName || profile.name || "BrandMeister DMR";
    const shortLabel = profile.shortLabel || profile.shortName || "BM";

    // 1. Inverted Brand Header is ALWAYS visible for both new and existing hotspots
    const netTypeGroup = document.getElementById("editHsNetworkTypeGroup");
    const existingNetHeader = document.getElementById("editHsExistingNetHeader");
    if (netTypeGroup) {
      netTypeGroup.style.display = "none";
    }
    const _isLightThemeNow = document.documentElement.getAttribute("data-theme") === "light" || document.body.getAttribute("data-theme") === "light";
    const _brandEnabledNow = isNetworkColorEnabled();
    const _brandHexNow = getNetworkBrandColor(cleanType, _isLightThemeNow ? "light" : "dark");
    if (existingNetHeader) {
      existingNetHeader.style.display = "flex";
      // Clear previous header theme classes and apply current mode brand color class
      [
        "hs-net-header-bm", "hs-net-header-tgif", "hs-net-header-freedmr",
        "hs-net-header-adn", "hs-net-header-dmrplus", "hs-net-header-xlx",
        "hs-net-header-ysf", "hs-net-header-m17", "hs-net-header-dstar", "hs-net-header-svx", "hs-net-header-allstar", "hs-net-header-custom",
        "hs-header-dark-text"
      ].forEach(cls => existingNetHeader.classList.remove(cls));
      existingNetHeader.classList.add(`hs-net-header-${cleanType}`);
      if (_brandEnabledNow) {
        const useDarkText = _isLightBrandHex(_brandHexNow);
        existingNetHeader.style.setProperty("background", _brandHexNow, "important");
        existingNetHeader.style.setProperty("background-color", _brandHexNow, "important");
        existingNetHeader.style.setProperty("color", useDarkText ? "#0b1220" : "#ffffff", "important");
        existingNetHeader.classList.toggle("hs-header-dark-text", useDarkText);
      } else {
        existingNetHeader.style.setProperty("background", "#475569", "important");
        existingNetHeader.style.setProperty("background-color", "#475569", "important");
        existingNetHeader.style.setProperty("color", "#ffffff", "important");
      }
    }

    const existingPillEl = document.getElementById("editHsExistingNetPill");
    if (existingPillEl) {
      renderNetworkBadgeElement(existingPillEl, cleanType, { xlxModule: curMod });
    }
    const existingTitleEl = document.getElementById("editHsExistingNetTitle");
    if (existingTitleEl) {
      existingTitleEl.textContent = fullName;
    }
    const existingDescEl = document.getElementById("editHsExistingNetDesc");
    if (existingDescEl) {
      if (cleanType === "bm") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_bm", {}, "🔒 Сеть HS • MMDVM + API v2") : "🔒 Сеть HS • MMDVM + API v2";
      } else if (cleanType === "tgif") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_tgif", {}, "🔒 Сеть HS • MMDVM + TGIF API v1") : "🔒 Сеть HS • MMDVM + TGIF API v1";
      } else if (cleanType === "freedmr") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_freedmr", {}, "🔒 Сеть HS • HomeBrew + RPTO") : "🔒 Сеть HS • HomeBrew + RPTO";
      } else if (cleanType === "adn") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_adn", {}, "🔒 Сеть HS • HomeBrew + RPTO (ADN Systems)") : "🔒 Сеть HS • HomeBrew + RPTO (ADN Systems)";
      } else if (cleanType === "dmrplus") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_dmrplus", {}, "🔒 Сеть HS • IPSC2 + StartRef (RPTO)") : "🔒 Сеть HS • IPSC2 + StartRef (RPTO)";
      } else if (cleanType === "xlx") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_xlx", { mod: curMod, tg: modTg }, `🔒 Сеть HS • Модуль ${curMod} (TG ${modTg} на TS2)`) : `🔒 Сеть HS • Модуль ${curMod} (TG ${modTg} на TS2)`;
      } else if (cleanType === "allstar") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_allstar", {}, "🔒 Сеть HS • AllStarLink (IAX2)") : "🔒 Сеть HS • AllStarLink (IAX2)";
      } else if (cleanType === "ysf") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_ysf", {}, "🔒 Сеть HS • Yaesu System Fusion (C4FM)") : "🔒 Сеть HS • Yaesu System Fusion (C4FM)";
      } else if (cleanType === "m17") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_m17", {}, "🔒 Сеть HS • M17 Protocol (Codec2)") : "🔒 Сеть HS • M17 Protocol (Codec2)";
      } else if (cleanType === "dstar") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_dstar", {}, "🔒 Сеть HS • D-STAR (AMBE-2020)") : "🔒 Сеть HS • D-STAR (AMBE-2020)";
      } else if (cleanType === "svx") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_svx", {}, "🔒 Сеть HS • SVXReflector (Opus)") : "🔒 Сеть HS • SVXReflector (Opus)";
      } else {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_custom", {}, "🔒 Сеть HS • Custom MMDVM") : "🔒 Сеть HS • Custom MMDVM";
      }
    }
    const untestedProtoEl = document.getElementById("editHsUntestedProtoNotice");
    if (untestedProtoEl) {
      const isUntested = (cleanType === "dstar" || cleanType === "svx");
      untestedProtoEl.style.display = isUntested ? "block" : "none";
      if (isUntested) {
        untestedProtoEl.textContent = window.t
          ? window.t("hs_edit.untested_proto_notice", {}, "Данные протоколы пока не были проверены реальным подключением")
          : "Данные протоколы пока не были проверены реальным подключением";
      }
    }

    // 2. Apply dynamic network color palette to the form container (#hotspotEditForm)
    const formEl = document.getElementById("hotspotEditForm");
    if (formEl) {
      formEl.classList.add("hs-edit-dynamic-panel");
      ["bm", "tgif", "freedmr", "adn", "dmrplus", "xlx", "ysf", "m17", "dstar", "svx", "allstar", "custom"].forEach(t => {
        formEl.classList.remove(`hs-net-theme-${t}`);
      });
      formEl.classList.add(`hs-net-theme-${cleanType}`);
      if (_brandEnabledNow) {
        const [br, bg, bb] = _hexToRgbTuple(_brandHexNow);
        formEl.style.borderColor = `rgba(${br}, ${bg}, ${bb}, 0.58)`;
        formEl.style.boxShadow = `inset 0 1px 0 rgba(${br}, ${bg}, ${bb}, 0.22), 0 4px 18px rgba(${br}, ${bg}, ${bb}, 0.14)`;
      } else {
        formEl.style.borderColor = "";
        formEl.style.boxShadow = "";
      }
    }

    // 3. Toggle network-specific field blocks
    const pwdGroup = document.getElementById("editHsPasswordGroup");
    const apiKeyGroup = document.getElementById("editHsApiKeyGroup");
    const autoTgBmGroup = document.getElementById("editHsAutoTgBmGroup");
    const dmrPlusGroup = document.getElementById("editHsDmrPlusGroup");
    const rptoGroup = document.getElementById("editHsRptoGroup");
    const rptoLabel = document.getElementById("editHsRptoLabel");
    const rptoInput = document.getElementById("editHsRptoOptions");
    const rptoHint = document.getElementById("editHsRptoHint");
    const btnBuildRptoFromTg = document.getElementById("btnBuildRptoFromTg");
    const btnSendRptoNow = document.getElementById("btnSendRptoNow");
    const xlxGroup = document.getElementById("editHsXlxGroup");
    const allstarGroup = document.getElementById("editHsAllStarGroup");
    const m17Group = document.getElementById("editHsM17Group");
    const dstarGroup = document.getElementById("editHsDstarGroup");
    const svxGroup = document.getElementById("editHsSvxGroup");
    const pwdLabel = document.getElementById("editHsPasswordLabel");
    const masterLabel = document.getElementById("editHsMasterSelectLabel");
    const editHsHost = document.getElementById("editHsHost");
    const editHsPort = document.getElementById("editHsPort");
    const editHsPassword = document.getElementById("editHsPassword");
    if (pwdGroup) pwdGroup.style.display = (cleanType === "ysf" || cleanType === "m17" || cleanType === "dstar") ? "none" : "";
    if (apiKeyGroup) apiKeyGroup.style.display = hasBmApi ? "" : "none";
    // Checkbox auto-TG is ONLY visible for BrandMeister (BM), hidden for all other networks!
    if (autoTgBmGroup) autoTgBmGroup.style.display = (cleanType === "bm") ? "inline-flex" : "none";

    if (dmrPlusGroup) dmrPlusGroup.style.display = (cleanType === "dmrplus") ? "flex" : "none";
    if (rptoGroup) rptoGroup.style.display = hasRpto ? "" : "none";
    if (btnBuildRptoFromTg) btnBuildRptoFromTg.style.display = hasRpto ? "inline-flex" : "none";
    if (btnSendRptoNow) btnSendRptoNow.style.display = (!isNewHotspot && hasRpto) ? "inline-flex" : "none";
    if (xlxGroup) xlxGroup.style.display = hasXlxModule ? "" : "none";
    if (allstarGroup) allstarGroup.style.display = (cleanType === "allstar") ? "block" : "none";
    if (m17Group) m17Group.style.display = (cleanType === "m17") ? "block" : "none";
    if (dstarGroup) dstarGroup.style.display = (cleanType === "dstar") ? "block" : "none";
    if (svxGroup) svxGroup.style.display = (cleanType === "svx") ? "block" : "none";

    // Callsign-only networks (AllStarLink, Yaesu System Fusion) hide DMR-specific fields (DMR ID, SSID, Talker Alias)
    const talkerAliasGroup = document.getElementById("editHsTalkerAliasGroup");
    const talkerAliasText = document.getElementById("editHsTalkerAliasText");
    const editHsTalkerAlias = document.getElementById("editHsTalkerAlias");
    const locationRow = document.getElementById("editHsLocationRow");
    const callsignGroup = document.getElementById("editHsCallsignGroup");
    const dmrIdGroup = document.getElementById("editHsDmrIdGroup");
    const ssidGroup = document.getElementById("editHsSsidGroup");
    const masterSelectGroup = document.getElementById("editHsMasterSelectGroup");
    const hostPortRow = document.getElementById("editHsHostPortRow");
    const editHsDmrId = document.getElementById("editHsDmrId");

    const isCallsignOnly = cleanType === "allstar" || cleanType === "ysf" || cleanType === "m17" || cleanType === "dstar" || cleanType === "svx";
    if (cleanType === "m17") {
      if (talkerAliasGroup) {
        talkerAliasGroup.style.display = "";
        if (talkerAliasText) talkerAliasText.textContent = window.t ? window.t("hs_edit.m17_meta_label", {}, "LICH META текст (M17)") : "LICH META текст (M17)";
        if (editHsTalkerAlias) {
          editHsTalkerAlias.placeholder = window.t ? window.t("hs_edit.m17_meta_placeholder", {}, "До 14 символов...") : "До 14 символов...";
          editHsTalkerAlias.maxLength = 14;
        }
      }
      if (locationRow) locationRow.style.display = "none";
      if (dmrIdGroup) dmrIdGroup.style.display = "none";
      if (ssidGroup) ssidGroup.style.display = "none";
      if (callsignGroup) callsignGroup.style.flex = "1";
      if (editHsDmrId) editHsDmrId.removeAttribute("required");
    } else if (cleanType === "dstar") {
      if (talkerAliasGroup) {
        talkerAliasGroup.style.display = "";
        if (talkerAliasText) talkerAliasText.textContent = window.t ? window.t("hs_edit.dstar_text_label", {}, "Текст Slow Data (D-STAR)") : "Текст Slow Data (D-STAR)";
        if (editHsTalkerAlias) {
          editHsTalkerAlias.placeholder = window.t ? window.t("hs_edit.dstar_text_placeholder", {}, "До 20 символов...") : "До 20 символов...";
          editHsTalkerAlias.maxLength = 20;
        }
      }
      if (locationRow) locationRow.style.display = "none";
      if (dmrIdGroup) dmrIdGroup.style.display = "none";
      if (ssidGroup) ssidGroup.style.display = "none";
      if (callsignGroup) callsignGroup.style.flex = "1";
      if (editHsDmrId) editHsDmrId.removeAttribute("required");
    } else if (cleanType === "svx") {
      if (talkerAliasGroup) talkerAliasGroup.style.display = "none";
      if (locationRow) locationRow.style.display = "none";
      if (dmrIdGroup) dmrIdGroup.style.display = "none";
      if (ssidGroup) ssidGroup.style.display = "none";
      if (callsignGroup) callsignGroup.style.flex = "1";
      if (editHsDmrId) editHsDmrId.removeAttribute("required");
    } else if (cleanType === "ysf") {
      // YSF uses Callsign, Description (up to 20 chars) and QTH Locator
      if (talkerAliasGroup) {
        talkerAliasGroup.style.display = "";
        if (talkerAliasText) talkerAliasText.textContent = window.t ? window.t("hs_edit.ysf_desc_label", {}, "Описание / Статус (YSF)") : "Описание / Статус (YSF)";
        if (editHsTalkerAlias) {
          editHsTalkerAlias.placeholder = window.t ? window.t("hs_edit.ysf_desc_placeholder", {}, "Имя / Описание (до 20 символов)") : "Имя / Описание (до 20 символов)";
          editHsTalkerAlias.maxLength = 20;
        }
      }
      if (locationRow) locationRow.style.display = "flex";
      if (dmrIdGroup) dmrIdGroup.style.display = "none";
      if (ssidGroup) ssidGroup.style.display = "none";
      if (callsignGroup) callsignGroup.style.flex = "1";
      if (editHsDmrId) editHsDmrId.removeAttribute("required");
    } else if (cleanType === "allstar") {
      if (talkerAliasGroup) talkerAliasGroup.style.display = "none";
      if (locationRow) locationRow.style.display = "none";
      if (dmrIdGroup) dmrIdGroup.style.display = "none";
      if (ssidGroup) ssidGroup.style.display = "none";
      if (callsignGroup) callsignGroup.style.flex = "1";
      if (editHsDmrId) editHsDmrId.removeAttribute("required");
    } else {
      if (talkerAliasGroup) {
        talkerAliasGroup.style.display = "";
        if (talkerAliasText) talkerAliasText.textContent = window.t ? window.t("hs_edit.talker_alias", {}, "Передавать Talker Alias") : "Передавать Talker Alias";
        if (editHsTalkerAlias) {
          editHsTalkerAlias.placeholder = window.t ? window.t("hs_edit.talker_alias_placeholder", {}, "например: CALLSIGN Name") : "например: CALLSIGN Name";
          editHsTalkerAlias.maxLength = 27;
        }
      }
      if (locationRow) locationRow.style.display = "none";
      if (dmrIdGroup) dmrIdGroup.style.display = "";
      if (ssidGroup) ssidGroup.style.display = "";
      if (callsignGroup) callsignGroup.style.flex = "2";
      if (editHsDmrId) editHsDmrId.setAttribute("required", "required");
    }

    if (cleanType === "allstar") {
      if (masterSelectGroup) {
        masterSelectGroup.style.display = "none";
        masterSelectGroup.classList.add("hs-field-hidden");
      }
      if (hostPortRow) {
        hostPortRow.style.display = "none";
        hostPortRow.classList.add("hs-field-hidden");
      }
      if (editHsHost) editHsHost.removeAttribute("required");
    } else {
      if (masterSelectGroup) {
        masterSelectGroup.style.display = "";
        masterSelectGroup.classList.remove("hs-field-hidden");
      }
      if (hostPortRow) {
        hostPortRow.style.display = "";
        hostPortRow.classList.remove("hs-field-hidden");
      }
      if (editHsHost) editHsHost.setAttribute("required", "required");
    }

    // Dynamic API key & instructions texts per network
    const apiKeyLabel = document.getElementById("editHsApiKeyLabel");
    const apiKeyInput = document.getElementById("editHsApiKey");
    const apiKeyHint = document.getElementById("editHsApiKeyHint");
    const btnApiHelp = document.getElementById("btnBmApiHelp");
    const btnApiHelpText = document.getElementById("btnBmApiHelpText");
    const apiHelpHeaderTitle = document.getElementById("bmApiHelpHeaderTitle");
    const apiHelpBm = document.getElementById("bmApiHelpContentBm");
    const apiHelpTgif = document.getElementById("bmApiHelpContentTgif");
    const autoTgText = document.getElementById("editHsAutoTgBmText");

    if (cleanType === "tgif") {
      if (apiKeyLabel) apiKeyLabel.textContent = window.t ? window.t("hs_edit.tgif_api_key", {}, "TGIF API Key (Static TG API v1)") : "TGIF API Key (Static TG API v1)";
      if (apiKeyInput) apiKeyInput.placeholder = window.t ? window.t("hs_edit.tgif_api_key_placeholder", {}, "Вставьте Static TG API Token из профиля tgif.network...") : "Вставьте Static TG API Token из профиля tgif.network...";
      if (apiKeyHint) apiKeyHint.textContent = window.t ? window.t("hs_edit.tgif_api_key_hint", {}, "Необходим для удаленного управления статическими TalkGroups на стороне TGIF Network") : "Необходим для удаленного управления статическими TalkGroups на стороне TGIF Network";
      if (btnApiHelpText) btnApiHelpText.textContent = window.t ? window.t("hs_edit.btn_help_tgif", {}, "❓ Инструкция TGIF") : "❓ Инструкция TGIF";
      if (btnApiHelp) btnApiHelp.title = window.t ? window.t("hs_edit.btn_help_tgif_title", {}, "Инструкция: как получить Static TG API Token в личном кабинете TGIF") : "Инструкция: как получить Static TG API Token в личном кабинете TGIF";
      if (apiHelpHeaderTitle) apiHelpHeaderTitle.textContent = window.t ? window.t("hs_edit.tgif_help_header", {}, "🔑 Как получить Static TG API Token в TGIF:") : "🔑 Как получить Static TG API Token в TGIF:";
      if (apiHelpBm) apiHelpBm.classList.add("hidden");
      if (apiHelpTgif) apiHelpTgif.classList.remove("hidden");
      if (autoTgText) autoTgText.textContent = window.t ? window.t("hs_edit.auto_tg_tgif", {}, "Автонастройка TG TGIF") : "Автонастройка TG TGIF";
    } else if (cleanType === "freedmr") {
      if (autoTgText) autoTgText.textContent = window.t ? window.t("hs_edit.auto_tg_freedmr", {}, "Автонастройка TG FreeDMR") : "Автонастройка TG FreeDMR";
      if (apiHelpBm) apiHelpBm.classList.add("hidden");
      if (apiHelpTgif) apiHelpTgif.classList.add("hidden");
    } else if (cleanType === "adn") {
      if (autoTgText) autoTgText.textContent = window.t ? window.t("hs_edit.auto_tg_adn", {}, "Автонастройка TG ADN") : "Автонастройка TG ADN";
      if (apiHelpBm) apiHelpBm.classList.add("hidden");
      if (apiHelpTgif) apiHelpTgif.classList.add("hidden");
    } else if (cleanType === "xlx") {
      if (autoTgText) autoTgText.textContent = window.t ? window.t("hs_edit.auto_tg_xlx", {}, "Автоподключение XLX") : "Автоподключение XLX";
      if (apiHelpBm) apiHelpBm.classList.add("hidden");
      if (apiHelpTgif) apiHelpTgif.classList.add("hidden");
    } else {
      if (apiKeyLabel) apiKeyLabel.textContent = window.t ? window.t("hs_edit.api_key", {}, "BM API Key (v2)") : "BM API Key (v2)";
      if (apiKeyInput) apiKeyInput.placeholder = window.t ? window.t("hs_edit.api_key_placeholder", {}, "Вставьте JWT-токен из профиля BM...") : "Вставьте JWT-токен из профиля BM...";
      if (apiKeyHint) apiKeyHint.textContent = window.t ? window.t("hs_edit.api_key_hint", {}, "Необходим для удаленного управления TalkGroups и сброса динамических групп на стороне BM") : "Необходим для удаленного управления TalkGroups и сброса динамических групп на стороне BM";
      if (btnApiHelpText) btnApiHelpText.textContent = window.t ? window.t("hs_edit.btn_help", {}, "❓ Инструкция BM") : "❓ Инструкция BM";
      if (btnApiHelp) btnApiHelp.title = window.t ? window.t("hs_edit.btn_help_title", {}, "Инструкция: как получить API-ключ в личном кабинете BM") : "Инструкция: как получить API-ключ в личном кабинете BM";
      if (apiHelpHeaderTitle) apiHelpHeaderTitle.textContent = window.t ? window.t("hs_edit.help_header", {}, "🔑 Как получить API v2 Key в BM:") : "🔑 Как получить API v2 Key в BM:";
      if (apiHelpBm) apiHelpBm.classList.remove("hidden");
      if (apiHelpTgif) apiHelpTgif.classList.add("hidden");
      if (autoTgText) autoTgText.textContent = window.t ? window.t("hs_edit.auto_tg_bm", {}, "Автонастройка TG BM") : "Автонастройка TG BM";
    }

    // Customize RPTO texts for FreeDMR vs ADN vs DMR+ vs Custom
    const freedmrHelpBox = document.getElementById("freedmrHelpBox");
    const adnHelpBox = document.getElementById("adnHelpBox");
    const freedmrHelpToggle = document.getElementById("btnFreedmrHelpToggle");
    const adnHelpToggle = document.getElementById("btnAdnHelpToggle");

    if (cleanType === "freedmr") {
      if (rptoLabel) rptoLabel.textContent = window.t ? window.t("hs_edit.rpto_freedmr_label", {}, "Опции FreeDMR (RPTO) — статические TG (TS1 / TS2)") : "Опции FreeDMR (RPTO) — статические TG (TS1 / TS2)";
      if (rptoInput) rptoInput.placeholder = "TS1=2501;TS2=250,2505;DIAL=0;";
      if (rptoHint) rptoHint.textContent = window.t ? window.t("hs_edit.rpto_freedmr_hint", {}, "Передаётся в пакете RPTO сразу после авторизации (нажмите «🔄 Из TS1/TS2» для автосборки из стартовых групп ниже)") : "Передаётся в пакете RPTO сразу после авторизации (нажмите «🔄 Из TS1/TS2» для автосборки из стартовых групп ниже)";
      if (freedmrHelpToggle) freedmrHelpToggle.style.display = "";
      if (adnHelpToggle) adnHelpToggle.style.display = "none";
      if (adnHelpBox) adnHelpBox.style.display = "none";
    } else if (cleanType === "adn") {
      if (rptoLabel) rptoLabel.textContent = window.t ? window.t("hs_edit.rpto_adn_label", {}, "Опции ADN Systems (RPTO) — статические TG (TS1 / TS2)") : "Опции ADN Systems (RPTO) — статические TG (TS1 / TS2)";
      if (rptoInput) rptoInput.placeholder = "TS1=91;TS2=250;DIAL=0;TIMER=10;VOICE=0;SINGLE=0;";
      if (rptoHint) rptoHint.textContent = window.t ? window.t("hs_edit.rpto_adn_hint", {}, "Передаётся в пакете RPTO сразу после авторизации (нажмите «🔄 Из TS1/TS2» для автосборки из стартовых групп ниже)") : "Передаётся в пакете RPTO сразу после авторизации (нажмите «🔄 Из TS1/TS2» для автосборки из стартовых групп ниже)";
      if (freedmrHelpToggle) freedmrHelpToggle.style.display = "none";
      if (adnHelpToggle) adnHelpToggle.style.display = "";
      if (freedmrHelpBox) freedmrHelpBox.style.display = "none";
    } else if (cleanType === "dmrplus") {
      if (rptoLabel) rptoLabel.textContent = window.t ? window.t("hs_edit.rpto_dmrplus_label", {}, "Строка конфигурации DMR+ / IPSC2 (RPTO)") : "Строка конфигурации DMR+ / IPSC2 (RPTO)";
      if (rptoInput) rptoInput.placeholder = "StartRef=4530;RelinkTime=60;TS1_1=2501;TS2_1=250;";
      if (rptoHint) rptoHint.textContent = window.t ? window.t("hs_edit.rpto_dmrplus_hint", {}, "Формируется автоматически из полей StartRef / RelinkTime / TG или редактируется вручную") : "Формируется автоматически из полей StartRef / RelinkTime / TG или редактируется вручную";
      if (freedmrHelpToggle) freedmrHelpToggle.style.display = "none";
      if (adnHelpToggle) adnHelpToggle.style.display = "none";
      if (freedmrHelpBox) freedmrHelpBox.style.display = "none";
      if (adnHelpBox) adnHelpBox.style.display = "none";
    } else if (cleanType === "custom") {
      if (rptoLabel) rptoLabel.textContent = window.t ? window.t("hs_edit.rpto_custom_label", {}, "Опции HomeBrew (RPTO) — статические TG и параметры") : "Опции HomeBrew (RPTO) — статические TG и параметры";
      if (rptoInput) rptoInput.placeholder = "TS1=2501;TS2=2505;";
      if (rptoHint) rptoHint.textContent = window.t ? window.t("hs_edit.rpto_custom_hint", {}, "Строка опций RPTO, отправляемая серверу HBlink3 / MMDVM после пакета RPTC") : "Строка опций RPTO, отправляемая серверу HBlink3 / MMDVM после пакета RPTC";
      if (freedmrHelpToggle) freedmrHelpToggle.style.display = "none";
      if (adnHelpToggle) adnHelpToggle.style.display = "none";
      if (freedmrHelpBox) freedmrHelpBox.style.display = "none";
      if (adnHelpBox) adnHelpBox.style.display = "none";
    }

    // Customize password label & placeholder
    if (pwdLabel) {
      if (cleanType === "bm") {
        pwdLabel.textContent = window.t ? window.t("hs_edit.bm_password", {}, "Пароль хотспота (BM SelfCare)") : "Пароль хотспота (BM SelfCare)";
        if (editHsPassword) editHsPassword.placeholder = window.t ? window.t("hs_edit.password_placeholder", {}, "Персональный пароль безопасности из BM SelfCare") : "Персональный пароль безопасности из BM SelfCare";
      } else if (cleanType === "tgif") {
        pwdLabel.textContent = window.t ? window.t("hs_edit.tgif_password", {}, "Ключ безопасности TGIF (Hotspot Security Key / passw0rd)") : "Ключ безопасности TGIF (Hotspot Security Key / passw0rd)";
        if (editHsPassword) editHsPassword.placeholder = "passw0rd / Hotspot Security Key";
      } else if (cleanType === "freedmr") {
        pwdLabel.textContent = window.t ? window.t("hs_edit.freedmr_password", {}, "Пароль хотспота FreeDMR (из портала / passw0rd)") : "Пароль хотспота FreeDMR (из портала / passw0rd)";
        if (editHsPassword) editHsPassword.placeholder = "passw0rd / FreeDMR Password";
      } else if (cleanType === "adn") {
        pwdLabel.textContent = window.t ? window.t("hs_edit.adn_password", {}, "Пароль хотспота ADN Systems (passw0rd / SelfCare)") : "Пароль хотспота ADN Systems (passw0rd / SelfCare)";
        if (editHsPassword) editHsPassword.placeholder = "passw0rd / SelfCare Password";
      } else if (cleanType === "dmrplus") {
        pwdLabel.textContent = window.t ? window.t("hs_edit.dmrplus_password", {}, "Пароль сервера DMR+ / IPSC2 (стандартный: PASSWORD)") : "Пароль сервера DMR+ / IPSC2 (стандартный: PASSWORD)";
        if (editHsPassword) editHsPassword.placeholder = "PASSWORD";
      } else if (cleanType === "xlx") {
        pwdLabel.textContent = window.t ? window.t("hs_edit.xlx_password", {}, "Пароль рефлектора XLX (стандартный: passw0rd)") : "Пароль рефлектора XLX (стандартный: passw0rd)";
        if (editHsPassword) editHsPassword.placeholder = "passw0rd";
      } else if (cleanType === "allstar") {
        pwdLabel.textContent = window.t ? window.t("hs_edit.allstar_password", {}, "Пароль узла AllStarLink (IAX2 Secret / passw0rd)") : "Пароль узла AllStarLink (IAX2 Secret / passw0rd)";
        if (editHsPassword) editHsPassword.placeholder = "passw0rd / IAX2 Secret";
      } else if (cleanType === "svx") {
        pwdLabel.textContent = window.t ? window.t("hs_edit.svx_password", {}, "Ключ аутентификации (auth_key / пароль SVX)") : "Ключ аутентификации (auth_key / пароль SVX)";
        if (editHsPassword) editHsPassword.placeholder = "auth_key / password";
      } else {
        pwdLabel.textContent = window.t ? window.t("hs_edit.net_password", { network: shortLabel }, `Пароль сервера (${shortLabel})`) : `Пароль сервера (${shortLabel})`;
        if (editHsPassword) editHsPassword.placeholder = "passw0rd";
      }
    }

    // Customize server selector label & host placeholder
    if (masterLabel) {
      if (cleanType === "bm") {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_label", {}, "Сервер BM (Master) — выбор по странам") : "Сервер BM (Master) — выбор по странам";
      } else if (cleanType === "tgif") {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_tgif", {}, "Сервер TGIF Network (Основной / Европа)") : "Сервер TGIF Network (Основной / Европа)";
      } else if (cleanType === "freedmr") {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_freedmr", {}, "Сервер FreeDMR — выбор по странам") : "Сервер FreeDMR — выбор по странам";
      } else if (cleanType === "adn") {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_adn", {}, "Сервер ADN Systems — выбор по странам") : "Сервер ADN Systems — выбор по странам";
      } else if (cleanType === "dmrplus") {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_dmrplus", {}, "Мастер-сервер DMR+ / IPSC2 — выбор по странам") : "Мастер-сервер DMR+ / IPSC2 — выбор по странам";
      } else if (cleanType === "xlx") {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_xlx", {}, "Рефлектор XLX — выбор сервера (порт 62030)") : "Рефлектор XLX — выбор сервера (порт 62030)";
      } else if (cleanType === "ysf") {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_ysf", {}, "Рефлектор YSF — выбор комнаты (порт 42000)") : "Рефлектор YSF — выбор комнаты (порт 42000)";
      } else if (cleanType === "dstar") {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_dstar", {}, "Рефлектор D-STAR — выбор (DExtra / DCS / DPlus)") : "Рефлектор D-STAR — выбор (DExtra / DCS / DPlus)";
      } else if (cleanType === "svx") {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_svx", {}, "Сервер SVXReflector — выбор (порт 5300)") : "Сервер SVXReflector — выбор (порт 5300)";
      } else {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_custom", {}, "Выбор сервера (пресет или свой IP/домен)") : "Выбор сервера (пресет или свой IP/домен)";
      }
    }
    if (editHsHost) {
      editHsHost.placeholder = cleanType === "allstar"
        ? (window.t ? window.t("hs_edit.allstar_host_placeholder", {}, "127.0.0.1 (или домен/IP ноды ASL)") : "127.0.0.1 (или домен/IP ноды ASL)")
        : (cleanType === "ysf"
          ? (window.t ? window.t("hs_edit.ysf_host_placeholder", {}, "161.97.73.43 (или домен/IP рефлектора YSF)") : "161.97.73.43 (или домен/IP рефлектора YSF)")
          : (profile.defaultHost || "127.0.0.1"));
    }

    // 4. Apply network defaults when switching network type on a new hotspot
    if (options.applyDefaults) {
      if (isNewHotspot) {
        const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
        const usedSsids = new Set(
          currentHotspots
            .filter(h => ((h.network_type || "bm").toLowerCase() === cleanType))
            .map(h => Number(h.bm_ssid))
        );
        let nextSsid = 1;
        while (usedSsids.has(nextSsid) && nextSsid < 99) {
          nextSsid++;
        }
        const editHsSsid = document.getElementById("editHsSsid");
        if (editHsSsid) editHsSsid.value = nextSsid;
      }

      let chosenDefaultHost = profile.defaultHost || "";
      let chosenDefaultPort = profile.defaultPort || 62031;
      let chosenDefaultPwd = profile.defaultPassword || "";
      const cachedServers = window._dmrServersCache && window._dmrServersCache[cleanType];
      if (Array.isArray(cachedServers)) {
        const fastest = cachedServers.find(s => s && s.state === "online" && s.host);
        if (fastest) {
          chosenDefaultHost = fastest.host;
          if (fastest.port) chosenDefaultPort = fastest.port;
          if (fastest.password) chosenDefaultPwd = fastest.password;
        }
      }
      if (editHsHost) editHsHost.value = chosenDefaultHost;
      if (editHsPort) editHsPort.value = chosenDefaultPort || profile.defaultPort || 62031;
      if (editHsPassword) {
        const curPwd = editHsPassword.value.trim();
        if (cleanType === "bm") {
          if (curPwd === "passw0rd" || curPwd === "PASSWORD") editHsPassword.value = "";
        } else if (cleanType === "dmrplus") {
          if (!curPwd || curPwd === "passw0rd") editHsPassword.value = "PASSWORD";
        } else if (cleanType === "xlx") {
          editHsPassword.value = "passw0rd";
        } else if (!curPwd || curPwd === "PASSWORD") {
          editHsPassword.value = profile.defaultPassword || "passw0rd";
        }
      }
      if (cleanType === "xlx") {
        if (rptoInput) rptoInput.value = "";
      } else if (cleanType === "tgif") {
        if (rptoInput) rptoInput.value = "";
      } else if (cleanType === "freedmr") {
        if (rptoInput) rptoInput.value = buildRptoFromCurrentFormFields("freedmr");
      } else if (cleanType === "adn") {
        if (rptoInput) rptoInput.value = buildRptoFromCurrentFormFields("adn");
      } else if (cleanType === "dmrplus") {
        const refEl = document.getElementById("editHsDmrPlusRef");
        const relinkEl = document.getElementById("editHsDmrPlusRelink");
        if (refEl && !refEl.value) refEl.value = 4530;
        if (relinkEl && !relinkEl.value) relinkEl.value = 60;
        if (rptoInput) rptoInput.value = buildRptoFromCurrentFormFields("dmrplus");
      }
    }

    // Update brand color pickers
    const colorSec = document.getElementById("editHsBrandColorSection");
    const disabledHint = document.getElementById("editHsBrandColorDisabledHint");
    const darkInput = document.getElementById("editHsBrandColorDark");
    const darkHex = document.getElementById("editHsBrandColorDarkHex");
    const lightInput = document.getElementById("editHsBrandColorLight");
    const lightHex = document.getElementById("editHsBrandColorLightHex");
    const colorTitle = document.getElementById("editHsBrandColorTitle");

    const isEnabled = isNetworkColorEnabled();
    if (colorSec) colorSec.classList.toggle("is-disabled", !isEnabled);
    if (disabledHint) disabledHint.style.display = isEnabled ? "none" : "block";

    const curDark = getNetworkBrandColor(cleanType, "dark");
    const curLight = getNetworkBrandColor(cleanType, "light");

    if (darkInput) darkInput.value = curDark;
    if (darkHex) darkHex.value = curDark.toUpperCase();
    if (lightInput) lightInput.value = curLight;
    if (lightHex) lightHex.value = curLight.toUpperCase();
    if (colorTitle) {
      colorTitle.textContent = `${window.t ? window.t("hs_edit.brand_color_title", {}, "Выбор фирменного цвета") : "Выбор фирменного цвета"} (${shortLabel})`;
    }

    renderBmMastersDropdown(editHsHost ? editHsHost.value : "", cleanType);
  }

  // =========================================================================
let _isProgrammaticPopulating = false;

export function populateEditHotspotFormFields(hs) {
  _isProgrammaticPopulating = true;
  try {
  const editHsAliveToggle = document.getElementById("editHsAliveToggle");
  if (editHsAliveToggle && !editHsAliveToggle._wired) {
    editHsAliveToggle._wired = true;
    editHsAliveToggle.addEventListener("change", async () => {
      const isAlive = Boolean(editHsAliveToggle.checked);
      const editHsId = document.getElementById("editHsId");
      const id = editHsId ? editHsId.value : "";
      const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
      const existing = currentHotspots.find(h => h.id === id);

      // Validate 7 active hotspots limit when turning on an existing hotspot
      if (isAlive && id && id !== "__new__") {
        const activeCount = currentHotspots.filter(h => !h.hidden && h.id !== id).length;
        if (activeCount >= 7) {
          editHsAliveToggle.checked = false;
          updateHsFormAliveState(false);
          const max7Msg = window.t ? window.t("hotspots.max_active_7", {}, "Максимум 7 активных хотспотов в рабочем пространстве. Сначала исключите один из активных хотспотов") : "Максимум 7 активных хотспотов в рабочем пространстве. Сначала исключите один из активных хотспотов";
          showToast(max7Msg, "warning", 4000);
          return;
        }
      }

      // Directively update UI state
      updateHsFormAliveState(isAlive);

      // Directive persistence: immediately save state to backend for existing hotspot
      if (id && id !== "__new__" && existing) {
        try {
          editHsAliveToggle.disabled = true;
          const payload = { ...existing, hidden: !isAlive };
          const resp = await fetch(`/api/hotspots/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.detail || resp.statusText);
          }
          existing.hidden = !isAlive;
          const statusMsg = isAlive
            ? (window.t ? window.t("hotspots.hs_enabled", {}, "Хотспот включен") : "Хотспот включен")
            : (window.t ? window.t("hotspots.hs_disabled", {}, "Хотспот отключен") : "Хотспот отключен");
          showToast(statusMsg, "success", 2000);
          if (typeof loadHotspots === "function") {
            await loadHotspots();
          }
        } catch (err) {
          console.error("[HOTSPOTS] Failed to persist alive state:", err);
          editHsAliveToggle.checked = !isAlive;
          updateHsFormAliveState(!isAlive);
          showToast(err.message || (window.t ? window.t("hotspots.err_save_state", {}, "Error saving hotspot state") : "Error saving hotspot state"), "error", 4000);
        } finally {
          editHsAliveToggle.disabled = false;
        }
      }
    });
  }
    if (!hs) return;
    const editHsId = document.getElementById("editHsId");
    const editHsName = document.getElementById("editHsName");
    const editHsCallsign = document.getElementById("editHsCallsign");
    const editHsTalkerAlias = document.getElementById("editHsTalkerAlias");
    const editHsSendTalkerAlias = document.getElementById("editHsSendTalkerAlias");
    const editHsDmrId = document.getElementById("editHsDmrId");
    const editHsSsid = document.getElementById("editHsSsid");
    const editHsNetworkType = document.getElementById("editHsNetworkType");
    const editHsRptoOptions = document.getElementById("editHsRptoOptions");
    const editHsDmrPlusRef = document.getElementById("editHsDmrPlusRef");
    const editHsDmrPlusRelink = document.getElementById("editHsDmrPlusRelink");
    const editHsXlxModule = document.getElementById("editHsXlxModule");
    const editHsPassword = document.getElementById("editHsPassword");
    const btnToggleHsPassword = document.getElementById("btnToggleHsPassword");
    const editHsApiKey = document.getElementById("editHsApiKey");
    const btnToggleHsApiKey = document.getElementById("btnToggleHsApiKey");
    const bmApiHelpCard = document.getElementById("bmApiHelpCard");
    const editHsHost = document.getElementById("editHsHost");
    const editHsPort = document.getElementById("editHsPort");
    const editHsAutoconnect = document.getElementById("editHsAutoconnect");
    const editHsAutoTgBm = document.getElementById("editHsAutoTgBm");

    const isNewHotspot = Boolean(!hs || !hs.id || hs.id === "__new__");
    const editHsSubmitFooter = document.getElementById("editHsSubmitFooter");
    if (editHsSubmitFooter) {
      editHsSubmitFooter.style.display = isNewHotspot ? "" : "none";
    }
    const netType = (hs && hs.network_type ? hs.network_type : "bm").toLowerCase();
    const netProfile = getDmrNetworkProfile(netType);

    resetTestCredentialBtn(document.getElementById("btnTestHsPassword"), "hs_edit.btn_test_pwd_title", "Test server connection with password");
    resetTestCredentialBtn(document.getElementById("btnTestHsApiKey"), "hs_edit.btn_test_api_title", "Validate API key on server");

    if (editHsNetworkType) {
      editHsNetworkType.value = netType;
    }
    if (editHsId) editHsId.value = hs.id || "";
    if (editHsName) editHsName.value = hs.name || "";
    if (editHsCallsign) {
      editHsCallsign.value = window.isDemoMode
        ? (window.t ? window.t("demo.your_callsign", {}, "Your Callsign") : "Your Callsign")
        : (hs.callsign || "");
    }
    if (editHsTalkerAlias) {
      editHsTalkerAlias.value = window.isDemoMode
        ? (window.t ? window.t("demo.your_name", {}, "Your Name") : "Your Name")
        : (hs.talker_alias || "");
      editHsTalkerAlias.style.opacity = (hs.send_talker_alias !== false) ? "1" : "0.5";
    }
    if (editHsSendTalkerAlias) editHsSendTalkerAlias.checked = hs.send_talker_alias !== false;
    const editHsLocator = document.getElementById("editHsLocator");
    if (editHsLocator) {
      editHsLocator.value = (hs.qth_locator || hs.locator || "").toUpperCase();
    }

    const btnGetGpsLocation = document.getElementById("btnGetGpsLocation");
    if (btnGetGpsLocation && !btnGetGpsLocation._wiredGps) {
      btnGetGpsLocation._wiredGps = true;
      btnGetGpsLocation.addEventListener("click", (e) => {
        e.preventDefault();
        requestDeviceGpsLocation((lat, lon) => {
          const grid = latLonToMaidenheadGrid(lat, lon);
          if (editHsLocator) editHsLocator.value = grid;
          if (hs) {
            hs.qth_locator = grid;
            hs.latitude = lat;
            hs.longitude = lon;
          }
          showToast(window.t ? window.t("hotspots.gps_locator_detected_toast", { grid, lat: lat.toFixed(4), lon: lon.toFixed(4) }, `✓ Locator detected via GPS: ${grid} (${lat.toFixed(4)}, ${lon.toFixed(4)})`) : `✓ Locator detected via GPS: ${grid} (${lat.toFixed(4)}, ${lon.toFixed(4)})`, "success", 3500);
        });
      });
    }
    if (editHsDmrId) {
      editHsDmrId.value = window.isDemoMode ? "1234567" : (hs.dmr_id || "");
    }
    if (editHsSsid) editHsSsid.value = (hs.bm_ssid !== undefined && hs.bm_ssid !== null && Number(hs.bm_ssid) >= 1) ? Math.min(99, Math.max(1, Number(hs.bm_ssid))) : 1;
    let rawRpto = hs.rpto_options || "";
    if (!rawRpto && (netType === "freedmr" || netType === "adn")) {
      rawRpto = buildRptoFromCurrentFormFields(netType);
    }
    if (editHsRptoOptions) editHsRptoOptions.value = rawRpto;
    if (editHsDmrPlusRef) {
      const mRef = rawRpto.match(/StartRef\s*=\s*(\d+)/i);
      editHsDmrPlusRef.value = hs.dmrplus_reflector || (mRef ? mRef[1] : "4530");
    }
    if (editHsDmrPlusRelink) {
      const mRel = rawRpto.match(/RelinkTime\s*=\s*(\d+)/i);
      editHsDmrPlusRelink.value = mRel ? mRel[1] : "60";
    }
    if (editHsXlxModule) editHsXlxModule.value = ((hs.xlx_module || "D").trim().toUpperCase().slice(0, 1)) || "D";
    const editHsAllStarNode = document.getElementById("editHsAllStarNode");
    if (editHsAllStarNode) editHsAllStarNode.value = hs.allstar_node || "1999";
    const editHsAllStarAlwaysOnline = document.getElementById("editHsAllStarAlwaysOnline");
    if (editHsAllStarAlwaysOnline) {
      editHsAllStarAlwaysOnline.checked = (hs.allstar_always_online !== undefined) ? Boolean(hs.allstar_always_online) : true;
    }
    const editHsM17Module = document.getElementById("editHsM17Module");
    if (editHsM17Module) editHsM17Module.value = ((hs.m17_module || "C").trim().toUpperCase().slice(0, 1)) || "C";
    const editHsM17Suffix = document.getElementById("editHsM17Suffix");
    if (editHsM17Suffix) editHsM17Suffix.value = (hs.m17_callsign_suffix !== undefined && hs.m17_callsign_suffix !== null) ? String(hs.m17_callsign_suffix).toUpperCase().slice(0, 1) : "D";
    const editHsM17Can = document.getElementById("editHsM17Can");
    if (editHsM17Can) editHsM17Can.value = String(hs.m17_can !== undefined ? hs.m17_can : 0);
    const editHsM17LinkMode = document.getElementById("editHsM17LinkMode");
    if (editHsM17LinkMode) editHsM17LinkMode.value = (hs.m17_link_mode || "conn").toLowerCase();
    const editHsM17CodecMode = document.getElementById("editHsM17CodecMode");
    if (editHsM17CodecMode) editHsM17CodecMode.value = String(hs.m17_codec_mode || "3200");
    const editHsM17DstMode = document.getElementById("editHsM17DstMode");
    if (editHsM17DstMode) editHsM17DstMode.value = (hs.m17_dst_mode || "reflector").toLowerCase();
    if (netType === "m17" && editHsTalkerAlias && hs.m17_meta_text) {
      editHsTalkerAlias.value = hs.m17_meta_text;
    }
    // D-STAR fields
    const editHsDstarProtocol = document.getElementById("editHsDstarProtocol");
    if (editHsDstarProtocol) editHsDstarProtocol.value = hs.dstar_protocol || "auto";
    const editHsDstarModule = document.getElementById("editHsDstarModule");
    if (editHsDstarModule) editHsDstarModule.value = ((hs.dstar_module || "D").trim().toUpperCase().slice(0, 1)) || "D";
    const editHsDstarLocalMod = document.getElementById("editHsDstarLocalMod");
    if (editHsDstarLocalMod) editHsDstarLocalMod.value = ((hs.dstar_local_module || "D").trim().toUpperCase().slice(0, 1)) || "D";
    const editHsDstarUrCall = document.getElementById("editHsDstarUrCall");
    if (editHsDstarUrCall) editHsDstarUrCall.value = hs.dstar_urcall || "CQCQCQ";
    const editHsDstarMy2 = document.getElementById("editHsDstarMy2");
    if (editHsDstarMy2) editHsDstarMy2.value = hs.dstar_my2 || "";
    const editHsDstarText = document.getElementById("editHsDstarText");
    if (editHsDstarText) editHsDstarText.value = hs.dstar_text || "";
    const editHsDstarRxOnly = document.getElementById("editHsDstarRxOnly");
    if (editHsDstarRxOnly) editHsDstarRxOnly.checked = Boolean(hs.dstar_rx_only);
    if (netType === "dstar" && editHsTalkerAlias && hs.dstar_text) {
      editHsTalkerAlias.value = hs.dstar_text;
    }

    // SVX fields
    const editHsSvxDefaultTg = document.getElementById("editHsSvxDefaultTg");
    if (editHsSvxDefaultTg) {
      editHsSvxDefaultTg.value = String(hs.svx_tg !== undefined && hs.svx_tg !== null ? hs.svx_tg : 1);
    }
    const editHsSvxAuthUser = document.getElementById("editHsSvxAuthUser");
    if (editHsSvxAuthUser) editHsSvxAuthUser.value = hs.svx_auth_user || "";
    const editHsSvxMonitorTgs = document.getElementById("editHsSvxMonitorTgs");
    if (editHsSvxMonitorTgs) {
      editHsSvxMonitorTgs.value = Array.isArray(hs.svx_monitor_tgs) ? hs.svx_monitor_tgs.join(", ") : (hs.svx_monitor_tgs || "");
    }
    const editHsSvxRxOnly = document.getElementById("editHsSvxRxOnly");
    if (editHsSvxRxOnly) editHsSvxRxOnly.checked = Boolean(hs.svx_rx_only);
    if (editHsPassword) {
      editHsPassword.value = (netType === "svx" ? (hs.svx_auth_key || hs.bm_password || "") : (hs.bm_password || ((netType === "xlx" || netType === "adn") ? "passw0rd" : "")));
      editHsPassword.type = "password";
    }
    if (btnToggleHsPassword) btnToggleHsPassword.textContent = "👁️";
    if (editHsApiKey) {
      editHsApiKey.value = hs.bm_api_key || "";
      editHsApiKey.type = "password";
    }
    if (btnToggleHsApiKey) btnToggleHsApiKey.textContent = "👁️";
    if (bmApiHelpCard) bmApiHelpCard.classList.add("hidden");
    const hostVal = (
      netType === "svx" ? (hs.svx_host || hs.bm_master_host)
      : netType === "dstar" ? (hs.dstar_host || hs.bm_master_host)
      : netType === "m17" ? (hs.m17_host || hs.bm_master_host)
      : hs.bm_master_host
    ) || netProfile.defaultHost || "2322.master.brandmeister.network";
    if (editHsHost) editHsHost.value = hostVal;
    if (editHsPort) {
      editHsPort.value = (
        netType === "svx" ? (hs.svx_port || hs.bm_master_port)
        : netType === "dstar" ? (hs.dstar_port || hs.bm_master_port)
        : netType === "m17" ? (hs.m17_port || hs.bm_master_port)
        : hs.bm_master_port
      ) || netProfile.defaultPort || 62031;
    }
    if (editHsAutoconnect) {
      editHsAutoconnect.checked = hs.autoconnect !== undefined && hs.autoconnect !== null ? Boolean(hs.autoconnect) : true;
    }
    if (editHsAutoTgBm) {
      editHsAutoTgBm.checked = hs.auto_tg_bm !== undefined && hs.auto_tg_bm !== null ? Boolean(hs.auto_tg_bm) : true;
    }
    const isAlive = !(hs && hs.hidden);
    if (editHsAliveToggle) {
      editHsAliveToggle.checked = isAlive;
    }
    if (typeof updateHsFormAliveState === "function") {
      updateHsFormAliveState(isAlive);
    }

    applyEditHsNetworkTypeUI(netType, { applyDefaults: false, isNewHotspot });
    updateEditHsToolbarUI(hs);
    if (netType === "freedmr") {
      refreshFreeDmrServers().then(() => {
        renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "freedmr");
      });
    } else if (netType === "adn") {
      refreshAdnServers().then(() => {
        renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "adn");
      });
    } else if (netType === "dmrplus") {
      if (typeof refreshDmrPlusServers === "function") {
        refreshDmrPlusServers().then(() => {
          renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "dmrplus");
        });
      }
    } else if (netType === "ysf") {
      refreshYsfServers().then(() => {
        renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "ysf");
      });
    } else if (netType === "m17") {
      refreshM17Servers().then(() => {
        renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "m17");
      });
    } else if (netType === "dstar") {
      refreshDstarServers().then(() => {
        renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "dstar");
      });
    } else if (netType === "svx") {
      refreshSvxServers().then(() => {
        renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "svx");
      });
    }
    if (typeof clearSettingsTabDirty === "function") {
      clearSettingsTabDirty("tab-edit-hs");
    }
  } finally {
    _isProgrammaticPopulating = false;
    if (typeof clearSettingsTabDirty === "function") {
      clearSettingsTabDirty("tab-edit-hs");
    }
  }
}

export function ensureCustomHsDropdownElements() {
  const editHsSelect = document.getElementById("editHsSelect");
  if (!editHsSelect) return null;

  let customDd = document.getElementById("editHsCustomDropdown");
  if (!customDd) {
    customDd = document.createElement("div");
    customDd.id = "editHsCustomDropdown";
    customDd.className = "hs-custom-dropdown";
    customDd.style.flex = "1";
    customDd.style.minWidth = "130px";
    customDd.style.position = "relative";

    editHsSelect.parentNode.insertBefore(customDd, editHsSelect);
    customDd.appendChild(editHsSelect);
    editHsSelect.style.display = "none";

    const trigger = document.createElement("div");
    trigger.id = "editHsCustomTrigger";
    trigger.className = "hs-custom-dropdown-trigger";
    trigger.tabIndex = 0;
    trigger.setAttribute("role", "button");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML = '<span class="hs-custom-dropdown-label" id="editHsCustomLabel">...</span><span class="hs-custom-dropdown-arrow" aria-hidden="true">▾</span>';
    customDd.appendChild(trigger);

    const menu = document.createElement("div");
    menu.id = "editHsCustomMenu";
    menu.className = "hs-custom-dropdown-menu";
    menu.setAttribute("role", "listbox");
    menu.style.display = "none";
    customDd.appendChild(menu);
  } else {
    editHsSelect.style.display = "none";
  }

  wireCustomHsDropdownEvents();
  return customDd;
}

export function wireCustomHsDropdownEvents() {
  const trigger = document.getElementById("editHsCustomTrigger");
  if (trigger && !trigger._hsDropdownWired) {
    trigger._hsDropdownWired = true;
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCustomHsDropdown();
    });
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        toggleCustomHsDropdown();
      } else if (e.key === "Escape") {
        closeCustomHsDropdown();
      }
    });
  }

  const lbl = document.querySelector('label[for="editHsSelect"]');
  if (lbl && !lbl._hsDdLabelWired) {
    lbl._hsDdLabelWired = true;
    lbl.addEventListener("click", (e) => {
      e.preventDefault();
      toggleCustomHsDropdown();
    });
  }

  if (typeof window !== "undefined" && !window._hsCustomDdGlobalWired) {
    window._hsCustomDdGlobalWired = true;
    document.addEventListener("click", (e) => {
      const dd = document.getElementById("editHsCustomDropdown");
      if (dd && !dd.contains(e.target)) {
        closeCustomHsDropdown();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeCustomHsDropdown();
      }
    });
    window.addEventListener("resize", () => closeCustomHsDropdown(), { passive: true });
    const modalBody = document.querySelector("#settingsModal .settings-modal-body");
    if (modalBody) {
      modalBody.addEventListener("scroll", () => closeCustomHsDropdown(), { passive: true });
    }
  }
}

export function toggleCustomHsDropdown() {
  const customDd = document.getElementById("editHsCustomDropdown");
  const customMenu = document.getElementById("editHsCustomMenu");
  const customTrigger = document.getElementById("editHsCustomTrigger");
  if (!customDd || !customMenu) return;

  const isOpen = customDd.classList.contains("is-open");
  if (isOpen) {
    closeCustomHsDropdown();
  } else {
    if (typeof window.closeAllServerComboboxes === "function") {
      window.closeAllServerComboboxes();
    }
    customDd.classList.add("is-open");
    customMenu.style.visibility = "hidden";
    customMenu.style.display = "block";
    customMenu.style.width = "max-content";
    customMenu.style.minWidth = "";
    customMenu.style.maxWidth = "";

    const tRect = (customTrigger || customDd).getBoundingClientRect();
    const modalEl = customDd.closest(".modal-content");
    const mRect = modalEl ? modalEl.getBoundingClientRect() : { left: 8, right: window.innerWidth - 8, width: window.innerWidth - 16 };
    const maxAllowedW = Math.max(160, Math.floor(Math.min(window.innerWidth - 16, mRect.width - 12)));
    const naturalW = Math.ceil(customMenu.scrollWidth) + 8;
    const finalW = Math.min(Math.max(Math.ceil(tRect.width), naturalW), maxAllowedW);

    const minLeft = Math.max(8, Math.floor(mRect.left + 6));
    const maxRight = Math.min(window.innerWidth - 8, Math.floor(mRect.right - 6));
    let leftPos = Math.floor(tRect.left);
    if (leftPos + finalW > maxRight) {
      leftPos = Math.max(minLeft, maxRight - finalW);
    }

    const spaceBelow = window.innerHeight - tRect.bottom - 12;
    const spaceAbove = tRect.top - 12;
    let topPos = Math.floor(tRect.bottom + 3);
    let maxH = Math.max(140, Math.min(spaceBelow, window.innerHeight - 160));
    if (spaceBelow < 160 && spaceAbove > spaceBelow) {
      maxH = Math.max(140, Math.min(spaceAbove - 3, window.innerHeight - 160));
      const measuredH = Math.min(customMenu.scrollHeight, maxH);
      topPos = Math.max(8, Math.floor(tRect.top - measuredH - 3));
    }

    customMenu.style.width = `${finalW}px`;
    customMenu.style.left = `${leftPos}px`;
    customMenu.style.top = `${topPos}px`;
    customMenu.style.maxHeight = `${maxH}px`;
    customMenu.style.visibility = "visible";

    if (customTrigger) customTrigger.setAttribute("aria-expanded", "true");
    const sel = customMenu.querySelector(".is-selected");
    if (sel && typeof sel.scrollIntoView === "function") {
      sel.scrollIntoView({ block: "nearest" });
    }
  }
}

export function closeCustomHsDropdown() {
  const customDd = document.getElementById("editHsCustomDropdown");
  const customMenu = document.getElementById("editHsCustomMenu");
  const customTrigger = document.getElementById("editHsCustomTrigger");
  if (customDd) customDd.classList.remove("is-open");
  if (customMenu) customMenu.style.display = "none";
  if (customTrigger) customTrigger.setAttribute("aria-expanded", "false");
}

export function selectCustomHsOption(val) {
  const editHsSelect = document.getElementById("editHsSelect");
  if (editHsSelect) {
    editHsSelect.value = val;
    editHsSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  closeCustomHsDropdown();
  if (typeof clearSettingsTabDirty === "function") {
    clearSettingsTabDirty("tab-edit-hs");
  }
}

export function syncCustomHsDropdownUI(curId, hs, netColors, isLight) {
  ensureCustomHsDropdownElements();
  const customMenu = document.getElementById("editHsCustomMenu");
  const customTrigger = document.getElementById("editHsCustomTrigger");
  const customLabel = document.getElementById("editHsCustomLabel");
  if (!customMenu || !customTrigger || !customLabel) return;

  const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
  customMenu.innerHTML = "";

  currentHotspots.forEach(h => {
    const item = document.createElement("div");
    const netType = (h.network_type || "bm").toLowerCase();
    item.className = `hs-custom-dropdown-item hs-opt-net-${netType}${h.hidden ? " is-hidden-hs" : ""}${h.id === curId ? " is-selected" : ""}`;
    item.dataset.value = h.id;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", h.id === curId ? "true" : "false");

    const netProf = getDmrNetworkProfile(netType);
    const netTag = `[${netProf.badgePrefix}] `;
    const ssidStr = (h.bm_ssid !== undefined && h.bm_ssid !== null) ? ` · SSID ${h.bm_ssid}` : "";
    const dispCall = (window.isDemoMode || h.callsign === "Ваш позывной" || (window.i18n && typeof window.i18n.isTranslationOf === "function" && window.i18n.isTranslationOf("demo.your_callsign", h.callsign)))
      ? (window.t ? window.t("demo.your_callsign", {}, "Your Callsign") : "Your Callsign")
      : (h.callsign || "");
    const callStr = dispCall ? ` (${dispCall}${ssidStr})` : "";
    const hiddenTag = h.hidden ? (window.t ? window.t("hotspots.hidden_tag", {}, " [hidden]") : " [hidden]") : "";
    const mainTitle = `${netTag}${h.name || (window.t ? window.t("hotspots.default_name", {}, "Hotspot") : "Hotspot")}`;
    const callHtml = callStr ? `<span class="hs-item-call font-normal">${escapeHtml(callStr)}</span>` : "";
    const hiddenHtml = hiddenTag ? `<span class="hs-item-hidden font-normal">${escapeHtml(hiddenTag)}</span>` : "";
    item.innerHTML = `<span class="hs-item-main font-bold">${escapeHtml(mainTitle)}</span>${callHtml}${hiddenHtml}`;

    const c = netColors[netType] || (isLight ? "#0f172a" : "#e2e8f0");
    item.style.color = c;
    if (h.hidden) {
      item.style.opacity = "0.75";
    }

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      selectCustomHsOption(h.id);
    });
    customMenu.appendChild(item);
  });

  const activeHs = currentHotspots.find(h => h.id === curId) || hs;
  if (activeHs) {
    const netType = (activeHs.network_type || "bm").toLowerCase();
    const netProf = getDmrNetworkProfile(netType);
    const netTag = `[${netProf.badgePrefix}] `;
    const ssidStr = (activeHs.bm_ssid !== undefined && activeHs.bm_ssid !== null) ? ` · SSID ${activeHs.bm_ssid}` : "";
    const dispCall = (window.isDemoMode || activeHs.callsign === "Ваш позывной" || (window.i18n && typeof window.i18n.isTranslationOf === "function" && window.i18n.isTranslationOf("demo.your_callsign", activeHs.callsign)))
      ? (window.t ? window.t("demo.your_callsign", {}, "Your Callsign") : "Your Callsign")
      : (activeHs.callsign || "");
    const callStr = dispCall ? ` (${dispCall}${ssidStr})` : "";
    const hiddenTag = activeHs.hidden ? (window.t ? window.t("hotspots.hidden_tag", {}, " [hidden]") : " [hidden]") : "";
    const mainTitle = `${netTag}${activeHs.name || (window.t ? window.t("hotspots.default_name", {}, "Hotspot") : "Hotspot")}`;
    const callHtml = callStr ? `<span class="hs-item-call font-normal">${escapeHtml(callStr)}</span>` : "";
    const hiddenHtml = hiddenTag ? `<span class="hs-item-hidden font-normal">${escapeHtml(hiddenTag)}</span>` : "";
    customLabel.innerHTML = `<span class="hs-item-main font-bold">${escapeHtml(mainTitle)}</span>${callHtml}${hiddenHtml}`;

    const c = netColors[netType] || (isLight ? "#0f172a" : "#e2e8f0");
    customLabel.style.color = c;
    customTrigger.style.borderColor = (netType === "allstar" && !isLight) ? "rgba(255, 255, 255, 0.45)" : c;
  } else {
    customLabel.textContent = window.t ? window.t("hotspots.new_opt", {}, "+ New hotspot...") : "+ New hotspot...";
    customLabel.style.color = isLight ? "#2563eb" : "#4884FF";
    customTrigger.style.borderColor = isLight ? "#cbd5e1" : "rgba(255, 255, 255, 0.25)";
  }
}

export function updateEditHsToolbarUI(hs) {
  const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
  const editHsSelect = document.getElementById("editHsSelect");
  const btnDelete = document.getElementById("btnDeleteCurrentHotspot");
  const statusBadge = document.getElementById("hsTabStatusBadge");
  const statusDot = document.getElementById("hsTabStatusDot");
  const statusText = document.getElementById("hsTabStatusText");
  const btnConn = document.getElementById("btnToggleHsConnection");

  const curId = hs ? hs.id : "";

  // 1. Dropdown options with live network brand colors (all 12 network types)
  if (editHsSelect) {
    editHsSelect.innerHTML = "";
    const isLight = document.documentElement.getAttribute("data-theme") === "light" || document.body.classList.contains("theme-light");
    const themeKey = isLight ? "light" : "dark";
    const colorsEnabled = isNetworkColorEnabled();
    const neutralColor = isLight ? "#334155" : "#cbd5e1";
    const netColors = {};
    ["bm", "tgif", "freedmr", "adn", "ysf", "m17", "dstar", "svx", "dmrplus", "xlx", "allstar", "custom"].forEach(nt => {
      netColors[nt] = colorsEnabled ? getNetworkBrandColor(nt, themeKey) : neutralColor;
    });

    currentHotspots.forEach(h => {
      const opt = document.createElement("option");
      opt.value = h.id;
      const netType = (h.network_type || "bm").toLowerCase();
      const netProf = getDmrNetworkProfile(netType);
      const netTag = `[${netProf.badgePrefix}] `;
      const ssidStr = (h.bm_ssid !== undefined && h.bm_ssid !== null) ? ` · SSID ${h.bm_ssid}` : "";
      const dispCall = (window.isDemoMode || h.callsign === "Ваш позывной" || (window.i18n && typeof window.i18n.isTranslationOf === "function" && window.i18n.isTranslationOf("demo.your_callsign", h.callsign)))
        ? (window.t ? window.t("demo.your_callsign", {}, "Your Callsign") : "Your Callsign")
        : (h.callsign || "");
      const callStr = dispCall ? ` (${dispCall}${ssidStr})` : "";
      const hiddenTag = h.hidden ? (window.t ? window.t("hotspots.hidden_tag", {}, " [hidden]") : " [hidden]") : "";
      opt.textContent = `${netTag}${h.name || (window.t ? window.t("hotspots.default_name", {}, "Hotspot") : "Hotspot")}${callStr}${hiddenTag}`;
      opt.className = `hs-opt-net-${netType}${h.hidden ? " is-hidden-hs" : ""}`;
      const c = netColors[netType] || (isLight ? "#0f172a" : "#e2e8f0");
      opt.style.color = c;
      opt.style.backgroundColor = isLight ? "#ffffff" : "#161b22";
      if (h.hidden) {
        opt.style.opacity = "0.75";
      }

      if (h.id === curId) opt.selected = true;
      editHsSelect.appendChild(opt);
    });

    const activeHs = currentHotspots.find(h => h.id === curId) || hs;
    if (activeHs) {
      const netType = (activeHs.network_type || "bm").toLowerCase();
      const c = netColors[netType] || (isLight ? "#0f172a" : "#e2e8f0");
      editHsSelect.style.color = c;
      editHsSelect.style.borderColor = (netType === "allstar" && !isLight) ? "rgba(255, 255, 255, 0.45)" : c;
    } else {
      editHsSelect.style.color = isLight ? "#0f172a" : "#e2e8f0";
      editHsSelect.style.borderColor = isLight ? "#cbd5e1" : "rgba(255, 255, 255, 0.25)";
    }
    syncCustomHsDropdownUI(curId, hs, netColors, isLight);
  }

  // 2. Delete button state: disabled if <= 1 hotspot or currently adding new
  if (btnDelete) {
    if (!curId || currentHotspots.length <= 1) {
      btnDelete.disabled = true;
      btnDelete.style.opacity = "0.45";
      btnDelete.style.cursor = "not-allowed";
    } else {
      btnDelete.disabled = false;
      btnDelete.style.opacity = "1";
      btnDelete.style.cursor = "pointer";
    }
  }

  // 3. Connect / ONLINE button
  if (btnConn) {
    if (!curId) {
      btnConn.style.display = "none";
    } else {
      btnConn.style.display = "inline-flex";

      const liveHs = currentHotspots.find(h => h.id === curId) || hs;
      const isOnline = liveHs && liveHs.status === "ONLINE";

      if (isOnline) {
        btnConn.textContent = "ONLINE";
        btnConn.style.color = "#00e676";
        btnConn.style.borderColor = "rgba(0, 230, 118, 0.4)";
        btnConn.style.backgroundColor = "rgba(0, 230, 118, 0.1)";
        btnConn.title = window.t ? window.t("hotspots.btn_conn_online_title", {}, "ONLINE: Connected to BrandMeister (click to disconnect)") : "ONLINE: Connected to BrandMeister (click to disconnect)";
      } else {
        btnConn.textContent = "Connect";
        btnConn.style.color = "#f85149";
        btnConn.style.borderColor = "rgba(248, 81, 73, 0.4)";
        btnConn.style.backgroundColor = "rgba(248, 81, 73, 0.08)";
        btnConn.title = window.t ? window.t("hotspots.btn_conn_offline_title", {}, "Connect: Click to connect to BrandMeister") : "Connect: Click to connect to BrandMeister";
      }
    }
  }

  // 4. Quick move up / down buttons in tab header
  const btnMoveHsUp = document.getElementById("btnMoveHsUp");
  const btnMoveHsDown = document.getElementById("btnMoveHsDown");

  const curIdx = currentHotspots.findIndex(h => h.id === curId);

  if (btnMoveHsUp) {
    // All hotspots are equal: any hotspot with curIdx > 0 can move up
    const canMoveUp = curIdx > 0;
    btnMoveHsUp.disabled = !canMoveUp;
    btnMoveHsUp.style.opacity = canMoveUp ? "1" : "0.35";
    btnMoveHsUp.style.cursor = canMoveUp ? "pointer" : "not-allowed";
  }

  if (btnMoveHsDown) {
    // All hotspots are equal: any hotspot except the last one can move down
    const canMoveDown = curIdx >= 0 && curIdx < currentHotspots.length - 1;
    btnMoveHsDown.disabled = !canMoveDown;
    btnMoveHsDown.style.opacity = canMoveDown ? "1" : "0.35";
    btnMoveHsDown.style.cursor = canMoveDown ? "pointer" : "not-allowed";
  }
}

if (typeof window !== "undefined") {
  window.updateEditHsToolbarUI = updateEditHsToolbarUI;
}

export function openEditHotspotForm(hs) {
    populateEditHotspotFormFields(hs);
    pushNavState("subtab", "tab-edit-hs");

    const tabButtons = document.querySelectorAll("#settingsModal .tab-btn");
    const tabContents = document.querySelectorAll("#settingsModal .tab-content");
    tabButtons.forEach(b => b.classList.remove("active"));
    tabContents.forEach(c => c.classList.remove("active"));
    const editTabBtn = document.querySelector('#settingsModal [data-tab="tab-edit-hs"]');
    if (editTabBtn) editTabBtn.classList.add("active");
    const editTab = document.getElementById("tab-edit-hs");
    if (editTab) editTab.classList.add("active");
    try {
      localStorage.setItem("proxdmr_settings_last_tab", "tab-edit-hs");
    } catch (_) {}
  }

export async function reorderHotspots(orderIds) {
  if (!Array.isArray(orderIds) || !orderIds.length) return false;
  try {
    const resp = await fetch("/api/hotspots/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: orderIds })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || resp.statusText);
    }
    const data = await resp.json();
    if (data.hotspots && Array.isArray(data.hotspots)) {
      window.currentHotspots = data.hotspots;
    }
    renderRadiosGrid();
    renderHotspotSelect();
    renderHotspotsList();
    if (typeof renderToolbarHotspotSlots === "function") {
      renderToolbarHotspotSlots();
    }
    if (typeof renderHotspotArchiveModal === "function") {
      const archModal = document.getElementById("hotspotArchiveModal");
      if (archModal && archModal.classList.contains("active")) {
        renderHotspotArchiveModal();
      }
    }
    const editHsSelect = document.getElementById("editHsSelect");
    const curHs = (window.currentHotspots || []).find(h => h.id === (editHsSelect ? editHsSelect.value : ""));
    if (curHs) updateEditHsToolbarUI(curHs);
    showToast(window.t ? window.t("hotspots.reorder_success", {}, "✅ Порядок хотспотов сохранен") : "✅ Порядок хотспотов сохранен", 2000);
    return true;
  } catch (e) {
    console.error("[HOTSPOTS] Failed to reorder hotspots:", e);
    showToast(window.t ? window.t("hotspots.reorder_error", {}, "Ошибка изменения порядка") : "Ошибка изменения порядка", 3000);
    return false;
  }
}

export async function moveHotspotInOrder(hotspotId, direction) {
  const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
  if (currentHotspots.length <= 1) return;
  const ids = currentHotspots.map(h => h.id);
  const idx = ids.indexOf(hotspotId);
  if (idx < 0) return;
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= ids.length) return;

  const temp = ids[idx];
  ids[idx] = ids[targetIdx];
  ids[targetIdx] = temp;

  const ok = await reorderHotspots(ids);
  if (ok) {
    const curHs = (window.currentHotspots || []).find(h => h.id === hotspotId);
    if (curHs) {
      populateEditHotspotFormFields(curHs);
    }
  }
}

// ─── Hotspot Type Selector Modal (CSS Modal) ──────────────────────────────
export function openHsTypeSelectModal() {
  const modal = document.getElementById("hsTypeSelectModal");
  if (!modal) return;
  modal.style.display = "flex";
  modal.classList.add("active");
  if (typeof pushNavState === "function") {
    pushNavState("modal", "hsTypeSelectModal");
  }
}

export function closeHsTypeSelectModal() {
  const modal = document.getElementById("hsTypeSelectModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.classList.remove("active");
  if (typeof notifyNavClosed === "function") {
    notifyNavClosed("modal", "hsTypeSelectModal");
  }
}

export function startCreateNewHotspotWithType(netType) {
  closeHsTypeSelectModal();
  const cleanType = (netType || "bm").toLowerCase();
  const editHsId = document.getElementById("editHsId");
  if (editHsId) editHsId.value = "__new__";

  const editHsName = document.getElementById("editHsName");
  const netProf = getDmrNetworkProfile(cleanType);
  if (editHsName) {
    editHsName.value = "";
  }

  // Populate fields with network defaults for new hotspot (leave name blank until filled)
  populateEditHotspotFormFields({
    id: "__new__",
    network_type: cleanType,
    name: "",
    bm_master_host: netProf.defaultHost || "",
    bm_master_port: netProf.defaultPort || 62031,
    bm_password: (cleanType === "xlx" || cleanType === "freedmr" || cleanType === "adn") ? "passw0rd" : "",
    hidden: false
  });

  applyEditHsNetworkTypeUI(cleanType, { applyDefaults: true, isNewHotspot: true });

  const editHsSelect = document.getElementById("editHsSelect");
  if (editHsSelect) editHsSelect.value = "__new__";
  const customLabel = document.getElementById("editHsCustomLabel");
  if (customLabel) {
    const newHsTxt = window.t ? window.t("hs_edit.new_hotspot_label", {}, "New Hotspot") : "New Hotspot";
    customLabel.innerHTML = `<span class="hs-item-main font-bold">${escapeHtml(newHsTxt)}</span> <span class="hs-item-call font-normal">(${escapeHtml(netProf.badgePrefix)})</span>`;
    customLabel.style.color = "#10b981";
  }

  const submitFooter = document.getElementById("editHsSubmitFooter");
  if (submitFooter) submitFooter.style.display = "";

  showToast(
    window.t ? window.t("hs_edit.type_selected_toast", { name: netProf.fullName }, `Selected hotspot type: ${netProf.fullName}`) : `Selected hotspot type: ${netProf.fullName}`,
    "info",
    2500
  );
}

// ─── Online Credential Testing Handlers ────────────────────────────────────
export function resetTestCredentialBtn(btn, defaultTitleKey = "hs_edit.btn_test_pwd_title", defaultTitle = "Test server connection with password") {
  if (!btn) return;
  if (btn._resetTimer) {
    clearTimeout(btn._resetTimer);
    btn._resetTimer = null;
  }
  if (btn._textTimer) {
    clearTimeout(btn._textTimer);
    btn._textTimer = null;
  }
  btn.classList.remove("is-success", "is-error", "is-testing");
  btn.textContent = window.t ? window.t("hs_edit.btn_test", {}, "Test") : "Test";
  btn.title = window.t ? window.t(defaultTitleKey, {}, defaultTitle) : defaultTitle;
}

export async function testCurrentHotspotPassword() {
  const btn = document.getElementById("btnTestHsPassword");
  if (!btn || btn.classList.contains("is-testing")) return;

  if (btn._resetTimer) {
    clearTimeout(btn._resetTimer);
    btn._resetTimer = null;
  }
  if (btn._textTimer) {
    clearTimeout(btn._textTimer);
    btn._textTimer = null;
  }

  const editHsNetworkType = document.getElementById("editHsNetworkType");
  const editHsHost = document.getElementById("editHsHost");
  const editHsPort = document.getElementById("editHsPort");
  const editHsPassword = document.getElementById("editHsPassword");
  const editHsDmrId = document.getElementById("editHsDmrId");
  const editHsSsid = document.getElementById("editHsSsid");
  const editHsCallsign = document.getElementById("editHsCallsign");

  // Determine current active network type
  const formEl = document.getElementById("hotspotEditForm");
  let netType = (editHsNetworkType && editHsNetworkType.value) ? editHsNetworkType.value.trim().toLowerCase() : "bm";
  if (!netType && formEl) {
    for (const t of ["bm", "tgif", "freedmr", "adn", "dmrplus", "xlx", "ysf", "m17", "dstar", "svx", "allstar", "custom"]) {
      if (formEl.classList.contains(`hs-net-theme-${t}`)) {
        netType = t;
        break;
      }
    }
  }

  const editHsId = document.getElementById("editHsId");
  const editHsDstarProtocol = document.getElementById("editHsDstarProtocol");
  const editHsDstarModule = document.getElementById("editHsDstarModule");
  const editHsM17Module = document.getElementById("editHsM17Module");
  const defaultTestPort = netType === "svx" ? 5300 : (netType === "dstar" ? 30001 : (netType === "m17" ? 17000 : 62031));
  const payload = {
    network_type: netType,
    host: editHsHost ? editHsHost.value.trim() : "",
    port: editHsPort ? (parseInt(editHsPort.value, 10) || defaultTestPort) : defaultTestPort,
    password: editHsPassword ? editHsPassword.value.trim() : "",
    dmr_id: editHsDmrId ? editHsDmrId.value.trim() : "",
    ssid: editHsSsid ? editHsSsid.value.trim() : "1",
    callsign: editHsCallsign ? editHsCallsign.value.trim() : "",
    hotspot_id: editHsId ? editHsId.value.trim() : "",
    dstar_protocol: editHsDstarProtocol ? editHsDstarProtocol.value : "auto",
    dstar_module: editHsDstarModule ? editHsDstarModule.value : "D",
    m17_module: editHsM17Module ? editHsM17Module.value : "C"
  };

  if (!payload.host) {
    showToast(window.t ? window.t("hs_edit.err_enter_host_test", {}, "Enter server address to test!") : "Enter server address to test!", "warning", 3000);
    return;
  }
  if (!payload.password && netType !== "ysf" && netType !== "m17" && netType !== "dstar") {
    showToast(window.t ? window.t("hs_edit.err_enter_pwd_test", {}, "Enter password to test!") : "Enter password to test!", "warning", 3000);
    return;
  }
  if (netType === "svx" && !payload.callsign) {
    showToast(window.t ? window.t("hotspots.callsign_required", {}, "Укажите позывной (Callsign) для проверки SVXReflector") : "Укажите позывной (Callsign) для проверки SVXReflector", "warning", 3000);
    return;
  }

  btn.classList.add("is-testing");
  btn.classList.remove("is-success", "is-error");
  const origText = window.t ? window.t("hs_edit.btn_test", {}, "Test") : "Test";
  btn.textContent = "...";

  try {
    const res = await fetch("/api/hotspots/test-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      btn.classList.add("is-success");
      btn.textContent = "✓ OK";
      btn.title = data.detail || (window.t ? window.t("hs_edit.auth_ok_title", {}, "Authentication succeeded!") : "Authentication succeeded!");
      showToast(data.detail || (window.t ? window.t("hs_edit.auth_ok_toast", {}, "✅ Password valid, authentication succeeded!") : "✅ Password valid, authentication succeeded!"), "success", 3500);
    } else {
      btn.classList.add("is-error");
      btn.textContent = window.t ? window.t("hs_edit.btn_test_error", {}, "✗ Error") : "✗ Error";
      btn.title = data.detail || (window.t ? window.t("hs_edit.auth_fail_title", {}, "Authentication failed") : "Authentication failed");
      showToast(data.detail || (window.t ? window.t("hs_edit.auth_fail_toast", {}, "❌ Password authentication error") : "❌ Password authentication error"), "error", 4000);
    }
  } catch (err) {
    btn.classList.add("is-error");
    btn.textContent = window.t ? window.t("hs_edit.btn_test_error", {}, "✗ Error") : "✗ Error";
    showToast(window.t ? window.t("hs_edit.test_check_error", { msg: err.message }, `Check error: ${err.message}`) : `Check error: ${err.message}`, "error", 4000);
  } finally {
    btn.classList.remove("is-testing");
    btn._textTimer = setTimeout(() => {
      btn.textContent = origText;
      btn._textTimer = null;
    }, 4000);
    btn._resetTimer = setTimeout(() => {
      resetTestCredentialBtn(btn, "hs_edit.btn_test_pwd_title", "Test server connection with password");
    }, 30000);
  }
}

export async function testCurrentHotspotApiKey() {
  const btn = document.getElementById("btnTestHsApiKey");
  if (!btn || btn.classList.contains("is-testing")) return;

  if (btn._resetTimer) {
    clearTimeout(btn._resetTimer);
    btn._resetTimer = null;
  }
  if (btn._textTimer) {
    clearTimeout(btn._textTimer);
    btn._textTimer = null;
  }

  const editHsApiKey = document.getElementById("editHsApiKey");
  const editHsDmrId = document.getElementById("editHsDmrId");
  const editHsSsid = document.getElementById("editHsSsid");

  const formEl = document.getElementById("hotspotEditForm");
  let netType = "bm";
  if (formEl) {
    for (const t of ["bm", "tgif", "freedmr", "adn", "dmrplus", "xlx", "ysf", "allstar", "custom"]) {
      if (formEl.classList.contains(`hs-net-theme-${t}`)) {
        netType = t;
        break;
      }
    }
  }

  const payload = {
    network_type: netType,
    api_key: editHsApiKey ? editHsApiKey.value.trim() : "",
    dmr_id: editHsDmrId ? editHsDmrId.value.trim() : "",
    ssid: editHsSsid ? editHsSsid.value.trim() : "1"
  };

  if (!payload.api_key) {
    showToast(window.t ? window.t("hs_edit.err_enter_api_test", {}, "Enter API key to test!") : "Enter API key to test!", "warning", 3000);
    return;
  }

  btn.classList.add("is-testing");
  btn.classList.remove("is-success", "is-error");
  const origText = window.t ? window.t("hs_edit.btn_test", {}, "Test") : "Test";
  btn.textContent = "...";

  try {
    const res = await fetch("/api/hotspots/test-api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      btn.classList.add("is-success");
      btn.textContent = "✓ OK";
      btn.title = data.detail || (window.t ? window.t("hs_edit.api_ok_title", {}, "API token verified by server!") : "API token verified by server!");
      showToast(data.detail || (window.t ? window.t("hs_edit.api_ok_toast", {}, "✅ API token is valid!") : "✅ API token is valid!"), "success", 3500);
    } else {
      btn.classList.add("is-error");
      btn.textContent = window.t ? window.t("hs_edit.btn_test_error", {}, "✗ Error") : "✗ Error";
      btn.title = data.detail || (window.t ? window.t("hs_edit.api_fail_title", {}, "API key check failed") : "API key check failed");
      showToast(data.detail || (window.t ? window.t("hs_edit.api_fail_toast", {}, "❌ API key check failed") : "❌ API key check failed"), "error", 4000);
    }
  } catch (err) {
    btn.classList.add("is-error");
    btn.textContent = window.t ? window.t("hs_edit.btn_test_error", {}, "✗ Error") : "✗ Error";
    showToast(window.t ? window.t("hs_edit.api_check_error", { msg: err.message }, `API check error: ${err.message}`) : `API check error: ${err.message}`, "error", 4000);
  } finally {
    btn.classList.remove("is-testing");
    btn._textTimer = setTimeout(() => {
      btn.textContent = origText;
      btn._textTimer = null;
    }, 4000);
    btn._resetTimer = setTimeout(() => {
      resetTestCredentialBtn(btn, "hs_edit.btn_test_api_title", "Validate API key on server");
    }, 30000);
  }
}

// ─── Settings Dirty State Tracker & Pinned Header Save Button ─────────────
const _settingsDirtyByTab = {
  "tab-general": false,
  "tab-appearance": false,
  "tab-edit-hs": false,
  "tab-transcriber": false,
  "tab-alerts": false,
  "tab-account": false
};

export function getActiveSettingsTabId() {
  const activeBtn = document.querySelector("#settingsModal .tab-btn.active");
  return activeBtn ? (activeBtn.dataset.tab || "tab-general") : "tab-general";
}

export function updateSettingsHeaderSaveBtn() {
  const saveBtn = document.getElementById("btnSettingsHeaderSave");
  if (!saveBtn) return;

  const activeTabId = getActiveSettingsTabId();

  if (activeTabId === "tab-account") {
    const demoBtn = document.getElementById("adminDemoSaveBtn");
    const demoBlock = demoBtn ? demoBtn.closest(".account-subtab-content") : null;
    if (demoBtn && demoBlock && demoBlock.classList.contains("active") && window.getComputedStyle && window.getComputedStyle(demoBtn).display !== "none") {
      saveBtn.style.display = "inline-flex";
      saveBtn.disabled = false;
      const isDirty = Boolean(_settingsDirtyByTab["tab-account"]);
      if (isDirty) saveBtn.classList.add("is-dirty");
      else saveBtn.classList.remove("is-dirty");
    } else {
      saveBtn.style.display = "inline-flex";
      saveBtn.disabled = true;
      saveBtn.classList.remove("is-dirty");
      saveBtn.title = (window.t ? window.t("account.no_general_save", {}, "В разделе аккаунта действия выполняются точечно") : "В разделе аккаунта действия выполняются точечно");
    }
    return;
  }

  saveBtn.style.display = "inline-flex";
  saveBtn.disabled = false;

  const isDirty = Boolean(_settingsDirtyByTab[activeTabId]);
  if (isDirty) {
    saveBtn.classList.add("is-dirty");
    saveBtn.title = (window.t ? window.t("buttons.save_unsaved_changes", {}, "Есть несохранённые изменения! Нажмите для сохранения") : "Есть несохранённые изменения! Нажмите для сохранения");
  } else {
    saveBtn.classList.remove("is-dirty");
    saveBtn.title = (window.t ? window.t("buttons.save_settings", {}, "Сохранить настройки") : "Сохранить настройки");
  }
}

export function setSettingsTabDirty(tabId, isDirty = true) {
  if (!tabId) tabId = getActiveSettingsTabId();
  _settingsDirtyByTab[tabId] = Boolean(isDirty);
  updateSettingsHeaderSaveBtn();
}

export function clearSettingsTabDirty(tabId) {
  if (!tabId) tabId = getActiveSettingsTabId();
  _settingsDirtyByTab[tabId] = false;
  updateSettingsHeaderSaveBtn();
}

export function handleSettingsHeaderSaveClick() {
  const activeTabId = getActiveSettingsTabId();

  if (activeTabId === "tab-general" || activeTabId === "tab-appearance") {
    const btn = document.getElementById("btnSaveGeneralSettings");
    if (btn) btn.click();
  } else if (activeTabId === "tab-edit-hs") {
    const form = document.getElementById("hotspotEditForm");
    if (form) {
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        const sub = form.querySelector('button[type="submit"]');
        if (sub) sub.click();
        else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      }
    }
  } else if (activeTabId === "tab-transcriber") {
    const form = document.getElementById("transcriberSettingsForm");
    if (form) {
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        const sub = form.querySelector('button[type="submit"]');
        if (sub) sub.click();
        else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      }
    }
  } else if (activeTabId === "tab-alerts") {
    const btn = document.getElementById("btnSaveAlerts");
    if (btn) btn.click();
  } else if (activeTabId === "tab-account") {
    const demoBtn = document.getElementById("adminDemoSaveBtn");
    if (demoBtn && !demoBtn.disabled) demoBtn.click();
  }
}

export function autoSaveExistingHotspotIfDirty() {
  if (_settingsDirtyByTab && _settingsDirtyByTab["tab-edit-hs"]) {
    const editHsId = document.getElementById("editHsId");
    const id = editHsId ? editHsId.value.trim() : "";
    if (id && id !== "__new__") {
      const form = document.getElementById("hotspotEditForm");
      if (form) {
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          const sub = form.querySelector('button[type="submit"]');
          if (sub) sub.click();
          else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        }
      }
    }
  }
}

// ─── Top Toolbar 7 Slots + 1s Process Cycle Registry + Archive Modal ───────
const HOTSPOT_TOOLBAR_PROCESS_PROVIDERS = [];
let _toolbarCycleTimer = null;
let _toolbarCycleStep = 0;

export function registerToolbarProcessProvider(providerFn) {
  if (typeof providerFn !== "function") return;
  if (!HOTSPOT_TOOLBAR_PROCESS_PROVIDERS.includes(providerFn)) {
    HOTSPOT_TOOLBAR_PROCESS_PROVIDERS.push(providerFn);
  }
}

function getToolbarShortNetCode(netType) {
  const raw = String(netType || "bm").trim().toLowerCase();
  const prof = (typeof getDmrNetworkProfile === "function") ? getDmrNetworkProfile(raw) : null;
  if (prof && prof.shortLabel) return String(prof.shortLabel).toUpperCase();
  const fallbackMap = {
    bm: "BM",
    tgif: "TGIF",
    freedmr: "FDMR",
    adn: "ADN",
    ysf: "YSF",
    dmrplus: "DMR+",
    xlx: "XLX",
    allstar: "ASL",
    asl: "ASL",
    iax: "ASL",
    allstarlink: "ASL",
    custom: "HBP"
  };
  return (fallbackMap[raw] || "BM").toUpperCase();
}

function extractCleanToolbarHsName(hs) {
  const rawName = String((hs && hs.name) || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!rawName) return "";
  let clean = rawName;
  try {
    clean = rawName.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").trim();
  } catch (_) {}
  if (!clean) clean = rawName;
  return clean.replace(/\s+/g, " ").trim();
}

function formatToolbarAlphabetSuffix(zeroBasedIndex) {
  let n = Math.max(0, Math.floor(Number(zeroBasedIndex) || 0));
  let out = "";
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function resolveToolbarSlotLabels(displayHotspots) {
  if (!Array.isArray(displayHotspots)) return [];
  const unnamedCounts = new Map();
  const parsed = displayHotspots.map((hs) => {
    const cleanName = extractCleanToolbarHsName(hs);
    const typeCode = getToolbarShortNetCode(hs && hs.network_type);
    const isUnnamed = !cleanName;
    if (isUnnamed) {
      unnamedCounts.set(typeCode, (unnamedCounts.get(typeCode) || 0) + 1);
    }
    return { cleanName, typeCode, isUnnamed };
  });

  const unnamedSeen = new Map();
  return parsed.map((entry) => {
    if (!entry.isUnnamed) {
      return { label: entry.cleanName, isUnnamed: false, typeCode: entry.typeCode };
    }
    const totalOfType = unnamedCounts.get(entry.typeCode) || 0;
    if (totalOfType >= 2) {
      const ord = unnamedSeen.get(entry.typeCode) || 0;
      unnamedSeen.set(entry.typeCode, ord + 1);
      return {
        label: `${entry.typeCode}.${formatToolbarAlphabetSuffix(ord)}`,
        isUnnamed: true,
        typeCode: entry.typeCode
      };
    }
    return { label: entry.typeCode, isUnnamed: true, typeCode: entry.typeCode };
  });
}

function formatToolbarSlotName(hs, idx, displayHotspots = null) {
  if (Array.isArray(displayHotspots)) {
    const resolved = resolveToolbarSlotLabels(displayHotspots);
    if (resolved[idx]) return resolved[idx].label;
  }
  const cleanName = extractCleanToolbarHsName(hs);
  return cleanName || getToolbarShortNetCode(hs && hs.network_type);
}

function getToolbarSlotProcessList(hs) {
  if (!hs) return [];
  const cid = resolveHotspotId(hs.id);
  const card = document.querySelector(`.radio-container[data-hotspot-id="${hs.id}"]`)
    || document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
  const list = [];

  for (const providerFn of HOTSPOT_TOOLBAR_PROCESS_PROVIDERS) {
    try {
      const item = providerFn(hs, cid, card);
      if (item && item.key) {
        list.push(item);
      }
    } catch (_) {}
  }
  return list;
}

function _isToolbarGlobalAutoRecEnabled() {
  if (typeof window !== "undefined" && typeof window.__proxdmrGlobalAutoRecord === "boolean") {
    return window.__proxdmrGlobalAutoRecord;
  }
  try {
    const raw = localStorage.getItem("proxdmr_rec_settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.auto_record === false) return false;
      if (parsed && parsed.auto_record_rx === false && parsed.auto_record_tx === false) return false;
    }
  } catch (_) {}
  const chk = typeof document !== "undefined" ? document.getElementById("recOptAutoRecord") : null;
  if (chk && typeof window !== "undefined" && window.__proxdmrRecSettingsLoaded && !chk.checked) {
    return false;
  }
  return true;
}

function _resolveToolbarSlotCard(hs, cid) {
  if (!hs || typeof document === "undefined") return null;
  const rc = document.getElementById("radioContainer");
  const rcMatch = rc && (!rc.dataset.hotspotId || resolveHotspotId(rc.dataset.hotspotId) === cid) ? rc : null;
  return document.querySelector(`.radio-container[data-hotspot-id="${hs.id}"]`)
    || document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`)
    || rcMatch;
}

function _isToolbarSlotRecEnabled(hs, cid, card) {
  if (!hs) return false;
  const recBtn = card ? card.querySelector(".header-rec-btn") : null;
  let lsAutoRec = true;
  try {
    lsAutoRec = localStorage.getItem(`proxdmr_autorec_${cid}`) !== "0";
  } catch (_) {}
  const isPerHotspotRecOn = (hs.auto_record !== undefined ? (hs.auto_record !== false) : lsAutoRec)
    && !(recBtn && recBtn.classList.contains("rec-off"));
  return Boolean(isPerHotspotRecOn && _isToolbarGlobalAutoRecEnabled());
}

function _isToolbarGlobalAutoRecRxOff() {
  try {
    const raw = localStorage.getItem("proxdmr_rec_settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.auto_record_rx === false) return true;
    }
  } catch (_) {}
  return false;
}

// Active Recording corner red-dot detector for expanded and live-collapsed hotspots (never fires if recording is disabled)
function isToolbarSlotRxActive(hs) {
  if (!hs || (isHotspotCollapsed(hs.id) && !isHotspotLiveCollapsed(hs.id))) return false;
  const cid = resolveHotspotId(hs.id);
  const card = _resolveToolbarSlotCard(hs, cid);
  if (!_isToolbarSlotRecEnabled(hs, cid, card)) {
    return false;
  }

  const isPttActive = Boolean(typeof window !== "undefined" && window.isPttPressed);
  const activeTxId = (typeof window !== "undefined" && window.activeTxHotspotId) || (typeof window !== "undefined" && window.activeHotspotId);
  if (isPttActive && resolveHotspotId(activeTxId) === cid) {
    return true;
  }

  if (typeof window !== "undefined" && window.recordingsManager && window.recordingsManager.isSessionActive) {
    return true;
  }

  if (!_isToolbarGlobalAutoRecRxOff() && isToolbarSlotRealRxActive(hs, card)) {
    return true;
  }

  return false;
}

function isToolbarSlotRealRxActive(hs, card) {
  if (!hs) return false;
  const netType = String(hs.network_type || (card && card.dataset.networkType) || "").toLowerCase();
  const isAllStar = netType === "allstar" || Boolean(card && card.classList.contains("card-net-allstar"));
  if (isAllStar) {
    if (hs._aslCarrierRx || (hs.ts1 && hs.ts1.active)) return true;
    if (card && card.querySelector(".vfo-allstar-row.allstar-rx-active")) return true;
    if (card && card._lastRx && card._lastRx[1] && card._lastRx[1].active) return true;
    return false;
  }
  if (hs._ysfCarrierRx || (hs.ts1 && hs.ts1.active) || (hs.ts2 && hs.ts2.active)) {
    return true;
  }
  if (!card) return false;
  if (card._lastRx) {
    const s1 = card._lastRx[1];
    const s2 = card._lastRx[2];
    if ((s1 && s1.active) || (s2 && s2.active)) return true;
  }
  if (card.querySelector(".vfo-ts1-row.vfo-rx-active, .vfo-ts2-row.vfo-rx-active, .vfo-ts1-rx.active, .vfo-ts2-rx.active")) {
    return true;
  }
  const modeBadge = card.querySelector(".mode-badge");
  if (modeBadge && modeBadge.classList.contains("mode-rx")) {
    return true;
  }
  return false;
}

// Active Real-RX corner green-dot detector when Recording is disabled
function isToolbarSlotRxGreenDotActive(hs) {
  if (!hs || (isHotspotCollapsed(hs.id) && !isHotspotLiveCollapsed(hs.id))) return false;
  if (isToolbarSlotRxActive(hs)) return false;
  const cid = resolveHotspotId(hs.id);
  const card = _resolveToolbarSlotCard(hs, cid);
  const recEnabled = _isToolbarSlotRecEnabled(hs, cid, card);
  if (recEnabled && !_isToolbarGlobalAutoRecRxOff()) {
    return false;
  }
  return isToolbarSlotRealRxActive(hs, card);
}

// Active speech transcription indicator ("T") for live slot transcription AND offline transcription from History/Player
function isToolbarSlotTranscribeActive(hs) {
  if (!hs) return false;
  const cid = resolveHotspotId(hs.id);
  const rm = (typeof window !== "undefined") ? window.recordingsManager : null;
  const isOfflineActive = Boolean(
    rm &&
    typeof rm.isHotspotOfflineTranscribing === "function" &&
    (rm.isHotspotOfflineTranscribing(cid) || rm.isHotspotOfflineTranscribing(hs.id))
  );
  const card = _resolveToolbarSlotCard(hs, cid);
  const isBtnOfflineActive = Boolean(card && card.querySelector(".btn-hs-transcribe.transcribing"));
  if (isOfflineActive || isBtnOfflineActive) return true;

  if (isHotspotCollapsed(hs.id) && !isHotspotLiveCollapsed(hs.id)) return false;
  if (!card) return false;
  return Boolean(card.classList.contains("has-transcribe-mode") || card.querySelector(".has-transcribe"));
}

// Built-in Provider 2: Offline AI Transcribe ("t")
registerToolbarProcessProvider((hs, cid, card) => {
  const tBtn = card ? card.querySelector(".btn-hs-transcribe") : null;
  const rm = (typeof window !== "undefined") ? window.recordingsManager : null;
  const isRmActive = Boolean(
    rm &&
    typeof rm.isHotspotOfflineTranscribing === "function" &&
    (rm.isHotspotOfflineTranscribing(cid) || (hs && rm.isHotspotOfflineTranscribing(hs.id)))
  );
  const visible = Boolean((tBtn && tBtn.style.display !== "none" && tBtn.classList.contains("transcribing")) || isRmActive);
  if (!visible) return null;
  return {
    key: "transcribe",
    badgeClass: "proc-mode-transcribe",
    main: "t",
    sub: "AI",
    title: (tBtn && tBtn.title) || (window.t ? window.t("transcriber.offline_title", {}, "Offline transcription (Google AI)") : "Offline transcription (Google AI)")
  };
});

// Built-in Provider 3: Piper TTS Model Upload (%)
registerToolbarProcessProvider((_hs, _cid, card) => {
  const ttsState = (typeof window !== "undefined" && window.__proxdmrTtsUploadState) || null;
  if (ttsState && (ttsState.status === "running" || ttsState.status === "completed")) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(ttsState.progress) || 0)));
    return {
      key: "tts_upload",
      badgeClass: "proc-mode-tts-upload",
      main: "TTS",
      sub: `${ttsState.status === "completed" ? 100 : pct}%`,
      title: `TTS: ${ttsState.status === "completed" ? 100 : pct}%`
    };
  }
  const ind = card ? card.querySelector(".header-tts-upload-indicator") : null;
  if (ind && ind.style.display !== "none") {
    const pEl = ind.querySelector(".tts-upload-percent");
    return {
      key: "tts_upload",
      badgeClass: "proc-mode-tts-upload",
      main: "TTS",
      sub: pEl ? pEl.textContent : "0%",
      title: ind.title || (window.t ? window.t("transcriber.piper_upload_title", {}, "Uploading Piper TTS voice model") : "Uploading Piper TTS voice model")
    };
  }
  return null;
});

// Built-in Provider 4: BrandMeister / TGIF / FreeDMR TalkGroups Batch Upload (%)
registerToolbarProcessProvider((hs, cid, card) => {
  const bmState = (typeof window !== "undefined" && window.__proxdmrBmUploadState) || null;
  if (bmState && (bmState.status === "running" || bmState.status === "completed")) {
    const stCid = bmState.hotspotId ? resolveHotspotId(bmState.hotspotId) : "";
    if (!stCid || stCid === cid || bmState.hotspotId === hs.id) {
      return {
        key: "bm_upload",
        badgeClass: "proc-mode-bm-upload",
        main: "TG",
        sub: `${bmState.status === "completed" ? 100 : (bmState.percent || 0)}%`,
        title: `TalkGroups Upload: ${bmState.status === "completed" ? 100 : (bmState.percent || 0)}%`
      };
    }
  }
  const ind = card ? card.querySelector(".header-bm-upload-indicator") : null;
  if (ind && ind.style.display !== "none") {
    const pEl = ind.querySelector(".bm-upload-percent");
    return {
      key: "bm_upload",
      badgeClass: "proc-mode-bm-upload",
      main: "TG",
      sub: pEl ? pEl.textContent : "0%",
      title: ind.title || (window.t ? window.t("bmtg.operation_title", {}, "TalkGroups operation") : "TalkGroups operation")
    };
  }
  return null;
});

let _toolbarSlotFontFitRaf = null;
let _toolbarSlotFontFitResizeObserver = null;
let _toolbarSlotFontFitListenersBound = false;

function isToolbarSlotNameOverflowing(btn, nameEl) {
  if (!btn || !nameEl) return false;
  const btnStyle = window.getComputedStyle(btn);
  const padLeft = parseFloat(btnStyle.paddingLeft) || 0;
  const padRight = parseFloat(btnStyle.paddingRight) || 0;
  const borderLeft = parseFloat(btnStyle.borderLeftWidth) || 0;
  const borderRight = parseFloat(btnStyle.borderRightWidth) || 0;
  const btnRect = btn.getBoundingClientRect();
  const contentWidth = (btnRect.width > 0 ? (btnRect.width - borderLeft - borderRight) : btn.clientWidth) - padLeft - padRight;
  if (contentWidth <= 4) return false;

  if (nameEl.scrollWidth > Math.floor(contentWidth)) {
    return true;
  }
  try {
    if (typeof document !== "undefined" && typeof document.createRange === "function" && nameEl.firstChild) {
      const range = document.createRange();
      range.selectNodeContents(nameEl);
      const textWidth = range.getBoundingClientRect().width;
      if (textWidth > contentWidth - 0.4) {
        return true;
      }
    }
  } catch (_) {}
  return false;
}

function syncToolbarSlotLiveBorderSvg(btn) {
  if (!btn) return;
  const svg = btn.querySelector(":scope > .slot-live-border");
  if (!svg) return;
  const rectEl = svg.querySelector("rect");
  if (!rectEl) return;
  const r = btn.getBoundingClientRect();
  const w = r.width > 4 ? Math.round(r.width * 10) / 10 : (btn.offsetWidth || 46);
  const h = r.height > 4 ? Math.round(r.height * 10) / 10 : (btn.offsetHeight || 30);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  const bw = 2.5;
  const half = bw / 2;
  rectEl.setAttribute("x", String(half));
  rectEl.setAttribute("y", String(half));
  rectEl.setAttribute("width", String(Math.max(1, Math.round((w - bw) * 10) / 10)));
  rectEl.setAttribute("height", String(Math.max(1, Math.round((h - bw) * 10) / 10)));
  let rad = 0;
  try {
    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
      rad = parseFloat(window.getComputedStyle(btn).borderTopLeftRadius) || 0;
    }
  } catch (_) {}
  const innerRad = Math.max(0, Math.round((rad - half) * 10) / 10);
  rectEl.setAttribute("rx", String(innerRad));
  rectEl.setAttribute("ry", String(innerRad));
}

function fitToolbarSlotNameFont(btn) {
  if (!btn || btn.classList.contains("is-empty")) return;
  syncToolbarSlotLiveBorderSvg(btn);
  if (btn.classList.contains("is-proc-showing")) return;
  const nameEl = btn.querySelector(".slot-name");
  if (!nameEl) return;
  if (typeof window === "undefined" || !nameEl.getClientRects || nameEl.getClientRects().length === 0) return;

  nameEl.classList.remove("slot-font-minus-1", "slot-font-minus-2");
  if (!isToolbarSlotNameOverflowing(btn, nameEl)) return;

  nameEl.classList.add("slot-font-minus-1");
  void nameEl.offsetWidth;
  if (!isToolbarSlotNameOverflowing(btn, nameEl)) return;

  nameEl.classList.remove("slot-font-minus-1");
  nameEl.classList.add("slot-font-minus-2");
}

function fitAllToolbarSlotNames() {
  if (typeof document === "undefined") return;
  const container = document.getElementById("toolbarMiddleCluster");
  if (!container) return;
  container.querySelectorAll(".toolbar-hs-slot:not(.is-empty)").forEach((btn) => {
    fitToolbarSlotNameFont(btn);
  });
}

function scheduleFitAllToolbarSlotNames() {
  if (typeof requestAnimationFrame !== "function") {
    fitAllToolbarSlotNames();
    return;
  }
  if (_toolbarSlotFontFitRaf) {
    cancelAnimationFrame(_toolbarSlotFontFitRaf);
  }
  _toolbarSlotFontFitRaf = requestAnimationFrame(() => {
    _toolbarSlotFontFitRaf = null;
    fitAllToolbarSlotNames();
  });
}

function ensureToolbarSlotFontFitObservers(container) {
  if (typeof window === "undefined") return;
  if (!_toolbarSlotFontFitListenersBound) {
    _toolbarSlotFontFitListenersBound = true;
    window.addEventListener("resize", scheduleFitAllToolbarSlotNames, { passive: true });
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
      document.fonts.ready.then(() => scheduleFitAllToolbarSlotNames()).catch(() => {});
    }
  }
  if (container && !_toolbarSlotFontFitResizeObserver && typeof ResizeObserver === "function") {
    try {
      _toolbarSlotFontFitResizeObserver = new ResizeObserver(() => {
        scheduleFitAllToolbarSlotNames();
      });
      _toolbarSlotFontFitResizeObserver.observe(container);
    } catch (_) {}
  }
}

function applySlotCycleDisplay(btn, hs, idx) {
  if (!btn) return;
  const procClassList = ["is-proc-showing", "proc-mode-transcribe", "proc-mode-tts-upload", "proc-mode-bm-upload"];
  const badgeEl = btn.querySelector(".slot-proc-badge");
  const wasProcShowing = btn.classList.contains("is-proc-showing");

  if (!hs) {
    btn.classList.remove(...procClassList, "has-rx-dot", "has-rx-green-dot", "has-tr-dot");
    if (badgeEl) badgeEl.innerHTML = "";
    if (wasProcShowing) fitToolbarSlotNameFont(btn);
    return;
  }

  const showTrDot = isToolbarSlotTranscribeActive(hs);
  if (isHotspotCollapsed(hs.id) && !isHotspotLiveCollapsed(hs.id)) {
    btn.classList.remove(...procClassList, "has-rx-dot", "has-rx-green-dot");
    btn.classList.toggle("has-tr-dot", showTrDot);
    if (badgeEl) badgeEl.innerHTML = "";
    if (wasProcShowing) fitToolbarSlotNameFont(btn);
    return;
  }

  if (btn.classList.contains("is-live-collapsed")) {
    syncToolbarSlotLiveBorderSvg(btn);
  }

  const showRedRecDot = isToolbarSlotRxActive(hs);
  const showGreenRxDot = !showRedRecDot && isToolbarSlotRxGreenDotActive(hs);
  btn.classList.toggle("has-rx-dot", showRedRecDot);
  btn.classList.toggle("has-rx-green-dot", showGreenRxDot);
  btn.classList.toggle("has-tr-dot", showTrDot);

  if (!isHotspotCollapsed(hs.id)) {
    btn.classList.remove(...procClassList);
    if (badgeEl) badgeEl.innerHTML = "";
    if (wasProcShowing) fitToolbarSlotNameFont(btn);
    return;
  }

  const processes = getToolbarSlotProcessList(hs);
  if (!processes.length) {
    btn.classList.remove(...procClassList);
    if (badgeEl) badgeEl.innerHTML = "";
    if (wasProcShowing) fitToolbarSlotNameFont(btn);
    return;
  }

  const totalSteps = 1 + processes.length;
  const activeStep = _toolbarCycleStep % totalSteps;
  if (activeStep === 0) {
    btn.classList.remove(...procClassList);
    if (badgeEl) badgeEl.innerHTML = "";
    if (wasProcShowing) fitToolbarSlotNameFont(btn);
    return;
  }

  const proc = processes[activeStep - 1];
  btn.classList.remove("proc-mode-transcribe", "proc-mode-tts-upload", "proc-mode-bm-upload");
  btn.classList.add("is-proc-showing");
  if (proc.badgeClass) {
    btn.classList.add(proc.badgeClass);
  }
  if (badgeEl) {
    badgeEl.innerHTML = `<span class="slot-proc-main">${safeEscapeHtml(proc.main || "")}</span>${proc.sub ? `<span class="slot-proc-sub">${safeEscapeHtml(proc.sub)}</span>` : ""}`;
  }
}

function syncToolbarCycleTimer(shouldRun) {
  if (shouldRun && !_toolbarCycleTimer) {
    _toolbarCycleTimer = setInterval(() => {
      _toolbarCycleStep = (_toolbarCycleStep + 1) % 100000;
      refreshToolbarProcessIndicators();
    }, 1000);
  } else if (!shouldRun && _toolbarCycleTimer) {
    clearInterval(_toolbarCycleTimer);
    _toolbarCycleTimer = null;
    _toolbarCycleStep = 0;
  }
}

let _toolbarSlotDragState = null;

export function refreshToolbarProcessIndicators() {
  if (_toolbarSlotDragState) return;
  const container = document.getElementById("toolbarMiddleCluster");
  if (!container) return;
  const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length)
    ? window.currentHotspots
    : (Array.isArray(currentHotspots) && currentHotspots.length ? currentHotspots : []);
  const displayHotspots = allHs.filter(h => !h.hidden).slice(0, 7);

  let anyLiveWithProcesses = false;
  container.querySelectorAll(".toolbar-hs-slot").forEach((btn) => {
    const idx = parseInt(btn.dataset.slotIndex || "0", 10);
    const hs = displayHotspots[idx] || null;
    if (hs && isHotspotCollapsed(hs.id) && isHotspotLiveCollapsed(hs.id)) {
      const procs = getToolbarSlotProcessList(hs);
      if (procs.length > 0) anyLiveWithProcesses = true;
    }
    applySlotCycleDisplay(btn, hs, idx);
  });

  syncToolbarCycleTimer(anyLiveWithProcesses);
}

async function archiveHotspotWithConfirm(hs, idx) {
  if (!hs) return;
  const hsName = hs.name || hs.callsign || `${window.t ? window.t("hotspots.name_prefix", {}, "Hotspot") : "Hotspot"} #${idx + 1}`;
  const titleText = window.t ? window.t("hotspots.archive_confirm_title", {}, "Archive Hotspot") : "Archive Hotspot";
  const confirmMsg = window.t
    ? window.t("hotspots.archive_confirm_msg", { name: hsName }, `Are you sure you want to archive hotspot "${hsName}"?`)
    : `Are you sure you want to archive hotspot "${hsName}"?`;
  const confirmBtnText = window.t ? window.t("hotspots.btn_to_archive", {}, "Archive") : "Archive";
  const cancelBtnText = window.t ? window.t("buttons.cancel", {}, "Cancel") : "Cancel";

  const confirmed = typeof window.showAppConfirm === "function"
    ? await window.showAppConfirm({
        title: titleText,
        icon: "📦",
        message: confirmMsg,
        confirmText: confirmBtnText,
        cancelText: cancelBtnText,
        confirmStyle: "primary"
      })
    : (typeof confirm === "function" ? confirm(confirmMsg) : true);

  if (!confirmed) return;
  await toggleHotspotArchiveState(hs.id, true);
}

function closeToolbarSlotContextMenu() {
  const existing = document.getElementById("toolbarSlotContextMenu");
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
  if (typeof window !== "undefined" && typeof window._toolbarSlotCtxCleanup === "function") {
    try { window._toolbarSlotCtxCleanup(); } catch (_) {}
    window._toolbarSlotCtxCleanup = null;
  }
}

function openToolbarSlotContextMenu(btn, hs, idx) {
  if (!btn || !hs) return;
  closeToolbarSlotContextMenu();

  const cid = resolveHotspotId(hs.id);
  const isCollapsed = Boolean(isHotspotCollapsed(cid));
  const isSolo = Boolean(typeof window.isHotspotSoloActive === "function" && window.isHotspotSoloActive(cid));
  const hsTitle = String(hs.name || "").trim() || formatToolbarSlotName(hs, idx);

  const collapseText = window.t ? window.t("toolbar.menu_collapse", {}, "Свернуть") : "Свернуть";
  const soloText = window.t ? window.t("toolbar.menu_solo", {}, "Solo") : "Solo";
  const soloOffText = window.t ? window.t("toolbar.menu_solo_off", {}, "Solo OFF") : "Solo OFF";
  const archiveText = window.t ? window.t("toolbar.menu_archive", {}, "Переместить в архив") : "Переместить в архив";

  const menu = document.createElement("div");
  menu.id = "toolbarSlotContextMenu";
  menu.className = "toolbar-slot-ctx-menu";
  menu.setAttribute("role", "menu");
  const openedAt = Date.now();

  let itemsHtml = `<div class="toolbar-slot-ctx-header">${safeEscapeHtml(hsTitle)}</div>`;
  if (!isCollapsed) {
    itemsHtml += `<button type="button" class="toolbar-slot-ctx-item" role="menuitem" data-action="collapse"><span class="ctx-item-icon" aria-hidden="true">🔽</span><span class="ctx-item-label">${safeEscapeHtml(collapseText)}</span></button>`;
  }
  itemsHtml += `<button type="button" class="toolbar-slot-ctx-item${isSolo ? " is-solo-active" : ""}" role="menuitem" data-action="solo"><span class="ctx-item-icon" aria-hidden="true">${isSolo ? "🔊" : "🎯"}</span><span class="ctx-item-label">${safeEscapeHtml(isSolo ? soloOffText : soloText)}</span></button>`;
  itemsHtml += `<button type="button" class="toolbar-slot-ctx-item is-archive" role="menuitem" data-action="archive"><span class="ctx-item-icon" aria-hidden="true">📦</span><span class="ctx-item-label">${safeEscapeHtml(archiveText)}</span></button>`;
  menu.innerHTML = itemsHtml;

  document.body.appendChild(menu);

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  const menuRect = menu.getBoundingClientRect();
  if (isMobile) {
    const toolbarEl = document.getElementById("proxdmrTopToolbar");
    const toolbarBottom = toolbarEl ? toolbarEl.getBoundingClientRect().bottom : 42;
    const topPx = Math.max(12, Math.min(Math.round(toolbarBottom + 38), window.innerHeight - menuRect.height - 12));
    menu.classList.add("is-mobile-pos");
    menu.style.left = "50%";
    menu.style.top = `${topPx}px`;
  } else {
    const btnRect = btn.getBoundingClientRect();
    const rawLeft = Math.round(btnRect.left + 30);
    const rawTop = Math.round(btnRect.top + 20);
    const clampedLeft = Math.max(8, Math.min(rawLeft, window.innerWidth - menuRect.width - 8));
    const clampedTop = Math.max(8, Math.min(rawTop, window.innerHeight - menuRect.height - 8));
    menu.style.left = `${clampedLeft}px`;
    menu.style.top = `${clampedTop}px`;
  }

  menu.addEventListener("click", async (e) => {
    const itemBtn = e.target && typeof e.target.closest === "function" ? e.target.closest(".toolbar-slot-ctx-item") : null;
    if (!itemBtn) return;
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - openedAt < 180) return;
    const action = itemBtn.dataset.action;
    closeToolbarSlotContextMenu();
    if (action === "collapse") {
      if (typeof window.collapseHotspot === "function") {
        window.collapseHotspot(cid, { isLive: true });
      }
    } else if (action === "solo") {
      if (typeof window.toggleHotspotSoloAudio === "function") {
        window.toggleHotspotSoloAudio(cid);
      }
    } else if (action === "archive") {
      await archiveHotspotWithConfirm(hs, idx);
    }
  });

  const onDocPointerDown = (e) => {
    if (!menu.contains(e.target)) {
      closeToolbarSlotContextMenu();
    }
  };
  const onDocKeyDown = (e) => {
    if (e.key === "Escape") {
      closeToolbarSlotContextMenu();
    }
  };
  const onWinResize = () => {
    closeToolbarSlotContextMenu();
  };

  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeyDown, true);
  window.addEventListener("resize", onWinResize);
  window._toolbarSlotCtxCleanup = () => {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeyDown, true);
    window.removeEventListener("resize", onWinResize);
  };
}

function openToolbarEmptySlotArchiveMenu(btn, idx) {
  if (!btn) return;
  const lastClosed = typeof window !== "undefined" ? window._toolbarLastClosedArchiveSlot : null;
  if (lastClosed && lastClosed.idx === idx && (Date.now() - lastClosed.at) < 400) {
    window._toolbarLastClosedArchiveSlot = null;
    return;
  }
  const existing = document.getElementById("toolbarSlotContextMenu");
  if (existing && existing.dataset.menuType === "archive-picker" && existing.dataset.slotIndex === String(idx)) {
    closeToolbarSlotContextMenu();
    return;
  }
  closeToolbarSlotContextMenu();

  const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length)
    ? window.currentHotspots
    : (Array.isArray(currentHotspots) ? currentHotspots : []);
  const archivedHs = allHs.filter(h => Boolean(h.hidden));

  const headerText = window.t ? window.t("toolbar.menu_archive_pick_hdr", {}, "Из архива в слот") : "Из архива в слот";
  const emptyText = window.t ? window.t("archive.no_archived", {}, "В архиве пока нет хотспотов") : "В архиве пока нет хотспотов";
  const defaultHsName = window.t ? window.t("hotspots.default_name", {}, "Hotspot") : "Hotspot";

  const menu = document.createElement("div");
  menu.id = "toolbarSlotContextMenu";
  menu.className = "toolbar-slot-ctx-menu is-archive-picker-menu";
  menu.dataset.menuType = "archive-picker";
  menu.dataset.slotIndex = String(idx);
  menu.setAttribute("role", "menu");
  const openedAt = Date.now();

  let listItemsHtml = "";
  if (!archivedHs.length) {
    listItemsHtml = `<div class="toolbar-slot-ctx-empty">${safeEscapeHtml(emptyText)}</div>`;
  } else {
    listItemsHtml = archivedHs.map((h) => {
      const netType = String(h.network_type || "bm").toLowerCase();
      const shortNet = getToolbarShortNetCode(netType);
      const hsTitle = String(h.name || "").trim() || String(h.callsign || "").trim() || defaultHsName;
      const rawCall = window.localizeDemoText ? window.localizeDemoText(h.callsign || "") : (h.callsign || "");
      const subText = (rawCall && rawCall !== hsTitle) ? rawCall : "";
      return `<button type="button" class="toolbar-slot-ctx-item" role="menuitem" data-hs-id="${safeEscapeHtml(String(h.id))}"><span class="toolbar-slot-ctx-net-pill">${safeEscapeHtml(shortNet)}</span><span class="toolbar-slot-ctx-item-text"><span class="ctx-item-label">${safeEscapeHtml(hsTitle)}</span>${subText ? `<span class="toolbar-slot-ctx-item-sub">${safeEscapeHtml(subText)}</span>` : ""}</span></button>`;
    }).join("");
  }

  menu.innerHTML = `<div class="toolbar-slot-ctx-header">${safeEscapeHtml(headerText)}</div><div class="toolbar-slot-ctx-list">${listItemsHtml}</div>`;
  document.body.appendChild(menu);

  const listEl = menu.querySelector(".toolbar-slot-ctx-list");
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  if (isMobile) {
    const toolbarEl = document.getElementById("proxdmrTopToolbar");
    const toolbarBottom = toolbarEl ? toolbarEl.getBoundingClientRect().bottom : 42;
    const targetTop = Math.max(12, Math.round(toolbarBottom + 38));
    if (listEl) {
      const availListH = Math.max(120, window.innerHeight - targetTop - 72);
      listEl.style.maxHeight = `${availListH}px`;
    }
    const menuRect = menu.getBoundingClientRect();
    const clampedTop = Math.max(12, Math.min(targetTop, window.innerHeight - menuRect.height - 12));
    menu.classList.add("is-mobile-pos");
    menu.style.left = "50%";
    menu.style.top = `${clampedTop}px`;
  } else {
    const btnRect = btn.getBoundingClientRect();
    const rawLeft = Math.round(btnRect.left + 30);
    const rawTop = Math.round(btnRect.top + 20);
    if (listEl) {
      const availListH = Math.max(140, window.innerHeight - rawTop - 72);
      listEl.style.maxHeight = `${availListH}px`;
    }
    const menuRect = menu.getBoundingClientRect();
    const clampedLeft = Math.max(8, Math.min(rawLeft, window.innerWidth - menuRect.width - 8));
    const clampedTop = Math.max(8, Math.min(rawTop, window.innerHeight - menuRect.height - 8));
    menu.style.left = `${clampedLeft}px`;
    menu.style.top = `${clampedTop}px`;
  }

  menu.addEventListener("click", async (e) => {
    const itemBtn = e.target && typeof e.target.closest === "function" ? e.target.closest(".toolbar-slot-ctx-item") : null;
    if (!itemBtn) return;
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - openedAt < 180) return;
    const hsId = itemBtn.dataset.hsId;
    closeToolbarSlotContextMenu();
    if (hsId) {
      await toggleHotspotArchiveState(hsId, false);
    }
  });

  const onDocPointerDown = (e) => {
    if (!menu.contains(e.target)) {
      if (btn.contains(e.target) && typeof window !== "undefined") {
        window._toolbarLastClosedArchiveSlot = { idx, at: Date.now() };
      }
      closeToolbarSlotContextMenu();
    }
  };
  const onDocKeyDown = (e) => {
    if (e.key === "Escape") {
      closeToolbarSlotContextMenu();
    }
  };
  const onWinResize = () => {
    closeToolbarSlotContextMenu();
  };

  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeyDown, true);
  window.addEventListener("resize", onWinResize);
  window._toolbarSlotCtxCleanup = () => {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeyDown, true);
    window.removeEventListener("resize", onWinResize);
  };
}

function wireToolbarSlotInteractions(btn) {
  if (!btn || btn._toolbarSlotWired) return;
  btn._toolbarSlotWired = true;

  const DRAG_ARM_HOLD_MS = 250;
  const LONG_PRESS_HOLD_MS = 1250;
  const PRE_ARM_ABORT_PX = 14;
  const DRAG_MOVE_START_PX = 5;

  let holdTimer = null;
  let dragArmTimer = null;
  let blinkResetTimer = null;
  let dragArmed = false;
  let didLongPress = false;
  let pointerActive = false;
  let activePointerId = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let dragOriginX = 0;
  let dragOriginY = 0;
  let suppressClickUntil = 0;

  const clearArmVisuals = () => {
    if (blinkResetTimer) {
      clearTimeout(blinkResetTimer);
      blinkResetTimer = null;
    }
    btn.classList.remove("is-slot-drag-armed", "is-slot-drag-armed-blink");
  };

  const cancelDragArm = () => {
    if (dragArmTimer) {
      clearTimeout(dragArmTimer);
      dragArmTimer = null;
    }
    dragArmed = false;
    clearArmVisuals();
  };

  const cancelLongPressOnly = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  const cancelHold = () => {
    cancelLongPressOnly();
    cancelDragArm();
  };

  const getActiveListAndDisplay = () => {
    const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length)
      ? window.currentHotspots
      : (Array.isArray(currentHotspots) ? currentHotspots : []);
    const displayHotspots = allHs.filter(h => !h.hidden).slice(0, 7);
    return { allHs, displayHotspots };
  };

  const getSlotHotspot = () => {
    const idx = parseInt(btn.dataset.slotIndex || "0", 10);
    const { displayHotspots } = getActiveListAndDisplay();
    return { idx, hs: displayHotspots[idx] || null };
  };

  const cleanupSlotDrag = (shouldCommit) => {
    const st = _toolbarSlotDragState;
    if (!st) return;
    _toolbarSlotDragState = null;

    document.body.classList.remove("is-toolbar-slot-dragging");
    if (st.btn) {
      st.btn.classList.remove("is-slot-drag-source", "is-slot-drag-armed", "is-slot-drag-armed-blink");
      try {
        if (st.btn.hasPointerCapture && st.btn.hasPointerCapture(st.pointerId)) {
          st.btn.releasePointerCapture(st.pointerId);
        }
      } catch (_) {}
    }
    if (st.avatar && st.avatar.parentNode) {
      st.avatar.remove();
    }
    if (Array.isArray(st.occupiedBtns)) {
      st.occupiedBtns.forEach((slotEl) => {
        slotEl.style.transform = "";
      });
    }

    if (shouldCommit && st.targetIdx !== st.origIdx) {
      const { allHs, displayHotspots } = getActiveListAndDisplay();
      const visibleIds = displayHotspots.map(h => h.id);
      if (st.origIdx >= 0 && st.origIdx < visibleIds.length && st.targetIdx >= 0 && st.targetIdx < visibleIds.length) {
        const [movedId] = visibleIds.splice(st.origIdx, 1);
        visibleIds.splice(st.targetIdx, 0, movedId);

        const queue = visibleIds.slice();
        const fullOrder = [];
        allHs.forEach((h) => {
          if (h.hidden) {
            fullOrder.push(h.id);
          } else if (queue.length > 0) {
            fullOrder.push(queue.shift());
          }
        });
        while (queue.length > 0) {
          fullOrder.push(queue.shift());
        }
        reorderHotspots(fullOrder);
      }
    }
  };

  const applyDragPreviewTransforms = (st) => {
    const { occupiedBtns, rects, origIdx, targetIdx } = st;
    for (let i = 0; i < occupiedBtns.length; i++) {
      const el = occupiedBtns[i];
      if (!el || !rects[i]) continue;
      if (i === origIdx) {
        el.style.transform = "";
        continue;
      }
      let shiftedIdx = i;
      if (origIdx < targetIdx && i > origIdx && i <= targetIdx) {
        shiftedIdx = i - 1;
      } else if (origIdx > targetIdx && i >= targetIdx && i < origIdx) {
        shiftedIdx = i + 1;
      }
      const dx = (rects[shiftedIdx] ? rects[shiftedIdx].left : rects[i].left) - rects[i].left;
      el.style.transform = dx !== 0 ? `translateX(${dx}px)` : "";
    }
  };

  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (_toolbarSlotDragState) return;
    const { idx, hs } = getSlotHotspot();
    if (!hs) return;
    didLongPress = false;
    pointerActive = true;
    activePointerId = e.pointerId;
    cancelHold();
    startX = e.clientX || 0;
    startY = e.clientY || 0;
    lastX = startX;
    lastY = startY;
    dragOriginX = startX;
    dragOriginY = startY;

    const cid = resolveHotspotId(hs.id);
    const isCollapsed = Boolean(isHotspotCollapsed(cid));

    dragArmTimer = setTimeout(() => {
      dragArmTimer = null;
      if (!pointerActive || didLongPress || _toolbarSlotDragState) return;
      const container = document.getElementById("toolbarMiddleCluster");
      const occupiedBtns = container ? Array.from(container.querySelectorAll(".toolbar-hs-slot:not(.is-empty)")) : [];
      if (occupiedBtns.length < 2 || !occupiedBtns.includes(btn)) return;

      dragArmed = true;
      dragOriginX = lastX;
      dragOriginY = lastY;
      btn.classList.add("is-slot-drag-armed");
      btn.classList.remove("is-slot-drag-armed-blink");
      void btn.offsetWidth;
      btn.classList.add("is-slot-drag-armed-blink");
      blinkResetTimer = setTimeout(() => {
        blinkResetTimer = null;
        btn.classList.remove("is-slot-drag-armed-blink");
      }, 320);
      try {
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(15);
        }
      } catch (_) {}
    }, DRAG_ARM_HOLD_MS);

    holdTimer = setTimeout(() => {
      holdTimer = null;
      cancelDragArm();
      if (_toolbarSlotDragState) return;
      didLongPress = true;
      pointerActive = false;
      suppressClickUntil = Date.now() + 650;
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("pointerup", () => {
          setTimeout(() => { didLongPress = false; }, 650);
        }, { once: true });
      }
      try {
        if (typeof showLongPressEffect === "function") {
          const r = btn.getBoundingClientRect();
          showLongPressEffect(r.left + r.width / 2, r.top + r.height / 2);
        } else if (navigator.vibrate) {
          navigator.vibrate(40);
        }
      } catch (_) {}
      openToolbarSlotContextMenu(btn, hs, idx);
    }, LONG_PRESS_HOLD_MS);
  });

  btn.addEventListener("pointermove", (e) => {
    if (!pointerActive || e.pointerId !== activePointerId) return;
    const curX = e.clientX || 0;
    const curY = e.clientY || 0;
    lastX = curX;
    lastY = curY;

    if (!_toolbarSlotDragState) {
      if (!dragArmed) {
        if (Math.hypot(curX - startX, curY - startY) > PRE_ARM_ABORT_PX) {
          cancelHold();
          pointerActive = false;
          suppressClickUntil = Date.now() + 250;
        }
        return;
      }

      const postArmDx = curX - dragOriginX;
      const postArmDy = curY - dragOriginY;
      if (Math.hypot(postArmDx, postArmDy) < DRAG_MOVE_START_PX) return;

      cancelLongPressOnly();
      if (didLongPress) return;

      const container = document.getElementById("toolbarMiddleCluster");
      const occupiedBtns = container ? Array.from(container.querySelectorAll(".toolbar-hs-slot:not(.is-empty)")) : [];
      const origIdx = occupiedBtns.indexOf(btn);
      if (occupiedBtns.length < 2 || origIdx < 0) return;

      cancelDragArm();

      const rects = occupiedBtns.map(el => el.getBoundingClientRect());
      const startRect = rects[origIdx];
      const avatar = btn.cloneNode(true);
      avatar.classList.remove("is-slot-drag-source", "is-slot-drag-armed", "is-slot-drag-armed-blink");
      avatar.classList.add("toolbar-slot-drag-avatar");
      avatar.style.left = `${startRect.left}px`;
      avatar.style.top = `${startRect.top}px`;
      avatar.style.width = `${startRect.width}px`;
      avatar.style.height = `${startRect.height}px`;
      document.body.appendChild(avatar);

      document.body.classList.add("is-toolbar-slot-dragging");
      btn.classList.add("is-slot-drag-source");
      try {
        if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
      } catch (_) {}

      _toolbarSlotDragState = {
        btn,
        pointerId: e.pointerId,
        occupiedBtns,
        rects,
        origIdx,
        targetIdx: origIdx,
        dragOriginX,
        dragOriginY,
        startCenterX: startRect.left + startRect.width / 2,
        avatar
      };
    }

    const st = _toolbarSlotDragState;
    if (!st || st.btn !== btn || st.pointerId !== e.pointerId) return;
    if (e.cancelable) e.preventDefault();

    const dragDx = curX - st.dragOriginX;
    const dragDy = curY - st.dragOriginY;
    const clampedDy = Math.max(-14, Math.min(14, dragDy * 0.35));
    st.avatar.style.transform = `translate3d(${dragDx}px, ${clampedDy}px, 0) scale(1.06)`;

    const dragCenterX = st.startCenterX + dragDx;
    let bestIdx = st.origIdx;
    let bestDist = Infinity;
    for (let i = 0; i < st.rects.length; i++) {
      const cx = (st.rects[i].left + st.rects[i].right) / 2;
      const dist = Math.abs(dragCenterX - cx);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx !== st.targetIdx) {
      st.targetIdx = bestIdx;
      applyDragPreviewTransforms(st);
    }
  });

  btn.addEventListener("pointerup", (e) => {
    if (e.pointerId !== activePointerId && _toolbarSlotDragState?.pointerId !== e.pointerId) {
      cancelHold();
      return;
    }
    const wasArmedWithoutDrag = Boolean(dragArmed && !_toolbarSlotDragState && !didLongPress);
    cancelHold();
    pointerActive = false;

    if (_toolbarSlotDragState && _toolbarSlotDragState.btn === btn) {
      suppressClickUntil = Date.now() + 400;
      e.preventDefault();
      e.stopPropagation();
      cleanupSlotDrag(true);
      return;
    }

    if (wasArmedWithoutDrag) {
      suppressClickUntil = Date.now() + 300;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (didLongPress) {
      suppressClickUntil = Date.now() + 650;
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => { didLongPress = false; }, 650);
    }
  });

  btn.addEventListener("pointercancel", () => {
    cancelHold();
    pointerActive = false;
    didLongPress = false;
    if (_toolbarSlotDragState && _toolbarSlotDragState.btn === btn) {
      suppressClickUntil = Date.now() + 300;
      cleanupSlotDrag(false);
    }
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() < suppressClickUntil) return;
    if (didLongPress) {
      didLongPress = false;
      return;
    }
    const { idx, hs } = getSlotHotspot();
    if (!hs) {
      openToolbarEmptySlotArchiveMenu(btn, idx);
      return;
    }
    const cid = resolveHotspotId(hs.id);
    if (isHotspotCollapsed(cid)) {
      if (typeof window.expandHotspot === "function") {
        window.expandHotspot(cid);
      }
    } else {
      if (typeof window.collapseHotspot === "function") {
        window.collapseHotspot(cid, { isLive: false });
      }
    }
  });

  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

export function renderToolbarHotspotSlots() {
  if (_toolbarSlotDragState) return;
  const container = document.getElementById("toolbarMiddleCluster");
  if (!container) return;
  const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length)
    ? window.currentHotspots
    : (Array.isArray(currentHotspots) && currentHotspots.length ? currentHotspots : []);
  const displayHotspots = allHs.filter(h => !h.hidden).slice(0, 7);
  const slotEntries = resolveToolbarSlotLabels(displayHotspots);
  const netClasses = ["net-type-bm", "net-type-tgif", "net-type-freedmr", "net-type-adn", "net-type-ysf", "net-type-m17", "net-type-dstar", "net-type-svx", "net-type-dmrplus", "net-type-xlx", "net-type-allstar", "net-type-custom"];
  const isLightTheme = document.documentElement.getAttribute("data-theme") === "light" || document.body.getAttribute("data-theme") === "light";
  const brandColorsOn = isNetworkColorEnabled();

  let anyLiveWithProcesses = false;

  container.querySelectorAll(".toolbar-hs-slot").forEach((btn) => {
    wireToolbarSlotInteractions(btn);
    const idx = parseInt(btn.dataset.slotIndex || "0", 10);
    const hs = displayHotspots[idx] || null;
    btn.classList.remove(...netClasses, "is-empty", "is-expanded", "is-collapsed", "is-live-collapsed", "has-rx-dot", "has-rx-green-dot", "has-tr-dot", "is-proc-showing", "proc-mode-transcribe", "proc-mode-tts-upload", "proc-mode-bm-upload");
    btn.style.removeProperty("--slot-brand-accent");
    btn.style.removeProperty("--slot-brand-border");
    btn.style.removeProperty("--slot-brand-solid");
    btn.style.removeProperty("--slot-brand-glow");

    if (!hs) {
      btn.classList.add("is-empty");
      btn.dataset.hotspotId = "";
      btn.innerHTML = `<span class="slot-empty-dot" aria-hidden="true"></span>`;
      const emptyTip = window.t ? window.t("toolbar.slot_empty_title", { num: idx + 1 }, `Свободный слот #${idx + 1} (клик: выбрать из архива)`) : `Свободный слот #${idx + 1} (клик: выбрать из архива)`;
      btn.title = emptyTip;
      btn.setAttribute("aria-label", emptyTip);
      return;
    }

    const netType = String(hs.network_type || "bm").toLowerCase();
    const shortNet = getToolbarShortNetCode(netType);
    const normNetClass = netClasses.includes(`net-type-${netType}`) ? `net-type-${netType}` : "net-type-bm";
    const isCollapsed = Boolean(isHotspotCollapsed(hs.id));
    const isLive = Boolean(isCollapsed && isHotspotLiveCollapsed(hs.id));

    btn.classList.add(normNetClass);
    btn.dataset.hotspotId = hs.id;
    if (brandColorsOn) {
      const slotAccent = getNetworkBrandColor(netType, isLightTheme ? "light" : "dark");
      const [sr, sg, sb] = _hexToRgbTuple(slotAccent);
      btn.style.setProperty("--slot-brand-accent", slotAccent);
      btn.style.setProperty("--slot-brand-border", `rgba(${sr}, ${sg}, ${sb}, 0.78)`);
      btn.style.setProperty("--slot-brand-solid", slotAccent);
      btn.style.setProperty("--slot-brand-glow", `rgba(${sr}, ${sg}, ${sb}, 0.42)`);
    }

    if (!isCollapsed) {
      btn.classList.add("is-expanded");
    } else if (isLive) {
      btn.classList.add("is-live-collapsed");
      const procs = getToolbarSlotProcessList(hs);
      if (procs.length > 0) anyLiveWithProcesses = true;
    } else {
      btn.classList.add("is-collapsed");
    }

    const stateLabel = !isCollapsed
      ? (window.t ? window.t("toolbar.state_expanded", {}, "развернут (клик: свернуть, удержание: меню)") : "развернут (клик: свернуть, удержание: меню)")
      : (isLive
          ? (window.t ? window.t("toolbar.state_live_collapsed", {}, "активен в фоне (клик: развернуть, удержание: меню)") : "активен в фоне (клик: развернуть, удержание: меню)")
          : (window.t ? window.t("toolbar.state_collapsed", {}, "свернут / отключен (клик: развернуть, удержание: меню)") : "свернут / отключен (клик: развернуть, удержание: меню)"));

    const slotEntry = slotEntries[idx] || { label: formatToolbarSlotName(hs, idx, displayHotspots), isUnnamed: !extractCleanToolbarHsName(hs) };
    const slotLabel = slotEntry.label;
    const hsName = slotEntry.isUnnamed ? slotLabel : (String(hs.name || "").trim() || slotLabel);
    const longCls = slotLabel.length >= 5 ? " is-name-long" : "";
    const fullTip = `#${idx + 1} ${hsName} [${shortNet}] — ${stateLabel}`;
    btn.title = fullTip;
    btn.setAttribute("aria-label", fullTip);

    btn.innerHTML = `<svg class="slot-live-border" aria-hidden="true" focusable="false"><rect x="1.25" y="1.25" width="43.5" height="27.5" rx="0" ry="0" /></svg><span class="slot-name${longCls}">${safeEscapeHtml(slotLabel)}</span><span class="slot-corner-indicators" aria-hidden="true"><span class="slot-tr-dot">T</span><span class="slot-rx-dot"></span></span><span class="slot-proc-badge" aria-hidden="true"></span>`;
    applySlotCycleDisplay(btn, hs, idx);
    fitToolbarSlotNameFont(btn);
  });

  ensureToolbarSlotFontFitObservers(container);
  scheduleFitAllToolbarSlotNames();
  syncToolbarCycleTimer(anyLiveWithProcesses);
}

export async function toggleHotspotArchiveState(hsId, makeHidden) {
  const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length)
    ? window.currentHotspots
    : (Array.isArray(currentHotspots) ? currentHotspots : []);
  const existing = allHs.find(h => h.id === hsId);
  if (!existing) return false;

  if (!makeHidden) {
    const activeCount = allHs.filter(h => !h.hidden && h.id !== hsId).length;
    if (activeCount >= 7) {
      const max7Msg = window.t
        ? window.t("hotspots.max_active_7", {}, "Максимум 7 активных хотспотов на панели. Сначала отправьте один из них в архив")
        : "Максимум 7 активных хотспотов на панели. Сначала отправьте один из них в архив";
      showToast(max7Msg, "warning", 4000);
      return false;
    }
  }

  const cid = resolveHotspotId(existing.id);
  const hsName = existing.name || existing.callsign || cid;

  if (makeHidden) {
    if (typeof disableHotspotTranscribe === "function") {
      disableHotspotTranscribe(existing.id, true);
    }
    if (typeof setHotspotAudioMute === "function") {
      setHotspotAudioMute(existing.id, true);
    }
    const ap = typeof getAudioPlayer === "function" ? getAudioPlayer() : (window.audioPlayer || null);
    if (ap && ap.resetHotspot) {
      ap.resetHotspot(existing.id);
    }
    if (typeof window !== "undefined" && typeof window.closeLogIfOpenForHotspot === "function") {
      window.closeLogIfOpenForHotspot(existing.id, { skipRefreshIfKeptOpen: true });
    }
  } else {
    try {
      localStorage.setItem(`proxdmr_collapsed_${cid}`, "false");
      localStorage.setItem(`proxdmr_live_collapsed_${cid}`, "false");
    } catch (_) {}
  }

  const payload = {
    ...existing,
    hidden: Boolean(makeHidden),
    collapsed: makeHidden ? true : false
  };
  const reconnectFlag = !makeHidden && (existing.autoconnect !== false);

  try {
    const resp = await fetch(`/api/hotspots/${encodeURIComponent(existing.id)}?reconnect=${reconnectFlag ? "true" : "false"}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.detail || resp.statusText);
    }
    existing.hidden = Boolean(makeHidden);
    existing.collapsed = Boolean(makeHidden);
    if (!makeHidden) {
      existing.isLiveCollapsed = false;
      existing.isManualBmDisconnect = false;
      setActiveHotspotId(existing.id);
      const activeIdsOrder = allHs.filter(h => !h.hidden && h.id !== existing.id).map(h => h.id);
      const archivedIdsOrder = allHs.filter(h => Boolean(h.hidden) && h.id !== existing.id).map(h => h.id);
      const restoredOrder = [...activeIdsOrder, existing.id, ...archivedIdsOrder];
      await fetch("/api/hotspots/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: restoredOrder })
      }).catch(() => {});
    }

    const msg = makeHidden
      ? (window.t ? window.t("hotspots.hs_archived_toast", { name: hsName }, `Хотспот «${hsName}» отправлен в архив`) : `Хотспот «${hsName}» отправлен в архив`)
      : (window.t ? window.t("archive.unarchived_toast", { name: hsName }, `Хотспот «${hsName}» возвращен на панель`) : `Хотспот «${hsName}» возвращен на панель`);
    showToast(msg, "info", 2800);

    await loadHotspots();
    renderHotspotArchiveModal();
    return true;
  } catch (err) {
    console.error("[HOTSPOTS] Archive toggle failed:", err);
    showToast((err && err.message) || (window.t ? window.t("archive.update_status_err", {}, "Failed to update archive status") : "Failed to update archive status"), "error", 3500);
    return false;
  }
}

export function renderHotspotArchiveModal() {
  const listEl = document.getElementById("hsArchiveModalList");
  if (!listEl) return;
  const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length)
    ? window.currentHotspots
    : (Array.isArray(currentHotspots) ? currentHotspots : []);
  const activeHs = allHs.filter(h => !h.hidden);
  const archivedHs = allHs.filter(h => Boolean(h.hidden));

  listEl.innerHTML = "";

  const appendSection = (titleText, items, isArchivedGroup) => {
    const hdr = document.createElement("div");
    hdr.className = "hs-archive-section-hdr";
    hdr.innerHTML = `<span>${safeEscapeHtml(titleText)}</span><span>${items.length}${isArchivedGroup ? "" : " / 7"}</span>`;
    listEl.appendChild(hdr);

    if (!items.length) {
      const emptyRow = document.createElement("div");
      emptyRow.style.fontSize = "0.8rem";
      emptyRow.style.color = "var(--text-muted, #8b949e)";
      emptyRow.style.padding = "4px 2px";
      emptyRow.textContent = isArchivedGroup
        ? (window.t ? window.t("archive.no_archived", {}, "В архиве пока нет хотспотов") : "В архиве пока нет хотспотов")
        : (window.t ? window.t("archive.no_active", {}, "Нет активных хотспотов на панели") : "Нет активных хотспотов на панели");
      listEl.appendChild(emptyRow);
      return;
    }

    const moveArchiveItemInGroup = async (itemHsId, dir) => {
      const groupIds = items.map(h => h.id);
      const pos = groupIds.indexOf(itemHsId);
      const nextPos = pos + dir;
      if (pos < 0 || nextPos < 0 || nextPos >= groupIds.length) return;
      const tmp = groupIds[pos];
      groupIds[pos] = groupIds[nextPos];
      groupIds[nextPos] = tmp;

      const queue = groupIds.slice();
      const fullOrder = allHs.map((h) => {
        const belongsToGroup = isArchivedGroup ? Boolean(h.hidden) : !h.hidden;
        if (belongsToGroup && queue.length > 0) {
          return queue.shift();
        }
        return h.id;
      });
      await reorderHotspots(fullOrder);
      renderHotspotArchiveModal();
    };

    items.forEach((hs, idx) => {
      const netType = String(hs.network_type || "bm").toLowerCase();
      const shortNet = getToolbarShortNetCode(netType);
      const isCol = !hs.hidden && isHotspotCollapsed(hs.id);
      const isLive = isCol && isHotspotLiveCollapsed(hs.id);
      const statusTxt = hs.hidden
        ? (window.t ? window.t("archive.status_archived", {}, "Archived") : "Archived")
        : (isLive
            ? (window.t ? window.t("hotspots.badge_collapsed_bg", {}, "Collapsed (background)") : "Collapsed (background)")
            : (isCol
                ? (window.t ? window.t("hotspots.badge_collapsed", {}, "Collapsed") : "Collapsed")
                : (hs.status === "ONLINE" ? "ONLINE" : (hs.status || "OFFLINE"))));

      const row = document.createElement("div");
      row.className = `hs-archive-row${hs.hidden ? " is-archived" : ""}`;
      const callInfo = (window.localizeDemoText ? window.localizeDemoText(hs.callsign || "") : (hs.callsign || "")) || "N0CALL";
      const ssidInfo = (hs.bm_ssid !== undefined && hs.bm_ssid !== null && netType !== "allstar" && netType !== "ysf") ? ` · SSID ${hs.bm_ssid}` : "";
      const isFirstItem = idx === 0;
      const isLastItem = idx === items.length - 1;
      const upTitle = safeEscapeHtml(window.t ? window.t("hotspots.move_up", {}, "Up") : "Up");
      const downTitle = safeEscapeHtml(window.t ? window.t("hotspots.move_down", {}, "Down") : "Down");
      const hsDefaultName = window.t ? window.t("hotspots.default_name", {}, "Hotspot") : "Hotspot";
      const orderButtonsHtml = items.length > 1
        ? `<button type="button" class="hs-archive-btn-move hs-archive-btn-up" title="${upTitle}" ${isFirstItem ? "disabled" : ""}>▲</button><button type="button" class="hs-archive-btn-move hs-archive-btn-down" title="${downTitle}" ${isLastItem ? "disabled" : ""}>▼</button>`
        : "";

      row.innerHTML = `
        <div class="hs-archive-row-left">
          <span class="hs-archive-slot-idx">${hs.hidden ? "📦" : `#${idx + 1}`}</span>
          <div class="hs-archive-row-info">
            <div class="hs-archive-row-name">
              <span class="hotspot-network-badge net-type-${safeEscapeHtml(netType)}" style="font-size: 0.66rem; padding: 1px 5px;">${safeEscapeHtml(shortNet)}</span>
              <span>${safeEscapeHtml(hs.name || hsDefaultName)}</span>
            </div>
            <div class="hs-archive-row-meta">${safeEscapeHtml(callInfo)}${ssidInfo} · ${safeEscapeHtml(statusTxt)}</div>
          </div>
        </div>
        <div class="hs-archive-row-actions">
          ${orderButtonsHtml}
          <button type="button" class="hs-archive-btn-settings" title="${safeEscapeHtml(window.t ? window.t("buttons.edit", {}, "Settings") : "Settings")}">⚙️</button>
          <button type="button" class="hs-archive-btn-toggle ${hs.hidden ? "from-archive" : "to-archive"}">
            ${hs.hidden
              ? (window.t ? window.t("archive.btn_restore", {}, "На панель") : "На панель")
              : (window.t ? window.t("hotspots.btn_to_archive", {}, "В архив") : "В архив")}
          </button>
        </div>
      `;

      const upBtn = row.querySelector(".hs-archive-btn-up");
      if (upBtn && !isFirstItem) {
        upBtn.onclick = () => moveArchiveItemInGroup(hs.id, -1);
      }
      const downBtn = row.querySelector(".hs-archive-btn-down");
      if (downBtn && !isLastItem) {
        downBtn.onclick = () => moveArchiveItemInGroup(hs.id, 1);
      }
      const setBtn = row.querySelector(".hs-archive-btn-settings");
      if (setBtn) {
        setBtn.onclick = () => {
          closeHotspotArchiveModal();
          openHotspotSettings(hs, "tab-edit-hs");
        };
      }
      const toggleBtn = row.querySelector(".hs-archive-btn-toggle");
      if (toggleBtn) {
        toggleBtn.onclick = async () => {
          toggleBtn.disabled = true;
          await toggleHotspotArchiveState(hs.id, !hs.hidden);
          toggleBtn.disabled = false;
        };
      }
      listEl.appendChild(row);
    });
  };

  appendSection(window.t ? window.t("archive.section_active", {}, "Активные слоты панели") : "Активные слоты панели", activeHs, false);
  appendSection(window.t ? window.t("archive.section_archived", {}, "Архив хотспотов") : "Архив хотспотов", archivedHs, true);
}

export function openHotspotArchiveModal() {
  const modal = document.getElementById("hotspotArchiveModal");
  if (!modal) return;
  renderHotspotArchiveModal();
  modal.style.display = "flex";
  modal.classList.add("active");
  if (typeof pushNavState === "function") {
    pushNavState("modal", "hotspotArchiveModal");
  }
}

export function closeHotspotArchiveModal() {
  const modal = document.getElementById("hotspotArchiveModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.classList.remove("active");
  if (typeof notifyNavClosed === "function") {
    notifyNavClosed("modal", "hotspotArchiveModal");
  }
}

function initTopToolbarAndArchiveUI() {
  ensureTopToolbarControls();
  renderToolbarHotspotSlots();

  const btnOpenArch = document.getElementById("btnOpenHotspotArchiveModal");
  if (btnOpenArch && !btnOpenArch._wired) {
    btnOpenArch._wired = true;
    btnOpenArch.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openHotspotArchiveModal();
    });
  }

  const btnEmptyOpen = document.getElementById("btnEmptyArchiveOpen");
  if (btnEmptyOpen && !btnEmptyOpen._wired) {
    btnEmptyOpen._wired = true;
    btnEmptyOpen.addEventListener("click", () => {
      openHotspotArchiveModal();
    });
  }

  const btnCloseArch = document.getElementById("closeHotspotArchiveModalBtn");
  if (btnCloseArch && !btnCloseArch._wired) {
    btnCloseArch._wired = true;
    btnCloseArch.addEventListener("click", () => closeHotspotArchiveModal());
  }

  const btnCloseFooter = document.getElementById("btnCloseHotspotArchiveFooter");
  if (btnCloseFooter && !btnCloseFooter._wired) {
    btnCloseFooter._wired = true;
    btnCloseFooter.addEventListener("click", () => closeHotspotArchiveModal());
  }

  const archModal = document.getElementById("hotspotArchiveModal");
  if (archModal && !archModal._backdropWired) {
    archModal._backdropWired = true;
    archModal.addEventListener("click", (e) => {
      if (e.target === archModal) {
        closeHotspotArchiveModal();
      }
    });
  }

  const btnArchAdd = document.getElementById("btnArchiveAddHotspot");
  if (btnArchAdd && !btnArchAdd._wired) {
    btnArchAdd._wired = true;
    btnArchAdd.addEventListener("click", () => {
      closeHotspotArchiveModal();
      openHotspotSettings(null, "tab-edit-hs");
      openHsTypeSelectModal();
    });
  }

  ensureDesktopHotspotsAlignmentObserver();
}

export function initHotspotsManager() {
  initTopToolbarAndArchiveUI();
  const headerHotspotSelect = document.getElementById("headerHotspotSelect");
  if (headerHotspotSelect && !headerHotspotSelect._wired) {
    headerHotspotSelect._wired = true;
    headerHotspotSelect.addEventListener("change", async () => {
      const newId = headerHotspotSelect.value;
      switchActiveHotspot(newId);
    });
  }

  const editHsMasterSelect = document.getElementById("editHsMasterSelect");
  const editHsHost = document.getElementById("editHsHost");
  const editHsId = document.getElementById("editHsId");

  if (editHsMasterSelect && !editHsMasterSelect._wired) {
    editHsMasterSelect._wired = true;
    editHsMasterSelect.addEventListener("change", () => {
      const val = editHsMasterSelect.value;
      if (val === "__TEST_SERVERS__") {
        const cur = (editHsHost ? editHsHost.value : "").trim().toLowerCase();
        const hsId = (editHsId && editHsId.value) ? editHsId.value : (window.activeHotspotId || "default");
        const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
        const curHs = curHsList.find(h => h && String(h.id) === String(hsId));
        const editHsNetworkType = document.getElementById("editHsNetworkType");
        const curNet = ((editHsNetworkType && editHsNetworkType.value) || editHsMasterSelect.dataset.networkType || (curHs && curHs.network_type) || "bm").trim().toLowerCase();
        const list = (window._dmrServersCache && window._dmrServersCache[curNet])
          ? window._dmrServersCache[curNet]
          : (curNet === "bm" ? bmMastersList : getNetworkServersList(curNet, bmMastersList));
        const found = (list || []).find(m => m && ((m.host && m.host.toLowerCase() === cur) || m.ip === cur));
        editHsMasterSelect.value = found ? found.host : (cur ? "CUSTOM" : "");
        if (typeof openBmBenchmarkModal === "function") {
          openBmBenchmarkModal(hsId, curNet);
        }
        return;
      }
      if (val && val !== "CUSTOM") {
        if (editHsHost) editHsHost.value = val;
        const selOpt = editHsMasterSelect.selectedOptions && editHsMasterSelect.selectedOptions[0];
        if (selOpt) {
          if (selOpt.dataset.dead === "1") {
            if (typeof showToast === "function") {
              showToast(window.t ? window.t("server_probe.warn_dead_selected", {}, "⚠️ Сервер не ответил при тестировании сетей") : "⚠️ Сервер не ответил при тестировании сетей", "warning");
            }
          }
          const editHsPort = document.getElementById("editHsPort");
          if (editHsPort && selOpt.dataset.port) {
            editHsPort.value = selOpt.dataset.port;
          }
          const editHsPassword = document.getElementById("editHsPassword");
          if (editHsPassword && selOpt.dataset.password) {
            const curPass = (editHsPassword.value || "").trim();
            if (!curPass || curPass === "passw0rd" || curPass === "PASSWORD") {
              editHsPassword.value = selOpt.dataset.password;
            }
          }
        }
      } else if (val === "CUSTOM") {
        if (editHsHost) editHsHost.focus();
      }
    });
  }

  if (editHsHost && !editHsHost._wired) {
    editHsHost._wired = true;
    editHsHost.addEventListener("input", () => {
      if (!editHsMasterSelect) return;
      const hostVal = editHsHost.value.trim().toLowerCase();
      const editHsNetworkType = document.getElementById("editHsNetworkType");
      const curNet = (editHsNetworkType ? editHsNetworkType.value : "bm") || "bm";
      const list = curNet === "bm" ? bmMastersList : getNetworkServersList(curNet, bmMastersList);
      const found = (list || []).find(m => m && ((m.host && m.host.toLowerCase() === hostVal) || m.ip === hostVal));
      if (found) {
        editHsMasterSelect.value = found.host;
      } else {
        editHsMasterSelect.value = "CUSTOM";
      }
    });
  }

  const editHsNetworkType = document.getElementById("editHsNetworkType");
  if (editHsNetworkType && !editHsNetworkType._wired) {
    editHsNetworkType._wired = true;
    editHsNetworkType.addEventListener("change", () => {
      const newNet = (editHsNetworkType.value || "bm").toLowerCase();
      applyEditHsNetworkTypeUI(newNet, { applyDefaults: true });
      if (newNet === "freedmr") {
        refreshFreeDmrServers().then(() => {
          const editHsHost = document.getElementById("editHsHost");
          renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "freedmr");
        });
      } else if (newNet === "adn") {
        refreshAdnServers().then(() => {
          const editHsHost = document.getElementById("editHsHost");
          renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "adn");
        });
      } else if (newNet === "ysf") {
        refreshYsfServers().then(() => {
          const editHsHost = document.getElementById("editHsHost");
          renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "ysf");
        });
      } else if (newNet === "m17") {
        refreshM17Servers().then(() => {
          const editHsHost = document.getElementById("editHsHost");
          renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "m17");
        });
      } else if (newNet === "dstar") {
        refreshDstarServers().then(() => {
          const editHsHost = document.getElementById("editHsHost");
          renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "dstar");
        });
      } else if (newNet === "svx") {
        refreshSvxServers().then(() => {
          const editHsHost = document.getElementById("editHsHost");
          renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "svx");
        });
      }
    });
  }

  const editHsXlxModule = document.getElementById("editHsXlxModule");
  if (editHsXlxModule && !editHsXlxModule._wired) {
    editHsXlxModule._wired = true;
    editHsXlxModule.addEventListener("change", () => {
      const mod = (editHsXlxModule.value || "D").toUpperCase();
      const modCode = mod.charCodeAt(0);
      const modTg = 4000 + Math.max(1, Math.min(26, modCode - 64));
      const pillEl = document.getElementById("editHsNetworkTypePill");
      if (pillEl) {
        renderNetworkBadgeElement(pillEl, "xlx", { xlxModule: mod });
      }
      const existingPillEl = document.getElementById("editHsExistingNetPill");
      if (existingPillEl) {
        renderNetworkBadgeElement(existingPillEl, "xlx", { xlxModule: mod });
      }
      const existingDescEl = document.getElementById("editHsExistingNetDesc");
      if (existingDescEl) {
        existingDescEl.textContent = window.t
          ? window.t("hotspots.xlx_hs_net_desc", { mod, tg: modTg }, `🔒 HS Network • Module ${mod} (TG ${modTg} on TS2)`)
          : `🔒 HS Network • Module ${mod} (TG ${modTg} on TS2)`;
      }
    });
  }

  const editHsDmrPlusRef = document.getElementById("editHsDmrPlusRef");
  const editHsDmrPlusRelink = document.getElementById("editHsDmrPlusRelink");
  const syncDmrPlusRpto = () => {
    const editHsNetworkType = document.getElementById("editHsNetworkType");
    const curNet = (editHsNetworkType ? editHsNetworkType.value : "bm").toLowerCase();
    if (curNet !== "dmrplus") return;
    const editHsRptoOptions = document.getElementById("editHsRptoOptions");
    if (editHsRptoOptions) {
      editHsRptoOptions.value = buildRptoFromCurrentFormFields("dmrplus");
    }
  };
  if (editHsDmrPlusRef && !editHsDmrPlusRef._wired) {
    editHsDmrPlusRef._wired = true;
    editHsDmrPlusRef.addEventListener("input", syncDmrPlusRpto);
    editHsDmrPlusRef.addEventListener("change", syncDmrPlusRpto);
  }
  if (editHsDmrPlusRelink && !editHsDmrPlusRelink._wired) {
    editHsDmrPlusRelink._wired = true;
    editHsDmrPlusRelink.addEventListener("input", syncDmrPlusRpto);
    editHsDmrPlusRelink.addEventListener("change", syncDmrPlusRpto);
  }

  const btnBuildRptoFromTg = document.getElementById("btnBuildRptoFromTg");
  if (btnBuildRptoFromTg && !btnBuildRptoFromTg._wired) {
    btnBuildRptoFromTg._wired = true;
    btnBuildRptoFromTg.addEventListener("click", () => {
      const editHsRptoOptions = document.getElementById("editHsRptoOptions");
      if (!editHsRptoOptions) return;
      const built = buildRptoFromCurrentFormFields();
      if (built) {
        editHsRptoOptions.value = built;
        showToast(window.t ? window.t("hotspots.rpto_built_toast", { value: built }, `✅ Built RPTO string: ${built}`) : `✅ Built RPTO string: ${built}`, 2200);
      }
    });
  }

  const btnSendRptoNow = document.getElementById("btnSendRptoNow");
  if (btnSendRptoNow && !btnSendRptoNow._wired) {
    btnSendRptoNow._wired = true;
    btnSendRptoNow.addEventListener("click", async () => {
      const editHsId = document.getElementById("editHsId");
      const id = editHsId ? editHsId.value.trim() : "";
      if (!id || id === "__new__") {
        showToast(window.t ? window.t("hotspots.save_first_rpto", {}, "Сначала сохраните хотспот, чтобы отправить RPTO опции") : "Сначала сохраните хотспот, чтобы отправить RPTO опции", 2800);
        return;
      }
      const editHsRptoOptions = document.getElementById("editHsRptoOptions");
      const editHsXlxModule = document.getElementById("editHsXlxModule");
      const rptoVal = editHsRptoOptions ? editHsRptoOptions.value.trim() : "";
      const xlxVal = editHsXlxModule ? editHsXlxModule.value.trim().toUpperCase() : "D";
      btnSendRptoNow.disabled = true;
      try {
        const resp = await fetch(`/api/hotspots/${encodeURIComponent(id)}/rpto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rpto_options: rptoVal, xlx_module: xlxVal })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(data.detail || resp.statusText);
        }
        const curHs = (window.currentHotspots || []).find(h => h.id === id);
        if (curHs) {
          curHs.rpto_options = rptoVal;
          curHs.xlx_module = xlxVal;
          const card = document.querySelector(`.radio-container[data-hotspot-id="${id}"]`);
          if (card) renderHotspotAuxStatusBadge(card, curHs);
        }
        if (data.rpto_sent || data.sent_live) {
          showToast(window.t ? window.t("hotspots.rpto_sent_live", {}, "✅ Пакет RPTO отправлен на сервер и сохранен") : "✅ Пакет RPTO отправлен на сервер и сохранен", 2800);
        } else {
          showToast(window.t ? window.t("hotspots.rpto_saved_offline", {}, "✅ Опции RPTO сохранены (будут отправлены при подключении)") : "✅ Опции RPTO сохранены (будут отправлены при подключении)", 2800);
        }
      } catch (err) {
        showToast(window.t ? window.t("hotspots.rpto_send_error", { err: (err && err.message ? err.message : err) }, "❌ Ошибка отправки RPTO: " + (err && err.message ? err.message : err)) : "❌ Ошибка отправки RPTO: " + (err && err.message ? err.message : err), 3000);
      } finally {
        btnSendRptoNow.disabled = false;
      }
    });
  }

  const btnToggleHsPassword = document.getElementById("btnToggleHsPassword");
  const editHsPassword = document.getElementById("editHsPassword");
  const btnToggleHsApiKey = document.getElementById("btnToggleHsApiKey");
  const editHsApiKey = document.getElementById("editHsApiKey");
  const btnAddNewHotspot = document.getElementById("btnAddNewHotspot");
  if (btnAddNewHotspot && !btnAddNewHotspot._wired) {
    btnAddNewHotspot._wired = true;
    btnAddNewHotspot.addEventListener("click", (e) => {
      e.preventDefault();
      closeCustomHsDropdown();
      openHsTypeSelectModal();
    });
  }
  const btnBmApiHelp = document.getElementById("btnBmApiHelp");
  const btnCloseBmApiHelp = document.getElementById("btnCloseBmApiHelp");
  const bmApiHelpCard = document.getElementById("bmApiHelpCard");
  const editHsSsid = document.getElementById("editHsSsid");
  if (editHsSsid && !editHsSsid._wired) {
    editHsSsid._wired = true;
    editHsSsid.addEventListener("input", () => {
      if (editHsSsid.value === "") return;
      let val = parseInt(editHsSsid.value, 10);
      if (isNaN(val)) return;
      if (val < 1) editHsSsid.value = 1;
      else if (val > 99) editHsSsid.value = 99;
    });
    editHsSsid.addEventListener("blur", () => {
      let val = parseInt(editHsSsid.value, 10);
      if (isNaN(val) || val < 1) editHsSsid.value = 1;
      else if (val > 99) editHsSsid.value = 99;
    });
  }

  const editHsSendTalkerAlias = document.getElementById("editHsSendTalkerAlias");
  const editHsTalkerAlias = document.getElementById("editHsTalkerAlias");
  if (editHsSendTalkerAlias && !editHsSendTalkerAlias._wired) {
    editHsSendTalkerAlias._wired = true;
    editHsSendTalkerAlias.addEventListener("change", () => {
      const taInput = document.getElementById("editHsTalkerAlias");
      if (taInput) {
        taInput.style.opacity = editHsSendTalkerAlias.checked ? "1" : "0.5";
      }
    });
  }

  const editHsAutoconnect = document.getElementById("editHsAutoconnect");
  if (editHsAutoconnect && !editHsAutoconnect._wired) {
    editHsAutoconnect._wired = true;
    editHsAutoconnect.addEventListener("change", async () => {
      const editHsId = document.getElementById("editHsId");
      const id = editHsId ? editHsId.value.trim() : "";
      if (!id || id === "__new__") return;
      const newVal = editHsAutoconnect.checked;
      const target = (window.currentHotspots || []).find(h => h.id === id);
      if (target) target.autoconnect = newVal;
      try {
        await fetch(`/api/hotspots/${encodeURIComponent(id)}/autoconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: newVal })
        });
        showToast(newVal ? (window.t ? window.t("hotspots.autoconnect_on", {}, "✅ Автоподключение при старте включено") : "✅ Автоподключение при старте включено") : (window.t ? window.t("hotspots.autoconnect_off", {}, "⏸️ Автоподключение при старте отключено") : "⏸️ Автоподключение при старте отключено"), 2000);
      } catch (err) {
        console.error("Failed to toggle autoconnect:", err);
      }
    });
  }

  const editHsAutoTgBm = document.getElementById("editHsAutoTgBm");
  if (editHsAutoTgBm && !editHsAutoTgBm._wired) {
    editHsAutoTgBm._wired = true;
    editHsAutoTgBm.addEventListener("change", async () => {
      const editHsId = document.getElementById("editHsId");
      const id = editHsId ? editHsId.value.trim() : "";
      if (!id || id === "__new__") return;
      const newVal = editHsAutoTgBm.checked;
      const target = (window.currentHotspots || []).find(h => h.id === id);
      if (target) target.auto_tg_bm = newVal;
      try {
        await fetch(`/api/hotspots/${encodeURIComponent(id)}/auto-tg-bm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: newVal })
        });
        const hsNet = ((target && target.network_type) || "bm").toLowerCase();
        let netTag = "BM";
        let netKeyOn = "hotspots.auto_tg_bm_global_on";
        let netKeyOff = "hotspots.auto_tg_bm_global_off";
        if (hsNet === "tgif") {
          netTag = "TGIF";
          netKeyOn = "hotspots.auto_tg_tgif_global_on";
          netKeyOff = "hotspots.auto_tg_tgif_global_off";
        } else if (hsNet === "freedmr") {
          netTag = "FreeDMR";
          netKeyOn = "hotspots.auto_tg_freedmr_global_on";
          netKeyOff = "hotspots.auto_tg_freedmr_global_off";
        } else if (hsNet === "adn") {
          netTag = "ADN";
          netKeyOn = "hotspots.auto_tg_adn_global_on";
          netKeyOff = "hotspots.auto_tg_adn_global_off";
        } else if (hsNet === "xlx") {
          netTag = "XLX";
          netKeyOn = "hotspots.auto_tg_xlx_global_on";
          netKeyOff = "hotspots.auto_tg_xlx_global_off";
        }
        showToast(newVal 
          ? (window.t ? window.t(netKeyOn, {}, `✅ Автонастройка TG ${netTag} включена`) : `✅ Автонастройка TG ${netTag} включена`) 
          : (window.t ? window.t(netKeyOff, {}, `🔒 Автонастройка TG ${netTag} отключена`) : `🔒 Автонастройка TG ${netTag} отключена`), 2000);
      } catch (err) {
        console.error("Failed to toggle auto_tg_bm:", err);
      }
    });
  }

  const settingsBtn = document.getElementById("settingsBtn");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const tabButtons = document.querySelectorAll("#settingsModal .tab-btn");
  const tabContents = document.querySelectorAll("#settingsModal .tab-content");

  if (btnToggleHsPassword && editHsPassword && !btnToggleHsPassword._wired) {
    btnToggleHsPassword._wired = true;
    btnToggleHsPassword.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editHsPassword.type === "password") {
        editHsPassword.type = "text";
        btnToggleHsPassword.textContent = "🙈";
      } else {
        editHsPassword.type = "password";
        btnToggleHsPassword.textContent = "👁️";
      }
    });
  }

  if (btnToggleHsApiKey && editHsApiKey && !btnToggleHsApiKey._wired) {
    btnToggleHsApiKey._wired = true;
    btnToggleHsApiKey.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editHsApiKey.type === "password") {
        editHsApiKey.type = "text";
        btnToggleHsApiKey.textContent = "🙈";
      } else {
        editHsApiKey.type = "password";
        btnToggleHsApiKey.textContent = "👁️";
      }
    });
  }

  // Hotspot Type Selector Modal Wiring
  const btnCloseHsTypeModal = document.getElementById("btnCloseHsTypeModal");
  if (btnCloseHsTypeModal && !btnCloseHsTypeModal._wired) {
    btnCloseHsTypeModal._wired = true;
    btnCloseHsTypeModal.addEventListener("click", () => {
      closeHsTypeSelectModal();
    });
  }

  const hsTypeModal = document.getElementById("hsTypeSelectModal");
  if (hsTypeModal && !hsTypeModal._backdropWired) {
    hsTypeModal._backdropWired = true;
    hsTypeModal.addEventListener("click", (e) => {
      if (e.target === hsTypeModal) closeHsTypeSelectModal();
    });
  }

  document.querySelectorAll(".hs-type-item, .hs-type-card").forEach(item => {
    if (!item._wired) {
      item._wired = true;
      item.addEventListener("click", () => {
        const netType = item.dataset.netType;
        if (netType) startCreateNewHotspotWithType(netType);
      });
    }
  });

  // Credential Test Buttons Wiring
  const btnTestHsPassword = document.getElementById("btnTestHsPassword");
  if (btnTestHsPassword && !btnTestHsPassword._wired) {
    btnTestHsPassword._wired = true;
    btnTestHsPassword.addEventListener("click", () => {
      testCurrentHotspotPassword();
    });
  }

  const btnTestHsApiKey = document.getElementById("btnTestHsApiKey");
  if (btnTestHsApiKey && !btnTestHsApiKey._wired) {
    btnTestHsApiKey._wired = true;
    btnTestHsApiKey.addEventListener("click", () => {
      testCurrentHotspotApiKey();
    });
  }

  ["editHsPassword", "editHsHost", "editHsPort"].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._testResetWired) {
      el._testResetWired = true;
      el.addEventListener("input", () => {
        resetTestCredentialBtn(document.getElementById("btnTestHsPassword"), "hs_edit.btn_test_pwd_title", "Test server connection with password");
      });
    }
  });

  const elApiKey = document.getElementById("editHsApiKey");
  if (elApiKey && !elApiKey._testResetWired) {
    elApiKey._testResetWired = true;
    elApiKey.addEventListener("input", () => {
      resetTestCredentialBtn(document.getElementById("btnTestHsApiKey"), "hs_edit.btn_test_api_title", "Verify API key validity on server");
    });
  }

  ensureCustomHsDropdownElements();
  const editHsSelect = document.getElementById("editHsSelect");
  if (editHsSelect && !editHsSelect._wired) {
    editHsSelect._wired = true;
    editHsSelect.addEventListener("change", () => {
      const val = editHsSelect.value;
      if (val === "__new__") {
        openHsTypeSelectModal();
      } else {
        const currentHotspots = window.currentHotspots || [];
        const found = currentHotspots.find(h => h.id === val);
        if (found) {
          populateEditHotspotFormFields(found);
        }
      }
      if (typeof clearSettingsTabDirty === "function") {
        clearSettingsTabDirty("tab-edit-hs");
      }
    });
  }

  const btnMoveHsUp = document.getElementById("btnMoveHsUp");
  if (btnMoveHsUp && !btnMoveHsUp._wired) {
    btnMoveHsUp._wired = true;
    btnMoveHsUp.addEventListener("click", () => {
      const selectedId = editHsSelect ? editHsSelect.value : "";
      if (!selectedId || selectedId === "__new__") return;
      moveHotspotInOrder(selectedId, -1);
    });
  }

  const btnMoveHsDown = document.getElementById("btnMoveHsDown");
  if (btnMoveHsDown && !btnMoveHsDown._wired) {
    btnMoveHsDown._wired = true;
    btnMoveHsDown.addEventListener("click", () => {
      const selectedId = editHsSelect ? editHsSelect.value : "";
      if (!selectedId || selectedId === "__new__") return;
      moveHotspotInOrder(selectedId, 1);
    });
  }

  const btnDeleteCurrentHotspot = document.getElementById("btnDeleteCurrentHotspot");
  if (btnDeleteCurrentHotspot && !btnDeleteCurrentHotspot._wired) {
    btnDeleteCurrentHotspot._wired = true;
    btnDeleteCurrentHotspot.addEventListener("click", async () => {
      const editHsId = document.getElementById("editHsId");
      const id = editHsId ? editHsId.value : "";
      if (!id) return;
      const currentHotspots = window.currentHotspots || [];
      if (currentHotspots.length <= 1) {
        const lastMsg = window.t ? window.t("hotspots.cannot_delete_last", {}, "You cannot delete the only remaining hotspot!") : "You cannot delete the only remaining hotspot!";
        if (window.showAppAlert) {
          await window.showAppAlert(lastMsg, { title: window.t ? window.t("dialog.alert_title", {}, "Attention") : "Attention", icon: "ℹ️" });
        } else {
          alert(lastMsg);
        }
        return;
      }
      const targetHs = currentHotspots.find(h => h.id === id);
      const name = (targetHs && targetHs.name) ? targetHs.name : (window.t ? window.t("hotspots.selected_fallback", {}, "selected hotspot") : "selected hotspot");
      const confirmFallback = `Delete hotspot "${name}"?`;
      const ok = await (window.showAppConfirm ? window.showAppConfirm({
        title: window.t ? window.t("hotspots.delete_confirm_title", {}, "Delete hotspot") : "Delete hotspot",
        icon: "🗑️",
        message: window.t ? window.t("hotspots.delete_confirm_msg", { name }, confirmFallback) : confirmFallback,
        confirmText: window.t ? window.t("buttons.delete", {}, "Delete") : "Delete",
        confirmStyle: "danger"
      }) : Promise.resolve(confirm(window.t ? window.t("hotspots.delete_confirm_msg", { name }, confirmFallback) : confirmFallback)));
      if (!ok) return;

      try {
        if (typeof disableHotspotTranscribe === "function") {
          disableHotspotTranscribe(id, true);
        }
        const resp = await fetch(`/api/hotspots/${id}`, { method: "DELETE" });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || resp.statusText);
        }
        showToast(window.t ? window.t("hotspots.deleted_toast", {}, "🗑️ Hotspot deleted") : "🗑️ Hotspot deleted", 2500);
        await loadHotspots();
        const nextHs = (window.currentHotspots && window.currentHotspots[0]) || null;
        if (nextHs) {
          populateEditHotspotFormFields(nextHs);
        }
      } catch (err) {
        const errDetail = (err && err.message ? err.message : err);
        const errMsg = window.t ? window.t("hotspots.delete_error", { err: errDetail }, "Error deleting: " + errDetail) : ("Error deleting: " + errDetail);
        if (window.showAppAlert) {
          await window.showAppAlert(errMsg, { title: window.t ? window.t("common.error", {}, "Error") : "Error", icon: "⚠️" });
        } else {
          alert(errMsg);
        }
      }
    });
  }

  const btnToggleHsConnection = document.getElementById("btnToggleHsConnection");
  if (btnToggleHsConnection && !btnToggleHsConnection._wired) {
    btnToggleHsConnection._wired = true;
    btnToggleHsConnection.addEventListener("click", async () => {
      const editHsId = document.getElementById("editHsId");
      const id = editHsId ? editHsId.value : "";
      if (!id) return;
      const currentHotspots = window.currentHotspots || [];
      const liveHs = currentHotspots.find(h => h.id === id);
      const isOnline = liveHs && liveHs.status === "ONLINE";
      const action = isOnline ? "disconnect" : "connect";
      btnToggleHsConnection.disabled = true;
      try {
        if (typeof window.toggleHotspotConnection === "function") {
          await window.toggleHotspotConnection(id);
        } else {
          await fetch(`/api/hotspots/${id}/${action}`, { method: "POST" });
        }
        await loadHotspots();
        const updated = (window.currentHotspots || []).find(h => h.id === id);
        if (updated) {
          updateEditHsToolbarUI(updated);
        }
      } catch (err) {
        console.error("[HOTSPOTS] Connect toggle error:", err);
      } finally {
        btnToggleHsConnection.disabled = false;
      }
    });
  }

  if (btnBmApiHelp && bmApiHelpCard && !btnBmApiHelp._wired) {
    btnBmApiHelp._wired = true;
    btnBmApiHelp.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      bmApiHelpCard.classList.toggle("hidden");
    });
  }

  if (btnCloseBmApiHelp && bmApiHelpCard && !btnCloseBmApiHelp._wired) {
    btnCloseBmApiHelp._wired = true;
    btnCloseBmApiHelp.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      bmApiHelpCard.classList.add("hidden");
    });
  }

  const chkColors = document.getElementById("optEnableNetworkColors");
  if (chkColors && !chkColors._wired) {
    chkColors._wired = true;
    chkColors.addEventListener("change", async () => {
      window.__enableNetworkColors = chkColors.checked;
      document.body.classList.toggle("no-net-colors", !chkColors.checked);
      document.documentElement.classList.toggle("no-net-colors", !chkColors.checked);
      document.querySelectorAll(".radio-container").forEach(card => {
        applyCardBrandColors(card, card.dataset.networkType || "bm");
      });
      const curNet = (document.getElementById("editHsNetworkType")?.value || "bm").toLowerCase();
      applyEditHsNetworkTypeUI(curNet);
      const curHsId = document.getElementById("editHsId")?.value || "";
      const curHsObj = (window.currentHotspots || []).find(h => h.id === curHsId) || null;
      updateEditHsToolbarUI(curHsObj);
      renderToolbarHotspotSlots();
      try {
        await fetch("/api/settings/general", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enable_network_colors: chkColors.checked })
        });
      } catch (_) {}
    });
  }

  const btnReset = document.getElementById("btnResetHsBrandColor");
  if (btnReset && !btnReset._wired) {
    btnReset._wired = true;
    btnReset.addEventListener("click", async () => {
      const curNet = (document.getElementById("editHsNetworkType")?.value || "bm").toLowerCase();
      const def = DEFAULT_NETWORK_BRAND_COLORS[curNet] || DEFAULT_NETWORK_BRAND_COLORS.custom;
      if (!window.__networkBrandColors) window.__networkBrandColors = {};
      window.__networkBrandColors[curNet] = { dark: def.dark, light: def.light };
      applyEditHsNetworkTypeUI(curNet);
      document.querySelectorAll(`.radio-container[data-network-type="${curNet}"]`).forEach(card => {
        applyCardBrandColors(card, curNet);
      });
      const curHsId = document.getElementById("editHsId")?.value || "";
      const curHsObj = (window.currentHotspots || []).find(h => h.id === curHsId) || null;
      updateEditHsToolbarUI(curHsObj);
      renderToolbarHotspotSlots();
      try {
        await fetch("/api/settings/general", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ network_brand_colors: { [curNet]: { dark: def.dark, light: def.light } } })
        });
      } catch (_) {}
    });
  }

  const darkColorInput = document.getElementById("editHsBrandColorDark");
  const darkColorHex = document.getElementById("editHsBrandColorDarkHex");
  const lightColorInput = document.getElementById("editHsBrandColorLight");
  const lightColorHex = document.getElementById("editHsBrandColorLightHex");

  const syncColorChange = async (theme, val) => {
    const curNet = (document.getElementById("editHsNetworkType")?.value || "bm").toLowerCase();
    if (!window.__networkBrandColors) window.__networkBrandColors = {};
    if (!window.__networkBrandColors[curNet]) {
      const def = DEFAULT_NETWORK_BRAND_COLORS[curNet] || DEFAULT_NETWORK_BRAND_COLORS.custom;
      window.__networkBrandColors[curNet] = { dark: def.dark, light: def.light };
    }
    window.__networkBrandColors[curNet][theme] = val;
    document.querySelectorAll(`.radio-container[data-network-type="${curNet}"]`).forEach(card => {
      applyCardBrandColors(card, curNet);
    });
    applyEditHsNetworkTypeUI(curNet);
    const curHsId = document.getElementById("editHsId")?.value || "";
    const curHsObj = (window.currentHotspots || []).find(h => h.id === curHsId) || null;
    updateEditHsToolbarUI(curHsObj);
    renderToolbarHotspotSlots();
    try {
      await fetch("/api/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_brand_colors: { [curNet]: window.__networkBrandColors[curNet] } })
      });
    } catch (_) {}
  };

  if (darkColorInput && !darkColorInput._wired) {
    darkColorInput._wired = true;
    darkColorInput.addEventListener("input", (e) => {
      if (darkColorHex) darkColorHex.value = e.target.value.toUpperCase();
      syncColorChange("dark", e.target.value);
    });
  }
  if (darkColorHex && !darkColorHex._wired) {
    darkColorHex._wired = true;
    darkColorHex.addEventListener("change", (e) => {
      let val = e.target.value.trim();
      if (!val.startsWith("#")) val = "#" + val;
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        if (darkColorInput) darkColorInput.value = val;
        e.target.value = val.toUpperCase();
        syncColorChange("dark", val);
      }
    });
  }
  if (lightColorInput && !lightColorInput._wired) {
    lightColorInput._wired = true;
    lightColorInput.addEventListener("input", (e) => {
      if (lightColorHex) lightColorHex.value = e.target.value.toUpperCase();
      syncColorChange("light", e.target.value);
    });
  }
  if (lightColorHex && !lightColorHex._wired) {
    lightColorHex._wired = true;
    lightColorHex.addEventListener("change", (e) => {
      let val = e.target.value.trim();
      if (!val.startsWith("#")) val = "#" + val;
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        if (lightColorInput) lightColorInput.value = val;
        e.target.value = val.toUpperCase();
        syncColorChange("light", val);
      }
    });
  }

  if (hotspotEditForm && !hotspotEditForm._wired) {
    hotspotEditForm._wired = true;
    hotspotEditForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const editHsId = document.getElementById("editHsId");
      const id = editHsId ? editHsId.value.trim() : "";

      const editHsName = document.getElementById("editHsName");
      const editHsCallsign = document.getElementById("editHsCallsign");
      const editHsTalkerAlias = document.getElementById("editHsTalkerAlias");
      const editHsSendTalkerAlias = document.getElementById("editHsSendTalkerAlias");
      const editHsDmrId = document.getElementById("editHsDmrId");
      const editHsSsid = document.getElementById("editHsSsid");
      const editHsNetworkType = document.getElementById("editHsNetworkType");
      const editHsRptoOptions = document.getElementById("editHsRptoOptions");
      const editHsXlxModule = document.getElementById("editHsXlxModule");
      const editHsPassword = document.getElementById("editHsPassword");
      const editHsApiKey = document.getElementById("editHsApiKey");
      const editHsHost = document.getElementById("editHsHost");
      const editHsPort = document.getElementById("editHsPort");
      const editHsAutoconnect = document.getElementById("editHsAutoconnect");
      const editHsAutoTgBm = document.getElementById("editHsAutoTgBm");

      const networkTypeVal = (editHsNetworkType ? editHsNetworkType.value.trim().toLowerCase() : "bm") || "bm";
      const netProfile = getDmrNetworkProfile(networkTypeVal);
      const xlxModuleVal = ((editHsXlxModule ? editHsXlxModule.value.trim().toUpperCase() : "D") || "D").slice(0, 1);
      const xlxModTg = 4000 + Math.max(1, Math.min(26, xlxModuleVal.charCodeAt(0) - 64));
      let rptoOptionsVal = editHsRptoOptions ? editHsRptoOptions.value.trim() : "";
      if (!rptoOptionsVal && (networkTypeVal === "dmrplus" || networkTypeVal === "freedmr" || networkTypeVal === "adn")) {
        rptoOptionsVal = buildRptoFromCurrentFormFields(networkTypeVal);
      }

      const nameVal = editHsName ? editHsName.value.trim() : "";
      const callsignVal = (editHsCallsign ? editHsCallsign.value.trim().toUpperCase() : "") || "N0CALL";
      const isAllStar = networkTypeVal === "allstar";
      const isYsf = networkTypeVal === "ysf";
      const isM17 = networkTypeVal === "m17";
      const isCallsignOnly = isAllStar || isM17;
      const talkerAliasVal = isAllStar ? "" : (editHsTalkerAlias ? editHsTalkerAlias.value.trim() : "");
      const sendTalkerAliasVal = isAllStar ? false : (editHsSendTalkerAlias ? editHsSendTalkerAlias.checked : true);
      const editHsLocator = document.getElementById("editHsLocator");
      const locatorVal = editHsLocator ? editHsLocator.value.trim().toUpperCase() : "";
      const dmrIdVal = isCallsignOnly ? 0 : (parseInt(editHsDmrId ? editHsDmrId.value : "0", 10) || 0);
      const rawSsid = editHsSsid ? editHsSsid.value.trim() : "";
      const parsedSsid = rawSsid !== "" ? parseInt(rawSsid, 10) : 1;
      if (!isCallsignOnly && rawSsid !== "" && (isNaN(parsedSsid) || parsedSsid < 1 || parsedSsid > 99)) {
        if (window._settingsModalAutoCloseTimer) {
          clearTimeout(window._settingsModalAutoCloseTimer);
          window._settingsModalAutoCloseTimer = null;
        }
        const mContent = hotspotEditForm.closest('.modal-content');
        if (mContent) mContent.classList.remove('modal-save-pulse');
        showToast(window.t ? window.t("hotspots.invalid_ssid", {}, "❌ SSID должен быть в диапазоне от 1 до 99") : "❌ SSID должен быть в диапазоне от 1 до 99", 3000);
        if (editHsSsid) {
          editHsSsid.value = Math.max(1, Math.min(99, isNaN(parsedSsid) ? 1 : parsedSsid));
          editHsSsid.focus();
        }
        return;
      }
      const ssidVal = isCallsignOnly ? 1 : (isNaN(parsedSsid) ? 1 : Math.max(1, Math.min(99, parsedSsid)));
      const isDstar = (networkTypeVal === "dstar");
      const isSvx = (networkTypeVal === "svx");
      let passwordVal = editHsPassword ? editHsPassword.value.trim() : "";
      if (isYsf || isM17 || isDstar) {
        passwordVal = "";
      } else if ((networkTypeVal === "xlx" || networkTypeVal === "adn") && !passwordVal) {
        passwordVal = "passw0rd";
      } else if (networkTypeVal === "dmrplus" && !passwordVal) {
        passwordVal = "PASSWORD";
      }
      const apiKeyVal = editHsApiKey ? editHsApiKey.value.trim() : "";
      const hostVal = (editHsHost ? editHsHost.value.trim() : "") || netProfile.defaultHost || "2322.master.brandmeister.network";
      const portVal = parseInt(editHsPort ? editHsPort.value : String(netProfile.defaultPort || (isM17 ? 17000 : (isYsf ? 42000 : 62031))), 10) || netProfile.defaultPort || (isM17 ? 17000 : (isYsf ? 42000 : 62031));
      const tg1Val = networkTypeVal === "xlx" ? 9 : ((isYsf || isM17) ? 0 : 9990);
      const tg2Val = networkTypeVal === "xlx" ? xlxModTg : ((isYsf || isM17) ? 0 : 9990);
      const autoconnectVal = editHsAutoconnect ? editHsAutoconnect.checked : true;
      const autoTgBmVal = (networkTypeVal === "bm" && editHsAutoTgBm) ? editHsAutoTgBm.checked : false;

      const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
      const existing = currentHotspots.find(h => h.id === id) || {};
      const autoRecordVal = existing.auto_record !== undefined ? Boolean(existing.auto_record) : true;
      const editHsAliveToggle = document.getElementById("editHsAliveToggle");
      const hiddenVal = editHsAliveToggle ? !editHsAliveToggle.checked : Boolean(existing.hidden);

      // Validate 7 active hotspots limit when creating or unhiding
      const wasHidden = Boolean(existing.hidden);
      if ((!id || id === "__new__" || wasHidden) && !hiddenVal) {
        const activeCount = currentHotspots.filter(h => !h.hidden && h.id !== id).length;
        if (activeCount >= 7) {
          const max7Msg = window.t ? window.t("hotspots.max_active_7", {}, "Максимум 7 активных хотспотов в рабочем пространстве. Сначала исключите один из активных хотспотов") : "Максимум 7 активных хотспотов в рабочем пространстве. Сначала исключите один из активных хотспотов";
          showToast(max7Msg, "warning", 4000);
          return;
        }
      }

      const payload = {
        hidden: hiddenVal,
        name: nameVal,
        callsign: callsignVal,
        talker_alias: talkerAliasVal,
        send_talker_alias: sendTalkerAliasVal,
        description: talkerAliasVal,
        qth_locator: locatorVal,
        locator: locatorVal,
        dmr_id: dmrIdVal,
        bm_ssid: ssidVal,
        network_type: networkTypeVal,
        ysf_room_id: (networkTypeVal === "ysf" && editHsMasterSelect && editHsMasterSelect.selectedOptions && editHsMasterSelect.selectedOptions[0] && editHsMasterSelect.selectedOptions[0].dataset.roomId) ? editHsMasterSelect.selectedOptions[0].dataset.roomId : (existing.ysf_room_id || "25000"),
        m17_host: isM17 ? hostVal : (existing.m17_host || ""),
        m17_port: isM17 ? portVal : (existing.m17_port || 17000),
        m17_reflector: (isM17 && editHsMasterSelect && editHsMasterSelect.selectedOptions && editHsMasterSelect.selectedOptions[0] && editHsMasterSelect.selectedOptions[0].dataset.designator) ? editHsMasterSelect.selectedOptions[0].dataset.designator : (existing.m17_reflector || "M17-M17"),
        m17_server_type: (isM17 && editHsMasterSelect && editHsMasterSelect.selectedOptions && editHsMasterSelect.selectedOptions[0] && editHsMasterSelect.selectedOptions[0].dataset.serverType) ? editHsMasterSelect.selectedOptions[0].dataset.serverType : (existing.m17_server_type || "mrefd"),
        m17_module: document.getElementById("editHsM17Module") ? document.getElementById("editHsM17Module").value : (existing.m17_module || "C"),
        m17_callsign_suffix: document.getElementById("editHsM17Suffix") ? document.getElementById("editHsM17Suffix").value.trim().toUpperCase().slice(0, 1) : (existing.m17_callsign_suffix !== undefined ? existing.m17_callsign_suffix : "D"),
        m17_can: document.getElementById("editHsM17Can") ? parseInt(document.getElementById("editHsM17Can").value, 10) || 0 : (existing.m17_can || 0),
        m17_link_mode: document.getElementById("editHsM17LinkMode") ? document.getElementById("editHsM17LinkMode").value : (existing.m17_link_mode || "conn"),
        m17_codec_mode: document.getElementById("editHsM17CodecMode") ? document.getElementById("editHsM17CodecMode").value : (existing.m17_codec_mode || "3200"),
        m17_dst_mode: document.getElementById("editHsM17DstMode") ? document.getElementById("editHsM17DstMode").value : (existing.m17_dst_mode || "reflector"),
        m17_meta_text: isM17 ? talkerAliasVal.slice(0, 14) : (existing.m17_meta_text || ""),
        dstar_host: isDstar ? hostVal : (existing.dstar_host || ""),
        dstar_port: isDstar ? portVal : (existing.dstar_port || 30001),
        dstar_protocol: document.getElementById("editHsDstarProtocol") ? document.getElementById("editHsDstarProtocol").value : (existing.dstar_protocol || "auto"),
        dstar_module: document.getElementById("editHsDstarModule") ? (document.getElementById("editHsDstarModule").value.trim().toUpperCase().slice(0, 1) || "D") : (existing.dstar_module || "D"),
        dstar_local_module: document.getElementById("editHsDstarLocalMod") ? (document.getElementById("editHsDstarLocalMod").value.trim().toUpperCase().slice(0, 1) || "D") : (existing.dstar_local_module || "D"),
        dstar_reflector: (isDstar && editHsMasterSelect && editHsMasterSelect.selectedOptions && editHsMasterSelect.selectedOptions[0] && editHsMasterSelect.selectedOptions[0].dataset.designator) ? editHsMasterSelect.selectedOptions[0].dataset.designator : (existing.dstar_reflector || "XLX250"),
        dstar_urcall: document.getElementById("editHsDstarUrCall") ? document.getElementById("editHsDstarUrCall").value.trim().toUpperCase() : (existing.dstar_urcall || "CQCQCQ"),
        dstar_my2: document.getElementById("editHsDstarMy2") ? document.getElementById("editHsDstarMy2").value.trim().toUpperCase().slice(0, 4) : (existing.dstar_my2 || ""),
        dstar_text: isDstar ? (talkerAliasVal.slice(0, 20) || (document.getElementById("editHsDstarText") ? document.getElementById("editHsDstarText").value.trim().slice(0, 20) : "")) : (existing.dstar_text || ""),
        dstar_rx_only: document.getElementById("editHsDstarRxOnly") ? Boolean(document.getElementById("editHsDstarRxOnly").checked) : (existing.dstar_rx_only || false),
        svx_host: isSvx ? hostVal : (existing.svx_host || ""),
        svx_port: isSvx ? portVal : (existing.svx_port || 5300),
        svx_auth_key: isSvx ? passwordVal : (existing.svx_auth_key || ""),
        svx_server_name: (() => {
          if (!isSvx) return existing.svx_server_name || "";
          const svxList = getNetworkServersList("svx") || [];
          const found = svxList.find(s => s && s.host && s.host.toLowerCase() === hostVal.toLowerCase());
          return (found && found.name) ? found.name : (hostVal || existing.svx_server_name || "");
        })(),
        svx_auth_user: document.getElementById("editHsSvxAuthUser") ? document.getElementById("editHsSvxAuthUser").value.trim() : (existing.svx_auth_user || ""),
        svx_tg: (() => {
          const el = document.getElementById("editHsSvxDefaultTg");
          if (!el) return (existing.svx_tg !== undefined ? existing.svx_tg : 1);
          const parsed = parseInt(el.value, 10);
          return (!isNaN(parsed) && parsed >= 0) ? parsed : (existing.svx_tg !== undefined ? existing.svx_tg : 1);
        })(),
        svx_monitor_tgs: document.getElementById("editHsSvxMonitorTgs") ? document.getElementById("editHsSvxMonitorTgs").value.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : (existing.svx_monitor_tgs || []),
        svx_rx_only: document.getElementById("editHsSvxRxOnly") ? Boolean(document.getElementById("editHsSvxRxOnly").checked) : (existing.svx_rx_only || false),
        allstar_node: (document.getElementById("editHsAllStarNode") ? document.getElementById("editHsAllStarNode").value.trim() : (existing.allstar_node || "1999")),
        allstar_always_online: (document.getElementById("editHsAllStarAlwaysOnline") ? Boolean(document.getElementById("editHsAllStarAlwaysOnline").checked) : (existing.allstar_always_online !== undefined ? Boolean(existing.allstar_always_online) : true)),
        rpto_options: rptoOptionsVal,
        xlx_module: xlxModuleVal,
        dmrplus_reflector: (document.getElementById("editHsDmrPlusRef") ? document.getElementById("editHsDmrPlusRef").value.trim() : (existing.dmrplus_reflector || "4530")),
        bm_password: passwordVal,
        bm_api_key: apiKeyVal,
        bm_master_host: hostVal,
        bm_master_port: portVal,
        duplex: existing.duplex !== undefined ? existing.duplex : true,
        rx_freq: existing.rx_freq || 438800000,
        tx_freq: existing.tx_freq || 431200000,
        color_code: existing.color_code || 1,
        default_tg_ts1: tg1Val,
        default_tg_ts2: tg2Val,
        autoconnect: autoconnectVal,
        rx_gain: existing.rx_gain !== undefined ? existing.rx_gain : 1.0,
        tx_gain: existing.tx_gain !== undefined ? existing.tx_gain : 1.0,
        collapsed: existing.collapsed !== undefined ? existing.collapsed : false,
        auto_tg_bm: autoTgBmVal,
        auto_record: autoRecordVal,
      };
      if (id && id !== "__new__") {
        payload.id = id;
      }

      const submitBtn = hotspotEditForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        let resp;
        if (id && id !== "__new__") {
          resp = await fetch(`/api/hotspots/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
        } else {
          resp = await fetch("/api/hotspots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
        }

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || resp.statusText);
        }

        const data = await resp.json();
        const savedHs = data.hotspot || payload;
        showToast(window.t ? window.t("hotspots.settings_saved", {}, "Настройки хотспота сохранены") : "Настройки хотспота сохранены", 2500);
        if (typeof clearSettingsTabDirty === "function") {
          clearSettingsTabDirty("tab-edit-hs");
        }
        if (typeof window.triggerModalSavePulse === "function") {
          window.triggerModalSavePulse(hotspotEditForm, { closeSettings: false });
        }

        await loadHotspots();
        if (savedHs && savedHs.id) {
          populateEditHotspotFormFields(savedHs);
        }
      } catch (err) {
        if (window._settingsModalAutoCloseTimer) {
          clearTimeout(window._settingsModalAutoCloseTimer);
          window._settingsModalAutoCloseTimer = null;
        }
        const mContent = hotspotEditForm.closest('.modal-content');
        if (mContent) mContent.classList.remove('modal-save-pulse');
        const errMsg = window.t ? window.t("hotspots.save_error", { err: (err && err.message ? err.message : err) }, "Ошибка при сохранении: " + (err && err.message ? err.message : err)) : "Ошибка при сохранении: " + (err && err.message ? err.message : err);
        if (window.showAppAlert) {
          await window.showAppAlert(errMsg, { title: window.t ? window.t("common.error", {}, "Ошибка") : "Ошибка", icon: "⚠️" });
        } else {
          alert(errMsg);
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Header settings button click
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".header-settings-btn, .btn-settings");
    if (!btn) return;
    if (btn.closest("#settingsModal") || btn.id === "closeSettingsBtn") return;
    if (btn.id === "btnToggleRecSettings" || btn.closest(".rec-tools-group") || btn.closest("#recordingsModal")) return;

    e.preventDefault();
    e.stopPropagation();
    const card = btn.closest(".radio-container");
    const activeHotspotId = window.activeHotspotId || "default";
    const currentHotspots = window.currentHotspots || [];
    const cid = card ? resolveHotspotId(card.dataset.hotspotId) : activeHotspotId;
    if (card) switchActiveHotspot(cid);
    const curHs = currentHotspots.find(h => resolveHotspotId(h.id) === cid) ||
                  currentHotspots.find(h => h.id === activeHotspotId) ||
                  currentHotspots[0];
    openHotspotSettings(curHs, "tab-edit-hs");
  });

  if (settingsBtn && !settingsBtn._wired) {
    settingsBtn._wired = true;
    settingsBtn.onclick = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const currentHotspots = window.currentHotspots || [];
      const activeHotspotId = window.activeHotspotId || "default";
      const curHs = currentHotspots.find(h => h.id === activeHotspotId) || currentHotspots[0];
      openHotspotSettings(curHs);
    };
  }

  if (closeSettingsBtn && !closeSettingsBtn._wired) {
    closeSettingsBtn._wired = true;
    closeSettingsBtn.onclick = () => {
      autoSaveExistingHotspotIfDirty();
      saveCurrentSettingsState();
      const modal = document.getElementById("settingsModal");
      if (modal) {
        modal.classList.remove("active");
        modal.style.display = "";
      }
      notifyNavClosed();
    };
  }

  const headerSaveBtn = document.getElementById("btnSettingsHeaderSave");
  if (headerSaveBtn && !headerSaveBtn._wired) {
    headerSaveBtn._wired = true;
    headerSaveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleSettingsHeaderSaveClick();
    });
  }

  if (settingsModal && !settingsModal._wired) {
    settingsModal._wired = true;
    settingsModal.onclick = (e) => {
      if (e.target === settingsModal) {
        autoSaveExistingHotspotIfDirty();
        saveCurrentSettingsState();
        settingsModal.classList.remove("active");
        settingsModal.style.display = "";
        notifyNavClosed();
      }
    };
  }

  tabButtons.forEach(btn => {
    if (!btn._wired) {
      btn._wired = true;
      btn.addEventListener("click", () => {
        saveCurrentSettingsState();

        const targetId = btn.dataset.tab;
        tabButtons.forEach(b => b.classList.remove("active"));
        tabContents.forEach(c => c.classList.remove("active"));
        btn.classList.add("active");
        const target = document.getElementById(targetId);
        if (target) target.classList.add("active");
        if (targetId === "tab-account") {
          if (typeof window.restoreAccountSubtab === "function") {
            window.restoreAccountSubtab();
          }
        }
        if (targetId === "tab-edit-hs") {
          const curId = (document.getElementById("editHsId") && document.getElementById("editHsId").value) || window.activeHotspotId;
          const targetHs = (window.currentHotspots || []).find(h => h.id === curId) || (window.currentHotspots || [])[0];
          if (targetHs && typeof populateEditHotspotFormFields === "function") {
            populateEditHotspotFormFields(targetHs);
          }
        }
        if (targetId === "tab-transcriber") {
          const keysFrame = document.getElementById("geminiApiKeysFrame");
          if (keysFrame) keysFrame.classList.add("collapsed");
        }

        try {
          localStorage.setItem("proxdmr_settings_last_tab", targetId);
        } catch (_) {}

        if (typeof updateSettingsHeaderSaveBtn === "function") {
          updateSettingsHeaderSaveBtn();
        }

        const modalBody = document.querySelector("#settingsModal .settings-modal-body");
        let savedScroll = 0;
        let savedFocusId = null;
        try {
          savedScroll = parseInt(localStorage.getItem(`proxdmr_settings_scroll_${targetId}`) || "0", 10);
          savedFocusId = localStorage.getItem(`proxdmr_settings_focus_${targetId}`);
        } catch (_) {}

        const restoreTabState = () => {
          if (modalBody) modalBody.scrollTop = savedScroll;
          if (savedFocusId) {
            const focusEl = document.getElementById(savedFocusId);
            if (focusEl && focusEl.closest(`#${targetId}`) && typeof focusEl.focus === "function") {
              try {
                focusEl.focus({ preventScroll: true });
              } catch (_) {}
            }
          }
        };
        requestAnimationFrame(restoreTabState);
        setTimeout(restoreTabState, 40);
      });
    }
  });

  const modalBody = document.querySelector("#settingsModal .settings-modal-body");
  if (modalBody && !modalBody._dirtyWatcherWired) {
    modalBody._dirtyWatcherWired = true;
    const onUserEdit = (e) => {
      if (_isProgrammaticPopulating) return;
      const target = e.target;
      if (!target) return;
      if (target.id === "editHsSelect" || (target.closest && (target.closest(".hs-manager-toolbar") || target.closest("#editHsCustomDropdown")))) {
        return;
      }
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        if (target.type === "button" || target.type === "submit" || target.type === "reset") return;
        const tabContent = target.closest(".tab-content");
        if (tabContent && tabContent.id) {
          setSettingsTabDirty(tabContent.id, true);
        }
      }
    };
    modalBody.addEventListener("input", onUserEdit, { passive: true });
    modalBody.addEventListener("change", onUserEdit, { passive: true });
  }

  if (modalBody && !modalBody._scrollWired) {
    modalBody._scrollWired = true;
    let scrollDebounce = null;
    modalBody.addEventListener("scroll", () => {
      if (scrollDebounce) clearTimeout(scrollDebounce);
      scrollDebounce = setTimeout(() => {
        const activeBtn = document.querySelector("#settingsModal .tab-btn.active");
        if (activeBtn && activeBtn.dataset.tab) {
          try {
            localStorage.setItem(`proxdmr_settings_scroll_${activeBtn.dataset.tab}`, String(modalBody.scrollTop));
            localStorage.setItem("proxdmr_settings_last_scroll", String(modalBody.scrollTop));
          } catch (_) {}
        }
      }, 50);
    }, { passive: true });
  }

  if (settingsModal && !settingsModal._focusWired) {
    settingsModal._focusWired = true;
    settingsModal.addEventListener("focusin", (e) => {
      if (e.target && e.target.id && !e.target.classList.contains("tab-btn") && e.target.id !== "closeSettingsBtn") {
        const activeBtn = document.querySelector("#settingsModal .tab-btn.active");
        if (activeBtn && activeBtn.dataset.tab) {
          try {
            localStorage.setItem("proxdmr_settings_last_focus", e.target.id);
            localStorage.setItem(`proxdmr_settings_focus_${activeBtn.dataset.tab}`, e.target.id);
          } catch (_) {}
        }
      }
    });
  }
}

// Global attachments
window.loadHotspots = loadHotspots;
window.renderHotspotSelect = renderHotspotSelect;
window.switchActiveHotspot = switchActiveHotspot;
window.triggerAddNewHotspot = triggerAddNewHotspot;
window.openHotspotSettings = openHotspotSettings;
window.renderRadiosGrid = renderRadiosGrid;
window.linkHotspotXlxModule = linkHotspotXlxModule;
window.linkHotspotDmrPlusReflector = linkHotspotDmrPlusReflector;
window.updateCardDmrPlusPanel = updateCardDmrPlusPanel;
  window.updateCardYsfPanel = updateCardYsfPanel;
  window.getYsfMatrixPage = getYsfMatrixPage;
  window.setYsfMatrixPageValue = setYsfMatrixPageValue;
  window.getYsfMatrixRooms = getYsfMatrixRooms;
  window.saveYsfMatrixRooms = saveYsfMatrixRooms;
  window.getYsfScanConfig = getYsfScanConfig;
  window.saveYsfScanConfig = saveYsfScanConfig;
  window.getYsfDiceConfig = getYsfDiceConfig;
  window.saveYsfDiceConfig = saveYsfDiceConfig;
  window.isYsfRoomRxActive = isYsfRoomRxActive;
  window.startYsfMatrixScan = startYsfMatrixScan;
  window.stopYsfMatrixScan = stopYsfMatrixScan;
  window.renderYsfDashboard = renderYsfDashboard;
  window.isYsfDashAutoOpenEnabled = isYsfDashAutoOpenEnabled;
  window.setYsfDashAutoOpenEnabled = setYsfDashAutoOpenEnabled;
  window.openYsfCardContextMenu = openYsfCardContextMenu;
  window.closeYsfCardContextMenu = closeYsfCardContextMenu;
  window.openYsfCardEditPopover = openYsfCardEditPopover;
  window.openYsfScanSettingsPopover = openYsfScanSettingsPopover;
  window.openYsfDiceSettingsPopover = openYsfDiceSettingsPopover;
  window.openYsfMatrixManageModal = openYsfMatrixManageModal;
  window.getAdnDiceConfig = getAdnDiceConfig;
  window.saveAdnDiceConfig = saveAdnDiceConfig;
  window.openAdnDiceSettingsPopover = openAdnDiceSettingsPopover;
  window.syncAdnDiceButtonUI = syncAdnDiceButtonUI;
  window.stopAdnDiceSearch = stopAdnDiceSearch;
  window.startAdnDiceSearch = startAdnDiceSearch;
  window.setupAdnDiceButton = setupAdnDiceButton;
  window.isAdnSlotRxActive = isAdnSlotRxActive;
window.openXlxAllModulesPopover = openXlxAllModulesPopover;
window.syncCollapsedHotspotStacks = syncCollapsedHotspotStacks;
window.syncAslMatrixButtonsState = syncAslMatrixButtonsState;
window.setAslProcBannerState = setAslProcBannerState;
window.formatAslProcMessage = formatAslProcMessage;
window.aslDisconnectNodeProcedure = aslDisconnectNodeProcedure;
window.aslConnectNodeProcedure = aslConnectNodeProcedure;
window.closeAslCardContextMenu = closeAslCardContextMenu;
window.saveAslUserNodes = saveAslUserNodes;
window.setSettingsTabDirty = setSettingsTabDirty;
window.clearSettingsTabDirty = clearSettingsTabDirty;
window.updateSettingsHeaderSaveBtn = updateSettingsHeaderSaveBtn;
window.handleSettingsHeaderSaveClick = handleSettingsHeaderSaveClick;
window.openAslCardContextMenu = openAslCardContextMenu;
window.probeAslMatrixNodes = probeAslMatrixNodes; window.fetchDirectAslNodeStats = fetchDirectAslNodeStats; window.processDirectStatsQueue = processDirectStatsQueue;
window.applyActiveHotspotToUI = applyActiveHotspotToUI;
window.renderHotspotsList = renderHotspotsList;
window.fetchBmMasters = fetchBmMasters;
window.renderBmMastersDropdown = renderBmMastersDropdown;
window.applyEditHsNetworkTypeUI = applyEditHsNetworkTypeUI;
window.populateEditHotspotFormFields = populateEditHotspotFormFields;
window.openEditHotspotForm = openEditHotspotForm;
window.initHotspotsManager = initHotspotsManager;
window.isAslDtmfCard = isAslDtmfCard;
window.executeAslDtmfMacroAction = executeAslDtmfMacroAction;
window.getAslScanConfig = getAslScanConfig;
window.saveAslScanConfig = saveAslScanConfig;
window.getAslDiceConfig = getAslDiceConfig;
window.saveAslDiceConfig = saveAslDiceConfig;
window.openAslDiceSettingsPopover = openAslDiceSettingsPopover;
window.syncAslDiceButtonUI = syncAslDiceButtonUI;
window.stopAslDiceSearch = stopAslDiceSearch;
window.isAslNodeRxActive = isAslNodeRxActive;
window.startAslMatrixScan = startAslMatrixScan;
window.stopAslMatrixScan = stopAslMatrixScan;
window.openAslScanSettingsPopover = openAslScanSettingsPopover;
window.openAslCardEditPopover = openAslCardEditPopover;
window.autoSaveExistingHotspotIfDirty = autoSaveExistingHotspotIfDirty;
window.saveCurrentSettingsState = saveCurrentSettingsState;
window.reorderHotspots = reorderHotspots;
window.moveHotspotInOrder = moveHotspotInOrder;
window.openHsTypeSelectModal = openHsTypeSelectModal;
window.closeHsTypeSelectModal = closeHsTypeSelectModal;
window.startCreateNewHotspotWithType = startCreateNewHotspotWithType;

export function isM17DashAutoOpenEnabled(cid = "default") {
  try {
    const val = hasServerCollectionKey("m17_dash_auto", cid)
      ? getServerCollectionValue("m17_dash_auto", cid)
      : localStorage.getItem(`proxdmr_m17_dash_auto_${cid}`);
    if (val === true || val === 1 || val === "1" || val === "true") return true;
    if (val === false || val === 0 || val === "0" || val === "false") return false;
  } catch (_) {}
  return false;
}

export function setM17DashAutoOpen(cid = "default", enabled = false) {
  try {
    setServerCollectionKey("m17_dash_auto", cid, Boolean(enabled), "proxdmr_m17_dash_auto_", false);
  } catch (_) {}
  const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
  if (card) {
    const chk = card.querySelector(".chk-m17-dash-auto");
    if (chk) chk.checked = Boolean(enabled);
  }
}

async function _sendM17ModuleUpdate(card, cid, patch) {
  const curCid = resolveHotspotId((card && card.dataset.hotspotId) || cid || "default");
  const resp = await fetch("/api/m17/module", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hotspot_id: curCid, ...patch }),
  });
  const data = await resp.json().catch(() => ({}));
  if (data && data.hotspot && card) {
    updateCardM17Panel(card, data.hotspot);
  }
  return data;
}

function _closeM17ModulesPopover() {
  const existing = document.getElementById("m17ModulesPopover");
  if (existing) existing.remove();
  if (window._m17ModPopoverCleanup) {
    try { window._m17ModPopoverCleanup(); } catch (_) {}
    window._m17ModPopoverCleanup = null;
  }
}

export async function openM17ModulesPicker(card, cid, anchorEl) {
  _closeM17ModulesPopover();
  const curCid = resolveHotspotId((card && card.dataset.hotspotId) || cid || "default");
  const targetHs = getCurrentHotspots().find(h => h.id === curCid) || null;
  let currentMod = String((targetHs && targetHs.m17_module) || "C").toUpperCase().slice(0, 1) || "C";
  let modulesList = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  let modulesMeta = {};
  let moduleClients = {};
  let serverType = String((targetHs && targetHs.m17_server_type) || "mrefd").toLowerCase();

  try {
    const resp = await fetch(`/api/m17/connected?hotspot_id=${encodeURIComponent(curCid)}&force=0`);
    const info = await resp.json().catch(() => null);
    if (info && info.status === "ok") {
      if (info.module) currentMod = String(info.module).toUpperCase().slice(0, 1) || currentMod;
      if (Array.isArray(info.modules) && info.modules.length > 0) {
        modulesList = info.modules.map(m => String(m).toUpperCase().slice(0, 1)).filter(Boolean);
      }
      if (info.modules_meta && typeof info.modules_meta === "object") modulesMeta = info.modules_meta;
      if (info.dashboard && info.dashboard.module_clients) moduleClients = info.dashboard.module_clients;
      if (info.server_type) serverType = String(info.server_type).toLowerCase();
    }
  } catch (_) {}

  const pop = document.createElement("div");
  pop.id = "m17ModulesPopover";
  pop.className = "m17-modules-popover";

  const titleText = window.t ? window.t("m17.modules_modal_title", {}, "Выбор модуля M17") : "Выбор модуля M17";
  const tilesHtml = modulesList.map((letter) => {
    const meta = modulesMeta[letter] || {};
    const clients = Array.isArray(moduleClients[letter]) ? moduleClients[letter] : [];
    const cnt = clients.length;
    const isActive = letter === currentMod;
    const isLocked = Boolean(meta.encrypted || meta.locked);
    const isXMode = serverType === "urfd" && Boolean(meta.xmode || meta.transcoded || meta.description);
    const isIncompatible = meta.m17_compatible === false;
    const desc = meta.description ? String(meta.description) : "";
    const tipParts = [`Module ${letter}`];
    if (cnt > 0) tipParts.push(`(${cnt})`);
    if (isLocked) tipParts.push("Encrypted");
    if (isXMode) tipParts.push("X-MODE");
    if (desc) tipParts.push(desc);

    const cls = [
      "m17-mod-tile",
      isActive ? "is-active" : "",
      isIncompatible ? "is-dimmed" : "",
    ].filter(Boolean).join(" ");

    return `<button type="button" class="${cls}" data-mod="${safeEscapeHtml(letter)}" title="${safeEscapeHtml(tipParts.join(" · "))}">
      <span class="m17-mod-letter">${safeEscapeHtml(letter)}${isLocked ? " 🔒" : ""}</span>
      ${cnt > 0 ? `<span class="m17-mod-cnt">(${cnt})</span>` : ""}
      ${isXMode ? `<span class="m17-mod-xmode">X-MODE</span>` : ""}
    </button>`;
  }).join("");

  pop.innerHTML = `
    <div class="m17-mod-pop-header">
      <span class="m17-mod-pop-title">${safeEscapeHtml(titleText)}</span>
      <button type="button" class="m17-mod-pop-close" aria-label="Close">✕</button>
    </div>
    <div class="m17-mod-grid">${tilesHtml}</div>
  `;

  document.body.appendChild(pop);

  const rect = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : null;
  const popRect = pop.getBoundingClientRect();
  const margin = 10;
  let left = rect ? rect.left : Math.round((window.innerWidth - popRect.width) / 2);
  let top = rect ? (rect.bottom + 6) : Math.round((window.innerHeight - popRect.height) / 2);
  if (left + popRect.width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - popRect.width - margin);
  }
  if (top + popRect.height > window.innerHeight - margin && rect) {
    const above = rect.top - popRect.height - 6;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - popRect.height - margin);
  }
  pop.style.left = `${Math.max(margin, Math.round(left))}px`;
  pop.style.top = `${Math.max(margin, Math.round(top))}px`;

  const onDocClick = (ev) => {
    if (!pop.contains(ev.target) && (!anchorEl || !anchorEl.contains(ev.target))) {
      _closeM17ModulesPopover();
    }
  };
  const onDocKey = (ev) => {
    if (ev.key === "Escape") {
      _closeM17ModulesPopover();
    }
  };
  setTimeout(() => {
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onDocKey, true);
  }, 0);
  window._m17ModPopoverCleanup = () => {
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onDocKey, true);
  };

  const closeBtn = pop.querySelector(".m17-mod-pop-close");
  if (closeBtn) closeBtn.addEventListener("click", () => _closeM17ModulesPopover());

  pop.querySelectorAll(".m17-mod-tile").forEach((tile) => {
    tile.addEventListener("click", async () => {
      const modLetter = tile.getAttribute("data-mod");
      if (!modLetter) return;
      _closeM17ModulesPopover();
      try {
        await _sendM17ModuleUpdate(card, curCid, { module: modLetter });
        const targetAfter = getCurrentHotspots().find(h => h.id === curCid);
        if (targetAfter && targetAfter._m17DashOpen) {
          renderM17ReflectorDashboard(card, curCid, false);
        }
        if (typeof showToast === "function") {
          showToast(`M17 Module ${modLetter}`, "info", 1800);
        }
      } catch (err) {
        console.warn("[M17] module pick failed:", err);
      }
    });
  });
}

function _ensureM17DashDrawer(card) {
  if (!card) return null;
  let drawer = card.querySelector(".m17-dash-drawer");
  if (drawer) return drawer;
  const screen = card.querySelector(".radio-screen");
  if (!screen) return null;
  const vfoTs1 = screen.querySelector(".vfo-ts1-row");
  drawer = document.createElement("div");
  drawer.className = "m17-dash-drawer";
  drawer.style.display = "none";
  if (vfoTs1 && vfoTs1.parentElement === screen) {
    vfoTs1.insertAdjacentElement("afterend", drawer);
  } else {
    screen.appendChild(drawer);
  }
  return drawer;
}

function _stopM17DashTimer(card) {
  if (card && card._m17DashTimer) {
    clearInterval(card._m17DashTimer);
    card._m17DashTimer = null;
  }
}

export async function renderM17ReflectorDashboard(card, cid, force = false) {
  if (!card) return;
  const curCid = resolveHotspotId((card && card.dataset.hotspotId) || cid || "default");
  const targetHs = getCurrentHotspots().find(h => h.id === curCid) || null;
  const drawer = _ensureM17DashDrawer(card);
  if (!drawer) return;

  if (!targetHs || !targetHs._m17DashOpen) {
    drawer.style.display = "none";
    _stopM17DashTimer(card);
    return;
  }

  drawer.style.display = "block";
  if (!drawer.innerHTML.trim()) {
    drawer.innerHTML = `<div class="m17-dash-loading">Loading M17 Dashboard...</div>`;
  }

  try {
    const resp = await fetch(`/api/m17/connected?hotspot_id=${encodeURIComponent(curCid)}&force=${force ? 1 : 0}`);
    const data = await resp.json().catch(() => null);
    if (!data || data.status !== "ok") {
      const emptyMsg = window.t ? window.t("m17.dash_empty", {}, "Нет данных дашборда рефлектора") : "Нет данных дашборда рефлектора";
      drawer.innerHTML = `<div class="m17-dash-empty">${safeEscapeHtml(emptyMsg)}</div>`;
      return;
    }

    const ref = String(data.reflector || (targetHs && targetHs.m17_reflector) || "M17-M17").trim();
    const activeMod = String(data.module || (targetHs && targetHs.m17_module) || "C").toUpperCase().slice(0, 1) || "C";
    const srvType = String(data.server_type || "mrefd").toLowerCase();
    const dashUrl = String(data.dashboard_url || "").trim();
    const dash = data.dashboard || {};
    const linksCount = Number(dash.links_count || 0);
    const peersCount = Number(dash.peers_count || 0);
    const modClients = (dash.module_clients && typeof dash.module_clients === "object") ? dash.module_clients : {};
    const modulesMeta = (data.modules_meta && typeof data.modules_meta === "object") ? data.modules_meta : {};
    const lastHeard = Array.isArray(dash.last_heard) ? dash.last_heard.slice(0, 8) : [];
    const myCall = String((targetHs && targetHs.callsign) || "").trim().toUpperCase();

    const linksLabel = window.t ? window.t("m17.dash_links", {}, "Links") : "Links";
    const peersLabel = window.t ? window.t("m17.dash_peers", {}, "Peers") : "Peers";
    const lhLabel = window.t ? window.t("m17.dash_last_heard", {}, "Last Heard") : "Last Heard";
    const emptyLabel = window.t ? window.t("m17.dash_empty", {}, "Нет данных дашборда рефлектора") : "Нет данных дашборда рефлектора";

    const modKeysSet = new Set([activeMod]);
    Object.keys(modClients).forEach((k) => {
      if (Array.isArray(modClients[k]) && modClients[k].length > 0) {
        modKeysSet.add(String(k).toUpperCase().slice(0, 1));
      }
    });
    const modKeys = Array.from(modKeysSet).sort();

    const chipsHtml = modKeys.map((mKey) => {
      const cnt = Array.isArray(modClients[mKey]) ? modClients[mKey].length : 0;
      const meta = modulesMeta[mKey] || {};
      const isUrfdX = srvType === "urfd" && Boolean(meta.xmode || meta.transcoded || meta.description);
      const titleTip = [meta.description || "", isUrfdX ? "X-MODE" : ""].filter(Boolean).join(" · ");
      return `<button type="button" class="m17-dash-mod-chip${mKey === activeMod ? " is-active" : ""}" data-mod="${safeEscapeHtml(mKey)}" title="${safeEscapeHtml(titleTip || `Module ${mKey}`)}">
        <span>${safeEscapeHtml(mKey)} (${cnt})</span>${isUrfdX ? `<span class="m17-dash-xmode">X-MODE</span>` : ""}
      </button>`;
    }).join("");

    const selectedClients = Array.isArray(modClients[activeMod]) ? modClients[activeMod] : [];
    const clientsHtml = selectedClients.length > 0
      ? selectedClients.map((cl) => {
        const cs = safeEscapeHtml(String(cl || "").trim());
        const isSelf = myCall && String(cl || "").trim().toUpperCase().startsWith(myCall);
        return `<span class="m17-dash-client${isSelf ? " is-self" : ""}">${cs}</span>`;
      }).join("")
      : `<span class="m17-dash-muted">—</span>`;

    const lhHtml = lastHeard.length > 0
      ? lastHeard.map((item) => {
        const cs = safeEscapeHtml(String(item.callsign || item.source || item.src || "—"));
        const md = safeEscapeHtml(String(item.module || item.mod || ""));
        const tm = safeEscapeHtml(String(item.time || item.ago || item.timestamp || ""));
        return `<div class="m17-dash-lh-row"><span class="m17-dash-lh-cs">${cs}</span>${md ? `<span class="m17-dash-lh-mod">${md}</span>` : ""}<span class="m17-dash-lh-tm">${tm}</span></div>`;
      }).join("")
      : `<div class="m17-dash-empty">${safeEscapeHtml(emptyLabel)}</div>`;

    const srvBadgeCls = srvType === "urfd" ? " is-urfd" : (srvType === "vex" ? " is-vex" : "");
    const extLinkHtml = dashUrl
      ? `<a class="m17-dash-ext-link" href="${safeEscapeHtml(dashUrl)}" target="_blank" rel="noopener noreferrer" title="Web Dashboard">↗</a>`
      : "";

    drawer.innerHTML = `
      <div class="m17-dash-head">
        <div class="m17-dash-title-wrap">
          <span class="m17-dash-ref">${safeEscapeHtml(ref)}</span>
          <span class="m17-engine-badge${srvBadgeCls}">${safeEscapeHtml(srvType.toUpperCase())}</span>
          <span class="m17-dash-stat">${safeEscapeHtml(linksLabel)}: <strong>${linksCount}</strong></span>
          <span class="m17-dash-stat">${safeEscapeHtml(peersLabel)}: <strong>${peersCount}</strong></span>
        </div>
        <div class="m17-dash-actions">
          <button type="button" class="m17-dash-btn-refresh" title="Refresh">🔄</button>
          ${extLinkHtml}
          <button type="button" class="m17-dash-btn-close" title="Close">✕</button>
        </div>
      </div>
      <div class="m17-dash-mods-bar">${chipsHtml}</div>
      <div class="m17-dash-clients-list">${clientsHtml}</div>
      <div class="m17-dash-lh-title">${safeEscapeHtml(lhLabel)}</div>
      <div class="m17-dash-lh-list">${lhHtml}</div>
    `;

    const refreshBtn = drawer.querySelector(".m17-dash-btn-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        renderM17ReflectorDashboard(card, curCid, true);
      });
    }
    const closeBtn = drawer.querySelector(".m17-dash-btn-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (targetHs) {
          targetHs._m17DashOpen = false;
          targetHs._m17DashManuallyClosed = true;
        }
        const pair = card.querySelector(".control-pair-btn.m17-dash-pair");
        if (pair) pair.classList.remove("dash-open");
        drawer.style.display = "none";
        _stopM17DashTimer(card);
      });
    }
    drawer.querySelectorAll(".m17-dash-mod-chip").forEach((chip) => {
      chip.addEventListener("click", async (e) => {
        e.stopPropagation();
        const modKey = chip.getAttribute("data-mod");
        if (!modKey) return;
        try {
          await _sendM17ModuleUpdate(card, curCid, { module: modKey });
          renderM17ReflectorDashboard(card, curCid, false);
        } catch (err) {
          console.warn("[M17] dash module switch failed:", err);
        }
      });
    });

    if (!card._m17DashTimer) {
      card._m17DashTimer = setInterval(() => {
        const hsNow = getCurrentHotspots().find(h => h.id === curCid);
        const isOnlineNow = Boolean(
          card.isConnected &&
          !card.classList.contains("hidden") &&
          hsNow &&
          hsNow._m17DashOpen
        );
        if (!isOnlineNow) {
          _stopM17DashTimer(card);
          return;
        }
        renderM17ReflectorDashboard(card, curCid, false);
      }, 30000);
    }
  } catch (err) {
    console.warn("[M17] dashboard render failed:", err);
  }
}

export function updateCardM17Panel(card, hs) {
  if (!card) return;
  const targetHs = hs || (card.dataset.hotspotId ? (getCurrentHotspots().find(h => h.id === card.dataset.hotspotId) || null) : null) || (getCurrentHotspots()[0] || null);
  const isM17Net = ((targetHs && targetHs.network_type) || card.dataset.networkType || "bm").toLowerCase() === "m17";
  card.classList.toggle("card-net-m17", isM17Net);
  const bar = card.querySelector(".m17-control-bar");
  const m17DashPairExisting = card.querySelector(".control-pair-btn.m17-dash-pair");
  const m17DashDrawerExisting = card.querySelector(".m17-dash-drawer");
  const m17TripleExisting = card.querySelector(".btn-m17-triple");

  if (!isM17Net) {
    if (bar) bar.style.display = "none";
    if (m17DashPairExisting) m17DashPairExisting.style.display = "none";
    if (m17DashDrawerExisting) m17DashDrawerExisting.style.display = "none";
    if (m17TripleExisting) m17TripleExisting.style.display = "none";
    _stopM17DashTimer(card);
    return;
  }

  card.dataset.networkType = "m17";
  const cid = (targetHs && targetHs.id) || card.dataset.hotspotId || "default";
  const vfoTs1 = card.querySelector(".vfo-ts1-row");
  const vfoTs2 = card.querySelector(".vfo-ts2-row");
  const apiRow = card.querySelector(".api-status-row");
  if (vfoTs1) vfoTs1.style.removeProperty("display");
  if (vfoTs2) vfoTs2.style.setProperty("display", "none", "important");
  if (apiRow) apiRow.style.setProperty("display", "none", "important");

  // Hide irrelevant DMR pairs & buttons
  const dsdPair = card.querySelector(".control-pair-btn.dsd-pair, .control-pair-btn.ambe-pair");
  if (dsdPair) dsdPair.style.setProperty("display", "none", "important");
  const btnSrchTg = card.querySelector(".btn-srch-tg-id");
  const btnAslDir = card.querySelector(".btn-asl-nodes-dir");
  const btnYsfDir = card.querySelector(".btn-ysf-rooms-dir");
  if (btnSrchTg) btnSrchTg.style.display = "none";
  if (btnAslDir) btnAslDir.style.display = "none";
  if (btnYsfDir) btnYsfDir.style.display = "none";

  // Mount or update Dashboard | [checkbox] pair before audio-rx-pair
  const audioRxPair = card.querySelector(".control-pair-btn.audio-rx-pair");
  let m17DashPair = m17DashPairExisting;
  if (!m17DashPair && audioRxPair && audioRxPair.parentElement) {
    const btnTitle = window.t ? window.t("m17.dash_btn_title", {}, "Открыть / закрыть живой дашборд рефлектора M17") : "Открыть / закрыть живой дашборд рефлектора M17";
    const chkTitle = window.t ? window.t("m17.dash_auto_title", {}, "Автооткрытие дашборда M17 при подключении") : "Автооткрытие дашборда M17 при подключении";
    const btnLabel = window.t ? window.t("m17.dash_btn_label", {}, "Dashboard") : "Dashboard";

    m17DashPair = document.createElement("div");
    m17DashPair.className = "control-pair-btn m17-dash-pair";
    m17DashPair.innerHTML = `
      <button type="button" class="btn-action-trigger btn-m17-dash-trigger" title="${safeEscapeHtml(btnTitle)}" data-i18n-title="m17.dash_btn_title">
        <span class="btn-action-label" data-i18n="m17.dash_btn_label">${safeEscapeHtml(btnLabel)}</span>
      </button>
      <div class="preset-dropdown-wrapper m17-dash-auto-wrap" title="${safeEscapeHtml(chkTitle)}" data-i18n-title="m17.dash_auto_title">
        <label class="m17-dash-auto-label">
          <input type="checkbox" class="chk-m17-dash-auto" aria-label="${safeEscapeHtml(chkTitle)}" />
        </label>
      </div>
    `;
    audioRxPair.parentElement.insertBefore(m17DashPair, audioRxPair);
  }

  const isCardOnline = Boolean(
    (targetHs && (targetHs.is_connected || targetHs.online || targetHs.bm_state === "ONLINE")) ||
    card.querySelector(".status-badge.status-online")
  );
  if (targetHs && isCardOnline && isM17DashAutoOpenEnabled(cid) && !targetHs._m17DashManuallyClosed && !targetHs._m17DashOpen) {
    targetHs._m17DashOpen = true;
  }

  if (m17DashPair) {
    m17DashPair.style.display = "inline-flex";
    const isDashOpen = Boolean(targetHs && targetHs._m17DashOpen);
    m17DashPair.classList.toggle("dash-open", isDashOpen);
    const drawer = _ensureM17DashDrawer(card);
    if (drawer) {
      drawer.style.display = isDashOpen ? "block" : "none";
    }
    if (isDashOpen) {
      renderM17ReflectorDashboard(card, cid, false);
    } else {
      _stopM17DashTimer(card);
    }

    const dashTrigger = m17DashPair.querySelector(".btn-m17-dash-trigger");
    const autoWrap = m17DashPair.querySelector(".m17-dash-auto-wrap");
    const autoChk = m17DashPair.querySelector(".chk-m17-dash-auto");
    if (autoChk) {
      autoChk.checked = isM17DashAutoOpenEnabled(cid);
    }
    if (dashTrigger && !dashTrigger._m17Wired) {
      dashTrigger._m17Wired = true;
      dashTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
        const curHs = getCurrentHotspots().find(h => h.id === curCid);
        if (!curHs) return;
        curHs._m17DashOpen = !curHs._m17DashOpen;
        curHs._m17DashManuallyClosed = !curHs._m17DashOpen;
        m17DashPair.classList.toggle("dash-open", curHs._m17DashOpen);
        if (curHs._m17DashOpen) {
          renderM17ReflectorDashboard(card, curCid, true);
        } else {
          const d = card.querySelector(".m17-dash-drawer");
          if (d) d.style.display = "none";
          _stopM17DashTimer(card);
        }
      });
    }
    if (autoWrap && autoChk && !autoChk._m17Wired) {
      autoChk._m17Wired = true;
      autoWrap.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.target !== autoChk) {
          autoChk.checked = !autoChk.checked;
          autoChk.dispatchEvent(new Event("change"));
        }
      });
      autoChk.addEventListener("change", (e) => {
        e.stopPropagation();
        const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
        setM17DashAutoOpen(curCid, Boolean(autoChk.checked));
      });
    }
  }

  const modVal = String((targetHs && targetHs.m17_module) || "C").toUpperCase().slice(0, 1) || "C";
  const canVal = Number((targetHs && targetHs.m17_can) || 0);
  const linkMode = String((targetHs && targetHs.m17_link_mode) || "conn").toLowerCase();
  const codecMode = String((targetHs && targetHs.m17_codec_mode) || "3200");
  const refName = String((targetHs && (targetHs.m17_reflector || targetHs.m17_reflector_name)) || "M17-M17").trim();

  // Mount & update triple button REF -Modules- ECHO
  const tripleBtn = m17TripleExisting;
  if (tripleBtn) {
    tripleBtn.style.display = "inline-flex";
    const echoSeg = tripleBtn.querySelector(".m17-seg-echo");
    if (echoSeg) {
      const activeEchoMod = (targetHs && targetHs._m17ActiveEchoMod) || "E";
      echoSeg.classList.toggle("is-echo-active", modVal === activeEchoMod);
    }
    if (!tripleBtn._m17Wired) {
      tripleBtn._m17Wired = true;
      tripleBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
        const curHs = getCurrentHotspots().find(h => h.id === curCid);
        const curMod = String((curHs && curHs.m17_module) || "C").toUpperCase().slice(0, 1) || "C";
        const seg = e.target.closest("[data-action]");
        const action = seg ? seg.getAttribute("data-action") : "modules";

        if (action === "ref") {
          if (typeof window.openMyContactsModal === "function") {
            window.openMyContactsModal(curCid, "m17");
          } else {
            openBmBenchmarkModal(curCid, "m17");
          }
          return;
        }
        if (action === "echo") {
          try {
            let detectedEchoMod = "";
            let refLabel = String((curHs && curHs.m17_reflector) || "M17").trim() || "M17";
            try {
              const rConn = await fetch(`/api/m17/connected?hotspot_id=${encodeURIComponent(curCid)}&force=0`);
              const dConn = await rConn.json().catch(() => null);
              if (dConn && dConn.status === "ok") {
                if (dConn.reflector) refLabel = String(dConn.reflector).trim();
                const mMeta = (dConn.modules_meta && typeof dConn.modules_meta === "object") ? dConn.modules_meta : {};
                for (const [mKey, mInfo] of Object.entries(mMeta)) {
                  const desc = String((mInfo && mInfo.description) || "");
                  if (/echo|parrot/i.test(desc)) {
                    detectedEchoMod = String(mKey).toUpperCase().slice(0, 1);
                    break;
                  }
                }
              }
            } catch (_) {}

            const targetEchoMod = detectedEchoMod || (curHs && curHs._m17ActiveEchoMod) || "E";
            if (curMod !== targetEchoMod) {
              if (curHs) {
                curHs._m17PrevModuleBeforeEcho = curMod;
                curHs._m17ActiveEchoMod = targetEchoMod;
              }
              await _sendM17ModuleUpdate(card, curCid, { module: targetEchoMod });
              if (typeof showToast === "function") {
                if (detectedEchoMod) {
                  const msg = window.t
                    ? window.t("m17.echo_on_toast", { prev: curMod, mod: targetEchoMod }, `Echo-тест: переключено на Module ${targetEchoMod} (повторный клик ECHO вернёт Module ${curMod})`)
                    : `Echo-тест: переключено на Module ${targetEchoMod} (повторный клик ECHO вернёт Module ${curMod})`;
                  showToast(msg, "info", 2800);
                } else {
                  const warnMsg = window.t
                    ? window.t("m17.echo_unconfirmed_warn", { mod: targetEchoMod, ref: refLabel }, `Переключено на Module ${targetEchoMod} — у ${refLabel} нет подтверждённого Echo-модуля (для гарантированного эха выберите URF345 E / URF218 E / URF363 Z)`)
                    : `Переключено на Module ${targetEchoMod} — у ${refLabel} нет подтверждённого Echo-модуля (для гарантированного эха выберите URF345 E / URF218 E / URF363 Z)`;
                  showToast(warnMsg, "warning", 4500);
                }
              }
            } else {
              const prevMod = (curHs && curHs._m17PrevModuleBeforeEcho) || "C";
              if (curHs) curHs._m17ActiveEchoMod = "";
              await _sendM17ModuleUpdate(card, curCid, { module: prevMod });
              if (typeof showToast === "function") {
                const msg = window.t
                  ? window.t("m17.echo_off_toast", { mod: prevMod }, `Возврат из Echo на Module ${prevMod}`)
                  : `Возврат из Echo на Module ${prevMod}`;
                showToast(msg, "info", 2000);
              }
            }
          } catch (err) {
            console.warn("[M17] echo toggle failed:", err);
          }
          return;
        }

        openM17ModulesPicker(card, curCid, tripleBtn);
      });
    }
  }

  if (bar) {
    bar.style.display = "flex";
    const modSpan = bar.querySelector(".m17-mod-val");
    if (modSpan) modSpan.textContent = modVal;
    const canSpan = bar.querySelector(".m17-can-val");
    if (canSpan) canSpan.textContent = String(canVal);
    const lmBtn = bar.querySelector(".btn-m17-link-mode");
    const lmSpan = bar.querySelector(".m17-link-mode-val");
    if (lmSpan) lmSpan.textContent = linkMode === "lstn" ? "LSTN" : "CONN";
    if (lmBtn) lmBtn.classList.toggle("is-lstn", linkMode === "lstn");
    const codecSpan = bar.querySelector(".m17-codec-val");
    if (codecSpan) codecSpan.textContent = codecMode;

    if (!bar._m17Wired) {
      bar._m17Wired = true;
      const sendModUpdate = (patch) => _sendM17ModuleUpdate(card, cid, patch).catch(err => {
        console.warn("[M17] module update failed:", err);
      });

      const modBtn = bar.querySelector(".btn-m17-mod");
      if (modBtn) {
        modBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
          openM17ModulesPicker(card, curCid, modBtn);
        });
      }
      const canBtn = bar.querySelector(".btn-m17-can");
      if (canBtn) {
        canBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const curC = parseInt(bar.querySelector(".m17-can-val")?.textContent || "0", 10) || 0;
          sendModUpdate({ can: (curC + 1) % 16 });
        });
      }
      if (lmBtn) {
        lmBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const curLm = (bar.querySelector(".m17-link-mode-val")?.textContent || "CONN").trim().toLowerCase();
          sendModUpdate({ link_mode: curLm === "lstn" ? "conn" : "lstn" });
        });
      }
      const codecBtn = bar.querySelector(".btn-m17-codec");
      if (codecBtn) {
        codecBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const curCd = (bar.querySelector(".m17-codec-val")?.textContent || "3200").trim();
          sendModUpdate({ codec_mode: curCd === "3200" ? "1600" : "3200" });
        });
      }
    }
  }

  const quickInput = card.querySelector(".quick-tg-input");
  if (quickInput) {
    quickInput.placeholder = window.t ? window.t("m17.quick_input_placeholder", {}, "M17-M17 C / MOD") : "M17-M17 C / MOD";
  }
  const pttTarget = card.querySelector(".ptt-tg-id, .ptt-target-label");
  if (pttTarget) {
    pttTarget.textContent = linkMode === "lstn" ? `${refName} ${modVal} (LSTN)` : `${refName} ${modVal}`;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// D-STAR PROTOCOL CARD PANEL & DASHBOARD
// ═════════════════════════════════════════════════════════════════════════

export function isDstarDashAutoOpenEnabled(cid = "default") {
  try {
    const val = hasServerCollectionKey("dstar_dash_auto", cid)
      ? getServerCollectionValue("dstar_dash_auto", cid)
      : localStorage.getItem(`proxdmr_dstar_dash_auto_${cid}`);
    if (val === true || val === 1 || val === "1" || val === "true") return true;
    if (val === false || val === 0 || val === "0" || val === "false") return false;
  } catch (_) {}
  return false;
}

export function setDstarDashAutoOpen(cid = "default", enabled = false) {
  try {
    setServerCollectionKey("dstar_dash_auto", cid, enabled ? "1" : "0", "proxdmr_dstar_dash_auto_", false);
  } catch (_) {}
}

function _ensureDstarDashDrawer(card) {
  let drawer = card.querySelector(".dstar-dash-drawer");
  if (!drawer) {
    drawer = document.createElement("div");
    drawer.className = "dstar-dash-drawer";
    drawer.style.display = "none";
    const body = card.querySelector(".radio-body") || card;
    body.appendChild(drawer);
  }
  return drawer;
}

function _stopDstarDashTimer(card) {
  if (card && card._dstarDashTimer) {
    clearInterval(card._dstarDashTimer);
    card._dstarDashTimer = null;
  }
}

async function _sendDstarModuleUpdate(card, cid, payload) {
  const resp = await fetch("/api/dstar/module", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hotspot_id: cid, ...payload })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  const data = await resp.json().catch(() => ({}));
  if (data && data.hotspot && card) {
    updateCardDstarPanel(card, data.hotspot);
  }
  return data;
}

export async function connectDstarRef(card, cid, ref, moduleLetter = "B") {
  const host = ref.host || ref.ip || "";
  const port = Number(ref.port || 30001);
  const protocol = ref.protocol || "dextra";
  const reflector = String(ref.designator || ref.id || "").trim();
  const resp = await fetch("/api/dstar/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hotspot_id: cid,
      host,
      port,
      protocol,
      reflector,
      module: moduleLetter
    })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err.detail || `HTTP ${resp.status}`;
    if (typeof showToast === "function") showToast(msg, "error", 3500);
    throw new Error(msg);
  }
  const data = await resp.json().catch(() => ({}));
  if (data && data.hotspot && card) {
    updateCardDstarPanel(card, data.hotspot);
  }
  return data;
}

let _dstarModulesPopoverEl = null;
let _dstarModulesPopoverHotspotId = null;

function _closeDstarModulesPopover() {
  if (_dstarModulesPopoverEl) {
    _dstarModulesPopoverEl.remove();
    _dstarModulesPopoverEl = null;
    _dstarModulesPopoverHotspotId = null;
  }
}

export async function openDstarModulesPopover(card, cid, anchorEl) {
  const curCid = resolveHotspotId((card && card.dataset.hotspotId) || cid || "default");
  if (_dstarModulesPopoverEl && _dstarModulesPopoverHotspotId === curCid) {
    _closeDstarModulesPopover();
    return;
  }
  _closeDstarModulesPopover();

  const targetHs = getCurrentHotspots().find(h => h.id === curCid) || null;
  let currentMod = String((targetHs && targetHs.dstar_module) || "B").toUpperCase().slice(0, 1) || "B";
  const modulesList = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const popover = document.createElement("div");
  popover.className = "dstar-modules-popover";
  popover.innerHTML = `
    <div class="dstar-modules-popover-head">
      <span class="dstar-modules-popover-title">D-STAR Modules</span>
      <button type="button" class="dstar-modules-popover-close">✕</button>
    </div>
    <div class="dstar-modules-grid">
      ${modulesList.map(m => `
        <button type="button" class="btn-dstar-mod-pick${m === currentMod ? " is-active" : ""}" data-mod="${m}">${m}</button>
      `).join("")}
    </div>
  `;

  popover.querySelector(".dstar-modules-popover-close").addEventListener("click", (e) => {
    e.stopPropagation();
    _closeDstarModulesPopover();
  });

  popover.querySelectorAll(".btn-dstar-mod-pick").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newMod = btn.getAttribute("data-mod");
      if (!newMod) return;
      _closeDstarModulesPopover();
      try {
        await _sendDstarModuleUpdate(card, curCid, { module: newMod });
      } catch (err) {
        if (typeof showToast === "function") showToast(err.message, "error", 3000);
      }
    });
  });

  const anchorRect = (anchorEl || card).getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.top = `${Math.min(window.innerHeight - 200, anchorRect.bottom + 6)}px`;
  popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 220, anchorRect.left))}px`;
  popover.style.zIndex = "10040";
  document.body.appendChild(popover);
  _dstarModulesPopoverEl = popover;
  _dstarModulesPopoverHotspotId = curCid;

  const onDocClick = (e) => {
    if (!popover.contains(e.target) && (!anchorEl || !anchorEl.contains(e.target))) {
      _closeDstarModulesPopover();
      document.removeEventListener("pointerdown", onDocClick);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", onDocClick), 50);
}

export async function renderDstarReflectorDashboard(card, cid, force = false) {
  const drawer = _ensureDstarDashDrawer(card);
  const curCid = resolveHotspotId((card && card.dataset.hotspotId) || cid || "default");
  try {
    const resp = await fetch(`/api/dstar/connected?hotspot_id=${encodeURIComponent(curCid)}&force=${force ? 1 : 0}`);
    if (!resp.ok) return;
    const data = await resp.json().catch(() => ({}));
    if (data.status !== "ok") return;

    const ref = String(data.reflector || "XLX250").trim();
    const mod = String(data.module || "B").toUpperCase().slice(0, 1) || "B";
    const proto = String(data.protocol || "dextra").toUpperCase();
    const dashUrl = String(data.dashboard_url || "").trim();
    const linksCount = Number(data.links_count || 0);
    const clientsCount = Number(data.clients_count || 0);
    const lastHeard = Array.isArray(data.last_heard) ? data.last_heard : [];

    const lhHtml = lastHeard.length > 0
      ? lastHeard.map(item => {
        const cs = safeEscapeHtml(String(item.callsign || item.src || "—"));
        const tm = safeEscapeHtml(String(item.time || item.ago || ""));
        const txt = safeEscapeHtml(String(item.text || item.slow_data || ""));
        return `<div class="dstar-dash-lh-row"><span class="dstar-dash-lh-cs">${cs}</span>${txt ? `<span class="dstar-dash-lh-txt">${txt}</span>` : ""}<span class="dstar-dash-lh-tm">${tm}</span></div>`;
      }).join("")
      : `<div class="dstar-dash-empty">${safeEscapeHtml(window.t ? window.t("dstar.dash_empty", {}, "Нет недавних вызовов") : "Нет недавних вызовов")}</div>`;

    drawer.innerHTML = `
      <div class="dstar-dash-head">
        <div class="dstar-dash-title-wrap">
          <span class="dstar-dash-ref">${safeEscapeHtml(ref)} ${safeEscapeHtml(mod)}</span>
          <span class="dstar-engine-badge">${safeEscapeHtml(proto)}</span>
          <span class="dstar-dash-stat">Links: <strong>${linksCount}</strong></span>
          <span class="dstar-dash-stat">Clients: <strong>${clientsCount}</strong></span>
        </div>
        <div class="dstar-dash-actions">
          <button type="button" class="dstar-dash-btn-refresh" title="Refresh">🔄</button>
          ${dashUrl ? `<a class="dstar-dash-ext-link" href="${safeEscapeHtml(dashUrl)}" target="_blank" rel="noopener noreferrer" title="Web Dashboard">↗</a>` : ""}
          <button type="button" class="dstar-dash-btn-close" title="Close">✕</button>
        </div>
      </div>
      <div class="dstar-dash-lh-title">Last Heard (Slow Data & Calls)</div>
      <div class="dstar-dash-lh-list">${lhHtml}</div>
    `;

    const rBtn = drawer.querySelector(".dstar-dash-btn-refresh");
    if (rBtn) rBtn.addEventListener("click", (e) => { e.stopPropagation(); renderDstarReflectorDashboard(card, curCid, true); });
    const cBtn = drawer.querySelector(".dstar-dash-btn-close");
    if (cBtn) {
      cBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const targetHs = getCurrentHotspots().find(h => h.id === curCid);
        if (targetHs) {
          targetHs._dstarDashOpen = false;
          targetHs._dstarDashManuallyClosed = true;
        }
        const pair = card.querySelector(".control-pair-btn.dstar-dash-pair");
        if (pair) pair.classList.remove("dash-open");
        drawer.style.display = "none";
        _stopDstarDashTimer(card);
      });
    }

    if (!card._dstarDashTimer) {
      card._dstarDashTimer = setInterval(() => {
        const hsNow = getCurrentHotspots().find(h => h.id === curCid);
        if (!card.isConnected || card.classList.contains("hidden") || !hsNow || !hsNow._dstarDashOpen) {
          _stopDstarDashTimer(card);
          return;
        }
        renderDstarReflectorDashboard(card, curCid, false);
      }, 30000);
    }
  } catch (err) {
    console.warn("[D-STAR] dashboard render failed:", err);
  }
}

export function updateCardDstarPanel(card, hs) {
  if (!card) return;
  const targetHs = hs || (card.dataset.hotspotId ? (getCurrentHotspots().find(h => h.id === card.dataset.hotspotId) || null) : null) || (getCurrentHotspots()[0] || null);
  const isDstarNet = ((targetHs && targetHs.network_type) || card.dataset.networkType || "bm").toLowerCase() === "dstar";
  card.classList.toggle("card-net-dstar", isDstarNet);

  const bar = card.querySelector(".dstar-control-bar");
  const dstarDashPairExisting = card.querySelector(".control-pair-btn.dstar-dash-pair");
  const dstarDashDrawerExisting = card.querySelector(".dstar-dash-drawer");
  const dstarTripleExisting = card.querySelector(".btn-dstar-triple");

  if (!isDstarNet) {
    if (bar) bar.style.display = "none";
    if (dstarDashPairExisting) dstarDashPairExisting.style.display = "none";
    if (dstarDashDrawerExisting) dstarDashDrawerExisting.style.display = "none";
    if (dstarTripleExisting) dstarTripleExisting.style.display = "none";
    _stopDstarDashTimer(card);
    return;
  }

  card.dataset.networkType = "dstar";
  const cid = (targetHs && targetHs.id) || card.dataset.hotspotId || "default";
  const vfoTs1 = card.querySelector(".vfo-ts1-row");
  const vfoTs2 = card.querySelector(".vfo-ts2-row");
  const apiRow = card.querySelector(".api-status-row");
  if (vfoTs1) vfoTs1.style.removeProperty("display");
  if (vfoTs2) vfoTs2.style.setProperty("display", "none", "important");
  if (apiRow) apiRow.style.setProperty("display", "none", "important");

  const dsdPair = card.querySelector(".control-pair-btn.dsd-pair, .control-pair-btn.ambe-pair");
  if (dsdPair) dsdPair.style.setProperty("display", "none", "important");
  const btnSrchTg = card.querySelector(".btn-srch-tg-id");
  const btnAslDir = card.querySelector(".btn-asl-nodes-dir");
  const btnYsfDir = card.querySelector(".btn-ysf-rooms-dir");
  const m17Triple = card.querySelector(".btn-m17-triple");
  const svxTriple = card.querySelector(".btn-svx-triple");
  if (btnSrchTg) btnSrchTg.style.display = "none";
  if (btnAslDir) btnAslDir.style.display = "none";
  if (btnYsfDir) btnYsfDir.style.display = "none";
  if (m17Triple) m17Triple.style.display = "none";
  if (svxTriple) svxTriple.style.display = "none";

  const audioRxPair = card.querySelector(".control-pair-btn.audio-rx-pair");
  let dstarDashPair = dstarDashPairExisting;
  if (!dstarDashPair && audioRxPair && audioRxPair.parentElement) {
    dstarDashPair = document.createElement("div");
    dstarDashPair.className = "control-pair-btn dstar-dash-pair";
    const dstarDashBtnTitle = window.t ? window.t("dstar.dash_btn_title", {}, "Открыть / закрыть живой дашборд рефлектора D-STAR") : "Открыть / закрыть живой дашборд рефлектора D-STAR";
    const dstarDashBtnLabel = window.t ? window.t("dstar.dash_btn_label", {}, "Дашборд") : "Дашборд";
    const dstarDashAutoTitle = window.t ? window.t("dstar.dash_auto_title", {}, "Автооткрытие дашборда D-STAR при подключении") : "Автооткрытие дашборда D-STAR при подключении";
    dstarDashPair.innerHTML = `
      <button type="button" class="btn-action-trigger btn-dstar-dash-trigger" title="${safeEscapeHtml(dstarDashBtnTitle)}" data-i18n-title="dstar.dash_btn_title">
        <span class="btn-action-label" data-i18n="dstar.dash_btn_label">${safeEscapeHtml(dstarDashBtnLabel)}</span>
      </button>
      <div class="preset-dropdown-wrapper dstar-dash-auto-wrap" title="${safeEscapeHtml(dstarDashAutoTitle)}" data-i18n-title="dstar.dash_auto_title">
        <label class="dstar-dash-auto-label">
          <input type="checkbox" class="chk-dstar-dash-auto" aria-label="${safeEscapeHtml(dstarDashAutoTitle)}" data-i18n-aria-label="dstar.dash_auto_title" />
        </label>
      </div>
    `;
    audioRxPair.parentElement.insertBefore(dstarDashPair, audioRxPair);
  }

  const isCardOnline = Boolean(
    (targetHs && (targetHs.is_connected || targetHs.online || targetHs.bm_state === "ONLINE")) ||
    card.querySelector(".status-badge.status-online")
  );
  if (targetHs && isCardOnline && isDstarDashAutoOpenEnabled(cid) && !targetHs._dstarDashManuallyClosed && !targetHs._dstarDashOpen) {
    targetHs._dstarDashOpen = true;
  }

  if (dstarDashPair) {
    dstarDashPair.style.display = "inline-flex";
    const isDashOpen = Boolean(targetHs && targetHs._dstarDashOpen);
    dstarDashPair.classList.toggle("dash-open", isDashOpen);
    const drawer = _ensureDstarDashDrawer(card);
    if (drawer) {
      drawer.style.display = isDashOpen ? "block" : "none";
    }
    if (isDashOpen) {
      renderDstarReflectorDashboard(card, cid, false);
    } else {
      _stopDstarDashTimer(card);
    }

    const dashTrigger = dstarDashPair.querySelector(".btn-dstar-dash-trigger");
    const autoWrap = dstarDashPair.querySelector(".dstar-dash-auto-wrap");
    const autoChk = dstarDashPair.querySelector(".chk-dstar-dash-auto");
    if (autoChk) {
      autoChk.checked = isDstarDashAutoOpenEnabled(cid);
    }
    if (dashTrigger && !dashTrigger._dstarWired) {
      dashTrigger._dstarWired = true;
      dashTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
        const curHs = getCurrentHotspots().find(h => h.id === curCid);
        if (!curHs) return;
        curHs._dstarDashOpen = !curHs._dstarDashOpen;
        curHs._dstarDashManuallyClosed = !curHs._dstarDashOpen;
        dstarDashPair.classList.toggle("dash-open", curHs._dstarDashOpen);
        if (curHs._dstarDashOpen) {
          renderDstarReflectorDashboard(card, curCid, true);
        } else {
          const d = card.querySelector(".dstar-dash-drawer");
          if (d) d.style.display = "none";
          _stopDstarDashTimer(card);
        }
      });
    }
    if (autoWrap && autoChk && !autoChk._dstarWired) {
      autoChk._dstarWired = true;
      autoWrap.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.target !== autoChk) {
          autoChk.checked = !autoChk.checked;
          autoChk.dispatchEvent(new Event("change"));
        }
      });
      autoChk.addEventListener("change", (e) => {
        e.stopPropagation();
        const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
        setDstarDashAutoOpen(curCid, Boolean(autoChk.checked));
      });
    }
  }

  const modVal = String((targetHs && targetHs.dstar_module) || "B").toUpperCase().slice(0, 1) || "B";
  const protoVal = String((targetHs && targetHs.dstar_protocol) || "dextra").toUpperCase();
  const refName = String((targetHs && (targetHs.dstar_reflector || targetHs.dstar_reflector_name)) || "XLX250").trim();

  // Mount & update triple button REF -Modules- ECHO
  let tripleBtn = dstarTripleExisting;
  if (!tripleBtn) {
    const pttSideCluster = card.querySelector(".ptt-side-cluster");
    if (pttSideCluster) {
      tripleBtn = document.createElement("div");
      tripleBtn.className = "btn-srch-tg-id btn-dstar-triple";
      const tRef = window.t ? window.t("dstar.triple_ref_title", {}, "Каталог рефлекторов D-STAR") : "Каталог рефлекторов D-STAR";
      const tMod = window.t ? window.t("dstar.triple_mod_title", {}, "Выбор модуля A–Z") : "Выбор модуля A–Z";
      const tEcho = window.t ? window.t("dstar.triple_echo_title", {}, "Echo Test (переключить на модуль эха)") : "Echo Test (переключить на модуль эха)";
      tripleBtn.innerHTML = `
        <span class="m17-seg m17-seg-ref" data-action="ref" title="${safeEscapeHtml(tRef)}" data-i18n-title="dstar.triple_ref_title">REF</span>
        <span class="m17-seg m17-seg-mod" data-action="modules" title="${safeEscapeHtml(tMod)}" data-i18n-title="dstar.triple_mod_title">Mod</span>
        <span class="m17-seg m17-seg-echo" data-action="echo" title="${safeEscapeHtml(tEcho)}" data-i18n-title="dstar.triple_echo_title">ECHO</span>
      `;
      pttSideCluster.appendChild(tripleBtn);
    }
  }
  if (tripleBtn) {
    tripleBtn.style.display = "inline-flex";
    const echoSeg = tripleBtn.querySelector(".m17-seg-echo");
    if (echoSeg) {
      echoSeg.classList.toggle("is-echo-active", modVal === "E");
    }
    if (!tripleBtn._dstarWired) {
      tripleBtn._dstarWired = true;
      tripleBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
        const curHs = getCurrentHotspots().find(h => h.id === curCid);
        const curMod = String((curHs && curHs.dstar_module) || "B").toUpperCase().slice(0, 1) || "B";
        const seg = e.target.closest("[data-action]");
        const action = seg ? seg.getAttribute("data-action") : "modules";

        if (action === "ref") {
          if (typeof window.openMyContactsModal === "function") {
            window.openMyContactsModal(curCid, "dstar_dir");
          }
          return;
        }
        if (action === "echo") {
          const targetEchoMod = "E";
          if (curMod !== targetEchoMod) {
            if (curHs) curHs._dstarPrevModuleBeforeEcho = curMod;
            await _sendDstarModuleUpdate(card, curCid, { module: targetEchoMod });
            if (typeof showToast === "function") {
              const echoOnMsg = window.t
                ? window.t("dstar.echo_on_toast", { mod: targetEchoMod, prev: curMod }, `Echo-тест: переключено на Module ${targetEchoMod} (повторный клик вернёт Module ${curMod})`)
                : `Echo-тест: переключено на Module ${targetEchoMod} (повторный клик вернёт Module ${curMod})`;
              showToast(echoOnMsg, "info", 2800);
            }
          } else {
            const prevMod = (curHs && curHs._dstarPrevModuleBeforeEcho) || "B";
            await _sendDstarModuleUpdate(card, curCid, { module: prevMod });
            if (typeof showToast === "function") {
              const echoOffMsg = window.t
                ? window.t("dstar.echo_off_toast", { mod: prevMod }, `Возврат на рабочий Module ${prevMod}`)
                : `Возврат на рабочий Module ${prevMod}`;
              showToast(echoOffMsg, "success", 2000);
            }
          }
          return;
        }
        openDstarModulesPopover(card, curCid, tripleBtn);
      });
    }
  }

  // Mount & update .dstar-control-bar
  let dstarBar = bar;
  if (!dstarBar) {
    const parent = card.querySelector(".radio-header") || card;
    dstarBar = document.createElement("div");
    dstarBar.className = "dstar-control-bar";
    const barRefT = window.t ? window.t("dstar.bar_ref_title", {}, "Рефлектор D-STAR") : "Рефлектор D-STAR";
    const barModT = window.t ? window.t("dstar.triple_mod_title", {}, "Выбор модуля A–Z") : "Выбор модуля A–Z";
    const barProtoT = window.t ? window.t("dstar.bar_proto_title", {}, "Протокол D-STAR (DExtra / DCS / DPlus)") : "Протокол D-STAR (DExtra / DCS / DPlus)";
    const barDashT = window.t ? window.t("dstar.ref_dashboard_title", {}, "Открыть дашборд") : "Открыть дашборд";
    dstarBar.innerHTML = `
      <button type="button" class="dstar-bar-chip btn-dstar-bar-ref" title="${safeEscapeHtml(barRefT)}" data-i18n-title="dstar.bar_ref_title">
        <span class="dstar-bar-label">REF:</span> <span class="dstar-ref-val">${safeEscapeHtml(refName)} ${safeEscapeHtml(modVal)}</span>
      </button>
      <button type="button" class="dstar-bar-chip btn-dstar-bar-mod" title="${safeEscapeHtml(barModT)}" data-i18n-title="dstar.triple_mod_title">
        <span class="dstar-bar-label">MOD:</span> <span class="dstar-mod-val">${safeEscapeHtml(modVal)}</span>
      </button>
      <button type="button" class="dstar-bar-chip btn-dstar-bar-proto" title="${safeEscapeHtml(barProtoT)}" data-i18n-title="dstar.bar_proto_title">
        <span class="dstar-bar-label">PROTO:</span> <span class="dstar-proto-val">${safeEscapeHtml(protoVal)}</span>
      </button>
      <button type="button" class="dstar-bar-chip btn-dstar-bar-dash" title="${safeEscapeHtml(barDashT)}" data-i18n-title="dstar.ref_dashboard_title">
        <span class="dstar-bar-label">DASH:</span> <span class="dstar-dash-val">LIVE</span>
      </button>
    `;
    parent.appendChild(dstarBar);
  }
  if (dstarBar) {
    dstarBar.style.display = "flex";
    const refValEl = dstarBar.querySelector(".dstar-ref-val");
    if (refValEl) refValEl.textContent = `${refName} ${modVal}`;
    const modValEl = dstarBar.querySelector(".dstar-mod-val");
    if (modValEl) modValEl.textContent = modVal;
    const protoValEl = dstarBar.querySelector(".dstar-proto-val");
    if (protoValEl) protoValEl.textContent = protoVal;

    if (!dstarBar._wired) {
      dstarBar._wired = true;
      const refBtn = dstarBar.querySelector(".btn-dstar-bar-ref");
      if (refBtn) {
        refBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
          openDstarModulesPopover(card, curCid, refBtn);
        });
      }
      const modBtn = dstarBar.querySelector(".btn-dstar-bar-mod");
      if (modBtn) {
        modBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
          openDstarModulesPopover(card, curCid, modBtn);
        });
      }
      const protoBtn = dstarBar.querySelector(".btn-dstar-bar-proto");
      if (protoBtn) {
        protoBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
          const curHs = getCurrentHotspots().find(h => h.id === curCid);
          const curProto = String((curHs && curHs.dstar_protocol) || "dextra").toLowerCase();
          const nextProto = curProto === "dextra" ? "dcs" : (curProto === "dcs" ? "dplus" : "dextra");
          _sendDstarModuleUpdate(card, curCid, { protocol: nextProto });
        });
      }
      const dashBtn = dstarBar.querySelector(".btn-dstar-bar-dash");
      if (dashBtn) {
        dashBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
          const curHs = getCurrentHotspots().find(h => h.id === curCid);
          if (!curHs) return;
          curHs._dstarDashOpen = !curHs._dstarDashOpen;
          if (dstarDashPair) dstarDashPair.classList.toggle("dash-open", curHs._dstarDashOpen);
          const d = card.querySelector(".dstar-dash-drawer");
          if (d) d.style.display = curHs._dstarDashOpen ? "block" : "none";
          if (curHs._dstarDashOpen) {
            renderDstarReflectorDashboard(card, curCid, true);
          } else {
            _stopDstarDashTimer(card);
          }
        });
      }
    }
  }

  const quickInput = card.querySelector(".quick-tg-input");
  if (quickInput) {
    quickInput.placeholder = window.t ? window.t("dstar.quick_input_placeholder", {}, "XLX250 B / MOD") : "XLX250 B / MOD";
  }
  const pttTarget = card.querySelector(".ptt-tg-id, .ptt-target-label");
  if (pttTarget) {
    pttTarget.textContent = `${refName} ${modVal}`;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SVXREFLECTOR CARD PANEL & DASHBOARD
// ═════════════════════════════════════════════════════════════════════════

export function isSvxDashAutoOpenEnabled(cid = "default") {
  try {
    const val = hasServerCollectionKey("svx_dash_auto", cid)
      ? getServerCollectionValue("svx_dash_auto", cid)
      : localStorage.getItem(`proxdmr_svx_dash_auto_${cid}`);
    if (val === true || val === 1 || val === "1" || val === "true") return true;
    if (val === false || val === 0 || val === "0" || val === "false") return false;
  } catch (_) {}
  return false;
}

export function setSvxDashAutoOpen(cid = "default", enabled = false) {
  try {
    setServerCollectionKey("svx_dash_auto", cid, enabled ? "1" : "0", "proxdmr_svx_dash_auto_", false);
  } catch (_) {}
}

function _ensureSvxDashDrawer(card) {
  let drawer = card.querySelector(".svx-dash-drawer");
  if (!drawer) {
    drawer = document.createElement("div");
    drawer.className = "svx-dash-drawer";
    drawer.style.display = "none";
    const body = card.querySelector(".radio-body") || card;
    body.appendChild(drawer);
  }
  return drawer;
}

function _stopSvxDashTimer(card) {
  if (card && card._svxDashTimer) {
    clearInterval(card._svxDashTimer);
    card._svxDashTimer = null;
  }
}

export async function selectSvxTg(card, cid, tgNumber) {
  const resp = await fetch("/api/svx/tg", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hotspot_id: cid, tg: Number(tgNumber) })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  const data = await resp.json().catch(() => ({}));
  if (data && data.hotspot && card) {
    updateCardSvxPanel(card, data.hotspot);
  }
  if (typeof showToast === "function") {
    const label = Number(tgNumber) === 0 ? "TG 0 (Standby)" : `TG ${tgNumber}`;
    const selMsg = window.t ? window.t("svx.tg_selected_toast", { label }, `Выбрана группа ${label}`) : `Выбрана группа ${label}`;
    showToast(selMsg, "success", 2000);
  }
  return data;
}

export async function setSvxMonitorTgs(card, cid, tgsArray) {
  const resp = await fetch("/api/svx/monitor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hotspot_id: cid, tgs: tgsArray.map(Number) })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  const data = await resp.json().catch(() => ({}));
  if (data && data.hotspot && card) {
    updateCardSvxPanel(card, data.hotspot);
  }
  return data;
}

let _svxMonitorPopoverEl = null;
let _svxMonitorPopoverHotspotId = null;

function _closeSvxMonitorPopover() {
  if (_svxMonitorPopoverEl) {
    _svxMonitorPopoverEl.remove();
    _svxMonitorPopoverEl = null;
    _svxMonitorPopoverHotspotId = null;
  }
}

export async function openSvxMonitorPopover(card, cid, anchorEl) {
  const curCid = resolveHotspotId((card && card.dataset.hotspotId) || cid || "default");
  if (_svxMonitorPopoverEl && _svxMonitorPopoverHotspotId === curCid) {
    _closeSvxMonitorPopover();
    return;
  }
  _closeSvxMonitorPopover();

  const targetHs = getCurrentHotspots().find(h => h.id === curCid) || null;
  const curMonitor = Array.isArray(targetHs && targetHs.svx_monitor_tgs) ? [...targetHs.svx_monitor_tgs] : [];

  const popover = document.createElement("div");
  popover.className = "svx-monitor-popover";
  const monPopTitle = window.t ? window.t("svx.mon_popover_title", {}, "Мониторинг TG (SVX)") : "Мониторинг TG (SVX)";
  const monPopEmpty = window.t ? window.t("svx.mon_popover_empty", {}, "Нет групп в мониторинге") : "Нет групп в мониторинге";
  const monPopPh = window.t ? window.t("svx.quick_tg_placeholder", {}, "Номер TG") : "Номер TG";
  const monPopAdd = window.t ? window.t("svx.mon_popover_add_btn", {}, "+ Добавить") : "+ Добавить";
  popover.innerHTML = `
    <div class="svx-monitor-popover-head">
      <span class="svx-monitor-popover-title">${safeEscapeHtml(monPopTitle)}</span>
      <button type="button" class="svx-monitor-popover-close">✕</button>
    </div>
    <div class="svx-monitor-tgs-chips">
      ${curMonitor.length > 0 ? curMonitor.map(tg => `
        <span class="svx-mon-chip" data-tg="${tg}">
          TG ${tg} <button type="button" class="btn-del-mon" data-tg="${tg}">✕</button>
        </span>
      `).join("") : `<span class="svx-mon-empty">${safeEscapeHtml(monPopEmpty)}</span>`}
    </div>
    <div class="svx-monitor-add-row" style="display:flex;gap:6px;margin-top:8px;">
      <input type="number" class="form-input inp-new-mon-tg" placeholder="${safeEscapeHtml(monPopPh)}" style="width:110px;height:28px;padding:2px 6px;font-size:0.8rem;" />
      <button type="button" class="btn-primary btn-sm btn-add-mon-tg">${safeEscapeHtml(monPopAdd)}</button>
    </div>
  `;

  popover.querySelector(".svx-monitor-popover-close").addEventListener("click", (e) => {
    e.stopPropagation();
    _closeSvxMonitorPopover();
  });

  const wireDelButtons = () => {
    popover.querySelectorAll(".btn-del-mon").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const tgToRemove = Number(btn.getAttribute("data-tg"));
        const newMon = curMonitor.filter(t => t !== tgToRemove);
        await setSvxMonitorTgs(card, curCid, newMon);
        _closeSvxMonitorPopover();
        openSvxMonitorPopover(card, curCid, anchorEl);
      });
    });
  };
  wireDelButtons();

  const addBtn = popover.querySelector(".btn-add-mon-tg");
  const inp = popover.querySelector(".inp-new-mon-tg");
  if (addBtn && inp) {
    const doAdd = async () => {
      const tgToAdd = parseInt(inp.value.trim(), 10);
      if (isNaN(tgToAdd) || tgToAdd < 0) return;
      if (!curMonitor.includes(tgToAdd)) {
        curMonitor.push(tgToAdd);
        await setSvxMonitorTgs(card, curCid, curMonitor);
      }
      _closeSvxMonitorPopover();
      openSvxMonitorPopover(card, curCid, anchorEl);
    };
    addBtn.addEventListener("click", doAdd);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doAdd();
      }
    });
  }

  const anchorRect = (anchorEl || card).getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.top = `${Math.min(window.innerHeight - 200, anchorRect.bottom + 6)}px`;
  popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 240, anchorRect.left))}px`;
  popover.style.zIndex = "10040";
  document.body.appendChild(popover);
  _svxMonitorPopoverEl = popover;
  _svxMonitorPopoverHotspotId = curCid;

  const onDocClick = (e) => {
    if (!popover.contains(e.target) && (!anchorEl || !anchorEl.contains(e.target))) {
      _closeSvxMonitorPopover();
      document.removeEventListener("pointerdown", onDocClick);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", onDocClick), 50);
}

export async function renderSvxReflectorDashboard(card, cid, force = false) {
  const drawer = _ensureSvxDashDrawer(card);
  const curCid = resolveHotspotId((card && card.dataset.hotspotId) || cid || "default");
  try {
    const resp = await fetch(`/api/svx/connected?hotspot_id=${encodeURIComponent(curCid)}&force=${force ? 1 : 0}`);
    if (!resp.ok) return;
    const data = await resp.json().catch(() => ({}));
    if (data.status !== "ok") return;

    const host = String(data.host || "SVX").trim();
    const activeTg = Number(data.active_tg || 0);
    const talker = String(data.current_talker || "").trim();
    const monTgs = Array.isArray(data.monitor_tgs) ? data.monitor_tgs : [];
    const nodes = Array.isArray(data.connected_nodes) ? data.connected_nodes : [];
    const lastHeard = Array.isArray(data.last_heard) ? data.last_heard : [];
    const protoVer = String(data.proto_version || "2.0");

    const tgDisp = activeTg === 0 ? "0 (Standby)" : String(activeTg);
    const talkerActiveTxt = window.t ? window.t("svx.dash_talker_active", { talker: String(talker || ""), tg: activeTg }, `🎙️ Говорит: ${talker} на TG ${activeTg}`) : `🎙️ Говорит: ${talker} на TG ${activeTg}`;
    const talkerIdleTxt = window.t ? window.t("svx.dash_talker_idle", { tg: tgDisp }, `Эфир свободен · Активная TG ${tgDisp}`) : `Эфир свободен · Активная TG ${tgDisp}`;
    const talkerHtml = talker
      ? `<div class="svx-dash-talker-active">${safeEscapeHtml(talkerActiveTxt)}</div>`
      : `<div class="svx-dash-talker-idle">${safeEscapeHtml(talkerIdleTxt)}</div>`;

    const monChipsHtml = monTgs.length > 0
      ? monTgs.map(t => `<button type="button" class="svx-dash-mon-chip${t === activeTg ? " is-active" : ""}" data-tg="${t}">TG ${t}</button>`).join("")
      : `<span class="svx-dash-muted">—</span>`;

    const nodesHtml = nodes.length > 0
      ? nodes.map(n => `<span class="svx-dash-node">${safeEscapeHtml(String(n.callsign || n.name || n))}</span>`).join("")
      : `<span class="svx-dash-muted">—</span>`;

    const svxEmptyTxt = window.t ? window.t("svx.dash_empty", {}, "Нет недавних вызовов") : "Нет недавних вызовов";
    const lhHtml = lastHeard.length > 0
      ? lastHeard.map(item => {
        const cs = safeEscapeHtml(String(item.callsign || item.src || "—"));
        const tg = safeEscapeHtml(String(item.tg || ""));
        const tm = safeEscapeHtml(String(item.time || item.ago || ""));
        return `<div class="svx-dash-lh-row"><span class="svx-dash-lh-cs">${cs}</span>${tg ? `<span class="svx-dash-lh-tg">TG ${tg}</span>` : ""}<span class="svx-dash-lh-tm">${tm}</span></div>`;
      }).join("")
      : `<div class="svx-dash-empty">${safeEscapeHtml(svxEmptyTxt)}</div>`;

    drawer.innerHTML = `
      <div class="svx-dash-head">
        <div class="svx-dash-title-wrap">
          <span class="svx-dash-host">${safeEscapeHtml(host)}</span>
          <span class="svx-engine-badge">SVX V${safeEscapeHtml(protoVer)}</span>
          <span class="svx-dash-stat">Nodes: <strong>${nodes.length}</strong></span>
        </div>
        <div class="svx-dash-actions">
          <button type="button" class="svx-dash-btn-refresh" title="Refresh">🔄</button>
          <button type="button" class="svx-dash-btn-close" title="Close">✕</button>
        </div>
      </div>
      <div class="svx-dash-talker-box">${talkerHtml}</div>
      <div class="svx-dash-section-title">Monitor TGs</div>
      <div class="svx-dash-mon-bar">${monChipsHtml}</div>
      <div class="svx-dash-section-title">Connected Nodes (${nodes.length})</div>
      <div class="svx-dash-nodes-list">${nodesHtml}</div>
      <div class="svx-dash-section-title">Last Heard</div>
      <div class="svx-dash-lh-list">${lhHtml}</div>
    `;

    drawer.querySelectorAll(".svx-dash-mon-chip").forEach(chip => {
      chip.addEventListener("click", async (e) => {
        e.stopPropagation();
        const tg = chip.getAttribute("data-tg");
        if (tg !== null) {
          await selectSvxTg(card, curCid, Number(tg));
          renderSvxReflectorDashboard(card, curCid, false);
        }
      });
    });

    const rBtn = drawer.querySelector(".svx-dash-btn-refresh");
    if (rBtn) rBtn.addEventListener("click", (e) => { e.stopPropagation(); renderSvxReflectorDashboard(card, curCid, true); });
    const cBtn = drawer.querySelector(".svx-dash-btn-close");
    if (cBtn) {
      cBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const targetHs = getCurrentHotspots().find(h => h.id === curCid);
        if (targetHs) {
          targetHs._svxDashOpen = false;
          targetHs._svxDashManuallyClosed = true;
        }
        const pair = card.querySelector(".control-pair-btn.svx-dash-pair");
        if (pair) pair.classList.remove("dash-open");
        drawer.style.display = "none";
        _stopSvxDashTimer(card);
      });
    }

    if (!card._svxDashTimer) {
      card._svxDashTimer = setInterval(() => {
        const hsNow = getCurrentHotspots().find(h => h.id === curCid);
        if (!card.isConnected || card.classList.contains("hidden") || !hsNow || !hsNow._svxDashOpen) {
          _stopSvxDashTimer(card);
          return;
        }
        renderSvxReflectorDashboard(card, curCid, false);
      }, 30000);
    }
  } catch (err) {
    console.warn("[SVX] dashboard render failed:", err);
  }
}

export function updateCardSvxPanel(card, hs) {
  if (!card) return;
  const targetHs = hs || (card.dataset.hotspotId ? (getCurrentHotspots().find(h => h.id === card.dataset.hotspotId) || null) : null) || (getCurrentHotspots()[0] || null);
  const isSvxNet = ((targetHs && targetHs.network_type) || card.dataset.networkType || "bm").toLowerCase() === "svx";
  card.classList.toggle("card-net-svx", isSvxNet);

  const bar = card.querySelector(".svx-control-bar");
  const svxDashPairExisting = card.querySelector(".control-pair-btn.svx-dash-pair");
  const svxDashDrawerExisting = card.querySelector(".svx-dash-drawer");
  const svxTripleExisting = card.querySelector(".btn-svx-triple");

  if (!isSvxNet) {
    if (bar) bar.style.display = "none";
    if (svxDashPairExisting) svxDashPairExisting.style.display = "none";
    if (svxDashDrawerExisting) svxDashDrawerExisting.style.display = "none";
    if (svxTripleExisting) svxTripleExisting.style.display = "none";
    _stopSvxDashTimer(card);
    return;
  }

  card.dataset.networkType = "svx";
  const cid = (targetHs && targetHs.id) || card.dataset.hotspotId || "default";
  const vfoTs1 = card.querySelector(".vfo-ts1-row");
  const vfoTs2 = card.querySelector(".vfo-ts2-row");
  const apiRow = card.querySelector(".api-status-row");
  if (vfoTs1) vfoTs1.style.removeProperty("display");
  if (vfoTs2) vfoTs2.style.setProperty("display", "none", "important");
  if (apiRow) apiRow.style.setProperty("display", "none", "important");

  const dsdPair = card.querySelector(".control-pair-btn.dsd-pair, .control-pair-btn.ambe-pair");
  if (dsdPair) dsdPair.style.setProperty("display", "none", "important");
  const btnSrchTg = card.querySelector(".btn-srch-tg-id");
  const btnAslDir = card.querySelector(".btn-asl-nodes-dir");
  const btnYsfDir = card.querySelector(".btn-ysf-rooms-dir");
  const m17Triple = card.querySelector(".btn-m17-triple");
  const dstarTriple = card.querySelector(".btn-dstar-triple");
  if (btnSrchTg) btnSrchTg.style.display = "none";
  if (btnAslDir) btnAslDir.style.display = "none";
  if (btnYsfDir) btnYsfDir.style.display = "none";
  if (m17Triple) m17Triple.style.display = "none";
  if (dstarTriple) dstarTriple.style.display = "none";

  const audioRxPair = card.querySelector(".control-pair-btn.audio-rx-pair");
  let svxDashPair = svxDashPairExisting;
  if (!svxDashPair && audioRxPair && audioRxPair.parentElement) {
    svxDashPair = document.createElement("div");
    svxDashPair.className = "control-pair-btn svx-dash-pair";
    const svxDashBtnTitle = window.t ? window.t("svx.dash_btn_title", {}, "Открыть / закрыть живой дашборд SVXReflector") : "Открыть / закрыть живой дашборд SVXReflector";
    const svxDashBtnLabel = window.t ? window.t("svx.dash_btn_label", {}, "Дашборд") : "Дашборд";
    const svxDashAutoTitle = window.t ? window.t("svx.dash_auto_title", {}, "Автооткрытие дашборда SVXReflector при активности") : "Автооткрытие дашборда SVXReflector при активности";
    svxDashPair.innerHTML = `
      <button type="button" class="btn-action-trigger btn-svx-dash-trigger" title="${safeEscapeHtml(svxDashBtnTitle)}" data-i18n-title="svx.dash_btn_title">
        <span class="btn-action-label" data-i18n="svx.dash_btn_label">${safeEscapeHtml(svxDashBtnLabel)}</span>
      </button>
      <div class="preset-dropdown-wrapper svx-dash-auto-wrap" title="${safeEscapeHtml(svxDashAutoTitle)}" data-i18n-title="svx.dash_auto_title">
        <label class="svx-dash-auto-label">
          <input type="checkbox" class="chk-svx-dash-auto" aria-label="${safeEscapeHtml(svxDashAutoTitle)}" data-i18n-aria-label="svx.dash_auto_title" />
        </label>
      </div>
    `;
    audioRxPair.parentElement.insertBefore(svxDashPair, audioRxPair);
  }

  const isCardOnline = Boolean(
    (targetHs && (targetHs.is_connected || targetHs.online || targetHs.bm_state === "ONLINE")) ||
    card.querySelector(".status-badge.status-online")
  );
  if (targetHs && isCardOnline && isSvxDashAutoOpenEnabled(cid) && !targetHs._svxDashManuallyClosed && !targetHs._svxDashOpen) {
    targetHs._svxDashOpen = true;
  }

  if (svxDashPair) {
    svxDashPair.style.display = "inline-flex";
    const isDashOpen = Boolean(targetHs && targetHs._svxDashOpen);
    svxDashPair.classList.toggle("dash-open", isDashOpen);
    const drawer = _ensureSvxDashDrawer(card);
    if (drawer) {
      drawer.style.display = isDashOpen ? "block" : "none";
    }
    if (isDashOpen) {
      renderSvxReflectorDashboard(card, cid, false);
    } else {
      _stopSvxDashTimer(card);
    }

    const dashTrigger = svxDashPair.querySelector(".btn-svx-dash-trigger");
    const autoWrap = svxDashPair.querySelector(".svx-dash-auto-wrap");
    const autoChk = svxDashPair.querySelector(".chk-svx-dash-auto");
    if (autoChk) {
      autoChk.checked = isSvxDashAutoOpenEnabled(cid);
    }
    if (dashTrigger && !dashTrigger._svxWired) {
      dashTrigger._svxWired = true;
      dashTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
        const curHs = getCurrentHotspots().find(h => h.id === curCid);
        if (!curHs) return;
        curHs._svxDashOpen = !curHs._svxDashOpen;
        curHs._svxDashManuallyClosed = !curHs._svxDashOpen;
        svxDashPair.classList.toggle("dash-open", curHs._svxDashOpen);
        if (curHs._svxDashOpen) {
          renderSvxReflectorDashboard(card, curCid, true);
        } else {
          const d = card.querySelector(".svx-dash-drawer");
          if (d) d.style.display = "none";
          _stopSvxDashTimer(card);
        }
      });
    }
    if (autoWrap && autoChk && !autoChk._svxWired) {
      autoChk._svxWired = true;
      autoWrap.addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.target !== autoChk) {
          autoChk.checked = !autoChk.checked;
          autoChk.dispatchEvent(new Event("change"));
        }
      });
      autoChk.addEventListener("change", (e) => {
        e.stopPropagation();
        const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
        setSvxDashAutoOpen(curCid, Boolean(autoChk.checked));
      });
    }
  }

  const curTg = Number((targetHs && targetHs.svx_tg !== undefined) ? targetHs.svx_tg : 240);
  const monCount = Array.isArray(targetHs && targetHs.svx_monitor_tgs) ? targetHs.svx_monitor_tgs.length : 0;
  const nodesCount = Number((targetHs && targetHs.svx_connected_nodes_count) || 0);

  // Mount & update triple button TG -Monitor- TG0
  let tripleBtn = svxTripleExisting;
  if (!tripleBtn) {
    const pttSideCluster = card.querySelector(".ptt-side-cluster");
    if (pttSideCluster) {
      tripleBtn = document.createElement("div");
      tripleBtn.className = "btn-srch-tg-id btn-svx-triple";
      const tSvxTg = window.t ? window.t("svx.triple_tg_title", {}, "Каталог разговорных групп SVX") : "Каталог разговорных групп SVX";
      const tSvxMon = window.t ? window.t("svx.triple_mon_title", {}, "Мониторинг групп SVX") : "Мониторинг групп SVX";
      const tSvxTg0 = window.t ? window.t("svx.triple_tg0_title", {}, "Standby / TG 0 (повторный клик вернёт группу)") : "Standby / TG 0 (повторный клик вернёт группу)";
      tripleBtn.innerHTML = `
        <span class="m17-seg svx-seg-tg" data-action="tg" title="${safeEscapeHtml(tSvxTg)}" data-i18n-title="svx.triple_tg_title">TG</span>
        <span class="m17-seg svx-seg-mon" data-action="monitor" title="${safeEscapeHtml(tSvxMon)}" data-i18n-title="svx.triple_mon_title">Mon</span>
        <span class="m17-seg svx-seg-tg0" data-action="tg0" title="${safeEscapeHtml(tSvxTg0)}" data-i18n-title="svx.triple_tg0_title">TG0</span>
      `;
      pttSideCluster.appendChild(tripleBtn);
    }
  }
  if (tripleBtn) {
    tripleBtn.style.display = "inline-flex";
    const tg0Seg = tripleBtn.querySelector(".svx-seg-tg0");
    if (tg0Seg) {
      tg0Seg.classList.toggle("is-tg0-active", curTg === 0);
    }
    if (!tripleBtn._svxWired) {
      tripleBtn._svxWired = true;
      tripleBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
        const curHs = getCurrentHotspots().find(h => h.id === curCid);
        const activeTgNow = Number((curHs && curHs.svx_tg !== undefined) ? curHs.svx_tg : 240);
        const seg = e.target.closest("[data-action]");
        const action = seg ? seg.getAttribute("data-action") : "tg";

        if (action === "tg") {
          if (typeof window.openMyContactsModal === "function") {
            window.openMyContactsModal(curCid, "svx_dir");
          }
          return;
        }
        if (action === "monitor") {
          openSvxMonitorPopover(card, curCid, tripleBtn);
          return;
        }
        if (action === "tg0") {
          if (activeTgNow !== 0) {
            if (curHs) curHs._svxPrevTgBeforeTg0 = activeTgNow;
            await selectSvxTg(card, curCid, 0);
          } else {
            const restore = (curHs && curHs._svxPrevTgBeforeTg0) || 240;
            await selectSvxTg(card, curCid, restore);
          }
        }
      });
    }
  }

  // Mount & update .svx-control-bar
  let svxBar = bar;
  if (!svxBar) {
    const parent = card.querySelector(".radio-header") || card;
    svxBar = document.createElement("div");
    svxBar.className = "svx-control-bar";
    const sBarTg = window.t ? window.t("svx.bar_tg_title", {}, "Выбор TG") : "Выбор TG";
    const sBarMon = window.t ? window.t("svx.bar_mon_title", {}, "Мониторинг TG") : "Мониторинг TG";
    const sBarNodes = window.t ? window.t("svx.bar_nodes_title", {}, "Подключённые узлы") : "Подключённые узлы";
    const sBarCodec = window.t ? window.t("svx.bar_codec_title", {}, "Кодек SVX") : "Кодек SVX";
    svxBar.innerHTML = `
      <button type="button" class="svx-bar-chip btn-svx-bar-tg" title="${safeEscapeHtml(sBarTg)}" data-i18n-title="svx.bar_tg_title">
        <span class="svx-bar-label">TG:</span> <span class="svx-tg-val">${curTg}</span>
      </button>
      <button type="button" class="svx-bar-chip btn-svx-bar-mon" title="${safeEscapeHtml(sBarMon)}" data-i18n-title="svx.bar_mon_title">
        <span class="svx-bar-label">MON:</span> <span class="svx-mon-val">${monCount}</span>
      </button>
      <button type="button" class="svx-bar-chip btn-svx-bar-nodes" title="${safeEscapeHtml(sBarNodes)}" data-i18n-title="svx.bar_nodes_title">
        <span class="svx-bar-label">NODES:</span> <span class="svx-nodes-val">${nodesCount}</span>
      </button>
      <button type="button" class="svx-bar-chip btn-svx-bar-codec" title="${safeEscapeHtml(sBarCodec)}" data-i18n-title="svx.bar_codec_title">
        <span class="svx-bar-label">OPUS</span>
      </button>
    `;
    parent.appendChild(svxBar);
  }
  if (svxBar) {
    svxBar.style.display = "flex";
    const tgValEl = svxBar.querySelector(".svx-tg-val");
    if (tgValEl) tgValEl.textContent = curTg === 0 ? "0 (Standby)" : curTg;
    const monValEl = svxBar.querySelector(".svx-mon-val");
    if (monValEl) monValEl.textContent = monCount;
    const nodesValEl = svxBar.querySelector(".svx-nodes-val");
    if (nodesValEl) nodesValEl.textContent = nodesCount;

    if (!svxBar._wired) {
      svxBar._wired = true;
      const tgBtn = svxBar.querySelector(".btn-svx-bar-tg");
      if (tgBtn) {
        tgBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
          if (typeof window.openMyContactsModal === "function") {
            window.openMyContactsModal(curCid, "svx_dir");
          }
        });
      }
      const monBtn = svxBar.querySelector(".btn-svx-bar-mon");
      if (monBtn) {
        monBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
          openSvxMonitorPopover(card, curCid, monBtn);
        });
      }
      const nodesBtn = svxBar.querySelector(".btn-svx-bar-nodes");
      if (nodesBtn) {
        nodesBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const curCid = resolveHotspotId(card.dataset.hotspotId || cid);
          const curHs = getCurrentHotspots().find(h => h.id === curCid);
          if (!curHs) return;
          curHs._svxDashOpen = !curHs._svxDashOpen;
          if (svxDashPair) svxDashPair.classList.toggle("dash-open", curHs._svxDashOpen);
          const d = card.querySelector(".svx-dash-drawer");
          if (d) d.style.display = curHs._svxDashOpen ? "block" : "none";
          if (curHs._svxDashOpen) {
            renderSvxReflectorDashboard(card, curCid, true);
          } else {
            _stopSvxDashTimer(card);
          }
        });
      }
    }
  }

  const quickInput = card.querySelector(".quick-tg-input");
  if (quickInput) {
    quickInput.placeholder = window.t ? window.t("svx.quick_input_placeholder", {}, "TG # (240, 250...)") : "TG # (240, 250...)";
  }
  const pttTarget = card.querySelector(".ptt-tg-id, .ptt-target-label");
  if (pttTarget) {
    pttTarget.textContent = curTg === 0 ? "TG 0 (Standby)" : `TG ${curTg}`;
  }
}
window.updateCardDstarPanel = updateCardDstarPanel;
window.updateCardSvxPanel = updateCardSvxPanel;
window.selectSvxTg = selectSvxTg;
window.connectDstarRef = connectDstarRef;
window.updateCardM17Panel = updateCardM17Panel;
window.testCurrentHotspotPassword = testCurrentHotspotPassword;
window.testCurrentHotspotApiKey = testCurrentHotspotApiKey;
window.resetTestCredentialBtn = resetTestCredentialBtn;

window.__proxdmr = window.__proxdmr || {};
window.__proxdmr.resetTestCredentialBtn = resetTestCredentialBtn;
window.__proxdmr.loadHotspots = loadHotspots;
window.__proxdmr.renderHotspotSelect = renderHotspotSelect;
window.__proxdmr.switchActiveHotspot = switchActiveHotspot;
window.__proxdmr.triggerAddNewHotspot = triggerAddNewHotspot;
window.__proxdmr.openHotspotSettings = openHotspotSettings;
window.__proxdmr.renderRadiosGrid = renderRadiosGrid;
window.__proxdmr.linkHotspotXlxModule = linkHotspotXlxModule;
window.__proxdmr.linkHotspotDmrPlusReflector = linkHotspotDmrPlusReflector;
window.__proxdmr.updateCardDmrPlusPanel = updateCardDmrPlusPanel;
window.__proxdmr.updateCardYsfPanel = updateCardYsfPanel;
window.__proxdmr.openXlxAllModulesPopover = openXlxAllModulesPopover;
window.__proxdmr.syncCollapsedHotspotStacks = syncCollapsedHotspotStacks;
window.__proxdmr.syncDesktopHotspotsTopAlignment = syncDesktopHotspotsTopAlignment;
window.syncDesktopHotspotsTopAlignment = syncDesktopHotspotsTopAlignment;
window.__proxdmr.scheduleDesktopHotspotsTopAlignment = scheduleDesktopHotspotsTopAlignment;
window.scheduleDesktopHotspotsTopAlignment = scheduleDesktopHotspotsTopAlignment;
window.__proxdmr.syncAslMatrixButtonsState = syncAslMatrixButtonsState;
window.__proxdmr.syncYsfMatrixButtonsState = syncYsfMatrixButtonsState;
window.__proxdmr.probeYsfMatrixRooms = probeYsfMatrixRooms;
window.__proxdmr.updateAslVfoHeader = updateAslVfoHeader;
window.__proxdmr.updateYsfVfoHeader = updateYsfVfoHeader;
window.__proxdmr.getYsfRoomShortInfo = getYsfRoomShortInfo;
window.__proxdmr.getAslNodeShortInfo = getAslNodeShortInfo;
window.__proxdmr.setAslProcBannerState = setAslProcBannerState;
window.__proxdmr.formatAslProcMessage = formatAslProcMessage;
window.__proxdmr.aslDisconnectNodeProcedure = aslDisconnectNodeProcedure;
window.__proxdmr.aslConnectNodeProcedure = aslConnectNodeProcedure;
window.__proxdmr.closeAslCardContextMenu = closeAslCardContextMenu;
window.__proxdmr.saveAslUserNodes = saveAslUserNodes;
window.__proxdmr.openAslCardContextMenu = openAslCardContextMenu;
window.__proxdmr.applyActiveHotspotToUI = applyActiveHotspotToUI;
window.__proxdmr.renderHotspotsList = renderHotspotsList;
window.__proxdmr.fetchBmMasters = fetchBmMasters;
window.__proxdmr.renderBmMastersDropdown = renderBmMastersDropdown;
window.__proxdmr.applyEditHsNetworkTypeUI = applyEditHsNetworkTypeUI;
window.__proxdmr.populateEditHotspotFormFields = populateEditHotspotFormFields;
window.__proxdmr.openEditHotspotForm = openEditHotspotForm;
window.__proxdmr.initHotspotsManager = initHotspotsManager;
window.__proxdmr.autoSaveExistingHotspotIfDirty = autoSaveExistingHotspotIfDirty;
window.__proxdmr.saveCurrentSettingsState = saveCurrentSettingsState;
window.__proxdmr.reorderHotspots = reorderHotspots;
window.__proxdmr.moveHotspotInOrder = moveHotspotInOrder;
window.__proxdmr.openHsTypeSelectModal = openHsTypeSelectModal;
window.__proxdmr.closeHsTypeSelectModal = closeHsTypeSelectModal;
window.__proxdmr.startCreateNewHotspotWithType = startCreateNewHotspotWithType;
window.__proxdmr.testCurrentHotspotPassword = testCurrentHotspotPassword;
window.__proxdmr.testCurrentHotspotApiKey = testCurrentHotspotApiKey;
window.__proxdmr.toggleCustomHsDropdown = toggleCustomHsDropdown;
window.__proxdmr.closeCustomHsDropdown = closeCustomHsDropdown;
window.ensurePrimaryHotspotHeaderButtons = ensurePrimaryHotspotHeaderButtons;
window.ensureTopToolbarControls = ensureTopToolbarControls;
window.renderToolbarHotspotSlots = renderToolbarHotspotSlots;
window.refreshToolbarProcessIndicators = refreshToolbarProcessIndicators;
window.registerToolbarProcessProvider = registerToolbarProcessProvider;
window.openHotspotArchiveModal = openHotspotArchiveModal;
window.closeHotspotArchiveModal = closeHotspotArchiveModal;
window.renderHotspotArchiveModal = renderHotspotArchiveModal;
window.__proxdmr.renderToolbarHotspotSlots = renderToolbarHotspotSlots;
window.__proxdmr.refreshToolbarProcessIndicators = refreshToolbarProcessIndicators;
window.__proxdmr.registerToolbarProcessProvider = registerToolbarProcessProvider;
window.__proxdmr.openHotspotArchiveModal = openHotspotArchiveModal;
window.__proxdmr.closeHotspotArchiveModal = closeHotspotArchiveModal;

window.addEventListener("languageChanged", () => {
  const editHsNetworkType = document.getElementById("editHsNetworkType");
  const editHsSelect = document.getElementById("editHsSelect");
  const curId = editHsSelect ? editHsSelect.value : "";
  const curHs = (window.currentHotspots || []).find(h => h && h.id === curId) || (window.currentHotspots || [])[0];
  const netType = (editHsNetworkType && editHsNetworkType.value) || (curHs && curHs.network_type) || "bm";
  applyEditHsNetworkTypeUI(netType, { applyDefaults: false, isNewHotspot: !curId || curId === "__new__" });
  if (curHs) {
    updateEditHsToolbarUI(curHs);
    if (window.isDemoMode) {
      const editHsCallsign = document.getElementById("editHsCallsign");
      const editHsTalkerAlias = document.getElementById("editHsTalkerAlias");
      if (editHsCallsign) editHsCallsign.value = window.t ? window.t("demo.your_callsign", {}, "Your Callsign") : "Your Callsign";
      if (editHsTalkerAlias) editHsTalkerAlias.value = window.t ? window.t("demo.your_name", {}, "Your Name") : "Your Name";
    }
  }
  renderBmMastersDropdown();
  ensureTopToolbarControls();
  renderToolbarHotspotSlots();
  if (_hotspotsLoadedOnce) {
    renderRadiosGrid();
  } else {
    const staticPrimary = document.getElementById("radioContainer");
    if (staticPrimary) {
      ensurePrimaryHotspotHeaderButtons(staticPrimary, false);
    }
  }
});

export function checkAndRenderFailoverBadges() {
  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
  if (!Array.isArray(curHsList)) return;

  curHsList.forEach(hs => {
    if (!hs) return;
    const card = document.querySelector(`.radio-container[data-hotspot-id="${hs.id}"]`);
    if (!card) return;

    const existing = card.querySelector(".server-failover-card-notice");

    if (hs.status === "ONLINE" || hs.status === "DISCONNECTED") {
      if (existing) existing.remove();
      return;
    }

    const failedCycles = hs.failed_cycles || 0;
    const det = (hs.detail || "").toLowerCase();
    const isServerDeadNotice = failedCycles >= 3 ||
      det.includes("не отвечает на udp") ||
      det.includes("not responding on udp") ||
      det.includes("no udp reply") ||
      det.includes("udp_no_reply") ||
      ((det.includes("все 5 попыток") || det.includes("all 5 attempts")) && failedCycles >= 2);

    if (!isServerDeadNotice) {
      if (existing) existing.remove();
      return;
    }

    const net = (hs.network_type || "bm").toLowerCase();
    const cachedList = (window._dmrServersCache && window._dmrServersCache[net]) || [];
    const fastest = cachedList.find(s => s && s.state === "online" && s.host && (s.host.toLowerCase() !== (hs.bm_master_host || "").toLowerCase()));

    if (!fastest) {
      if (existing) existing.remove();
      return;
    }

    const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "en";
    const cCode = (fastest.country_code || fastest.country || "").toUpperCase();
    const cName = getLocalizedCountryName(cCode, fastest.country_name || fastest.country || "DMR", curLang);
    const flag = fastest.flag || (cCode ? isoToEmoji(cCode) : "") || "🌐";
    const pingMs = Math.round(fastest.udp_ms || fastest.avg_ping || 15);
    const switchText = window.t ? window.t("server_probe.quick_switch", {}, "Switch") : "Switch";
    const failoverPrefix = window.t ? window.t("server_probe.failover_best_prefix", {}, "⚠️ Server not responding. Best:") : "⚠️ Server not responding. Best:";
    const msUnit = window.t ? window.t("ping.unit_ms", {}, "ms") : "ms";

    if (!existing) {
      const noticeDiv = document.createElement("div");
      noticeDiv.className = "server-failover-card-notice";
      noticeDiv.style.cssText = "display:flex; align-items:center; justify-content:space-between; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); border-radius: 0px; padding:4px 8px; margin:4px 8px 6px; font-size:11px; color:#fca5a5;";
      noticeDiv.innerHTML = `
        <span style="display:flex; align-items:center; gap:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          <span>${safeEscapeHtml(failoverPrefix)}</span> <b>${safeEscapeHtml(cName)} (${pingMs} ${safeEscapeHtml(msUnit)})</b>
        </span>
        <button type="button" class="btn-failover-quick-switch" style="background:#2563eb; color:#fff; border:none; border-radius: 0px; padding:3px 10px; font-size:11px; font-weight:600; cursor:pointer; flex-shrink:0; margin-left:8px;">${safeEscapeHtml(switchText)}</button>
      `;

      noticeDiv.querySelector(".btn-failover-quick-switch").addEventListener("click", () => {
        const title = `${flag} ${cName}`;
        if (typeof selectBmBenchmarkServer === "function") {
          selectBmBenchmarkServer(fastest.host, title, fastest.port, fastest.password);
        }
        noticeDiv.remove();
      });

      const bottomBar = card.querySelector(".screen-bottom-bar") || card;
      bottomBar.parentNode.insertBefore(noticeDiv, bottomBar);
    }
  });
}

window.checkAndRenderFailoverBadges = checkAndRenderFailoverBadges;

window.onServerProbeComplete = function(msg) {
  const completedNet = (msg && msg.network_type ? msg.network_type : "").toLowerCase();
  window._dmrServersCache = window._dmrServersCache || {};
  if (msg && Array.isArray(msg.results) && msg.results.length > 0) {
    window._dmrServersCache[completedNet] = msg.results;
    window._dmrServersCacheVer = Date.now();
  }
  const editHsNetworkType = document.getElementById("editHsNetworkType");
  const curNet = (editHsNetworkType ? editHsNetworkType.value : "bm").toLowerCase();
  if (curNet === completedNet) {
    const editHsHost = document.getElementById("editHsHost");
    renderBmMastersDropdown(editHsHost ? editHsHost.value : "", curNet);
  }
  if (typeof refreshAllCardsBmBanner === "function") {
    refreshAllCardsBmBanner();
  }
  if (typeof checkAndRenderFailoverBadges === "function") {
    checkAndRenderFailoverBadges();
  }
  if (completedNet === "ysf") {
    const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
    document.querySelectorAll('.radio-container.card-net-ysf, .radio-container[data-network-type="ysf"]').forEach(cardEl => {
      const cid = cardEl.dataset.hotspotId;
      const hsObj = curHsList.find(h => h && h.id === cid);
      if (hsObj) {
        updateCardYsfPanel(cardEl, hsObj);
        syncCardYsfDgIdBar(cardEl, hsObj);
      }
    });
    const ysfView = document.getElementById("ysfRoomsView");
    if (ysfView && ysfView.style.display !== "none" && typeof window.renderYsfRoomsList === "function") {
      window.renderYsfRoomsList(document.getElementById("ysfRoomSearchInput")?.value || "");
    }
  }
};

export function appendAllStarLogEntry(cid, entry) {
  // Чистый режим транскрибации: системные и VoIP логи не выводятся в текстовое окно
  return;
}

export function appendAllStarTelemetryLog(cid, rtt, jitter) {
  // Чистый режим транскрибации: телеметрия не выводится в текстовое окно
  return;
}

// =========================================================================
// ALLSTARLINK IN-CARD 5x5 NODE DASHBOARD MATRIX CONTROLLER
// =========================================================================

let _aslDashFastPollTimer = null;

export function isAslDashAutoOpenEnabled(cid = "default") {
  try {
    let val = hasServerCollectionKey("asl_dash_auto", cid)
      ? getServerCollectionValue("asl_dash_auto", cid)
      : localStorage.getItem(`proxdmr_asl_dash_auto_${cid}`);
    if (val === false || val === 0 || val === "0" || val === "false") return false;
    if (val === true || val === 1 || val === "1" || val === "true") return true;
  } catch (_) {}
  return true;
}

export function setAslDashAutoOpenEnabled(cid = "default", enabled = true) {
  try {
    setServerCollectionKey("asl_dash_auto", cid, enabled ? "1" : "0", "proxdmr_asl_dash_auto_", false);
  } catch (_) {}
  const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
  if (card) {
    const chk = card.querySelector(".chk-asl-dash-auto");
    if (chk) chk.checked = Boolean(enabled);
  }
}

export function syncAslDashPanelHeight() {
  // No-op kept for backward compatibility (dashboard now lives inside #aslMatrixContainer)
}

function _getAslHotspotObj(cid = null) {
  const hsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : (window.currentHotspots || []));
  if (cid) {
    const exact = hsList.find(h => String(h.id) === String(cid));
    if (exact) return exact;
  }
  const activeId = window.currentAslDashHotspotId || window.activeHotspotId;
  if (activeId) {
    const byActive = hsList.find(h => String(h.id) === String(activeId) && ((h.network_type || "").toLowerCase() === "allstar"));
    if (byActive) return byActive;
  }
  return hsList.find(h => ((h && h.network_type) || "").toLowerCase() === "allstar") || null;
}

function _cleanAslCallsign(rawCall, nodeNum) {
  if (!rawCall) return "";
  const trimmed = String(rawCall).trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (upper === `NODE ${nodeNum}` || upper === `NODE #${nodeNum}` || upper.startsWith("NODE ")) {
    return "";
  }
  return trimmed;
}

function _cleanAslPlaceText(rawText, nodeNum, callsign = "") {
  if (!rawText) return "";
  const trimmed = String(rawText).trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  const callUpper = String(callsign || "").trim().toUpperCase();
  if (
    upper === `NODE ${nodeNum}` ||
    upper === `NODE #${nodeNum}` ||
    upper === `#${nodeNum}` ||
    upper === String(nodeNum) ||
    (callUpper && (upper === callUpper || upper === `${callUpper} REPEATER` || upper === `${callUpper} NODE`))
  ) {
    return "";
  }
  return trimmed;
}

function _buildAslTileTwoLines(item, dirItem, nodeStr, cleanCall) {
  const rawName = _cleanAslPlaceText(
    item?.name || dirItem?.name || dirItem?.label || "",
    nodeStr,
    cleanCall
  );
  const rawLoc = _cleanAslPlaceText(
    item?.location || dirItem?.location || item?.city || dirItem?.city || "",
    nodeStr,
    cleanCall
  );

  let line1 = "";
  let line2 = "";

  if (rawName && rawLoc && rawName.toLowerCase() !== rawLoc.toLowerCase()) {
    line1 = rawName;
    line2 = rawLoc;
  } else {
    const single = rawLoc || rawName;
    if (single) {
      const sepMatch = single.match(/^([^,;/·•]+)[,;/·•]\s*(.+)$/);
      if (sepMatch && sepMatch[1].trim() && sepMatch[2].trim()) {
        line1 = sepMatch[1].trim();
        line2 = sepMatch[2].trim();
      } else {
        line1 = single;
        line2 = "";
      }
    } else {
      line1 = cleanCall ? `#${nodeStr}` : `Node ${nodeStr}`;
      line2 = "";
    }
  }
  return { line1, line2 };
}

function _mergeAslHubNodesList(aslHs, incomingHubNodes, incomingLinks) {
  const links = Array.isArray(incomingLinks) ? incomingLinks : (Array.isArray(aslHs.asl_links) ? aslHs.asl_links : []);
  if (links.length === 0 && !aslHs.is_asl_linked) {
    aslHs.asl_hub_nodes = [];
    return [];
  }
  const incoming = Array.isArray(incomingHubNodes) && incomingHubNodes.length > 0 ? incomingHubNodes : links;
  const prev = Array.isArray(aslHs.asl_hub_nodes) ? aslHs.asl_hub_nodes : [];
  const primaryHubNow = String((links[0] && links[0].node) || aslHs.connected_node || "").trim();
  const primaryHubPrev = String(aslHs._aslDashCurrentHub || "").trim();

  if (incoming.length <= 1 && prev.length > 1 && primaryHubNow && (!primaryHubPrev || primaryHubPrev === primaryHubNow)) {
    const kSet = new Set((Array.isArray(aslHs._aslKeyedNodes) ? aslHs._aslKeyedNodes : []).map(String));
    incoming.forEach(x => { if (x && x.keyed && x.node) kSet.add(String(x.node).trim()); });
    aslHs.asl_hub_nodes = prev.map(oldItem => ({
      ...oldItem,
      keyed: kSet.has(String(oldItem.node || "").trim()),
    }));
    return aslHs.asl_hub_nodes;
  }

  aslHs.asl_hub_nodes = incoming;
  return incoming;
}

export function renderAslNodeDashboard(cid = null) {
  const aslHs = _getAslHotspotObj(cid);
  if (!aslHs) return;
  const effCid = aslHs.id || cid || "default";

  const card = document.querySelector(`.radio-container[data-hotspot-id="${effCid}"]`);
  if (!card) return;

  const matrixContainer = card.querySelector(".asl-matrix-container");
  const sliderContainer = card.querySelector(".asl-slider-container");
  const dashViewport = card.querySelector(`#aslDashGridViewport_${effCid}`) || card.querySelector(".asl-dash-grid-viewport");
  const notchDashBadge = card.querySelector(`#aslNotchDashBadge_${effCid}`) || card.querySelector(".asl-notch-dash-badge");
  const dashPair = card.querySelector(".control-pair-btn.allstar-dash-pair");

  const isDashOpen = Boolean(aslHs._aslDashMatrixOpen);
  if (matrixContainer) matrixContainer.classList.toggle("is-dash-view", isDashOpen);
  if (sliderContainer) sliderContainer.classList.toggle("is-dash-mode", isDashOpen);
  if (dashPair) dashPair.classList.toggle("dash-open", isDashOpen);

  if (!isDashOpen || !dashViewport) return;

  const links = Array.isArray(aslHs.asl_links) ? aslHs.asl_links : [];
  const rawHubNodes = (Array.isArray(aslHs.asl_hub_nodes) && aslHs.asl_hub_nodes.length > 0)
    ? aslHs.asl_hub_nodes
    : links;
  const primaryHub = aslHs.asl_hub_info
    || links[0]
    || (aslHs.connected_node ? { node: String(aslHs.connected_node) } : null);

  const isLinked = Boolean(primaryHub && primaryHub.node && String(primaryHub.node) !== "0");
  const hubNodeNum = isLinked ? String(primaryHub.node).trim() : "";

  // Reset heard queue and known participant roster ONLY if primary hub changed or disconnected
  if (aslHs._aslDashCurrentHub !== hubNodeNum) {
    aslHs._aslDashCurrentHub = hubNodeNum;
    aslHs._aslDashHeardOrder = [];
    aslHs._aslDashHeardSet = new Set();
    aslHs._aslDashKnownMap = new Map();
    aslHs._aslDashLastTopSpeaker = "";
  }
  if (!Array.isArray(aslHs._aslDashHeardOrder)) aslHs._aslDashHeardOrder = [];
  if (!(aslHs._aslDashHeardSet instanceof Set)) aslHs._aslDashHeardSet = new Set();
  if (!(aslHs._aslDashKnownMap instanceof Map)) aslHs._aslDashKnownMap = new Map();

  const ownNode = String(aslHs.allstar_node || aslHs.config?.allstar_node || "").trim();
  const ownCallCfg = String(aslHs.callsign || aslHs.config?.callsign || "").trim().toUpperCase();
  const pttBtnEl = card.querySelector(".ptt-button");
  const isUserTxNow = Boolean(
    aslHs._aslUserTxActive ||
    (typeof window !== "undefined" && window.isPttPressed && String(window.activeTxHotspotId || window.activeHotspotId || "default") === String(effCid)) ||
    (pttBtnEl && pttBtnEl.classList.contains("active"))
  );

  // Determine currently keyed (transmitting) nodes
  const isRxNow = Boolean(!isUserTxNow && (aslHs._aslCarrierRx || ((Date.now() - (aslHs._aslLastRxAudioMs || 0)) < 1200)));
  const keyedSet = new Set();
  if (isUserTxNow && ownNode && ownNode !== "0") {
    keyedSet.add(ownNode);
  } else {
    if (Array.isArray(aslHs._aslKeyedNodes)) {
      aslHs._aslKeyedNodes.forEach(n => { if (n) keyedSet.add(String(n).trim()); });
    }
    if (isRxNow && aslHs._aslRxActiveNode) {
      keyedSet.add(String(aslHs._aslRxActiveNode).trim());
    }
    rawHubNodes.forEach(item => {
      if (item && item.keyed && item.node) {
        keyedSet.add(String(item.node).trim());
      }
    });

    // If RX audio/carrier is active right now:
    // 1) If a specific participant node inside the hub is keyed alongside the hub's own repeater ID, highlight ONLY the participant node.
    // 2) If no sub-participant ID is in keyedSet yet, fallback to highlighting the connected node/hub tile so active RX always blinks green at 0.8 Hz.
    if (keyedSet.size > 1 && hubNodeNum && keyedSet.has(hubNodeNum)) {
      keyedSet.delete(hubNodeNum);
    } else if (isRxNow && keyedSet.size === 0 && hubNodeNum) {
      keyedSet.add(hubNodeNum);
    }
  }

  // Move any currently transmitting operator to the very top-left (index 0), shifting previous speakers right
  let speakerPromotedToTop = false;
  keyedSet.forEach(kn => {
    if (!kn) return;
    aslHs._aslDashHeardSet.add(kn);
    if (aslHs._aslDashHeardOrder[0] !== kn) {
      aslHs._aslDashHeardOrder = [kn, ...aslHs._aslDashHeardOrder.filter(x => x !== kn)];
      speakerPromotedToTop = true;
    }
  });

  if (!isLinked || (rawHubNodes.length === 0 && aslHs._aslDashKnownMap.size === 0)) {
    if (notchDashBadge) notchDashBadge.textContent = "DASHBOARD 4×5";
    const emptyMsg = window.t
      ? window.t("asl.dash_empty_msg", {}, "Подключитесь к узлу или хабу AllStarLink для обзора его участников")
      : "Подключитесь к узлу или хабу AllStarLink для обзора его участников";
    dashViewport.innerHTML = `<div class="asl-dash-grid-empty">${safeEscapeHtml(emptyMsg)}</div>`;
    return;
  }

  const resolveDirItem = (nStr) => {
    if (typeof window !== "undefined" && typeof window.findAslDirectoryNode === "function") {
      return window.findAslDirectoryNode(nStr) || getAslNodeShortInfo(nStr, aslHs, effCid) || {};
    }
    return getAslNodeShortInfo(nStr, aslHs, effCid) || {};
  };

  // Update persistent participant roster for this hub (never drop multi-node roster on a transient 1-node poll)
  if (rawHubNodes.length > 1 || aslHs._aslDashKnownMap.size === 0) {
    if (rawHubNodes.length > 1) {
      // Authoritative multi-node update: keep any heard nodes + all nodes in rawHubNodes
      const nextMap = new Map();
      rawHubNodes.forEach(item => {
        if (!item || !item.node) return;
        const nStr = String(item.node).trim();
        if (!nStr || nextMap.has(nStr)) return;
        const dir = resolveDirItem(nStr);
        const flag = item.flag || dir.flag || "🌐";
        const cleanCall = _cleanAslCallsign(item.callsign || dir.callsign || "", nStr);
        const { line1, line2 } = _buildAslTileTwoLines(item, dir, nStr, cleanCall);
        const displayName = [line1, line2].filter(Boolean).join(" · ") || cleanCall || `Node ${nStr}`;
        nextMap.set(nStr, {
          node: nStr,
          flag,
          callsign: cleanCall,
          line1,
          line2,
          name: displayName,
        });
      });
      aslHs._aslDashKnownMap = nextMap;
    } else {
      rawHubNodes.forEach(item => {
        if (!item || !item.node) return;
        const nStr = String(item.node).trim();
        if (!nStr || aslHs._aslDashKnownMap.has(nStr)) return;
        const dir = resolveDirItem(nStr);
        const flag = item.flag || dir.flag || "🌐";
        const cleanCall = _cleanAslCallsign(item.callsign || dir.callsign || "", nStr);
        const { line1, line2 } = _buildAslTileTwoLines(item, dir, nStr, cleanCall);
        const displayName = [line1, line2].filter(Boolean).join(" · ") || cleanCall || `Node ${nStr}`;
        aslHs._aslDashKnownMap.set(nStr, {
          node: nStr,
          flag,
          callsign: cleanCall,
          line1,
          line2,
          name: displayName,
        });
      });
    }
  }

  // Always include the user's own configured node/callsign in the connected hub dashboard
  if (isLinked && ownNode && ownNode !== "0" && !aslHs._aslDashKnownMap.has(ownNode)) {
    const dirOwn = resolveDirItem(ownNode);
    const fallbackOwnCall = (ownCallCfg && ownCallCfg !== "N0CALL" && ownCallCfg !== "---") ? ownCallCfg : "";
    const cleanOwnCall = _cleanAslCallsign(dirOwn.callsign || fallbackOwnCall, ownNode) || fallbackOwnCall || `#${ownNode}`;
    const ownSyntheticItem = {
      callsign: cleanOwnCall,
      name: dirOwn.name || aslHs.talker_alias || aslHs.name || "",
      city: dirOwn.city || "",
      location: dirOwn.location || "",
    };
    const { line1: ownLine1, line2: ownLine2 } = _buildAslTileTwoLines(ownSyntheticItem, dirOwn, ownNode, cleanOwnCall);
    const ownDisplayName = [ownLine1, ownLine2].filter(Boolean).join(" · ") || cleanOwnCall || `Node ${ownNode}`;
    const ownFlag = dirOwn.flag || (typeof getCountryInfo === "function" ? (getCountryInfo(0, cleanOwnCall)?.flag || "🌐") : "🌐");
    aslHs._aslDashKnownMap.set(ownNode, {
      node: ownNode,
      flag: ownFlag,
      callsign: cleanOwnCall,
      line1: ownLine1,
      line2: ownLine2,
      name: ownDisplayName,
      isOwnNode: true,
    });
  }

  // Ensure any currently keyed node is present in the roster
  keyedSet.forEach(kn => {
    if (kn && !aslHs._aslDashKnownMap.has(kn)) {
      const dir = resolveDirItem(kn);
      const cleanCall = _cleanAslCallsign(dir.callsign || "", kn);
      const { line1, line2 } = _buildAslTileTwoLines({}, dir, kn, cleanCall);
      const displayName = [line1, line2].filter(Boolean).join(" · ") || cleanCall || `Node ${kn}`;
      aslHs._aslDashKnownMap.set(kn, {
        node: kn,
        flag: dir.flag || "🌐",
        callsign: cleanCall,
        line1,
        line2,
        name: displayName,
      });
    }
  });

  const participantMap = new Map();
  aslHs._aslDashKnownMap.forEach((baseInfo, nStr) => {
    const isKeyed = keyedSet.has(nStr);
    const isHeard = aslHs._aslDashHeardSet.has(nStr) || isKeyed;
    participantMap.set(nStr, {
      ...baseInfo,
      isKeyed,
      isHeard,
    });
  });

  if (notchDashBadge) {
    notchDashBadge.textContent = isLinked
      ? `HUB #${hubNodeNum} · ${participantMap.size} NODES`
      : "DASHBOARD 4×5";
  }

  // 1. Heard / Active queue in exact order of recent transmission (index 0 = top-left most recent speaker, shifted right by newer speakers)
  const heardList = [];
  const placedNodes = new Set();
  aslHs._aslDashHeardOrder.forEach(hNode => {
    const p = participantMap.get(hNode);
    if (p && !placedNodes.has(hNode)) {
      heardList.push(p);
      placedNodes.add(hNode);
    }
  });

  // 2. Remaining silent participants sorted strictly in ascending order by numeric ID
  const silentList = [];
  participantMap.forEach((p, nStr) => {
    if (!placedNodes.has(nStr)) {
      silentList.push(p);
    }
  });
  silentList.sort((a, b) => (parseInt(a.node, 10) || 0) - (parseInt(b.node, 10) || 0));

  const finalTiles = [...heardList, ...silentList];

  dashViewport.innerHTML = finalTiles.map(tile => {
    const cls = [
      "btn-allstar-node",
      "asl-dash-tile",
      tile.isKeyed ? "asl-dash-tile-talking" : "",
      tile.isHeard ? "asl-dash-tile-heard" : "",
    ].filter(Boolean).join(" ");

    const headerTitle = tile.callsign || `#${tile.node}`;
    const footerHtml = tile.line2
      ? `<span class="asl-dash-desc-line">${safeEscapeHtml(tile.line1)}</span><span class="asl-dash-desc-line">${safeEscapeHtml(tile.line2)}</span>`
      : `<span class="asl-dash-desc-line asl-dash-desc-wrap">${safeEscapeHtml(tile.line1)}</span>`;

    const tipParts = [`#${tile.node}`, tile.callsign, tile.line1, tile.line2].filter(Boolean).join(" · ");
    const addHint = window.t
      ? window.t("asl.dash_tile_add_tip", { info: tipParts }, `${tipParts} — Клик: добавить в ячейку памяти`)
      : `${tipParts} — Клик: добавить в ячейку памяти`;

    return `
      <button type="button" class="${cls}" data-node="${safeEscapeHtml(tile.node)}" data-callsign="${safeEscapeHtml(tile.callsign)}" data-name="${safeEscapeHtml(tile.name)}" data-flag="${safeEscapeHtml(tile.flag)}" title="${safeEscapeHtml(addHint)}">
        <div class="asl-btn-header">
          <span class="asl-btn-flag">${tile.flag}</span>
          <strong class="asl-btn-num">${safeEscapeHtml(headerTitle)}</strong>
        </div>
        <div class="asl-btn-footer">
          ${footerHtml}
        </div>
      </button>
    `;
  }).join("");

  // Auto-scroll to the top of the 5x5 grid whenever a new/existing speaker moves to the top-left slot
  const topSpeakerNow = aslHs._aslDashHeardOrder[0] || "";
  if (speakerPromotedToTop || (topSpeakerNow && topSpeakerNow !== aslHs._aslDashLastTopSpeaker)) {
    aslHs._aslDashLastTopSpeaker = topSpeakerNow;
    try {
      dashViewport.scrollTo({ top: 0, behavior: "smooth" });
    } catch (_) {
      dashViewport.scrollTop = 0;
    }
  }

  // Click on any participant tile -> Open "Save node to memory cell" modal (same as from Directory)
  dashViewport.querySelectorAll(".asl-dash-tile").forEach(tileBtn => {
    tileBtn.onclick = (e) => {
      e.stopPropagation();
      const nId = tileBtn.dataset.node || "";
      if (!nId) return;
      const itemObj = {
        node: nId,
        callsign: tileBtn.dataset.callsign || "",
        name: tileBtn.dataset.name || tileBtn.dataset.callsign || `Node ${nId}`,
        flag: tileBtn.dataset.flag || "🌐",
      };
      if (typeof window.openAslCellPickerModal === "function") {
        window.openAslCellPickerModal(itemObj, effCid);
      }
    };
  });
}

export async function refreshAslNodeDashboardData(cid = null, showSpinner = false) {
  const aslHs = _getAslHotspotObj(cid);
  if (!aslHs) return;
  const effCid = aslHs.id || "default";
  try {
    const resp = await fetch(`/api/allstar/connected?hotspot_id=${encodeURIComponent(effCid)}`);
    const data = await resp.json();
    if (data && data.status === "ok") {
      aslHs.asl_links = data.links || [];
      if (Array.isArray(data.keyed_nodes)) {
        const incomingKeyed = data.keyed_nodes.map(String);
        const isRxActiveNow = Boolean(aslHs._aslCarrierRx || ((Date.now() - (aslHs._aslLastRxAudioMs || 0)) < 1200));
        if (incomingKeyed.length > 0 || !isRxActiveNow) {
          aslHs._aslKeyedNodes = incomingKeyed;
        }
      }
      _mergeAslHubNodesList(aslHs, data.hub_nodes, data.links);
      aslHs.asl_hub_info = data.hub_info || null;
      aslHs.asl_online_count = data.online_count || 0;
      if (data.rtt > 0) {
        if (!window.cachedBmPings) window.cachedBmPings = {};
        window.cachedBmPings[effCid] = Math.round(data.rtt);
      }
      if (aslHs._aslDashMatrixOpen) {
        renderAslNodeDashboard(effCid);
      }
    }
  } catch (_) {}
}

export function openAslNodeDashboard(cid = "default") {
  const aslHs = _getAslHotspotObj(cid);
  if (!aslHs) return;
  const effCid = aslHs.id || cid || "default";

  aslHs._aslDashMatrixOpen = true;
  window.isAslDashVisible = true;
  window.currentAslDashHotspotId = effCid;

  const card = document.querySelector(`.radio-container[data-hotspot-id="${effCid}"]`);
  if (card) {
    const vfoAllStar = card.querySelector(".vfo-allstar");
    if (vfoAllStar && typeof vfoAllStar.setAslTextView === "function") {
      vfoAllStar.setAslTextView(false);
    }
  }

  renderAslNodeDashboard(effCid);
  refreshAslNodeDashboardData(effCid, false);

  if (_aslDashFastPollTimer) clearInterval(_aslDashFastPollTimer);
  _aslDashFastPollTimer = setInterval(() => {
    if (!window.isAslDashVisible || window.isSessionPausedByAnotherDevice) return;
    const activeHs = _getAslHotspotObj(window.currentAslDashHotspotId || effCid);
    if (!activeHs || !activeHs._aslDashMatrixOpen) return;
    refreshAslNodeDashboardData(activeHs.id || effCid, false);
  }, 4000);
}

export function closeAslNodeDashboard() {
  const hsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : (window.currentHotspots || []));
  hsList.forEach(h => {
    if (h && h._aslDashMatrixOpen) {
      h._aslDashMatrixOpen = false;
    }
  });
  window.isAslDashVisible = false;

  if (_aslDashFastPollTimer) {
    clearInterval(_aslDashFastPollTimer);
    _aslDashFastPollTimer = null;
  }

  document.querySelectorAll(".radio-container").forEach(card => {
    const pair = card.querySelector(".control-pair-btn.allstar-dash-pair");
    if (pair) pair.classList.remove("dash-open");
    const matrixContainer = card.querySelector(".asl-matrix-container");
    if (matrixContainer) matrixContainer.classList.remove("is-dash-view");
    const sliderContainer = card.querySelector(".asl-slider-container");
    if (sliderContainer) sliderContainer.classList.remove("is-dash-mode");
  });
}

export function toggleAslNodeDashboard(cid = "default") {
  const aslHs = _getAslHotspotObj(cid);
  if (!aslHs) return;
  if (aslHs._aslDashMatrixOpen) {
    aslHs._aslDashMatrixOpen = false;
    const anyStillOpen = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).some(h => h && h._aslDashMatrixOpen);
    window.isAslDashVisible = anyStillOpen;
    if (!anyStillOpen && _aslDashFastPollTimer) {
      clearInterval(_aslDashFastPollTimer);
      _aslDashFastPollTimer = null;
    }
    renderAslNodeDashboard(aslHs.id || cid);
  } else {
    openAslNodeDashboard(aslHs.id || cid);
  }
}

if (typeof window !== "undefined" && !window._aslOnlinePollInterval) {
  window._aslOnlinePollInterval = setInterval(() => {
    if (window.isSessionPausedByAnotherDevice) return;
    try {
      const hsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []);
      const aslHs = hsList.find(h => ((h && h.network_type) || "").toLowerCase() === "allstar");
      if (!aslHs) return;
      const cid = aslHs.id || "default";
      fetch(`/api/allstar/connected?hotspot_id=${encodeURIComponent(cid)}`)
        .then(r => r.json())
        .then(data => {
          if (data && data.status === "ok") {
            const nodes = data.connected_nodes || [];
            const links = data.links || [];
            aslHs.asl_links = links;
            if (Array.isArray(data.keyed_nodes)) {
              const incomingKeyed = data.keyed_nodes.map(String);
              const isRxActiveNow = Boolean(aslHs._aslCarrierRx || ((Date.now() - (aslHs._aslLastRxAudioMs || 0)) < 1200));
              if (incomingKeyed.length > 0 || !isRxActiveNow) {
                aslHs._aslKeyedNodes = incomingKeyed;
              }
            }
            _mergeAslHubNodesList(aslHs, data.hub_nodes, links);
            aslHs.asl_hub_info = data.hub_info || null;
            const newCount = data.online_count || links.filter(l => !l.connecting).length || nodes.length;
            aslHs.asl_online_count = newCount;
            if (nodes.length > 0 && nodes[0] !== aslHs.connected_node) {
              aslHs.connected_node = nodes[0];
              aslHs.is_asl_linked = true;
            }
            if (Array.isArray(links)) {
              links.forEach(lk => {
                if (lk && lk.node) {
                  const cn = String(lk.node).trim();
                  if (lk.connecting || lk.status === "connecting") {
                    if (aslHs._aslConnectingNodes instanceof Map) {
                      const ex = aslHs._aslConnectingNodes.get(cn);
                      aslHs._aslConnectingNodes.set(cn, {
                        mode: lk.mode || (ex && ex.mode) || "*2",
                        startedAt: ex ? ex.startedAt : Date.now()
                      });
                    }
                  } else {
                    if (aslHs._aslConnectingNodes instanceof Map) {
                      aslHs._aslConnectingNodes.delete(cn);
                    }
                  }
                }
              });
            }
            const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
            if (card) {
              const hasUnlisted = Array.isArray(aslHs.asl_unlisted_links) && aslHs.asl_unlisted_links.length > 0;
              if ((!card.querySelector(".asl-matrix-grid") || aslHs._aslDynamicMatrixMode || hasUnlisted) && !card.querySelector(".asl-card-context-menu")) {
                updateCardAllStarPanel(card, aslHs);
              } else {
                syncAslMatrixButtonsState(card, aslHs);
              }
            }
            if (aslHs._aslDashMatrixOpen) {
              renderAslNodeDashboard(cid);
            }
          }
        })
        .catch(() => {});
    } catch (e) {}
  }, 10000);
}

if (typeof window !== 'undefined') {
  window.updateCardXlxPanel = updateCardXlxPanel;
  window.updateCardDmrPlusPanel = updateCardDmrPlusPanel;
  window.updateCardYsfPanel = updateCardYsfPanel;
  window.syncCardYsfDgIdBar = syncCardYsfDgIdBar;
  window.resolveYsfMatrixCellTypeInfo = resolveYsfMatrixCellTypeInfo;
  window.applyYsfDgIdLive = applyYsfDgIdLive;
  window.isYsfTxDgIdPromptRequired = isYsfTxDgIdPromptRequired;
  window.openYsfTxDgIdModal = openYsfTxDgIdModal;
  window.closeYsfTxDgIdModal = closeYsfTxDgIdModal;
  window.getYsfMatrixPage = getYsfMatrixPage;
  window.setYsfMatrixPageValue = setYsfMatrixPageValue;
  window.getYsfMatrixRooms = getYsfMatrixRooms;
  window.saveYsfMatrixRooms = saveYsfMatrixRooms;
  window.getYsfScanConfig = getYsfScanConfig;
  window.saveYsfScanConfig = saveYsfScanConfig;
  window.getYsfDiceConfig = getYsfDiceConfig;
  window.saveYsfDiceConfig = saveYsfDiceConfig;
  window.isYsfRoomRxActive = isYsfRoomRxActive;
  window.startYsfMatrixScan = startYsfMatrixScan;
  window.stopYsfMatrixScan = stopYsfMatrixScan;
  window.renderYsfDashboard = renderYsfDashboard;
  window.isYsfDashAutoOpenEnabled = isYsfDashAutoOpenEnabled;
  window.setYsfDashAutoOpenEnabled = setYsfDashAutoOpenEnabled;
  window.openYsfCardContextMenu = openYsfCardContextMenu;
  window.closeYsfCardContextMenu = closeYsfCardContextMenu;
  window.openYsfCardEditPopover = openYsfCardEditPopover;
  window.openYsfScanSettingsPopover = openYsfScanSettingsPopover;
  window.openYsfDiceSettingsPopover = openYsfDiceSettingsPopover;
  window.openYsfMatrixManageModal = openYsfMatrixManageModal;
  window.getAdnDiceConfig = getAdnDiceConfig;
  window.saveAdnDiceConfig = saveAdnDiceConfig;
  window.openAdnDiceSettingsPopover = openAdnDiceSettingsPopover;
  window.syncAdnDiceButtonUI = syncAdnDiceButtonUI;
  window.stopAdnDiceSearch = stopAdnDiceSearch;
  window.startAdnDiceSearch = startAdnDiceSearch;
  window.setupAdnDiceButton = setupAdnDiceButton;
  window.isAdnSlotRxActive = isAdnSlotRxActive;
  window.linkHotspotDmrPlusReflector = linkHotspotDmrPlusReflector;
  window.updateCardAllStarPanel = updateCardAllStarPanel;
  window.updateAslVfoHeader = updateAslVfoHeader;
  window.updateYsfVfoHeader = updateYsfVfoHeader;
  window.syncYsfMatrixButtonsState = syncYsfMatrixButtonsState;
  window.probeYsfMatrixRooms = probeYsfMatrixRooms;
  window.getYsfRoomShortInfo = getYsfRoomShortInfo;
  window.getAslNodeShortInfo = getAslNodeShortInfo;
  window.appendAllStarLogEntry = appendAllStarLogEntry;
  window.appendAllStarTelemetryLog = appendAllStarTelemetryLog;
  window.openAllStarDtmfPopover = openAllStarDtmfPopover;
  window.openAslNodeDashboard = openAslNodeDashboard;
  window.closeAslNodeDashboard = closeAslNodeDashboard;
  window.toggleAslNodeDashboard = toggleAslNodeDashboard;
  window.renderAslNodeDashboard = renderAslNodeDashboard;
  window.refreshAslNodeDashboardData = refreshAslNodeDashboardData;
  window.isAslDashAutoOpenEnabled = isAslDashAutoOpenEnabled;
  window.setAslDashAutoOpenEnabled = setAslDashAutoOpenEnabled;
  window.syncAslDashPanelHeight = syncAslDashPanelHeight;
  window.latLonToMaidenheadGrid = latLonToMaidenheadGrid;
  window.requestDeviceGpsLocation = requestDeviceGpsLocation;
  window.detectYsfCountryFlag = detectYsfCountryFlag;
  window.ysfConnectRoomProcedure = ysfConnectRoomProcedure;
  window.ysfDisconnectProcedure = ysfDisconnectProcedure;
  window.syncYsfDiceButtonUI = syncYsfDiceButtonUI;
  window.stopYsfDiceSearch = stopYsfDiceSearch;
  window.getAslDiceConfig = getAslDiceConfig;
  window.saveAslDiceConfig = saveAslDiceConfig;
  window.openAslDiceSettingsPopover = openAslDiceSettingsPopover;
  window.syncAslDiceButtonUI = syncAslDiceButtonUI;
  window.stopAslDiceSearch = stopAslDiceSearch;
}

export function latLonToMaidenheadGrid(lat, lon) {
  const adjLat = Number(lat) + 90.0;
  const adjLon = Number(lon) + 180.0;
  const f1 = String.fromCharCode(65 + Math.floor(adjLon / 20));
  const f2 = String.fromCharCode(65 + Math.floor(adjLat / 10));
  const f3 = Math.floor((adjLon % 20) / 2);
  const f4 = Math.floor(adjLat % 10);
  const remLon = (adjLon % 20) - (f3 * 2);
  const remLat = (adjLat % 10) - f4;
  const f5 = String.fromCharCode(97 + Math.floor(remLon / (2.0 / 24)));
  const f6 = String.fromCharCode(97 + Math.floor(remLat / (1.0 / 24)));
  return `${f1}${f2}${f3}${f4}${f5}${f6}`.toUpperCase();
}

export function requestDeviceGpsLocation(callback) {
  if (typeof callback !== "function") return;

  // 1. Android APK Bridge
  if (typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.requestGpsLocation === "function") {
    window._onAndroidGpsLocationReceived = (data) => {
      try {
        const obj = typeof data === "string" ? JSON.parse(data) : data;
        if (obj && obj.lat && obj.lon) {
          callback(Number(obj.lat), Number(obj.lon));
          return;
        }
      } catch (err) {
        console.warn("[GPS] Parse Android location error:", err);
      }
      const gpsErrMsg = window.t
        ? window.t("hotspots.gps_device_failed", {}, "Failed to get coordinates from GPS device")
        : "Failed to get coordinates from GPS device";
      if (typeof showToast === "function") {
        showToast(gpsErrMsg, "warning", 3000);
      } else if (window.showToast) {
        window.showToast(gpsErrMsg, "warning", 3000);
      }
    };
    window.AndroidBridge.requestGpsLocation();
    return;
  }

  // 2. Standard Web Browser Geolocation API
  if (typeof navigator !== "undefined" && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        callback(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        console.warn("[GPS] Geolocation API error:", err);
        const geoDenied = window.t
          ? window.t("hotspots.geo_denied", {}, "Geolocation access is denied or unavailable")
          : "Geolocation access is denied or unavailable";
        if (typeof showToast === "function") {
          showToast(geoDenied, "warning", 3000);
        } else if (window.showToast) {
          window.showToast(geoDenied, "warning", 3000);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
    return;
  }

  const geoUnsupported = window.t
    ? window.t("hotspots.geo_unsupported", {}, "Geolocation is not supported by your browser")
    : "Geolocation is not supported by your browser";
  if (typeof showToast === "function") {
    showToast(geoUnsupported, "warning", 3000);
  } else if (window.showToast) {
    window.showToast(geoUnsupported, "warning", 3000);
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const mapBtn = e.target.closest(".btn-caller-map");
    if (!mapBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const lat = mapBtn.dataset.lat;
    const lon = mapBtn.dataset.lon;
    const call = mapBtn.dataset.callsign || "";
    const grid = mapBtn.dataset.grid || "";
    if (lat && lon) {
      const url = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=13/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
      window.open(url, "_blank");
    } else if (grid) {
      const qthMsg = window.t
        ? window.t("hotspots.qth_coords_toast", { call, grid }, `Coordinates ${call}: QTH ${grid}`)
        : `Coordinates ${call}: QTH ${grid}`;
      if (typeof showToast === "function") {
        showToast(qthMsg, "info", 3000);
      } else if (window.showToast) {
        window.showToast(qthMsg, "info", 3000);
      }
    }
  });
}



export function updateHsFormAliveState(isAlive) {
  const form = document.getElementById("hotspotEditForm");
  const tabEditHs = document.getElementById("tab-edit-hs");
  if (!form) return;
  if (isAlive) {
    form.classList.remove("hs-form-excluded");
    if (tabEditHs) tabEditHs.classList.remove("hs-is-excluded");
    form.querySelectorAll("input, select, textarea, button").forEach(el => {
      if (el.id !== "editHsAliveToggle") {
        el.disabled = false;
      }
    });
  } else {
    form.classList.add("hs-form-excluded");
    if (tabEditHs) tabEditHs.classList.add("hs-is-excluded");
    form.querySelectorAll("input, select, textarea, button").forEach(el => {
      if (el.id !== "editHsAliveToggle" && el.type !== "submit" && el.id !== "btnSaveHotspot") {
        el.disabled = true;
      }
    });
  }
}
if (typeof window !== "undefined") {
  window.updateHsFormAliveState = updateHsFormAliveState;
  window.DEFAULT_NETWORK_BRAND_COLORS = DEFAULT_NETWORK_BRAND_COLORS;
  window.getNetworkBrandColor = getNetworkBrandColor;
  window.isNetworkColorEnabled = isNetworkColorEnabled;
  window.applyCardBrandColors = applyCardBrandColors;
}
