import { getCountryInfo, getFlagBadgeHtml, cleanName, getCleanTgDesc, escapeHtml } from '../core/formatters.js';
import { showToast } from '../core/toast.js';
import { showLongPressEffect } from '../ui/long-press.js';
import { resolveHotspotId, pushNavState, notifyNavClosed, getHotspotSlot } from '../core/state.js';

/**
 * ProxDMR Quick Assign & BrandMeister Extended Info Module
 * Handles long-press dispatch on callsigns/TGs, Quick Assign modal,
 * Contact addition, PTT assignment, Quick Memory (M1-M5), Direct Routing,
 * and BrandMeister API v2 Info Viewer modal.
 */

function getWs() {
  return window.ws;
}

function getHotspotDisplayName(hid) {
  if (typeof window.getHotspotDisplayName === "function") {
    return window.getHotspotDisplayName(hid);
  }
  return "Main 📻";
}

function setTg(tg, slot, hid) {
  if (typeof window.setTg === "function") {
    return window.setTg(tg, slot, hid);
  }
}

function setActiveSlot(slot) {
  if (typeof window.setActiveSlot === "function") {
    return window.setActiveSlot(slot);
  }
}

function switchActiveHotspot(hid) {
  if (typeof window.switchActiveHotspot === "function") {
    return window.switchActiveHotspot(hid);
  }
}

function getHotspotTg(hid, slot) {
  if (typeof window.getHotspotTg === "function") {
    return window.getHotspotTg(hid, slot);
  }
  return null;
}

function setHotspotTg(hid, slot, tg, tune = true) {
  if (typeof window.setHotspotTg === "function") {
    return window.setHotspotTg(hid, slot, tg, tune);
  }
}

function setCardSlot(card, slot, updateUI = true) {
  if (typeof window.setCardSlot === "function") {
    return window.setCardSlot(card, slot, updateUI);
  }
}

function selectHotspotTargetId(card, hid, slot, targetId, targetType) {
  if (typeof window.selectHotspotTargetId === "function") {
    return window.selectHotspotTargetId(card, hid, slot, targetId, targetType);
  }
}

function collapseHotspot(hid) {
  if (typeof window.collapseHotspot === "function") {
    return window.collapseHotspot(hid);
  }
}

function expandHotspot(hid) {
  if (typeof window.expandHotspot === "function") {
    return window.expandHotspot(hid);
  }
}

function loadBmTgStaticGroups(hid) {
  if (typeof window.loadBmTgStaticGroups === "function") {
    return window.loadBmTgStaticGroups(hid);
  }
  return Promise.resolve();
}

function closeCallIdModal() {
  if (typeof window.closeCallIdModal === "function") {
    return window.closeCallIdModal();
  }
}

function closeSearchTgIdModal() {
  if (typeof window.closeSearchTgIdModal === "function") {
    return window.closeSearchTgIdModal();
  }
}

function openContactEditModal(node, parentId, type) {
  if (typeof window.openContactEditModal === "function") {
    return window.openContactEditModal(node, parentId, type);
  }
}

function saveContactsToServer() {
  if (typeof window.saveContactsToServer === "function") {
    return window.saveContactsToServer();
  }
}

function renderContactsTree(filterText) {
  if (typeof window.renderContactsTree === "function") {
    return window.renderContactsTree(filterText);
  }
}

function findNodeInTree(nodes, id) {
  if (typeof window.findNodeInTree === "function") {
    return window.findNodeInTree(nodes, id);
  }
  return null;
}

function findParentNodeInTree(nodes, id) {
  if (typeof window.findParentNodeInTree === "function") {
    return window.findParentNodeInTree(nodes, id);
  }
  return null;
}

// Cached DOM Elements for Quick Contact & Action Buttons
let quickContactSection = null;
let quickContactStatusBadge = null;
let quickContactHint = null;
let quickContactExistsBox = null;
let quickContactExistsMsg = null;
let btnQuickContactEditExisting = null;
let quickContactAddBox = null;
let quickContactName = null;
let quickContactCallsignCol = null;
let quickContactCallsign = null;
let quickContactFolder = null;
let btnQuickContactSave = null;
let btnQuickContactOpenFull = null;
let contactsSearchInput = null;
let btnTgCall = null;
let btnDirectCall = null;
let btnAddContact = null;
let btnAddMem = null;

function ensureQuickAssignDom() {
  if (!quickContactSection) {
    quickContactSection = document.getElementById("quickContactSection");
    quickContactStatusBadge = document.getElementById("quickContactStatusBadge");
    quickContactHint = document.getElementById("quickContactHint");
    quickContactExistsBox = document.getElementById("quickContactExistsBox");
    quickContactExistsMsg = document.getElementById("quickContactExistsMsg");
    btnQuickContactEditExisting = document.getElementById("btnQuickContactEditExisting");
    quickContactAddBox = document.getElementById("quickContactAddBox");
    quickContactName = document.getElementById("quickContactName");
    quickContactCallsignCol = document.getElementById("quickContactCallsignCol");
    quickContactCallsign = document.getElementById("quickContactCallsign");
    quickContactFolder = document.getElementById("quickContactFolder");
    btnQuickContactSave = document.getElementById("btnQuickContactSave");
    btnQuickContactOpenFull = document.getElementById("btnQuickContactOpenFull");
    contactsSearchInput = document.getElementById("contactsSearchInput");
    btnTgCall = document.getElementById("btnTgCall");
    btnDirectCall = document.getElementById("btnDirectCall");
    btnAddContact = document.getElementById("btnAddContact");
    btnAddMem = document.getElementById("btnAddMem");
  }
}

// --- Quick Assign TG/ID to Hotspot & TS Subsystem (Long-Press) ---
function extractTgOrIdFromElement(target) {
  if (!target || !target.closest) return null;

  // PTT button is strictly for transmission and must never open long-press assignment / BM info modals!
  if (target.closest(".ptt-button")) return null;

  const cardEl = target.closest(".radio-container");
  const hotspotId = cardEl ? resolveHotspotId(cardEl.dataset.hotspotId) : resolveHotspotId(window.activeHotspotId);

  // A. Check if clicked on/in TalkGroup element (VFO, Heard Calls, Quick Tune, etc.)
  const tgEl = target.closest(".ts-tg-pill, .vfo-tg-pill, .ts-tg-text, .vfo-tg-text, .ts-tg-desc, .vfo-tg-desc, .btn-quick-tune-tg, .mobile-tg-pill, .tg-plain-link, .cell-tg");
  if (tgEl) {
    const pill = tgEl.closest("[data-tg]") || tgEl.querySelector("[data-tg]") || tgEl.closest("[data-tg-id]") || tgEl.querySelector("[data-tg-id]") || tgEl;
    let rawTg = pill.dataset.tg || pill.dataset.tgId;
    if (!rawTg) {
      const m = tgEl.textContent.match(/\b(?:TG\s*)?(\d{1,8})\b/i);
      if (m) rawTg = m[1];
    }
    const tg = parseInt(rawTg, 10);
    if (tg > 0) {
      const tgName = (typeof (window.TG_NAMES || {}) !== "undefined" && (window.TG_NAMES || {})[tg]) ? (window.TG_NAMES || {})[tg] : (tg === 9990 ? "Parrot / Echo" : "");
      return {
        type: "TG",
        value: tg,
        name: tgName ? getCleanTgDesc(tg, tgName) : "",
        element: tgEl,
        hotspotId: hotspotId
      };
    }
  }

  // B. Check if clicked on/in Caller ID / Callsign element (VFO, Heard Calls, etc.)
  const idEl = target.closest(".ts-caller-id, .vfo-caller-id, .ts-caller-call, .vfo-caller-call, .cell-station, .station-text, .station-text-mobile");
  if (idEl) {
    const withData = idEl.closest("[data-radio-id]") || idEl.querySelector("[data-radio-id]") || idEl.closest("[data-id]") || idEl;
    let rawId = withData.dataset.radioId;
    if (!rawId && withData.dataset.id && /^\d+$/.test(withData.dataset.id)) {
      rawId = withData.dataset.id;
    }
    if (!rawId) {
      const m = idEl.textContent.match(/\b(\d{7})\b/) || idEl.textContent.match(/\b(\d{4,8})\b/);
      if (m) rawId = m[1];
    }
    const idNum = parseInt(rawId, 10);
    if (idNum > 0) {
      let callsign = withData.dataset.callsign || "";
      let name = withData.dataset.name || "";
      if (!callsign && !name) {
        const txt = idEl.textContent.replace(/\(\d+\)/g, "").trim();
        if (txt && !txt.includes("Ожидание") && !txt.includes("...")) {
          callsign = txt;
        }
      }
      if (!callsign && window.USER_CALLSIGNS && window.USER_CALLSIGNS[idNum] && window.USER_CALLSIGNS[idNum].callsign) {
        callsign = window.USER_CALLSIGNS[idNum].callsign;
      }
      return {
        type: "ID",
        value: idNum,
        callsign: callsign,
        name: [callsign, name].filter(Boolean).join(" "),
        element: idEl,
        hotspotId: hotspotId
      };
    }
  }

  return null;
}

function getCardPttTarget(card) {
  const cardEl = card || document.querySelector(".radio-container");
  const cid = resolveHotspotId(cardEl ? cardEl.dataset.hotspotId : window.activeHotspotId);
  const activeCardSlot = (cardEl && cardEl._activeSlot) || getHotspotSlot(cid) || window.activeSlot || 2;
  
  let curTg = getHotspotTg(cid, activeCardSlot) || (activeCardSlot === 1 ? 91 : 2501);
  let isCaller = false;

  const infoEl = cardEl ? cardEl.querySelector(".ptt-target-info") : null;
  if (infoEl && infoEl.textContent) {
    const m = infoEl.textContent.trim().match(/(?:TS\d+[^a-zA-Z0-9]+)?(ID|TG)\s*(\d+)/i);
    if (m) {
      if (m[1].toUpperCase() === "ID") isCaller = true;
      const parsed = parseInt(m[2], 10);
      if (parsed > 0) curTg = parsed;
    }
  }

  const u = (typeof (window.USER_CALLSIGNS || {}) !== "undefined" && (window.USER_CALLSIGNS || {})[curTg]) || null;
  if (u) {
    isCaller = true;
  }

  let descName = "";
  const descEl = cardEl ? cardEl.querySelector(".ptt-target-desc") : null;
  if (descEl && descEl.textContent && descEl.textContent.trim()) {
    descName = descEl.textContent.trim();
  } else if (u) {
    const call = (u.callsign || "").trim();
    const name = (u.name || "").trim();
    descName = [call, name].filter(Boolean).join(" ").trim();
  } else if (typeof (window.TG_NAMES || {}) !== "undefined" && (window.TG_NAMES || {})[curTg]) {
    descName = String((window.TG_NAMES || {})[curTg]).trim();
  } else if (curTg === 9990) {
    descName = "Parrot / Echo";
  }

  descName = getCleanTgDesc(curTg, descName);

  return {
    cid: cid,
    slot: activeCardSlot,
    value: curTg,
    type: isCaller ? "ID" : "TG",
    name: descName
  };
}

let currentQuickAssignTarget = null;
let lastLongPressHandledAt = 0;
let currentModalQuickMemHid = "default";

function getQuickMemory(slotNum, hid) {
  try {
    const cid = resolveHotspotId(hid || window.activeHotspotId);
    const perHsRaw = localStorage.getItem(`proxdmr_quick_mem_hs_${cid}_${slotNum}`);
    if (perHsRaw) return JSON.parse(perHsRaw);

    // Fallback for primary/default hotspot to legacy key
    const isPrimary = !hid || cid === "default" || (window.currentHotspots && window.currentHotspots[0] && String(window.currentHotspots[0].id) === cid);
    if (isPrimary) {
      const legacyRaw = localStorage.getItem(`proxdmr_quick_mem_${slotNum}`);
      if (legacyRaw) return JSON.parse(legacyRaw);
    }
  } catch (e) {}
  return null;
}

function saveQuickMemory(slotNum, target, hid) {
  try {
    const cid = resolveHotspotId(hid || window.activeHotspotId);
    const data = {
      id: target.value,
      type: target.type || "TG",
      name: target.name || "",
      timestamp: Date.now()
    };
    localStorage.setItem(`proxdmr_quick_mem_hs_${cid}_${slotNum}`, JSON.stringify(data));

    const isPrimary = cid === "default" || (window.currentHotspots && window.currentHotspots[0] && String(window.currentHotspots[0].id) === cid);
    if (isPrimary) {
      localStorage.setItem(`proxdmr_quick_mem_${slotNum}`, JSON.stringify(data));
    }

    renderQuickMemButtons(cid);
    const ws = getWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "set_quick_mem",
        key: `hs_${cid}_${slotNum}`,
        data: data
      }));
    }
    return data;
  } catch (e) {
    console.error("Failed to save quick memory:", e);
    return null;
  }
}

function clearQuickMemory(slotNum, hid) {
  try {
    const cid = resolveHotspotId(hid || window.activeHotspotId);
    localStorage.removeItem(`proxdmr_quick_mem_hs_${cid}_${slotNum}`);

    const isPrimary = cid === "default" || (window.currentHotspots && window.currentHotspots[0] && String(window.currentHotspots[0].id) === cid);
    if (isPrimary) {
      localStorage.removeItem(`proxdmr_quick_mem_${slotNum}`);
    }

    renderQuickMemButtons(cid);
    const ws = getWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "set_quick_mem",
        key: `hs_${cid}_${slotNum}`,
        data: null
      }));
    }
    return true;
  } catch (e) {
    console.error("Failed to clear quick memory:", e);
    return false;
  }
}

function renderQuickMemButtons(modalHid) {
  // 1. Update all card memory buttons (.btn-card-mem) for each radio-container individually
  document.querySelectorAll(".radio-container").forEach(card => {
    const cid = resolveHotspotId(card.dataset.hotspotId || window.activeHotspotId);
    const hsName = getHotspotDisplayName(cid);

    for (let slot = 1; slot <= 5; slot++) {
      const btn = card.querySelector(`.btn-card-mem[data-mem="${slot}"]`);
      if (!btn) continue;
      const data = getQuickMemory(slot, cid);
      const idEl = btn.querySelector(".mem-id");
      const descEl = btn.querySelector(".btn-card-mem-desc");

      if (data && data.id) {
        const isId = (data.type === "ID");
        btn.classList.add("has-data");
        btn.classList.toggle("is-id", isId);
        btn.classList.toggle("is-tg", !isId);
        if (idEl) {
          idEl.textContent = data.id;
          idEl.classList.toggle("is-id", isId);
          idEl.classList.toggle("is-tg", !isId);
        }
        let desc = (data.name || "").trim();
        if (!desc && data.type === "TG") {
          const raw = (typeof (window.TG_NAMES || {}) !== "undefined" && (window.TG_NAMES || {})[data.id]) || (data.id === 9990 ? "Parrot / Echo" : "");
          desc = getCleanTgDesc(data.id, raw);
        } else if (!desc && data.type === "ID" && typeof (window.USER_CALLSIGNS || {}) !== "undefined" && (window.USER_CALLSIGNS || {})[data.id]) {
          const u = (window.USER_CALLSIGNS || {})[data.id];
          desc = `${u.callsign || ""} ${u.name || ""}`.trim();
        }
        desc = getCleanTgDesc(data.id, desc);
        if (descEl) descEl.textContent = desc || "";
        btn.title = `[${hsName}] M${slot}: ${data.type || 'TG'} ${data.id}${desc ? ' (' + desc + ')' : ''}`;
      } else {
        btn.classList.remove("has-data", "is-id", "is-tg");
        if (idEl) {
          idEl.textContent = "—";
          idEl.classList.remove("is-id", "is-tg");
        }
        if (descEl) descEl.textContent = "—";
        const emptyLabel = window.t ? window.t("mem.empty_badge", {}, "Пусто") : "Пусто";
        btn.title = `[${hsName}] M${slot}: ${emptyLabel}`;
      }
    }
  });

  // 2. Update modal memory buttons (.btn-quick-mem)
  const effectiveModalHid = resolveHotspotId(modalHid || currentModalQuickMemHid || window.activeHotspotId);
  currentModalQuickMemHid = effectiveModalHid;
  const modalHsName = getHotspotDisplayName(effectiveModalHid);

  for (let slot = 1; slot <= 5; slot++) {
    const modalBtn = document.querySelector(`.btn-quick-mem[data-mem="${slot}"]`);
    if (modalBtn) {
      const data = getQuickMemory(slot, effectiveModalHid);
      const idEl = modalBtn.querySelector(".mem-id") || document.getElementById(`quickMemVal_${slot}`);
      const descEl = modalBtn.querySelector(".btn-quick-mem-desc") || document.getElementById(`quickMemDesc_${slot}`);

      if (data && data.id) {
        const isId = (data.type === "ID");
        modalBtn.classList.add("has-data");
        modalBtn.classList.toggle("is-id", isId);
        modalBtn.classList.toggle("is-tg", !isId);
        if (idEl) {
          idEl.textContent = data.id;
          idEl.classList.toggle("is-id", isId);
          idEl.classList.toggle("is-tg", !isId);
        }
        let desc = (data.name || "").trim();
        if (!desc && data.type === "TG") {
          const raw = (typeof (window.TG_NAMES || {}) !== "undefined" && (window.TG_NAMES || {})[data.id]) || (data.id === 9990 ? "Parrot / Echo" : "");
          desc = getCleanTgDesc(data.id, raw);
        } else if (!desc && data.type === "ID" && typeof (window.USER_CALLSIGNS || {}) !== "undefined" && (window.USER_CALLSIGNS || {})[data.id]) {
          const u = (window.USER_CALLSIGNS || {})[data.id];
          desc = `${u.callsign || ""} ${u.name || ""}`.trim();
        }
        desc = getCleanTgDesc(data.id, desc);
        if (descEl) descEl.textContent = desc || "";
        modalBtn.title = `[${modalHsName}] M${slot}: ${data.type || 'TG'} ${data.id}${desc ? ' (' + desc + ')' : ''} • Нажмите для перезаписи`;
      } else {
        modalBtn.classList.remove("has-data", "is-id", "is-tg");
        if (idEl) {
          idEl.textContent = "—";
          idEl.classList.remove("is-id", "is-tg");
        }
        if (descEl) descEl.textContent = "—";
        modalBtn.title = `[${modalHsName}] M${slot}: ${window.t ? window.t("mem.empty_save_hint", {}, "Пусто • Нажмите для сохранения") : "Пусто • Нажмите для сохранения"}`;
      }
    }
  }
}

let pendingMemClickTimer = null;
let lastMemClickInfo = null;

function executeSingleClickMem(cardMemBtn, slot, card, cid) {
  const mem = getQuickMemory(slot, cid);
  const hsName = getHotspotDisplayName(cid);

  if (!mem || !mem.id) {
    showToast(`💡 [${hsName}] Ячейка M${slot} пуста. Зажмите M${slot} долгим нажатием для записи ID из PTT.`, 3500);
    return;
  }

  const activeCardSlot = (card && card._activeSlot) || window.activeSlot || 2;

  switchActiveHotspot(cid);
  selectHotspotTargetId(card, cid, activeCardSlot, mem.id, mem.type === "ID" ? "CALLER" : "TG", cardMemBtn);

  const cleanDesc = getCleanTgDesc(mem.id, mem.name);
  const displayStr = `${mem.type || 'TG'} ${mem.id}${cleanDesc ? ' (' + cleanDesc + ')' : ''}`;
  showToast(`📻 [${hsName}] M${slot}: выбран ${displayStr} (TS${activeCardSlot})`, 3000);
}

function handleMemDoubleClick(cardMemBtn, slot, card, cid) {
  const hsName = getHotspotDisplayName(cid);
  const oldMem = getQuickMemory(slot, cid);

  clearQuickMemory(slot, cid);

  // Visual shake & red warning flash
  cardMemBtn.classList.remove("target-selected-pulse", "mem-cleared-flash");
  void cardMemBtn.offsetWidth;
  cardMemBtn.classList.add("mem-cleared-flash");
  setTimeout(() => {
    cardMemBtn.classList.remove("mem-cleared-flash");
  }, 600);

  // Tactile vibration
  if (navigator.vibrate) {
    try { navigator.vibrate([40, 50, 40]); } catch (ve) {}
  }

  if (oldMem && oldMem.id) {
    const cleanDesc = getCleanTgDesc(oldMem.id, oldMem.name);
    const descStr = cleanDesc ? ` (${cleanDesc})` : "";
    showToast(`🗑️ [${hsName}] Ячейка M${slot} очищена (было: ${oldMem.type || 'TG'} ${oldMem.id}${descStr})`, 3200);
  } else {
    showToast(`🗑️ [${hsName}] Ячейка M${slot} уже пуста`, 2000);
  }
}

// Delegated click handler for quick memory buttons on radio cards
document.addEventListener("click", (e) => {
  const cardMemBtn = e.target.closest(".btn-card-mem");
  if (!cardMemBtn) return;
  e.stopPropagation();

  // Prevent click right after a long-press was handled
  if (lastLongPressHandledAt && Date.now() - lastLongPressHandledAt < 2500) {
    e.preventDefault();
    return;
  }

  const slot = parseInt(cardMemBtn.dataset.mem, 10);
  const card = cardMemBtn.closest(".radio-container") || document.getElementById("radioContainer");
  const cid = resolveHotspotId(card ? card.dataset.hotspotId : window.activeHotspotId);
  const now = Date.now();

  // Check if this click is part of a rapid double-click (within 350ms or e.detail >= 2)
  const isFastDblClick = Boolean(
    (e.detail && e.detail >= 2) ||
    (lastMemClickInfo &&
      lastMemClickInfo.slot === slot &&
      lastMemClickInfo.cid === cid &&
      (now - lastMemClickInfo.time) < 350)
  );

  if (isFastDblClick) {
    // Cancel pending single click
    if (pendingMemClickTimer) {
      clearTimeout(pendingMemClickTimer);
      pendingMemClickTimer = null;
    }
    lastMemClickInfo = null;

    handleMemDoubleClick(cardMemBtn, slot, card, cid);
    return;
  }

  // Otherwise, handle as first click: cancel any previous click on another button and execute it
  if (pendingMemClickTimer) {
    clearTimeout(pendingMemClickTimer);
    pendingMemClickTimer = null;
    if (lastMemClickInfo && (lastMemClickInfo.slot !== slot || lastMemClickInfo.cid !== cid)) {
      const prevCard = document.querySelector(`.radio-container[data-hotspot-id="${lastMemClickInfo.cid}"]`) || document.getElementById("radioContainer");
      const prevBtn = prevCard ? prevCard.querySelector(`.btn-card-mem[data-mem="${lastMemClickInfo.slot}"]`) : null;
      if (prevBtn) {
        executeSingleClickMem(prevBtn, lastMemClickInfo.slot, prevCard, lastMemClickInfo.cid);
      }
    }
  }

  lastMemClickInfo = { slot, cid, time: now };
  pendingMemClickTimer = setTimeout(() => {
    pendingMemClickTimer = null;
    lastMemClickInfo = null;
    executeSingleClickMem(cardMemBtn, slot, card, cid);
  }, 250);
});

document.addEventListener("dblclick", (e) => {
  const cardMemBtn = e.target.closest(".btn-card-mem");
  if (!cardMemBtn) return;
  e.preventDefault();
  e.stopPropagation();
});

let currentTgIdActionTarget = null;
let directCallSelectedSlot = 1;

function openTgIdActionMenu(tgOrIdInfo) {
  if (!tgOrIdInfo || !tgOrIdInfo.value) return;
  if (window.isPttPressed) return; // Never open modal while PTT transmission is active
  lastLongPressHandledAt = 0;
  currentTgIdActionTarget = tgOrIdInfo;
  currentQuickAssignTarget = tgOrIdInfo;

  const modal = document.getElementById("tgIdActionMenuModal");
  if (!modal) return;

  if (window.I18N && typeof window.I18N.apply === "function") {
    window.I18N.apply(modal);
  }

  const pillEl = document.getElementById("tgIdActionMenuPill");
  const nameEl = document.getElementById("tgIdActionMenuName");

  if (pillEl) {
    if (tgOrIdInfo.type === "ID") {
      pillEl.innerHTML = `ID <span class="dmr-id-text">${tgOrIdInfo.value}</span>`;
    } else {
      pillEl.textContent = `${tgOrIdInfo.type || 'TG'} ${tgOrIdInfo.value}`;
    }
    pillEl.classList.toggle("is-id", tgOrIdInfo.type === "ID");
    pillEl.classList.toggle("is-tg", tgOrIdInfo.type !== "ID");
  }
  if (nameEl) {
    nameEl.textContent = tgOrIdInfo.name || tgOrIdInfo.callsign || "";
    nameEl.style.display = (tgOrIdInfo.name || tgOrIdInfo.callsign) ? "inline-block" : "none";
  }

  modal.classList.add("active");
  pushNavState("modal", "tgIdActionMenuModal");
}

function closeTgIdActionMenu(fromPopstate = false) {
  const modal = document.getElementById("tgIdActionMenuModal");
  if (modal && modal.classList.contains("active")) {
    modal.classList.remove("active");
    if (!fromPopstate) notifyNavClosed();
  }
}

// --- Action 1: Add to Contacts ---
function handleTgActionContact() {
  const target = currentTgIdActionTarget;
  if (!target) return;
  closeTgIdActionMenu();
  if (typeof closeSearchTgIdModal === "function") closeSearchTgIdModal();
  if (typeof closeCallIdModal === "function") closeCallIdModal();

  const isId = (target.type === "ID");
  const val = target.value;
  const callsignVal = target.callsign || "";
  let nameVal = target.name || "";

  openContactEditModal(null, null, isId ? "person" : "tg");

  const contactEditDmrId = document.getElementById("contactEditDmrId");
  const contactEditCallsign = document.getElementById("contactEditCallsign");
  const contactEditName = document.getElementById("contactEditName");
  const contactEditCity = document.getElementById("contactEditCity");
  const contactEditTg = document.getElementById("contactEditTg");
  const contactEditSlot = document.getElementById("contactEditSlot");

  if (isId) {
    if (contactEditDmrId) contactEditDmrId.value = val;
    if (contactEditCallsign) contactEditCallsign.value = callsignVal;
    if (contactEditName) contactEditName.value = nameVal;
    if (target.city && contactEditCity) contactEditCity.value = target.city;
  } else {
    if (contactEditTg) contactEditTg.value = val;
    if (contactEditName) contactEditName.value = nameVal;
  }
  if (target.slot && contactEditSlot) {
    contactEditSlot.value = (target.slot === 1 || target.slot === 2) ? target.slot : 0;
  }
}

// --- Action 2: Apply to PTT ---
function applyTgIdToPtt(target) {
  if (!target || !target.value) return;
  const targetVal = parseInt(target.value, 10);
  if (!targetVal || targetVal <= 0) return;

  const targetHid = resolveHotspotId(target.hotspotId || window.activeHotspotId || "default");
  const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${targetHid}"]`) || document.getElementById("radioContainer");
  const targetSlot = target.slot || (targetCard && targetCard._activeSlot) || window.activeSlot || 2;

  const hsObj = (Array.isArray(window.currentHotspots) && window.currentHotspots.find(h => resolveHotspotId(h.id) === targetHid)) || null;
  const hsName = hsObj ? (hsObj.name || targetHid) : (targetHid === "default" ? "Main 📻" : targetHid);

  if (target.type === "ID") {
    if (target.callsign || target.name) {
      (window.USER_CALLSIGNS || {})[targetVal] = {
        callsign: target.callsign || `ID ${targetVal}`,
        name: target.name || "",
        country: target.country || ""
      };
      try { localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify((window.USER_CALLSIGNS || {}))); } catch (_) {}
    }
    selectHotspotTargetId(targetCard, targetHid, targetSlot, targetVal, "CALLER");
    showToast(`🎙️ [${hsName}] PTT переписан на ID: ${targetVal}${target.name ? ' (' + target.name + ')' : ''}`, 3000);
  } else {
    if (target.name) {
      (window.TG_NAMES || {})[targetVal] = target.name;
      try { localStorage.setItem("proxdmr_tg_names_cache", JSON.stringify((window.TG_NAMES || {}))); } catch (_) {}
    }
    selectHotspotTargetId(targetCard, targetHid, targetSlot, targetVal, "TG");
    showToast(`🎙️ [${hsName}] PTT переписан на TG: ${targetVal}${target.name ? ' (' + target.name + ')' : ''}`, 3000);
  }
}

function handleTgActionPtt() {
  const target = currentTgIdActionTarget;
  if (!target) return;
  closeTgIdActionMenu();
  if (typeof closeSearchTgIdModal === "function") closeSearchTgIdModal();
  if (typeof closeCallIdModal === "function") closeCallIdModal();

  applyTgIdToPtt(target);
}

// --- Action 3: Quick Memory Picker (M1 - M5) ---
function openQuickMemPicker(target) {
  if (!target || !target.value) return;
  lastLongPressHandledAt = 0;
  currentTgIdActionTarget = target;
  currentQuickAssignTarget = target;

  const modal = document.getElementById("quickMemPickerModal");
  if (!modal) return;

  if (window.I18N && typeof window.I18N.apply === "function") {
    window.I18N.apply(modal);
  }

  const pillEl = document.getElementById("quickMemPickerPill");
  const nameEl = document.getElementById("quickMemPickerName");

  if (pillEl) {
    if (target.type === "ID") {
      pillEl.innerHTML = `ID <span class="dmr-id-text">${target.value}</span>`;
    } else {
      pillEl.textContent = `${target.type || 'TG'} ${target.value}`;
    }
    pillEl.classList.toggle("is-id", target.type === "ID");
    pillEl.classList.toggle("is-tg", target.type !== "ID");
  }
  if (nameEl) {
    nameEl.textContent = target.name || target.callsign || "";
    nameEl.style.display = (target.name || target.callsign) ? "inline-block" : "none";
  }

  currentModalQuickMemHid = resolveHotspotId(target.hotspotId || window.activeHotspotId || "default");

  const hsList = (Array.isArray(window.currentHotspots) && window.currentHotspots.length > 0)
    ? window.currentHotspots
    : [{ id: "default", name: "Основной хотспот", status: "ONLINE", callsign: "", dmr_id: "" }];

  const tabsWrap = document.getElementById("quickMemPickerHsWrap");
  if (tabsWrap) {
    if (hsList.length > 1) {
      tabsWrap.innerHTML = hsList.map(h => {
        const isActive = resolveHotspotId(h.id) === currentModalQuickMemHid;
        const hName = getHotspotDisplayName(h.id);
        return `<button type="button" class="btn-quick-mem-hs-tab ${isActive ? 'active' : ''}" data-hid="${h.id}">${hName}</button>`;
      }).join("");

      tabsWrap.querySelectorAll(".btn-quick-mem-hs-tab").forEach(tab => {
        tab.onclick = (e) => {
          e.stopPropagation();
          const chosenHid = resolveHotspotId(tab.dataset.hid);
          currentModalQuickMemHid = chosenHid;
          tabsWrap.querySelectorAll(".btn-quick-mem-hs-tab").forEach(t => t.classList.toggle("active", resolveHotspotId(t.dataset.hid) === chosenHid));
          renderPickerMemButtons(chosenHid);
        };
      });
    } else {
      tabsWrap.innerHTML = `<span class="quick-mem-single-hs">${hsList[0]?.name || 'Основной хотспот'}</span>`;
    }
  }

  renderPickerMemButtons(currentModalQuickMemHid);

  modal.classList.add("active");
  pushNavState("modal", "quickMemPickerModal");
}

function closeQuickMemPicker(fromPopstate = false) {
  const modal = document.getElementById("quickMemPickerModal");
  if (modal && modal.classList.contains("active")) {
    modal.classList.remove("active");
    if (!fromPopstate) notifyNavClosed();
  }
}

function renderPickerMemButtons(hid) {
  const memGrid = document.getElementById("quickMemPickerGrid");
  if (!memGrid) return;

  const effectiveModalHid = resolveHotspotId(hid || currentModalQuickMemHid || window.activeHotspotId);
  currentModalQuickMemHid = effectiveModalHid;
  const hsName = getHotspotDisplayName(effectiveModalHid);

  let html = "";
  for (let slot = 1; slot <= 5; slot++) {
    const data = getQuickMemory(slot, effectiveModalHid);
    const hasData = Boolean(data && data.id);
    const isId = (data && data.type === "ID");
    let idText = hasData ? data.id : "—";
    let descText = "—";
    if (hasData) {
      let desc = (data.name || "").trim();
      if (!desc && data.type === "TG") {
        const raw = (typeof (window.TG_NAMES || {}) !== "undefined" && (window.TG_NAMES || {})[data.id]) || (data.id === 9990 ? "Parrot / Echo" : "");
        desc = getCleanTgDesc(data.id, raw);
      } else if (!desc && data.type === "ID" && typeof (window.USER_CALLSIGNS || {}) !== "undefined" && (window.USER_CALLSIGNS || {})[data.id]) {
        const u = (window.USER_CALLSIGNS || {})[data.id];
        desc = `${u.callsign || ""} ${u.name || ""}`.trim();
      }
      descText = getCleanTgDesc(data.id, desc) || "Без имени";
    }

    html += `
      <button type="button" class="btn-quick-mem ${hasData ? 'has-data' : ''} ${isId ? 'is-id' : ''} ${hasData && !isId ? 'is-tg' : ''}" data-mem="${slot}">
        <span class="quick-mem-slot-badge">M${slot}</span>
        <span class="mem-id ${isId ? 'is-id' : ''} ${hasData && !isId ? 'is-tg' : ''}">${escapeHtml(String(idText))}</span>
        <span class="btn-quick-mem-desc">${escapeHtml(descText)}</span>
      </button>
    `;
  }
  memGrid.innerHTML = html;

  memGrid.querySelectorAll(".btn-quick-mem").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const slot = parseInt(btn.dataset.mem, 10);
      const target = currentTgIdActionTarget;
      if (!target) return;
      saveQuickMemory(slot, target, effectiveModalHid);
      const currentHsTitle = getHotspotDisplayName(effectiveModalHid);
      const displayStr = `${target.type || 'TG'} ${target.value}${target.name ? ' (' + target.name + ')' : ''}`;
      showToast(`💾 [${currentHsTitle}] Записано в память M${slot}: ${displayStr}`, 3500);
      closeQuickMemPicker();
    };
  });
}

function handleTgActionQuickMem() {
  const target = currentTgIdActionTarget;
  if (!target) return;
  closeTgIdActionMenu();
  openQuickMemPicker(target);
}

// --- Action 4: Direct Call / Routing Module ---
function openDirectCallModal(target) {
  if (!target || !target.value) return;
  lastLongPressHandledAt = 0;
  currentTgIdActionTarget = target;
  currentQuickAssignTarget = target;

  const modal = document.getElementById("directCallModal");
  if (!modal) return;

  if (window.I18N && typeof window.I18N.apply === "function") {
    window.I18N.apply(modal);
  }

  const pillEl = document.getElementById("directCallPill");
  const nameEl = document.getElementById("directCallName");

  if (pillEl) {
    if (target.type === "ID") {
      pillEl.innerHTML = `ID <span class="dmr-id-text">${target.value}</span>`;
    } else {
      pillEl.textContent = `${target.type || 'TG'} ${target.value}`;
    }
    pillEl.classList.toggle("is-id", target.type === "ID");
    pillEl.classList.toggle("is-tg", target.type !== "ID");
  }
  if (nameEl) {
    nameEl.textContent = target.name || target.callsign || "";
    nameEl.style.display = (target.name || target.callsign) ? "inline-block" : "none";
  }

  const directCallHsSelect = document.getElementById("directCallHsSelect");
  const directCallSlotToggleGroup = document.getElementById("directCallSlotToggleGroup");
  const btnApplyDirectCall = document.getElementById("btnApplyDirectCall");

  const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length > 0)
    ? window.currentHotspots
    : [{ id: "default", name: "Основной хотспот", status: "ONLINE", callsign: "", dmr_id: "" }];

  // Filter out hotspots where auto_tg_bm is disabled
  const eligibleHs = allHs.filter(hs => hs.auto_tg_bm !== false);
  const hsList = eligibleHs.length > 0 ? eligibleHs : allHs;

  let initialHid = resolveHotspotId(target.hotspotId || window.activeHotspotId || "default");
  if (!hsList.some(h => resolveHotspotId(h.id) === initialHid)) {
    initialHid = resolveHotspotId(hsList[0].id);
  }

  if (directCallHsSelect) {
    directCallHsSelect.innerHTML = hsList.map(hs => {
      const hsName = getHotspotDisplayName(hs.id);
      const isOnline = hs.status === "ONLINE";
      const sub = [hs.callsign, hs.dmr_id ? `ID: ${hs.dmr_id}` : ""].filter(Boolean).join(" • ");
      const isSel = (resolveHotspotId(hs.id) === initialHid);
      return `<option value="${hs.id}" ${isSel ? 'selected' : ''}>${isOnline ? '🟢 ' : '⚪ '}${hsName}${sub ? ' (' + sub + ')' : ''}</option>`;
    }).join("");
  }

  const origCard = document.querySelector(`.radio-container[data-hotspot-id="${initialHid}"]`);
  directCallSelectedSlot = target.slot || (origCard && (origCard._activeSlot === 1 || origCard._activeSlot === 2) ? origCard._activeSlot : (getHotspotSlot(initialHid) || 1));

  if (directCallSlotToggleGroup) {
    directCallSlotToggleGroup.querySelectorAll(".btn-slot-toggle").forEach(btn => {
      const s = parseInt(btn.dataset.slot, 10);
      btn.classList.toggle("active", s === directCallSelectedSlot);
      btn.onclick = (e) => {
        e.preventDefault();
        directCallSelectedSlot = s;
        directCallSlotToggleGroup.querySelectorAll(".btn-slot-toggle").forEach(b => {
          b.classList.toggle("active", parseInt(b.dataset.slot, 10) === directCallSelectedSlot);
        });
      };
    });
  }

  if (btnApplyDirectCall) {
    btnApplyDirectCall.onclick = (e) => {
      e.preventDefault();
      const chosenHid = directCallHsSelect ? directCallHsSelect.value : initialHid;
      const targetSlot = directCallSelectedSlot || 1;
      const hsObj = hsList.find(h => h.id === chosenHid || resolveHotspotId(h.id) === resolveHotspotId(chosenHid));
      const hsTitle = hsObj ? (hsObj.name || hsObj.id) : chosenHid;
      closeDirectCallModal();
      handleQuickAssignSelect(chosenHid, targetSlot, target.value, hsTitle);
    };
  }

  modal.classList.add("active");
  pushNavState("modal", "directCallModal");
}

function closeDirectCallModal(fromPopstate = false) {
  const modal = document.getElementById("directCallModal");
  if (modal && modal.classList.contains("active")) {
    modal.classList.remove("active");
    if (!fromPopstate) notifyNavClosed();
  }
}

function handleTgActionDirectCall() {
  const target = currentTgIdActionTarget;
  if (!target) return;
  closeTgIdActionMenu();
  openDirectCallModal(target);
}

// --- Action 5: BrandMeister Extended INFO ---
function handleTgActionInfo() {
  const target = currentTgIdActionTarget;
  if (!target) return;
  closeTgIdActionMenu();
  if (typeof closeSearchTgIdModal === "function") closeSearchTgIdModal();
  if (typeof closeCallIdModal === "function") closeCallIdModal();

  let callsign = target.callsign || "";
  const targetIdStr = String(target.value || "").trim();
  const rid = parseInt(targetIdStr, 10);
  if (!callsign && !isNaN(rid) && window.USER_CALLSIGNS && window.USER_CALLSIGNS[rid] && window.USER_CALLSIGNS[rid].callsign) {
    callsign = window.USER_CALLSIGNS[rid].callsign;
  }
  const detectedType = target.type || (targetIdStr.length >= 7 ? "ID" : "TG");

  openBmInfoModal("auto", {
    value: target.value,
    callsign: callsign,
    name: target.name,
    country: target.country,
    city: target.city,
    type: detectedType,
    hotspotId: target.hotspotId
  });
}

// Compatibility aliases
function openQuickAssignModal(tgOrIdInfo) {
  openTgIdActionMenu(tgOrIdInfo);
}

function closeQuickAssignModal(clearTarget = true) {
  closeTgIdActionMenu();
  closeQuickMemPicker();
  closeDirectCallModal();
  if (clearTarget) {
    currentTgIdActionTarget = null;
    currentQuickAssignTarget = null;
  }
}

// ==========================================================
// QUICK ASSIGN MODAL: CONTACT INTEGRATION
// ==========================================================
function findContactByTarget(type, value) {
  if (!value || typeof window.contactsTree === "undefined" || !Array.isArray(window.contactsTree)) return null;
  const isId = (type === "ID");
  const targetStr = String(value).trim();
  const targetNum = parseInt(value, 10);

  function search(nodes) {
    if (!Array.isArray(nodes)) return null;
    for (const n of nodes) {
      if (n.type === "folder") {
        if (n.children && n.children.length > 0) {
          const found = search(n.children);
          if (found) return found;
        }
      } else {
        if (isId) {
          if (n.dmr_id != null && (String(n.dmr_id).trim() === targetStr || parseInt(n.dmr_id, 10) === targetNum)) {
            return n;
          }
        } else {
          if (n.tg != null && (String(n.tg).trim() === targetStr || parseInt(n.tg, 10) === targetNum)) {
            return n;
          }
        }
      }
    }
    return null;
  }
  return search(window.contactsTree);
}

function setupQuickAssignContactUI(tgOrIdInfo, currentSlot = 1) {
  if (!quickContactSection || !tgOrIdInfo || !tgOrIdInfo.value) return;

  const isIdTarget = (tgOrIdInfo.type === "ID");
  const val = String(tgOrIdInfo.value).trim();

  let targetCallsign = tgOrIdInfo.callsign || "";
  if (!targetCallsign && tgOrIdInfo.name) {
    const parts = tgOrIdInfo.name.trim().split(/\s+/);
    if (parts.length > 0 && /^[A-Z0-9\/]{3,10}$/i.test(parts[0])) {
      targetCallsign = parts[0].toUpperCase();
    }
  }

  const existingNode = findContactByTarget(tgOrIdInfo.type, val);

  if (existingNode) {
    // Show Already in Contacts box
    if (quickContactExistsBox) quickContactExistsBox.style.display = "flex";
    if (quickContactAddBox) quickContactAddBox.style.display = "none";

    if (quickContactStatusBadge) {
      quickContactStatusBadge.textContent = "В контактах";
      quickContactStatusBadge.className = "quick-contact-badge is-saved";
      quickContactStatusBadge.style.display = "inline-block";
    }

    if (quickContactExistsMsg) {
      const parent = findParentNodeInTree(window.contactsTree, existingNode.id);
      const folderHtml = parent ? ` <span class="quick-contact-folder-pill">📁 ${escapeHtml(parent.name)}</span>` : "";
      const titleText = escapeHtml(existingNode.name || existingNode.callsign || (existingNode.tg ? `TG ${existingNode.tg}` : `ID ${existingNode.dmr_id}`));
      quickContactExistsMsg.innerHTML = `В книге: <strong>${titleText}</strong>${folderHtml}`;
    }

    if (btnQuickContactEditExisting) {
      btnQuickContactEditExisting.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const parent = findParentNodeInTree(window.contactsTree, existingNode.id);
        openContactEditModal(existingNode, parent ? parent.id : null);
      };
    }
  } else {
    // Show Quick Add form box
    if (quickContactExistsBox) quickContactExistsBox.style.display = "none";
    if (quickContactAddBox) quickContactAddBox.style.display = "block";

    if (quickContactStatusBadge) {
      quickContactStatusBadge.textContent = "Не в книге";
      quickContactStatusBadge.className = "quick-contact-badge is-new";
      quickContactStatusBadge.style.display = "inline-block";
    }

    // Populate folders
    if (quickContactFolder) {
      quickContactFolder.innerHTML = `<option value="">📁 [Корневой уровень]</option>`;
      function addFolderOptions(nodes, depth = 1) {
        if (!Array.isArray(nodes)) return;
        for (const n of nodes) {
          if (n.type === "folder") {
            const opt = document.createElement("option");
            opt.value = n.id;
            opt.textContent = `${"— ".repeat(depth - 1)}📁 ${n.name}`;
            quickContactFolder.appendChild(opt);
            if (n.children) addFolderOptions(n.children, depth + 1);
          }
        }
      }
      addFolderOptions(window.contactsTree, 1);

      // Smart select folder based on target type
      function findSmartFolder(nodes) {
        if (!Array.isArray(nodes)) return "";
        for (const n of nodes) {
          if (n.type === "folder") {
            const lower = (n.name || "").toLowerCase();
            if (isIdTarget) {
              if (lower.includes("контакт") || lower.includes("люди") || lower.includes("пользовател") || lower.includes("радиолюбител") || lower.includes("users")) {
                return n.id;
              }
            } else {
              if (lower.includes("групп") || lower.includes("tg") || lower.includes("talkgroup") || lower.includes("разговорн")) {
                return n.id;
              }
            }
            if (n.children) {
              const sub = findSmartFolder(n.children);
              if (sub) return sub;
            }
          }
        }
        return "";
      }
      const matchedFolderId = findSmartFolder(window.contactsTree);
      quickContactFolder.value = matchedFolderId || "";
    }

    // Setup inputs
    if (isIdTarget) {
      if (quickContactCallsignCol) quickContactCallsignCol.style.display = "block";
      if (quickContactCallsign) quickContactCallsign.value = targetCallsign || "";
      let cleanedName = (tgOrIdInfo.name || "").trim();
      if (targetCallsign && cleanedName.toUpperCase().startsWith(targetCallsign)) {
        cleanedName = cleanedName.substring(targetCallsign.length).replace(/^[-:—\s]+/, "").trim();
      }
      if (quickContactName) quickContactName.value = cleanedName || targetCallsign || `ID ${val}`;
    } else {
      if (quickContactCallsignCol) quickContactCallsignCol.style.display = "none";
      if (quickContactCallsign) quickContactCallsign.value = "";
      if (quickContactName) quickContactName.value = tgOrIdInfo.name || `TG ${val}`;
    }

    // Save button handler
    if (btnQuickContactSave) {
      btnQuickContactSave.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const nameVal = (quickContactName && quickContactName.value.trim()) || (isIdTarget ? (targetCallsign || `ID ${val}`) : `TG ${val}`);
        const parentId = (quickContactFolder && quickContactFolder.value) || null;
        const callsignVal = isIdTarget ? ((quickContactCallsign && quickContactCallsign.value.trim().toUpperCase()) || targetCallsign) : "";
        const slotVal = (currentSlot === 1 || currentSlot === 2) ? currentSlot : 0;

        const newNode = {
          id: "c_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
          type: isIdTarget ? "person" : "tg",
          name: nameVal,
          city: "",
          comment: "",
          slot_override: slotVal
        };

        if (isIdTarget) {
          newNode.callsign = callsignVal;
          newNode.dmr_id = parseInt(val, 10) || val;
          if (callsignVal || nameVal) {
            const dmrNum = parseInt(val, 10);
            if (dmrNum > 0) {
              (window.USER_CALLSIGNS || {})[dmrNum] = {
                callsign: callsignVal || `ID ${dmrNum}`,
                name: nameVal,
                country: ""
              };
              try { localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify((window.USER_CALLSIGNS || {}))); } catch (_) {}
            }
          }
        } else {
          newNode.tg = parseInt(val, 10) || val;
          const tgNum = parseInt(val, 10);
          if (tgNum > 0 && nameVal) {
            (window.TG_NAMES || {})[tgNum] = nameVal;
            try { localStorage.setItem("proxdmr_tg_names_cache", JSON.stringify((window.TG_NAMES || {}))); } catch (_) {}
          }
        }

        if (parentId) {
          const parent = findNodeInTree(window.contactsTree, parentId);
          if (parent) {
            if (!Array.isArray(parent.children)) parent.children = [];
            parent.children.push(newNode);
          } else {
            window.contactsTree.push(newNode);
          }
        } else {
          window.contactsTree.push(newNode);
        }

        saveContactsToServer();
        renderContactsTree(contactsSearchInput ? contactsSearchInput.value.trim() : "");
        showToast(`✅ «${nameVal}» сохранена в Контакты!`, 2500);
        setupQuickAssignContactUI(tgOrIdInfo, currentSlot);
      };
    }

    // Full modal button handler
    if (btnQuickContactOpenFull) {
      btnQuickContactOpenFull.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const parentId = (quickContactFolder && quickContactFolder.value) || null;
        const nameVal = (quickContactName && quickContactName.value.trim()) || (isIdTarget ? (targetCallsign || `ID ${val}`) : `TG ${val}`);
        const callsignVal = isIdTarget ? ((quickContactCallsign && quickContactCallsign.value.trim().toUpperCase()) || targetCallsign) : "";
        const slotVal = (currentSlot === 1 || currentSlot === 2) ? currentSlot : 0;

        openContactEditModal(null, parentId, isIdTarget ? "person" : "tg");
        const contactEditName = document.getElementById("contactEditName");
        const contactEditCallsign = document.getElementById("contactEditCallsign");
        const contactEditDmrId = document.getElementById("contactEditDmrId");
        const contactEditTg = document.getElementById("contactEditTg");
        const contactEditSlot = document.getElementById("contactEditSlot");
        if (contactEditName) contactEditName.value = nameVal;
        if (isIdTarget) {
          if (contactEditCallsign) contactEditCallsign.value = callsignVal;
          if (contactEditDmrId) contactEditDmrId.value = val;
        } else {
          if (contactEditTg) contactEditTg.value = val;
        }
        if (contactEditSlot) contactEditSlot.value = slotVal;
      };
    }
  }
}

function refreshQuickAssignContactUI() {
  if (currentQuickAssignTarget) {
    const modal = document.getElementById("quickAssignModal");
    if (modal && modal.classList.contains("active")) {
      const activeBtn = document.querySelector("#quickAssignSlotToggleGroup .btn-slot-toggle.active");
      const slot = activeBtn ? parseInt(activeBtn.dataset.slot, 10) : 1;
      setupQuickAssignContactUI(currentQuickAssignTarget, slot);
    }
  }
}

// ==========================================================
// BRANDMEISTER EXTENDED INFO VIEWER (API v2)
// ==========================================================
let currentBmInfoQuery = null;

export function safeEscapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==========================================================
// DYNAMIC SIZING & VIEWPORT CONTAINMENT FOR QUICK ASSIGN MODAL
// ==========================================================
function adjustQuickAssignModalBounds() {
  const modal = document.getElementById("quickAssignModal");
  if (!modal || !modal.classList.contains("active")) return;

  const contentEl = modal.querySelector(".quick-assign-modal");
  const bodyEl = modal.querySelector(".quick-assign-body");
  const headerEl = modal.querySelector(".modal-header");
  const footerEl = modal.querySelector(".quick-assign-footer");
  if (!contentEl || !bodyEl) return;

  const availW = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 320);
  const availH = Math.max(300, window.innerHeight || document.documentElement.clientHeight || 300);

  const isPc = availW >= 768;
  const marginX = isPc ? 32 : 16;
  const marginY = isPc ? 40 : 20;

  // Strict maximum available height within viewport
  const maxAvailHeight = Math.max(260, availH - marginY);

  // Maximum allowed width: strictly <= 85% of screen width on PC, or (availW - marginX) on mobile
  const maxAllowedWidth = isPc ? Math.floor(availW * 0.85) : Math.min(availW - marginX, 500);
  // On PC: 1.5x wider (520px * 1.5 = 780px)
  const baseWidth = isPc ? Math.min(780, maxAllowedWidth) : Math.min(availW - marginX, 480);

  // 1. For PC: first attempt to expand width up to maxAllowedWidth to fit content into available height
  if (isPc) {
    contentEl.style.width = `${baseWidth}px`;
    if (baseWidth >= 640) {
      contentEl.classList.add("is-wide-modal");
    } else {
      contentEl.classList.remove("is-wide-modal");
    }
    contentEl.style.maxHeight = "none";
    bodyEl.style.maxHeight = "none";

    void contentEl.offsetHeight; // reflow measurement

    const naturalHeight = contentEl.scrollHeight;

    if (naturalHeight > maxAvailHeight) {
      // Step through candidate wider widths up to maxAllowedWidth
      const stepWidths = [780, 880, 980, 1100, maxAllowedWidth].filter(w => w > baseWidth && w <= maxAllowedWidth);
      if (!stepWidths.includes(maxAllowedWidth)) {
        stepWidths.push(maxAllowedWidth);
      }

      let bestWidth = baseWidth;
      for (const testW of stepWidths) {
        contentEl.style.width = `${testW}px`;
        contentEl.classList.add("is-wide-modal");
        void contentEl.offsetHeight; // reflow
        bestWidth = testW;
        if (contentEl.scrollHeight <= maxAvailHeight) {
          // Content fits completely vertically!
          break;
        }
      }

      contentEl.style.width = `${bestWidth}px`;
      contentEl.classList.add("is-wide-modal");
    }
  } else {
    // Mobile / tablet
    contentEl.style.width = `${Math.min(availW - marginX, 480)}px`;
    contentEl.classList.remove("is-wide-modal");
  }

  // 2. Calculate vertical capacity and constrain strictly to screen height with internal scrolling
  void contentEl.offsetHeight;
  contentEl.style.maxHeight = `${maxAvailHeight}px`;

  const curHeaderH = headerEl ? headerEl.offsetHeight : 54;
  const curFooterH = footerEl ? footerEl.offsetHeight : 54;
  const maxBodyH = Math.max(100, maxAvailHeight - curHeaderH - curFooterH);

  bodyEl.style.maxHeight = `${maxBodyH}px`;
  bodyEl.style.overflowY = "auto";

  // Auto-scroll target TG into view if highlighted inside pill box
  requestAnimationFrame(() => {
    const activePill = contentEl.querySelector(".bm-mini-pill.is-active-target");
    if (activePill && typeof activePill.scrollIntoView === "function") {
      activePill.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}

window.addEventListener("resize", () => {
  const modal = document.getElementById("quickAssignModal");
  if (modal && modal.classList.contains("active")) {
    adjustQuickAssignModalBounds();
  }
});

window.adjustQuickAssignModalBounds = adjustQuickAssignModalBounds;

// ==========================================================
// BRANDMEISTER INLINE SUMMARY & QUICK ACTIONS
// ==========================================================
const bmSummaryCache = new Map();

async function loadBmSummary(targetType, targetId, callsign, hotspotId, forceRefresh = false) {
  const bodyEl = document.getElementById("quickBmSummaryBody");
  const refreshBtn = document.getElementById("btnRefreshBmSummary");
  if (!bodyEl || !targetId) return;

  const cleanType = String(targetType || "TG").toUpperCase();
  const cleanId = String(targetId).trim();
  const hid = resolveHotspotId(hotspotId || window.activeHotspotId || "default");
  const cacheKey = `${cleanType}_${cleanId}_${hid}`;

  if (refreshBtn) refreshBtn.classList.add("is-loading");

  // Check cache (90 seconds TTL)
  if (!forceRefresh && bmSummaryCache.has(cacheKey)) {
    const entry = bmSummaryCache.get(cacheKey);
    if (Date.now() - entry.time < 90000) {
      renderInlineBmSummary(entry.data, cleanType, cleanId, hid);
      if (refreshBtn) refreshBtn.classList.remove("is-loading");
      return;
    }
  }

  // Render loading indicator
  bodyEl.innerHTML = `
    <div class="bm-summary-loading">
      <span class="bm-summary-spinner"></span>
      <span>Загрузка данных BM...</span>
    </div>
  `;
  adjustQuickAssignModalBounds();

  try {
    const params = new URLSearchParams({
      target_type: cleanType,
      target_id: cleanId
    });
    if (callsign) params.set("callsign", callsign);
    if (hid) params.set("hotspot_id", hid);

    const resp = await fetch(`/api/bm/summary?${params.toString()}`);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json();

    if (data && data.status === "ok") {
      bmSummaryCache.set(cacheKey, { data, time: Date.now() });
      renderInlineBmSummary(data, cleanType, cleanId, hid);
    } else {
      const msg = data?.detail || data?.error || "Данные не найдены";
      bodyEl.innerHTML = `
        <div class="bm-summary-empty">
          <span>⚠️ BM: ${safeEscapeHtml(msg)}</span>
        </div>
      `;
      adjustQuickAssignModalBounds();
    }
  } catch (err) {
    console.warn("[BM_SUMMARY] Error fetching BrandMeister summary:", err);
    bodyEl.innerHTML = `
      <div class="bm-summary-empty">
        <span>⚠️ Не удалось загрузить данные BM (${safeEscapeHtml(err.message || err)})</span>
      </div>
    `;
    adjustQuickAssignModalBounds();
  } finally {
    if (refreshBtn) refreshBtn.classList.remove("is-loading");
  }
}

function renderInlineBmSummary(data, targetType, targetId, hotspotId) {
  const bodyEl = document.getElementById("quickBmSummaryBody");
  if (!bodyEl) return;

  if (targetType === "ID") {
    // -------------------------------------------------------------
    // CALL ID VIEW (DMR Registry + User Devices + Static Subscriptions)
    // -------------------------------------------------------------
    const call = data.callsign || "";
    const name = data.user_name || "";
    const loc = data.location || "";
    const devices = Array.isArray(data.devices) ? data.devices : [];
    const staticTgs = data.static_talkgroups || { ts1: [], ts2: [], total: 0 };
    const ts1 = Array.isArray(staticTgs.ts1) ? staticTgs.ts1 : [];
    const ts2 = Array.isArray(staticTgs.ts2) ? staticTgs.ts2 : [];

    if (!call && !name && devices.length === 0) {
      bodyEl.innerHTML = `
        <div class="bm-summary-card">
          <div class="bm-id-lead">
            <span class="bm-id-badge">ID: ${safeEscapeHtml(targetId)}</span>
            <span class="bm-user-loc">Данные в BM не найдены (404)</span>
          </div>
        </div>
      `;
      adjustQuickAssignModalBounds();
      return;
    }

    let devChipsHtml = "";
    if (devices.length > 0) {
      devChipsHtml = devices.map(d => {
        const isOnline = (d.status === 1 || d.status === 3 || /online|linked/i.test(String(d.statusText || "")));
        const master = d.lastKnownMaster ? `BM ${d.lastKnownMaster}` : "";
        const hw = d.hardware || "MMDVM";
        const freq = (d.rx && d.tx) ? `${d.rx} MHz` : "";
        return `
          <div class="bm-device-chip" title="ID: ${safeEscapeHtml(d.id)}${hw ? ' • ' + safeEscapeHtml(hw) : ''}${master ? ' • ' + safeEscapeHtml(master) : ''}${freq ? ' • ' + safeEscapeHtml(freq) : ''}">
            <div class="bm-chip-top">
              <div class="bm-chip-id-wrap">
                <span class="bm-chip-dot ${isOnline ? 'online' : 'offline'}" title="${isOnline ? 'Online' : 'Offline'}"></span>
                <span>${safeEscapeHtml(d.id)}</span>
              </div>
              ${master ? `<span class="bm-chip-master">${safeEscapeHtml(master)}</span>` : ''}
            </div>
            <div class="bm-chip-details">
              <span class="bm-chip-hw" title="${safeEscapeHtml(hw)}">${safeEscapeHtml(hw)}</span>
              ${freq ? `<span class="bm-chip-freq">${safeEscapeHtml(freq)}</span>` : ''}
            </div>
          </div>
        `;
      }).join("");
    } else {
      devChipsHtml = `<div class="bm-summary-empty" style="padding:6px 10px;">Хотспоты / ретрансляторы позывного не найдены</div>`;
    }

    let staticSubsHtml = "";
    if (staticTgs.total > 0) {
      staticSubsHtml = `
        <div class="bm-summary-section" style="margin-top: 6px;">
          <div class="bm-summary-subhead">
            <span>Статические группы профиля</span>
            <span class="bm-summary-count">Всего: ${staticTgs.total}</span>
          </div>
          <div class="bm-static-slots-grid ${ts1.length > 0 && ts2.length > 0 ? 'has-both-slots' : ''}">
            ${ts1.length > 0 ? `
              <div class="bm-slot-box">
                <div class="bm-slot-box-header">
                  <div class="bm-slot-box-title">
                    <span class="bm-slot-badge">TS1</span>
                    <span class="bm-slot-label">Слот 1</span>
                  </div>
                  <span class="bm-slot-count">${ts1.length} TG</span>
                </div>
                <div class="bm-pills-scroll-box">
                  <div class="bm-pills-row">
                    ${ts1.map(tg => `<span class="bm-mini-pill">TG ${tg}</span>`).join("")}
                  </div>
                </div>
              </div>
            ` : ''}
            ${ts2.length > 0 ? `
              <div class="bm-slot-box">
                <div class="bm-slot-box-header">
                  <div class="bm-slot-box-title">
                    <span class="bm-slot-badge ts2">TS2</span>
                    <span class="bm-slot-label ts2">Слот 2</span>
                  </div>
                  <span class="bm-slot-count">${ts2.length} TG</span>
                </div>
                <div class="bm-pills-scroll-box">
                  <div class="bm-pills-row">
                    ${ts2.map(tg => `<span class="bm-mini-pill ts2">TG ${tg}</span>`).join("")}
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    const bmDateLabel = data.bm_created ? `<span class="bm-user-date" title="Дата регистрации в BM">📅 BM: ${formatBmDate(data.bm_created)}</span>` : '';
    const lastHeardLabel = (data.radioid && data.radioid.lastheard) ? `<span class="bm-user-lastheard" title="Последняя активность в DMR: TG ${data.radioid.lasttg || '—'}">🎙️ ${formatBmDate(data.radioid.lastheard, true)}</span>` : '';

    bodyEl.innerHTML = `
      <div class="bm-summary-card">
        <div class="bm-id-lead">
          ${call ? `<strong class="bm-callsign-badge">${safeEscapeHtml(call)}</strong>` : ''}
          <span class="bm-id-badge">ID: ${safeEscapeHtml(targetId)}</span>
          ${name ? `<span class="bm-user-name">${safeEscapeHtml(name)}</span>` : ''}
          ${loc ? `<span class="bm-user-loc">📍 ${safeEscapeHtml(loc)}</span>` : ''}
          ${bmDateLabel}
          ${lastHeardLabel}
        </div>
        <div class="bm-summary-section">
          <div class="bm-summary-subhead">
            <span>Устройства позывного</span>
            <span class="bm-summary-count">${devices.length}</span>
          </div>
          <div class="bm-device-chips-grid">
            ${devChipsHtml}
          </div>
        </div>
        ${staticSubsHtml}
      </div>
    `;

  } else {
    // -------------------------------------------------------------
    // TALKGROUP ID VIEW (BM Registry + Hotspot Subscription + 1-Click Action)
    // -------------------------------------------------------------
    const tgNum = parseInt(targetId, 10) || 0;
    const tgName = data.tg_name || "";
    const isReg = !!data.is_registered;
    const hs = data.hotspot || {};
    const hsName = hs.name || hotspotId || "Хотспот";
    const sub = data.subscription || {};
    const isSubbed = !!sub.is_subscribed;
    const subSlot = sub.slot || 1;
    const staticTgs = data.static_talkgroups || { ts1: [], ts2: [], total: 0 };
    const ts1 = Array.isArray(staticTgs.ts1) ? staticTgs.ts1 : [];
    const ts2 = Array.isArray(staticTgs.ts2) ? staticTgs.ts2 : [];

    let actionHtml = "";
    if (isSubbed) {
      actionHtml = `
        <button type="button" class="btn-bm-act btn-bm-act-del" data-action="delete" data-slot="${subSlot}" data-tg="${tgNum}" data-hid="${safeEscapeHtml(hotspotId)}" title="Удалить TG ${tgNum} из статики TS${subSlot}">
          ✕ Удалить из TS${subSlot}
        </button>
      `;
    } else {
      actionHtml = `
        <div class="bm-action-btn-group">
          <button type="button" class="btn-bm-act btn-bm-act-add" data-action="add" data-slot="1" data-tg="${tgNum}" data-hid="${safeEscapeHtml(hotspotId)}" title="Добавить TG ${tgNum} в статику TS1 хотспота">
            + В статику TS1
          </button>
          <button type="button" class="btn-bm-act btn-bm-act-add" data-action="add" data-slot="2" data-tg="${tgNum}" data-hid="${safeEscapeHtml(hotspotId)}" title="Добавить TG ${tgNum} в статику TS2 хотспота">
            + В статику TS2
          </button>
        </div>
      `;
    }

    bodyEl.innerHTML = `
      <div class="bm-summary-card">
        <div class="bm-tg-lead">
          <span class="bm-tg-pill-lg">TG ${tgNum}</span>
          <span class="bm-tg-official-name" title="${safeEscapeHtml(tgName)}">${safeEscapeHtml(tgName || 'Локальная / не в каталоге')}</span>
          <span class="bm-badge ${isReg ? 'bm-badge-reg' : 'bm-badge-unreg'}">${isReg ? 'В каталоге BM' : 'Не в каталоге BM'}</span>
        </div>

        <div class="bm-hs-sub-box">
          <div class="bm-hs-sub-info">
            <span class="bm-hs-label">Хотспот:</span>
            <strong class="bm-hs-name">${safeEscapeHtml(hsName)}</strong>
            <span class="bm-badge ${isSubbed ? 'bm-badge-sub' : 'bm-badge-notsub'}">
              ${isSubbed ? `● В статике на TS${subSlot}` : '○ Не в статике'}
            </span>
          </div>
          ${actionHtml}
        </div>

        <div class="bm-summary-section">
          <div class="bm-summary-subhead">
            <span>Статические группы хотспота</span>
            <span class="bm-summary-count">TS1: ${ts1.length} • TS2: ${ts2.length}</span>
          </div>
          ${(ts1.length === 0 && ts2.length === 0) ? `
            <div class="bm-summary-empty" style="padding: 6px 10px;">Статические группы на хотспоте не настроены</div>
          ` : `
            <div class="bm-static-slots-grid ${ts1.length > 0 && ts2.length > 0 ? 'has-both-slots' : ''}">
              ${ts1.length > 0 ? `
                <div class="bm-slot-box">
                  <div class="bm-slot-box-header">
                    <div class="bm-slot-box-title">
                      <span class="bm-slot-badge">TS1</span>
                      <span class="bm-slot-label">Слот 1</span>
                    </div>
                    <span class="bm-slot-count">${ts1.length} TG</span>
                  </div>
                  <div class="bm-pills-scroll-box">
                    <div class="bm-pills-row">
                      ${ts1.map(g => `<span class="bm-mini-pill ${g === tgNum ? 'is-active-target' : ''}">TG ${g}</span>`).join("")}
                    </div>
                  </div>
                </div>
              ` : ''}
              ${ts2.length > 0 ? `
                <div class="bm-slot-box">
                  <div class="bm-slot-box-header">
                    <div class="bm-slot-box-title">
                      <span class="bm-slot-badge ts2">TS2</span>
                      <span class="bm-slot-label ts2">Слот 2</span>
                    </div>
                    <span class="bm-slot-count">${ts2.length} TG</span>
                  </div>
                  <div class="bm-pills-scroll-box">
                    <div class="bm-pills-row">
                      ${ts2.map(g => `<span class="bm-mini-pill ts2 ${g === tgNum ? 'is-active-target' : ''}">TG ${g}</span>`).join("")}
                    </div>
                  </div>
                </div>
              ` : ''}
            </div>
          `}
        </div>
      </div>
    `;

    // Wire up 1-click action buttons
    bodyEl.querySelectorAll(".btn-bm-act").forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const act = btn.dataset.action;
        const slot = parseInt(btn.dataset.slot, 10);
        const tg = parseInt(btn.dataset.tg, 10);
        const hid = btn.dataset.hid;
        await executeInlineBmAction(act, slot, tg, hid, btn);
      };
    });
  }

  // Adjust modal bounds and layout dynamically
  adjustQuickAssignModalBounds();
}

async function executeInlineBmAction(action, slot, tg, hotspotId, btnEl) {
  if (!tg || !slot) return;
  const origText = btnEl ? btnEl.textContent : "";
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = "...";
  }

  const hid = resolveHotspotId(hotspotId || window.activeHotspotId || "default");
  try {
    if (action === "add") {
      const resp = await fetch("/api/bm/static-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotspot_id: hid,
          slot: slot,
          talkgroup: tg,
          talkgroups: [tg]
        })
      });
      const res = await resp.json();
      if (res.status === "ok") {
        showToast(`✅ TG ${tg} добавлена в статику TS${slot} хотспота!`, 3500);
      } else {
        showToast(`⚠️ ${res.detail || "Ошибка добавления группы в BM"}`, 4500);
      }
    } else if (action === "delete") {
      const resp = await fetch("/api/bm/static-groups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotspot_id: hid,
          slot: slot,
          talkgroups: [tg]
        })
      });
      const res = await resp.json();
      if (res.status === "ok") {
        showToast(`✅ TG ${tg} удалена из статики TS${slot}!`, 3500);
      } else {
        showToast(`⚠️ ${res.detail || "Ошибка удаления группы из BM"}`, 4500);
      }
    }

    // Invalidate cache for this TG and reload inline summary
    bmSummaryCache.delete(`TG_${tg}_${hid}`);
    await loadBmSummary("TG", tg, "", hid, true);

    // Also trigger background refresh of main static groups list if modal/cache is active
    if (typeof loadBmTgStaticGroups === "function") {
      loadBmTgStaticGroups(hid).catch(() => {});
    }
  } catch (err) {
    console.warn("[BM_ACTION] Error executing BM action:", err);
    showToast(`⚠️ Сетевая ошибка при операции с BM: ${err.message || err}`, 4500);
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = origText;
    }
  }
}

async function openBmInfoModal(queryType, tgOrIdInfo) {
  const modal = document.getElementById("bmInfoModal");
  if (!modal || !tgOrIdInfo) return;

  currentBmInfoQuery = { queryType, tgOrIdInfo };

  const targetId = tgOrIdInfo.value || "";
  let callsign = tgOrIdInfo.callsign || "";

  if (!callsign && targetId && !isNaN(parseInt(targetId, 10))) {
    const rid = parseInt(targetId, 10);
    if (window.USER_CALLSIGNS && window.USER_CALLSIGNS[rid] && window.USER_CALLSIGNS[rid].callsign) {
      callsign = window.USER_CALLSIGNS[rid].callsign;
    }
  }

  if (!callsign && tgOrIdInfo.name) {
    const parts = tgOrIdInfo.name.trim().split(/[\s,()•-]+/);
    for (const p of parts) {
      const clean = p.trim().toUpperCase();
      if (/^[A-Z0-9\/]{3,10}$/i.test(clean) && /\d/.test(clean)) {
        callsign = clean;
        break;
      }
    }
  }

  const titleEl = document.getElementById("bmInfoModalTitle");
  const iconEl = document.getElementById("bmInfoModalIcon");
  const subEl = document.getElementById("bmInfoModalSubtitle");
  const badgeEl = document.getElementById("bmInfoTargetBadge");

  const loadingBox = document.getElementById("bmInfoLoading");
  const loadingUrl = document.getElementById("bmInfoLoadingUrl");
  const errorBox = document.getElementById("bmInfoError");
  const errorMsg = document.getElementById("bmInfoErrorMsg");
  const contentBox = document.getElementById("bmInfoContent");
  const cardsBox = document.getElementById("bmInfoStructuredCards");

  const isTg = tgOrIdInfo.type === "TG";
  const curHid = currentModalQuickMemHid || window.activeHotspotId || "default";
  const hs = window.currentHotspots.find(h => h.id === curHid) || window.currentHotspots[0] || {};
  const hsDevId = hs.bm_ssid ? `${hs.dmr_id}${String(hs.bm_ssid).padStart(2, '0')}` : (hs.dmr_id || "");

  if (titleEl) titleEl.textContent = window.t ? window.t("bm_info.modal_title", {}, "BrandMeister & DMR INFO") : "BrandMeister & DMR INFO";
  if (iconEl) iconEl.textContent = isTg ? "🌐" : "👤";
  if (subEl) subEl.textContent = window.t ? window.t("bm_info.subtitle", {}, "Автоопределение и подробные данные из BM API v2") : "Автоопределение и подробные данные из BM API v2";

  if (badgeEl) {
    badgeEl.className = "bm-info-target-badge is-white";
    badgeEl.innerHTML = `${isTg ? 'TG' : 'ID'}: <span class="dmr-tg-num" style="font-weight:800;">${targetId}</span>${callsign ? ` (${safeEscapeHtml(callsign)})` : (tgOrIdInfo.name ? ` (${safeEscapeHtml(tgOrIdInfo.name)})` : '')}`;
  }

  const btnBackToQuick = document.getElementById("btnBackToQuickAssign");
  if (btnBackToQuick) {
    btnBackToQuick.style.display = "";
  }

  if (loadingBox) loadingBox.classList.remove("hidden");
  if (loadingUrl) loadingUrl.textContent = `/api/bm/summary?target_id=${targetId}&target_type=AUTO`;
  if (errorBox) errorBox.classList.add("hidden");
  if (contentBox) contentBox.classList.add("hidden");
  if (cardsBox) cardsBox.innerHTML = "";

  currentBmInfoCallsign = callsign;
  currentBmInfoTargetId = targetId;
  currentBmInfoExtra = tgOrIdInfo;
  currentHamQthLoadedFor = "";
  if (typeof switchBmInfoTab === "function") {
    switchBmInfoTab("bm");
  }

  modal.classList.add("active");
  pushNavState("modal", "bmInfoModal");

  try {
    let resp;
    if (queryType === "profile" || queryType === "device_talkgroup" || queryType === "devices_by_call" || queryType === "registry") {
      const params = new URLSearchParams({
        query_type: queryType,
        target_id: String(targetId)
      });
      if (callsign) params.set("callsign", callsign);
      if (currentModalQuickMemHid || window.activeHotspotId) params.set("hotspot_id", currentModalQuickMemHid || window.activeHotspotId);
      resp = await fetch(`/api/bm/info?${params.toString()}`);
    } else {
      const params = new URLSearchParams({
        target_id: String(targetId),
        target_type: isTg ? "TG" : "ID"
      });
      if (callsign) params.set("callsign", callsign);
      if (currentModalQuickMemHid || window.activeHotspotId) params.set("hotspot_id", currentModalQuickMemHid || window.activeHotspotId);
      resp = await fetch(`/api/bm/summary?${params.toString()}`);
    }
    const data = await resp.json();

    const op = (data && data.operator) || {};
    const reg = (data && data.registry) || {};
    const resolvedCall = (op && op.callsign) || (data && data.callsign) || (reg && reg.Call) || (tgOrIdInfo && tgOrIdInfo.callsign) || "";
    if (resolvedCall) {
      currentBmInfoCallsign = resolvedCall;
      if (badgeEl) {
        badgeEl.className = "bm-info-target-badge is-white";
        badgeEl.innerHTML = `${isTg ? 'TG' : 'ID'}: <span class="dmr-tg-num" style="font-weight:800;">${targetId}</span> (${safeEscapeHtml(resolvedCall)})`;
      }
    }
    if (currentBmInfoTab === "hamqth") {
      const key = (currentBmInfoCallsign || currentBmInfoTargetId || "").trim().toUpperCase();
      if (currentHamQthLoadedFor !== key) {
        loadHamQthInfo(currentBmInfoCallsign, currentBmInfoTargetId, currentBmInfoExtra);
      }
    }

    if (loadingBox) loadingBox.classList.add("hidden");

    if (!resp.ok || data.status === "error" || data.status === "not_found" || data.status === "unauthorized") {
      if (errorBox) {
        errorBox.classList.remove("hidden");
        const errorTitle = document.getElementById("bmInfoErrorTitle");
        if (errorTitle) {
          errorTitle.textContent = data.status === "not_found" ? (window.t ? window.t("bm_info.err_not_found", {}, "Данные не найдены (404)") : "Данные не найдены (404)") :
                                   data.status === "unauthorized" ? (window.t ? window.t("bm_info.err_unauthorized", {}, "Ошибка авторизации BM (401/403)") : "Ошибка авторизации BM (401/403)") : (window.t ? window.t("bm_info.error_title", {}, "Ошибка запроса") : "Ошибка запроса");
        }
        if (errorMsg) {
          errorMsg.textContent = data.detail || (data.data && data.data.message) || (window.t ? window.t("bm_info.err_server_status", { status: data.status }, `Сервер BM вернул статус: ${data.status}`) : `Сервер BM вернул статус: ${data.status}`);
        }
      }
      return;
    }

    // Update modal header based on detected type
    const detectedTypeLabels = {
      operator: window.t ? window.t("bm_info.type_operator", {}, "DMR ID радиолюбителя / оператора") : "DMR ID радиолюбителя / оператора",
      repeater: window.t ? window.t("bm_info.type_repeater", {}, "Репитер DMR BrandMeister") : "Репитер DMR BrandMeister",
      hotspot: window.t ? window.t("bm_info.type_hotspot", {}, "Персональный хотспот MMDVM") : "Персональный хотспот MMDVM",
      talkgroup: window.t ? window.t("bm_info.type_talkgroup", {}, "Разговорная группа (TalkGroup)") : "Разговорная группа (TalkGroup)",
      unknown: window.t ? window.t("bm_info.type_unknown", {}, "Пользовательская группа / ID") : "Пользовательская группа / ID"
    };
    if (titleEl) {
      titleEl.textContent = (data.detected_type && detectedTypeLabels[data.detected_type]) || data.detected_type_label || (window.t ? window.t("bm_info.modal_title", {}, "BrandMeister & DMR INFO") : "BrandMeister & DMR INFO");
    }
    if (iconEl) {
      if (data.detected_type === "operator") iconEl.textContent = "👤";
      else if (data.detected_type === "repeater") iconEl.textContent = "📡";
      else if (data.detected_type === "hotspot") iconEl.textContent = "📻";
      else if (data.detected_type === "talkgroup") iconEl.textContent = "🌐";
      else iconEl.textContent = "📡";
    }

    if (badgeEl) {
      const detCall = data.callsign || callsign;
      const detName = data.user_name || (data.talkgroup && data.talkgroup.name) || tgOrIdInfo.name || "";
      const lblOp = window.t ? window.t("bm_info.lbl_operator", {}, "Оператор") : "Оператор";
      const lblRep = window.t ? window.t("bm_info.lbl_repeater", {}, "Репитер") : "Репитер";
      const lblHs = window.t ? window.t("bm_info.lbl_hotspot", {}, "Хотспот") : "Хотспот";
      if (data.detected_type === "operator") {
        badgeEl.className = "bm-info-target-badge is-green";
        badgeEl.innerHTML = `👤 ${safeEscapeHtml(lblOp)}: <span class="dmr-id-text" style="font-weight:700;">${targetId}</span>${detCall ? ` &bull; <strong style="color:#ff6700;">${safeEscapeHtml(detCall)}</strong>` : ''}${detName ? ` (${safeEscapeHtml(detName)})` : ''}`;
      } else if (data.detected_type === "repeater") {
        badgeEl.className = "bm-info-target-badge is-white";
        badgeEl.innerHTML = `📡 ${safeEscapeHtml(lblRep)}: <span class="dmr-id-text" style="font-weight:700;">${targetId}</span>${detCall ? ` &bull; <strong style="color:#ff6700;">${safeEscapeHtml(detCall)}</strong>` : ''}${detName ? ` (${safeEscapeHtml(detName)})` : ''}`;
      } else if (data.detected_type === "hotspot") {
        badgeEl.className = "bm-info-target-badge is-white";
        badgeEl.innerHTML = `📻 ${safeEscapeHtml(lblHs)}: <span class="dmr-id-text" style="font-weight:700;">${targetId}</span>${detCall ? ` &bull; <strong style="color:#ff6700;">${safeEscapeHtml(detCall)}</strong>` : ''}`;
      } else {
        badgeEl.className = "bm-info-target-badge is-white";
        badgeEl.innerHTML = `TG: <span class="dmr-tg-num" style="font-weight:800;">${targetId}</span>${detName ? ` (${safeEscapeHtml(detName)})` : ''}`;
      }
    }

    // Success
    if (contentBox) contentBox.classList.remove("hidden");
    const isDiag = Boolean(queryType in {profile:1, device_talkgroup:1, devices_by_call:1, registry:1});
    renderBmInfoCards(cardsBox, isDiag ? queryType : "unified", data, targetId, tgOrIdInfo);

  } catch (err) {
    if (loadingBox) loadingBox.classList.add("hidden");
    if (errorBox) {
      errorBox.classList.remove("hidden");
      const errorTitle = document.getElementById("bmInfoErrorTitle");
      if (errorTitle) errorTitle.textContent = window.t ? window.t("bm_info.net_err_title", {}, "Сетевая ошибка") : "Сетевая ошибка";
      if (errorMsg) errorMsg.textContent = window.t ? window.t("bm_info.net_err_msg", { error: err.message }, `Не удалось связаться с сервером ProxDMR: ${err.message}`) : `Не удалось связаться с сервером ProxDMR: ${err.message}`;
    }
  }
}

function closeBmInfoModal() {
  const modal = document.getElementById("bmInfoModal");
  if (modal && modal.classList.contains("active")) {
    modal.classList.remove("active");
    notifyNavClosed();
  }
}

function renderBmDeviceStatus(dev) {
  if (!dev) return '—';
  const rawText = String(dev.statusText || "").trim();
  const st = Number(dev.status);
  const lower = rawText.toLowerCase();

  // Check if both slots linked
  if (lower.includes("both") || st === 3) {
    const title = window.t ? window.t("bm_info.status_both_slots_linked", {}, "Оба слота в сети (Both Slots Linked)") : "Оба слота в сети (Both Slots Linked)";
    return `
      <div class="bm-device-slots" title="${safeEscapeHtml(title)}">
        <span class="bm-device-slot-pill is-online">TS1</span>
        <span class="bm-device-slot-pill is-online">TS2</span>
      </div>`;
  }

  // Check if slot 1 only linked
  if (lower.includes("slot 1") || lower.includes("ts1 linked")) {
    const title = window.t ? window.t("bm_info.status_slot1_linked", {}, "TS1 в сети, TS2 отключен (Slot 1 Linked)") : "TS1 в сети, TS2 отключен (Slot 1 Linked)";
    return `
      <div class="bm-device-slots" title="${safeEscapeHtml(title)}">
        <span class="bm-device-slot-pill is-online">TS1</span>
        <span class="bm-device-slot-pill is-offline">TS2</span>
      </div>`;
  }

  // Check if slot 2 only linked
  if (lower.includes("slot 2") || lower.includes("ts2 linked")) {
    const title = window.t ? window.t("bm_info.status_slot2_linked", {}, "TS2 в сети, TS1 отключен (Slot 2 Linked)") : "TS2 в сети, TS1 отключен (Slot 2 Linked)";
    return `
      <div class="bm-device-slots" title="${safeEscapeHtml(title)}">
        <span class="bm-device-slot-pill is-offline">TS1</span>
        <span class="bm-device-slot-pill is-online">TS2</span>
      </div>`;
  }

  // Check if generally online simplex hotspot (status 1)
  if (st === 1 || lower === "online" || lower === "linked") {
    return `
      <div class="bm-device-slots" title="${safeEscapeHtml(rawText || 'Online')}">
        <span class="bm-device-slot-pill is-online">ONLINE</span>
      </div>`;
  }

  // Check if duplex repeater by different RX/TX frequencies or 6-digit ID
  const isDuplex = Boolean(dev.rx && dev.tx && dev.rx !== dev.tx && dev.rx !== "0.0000" && dev.tx !== "0.0000");

  if (isDuplex || lower.includes("slot") || String(dev.id).length === 6) {
    const title = window.t ? window.t("bm_info.status_offline", {}, "Не в сети (Offline)") : "Не в сети (Offline)";
    return `
      <div class="bm-device-slots" title="${safeEscapeHtml(title)}">
        <span class="bm-device-slot-pill is-offline">TS1</span>
        <span class="bm-device-slot-pill is-offline">TS2</span>
      </div>`;
  }

  // Default offline
  const title = window.t ? window.t("bm_info.status_offline", {}, "Не в сети (Offline)") : "Не в сети (Offline)";
  return `
    <div class="bm-device-slots" title="${safeEscapeHtml(title)}">
      <span class="bm-device-slot-pill is-offline">OFFLINE</span>
    </div>`;
}

function formatBmDate(dateStr, includeTime = false) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    if (!includeTime) return `${day}.${month}.${year}`;
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  } catch (_) {
    return String(dateStr);
  }
}

function renderBmRepeaterTechSection(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return "";

  const techDevs = devices.filter(d => {
    if (!d || typeof d !== "object") return false;
    const hasPep = Number(d.pep) > 0;
    const hasAgl = Number(d.agl) > 0;
    const lat = Number(d.lat);
    const lng = Number(d.lng);
    const hasCoords = !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
    const hasDesc = Boolean(d.description && String(d.description).trim());
    const hasWeb = Boolean(d.website && String(d.website).trim());
    const hasDates = Boolean(d.created_at || d.updated_at);
    return hasPep || hasAgl || hasCoords || hasDesc || hasWeb || hasDates;
  });

  if (techDevs.length === 0) return "";

  const techTitle = window.t ? window.t("bm_info.tech_params_title", {}, "Технические параметры и характеристики оборудования") : "Технические параметры и характеристики оборудования";
  const propPep = window.t ? window.t("bm_info.prop_pep", {}, "Мощность передатчика (PEP)") : "Мощность передатчика (PEP)";
  const propAgl = window.t ? window.t("bm_info.prop_agl", {}, "Высота антенны (AGL)") : "Высота антенны (AGL)";
  const propCoords = window.t ? window.t("bm_info.prop_coords", {}, "Координаты QTH") : "Координаты QTH";
  const linkMap = window.t ? window.t("bm_info.link_map", {}, "🗺️ Карта") : "🗺️ Карта";
  const titleMap = window.t ? window.t("bm_info.title_map_osm", {}, "Показать точку на карте OpenStreetMap") : "Показать точку на карте OpenStreetMap";
  const propWeb = window.t ? window.t("hamqth.prop_website", {}, "Веб-сайт") : "Веб-сайт";
  const propCreated = window.t ? window.t("bm_info.prop_bm_created", {}, "Добавлено в BM") : "Добавлено в BM";
  const propUpdated = window.t ? window.t("bm_info.prop_bm_updated", {}, "Обновлено в BM") : "Обновлено в BM";
  const propDesc = window.t ? window.t("bm_info.prop_desc_info", {}, "Описание / Инфо") : "Описание / Инфо";

  return `
    <div class="bm-repeater-tech-section">
      <div class="bm-tech-section-title">
        <span>📡</span> ${safeEscapeHtml(techTitle)}
      </div>
      ${techDevs.map(dev => {
        const pep = Number(dev.pep) || 0;
        const agl = Number(dev.agl) || 0;
        const lat = Number(dev.lat);
        const lng = Number(dev.lng);
        const hasCoords = !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);
        const desc = String(dev.description || "").trim();
        const web = String(dev.website || "").trim();
        const webUrl = web ? (web.startsWith("http://") || web.startsWith("https://") ? web : `http://${web}`) : "";
        const created = formatBmDate(dev.created_at, true);
        const updated = formatBmDate(dev.updated_at, true);

        return `
          <div class="bm-repeater-tech-card">
            <div class="bm-tech-card-header">
              <div class="bm-tech-dev-badge">
                <span class="dmr-id-text" style="font-weight:700;">${dev.id}</span>
                ${dev.callsign ? `<strong style="color:#ff6700; margin-left:6px;">${safeEscapeHtml(dev.callsign)}</strong>` : ''}
                ${dev.hardware ? `<span class="bm-tech-hw-label">&bull; ${safeEscapeHtml(dev.hardware)}</span>` : ''}
              </div>
              ${dev.statusText ? `<span class="bm-tech-status-badge">${safeEscapeHtml(dev.statusText)}</span>` : ''}
            </div>
            <div class="bm-tech-props-grid">
              ${pep > 0 ? `
                <div class="bm-info-prop-item">
                  <span class="bm-info-prop-label">${safeEscapeHtml(propPep)}</span>
                  <span class="bm-info-prop-val highlight">${window.t ? window.t("bm_info.val_pep_watts", { watts: pep }, `⚡ ${pep} Вт`) : `⚡ ${pep} Вт`}</span>
                </div>
              ` : ''}
              ${agl > 0 ? `
                <div class="bm-info-prop-item">
                  <span class="bm-info-prop-label">${safeEscapeHtml(propAgl)}</span>
                  <span class="bm-info-prop-val">${window.t ? window.t("bm_info.val_agl_meters", { meters: agl }, `🗼 ${agl} м над землей`) : `🗼 ${agl} м над землей`}</span>
                </div>
              ` : ''}
              ${hasCoords ? `
                <div class="bm-info-prop-item">
                  <span class="bm-info-prop-label">${safeEscapeHtml(propCoords)}</span>
                  <span class="bm-info-prop-val">
                    📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}
                    <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=14/${lat}/${lng}" target="_blank" rel="noopener" class="bm-map-link" title="${safeEscapeHtml(titleMap)}">${safeEscapeHtml(linkMap)}</a>
                  </span>
                </div>
              ` : ''}
              ${web ? `
                <div class="bm-info-prop-item">
                  <span class="bm-info-prop-label">${safeEscapeHtml(propWeb)}</span>
                  <span class="bm-info-prop-val">
                    <a href="${safeEscapeHtml(webUrl)}" target="_blank" rel="noopener" class="bm-web-link">🌐 ${safeEscapeHtml(web)}</a>
                  </span>
                </div>
              ` : ''}
              ${created ? `
                <div class="bm-info-prop-item">
                  <span class="bm-info-prop-label">${safeEscapeHtml(propCreated)}</span>
                  <span class="bm-info-prop-val">${created}</span>
                </div>
              ` : ''}
              ${updated ? `
                <div class="bm-info-prop-item">
                  <span class="bm-info-prop-label">${safeEscapeHtml(propUpdated)}</span>
                  <span class="bm-info-prop-val">${updated}</span>
                </div>
              ` : ''}
            </div>
            ${desc ? `
              <div class="bm-tech-desc-box">
                <span class="bm-info-prop-label">${safeEscapeHtml(propDesc)}</span>
                <div class="bm-tech-desc-text">${safeEscapeHtml(desc)}</div>
              </div>
            ` : ''}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderBmInfoCards(cardsBox, queryType, data, targetId, extraInfo) {
  if (!cardsBox) return;

  if (queryType === "profile") {
    const d = data.data || {};
    const subList = Array.isArray(d.staticSubscriptions) ? d.staticSubscriptions : [];
    const ts1Subs = subList.filter(s => String(s.slot) === "1");
    const ts2Subs = subList.filter(s => String(s.slot) === "2");
    const dynamicList = Array.isArray(d.dynamicSubscriptions) ? d.dynamicSubscriptions : [];
    const clustersList = Array.isArray(d.clusters) ? d.clusters : [];
    const timedList = Array.isArray(d.timedSubscriptions) ? d.timedSubscriptions : [];
    const blockedList = Array.isArray(d.blockedGroups) ? d.blockedGroups : [];

    const profTitle = window.t ? window.t("bm_info.profile_title", {}, "Профиль устройства и подписки") : "Профиль устройства и подписки";
    const badgeReg = window.t ? window.t("bm_info.registered", {}, "Зарегистрирован") : "Зарегистрирован";
    const badgeNoData = window.t ? window.t("bm_info.no_data", {}, "Нет данных") : "Нет данных";
    const propDevId = window.t ? window.t("bm_info.device_id", {}, "ID устройства") : "ID устройства";
    const propCall = window.t ? window.t("bm_info.th_callsign", {}, "Позывной") : "Позывной";
    const propAutoStatic = window.t ? window.t("bm_info.autostatic", {}, "Авто-статика (AutoStatic)") : "Авто-статика (AutoStatic)";
    const valEnabled = window.t ? window.t("bm_info.enabled", {}, "Включено") : "Включено";
    const valDisabled = window.t ? window.t("bm_info.disabled", {}, "Выключено") : "Выключено";
    const propTotalStatic = window.t ? window.t("bm_info.total_static_tg", {}, "Всего статических TG") : "Всего статических TG";
    const dynTitle = window.t ? window.t("bm_info.dynamic_title", {}, "Динамические подписки и кластеры") : "Динамические подписки и кластеры";
    const propDynTgs = window.t ? window.t("bm_info.dynamic_tgs", {}, "Динамические группы") : "Динамические группы";
    const valNoActive = window.t ? window.t("bm_info.no_active", {}, "Нет активных") : "Нет активных";
    const propClusters = window.t ? window.t("bm_info.clusters", {}, "Кластеры") : "Кластеры";
    const valNone = window.t ? window.t("bm_info.none", {}, "Нет") : "Нет";
    const propBlocked = window.t ? window.t("bm_info.blocked_tgs", {}, "Блокированные TG") : "Блокированные TG";
    const propTimed = window.t ? window.t("bm_info.timed_subs", {}, "Подписки по расписанию") : "Подписки по расписанию";

    cardsBox.innerHTML = `
      <div class="bm-info-card">
        <div class="bm-info-card-header">
          <div class="bm-info-card-title"><span>📻</span> ${safeEscapeHtml(profTitle)}</div>
          <span class="bm-info-card-badge ${subList.length > 0 ? 'bm-info-badge-online' : 'bm-info-badge-offline'}">${subList.length > 0 ? safeEscapeHtml(badgeReg) : safeEscapeHtml(badgeNoData)}</span>
        </div>
        <div class="bm-info-props-grid">
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propDevId)}</span>
            <span class="bm-info-prop-val dmr-green">${targetId}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propCall)}</span>
            <span class="bm-info-prop-val highlight">${safeEscapeHtml(data.callsign || '—')}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propAutoStatic)}</span>
            <span class="bm-info-prop-val">${d.autoStatic ? safeEscapeHtml(valEnabled) : safeEscapeHtml(valDisabled)}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propTotalStatic)}</span>
            <span class="bm-info-prop-val blue">${subList.length}</span>
          </div>
        </div>
      </div>

      <div class="bm-info-card">
        <div class="bm-info-card-header">
          <div class="bm-info-card-title"><span>📌</span> ${window.t ? window.t("bm_info.static_ts1_title", { count: ts1Subs.length }, `Статические TalkGroups TS1 (${ts1Subs.length})`) : `Статические TalkGroups TS1 (${ts1Subs.length})`}</div>
        </div>
        ${ts1Subs.length > 0 ? `
          <div class="bm-info-tg-pills">
            ${ts1Subs.map(s => `<span class="bm-info-tg-pill">TG ${safeEscapeHtml(s.talkgroup)}</span>`).join("")}
          </div>
        ` : `<div style="font-size: 0.76rem; color: #8b949e;">${window.t ? window.t("bm_info.no_static_ts1", {}, "Нет статических групп на таймслоте TS1") : "Нет статических групп на таймслоте TS1"}</div>`}
      </div>

      <div class="bm-info-card">
        <div class="bm-info-card-header">
          <div class="bm-info-card-title"><span>📌</span> ${window.t ? window.t("bm_info.static_ts2_title", { count: ts2Subs.length }, `Статические TalkGroups TS2 (${ts2Subs.length})`) : `Статические TalkGroups TS2 (${ts2Subs.length})`}</div>
        </div>
        ${ts2Subs.length > 0 ? `
          <div class="bm-info-tg-pills">
            ${ts2Subs.map(s => `<span class="bm-info-tg-pill ts2-pill">TG ${safeEscapeHtml(s.talkgroup)}</span>`).join("")}
          </div>
        ` : `<div style="font-size: 0.76rem; color: #8b949e;">${window.t ? window.t("bm_info.no_static_ts2", {}, "Нет статических групп на таймслоте TS2") : "Нет статических групп на таймслоте TS2"}</div>`}
      </div>

      <div class="bm-info-card">
        <div class="bm-info-card-header">
          <div class="bm-info-card-title"><span>⚡</span> ${safeEscapeHtml(dynTitle)}</div>
        </div>
        <div class="bm-info-props-grid">
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propDynTgs)}</span>
            <span class="bm-info-prop-val">${dynamicList.length > 0 ? dynamicList.map(g => `TG ${safeEscapeHtml(g.talkgroup || g)}`).join(", ") : safeEscapeHtml(valNoActive)}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propClusters)}</span>
            <span class="bm-info-prop-val">${clustersList.length > 0 ? clustersList.map(c => safeEscapeHtml(c.cluster || c)).join(", ") : safeEscapeHtml(valNone)}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propBlocked)}</span>
            <span class="bm-info-prop-val">${blockedList.length > 0 ? blockedList.join(", ") : safeEscapeHtml(valNone)}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propTimed)}</span>
            <span class="bm-info-prop-val">${timedList.length > 0 ? timedList.length : safeEscapeHtml(valNone)}</span>
          </div>
        </div>
      </div>
    `;
  } else if (queryType === "device_talkgroup") {
    const subs = Array.isArray(data.data) ? data.data : [];
    const targetTgNum = parseInt(targetId, 10) || 0;
    const matchedSub = subs.find(s => parseInt(s.talkgroup, 10) === targetTgNum);
    const isSubscribed = Boolean(matchedSub);

    const ts1Subs = subs.filter(s => String(s.slot) === "1").sort((a, b) => parseInt(a.talkgroup, 10) - parseInt(b.talkgroup, 10));
    const ts2Subs = subs.filter(s => String(s.slot) === "2").sort((a, b) => parseInt(a.talkgroup, 10) - parseInt(b.talkgroup, 10));

    const hsName = data.hotspot_name || (window.t ? window.t("bm_info.hotspot", {}, "Хотспот") : "Хотспот");
    const hsDev = data.hotspot_device_id || "";

    const cardTitle = window.t ? window.t("bm_info.tg_status_hs_title", { tg: targetTgNum }, `Статус группы TG ${targetTgNum} на хотспоте`) : `Статус группы TG ${targetTgNum} на хотспоте`;
    const badgeStatic = window.t ? window.t("bm_info.static_slot", { slot: matchedSub ? matchedSub.slot : 1 }, `Статика TS${matchedSub ? matchedSub.slot : 1}`) : `Статика TS${matchedSub ? matchedSub.slot : 1}`;
    const badgeDyn = window.t ? window.t("bm_info.dynamic_not_static", {}, "Динамическая (не в статике)") : "Динамическая (не в статике)";

    let statusDescHtml = "";
    if (isSubscribed) {
      statusDescHtml = window.t ? window.t("bm_info.desc_subscribed", { tg: targetTgNum, slot: matchedSub.slot, hs: hsName, dev: hsDev }, `Группа <strong style="color:#ffffff;">TG ${targetTgNum}</strong> статически привязана к <strong>Таймслоту TS${matchedSub.slot}</strong> хотспота <strong>${safeEscapeHtml(hsName)}</strong> (${hsDev}). Все вызовы в этой группе транслируются на хотспот непрерывно.`) : `Группа <strong style="color:#ffffff;">TG ${targetTgNum}</strong> статически привязана к <strong>Таймслоту TS${matchedSub.slot}</strong> хотспота <strong>${safeEscapeHtml(hsName)}</strong> (${hsDev}). Все вызовы в этой группе транслируются на хотспот непрерывно.`;
    } else {
      statusDescHtml = window.t ? window.t("bm_info.desc_not_subscribed", { tg: targetTgNum, hs: hsName, dev: hsDev }, `Группа <strong style="color:#ffffff;">TG ${targetTgNum}</strong> <span style="color:#8b949e;">не добавлена в статику</span> на хотспоте <strong>${safeEscapeHtml(hsName)}</strong> (${hsDev}). Вы можете выходить в эфир динамически (по нажатию PTT группа активируется на 15 минут) либо добавить её в статику.`) : `Группа <strong style="color:#ffffff;">TG ${targetTgNum}</strong> <span style="color:#8b949e;">не добавлена в статику</span> на хотспоте <strong>${safeEscapeHtml(hsName)}</strong> (${hsDev}). Вы можете выходить в эфир динамически (по нажатию PTT группа активируется на 15 минут) либо добавить её в статику.`;
    }

    const propHs = window.t ? window.t("bm_info.hotspot", {}, "Хотспот") : "Хотспот";
    const propRepId = window.t ? window.t("bm_info.repeater_id_ssid", {}, "Repeater ID (SSID)") : "Repeater ID (SSID)";
    const propTotalStatic = window.t ? window.t("bm_info.total_static_tg", {}, "Всего статических TG") : "Всего статических TG";
    const propTgStatus = window.t ? window.t("bm_info.tg_status", {}, "Статус группы") : "Статус группы";
    const valActiveStatic = window.t ? window.t("bm_info.active_in_static", { slot: matchedSub ? matchedSub.slot : 1 }, `Активна в статике (TS${matchedSub ? matchedSub.slot : 1})`) : `Активна в статике (TS${matchedSub ? matchedSub.slot : 1})`;
    const valDynPtt = window.t ? window.t("bm_info.dynamic_ptt_short", {}, "Динамический PTT") : "Динамический PTT";

    cardsBox.innerHTML = `
      <div class="bm-info-card">
        <div class="bm-info-card-header">
          <div class="bm-info-card-title"><span>📌</span> ${safeEscapeHtml(cardTitle)}</div>
          <span class="bm-info-card-badge ${isSubscribed ? 'bm-info-badge-online' : 'bm-info-badge-offline'}">${isSubscribed ? safeEscapeHtml(badgeStatic) : safeEscapeHtml(badgeDyn)}</span>
        </div>
        <div style="font-size: 0.82rem; color: #c9d1d9; line-height: 1.5; margin-bottom: 10px;">
          ${statusDescHtml}
        </div>
        <div class="bm-info-props-grid">
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propHs)}</span>
            <span class="bm-info-prop-val highlight">${safeEscapeHtml(hsName)}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propRepId)}</span>
            <span class="bm-info-prop-val dmr-green">${hsDev || '—'}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propTotalStatic)}</span>
            <span class="bm-info-prop-val blue">${subs.length} (TS1: ${ts1Subs.length}, TS2: ${ts2Subs.length})</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propTgStatus)}</span>
            <span class="bm-info-prop-val ${isSubscribed ? 'blue' : ''}">${isSubscribed ? safeEscapeHtml(valActiveStatic) : safeEscapeHtml(valDynPtt)}</span>
          </div>
        </div>
      </div>

      <div class="bm-info-card">
        <div class="bm-info-card-header">
          <div class="bm-info-card-title"><span>📻</span> ${window.t ? window.t("bm_info.static_subs_ts1", { count: ts1Subs.length }, `Статические подписки TS1 (${ts1Subs.length})`) : `Статические подписки TS1 (${ts1Subs.length})`}</div>
        </div>
        ${ts1Subs.length > 0 ? `
          <div class="bm-info-tg-pills">
            ${ts1Subs.map(s => {
              const isTarget = parseInt(s.talkgroup, 10) === targetTgNum;
              const tgName = (typeof (window.TG_NAMES || {}) !== "undefined" && (window.TG_NAMES || {})[s.talkgroup]) || '';
              return `<span class="bm-info-tg-pill ${isTarget ? 'is-target-tg' : ''}" title="${tgName ? `TG ${s.talkgroup}: ${tgName}` : `TG ${s.talkgroup}`}">TG ${safeEscapeHtml(s.talkgroup)}${tgName ? ` <small style="opacity:0.75; font-size:0.68rem;">(${safeEscapeHtml(tgName)})</small>` : ''}</span>`;
            }).join("")}
          </div>
        ` : `<div style="font-size: 0.76rem; color: #8b949e;">${window.t ? window.t("bm_info.no_static_ts1", {}, "Нет статических групп на таймслоте TS1") : "Нет статических групп на таймслоте TS1"}</div>`}
      </div>

      <div class="bm-info-card">
        <div class="bm-info-card-header">
          <div class="bm-info-card-title"><span>📻</span> ${window.t ? window.t("bm_info.static_subs_ts2", { count: ts2Subs.length }, `Статические подписки TS2 (${ts2Subs.length})`) : `Статические подписки TS2 (${ts2Subs.length})`}</div>
        </div>
        ${ts2Subs.length > 0 ? `
          <div class="bm-info-tg-pills">
            ${ts2Subs.map(s => {
              const isTarget = parseInt(s.talkgroup, 10) === targetTgNum;
              const tgName = (typeof (window.TG_NAMES || {}) !== "undefined" && (window.TG_NAMES || {})[s.talkgroup]) || '';
              return `<span class="bm-info-tg-pill ts2-pill ${isTarget ? 'is-target-tg' : ''}" title="${tgName ? `TG ${s.talkgroup}: ${tgName}` : `TG ${s.talkgroup}`}">TG ${safeEscapeHtml(s.talkgroup)}${tgName ? ` <small style="opacity:0.75; font-size:0.68rem;">(${safeEscapeHtml(tgName)})</small>` : ''}</span>`;
            }).join("")}
          </div>
        ` : `<div style="font-size: 0.76rem; color: #8b949e;">${window.t ? window.t("bm_info.no_static_ts2", {}, "Нет статических групп на таймслоте TS2") : "Нет статических групп на таймслоте TS2"}</div>`}
      </div>
    `;
  } else if (queryType === "talkgroup_info") {
    const d = data.data || {};
    const tgId = d.ID || targetId;
    const tgName = d.Name || ((typeof (window.TG_NAMES || {}) !== "undefined" && (window.TG_NAMES || {})[targetId]) || "");
    const isFound = Boolean(d.ID && d.Name);

    const tgRegTitle = window.t ? window.t("bm_info.tg_registry_title", {}, "Реестр разговорных групп BM") : "Реестр разговорных групп BM";
    const badgeReg = window.t ? window.t("bm_info.registered_in_bm", {}, "Зарегистрирована в BM") : "Зарегистрирована в BM";
    const badgeLocal = window.t ? window.t("bm_info.local_not_in_bm", {}, "Локальная / Не в реестре BM") : "Локальная / Не в реестре BM";
    const propTgNum = window.t ? window.t("bm_info.prop_tg_num", {}, "Номер TalkGroup") : "Номер TalkGroup";
    const propOffName = window.t ? window.t("bm_info.official_name", {}, "Официальное название") : "Официальное название";
    const propRegStatus = window.t ? window.t("bm_info.reg_status", {}, "Статус регистрации") : "Статус регистрации";
    const valRegBm = window.t ? window.t("bm_info.official_registry_bm_v2", {}, "Официальный реестр BM v2") : "Официальный реестр BM v2";
    const valRegCustom = window.t ? window.t("bm_info.custom_regional_tg", {}, "Пользовательская или региональная TG") : "Пользовательская или региональная TG";
    const propAvail = window.t ? window.t("bm_info.availability", {}, "Доступность") : "Доступность";
    const valGlobalBm = window.t ? window.t("bm_info.global_bm_network", {}, "Глобальная сеть BM") : "Глобальная сеть BM";
    const hintFooter = window.t ? window.t("bm_info.tg_hint_footer", {}, "💡 Разговорные группы BM маршрутизируются серверами сети по их числовому номеру. Любой абонент может нажать PTT для динамической активации группы на своем хотспоте.") : "💡 Разговорные группы BM маршрутизируются серверами сети по их числовому номеру. Любой абонент может нажать PTT для динамической активации группы на своем хотспоте.";

    cardsBox.innerHTML = `
      <div class="bm-info-card">
        <div class="bm-info-card-header">
          <div class="bm-info-card-title"><span>🌐</span> ${safeEscapeHtml(tgRegTitle)}</div>
          <span class="bm-info-card-badge ${isFound ? 'bm-info-badge-online' : 'bm-info-badge-offline'}">${isFound ? safeEscapeHtml(badgeReg) : safeEscapeHtml(badgeLocal)}</span>
        </div>
        <div class="bm-info-props-grid">
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propTgNum)}</span>
            <span class="bm-info-prop-val highlight" style="font-size: 1.15rem; font-weight: 800;">TG ${tgId}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propOffName)}</span>
            <span class="bm-info-prop-val blue" style="font-size: 1.05rem;">${safeEscapeHtml(tgName || '—')}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propRegStatus)}</span>
            <span class="bm-info-prop-val">${isFound ? safeEscapeHtml(valRegBm) : safeEscapeHtml(valRegCustom)}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propAvail)}</span>
            <span class="bm-info-prop-val">${safeEscapeHtml(valGlobalBm)}</span>
          </div>
        </div>
        <div style="font-size: 0.74rem; color: #8b949e; margin-top: 10px; line-height: 1.4;">
          ${safeEscapeHtml(hintFooter)}
        </div>
      </div>
    `;
  } else if (queryType === "devices_by_call") {
    const devices = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
    const unitDev = devices.length === 1 ? (window.t ? window.t("bm_info.unit_device_one", {}, "устройство") : "устройство") : (window.t ? window.t("bm_info.unit_device_many", {}, "устройств") : "устройств");
    let html = `
      <div class="bm-info-card">
        <div class="bm-info-card-header">
          <div class="bm-info-card-title"><span>🔎</span> ${window.t ? window.t("bm_info.devices_by_call_title", { call: data.callsign || targetId }, `Устройства позывного ${data.callsign || targetId}`) : `Устройства позывного ${data.callsign || targetId}`}</div>
          <span class="bm-info-card-badge ${devices.length > 0 ? 'bm-info-badge-online' : 'bm-info-badge-offline'}">${devices.length} ${safeEscapeHtml(unitDev)}</span>
        </div>
    `;

    if (devices.length === 0) {
      html += `
        <div style="font-size: 0.80rem; color: #8b949e; padding: 8px 0;">
          ${window.t ? window.t("bm_info.no_devices_found", {}, "В реестре BM не найдено зарегистрированных репитеров или хотспотов для данного позывного.") : "В реестре BM не найдено зарегистрированных репитеров или хотспотов для данного позывного."}
        </div>
      </div>`;
    } else {
      html += `
        <div class="bm-info-devices-wrap">
          <table class="bm-info-devices-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>${window.t ? window.t("bm_info.th_callsign", {}, "Позывной") : "Позывной"}</th>
                <th>${window.t ? window.t("bm_info.th_status", {}, "Статус") : "Статус"}</th>
                <th>${window.t ? window.t("bm_info.th_master", {}, "Мастер") : "Мастер"}</th>
                <th>${window.t ? window.t("bm_info.th_freq_cc", {}, "Частоты / CC") : "Частоты / CC"}</th>
                <th>${window.t ? window.t("bm_info.th_modem", {}, "Модем / Прошивка") : "Модем / Прошивка"}</th>
                <th>${window.t ? window.t("bm_info.th_location", {}, "Локация / Инфо") : "Локация / Инфо"}</th>
                <th>${window.t ? window.t("bm_info.th_last_contact", {}, "Последний контакт") : "Последний контакт"}</th>
              </tr>
            </thead>
            <tbody>
              ${devices.map(dev => {
                return `
                  <tr>
                    <td><span class="dmr-id-text" style="font-weight:700;">${dev.id}</span></td>
                    <td><strong style="color:#ff6700;">${safeEscapeHtml(dev.callsign || '')}</strong></td>
                    <td>${renderBmDeviceStatus(dev)}</td>
                    <td><span style="color:#58a6ff; font-weight:600;">${safeEscapeHtml(dev.lastKnownMaster || '—')}</span></td>
                    <td>RX: ${safeEscapeHtml(dev.rx || '—')}<br>TX: ${safeEscapeHtml(dev.tx || '—')} (CC:${dev.colorcode !== undefined ? dev.colorcode : 1})</td>
                    <td>${safeEscapeHtml(dev.hardware || dev.linkname || 'MMDVM')}<br><span style="color:#8b949e; font-size:0.72rem;">${safeEscapeHtml(dev.firmware ? `v${dev.firmware}` : '')}</span></td>
                    <td>${safeEscapeHtml(dev.city || dev.description || '—')}</td>
                    <td style="color:#8b949e; font-size:0.72rem;">${safeEscapeHtml(dev.last_seen || '—')}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
        ${renderBmRepeaterTechSection(devices)}
      </div>`;
    }
    cardsBox.innerHTML = html;
  } else if (queryType === "registry") {
    const items = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
    const item = items[0] || {};
    const regTitle = window.t ? window.t("bm_info.registry_title", {}, "Регистрация в сети BM / DMR") : "Регистрация в сети BM / DMR";
    const badgeReg = window.t ? window.t("bm_info.registered", {}, "Зарегистрирован") : "Зарегистрирован";
    const badgeNotFound = window.t ? window.t("bm_info.not_found", {}, "Не найдено") : "Не найдено";
    const propDmrId = window.t ? window.t("bm_info.prop_dmr_id", {}, "DMR ID") : "DMR ID";
    const propCall = window.t ? window.t("hamqth.prop_callsign", {}, "Позывной (Callsign)") : "Позывной (Callsign)";
    const propName = window.t ? window.t("bm_info.prop_name", {}, "Имя (Name)") : "Имя (Name)";
    const propSurname = window.t ? window.t("bm_info.surname_text", {}, "Фамилия / Текст (Text)") : "Фамилия / Текст (Text)";
    const propSymbol = window.t ? window.t("bm_info.prop_aprs_symbol", {}, "Символ APRS/DMR") : "Символ APRS/DMR";

    cardsBox.innerHTML = `
      <div class="bm-info-card">
        <div class="bm-info-card-header">
          <div class="bm-info-card-title"><span>📋</span> ${safeEscapeHtml(regTitle)}</div>
          <span class="bm-info-card-badge ${item.Call ? 'bm-info-badge-online' : 'bm-info-badge-offline'}">${item.Call ? safeEscapeHtml(badgeReg) : safeEscapeHtml(badgeNotFound)}</span>
        </div>
        <div class="bm-info-props-grid">
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propDmrId)}</span>
            <span class="bm-info-prop-val dmr-green" style="font-size: 1.05rem;">${item.ID || targetId}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propCall)}</span>
            <span class="bm-info-prop-val highlight" style="font-size: 1.15rem; font-weight: 800;">${safeEscapeHtml(item.Call || data.callsign || '—')}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propName)}</span>
            <span class="bm-info-prop-val">${safeEscapeHtml(item.Name || '—')}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propSurname)}</span>
            <span class="bm-info-prop-val">${safeEscapeHtml(item.Text || item.Surname || '—')}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">SSID</span>
            <span class="bm-info-prop-val blue">${item.SSID !== undefined ? item.SSID : '0'}</span>
          </div>
          <div class="bm-info-prop-item">
            <span class="bm-info-prop-label">${safeEscapeHtml(propSymbol)}</span>
            <span class="bm-info-prop-val">${safeEscapeHtml(item.Symbol || '—')}</span>
          </div>
        </div>
      </div>
    `;
  } else if (queryType === "unified" || queryType === "contact_info" || queryType === "auto" || queryType === "tg_summary") {
    let cardsHtml = "";

    // 1. Cross-type Notice Banner
    if (data.cross_info_note) {
      cardsHtml += `
        <div class="bm-info-cross-note">
          <span class="bm-note-icon">💡</span>
          <div class="bm-note-text">${safeEscapeHtml(data.cross_info_note)}</div>
        </div>
      `;
    }

    const op = data.operator || {};
    const tg = data.talkgroup || {};
    const reg = data.registry || {};
    const devices = Array.isArray(data.devices) ? data.devices : [];
    const prof = data.device_profile || {};
    const radio = data.radioid || op.radioid || {};

    const regCall = op.callsign || data.callsign || reg.Call || (extraInfo && extraInfo.callsign) || "";
    const opName = op.name || data.user_name || [reg.Name, reg.Surname].filter(Boolean).join(" ") || (extraInfo && extraInfo.name) || "";
    const opLoc = op.location || data.location || reg.Text || reg.City || (extraInfo && [extraInfo.city, extraInfo.country].filter(Boolean).join(", ")) || "—";

    const stg = data.static_talkgroups || { ts1: [], ts2: [] };
    const ts1Subs = Array.isArray(prof.static_ts1) && prof.static_ts1.length > 0 ? prof.static_ts1 : (Array.isArray(stg.ts1) ? stg.ts1 : []);
    const ts2Subs = Array.isArray(prof.static_ts2) && prof.static_ts2.length > 0 ? prof.static_ts2 : (Array.isArray(stg.ts2) ? stg.ts2 : []);

    const isOperator = Boolean(data.is_operator || op.is_registered || regCall || reg.Call || reg.Name || (radio && radio.status));
    const isTg = Boolean(data.is_talkgroup || tg.is_registered || tg.name || (extraInfo && extraInfo.type === "TG") || data.detected_type === "talkgroup" || data.detected_type === "custom_tg");
    const hasDevices = devices.length > 0;

    // 2. Operator Card (if radio amateur/operator)
    if (isOperator) {
      const isBmReg = Boolean(reg.Call || reg.ID || reg.Name || op.is_registered);
      const lblOp = window.t ? window.t("bm_info.lbl_operator", {}, "Оператор") : "Оператор";
      const badgeBmReg = window.t ? window.t("bm_info.badge_registered_bm", {}, "Зарегистрирован в BM") : "Зарегистрирован в BM";
      const badgeNotBm = window.t ? window.t("bm_info.badge_not_in_bm", {}, "В BM не найден (RadioID)") : "В BM не найден (RadioID)";
      const propCallsign = window.t ? window.t("hamqth.prop_callsign", {}, "Позывной (Callsign)") : "Позывной (Callsign)";
      const propDmrId = window.t ? window.t("bm_info.prop_dmr_id", {}, "DMR ID (Radio ID)") : "DMR ID (Radio ID)";
      const propName = window.t ? window.t("bm_info.prop_name", {}, "Имя (Name)") : "Имя (Name)";
      const propQth = window.t ? window.t("bm_info.prop_qth", {}, "Город / Страна / QTH") : "Город / Страна / QTH";
      const propRadioIdStatus = window.t ? window.t("bm_info.prop_radioid_status", {}, "Статус RadioID") : "Статус RadioID";
      const propLastAct = window.t ? window.t("bm_info.prop_last_activity", {}, "Последняя активность") : "Последняя активность";
      const propBmCreated = window.t ? window.t("bm_info.prop_bm_created", {}, "Дата регистрации в BM") : "Дата регистрации в BM";
      const propBmUpdated = window.t ? window.t("bm_info.prop_bm_updated", {}, "Обновлено в BM") : "Обновлено в BM";
      const propAprsSsid = window.t ? window.t("bm_info.prop_aprs_ssid", {}, "APRS SSID") : "APRS SSID";
      const propAprsSymbol = window.t ? window.t("bm_info.prop_aprs_symbol", {}, "Символ APRS/DMR") : "Символ APRS/DMR";
      const propBmText = window.t ? window.t("bm_info.prop_bm_text", {}, "Описание BM (Text)") : "Описание BM (Text)";
      const propRegistry = window.t ? window.t("bm_info.prop_registry", {}, "Реестр сети") : "Реестр сети";
      const valRegBm = window.t ? window.t("bm_info.val_registry_bm", {}, "BrandMeister DMR v2") : "BrandMeister DMR v2";
      const valRegLocal = window.t ? window.t("bm_info.val_registry_radioid", {}, "Локальная база RadioID") : "Локальная база RadioID";

      cardsHtml += `
        <div class="bm-info-card">
          <div class="bm-info-card-header">
            <div class="bm-info-card-title"><span>👤</span> ${safeEscapeHtml(lblOp)}: ${safeEscapeHtml(regCall || targetId)}</div>
            <span class="bm-info-card-badge ${isBmReg ? 'bm-info-badge-online' : 'bm-info-badge-offline'}">
              ${isBmReg ? safeEscapeHtml(badgeBmReg) : safeEscapeHtml(badgeNotBm)}
            </span>
          </div>
          <div class="bm-info-props-grid">
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(propCallsign)}</span>
              <span class="bm-info-prop-val highlight" style="font-size: 1.20rem; font-weight: 800; color: #ff6700;">${safeEscapeHtml(regCall || '—')}</span>
            </div>
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(propDmrId)}</span>
              <span class="bm-info-prop-val dmr-green" style="font-size: 1.15rem; font-weight: 700;">${targetId}</span>
            </div>
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(propName)}</span>
              <span class="bm-info-prop-val" style="font-weight: 600;">${safeEscapeHtml(opName || '—')}</span>
            </div>
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(propQth)}</span>
              <span class="bm-info-prop-val">${safeEscapeHtml(opLoc)}</span>
            </div>
            ${radio.status ? `
              <div class="bm-info-prop-item">
                <span class="bm-info-prop-label">${safeEscapeHtml(propRadioIdStatus)}</span>
                <span class="bm-info-prop-val" style="color: #3fb950; font-weight: 700;">✓ ${safeEscapeHtml(String(radio.status).toUpperCase())}</span>
              </div>
            ` : ''}
            ${radio.lastheard ? `
              <div class="bm-info-prop-item">
                <span class="bm-info-prop-label">${safeEscapeHtml(propLastAct)}</span>
                <span class="bm-info-prop-val" style="color: #7ee787;">🎙️ ${formatBmDate(radio.lastheard, true)}${radio.lasttg ? ` <small style="color:#8b949e;">(TG ${radio.lasttg}${radio.lastmaster ? `, BM ${radio.lastmaster}` : ''})</small>` : ''}</span>
              </div>
            ` : ''}
            ${data.bm_created || op.bm_created ? `
              <div class="bm-info-prop-item">
                <span class="bm-info-prop-label">${safeEscapeHtml(propBmCreated)}</span>
                <span class="bm-info-prop-val blue">📅 ${formatBmDate(data.bm_created || op.bm_created)}</span>
              </div>
            ` : ''}
            ${data.bm_updated || op.bm_updated ? `
              <div class="bm-info-prop-item">
                <span class="bm-info-prop-label">${safeEscapeHtml(propBmUpdated)}</span>
                <span class="bm-info-prop-val">${formatBmDate(data.bm_updated || op.bm_updated, true)}</span>
              </div>
            ` : ''}
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(propAprsSsid)}</span>
              <span class="bm-info-prop-val blue">${op.ssid !== undefined && op.ssid !== null ? op.ssid : (reg.SSID !== undefined ? reg.SSID : '—')}</span>
            </div>
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(propAprsSymbol)}</span>
              <span class="bm-info-prop-val">${safeEscapeHtml(op.symbol || reg.Symbol || '—')}</span>
            </div>
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(propBmText)}</span>
              <span class="bm-info-prop-val">${safeEscapeHtml(op.text || reg.Text || '—')}</span>
            </div>
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(propRegistry)}</span>
              <span class="bm-info-prop-val">${isBmReg ? safeEscapeHtml(valRegBm) : safeEscapeHtml(valRegLocal)}</span>
            </div>
          </div>
        </div>
      `;
    }

    // 3. TalkGroup Card (if talkgroup or requested as talkgroup)
    if (isTg) {
      const tgNum = tg.id || targetId;
      const tgTitle = tg.name || data.tg_name || (typeof (window.TG_NAMES || {}) !== "undefined" && (window.TG_NAMES || {})[tgNum]) || "";
      const isSub = Boolean(data.subscription && data.subscription.is_subscribed);
      const subSlot = data.subscription ? data.subscription.slot : null;

      const cardTgTitle = window.t ? window.t("bm_info.card_talkgroup", {}, "Разговорная группа (TalkGroup)") : "Разговорная группа (TalkGroup)";
      const badgeRegBm = window.t ? window.t("bm_info.badge_registry_bm_v2", {}, "Реестр BM v2") : "Реестр BM v2";
      const badgeCustReg = window.t ? window.t("bm_info.badge_custom_regional", {}, "Пользовательская / Региональная") : "Пользовательская / Региональная";
      const propTgNum = window.t ? window.t("bm_info.prop_tg_num", {}, "Номер TalkGroup") : "Номер TalkGroup";
      const propTgTitle = window.t ? window.t("bm_info.prop_tg_title", {}, "Название группы") : "Название группы";
      const propHsStatus = window.t ? window.t("bm_info.prop_hs_status", {}, "Статус на вашем хотспоте") : "Статус на вашем хотспоте";
      const routingLabel = window.t ? window.t("bm_info.routing_label", {}, "Маршрутизация") : "Маршрутизация";
      const netName = window.t ? window.t("bm_info.network_name", {}, "Глобальная сеть BrandMeister") : "Глобальная сеть BrandMeister";

      cardsHtml += `
        <div class="bm-info-card">
          <div class="bm-info-card-header">
            <div class="bm-info-card-title"><span>🌐</span> ${safeEscapeHtml(cardTgTitle)}</div>
            <span class="bm-info-card-badge ${tg.is_registered ? 'bm-info-badge-online' : 'bm-info-badge-offline'}">
              ${tg.is_registered ? safeEscapeHtml(badgeRegBm) : safeEscapeHtml(badgeCustReg)}
            </span>
          </div>
          <div class="bm-info-props-grid">
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(propTgNum)}</span>
              <span class="bm-info-prop-val highlight" style="font-size: 1.18rem; font-weight: 800;">TG ${tgNum}</span>
            </div>
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(propTgTitle)}</span>
              <span class="bm-info-prop-val blue" style="font-size: 1.05rem;">${safeEscapeHtml(tgTitle || '—')}</span>
            </div>
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(propHsStatus)}</span>
              <span class="bm-info-prop-val ${isSub ? 'dmr-green' : ''}">
                ${isSub ? (window.t ? window.t("bm_info.in_static", { slot: subSlot }, `📌 В статике (Слот TS${subSlot})`) : `📌 В статике (Слот TS${subSlot})`) : (window.t ? window.t("bm_info.dynamic_ptt", {}, "Динамический PTT (15 мин)") : "Динамический PTT (15 мин)")}
              </span>
            </div>
            <div class="bm-info-prop-item">
              <span class="bm-info-prop-label">${safeEscapeHtml(routingLabel)}</span>
              <span class="bm-info-prop-val">${safeEscapeHtml(netName)}</span>
            </div>
          </div>
          ${tg.description ? `
            <div style="font-size: 0.78rem; color: #8b949e; margin-top: 8px;">
              ${safeEscapeHtml(tg.description)}
            </div>
          ` : ''}
        </div>
      `;
    }

    // 4. Equipment & Repeaters Card
    if (hasDevices) {
      const repCount = devices.filter(d => d.is_repeater).length;
      const unitDev = devices.length === 1 ? (window.t ? window.t("bm_info.unit_device_one", {}, "устройство") : "устройство") : (window.t ? window.t("bm_info.unit_device_many", {}, "устройств") : "устройств");
      cardsHtml += `
        <div class="bm-info-card">
          <div class="bm-info-card-header">
            <div class="bm-info-card-title"><span>📡</span> ${window.t ? window.t("bm_info.devices_title", { count: devices.length }, `Оборудование и репитеры (${devices.length})`) : `Оборудование и репитеры (${devices.length})`}</div>
            <span class="bm-info-card-badge ${devices.length > 0 ? 'bm-info-badge-online' : 'bm-info-badge-offline'}">
              ${devices.length} ${safeEscapeHtml(unitDev)}
            </span>
          </div>
          <div class="bm-info-devices-wrap">
            <table class="bm-info-devices-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>${window.t ? window.t("bm_info.th_callsign", {}, "Позывной") : "Позывной"}</th>
                  <th>${window.t ? window.t("bm_info.th_status", {}, "Статус") : "Статус"}</th>
                  <th>${window.t ? window.t("bm_info.th_master", {}, "Мастер") : "Мастер"}</th>
                  <th>${window.t ? window.t("bm_info.th_freq_cc", {}, "Частоты / CC") : "Частоты / CC"}</th>
                  <th>${window.t ? window.t("bm_info.th_modem", {}, "Модем / Прошивка") : "Модем / Прошивка"}</th>
                  <th>${window.t ? window.t("bm_info.th_location", {}, "Локация") : "Локация"}</th>
                  <th>${window.t ? window.t("bm_info.th_last_contact", {}, "Последний контакт") : "Последний контакт"}</th>
                </tr>
              </thead>
              <tbody>
                ${devices.map(dev => `
                  <tr>
                    <td><span class="dmr-id-text" style="font-weight:700;">${dev.id}</span></td>
                    <td><strong style="color:#ff6700;">${safeEscapeHtml(dev.callsign || '')}</strong></td>
                    <td>${renderBmDeviceStatus(dev)}</td>
                    <td><span style="color:#58a6ff; font-weight:600;">${safeEscapeHtml(dev.lastKnownMaster || '—')}</span></td>
                    <td>RX: ${safeEscapeHtml(dev.rx || '—')}<br>TX: ${safeEscapeHtml(dev.tx || '—')} (CC:${dev.colorcode !== undefined ? dev.colorcode : 1})</td>
                    <td>${safeEscapeHtml(dev.hardware || 'MMDVM')}<br><span style="color:#8b949e; font-size:0.72rem;">${safeEscapeHtml(dev.firmware ? `v${dev.firmware}` : '')}</span></td>
                    <td>${safeEscapeHtml(dev.city || dev.description || '—')}</td>
                    <td style="color:#8b949e; font-size:0.72rem;">${safeEscapeHtml(dev.last_seen || '—')}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          ${renderBmRepeaterTechSection(devices)}
        </div>
      `;
    }

    // 5. Device Profile & Static TalkGroups
    if (ts1Subs.length > 0 || ts2Subs.length > 0) {
      cardsHtml += `
        <div class="bm-info-card">
          <div class="bm-info-card-header">
            <div class="bm-info-card-title"><span>📌</span> ${window.t ? window.t("bm_info.static_tgs_title", { count: ts1Subs.length + ts2Subs.length }, `Статические TalkGroups профиля (${ts1Subs.length + ts2Subs.length})`) : `Статические TalkGroups профиля (${ts1Subs.length + ts2Subs.length})`}</div>
          </div>
          ${ts1Subs.length > 0 ? `
            <div style="font-size: 0.78rem; font-weight: 600; color: #58a6ff; margin-bottom: 4px;">${window.t ? window.t("bm_info.slot_ts1", { count: ts1Subs.length }, `Слот TS1 (${ts1Subs.length}):`) : `Слот TS1 (${ts1Subs.length}):`}</div>
            <div class="bm-info-tg-pills" style="margin-bottom: 8px;">
              ${ts1Subs.map(tgNum => {
                const tgName = (typeof (window.TG_NAMES || {}) !== "undefined" && (window.TG_NAMES || {})[tgNum]) || '';
                return `<span class="bm-info-tg-pill">TG ${tgNum}${tgName ? ` <small style="opacity:0.75; font-size:0.68rem;">(${safeEscapeHtml(tgName)})</small>` : ''}</span>`;
              }).join("")}
            </div>
          ` : ''}
          ${ts2Subs.length > 0 ? `
            <div style="font-size: 0.78rem; font-weight: 600; color: #2ea043; margin-bottom: 4px;">${window.t ? window.t("bm_info.slot_ts2", { count: ts2Subs.length }, `Слот TS2 (${ts2Subs.length}):`) : `Слот TS2 (${ts2Subs.length}):`}</div>
            <div class="bm-info-tg-pills">
              ${ts2Subs.map(tgNum => {
                const tgName = (typeof (window.TG_NAMES || {}) !== "undefined" && (window.TG_NAMES || {})[tgNum]) || '';
                return `<span class="bm-info-tg-pill ts2-pill">TG ${tgNum}${tgName ? ` <small style="opacity:0.75; font-size:0.68rem;">(${safeEscapeHtml(tgName)})</small>` : ''}</span>`;
              }).join("")}
            </div>
          ` : ''}
        </div>
      `;
    }

    // 6. Quick Action Call Button
    const directCallLabel = isOperator ? (regCall ? (window.t ? window.t("quick_assign.direct_call_named", { id: targetId, call: regCall }, `📞 Прямой вызов ID ${targetId} (${regCall})`) : `📞 Прямой вызов ID ${targetId} (${regCall})`) : (window.t ? window.t("quick_assign.direct_call_btn", { id: targetId }, `📞 Прямой вызов ID ${targetId}`) : `📞 Прямой вызов ID ${targetId}`)) : (window.t ? window.t("quick_assign.direct_call_btn", { id: targetId }, `📞 Вызов ID ${targetId}`) : `📞 Вызов ID ${targetId}`);
    const tgCallLabel = window.t ? window.t("quick_assign.tg_call_btn", { tg: targetId }, `🌐 Вызов TalkGroup TG ${targetId}`) : `🌐 Вызов TalkGroup TG ${targetId}`;

    cardsHtml += `
      <div class="bm-info-card bm-info-action-card" style="padding: 12px 14px;">
        ${isOperator ? `
          <button type="button" class="btn-bm-direct-call" id="btnBmModalDirectCall">
            ${safeEscapeHtml(directCallLabel)}
          </button>
        ` : `
          <button type="button" class="btn-bm-direct-call" style="background: linear-gradient(135deg, #1f6feb 0%, #238636 100%); border-color: #3fb950;" id="btnBmModalTgCall">
            ${safeEscapeHtml(tgCallLabel)}
          </button>
        `}
        <div class="bm-info-actions-row">
          <button type="button" class="btn-bm-action-secondary" id="btnBmModalAddContact">
            ${window.t ? window.t("bm_info.to_contacts", {}, "📇 В Контакты") : "📇 В Контакты"}
          </button>
          <button type="button" class="btn-bm-action-secondary" id="btnBmModalAddMem">
            ${window.t ? window.t("bm_info.to_memories", {}, "⭐ В память M1–M5") : "⭐ В память M1–M5"}
          </button>
          ${isOperator && isTg ? `
            <button type="button" class="btn-bm-action-secondary" id="btnBmModalTgCall">
              ${window.t ? window.t("bm_info.btn_call_tg", { tg: targetId }, `🌐 Вызов TG ${targetId}`) : `🌐 Вызов TG ${targetId}`}
            </button>
          ` : ''}
        </div>
      </div>
    `;

    cardsBox.innerHTML = cardsHtml;

    // Attach button listeners
    const btnDirectCall = document.getElementById("btnBmModalDirectCall");
    if (btnDirectCall) {
      btnDirectCall.onclick = () => {
        const rid = parseInt(targetId, 10);
        if (rid > 0) {
          if (regCall) {
            (window.USER_CALLSIGNS || {})[rid] = {
              callsign: regCall,
              name: opName || "",
              country: opLoc || ""
            };
            try {
              localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify((window.USER_CALLSIGNS || {})));
            } catch (e) {}
          }
          const qInfo = currentBmInfoQuery && currentBmInfoQuery.tgOrIdInfo;
          const targetHid = (qInfo && qInfo.hotspot_id) || window.activeHotspotId || "default";
          const targetSlot = (qInfo && qInfo.slot) || window.activeSlot || 1;
          setHotspotTg(targetHid, targetSlot, rid, true);
          closeBmInfoModal();
          if (typeof closeCallIdModal === "function") closeCallIdModal();
        }
      };
    }

    const btnTgCall = document.getElementById("btnBmModalTgCall");
    if (btnTgCall) {
      btnTgCall.onclick = () => {
        const tgNum = parseInt(targetId, 10);
        if (tgNum > 0) {
          const qInfo = currentBmInfoQuery && currentBmInfoQuery.tgOrIdInfo;
          const targetHid = (qInfo && qInfo.hotspot_id) || window.activeHotspotId || "default";
          const targetSlot = (qInfo && qInfo.slot) || window.activeSlot || 1;
          setHotspotTg(targetHid, targetSlot, tgNum, false);
          closeBmInfoModal();
          if (typeof closeSearchTgIdModal === "function") closeSearchTgIdModal();
        }
      };
    }

    const btnAddContact = document.getElementById("btnBmModalAddContact");
    if (btnAddContact) {
      btnAddContact.onclick = () => {
        closeBmInfoModal();
        const contactItem = {
          type: isOperator ? "ID" : "TG",
          value: targetId,
          callsign: regCall || "",
          name: opName || (tg && tg.name) || (extraInfo && extraInfo.name) || ""
        };
        currentTgIdActionTarget = contactItem;
        if (typeof handleTgActionContact === "function") {
          handleTgActionContact();
        }
      };
    }

    const btnAddMem = document.getElementById("btnBmModalAddMem");
    if (btnAddMem) {
      btnAddMem.onclick = () => {
        closeBmInfoModal();
        const memItem = {
          type: isOperator ? "ID" : "TG",
          value: targetId,
          callsign: regCall || "",
          name: opName || (tg && tg.name) || (extraInfo && extraInfo.name) || "",
          hotspotId: currentModalQuickMemHid || window.activeHotspotId
        };
        openQuickMemPicker(memItem);
      };
    }
  }
}

let currentBmInfoTab = "bm";
let currentBmInfoCallsign = "";
let currentBmInfoTargetId = "";
let currentBmInfoExtra = null;
let currentHamQthLoadedFor = "";

export function switchBmInfoTab(tab) {
  currentBmInfoTab = tab;
  const btnBm = document.getElementById("tabBtnBmInfoBm");
  const btnHam = document.getElementById("tabBtnBmInfoHamQth");
  const paneBm = document.getElementById("paneBmInfo");
  const paneHam = document.getElementById("paneHamQthInfo");

  if (tab === "bm") {
    if (btnBm) btnBm.classList.add("active");
    if (btnHam) btnHam.classList.remove("active");
    if (paneBm) {
      paneBm.classList.add("active");
      paneBm.classList.remove("hidden");
    }
    if (paneHam) {
      paneHam.classList.remove("active");
      paneHam.classList.add("hidden");
    }
  } else {
    if (btnBm) btnBm.classList.remove("active");
    if (btnHam) btnHam.classList.add("active");
    if (paneBm) {
      paneBm.classList.remove("active");
      paneBm.classList.add("hidden");
    }
    if (paneHam) {
      paneHam.classList.add("active");
      paneHam.classList.remove("hidden");
    }

    if (!currentBmInfoCallsign && currentBmInfoTargetId) {
      const rid = parseInt(currentBmInfoTargetId, 10);
      if (!isNaN(rid) && window.USER_CALLSIGNS && window.USER_CALLSIGNS[rid] && window.USER_CALLSIGNS[rid].callsign) {
        currentBmInfoCallsign = window.USER_CALLSIGNS[rid].callsign;
      }
    }

    const key = (currentBmInfoCallsign || currentBmInfoTargetId || "").trim().toUpperCase();
    if (currentHamQthLoadedFor !== key) {
      loadHamQthInfo(currentBmInfoCallsign, currentBmInfoTargetId, currentBmInfoExtra);
    }
  }
}

export async function loadHamQthInfo(callsign, targetId, extraInfo) {
  const loadingBox = document.getElementById("hamQthLoading");
  const loadingUrl = document.getElementById("hamQthLoadingUrl");
  const noCredsBox = document.getElementById("hamQthNoCreds");
  const notFoundBox = document.getElementById("hamQthNotFound");
  const notFoundMsg = document.getElementById("hamQthNotFoundMsg");
  const errorBox = document.getElementById("hamQthError");
  const errorMsg = document.getElementById("hamQthErrorMsg");
  const contentBox = document.getElementById("hamQthContent");
  const cardsBox = document.getElementById("hamQthStructuredCards");

  const hideAllHamQthStates = () => {
    if (loadingBox) loadingBox.classList.add("hidden");
    if (noCredsBox) noCredsBox.classList.add("hidden");
    if (notFoundBox) notFoundBox.classList.add("hidden");
    if (errorBox) errorBox.classList.add("hidden");
    if (contentBox) contentBox.classList.add("hidden");
  };

  hideAllHamQthStates();

  const isTg = extraInfo && extraInfo.type === "TG" && String(targetId).length < 7;
  if (isTg) {
    if (notFoundBox) {
      notFoundBox.classList.remove("hidden");
      if (notFoundMsg) {
        notFoundMsg.textContent = window.t ? window.t('quick_assign.tg_not_hamqth', { tg: targetId || '' }, `TalkGroup ${targetId || ''} является разговорной группой (каналом) BrandMeister и не имеет карточки на HamQTH.com.`) : `TalkGroup ${targetId || ''} является разговорной группой (каналом) BrandMeister и не имеет карточки на HamQTH.com.`;
      }
    }
    currentHamQthLoadedFor = (callsign || targetId || "").trim().toUpperCase();
    return;
  }

  let queryTarget = (callsign || "").trim();
  if (!queryTarget && targetId) {
    const rid = parseInt(targetId, 10);
    if (!isNaN(rid) && window.USER_CALLSIGNS && window.USER_CALLSIGNS[rid] && window.USER_CALLSIGNS[rid].callsign) {
      queryTarget = window.USER_CALLSIGNS[rid].callsign.trim();
      currentBmInfoCallsign = queryTarget;
    } else {
      queryTarget = String(targetId).trim();
    }
  }

  if (!queryTarget) {
    if (notFoundBox) {
      notFoundBox.classList.remove("hidden");
      if (notFoundMsg) notFoundMsg.textContent = window.t ? window.t("quick_assign.not_found_callsign", {}, "Позывной не указан") : "Позывной не указан";
    }
    return;
  }

  if (loadingBox) loadingBox.classList.remove("hidden");
  if (loadingUrl) loadingUrl.textContent = `/api/callsign/hamqth/${queryTarget}`;
  if (cardsBox) cardsBox.innerHTML = "";

  try {
    const resp = await fetch(`/api/callsign/hamqth/${encodeURIComponent(queryTarget)}`);
    const data = await resp.json().catch(() => null);

    hideAllHamQthStates();

    if (!resp.ok) {
      currentHamQthLoadedFor = "";
      if (errorBox) {
        errorBox.classList.remove("hidden");
        if (errorMsg) errorMsg.textContent = (data && (data.detail || data.message)) || (window.t ? window.t("quick_assign.err_server_hamqth", { status: resp.status }, `HTTP ${resp.status}: Ошибка сервера при запросе к HamQTH`) : `HTTP ${resp.status}: Ошибка сервера при запросе к HamQTH`);
      }
      return;
    }

    if (!data) {
      currentHamQthLoadedFor = "";
      if (errorBox) {
        errorBox.classList.remove("hidden");
        if (errorMsg) errorMsg.textContent = window.t ? window.t("quick_assign.err_empty_hamqth", {}, "Пустой ответ от сервера при запросе к HamQTH") : "Пустой ответ от сервера при запросе к HamQTH";
      }
      return;
    }

    if (data.status === "no_credentials") {
      currentHamQthLoadedFor = queryTarget.toUpperCase();
      if (noCredsBox) noCredsBox.classList.remove("hidden");
      return;
    }

    if (data.status === "not_found" || !data.found) {
      currentHamQthLoadedFor = queryTarget.toUpperCase();
      if (notFoundBox) {
        notFoundBox.classList.remove("hidden");
        if (notFoundMsg) {
          notFoundMsg.textContent = data.message || (window.t ? window.t("quick_assign.not_found_hamqth", { call: queryTarget }, `Данные о позывном ${queryTarget} на HamQTH.com отсутствуют.`) : `Данные о позывном ${queryTarget} на HamQTH.com отсутствуют.`);
        }
      }
      return;
    }

    if (data.status === "error") {
      currentHamQthLoadedFor = "";
      if (errorBox) {
        errorBox.classList.remove("hidden");
        if (errorMsg) errorMsg.textContent = data.message || (window.t ? window.t("quick_assign.err_hamqth", {}, "Ошибка запроса к HamQTH.com") : "Ошибка запроса к HamQTH.com");
      }
      return;
    }

    if (data.status === "ok" && data.found && data.data) {
      const call = (data.data.callsign || queryTarget).toUpperCase();
      currentHamQthLoadedFor = call;
      if (data.data.callsign) {
        currentBmInfoCallsign = data.data.callsign.toUpperCase();
      }
      if (contentBox) contentBox.classList.remove("hidden");
      renderHamQthCards(cardsBox, data.data, targetId);
      return;
    }

    currentHamQthLoadedFor = "";
    if (errorBox) {
      errorBox.classList.remove("hidden");
      if (errorMsg) errorMsg.textContent = data.message || (window.t ? window.t("quick_assign.err_unknown_hamqth", {}, "Неизвестный ответ от сервиса HamQTH") : "Неизвестный ответ от сервиса HamQTH");
    }
  } catch (err) {
    hideAllHamQthStates();
    currentHamQthLoadedFor = "";
    if (errorBox) {
      errorBox.classList.remove("hidden");
      if (errorMsg) errorMsg.textContent = window.t ? window.t("quick_assign.err_network", { error: err.message }, `Ошибка сети: ${err.message}`) : `Ошибка сети: ${err.message}`;
    }
  }
}

export function renderHamQthCards(container, d, targetId) {
  if (!container || !d) return;

  const callsign = (d.callsign || targetId || '—').toUpperCase();
  const opName = d.nick || d.name || '—';
  const fullName = [d.adr_name, d.name].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" / ") || '—';
  
  // QTH / City & Regional designations (RDA oblast, US state/county, district)
  const cityName = d.qth || d.adr_city || d.city || '—';
  const regionParts = [
    d.oblast ? (window.t ? window.t("hamqth.region_oblast", { val: d.oblast }, `обл. ${d.oblast}`) : `обл. ${d.oblast}`) : '',
    d.us_state ? (window.t ? window.t("hamqth.region_state", { val: `${d.us_state}${d.us_county ? ' (' + d.us_county + ')' : ''}` }, `штат ${d.us_state}${d.us_county ? ' (' + d.us_county + ')' : ''}`) : `штат ${d.us_state}${d.us_county ? ' (' + d.us_county + ')' : ''}`) : '',
    d.district ? (window.t ? window.t("hamqth.region_district", { val: d.district }, `р-н ${d.district}`) : `р-н ${d.district}`) : '',
    d.dok ? `DOK ${d.dok}` : ''
  ].filter(Boolean);
  const regionStr = regionParts.length ? ` (${regionParts.join(', ')})` : '';
  const cityDisplay = cityName !== '—' ? `${cityName}${regionStr}` : (regionParts.length ? regionParts.join(', ') : '—');

  const country = d.country || d.adr_country || '—';
  const adif = d.adif ? `(DXCC #${d.adif})` : '';
  const grid = d.grid || '—';
  const coords = (d.latitude && d.longitude) ? `${d.latitude}°, ${d.longitude}°` : '—';
  
  // Zones & UTC offset
  const utcStr = d.utc_offset !== undefined && d.utc_offset !== '' ? ` &bull; UTC ${Number(d.utc_offset) >= 0 ? '+' : ''}${d.utc_offset}` : '';
  const zones = `ITU: ${d.itu || '—'} &bull; CQ/WAZ: ${d.cq || '—'}${utcStr}`;
  const continent = d.continent || '—';

  // QSL details
  const qslBureau = d.qsl === 'Y' ? `<span style="color:#3fb950; font-weight:700;">${window.t ? window.t("hamqth.bureau_ok", {}, "Бюро ✓") : "Бюро ✓"}</span>` : (d.qsl === 'N' ? `<span style="color:#8b949e;">${window.t ? window.t("hamqth.bureau_no", {}, "Бюро ✕") : "Бюро ✕"}</span>` : '');
  const qslDirect = d.qsldirect === 'Y' ? `<span style="color:#3fb950; font-weight:700;">${window.t ? window.t("hamqth.direct_ok", {}, "Директ ✓") : "Директ ✓"}</span>` : (d.qsldirect === 'N' ? `<span style="color:#8b949e;">${window.t ? window.t("hamqth.direct_no", {}, "Директ ✕") : "Директ ✕"}</span>` : '');
  const qslVia = d.qsl_via ? `<span style="color:#58a6ff;">via ${safeEscapeHtml(d.qsl_via)}</span>` : '';
  const qslDetails = [qslBureau, qslDirect, qslVia].filter(Boolean).join(' &bull; ') || safeEscapeHtml(d.qsl || '—');

  // Electronic QSL
  const lotwStatus = d.lotw === 'Y' ? `<span style="color:#3fb950; font-weight:700;">✓ ${window.t ? window.t("hamqth.yes", {}, "Да") : "Да"}</span>` : (d.lotw === 'N' ? (window.t ? window.t("hamqth.no", {}, "Нет") : "Нет") : '—');
  const eqslStatus = d.eqsl === 'Y' ? `<span style="color:#3fb950; font-weight:700;">✓ ${window.t ? window.t("hamqth.yes", {}, "Да") : "Да"}</span>` : (d.eqsl === 'N' ? (window.t ? window.t("hamqth.no", {}, "Нет") : "Нет") : '—');
  const lotwEqsl = `LoTW: ${lotwStatus} &bull; eQSL: ${eqslStatus}`;

  const email = d.email ? safeEscapeHtml(d.email) : '—';
  const web = d.web ? safeEscapeHtml(d.web) : '';
  const lookups = d.lookups || '—';

  // Badges (License year, IOTA, birth year)
  const metaBadges = [];
  if (d.lic_year) metaBadges.push(window.t ? window.t("hamqth.badge_on_air", { year: d.lic_year }, `📻 В эфире с ${safeEscapeHtml(d.lic_year)} г.`) : `📻 В эфире с ${safeEscapeHtml(d.lic_year)} г.`);
  if (d.birth_year) metaBadges.push(window.t ? window.t("hamqth.badge_birth", { year: d.birth_year }, `🎂 Год рожд.: ${safeEscapeHtml(d.birth_year)}`) : `🎂 Год рожд.: ${safeEscapeHtml(d.birth_year)}`);
  if (d.iota) metaBadges.push(`🏝️ IOTA: ${safeEscapeHtml(d.iota)}`);

  let html = `
    <div class="bm-info-card">
      <div class="bm-info-card-header">
        <div class="bm-info-card-title">
          <span>🌍</span> HamQTH.com Callbook: <strong style="color: #ff6700; margin-left: 4px;">${safeEscapeHtml(callsign)}</strong>
        </div>
        <span class="bm-info-card-badge bm-info-badge-online">${window.t ? window.t("hamqth.badge_registered", {}, "Зарегистрирован") : "Зарегистрирован"}</span>
      </div>
      
      ${metaBadges.length ? `
        <div style="display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 12px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">
          ${metaBadges.map(b => `<span style="font-size: 0.73rem; background: rgba(88,166,255,0.12); color: #79c0ff; border: 1px solid rgba(88,166,255,0.25); border-radius: 4px; padding: 2px 7px; font-weight: 600;">${b}</span>`).join('')}
        </div>
      ` : ''}

      <div class="bm-info-props-grid">
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_callsign", {}, "Позывной (Callsign)") : "Позывной (Callsign)"}</span>
          <span class="bm-info-prop-val highlight" style="font-size: 1.20rem; font-weight: 800; color: #ff6700;">${safeEscapeHtml(callsign)}</span>
        </div>
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_nick", {}, "Оператор / Nick") : "Оператор / Nick"}</span>
          <span class="bm-info-prop-val" style="font-weight: 700; color: #58a6ff;">${safeEscapeHtml(opName)}</span>
        </div>
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_fullname", {}, "Полное имя") : "Полное имя"}</span>
          <span class="bm-info-prop-val">${safeEscapeHtml(fullName)}</span>
        </div>
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_city", {}, "Город / QTH") : "Город / QTH"}</span>
          <span class="bm-info-prop-val">${safeEscapeHtml(cityDisplay)}</span>
        </div>
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_country", {}, "Страна / DXCC") : "Страна / DXCC"}</span>
          <span class="bm-info-prop-val">${safeEscapeHtml(country)} <small style="color: #8b949e;">${safeEscapeHtml(adif)}</small></span>
        </div>
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_grid", {}, "QTH-локатор (Grid)") : "QTH-локатор (Grid)"}</span>
          <span class="bm-info-prop-val highlight" style="font-family: monospace; font-size: 0.95rem;">${safeEscapeHtml(grid)}</span>
        </div>
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_coords", {}, "Координаты") : "Координаты"}</span>
          <span class="bm-info-prop-val">${safeEscapeHtml(coords)}</span>
        </div>
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_zones", {}, "Зоны ITU / CQ") : "Зоны ITU / CQ"}</span>
          <span class="bm-info-prop-val">${zones}</span>
        </div>
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_continent", {}, "Континент") : "Континент"}</span>
          <span class="bm-info-prop-val">${safeEscapeHtml(continent)}</span>
        </div>
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_qsl_info", {}, "QSL инфо") : "QSL инфо"}</span>
          <span class="bm-info-prop-val">${qslDetails}</span>
        </div>
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_eqsl", {}, "Электронный QSL") : "Электронный QSL"}</span>
          <span class="bm-info-prop-val">${lotwEqsl}</span>
        </div>
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">E-mail</span>
          <span class="bm-info-prop-val">${email}</span>
        </div>
        ${web ? `
          <div class="bm-info-prop-item" style="grid-column: 1 / -1;">
            <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_website", {}, "Веб-сайт") : "Веб-сайт"}</span>
            <span class="bm-info-prop-val">
              <a href="${web}" target="_blank" rel="noopener" style="color: #58a6ff; text-decoration: underline;">${web} ↗</a>
            </span>
          </div>
        ` : ''}
        ${d.picture ? `
          <div class="bm-info-prop-item" style="grid-column: 1 / -1;">
            <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_photo", {}, "Фото в HamQTH") : "Фото в HamQTH"}</span>
            <span class="bm-info-prop-val">
              <a href="${safeEscapeHtml(d.picture)}" target="_blank" rel="noopener" style="color: #58a6ff; text-decoration: underline;">${window.t ? window.t("hamqth.open_photo", {}, "Открыть фото профиля ↗") : "Открыть фото профиля ↗"}</a>
            </span>
          </div>
        ` : ''}
        <div class="bm-info-prop-item">
          <span class="bm-info-prop-label">${window.t ? window.t("hamqth.prop_views", {}, "Просмотров на HamQTH") : "Просмотров на HamQTH"}</span>
          <span class="bm-info-prop-val blue">${safeEscapeHtml(lookups)}</span>
        </div>
      </div>

      ${d.bio ? `
        <div style="margin-top: 12px; padding: 10px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; font-size: 0.80rem; line-height: 1.4; color: #c9d1d9;">
          <strong style="color: #8b949e; display: block; margin-bottom: 4px; font-size: 0.72rem; text-transform: uppercase;">${window.t ? window.t("hamqth.prop_bio", {}, "Заметка / Bio:") : "Заметка / Bio:"}</strong>
          ${safeEscapeHtml(d.bio)}
        </div>
      ` : ''}

      <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
        <a href="https://www.hamqth.com/${encodeURIComponent(callsign)}" target="_blank" rel="noopener" class="btn-primary" style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.82rem; padding: 6px 14px; text-decoration: none; border-radius: 6px;">
          <span>${window.t ? window.t("hamqth.open_page", {}, "🌐 Открыть страницу на HamQTH.com ↗") : "🌐 Открыть страницу на HamQTH.com ↗"}</span>
        </a>
      </div>
    </div>
  `;

  if (d.qslpic) {
    html += `
      <div class="bm-info-card">
        <div class="bm-info-card-header">
          <div class="bm-info-card-title"><span>📷</span> ${window.t ? window.t("hamqth.qsl_card_title", {}, "QSL-карточка / Фотография") : "QSL-карточка / Фотография"}</div>
        </div>
        <div style="text-align: center; padding: 10px 0;">
          <a href="${safeEscapeHtml(d.qslpic)}" target="_blank" rel="noopener">
            <img src="${safeEscapeHtml(d.qslpic)}" alt="QSL" style="max-width: 100%; max-height: 280px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 4px 12px rgba(0,0,0,0.5);" onerror="this.parentElement.parentElement.style.display='none'">
          </a>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// Wire buttons in bmInfoModal
const btnCloseBmInfoTop = document.getElementById("btnCloseBmInfoModalTop");
if (btnCloseBmInfoTop) btnCloseBmInfoTop.onclick = () => closeBmInfoModal();

const btnCloseBmInfoBottom = document.getElementById("btnCloseBmInfoModalBottom");
if (btnCloseBmInfoBottom) btnCloseBmInfoBottom.onclick = () => closeBmInfoModal();

const btnBackToQuick = document.getElementById("btnBackToQuickAssign");
if (btnBackToQuick) {
  btnBackToQuick.onclick = () => {
    closeBmInfoModal();
    if (currentTgIdActionTarget) {
      openTgIdActionMenu(currentTgIdActionTarget);
    }
  };
}

const bmInfoModalEl = document.getElementById("bmInfoModal");
if (bmInfoModalEl) {
  bmInfoModalEl.addEventListener("click", (e) => {
    if (e.target === bmInfoModalEl) closeBmInfoModal();
  });
}

// Tab buttons in bmInfoModal
const btnBmTab = document.getElementById("tabBtnBmInfoBm");
const btnHamTab = document.getElementById("tabBtnBmInfoHamQth");
if (btnBmTab) {
  btnBmTab.addEventListener("click", () => switchBmInfoTab("bm"));
}
if (btnHamTab) {
  btnHamTab.addEventListener("click", () => switchBmInfoTab("hamqth"));
}

window.openBmInfoModal = openBmInfoModal;
window.closeBmInfoModal = closeBmInfoModal;
window.switchBmInfoTab = switchBmInfoTab;
window.loadHamQthInfo = loadHamQthInfo;

async function handleQuickAssignSelect(targetHid, targetSlot, targetTg, hotspotName) {
  closeQuickAssignModal();

  const resolvedTargetHid = resolveHotspotId(targetHid);

  // 1. Collapse all other hotspots (except pinned/locked ones), expand and activate chosen one
  const allCards = document.querySelectorAll(".radio-container");
  if (allCards.length > 1) {
    for (const card of allCards) {
      const cardHid = resolveHotspotId(card.dataset.hotspotId || "default");
      const isLocked = card.classList.contains("locked") || card.classList.contains("pinned") || localStorage.getItem(`proxdmr_hs_locked_${cardHid}`) === "true";
      if (cardHid === resolvedTargetHid) {
        await expandHotspot(cardHid);
      } else if (!isLocked) {
        await collapseHotspot(cardHid);
      }
    }
  } else {
    await expandHotspot(resolvedTargetHid);
  }

  // 2. Switch active hotspot
  switchActiveHotspot(resolvedTargetHid);

  // 3. Local transceiver slot and TG/ID setup
  const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${resolvedTargetHid}"]`) || document.getElementById("radioContainer");
  if (targetCard) {
    setCardSlot(targetCard, targetSlot, true);
  }
  setActiveSlot(targetSlot, true);

  const isIdTarget = Boolean(currentTgIdActionTarget && currentTgIdActionTarget.type === "ID");
  if (isIdTarget) {
    selectHotspotTargetId(targetCard, resolvedTargetHid, targetSlot, targetTg, "CALLER");
    showToast(window.t ? window.t("quick_assign.call_activated", { name: hotspotName, slot: targetSlot, id: targetTg }, `✅ [${hotspotName}] TS${targetSlot}: Вызов ID ${targetTg} активирован`) : `✅ [${hotspotName}] TS${targetSlot}: Вызов ID ${targetTg} активирован`, 3500);
    return;
  }

  setHotspotTg(resolvedTargetHid, targetSlot, targetTg, true);
  setTg(targetTg, true);

  // 4. Background BrandMeister update
  const targetHsObj = (Array.isArray(window.currentHotspots) && window.currentHotspots.find(h => resolveHotspotId(h.id) === resolvedTargetHid)) || null;
  if (targetHsObj && targetHsObj.auto_tg_bm === false) {
    console.log(`[QUICK_ASSIGN] Hotspot ${targetHsObj.name} has auto_tg_bm disabled; skipping BM auto-configuration`);
    return;
  }

  (async () => {
    try {
      showToast(window.t ? window.t("quick_assign.setting_bm", { name: hotspotName, slot: targetSlot }, `⏳ [${hotspotName}]: настройка BM TS${targetSlot}...`) : `⏳ [${hotspotName}]: настройка BM TS${targetSlot}...`, 2500);

      // A. Drop dynamic subscriptions on target slot
      try {
        await fetch("/api/bm/drop-dynamic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hotspot_id: resolvedTargetHid, slot: targetSlot })
        });
      } catch (err) {
        console.warn("[QUICK_ASSIGN] Drop dynamic warning:", err);
      }

      // B. Query existing static groups on BM
      let existingTgs = [];
      try {
        const resp = await fetch(`/api/bm/static-groups?hotspot_id=${encodeURIComponent(resolvedTargetHid)}`);
        const data = await resp.json();
        if (data && data.status === "ok") {
          const list = targetSlot === 1 ? (data.ts1 || []) : (data.ts2 || []);
          existingTgs = list.map(item => item.talkgroup).filter(tg => tg > 0);
        }
      } catch (err) {
        console.warn("[QUICK_ASSIGN] Fetch static groups warning:", err);
      }

      // C. Remove all static groups on this slot except targetTg
      const toDelete = existingTgs.filter(tg => tg !== targetTg);
      if (toDelete.length > 0) {
        try {
          await fetch("/api/bm/static-groups", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              hotspot_id: resolvedTargetHid,
              slot: targetSlot,
              talkgroups: toDelete
            })
          });
        } catch (err) {
          console.warn("[QUICK_ASSIGN] Delete static groups warning:", err);
        }
      }

      // D. Add targetTg as static group if not already present
      if (!existingTgs.includes(targetTg)) {
        const addResp = await fetch("/api/bm/static-groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hotspot_id: resolvedTargetHid,
            slot: targetSlot,
            talkgroups: [targetTg]
          })
        });
        const addData = await addResp.json();
        if (addData && addData.status === "ok") {
          showToast(window.t ? window.t("quick_assign.bm_set_toast", { name: hotspotName, slot: targetSlot, tg: targetTg }, `✅ [${hotspotName}] TS${targetSlot}: TG ${targetTg} установлен в BM`) : `✅ [${hotspotName}] TS${targetSlot}: TG ${targetTg} установлен в BM`, 4500);
        } else {
          const errDetail = addData?.detail || addData?.errors?.join("; ") || "Ошибка добавления в BM";
          showToast(`⚠️ [${hotspotName}] TS${targetSlot}: ${errDetail}`, 5000);
        }
      } else {
        showToast(window.t ? window.t("quick_assign.bm_active_cleared", { name: hotspotName, slot: targetSlot, tg: targetTg }, `✅ [${hotspotName}] TS${targetSlot}: TG ${targetTg} активен в BM (динамика очищена)`) : `✅ [${hotspotName}] TS${targetSlot}: TG ${targetTg} активен в BM (динамика очищена)`, 4500);
      }

      // E. Reload BM static modal if open
      if (typeof loadBmTgStaticGroups === "function") {
        try {
          loadBmTgStaticGroups(resolvedTargetHid);
        } catch (e) {}
      }
    } catch (err) {
      console.error("[QUICK_ASSIGN] Background sync failed:", err);
      showToast(window.t ? window.t("quick_assign.bm_conn_err", { name: hotspotName, error: err.message || err }, `⚠️ [${hotspotName}]: Ошибка связи с BM: ${err.message || err}`) : `⚠️ [${hotspotName}]: Ошибка связи с BM: ${err.message || err}`, 5000);
    }
  })();
}

// Delegated long-press listener on ID / TG elements and Memory buttons M1-M5
document.addEventListener("pointerdown", (e) => {
  if (e.button !== undefined && e.button !== 0) return;

  // 1. Direct Long-Press on M1-M5 Memory Button (.btn-card-mem):
  // Automatically saves the card's active PTT target into the memory slot without opening modal
  const cardMemBtn = e.target.closest(".btn-card-mem");
  if (cardMemBtn) {
    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = startX;
    let lastY = startY;
    let isTriggered = false;

    const timer = setTimeout(() => {
      isTriggered = true;
      lastLongPressHandledAt = Date.now();

      // Neon circle animation (1.5s non-linear curve)
      showLongPressEffect(lastX, lastY);

      // Visual flash pulse on the memory button
      cardMemBtn.classList.remove("target-selected-pulse");
      void cardMemBtn.offsetWidth;
      cardMemBtn.classList.add("target-selected-pulse");
      setTimeout(() => {
        cardMemBtn.classList.remove("target-selected-pulse");
      }, 800);

      // Tactile vibration
      if (navigator.vibrate) {
        try { navigator.vibrate([40, 50, 40]); } catch (ve) {}
      }

      const slot = parseInt(cardMemBtn.dataset.mem, 10);
      const card = cardMemBtn.closest(".radio-container") || document.getElementById("radioContainer");
      const pttTarget = getCardPttTarget(card);

      saveQuickMemory(slot, pttTarget, pttTarget.cid);

      const hsName = getHotspotDisplayName(pttTarget.cid);
      const cleanDesc = getCleanTgDesc(pttTarget.value, pttTarget.name);
      const displayStr = `${pttTarget.type || 'TG'} ${pttTarget.value}${cleanDesc ? ' (' + cleanDesc + ')' : ''}`;

      showToast(window.t ? window.t("mem.saved_toast", { name: hsName, slot, target: displayStr, slot_target: pttTarget.slot }, `💾 [${hsName}] M${slot}: записан ${displayStr} (из PTT TS${pttTarget.slot})`) : `💾 [${hsName}] M${slot}: записан ${displayStr} (из PTT TS${pttTarget.slot})`, 3500);
    }, 250);

    function onMemPointerMove(moveEvent) {
      if (isTriggered) return;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      if (Math.abs(moveEvent.clientX - startX) > 12 || Math.abs(moveEvent.clientY - startY) > 12) {
        clearTimeout(timer);
        cleanupMem();
      }
    }

    function onMemPointerUp(upEvent) {
      clearTimeout(timer);
      if (isTriggered) {
        upEvent.preventDefault();
        upEvent.stopPropagation();
      }
      cleanupMem();
    }

    function onMemPointerCancel() {
      clearTimeout(timer);
      cleanupMem();
    }

    function onMemContextMenu(menuEvent) {
      if (isTriggered) {
        menuEvent.preventDefault();
        menuEvent.stopPropagation();
      }
    }

    function cleanupMem() {
      window.removeEventListener("pointermove", onMemPointerMove, true);
      window.removeEventListener("pointerup", onMemPointerUp, true);
      window.removeEventListener("pointercancel", onMemPointerCancel, true);
      window.removeEventListener("contextmenu", onMemContextMenu, true);
    }

    window.addEventListener("pointermove", onMemPointerMove, { capture: true, passive: true });
    window.addEventListener("pointerup", onMemPointerUp, { capture: true });
    window.addEventListener("pointercancel", onMemPointerCancel, { capture: true, passive: true });
    window.addEventListener("contextmenu", onMemContextMenu, { capture: true });
    return;
  }

  // Never trigger Quick Assign / BM info modal while PTT transmission is active or if pointer started on PTT button!
  if (window.isPttPressed || (e.target && e.target.closest && e.target.closest(".ptt-button"))) {
    return;
  }

  // Long-press inside Last Heard log rows is handled exclusively by LogSelectionManager
  if (e.target && e.target.closest && e.target.closest(".live-call-row")) {
    return;
  }

  // 2. Check if target is inside an ID or TG element (opens Quick Assign modal)
  const tgOrIdInfo = extractTgOrIdFromElement(e.target);
  if (!tgOrIdInfo || !tgOrIdInfo.value) return;

  const startX = e.clientX;
  const startY = e.clientY;
  let lastX = startX;
  let lastY = startY;
  let isTriggered = false;

  const timer = setTimeout(() => {
    if (window.isPttPressed) return;
    isTriggered = true;
    lastLongPressHandledAt = Date.now();

    // Neon circle animation (0.8s with non-linear curve)
    showLongPressEffect(lastX, lastY);

    // Open quick assign dialog only after the circle animation finishes (0.8s = 800ms)
    setTimeout(() => {
      if (window.isPttPressed) return;
      openTgIdActionMenu(tgOrIdInfo);
    }, 800);
  }, 250);

  function onPointerMove(moveEvent) {
    if (isTriggered) return;
    lastX = moveEvent.clientX;
    lastY = moveEvent.clientY;
    if (Math.abs(moveEvent.clientX - startX) > 12 || Math.abs(moveEvent.clientY - startY) > 12) {
      clearTimeout(timer);
      cleanup();
    }
  }

  function onPointerUp(upEvent) {
    clearTimeout(timer);
    if (isTriggered) {
      upEvent.preventDefault();
      upEvent.stopPropagation();
    }
    cleanup();
  }

  function onPointerCancel() {
    clearTimeout(timer);
    cleanup();
  }

  function onContextMenu(menuEvent) {
    if (isTriggered) {
      menuEvent.preventDefault();
      menuEvent.stopPropagation();
    }
  }

  function cleanup() {
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("contextmenu", onContextMenu, true);
  }

  window.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
  window.addEventListener("pointerup", onPointerUp, { capture: true });
  window.addEventListener("pointercancel", onPointerCancel, { capture: true, passive: true });
  window.addEventListener("contextmenu", onContextMenu, { capture: true });
}, { capture: true });

// Suppress click event if it was preceded by a successful long press
document.addEventListener("click", (e) => {
  if (lastLongPressHandledAt && Date.now() - lastLongPressHandledAt < 2500) {
    // Never suppress clicks inside any open modal dialog or on modal buttons
    if (e.target && e.target.closest && e.target.closest(".modal.active, .tg-action-menu-card, .quick-mem-picker-card, .direct-call-card")) {
      lastLongPressHandledAt = 0;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    lastLongPressHandledAt = 0;
  }
}, { capture: true });

// Wire up modal listeners (executes directly on app initialization)
// 1. TG/ID Action Mini-Menu
const tgActionMenuModal = document.getElementById("tgIdActionMenuModal");
const closeTgIdActionMenuBtn = document.getElementById("closeTgIdActionMenuBtn");
const btnCancelTgIdActionMenu = document.getElementById("btnCancelTgIdActionMenu");
const btnTgActionContact = document.getElementById("btnTgActionContact");
const btnTgActionPtt = document.getElementById("btnTgActionPtt");
const btnTgActionQuickMem = document.getElementById("btnTgActionQuickMem");
const btnTgActionDirectCall = document.getElementById("btnTgActionDirectCall");
const btnTgActionInfo = document.getElementById("btnTgActionInfo");

if (closeTgIdActionMenuBtn) {
  closeTgIdActionMenuBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeTgIdActionMenu();
  };
}
if (btnCancelTgIdActionMenu) {
  btnCancelTgIdActionMenu.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeTgIdActionMenu();
  };
}
if (btnTgActionContact) {
  btnTgActionContact.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleTgActionContact();
  };
}
if (btnTgActionPtt) {
  btnTgActionPtt.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleTgActionPtt();
  };
}
if (btnTgActionQuickMem) {
  btnTgActionQuickMem.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleTgActionQuickMem();
  };
}
if (btnTgActionDirectCall) {
  btnTgActionDirectCall.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleTgActionDirectCall();
  };
}
if (btnTgActionInfo) {
  btnTgActionInfo.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleTgActionInfo();
  };
}

if (tgActionMenuModal) {
  tgActionMenuModal.addEventListener("click", (e) => {
    if (e.target === tgActionMenuModal) {
      closeTgIdActionMenu();
      return;
    }
    const btn = e.target.closest("button, .tg-action-tile, .icon-btn, .btn-cancel-quick-assign");
    if (!btn) return;
    if (btn.id === "closeTgIdActionMenuBtn" || btn.id === "btnCancelTgIdActionMenu" || btn.classList.contains("icon-btn") || btn.classList.contains("btn-cancel-quick-assign")) {
      e.preventDefault();
      e.stopPropagation();
      closeTgIdActionMenu();
    } else if (btn.id === "btnTgActionContact" || btn.classList.contains("tile-contacts")) {
      e.preventDefault();
      e.stopPropagation();
      handleTgActionContact();
    } else if (btn.id === "btnTgActionPtt" || btn.classList.contains("tile-ptt")) {
      e.preventDefault();
      e.stopPropagation();
      handleTgActionPtt();
    } else if (btn.id === "btnTgActionQuickMem" || btn.classList.contains("tile-memory")) {
      e.preventDefault();
      e.stopPropagation();
      handleTgActionQuickMem();
    } else if (btn.id === "btnTgActionDirectCall" || btn.classList.contains("tile-direct")) {
      e.preventDefault();
      e.stopPropagation();
      handleTgActionDirectCall();
    } else if (btn.id === "btnTgActionInfo" || btn.classList.contains("tile-info")) {
      e.preventDefault();
      e.stopPropagation();
      handleTgActionInfo();
    }
  });
}

// 2. Quick Memory Picker (M1-M5)
const quickMemPickerModal = document.getElementById("quickMemPickerModal");
const closeQuickMemPickerBtn = document.getElementById("closeQuickMemPickerBtn");
const btnCancelQuickMemPicker = document.getElementById("btnCancelQuickMemPicker");

if (closeQuickMemPickerBtn) {
  closeQuickMemPickerBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeQuickMemPicker();
  };
}
if (btnCancelQuickMemPicker) {
  btnCancelQuickMemPicker.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeQuickMemPicker();
  };
}

if (quickMemPickerModal) {
  quickMemPickerModal.addEventListener("click", (e) => {
    if (e.target === quickMemPickerModal) {
      closeQuickMemPicker();
      return;
    }
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "closeQuickMemPickerBtn" || btn.id === "btnCancelQuickMemPicker") {
      e.preventDefault();
      e.stopPropagation();
      closeQuickMemPicker();
    }
  });
}

// 3. Direct Call / Routing Modal
const directCallModal = document.getElementById("directCallModal");
const closeDirectCallBtn = document.getElementById("closeDirectCallBtn");
const btnCancelDirectCall = document.getElementById("btnCancelDirectCall");

if (closeDirectCallBtn) {
  closeDirectCallBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeDirectCallModal();
  };
}
if (btnCancelDirectCall) {
  btnCancelDirectCall.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeDirectCallModal();
  };
}

if (directCallModal) {
  directCallModal.addEventListener("click", (e) => {
    if (e.target === directCallModal) {
      closeDirectCallModal();
      return;
    }
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "closeDirectCallBtn" || btn.id === "btnCancelDirectCall") {
      e.preventDefault();
      e.stopPropagation();
      closeDirectCallModal();
    }
  });
}

// Legacy quick assign modal fallback listeners
const modal = document.getElementById("quickAssignModal");
const btnClose = document.getElementById("closeQuickAssignModalBtn");
const btnBottom = document.getElementById("btnCloseQuickAssignModalBottom");
const btnCancel = document.getElementById("btnCancelQuickAssign");

if (btnClose) btnClose.addEventListener("click", closeQuickAssignModal);
if (btnBottom) btnBottom.addEventListener("click", closeQuickAssignModal);
if (btnCancel) btnCancel.addEventListener("click", closeQuickAssignModal);
if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeQuickAssignModal();
  });
}

window.openTgIdActionMenu = openTgIdActionMenu;
window.closeTgIdActionMenu = closeTgIdActionMenu;
window.openQuickMemPicker = openQuickMemPicker;
window.closeQuickMemPicker = closeQuickMemPicker;
window.openDirectCallModal = openDirectCallModal;
window.closeDirectCallModal = closeDirectCallModal;
window.openQuickAssignModal = openTgIdActionMenu;
window.closeQuickAssignModal = closeQuickAssignModal;


// --- Initialization Entry Point ---
function initQuickAssign() {
  ensureQuickAssignDom();
  renderQuickMemButtons();
}

export {
  extractTgOrIdFromElement,
  openQuickAssignModal,
  closeQuickAssignModal,
  openTgIdActionMenu,
  closeTgIdActionMenu,
  openBmInfoModal,
  closeBmInfoModal,
  openQuickMemPicker,
  closeQuickMemPicker,
  openDirectCallModal,
  closeDirectCallModal,
  renderQuickMemButtons,
  refreshQuickAssignContactUI,
  getQuickMemory,
  saveQuickMemory,
  clearQuickMemory,
  handleQuickAssignSelect,
  initQuickAssign
};

if (typeof window !== "undefined") {
  window.extractTgOrIdFromElement = extractTgOrIdFromElement;
  window.openQuickAssignModal = openTgIdActionMenu;
  window.closeQuickAssignModal = closeQuickAssignModal;
  window.openTgIdActionMenu = openTgIdActionMenu;
  window.closeTgIdActionMenu = closeTgIdActionMenu;
  window.openBmInfoModal = openBmInfoModal;
  window.closeBmInfoModal = closeBmInfoModal;
  window.openQuickMemPicker = openQuickMemPicker;
  window.closeQuickMemPicker = closeQuickMemPicker;
  window.openDirectCallModal = openDirectCallModal;
  window.closeDirectCallModal = closeDirectCallModal;
  window.renderQuickMemButtons = renderQuickMemButtons;
  window.refreshQuickAssignContactUI = refreshQuickAssignContactUI;
  window.getQuickMemory = getQuickMemory;
  window.saveQuickMemory = saveQuickMemory;
  window.clearQuickMemory = clearQuickMemory;
  window.handleQuickAssignSelect = handleQuickAssignSelect;
  window.initQuickAssign = initQuickAssign;

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.openQuickAssignModal = openTgIdActionMenu;
  window.__proxdmr.closeQuickAssignModal = closeQuickAssignModal;
  window.__proxdmr.openBmInfoModal = openBmInfoModal;
  window.__proxdmr.closeBmInfoModal = closeBmInfoModal;
  window.__proxdmr.renderQuickMemButtons = renderQuickMemButtons;
}

if (typeof window !== "undefined") { window.safeEscapeHtml = safeEscapeHtml; }
