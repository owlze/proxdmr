/**
 * ProxDMR - Hotspots Management Subsystem (modules/dmr/hotspots.js)
 * Manages multi-hotspot configuration, DOM radio card creation and rendering,
 * hotspot switching, BrandMeister master server dropdowns, and hotspot settings forms.
 */

import { safeEscapeHtml, escapeHtml, isoToEmoji, getLocalizedCountryName, getCountryInfo, getFlagBadgeHtml, getCleanTgDesc } from '../core/formatters.js?v=2.9.380';
import { showToast } from '../core/toast.js';
import { pushNavState, notifyNavClosed } from '../ui/navigation.js';
import { openBmBenchmarkModal } from './bm-benchmark.js';
import { openBmTgStaticModal, dropDynamicTGs } from './bm-static-manager.js?v=2.9.372';
import {
  cycleHotspotPan,
  toggleHotspotMute,
  toggleHotspotAutoRecord,
  setupMutePanButtonEvents,
  updateCardMuteUI,
  updateCardPanUI,
  updateCardTsAudioModeUI,
  updateCardRecUI,
  updateAllHotspotRecUI
} from '../audio/routing.js';
import {
  setupSlotLongPress,
  syncCardSlotTranscribeUI,
  syncAllTranscribeSlotsToServer,
  disableHotspotTranscribe
} from './transcriber.js?v=2.9.367';
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
} from '../ptt/engine.js?v=2.9.367';
import { wireCardStatusInteractions, renderHotspotAuxStatusBadge, checkBmApiStatus, updateHotspotGwStatus, triggerHotspotGwAction, isHotspotGwDisconnected } from '../network/watchdog.js';
import { getDmrNetworkProfile, getNetworkServersList, renderNetworkBadgeElement, updateCardNetworkBadge, refreshFreeDmrServers, sortServersForDropdown, getBmServerInfo, resolveCardMasterInfo } from './bm-banner.js?v=2.9.378';
import { checkServerApkUpdate, updateApkUpdateUI } from '../core/updater.js?v=2.9.367';
import { showLongPressEffect } from '../ui/long-press.js';

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
export async function loadHotspots() {
    try {
      const res = await fetch("/api/hotspots");
      const data = await res.json();
      const rawHotspots = data.hotspots || [];
      setCurrentHotspots(rawHotspots);
      const curHs = currentHotspots;
      const targetActive = data.active_hotspot_id || (curHs[0] && curHs[0].id) || "default";
      setActiveHotspotId(targetActive);

      curHs.forEach(hs => {
        const cid = resolveHotspotId(hs.id);
        if (hs.auto_record !== undefined) {
          try {
            localStorage.setItem(`proxdmr_autorec_${cid}`, hs.auto_record ? "1" : "0");
          } catch (_) {}
        }
      });

      // Restore last combination of open/collapsed hotspots from localStorage
      curHs.forEach((hs, idx) => {
        const cid = resolveHotspotId(hs.id);
        const saved = localStorage.getItem(`proxdmr_collapsed_${cid}`);
        let isCollapsed;
        if (saved !== null) {
          isCollapsed = (saved === "true");
        } else if (typeof hs.collapsed === "boolean") {
          isCollapsed = hs.collapsed;
        } else {
          // If never set before (clean initial run), default 1st open, others collapsed
          isCollapsed = (idx > 0);
        }
        try {
          localStorage.setItem(`proxdmr_collapsed_${cid}`, isCollapsed ? "true" : "false");
        } catch (_) {}

        const isLive = isHotspotLiveCollapsed(cid);
        if (isCollapsed && !isLive) {
          hs.collapsed = true;
          hs.isLiveCollapsed = false;
          if (hs.status !== "DISCONNECTED" && hs.status !== "OFFLINE") {
            fetch(`/api/hotspots/${hs.id}/collapse`, { method: "POST" }).catch(() => {});
          }
          hs.status = "DISCONNECTED";
          hs.detail = "Свернут / отключен";
        } else if (isCollapsed && isLive) {
          hs.collapsed = true;
          hs.isLiveCollapsed = true;
          // Keep live! Do not collapse backend, expand instead to ensure backend is running!
          fetch(`/api/hotspots/${hs.id}/expand`, { method: "POST" }).catch(() => {});
        } else {
          hs.collapsed = false;
          hs.isLiveCollapsed = false;
          fetch(`/api/hotspots/${hs.id}/expand`, { method: "POST" }).catch(() => {});
        }
      });

      // Restore active hotspot from localStorage or pick the first open hotspot
      let activeCandidate = null;
      try {
        activeCandidate = localStorage.getItem("proxdmr_active_hotspot_id");
      } catch (_) {}

      if (activeCandidate && curHs.some(h => h.id === activeCandidate && (!isHotspotCollapsed(h.id) || isHotspotLiveCollapsed(h.id)))) {
        setActiveHotspotId(activeCandidate);
      } else if (isHotspotCollapsed(activeHotspotId) && !isHotspotLiveCollapsed(activeHotspotId)) {
        const firstOpen = curHs.find(h => !isHotspotCollapsed(h.id) || isHotspotLiveCollapsed(h.id));
        if (firstOpen) {
          setActiveHotspotId(firstOpen.id);
        } else if (curHs[0]) {
          setActiveHotspotId(curHs[0].id);
        }
      }

      renderHotspotSelect();
      renderHotspotsList();
      renderRadiosGrid();
      applyActiveHotspotToUI();
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
    const currentHotspots = window.currentHotspots || [];
    const activeHotspotId = window.activeHotspotId || "default";
    headerHotspotSelect.innerHTML = "";
    currentHotspots.forEach(hs => {
      const opt = document.createElement("option");
      opt.value = hs.id;
      const isCollapsed = isHotspotCollapsed(hs.id);
      const isLive = isHotspotLiveCollapsed(hs.id);
      const isOnline = (!isCollapsed || isLive) && hs.status === "ONLINE";
      const statusIcon = isOnline ? "🟢" : "⚪";
      const suffix = isCollapsed ? (isLive ? " (в фоне)" : " (свернут)") : "";
      opt.textContent = `${statusIcon} ${hs.name} (${hs.effective_id || hs.dmr_id})${suffix}`;
      if (hs.id === activeHotspotId) opt.selected = true;
      headerHotspotSelect.appendChild(opt);
    });
  }
export function switchActiveHotspot(newId) {
    const curActiveId = (typeof window !== "undefined" && window.activeHotspotId) || null;
    if (!newId || newId === curActiveId) return;
    if (typeof window !== "undefined") window.activeHotspotId = newId;
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
      const isXlx = ((targetHs.network_type || "").toLowerCase() === "xlx");
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
  }
export function triggerAddNewHotspot() {
    const callsignDisplay = document.getElementById("callsignDisplay");
    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    if (currentHotspots.length >= 7) {
      if (window.showAppAlert) {
        window.showAppAlert("Максимальное общее количество виртуальных хотспотов — 7 штук.", { title: "Лимит хотспотов", icon: "⚠️" });
      } else {
        window.showAppAlert ? window.showAppAlert(window.t ? window.t("hotspots.limit_reached", {}, "Максимальное общее количество виртуальных хотспотов — 7 штук.") : "Максимальное общее количество виртуальных хотспотов — 7 штук.", { title: window.t ? window.t("hotspots.limit_title", {}, "Ограничение") : "Ограничение" }) : alert(window.t ? window.t("hotspots.limit_reached", {}, "Максимальное общее количество виртуальных хотспотов — 7 штук.") : "Максимальное общее количество виртуальных хотспотов — 7 штук.");
      }
      return;
    }
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
    const nextNum = currentHotspots.length + 1;
    const baseHs = currentHotspots[0] || {};
    openEditHotspotForm({
      id: "",
      name: `Хотспот #${nextNum}`,
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
      auto_record: false,
    });
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

    const validTabs = ["tab-account", "tab-edit-hs", "tab-general", "tab-transcriber"];
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

    const isCollapsed = isHotspotCollapsed(cid);
    if (isCollapsed) {
      // If already collapsed, clicking will expand, no need for long-press timer
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
        window.collapseHotspot(cid, { isLive: true });
      } else {
        collapseHotspot(cid, { isLive: true });
      }
    }, 450);
  });

  btn.addEventListener("pointermove", (e) => {
    if (!timer) return;
    const coords = getCoords(e);
    const dx = Math.abs(coords.x - startX);
    const dy = Math.abs(coords.y - startY);
    if (dx > 12 || dy > 12) {
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
    const lastAction = (typeof window !== "undefined" && window._lastHotspotCollapseActionTimes && (window._lastHotspotCollapseActionTimes[cid] || window._lastHotspotCollapseActionTimes["default"])) || 0;
    if (Date.now() - lastAction < 600) {
      return;
    }
    const isCollapsed = isHotspotCollapsed(cid);
    if (isCollapsed) {
      if (typeof window.expandHotspot === "function") {
        window.expandHotspot(cid);
      } else {
        expandHotspot(cid);
      }
    } else {
      if (typeof window.collapseHotspot === "function") {
        window.collapseHotspot(cid, { isLive: false });
      } else {
        toggleHotspotCollapse(cid);
      }
    }
  });

  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

let _isSyncingCollapsedStacks = false;

export function syncCollapsedHotspotStacks() {
  if (_isSyncingCollapsedStacks) return;
  const radiosGrid = document.getElementById("radiosGrid");
  if (!radiosGrid) return;

  _isSyncingCollapsedStacks = true;
  try {
    // 1. Unwrap any existing .collapsed-hotspots-stack wrappers back into radiosGrid
    radiosGrid.querySelectorAll(".collapsed-hotspots-stack").forEach(stack => {
      while (stack.firstChild) {
        radiosGrid.insertBefore(stack.firstChild, stack);
      }
      stack.remove();
    });

    // 2. Ensure all .radio-container cards are in currentHotspots order
    const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length)
      ? window.currentHotspots
      : (Array.isArray(currentHotspots) && currentHotspots.length ? currentHotspots : []);
    const displayHotspots = allHs.slice(0, 7);
    displayHotspots.forEach(hs => {
      const card = radiosGrid.querySelector(`.radio-container[data-hotspot-id="${hs.id}"]`);
      if (card) {
        radiosGrid.appendChild(card);
      }
    });

    // 3. Group runs of 2 or more consecutive .radio-container.collapsed cards into a vertical .collapsed-hotspots-stack
    const cards = Array.from(radiosGrid.querySelectorAll(":scope > .radio-container"));
    let currentRun = [];

    const flushRun = () => {
      if (currentRun.length >= 2) {
        const stack = document.createElement("div");
        stack.className = "collapsed-hotspots-stack";
        radiosGrid.insertBefore(stack, currentRun[0]);
        currentRun.forEach(c => stack.appendChild(c));
      }
      currentRun = [];
    };

    cards.forEach(card => {
      if (card.classList.contains("collapsed")) {
        currentRun.push(card);
      } else {
        flushRun();
      }
    });
    flushRun();

    // 4. Reposition liveMonitorPanel if visible so it stays right after its target card (or stack)
    const liveMonitorPanel = document.getElementById("liveMonitorPanel");
    const isLogVis = Boolean(typeof window.isLogVisible !== "undefined" ? window.isLogVisible : (liveMonitorPanel && !liveMonitorPanel.classList.contains("hidden")));
    if (isLogVis && liveMonitorPanel) {
      const isMobile = window.innerWidth <= 768;
      const effectiveHid = (isMobile && (!window.currentLogHotspotId || window.currentLogHotspotId === "all"))
        ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
        : window.currentLogHotspotId;

      const targetCard = (effectiveHid && effectiveHid !== "all")
        ? (document.querySelector(`.radio-container[data-hotspot-id="${effectiveHid}"]`) || document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container"))
        : (document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container"));

      const anchorEl = (targetCard && targetCard.closest(".collapsed-hotspots-stack")) || targetCard;
      if (anchorEl && anchorEl.nextElementSibling !== liveMonitorPanel) {
        anchorEl.after(liveMonitorPanel);
      }
    }

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
          ? window.t("quick_assign.xlx_module_unlinked", { name: hsName }, `✅ [${hsName}] TS2: Модуль XLX отключен (TG 4000)`)
          : `✅ [${hsName}] TS2: Модуль XLX отключен (TG 4000)`;
        showToast(toastMsg, 2500);
        renderRadiosGrid();
      } else {
        showToast(data.detail || data.message || "Ошибка отключения модуля", 3000);
      }
    } catch (e) {
      console.error("[XLX] Unlink failed:", e);
      showToast("Ошибка сети при отключении модуля", 2500);
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
      showToast(data.detail || data.message || "Ошибка подключения модуля", 3000);
    }
  } catch (e) {
    console.error("[XLX] Link module failed:", e);
    showToast("Ошибка сети при переключении модуля", 2500);
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
    tile.title = `Модуль ${letter} (TG ${4001 + (letter.charCodeAt(0) - 65)})`;
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
          ${commonMods.map(m => `
            <button type="button" class="btn-xlx-mod ${m === curMod ? 'active-xlx-mod' : ''}" data-module="${m}" title="Модуль ${m} (TG ${4001 + (m.charCodeAt(0) - 65)})">${m}</button>
          `).join("")}
        </div>
        <div class="xlx-controls-col">
          <div class="xlx-active-mod-pill ${isExtendedMod ? 'active-xlx-mod' : ''}" role="button" tabindex="0" title="Текущий модуль: ${curMod}. Кликните для выбора любого модуля A–Z">${modLabel} <strong>${curMod}</strong></div>
          <div class="xlx-actions-row">
            <button type="button" class="btn-xlx-all ${isExtendedMod ? 'active-xlx-mod' : ''}" title="Все 26 модулей A–Z (выбор в 1 клик)">🔤 ${isExtendedMod ? curMod : 'A–Z'} ▾</button>
            <button type="button" class="btn-xlx-unlink" title="Отключить модуль (Unlink TG 4000)">🔌 4000</button>
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
        const unlinkedText = window.t ? window.t("dmrplus.ref_unlinked", {}, "Отключен") : "Отключен";
        showToast(`✅ [${hsName}] TS2: Рефлектор DMR+ ${unlinkedText} (4000 Unlink)`, 2500);
        renderRadiosGrid();
      } else {
        showToast(data.detail || data.message || "Ошибка отключения рефлектора", 3000);
      }
    } catch (e) {
      console.error("[DMR+] Unlink failed:", e);
      showToast("Ошибка сети при отключении рефлектора", 2500);
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
        showToast(`ℹ️ [${hsName}] TS2: Запрос статуса рефлектора (5000 Status)`, 2500);
      } else {
        showToast(data.detail || data.message || "Ошибка запроса статуса", 3000);
      }
    } catch (e) {
      console.error("[DMR+] Status request failed:", e);
      showToast("Ошибка сети при запросе статуса", 2500);
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
        ? window.t("dmrplus.ref_linked_toast", { ref: num }, `Подключен рефлектор ${num} (Голос в TG 9)`)
        : `Подключен рефлектор ${num} (Голос в TG 9)`;
      showToast(`✅ [${hsName}] TS2: ${toastMsg}`, 2500);
      renderRadiosGrid();
    } else {
      showToast(data.detail || data.message || "Ошибка подключения рефлектора", 3000);
    }
  } catch (e) {
    console.error("[DMR+] Link reflector failed:", e);
    showToast("Ошибка сети при переключении рефлектора", 2500);
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
      <div class="dmrplus-ref-current" title="Текущий рефлектор TS2 (Голос в TG 9)">
        <span class="dmrplus-ref-icon">📡</span>
        <span class="dmrplus-ref-label">${refLabel}</span>
        <span class="dmrplus-ref-badge ${curRef ? 'active' : 'unlinked'}">${curRefDisplay}</span>
      </div>
      <div class="dmrplus-ref-actions">
        <button type="button" class="btn-dmrplus-action btn-dmrplus-unlink" title="${unlinkTitle}">🔌 4000</button>
        <button type="button" class="btn-dmrplus-action btn-dmrplus-status" title="${statusTitle}">ℹ️ 5000</button>
        <button type="button" class="btn-dmrplus-action btn-dmrplus-custom" title="Ввести номер рефлектора (4001–4999)">🔢 4xxx</button>
      </div>
    </div>
    <div class="dmrplus-ref-quick-row">
      <span class="dmrplus-quick-label" title="${quickTitle}">⚡</span>
      <div class="dmrplus-quick-btns">
        <button type="button" class="btn-dmrplus-quick ${curRef === '4530' ? 'active' : ''}" data-ref="4530" title="4530 RU (Россия / СНГ)">🇷🇺 4530</button>
        <button type="button" class="btn-dmrplus-quick ${curRef === '4001' ? 'active' : ''}" data-ref="4001" title="4001 DL (Германия общий)">🇩🇪 4001</button>
        <button type="button" class="btn-dmrplus-quick ${curRef === '4030' ? 'active' : ''}" data-ref="4030" title="4030 OE (Австрия)">🇦🇹 4030</button>
        <button type="button" class="btn-dmrplus-quick ${curRef === '4400' ? 'active' : ''}" data-ref="4400" title="4400 UK (Великобритания)">🇬🇧 4400</button>
        <button type="button" class="btn-dmrplus-quick ${curRef === '4700' ? 'active' : ''}" data-ref="4700" title="4700 US (Северная Америка)">🇺🇸 4700</button>
        <button type="button" class="btn-dmrplus-quick ${curRef === '4800' ? 'active' : ''}" data-ref="4800" title="4800 PT (Бразилия)">🇧🇷 4800</button>
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

export function renderRadiosGrid() {
    const radiosGrid = document.getElementById("radiosGrid");
    if (!radiosGrid) return;

    radiosGrid.querySelectorAll(".collapsed-hotspots-stack").forEach(stack => {
      while (stack.firstChild) {
        radiosGrid.insertBefore(stack.firstChild, stack);
      }
      stack.remove();
    });

    const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length)
      ? window.currentHotspots
      : (Array.isArray(currentHotspots) && currentHotspots.length ? currentHotspots : []);
    const displayHotspots = allHs.slice(0, 7);
    if (!displayHotspots.length) return;

    const template = document.getElementById("radioCardTemplate");
    const existingCards = Array.from(radiosGrid.querySelectorAll(".radio-container"));
    const allowedIds = new Set(displayHotspots.map(h => h.id));

    // Remove obsolete cards if more than current count
    existingCards.forEach((c) => {
      const cid = c.dataset.hotspotId;
      if (cid && !allowedIds.has(cid) && existingCards.length > displayHotspots.length) {
        c.remove();
      }
    });

    displayHotspots.forEach((hs, idx) => {
      let card = radiosGrid.querySelector(`.radio-container[data-hotspot-id="${hs.id}"]`);
      if (!card) {
        if (idx === 0 && existingCards[0] && (!existingCards[0].dataset.hotspotId || existingCards[0].dataset.hotspotId === "default")) {
          card = existingCards[0];
          card.dataset.hotspotId = hs.id;
          card.dataset.networkType = (hs.network_type || "bm").toLowerCase();
        } else if (template) {
          card = template.content.firstElementChild.cloneNode(true);
          card.dataset.hotspotId = hs.id;
          card.dataset.networkType = (hs.network_type || "bm").toLowerCase();
          if (window.I18N) window.I18N.apply(card);
          radiosGrid.appendChild(card);
        }
      }
      if (!card) return;

      // Ensure DOM position in radiosGrid matches displayHotspots order!
      if (card.parentElement === radiosGrid) {
        radiosGrid.appendChild(card);
      }

      // Logo ProxDMR must be present ONLY on the first main hotspot card (idx === 0)
      if (idx > 0) {
        card.querySelectorAll(".brand-logo-wrap").forEach(el => el.remove());
      } else {
        const brandTitle = card.querySelector(".brand-title");
        if (brandTitle && !brandTitle.querySelector(".brand-logo-wrap")) {
          const logoWrap = document.createElement("div");
          logoWrap.className = "brand-logo-wrap";
          logoWrap.tabIndex = 0;
          const hintText = (window.t && window.t("about.logo_hint")) || "Длинный тап — вызов About";
          logoWrap.innerHTML = `
            <img src="/static/img/Logo_light.png?v=2.9.85" alt="ProxDMR" class="brand-logo-img brand-logo-dark">
            <img src="/static/img/Logo_dark.png?v=2.9.85" alt="ProxDMR" class="brand-logo-img brand-logo-light">
            <span class="brand-logo-hint" data-i18n="about.logo_hint">${hintText}</span>
          `;
          brandTitle.insertBefore(logoWrap, brandTitle.firstChild);
        }
      }

      // In Android APK mode: remove fullscreen button from all hotspot cards
      if (window.AndroidBridge) {
        card.querySelectorAll(".fullscreen-toggle-btn:not(.android-exit-btn)").forEach(b => b.remove());
      }

      // Active state highlight
      card.classList.toggle("active-hotspot", hs.id === activeHotspotId);

      // Collapse state sync
      const isCollapsed = isHotspotCollapsed(hs.id);
      const isLive = isHotspotLiveCollapsed(hs.id);
      card.classList.toggle("collapsed", isCollapsed);
      card.classList.toggle("live-collapsed", isCollapsed && isLive);
      const collapseBtn = card.querySelector(".hotspot-collapse-btn");
      if (collapseBtn) {
        collapseBtn.title = isCollapsed
          ? (window.t ? window.t("vfo.hotspot_expand_title") : "Развернуть этот хотспот")
          : (window.t ? window.t("vfo.hotspot_collapse_title") : "Свернуть этот хотспот (удержание: свернуть без отключения)");
      }

      // Populate text
      const nameBadge = card.querySelector(".hotspot-name-badge");
      if (nameBadge) {
        nameBadge.removeAttribute("data-i18n");
        const hsName = hs.name || `Хотспот #${idx + 1}`;
        nameBadge.textContent = hsName;
        nameBadge.title = hsName;
        nameBadge.classList.toggle("is-online", (!isCollapsed || isLive) && isHotspotFullyOnline(hs));
      }

      const duplexBadge = card.querySelector(".duplex-badge");
      if (duplexBadge) duplexBadge.textContent = "DUPLEX";

      const csDisplay = card.querySelector(".callsign-display");
      if (csDisplay) {
        if (!csDisplay.dataset.rawCallsign) csDisplay.dataset.rawCallsign = hs.callsign || "N0CALL";
        const effCs = (window.localizeDemoText ? window.localizeDemoText(hs.callsign) : hs.callsign) || "N0CALL";
        csDisplay.textContent = effCs;
      }

      const idDisplay = card.querySelector(".dmr-id-display");
      if (idDisplay) idDisplay.textContent = `ID: ${hs.effective_id || hs.dmr_id || 0}`;

      updateCardBmBanner(card, hs);

      const isXlxNet = ((hs && hs.network_type) || "bm").toLowerCase() === "xlx";
      card.classList.toggle("card-net-xlx", isXlxNet);

      const isDmrPlusNet = ((hs && hs.network_type) || "bm").toLowerCase() === "dmrplus";
      card.classList.toggle("card-net-dmrplus", isDmrPlusNet);

      updateCardXlxPanel(card, hs);
      updateCardDmrPlusPanel(card, hs);
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
        const curTg1 = getHotspotTg(cid, 1);
        tg1Num.textContent = `TG ${curTg1}`;
        tg1Num.style.cursor = "pointer";
        tg1Num.title = window.t ? window.t("hotspots.tg1_select_title", {}, "Кликните для выбора группы или ID на TS1") : "Кликните для выбора группы или ID на TS1";
        tg1Num.onclick = (e) => {
          e.stopPropagation();
          const curNet = ((hs && hs.network_type) || "bm").toLowerCase();
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

      const tg2Num = card.querySelector(".tg-ts2-num");
      if (tg2Num) {
        const cid = card.dataset.hotspotId || hs.id;
        const curNet = ((hs && hs.network_type) || "bm").toLowerCase();
        if (curNet === "dmrplus") {
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

      // Delete button for secondary hotspots
      const delBtn = card.querySelector(".hotspot-delete-btn");
      if (delBtn) {
        if (displayHotspots.length > 1) {
          delBtn.style.display = "inline-block";
          delBtn.onclick = async (e) => {
            e.stopPropagation();
            const ok = await (window.showAppConfirm ? window.showAppConfirm({
              title: "Удаление хотспота",
              icon: "🗑️",
              message: `Удалить виртуальный хотспот "${hs.name}"?`,
              confirmText: "Удалить",
              confirmStyle: "danger"
            }) : Promise.resolve(confirm(`Удалить виртуальный хотспот "${hs.name}"?`)));
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
              await loadHotspots();
            }
          };
        } else {
          delBtn.style.display = "none";
        }
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
        let apiComment = window.t ? window.t("status.api_no_key_detail") : "Ключ не настроен (клик для ввода)";
        let apiTooltip = `⚪ ${netShort} API: Ключ не настроен. Нажмите для ввода`;

        if (apiStatus === "ONLINE") {
          apiBadgeClass = "status-online bm-online";
          apiBadgeText = "API:ONLINE";
          apiComment = hs._apiDetail ? `${apiDomain} (${hs._apiDetail})` : `${apiDomain} (Авторизован)`;
          apiTooltip = `🟢 ${netShort} API ${netVersion}: Авторизован. Клик для повторной проверки`;
        } else if (apiStatus === "CHECKING") {
          apiBadgeClass = "status-connecting bm-connecting";
          apiBadgeText = "API:CHECKING";
          apiComment = isTgif ? "Проверка токена TGIF..." : (window.t ? window.t("status.api_checking_detail") : "Проверка токена v2...");
          apiTooltip = `🟡 ${netShort} API: Проверка соединения...`;
        } else if (apiStatus === "AUTH_FAILED") {
          apiBadgeClass = "status-error bm-error";
          apiBadgeText = "API:AUTH FAIL";
          apiComment = hs._apiDetail || (isTgif ? "Неверный токен TGIF (401)" : (window.t ? window.t("status.api_auth_detail") : "Неверный токен (401 Unauthorized)"));
          apiTooltip = `🔴 ${netShort} API: ${apiComment}. Нажмите для настройки`;
        } else if (apiStatus === "NO_KEY") {
          apiBadgeClass = "status-offline bm-offline";
          apiBadgeText = "API:NO KEY";
          apiComment = window.t ? window.t("status.api_no_key_detail") : "Ключ не настроен (клик для ввода)";
          apiTooltip = `⚪ ${netShort} API: Ключ не настроен. Нажмите для ввода`;
        } else if (apiStatus === "OFFLINE" || apiStatus === "ERROR") {
          apiBadgeClass = "status-error bm-error";
          apiBadgeText = "API:ERROR";
          apiComment = hs._apiDetail || `Сервер ${apiDomain} недоступен`;
          apiTooltip = `🔴 ${netShort} API: ${apiComment}. Клик для повторной проверки`;
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
          if (curNet !== "bm" && curNet !== "tgif" && curNet !== "freedmr" && curNet !== "xlx") {
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
            btnStatic.title = "Управление TalkGroups TGIF (Статические / Динамические)";
          } else if (netType === "freedmr") {
            btnStatic.title = "Управление TalkGroups FreeDMR (Статические / Динамические)";
          } else if (netType === "xlx") {
            btnStatic.title = "Управление модулями XLX (A–Z / TG 9)";
          } else if (netType === "bm") {
            btnStatic.title = "Управление TalkGroups BM (Статические / Динамические)";
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
            btnSrch.title = "TG: поиск групп | Manage: управление TG TGIF | ID: поиск позывных/ID";
          } else if (netType === "freedmr") {
            btnSrch.title = "TG: поиск групп | Manage: управление TG FreeDMR | ID: поиск позывных/ID";
          } else if (netType === "xlx") {
            btnSrch.title = "TG: поиск групп | Manage: управление модулями XLX | ID: поиск позывных/ID";
          } else if (netType === "bm") {
            btnSrch.title = "TG: поиск групп | Manage: управление TG BM | ID: поиск позывных/ID";
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
            switchActiveHotspot(cid);
            openMyContactsModal(cid);
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
            const curNet = ((hs && hs.network_type) || "bm").toLowerCase();
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
            if (e.target.closest("button") || e.target.closest(".slot-badge") || e.target.closest(".vfo-lang-badge") || e.target.closest(".vfo-caption-box")) return;
            const cid = card.dataset.hotspotId || hs.id;

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

            switchActiveHotspot(cid);
            setCardSlot(card, 1, true);
          });
          const badge1 = vfo1.querySelector(".slot-badge");
          if (badge1) {
            badge1.style.cursor = "pointer";
            badge1.title = window.t ? window.t("hotspots.tg1_badge_title", {}, "Выбрать группу передачи для TS1 (справочник TG)") : "Выбрать группу передачи для TS1 (справочник TG)";
            const openModal1 = (e) => {
              const curNet = ((hs && hs.network_type) || "bm").toLowerCase();
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
            if (e.target.closest("button") || e.target.closest(".slot-badge") || e.target.closest(".vfo-lang-badge") || e.target.closest(".vfo-caption-box")) return;
            const cid = card.dataset.hotspotId || hs.id;

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

            switchActiveHotspot(cid);
            setCardSlot(card, 2, true);
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

            // Determine targetSlot based on left (TS1) vs right (TS2) click coordinate
            const isXlx = ((hs && hs.network_type) || "bm").toLowerCase() === "xlx";
            const targetSlot = isXlx ? 2 : ((relX < (rect.width / 2)) ? 1 : 2);
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
            if (pttHoldStartTimer) clearTimeout(pttHoldStartTimer);
            pttHoldStartTimer = setTimeout(() => {
              pttHoldStartTimer = null;
              startTransmission(cid, targetSlot);
            }, PTT_HOLD_DELAY_MS);
          });

          cardPttBtn.addEventListener("pointermove", (e) => {
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
            if (!(typeof window !== "undefined" && window.isPttPressed)) {
              const rect = cardPttBtn.getBoundingClientRect();
              const relX = e.clientX - rect.left;
              if (relX >= 0 && relX <= rect.width) {
                const isXlx = ((hs && hs.network_type) || "bm").toLowerCase() === "xlx";
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
          const agcActive = getHotspotAgc(cid);
          cardAgc.checked = agcActive;
          cardAgc.onclick = (e) => { e.stopPropagation(); };
          cardAgc.onchange = () => {
            setHotspotAgc(cid, cardAgc.checked);
          };
        }

        const cardTsModeBtn = card.querySelector(".ts-audio-mode-btn");
        if (cardTsModeBtn && typeof window.setupTsAudioModeButton === "function") {
          window.setupTsAudioModeButton(cardTsModeBtn, card, cid);
          if (typeof window.updateCardTsAudioModeUI === "function") {
            window.updateCardTsAudioModeUI(card, cid);
          }
        }

        const collapseBtn = card.querySelector(".hotspot-collapse-btn");
        if (collapseBtn) {
          setupCollapseButtonLongPress(collapseBtn, cid);
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
          const cleanDigits = quickInput.value.replace(/\D/g, "");
          if (quickInput.value !== cleanDigits) {
            quickInput.value = cleanDigits;
          }
          const num = parseInt(cleanDigits, 10);
          if (!cleanDigits || isNaN(num) || num <= 0 || num > 9999999) {
            hideQuickPreview();
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
            return `<span class="quick-tg-pop-sub">↳ Напр.: <b>ID ${safeEscapeHtml(String(uid))}</b> — <strong>${safeEscapeHtml(cs)}</strong>${details ? ` (${safeEscapeHtml(details)})` : ""}</span>`;
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
              const notFoundTxt = window.t ? window.t("tgtx.private_id_custom", {}, "Личный вызов DMR ID (нет в базе RadioID)") : "Личный вызов DMR ID (нет в базе RadioID)";
              quoteHtml = `<span class="quick-tg-pop-main">${safeEscapeHtml(notFoundTxt)}</span>` +
                (idPrefixUser ? formatUserPrefixHint(idPrefixUser) : "");
            } else {
              const searchTxt = window.t ? window.t("tgtx.private_id_searching", {}, "Личный вызов DMR ID • поиск позывного...") : "Личный вызов DMR ID • поиск позывного...";
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
          const rawName = tgNames[num] ? String(tgNames[num]).trim() : (isParrot ? "Parrot / Echo (Эхо-тест)" : "");
          const cleanDesc = getCleanTgDesc(num, rawName);
          const cInfo = (num >= 100 || rawName) ? getCountryInfo(num, "", "") : { name: "Global", name_en: "", flag: "🌐" };
          const flagHtml = getFlagBadgeHtml(cInfo, isParrot);
          const cLabel = isParrot ? "Эхо-тест" : ((cInfo && cInfo.name && cInfo.name !== "Global") ? cInfo.name : "TalkGroup");

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
              quoteHtml = `<span class="quick-tg-pop-main">${safeEscapeHtml(customTxt)}</span>` +
                (cached.prefix ? `<span class="quick-tg-pop-sub">↳ Напр.: <b>TG ${safeEscapeHtml(String(cached.prefix.tg))}</b> — ${safeEscapeHtml(cached.prefix.desc)}</span>` : "") +
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
          hideQuickPreview();
          if (!isNaN(val) && val > 0 && val <= 9999999) {
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

      // Ensure static Quick TG placeholder
      const quickInp = card.querySelector(".quick-tg-input");
      if (quickInp) {
        quickInp.placeholder = "TG #";
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
          ? (window.t ? window.t("vfo.hotspot_expand_title") : "Развернуть этот хотспот")
          : (window.t ? window.t("vfo.hotspot_collapse_title") : "Свернуть этот хотспот (удержание: свернуть без отключения)");
      }
      const nBadge = card.querySelector(".hotspot-name-badge");
      if (isCardCollapsed && !isCardLive) {
        if (nBadge) nBadge.classList.remove("is-online");
        setHotspotAudioMute(hs.id, true);
        if (window.audioPlayer && audioPlayer.resetHotspot) {
          audioPlayer.resetHotspot(hs.id);
        }
        if (hs.status === "ONLINE" || hs.status === "CONNECTING" || hs.status === "AUTHENTICATING") {
          hs.status = "DISCONNECTED";
          hs.detail = "Свернут / отключен";
          updateBmStatus("DISCONNECTED", "Свернут / отключен", hs.id);
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

    // Ensure live activity monitor / history panel stays correctly positioned after card reordering in radiosGrid
    const liveMonitorPanel = document.getElementById("liveMonitorPanel");
    const isLogVis = Boolean(typeof window.isLogVisible !== "undefined" ? window.isLogVisible : (liveMonitorPanel && !liveMonitorPanel.classList.contains("hidden")));
    if (isLogVis && liveMonitorPanel) {
      const isMobile = window.innerWidth <= 768;
      const effectiveHid = (isMobile && (!window.currentLogHotspotId || window.currentLogHotspotId === "all"))
        ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
        : window.currentLogHotspotId;

      const targetCard = (effectiveHid && effectiveHid !== "all")
        ? (document.querySelector(`.radio-container[data-hotspot-id="${effectiveHid}"]`) || document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container"))
        : (document.querySelector(".radio-container:not(.collapsed)") || document.querySelector(".radio-container"));

      const anchorEl = (targetCard && targetCard.closest(".collapsed-hotspots-stack")) || targetCard;
      if (anchorEl && anchorEl.nextElementSibling !== liveMonitorPanel) {
        anchorEl.after(liveMonitorPanel);
      }
    } else if (!isLogVis && liveMonitorPanel) {
      const dashboard = document.querySelector(".app-dashboard");
      if (dashboard && liveMonitorPanel.parentElement !== dashboard) {
        dashboard.appendChild(liveMonitorPanel);
      }
    }

    renderLogHotspotTabs();
    initQuickAssign();
    if (typeof updatePttLockUI === "function") {
      updatePttLockUI();
    }
    if (typeof window.updateLogVisibility === "function") {
      window.updateLogVisibility(false);
    }
  }
export function applyActiveHotspotToUI() {
    const hs = currentHotspots.find(h => h.id === activeHotspotId) || currentHotspots[0];
    if (!hs) return;

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
      const emptyHs = window.t ? window.t("hotspots.empty_configured") : "Нет настроенных хотспотов";
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
      let autoTgCardTextFallback = "Автонастройка TG BM";
      if (hsNet === "tgif") {
        netTag = "TGIF";
        autoTgDisabledKey = "hotspots.auto_tg_tgif_disabled_title";
        autoTgCardTextKey = "hs_edit.auto_tg_tgif";
        autoTgCardTextFallback = "Автонастройка TG TGIF";
      } else if (hsNet === "freedmr") {
        netTag = "FreeDMR";
        autoTgDisabledKey = "hotspots.auto_tg_freedmr_disabled_title";
        autoTgCardTextKey = "hs_edit.auto_tg_freedmr";
        autoTgCardTextFallback = "Автонастройка TG FreeDMR";
      } else if (hsNet === "xlx") {
        netTag = "XLX";
        autoTgDisabledKey = "hotspots.auto_tg_xlx_disabled_title";
        autoTgCardTextKey = "hs_edit.auto_tg_xlx";
        autoTgCardTextFallback = "Автоподключение XLX";
      }
      const lockTitle = window.t 
        ? window.t(autoTgDisabledKey, {}, `Автонастройка TG ${netTag} отключена`) 
        : `Автонастройка TG ${netTag} отключена`;
      const lockIcon = !isAutoTgBm ? `<span class="hs-lock-icon" style="margin-left: 6px; font-size: 0.95em; vertical-align: middle;" title="${lockTitle}">🔒</span>` : '';
      const collapsedBgText = window.t ? window.t("hotspots.badge_collapsed_bg", {}, "🟢 СВЕРНУТ (В ФОНЕ)") : "🟢 СВЕРНУТ (В ФОНЕ)";
      const collapsedText = window.t ? window.t("hotspots.badge_collapsed", {}, "⚪ СВЕРНУТ") : "⚪ СВЕРНУТ";
      const statusBadge = isCollapsed
        ? (isLive
            ? `<span style='color: #00e676; font-size: 0.75rem; font-weight: bold;'>${collapsedBgText}</span>`
            : `<span style='color: var(--text-muted); font-size: 0.75rem;'>${collapsedText}</span>`)
        : (isOnline
          ? "<span style='color: var(--color-green); font-size: 0.75rem; font-weight: bold;'>🟢 ONLINE</span>"
          : "<span style='color: var(--text-muted); font-size: 0.75rem;'>⚪ OFFLINE</span>");

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
              ${isOnline ? (window.t ? window.t("hotspots.btn_disconnect") : "Отключить") : (window.t ? window.t("hotspots.btn_connect") : "🔗 Подключить")}
            </button>
            <button class="btn-card-action btn-edit-hs" data-id="${hs.id}">✏️ ${window.t ? window.t("buttons.edit") : "Изменить"}</button>
            ${currentHotspots.length > 1 ? `<button class="btn-card-action danger btn-del-hs" data-id="${hs.id}">🗑️</button>` : ""}
          </div>
          <div class="hs-card-toggles-row" style="display: flex; align-items: center; gap: 10px; margin-left: auto; flex-wrap: wrap;">
            ${(hsNet === "bm" || hsNet === "tgif" || hsNet === "freedmr" || hsNet === "xlx") ? `
            <label class="hs-card-autotg-label" style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; cursor: pointer; user-select: none; color: var(--text-primary, #c9d1d9);">
              <input type="checkbox" class="chk-hs-autotg" data-id="${hs.id}" ${isAutoTgBm ? 'checked' : ''} style="cursor: pointer; width: 15px; height: 15px; accent-color: #58a6ff;">
              <span>${window.t ? window.t(autoTgCardTextKey, {}, autoTgCardTextFallback) : autoTgCardTextFallback}</span>
            </label>` : ""}
            <label class="hs-card-autorec-label" style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; cursor: pointer; user-select: none; color: var(--text-primary, #c9d1d9);" title="Автозапись TS1/2">
              <input type="checkbox" class="chk-hs-autorec" data-id="${hs.id}" ${hs.auto_record !== false ? 'checked' : ''} style="cursor: pointer; width: 15px; height: 15px; accent-color: #ef4444;">
              <span data-i18n="hs_edit.auto_record">${window.t ? window.t("hs_edit.auto_record") : "Автозапись TS1/2"}</span>
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
          const ok = await (window.showAppConfirm ? window.showAppConfirm({
            title: "Удаление хотспота",
            icon: "🗑️",
            message: `Удалить хотспот "${hs.name}"?`,
            confirmText: "Удалить",
            confirmStyle: "danger"
          }) : Promise.resolve(confirm(`Удалить хотспот "${hs.name}"?`)));
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
                ? (window.t ? window.t(netKeyOn, { name: hs.name }, `✅ [${hs.name}]: Автонастройка TG ${netTag} включена`) : `✅ [${hs.name}]: Автонастройка TG ${netTag} включена`) 
                : (window.t ? window.t(netKeyOff, { name: hs.name }, `🔒 [${hs.name}]: Автонастройка TG ${netTag} отключена`) : `🔒 [${hs.name}]: Автонастройка TG ${netTag} отключена`);
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
          updateAllHotspotRecUI();
          try {
            const res = await fetch(`/api/hotspots/${hs.id}/auto-record`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: newVal })
            });
            if (res.ok) {
              showToast(newVal ? (window.t ? window.t("hotspots.autorec_on", { name: hs.name }, `✅ [${hs.name}]: Автозапись вызовов включена`) : `✅ [${hs.name}]: Автозапись вызовов включена`) : (window.t ? window.t("hotspots.autorec_off", { name: hs.name }, `⏸️ [${hs.name}]: Автозапись вызовов отключена`) : `⏸️ [${hs.name}]: Автозапись вызовов отключена`), 2500);
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
    editHsMasterSelect.innerHTML = "";

    if (netType !== "custom") {
      const benchOpt = document.createElement("option");
      benchOpt.value = "__TEST_SERVERS__";
      benchOpt.textContent = window.t ? window.t("hotspots.bench_opt", {}, "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)") : "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)";
      editHsMasterSelect.appendChild(benchOpt);
    }

    const defOpt = document.createElement("option");
    defOpt.value = "";
    defOpt.textContent = netType === "bm"
      ? (window.t ? window.t("hs_edit.master_select_prompt") : "🌍 Выберите страну / сервер BM...")
      : (window.t ? window.t("hs_edit.master_select_net_prompt", { net: profile.shortName }, `🌐 Выберите сервер ${profile.shortName}...`) : `🌐 Выберите сервер ${profile.shortName}...`);
    editHsMasterSelect.appendChild(defOpt);

    let matched = false;
    const cleanCurrent = (hostVal || "").trim().toLowerCase();

    const curLang = (window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
    const isCyrLang = (curLang === "ru" || curLang === "uk");
    const recTag = window.t ? window.t("bm.master_recommended", {}, "⭐ [Рекомендуется]") : "⭐ [Рекомендуется]";

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
        const cCode = (m.country_code || m.country || "GLOBAL").toUpperCase();
        const countryName = cCode !== "GLOBAL"
          ? getLocalizedCountryName(cCode, m.country_name || m.country || profile.shortLabel || profile.shortName || "DMR", curLang)
          : (m.country_name || m.country || profile.shortLabel || profile.shortName || "DMR");
        const flag = m.flag || (cCode !== "GLOBAL" ? isoToEmoji(cCode) : "🌐");
        const recSuffix = m.recommended ? ` ${recTag}` : "";
        const prefixLabel = netType === "bm" ? `BM ${m.id || ""}` : (m.name || m.id || "");
        const labelMid = prefixLabel ? `${prefixLabel} ` : "";

        const st = (m.state || "").toLowerCase();
        const isDead = ["no_reply", "refused", "dns_fail"].includes(st) ||
                       (m.udp_ok === false && m.avg_ping == null && m.udp_ms == null) ||
                       (m.loss_pct !== undefined && m.loss_pct >= 100);
        const pingVal = (m.udp_ms !== undefined && m.udp_ms !== null) ? m.udp_ms : ((m.avg_ping !== undefined && m.avg_ping !== null) ? m.avg_ping : null);
        const msUnit = isCyrLang ? "мс" : "ms";
        const deadLabel = isCyrLang ? "🔴 НЕ ОТВЕЧАЕТ" : "🔴 NO REPLY";

        if (isDead) {
          opt.textContent = `${deadLabel} · ${flag} ${countryName} — ${labelMid}(${m.host || ""})`;
          opt.style.color = "#ef4444";
          opt.dataset.dead = "1";
        } else if (pingVal !== null && !isNaN(pingVal)) {
          opt.textContent = `⚡ ${Math.round(pingVal)} ${msUnit} · ${flag} ${countryName} — ${labelMid}(${m.host || ""})${recSuffix}`;
          opt.dataset.ping = String(Math.round(pingVal));
        } else {
          opt.textContent = `${flag} ${countryName} — ${labelMid}(${m.host || ""})${recSuffix}`;
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
      customOpt.textContent = netType === "freedmr"
        ? `⚠️ Свой / устаревший: ${cleanCurrent}`
        : (window.t ? window.t("hs_edit.master_custom_option") : `✏️ Ввести свой адрес вручную (${cleanCurrent})`);
      customOpt.selected = true;
      editHsMasterSelect.appendChild(customOpt);
    } else {
      const customOpt = document.createElement("option");
      customOpt.value = "CUSTOM";
      customOpt.textContent = window.t ? window.t("hs_edit.master_custom_option") : "✏️ Ввести свой адрес вручную (другой сервер / IP)";
      editHsMasterSelect.appendChild(customOpt);
    }
  }

export function buildRptoFromCurrentFormFields(netTypeOverride) {
  const editHsNetworkType = document.getElementById("editHsNetworkType");
  const cleanType = (netTypeOverride || (editHsNetworkType && editHsNetworkType.value) || "bm").toLowerCase();
  const editHsTgTs1 = document.getElementById("editHsTgTs1");
  const editHsTgTs2 = document.getElementById("editHsTgTs2");
  const editHsId = document.getElementById("editHsId");
  const tg1 = parseInt(editHsTgTs1 ? editHsTgTs1.value : "0", 10) || 0;
  const tg2 = parseInt(editHsTgTs2 ? editHsTgTs2.value : "0", 10) || 0;

  if (cleanType === "dmrplus") {
    const refEl = document.getElementById("editHsDmrPlusRef");
    const relinkEl = document.getElementById("editHsDmrPlusRelink");
    const startRef = parseInt(refEl ? refEl.value : "4530", 10) || 4530;
    const relinkTime = parseInt(relinkEl ? relinkEl.value : "60", 10) || 60;
    const parts = [`StartRef=${startRef}`, `RelinkTime=${relinkTime}`];
    if (tg1 > 0 && tg1 !== 9990) parts.push(`TS1_1=${tg1}`);
    if (tg2 > 0 && tg2 !== 9990 && tg2 !== 9) parts.push(`TS2_1=${tg2}`);
    return parts.join(";") + ";";
  }

  if (cleanType === "freedmr" || cleanType === "custom") {
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
        showToast(`FreeDMR не допускает одну TG на обоих слотах — TG ${tg1} оставлена только на TS1`, 2800);
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
    const hasRpto = Boolean(profile.hasRpto || profile.supportsRpto || cleanType === "freedmr" || cleanType === "dmrplus" || cleanType === "custom");
    const hasXlxModule = Boolean(profile.hasXlxModule || profile.supportsXlxModule || cleanType === "xlx");
    const fullName = profile.fullName || profile.name || "BrandMeister DMR";
    const shortLabel = profile.shortLabel || profile.shortName || "BM";

    // 1. Toggle network type selector (ONLY for new HS) vs read-only network header (for existing HS)
    const netTypeGroup = document.getElementById("editHsNetworkTypeGroup");
    const existingNetHeader = document.getElementById("editHsExistingNetHeader");
    if (netTypeGroup) {
      netTypeGroup.style.display = isNewHotspot ? "block" : "none";
    }
    if (existingNetHeader) {
      existingNetHeader.style.display = isNewHotspot ? "none" : "flex";
    }

    const pillEl = document.getElementById("editHsNetworkTypePill");
    if (pillEl) {
      renderNetworkBadgeElement(pillEl, cleanType, { xlxModule: curMod });
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
      } else if (cleanType === "dmrplus") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_dmrplus", {}, "🔒 Сеть HS • IPSC2 + StartRef (RPTO)") : "🔒 Сеть HS • IPSC2 + StartRef (RPTO)";
      } else if (cleanType === "xlx") {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_xlx", { mod: curMod, tg: modTg }, `🔒 Сеть HS • Модуль ${curMod} (TG ${modTg} на TS2)`) : `🔒 Сеть HS • Модуль ${curMod} (TG ${modTg} на TS2)`;
      } else {
        existingDescEl.textContent = window.t ? window.t("hs_edit.net_desc_custom", {}, "🔒 Сеть HS • Custom MMDVM") : "🔒 Сеть HS • Custom MMDVM";
      }
    }

    // 2. Apply dynamic network color palette to the form container (#hotspotEditForm)
    const formEl = document.getElementById("hotspotEditForm");
    if (formEl) {
      formEl.classList.add("hs-edit-dynamic-panel");
      ["bm", "tgif", "freedmr", "dmrplus", "xlx", "custom"].forEach(t => {
        formEl.classList.remove(`hs-net-theme-${t}`);
      });
      formEl.classList.add(`hs-net-theme-${cleanType}`);
    }

    // 3. Toggle network-specific field blocks
    const pwdGroup = document.getElementById("editHsPasswordGroup");
    const apiKeyGroup = document.getElementById("editHsApiKeyGroup");
    const autoTgBmGroup = document.getElementById("editHsAutoTgBmGroup");
    const testServersCol = document.getElementById("editHsTestServersCol");
    const dmrPlusGroup = document.getElementById("editHsDmrPlusGroup");
    const rptoGroup = document.getElementById("editHsRptoGroup");
    const rptoLabel = document.getElementById("editHsRptoLabel");
    const rptoInput = document.getElementById("editHsRptoOptions");
    const rptoHint = document.getElementById("editHsRptoHint");
    const btnBuildRptoFromTg = document.getElementById("btnBuildRptoFromTg");
    const btnSendRptoNow = document.getElementById("btnSendRptoNow");
    const xlxGroup = document.getElementById("editHsXlxGroup");
    const tgRow = document.getElementById("editHsTgRow");
    const pwdLabel = document.getElementById("editHsPasswordLabel");
    const masterLabel = document.getElementById("editHsMasterSelectLabel");
    const editHsHost = document.getElementById("editHsHost");
    const editHsPort = document.getElementById("editHsPort");
    const editHsPassword = document.getElementById("editHsPassword");
    const editHsTgTs1 = document.getElementById("editHsTgTs1");
    const editHsTgTs2 = document.getElementById("editHsTgTs2");
    const tgTs1Label = document.getElementById("editHsTgTs1Label");
    const tgTs2Label = document.getElementById("editHsTgTs2Label");

    if (pwdGroup) pwdGroup.style.display = "";
    if (apiKeyGroup) apiKeyGroup.style.display = hasBmApi ? "" : "none";
    if (autoTgBmGroup) autoTgBmGroup.style.display = (hasBmApi || cleanType === "freedmr" || cleanType === "xlx") ? "inline-flex" : "none";
    if (testServersCol) {
      testServersCol.style.display = (cleanType === "custom" || cleanType === "bm" || cleanType === "tgif" || cleanType === "freedmr" || cleanType === "dmrplus" || cleanType === "xlx") ? "flex" : "none";
      const btnTestBmServers = document.getElementById("btnTestBmServers");
      const btnSpan = btnTestBmServers ? btnTestBmServers.querySelector("span:not(.btn-icon)") : null;
      if (btnSpan) {
        if (cleanType === "custom") {
          btnSpan.textContent = window.t ? window.t("server_probe.btn_check_single", {}, "Проверить сервер") : "Проверить сервер";
        } else {
          btnSpan.textContent = window.t ? window.t("bm_bench.btn_test", {}, "Тест серверов") : "Тест серверов";
        }
      }
    }
    if (dmrPlusGroup) dmrPlusGroup.style.display = (cleanType === "dmrplus") ? "flex" : "none";
    if (rptoGroup) rptoGroup.style.display = hasRpto ? "" : "none";
    if (btnBuildRptoFromTg) btnBuildRptoFromTg.style.display = hasRpto ? "inline-flex" : "none";
    if (btnSendRptoNow) btnSendRptoNow.style.display = (!isNewHotspot && hasRpto) ? "inline-flex" : "none";
    if (xlxGroup) xlxGroup.style.display = hasXlxModule ? "" : "none";
    if (tgRow) tgRow.style.display = (cleanType === "xlx") ? "none" : "flex";

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

    // Customize RPTO texts for FreeDMR vs DMR+ vs Custom
    if (cleanType === "freedmr") {
      if (rptoLabel) rptoLabel.textContent = window.t ? window.t("hs_edit.rpto_freedmr_label", {}, "Опции FreeDMR (RPTO) — статические TG (TS1 / TS2)") : "Опции FreeDMR (RPTO) — статические TG (TS1 / TS2)";
      if (rptoInput) rptoInput.placeholder = "TS1=2501;TS2=250,2505;DIAL=0;";
      if (rptoHint) rptoHint.textContent = window.t ? window.t("hs_edit.rpto_freedmr_hint", {}, "Передаётся в пакете RPTO сразу после авторизации (нажмите «🔄 Из TS1/TS2» для автосборки из стартовых групп ниже)") : "Передаётся в пакете RPTO сразу после авторизации (нажмите «🔄 Из TS1/TS2» для автосборки из стартовых групп ниже)";
    } else if (cleanType === "dmrplus") {
      if (rptoLabel) rptoLabel.textContent = window.t ? window.t("hs_edit.rpto_dmrplus_label", {}, "Строка конфигурации DMR+ / IPSC2 (RPTO)") : "Строка конфигурации DMR+ / IPSC2 (RPTO)";
      if (rptoInput) rptoInput.placeholder = "StartRef=4530;RelinkTime=60;TS1_1=2501;TS2_1=250;";
      if (rptoHint) rptoHint.textContent = window.t ? window.t("hs_edit.rpto_dmrplus_hint", {}, "Формируется автоматически из полей StartRef / RelinkTime / TG или редактируется вручную") : "Формируется автоматически из полей StartRef / RelinkTime / TG или редактируется вручную";
    } else if (cleanType === "custom") {
      if (rptoLabel) rptoLabel.textContent = window.t ? window.t("hs_edit.rpto_custom_label", {}, "Опции HomeBrew (RPTO) — статические TG и параметры") : "Опции HomeBrew (RPTO) — статические TG и параметры";
      if (rptoInput) rptoInput.placeholder = "TS1=2501;TS2=2505;";
      if (rptoHint) rptoHint.textContent = window.t ? window.t("hs_edit.rpto_custom_hint", {}, "Строка опций RPTO, отправляемая серверу HBlink3 / MMDVM после пакета RPTC") : "Строка опций RPTO, отправляемая серверу HBlink3 / MMDVM после пакета RPTC";
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
      } else if (cleanType === "dmrplus") {
        pwdLabel.textContent = window.t ? window.t("hs_edit.dmrplus_password", {}, "Пароль сервера DMR+ / IPSC2 (стандартный: PASSWORD)") : "Пароль сервера DMR+ / IPSC2 (стандартный: PASSWORD)";
        if (editHsPassword) editHsPassword.placeholder = "PASSWORD";
      } else if (cleanType === "xlx") {
        pwdLabel.textContent = window.t ? window.t("hs_edit.xlx_password", {}, "Пароль рефлектора XLX (стандартный: passw0rd)") : "Пароль рефлектора XLX (стандартный: passw0rd)";
        if (editHsPassword) editHsPassword.placeholder = "passw0rd";
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
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_freedmr", {}, "Сервер FreeDMR / ADN — выбор по странам") : "Сервер FreeDMR / ADN — выбор по странам";
      } else if (cleanType === "dmrplus") {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_dmrplus", {}, "Мастер-сервер DMR+ / IPSC2 — выбор по странам") : "Мастер-сервер DMR+ / IPSC2 — выбор по странам";
      } else if (cleanType === "xlx") {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_xlx", {}, "Рефлектор XLX — выбор сервера (порт 62030)") : "Рефлектор XLX — выбор сервера (порт 62030)";
      } else {
        masterLabel.textContent = window.t ? window.t("hs_edit.master_select_custom", {}, "Выбор сервера (пресет или свой IP/домен)") : "Выбор сервера (пресет или свой IP/домен)";
      }
    }
    if (editHsHost) {
      editHsHost.placeholder = profile.defaultHost || "127.0.0.1";
    }

    // Customize TS1 / TS2 labels per network
    if (tgTs1Label && tgTs2Label) {
      if (cleanType === "tgif") {
        tgTs1Label.textContent = window.t ? window.t("hs_edit.tg_ts1", {}, "Стартовая TG (Слот 1)") : "Стартовая TG (Слот 1)";
        tgTs2Label.textContent = window.t ? window.t("hs_edit.tg_ts2_tgif", {}, "Основная TG TGIF (Слот 2 • 4000 = сброс)") : "Основная TG TGIF (Слот 2 • 4000 = сброс)";
      } else if (cleanType === "freedmr") {
        tgTs1Label.textContent = window.t ? window.t("hs_edit.tg_ts1_freedmr", {}, "Статическая / стартовая TG (Слот 1)") : "Статическая / стартовая TG (Слот 1)";
        tgTs2Label.textContent = window.t ? window.t("hs_edit.tg_ts2_freedmr", {}, "Статическая / стартовая TG (Слот 2)") : "Статическая / стартовая TG (Слот 2)";
      } else if (cleanType === "dmrplus") {
        tgTs1Label.textContent = window.t ? window.t("hs_edit.tg_ts1_dmrplus", {}, "Глобальная TG (Слот 1: TS1_1)") : "Глобальная TG (Слот 1: TS1_1)";
        tgTs2Label.textContent = window.t ? window.t("hs_edit.tg_ts2_dmrplus", {}, "Локальная TG / Рефлектор (Слот 2: 9)") : "Локальная TG / Рефлектор (Слот 2: 9)";
      } else {
        tgTs1Label.textContent = window.t ? window.t("hs_edit.tg_ts1", {}, "Стартовая TG (Слот 1)") : "Стартовая TG (Слот 1)";
        tgTs2Label.textContent = window.t ? window.t("hs_edit.tg_ts2", {}, "Стартовая TG (Слот 2)") : "Стартовая TG (Слот 2)";
      }
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
      if (editHsPort) editHsPort.value = profile.defaultPort || 62031;
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
        if (editHsTgTs1) editHsTgTs1.value = 9;
        if (editHsTgTs2) editHsTgTs2.value = modTg;
        if (rptoInput) rptoInput.value = "";
      } else if (cleanType === "tgif") {
        if (editHsTgTs1) editHsTgTs1.value = 9990;
        if (editHsTgTs2) editHsTgTs2.value = 777;
        if (rptoInput) rptoInput.value = "";
      } else if (cleanType === "freedmr") {
        if (editHsTgTs1) editHsTgTs1.value = 91;
        if (editHsTgTs2) editHsTgTs2.value = 250;
        if (rptoInput) rptoInput.value = buildRptoFromCurrentFormFields("freedmr");
      } else if (cleanType === "dmrplus") {
        if (editHsTgTs1) editHsTgTs1.value = 2501;
        if (editHsTgTs2) editHsTgTs2.value = 9;
        const refEl = document.getElementById("editHsDmrPlusRef");
        const relinkEl = document.getElementById("editHsDmrPlusRelink");
        if (refEl && !refEl.value) refEl.value = 4530;
        if (relinkEl && !relinkEl.value) relinkEl.value = 60;
        if (rptoInput) rptoInput.value = buildRptoFromCurrentFormFields("dmrplus");
      } else {
        if (editHsTgTs1) editHsTgTs1.value = 9990;
        if (editHsTgTs2) editHsTgTs2.value = 9990;
      }
    }

    renderBmMastersDropdown(editHsHost ? editHsHost.value : "", cleanType);
  }

  // =========================================================================
export function populateEditHotspotFormFields(hs) {
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
    const editHsTgTs1 = document.getElementById("editHsTgTs1");
    const editHsTgTs2 = document.getElementById("editHsTgTs2");
    const editHsAutoconnect = document.getElementById("editHsAutoconnect");
    const editHsAutoTgBm = document.getElementById("editHsAutoTgBm");

    const isNewHotspot = !hs.id || hs.id === "__new__";
    const netType = (hs.network_type || "bm").toLowerCase();
    const netProfile = getDmrNetworkProfile(netType);

    if (editHsNetworkType) {
      editHsNetworkType.value = netType;
    }
    if (editHsId) editHsId.value = hs.id || "";
    if (editHsName) editHsName.value = hs.name || "";
    if (editHsCallsign) {
      editHsCallsign.value = window.isDemoMode
        ? (window.t ? window.t("demo.your_callsign", {}, "Ваш позывной") : "Ваш позывной")
        : (hs.callsign || "");
    }
    if (editHsTalkerAlias) {
      editHsTalkerAlias.value = window.isDemoMode
        ? (window.t ? window.t("demo.your_name", {}, "Ваше имя") : "Ваше имя")
        : (hs.talker_alias || "");
      editHsTalkerAlias.style.opacity = (hs.send_talker_alias !== false) ? "1" : "0.5";
    }
    if (editHsSendTalkerAlias) editHsSendTalkerAlias.checked = hs.send_talker_alias !== false;
    if (editHsDmrId) {
      editHsDmrId.value = window.isDemoMode ? "1234567" : (hs.dmr_id || "");
    }
    if (editHsSsid) editHsSsid.value = (hs.bm_ssid !== undefined && hs.bm_ssid !== null && Number(hs.bm_ssid) >= 1) ? Math.min(99, Math.max(1, Number(hs.bm_ssid))) : 1;
    let rawRpto = hs.rpto_options || "";
    if (!rawRpto && netType === "freedmr") {
      rawRpto = buildRptoFromCurrentFormFields("freedmr");
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
    if (editHsPassword) {
      editHsPassword.value = hs.bm_password || (netType === "xlx" ? "passw0rd" : "");
      editHsPassword.type = "password";
    }
    if (btnToggleHsPassword) btnToggleHsPassword.textContent = "👁️";
    if (editHsApiKey) {
      editHsApiKey.value = hs.bm_api_key || "";
      editHsApiKey.type = "password";
    }
    if (btnToggleHsApiKey) btnToggleHsApiKey.textContent = "👁️";
    if (bmApiHelpCard) bmApiHelpCard.classList.add("hidden");
    const hostVal = hs.bm_master_host || netProfile.defaultHost || "2322.master.brandmeister.network";
    if (editHsHost) editHsHost.value = hostVal;
    if (editHsPort) editHsPort.value = hs.bm_master_port || netProfile.defaultPort || 62031;
    if (editHsTgTs1) editHsTgTs1.value = hs.default_tg_ts1 || 9990;
    if (editHsTgTs2) editHsTgTs2.value = hs.default_tg_ts2 || 9990;
    if (editHsAutoconnect) {
      editHsAutoconnect.checked = hs.autoconnect !== undefined && hs.autoconnect !== null ? Boolean(hs.autoconnect) : true;
    }
    if (editHsAutoTgBm) {
      editHsAutoTgBm.checked = hs.auto_tg_bm !== undefined && hs.auto_tg_bm !== null ? Boolean(hs.auto_tg_bm) : true;
    }

    applyEditHsNetworkTypeUI(netType, { applyDefaults: false, isNewHotspot });
    updateEditHsToolbarUI(hs);
    if (netType === "freedmr") {
      refreshFreeDmrServers().then(() => {
        renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "freedmr");
      });
    } else if (netType === "dmrplus") {
      if (typeof refreshDmrPlusServers === "function") {
        refreshDmrPlusServers().then(() => {
          renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "dmrplus");
        });
      }
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

  // 1. Dropdown options
  if (editHsSelect) {
    editHsSelect.innerHTML = "";
    currentHotspots.forEach(h => {
      const opt = document.createElement("option");
      opt.value = h.id;
      const netProf = getDmrNetworkProfile(h.network_type || "bm");
      const netTag = `[${netProf.badgePrefix}] `;
      const ssidStr = (h.bm_ssid !== undefined && h.bm_ssid !== null) ? ` · SSID ${h.bm_ssid}` : "";
      const dispCall = (window.isDemoMode || h.callsign === "Ваш позывной")
        ? (window.t ? window.t("demo.your_callsign", {}, "Ваш позывной") : "Ваш позывной")
        : (h.callsign || "");
      const callStr = dispCall ? ` (${dispCall}${ssidStr})` : "";
      opt.textContent = `${netTag}${h.name || "Хотспот"}${callStr}`;
      if (h.id === curId) opt.selected = true;
      editHsSelect.appendChild(opt);
    });

    if (!curId) {
      const newOpt = document.createElement("option");
      newOpt.value = "__new__";
      newOpt.textContent = window.t ? window.t("hotspots.new_opt", {}, "+ Новый хотспот...") : "+ Новый хотспот...";
      newOpt.selected = true;
      editHsSelect.appendChild(newOpt);
    }
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
        btnConn.title = window.t ? window.t("hotspots.btn_conn_online_title", {}, "ONLINE: Подключен к BrandMeister (нажмите для отключения)") : "ONLINE: Подключен к BrandMeister (нажмите для отключения)";
      } else {
        btnConn.textContent = "Connect";
        btnConn.style.color = "#f85149";
        btnConn.style.borderColor = "rgba(248, 81, 73, 0.4)";
        btnConn.style.backgroundColor = "rgba(248, 81, 73, 0.08)";
        btnConn.title = window.t ? window.t("hotspots.btn_conn_offline_title", {}, "Connect: Нажмите для подключения к BrandMeister") : "Connect: Нажмите для подключения к BrandMeister";
      }
    }
  }

  // 4. Quick move up / down buttons in tab header
  const btnMoveHsUp = document.getElementById("btnMoveHsUp");
  const btnMoveHsDown = document.getElementById("btnMoveHsDown");
  const btnOpenHsOrderModal = document.getElementById("btnOpenHsOrderModal");

  const curIdx = currentHotspots.findIndex(h => h.id === curId);
  if (btnOpenHsOrderModal) {
    btnOpenHsOrderModal.disabled = currentHotspots.length <= 1;
    btnOpenHsOrderModal.style.opacity = currentHotspots.length <= 1 ? "0.4" : "1";
    btnOpenHsOrderModal.style.cursor = currentHotspots.length <= 1 ? "not-allowed" : "pointer";
  }

  if (btnMoveHsUp) {
    // Cannot move up if: not found, new hotspot, is index 0 (primary is fixed), or index 1 (cannot jump over primary)
    const canMoveUp = curIdx > 1;
    btnMoveHsUp.disabled = !canMoveUp;
    btnMoveHsUp.style.opacity = canMoveUp ? "1" : "0.35";
    btnMoveHsUp.style.cursor = canMoveUp ? "pointer" : "not-allowed";
  }

  if (btnMoveHsDown) {
    // Cannot move down if: not found, new hotspot, is index 0 (primary is fixed), or is already last
    const canMoveDown = curIdx > 0 && curIdx < currentHotspots.length - 1;
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
  const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
  if (currentHotspots.length > 0 && currentHotspots[0]) {
    const primaryId = currentHotspots[0].id;
    orderIds = [primaryId, ...orderIds.filter(id => id !== primaryId)];
  }
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
    renderHotspotOrderList();
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
  if (currentHotspots.length <= 2) return;
  const ids = currentHotspots.map(h => h.id);
  const idx = ids.indexOf(hotspotId);
  if (idx <= 0) return; // Cannot move primary hotspot (idx === 0 is fixed)
  const targetIdx = idx + direction;
  if (targetIdx <= 0 || targetIdx >= ids.length) return; // Cannot move into or above index 0

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

export function renderHotspotOrderList() {
  const listEl = document.getElementById("hsOrderList");
  if (!listEl) return;
  const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
  listEl.innerHTML = "";
  if (!currentHotspots.length) {
    const emptyMsg = window.t ? window.t("hotspots.empty_configured", {}, "Нет настроенных хотспотов") : "Нет настроенных хотспотов";
    listEl.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem;">${emptyMsg}</div>`;
    return;
  }

  currentHotspots.forEach((hs, idx) => {
    const item = document.createElement("div");
    item.className = "hs-order-item";
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.justifyContent = "space-between";
    item.style.gap = "10px";
    item.style.padding = "8px 12px";
    item.style.background = "rgba(255, 255, 255, 0.04)";
    item.style.borderRadius = "8px";
    item.style.border = "1px solid rgba(255, 255, 255, 0.08)";

    const ssidStr = (hs.bm_ssid !== undefined && hs.bm_ssid !== null) ? ` · SSID ${hs.bm_ssid}` : "";
    const isPrimary = idx === 0;
    const isFirstMovable = idx === 1;
    const isLast = idx === currentHotspots.length - 1;

    const rightControls = isPrimary
      ? `<span style="font-size: 0.76rem; color: #58a6ff; font-weight: 600; background: rgba(88, 166, 255, 0.12); padding: 4px 8px; border-radius: 0px; border: 1px solid rgba(88, 166, 255, 0.25);" title="Первый хотспот всегда остается первым">🔒 ${window.t ? window.t("hotspots.order_fixed_primary", {}, "Основной (№1)") : "Основной (№1)"}</span>`
      : `
        <button type="button" class="btn-secondary btn-order-up" style="padding: 4px 10px; font-size: 0.82rem; cursor: ${isFirstMovable ? 'not-allowed' : 'pointer'}; opacity: ${isFirstMovable ? '0.35' : '1'}; border-radius: 0px;" ${isFirstMovable ? 'disabled' : ''} title="Выше">▲</button>
        <button type="button" class="btn-secondary btn-order-down" style="padding: 4px 10px; font-size: 0.82rem; cursor: ${isLast ? 'not-allowed' : 'pointer'}; opacity: ${isLast ? '0.35' : '1'}; border-radius: 0px;" ${isLast ? 'disabled' : ''} title="Ниже">▼</button>
      `;

    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
        <span style="font-weight: 700; font-size: 0.95rem; color: #58a6ff; width: 28px; text-align: center; flex-shrink: 0; background: rgba(88, 166, 255, 0.12); padding: 2px 6px; border-radius: 0px;">#${idx + 1}</span>
        <div style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <div style="font-weight: 600; font-size: 0.9rem; color: var(--text-primary, #ffffff);">${safeEscapeHtml(hs.name || "Хотспот")}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">${safeEscapeHtml(hs.callsign || "")}${ssidStr} · ID: ${hs.effective_id || hs.dmr_id || "-"}</div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        ${rightControls}
      </div>
    `;

    if (!isPrimary) {
      const upBtn = item.querySelector(".btn-order-up");
      if (upBtn && !isFirstMovable) {
        upBtn.onclick = () => moveHotspotInOrder(hs.id, -1);
      }
      const downBtn = item.querySelector(".btn-order-down");
      if (downBtn && !isLast) {
        downBtn.onclick = () => moveHotspotInOrder(hs.id, 1);
      }
    }

    listEl.appendChild(item);
  });
}

export function openHotspotOrderModal() {
  const modal = document.getElementById("hotspotOrderModal");
  if (!modal) return;
  renderHotspotOrderList();
  modal.style.display = "flex";
  modal.classList.add("active");
  if (typeof pushNavState === "function") {
    pushNavState("modal", "hotspotOrderModal");
  }
}

export function closeHotspotOrderModal() {
  const modal = document.getElementById("hotspotOrderModal");
  if (!modal) return;
  modal.style.display = "none";
  modal.classList.remove("active");
  if (typeof notifyNavClosed === "function") {
    notifyNavClosed("modal", "hotspotOrderModal");
  }
}

export function initHotspotsManager() {
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
        const curHs = curHsList.find(h => h && h.id === hsId);
        const editHsNetworkType = document.getElementById("editHsNetworkType");
        const curNet = (curHs && curHs.network_type) || (editHsNetworkType ? editHsNetworkType.value : "bm") || "bm";
        const list = (window._dmrServersCache && window._dmrServersCache[curNet.toLowerCase()])
          ? window._dmrServersCache[curNet.toLowerCase()]
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
        existingDescEl.textContent = `🔒 Сеть HS • Модуль ${mod} (TG ${modTg} на TS2)`;
      }
      const tgTs2Label = document.getElementById("editHsTgTs2Label");
      if (tgTs2Label) {
        tgTs2Label.textContent = `TG модуля ${mod} (TS2: 4001–4026)`;
      }
      const editHsTgTs2 = document.getElementById("editHsTgTs2");
      if (editHsTgTs2 && modCode >= 65 && modCode <= 90) {
        editHsTgTs2.value = modTg;
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
        showToast(`✅ Сформирована строка RPTO: ${built}`, 2200);
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
        if (data.sent_live) {
          showToast(window.t ? window.t("hotspots.rpto_sent_live", {}, "✅ Пакет RPTO отправлен на сервер и сохранен") : "✅ Пакет RPTO отправлен на сервер и сохранен", 2800);
        } else {
          showToast(window.t ? window.t("hotspots.rpto_saved_offline", {}, "✅ Опции RPTO сохранены (будут отправлены при подключении)") : "✅ Опции RPTO сохранены (будут отправлены при подключении)", 2800);
        }
      } catch (err) {
        showToast("❌ Ошибка отправки RPTO: " + (err && err.message ? err.message : err), 3000);
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

  if (btnAddNewHotspot && !btnAddNewHotspot._wired) {
    btnAddNewHotspot._wired = true;
    btnAddNewHotspot.addEventListener("click", () => {
      triggerAddNewHotspot();
    });
  }

  const editHsSelect = document.getElementById("editHsSelect");
  if (editHsSelect && !editHsSelect._wired) {
    editHsSelect._wired = true;
    editHsSelect.addEventListener("change", () => {
      const val = editHsSelect.value;
      if (val === "__new__") {
        triggerAddNewHotspot();
      } else {
        const currentHotspots = window.currentHotspots || [];
        const found = currentHotspots.find(h => h.id === val);
        if (found) {
          populateEditHotspotFormFields(found);
        }
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

  const btnOpenHsOrderModal = document.getElementById("btnOpenHsOrderModal");
  if (btnOpenHsOrderModal && !btnOpenHsOrderModal._wired) {
    btnOpenHsOrderModal._wired = true;
    btnOpenHsOrderModal.addEventListener("click", () => {
      openHotspotOrderModal();
    });
  }

  const closeHsOrderModalBtn = document.getElementById("closeHsOrderModalBtn");
  if (closeHsOrderModalBtn && !closeHsOrderModalBtn._wired) {
    closeHsOrderModalBtn._wired = true;
    closeHsOrderModalBtn.addEventListener("click", () => {
      closeHotspotOrderModal();
    });
  }

  const btnDoneHsOrder = document.getElementById("btnDoneHsOrder");
  if (btnDoneHsOrder && !btnDoneHsOrder._wired) {
    btnDoneHsOrder._wired = true;
    btnDoneHsOrder.addEventListener("click", () => {
      closeHotspotOrderModal();
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
        if (window.showAppAlert) {
          await window.showAppAlert("Нельзя удалить единственный хотспот!", { title: "Предупреждение", icon: "ℹ️" });
        } else {
          alert("Нельзя удалить единственный хотспот!");
        }
        return;
      }
      const targetHs = currentHotspots.find(h => h.id === id);
      const name = targetHs ? targetHs.name : "выбранный хотспот";
      const ok = await (window.showAppConfirm ? window.showAppConfirm({
        title: "Удаление хотспота",
        icon: "🗑️",
        message: `Удалить хотспот "${name}"?`,
        confirmText: "Удалить",
        confirmStyle: "danger"
      }) : Promise.resolve(confirm(`Удалить хотспот "${name}"?`)));
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
        showToast(window.t ? window.t("hotspots.deleted_toast", {}, "🗑️ Хотспот удален") : "🗑️ Хотспот удален", 2500);
        await loadHotspots();
        const nextHs = (window.currentHotspots && window.currentHotspots[0]) || null;
        if (nextHs) {
          populateEditHotspotFormFields(nextHs);
        }
      } catch (err) {
        const errMsg = "Ошибка при удалении: " + (err && err.message ? err.message : err);
        if (window.showAppAlert) {
          await window.showAppAlert(errMsg, { title: "Ошибка", icon: "⚠️" });
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
      const editHsTgTs1 = document.getElementById("editHsTgTs1");
      const editHsTgTs2 = document.getElementById("editHsTgTs2");
      const editHsAutoconnect = document.getElementById("editHsAutoconnect");
      const editHsAutoTgBm = document.getElementById("editHsAutoTgBm");

      const networkTypeVal = (editHsNetworkType ? editHsNetworkType.value.trim().toLowerCase() : "bm") || "bm";
      const netProfile = getDmrNetworkProfile(networkTypeVal);
      const xlxModuleVal = ((editHsXlxModule ? editHsXlxModule.value.trim().toUpperCase() : "D") || "D").slice(0, 1);
      const xlxModTg = 4000 + Math.max(1, Math.min(26, xlxModuleVal.charCodeAt(0) - 64));
      let rptoOptionsVal = editHsRptoOptions ? editHsRptoOptions.value.trim() : "";
      if (!rptoOptionsVal && (networkTypeVal === "dmrplus" || networkTypeVal === "freedmr")) {
        rptoOptionsVal = buildRptoFromCurrentFormFields(networkTypeVal);
      }

      const nameVal = (editHsName ? editHsName.value.trim() : "") || (id === "default" ? "Main" : `Хотспот #${(window.currentHotspots || []).length + 1}`);
      const callsignVal = (editHsCallsign ? editHsCallsign.value.trim().toUpperCase() : "") || "N0CALL";
      const talkerAliasVal = editHsTalkerAlias ? editHsTalkerAlias.value.trim() : "";
      const sendTalkerAliasVal = editHsSendTalkerAlias ? editHsSendTalkerAlias.checked : true;
      const dmrIdVal = parseInt(editHsDmrId ? editHsDmrId.value : "0", 10) || 0;
      const rawSsid = editHsSsid ? editHsSsid.value.trim() : "";
      const parsedSsid = rawSsid !== "" ? parseInt(rawSsid, 10) : 1;
      if (rawSsid !== "" && (isNaN(parsedSsid) || parsedSsid < 1 || parsedSsid > 99)) {
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
      const ssidVal = isNaN(parsedSsid) ? 1 : Math.max(1, Math.min(99, parsedSsid));
      let passwordVal = editHsPassword ? editHsPassword.value.trim() : "";
      if (networkTypeVal === "xlx" && !passwordVal) {
        passwordVal = "passw0rd";
      } else if (networkTypeVal === "dmrplus" && !passwordVal) {
        passwordVal = "PASSWORD";
      }
      const apiKeyVal = editHsApiKey ? editHsApiKey.value.trim() : "";
      const hostVal = (editHsHost ? editHsHost.value.trim() : "") || netProfile.defaultHost || "2322.master.brandmeister.network";
      const portVal = parseInt(editHsPort ? editHsPort.value : String(netProfile.defaultPort || 62031), 10) || netProfile.defaultPort || 62031;
      const tg1Val = networkTypeVal === "xlx" ? 9 : (parseInt(editHsTgTs1 ? editHsTgTs1.value : "9990", 10) || 9990);
      const tg2Val = networkTypeVal === "xlx" ? xlxModTg : (parseInt(editHsTgTs2 ? editHsTgTs2.value : "9990", 10) || 9990);
      const autoconnectVal = editHsAutoconnect ? editHsAutoconnect.checked : true;
      const autoTgBmVal = editHsAutoTgBm ? editHsAutoTgBm.checked : true;

      const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
      const existing = currentHotspots.find(h => h.id === id) || {};
      const autoRecordVal = existing.auto_record !== undefined ? Boolean(existing.auto_record) : false;

      const payload = {
        name: nameVal,
        callsign: callsignVal,
        talker_alias: talkerAliasVal,
        send_talker_alias: sendTalkerAliasVal,
        dmr_id: dmrIdVal,
        bm_ssid: ssidVal,
        network_type: networkTypeVal,
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
        const errMsg = "Ошибка при сохранении: " + (err && err.message ? err.message : err);
        if (window.showAppAlert) {
          await window.showAppAlert(errMsg, { title: "Ошибка", icon: "⚠️" });
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
      saveCurrentSettingsState();
      const modal = document.getElementById("settingsModal");
      if (modal) {
        modal.classList.remove("active");
        modal.style.display = "";
      }
      notifyNavClosed();
    };
  }

  if (settingsModal && !settingsModal._wired) {
    settingsModal._wired = true;
    settingsModal.onclick = (e) => {
      if (e.target === settingsModal) {
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
window.openXlxAllModulesPopover = openXlxAllModulesPopover;
window.syncCollapsedHotspotStacks = syncCollapsedHotspotStacks;
window.applyActiveHotspotToUI = applyActiveHotspotToUI;
window.renderHotspotsList = renderHotspotsList;
window.fetchBmMasters = fetchBmMasters;
window.renderBmMastersDropdown = renderBmMastersDropdown;
window.applyEditHsNetworkTypeUI = applyEditHsNetworkTypeUI;
window.populateEditHotspotFormFields = populateEditHotspotFormFields;
window.openEditHotspotForm = openEditHotspotForm;
window.initHotspotsManager = initHotspotsManager;
window.saveCurrentSettingsState = saveCurrentSettingsState;
window.reorderHotspots = reorderHotspots;
window.moveHotspotInOrder = moveHotspotInOrder;
window.renderHotspotOrderList = renderHotspotOrderList;
window.openHotspotOrderModal = openHotspotOrderModal;
window.closeHotspotOrderModal = closeHotspotOrderModal;

window.__proxdmr = window.__proxdmr || {};
window.__proxdmr.loadHotspots = loadHotspots;
window.__proxdmr.renderHotspotSelect = renderHotspotSelect;
window.__proxdmr.switchActiveHotspot = switchActiveHotspot;
window.__proxdmr.triggerAddNewHotspot = triggerAddNewHotspot;
window.__proxdmr.openHotspotSettings = openHotspotSettings;
window.__proxdmr.renderRadiosGrid = renderRadiosGrid;
window.__proxdmr.linkHotspotXlxModule = linkHotspotXlxModule;
window.__proxdmr.linkHotspotDmrPlusReflector = linkHotspotDmrPlusReflector;
window.__proxdmr.updateCardDmrPlusPanel = updateCardDmrPlusPanel;
window.__proxdmr.openXlxAllModulesPopover = openXlxAllModulesPopover;
window.__proxdmr.syncCollapsedHotspotStacks = syncCollapsedHotspotStacks;
window.__proxdmr.applyActiveHotspotToUI = applyActiveHotspotToUI;
window.__proxdmr.renderHotspotsList = renderHotspotsList;
window.__proxdmr.fetchBmMasters = fetchBmMasters;
window.__proxdmr.renderBmMastersDropdown = renderBmMastersDropdown;
window.__proxdmr.applyEditHsNetworkTypeUI = applyEditHsNetworkTypeUI;
window.__proxdmr.populateEditHotspotFormFields = populateEditHotspotFormFields;
window.__proxdmr.openEditHotspotForm = openEditHotspotForm;
window.__proxdmr.initHotspotsManager = initHotspotsManager;
window.__proxdmr.saveCurrentSettingsState = saveCurrentSettingsState;
window.__proxdmr.reorderHotspots = reorderHotspots;
window.__proxdmr.moveHotspotInOrder = moveHotspotInOrder;
window.__proxdmr.renderHotspotOrderList = renderHotspotOrderList;
window.__proxdmr.openHotspotOrderModal = openHotspotOrderModal;
window.__proxdmr.closeHotspotOrderModal = closeHotspotOrderModal;

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
      if (editHsCallsign) editHsCallsign.value = window.t ? window.t("demo.your_callsign", {}, "Ваш позывной") : "Ваш позывной";
      if (editHsTalkerAlias) editHsTalkerAlias.value = window.t ? window.t("demo.your_name", {}, "Ваше имя") : "Ваше имя";
    }
  }
  renderBmMastersDropdown();
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
    const isServerDeadNotice = failedCycles >= 3 || det.includes("не отвечает на udp") || (det.includes("все 5 попыток") && failedCycles >= 2);

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

    const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
    const cCode = (fastest.country_code || fastest.country || "").toUpperCase();
    const cName = getLocalizedCountryName(cCode, fastest.country_name || fastest.country || "DMR", curLang);
    const flag = fastest.flag || (cCode ? isoToEmoji(cCode) : "") || "🌐";
    const pingMs = Math.round(fastest.udp_ms || fastest.avg_ping || 15);
    const switchText = window.t ? window.t("server_probe.quick_switch", {}, "Переключить") : "Переключить";

    if (!existing) {
      const noticeDiv = document.createElement("div");
      noticeDiv.className = "server-failover-card-notice";
      noticeDiv.style.cssText = "display:flex; align-items:center; justify-content:space-between; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); border-radius: 0px; padding:4px 8px; margin:4px 8px 6px; font-size:11px; color:#fca5a5;";
      noticeDiv.innerHTML = `
        <span style="display:flex; align-items:center; gap:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          <span>⚠️ Сервер не отвечает. Лучший:</span> <b>${cName} (${pingMs} мс)</b>
        </span>
        <button type="button" class="btn-failover-quick-switch" style="background:#2563eb; color:#fff; border:none; border-radius: 0px; padding:3px 10px; font-size:11px; font-weight:600; cursor:pointer; flex-shrink:0; margin-left:8px;">${switchText}</button>
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
};

if (typeof window !== 'undefined') { window.updateCardXlxPanel = updateCardXlxPanel; window.updateCardDmrPlusPanel = updateCardDmrPlusPanel; window.linkHotspotDmrPlusReflector = linkHotspotDmrPlusReflector; }
