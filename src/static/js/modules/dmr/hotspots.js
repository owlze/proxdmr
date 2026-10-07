/**
 * ProxDMR - Hotspots Management Subsystem (modules/dmr/hotspots.js)
 * Manages multi-hotspot configuration, DOM radio card creation and rendering,
 * hotspot switching, BrandMeister master server dropdowns, and hotspot settings forms.
 */

import { safeEscapeHtml, escapeHtml, isoToEmoji, getLocalizedCountryName } from '../core/formatters.js';
import { showToast } from '../core/toast.js';
import { pushNavState, notifyNavClosed } from '../ui/navigation.js';
import { openBmBenchmarkModal } from './bm-benchmark.js';
import { openBmTgStaticModal, dropDynamicTGs } from './bm-static-manager.js';
import {
  cycleHotspotPan,
  toggleHotspotMute,
  toggleHotspotAutoRecord,
  setupMutePanButtonEvents,
  updateCardMuteUI,
  updateCardPanUI,
  updateCardRecUI,
  updateAllHotspotRecUI
} from '../audio/routing.js';
import {
  setupSlotLongPress,
  syncCardSlotTranscribeUI,
  syncAllTranscribeSlotsToServer,
  disableHotspotTranscribe
} from './transcriber.js';
import {
  startTransmission,
  stopTransmission,
  blinkPttLocked,
  isPttLocked,
  togglePttLock,
  updatePttLockUI,
  openTotConfigModal,
  getHotspotPttMode
} from '../ptt/engine.js';
import { wireCardStatusInteractions, checkBmApiStatus, updateHotspotGwStatus, triggerHotspotGwAction, isHotspotGwDisconnected } from '../network/watchdog.js';
import { checkServerApkUpdate, updateApkUpdateUI } from '../core/updater.js';
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
      const t1 = targetHs.default_tg_ts1 || 91;
      const t2 = targetHs.default_tg_ts2 || 2501;
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
      c.classList.toggle("active-hotspot", c.dataset.hotspotId === newId);
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

    const usedSsids = new Set(currentHotspots.map(h => Number(h.bm_ssid)));
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

export function renderRadiosGrid() {
    const radiosGrid = document.getElementById("radiosGrid");
    if (!radiosGrid) return;

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
        } else if (template) {
          card = template.content.firstElementChild.cloneNode(true);
          card.dataset.hotspotId = hs.id;
          if (window.I18N) window.I18N.apply(card);
          radiosGrid.appendChild(card);
        }
      }
      if (!card) return;

      // Logo ProxDMR must be present ONLY on the first main hotspot card (idx === 0)
      if (idx > 0) {
        card.querySelectorAll(".brand-logo-wrap").forEach(el => el.remove());
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
      if (csDisplay) csDisplay.textContent = hs.callsign || "N0CALL";

      const idDisplay = card.querySelector(".dmr-id-display");
      if (idDisplay) idDisplay.textContent = `ID: ${hs.effective_id || hs.dmr_id || 0}`;

      updateCardBmBanner(card, hs);

      const tg1Num = card.querySelector(".tg-ts1-num");
      if (tg1Num) {
        const cid = card.dataset.hotspotId || hs.id;
        const curTg1 = getHotspotTg(cid, 1);
        tg1Num.textContent = `TG ${curTg1}`;
        tg1Num.style.cursor = "pointer";
        tg1Num.title = window.t ? window.t("hotspots.tg1_select_title", {}, "Кликните для выбора группы или ID на TS1") : "Кликните для выбора группы или ID на TS1";
        tg1Num.onclick = (e) => {
          e.stopPropagation();
          switchActiveHotspot(cid);
          setCardSlot(card, 1, true);
          openTgTxUseModal(1, cid);
        };
      }

      const tg2Num = card.querySelector(".tg-ts2-num");
      if (tg2Num) {
        const cid = card.dataset.hotspotId || hs.id;
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
      const hasApiKey = Boolean(hs.bm_api_key && hs.bm_api_key.trim().length > 10);

      if (!hasApiKey) {
        hs._apiStatus = "NO_KEY";
      } else if (!hs._apiStatus) {
        hs._apiStatus = "CHECKING";
      }

      const apiStatus = hs._apiStatus || (hasApiKey ? "CHECKING" : "NO_KEY");
      let apiBadgeClass = "status-offline bm-offline";
      let apiBadgeText = "API:OFFLINE";
      let apiComment = window.t ? window.t("status.api_no_key_detail") : "Ключ не настроен (клик для ввода)";
      let apiTooltip = window.t ? window.t("status.api_no_key_tooltip") : "⚪ BM API: Ключ не настроен. Нажмите для ввода";

      if (apiStatus === "ONLINE") {
        apiBadgeClass = "status-online bm-online";
        apiBadgeText = "API:ONLINE";
        apiComment = hs._apiDetail ? `api.brandmeister.network (${hs._apiDetail})` : "api.brandmeister.network (Авторизован)";
        apiTooltip = window.t ? window.t("status.api_authorized_tooltip") : "🟢 BM API v2: Авторизован. Клик для повторной проверки";
      } else if (apiStatus === "CHECKING") {
        apiBadgeClass = "status-connecting bm-connecting";
        apiBadgeText = "API:CHECKING";
        apiComment = window.t ? window.t("status.api_checking_detail") : "Проверка токена v2...";
        apiTooltip = window.t ? window.t("status.api_checking_tooltip") : "🟡 BM API: Проверка соединения...";
      } else if (apiStatus === "AUTH_FAILED") {
        apiBadgeClass = "status-error bm-error";
        apiBadgeText = "API:AUTH FAIL";
        apiComment = hs._apiDetail || (window.t ? window.t("status.api_auth_detail") : "Неверный токен (401 Unauthorized)");
        apiTooltip = window.t ? window.t("status.api_auth_tooltip", { detail: apiComment }) : `🔴 BM API: ${apiComment}. Нажмите для настройки`;
      } else if (apiStatus === "NO_KEY") {
        apiBadgeClass = "status-offline bm-offline";
        apiBadgeText = "API:NO KEY";
        apiComment = window.t ? window.t("status.api_no_key_detail") : "Ключ не настроен (клик для ввода)";
        apiTooltip = window.t ? window.t("status.api_no_key_tooltip") : "⚪ BM API: Ключ не настроен. Нажмите для ввода";
      } else if (apiStatus === "OFFLINE" || apiStatus === "ERROR") {
        apiBadgeClass = "status-error bm-error";
        apiBadgeText = "API:ERROR";
        apiComment = hs._apiDetail || (window.t ? window.t("status.api_server_unreachable") : "Сервер api.brandmeister.network недоступен");
        apiTooltip = window.t ? window.t("status.api_error_tooltip", { detail: apiComment }) : `🔴 BM API: ${apiComment}. Клик для повторной проверки`;
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

        const btnStatic = card.querySelector(".btn-bm-static-edit");
        if (btnStatic) {
          btnStatic.onclick = (e) => {
            e.stopPropagation();
            const cid = card.dataset.hotspotId || hs.id;
            openBmTgStaticModal(cid);
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
          btnSrch.onclick = (e) => {
            e.stopPropagation();
            const cid = card.dataset.hotspotId || hs.id;
            switchActiveHotspot(cid);
            const slot = card._activeSlot || getHotspotSlot(cid);
            const actionTarget = e.target.closest("[data-action]");
            const action = actionTarget ? actionTarget.dataset.action : null;

            if (action === "manage") {
              openBmTgStaticModal(cid);
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
              openBmTgStaticModal(cid);
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

            // Determine targetSlot based on left (TS1) vs right (TS2) click coordinate
            const targetSlot = (relX < (rect.width / 2)) ? 1 : 2;
            setCardSlot(card, targetSlot, true);
            cardPttBtn.classList.remove("hover-slot-1", "hover-slot-2");
            cardPttBtn.classList.remove("tx-slot-1", "tx-slot-2");
            cardPttBtn.classList.add(`tx-slot-${targetSlot}`);

            // 3. Branch: PTT mode check - "toggle" (Переключение) vs "hold" (Удержание)
            const pttMode = (typeof window.getHotspotPttMode === "function") ? window.getHotspotPttMode(cid) : getHotspotPttMode(cid);
            if (pttMode === "toggle") {
              e.preventDefault();
              e.stopPropagation();
              if (typeof window !== "undefined" && window.isPttPressed) {
                cardPttBtn.classList.remove("tx-slot-1", "tx-slot-2");
                stopTransmission();
              } else {
                switchActiveHotspot(cid);
                startTransmission(cid, targetSlot);
              }
              return;
            }

            // 4. Branch: Unlocked in "hold" mode - proceed to transmission!
            e.preventDefault();
            try {
              cardPttBtn.setPointerCapture(e.pointerId);
            } catch (err) {}
            switchActiveHotspot(cid);
            startTransmission(cid, targetSlot);
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
                const hoverSlot = (relX < (rect.width / 2)) ? 1 : 2;
                const wasSlot1 = cardPttBtn.classList.contains("hover-slot-1");
                const wasSlot2 = cardPttBtn.classList.contains("hover-slot-2");
                const prevSlot = wasSlot1 ? 1 : (wasSlot2 ? 2 : 0);
                cardPttBtn.classList.toggle("hover-slot-1", hoverSlot === 1);
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

            cardPttBtn.classList.remove("tx-slot-1", "tx-slot-2");
            updateCardPttHint(card);

            const cid = resolveHotspotId(card.dataset.hotspotId || hs.id || "default");

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

            // In "toggle" mode, pointerup must not stop transmission
            const pttMode = (typeof window.getHotspotPttMode === "function") ? window.getHotspotPttMode(cid) : getHotspotPttMode(cid);
            if (pttMode === "toggle") {
              e.preventDefault();
              e.stopPropagation();
              return;
            }

            e.preventDefault();
            try {
              if (cardPttBtn.hasPointerCapture && cardPttBtn.hasPointerCapture(e.pointerId)) {
                cardPttBtn.releasePointerCapture(e.pointerId);
              }
            } catch (err) {}

            if (typeof window !== "undefined" && window.isPttPressed) {
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

            cardPttBtn.classList.remove("tx-slot-1", "tx-slot-2", "hover-slot-1", "hover-slot-2");
            updateCardPttHint(card);

            const cid = resolveHotspotId(card.dataset.hotspotId || hs.id || "default");
            const pttMode = (typeof window.getHotspotPttMode === "function") ? window.getHotspotPttMode(cid) : getHotspotPttMode(cid);
            if (pttMode === "toggle") {
              return;
            }

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

            if ((typeof window !== "undefined" && window.isPttPressed) && (!cardPttBtn.hasPointerCapture || !cardPttBtn.hasPointerCapture(e.pointerId))) {
              cardPttBtn.classList.remove("tx-slot-1", "tx-slot-2");
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

        // Quick TG Direct Dial (Быстрый набор TG)
        const quickInput = card.querySelector(".quick-tg-input");
        const quickApply = card.querySelector(".btn-quick-tg-apply");

        const applyQuick = () => {
          if (!quickInput) return;
          const valStr = quickInput.value.trim();
          const val = parseInt(valStr, 10);
          const cid = card.dataset.hotspotId || hs.id;
          const slot = card._activeSlot || getHotspotSlot(cid);
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

        if (quickInput) {
          quickInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyQuick();
            }
          });
          quickInput.addEventListener("focus", () => {
            const cid = card.dataset.hotspotId || hs.id;
            switchActiveHotspot(cid);
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
    renderLogHotspotTabs();
    initQuickAssign();
    if (typeof updatePttLockUI === "function") {
      updatePttLockUI();
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
      const lockTitle = window.t ? window.t("hotspots.auto_tg_bm_disabled_title", {}, "Автонастройка TG BM отключена") : "Автонастройка TG BM отключена";
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
          <span class="hotspot-card-meta">${escapeHtml(hs.callsign)} | ${hs.effective_id || hs.dmr_id}</span>
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
            <label class="hs-card-autotg-label" style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; cursor: pointer; user-select: none; color: var(--text-primary, #c9d1d9);">
              <input type="checkbox" class="chk-hs-autotg" data-id="${hs.id}" ${isAutoTgBm ? 'checked' : ''} style="cursor: pointer; width: 15px; height: 15px; accent-color: #58a6ff;">
              <span data-i18n="hs_edit.auto_tg_bm">${window.t ? window.t("hs_edit.auto_tg_bm") : "Автонастройка TG BM"}</span>
            </label>
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
              showToast(newVal ? (window.t ? window.t("hotspots.auto_tg_bm_on", { name: hs.name }, `✅ [${hs.name}]: Автонастройка TG BM включена`) : `✅ [${hs.name}]: Автонастройка TG BM включена`) : (window.t ? window.t("hotspots.auto_tg_bm_off", { name: hs.name }, `🔒 [${hs.name}]: Автонастройка TG BM отключена`) : `🔒 [${hs.name}]: Автонастройка TG BM отключена`), 2500);
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
      const resp = await fetch("/api/bm/masters");
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.masters)) {
          bmMastersList = data.masters;
          window.bmMastersList = bmMastersList;
          if (window.__proxdmr) window.__proxdmr.bmMastersList = bmMastersList;
          const editHsHost = document.getElementById("editHsHost");
          renderBmMastersDropdown(editHsHost ? editHsHost.value : "");
          refreshAllCardsBmBanner();
        }
      }
    } catch (e) {
      console.warn("Не удалось загрузить список серверов BM:", e);
    }
  }
export function renderBmMastersDropdown(currentHost) {
    const editHsMasterSelect = document.getElementById("editHsMasterSelect");
    if (!editHsMasterSelect) return;
    const editHsHost = document.getElementById("editHsHost");
    const hostVal = (currentHost !== undefined && currentHost !== null) ? currentHost : (editHsHost ? editHsHost.value : "");
    editHsMasterSelect.innerHTML = "";

    const benchOpt = document.createElement("option");
    benchOpt.value = "__TEST_SERVERS__";
    benchOpt.textContent = window.t ? window.t("hotspots.bench_opt", {}, "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)") : "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)";
    editHsMasterSelect.appendChild(benchOpt);

    const defOpt = document.createElement("option");
    defOpt.value = "";
    defOpt.textContent = window.t ? window.t("hs_edit.master_select_prompt") : "🌍 Выберите страну / сервер BM...";
    editHsMasterSelect.appendChild(defOpt);

    let matched = false;
    const cleanCurrent = (hostVal || "").trim().toLowerCase();

    const curLang = (window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
    const recTag = window.t ? window.t("bm.master_recommended", {}, "⭐ [Рекомендуется]") : "⭐ [Рекомендуется]";

    if (Array.isArray(bmMastersList)) {
      bmMastersList.forEach(m => {
        if (!m) return;
        const opt = document.createElement("option");
        opt.value = m.host || "";
        const cCode = (m.country_code || m.country || "").toUpperCase();
        const countryName = getLocalizedCountryName(cCode, m.country_name || m.country || "BM", curLang);
        const flag = m.flag || isoToEmoji(cCode);
        const recSuffix = m.recommended ? ` ${recTag}` : "";
        opt.textContent = `${flag} ${countryName} — BM ${m.id || ""} (${m.host || ""})${recSuffix}`;
        const mHost = (m.host || "").toLowerCase();
        const mIp = m.ip || "";
        if (cleanCurrent && (cleanCurrent === mHost || cleanCurrent === mIp)) {
          opt.selected = true;
          matched = true;
        }
        editHsMasterSelect.appendChild(opt);
      });
    }

    const customOpt = document.createElement("option");
    customOpt.value = "CUSTOM";
    customOpt.textContent = window.t ? window.t("hs_edit.master_custom_option") : "✏️ Ввести свой адрес вручную (другой сервер / IP)";
    if (!matched && cleanCurrent) {
      customOpt.selected = true;
    }
    editHsMasterSelect.appendChild(customOpt);
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

    if (editHsId) editHsId.value = hs.id || "";
    if (editHsName) editHsName.value = hs.name || "";
    if (editHsCallsign) editHsCallsign.value = hs.callsign || "";
    if (editHsTalkerAlias) {
      editHsTalkerAlias.value = hs.talker_alias || "";
      editHsTalkerAlias.style.opacity = (hs.send_talker_alias !== false) ? "1" : "0.5";
    }
    if (editHsSendTalkerAlias) editHsSendTalkerAlias.checked = hs.send_talker_alias !== false;
    if (editHsDmrId) editHsDmrId.value = hs.dmr_id || "";
    if (editHsSsid) editHsSsid.value = (hs.bm_ssid !== undefined && hs.bm_ssid !== null && Number(hs.bm_ssid) >= 1) ? Math.min(99, Math.max(1, Number(hs.bm_ssid))) : 1;
    if (editHsPassword) {
      editHsPassword.value = hs.bm_password || "";
      editHsPassword.type = "password";
    }
    if (btnToggleHsPassword) btnToggleHsPassword.textContent = "👁️";
    if (editHsApiKey) {
      editHsApiKey.value = hs.bm_api_key || "";
      editHsApiKey.type = "password";
    }
    if (btnToggleHsApiKey) btnToggleHsApiKey.textContent = "👁️";
    if (bmApiHelpCard) bmApiHelpCard.classList.add("hidden");
    const hostVal = hs.bm_master_host || "2322.master.brandmeister.network";
    if (editHsHost) editHsHost.value = hostVal;
    renderBmMastersDropdown(hostVal);
    if (editHsPort) editHsPort.value = hs.bm_master_port || 62031;
    if (editHsTgTs1) editHsTgTs1.value = hs.default_tg_ts1 || 9990;
    if (editHsTgTs2) editHsTgTs2.value = hs.default_tg_ts2 || 9990;
    if (editHsAutoconnect) {
      editHsAutoconnect.checked = hs.autoconnect !== undefined && hs.autoconnect !== null ? Boolean(hs.autoconnect) : true;
    }
    if (editHsAutoTgBm) {
      editHsAutoTgBm.checked = hs.auto_tg_bm !== undefined && hs.auto_tg_bm !== null ? Boolean(hs.auto_tg_bm) : true;
    }

    updateEditHsToolbarUI(hs);
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
      const ssidStr = (h.bm_ssid !== undefined && h.bm_ssid !== null) ? ` · SSID ${h.bm_ssid}` : "";
      const callStr = h.callsign ? ` (${h.callsign}${ssidStr})` : "";
      opt.textContent = `${h.name || "Хотспот"}${callStr}`;
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
        const found = bmMastersList.find(m => m.host.toLowerCase() === cur || m.ip === cur);
        editHsMasterSelect.value = found ? found.host : (cur ? "CUSTOM" : "");
        const hsId = (editHsId && editHsId.value) ? editHsId.value : (window.activeHotspotId || "default");
        openBmBenchmarkModal(hsId);
        return;
      }
      if (val && val !== "CUSTOM") {
        if (editHsHost) editHsHost.value = val;
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
      const found = bmMastersList.find(m => m.host.toLowerCase() === hostVal || m.ip === hostVal);
      if (found) {
        editHsMasterSelect.value = found.host;
      } else {
        editHsMasterSelect.value = "CUSTOM";
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
        showToast(newVal ? (window.t ? window.t("hotspots.auto_tg_bm_global_on", {}, "✅ Автонастройка TG BM включена") : "✅ Автонастройка TG BM включена") : (window.t ? window.t("hotspots.auto_tg_bm_global_off", {}, "🔒 Автонастройка TG BM отключена") : "🔒 Автонастройка TG BM отключена"), 2000);
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
      const editHsPassword = document.getElementById("editHsPassword");
      const editHsApiKey = document.getElementById("editHsApiKey");
      const editHsHost = document.getElementById("editHsHost");
      const editHsPort = document.getElementById("editHsPort");
      const editHsTgTs1 = document.getElementById("editHsTgTs1");
      const editHsTgTs2 = document.getElementById("editHsTgTs2");
      const editHsAutoconnect = document.getElementById("editHsAutoconnect");
      const editHsAutoTgBm = document.getElementById("editHsAutoTgBm");

      const nameVal = (editHsName ? editHsName.value.trim() : "") || (id === "default" ? "Main" : `Хотспот #${(window.currentHotspots || []).length + 1}`);
      const callsignVal = (editHsCallsign ? editHsCallsign.value.trim().toUpperCase() : "") || "N0CALL";
      const talkerAliasVal = editHsTalkerAlias ? editHsTalkerAlias.value.trim() : "";
      const sendTalkerAliasVal = editHsSendTalkerAlias ? editHsSendTalkerAlias.checked : true;
      const dmrIdVal = parseInt(editHsDmrId ? editHsDmrId.value : "0", 10) || 0;
      const rawSsid = editHsSsid ? editHsSsid.value.trim() : "";
      const parsedSsid = rawSsid !== "" ? parseInt(rawSsid, 10) : 1;
      if (rawSsid !== "" && (isNaN(parsedSsid) || parsedSsid < 1 || parsedSsid > 99)) {
        showToast(window.t ? window.t("hotspots.invalid_ssid", {}, "❌ SSID должен быть в диапазоне от 1 до 99") : "❌ SSID должен быть в диапазоне от 1 до 99", 3000);
        if (editHsSsid) {
          editHsSsid.value = Math.max(1, Math.min(99, isNaN(parsedSsid) ? 1 : parsedSsid));
          editHsSsid.focus();
        }
        return;
      }
      const ssidVal = isNaN(parsedSsid) ? 1 : Math.max(1, Math.min(99, parsedSsid));
      const passwordVal = editHsPassword ? editHsPassword.value.trim() : "";
      const apiKeyVal = editHsApiKey ? editHsApiKey.value.trim() : "";
      const hostVal = (editHsHost ? editHsHost.value.trim() : "") || "2322.master.brandmeister.network";
      const portVal = parseInt(editHsPort ? editHsPort.value : "62031", 10) || 62031;
      const tg1Val = parseInt(editHsTgTs1 ? editHsTgTs1.value : "9990", 10) || 9990;
      const tg2Val = parseInt(editHsTgTs2 ? editHsTgTs2.value : "9990", 10) || 9990;
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
          window.triggerModalSavePulse(hotspotEditForm);
        }

        await loadHotspots();
        if (savedHs && savedHs.id) {
          populateEditHotspotFormFields(savedHs);
        }
      } catch (err) {
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
window.applyActiveHotspotToUI = applyActiveHotspotToUI;
window.renderHotspotsList = renderHotspotsList;
window.fetchBmMasters = fetchBmMasters;
window.renderBmMastersDropdown = renderBmMastersDropdown;
window.populateEditHotspotFormFields = populateEditHotspotFormFields;
window.openEditHotspotForm = openEditHotspotForm;
window.initHotspotsManager = initHotspotsManager;
window.saveCurrentSettingsState = saveCurrentSettingsState;

window.__proxdmr = window.__proxdmr || {};
window.__proxdmr.loadHotspots = loadHotspots;
window.__proxdmr.renderHotspotSelect = renderHotspotSelect;
window.__proxdmr.switchActiveHotspot = switchActiveHotspot;
window.__proxdmr.triggerAddNewHotspot = triggerAddNewHotspot;
window.__proxdmr.openHotspotSettings = openHotspotSettings;
window.__proxdmr.renderRadiosGrid = renderRadiosGrid;
window.__proxdmr.applyActiveHotspotToUI = applyActiveHotspotToUI;
window.__proxdmr.renderHotspotsList = renderHotspotsList;
window.__proxdmr.fetchBmMasters = fetchBmMasters;
window.__proxdmr.renderBmMastersDropdown = renderBmMastersDropdown;
window.__proxdmr.populateEditHotspotFormFields = populateEditHotspotFormFields;
window.__proxdmr.openEditHotspotForm = openEditHotspotForm;
window.__proxdmr.initHotspotsManager = initHotspotsManager;
window.__proxdmr.saveCurrentSettingsState = saveCurrentSettingsState;

window.addEventListener("languageChanged", () => {
  renderBmMastersDropdown();
});
