/**
 * ProxDMR Contacts (DMR Phonebook) Subsystem Module
 * Manages DMR contacts hierarchy (folders, talkgroups, personal calls, repeaters),
 * contact call proposals with BrandMeister routing and timeslot isolation,
 * contact creation/editing modals, JSON import/export, and gateway settings.
 */

import { escapeHtml } from '../core/formatters.js';
import { showToast } from '../core/toast.js';
import { pushNavState, notifyNavClosed } from '../ui/navigation.js';
import { resolveHotspotId } from '../core/state.js';

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
      name: "⭐ Избранное",
      collapsed: false,
      children: [
        { id: "fav_echo", type: "tg", name: "Эхо-тест BM (Parrot)", tg: 9990, city: "Worldwide", slot_override: 2, comment: "Проверка модуляции и задержки" },
        { id: "fav_ru", type: "tg", name: "Россия общая", tg: 2501, city: "Russia", slot_override: 2, comment: "Основная разговорная группа" }
      ]
    },
    {
      id: "groups_root",
      type: "folder",
      name: "🎯 Разговорные группы (TG)",
      collapsed: false,
      children: [
        {
          id: "tg_fed",
          type: "folder",
          name: "Федеральные TG",
          collapsed: false,
          children: [
            { id: "tg_2501", type: "tg", name: "Россия (Основная)", tg: 2501, city: "РФ", slot_override: 2 },
            { id: "tg_2502", type: "tg", name: "Россия (Вызывная)", tg: 2502, city: "РФ", slot_override: 2 },
            { id: "tg_91", type: "tg", name: "Worldwide English", tg: 91, city: "Global", slot_override: 1 }
          ]
        },
        {
          id: "tg_reg",
          type: "folder",
          name: "Региональные TG",
          collapsed: true,
          children: [
            { id: "tg_25050", type: "tg", name: "Москва и МО", tg: 25050, city: "Москва", slot_override: 2 },
            { id: "tg_25078", type: "tg", name: "Санкт-Петербург и ЛО", tg: 25078, city: "СПб", slot_override: 2 },
            { id: "tg_25026", type: "tg", name: "Юг России / Кавказ", tg: 25026, city: "ЮФО / СКФО", slot_override: 2 },
            { id: "tg_25066", type: "tg", name: "Урал и Сибирь", tg: 25066, city: "УФО / СФО", slot_override: 2 }
          ]
        }
      ]
    },
    {
      id: "repeaters_root",
      type: "folder",
      name: "📡 Репитеры и Точки доступа",
      collapsed: true,
      children: [
        { id: "rpt_moscow", type: "repeater", name: "RR3AAA Репитер Москва", callsign: "RR3AAA", dmr_id: 250100, city: "Москва, 439.100", slot_override: 1, comment: "BM Master 2501" },
        { id: "rpt_spb", type: "repeater", name: "RR1AA Репитер СПб", callsign: "RR1AA", dmr_id: 250101, city: "СПб, 438.825", slot_override: 2, comment: "BM Master 2501" }
      ]
    }
  ];


export let contactsTree = [];
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
    const resolvedGw = resolveHotspotId(contactsGateway.hotspot_id);
    const exists = window.currentHotspots.some(h => 
      String(h.id) === String(contactsGateway.hotspot_id) || 
      resolveHotspotId(h.id) === resolvedGw
    );
    if (!exists) {
      const fallbackId = window.currentHotspots[0].id || "default";
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
    if (!Array.isArray(contactsTree) || contactsTree.length === 0) {
      contactsTree = JSON.parse(JSON.stringify(DEFAULT_CONTACTS_TREE));
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
          if (Array.isArray(data.contacts) && data.contacts.length > 0) {
            contactsTree = data.contacts;
            try { localStorage.setItem("proxdmr_my_contacts_tree", JSON.stringify(contactsTree)); } catch (e) {}
          } else if (contactsTree.length > 0) {
            saveContactsToServer();
          }
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
        await fetch("/api/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contacts: contactsTree, gateway: contactsGateway })
        });
      } catch (err) {
        console.warn("Failed to save contacts to server:", err);
      }
    }, 400);
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
    const currentVal = contactsGateway.hotspot_id || (window.currentHotspots[0] && window.currentHotspots[0].id) || "default";
    contactsGwHotspotSelect.innerHTML = "";
    const list = Array.isArray(window.currentHotspots) && window.currentHotspots.length > 0
      ? window.currentHotspots
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

export function openMyContactsModal() {
    ensureElements();
    if (typeof window.closePrimaryModals === "function") {
      window.closePrimaryModals("myContactsModal");
    }
    if (contactsGatewayPanel) contactsGatewayPanel.style.display = "none";
    if (contactsSearchInput) contactsSearchInput.value = "";
    if (clearContactsSearchBtn) clearContactsSearchBtn.classList.add("hidden");
    updateContactsGatewaySummary();
    renderContactsTree("");
    if (myContactsModal) {
      myContactsModal.style.display = "flex";
      myContactsModal.classList.add("active");
      pushNavState("modal", "myContactsModal");
      setTimeout(() => contactsSearchInput && contactsSearchInput.focus(), 60);
    }
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
  return name;
}

  // Render contacts tree
export function renderContactsTree(filterText = "") {
    ensureElements();
    if (!contactsTreeContainer) return;
    const totalCount = countContactsInTree(contactsTree);
    if (contactsCountBadge) contactsCountBadge.textContent = totalCount;

    const q = (filterText || "").trim().toLowerCase();

    function nodeMatchesFilter(n) {
      if (!q) return true;
      const locName = getLocalizedContactName(n);
      const matchSelf = (
        (n.name && n.name.toLowerCase().includes(q)) ||
        (locName && locName.toLowerCase().includes(q)) ||
        (n.callsign && n.callsign.toLowerCase().includes(q)) ||
        (n.city && n.city.toLowerCase().includes(q)) ||
        (n.comment && n.comment.toLowerCase().includes(q)) ||
        (n.dmr_id && String(n.dmr_id).includes(q)) ||
        (n.tg && String(n.tg).includes(q))
      );
      if (matchSelf) return true;
      if (n.type === "folder" && Array.isArray(n.children)) {
        return n.children.some(child => nodeMatchesFilter(child));
      }
      return false;
    }

    function renderNode(node, depth = 1) {
      if (!nodeMatchesFilter(node)) return "";

      const localizedTitle = getLocalizedContactName(node);

      if (node.type === "folder") {
        const isCollapsed = q ? false : !!node.collapsed;
        const childrenHtml = (node.children || [])
          .map(child => renderNode(child, depth + 1))
          .join("");
        const childCount = (node.children || []).length;
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
        // Contact Node
        let icon = "👤";
        let targetLabel = "";
        if (node.type === "tg") {
          icon = "🎯";
          targetLabel = `TG ${node.tg}`;
        } else if (node.type === "repeater") {
          icon = "📡";
          targetLabel = node.callsign || (node.dmr_id ? `ID ${node.dmr_id}` : `TG ${node.tg || ''}`);
        } else {
          // Person
          icon = "👤";
          targetLabel = node.callsign ? `${node.callsign} (${node.dmr_id})` : `ID ${node.dmr_id}`;
        }

        const callProposalHint = window.t ? window.t("contacts.click_proposal", {}, "Кликните для предложения вызова") : "Кликните для предложения вызова";
        const callBtnTitle = window.t ? window.t("contacts.call_tg_btn", {}, "Вызов") : "Вызов";
        const editContactTitle = window.t ? window.t("contacts.edit_contact", {}, "Редактировать") : "Редактировать";
        const delContactTitle = window.t ? window.t("common.delete", {}, "Удалить") : "Удалить";

        return `
          <div class="tree-node-item tree-contact-item" data-node-id="${node.id}" data-depth="${depth}">
            <div class="tree-row tree-contact-row">
              <div class="tree-row-left" data-action="call-proposal" data-node-id="${node.id}" title="${callProposalHint}">
                <span class="tree-contact-icon">${icon}</span>
                <div class="tree-contact-main">
                  <span class="tree-contact-target target-${node.type}">${targetLabel}</span>
                  <span class="tree-contact-name">${escapeHtml(localizedTitle)}</span>
                  ${node.city ? `<span class="tree-contact-city">${escapeHtml(node.city)}</span>` : ''}
                  ${node.slot_override ? `<span class="tree-contact-slot-pill">TS${node.slot_override}</span>` : ''}
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
    if (!html) {
      contactsTreeContainer.innerHTML = `
        <div style="text-align:center;padding:30px 10px;color:#8b949e;">
          <span style="font-size:2rem;display:block;margin-bottom:8px;">📭</span>
          ${q
            ? (window.t ? window.t("contacts.not_found_query", { query: escapeHtml(q) }, `Ничего не найдено по запросу «${escapeHtml(q)}»`) : `Ничего не найдено по запросу «${escapeHtml(q)}»`)
            : (window.t ? window.t("contacts.empty_list_prompt", {}, "Контакты отсутствуют. Добавьте первый контакт кнопкой выше!") : "Контакты отсутствуют. Добавьте первый контакт кнопкой выше!")}
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

export function openContactEditModal(nodeToEdit = null, parentId = null, forcedType = "person") {
    ensureElements();
    editingNodeId = nodeToEdit ? nodeToEdit.id : null;
    editingParentId = parentId || null;

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

    const contactTypeSelectGroup = document.getElementById("contactTypeSelectGroup");
    if (contactTypeSelectGroup) {
      contactTypeSelectGroup.style.display = isEditingFolder ? "none" : "block";
    }

    // Populate Parent Select (Max 3 levels depth check)
    if (contactEditParentSelect) {
      contactEditParentSelect.innerHTML = `<option value="">${window.t ? window.t("contacts.root_level", {}, "📁 [Корневой уровень]") : "📁 [Корневой уровень]"}</option>`;
      function addFolderOptions(nodes, depth = 1) {
        for (const n of nodes) {
          if (n.type === "folder") {
            if (nodeToEdit && n.id === nodeToEdit.id) continue;
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

    // Set type radio
    const activeType = nodeToEdit ? nodeToEdit.type : (forcedType === "folder" ? "person" : forcedType);
    const typeRadios = document.querySelectorAll('input[name="contactNodeType"]');
    typeRadios.forEach(r => {
      r.checked = (r.value === activeType);
    });

    // Populate fields
    if (contactEditName) contactEditName.value = nodeToEdit ? (nodeToEdit.name || "") : "";
    if (contactEditCallsign) contactEditCallsign.value = nodeToEdit ? (nodeToEdit.callsign || "") : "";
    if (contactEditDmrId) contactEditDmrId.value = nodeToEdit ? (nodeToEdit.dmr_id || "") : "";
    if (contactEditTg) contactEditTg.value = nodeToEdit ? (nodeToEdit.tg || "") : "";
    if (contactEditCity) contactEditCity.value = nodeToEdit ? (nodeToEdit.city || "") : "";
    if (contactEditSlot) contactEditSlot.value = nodeToEdit ? (nodeToEdit.slot_override || 0) : 0;
    if (contactEditComment) contactEditComment.value = nodeToEdit ? (nodeToEdit.comment || "") : "";

    updateContactFormFieldsVisibility(activeType);

    if (contactEditModal) {
      contactEditModal.classList.add("active");
      setTimeout(() => contactEditName && contactEditName.focus(), 60);
    }
  }

export function updateContactFormFieldsVisibility(type) {
    const isFolder = isEditingFolder || type === "folder";
    const isTg = type === "tg";
    const isPerson = type === "person";
    const isRepeater = type === "repeater";

    const nameLabel = document.getElementById("contactEditNameLabel");
    if (nameLabel) nameLabel.innerHTML = isFolder ? (window.t ? window.t("contacts.folder_name_label", {}, "Название папки <span class=\"req-star\">*</span>:") : "Название папки <span class=\"req-star\">*</span>:") : (window.t ? window.t("contacts.contact_name_label", {}, "Имя / Описание <span class=\"req-star\">*</span>:") : "Имя / Описание <span class=\"req-star\">*</span>:");

    const callGroup = document.getElementById("contactEditCallsignGroup");
    const idGroup = document.getElementById("contactEditDmrIdGroup");
    const tgGroup = document.getElementById("contactEditTgGroup");
    const cityGroup = document.getElementById("contactEditCityGroup");
    const slotGroup = document.getElementById("contactEditSlotGroup");
    const commentGroup = document.getElementById("contactEditCommentGroup");

    if (callGroup) callGroup.style.display = (isPerson || isRepeater) ? "block" : "none";
    if (idGroup) idGroup.style.display = (isPerson || isRepeater) ? "block" : "none";
    if (tgGroup) tgGroup.style.display = isTg ? "block" : "none";
    if (cityGroup) cityGroup.style.display = isFolder ? "none" : "block";
    if (slotGroup) slotGroup.style.display = isFolder ? "none" : "block";
    if (commentGroup) commentGroup.style.display = isFolder ? "none" : "block";
  }

export function closeContactEditModal() {
    if (contactEditModal && contactEditModal.classList.contains("active")) {
      contactEditModal.classList.remove("active");
    }
  }
  window.closeContactEditModal = closeContactEditModal;

export function saveContactFromForm() {
    const name = contactEditName ? contactEditName.value.trim() : "";
    if (!name) {
      const errMsg = window.t ? window.t("contacts.err_name_required", {}, "Пожалуйста, укажите имя или название!") : "Пожалуйста, укажите имя или название!";
      const alertTitle = window.t ? window.t("contacts.title", {}, "Контакты") : "Контакты";
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

    let tgVal = null;
    let dmrIdVal = null;
    let callsignVal = null;
    let cityVal = contactEditCity ? contactEditCity.value.trim() : "";
    let commentVal = contactEditComment ? contactEditComment.value.trim() : "";
    let slotVal = contactEditSlot ? parseInt(contactEditSlot.value, 10) : 0;

    if (type === "tg") {
      tgVal = contactEditTg ? parseInt(contactEditTg.value.trim(), 10) : null;
      if (!tgVal || tgVal <= 0) {
        const errMsg = window.t ? window.t("contacts.err_tg_required", {}, "Пожалуйста, укажите корректный номер TalkGroup (TG)!") : "Пожалуйста, укажите корректный номер TalkGroup (TG)!";
        const alertTitle = window.t ? window.t("contacts.title", {}, "Контакты") : "Контакты";
        if (window.showAppAlert) {
          window.showAppAlert(errMsg, { title: alertTitle, icon: "⚠️" });
        } else {
          alert(errMsg);
        }
        if (contactEditTg) contactEditTg.focus();
        return;
      }
    } else if (type === "person" || type === "repeater") {
      callsignVal = contactEditCallsign ? contactEditCallsign.value.trim().toUpperCase() : "";
      dmrIdVal = contactEditDmrId ? parseInt(contactEditDmrId.value.trim(), 10) : null;
      if (!dmrIdVal && !callsignVal) {
        const errMsg = window.t ? window.t("contacts.err_id_required", {}, "Пожалуйста, укажите личный DMR ID или позывной!") : "Пожалуйста, укажите личный DMR ID или позывной!";
        const alertTitle = window.t ? window.t("contacts.title", {}, "Контакты") : "Контакты";
        if (window.showAppAlert) {
          window.showAppAlert(errMsg, { title: alertTitle, icon: "⚠️" });
        } else {
          alert(errMsg);
        }
        if (contactEditDmrId) contactEditDmrId.focus();
        return;
      }
    }

    if (editingNodeId) {
      const node = findNodeInTree(contactsTree, editingNodeId);
      if (node) {
        node.name = name;
        node.type = type;
        if (type === "tg") {
          node.tg = tgVal;
          delete node.dmr_id;
          delete node.callsign;
        } else if (type === "person" || type === "repeater") {
          node.callsign = callsignVal;
          node.dmr_id = dmrIdVal;
          delete node.tg;
        }
        node.city = cityVal;
        node.comment = commentVal;
        node.slot_override = slotVal;

        const oldParent = findParentNodeInTree(contactsTree, editingNodeId);
        const oldParentId = oldParent ? oldParent.id : "";
        if (oldParentId !== parentId) {
          removeNodeFromTree(contactsTree, editingNodeId);
          if (parentId) {
            const newParent = findNodeInTree(contactsTree, parentId);
            if (newParent) {
              if (!Array.isArray(newParent.children)) newParent.children = [];
              newParent.children.push(node);
            } else {
              contactsTree.push(node);
            }
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
        slot_override: slotVal
      };

      if (type === "folder") {
        newNode.collapsed = false;
        newNode.children = [];
      } else if (type === "tg") {
        newNode.tg = tgVal;
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
    showToast(window.t ? window.t("contacts.saved_item_toast", { name }, `✅ Запись «${name}» сохранена!`) : `✅ Запись «${name}» сохранена!`, 2000);
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

  // Call Proposal Dialog
export function openContactCallProposal(node) {
    ensureElements();
    if (!node) return;
    currentProposalNode = node;

    const isTg = node.type === "tg";
    const isRepeater = node.type === "repeater";

    if (proposalTypeBadge) {
      if (isTg) {
        proposalTypeBadge.className = "proposal-badge badge-tg";
        proposalTypeBadge.textContent = window.t ? window.t("contacts.type_tg", {}, "🎯 TalkGroup") : "🎯 TalkGroup";
      } else if (isRepeater) {
        proposalTypeBadge.className = "proposal-badge badge-repeater";
        proposalTypeBadge.textContent = window.t ? window.t("contacts.type_repeater", {}, "📡 Репитер") : "📡 Репитер";
      } else {
        proposalTypeBadge.className = "proposal-badge badge-person";
        proposalTypeBadge.textContent = window.t ? window.t("contacts.type_operator", {}, "👤 Корреспондент") : "👤 Корреспондент";
      }
    }

    if (proposalAvatar) {
      proposalAvatar.textContent = isTg ? "🎯" : (isRepeater ? "📡" : "👤");
    }

    if (proposalTargetTitle) {
      proposalTargetTitle.textContent = isTg
        ? `TG ${node.tg}`
        : (node.callsign ? `${node.callsign} (${node.dmr_id})` : `ID ${node.dmr_id}`);
    }

    if (proposalHeroName) proposalHeroName.textContent = getLocalizedContactName(node) || (isTg ? `TG ${node.tg}` : (node.callsign || `ID ${node.dmr_id}`));
    if (proposalHeroMeta) {
      proposalHeroMeta.textContent = isTg
        ? (window.t ? window.t("contacts.meta_tg", { city: node.city || 'BM Network' }, `Группа передачи • ${node.city || 'BM Network'}`) : `Группа передачи • ${node.city || 'BM Network'}`)
        : (window.t ? window.t("contacts.meta_private", { id: node.dmr_id || node.tg, city: node.city || 'RadioID' }, `DMR ID: ${node.dmr_id || node.tg} • ${node.city || 'RadioID'}`) : `DMR ID: ${node.dmr_id || node.tg} • ${node.city || 'RadioID'}`);
    }
    if (proposalHeroDesc) proposalHeroDesc.textContent = node.comment || "";

    // Set Routing Hotspot
    if (proposalHotspotSelect) {
      proposalHotspotSelect.innerHTML = "";
      const allHs = Array.isArray(window.currentHotspots) && window.currentHotspots.length > 0
        ? window.currentHotspots
        : [{ id: "default", name: "Main 📻" }];

      const eligibleHs = allHs.filter(hs => hs.auto_tg_bm !== false);
      const list = eligibleHs.length > 0 ? eligibleHs : allHs;

      let targetHid = contactsGateway.hotspot_id || window.activeHotspotId || "default";
      if (!list.some(h => resolveHotspotId(h.id) === resolveHotspotId(targetHid))) {
        targetHid = list[0].id;
      }
      selectedProposalHid = targetHid;
      list.forEach(hs => {
        const opt = document.createElement("option");
        opt.value = hs.id;
        opt.textContent = getHotspotDisplayName(hs.id);
        if (String(hs.id) === String(selectedProposalHid) || resolveHotspotId(hs.id) === resolveHotspotId(selectedProposalHid)) {
          opt.selected = true;
        }
        proposalHotspotSelect.appendChild(opt);
      });
    }

    // Set Slot
    selectedProposalSlot = (node.slot_override === 1 || node.slot_override === 2)
      ? node.slot_override
      : (contactsGateway.slot === 1 ? 1 : 2);
    setProposalSlotUI(selectedProposalSlot);

    if (proposalApplyText) {
      proposalApplyText.textContent = isTg
        ? (window.t ? window.t("contacts.btn_apply_tg", {}, "Установить TG") : "Установить TG")
        : (isRepeater
          ? (window.t ? window.t("contacts.btn_apply_repeater", {}, "Установить репитер") : "Установить репитер")
          : (window.t ? window.t("contacts.btn_apply_private", {}, "Установить Private Call") : "Установить Private Call"));
    }
    if (proposalPttText) {
      proposalPttText.textContent = isTg ? (window.t ? window.t("contacts.btn_call_tg", {}, "Вызов TG") : "Вызов TG") : (isRepeater ? (window.t ? window.t("contacts.btn_call_repeater", {}, "Вызов репитера") : "Вызов репитера") : (window.t ? window.t("contacts.btn_call_private", {}, "Вызов") : "Вызов"));
    }

    if (contactCallProposalModal) {
      contactCallProposalModal.classList.add("active");
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
    const rawHid = proposalHotspotSelect ? proposalHotspotSelect.value : selectedProposalHid;
    const cid = resolveHotspotId(rawHid);
    const slot = (selectedProposalSlot === 1 || selectedProposalSlot === 2) ? selectedProposalSlot : 2;
    const hsName = getHotspotDisplayName(cid);
    const isTg = node.type === "tg";
    const isRepeater = node.type === "repeater";

    // 1. Close proposal and contacts modals immediately
    closeContactCallProposalModal();
    closeMyContactsModal();

    showToast(window.t ? window.t("contacts.toast_call_prep", { name: hsName, slot }, `⏳ [${hsName}] Подготовка вызова TS${slot}...`) : `⏳ [${hsName}] Подготовка вызова TS${slot}...`, 2500);

    // 2. Hotspot Isolation:
    // Collapse / close and disconnect all other hotspots
    const allCards = document.querySelectorAll(".radio-container");
    for (const cardEl of allCards) {
      const cardHid = resolveHotspotId(cardEl.dataset.hotspotId || "default");
      if (cardHid !== cid && !isHotspotCollapsed(cardHid)) {
        await collapseHotspot(cardHid);
      }
    }
    if (Array.isArray(window.currentHotspots)) {
      for (const hs of window.currentHotspots) {
        const hsCid = resolveHotspotId(hs.id);
        if (hsCid !== cid && !isHotspotCollapsed(hsCid)) {
          await collapseHotspot(hsCid);
        }
      }
    }

    // 3. Expand target hotspot if closed / collapsed
    if (isHotspotCollapsed(cid)) {
      await expandHotspot(cid);
    }

    // 4. Set target hotspot as active and activate requested slot
    switchActiveHotspot(cid);
    const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) ||
                       document.querySelector(`.hotspot-card[data-hotspot-id="${cid}"]`) ||
                       radioContainer;
    if (targetCard) {
      setCardSlot(targetCard, slot, true);
    }
    setActiveSlot(slot, true);

    // 5. BrandMeister (BM) Reset on target slot:
    const targetProposalHs = (Array.isArray(window.currentHotspots) && window.currentHotspots.find(h => resolveHotspotId(h.id) === cid)) || null;
    if (targetProposalHs && targetProposalHs.auto_tg_bm === false) {
      console.log(`[CALL_PROPOSAL] Hotspot ${targetProposalHs.name} has auto_tg_bm disabled; skipping BM auto-configuration`);
      return;
    }

    // A. Drop dynamic groups
    try {
      await fetch("/api/bm/drop-dynamic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hotspot_id: cid, slot: slot })
      });
    } catch (err) {
      console.warn(`[CALL_PROPOSAL] Error dropping dynamic groups on ${cid} TS${slot}:`, err);
    }

    // B. Fetch existing static groups on BM
    let existingTgs = [];
    try {
      const resp = await fetch(`/api/bm/static-groups?hotspot_id=${encodeURIComponent(cid)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.status === "ok") {
          const list = slot === 1 ? (data.ts1 || []) : (data.ts2 || []);
          existingTgs = list.map(item => item.talkgroup).filter(tg => tg > 0);
        }
      }
    } catch (err) {
      console.warn(`[CALL_PROPOSAL] Error fetching static groups for ${cid}:`, err);
    }

    // 6. Call Routing & PTT assignment based on contact type:
    if (isTg || isRepeater) {
      const targetId = parseInt(node.tg || node.dmr_id, 10);
      if (targetId > 0) {
        if (node.name) {
          TG_NAMES[targetId] = node.name;
          try {
            localStorage.setItem("proxdmr_tg_names_cache", JSON.stringify(TG_NAMES));
          } catch (_) {}
        }

        // Drop any other static TGs on this slot from BM
        const toDelete = existingTgs.filter(tg => tg !== targetId);
        if (toDelete.length > 0) {
          try {
            await fetch("/api/bm/static-groups", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                hotspot_id: cid,
                slot: slot,
                talkgroups: toDelete
              })
            });
          } catch (err) {
            console.warn(`[CALL_PROPOSAL] Error deleting static groups on ${cid}:`, err);
          }
        }

        // Register targetId as static group in BM if not already present
        if (!existingTgs.includes(targetId)) {
          try {
            await fetch("/api/bm/static-groups", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                hotspot_id: cid,
                slot: slot,
                talkgroups: [targetId]
              })
            });
          } catch (err) {
            console.warn(`[CALL_PROPOSAL] Error adding static group ${targetId}:`, err);
          }
        }

        // Set PTT target
        selectHotspotTargetId(targetCard, cid, slot, targetId, "TG", null);
        const groupLabel = node.name || (isRepeater ? "Репитер" : "Группа");
        showToast(window.t ? window.t("contacts.toast_tg_ready", { name: hsName, slot, tg: targetId, group: groupLabel }, `🎯 [${hsName}] TS${slot} -> TG ${targetId} (${groupLabel}) готова`) : `🎯 [${hsName}] TS${slot} -> TG ${targetId} (${groupLabel}) готова`, 3500);
      }
    } else {
      // Personal / Private call:
      // Clear ALL static groups on this slot
      if (existingTgs.length > 0) {
        try {
          await fetch("/api/bm/static-groups", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              hotspot_id: cid,
              slot: slot,
              talkgroups: existingTgs
            })
          });
        } catch (err) {
          console.warn(`[CALL_PROPOSAL] Error clearing static groups for private call on ${cid}:`, err);
        }
      }

      const rid = parseInt(node.dmr_id || node.tg, 10);
      if (rid > 0) {
        window.USER_CALLSIGNS[rid] = {
          callsign: node.callsign || `ID ${rid}`,
          name: node.name || "",
          country: node.city || ""
        };
        try {
          localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify(window.USER_CALLSIGNS));
        } catch (_) {}

        selectHotspotTargetId(targetCard, cid, slot, rid, "CALLER", null);
        showToast(window.t ? window.t("contacts.toast_private_ready", { name: hsName, slot, call: node.callsign || rid, user_name: node.name || "" }, `👤 [${hsName}] TS${slot} -> Личный вызов ${node.callsign || rid} (${node.name || ""}) готов к передаче`) : `👤 [${hsName}] TS${slot} -> Личный вызов ${node.callsign || rid} (${node.name || ""}) готов к передаче`, 3500);
      }
    }

    // 7. Refresh BM static groups modal/cache if active
    if (typeof loadBmTgStaticGroups === "function") {
      try {
        loadBmTgStaticGroups(cid).catch(() => {});
      } catch (_) {}
    }

    // Без автонажатия PTT: частота, таймслот, BM и PTT настроены, оператор нажимает PTT вручную!
  }

export function exportContactsToJson() {
    const exportData = {
      version: "1.0",
      exported_at: new Date().toISOString(),
      gateway: contactsGateway,
      contacts: contactsTree
    };
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proxdmr_contacts_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(window.t ? window.t("contacts.export_json_toast", {}, "📥 Контакты экспортированы в файл JSON") : "📥 Контакты экспортированы в файл JSON", 2500);
  }

export function handleImportContactsFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        let importedList = [];
        if (Array.isArray(parsed)) {
          importedList = parsed;
        } else if (parsed && Array.isArray(parsed.contacts)) {
          importedList = parsed.contacts;
          if (parsed.gateway) {
            contactsGateway = parsed.gateway;
            ensureValidContactsGateway();
          }
        } else {
          const errFormatMsg = window.t ? window.t("contacts.err_json_format", {}, "Неверный формат JSON файла контактов!") : "Неверный формат JSON файла контактов!";
          const errTitle = window.t ? window.t("contacts.import_error_title", {}, "Ошибка импорта") : "Ошибка импорта";
          if (window.showAppAlert) {
            await window.showAppAlert(errFormatMsg, { title: errTitle, icon: "⚠️" });
          } else {
            alert(errFormatMsg);
          }
          return;
        }

        const importTitle = window.t ? window.t("contacts.import_title", {}, "Импорт контактов") : "Импорт контактов";
        const importMsg = window.t ? window.t("contacts.confirm_import", { count: importedList.length }, `Импортировать ${importedList.length} разделов/контактов из файла?\n\nТекущие контакты будут заменены.`) : `Импортировать ${importedList.length} разделов/контактов из файла?\n\nТекущие контакты будут заменены.`;
        const importBtn = window.t ? window.t("contacts.btn_import", {}, "Импортировать") : "Импортировать";
        const ok = await (window.showAppConfirm ? window.showAppConfirm({
          title: importTitle,
          icon: "📥",
          message: importMsg,
          confirmText: importBtn,
          confirmStyle: "primary"
        }) : Promise.resolve(confirm(`Импортировать ${importedList.length} разделов/контактов из файла? Текущие контакты будут заменены.`)));

        if (ok) {
          contactsTree = importedList;
          saveContactsToServer();
          renderContactsTree();
          updateContactsGatewaySummary();
          showToast(window.t ? window.t("contacts.import_success", {}, "✅ Контакты успешно импортированы!") : "✅ Контакты успешно импортированы!", 3000);
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

    // Type radio change listener in edit form
    const typeRadios = document.querySelectorAll('input[name="contactNodeType"]');
    typeRadios.forEach(r => {
      r.addEventListener("change", () => {
        if (r.checked) updateContactFormFieldsVisibility(r.value);
      });
    });

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
  window.deleteContactNode = deleteContactNode;
  window.initContactsManager = initContactsManager;

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.DEFAULT_CONTACTS_TREE = DEFAULT_CONTACTS_TREE;
  window.__proxdmr.contactsTree = contactsTree;
  window.__proxdmr.contactsGateway = contactsGateway;
  window.__proxdmr.openMyContactsModal = openMyContactsModal;
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
  window.__proxdmr.deleteContactNode = deleteContactNode;
  window.__proxdmr.initContactsManager = initContactsManager;
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
    openMyContactsModal();
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
