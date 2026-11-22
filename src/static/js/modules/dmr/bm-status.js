/**
 * ProxDMR - BrandMeister Status & Hotspot Connection Controller
 * Handles BM connection status badge updates, offline/online tooltip texts,
 * and user-triggered manual connect / disconnect actions per hotspot.
 */

import { isHotspotCollapsed, isHotspotLiveCollapsed } from "../audio/volume-mute.js?v=2.9.809";
import { isHotspotFullyOnline, updateCardBmBanner, getDmrNetworkProfile, updateCardNetworkBadge } from "./bm-banner.js?v=2.9.809";
import { renderHotspotsList, renderHotspotSelect } from "./hotspots.js?v=2.9.809";

export let currentBmStatus = "OFFLINE";
export let isTogglingConnection = false;

function getCurrentHotspots() {
  return (typeof window !== "undefined" && Array.isArray(window.currentHotspots))
    ? window.currentHotspots
    : [];
}

function getActiveHotspotId() {
  return (typeof window !== "undefined" && window.activeHotspotId) || "default";
}

/**
 * Update DMR network status badge and detail text on hotspot card and state
 * @param {string} status "ONLINE" | "CONNECTING" | "OFFLINE" | "ERROR" | "AUTH_FAILED" | "DISCONNECTED"
 * @param {string} [detail=""]
 * @param {string|null} [hotspotId=null]
 */
export function updateBmStatus(status, detail = "", hotspotId = null) {
  status = status ? String(status).toUpperCase() : "OFFLINE";
  const activeHid = getActiveHotspotId();
  const rawTargetHid = hotspotId || activeHid;
  const targetHid = (typeof window !== "undefined" && typeof window.resolveHotspotId === "function")
    ? window.resolveHotspotId(rawTargetHid)
    : rawTargetHid;
  if (targetHid === activeHid || rawTargetHid === activeHid) {
    currentBmStatus = status || "OFFLINE";
  }

  const currentHotspots = getCurrentHotspots();
  const hs = currentHotspots.find(h => h.id === rawTargetHid) ||
             currentHotspots.find(h => h.id === targetHid) ||
             (rawTargetHid === "default" ? currentHotspots[0] : null);
  if (hs && status) {
    hs.status = status;
    if (detail !== undefined && detail !== "") hs.detail = detail;
  }
  const netProfile = getDmrNetworkProfile(hs ? hs.network_type : "bm");
  const netPrefix = netProfile.badgePrefix || "BM";
  const netShort = netProfile.shortName || "BM";
  const masterHost = hs ? (hs.bm_master_host || netProfile.defaultHost || "2322.master.brandmeister.network") : netPrefix;

  let badgeText = `${netPrefix}:OFFLINE`;
  let badgeClass = "status-offline bm-offline";
  let comment = "";
  let tooltip = netShort;

  const isCol = Boolean(targetHid && isHotspotCollapsed(targetHid));
  const isLive = Boolean(targetHid && ((typeof isHotspotLiveCollapsed === "function" && isHotspotLiveCollapsed(targetHid)) || (typeof window !== "undefined" && window.isHotspotLiveCollapsed && window.isHotspotLiveCollapsed(targetHid))));
  const isCollapsed = isCol && !isLive;

  if (isCollapsed) {
    status = "DISCONNECTED";
    if (hs) hs.status = "DISCONNECTED";
    badgeClass = "status-offline bm-offline";
    badgeText = `${netPrefix}:OFFLINE`;
    comment = window.t ? window.t("status.bm_collapsed_detail", {}, "Collapsed / disconnected") : "Collapsed / disconnected";
    tooltip = window.t ? window.t("status.bm_collapsed_tooltip", {}, "⚪ Hotspot is collapsed and disconnected.") : "⚪ Hotspot is collapsed and disconnected.";
  } else if (status === "ONLINE") {
    badgeClass = "status-online bm-online";
    badgeText = `${netPrefix}:ONLINE`;
    const isConnWord = !detail || detail.includes("BrandMeister") || detail.includes("BM") || detail.includes(netShort) || detail.includes(netPrefix) || detail.includes("Подключен") || /^(connected|verbunden|conectado|connect[ée]|connesso|verbonden|підключено)/i.test(detail);
    comment = !isConnWord
      ? `${masterHost} (${detail})`
      : `${masterHost}`;
    tooltip = window.t ? window.t("status.bm_connected_tooltip", { host: masterHost }, `🟢 Connected to ${netShort} (${masterHost}). Click to disconnect`) : `🟢 Connected to ${netShort} (${masterHost}). Click to disconnect`;
  } else if (status === "CONNECTING" || status === "AUTHENTICATING" || status === "CONFIGURING") {
    badgeClass = "status-connecting bm-connecting";
    badgeText = `${netPrefix}:CONNECTING`;
    comment = detail || (window.t ? window.t("status.bm_connecting_host", { host: masterHost }, `Connecting to ${masterHost}...`) : `Connecting to ${masterHost}...`);
    tooltip = window.t ? window.t("status.bm_connecting_tooltip", { comment }, `🟡 ${comment}. Click to cancel`) : `🟡 ${comment}. Click to cancel`;
  } else if (status === "AUTH_FAILED") {
    badgeClass = "status-error bm-error";
    badgeText = `${netPrefix}:AUTH FAIL`;
    comment = detail || ((typeof window !== "undefined" && window.t) ? window.t("status.bm_password_detail", {}, "Incorrect hotspot SelfCare password") : "Incorrect hotspot SelfCare password");
    tooltip = window.t ? window.t("status.bm_error_tooltip", { comment }, `🔴 ${comment}. Click to retry`) : `🔴 ${comment}. Click to retry`;
  } else if (status === "ERROR") {
    badgeClass = "status-error bm-error";
    badgeText = `${netPrefix}:ERROR`;
    comment = detail || (window.t ? window.t("status.bm_connect_err", { host: masterHost }, `Connection error with ${masterHost}`) : `Connection error with ${masterHost}`);
    tooltip = window.t ? window.t("status.bm_error_tooltip", { comment }, `🔴 ${comment}. Click to retry`) : `🔴 ${comment}. Click to retry`;
  } else {
    badgeClass = "status-offline bm-offline";
    badgeText = `${netPrefix}:OFFLINE`;
    const isDiscWord = detail && /^(отключен|відключено|disconnected|getrennt|desconectado|déconnecté|disconnesso|verbroken)$/i.test(detail.trim());
    comment = (detail && !isDiscWord) ? detail : (window.t ? window.t("status.bm_disconnected_host", { host: masterHost }, `${masterHost} (disconnected)`) : `${masterHost} (disconnected)`);
    tooltip = window.t ? window.t("status.bm_disconnected_tooltip", { host: masterHost }, `⚪ Hotspot disconnected. Click to connect to ${masterHost}`) : `⚪ Hotspot disconnected. Click to connect to ${masterHost}`;
  }

  // Update specific hotspot card in grid if present
  let card = targetHid ? document.querySelector(`.radio-container[data-hotspot-id="${targetHid}"]`) : null;
  if (!card && (!targetHid || (targetHid === activeHid && !currentHotspots.some(h => h && String(h.id) === String(targetHid))))) {
    card = document.querySelector(".radio-container");
  }
  if (card) {
    const badge = card.querySelector(".bm-status-badge");
    const dt = card.querySelector(".bm-detail-text");
    const toggleBtn = card.querySelector(".bm-status-toggle");
    const volStrip = card.querySelector(".vertical-volume-strip");
    const nameBadge = card.querySelector(".hotspot-name-badge");
    const isOnline = (!isCol || isLive) && isHotspotFullyOnline(hs || status);
    if (volStrip) {
      volStrip.classList.toggle("bm-disconnected", !isOnline);
    }
    card.classList.toggle("card-bm-disconnected", !isOnline);
    card.classList.toggle("collapsed", isCol);
    card.classList.toggle("live-collapsed", isCol && isLive);

    if (nameBadge) {
      nameBadge.classList.toggle("is-online", isOnline);
    }
    updateCardNetworkBadge(card, hs);

    if (badge) {
      badge.className = `status-badge bm-badge bm-status-badge ${badgeClass}`;
      badge.textContent = badgeText;
    }
    if (dt) {
      dt.textContent = comment;
      dt.title = tooltip;
    }
    if (toggleBtn) {
      toggleBtn.title = tooltip;
    }
    // Ensure banner ping and sparkline are refreshed on status change
    updateCardBmBanner(card, hs);

    // Sync AllStar status badge if present
    const aslBadge = card.querySelector(`#allstarStatusBadge_${targetHid}`) || card.querySelector(".allstar-status-badge");
    if (aslBadge && !aslBadge.classList.contains("status-rx") && !aslBadge.classList.contains("status-tx")) {
      if (isOnline) {
        aslBadge.className = "allstar-status-badge status-online";
        aslBadge.textContent = window.t ? window.t("asl.status_connected", {}, "CONNECTED") : "CONNECTED";
      } else if (status === "CONNECTING" || status === "AUTHENTICATING" || status === "CONFIGURING") {
        aslBadge.className = "allstar-status-badge status-connecting";
        aslBadge.textContent = window.t ? window.t("asl.status_connecting", {}, "CONNECTING...") : "CONNECTING...";
      } else {
        aslBadge.className = "allstar-status-badge status-idle";
        aslBadge.textContent = window.t ? window.t("asl.status_idle", {}, "IDLE") : "IDLE";
      }
    }
  }

  // Also keep edit tab toolbar connect/online button in sync if open
  if (typeof window !== "undefined" && typeof window.updateEditHsToolbarUI === "function") {
    const curHsEl = document.getElementById("editHsId");
    if (curHsEl && curHsEl.value === targetHid) {
      const curHs = (window.currentHotspots || []).find(h => h.id === targetHid);
      if (curHs) {
        curHs.status = status;
        curHs.detail = detail;
        window.updateEditHsToolbarUI(curHs);
      }
    }
  }

  if (typeof window !== "undefined" && typeof window.checkAndRenderFailoverBadges === "function") {
    try { window.checkAndRenderFailoverBadges(); } catch (e) {}
  }
  if (typeof window !== "undefined" && typeof window.renderToolbarHotspotSlots === "function") {
    window.renderToolbarHotspotSlots();
  }
}

/**
 * Toggle BrandMeister connection (Connect / Disconnect) for a hotspot
 * @param {string} hid
 */
export async function toggleHotspotConnection(hid) {
  if (!hid) return;
  const currentHotspots = getCurrentHotspots();
  const activeHid = getActiveHotspotId();
  const hs = currentHotspots.find(h => h.id === hid);
  if (!hs) return;

  const card = document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`);
  const toggleBtn = card ? card.querySelector(".bm-status-toggle") : null;
  if (toggleBtn) {
    toggleBtn.style.opacity = "0.7";
  }

  const isOnline = hs.status === "ONLINE" ||
    hs.status === "CONNECTING" ||
    hs.status === "AUTHENTICATING" ||
    hs.status === "CONFIGURING";

  const action = isOnline ? "disconnect" : "connect";
  if (action === "connect" && String(hs.network_type || "").toLowerCase() === "m17") {
    const hasM17Target = Boolean(String(hs.m17_reflector || hs.m17_host || hs.bm_master_host || "").trim());
    if (!hasM17Target) {
      if (toggleBtn) toggleBtn.style.opacity = "1";
      if (typeof window !== "undefined" && typeof window.showToast === "function") {
        window.showToast(window.t ? window.t("status.m17_select_reflector_toast", {}, "Выберите рефлектор M17 для подключения") : "Выберите рефлектор M17 для подключения", "info", 2800);
      }
      return;
    }
  }
  if (action === "connect" && String(hs.network_type || "").toLowerCase() === "ysf") {
    const hasYsfTarget = Boolean(String(hs.ysf_room || hs.ysf_room_id || hs.ysf_host || hs.bm_master_host || "").trim());
    if (!hasYsfTarget) {
      if (toggleBtn) toggleBtn.style.opacity = "1";
      if (typeof window !== "undefined" && typeof window.showToast === "function") {
        window.showToast(window.t ? window.t("status.ysf_select_room_toast", {}, "Выберите комнату YSF в матрице или каталоге для подключения") : "Выберите комнату YSF в матрице или каталоге для подключения", "info", 2800);
      }
      return;
    }
  }
  if (action === "disconnect") {
    hs.isManualBmDisconnect = true;
    if (hid === activeHid && typeof window !== "undefined") window.isManualBmDisconnect = true;
    console.log(`[BM] Hotspot [${hs.name || hid}] manually disconnected by user. Watchdog auto-connect stopped.`);
  } else {
    hs.isManualBmDisconnect = false;
    if (hid === activeHid && typeof window !== "undefined") window.isManualBmDisconnect = false;
    console.log(`[BM] Hotspot [${hs.name || hid}] manually connected by user. Watchdog auto-connect resumed.`);
  }
  updateBmStatus(isOnline ? "DISCONNECTED" : "CONNECTING", isOnline ? (window.t ? window.t("status.bm_disconnecting", {}, "Отключение...") : "Отключение...") : (window.t ? window.t("status.bm_connecting_status", {}, "Подключение...") : "Подключение..."), hid);

  try {
    const res = await fetch(`/api/hotspots/${hid}/${action}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (data && data.bm_status) {
      hs.status = data.bm_status;
      hs.detail = data.detail || "";
      updateBmStatus(data.bm_status, data.detail || "", hid);
      renderHotspotsList();
      renderHotspotSelect();
    }
  } catch (e) {
    console.error(`[HOTSPOT] Error toggling connection for ${hid}:`, e);
  } finally {
    if (toggleBtn) {
      toggleBtn.style.opacity = "1";
    }
  }
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.updateBmStatus = updateBmStatus;
  window.toggleHotspotConnection = toggleHotspotConnection;

  window.__proxdmr = window.__proxdmr || {};
  Object.assign(window.__proxdmr, {
    updateBmStatus,
    toggleHotspotConnection
  });
}
