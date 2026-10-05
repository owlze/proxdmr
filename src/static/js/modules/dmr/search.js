/**
 * ProxDMR DMR Search Subsystem Module
 * Manages unified TG search, RadioID caller directory search,
 * TalkGroup / Caller ID action triggers, custom numeric entry,
 * and database statistics.
 */

import { safeEscapeHtml } from '../core/formatters.js';
import { pushNavState, notifyNavClosed } from '../ui/navigation.js';

// Safe window helper bridges
function openTgIdActionMenu(tgOrIdInfo) {
  if (typeof window !== "undefined" && typeof window.openTgIdActionMenu === "function") {
    return window.openTgIdActionMenu(tgOrIdInfo);
  }
}

function openBmInfoModal(queryType, tgOrIdInfo) {
  if (typeof window !== "undefined" && typeof window.openBmInfoModal === "function") {
    return window.openBmInfoModal(queryType, tgOrIdInfo);
  }
}

// Module Elements
let btnSrchTgId = typeof document !== "undefined" ? document.getElementById("btnSrchTgId") : null;
let searchTgIdModal = typeof document !== "undefined" ? (document.getElementById("searchTgIdModal") || document.getElementById("tgTxUseModal")) : null;
let closeSearchTgIdModalBtn = typeof document !== "undefined" ? document.getElementById("closeSearchTgIdModalBtn") : null;
let btnCloseSearchTgIdModalBottom = typeof document !== "undefined" ? document.getElementById("btnCloseSearchTgIdModalBottom") : null;
let tabBtnSearchTg = typeof document !== "undefined" ? document.getElementById("tabBtnSearchTg") : null;
let tabBtnSearchCallId = typeof document !== "undefined" ? document.getElementById("tabBtnSearchCallId") : null;
let searchTabPaneTg = typeof document !== "undefined" ? document.getElementById("searchTabPaneTg") : null;
let searchTabPaneId = typeof document !== "undefined" ? document.getElementById("searchTabPaneId") : null;
let tgHeaderStatsWrap = typeof document !== "undefined" ? document.getElementById("tgHeaderStatsWrap") : null;
let callHeaderStatsWrap = typeof document !== "undefined" ? document.getElementById("callHeaderStatsWrap") : null;
let tgFooterHint = typeof document !== "undefined" ? document.getElementById("tgFooterHint") : null;
let callFooterHint = typeof document !== "undefined" ? document.getElementById("callFooterHint") : null;

// Compatibility aliases
let btnTgTxUse = typeof document !== "undefined" ? (document.getElementById("btnTgTxUse") || btnSrchTgId) : null;
let btnCallId = typeof document !== "undefined" ? (document.getElementById("btnCallId") || btnSrchTgId) : null;
let tgTxUseModal = searchTgIdModal;
let closeTgTxUseModalBtn = typeof document !== "undefined" ? (document.getElementById("closeTgTxUseModalBtn") || closeSearchTgIdModalBtn) : null;
let btnCloseTgTxUseModalBottom = typeof document !== "undefined" ? (document.getElementById("btnCloseTgTxUseModalBottom") || btnCloseSearchTgIdModalBottom) : null;
let tgModalActiveTs = typeof document !== "undefined" ? document.getElementById("tgModalActiveTs") : null;
let tgSearchInput = typeof document !== "undefined" ? document.getElementById("tgSearchInput") : null;
let clearTgSearchBtn = typeof document !== "undefined" ? document.getElementById("clearTgSearchBtn") : null;
let tgSearchStats = typeof document !== "undefined" ? document.getElementById("tgSearchStats") : null;
let tgSearchSpinner = typeof document !== "undefined" ? document.getElementById("tgSearchSpinner") : null;
let tgSearchResultsList = typeof document !== "undefined" ? document.getElementById("tgSearchResultsList") : null;
let tgCustomCard = typeof document !== "undefined" ? document.getElementById("tgCustomCard") : null;
let tgCustomNumber = typeof document !== "undefined" ? document.getElementById("tgCustomNumber") : null;
let btnApplyCustomTg = typeof document !== "undefined" ? document.getElementById("btnApplyCustomTg") : null;

let callIdModal = searchTgIdModal;
let closeCallIdModalBtn = typeof document !== "undefined" ? (document.getElementById("closeCallIdModalBtn") || closeSearchTgIdModalBtn) : null;
let btnCloseCallIdModalBottom = typeof document !== "undefined" ? (document.getElementById("btnCloseCallIdModalBottom") || btnCloseSearchTgIdModalBottom) : null;
let callModalActiveTs = typeof document !== "undefined" ? document.getElementById("callModalActiveTs") : null;
let callIdSearchInput = typeof document !== "undefined" ? document.getElementById("callIdSearchInput") : null;
let clearCallIdSearchBtn = typeof document !== "undefined" ? document.getElementById("clearCallIdSearchBtn") : null;
let callSearchStats = typeof document !== "undefined" ? document.getElementById("callSearchStats") : null;
let callSearchSpinner = typeof document !== "undefined" ? document.getElementById("callSearchSpinner") : null;
let callIdSearchResultsList = typeof document !== "undefined" ? document.getElementById("callIdSearchResultsList") : null;
let callCustomCard = typeof document !== "undefined" ? document.getElementById("callCustomCard") : null;
let callCustomNumber = typeof document !== "undefined" ? document.getElementById("callCustomNumber") : null;
let btnApplyCustomCallId = typeof document !== "undefined" ? document.getElementById("btnApplyCustomCallId") : null;

let tgDbCount = typeof document !== "undefined" ? document.getElementById("tgDbCount") : null;
let tgDbUpdated = typeof document !== "undefined" ? document.getElementById("tgDbUpdated") : null;
let callDbCount = typeof document !== "undefined" ? document.getElementById("callDbCount") : null;
let callDbDelta = typeof document !== "undefined" ? document.getElementById("callDbDelta") : null;
let callDbUpdated = typeof document !== "undefined" ? document.getElementById("callDbUpdated") : null;

function ensureElements() {
  if (typeof document === "undefined") return;
  if (!btnSrchTgId) btnSrchTgId = document.getElementById("btnSrchTgId");
  if (!searchTgIdModal) searchTgIdModal = document.getElementById("searchTgIdModal") || document.getElementById("tgTxUseModal");
  if (!closeSearchTgIdModalBtn) closeSearchTgIdModalBtn = document.getElementById("closeSearchTgIdModalBtn");
  if (!btnCloseSearchTgIdModalBottom) btnCloseSearchTgIdModalBottom = document.getElementById("btnCloseSearchTgIdModalBottom");
  if (!tabBtnSearchTg) tabBtnSearchTg = document.getElementById("tabBtnSearchTg");
  if (!tabBtnSearchCallId) tabBtnSearchCallId = document.getElementById("tabBtnSearchCallId");
  if (!searchTabPaneTg) searchTabPaneTg = document.getElementById("searchTabPaneTg");
  if (!searchTabPaneId) searchTabPaneId = document.getElementById("searchTabPaneId");
  if (!tgHeaderStatsWrap) tgHeaderStatsWrap = document.getElementById("tgHeaderStatsWrap");
  if (!callHeaderStatsWrap) callHeaderStatsWrap = document.getElementById("callHeaderStatsWrap");
  if (!tgFooterHint) tgFooterHint = document.getElementById("tgFooterHint");
  if (!callFooterHint) callFooterHint = document.getElementById("callFooterHint");

  if (!btnTgTxUse) btnTgTxUse = document.getElementById("btnTgTxUse") || btnSrchTgId;
  if (!btnCallId) btnCallId = document.getElementById("btnCallId") || btnSrchTgId;
  tgTxUseModal = searchTgIdModal;
  if (!closeTgTxUseModalBtn) closeTgTxUseModalBtn = document.getElementById("closeTgTxUseModalBtn") || closeSearchTgIdModalBtn;
  if (!btnCloseTgTxUseModalBottom) btnCloseTgTxUseModalBottom = document.getElementById("btnCloseTgTxUseModalBottom") || btnCloseSearchTgIdModalBottom;
  if (!tgModalActiveTs) tgModalActiveTs = document.getElementById("tgModalActiveTs");
  if (!tgSearchInput) tgSearchInput = document.getElementById("tgSearchInput");
  if (!clearTgSearchBtn) clearTgSearchBtn = document.getElementById("clearTgSearchBtn");
  if (!tgSearchStats) tgSearchStats = document.getElementById("tgSearchStats");
  if (!tgSearchSpinner) tgSearchSpinner = document.getElementById("tgSearchSpinner");
  if (!tgSearchResultsList) tgSearchResultsList = document.getElementById("tgSearchResultsList");
  if (!tgCustomCard) tgCustomCard = document.getElementById("tgCustomCard");
  if (!tgCustomNumber) tgCustomNumber = document.getElementById("tgCustomNumber");
  if (!btnApplyCustomTg) btnApplyCustomTg = document.getElementById("btnApplyCustomTg");

  callIdModal = searchTgIdModal;
  if (!closeCallIdModalBtn) closeCallIdModalBtn = document.getElementById("closeCallIdModalBtn") || closeSearchTgIdModalBtn;
  if (!btnCloseCallIdModalBottom) btnCloseCallIdModalBottom = document.getElementById("btnCloseCallIdModalBottom") || btnCloseSearchTgIdModalBottom;
  if (!callModalActiveTs) callModalActiveTs = document.getElementById("callModalActiveTs");
  if (!callIdSearchInput) callIdSearchInput = document.getElementById("callIdSearchInput");
  if (!clearCallIdSearchBtn) clearCallIdSearchBtn = document.getElementById("clearCallIdSearchBtn");
  if (!callSearchStats) callSearchStats = document.getElementById("callSearchStats");
  if (!callSearchSpinner) callSearchSpinner = document.getElementById("callSearchSpinner");
  if (!callIdSearchResultsList) callIdSearchResultsList = document.getElementById("callIdSearchResultsList");
  if (!callCustomCard) callCustomCard = document.getElementById("callCustomCard");
  if (!callCustomNumber) callCustomNumber = document.getElementById("callCustomNumber");
  if (!btnApplyCustomCallId) btnApplyCustomCallId = document.getElementById("btnApplyCustomCallId");

  if (!tgDbCount) tgDbCount = document.getElementById("tgDbCount");
  if (!tgDbUpdated) tgDbUpdated = document.getElementById("tgDbUpdated");
  if (!callDbCount) callDbCount = document.getElementById("callDbCount");
  if (!callDbDelta) callDbDelta = document.getElementById("callDbDelta");
  if (!callDbUpdated) callDbUpdated = document.getElementById("callDbUpdated");
}


let tgSearchDebounceTimer = null;
let callSearchDebounceTimer = null;
let currentModalHotspotId = null;
let currentModalSlot = 2;
let currentSearchModalTab = "tg";
let isSearchManagerInitialized = false;

export function updateTgDbStatsDisplay(stats) {
    if (!stats) return;
    if (tgDbCount && stats.count !== undefined) {
      tgDbCount.textContent = Number(stats.count).toLocaleString("ru-RU");
    }
    if (tgDbUpdated && stats.updated_str) {
      tgDbUpdated.textContent = stats.updated_str;
    }
  }

export async function loadTgDbStats() {
    try {
      const res = await fetch("/api/tg/stats");
      const data = await res.json();
      if (data && data.status === "ok" && data.stats) {
        updateTgDbStatsDisplay(data.stats);
      }
    } catch (e) {
      console.warn("[TG_STATS] Error loading stats:", e);
    }
  }

export function updateCallDbStatsDisplay(stats) {
    if (!stats) return;
    ensureElements();
    if (callDbCount && stats.count !== undefined) {
      callDbCount.textContent = Number(stats.count).toLocaleString("ru-RU");
    }
    if (callDbUpdated && stats.updated_str) {
      callDbUpdated.textContent = stats.updated_str;
    }
    if (callDbDelta) {
      if (stats.delta !== undefined && stats.delta !== null) {
        const deltaNum = Number(stats.delta);
        callDbDelta.classList.remove("delta-positive", "delta-negative", "delta-neutral");
        if (deltaNum > 0) {
          callDbDelta.textContent = `(+${deltaNum.toLocaleString("ru-RU")})`;
          callDbDelta.classList.add("delta-positive");
          callDbDelta.title = window.t ? window.t("callid.stat_delta_pos", { delta: `+${deltaNum}` }) : `+${deltaNum} с последнего обновления`;
        } else if (deltaNum < 0) {
          callDbDelta.textContent = `(-${Math.abs(deltaNum).toLocaleString("ru-RU")})`;
          callDbDelta.classList.add("delta-negative");
          callDbDelta.title = window.t ? window.t("callid.stat_delta_neg", { delta: `${deltaNum}` }) : `${deltaNum} с последнего обновления`;
        } else {
          callDbDelta.textContent = `(0)`;
          callDbDelta.classList.add("delta-neutral");
          callDbDelta.title = window.t ? window.t("callid.stat_delta_zero") : "Без изменений с последнего обновления";
        }
        callDbDelta.style.display = "inline";
      } else {
        callDbDelta.style.display = "none";
      }
    }
  }

export async function loadCallDbStats() {
    try {
      const res = await fetch("/api/dmr/users/stats");
      const data = await res.json();
      if (data && data.status === "ok" && data.stats) {
        updateCallDbStatsDisplay(data.stats);
      }
    } catch (e) {
      console.warn("[CALL_STATS] Error loading stats:", e);
    }
  }

  // Unified Search TG / ID Modal Tabs & Logic
export function switchSearchTgIdTab(tab) {
    ensureElements();
    currentSearchModalTab = tab;
    if (tab === "id") {
      if (tabBtnSearchTg) tabBtnSearchTg.classList.remove("active");
      if (tabBtnSearchCallId) tabBtnSearchCallId.classList.add("active");
      if (searchTabPaneTg) searchTabPaneTg.style.display = "none";
      if (searchTabPaneId) searchTabPaneId.style.display = "block";
      if (tgHeaderStatsWrap) tgHeaderStatsWrap.style.display = "none";
      if (callHeaderStatsWrap) callHeaderStatsWrap.style.display = "block";
      if (tgFooterHint) tgFooterHint.style.display = "none";
      if (callFooterHint) callFooterHint.style.display = "none";
      loadCallDbStats();
      if (!callIdSearchInput?.value && (!callIdSearchResultsList || !callIdSearchResultsList.children.length)) {
        if (callSearchStats) callSearchStats.textContent = window.t ? window.t("callid.search_prompt") : "База RadioID (312 000+ радиолюбителей). Введите позывной, имя, ID или город...";
      }
      setTimeout(() => callIdSearchInput && callIdSearchInput.focus(), 50);
    } else {
      if (tabBtnSearchCallId) tabBtnSearchCallId.classList.remove("active");
      if (tabBtnSearchTg) tabBtnSearchTg.classList.add("active");
      if (searchTabPaneId) searchTabPaneId.style.display = "none";
      if (searchTabPaneTg) searchTabPaneTg.style.display = "block";
      if (callHeaderStatsWrap) callHeaderStatsWrap.style.display = "none";
      if (tgHeaderStatsWrap) tgHeaderStatsWrap.style.display = "block";
      if (callFooterHint) callFooterHint.style.display = "none";
      if (tgFooterHint) tgFooterHint.style.display = "none";
      loadTgDbStats();
      setTimeout(() => tgSearchInput && tgSearchInput.focus(), 50);
    }
  }

export function openSearchTgIdModal(slot, targetHid = null, initialTab = "tg") {
    ensureElements();
    currentModalHotspotId = targetHid || window.activeHotspotId;
    const s = slot === 1 ? 1 : 2;
    currentModalSlot = s;
    const hs = window.currentHotspots.find(h => h.id === currentModalHotspotId);
    const hsName = hs ? hs.name : "";
    const txSlotStr = window.t ? window.t("tgtx.active_slot", { slot: s }) : `TX: TS${s}`;
    const slotText = `${hsName ? hsName + ' | ' : ''}${txSlotStr}`;
    if (tgModalActiveTs) tgModalActiveTs.textContent = slotText;
    if (callModalActiveTs) callModalActiveTs.textContent = slotText;

    switchSearchTgIdTab(initialTab);

    if (initialTab === "tg") {
      if (tgSearchInput) tgSearchInput.value = "";
      if (clearTgSearchBtn) clearTgSearchBtn.classList.add("hidden");
      if (tgCustomCard) tgCustomCard.classList.add("hidden");
      loadTgDbStats();
      performTgSearch("");
    } else {
      if (callIdSearchInput) callIdSearchInput.value = "";
      if (clearCallIdSearchBtn) clearCallIdSearchBtn.classList.add("hidden");
      if (callCustomCard) callCustomCard.classList.add("hidden");
      loadCallDbStats();
      if (callSearchStats) callSearchStats.textContent = window.t ? window.t("callid.search_prompt") : "База RadioID (312 000+ радиолюбителей). Введите позывной, имя, ID или город...";
      if (callIdSearchResultsList) callIdSearchResultsList.innerHTML = "";
    }

    if (searchTgIdModal) {
      searchTgIdModal.classList.add("active");
      pushNavState("modal", "searchTgIdModal");
    }
  }

export function closeSearchTgIdModal() {
    if (searchTgIdModal && searchTgIdModal.classList.contains("active")) {
      searchTgIdModal.classList.remove("active");
      notifyNavClosed();
    }
  }
  window.closeSearchTgIdModal = closeSearchTgIdModal;

  // Compatibility aliases
export function openTgTxUseModal(slot, targetHid = null) {
    openSearchTgIdModal(slot, targetHid, "tg");
  }
export function closeTgTxUseModal() {
    closeSearchTgIdModal();
  }
export function openCallIdModal(slot, targetHid = null) {
    openSearchTgIdModal(slot, targetHid, "id");
  }
export function closeCallIdModal() {
    closeSearchTgIdModal();
  }

export async function performTgSearch(query) {
    ensureElements();
    if (tgSearchSpinner) tgSearchSpinner.classList.remove("hidden");
    const q = (query || "").trim();

    // Check custom numeric TG card
    if (tgCustomCard && tgCustomNumber) {
      if (/^\d+$/.test(q) && parseInt(q, 10) > 0 && parseInt(q, 10) <= 9999999) {
        tgCustomNumber.textContent = q;
        tgCustomCard.classList.remove("hidden");
      } else {
        tgCustomCard.classList.add("hidden");
      }
    }

    try {
      const res = await fetch(`/api/tg/search?q=${encodeURIComponent(q)}&limit=50`);
      const data = await res.json();
      if (tgSearchSpinner) tgSearchSpinner.classList.add("hidden");
      if (data && data.stats) {
        updateTgDbStatsDisplay(data.stats);
      }

      if (tgSearchStats) {
        if (!q) {
          tgSearchStats.textContent = window.t ? window.t("tgtx.popular_groups_count", { count: data.results.length }) : `Популярные группы (${data.results.length}):`;
        } else {
          tgSearchStats.textContent = window.t ? window.t("tgtx.found_groups_count", { count: data.results.length, q: q }) : `Найдено групп: ${data.results.length} по запросу «${q}»`;
        }
      }

      renderTgSearchResults(data.results || []);
    } catch (e) {
      console.warn("[TG_SEARCH] Error:", e);
      if (tgSearchSpinner) tgSearchSpinner.classList.add("hidden");
      if (tgSearchStats) tgSearchStats.textContent = window.t ? window.t("tgtx.load_error") : "Ошибка загрузки данных из справочника";
    }
  }

export function renderTgSearchResults(items) {
    ensureElements();
    if (!tgSearchResultsList) return;
    if (!items || items.length === 0) {
      const noResMsg = window.t ? window.t("tgtx.no_results") : "Группы не найдены. Вы можете ввести номер группы вручную.";
      tgSearchResultsList.innerHTML = `<div style="padding: 24px; text-align: center; color: #8b949e; font-size: 0.88rem;">${noResMsg}</div>`;
      return;
    }

    tgSearchResultsList.innerHTML = items.map(item => `
      <div class="search-result-card" data-tg="${safeEscapeHtml(String(item.tg))}" data-name="${safeEscapeHtml(item.name || '')}">
        <div class="search-result-left">
          <span class="card-badge-id card-badge-tg">TG ${safeEscapeHtml(String(item.tg))}</span>
          <div class="card-info-col">
            <span class="card-primary-title">${safeEscapeHtml(item.name || `TG ${item.tg}`)}</span>
            <span class="card-secondary-details">${safeEscapeHtml(item.country || 'BM')}</span>
          </div>
        </div>
        <div class="card-select-action">
          <span>${window.t ? window.t("tgtx.btn_select") : "Выбрать"}</span> ➔
        </div>
      </div>
    `).join("");

    tgSearchResultsList.querySelectorAll(".search-result-card").forEach(card => {
      card.addEventListener("click", () => {
        const tg = parseInt(card.dataset.tg, 10);
        const name = card.dataset.name;
        if (name && tg) {
          if (!window.TG_NAMES) window.TG_NAMES = {};
          window.TG_NAMES[tg] = name;
        }
        openTgIdActionMenu({
          type: "TG",
          value: tg,
          name: name || `TG ${tg}`,
          hotspotId: currentModalHotspotId,
          slot: currentModalSlot
        });
      });
    });
  }


export async function performCallIdSearch(query) {
    ensureElements();
    const q = (query || "").trim();
    if (!q) {
      if (callSearchStats) callSearchStats.textContent = window.t ? window.t("callid.search_prompt") : "База RadioID (312 000+ радиолюбителей). Введите позывной, имя, ID или город...";
      if (callIdSearchResultsList) callIdSearchResultsList.innerHTML = "";
      if (callCustomCard) callCustomCard.classList.add("hidden");
      return;
    }

    // Check custom numeric DMR ID card
    if (callCustomCard && callCustomNumber) {
      if (/^\d+$/.test(q) && parseInt(q, 10) > 0 && parseInt(q, 10) <= 9999999) {
        callCustomNumber.textContent = q;
        callCustomCard.classList.remove("hidden");
      } else {
        callCustomCard.classList.add("hidden");
      }
    }

    if (callSearchSpinner) callSearchSpinner.classList.remove("hidden");
    try {
      const res = await fetch(`/api/dmr/users/search?q=${encodeURIComponent(q)}&limit=50`);
      const data = await res.json();
      if (callSearchSpinner) callSearchSpinner.classList.add("hidden");
      if (data && data.stats) {
        updateCallDbStatsDisplay(data.stats);
      }

      if (callSearchStats) {
        callSearchStats.textContent = window.t ? window.t("callid.found_users_count", { count: data.count || 0, q: q }) : `Найдено операторов: ${data.count || 0} по запросу «${q}»`;
      }

      renderCallIdSearchResults(data.results || []);
    } catch (e) {
      console.warn("[USER_SEARCH] Error:", e);
      if (callSearchSpinner) callSearchSpinner.classList.add("hidden");
      if (callSearchStats) callSearchStats.textContent = window.t ? window.t("callid.load_error") : "Ошибка поиска в базе радиолюбителей";
    }
  }

export function renderCallIdSearchResults(items) {
    ensureElements();
    if (!callIdSearchResultsList) return;
    if (!items || items.length === 0) {
      const noCallRes = window.t ? window.t("callid.no_results") : "Позывной или корреспондент не найден в базе RadioID.";
      callIdSearchResultsList.innerHTML = `<div style="padding: 24px; text-align: center; color: #8b949e; font-size: 0.88rem;">${noCallRes}</div>`;
      return;
    }

    callIdSearchResultsList.innerHTML = items.map(user => {
      const locParts = [user.city, user.state, user.country].filter(Boolean);
      const locStr = locParts.join(", ");
      const safeCall = safeEscapeHtml(user.callsign || '');
      const safeName = safeEscapeHtml(user.name || '');
      const safeCountry = safeEscapeHtml(user.country || '');
      const safeCity = safeEscapeHtml(user.city || '');
      const trInfo = window.t ? window.t("callid.btn_bm_info") : null;
      const btnInfoLabel = (trInfo && trInfo !== "callid.btn_bm_info") ? trInfo : "Инфо";
      const trTitle = window.t ? window.t("callid.btn_bm_info_title") : null;
      const btnInfoTitle = (trTitle && trTitle !== "callid.btn_bm_info_title") ? trTitle : "Информация BrandMeister";
      const trSelect = window.t ? window.t("callid.btn_select_call") : null;
      const btnSelectLabel = (trSelect && trSelect !== "callid.btn_select_call") ? trSelect : "Вызов";

      return `
        <div class="search-result-card" data-radio-id="${user.radio_id}" data-callsign="${safeCall}" data-name="${safeName}" data-country="${safeCountry}" data-city="${safeCity}">
          <div class="search-result-left">
            <div class="card-info-col">
              <span class="card-primary-title"><span class="card-callsign-highlight">${safeCall}</span>${user.name ? ` — ${safeName}` : ''} <span class="card-id-wrapper">(ID: <span class="dmr-id-text">${user.radio_id}</span>)</span></span>
              <span class="card-secondary-details">${locStr ? safeEscapeHtml(locStr) : 'Amateur Radio Station'}</span>
            </div>
          </div>
          <div class="card-actions-group">
            <button type="button" class="btn-card-bm-info" data-radio-id="${user.radio_id}" data-callsign="${safeCall}" data-name="${safeName}" data-country="${safeCountry}" data-city="${safeCity}" title="${btnInfoTitle}">
              ℹ️ ${btnInfoLabel}
            </button>
            <div class="card-select-action">
              <span>${btnSelectLabel}</span> ➔
            </div>
          </div>
        </div>
      `;
    }).join("");

    callIdSearchResultsList.querySelectorAll(".btn-card-bm-info").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const rid = btn.dataset.radioId;
        const callsign = btn.dataset.callsign;
        const name = btn.dataset.name;
        const country = btn.dataset.country;
        const city = btn.dataset.city;
        openBmInfoModal("contact_info", {
          value: rid,
          callsign: callsign,
          name: name,
          country: country,
          city: city,
          type: "ID"
        });
      });
    });

    callIdSearchResultsList.querySelectorAll(".search-result-card").forEach(card => {
      card.addEventListener("click", () => {
        const rid = parseInt(card.dataset.radioId, 10);
        const callsign = card.dataset.callsign;
        const name = card.dataset.name;
        const country = card.dataset.country;
        const city = card.dataset.city;

        window.USER_CALLSIGNS[rid] = {
          callsign: callsign,
          name: name,
          country: country
        };
        try {
          localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify(window.USER_CALLSIGNS));
        } catch (e) {}

        openTgIdActionMenu({
          type: "ID",
          value: rid,
          callsign: callsign,
          name: name,
          country: country,
          city: city,
          hotspotId: currentModalHotspotId,
          slot: currentModalSlot
        });
      });
    });
  }


export function initSearchManager() {
  if (isSearchManagerInitialized) return;
  isSearchManagerInitialized = true;
  ensureElements();

  // Tab switching click handlers
  if (tabBtnSearchTg) tabBtnSearchTg.addEventListener("click", () => switchSearchTgIdTab("tg"));
  if (tabBtnSearchCallId) tabBtnSearchCallId.addEventListener("click", () => switchSearchTgIdTab("id"));

  if (closeSearchTgIdModalBtn) closeSearchTgIdModalBtn.addEventListener("click", closeSearchTgIdModal);
  if (btnCloseSearchTgIdModalBottom) btnCloseSearchTgIdModalBottom.addEventListener("click", closeSearchTgIdModal);
  if (closeTgTxUseModalBtn) closeTgTxUseModalBtn.addEventListener("click", closeSearchTgIdModal);
  if (btnCloseTgTxUseModalBottom) btnCloseTgTxUseModalBottom.addEventListener("click", closeSearchTgIdModal);
  if (closeCallIdModalBtn) closeCallIdModalBtn.addEventListener("click", closeSearchTgIdModal);
  if (btnCloseCallIdModalBottom) btnCloseCallIdModalBottom.addEventListener("click", closeSearchTgIdModal);

  // Close modal on outside overlay click
  if (searchTgIdModal) {
    searchTgIdModal.addEventListener("click", (e) => {
      if (e.target === searchTgIdModal) closeSearchTgIdModal();
    });
  }

  // Quick Chips in TG Modal
  if (typeof document !== "undefined") {
    document.querySelectorAll(".quick-chip").forEach(chip => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        const q = chip.dataset.query;
        if (tgSearchInput) {
          tgSearchInput.value = q;
          if (clearTgSearchBtn) clearTgSearchBtn.classList.remove("hidden");
          performTgSearch(q);
        }
      });
    });
  }

  // Clear buttons
  if (clearTgSearchBtn) {
    clearTgSearchBtn.addEventListener("click", () => {
      if (tgSearchInput) {
        tgSearchInput.value = "";
        clearTgSearchBtn.classList.add("hidden");
        tgSearchInput.focus();
        performTgSearch("");
      }
    });
  }
  if (clearCallIdSearchBtn) {
    clearCallIdSearchBtn.addEventListener("click", () => {
      if (callIdSearchInput) {
        callIdSearchInput.value = "";
        clearCallIdSearchBtn.classList.add("hidden");
        callIdSearchInput.focus();
        if (callIdSearchResultsList) callIdSearchResultsList.innerHTML = "";
      }
    });
  }

  // Search input listeners with debounce
  if (tgSearchInput) {
    tgSearchInput.addEventListener("input", () => {
      const q = tgSearchInput.value.trim();
      if (clearTgSearchBtn) clearTgSearchBtn.classList.toggle("hidden", !q);
      clearTimeout(tgSearchDebounceTimer);
      tgSearchDebounceTimer = setTimeout(() => performTgSearch(q), 150);
    });
  }

  if (callIdSearchInput) {
    callIdSearchInput.addEventListener("input", () => {
      const q = callIdSearchInput.value.trim();
      if (clearCallIdSearchBtn) clearCallIdSearchBtn.classList.toggle("hidden", !q);
      clearTimeout(callSearchDebounceTimer);
      callSearchDebounceTimer = setTimeout(() => performCallIdSearch(q), 200);
    });
  }

  // Custom TG apply
  if (btnApplyCustomTg && tgCustomNumber) {
    btnApplyCustomTg.addEventListener("click", () => {
      const val = parseInt(tgCustomNumber.textContent, 10);
      if (val > 0 && val <= 9999999) {
        openTgIdActionMenu({
          type: "TG",
          value: val,
          name: `TG ${val}`,
          hotspotId: currentModalHotspotId,
          slot: currentModalSlot
        });
      }
    });
  }

  // Custom Call ID apply
  if (btnApplyCustomCallId && callCustomNumber) {
    btnApplyCustomCallId.addEventListener("click", () => {
      const val = parseInt(callCustomNumber.textContent, 10);
      if (val > 0 && val <= 9999999) {
        openTgIdActionMenu({
          type: "ID",
          value: val,
          callsign: `ID ${val}`,
          name: "",
          hotspotId: currentModalHotspotId,
          slot: currentModalSlot
        });
      }
    });
  }
}


// Export on window and window.__proxdmr for legacy / external bridge
if (typeof window !== "undefined") {
  window.openSearchTgIdModal = openSearchTgIdModal;
  window.closeSearchTgIdModal = closeSearchTgIdModal;
  window.openTgTxUseModal = openTgTxUseModal;
  window.closeTgTxUseModal = closeTgTxUseModal;
  window.openCallIdModal = openCallIdModal;
  window.closeCallIdModal = closeCallIdModal;
  window.switchSearchTgIdTab = switchSearchTgIdTab;
  window.performTgSearch = performTgSearch;
  window.renderTgSearchResults = renderTgSearchResults;
  window.performCallIdSearch = performCallIdSearch;
  window.renderCallIdSearchResults = renderCallIdSearchResults;
  window.updateTgDbStatsDisplay = updateTgDbStatsDisplay;
  window.loadTgDbStats = loadTgDbStats;
  window.updateCallDbStatsDisplay = updateCallDbStatsDisplay;
  window.loadCallDbStats = loadCallDbStats;
  window.initSearchManager = initSearchManager;

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.openSearchTgIdModal = openSearchTgIdModal;
  window.__proxdmr.closeSearchTgIdModal = closeSearchTgIdModal;
  window.__proxdmr.openTgTxUseModal = openTgTxUseModal;
  window.__proxdmr.closeTgTxUseModal = closeTgTxUseModal;
  window.__proxdmr.openCallIdModal = openCallIdModal;
  window.__proxdmr.closeCallIdModal = closeCallIdModal;
  window.__proxdmr.switchSearchTgIdTab = switchSearchTgIdTab;
  window.__proxdmr.performTgSearch = performTgSearch;
  window.__proxdmr.renderTgSearchResults = renderTgSearchResults;
  window.__proxdmr.performCallIdSearch = performCallIdSearch;
  window.__proxdmr.renderCallIdSearchResults = renderCallIdSearchResults;
  window.__proxdmr.updateTgDbStatsDisplay = updateTgDbStatsDisplay;
  window.__proxdmr.loadTgDbStats = loadTgDbStats;
  window.__proxdmr.updateCallDbStatsDisplay = updateCallDbStatsDisplay;
  window.__proxdmr.loadCallDbStats = loadCallDbStats;
  window.__proxdmr.initSearchManager = initSearchManager;
}

// Auto-initialize when DOM is ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initSearchManager());
  } else {
    initSearchManager();
  }
}
