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
} from "../network/ping-sparklines.js?v=2.9.326";
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

export const KNOWN_TGIF_SERVERS = [
  { id: "TGIF-US", country: "US", country_name: "США", name: "TGIF Primary", host: "tgif.network", port: 62031 }
];

export const KNOWN_FREEDMR_SERVERS = [
  { id: "FDMR-EU", country: "EU", country_name: "Европа (Хаб)", name: "FreeDMR Europe (Main Hub)", host: "freedmreu.gb7fr.org.uk", port: 62031, password: "passw0rd" },
  { id: "FDMR-DE", country: "DE", country_name: "Германия", name: "FreeDMR Германия (2621)", host: "178.254.30.151", port: 62031, password: "passw0rd" },
  { id: "FDMR-UK", country: "GB", country_name: "Великобритания", name: "FreeDMR UK (2341)", host: "hotspot.uk.freedmr.link", port: 62031, password: "passw0rd" },
  { id: "FDMR-SCT", country: "GB", country_name: "Шотландия", name: "FreeDMR Scotland (2345)", host: "freedmr.m0xfn.radio", port: 62031, password: "passw0rd" },
  { id: "FDMR-BG", country: "BG", country_name: "Болгария", name: "FreeDMR Болгария (2841)", host: "fdmrbg.ddns.net", port: 62031, password: "passw0rd" },
  { id: "FDMR-GR", country: "GR", country_name: "Греция", name: "FreeDMR Греция (2021)", host: "dmr.freedmr.gr", port: 62031, password: "passw0rd" },
  { id: "FDMR-SE", country: "SE", country_name: "Швеция", name: "FreeDMR Швеция (2401)", host: "2401.freedmrsweden.se", port: 62031, password: "passw0rd" },
  { id: "FDMR-NO", country: "NO", country_name: "Норвегия", name: "FreeDMR Норвегия (2421)", host: "norway.freedmr.no", port: 62031, password: "passw0rd" },
  { id: "FDMR-FR", country: "FR", country_name: "Франция", name: "FreeDMR Франция (2082)", host: "alpes-grenoble.ovh", port: 62031, password: "passw0rd" },
  { id: "FDMR-IT", country: "IT", country_name: "Италия", name: "FreeDMR Италия (2221)", host: "hotspots.freedmr.it", port: 62031, password: "PASSWORD" },
  { id: "FDMR-US-FL", country: "US", country_name: "США (Флорида)", name: "FreeDMR USA Florida (3109)", host: "freedmr.dvswitch.org", port: 62031, password: "passw0rd" },
  { id: "FDMR-US-SF", country: "US", country_name: "США (Сан-Франциско)", name: "FreeDMR USA West (3103)", host: "us-sf.freedmr.cc", port: 62031, password: "passw0rd" },
  { id: "FDMR-BR", country: "BR", country_name: "Бразилия", name: "FreeDMR Бразилия (7242)", host: "freedmr.network365.com.br", port: 62031, password: "passw0rd" },
  { id: "ADN-GL", country: "GLOBAL", country_name: "ADN Systems", name: "ADN Global Router", host: "master.adn.systems", port: 62031, password: "passw0rd" }
];

export const KNOWN_DMRPLUS_SERVERS = [
  { id: "IPSC2-DMR-DL", country: "DE", country_name: "Германия", name: "IPSC2-DMR-DL DE", host: "5.28.41.138", port: 55555, password: "PASSWORD" },
  { id: "IPSC2-DL-HOTSPOT", country: "DE", country_name: "Германия", name: "IPSC2-DL-HOTSPOT DE", host: "91.132.144.235", port: 55555, password: "PASSWORD" },
  { id: "IPSC2-Austria", country: "AT", country_name: "Австрия", name: "IPSC2-Austria AT", host: "89.185.97.234", port: 55555, password: "PASSWORD" },
  { id: "IPSC2-Italia", country: "IT", country_name: "Италия", name: "IPSC2-Italia IT", host: "85.10.203.242", port: 55555, password: "PASSWORD" },
  { id: "IPSC2-RU", country: "RU", country_name: "Россия", name: "IPSC2-RU", host: "ipsc2.ru", port: 55555, password: "PASSWORD" },
  { id: "IPSC2-QuadNet", country: "US", country_name: "США", name: "IPSC2-QuadNet US", host: "ipsc2.openquad.net", port: 55555, password: "PASSWORD" }
];

export const KNOWN_XLX_SERVERS = [
  { id: "XLX270", country: "LU", country_name: "Люксембург", name: "XLX270 LU", host: "158.64.26.132", port: 62030 },
  { id: "XLX250", country: "RU", country_name: "Россия", name: "XLX250 US/RU", host: "23.130.172.11", port: 62030 },
  { id: "XLX777", country: "RU", country_name: "Россия", name: "XLX777 CIS", host: "194.182.80.219", port: 62030 },
  { id: "XLX002", country: "DE", country_name: "Германия", name: "XLX002 DE", host: "223.95.197.217", port: 62030 },
  { id: "XLX020", country: "US", country_name: "США", name: "XLX020 US", host: "66.175.215.217", port: 62030 },
  { id: "XLX950", country: "GB", country_name: "Великобритания", name: "XLX950 UK", host: "158.64.26.134", port: 62030 }
];

export const DMR_NETWORK_PROFILES = {
  bm: {
    id: "bm",
    shortLabel: "BM",
    badgePrefix: "BM",
    fullName: "BrandMeister",
    defaultHost: "2502.master.brandmeister.network",
    defaultPort: 62031,
    defaultPassword: "",
    defaultTgTs1: 91,
    defaultTgTs2: 2501,
    hasBmApi: true,
    hasRpto: false,
    hasXlxModule: false,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>`
  },
  tgif: {
    id: "tgif",
    shortLabel: "TGIF",
    badgePrefix: "TGIF",
    fullName: "TGIF Network",
    defaultHost: "tgif.network",
    defaultPort: 62031,
    defaultPassword: "passw0rd",
    defaultTgTs1: 9990,
    defaultTgTs2: 777,
    hasBmApi: true,
    hasRpto: false,
    hasXlxModule: false,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`
  },
  freedmr: {
    id: "freedmr",
    shortLabel: "FDMR",
    badgePrefix: "FDMR",
    fullName: "FreeDMR / ADN",
    defaultHost: "178.254.30.151",
    defaultPort: 62031,
    defaultPassword: "passw0rd",
    defaultTgTs1: 91,
    defaultTgTs2: 2501,
    hasBmApi: false,
    hasRpto: true,
    hasXlxModule: false,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>`
  },
  dmrplus: {
    id: "dmrplus",
    shortLabel: "DMR+",
    badgePrefix: "DMR+",
    fullName: "DMR+ / IPSC2",
    defaultHost: "5.28.41.138",
    defaultPort: 55555,
    defaultPassword: "PASSWORD",
    defaultTgTs1: 1,
    defaultTgTs2: 9,
    hasBmApi: false,
    hasRpto: true,
    hasXlxModule: false,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`
  },
  xlx: {
    id: "xlx",
    shortLabel: "XLX",
    badgePrefix: "XLX",
    fullName: "XLX Reflector",
    defaultHost: "xlx250.ru",
    defaultPort: 62030,
    defaultPassword: "passw0rd",
    defaultTgTs1: 9,
    defaultTgTs2: 4004,
    hasBmApi: false,
    hasRpto: false,
    hasXlxModule: true,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/><line x1="15.5" y1="8.5" x2="8.5" y2="15.5"/></svg>`
  },
  custom: {
    id: "custom",
    shortLabel: "HBP",
    badgePrefix: "HBP",
    fullName: "HomeBrew / HBlink3",
    defaultHost: "",
    defaultPort: 62031,
    defaultPassword: "passw0rd",
    defaultTgTs1: 1,
    defaultTgTs2: 9,
    hasBmApi: false,
    hasRpto: true,
    hasXlxModule: false,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><line x1="6" y1="6.5" x2="6.01" y2="6.5"/><line x1="6" y1="17.5" x2="6.01" y2="17.5"/></svg>`
  }
};

export function getDmrNetworkProfile(netType) {
  const key = String(netType || "bm").trim().toLowerCase();
  return DMR_NETWORK_PROFILES[key] || DMR_NETWORK_PROFILES.bm;
}

export function sortServersForDropdown(servers) {
  if (!Array.isArray(servers) || !servers.length) return [];
  const online = [];
  const untested = [];
  const dead = [];

  servers.forEach(s => {
    if (!s) return;
    const st = (s.state || "").toLowerCase();
    const isDead = ["no_reply", "refused", "dns_fail"].includes(st) ||
                   (s.udp_ok === false && s.avg_ping == null && s.udp_ms == null) ||
                   (s.loss_pct !== undefined && s.loss_pct >= 100);
    const hasPing = (s.udp_ms !== undefined && s.udp_ms !== null) ||
                    (s.avg_ping !== undefined && s.avg_ping !== null);

    if (isDead) {
      dead.push(s);
    } else if (st === "online" || hasPing) {
      online.push(s);
    } else {
      untested.push(s);
    }
  });

  online.sort((a, b) => {
    const pingA = a.udp_ms != null ? a.udp_ms : (a.avg_ping != null ? a.avg_ping : 9999);
    const pingB = b.udp_ms != null ? b.udp_ms : (b.avg_ping != null ? b.avg_ping : 9999);
    return pingA - pingB;
  });

  return [...online, ...untested, ...dead];
}

export function getNetworkServersList(netType) {
  const key = String(netType || "bm").trim().toLowerCase();
  if (typeof window !== "undefined" && window._dmrServersCache && Array.isArray(window._dmrServersCache[key]) && window._dmrServersCache[key].length > 0) {
    return window._dmrServersCache[key];
  }
  if (key === "tgif") return KNOWN_TGIF_SERVERS;
  if (key === "freedmr") return KNOWN_FREEDMR_SERVERS;
  if (key === "dmrplus") {
    if (typeof window !== "undefined" && (!window._dmrServersCache || !window._dmrServersCache["dmrplus"])) {
      refreshDmrPlusServers();
    }
    return (typeof window !== "undefined" && window._dmrServersCache && window._dmrServersCache["dmrplus"]) || KNOWN_DMRPLUS_SERVERS;
  }
  if (key === "xlx") {
    if (typeof window !== "undefined" && (!window._dmrServersCache || !window._dmrServersCache["xlx"])) {
      refreshXlxServers();
    }
    return (typeof window !== "undefined" && window._dmrServersCache && window._dmrServersCache["xlx"]) || KNOWN_XLX_SERVERS;
  }
  if (key === "custom") return [];
  const bmMastersList = (typeof window !== "undefined" && window.bmMastersList) || [];
  return bmMastersList.length ? bmMastersList : KNOWN_BM_MASTERS;
}

let _freedmrRefreshPromise = null;

let _dmrplusRefreshPromise = null;

export async function refreshDmrPlusServers() {
  if (_dmrplusRefreshPromise) return _dmrplusRefreshPromise;
  _dmrplusRefreshPromise = (async () => {
    try {
      const resp = await fetch("/api/dmrplus/hosts");
      if (!resp.ok) return KNOWN_DMRPLUS_SERVERS;
      const data = await resp.json().catch(() => ({}));
      if (data && Array.isArray(data.servers) && data.servers.length >= 3) {
        KNOWN_DMRPLUS_SERVERS.splice(0, KNOWN_DMRPLUS_SERVERS.length, ...data.servers);
        if (typeof window !== "undefined") {
          window._dmrServersCache = window._dmrServersCache || {};
          window._dmrServersCache["dmrplus"] = data.servers;
          window._dmrServersCacheVer = Date.now();
          if (typeof window.renderRadiosGrid === "function") {
            window.renderRadiosGrid();
          }
        }
      }
    } catch (e) {
      console.warn("[BM-BANNER] Failed to refresh DMR+ servers:", e);
    } finally {
      _dmrplusRefreshPromise = null;
    }
    return KNOWN_DMRPLUS_SERVERS;
  })();
  return _dmrplusRefreshPromise;
}

let _xlxRefreshPromise = null;

export async function refreshXlxServers() {
  if (_xlxRefreshPromise) return _xlxRefreshPromise;
  _xlxRefreshPromise = (async () => {
    try {
      const resp = await fetch("/api/xlx/hosts");
      if (!resp.ok) return KNOWN_XLX_SERVERS;
      const data = await resp.json().catch(() => ({}));
      if (data && Array.isArray(data.servers) && data.servers.length >= 6) {
        KNOWN_XLX_SERVERS.splice(0, KNOWN_XLX_SERVERS.length, ...data.servers);
        if (typeof window !== "undefined") {
          window._dmrServersCache = window._dmrServersCache || {};
          window._dmrServersCache["xlx"] = data.servers;
          window._dmrServersCacheVer = Date.now();
          if (typeof window.renderRadiosGrid === "function") {
            window.renderRadiosGrid();
          }
        }
      }
    } catch (e) {
      console.warn("[BM-BANNER] Failed to refresh XLX reflectors:", e);
    } finally {
      _xlxRefreshPromise = null;
    }
    return KNOWN_XLX_SERVERS;
  })();
  return _xlxRefreshPromise;
}

export async function refreshFreeDmrServers() {
  if (_freedmrRefreshPromise) return _freedmrRefreshPromise;
  _freedmrRefreshPromise = (async () => {
    try {
      const resp = await fetch("/api/freedmr/hosts");
      if (!resp.ok) return KNOWN_FREEDMR_SERVERS;
      const data = await resp.json().catch(() => ({}));
      if (data && Array.isArray(data.servers) && data.servers.length >= 3) {
        KNOWN_FREEDMR_SERVERS.splice(0, KNOWN_FREEDMR_SERVERS.length, ...data.servers);
        if (!KNOWN_FREEDMR_SERVERS.some(s => (s.host || "").toLowerCase() === "master.adn.systems")) {
          KNOWN_FREEDMR_SERVERS.push({
            id: "ADN-GL",
            country: "GLOBAL",
            country_name: "ADN Systems",
            name: "ADN Global Router",
            host: "master.adn.systems",
            port: 62031,
            password: "passw0rd"
          });
        }
      }
    } catch (e) {
      console.warn("[BM-BANNER] Failed to refresh FreeDMR servers:", e);
    } finally {
      _freedmrRefreshPromise = null;
    }
    return KNOWN_FREEDMR_SERVERS;
  })();
  return _freedmrRefreshPromise;
}

export function renderNetworkBadgeElement(badgeEl, netType, xlxModule = "") {
  if (!badgeEl) return;
  const profile = getDmrNetworkProfile(netType);
  badgeEl.className = `hotspot-network-badge net-type-${profile.id}`;
  badgeEl.dataset.networkType = profile.id;

  let labelText = profile.shortLabel;
  if (profile.id === "xlx" && xlxModule) {
    labelText = `XLX-${String(xlxModule).trim().toUpperCase().slice(0, 1)}`;
  }

  const iconWrap = badgeEl.querySelector(".net-badge-icon");
  const labelWrap = badgeEl.querySelector(".net-badge-label");
  const iconHtml = profile.customIconUrl
    ? `<img src="${profile.customIconUrl}" alt="${profile.shortLabel}" class="net-badge-custom-img">`
    : profile.svgIcon;

  if (iconWrap && labelWrap) {
    iconWrap.innerHTML = iconHtml;
    labelWrap.textContent = labelText;
  } else {
    badgeEl.innerHTML = `<span class="net-badge-icon" aria-hidden="true">${iconHtml}</span><span class="net-badge-label">${labelText}</span>`;
  }

  const titlePrefix = (typeof window !== "undefined" && window.t)
    ? window.t("hotspots.net_badge_prefix", {}, "Сеть")
    : "Сеть";
  const clickHint = (typeof window !== "undefined" && window.t)
    ? window.t("hotspots.net_badge_click_hint", {}, "клик — параметры подключения")
    : "клик — параметры подключения";
  badgeEl.title = `${titlePrefix}: ${profile.fullName} (${clickHint})`;
}

export function updateCardNetworkBadge(card, hs) {
  if (!card) return;
  let netBadge = card.querySelector(".hotspot-network-badge");
  if (!netBadge) {
    const brandTitle = card.querySelector(".brand-title");
    if (brandTitle) {
      netBadge = document.createElement("span");
      netBadge.className = "hotspot-network-badge net-type-bm";
      netBadge.setAttribute("role", "button");
      netBadge.setAttribute("tabindex", "0");
      brandTitle.appendChild(netBadge);
    }
  }
  if (!netBadge) return;

  const netType = (hs && hs.network_type) ? hs.network_type : "bm";
  const xlxMod = (hs && hs.xlx_module) ? hs.xlx_module : "D";
  renderNetworkBadgeElement(netBadge, netType, xlxMod);

  if (!netBadge._clickWired) {
    netBadge._clickWired = true;
    netBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      const rawHid = card.dataset.hotspotId || (hs && hs.id) || "default";
      const cid = resolveHotspotId(rawHid);
      const allHs = getCurrentHotspots();
      const targetHs = allHs.find(h => h.id === cid || h.id === rawHid) || hs || allHs[0];
      if (typeof window !== "undefined" && typeof window.switchActiveHotspot === "function") {
        window.switchActiveHotspot(cid);
      }
      if (typeof window !== "undefined" && typeof window.openHotspotSettings === "function") {
        window.openHotspotSettings(targetHs, "tab-edit-hs");
      }
    });
  }
}

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
  return `<span class="flag-badge flag-global" title="${countryName || 'DMR'}"><svg viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>`;
}

export function getBmServerInfo(hostVal, networkType = "bm") {
  const raw = (hostVal || "").trim();
  const clean = raw.toLowerCase();
  const netKey = String(networkType || "bm").trim().toLowerCase();
  const profile = getDmrNetworkProfile(netKey);
  const list = getNetworkServersList(netKey);

  let match = list.find(m => (m.host && m.host.toLowerCase() === clean) || (m.ip && m.ip === clean) || (clean && m.id && clean.includes(String(m.id).toLowerCase())));

  if (!match && netKey === "bm") {
    const idMatch = clean.match(/^(\d{4})/);
    if (idMatch) {
      const idNum = parseInt(idMatch[1], 10);
      match = list.find(m => m.id === idNum);
    }
  }

  if (match) {
    const cCode = (match.country_code || match.country || "GLOBAL").toUpperCase();
    const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
    const cName = cCode !== "GLOBAL" ? getLocalizedCountryName(cCode, match.country_name || match.country || cCode, curLang) : (match.country_name || profile.shortLabel);

    const countryMasters = list.filter(m => {
      const cc = (m.country_code || m.country || "").toUpperCase();
      return cc === cCode;
    }).sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

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
  const shortHost = raw ? raw.replace(/^master\./i, "").split(".")[0].toUpperCase() : profile.shortLabel;
  return {
    countryCode: "GLOBAL",
    countryName: profile.shortLabel,
    displayName: netKey === "bm" ? "BM" : `${profile.shortLabel} ${shortHost !== profile.shortLabel ? shortHost : ""}`.trim(),
    host: raw || profile.defaultHost || "master.brandmeister.network",
    flagHtml: getBmFlagBadgeHtml("global", profile.fullName)
  };
}


export const resolveCardMasterInfo = getBmServerInfo;

export function populateBmServerSelect(select, currentHost, networkType = "bm") {
  if (!select) return;
  const cleanCurrent = (currentHost || "").trim().toLowerCase();
  const netKey = String(networkType || "bm").trim().toLowerCase();
  const profile = getDmrNetworkProfile(netKey);
  const rawMasters = getNetworkServersList(netKey);
  const masters = typeof sortServersByCriteria === "function" ? sortServersByCriteria(rawMasters, "ping", "asc", netKey) : (typeof sortServersForDropdown === "function" ? sortServersForDropdown(rawMasters) : rawMasters);
  const targetCount = masters.length;
  const currentCount = parseInt(select.dataset.masterCount || "0", 10);
  const lastNet = select.dataset.networkType || "";
  const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
  const lastLang = select.dataset.lang || "";
  const lastCacheVer = select.dataset.cacheVer || "";
  const curCacheVer = String((typeof window !== "undefined" && window._dmrServersCacheVer) || 0);
  const pinnedList = getPinnedServers(netKey);
  const pinnedStr = pinnedList.join(",");
  const lastPinned = select.dataset.pinned || "";

  if (currentCount !== targetCount || lastLang !== curLang || lastNet !== netKey || lastCacheVer !== curCacheVer || lastPinned !== pinnedStr) {
    select.innerHTML = "";
    select.dataset.masterCount = String(targetCount);
    select.dataset.lang = curLang;
    select.dataset.networkType = netKey;
    select.dataset.cacheVer = curCacheVer;
    select.dataset.pinned = pinnedStr;

    if (netKey !== "custom") {
      const benchOpt = document.createElement("option");
      benchOpt.value = "__TEST_SERVERS__";
      benchOpt.textContent = window.t ? window.t("hotspots.bench_opt", {}, "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)") : "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)";
      select.appendChild(benchOpt);
    }

    const recTag = window.t ? window.t("bm.master_recommended", {}, "⭐ [Рекомендуется]") : "⭐ [Рекомендуется]";

    masters.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.host || "";
      const cCode = (m.country_code || m.country || "GLOBAL").toUpperCase();
      const countryName = cCode !== "GLOBAL" ? getLocalizedCountryName(cCode, m.country_name || m.country || profile.shortLabel, curLang) : (m.country_name || profile.shortLabel);
      const flag = m.flag || (cCode !== "GLOBAL" ? isoToEmoji(cCode) : "🌐");
      const recSuffix = m.recommended ? ` ${recTag}` : "";
      const labelMid = netKey === "bm" ? `BM ${m.id || ""}` : (m.name || m.id || profile.shortLabel);

      const st = (m.state || "").toLowerCase();
      const isDead = ["no_reply", "refused", "dns_fail"].includes(st) ||
                     (m.udp_ok === false && m.avg_ping == null && m.udp_ms == null) ||
                     (m.loss_pct !== undefined && m.loss_pct >= 100);
      const pingVal = (m.udp_ms !== undefined && m.udp_ms !== null) ? m.udp_ms : ((m.avg_ping !== undefined && m.avg_ping !== null) ? m.avg_ping : null);

      const srvKey = String(m.id || m.host || "").trim();
      const isPinned = Boolean(srvKey && pinnedList.includes(srvKey));
      const pinPrefix = isPinned ? "📌 " : "";

      if (isDead) {
        opt.textContent = `${pinPrefix}🔴 НЕ ОТВЕЧАЕТ · ${flag} ${countryName} — ${labelMid} (${m.host || ""})`;
        opt.style.color = "#ef4444";
        opt.dataset.dead = "1";
      } else if (pingVal !== null && !isNaN(pingVal)) {
        opt.textContent = `${pinPrefix}⚡ ${Math.round(pingVal)} мс · ${flag} ${countryName} — ${labelMid} (${m.host || ""})${recSuffix}`;
        opt.dataset.ping = String(Math.round(pingVal));
      } else {
        opt.textContent = `${pinPrefix}${flag} ${countryName} — ${labelMid} (${m.host || ""})${recSuffix}`;
      }

      select.appendChild(opt);
    });
  } else if (targetCount === 0 && !select.options.length) {
    const info = getBmServerInfo(currentHost, netKey);
    const opt = document.createElement("option");
    opt.value = currentHost || profile.defaultHost || "";
    const flag = info.countryCode !== "GLOBAL" ? isoToEmoji(info.countryCode) : "🌐";
    opt.textContent = `${flag} ${info.displayName || profile.shortLabel} (${opt.value})`;
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
      const info = getBmServerInfo(currentHost, netKey);
      customOpt = document.createElement("option");
      customOpt.value = currentHost;
      const flag = info.countryCode !== "GLOBAL" ? isoToEmoji(info.countryCode) : "🌐";
      customOpt.textContent = `${flag} ${info.displayName} (${currentHost})`;
      select.insertBefore(customOpt, select.firstChild);
    }
    customOpt.selected = true;
  }

  // Initialize / synchronize search & sort combobox
  if (typeof setupServerCombobox === "function") {
    setupServerCombobox(select, currentHost, netKey);
  }
}

export function isHotspotFullyOnline(arg) {
  const ws = getWs();
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  if (!arg) return false;

  const isStatusKeyword = typeof arg === "string" && ["ONLINE", "OFFLINE", "CONNECTING", "AUTHENTICATING", "CONFIGURING", "ERROR", "DISCONNECTED", "AUTH_FAILED"].includes(arg.toUpperCase());
  const rawTargetId = (typeof arg === "object" && arg.id) ? arg.id : (!isStatusKeyword && typeof arg === "string" ? arg : null);
  const targetId = rawTargetId ? resolveHotspotId(rawTargetId) : null;

  if (targetId && typeof window !== "undefined" && typeof window.isHotspotGwDisconnected === "function") {
    if (window.isHotspotGwDisconnected(targetId)) return false;
  } else {
    const isManualGwDisconnect = typeof window !== "undefined" && Boolean(window.isManualGwDisconnect);
    if (isManualGwDisconnect) return false;
  }

  const currentHotspots = getCurrentHotspots();
  if (typeof arg === "string") {
    const upper = arg.toUpperCase();
    if (upper === "ONLINE") return true;
    if (isStatusKeyword) return false;
    const cid = resolveHotspotId(arg);
    const isLive = (typeof isHotspotLiveCollapsed === "function" && isHotspotLiveCollapsed(cid)) || (typeof window !== "undefined" && window.isHotspotLiveCollapsed && window.isHotspotLiveCollapsed(cid));
    if (isHotspotCollapsed(cid) && !isLive) return false;
    const target = currentHotspots.find(h => h.id === cid || h.id === arg);
    const targetLive = target ? ((typeof isHotspotLiveCollapsed === "function" && isHotspotLiveCollapsed(target.id)) || (typeof window !== "undefined" && window.isHotspotLiveCollapsed && window.isHotspotLiveCollapsed(target.id))) : false;
    if (!target || (isHotspotCollapsed(target.id) && !targetLive)) return false;
    return String(target.status || "").toUpperCase() === "ONLINE";
  }
  if (typeof arg === "object") {
    const cid = arg.id ? resolveHotspotId(arg.id) : null;
    const isLive = cid ? ((typeof isHotspotLiveCollapsed === "function" && isHotspotLiveCollapsed(cid)) || (typeof window !== "undefined" && window.isHotspotLiveCollapsed && window.isHotspotLiveCollapsed(cid))) : false;
    if (cid && isHotspotCollapsed(cid) && !isLive) return false;
    return String(arg.status || "").toUpperCase() === "ONLINE";
  }
  return false;
}

export function updateCardBmBanner(card, hs) {
  if (!card) return;
  const currentHotspots = getCurrentHotspots();

  if (!hs) {
    const hid = card.dataset.hotspotId || "default";
    const cid = resolveHotspotId(hid);
    hs = (currentHotspots && currentHotspots.length)
      ? (currentHotspots.find(h => h.id === cid) || currentHotspots.find(h => h.id === hid) || (hid === "default" ? currentHotspots[0] : null) || currentHotspots[0])
      : null;
  }

  // Always update the top header network identity badge
  updateCardNetworkBadge(card, hs);

  const banner = card.querySelector(".bm-info-banner");
  if (!banner) return;

  const netType = (hs && hs.network_type) ? hs.network_type : (card.dataset.networkType || "bm");
  const profile = getDmrNetworkProfile(netType);
  card.dataset.networkType = profile.id;
  const hostVal = (hs && hs.bm_master_host) ? hs.bm_master_host : profile.defaultHost || "2502.master.brandmeister.network";
  const info = getBmServerInfo(hostVal, netType);

  // Update Flag & Short Display Name
  const flagEl = banner.querySelector(".bm-server-flag");
  if (flagEl) {
    flagEl.innerHTML = info.flagHtml || "🌐";
  }

  const nameEl = banner.querySelector(".bm-server-name");
  if (nameEl) {
    const shortName = info.displayName || info.countryName || profile.shortLabel;
    const prefix = profile.shortLabel;
    nameEl.textContent = shortName.toUpperCase().startsWith(prefix.toUpperCase()) ? shortName : `${prefix} ${shortName}`;
    nameEl.title = `${profile.fullName}: ${info.countryName || info.displayName} — ${hostVal}`;
  }

  const modeBadge = banner.querySelector(".bm-ping-mode-badge");
  if (modeBadge && !modeBadge.classList.contains("mode-client")) {
    modeBadge.textContent = profile.shortLabel;
    modeBadge.className = `bm-ping-mode-badge mode-server net-mode-${profile.id} mode-${profile.id === "bm" ? "bm" : profile.id}`;
    modeBadge.dataset.networkType = profile.id;
    modeBadge.title = ((typeof window !== "undefined" && window.t)
      ? (window.t("ping.mode_server_tooltip", { network: profile.shortLabel }) !== "ping.mode_server_tooltip"
          ? window.t("ping.mode_server_tooltip", { network: profile.shortLabel })
          : window.t("ping.mode_bm_tooltip", { network: profile.shortLabel }))
      : `Режим: ${profile.shortLabel}. Кликните по графику для смены на Client ↔ ProxDMR`);
  }

  let select = banner.querySelector(".bm-server-select");
  if (select && (document.activeElement !== select || !select.options.length || select.dataset.networkType !== netType)) {
    populateBmServerSelect(select, hostVal, netType);
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
      const currNet = (targetHs && targetHs.network_type) || "bm";
      populateBmServerSelect(select, currHost, currNet);
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
      const currNet = (targetHs && targetHs.network_type) || "bm";

      if (newHost === "__TEST_SERVERS__") {
        const currHost = (targetHs && targetHs.bm_master_host) || "";
        populateBmServerSelect(select, currHost, currNet);
        const targetId = (targetHs && targetHs.id) ? targetHs.id : cid;
        if (typeof openBmBenchmarkModal === "function") {
          openBmBenchmarkModal(targetId, currNet);
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
      if (typeof window !== "undefined" && typeof window.updateCardXlxPanel === "function") {
        window.updateCardXlxPanel(card, targetHs);
      }
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
          console.error(`[BM-BANNER] Ошибка смены сервера: HTTP ${resp.status}`);
          targetHs.bm_master_host = prevHost;
        }
      } catch (err) {
        console.error("[BM-BANNER] Ошибка смены сервера:", err);
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
      updatePingElement(pingEl, isWsOpen ? clientPing : null, clientLossData, "client", profile.shortLabel);
    } else {
      const isOfflineCard = isCollapsed || (!isOnline && !isPrimary);
      const lossData = isOfflineCard ? { lossPercent: 0, isOffline: true } : calculateCardPacketLoss(cid, hostVal);
      updatePingElement(pingEl, isOfflineCard ? null : pingMs, lossData, "server", profile.shortLabel);
    }
  }

  // Render SVG Ping Sparkline
  renderCardPingSparkline(card, hostVal);

  if (typeof window !== "undefined" && typeof window.updateCardXlxPanel === "function") {
    window.updateCardXlxPanel(card, hs);
  }
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


/* ==========================================================================
   Pinned Servers Management Subsystem
   ========================================================================== */

export function getPinnedServers(netKey) {
  try {
    const raw = localStorage.getItem(`pinnedServers_${netKey}`);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function togglePinServer(netKey, serverKey) {
  if (!serverKey) return [];
  const pinned = getPinnedServers(netKey);
  const idx = pinned.indexOf(serverKey);
  if (idx >= 0) {
    pinned.splice(idx, 1);
  } else {
    pinned.push(serverKey);
  }
  try {
    localStorage.setItem(`pinnedServers_${netKey}`, JSON.stringify(pinned));
  } catch (e) {}
  return pinned;
}

/* ==========================================================================
   Server Search & Sort Combobox Subsystem (.srv-combo)
   ========================================================================== */

export function isSearchComboEnabled(netType) {
  const k = String(netType || "bm").trim().toLowerCase();
  return k === "xlx" || k === "dmrplus";
}

export function extractServerNumber(s) {
  if (!s) return 999999;
  const idStr = String(s.id || s.name || "").trim().toUpperCase();

  // 1. Standard numeric XLX000..XLX999
  const mXlxNum = idStr.match(/^XLX(\d{3})$/);
  if (mXlxNum) {
    return parseInt(mXlxNum[1], 10);
  }

  // 2. Hex XLX like XLX00A..XLX00F (placed after XLX009)
  const mXlxHex = idStr.match(/^XLX([0-9A-F]{3})$/);
  if (mXlxHex) {
    const hexPart = mXlxHex[1];
    if (/^\d{2}/.test(hexPart)) {
      const prefixNum = parseInt(hexPart.slice(0, 2), 10);
      const offset = hexPart.charCodeAt(2) - 64; // 'A' -> 1
      return prefixNum * 10 + 9 + (offset * 0.01);
    }
  }

  // 3. BrandMeister 4-5 digit master numbers (e.g. 2502)
  const mBm = idStr.match(/^(?:BM\s*)?(\d{4,5})$/);
  if (mBm) {
    return parseInt(mBm[1], 10);
  }

  // 4. Fallback standalone word-bounded number
  const mAny = idStr.match(/\b\d+\b/);
  if (mAny) {
    return parseInt(mAny[0], 10);
  }

  return 999999;
}

export function sortServersByCriteria(servers, mode = "ping", dir = "asc", netKey = "xlx") {
  if (!Array.isArray(servers) || !servers.length) return [];
  const pinnedList = getPinnedServers(netKey);
  const isPinned = (s) => {
    if (!s) return false;
    const k = String(s.id || s.host || "").trim();
    return Boolean(k && pinnedList.includes(k));
  };

  const sortSubset = (subset) => {
    if (!subset.length) return [];
    const copy = [...subset];

    if (mode === "ping") {
      const sorted = typeof sortServersForDropdown === "function" ? sortServersForDropdown(copy) : copy;
      if (dir === "desc") {
        const alive = [];
        const dead = [];
        sorted.forEach(s => {
          if (!s) return;
          const st = (s.state || "").toLowerCase();
          const isDead = ["no_reply", "refused", "dns_fail"].includes(st) ||
                         (s.udp_ok === false && s.avg_ping == null && s.udp_ms == null) ||
                         (s.loss_pct !== undefined && s.loss_pct >= 100);
          if (isDead) dead.push(s);
          else alive.push(s);
        });
        alive.reverse();
        return [...alive, ...dead];
      }
      return sorted;
    }

    copy.sort((a, b) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;

      const stA = (a.state || "").toLowerCase();
      const isDeadA = ["no_reply", "refused", "dns_fail"].includes(stA) || (a.loss_pct !== undefined && a.loss_pct >= 100);
      const stB = (b.state || "").toLowerCase();
      const isDeadB = ["no_reply", "refused", "dns_fail"].includes(stB) || (b.loss_pct !== undefined && b.loss_pct >= 100);
      if (isDeadA !== isDeadB) {
        return isDeadA ? 1 : -1;
      }

      let res = 0;
      if (mode === "number") {
        const numA = extractServerNumber(a);
        const numB = extractServerNumber(b);
        res = numA - numB;
        if (res === 0) {
          res = String(a.id || "").localeCompare(String(b.id || ""));
        }
      } else if (mode === "name") {
        const nameA = String(a.name || a.id || "").toLowerCase();
        const nameB = String(b.name || b.id || "").toLowerCase();
        res = nameA.localeCompare(nameB);
      } else if (mode === "address") {
        const addrA = String(a.host || a.ip || "").toLowerCase();
        const addrB = String(b.host || b.ip || "").toLowerCase();
        res = addrA.localeCompare(addrB);
      } else if (mode === "country") {
        const cA = String(a.country_name || a.country || "").toLowerCase();
        const cB = String(b.country_name || b.country || "").toLowerCase();
        res = cA.localeCompare(cB);
        if (res === 0) {
          res = extractServerNumber(a) - extractServerNumber(b);
        }
      }

      return dir === "desc" ? -res : res;
    });

    return copy;
  };

  const pinned = [];
  const unpinned = [];
  servers.forEach(s => {
    if (isPinned(s)) pinned.push(s);
    else unpinned.push(s);
  });

  return [...sortSubset(pinned), ...sortSubset(unpinned)];
}

function escapeComboRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeComboHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function highlightComboMatches(text, tokens) {
  const safe = escapeComboHtml(text);
  if (!tokens || !tokens.length) return safe;
  const validTokens = tokens.filter(t => t.length > 0).sort((a, b) => b.length - a.length);
  if (!validTokens.length) return safe;
  const regex = new RegExp(`(${validTokens.map(escapeComboRegExp).join("|")})`, "gi");
  return safe.replace(regex, '<mark class="srv-combo-mark">$1</mark>');
}

export function filterServersList(servers, query, curLang = "ru") {
  if (!Array.isArray(servers) || !servers.length) return [];
  const trimmed = (query || "").trim().toLowerCase();
  if (!trimmed) return servers;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (!tokens.length) return servers;

  return servers.filter(s => {
    if (!s) return false;
    const cCode = (s.country_code || s.country || "").toUpperCase();
    const locCountry = cCode ? getLocalizedCountryName(cCode, s.country_name || s.country, curLang) : "";
    const haystack = [
      s.id,
      s.name,
      s.host,
      s.ip,
      s.country,
      s.country_name,
      locCountry,
      s.comment
    ].filter(Boolean).join(" ").toLowerCase();

    return tokens.every(tok => haystack.includes(tok));
  });
}

function getDefaultSortMode(netKey, servers) {
  const hasTestedPing = Array.isArray(servers) && servers.some(s => s && (s.udp_ms != null || s.avg_ping != null));
  if (hasTestedPing) return "ping";
  if (netKey === "xlx") return "number";
  if (netKey === "dmrplus") return "ping";
  return "ping";
}

function updateSortButtonsUi(panel, activeMode, activeDir) {
  const btns = panel.querySelectorAll(".srv-sort-btn");
  btns.forEach(btn => {
    const isAct = btn.dataset.mode === activeMode;
    btn.classList.toggle("active", isAct);
    const arrow = btn.querySelector(".srv-sort-arrow");
    if (arrow) {
      arrow.textContent = isAct ? (activeDir === "asc" ? " ▲" : " ▼") : "";
    }
  });
}

export function closeAllServerComboboxes(exceptCombo = null) {
  document.querySelectorAll(".srv-combo-panel").forEach(p => {
    if (exceptCombo && p === exceptCombo.panel) return;
    p.style.display = "none";
    const banner = p.closest(".bm-info-banner");
    if (banner && banner._srvCombo) {
      banner._srvCombo.isOpen = false;
      banner._srvCombo.highlightedIndex = -1;
    }
  });
}

function moveComboHighlight(combo, delta) {
  const items = combo.listEl.querySelectorAll(".srv-combo-item");
  if (!items.length) return;
  let idx = combo.highlightedIndex + delta;
  if (idx < 0) idx = items.length - 1;
  if (idx >= items.length) idx = 0;
  combo.highlightedIndex = idx;
  items.forEach((it, i) => {
    const isHigh = i === idx;
    it.classList.toggle("is-highlighted", isHigh);
    if (isHigh) {
      it.scrollIntoView({ block: "nearest" });
    }
  });
}

function selectHighlightedItem(combo, select) {
  const items = combo.listEl.querySelectorAll(".srv-combo-item");
  if (!items.length) return;
  const idx = combo.highlightedIndex >= 0 ? combo.highlightedIndex : 0;
  const targetItem = items[idx];
  if (targetItem && targetItem.dataset.host) {
    targetItem.click();
  }
}

function renderComboboxList(select) {
  const banner = select.closest(".bm-info-banner");
  if (!banner || !banner._srvCombo) return;
  const combo = banner._srvCombo;
  const netKey = (select.dataset.networkType || "xlx").toLowerCase();
  const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
  const rawMasters = getNetworkServersList(netKey);
  const profile = getDmrNetworkProfile(netKey);
  const currentVal = (select.value || "").trim().toLowerCase();

  const query = combo.query || "";
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = filterServersList(rawMasters, query, curLang);
  const sorted = sortServersByCriteria(filtered, combo.mode, combo.dir, netKey);

  // Update counter
  const foundCount = filtered.length;
  const totalCount = rawMasters.length;
  if (combo.counterEl) {
    combo.counterEl.textContent = (window.t ? window.t("servers.found_n_of_m", { found: foundCount, total: totalCount }) : `Найдено: ${foundCount} из ${totalCount}`);
  }

  // Update Sort buttons
  updateSortButtonsUi(combo.panel, combo.mode, combo.dir);

  // Render list items (capped at 100)
  const listEl = combo.listEl;
  listEl.innerHTML = "";
  combo.highlightedIndex = -1;

  if (sorted.length === 0) {
    const empty = document.createElement("div");
    empty.className = "srv-combo-empty";
    empty.textContent = window.t ? window.t("servers.nothing_found", {}, "Ничего не найдено") : "Ничего не найдено";
    listEl.appendChild(empty);
    return;
  }

  const renderLimit = 100;
  const toRender = sorted.slice(0, renderLimit);
  const excess = sorted.length - renderLimit;

  let selectedElem = null;

  toRender.forEach((m, idx) => {
    const li = document.createElement("li");
    li.className = "srv-combo-item";
    li.dataset.host = m.host || "";
    li.dataset.index = String(idx);

    const cCode = (m.country_code || m.country || "GLOBAL").toUpperCase();
    const countryName = cCode !== "GLOBAL" ? getLocalizedCountryName(cCode, m.country_name || m.country || profile.shortLabel, curLang) : (m.country_name || profile.shortLabel);
    const flag = m.flag || (cCode !== "GLOBAL" ? isoToEmoji(cCode) : "🌐");
    const labelMid = netKey === "bm" ? `BM ${m.id || ""}` : (m.name || m.id || profile.shortLabel);

    const st = (m.state || "").toLowerCase();
    const isDead = ["no_reply", "refused", "dns_fail"].includes(st) ||
                   (m.udp_ok === false && m.avg_ping == null && m.udp_ms == null) ||
                   (m.loss_pct !== undefined && m.loss_pct >= 100);
    const pingVal = (m.udp_ms !== undefined && m.udp_ms !== null) ? m.udp_ms : ((m.avg_ping !== undefined && m.avg_ping !== null) ? m.avg_ping : null);

    if (isDead) {
      li.classList.add("is-dead");
    }

    const mHost = m.host || "";
    const isSelected = currentVal && (currentVal === mHost.toLowerCase() || currentVal === mHost.toLowerCase().split(":")[0]);
    if (isSelected) {
      li.classList.add("is-selected");
      selectedElem = li;
    }

    const srvKey = String(m.id || m.host || "").trim();
    const pinnedList = getPinnedServers(netKey);
    const isPinned = Boolean(srvKey && pinnedList.includes(srvKey));
    if (isPinned) {
      li.classList.add("is-pinned");
    }

    const pinTooltip = isPinned
      ? (window.t ? window.t("servers.unpin_tooltip", {}, "Открепить сервер") : "Открепить сервер")
      : (window.t ? window.t("servers.pin_tooltip", {}, "Закрепить сервер сверху") : "Закрепить сервер сверху");

    const hlLabel = highlightComboMatches(labelMid, tokens);
    const hlCountry = highlightComboMatches(countryName, tokens);
    const hlHost = mHost && mHost !== labelMid ? highlightComboMatches(`(${mHost})`, tokens) : "";

    let pingHtml = "";
    if (isDead) {
      pingHtml = `<span class="srv-item-ping">🔴 НЕ ОТВЕЧАЕТ</span>`;
    } else if (pingVal !== null && !isNaN(pingVal)) {
      pingHtml = `<span class="srv-item-ping">⚡ ${Math.round(pingVal)} мс</span>`;
    }

    li.innerHTML = `
      <div class="srv-item-left">
        <span class="srv-item-flag">${flag}</span>
        <span class="srv-item-title"><strong>${hlLabel}</strong> · ${hlCountry} <small>${hlHost}</small></span>
      </div>
      <div class="srv-item-right">
        ${pingHtml}
        <button type="button" class="srv-pin-btn ${isPinned ? 'is-active' : ''}" title="${pinTooltip}" data-key="${srvKey}">📌</button>
      </div>
    `;

    const pinBtn = li.querySelector(".srv-pin-btn");
    if (pinBtn) {
      pinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        togglePinServer(netKey, srvKey);
        renderComboboxList(select);
        populateBmServerSelect(select, select.value, netKey);
      });
    }

    li.addEventListener("click", (e) => {
      e.stopPropagation();
      closeAllServerComboboxes();
      if (select.value !== mHost) {
        select.value = mHost;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    listEl.appendChild(li);
  });

  if (excess > 0) {
    const more = document.createElement("div");
    more.className = "srv-combo-more";
    more.textContent = window.t ? window.t("servers.more_items", { count: excess }, `...и ещё ${excess} серверов (уточните запрос)`) : `...и ещё ${excess} серверов (уточните запрос)`;
    listEl.appendChild(more);
  }

  // Scroll to selected element on initial open if not query-filtering
  if (!query && selectedElem) {
    setTimeout(() => {
      selectedElem.scrollIntoView({ block: "center" });
    }, 10);
  }
}

export function setupServerCombobox(select, currentHost, networkType = "xlx") {
  if (!select) return;
  const netKey = String(networkType || "xlx").trim().toLowerCase();
  const wrap = select.closest(".bm-server-label-wrap");
  const banner = select.closest(".bm-info-banner");
  if (!wrap || !banner) return;

  const enabled = isSearchComboEnabled(netKey);
  wrap.classList.toggle("srv-combo-active", enabled);

  if (!enabled) {
    if (banner._srvCombo && banner._srvCombo.panel) {
      banner._srvCombo.panel.style.display = "none";
      banner._srvCombo.isOpen = false;
    }
    return;
  }

  // Global document listeners (only wired once)
  if (typeof window !== "undefined" && !window._srvComboGlobalWired) {
    window._srvComboGlobalWired = true;
    document.addEventListener("click", (e) => {
      if (e.target.closest(".srv-combo-panel") || e.target.closest(".bm-server-label-wrap.srv-combo-active")) {
        return;
      }
      closeAllServerComboboxes();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeAllServerComboboxes();
      }
    });
  }

  // Wire label wrap click trigger
  if (!wrap._srvComboWired) {
    wrap._srvComboWired = true;
    wrap.addEventListener("click", (e) => {
      const net = (select.dataset.networkType || "").toLowerCase();
      if (!isSearchComboEnabled(net)) return;
      e.stopPropagation();
      e.preventDefault();

      if (banner._srvCombo && banner._srvCombo.isOpen) {
        closeAllServerComboboxes();
      } else {
        closeAllServerComboboxes();
        if (banner._srvCombo) {
          banner._srvCombo.panel.style.display = "flex";
          banner._srvCombo.isOpen = true;
          banner._srvCombo.input.value = "";
          banner._srvCombo.clearBtn.style.display = "none";
          banner._srvCombo.query = "";
          renderComboboxList(select);
          banner._srvCombo.input.focus();
        }
      }
    });
  }

  // Create panel if not already created
  if (!banner._srvCombo) {
    const panel = document.createElement("div");
    panel.className = "srv-combo-panel";
    panel.style.display = "none";

    const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
    const placeholder = window.t ? window.t("servers.search_placeholder", {}, "Поиск сервера...") : "Поиск сервера...";
    const clearTitle = window.t ? window.t("servers.clear_search", {}, "Очистить поиск") : "Очистить поиск";
    const testTitle = window.t ? window.t("hotspots.bench_opt", {}, "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)") : "⚡ ТЕСТ СЕРВЕРОВ (пинг-тест всех мастеров)";

    panel.innerHTML = `
      <div class="srv-combo-header">
        <div class="srv-combo-search-row">
          <span class="srv-combo-search-icon">🔍</span>
          <input type="text" class="srv-combo-input" placeholder="${escapeComboHtml(placeholder)}" autocomplete="off" spellcheck="false">
          <button type="button" class="srv-combo-clear" title="${escapeComboHtml(clearTitle)}" style="display: none;">✕</button>
        </div>
        <div class="srv-combo-status-row">
          <span class="srv-combo-counter"></span>
        </div>
        <div class="srv-combo-sort-bar">
          <button type="button" class="srv-sort-btn" data-mode="ping" title="${window.t ? window.t("servers.sort_ping_title", {}, "По пингу") : "По пингу"}">⚡ <span class="srv-sort-lbl">${window.t ? window.t("servers.sort_ping", {}, "Пинг") : "Пинг"}</span><span class="srv-sort-arrow"></span></button>
          <button type="button" class="srv-sort-btn" data-mode="number" title="${window.t ? window.t("servers.sort_number_title", {}, "По номеру") : "По номеру"}">№ <span class="srv-sort-lbl">${window.t ? window.t("servers.sort_number", {}, "Номер") : "Номер"}</span><span class="srv-sort-arrow"></span></button>
          <button type="button" class="srv-sort-btn" data-mode="name" title="${window.t ? window.t("servers.sort_name_title", {}, "По названию") : "По названию"}">А–Я <span class="srv-sort-lbl">${window.t ? window.t("servers.sort_name", {}, "Имя") : "Имя"}</span><span class="srv-sort-arrow"></span></button>
          <button type="button" class="srv-sort-btn" data-mode="address" title="${window.t ? window.t("servers.sort_address_title", {}, "По адресу") : "По адресу"}">🌐 <span class="srv-sort-lbl">${window.t ? window.t("servers.sort_address", {}, "Адрес") : "Адрес"}</span><span class="srv-sort-arrow"></span></button>
          <button type="button" class="srv-sort-btn" data-mode="country" title="${window.t ? window.t("servers.sort_country_title", {}, "По стране") : "По стране"}">🏳 <span class="srv-sort-lbl">${window.t ? window.t("servers.sort_country", {}, "Страна") : "Страна"}</span><span class="srv-sort-arrow"></span></button>
        </div>
      </div>
      <div class="srv-combo-test-row" title="${escapeComboHtml(testTitle)}">
        <span>⚡</span>
        <span class="srv-combo-test-lbl">${escapeComboHtml(testTitle)}</span>
      </div>
      <ul class="srv-combo-list"></ul>
    `;

    banner.appendChild(panel);

    const input = panel.querySelector(".srv-combo-input");
    const clearBtn = panel.querySelector(".srv-combo-clear");
    const counterEl = panel.querySelector(".srv-combo-counter");
    const listEl = panel.querySelector(".srv-combo-list");
    const testRow = panel.querySelector(".srv-combo-test-row");

    const rawMasters = getNetworkServersList(netKey);
    let savedMode = null;
    let savedDir = "asc";
    try {
      savedMode = localStorage.getItem(`srvSortMode_${netKey}`);
      savedDir = localStorage.getItem(`srvSortDir_${netKey}`) || "asc";
    } catch (_) {}

    banner._srvCombo = {
      panel,
      input,
      clearBtn,
      counterEl,
      listEl,
      testRow,
      isOpen: false,
      query: "",
      mode: savedMode || getDefaultSortMode(netKey, rawMasters),
      dir: savedDir,
      highlightedIndex: -1
    };

    // Prevent clicks inside panel from closing it
    panel.addEventListener("click", (e) => e.stopPropagation());

    // Search input debounced
    let debounceTimer = null;
    input.addEventListener("input", () => {
      clearBtn.style.display = input.value.trim() ? "flex" : "none";
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        banner._srvCombo.query = input.value.trim();
        banner._srvCombo.highlightedIndex = -1;
        renderComboboxList(select);
      }, 80);
    });

    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      input.value = "";
      clearBtn.style.display = "none";
      banner._srvCombo.query = "";
      banner._srvCombo.highlightedIndex = -1;
      renderComboboxList(select);
      input.focus();
    });

    // Keyboard navigation
    panel.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveComboHighlight(banner._srvCombo, 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveComboHighlight(banner._srvCombo, -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        selectHighlightedItem(banner._srvCombo, select);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeAllServerComboboxes();
      }
    });

    // Sort buttons
    const sortBtns = panel.querySelectorAll(".srv-sort-btn");
    sortBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const mode = btn.dataset.mode;
        const curNet = (select.dataset.networkType || "xlx").toLowerCase();
        if (banner._srvCombo.mode === mode) {
          banner._srvCombo.dir = banner._srvCombo.dir === "asc" ? "desc" : "asc";
        } else {
          banner._srvCombo.mode = mode;
          banner._srvCombo.dir = "asc";
        }
        try {
          localStorage.setItem(`srvSortMode_${curNet}`, banner._srvCombo.mode);
          localStorage.setItem(`srvSortDir_${curNet}`, banner._srvCombo.dir);
        } catch (_) {}
        renderComboboxList(select);
      });
    });

    // Test Servers Row
    testRow.addEventListener("click", (e) => {
      e.stopPropagation();
      closeAllServerComboboxes();
      select.value = "__TEST_SERVERS__";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  // Update localized text if open
  if (banner._srvCombo && banner._srvCombo.isOpen) {
    renderComboboxList(select);
  }
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.KNOWN_BM_MASTERS = KNOWN_BM_MASTERS;
  window.DMR_NETWORK_PROFILES = DMR_NETWORK_PROFILES;
  window.getDmrNetworkProfile = getDmrNetworkProfile;
  window.getNetworkServersList = getNetworkServersList;
  window.renderNetworkBadgeElement = renderNetworkBadgeElement;
  window.updateCardNetworkBadge = updateCardNetworkBadge;
  window.getBmFlagBadgeHtml = getBmFlagBadgeHtml;
  window.getBmServerInfo = getBmServerInfo;
  window.populateBmServerSelect = populateBmServerSelect;
  window.isHotspotFullyOnline = isHotspotFullyOnline;
  window.updateCardBmBanner = updateCardBmBanner;
  window.refreshAllCardsBmBanner = refreshAllCardsBmBanner;
  window.updateRxBannerFreshness = updateRxBannerFreshness;
  window.updateCardRxLiveBanner = updateCardRxLiveBanner;
  window.updateRxLiveBanner = updateRxLiveBanner;
  window.refreshXlxServers = refreshXlxServers;
  window.refreshDmrPlusServers = refreshDmrPlusServers;
  window.getPinnedServers = getPinnedServers;
  window.togglePinServer = togglePinServer;
  window.isSearchComboEnabled = isSearchComboEnabled;
  window.sortServersByCriteria = sortServersByCriteria;
  window.filterServersList = filterServersList;
  window.setupServerCombobox = setupServerCombobox;
  window.closeAllServerComboboxes = closeAllServerComboboxes;

  window.__proxdmr = window.__proxdmr || {};
  Object.assign(window.__proxdmr, {
    KNOWN_BM_MASTERS,
    DMR_NETWORK_PROFILES,
    getDmrNetworkProfile,
    getNetworkServersList,
    renderNetworkBadgeElement,
    updateCardNetworkBadge,
    getBmFlagBadgeHtml,
    getBmServerInfo,
    populateBmServerSelect,
    isHotspotFullyOnline,
    updateCardBmBanner,
    refreshAllCardsBmBanner,
    updateRxBannerFreshness,
    updateCardRxLiveBanner,
    updateRxLiveBanner,
    refreshXlxServers,
    refreshDmrPlusServers,
    getPinnedServers,
    togglePinServer,
    isSearchComboEnabled,
    sortServersByCriteria,
    filterServersList,
    setupServerCombobox,
    closeAllServerComboboxes
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
      const netType = hs ? (hs.network_type || "bm") : "bm";
      populateBmServerSelect(sel, host, netType);
    });
    refreshAllCardsBmBanner();
  });
}
