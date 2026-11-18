/**
 * ProxDMR Contacts (DMR Phonebook) Subsystem Module
 * Manages DMR contacts hierarchy (folders, talkgroups, personal calls, repeaters),
 * contact call proposals with BrandMeister routing and timeslot isolation,
 * contact creation/editing modals, JSON import/export, and gateway settings.
 */

import { escapeHtml, attachTgLivePreview, isoToEmoji, getLocalizedCountryName } from '../core/formatters.js?v=2.9.712';
import { showToast } from '../core/toast.js?v=2.9.699';
import { pushNavState, notifyNavClosed } from '../ui/navigation.js?v=2.9.614';
import { resolveHotspotId } from '../core/state.js?v=2.9.698';
import { getServerCollectionValue, hasServerCollectionKey, setServerCollectionKey, deleteServerCollectionKey } from '../settings/sync.js?v=2.9.737';

// Safe window helper bridges

function getHotspotDisplayName(hid) {
  if (typeof window !== "undefined" && typeof window.getHotspotDisplayName === "function") {
    return window.getHotspotDisplayName(hid);
  }
  return String(hid || "default");
}

function isHotspotCollapsed(hid) {
  if (typeof window !== "undefined" && typeof window.isHotspotCollapsed === "function") {
    return window.isHotspotCollapsed(hid);
  }
  return false;
}

async function collapseHotspot(hid) {
  if (typeof window !== "undefined" && typeof window.collapseHotspot === "function") {
    return await window.collapseHotspot(hid);
  }
}

async function expandHotspot(hid) {
  if (typeof window !== "undefined" && typeof window.expandHotspot === "function") {
    return await window.expandHotspot(hid);
  }
}

function switchActiveHotspot(hid) {
  if (typeof window !== "undefined" && typeof window.switchActiveHotspot === "function") {
    return window.switchActiveHotspot(hid);
  }
}

function setCardSlot(card, slot, notifyServer = true) {
  if (typeof window !== "undefined" && typeof window.setCardSlot === "function") {
    return window.setCardSlot(card, slot, notifyServer);
  }
}

function setActiveSlot(slot, notifyServer = true) {
  if (typeof window !== "undefined" && typeof window.setActiveSlot === "function") {
    return window.setActiveSlot(slot, notifyServer);
  }
}

function selectHotspotTargetId(card, hid, slot, targetId, type, tgName = null) {
  if (typeof window !== "undefined" && typeof window.selectHotspotTargetId === "function") {
    return window.selectHotspotTargetId(card, hid, slot, targetId, type, tgName);
  }
}

function loadBmTgStaticGroups(hid) {
  if (typeof window !== "undefined" && typeof window.loadBmTgStaticGroups === "function") {
    return window.loadBmTgStaticGroups(hid);
  }
  return Promise.resolve();
}

function refreshQuickAssignContactUI() {
  if (typeof window !== "undefined" && typeof window.refreshQuickAssignContactUI === "function") {
    return window.refreshQuickAssignContactUI();
  }
}

// My Contacts Elements
let myContactsModal = typeof document !== "undefined" ? document.getElementById("myContactsModal") : null;
let closeMyContactsModalBtn = typeof document !== "undefined" ? document.getElementById("closeMyContactsModalBtn") : null;
let btnCloseMyContactsModalBottom = typeof document !== "undefined" ? document.getElementById("btnCloseMyContactsModalBottom") : null;
let contactsCountBadge = typeof document !== "undefined" ? document.getElementById("contactsCountBadge") : null;
let btnContactsGatewayToggle = typeof document !== "undefined" ? document.getElementById("btnContactsGatewayToggle") : null;
let contactsGwSummary = typeof document !== "undefined" ? document.getElementById("contactsGwSummary") : null;
let contactsGatewayPanel = typeof document !== "undefined" ? document.getElementById("contactsGatewayPanel") : null;
let contactsGwHotspotSelect = typeof document !== "undefined" ? document.getElementById("contactsGwHotspotSelect") : null;
let contactsGwSlot1 = typeof document !== "undefined" ? document.getElementById("contactsGwSlot1") : null;
let contactsGwSlot2 = typeof document !== "undefined" ? document.getElementById("contactsGwSlot2") : null;
let btnSaveContactsGw = typeof document !== "undefined" ? document.getElementById("btnSaveContactsGw") : null;
let btnAddContactBtn = typeof document !== "undefined" ? document.getElementById("btnAddContactBtn") : null;
let btnAddFolderBtn = typeof document !== "undefined" ? document.getElementById("btnAddFolderBtn") : null;
let btnExportContacts = typeof document !== "undefined" ? document.getElementById("btnExportContacts") : null;
let btnImportContacts = typeof document !== "undefined" ? document.getElementById("btnImportContacts") : null;
let importContactsFileInput = typeof document !== "undefined" ? document.getElementById("importContactsFileInput") : null;
let contactsSearchInput = typeof document !== "undefined" ? document.getElementById("contactsSearchInput") : null;
let clearContactsSearchBtn = typeof document !== "undefined" ? document.getElementById("clearContactsSearchBtn") : null;
let contactsTreeContainer = typeof document !== "undefined" ? document.getElementById("contactsTreeContainer") : null;

// Contact Edit Modal Elements
let contactEditModal = typeof document !== "undefined" ? document.getElementById("contactEditModal") : null;
let closeContactEditModalBtn = typeof document !== "undefined" ? document.getElementById("closeContactEditModalBtn") : null;
let btnCancelContactEdit = typeof document !== "undefined" ? document.getElementById("btnCancelContactEdit") : null;
let btnSaveContactEdit = typeof document !== "undefined" ? document.getElementById("btnSaveContactEdit") : null;
let contactEditForm = typeof document !== "undefined" ? document.getElementById("contactEditForm") : null;
let contactEditModalTitle = typeof document !== "undefined" ? document.getElementById("contactEditModalTitle") : null;
let contactEditModalIcon = typeof document !== "undefined" ? document.getElementById("contactEditModalIcon") : null;
let contactEditNodeId = typeof document !== "undefined" ? document.getElementById("contactEditNodeId") : null;
let contactEditName = typeof document !== "undefined" ? document.getElementById("contactEditName") : null;
let contactEditCallsign = typeof document !== "undefined" ? document.getElementById("contactEditCallsign") : null;
let contactEditDmrId = typeof document !== "undefined" ? document.getElementById("contactEditDmrId") : null;
let contactEditTg = typeof document !== "undefined" ? document.getElementById("contactEditTg") : null;
let contactEditCity = typeof document !== "undefined" ? document.getElementById("contactEditCity") : null;
let contactEditParentSelect = typeof document !== "undefined" ? document.getElementById("contactEditParentSelect") : null;
let contactEditSlot = typeof document !== "undefined" ? document.getElementById("contactEditSlot") : null;
let contactEditComment = typeof document !== "undefined" ? document.getElementById("contactEditComment") : null;
let contactEditNetwork = typeof document !== "undefined" ? document.getElementById("contactEditNetwork") : null;
let contactEditXlxModuleGroup = typeof document !== "undefined" ? document.getElementById("contactEditXlxModuleGroup") : null;
let contactEditXlxModule = typeof document !== "undefined" ? document.getElementById("contactEditXlxModule") : null;
let contactEditIdHint = typeof document !== "undefined" ? document.getElementById("contactEditIdHint") : null;
let contactEditTgHint = typeof document !== "undefined" ? document.getElementById("contactEditTgHint") : null;
let contactEditSlotHint = typeof document !== "undefined" ? document.getElementById("contactEditSlotHint") : null;
let contactEditAllStarNodeGroup = typeof document !== "undefined" ? document.getElementById("contactEditAllStarNodeGroup") : null;
let contactEditAllStarNode = typeof document !== "undefined" ? document.getElementById("contactEditAllStarNode") : null;
let contactEditAllStarModeGroup = typeof document !== "undefined" ? document.getElementById("contactEditAllStarModeGroup") : null;
let contactEditAllStarMode = typeof document !== "undefined" ? document.getElementById("contactEditAllStarMode") : null;
let contactTypeOptAllStar = typeof document !== "undefined" ? document.getElementById("contactTypeOptAllStar") : null;

// Call Proposal Modal Elements
let contactCallProposalModal = typeof document !== "undefined" ? document.getElementById("contactCallProposalModal") : null;
let closeCallProposalModalBtn = typeof document !== "undefined" ? document.getElementById("closeCallProposalModalBtn") : null;
let proposalTypeBadge = typeof document !== "undefined" ? document.getElementById("proposalTypeBadge") : null;
let proposalTargetTitle = typeof document !== "undefined" ? document.getElementById("proposalTargetTitle") : null;
let proposalAvatar = typeof document !== "undefined" ? document.getElementById("proposalAvatar") : null;
let proposalHeroName = typeof document !== "undefined" ? document.getElementById("proposalHeroName") : null;
let proposalHeroMeta = typeof document !== "undefined" ? document.getElementById("proposalHeroMeta") : null;
let proposalHeroDesc = typeof document !== "undefined" ? document.getElementById("proposalHeroDesc") : null;
let proposalHotspotSelect = typeof document !== "undefined" ? document.getElementById("proposalHotspotSelect") : null;
let proposalSlotTs1 = typeof document !== "undefined" ? document.getElementById("proposalSlotTs1") : null;
let proposalSlotTs2 = typeof document !== "undefined" ? document.getElementById("proposalSlotTs2") : null;
let btnProposalApply = typeof document !== "undefined" ? document.getElementById("btnProposalApply") : null;
let btnProposalPtt = typeof document !== "undefined" ? document.getElementById("btnProposalPtt") : null;
let proposalApplyText = typeof document !== "undefined" ? document.getElementById("proposalApplyText") : null;
let proposalPttText = typeof document !== "undefined" ? document.getElementById("proposalPttText") : null;

function ensureElements() {
  if (typeof document === "undefined") return;
  if (!myContactsModal) myContactsModal = document.getElementById("myContactsModal");
  if (!closeMyContactsModalBtn) closeMyContactsModalBtn = document.getElementById("closeMyContactsModalBtn");
  if (!btnCloseMyContactsModalBottom) btnCloseMyContactsModalBottom = document.getElementById("btnCloseMyContactsModalBottom");
  if (!contactsCountBadge) contactsCountBadge = document.getElementById("contactsCountBadge");
  if (!btnContactsGatewayToggle) btnContactsGatewayToggle = document.getElementById("btnContactsGatewayToggle");
  if (!contactsGwSummary) contactsGwSummary = document.getElementById("contactsGwSummary");
  if (!contactsGatewayPanel) contactsGatewayPanel = document.getElementById("contactsGatewayPanel");
  if (!contactsGwHotspotSelect) contactsGwHotspotSelect = document.getElementById("contactsGwHotspotSelect");
  if (!contactsGwSlot1) contactsGwSlot1 = document.getElementById("contactsGwSlot1");
  if (!contactsGwSlot2) contactsGwSlot2 = document.getElementById("contactsGwSlot2");
  if (!btnSaveContactsGw) btnSaveContactsGw = document.getElementById("btnSaveContactsGw");
  if (!btnAddContactBtn) btnAddContactBtn = document.getElementById("btnAddContactBtn");
  if (!btnAddFolderBtn) btnAddFolderBtn = document.getElementById("btnAddFolderBtn");
  if (!btnExportContacts) btnExportContacts = document.getElementById("btnExportContacts");
  if (!btnImportContacts) btnImportContacts = document.getElementById("btnImportContacts");
  if (!importContactsFileInput) importContactsFileInput = document.getElementById("importContactsFileInput");
  if (!contactsSearchInput) contactsSearchInput = document.getElementById("contactsSearchInput");
  if (!clearContactsSearchBtn) clearContactsSearchBtn = document.getElementById("clearContactsSearchBtn");
  if (!contactsTreeContainer) contactsTreeContainer = document.getElementById("contactsTreeContainer");

  if (!contactEditModal) contactEditModal = document.getElementById("contactEditModal");
  if (!closeContactEditModalBtn) closeContactEditModalBtn = document.getElementById("closeContactEditModalBtn");
  if (!btnCancelContactEdit) btnCancelContactEdit = document.getElementById("btnCancelContactEdit");
  if (!btnSaveContactEdit) btnSaveContactEdit = document.getElementById("btnSaveContactEdit");
  if (!contactEditForm) contactEditForm = document.getElementById("contactEditForm");
  if (!contactEditModalTitle) contactEditModalTitle = document.getElementById("contactEditModalTitle");
  if (!contactEditModalIcon) contactEditModalIcon = document.getElementById("contactEditModalIcon");
  if (!contactEditNodeId) contactEditNodeId = document.getElementById("contactEditNodeId");
  if (!contactEditName) contactEditName = document.getElementById("contactEditName");
  if (!contactEditCallsign) contactEditCallsign = document.getElementById("contactEditCallsign");
  if (!contactEditDmrId) contactEditDmrId = document.getElementById("contactEditDmrId");
  if (!contactEditTg) contactEditTg = document.getElementById("contactEditTg");
  if (!contactEditCity) contactEditCity = document.getElementById("contactEditCity");
  if (!contactEditParentSelect) contactEditParentSelect = document.getElementById("contactEditParentSelect");
  if (!contactEditSlot) contactEditSlot = document.getElementById("contactEditSlot");
  if (!contactEditComment) contactEditComment = document.getElementById("contactEditComment");
  if (!contactEditNetwork) contactEditNetwork = document.getElementById("contactEditNetwork");
  if (!contactEditXlxModuleGroup) contactEditXlxModuleGroup = document.getElementById("contactEditXlxModuleGroup");
  if (!contactEditXlxModule) contactEditXlxModule = document.getElementById("contactEditXlxModule");
  if (!contactEditIdHint) contactEditIdHint = document.getElementById("contactEditIdHint");
  if (!contactEditTgHint) contactEditTgHint = document.getElementById("contactEditTgHint");
  if (!contactEditSlotHint) contactEditSlotHint = document.getElementById("contactEditSlotHint");
  if (!contactEditAllStarNodeGroup) contactEditAllStarNodeGroup = document.getElementById("contactEditAllStarNodeGroup");
  if (!contactEditAllStarNode) contactEditAllStarNode = document.getElementById("contactEditAllStarNode");
  if (!contactEditAllStarModeGroup) contactEditAllStarModeGroup = document.getElementById("contactEditAllStarModeGroup");
  if (!contactEditAllStarMode) contactEditAllStarMode = document.getElementById("contactEditAllStarMode");
  if (!contactTypeOptAllStar) contactTypeOptAllStar = document.getElementById("contactTypeOptAllStar");

  if (!contactCallProposalModal) contactCallProposalModal = document.getElementById("contactCallProposalModal");
  if (!closeCallProposalModalBtn) closeCallProposalModalBtn = document.getElementById("closeCallProposalModalBtn");
  if (!proposalTypeBadge) proposalTypeBadge = document.getElementById("proposalTypeBadge");
  if (!proposalTargetTitle) proposalTargetTitle = document.getElementById("proposalTargetTitle");
  if (!proposalAvatar) proposalAvatar = document.getElementById("proposalAvatar");
  if (!proposalHeroName) proposalHeroName = document.getElementById("proposalHeroName");
  if (!proposalHeroMeta) proposalHeroMeta = document.getElementById("proposalHeroMeta");
  if (!proposalHeroDesc) proposalHeroDesc = document.getElementById("proposalHeroDesc");
  if (!proposalHotspotSelect) proposalHotspotSelect = document.getElementById("proposalHotspotSelect");
  if (!proposalSlotTs1) proposalSlotTs1 = document.getElementById("proposalSlotTs1");
  if (!proposalSlotTs2) proposalSlotTs2 = document.getElementById("proposalSlotTs2");
  if (!btnProposalApply) btnProposalApply = document.getElementById("btnProposalApply");
  if (!btnProposalPtt) btnProposalPtt = document.getElementById("btnProposalPtt");
  if (!proposalApplyText) proposalApplyText = document.getElementById("proposalApplyText");
  if (!proposalPttText) proposalPttText = document.getElementById("proposalPttText");
}

export const DEFAULT_CONTACTS_TREE = [
    {
      id: "fav_root",
      type: "folder",
      network_type: "bm",
      name: "⭐ Favorites",
      collapsed: false,
      children: [
        { id: "fav_echo", type: "tg", network_type: "bm", name: "BM Echo Test (Parrot)", tg: 9990, city: "Worldwide", slot_override: 2, comment: "Modulation and latency test" },
        { id: "fav_ru", type: "tg", network_type: "bm", name: "Russia General", tg: 2501, city: "Russia", slot_override: 2, comment: "Primary talkgroup" }
      ]
    },
    {
      id: "groups_root",
      type: "folder",
      network_type: "bm",
      name: "🎯 Talkgroups (TG)",
      collapsed: false,
      children: [
        {
          id: "tg_fed",
          type: "folder",
          network_type: "bm",
          name: "Federal TG",
          collapsed: false,
          children: [
            { id: "tg_2501", type: "tg", network_type: "bm", name: "Russia (Main)", tg: 2501, city: "RU", slot_override: 2 },
            { id: "tg_2502", type: "tg", network_type: "bm", name: "Russia (Calling)", tg: 2502, city: "RU", slot_override: 2 },
            { id: "tg_91", type: "tg", network_type: "bm", name: "Worldwide English", tg: 91, city: "Global", slot_override: 1 }
          ]
        },
        {
          id: "tg_reg",
          type: "folder",
          network_type: "bm",
          name: "Regional TG",
          collapsed: true,
          children: [
            { id: "tg_25050", type: "tg", network_type: "bm", name: "Moscow & Region", tg: 25050, city: "Moscow", slot_override: 2 },
            { id: "tg_25078", type: "tg", network_type: "bm", name: "Saint Petersburg & LO", tg: 25078, city: "St. Petersburg", slot_override: 2 },
            { id: "tg_25026", type: "tg", network_type: "bm", name: "South Russia / Caucasus", tg: 25026, city: "South / N. Caucasus", slot_override: 2 },
            { id: "tg_25066", type: "tg", network_type: "bm", name: "Ural & Siberia", tg: 25066, city: "Ural / Siberia", slot_override: 2 }
          ]
        }
      ]
    },
    {
      id: "repeaters_root",
      type: "folder",
      network_type: "bm",
      name: "📡 Repeaters & Hotspots",
      collapsed: true,
      children: [
        { id: "rpt_moscow", type: "repeater", network_type: "bm", name: "RR3AAA Moscow Repeater", callsign: "RR3AAA", dmr_id: 250100, city: "Moscow, 439.100", slot_override: 1, comment: "BM Master 2501" },
        { id: "rpt_spb", type: "repeater", network_type: "bm", name: "RR1AA St. Petersburg Repeater", callsign: "RR1AA", dmr_id: 250101, city: "St. Petersburg, 438.825", slot_override: 2, comment: "BM Master 2501" }
      ]
    }
  ];


export let contactsTree = [];
export let contactsCrossCallsigns = {};
export let contactsGateway = { hotspot_id: "default", slot: 2 };
let currentProposalNode = null;
let selectedProposalSlot = 2;
let selectedProposalHid = "default";
let contactsSearchDebounceTimer = null;
let isContactsManagerInitialized = false;

// Global window properties for backwards compatibility
try {
  Object.defineProperty(window, "contactsTree", {
    get: () => contactsTree,
    set: (v) => { contactsTree = v; },
    configurable: true
  });
} catch (e) {
  window.contactsTree = contactsTree;
}

try {
  Object.defineProperty(window, "contactsGateway", {
    get: () => contactsGateway,
    set: (v) => { contactsGateway = v; },
    configurable: true
  });
} catch (e) {
  window.contactsGateway = contactsGateway;
}

export function ensureValidContactsGateway() {
    if (!contactsGateway || typeof contactsGateway !== "object") {
      contactsGateway = { hotspot_id: "default", slot: 2 };
    }
    if (!Array.isArray(window.currentHotspots) || window.currentHotspots.length === 0) {
      return false;
    }
    const bmHotspots = window.currentHotspots.filter(h => (h.network_type || "bm").toLowerCase() === "bm");
    const pool = bmHotspots.length > 0 ? bmHotspots : window.currentHotspots;
    const resolvedGw = resolveHotspotId(contactsGateway.hotspot_id);
    const exists = pool.some(h =>
      String(h.id) === String(contactsGateway.hotspot_id) ||
      resolveHotspotId(h.id) === resolvedGw
    );
    if (!exists) {
      const fallbackId = pool[0].id || "default";
      console.log(`[CONTACTS] Stale gateway hotspot_id "${contactsGateway.hotspot_id}" -> fallback "${fallbackId}"`);
      contactsGateway.hotspot_id = fallbackId;
      if (contactsGateway.slot !== 1 && contactsGateway.slot !== 2) {
        contactsGateway.slot = 2;
      }
      try {
        localStorage.setItem("proxdmr_contacts_gw", JSON.stringify(contactsGateway));
      } catch (e) {}
      saveContactsToServer();
      return true;
    }
    return false;
  }

export function loadContactsLocal() {
    try {
      const savedTree = localStorage.getItem("proxdmr_my_contacts_tree");
      if (savedTree) {
        contactsTree = JSON.parse(savedTree);
      }
    } catch (e) {}
    if (!Array.isArray(contactsTree)) {
      contactsTree = [];
    }
    try {
      const savedGw = localStorage.getItem("proxdmr_contacts_gw");
      if (savedGw) {
        contactsGateway = JSON.parse(savedGw);
      }
    } catch (e) {}
    if (!contactsGateway || !contactsGateway.hotspot_id) {
      contactsGateway = { hotspot_id: "default", slot: 2 };
    }
    ensureValidContactsGateway();
    updateContactsGatewaySummary();
  }

export async function loadContactsFromServer() {
    try {
      const res = await fetch("/api/contacts");
      if (res.ok) {
        const data = await res.json();
        if (data.status === "ok") {
          // Сервер — единственный источник истины: пустой список НЕ подменяется дефолтами
          contactsTree = Array.isArray(data.contacts) ? data.contacts : [];
          if (data.cross_callsigns && typeof data.cross_callsigns === "object") {
            contactsCrossCallsigns = data.cross_callsigns;
            if (typeof window !== "undefined") window.contactsCrossCallsigns = contactsCrossCallsigns;
          }
          try { localStorage.setItem("proxdmr_my_contacts_tree", JSON.stringify(contactsTree)); } catch (e) {}
          if (data.gateway && data.gateway.hotspot_id) {
            contactsGateway = data.gateway;
            try { localStorage.setItem("proxdmr_contacts_gw", JSON.stringify(contactsGateway)); } catch (e) {}
          }
          ensureValidContactsGateway();
          updateContactsGatewaySummary();
          renderContactsTree(contactsSearchInput ? contactsSearchInput.value.trim() : "");
        }
      }
    } catch (err) {
      console.warn("Failed to load contacts from server:", err);
    }
  }

  let saveContactsDebounce = null;
export function saveContactsToServer() {
    try {
      localStorage.setItem("proxdmr_my_contacts_tree", JSON.stringify(contactsTree));
      localStorage.setItem("proxdmr_contacts_gw", JSON.stringify(contactsGateway));
    } catch (e) {}
    clearTimeout(saveContactsDebounce);
    saveContactsDebounce = setTimeout(async () => {
      try {
        const res = await fetch("/api/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contacts: contactsTree, gateway: contactsGateway })
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.status === "ok" && data.cross_callsigns && typeof data.cross_callsigns === "object") {
            contactsCrossCallsigns = data.cross_callsigns;
            if (typeof window !== "undefined") window.contactsCrossCallsigns = contactsCrossCallsigns;
            if (myContactsModal && myContactsModal.classList.contains("active")) {
              renderContactsTree(contactsSearchInput ? contactsSearchInput.value.trim() : "");
            }
          }
        }
      } catch (err) {
        console.warn("Failed to save contacts to server:", err);
      }
    }, 400);
  }

export function flushPendingContactsSave() {
  if (saveContactsDebounce) {
    clearTimeout(saveContactsDebounce);
    saveContactsDebounce = null;
    fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: contactsTree, gateway: contactsGateway }),
      keepalive: true
    }).catch(e => console.warn("[CONTACTS] Failed to flush contacts on freeze:", e));
  }
}

export function updateContactsGatewaySummary() {
    if (!contactsGwSummary) return;
    ensureValidContactsGateway();
    const name = getHotspotDisplayName(contactsGateway.hotspot_id);
    const slot = contactsGateway.slot === 1 ? 1 : 2;
    contactsGwSummary.innerHTML = `${window.t ? window.t("contacts.default_channel", {}, "Канал по умолчанию: ") : "Канал по умолчанию: "}<span class="gw-channel-name">${escapeHtml(name)} (TS${slot})</span>`;
  }

export function populateContactsGwHotspots() {
    if (!contactsGwHotspotSelect) return;
    ensureValidContactsGateway();
    const activeHotspots = Array.isArray(window.currentHotspots)
      ? window.currentHotspots.filter(hs => !hs.hidden && (hs.network_type || "bm").toLowerCase() === "bm")
      : [];
    const currentVal = contactsGateway.hotspot_id || (activeHotspots[0] && activeHotspots[0].id) || "default";
    contactsGwHotspotSelect.innerHTML = "";
    const list = activeHotspots.length > 0
      ? activeHotspots
      : [{ id: "default", name: "Main 📻" }];

    list.forEach(hs => {
      const opt = document.createElement("option");
      opt.value = hs.id;
      opt.textContent = getHotspotDisplayName(hs.id);
      if (String(hs.id) === String(currentVal) || resolveHotspotId(hs.id) === resolveHotspotId(currentVal)) {
        opt.selected = true;
      }
      contactsGwHotspotSelect.appendChild(opt);
    });

    setContactsGwSlotUI(contactsGateway.slot === 1 ? 1 : 2);
  }

export function setContactsGwSlotUI(slot) {
    if (!contactsGwSlot1 || !contactsGwSlot2) return;
    if (slot === 1) {
      contactsGwSlot1.classList.add("active");
      contactsGwSlot2.classList.remove("active");
    } else {
      contactsGwSlot2.classList.add("active");
      contactsGwSlot1.classList.remove("active");
    }
  }

export function toggleContactsGatewayPanel(show = null) {
    if (!contactsGatewayPanel) return;
    const isBmContext = ((contactsActiveNetworkType || "bm").toLowerCase() === "bm");
    if (!isBmContext) {
      contactsGatewayPanel.style.display = "none";
      return;
    }
    const isVisible = contactsGatewayPanel.style.display !== "none";
    const nextState = show !== null ? show : !isVisible;
    if (nextState) {
      populateContactsGwHotspots();
      contactsGatewayPanel.style.display = "block";
    } else {
      contactsGatewayPanel.style.display = "none";
    }
  }

export function saveContactsGatewayFromUI() {
    if (!contactsGwHotspotSelect) return;
    const selectedHid = contactsGwHotspotSelect.value || "default";
    const selectedSlot = contactsGwSlot1 && contactsGwSlot1.classList.contains("active") ? 1 : 2;
    contactsGateway = {
      hotspot_id: selectedHid,
      slot: selectedSlot
    };
    updateContactsGatewaySummary();
    toggleContactsGatewayPanel(false);
    saveContactsToServer();
    showToast(window.t ? window.t("contacts.gw_saved_toast", { name: getHotspotDisplayName(selectedHid), slot: selectedSlot }, `🌐 Шлюз контактов сохранен: ${getHotspotDisplayName(selectedHid)} (TS${selectedSlot})`) : `🌐 Шлюз контактов сохранен: ${getHotspotDisplayName(selectedHid)} (TS${selectedSlot})`, 2500);
  }

let contactsActiveHotspotId = "default";
let contactsActiveNetworkType = "bm";
let contactsFilterByActiveNet = true;

function resolveHotspotNetworkType(hid) {
  const cid = resolveHotspotId(hid || (typeof window !== "undefined" && window.activeHotspotId) || "default");
  const allHs = (typeof window !== "undefined" && Array.isArray(window.currentHotspots)) ? window.currentHotspots : [];
  const hs = allHs.find(h => String(h.id) === String(cid) || resolveHotspotId(h.id) === cid);
  if (hs && hs.network_type) return String(hs.network_type).toLowerCase();
  if (typeof document !== "undefined") {
    const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) || document.querySelector(".radio-container.active");
    if (card) {
      if (card.classList.contains("card-net-allstar") || card.dataset.networkType === "allstar") return "allstar";
      if (card.dataset.networkType) return String(card.dataset.networkType).toLowerCase();
    }
  }
  return "bm";
}

export function getNetworkBadgeLabel(net) {
  const map = {
    bm: "BM (DMR)",
    tgif: "TGIF (DMR)",
    freedmr: "FreeDMR",
    adn: "ADN",
    dmrplus: "DMR+",
    xlx: "XLX",
    ysf: "YSF (C4FM)",
    allstar: "AllStarLink",
    custom: "Custom DMR"
  };
  return map[(net || "bm").toLowerCase()] || String(net || "BM").toUpperCase();
}

export function getNetworkShortBadge(net) {
  const map = {
    bm: "BM",
    tgif: "TGIF",
    freedmr: "FreeDMR",
    adn: "ADN",
    dmrplus: "DMR+",
    xlx: "XLX",
    ysf: "YSF",
    allstar: "ASL",
    custom: "DMR"
  };
  return map[(net || "bm").toLowerCase()] || String(net || "BM").toUpperCase();
}

export function getPersonIdentities(node) {
  if (!node || typeof node !== "object") return {};
  const ids = Object.assign({}, node.identities || {});
  if (node.dmr_id && !ids.dmr_id) ids.dmr_id = Number(node.dmr_id);
  if ((node.allstar_node || node.node_number) && !ids.allstar_node && node.type === "person") {
    ids.allstar_node = String(node.allstar_node || node.node_number).trim();
  }
  if (node.echolink_node && !ids.echolink_node) {
    ids.echolink_node = String(node.echolink_node).trim();
  }
  return ids;
}

export function resolveNodeNetworkType(node) {
  if (!node || typeof node !== "object") return "bm";
  const raw = String(node.network_type || "").trim().toLowerCase();
  if (raw) return raw;
  if (node.type === "allstar_node" || node.type === "asl_macro") return "allstar";
  return "bm";
}

export function nodeMatchesNetworkContext(node, netType) {
  if (!node) return false;
  const activeNet = (netType || contactsActiveNetworkType || "bm").toLowerCase();

  if (node.type === "folder") {
    const folderNet = resolveNodeNetworkType(node);
    return folderNet === activeNet;
  }

  // Strictly isolated phonebooks per hotspot network type (BM, ADN, FreeDMR, TGIF, DMR+, XLX, YSF, AllStar, Custom)
  return resolveNodeNetworkType(node) === activeNet;
}

function collectLocalCrossEntriesByCallsign(callsign, activeNet, excludeNodeId = null) {
  const cs = String(callsign || "").trim().toUpperCase();
  if (!cs) return [];
  const entries = [];
  function walk(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (!n) continue;
      if (n.type === "folder") {
        walk(n.children);
        continue;
      }
      if (excludeNodeId && n.id === excludeNodeId) continue;
      const nCs = String(n.callsign || "").trim().toUpperCase();
      if (nCs !== cs) continue;
      const nNet = resolveNodeNetworkType(n);
      if (nNet === activeNet) continue;
      const ids = n.type === "person" ? getPersonIdentities(n) : {};
      entries.push({
        node_id: n.id,
        network_type: nNet,
        type: n.type || "person",
        name: n.name || cs,
        dmr_id: ids.dmr_id || n.dmr_id || null,
        allstar_node: n.node_number || n.allstar_node || ids.allstar_node || "",
        echolink_node: n.echolink_node || ids.echolink_node || "",
        tg: n.tg || null,
        city: n.city || "",
        comment: n.comment || ""
      });
    }
  }
  walk(contactsTree);
  return entries;
}

export function buildCrossNetworkBadgesForNode(node, activeNet, forEditBox = false) {
  if (!node) return "";
  const cs = String(node.callsign || "").trim().toUpperCase();
  const curNet = String(activeNet || contactsActiveNetworkType || "bm").toLowerCase();
  const ids = node.type === "person" ? getPersonIdentities(node) : {};
  const srvCross = (cs && contactsCrossCallsigns && contactsCrossCallsigns[cs]) ? contactsCrossCallsigns[cs] : null;
  const localOtherEntries = cs ? collectLocalCrossEntriesByCallsign(cs, curNet, node.id) : [];

  return renderCrossNetworkBadgesHtml(cs, curNet, {
    nodeIds: ids,
    userEntries: localOtherEntries.length ? localOtherEntries : ((srvCross && Array.isArray(srvCross.user_networks)) ? srvCross.user_networks.filter(e => String(e.network_type || "").toLowerCase() !== curNet) : []),
    radioidDmr: (srvCross && Array.isArray(srvCross.radioid_dmr)) ? srvCross.radioid_dmr : [],
    allstarNodes: (srvCross && Array.isArray(srvCross.allstar_nodes)) ? srvCross.allstar_nodes : [],
    echolinkNodes: (srvCross && Array.isArray(srvCross.echolink_nodes)) ? srvCross.echolink_nodes : []
  }, forEditBox);
}

export function renderCrossNetworkBadgesHtml(callsign, activeNet, crossData, forEditBox = false) {
  const curNet = String(activeNet || "bm").toLowerCase();
  const badges = [];
  const seenKeys = new Set();
  const nodeIds = (crossData && crossData.nodeIds) || {};
  const userEntries = (crossData && Array.isArray(crossData.userEntries)) ? crossData.userEntries : [];
  const radioidDmr = (crossData && Array.isArray(crossData.radioidDmr)) ? crossData.radioidDmr : [];
  const allstarNodes = (crossData && Array.isArray(crossData.allstarNodes)) ? crossData.allstarNodes : [];
  const echolinkNodes = (crossData && Array.isArray(crossData.echolinkNodes)) ? crossData.echolinkNodes : [];

  // 1. Entries of the same callsign in user's OTHER hotspot phonebooks
  for (const ent of userEntries) {
    const net = String(ent.network_type || "bm").toLowerCase();
    if (!net || net === curNet) continue;
    const netShort = getNetworkShortBadge(net);
    const idTxt = ent.dmr_id ? `ID ${ent.dmr_id}` : (ent.allstar_node ? `#${ent.allstar_node}` : (ent.tg ? `TG ${ent.tg}` : ""));
    const uniqKey = `user:${net}:${idTxt || ent.node_id}`;
    if (seenKeys.has(uniqKey)) continue;
    seenKeys.add(uniqKey);

    const tipParts = [
      `${getNetworkBadgeLabel(net)}: ${ent.name || callsign}`,
      idTxt,
      ent.city || "",
      ent.comment || ""
    ].filter(Boolean);
    const clickableAttr = (!forEditBox && ent.node_id)
      ? `data-action="call-cross-net" data-target-node-id="${escapeHtml(String(ent.node_id))}" data-net="${escapeHtml(net)}"`
      : "";
    badges.push(
      `<span class="cross-net-pill contact-net-badge net-${escapeHtml(net)} ${clickableAttr ? "is-clickable" : ""}" ${clickableAttr} title="${escapeHtml(tipParts.join(" • "))}">${escapeHtml(netShort)}${idTxt ? `: ${escapeHtml(idTxt)}` : ""}</span>`
    );
  }

  // 2. RadioID global DMR DB IDs (helpful when viewing in AllStar/YSF or if user has multiple DMR IDs)
  for (const ridObj of radioidDmr) {
    const rid = ridObj.radio_id ? String(ridObj.radio_id) : "";
    if (!rid) continue;
    if (curNet !== "allstar" && curNet !== "ysf" && nodeIds.dmr_id && String(nodeIds.dmr_id) === rid && userEntries.length === 0) {
      // Only hide trivial duplicate of the sole DMR ID already displayed in DMR card when no other cross info
    }
    const loc = [ridObj.city, ridObj.country].filter(Boolean).join(", ");
    const tip = `RadioID DMR: ${rid} — ${ridObj.callsign || callsign}${ridObj.name ? ` (${ridObj.name})` : ""}${loc ? `, ${loc}` : ""}`;
    if (!seenKeys.has(`rid:${rid}`)) {
      seenKeys.add(`rid:${rid}`);
      if (curNet === "allstar" || curNet === "ysf" || (nodeIds.dmr_id && String(nodeIds.dmr_id) !== rid) || forEditBox) {
        badges.push(`<span class="cross-net-pill contact-net-badge net-radioid" title="${escapeHtml(tip)}">🆔 RadioID ${escapeHtml(rid)}</span>`);
      }
    }
  }

  // 3. Explicit AllStar node stored on card + AllStarLink directory nodes for this callsign
  const knownAslNodes = new Set();
  if (nodeIds.allstar_node && curNet !== "allstar") {
    const aslNum = String(nodeIds.allstar_node).trim();
    knownAslNodes.add(aslNum);
    badges.push(`<span class="cross-net-pill contact-net-badge net-allstar" title="AllStarLink #${escapeHtml(aslNum)}">📻 ASL #${escapeHtml(aslNum)}</span>`);
  }
  for (const asl of allstarNodes) {
    const nNum = String(asl.node || "").trim();
    if (!nNum || knownAslNodes.has(nNum)) continue;
    if (curNet === "allstar" && !forEditBox) continue;
    knownAslNodes.add(nNum);
    const tip = `AllStarLink #${nNum}: ${asl.name || asl.callsign || callsign}${asl.location ? ` (${asl.location})` : ""}`;
    badges.push(`<span class="cross-net-pill contact-net-badge net-allstar" title="${escapeHtml(tip)}">📻 ASL #${escapeHtml(nNum)}</span>`);
  }

  // 4. EchoLink nodes
  const allEcho = new Set(echolinkNodes);
  if (nodeIds.echolink_node) allEcho.add(String(nodeIds.echolink_node).trim());
  for (const el of allEcho) {
    if (!el) continue;
    badges.push(`<span class="cross-net-pill contact-net-badge net-echolink" title="EchoLink Node #${escapeHtml(el)}">🌐 EL #${escapeHtml(el)}</span>`);
  }

  if (!badges.length) return "";
  const labelTxt = window.t ? window.t("hs_edit.type_other_group", {}, "Другие сети") : "Другие сети";
  if (forEditBox) {
    return `<div class="contact-edit-cross-title">🌐 ${escapeHtml(labelTxt)} (${escapeHtml(callsign)}):</div><div class="contact-edit-cross-list">${badges.join("")}</div>`;
  }
  return `<div class="tree-contact-other-nets"><span class="tree-other-nets-label">🌐 ${escapeHtml(labelTxt)}:</span>${badges.join("")}</div>`;
}

function updateContactsNetFilterHeaderUI() {
  const netBadge = document.getElementById("contactsActiveNetBadge");
  const tabsWrap = document.getElementById("contactsModalTabsWrap");
  const gwToggle = document.getElementById("btnContactsGatewayToggle");
  const gwPanel = document.getElementById("contactsGatewayPanel");

  const activeNet = (contactsActiveNetworkType || "bm").toLowerCase();
  const netLabel = getNetworkBadgeLabel(activeNet);
  if (netBadge) {
    netBadge.textContent = netLabel;
    netBadge.className = `contact-net-badge net-${activeNet}`;
  }
  if (tabsWrap) {
    tabsWrap.style.display = (activeNet === "allstar" || activeNet === "ysf") ? "inline-flex" : "none";
  }

  // Group Gateway feature is strictly BrandMeister-only
  const isBm = (activeNet === "bm");
  if (gwToggle) gwToggle.style.display = isBm ? "" : "none";
  if (gwPanel && !isBm) gwPanel.style.display = "none";
}

export function openMyContactsModal(targetHid = null, defaultTab = null) {
    ensureElements();
    if (typeof window.closePrimaryModals === "function") {
      window.closePrimaryModals("myContactsModal");
    }
    if (contactsGatewayPanel) contactsGatewayPanel.style.display = "none";
    if (contactsSearchInput) contactsSearchInput.value = "";
    if (clearContactsSearchBtn) clearContactsSearchBtn.classList.add("hidden");

    const activeCid = targetHid || (typeof window !== "undefined" && window.activeHotspotId) || "default";
    contactsActiveHotspotId = resolveHotspotId(activeCid);
    contactsActiveNetworkType = resolveHotspotNetworkType(contactsActiveHotspotId);
    contactsFilterByActiveNet = true;

    updateContactsNetFilterHeaderUI();
    updateContactsGatewaySummary();
    renderContactsTree("");

    const isYsf = (contactsActiveNetworkType === "ysf");
    const isAsl = (contactsActiveNetworkType === "allstar");
    const btnTabYsf = document.getElementById("btnContactsTabYsf");
    const btnTabYsfContacts = document.getElementById("btnContactsTabYsfContacts");
    const btnTabAsl = document.getElementById("btnContactsTabAllstar");
    const btnTabDmrEl = document.getElementById("btnContactsTabDmr");
    if (btnTabYsf) btnTabYsf.style.display = isYsf ? "inline-flex" : "none";
    if (btnTabYsfContacts) btnTabYsfContacts.style.display = isYsf ? "inline-flex" : "none";
    if (btnTabDmrEl) btnTabDmrEl.style.display = "";
    if (btnTabAsl) btnTabAsl.style.display = isAsl ? "inline-flex" : "none";

    const shouldOpenAllStarDir = (defaultTab === "allstar_dir");
    const shouldOpenYsfDir = (isYsf && defaultTab === "ysf_dir");
    const shouldOpenYsfContacts = (isYsf && defaultTab === "ysf_bookmarks");
    if (shouldOpenAllStarDir) {
      switchContactsModalTab("allstar");
    } else if (shouldOpenYsfDir) {
      switchContactsModalTab("ysf");
    } else if (shouldOpenYsfContacts) {
      switchContactsModalTab("ysf_contacts");
    } else {
      switchContactsModalTab("dmr");
    }

    if (myContactsModal) {
      myContactsModal.style.display = "flex";
      myContactsModal.classList.add("active");
      pushNavState("modal", "myContactsModal");
      setTimeout(() => {
        if (shouldOpenAllStarDir) {
          const inp = document.getElementById("aslNodeSearchInput");
          if (inp) inp.focus();
        } else if (shouldOpenYsfDir || shouldOpenYsfContacts) {
          const inp = document.getElementById("ysfRoomSearchInput");
          if (inp) inp.focus();
        } else {
          if (contactsSearchInput) contactsSearchInput.focus();
        }
      }, 60);
    }
  }

// ==========================================================================
// AllStarLink Dedicated Nodes Directory
// ==========================================================================

export const DEFAULT_ASL_DIRECTORY = [
  { node: "1999",  name: "Local Echo Test", hub: "Echo test (audio and mic check)", hub_key: "contacts.asl_dir_echo_hub", country: "LOCAL", flag: "🔄", mode: "*3" },
  { node: "41522", name: "HUBNet UK", hub: "United Kingdom National Hub", country: "GB", flag: "🇬🇧", mode: "*3" },
  { node: "27339", name: "East Coast Reflector", hub: "US East Coast ASL Hub", country: "US", flag: "🇺🇸", mode: "*3" },
  { node: "2143",  name: "WAN RS System", hub: "Western PA & Ohio Hub", country: "US", flag: "🇺🇸", mode: "*3" },
  { node: "9999",  name: "AllStar Parrot", hub: "Global Parrot Repeater", country: "GLOBAL", flag: "🦜", mode: "*3" },
  { node: "51010", name: "World Conference", hub: "Worldwide ASL Conference", country: "GLOBAL", flag: "🌐", mode: "*3" },
  { node: "2502",  name: "ASL Russia", hub: "Russian AllStarLink Node", hub_key: "contacts.asl_dir_russia_hub", country: "RU", flag: "🇷🇺", mode: "*3" },
  { node: "52495", name: "DL-Nordwest", hub: "German ASL Network", country: "DE", flag: "🇩🇪", mode: "*3" },
  { node: "2000",  name: "Western Reflector", hub: "US Western System", country: "US", flag: "🇺🇸", mode: "*3" },
  { node: "43393", name: "Australia ASL Hub", hub: "VK National Repeater Hub", country: "AU", flag: "🇦🇺", mode: "*3" }
];

export function getAllStarNodesDirectory() {
  try {
    const saved = localStorage.getItem("proxdmr_allstar_directory");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return DEFAULT_ASL_DIRECTORY;
}

export function saveAllStarNodesDirectory(nodes) {
  try {
    localStorage.setItem("proxdmr_allstar_directory", JSON.stringify(nodes));
  } catch (e) {}
}

if (typeof window !== "undefined") {
  window.getAllStarNodesDirectory = getAllStarNodesDirectory;
  window.saveAllStarNodesDirectory = saveAllStarNodesDirectory;
}

// ==========================================================================
// Yaesu System Fusion (YSF / C4FM) Dedicated Rooms Directory & Bookmarks
// ==========================================================================

function _isoToEmoji(cCode) {
  if (typeof isoToEmoji === "function") return isoToEmoji(cCode);
  if (typeof window !== "undefined" && typeof window.isoToEmoji === "function") {
    return window.isoToEmoji(cCode);
  }
  if (!cCode || cCode.length !== 2) return "🌐";
  const codePoints = [...cCode.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

const _YSF_STD_MULTIROOM_RE = /(?:^|[^A-Z0-9])(YCS|FCS)(?:[0-9]{0,4}|[^A-Z0-9]|$)/i;
const _YSF_MUTANT_MULTIROOM_RE = /(?:^|[^A-Z0-9])(PYSF3|PYSFREFLECTOR3|YSFREFLECTOR3|MULTI[-_\s]?STREAM|DG[-_]?ID(?:_ENABLE|S|\d{1,2})?)(?:[^A-Z0-9]|$)/i;
const _YSF_MUTANT_KINDS = new Set(["PYSF3", "PYSFREFLECTOR3", "YSFREFLECTOR3", "MULTISTREAM", "DGID", "LIVE_DGID", "MANUAL"]);
const _ysfRuntimeMutants = (typeof window !== "undefined")
  ? (window.__proxdmrYsfRuntimeMutants = window.__proxdmrYsfRuntimeMutants || {})
  : {};

function _normalizeYsfMutantKindToken(raw) {
  const up = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!up) return "";
  if (up.includes("PYSF") || up.includes("YSFREFLECTOR3")) return "PYSF3";
  if (up.includes("MULTISTREAM")) return "MULTISTREAM";
  if (up.startsWith("DGID")) return "DGID";
  return up.slice(0, 16);
}

export function getYsfRoomTypeOverride(roomId) {
  const sId = String(roomId || "").trim();
  if (!sId) return "";
  const val = String(getServerCollectionValue("ysf_room_types", sId) || "").trim().toLowerCase();
  return (val === "single" || val === "multi_standard" || val === "multi_mutant") ? val : "";
}

export function markYsfRoomRuntimeMutant(roomId, kind = "LIVE_DGID") {
  const sId = String(roomId || "").trim();
  if (!sId) return;
  _ysfRuntimeMutants[sId] = String(kind || "LIVE_DGID").trim().toUpperCase() || "LIVE_DGID";
}

export function setYsfRoomTypeOverride(roomId, mode) {
  const sId = String(roomId || "").trim();
  if (!sId) return;
  const clean = String(mode || "").trim().toLowerCase();
  if (clean === "single" || clean === "multi_standard" || clean === "multi_mutant") {
    setServerCollectionKey("ysf_room_types", sId, clean, null, false);
  } else {
    deleteServerCollectionKey("ysf_room_types", sId, null);
  }
  if (typeof window !== "undefined") {
    const viewYsf = document.getElementById("ysfRoomsView");
    if (viewYsf && viewYsf.style.display !== "none") {
      renderYsfRoomsList(document.getElementById("ysfRoomSearchInput")?.value || "");
    }
    const curHsList = window.currentHotspots || [];
    document.querySelectorAll('.radio-container.card-net-ysf, .radio-container[data-network-type="ysf"]').forEach(cardEl => {
      const cid = cardEl.dataset.hotspotId;
      const hsObj = curHsList.find(h => h && h.id === cid);
      if (hsObj) {
        if (typeof window.updateCardYsfPanel === "function") window.updateCardYsfPanel(cardEl, hsObj);
        if (typeof window.syncCardYsfDgIdBar === "function") window.syncCardYsfDgIdBar(cardEl, hsObj);
      }
    });
  }
}

export function classifyYsfReflector(r, fallbackRoomId = "") {
  const isStr = typeof r === "string";
  const rObj = (!isStr && r && typeof r === "object") ? r : null;
  const sId = String(fallbackRoomId || (rObj && (rObj.id || rObj.room)) || "").trim();
  const explicitOverride = rObj ? String(rObj.room_type_override || rObj.type_override || "").trim().toLowerCase() : "";
  const storedOverride = getYsfRoomTypeOverride(sId);
  const effectiveOverride = (explicitOverride === "single" || explicitOverride === "multi_standard" || explicitOverride === "multi_mutant")
    ? explicitOverride
    : storedOverride;

  const fields = isStr
    ? [String(r)]
    : (rObj ? [rObj.name, rObj.reflector_name, rObj.label, rObj.description, rObj.host] : []);

  let stdKind = "";
  let mutKind = "";
  for (const val of fields) {
    if (!val) continue;
    const up = String(val).toUpperCase();
    if (!stdKind) {
      const mStd = up.match(_YSF_STD_MULTIROOM_RE);
      if (mStd) stdKind = mStd[1].toUpperCase();
    }
    if (!mutKind) {
      const mMut = up.match(_YSF_MUTANT_MULTIROOM_RE);
      if (mMut) mutKind = _normalizeYsfMutantKindToken(mMut[1]);
    }
  }

  const existingKind = rObj ? String(rObj.multiroom_kind || "").trim().toUpperCase() : "";
  if (!stdKind && (existingKind === "YCS" || existingKind === "FCS")) stdKind = existingKind;
  if (!mutKind && _YSF_MUTANT_KINDS.has(existingKind)) mutKind = existingKind;

  if (effectiveOverride === "single") {
    return { reflectorType: "single", isMultiroom: false, kind: "", override: "single" };
  }
  if (effectiveOverride === "multi_standard") {
    return { reflectorType: "multi_standard", isMultiroom: true, kind: stdKind || "YCS", override: "multi_standard" };
  }
  if (effectiveOverride === "multi_mutant") {
    return { reflectorType: "multi_mutant", isMultiroom: true, kind: mutKind || "MANUAL", override: "multi_mutant" };
  }
  if (stdKind) {
    return { reflectorType: "multi_standard", isMultiroom: true, kind: stdKind, override: "" };
  }
  if (mutKind) {
    return { reflectorType: "multi_mutant", isMultiroom: true, kind: mutKind, override: "" };
  }
  if (sId && _ysfRuntimeMutants[sId]) {
    return { reflectorType: "multi_mutant", isMultiroom: true, kind: _ysfRuntimeMutants[sId], override: "" };
  }
  if (rObj && rObj.reflector_type === "multi_mutant") {
    return { reflectorType: "multi_mutant", isMultiroom: true, kind: existingKind || "LIVE_DGID", override: "" };
  }
  return { reflectorType: "single", isMultiroom: false, kind: "", override: "" };
}

function _enrichYsfRoomRecord(r) {
  if (!r || typeof r !== "object") return r;
  const sId = String(r.id || "").trim();
  const catalog = _getYsfServersList();
  const catHit = sId
    ? catalog.find(item => String(item.id || "").trim() === sId || (sId.length < 5 && String(item.id || "").trim() === sId.padStart(5, "0")))
    : null;
  const merged = catHit
    ? {
        ...catHit,
        ...r,
        name: r.name || catHit.name,
        reflector_name: r.reflector_name || catHit.reflector_name || catHit.name || "",
        description: r.description || catHit.description || "",
        host: r.host || catHit.host || "",
        port: r.port || catHit.port || 42000,
        country_code: (r.country_code && r.country_code !== "XX") ? r.country_code : (catHit.country_code || r.country_code || "XX"),
      }
    : { ...r };
  const cls = classifyYsfReflector(merged, sId);
  merged.reflector_type = cls.reflectorType;
  merged.is_multiroom = cls.isMultiroom;
  merged.multiroom_kind = cls.kind;
  merged.room_type_override = cls.override;
  return merged;
}

export function getYsfMultiroomKind(r) {
  if (!r) return "";
  return classifyYsfReflector(r).kind || "";
}

export function isYsfMultiroomRoom(r) {
  if (!r) return false;
  return Boolean(classifyYsfReflector(r).isMultiroom);
}

function _getContactsCurrentLang() {
  if (typeof window !== "undefined") {
    return (window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang))
      || (window.i18n && (window.i18n.currentLanguage || window.i18n.currentLang))
      || "en";
  }
  return "en";
}

export function resolveYsfRoomInfo(r) {
  const intlName = (typeof window !== "undefined" && window.t) ? window.t("countries.GLOBAL", {}, "International") : "International";
  if (!r) return { cCode: "XX", refName: "YSF", flag: "🌐", countryName: intlName };
  const rawName = String(r.name || "").trim();
  let cCode = String(r.country_code || r.country || "").toUpperCase();
  let refName = String(r.reflector_name || "").trim();

  if (!cCode || cCode === "GLOBAL" || cCode === "XX" || !refName || refName === rawName) {
    const match = rawName.match(/^([A-Za-z]{2})[-_ ]\s*(.*)$/);
    if (match) {
      if (!cCode || cCode === "GLOBAL" || cCode === "XX") {
        cCode = match[1].toUpperCase();
      }
      if (!refName || refName === rawName) {
        refName = match[2].trim();
      }
    }
  }

  if (!cCode) cCode = "XX";
  if (!refName) refName = rawName || `YSF #${r.id || ""}`;

  const isGlobalOrXx = (cCode === "XX" || cCode === "GLOBAL");
  const isEu = (cCode === "EU");
  let flag = "🌐";
  if (isEu) {
    flag = "🇪🇺";
  } else if (!isGlobalOrXx) {
    flag = _isoToEmoji(cCode);
  }

  const curLang = _getContactsCurrentLang();
  let countryName = isGlobalOrXx
    ? intlName
    : (typeof getLocalizedCountryName === "function"
        ? getLocalizedCountryName(cCode, cCode, curLang)
        : cCode);

  return { cCode, refName, flag, countryName };
}

let _ysfViewMode = "catalog"; // "catalog" (все комнаты) | "contacts" (только добавленные пользователем)
let _ysfSortType = "id"; // "id" | "country" | "name"
let _ysfSortDir = "asc"; // "asc" | "desc"
let _ysfTypeFilter = "all"; // "all" | "single" | "multi_standard" | "multi_mutant"
let _ysfFilteredRooms = [];

function _updateYsfTypeFilterUi() {
  document.querySelectorAll(".btn-ysf-type-filter").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.typeFilter === _ysfTypeFilter);
  });
}

function _sortYsfRooms(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const sortLang = _getContactsCurrentLang();
  return [...list].sort((a, b) => {
    const infoA = resolveYsfRoomInfo(a);
    const infoB = resolveYsfRoomInfo(b);
    let cmp = 0;
    if (_ysfSortType === "country") {
      const cA = (infoA.countryName || infoA.cCode || "").toLowerCase();
      const cB = (infoB.countryName || infoB.cCode || "").toLowerCase();
      cmp = cA.localeCompare(cB, sortLang, { sensitivity: "base" });
      if (cmp === 0) {
        cmp = (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);
      }
    } else if (_ysfSortType === "name") {
      const nA = (infoA.refName || a.name || "").toLowerCase();
      const nB = (infoB.refName || b.name || "").toLowerCase();
      cmp = nA.localeCompare(nB, sortLang, { sensitivity: "base" });
      if (cmp === 0) {
        cmp = (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);
      }
    } else {
      // Default: numeric sort by room id
      const idA = parseInt(a.id, 10) || 0;
      const idB = parseInt(b.id, 10) || 0;
      cmp = idA - idB;
    }
    return _ysfSortDir === "desc" ? -cmp : cmp;
  });
}

function _updateYsfSortUi() {
  const ysfSortBtns = document.querySelectorAll(".btn-ysf-sort");
  ysfSortBtns.forEach(btn => {
    const isCur = (btn.dataset.sort === _ysfSortType);
    btn.classList.toggle("active", isCur);
    const arrow = btn.querySelector(".sort-arrow");
    if (arrow) {
      arrow.textContent = isCur ? (_ysfSortDir === "asc" ? "▲" : "▼") : "";
    }
  });
}

function _renderYsfRoomCardHtml(r) {
  const enriched = _enrichYsfRoomRecord(r);
  const sId = String(enriched.id || "").trim();
  const info = resolveYsfRoomInfo(enriched);
  const host = enriched.host || "";
  const isFav = isYsfRoomBookmarked(sId);
  const cls = classifyYsfReflector(enriched, sId);
  const rType = cls.reflectorType;
  const isMr = cls.isMultiroom;
  const mrKind = cls.kind || (rType === "multi_mutant" ? "PYSF3" : "YCS");

  let cardTypeCls = "is-ysf-single";
  let mrBadgeHtml = "";
  if (rType === "multi_standard") {
    cardTypeCls = "is-ysf-multiroom is-ysf-multi-standard";
    const stdLbl = window.t ? window.t("ysf.type_badge_standard", { kind: mrKind }, `${mrKind} · DG-ID 01–99`) : `${mrKind} · DG-ID 01–99`;
    const stdTip = window.t
      ? window.t("ysf.type_tip_standard", { kind: mrKind }, `Standard multi-room hub (${mrKind}): DG-ID channels 01–99. Online counter shows all hub participants.`)
      : `Standard multi-room hub (${mrKind}): DG-ID channels 01–99. Online counter shows all hub participants.`;
    mrBadgeHtml = `<span class="ysf-multiroom-badge ysf-type-badge--standard" title="${escapeHtml(stdTip)}"><span class="ysf-inline-type-dot ysf-inline-type-dot--standard" aria-hidden="true"></span>${escapeHtml(stdLbl)}</span>`;
  } else if (rType === "multi_mutant") {
    cardTypeCls = "is-ysf-multiroom is-ysf-multi-mutant";
    const mutLbl = window.t ? window.t("ysf.type_badge_mutant", { kind: mrKind }, `${mrKind} · Мутант`) : `${mrKind} · Мутант`;
    const mutTip = window.t
      ? window.t("ysf.type_tip_mutant", { kind: mrKind }, `Нестандартный многокомнатный рефлектор («мутант» ${mrKind}): поддержка DG-ID 01–99 без тега YCS/FCS.`)
      : `Нестандартный многокомнатный рефлектор («мутант» ${mrKind}): поддержка DG-ID 01–99 без тега YCS/FCS.`;
    mrBadgeHtml = `<span class="ysf-multiroom-badge ysf-type-badge--mutant" title="${escapeHtml(mutTip)}"><span class="ysf-inline-type-dot ysf-inline-type-dot--mutant" aria-hidden="true"></span>${escapeHtml(mutLbl)}</span>`;
  } else {
    const sngLbl = window.t ? window.t("ysf.type_badge_single", {}, "1 комн.") : "1 комн.";
    const sngTip = window.t
      ? window.t("ysf.type_tip_single", {}, "Однокомнатный классический YSF-рефлектор (DG-ID 00)")
      : "Однокомнатный классический YSF-рефлектор (DG-ID 00)";
    mrBadgeHtml = `<span class="ysf-type-badge ysf-type-badge--single" title="${escapeHtml(sngTip)}">${escapeHtml(sngLbl)}</span>`;
  }

  const cachedProbe = (window._ysfGlobalRoomProbeCache && (window._ysfGlobalRoomProbeCache[sId] || (sId.startsWith("0") ? window._ysfGlobalRoomProbeCache[String(parseInt(sId, 10))] : null))) || null;
  let dirConnsHtml = "";
  if (cachedProbe) {
    const linksNum = cachedProbe.connections !== undefined ? cachedProbe.connections : 0;
    const isKeyed = Boolean(cachedProbe.keyed);
    const connsClass = isKeyed ? "asl-conns-hot" : (linksNum >= 10 ? "asl-conns-hot" : (linksNum > 0 ? "asl-conns-active" : "asl-conns-zero"));
    const connsText = isKeyed ? `• ${linksNum}` : String(linksNum);
    const connsTitle = isKeyed
      ? (window.t ? window.t("asl.conns_live_now", {}, "On air right now 🔥") : "On air right now 🔥")
      : (isMr
          ? (window.t ? window.t("contacts.ysf_hub_conns_title", { kind: mrKind, count: linksNum }, `Total connections across ${mrKind} hub (all DG-IDs): ${linksNum}`) : `Total connections across ${mrKind} hub (all DG-IDs): ${linksNum}`)
          : (window.t ? window.t("contacts.ysf_conns_title", { count: linksNum }, `Connections: ${linksNum}`) : `Connections: ${linksNum}`));
    dirConnsHtml = `<span class="asl-btn-conns ${connsClass}" style="margin-left:6px;" title="${escapeHtml(connsTitle)}">${connsText}</span>`;
  }
  const ovrVal = cls.override || "auto";
  const optAutoLbl = window.t ? window.t("ysf.type_opt_auto_short", {}, "Auto") : "Auto";
  const optSngLbl = window.t ? window.t("ysf.type_opt_single_short", {}, "1-room") : "1-room";
  const optStdLbl = window.t ? window.t("ysf.type_opt_standard_short", {}, "YCS/FCS") : "YCS/FCS";
  const optMutLbl = window.t ? window.t("ysf.type_opt_mutant_short", {}, "Mutant") : "Mutant";
  const ovrTitle = window.t ? window.t("ysf.type_override_title", {}, "Manual reflector type override for this room") : "Manual reflector type override for this room";
  const favTitle = isFav
    ? (window.t ? window.t("contacts.ysf_fav_remove_title", {}, "Remove from Favorites") : "Remove from Favorites")
    : (window.t ? window.t("contacts.ysf_fav_add_title", {}, "Add to Favorites") : "Add to Favorites");
  const favText = isFav
    ? (window.t ? window.t("contacts.ysf_in_favorites", {}, "In Favorites") : "In Favorites")
    : (window.t ? window.t("contacts.ysf_to_favorites", {}, "Add to Favorites") : "Add to Favorites");
  const connTitle = window.t ? window.t("contacts.ysf_connect_room_title", {}, "Connect to this room") : "Connect to this room";
  const connText = window.t ? window.t("contacts.ysf_connect_btn", {}, "Connect") : "Connect";
  return `
    <div class="ysf-room-card ${cardTypeCls}" data-room-id="${sId}" data-reflector-type="${rType}" data-room-host="${escapeHtml(host)}">
      <div class="ysf-room-left">
        <span class="ysf-room-flag" title="${escapeHtml(info.countryName)}">${info.flag}</span>
        <div class="ysf-room-details">
          <div class="ysf-room-title-line">
            <span class="ysf-room-id-tag">#${sId}</span>
            <span class="ysf-room-name">${escapeHtml(info.refName)}</span>
            ${mrBadgeHtml}
            ${dirConnsHtml}
          </div>
          <div class="ysf-room-sub-line">
            <span class="ysf-room-country">${info.flag} ${escapeHtml(info.cCode)} · ${escapeHtml(info.countryName)}</span>
            ${host ? ` · <span class="ysf-room-host">${escapeHtml(host)}</span>` : ""}
            <select class="ysf-card-type-select" data-room-id="${sId}" title="${escapeHtml(ovrTitle)}">
              <option value="auto"${ovrVal === "auto" ? " selected" : ""}>⚙ ${escapeHtml(optAutoLbl)}</option>
              <option value="single"${ovrVal === "single" ? " selected" : ""}>${escapeHtml(optSngLbl)}</option>
              <option value="multi_standard"${ovrVal === "multi_standard" ? " selected" : ""}>🟠 ${escapeHtml(optStdLbl)}</option>
              <option value="multi_mutant"${ovrVal === "multi_mutant" ? " selected" : ""}>🔴 ${escapeHtml(optMutLbl)}</option>
            </select>
          </div>
        </div>
      </div>
      <div class="ysf-room-actions">
        <button type="button" class="btn-ysf-action btn-ysf-fav ${isFav ? 'is-fav' : ''}" title="${escapeHtml(favTitle)}" data-room-id="${sId}"><span class="btn-ysf-fav-icon">${isFav ? '⭐' : '☆&#xFE0E;'}</span><span class="btn-ysf-action-text"> ${escapeHtml(favText)}</span></button>
        <button type="button" class="btn-ysf-action btn-ysf-connect" title="${escapeHtml(connTitle)}" data-room-id="${sId}"><span class="btn-ysf-conn-icon">🔗</span><span class="btn-ysf-action-text"> ${escapeHtml(connText)}</span></button>
      </div>
    </div>
  `;
}

function _renderAllYsfRooms(container) {
  if (!container || !_ysfFilteredRooms.length) return;
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = _ysfFilteredRooms.map(r => _renderYsfRoomCardHtml(r)).join("");
  const fragment = document.createDocumentFragment();
  while (tempDiv.firstChild) {
    fragment.appendChild(tempDiv.firstChild);
  }
  container.innerHTML = "";
  container.appendChild(fragment);
}

function _findYsfRoomByAnySource(roomId) {
  const sId = String(roomId || "").trim();
  const hit = _getYsfServersList().find(r => String(r.id || "").trim() === sId)
    || getYsfBookmarks().find(r => String(r.id || "").trim() === sId)
    || DEFAULT_YSF_BOOKMARKS.find(r => String(r.id || "").trim() === sId);
  return hit ? _enrichYsfRoomRecord(hit) : null;
}

function _ensureYsfContainerListener(container) {
  if (!container || container._clickWired) return;
  container._clickWired = true;
  container.addEventListener("change", (e) => {
    const sel = e.target.closest(".ysf-card-type-select");
    if (!sel) return;
    e.stopPropagation();
    const sId = sel.dataset.roomId;
    setYsfRoomTypeOverride(sId, sel.value);
  });
  container.addEventListener("click", (e) => {
    if (e.target.closest(".ysf-card-type-select")) {
      e.stopPropagation();
      return;
    }
    const favBtn = e.target.closest(".btn-ysf-fav");
    if (favBtn) {
      const sId = favBtn.dataset.roomId;
      const room = _findYsfRoomByAnySource(sId);
      if (room) toggleYsfRoomBookmark(room);
      return;
    }
    const connBtn = e.target.closest(".btn-ysf-connect");
    if (connBtn) {
      const sId = connBtn.dataset.roomId;
      const room = _findYsfRoomByAnySource(sId);
      if (room) {
        connectYsfRoomById(room.id, room.reflector_name || room.name, null, room.host || "", Number(room.port || 42000));
        const myContactsModal = document.getElementById("myContactsModal");
        if (myContactsModal) {
          myContactsModal.style.display = "none";
          myContactsModal.classList.remove("active");
        }
      }
      return;
    }
  });
}

function _getYsfServersList() {
  if (typeof window !== "undefined") {
    if (typeof window.getNetworkServersList === "function") {
      const list = window.getNetworkServersList("ysf");
      if (Array.isArray(list) && list.length > 0) return list;
    }
    if (window._dmrServersCache && Array.isArray(window._dmrServersCache["ysf"])) {
      return window._dmrServersCache["ysf"];
    }
  }
  return [];
}

export const DEFAULT_YSF_BOOKMARKS = [
  { id: "25000", name: "YSF-Russia", reflector_name: "Russia", country_code: "RU", host: "ysf.brandmeister.ru" },
  { id: "00007", name: "EUROPELINK", reflector_name: "EUROPELINK", country_code: "EU", host: "161.97.73.43" },
  { id: "32592", name: "America-Link", reflector_name: "America-Link", country_code: "US", host: "americalink.duckdns.org" },
  { id: "00032", name: "XLX032", reflector_name: "XLX032", country_code: "LU", host: "158.64.26.140" },
  { id: "00020", name: "NLCENTRAL", reflector_name: "NLCENTRAL", country_code: "NL", host: "90.145.156.242" },
  { id: "00040", name: "DL-Nordwest", reflector_name: "DL-Nordwest", country_code: "DE", host: "45.88.109.116" }
];

// Избранное YSF (= «Контакты YSF») хранится на СЕРВЕРЕ. Здесь — только последний ответ сервера
// (/api/ysf/favorites) для отрисовки текущей страницы. В localStorage НИЧЕГО не пишется.
let _ysfFavoritesCache = [];

export function getYsfBookmarks() {
  return Array.isArray(_ysfFavoritesCache) ? _ysfFavoritesCache.map(item => _enrichYsfRoomRecord(item)) : [];
}

function _applyYsfFavButtonState(favBtn, isFav) {
  if (!favBtn) return;
  favBtn.classList.toggle("is-fav", isFav);
  favBtn.title = isFav
    ? (window.t ? window.t("contacts.ysf_fav_remove_title", {}, "Remove from Favorites") : "Remove from Favorites")
    : (window.t ? window.t("contacts.ysf_fav_add_title", {}, "Add to Favorites") : "Add to Favorites");
  const iconSpan = favBtn.querySelector(".btn-ysf-fav-icon");
  if (iconSpan) iconSpan.innerHTML = isFav ? "⭐" : "☆&#xFE0E;";
  const textSpan = favBtn.querySelector(".btn-ysf-action-text");
  if (textSpan) {
    textSpan.textContent = " " + (isFav
      ? (window.t ? window.t("contacts.ysf_in_favorites", {}, "In Favorites") : "In Favorites")
      : (window.t ? window.t("contacts.ysf_to_favorites", {}, "Add to Favorites") : "Add to Favorites"));
  }
}

function _refreshYsfFavoritesUi() {
  if (typeof window !== "undefined" && typeof window.refreshAllCardsBmBanner === "function") {
    window.refreshAllCardsBmBanner();
  }
  if (typeof document !== "undefined") {
    const viewYsf = document.getElementById("ysfRoomsView");
    if (viewYsf && viewYsf.style.display !== "none") {
      if (_ysfViewMode === "contacts") {
        renderYsfRoomsList(document.getElementById("ysfRoomSearchInput")?.value || "");
      } else {
        // Каталог: обновляем звёзды на месте, не сбрасывая позицию прокрутки.
        const favIds = new Set(_ysfFavoritesCache.map(r => String(r.id).trim()));
        document.querySelectorAll(".ysf-room-card").forEach(card => {
          const isFavNow = favIds.has(String(card.dataset.roomId || "").trim());
          _applyYsfFavButtonState(card.querySelector(".btn-ysf-fav"), isFavNow);
        });
      }
    }
  }
}

export function applyYsfFavoritesFromServer(list) {
  _ysfFavoritesCache = Array.isArray(list) ? list : [];
  _refreshYsfFavoritesUi();
}

export async function loadYsfFavoritesFromServer() {
  try {
    const res = await fetch("/api/ysf/favorites");
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === "ok") {
        applyYsfFavoritesFromServer(data.favorites);
      }
    }
  } catch (err) {
    console.warn("[YSF] Failed to load favorites from server:", err);
  }
}

export function saveYsfBookmarks(list) {
  // Оптимистичное обновление интерфейса, затем сервер — единственный источник истины.
  _ysfFavoritesCache = Array.isArray(list) ? list.slice() : [];
  if (typeof window !== "undefined" && typeof window.refreshAllCardsBmBanner === "function") {
    window.refreshAllCardsBmBanner();
  }
  fetch("/api/ysf/favorites", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorites: _ysfFavoritesCache })
  }).then(res => res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status)))
    .then(data => {
      if (data && data.status === "ok") applyYsfFavoritesFromServer(data.favorites);
    })
    .catch(err => {
      console.warn("[YSF] Failed to save favorites to server:", err);
      if (typeof showToast === "function") {
        showToast(window.t ? window.t("contacts.ysf_save_err_toast", {}, "Failed to save YSF Contacts on server") : "Failed to save YSF Contacts on server", "error", 3500);
      }
      loadYsfFavoritesFromServer();
    });
}

export function isYsfRoomBookmarked(roomId) {
  const sid = String(roomId || "").trim();
  return getYsfBookmarks().some(r => String(r.id).trim() === sid);
}

export function toggleYsfRoomBookmark(roomObj) {
  if (!roomObj || !roomObj.id) return;
  const list = getYsfBookmarks();
  const sid = String(roomObj.id).trim();
  const idx = list.findIndex(r => String(r.id).trim() === sid);
  let nowAdded = false;
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    const cls = classifyYsfReflector(roomObj, sid);
    list.push({
      id: sid,
      name: roomObj.name || `YSF #${sid}`,
      reflector_name: roomObj.reflector_name || roomObj.name || "",
      description: roomObj.description || "",
      country_code: roomObj.country_code || roomObj.country || "XX",
      host: roomObj.host || "",
      port: Number(roomObj.port || 42000) || 42000,
      reflector_type: cls.reflectorType,
      is_multiroom: cls.isMultiroom,
      multiroom_kind: cls.kind,
    });
    nowAdded = true;
  }
  saveYsfBookmarks(list);
  const msg = nowAdded
    ? (window.t ? window.t("contacts.ysf_fav_added_toast", { name: roomObj.name }, `★ Комната «${roomObj.name}» добавлена в Избранное`) : `★ Комната «${roomObj.name}» добавлена в Избранное`)
    : (window.t ? window.t("contacts.ysf_fav_removed_toast", { name: roomObj.name }, `Комната «${roomObj.name}» удалена из Избранного`) : `Комната «${roomObj.name}» удалена из Избранного`);
  if (typeof showToast === "function") showToast(msg, "info", 2500);

  const matchedCards = (_ysfViewMode === "contacts") ? [] : document.querySelectorAll(`.ysf-room-card[data-room-id="${sid}"]`);
  if (matchedCards.length > 0) {
    matchedCards.forEach(card => {
      _applyYsfFavButtonState(card.querySelector(".btn-ysf-fav"), nowAdded);
    });
  } else {
    renderYsfRoomsList(document.getElementById("ysfRoomSearchInput")?.value || "");
  }
}

export async function connectYsfRoomById(roomId, roomName = "", card = null, roomHost = "", roomPort = 42000, opts = {}) {
  if (typeof window.ysfConnectRoomProcedure === "function") {
    return await window.ysfConnectRoomProcedure(roomId, roomName, card, roomHost, roomPort, opts);
  }
  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : (window.currentHotspots || (window.__proxdmr && window.__proxdmr.currentHotspots))) || [];
  const cid = card ? (card.dataset.hotspotId || "default") : (window.activeHotspotId || "default");
  const targetHs = curHsList.find(h => h && h.id === cid) || curHsList[0];
  if (!targetHs) return { ok: false, reason: "no_hotspot" };

  targetHs.isManualBmDisconnect = false;
  if (typeof window !== "undefined" && (cid === window.activeHotspotId || targetHs.id === window.activeHotspotId)) {
    window.isManualBmDisconnect = false;
  }

  const ysfList = _getYsfServersList();
  const sRoomId = String(roomId).trim();
  const foundInList = (ysfList || []).find(r => String(r.id).trim() === sRoomId);
  let effectiveHost = roomHost || (foundInList && foundInList.host) || "";
  if (effectiveHost && (/^\d+$/.test(effectiveHost.trim()) || effectiveHost.trim() === "ysf.brandmeister.ru")) {
    effectiveHost = "";
  }
  const effectiveName = roomName || (foundInList && (foundInList.reflector_name || foundInList.name)) || `YSF #${sRoomId}`;
  const effectivePort = roomPort || (foundInList && foundInList.port) || 42000;

  targetHs.ysf_room = sRoomId;
  targetHs.ysf_room_id = sRoomId;
  targetHs.ysf_name = effectiveName;
  targetHs.ysf_room_name = effectiveName;
  if (effectiveHost) {
    targetHs.bm_master_host = effectiveHost;
    targetHs.ysf_host = effectiveHost;
  }
  targetHs.ysf_port = Number(effectivePort) || 42000;

  const effectiveCard = card || document.querySelector(`.radio-container[data-hotspot-id="${targetHs.id}"]`) || document.getElementById("radioContainer");
  if (effectiveCard && typeof window.updateCardYsfPanel === "function") {
    window.updateCardYsfPanel(effectiveCard, targetHs);
  }

  try {
    const resp = await fetch(`/api/hotspots/${encodeURIComponent(targetHs.id)}?reconnect=1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...targetHs,
        bm_master_host: effectiveHost || "",
        ysf_host: effectiveHost || "",
        ysf_port: Number(effectivePort) || 42000,
        ysf_room: sRoomId,
        ysf_room_id: sRoomId,
        ysf_name: effectiveName,
        ysf_room_name: effectiveName
      })
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    let putData = null;
    try { putData = await resp.json(); } catch (_) {}
    if (putData && putData.hotspot) {
      Object.assign(targetHs, putData.hotspot);
    }
    const hsStatus = String(putData?.hotspot?.status || "").toUpperCase();
    if (hsStatus === "DISCONNECTED" || hsStatus === "OFFLINE" || hsStatus === "ERROR") {
      throw new Error(`Hotspot status ${hsStatus}`);
    }
    if (effectiveCard && typeof window.updateCardYsfPanel === "function") {
      window.updateCardYsfPanel(effectiveCard, targetHs);
    }
    if (typeof showToast === "function") {
      showToast(window.t ? window.t("ysf.connected_toast", { name: effectiveName, room: sRoomId }, `Подключение к комнате #${sRoomId} (${effectiveName})...`) : `Подключение к комнате #${sRoomId} (${effectiveName})...`, 3000, effectiveCard);
    }
    return { ok: true };
  } catch (e) {
    console.warn("[YSF] Connect room error:", e);
    if (typeof showToast === "function") {
      showToast(window.t ? window.t("contacts.ysf_connect_err_toast", { room: sRoomId, error: e.message || e }, `Failed to connect to room #${sRoomId}: ${e.message || e}`) : `Failed to connect to room #${sRoomId}: ${e.message || e}`, "error", effectiveCard);
    }
    return { ok: false, reason: e.message || "http_failed" };
  }
}

export function openYsfMemPickerModal(roomObj, cid = null) {
  // Ячейки памяти M1-M5 в YSF упразднены в пользу матрицы комнат
  return;
  if (!roomObj || !roomObj.id) return;
  const sRoom = String(roomObj.id).trim();
  const rName = roomObj.reflector_name || roomObj.name || `YSF #${sRoom}`;

  const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : (window.currentHotspots || (window.__proxdmr && window.__proxdmr.currentHotspots))) || [];
  const targetId = cid || (window.activeHotspotId || "default");
  const targetHs = curHsList.find(h => h && h.id === targetId) || curHsList[0];
  if (!targetHs) return;

  targetHs.ysf_memories = targetHs.ysf_memories || [
    { room: "25000", name: "YSF-Russia" },
    { room: "00007", name: "EUROPELINK" },
    { room: "00032", name: "XLX032" },
    { room: "00020", name: "NLCENTRAL" },
    { room: "00040", name: "DL-Nordwest" }
  ];

  const backdrop = document.createElement("div");
  backdrop.className = "ysf-mem-picker-backdrop";
  const dialog = document.createElement("div");
  dialog.className = "ysf-mem-picker-dialog";
  dialog.innerHTML = `
    <div class="ysf-mem-picker-title">${window.t ? window.t("contacts.ysf_mem_picker_title", { room: sRoom, name: escapeHtml(rName) }, `💾 Assign room #${sRoom} (${escapeHtml(rName)}) to memory button:`) : `💾 Assign room #${sRoom} (${escapeHtml(rName)}) to memory button:`}</div>
    <div class="ysf-mem-picker-slots">
      ${[0, 1, 2, 3, 4].map(idx => {
        const cur = targetHs.ysf_memories[idx] || { room: "", name: "" };
        const curLabel = cur.room ? `#${cur.room} ${cur.name}` : "—";
        return `
          <button type="button" class="btn-ysf-mem-slot" data-slot="${idx}">
            <span>M${idx + 1}</span>
            <span class="mem-cur-label">${escapeHtml(curLabel)}</span>
          </button>
        `;
      }).join("")}
    </div>
    <div style="display:flex; justify-content:flex-end;">
      <button type="button" class="btn-secondary btn-sm btn-close-mem-picker" style="padding:4px 12px;">${window.t ? window.t("common.cancel", {}, "Cancel") : "Cancel"}</button>
    </div>
  `;
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const cleanup = () => { backdrop.remove(); };
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) cleanup(); });
  dialog.querySelector(".btn-close-mem-picker").addEventListener("click", cleanup);

  dialog.querySelectorAll(".btn-ysf-mem-slot").forEach(btn => {
    btn.addEventListener("click", async () => {
      const slotIdx = parseInt(btn.dataset.slot, 10);
      targetHs.ysf_memories[slotIdx] = { room: sRoom, name: rName };
      cleanup();

      // Сохранение в настройки хотспота
      try {
        await fetch(`/api/hotspots/${encodeURIComponent(targetHs.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(targetHs)
        });
      } catch (err) {
        console.warn("[YSF] Save memory error:", err);
      }

      // Обновление карточки
      const card = document.querySelector(`.radio-container[data-hotspot-id="${targetHs.id}"]`) || document.getElementById("radioContainer");
      if (card && typeof window.updateCardYsfPanel === "function") {
        window.updateCardYsfPanel(card, targetHs);
      }
      if (typeof showToast === "function") {
        showToast(window.t ? window.t("contacts.ysf_mem_assigned_toast", { room: sRoom, name: rName, slot: slotIdx + 1 }, `✓ Room #${sRoom} (${rName}) assigned to M${slotIdx + 1}`) : `✓ Room #${sRoom} (${rName}) assigned to M${slotIdx + 1}`, "success", 3000);
      }
    });
  });
}

export function renderYsfRoomsList(filterText = "") {
  const container = document.getElementById("ysfRoomsListContainer");
  const headerCountBadge = document.getElementById("contactsCountBadge");
  if (!container) return;

  const ysfList = ((_ysfViewMode === "contacts") ? getYsfBookmarks() : _getYsfServersList()).map(r => _enrichYsfRoomRecord(r));
  const query = (filterText || "").trim().toLowerCase();

  let filtered = ysfList;
  if (_ysfTypeFilter && _ysfTypeFilter !== "all") {
    filtered = filtered.filter(r => classifyYsfReflector(r).reflectorType === _ysfTypeFilter);
  }
  if (query) {
    filtered = filtered.filter(r => {
      const info = resolveYsfRoomInfo(r);
      const rid = String(r.id || "").toLowerCase();
      const rname = String(r.name || "").toLowerCase();
      const refname = String(info.refName || "").toLowerCase();
      const ccode = String(info.cCode || "").toLowerCase();
      const cname = String(info.countryName || "").toLowerCase();
      const host = String(r.host || "").toLowerCase();
      const desc = String(r.description || "").toLowerCase();
      return rid.includes(query) || rname.includes(query) || refname.includes(query) || ccode.includes(query) || cname.includes(query) || host.includes(query) || desc.includes(query);
    });
  }

  filtered = _sortYsfRooms(filtered);
  _ysfFilteredRooms = filtered;

  if (headerCountBadge && isYsfRoomsActive()) {
    headerCountBadge.textContent = String(filtered.length);
  }

  _updateYsfSortUi();
  _updateYsfTypeFilterUi();

  if (!filtered.length) {
    const emptyMsg = (_ysfViewMode === "contacts" && !query && _ysfTypeFilter === "all")
      ? (window.t ? window.t("contacts.ysf_contacts_empty", {}, "YSF contacts are empty. Open «YSF Directory» and click ☆ on rooms you want.") : "YSF contacts are empty. Open «YSF Directory» and click ☆ on rooms you want.")
      : (_ysfViewMode === "catalog" && !query && !ysfList.length)
        ? (window.t ? window.t("contacts.ysf_catalog_loading", {}, "YSF catalog is loading… Please try again in a minute.") : "YSF catalog is loading… Please try again in a minute.")
        : (window.t ? window.t("contacts.ysf_not_found", {}, "No rooms found") : "No rooms found");
    container.innerHTML = `<div style="text-align:center; padding:30px 10px; color:#94a3b8; font-size:0.88rem;">${emptyMsg}</div>`;
    return;
  }

  _renderAllYsfRooms(container);
  _ensureYsfContainerListener(container);
}

let aslSearchAbortCtrl = null;
export function isAllStarNodesActive() {
  const viewAsl = document.getElementById("allstarNodesView");
  return Boolean(viewAsl && viewAsl.style.display !== "none");
}

export function isYsfRoomsActive() {
  const viewYsf = document.getElementById("ysfRoomsView");
  return Boolean(viewYsf && viewYsf.style.display !== "none");
}

let cachedAslDbTotal = 40995;

export async function fetchAslDirectoryStats() {
  const badge = document.getElementById("contactsCountBadge");
  const totalCountEl = document.getElementById("aslNodesTotalCount");
  try {
    const res = await fetch("/api/allstar/nodes/stats");
    if (res.ok) {
      const data = await res.json();
      if (data && data.stats && data.stats.total) {
        cachedAslDbTotal = data.stats.total;
        if (totalCountEl) totalCountEl.textContent = Number(data.stats.total).toLocaleString();
        if (badge && isAllStarNodesActive()) {
          badge.textContent = Number(data.stats.total).toLocaleString();
        }
      }
    }
  } catch (e) {
    if (badge && isAllStarNodesActive()) {
      badge.textContent = cachedAslDbTotal.toLocaleString();
    }
  }
}

export function switchContactsModalTab(tabName) {
  const btnDmr = document.getElementById("btnContactsTabDmr");
  const btnAsl = document.getElementById("btnContactsTabAllstar");
  const btnYsf = document.getElementById("btnContactsTabYsf");
  const viewDmr = document.getElementById("dmrContactsView");
  const viewAsl = document.getElementById("allstarNodesView");
  const viewYsf = document.getElementById("ysfRoomsView");
  const dmrFooter = document.getElementById("dmrFooterControls");
  const aslFooter = document.getElementById("allstarFooterControls");
  const gwToggle = document.getElementById("btnContactsGatewayToggle");
  const expBtn = document.getElementById("btnExportContacts");
  const impBtn = document.getElementById("btnImportContacts");
  const gwPanel = document.getElementById("contactsGatewayPanel");
  const badge = document.getElementById("contactsCountBadge");

  if (tabName === "allstar") {
    if (btnDmr) btnDmr.classList.remove("active");
    if (btnYsf) btnYsf.classList.remove("active");
    if (btnAsl) btnAsl.classList.add("active");
    if (viewDmr) viewDmr.style.display = "none";
    if (viewYsf) viewYsf.style.display = "none";
    if (viewAsl) {
      viewAsl.style.display = "flex";
      renderAllStarNodesList();
    }
    // Purge DMR artifacts from footer in AllStar mode
    if (dmrFooter) dmrFooter.style.display = "none";
    if (gwToggle) gwToggle.style.display = "none";
    if (expBtn) expBtn.style.display = "none";
    if (impBtn) impBtn.style.display = "none";
    if (gwPanel) gwPanel.style.display = "none";
    if (aslFooter) aslFooter.style.display = "inline-flex";
    const syncBtn = document.getElementById("btnSyncAslNodes");
    if (syncBtn) syncBtn.style.display = "inline-flex";

    fetchAslDirectoryStats();
  } else if (tabName === "ysf" || tabName === "ysf_contacts") {
    _ysfViewMode = (tabName === "ysf_contacts") ? "contacts" : "catalog";
    const btnYsfContacts = document.getElementById("btnContactsTabYsfContacts");
    if (btnDmr) btnDmr.classList.remove("active");
    if (btnAsl) btnAsl.classList.remove("active");
    if (btnYsf) btnYsf.classList.toggle("active", _ysfViewMode === "catalog");
    if (btnYsfContacts) btnYsfContacts.classList.toggle("active", _ysfViewMode === "contacts");
    if (viewDmr) viewDmr.style.display = "none";
    if (viewAsl) viewAsl.style.display = "none";
    if (viewYsf) {
      viewYsf.style.display = "flex";
      renderYsfRoomsList(document.getElementById("ysfRoomSearchInput")?.value || "");
    }
    if (dmrFooter) dmrFooter.style.display = "none";
    if (aslFooter) aslFooter.style.display = "none";
    if (gwToggle) gwToggle.style.display = "none";
    if (expBtn) expBtn.style.display = "none";
    if (impBtn) impBtn.style.display = "none";
    if (gwPanel) gwPanel.style.display = "none";
    const syncBtn = document.getElementById("btnSyncAslNodes");
    if (syncBtn) syncBtn.style.display = "none";
  } else {
    if (btnAsl) btnAsl.classList.remove("active");
    if (btnYsf) btnYsf.classList.remove("active");
    if (btnDmr) btnDmr.classList.add("active");
    if (viewAsl) viewAsl.style.display = "none";
    if (viewYsf) viewYsf.style.display = "none";
    if (viewDmr) viewDmr.style.display = "block";

    const isBmContext = ((contactsActiveNetworkType || "bm").toLowerCase() === "bm");
    if (aslFooter) aslFooter.style.display = "none";
    const syncBtn = document.getElementById("btnSyncAslNodes");
    if (syncBtn) syncBtn.style.display = "none";
    if (dmrFooter) dmrFooter.style.display = "inline-flex";
    if (gwToggle) gwToggle.style.display = isBmContext ? "" : "none";
    if (gwPanel && !isBmContext) gwPanel.style.display = "none";
    if (expBtn) expBtn.style.display = "";
    if (impBtn) impBtn.style.display = "";

    renderContactsTree(contactsSearchInput ? contactsSearchInput.value.trim() : "");
  }
}


let _aslDirObserver = null;
let _aslDirProbeDebounce = null;
let _aslDirBatchAbortCtrl = null;

function renderAslDirTelemetryHtml(probe) {
  if (!probe) return '<span class="asl-dir-badge is-zero">···</span>';
  const isOnline = Boolean(probe.online);
  const pingTitle = probe.pong ? (window.t ? window.t("contacts.asl_ping_tooltip", { rtt: probe.rtt_ms }, `Пинг: ${probe.rtt_ms}мс`) : `Пинг: ${probe.rtt_ms}мс`) : (window.t ? window.t("contacts.asl_reg_tooltip", {}, "Зарегистрирован в ASL") : "Зарегистрирован в ASL");
  const statusHtml = isOnline
    ? `<span class="asl-dir-badge is-online" title="${pingTitle}">🟢 ONLINE${probe.pong && probe.rtt_ms ? ' · ' + probe.rtt_ms + ' ms' : ''}</span>`
    : `<span class="asl-dir-badge is-offline">⚪ OFFLINE</span>`;

  if (!isOnline) {
    return statusHtml;
  }

  const tLev = probe.traffic_level || "low";
  let tText = window.t ? window.t("contacts.asl_traffic_quiet", {}, "Тихо") : "Тихо";
  if (tLev === "live") tText = window.t ? window.t("contacts.asl_traffic_live", {}, "В ЭФИРЕ 🔥") : "В ЭФИРЕ 🔥";
  else if (tLev === "high") tText = window.t ? window.t("contacts.asl_traffic_high", {}, "Высокий") : "Высокий";
  else if (tLev === "medium") tText = window.t ? window.t("contacts.asl_traffic_medium", {}, "Средний") : "Средний";
  const airTitle = window.t ? window.t("contacts.asl_air_tooltip", { pct: probe.tx_duty_pct || 0, keyups: probe.keyups_per_hour || 0 }, `Эфир: ${probe.tx_duty_pct || 0}% (~${probe.keyups_per_hour || 0} вкл/ч)`) : `Эфир: ${probe.tx_duty_pct || 0}% (~${probe.keyups_per_hour || 0} вкл/ч)`;
  const trafficHtml = `<span class="asl-dir-badge traffic-${tLev}" title="${airTitle}"><span class="asl-traffic-bars"><i></i><i></i><i></i></span> ${tText}</span>`;

  return `${statusHtml}${trafficHtml}`;
}

function setupAslDirectoryTelemetry(container) {
  if (!container) return;
  if (_aslDirObserver) {
    _aslDirObserver.disconnect();
    _aslDirObserver = null;
  }
  if (_aslDirProbeDebounce) {
    clearTimeout(_aslDirProbeDebounce);
    _aslDirProbeDebounce = null;
  }
  if (_aslDirBatchAbortCtrl) {
    _aslDirBatchAbortCtrl.abort();
    _aslDirBatchAbortCtrl = null;
  }

  window._aslGlobalNodeProbeCache = window._aslGlobalNodeProbeCache || {};

  // First pass: immediately render cached nodes
  container.querySelectorAll(".asl-node-card").forEach(card => {
    const n = card.dataset.node;
    if (n && window._aslGlobalNodeProbeCache[n]) {
      const probe = window._aslGlobalNodeProbeCache[n];
      const telemEl = card.querySelector(`[data-telemetry-node="${n}"]`);
      if (telemEl) telemEl.innerHTML = renderAslDirTelemetryHtml(probe);
      card.classList.toggle("asl-dir-card-offline", !probe.online);
    }
  });

  const pendingNodes = new Set();
  const triggerBatchProbe = () => {
    if (!pendingNodes.size) return;
    const batch = Array.from(pendingNodes).slice(0, 25);
    batch.forEach(n => pendingNodes.delete(n));

    _aslDirBatchAbortCtrl = new AbortController();
    fetch("/api/allstar/matrix-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hotspot_id: "default", nodes: batch, force: false }),
      signal: _aslDirBatchAbortCtrl.signal
    })
      .then(r => r.json())
      .then(data => {
        if (data && data.nodes) {
          Object.assign(window._aslGlobalNodeProbeCache, data.nodes);
          Object.entries(data.nodes).forEach(([n, probe]) => {
            const card = container.querySelector(`.asl-node-card[data-node="${n}"]`);
            if (card) {
              const telemEl = card.querySelector(`[data-telemetry-node="${n}"]`);
              if (telemEl) telemEl.innerHTML = renderAslDirTelemetryHtml(probe);
              card.classList.toggle("asl-dir-card-offline", !probe.online);
            }
          });
        }
      })
      .catch(() => {});
  };

  if ("IntersectionObserver" in window) {
    _aslDirObserver = new IntersectionObserver((entries) => {
      let hasNew = false;
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const card = entry.target;
          const n = card.dataset.node;
          if (n && !window._aslGlobalNodeProbeCache[n]) {
            pendingNodes.add(n);
            hasNew = true;
          }
          _aslDirObserver.unobserve(card);
        }
      });
      if (hasNew) {
        if (_aslDirProbeDebounce) clearTimeout(_aslDirProbeDebounce);
        _aslDirProbeDebounce = setTimeout(triggerBatchProbe, 220);
      }
    }, { root: container, threshold: 0.05 });

    container.querySelectorAll(".asl-node-card").forEach(card => {
      const n = card.dataset.node;
      if (n && !window._aslGlobalNodeProbeCache[n]) {
        _aslDirObserver.observe(card);
      }
    });
  } else {
    // Fallback if IntersectionObserver is unavailable: probe first 20 nodes immediately
    container.querySelectorAll(".asl-node-card").forEach((card, idx) => {
      const n = card.dataset.node;
      if (n && !window._aslGlobalNodeProbeCache[n] && idx < 20) {
        pendingNodes.add(n);
      }
    });
    triggerBatchProbe();
  }
}

/**
 * Модальное окно выбора ячейки памяти узлов AllStarLink (3 экрана по 20 ячеек 4х5)
 * при добавлении узла из справочника в быстрые кнопки.
 */
export function openAslCellPickerModal(targetItem, cid = "default") {
  const existing = document.getElementById("aslCellPickerModal");
  if (existing) existing.remove();

  const tm = (key, fallback, params = {}) => {
    if (window.t) {
      const res = window.t(key, params, fallback);
      if (res && res !== key) return res;
    }
    let res = fallback;
    for (const [k, v] of Object.entries(params)) {
      res = res.replaceAll(`{${k}}`, String(v));
    }
    return res;
  };

  const DEFAULT_ASL_20 = [
    { node: "1999",   label: "Parrot Echo", flag: "🦜" },
    { node: "41522",  label: "HUBNet UK",  flag: "🇬🇧" },
    { node: "27339",  label: "East Coast", flag: "🇺🇸" },
    { node: "2143",   label: "WAN RS",     flag: "🇺🇸" },
    { node: "2000",   label: "Western Ref",flag: "🇺🇸" },
    { node: "51010",  label: "World Conf", flag: "🌐" },
    { node: "28554",  label: "RU3AID Hub", flag: "🇷🇺" },
    { node: "2560",   label: "WIN System", flag: "🇺🇸" },
    { node: "2462",   label: "Alaska Net", flag: "🇺🇸" },
    { node: "52495",  label: "DL-Nordwest",flag: "🇩🇪" },
    { node: "52319",  label: "Canada Hub", flag: "🇨🇦" },
    { node: "27170",  label: "Florida Hub",flag: "🇺🇸" },
    { node: "53085",  label: "PA Hub",     flag: "🇺🇸" },
    { node: "53431",  label: "Alabama Net",flag: "🇺🇸" },
    { node: "289890", label: "PA-Wide",    flag: "🇺🇸" },
    { node: "41413",  label: "Santiago Pk",flag: "🇺🇸" },
    { node: "47280",  label: "Georgia Net",flag: "🇺🇸" },
    { node: "42821",  label: "Germany DL", flag: "🇩🇪" },
    { node: "487571", label: "Australia",  flag: "🇦🇺" },
    { node: "500691", label: "Texas Hub",  flag: "🇺🇸" }
  ];

  let userQuickNodes = [];
  try {
    let srvVal = hasServerCollectionKey("asl_quick_nodes", cid)
      ? getServerCollectionValue("asl_quick_nodes", cid)
      : (hasServerCollectionKey("asl_quick_nodes", "global") ? getServerCollectionValue("asl_quick_nodes", "global") : null);
    if (typeof srvVal === "string") srvVal = JSON.parse(srvVal);
    if (Array.isArray(srvVal)) {
      userQuickNodes = srvVal.map(x => (x ? { ...x } : x));
    } else {
      const saved = localStorage.getItem(`proxdmr_asl_quick_nodes_${cid}`) || localStorage.getItem("proxdmr_asl_quick_nodes_global");
      if (saved) userQuickNodes = JSON.parse(saved);
    }
  } catch (_) {}

  if (!Array.isArray(userQuickNodes) || !userQuickNodes.length) {
    userQuickNodes = [...DEFAULT_ASL_20];
  } else {
    userQuickNodes = userQuickNodes.map(item => {
      if (item && String(item.node).trim() === "2502") {
        return { node: "28554", label: "RU3AID Hub", flag: "🇷🇺" };
      }
      return item;
    });
    if (userQuickNodes.length < 20) {
      while (userQuickNodes.length < 20) {
        userQuickNodes.push(DEFAULT_ASL_20[userQuickNodes.length]);
      }
    }
  }
  while (userQuickNodes.length < 60) {
    userQuickNodes.push({ node: "", label: "", flag: "➕", scan: false });
  }

  const targetNode = String(targetItem.node || "").trim();
  const targetLabel = (targetItem.callsign ? targetItem.callsign : (targetItem.name || `Node ${targetNode}`)).slice(0, 14);
  const targetFlag = targetItem.flag || "🌐";

  const freeIndices = [];
  userQuickNodes.forEach((item, idx) => {
    if (!item || !String(item.node || "").trim()) {
      freeIndices.push(idx);
    }
  });

  const screenNames = [
    tm("asl.picker_screen_main", "Основной"),
    tm("asl.picker_screen_second", "Экран 2"),
    tm("asl.picker_screen_third", "Экран 3")
  ];

  const screensHtml = [0, 1, 2].map(pageIdx => {
    const startIdx = pageIdx * 20;
    const endIdx = startIdx + 20;
    const pageNodes = userQuickNodes.slice(startIdx, endIdx);
    const pageFreeCount = pageNodes.filter(x => !x || !String(x.node || "").trim()).length;

    const cellsHtml = pageNodes.map((cellItem, subIdx) => {
      const absIdx = startIdx + subIdx;
      const cellNum = absIdx + 1;
      const nodeNum = cellItem && cellItem.node ? String(cellItem.node).trim() : "";
      const isEmpty = !nodeNum;
      const isCurrentTarget = nodeNum === targetNode;

      let cls = "asl-picker-cell";
      if (isEmpty) cls += " is-empty";
      else cls += " is-occupied";
      if (isCurrentTarget) cls += " is-current";

      let inner = "";
      if (isEmpty) {
        inner = `
          <span class="asl-picker-cell-num">#${cellNum}</span>
          <span class="asl-picker-cell-empty-icon">➕</span>
          <span class="asl-picker-cell-title">${tm("asl.picker_empty_slot", "Свободно")}</span>
        `;
      } else {
        inner = `
          <div class="asl-picker-cell-top">
            <span class="asl-picker-cell-flag">${cellItem.flag || "🌐"}</span>
            <strong class="asl-picker-cell-node">${nodeNum}</strong>
            <span class="asl-picker-cell-num">#${cellNum}</span>
          </div>
          <div class="asl-picker-cell-bottom">
            <span class="asl-picker-cell-label">${cellItem.label || ""}</span>
            ${isCurrentTarget ? `<span class="asl-picker-cur-badge">${tm("asl.picker_already_badge", "✓ Добавлен")}</span>` : ""}
          </div>
        `;
      }

      const tooltip = isEmpty
        ? tm("asl.picker_cell_empty_tip", `Ячейка #${cellNum}: свободна. Нажмите для записи`, { cell: cellNum })
        : (isCurrentTarget
            ? tm("asl.picker_cell_cur_tip", `Ячейка #${cellNum}: уже содержит узел #${nodeNum}`, { cell: cellNum, node: nodeNum })
            : tm("asl.picker_cell_occ_tip", `Ячейка #${cellNum}: занята #${nodeNum} (${cellItem.label || ""}). Нажмите для замены`, { cell: cellNum, node: nodeNum, label: cellItem.label || "" }));

      return `
        <button type="button" class="${cls}" data-index="${absIdx}" data-cell="${cellNum}" title="${tooltip}">
          ${inner}
        </button>
      `;
    }).join("");

    return `
      <div class="asl-picker-screen-block">
        <div class="asl-picker-screen-header">
          <div class="asl-picker-screen-title">
            <span class="asl-picker-screen-icon">📺</span>
            <strong>${tm("asl.picker_screen_label", `Экран ${pageIdx + 1}: ${screenNames[pageIdx]}`, { page: pageIdx + 1, name: screenNames[pageIdx] })}</strong>
            <span class="asl-picker-screen-range">(${startIdx + 1}–${endIdx})</span>
          </div>
          <span class="asl-picker-screen-badge ${pageFreeCount > 0 ? "has-free" : "is-full"}">
            ${pageFreeCount > 0
              ? tm("asl.picker_free_count", `${pageFreeCount} из 20 свободно`, { free: pageFreeCount, total: 20 })
              : tm("asl.picker_full", "Заполнен")}
          </span>
        </div>
        <div class="asl-picker-grid">
          ${cellsHtml}
        </div>
      </div>
    `;
  }).join("");

  const modal = document.createElement("div");
  modal.id = "aslCellPickerModal";
  modal.className = "asl-matrix-modal-backdrop asl-picker-modal-backdrop";
  modal.innerHTML = `
    <div class="asl-cell-picker-modal" role="dialog" aria-modal="true" aria-labelledby="aslPickerTitle">
      <div class="asl-picker-header">
        <div class="asl-picker-header-left">
          <span class="asl-picker-header-icon">📌</span>
          <div class="asl-picker-header-text">
            <h3 id="aslPickerTitle" class="asl-picker-title">${tm("asl.picker_title", "Сохранить узел в быстрые")}</h3>
            <div class="asl-picker-target-node">
              <span class="asl-target-flag">${targetFlag}</span>
              <strong class="asl-target-node">#${targetNode}</strong>
              <span class="asl-target-label">${targetLabel}</span>
            </div>
          </div>
        </div>
        <button type="button" class="asl-modal-close asl-picker-close" title="${tm("asl.edit_close_esc", "Закрыть (Esc)")}">✕</button>
      </div>

      <p class="asl-picker-subtitle">
        ${tm("asl.picker_subtitle", "Выберите ячейку в матрице памяти хотспота (3 экрана по 20 ячеек 4×5):")}
      </p>

      <div class="asl-picker-scroll">
        ${screensHtml}
      </div>

      <div class="asl-picker-confirm-box hidden" id="aslPickerConfirmBox">
        <div class="asl-picker-confirm-msg" id="aslPickerConfirmMsg"></div>
        <div class="asl-picker-confirm-actions">
          <button type="button" class="asl-picker-btn-confirm-yes" id="aslPickerConfirmYes">
            ${tm("asl.picker_replace_btn", "Заменить")}
          </button>
          <button type="button" class="asl-picker-btn-confirm-no" id="aslPickerConfirmNo">
            ${tm("asl.mem_cancel", "Отмена")}
          </button>
        </div>
      </div>

      <div class="asl-picker-footer">
        <button type="button" class="asl-picker-footer-btn asl-picker-btn-first-free ${freeIndices.length === 0 ? "disabled" : ""}">
          ⚡ ${tm("asl.picker_first_free_btn", "В первую свободную")}
        </button>
        <button type="button" class="asl-picker-footer-btn asl-picker-btn-cancel">
          ${tm("asl.mem_cancel", "Отмена")}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("is-visible"));

  const closeModal = () => {
    modal.classList.remove("is-visible");
    setTimeout(() => { modal.remove(); }, 180);
  };

  const commitPlacement = (placedIdx) => {
    userQuickNodes[placedIdx] = {
      node: targetNode,
      label: targetLabel,
      flag: targetFlag,
      scan: false,
      role: targetItem.role || (/[*#ABCDabcd]/.test(targetNode) ? "dtmf" : "node")
    };
    if (typeof window.saveAslUserNodes === "function") {
      window.saveAslUserNodes(cid, userQuickNodes);
    } else {
      setServerCollectionKey("asl_quick_nodes", cid, userQuickNodes, "proxdmr_asl_quick_nodes_", true);
      setServerCollectionKey("asl_quick_nodes", "global", userQuickNodes, "proxdmr_asl_quick_nodes_", true);
    }

    const placedPage = Math.floor(placedIdx / 20);
    closeModal();

    if (typeof showToast === "function") {
      const addedMsg = tm(
        "asl.added_to_memory_toast",
        `📌 Узел #${targetNode} (${targetLabel}) добавлен в ячейку #${placedIdx + 1} (экран ${placedPage + 1})`,
        { node: targetNode, label: targetLabel, cell: placedIdx + 1, page: placedPage + 1 }
      );
      showToast(addedMsg, "info", 2600);
    }

    if (typeof window.setAslMatrixPageForCid === "function") {
      window.setAslMatrixPageForCid(cid, placedPage);
    } else {
      const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
      if (card && typeof window.updateCardAllStarPanel === "function") {
        window.updateCardAllStarPanel(card);
      }
    }
  };

  modal.querySelectorAll(".asl-picker-cell").forEach(cellBtn => {
    cellBtn.addEventListener("click", () => {
      const idx = parseInt(cellBtn.dataset.index, 10);
      const cellNum = idx + 1;
      const current = userQuickNodes[idx];
      const curNum = current && current.node ? String(current.node).trim() : "";

      if (!curNum) {
        commitPlacement(idx);
        return;
      }

      if (curNum === targetNode) {
        const placedPage = Math.floor(idx / 20);
        closeModal();
        if (typeof showToast === "function") {
          showToast(tm("asl.picker_already_toast", `Узел #${targetNode} уже сохранён в ячейке #${cellNum} (экран ${placedPage + 1})`, { node: targetNode, cell: cellNum, page: placedPage + 1 }), "info", 2200);
        }
        if (typeof window.setAslMatrixPageForCid === "function") {
          window.setAslMatrixPageForCid(cid, placedPage);
        }
        return;
      }

      const confirmBox = modal.querySelector("#aslPickerConfirmBox");
      const confirmMsg = modal.querySelector("#aslPickerConfirmMsg");
      const btnYes = modal.querySelector("#aslPickerConfirmYes");
      const btnNo = modal.querySelector("#aslPickerConfirmNo");

      if (confirmBox && confirmMsg && btnYes && btnNo) {
        confirmMsg.innerHTML = tm(
          "asl.picker_overwrite_confirm",
          `⚠️ Ячейка <strong>#${cellNum}</strong> уже занята узлом <strong>${current.flag || "🌐"} #${curNum} (${current.label || ""})</strong>.<br>Заменить на <strong>${targetFlag} #${targetNode} (${targetLabel})</strong>?`,
          { cell: cellNum, existing: `${current.flag || "🌐"} #${curNum} (${current.label || ""})`, node: targetNode, label: targetLabel }
        );
        confirmBox.classList.remove("hidden");
        confirmBox.scrollIntoView({ behavior: "smooth", block: "nearest" });

        btnYes.onclick = () => {
          confirmBox.classList.add("hidden");
          commitPlacement(idx);
        };
        btnNo.onclick = () => {
          confirmBox.classList.add("hidden");
        };
      }
    });
  });

  const btnFirstFree = modal.querySelector(".asl-picker-btn-first-free");
  if (btnFirstFree && freeIndices.length > 0) {
    btnFirstFree.addEventListener("click", () => {
      commitPlacement(freeIndices[0]);
    });
  }

  modal.querySelector(".asl-picker-close").addEventListener("click", closeModal);
  modal.querySelector(".asl-picker-btn-cancel").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  const onKey = (e) => {
    if (e.key === "Escape") {
      document.removeEventListener("keydown", onKey);
      closeModal();
    }
  };
  document.addEventListener("keydown", onKey);
}

export async function renderAllStarNodesList(filterText = "") {
  const container = document.getElementById("aslNodesListContainer");
  if (!container) return;
  const badge = document.getElementById("contactsCountBadge");
  const q = (filterText || "").trim();

  if (aslSearchAbortCtrl) {
    aslSearchAbortCtrl.abort();
  }
  aslSearchAbortCtrl = new AbortController();

  let nodes = [];
  let dbTotal = cachedAslDbTotal;

  try {
    const res = await fetch(`/api/allstar/nodes?q=${encodeURIComponent(q)}&limit=60`, {
      signal: aslSearchAbortCtrl.signal
    });
    if (res.ok) {
      const data = await res.json();
      nodes = data.nodes || [];
      dbTotal = data.total || cachedAslDbTotal;
      cachedAslDbTotal = dbTotal;
      if (badge && isAllStarNodesActive()) {
        badge.textContent = q ? `${nodes.length} / ${Number(dbTotal).toLocaleString()}` : Number(dbTotal).toLocaleString();
      }
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    const fallback = getAllStarNodesDirectory();
    const qLower = q.toLowerCase();
    nodes = fallback.filter(n => {
      if (!qLower) return true;
      return (n.node && n.node.toLowerCase().includes(qLower)) ||
             (n.name && n.name.toLowerCase().includes(qLower)) ||
             (n.hub && n.hub.toLowerCase().includes(qLower)) ||
             (n.callsign && n.callsign.toLowerCase().includes(qLower));
    });
    if (badge && isAllStarNodesActive()) {
      badge.textContent = nodes.length;
    }
  }

  if (!nodes.length) {
    const aslEmptyMsg = window.t ? window.t("contacts.asl_not_found", {}, "No AllStarLink nodes found") : "No AllStarLink nodes found";
    container.innerHTML = `<div style="text-align:center;padding:30px;color:#94a3b8;font-size:0.85rem;">${escapeHtml(aslEmptyMsg)}</div>`;
    return;
  }

  const toContactsTitle = window.t ? window.t("contacts.asl_to_contacts_title", {}, "Save node or operator to your personal phonebook (My Contacts)") : "Save node or operator to your personal phonebook (My Contacts)";
  const toContactsBtn = window.t ? window.t("contacts.asl_btn_to_contacts", {}, "➕ To Contacts") : "➕ To Contacts";

  container.innerHTML = nodes.map(item => {
    const hubDisplay = item.location || (item.hub_key && window.t ? window.t(item.hub_key, {}, item.hub) : item.hub) || '';
    return `
    <div class="asl-node-card" data-node="${item.node}">
      <div class="asl-node-card-left">
        <span class="asl-node-card-flag">${item.flag || '🌐'}</span>
        <div class="asl-node-card-info">
          <div class="asl-node-card-title">
            <span class="node-num-tag">#${item.node}</span>
            <span>${item.callsign ? `<strong style="color:#7dd3fc; margin-right:4px;">${item.callsign}</strong>` : ''}${item.name || 'AllStar Node'}</span>
            <span class="asl-dir-telemetry" data-telemetry-node="${item.node}"></span>
          </div>
          <div class="asl-node-card-desc">${escapeHtml(hubDisplay)}</div>
        </div>
      </div>
      <div class="asl-node-card-right" style="display:inline-flex; align-items:center; gap:5px;">
        <button type="button" class="btn-asl-to-contacts" data-node="${item.node}" title="${escapeHtml(toContactsTitle)}" style="padding:3px 7px; font-size:0.72rem; border-radius:6px; background:rgba(56,189,248,0.14); color:#7dd3fc; border:1px solid rgba(56,189,248,0.3); cursor:pointer;">
          ${escapeHtml(toContactsBtn)}
        </button>
        <button type="button" class="btn-asl-pin" data-node="${item.node}" title="${window.t ? window.t("contacts.asl_pin_tooltip", {}, "Add to hotspot quick buttons") : "Add to hotspot quick buttons"}">
          📌 ${window.t ? window.t("contacts.asl_btn_pin", {}, "To Quick") : "To Quick"}
        </button>
        ${item.isCustom ? `<button type="button" class="btn-asl-del" data-node="${item.node}" title="${window.t ? window.t("contacts.asl_del_tooltip", {}, "Delete node") : "Delete node"}" style="background:transparent;border:none;cursor:pointer;color:#f87171;">🗑️</button>` : ''}
      </div>
    </div>
  `;
  }).join("");

  container.querySelectorAll(".btn-asl-to-contacts").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const n = btn.dataset.node;
      const targetItem = nodes.find(x => String(x.node) === String(n));
      if (!targetItem) return;
      switchContactsModalTab("dmr");
      openContactEditModal(null, null, "allstar_node");
      if (contactEditAllStarNode) contactEditAllStarNode.value = String(targetItem.node || "");
      if (contactEditCallsign && targetItem.callsign) contactEditCallsign.value = String(targetItem.callsign).toUpperCase();
      if (contactEditName) contactEditName.value = targetItem.name || (targetItem.hub_key && window.t ? window.t(targetItem.hub_key, {}, targetItem.hub) : targetItem.hub) || `Node #${targetItem.node}`;
      if (contactEditCity && targetItem.location) contactEditCity.value = targetItem.location;
    };
  });

  container.querySelectorAll(".btn-asl-pin").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const n = btn.dataset.node;
      const targetItem = nodes.find(x => String(x.node) === String(n));
      if (!targetItem) return;
      const cid = (typeof window !== "undefined" && window.activeHotspotId) || "default";
      openAslCellPickerModal(targetItem, cid);
    };
  });

  container.querySelectorAll(".btn-asl-del").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const n = btn.dataset.node;
      const updated = nodes.filter(x => x.node !== n);
      saveAllStarNodesDirectory(updated);
      renderAllStarNodesList(filterText);
      if (typeof showToast === "function") {
        showToast(window.t ? window.t("contacts.asl_node_deleted_toast", { node: n }, `🗑️ Node #${n} deleted`) : `🗑️ Node #${n} deleted`, "info", 1500);
      }
    };
  });

  setupAslDirectoryTelemetry(container);
}


export function closeMyContactsModal() {
    if (myContactsModal && myContactsModal.classList.contains("active")) {
      myContactsModal.classList.remove("active");
      myContactsModal.style.display = "";
      notifyNavClosed();
    }
  }
  window.closeMyContactsModal = closeMyContactsModal;

  // Count total contact leaves in tree
export function countContactsInTree(nodes) {
    let count = 0;
    if (!Array.isArray(nodes)) return 0;
    for (const n of nodes) {
      if (n.type === "folder") {
        count += countContactsInTree(n.children);
      } else {
        count += 1;
      }
    }
    return count;
  }

  // Find node by id in tree
export function findNodeInTree(nodes, id) {
    if (!Array.isArray(nodes)) return null;
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const found = findNodeInTree(n.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  // Remove node by id from tree
export function removeNodeFromTree(nodes, id) {
    if (!Array.isArray(nodes)) return false;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        nodes.splice(i, 1);
        return true;
      }
      if (nodes[i].children && removeNodeFromTree(nodes[i].children, id)) {
        return true;
      }
    }
    return false;
  }

  // Find parent of a node
export function findParentNodeInTree(nodes, childId, parent = null) {
    if (!Array.isArray(nodes)) return null;
    for (const n of nodes) {
      if (n.id === childId) return parent;
      if (n.children) {
        const found = findParentNodeInTree(n.children, childId, n);
        if (found !== null) return found;
      }
    }
    return null;
  }

  // Calculate depth of a node (1-indexed: 1 = root)
export function getNodeDepth(nodes, targetId, currentDepth = 1) {
    if (!Array.isArray(nodes)) return 0;
    for (const n of nodes) {
      if (n.id === targetId) return currentDepth;
      if (n.children) {
        const d = getNodeDepth(n.children, targetId, currentDepth + 1);
        if (d > 0) return d;
      }
    }
    return 0;
  }

  // (escapeHtml imported from ../core/formatters.js)

export function getLocalizedContactName(node) {
  if (!node) return "";
  const name = node.name || "";
  if (!window.t) return name;

  if (node.id === "fav_root" || name === "⭐ Избранное" || name === "Избранное" || name === "⭐ Favorites" || name === "Favorites") {
    return window.t("contacts.folder_fav", {}, name);
  }
  if (node.id === "groups_root" || name === "🎯 Разговорные группы (TG)" || name === "Разговорные группы (TG)" || name === "🎯 Talkgroups (TG)" || name === "Talkgroups (TG)") {
    return window.t("contacts.folder_groups", {}, name);
  }
  if (node.id === "tg_fed" || name === "Федеральные TG" || name === "Federal TG" || name === "Federal / National TG") {
    return window.t("contacts.folder_tg_fed", {}, name);
  }
  if (node.id === "tg_reg" || name === "Региональные TG" || name === "Regional TG") {
    return window.t("contacts.folder_tg_reg", {}, name);
  }
  if (node.id === "repeaters_root" || name === "📡 Репитеры и Точки доступа" || name === "Репитеры и Точки доступа" || name === "📡 Repeaters & Hotspots" || name === "Repeaters & Hotspots") {
    return window.t("contacts.folder_repeaters", {}, name);
  }
  if (node.id === "people_root" || name === "Люди" || name === "👤 Люди" || name === "People" || name === "👤 People") {
    return window.t("contacts.folder_people", {}, name);
  }
  if (node.id === "fav_echo" || name === "Эхо-тест BM (Parrot)" || name === "BM Echo Test (Parrot)") {
    return window.t("contacts.fav_echo", {}, name);
  }
  if (node.id === "fav_ru" || name === "Россия общая" || name === "Russia General") {
    return window.t("contacts.fav_ru", {}, name);
  }
  if (node.id === "tg_2501" || name === "Россия (Основная)" || name === "Russia (Main)") {
    return window.t("contacts.tg_2501", {}, name);
  }
  if (node.id === "tg_2502" || name === "Россия (Вызывная)" || name === "Russia (Calling)") {
    return window.t("contacts.tg_2502", {}, name);
  }
  if (node.id === "tg_25050" || name === "Москва и МО" || name === "Moscow & Region") {
    return window.t("contacts.tg_25050", {}, name);
  }
  if (node.id === "tg_25078" || name === "Санкт-Петербург и ЛО" || name === "Saint Petersburg & LO") {
    return window.t("contacts.tg_25078", {}, name);
  }
  if (node.id === "tg_25026" || name === "Юг России / Кавказ" || name === "South Russia / Caucasus") {
    return window.t("contacts.tg_25026", {}, name);
  }
  if (node.id === "tg_25066" || name === "Урал и Сибирь" || name === "Ural & Siberia") {
    return window.t("contacts.tg_25066", {}, name);
  }
  if (node.id === "rpt_moscow" || name === "RR3AAA Репитер Москва" || name === "RR3AAA Moscow Repeater") {
    return window.t("contacts.rpt_moscow", {}, name);
  }
  if (node.id === "rpt_spb" || name === "RR1AA Репитер СПб" || name === "RR1AA St. Petersburg Repeater") {
    return window.t("contacts.rpt_spb", {}, name);
  }
  return name;
}

export function getLocalizedContactCity(node) {
  if (!node || !node.city) return "";
  const city = String(node.city);
  if (!window.t) return city;
  if (city === "Worldwide" || city === "Global") return window.t("countries.GLOBAL", {}, city);
  if (city === "Russia") return window.t("countries.RU", {}, city);
  if (city === "РФ" || city === "RU") return window.t("contacts.city_rf", {}, city);
  if (city === "Москва" || city === "Moscow") return window.t("contacts.city_moscow", {}, city);
  if (city === "СПб" || city === "St. Petersburg") return window.t("contacts.city_spb", {}, city);
  if (city === "ЮФО / СКФО" || city === "South / N. Caucasus") return window.t("contacts.city_south_caucasus", {}, city);
  if (city === "УФО / СФО" || city === "Ural / Siberia") return window.t("contacts.city_ural_siberia", {}, city);
  if (city === "Москва, 439.100" || city === "Moscow, 439.100") return window.t("contacts.city_moscow_freq", {}, city);
  if (city === "СПб, 438.825" || city === "St. Petersburg, 438.825") return window.t("contacts.city_spb_freq", {}, city);
  return city;
}

  // Render contacts tree
export function renderContactsTree(filterText = "") {
    ensureElements();
    if (!contactsTreeContainer) return;
    const activeNet = (contactsActiveNetworkType || "bm").toLowerCase();

    const q = (filterText || "").trim().toLowerCase();

    function nodeMatchesFilter(n) {
      if (!nodeMatchesNetworkContext(n, activeNet)) return false;
      if (!q) return true;
      const locName = getLocalizedContactName(n);
      const locCity = getLocalizedContactCity(n);
      const ids = n.type === "person" ? getPersonIdentities(n) : {};
      const matchSelf = (
        (n.name && n.name.toLowerCase().includes(q)) ||
        (locName && locName.toLowerCase().includes(q)) ||
        (n.callsign && n.callsign.toLowerCase().includes(q)) ||
        (n.city && n.city.toLowerCase().includes(q)) ||
        (locCity && locCity.toLowerCase().includes(q)) ||
        (n.comment && n.comment.toLowerCase().includes(q)) ||
        (n.dmr_id && String(n.dmr_id).includes(q)) ||
        (ids.dmr_id && String(ids.dmr_id).includes(q)) ||
        (ids.allstar_node && String(ids.allstar_node).includes(q)) ||
        (ids.echolink_node && String(ids.echolink_node).includes(q)) ||
        (n.tg && String(n.tg).includes(q)) ||
        (n.node_number && String(n.node_number).includes(q)) ||
        (n.allstar_node && String(n.allstar_node).includes(q))
      );
      if (matchSelf) return true;
      if (n.type === "folder" && Array.isArray(n.children)) {
        return n.children.some(child => nodeMatchesFilter(child));
      }
      return false;
    }

    let visibleContactsCount = 0;

    function renderNode(node, depth = 1) {
      if (!nodeMatchesFilter(node)) return "";

      const localizedTitle = getLocalizedContactName(node);

      if (node.type === "folder") {
        const isCollapsed = q ? false : !!node.collapsed;
        const renderedChildren = (node.children || [])
          .map(child => renderNode(child, depth + 1))
          .filter(Boolean);
        const childrenHtml = renderedChildren.join("");
        const childCount = renderedChildren.length;
        const canAddChild = depth < 3;
        const addFolderTitle = window.t ? window.t("contacts.add_to_folder_title", {}, "Добавить контакт в эту папку") : "Добавить контакт в эту папку";
        const editFolderTitle = window.t ? window.t("contacts.edit_folder_title", {}, "Редактировать папку") : "Редактировать папку";
        const delFolderTitle = window.t ? window.t("contacts.del_folder_title", {}, "Удалить папку") : "Удалить папку";

        return `
          <div class="tree-node-item tree-folder-item ${isCollapsed ? 'collapsed' : ''}" data-node-id="${node.id}" data-depth="${depth}">
            <div class="tree-row tree-folder-row">
              <div class="tree-row-left" data-action="toggle-folder" data-node-id="${node.id}">
                <span class="tree-chevron">${isCollapsed ? '▶' : '▼'}</span>
                <span class="tree-folder-icon">📁</span>
                <span class="tree-folder-title">${escapeHtml(localizedTitle)}</span>
                <span class="tree-folder-badge">${childCount}</span>
              </div>
              <div class="tree-row-actions">
                ${canAddChild ? `<button type="button" class="btn-tree-action" data-action="add-child" data-parent-id="${node.id}" title="${addFolderTitle}">➕</button>` : ''}
                <button type="button" class="btn-tree-action" data-action="edit-node" data-node-id="${node.id}" title="${editFolderTitle}">✏️</button>
                <button type="button" class="btn-tree-action action-del" data-action="delete-node" data-node-id="${node.id}" title="${delFolderTitle}">🗑️</button>
              </div>
            </div>
            <div class="tree-children-container">
              ${childrenHtml || `<div style="font-size:0.56rem;color:#8b949e;padding:1px 6px;font-style:italic;">${window.t ? window.t("contacts.folder_empty", {}, "(Папка пуста)") : "(Папка пуста)"}</div>`}
            </div>
          </div>
        `;
      } else {
        visibleContactsCount += 1;
        let icon = "👤";
        let targetLabel = "";
        let extraNetBadgesHtml = "";

        if (node.type === "asl_macro") {
          icon = "⌨️";
          const cmd = node.node_number || node.allstar_node || "";
          targetLabel = `DTMF ${escapeHtml(String(cmd))}`;
        } else if (node.type === "allstar_node") {
          icon = "📻";
          const nodeNum = node.node_number || node.allstar_node || node.tg || "";
          targetLabel = node.callsign ? `${escapeHtml(node.callsign)} (#${escapeHtml(String(nodeNum))})` : `Node #${escapeHtml(String(nodeNum))}`;
        } else if (node.type === "tg") {
          icon = (node.network_type === "xlx") ? "🧩" : "🎯";
          targetLabel = `TG ${node.tg}`;
        } else if (node.type === "repeater") {
          icon = "📡";
          targetLabel = node.callsign || (node.dmr_id ? `ID ${node.dmr_id}` : `TG ${node.tg || ''}`);
        } else {
          // Person: Callsign + active network primary identifier (cross-network data goes cleanly into "Другие сети" section)
          icon = "👤";
          const ids = getPersonIdentities(node);
          const cs = node.callsign ? escapeHtml(node.callsign) : "";
          if (activeNet === "allstar") {
            const primaryAsl = ids.allstar_node ? `#${escapeHtml(String(ids.allstar_node))}` : (ids.echolink_node ? `EL #${escapeHtml(String(ids.echolink_node))}` : "");
            targetLabel = cs ? (primaryAsl ? `${cs} (${primaryAsl})` : cs) : primaryAsl;
          } else {
            const primaryDmr = ids.dmr_id ? String(ids.dmr_id) : "";
            targetLabel = cs ? (primaryDmr ? `${cs} (${primaryDmr})` : cs) : (primaryDmr ? `ID ${primaryDmr}` : "—");
          }
        }

        const otherNetworksHtml = buildCrossNetworkBadgesForNode(node, activeNet, false);
        const callProposalHint = window.t ? window.t("contacts.click_proposal", {}, "Кликните для предложения вызова") : "Кликните для предложения вызова";
        const callBtnTitle = window.t ? window.t("contacts.call_tg_btn", {}, "Вызов") : "Вызов";
        const editContactTitle = window.t ? window.t("contacts.edit_contact", {}, "Редактировать") : "Редактировать";
        const delContactTitle = window.t ? window.t("common.delete", {}, "Удалить") : "Удалить";
        const localizedCity = getLocalizedContactCity(node);

        return `
          <div class="tree-node-item tree-contact-item" data-node-id="${node.id}" data-depth="${depth}">
            <div class="tree-row tree-contact-row">
              <div class="tree-row-left" data-action="call-proposal" data-node-id="${node.id}" title="${callProposalHint}">
                <span class="tree-contact-icon">${icon}</span>
                <div class="tree-contact-main">
                  <span class="tree-contact-target target-${node.type}">${targetLabel}</span>
                  <span class="tree-contact-name">${escapeHtml(localizedTitle)}</span>
                  ${localizedCity ? `<span class="tree-contact-city">${escapeHtml(localizedCity)}</span>` : ''}
                  ${node.slot_override ? `<span class="tree-contact-slot-pill">TS${node.slot_override}</span>` : ''}
                  ${(() => {
                    const net = resolveNodeNetworkType(node);
                    if (!net) return "";
                    const netLabels = { bm: "BM", freedmr: "FreeDMR", adn: "ADN", tgif: "TGIF", xlx: "XLX", dmrplus: "DMR+", ysf: "YSF", allstar: "ASL", custom: "DMR" };
                    return `<span class="contact-net-badge net-${net}">${netLabels[net] || net.toUpperCase()}</span>`;
                  })()}
                  ${otherNetworksHtml}
                </div>
              </div>
              <div class="tree-row-actions">
                <button type="button" class="btn-tree-action action-call" data-action="call-proposal" data-node-id="${node.id}" title="${callBtnTitle}">📞</button>
                <button type="button" class="btn-tree-action" data-action="edit-node" data-node-id="${node.id}" title="${editContactTitle}">✏️</button>
                <button type="button" class="btn-tree-action action-del" data-action="delete-node" data-node-id="${node.id}" title="${delContactTitle}">🗑️</button>
              </div>
            </div>
          </div>
        `;
      }
    }

    const html = contactsTree.map(n => renderNode(n, 1)).join("");
    if (contactsCountBadge && !isAllStarNodesActive() && !isYsfRoomsActive()) {
      contactsCountBadge.textContent = visibleContactsCount;
    }

    if (!html) {
      const netLabel = getNetworkBadgeLabel(activeNet);
      const emptyContactsHtml = q
        ? escapeHtml(window.t ? window.t("contacts.not_found_query", { query: q }, `Nothing found for "${q}"`) : `Nothing found for "${q}"`)
        : (window.t ? window.t("contacts.empty_net_contacts", { net: escapeHtml(netLabel) }, `No entries in <strong>${escapeHtml(netLabel)}</strong> contacts yet.<br><span style="font-size:0.78rem;color:#64748b;">Click «+ Contact» above to add the first entry.</span>`) : `No entries in <strong>${escapeHtml(netLabel)}</strong> contacts yet.`);
      contactsTreeContainer.innerHTML = `
        <div style="text-align:center;padding:30px 10px;color:#8b949e;">
          <span style="font-size:2rem;display:block;margin-bottom:8px;">📭</span>
          ${emptyContactsHtml}
        </div>
      `;
    } else {
      contactsTreeContainer.innerHTML = html;
    }
  }

  // Open Contact Edit Modal
  let editingNodeId = null;
  let editingParentId = null;
  let isEditingFolder = false;

let _crossCallsignLookupTimer = null;

export function updateContactEditCrossNetworksPreview(callsignVal, excludeNodeId = null) {
  const crossBox = document.getElementById("contactEditCrossNetworksBox");
  if (!crossBox) return;
  const cs = String(callsignVal || "").trim().toUpperCase();
  if (!cs || cs.length < 3 || isEditingFolder) {
    crossBox.style.display = "none";
    crossBox.innerHTML = "";
    return;
  }
  const activeNet = (contactsActiveNetworkType || "bm").toLowerCase();
  const localOther = collectLocalCrossEntriesByCallsign(cs, activeNet, excludeNodeId);
  const cachedSrv = (contactsCrossCallsigns && contactsCrossCallsigns[cs]) ? contactsCrossCallsigns[cs] : null;
  const localHtml = renderCrossNetworkBadgesHtml(cs, activeNet, {
    nodeIds: {},
    userEntries: localOther.length ? localOther : ((cachedSrv && cachedSrv.user_networks) || []),
    radioidDmr: (cachedSrv && cachedSrv.radioid_dmr) || [],
    allstarNodes: (cachedSrv && cachedSrv.allstar_nodes) || [],
    echolinkNodes: (cachedSrv && cachedSrv.echolink_nodes) || []
  }, true);
  if (localHtml) {
    crossBox.innerHTML = localHtml;
    crossBox.style.display = "block";
  } else {
    crossBox.style.display = "none";
    crossBox.innerHTML = "";
  }

  clearTimeout(_crossCallsignLookupTimer);
  _crossCallsignLookupTimer = setTimeout(async () => {
    try {
      const resp = await fetch(`/api/contacts/cross-callsign?callsign=${encodeURIComponent(cs)}`);
      if (!resp.ok) return;
      const json = await resp.json();
      if (!json || json.status !== "ok" || !json.data) return;
      contactsCrossCallsigns[cs] = json.data;
      if (contactEditCallsign && contactEditCallsign.value.trim().toUpperCase() !== cs) return;
      const srvOther = (json.data.user_networks || []).filter(e => String(e.network_type || "").toLowerCase() !== activeNet);
      const mergedUser = localOther.length ? localOther : srvOther;
      const fullHtml = renderCrossNetworkBadgesHtml(cs, activeNet, {
        nodeIds: {},
        userEntries: mergedUser,
        radioidDmr: json.data.radioid_dmr || [],
        allstarNodes: json.data.allstar_nodes || [],
        echolinkNodes: json.data.echolink_nodes || []
      }, true);
      if (fullHtml) {
        crossBox.innerHTML = fullHtml;
        crossBox.style.display = "block";
      }
      // Auto-suggest blank fields from RadioID / other phonebooks without overwriting user input
      if (!editingNodeId && activeNet !== "allstar" && contactEditDmrId && !contactEditDmrId.value.trim() && json.data.radioid_dmr && json.data.radioid_dmr.length > 0) {
        contactEditDmrId.value = String(json.data.radioid_dmr[0].radio_id || "");
      }
      if (!editingNodeId && contactEditName && !contactEditName.value.trim()) {
        const refName = (mergedUser[0] && mergedUser[0].name) || (json.data.radioid_dmr && json.data.radioid_dmr[0] && json.data.radioid_dmr[0].name) || "";
        if (refName) contactEditName.value = refName;
      }
      if (!editingNodeId && contactEditCity && !contactEditCity.value.trim()) {
        const rid0 = json.data.radioid_dmr && json.data.radioid_dmr[0];
        const refCity = (mergedUser[0] && mergedUser[0].city) || (rid0 ? [rid0.city, rid0.country].filter(Boolean).join(", ") : "");
        if (refCity) contactEditCity.value = refCity;
      }
    } catch (_) {}
  }, 220);
}

export function openContactEditModal(nodeToEdit = null, parentId = null, forcedType = "person", contextOpts = null) {
    ensureElements();
    editingNodeId = nodeToEdit ? nodeToEdit.id : null;
    editingParentId = parentId || null;

    if (contextOpts && typeof contextOpts === "object") {
      if (contextOpts.hotspotId) {
        contactsActiveHotspotId = resolveHotspotId(contextOpts.hotspotId);
      }
      if (contextOpts.network_type) {
        contactsActiveNetworkType = String(contextOpts.network_type).trim().toLowerCase();
      } else if (contextOpts.hotspotId) {
        contactsActiveNetworkType = resolveHotspotNetworkType(contactsActiveHotspotId);
      }
      updateContactsNetFilterHeaderUI();
    } else if (nodeToEdit) {
      contactsActiveNetworkType = resolveNodeNetworkType(nodeToEdit);
      updateContactsNetFilterHeaderUI();
    } else if (typeof window !== "undefined" && window.activeHotspotId && (!myContactsModal || !myContactsModal.classList.contains("active"))) {
      contactsActiveHotspotId = resolveHotspotId(window.activeHotspotId);
      contactsActiveNetworkType = resolveHotspotNetworkType(contactsActiveHotspotId);
      updateContactsNetFilterHeaderUI();
    }

    if (contactEditNodeId) contactEditNodeId.value = editingNodeId || "";

    isEditingFolder = nodeToEdit ? nodeToEdit.type === "folder" : forcedType === "folder";

    if (contactEditModalTitle) {
      contactEditModalTitle.textContent = nodeToEdit
        ? (isEditingFolder ? (window.t ? window.t("contacts.edit_folder", {}, "Редактировать папку") : "Редактировать папку") : (window.t ? window.t("contacts.edit_contact", {}, "Редактировать контакт") : "Редактировать контакт"))
        : (isEditingFolder ? (window.t ? window.t("contacts.new_folder", {}, "Новая папка") : "Новая папка") : (window.t ? window.t("contacts.new_contact", {}, "Новый контакт") : "Новый контакт"));
    }
    if (contactEditModalIcon) {
      contactEditModalIcon.textContent = isEditingFolder ? "📁" : "📒";
    }

    const defaultNet = (nodeToEdit ? resolveNodeNetworkType(nodeToEdit) : (contactsActiveNetworkType || "bm")).toLowerCase();
    const editNetBadge = document.getElementById("contactEditActiveNetBadge");
    if (editNetBadge) {
      editNetBadge.textContent = getNetworkBadgeLabel(defaultNet);
      editNetBadge.className = `contact-net-badge net-${defaultNet}`;
    }

    const contactTypeSelectGroup = document.getElementById("contactTypeSelectGroup");
    if (contactTypeSelectGroup) {
      contactTypeSelectGroup.style.display = isEditingFolder ? "none" : "block";
    }

    // Populate Parent Select strictly filtered to target network (Max 3 levels depth check)
    if (contactEditParentSelect) {
      contactEditParentSelect.innerHTML = `<option value="">${window.t ? window.t("contacts.root_level", {}, "📁 [Корневой уровень]") : "📁 [Корневой уровень]"}</option>`;
      function addFolderOptions(nodes, depth = 1) {
        for (const n of nodes) {
          if (n.type === "folder") {
            if (nodeToEdit && n.id === nodeToEdit.id) continue;
            if (!nodeMatchesNetworkContext(n, defaultNet)) continue;
            const opt = document.createElement("option");
            opt.value = n.id;
            opt.textContent = `${"— ".repeat(depth - 1)}📁 ${getLocalizedContactName(n)}`;
            if (isEditingFolder && depth >= 2) {
              opt.disabled = true;
              opt.textContent += " " + (window.t ? window.t("contacts.max_depth_note", {}, "(макс. глубина для подпапок)") : "(макс. глубина для подпапок)");
            }
            contactEditParentSelect.appendChild(opt);
            if (n.children) addFolderOptions(n.children, depth + 1);
          }
        }
      }
      addFolderOptions(contactsTree, 1);

      if (nodeToEdit) {
        const parent = findParentNodeInTree(contactsTree, nodeToEdit.id);
        contactEditParentSelect.value = parent ? parent.id : "";
      } else if (editingParentId) {
        contactEditParentSelect.value = editingParentId;
      } else {
        contactEditParentSelect.value = "";
      }
    }

    // Reset hints & cross-network preview
    const mergeHintEl = document.getElementById("contactEditCallsignMergeHint");
    if (mergeHintEl) {
      mergeHintEl.style.display = "none";
      mergeHintEl.textContent = "";
    }
    const crossBoxEl = document.getElementById("contactEditCrossNetworksBox");
    if (crossBoxEl) {
      crossBoxEl.style.display = "none";
      crossBoxEl.innerHTML = "";
    }

    // Lock network strictly to the target hotspot's network
    if (contactEditNetwork) {
      contactEditNetwork.value = defaultNet;
    }

    // Set type radio
    let activeType = nodeToEdit ? nodeToEdit.type : (forcedType === "folder" ? "person" : forcedType);
    if (!nodeToEdit && forcedType === "person") {
      activeType = "person";
    }
    if (!nodeToEdit && defaultNet === "ysf" && activeType === "tg") {
      activeType = "person";
    }
    const typeRadios = document.querySelectorAll('input[name="contactNodeType"]');
    typeRadios.forEach(r => {
      r.checked = (r.value === activeType);
    });

    const personIds = (nodeToEdit && nodeToEdit.type === "person") ? getPersonIdentities(nodeToEdit) : {};
    const personAslInp = document.getElementById("contactEditPersonAslNode");
    const personEchoInp = document.getElementById("contactEditPersonEcholinkNode");

    // Populate fields
    if (contactEditName) contactEditName.value = nodeToEdit ? (nodeToEdit.name || "") : "";
    if (contactEditCallsign) contactEditCallsign.value = nodeToEdit ? (nodeToEdit.callsign || "") : "";
    if (contactEditDmrId) contactEditDmrId.value = nodeToEdit ? (personIds.dmr_id || nodeToEdit.dmr_id || "") : "";
    if (personAslInp) personAslInp.value = nodeToEdit ? (personIds.allstar_node || "") : "";
    if (personEchoInp) personEchoInp.value = nodeToEdit ? (personIds.echolink_node || "") : "";
    if (contactEditTg) contactEditTg.value = nodeToEdit ? (nodeToEdit.tg || "") : "";
    if (contactEditAllStarNode) contactEditAllStarNode.value = nodeToEdit ? (nodeToEdit.node_number || nodeToEdit.allstar_node || "") : "";
    if (contactEditAllStarMode) contactEditAllStarMode.value = nodeToEdit ? (nodeToEdit.link_mode || "*3") : "*3";
    if (contactEditCity) contactEditCity.value = nodeToEdit ? (nodeToEdit.city || "") : "";
    if (contactEditSlot) contactEditSlot.value = nodeToEdit ? (nodeToEdit.slot_override || 0) : 0;
    if (contactEditComment) contactEditComment.value = nodeToEdit ? (nodeToEdit.comment || "") : "";

    if (contactEditXlxModule) {
      if (nodeToEdit && nodeToEdit.network_type === "xlx" && nodeToEdit.type === "tg" && nodeToEdit.tg) {
        contactEditXlxModule.value = String(nodeToEdit.tg);
      } else {
        contactEditXlxModule.value = "4004";
      }
    }

    updateContactFormFieldsVisibility(activeType);
    if (nodeToEdit && nodeToEdit.callsign) {
      updateContactEditCrossNetworksPreview(nodeToEdit.callsign, nodeToEdit.id);
    }

    if (contactEditModal) {
      contactEditModal.classList.add("active");
      setTimeout(() => {
        if (activeType === "person" && contactEditCallsign) contactEditCallsign.focus();
        else if (contactEditName) contactEditName.focus();
      }, 60);
    }
  }

export function findPersonByCallsignInTree(nodes, callsign, excludeId = null, targetNet = null) {
  if (!Array.isArray(nodes) || !callsign) return null;
  const targetCs = String(callsign).trim().toUpperCase();
  if (!targetCs) return null;
  const cleanTargetNet = targetNet ? String(targetNet).trim().toLowerCase() : null;
  for (const n of nodes) {
    if (n.type === "person" && n.id !== excludeId && String(n.callsign || "").trim().toUpperCase() === targetCs) {
      if (!cleanTargetNet || resolveNodeNetworkType(n) === cleanTargetNet) {
        return n;
      }
    }
    if (n.children) {
      const found = findPersonByCallsignInTree(n.children, targetCs, excludeId, cleanTargetNet);
      if (found) return found;
    }
  }
  return null;
}

export function updateContactFormFieldsVisibility(type) {
    const isFolder = isEditingFolder || type === "folder";
    const curNet = (contactsActiveNetworkType || "bm").toLowerCase();
    if (contactEditNetwork) contactEditNetwork.value = curNet;

    const isPerson = !isFolder && type === "person";
    const isTg = !isFolder && type === "tg";
    const isRepeater = !isFolder && type === "repeater";
    const isAllStarNode = !isFolder && type === "allstar_node";
    const isAslMacro = !isFolder && type === "asl_macro";

    // Filter visible entity type options strictly for the active hotspot's network
    const optTg = document.getElementById("contactTypeOptTg");
    const boxTg = document.getElementById("contactTypeBoxTg");
    const optRepeater = document.getElementById("contactTypeOptRepeater");
    const optAllStar = document.getElementById("contactTypeOptAllStar");
    const optAslMacro = document.getElementById("contactTypeOptAslMacro");

    if (optTg) optTg.style.display = (curNet === "allstar" || curNet === "ysf") ? "none" : "";
    if (boxTg) {
      boxTg.textContent = (curNet === "xlx")
        ? (window.t ? window.t("contacts.type_xlx", {}, "🧩 Модуль XLX") : "🧩 Модуль XLX")
        : (window.t ? window.t("contacts.type_tg", {}, "🎯 TalkGroup") : "🎯 TalkGroup");
    }
    if (optRepeater) optRepeater.style.display = (curNet === "allstar" || curNet === "ysf") ? "none" : "";
    if (optAllStar) optAllStar.style.display = (curNet === "allstar") ? "" : "none";
    if (optAslMacro) optAslMacro.style.display = (curNet === "allstar") ? "" : "none";

    const nameLabel = document.getElementById("contactEditNameLabel");
    if (nameLabel) {
      if (isFolder) {
        nameLabel.innerHTML = window.t
          ? window.t("contacts.folder_name_label", {}, "Название папки <span class=\"req-star\">*</span>:")
          : "Название папки <span class=\"req-star\">*</span>:";
      } else {
        const text = window.t
          ? window.t("contacts.name_or_desc_label", {}, "Имя / Описание")
          : "Имя / Описание";
        nameLabel.innerHTML = `${text} <span class="req-star">*</span>:`;
      }
    }

    const callGroup = document.getElementById("contactEditCallsignGroup");
    const idGroup = document.getElementById("contactEditDmrIdGroup");
    const personExtraGroup = document.getElementById("contactEditPersonExtraIdsGroup");
    const tgGroup = document.getElementById("contactEditTgGroup");
    const allstarNodeGroup = document.getElementById("contactEditAllStarNodeGroup");
    const allstarNodeLabel = document.getElementById("contactEditAllStarNodeLabel");
    const allstarModeGroup = document.getElementById("contactEditAllStarModeGroup");
    const cityGroup = document.getElementById("contactEditCityGroup");
    const slotGroup = document.getElementById("contactEditSlotGroup");
    const commentGroup = document.getElementById("contactEditCommentGroup");
    const netGroup = document.getElementById("contactEditNetworkGroup");

    // Never allow switching network inside a hotspot's Contacts window
    if (netGroup) netGroup.style.display = "none";
    if (callGroup) callGroup.style.display = (isPerson || isRepeater || isAllStarNode) ? "block" : "none";
    if (idGroup) idGroup.style.display = ((isPerson && curNet !== "allstar") || isRepeater) ? "block" : "none";
    if (personExtraGroup) personExtraGroup.style.display = isPerson ? "block" : "none";
    if (tgGroup) tgGroup.style.display = isTg ? "block" : "none";
    if (allstarNodeGroup) allstarNodeGroup.style.display = (isAllStarNode || isAslMacro) ? "block" : "none";
    if (allstarNodeLabel) {
      if (isAslMacro) {
        const cmdTxt = window.t
          ? window.t("contacts.allstar_cmd_label", {}, "Команда DTMF (например *70, *81)")
          : "Команда DTMF (например *70, *81)";
        allstarNodeLabel.innerHTML = `${cmdTxt} <span class="req-star">*</span>:`;
      } else {
        const nodeTxt = window.t
          ? window.t("contacts.allstar_node_label", {}, "Номер ноды AllStarLink")
          : "Номер ноды AllStarLink";
        allstarNodeLabel.innerHTML = `${nodeTxt} <span class="req-star">*</span>:`;
      }
    }
    if (allstarModeGroup) allstarModeGroup.style.display = isAllStarNode ? "block" : "none";
    if (cityGroup) cityGroup.style.display = (isFolder || isAslMacro) ? "none" : "block";
    if (slotGroup) slotGroup.style.display = (isFolder || isAllStarNode || isAslMacro || curNet === "allstar" || curNet === "ysf") ? "none" : "block";
    if (commentGroup) commentGroup.style.display = isFolder ? "none" : "block";

    const isXlx = (curNet === "xlx");
    const isTgif = (curNet === "tgif");
    const isDmrPlus = (curNet === "dmrplus");

    if (contactEditXlxModuleGroup) {
      contactEditXlxModuleGroup.style.display = (!isFolder && isXlx && isTg) ? "block" : "none";
    }

    if (contactEditSlot) {
      if (!isFolder && isXlx) {
        contactEditSlot.value = "2";
        contactEditSlot.disabled = true;
      } else {
        contactEditSlot.disabled = false;
      }
    }

    if (contactEditSlotHint) {
      if (!isFolder && isXlx) {
        contactEditSlotHint.textContent = window.t
          ? window.t("contacts.xlx_slot_locked_note", {}, "(в XLX только TS2)")
          : "(в XLX только TS2)";
        contactEditSlotHint.style.display = "block";
      } else {
        contactEditSlotHint.style.display = "none";
      }
    }

    if (contactEditIdHint) {
      if (!isFolder && isXlx && (isPerson || isRepeater)) {
        contactEditIdHint.textContent = window.t
          ? window.t("contacts.xlx_id_hint", {}, "7-значный DMR ID радиолюбителя для валидации в XLX")
          : "7-значный DMR ID радиолюбителя для валидации в XLX";
        contactEditIdHint.style.display = "block";
      } else {
        contactEditIdHint.style.display = "none";
      }
    }

    if (contactEditTgHint) {
      if (!isFolder && isTg) {
        if (isTgif) {
          contactEditTgHint.textContent = window.t
            ? window.t("contacts.tgif_hint", {}, "В TGIF слот по умолчанию TS2. Отключение динамической группы — TG 4000.")
            : "В TGIF слот по умолчанию TS2. Отключение динамической группы — TG 4000.";
          contactEditTgHint.style.display = "block";
        } else if (isDmrPlus) {
          contactEditTgHint.textContent = window.t
            ? window.t("contacts.dmrplus_hint", {}, "В DMR+ рефлекторы 4xxx работают на TS2. Для TS1 используйте StartRef.")
            : "В DMR+ рефлекторы 4xxx работают на TS2. Для TS1 используйте StartRef.";
          contactEditTgHint.style.display = "block";
        } else {
          contactEditTgHint.style.display = "none";
        }
      } else {
        contactEditTgHint.style.display = "none";
      }
    }
  }

export function closeContactEditModal() {
    if (contactEditModal && contactEditModal.classList.contains("active")) {
      contactEditModal.classList.remove("active");
    }
  }
  window.closeContactEditModal = closeContactEditModal;

export function saveContactFromForm() {
    const alertTitle = window.t ? window.t("contacts.title", {}, "Contacts") : "Contacts";
    const name = contactEditName ? contactEditName.value.trim() : "";
    if (!name) {
      const errMsg = window.t
        ? window.t("contacts.err_name_required", {}, "Please enter a name or title!")
        : "Please enter a name or title!";
      if (window.showAppAlert) {
        window.showAppAlert(errMsg, { title: alertTitle, icon: "⚠️" });
      } else {
        alert(errMsg);
      }
      if (contactEditName) contactEditName.focus();
      return;
    }

    let type = "person";
    if (isEditingFolder) {
      type = "folder";
    } else {
      const typeRadio = document.querySelector('input[name="contactNodeType"]:checked');
      type = typeRadio ? typeRadio.value : "person";
    }
    const parentId = contactEditParentSelect ? contactEditParentSelect.value : "";

    let netVal = (contactsActiveNetworkType || "bm").toLowerCase();
    if (type === "allstar_node" || type === "asl_macro") {
      netVal = "allstar";
    }

    let tgVal = null;
    let dmrIdVal = null;
    let callsignVal = contactEditCallsign ? contactEditCallsign.value.trim().toUpperCase() : "";
    let nodeNumberVal = null;
    let linkModeVal = "*3";
    let cityVal = contactEditCity ? contactEditCity.value.trim() : "";
    let commentVal = contactEditComment ? contactEditComment.value.trim() : "";
    let slotVal = contactEditSlot ? parseInt(contactEditSlot.value, 10) : 0;
    if (netVal === "xlx") {
      slotVal = 2;
    } else if (netVal === "allstar") {
      slotVal = 0;
    }

    const personAslInp = document.getElementById("contactEditPersonAslNode");
    const personEchoInp = document.getElementById("contactEditPersonEcholinkNode");
    const personAslVal = personAslInp ? personAslInp.value.trim() : "";
    const personEchoVal = personEchoInp ? personEchoInp.value.trim() : "";

    if (type === "allstar_node" || type === "asl_macro") {
      nodeNumberVal = contactEditAllStarNode ? contactEditAllStarNode.value.trim() : "";
      linkModeVal = (type === "asl_macro") ? "dtmf" : (contactEditAllStarMode ? contactEditAllStarMode.value : "*3");
      if (!nodeNumberVal) {
        const errMsg = type === "asl_macro"
          ? (window.t ? window.t("contacts.err_dtmf_required", {}, "Please enter a DTMF command (e.g. *70)!") : "Please enter a DTMF command (e.g. *70)!")
          : (window.t ? window.t("contacts.err_allstar_node_required", {}, "Please specify the AllStarLink node number!") : "Please specify the AllStarLink node number!");
        if (window.showAppAlert) {
          window.showAppAlert(errMsg, { title: alertTitle, icon: "⚠️" });
        } else {
          alert(errMsg);
        }
        if (contactEditAllStarNode) contactEditAllStarNode.focus();
        return;
      }
    } else if (type === "tg") {
      tgVal = contactEditTg ? parseInt(contactEditTg.value.trim(), 10) : null;
      if (!tgVal || tgVal <= 0) {
        const errMsg = window.t ? window.t("contacts.err_tg_required", {}, "Please enter a valid TalkGroup (TG) number!") : "Please enter a valid TalkGroup (TG) number!";
        if (window.showAppAlert) {
          window.showAppAlert(errMsg, { title: alertTitle, icon: "⚠️" });
        } else {
          alert(errMsg);
        }
        if (contactEditTg) contactEditTg.focus();
        return;
      }
    } else if (type === "person") {
      dmrIdVal = contactEditDmrId ? parseInt(contactEditDmrId.value.trim(), 10) : null;
      if (!callsignVal && !dmrIdVal && !personAslVal && !personEchoVal) {
        const errMsg = window.t ? window.t("contacts.err_person_id_or_call", {}, "Please enter a callsign and at least one network ID (DMR ID or AllStarLink node)!") : "Please enter a callsign and at least one network ID (DMR ID or AllStarLink node)!";
        if (window.showAppAlert) {
          window.showAppAlert(errMsg, { title: alertTitle, icon: "⚠️" });
        } else {
          alert(errMsg);
        }
        if (contactEditCallsign) contactEditCallsign.focus();
        return;
      }
    } else if (type === "repeater") {
      dmrIdVal = contactEditDmrId ? parseInt(contactEditDmrId.value.trim(), 10) : null;
      if (!dmrIdVal && !callsignVal) {
        const errMsg = window.t ? window.t("contacts.err_repeater_id_or_call", {}, "Please enter a repeater ID or callsign!") : "Please enter a repeater ID or callsign!";
        if (window.showAppAlert) {
          window.showAppAlert(errMsg, { title: alertTitle, icon: "⚠️" });
        } else {
          alert(errMsg);
        }
        if (contactEditDmrId) contactEditDmrId.focus();
        return;
      }
    }

    // Auto-merge by Callsign strictly within the SAME network phonebook (never merge across BM/ADN/FreeDMR/etc.)
    if (!editingNodeId && type === "person" && callsignVal) {
      const existingPerson = findPersonByCallsignInTree(contactsTree, callsignVal, null, netVal);
      if (existingPerson) {
        editingNodeId = existingPerson.id;
      }
    }

    if (editingNodeId) {
      const node = findNodeInTree(contactsTree, editingNodeId);
      if (node) {
        node.name = name || node.name;
        node.type = type;
        if (type === "allstar_node" || type === "asl_macro") {
          node.node_number = nodeNumberVal;
          node.link_mode = linkModeVal;
          node.callsign = callsignVal;
          delete node.dmr_id;
          delete node.tg;
        } else if (type === "tg") {
          node.tg = tgVal;
          delete node.dmr_id;
          delete node.callsign;
          delete node.node_number;
          delete node.link_mode;
        } else if (type === "person") {
          const prevIds = getPersonIdentities(node);
          const mergedIds = Object.assign({}, prevIds);
          if (dmrIdVal) mergedIds.dmr_id = dmrIdVal;
          else if (contactEditDmrId && !contactEditDmrId.value.trim()) delete mergedIds.dmr_id;
          if (personAslVal) mergedIds.allstar_node = personAslVal;
          else if (personAslInp && !personAslInp.value.trim()) delete mergedIds.allstar_node;
          if (personEchoVal) mergedIds.echolink_node = personEchoVal;
          else if (personEchoInp && !personEchoInp.value.trim()) delete mergedIds.echolink_node;

          node.callsign = callsignVal;
          node.identities = mergedIds;
          if (mergedIds.dmr_id) node.dmr_id = mergedIds.dmr_id;
          else delete node.dmr_id;
          if (mergedIds.allstar_node) node.allstar_node = mergedIds.allstar_node;
          else delete node.allstar_node;
          delete node.tg;
        } else if (type === "repeater") {
          node.callsign = callsignVal;
          node.dmr_id = dmrIdVal;
          delete node.tg;
          delete node.node_number;
          delete node.link_mode;
        }
        if (cityVal) node.city = cityVal;
        if (commentVal) node.comment = commentVal;
        node.slot_override = slotVal;
        node.network_type = netVal;

        const oldParent = findParentNodeInTree(contactsTree, editingNodeId);
        const oldParentId = oldParent ? oldParent.id : "";
        if (parentId && oldParentId !== parentId) {
          removeNodeFromTree(contactsTree, editingNodeId);
          const newParent = findNodeInTree(contactsTree, parentId);
          if (newParent) {
            if (!Array.isArray(newParent.children)) newParent.children = [];
            newParent.children.push(node);
          } else {
            contactsTree.push(node);
          }
        }
      }
    } else {
      const newNode = {
        id: "c_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        type: type,
        name: name,
        city: cityVal,
        comment: commentVal,
        slot_override: slotVal,
        network_type: netVal
      };

      if (type === "folder") {
        newNode.collapsed = false;
        newNode.children = [];
      } else if (type === "allstar_node" || type === "asl_macro") {
        newNode.node_number = nodeNumberVal;
        newNode.link_mode = linkModeVal;
        newNode.callsign = callsignVal;
      } else if (type === "tg") {
        newNode.tg = tgVal;
      } else if (type === "person") {
        const identities = {};
        if (dmrIdVal) identities.dmr_id = dmrIdVal;
        if (personAslVal) identities.allstar_node = personAslVal;
        if (personEchoVal) identities.echolink_node = personEchoVal;
        newNode.callsign = callsignVal;
        newNode.identities = identities;
        if (dmrIdVal) newNode.dmr_id = dmrIdVal;
        if (personAslVal) newNode.allstar_node = personAslVal;
      } else {
        newNode.callsign = callsignVal;
        newNode.dmr_id = dmrIdVal;
      }

      if (parentId) {
        const parent = findNodeInTree(contactsTree, parentId);
        if (parent) {
          if (!Array.isArray(parent.children)) parent.children = [];
          parent.children.push(newNode);
        } else {
          contactsTree.push(newNode);
        }
      } else {
        contactsTree.push(newNode);
      }
    }

    closeContactEditModal();
    saveContactsToServer();
    renderContactsTree(contactsSearchInput ? contactsSearchInput.value.trim() : "");
    showToast(window.t ? window.t("contacts.saved_toast", { name }, `✅ Entry «${name}» saved!`) : `✅ Entry «${name}» saved!`, 2000);
    if (typeof refreshQuickAssignContactUI === "function") {
      refreshQuickAssignContactUI();
    }
  }

export async function deleteContactNode(id) {
    const node = findNodeInTree(contactsTree, id);
    if (!node) return;
    const isFolder = node.type === "folder";
    const msg = isFolder
      ? (window.t ? window.t("contacts.confirm_del_folder", { name: node.name }, `Вы действительно хотите удалить папку «${node.name}» со всем ее содержимым?`) : `Вы действительно хотите удалить папку «${node.name}» со всем ее содержимым?`)
      : (window.t ? window.t("contacts.confirm_del_contact", { name: node.name }, `Удалить контакт «${node.name}»?`) : `Удалить контакт «${node.name}»?`);
    const delTitle = isFolder
      ? (window.t ? window.t("contacts.title_del_folder", {}, "Удаление папки") : "Удаление папки")
      : (window.t ? window.t("contacts.title_del_contact", {}, "Удаление контакта") : "Удаление контакта");
    const confirmBtn = window.t ? window.t("common.delete", {}, "Удалить") : "Удалить";
    const ok = await (window.showAppConfirm ? window.showAppConfirm({
      title: delTitle,
      icon: "🗑️",
      message: msg,
      confirmText: confirmBtn,
      confirmStyle: "danger"
    }) : Promise.resolve(confirm(msg)));
    if (!ok) return;

    removeNodeFromTree(contactsTree, id);
    saveContactsToServer();
    renderContactsTree(contactsSearchInput ? contactsSearchInput.value.trim() : "");
    showToast(window.t ? window.t("contacts.deleted_toast", {}, "🗑️ Запись удалена") : "🗑️ Запись удалена", 2000);
    if (typeof refreshQuickAssignContactUI === "function") {
      refreshQuickAssignContactUI();
    }
  }

  // Call Proposal Dialog -> Unified into Direct Call Modal
export function openContactCallProposal(node, forcedNet = null) {
    ensureElements();
    if (!node) return;
    currentProposalNode = node;

    const effectiveNet = (forcedNet || contactsActiveNetworkType || "bm").toLowerCase();
    const personIds = (node.type === "person") ? getPersonIdentities(node) : {};
    const isAllStarCall = (
      node.type === "allstar_node" ||
      node.type === "asl_macro" ||
      (node.type === "person" && effectiveNet === "allstar" && (personIds.allstar_node || personIds.echolink_node)) ||
      (node.network_type === "allstar" && node.type !== "person")
    );

    if (isAllStarCall) {
      const rawNodeNum = (node.type === "person")
        ? String(personIds.allstar_node || personIds.echolink_node || "").trim()
        : String(node.node_number || node.allstar_node || node.tg || "").trim();
      if (!rawNodeNum) return;
      const isDtmfMacro = (node.type === "asl_macro" || node.link_mode === "dtmf" || rawNodeNum.startsWith("*"));
      const linkMode = isDtmfMacro ? "dtmf" : (node.link_mode || "*3");

      const allHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.length) ? window.currentHotspots : [];
      const aslHs = allHs.find(h => String(h.id) === String(contactsActiveHotspotId) && (h.network_type || "").toLowerCase() === "allstar")
                 || allHs.find(h => (h.network_type || "").toLowerCase() === "allstar" && (typeof isHotspotFullyOnline === "function" ? isHotspotFullyOnline(h) : true))
                 || allHs.find(h => (h.network_type || "").toLowerCase() === "allstar")
                 || allHs[0];
      const targetHid = aslHs ? aslHs.id : (window.activeHotspotId || "default");

      if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        if (isDtmfMacro) {
          window.ws.send(JSON.stringify({
            type: "allstar_dtmf",
            hotspot_id: targetHid,
            digits: rawNodeNum
          }));
          showToast(window.t ? window.t("contacts.dtmf_sent_toast", { cmd: rawNodeNum }, `⌨️ Sent DTMF command ${rawNodeNum}`) : `⌨️ Sent DTMF command ${rawNodeNum}`, 2200);
        } else {
          window.ws.send(JSON.stringify({
            type: "allstar_connect_node",
            hotspot_id: targetHid,
            node: rawNodeNum,
            mode: linkMode
          }));
          const modeLabel = (linkMode === "*1" || linkMode === "*2") ? "Monitor" : "Transceive";
          showToast(window.t ? window.t("contacts.allstar_connecting_toast", { node: rawNodeNum, mode: modeLabel }, `📻 Connecting to ASL node #${rawNodeNum} (${modeLabel})...`) : `📻 Connecting to ASL node #${rawNodeNum} (${modeLabel})...`, 2500);
        }
        closeMyContactsModal();
      }
      return;
    }

    const isTg = node.type === "tg";
    const isRepeater = node.type === "repeater";
    const dmrTargetId = (node.type === "person") ? (personIds.dmr_id || node.dmr_id) : (node.dmr_id || node.tg);
    const targetVal = isTg ? parseInt(node.tg || node.dmr_id, 10) : parseInt(dmrTargetId, 10);
    if (!targetVal || targetVal <= 0) return;

    const nodeNet = String(forcedNet || node.network_type || contactsActiveNetworkType || "bm").toLowerCase();
    let targetSlot = (node.slot_override === 1 || node.slot_override === 2)
      ? node.slot_override
      : (nodeNet === "bm" && contactsGateway && (contactsGateway.slot === 1 || contactsGateway.slot === 2) ? contactsGateway.slot : undefined);
    let targetHid = (nodeNet === "bm" && contactsGateway && contactsGateway.hotspot_id)
      ? contactsGateway.hotspot_id
      : (contactsActiveHotspotId || window.activeHotspotId || "default");

    // Auto-select hotspot of matching network (prefer currently opened contactsActiveHotspotId if its network matches)
    if (typeof window !== "undefined" && Array.isArray(window.currentHotspots) && window.currentHotspots.length) {
      const activeHs = window.currentHotspots.find(h => resolveHotspotId(h.id) === resolveHotspotId(contactsActiveHotspotId));
      if (activeHs && (activeHs.network_type || "bm").toLowerCase() === nodeNet) {
        targetHid = activeHs.id;
      } else {
        const matchHs = window.currentHotspots.find(h => (h.network_type || "bm").toLowerCase() === nodeNet && isHotspotFullyOnline(h))
                     || window.currentHotspots.find(h => (h.network_type || "bm").toLowerCase() === nodeNet);
        if (matchHs) {
          targetHid = matchHs.id;
        }
      }
    }
    if (nodeNet === "xlx") {
      targetSlot = 2;
    } else if (nodeNet === "dmrplus" && (node.slot_override === 2 || (node.type === "tg" && node.tg >= 4000 && node.tg <= 5000))) {
      targetSlot = 2;
    }

    const displayName = getLocalizedContactName(node) || node.name || "";
    const targetObj = {
      type: (isTg || isRepeater) ? "TG" : "ID",
      value: targetVal,
      callsign: node.callsign || "",
      name: [node.callsign, displayName].filter(Boolean).join(" ").trim() || displayName,
      city: node.city || "",
      hotspotId: targetHid,
      network_type: nodeNet,
      slot: targetSlot
    };

    if (typeof window !== "undefined" && typeof window.openDirectCallModal === "function") {
      window.openDirectCallModal(targetObj);
      return;
    }
  }

export function setProposalSlotUI(slot) {
    selectedProposalSlot = slot;
    if (proposalSlotTs1 && proposalSlotTs2) {
      if (slot === 1) {
        proposalSlotTs1.classList.add("active");
        proposalSlotTs2.classList.remove("active");
      } else {
        proposalSlotTs2.classList.add("active");
        proposalSlotTs1.classList.remove("active");
      }
    }
  }

export function closeContactCallProposalModal() {
    if (contactCallProposalModal && contactCallProposalModal.classList.contains("active")) {
      contactCallProposalModal.classList.remove("active");
    }
  }
  window.closeContactCallProposalModal = closeContactCallProposalModal;

export async function executeProposalApply(shouldStartPtt = false) {
    if (!currentProposalNode) return;
    const node = currentProposalNode;
    const isAllStar = (node.network_type === "allstar" || node.type === "allstar_node");
    if (isAllStar) {
      const nodeNum = String(node.node_number || node.allstar_node || node.tg || "").trim();
      const linkMode = node.link_mode || "*3";
      const rawHid = proposalHotspotSelect ? proposalHotspotSelect.value : selectedProposalHid;
      const cid = typeof resolveHotspotId === "function" ? resolveHotspotId(rawHid) : (rawHid || "default");
      closeContactCallProposalModal();
      closeMyContactsModal();
      if (window.ws && window.ws.readyState === WebSocket.OPEN && nodeNum) {
        window.ws.send(JSON.stringify({
          type: "allstar_connect_node",
          hotspot_id: cid,
          node: nodeNum,
          mode: linkMode
        }));
        const modeLabel = linkMode === "*1" ? "Monitor" : "Transceive";
        showToast(window.t ? window.t("contacts.allstar_connecting_toast", { node: nodeNum, mode: modeLabel }, `📻 Подключение к ASL ноде #${nodeNum} (${modeLabel})...`) : `📻 Подключение к ASL ноде #${nodeNum} (${modeLabel})...`, 2500);
      }
      return;
    }
    const rawHid = proposalHotspotSelect ? proposalHotspotSelect.value : selectedProposalHid;
    const cid = resolveHotspotId(rawHid);
    const slot = (selectedProposalSlot === 1 || selectedProposalSlot === 2) ? selectedProposalSlot : 2;
    const hsName = getHotspotDisplayName(cid);
    const isTg = node.type === "tg";
    const isRepeater = node.type === "repeater";
    const targetVal = isTg ? parseInt(node.tg || node.dmr_id, 10) : parseInt(node.dmr_id || node.tg, 10);

    closeContactCallProposalModal();
    closeMyContactsModal();

    if (targetVal > 0 && typeof window !== "undefined" && typeof window.handleQuickAssignSelect === "function") {
      const displayName = getLocalizedContactName(node) || node.name || "";
      await window.handleQuickAssignSelect(cid, slot, targetVal, hsName, {
        type: (isTg || isRepeater) ? "TG" : "ID",
        value: targetVal,
        callsign: node.callsign || "",
        name: [node.callsign, displayName].filter(Boolean).join(" ").trim() || displayName,
        city: node.city || "",
        hotspotId: cid,
        slot: slot
      });
    }
  }

function serializeContactNodeForNetwork(node, activeNet) {
  if (!node || !nodeMatchesNetworkContext(node, activeNet)) return null;
  const net = (activeNet || "bm").toLowerCase();

  if (node.type === "folder") {
    const children = (Array.isArray(node.children) ? node.children : [])
      .map(ch => serializeContactNodeForNetwork(ch, net))
      .filter(Boolean);
    const folderNet = (node.network_type || "").toLowerCase();
    if (children.length === 0 && folderNet !== net) return null;
    return {
      id: node.id,
      type: "folder",
      name: node.name || "",
      network_type: net,
      collapsed: Boolean(node.collapsed),
      children
    };
  }

  if (net === "allstar") {
    if (node.type === "allstar_node") {
      return {
        id: node.id,
        type: "allstar_node",
        name: node.name || "",
        network_type: "allstar",
        node_number: String(node.node_number || node.allstar_node || "").trim(),
        link_mode: node.link_mode || "*3",
        callsign: node.callsign || "",
        city: node.city || "",
        comment: node.comment || ""
      };
    }
    if (node.type === "asl_macro") {
      return {
        id: node.id,
        type: "asl_macro",
        name: node.name || "",
        network_type: "allstar",
        node_number: String(node.node_number || node.allstar_node || "").trim(),
        link_mode: "dtmf",
        comment: node.comment || ""
      };
    }
    if (node.type === "person") {
      const ids = getPersonIdentities(node);
      const aslIdentities = {};
      if (ids.allstar_node) aslIdentities.allstar_node = String(ids.allstar_node).trim();
      if (ids.echolink_node) aslIdentities.echolink_node = String(ids.echolink_node).trim();
      return {
        id: node.id,
        type: "person",
        name: node.name || "",
        callsign: node.callsign || "",
        network_type: "allstar",
        allstar_node: aslIdentities.allstar_node || "",
        echolink_node: aslIdentities.echolink_node || "",
        identities: aslIdentities,
        city: node.city || "",
        comment: node.comment || ""
      };
    }
    return null;
  }

  if (net === "xlx") {
    if (node.type === "tg") {
      const tgNum = Number(node.tg || 0);
      const modLetter = (tgNum >= 4001 && tgNum <= 4026) ? String.fromCharCode(65 + (tgNum - 4001)) : "";
      return {
        id: node.id,
        type: "tg",
        name: node.name || "",
        network_type: "xlx",
        tg: tgNum,
        module: modLetter,
        slot_override: 2,
        city: node.city || "",
        comment: node.comment || ""
      };
    }
    if (node.type === "person") {
      const ids = getPersonIdentities(node);
      const dmrId = Number(ids.dmr_id || node.dmr_id || 0);
      return {
        id: node.id,
        type: "person",
        name: node.name || "",
        callsign: node.callsign || "",
        network_type: "xlx",
        dmr_id: dmrId,
        identities: { dmr_id: dmrId },
        slot_override: 2,
        city: node.city || "",
        comment: node.comment || ""
      };
    }
    if (node.type === "repeater") {
      return {
        id: node.id,
        type: "repeater",
        name: node.name || "",
        callsign: node.callsign || "",
        network_type: "xlx",
        dmr_id: Number(node.dmr_id || 0),
        slot_override: 2,
        city: node.city || "",
        comment: node.comment || ""
      };
    }
    return null;
  }

  // DMR / YSF networks: bm, adn, tgif, freedmr, dmrplus, ysf, custom
  if (node.type === "tg") {
    return {
      id: node.id,
      type: "tg",
      name: node.name || "",
      network_type: net,
      tg: Number(node.tg || 0),
      slot_override: Number(node.slot_override || 0),
      city: node.city || "",
      comment: node.comment || ""
    };
  }
  if (node.type === "person") {
    const ids = getPersonIdentities(node);
    const dmrId = Number(ids.dmr_id || node.dmr_id || 0);
    return {
      id: node.id,
      type: "person",
      name: node.name || "",
      callsign: node.callsign || "",
      network_type: net,
      dmr_id: dmrId,
      identities: { dmr_id: dmrId },
      slot_override: Number(node.slot_override || 0),
      city: node.city || "",
      comment: node.comment || ""
    };
  }
  if (node.type === "repeater") {
    return {
      id: node.id,
      type: "repeater",
      name: node.name || "",
      callsign: node.callsign || "",
      network_type: net,
      dmr_id: Number(node.dmr_id || 0),
      slot_override: Number(node.slot_override || 0),
      city: node.city || "",
      comment: node.comment || ""
    };
  }
  return null;
}

function normalizeImportedNodeForNetwork(raw, activeNet) {
  if (!raw || typeof raw !== "object") return null;
  const net = (activeNet || "bm").toLowerCase();
  const nodeId = raw.id || ("c_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5));

  if (raw.type === "folder") {
    const children = (Array.isArray(raw.children) ? raw.children : [])
      .map(ch => normalizeImportedNodeForNetwork(ch, net))
      .filter(Boolean);
    return {
      id: nodeId,
      type: "folder",
      name: String(raw.name || (window.t ? window.t("contacts.default_folder_name", {}, "Folder") : "Folder")).trim(),
      network_type: net,
      collapsed: Boolean(raw.collapsed),
      children
    };
  }

  if (net === "allstar") {
    if (raw.type === "allstar_node" || raw.type === "asl_macro") {
      const nodeNum = String(raw.node_number || raw.allstar_node || "").trim();
      if (!nodeNum) return null;
      return {
        id: nodeId,
        type: raw.type,
        name: String(raw.name || nodeNum).trim(),
        network_type: "allstar",
        node_number: nodeNum,
        link_mode: raw.type === "asl_macro" ? "dtmf" : (raw.link_mode || "*3"),
        callsign: raw.type === "asl_macro" ? "" : String(raw.callsign || "").trim().toUpperCase(),
        city: raw.type === "asl_macro" ? "" : String(raw.city || "").trim(),
        comment: String(raw.comment || "").trim(),
        slot_override: 0
      };
    }
    if (raw.type === "person") {
      const rawIds = (raw.identities && typeof raw.identities === "object") ? raw.identities : {};
      const aslNode = String(raw.allstar_node || rawIds.allstar_node || raw.node_number || "").trim();
      const echoNode = String(raw.echolink_node || rawIds.echolink_node || "").trim();
      if (!aslNode && !echoNode) return null;
      const identities = {};
      if (aslNode) identities.allstar_node = aslNode;
      if (echoNode) identities.echolink_node = echoNode;
      return {
        id: nodeId,
        type: "person",
        name: String(raw.name || raw.callsign || aslNode).trim(),
        callsign: String(raw.callsign || "").trim().toUpperCase(),
        network_type: "allstar",
        allstar_node: aslNode || undefined,
        echolink_node: echoNode || undefined,
        identities,
        city: String(raw.city || "").trim(),
        comment: String(raw.comment || "").trim(),
        slot_override: 0
      };
    }
    return null;
  }

  // DMR family (bm, xlx, tgif, freedmr, dmrplus, custom)
  const slotVal = (net === "xlx") ? 2 : ([0, 1, 2].includes(Number(raw.slot_override)) ? Number(raw.slot_override) : 0);

  if (raw.type === "tg") {
    let tgNum = Number(raw.tg || 0);
    if (!tgNum && net === "xlx" && raw.module) {
      const chCode = String(raw.module).trim().toUpperCase().charCodeAt(0);
      if (chCode >= 65 && chCode <= 90) tgNum = 4001 + (chCode - 65);
    }
    if (!tgNum || tgNum <= 0) return null;
    return {
      id: nodeId,
      type: "tg",
      name: String(raw.name || `TG ${tgNum}`).trim(),
      network_type: net,
      tg: tgNum,
      slot_override: slotVal,
      city: String(raw.city || "").trim(),
      comment: String(raw.comment || "").trim()
    };
  }

  if (raw.type === "person") {
    const rawIds = (raw.identities && typeof raw.identities === "object") ? raw.identities : {};
    const dmrId = Number(raw.dmr_id || rawIds.dmr_id || 0);
    const callsign = String(raw.callsign || "").trim().toUpperCase();
    if (!dmrId && !callsign) return null;
    const identities = {};
    if (dmrId > 0) identities.dmr_id = dmrId;
    return {
      id: nodeId,
      type: "person",
      name: String(raw.name || callsign || `ID ${dmrId}`).trim(),
      callsign,
      network_type: net,
      dmr_id: dmrId > 0 ? dmrId : undefined,
      identities,
      slot_override: slotVal,
      city: String(raw.city || "").trim(),
      comment: String(raw.comment || "").trim()
    };
  }

  if (raw.type === "repeater") {
    const dmrId = Number(raw.dmr_id || 0);
    const callsign = String(raw.callsign || "").trim().toUpperCase();
    if (!dmrId && !callsign) return null;
    return {
      id: nodeId,
      type: "repeater",
      name: String(raw.name || callsign || `ID ${dmrId}`).trim(),
      callsign,
      network_type: net,
      dmr_id: dmrId > 0 ? dmrId : undefined,
      slot_override: slotVal,
      city: String(raw.city || "").trim(),
      comment: String(raw.comment || "").trim()
    };
  }

  return null;
}

function pruneNetworkFromTree(nodes, activeNet, preservedCrossNetPersonsMap) {
  if (!Array.isArray(nodes)) return [];
  const net = (activeNet || "bm").toLowerCase();
  const result = [];

  for (const node of nodes) {
    if (!node) continue;

    if (node.type === "folder") {
      const folderNet = (node.network_type || "").toLowerCase();
      const keptChildren = pruneNetworkFromTree(node.children || [], net, preservedCrossNetPersonsMap);
      if (folderNet === net) {
        if (keptChildren.length > 0) {
          result.push(Object.assign({}, node, { children: keptChildren }));
        }
        continue;
      }
      if (keptChildren.length > 0 || (folderNet && folderNet !== net)) {
        result.push(Object.assign({}, node, { children: keptChildren }));
      }
      continue;
    }

    if (node.type === "person") {
      const nodeNet = resolveNodeNetworkType(node);
      const cs = String(node.callsign || "").trim().toUpperCase();
      if (nodeNet === net) {
        if (cs) preservedCrossNetPersonsMap.set(cs, node);
        continue;
      }
      if (cs) preservedCrossNetPersonsMap.set(cs, node);
      result.push(node);
      continue;
    }

    // Non-person leaf nodes (tg, repeater, allstar_node, asl_macro)
    if (nodeMatchesNetworkContext(node, net)) {
      continue;
    }
    result.push(node);
  }

  return result;
}

function enrichImportedPersonsWithCrossNetIds(importedNodes, preservedCrossNetPersonsMap) {
  if (!Array.isArray(importedNodes)) return;
  for (const node of importedNodes) {
    if (!node) continue;
    if (node.type === "folder" && Array.isArray(node.children)) {
      enrichImportedPersonsWithCrossNetIds(node.children, preservedCrossNetPersonsMap);
    } else if (node.type === "person") {
      const cs = String(node.callsign || "").trim().toUpperCase();
      if (cs && preservedCrossNetPersonsMap.has(cs)) {
        const existing = preservedCrossNetPersonsMap.get(cs);
        const mergedIds = Object.assign({}, getPersonIdentities(existing), getPersonIdentities(node));
        node.identities = mergedIds;
        if (mergedIds.dmr_id) node.dmr_id = mergedIds.dmr_id;
        if (mergedIds.allstar_node) node.allstar_node = mergedIds.allstar_node;
        if (mergedIds.echolink_node) node.echolink_node = mergedIds.echolink_node;
      }
    }
  }
}

export function exportContactsToJson() {
    const activeNet = (contactsActiveNetworkType || "bm").toLowerCase();
    const netLabel = getNetworkBadgeLabel(activeNet);
    const exportedContacts = (contactsTree || [])
      .map(n => serializeContactNodeForNetwork(n, activeNet))
      .filter(Boolean);

    const exportData = {
      version: "2.0",
      network_type: activeNet,
      network_label: netLabel,
      exported_at: new Date().toISOString()
    };
    if (activeNet === "bm") {
      exportData.gateway = contactsGateway;
    }
    exportData.contacts = exportedContacts;

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `proxdmr_contacts_${activeNet}_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(
      window.t
        ? `${window.t("contacts.export_json_toast", {}, "📥 Контакты экспортированы в файл JSON")} (${netLabel})`
        : `📥 Контакты ${netLabel} экспортированы в файл JSON`,
      2500
    );
  }

export function handleImportContactsFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const activeNet = (contactsActiveNetworkType || "bm").toLowerCase();
    const activeNetLabel = getNetworkBadgeLabel(activeNet);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        const errTitle = window.t ? window.t("contacts.import_error_title", {}, "Ошибка импорта") : "Ошибка импорта";

        if (parsed && !Array.isArray(parsed) && parsed.network_type) {
          const fileNet = String(parsed.network_type).trim().toLowerCase();
          if (fileNet !== activeNet) {
            const fileNetLabel = getNetworkBadgeLabel(fileNet);
            const mismatchMsg = window.t
              ? window.t("contacts.import_net_mismatch", { file_net: fileNetLabel, active_net: activeNetLabel }, `This contacts file was created for network «${fileNetLabel}», while «${activeNetLabel}» is currently open.\n\nPlease open the matching network contacts or choose a file for «${activeNetLabel}».`)
              : `This contacts file was created for network «${fileNetLabel}», while «${activeNetLabel}» is currently open.\n\nPlease open the matching network contacts or choose a file for «${activeNetLabel}».`;
            if (window.showAppAlert) {
              await window.showAppAlert(mismatchMsg, { title: errTitle, icon: "⚠️" });
            } else {
              alert(mismatchMsg);
            }
            return;
          }
        }

        let rawList = [];
        if (Array.isArray(parsed)) {
          rawList = parsed;
        } else if (parsed && Array.isArray(parsed.contacts)) {
          rawList = parsed.contacts;
        } else {
          const errFormatMsg = window.t ? window.t("contacts.err_json_format", {}, "Неверный формат JSON файла контактов!") : "Неверный формат JSON файла контактов!";
          if (window.showAppAlert) {
            await window.showAppAlert(errFormatMsg, { title: errTitle, icon: "⚠️" });
          } else {
            alert(errFormatMsg);
          }
          return;
        }

        const normalizedList = rawList
          .map(item => normalizeImportedNodeForNetwork(item, activeNet))
          .filter(Boolean);

        const importTitle = `${window.t ? window.t("contacts.import_title", {}, "Импорт контактов") : "Импорт контактов"} (${activeNetLabel})`;
        const importMsg = window.t
          ? window.t("contacts.confirm_import", { count: normalizedList.length }, `Импортировать ${normalizedList.length} разделов/контактов для сети ${activeNetLabel}?\n\nТекущие контакты сети ${activeNetLabel} будут заменены (контакты других сетей сохранятся).`)
          : `Импортировать ${normalizedList.length} разделов/контактов для сети ${activeNetLabel}?\n\nТекущие контакты сети ${activeNetLabel} будут заменены (контакты других сетей сохранятся).`;
        const importBtn = window.t ? window.t("contacts.btn_import", {}, "Импортировать") : "Импортировать";
        const ok = await (window.showAppConfirm ? window.showAppConfirm({
          title: importTitle,
          icon: "📥",
          message: importMsg,
          confirmText: importBtn,
          confirmStyle: "primary"
        }) : Promise.resolve(confirm(importMsg)));

        if (ok) {
          if (activeNet === "bm" && parsed && !Array.isArray(parsed) && parsed.gateway) {
            contactsGateway = parsed.gateway;
            ensureValidContactsGateway();
          }
          const preservedCrossNetPersonsMap = new Map();
          const remainingOtherNetsTree = pruneNetworkFromTree(contactsTree, activeNet, preservedCrossNetPersonsMap);
          enrichImportedPersonsWithCrossNetIds(normalizedList, preservedCrossNetPersonsMap);
          contactsTree = [...remainingOtherNetsTree, ...normalizedList];

          saveContactsToServer();
          renderContactsTree(contactsSearchInput ? contactsSearchInput.value.trim() : "");
          if (activeNet === "bm") {
            updateContactsGatewaySummary();
          }
          showToast(
            window.t
              ? `${window.t("contacts.import_success", {}, "✅ Контакты успешно импортированы!")} (${activeNetLabel})`
              : `✅ Контакты ${activeNetLabel} успешно импортированы!`,
            3000
          );
        }
      } catch (err) {
        const parseErrMsg = window.t ? window.t("contacts.err_json_parse", { error: err.message }, "Ошибка разбора JSON: " + err.message) : "Ошибка разбора JSON: " + err.message;
        const errTitle = window.t ? window.t("contacts.import_error_title", {}, "Ошибка импорта") : "Ошибка импорта";
        if (window.showAppAlert) {
          await window.showAppAlert(parseErrMsg, { title: errTitle, icon: "⚠️" });
        } else {
          alert(parseErrMsg);
        }
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  }

export function initContactsManager() {
  if (isContactsManagerInitialized) return;
  isContactsManagerInitialized = true;
  ensureElements();

    loadContactsLocal();
    loadContactsFromServer();
    try { localStorage.removeItem("proxdmr_ysf_bookmarks"); } catch (_) {}
    loadYsfFavoritesFromServer();
    // Предзагрузка полного каталога YSF с сервера при инициализации менеджера контактов
    if (typeof window !== "undefined" && typeof window.getNetworkServersList === "function") {
      try { window.getNetworkServersList("ysf"); } catch (_) {}
    }

    if (btnContactsGatewayToggle) {
      btnContactsGatewayToggle.addEventListener("click", () => toggleContactsGatewayPanel());
    }
    if (btnSaveContactsGw) {
      btnSaveContactsGw.addEventListener("click", saveContactsGatewayFromUI);
    }
    if (contactsGwSlot1) {
      contactsGwSlot1.addEventListener("click", () => setContactsGwSlotUI(1));
    }
    if (contactsGwSlot2) {
      contactsGwSlot2.addEventListener("click", () => setContactsGwSlotUI(2));
    }

    if (btnAddContactBtn) {
      btnAddContactBtn.addEventListener("click", () => openContactEditModal(null, null, "person"));
    }
    if (btnAddFolderBtn) {
      btnAddFolderBtn.addEventListener("click", () => openContactEditModal(null, null, "folder"));
    }
    if (btnExportContacts) {
      btnExportContacts.addEventListener("click", exportContactsToJson);
    }
    if (btnImportContacts) {
      btnImportContacts.addEventListener("click", () => importContactsFileInput && importContactsFileInput.click());
    }
    if (importContactsFileInput) {
      importContactsFileInput.addEventListener("change", handleImportContactsFile);
    }

    if (closeMyContactsModalBtn) closeMyContactsModalBtn.addEventListener("click", closeMyContactsModal);
    if (btnCloseMyContactsModalBottom) btnCloseMyContactsModalBottom.addEventListener("click", closeMyContactsModal);

    if (closeContactEditModalBtn) closeContactEditModalBtn.addEventListener("click", closeContactEditModal);
    if (btnCancelContactEdit) btnCancelContactEdit.addEventListener("click", closeContactEditModal);
    if (btnSaveContactEdit) btnSaveContactEdit.addEventListener("click", saveContactFromForm);

    if (closeCallProposalModalBtn) closeCallProposalModalBtn.addEventListener("click", closeContactCallProposalModal);
    if (btnProposalApply) btnProposalApply.addEventListener("click", () => executeProposalApply(false));
    if (btnProposalPtt) btnProposalPtt.addEventListener("click", () => executeProposalApply(true));

    if (proposalSlotTs1) proposalSlotTs1.addEventListener("click", () => setProposalSlotUI(1));
    if (proposalSlotTs2) proposalSlotTs2.addEventListener("click", () => setProposalSlotUI(2));

    // AllStarLink Directory Tabs & Search Wiring
    const btnTabDmr = document.getElementById("btnContactsTabDmr");
    const btnTabAsl = document.getElementById("btnContactsTabAllstar");
    const btnTabYsf = document.getElementById("btnContactsTabYsf");
    const btnTabYsfContacts = document.getElementById("btnContactsTabYsfContacts");
    if (btnTabDmr) btnTabDmr.addEventListener("click", () => switchContactsModalTab("dmr"));
    if (btnTabAsl) btnTabAsl.addEventListener("click", () => switchContactsModalTab("allstar"));
    if (btnTabYsf) btnTabYsf.addEventListener("click", () => switchContactsModalTab("ysf"));
    if (btnTabYsfContacts) btnTabYsfContacts.addEventListener("click", () => switchContactsModalTab("ysf_contacts"));

    const aslSearchInp = document.getElementById("aslNodeSearchInput");
    const aslClearBtn = document.getElementById("clearAslNodeSearchBtn");
    let aslSearchTimer = null;
    if (aslSearchInp) {
      aslSearchInp.addEventListener("input", (e) => {
        const val = e.target.value;
        if (aslClearBtn) aslClearBtn.classList.toggle("hidden", !val);
        clearTimeout(aslSearchTimer);
        aslSearchTimer = setTimeout(() => {
          renderAllStarNodesList(val);
        }, 150);
      });
    }

    if (aslClearBtn && aslSearchInp) {
      aslClearBtn.addEventListener("click", () => {
        aslSearchInp.value = "";
        aslClearBtn.classList.add("hidden");
        renderAllStarNodesList("");
        aslSearchInp.focus();
      });
    }

    const ysfSearchInp = document.getElementById("ysfRoomSearchInput");
    const ysfClearBtn = document.getElementById("clearYsfRoomSearchBtn");
    let ysfSearchTimer = null;
    if (ysfSearchInp) {
      ysfSearchInp.addEventListener("input", (e) => {
        const val = e.target.value;
        if (ysfClearBtn) ysfClearBtn.classList.toggle("hidden", !val);
        clearTimeout(ysfSearchTimer);
        ysfSearchTimer = setTimeout(() => {
          renderYsfRoomsList(val);
        }, 150);
      });
    }

    if (ysfClearBtn && ysfSearchInp) {
      ysfClearBtn.addEventListener("click", () => {
        ysfSearchInp.value = "";
        ysfClearBtn.classList.add("hidden");
        renderYsfRoomsList("");
        ysfSearchInp.focus();
      });
    }

    const ysfSortBtns = document.querySelectorAll(".btn-ysf-sort");
    ysfSortBtns.forEach(btn => {
      if (btn._wired) return;
      btn._wired = true;
      btn.addEventListener("click", () => {
        const sortType = btn.dataset.sort;
        if (_ysfSortType === sortType) {
          _ysfSortDir = (_ysfSortDir === "asc") ? "desc" : "asc";
        } else {
          _ysfSortType = sortType;
          _ysfSortDir = "asc";
        }
        _updateYsfSortUi();
        renderYsfRoomsList(ysfSearchInp ? ysfSearchInp.value : "");
      });
    });

    const ysfFilterBtns = document.querySelectorAll(".btn-ysf-type-filter");
    ysfFilterBtns.forEach(btn => {
      if (btn._wiredFilter) return;
      btn._wiredFilter = true;
      btn.addEventListener("click", () => {
        _ysfTypeFilter = btn.dataset.typeFilter || "all";
        _updateYsfTypeFilterUi();
        renderYsfRoomsList(ysfSearchInp ? ysfSearchInp.value : "");
      });
    });

    const btnSyncAsl = document.getElementById("btnSyncAslNodes");
    if (btnSyncAsl && !btnSyncAsl._wired) {
      btnSyncAsl._wired = true;
      btnSyncAsl.addEventListener("click", async () => {
        const icon = document.getElementById("aslSyncIcon");
        const dots = document.getElementById("aslSyncDots");
        const txt = document.getElementById("aslSyncText");
        const totalCountEl = document.getElementById("aslNodesTotalCount");
        if (icon) icon.style.display = "none";
        if (dots) dots.style.display = "inline-block";
        if (txt) txt.textContent = window.t ? window.t("contacts.syncing_status", {}, "Updating...") : "Updating...";
        btnSyncAsl.disabled = true;
        try {
          const res = await fetch("/api/allstar/nodes/sync", { method: "POST" });
          if (res.ok) {
            const data = await res.json();
            const total = data.total || 40995;
            if (totalCountEl) totalCountEl.textContent = Number(total).toLocaleString();
            const badge = document.getElementById("contactsCountBadge");
            if (badge && isAllStarNodesActive()) {
              badge.textContent = Number(total).toLocaleString();
            }
            if (typeof showToast === "function") {
              const msg = window.t ? window.t("contacts.asl_db_updated_toast", { count: Number(total).toLocaleString() }, `✅ База AllStarLink обновлена: ${Number(total).toLocaleString()} узлов`) : `✅ База AllStarLink обновлена: ${Number(total).toLocaleString()} узлов`;
              showToast(msg, "info", 3000);
            }
            const inp = document.getElementById("aslNodeSearchInput");
            renderAllStarNodesList(inp ? inp.value : "");
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch (e) {
          if (typeof showToast === "function") {
            const errMsg = window.t ? window.t("contacts.asl_db_error_toast", {}, "⚠️ Ошибка обновления базы AllStarLink") : "⚠️ Ошибка обновления базы AllStarLink";
            showToast(errMsg, "warning", 3000);
          }
        } finally {
          if (dots) dots.style.display = "none";
          if (icon) icon.style.display = "inline-block";
          if (txt) txt.textContent = window.t ? window.t("contacts.asl_btn_sync", {}, "Обновить базу") : "Обновить базу";
          btnSyncAsl.disabled = false;
        }
      });
    }




    // Outside click dismiss
    if (myContactsModal) {
      myContactsModal.addEventListener("click", (e) => {
        if (e.target === myContactsModal) closeMyContactsModal();
      });
    }
    if (contactEditModal) {
      contactEditModal.addEventListener("click", (e) => {
        if (e.target === contactEditModal) closeContactEditModal();
      });
    }
    if (contactCallProposalModal) {
      contactCallProposalModal.addEventListener("click", (e) => {
        if (e.target === contactCallProposalModal) closeContactCallProposalModal();
      });
    }

    const btnFilterNet = document.getElementById("btnContactsNetFilterToggle");
    if (btnFilterNet && !btnFilterNet._wired) {
      btnFilterNet._wired = true;
      btnFilterNet.addEventListener("click", () => {
        contactsFilterByActiveNet = !contactsFilterByActiveNet;
        updateContactsNetFilterHeaderUI();
        renderContactsTree(contactsSearchInput ? contactsSearchInput.value.trim() : "");
      });
    }

    if (contactEditCallsign && !contactEditCallsign._mergeWired) {
      contactEditCallsign._mergeWired = true;
      contactEditCallsign.addEventListener("input", () => {
        const mergeHintEl = document.getElementById("contactEditCallsignMergeHint");
        const typeRadio = document.querySelector('input[name="contactNodeType"]:checked');
        const curType = typeRadio ? typeRadio.value : "person";
        const curNet = (contactEditNetwork && contactEditNetwork.value) ? contactEditNetwork.value.toLowerCase() : (contactsActiveNetworkType || "bm").toLowerCase();
        const cs = contactEditCallsign.value.trim().toUpperCase();
        if (!isEditingFolder && cs) {
          updateContactEditCrossNetworksPreview(cs, editingNodeId);
        } else {
          updateContactEditCrossNetworksPreview("", editingNodeId);
        }
        if (!mergeHintEl) return;
        if (isEditingFolder || curType !== "person") {
          mergeHintEl.style.display = "none";
          return;
        }
        const existing = cs ? findPersonByCallsignInTree(contactsTree, cs, editingNodeId, curNet) : null;
        if (existing) {
          mergeHintEl.textContent = window.t
            ? window.t("contacts.merge_callsign_hint", { callsign: cs, name: existing.name || cs }, `💡 Callsign ${cs} is already in ${getNetworkShortBadge(curNet)} contacts («${existing.name || cs}»). Saving will update their card in ${getNetworkShortBadge(curNet)}.`)
            : `💡 Callsign ${cs} is already in ${getNetworkShortBadge(curNet)} contacts («${existing.name || cs}»). Saving will update their card in ${getNetworkShortBadge(curNet)}.`;
          mergeHintEl.style.display = "block";
          if (contactEditName && !contactEditName.value.trim() && existing.name) {
            contactEditName.value = existing.name;
          }
          if (contactEditCity && !contactEditCity.value.trim() && existing.city) {
            contactEditCity.value = existing.city;
          }
        } else {
          mergeHintEl.style.display = "none";
        }
      });
    }

    // Type radio change listener in edit form
    const typeRadios = document.querySelectorAll('input[name="contactNodeType"]');
    typeRadios.forEach(r => {
      r.addEventListener("change", () => {
        if (r.checked) {
          if ((r.value === "allstar_node" || r.value === "asl_macro") && contactEditNetwork && contactEditNetwork.value !== "allstar") {
            contactEditNetwork.value = "allstar";
          } else if ((r.value === "tg" || r.value === "repeater") && contactEditNetwork && contactEditNetwork.value === "allstar") {
            contactEditNetwork.value = "bm";
          }
          updateContactFormFieldsVisibility(r.value);
        }
      });
    });

    if (contactEditNetwork) {
      contactEditNetwork.addEventListener("change", () => {
        const typeRadio = document.querySelector('input[name="contactNodeType"]:checked');
        let curType = typeRadio ? typeRadio.value : (isEditingFolder ? "folder" : "person");
        const curNet = (contactEditNetwork.value || "bm").toLowerCase();
        if (curNet === "xlx" && contactEditSlot) {
          contactEditSlot.value = "2";
        } else if (curNet === "allstar" && (curType === "tg" || curType === "repeater")) {
          curType = "allstar_node";
          const aslRadio = document.querySelector('input[name="contactNodeType"][value="allstar_node"]');
          if (aslRadio) aslRadio.checked = true;
        } else if ((curType === "allstar_node" || curType === "asl_macro") && curNet !== "allstar") {
          curType = "person";
          const personRadio = document.querySelector('input[name="contactNodeType"][value="person"]');
          if (personRadio) personRadio.checked = true;
        }
        updateContactFormFieldsVisibility(curType);
      });
    }

    if (contactEditXlxModule) {
      contactEditXlxModule.addEventListener("change", () => {
        if (contactEditNetwork && contactEditNetwork.value === "xlx" && contactEditTg) {
          contactEditTg.value = contactEditXlxModule.value;
          contactEditTg.dispatchEvent(new Event("input"));
        }
      });
    }

    if (contactEditTg) {
      contactEditTg.addEventListener("input", () => {
        if (contactEditNetwork && contactEditNetwork.value === "xlx" && contactEditXlxModule) {
          const val = contactEditTg.value.trim();
          if (val) {
            const hasOpt = Array.from(contactEditXlxModule.options).some(o => o.value === val);
            if (hasOpt) contactEditXlxModule.value = val;
          }
        }
      });
    }

    // Live TG / DMR ID preview quote popup in Contact Edit Modal
    if (contactEditTg) {
      attachTgLivePreview(contactEditTg, {
        anchorEl: document.getElementById("contactEditTgGroup") || contactEditTg.parentElement,
        popupClass: "in-contact-edit-modal",
        mode: "tg",
        actionHint: (info) => (info && info.isKnown ? (window.t ? window.t("contacts.autofill_hint", {}, "Fill ⏎") : "Fill ⏎") : ""),
        onAction: (info) => {
          if (info && info.cleanDesc && contactEditName && !contactEditName.value.trim()) {
            contactEditName.value = info.cleanDesc;
          } else if (info && info.cleanDesc && contactEditName) {
            contactEditName.value = info.cleanDesc;
          }
          if (info && info.country && contactEditCity && !contactEditCity.value.trim()) {
            contactEditCity.value = info.country;
          }
        }
      });
    }

    if (contactEditDmrId) {
      attachTgLivePreview(contactEditDmrId, {
        anchorEl: document.getElementById("contactEditDmrIdGroup") || contactEditDmrId.parentElement,
        popupClass: "in-contact-edit-modal",
        mode: "id",
        actionHint: (info) => (info && info.isKnown ? (window.t ? window.t("contacts.autofill_hint", {}, "Fill ⏎") : "Fill ⏎") : ""),
        onAction: (info) => {
          if (info && info.user) {
            if (contactEditCallsign && info.user.callsign) {
              contactEditCallsign.value = info.user.callsign.trim().toUpperCase();
            }
            if (contactEditName && (info.user.name || info.user.callsign)) {
              const nm = [info.user.name, info.user.callsign].filter(Boolean).join(" ").trim();
              if (nm) contactEditName.value = nm;
            }
            if (contactEditCity && !contactEditCity.value.trim()) {
              const loc = [info.user.city, info.user.country].filter(Boolean).join(", ");
              if (loc) contactEditCity.value = loc;
            }
          }
        }
      });
    }

    // Contacts Tree Delegation
    if (contactsTreeContainer) {
      contactsTreeContainer.addEventListener("click", (e) => {
        const targetActionEl = e.target.closest("[data-action]");
        if (!targetActionEl) return;
        e.stopPropagation();

        const action = targetActionEl.dataset.action;
        const nodeId = targetActionEl.dataset.nodeId || targetActionEl.closest("[data-node-id]")?.dataset.nodeId;
        const parentId = targetActionEl.dataset.parentId;

        if (action === "toggle-folder") {
          const node = findNodeInTree(contactsTree, nodeId);
          if (node && node.type === "folder") {
            node.collapsed = !node.collapsed;
            renderContactsTree(contactsSearchInput ? contactsSearchInput.value.trim() : "");
          }
        } else if (action === "call-cross-net") {
          const targetNodeId = targetActionEl.dataset.targetNodeId || nodeId;
          const targetNet = (targetActionEl.dataset.net || "bm").toLowerCase();
          const targetNode = findNodeInTree(contactsTree, targetNodeId);
          if (targetNode) {
            const hasHsForNet = Array.isArray(window.currentHotspots) && window.currentHotspots.some(h => (h.network_type || "bm").toLowerCase() === targetNet);
            if (!hasHsForNet) {
              const netLabel = getNetworkBadgeLabel(targetNet);
              showToast(window.t ? window.t("contacts.cross_net_no_hotspot", { net: netLabel }, `ℹ️ ${netLabel}: не найден настроенный хотспот для вызова`) : `ℹ️ ${netLabel}: не найден настроенный хотспот для вызова`, 2600);
              return;
            }
            openContactCallProposal(targetNode, targetNet);
          }
        } else if (action === "call-person-net") {
          const node = findNodeInTree(contactsTree, nodeId);
          const targetNet = targetActionEl.dataset.net || "bm";
          if (node) openContactCallProposal(node, targetNet);
        } else if (action === "call-proposal") {
          const node = findNodeInTree(contactsTree, nodeId);
          if (node) openContactCallProposal(node);
        } else if (action === "edit-node") {
          const node = findNodeInTree(contactsTree, nodeId);
          if (node) openContactEditModal(node);
        } else if (action === "delete-node") {
          deleteContactNode(nodeId);
        } else if (action === "add-child") {
          openContactEditModal(null, parentId, "person");
        }
      });
    }

    // Contacts Search Filter Input
    if (contactsSearchInput) {
      contactsSearchInput.addEventListener("input", () => {
        const q = contactsSearchInput.value.trim();
        if (clearContactsSearchBtn) clearContactsSearchBtn.classList.toggle("hidden", !q);
        clearTimeout(contactsSearchDebounceTimer);
        contactsSearchDebounceTimer = setTimeout(() => {
          renderContactsTree(q);
        }, 120);
      });
    }

    if (clearContactsSearchBtn) {
      clearContactsSearchBtn.addEventListener("click", () => {
        if (contactsSearchInput) {
          contactsSearchInput.value = "";
          clearContactsSearchBtn.classList.add("hidden");
          contactsSearchInput.focus();
          renderContactsTree("");
        }
      });
    }

    const btnMyContactsMain = document.getElementById("btnMyContactsMain");
    if (btnMyContactsMain) {
      btnMyContactsMain.addEventListener("click", (e) => {
        e.stopPropagation();
        openMyContactsModal();
      });
    }
  }

  // Initialize Contacts Manager


// Export on window and window.__proxdmr for legacy / external bridge
if (typeof window !== "undefined") {
  window.DEFAULT_CONTACTS_TREE = DEFAULT_CONTACTS_TREE;
  window.openMyContactsModal = openMyContactsModal;
  window.closeMyContactsModal = closeMyContactsModal;
  window.openContactEditModal = openContactEditModal;
  window.closeContactEditModal = closeContactEditModal;
  window.openContactCallProposal = openContactCallProposal;
  window.closeContactCallProposalModal = closeContactCallProposalModal;
  window.ensureValidContactsGateway = ensureValidContactsGateway;
  window.updateContactsGatewaySummary = updateContactsGatewaySummary;
  window.findNodeInTree = findNodeInTree;
  window.findParentNodeInTree = findParentNodeInTree;
  window.renderContactsTree = renderContactsTree;
  window.getLocalizedContactName = getLocalizedContactName;
  window.saveContactsToServer = saveContactsToServer;
  window.flushPendingContactsSave = flushPendingContactsSave;
  window.deleteContactNode = deleteContactNode;
  window.initContactsManager = initContactsManager;
  window.openAslCellPickerModal = openAslCellPickerModal;

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.DEFAULT_CONTACTS_TREE = DEFAULT_CONTACTS_TREE;
  window.__proxdmr.contactsTree = contactsTree;
  window.__proxdmr.contactsGateway = contactsGateway;
  window.__proxdmr.openMyContactsModal = openMyContactsModal;
  window.__proxdmr.openAslCellPickerModal = openAslCellPickerModal;
  window.__proxdmr.closeMyContactsModal = closeMyContactsModal;
  window.__proxdmr.openContactEditModal = openContactEditModal;
  window.__proxdmr.closeContactEditModal = closeContactEditModal;
  window.__proxdmr.openContactCallProposal = openContactCallProposal;
  window.__proxdmr.closeContactCallProposalModal = closeContactCallProposalModal;
  window.__proxdmr.ensureValidContactsGateway = ensureValidContactsGateway;
  window.__proxdmr.updateContactsGatewaySummary = updateContactsGatewaySummary;
  window.__proxdmr.findNodeInTree = findNodeInTree;
  window.__proxdmr.findParentNodeInTree = findParentNodeInTree;
  window.__proxdmr.renderContactsTree = renderContactsTree;
  window.__proxdmr.getLocalizedContactName = getLocalizedContactName;
  window.__proxdmr.saveContactsToServer = saveContactsToServer;
  window.__proxdmr.flushPendingContactsSave = flushPendingContactsSave;
  window.__proxdmr.deleteContactNode = deleteContactNode;
  window.__proxdmr.initContactsManager = initContactsManager;

  window.getYsfBookmarks = getYsfBookmarks;
  window.saveYsfBookmarks = saveYsfBookmarks;
  window.isYsfRoomBookmarked = isYsfRoomBookmarked;
  window.toggleYsfRoomBookmark = toggleYsfRoomBookmark;
  window.connectYsfRoomById = connectYsfRoomById;
  window.openYsfMemPickerModal = openYsfMemPickerModal;
  window.renderYsfRoomsList = renderYsfRoomsList;
  window.resolveYsfRoomInfo = resolveYsfRoomInfo;
  window.classifyYsfReflector = classifyYsfReflector;
  window.getYsfRoomTypeOverride = getYsfRoomTypeOverride;
  window.setYsfRoomTypeOverride = setYsfRoomTypeOverride;
  window.markYsfRoomRuntimeMutant = markYsfRoomRuntimeMutant;
  window.isYsfMultiroomRoom = isYsfMultiroomRoom;
  window.getYsfMultiroomKind = getYsfMultiroomKind;

  window.__proxdmr.getYsfBookmarks = getYsfBookmarks;
  window.__proxdmr.saveYsfBookmarks = saveYsfBookmarks;
  window.__proxdmr.connectYsfRoomById = connectYsfRoomById;
  window.__proxdmr.openYsfMemPickerModal = openYsfMemPickerModal;
  window.__proxdmr.renderYsfRoomsList = renderYsfRoomsList;
  window.__proxdmr.resolveYsfRoomInfo = resolveYsfRoomInfo;
  window.__proxdmr.classifyYsfReflector = classifyYsfReflector;
  window.__proxdmr.getYsfRoomTypeOverride = getYsfRoomTypeOverride;
  window.__proxdmr.setYsfRoomTypeOverride = setYsfRoomTypeOverride;
  window.__proxdmr.markYsfRoomRuntimeMutant = markYsfRoomRuntimeMutant;
  window.__proxdmr.isYsfMultiroomRoom = isYsfMultiroomRoom;
  window.__proxdmr.getYsfMultiroomKind = getYsfMultiroomKind;
  window.loadContactsFromServer = loadContactsFromServer;
  window.__proxdmr.loadContactsFromServer = loadContactsFromServer;
  window.applyYsfFavoritesFromServer = applyYsfFavoritesFromServer;
  window.loadYsfFavoritesFromServer = loadYsfFavoritesFromServer;
  window.__proxdmr.applyYsfFavoritesFromServer = applyYsfFavoritesFromServer;
  window.__proxdmr.loadYsfFavoritesFromServer = loadYsfFavoritesFromServer;
}

// Delegated click handler for Contacts button across all cards and static elements
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-my-contacts");
    if (!btn) return;
    e.stopPropagation();
    const card = btn.closest(".radio-container");
    const cid = card ? (card.dataset.hotspotId || (typeof window !== "undefined" && window.activeHotspotId) || "default") : ((typeof window !== "undefined" && window.activeHotspotId) || "default");
    if (typeof window !== "undefined" && typeof window.switchActiveHotspot === "function") {
      window.switchActiveHotspot(cid);
    }
    openMyContactsModal(cid);
  });
}

// Auto-initialize when DOM is ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initContactsManager());
  } else {
    initContactsManager();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("languageChanged", () => {
    try { updateContactsGatewaySummary(); } catch (_) {}
    try { renderContactsTree(contactsSearchInput ? contactsSearchInput.value.trim() : ""); } catch (_) {}
    try {
      if (isYsfRoomsActive()) {
        const ysfInp = document.getElementById("ysfRoomSearchInput");
        renderYsfRoomsList(ysfInp ? ysfInp.value : "");
      }
    } catch (_) {}
    try {
      if (isAllStarNodesActive()) {
        const aslInp = document.getElementById("aslNodeSearchInput");
        renderAllStarNodesList(aslInp ? aslInp.value : "");
      }
    } catch (_) {}
  });
}
