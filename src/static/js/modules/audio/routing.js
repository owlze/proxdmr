/**
 * ProxDMR - Audio Routing, Timeslot Selective Muting & Stereo Panning Subsystem
 * Module: modules/audio/routing.js
 */

import { showToast } from '../core/toast.js';
import { resolveHotspotId as _resolveHotspotId, scheduleSyncClientSettings as _scheduleSyncClientSettings } from '../core/state.js';
import { triggerHaptic } from '../core/haptic.js';

function _getHotspotDisplayName(hid) {
  if (typeof window !== "undefined" && typeof window.getHotspotDisplayName === "function") {
    return window.getHotspotDisplayName(hid);
  }
  return String(hid);
}

function _getTranslation(key, params, fallback) {
  if (typeof window !== "undefined" && typeof window.t === "function") {
    return window.t(key, params, fallback);
  }
  return fallback;
}

// --- TTS Solo Mode Muted Tracking ---
export function getSoloMutedSet() {
  if (typeof window === "undefined") return new Set();
  if (window._ttsSoloMutedSlots instanceof Set) return window._ttsSoloMutedSlots;
  const s = new Set();
  try {
    const raw = localStorage.getItem("proxdmr_tts_solo_muted_slots");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) arr.forEach(k => s.add(k));
    }
  } catch (_) {}
  window._ttsSoloMutedSlots = s;
  return s;
}

export function saveSoloMutedSet(s) {
  if (typeof window === "undefined") return;
  window._ttsSoloMutedSlots = s;
  try {
    if (!s || s.size === 0) {
      localStorage.removeItem("proxdmr_tts_solo_muted_slots");
    } else {
      localStorage.setItem("proxdmr_tts_solo_muted_slots", JSON.stringify(Array.from(s)));
    }
  } catch (_) {}
}

// --- Timeslot Selective Muting (Per Hotspot) ---
export function getHotspotMute(hid, slot) {
  const s = parseInt(slot, 10) || 1;
  const cid = _resolveHotspotId(hid);

  // 1. Specific hotspot key
  const v = localStorage.getItem(`proxdmr_mute_${cid}_ts${s}`);
  if (v !== null) return v === "true";

  // 2. Backward compatibility fallback for the first / primary hotspot ONLY
  const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
  const isPrimary = (hsList && hsList[0] && String(hsList[0].id) === cid) || (cid === "default");
  if (isPrimary) {
    const vDef = localStorage.getItem(`proxdmr_mute_default_ts${s}`);
    if (vDef !== null) return vDef === "true";
    const vLeg = localStorage.getItem(`proxdmr_mute_ts${s}`);
    if (vLeg !== null) return vLeg === "true";
  }

  // Default: unmuted
  return false;
}

export function setHotspotMute(hid, slot, muted) {
  const s = parseInt(slot, 10) || 1;
  const cid = _resolveHotspotId(hid);
  const val = muted ? "true" : "false";

  // If a slot is unmuted (either manually by user or by restore), remove from Solo Mute tracking set
  if (!muted) {
    const soloSet = getSoloMutedSet();
    if (soloSet && soloSet.size > 0) {
      soloSet.delete(`${cid}_ts${s}`);
      soloSet.delete(`default_ts${s}`);
      const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
      const isPrimary = (hsList && hsList[0] && String(hsList[0].id) === cid) || (cid === "default");
      if (isPrimary && hsList && hsList[0] && hsList[0].id) {
        soloSet.delete(`${_resolveHotspotId(hsList[0].id)}_ts${s}`);
      }
      saveSoloMutedSet(soloSet);
    }
  }

  localStorage.setItem(`proxdmr_mute_${cid}_ts${s}`, val);
  const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
  const isPrimary = (hsList && hsList[0] && String(hsList[0].id) === cid) || (cid === "default");
  if (isPrimary) {
    localStorage.setItem(`proxdmr_mute_default_ts${s}`, val);
    localStorage.setItem(`proxdmr_mute_ts${s}`, val);
  }

  // Sync to server backend so headless mode & other clients can respect it
  if (typeof window !== "undefined" && window.ws && window.ws.readyState === WebSocket.OPEN) {
    try {
      window.ws.send(JSON.stringify({
        type: "set_slot_mute",
        hotspot_id: cid,
        slot: s,
        muted: !!muted
      }));
    } catch (err) {
      console.warn("[AUDIO] Failed to sync slot mute over WS:", err);
    }
  }

  // Update UI for this hotspot
  updateHotspotCardMuteUI(cid);

  // Apply mute directly to audio player if instance exists
  const ap = (typeof window !== "undefined" && (window.audioPlayer || (window.__proxdmr && window.__proxdmr.audioPlayer))) || null;
  if (ap) {
    if (typeof ap.setSlotMute === "function") {
      ap.setSlotMute(cid, s, muted);
      if (isPrimary) ap.setSlotMute("default", s, muted);
    }
    if (typeof ap.updateSlotMute === "function") {
      ap.updateSlotMute(cid, s, muted);
      if (isPrimary) ap.updateSlotMute("default", s, muted);
    }
  }

  if (typeof window !== "undefined" && window.ttsAudioQueueManager && typeof window.ttsAudioQueueManager.syncCurrentVolume === "function") {
    window.ttsAudioQueueManager.syncCurrentVolume();
  }

  _scheduleSyncClientSettings(1000);
}

export function toggleHotspotMute(hid, slot) {
  const s = parseInt(slot, 10) || 1;
  const cur = getHotspotMute(hid, s);
  setHotspotMute(hid, s, !cur);
}

export function syncAllSlotMutesToServer() {
  const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
  if (!hsList || hsList.length === 0) return;
  const mutes = [];
  hsList.forEach(hs => {
    const cid = _resolveHotspotId(hs.id);
    mutes.push({ hotspot_id: cid, slot: 1, muted: getHotspotMute(cid, 1) });
    mutes.push({ hotspot_id: cid, slot: 2, muted: getHotspotMute(cid, 2) });
  });
  if (typeof window !== "undefined" && window.ws && window.ws.readyState === WebSocket.OPEN) {
    try {
      window.ws.send(JSON.stringify({ type: "sync_slot_mutes", mutes }));
    } catch (err) {
      console.warn("[AUDIO] Failed to sync all slot mutes over WS:", err);
    }
  }
}

function _triggerHaptic(ms = 40) {
  try {
    triggerHaptic(ms);
  } catch (_) {}
}

function _showPanToast(cid, slot, nextPan) {
  const panLabel = nextPan === "L"
    ? _getTranslation("vfo.pan_l_short", {}, "Левый (L)")
    : (nextPan === "R"
      ? _getTranslation("vfo.pan_r_short", {}, "Правый (R)")
      : _getTranslation("vfo.pan_lr_short", {}, "Стерео (L+R)"));
  const hsName = _getHotspotDisplayName(cid);
  const msg = (typeof window !== "undefined" && window.t)
    ? window.t("audio.pan_toast", { name: hsName, slot, pan: panLabel }, `🎧 [${hsName}] TS${slot}: Панорама — ${panLabel}`)
    : `🎧 [${hsName}] TS${slot}: Панорама — ${panLabel}`;
  showToast(msg, 1800);
}

export function renderMutePanBtnContent(btn, isMuted, panMode, slot) {
  if (!btn) return;
  const s = parseInt(slot, 10) || 1;
  const safePan = ["L", "R", "LR"].includes(panMode) ? panMode : "LR";
  btn.classList.toggle("muted", !!isMuted);
  btn.dataset.pan = safePan;
  btn.dataset.muted = isMuted ? "true" : "false";

  const spkIcon = isMuted ? "🔇" : "🔊";
  const lClass = safePan === "R" ? "inactive" : "active";
  const rClass = safePan === "L" ? "inactive" : "active";

  const panDesc = safePan === "L"
    ? _getTranslation("vfo.pan_mode_l", {}, "только левый")
    : (safePan === "R"
      ? _getTranslation("vfo.pan_mode_r", {}, "только правый")
      : _getTranslation("vfo.pan_mode_lr", {}, "оба канала"));
  const actionDesc = isMuted
    ? _getTranslation("vfo.action_unmute", {}, "включить звук")
    : _getTranslation("vfo.action_mute", {}, "заглушить");

  const panRowHint = _getTranslation("vfo.pan_row_hint", {}, "Удержание: переключение L / R / L+R");
  const panLHint = _getTranslation("vfo.pan_l_hint", {}, "Левый канал (L)");
  const panRHint = _getTranslation("vfo.pan_r_hint", {}, "Правый канал (R)");

  let tagL = btn.querySelector(".vfo-pan-tag.tag-l");
  let spkWrap = btn.querySelector(".vfo-mute-speaker-wrap");
  let tagR = btn.querySelector(".vfo-pan-tag.tag-r");

  if (tagL && spkWrap && tagR) {
    tagL.className = `vfo-pan-tag tag-l ${lClass}`;
    tagL.title = panLHint;
    spkWrap.textContent = spkIcon;
    spkWrap.title = actionDesc;
    tagR.className = `vfo-pan-tag tag-r ${rClass}`;
    tagR.title = panRHint;
  } else {
    btn.innerHTML = `
      <span class="vfo-pan-tag tag-l ${lClass}" data-pan-target="L" title="${panLHint}">L</span>
      <span class="vfo-mute-speaker-wrap" title="${actionDesc}">${spkIcon}</span>
      <span class="vfo-pan-tag tag-r ${rClass}" data-pan-target="R" title="${panRHint}">R</span>
    `;
  }

  btn.title = _getTranslation("vfo.mute_pan_combined_title", { slot: s, pan: panDesc, action: actionDesc },
    (window.t ? window.t("audio.pan_mode_hint", { slot: s, pan: panDesc, action: actionDesc }, `TS${s} [${panDesc}]: Клик — ${actionDesc}, удержание — переключение L / R / L+R`) : `TS${s} [${panDesc}]: Клик — ${actionDesc}, удержание — переключение L / R / L+R`));
}

export function setupMutePanButtonEvents(btn, card, slot) {
  if (!btn || btn._mutePanBound) return;
  btn._mutePanBound = true;
  const s = parseInt(slot, 10) || 1;

  btn.style.touchAction = "none";

  let pressTimer = null;
  let isLongPress = false;
  let lastLongPressTime = 0;
  let longPressResetTimer = null;
  let activePointerId = null;
  let startX = 0;
  let startY = 0;
  const LONG_PRESS_MS = 450;

  const getCid = () => {
    const parentCard = card || btn.closest(".radio-container");
    return _resolveHotspotId(parentCard && parentCard.dataset.hotspotId);
  };

  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    btn.classList.remove("vfo-mute-pressing");
    if (activePointerId !== null) {
      try { btn.releasePointerCapture(activePointerId); } catch (_) {}
      activePointerId = null;
    }
  };

  const startPress = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    isLongPress = false;
    if (longPressResetTimer) {
      clearTimeout(longPressResetTimer);
      longPressResetTimer = null;
    }
    startX = e.clientX || 0;
    startY = e.clientY || 0;
    activePointerId = e.pointerId !== undefined ? e.pointerId : null;
    if (activePointerId !== null) {
      try { btn.setPointerCapture(activePointerId); } catch (_) {}
    }
    btn.classList.add("vfo-mute-pressing");

    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      isLongPress = true;
      lastLongPressTime = Date.now();
      btn.classList.remove("vfo-mute-pressing");

      _triggerHaptic(40);
      const cid = getCid();
      const nextPan = cycleHotspotPan(cid, s);
      _showPanToast(cid, s, nextPan);
    }, LONG_PRESS_MS);
  };

  const movePress = (e) => {
    if (!pressTimer) return;
    const curX = e.clientX || 0;
    const curY = e.clientY || 0;
    const isTouch = e.pointerType === "touch" || (e.touches && e.touches.length > 0);
    const threshold = isTouch ? 36 : 14;
    if (Math.hypot(curX - startX, curY - startY) > threshold) {
      cancelPress();
    }
  };

  const endPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    btn.classList.remove("vfo-mute-pressing");
    if (activePointerId !== null) {
      try { btn.releasePointerCapture(activePointerId); } catch (_) {}
      activePointerId = null;
    }
    if (isLongPress) {
      if (longPressResetTimer) clearTimeout(longPressResetTimer);
      longPressResetTimer = setTimeout(() => {
        isLongPress = false;
      }, 1000);
    }
  };

  btn.addEventListener("pointerdown", startPress);
  btn.addEventListener("pointermove", movePress);
  btn.addEventListener("pointerup", endPress);
  btn.addEventListener("pointercancel", cancelPress);
  btn.addEventListener("pointerleave", () => {
    // If user is actively pressing, ignore pointerleave caused by CSS scale(0.93) or edge touch
    if (activePointerId !== null) return;
    cancelPress();
  });

  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const elapsed = Date.now() - lastLongPressTime;
    if (isLongPress || elapsed < 800) {
      // Long press already handled it! Prevent Android touch contextmenu collision
      return;
    }
    cancelPress();
    const cid = getCid();
    const nextPan = cycleHotspotPan(cid, s);
    _triggerHaptic(30);
    _showPanToast(cid, s, nextPan);
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const elapsed = Date.now() - lastLongPressTime;
    if (isLongPress || elapsed < 800) {
      isLongPress = false;
      if (longPressResetTimer) {
        clearTimeout(longPressResetTimer);
        longPressResetTimer = null;
      }
      return;
    }
    const cid = getCid();
    toggleHotspotMute(cid, s);
  });

  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const cid = getCid();
      toggleHotspotMute(cid, s);
    }
  });
}

export function updateCardMuteUI(card, hid) {
  if (!card) return;
  const cid = _resolveHotspotId(hid || card.dataset.hotspotId);
  const btn1 = card.querySelector(".btn-mute-ts1");
  const btn2 = card.querySelector(".btn-mute-ts2");

  if (btn1) {
    setupMutePanButtonEvents(btn1, card, 1);
    const cur1 = getHotspotMute(cid, 1);
    const pan1 = getHotspotPan(cid, 1);
    renderMutePanBtnContent(btn1, cur1, pan1, 1);
  }
  if (btn2) {
    setupMutePanButtonEvents(btn2, card, 2);
    const cur2 = getHotspotMute(cid, 2);
    const pan2 = getHotspotPan(cid, 2);
    renderMutePanBtnContent(btn2, cur2, pan2, 2);
  }
}

export function updateHotspotCardMuteUI(hid) {
  if (!hid) {
    const allCards = document.querySelectorAll(".radio-container");
    allCards.forEach(card => {
      const cid = _resolveHotspotId(card.dataset.hotspotId);
      updateCardMuteUI(card, cid);
    });
    return;
  }
  const cid = String(_resolveHotspotId(hid));
  const cards = document.querySelectorAll(`.radio-container[data-hotspot-id="${cid}"]`);
  if (cards.length > 0) {
    cards.forEach(card => updateCardMuteUI(card, cid));
  } else {
    const allCards = document.querySelectorAll(".radio-container");
    allCards.forEach(card => {
      const cardCid = String(_resolveHotspotId(card.dataset.hotspotId));
      if (cardCid === cid || (card.id === "radioContainer" && (cid === "default" || cid === String(_resolveHotspotId("default"))))) {
        updateCardMuteUI(card, cid);
      }
    });
  }
}

// --- Timeslot Stereo Panning (Per Hotspot & Per Slot: L / R / L+R) ---
export function getHotspotPan(hid, slot) {
  const s = parseInt(slot, 10) || 1;
  const cid = _resolveHotspotId(hid);
  if (typeof localStorage === "undefined") return "LR";
  const val = localStorage.getItem(`proxdmr_pan_${cid}_ts${s}`);
  if (val && ["L", "R", "LR"].includes(val)) return val;

  const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
  const isPrimary = (hsList && hsList[0] && String(hsList[0].id) === cid) || (cid === "default");
  if (isPrimary) {
    const vDef = localStorage.getItem(`proxdmr_pan_default_ts${s}`);
    if (vDef && ["L", "R", "LR"].includes(vDef)) return vDef;
  }
  return "LR";
}

export function setHotspotPan(hid, slot, mode) {
  const s = parseInt(slot, 10) || 1;
  const cid = _resolveHotspotId(hid);
  const safeMode = ["L", "R", "LR"].includes(mode) ? mode : "LR";

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(`proxdmr_pan_${cid}_ts${s}`, safeMode);
    const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
    const isPrimary = (hsList && hsList[0] && String(hsList[0].id) === cid) || (cid === "default");
    if (isPrimary) {
      localStorage.setItem(`proxdmr_pan_default_ts${s}`, safeMode);
    }
  }

  const ap = (typeof window !== "undefined" && (window.audioPlayer || (window.__proxdmr && window.__proxdmr.audioPlayer))) || null;
  if (ap) {
    const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
    const isPrimary = (hsList && hsList[0] && String(hsList[0].id) === cid) || (cid === "default");
    if (typeof ap.setSlotPan === "function") {
      ap.setSlotPan(cid, s, safeMode);
      if (isPrimary) ap.setSlotPan("default", s, safeMode);
    }
    if (typeof ap.updateSlotPan === "function") {
      ap.updateSlotPan(cid, s, safeMode);
      if (isPrimary) ap.updateSlotPan("default", s, safeMode);
    }
  }

  updateHotspotCardPanUI(cid);
  _scheduleSyncClientSettings(1000);
}

export function cycleHotspotPan(hid, slot) {
  const s = parseInt(slot, 10) || 1;
  const current = getHotspotPan(hid, s);
  const modes = ["L", "R", "LR"];
  const idx = modes.indexOf(current);
  const next = modes[(idx + 1) % modes.length];
  setHotspotPan(hid, s, next);
  return next;
}

export function getPanTitle(mode, slot) {
  const s = parseInt(slot, 10) || 1;
  if (mode === "L") {
    return _getTranslation("vfo.pan_title_l", { slot: s }, `Панорама TS${s}: Только ЛЕВЫЙ канал (нажмите для переключения)`);
  } else if (mode === "R") {
    return _getTranslation("vfo.pan_title_r", { slot: s }, `Панорама TS${s}: Только ПРАВЫЙ канал (нажмите для переключения)`);
  }
  return _getTranslation("vfo.pan_title_lr", { slot: s }, `Панорама TS${s}: Стерео Л+П (нажмите для переключения)`);
}

export function renderPanBtnContent(btn, mode) {
  if (!btn) return;
  const safeMode = mode === "L" || mode === "R" ? mode : "LR";
  btn.dataset.pan = safeMode;

  btn.classList.remove("pan-state-l", "pan-state-r", "pan-state-lr", "panning-side");
  if (safeMode === "L") {
    btn.classList.add("pan-state-l", "panning-side");
  } else if (safeMode === "R") {
    btn.classList.add("pan-state-r", "panning-side");
  } else {
    btn.classList.add("pan-state-lr");
  }

  btn.innerHTML = "";
  if (safeMode === "L") {
    const spanL = document.createElement("span");
    spanL.className = "pan-l active pan-single";
    spanL.textContent = "L";
    btn.appendChild(spanL);
  } else if (safeMode === "R") {
    const spanR = document.createElement("span");
    spanR.className = "pan-r active pan-single";
    spanR.textContent = "R";
    btn.appendChild(spanR);
  } else {
    const spanL = document.createElement("span");
    spanL.className = "pan-l active";
    spanL.textContent = "L";

    const sep = document.createElement("span");
    sep.className = "pan-sep";
    sep.textContent = "+";

    const spanR = document.createElement("span");
    spanR.className = "pan-r active";
    spanR.textContent = "R";

    btn.appendChild(spanL);
    btn.appendChild(sep);
    btn.appendChild(spanR);
  }
}

export function updateCardPanUI(card, hid) {
  if (!card) return;
  const cid = _resolveHotspotId(hid || card.dataset.hotspotId);

  // Synchronize mute/pan combined button indicators
  updateCardMuteUI(card, cid);

  const b1 = card.querySelector(".btn-pan-ts1");
  const b2 = card.querySelector(".btn-pan-ts2");
  const p1 = getHotspotPan(cid, 1);
  const p2 = getHotspotPan(cid, 2);

  if (b1) {
    renderPanBtnContent(b1, p1);
    b1.title = getPanTitle(p1, 1);
  }
  if (b2) {
    renderPanBtnContent(b2, p2);
    b2.title = getPanTitle(p2, 2);
  }
}

export function updateHotspotCardPanUI(hid) {
  if (!hid) {
    const allCards = document.querySelectorAll(".radio-container");
    allCards.forEach(card => {
      const cid = _resolveHotspotId(card.dataset.hotspotId);
      updateCardPanUI(card, cid);
    });
    return;
  }
  const cid = String(_resolveHotspotId(hid));
  const cards = document.querySelectorAll(`.radio-container[data-hotspot-id="${cid}"]`);
  if (cards.length > 0) {
    cards.forEach(card => updateCardPanUI(card, cid));
  } else {
    const allCards = document.querySelectorAll(".radio-container");
    allCards.forEach(card => {
      const cardCid = String(_resolveHotspotId(card.dataset.hotspotId));
      if (cardCid === cid || (card.id === "radioContainer" && (cid === "default" || cid === String(_resolveHotspotId("default"))))) {
        updateCardPanUI(card, cid);
      }
    });
  }
}

// --- Hotspot Audio Auto-Recording State & 3-State R Button ---
if (typeof window !== "undefined" && !window.activeRecordingHotspotIds) {
  window.activeRecordingHotspotIds = new Set();
}

export function updateCardRecUI(card, hid) {
  if (!card) return;
  const recBtn = card.querySelector(".header-rec-btn");
  if (!recBtn) return;

  const rawHid = hid || card.dataset.hotspotId || "default";
  const cid = _resolveHotspotId(rawHid);
  const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
  const hs = hsList.find(h => _resolveHotspotId(h.id) === cid) ||
             hsList.find(h => h.id === rawHid);

  // 1. Is auto_record enabled for this hotspot? (Default true if not set)
  const isAutoRecEnabled = hs ? (hs.auto_record !== false) : (localStorage.getItem("proxdmr_autorec_" + cid) !== "0");

  // 2. Is this hotspot actively recording audio?
  let isActivelyRecording = false;
  if (isAutoRecEnabled) {
    const activeIds = (typeof window !== "undefined" && window.activeRecordingHotspotIds) || new Set();
    const isPttActive = typeof window !== "undefined" && window.isPttPressed;
    const activeTxId = typeof window !== "undefined" && window.activeTxHotspotId;
    const activeHsId = typeof window !== "undefined" && window.activeHotspotId;

    if (activeIds && (activeIds.has(cid) || activeIds.has(rawHid) || (cid === _resolveHotspotId("default") && activeIds.has("default")))) {
      isActivelyRecording = true;
    } else if (isPttActive && _resolveHotspotId(activeTxId || activeHsId) === cid) {
      isActivelyRecording = true;
    } else if (card._lastRx) {
      const s1Active = card._lastRx[1] && card._lastRx[1].active;
      const s2Active = card._lastRx[2] && card._lastRx[2].active;
      if (s1Active || s2Active) {
        isActivelyRecording = true;
      }
    }
  }

  recBtn.classList.remove("rec-off", "rec-standby", "recording");

  if (!isAutoRecEnabled) {
    recBtn.classList.add("rec-off");
    const title = _getTranslation("recordings.rec_off_title", {}, "Автозапись TS1/2 выключена (клик: включить)");
    recBtn.title = title;
    recBtn.setAttribute("aria-label", title);
  } else if (isActivelyRecording) {
    recBtn.classList.add("recording");
    const title = _getTranslation("recordings.rec_active_title", {}, "Идет запись разговора...");
    recBtn.title = title;
    recBtn.setAttribute("aria-label", title);
  } else {
    recBtn.classList.add("rec-standby");
    const title = _getTranslation("recordings.rec_standby_title", {}, "Автозапись TS1/2 включена (ожидание вызова)");
    recBtn.title = title;
    recBtn.setAttribute("aria-label", title);
  }
}

export function updateHotspotCardRecUI(hid) {
  if (!hid) {
    if (typeof window !== "undefined" && typeof window.updatePttLockUI === "function") {
      window.updatePttLockUI();
    }
    updateAllHotspotRecUI();
    return;
  }
  const cid = _resolveHotspotId(hid);
  const cards = document.querySelectorAll(".radio-container");
  cards.forEach(card => {
    const cardCid = _resolveHotspotId(card.dataset.hotspotId);
    if (cardCid === cid || card.dataset.hotspotId === hid) {
      updateCardRecUI(card, cardCid);
    }
  });
}

export function updateAllHotspotRecUI() {
  const cards = document.querySelectorAll(".radio-container");
  cards.forEach(card => {
    const cid = _resolveHotspotId(card.dataset.hotspotId);
    updateCardRecUI(card, cid);
  });
}

export async function toggleHotspotAutoRecord(rawHid) {
  const cid = _resolveHotspotId(rawHid);
  const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
  const hs = hsList.find(h => _resolveHotspotId(h.id) === cid) ||
             hsList.find(h => h.id === rawHid);
  if (!hs) return;
  if (hs._isTogglingAutoRec) return;
  hs._isTogglingAutoRec = true;

  const currentVal = hs.auto_record !== false;
  const newVal = !currentVal;
  hs.auto_record = newVal;
  try {
    localStorage.setItem("proxdmr_autorec_" + cid, newVal ? "1" : "0");
  } catch (_) {}

  updateAllHotspotRecUI();
  if (typeof window !== "undefined" && typeof window.renderHotspotsList === "function") {
    const modal = document.getElementById("hotspotsModal");
    if (modal && modal.classList.contains("show")) {
      window.renderHotspotsList();
    }
  }

  const hsName = hs.name || _getHotspotDisplayName(cid);

  try {
    const res = await fetch(`/api/hotspots/${encodeURIComponent(cid)}/auto-record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: newVal })
    });
    if (res.ok) {
      const msg = newVal
        ? _getTranslation("recordings.toast_autorec_enabled", { name: hsName }, `✅ [${hsName}]: Автозапись включена`)
        : _getTranslation("recordings.toast_autorec_disabled", { name: hsName }, `⏸️ [${hsName}]: Автозапись выключена`);
      showToast(msg, 2500);
    } else {
      throw new Error(`Server returned ${res.status}`);
    }
  } catch (err) {
    console.error("Failed to toggle auto_record:", err);
    hs.auto_record = currentVal;
    try {
      localStorage.setItem("proxdmr_autorec_" + cid, currentVal ? "1" : "0");
    } catch (_) {}
    updateAllHotspotRecUI();
    showToast(window.t ? window.t("audio.autorec_err_toast", { name: hsName }, `⚠️ Ошибка сохранения настройки автозаписи для ${hsName}`) : `⚠️ Ошибка сохранения настройки автозаписи для ${hsName}`, 3000);
  } finally {
    hs._isTogglingAutoRec = false;
  }
}

export function initAudioRouting() {
  updateHotspotCardMuteUI();
  updateHotspotCardPanUI();

  const mainCard = document.getElementById("radioContainer");
  const btnMuteTs1 = document.getElementById("btnMuteTs1");
  const btnMuteTs2 = document.getElementById("btnMuteTs2");
  if (btnMuteTs1) {
    setupMutePanButtonEvents(btnMuteTs1, mainCard, 1);
  }
  if (btnMuteTs2) {
    setupMutePanButtonEvents(btnMuteTs2, mainCard, 2);
  }

  const btnPanTs1 = document.getElementById("btnPanTs1");
  const btnPanTs2 = document.getElementById("btnPanTs2");
  if (btnPanTs1) {
    btnPanTs1.onclick = (e) => {
      e.stopPropagation();
      const card = btnPanTs1.closest(".radio-container") || mainCard;
      const cid = _resolveHotspotId(card && card.dataset.hotspotId);
      cycleHotspotPan(cid, 1);
    };
  }
  if (btnPanTs2) {
    btnPanTs2.onclick = (e) => {
      e.stopPropagation();
      const card = btnPanTs2.closest(".radio-container") || mainCard;
      const cid = _resolveHotspotId(card && card.dataset.hotspotId);
      cycleHotspotPan(cid, 2);
    };
  }

  const masterRecBtnEl = document.getElementById("headerMasterRecBtn");
  if (masterRecBtnEl) {
    masterRecBtnEl.onclick = (e) => {
      e.stopPropagation();
      const rawHid = masterRecBtnEl.dataset.hotspotId || (masterRecBtnEl.closest(".radio-container") ? masterRecBtnEl.closest(".radio-container").dataset.hotspotId : "default");
      const cid = _resolveHotspotId(rawHid);
      toggleHotspotAutoRecord(cid);
    };
  }
}

// Global window registration for backward compatibility
if (typeof window !== "undefined") {
  window.getHotspotMute = getHotspotMute;
  window.setHotspotMute = setHotspotMute;
  window.toggleHotspotMute = toggleHotspotMute;
  window.syncAllSlotMutesToServer = syncAllSlotMutesToServer;
  window.renderMutePanBtnContent = renderMutePanBtnContent;
  window.setupMutePanButtonEvents = setupMutePanButtonEvents;
  window.updateCardMuteUI = updateCardMuteUI;
  window.updateHotspotCardMuteUI = updateHotspotCardMuteUI;
  window.getHotspotPan = getHotspotPan;
  window.setHotspotPan = setHotspotPan;
  window.cycleHotspotPan = cycleHotspotPan;
  window.getPanTitle = getPanTitle;
  window.renderPanBtnContent = renderPanBtnContent;
  window.updateCardPanUI = updateCardPanUI;
  window.updateHotspotCardPanUI = updateHotspotCardPanUI;
  window.updateCardRecUI = updateCardRecUI;
  window.updateHotspotCardRecUI = updateHotspotCardRecUI;
  window.updateAllHotspotRecUI = updateAllHotspotRecUI;
  window.getSoloMutedSet = getSoloMutedSet;
  window.saveSoloMutedSet = saveSoloMutedSet;
  window.toggleHotspotAutoRecord = toggleHotspotAutoRecord;
  window.initAudioRouting = initAudioRouting;

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.routing = {
    getHotspotMute,
    setHotspotMute,
    getSoloMutedSet,
    saveSoloMutedSet,
    toggleHotspotMute,
    syncAllSlotMutesToServer,
    renderMutePanBtnContent,
    setupMutePanButtonEvents,
    updateCardMuteUI,
    updateHotspotCardMuteUI,
    getHotspotPan,
    setHotspotPan,
    cycleHotspotPan,
    getPanTitle,
    renderPanBtnContent,
    updateCardPanUI,
    updateHotspotCardPanUI,
    updateCardRecUI,
    updateHotspotCardRecUI,
    updateAllHotspotRecUI,
    toggleHotspotAutoRecord,
    initAudioRouting
  };
}
