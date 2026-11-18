/**
 * ProxDMR - Master & Per-Hotspot Volume, Audio Gain, AGC, Loopback & Mute Subsystem
 * Handles master/per-channel muting, double-click gestures, PTT auto-mute suppression,
 * volume controls, AGC toggles, audio loopback, and hotspot collapse/expand lifecycle.
 */

import { showCenterHudToast, showToast } from "../core/toast.js?v=2.9.699";
import { scheduleSyncClientSettings } from "../settings/sync.js?v=2.9.737";
import { updateHotspotCardMuteUI, updateHotspotCardPanUI } from "./routing.js?v=2.9.729";
import { renderHotspotsList, renderHotspotSelect, switchActiveHotspot } from "../dmr/hotspots.js?v=2.9.741";

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

export function isSingleHotspotAudioEnabled() {
  const uid = (typeof window !== "undefined" && window.currentUserId) || null;
  if (uid && localStorage.getItem(`proxdmr_u${uid}_single_hotspot_audio`) !== null) {
    return localStorage.getItem(`proxdmr_u${uid}_single_hotspot_audio`) === "true";
  }
  return localStorage.getItem("proxdmr_single_hotspot_audio") === "true";
}

export function setSingleHotspotAudioEnabled(enabled, syncServer = true) {
  const boolVal = Boolean(enabled);
  localStorage.setItem("proxdmr_single_hotspot_audio", boolVal ? "true" : "false");
  const uid = (typeof window !== "undefined" && window.currentUserId) || null;
  if (uid) localStorage.setItem(`proxdmr_u${uid}_single_hotspot_audio`, boolVal ? "true" : "false");
  const chk = document.getElementById("optSingleHotspotAudio");
  if (chk) chk.checked = boolVal;
  if (typeof window !== "undefined") {
    window.isSingleHotspotAudioEnabled = () => boolVal;
  }
  if (syncServer) {
    const ws = (typeof window !== "undefined" && window.ws) || null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "set_single_hotspot_audio", enabled: boolVal }));
      } catch (_) {}
    }
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ single_hotspot_audio: boolVal })
    }).catch(() => {});
  }
}
window.isSingleHotspotAudioEnabled = isSingleHotspotAudioEnabled;
window.setSingleHotspotAudioEnabled = setSingleHotspotAudioEnabled;

export function isPttAudioMuted() {
  return isPttMuteActive;
}

export function isSimultaneousSlotsEnabled() {
  if (typeof window !== "undefined" && typeof window.getHotspotTsAudioMode === "function") {
    return window.getHotspotTsAudioMode("default") !== "solo";
  }
  return localStorage.getItem("proxdmr_simultaneous_slots") === "true";
}

export function setSimultaneousSlotsEnabled(enabled, syncServer = true) {
  const boolVal = Boolean(enabled);
  localStorage.setItem("proxdmr_simultaneous_slots", boolVal ? "true" : "false");
  if (typeof window !== "undefined" && typeof window.setHotspotTsAudioMode === "function") {
    window.setHotspotTsAudioMode("default", boolVal ? "auto" : "solo", { skipServerSync: !syncServer });
  }
  if (syncServer) {
    const ws = (typeof getWs === "function" ? getWs() : (typeof window !== "undefined" ? window.ws : null));
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "set_simultaneous_slots", enabled: boolVal }));
      } catch (_) {}
    }
    try {
      fetch("/api/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simultaneous_slots: boolVal })
      }).catch(() => {});
    } catch (_) {}
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
  if (Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === sHid)) {
    return sHid;
  }
  if (sHid === "default" || sHid === "1") {
    return (currentHotspots && currentHotspots[0] && currentHotspots[0].id) || "default";
  }
  return sHid;
}

export function isPrimaryDefaultAlias(cid, currentHotspots = null) {
  const sCid = String(cid || "");
  if (sCid === "default") return true;
  const list = Array.isArray(currentHotspots) ? currentHotspots : getCurrentHotspots();
  if (Array.isArray(list) && list.some(h => h && String(h.id) === "default")) {
    return false;
  }
  return Boolean(list && list[0] && String(list[0].id) === sCid);
}
if (typeof window !== "undefined") window.isPrimaryDefaultAlias = isPrimaryDefaultAlias;

export function getHotspotDisplayName(hid) {
  const currentHotspots = getCurrentHotspots();
  if (!Array.isArray(currentHotspots) || currentHotspots.length === 0) {
    return "Main 📻";
  }
  const resolved = resolveHotspotId(hid);
  let hs = currentHotspots.find(h => String(h.id) === String(hid)) ||
           currentHotspots.find(h => String(h.id) === String(resolved));
  if (!hs) {
    hs = currentHotspots[0];
  }
  if (!hs) return "Main 📻";
  if (hs.name && hs.name.trim()) return hs.name;
  const idx = currentHotspots.indexOf(hs);
  return idx === 0 ? "Main 📻" : (window.t ? window.t("hotspots.default_hs_name", { idx: idx + 1 }, `Hotspot #${idx + 1}`) : `Hotspot #${idx + 1}`);
}

export function isHotspotAudioMuted(hid) {
  const cid = resolveHotspotId(hid);
  const v = localStorage.getItem(`proxdmr_mute_hs_${cid}`);
  if (v !== null) return v === "true";
  const currentHotspots = getCurrentHotspots();
  if (isPrimaryDefaultAlias(cid, currentHotspots)) {
    const vDef = localStorage.getItem("proxdmr_mute_hs_default");
    if (vDef !== null) return vDef === "true";
  }
  return false;
}

export function setHotspotAudioMute(hid, muted, isInternalSoloOp = false) {
  const currentHotspots = getCurrentHotspots();
  const cid = resolveHotspotId(hid);
  if (!muted && !isInternalSoloOp && _activeSoloHotspotId && cid !== _activeSoloHotspotId) {
    _activeSoloHotspotId = null;
    _preSoloMuteStates = null;
    try {
      sessionStorage.removeItem("proxdmr_pre_solo_mutes");
      sessionStorage.removeItem("proxdmr_active_solo_hs");
    } catch (_) {}
  }
  localStorage.setItem(`proxdmr_mute_hs_${cid}`, muted ? "true" : "false");
  const isDefaultAlias = isPrimaryDefaultAlias(cid, currentHotspots);
  if (isDefaultAlias) {
    localStorage.setItem("proxdmr_mute_hs_default", muted ? "true" : "false");
  }
  const ap = getAudioPlayer();
  if (ap && ap.setHotspotMute) {
    ap.setHotspotMute(cid, muted);
    if (isDefaultAlias && cid !== "default") {
      ap.setHotspotMute("default", muted);
    }
  }
  // Muting is an audio gain ramp operation (gain -> 0.0), handled seamlessly by ap.setHotspotMute.
  // We do NOT call ap.resetHotspot on mute so that other active hotspots and jitter buffers remain unaffected.
  if (window.ttsAudioQueueManager && typeof window.ttsAudioQueueManager.syncCurrentVolume === "function") {
    window.ttsAudioQueueManager.syncCurrentVolume();
  }
  if (window.recordingsManager && typeof window.recordingsManager.syncVolumeWithHotspot === "function") {
    window.recordingsManager.syncVolumeWithHotspot();
  }
  updateHotspotVolumeAndMuteUI(cid);
}

export function isHotspotAudioBoosted(hid) {
  const cid = resolveHotspotId(hid);
  return localStorage.getItem(`proxdmr_boost_${cid}`) === "true";
}

export function setHotspotAudioBoost(hid, enabled) {
  const cid = resolveHotspotId(hid);
  const boolVal = Boolean(enabled);
  localStorage.setItem(`proxdmr_boost_${cid}`, boolVal ? "true" : "false");
  if (window.audioPlayer && typeof window.audioPlayer.setHotspotVolume === "function") {
    const curVol = getHotspotVolume(cid);
    window.audioPlayer.setHotspotVolume(cid, curVol / 100.0);
  }
  updateHotspotVolumeAndMuteUI(cid);
}

export function toggleHotspotAudioBoost(hid) {
  const cid = resolveHotspotId(hid);
  const nextVal = !isHotspotAudioBoosted(cid);
  setHotspotAudioBoost(cid, nextVal);
  const hsList = (Array.isArray(window.currentHotspots) ? window.currentHotspots : []);
  const hsObj = hsList.find(h => resolveHotspotId(h.id) === cid) || null;
  const hsName = hsObj ? (hsObj.name || hsObj.id) : (cid === "default" ? (window.t ? window.t("hotspots.primary_hs_name", {}, "Main hotspot") : "Main hotspot") : cid);

  if (nextVal) {
    if (window.showToast) window.showToast(window.t ? window.t("audio.boost_on_toast", { name: hsName }, `⚡ [${hsName}] Volume Boost ON`) : `⚡ [${hsName}] Volume Boost ON`, 2500);
    if (navigator.vibrate) { try { navigator.vibrate([40, 60, 40]); } catch (_) {} }
  } else {
    if (window.showToast) window.showToast(window.t ? window.t("audio.boost_off_toast", { name: hsName }, `[${hsName}] Volume Boost OFF`) : `[${hsName}] Volume Boost OFF`, 2000);
    if (navigator.vibrate) { try { navigator.vibrate(30); } catch (_) {} }
  }
}

let _activeSoloHotspotId = null;
let _preSoloMuteStates = null;

try {
  const savedSolo = sessionStorage.getItem("proxdmr_active_solo_hs");
  const savedMutes = sessionStorage.getItem("proxdmr_pre_solo_mutes");
  if (savedSolo && savedMutes) {
    _activeSoloHotspotId = savedSolo;
    _preSoloMuteStates = JSON.parse(savedMutes);
  }
} catch (_) {}

export function isHotspotSoloActive(hid = null) {
  if (hid) {
    const cid = resolveHotspotId(hid);
    return _activeSoloHotspotId === cid;
  }
  return Boolean(_activeSoloHotspotId);
}

export function getActiveSoloHotspotId() {
  return _activeSoloHotspotId;
}

export function toggleHotspotSoloAudio(hid) {
  const cid = resolveHotspotId(hid);
  const currentHotspots = getCurrentHotspots();
  const hsName = getHotspotDisplayName(cid);

  // If this hotspot is ALREADY solo, repeat long press exits solo and restores previous mute states
  if (_activeSoloHotspotId === cid) {
    exitSoloAudio(true);
    return;
  }

  // If no solo was active, save snapshot of all current mute states
  if (!_activeSoloHotspotId || !_preSoloMuteStates) {
    _preSoloMuteStates = {};
    (currentHotspots || []).forEach(h => {
      const hcid = resolveHotspotId(h.id);
      _preSoloMuteStates[hcid] = isHotspotAudioMuted(hcid);
    });
    try {
      sessionStorage.setItem("proxdmr_pre_solo_mutes", JSON.stringify(_preSoloMuteStates));
      sessionStorage.setItem("proxdmr_active_solo_hs", cid);
    } catch (_) {}
  }

  _activeSoloHotspotId = cid;

  // Unmute target solo hotspot
  setHotspotAudioMute(cid, false, true);

  // Mute all OTHER active hotspots
  (currentHotspots || []).forEach(h => {
    const hcid = resolveHotspotId(h.id);
    if (hcid !== cid) {
      setHotspotAudioMute(hcid, true, true);
    }
  });

  updateAllVolumeAndMuteUI();

  if (window.showToast) {
    window.showToast(window.t ? window.t("audio.solo_on_toast", { name: hsName }, `🎯 [${hsName}] SOLO mode ON (other hotspots muted)`) : `🎯 [${hsName}] SOLO mode ON`, 2500);
  }
  if (navigator.vibrate) {
    try { navigator.vibrate([60, 40, 60]); } catch (_) {}
  }
}

export function exitSoloAudio(showNotification = true) {
  if (!_activeSoloHotspotId && !_preSoloMuteStates) return;

  const soloCid = _activeSoloHotspotId;
  const hsName = soloCid ? getHotspotDisplayName(soloCid) : (window.t ? window.t("hotspots.generic_name", {}, "hotspot") : "hotspot");

  let snapshot = _preSoloMuteStates;
  if (!snapshot) {
    try {
      const saved = sessionStorage.getItem("proxdmr_pre_solo_mutes");
      if (saved) snapshot = JSON.parse(saved);
    } catch (_) {}
  }

  if (snapshot) {
    Object.keys(snapshot).forEach(hcid => {
      setHotspotAudioMute(hcid, Boolean(snapshot[hcid]), true);
    });
  }

  _activeSoloHotspotId = null;
  _preSoloMuteStates = null;
  try {
    sessionStorage.removeItem("proxdmr_pre_solo_mutes");
    sessionStorage.removeItem("proxdmr_active_solo_hs");
  } catch (_) {}

  updateAllVolumeAndMuteUI();

  if (showNotification && window.showToast) {
    window.showToast(window.t ? window.t("audio.solo_off_toast", { name: hsName }, `[${hsName}] SOLO mode OFF (original audio settings restored)`) : `[${hsName}] SOLO mode OFF`, 2000);
  }
  if (navigator.vibrate) {
    try { navigator.vibrate(40); } catch (_) {}
  }
}

export function bindMuteButtonLongPress(btn, getCid) {
  if (!btn || btn._hasMuteLongPress) return;
  btn._hasMuteLongPress = true;

  let pressTimer = null;
  let isLongPressTriggered = false;
  let startX = 0;
  let startY = 0;

  const startPress = (e) => {
    isLongPressTriggered = false;
    startX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
    startY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      isLongPressTriggered = true;
      const cid = typeof getCid === "function" ? getCid() : getCid;
      toggleHotspotSoloAudio(cid);
    }, 600);
  };

  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  const movePress = (e) => {
    if (!pressTimer) return;
    const curX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
    const curY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
    if (Math.abs(curX - startX) > 10 || Math.abs(curY - startY) > 10) {
      cancelPress();
    }
  };

  btn.addEventListener("pointerdown", startPress);
  btn.addEventListener("pointermove", movePress);
  btn.addEventListener("pointerup", cancelPress);
  btn.addEventListener("pointercancel", cancelPress);
  btn.addEventListener("contextmenu", (e) => {
    if (isLongPressTriggered) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // Intercept click: if triggered by long press, prevent toggleMute from firing!
  btn.addEventListener("click", (e) => {
    if (isLongPressTriggered) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      isLongPressTriggered = false;
    }
  }, true);
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

  // Check for double click/tap (within 350ms on the same hotspot button) -> TOGGLE BOOST!
  if (lastMuteClickHid === cid && (now - lastMuteClickTime) < 350) {
    if (muteClickTimer) {
      clearTimeout(muteClickTimer);
      muteClickTimer = null;
    }
    lastMuteClickTime = 0;
    lastMuteClickHid = null;
    justDoubleClicked = true;
    setTimeout(() => { justDoubleClicked = false; }, 500);

    toggleHotspotAudioBoost(cid);
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
  const cid = resolveHotspotId(hid);
  toggleHotspotAudioBoost(cid);
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
      const isPrimary = isPrimaryDefaultAlias(cid, currentHotspots);
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
      ap.setVolume(1.0);
    }

    updateHotspotVolumeAndMuteUI(null);
  } else {
    localStorage.setItem(`proxdmr_vol_${cid}`, num.toString());
    const isPrimary = isPrimaryDefaultAlias(cid, currentHotspots);
    if (isPrimary) {
      localStorage.setItem("proxdmr_vol_default", num.toString());
      localStorage.setItem("proxdmr_volume", num.toString());
    }
    if (ap && ap.setHotspotVolume) {
      ap.setHotspotVolume(cid, num / 100.0);
      if (isPrimary && cid !== "default") {
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

  // Sync all UI checkboxes and live client RX AGC engine
  document.querySelectorAll(".agc-toggle").forEach(chk => {
    chk.checked = boolVal;
  });
  const mainAgc = document.getElementById("agcToggle");
  if (mainAgc) mainAgc.checked = boolVal;
  const rxAgcChk = document.getElementById("chkAgcEnable");
  if (rxAgcChk) rxAgcChk.checked = boolVal;
  const ap = getAudioPlayer();
  if (ap && typeof ap.setRxAgcConfig === "function") {
    ap.setRxAgcConfig({ enabled: boolVal });
  }
  scheduleSyncClientSettings(0);
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
  const hs = (currentHotspots || []).find(h => String(h.id) === cid || String(h.id) === String(hid));
  const visibleHotspots = (currentHotspots || []).filter(h => !h.hidden);
  const visibleIdx = visibleHotspots.findIndex(h => String(h.id) === cid || String(h.id) === String(hid));
  if (hs) {
    if (typeof hs.collapsed === "boolean") return hs.collapsed;
    return visibleIdx >= 0 ? (visibleIdx > 0) : true;
  }
  const local = localStorage.getItem(`proxdmr_collapsed_${cid}`);
  if (local !== null) {
    return local === "true";
  }
  const active = (currentHotspots || []).filter(h => !h.hidden);
  return !(active[0] && (String(active[0].id) === cid || String(active[0].id) === String(hid)));
}

export function isHotspotLiveCollapsed(hid) {
  if (!hid) return false;
  const cid = resolveHotspotId(hid);
  return localStorage.getItem(`proxdmr_live_collapsed_${cid}`) === "true";
}

export function closeLogIfOpenForHotspot(hid, options = {}) {
  if (typeof window === "undefined" || !window.isLogVisible) {
    return false;
  }
  const currentHotspots = getCurrentHotspots();
  const cid = resolveHotspotId(hid);
  const isDefaultAlias = isPrimaryDefaultAlias(cid, currentHotspots);
  let card = options.card || null;
  if (!card && typeof document !== "undefined") {
    const rc = document.getElementById("radioContainer");
    const rcMatch = rc && (!rc.dataset.hotspotId || rc.dataset.hotspotId === cid || (isDefaultAlias && rc.dataset.hotspotId === "default")) ? rc : null;
    card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) || rcMatch;
  }

  const curLogHid = window.currentLogHotspotId;
  const isMobile = typeof window.innerWidth === "number" && window.innerWidth <= 768;
  const isAllDesktop = !isMobile && curLogHid === "all";
  const fallbackActiveHid = options.previousActiveHotspotId !== undefined ? options.previousActiveHotspotId : getActiveHotspotId();
  const effectiveLogHid = (isMobile && (!curLogHid || curLogHid === "all"))
    ? (fallbackActiveHid || ((currentHotspots || []).find(h => !h.hidden) || {}).id || "default")
    : curLogHid;

  const remainingOpen = (currentHotspots || []).filter(h => !h.hidden && resolveHotspotId(h.id) !== cid && !isHotspotCollapsed(h.id));
  const isCardLogActive = Boolean(!isAllDesktop && card && card.querySelector(".btn-log-drawer.active"));
  const isLogForThisHotspot = !isAllDesktop && (
    Boolean(curLogHid && curLogHid !== "all" && resolveHotspotId(curLogHid) === cid) ||
    Boolean(effectiveLogHid && effectiveLogHid !== "all" && resolveHotspotId(effectiveLogHid) === cid) ||
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
    return true;
  }

  if (!options.skipRefreshIfKeptOpen && typeof window.updateLogVisibility === "function") {
    window.updateLogVisibility(false);
  }
  return false;
}

export async function collapseHotspot(hid, options = {}) {
  const isLive = Boolean(options && options.isLive);
  const currentHotspots = getCurrentHotspots();
  const activeHotspotId = getActiveHotspotId();
  const cid = resolveHotspotId(hid);
  const isDefaultAlias = isPrimaryDefaultAlias(cid, currentHotspots);
  const rc = document.getElementById("radioContainer");
  const rcMatch = rc && (!rc.dataset.hotspotId || rc.dataset.hotspotId === cid || (isDefaultAlias && rc.dataset.hotspotId === "default")) ? rc : null;
  const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) || rcMatch;
  if (!card) return;

  const now = Date.now();
  if (typeof window !== "undefined") {
    window._lastHotspotCollapseActionTimes = window._lastHotspotCollapseActionTimes || {};
    window._lastHotspotCollapseActionTimes[cid] = now;
    if (isDefaultAlias) {
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
    // - BM/YSF/ASL не отключается
    // - живой звук эфира (audioPlayer) не глушится
    // - если у этого хотспота была открыта История (#liveMonitorPanel), она закрывается
    // ═══════════════════════════════════════════════════════════════════
    card.classList.add("collapsed", "live-collapsed");
    localStorage.setItem(`proxdmr_collapsed_${cid}`, "true");
    if (isDefaultAlias) {
      localStorage.setItem("proxdmr_collapsed_default", "true");
      localStorage.setItem("proxdmr_live_collapsed_default", "true");
    }
    localStorage.setItem(`proxdmr_live_collapsed_${cid}`, "true");

    const btn = card.querySelector(".hotspot-collapse-btn");
    if (btn) btn.title = window.t ? window.t("hotspots.expand_bg_title", {}, "Развернуть этот хотспот (работает в фоне)") : "Развернуть этот хотспот (работает в фоне)";

    const hs = (currentHotspots || []).find(h => resolveHotspotId(h.id) === cid || String(h.id) === cid || (isDefaultAlias && h.id === "default"));
    if (hs) {
      hs.collapsed = true;
      hs.isLiveCollapsed = true;
    }

    const nameBadge = card.querySelector(".hotspot-name-badge");
    if (nameBadge && hs && (hs.status === "ONLINE" || hs.status === "CONNECTING")) {
      nameBadge.classList.add("is-online");
    }

    renderHotspotsList();
    renderHotspotSelect();
    closeLogIfOpenForHotspot(cid, {
      card,
      previousActiveHotspotId: activeHotspotId,
      skipRefreshIfKeptOpen: true
    });
    if (typeof window !== "undefined" && typeof window.syncCollapsedHotspotStacks === "function") {
      window.syncCollapsedHotspotStacks();
    }
    if (typeof window !== "undefined" && typeof window.renderToolbarHotspotSlots === "function") {
      window.renderToolbarHotspotSlots();
    }
    if (typeof window !== "undefined" && window.isLogVisible && typeof window.updateLogVisibility === "function") {
      window.updateLogVisibility(false);
    }

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
  if (isDefaultAlias) {
    localStorage.setItem("proxdmr_collapsed_default", "true");
    localStorage.setItem("proxdmr_live_collapsed_default", "false");
  }
  localStorage.setItem(`proxdmr_live_collapsed_${cid}`, "false");
  const btn = card.querySelector(".hotspot-collapse-btn");
  if (btn) {
    btn.title = (typeof window !== "undefined" && window.t)
      ? window.t("vfo.hotspot_expand_title", {}, "Развернуть этот хотспот (удержание: отправить в архив)")
      : "Развернуть этот хотспот (удержание: отправить в архив)";
  }

  const nameBadge = card.querySelector(".hotspot-name-badge");
  if (nameBadge) {
    nameBadge.classList.remove("is-online");
  }

  // 4. Update local hotspot state to DISCONNECTED
  const collapsedTxt = (typeof window !== "undefined" && window.t)
    ? window.t("status.bm_collapsed_detail", {}, "Collapsed / disconnected")
    : "Collapsed / disconnected";
  const hs = (currentHotspots || []).find(h => resolveHotspotId(h.id) === cid || h.id === cid);
  if (hs) {
    hs.collapsed = true;
    hs.isLiveCollapsed = false;
    hs.isManualBmDisconnect = true;
    hs.status = "DISCONNECTED";
    hs.detail = collapsedTxt;
  }
  if (typeof window !== "undefined" && typeof window.updateBmStatus === "function") {
    window.updateBmStatus("DISCONNECTED", collapsedTxt, cid);
  }
  renderHotspotsList();
  renderHotspotSelect();
  closeLogIfOpenForHotspot(cid, {
    card,
    previousActiveHotspotId: activeHotspotId,
    skipRefreshIfKeptOpen: true
  });
  if (typeof window !== "undefined" && typeof window.syncCollapsedHotspotStacks === "function") {
    window.syncCollapsedHotspotStacks();
  }

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

  // If active hotspot was collapsed, switch active to another open non-archived hotspot
  if (cid === activeHotspotId) {
    const nextOpen = (currentHotspots || []).find(h => !h.hidden && resolveHotspotId(h.id) !== cid && !isHotspotCollapsed(h.id));
    if (nextOpen) {
      switchActiveHotspot(nextOpen.id);
    }
  }

  // 6. Если История осталась открыта (принадлежит другому HS или это режим «Все хотспоты» на ПК), обновляем геометрию после переключения активного HS.
  if (typeof window !== "undefined" && window.isLogVisible) {
    closeLogIfOpenForHotspot(cid, {
      card,
      previousActiveHotspotId: activeHotspotId
    });
  }
  if (typeof window !== "undefined" && typeof window.renderToolbarHotspotSlots === "function") {
    window.renderToolbarHotspotSlots();
  }
  scheduleSyncClientSettings();
}

export async function expandHotspot(hid, options = {}) {
  const currentHotspots = getCurrentHotspots();
  const cid = resolveHotspotId(hid);
  const isDefaultAlias = isPrimaryDefaultAlias(cid, currentHotspots);
  const rc = document.getElementById("radioContainer");
  const rcMatch = rc && (!rc.dataset.hotspotId || rc.dataset.hotspotId === cid || (isDefaultAlias && rc.dataset.hotspotId === "default")) ? rc : null;
  const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) || rcMatch;
  if (!card) return;

  const force = Boolean(options && options.force);
  const lastAction = (!force && typeof window !== "undefined" && window._lastHotspotCollapseActionTimes && (window._lastHotspotCollapseActionTimes[cid] || (isDefaultAlias ? window._lastHotspotCollapseActionTimes["default"] : 0))) || 0;
  if (!force && (Date.now() - lastAction < 600)) {
    console.warn(`[COLLAPSE] Prevented rapid auto-expand for ${cid} (${Date.now() - lastAction}ms since last action)`);
    return;
  }

  const now = Date.now();
  if (typeof window !== "undefined") {
    window._lastHotspotCollapseActionTimes = window._lastHotspotCollapseActionTimes || {};
    window._lastHotspotCollapseActionTimes[cid] = now;
    if (isDefaultAlias) {
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
  if (isDefaultAlias) {
    localStorage.setItem("proxdmr_collapsed_default", "false");
    localStorage.setItem("proxdmr_live_collapsed_default", "false");
  }
  localStorage.setItem(`proxdmr_live_collapsed_${cid}`, "false");
  const btn = card.querySelector(".hotspot-collapse-btn");
  if (btn) btn.title = (typeof window !== "undefined" && window.t) ? window.t("vfo.hotspot_collapse_title") : "Свернуть этот хотспот (удержание: свернуть без отключения)";

  const hs = (currentHotspots || []).find(h => String(h.id) === cid) || (isDefaultAlias ? (currentHotspots || [])[0] : null);
  if (hs) {
    hs.collapsed = false;
    hs.isLiveCollapsed = false;
    hs.isManualBmDisconnect = false;
    const expNet = (hs.network_type || "").toLowerCase();
    if (expNet === "adn" && typeof window !== "undefined" && typeof window.refreshAdnServers === "function") {
      window.refreshAdnServers(false);
    } else if (expNet === "dmrplus" && typeof window !== "undefined" && typeof window.refreshDmrPlusServers === "function") {
      window.refreshDmrPlusServers(false);
    }
  }
  switchActiveHotspot(cid);
  renderHotspotsList();
  renderHotspotSelect();
  if (typeof window !== "undefined" && typeof window.syncCollapsedHotspotStacks === "function") {
    window.syncCollapsedHotspotStacks();
  }
  if (typeof window !== "undefined" && typeof window.renderToolbarHotspotSlots === "function") {
    window.renderToolbarHotspotSlots();
  }

  if (wasLive) {
    // If it was already live in background (or demo mode), it's already connected to BM!
    const nameBadge = card.querySelector(".hotspot-name-badge");
    if (nameBadge && hs && hs.status === "ONLINE") {
      nameBadge.classList.add("is-online");
    }
    const wasMuted = localStorage.getItem(`proxdmr_pre_collapse_mute_${cid}`) === "1";
    setHotspotAudioMute(cid, wasMuted);
    updateHotspotVolumeAndMuteUI(cid);
    if (typeof window !== "undefined" && typeof window.updateHotspotCardMuteUI === "function") {
      window.updateHotspotCardMuteUI(cid, card);
    }
    if (typeof window !== "undefined" && typeof window.renderToolbarHotspotSlots === "function") {
      window.renderToolbarHotspotSlots();
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
  const isDefaultAlias = isPrimaryDefaultAlias(cid);
  const now = Date.now();
  const lastAction = (typeof window !== "undefined" && window._lastHotspotCollapseActionTimes && (window._lastHotspotCollapseActionTimes[cid] || (isDefaultAlias ? window._lastHotspotCollapseActionTimes["default"] : 0))) || 0;
  if (now - lastAction < 600 || now - lastCollapseToggleTime < 600 || isCollapseToggleBusy) {
    console.log(`[COLLAPSE] Ignored rapid toggle for ${hid} (throttled)`);
    return;
  }
  if (typeof window !== "undefined") {
    window._lastHotspotCollapseActionTimes = window._lastHotspotCollapseActionTimes || {};
    window._lastHotspotCollapseActionTimes[cid] = now;
    if (isDefaultAlias) {
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
  let cards = targetCid 
    ? document.querySelectorAll(`.radio-container[data-hotspot-id="${targetCid}"]`)
    : document.querySelectorAll(".radio-container");
  if ((!cards || cards.length === 0) && targetCid && isPrimaryDefaultAlias(targetCid)) {
    const rc = document.getElementById("radioContainer");
    if (rc && (!rc.dataset.hotspotId || rc.dataset.hotspotId === targetCid || rc.dataset.hotspotId === "default")) {
      cards = [rc];
    }
  }

  const globalMuted = isGlobalAudioMuted();
  const pttMuted = isPttAudioMuted();

  cards.forEach(card => {
    const cid = resolveHotspotId(card.dataset.hotspotId);
    const muteBtn = card.querySelector(".volume-mute-toggle");
    const slider = card.querySelector(".volume-slider");
    const valText = card.querySelector(".volume-val");

    const hsMuted = isHotspotAudioMuted(cid);
    const curVol = getHotspotVolume(cid);

    if (slider) {
      slider.max = 100;
      if (String(slider.value) !== String(curVol)) {
        slider.value = curVol;
      }
    }
    if (valText) {
      valText.textContent = `${curVol}%`;
    }

    const ratio = Math.max(0, Math.min(1, curVol / 100));
    const wrap = card.querySelector(".volume-slider-v-wrap");
    if (wrap) wrap.style.setProperty("--vol-ratio", ratio.toFixed(3));
    if (slider) slider.style.setProperty("--vol-ratio", ratio.toFixed(3));

    const strip = card.querySelector(".vertical-volume-strip");
    const isBoosted = isHotspotAudioBoosted(cid);
    if (strip) {
      strip.classList.toggle("vol-boosted", isBoosted);
      const boostNote = isBoosted ? " • ⚡ BOOST" : "";
      const syncNote = isSystemVolumeSyncEnabled() ? (window.t ? window.t("audio.vol_android_sync", {}, " • Привязано к системе Android") : " • Привязано к системе Android") : "";
      strip.title = window.t ? window.t("audio.vol_speaker_title", { vol: curVol, sync: `${boostNote}${syncNote}` }, `Громкость динамика: ${curVol}% (0% - 100%)${boostNote}${syncNote}`) : `Громкость динамика: ${curVol}% (0% - 100%)${boostNote}${syncNote}`;
    }

    if (muteBtn) {
      muteBtn.classList.remove("muted-channel", "muted-global", "muted-ptt", "is-solo-active");
      const isSolo = isHotspotSoloActive(cid);
      if (isSolo) {
        muteBtn.classList.add("is-solo-active");
      }

      if (globalMuted) {
        muteBtn.innerHTML = SVG_SPEAKER_MUTED;
        muteBtn.classList.add("muted-global");
        muteBtn.title = ((typeof window !== "undefined" && window.t) ? window.t("vfo.mute_all_active", {}, "ОБЩИЙ MUTE АКТИВЕН для всех хотспотов (клик для снятия)") : "ОБЩИЙ MUTE АКТИВЕН для всех хотспотов (клик для снятия)");
      } else if (pttMuted) {
        muteBtn.innerHTML = SVG_SPEAKER_MUTED;
        muteBtn.classList.add("muted-ptt");
        muteBtn.title = ((typeof window !== "undefined" && window.t) ? window.t("vfo.mute_tx_active", {}, "Общий MUTE активен на время передачи (PTT + 1с)") : "Общий MUTE активен на время передачи (PTT + 1с)");
      } else if (isSolo) {
        muteBtn.innerHTML = curVol < 30 ? SVG_SPEAKER_LOW : SVG_SPEAKER_HIGH;
        muteBtn.title = (typeof window !== "undefined" && window.t)
          ? window.t("audio.mute_solo_active_title", {}, "🎯 SOLO ACTIVE (hold: exit SOLO, double-click: Boost, click: Mute)")
          : "🎯 SOLO ACTIVE (hold: exit SOLO, double-click: Boost, click: Mute)";
      } else if (hsMuted || curVol === 0) {
        muteBtn.innerHTML = SVG_SPEAKER_MUTED;
        muteBtn.classList.add("muted-channel");
        muteBtn.title = curVol === 0
          ? ((typeof window !== "undefined" && window.t) ? window.t("audio.mute_vol_zero_title", {}, "Volume at zero (click: unmute, double-click: Boost, hold: Solo)") : "Volume at zero (click: unmute, double-click: Boost, hold: Solo)")
          : (_activeSoloHotspotId
              ? ((typeof window !== "undefined" && window.t) ? window.t("audio.mute_solo_muted_title", { name: getHotspotDisplayName(_activeSoloHotspotId) }, `Muted by SOLO [${getHotspotDisplayName(_activeSoloHotspotId)}] (click: unmute, hold: make Solo)`) : `Muted by SOLO [${getHotspotDisplayName(_activeSoloHotspotId)}]`)
              : ((typeof window !== "undefined" && window.t) ? window.t("audio.mute_off_title", {}, "Hotspot audio MUTED (click: unmute, double-click: Boost, hold: Solo)") : "Hotspot audio MUTED"));
      } else {
        muteBtn.innerHTML = curVol < 30 ? SVG_SPEAKER_LOW : SVG_SPEAKER_HIGH;
        muteBtn.title = (typeof window !== "undefined" && window.t)
          ? window.t("audio.mute_on_title", {}, "Mute this hotspot (click: Mute, double-click: Boost, hold: Solo)")
          : "Mute this hotspot (click: Mute, double-click: Boost, hold: Solo)";
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
    bindMuteButtonLongPress(volumeMuteToggle, () => {
      const card = volumeMuteToggle.closest(".radio-container");
      return (card && card.dataset.hotspotId) || getActiveHotspotId() || "default";
    });
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

  // Desktop mouse-wheel volume adjustment over any hotspot volume strip with full scroll interception
  if (typeof document !== "undefined" && typeof window !== "undefined" && !window._hasVolumeStripWheelListener) {
    window._hasVolumeStripWheelListener = true;
    document.addEventListener("wheel", (e) => {
      const targetEl = e.target && e.target.nodeType === 3 ? e.target.parentElement : e.target;
      const strip = targetEl && typeof targetEl.closest === "function"
        ? targetEl.closest(".vertical-volume-strip, .volume-slider-v-wrap, .volume-slider")
        : null;
      if (!strip) return;

      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }

      const dy = Number(e.deltaY) || 0;
      if (dy === 0) return;

      const step = e.shiftKey ? 1 : 2;
      const delta = dy < 0 ? step : -step;
      const card = strip.closest(".radio-container");
      const cid = resolveHotspotId((card && card.dataset && card.dataset.hotspotId) || getActiveHotspotId() || "default");
      const curVol = getHotspotVolume(cid);
      const nextVol = Math.max(0, Math.min(100, curVol + delta));
      if (nextVol !== curVol) {
        setHotspotVolume(cid, nextVol);
      }
    }, { passive: false, capture: true });
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

  // AGC (АРУ по НЧ) toggle in Audio RX settings
  const agcToggle = document.getElementById("agcToggle");
  if (agcToggle) {
    const initHid = (typeof window !== "undefined" && window.activeHotspotId) || "default";
    const agcActive = getHotspotAgc(initHid);
    agcToggle.checked = agcActive;
    agcToggle.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    agcToggle.addEventListener("change", () => {
      const hid = (typeof window !== "undefined" && window.activeHotspotId) || "default";
      setHotspotAgc(hid, agcToggle.checked);
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
  window.isPrimaryDefaultAlias = isPrimaryDefaultAlias;
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
  window.closeLogIfOpenForHotspot = closeLogIfOpenForHotspot;
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
    isPrimaryDefaultAlias,
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
    closeLogIfOpenForHotspot,
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
    onSystemVolumeChanged,
    isHotspotAudioBoosted,
    setHotspotAudioBoost,
    toggleHotspotAudioBoost,
    isHotspotSoloActive,
    getActiveSoloHotspotId,
    toggleHotspotSoloAudio,
    exitSoloAudio,
    bindMuteButtonLongPress
  });

  window.isHotspotAudioBoosted = isHotspotAudioBoosted;
  window.setHotspotAudioBoost = setHotspotAudioBoost;
  window.toggleHotspotAudioBoost = toggleHotspotAudioBoost;
  window.isHotspotSoloActive = isHotspotSoloActive;
  window.getActiveSoloHotspotId = getActiveSoloHotspotId;
  window.toggleHotspotSoloAudio = toggleHotspotSoloAudio;
  window.exitSoloAudio = exitSoloAudio;
  window.bindMuteButtonLongPress = bindMuteButtonLongPress;
  window.updateAllVolumeAndMuteUI = updateAllVolumeAndMuteUI;
}
