/**
 * ProxDMR - Master & Per-Hotspot Volume, Audio Gain, AGC, Loopback & Mute Subsystem
 * Handles master/per-channel muting, double-click gestures, PTT auto-mute suppression,
 * volume controls, AGC toggles, audio loopback, and hotspot collapse/expand lifecycle.
 */

import { showCenterHudToast, showToast } from "../core/toast.js";
import { scheduleSyncClientSettings } from "../settings/sync.js";
import { updateHotspotCardMuteUI, updateHotspotCardPanUI } from "./routing.js";
import { renderHotspotsList, renderHotspotSelect, switchActiveHotspot } from "../dmr/hotspots.js";

let muteClickTimer = null;
let lastMuteClickTime = 0;
let lastMuteClickHid = null;
let justDoubleClicked = false;

export let pttMuteReleaseTimer = null;
export let isPttMuteActive = false;

try {
  Object.defineProperty(window, "pttMuteReleaseTimer", {
    get: () => pttMuteReleaseTimer,
    set: (v) => { pttMuteReleaseTimer = v; },
    configurable: true
  });
  Object.defineProperty(window, "isPttMuteActive", {
    get: () => isPttMuteActive,
    set: (v) => { isPttMuteActive = v; },
    configurable: true
  });
} catch (_) {}

function getAudioPlayer() {
  return (typeof window !== "undefined" && (window.audioPlayer || (window.__proxdmr && window.__proxdmr.audioPlayer))) || null;
}

function getWs() {
  return (typeof window !== "undefined" && window.ws) || null;
}

function getCurrentHotspots() {
  return (typeof window !== "undefined" && Array.isArray(window.currentHotspots)) ? window.currentHotspots : [];
}

function getActiveHotspotId() {
  return (typeof window !== "undefined" && window.activeHotspotId) || "default";
}

export function isMuteOnPttEnabled() {
  const uid = (typeof window !== "undefined" && window.currentUserId) || null;
  if (uid) {
    const uVal = localStorage.getItem(`proxdmr_u${uid}_mute_on_ptt`);
    if (uVal !== null) return uVal === "true";
  }
  const v = localStorage.getItem("proxdmr_mute_on_ptt");
  if (v !== null) return v === "true";
  return true; // Default: enabled
}

export function setMuteOnPttEnabled(enabled, syncServer = true) {
  const boolVal = Boolean(enabled);
  localStorage.setItem("proxdmr_mute_on_ptt", boolVal ? "true" : "false");
  const uid = (typeof window !== "undefined" && window.currentUserId) || null;
  if (uid) localStorage.setItem(`proxdmr_u${uid}_mute_on_ptt`, boolVal ? "true" : "false");
  const chk = document.getElementById("optMuteOnPtt");
  if (chk) chk.checked = boolVal;
  if (!boolVal && isPttMuteActive) {
    if (pttMuteReleaseTimer) {
      clearTimeout(pttMuteReleaseTimer);
      pttMuteReleaseTimer = null;
    }
    isPttMuteActive = false;
    const ap = getAudioPlayer();
    if (ap && ap.setPttMuted) {
      ap.setPttMuted(false);
    }
    updateAllVolumeAndMuteUI();
  }
  if (syncServer) {
    const ws = (typeof window !== "undefined" && window.ws) || null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "set_mute_on_ptt", enabled: boolVal }));
      } catch (_) {}
    }
    try {
      fetch("/api/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mute_on_ptt: boolVal })
      }).catch(() => {});
    } catch (_) {}
    if (typeof window.scheduleSyncClientSettings === "function") {
      window.scheduleSyncClientSettings();
    }
  }
}

export function isPttAudioMuted() {
  return isPttMuteActive;
}

export function isSimultaneousSlotsEnabled() {
  if (typeof window !== "undefined" && typeof window.getHotspotTsAudioMode === "function") {
    return window.getHotspotTsAudioMode("default") !== "solo";
  }
  return localStorage.getItem("proxdmr_simultaneous_slots") !== "false";
}

export function setSimultaneousSlotsEnabled(enabled, syncServer = true) {
  const boolVal = Boolean(enabled);
  localStorage.setItem("proxdmr_simultaneous_slots", boolVal ? "true" : "false");
  if (typeof window !== "undefined" && typeof window.setHotspotTsAudioMode === "function") {
    window.setHotspotTsAudioMode("default", boolVal ? "doubl" : "solo");
  }
  if (typeof window !== "undefined" && typeof window.scheduleSyncClientSettings === "function") {
    window.scheduleSyncClientSettings();
  }
}

export function isApkClient() {
  return Boolean(
    (typeof window !== "undefined" && window.AndroidBridge) ||
    (typeof document !== "undefined" && document.documentElement && document.documentElement.classList.contains("is-apk-mode")) ||
    (typeof document !== "undefined" && document.body && document.body.classList.contains("is-apk-mode"))
  );
}

export function isVolumeUpPttEnabled() {
  return false;
}

export function isVolumeDownPttEnabled() {
  return false;
}

export function setVolumeUpPttEnabled(enabled, syncServer = true) {
  // Volume buttons freed from PTT
}

export function setVolumeDownPttEnabled(enabled, syncServer = true) {
  // Volume buttons freed from PTT
}

export function toggleVolumeDownPttQuick() {
  // Removed automatic quick toggle by user request
}

export function isGlobalAudioMuted() {
  return localStorage.getItem("proxdmr_global_mute") === "true";
}

export function setGlobalAudioMute(muted) {
  localStorage.setItem("proxdmr_global_mute", muted ? "true" : "false");
  const ap = getAudioPlayer();
  if (ap && ap.setGlobalMute) {
    ap.setGlobalMute(muted);
  }
  if (window.ttsAudioQueueManager && typeof window.ttsAudioQueueManager.syncCurrentVolume === "function") {
    window.ttsAudioQueueManager.syncCurrentVolume();
  }
  if (window.recordingsManager && typeof window.recordingsManager.syncVolumeWithHotspot === "function") {
    window.recordingsManager.syncVolumeWithHotspot();
  }
  updateAllVolumeAndMuteUI();
}

export function toggleGlobalAudioMute() {
  setGlobalAudioMute(!isGlobalAudioMuted());
}

export function resolveHotspotId(hid) {
  const currentHotspots = getCurrentHotspots();
  if (!hid || hid === "undefined" || hid === "null") {
    return (currentHotspots && currentHotspots[0] && currentHotspots[0].id) || "default";
  }
  const sHid = String(hid);
  if (sHid === "default" || sHid === "1") {
    return (currentHotspots && currentHotspots[0] && currentHotspots[0].id) || "default";
  }
  return sHid;
}

export function getHotspotDisplayName(hid) {
  const currentHotspots = getCurrentHotspots();
  if (!Array.isArray(currentHotspots) || currentHotspots.length === 0) {
    return "Main 📻";
  }
  const resolved = resolveHotspotId(hid);
  let hs = currentHotspots.find(h => String(h.id) === String(hid) || resolveHotspotId(h.id) === resolved);
  if (!hs) {
    hs = currentHotspots[0];
  }
  if (!hs) return "Main 📻";
  if (hs.name && hs.name.trim()) return hs.name;
  const idx = currentHotspots.indexOf(hs);
  return idx === 0 ? "Main 📻" : `Хотспот #${idx + 1}`;
}

export function isHotspotAudioMuted(hid) {
  const cid = resolveHotspotId(hid);
  const v = localStorage.getItem(`proxdmr_mute_hs_${cid}`);
  if (v !== null) return v === "true";
  const currentHotspots = getCurrentHotspots();
  const isPrimary = (currentHotspots && currentHotspots[0] && String(currentHotspots[0].id) === cid) || (cid === "default");
  if (isPrimary) {
    const vDef = localStorage.getItem("proxdmr_mute_hs_default");
    if (vDef !== null) return vDef === "true";
  }
  return false;
}

export function setHotspotAudioMute(hid, muted) {
  const currentHotspots = getCurrentHotspots();
  const cid = resolveHotspotId(hid);
  localStorage.setItem(`proxdmr_mute_hs_${cid}`, muted ? "true" : "false");
  const isPrimary = (currentHotspots && currentHotspots[0] && String(currentHotspots[0].id) === cid) || (cid === "default");
  if (isPrimary) {
    localStorage.setItem("proxdmr_mute_hs_default", muted ? "true" : "false");
  }
  const ap = getAudioPlayer();
  if (ap && ap.setHotspotMute) {
    ap.setHotspotMute(cid, muted);
    if (isPrimary) {
      ap.setHotspotMute("default", muted);
    }
  }
  if (muted && ap && ap.resetHotspot) {
    ap.resetHotspot(cid);
    if (isPrimary) {
      ap.resetHotspot("default");
    }
  }
  if (window.ttsAudioQueueManager && typeof window.ttsAudioQueueManager.syncCurrentVolume === "function") {
    window.ttsAudioQueueManager.syncCurrentVolume();
  }
  if (window.recordingsManager && typeof window.recordingsManager.syncVolumeWithHotspot === "function") {
    window.recordingsManager.syncVolumeWithHotspot();
  }
  updateHotspotVolumeAndMuteUI(cid);
}

export function toggleHotspotAudioMute(hid) {
  const cid = resolveHotspotId(hid);
  setHotspotAudioMute(cid, !isHotspotAudioMuted(cid));
}

export function handleMuteButtonClick(e, hid) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const cid = resolveHotspotId(hid);
  const now = Date.now();

  // If global mute is currently active, a single click on any mute button immediately unmutes global
  if (isGlobalAudioMuted()) {
    if (muteClickTimer) {
      clearTimeout(muteClickTimer);
      muteClickTimer = null;
    }
    lastMuteClickTime = 0;
    lastMuteClickHid = null;
    setGlobalAudioMute(false);
    return;
  }

  // Check for double click/tap (within 350ms on the same hotspot button)
  if (lastMuteClickHid === cid && (now - lastMuteClickTime) < 350) {
    if (muteClickTimer) {
      clearTimeout(muteClickTimer);
      muteClickTimer = null;
    }
    lastMuteClickTime = 0;
    lastMuteClickHid = null;
    justDoubleClicked = true;
    setTimeout(() => { justDoubleClicked = false; }, 500);

    toggleGlobalAudioMute();
    return;
  }

  // First click: start a short timer before triggering single hotspot mute
  lastMuteClickTime = now;
  lastMuteClickHid = cid;

  if (muteClickTimer) {
    clearTimeout(muteClickTimer);
    muteClickTimer = null;
  }

  muteClickTimer = setTimeout(() => {
    muteClickTimer = null;
    lastMuteClickTime = 0;
    lastMuteClickHid = null;
    toggleHotspotAudioMute(cid);
  }, 280);
}

export function handleMuteButtonDblClick(e, hid) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  if (justDoubleClicked) return;
  justDoubleClicked = true;
  setTimeout(() => { justDoubleClicked = false; }, 500);

  if (muteClickTimer) {
    clearTimeout(muteClickTimer);
    muteClickTimer = null;
  }
  lastMuteClickTime = 0;
  lastMuteClickHid = null;
  toggleGlobalAudioMute();
}

let lastSystemVolSentTime = 0;
let lastSystemVolReceivedTime = 0;

export function isHotspotVolumeSyncEnabled() {
  const uid = (typeof window !== "undefined" && window.currentUserId) || null;
  if (uid) {
    const uVal = localStorage.getItem(`proxdmr_u${uid}_sync_hotspot_volume`);
    if (uVal !== null) return uVal === "true";
  }
  const v = localStorage.getItem("proxdmr_sync_hotspot_volume");
  if (v !== null) return v === "true";
  return true; // Default: enabled (all HS volumes synchronized)
}

export function setHotspotVolumeSyncEnabled(enabled, syncServer = true) {
  const boolVal = Boolean(enabled);
  localStorage.setItem("proxdmr_sync_hotspot_volume", boolVal ? "true" : "false");
  const uid = (typeof window !== "undefined" && window.currentUserId) || null;
  if (uid) localStorage.setItem(`proxdmr_u${uid}_sync_hotspot_volume`, boolVal ? "true" : "false");
  const chk = document.getElementById("optSyncHotspotVolume");
  if (chk) chk.checked = boolVal;
  if (boolVal) {
    const curVol = getHotspotVolume(getActiveHotspotId());
    setHotspotVolume(getActiveHotspotId(), curVol);
  }
  if (syncServer) {
    try {
      fetch("/api/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync_hotspot_volume: boolVal })
      }).catch(() => {});
    } catch (_) {}
    if (typeof window.scheduleSyncClientSettings === "function") {
      window.scheduleSyncClientSettings();
    }
  }
}

export function isSystemVolumeSyncEnabled() {
  if (!isApkClient()) return false;
  const uid = (typeof window !== "undefined" && window.currentUserId) || null;
  if (uid) {
    const uVal = localStorage.getItem(`proxdmr_u${uid}_sync_system_volume`);
    if (uVal !== null) return uVal === "true";
  }
  const v = localStorage.getItem("proxdmr_sync_system_volume");
  if (v !== null) return v === "true";
  return true; // Default: ENABLED in APK!
}

export function setSystemVolumeSyncEnabled(enabled, syncServer = true) {
  const boolVal = Boolean(enabled);
  localStorage.setItem("proxdmr_sync_system_volume", boolVal ? "true" : "false");
  const uid = (typeof window !== "undefined" && window.currentUserId) || null;
  if (uid) localStorage.setItem(`proxdmr_u${uid}_sync_system_volume`, boolVal ? "true" : "false");
  const chk = document.getElementById("optSyncSystemVolume");
  if (chk) chk.checked = boolVal;

  if (typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.setSystemVolumeSyncEnabled === "function") {
    try {
      window.AndroidBridge.setSystemVolumeSyncEnabled(boolVal);
    } catch (e) {
      console.warn("[AndroidBridge] Error setting system_volume_sync:", e);
    }
  }

  if (boolVal && typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.getSystemVolume === "function") {
    try {
      const sysVol = window.AndroidBridge.getSystemVolume();
      if (typeof sysVol === "number" && sysVol >= 0) {
        onSystemVolumeChanged(sysVol);
      }
    } catch (_) {}
  }

  if (syncServer) {
    try {
      fetch("/api/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync_system_volume: boolVal })
      }).catch(() => {});
    } catch (_) {}
    if (typeof window.scheduleSyncClientSettings === "function") {
      window.scheduleSyncClientSettings();
    }
  }
}

export function onSystemVolumeChanged(percent) {
  if (!isSystemVolumeSyncEnabled()) return;
  const now = Date.now();
  if (now - lastSystemVolSentTime < 350) return;
  lastSystemVolReceivedTime = now;

  const p = Math.max(0, Math.min(100, parseInt(percent, 10) || 0));
  setHotspotVolume(getActiveHotspotId(), p, false);
}

export function getHotspotVolume(hid) {
  let val = 80;
  if (isHotspotVolumeSyncEnabled()) {
    const common = localStorage.getItem("proxdmr_common_volume");
    if (common !== null) {
      const p = parseInt(common, 10);
      val = isNaN(p) ? 80 : p;
    } else {
      const vDef = localStorage.getItem("proxdmr_vol_default");
      if (vDef !== null) {
        const p = parseInt(vDef, 10);
        val = isNaN(p) ? 80 : p;
      }
    }
  } else {
    const currentHotspots = getCurrentHotspots();
    const cid = resolveHotspotId(hid);
    const v = localStorage.getItem(`proxdmr_vol_${cid}`);
    if (v !== null) {
      const p = parseInt(v, 10);
      val = isNaN(p) ? 80 : p;
    } else {
      const isPrimary = (currentHotspots && currentHotspots[0] && String(currentHotspots[0].id) === cid) || (cid === "default");
      if (isPrimary) {
        const vDef = localStorage.getItem("proxdmr_vol_default");
        if (vDef !== null) {
          const p = parseInt(vDef, 10);
          val = isNaN(p) ? 80 : p;
        } else {
          const legacy = localStorage.getItem("proxdmr_volume");
          if (legacy !== null) {
            const p = parseInt(legacy, 10);
            val = isNaN(p) ? 80 : p;
          }
        }
      }
    }
  }
  return Math.max(0, Math.min(100, val));
}

export function setHotspotVolume(hid, vol, syncToSystem = true) {
  const currentHotspots = getCurrentHotspots();
  const cid = resolveHotspotId(hid);
  const parsed = parseInt(vol, 10);
  const num = Math.max(0, Math.min(100, isNaN(parsed) ? 80 : parsed));

  const ap = getAudioPlayer();
  const isSync = isHotspotVolumeSyncEnabled();

  if (isSync) {
    localStorage.setItem("proxdmr_common_volume", num.toString());
    localStorage.setItem("proxdmr_vol_default", num.toString());
    localStorage.setItem("proxdmr_volume", num.toString());

    localStorage.setItem(`proxdmr_vol_${cid}`, num.toString());
    (currentHotspots || []).forEach(h => {
      const hcid = resolveHotspotId(h.id);
      localStorage.setItem(`proxdmr_vol_${hcid}`, num.toString());
      if (ap && ap.setHotspotVolume) {
        ap.setHotspotVolume(hcid, num / 100.0);
      }
    });
    if (ap && ap.setHotspotVolume) {
      ap.setHotspotVolume("default", num / 100.0);
    }
    if (ap && ap.setVolume) {
      ap.setVolume(num / 100.0);
    }

    updateHotspotVolumeAndMuteUI(null);
  } else {
    localStorage.setItem(`proxdmr_vol_${cid}`, num.toString());
    const isPrimary = (currentHotspots && currentHotspots[0] && String(currentHotspots[0].id) === cid) || (cid === "default");
    if (isPrimary) {
      localStorage.setItem("proxdmr_vol_default", num.toString());
      localStorage.setItem("proxdmr_volume", num.toString());
    }
    if (ap && ap.setHotspotVolume) {
      ap.setHotspotVolume(cid, num / 100.0);
      if (isPrimary) {
        ap.setHotspotVolume("default", num / 100.0);
      }
    }
    updateHotspotVolumeAndMuteUI(cid);
  }

  if (window.recordingsManager && typeof window.recordingsManager.syncVolumeWithHotspot === "function") {
    window.recordingsManager.syncVolumeWithHotspot();
  }
  if (window.ttsAudioQueueManager && typeof window.ttsAudioQueueManager.syncCurrentVolume === "function") {
    window.ttsAudioQueueManager.syncCurrentVolume();
  }

  if (syncToSystem && isSystemVolumeSyncEnabled()) {
    const now = Date.now();
    if (now - lastSystemVolReceivedTime > 300) {
      lastSystemVolSentTime = now;
      if (typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.setSystemVolume === "function") {
        try {
          const sysPercent = Math.min(100, num);
          window.AndroidBridge.setSystemVolume(sysPercent);
        } catch (e) {
          console.warn("[AndroidBridge] Error setting system volume:", e);
        }
      }
    }
  }

  scheduleSyncClientSettings();
}

export function getHotspotAgc(hid) {
  const cid = resolveHotspotId(hid);
  const v = localStorage.getItem(`proxdmr_agc_${cid}`);
  if (v !== null) return v === "true";
  const vDef = localStorage.getItem("proxdmr_agc_default");
  if (vDef !== null) return vDef === "true";
  const legacy = localStorage.getItem("proxdmr_agc");
  return legacy !== null ? legacy === "true" : true;
}

export function setHotspotAgc(hid, enabled) {
  const boolVal = Boolean(enabled);
  localStorage.setItem("proxdmr_agc", boolVal ? "true" : "false");
  localStorage.setItem("proxdmr_agc_default", boolVal ? "true" : "false");

  // Send to backend (global AGC toggle)
  const ws = getWs();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "set_agc_enabled", enabled: boolVal }));
  }

  // Sync all UI checkboxes
  document.querySelectorAll(".agc-toggle").forEach(chk => {
    chk.checked = boolVal;
  });
  const mainAgc = document.getElementById("agcToggle");
  if (mainAgc) mainAgc.checked = boolVal;
  scheduleSyncClientSettings();
}

export function getHotspotLoop(hid) {
  return false;
}

export function setHotspotLoop(hid, enabled) {
  // Loopback removed
}

export function isHotspotCollapsed(hid) {
  if (!hid) return false;
  const currentHotspots = getCurrentHotspots();
  const cid = resolveHotspotId(hid);
  const local = localStorage.getItem(`proxdmr_collapsed_${cid}`);
  if (local !== null) {
    return local === "true";
  }
  if (cid === resolveHotspotId("default") || cid === "default" || cid === "1") {
    const defLocal = localStorage.getItem("proxdmr_collapsed_default");
    if (defLocal !== null) return defLocal === "true";
  }
  const hsIdx = (currentHotspots || []).findIndex(h => resolveHotspotId(h.id) === cid || h.id === cid || h.id === hid);
  if (hsIdx >= 0) {
    const hs = currentHotspots[hsIdx];
    if (typeof hs.collapsed === "boolean") return hs.collapsed;
    return hsIdx > 0;
  }
  return cid !== "default" && cid !== "1";
}

export function isHotspotLiveCollapsed(hid) {
  if (!hid) return false;
  const cid = resolveHotspotId(hid);
  return localStorage.getItem(`proxdmr_live_collapsed_${cid}`) === "true";
}

export async function collapseHotspot(hid, options = {}) {
  const isLive = Boolean(options && options.isLive);
  const currentHotspots = getCurrentHotspots();
  const activeHotspotId = getActiveHotspotId();
  const cid = resolveHotspotId(hid);
  const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`)
    || (cid === resolveHotspotId("default") ? document.getElementById("radioContainer") : null);
  if (!card) return;

  const now = Date.now();
  if (typeof window !== "undefined") {
    window._lastHotspotCollapseActionTimes = window._lastHotspotCollapseActionTimes || {};
    window._lastHotspotCollapseActionTimes[cid] = now;
    if (cid === resolveHotspotId("default") || cid === "default") {
      window._lastHotspotCollapseActionTimes["default"] = now;
    }
  }
  lastCollapseToggleTime = now;
  isCollapseToggleBusy = true;
  setTimeout(() => { isCollapseToggleBusy = false; }, 600);

  if (isLive) {
    // ═══════════════════════════════════════════════════════════════════
    // ОСОБЫЙ РЕЖИМ (LIVE COLLAPSE - удержание кнопки сворачивания):
    // Само окно сворачивается, но хотспот полноценно работает:
    // - BM не отключается
    // - звук не глушится
    // - лог НЕ закрывается
    // - плеер НЕ останавливается
    // ═══════════════════════════════════════════════════════════════════
    card.classList.add("collapsed", "live-collapsed");
    localStorage.setItem(`proxdmr_collapsed_${cid}`, "true");
    if (cid === resolveHotspotId("default") || cid === "default" || cid === "1") {
      localStorage.setItem("proxdmr_collapsed_default", "true");
    }
    localStorage.setItem(`proxdmr_live_collapsed_${cid}`, "true");

    const btn = card.querySelector(".hotspot-collapse-btn");
    if (btn) btn.title = window.t ? window.t("hotspots.expand_bg_title", {}, "Развернуть этот хотспот (работает в фоне)") : "Развернуть этот хотспот (работает в фоне)";

    const hs = (currentHotspots || []).find(h => resolveHotspotId(h.id) === cid || h.id === cid);
    if (hs) {
      hs.isLiveCollapsed = true;
    }

    const nameBadge = card.querySelector(".hotspot-name-badge");
    if (nameBadge && hs && (hs.status === "ONLINE" || hs.status === "CONNECTING")) {
      nameBadge.classList.add("is-online");
    }

    renderHotspotsList();
    renderHotspotSelect();

    const hsName = hs ? (hs.name || cid) : cid;
    showToast(window.t ? window.t("hotspots.collapsed_bg_toast", { name: hsName }, `Хотспот [${hsName}] свернут, но продолжает работать в фоне`) : `Хотспот [${hsName}] свернут, но продолжает работать в фоне`, 3500);
    scheduleSyncClientSettings();
    return;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ОБЫЧНЫЙ РЕЖИМ (короткий клик):
  // Полное отключение и остановка. Лог обязательно сворачивается,
  // если в нем работал плеер — плеер останавливается.
  // ═══════════════════════════════════════════════════════════════════

  // 1. Mute hotspot audio and save previous state
  const wasMuted = isHotspotAudioMuted(cid);
  localStorage.setItem(`proxdmr_pre_collapse_mute_${cid}`, wasMuted ? "1" : "0");
  setHotspotAudioMute(cid, true);
  const ap = getAudioPlayer();
  if (ap && ap.resetHotspot) {
    ap.resetHotspot(cid);
  }

  // 2. Disconnect / pause BM API checking
  const badge = card.querySelector(".api-status-badge");
  if (badge) {
    badge.className = "status-badge bm-badge api-status-badge status-offline bm-offline";
    badge.textContent = "API:OFFLINE";
  }

  // 3. Visual collapse
  card.classList.add("collapsed");
  card.classList.remove("live-collapsed");
  localStorage.setItem(`proxdmr_collapsed_${cid}`, "true");
  if (cid === resolveHotspotId("default") || cid === "default" || cid === "1") {
    localStorage.setItem("proxdmr_collapsed_default", "true");
  }
  localStorage.setItem(`proxdmr_live_collapsed_${cid}`, "false");
  const btn = card.querySelector(".hotspot-collapse-btn");
  if (btn) btn.title = (typeof window !== "undefined" && window.t) ? window.t("vfo.hotspot_expand_title") : "Развернуть этот хотспот";

  const nameBadge = card.querySelector(".hotspot-name-badge");
  if (nameBadge) {
    nameBadge.classList.remove("is-online");
  }

  // 4. Update local hotspot state to DISCONNECTED
  const hs = (currentHotspots || []).find(h => resolveHotspotId(h.id) === cid || h.id === cid);
  if (hs) {
    hs.collapsed = true;
    hs.isLiveCollapsed = false;
    hs.isManualBmDisconnect = true;
    hs.status = "DISCONNECTED";
    hs.detail = "Свернут / отключен";
  }
  if (typeof window !== "undefined" && typeof window.updateBmStatus === "function") {
    window.updateBmStatus("DISCONNECTED", "Свернут / отключен", cid);
  }
  renderHotspotsList();
  renderHotspotSelect();

  // 5. Disconnect from BrandMeister network via WS (or REST fallback) for this collapsed hotspot
  if (typeof window !== "undefined" && typeof window.disableHotspotTranscribe === "function") {
    window.disableHotspotTranscribe(cid, true);
  }
  const ws = getWs();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "hotspot_collapse", hotspot_id: cid, collapsed: true }));
  } else {
    try {
      await fetch(`/api/hotspots/${cid}/collapse`, { method: "POST" });
    } catch (e) {
      console.warn(`[HOTSPOT] Error collapsing BM for ${cid}:`, e);
    }
  }

  // If active hotspot was collapsed, switch active to another open hotspot
  if (cid === activeHotspotId) {
    const nextOpen = (currentHotspots || []).find(h => resolveHotspotId(h.id) !== cid && !isHotspotCollapsed(h.id));
    if (nextOpen) {
      switchActiveHotspot(nextOpen.id);
    }
  }

  // 6. Лог автоматически сворачивается ТОЛЬКО если он открыт именно для этого хотспота (или если больше нет открытых хотспотов).
  // Если лог открыт для ДРУГОГО хотспота — он не должен закрываться при сворачивании текущего хотспота.
  if (typeof window !== "undefined" && window.isLogVisible) {
    const curLogHid = window.currentLogHotspotId;
    const isMobile = typeof window.innerWidth === "number" && window.innerWidth <= 768;
    const effectiveLogHid = (isMobile && (!curLogHid || curLogHid === "all"))
      ? (activeHotspotId || ((currentHotspots || [])[0] && (currentHotspots || [])[0].id) || "default")
      : curLogHid;

    const remainingOpen = (currentHotspots || []).filter(h => resolveHotspotId(h.id) !== cid && !isHotspotCollapsed(h.id));
    const isCardLogActive = Boolean(card && card.querySelector(".btn-log-drawer.active"));
    const isLogForThisHotspot = (curLogHid !== "all") && (
      (curLogHid && resolveHotspotId(curLogHid) === cid) ||
      (effectiveLogHid && resolveHotspotId(effectiveLogHid) === cid) ||
      isCardLogActive
    );

    if (isLogForThisHotspot || remainingOpen.length === 0) {
      window.isLogVisible = false;
      if (typeof window.updateLogVisibility === "function") {
        window.updateLogVisibility(true);
      }
      if (window.recordingsManager) {
        if (typeof window.recordingsManager.stop === "function") {
          window.recordingsManager.stop();
        }
        if (typeof window.recordingsManager.closePlayer === "function") {
          window.recordingsManager.closePlayer();
        }
      }
    } else {
      // Лог открыт для другого хотспота — сохраняем открытым и актуализируем высоту / позицию
      if (typeof window.updateLogVisibility === "function") {
        window.updateLogVisibility(false);
      }
    }
  }
  scheduleSyncClientSettings();
}

export async function expandHotspot(hid) {
  const currentHotspots = getCurrentHotspots();
  const cid = resolveHotspotId(hid);
  const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`)
    || (cid === resolveHotspotId("default") ? document.getElementById("radioContainer") : null);
  if (!card) return;

  const lastAction = (typeof window !== "undefined" && window._lastHotspotCollapseActionTimes && (window._lastHotspotCollapseActionTimes[cid] || window._lastHotspotCollapseActionTimes["default"])) || 0;
  if (Date.now() - lastAction < 600) {
    console.warn(`[COLLAPSE] Prevented rapid auto-expand for ${cid} (${Date.now() - lastAction}ms since last action)`);
    return;
  }

  const now = Date.now();
  if (typeof window !== "undefined") {
    window._lastHotspotCollapseActionTimes = window._lastHotspotCollapseActionTimes || {};
    window._lastHotspotCollapseActionTimes[cid] = now;
    if (cid === resolveHotspotId("default") || cid === "default") {
      window._lastHotspotCollapseActionTimes["default"] = now;
    }
  }
  lastCollapseToggleTime = now;
  isCollapseToggleBusy = true;
  setTimeout(() => { isCollapseToggleBusy = false; }, 600);

  const wasLive = isHotspotLiveCollapsed(cid);

  // 1. Visual expand
  card.classList.remove("collapsed", "live-collapsed");
  localStorage.setItem(`proxdmr_collapsed_${cid}`, "false");
  if (cid === resolveHotspotId("default") || cid === "default" || cid === "1") {
    localStorage.setItem("proxdmr_collapsed_default", "false");
  }
  localStorage.setItem(`proxdmr_live_collapsed_${cid}`, "false");
  const btn = card.querySelector(".hotspot-collapse-btn");
  if (btn) btn.title = (typeof window !== "undefined" && window.t) ? window.t("vfo.hotspot_collapse_title") : "Свернуть этот хотспот (удержание: свернуть без отключения)";

  const hs = (currentHotspots || []).find(h => resolveHotspotId(h.id) === cid || h.id === cid);
  if (hs) {
    hs.collapsed = false;
    hs.isLiveCollapsed = false;
    hs.isManualBmDisconnect = false;
  }
  switchActiveHotspot(cid);
  renderHotspotsList();
  renderHotspotSelect();

  if (wasLive) {
    // If it was already live in background, it's already connected to BM!
    const nameBadge = card.querySelector(".hotspot-name-badge");
    if (nameBadge && hs && hs.status === "ONLINE") {
      nameBadge.classList.add("is-online");
    }
    scheduleSyncClientSettings();
    return;
  }

  // 2. Reconnect to own server & BrandMeister via WS (or REST fallback)
  const ws = getWs();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "hotspot_collapse", hotspot_id: cid, collapsed: false }));
  } else {
    try {
      await fetch(`/api/hotspots/${cid}/expand`, { method: "POST" });
    } catch (e) {
      console.warn(`[HOTSPOT] Error expanding BM for ${cid}:`, e);
    }
  }

  // 3. Re-enable BM API checking
  const badge = card.querySelector(".api-status-badge");
  const dt = card.querySelector(".api-detail-text");
  if (badge) {
    badge.className = "status-badge bm-badge api-status-badge status-connecting bm-connecting";
    badge.textContent = "API:CHECKING";
  }
  if (dt) dt.textContent = (typeof window !== "undefined" && window.t) ? window.t("status.api_checking_detail") : "Проверка токена v2...";

  if (typeof window !== "undefined" && typeof window.checkBmApiStatus === "function") {
    window.checkBmApiStatus(true, cid);
  }

  // 4. Restore configurations of buttons, sliders and modes
  const wasMuted = localStorage.getItem(`proxdmr_pre_collapse_mute_${cid}`) === "1";
  setHotspotAudioMute(cid, wasMuted);
  updateHotspotVolumeAndMuteUI(cid);

  if (typeof window !== "undefined" && typeof window.updateCardTsAudioModeUI === "function") {
    window.updateCardTsAudioModeUI(card, cid);
  }
  if (typeof window !== "undefined" && typeof window.updateHotspotCardMuteUI === "function") {
    window.updateHotspotCardMuteUI(cid, card);
  }

  if (hs && typeof window !== "undefined" && typeof window.updateCardBmBanner === "function") {
    window.updateCardBmBanner(card, hs);
  }
  if (typeof window !== "undefined" && window.isLogVisible && typeof window.updateLogVisibility === "function") {
    window.updateLogVisibility(false);
  }
  scheduleSyncClientSettings();
}

let lastCollapseToggleTime = 0;
let isCollapseToggleBusy = false;

export async function toggleHotspotCollapse(hid) {
  const cid = resolveHotspotId(hid);
  const now = Date.now();
  const lastAction = (typeof window !== "undefined" && window._lastHotspotCollapseActionTimes && (window._lastHotspotCollapseActionTimes[cid] || window._lastHotspotCollapseActionTimes["default"])) || 0;
  if (now - lastAction < 600 || now - lastCollapseToggleTime < 600 || isCollapseToggleBusy) {
    console.log(`[COLLAPSE] Ignored rapid toggle for ${hid} (throttled)`);
    return;
  }
  if (typeof window !== "undefined") {
    window._lastHotspotCollapseActionTimes = window._lastHotspotCollapseActionTimes || {};
    window._lastHotspotCollapseActionTimes[cid] = now;
    if (cid === resolveHotspotId("default") || cid === "default") {
      window._lastHotspotCollapseActionTimes["default"] = now;
    }
  }
  lastCollapseToggleTime = now;
  isCollapseToggleBusy = true;
  try {
    if (isHotspotCollapsed(cid)) {
      await expandHotspot(cid);
    } else {
      await collapseHotspot(cid);
    }
  } finally {
    setTimeout(() => {
      isCollapseToggleBusy = false;
    }, 600);
  }
}

export const SVG_SPEAKER_HIGH = `<svg class="speaker-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="#f1f5f9" stroke="#64748b" stroke-width="1.2"/><path d="M15.5 8.5a5 5 0 0 1 0 7" stroke="#38bdf8" stroke-width="2.2"/><path d="M19 5a10 10 0 0 1 0 14" stroke="#38bdf8" stroke-width="2.2"/></svg>`;
export const SVG_SPEAKER_LOW = `<svg class="speaker-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="#f1f5f9" stroke="#64748b" stroke-width="1.2"/><path d="M15.5 8.5a5 5 0 0 1 0 7" stroke="#38bdf8" stroke-width="2.2"/></svg>`;
export const SVG_SPEAKER_MUTED = `<svg class="speaker-svg speaker-svg-muted" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="#94a3b8" stroke="#475569" stroke-width="1.2"/><line x1="16" y1="9" x2="22" y2="15" stroke="#ef4444" stroke-width="2.4"/><line x1="22" y1="9" x2="16" y2="15" stroke="#ef4444" stroke-width="2.4"/></svg>`;

export function updateHotspotVolumeAndMuteUI(hid) {
  const targetCid = hid ? resolveHotspotId(hid) : null;
  const cards = targetCid 
    ? document.querySelectorAll(`.radio-container[data-hotspot-id="${targetCid}"]`)
    : document.querySelectorAll(".radio-container");

  const globalMuted = isGlobalAudioMuted();
  const pttMuted = isPttAudioMuted();

  cards.forEach(card => {
    const cid = resolveHotspotId(card.dataset.hotspotId);
    const muteBtn = card.querySelector(".volume-mute-toggle");
    const slider = card.querySelector(".volume-slider");
    const valText = card.querySelector(".volume-val");

    const hsMuted = isHotspotAudioMuted(cid);
    const curVol = getHotspotVolume(cid);

    if (slider && document.activeElement !== slider) {
      slider.max = 100;
      slider.value = curVol;
    }
    if (valText) {
      valText.textContent = `${curVol}%`;
    }

    const ratio = Math.max(0, Math.min(1, curVol / 100));
    const wrap = card.querySelector(".volume-slider-v-wrap");
    if (wrap) wrap.style.setProperty("--vol-ratio", ratio.toFixed(3));
    if (slider) slider.style.setProperty("--vol-ratio", ratio.toFixed(3));

    const strip = card.querySelector(".vertical-volume-strip");
    if (strip) {
      const syncNote = isSystemVolumeSyncEnabled() ? (window.t ? window.t("audio.vol_android_sync", {}, " • Привязано к системе Android") : " • Привязано к системе Android") : "";
      strip.title = window.t ? window.t("audio.vol_speaker_title", { vol: curVol, sync: syncNote }, `Громкость динамика: ${curVol}% (0% - 100%)${syncNote}`) : `Громкость динамика: ${curVol}% (0% - 100%)${syncNote}`;
    }

    if (muteBtn) {
      muteBtn.classList.remove("muted-channel", "muted-global", "muted-ptt");
      if (globalMuted) {
        muteBtn.innerHTML = SVG_SPEAKER_MUTED;
        muteBtn.classList.add("muted-global");
        muteBtn.title = ((typeof window !== "undefined" && window.t) ? window.t("vfo.mute_all_active", {}, "ОБЩИЙ MUTE АКТИВЕН для всех хотспотов (двойной клик для снятия)") : "ОБЩИЙ MUTE АКТИВЕН для всех хотспотов (двойной клик для снятия)");
      } else if (pttMuted) {
        muteBtn.innerHTML = SVG_SPEAKER_MUTED;
        muteBtn.classList.add("muted-ptt");
        muteBtn.title = ((typeof window !== "undefined" && window.t) ? window.t("vfo.mute_tx_active", {}, "Общий MUTE активен на время передачи (PTT + 1с)") : "Общий MUTE активен на время передачи (PTT + 1с)");
      } else if (hsMuted || curVol === 0) {
        muteBtn.innerHTML = SVG_SPEAKER_MUTED;
        muteBtn.classList.add("muted-channel");
        muteBtn.title = curVol === 0
          ? ((typeof window !== "undefined" && window.t) ? window.t("audio.vol_zero_tooltip", {}, "Громкость на нуле (клик: включить, двойной клик: полный общий Mute)") : "Громкость на нуле (клик: включить, двойной клик: полный общий Mute)")
          : ((typeof window !== "undefined" && window.t) ? window.t("audio.vol_muted_tooltip", {}, "Звук этого хотспота ОТКЛЮЧЕН (клик: включить, двойной клик: полный общий Mute)") : "Звук этого хотспота ОТКЛЮЧЕН (клик: включить, двойной клик: полный общий Mute)");
      } else {
        muteBtn.innerHTML = curVol < 30 ? SVG_SPEAKER_LOW : SVG_SPEAKER_HIGH;
        muteBtn.title = ((typeof window !== "undefined" && window.t) ? window.t("vfo.mute_hs_title", {}, "Mute этого хотспота (двойной клик: полный общий Mute)") : "Mute этого хотспота (двойной клик: полный общий Mute)");
      }
    }
  });
}

export function updateAllVolumeAndMuteUI() {
  updateHotspotVolumeAndMuteUI(null);
  updateHotspotCardMuteUI(null);
  updateHotspotCardPanUI(null);
}

export function initVolumeMute() {
  const volumeSlider = document.getElementById("volumeSlider");
  const volumeVal = document.getElementById("volumeVal");
  const volumeMuteToggle = document.getElementById("volumeMuteToggle");
  const optMuteOnPtt = document.getElementById("optMuteOnPtt");
  if (optMuteOnPtt) {
    optMuteOnPtt.checked = isMuteOnPttEnabled();
    optMuteOnPtt.addEventListener("change", () => {
      setMuteOnPttEnabled(optMuteOnPtt.checked);
    });
  }

  const optSyncHotspotVolume = document.getElementById("optSyncHotspotVolume");
  if (optSyncHotspotVolume) {
    optSyncHotspotVolume.checked = isHotspotVolumeSyncEnabled();
    optSyncHotspotVolume.addEventListener("change", () => {
      setHotspotVolumeSyncEnabled(optSyncHotspotVolume.checked);
    });
  }

  const groupSyncSystemVolume = document.getElementById("groupSyncSystemVolume");
  if (groupSyncSystemVolume) {
    groupSyncSystemVolume.style.display = "block";
  }
  const optSyncSystemVolume = document.getElementById("optSyncSystemVolume");
  const hintSyncSystemVolumeWeb = document.getElementById("hintSyncSystemVolumeWeb");
  if (optSyncSystemVolume) {
    if (isApkClient()) {
      optSyncSystemVolume.disabled = false;
      optSyncSystemVolume.checked = isSystemVolumeSyncEnabled();
      if (hintSyncSystemVolumeWeb) hintSyncSystemVolumeWeb.style.display = "none";
    } else {
      optSyncSystemVolume.disabled = true;
      optSyncSystemVolume.checked = false;
      if (hintSyncSystemVolumeWeb) hintSyncSystemVolumeWeb.style.display = "block";
    }
    optSyncSystemVolume.addEventListener("change", () => {
      setSystemVolumeSyncEnabled(optSyncSystemVolume.checked);
    });
  }

  if (volumeSlider) {
    volumeSlider.max = 100;
    const handleInitVol = () => {
      const val = parseInt(volumeSlider.value, 10);
      const safeVal = isNaN(val) ? 80 : Math.max(0, Math.min(100, val));
      const ratio = Math.max(0, Math.min(1, safeVal / 100));
      const wrap = volumeSlider.closest(".volume-slider-v-wrap");
      if (wrap) wrap.style.setProperty("--vol-ratio", ratio.toFixed(3));
      volumeSlider.style.setProperty("--vol-ratio", ratio.toFixed(3));
      if (volumeVal) volumeVal.textContent = `${safeVal}%`;
      const card = volumeSlider.closest(".radio-container");
      const cid = (card && card.dataset.hotspotId) || getActiveHotspotId() || "default";
      setHotspotVolume(cid, safeVal);
    };
    volumeSlider.oninput = handleInitVol;
    volumeSlider.onchange = handleInitVol;
  }

  if (volumeMuteToggle) {
    volumeMuteToggle.onclick = (e) => {
      const card = volumeMuteToggle.closest(".radio-container");
      const cid = (card && card.dataset.hotspotId) || getActiveHotspotId() || "default";
      handleMuteButtonClick(e, cid);
    };
    volumeMuteToggle.ondblclick = (e) => {
      const card = volumeMuteToggle.closest(".radio-container");
      const cid = (card && card.dataset.hotspotId) || getActiveHotspotId() || "default";
      handleMuteButtonDblClick(e, cid);
    };
  }

  // Volume Down -> PTT option block visibility (APK only)
  const groupVolumeDownPtt = document.getElementById("groupVolumeDownPtt");
  if (groupVolumeDownPtt) {
    groupVolumeDownPtt.style.display = isApkClient() ? "block" : "none";
  }

  // TS Audio Mode 3-state toggle button on Main Card
  const tsAudioModeToggleBtn = document.getElementById("tsAudioModeToggleBtn");
  if (tsAudioModeToggleBtn) {
    if (typeof window.setupTsAudioModeButton === "function") {
      window.setupTsAudioModeButton(tsAudioModeToggleBtn, document.getElementById("radioContainer"), "default");
    }
  }

  // AGC (АРУ по НЧ) toggle on Main Card
  const agcToggle = document.getElementById("agcToggle");
  if (agcToggle) {
    const agcActive = getHotspotAgc("default");
    agcToggle.checked = agcActive;
    agcToggle.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    agcToggle.addEventListener("change", () => {
      setHotspotAgc("default", agcToggle.checked);
    });
  }

  // Prevent any clicks on .toggle-control from bubbling to status rows
  document.querySelectorAll(".toggle-control").forEach((ctrl) => {
    ctrl.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  });

  // Audio test tone button
  const audioTestBtn = document.getElementById("audioTestBtn");
  if (audioTestBtn) {
    audioTestBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.audioPlayer && typeof window.audioPlayer.playTestTone === "function") {
        window.audioPlayer.playTestTone();
      }
      audioTestBtn.style.transform = "scale(1.25)";
      setTimeout(() => { audioTestBtn.style.transform = "scale(1)"; }, 200);
    });
  }

  if (isSystemVolumeSyncEnabled() && typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.getSystemVolume === "function") {
    try {
      const sysVol = window.AndroidBridge.getSystemVolume();
      if (typeof sysVol === "number" && sysVol >= 0) {
        onSystemVolumeChanged(sysVol);
      }
    } catch (_) {}
  } else {
    updateAllVolumeAndMuteUI();
  }
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.isMuteOnPttEnabled = isMuteOnPttEnabled;
  window.setMuteOnPttEnabled = setMuteOnPttEnabled;
  window.isPttAudioMuted = isPttAudioMuted;
  window.isSimultaneousSlotsEnabled = isSimultaneousSlotsEnabled;
  window.setSimultaneousSlotsEnabled = setSimultaneousSlotsEnabled;
  window.isApkClient = isApkClient;
  window.isVolumeUpPttEnabled = isVolumeUpPttEnabled;
  window.setVolumeUpPttEnabled = setVolumeUpPttEnabled;
  window.isSimultaneousSlotsEnabled = isSimultaneousSlotsEnabled;
  window.setSimultaneousSlotsEnabled = setSimultaneousSlotsEnabled;
  window.isVolumeDownPttEnabled = isVolumeDownPttEnabled;
  window.setVolumeDownPttEnabled = setVolumeDownPttEnabled;
  window.toggleVolumeDownPttQuick = toggleVolumeDownPttQuick;
  window.isGlobalAudioMuted = isGlobalAudioMuted;
  window.setGlobalAudioMute = setGlobalAudioMute;
  window.toggleGlobalAudioMute = toggleGlobalAudioMute;
  window.resolveHotspotId = resolveHotspotId;
  window.getHotspotDisplayName = getHotspotDisplayName;
  window.isHotspotAudioMuted = isHotspotAudioMuted;
  window.setHotspotAudioMute = setHotspotAudioMute;
  window.toggleHotspotAudioMute = toggleHotspotAudioMute;
  window.handleMuteButtonClick = handleMuteButtonClick;
  window.handleMuteButtonDblClick = handleMuteButtonDblClick;
  window.getHotspotVolume = getHotspotVolume;
  window.setHotspotVolume = setHotspotVolume;
  window.getHotspotAgc = getHotspotAgc;
  window.setHotspotAgc = setHotspotAgc;
  window.getHotspotLoop = getHotspotLoop;
  window.setHotspotLoop = setHotspotLoop;
  window.isHotspotCollapsed = isHotspotCollapsed;
  window.isHotspotLiveCollapsed = isHotspotLiveCollapsed;
  window.collapseHotspot = collapseHotspot;
  window.expandHotspot = expandHotspot;
  window.toggleHotspotCollapse = toggleHotspotCollapse;
  window.updateHotspotVolumeAndMuteUI = updateHotspotVolumeAndMuteUI;
  window.updateAllVolumeAndMuteUI = updateAllVolumeAndMuteUI;
  window.initVolumeMute = initVolumeMute;
  window.isHotspotVolumeSyncEnabled = isHotspotVolumeSyncEnabled;
  window.setHotspotVolumeSyncEnabled = setHotspotVolumeSyncEnabled;
  window.isSystemVolumeSyncEnabled = isSystemVolumeSyncEnabled;
  window.setSystemVolumeSyncEnabled = setSystemVolumeSyncEnabled;
  window.onSystemVolumeChanged = onSystemVolumeChanged;

  window.__proxdmr = window.__proxdmr || {};
  Object.assign(window.__proxdmr, {
    isMuteOnPttEnabled,
    setMuteOnPttEnabled,
    isPttAudioMuted,
    isSimultaneousSlotsEnabled,
    setSimultaneousSlotsEnabled,
    isApkClient,
    isVolumeUpPttEnabled,
    setVolumeUpPttEnabled,
    isVolumeDownPttEnabled,
    setVolumeDownPttEnabled,
    toggleVolumeDownPttQuick,
    isGlobalAudioMuted,
    setGlobalAudioMute,
    toggleGlobalAudioMute,
    resolveHotspotId,
    getHotspotDisplayName,
    isHotspotAudioMuted,
    setHotspotAudioMute,
    toggleHotspotAudioMute,
    handleMuteButtonClick,
    handleMuteButtonDblClick,
    getHotspotVolume,
    setHotspotVolume,
    getHotspotAgc,
    setHotspotAgc,
    getHotspotLoop,
    setHotspotLoop,
    isHotspotCollapsed,
    isHotspotLiveCollapsed,
    collapseHotspot,
    expandHotspot,
    toggleHotspotCollapse,
    updateHotspotVolumeAndMuteUI,
    updateAllVolumeAndMuteUI,
    initVolumeMute,
    isHotspotVolumeSyncEnabled,
    setHotspotVolumeSyncEnabled,
    isSystemVolumeSyncEnabled,
    setSystemVolumeSyncEnabled,
    onSystemVolumeChanged
  });
}
