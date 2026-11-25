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
} from "../network/ping-sparklines.js?v=2.9.826";
import { openBmBenchmarkModal } from "./bm-benchmark.js?v=2.9.826";
import { isHotspotCollapsed, isHotspotLiveCollapsed } from "../audio/volume-mute.js?v=2.9.826";
import { isoToEmoji, getLocalizedCountryName } from "../core/formatters.js?v=2.9.787";

// ── Server-backed pinned-servers & sort-prefs cache ────────────────────
let _pinnedServersCache = {};   // { netKey: [host1, host2, ...] }
let _pinnedServersCacheLoaded = false;
let _srvSortPrefsCache = {};    // { srvSortMode_<net>: mode, srvSortDir_<net>: dir }

function _applyBannerCollections(pinnedData, sortData) {
  if (pinnedData && typeof pinnedData === "object") {
    _pinnedServersCache = { ...pinnedData };
    _pinnedServersCacheLoaded = true;
  }
  if (sortData && typeof sortData === "object") {
    _srvSortPrefsCache = { ...sortData };
  }
}

async function _loadPinnedServersFromServer() {
  try {
    const [resPinned, resSort] = await Promise.all([
      fetch("/api/collections/pinned_servers"),
      fetch("/api/collections/srv_sort_prefs")
    ]);
    if (resPinned.ok) {
      const json = await resPinned.json();
      if (json && json.status === "ok" && json.data) {
        _pinnedServersCache = json.data;
      }
    }
    if (resSort.ok) {
      const jsonSort = await resSort.json();
      if (jsonSort && jsonSort.status === "ok" && jsonSort.data) {
        _srvSortPrefsCache = jsonSort.data;
      }
    }
  } catch (e) {
    console.warn("[BM-BANNER] Failed to load server prefs:", e);
  }
  _pinnedServersCacheLoaded = true;
}

function _savePinnedServerToServer(netKey, pinned) {
  _pinnedServersCache[netKey] = pinned;
  if (typeof window !== "undefined" && typeof window.setServerCollectionKey === "function") {
    window.setServerCollectionKey("pinned_servers", netKey, pinned, "pinnedServers_", true);
    return;
  }
  fetch(`/api/collections/pinned_servers/${encodeURIComponent(netKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ value: pinned })
  }).catch(e => console.warn("[BM-BANNER] Failed to save pinned servers:", e));
}

function _saveSrvSortPrefsToServer(netKey, mode, dir) {
  const modeKey = `srvSortMode_${netKey}`;
  const dirKey = `srvSortDir_${netKey}`;
  _srvSortPrefsCache[modeKey] = mode;
  _srvSortPrefsCache[dirKey] = dir;
  if (typeof window !== "undefined" && typeof window.setServerCollectionKey === "function") {
    window.setServerCollectionKey("srv_sort_prefs", modeKey, mode, "", false);
    window.setServerCollectionKey("srv_sort_prefs", dirKey, dir, "", false);
  } else {
    fetch(`/api/collections/srv_sort_prefs/${encodeURIComponent(modeKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ value: mode })
    }).catch(() => {});
    fetch(`/api/collections/srv_sort_prefs/${encodeURIComponent(dirKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ value: dir })
    }).catch(() => {});
  }
  try {
    localStorage.setItem(modeKey, mode);
    localStorage.setItem(dirKey, dir);
  } catch (_) {}
}

export const KNOWN_BM_MASTERS = [
  { id: 2322, country: "AT", country_name: "Austria", host: "2322.master.brandmeister.network", ip: "62.171.130.35" },
  { id: 2502, country: "RU", country_name: "Russia", host: "2502.master.brandmeister.network", ip: "44.32.144.132" },
  { id: 2503, country: "RU", country_name: "Russia", host: "2503.master.brandmeister.network", ip: "164.215.71.108" },
  { id: 2621, country: "DE", country_name: "Germany", host: "2621.master.brandmeister.network", ip: "87.106.126.49" },
  { id: 2622, country: "DE", country_name: "Germany", host: "2622.master.brandmeister.network", ip: "178.238.234.72" },
  { id: 2282, country: "CH", country_name: "Switzerland", host: "2282.master.brandmeister.network", ip: "185.46.59.78" },
  { id: 3102, country: "US", country_name: "USA", host: "3102.master.brandmeister.network", ip: "74.91.114.19" },
  { id: 3103, country: "US", country_name: "USA", host: "3103.master.brandmeister.network", ip: "74.91.118.251" },
  { id: 3104, country: "US", country_name: "USA", host: "3104.master.brandmeister.network", ip: "162.248.88.117" },
  { id: 2081, country: "FR", country_name: "France", host: "2081.master.brandmeister.network", ip: "217.182.129.130" },
  { id: 2082, country: "FR", country_name: "France", host: "2082.master.brandmeister.network", ip: "217.182.129.131" },
  { id: 2341, country: "GB", country_name: "United Kingdom", host: "2341.master.brandmeister.network", ip: "51.68.220.36" },
  { id: 2141, country: "ES", country_name: "Spain", host: "2141.master.brandmeister.network", ip: "84.232.5.113" },
  { id: 2222, country: "IT", country_name: "Italy", host: "2222.master.brandmeister.network", ip: "31.14.134.183" },
  { id: 2041, country: "NL", country_name: "Netherlands", host: "2041.master.brandmeister.network", ip: "44.137.42.20" },
  { id: 2602, country: "PL", country_name: "Poland", host: "2602.master.brandmeister.network", ip: "195.26.76.59" },
  { id: 2302, country: "CZ", country_name: "Czech Republic", host: "2302.master.brandmeister.network", ip: "80.250.21.206" },
  { id: 2402, country: "SE", country_name: "Sweden", host: "2402.master.brandmeister.network", ip: "44.5.24.178" },
  { id: 2441, country: "FI", country_name: "Finland", host: "2441.master.brandmeister.network", ip: "85.188.1.107" },
  { id: 2421, country: "NO", country_name: "Norway", host: "2421.master.brandmeister.network", ip: "80.89.46.242" },
  { id: 2382, country: "DK", country_name: "Denmark", host: "2382.master.brandmeister.network", ip: "185.51.76.16" },
  { id: 2162, country: "HU", country_name: "Hungary", host: "2162.master.brandmeister.network", ip: "185.187.75.192" },
  { id: 2262, country: "RO", country_name: "Romania", host: "2262.master.brandmeister.network", ip: "94.176.6.38" },
  { id: 2841, country: "BG", country_name: "Bulgaria", host: "2841.master.brandmeister.network", ip: "44.31.90.2" },
  { id: 2931, country: "SI", country_name: "Slovenia", host: "46.54.227.93", ip: "46.54.227.93" },
  { id: 2682, country: "PT", country_name: "Portugal", host: "2682.master.brandmeister.network", ip: "193.137.237.12" },
  { id: 2721, country: "IE", country_name: "Ireland", host: "2721.master.brandmeister.network", ip: "44.155.254.5" },
  { id: 2022, country: "GR", country_name: "Greece", host: "2022.master.brandmeister.network", ip: "185.4.134.95" },
  { id: 2061, country: "BE", country_name: "Belgium", host: "2061.master.brandmeister.network", ip: "194.146.121.130" },
  { id: 3021, country: "CA", country_name: "Canada", host: "3021.master.brandmeister.network", ip: "158.69.203.89" },
  { id: 4251, country: "IL", country_name: "Israel", host: "4251.master.brandmeister.network", ip: "31.154.7.7" },
  { id: 5051, country: "AU", country_name: "Australia", host: "5051.master.brandmeister.network", ip: "103.230.158.71" },
  { id: 4501, country: "KR", country_name: "South Korea", host: "4501.master.brandmeister.network", ip: "211.60.41.188" },
  { id: 4602, country: "CN", country_name: "China", host: "4602.master.brandmeister.network", ip: "43.129.83.124" },
  { id: 5021, country: "MY", country_name: "Malaysia", host: "5021.master.brandmeister.network", ip: "103.197.58.171" },
  { id: 5151, country: "PH", country_name: "Philippines", host: "5151.master.brandmeister.network", ip: "120.89.61.77" },
  { id: 6551, country: "ZA", country_name: "South Africa", host: "6551.master.brandmeister.network", ip: "154.66.196.131" },
  { id: 7242, country: "BR", country_name: "Brazil", host: "7242.master.brandmeister.network", ip: "69.62.93.116" },
  { id: 7301, country: "CL", country_name: "Chile", host: "7301.master.brandmeister.network", ip: "170.239.84.17" },
  { id: 3341, country: "MX", country_name: "Mexico", host: "3341.master.brandmeister.network", ip: "72.1.241.232" }
];

function getBannerCurrentLang() {
  if (typeof window !== "undefined") {
    const direct = (window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) ||
      (window.i18n && (window.i18n.currentLanguage || window.i18n.currentLang)) ||
      window.currentLang;
    if (direct) return direct;
    try {
      const stored = (typeof localStorage !== "undefined") ? localStorage.getItem("proxdmr_language") : "";
      if (stored) return stored;
    } catch (_) {}
    if (typeof document !== "undefined" && document.documentElement && document.documentElement.lang) {
      return document.documentElement.lang;
    }
  }
  return "ru";
}

function resolveServerCountryName(m, fallback, curLang) {
  const lang = curLang || getBannerCurrentLang();
  const cKey = m && m.country_key;
  if (cKey && typeof window !== "undefined" && typeof window.t === "function") {
    const tr = window.t(cKey, {}, "");
    if (tr) return tr;
  }
  const cCode = String((m && (m.country_code || m.country)) || "").trim().toUpperCase();
  if (cCode === "GLOBAL" || cCode === "EU" || cCode === "LOCAL") {
    if (typeof window !== "undefined" && typeof window.t === "function") {
      const tr = window.t(`countries.${cCode}`, {}, "");
      if (tr) return tr;
    }
  }
  if (cCode && cCode !== "GLOBAL" && cCode !== "XX") {
    return getLocalizedCountryName(cCode, fallback || (m && m.country_name) || cCode, lang);
  }
  return fallback || (m && m.country_name) || "";
}

function resolveServerDisplayName(m, fallbackCountryName, curLang) {
  if (!m) return "";
  const locCountry = resolveServerCountryName(m, fallbackCountryName || m.country_name || "", curLang);
  if (m.name_tpl) {
    return m.name_tpl.replace("{country}", locCountry || fallbackCountryName || "");
  }
  const rawName = (m.name || "").trim();
  const bmNameMatch = rawName.match(/\(BM\s+(\d+)\)\s*$/i);
  if (bmNameMatch && locCountry) {
    return `${locCountry} (BM ${bmNameMatch[1]})`;
  }
  const fdmrMatch = rawName.match(/^FreeDMR\s+(.+?)\s*\((\d+)\)\s*$/i);
  if (fdmrMatch && locCountry) {
    const fdmrLabel = fdmrMatch[1].trim();
    if (m.country_key || !/[\s-]/.test(fdmrLabel) || /^(united kingdom|uk)$/i.test(fdmrLabel)) {
      return `FreeDMR ${locCountry} (${fdmrMatch[2]})`;
    }
  }
  return rawName;
}

export const KNOWN_TGIF_SERVERS = [
  { id: "TGIF-US", country: "US", country_name: "USA", name: "TGIF Primary", host: "tgif.network", port: 62031 }
];

export const KNOWN_FREEDMR_SERVERS = [
  { id: "FDMR-EU", country: "EU", country_key: "servers.fdmr_eu_hub", country_name: "Europe (Hub)", name: "FreeDMR Europe (Main Hub)", host: "freedmreu.gb7fr.org.uk", port: 62031, password: "passw0rd" },
  { id: "FDMR-DE", country: "DE", country_name: "Germany", name: "FreeDMR Germany (2621)", name_tpl: "FreeDMR {country} (2621)", host: "178.254.30.151", port: 62031, password: "passw0rd" },
  { id: "FDMR-UK", country: "GB", country_name: "United Kingdom", name: "FreeDMR UK (2341)", host: "hotspot.uk.freedmr.link", port: 62031, password: "passw0rd" },
  { id: "FDMR-SCT", country: "GB", country_key: "servers.sct", country_name: "Scotland", name: "FreeDMR Scotland (2345)", name_tpl: "FreeDMR {country} (2345)", host: "freedmr.m0xfn.radio", port: 62031, password: "passw0rd" },
  { id: "FDMR-BG", country: "BG", country_name: "Bulgaria", name: "FreeDMR Bulgaria (2841)", name_tpl: "FreeDMR {country} (2841)", host: "fdmrbg.ddns.net", port: 62031, password: "passw0rd" },
  { id: "FDMR-GR", country: "GR", country_name: "Greece", name: "FreeDMR Greece (2021)", name_tpl: "FreeDMR {country} (2021)", host: "dmr.freedmr.gr", port: 62031, password: "passw0rd" },
  { id: "FDMR-SE", country: "SE", country_name: "Sweden", name: "FreeDMR Sweden (2401)", name_tpl: "FreeDMR {country} (2401)", host: "2401.freedmrsweden.se", port: 62031, password: "passw0rd" },
  { id: "FDMR-NO", country: "NO", country_name: "Norway", name: "FreeDMR Norway (2421)", name_tpl: "FreeDMR {country} (2421)", host: "norway.freedmr.no", port: 62031, password: "passw0rd" },
  { id: "FDMR-FR", country: "FR", country_name: "France", name: "FreeDMR France (2082)", name_tpl: "FreeDMR {country} (2082)", host: "alpes-grenoble.ovh", port: 62031, password: "passw0rd" },
  { id: "FDMR-IT", country: "IT", country_name: "Italy", name: "FreeDMR Italy (2221)", name_tpl: "FreeDMR {country} (2221)", host: "hotspots.freedmr.it", port: 62031, password: "PASSWORD" },
  { id: "FDMR-US-FL", country: "US", country_key: "servers.fdmr_us_fl", country_name: "USA (Florida)", name: "FreeDMR USA Florida (3109)", host: "freedmr.dvswitch.org", port: 62031, password: "passw0rd" },
  { id: "FDMR-US-SF", country: "US", country_key: "servers.fdmr_us_sf", country_name: "USA (San Francisco)", name: "FreeDMR USA West (3103)", host: "us-sf.freedmr.cc", port: 62031, password: "passw0rd" },
  { id: "FDMR-BR", country: "BR", country_name: "Brazil", name: "FreeDMR Brazil (7242)", name_tpl: "FreeDMR {country} (7242)", host: "freedmr.network365.com.br", port: 62031, password: "passw0rd" }
];

export const KNOWN_YSF_SERVERS = [
  { id: "25000", country: "RU", country_name: "Russia", name: "YSF-Russia (25000)", host: "ysf.brandmeister.ru", port: 42000, description: "Russia National Multi-Protocol Hub" },
  { id: "21080", country: "US", country_name: "USA", name: "America-Link (21080)", host: "americalink.duckdns.org", port: 42000, description: "America-Link C4FM Room" },
  { id: "20000", country: "EU", country_key: "countries.EU", country_name: "Europe", name: "Europe-Link (20000)", host: "eu-link.ysfreflector.de", port: 42000, description: "Europe International Room" },
  { id: "26200", country: "DE", country_name: "Germany", name: "DL-Germany (26200)", host: "ysf.xreflector.net", port: 42000, description: "Germany Fusion Master" },
  { id: "23400", country: "GB", country_name: "United Kingdom", name: "UK-YSF (23400)", host: "uk-ysf.org.uk", port: 42000, description: "UK YSF Reflector" }
];

export const KNOWN_ADN_SERVERS = [
  { id: "ADN-GLOBAL", country: "GLOBAL", country_key: "countries.GLOBAL", country_name: "International", name: "ADN Global Master Hub", host: "master.adn.systems", port: 62031, password: "passw0rd" },
  { id: "ADN-DE", country: "DE", country_name: "Germany", name: "ADN Germany (2621)", host: "2621.adn.systems", port: 62031, password: "passw0rd" },
  { id: "ADN-EE", country: "EE", country_name: "Estonia", name: "ADN Estonia (2481)", host: "2481.adn.systems", port: 62031, password: "passw0rd" },
  { id: "ADN-UA", country: "UA", country_name: "Ukraine", name: "ADN Ukraine (2551)", host: "2551.adn.systems", port: 62031, password: "passw0rd" },
  { id: "ADN-GR", country: "GR", country_name: "Greece", name: "ADN Hellas (2021)", host: "2021.adn.systems", port: 62031, password: "passw0rd" },
  { id: "ADN-IT", country: "IT", country_name: "Italy", name: "ADN Italy (2221)", host: "2221.adn.systems", port: 62031, password: "passw0rd" },
  { id: "ADN-BG", country: "BG", country_name: "Bulgaria", name: "ADN Bulgaria (2841)", host: "2841.adn.systems", port: 62031, password: "passw0rd" },
  { id: "ADN-FR", country: "FR", country_name: "France", name: "ADN France (2082)", host: "2082.adn.systems", port: 62031, password: "passw0rd" },
  { id: "ADN-BR", country: "BR", country_name: "Brazil", name: "ADN Brazil (7241)", host: "7241.adn.systems", port: 62031, password: "passw0rd" },
  { id: "ADN-CL", country: "CL", country_name: "Chile", name: "ADN Chile (7301)", host: "7301.adn.systems", port: 62031, password: "passw0rd" },
  { id: "ADN-MX", country: "MX", country_name: "Mexico", name: "ADN Mexico (3341)", host: "3341.adn.systems", port: 62031, password: "passw0rd" },
  { id: "ADN-US", country: "US", country_name: "USA", name: "ADN USA West (3103)", host: "3103.adn.systems", port: 62031, password: "passw0rd" }
];

export const KNOWN_DMRPLUS_SERVERS = [
  { id: "IPSC2-DMR-DL", country: "DE", country_name: "Germany", name: "IPSC2-DMR-DL DE", host: "5.28.41.138", port: 55555, password: "PASSWORD" },
  { id: "IPSC2-DL-HOTSPOT", country: "DE", country_name: "Germany", name: "IPSC2-DL-HOTSPOT DE", host: "91.132.144.235", port: 55555, password: "PASSWORD" },
  { id: "IPSC2-Austria", country: "AT", country_name: "Austria", name: "IPSC2-Austria AT", host: "89.185.97.234", port: 55555, password: "PASSWORD" },
  { id: "IPSC2-Italia", country: "IT", country_name: "Italy", name: "IPSC2-Italia IT", host: "85.10.203.242", port: 55555, password: "PASSWORD" },
  { id: "IPSC2-RU", country: "RU", country_name: "Russia", name: "IPSC2-RU", host: "ipsc2.ru", port: 55555, password: "PASSWORD" },
  { id: "IPSC2-QuadNet", country: "US", country_name: "USA", name: "IPSC2-QuadNet US", host: "ipsc2.openquad.net", port: 55555, password: "PASSWORD" }
];

export const KNOWN_XLX_SERVERS = [
  { id: "XLX270", country: "LU", country_name: "Luxembourg", name: "XLX270 LU", host: "158.64.26.132", port: 62030 },
  { id: "XLX250", country: "RU", country_name: "Russia", name: "XLX250 US/RU", host: "23.130.172.11", port: 62030 },
  { id: "XLX777", country: "RU", country_name: "Russia", name: "XLX777 CIS", host: "194.182.80.219", port: 62030 },
  { id: "XLX002", country: "DE", country_name: "Germany", name: "XLX002 DE", host: "223.95.197.217", port: 62030 },
  { id: "XLX020", country: "US", country_name: "USA", name: "XLX020 US", host: "66.175.215.217", port: 62030 },
  { id: "XLX950", country: "GB", country_name: "United Kingdom", name: "XLX950 UK", host: "158.64.26.134", port: 62030 }
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
    fullName: "FreeDMR",
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
  adn: {
    id: "adn",
    shortLabel: "ADN",
    badgePrefix: "ADN",
    fullName: "ADN Systems",
    defaultHost: "master.adn.systems",
    defaultPort: 62031,
    defaultPassword: "passw0rd",
    defaultTgTs1: 91,
    defaultTgTs2: 2501,
    hasBmApi: false,
    hasRpto: true,
    hasXlxModule: false,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="4" cy="7" r="2"/><circle cx="20" cy="7" r="2"/><circle cx="4" cy="17" r="2"/><circle cx="20" cy="17" r="2"/><line x1="6" y1="8" x2="10" y2="10.5"/><line x1="18" y1="8" x2="14" y2="10.5"/><line x1="6" y1="16" x2="10" y2="13.5"/><line x1="18" y1="16" x2="14" y2="13.5"/></svg>`
  },
  ysf: {
    id: "ysf",
    shortName: "YSF",
    shortLabel: "YSF",
    badgePrefix: "YSF",
    fullName: "Yaesu System Fusion",
    defaultHost: "ysf.brandmeister.ru",
    defaultPort: 42000,
    defaultPassword: "",
    defaultRoom: "25000",
    hasBmApi: false,
    hasRpto: false,
    hasXlxModule: false,
    isSimplex: true,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="12 6 15 11 9 11 12 6"/><line x1="12" y1="11" x2="12" y2="18"/></svg>`
  },
  m17: {
    id: "m17",
    shortName: "M17",
    shortLabel: "M17",
    badgePrefix: "M17",
    fullName: "M17 Protocol",
    defaultHost: "107.191.121.105",
    defaultPort: 17000,
    defaultPassword: "",
    defaultRoom: "M17-M17",
    defaultModule: "C",
    hasBmApi: false,
    hasRpto: false,
    hasXlxModule: false,
    isSimplex: true,
    hasM17Module: true,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M8.5 15.5a5 5 0 0 1 0-7"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M5.5 18.5a9.2 9.2 0 0 1 0-13"/><path d="M18.5 5.5a9.2 9.2 0 0 1 0 13"/></svg>`
  },
  dstar: {
    id: "dstar",
    shortName: "D-STAR",
    shortLabel: "D-STAR",
    badgePrefix: "D-STAR",
    fullName: "D-STAR Protocol",
    defaultHost: "xlx250.ru",
    defaultPort: 30001,
    defaultPassword: "",
    defaultRoom: "XLX250",
    defaultModule: "B",
    hasBmApi: false,
    hasRpto: false,
    hasXlxModule: false,
    isSimplex: true,
    hasDstarModule: true,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
  },
  svx: {
    id: "svx",
    shortName: "SVX",
    shortLabel: "SVX",
    badgePrefix: "SVX",
    fullName: "SVXReflector",
    defaultHost: "nc3.fm-funknetz.de",
    defaultPort: 5308,
    defaultPassword: "",
    defaultTg: 1,
    hasBmApi: false,
    hasRpto: false,
    hasXlxModule: false,
    isSimplex: true,
    hasSvxTg: true,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>`
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
  },
  allstar: {
    id: "allstar",
    shortName: "ASL",
    shortLabel: "ASL",
    badgePrefix: "ASL",
    fullName: "AllStarLink (IAX2)",
    defaultHost: "127.0.0.1",
    defaultPort: 4569,
    defaultPassword: "testpass",
    defaultNode: "1999",
    defaultTgTs1: 0,
    defaultTgTs2: 0,
    hasBmApi: false,
    hasRpto: true,
    hasXlxModule: false,
    isAllStar: true,
    customIconUrl: "",
    svgIcon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/></svg>`
  }
};

export const KNOWN_ALLSTAR_SERVERS = [
  { id: "ASL-LOCAL", country: "LOCAL", country_key: "countries.LOCAL", country_name: "Local ASL", name: "Local ASL Node", host: "127.0.0.1", port: 4569, node: "1999" },
  { id: "ASL-REG", country: "GLOBAL", country_name: "AllStarLink", name: "AllStarLink Central", host: "register.allstarlink.org", port: 4569, node: "1999" }
];

export function getDmrNetworkProfile(netType) {
  let key = String(netType || "bm").trim().toLowerCase();
  if (key === "asl" || key === "iax" || key === "allstarlink") {
    key = "allstar";
  }
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
  if (key === "dstar" && !_dstarFullCatalogLoaded) {
    refreshDstarServers();
  }
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
  if (key === "adn") {
    if (typeof window !== "undefined" && (!window._dmrServersCache || !window._dmrServersCache["adn"])) {
      refreshAdnServers();
    }
    return (typeof window !== "undefined" && window._dmrServersCache && window._dmrServersCache["adn"]) || KNOWN_ADN_SERVERS;
  }
  if (key === "ysf") {
    if (typeof window !== "undefined" && (!window._dmrServersCache || !window._dmrServersCache["ysf"])) {
      refreshYsfServers();
    }
    return (typeof window !== "undefined" && window._dmrServersCache && window._dmrServersCache["ysf"]) || KNOWN_YSF_SERVERS;
  }
  if (key === "m17") {
    if (typeof window !== "undefined" && (!window._dmrServersCache || !window._dmrServersCache["m17"])) {
      refreshM17Servers();
    }
    return (typeof window !== "undefined" && window._dmrServersCache && window._dmrServersCache["m17"]) || KNOWN_M17_SERVERS;
  }
  if (key === "dstar") {
    if (typeof window !== "undefined" && (!window._dmrServersCache || !window._dmrServersCache["dstar"])) {
      refreshDstarServers();
    }
    return (typeof window !== "undefined" && window._dmrServersCache && window._dmrServersCache["dstar"]) || KNOWN_DSTAR_SERVERS;
  }
  if (key === "svx") {
    if (typeof window !== "undefined" && (!window._dmrServersCache || !window._dmrServersCache["svx"])) {
      refreshSvxServers();
    }
    return (typeof window !== "undefined" && window._dmrServersCache && window._dmrServersCache["svx"]) || KNOWN_SVX_SERVERS;
  }
  if (key === "allstar") return KNOWN_ALLSTAR_SERVERS;
  if (key === "custom") return [];
  const bmMastersList = (typeof window !== "undefined" && window.bmMastersList) || [];
  return bmMastersList.length ? bmMastersList : KNOWN_BM_MASTERS;
}

let _freedmrRefreshPromise = null;

let _dmrplusRefreshPromise = null;
let _dmrplusFollowupTimer = null;

export async function refreshDmrPlusServers(force = false) {
  if (_dmrplusRefreshPromise) return _dmrplusRefreshPromise;
  _dmrplusRefreshPromise = (async () => {
    try {
      const url = force ? "/api/dmrplus/hosts?force=true" : "/api/dmrplus/hosts";
      const resp = await fetch(url);
      if (!resp.ok) return KNOWN_DMRPLUS_SERVERS;
      const data = await resp.json().catch(() => ({}));
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.servers) ? data.servers : []);
      if (list.length >= 3) {
        KNOWN_DMRPLUS_SERVERS.splice(0, KNOWN_DMRPLUS_SERVERS.length, ...list);
        if (typeof window !== "undefined") {
          window._dmrServersCache = window._dmrServersCache || {};
          window._dmrServersCache["dmrplus"] = list;
          window._dmrServersCacheVer = Date.now();
          if (typeof window.renderRadiosGrid === "function") {
            window.renderRadiosGrid();
          }
        }
      }
      if (data && !Array.isArray(data) && data.sync_in_progress && !_dmrplusFollowupTimer) {
        _dmrplusFollowupTimer = setTimeout(async () => {
          _dmrplusFollowupTimer = null;
          try {
            const fResp = await fetch("/api/dmrplus/hosts");
            if (fResp.ok) {
              const fData = await fResp.json().catch(() => ({}));
              const fList = Array.isArray(fData) ? fData : (fData && Array.isArray(fData.servers) ? fData.servers : []);
              if (fList.length >= 3) {
                KNOWN_DMRPLUS_SERVERS.splice(0, KNOWN_DMRPLUS_SERVERS.length, ...fList);
                if (typeof window !== "undefined") {
                  window._dmrServersCache = window._dmrServersCache || {};
                  window._dmrServersCache["dmrplus"] = fList;
                  window._dmrServersCacheVer = Date.now();
                  if (typeof window.renderRadiosGrid === "function") {
                    window.renderRadiosGrid();
                  }
                }
              }
            }
          } catch (_) {}
        }, 4000);
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

let _ysfRefreshPromise = null;

export async function refreshYsfServers() {
  if (_ysfRefreshPromise) return _ysfRefreshPromise;
  _ysfRefreshPromise = (async () => {
    try {
      const resp = await fetch("/api/ysf/hosts");
      if (!resp.ok) return KNOWN_YSF_SERVERS;
      const data = await resp.json().catch(() => ({}));
      if (data && Array.isArray(data.rooms) && data.rooms.length >= 3) {
        KNOWN_YSF_SERVERS.splice(0, KNOWN_YSF_SERVERS.length, ...data.rooms);
        if (typeof window !== "undefined") {
          window._dmrServersCache = window._dmrServersCache || {};
          window._dmrServersCache["ysf"] = data.rooms;
          window._dmrServersCacheVer = Date.now();
          if (typeof window.renderRadiosGrid === "function") {
            window.renderRadiosGrid();
          }
          if (typeof document !== "undefined") {
            const curHsList = window.currentHotspots || [];
            document.querySelectorAll('.radio-container.card-net-ysf, .radio-container[data-network-type="ysf"]').forEach(cardEl => {
              const cid = cardEl.dataset.hotspotId;
              const hsObj = curHsList.find(h => h && h.id === cid);
              if (hsObj) {
                if (typeof window.updateCardYsfPanel === "function") window.updateCardYsfPanel(cardEl, hsObj);
                if (typeof window.syncCardYsfDgIdBar === "function") window.syncCardYsfDgIdBar(cardEl, hsObj);
              }
            });
            const ysfView = document.getElementById("ysfRoomsView");
            if (ysfView && ysfView.style.display !== "none" && typeof window.renderYsfRoomsList === "function") {
              const qEl = document.getElementById("ysfRoomSearchInput");
              window.renderYsfRoomsList(qEl ? qEl.value : "");
            }
          }
        }
      }
    } catch (e) {
      console.warn("[BM-BANNER] Failed to refresh YSF servers:", e);
    } finally {
      _ysfRefreshPromise = null;
    }
    return KNOWN_YSF_SERVERS;
  })();
  return _ysfRefreshPromise;
}

export const KNOWN_M17_SERVERS = [
  { id: "M17-M17", designator: "M17-M17", name: "M17 Project Official Reflector", host: "107.191.121.105", port: 17000, server_type: "mrefd", modules: ["A", "B", "C", "D"], country: "US", country_code: "US", country_name: "United States" },
  { id: "M17-USA", designator: "M17-USA", name: "M17 USA Reflector", host: "m17-usa.openquad.net", port: 17000, server_type: "mrefd", modules: ["A", "B", "C", "D", "E"], country: "US", country_code: "US", country_name: "United States" },
  { id: "URF045", designator: "URF045", name: "URF045 PennLink Multiprotocol", host: "urf045.pennlinkgroup.com", port: 17000, server_type: "urfd", modules: ["A", "B", "C"], country: "US", country_code: "US", country_name: "United States" },
  { id: "VEX777", designator: "VEX777", name: "VEX777 M17 Reflector", host: "vex777.m17.link", port: 17000, server_type: "vex", modules: ["A", "B", "C"], country: "GLOBAL", country_code: "XX", country_name: "International" }
];

let _m17RefreshPromise = null;

export async function refreshM17Servers(force = false) {
  if (_m17RefreshPromise && !force) return _m17RefreshPromise;
  _m17RefreshPromise = (async () => {
    try {
      const resp = await fetch(force ? "/api/m17/hosts?refresh=true" : "/api/m17/hosts");
      if (!resp.ok) return KNOWN_M17_SERVERS;
      const data = await resp.json().catch(() => ({}));
      const list = Array.isArray(data && data.hosts) ? data.hosts : [];
      if (list.length > 0) {
        KNOWN_M17_SERVERS.splice(0, KNOWN_M17_SERVERS.length, ...list);
        if (typeof window !== "undefined") {
          window._dmrServersCache = window._dmrServersCache || {};
          window._dmrServersCache["m17"] = list;
          window._dmrServersCacheVer = Date.now();
          if (typeof window.renderRadiosGrid === "function") {
            window.renderRadiosGrid();
          }
        }
      }
    } catch (e) {
      console.warn("[BM-BANNER] Failed to refresh M17 servers:", e);
    } finally {
      _m17RefreshPromise = null;
    }
    return KNOWN_M17_SERVERS;
  })();
  return _m17RefreshPromise;
}

export const KNOWN_DSTAR_SERVERS = [
  { id: "XLX250", designator: "XLX250", name: "XLX250 Russia", host: "xlx250.ru", port: 30001, protocol: "dextra", modules: ["A", "B", "C", "D"], country: "RU", country_code: "RU", country_name: "Russia" },
  { id: "DCS002", designator: "DCS002", name: "DCS002 Germany", host: "dcs002.xreflector.net", port: 30001, protocol: "dcs", modules: ["A", "B", "C"], country: "DE", country_code: "DE", country_name: "Germany" },
  { id: "REF001", designator: "REF001", name: "REF001 DPlus Worldwide", host: "ref001.dstargateway.org", port: 20001, protocol: "dplus", modules: ["C"], country: "US", country_code: "US", country_name: "United States" }
];

let _dstarRefreshPromise = null;
let _dstarFullCatalogLoaded = false;
export async function refreshDstarServers(force = false) {
  if (_dstarRefreshPromise && !force) return _dstarRefreshPromise;
  _dstarRefreshPromise = (async () => {
    try {
      const resp = await fetch(force ? "/api/dstar/hosts?refresh=true" : "/api/dstar/hosts");
      if (!resp.ok) return KNOWN_DSTAR_SERVERS;
      const data = await resp.json().catch(() => ({}));
      const list = Array.isArray(data && data.hosts) ? data.hosts : [];
      if (list.length > 0) {
        _dstarFullCatalogLoaded = true;
        KNOWN_DSTAR_SERVERS.splice(0, KNOWN_DSTAR_SERVERS.length, ...list);
        if (typeof window !== "undefined") {
          window._dmrServersCache = window._dmrServersCache || {};
          window._dmrServersCache["dstar"] = list;
          window._dmrServersCacheVer = Date.now();
          if (typeof window.renderRadiosGrid === "function") {
            window.renderRadiosGrid();
          }
        }
      }
    } catch (e) {
      console.warn("[BM-BANNER] Failed to refresh D-STAR servers:", e);
    } finally {
      _dstarRefreshPromise = null;
    }
    return KNOWN_DSTAR_SERVERS;
  })();
  return _dstarRefreshPromise;
}

export const KNOWN_SVX_SERVERS = [
  { id: "SVX-DE-FMFUNKNETZ", name: "FM-Funknetz Germany (Primary)", host: "nc3.fm-funknetz.de", port: 5308, country: "DE", country_code: "DE", country_name: "Germany", portal_url: "https://fm-funknetz.de/", recommended: true, preset_tgs: [1, 262, 2620, 91, 999] },
  { id: "SVX-DE-FMFUNKNETZ-2", name: "FM-Funknetz Germany (Backup)", host: "master2.fm-funknetz.de", port: 5308, country: "DE", country_code: "DE", country_name: "Germany", portal_url: "https://fm-funknetz.de/", preset_tgs: [1, 262, 2620, 91, 999] },
  { id: "SVX-SE-SM0SVX", name: "Sweden SM0SVX / SK3W (Stockholm)", host: "svxreflector-sthlm.sk3w.se", port: 5300, country: "SE", country_code: "SE", country_name: "Sweden", portal_url: "https://svxportal.sm2ampr.net/", preset_tgs: [240, 2400, 2402, 999] },
  { id: "SVX-SE-FERNEBO", name: "Sweden SM0SVX / SK3W (Fernebo)", host: "svxreflector-fernebo.sk3w.se", port: 5300, country: "SE", country_code: "SE", country_name: "Sweden", portal_url: "https://svxportal.sm2ampr.net/", preset_tgs: [240, 2400, 2402, 999] },
  { id: "SVX-BE-SVXLINK", name: "Belgium SVXLink (ON)", host: "reflector.be.svx.link", port: 5300, country: "BE", country_code: "BE", country_name: "Belgium", portal_url: "https://portal.be.svx.link/", preset_tgs: [1, 206, 2060, 999] },
  { id: "SVX-RO-ROLINK", name: "Romania RoLink Network (YO)", host: "rolink.network", port: 5300, country: "RO", country_code: "RO", country_name: "Romania", portal_url: "https://rolink.network/", preset_tgs: [1, 226, 2261, 999] },
  { id: "SVX-IT-ARI", name: "Italy ARI SvxLink (I)", host: "svx.ampr.ari.it", port: 5300, country: "IT", country_code: "IT", country_name: "Italy", portal_url: "http://svx.ampr.ari.it/", preset_tgs: [1, 222, 999] },
  { id: "SVX-FR-RRF", name: "France RRF (Réseau Répéteurs Francophones)", host: "rrf.f5nlg.ovh", port: 5300, country: "FR", country_code: "FR", country_name: "France", portal_url: "http://rrf4.f5nlg.ovh:82/", preset_tgs: [1, 208, 999] },
  { id: "SVX-PL-FMPOLAND", name: "Poland FM-Poland (SP)", host: "fm-poland.pl", port: 5300, country: "PL", country_code: "PL", country_name: "Poland", portal_url: "https://fm-poland.pl/", preset_tgs: [1, 260, 2600, 999] },
  { id: "SVX-UA-UARADIO", name: "Ukraine UARadioLink (UR)", host: "svx.uaradio.link", port: 5300, country: "UA", country_code: "UA", country_name: "Ukraine", portal_url: "", preset_tgs: [1, 255, 999] }
];

let _svxRefreshPromise = null;
export async function refreshSvxServers(force = false) {
  if (_svxRefreshPromise && !force) return _svxRefreshPromise;
  _svxRefreshPromise = (async () => {
    try {
      const resp = await fetch(force ? "/api/svx/hosts?refresh=true" : "/api/svx/hosts");
      if (!resp.ok) return KNOWN_SVX_SERVERS;
      const data = await resp.json().catch(() => ({}));
      const list = Array.isArray(data && data.servers)
        ? data.servers
        : (Array.isArray(data && data.hosts) ? data.hosts : []);
      if (list.length > 0) {
        KNOWN_SVX_SERVERS.splice(0, KNOWN_SVX_SERVERS.length, ...list);
        if (typeof window !== "undefined") {
          window._dmrServersCache = window._dmrServersCache || {};
          window._dmrServersCache["svx"] = list;
          window._dmrServersCacheVer = Date.now();
          if (typeof window.renderRadiosGrid === "function") {
            window.renderRadiosGrid();
          }
        }
      }
    } catch (e) {
      console.warn("[BM-BANNER] Failed to refresh SVX servers:", e);
    } finally {
      _svxRefreshPromise = null;
    }
    return KNOWN_SVX_SERVERS;
  })();
  return _svxRefreshPromise;
}

let _adnRefreshPromise = null;
let _adnFollowupTimer = null;

export async function refreshAdnServers(force = false) {
  if (_adnRefreshPromise) return _adnRefreshPromise;
  _adnRefreshPromise = (async () => {
    try {
      const url = force ? "/api/adn/hosts?force=true" : "/api/adn/hosts";
      const resp = await fetch(url);
      if (!resp.ok) return KNOWN_ADN_SERVERS;
      const data = await resp.json().catch(() => ({}));
      if (data && Array.isArray(data.servers) && data.servers.length >= 3) {
        KNOWN_ADN_SERVERS.splice(0, KNOWN_ADN_SERVERS.length, ...data.servers);
        if (typeof window !== "undefined") {
          window._dmrServersCache = window._dmrServersCache || {};
          window._dmrServersCache["adn"] = data.servers;
          window._dmrServersCacheVer = Date.now();
          if (typeof window.renderRadiosGrid === "function") {
            window.renderRadiosGrid();
          }
        }
      }

      if (typeof window !== "undefined") {
        let localTgTs = 0;
        try {
          localTgTs = parseInt(localStorage.getItem("proxdmr_adn_tg_last_sync_ts") || "0", 10) || 0;
        } catch (_) {}
        const srvTgTs = Number(data && data.tg_last_sync_ts) || 0;
        const adnMapLen = Object.keys(window.ADN_TG_NAMES || {}).length;
        if ((srvTgTs > localTgTs || adnMapLen < 50) && typeof window.syncTgNamesFromServer === "function") {
          window.syncTgNamesFromServer("adn").catch(() => {});
        }
      }

      // If backend triggered >24h background parse of adn.systems, schedule one silent pull after completion
      if (data && data.sync_in_progress && !_adnFollowupTimer) {
        _adnFollowupTimer = setTimeout(async () => {
          _adnFollowupTimer = null;
          try {
            const fResp = await fetch("/api/adn/hosts");
            if (fResp.ok) {
              const fData = await fResp.json().catch(() => ({}));
              if (fData && Array.isArray(fData.servers) && fData.servers.length >= 3) {
                KNOWN_ADN_SERVERS.splice(0, KNOWN_ADN_SERVERS.length, ...fData.servers);
                if (typeof window !== "undefined") {
                  window._dmrServersCache = window._dmrServersCache || {};
                  window._dmrServersCache["adn"] = fData.servers;
                  window._dmrServersCacheVer = Date.now();
                  if (typeof window.renderRadiosGrid === "function") {
                    window.renderRadiosGrid();
                  }
                }
              }
            }
            if (typeof window !== "undefined" && typeof window.syncTgNamesFromServer === "function") {
              await window.syncTgNamesFromServer("adn");
            }
          } catch (_) {}
        }, 4000);
      }
    } catch (e) {
      console.warn("[BM-BANNER] Failed to refresh ADN servers:", e);
    } finally {
      _adnRefreshPromise = null;
    }
    return KNOWN_ADN_SERVERS;
  })();
  return _adnRefreshPromise;
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
    ? window.t("hotspots.net_badge_prefix", {}, "Network")
    : "Network";
  const clickHint = (typeof window !== "undefined" && window.t)
    ? window.t("hotspots.net_badge_click_hint", {}, "click for connection settings")
    : "click for connection settings";
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
  const profile = getDmrNetworkProfile(netType);
  const pId = profile.id;
  ["bm", "tgif", "freedmr", "xlx", "dmrplus", "allstar", "custom", "adn", "ysf", "m17", "dstar", "svx"].forEach(n => {
    card.classList.toggle(`card-net-${n}`, pId === n);
  });
  card.dataset.networkType = pId;
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
    const curLang = getBannerCurrentLang();
    const cName = resolveServerCountryName(match, match.country_name || match.country || profile.shortLabel, curLang);

    const countryMasters = list.filter(m => {
      const cc = (m.country_code || m.country || "").toUpperCase();
      return cc === cCode;
    }).sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

    const resolvedName = resolveServerDisplayName(match, cName, curLang);
    let displayName = cName;
    if (netKey === "bm") {
      displayName = match.id ? `${cName} (${match.id})` : (resolvedName || cName);
    } else if (resolvedName) {
      displayName = resolvedName;
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

  if (netKey === "allstar") {
    const isLocal = clean === "127.0.0.1" || clean === "localhost";
    const matched = KNOWN_ALLSTAR_SERVERS.find(s => (s.host || "").toLowerCase() === clean);
    const localNodeLabel = (typeof window !== "undefined" && window.t) ? window.t("asl.local_node_title", {}, "ASL Local Node") : "Local Node";
    const localCountryLabel = (typeof window !== "undefined" && window.t) ? window.t("countries.LOCAL", {}, "Local") : "Local";
    const title = matched ? resolveServerDisplayName(matched, localCountryLabel, getBannerCurrentLang()) : (isLocal ? localNodeLabel : (raw ? raw.split(":")[0] : "AllStarLink"));
    return {
      countryCode: isLocal ? "LOCAL" : "GLOBAL",
      countryName: isLocal ? localCountryLabel : "AllStarLink",
      displayName: title,
      host: raw || "127.0.0.1",
      flagHtml: isLocal
        ? `<span class="flag-badge flag-local" title="${escapeComboHtml(localNodeLabel)}">🏠</span>`
        : `<span class="flag-badge flag-global" title="AllStarLink IAX2">🌐</span>`
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
  const curLang = getBannerCurrentLang();
  const lastLang = select.dataset.lang || "";
  const lastCacheVer = select.dataset.cacheVer || "";
  const curCacheVer = String((typeof window !== "undefined" && window._dmrServersCacheVer) || 0);
  const pinnedList = getPinnedServers(netKey);
  const pinnedStr = pinnedList.join(",");
  const lastPinned = select.dataset.pinned || "";
  const ysfFavSig = (netKey === "ysf")
    ? ((typeof window.getYsfBookmarks === "function" ? window.getYsfBookmarks() : []).map(r => String(r.id || r.host || "")).join(","))
    : "";
  const lastYsfFavSig = select.dataset.ysfFavSig || "";

  if (currentCount !== targetCount || lastLang !== curLang || lastNet !== netKey || lastCacheVer !== curCacheVer || lastPinned !== pinnedStr || lastYsfFavSig !== ysfFavSig) {
    select.innerHTML = "";
    select.dataset.ysfFavSig = ysfFavSig;
    select.dataset.masterCount = String(targetCount);
    select.dataset.lang = curLang;
    select.dataset.networkType = netKey;
    select.dataset.cacheVer = curCacheVer;
    select.dataset.pinned = pinnedStr;

    if (netKey === "ysf") {
      // Выпадающий список = точный клон «Контактов YSF» (комнаты, добавленные из Каталога). Без служебных пунктов.
      const favList = (typeof window.getYsfBookmarks === "function") ? window.getYsfBookmarks() : [];
      const roomsToShow = [...favList];

      roomsToShow.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.host || m.id || "";
        let cCode = (m.country_code || m.country || "").toUpperCase();
        let refName = (m.reflector_name || m.name || "").trim();
        const rawName = (m.name || "").trim();

        if (!refName || !cCode || cCode === "GLOBAL") {
          const match = rawName.match(/^([A-Za-z]{2})[-_ ]\s*(.*)$/);
          if (match) {
            if (!cCode || cCode === "GLOBAL") cCode = match[1].toUpperCase();
            if (!refName) refName = match[2].trim();
          }
        }
        if (!cCode) cCode = "XX";
        if (m.id) opt.dataset.roomId = String(m.id);

        const isGlobalOrXx = !cCode || cCode === "GLOBAL" || cCode === "XX";
        const flag = m.flag || (!isGlobalOrXx ? isoToEmoji(cCode) : "🌐");
        const localizedCountry = !isGlobalOrXx
          ? getLocalizedCountryName(cCode, cCode, curLang)
          : (window.t ? window.t("countries.GLOBAL", {}, "International") : "International");
        const targetName = refName || localizedCountry;
        const idTag = m.id ? ` #${m.id}` : "";
        opt.textContent = `${flag} ${cCode} ${targetName}${idTag} (${m.host || ""})`;
        select.appendChild(opt);
      });

      // Синхронизация выбранного пункта с текущей комнатой HS.
      let ysfMatched = false;
      if (cleanCurrent) {
        for (let i = 0; i < select.options.length; i++) {
          const ov = select.options[i].value.toLowerCase();
          if (ov === cleanCurrent || ov.split(":")[0] === cleanCurrent) {
            select.selectedIndex = i;
            ysfMatched = true;
            break;
          }
        }
        // Текущая комната не в Контактах: показываем её ТОЛЬКО как отображаемое значение закрытого списка (в раскрытом списке её нет).
        if (!ysfMatched) {
          const curOpt = document.createElement("option");
          curOpt.value = currentHost;
          curOpt.textContent = `🌐 ${currentHost}`;
          curOpt.hidden = true;
          curOpt.disabled = true;
          curOpt.dataset.currentOnly = "1";
          select.insertBefore(curOpt, select.firstChild);
          select.selectedIndex = 0;
        }
      }
      return;
    }

    if (netKey !== "custom" && netKey !== "allstar") {
      const benchOpt = document.createElement("option");
      benchOpt.value = "__TEST_SERVERS__";
      benchOpt.textContent = window.t ? window.t("hotspots.bench_opt", {}, "⚡ SERVER BENCHMARK (ping all masters)") : "⚡ SERVER BENCHMARK (ping all masters)";
      select.appendChild(benchOpt);
    }

    const recTag = window.t ? window.t("bm.master_recommended", {}, "⭐ [Recommended]") : "⭐ [Recommended]";
    const deadTag = window.t ? window.t("server_probe.status_dead", {}, "OFFLINE") : "OFFLINE";
    const unitMs = window.t ? window.t("ping.unit_ms", {}, "ms") : "ms";

    masters.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.host || "";
      let cCode = (m.country_code || m.country || "").toUpperCase();
      let refName = (m.reflector_name || "").trim();
      const rawName = (m.name || "").trim();

      if (netKey === "ysf") {
        if (!refName || !cCode || cCode === "GLOBAL") {
          const match = rawName.match(/^([A-Za-z]{2})[-_ ]\s*(.*)$/);
          if (match) {
            if (!cCode || cCode === "GLOBAL") cCode = match[1].toUpperCase();
            if (!refName) refName = match[2].trim();
          }
        }
        if (!cCode) cCode = "XX";
        if (m.id) opt.dataset.roomId = String(m.id);
      }

      const isGlobalOrXx = !cCode || cCode === "GLOBAL" || cCode === "XX";
      const flag = m.flag || (!isGlobalOrXx ? isoToEmoji(cCode) : "🌐");
      const recSuffix = m.recommended ? ` ${recTag}` : "";

      let itemCore = "";
      if (netKey === "m17") {
        const eng = String(m.server_type || "mrefd").toUpperCase();
        const mods = Array.isArray(m.modules) && m.modules.length ? m.modules.join("") : "AC";
        const downTag = m.is_down ? "🔴 " : "";
        itemCore = `${downTag}${flag} ${m.designator || m.id || "M17"} [${eng}] (${mods}) — ${m.name || m.host || ""}`;
        opt.dataset.designator = m.designator || m.id || "";
        opt.dataset.port = String(m.port || 17000);
        opt.dataset.serverType = m.server_type || "mrefd";
      } else if (netKey === "dstar") {
        const proto = String(m.protocol || "dextra").toUpperCase();
        const desig = m.designator || m.id || "D-STAR";
        const countryName = !isGlobalOrXx
          ? resolveServerCountryName(m, m.country_name || m.country || "", curLang)
          : "";
        const descPart = (m.name && m.name !== desig && m.name !== `${desig} Reflector`)
          ? m.name
          : (countryName || `${desig} Reflector`);
        itemCore = `${flag} ${desig} [${proto}] — ${descPart} (${m.host || ""})`;
        opt.dataset.designator = desig;
        opt.dataset.port = String(m.port || 30001);
        opt.dataset.protocol = m.protocol || "dextra";
      } else if (netKey === "svx") {
        const countryName = resolveServerCountryName(m, m.country_name || m.country || profile.shortLabel, curLang);
        const srvName = m.name || m.id || countryName;
        itemCore = `${flag} ${countryName} — ${srvName} (${m.host || ""}:${m.port || 5300})`;
        opt.dataset.port = String(m.port || 5300);
      } else if (netKey === "ysf") {
        const localizedCountry = !isGlobalOrXx
          ? getLocalizedCountryName(cCode, cCode, curLang)
          : (window.t ? window.t("countries.GLOBAL", {}, "International") : "International");
        const targetName = refName || localizedCountry;
        const idTag = m.id ? ` #${m.id}` : "";
        itemCore = `${flag} ${cCode} ${targetName}${idTag} (${m.host || ""})`;
      } else {
        const countryName = resolveServerCountryName(m, m.country_name || m.country || profile.shortLabel, curLang);
        const resolvedMid = resolveServerDisplayName(m, countryName, curLang);
        const labelMid = netKey === "bm" ? `BM ${m.id || ""}` : (resolvedMid || m.id || profile.shortLabel);
        itemCore = `${flag} ${countryName} — ${labelMid} (${m.host || ""})`;
      }

      const st = (m.state || "").toLowerCase();
      const isDead = ["no_reply", "refused", "dns_fail"].includes(st) ||
                     (m.udp_ok === false && m.avg_ping == null && m.udp_ms == null) ||
                     (m.loss_pct !== undefined && m.loss_pct >= 100);
      const pingVal = (m.udp_ms !== undefined && m.udp_ms !== null) ? m.udp_ms : ((m.avg_ping !== undefined && m.avg_ping !== null) ? m.avg_ping : null);

      const srvKey = String(m.id || m.host || "").trim();
      const isPinned = Boolean(srvKey && pinnedList.includes(srvKey));
      const pinPrefix = isPinned ? "📌 " : "";

      if (isDead) {
        opt.textContent = `${pinPrefix}🔴 ${deadTag} · ${itemCore}`;
        opt.style.color = "#ef4444";
        opt.dataset.dead = "1";
      } else if (pingVal !== null && !isNaN(pingVal)) {
        opt.textContent = `${pinPrefix}⚡ ${Math.round(pingVal)} ${unitMs} · ${itemCore}${recSuffix}`;
        opt.dataset.ping = String(Math.round(pingVal));
      } else {
        opt.textContent = `${pinPrefix}${itemCore}${recSuffix}`;
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

    // Special handling for AllStarLink nodes
    const isTargetAsl = ((target.network_type || "").toLowerCase() === "allstar") &&
      (Boolean(target.is_asl_linked) || Boolean(target.connected_node && target.connected_node !== "0") || (typeof target.asl_online_count === "number" && target.asl_online_count > 0));
    return isTargetAsl || String(target.status || "").toUpperCase() === "ONLINE";
  }
  if (typeof arg === "object") {
    const cid = arg.id ? resolveHotspotId(arg.id) : null;
    const isLive = cid ? ((typeof isHotspotLiveCollapsed === "function" && isHotspotLiveCollapsed(cid)) || (typeof window !== "undefined" && window.isHotspotLiveCollapsed && window.isHotspotLiveCollapsed(cid))) : false;
    if (cid && isHotspotCollapsed(cid) && !isLive) return false;

    const target = cid ? currentHotspots.find(h => h.id === cid || h.id === arg.id) : null;
    const isArgAsl = (((arg.network_type || (target && target.network_type) || "").toLowerCase() === "allstar")) &&
      (Boolean(arg.is_asl_linked) || Boolean(arg.connected_node && arg.connected_node !== "0") || (typeof arg.asl_online_count === "number" && arg.asl_online_count > 0) ||
       (target && (Boolean(target.is_asl_linked) || Boolean(target.connected_node && target.connected_node !== "0") || (typeof target.asl_online_count === "number" && target.asl_online_count > 0))));
    return isArgAsl || String(arg.status || (target && target.status) || "").toUpperCase() === "ONLINE";
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
      ? (currentHotspots.find(h => h.id === hid) || currentHotspots.find(h => h.id === cid) || (hid === "default" ? currentHotspots[0] : null) || currentHotspots[0])
      : null;
  }

  // Always update the top header network identity badge
  updateCardNetworkBadge(card, hs);

  const banner = card.querySelector(".bm-info-banner");
  if (!banner) return;

  const netType = (hs && hs.network_type) ? hs.network_type : (card.dataset.networkType || "bm");
  const profile = getDmrNetworkProfile(netType);
  const pId = profile.id;
  ["bm", "tgif", "freedmr", "xlx", "dmrplus", "allstar", "custom", "adn", "ysf", "m17", "dstar", "svx"].forEach(n => {
    card.classList.toggle(`card-net-${n}`, pId === n);
  });
  card.dataset.networkType = pId;
  let hostVal = (hs && hs.bm_master_host) ? hs.bm_master_host : profile.defaultHost || "2502.master.brandmeister.network";
  if (pId === "allstar") {
    const actNode = (hs && (hs.connected_node || hs._active_asl_node || hs._last_asl_node)) || "";
    hostVal = (actNode && String(actNode).trim() !== "1999" && String(actNode).trim() !== "0")
      ? `asl_node_${actNode}`
      : "";
  }
  const info = getBmServerInfo(hostVal, netType);

  // Update Flag & Short Display Name (hide separate square flag badge, show clean emoji flag + name without BM prefix)
  const flagEl = banner.querySelector(".bm-server-flag");
  if (flagEl) {
    flagEl.innerHTML = "";
    flagEl.style.display = "none";
  }

  const nameEl = banner.querySelector(".bm-server-name");
  if (nameEl) {
    const prefix = profile.shortLabel || "BM";
    let rawName = (info.displayName || info.countryName || prefix).trim();

    // Strip ALL leading flag emojis & Regional Indicators & pictographics & whitespace
    const leadingEmojiRegex = /^(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D]|\s)+/u;
    rawName = rawName.replace(leadingEmojiRegex, "").trim();

    // Strip redundant leading network prefix (e.g. "BM ", "FreeDMR ")
    const pfxRegex = new RegExp(`^${prefix}\\s+`, "i");
    if (rawName.toLowerCase() !== prefix.toLowerCase()) {
      rawName = rawName.replace(pfxRegex, "").trim();
    }

    // Strip any leading emoji again if one was placed after the prefix
    rawName = rawName.replace(leadingEmojiRegex, "").trim();

    // Simplify redundant "(BM 2322)" to "(2322)"
    const pfxParenRegex = new RegExp(`\\(${prefix}\\s+(\\d+)\\)`, "i");
    rawName = rawName.replace(pfxParenRegex, "($1)");

    // Resolve strictly ONE canonical flag emoji
    let flagEmoji = "";
    if (info.countryCode && info.countryCode !== "GLOBAL" && info.countryCode !== "LOCAL") {
      flagEmoji = isoToEmoji(info.countryCode);
    } else if (info.countryCode === "LOCAL") {
      flagEmoji = "🏠";
    }

    // Construct final text: exactly ONE flag emoji + clean name
    const cleanName = rawName || profile.shortLabel;
    const displayText = flagEmoji ? `${flagEmoji} ${cleanName}` : cleanName;

    if (nameEl.textContent !== displayText) {
      nameEl.textContent = displayText;
    }
    nameEl.title = `${profile.fullName}: ${info.countryName || info.displayName} — ${hostVal}`;
  }

  const modeBadge = banner.querySelector(".bm-ping-mode-badge");
  if (modeBadge && !modeBadge.classList.contains("mode-client")) {
    const isAsl = Boolean(profile.id === "allstar");
    modeBadge.textContent = isAsl ? "HUB/Node" : profile.shortLabel;
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
      const targetHs = allHotspots.find(h => String(h.id) === String(rawId)) ||
                       allHotspots.find(h => String(h.id) === String(cid)) ||
                       (rawId === "default" ? allHotspots[0] : null);
      const currHost = (targetHs && targetHs.bm_master_host) || select.value || hostVal;
      const currNet = (targetHs && targetHs.network_type) || select.dataset.networkType || card.dataset.networkType || "bm";
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
      const targetHs = allHotspots.find(h => String(h.id) === String(rawId)) ||
                       allHotspots.find(h => String(h.id) === String(cid)) ||
                       (rawId === "default" ? allHotspots[0] : null);
      const currNet = (targetHs && targetHs.network_type) || select.dataset.networkType || card.dataset.networkType || "bm";

      if (newHost === "__TEST_SERVERS__") {
        const currHost = (targetHs && targetHs.bm_master_host) || "";
        populateBmServerSelect(select, currHost, currNet);
        const targetId = (targetHs && targetHs.id) ? targetHs.id : cid;
        if (typeof openBmBenchmarkModal === "function") {
          openBmBenchmarkModal(targetId, currNet);
        }
        return;
      }

      if (newHost === "__OPEN_YSF_CATALOG__") {
        const currHost = (targetHs && targetHs.bm_master_host) || "";
        populateBmServerSelect(select, currHost, currNet);
        const targetId = (targetHs && targetHs.id) ? targetHs.id : cid;
        if (typeof window.openMyContactsModal === "function") {
          window.openMyContactsModal(targetId, "ysf_dir");
        }
        return;
      }

      if (!targetHs) {
        console.warn("[BM-BANNER] targetHs not found for card:", rawId, cid);
        return;
      }

      if (currNet === "m17") {
        const m17List = getNetworkServersList("m17") || [];
        const foundRef = (m17List || []).find(r => r && ((r.host && r.host.toLowerCase() === newHost.toLowerCase()) || String(r.designator || r.id) === newHost));
        if (foundRef) {
          targetHs.m17_reflector = String(foundRef.designator || foundRef.id || "").trim();
          targetHs.m17_reflector_name = String(foundRef.name || targetHs.m17_reflector).trim();
          targetHs.m17_host = String(foundRef.host || newHost).trim();
          targetHs.m17_port = Number(foundRef.port || 17000);
          targetHs.m17_server_type = String(foundRef.server_type || "mrefd").trim();
        }
      }
      if (currNet === "ysf") {
        const ysfFavs = (typeof window.getYsfBookmarks === "function") ? window.getYsfBookmarks() : [];
        const ysfList = [...ysfFavs, ...(getNetworkServersList("ysf") || [])];
        const foundRoom = (ysfList || []).find(r => r && ((r.host && r.host.toLowerCase() === newHost.toLowerCase()) || String(r.id) === newHost));
        if (foundRoom) {
          targetHs.ysf_room = String(foundRoom.id || "").trim();
          targetHs.ysf_name = String(foundRoom.reflector_name || foundRoom.name || "").trim();
        }
      }
      if (currNet === "dstar") {
        const dstarList = getNetworkServersList("dstar") || [];
        const foundRef = (dstarList || []).find(r => r && ((r.host && r.host.toLowerCase() === newHost.toLowerCase()) || String(r.designator || r.id) === newHost));
        if (foundRef) {
          targetHs.dstar_reflector = String(foundRef.designator || foundRef.id || "").trim();
          targetHs.dstar_reflector_name = String(foundRef.name || targetHs.dstar_reflector).trim();
          targetHs.dstar_host = String(foundRef.host || newHost).trim();
          targetHs.dstar_port = Number(foundRef.port || 30001);
          targetHs.dstar_protocol = String(foundRef.protocol || "dextra").trim();
        }
      }
      if (currNet === "svx") {
        const svxList = getNetworkServersList("svx") || [];
        const foundSvx = (svxList || []).find(r => r && ((r.host && r.host.toLowerCase() === newHost.toLowerCase()) || String(r.id) === newHost));
        if (foundSvx) {
          targetHs.svx_host = String(foundSvx.host || newHost).trim();
          targetHs.svx_port = Number(foundSvx.port || 5300);
          targetHs.bm_master_port = targetHs.svx_port;
          targetHs.svx_server_name = String(foundSvx.name || targetHs.svx_host).trim();
        }
      }

      if (targetHs.bm_master_host === newHost) return;
      const prevHost = targetHs.bm_master_host;
      const targetId = targetHs.id || cid;

      targetHs.bm_master_host = newHost;
      if (typeof window !== "undefined" && typeof window.updateCardXlxPanel === "function") {
        window.updateCardXlxPanel(card, targetHs);
      }
      if (typeof window !== "undefined" && typeof window.updateBmStatus === "function") {
        const msg = window.t ? window.t("status.bm_connecting_host", { host: newHost }, `Connecting to ${newHost}...`) : `Подключение к ${newHost}...`;
        window.updateBmStatus("connecting", msg, targetId);
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
          const editHsPort = document.getElementById("editHsPort");
          const editHsId = document.getElementById("editHsId");
          const editHsMasterSelect = document.getElementById("editHsMasterSelect");
          if (editHsHost && editHsId && (editHsId.value === targetId || curActiveId === targetId)) {
            editHsHost.value = newHost;
            if (editHsPort && targetHs.bm_master_port) editHsPort.value = targetHs.bm_master_port;
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
  let pingMs = null;
  const cachedBmPings = (typeof window !== "undefined" && window.cachedBmPings) || {};
  const cachedBmHostPings = (typeof window !== "undefined" && window.cachedBmHostPings) || {};
  if (isOnline || !isCollapsed) {
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
      const isAslNoNode = (profile.id === "allstar" && !hostVal);
      const isOfflineCard = isCollapsed || !isOnline || isAslNoNode;
      const lossData = isOfflineCard ? { lossPercent: 0, isOffline: false } : calculateCardPacketLoss(cid, hostVal);
      updatePingElement(pingEl, isOfflineCard ? null : pingMs, lossData, "server", profile.shortLabel);
      if (profile.id === "allstar") {
        const targetNode = (hs && (hs.connected_node || hs._last_asl_node || hs._active_asl_node)) || "";
        const isConnected = Boolean(targetNode && String(targetNode).trim() !== "1999" && String(targetNode).trim() !== "0");
        const nodeStr = isConnected ? `#${targetNode}` : (window.t ? window.t("asl.node_disconnected", {}, "* disconnect *") : "* disconnect *");
        const unitMs = window.t ? window.t("ping.unit_ms", {}, "ms") : "ms";
        const msStr = pingMs !== null ? `${pingMs} ${unitMs}` : "--";
        pingEl.title = window.t
          ? window.t("asl.ping_mode_card_title", { node: nodeStr, ms: msStr }, `ASL ↔ ${nodeStr} (${msStr})`)
          : `ASL ↔ ${nodeStr} (${msStr})`;
      }
    }
  }

  const isOfflineCardForE2e = isCollapsed || !isOnline;
  card._lastServerPingMs = (!isOfflineCardForE2e && pingMs !== null && pingMs !== undefined && !isNaN(Number(pingMs)) && Number(pingMs) >= 0)
    ? Math.round(Number(pingMs))
    : null;
  updateCardE2eDisplay(card);

  // Render SVG Ping Sparkline
  renderCardPingSparkline(card, hostVal);

  if (typeof window !== "undefined" && typeof window.updateCardXlxPanel === "function") {
    window.updateCardXlxPanel(card, hs);
  }
}

export function applyE2eColorClass(rttEl, valMs) {
  if (!rttEl) return;
  rttEl.classList.remove("e2e-good", "e2e-warn", "e2e-bad");
  if (valMs === null || valMs === undefined || isNaN(Number(valMs)) || Number(valMs) < 0) {
    return;
  }
  const ms = Number(valMs);
  if (ms <= 150) {
    rttEl.classList.add("e2e-good");
  } else if (ms <= 350) {
    rttEl.classList.add("e2e-warn");
  } else {
    rttEl.classList.add("e2e-bad");
  }
}

export function updateCardE2eDisplay(card) {
  if (!card) return;
  const rttEl = card.querySelector(".rtt-display");
  if (!rttEl) return;

  const rawClient = (typeof window !== "undefined" && window.cachedClientRtt !== undefined && window.cachedClientRtt !== null)
    ? Number(window.cachedClientRtt)
    : NaN;
  const clientMs = (!isNaN(rawClient) && rawClient >= 0) ? Math.round(rawClient) : null;

  const rawSrv = (card._lastServerPingMs !== undefined && card._lastServerPingMs !== null)
    ? Number(card._lastServerPingMs)
    : NaN;
  const srvMs = (!isNaN(rawSrv) && rawSrv >= 0) ? Math.round(rawSrv) : null;

  const tr = (typeof window !== "undefined" && typeof window.t === "function") ? window.t : null;
  let displayedMs = null;

  if (clientMs !== null && srvMs !== null) {
    displayedMs = clientMs + srvMs;
    rttEl.textContent = `E2E: ${displayedMs}ms`;
    rttEl.title = tr
      ? tr("vfo.e2e_client_net_title", { total: displayedMs, client: clientMs, srv: srvMs })
      : `End-to-End Latency (E2E): ${displayedMs} ms (Client: ${clientMs} ms + Network: ${srvMs} ms)`;
  } else if (clientMs !== null) {
    displayedMs = clientMs;
    rttEl.textContent = `E2E: ${clientMs}ms`;
    rttEl.title = tr
      ? tr("vfo.e2e_client_only_title", { total: clientMs, client: clientMs })
      : `End-to-End Latency (E2E): ${clientMs} ms (Client: ${clientMs} ms, network ping N/A)`;
  } else if (srvMs !== null) {
    displayedMs = srvMs;
    rttEl.textContent = `E2E: ${srvMs}ms`;
    rttEl.title = tr
      ? tr("vfo.e2e_net_only_title", { total: srvMs, srv: srvMs })
      : `End-to-End Latency (E2E): ${srvMs} ms (Network: ${srvMs} ms)`;
  } else {
    rttEl.textContent = "E2E: --ms";
    rttEl.title = tr
      ? tr("vfo.e2e_no_data_title", {}, "End-to-End Latency (E2E): N/A")
      : "End-to-End Latency (E2E): N/A";
  }

  applyE2eColorClass(rttEl, displayedMs);
}

export function refreshAllCardsBmBanner() {
  const currentHotspots = getCurrentHotspots();
  const cards = document.querySelectorAll(".radio-container");
  cards.forEach(card => {
    const hid = card.dataset.hotspotId || "default";
    const cid = resolveHotspotId(hid);
    const hs = (currentHotspots && currentHotspots.length)
      ? (currentHotspots.find(h => h.id === hid) || currentHotspots.find(h => h.id === cid) || currentHotspots[0])
      : null;
    if (hs) {
      updateCardBmBanner(card, hs);
    }
  });
}

export function updateRxBannerFreshness() {}
export function updateCardRxLiveBanner(card, data) {}
export function updateRxLiveBanner(data) {}


/* ==========================================================================
   Pinned Servers Management Subsystem
   ========================================================================== */

export function getPinnedServers(netKey) {
  const cached = _pinnedServersCache[netKey];
  if (Array.isArray(cached)) return cached.slice();
  if (_pinnedServersCacheLoaded) return [];
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
  _savePinnedServerToServer(netKey, pinned);
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
        const lang = getBannerCurrentLang();
        const cA = String(resolveServerCountryName(a, a.country_name || a.country || "", lang)).toLowerCase();
        const cB = String(resolveServerCountryName(b, b.country_name || b.country || "", lang)).toLowerCase();
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
    const locCountry = resolveServerCountryName(s, s.country_name || s.country, curLang);
    const locName = resolveServerDisplayName(s, locCountry, curLang);
    const haystack = [
      s.id,
      s.name,
      locName,
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
  const curLang = getBannerCurrentLang();
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
    const countryName = resolveServerCountryName(m, m.country_name || m.country || profile.shortLabel, curLang);
    const flag = m.flag || (cCode !== "GLOBAL" ? isoToEmoji(cCode) : "🌐");
    const resolvedMid = resolveServerDisplayName(m, countryName, curLang);
    const labelMid = netKey === "bm" ? `BM ${m.id || ""}` : (resolvedMid || m.id || profile.shortLabel);

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

    const deadLabel = window.t ? window.t("server_probe.status_dead", {}, "NO REPLY") : "NO REPLY";
    const unitMs = window.t ? window.t("ping.unit_ms", {}, "ms") : "ms";
    let pingHtml = "";
    if (isDead) {
      pingHtml = `<span class="srv-item-ping">🔴 ${escapeComboHtml(deadLabel)}</span>`;
    } else if (pingVal !== null && !isNaN(pingVal)) {
      pingHtml = `<span class="srv-item-ping">⚡ ${Math.round(pingVal)} ${escapeComboHtml(unitMs)}</span>`;
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

    const curLang = getBannerCurrentLang();
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
    let savedMode = _srvSortPrefsCache[`srvSortMode_${netKey}`] || null;
    let savedDir = _srvSortPrefsCache[`srvSortDir_${netKey}`] || null;
    if (!savedMode || !savedDir) {
      try {
        if (!savedMode) savedMode = localStorage.getItem(`srvSortMode_${netKey}`);
        if (!savedDir) savedDir = localStorage.getItem(`srvSortDir_${netKey}`) || "asc";
      } catch (_) {}
    }
    savedDir = savedDir || "asc";

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
        _saveSrvSortPrefsToServer(curNet, banner._srvCombo.mode, banner._srvCombo.dir);
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

export { _loadPinnedServersFromServer, _applyBannerCollections };

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.__proxdmrApplyBannerCollections = _applyBannerCollections;
  _loadPinnedServersFromServer();
  window._loadPinnedServersFromServer = _loadPinnedServersFromServer;
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
  window.updateCardE2eDisplay = updateCardE2eDisplay;
  window.applyE2eColorClass = applyE2eColorClass;
  window.refreshAllCardsBmBanner = refreshAllCardsBmBanner;
  window.updateRxBannerFreshness = updateRxBannerFreshness;
  window.updateCardRxLiveBanner = updateCardRxLiveBanner;
  window.updateRxLiveBanner = updateRxLiveBanner;
  window.refreshXlxServers = refreshXlxServers;
  window.refreshDmrPlusServers = refreshDmrPlusServers;
  window.refreshAdnServers = refreshAdnServers;
  window.refreshM17Servers = refreshM17Servers;
  window.refreshDstarServers = refreshDstarServers;
  window.refreshSvxServers = refreshSvxServers;
  window.KNOWN_M17_SERVERS = KNOWN_M17_SERVERS;
  window.KNOWN_DSTAR_SERVERS = KNOWN_DSTAR_SERVERS;
  window.KNOWN_SVX_SERVERS = KNOWN_SVX_SERVERS;
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
    updateCardE2eDisplay,
    applyE2eColorClass,
    refreshAllCardsBmBanner,
    updateRxBannerFreshness,
    updateCardRxLiveBanner,
    updateRxLiveBanner,
    refreshXlxServers,
    refreshDmrPlusServers,
    refreshAdnServers,
    refreshM17Servers,
    refreshDstarServers,
    refreshSvxServers,
    KNOWN_M17_SERVERS,
    KNOWN_DSTAR_SERVERS,
    KNOWN_SVX_SERVERS,
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

      const banner = sel.closest(".bm-info-banner");
      if (banner && banner._srvCombo) {
        const c = banner._srvCombo;
        if (c.input && window.t) c.input.placeholder = window.t("servers.search_placeholder", {}, "Search server...");
        if (c.clearBtn && window.t) c.clearBtn.title = window.t("servers.clear_search", {}, "Clear search");
        if (c.testRow && window.t) {
          const tTitle = window.t("hotspots.bench_opt", {}, "⚡ SERVER BENCHMARK");
          c.testRow.title = tTitle;
          const tLbl = c.testRow.querySelector(".srv-combo-test-lbl");
          if (tLbl) tLbl.textContent = tTitle;
        }
        if (c.panel && window.t) {
          c.panel.querySelectorAll(".srv-sort-btn").forEach(btn => {
            const mode = btn.dataset.mode;
            if (!mode) return;
            btn.title = window.t(`servers.sort_${mode}_title`, {}, btn.title);
            const lbl = btn.querySelector(".srv-sort-lbl");
            if (lbl) lbl.textContent = window.t(`servers.sort_${mode}`, {}, lbl.textContent);
          });
        }
        if (c.isOpen) {
          renderComboboxList(sel);
        }
      }
    });
    refreshAllCardsBmBanner();
  });
}
