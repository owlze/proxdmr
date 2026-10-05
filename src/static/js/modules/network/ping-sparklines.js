/**
 * ProxDMR - Ping Sparklines & Packet Loss Subsystem
 * Handles BM & Client ping measurements, rolling history, downsampling,
 * SVG sparklines with gradient rendering, and packet loss calculations.
 */

export function resolveHotspotId(hid) {
  const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
  if (!hid || hid === "undefined" || hid === "null") {
    return (currentHotspots && currentHotspots[0] && currentHotspots[0].id) || "default";
  }
  const sHid = String(hid);
  if (sHid === "default") {
    return (currentHotspots && currentHotspots[0] && currentHotspots[0].id) || "default";
  }
  return sHid;
}

function getActiveHotspotId() {
  return (typeof window !== "undefined" && window.activeHotspotId) || "default";
}

function getCurrentHotspots() {
  return (typeof window !== "undefined" && Array.isArray(window.currentHotspots))
    ? window.currentHotspots
    : [];
}

export let cachedBmHostPings = (typeof window !== "undefined" && window.cachedBmHostPings) || {};
export let cachedBmLosses = (typeof window !== "undefined" && window.cachedBmLosses) || {};
export let cachedBmHostLosses = (typeof window !== "undefined" && window.cachedBmHostLosses) || {};
export let bmPingHistory = (typeof window !== "undefined" && window.bmPingHistory) || {};
export let cardPingHistories = (typeof window !== "undefined" && window.cardPingHistories) || {};

export function loadCardPingHistory(cid) {
  const histories = (typeof window !== "undefined" && window.cardPingHistories) || cardPingHistories;
  if (!histories[cid]) {
    try {
      const saved = localStorage.getItem(`proxdmr_ping_hist_${cid}`);
      if (saved) {
        histories[cid] = JSON.parse(saved);
      }
    } catch (e) {}
    if (!histories[cid]) {
      histories[cid] = [];
    }
  }
  return histories[cid];
}

export function saveCardPingHistory(cid) {
  const histories = (typeof window !== "undefined" && window.cardPingHistories) || cardPingHistories;
  if (!histories[cid]) return;
  try {
    const arr = histories[cid];
    if (arr.length > 3000) {
      // Keep recent high-res (last 1h) and downsample older points (>1h) to keep 24h history compact
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoff1h = nowSec - 3600;
      const cutoff24h = nowSec - 86400;
      const recent = [];
      const older = [];
      for (let i = 0; i < arr.length; i++) {
        const pt = arr[i];
        const t = Number(pt.t !== undefined ? pt.t : pt.time);
        if (t < cutoff24h) continue;
        if (t >= cutoff1h) {
          recent.push(pt);
        } else {
          older.push(pt);
        }
      }
      const decimatedOlder = [];
      const step = Math.max(2, Math.ceil(older.length / 2000));
      for (let i = 0; i < older.length; i += step) {
        decimatedOlder.push(older[i]);
      }
      histories[cid] = decimatedOlder.concat(recent);
    }
    localStorage.setItem(`proxdmr_ping_hist_${cid}`, JSON.stringify(histories[cid]));
  } catch (e) {}
}

export const PING_SCALE_HOURS = {
  "10m": 10 / 60,
  "1h": 1,
  "6h": 6,
  "12h": 12,
  "24h": 24
};

export const CLIENT_PING_SCALE_HOURS = {
  "1m": 1 / 60,
  "10m": 10 / 60,
  "1h": 1,
  "6h": 6
};

export let clientSessionStartTime = Math.floor(Date.now() / 1000);
if (typeof window !== "undefined") {
  window._clientSessionStartTime = clientSessionStartTime;
}

export let clientPingHistory = (typeof window !== "undefined" && window.clientPingHistory) || [];
try {
  const savedClientRecent = localStorage.getItem("proxdmr_client_ping_recent");
  if (savedClientRecent) {
    const parsed = JSON.parse(savedClientRecent);
    if (Array.isArray(parsed)) {
      clientPingHistory = parsed.filter(p => p && typeof p === "object" && (p.t !== undefined || p.time !== undefined));
    }
  }
} catch (_) {}
if (typeof window !== "undefined") {
  window.clientPingHistory = clientPingHistory;
}

export let cachedClientRtt = (typeof window !== "undefined" && window.cachedClientRtt !== undefined) ? window.cachedClientRtt : null;
export let cachedClientLoss = (typeof window !== "undefined" && window.cachedClientLoss !== undefined) ? window.cachedClientLoss : 0.0;

function getClientPingHistory() {
  return (typeof window !== "undefined" && window.clientPingHistory) || clientPingHistory;
}

function getCachedClientRtt() {
  if (typeof window !== "undefined" && window.cachedClientRtt !== undefined && window.cachedClientRtt !== null) {
    return window.cachedClientRtt;
  }
  return cachedClientRtt;
}

function getCachedClientLoss() {
  if (typeof window !== "undefined" && window.cachedClientLoss !== undefined && window.cachedClientLoss !== null) {
    return window.cachedClientLoss;
  }
  return cachedClientLoss;
}

export function getHotspotPingMode(hotspotId) {
  const hid = resolveHotspotId(hotspotId || getActiveHotspotId() || "default");
  const saved = localStorage.getItem(`proxdmr_ping_chart_mode_${hid}`);
  return saved === "client" ? "client" : "bm";
}

export function setHotspotPingMode(hotspotId, mode) {
  const hid = resolveHotspotId(hotspotId || getActiveHotspotId() || "default");
  localStorage.setItem(`proxdmr_ping_chart_mode_${hid}`, mode === "client" ? "client" : "bm");
}

export function toggleHotspotPingMode(hotspotId, card = null) {
  const hid = resolveHotspotId(hotspotId || (card && card.dataset.hotspotId) || getActiveHotspotId() || "default");
  const cur = getHotspotPingMode(hid);
  const next = (cur === "client") ? "bm" : "client";
  setHotspotPingMode(hid, next);
  if (card) {
    if (typeof window !== "undefined" && typeof window.updateCardBmBanner === "function") {
      window.updateCardBmBanner(card);
    }
  } else {
    if (typeof window !== "undefined" && typeof window.refreshAllCardsBmBanner === "function") {
      window.refreshAllCardsBmBanner();
    }
  }
}

export function getHotspotPingScale(hotspotId, mode = "bm") {
  const hid = resolveHotspotId(hotspotId || getActiveHotspotId() || "default");
  if (mode === "client") {
    const saved = localStorage.getItem(`proxdmr_client_ping_scale_${hid}`);
    if (saved && CLIENT_PING_SCALE_HOURS[saved]) return saved;
    return "1m";
  }
  const saved = localStorage.getItem(`proxdmr_ping_scale_${hid}`);
  if (saved && PING_SCALE_HOURS[saved]) return saved;
  const globalSaved = localStorage.getItem("proxdmr_ping_scale");
  if (globalSaved && PING_SCALE_HOURS[globalSaved]) return globalSaved;
  return "1h";
}

export function setHotspotPingScale(hotspotId, scale, mode = "bm") {
  const hid = resolveHotspotId(hotspotId || getActiveHotspotId() || "default");
  if (mode === "client") {
    if (CLIENT_PING_SCALE_HOURS[scale]) {
      localStorage.setItem(`proxdmr_client_ping_scale_${hid}`, scale);
    }
  } else {
    if (PING_SCALE_HOURS[scale]) {
      localStorage.setItem(`proxdmr_ping_scale_${hid}`, scale);
      localStorage.setItem("proxdmr_ping_scale", scale);
    }
  }
}

let lastScaleCycleTime = 0;
export function cycleHotspotPingScale(hotspotId, card = null) {
  const now = Date.now();
  if (now - lastScaleCycleTime < 150) return;
  lastScaleCycleTime = now;

  const currentHotspots = getCurrentHotspots();
  const activeHotspotId = getActiveHotspotId();
  const hid = resolveHotspotId(hotspotId || (card ? card.dataset.hotspotId : activeHotspotId) || "default");
  const mode = getHotspotPingMode(hid);
  if (mode === "client") {
    const current = getHotspotPingScale(hid, "client");
    const scales = ["1m", "10m", "1h", "6h"];
    const idx = scales.indexOf(current);
    const next = scales[(idx + 1) % scales.length];
    setHotspotPingScale(hid, next, "client");
  } else {
    const current = getHotspotPingScale(hid, "bm");
    const scales = ["10m", "1h", "6h", "12h", "24h"];
    const idx = scales.indexOf(current);
    const next = scales[(idx + 1) % scales.length];
    setHotspotPingScale(hid, next, "bm");
  }

  if (card) {
    card._sparklineScale = null;
    const hs = (currentHotspots && currentHotspots.length)
      ? (currentHotspots.find(h => h.id === hid) || currentHotspots.find(h => h.id === activeHotspotId) || currentHotspots[0])
      : null;
    if (typeof window !== "undefined" && typeof window.updateCardBmBanner === "function") {
      window.updateCardBmBanner(card, hs);
    }
  } else {
    if (typeof window !== "undefined" && typeof window.refreshAllCardsBmBanner === "function") {
      window.refreshAllCardsBmBanner();
    }
  }
}

export function cyclePingScale() {
  const activeHotspotId = getActiveHotspotId();
  const activeCard = document.querySelector(`.radio-container[data-hotspot-id="${activeHotspotId}"]`) || document.querySelector(".radio-container");
  cycleHotspotPingScale(activeHotspotId, activeCard);
}

export function getPingColor(ping) {
  if (ping === null || ping === undefined || isNaN(ping) || ping < 0) return "#ef4444";
  if (ping < 70) return "#22c55e";   // Green (healthy BM ping is typically 45-65ms)
  if (ping < 110) return "#84cc16";  // Lime
  if (ping < 160) return "#eab308";  // Yellow
  if (ping < 220) return "#f97316";  // Orange
  return "#ef4444";                  // Red
}

export function getClientPingColor(ping) {
  if (ping === null || ping === undefined || isNaN(ping) || ping < 0) return "#ef4444";
  if (ping < 15) return "#22c55e";   // Fast LAN / WiFi
  if (ping < 40) return "#84cc16";   // Normal WiFi / Good 4G
  if (ping < 80) return "#eab308";   // Mobile 3G/4G moderate
  if (ping < 150) return "#f97316";  // High latency
  return "#ef4444";                  // Bad
}

export function generateSparklineGradientStops(coords, W, forArea = false, isClientMode = false) {
  if (!coords || coords.length < 2) return "";
  const stops = [];
  const colorFn = isClientMode ? getClientPingColor : getPingColor;

  function pointColor(c) {
    if (!c.isCurrent) return "#6b7280"; // Grey for other/inactive servers
    return colorFn(c.ping);
  }

  const maxX = (coords && coords.length > 0 && coords[coords.length - 1].x > 0) ? coords[coords.length - 1].x : W;

  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    const offset = Math.max(0, Math.min(100, (c.x / maxX) * 100)).toFixed(2);
    const col = pointColor(c);

    if (i > 0) {
      const prev = coords[i - 1];
      const prevCol = pointColor(prev);
      if (prevCol !== col) {
        stops.push(`<stop offset="${offset}%" stop-color="${prevCol}" ${forArea ? 'stop-opacity="0.38"' : 'stop-opacity="1"'}/>`);
      }
    }
    stops.push(`<stop offset="${offset}%" stop-color="${col}" ${forArea ? 'stop-opacity="0.38"' : 'stop-opacity="1"'}/>`);
  }

  if (stops.length > 0 && coords.length > 0) {
    const firstCol = pointColor(coords[0]);
    const lastCol = pointColor(coords[coords.length - 1]);
    const mFirst = stops[0].match(/offset="([\d.]+)%?"/);
    const firstOffset = mFirst ? parseFloat(mFirst[1]) : 0;
    if (firstOffset > 0) {
      stops.unshift(`<stop offset="0%" stop-color="${firstCol}" ${forArea ? 'stop-opacity="0.38"' : 'stop-opacity="1"'}/>`);
    }
    const mLast = stops[stops.length - 1].match(/offset="([\d.]+)%?"/);
    const lastOffset = mLast ? parseFloat(mLast[1]) : 100;
    if (lastOffset < 100) {
      stops.push(`<stop offset="100%" stop-color="${lastCol}" ${forArea ? 'stop-opacity="0.38"' : 'stop-opacity="1"'}/>`);
    }
  }

  return stops.join("");
}

export function decimatePingPoints(rawPts, windowStartSec, nowSec, scale, currentHost) {
  if (!rawPts || rawPts.length <= 120) return rawPts;

  let targetBuckets = 120;
  if (scale === "6h") targetBuckets = 100;
  else if (scale === "12h") targetBuckets = 120;
  else if (scale === "24h") targetBuckets = 150;

  const totalTime = Math.max(1, nowSec - windowStartSec);
  const bucketSize = totalTime / targetBuckets;

  const buckets = Array.from({ length: targetBuckets }, () => []);
  rawPts.forEach(p => {
    let bIdx = Math.floor((p.t - windowStartSec) / bucketSize);
    if (bIdx < 0) bIdx = 0;
    if (bIdx >= targetBuckets) bIdx = targetBuckets - 1;
    buckets[bIdx].push(p);
  });

  const result = [];
  buckets.forEach((bucket, bIdx) => {
    if (bucket.length === 0) return;
    let bSumPing = 0;
    let bSumT = 0;
    let bCount = 0;
    let bIsCurrent = false;
    let lastRaw = bucket[bucket.length - 1];

    for (let i = 0; i < bucket.length; i++) {
      const pt = bucket[i];
      if (pt.ping !== null && !isNaN(pt.ping)) {
        bSumPing += pt.ping;
        bSumT += pt.t;
        bCount++;
      }
      if (pt.isCurrent) bIsCurrent = true;
    }

    if (bCount > 0) {
      const avgPing = Math.round(bSumPing / bCount);
      const avgT = Math.round(bSumT / bCount);
      result.push({
        t: avgT,
        ping: avgPing,
        host: lastRaw.host || currentHost,
        isCurrent: bIsCurrent,
        yNorm: lastRaw.yNorm
      });
    }
  });

  return result.length >= 2 ? result : rawPts.map(p => ({ ...p, isCurrent: (p.host === currentHost) }));
}

export function renderCardPingSparkline(card, hostVal) {
  if (!card) return;
  const chartWrap = card.querySelector(".bm-ping-chart-wrap");
  if (!chartWrap) return;

  const rawCid = card.dataset.hotspotId || "default";
  const cid = resolveHotspotId(rawCid);
  const mode = getHotspotPingMode(cid);
  const isClientMode = (mode === "client");
  const currentScale = getHotspotPingScale(cid, mode);

  const scaleBadge = chartWrap.querySelector(".bm-ping-scale-badge");
  if (scaleBadge) {
    scaleBadge.textContent = currentScale;
    scaleBadge.title = ((typeof window !== "undefined" && window.t) ? window.t("ping.scale_badge_title") : "Масштаб (двойной тап для смены)") + ` (${currentScale})`;
  }

  let modeBadge = chartWrap.querySelector(".bm-ping-mode-badge");
  if (!modeBadge) {
    modeBadge = document.createElement("span");
    modeBadge.className = "bm-ping-mode-badge";
    chartWrap.appendChild(modeBadge);
  }
  modeBadge.textContent = isClientMode ? "GW" : "BM";
  modeBadge.className = `bm-ping-mode-badge ${isClientMode ? "mode-client" : "mode-bm"}`;
  modeBadge.title = isClientMode
    ? ((typeof window !== "undefined" && window.t) ? window.t("ping.mode_client_tooltip") : "Режим: Client ↔ ProxDMR. Кликните по графику для смены на BM")
    : ((typeof window !== "undefined" && window.t) ? window.t("ping.mode_bm_tooltip") : "Режим: BM. Кликните по графику для смены на Client ↔ ProxDMR");

  const svg = chartWrap.querySelector(".bm-ping-sparkline");
  if (!svg) return;

  const areaPath = svg.querySelector(".sparkline-area");
  const linePath = svg.querySelector(".sparkline-line");
  const dot = svg.querySelector(".sparkline-dot");
  if (!areaPath || !linePath || !dot) return;

  const maskGradId = `sparkMaskGrad_${rawCid}`;
  const maskId = `sparkMask_${rawCid}`;
  const strokeGradId = `sparkGradStroke_${rawCid}`;
  const areaGradId = `sparkGradArea_${rawCid}`;

  const nowSec = Math.floor(Date.now() / 1000);
  const windowHours = isClientMode
    ? (CLIENT_PING_SCALE_HOURS[currentScale] || (1 / 60))
    : (PING_SCALE_HOURS[currentScale] || 1);
  const windowStartSec = nowSec - Math.round(windowHours * 3600);

  let pts = [];
  if (isClientMode) {
    const clientHist = getClientPingHistory();
    pts = (clientHist || []).map(p => {
      let t = Number(p.t !== undefined ? p.t : (Array.isArray(p) ? p[0] : 0));
      let ping = Number(p.ping !== undefined ? p.ping : (Array.isArray(p) ? p[1] : null));
      if (t > 1e11) t = Math.floor(t / 1000);
      if (ping === null || isNaN(ping) || ping < 0) return null;
      return { t, ping, host: "gw", isCurrent: true, orig: p, yNorm: p.yNorm };
    }).filter(p => p && !isNaN(p.t) && !isNaN(p.ping) && p.t >= windowStartSec);

    pts.sort((a, b) => a.t - b.t);

    if (pts.length > 0 && pts[0].t - windowStartSec < 300) {
      pts[0].t = windowStartSec;
    }

    const clientRtt = getCachedClientRtt();
    const ws = (typeof window !== "undefined" && window.ws);
    const isWsOpen = Boolean(ws && ws.readyState === WebSocket.OPEN);
    const currentPing = (isWsOpen && clientRtt !== null && !isNaN(clientRtt)) ? clientRtt : null;
    if (pts.length === 0 && currentPing !== null) {
      pts = [
        { t: windowStartSec, ping: currentPing, host: "gw", isCurrent: true },
        { t: nowSec, ping: currentPing, host: "gw", isCurrent: true }
      ];
    } else if (pts.length === 1 && currentPing !== null) {
      pts.unshift({ t: windowStartSec, ping: pts[0].ping, host: "gw", isCurrent: true, yNorm: pts[0].yNorm });
    }
  } else {
    // Get continuous timeline points for this card within current time window
    const cardHist = loadCardPingHistory(cid);
    pts = (cardHist || []).map(p => {
      let t = 0;
      let ping = 0;
      let host = null;
      let yNorm = (p && typeof p === "object") ? p.yNorm : undefined;
      if (Array.isArray(p)) {
        t = Number(p[0]);
        if (p[1] === null || p[1] === undefined || isNaN(Number(p[1]))) return null;
        ping = Number(p[1]);
        host = p[2] || hostVal;
        if (p.yNorm !== undefined) yNorm = p.yNorm;
      } else if (p && typeof p === "object") {
        t = Number(p.t !== undefined ? p.t : p.time);
        const rawP = (p.ping !== undefined ? p.ping : p.latency);
        if (rawP === null || rawP === undefined || isNaN(Number(rawP))) return null;
        ping = Number(rawP);
        host = p.host || hostVal;
      } else {
        return null;
      }
      if (t > 1e11) t = Math.floor(t / 1000);
      return { t, ping, host, isCurrent: (host === hostVal), orig: p, yNorm };
    }).filter(p => p && !isNaN(p.t) && !isNaN(p.ping) && p.ping !== null && p.t >= windowStartSec);

    // If card history was empty or missing older points in the window, fallback/merge from bmPingHistory[hostVal]
    const histSource = (typeof window !== "undefined" && window.bmPingHistory && window.bmPingHistory[hostVal])
      ? window.bmPingHistory[hostVal]
      : (bmPingHistory[hostVal] || []);
    const rawHistory = Array.isArray(histSource) ? histSource : [];

    if (pts.length === 0 && rawHistory.length > 0) {
      pts = rawHistory.map(p => {
        let t = Number(Array.isArray(p) ? p[0] : (p.t !== undefined ? p.t : p.time));
        let ping = Number(Array.isArray(p) ? p[1] : (p.ping !== undefined ? p.ping : p.latency));
        let yNorm = (p && typeof p === "object") ? p.yNorm : undefined;
        if (Array.isArray(p) && p.yNorm !== undefined) yNorm = p.yNorm;
        if (t > 1e11) t = Math.floor(t / 1000);
        return { t, ping, host: hostVal, isCurrent: true, orig: p, yNorm };
      }).filter(p => p && !isNaN(p.t) && !isNaN(p.ping) && p.ping !== null && p.t >= windowStartSec);
    } else if (pts.length > 0 && pts[0].t > windowStartSec + 120 && rawHistory.length > 0) {
      const older = rawHistory.map(p => {
        let t = Number(Array.isArray(p) ? p[0] : (p.t !== undefined ? p.t : p.time));
        let ping = Number(Array.isArray(p) ? p[1] : (p.ping !== undefined ? p.ping : p.latency));
        if (t > 1e11) t = Math.floor(t / 1000);
        return { t, ping, host: hostVal, isCurrent: true };
      }).filter(p => p && !isNaN(p.t) && !isNaN(p.ping) && p.ping !== null && p.t >= windowStartSec && p.t < pts[0].t);
      if (older.length > 0) {
        pts = older.concat(pts);
      }
    }

    // Ensure points are sorted by timestamp
    pts.sort((a, b) => a.t - b.t);

    // Apply decimation / averaging only on 6h, 12h, 24h
    if (pts.length > 2 && (currentScale === "6h" || currentScale === "12h" || currentScale === "24h")) {
      pts = decimatePingPoints(pts, windowStartSec, nowSec, currentScale, hostVal);
    }

    // If oldest point is close to window start (within 5 minutes), snap to windowStartSec so left edge is flush
    if (pts.length > 0 && pts[0].t - windowStartSec < 300) {
      pts[0].t = windowStartSec;
    }

    // If history has fewer than 2 points, synthesize flat line using current ping if available
    const hostPings = (typeof window !== "undefined" && window.cachedBmHostPings) || cachedBmHostPings;
    const bmPings = (typeof window !== "undefined" && window.cachedBmPings) || {};
    const currentPing = (hostPings && hostPings[hostVal] !== undefined)
      ? hostPings[hostVal]
      : (bmPings && bmPings[cid] !== undefined ? bmPings[cid] : null);

    if (pts.length === 0 && currentPing !== null && !isNaN(currentPing)) {
      pts = [
        { t: windowStartSec, ping: currentPing, host: hostVal, isCurrent: true },
        { t: nowSec, ping: currentPing, host: hostVal, isCurrent: true }
      ];
    } else if (pts.length === 1) {
      pts.unshift({ t: windowStartSec, ping: pts[0].ping, host: pts[0].host, isCurrent: pts[0].isCurrent, yNorm: pts[0].yNorm });
    }
  }

  // Clear chart if no points are usable
  if (pts.length < 2) {
    areaPath.setAttribute("d", "");
    linePath.setAttribute("d", "");
    dot.setAttribute("display", "none");
    chartWrap._latestCoords = null;
    return;
  }

  // Ensure last point is anchored to current time ONLY IF link is active and last point was recent
  const lastRaw = pts[pts.length - 1];
  const isLinkActive = isClientMode ? Boolean(window.ws && window.ws.readyState === WebSocket.OPEN) : true;
  if (isLinkActive && nowSec - lastRaw.t > 0 && nowSec - lastRaw.t <= 2) {
    pts.push({
      t: nowSec,
      ping: lastRaw.ping,
      host: lastRaw.host,
      isCurrent: lastRaw.isCurrent,
      yNorm: lastRaw.yNorm
    });
  }

  // Geometry parameters (matches SVG viewBox="0 0 160 34" in HTML)
  const W = 160;
  const H = 34;
  const pad = 2.5;
  const rightMargin = 2.0;
  const drawW = W - rightMargin;
  const drawH = H - (pad * 2);
  const totalWindowSec = Math.max(1, nowSec - windowStartSec);

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");

  // Dynamic Y-range calculation
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const val = pts[i].ping;
    if (val < vMin) vMin = val;
    if (val > vMax) vMax = val;
  }
  if (!isFinite(vMin)) vMin = 0;
  if (!isFinite(vMax)) vMax = 100;

  const minSpan = isClientMode ? 12 : 25;
  const rMin = Math.max(0, vMin - (isClientMode ? 3 : 6));
  const rMax = Math.max(rMin + minSpan, vMax + (isClientMode ? 4 : 8));
  const rSpan = Math.max(1, rMax - rMin);

  const scaleKey = isClientMode ? "_sparkScale_client" : "_sparkScale_bm";
  let spState = card[scaleKey];
  const modeChanged = (card._sparklineMode !== mode);
  const scaleChanged = (card._sparklineScale !== currentScale);

  if (!spState || modeChanged || scaleChanged) {
    const initMin = rMin;
    const initMax = Math.max(initMin + minSpan, rMax);
    spState = {
      activeMin: initMin,
      activeMax: initMax,
      targetMin: initMin,
      targetMax: initMax
    };
    card[scaleKey] = spState;
  }
  card._sparklineMode = mode;
  card._sparklineScale = currentScale;

  spState.targetMin = rMin;
  spState.targetMax = rMax;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.ping > spState.activeMax) {
      const headroom = Math.max(4, Math.round((p.ping - spState.activeMin) * 0.15));
      spState.activeMax = p.ping + headroom;
    }
    if (p.ping < spState.activeMin) {
      const footroom = Math.max(3, Math.round((spState.activeMax - p.ping) * 0.15));
      spState.activeMin = Math.max(0, p.ping - footroom);
    }
  }

  // Gentle relaxation towards targets
  if (spState.activeMax > spState.targetMax) {
    spState.activeMax -= (spState.activeMax - spState.targetMax) * 0.08;
  }
  if (spState.activeMin < spState.targetMin) {
    spState.activeMin += (spState.targetMin - spState.activeMin) * 0.08;
  }

  let activeSpan = spState.activeMax - spState.activeMin;
  if (activeSpan < minSpan) {
    activeSpan = minSpan;
    spState.activeMax = spState.activeMin + minSpan;
  }

  // Compute SVG coordinates
  const coords = [];
  const minXStep = 0.25;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const elapsedSec = Math.max(0, Math.min(totalWindowSec, p.t - windowStartSec));
    let x = (elapsedSec / totalWindowSec) * drawW;

    if (coords.length > 0) {
      const prev = coords[coords.length - 1];
      if (x - prev.x < minXStep && i < pts.length - 1) {
        continue;
      }
      if (x < prev.x) {
        x = prev.x;
      }
    }

    let yNorm;
    if (p.yNorm !== undefined && !scaleChanged && !modeChanged) {
      const rawNorm = (p.ping - spState.activeMin) / activeSpan;
      yNorm = p.yNorm * 0.4 + rawNorm * 0.6;
    } else {
      yNorm = (p.ping - spState.activeMin) / activeSpan;
    }
    yNorm = Math.max(0.0, Math.min(1.0, yNorm));
    if (p.orig && typeof p.orig === "object") {
      p.orig.yNorm = yNorm;
    }

    const y = H - pad - (yNorm * drawH);
    coords.push({
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      ping: p.ping,
      t: p.t,
      isCurrent: p.isCurrent
    });
  }

  if (coords.length < 2) return;
  chartWrap._latestCoords = coords;

  // Build SVG Path geometry
  let pathD = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i];
    const p1 = coords[i + 1];
    const midX = ((p0.x + p1.x) / 2).toFixed(2);
    const midY = ((p0.y + p1.y) / 2).toFixed(2);
    pathD += ` Q ${p0.x} ${p0.y}, ${midX} ${midY}`;
  }
  const last = coords[coords.length - 1];
  pathD += ` L ${last.x} ${last.y}`;

  const yBottom = H;
  const areaD = `${pathD} L ${last.x} ${yBottom} L ${coords[0].x} ${yBottom} Z`;

  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  let maskGrad = defs.querySelector(".sparkline-mask-grad") || defs.querySelector(`#${maskGradId}`);
  if (!maskGrad) {
    maskGrad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    maskGrad.setAttribute("class", "sparkline-mask-grad");
    defs.appendChild(maskGrad);
  }
  maskGrad.id = maskGradId;
  maskGrad.setAttribute("x1", "0%");
  maskGrad.setAttribute("y1", "0%");
  maskGrad.setAttribute("x2", "100%");
  maskGrad.setAttribute("y2", "0%");
  maskGrad.innerHTML = '<stop offset="0%" stop-color="#fff" stop-opacity="0"/><stop offset="5%" stop-color="#fff" stop-opacity="1"/><stop offset="100%" stop-color="#fff" stop-opacity="1"/>';

  let mask = defs.querySelector(".sparkline-mask") || defs.querySelector(`#${maskId}`);
  if (!mask) {
    mask = document.createElementNS("http://www.w3.org/2000/svg", "mask");
    mask.setAttribute("class", "sparkline-mask");
    defs.appendChild(mask);
  }
  mask.id = maskId;
  mask.innerHTML = `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#${maskGradId})"/>`;

  let gradStroke = defs.querySelector(".sparkline-grad-stroke") || defs.querySelector(`#${strokeGradId}`);
  if (!gradStroke) {
    gradStroke = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    gradStroke.setAttribute("class", "sparkline-grad-stroke");
    defs.appendChild(gradStroke);
  }
  gradStroke.id = strokeGradId;
  gradStroke.setAttribute("x1", "0%");
  gradStroke.setAttribute("y1", "0%");
  gradStroke.setAttribute("x2", "100%");
  gradStroke.setAttribute("y2", "0%");

  let gradArea = defs.querySelector(".sparkline-grad-area") || defs.querySelector(`#${areaGradId}`);
  if (!gradArea) {
    gradArea = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    gradArea.setAttribute("class", "sparkline-grad-area");
    defs.appendChild(gradArea);
  }
  gradArea.id = areaGradId;
  gradArea.setAttribute("x1", "0%");
  gradArea.setAttribute("y1", "0%");
  gradArea.setAttribute("x2", "100%");
  gradArea.setAttribute("y2", "0%");

  // Generate chromatic stops
  gradStroke.innerHTML = generateSparklineGradientStops(coords, W, false, isClientMode);
  gradArea.innerHTML = generateSparklineGradientStops(coords, W, true, isClientMode);

  areaPath.setAttribute("fill", `url(#${areaGradId})`);
  linePath.setAttribute("stroke", `url(#${strokeGradId})`);
  linePath.setAttribute("stroke-width", "1.6");

  areaPath.setAttribute("d", areaD);
  linePath.setAttribute("d", pathD);

  linePath.setAttribute("mask", `url(#${maskId})`);
  areaPath.setAttribute("mask", `url(#${maskId})`);

  // Subpixel pulse dot at current ping position
  if (!isLinkActive) {
    dot.setAttribute("display", "none");
  } else {
    const latestPing = last.ping;
    const dotColor = isClientMode ? getClientPingColor(latestPing) : getPingColor(latestPing);
    dot.setAttribute("cx", last.x);
    dot.setAttribute("cy", last.y);
    dot.setAttribute("fill", dotColor);
    dot.removeAttribute("display");
  }

  // Wire interactive gestures once per chartWrap
  if (!chartWrap._chartWired) {
    chartWrap._chartWired = true;

    let lastClickTime = 0;
    let clickTimeout = null;

    chartWrap.addEventListener("click", (e) => {
      e.stopPropagation();
      const now = Date.now();
      const currentCid = card.dataset.hotspotId || "default";

      if (now - lastClickTime < 320) {
        // Double click detected: cycle scale!
        if (clickTimeout) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
        }
        lastClickTime = 0;
        cycleHotspotPingScale(currentCid, card);
      } else {
        lastClickTime = now;
        clickTimeout = setTimeout(() => {
          clickTimeout = null;
          // Single click: toggle mode (BM <-> Client)!
          toggleHotspotPingMode(currentCid, card);
        }, 320);
      }
    });

    chartWrap.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (clickTimeout) {
        clearTimeout(clickTimeout);
        clickTimeout = null;
      }
      const currentCid = card.dataset.hotspotId || "default";
      cycleHotspotPingScale(currentCid, card);
    });

    if (scaleBadge) {
      scaleBadge.addEventListener("click", (e) => {
        e.stopPropagation();
        const currentCid = card.dataset.hotspotId || "default";
        cycleHotspotPingScale(currentCid, card);
      });
    }

    const tooltip = chartWrap.querySelector(".bm-ping-tooltip");
    const handleMove = (clientX) => {
      const coordsList = chartWrap._latestCoords || coords;
      if (!tooltip || !coordsList || !coordsList.length) return;
      const rect = chartWrap.getBoundingClientRect();
      const relX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const ratio = relX / rect.width;
      const targetX = ratio * drawW;

      let closest = coordsList[0];
      let minDist = Infinity;
      for (const c of coordsList) {
        const d = Math.abs(c.x - targetX);
        if (d < minDist) {
          minDist = d;
          closest = c;
        }
      }

      const date = new Date(closest.t * 1000);
      const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      tooltip.textContent = `${closest.ping} ms (${timeStr})`;
      tooltip.style.left = `${(closest.x / drawW) * 100}%`;
      tooltip.classList.add("visible");
    };

    chartWrap.addEventListener("mousemove", (e) => {
      handleMove(e.clientX);
    });

    chartWrap.addEventListener("mouseleave", () => {
      if (tooltip) tooltip.classList.remove("visible");
    });

    chartWrap.addEventListener("touchmove", (e) => {
      if (e.touches && e.touches[0]) {
        handleMove(e.touches[0].clientX);
      }
    }, { passive: true });

    chartWrap.addEventListener("touchend", () => {
      setTimeout(() => {
        if (tooltip) tooltip.classList.remove("visible");
      }, 1200);
    });
  }
}

export function getCardPingDisplayMode(cid) {
  const saved = localStorage.getItem(`proxdmr_ping_mode_${cid}`);
  return saved || "ping";
}

export function setCardPingDisplayMode(cid, mode) {
  localStorage.setItem(`proxdmr_ping_mode_${cid}`, mode);
}

export function calculateCardPacketLoss(cid, currentHost, scale = null) {
  const currentScale = scale || getHotspotPingScale(cid, "bm");
  const windowHours = PING_SCALE_HOURS[currentScale] || 1;
  const windowSec = Math.round(windowHours * 3600);
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - windowSec;

  let switchTime = parseInt(localStorage.getItem(`proxdmr_host_switch_${cid}`) || "0", 10);
  if (!switchTime || switchTime > nowSec) {
    switchTime = 0;
  }
  const effectiveStart = Math.max(windowStart, switchTime);
  const effectiveElapsedSec = Math.max(0, nowSec - effectiveStart);

  const cardHist = loadCardPingHistory(cid);
  let totalAttempts = 0;
  let lostAttempts = 0;

  (cardHist || []).forEach(p => {
    let t = 0;
    let ping = null;
    let host = null;
    if (Array.isArray(p)) {
      t = Number(p[0]);
      ping = p[1];
      host = p[2] || currentHost;
    } else if (p && typeof p === "object") {
      t = Number(p.t !== undefined ? p.t : p.time);
      ping = p.ping !== undefined ? p.ping : p.latency;
      host = p.host || currentHost;
    }
    if (t > 1e11) t = Math.floor(t / 1000);

    // Only count points matching active server within effective window
    if ((!host || host === currentHost) && t >= effectiveStart && t <= nowSec) {
      totalAttempts++;
      if (ping === null || ping === undefined || isNaN(Number(ping)) || Number(ping) < 0) {
        lostAttempts++;
      }
    }
  });

  // If cardHist had no points for this host within window, check window.bmPingHistory[currentHost]
  if (totalAttempts === 0 && currentHost) {
    const histSource = (typeof window !== "undefined" && window.bmPingHistory && window.bmPingHistory[currentHost])
      ? window.bmPingHistory[currentHost]
      : (bmPingHistory[currentHost] || []);
    const rawHistory = Array.isArray(histSource) ? histSource : [];
    rawHistory.forEach(p => {
      let t = Number(Array.isArray(p) ? p[0] : (p.t !== undefined ? p.t : p.time));
      let ping = Array.isArray(p) ? p[1] : (p.ping !== undefined ? p.ping : p.latency);
      if (t > 1e11) t = Math.floor(t / 1000);
      if (t >= effectiveStart && t <= nowSec) {
        totalAttempts++;
        if (ping === null || ping === undefined || isNaN(Number(ping)) || Number(ping) < 0) {
          lostAttempts++;
        }
      }
    });
  }

  if (totalAttempts > 0) {
    const lossPercent = Number(((lostAttempts / totalAttempts) * 100).toFixed(1));
    return {
      lossPercent,
      total: totalAttempts,
      lost: lostAttempts,
      scale: currentScale,
      elapsedSec: effectiveElapsedSec,
      hasData: true
    };
  }

  // Fallback to server cached losses if no history points yet (e.g. initial connection)
  const bmLosses = (typeof window !== "undefined" && window.cachedBmLosses) || cachedBmLosses;
  const bmHostLosses = (typeof window !== "undefined" && window.cachedBmHostLosses) || cachedBmHostLosses;
  if (bmLosses && bmLosses[cid] !== undefined && bmLosses[cid] !== null) {
    return { lossPercent: Number(bmLosses[cid]), scale: currentScale, hasData: true, total: 0, lost: 0 };
  }
  if (bmHostLosses && bmHostLosses[currentHost] !== undefined && bmHostLosses[currentHost] !== null) {
    return { lossPercent: Number(bmHostLosses[currentHost]), scale: currentScale, hasData: true, total: 0, lost: 0 };
  }

  return {
    lossPercent: 0.0,
    scale: currentScale,
    hasData: false,
    total: 0,
    lost: 0
  };
}

export function calculateClientPacketLoss(cidOrScale = "default", scale = null) {
  let cid = "default";
  let targetScale = scale;
  if (cidOrScale && CLIENT_PING_SCALE_HOURS[cidOrScale]) {
    targetScale = cidOrScale;
  } else if (cidOrScale) {
    cid = cidOrScale;
  }
  const currentScale = targetScale || getHotspotPingScale(cid || "default", "client");
  const windowHours = CLIENT_PING_SCALE_HOURS[currentScale] || (1 / 60);
  const windowSec = Math.round(windowHours * 3600);
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - windowSec;

  const PING_INTERVAL_SEC = 1.5;
  const clientHist = getClientPingHistory();
  let receivedCount = 0;
  let lostCount = 0;
  let lastRecordedT = 0;
  let firstRecordedT = 0;

  (clientHist || []).forEach(p => {
    if (!p) return;
    let t = Number(p.t !== undefined ? p.t : (Array.isArray(p) ? p[0] : 0));
    let ping = p.ping !== undefined ? p.ping : (Array.isArray(p) ? p[1] : null);
    if (t > 1e11) t = Math.floor(t / 1000);
    if (t >= windowStart && t <= nowSec) {
      if (!firstRecordedT || t < firstRecordedT) firstRecordedT = t;
      if (t > lastRecordedT) lastRecordedT = t;
      if (ping === null || ping === undefined || isNaN(Number(ping)) || Number(ping) < 0) {
        lostCount++;
      } else {
        receivedCount++;
      }
    }
  });

  // Count missing intervals if the connection was dead or timer throttled
  if (lastRecordedT > 0 && (nowSec - lastRecordedT) >= 2.5) {
    const elapsedMissing = Math.floor((nowSec - lastRecordedT) / PING_INTERVAL_SEC);
    lostCount += elapsedMissing;
  }

  const sessionStart = (typeof window !== "undefined" && window._clientSessionStartTime)
    ? window._clientSessionStartTime
    : ((clientHist && clientHist.length > 0 && clientHist[0].t) ? Number(clientHist[0].t) : nowSec);
  const effectiveStart = Math.max(windowStart, sessionStart);
  const effectiveWindowSec = Math.max(1, nowSec - effectiveStart);
  const expectedTotal = Math.max(1, Math.round(effectiveWindowSec / PING_INTERVAL_SEC));

  let totalAttempts = receivedCount + lostCount;
  const ws = (typeof window !== "undefined" && window.ws);
  const isWsOpen = Boolean(ws && ws.readyState === WebSocket.OPEN);

  if (totalAttempts === 0) {
    if (!isWsOpen) {
      return {
        lossPercent: 100.0,
        total: expectedTotal,
        lost: expectedTotal,
        scale: currentScale,
        hasData: true
      };
    }
    const clientLoss = getCachedClientLoss();
    if (clientLoss !== undefined && clientLoss !== null) {
      return { lossPercent: Number(clientLoss), scale: currentScale, hasData: true, total: 0, lost: 0 };
    }
    return { lossPercent: 0.0, scale: currentScale, hasData: false, total: 0, lost: 0 };
  }

  // If there have been dropped packets and total attempts are less than the expected window capacity,
  // scale totalAttempts to the window capacity so loss ratio correctly reflects the window proportion
  if (lostCount > 0 && totalAttempts < expectedTotal) {
    totalAttempts = expectedTotal;
    lostCount = Math.max(lostCount, totalAttempts - receivedCount);
  }

  const lossPercent = Number(((lostCount / totalAttempts) * 100).toFixed(1));
  return {
    lossPercent: Math.min(100.0, Math.max(0.0, lossPercent)),
    total: totalAttempts,
    lost: lostCount,
    scale: currentScale,
    hasData: true
  };
}

export function updatePingElement(pingEl, latencyMs, lossInfo, mode = "bm") {
  if (!pingEl) return;

  let pingRow = pingEl.querySelector(".ping-val-row");
  let lossRow = pingEl.querySelector(".loss-val-row");

  if (!pingRow || !lossRow) {
    pingEl.innerHTML = `
      <span class="ping-val-row"><span class="ping-ms">-- ms</span></span>
      <span class="loss-val-row"><span class="loss-pct">0.0%</span></span>
    `;
    pingRow = pingEl.querySelector(".ping-val-row");
    lossRow = pingEl.querySelector(".loss-val-row");
  }

  const msEl = pingRow ? (pingRow.querySelector(".ping-ms") || pingRow) : null;
  const pctEl = lossRow ? (lossRow.querySelector(".loss-pct") || lossRow) : null;

  const ms = (latencyMs !== null && latencyMs !== undefined && !isNaN(Number(latencyMs))) ? Math.round(Number(latencyMs)) : null;
  const isOffline = Boolean(lossInfo && lossInfo.isOffline);

  if (msEl && pingRow) {
    pingRow.className = "ping-val-row";
    if (isOffline) {
      msEl.textContent = (typeof window !== "undefined" && window.t) ? window.t("ping.offline") : "OFFLINE";
      pingRow.classList.add("ping-offline");
    } else if (ms !== null) {
      msEl.textContent = `${ms} ${((typeof window !== "undefined" && window.t) ? window.t("ping.unit_ms") : "ms")}`;
      const col = (mode === "client") ? getClientPingColor(ms) : getPingColor(ms);
      if (col === "#22c55e" || col === "#84cc16") {
        pingRow.classList.add("ping-good");
      } else if (col === "#eab308") {
        pingRow.classList.add("ping-warn");
      } else {
        pingRow.classList.add("ping-poor");
      }
    } else {
      msEl.textContent = "-- ms";
    }
  }

  if (pctEl && lossRow) {
    lossRow.className = "loss-val-row";
    if (isOffline) {
      pctEl.textContent = "--";
      lossRow.classList.add("loss-offline");
    } else if (lossInfo && lossInfo.lossPercent !== undefined && lossInfo.lossPercent !== null) {
      const pct = Number(lossInfo.lossPercent);
      pctEl.textContent = `${pct.toFixed(1)}%`;
      if (pct > 5.0 || (ms === null && !isOffline)) {
        lossRow.classList.add("loss-poor");
      } else if (pct > 1.0) {
        lossRow.classList.add("loss-warn");
      }
    } else {
      pctEl.textContent = "0.0%";
    }
  }

  const targetLabel = (mode === "client") ? "Client ↔ ProxDMR" : "BM";
  const pingStr = (ms !== null) ? `${ms} ${((typeof window !== "undefined" && window.t) ? window.t("ping.unit_ms") : "ms")}` : ((typeof window !== "undefined" && window.t) ? window.t("ping.no_data") : "нет данных");
  const lossDisplay = isOffline ? "--" : ((lossInfo && lossInfo.lossPercent !== undefined && lossInfo.lossPercent !== null) ? Number(lossInfo.lossPercent).toFixed(1) : "0.0");
  const scaleInfo = (lossInfo && lossInfo.scale) ? ` [${lossInfo.scale}]` : "";
  if (typeof window !== "undefined" && window.t) {
    pingEl.title = window.t("ping.title_tooltip", {
      target: targetLabel,
      ping: pingStr,
      loss: lossDisplay + "%" + scaleInfo
    });
  } else {
    pingEl.title = `${targetLabel}${scaleInfo}: пинг ${pingStr}, потери ${lossDisplay}% (кликните по графику для смены режима)`;
  }
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.resolveHotspotId = resolveHotspotId;
  window.loadCardPingHistory = loadCardPingHistory;
  window.saveCardPingHistory = saveCardPingHistory;
  window.getHotspotPingMode = getHotspotPingMode;
  window.setHotspotPingMode = setHotspotPingMode;
  window.toggleHotspotPingMode = toggleHotspotPingMode;
  window.getHotspotPingScale = getHotspotPingScale;
  window.setHotspotPingScale = setHotspotPingScale;
  window.cycleHotspotPingScale = cycleHotspotPingScale;
  window.cyclePingScale = cyclePingScale;
  window.getPingColor = getPingColor;
  window.getClientPingColor = getClientPingColor;
  window.renderCardPingSparkline = renderCardPingSparkline;
  window.getCardPingDisplayMode = getCardPingDisplayMode;
  window.setCardPingDisplayMode = setCardPingDisplayMode;
  window.calculateCardPacketLoss = calculateCardPacketLoss;
  window.calculateClientPacketLoss = calculateClientPacketLoss;
  window.updatePingElement = updatePingElement;
  window.cardPingHistories = cardPingHistories;
  window.bmPingHistory = bmPingHistory;
  window.cachedBmHostPings = cachedBmHostPings;
  window.cachedBmLosses = cachedBmLosses;
  window.cachedBmHostLosses = cachedBmHostLosses;
  window.PING_SCALE_HOURS = PING_SCALE_HOURS;
  window.CLIENT_PING_SCALE_HOURS = CLIENT_PING_SCALE_HOURS;

  window.__proxdmr = window.__proxdmr || {};
  Object.assign(window.__proxdmr, {
    loadCardPingHistory,
    saveCardPingHistory,
    getHotspotPingMode,
    setHotspotPingMode,
    toggleHotspotPingMode,
    getHotspotPingScale,
    setHotspotPingScale,
    cycleHotspotPingScale,
    cyclePingScale,
    getPingColor,
    getClientPingColor,
    generateSparklineGradientStops,
    decimatePingPoints,
    renderCardPingSparkline,
    getCardPingDisplayMode,
    setCardPingDisplayMode,
    calculateCardPacketLoss,
    calculateClientPacketLoss,
    updatePingElement,
    getPings: () => ({
      cachedBmPings: (typeof window !== "undefined" && window.cachedBmPings) || {},
      cachedBmHostPings: (typeof window !== "undefined" && window.cachedBmHostPings) || cachedBmHostPings
    })
  });
}
