/**
 * ProxDMR - VFO Display & Timeslot / TG Selection Module
 * Handles per-card timeslot selection, VFO frequency/talkgroup display,
 * active RX status indications, hold times, and target ID/TG selection.
 */

import {
  getCountryInfo,
  updateFlagElement,
  getCleanTgDesc,
  adjustPttDescFontSize,
  renderTgTextHtml
} from "../core/formatters.js";

function getActiveHotspotId() {
  return (typeof window !== "undefined" && window.activeHotspotId) || "default";
}

function getActiveSlot() {
  return (typeof window !== "undefined" && typeof window.activeSlot === "number")
    ? window.activeSlot
    : 2;
}

function setActiveSlotState(s) {
  if (typeof window !== "undefined") {
    window.activeSlot = s;
  }
}

function getCurrentHotspots() {
  return (typeof window !== "undefined" && Array.isArray(window.currentHotspots))
    ? window.currentHotspots
    : [];
}

function getIsPttPressed() {
  return typeof window !== "undefined" && Boolean(window.isPttPressed);
}

function getWs() {
  return (typeof window !== "undefined" && window.ws) || null;
}

function getUserCallsigns() {
  return (typeof window !== "undefined" && window.USER_CALLSIGNS) || {};
}

function getTgNamesMap() {
  return (typeof window !== "undefined" && window.TG_NAMES) || {};
}

function updateActiveTgState(slot, tg) {
  if (typeof window !== "undefined") {
    if (slot === 1) window.tgTs1 = tg;
    else window.tgTs2 = tg;
  }
}

/**
 * Get active timeslot for a hotspot from localStorage or fallback
 * @param {string} [hid]
 * @returns {number} 1 or 2
 */
export function getHotspotSlot(hid) {
  const id = hid || getActiveHotspotId();
  const saved = localStorage.getItem(`proxdmr_slot_${id}`);
  return saved ? parseInt(saved, 10) : 2;
}

/**
 * Set active timeslot for a card
 * @param {HTMLElement} card
 * @param {number} slot
 * @param {boolean} [notifyServer=true]
 */
export function setCardSlot(card, slot, notifyServer = true) {
  if (!card) return;
  const activeHid = getActiveHotspotId();
  const cid = card.dataset.hotspotId || activeHid;
  const s = slot === 1 ? 1 : 2;
  card._activeSlot = s;
  localStorage.setItem(`proxdmr_slot_${cid}`, s.toString());

  // Standby indicator removed - both slots unhighlighted
  const vfo1 = card.querySelector(".vfo-ts1-row");
  const vfo2 = card.querySelector(".vfo-ts2-row");
  if (vfo1) vfo1.classList.remove("active-ptt-vfo");
  if (vfo2) vfo2.classList.remove("active-ptt-vfo");

  // Update PTT hint text on this card
  updateCardPttHint(card);

  if (cid === activeHid) {
    setActiveSlotState(s);
  }

  const ws = getWs();
  if (notifyServer && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "set_slot", hotspot_id: cid, slot: s }));
  }

  // When reading mode is active in the log, changing TS configuration on the transceiver card recalculates the text!
  if (typeof window !== "undefined" && window.isTranscriptionSummaryOpen && typeof window.renderTranscriptionSummary === "function") {
    if (typeof window.logFilter !== "undefined") window.logFilter = String(s);
    if (typeof window.syncLogFilterUI === "function") window.syncLogFilterUI();
    if (typeof window.renderLogList === "function") window.renderLogList();
    window.renderTranscriptionSummary();
  }
  if (typeof window !== "undefined" && typeof window.scheduleSyncClientSettings === "function") {
    window.scheduleSyncClientSettings();
  }
}

/**
 * Set active timeslot on active hotspot/card
 * @param {number} slot
 * @param {boolean} [notifyServer=true]
 */
export function setActiveSlot(slot, notifyServer = true) {
  const s = slot === 1 ? 1 : 2;
  setActiveSlotState(s);
  const activeHid = getActiveHotspotId();
  const activeCard = document.querySelector(`.radio-container[data-hotspot-id="${activeHid}"]`) || document.querySelector(".radio-container");
  if (activeCard) {
    setCardSlot(activeCard, s, notifyServer);
  }
}

/**
 * Get configured or saved TG for a hotspot (unified across timeslots)
 * @param {string} [hid]
 * @param {number} [slot=null]
 * @returns {number}
 */
export function getHotspotTg(hid, slot = null) {
  const id = hid || getActiveHotspotId();
  const hs = getCurrentHotspots().find(h => h.id === id);
  const unifiedKey = `proxdmr_tg_${id}`;
  const saved = localStorage.getItem(unifiedKey);
  if (saved) {
    const val = parseInt(saved, 10);
    if (!isNaN(val) && val > 0) return val;
  }
  if (slot) {
    const legacySaved = localStorage.getItem(`proxdmr_tg_${id}_ts${slot}`);
    if (legacySaved) {
      const val = parseInt(legacySaved, 10);
      if (!isNaN(val) && val > 0) return val;
    }
  }
  const s2 = localStorage.getItem(`proxdmr_tg_${id}_ts2`) || localStorage.getItem("proxdmr_tg_ts2");
  if (s2) {
    const val = parseInt(s2, 10);
    if (!isNaN(val) && val > 0) return val;
  }
  const s1 = localStorage.getItem(`proxdmr_tg_${id}_ts1`) || localStorage.getItem("proxdmr_tg_ts1");
  if (s1) {
    const val = parseInt(s1, 10);
    if (!isNaN(val) && val > 0) return val;
  }
  if (hs) {
    return hs.default_tg || hs.default_tg_ts2 || hs.default_tg_ts1 || 2501;
  }
  return 2501;
}

/**
 * Get unified PTT target for a hotspot (TG or Private ID).
 * If a private call (CALLER/ID) is explicitly selected, that target is used.
 * Otherwise, the target is the unified TalkGroup assigned to PTT.
 * Background incoming traffic never hijacks the PTT target.
 * @param {string} [hid]
 * @param {number|null} [targetSlot=null]
 * @returns {{ id: number, type: string }}
 */
export function getHotspotPttTarget(hid, targetSlot = null) {
  const id = hid || getActiveHotspotId();
  const card = document.querySelector(`.radio-container[data-hotspot-id="${id}"]`) || document.querySelector(".radio-container");

  // 1. Check card in-memory target if it's an explicit Private Call
  if (card && card._pttTarget && (card._pttTarget.type === "CALLER" || card._pttTarget.type === "ID") && card._pttTarget.id > 0) {
    return card._pttTarget;
  }

  // 2. Check localStorage for an explicit Private Call target
  const key = `proxdmr_ptt_target_${id}`;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && (parsed.type === "CALLER" || parsed.type === "ID") && parsed.id > 0) {
        if (card) card._pttTarget = parsed;
        return parsed;
      }
    } catch (e) {
      const val = parseInt(saved, 10);
      if (!isNaN(val) && val > 999999) {
        const res = { id: val, type: "CALLER" };
        if (card) card._pttTarget = res;
        return res;
      }
    }
  }

  // 3. Fallback: single hotspot TG assigned to PTT (independent of slot)
  const fallbackTg = getHotspotTg(id);
  const res = { id: fallbackTg, type: "TG" };
  if (card) card._pttTarget = res;
  return res;
}

/**
 * Set unified PTT target for a hotspot
 * @param {string} [hid]
 * @param {number|string} targetId
 * @param {string} [type="TG"]
 */
export function setHotspotPttTarget(hid, targetId, type = "TG") {
  const id = hid || getActiveHotspotId();
  const tid = parseInt(targetId, 10);
  if (!tid || tid <= 0) return;
  const tType = (type === "CALLER" || type === "ID") ? "CALLER" : "TG";
  const pttTarget = { id: tid, type: tType };

  const key = `proxdmr_ptt_target_${id}`;
  if (tType === "CALLER") {
    try {
      localStorage.setItem(key, JSON.stringify(pttTarget));
    } catch (e) {}
  } else {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }

  const card = document.querySelector(`.radio-container[data-hotspot-id="${id}"]`) || document.querySelector(".radio-container");
  if (card) {
    card._pttTarget = pttTarget;
    updateCardPttHint(card);
  }
}

/**
 * Update PTT hint badge and target information on a card.
 * @param {HTMLElement} card
 * @param {number|null} [targetSlot=null]
 */
export function updateCardPttHintForSlot(card, targetSlot = null) {
  if (!card) return;
  const activeHid = getActiveHotspotId();
  const cid = card.dataset.hotspotId || activeHid;
  const effectiveSlot = (targetSlot === 1 || targetSlot === 2) ? targetSlot : (card._activeSlot || getHotspotSlot(cid) || 2);
  const pttTarget = getHotspotPttTarget(cid, effectiveSlot);
  const curTg = pttTarget.id;
  const isCallerId = (pttTarget.type === "CALLER" || pttTarget.type === "ID");

  const ts1El = card.querySelector(".ptt-slot-ts1");
  const ts2El = card.querySelector(".ptt-slot-ts2");
  const legacyBadge = card.querySelector(".ptt-slot-badge:not(.ptt-slot-ts1):not(.ptt-slot-ts2)");
  const infoEl = card.querySelector(".ptt-target-info");
  const descEl = card.querySelector(".ptt-target-desc");
  const legacyHint = card.querySelector(".ptt-hint");

  const userCalls = getUserCallsigns();
  const u = userCalls[curTg];
  let targetText = "";
  let descText = "";

  if (isCallerId || u) {
    targetText = `ID ${curTg}`;
    const call = (u?.callsign || "").trim();
    const name = (u?.name || "").trim();
    const full = `${call} ${name}`.trim();
    descText = getCleanTgDesc(curTg, full);
  } else {
    targetText = `TG ${curTg}`;
    const tgNamesMap = getTgNamesMap();
    const rawName = tgNamesMap[curTg] ? String(tgNamesMap[curTg]).trim() : (curTg === 9990 ? "Parrot / Echo (Эхо-тест)" : "");
    descText = getCleanTgDesc(curTg, rawName);
  }

  // Highlight active slot badge on PTT button
  if (ts1El) {
    ts1El.classList.toggle("slot-selected", effectiveSlot === 1);
  }
  if (ts2El) {
    ts2El.classList.toggle("slot-selected", effectiveSlot === 2);
  }
  if (legacyBadge) {
    const slot = (targetSlot === 1 || targetSlot === 2) ? targetSlot : (card._activeSlot || getHotspotSlot(cid));
    legacyBadge.textContent = `TS${slot}`;
  }

  if (infoEl) {
    if (isCallerId || u) {
      infoEl.innerHTML = `ID <span class="dmr-id-text">${curTg}</span>`;
    } else {
      infoEl.textContent = targetText;
    }
    infoEl.classList.toggle("is-id", Boolean(isCallerId || u));
    infoEl.classList.toggle("is-tg", !isCallerId && !u);
  }
  if (descEl) {
    descEl.textContent = descText || "";
    descEl.title = descText || "";
    descEl.style.display = "";
    adjustPttDescFontSize(descEl, infoEl, descText);
  }
  if (legacyHint) {
    const slot = (targetSlot === 1 || targetSlot === 2) ? targetSlot : (card._activeSlot || getHotspotSlot(cid));
    legacyHint.textContent = descText ? `TS${slot} ➔ ${targetText} (${descText})` : `TS${slot} ➔ ${targetText}`;
  }
}

/**
 * Update PTT hint badge and target information on a card
 * @param {HTMLElement} card
 */
export function updateCardPttHint(card) {
  updateCardPttHintForSlot(card, null);
}

/**
 * Update mode badge (STANDBY, RX, TX) on a card
 * @param {HTMLElement} card
 */
export function updateCardModeBadge(card) {
  if (!card) return;
  const modeBadgeEl = card.querySelector(".mode-badge");
  if (!modeBadgeEl) return;
  const activeHid = getActiveHotspotId();
  const hid = card.dataset.hotspotId || activeHid;

  const txHid = (typeof window !== "undefined" && window.activeTxHotspotId) || activeHid;
  if (getIsPttPressed() && (hid === activeHid || hid === txHid)) {
    const slot = card._activeSlot || getHotspotSlot(hid) || 1;
    modeBadgeEl.className = "mode-badge mode-tx";
    const rem = (typeof window !== "undefined" && typeof window.getTotRemainingSeconds === "function") ? window.getTotRemainingSeconds() : null;
    modeBadgeEl.textContent = (rem !== null && rem !== undefined) ? `TX TS${slot} ${rem}s` : `TX TS${slot}`;
    return;
  }

  const vfo1 = card.querySelector(".vfo-ts1-row");
  const vfo2 = card.querySelector(".vfo-ts2-row");
  const isTs1Rx = Boolean(vfo1 && vfo1.classList.contains("vfo-rx-active"));
  const isTs2Rx = Boolean(vfo2 && vfo2.classList.contains("vfo-rx-active"));

  if (isTs1Rx && isTs2Rx) {
    modeBadgeEl.className = "mode-badge mode-rx";
    modeBadgeEl.textContent = "RX TS1+TS2";
  } else if (isTs1Rx) {
    modeBadgeEl.className = "mode-badge mode-rx";
    modeBadgeEl.textContent = "RX TS1";
  } else if (isTs2Rx) {
    modeBadgeEl.className = "mode-badge mode-rx";
    modeBadgeEl.textContent = "RX TS2";
  } else {
    modeBadgeEl.className = "mode-badge mode-standby";
    modeBadgeEl.textContent = "STANDBY";
  }
}

/**
 * Update VFO rows, caller/TG display, and active RX indication on a card
 * @param {HTMLElement} card
 */
export function updateCardTgDisplay(card) {
  if (!card) return;
  const activeHid = getActiveHotspotId();
  const cid = card.dataset.hotspotId || activeHid;
  const tg1 = getHotspotTg(cid, 1);
  const tg2 = getHotspotTg(cid, 2);
  const now = Date.now() / 1000;
  const perfNow = performance.now();

  // --- For each timeslot, update RX info from heardCalls OR card._lastRx ---
  for (let s = 1; s <= 2; s++) {
    const vfo = card.querySelector(s === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
    if (!vfo) continue;

    const callerCallEl = vfo.querySelector(".ts-caller-call");
    const callerFlagEl = vfo.querySelector(".ts-caller-flag");
    const callerIdEl = vfo.querySelector(".ts-caller-id");
    const callerCountryEl = vfo.querySelector(".ts-caller-country");
    const tgFlagEl = vfo.querySelector(".ts-tg-flag");
    const tgTextEl = vfo.querySelector(".ts-tg-text");

    const vuSt = (typeof window !== "undefined" && typeof window.getVuState === "function")
      ? window.getVuState(cid, s)
      : null;
    const isAudioActive = Boolean(vuSt && vuSt.mode === "RX" && (perfNow - vuSt.lastRxTime < 1800));

    // Authoritative slot call: card._lastRx[s] first, or most recent from heardCalls (RX only)
    const curHeardCalls = (window.__proxdmr && typeof window.__proxdmr.getHeardCalls === "function")
      ? window.__proxdmr.getHeardCalls()
      : ((typeof window !== "undefined" && window.heardCalls) || []);
    let rxData = (card._lastRx && card._lastRx[s]) || curHeardCalls.find(c => !c.is_tx && (c.hotspot_id || "default") === cid && c.slot === s);

    const isRxActive = isAudioActive || Boolean(rxData && rxData.active);

    if (isRxActive) {
      if (!vfo.classList.contains("vfo-rx-active")) {
        vfo.classList.add("vfo-rx-active");
        updateCardModeBadge(card);
      }
    } else {
      if (vfo.classList.contains("vfo-rx-active")) {
        vfo.classList.remove("vfo-rx-active");
        updateCardModeBadge(card);
      }
    }

    // Check if call is active OR within hold time (40s after audio/call end)
    const lastActivity = Math.max(
      (card._lastRx && card._lastRx[s]?.lastAudioTime) || 0,
      (card._lastRx && card._lastRx[s]?.lastSeenTime) || 0,
      (card._lastRx && card._lastRx[s]?.endTime) || 0,
      (rxData && (rxData.timestamp + (rxData.duration || 0))) || 0,
      (rxData && rxData.timestamp) || 0
    );
    const elapsedSinceActivity = lastActivity ? (now - lastActivity) : 999;
    const isWithinHoldTime = isRxActive || (elapsedSinceActivity <= 40.0);

    if (rxData && isWithinHoldTime) {
      // Keep card._lastRx fresh
      if (!card._lastRx) card._lastRx = {};
      if (!card._lastRx[s]) card._lastRx[s] = { ...rxData };
      if (isRxActive) {
        card._lastRx[s].lastSeenTime = now;
      }

      // Top row: caller info - ALWAYS CLEAN & NEVER GREY DURING RECENT/ACTIVE RX
      const cCall = rxData.src_callsign || (rxData.src_id ? `ID: ${rxData.src_id}` : "———");
      const cName = rxData.src_name || "";
      const callerCountry = getCountryInfo(rxData.src_id, rxData.src_callsign);

      if (callerCallEl) {
        if (!rxData.src_callsign && rxData.src_id) {
          callerCallEl.innerHTML = `ID: <span class="dmr-id-text">${rxData.src_id}</span>`;
        } else {
          callerCallEl.textContent = `${cCall} ${cName}`.trim();
        }
        callerCallEl.style.filter = "none";
        if (rxData.src_id) {
          callerCallEl.dataset.radioId = rxData.src_id;
          callerCallEl.dataset.callsign = rxData.src_callsign || "";
          callerCallEl.dataset.name = rxData.src_name || "";
          callerCallEl.title = (typeof window !== "undefined" && window.t)
            ? window.t("vfo.set_caller_tx_title", { id: rxData.src_id })
            : `Задать ID ${rxData.src_id} для передачи (Private Call)`;
        } else {
          delete callerCallEl.dataset.radioId;
          delete callerCallEl.dataset.callsign;
          delete callerCallEl.dataset.name;
          callerCallEl.removeAttribute("title");
        }
      }
      if (callerFlagEl) {
        updateFlagElement(callerFlagEl, callerCountry);
        callerFlagEl.style.filter = "none";
      }
      if (callerIdEl) {
        callerIdEl.innerHTML = rxData.src_id ? `(<span class="dmr-id-text">${rxData.src_id}</span>)` : "";
        callerIdEl.style.filter = "none";
        if (rxData.src_id) {
          callerIdEl.dataset.radioId = rxData.src_id;
          callerIdEl.dataset.callsign = rxData.src_callsign || "";
          callerIdEl.dataset.name = rxData.src_name || "";
          callerIdEl.dataset.country = callerCountry?.name_en || "";
          callerIdEl.title = (typeof window !== "undefined" && window.t)
            ? window.t("vfo.set_caller_tx_title", { id: rxData.src_id })
            : `Задать ID ${rxData.src_id} для передачи (Private Call)`;
        } else {
          delete callerIdEl.dataset.radioId;
          delete callerIdEl.dataset.callsign;
          delete callerIdEl.dataset.name;
          delete callerIdEl.dataset.country;
          callerIdEl.removeAttribute("title");
        }
      }
      if (callerCountryEl) {
        callerCountryEl.textContent = callerCountry?.name_en || "";
        callerCountryEl.style.filter = "none";
      }

      // Bottom row: destination TG of the RECEIVED call
      const tgNamesMap = getTgNamesMap();
      const rawTgName = tgNamesMap[rxData.dst_id] || (rxData.dst_id === 9990 ? "Parrot / Echo" : "");
      if (tgFlagEl) {
        updateFlagElement(tgFlagEl, getCountryInfo(rxData.dst_id), rxData.dst_id === 9990);
        tgFlagEl.style.filter = "none";
      }
      if (tgTextEl) {
        const tgPrefix = rxData.call_type === "GROUP" ? "TG" : "Call";
        const tgTitle = (typeof window !== "undefined" && window.t)
          ? window.t("vfo.set_tg_tx_title", { tg: rxData.dst_id })
          : `Задать TG ${rxData.dst_id} для передачи на этом хотспоте`;
        tgTextEl.innerHTML = renderTgTextHtml(rxData.dst_id, tgPrefix, rawTgName, tgTitle);
        tgTextEl.dataset.tgId = rxData.dst_id;
        tgTextEl.style.filter = "none";
        tgTextEl.title = tgTitle;
      }
    } else {
      // Specified hold time (40s) has passed or no call: Clean reset to Standby & Default slot TG!
      if (card._lastRx && card._lastRx[s]) {
        delete card._lastRx[s];
      }
      if (vfo.classList.contains("vfo-rx-active")) {
        vfo.classList.remove("vfo-rx-active");
        updateCardModeBadge(card);
      }
      const defTg = s === 1 ? tg1 : tg2;
      const tgNamesFallback = getTgNamesMap();
      const defTgName = tgNamesFallback[defTg] || (defTg === 9990 ? "Parrot / Echo" : (defTg === 91 ? "Worldwide" : (defTg === 2501 ? "Россия 1 (National)" : "")));
      const defCountry = getCountryInfo(defTg);

      if (callerCallEl) {
        callerCallEl.textContent = (typeof window !== "undefined" && window.t)
          ? window.t("vfo.standby")
          : "Ожидание вызова...";
        callerCallEl.style.filter = "none";
        callerCallEl.classList.remove("caller-active");
        delete callerCallEl.dataset.radioId;
        delete callerCallEl.dataset.callsign;
        delete callerCallEl.dataset.name;
        callerCallEl.removeAttribute("title");
      }
      if (callerFlagEl) {
        updateFlagElement(callerFlagEl, null, false);
        callerFlagEl.style.filter = "none";
      }
      if (callerIdEl) {
        callerIdEl.textContent = "";
        delete callerIdEl.dataset.radioId;
        delete callerIdEl.dataset.callsign;
        delete callerIdEl.dataset.name;
        delete callerIdEl.dataset.country;
        callerIdEl.removeAttribute("title");
      }
      if (callerCountryEl) {
        callerCountryEl.textContent = "";
        callerCountryEl.style.filter = "none";
      }
      if (tgFlagEl) {
        updateFlagElement(tgFlagEl, null, false);
        tgFlagEl.innerHTML = "";
        tgFlagEl.style.filter = "none";
      }
      if (tgTextEl) {
        tgTextEl.innerHTML = "";
        tgTextEl.removeAttribute("title");
        delete tgTextEl.dataset.tgId;
        tgTextEl.style.filter = "none";
      }
    }
  }

  // --- Active slot indicator removed in standby ---
  const vfo1 = card.querySelector(".vfo-ts1-row");
  const vfo2 = card.querySelector(".vfo-ts2-row");
  if (vfo1) vfo1.classList.remove("active-ptt-vfo");
  if (vfo2) vfo2.classList.remove("active-ptt-vfo");

  const quickInp = card.querySelector(".quick-tg-input");
  if (quickInp) {
    quickInp.placeholder = "TG #";
  }

  updateCardPttHint(card);
  updateCardModeBadge(card);
}

/**
 * Update VFO display on all hotspot cards
 */
export function updateAllHotspotsTgDisplay() {
  document.querySelectorAll(".radio-container").forEach(c => {
    updateCardTgDisplay(c);
  });
}

/**
 * Alias for updateAllHotspotsTgDisplay
 */
export function updateTgDisplay() {
  updateAllHotspotsTgDisplay();
}

/**
 * Set TalkGroup for a specific hotspot (unified across timeslots)
 * @param {string} hid
 * @param {number} slot
 * @param {number} tg
 * @param {boolean} [notifyServer=true]
 */
export function setHotspotTg(hid, slot, tg, notifyServer = true) {
  const activeHid = getActiveHotspotId();
  const id = hid || activeHid;
  const s = (slot === 1 || slot === 2) ? slot : (getHotspotSlot(id) || 2);
  const hs = getCurrentHotspots().find(h => h.id === id);
  if (hs) {
    hs.default_tg = tg;
    hs.default_tg_ts1 = tg;
    hs.default_tg_ts2 = tg;
  }
  localStorage.setItem(`proxdmr_tg_${id}`, tg.toString());
  localStorage.setItem(`proxdmr_tg_${id}_ts1`, tg.toString());
  localStorage.setItem(`proxdmr_tg_${id}_ts2`, tg.toString());

  // Also update unified PTT target
  setHotspotPttTarget(id, tg, tg > 999999 ? "CALLER" : "TG");

  if (id === activeHid) {
    updateActiveTgState(1, tg);
    updateActiveTgState(2, tg);
    if (typeof window !== "undefined") {
      window.activeTg = tg;
    }
  }

  const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${id}"]`);
  if (targetCard) {
    updateCardTgDisplay(targetCard);
    updateCardPttHint(targetCard);
  }

  const ws = getWs();
  if (notifyServer && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "set_tg", hotspot_id: id, tg: tg, slot: s }));
  }

  fetch("/api/radio/tg", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hotspot_id: id, slot: s, tg: tg })
  }).catch(e => console.warn("[API] Failed to persist TG:", e));

  if (typeof window !== "undefined" && typeof window.scheduleSyncClientSettings === "function") {
    window.scheduleSyncClientSettings();
  }
}

/**
 * Set timeslot on a specific hotspot card
 * @param {string} hid
 * @param {number} slot
 * @param {boolean} [notifyServer=true]
 */
export function setHotspotSlot(hid, slot, notifyServer = true) {
  const activeHid = getActiveHotspotId();
  const id = hid || activeHid;
  const s = slot === 1 ? 1 : 2;
  const card = document.querySelector(`.radio-container[data-hotspot-id="${id}"]`) || document.getElementById("radioContainer");
  if (card) {
    setCardSlot(card, s, notifyServer);
  }
}

/**
 * Set TalkGroup on currently active hotspot and timeslot
 * @param {number} tg
 * @param {boolean} [notifyServer=true]
 */
export function setTg(tg, notifyServer = true) {
  setHotspotTg(getActiveHotspotId(), getActiveSlot(), tg, notifyServer);
}

/**
 * Select a target (TG or Private ID) from a card element
 * @param {HTMLElement} card
 * @param {string} cid
 * @param {number} slot
 * @param {number|string} targetId
 * @param {string} type "TG" | "CALLER"
 * @param {HTMLElement} [triggerEl]
 */
export function selectHotspotTargetId(card, cid, slot, targetId, type, triggerEl) {
  if (getIsPttPressed()) return;
  const tid = parseInt(targetId, 10);
  if (!tid || tid <= 0) return;

  const s = slot === 1 ? 1 : 2;
  const activeHid = getActiveHotspotId();
  const hid = cid || (card && card.dataset.hotspotId) || activeHid;

  // 1. Switch active hotspot if needed
  if (activeHid !== hid) {
    if (typeof window !== "undefined" && typeof window.switchActiveHotspot === "function") {
      window.switchActiveHotspot(hid);
    }
  }

  // 2. Select active slot on this hotspot
  if (card) {
    setCardSlot(card, s, true);
  }

  // 3. If caller ID, cache correspondent info in USER_CALLSIGNS
  if (type === "CALLER") {
    const vfoRow = card ? card.querySelector(s === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row") : null;
    const callEl = vfoRow ? vfoRow.querySelector(".ts-caller-call") : null;
    const idEl = vfoRow ? vfoRow.querySelector(".ts-caller-id") : null;
    const countryEl = vfoRow ? vfoRow.querySelector(".ts-caller-country") : null;

    const callsign = (idEl?.dataset.callsign || callEl?.dataset.callsign || "").trim();
    const name = (idEl?.dataset.name || callEl?.dataset.name || "").trim();
    const country = (idEl?.dataset.country || countryEl?.textContent || "").trim();

    const users = getUserCallsigns();
    users[tid] = {
      callsign: callsign || (callEl ? callEl.textContent.trim() : `ID ${tid}`),
      name: name,
      country: country
    };
    try {
      localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify(users));
    } catch (e) {}
  }

  // 4. Update unified PTT target
  setHotspotPttTarget(hid, tid, type);

  // 5. Update hotspot TG/ID for this slot
  setHotspotTg(hid, s, tid, true);

  // 6. Visual pulse animation on clicked element
  if (triggerEl) {
    triggerEl.classList.remove("target-selected-pulse");
    void triggerEl.offsetWidth;
    triggerEl.classList.add("target-selected-pulse");
    setTimeout(() => {
      if (triggerEl) triggerEl.classList.remove("target-selected-pulse");
    }, 500);
  }

  // 7. Visual pulse animation on PTT button
  if (card) {
    const pttBtn = card.querySelector(".ptt-button");
    if (pttBtn) {
      pttBtn.classList.remove("target-selected-pulse");
      void pttBtn.offsetWidth;
      pttBtn.classList.add("target-selected-pulse");
      setTimeout(() => {
        if (pttBtn) pttBtn.classList.remove("target-selected-pulse");
      }, 500);
    }
  }

  // 8. Tactile vibration feedback on touch devices
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try { navigator.vibrate(35); } catch (e) {}
  }
}

// Window & __proxdmr bindings for backward compatibility
if (typeof window !== "undefined") {
  window.getHotspotSlot = getHotspotSlot;
  window.setCardSlot = setCardSlot;
  window.setActiveSlot = setActiveSlot;
  window.getHotspotTg = getHotspotTg;
  window.getHotspotPttTarget = getHotspotPttTarget;
  window.setHotspotPttTarget = setHotspotPttTarget;
  window.updateCardPttHint = updateCardPttHint;
  window.updateCardPttHintForSlot = updateCardPttHintForSlot;
  window.updateCardModeBadge = updateCardModeBadge;
  window.updateCardTgDisplay = updateCardTgDisplay;
  window.updateAllHotspotsTgDisplay = updateAllHotspotsTgDisplay;
  window.updateTgDisplay = updateTgDisplay;
  window.setHotspotTg = setHotspotTg;
  window.setHotspotSlot = setHotspotSlot;
  window.setTg = setTg;
  window.selectHotspotTargetId = selectHotspotTargetId;

  window.__proxdmr = window.__proxdmr || {};
  Object.assign(window.__proxdmr, {
    getHotspotSlot,
    setCardSlot,
    setActiveSlot,
    getHotspotTg,
    getHotspotPttTarget,
    setHotspotPttTarget,
    updateCardPttHint,
    updateCardPttHintForSlot,
    updateCardModeBadge,
    updateCardTgDisplay,
    updateAllHotspotsTgDisplay,
    updateTgDisplay,
    setHotspotTg,
    setHotspotSlot,
    setTg,
    selectHotspotTargetId
  });
}
