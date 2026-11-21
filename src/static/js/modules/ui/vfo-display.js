/**
 * ProxDMR - VFO Display & Timeslot / TG Selection Module
 * Handles per-card timeslot selection, VFO frequency/talkgroup display,
 * active RX status indications, hold times, and target ID/TG selection.
 */

import {
  getCountryInfo,
  getCallCountryInfo,
  updateFlagElement,
  getCleanTgDesc,
  getHotspotNetworkType,
  getNetworkRawTgName,
  adjustPttDescFontSize,
  renderTgTextHtml,
  formatCallerLocation
} from "../core/formatters.js?v=2.9.787";

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
 * Load last correspondent information for a hotspot and slot from localStorage
 * @param {string} [hid]
 * @param {number} slot
 * @returns {object|null}
 */
export function getStoredLastRx(hid, slot) {
  if (!slot) return null;
  try {
    const target = (typeof window !== "undefined" && typeof window.resolveHotspotId === "function")
      ? window.resolveHotspotId(hid)
      : (hid || "default");
    const firstHsId = (typeof window !== "undefined" && Array.isArray(window.currentHotspots) && window.currentHotspots[0])
      ? window.currentHotspots[0].id
      : "default";
    let raw = localStorage.getItem(`proxdmr_last_rx_${target}_ts${slot}`);
    if (!raw && (target === "default" || target === firstHsId)) {
      raw = localStorage.getItem(`proxdmr_last_rx_default_ts${slot}`);
    }
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const hsNet = getHotspotNetworkType(target);
        const recNet = String(parsed.network_type || "").toLowerCase();
        if (recNet && hsNet && ((recNet === "ysf") !== (hsNet === "ysf") || (recNet === "allstar") !== (hsNet === "allstar") || (recNet === "m17") !== (hsNet === "m17"))) {
          return null;
        }
      }
      return parsed;
    }
  } catch (_) {}
  return null;
}

/**
 * Persist last correspondent information for a hotspot and slot to localStorage
 * @param {string} [hid]
 * @param {number} slot
 * @param {object} data
 */
const _lastSavedRxSerialized = new Map();

export function saveStoredLastRx(hid, slot, data) {
  if (!slot || !data || (!data.src_id && !data.src_callsign)) return;
  try {
    const target = (typeof window !== "undefined" && typeof window.resolveHotspotId === "function")
      ? window.resolveHotspotId(hid)
      : (hid || "default");
    const resolvedNet = String(data.network_type || getHotspotNetworkType(target) || "").toLowerCase();
    const item = {
      id: data.id || data.call_id || "",
      network_type: resolvedNet,
      src_id: data.src_id,
      src_callsign: data.src_callsign || "",
      src_name: data.src_name || "",
      city: data.city || "",
      country: data.country || "",
      dst_id: data.dst_id,
      dst_name: data.dst_name || "",
      call_type: data.call_type || "GROUP",
      timestamp: data.timestamp || (Date.now() / 1000)
    };
    const key = `proxdmr_last_rx_${target}_ts${slot}`;
    const serialized = JSON.stringify(item);
    if (_lastSavedRxSerialized.get(key) === serialized) {
      return;
    }
    _lastSavedRxSerialized.set(key, serialized);
    if (localStorage.getItem(key) !== serialized) {
      localStorage.setItem(key, serialized);
      const firstHs = (typeof window !== "undefined" && window.currentHotspots && window.currentHotspots[0]) ? window.currentHotspots[0].id : "default";
      if (target === firstHs && target !== "default") {
        localStorage.setItem(`proxdmr_last_rx_default_ts${slot}`, serialized);
      }
    }
  } catch (_) {}
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
  if (notifyServer && typeof window !== "undefined" && typeof window.scheduleSyncClientSettings === "function") {
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
function _setTextIfChanged(el, text) {
  if (!el) return false;
  const val = String(text ?? "");
  if (el.dataset.pxiRawHtml || el.textContent !== val) {
    delete el.dataset.pxiRawHtml;
    el.textContent = val;
    return true;
  }
  return false;
}

function _setHtmlIfChanged(el, html) {
  if (!el) return false;
  const val = String(html ?? "");
  if (el.dataset.pxiRawHtml !== val) {
    el.dataset.pxiRawHtml = val;
    el.innerHTML = val;
    return true;
  }
  return false;
}

export function updateCardPttHintForSlot(card, targetSlot = null) {
  if (!card) return;
  const activeHid = getActiveHotspotId();
  const cid = card.dataset.hotspotId || activeHid;
  const netType = getHotspotNetworkType(cid);

  const ts1El = card.querySelector(".ptt-slot-ts1");
  const ts2El = card.querySelector(".ptt-slot-ts2");
  const legacyBadge = card.querySelector(".ptt-slot-badge:not(.ptt-slot-ts1):not(.ptt-slot-ts2)");
  const infoEl = card.querySelector(".ptt-target-info");
  const descEl = card.querySelector(".ptt-target-desc");
  const legacyHint = card.querySelector(".ptt-hint");
  const pttBtn = card.querySelector(".ptt-button");
  const isSwlMode = (typeof document !== "undefined" && document.body && document.body.classList.contains("is-swl-mode"));

  // Проверка на режим AllStarLink (ASL)
  const isAllStar = (netType === "allstar" || card.classList.contains("card-net-allstar") || card.dataset.networkType === "allstar" || (typeof window.isAllStarHotspot === "function" && window.isAllStarHotspot(cid, card)));
  if (isAllStar) {
    if (ts1El) ts1El.style.display = "none";
    if (ts2El) ts2El.style.display = "none";
    if (legacyBadge) legacyBadge.style.display = "none";
    if (pttBtn && !isSwlMode) {
      pttBtn.classList.remove("hover-slot-1", "hover-slot-2");
      pttBtn.removeAttribute("title");
      pttBtn.removeAttribute("data-i18n-title");
    }

    const hsList = (typeof window !== "undefined" && window.currentHotspots) || (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []);
    const hs = hsList.find(h => String(h.id) === String(cid)) || (cid === "default" ? hsList[0] : null);
    const connNode = String((hs && (hs.connected_node || (Array.isArray(hs.asl_links) && hs.asl_links[0] && hs.asl_links[0].node))) || "").trim();
    const ownNode = String((hs && (hs.config?.allstar_node || hs.allstar_node || hs.node_number)) || "45113").trim();

    let nodeDesc = "";
    if (connNode && connNode !== "0") {
      if (connNode === "1999") {
        nodeDesc = "Parrot Echo";
      } else {
        const directory = (typeof window.getAslDirectoryEntry === "function") ? window.getAslDirectoryEntry(connNode) : null;
        if (directory && (directory.callsign || directory.info)) {
          nodeDesc = `${directory.callsign || ""} · ${directory.info || ""}`.trim();
        } else {
          nodeDesc = "AllStarLink";
        }
      }
      if (infoEl) {
        infoEl.textContent = `Node ${connNode}`;
        infoEl.className = "ptt-target-info is-node";
      }
      if (descEl) {
        _setTextIfChanged(descEl, nodeDesc);
        descEl.title = nodeDesc;
        descEl.style.display = "";
      }
    } else {
      if (infoEl) {
        infoEl.textContent = "AllStarLink";
        infoEl.className = "ptt-target-info is-node";
      }
      if (descEl) {
        _setTextIfChanged(descEl, `Node ${ownNode}`);
        descEl.title = (typeof window !== "undefined" && window.t)
          ? window.t("asl.node_title", { node: ownNode }, `Node ${ownNode}`)
          : `Node ${ownNode}`;
        descEl.style.display = "";
      }
    }
    if (legacyHint) {
      legacyHint.textContent = connNode ? `ASL ➔ Node ${connNode}` : `ASL ➔ Node ${ownNode}`;
    }
    return;
  }

  // Проверка на режим M17 (Codec2)
  const isM17 = (netType === "m17" || card.classList.contains("card-net-m17") || card.dataset.networkType === "m17");
  if (isM17) {
    if (ts1El) ts1El.style.display = "none";
    if (ts2El) ts2El.style.display = "none";
    if (legacyBadge) legacyBadge.style.display = "none";
    if (pttBtn && !isSwlMode) {
      pttBtn.classList.remove("hover-slot-1", "hover-slot-2");
      pttBtn.removeAttribute("title");
      pttBtn.removeAttribute("data-i18n-title");
    }
    const hsList = (typeof window !== "undefined" && window.currentHotspots) || (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []);
    const hs = hsList.find(h => String(h.id) === String(cid)) || (cid === "default" ? hsList[0] : null);
    const refId = String((hs && hs.m17_reflector) || "M17-M17").trim();
    const modCh = String((hs && hs.m17_module) || "C").trim().toUpperCase();
    const refName = String((hs && hs.m17_reflector_name) || refId).trim();
    const isLstn = String((hs && hs.m17_link_mode) || "conn").toLowerCase() === "lstn" || Boolean(hs && hs.m17_rx_only);
    const labelStr = isLstn ? `${refId} ${modCh} (LSTN)` : `${refId} ${modCh}`;
    if (infoEl) {
      infoEl.textContent = labelStr;
      infoEl.className = "ptt-target-info is-m17-ref";
    }
    if (descEl) {
      const m17Changed = _setTextIfChanged(descEl, refName);
      descEl.title = `${labelStr} · ${refName}`;
      descEl.style.display = "";
      const fitKey = `${refName}|${descEl.clientWidth}`;
      if (m17Changed || descEl.dataset.pxiFitKey !== fitKey) {
        descEl.dataset.pxiFitKey = fitKey;
        adjustPttDescFontSize(descEl, infoEl, refName);
      }
    }
    if (legacyHint) {
      legacyHint.textContent = `M17 ➔ ${labelStr} (${refName})`;
    }
    return;
  }

  // Проверка на режим YSF (Yaesu System Fusion / C4FM)
  const isYsf = (netType === "ysf" || card.classList.contains("card-net-ysf") || card.dataset.networkType === "ysf");
  if (isYsf) {
    if (ts1El) ts1El.style.display = "none";
    if (ts2El) ts2El.style.display = "none";
    if (legacyBadge) legacyBadge.style.display = "none";
    if (pttBtn && !isSwlMode) {
      pttBtn.classList.remove("hover-slot-1", "hover-slot-2");
      pttBtn.removeAttribute("title");
      pttBtn.removeAttribute("data-i18n-title");
    }

    const hsList = (typeof window !== "undefined" && window.currentHotspots) || (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []);
    const hs = hsList.find(h => String(h.id) === String(cid)) || (cid === "default" ? hsList[0] : null);
    const roomId = String((hs && (hs.config?.ysf_room || hs.ysf_room || hs.room_id)) || "25000").trim();
    const roomName = String((hs && (hs.config?.ysf_name || hs.ysf_name || hs.name)) || "YSF-Russia").trim();
    const txDg = Number((hs && (hs.ysf_tx_dg_id || hs.config?.ysf_tx_dg_id)) || 0);
    const dgSuffix = (txDg >= 1 && txDg <= 99) ? ` · DG ${String(txDg).padStart(2, "0")}` : "";

    if (infoEl) {
      infoEl.textContent = `#${roomId}${dgSuffix}`;
      infoEl.className = "ptt-target-info is-ysf-room";
    }
    if (descEl) {
      const ysfChanged = _setTextIfChanged(descEl, roomName);
      descEl.title = `#${roomId} · ${roomName}${dgSuffix}`;
      descEl.style.display = "";
      const fitKey = `${roomName}|${descEl.clientWidth}`;
      if (ysfChanged || descEl.dataset.pxiFitKey !== fitKey) {
        descEl.dataset.pxiFitKey = fitKey;
        adjustPttDescFontSize(descEl, infoEl, roomName);
      }
    }
    if (legacyHint) {
      legacyHint.textContent = `YSF ➔ #${roomId}${dgSuffix} (${roomName})`;
    }
    return;
  }

  // Для цифровых режимов (DMR, XLX): восстанавливаем видимость слотов и подсказку PTT
  if (ts1El) ts1El.style.display = "";
  if (ts2El) ts2El.style.display = "";
  if (pttBtn && !isSwlMode) {
    const dualPttTip = (typeof window !== "undefined" && window.t)
      ? window.t("ptt.dual_slot_ptt_title", {}, "Click left half to TX on TS1, right half — on TS2")
      : "Click left half to TX on TS1, right half — on TS2";
    pttBtn.setAttribute("title", dualPttTip);
    pttBtn.setAttribute("data-i18n-title", "ptt.dual_slot_ptt_title");
  }

  let effectiveSlot = (targetSlot === 1 || targetSlot === 2) ? targetSlot : (card._activeSlot || getHotspotSlot(cid) || 2);
  if (netType === "xlx") {
    effectiveSlot = 2;
  }
  const pttTarget = getHotspotPttTarget(cid, effectiveSlot);
  let curTg = pttTarget.id;
  const isCallerId = (pttTarget.type === "CALLER" || pttTarget.type === "ID");
  if (netType === "xlx" && !isCallerId) {
    curTg = 9;
  }

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
  } else if (netType === "xlx") {
    targetText = `TG 9`;
    descText = (typeof window !== "undefined" && window.t)
      ? window.t("tg_special.local_reflector", {}, "Local / Reflector")
      : "Local / Reflector";
  } else {
    targetText = `TG ${curTg}`;
    const parrotFallback = (typeof window !== "undefined" && window.t)
      ? window.t("tg_special.parrot_echo_full", {}, "Parrot / Echo (Echo Test)")
      : "Parrot / Echo (Echo Test)";
    const rawName = getNetworkRawTgName(curTg, netType) || (curTg === 9990 ? parrotFallback : "");
    descText = getCleanTgDesc(curTg, rawName, null, netType);
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
    _setTextIfChanged(legacyBadge, `TS${slot}`);
  }

  if (infoEl) {
    if (isCallerId || u) {
      _setHtmlIfChanged(infoEl, `ID <span class="dmr-id-text">${curTg}</span>`);
    } else {
      _setTextIfChanged(infoEl, targetText);
    }
    infoEl.classList.toggle("is-id", Boolean(isCallerId || u));
    infoEl.classList.toggle("is-tg", !isCallerId && !u);
  }
  if (descEl) {
    const nextDesc = descText || "";
    const dmrChanged = _setTextIfChanged(descEl, nextDesc);
    descEl.title = nextDesc;
    descEl.style.display = "";
    const fitKey = `${nextDesc}|${descEl.clientWidth}`;
    if (dmrChanged || descEl.dataset.pxiFitKey !== fitKey) {
      descEl.dataset.pxiFitKey = fitKey;
      adjustPttDescFontSize(descEl, infoEl, nextDesc);
    }
  }
  if (legacyHint) {
    const slot = (targetSlot === 1 || targetSlot === 2) ? targetSlot : (card._activeSlot || getHotspotSlot(cid));
    _setTextIfChanged(legacyHint, descText ? `TS${slot} ➔ ${targetText} (${descText})` : `TS${slot} ➔ ${targetText}`);
  }
}

/**
 * Update PTT hint badge and target information on a card
 * @param {HTMLElement} card
 */
export function updateCardPttHint(card) {
  updateCardPttHintForSlot(card, null);
}

function _syncToolbarRxDotAfterBadgeUpdate() {
  if (typeof window !== "undefined" && typeof window.refreshToolbarProcessIndicators === "function") {
    window.refreshToolbarProcessIndicators();
  }
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
  const rawCid = card.dataset.hotspotId || activeHid;
  const cid = (typeof window !== "undefined" && typeof window.resolveHotspotId === "function")
    ? window.resolveHotspotId(rawCid)
    : (rawCid || "default");
  const netType = (typeof getHotspotNetworkType === "function") ? getHotspotNetworkType(cid) : "";
  const isAllStar = (netType === "allstar" || card.classList.contains("card-net-allstar") || card.dataset.networkType === "allstar");
  const isYsf = (netType === "ysf" || card.classList.contains("card-net-ysf") || card.dataset.networkType === "ysf");
  const isM17 = (netType === "m17" || card.classList.contains("card-net-m17") || card.dataset.networkType === "m17");
  const isSingleChannel = isAllStar || isYsf || isM17;

  const _resHid = (v) => (typeof window !== "undefined" && typeof window.resolveHotspotId === "function")
    ? window.resolveHotspotId(v)
    : (v || "default");
  const txHid = (typeof window !== "undefined" && window.activeTxHotspotId) || activeHid;
  const recTxHid = (typeof window !== "undefined" && window.activeRecTxHotspotId)
    ? _resHid(window.activeRecTxHotspotId)
    : null;
  const isRecTxHere = Boolean(recTxHid && _resHid(cid) === recTxHid);
  if ((getIsPttPressed() && (cid === activeHid || cid === txHid)) || isRecTxHere) {
    const slot = isRecTxHere
      ? (window.activeRecTxSlot || card._activeSlot || getHotspotSlot(cid) || 1)
      : (card._activeSlot || getHotspotSlot(cid) || 1);
    const rem = isRecTxHere
      ? ((typeof window !== "undefined" && window.activeRecTxRemSec !== null && window.activeRecTxRemSec !== undefined) ? window.activeRecTxRemSec : null)
      : ((typeof window !== "undefined" && typeof window.getTotRemainingSeconds === "function") ? window.getTotRemainingSeconds() : null);
    const extraCls = (rem !== null && rem !== undefined)
      ? (rem <= 10 ? " mode-tx-critical" : (rem <= 30 ? " mode-tx-warn" : ""))
      : "";
    modeBadgeEl.className = `mode-badge mode-tx${extraCls}`;
    if (isSingleChannel) {
      modeBadgeEl.textContent = (rem !== null && rem !== undefined) ? `TX ${rem}s` : `TX`;
    } else {
      modeBadgeEl.textContent = (rem !== null && rem !== undefined) ? `TX TS${slot} ${rem}s` : `TX TS${slot}`;
    }
    _syncToolbarRxDotAfterBadgeUpdate();
    return;
  }

  const vfoAllStar = card.querySelector(".vfo-allstar-row");
  const isAslRx = Boolean(vfoAllStar && vfoAllStar.classList.contains("allstar-rx-active"));

  const vfo1 = card.querySelector(".vfo-ts1-row");
  const vfo2 = card.querySelector(".vfo-ts2-row");
  const isTs1Rx = Boolean(vfo1 && vfo1.classList.contains("vfo-rx-active"));
  const isTs2Rx = Boolean(vfo2 && vfo2.classList.contains("vfo-rx-active"));

  if (isSingleChannel) {
    if (isAslRx || isTs1Rx || isTs2Rx) {
      modeBadgeEl.className = "mode-badge mode-rx";
      modeBadgeEl.textContent = "RX";
    } else {
      modeBadgeEl.className = "mode-badge mode-standby";
      modeBadgeEl.textContent = (typeof window !== "undefined" && window.t) ? window.t("status.standby_mode", {}, "STANDBY") : "STANDBY";
    }
    _syncToolbarRxDotAfterBadgeUpdate();
    return;
  }

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
    modeBadgeEl.textContent = (typeof window !== "undefined" && window.t) ? window.t("status.standby_mode", {}, "STANDBY") : "STANDBY";
  }
  _syncToolbarRxDotAfterBadgeUpdate();
}

/**
 * Update VFO rows, caller/TG display, and active RX indication on a card
 * @param {HTMLElement} card
 */
export function updateCardTgDisplay(card) {
  if (!card) return;
  const activeHid = getActiveHotspotId();
  const rawCid = card.dataset.hotspotId || activeHid;
  const cid = (typeof window !== "undefined" && typeof window.resolveHotspotId === "function")
    ? window.resolveHotspotId(rawCid)
    : (rawCid || "default");
  const hsNet = String(getHotspotNetworkType(card) || getHotspotNetworkType(cid) || "").toLowerCase();
  const domNet = String(card.dataset.networkType || "").toLowerCase();
  const netType = (hsNet && hsNet !== "bm") ? hsNet : (domNet || hsNet || "bm");
  if (hsNet && hsNet !== "bm" && card.dataset.networkType !== hsNet) {
    card.dataset.networkType = hsNet;
  }
  const isYsf = (netType === "ysf" || card.classList.contains("card-net-ysf"));
  const isM17 = (netType === "m17" || card.classList.contains("card-net-m17"));
  const isAsl = (netType === "allstar" || card.classList.contains("card-net-allstar"));
  const isSingleCard = isYsf || isAsl || isM17;
  const isNonMccNet = (netType === "tgif" || netType === "xlx" || isYsf || isM17);
  const tg1 = getHotspotTg(cid, 1);
  const tg2 = getHotspotTg(cid, 2);
  const now = Date.now() / 1000;
  const perfNow = performance.now();

  // --- For each timeslot, update RX info from heardCalls OR card._lastRx ---
  for (let s = 1; s <= 2; s++) {
    const vfo = card.querySelector(s === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
    if (!vfo || vfo.classList.contains("vfo-tx-active")) continue;

    const callerCallEl = vfo.querySelector(".ts-caller-call");
    const callerFlagEl = vfo.querySelector(".ts-caller-flag");
    const callerIdEl = vfo.querySelector(".ts-caller-id");
    const callerCountryEl = vfo.querySelector(".ts-caller-country");
    const tgFlagEl = vfo.querySelector(".ts-tg-flag");
    const tgTextEl = vfo.querySelector(".ts-tg-text");

    const vuSt = (typeof window !== "undefined" && typeof window.getVuState === "function")
      ? window.getVuState(cid, s)
      : null;
    const slotLastRx = card._lastRx && card._lastRx[s];
    const endedExplicitly = Boolean(
      slotLastRx &&
      !slotLastRx.active &&
      slotLastRx.endTime &&
      (!slotLastRx.lastAudioTime || slotLastRx.lastAudioTime <= slotLastRx.endTime + 0.05)
    );
    const hasVisualHold = Boolean(card._rxVisualHoldTimers && card._rxVisualHoldTimers[s]);
    const isAudioActive = !endedExplicitly && Boolean(
      (vuSt && (perfNow - vuSt.lastRxTime < 2200)) ||
      (slotLastRx && ((now - (slotLastRx.lastAudioTime || 0)) < 2.2))
    );

    // Authoritative slot call: card._lastRx[s] first, or persistent storage, or most recent from heardCalls (RX only)
    let rxData = slotLastRx;
    if (!rxData) {
      const stored = getStoredLastRx(cid, s);
      if (stored) {
        rxData = { ...stored, active: false };
        if (!card._lastRx) card._lastRx = {};
        card._lastRx[s] = rxData;
      }
    }
    if (!rxData) {
      const curHeardCalls = (window.__proxdmr && typeof window.__proxdmr.getHeardCalls === "function")
        ? window.__proxdmr.getHeardCalls()
        : ((typeof window !== "undefined" && window.heardCalls) || []);
      const matched = curHeardCalls.find(c => {
        if (c.is_tx || c.slot !== s) return false;
        const cHid = (typeof window !== "undefined" && typeof window.resolveHotspotId === "function")
          ? window.resolveHotspotId(c.hotspot_id)
          : (c.hotspot_id || "default");
        return cHid === cid || (!c.hotspot_id && cid === "default");
      });
      if (matched) {
        rxData = { ...matched, active: Boolean(matched.active) };
        if (!card._lastRx) card._lastRx = {};
        card._lastRx[s] = rxData;
      }
    }

    if (rxData && rxData.active && !isAudioActive) {
      const lastRxTs = rxData.lastAudioTime || rxData.timestamp || 0;
      if (lastRxTs && (now - lastRxTs) >= 3.0) {
        rxData.active = false;
        rxData._fromBinaryOnly = false;
      }
    }

    const isRxActive = hasVisualHold || isAudioActive || Boolean(rxData && rxData.active);

    if (isRxActive) {
      if (!vfo.classList.contains("vfo-rx-active")) {
        vfo.classList.add("vfo-rx-active");
        updateCardModeBadge(card);
        if (typeof window !== "undefined" && typeof window.updateCardRecUI === "function") {
          window.updateCardRecUI(card, cid);
        }
      }
    } else {
      const rxTagEl = card.querySelector(s === 1 ? ".vfo-ts1-rx" : ".vfo-ts2-rx");
      const hsListRef = (typeof window !== "undefined" && Array.isArray(window.currentHotspots)) ? window.currentHotspots : [];
      const hsRef = hsListRef.find(h => {
        const hCid = (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") ? window.resolveHotspotId(h.id) : (h.id || "default");
        return hCid === cid;
      });
      if (hsRef) {
        const slotState = s === 1 ? hsRef.ts1 : hsRef.ts2;
        if (slotState && slotState.active && !isAudioActive && (!rxData || !rxData.active)) {
          slotState.active = false;
        }
      }
      const recBtnEl = card.querySelector(".header-rec-btn");
      if (
        vfo.classList.contains("vfo-rx-active") ||
        (rxTagEl && rxTagEl.classList.contains("active")) ||
        (s === 2 && recBtnEl && recBtnEl.classList.contains("recording") && !getIsPttPressed())
      ) {
        vfo.classList.remove("vfo-rx-active");
        if (rxTagEl) rxTagEl.classList.remove("active");
        updateCardModeBadge(card);
        if (typeof window !== "undefined" && typeof window.updateCardRecUI === "function") {
          window.updateCardRecUI(card, cid);
        }
      }
    }

    // Check if call is active OR within hold time (30s after audio/call end)
    const lastActivity = Math.max(
      (card._lastRx && card._lastRx[s]?.lastAudioTime) || 0,
      (card._lastRx && card._lastRx[s]?.lastSeenTime) || 0,
      (card._lastRx && card._lastRx[s]?.endTime) || 0,
      (rxData && (rxData.timestamp + (rxData.duration || 0))) || 0,
      (rxData && rxData.timestamp) || 0
    );
    const elapsedSinceActivity = lastActivity ? (now - lastActivity) : 999;
    const isWithinHoldTime = isRxActive || (elapsedSinceActivity <= 30.0);

    if (rxData) {
      const isYsfRx = Boolean(
        isYsf ||
        String(rxData.network_type || "").toLowerCase() === "ysf" ||
        String(rxData.id || rxData.call_id || "").startsWith("ysf_") ||
        String(rxData.dst_name || "").startsWith("YSF #")
      );
      const isM17Rx = Boolean(
        isM17 ||
        String(rxData.network_type || "").toLowerCase() === "m17" ||
        String(rxData.id || rxData.call_id || "").startsWith("m17_")
      );
      const isSingleRx = isSingleCard || isYsfRx || isM17Rx;
      // Keep card._lastRx fresh
      if (!card._lastRx) card._lastRx = {};
      if (!card._lastRx[s]) card._lastRx[s] = { ...rxData };
      if (isM17Rx) {
        card._lastRx[s].network_type = "m17";
      } else if (isYsfRx) {
        card._lastRx[s].network_type = "ysf";
      }
      if (isRxActive) {
        card._lastRx[s].lastSeenTime = now;
      }
      saveStoredLastRx(cid, s, card._lastRx[s]);

      // Top row: caller info - ALWAYS CLEAN & NEVER GREY DURING RECENT/ACTIVE RX
      const validTa = (rxData.talker_alias && String(rxData.talker_alias).trim()) ? String(rxData.talker_alias).trim() : "";
      const cCall = rxData.src_callsign || validTa || (rxData.src_id ? `ID: ${rxData.src_id}` : "———");
      const cName = (rxData.src_callsign && rxData.src_name) ? rxData.src_name : "";
      const callerCountry = getCallCountryInfo(rxData);

      if (callerCallEl) {
        delete callerCallEl.dataset.standby;
        if (!rxData.src_callsign && !validTa && rxData.src_id) {
          _setHtmlIfChanged(callerCallEl, `ID: <span class="dmr-id-text">${rxData.src_id}</span>`);
        } else {
          _setTextIfChanged(callerCallEl, `${cCall} ${cName}`.trim());
        }
        callerCallEl.style.filter = "none";
        callerCallEl.classList.add("caller-active");
        if (rxData.src_id && !isSingleRx) {
          callerCallEl.dataset.radioId = rxData.src_id;
          callerCallEl.dataset.callsign = rxData.src_callsign || "";
          callerCallEl.dataset.name = rxData.src_name || "";
          callerCallEl.title = (typeof window !== "undefined" && window.t)
            ? window.t("vfo.set_caller_tx_title", { id: rxData.src_id }, `Set ID ${rxData.src_id} for TX (Private Call)`)
            : `Set ID ${rxData.src_id} for TX (Private Call)`;
        } else {
          delete callerCallEl.dataset.radioId;
          delete callerCallEl.dataset.callsign;
          delete callerCallEl.dataset.name;
          callerCallEl.removeAttribute("title");
        }
      }
      const callerMapBtn = vfo.querySelector(".btn-caller-map");
      if (callerMapBtn) {
        const hasCoords = (rxData.lat !== undefined && rxData.lat !== null && rxData.lon !== undefined && rxData.lon !== null) || Boolean(rxData.latitude && rxData.longitude);
        const lat = rxData.lat ?? rxData.latitude;
        const lon = rxData.lon ?? rxData.longitude;
        const grid = rxData.qth_locator || rxData.locator || rxData.grid || "";
        if (hasCoords || grid) {
          callerMapBtn.style.display = "inline-flex";
          if (hasCoords) {
            callerMapBtn.dataset.lat = lat;
            callerMapBtn.dataset.lon = lon;
          } else {
            delete callerMapBtn.dataset.lat;
            delete callerMapBtn.dataset.lon;
          }
          if (grid) callerMapBtn.dataset.grid = grid;
          else delete callerMapBtn.dataset.grid;
          callerMapBtn.dataset.callsign = cCall;
          callerMapBtn.title = hasCoords
            ? ((typeof window !== "undefined" && window.t)
                ? window.t("vfo.show_coords_map", { call: cCall, lat: Number(lat).toFixed(4), lon: Number(lon).toFixed(4) }, `Show coordinates on map: ${cCall} (${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)})`)
                : `Show coordinates on map: ${cCall} (${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)})`)
            : ((typeof window !== "undefined" && window.t)
                ? window.t("vfo.qth_locator_title", { call: cCall, grid }, `QTH locator ${cCall}: ${grid}`)
                : `QTH locator ${cCall}: ${grid}`);
        } else {
          callerMapBtn.style.display = "none";
        }
      }
      if (callerFlagEl) {
        updateFlagElement(callerFlagEl, callerCountry);
        callerFlagEl.style.filter = "none";
      }
      if (callerIdEl) {
        _setHtmlIfChanged(callerIdEl, rxData.src_id ? `(<span class="dmr-id-text">${rxData.src_id}</span>)` : "");
        callerIdEl.style.filter = "none";
        const userObj = getUserCallsigns()[rxData.src_id] || {};
        const callerCity = rxData.city || (card._lastRx && card._lastRx[s] && card._lastRx[s].city) || userObj.city || "";
        if (rxData.src_id && !isSingleRx) {
          callerIdEl.dataset.radioId = rxData.src_id;
          callerIdEl.dataset.callsign = rxData.src_callsign || "";
          callerIdEl.dataset.name = rxData.src_name || "";
          callerIdEl.dataset.country = callerCountry?.name_en || "";
          if (callerCity) callerIdEl.dataset.city = callerCity;
          callerIdEl.title = (typeof window !== "undefined" && window.t)
            ? window.t("vfo.set_caller_tx_title", { id: rxData.src_id }, `Set ID ${rxData.src_id} for TX (Private Call)`)
            : `Set ID ${rxData.src_id} for TX (Private Call)`;
        } else {
          delete callerIdEl.dataset.radioId;
          delete callerIdEl.dataset.callsign;
          delete callerIdEl.dataset.name;
          delete callerIdEl.dataset.country;
          delete callerIdEl.dataset.city;
          callerIdEl.removeAttribute("title");
        }
      }
      if (callerCountryEl) {
        const callerCity = rxData.city || (card._lastRx && card._lastRx[s] && card._lastRx[s].city) || (getUserCallsigns()[rxData.src_id]?.city) || "";
        _setTextIfChanged(callerCountryEl, formatCallerLocation(callerCountry, callerCity));
        callerCountryEl.dataset.city = callerCity;
        callerCountryEl.style.filter = "none";
      }

      // Bottom row: destination room (# for YSF) or TG of the RECEIVED call
      const rawTgName = isM17Rx
        ? (rxData.dst_name || "M17")
        : (isYsfRx
          ? (rxData.dst_name || (rxData.dst_id ? `YSF #${rxData.dst_id}` : ""))
          : (getNetworkRawTgName(rxData.dst_id, netType) || rxData.dst_name || (rxData.dst_id === 9990 ? "Parrot / Echo" : "")));
      if (tgFlagEl) {
        const tgCountryInfo = isM17Rx
          ? { name: "M17", name_en: "M17", flag: "🌐" }
          : (isYsfRx
            ? { name: "YSF", name_en: "YSF", flag: "🌐" }
            : ((rxData.call_type === "GROUP" && isNonMccNet)
              ? { name: netType.toUpperCase(), name_en: netType.toUpperCase(), flag: "🌐" }
              : getCountryInfo(rxData.dst_id)));
        updateFlagElement(tgFlagEl, tgCountryInfo, !isYsfRx && !isM17Rx && rxData.dst_id === 9990);
        tgFlagEl.style.filter = "none";
      }
      if (tgTextEl) {
        const tgPrefix = isYsfRx ? "#" : (rxData.call_type === "GROUP" ? "TG" : "Call");
        const tgTitle = isYsfRx
          ? ((typeof window !== "undefined" && window.t)
            ? window.t("ysf.vfo_room_title", { id: rxData.dst_id }, `YSF Room #${rxData.dst_id}`)
            : `YSF Room #${rxData.dst_id}`)
          : ((typeof window !== "undefined" && window.t)
            ? window.t("vfo.set_tg_tx_title", { tg: rxData.dst_id }, `Set TG ${rxData.dst_id} for TX on this hotspot`)
            : `Set TG ${rxData.dst_id} for TX on this hotspot`);
        const nextTgHtml = renderTgTextHtml(rxData.dst_id, tgPrefix, rawTgName, tgTitle, isYsfRx ? "ysf" : (rxData.call_type === "GROUP" ? netType : null));
        _setHtmlIfChanged(tgTextEl, nextTgHtml);
        tgTextEl.dataset.tgId = rxData.dst_id;
        tgTextEl.style.filter = "none";
        tgTextEl.title = tgTitle;
      }

      // Toggle dimmed state: recent/active vs idle last correspondent
      if (isWithinHoldTime) {
        vfo.classList.remove("vfo-last-caller-dimmed");
      } else {
        vfo.classList.add("vfo-last-caller-dimmed");
        if (vfo.classList.contains("vfo-rx-active")) {
          vfo.classList.remove("vfo-rx-active");
          updateCardModeBadge(card);
        }
      }
    } else {
      // No call received yet on this slot: Clean reset to Standby & Default slot TG!
      vfo.classList.remove("vfo-last-caller-dimmed");
      if (vfo.classList.contains("vfo-rx-active")) {
        vfo.classList.remove("vfo-rx-active");
        updateCardModeBadge(card);
      }
      const defTg = s === 1 ? tg1 : tg2;
      const tgNamesFallback = getTgNamesMap();
      const parrotShort = (typeof window !== "undefined" && window.t) ? window.t("tg_special.9990", {}, "Parrot (Echo)") : "Parrot (Echo)";
      const wwShort = (typeof window !== "undefined" && window.t) ? window.t("tg_special.91", {}, "Worldwide") : "Worldwide";
      const ru1Short = (typeof window !== "undefined" && window.t) ? window.t("tg_special.2501", {}, "Russia 1 (National)") : "Russia 1 (National)";
      const defTgName = tgNamesFallback[defTg] || (defTg === 9990 ? parrotShort : (defTg === 91 ? wwShort : (defTg === 2501 ? ru1Short : "")));
      const defCountry = getCountryInfo(defTg);

      if (callerCallEl) {
        const standbyTxt = (typeof window !== "undefined" && window.t)
          ? window.t("vfo.standby", {}, "Waiting for call...")
          : "Waiting for call...";
        _setTextIfChanged(callerCallEl, standbyTxt);
        callerCallEl.dataset.standby = "1";
        callerCallEl.style.filter = "none";
        callerCallEl.classList.remove("caller-active");
        delete callerCallEl.dataset.radioId;
        delete callerCallEl.dataset.callsign;
        delete callerCallEl.dataset.name;
        callerCallEl.removeAttribute("title");
      }
      const callerMapBtn = vfo.querySelector(".btn-caller-map");
      if (callerMapBtn) {
        callerMapBtn.style.display = "none";
        delete callerMapBtn.dataset.lat;
        delete callerMapBtn.dataset.lon;
        delete callerMapBtn.dataset.grid;
        delete callerMapBtn.dataset.callsign;
      }
      if (callerFlagEl) {
        updateFlagElement(callerFlagEl, null, false);
        callerFlagEl.style.filter = "none";
      }
      if (callerIdEl) {
        _setTextIfChanged(callerIdEl, "");
        delete callerIdEl.dataset.radioId;
        delete callerIdEl.dataset.callsign;
        delete callerIdEl.dataset.name;
        delete callerIdEl.dataset.country;
        delete callerIdEl.dataset.city;
        callerIdEl.removeAttribute("title");
      }
      if (callerCountryEl) {
        _setTextIfChanged(callerCountryEl, "");
        delete callerCountryEl.dataset.city;
        callerCountryEl.style.filter = "none";
      }
      if (tgFlagEl) {
        if (tgFlagEl.innerHTML !== "") {
          tgFlagEl.innerHTML = "";
        }
        tgFlagEl._currentFlagKey = "";
        tgFlagEl.style.filter = "none";
      }
      if (tgTextEl) {
        _setHtmlIfChanged(tgTextEl, "");
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
    if (netType === "m17" || card.classList.contains("card-net-m17")) {
      quickInp.placeholder = "M17-M17 C / MOD";
    } else if (netType === "ysf" || card.classList.contains("card-net-ysf")) {
      quickInp.placeholder = "ID #";
    } else if (netType === "allstar" || card.classList.contains("card-net-allstar")) {
      quickInp.placeholder = "Node #";
    } else {
      quickInp.placeholder = "TG #";
    }
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
  if (notifyServer) {
    if (ws && ws.readyState === WebSocket.OPEN) {
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

  // 3. If caller ID, cache correspondent info in USER_CALLSIGNS (only if VFO row matches this caller ID)
  if (type === "CALLER") {
    const vfoRow = card ? card.querySelector(s === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row") : null;
    const callEl = vfoRow ? vfoRow.querySelector(".ts-caller-call") : null;
    const idEl = vfoRow ? vfoRow.querySelector(".ts-caller-id") : null;
    const countryEl = vfoRow ? vfoRow.querySelector(".ts-caller-country") : null;

    const rowRadioId = parseInt(idEl?.dataset.radioId || callEl?.dataset.radioId || "0", 10);
    const callsign = (idEl?.dataset.callsign || callEl?.dataset.callsign || "").trim();
    const name = (idEl?.dataset.name || callEl?.dataset.name || "").trim();
    const country = (idEl?.dataset.country || countryEl?.textContent || "").trim();
    const city = (idEl?.dataset.city || countryEl?.dataset.city || "").trim();

    const users = getUserCallsigns();
    if (rowRadioId === tid && callsign) {
      users[tid] = {
        callsign: callsign,
        name: name || (users[tid] && users[tid].name) || "",
        country: country || (users[tid] && users[tid].country) || "",
        city: city || (users[tid] && users[tid].city) || ""
      };
      try {
        localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify(users));
      } catch (e) {}
    } else if (!users[tid] || !users[tid].callsign) {
      users[tid] = {
        callsign: `ID ${tid}`,
        name: "",
        country: "",
        city: ""
      };
    }
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
  window.getStoredLastRx = getStoredLastRx;
  window.saveStoredLastRx = saveStoredLastRx;

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
    selectHotspotTargetId,
    getStoredLastRx,
    saveStoredLastRx
  });
}
