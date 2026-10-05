/**
 * ProxDMR - BrandMeister Server Info, Flags & Master Banner Subsystem
 * Handles BM master server resolution, geographic flags, master switching,
 * online status detection, and per-hotspot banner DOM rendering.
 */

import {
  resolveHotspotId,
  loadCardPingHistory,
  saveCardPingHistory,
  renderCardPingSparkline,
  getHotspotPingMode,
  toggleHotspotPingMode,
  calculateClientPacketLoss,
  calculateCardPacketLoss,
  updatePingElement
} from "../network/ping-sparklines.js";
import { openBmBenchmarkModal } from "./bm-benchmark.js";
import { isHotspotCollapsed, isHotspotLiveCollapsed } from "../audio/volume-mute.js";
import { isoToEmoji, getLocalizedCountryName } from "../core/formatters.js";

export const KNOWN_BM_MASTERS = [
  { id: 2322, country: "AT", country_name: "Австрия", host: "2322.master.brandmeister.network", ip: "62.171.130.35" },
  { id: 2502, country: "RU", country_name: "Россия", host: "2502.master.brandmeister.network", ip: "44.32.144.132" },
  { id: 2503, country: "RU", country_name: "Россия", host: "2503.master.brandmeister.network", ip: "164.215.71.108" },
  { id: 2621, country: "DE", country_name: "Германия", host: "2621.master.brandmeister.network", ip: "87.106.126.49" },
  { id: 2622, country: "DE", country_name: "Германия", host: "2622.master.brandmeister.network", ip: "178.238.234.72" },
  { id: 2282, country: "CH", country_name: "Швейцария", host: "2282.master.brandmeister.network", ip: "185.46.59.78" },
  { id: 3102, country: "US", country_name: "США", host: "3102.master.brandmeister.network", ip: "74.91.114.19" },
  { id: 3103, country: "US", country_name: "США", host: "3103.master.brandmeister.network", ip: "74.91.118.251" },
  { id: 3104, country: "US", country_name: "США", host: "3104.master.brandmeister.network", ip: "162.248.88.117" },
  { id: 2081, country: "FR", country_name: "Франция", host: "2081.master.brandmeister.network", ip: "217.182.129.130" },
  { id: 2082, country: "FR", country_name: "Франция", host: "2082.master.brandmeister.network", ip: "217.182.129.131" },
  { id: 2341, country: "GB", country_name: "Великобритания", host: "2341.master.brandmeister.network", ip: "51.68.220.36" },
  { id: 2141, country: "ES", country_name: "Испания", host: "2141.master.brandmeister.network", ip: "84.232.5.113" },
  { id: 2222, country: "IT", country_name: "Италия", host: "2222.master.brandmeister.network", ip: "31.14.134.183" },
  { id: 2041, country: "NL", country_name: "Нидерланды", host: "2041.master.brandmeister.network", ip: "44.137.42.20" },
  { id: 2602, country: "PL", country_name: "Польша", host: "2602.master.brandmeister.network", ip: "195.26.76.59" },
  { id: 2302, country: "CZ", country_name: "Чехия", host: "2302.master.brandmeister.network", ip: "80.250.21.206" },
  { id: 2402, country: "SE", country_name: "Швеция", host: "2402.master.brandmeister.network", ip: "44.5.24.178" },
  { id: 2441, country: "FI", country_name: "Финляндия", host: "2441.master.brandmeister.network", ip: "85.188.1.107" },
  { id: 2421, country: "NO", country_name: "Норвегия", host: "2421.master.brandmeister.network", ip: "80.89.46.242" },
  { id: 2382, country: "DK", country_name: "Дания", host: "2382.master.brandmeister.network", ip: "185.51.76.16" },
  { id: 2162, country: "HU", country_name: "Венгрия", host: "2162.master.brandmeister.network", ip: "185.187.75.192" },
  { id: 2262, country: "RO", country_name: "Румыния", host: "2262.master.brandmeister.network", ip: "94.176.6.38" },
  { id: 2841, country: "BG", country_name: "Болгария", host: "2841.master.brandmeister.network", ip: "44.31.90.2" },
  { id: 2931, country: "SI", country_name: "Словения", host: "46.54.227.93", ip: "46.54.227.93" },
  { id: 2682, country: "PT", country_name: "Португалия", host: "2682.master.brandmeister.network", ip: "193.137.237.12" },
  { id: 2721, country: "IE", country_name: "Ирландия", host: "2721.master.brandmeister.network", ip: "44.155.254.5" },
  { id: 2022, country: "GR", country_name: "Греция", host: "2022.master.brandmeister.network", ip: "185.4.134.95" },
  { id: 2061, country: "BE", country_name: "Бельгия", host: "2061.master.brandmeister.network", ip: "194.146.121.130" },
  { id: 3021, country: "CA", country_name: "Канада", host: "3021.master.brandmeister.network", ip: "158.69.203.89" },
  { id: 4251, country: "IL", country_name: "Израиль", host: "4251.master.brandmeister.network", ip: "31.154.7.7" },
  { id: 5051, country: "AU", country_name: "Австралия", host: "5051.master.brandmeister.network", ip: "103.230.158.71" },
  { id: 4501, country: "KR", country_name: "Южная Корея", host: "4501.master.brandmeister.network", ip: "211.60.41.188" },
  { id: 4602, country: "CN", country_name: "Китай", host: "4602.master.brandmeister.network", ip: "43.129.83.124" },
  { id: 5021, country: "MY", country_name: "Малайзия", host: "5021.master.brandmeister.network", ip: "103.197.58.171" },
  { id: 5151, country: "PH", country_name: "Филиппины", host: "5151.master.brandmeister.network", ip: "120.89.61.77" },
  { id: 6551, country: "ZA", country_name: "ЮАР", host: "6551.master.brandmeister.network", ip: "154.66.196.131" },
  { id: 7242, country: "BR", country_name: "Бразилия", host: "7242.master.brandmeister.network", ip: "69.62.93.116" },
  { id: 7301, country: "CL", country_name: "Чили", host: "7301.master.brandmeister.network", ip: "170.239.84.17" },
  { id: 3341, country: "MX", country_name: "Мексика", host: "3341.master.brandmeister.network", ip: "72.1.241.232" }
];

function getCurrentHotspots() {
  return (typeof window !== "undefined" && Array.isArray(window.currentHotspots)) ? window.currentHotspots : [];
}

function getActiveHotspotId() {
  return (typeof window !== "undefined" && window.activeHotspotId) || "default";
}

function getWs() {
  return (typeof window !== "undefined" && window.ws) || null;
}

export function getBmFlagBadgeHtml(isoCode, countryName) {
  const iso = (isoCode || "").trim().toLowerCase();
  if (iso && iso !== "global") {
    return `<span class="flag-badge flag-${iso}" title="${countryName || iso.toUpperCase()}"><img src="/static/flags/${iso}.svg" alt="${countryName || iso.toUpperCase()}" class="flag-svg flag-img" /></span>`;
  }
  return `<span class="flag-badge flag-global" title="BM"><svg viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>`;
}

export function getBmServerInfo(hostVal) {
  const raw = (hostVal || "").trim();
  const clean = raw.toLowerCase();
  const bmMastersList = (typeof window !== "undefined" && window.bmMastersList) || [];
  const list = bmMastersList.length ? bmMastersList : KNOWN_BM_MASTERS;

  let match = list.find(m => (m.host && m.host.toLowerCase() === clean) || m.ip === clean || (clean && clean.includes(String(m.id))));

  if (!match) {
    const idMatch = clean.match(/^(\d{4})/);
    if (idMatch) {
      const idNum = parseInt(idMatch[1], 10);
      match = list.find(m => m.id === idNum);
    }
  }

  if (match) {
    const cCode = (match.country_code || match.country || "RU").toUpperCase();
    const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
    const cName = getLocalizedCountryName(cCode, match.country_name || match.country || cCode, curLang);

    const countryMasters = list.filter(m => {
      const cc = (m.country_code || m.country || "").toUpperCase();
      return cc === cCode;
    }).sort((a, b) => (a.id || 0) - (b.id || 0));

    let displayName = cName;
    if (match.name && match.name.trim()) {
      displayName = match.name.trim();
    } else if (countryMasters.length > 1) {
      const idx = countryMasters.findIndex(m => m.id === match.id);
      const num = idx >= 0 ? (idx + 1) : 1;
      displayName = `${cName} ${num}`;
    }

    return {
      countryCode: cCode,
      countryName: cName,
      displayName: displayName,
      host: match.host || raw,
      flagHtml: getBmFlagBadgeHtml(cCode, displayName)
    };
  }

  // Fallback for custom / unknown servers
  return {
    countryCode: "GLOBAL",
    countryName: "BM",
    displayName: "BM",
    host: raw || "master.brandmeister.network",
    flagHtml: getBmFlagBadgeHtml("global", "BM")
  };
}

export function populateBmServerSelect(select, currentHost) {
  if (!select) return;
  const cleanCurrent = (currentHost || "").trim().toLowerCase();

  const bmMastersList = (typeof window !== "undefined" && window.bmMastersList) || [];
  const masters = bmMastersList.length ? bmMastersList : KNOWN_BM_MASTERS;
  const targetCount = masters.length;
  const currentCount = parseInt(select.dataset.masterCount || "0", 10);
  const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
  const lastLang = select.dataset.lang || "";

  if (targetCount > 0 && (currentCount !== targetCount || lastLang !== curLang)) {
    select.innerHTML = "";
    select.dataset.masterCount = String(targetCount);
    select.dataset.lang = curLang;

    const benchOpt = document.createElement("option");
    benchOpt.value = "__TEST_SERVERS__";
    benchOpt.textContent = window.t ? window.t("hotspots.bench_opt", {}, "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)") : "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)";
    select.appendChild(benchOpt);

    const recTag = window.t ? window.t("bm.master_recommended", {}, "⭐ [Рекомендуется]") : "⭐ [Рекомендуется]";

    masters.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.host || "";
      const cCode = (m.country_code || m.country || "").toUpperCase();
      const countryName = getLocalizedCountryName(cCode, m.country_name || m.country || "BM", curLang);
      const flag = m.flag || isoToEmoji(cCode);
      const recSuffix = m.recommended ? ` ${recTag}` : "";
      opt.textContent = `${flag} ${countryName} — BM ${m.id || ""} (${m.host || ""})${recSuffix}`;
      select.appendChild(opt);
    });
  } else if (targetCount === 0 && !select.options.length) {
    const info = getBmServerInfo(currentHost);
    const opt = document.createElement("option");
    opt.value = currentHost || "2322.master.brandmeister.network";
    const flag = info.countryCode !== "GLOBAL" ? isoToEmoji(info.countryCode) : "🌐";
    opt.textContent = `${flag} BM ${info.displayName || "BM"}`;
    opt.selected = true;
    select.appendChild(opt);
  }

  let matched = false;
  for (let i = 0; i < select.options.length; i++) {
    const optVal = select.options[i].value.toLowerCase();
    if (cleanCurrent && (cleanCurrent === optVal || cleanCurrent === optVal.split(":")[0])) {
      if (select.selectedIndex !== i) {
        select.selectedIndex = i;
      }
      matched = true;
      break;
    }
  }

  if (!matched && cleanCurrent) {
    let customOpt = Array.from(select.options).find(o => o.value.toLowerCase() === cleanCurrent);
    if (!customOpt) {
      const info = getBmServerInfo(currentHost);
      customOpt = document.createElement("option");
      customOpt.value = currentHost;
      const flag = info.countryCode !== "GLOBAL" ? isoToEmoji(info.countryCode) : "🌐";
      customOpt.textContent = `${flag} ${info.displayName} (${currentHost})`;
      select.insertBefore(customOpt, select.firstChild);
    }
    customOpt.selected = true;
  }
}

export function isHotspotFullyOnline(arg) {
  const ws = getWs();
  const isManualGwDisconnect = typeof window !== "undefined" && Boolean(window.isManualGwDisconnect);
  const isGwOnline = Boolean(ws && ws.readyState === WebSocket.OPEN && !isManualGwDisconnect);
  if (!isGwOnline) return false;
  if (!arg) return false;

  const targetId = (typeof arg === "string") ? arg : (arg && arg.id);
  if (targetId && typeof window !== "undefined" && typeof window.isHotspotGwDisconnected === "function" && window.isHotspotGwDisconnected(targetId)) {
    return false;
  }

  const currentHotspots = getCurrentHotspots();
  if (typeof arg === "string") {
    const isLive = (typeof isHotspotLiveCollapsed === "function" && isHotspotLiveCollapsed(arg)) || (typeof window !== "undefined" && window.isHotspotLiveCollapsed && window.isHotspotLiveCollapsed(arg));
    if (isHotspotCollapsed(arg) && !isLive) return false;
    if (arg === "ONLINE") return true;
    if (arg === "OFFLINE" || arg === "CONNECTING" || arg === "ERROR" || arg === "DISCONNECTED" || arg === "AUTH_FAILED") return false;
    const target = currentHotspots.find(h => h.id === arg);
    const targetLive = target ? ((typeof isHotspotLiveCollapsed === "function" && isHotspotLiveCollapsed(target.id)) || (typeof window !== "undefined" && window.isHotspotLiveCollapsed && window.isHotspotLiveCollapsed(target.id))) : false;
    if (!target || (isHotspotCollapsed(target.id) && !targetLive)) return false;
    return Boolean(target && target.status === "ONLINE");
  }
  if (typeof arg === "object") {
    const isLive = arg.id ? ((typeof isHotspotLiveCollapsed === "function" && isHotspotLiveCollapsed(arg.id)) || (typeof window !== "undefined" && window.isHotspotLiveCollapsed && window.isHotspotLiveCollapsed(arg.id))) : false;
    if (arg.id && isHotspotCollapsed(arg.id) && !isLive) return false;
    return arg.status === "ONLINE";
  }
  return false;
}

export function updateCardBmBanner(card, hs) {
  if (!card) return;
  const banner = card.querySelector(".bm-info-banner");
  if (!banner) return;

  const currentHotspots = getCurrentHotspots();
  const activeHotspotId = getActiveHotspotId();

  if (!hs) {
    const hid = card.dataset.hotspotId || "default";
    const cid = resolveHotspotId(hid);
    hs = (currentHotspots && currentHotspots.length)
      ? (currentHotspots.find(h => h.id === cid) || currentHotspots.find(h => h.id === hid) || (hid === "default" ? currentHotspots[0] : null) || currentHotspots[0])
      : null;
  }

  const hostVal = (hs && hs.bm_master_host) ? hs.bm_master_host : "2502.master.brandmeister.network";
  const info = getBmServerInfo(hostVal);

  // Update Flag & Short Display Name
  const flagEl = banner.querySelector(".bm-server-flag");
  if (flagEl) {
    flagEl.innerHTML = info.flagHtml || "🌐";
  }

  const nameEl = banner.querySelector(".bm-server-name");
  if (nameEl) {
    const shortName = info.displayName || info.countryName || "BM";
    nameEl.textContent = shortName.startsWith("BM") ? shortName : `BM ${shortName}`;
    nameEl.title = `${info.countryName || info.displayName} — ${hostVal}`;
  }

  let select = banner.querySelector(".bm-server-select");
  if (select && (document.activeElement !== select || !select.options.length)) {
    populateBmServerSelect(select, hostVal);
  }

  if (select && !select._selectWired) {
    select._selectWired = true;
    select.addEventListener("focus", () => {
      const allHotspots = getCurrentHotspots();
      const rawId = card.dataset.hotspotId || "default";
      const cid = (typeof resolveHotspotId === "function") ? resolveHotspotId(rawId) : rawId;
      const targetHs = allHotspots.find(h => h.id === cid || h.id === rawId) ||
                       (rawId === "default" ? allHotspots[0] : null) ||
                       allHotspots[0];
      const currHost = (targetHs && targetHs.bm_master_host) || select.value || hostVal;
      populateBmServerSelect(select, currHost);
    });
    select.addEventListener("click", (e) => e.stopPropagation());
    select.addEventListener("change", async (e) => {
      e.stopPropagation();
      const newHost = select.value;
      if (!newHost) return;

      const allHotspots = getCurrentHotspots();
      const rawId = card.dataset.hotspotId || "default";
      const cid = (typeof resolveHotspotId === "function") ? resolveHotspotId(rawId) : rawId;
      const targetHs = allHotspots.find(h => h.id === cid || h.id === rawId) ||
                       (rawId === "default" ? allHotspots[0] : null) ||
                       allHotspots[0];

      if (newHost === "__TEST_SERVERS__") {
        const currHost = (targetHs && targetHs.bm_master_host) || "";
        populateBmServerSelect(select, currHost);
        const targetId = (targetHs && targetHs.id) ? targetHs.id : cid;
        if (typeof openBmBenchmarkModal === "function") {
          openBmBenchmarkModal(targetId);
        }
        return;
      }

      if (!targetHs) {
        console.warn("[BM-BANNER] targetHs not found for card:", rawId, cid);
        return;
      }

      if (targetHs.bm_master_host === newHost) return;
      const prevHost = targetHs.bm_master_host;
      const targetId = targetHs.id || cid;

      targetHs.bm_master_host = newHost;
      if (typeof window !== "undefined" && typeof window.updateBmStatus === "function") {
        window.updateBmStatus("connecting", `Подключение к ${newHost}...`, targetId);
      }

      // Immediate reset of packet loss counter for new server
      const switchNow = Math.floor(Date.now() / 1000);
      card._hostSwitchTime = switchNow;
      card._lastTrackedHost = newHost;
      try {
        localStorage.setItem(`proxdmr_host_switch_${targetId}`, String(switchNow));
        localStorage.setItem(`proxdmr_host_name_${targetId}`, newHost);
      } catch (_) {}

      // Immediate sparkline re-render with new server: old data remains in history, rendered grey!
      const hist = loadCardPingHistory(targetId);
      const cachedBmHostPings = (typeof window !== "undefined" && window.cachedBmHostPings) || {};
      const pingVal = (cachedBmHostPings && cachedBmHostPings[newHost] !== undefined) ? cachedBmHostPings[newHost] : null;
      if (pingVal !== null && !isNaN(pingVal)) {
        hist.push({ t: Math.floor(Date.now() / 1000), ping: pingVal, host: newHost });
        saveCardPingHistory(targetId);
      }
      renderCardPingSparkline(card, newHost);

      try {
        const payload = {
          ...targetHs,
          id: targetId,
          bm_master_host: newHost,
          duplex: true
        };
        const resp = await fetch(`/api/hotspots/${encodeURIComponent(targetId)}?reconnect=1`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.hotspot) {
            Object.assign(targetHs, data.hotspot);
          }
          const curActiveId = (typeof getActiveHotspotId === "function") ? getActiveHotspotId() : (window.activeHotspotId || "default");
          const editHsHost = document.getElementById("editHsHost");
          const editHsId = document.getElementById("editHsId");
          const editHsMasterSelect = document.getElementById("editHsMasterSelect");
          if (editHsHost && editHsId && (editHsId.value === targetId || curActiveId === targetId)) {
            editHsHost.value = newHost;
            if (editHsMasterSelect) editHsMasterSelect.value = newHost;
          }
        } else {
          console.error(`[BM-BANNER] Ошибка смены сервера BM: HTTP ${resp.status}`);
          targetHs.bm_master_host = prevHost;
        }
      } catch (err) {
        console.error("[BM-BANNER] Ошибка смены сервера BM:", err);
        targetHs.bm_master_host = prevHost;
      }
      updateCardBmBanner(card, targetHs);
    });
  }

  const rawHid = (hs && hs.id) ? hs.id : (card.dataset.hotspotId || "default");
  const hid = resolveHotspotId(rawHid);
  const cid = hid;
  const isCollapsed = isHotspotCollapsed(cid);
  const isLive = (typeof isHotspotLiveCollapsed === "function" && isHotspotLiveCollapsed(cid)) || (typeof window !== "undefined" && window.isHotspotLiveCollapsed && window.isHotspotLiveCollapsed(cid));
  const isOnline = (!isCollapsed || isLive) && isHotspotFullyOnline(hs || cid);

  const volStrip = card.querySelector(".vertical-volume-strip");
  if (volStrip) {
    volStrip.classList.toggle("bm-disconnected", !isOnline);
  }
  card.classList.toggle("card-bm-disconnected", !isOnline);
  card.classList.toggle("collapsed", isCollapsed);
  card.classList.toggle("live-collapsed", isCollapsed && isLive);

  const nameBadge = card.querySelector(".hotspot-name-badge");
  if (nameBadge) {
    nameBadge.classList.toggle("is-online", isOnline);
  }
  const isPrimary = (card.dataset.hotspotId === "default") ||
    (currentHotspots[0] && (currentHotspots[0].id === hid || currentHotspots[0].id === rawHid)) ||
    (card === document.querySelector(".radio-container"));

  let pingMs = null;
  const cachedBmPings = (typeof window !== "undefined" && window.cachedBmPings) || {};
  const cachedBmHostPings = (typeof window !== "undefined" && window.cachedBmHostPings) || {};
  if (isPrimary || isOnline) {
    pingMs = (cachedBmPings[hid] !== undefined && cachedBmPings[hid] !== null)
      ? cachedBmPings[hid]
      : ((cachedBmPings[rawHid] !== undefined && cachedBmPings[rawHid] !== null)
        ? cachedBmPings[rawHid]
        : (cachedBmHostPings[hostVal] !== undefined ? cachedBmHostPings[hostVal] : null));

    if (pingMs === null || pingMs === undefined || isNaN(Number(pingMs))) {
      const cardHist = loadCardPingHistory(cid);
      if (Array.isArray(cardHist) && cardHist.length > 0) {
        for (let i = cardHist.length - 1; i >= 0; i--) {
          const p = cardHist[i];
          let pVal = null;
          let pHost = null;
          if (Array.isArray(p)) {
            pVal = p[1];
            pHost = p[2] || hostVal;
          } else if (p && typeof p === "object") {
            pVal = p.ping !== undefined ? p.ping : p.latency;
            pHost = p.host || hostVal;
          }
          if ((!pHost || pHost === hostVal) && pVal !== null && pVal !== undefined && !isNaN(Number(pVal)) && Number(pVal) >= 0) {
            pingMs = Math.round(Number(pVal));
            break;
          }
        }
      }
    }
  }

  const prevSavedHost = localStorage.getItem(`proxdmr_host_name_${cid}`);
  if (prevSavedHost && prevSavedHost !== hostVal) {
    // Host changed: reset packet loss counter and timestamp
    const nowSec = Math.floor(Date.now() / 1000);
    card._hostSwitchTime = nowSec;
    localStorage.setItem(`proxdmr_host_switch_${cid}`, String(nowSec));
  }
  card._lastTrackedHost = hostVal;
  localStorage.setItem(`proxdmr_host_name_${cid}`, hostVal);

  const pingEl = banner.querySelector(".bm-banner-ping");
  const pingMode = getHotspotPingMode(cid);
  if (pingEl) {
    if (!pingEl._clickWired) {
      pingEl._clickWired = true;
      pingEl.style.cursor = "pointer";
      pingEl.style.userSelect = "none";
      pingEl.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleHotspotPingMode(cid, card);
      });
    }
    if (pingMode === "client") {
      const ws = (typeof window !== "undefined" && window.ws);
      const isWsOpen = Boolean(ws && ws.readyState === WebSocket.OPEN);
      let clientPing = (isWsOpen && typeof window !== "undefined" && window.cachedClientRtt !== undefined) ? window.cachedClientRtt : null;
      if (isWsOpen && (clientPing === null || clientPing === undefined || isNaN(Number(clientPing)))) {
        const clientHist = (typeof window !== "undefined" && window.clientPingHistory) || [];
        if (Array.isArray(clientHist) && clientHist.length > 0) {
          const nowSec = Date.now() / 1000;
          for (let i = clientHist.length - 1; i >= 0; i--) {
            const p = clientHist[i];
            const pt = Number(p && p.t !== undefined ? p.t : (Array.isArray(p) ? p[0] : 0));
            if (nowSec - pt > 3.5) break;
            const pVal = p && p.ping !== undefined ? p.ping : (Array.isArray(p) ? p[1] : null);
            if (pVal !== null && pVal !== undefined && !isNaN(Number(pVal)) && Number(pVal) >= 0) {
              clientPing = Math.round(Number(pVal));
              break;
            }
          }
        }
      }
      const clientLossData = calculateClientPacketLoss(cid);
      updatePingElement(pingEl, isWsOpen ? clientPing : null, clientLossData, "client");
    } else {
      const isOfflineCard = isCollapsed || (!isOnline && !isPrimary);
      const lossData = isOfflineCard ? { lossPercent: 0, isOffline: true } : calculateCardPacketLoss(cid, hostVal);
      updatePingElement(pingEl, isOfflineCard ? null : pingMs, lossData, "bm");
    }
  }

  // Render SVG Ping Sparkline
  renderCardPingSparkline(card, hostVal);
}

export function refreshAllCardsBmBanner() {
  const currentHotspots = getCurrentHotspots();
  const cards = document.querySelectorAll(".radio-container");
  cards.forEach(card => {
    const hid = card.dataset.hotspotId || "default";
    const cid = resolveHotspotId(hid);
    const hs = (currentHotspots && currentHotspots.length)
      ? (currentHotspots.find(h => h.id === cid) || currentHotspots.find(h => h.id === hid) || currentHotspots[0])
      : null;
    updateCardBmBanner(card, hs);
  });
}

export function updateRxBannerFreshness() {}
export function updateCardRxLiveBanner(card, data) {}
export function updateRxLiveBanner(data) {}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.KNOWN_BM_MASTERS = KNOWN_BM_MASTERS;
  window.getBmFlagBadgeHtml = getBmFlagBadgeHtml;
  window.getBmServerInfo = getBmServerInfo;
  window.populateBmServerSelect = populateBmServerSelect;
  window.isHotspotFullyOnline = isHotspotFullyOnline;
  window.updateCardBmBanner = updateCardBmBanner;
  window.refreshAllCardsBmBanner = refreshAllCardsBmBanner;
  window.updateRxBannerFreshness = updateRxBannerFreshness;
  window.updateCardRxLiveBanner = updateCardRxLiveBanner;
  window.updateRxLiveBanner = updateRxLiveBanner;

  window.__proxdmr = window.__proxdmr || {};
  Object.assign(window.__proxdmr, {
    KNOWN_BM_MASTERS,
    getBmFlagBadgeHtml,
    getBmServerInfo,
    populateBmServerSelect,
    isHotspotFullyOnline,
    updateCardBmBanner,
    refreshAllCardsBmBanner,
    updateRxBannerFreshness,
    updateCardRxLiveBanner,
    updateRxLiveBanner
  });

  window.addEventListener("languageChanged", () => {
    document.querySelectorAll(".bm-server-select").forEach(sel => {
      sel.dataset.lang = "";
      const card = sel.closest(".radio-container");
      const hid = (card && card.dataset.hotspotId) || "default";
      const cid = resolveHotspotId(hid);
      const hs = (getCurrentHotspots() && getCurrentHotspots().length)
        ? (getCurrentHotspots().find(h => h.id === cid) || getCurrentHotspots().find(h => h.id === hid) || getCurrentHotspots()[0])
        : null;
      const host = hs ? hs.bm_master_host : "";
      populateBmServerSelect(sel, host);
    });
    refreshAllCardsBmBanner();
  });
}
