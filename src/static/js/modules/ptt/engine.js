/**
 * ProxDMR - PTT Transmission Engine & PTT Lock Subsystem
 * Module: modules/ptt/engine.js
 */

import { getCountryInfo, updateFlagElement } from '../core/formatters.js';
import { updateAllHotspotRecUI } from '../audio/routing.js';
import { initAudio, applyTxDspSettings, startVuMeter, stopVuMeter, resetTxDsp, getVuState, ensureVuMeterLoop } from '../audio/dsp.js';
import { resolveHotspotId as _resolveHotspotId, getHotspotSlot as _getHotspotSlot } from '../core/state.js';
import { getHotspotTot, setHotspotTot, getHotspotPttMode, setHotspotPttMode, getHotspotRogerBeep, getHotspotRogerBeepPattern, playLocalRogerBeep, formatTotDuration, openTotConfigModal, closeTotConfigModal } from './tot.js';
import { triggerHaptic } from '../core/haptic.js';

let txStartTime = 0;
let totCountdownInterval = null;
let totRemainingSeconds = null;
let totActiveLimit = 60;

function getTotRemainingSeconds() {
  return totRemainingSeconds;
}

let txSilenceInterval = null;
const SILENCE_BURST_BYTES = 960; // 60ms @ 8000Hz 16-bit PCM = 480 samples = 960 bytes

export function isCheckMicOnTxEnabled() {
  return localStorage.getItem("proxdmr_check_mic_on_tx") !== "false";
}

export function setCheckMicOnTxEnabled(enabled, syncServer = true) {
  const boolVal = Boolean(enabled);
  localStorage.setItem("proxdmr_check_mic_on_tx", boolVal ? "true" : "false");
  const optChk = document.getElementById("optCheckMicOnTx");
  if (optChk && optChk.checked !== boolVal) {
    optChk.checked = boolVal;
  }
  if (syncServer) {
    try {
      fetch("/api/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ check_mic_on_tx: boolVal })
      }).catch(() => {});
    } catch (_) {}
    if (typeof window !== "undefined" && window.ws && window.ws.readyState === WebSocket.OPEN) {
      try {
        window.ws.send(JSON.stringify({ type: "set_check_mic_on_tx", enabled: boolVal }));
      } catch (_) {}
    }
    if (typeof window !== "undefined" && typeof window.scheduleSyncClientSettings === "function") {
      window.scheduleSyncClientSettings();
    }
  }
}

export function ensureTxSilenceFallback() {
  const hasLiveMic = Boolean(window.micStream && window.micStream.getAudioTracks().some(t => t.readyState === "live"));
  if (!hasLiveMic && !txSilenceInterval) {
    const silenceChunk = new Uint8Array(SILENCE_BURST_BYTES);
    txSilenceInterval = setInterval(() => {
      if (window.isPttPressed && window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(silenceChunk);
      } else {
        stopTxSilenceFallback();
      }
    }, 60);
  }
}

export function stopTxSilenceFallback() {
  if (txSilenceInterval) {
    clearInterval(txSilenceInterval);
    txSilenceInterval = null;
  }
}

function _switchActiveHotspot(hid) {
  if (typeof window !== "undefined" && typeof window.switchActiveHotspot === "function") {
    window.switchActiveHotspot(hid);
  }
}

function _getHotspotLoop(hid) {
  if (typeof window !== "undefined" && typeof window.getHotspotLoop === "function") {
    return window.getHotspotLoop(hid);
  }
  return false;
}

function _getHotspotTg(hid, slot = null) {
  if (typeof window !== "undefined" && typeof window.getHotspotTg === "function") {
    return window.getHotspotTg(hid, slot);
  }
  const id = hid || (typeof window !== "undefined" && window.activeHotspotId) || "default";
  const unified = localStorage.getItem(`proxdmr_tg_${id}`) || localStorage.getItem("proxdmr_tg");
  if (unified) return parseInt(unified, 10);
  const s = parseInt(slot, 10) || 2;
  const saved = localStorage.getItem(`proxdmr_tg_${id}_ts${s}`) || localStorage.getItem(`proxdmr_tg_ts${s}`);
  return saved ? parseInt(saved, 10) : 2501;
}

function _getHotspotPttTarget(hid, slot = null) {
  if (typeof window !== "undefined" && typeof window.getHotspotPttTarget === "function") {
    return window.getHotspotPttTarget(hid, slot);
  }
  const id = hid || (typeof window !== "undefined" && window.activeHotspotId) || "default";
  const savedTarget = localStorage.getItem(`proxdmr_ptt_target_${id}`);
  if (savedTarget) {
    try {
      const parsed = JSON.parse(savedTarget);
      if (parsed && (parsed.type === "CALLER" || parsed.type === "ID") && parsed.id > 0) return parsed;
    } catch (e) {
      const val = parseInt(savedTarget, 10);
      if (!isNaN(val) && val > 999999) return { id: val, type: "CALLER" };
    }
  }
  const fallbackTg = _getHotspotTg(id, slot);
  return { id: fallbackTg, type: "TG" };
}

function _isMuteOnPttEnabled() {
  if (typeof window !== "undefined" && typeof window.isMuteOnPttEnabled === "function") {
    return window.isMuteOnPttEnabled();
  }
  return false;
}

function _updateAllVolumeAndMuteUI() {
  if (typeof window !== "undefined" && typeof window.updateAllVolumeAndMuteUI === "function") {
    window.updateAllVolumeAndMuteUI();
  }
}

function _updateCardTgDisplay(card) {
  if (typeof window !== "undefined" && typeof window.updateCardTgDisplay === "function") {
    window.updateCardTgDisplay(card);
  }
}

function _isVolumeUpPttEnabled() {
  return false;
}

function _isVolumeDownPttEnabled() {
  return false;
}

  // --- PTT Logic ---


  // --- PTT Lock Subsystem ---
  function triggerTactileVibrate(pattern = [50, 40, 50]) {
    try {
      triggerHaptic(pattern);
    } catch (_) {}
  }

  function blinkPttLocked(btnEl) {
    triggerTactileVibrate([60, 50, 60]);
    if (!btnEl) {
      const activeCard = document.querySelector(`.radio-container[data-hotspot-id="${_resolveHotspotId(window.activeHotspotId)}"]`);
      btnEl = activeCard ? activeCard.querySelector(".ptt-button") : document.querySelector(".ptt-button");
    }
    if (btnEl) {
      btnEl.classList.remove("ptt-locked-blink");
      void btnEl.offsetWidth;
      btnEl.classList.add("ptt-locked-blink");
      setTimeout(() => {
        if (btnEl) btnEl.classList.remove("ptt-locked-blink");
      }, 450);
    }
  }

  function isPttLocked(hid) {
  window.isPttLocked = isPttLocked;
    const cid = _resolveHotspotId(hid || window.activeHotspotId || "default");
    const val = localStorage.getItem("proxdmr_ptt_lock_" + cid);
    if (val !== null) return val === "true";
    if ((window.currentHotspots || []) && (window.currentHotspots || [])[0] && String((window.currentHotspots || [])[0].id) === String(cid)) {
      const defVal = localStorage.getItem("proxdmr_ptt_lock_default");
      if (defVal !== null) return defVal === "true";
    }
    return false;
  }

  function setPttLocked(hid, locked) {
    const cid = _resolveHotspotId(hid || window.activeHotspotId || "default");
    localStorage.setItem("proxdmr_ptt_lock_" + cid, locked ? "true" : "false");
    if ((window.currentHotspots || []) && (window.currentHotspots || [])[0] && String((window.currentHotspots || [])[0].id) === String(cid)) {
      localStorage.setItem("proxdmr_ptt_lock_default", locked ? "true" : "false");
    }
    updatePttLockUI(cid);
  }

  function togglePttLock(hid) {
    const cid = _resolveHotspotId(hid || window.activeHotspotId || "default");
    const nextState = !isPttLocked(cid);
    setPttLocked(cid, nextState);
    triggerTactileVibrate(nextState ? [70, 50, 70] : 45);
  }

  function updatePttLockUI(hid = null) {
  window.updatePttLockUI = updatePttLockUI;
    const targetCid = hid ? _resolveHotspotId(hid) : null;
    const cards = document.querySelectorAll(".radio-container");
    cards.forEach(card => {
      const cid = _resolveHotspotId(card.dataset.hotspotId || "default");
      if (targetCid && cid !== targetCid) return;
      const icon = card.querySelector(".ptt-lock-icon");
      if (icon) {
        if (isPttLocked(cid)) {
          icon.classList.add("locked");
        } else {
          icon.classList.remove("locked");
        }
      }
    });
  }
  
  window.isPttLocked = isPttLocked;
  window.togglePttLock = togglePttLock;
  window.updatePttLockUI = updatePttLockUI;
  window.blinkPttLocked = blinkPttLocked;
  let isTransmissionStarting = false;
  let cancelTransmissionStart = false;

  async function startTransmission(targetHotspotId = null, targetSlotParam = null) {
  window.startTransmission = startTransmission;
    if (window.isPttPressed || isTransmissionStarting) return;
    if (window.isSwl) {
      if (typeof window.showToast === "function") {
        const msg = window.t
          ? window.t("ptt.swl_denied_toast", {}, "🎧 Режим SWL: передача запрещена (только приём)")
          : "🎧 Режим SWL: передача запрещена (только приём)";
        window.showToast(msg, 3500);
      }
      return;
    }
    const checkHid = targetHotspotId || window.activeHotspotId;
    if (isPttLocked(checkHid)) {
      const card = document.querySelector(`.radio-container[data-hotspot-id="${_resolveHotspotId(checkHid)}"]`);
      const ptt = card ? card.querySelector(".ptt-button") : document.querySelector(".ptt-button");
      blinkPttLocked(ptt);
      return;
    }
    if (typeof window.isHotspotGwDisconnected === "function" && window.isHotspotGwDisconnected(checkHid)) {
      if (typeof window.showToast === "function") {
        window.showToast(window.t ? window.t("gw.status_offline_toast", {}, "⚠️ Шлюз этого хотспота отключен (GW:OFFLINE)") : "⚠️ Шлюз этого хотспота отключен (GW:OFFLINE)", 2500);
      }
      return;
    }

    isTransmissionStarting = true;
    cancelTransmissionStart = false;

    // Ensure audio pipeline and microphone worklet are active BEFORE activating PTT!
    // If microphone is disconnected, disabled, or blocked, abort transmission and alert user.
    let audioReady = false;
    try {
      audioReady = await initAudio();
    } catch (e) {
      console.warn("[TX] Audio pipeline error:", e);
    }

    try {
      if (cancelTransmissionStart) {
        console.log("[TX] Transmission cancelled before start (user released PTT)");
        return;
      }

      const checkMic = isCheckMicOnTxEnabled();
      const hasLiveMicTrack = Boolean(window.micStream && window.micStream.getAudioTracks().some(t => t.readyState === "live"));
      if (checkMic && (!audioReady || !window.workletNode || !hasLiveMicTrack)) {
        console.warn("[TX] Microphone unavailable or inactive. Aborting transmission.");
        if (typeof window.showToast === "function") {
          const msg = window.t
            ? window.t("ptt.mic_unavailable_toast", {}, "⚠️ Микрофон недоступен или отключен! Проверьте подключение и разрешения.")
            : "⚠️ Микрофон недоступен или отключен! Проверьте подключение и разрешения.";
          window.showToast(msg, 3500);
        }
        return;
      }

      const hid = targetHotspotId || window.activeHotspotId;
      if (hid && hid !== window.activeHotspotId) {
        _switchActiveHotspot(hid);
      }

      window.isPttPressed = true;
      window.activeTxHotspotId = hid;
      txStartTime = Date.now();
      updateAllHotspotRecUI();

      // Dismiss any active long-press rings if user started transmitting
      document.querySelectorAll(".long-press-ring").forEach(el => el.remove());

      // Pause recording playback if playing
      if (window.recordingsManager && typeof window.recordingsManager.isPlaying === "function" && window.recordingsManager.isPlaying()) {
        window.recordingsManager.pause();
      }

      if (totCountdownInterval) {
        clearInterval(totCountdownInterval);
        totCountdownInterval = null;
      }
      totActiveLimit = getHotspotTot(hid);
      totRemainingSeconds = totActiveLimit;

      const isLoop = Boolean(_getHotspotLoop(hid) || (document.getElementById("loopbackToggle") && document.getElementById("loopbackToggle").checked));

      // PTT Mute (+1s tail): Mute incoming audio immediately on PTT press if option is enabled (skip when Mic loop is active!)
      if (_isMuteOnPttEnabled() && !isLoop) {
        if (window.pttMuteReleaseTimer) {
          clearTimeout(window.pttMuteReleaseTimer);
          window.pttMuteReleaseTimer = null;
        }
        window.isPttMuteActive = true;
        if (window.audioPlayer && window.audioPlayer.setPttMuted) {
          window.audioPlayer.setPttMuted(true);
        }
        _updateAllVolumeAndMuteUI();
      }

      if (targetSlotParam === 1 || targetSlotParam === 2) {
        if (typeof window.setHotspotSlot === "function") {
          window.setHotspotSlot(targetSlotParam);
        }
      }
      const targetSlot = (targetSlotParam === 1 || targetSlotParam === 2) ? targetSlotParam : _getHotspotSlot(hid);
      const pttTarget = _getHotspotPttTarget(hid, targetSlot);
      const isCallerTarget = Boolean(pttTarget && (pttTarget.type === "CALLER" || pttTarget.type === "ID"));
      const targetTg = isCallerTarget ? pttTarget.id : _getHotspotTg(hid, targetSlot);

      const updateTxBadgeCountdown = (sec) => {
        const curHid = window.activeTxHotspotId || hid;
        const c = document.querySelector(`.radio-container[data-hotspot-id="${curHid}"]`);
        const b = c ? c.querySelector(".mode-badge") : (document.getElementById("modeBadge") || document.querySelector(".mode-badge"));
        const curSlot = _getHotspotSlot(curHid) || targetSlot || 2;
        if (b && window.isPttPressed) {
          b.className = "mode-badge mode-tx";
          b.textContent = `TX TS${curSlot} ${Math.max(0, sec)}s`;
        }
      };

      if (window.AndroidBridge && typeof window.AndroidBridge.updateRadioStatus === "function") {
        try {
          const hs = (window.currentHotspots || []).find(h => h.id === hid);
          const myCall = hs?.callsign || "ProxDMR";
          const isCallerTarget = (pttTarget && (pttTarget.type === "CALLER" || pttTarget.type === "ID"));
          window.AndroidBridge.updateRadioStatus(`TX: ${myCall} (TS${targetSlot} -> ${isCallerTarget ? 'ID' : 'TG'}${targetTg})`);
        } catch (err) {
          console.warn("[AndroidBridge] updateRadioStatus TX failed:", err);
        }
      }

      // Highlight PTT, mode badge and active transmitting TS row strictly on target card
      const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`);
      if (targetCard) {
        const p = targetCard.querySelector(".ptt-button");
        if (p) {
          p.classList.add("active");
          p.classList.remove("tx-slot-1", "tx-slot-2");
          p.classList.add(`tx-slot-${targetSlot}`);
        }
        if (typeof window.updateCardPttHintForSlot === "function") {
          window.updateCardPttHintForSlot(targetCard, targetSlot);
        }
        const mb = targetCard.querySelector(".mode-badge");
        if (mb) {
          mb.className = "mode-badge mode-tx";
          mb.textContent = `TX TS${targetSlot} ${totRemainingSeconds}s`;
        }
        const txRow = targetCard.querySelector(targetSlot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
        if (txRow) {
          txRow.classList.add("vfo-tx-active");
          const callerFlag = txRow.querySelector(".ts-caller-flag");
          const callerCall = txRow.querySelector(".ts-caller-call");
          const callerId = txRow.querySelector(".ts-caller-id");
          const callerCountry = txRow.querySelector(".ts-caller-country");
          const hs = (window.currentHotspots || []).find(h => h.id === hid);
          const myCall = hs?.callsign || "N0CALL";
          const myId = hs?.effective_id || hs?.dmr_id || 0;
          const myCountry = getCountryInfo(myId, myCall);

          if (callerFlag) updateFlagElement(callerFlag, myCountry);
          if (callerCall) callerCall.textContent = `${myCall} (TX)`;
          if (callerId) callerId.textContent = myId ? `(${myId})` : "";
          if (callerCountry) callerCountry.textContent = myCountry?.name_en || "";
        }
        if (targetSlot === 1) {
          const tx1 = targetCard.querySelector(".vfo-ts1-tx");
          if (tx1) tx1.classList.add("active");
        } else {
          const tx2 = targetCard.querySelector(".vfo-ts2-tx");
          if (tx2) tx2.classList.add("active");
        }
      }

      triggerTactileVibrate(50);

      totCountdownInterval = setInterval(() => {
        if (!window.isPttPressed) {
          if (totCountdownInterval) {
            clearInterval(totCountdownInterval);
            totCountdownInterval = null;
          }
          totRemainingSeconds = null;
          return;
        }
        totRemainingSeconds--;
        if (totRemainingSeconds > 0) {
          updateTxBadgeCountdown(totRemainingSeconds);
        } else {
          totRemainingSeconds = 0;
          updateTxBadgeCountdown(0);
          if (totCountdownInterval) {
            clearInterval(totCountdownInterval);
            totCountdownInterval = null;
          }
          const limitToReport = totActiveLimit;
          stopTransmission();
          if (typeof window.showToast === "function") {
            window.showToast(window.t ? window.t("ptt.tot_timeout_toast", { sec: limitToReport }, `⏱️ TOT: передача остановлена (${limitToReport} сек)`) : `⏱️ TOT: передача остановлена (${limitToReport} сек)`, 3500);
          }
          triggerTactileVibrate([150, 100, 150]);
        }
      }, 1000);

      const isPrivateCall = (pttTarget && (pttTarget.type === "CALLER" || pttTarget.type === "ID")) || (targetTg === 9990 || targetTg > 999999 || !!(window.USER_CALLSIGNS || {})[targetTg]);

      applyTxDspSettings();
      if (window.workletNode && window.workletNode.port) {
        window.workletNode.port.postMessage({ command: "set_active", active: true });
      }
      if (window.micStream) {
        window.micStream.getAudioTracks().forEach(t => { t.enabled = true; });
      }
      startVuMeter();

      // Fallback silence stream if transmitting without live microphone
      ensureTxSilenceFallback();

      if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
          type: "ptt_press",
          hotspot_id: hid,
          slot: targetSlot,
          tg: targetTg,
          call_type: isPrivateCall ? "PRIVATE" : "GROUP",
          loopback: isLoop
        }));
      }
    } finally {
      isTransmissionStarting = false;
    }
  }

  function stopTransmission() {
  window.stopTransmission = stopTransmission;
    if (isTransmissionStarting) {
      cancelTransmissionStart = true;
    }
    stopTxSilenceFallback();
    if (!window.isPttPressed) return;
    window.isPttPressed = false;
    const hid = window.activeTxHotspotId || window.activeHotspotId;
    window.activeTxHotspotId = null;
    updateAllHotspotRecUI();

    if (totCountdownInterval) {
      clearInterval(totCountdownInterval);
      totCountdownInterval = null;
    }
    totRemainingSeconds = null;

    if (window.workletNode && window.workletNode.port) {
      window.workletNode.port.postMessage({ command: "set_active", active: false });
    }
    // Note: We do NOT set track.enabled = false here. Toggling MediaStreamTrack.enabled
    // causes Chromium Bug 1238697 where MediaStreamAudioSourceNode permanently silences on
    // subsequent PTT cycles. Microphone privacy & gating is 100% enforced by window.isPttPressed
    // and worklet isActive = false.

    // PTT Mute release (+1s tail): Keep muted during transmission + 1 second after release
    if (_isMuteOnPttEnabled() && window.isPttMuteActive) {
      if (window.pttMuteReleaseTimer) {
        clearTimeout(window.pttMuteReleaseTimer);
      }
      window.pttMuteReleaseTimer = setTimeout(() => {
        window.isPttMuteActive = false;
        window.pttMuteReleaseTimer = null;
        if (window.audioPlayer && window.audioPlayer.setPttMuted) {
          window.audioPlayer.setPttMuted(false);
        }
        _updateAllVolumeAndMuteUI();
      }, 1000);
    }

    document.querySelectorAll(".ptt-button").forEach(b => b.classList.remove("active", "tx-slot-1", "tx-slot-2", "hover-slot-1", "hover-slot-2"));
    document.querySelectorAll(".radio-container").forEach(card => {
      if (typeof window.updateCardModeBadge === "function") {
        window.updateCardModeBadge(card);
      } else {
        const b = card.querySelector(".mode-badge");
        if (b) {
          b.className = "mode-badge mode-standby";
          b.textContent = "STANDBY";
        }
      }
    });
    // Fallback if not inside a .radio-container
    const fallbackMb = document.getElementById("modeBadge");
    if (fallbackMb && !fallbackMb.closest(".radio-container")) {
      fallbackMb.className = "mode-badge mode-standby";
      fallbackMb.textContent = "STANDBY";
    }
    document.querySelectorAll(".vfo-row").forEach(r => r.classList.remove("vfo-tx-active"));
    document.querySelectorAll(".vfo-tx-tag").forEach(t => t.classList.remove("active"));
    const activeCard = document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`);
    if (activeCard) {
      _updateCardTgDisplay(activeCard);
    }

    stopVuMeter();

    const txSlot = _getHotspotSlot(hid) || 1;
    const st = getVuState(hid, txSlot);
    st.mode = "IDLE";
    st.target = 0;
    ensureVuMeterLoop();

    if (window.AndroidBridge && typeof window.AndroidBridge.updateRadioStatus === "function") {
      try {
        window.AndroidBridge.updateRadioStatus(window.t ? window.t("gw.standby_status", {}, "Дежурный прием (Standby)") : "Дежурный прием (Standby)");
      } catch (err) {
        console.warn("[AndroidBridge] updateRadioStatus standby failed:", err);
      }
    }

    triggerTactileVibrate([25, 25, 25]);

    const rogerBeep = getHotspotRogerBeep(hid);
    const rogerBeepPattern = rogerBeep ? getHotspotRogerBeepPattern(hid) : "";

    if (rogerBeep) {
      playLocalRogerBeep(rogerBeepPattern);
    }

    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
      window.ws.send(JSON.stringify({
        type: "ptt_release",
        hotspot_id: hid,
        roger_beep: rogerBeep,
        roger_beep_pattern: rogerBeepPattern
      }));
    }
  }

  window.startTransmission = startTransmission;
  window.stopTransmission = stopTransmission;
  window.triggerHardwarePtt = function(isDown) {
    const hid = (typeof window !== "undefined" && window.activeHotspotId) || "default";
    if (isPttLocked(hid)) {
      if (isDown) {
        blinkPttLocked();
      }
      return;
    }
    const mode = getHotspotPttMode(hid);
    if (mode === "toggle") {
      if (isDown) {
        if (window.isPttPressed) {
          stopTransmission();
        } else {
          startTransmission(hid);
        }
      }
      return;
    }
    if (isDown) {
      if (!window.isPttPressed) {
        startTransmission(hid);
      }
    } else {
      if (window.isPttPressed) {
        stopTransmission();
      }
    }
  };
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.startTransmission = startTransmission;
  window.__proxdmr.stopTransmission = stopTransmission;
  window.__proxdmr.triggerHardwarePtt = window.triggerHardwarePtt;



export function initPttEngine() {
  // Keyboard Spacebar & Hardware/Headset Volume Up PTT (acts on active hotspot)
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.repeat && e.target.tagName !== "INPUT" && !document.querySelector(".modal.active")) {
      e.preventDefault();
      const hid = (typeof window !== "undefined" && window.activeHotspotId) || "default";
      if (isPttLocked(hid)) {
        blinkPttLocked();
        return;
      }
      const mode = getHotspotPttMode(hid);
      if (mode === "toggle") {
        if (window.isPttPressed) {
          stopTransmission();
        } else {
          startTransmission(hid);
        }
        return;
      }
      startTransmission(hid);
      return;
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space" && e.target.tagName !== "INPUT") {
      const hid = (typeof window !== "undefined" && window.activeHotspotId) || "default";
      const mode = getHotspotPttMode(hid);
      if (mode === "toggle") {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      stopTransmission();
      return;
    }
  });
}

export {
  triggerTactileVibrate,
  blinkPttLocked,
  isPttLocked,
  setPttLocked,
  togglePttLock,
  updatePttLockUI,
  getHotspotTot,
  setHotspotTot,
  getHotspotPttMode,
  setHotspotPttMode,
  formatTotDuration,
  getTotRemainingSeconds,
  openTotConfigModal,
  closeTotConfigModal,
  startTransmission,
  stopTransmission
};

if (typeof window !== "undefined") {
  window.triggerTactileVibrate = triggerTactileVibrate;
  window.blinkPttLocked = blinkPttLocked;
  window.isPttLocked = isPttLocked;
  window.setPttLocked = setPttLocked;
  window.togglePttLock = togglePttLock;
  window.updatePttLockUI = updatePttLockUI;
  window.getHotspotTot = getHotspotTot;
  window.setHotspotTot = setHotspotTot;
  window.getHotspotPttMode = getHotspotPttMode;
  window.setHotspotPttMode = setHotspotPttMode;
  window.formatTotDuration = formatTotDuration;
  window.getTotRemainingSeconds = getTotRemainingSeconds;
  window.openTotConfigModal = openTotConfigModal;
  window.closeTotConfigModal = closeTotConfigModal;
  window.startTransmission = startTransmission;
  window.stopTransmission = stopTransmission;
  window.isCheckMicOnTxEnabled = isCheckMicOnTxEnabled;
  window.setCheckMicOnTxEnabled = setCheckMicOnTxEnabled;
  window.ensureTxSilenceFallback = ensureTxSilenceFallback;
  window.stopTxSilenceFallback = stopTxSilenceFallback;
  window.initPttEngine = initPttEngine;

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.startTransmission = startTransmission;
  window.__proxdmr.stopTransmission = stopTransmission;
  window.__proxdmr.isCheckMicOnTxEnabled = isCheckMicOnTxEnabled;
  window.__proxdmr.setCheckMicOnTxEnabled = setCheckMicOnTxEnabled;
  window.__proxdmr.triggerHardwarePtt = window.triggerHardwarePtt;
  window.__proxdmr.getHotspotTot = getHotspotTot;
  window.__proxdmr.setHotspotTot = setHotspotTot;
  window.__proxdmr.getHotspotPttMode = getHotspotPttMode;
  window.__proxdmr.setHotspotPttMode = setHotspotPttMode;
  window.__proxdmr.formatTotDuration = formatTotDuration;
  window.__proxdmr.openTotConfigModal = openTotConfigModal;
  window.__proxdmr.ptt = {
    triggerTactileVibrate,
    blinkPttLocked,
    isPttLocked,
    setPttLocked,
    togglePttLock,
    updatePttLockUI,
    getHotspotTot,
    setHotspotTot,
    getHotspotPttMode,
    setHotspotPttMode,
    formatTotDuration,
    getTotRemainingSeconds,
    openTotConfigModal,
    closeTotConfigModal,
    startTransmission,
    stopTransmission,
    initPttEngine
  };
}
