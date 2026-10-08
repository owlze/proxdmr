/**
 * ProxDMR - Network Watchdog Subsystem (modules/network/watchdog.js)
 * Manages ProxDMR Gateway status, 7-second sequential link watchdog (GW -> BM),
 * BrandMeister REST API status checks, and card status interaction wiring.
 */

// State flags
export let isManualGwDisconnect = false;
export let isManualBmDisconnect = false;
export let wasGwConnected = false;
export let gwIsFastReconnecting = false;
export let gwConnectAttempt = 1;
export let isGwToggling = false;
export let wsReconnectTimer = null;

export function setIsManualGwDisconnect(val) {
  isManualGwDisconnect = Boolean(val);
  try { window.isManualGwDisconnect = isManualGwDisconnect; } catch (_) {}
}
export function setIsManualBmDisconnect(val) {
  isManualBmDisconnect = Boolean(val);
  try { window.isManualBmDisconnect = isManualBmDisconnect; } catch (_) {}
}
export function setWasGwConnected(val) {
  wasGwConnected = Boolean(val);
  try { window.wasGwConnected = wasGwConnected; } catch (_) {}
}
export function setGwIsFastReconnecting(val) {
  gwIsFastReconnecting = Boolean(val);
  try { window.gwIsFastReconnecting = gwIsFastReconnecting; } catch (_) {}
}
export function setGwConnectAttempt(val) {
  gwConnectAttempt = val;
  try { window.gwConnectAttempt = gwConnectAttempt; } catch (_) {}
}
export function setIsGwToggling(val) {
  isGwToggling = Boolean(val);
  try { window.isGwToggling = isGwToggling; } catch (_) {}
}
export function setWsReconnectTimer(val) {
  wsReconnectTimer = val;
  try { window.wsReconnectTimer = wsReconnectTimer; } catch (_) {}
}
export function clearWsReconnectTimer() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
    try { window.wsReconnectTimer = null; } catch (_) {}
  }
}

try {
  Object.defineProperty(window, "isManualGwDisconnect", {
    get: () => isManualGwDisconnect,
    set: (v) => { isManualGwDisconnect = Boolean(v); },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(window, "isManualBmDisconnect", {
    get: () => isManualBmDisconnect,
    set: (v) => { isManualBmDisconnect = Boolean(v); },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(window, "wasGwConnected", {
    get: () => wasGwConnected,
    set: (v) => { wasGwConnected = Boolean(v); },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(window, "gwIsFastReconnecting", {
    get: () => gwIsFastReconnecting,
    set: (v) => { gwIsFastReconnecting = Boolean(v); },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(window, "gwConnectAttempt", {
    get: () => gwConnectAttempt,
    set: (v) => { gwConnectAttempt = v; },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(window, "isGwToggling", {
    get: () => isGwToggling,
    set: (v) => { isGwToggling = Boolean(v); },
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(window, "wsReconnectTimer", {
    get: () => wsReconnectTimer,
    set: (v) => { wsReconnectTimer = v; },
    configurable: true,
    enumerable: true
  });
} catch (_) {}

// --- Per-Hotspot GW Disconnect State (Decoupled GW) ---
export function isHotspotGwDisconnected(hid) {
  const cid = (typeof window !== "undefined" && typeof window.resolveHotspotId === "function")
    ? window.resolveHotspotId(hid)
    : (hid || "default");
  try {
    return localStorage.getItem(`proxdmr_gw_disconnected_${cid}`) === "true";
  } catch (_) {
    return false;
  }
}

export function setHotspotGwDisconnected(hid, disconnected) {
  const cid = (typeof window !== "undefined" && typeof window.resolveHotspotId === "function")
    ? window.resolveHotspotId(hid)
    : (hid || "default");
  try {
    if (disconnected) {
      localStorage.setItem(`proxdmr_gw_disconnected_${cid}`, "true");
    } else {
      localStorage.removeItem(`proxdmr_gw_disconnected_${cid}`);
    }
  } catch (_) {}
}

export function resetManualDisconnectFlags() {
  isManualGwDisconnect = false;
  isManualBmDisconnect = false;
  const currentHotspots = window.currentHotspots;
  if (currentHotspots && Array.isArray(currentHotspots)) {
    currentHotspots.forEach(h => {
      h.isManualBmDisconnect = false;
      try { localStorage.removeItem(`proxdmr_gw_disconnected_${h.id}`); } catch (_) {}
    });
  }
  try { localStorage.removeItem("proxdmr_gw_disconnected_default"); } catch (_) {}
  console.log("[WATCHDOG] Manual disconnect flags reset (clean state).");
}

window.addEventListener("beforeunload", resetManualDisconnectFlags);
window.addEventListener("unload", resetManualDisconnectFlags);
window.resetManualDisconnectFlags = resetManualDisconnectFlags;

export function updateHotspotGwStatus(hid, isOnline, detail = "") {
  const cid = (typeof window !== "undefined" && typeof window.resolveHotspotId === "function")
    ? window.resolveHotspotId(hid)
    : (hid || "default");
  const host = window.location.host || "localhost:8266";
  const ws = window.ws;
  const isDisconnectedByUser = isHotspotGwDisconnected(cid);
  const effectiveOnline = isOnline && !isDisconnectedByUser;

  const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) ||
    (cid === "default" ? document.querySelector(".radio-container") : null);
  if (!card) return;

  const isConnecting = !effectiveOnline && !isDisconnectedByUser && (
    (ws && ws.readyState === WebSocket.CONNECTING) ||
    wsReconnectTimer !== null ||
    (detail && (detail.includes("попытк") || detail.includes("Повтор") || detail.includes("Подключ") || detail.includes("Пауза") || detail.includes("Быстр") || detail.includes("восстановлен")))
  );

  let badgeClass = "status-offline bm-offline";
  let badgeText = "GW:OFFLINE";
  if (effectiveOnline) {
    badgeClass = "status-online bm-online";
    badgeText = "GW:ONLINE";
  } else if (isConnecting) {
    badgeClass = "status-connecting bm-connecting";
    badgeText = "GW:CONNECTING";
  }

  const defaultComment = effectiveOnline
    ? `${host} (WSS активен)`
    : (isDisconnectedByUser ? (window.t ? window.t("status.gw_disconnected_user") : "Отключено пользователем") : `Шлюз ${host} недоступен`);
  const comment = detail || defaultComment;
  const actionHint = effectiveOnline ? "клик для отключения" : "клик для подключения";
  const icon = effectiveOnline ? "🟢" : (isConnecting ? "🟡" : "⚪");
  const ttip = `${icon} Шлюз ProxDMR: ${comment} (${actionHint})`;

  const badge = card.querySelector(".gw-status-badge");
  if (badge) {
    badge.className = `status-badge bm-badge gw-status-badge ${badgeClass}`;
    badge.textContent = badgeText;
    badge.title = ttip;
  }

  const row = card.querySelector(".gw-status-row");
  if (row) {
    row.title = ttip;
  }

  const detailEl = card.querySelector(".gw-detail-text");
  if (detailEl) {
    detailEl.textContent = comment;
    detailEl.title = ttip;
  }
}

export function updateGwStatus(isOnline, detail = "") {
  const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
  if (currentHotspots.length > 0) {
    currentHotspots.forEach(hs => {
      updateHotspotGwStatus(hs.id, isOnline, detail);
    });
  } else {
    updateHotspotGwStatus("default", isOnline, detail);
  }

  if (typeof window.refreshAllCardsBmBanner === "function") {
    window.refreshAllCardsBmBanner();
  }
}

export const triggerHotspotGwAction = async (hid) => {
  if (isGwToggling) return;
  isGwToggling = true;
  setTimeout(() => { isGwToggling = false; }, 350);

  const cid = (typeof window !== "undefined" && typeof window.resolveHotspotId === "function")
    ? window.resolveHotspotId(hid)
    : (hid || window.activeHotspotId || "default");

  const isDisconnectedByUser = isHotspotGwDisconnected(cid);
  const ws = window.ws;
  const isWsOpen = Boolean(ws && ws.readyState === WebSocket.OPEN);
  const isCurrentlyConnected = isWsOpen && !isDisconnectedByUser;

  if (isCurrentlyConnected) {
    // Disconnect GW for THIS hotspot
    console.log(`[GW] Hotspot [${cid}] GW manually disconnected by user.`);
    setHotspotGwDisconnected(cid, true);
    setIsManualGwDisconnect(true);
    updateHotspotGwStatus(cid, false, window.t ? window.t("gw.disconnected_user", {}, "Отключено пользователем") : "Отключено пользователем");

    // Also disconnect BM for this hotspot
    try {
      const hs = ((typeof window !== "undefined" && window.currentHotspots) || []).find(h => {
        const hCid = (typeof window.resolveHotspotId === "function") ? window.resolveHotspotId(h.id) : h.id;
        return hCid === cid;
      });
      if (hs) {
        await fetch(`/api/hotspots/${cid}/disconnect`, { method: "POST" });
        hs.status = "DISCONNECTED";
        hs.detail = "Отключено (GW выкл)";
        if (typeof window.updateBmStatus === "function") {
          window.updateBmStatus("DISCONNECTED", "Отключено (GW выкл)", cid);
        }
      }
    } catch (err) {
      console.warn(`[GW] Error disconnecting BM for ${cid}:`, err);
    }
  } else {
    // Reconnect / Connect GW for THIS hotspot
    console.log(`[GW] Hotspot [${cid}] GW manually reconnecting/connecting by user.`);
    setHotspotGwDisconnected(cid, false);
    setIsManualGwDisconnect(false);
    clearWsReconnectTimer();
    setGwConnectAttempt(1);
    setGwIsFastReconnecting(false);

    const isWsConnected = Boolean(ws && ws.readyState === WebSocket.OPEN);
    if (isWsConnected) {
      updateHotspotGwStatus(cid, true);
    } else {
      updateHotspotGwStatus(cid, false, window.t ? window.t("status.gw_connecting_manual", {}, "Подключение к шлюзу...") : "Подключение к шлюзу...");
      if (typeof window.connectWebSocket === "function") {
        window.connectWebSocket(true);
      }
    }

    // Also reconnect BM for this hotspot if autoconnect was enabled
    try {
      const hs = ((typeof window !== "undefined" && window.currentHotspots) || []).find(h => {
        const hCid = (typeof window.resolveHotspotId === "function") ? window.resolveHotspotId(h.id) : h.id;
        return hCid === cid;
      });
      if (hs && hs.autoconnect !== false) {
        await fetch(`/api/hotspots/${cid}/connect`, { method: "POST" });
        if (typeof window.updateBmStatus === "function") {
          window.updateBmStatus("CONNECTING", window.t ? window.t("status.bm_connecting_status", {}, "Подключение...") : "Подключение...", cid);
        }
      }
    } catch (err) {
      console.warn(`[GW] Error connecting BM for ${cid}:`, err);
    }
  }

  if (typeof window.refreshAllCardsBmBanner === "function") {
    window.refreshAllCardsBmBanner();
  }
};

export const triggerGwAction = () => {
  const activeHid = (typeof window !== "undefined" && window.activeHotspotId) || "default";
  triggerHotspotGwAction(activeHid);
};

// --- 7-Second System Link Watchdog (GW -> BM sequentially) ---
let systemLinkWatchdogTimer = null;
let lastGwWatchdogAttemptTime = 0;
let isSystemLinkChecking = false;

export async function runSystemLinkCheck() {
  if (isSystemLinkChecking) return;
  isSystemLinkChecking = true;

  try {
    const now = Date.now();
    const ws = window.ws;

    // Step 1: Check link to GW (ProxDMR Gateway WebSocket)
    if (isManualGwDisconnect) {
      console.log("[WATCHDOG 7s] GW was manually disconnected by user. Auto-reconnect stopped.");
      return;
    }

    if (window._isServerRestarting) {
      if (now - lastGwWatchdogAttemptTime >= 4000) {
        lastGwWatchdogAttemptTime = now;
        updateGwStatus(false, window.t ? window.t("gw.restarting_wait", {}, "Перезагрузка сервера... Ожидание готовности") : "Перезагрузка сервера... Ожидание готовности");
        if (typeof window.connectWebSocket === "function") {
          window.connectWebSocket(true);
        }
      }
      return;
    }

    const isGwOnline = ws && ws.readyState === WebSocket.OPEN;
    const isGwConnecting = ws && ws.readyState === WebSocket.CONNECTING;

    if (!isGwOnline) {
      if (isGwConnecting) {
        if (now - lastGwWatchdogAttemptTime > 7000) {
          console.warn("[WATCHDOG 7s] GW socket stuck in CONNECTING (>7s). Resetting socket...");
          try { ws.close(); } catch (_) {}
          lastGwWatchdogAttemptTime = now;
          if (typeof window.connectWebSocket === "function") {
            window.connectWebSocket(true);
          }
          return;
        } else {
          console.log("[WATCHDOG 7s] GW link is currently connecting. Waiting for next tick...");
          return;
        }
      }

      if (now - lastGwWatchdogAttemptTime >= 6000) {
        console.warn("[WATCHDOG 7s] GW link is absent. Attempting connection to GW...");
        lastGwWatchdogAttemptTime = now;
        if (wsReconnectTimer) {
          clearTimeout(wsReconnectTimer);
          wsReconnectTimer = null;
        }
        updateGwStatus(false, window.t ? window.t("gw.timer_reconnect", {}, "Попытка подключения к шлюзу (таймер 7с)...") : "Попытка подключения к шлюзу (таймер 7с)...");
        if (typeof window.connectWebSocket === "function") {
          window.connectWebSocket(true);
        }
      }
      return;
    }

    // Step 2: GW link exists -> Now check link to BM
    const currentHotspots = window.currentHotspots || [];
    const activeHotspotId = window.activeHotspotId || "default";
    const currentBmStatus = window.currentBmStatus || "OFFLINE";
    const isHotspotCollapsed = typeof window.isHotspotCollapsed === "function" ? window.isHotspotCollapsed : () => false;
    const isHotspotLiveCollapsed = typeof window.isHotspotLiveCollapsed === "function" ? window.isHotspotLiveCollapsed : () => false;
    const updateBmStatus = typeof window.updateBmStatus === "function" ? window.updateBmStatus : () => {};
    const renderHotspotsList = typeof window.renderHotspotsList === "function" ? window.renderHotspotsList : () => {};
    const renderHotspotSelect = typeof window.renderHotspotSelect === "function" ? window.renderHotspotSelect : () => {};

    const hsList = (currentHotspots && currentHotspots.length > 0)
      ? currentHotspots
      : [{ id: activeHotspotId || "default", status: currentBmStatus }];

    const uncollapsedHotspots = hsList.filter(h => !isHotspotCollapsed(h.id) || isHotspotLiveCollapsed(h.id));
    const targetHotspots = uncollapsedHotspots.length > 0 ? uncollapsedHotspots : [hsList[0]];

    for (const hs of targetHotspots) {
      const hid = hs.id || "default";

      if (isHotspotGwDisconnected(hid) || hs.isManualBmDisconnect || (hid === activeHotspotId && isManualBmDisconnect)) {
        console.log(`[WATCHDOG 7s] BM/GW for [${hs.name || hid}] was manually disconnected by user. Auto-reconnect stopped.`);
        continue;
      }

      const status = hs.status || (hid === activeHotspotId ? currentBmStatus : "") || "OFFLINE";
      const isBmOnline = status === "ONLINE";
      const isBmConnecting = status === "CONNECTING" || status === "AUTHENTICATING" || status === "CONFIGURING";

      if (!isBmOnline) {
        if (isBmConnecting) {
          console.log(`[WATCHDOG 7s] BM link for [${hs.name || hid}] is connecting (${status})...`);
          continue;
        }

        if (now - (hs._lastBmWatchdogAttempt || 0) < 6000) {
          continue;
        }

        console.warn(`[WATCHDOG 7s] BM link is absent for [${hs.name || hid}] (status=${status}). Attempting connection to BM...`);
        hs._lastBmWatchdogAttempt = now;

        updateBmStatus("CONNECTING", window.t ? window.t("gw.timer_bm_reconnect", {}, "Подключение к BM (таймер 7с)...") : "Подключение к BM (таймер 7с)...", hid);

        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "bm_connect", hotspot_id: hid }));
          } catch (_) {}
        } else {
          try {
            const res = await fetch(`/api/hotspots/${hid}/connect`, { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (data && data.bm_status) {
              hs.status = data.bm_status;
              hs.detail = data.detail || "";
              updateBmStatus(data.bm_status, data.detail || "", hid);
              renderHotspotsList();
              renderHotspotSelect();
            }
          } catch (err) {
            console.warn(`[WATCHDOG 7s] Error connecting BM for ${hid}:`, err);
          }
        }

        break;
      }
    }
  } catch (e) {
    console.error("[WATCHDOG 7s] Error in runSystemLinkCheck:", e);
  } finally {
    isSystemLinkChecking = false;
  }
}

export function startSystemLinkWatchdog() {
  if (systemLinkWatchdogTimer) {
    clearInterval(systemLinkWatchdogTimer);
    systemLinkWatchdogTimer = null;
  }
  systemLinkWatchdogTimer = setInterval(runSystemLinkCheck, 7000);
  console.log("[WATCHDOG 7s] System link watchdog timer started (7000ms)");
}

export function wireCardStatusInteractions(card, hs = null) {
  if (!card) return;

  const activeHotspotId = window.activeHotspotId || "default";
  const toggleHotspotConnection = typeof window.toggleHotspotConnection === "function" ? window.toggleHotspotConnection : () => {};
  const openHotspotSettings = typeof window.openHotspotSettings === "function" ? window.openHotspotSettings : () => {};

  const bmToggle = card.querySelector(".bm-status-toggle");
  if (bmToggle && !bmToggle._statusWired) {
    bmToggle._statusWired = true;
    bmToggle.addEventListener("click", (e) => {
      if (e.target.closest(".toggle-control") || e.target.closest("input")) return;
      e.stopPropagation();
      const cid = card.dataset.hotspotId || (hs && hs.id) || activeHotspotId || "default";
      toggleHotspotConnection(cid);
    });
    bmToggle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        const cid = card.dataset.hotspotId || (hs && hs.id) || activeHotspotId || "default";
        toggleHotspotConnection(cid);
      }
    });
  }

  const gwRow = card.querySelector(".gw-status-row");
  if (gwRow && !gwRow._statusWired) {
    gwRow._statusWired = true;
    const cid = card.dataset.hotspotId || (hs && hs.id) || activeHotspotId || "default";
    gwRow.addEventListener("click", (e) => {
      e.stopPropagation();
      triggerHotspotGwAction(cid);
    });
    gwRow.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        triggerHotspotGwAction(cid);
      }
    });
  }

  const apiRow = card.querySelector(".api-status-row");
  if (apiRow && !apiRow._statusWired) {
    apiRow._statusWired = true;
    apiRow.addEventListener("click", (e) => {
      e.stopPropagation();
      const cid = card.dataset.hotspotId || (hs && hs.id) || activeHotspotId || "default";
      if (hs && (!hs.bm_api_key || hs.bm_api_key.trim().length <= 10)) {
        openHotspotSettings(hs, "tab-edit-hs");
      } else {
        checkBmApiStatus(true, cid);
      }
    });
    apiRow.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        const cid = card.dataset.hotspotId || (hs && hs.id) || activeHotspotId || "default";
        if (hs && (!hs.bm_api_key || hs.bm_api_key.trim().length <= 10)) {
          openHotspotSettings(hs, "tab-edit-hs");
        } else {
          checkBmApiStatus(true, cid);
        }
      }
    });
  }
}

// --- BrandMeister REST API Status (Per Hotspot) ---
let isCheckingApi = false;

export async function checkBmApiStatus(arg1 = false, arg2 = null) {
  let force = false;
  let hotspotId = null;
  if (typeof arg1 === "string") {
    hotspotId = arg1;
    force = Boolean(arg2);
  } else if (typeof arg2 === "string") {
    force = Boolean(arg1);
    hotspotId = arg2;
  } else {
    force = Boolean(arg1);
    hotspotId = null;
  }

  if (isCheckingApi && !force) return;
  isCheckingApi = true;

  const currentHotspots = window.currentHotspots || [];
  const resolveHotspotId = typeof window.resolveHotspotId === "function" ? window.resolveHotspotId : (id) => id;
  const isHotspotCollapsed = typeof window.isHotspotCollapsed === "function" ? window.isHotspotCollapsed : () => false;
  const isHotspotLiveCollapsed = typeof window.isHotspotLiveCollapsed === "function" ? window.isHotspotLiveCollapsed : () => false;

  let targets = [];
  if (hotspotId) {
    const realId = resolveHotspotId(hotspotId);
    const found = currentHotspots.find(h => h.id === realId || (realId === "default" && currentHotspots[0] === h));
    if (found) targets.push(found);
    else if (currentHotspots.length) targets.push(currentHotspots[0]);
  } else {
    targets = currentHotspots.filter(h => h.bm_api_key && h.bm_api_key.trim().length > 10 && (!isHotspotCollapsed(h.id) || isHotspotLiveCollapsed(h.id)));
  }

  if (hotspotId && (!targets.length || !targets[0].bm_api_key || targets[0].bm_api_key.trim().length <= 10)) {
    const targetHsId = targets[0]?.id || resolveHotspotId(hotspotId);
    const targetHs = targets[0] || currentHotspots.find(h => h.id === targetHsId);
    if (targetHs) {
      targetHs._apiStatus = "NO_KEY";
      targetHs._apiDetail = "";
    }
    const card = document.querySelector(`.radio-container[data-hotspot-id="${targetHsId}"]`)
      || document.getElementById("radioContainer");
    if (card) {
      const badge = card.querySelector(".api-status-badge");
      const row = card.querySelector(".api-status-row");
      const dt = card.querySelector(".api-detail-text");
      const ttip = window.t ? window.t("status.api_no_key_tooltip") : "⚪ BM API: Ключ не настроен. Нажмите для ввода";
      if (badge) {
        badge.className = "status-badge bm-badge api-status-badge status-offline bm-offline";
        badge.textContent = "API:OFFLINE";
        badge.title = ttip;
      }
      if (row) row.title = ttip;
      if (dt) {
        dt.textContent = window.t ? window.t("status.api_no_key_detail") : "Ключ не настроен (клик для ввода)";
        dt.title = ttip;
      }
    }
    isCheckingApi = false;
    return;
  }

  try {
    for (const hs of targets) {
      hs._apiStatus = "CHECKING";
      const card = document.querySelector(`.radio-container[data-hotspot-id="${hs.id}"]`)
        || (hs.id === resolveHotspotId("default") ? document.getElementById("radioContainer") : null);
      const badge = card ? card.querySelector(".api-status-badge") : null;
      const row = card ? card.querySelector(".api-status-row") : null;
      const dt = card ? card.querySelector(".api-detail-text") : null;

      const checkingTtip = window.t ? window.t("status.api_checking_tooltip") : "🟡 BM API: Проверка соединения...";
      const checkingDetail = window.t ? window.t("status.api_checking_detail") : "Проверка токена v2...";
      if (badge) {
        badge.className = "status-badge bm-badge api-status-badge status-connecting bm-connecting";
        badge.textContent = "API:CHECKING";
        badge.title = checkingTtip;
      }
      if (row) row.title = checkingTtip;
      if (dt) {
        dt.textContent = checkingDetail;
        dt.title = checkingTtip;
      }

      try {
        const res = await fetch(`/api/bm/api-status?hotspot_id=${encodeURIComponent(hs.id)}`);
        const data = await res.json();
        const status = data.status || "OFFLINE";
        hs._apiStatus = status;
        hs._apiDetail = data.detail || "";

        if (badge) {
          badge.className = "status-badge bm-badge api-status-badge";
          let comment = "";
          let tooltip = "";
          if (status === "ONLINE") {
            badge.classList.add("status-online", "bm-online");
            badge.textContent = "API:ONLINE";
            comment = data.device_id ? `api.brandmeister.network (ID: ${data.device_id})` : "api.brandmeister.network (Авторизован)";
            tooltip = window.t ? window.t("status.api_authorized_tooltip") : "🟢 BM API v2: Авторизован. Клик для повторной проверки";
          } else if (status === "AUTH_FAILED") {
            badge.classList.add("status-error", "bm-error");
            badge.textContent = "API:AUTH FAIL";
            comment = data.detail || (window.t ? window.t("status.api_auth_detail") : "Неверный токен (401 Unauthorized)");
            tooltip = window.t ? window.t("status.api_auth_tooltip", { detail: comment }) : `🔴 BM API: ${comment}. Нажмите для настройки`;
          } else if (status === "NO_KEY") {
            badge.classList.add("status-offline", "bm-offline");
            badge.textContent = "API:NO KEY";
            comment = window.t ? window.t("status.api_no_key_detail") : "Ключ не настроен (клик для ввода)";
            tooltip = window.t ? window.t("status.api_no_key_tooltip") : "⚪ BM API: Ключ не настроен. Нажмите для ввода";
          } else {
            badge.classList.add("status-error", "bm-error");
            badge.textContent = "API:ERROR";
            comment = data.detail || (window.t ? window.t("status.api_server_unreachable") : "Сервер api.brandmeister.network недоступен");
            tooltip = window.t ? window.t("status.api_error_tooltip", { detail: comment }) : `🔴 BM API: ${comment}. Клик для повторной проверки`;
          }

          if (dt) {
            dt.textContent = comment;
            dt.title = tooltip;
          }
          badge.title = tooltip;
          if (row) row.title = tooltip;
        }
      } catch (e) {
        console.error(`[API] Failed to check BM API status for ${hs.id}:`, e);
        hs._apiStatus = "ERROR";
        const gwErr = window.t ? window.t("status.api_gateway_error") : "Ошибка связи со шлюзом";
        const errTtip = window.t ? window.t("status.api_error_tooltip", { detail: gwErr }) : `🔴 BM API: ${gwErr}. Клик для повторной проверки`;
        if (badge) {
          badge.className = "status-badge bm-badge api-status-badge status-error bm-error";
          badge.textContent = "API:ERROR";
          badge.title = errTtip;
        }
        if (row) row.title = errTtip;
        if (dt) {
          dt.textContent = gwErr;
          dt.title = errTtip;
        }
      }
    }
  } finally {
    isCheckingApi = false;
  }
}

export function openHotspotApiSettings() {
  const currentHotspots = window.currentHotspots || [];
  const activeHotspotId = window.activeHotspotId || "default";
  const openEditHotspotForm = typeof window.openEditHotspotForm === "function" ? window.openEditHotspotForm : () => {};
  const settingsModal = document.getElementById("settingsModal");
  const editHsApiKey = document.getElementById("editHsApiKey");

  const hs = currentHotspots.find(h => h.id === activeHotspotId) || currentHotspots[0];
  if (hs) {
    openEditHotspotForm(hs);
  }
  if (settingsModal) {
    settingsModal.classList.add("active");
  }
  setTimeout(() => {
    if (editHsApiKey) {
      editHsApiKey.focus();
      editHsApiKey.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, 150);
}

export function initWatchdog() {
  const mainRadioCard = document.getElementById("radioContainer");
  if (mainRadioCard) {
    wireCardStatusInteractions(mainRadioCard);
  }
}

// Global attachment
window.runSystemLinkCheck = runSystemLinkCheck;
window.startSystemLinkWatchdog = startSystemLinkWatchdog;
window.checkBmApiStatus = checkBmApiStatus;
window.updateGwStatus = updateGwStatus;
window.updateHotspotGwStatus = updateHotspotGwStatus;
window.triggerGwAction = triggerGwAction;
window.triggerHotspotGwAction = triggerHotspotGwAction;
window.isHotspotGwDisconnected = isHotspotGwDisconnected;
window.setHotspotGwDisconnected = setHotspotGwDisconnected;
window.wireCardStatusInteractions = wireCardStatusInteractions;
window.openHotspotApiSettings = openHotspotApiSettings;
window.initWatchdog = initWatchdog;

window.__proxdmr = window.__proxdmr || {};
window.__proxdmr.resetManualDisconnectFlags = resetManualDisconnectFlags;
window.__proxdmr.updateGwStatus = updateGwStatus;
window.__proxdmr.updateHotspotGwStatus = updateHotspotGwStatus;
window.__proxdmr.triggerGwAction = triggerGwAction;
window.__proxdmr.triggerHotspotGwAction = triggerHotspotGwAction;
window.__proxdmr.isHotspotGwDisconnected = isHotspotGwDisconnected;
window.__proxdmr.setHotspotGwDisconnected = setHotspotGwDisconnected;
window.__proxdmr.runSystemLinkCheck = runSystemLinkCheck;
window.__proxdmr.startSystemLinkWatchdog = startSystemLinkWatchdog;
window.__proxdmr.wireCardStatusInteractions = wireCardStatusInteractions;
window.__proxdmr.checkBmApiStatus = checkBmApiStatus;
window.__proxdmr.openHotspotApiSettings = openHotspotApiSettings;
window.__proxdmr.initWatchdog = initWatchdog;
