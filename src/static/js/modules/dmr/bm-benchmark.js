/**
 * ProxDMR - Multi-Network DMR Server Benchmark Subsystem (modules/dmr/bm-benchmark.js)
 * Manages latency & packet loss testing against DMR servers (BrandMeister, FreeDMR, TGIF, DMR+, XLX),
 * renders benchmark results table, and handles server selection/migration.
 */

import { safeEscapeHtml, isoToEmoji, getLocalizedCountryName } from '../core/formatters.js?v=2.9.712';
import { showToast } from '../core/toast.js?v=2.9.699';
import { pushNavState, notifyNavClosed } from '../ui/navigation.js?v=2.9.614';
import { ws } from '../network/ws.js?v=2.9.752';

// Accessors for app functions and state
const resolveHotspotId = (id) => (window.resolveHotspotId ? window.resolveHotspotId(id) : id);
const getActiveHotspotId = () => (typeof window !== "undefined" && window.activeHotspotId) || null;
const getCurrentHotspots = () => (typeof window !== "undefined" && window.currentHotspots) || [];
const updateBmStatus = (st, dt, hid) => { if (window.updateBmStatus) window.updateBmStatus(st, dt, hid); };
const refreshAllCardsBmBanner = () => { if (window.refreshAllCardsBmBanner) window.refreshAllCardsBmBanner(); };
const renderHotspotsList = () => { if (window.renderHotspotsList) window.renderHotspotsList(); };
const renderHotspotSelect = () => { if (window.renderHotspotSelect) window.renderHotspotSelect(); };
const renderBmMastersDropdown = (host) => { if (window.renderBmMastersDropdown) window.renderBmMastersDropdown(host); };
const renderCardPingSparkline = (card, host) => { if (window.renderCardPingSparkline) window.renderCardPingSparkline(card, host); };
const loadCardPingHistory = (cid) => (window.loadCardPingHistory ? window.loadCardPingHistory(cid) : []);
const saveCardPingHistory = (cid) => { if (window.saveCardPingHistory) window.saveCardPingHistory(cid); };

// State variables
let activeBenchmarkHotspotId = null;
let cachedBenchmarkResults = null;
let isBenchmarkRunning = false;
let currentBenchmarkNetworkType = "bm";

const bmBenchmarkModal = document.getElementById("bmBenchmarkModal");
const closeBmBenchmarkModalBtn = document.getElementById("closeBmBenchmarkModalBtn");
const btnCloseBmBenchmarkModal = document.getElementById("btnCloseBmBenchmarkModal");
const btnBmBenchStart = document.getElementById("btnBmBenchStart");
const btnBmBenchStop = document.getElementById("btnBmBenchStop");
const bmBenchStatusBadge = document.getElementById("bmBenchStatusBadge");
const bmBenchCounter = document.getElementById("bmBenchCounter");
const bmBenchCurrentFlag = document.getElementById("bmBenchCurrentFlag");
const bmBenchCurrentName = document.getElementById("bmBenchCurrentName");
const bmBenchCurrentPing = document.getElementById("bmBenchCurrentPing");
const bmBenchCurrentPackets = document.getElementById("bmBenchCurrentPackets");
const bmBenchBarFill = document.getElementById("bmBenchBarFill");
const bmBenchBarPercent = document.getElementById("bmBenchBarPercent");
const bmBenchResultsCount = document.getElementById("bmBenchResultsCount");
const bmBenchTableBody = document.getElementById("bmBenchTableBody");

export function getCurrentBenchmarkNetworkType() {
  return currentBenchmarkNetworkType;
}

export function setBenchmarkRunningUI(running) {
  isBenchmarkRunning = running;
  if (btnBmBenchStart) btnBmBenchStart.style.display = running ? "none" : "inline-flex";
  if (btnBmBenchStop) btnBmBenchStop.style.display = running ? "inline-flex" : "none";
  if (bmBenchStatusBadge) {
    if (running) {
      bmBenchStatusBadge.textContent = (window.t ? window.t("bm_bench.testing", {}, "Тестирование...") : "Тестирование...");
      bmBenchStatusBadge.className = "badge-status-pill badge-active";
    } else {
      const hasResults = Boolean(cachedBenchmarkResults && cachedBenchmarkResults.length > 0);
      bmBenchStatusBadge.textContent = hasResults
        ? (window.t ? window.t("bm.bench_status_done", {}, "Завершено") : "Завершено")
        : (window.t ? window.t("bm_bench.idle", {}, "Ожидание") : "Ожидание");
      bmBenchStatusBadge.className = "badge-status-pill badge-idle";
    }
  }
}

function updateBenchmarkModalHeaders(netType) {
  const modal = document.getElementById("bmBenchmarkModal");
  if (!modal) return;
  const titleEl = modal.querySelector(".modal-title-with-badge h3") || document.getElementById("bmBenchmarkModalTitle");
  const subtitleEl = modal.querySelector(".modal-subtitle") || document.getElementById("bmBenchmarkModalSubtitle");
  const thServerEl = modal.querySelector(".bm-bench-table thead tr th:nth-child(2)");
  const resultsHintEl = modal.querySelector(".bm-bench-results-hint");

  const net = (netType || "bm").toLowerCase();
  let titleKey = `server_probe.title_${net}`;
  let defaultTitle = "⚡ Server Probe";
  let defaultSubtitle = window.t
    ? window.t("bm_bench.modal_subtitle", {}, "Ping test of servers to choose the best connection")
    : "Ping test of servers to choose the best connection";
  let thKey = `server_probe.th_server_${net}`;
  let defaultThText = "Server";

  let hintKey = "bm_bench.results_hint";
  let defaultHint = "Sorted from lowest to highest ping";

  if (net === "bm") {
    defaultTitle = "⚡ BrandMeister Server Benchmark";
    defaultSubtitle = window.t
      ? window.t("bm_bench.modal_subtitle_bm", {}, "Ping test of all BM masters (up to 10 packets or 7s) to choose the best")
      : "Ping test of all BM masters (up to 10 packets or 7s) to choose the best";
    defaultThText = "BrandMeister Server";
    hintKey = "bm_bench.results_hint";
    defaultHint = "Sorted from lowest to highest ping";
  } else if (net === "freedmr") {
    defaultTitle = "⚡ FreeDMR Server Benchmark";
    defaultSubtitle = window.t
      ? window.t("server_probe.subtitle_freedmr", {}, "UDP handshake test of FreeDMR servers (port 62031) to choose the best")
      : "UDP handshake test of FreeDMR servers (port 62031) to choose the best";
    defaultThText = "FreeDMR Server";
    hintKey = "server_probe.results_hint_freedmr";
    defaultHint = "UDP handshake test of FreeDMR servers (port 62031). Sorted by latency.";
  } else if (net === "tgif") {
    defaultTitle = "⚡ TGIF Server Benchmark";
    defaultSubtitle = window.t
      ? window.t("server_probe.subtitle_tgif", {}, "UDP handshake test of TGIF Network servers (port 62031)")
      : "UDP handshake test of TGIF Network servers (port 62031)";
    defaultThText = "TGIF Server";
    hintKey = "server_probe.results_hint_tgif";
    defaultHint = "UDP handshake test of TGIF servers (port 62031). Sorted by latency.";
  } else if (net === "dmrplus") {
    defaultTitle = "⚡ DMR+ (IPSC2) Server Benchmark";
    defaultSubtitle = window.t
      ? window.t("server_probe.subtitle_dmrplus", {}, "Ping test of DMR+ IPSC2 masters (port 62031)")
      : "Ping test of DMR+ IPSC2 masters (port 62031)";
    defaultThText = "DMR+ Master";
    hintKey = "server_probe.results_hint_dmrplus";
    defaultHint = "Ping test of DMR+ IPSC2 masters (port 62031). Sorted by latency.";
  } else if (net === "xlx") {
    defaultTitle = "⚡ XLX Reflector Benchmark";
    defaultSubtitle = window.t
      ? window.t("server_probe.subtitle_xlx", {}, "Ping test of XLX reflectors (port 62030)")
      : "Ping test of XLX reflectors (port 62030)";
    defaultThText = "XLX Reflector";
    hintKey = "server_probe.results_hint_xlx";
    defaultHint = "Ping test of XLX reflectors (port 62030). Sorted by latency.";
  } else if (net === "adn") {
    defaultTitle = "⚡ ADN Server Benchmark";
    defaultSubtitle = window.t
      ? window.t("server_probe.subtitle_adn", {}, "UDP handshake test of Amateur Digital Network servers (port 62031)")
      : "UDP handshake test of Amateur Digital Network servers (port 62031)";
    defaultThText = "ADN Server";
    hintKey = "server_probe.results_hint_adn";
    defaultHint = "UDP handshake test of ADN servers (port 62031). Sorted by latency.";
  } else if (net === "ysf") {
    defaultTitle = "⚡ YSF Reflector Benchmark";
    defaultSubtitle = window.t
      ? window.t("server_probe.subtitle_ysf", {}, "UDP handshake test of Yaesu System Fusion reflectors (port 42000)")
      : "UDP handshake test of Yaesu System Fusion reflectors (port 42000)";
    defaultThText = "YSF Reflector";
    hintKey = "server_probe.results_hint_ysf";
    defaultHint = "UDP handshake test of YSF reflectors (port 42000). Sorted by latency.";
  }

  if (titleEl) {
    titleEl.textContent = window.t ? window.t(titleKey, {}, defaultTitle) : defaultTitle;
  }
  if (subtitleEl) {
    subtitleEl.textContent = defaultSubtitle;
  }
  if (thServerEl) {
    thServerEl.textContent = window.t ? window.t(thKey, {}, defaultThText) : defaultThText;
  }
  if (resultsHintEl) {
    resultsHintEl.setAttribute("data-i18n", hintKey);
    resultsHintEl.textContent = (window.t && hintKey) ? window.t(hintKey, {}, defaultHint) : defaultHint;
  }
}

export function openBmBenchmarkModal(targetHotspotId = null, networkType = null) {
  if (!targetHotspotId) {
    const settingsModal = document.getElementById("settingsModal");
    const tabEditHs = document.getElementById("tab-edit-hs");
    const editHsIdEl = document.getElementById("editHsId");
    if (settingsModal && settingsModal.classList.contains("active") && tabEditHs && tabEditHs.classList.contains("active")) {
      if (editHsIdEl && editHsIdEl.value) {
        targetHotspotId = editHsIdEl.value;
      }
    }
  }
  activeBenchmarkHotspotId = targetHotspotId || getActiveHotspotId();

  // Determine target network type
  if (!networkType) {
    const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
    const hs = curHsList.find(h => h && h.id === activeBenchmarkHotspotId);
    const editHsNetworkType = document.getElementById("editHsNetworkType");
    networkType = (hs && hs.network_type) || (editHsNetworkType ? editHsNetworkType.value : "bm") || "bm";
  }
  currentBenchmarkNetworkType = String(networkType || "bm").trim().toLowerCase();

  updateBenchmarkModalHeaders(currentBenchmarkNetworkType);

  if (bmBenchmarkModal) {
    bmBenchmarkModal.classList.add("active");
    if (typeof pushNavState === "function") pushNavState("modal", "bmBenchmarkModal");
  }

  if (currentBenchmarkNetworkType === "bm") {
    if (cachedBenchmarkResults && Array.isArray(cachedBenchmarkResults) && cachedBenchmarkResults.length > 0) {
      renderBmBenchmarkTable(cachedBenchmarkResults);
      if (bmBenchResultsCount) bmBenchResultsCount.textContent = window.t ? window.t("bm_bench.servers_count", { count: cachedBenchmarkResults.length }, `${cachedBenchmarkResults.length} серверов`) : `${cachedBenchmarkResults.length} серверов`;
    } else {
      fetch("/api/bm/benchmark/results")
        .then(r => r.json())
        .then(data => {
          if (data && Array.isArray(data.results) && data.results.length > 0) {
            cachedBenchmarkResults = data.results;
            renderBmBenchmarkTable(data.results);
            if (bmBenchResultsCount) bmBenchResultsCount.textContent = window.t ? window.t("bm_bench.servers_count", { count: data.results.length }, `${data.results.length} серверов`) : `${data.results.length} серверов`;
          }
          if (data && data.running) {
            setBenchmarkRunningUI(true);
          }
        })
        .catch(e => console.debug("[BENCH] Error loading cached benchmark results:", e));
    }
  } else {
    // Non-BM networks query unified server probe results
    fetch(`/api/servers/probe/results?network_type=${encodeURIComponent(currentBenchmarkNetworkType)}`)
      .then(r => r.json())
      .then(data => {
        const list = (data && Array.isArray(data.results)) ? data.results : [];
        if (list.length > 0) {
          cachedBenchmarkResults = list;
          renderBmBenchmarkTable(list);
          if (bmBenchResultsCount) bmBenchResultsCount.textContent = window.t ? window.t("bm_bench.servers_count", { count: list.length }, `${list.length} серверов`) : `${list.length} серверов`;
        } else {
          // If no cached probe results yet, load default catalog for this network
          fetch(`/api/dmr/servers?network_type=${encodeURIComponent(currentBenchmarkNetworkType)}`)
            .then(r2 => r2.json())
            .then(d2 => {
              const base = (d2 && Array.isArray(d2.servers)) ? d2.servers : [];
              cachedBenchmarkResults = base;
              renderBmBenchmarkTable(base);
              if (bmBenchResultsCount) {
                bmBenchResultsCount.textContent = window.t
                  ? window.t("bm_bench.servers_count", { count: base.length }, `${base.length} серверов`)
                  : `${base.length} серверов`;
              }
            })
            .catch(() => {});
        }
        if (data && data.running) {
          setBenchmarkRunningUI(true);
        }
      })
      .catch(e => console.debug("[BENCH] Error loading server probe results:", e));
  }

  setBenchmarkRunningUI(isBenchmarkRunning);
}

export function closeBmBenchmarkModal() {
  if (bmBenchmarkModal && bmBenchmarkModal.classList.contains("active")) {
    bmBenchmarkModal.classList.remove("active");
    if (typeof notifyNavClosed === "function") notifyNavClosed();
  }
  if (typeof refreshAllCardsBmBanner === "function") refreshAllCardsBmBanner();
  const editHsHost = document.getElementById("editHsHost");
  const editHsNetworkType = document.getElementById("editHsNetworkType");
  const curNet = (editHsNetworkType ? editHsNetworkType.value : "bm") || "bm";
  if (typeof renderBmMastersDropdown === "function") {
    renderBmMastersDropdown(editHsHost ? editHsHost.value : "", curNet);
  }
}

export function startBmBenchmark() {
  if (isBenchmarkRunning) return;
  setBenchmarkRunningUI(true);
  const msUnit = window.t ? window.t("ping.unit_ms", {}, "мс") : "мс";
  if (bmBenchBarFill) bmBenchBarFill.style.width = "0%";
  if (bmBenchBarPercent) bmBenchBarPercent.textContent = "0%";
  if (bmBenchCounter) bmBenchCounter.textContent = window.t ? window.t("bm_bench.starting", {}, "Запуск...") : "Запуск...";
  if (bmBenchCurrentName) bmBenchCurrentName.textContent = window.t ? window.t("bm_bench.preparing", {}, "Подготовка списка серверов...") : "Подготовка списка серверов...";
  if (bmBenchCurrentFlag) bmBenchCurrentFlag.textContent = "⚡";
  if (bmBenchCurrentPing) bmBenchCurrentPing.textContent = `-- ${msUnit}`;
  if (bmBenchCurrentPackets) bmBenchCurrentPackets.textContent = "0 / 4";

  if (currentBenchmarkNetworkType === "bm") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "start_bm_benchmark" }));
    } else {
      fetch("/api/bm/benchmark/start", { method: "POST" })
        .catch(e => console.error("[BENCH] Error starting BM benchmark via REST:", e));
    }
  } else {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "start_server_probe", network_type: currentBenchmarkNetworkType }));
    } else {
      fetch("/api/servers/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_type: currentBenchmarkNetworkType })
      }).catch(e => console.error("[BENCH] Error starting probe via REST:", e));
    }
  }
}

export function cancelBmBenchmark() {
  if (!isBenchmarkRunning) return;
  if (bmBenchStatusBadge) {
    bmBenchStatusBadge.textContent = (window.t ? window.t("bm_bench.stopping", {}, "Остановка...") : "Остановка...");
    bmBenchStatusBadge.className = "badge-status-pill badge-warning";
  }
  if (currentBenchmarkNetworkType === "bm") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "cancel_bm_benchmark" }));
    } else {
      fetch("/api/bm/benchmark/cancel", { method: "POST" })
        .catch(e => console.error("[BENCH] Error cancelling benchmark via REST:", e));
    }
  } else {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "cancel_server_probe", network_type: currentBenchmarkNetworkType }));
    } else {
      fetch("/api/servers/probe/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network_type: currentBenchmarkNetworkType })
      }).catch(e => console.error("[BENCH] Error cancelling probe via REST:", e));
    }
  }
}

export function handleBmBenchmarkProgress(msg) {
  if (currentBenchmarkNetworkType !== "bm") return;
  isBenchmarkRunning = true;
  setBenchmarkRunningUI(true);

  const cur = msg.current_index || 0;
  const total = msg.total_servers || 0;
  const pct = msg.percent !== undefined ? msg.percent : (msg.progress_percent !== undefined ? msg.progress_percent : (total > 0 ? Math.round((cur / total) * 100) : 0));

  if (bmBenchCounter) {
    bmBenchCounter.textContent = window.t ? window.t("bm_bench.packets_counter", { recv: cur, sent: total }, `${cur} / ${total}`) : `${cur} / ${total}`;
  }
  if (bmBenchBarFill) bmBenchBarFill.style.width = `${pct}%`;
  if (bmBenchBarPercent) bmBenchBarPercent.textContent = `${pct}%`;

  const srv = msg.current_server || msg.server;
  if (srv) {
    const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
    const cCode = srv.country_code || (srv.country ? srv.country.substring(0, 2).toUpperCase() : "");
    const cName = getLocalizedCountryName(cCode, srv.country_name || srv.country || "BM", curLang);
    const flag = srv.flag || (cCode ? isoToEmoji(cCode) : "") || "🌐";
    const bmId = srv.id ? `BM ${srv.id}` : "";
    const srvTitle = bmId ? `${cName} (${bmId})` : cName;
    if (bmBenchCurrentName) bmBenchCurrentName.textContent = srvTitle;
    if (bmBenchCurrentFlag) bmBenchCurrentFlag.textContent = flag;
  }

  const livePing = (msg.current_ping !== undefined) ? msg.current_ping : msg.current_avg_ping;
  const msUnit = window.t ? window.t("ping.unit_ms", {}, "мс") : "мс";
  if (bmBenchCurrentPing) {
    if (livePing !== null && livePing !== undefined) {
      bmBenchCurrentPing.textContent = `${livePing} ${msUnit}`;
    } else {
      bmBenchCurrentPing.textContent = `-- ${msUnit}`;
    }
  }

  if (bmBenchCurrentPackets) {
    const sent = msg.packets_sent || 0;
    const recv = msg.packets_recv || 0;
    bmBenchCurrentPackets.textContent = window.t ? window.t("bm_bench.packets_counter", { recv, sent: sent || 10 }, `${recv} из ${sent || 10}`) : `${recv} из ${sent || 10}`;
  }

  if (msg.results_so_far && Array.isArray(msg.results_so_far) && msg.results_so_far.length > 0) {
    cachedBenchmarkResults = msg.results_so_far;
    renderBmBenchmarkTable(msg.results_so_far);
    if (bmBenchResultsCount) bmBenchResultsCount.textContent = window.t ? window.t("bm_bench.servers_tested", { count: msg.results_so_far.length }, `${msg.results_so_far.length} проверено`) : `${msg.results_so_far.length} проверено`;
  }
}

export function handleBmBenchmarkComplete(msg) {
  if (window.onServerProbeComplete) {
    try { window.onServerProbeComplete({ ...msg, network_type: "bm" }); } catch (e) {}
  }

  if (currentBenchmarkNetworkType !== "bm") return;
  isBenchmarkRunning = false;
  setBenchmarkRunningUI(false);

  if (bmBenchBarFill) bmBenchBarFill.style.width = "100%";
  if (bmBenchBarPercent) bmBenchBarPercent.textContent = "100%";

  if (msg.results && Array.isArray(msg.results)) {
    window._dmrServersCache = window._dmrServersCache || {};
    window._dmrServersCache["bm"] = msg.results;
    window._dmrServersCacheVer = Date.now();
    cachedBenchmarkResults = msg.results;
    renderBmBenchmarkTable(msg.results);
    if (bmBenchResultsCount) bmBenchResultsCount.textContent = window.t ? window.t("bm_bench.servers_count", { count: msg.results.length }, `${msg.results.length} серверов`) : `${msg.results.length} серверов`;
    if (typeof refreshAllCardsBmBanner === "function") refreshAllCardsBmBanner();
    const editHsHost = document.getElementById("editHsHost");
    if (typeof renderBmMastersDropdown === "function") renderBmMastersDropdown(editHsHost ? editHsHost.value : "", "bm");
  }

  if (msg.cancelled) {
    if (bmBenchStatusBadge) {
      bmBenchStatusBadge.textContent = (window.t ? window.t("bm_bench.stopped", {}, "Остановлен") : "Остановлен");
      bmBenchStatusBadge.className = "badge-status-pill badge-warning";
    }
    if (bmBenchCurrentName) bmBenchCurrentName.textContent = (window.t ? window.t("bm_bench.stopped_by_user", {}, "Тест остановлен пользователем") : "Тест остановлен пользователем");
  } else {
    if (bmBenchStatusBadge) {
      bmBenchStatusBadge.textContent = (window.t ? window.t("bm_bench.completed", {}, "Завершен") : "Завершен");
      bmBenchStatusBadge.className = "badge-status-pill badge-success";
    }
    if (bmBenchCurrentName) bmBenchCurrentName.textContent = (window.t ? window.t("bm_bench.all_completed", {}, "Тест всех серверов завершен") : "Тест всех серверов завершен");
    if (bmBenchCurrentFlag) bmBenchCurrentFlag.textContent = "✅";
  }
}

export function handleServerProbeProgress(msg) {
  if (!msg) return;
  const net = (msg.network_type || "").toLowerCase();
  if (net !== currentBenchmarkNetworkType) return;

  isBenchmarkRunning = true;
  setBenchmarkRunningUI(true);

  const cur = msg.current_index || 0;
  const total = msg.total_servers || 0;
  const pct = msg.percent !== undefined ? msg.percent : (total > 0 ? Math.round((cur / total) * 100) : 0);

  if (bmBenchCounter) {
    bmBenchCounter.textContent = `${cur} / ${total}`;
  }
  if (bmBenchBarFill) bmBenchBarFill.style.width = `${pct}%`;
  if (bmBenchBarPercent) bmBenchBarPercent.textContent = `${pct}%`;

  const srv = msg.current_server;
  if (srv) {
    const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
    let cCode = srv.country_code || (srv.country ? srv.country.substring(0, 2).toUpperCase() : "");
    let refName = (srv.reflector_name || "").trim();
    const rawName = (srv.name || "").trim();

    if (net === "ysf") {
      if (!refName || !cCode || cCode === "GLOBAL") {
        const match = rawName.match(/^([A-Za-z]{2})[-_ ]\s*(.*)$/);
        if (match) {
          if (!cCode || cCode === "GLOBAL") cCode = match[1].toUpperCase();
          if (!refName) refName = match[2].trim();
        }
      }
      if (!cCode) cCode = "XX";
    }

    const isGlobalOrXx = !cCode || cCode === "GLOBAL" || cCode === "XX";
    const flag = srv.flag || (!isGlobalOrXx ? isoToEmoji(cCode) : "🌐");
    const cName = getLocalizedCountryName(cCode, srv.country_name || srv.country || "DMR", curLang);

    let srvTitle = "";
    if (net === "ysf") {
      const localizedCountry = !isGlobalOrXx
        ? getLocalizedCountryName(cCode, cCode, curLang)
        : (window.t ? window.t("countries.GLOBAL", {}, "International") : "International");
      const targetName = refName || localizedCountry;
      const idTag = srv.id ? ` #${srv.id}` : "";
      srvTitle = `${cCode} ${targetName}${idTag} (${srv.host || ""})`;
    } else {
      srvTitle = srv.name || `${cName} (${srv.host})`;
    }

    if (bmBenchCurrentName) bmBenchCurrentName.textContent = srvTitle;
    if (bmBenchCurrentFlag) bmBenchCurrentFlag.textContent = flag;

    const livePing = (srv.udp_ms !== undefined && srv.udp_ms !== null) ? srv.udp_ms : srv.avg_ping;
    const msUnit = window.t ? window.t("ping.unit_ms", {}, "мс") : "мс";
    if (bmBenchCurrentPing) {
      if (livePing !== null && livePing !== undefined) {
        bmBenchCurrentPing.textContent = `${Math.round(livePing)} ${msUnit}`;
      } else {
        bmBenchCurrentPing.textContent = `-- ${msUnit}`;
      }
    }

    if (bmBenchCurrentPackets) {
      const sRecv = srv.recv || 0;
      const sSent = srv.sent || 4;
      bmBenchCurrentPackets.textContent = window.t
        ? window.t("bm_bench.packets_counter", { recv: sRecv, sent: sSent }, `${sRecv} из ${sSent}`)
        : `${sRecv} из ${sSent}`;
    }
  }

  if (msg.results_so_far && Array.isArray(msg.results_so_far)) {
    cachedBenchmarkResults = msg.results_so_far;
    renderBmBenchmarkTable(msg.results_so_far);
    if (bmBenchResultsCount) {
      bmBenchResultsCount.textContent = window.t
        ? window.t("bm_bench.servers_tested", { count: msg.results_so_far.length }, `${msg.results_so_far.length} проверено`)
        : `${msg.results_so_far.length} проверено`;
    }
  }
}

export function handleServerProbeComplete(msg) {
  if (!msg) return;
  if (window.onServerProbeComplete) {
    try { window.onServerProbeComplete(msg); } catch (e) {}
  }

  const net = (msg.network_type || "").toLowerCase();
  if (net !== currentBenchmarkNetworkType) return;

  isBenchmarkRunning = false;
  setBenchmarkRunningUI(false);

  if (bmBenchBarFill) bmBenchBarFill.style.width = "100%";
  if (bmBenchBarPercent) bmBenchBarPercent.textContent = "100%";

  if (msg.results && Array.isArray(msg.results)) {
    window._dmrServersCache = window._dmrServersCache || {};
    window._dmrServersCache[net] = msg.results;
    window._dmrServersCacheVer = Date.now();
    cachedBenchmarkResults = msg.results;
    renderBmBenchmarkTable(msg.results);
    if (bmBenchResultsCount) {
      bmBenchResultsCount.textContent = window.t
        ? window.t("bm_bench.servers_count", { count: msg.results.length }, `${msg.results.length} серверов`)
        : `${msg.results.length} серверов`;
    }
    if (typeof refreshAllCardsBmBanner === "function") refreshAllCardsBmBanner();
    const editHsHost = document.getElementById("editHsHost");
    if (typeof renderBmMastersDropdown === "function") renderBmMastersDropdown(editHsHost ? editHsHost.value : "", net);
  }

  if (msg.cancelled) {
    if (bmBenchStatusBadge) {
      bmBenchStatusBadge.textContent = window.t ? window.t("bm_bench.stopped", {}, "Остановлен") : "Остановлен";
      bmBenchStatusBadge.className = "badge-status-pill badge-warning";
    }
    if (bmBenchCurrentName) bmBenchCurrentName.textContent = window.t ? window.t("bm_bench.stopped_by_user", {}, "Тест остановлен пользователем") : "Тест остановлен пользователем";
  } else {
    if (bmBenchStatusBadge) {
      bmBenchStatusBadge.textContent = window.t ? window.t("bm_bench.completed", {}, "Завершен") : "Завершен";
      bmBenchStatusBadge.className = "badge-status-pill badge-success";
    }
    if (bmBenchCurrentName) bmBenchCurrentName.textContent = window.t ? window.t("bm_bench.all_completed", {}, "Тест всех серверов завершен") : "Тест всех серверов завершен";
    if (bmBenchCurrentFlag) bmBenchCurrentFlag.textContent = "✅";
  }
}

export function renderBmBenchmarkTable(results) {
  if (!bmBenchTableBody) return;
  if (!results || !results.length) {
    if (bmBenchResultsCount) {
      bmBenchResultsCount.textContent = window.t ? window.t("bm_bench.servers_count", { count: 0 }, "0 серверов") : "0 серверов";
    }
    bmBenchTableBody.innerHTML = `
      <tr class="bm-bench-empty-row">
        <td colspan="5" class="bm-bench-empty-cell">
          ${window.t ? window.t("bm_bench.not_run_yet", {}, "Тестирование еще не проводилось. Нажмите «Начать тест серверов».") : "Тестирование еще не проводилось. Нажмите «Начать тест серверов»."}
        </td>
      </tr>`;
    return;
  }
  if (bmBenchResultsCount) {
    bmBenchResultsCount.textContent = window.t
      ? window.t("bm_bench.servers_count", { count: results.length }, `${results.length} серверов`)
      : `${results.length} серверов`;
  }

  let activeHost = "";
  const settingsModal = document.getElementById("settingsModal");
  const tabEditHs = document.getElementById("tab-edit-hs");
  const editHsId = document.getElementById("editHsId");
  const editHsHost = document.getElementById("editHsHost");
  const isEditingInModal = Boolean(settingsModal && settingsModal.classList.contains("active") && tabEditHs && tabEditHs.classList.contains("active"));

  const cid = resolveHotspotId(activeBenchmarkHotspotId || (isEditingInModal && editHsId ? editHsId.value : null) || getActiveHotspotId() || (getCurrentHotspots()[0] ? getCurrentHotspots()[0].id : "default"));
  const hs = getCurrentHotspots().find(h => h.id === cid);

  if (isEditingInModal && editHsHost && editHsHost.value) {
    activeHost = editHsHost.value.trim().toLowerCase();
  } else if (hs && hs.bm_master_host) {
    activeHost = hs.bm_master_host.trim().toLowerCase();
  }

  const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || "ru";
  const msUnit = window.t ? window.t("ping.unit_ms", {}, "мс") : "мс";
  const selectLabel = window.t ? (window.t("bm.bench_btn_select") || window.t("buttons.select") || "Выбрать") : "Выбрать";
  const activeLabel = window.t ? window.t("bm_bench.status_active", {}, "Активен") : "Активен";
  const currentTagLabel = window.t ? window.t("bm_bench.status_current", {}, "Текущий") : "Текущий";
  const unreachableLabel = window.t ? window.t("server_probe.status_dead", {}, "НЕ ОТВЕЧАЕТ") : "НЕ ОТВЕЧАЕТ";
  const deadTitleLabel = window.t ? window.t("bm_bench.dead_title", {}, "Сервер не ответил на запросы") : "Сервер не ответил на запросы";

  let rowsHtml = "";
  results.forEach((r, idx) => {
    const isDead = (r.state in { "refused": 1, "no_reply": 1, "dns_fail": 1, "unreachable": 1 }) || (r.udp_ok === false && r.avg_ping == null);
    const isIcmpOnly = (r.state === "icmp_only");
    const pingNum = (r.udp_ms !== undefined && r.udp_ms !== null)
      ? r.udp_ms
      : ((r.avg_ping !== undefined && r.avg_ping !== null) ? r.avg_ping : null);
    const isReachable = (!isDead && pingNum !== null);

    let rankBadge = "";
    if (isReachable) {
      const rank = r.rank || (idx + 1);
      const r1Title = window.t ? window.t("bm_bench.rank1_title", {}, "1-е место (наименьший пинг)") : "1-е место (наименьший пинг)";
      const r2Title = window.t ? window.t("bm_bench.rank2_title", {}, "2-е место") : "2-е место";
      const r3Title = window.t ? window.t("bm_bench.rank3_title", {}, "3-е место") : "3-е место";
      if (rank === 1) rankBadge = `<span class="rank-badge rank-1" title="${safeEscapeHtml(r1Title)}">🥇</span>`;
      else if (rank === 2) rankBadge = `<span class="rank-badge rank-2" title="${safeEscapeHtml(r2Title)}">🥈</span>`;
      else if (rank === 3) rankBadge = `<span class="rank-badge rank-3" title="${safeEscapeHtml(r3Title)}">🥉</span>`;
      else rankBadge = `<span class="rank-badge rank-other">${rank}</span>`;
    } else {
      rankBadge = '<span class="rank-badge rank-other">-</span>';
    }

    const hostClean = (r.host || "").trim().toLowerCase();
    const ipClean = (r.ip || "").trim().toLowerCase();
    const isCurrentActive = Boolean(activeHost && (activeHost === hostClean || activeHost === ipClean));

    let cCode = r.country_code || (r.country ? r.country.substring(0, 2).toUpperCase() : "");
    let refName = (r.reflector_name || "").trim();
    const rawName = (r.name || "").trim();

    if (currentBenchmarkNetworkType === "ysf") {
      if (!refName || !cCode || cCode === "GLOBAL") {
        const match = rawName.match(/^([A-Za-z]{2})[-_ ]\s*(.*)$/);
        if (match) {
          if (!cCode || cCode === "GLOBAL") cCode = match[1].toUpperCase();
          if (!refName) refName = match[2].trim();
        }
      }
      if (!cCode) cCode = "XX";
    }

    const isGlobalOrXx = !cCode || cCode === "GLOBAL" || cCode === "XX";
    const flag = r.flag || (!isGlobalOrXx ? isoToEmoji(cCode) : "🌐");
    const cName = getLocalizedCountryName(cCode, r.country_name || r.country || "DMR", curLang);
    const bmId = (currentBenchmarkNetworkType === "bm" && r.id) ? `BM ${r.id}` : "";

    let cleanLabel = "";
    if (currentBenchmarkNetworkType === "ysf") {
      const localizedCountry = !isGlobalOrXx
        ? getLocalizedCountryName(cCode, cCode, curLang)
        : (window.t ? window.t("countries.GLOBAL", {}, "International") : "International");
      const targetName = refName || localizedCountry;
      const idTag = r.id ? ` #${r.id}` : "";
      cleanLabel = `${cCode} ${targetName}${idTag} (${r.host || ""})`;
    } else {
      let label = (cCode && cName)
        ? (bmId ? `${cName} (${bmId})` : (r.id ? `${cName} (${r.id})` : `${cName} (${r.host || ""})`))
        : (r.name || (r.host || ""));
      cleanLabel = (label || "").trim();
      if (flag && cleanLabel.startsWith(flag)) {
        cleanLabel = cleanLabel.substring(flag.length).trim();
      }
      cleanLabel = cleanLabel.replace(/^[^\w\s\u00C0-\u024F\u0400-\u04FF()[\]\u2014\u2013.:,-]+\s*/, "").trim();
      if (!cleanLabel) cleanLabel = label;
    }

    let pingBadge = "";
    if (isDead) {
      pingBadge = `<span class="bench-ping-pill ping-dead" style="color: #ef4444; font-weight: 600;" title="${safeEscapeHtml(r.detail || deadTitleLabel)}">🔴 ${unreachableLabel}</span>`;
    } else if (isIcmpOnly) {
      const icmpVal = r.icmp_ms || r.avg_ping || "--";
      const icmpTitle = window.t ? window.t("bm_bench.icmp_only_title", {}, "Только ICMP (UDP не ответил)") : "Только ICMP (UDP не ответил)";
      pingBadge = `<span class="bench-ping-pill ping-fair" style="color: #eab308;" title="${safeEscapeHtml(icmpTitle)}">🟡 ${icmpVal} ${msUnit}</span>`;
    } else if (pingNum !== null) {
      const rounded = Math.round(pingNum);
      if (rounded < 60) {
        pingBadge = `<span class="bench-ping-pill ping-fast">⚡ ${rounded} ${msUnit}</span>`;
      } else if (rounded < 120) {
        pingBadge = `<span class="bench-ping-pill ping-good">⚡ ${rounded} ${msUnit}</span>`;
      } else if (rounded < 200) {
        pingBadge = `<span class="bench-ping-pill ping-fair">⚡ ${rounded} ${msUnit}</span>`;
      } else {
        pingBadge = `<span class="bench-ping-pill ping-slow">⚡ ${rounded} ${msUnit}</span>`;
      }
    } else {
      pingBadge = `<span class="bench-ping-pill ping-dead">— ${msUnit}</span>`;
    }

    let lossBadge = "";
    const loss = r.loss_pct !== undefined ? r.loss_pct : (isReachable ? 0 : 100);
    if (loss === 0) {
      lossBadge = '<span class="bench-loss-pill loss-zero">0%</span>';
    } else {
      lossBadge = `<span class="bench-loss-pill loss-bad">${loss}%</span>`;
    }

    let actBtn = "";
    if (isCurrentActive) {
      actBtn = `<button type="button" class="btn-bench-select is-selected" disabled>${activeLabel}</button>`;
    } else {
      const escapedHost = safeEscapeHtml(r.host || "");
      const escapedPort = safeEscapeHtml(String(r.port || 62031));
      const escapedPwd = safeEscapeHtml(String(r.password || ""));
      const escapedTitle = safeEscapeHtml(`${flag} ${cleanLabel}`);
      actBtn = `<button type="button" class="btn-bench-select" data-bench-host="${escapedHost}" data-bench-port="${escapedPort}" data-bench-pwd="${escapedPwd}" data-bench-title="${escapedTitle}">${selectLabel}</button>`;
    }

    const deadRowClass = isDead ? 'bench-row-dead' : '';
    const activeRowClass = isCurrentActive ? 'bench-current-active' : '';
    const rowClass = [activeRowClass, deadRowClass].filter(Boolean).join(" ");
    const deadRowStyle = isDead ? 'style="background: rgba(239, 68, 68, 0.10);"' : '';
    const currentTag = isCurrentActive ? `<span class="bench-current-tag">${currentTagLabel}</span>` : '';

    rowsHtml += `
      <tr class="${rowClass}" ${deadRowStyle}>
        <td style="text-align: center;">${rankBadge}</td>
        <td>
          <div class="bench-server-cell">
            <span class="bench-server-flag">${flag}</span>
            <span class="bench-server-label" style="${isDead ? 'color: #ef4444;' : ''}">${safeEscapeHtml(cleanLabel)}</span>
            ${currentTag}
          </div>
        </td>
        <td style="text-align: right;">${pingBadge}</td>
        <td style="text-align: center;">${lossBadge}</td>
        <td style="text-align: center;">${actBtn}</td>
      </tr>
    `;
  });

  bmBenchTableBody.innerHTML = rowsHtml;

  bmBenchTableBody.querySelectorAll(".btn-bench-select:not(.is-selected)").forEach(btn => {
    btn.addEventListener("click", () => {
      const h = btn.getAttribute("data-bench-host");
      const p = btn.getAttribute("data-bench-port");
      const pwd = btn.getAttribute("data-bench-pwd");
      const t = btn.getAttribute("data-bench-title");
      if (h) {
        selectBmBenchmarkServer(h, t, p, pwd);
      }
    });
  });
}

export async function selectBmBenchmarkServer(serverHost, serverTitle, serverPort = null, serverPassword = null) {
  if (!serverHost) return;

  const settingsModal = document.getElementById("settingsModal");
  const tabEditHs = document.getElementById("tab-edit-hs");
  const editHsIdEl = document.getElementById("editHsId");
  const editHsHostEl = document.getElementById("editHsHost");
  const editHsPortEl = document.getElementById("editHsPort");
  const editHsPasswordEl = document.getElementById("editHsPassword");
  const isEditingInModal = Boolean(settingsModal && settingsModal.classList.contains("active") && tabEditHs && tabEditHs.classList.contains("active"));

  let targetId = activeBenchmarkHotspotId;
  if (!targetId && isEditingInModal && editHsIdEl && editHsIdEl.value) {
    targetId = editHsIdEl.value;
  }
  const curHsList = getCurrentHotspots();
  const curActiveId = getActiveHotspotId();
  const cid = resolveHotspotId(targetId || curActiveId || (curHsList && curHsList[0] ? curHsList[0].id : "default"));

  // 1. Update form inputs
  if (editHsHostEl) {
    if (isEditingInModal || !editHsIdEl || !editHsIdEl.value || editHsIdEl.value === cid) {
      editHsHostEl.value = serverHost;
      if (serverPort && editHsPortEl) editHsPortEl.value = serverPort;
      if (serverPassword && editHsPasswordEl) {
        const curPwd = (editHsPasswordEl.value || "").trim();
        if (!curPwd || curPwd === "passw0rd" || curPwd === "PASSWORD") {
          editHsPasswordEl.value = serverPassword;
        }
      }
      if (typeof renderBmMastersDropdown === "function") {
        renderBmMastersDropdown(serverHost, currentBenchmarkNetworkType);
      }
    }
  }

  // 2. Find target hotspot object
  let targetHs = curHsList ? curHsList.find(h => h.id === cid) : null;
  if (!targetHs && curHsList && curHsList.length > 0) {
    targetHs = curHsList[0];
  }

  if (targetHs) {
    targetHs.bm_master_host = serverHost;
    if (serverPort) targetHs.bm_master_port = parseInt(serverPort, 10) || targetHs.bm_master_port;
    if (serverPassword && (!targetHs.bm_password || targetHs.bm_password === "passw0rd" || targetHs.bm_password === "PASSWORD")) {
      targetHs.bm_password = serverPassword;
    }
    targetHs.isManualBmDisconnect = false;
  }
  if (cid === curActiveId || typeof window !== "undefined") {
    window.isManualBmDisconnect = false;
  }

  // 3. Status feedback
  updateBmStatus("connecting", window.t ? window.t("bm_bench.connecting_host", { host: serverHost }, `Подключение к ${serverHost}...`) : `Подключение к ${serverHost}...`, cid);

  const switchNow = Math.floor(Date.now() / 1000);
  const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
  if (card) {
    card._hostSwitchTime = switchNow;
    card._lastTrackedHost = serverHost;
  }
  localStorage.setItem(`proxdmr_host_switch_${cid}`, String(switchNow));
  localStorage.setItem(`proxdmr_host_name_${cid}`, serverHost);

  // 4. Save and reconnect on the backend (PUT /api/hotspots/{cid}?reconnect=1)
  try {
    const payload = {
      ...(targetHs || {}),
      id: cid,
      bm_master_host: serverHost,
      duplex: true
    };
    if (serverPort) payload.bm_master_port = parseInt(serverPort, 10);
    if (serverPassword) payload.bm_password = serverPassword;

    // If user edited fields in tab-edit-hs for this hotspot, merge them
    const editHsId = document.getElementById("editHsId");
    if (isEditingInModal && editHsId && editHsId.value === cid) {
      const editHsName = document.getElementById("editHsName");
      const editHsCallsign = document.getElementById("editHsCallsign");
      const editHsTalkerAlias = document.getElementById("editHsTalkerAlias");
      const editHsDmrId = document.getElementById("editHsDmrId");
      const editHsSsid = document.getElementById("editHsSsid");
      const editHsApiKey = document.getElementById("editHsApiKey");
      const editHsTgTs1 = document.getElementById("editHsTgTs1");
      const editHsTgTs2 = document.getElementById("editHsTgTs2");
      const editHsAutoconnect = document.getElementById("editHsAutoconnect");
      if (editHsName && editHsName.value) payload.name = editHsName.value.trim();
      if (editHsCallsign && editHsCallsign.value) payload.callsign = editHsCallsign.value.trim().toUpperCase();
      if (editHsTalkerAlias) payload.talker_alias = editHsTalkerAlias.value.trim();
      if (editHsDmrId && editHsDmrId.value) {
        const parsedId = parseInt(editHsDmrId.value, 10);
        if (!isNaN(parsedId)) payload.dmr_id = parsedId;
      }
      if (editHsSsid && editHsSsid.value !== "") {
        const parsedS = parseInt(editHsSsid.value, 10);
        if (!isNaN(parsedS)) payload.bm_ssid = Math.max(1, Math.min(99, parsedS));
      }
      if (editHsApiKey && editHsApiKey.value) payload.bm_api_key = editHsApiKey.value.trim();
      if (editHsTgTs1 && editHsTgTs1.value) payload.default_tg_ts1 = parseInt(editHsTgTs1.value, 10) || payload.default_tg_ts1;
      if (editHsTgTs2 && editHsTgTs2.value) payload.default_tg_ts2 = parseInt(editHsTgTs2.value, 10) || payload.default_tg_ts2;
      const editHsSendTalkerAlias = document.getElementById("editHsSendTalkerAlias");
      if (editHsSendTalkerAlias) payload.send_talker_alias = editHsSendTalkerAlias.checked;
      if (editHsAutoconnect) payload.autoconnect = editHsAutoconnect.checked;
      const editHsAutoTgBm = document.getElementById("editHsAutoTgBm");
      if (editHsAutoTgBm) payload.auto_tg_bm = editHsAutoTgBm.checked;
    }

    const resp = await fetch(`/api/hotspots/${cid}?reconnect=1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.hotspot && targetHs) {
        Object.assign(targetHs, data.hotspot);
      }
    }
  } catch (e) {
    console.error("[BENCH] Error switching server:", e);
  }

  // 5. Final UI refresh
  refreshAllCardsBmBanner();
  if (typeof renderHotspotsList === "function") {
    renderHotspotsList();
  }
  if (typeof renderHotspotSelect === "function") {
    renderHotspotSelect();
  }

  if (typeof showToast === "function") {
    showToast(window.t ? window.t("bm_bench.switched_toast", { server: serverTitle || serverHost }, `✓ Сервер переключен: ${serverTitle || serverHost}`) : `✓ Сервер переключен: ${serverTitle || serverHost}`, "success");
  }
  closeBmBenchmarkModal();
}

export async function testSingleCustomServer() {
  const editHsHost = document.getElementById("editHsHost");
  const editHsPort = document.getElementById("editHsPort");
  const host = editHsHost ? editHsHost.value.trim() : "";
  const port = parseInt(editHsPort ? editHsPort.value : 62031, 10) || 62031;
  if (!host) {
    if (typeof showToast === "function") showToast(window.t ? window.t("server_probe.enter_host_warn", {}, "Введите адрес сервера для проверки") : "Введите адрес сервера для проверки", "warning");
    return;
  }
  if (typeof showToast === "function") showToast(window.t ? window.t("server_probe.checking_host_info", { host, port }, `Проверка сервера ${host}:${port}...`) : `Проверка сервера ${host}:${port}...`, "info");
  try {
    await fetch("/api/servers/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        network_type: "custom",
        servers: [{ host, port, name: host }]
      })
    });
    // Give probe 2 seconds to complete
    await new Promise(r => setTimeout(r, 2200));
    const rRes = await fetch("/api/servers/probe/results?network_type=custom");
    const data = await rRes.json().catch(() => ({}));
    const srv = data && data.results && data.results[0];
    if (srv && srv.state === "online") {
      if (typeof showToast === "function") showToast(window.t ? window.t("server_probe.custom_online_toast", { ms: srv.udp_ms }, `🟢 Сервер доступен (${srv.udp_ms} мс)`) : `🟢 Сервер доступен (${srv.udp_ms} мс)`, "success");
    } else if (srv && srv.state === "icmp_only") {
      if (typeof showToast === "function") showToast(window.t ? window.t("server_probe.custom_icmp_toast", { ms: srv.icmp_ms }, `🟡 Только ICMP (${srv.icmp_ms} мс). UDP порт не ответил`) : `🟡 Только ICMP (${srv.icmp_ms} мс). UDP порт не ответил`, "warning");
    } else {
      const det = (srv && srv.detail) ? srv.detail : (window.t ? window.t("server_probe.no_reply_detail", {}, "Сервер не отвечает") : "Сервер не отвечает");
      if (typeof showToast === "function") showToast(`🔴 ${det}`, "error");
    }
  } catch (e) {
    if (typeof showToast === "function") showToast(window.t ? window.t("server_probe.check_err_toast", { error: e.message }, `🔴 Ошибка проверки: ${e.message}`) : `🔴 Ошибка проверки: ${e.message}`, "error");
  }
}

export function initBmBenchmark() {
  const closeBmBenchmarkModalBtn = document.getElementById("closeBmBenchmarkModalBtn");
  const btnCloseBmBenchmarkModal = document.getElementById("btnCloseBmBenchmarkModal");
  const bmBenchmarkModal = document.getElementById("bmBenchmarkModal");
  const btnBmBenchStart = document.getElementById("btnBmBenchStart");
  const btnBmBenchStop = document.getElementById("btnBmBenchStop");

  if (closeBmBenchmarkModalBtn && !closeBmBenchmarkModalBtn._wired) {
    closeBmBenchmarkModalBtn._wired = true;
    closeBmBenchmarkModalBtn.addEventListener("click", closeBmBenchmarkModal);
  }
  if (btnCloseBmBenchmarkModal && !btnCloseBmBenchmarkModal._wired) {
    btnCloseBmBenchmarkModal._wired = true;
    btnCloseBmBenchmarkModal.addEventListener("click", closeBmBenchmarkModal);
  }
  if (bmBenchmarkModal && !bmBenchmarkModal._wired) {
    bmBenchmarkModal._wired = true;
    bmBenchmarkModal.addEventListener("click", (e) => {
      if (e.target === bmBenchmarkModal) closeBmBenchmarkModal();
    });
  }
  if (btnBmBenchStart && !btnBmBenchStart._wired) {
    btnBmBenchStart._wired = true;
    btnBmBenchStart.addEventListener("click", () => {
      startBmBenchmark();
    });
  }
  if (btnBmBenchStop && !btnBmBenchStop._wired) {
    btnBmBenchStop._wired = true;
    btnBmBenchStop.addEventListener("click", () => {
      cancelBmBenchmark();
    });
  }

  if (!window._bmBenchLangListenerAttached) {
    window._bmBenchLangListenerAttached = true;
    window.addEventListener("languageChanged", () => {
      updateBenchmarkModalHeaders(currentBenchmarkNetworkType);
      setBenchmarkRunningUI(isBenchmarkRunning);
      if (cachedBenchmarkResults && cachedBenchmarkResults.length > 0) {
        renderBmBenchmarkTable(cachedBenchmarkResults);
        if (bmBenchResultsCount) {
          bmBenchResultsCount.textContent = window.t
            ? window.t("bm_bench.servers_count", { count: cachedBenchmarkResults.length }, `${cachedBenchmarkResults.length} серверов`)
            : `${cachedBenchmarkResults.length} серверов`;
        }
      }
      if (!isBenchmarkRunning && bmBenchCurrentPing && (bmBenchCurrentPing.textContent.includes("мс") || bmBenchCurrentPing.textContent.includes("ms"))) {
        const msUnit = window.t ? window.t("ping.unit_ms", {}, "мс") : "мс";
        bmBenchCurrentPing.textContent = `-- ${msUnit}`;
      }
    });
  }
}

// Global attachments
window.setBenchmarkRunningUI = setBenchmarkRunningUI;
window.openBmBenchmarkModal = openBmBenchmarkModal;
window.closeBmBenchmarkModal = closeBmBenchmarkModal;
window.startBmBenchmark = startBmBenchmark;
window.cancelBmBenchmark = cancelBmBenchmark;
window.handleBmBenchmarkProgress = handleBmBenchmarkProgress;
window.handleBmBenchmarkComplete = handleBmBenchmarkComplete;
window.handleServerProbeProgress = handleServerProbeProgress;
window.handleServerProbeComplete = handleServerProbeComplete;
window.renderBmBenchmarkTable = renderBmBenchmarkTable;
window.selectBmBenchmarkServer = selectBmBenchmarkServer;
window.testSingleCustomServer = testSingleCustomServer;
window.initBmBenchmark = initBmBenchmark;

window.__proxdmr = window.__proxdmr || {};
window.__proxdmr.openBmBenchmarkModal = openBmBenchmarkModal;
window.__proxdmr.closeBmBenchmarkModal = closeBmBenchmarkModal;
window.__proxdmr.startBmBenchmark = startBmBenchmark;
window.__proxdmr.cancelBmBenchmark = cancelBmBenchmark;
window.__proxdmr.initBmBenchmark = initBmBenchmark;
