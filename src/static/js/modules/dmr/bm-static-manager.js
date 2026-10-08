import { showToast } from '../core/toast.js';
import { resolveHotspotId, pushNavState, notifyNavClosed } from '../core/state.js';

/**
 * ProxDMR BrandMeister Static & Dynamic TalkGroups Manager Module
 * Handles BrandMeister static/dynamic TG subscriptions, drop dynamic,
 * CSV/JSON import/export, and mobile dual-slot views.
 */

function setHotspotSlot(hid, slot, notifyServer = true) {
  if (typeof window.setHotspotSlot === "function") {
    return window.setHotspotSlot(hid, slot, notifyServer);
  }
}

function setHotspotTg(hid, slot, tg, tune = true) {
  if (typeof window.setHotspotTg === "function") {
    return window.setHotspotTg(hid, slot, tg, tune);
  }
}

// BrandMeister TalkGroups Action Buttons & Modal Elements
const btnBmTgStaticEdit = document.getElementById("btnBmTgStaticEdit");
const btnBmTgDynamicReset = document.getElementById("btnBmTgDynamicReset");
const bmTgStaticModal = document.getElementById("bmTgStaticModal");
const closeBmTgModalBtn = document.getElementById("closeBmTgModalBtn");
const btnCloseBmTgModalBottom = document.getElementById("btnCloseBmTgModalBottom");
const btnRefreshBmTg = document.getElementById("btnRefreshBmTg");
const bmModalDeviceBadge = document.getElementById("bmModalDeviceBadge");
const bmTgModalLoading = document.getElementById("bmTgModalLoading");
const bmTgModalAlert = document.getElementById("bmTgModalAlert");
const bmModalStatusText = document.getElementById("bmModalStatusText");
const bmTabBtnStatic = document.getElementById("bmTabBtnStatic");
const bmTabBtnDynamic = document.getElementById("bmTabBtnDynamic");
const bmTabContentStatic = document.getElementById("bmTabContentStatic");
const bmTabContentDynamic = document.getElementById("bmTabContentDynamic");
const bmStaticTotalBadge = document.getElementById("bmStaticTotalBadge");
const bmDynTotalBadge = document.getElementById("bmDynTotalBadge");
const bmMobileSlotTs1Count = document.getElementById("bmMobileSlotTs1Count");
const bmMobileSlotTs2Count = document.getElementById("bmMobileSlotTs2Count");
const bmSlotColTs1 = document.getElementById("bmSlotColTs1");
const bmSlotColTs2 = document.getElementById("bmSlotColTs2");
const bmDynSlotColTs1 = document.getElementById("bmDynSlotColTs1");
const bmDynSlotColTs2 = document.getElementById("bmDynSlotColTs2");
const btnDropAllDynamic = document.getElementById("btnDropAllDynamic");
const btnDropDynamicTs1 = document.getElementById("btnDropDynamicTs1");
const btnDropDynamicTs2 = document.getElementById("btnDropDynamicTs2");
const bmDynTs1Count = document.getElementById("bmDynTs1Count");
const bmDynTs2Count = document.getElementById("bmDynTs2Count");
const bmDynTs1List = document.getElementById("bmDynTs1List");
const bmDynTs2List = document.getElementById("bmDynTs2List");

// TS1 DOM Elements
const bmTs1Count = document.getElementById("bmTs1Count");
const chkSelectAllTs1 = document.getElementById("chkSelectAllTs1");
const btnDeleteSelectedTs1 = document.getElementById("btnDeleteSelectedTs1");
const selCountTs1 = document.getElementById("selCountTs1");
const bmTs1List = document.getElementById("bmTs1List");
const inputAddTgTs1 = document.getElementById("inputAddTgTs1");
const btnAddTgTs1 = document.getElementById("btnAddTgTs1");
const selectPresetTs1 = document.getElementById("selectPresetTs1");
const btnAddPresetTs1 = document.getElementById("btnAddPresetTs1");

// TS2 DOM Elements
const bmTs2Count = document.getElementById("bmTs2Count");
const chkSelectAllTs2 = document.getElementById("chkSelectAllTs2");
const btnDeleteSelectedTs2 = document.getElementById("btnDeleteSelectedTs2");
const selCountTs2 = document.getElementById("selCountTs2");
const bmTs2List = document.getElementById("bmTs2List");
const inputAddTgTs2 = document.getElementById("inputAddTgTs2");
const btnAddTgTs2 = document.getElementById("btnAddTgTs2");
const selectPresetTs2 = document.getElementById("selectPresetTs2");
const btnAddPresetTs2 = document.getElementById("btnAddPresetTs2");

// File Import Elements
const inputFileTs1 = document.getElementById("inputFileTs1");
const btnUploadFileTs1 = document.getElementById("btnUploadFileTs1");
const btnExportFileTs1 = document.getElementById("btnExportFileTs1");
const inputFileTs2 = document.getElementById("inputFileTs2");
const btnUploadFileTs2 = document.getElementById("btnUploadFileTs2");
const btnExportFileTs2 = document.getElementById("btnExportFileTs2");
const bmFileConfirmModal = document.getElementById("bmFileConfirmModal");
const closeFileConfirmBtn = document.getElementById("closeFileConfirmBtn");
const btnCancelFileImport = document.getElementById("btnCancelFileImport");
const btnConfirmFileImport = document.getElementById("btnConfirmFileImport");
const bmFileStatName = document.getElementById("bmFileStatName");
const bmFileStatSlotBadge = document.getElementById("bmFileStatSlotBadge");
const bmStatFound = document.getElementById("bmStatFound");
const bmStatUnique = document.getElementById("bmStatUnique");
const bmStatAlready = document.getElementById("bmStatAlready");
const bmStatNew = document.getElementById("bmStatNew");
const bmFilePreviewList = document.getElementById("bmFilePreviewList");
const bmFileConfirmPrompt = document.getElementById("bmFileConfirmPrompt");
let pendingFileImport = null;

// BM Background Import Elements
const headerBmUploadIndicator = document.getElementById("headerBmUploadIndicator");
const headerBmUploadPercent = document.getElementById("headerBmUploadPercent");
const bmImportProgressCard = document.getElementById("bmImportProgressCard");
const bmImportProgressTitleText = document.getElementById("bmImportProgressTitleText");
const bmImportProgressPercent = document.getElementById("bmImportProgressPercent");
const bmImportBarFill = document.getElementById("bmImportBarFill");
const bmImportProgressCount = document.getElementById("bmImportProgressCount");
const bmImportProgressSlot = document.getElementById("bmImportProgressSlot");
const bmImportProgressErrors = document.getElementById("bmImportProgressErrors");
const btnMinimizeBmImport = document.getElementById("btnMinimizeBmImport");
const btnCancelBmImport = document.getElementById("btnCancelBmImport");

let currentBmImportTask = null;
let bmImportFinishedTimer = null;

const POPULAR_TG_PRESETS = [
  {
    group: "Россия (Основные и ФО)",
    items: [
      { tg: 250, name: "250 - Россия (Общий / CIS)" },
      { tg: 2501, name: "2501 - Россия 1 (National)" },
      { tg: 2502, name: "2502 - Москва и область" },
      { tg: 2503, name: "2503 - Санкт-Петербург и СЗФО" },
      { tg: 2504, name: "2504 - Центральный ФО" },
      { tg: 2505, name: "2505 - Южный & Кавказский ФО" },
      { tg: 2506, name: "2506 - Приволжский ФО" },
      { tg: 2507, name: "2507 - Уральский ФО" },
      { tg: 2508, name: "2508 - Сибирский ФО" },
      { tg: 2509, name: "2509 - Дальневосточный ФО" },
      { tg: 25020, name: "25020 - Конференция РОСХАМ" },
    ]
  },
  {
    group: "Регионы и области РФ",
    items: [
      { tg: 25011, name: "25011 - Калининградская обл." },
      { tg: 25033, name: "25033 - Ленинградская обл." },
      { tg: 250601, name: "250601 - Волгоградская обл." },
      { tg: 250602, name: "250602 - Ростовская обл." },
      { tg: 250603, name: "250603 - Армения / Локальная" },
      { tg: 250641, name: "250641 - Краснодарский край" },
      { tg: 250647, name: "250647 - Ставропольский край" },
      { tg: 250907, name: "250907 - Приморский край" },
    ]
  },
  {
    group: "Международные и тест",
    items: [
      { tg: 91, name: "91 - Worldwide (Весь мир)" },
      { tg: 92, name: "92 - Europe (Европа)" },
      { tg: 262, name: "262 - Германия" },
      { tg: 310, name: "310 - США (TAC 310)" },
      { tg: 9990, name: "9990 - Эхо-тест (Parrot)" },
      { tg: 4000, name: "4000 - Unlink / Сброс" },
    ]
  }
];

// --- BrandMeister TalkGroups Action Buttons & Static Manager Modal ---

function populatePresetSelects() {
  [selectPresetTs1, selectPresetTs2].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Выбрать из списка --</option>';
    POPULAR_TG_PRESETS.forEach(group => {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.group;
      group.items.forEach(item => {
        const opt = document.createElement("option");
        opt.value = item.tg;
        opt.textContent = item.name;
        optgroup.appendChild(opt);
      });
      sel.appendChild(optgroup);
    });
  });
}
populatePresetSelects();

let staticTgsTs1 = [];
let staticTgsTs2 = [];
let dynamicTgsTs1 = [];
let dynamicTgsTs2 = [];
let selectedTs1 = new Set();
let selectedTs2 = new Set();
let isBmTgLoading = false;
let currentStaticModalHotspotId = null;
let currentBmTgActiveTab = "static";
let currentBmMobileSlot = 1;

function switchBmTgTab(tabName) {
  currentBmTgActiveTab = (tabName === "dynamic") ? "dynamic" : "static";
  try {
    localStorage.setItem("proxdmr_bmtg_active_tab", currentBmTgActiveTab);
  } catch (e) {}

  const isDynamic = currentBmTgActiveTab === "dynamic";
  if (bmTabBtnStatic) {
    bmTabBtnStatic.classList.toggle("active", !isDynamic);
    bmTabBtnStatic.setAttribute("aria-selected", !isDynamic ? "true" : "false");
  }
  if (bmTabBtnDynamic) {
    bmTabBtnDynamic.classList.toggle("active", isDynamic);
    bmTabBtnDynamic.setAttribute("aria-selected", isDynamic ? "true" : "false");
  }
  if (bmTabContentStatic) {
    bmTabContentStatic.classList.toggle("active", !isDynamic);
  }
  if (bmTabContentDynamic) {
    bmTabContentDynamic.classList.toggle("active", isDynamic);
  }

  updateMobileSlotBadges();
}

function switchBmMobileSlot(slotNum) {
  currentBmMobileSlot = slotNum === 2 ? 2 : 1;
  const isSlot1 = currentBmMobileSlot === 1;

  document.querySelectorAll(".bm-mobile-slot-btn").forEach(btn => {
    const btnSlot = parseInt(btn.getAttribute("data-mobile-slot"), 10);
    btn.classList.toggle("active", btnSlot === currentBmMobileSlot);
  });

  if (bmSlotColTs1) bmSlotColTs1.classList.toggle("mobile-active", isSlot1);
  if (bmSlotColTs2) bmSlotColTs2.classList.toggle("mobile-active", !isSlot1);
  if (bmDynSlotColTs1) bmDynSlotColTs1.classList.toggle("mobile-active", isSlot1);
  if (bmDynSlotColTs2) bmDynSlotColTs2.classList.toggle("mobile-active", !isSlot1);
}

function updateMobileSlotBadges() {
  const isDynamic = currentBmTgActiveTab === "dynamic";
  const ts1Count = isDynamic ? dynamicTgsTs1.length : staticTgsTs1.length;
  const ts2Count = isDynamic ? dynamicTgsTs2.length : staticTgsTs2.length;
  if (bmMobileSlotTs1Count) bmMobileSlotTs1Count.textContent = ts1Count;
  if (bmMobileSlotTs2Count) bmMobileSlotTs2Count.textContent = ts2Count;
}

function openBmTgStaticModal(targetHid) {
  const resolvedHid = resolveHotspotId(targetHid || (typeof window !== "undefined" ? window.activeHotspotId : null));
  currentStaticModalHotspotId = resolvedHid;
  const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
  const hs = hsList.find(h => h.id === currentStaticModalHotspotId) || hsList[0];

  if (bmModalDeviceBadge) {
    if (hs) {
      const ssidStr = (hs.bm_ssid !== undefined && hs.bm_ssid > 0) ? String(hs.bm_ssid).padStart(2, "0") : "";
      const effId = hs.dmr_id ? `${hs.dmr_id}${ssidStr}` : "---";
      bmModalDeviceBadge.textContent = `${hs.name || "Хотспот"} (ID: ${effId})`;
    } else {
      bmModalDeviceBadge.textContent = "ID: ---";
    }
  }

  // Always reset lists immediately so stale groups from another hotspot never show
  staticTgsTs1 = [];
  staticTgsTs2 = [];
  dynamicTgsTs1 = [];
  dynamicTgsTs2 = [];
  selectedTs1.clear();
  selectedTs2.clear();
  renderSlotList(1);
  renderSlotList(2);
  renderDynamicSlotList(1);
  renderDynamicSlotList(2);

  // Restore last active tab from localStorage
  let savedTab = "static";
  try {
    savedTab = localStorage.getItem("proxdmr_bmtg_active_tab") || "static";
  } catch (e) {}
  switchBmTgTab(savedTab);
  switchBmMobileSlot(currentBmMobileSlot || 1);

  if (typeof window.closePrimaryModals === "function") {
    window.closePrimaryModals("bmTgStaticModal");
  }

  if (bmTgStaticModal) {
    bmTgStaticModal.style.display = "flex";
    bmTgStaticModal.classList.add("active");
    pushNavState("modal", "bmTgStaticModal");
  }

  loadBmTgStaticGroups(currentStaticModalHotspotId);
  checkBmImportStatus();
}

function showBmTgAlert(msg, type = "error") {
  if (!bmTgModalAlert) return;
  if (!msg) {
    bmTgModalAlert.className = "bm-modal-alert hidden";
    bmTgModalAlert.textContent = "";
    return;
  }
  bmTgModalAlert.className = `bm-modal-alert alert-${type}`;
  bmTgModalAlert.textContent = msg;
}

async function loadBmTgStaticGroups(targetHid) {
  if (isBmTgLoading) return;
  isBmTgLoading = true;
  showBmTgAlert(null);
  if (bmTgModalLoading) bmTgModalLoading.classList.remove("hidden");
  if (bmModalStatusText) bmModalStatusText.textContent = window.t ? window.t("bmtg_static.requesting") : "Запрос к BM API...";

  const hid = targetHid || currentStaticModalHotspotId || (typeof window !== "undefined" ? window.activeHotspotId : "default");
  const curHotspots = (typeof window !== "undefined" && Array.isArray(window.currentHotspots)) ? window.currentHotspots : [];
  const hs = curHotspots.find(h => h.id === hid) || curHotspots[0];

  if (bmModalDeviceBadge && hs) {
    const ssidStr = (hs.bm_ssid !== undefined && hs.bm_ssid > 0) ? String(hs.bm_ssid).padStart(2, "0") : "";
    const effId = hs.dmr_id ? `${hs.dmr_id}${ssidStr}` : "---";
    bmModalDeviceBadge.textContent = `${hs.name || "Хотспот"} (ID: ${effId})`;
  }

  try {
    const url = hid ? `/api/bm/static-groups?hotspot_id=${encodeURIComponent(hid)}` : "/api/bm/static-groups";
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== "ok") {
      staticTgsTs1 = [];
      staticTgsTs2 = [];
      dynamicTgsTs1 = [];
      dynamicTgsTs2 = [];
      selectedTs1.clear();
      selectedTs2.clear();
      renderSlotList(1);
      renderSlotList(2);
      renderDynamicSlotList(1);
      renderDynamicSlotList(2);
      if (bmStaticTotalBadge) bmStaticTotalBadge.textContent = "0";
      if (bmDynTotalBadge) bmDynTotalBadge.textContent = "0";
      updateMobileSlotBadges();
      showBmTgAlert(data.detail || "Не удалось получить список групп с сервера BM", "error");
      if (bmModalStatusText) bmModalStatusText.textContent = window.t ? window.t("bmtg_static.sync_error") : "Ошибка синхронизации";
      return;
    }

    if (data.device_id && bmModalDeviceBadge && hs) {
      bmModalDeviceBadge.textContent = `${hs.name || "Хотспот"} (ID: ${data.device_id})`;
    }

    if (data.tg_names) {
      Object.assign((window.TG_NAMES || {}), data.tg_names);
      localStorage.setItem("proxdmr_tg_names_cache", JSON.stringify((window.TG_NAMES || {})));
    }

    staticTgsTs1 = data.ts1 || [];
    staticTgsTs2 = data.ts2 || [];
    dynamicTgsTs1 = data.dynamic_ts1 || [];
    dynamicTgsTs2 = data.dynamic_ts2 || [];
    selectedTs1.clear();
    selectedTs2.clear();

    renderSlotList(1);
    renderSlotList(2);
    renderDynamicSlotList(1);
    renderDynamicSlotList(2);

    if (bmStaticTotalBadge) bmStaticTotalBadge.textContent = staticTgsTs1.length + staticTgsTs2.length;
    if (bmDynTotalBadge) bmDynTotalBadge.textContent = dynamicTgsTs1.length + dynamicTgsTs2.length;
    updateMobileSlotBadges();

    const timeStr = new Date().toLocaleTimeString();
    if (bmModalStatusText) {
      bmModalStatusText.textContent = window.t 
        ? window.t("bmtg_static.synced_at", { time: timeStr, ts1: staticTgsTs1.length, ts2: staticTgsTs2.length })
        : `Синхронизировано в ${timeStr} (TS1: ${staticTgsTs1.length}, TS2: ${staticTgsTs2.length})`;
    }
  } catch (err) {
    staticTgsTs1 = [];
    staticTgsTs2 = [];
    dynamicTgsTs1 = [];
    dynamicTgsTs2 = [];
    selectedTs1.clear();
    selectedTs2.clear();
    renderSlotList(1);
    renderSlotList(2);
    renderDynamicSlotList(1);
    renderDynamicSlotList(2);
    if (bmStaticTotalBadge) bmStaticTotalBadge.textContent = "0";
    if (bmDynTotalBadge) bmDynTotalBadge.textContent = "0";
    updateMobileSlotBadges();
    showBmTgAlert("Ошибка сети при обращении к серверу: " + err, "error");
    if (bmModalStatusText) bmModalStatusText.textContent = window.t ? window.t("bmtg_static.net_error") : "Сетевая ошибка";
  } finally {
    isBmTgLoading = false;
    if (bmTgModalLoading) bmTgModalLoading.classList.add("hidden");
  }
}

function renderSlotList(slot) {
  const isSlot1 = slot === 1;
  const items = isSlot1 ? staticTgsTs1 : staticTgsTs2;
  const selectedSet = isSlot1 ? selectedTs1 : selectedTs2;
  const listEl = isSlot1 ? bmTs1List : bmTs2List;
  const countEl = isSlot1 ? bmTs1Count : bmTs2Count;
  const chkAllEl = isSlot1 ? chkSelectAllTs1 : chkSelectAllTs2;
  const btnBulkDelEl = isSlot1 ? btnDeleteSelectedTs1 : btnDeleteSelectedTs2;
  const selCountEl = isSlot1 ? selCountTs1 : selCountTs2;

  if (!listEl) return;

  if (countEl) {
    const gText = items.length === 1
      ? (window.t ? window.t("bmtg_static.group_one", { count: items.length }) : `${items.length} группа`)
      : (window.t ? window.t("bmtg_static.groups_count", { count: items.length }) : `${items.length} групп`);
    countEl.textContent = gText;
  }

  if (selCountEl) selCountEl.textContent = selectedSet.size;
  if (btnBulkDelEl) {
    btnBulkDelEl.classList.toggle("disabled", selectedSet.size === 0);
    btnBulkDelEl.disabled = selectedSet.size === 0;
  }
  if (chkAllEl) {
    chkAllEl.checked = items.length > 0 && selectedSet.size === items.length;
  }

  if (items.length === 0) {
    const noTgSlot = window.t ? window.t("bmtg_static.no_groups_ts", { slot }) : `Нет статических групп на TS${slot}`;
    listEl.innerHTML = `<div class="bm-empty-msg">${noTgSlot}</div>`;
    return;
  }

  listEl.innerHTML = "";
  items.forEach(item => {
    const tg = item.talkgroup;
    const isSelected = selectedSet.has(tg);
    const defTgName = window.t ? window.t("bmtg_static.default_group_name") : "Группа BM";
    const tgName = item.name || (window.TG_NAMES || {})[tg] || defTgName;

    const row = document.createElement("div");
    row.className = `bm-static-item ${isSelected ? "item-selected" : ""}`;

    row.innerHTML = `
      <div class="bm-static-left">
        <input type="checkbox" class="chk-tg-item" data-slot="${slot}" data-tg="${tg}" ${isSelected ? "checked" : ""}>
        <span class="bm-tg-num">TG ${tg}</span>
        <span class="bm-tg-name" data-tg="${tg}" title="${tgName}">${tgName}</span>
      </div>
      <button type="button" class="btn-del-single" data-slot="${slot}" data-tg="${tg}" title="${window.t ? window.t("bmtg_static.del_tg_title", { tg, slot }) : `Удалить TG ${tg} из TS${slot}`}">🗑️</button>
    `;

    const chk = row.querySelector(".chk-tg-item");
    chk.addEventListener("change", (e) => {
      e.stopPropagation();
      if (chk.checked) {
        selectedSet.add(tg);
      } else {
        selectedSet.delete(tg);
      }
      renderSlotList(slot);
    });

    row.addEventListener("click", (e) => {
      if (e.target.closest(".btn-del-single") || e.target.closest("input")) return;
      if (selectedSet.has(tg)) {
        selectedSet.delete(tg);
      } else {
        selectedSet.add(tg);
      }
      renderSlotList(slot);
    });

    const btnDel = row.querySelector(".btn-del-single");
    btnDel.addEventListener("click", async (e) => {
      e.stopPropagation();
      const confSingle = window.t 
        ? window.t("bmtg_static.confirm_del_single", { tg, name: tgName, slot })
        : `Удалить статическую группу TG ${tg} (${tgName}) из слота TS${slot}?`;
      const ok = await (window.showAppConfirm ? window.showAppConfirm({
        title: "Удаление статической TG",
        icon: "⚡",
        message: confSingle,
        confirmText: "Удалить",
        confirmStyle: "danger"
      }) : Promise.resolve(confirm(confSingle)));
      if (ok) {
        await executeDeleteTgs(slot, [tg]);
      }
    });

    listEl.appendChild(row);
  });

  // Background lookup for any groups that lack a descriptive name
  const unknownTgs = items
    .map(it => it.talkgroup)
    .filter(tg => !(window.TG_NAMES || {})[tg] || (window.TG_NAMES || {})[tg] === "Группа BrandMeister" || (window.TG_NAMES || {})[tg] === "Группа BM" || (window.TG_NAMES || {})[tg] === `TG ${tg}`);

  if (unknownTgs.length > 0) {
    fetch("/api/tg/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ talkgroups: unknownTgs })
    })
      .then(r => r.json())
      .then(res => {
        if (res.status === "ok" && res.names) {
          Object.assign((window.TG_NAMES || {}), res.names);
          localStorage.setItem("proxdmr_tg_names_cache", JSON.stringify((window.TG_NAMES || {})));
          Object.entries(res.names).forEach(([tgId, name]) => {
            document.querySelectorAll(`.bm-tg-name[data-tg="${tgId}"]`).forEach(el => {
              el.textContent = name;
              el.title = name;
            });
          });
        }
      })
      .catch(() => {});
  }
}

if (chkSelectAllTs1) {
  chkSelectAllTs1.addEventListener("change", () => {
    if (chkSelectAllTs1.checked) {
      staticTgsTs1.forEach(item => selectedTs1.add(item.talkgroup));
    } else {
      selectedTs1.clear();
    }
    renderSlotList(1);
  });
}

if (chkSelectAllTs2) {
  chkSelectAllTs2.addEventListener("change", () => {
    if (chkSelectAllTs2.checked) {
      staticTgsTs2.forEach(item => selectedTs2.add(item.talkgroup));
    } else {
      selectedTs2.clear();
    }
    renderSlotList(2);
  });
}

if (btnDeleteSelectedTs1) {
  btnDeleteSelectedTs1.addEventListener("click", async () => {
    const tgs = Array.from(selectedTs1);
    if (tgs.length === 0) return;
    const confMulti1 = window.t
      ? window.t("bmtg_static.confirm_del_multi", { count: tgs.length, slot: 1 })
      : `Удалить выбранные группы (${tgs.length}) из таймслота TS1?`;
    const ok = await (window.showAppConfirm ? window.showAppConfirm({
      title: "Удаление групп TS1",
      icon: "⚡",
      message: confMulti1,
      confirmText: "Удалить",
      confirmStyle: "danger"
    }) : Promise.resolve(confirm(confMulti1)));
    if (ok) {
      await executeDeleteTgs(1, tgs);
    }
  });
}

if (btnDeleteSelectedTs2) {
  btnDeleteSelectedTs2.addEventListener("click", async () => {
    const tgs = Array.from(selectedTs2);
    if (tgs.length === 0) return;
    const confMulti2 = window.t
      ? window.t("bmtg_static.confirm_del_multi", { count: tgs.length, slot: 2 })
      : `Удалить выбранные группы (${tgs.length}) из таймслота TS2?`;
    const ok = await (window.showAppConfirm ? window.showAppConfirm({
      title: "Удаление групп TS2",
      icon: "⚡",
      message: confMulti2,
      confirmText: "Удалить",
      confirmStyle: "danger"
    }) : Promise.resolve(confirm(confMulti2)));
    if (ok) {
      await executeDeleteTgs(2, tgs);
    }
  });
}

async function executeDeleteTgs(slot, tgs) {
  if (!tgs || tgs.length === 0) return;
  showBmTgAlert(null);

  // If deleting more than 5 groups, offload to background task
  if (tgs.length > 5) {
    if (bmModalStatusText) bmModalStatusText.textContent = `Запуск фонового удаления ${tgs.length} групп из TS${slot}...`;
    try {
      const resp = await fetch("/api/bm/static-groups/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotspot_id: currentStaticModalHotspotId,
          slot: slot,
          talkgroups: tgs,
          action: "delete",
          filename: "Пакетное удаление"
        })
      });
      const res = await resp.json();
      if (res.status === "ok" && res.task) {
        currentBmImportTask = res.task;
        updateBmImportUI(currentBmImportTask);
        showToast((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_bg_delete_started", { count: tgs.length }, `Фоновое удаление ${tgs.length} групп запущено. Окно можно закрыть.`) : `Фоновое удаление ${tgs.length} групп запущено. Окно можно закрыть.`, 3500);
      } else if (res.status === "busy") {
        if (res.task) {
          currentBmImportTask = res.task;
          updateBmImportUI(res.task);
        }
        showBmTgAlert(res.message || "Операция с группами уже выполняется", "info");
      } else {
        showBmTgAlert("Ошибка запуска удаления: " + (res.detail || res.message || "Неизвестная ошибка BM"), "error");
      }
    } catch (err) {
      showBmTgAlert("Сетевая ошибка при удалении: " + err, "error");
    }
    return;
  }

  // 5 or fewer groups: fast synchronous deletion
  if (bmModalStatusText) bmModalStatusText.textContent = `Удаление TG из TS${slot}...`;
  try {
    const resp = await fetch("/api/bm/static-groups", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotspot_id: currentStaticModalHotspotId,
        slot: slot,
        talkgroups: tgs
      })
    });
    const res = await resp.json();
    if (res.status === "ok") {
      if (res.background && res.task) {
        currentBmImportTask = res.task;
        updateBmImportUI(currentBmImportTask);
        showToast((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_bg_delete_started", { count: tgs.length }, `Фоновое удаление ${tgs.length} групп запущено. Окно можно закрыть.`) : `Фоновое удаление ${tgs.length} групп запущено. Окно можно закрыть.`, 3500);
      } else {
        showBmTgAlert(`Успешно удалено групп: ${res.deleted ? res.deleted.length : tgs.length}`, "success");
        await loadBmTgStaticGroups(currentStaticModalHotspotId);
      }
    } else {
      showBmTgAlert(res.detail || "Ошибка удаления групп", "error");
    }
  } catch (err) {
    showBmTgAlert("Ошибка сети при удалении: " + err, "error");
  }
}

async function executeBatchAddTgs(slot, tgs, sourceTitle = "") {
  if (!tgs || tgs.length === 0) return;
  const validTgs = tgs.map(Number).filter(x => x > 0 && x <= 9999999);
  if (validTgs.length === 0) return;

  // If adding more than 5 groups, offload to background task
  if (validTgs.length > 5) {
    showBmTgAlert(null);
    if (bmModalStatusText) bmModalStatusText.textContent = `Запуск фонового добавления ${validTgs.length} групп в TS${slot}...`;
    try {
      const resp = await fetch("/api/bm/static-groups/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotspot_id: currentStaticModalHotspotId,
          slot: slot,
          talkgroups: validTgs,
          action: "add",
          filename: sourceTitle || "Пакетное добавление"
        })
      });
      const res = await resp.json();
      if (res.status === "ok" && res.task) {
        currentBmImportTask = res.task;
        updateBmImportUI(currentBmImportTask);
        showToast((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_bg_add_started", { count: validTgs.length }, `Фоновое добавление ${validTgs.length} групп запущено. Окно можно закрыть.`) : `Фоновое добавление ${validTgs.length} групп запущено. Окно можно закрыть.`, 3500);
      } else if (res.status === "busy") {
        if (res.task) {
          currentBmImportTask = res.task;
          updateBmImportUI(res.task);
        }
        showBmTgAlert(res.message || "Операция с группами уже выполняется", "info");
      } else {
        showBmTgAlert("Ошибка запуска добавления: " + (res.detail || res.message || "Неизвестная ошибка BM"), "error");
      }
    } catch (err) {
      showBmTgAlert("Сетевая ошибка: " + err, "error");
    }
    return;
  }

  // 5 or fewer groups: sequential addition
  for (const tg of validTgs) {
    await executeAddTg(slot, tg);
  }
}
window.executeBatchAddTgs = executeBatchAddTgs;
window.executeDeleteTgs = executeDeleteTgs;

async function executeAddTg(slot, tg) {
  if (!tg || tg <= 0 || tg > 9999999) {
    showBmTgAlert("Пожалуйста, введите корректный номер TalkGroup (1-9999999)", "error");
    return;
  }
  showBmTgAlert(null);
  if (bmModalStatusText) bmModalStatusText.textContent = `Добавление TG ${tg} в TS${slot}...`;
  try {
    const resp = await fetch("/api/bm/static-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotspot_id: currentStaticModalHotspotId,
        slot: slot,
        talkgroup: tg,
        talkgroups: [tg]
      })
    });
    const res = await resp.json();
    if (res.status === "ok") {
      showBmTgAlert(`TG ${tg} успешно добавлена в слот TS${slot}!`, "success");
      await loadBmTgStaticGroups(currentStaticModalHotspotId);
    } else {
      showBmTgAlert(res.detail || "Ошибка добавления группы в BM", "error");
    }
  } catch (err) {
    showBmTgAlert("Ошибка сети при добавлении: " + err, "error");
  }
}

if (btnAddTgTs1 && inputAddTgTs1) {
  btnAddTgTs1.addEventListener("click", () => {
    const val = parseInt(inputAddTgTs1.value, 10);
    if (val > 0) {
      executeAddTg(1, val);
      inputAddTgTs1.value = "";
    }
  });
  inputAddTgTs1.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnAddTgTs1.click();
    }
  });
}

if (btnAddPresetTs1 && selectPresetTs1) {
  btnAddPresetTs1.addEventListener("click", () => {
    const val = parseInt(selectPresetTs1.value, 10);
    if (val > 0) {
      executeAddTg(1, val);
      selectPresetTs1.value = "";
    }
  });
}

if (btnAddTgTs2 && inputAddTgTs2) {
  btnAddTgTs2.addEventListener("click", () => {
    const val = parseInt(inputAddTgTs2.value, 10);
    if (val > 0) {
      executeAddTg(2, val);
      inputAddTgTs2.value = "";
    }
  });
  inputAddTgTs2.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnAddTgTs2.click();
    }
  });
}

if (btnAddPresetTs2 && selectPresetTs2) {
  btnAddPresetTs2.addEventListener("click", () => {
    const val = parseInt(selectPresetTs2.value, 10);
    if (val > 0) {
      executeAddTg(2, val);
      selectPresetTs2.value = "";
    }
  });
}

// --- File Import & Export for BrandMeister Static Groups ---
function parseTgIdsFromText(text) {
  if (!text) return { totalCount: 0, validCount: 0, uniqueIds: [] };
  const lines = text.split(/\r?\n/);
  const validIds = [];
  let totalCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Skip empty lines and comment headers
    if (!line || line.startsWith("#") || line.startsWith("//") || line.startsWith(";")) continue;

    // Match the primary TG number at start of line, e.g. "2501 # Russia" or "2501,Russia" or "2501"
    const match = line.match(/^(\d{1,8})\b/);
    if (match) {
      totalCount++;
      const id = parseInt(match[1], 10);
      if (id >= 1 && id <= 16777215) {
        validIds.push(id);
      }
    } else {
      // Fallback: match any number in line (for space or comma delimited numbers)
      const anyMatches = line.match(/\b\d{1,8}\b/g) || [];
      anyMatches.forEach(m => {
        totalCount++;
        const id = parseInt(m, 10);
        if (id >= 1 && id <= 16777215) {
          validIds.push(id);
        }
      });
    }
  }

  // If line-by-line parsing yielded nothing, fallback to global regex
  if (validIds.length === 0) {
    const matches = text.match(/\b\d{1,8}\b/g) || [];
    const allNumbers = matches.map(m => parseInt(m, 10));
    const fallbackValid = allNumbers.filter(id => !isNaN(id) && id >= 1 && id <= 16777215);
    return {
      totalCount: allNumbers.length,
      validCount: fallbackValid.length,
      uniqueIds: Array.from(new Set(fallbackValid))
    };
  }

  const uniqueIds = Array.from(new Set(validIds));
  return {
    totalCount: totalCount,
    validCount: validIds.length,
    uniqueIds: uniqueIds
  };
}

function exportSlotTgsToFile(slot) {
  const isSlot1 = slot === 1;
  const items = isSlot1 ? staticTgsTs1 : staticTgsTs2;
  if (!items || items.length === 0) {
    showBmTgAlert(window.t ? window.t("bmtg_static.no_groups_ts", { slot }) : `В слоте TS${slot} нет статических групп для экспорта.`, "info");
    return;
  }

  const curHid = currentStaticModalHotspotId || window.activeHotspotId || "default";
  const hs = window.currentHotspots.find(h => h.id === curHid) || window.currentHotspots[0] || {};
  const hsName = hs.name ? hs.name.replace(/[^\w\d_-]+/g, "_") : "hotspot";
  const dmrId = hs.dmr_id || "";

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8);

  const lines = [
    `# ProxDMR BrandMeister Static TalkGroups Export`,
    `# Timeslot: TS${slot}`,
    `# Hotspot: ${hs.name || 'Default'} (DMR ID: ${dmrId})`,
    `# Exported: ${dateStr} ${timeStr}`,
    `# Total Groups: ${items.length}`,
    `# ----------------------------------------------------`
  ];

  // Sort by TG ID numerically
  const sorted = [...items].sort((a, b) => Number(a.talkgroup) - Number(b.talkgroup));
  sorted.forEach(it => {
    const tg = it.talkgroup;
    const name = it.name || (window.TG_NAMES || {})[tg] || "";
    if (name && !name.startsWith("TG ")) {
      lines.push(`${tg} # ${name}`);
    } else {
      lines.push(`${tg}`);
    }
  });

  const fileContent = lines.join("\n") + "\n";
  const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const filename = `bm_static_tgs_ts${slot}_${hsName}_${dateStr}.txt`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (typeof showToast === "function") {
    showToast((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_exported", { count: items.length, slot, filename }, `📤 Экспортировано ${items.length} групп из TS${slot} в файл ${filename}`) : `📤 Экспортировано ${items.length} групп из TS${slot} в файл ${filename}`, 2800);
  } else {
    showBmTgAlert(`Экспортировано ${items.length} групп из TS${slot} в файл ${filename}`, "success");
  }
}

function handleFileSelected(slot, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result || "";
    const parsed = parseTgIdsFromText(content);

    if (parsed.uniqueIds.length === 0) {
      const msg = "В выбранном файле не найдено корректных номеров TalkGroup (целые положительные числа).";
      if (window.showAppAlert) {
        window.showAppAlert(msg, { title: "Импорт TalkGroups", icon: "⚠️" });
      } else {
        alert(msg);
      }
      return;
    }

    const currentGroups = (slot === 1 ? staticTgsTs1 : staticTgsTs2).map(g => Number(g.talkgroup));
    const currentSet = new Set(currentGroups);
    const alreadyInSlot = parsed.uniqueIds.filter(id => currentSet.has(id));
    const newToAdd = parsed.uniqueIds.filter(id => !currentSet.has(id));

    if (bmFileStatName) {
      const sizeStr = file.size < 1024 ? `${file.size} байт` : `${(file.size / 1024).toFixed(1)} КБ`;
      bmFileStatName.textContent = `${file.name} (${sizeStr})`;
    }
    if (bmFileStatSlotBadge) {
      bmFileStatSlotBadge.textContent = `TS ${slot}`;
      bmFileStatSlotBadge.className = `bm-slot-badge ts${slot}-badge`;
    }
    if (bmStatFound) bmStatFound.textContent = parsed.totalCount;
    if (bmStatUnique) bmStatUnique.textContent = parsed.uniqueIds.length;
    if (bmStatAlready) bmStatAlready.textContent = alreadyInSlot.length;
    if (bmStatNew) bmStatNew.textContent = newToAdd.length;

    if (bmFilePreviewList) {
      bmFilePreviewList.innerHTML = "";
      if (newToAdd.length === 0) {
        bmFilePreviewList.innerHTML = `<span style="font-size:0.75rem; color:var(--text-muted); font-style:italic;">Все найденные группы (${alreadyInSlot.length}) уже присутствуют в слоте TS${slot}.</span>`;
      } else {
        newToAdd.forEach(tg => {
          const badge = document.createElement("span");
          badge.className = "bm-preview-badge";
          badge.setAttribute("data-tg", tg);
          const name = (window.TG_NAMES || {})[tg];
          badge.textContent = name ? `TG ${tg} (${name})` : `TG ${tg}`;
          bmFilePreviewList.appendChild(badge);
        });

        // If some groups don't have known names yet, look them up immediately
        const missingNames = newToAdd.filter(tg => !(window.TG_NAMES || {})[tg] || (window.TG_NAMES || {})[tg].startsWith("TG "));
        if (missingNames.length > 0) {
          fetch("/api/tg/lookup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ talkgroups: missingNames })
          })
            .then(r => r.json())
            .then(res => {
              if (res.status === "ok" && res.names) {
                Object.assign((window.TG_NAMES || {}), res.names);
                localStorage.setItem("proxdmr_tg_names_cache", JSON.stringify((window.TG_NAMES || {})));
                Object.entries(res.names).forEach(([tgId, name]) => {
                  const badge = bmFilePreviewList.querySelector(`.bm-preview-badge[data-tg="${tgId}"]`);
                  if (badge) {
                    badge.textContent = `TG ${tgId} (${name})`;
                  }
                });
              }
            })
            .catch(() => {});
        }
      }
    }

    if (bmFileConfirmPrompt && btnConfirmFileImport) {
      if (newToAdd.length === 0) {
        bmFileConfirmPrompt.textContent = window.t
          ? window.t("bm_file.prompt_all_present", { count: parsed.uniqueIds.length, slot })
          : `Все ${parsed.uniqueIds.length} групп уже присутствуют в слоте TS${slot}. Новых групп для добавления нет.`;
        btnConfirmFileImport.style.display = "none";
      } else {
        bmFileConfirmPrompt.textContent = window.t
          ? window.t("bm_file.prompt_continue", { count: newToAdd.length, slot })
          : `Продолжить добавление ${newToAdd.length} новых групп в слот TS${slot}?`;
        btnConfirmFileImport.style.display = "";
      }
    }

    pendingFileImport = {
      slot: slot,
      fileName: file.name,
      groupsToAdd: newToAdd
    };

    if (bmFileConfirmModal) {
      bmFileConfirmModal.classList.add("active");
      pushNavState("modal", "bmFileConfirmModal");
    }
  };
  reader.onerror = () => {
    const msg = window.t ? window.t("bm_file.err_read") : "Не удалось прочитать файл. Попробуйте другой текстовый файл.";
    if (window.showAppAlert) {
      window.showAppAlert(msg, { title: "Ошибка чтения", icon: "⚠️" });
    } else {
      alert(msg);
    }
  };
  reader.readAsText(file, "UTF-8");
}

// Bind file upload and export buttons
if (btnUploadFileTs1 && inputFileTs1) {
  btnUploadFileTs1.addEventListener("click", () => {
    inputFileTs1.value = "";
    inputFileTs1.click();
  });
  inputFileTs1.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFileSelected(1, file);
  });
}

if (btnExportFileTs1) {
  btnExportFileTs1.addEventListener("click", () => exportSlotTgsToFile(1));
}

if (btnUploadFileTs2 && inputFileTs2) {
  btnUploadFileTs2.addEventListener("click", () => {
    inputFileTs2.value = "";
    inputFileTs2.click();
  });
  inputFileTs2.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFileSelected(2, file);
  });
}

if (btnExportFileTs2) {
  btnExportFileTs2.addEventListener("click", () => exportSlotTgsToFile(2));
}

// Confirmation modal handlers
if (closeFileConfirmBtn && bmFileConfirmModal) {
  closeFileConfirmBtn.addEventListener("click", () => {
    bmFileConfirmModal.classList.remove("active");
    pendingFileImport = null;
    notifyNavClosed();
  });
}

if (btnCancelFileImport && bmFileConfirmModal) {
  btnCancelFileImport.addEventListener("click", () => {
    bmFileConfirmModal.classList.remove("active");
    pendingFileImport = null;
    notifyNavClosed();
  });
}

if (bmFileConfirmModal) {
  bmFileConfirmModal.addEventListener("click", (e) => {
    if (e.target === bmFileConfirmModal) {
      bmFileConfirmModal.classList.remove("active");
      pendingFileImport = null;
      notifyNavClosed();
    }
  });
}

// --- BM Background Import UI & Logic ---

function findHotspotCard(hid) {
  const targetHid = resolveHotspotId(hid);
  if (targetHid) {
    const card = document.querySelector(`.radio-container[data-hotspot-id="${targetHid}"]`);
    if (card) return card;
  }
  if (hid && hid !== targetHid) {
    const card = document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`);
    if (card) return card;
  }
  const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
  if (!hid || hid === "default" || (hsList.length && hsList[0]?.id === hid)) {
    return document.querySelector(".radio-container");
  }
  if (typeof window !== "undefined" && window.activeHotspotId) {
    const card = document.querySelector(`.radio-container[data-hotspot-id="${window.activeHotspotId}"]`);
    if (card) return card;
  }
  return document.querySelector(".radio-container");
}

function hideAllBmUploadIndicators() {
  document.querySelectorAll(".header-bm-upload-indicator").forEach(el => {
    el.style.display = "none";
  });
}

function updateBmImportUI(task) {
  if (!task) {
    hideAllBmUploadIndicators();
    if (bmImportProgressCard) bmImportProgressCard.classList.add("hidden");
    return;
  }

  const isDelete = (task.action === "delete");
  const actName = isDelete ? "Удаление" : "Импорт";
  const actPrep = isDelete ? "из" : "в";
  const actPast = isDelete ? "удалено" : "добавлено";
  const actGen = isDelete ? "удаления" : "импорта";

  const current = task.current !== undefined ? task.current : (task.processed || 0);
  const total = task.total || 0;
  const percent = task.percent !== undefined ? task.percent : (total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0);
  const errorCount = task.error_count !== undefined ? task.error_count : (Array.isArray(task.errors) ? task.errors.length : (task.errors || 0));
  const doneCount = isDelete
    ? (task.deleted_count !== undefined ? task.deleted_count : (Array.isArray(task.deleted) ? task.deleted.length : 0))
    : (task.added_count !== undefined ? task.added_count : (task.imported || (Array.isArray(task.added) ? task.added.length : 0)));
  const isErr = task.status === "error" || task.status === "failed";

  // 1. Header Indicator on the target hotspot card
  const targetHid = task.hotspot_id || currentStaticModalHotspotId || (typeof window !== "undefined" ? window.activeHotspotId : null);
  const targetCard = findHotspotCard(targetHid);
  const targetIndicator = targetCard ? targetCard.querySelector(".header-bm-upload-indicator") : document.getElementById("headerBmUploadIndicator");
  const targetPercent = targetIndicator ? targetIndicator.querySelector(".bm-upload-percent") : document.getElementById("headerBmUploadPercent");

  // Hide all indicators except the target one
  document.querySelectorAll(".header-bm-upload-indicator").forEach(el => {
    if (el !== targetIndicator) {
      el.style.display = "none";
    }
  });

  if (targetIndicator) {
    if (task.status === "running") {
      targetIndicator.style.display = "inline-flex";
      if (targetPercent) targetPercent.textContent = `${percent}%`;
      const devStr = task.device_id ? ` (ID: ${task.device_id})` : "";
      targetIndicator.title = `${actName} TalkGroups ${actPrep} BrandMeister${devStr}: ${current}/${total} (${percent}%) - нажмите для перехода`;
    } else if (task.status === "completed") {
      targetIndicator.style.display = "inline-flex";
      if (targetPercent) targetPercent.textContent = "100%";
      targetIndicator.title = `${actName} TalkGroups ${actPrep} BrandMeister завершено`;
    } else {
      targetIndicator.style.display = "none";
    }
  }

  // 2. Modal Progress Card
  if (bmImportProgressCard) {
    if (task.status === "running" || task.status === "completed" || task.status === "cancelled" || isErr) {
      bmImportProgressCard.classList.remove("hidden");
    }

    if (bmImportProgressPercent) {
      bmImportProgressPercent.textContent = `${percent}%`;
    }
    if (bmImportBarFill) {
      bmImportBarFill.style.width = `${percent}%`;
    }
    if (bmImportProgressSlot) {
      bmImportProgressSlot.textContent = `TS ${task.slot || 1}`;
    }

    if (bmImportProgressCount) {
      const skippedText = task.skipped ? ` (${task.skipped} уже есть)` : "";
      bmImportProgressCount.textContent = `${current} / ${total} групп${skippedText}`;
    }

    if (bmImportProgressErrors) {
      if (errorCount > 0) {
        bmImportProgressErrors.style.display = "inline-flex";
        bmImportProgressErrors.textContent = `${errorCount} ошибок BM`;
      } else {
        bmImportProgressErrors.style.display = "none";
      }
    }

    if (bmImportProgressTitleText) {
      if (task.status === "running") {
        const curTg = task.current_tg ? ` (TG ${task.current_tg})` : "";
        bmImportProgressTitleText.textContent = `${actName} TalkGroups ${actPrep} BrandMeister${curTg}`;
        if (btnCancelBmImport) {
          btnCancelBmImport.disabled = false;
          btnCancelBmImport.textContent = "Отменить";
          btnCancelBmImport.style.display = "";
        }
      } else if (task.status === "completed") {
        bmImportProgressTitleText.textContent = `${actName} успешно завершено (${doneCount} ${actPast})`;
        if (btnCancelBmImport) btnCancelBmImport.style.display = "none";
      } else if (task.status === "cancelled") {
        bmImportProgressTitleText.textContent = isDelete
          ? ((typeof window !== "undefined" && window.t) ? window.t("bmtg.delete_cancelled_by_user", {}, "Удаление отменено пользователем") : "Удаление отменено пользователем")
          : ((typeof window !== "undefined" && window.t) ? window.t("bmtg.import_cancelled_by_user", {}, "Импорт отменен пользователем") : "Импорт отменен пользователем");
        if (btnCancelBmImport) btnCancelBmImport.style.display = "none";
      } else if (isErr) {
        const errMsg = task.message || task.error_message || "Сбой BM API";
        bmImportProgressTitleText.textContent = isDelete
          ? ((typeof window !== "undefined" && window.t) ? window.t("bmtg.delete_error", { error: errMsg }, `Ошибка удаления: ${errMsg}`) : `Ошибка удаления: ${errMsg}`)
          : ((typeof window !== "undefined" && window.t) ? window.t("bmtg.import_error", { error: errMsg }, `Ошибка импорта: ${errMsg}`) : `Ошибка импорта: ${errMsg}`);
        if (btnCancelBmImport) btnCancelBmImport.style.display = "none";
      }
    }
  }
}

function onBmImportProgress(data) {
  currentBmImportTask = data;
  if (bmImportFinishedTimer) {
    clearTimeout(bmImportFinishedTimer);
    bmImportFinishedTimer = null;
  }
  updateBmImportUI(data);
}

function onBmImportFinished(data) {
  currentBmImportTask = data;
  updateBmImportUI(data);

  const isDelete = (data.action === "delete");
  const actName = isDelete ? "Удаление" : "Импорт";
  const actPrep = isDelete ? "из" : "в";
  const actPast = isDelete ? "удалено" : "добавлено";
  const actGen = isDelete ? "удаления" : "импорта";

  if (isDelete) {
    selectedTs1.clear();
    selectedTs2.clear();
    renderSlotList(1);
    renderSlotList(2);
  }

  // If modal is open, reload static groups
  if (bmTgStaticModal && bmTgStaticModal.classList.contains("active")) {
    loadBmTgStaticGroups(currentStaticModalHotspotId);
  }

  const current = data.current !== undefined ? data.current : (data.processed || 0);
  const total = data.total || 0;
  const doneCount = isDelete
    ? (data.deleted_count !== undefined ? data.deleted_count : (Array.isArray(data.deleted) ? data.deleted.length : 0))
    : (data.added_count !== undefined ? data.added_count : (data.imported || 0));
  const isErr = data.status === "error" || data.status === "failed";

  // Toast feedback
  if (data.status === "completed") {
    const msg = isDelete
      ? ((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_delete_completed", { count: doneCount, slot: data.slot }, `Удаление из BrandMeister завершено: удалено ${doneCount} групп в TS${data.slot}`) : `Удаление из BrandMeister завершено: удалено ${doneCount} групп в TS${data.slot}`)
      : ((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_import_completed", { count: doneCount, slot: data.slot }, `Импорт в BrandMeister завершено: добавлено ${doneCount} групп в TS${data.slot}`) : `Импорт в BrandMeister завершено: добавлено ${doneCount} групп в TS${data.slot}`);
    showToast(msg, 4000);
  } else if (data.status === "cancelled") {
    const msg = isDelete
      ? ((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_delete_cancelled", { current, total }, `Удаление из BrandMeister остановлено (${current}/${total} обработано)`) : `Удаление из BrandMeister остановлено (${current}/${total} обработано)`)
      : ((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_import_cancelled", { current, total }, `Импорт в BrandMeister остановлено (${current}/${total} обработано)`) : `Импорт в BrandMeister остановлено (${current}/${total} обработано)`);
    showToast(msg, 3000);
  } else if (isErr) {
    const errMsg = data.message || data.error_message || "Неизвестная ошибка";
    const msg = isDelete
      ? ((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_delete_error", { error: errMsg }, `Ошибка удаления в BM: ${errMsg}`) : `Ошибка удаления в BM: ${errMsg}`)
      : ((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_import_error", { error: errMsg }, `Ошибка импорта в BM: ${errMsg}`) : `Ошибка импорта в BM: ${errMsg}`);
    showToast(msg, 5000);
  }

  // Fade out / hide after 4.5 seconds
  if (bmImportFinishedTimer) clearTimeout(bmImportFinishedTimer);
  bmImportFinishedTimer = setTimeout(() => {
    hideAllBmUploadIndicators();
    if (bmImportProgressCard) bmImportProgressCard.classList.add("hidden");
    currentBmImportTask = null;
    bmImportFinishedTimer = null;
  }, 4500);
}

async function checkBmImportStatus() {
  try {
    const resp = await fetch("/api/bm/static-groups/import/status");
    if (!resp.ok) return;
    const res = await resp.json();
    if (res.status === "ok" && res.task && res.task.status === "running") {
      currentBmImportTask = res.task;
      updateBmImportUI(res.task);
    } else {
      if (!currentBmImportTask || currentBmImportTask.status !== "running") {
        hideAllBmUploadIndicators();
        if (bmImportProgressCard) bmImportProgressCard.classList.add("hidden");
      }
    }
  } catch (e) {
    // Non-fatal network glitch
  }
}

if (btnConfirmFileImport) {
  btnConfirmFileImport.addEventListener("click", async () => {
    if (!pendingFileImport || pendingFileImport.groupsToAdd.length === 0) return;
    const { slot, fileName, groupsToAdd } = pendingFileImport;
    if (bmFileConfirmModal) bmFileConfirmModal.classList.remove("active");
    pendingFileImport = null;

    showBmTgAlert(null);
    if (bmModalStatusText) {
      bmModalStatusText.textContent = `Запуск фонового импорта ${groupsToAdd.length} групп в TS${slot}...`;
    }

    try {
      const resp = await fetch("/api/bm/static-groups/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotspot_id: currentStaticModalHotspotId,
          slot: slot,
          talkgroups: groupsToAdd,
          filename: fileName
        })
      });
      const res = await resp.json();
      if (res.status === "ok" && res.task) {
        currentBmImportTask = res.task;
        updateBmImportUI(currentBmImportTask);
        showToast((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_bg_import_started", { count: groupsToAdd.length }, `Импорт ${groupsToAdd.length} групп запущен в фоновом режиме. Окно можно закрыть.`) : `Импорт ${groupsToAdd.length} групп запущен в фоновом режиме. Окно можно закрыть.`, 3500);
      } else if (res.status === "busy") {
        if (res.task) {
          currentBmImportTask = res.task;
          updateBmImportUI(res.task);
        }
        showBmTgAlert(res.message || "Импорт уже выполняется", "info");
      } else {
        showBmTgAlert("Ошибка запуска импорта: " + (res.detail || res.message || "Неизвестная ошибка BM"), "error");
      }
    } catch (err) {
      showBmTgAlert("Сетевая ошибка при запуске импорта: " + err, "error");
    }
  });
}

// Global delegated click & keydown handlers for any hotspot's BM upload indicator
document.addEventListener("click", (e) => {
  const ind = e.target.closest(".header-bm-upload-indicator");
  if (!ind) return;
  const card = ind.closest(".radio-container");
  const rawHid = card?.dataset?.hotspotId || currentBmImportTask?.hotspot_id || currentStaticModalHotspotId || (typeof window !== "undefined" ? window.activeHotspotId : null);
  const hid = resolveHotspotId(rawHid);
  openBmTgStaticModal(hid);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const ind = e.target.closest(".header-bm-upload-indicator");
  if (!ind) return;
  e.preventDefault();
  const card = ind.closest(".radio-container");
  const rawHid = card?.dataset?.hotspotId || currentBmImportTask?.hotspot_id || currentStaticModalHotspotId || (typeof window !== "undefined" ? window.activeHotspotId : null);
  const hid = resolveHotspotId(rawHid);
  openBmTgStaticModal(hid);
});

if (btnMinimizeBmImport) {
  btnMinimizeBmImport.addEventListener("click", () => {
    closeBmTgStaticModal();
    const act = (currentBmImportTask && currentBmImportTask.action === "delete") ? "Удаление" : "Импорт";
    showToast((typeof window !== "undefined" && window.t) ? window.t("bmtg.toast_bg_action_continue", { action: act }, `${act} продолжается в фоновом режиме. Статус отображается в шапке.`) : `${act} продолжается в фоновом режиме. Статус отображается в шапке.`, 3000);
  });
}

if (btnCancelBmImport) {
  btnCancelBmImport.addEventListener("click", async () => {
    if (!currentBmImportTask || currentBmImportTask.status !== "running") return;
    btnCancelBmImport.disabled = true;
    btnCancelBmImport.textContent = "Отмена...";
    try {
      await fetch("/api/bm/static-groups/import/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: currentBmImportTask.task_id })
      });
    } catch (e) {
      console.error("[BM Import] Cancel error:", e);
    }
  });
}

function renderDynamicSlotList(slot) {
  const isSlot1 = slot === 1;
  const items = isSlot1 ? dynamicTgsTs1 : dynamicTgsTs2;
  const listEl = isSlot1 ? bmDynTs1List : bmDynTs2List;
  const countEl = isSlot1 ? bmDynTs1Count : bmDynTs2Count;

  if (countEl) {
    const gText = items.length === 1
      ? (window.t ? window.t("bmtg_static.group_one", { count: items.length }) : `${items.length} группа`)
      : (window.t ? window.t("bmtg_static.groups_count", { count: items.length }) : `${items.length} групп`);
    countEl.textContent = gText;
  }

  if (!listEl) return;

  if (items.length === 0) {
    const emptyKey = isSlot1 ? "bmtg.dyn_empty_ts1" : "bmtg.dyn_empty_ts2";
    const defMsg = isSlot1 ? "Нет динамических групп на TS1" : "Нет динамических групп на TS2";
    listEl.innerHTML = `<div class="bm-empty-msg">${window.t ? window.t(emptyKey) : defMsg}</div>`;
    return;
  }

  listEl.innerHTML = "";
  items.forEach(item => {
    const tg = item.talkgroup;
    const defTgName = window.t ? window.t("bmtg_static.default_group_name") : "Группа BM";
    const tgName = item.name || (window.TG_NAMES || {})[tg] || defTgName;
    const tuneText = window.t ? window.t("bmtg.btn_tune", {}, "--->PTT") : "--->PTT";

    const row = document.createElement("div");
    row.className = "bm-dyn-item";
    row.innerHTML = `
      <div class="bm-dyn-left">
        <span class="bm-slot-badge ${isSlot1 ? "ts1-badge" : "ts2-badge"}">TS ${slot}</span>
        <span class="bm-tg-num">TG ${tg}</span>
        <span class="bm-tg-name" data-tg="${tg}" title="${tgName}">${tgName}</span>
      </div>
      <button type="button" class="btn-dyn-tune" data-slot="${slot}" data-tg="${tg}" title="Установить TG ${tg} (TS${slot}) целью передачи (PTT)">
        ${tuneText}
      </button>
    `;

    const tuneBtn = row.querySelector(".btn-dyn-tune");
    if (tuneBtn) {
      tuneBtn.addEventListener("click", () => {
        tuneToTalkgroup(tg, slot);
      });
    }

    listEl.appendChild(row);
  });

  items.forEach(item => {
    const tg = item.talkgroup;
    if (!item.name && !(window.TG_NAMES || {})[tg]) {
      fetch(`/api/bm/tg-name/${tg}`)
        .then(res => res.json())
        .then(data => {
          if (data.status === "ok" && data.name) {
            (window.TG_NAMES || {})[tg] = data.name;
            try { localStorage.setItem("proxdmr_tg_names_cache", JSON.stringify((window.TG_NAMES || {}))); } catch (e) {}
            const nameEls = listEl.querySelectorAll(`.bm-tg-name[data-tg="${tg}"]`);
            nameEls.forEach(el => {
              el.textContent = data.name;
              el.title = data.name;
            });
          }
        })
        .catch(() => {});
    }
  });
}

function tuneToTalkgroup(tg, slot) {
  const mainCard = document.getElementById("radioContainer");
  const hid = currentStaticModalHotspotId || resolveHotspotId(mainCard?.dataset.hotspotId || "default");
  const s = slot === 1 ? 1 : 2;
  if (typeof setHotspotSlot === "function") {
    setHotspotSlot(hid, s, true);
  }
  if (typeof setHotspotTg === "function") {
    setHotspotTg(hid, s, tg, true);
  }
  if (bmModalStatusText) {
    bmModalStatusText.textContent = `Трансивер настроен на TG ${tg} (TS${s})`;
  }
}

async function executeDropDynamic(slot = 0, btn = null) {
  const hid = currentStaticModalHotspotId || window.activeHotspotId;
  const origHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.innerHTML = '⏳ <span>Сброс...</span>';
    btn.disabled = true;
  }

  try {
    const payload = { hotspot_id: hid };
    if (slot === 1 || slot === 2) {
      payload.slot = slot;
    }
    const resp = await fetch("/api/bm/drop-dynamic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();

    if (res.status === "ok") {
      if (btn) {
        btn.innerHTML = '✅ <span>Сброшено!</span>';
        setTimeout(() => {
          btn.innerHTML = origHtml;
          btn.disabled = false;
        }, 1500);
      }
      if (bmModalStatusText) {
        bmModalStatusText.textContent = window.t ? window.t("bmtg.dyn_dropped") : "Динамические группы сброшены";
      }
      await loadBmTgStaticGroups(hid);
    } else {
      showBmTgAlert("Ошибка сброса: " + (res.detail || "Неизвестная ошибка"), "error");
      if (btn) {
        btn.innerHTML = origHtml;
        btn.disabled = false;
      }
    }
  } catch (err) {
    showBmTgAlert("Сетевая ошибка при сбросе: " + err, "error");
    if (btn) {
      btn.innerHTML = origHtml;
      btn.disabled = false;
    }
  }
}

async function dropDynamicTGs(targetHid, btnElement) {
  await executeDropDynamic(0, btnElement);
}

function closeBmTgStaticModal() {
  if (bmTgStaticModal && bmTgStaticModal.classList.contains("active")) {
    bmTgStaticModal.classList.remove("active");
    bmTgStaticModal.style.display = "";
    notifyNavClosed();
  }
}
window.closeBmTgStaticModal = closeBmTgStaticModal;

if (closeBmTgModalBtn) {
  closeBmTgModalBtn.addEventListener("click", closeBmTgStaticModal);
}

if (btnCloseBmTgModalBottom) {
  btnCloseBmTgModalBottom.addEventListener("click", closeBmTgStaticModal);
}

if (bmTgStaticModal) {
  bmTgStaticModal.addEventListener("click", (e) => {
    if (e.target === bmTgStaticModal) closeBmTgStaticModal();
  });
}

if (btnRefreshBmTg) {
  btnRefreshBmTg.addEventListener("click", () => {
    loadBmTgStaticGroups(currentStaticModalHotspotId);
  });
}

if (bmTabBtnStatic) {
  bmTabBtnStatic.addEventListener("click", () => switchBmTgTab("static"));
}
if (bmTabBtnDynamic) {
  bmTabBtnDynamic.addEventListener("click", () => switchBmTgTab("dynamic"));
}
document.querySelectorAll(".bm-mobile-slot-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const slot = parseInt(btn.getAttribute("data-mobile-slot"), 10);
    switchBmMobileSlot(slot);
  });
});
if (btnDropAllDynamic) {
  btnDropAllDynamic.addEventListener("click", () => executeDropDynamic(0, btnDropAllDynamic));
}
if (btnDropDynamicTs1) {
  btnDropDynamicTs1.addEventListener("click", () => executeDropDynamic(1, btnDropDynamicTs1));
}
if (btnDropDynamicTs2) {
  btnDropDynamicTs2.addEventListener("click", () => executeDropDynamic(2, btnDropDynamicTs2));
}



// --- Initialization Entry Point ---
function initBmTgStaticManager() {
  populatePresetSelects();

  if (closeBmTgModalBtn) closeBmTgModalBtn.addEventListener("click", closeBmTgStaticModal);
  if (btnCloseBmTgModalBottom) btnCloseBmTgModalBottom.addEventListener("click", closeBmTgStaticModal);
  if (bmTgStaticModal) {
    bmTgStaticModal.addEventListener("click", (e) => {
      if (e.target === bmTgStaticModal) closeBmTgStaticModal();
    });
  }
  if (btnRefreshBmTg) {
    btnRefreshBmTg.addEventListener("click", () => {
      loadBmTgStaticGroups(currentStaticModalHotspotId);
    });
  }
  if (bmTabBtnStatic) {
    bmTabBtnStatic.addEventListener("click", () => switchBmTgTab("static"));
  }
  if (bmTabBtnDynamic) {
    bmTabBtnDynamic.addEventListener("click", () => switchBmTgTab("dynamic"));
  }
  document.querySelectorAll(".bm-mobile-slot-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const slot = parseInt(btn.getAttribute("data-mobile-slot"), 10);
      switchBmMobileSlot(slot);
    });
  });
  if (btnDropAllDynamic) {
    btnDropAllDynamic.addEventListener("click", () => executeDropDynamic(0, btnDropAllDynamic));
  }
  if (btnDropDynamicTs1) {
    btnDropDynamicTs1.addEventListener("click", () => executeDropDynamic(1, btnDropDynamicTs1));
  }
  if (btnDropDynamicTs2) {
    btnDropDynamicTs2.addEventListener("click", () => executeDropDynamic(2, btnDropDynamicTs2));
  }

  checkBmImportStatus();
}

export {
  openBmTgStaticModal,
  closeBmTgStaticModal,
  loadBmTgStaticGroups,
  dropDynamicTGs,
  renderSlotList,
  renderDynamicSlotList,
  switchBmTgTab,
  switchBmMobileSlot,
  POPULAR_TG_PRESETS,
  initBmTgStaticManager,
  onBmImportProgress,
  onBmImportFinished,
  checkBmImportStatus,
  updateBmImportUI
};

if (typeof window !== "undefined") {
  window.openBmTgStaticModal = openBmTgStaticModal;
  window.closeBmTgStaticModal = closeBmTgStaticModal;
  window.loadBmTgStaticGroups = loadBmTgStaticGroups;
  window.dropDynamicTGs = dropDynamicTGs;
  window.renderSlotList = renderSlotList;
  window.initBmTgStaticManager = initBmTgStaticManager;
  window.onBmImportProgress = onBmImportProgress;
  window.onBmImportFinished = onBmImportFinished;
  window.checkBmImportStatus = checkBmImportStatus;
  window.updateBmImportUI = updateBmImportUI;

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.openBmTgStaticModal = openBmTgStaticModal;
  window.__proxdmr.closeBmTgStaticModal = closeBmTgStaticModal;
  window.__proxdmr.loadBmTgStaticGroups = loadBmTgStaticGroups;
  window.__proxdmr.dropDynamicTGs = dropDynamicTGs;

  // Immediate check on script load
  checkBmImportStatus();
}
