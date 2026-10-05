/**
 * ProxDMR - BrandMeister Master Servers Benchmark Subsystem (modules/dmr/bm-benchmark.js)
 * Manages latency & packet loss testing against BrandMeister Master servers,
 * renders benchmark results table, and handles server selection/migration.
 */

import { safeEscapeHtml, isoToEmoji, getLocalizedCountryName } from '../core/formatters.js';
import { showToast } from '../core/toast.js';
import { pushNavState, notifyNavClosed } from '../ui/navigation.js';
import { ws } from '../network/ws.js';

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

  // BrandMeister Server Benchmark / Ping Test Controller
  // =========================================================================
  let activeBenchmarkHotspotId = null;
  let cachedBenchmarkResults = null;
  let isBenchmarkRunning = false;

  const bmBenchmarkModal = document.getElementById("bmBenchmarkModal");
  const closeBmBenchmarkModalBtn = document.getElementById("closeBmBenchmarkModalBtn");
  const btnCloseBmBenchmarkModal = document.getElementById("btnCloseBmBenchmarkModal");
  const btnTestBmServers = document.getElementById("btnTestBmServers");
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
export function openBmBenchmarkModal(targetHotspotId = null) {
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
    if (bmBenchmarkModal) {
      bmBenchmarkModal.classList.add("active");
      if (typeof pushNavState === "function") pushNavState("modal", "bmBenchmarkModal");
    }

    if (cachedBenchmarkResults && cachedBenchmarkResults.length > 0) {
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

    setBenchmarkRunningUI(isBenchmarkRunning);
  }
export function closeBmBenchmarkModal() {
    if (bmBenchmarkModal && bmBenchmarkModal.classList.contains("active")) {
      bmBenchmarkModal.classList.remove("active");
      if (typeof notifyNavClosed === "function") notifyNavClosed();
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
    if (bmBenchCurrentPackets) bmBenchCurrentPackets.textContent = "0 / 10";

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "start_bm_benchmark" }));
    } else {
      fetch("/api/bm/benchmark/start", { method: "POST" })
        .catch(e => console.error("[BENCH] Error starting benchmark via REST:", e));
    }
  }
export function cancelBmBenchmark() {
    if (!isBenchmarkRunning) return;
    if (bmBenchStatusBadge) {
      bmBenchStatusBadge.textContent = (window.t ? window.t("bm_bench.stopping", {}, "Остановка...") : "Остановка...");
      bmBenchStatusBadge.className = "badge-status-pill badge-warning";
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "cancel_bm_benchmark" }));
    } else {
      fetch("/api/bm/benchmark/cancel", { method: "POST" })
        .catch(e => console.error("[BENCH] Error cancelling benchmark via REST:", e));
    }
  }
export function handleBmBenchmarkProgress(msg) {
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
    isBenchmarkRunning = false;
    setBenchmarkRunningUI(false);

    if (bmBenchBarFill) bmBenchBarFill.style.width = "100%";
    if (bmBenchBarPercent) bmBenchBarPercent.textContent = "100%";

    if (msg.results && Array.isArray(msg.results)) {
      cachedBenchmarkResults = msg.results;
      renderBmBenchmarkTable(msg.results);
      if (bmBenchResultsCount) bmBenchResultsCount.textContent = window.t ? window.t("bm_bench.servers_count", { count: msg.results.length }, `${msg.results.length} серверов`) : `${msg.results.length} серверов`;
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
export function renderBmBenchmarkTable(results) {
    if (!bmBenchTableBody) return;
    if (!results || !results.length) {
      bmBenchTableBody.innerHTML = `
        <tr class="bm-bench-empty-row">
          <td colspan="5" class="bm-bench-empty-cell">
            ${window.t ? window.t("bm_bench.not_run_yet", {}, "Тестирование еще не проводилось. Нажмите «Начать тест серверов».") : "Тестирование еще не проводилось. Нажмите «Начать тест серверов»."}
          </td>
        </tr>`;
      return;
    }

    let activeHost = "";
    const settingsModal = document.getElementById("settingsModal");
    const tabEditHs = document.getElementById("tab-edit-hs");
    const editHsId = document.getElementById("editHsId");
    const editHsHost = document.getElementById("editHsHost");
    const isEditingInModal = Boolean(settingsModal && settingsModal.classList.contains("active") && tabEditHs && tabEditHs.classList.contains("active"));

    const cid = resolveHotspotId(activeBenchmarkHotspotId || (isEditingInModal && editHsId ? editHsId.value : null) || activeHotspotId || (currentHotspots && currentHotspots[0] ? currentHotspots[0].id : "default"));
    const hs = currentHotspots ? currentHotspots.find(h => h.id === cid) : null;

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
    const unreachableLabel = window.t ? window.t("bm_bench.status_unreachable", {}, "Недоступен") : "Недоступен";
    const deadTitleLabel = window.t ? window.t("bm_bench.dead_title", {}, "Сервер не ответил на эхо-запросы") : "Сервер не ответил на эхо-запросы";

    let rowsHtml = "";
    results.forEach((r, idx) => {
      const isReachable = r.avg_ping !== null && r.avg_ping !== undefined;
      const rank = idx + 1;
      let rankBadge = "";
      if (isReachable) {
        if (rank === 1) rankBadge = `<span class="rank-badge rank-1" title="${window.t ? window.t("bm_bench.rank1_title", {}, "1-е место (наименьший пинг)") : "1-е место (наименьший пинг)"}">🥇</span>`;
        else if (rank === 2) rankBadge = `<span class="rank-badge rank-2" title="${window.t ? window.t("bm_bench.rank2_title", {}, "2-е место") : "2-е место"}">🥈</span>`;
        else if (rank === 3) rankBadge = `<span class="rank-badge rank-3" title="${window.t ? window.t("bm_bench.rank3_title", {}, "3-е место") : "3-е место"}">🥉</span>`;
        else rankBadge = `<span class="rank-badge rank-other">${rank}</span>`;
      } else {
        rankBadge = '<span class="rank-badge rank-other">-</span>';
      }

      const hostClean = (r.host || "").trim().toLowerCase();
      const ipClean = (r.ip || "").trim().toLowerCase();
      const isCurrentActive = Boolean(activeHost && (activeHost === hostClean || activeHost === ipClean));

      const cCode = r.country_code || (r.country ? r.country.substring(0, 2).toUpperCase() : "");
      const flag = r.flag || (cCode ? isoToEmoji(cCode) : "") || "🌐";
      const cName = getLocalizedCountryName(cCode, r.country_name || r.country || "BM", curLang);
      const bmId = r.id ? `BM ${r.id}` : "";
      const label = bmId ? `${cName} (${bmId})` : cName;

      let pingBadge = "";
      if (!isReachable) {
        pingBadge = `<span class="bench-ping-pill ping-dead" title="${deadTitleLabel}">${unreachableLabel}</span>`;
      } else if (r.avg_ping < 60) {
        pingBadge = `<span class="bench-ping-pill ping-fast">${r.avg_ping} ${msUnit}</span>`;
      } else if (r.avg_ping < 120) {
        pingBadge = `<span class="bench-ping-pill ping-good">${r.avg_ping} ${msUnit}</span>`;
      } else if (r.avg_ping < 200) {
        pingBadge = `<span class="bench-ping-pill ping-fair">${r.avg_ping} ${msUnit}</span>`;
      } else {
        pingBadge = `<span class="bench-ping-pill ping-slow">${r.avg_ping} ${msUnit}</span>`;
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
        const escapedTitle = safeEscapeHtml(`${flag} ${label}`);
        actBtn = `<button type="button" class="btn-bench-select" data-bench-host="${escapedHost}" data-bench-title="${escapedTitle}">${selectLabel}</button>`;
      }

      const rowClass = isCurrentActive ? 'class="bench-current-active"' : '';
      const currentTag = isCurrentActive ? `<span class="bench-current-tag">${currentTagLabel}</span>` : '';

      rowsHtml += `
        <tr ${rowClass}>
          <td style="text-align: center;">${rankBadge}</td>
          <td>
            <div class="bench-server-cell">
              <span class="bench-server-flag">${flag}</span>
              <span class="bench-server-label">${safeEscapeHtml(label)}</span>
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
        const t = btn.getAttribute("data-bench-title");
        if (h) {
          selectBmBenchmarkServer(h, t);
        }
      });
    });
  }
export async function selectBmBenchmarkServer(serverHost, serverTitle) {
    if (!serverHost) return;

    const settingsModal = document.getElementById("settingsModal");
    const tabEditHs = document.getElementById("tab-edit-hs");
    const editHsIdEl = document.getElementById("editHsId");
    const editHsHostEl = document.getElementById("editHsHost");
    const isEditingInModal = Boolean(settingsModal && settingsModal.classList.contains("active") && tabEditHs && tabEditHs.classList.contains("active"));

    // Target hotspot ID
    let targetId = activeBenchmarkHotspotId;
    if (!targetId && isEditingInModal && editHsIdEl && editHsIdEl.value) {
      targetId = editHsIdEl.value;
    }
    const curHsList = getCurrentHotspots();
    const curActiveId = getActiveHotspotId();
    const cid = resolveHotspotId(targetId || curActiveId || (curHsList && curHsList[0] ? curHsList[0].id : "default"));

    // 1. If hotspot edit tab is open or inputs exist, ALWAYS update the form inputs!
    if (editHsHostEl) {
      if (isEditingInModal || !editHsIdEl || !editHsIdEl.value || editHsIdEl.value === cid) {
        editHsHostEl.value = serverHost;
        if (typeof renderBmMastersDropdown === "function") {
          renderBmMastersDropdown(serverHost);
        }
      }
    }

    // 2. Find target hotspot object in currentHotspots
    let targetHs = curHsList ? curHsList.find(h => h.id === cid) : null;
    if (!targetHs && curHsList && curHsList.length > 0) {
      targetHs = curHsList[0];
    }

    if (targetHs) {
      targetHs.bm_master_host = serverHost;
      targetHs.isManualBmDisconnect = false;
    }
    if (cid === curActiveId || typeof window !== "undefined") {
      window.isManualBmDisconnect = false;
    }

    // 3. Immediate visual feedback on UI
    updateBmStatus("connecting", window.t ? window.t("bm_bench.connecting_host", { host: serverHost }, `Подключение к ${serverHost}...`) : `Подключение к ${serverHost}...`, cid);

    const switchNow = Math.floor(Date.now() / 1000);
    const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
    if (card) {
      card._hostSwitchTime = switchNow;
      card._lastTrackedHost = serverHost;
    }
    localStorage.setItem(`proxdmr_host_switch_${cid}`, String(switchNow));
    localStorage.setItem(`proxdmr_host_name_${cid}`, serverHost);

    const hist = loadCardPingHistory(cid);
    const hostPings = (typeof window !== "undefined" && window.cachedBmHostPings) || {};
    const pingVal = (hostPings && hostPings[serverHost] !== undefined) ? hostPings[serverHost] : null;
    if (pingVal !== null && !isNaN(pingVal)) {
      hist.push({ t: Math.floor(Date.now() / 1000), ping: pingVal, host: serverHost });
      saveCardPingHistory(cid);
    }
    if (card) renderCardPingSparkline(card, serverHost);

    refreshAllCardsBmBanner();
    if (typeof renderHotspotsList === "function") {
      renderHotspotsList();
    }

    // 4. Save and reconnect on the backend (PUT /api/hotspots/{cid}?reconnect=1)
    try {
      const payload = {
        ...(targetHs || {}),
        id: cid,
        bm_master_host: serverHost,
        duplex: true
      };
      // If the user was editing fields in tab-edit-hs for this hotspot, merge them
      const editHsId = document.getElementById("editHsId");
      if (isEditingInModal && editHsId && editHsId.value === cid) {
        const editHsName = document.getElementById("editHsName");
        const editHsCallsign = document.getElementById("editHsCallsign");
        const editHsTalkerAlias = document.getElementById("editHsTalkerAlias");
        const editHsDmrId = document.getElementById("editHsDmrId");
        const editHsSsid = document.getElementById("editHsSsid");
        const editHsPassword = document.getElementById("editHsPassword");
        const editHsApiKey = document.getElementById("editHsApiKey");
        const editHsPort = document.getElementById("editHsPort");
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
        if (editHsPassword && editHsPassword.value) payload.bm_password = editHsPassword.value.trim();
        if (editHsApiKey && editHsApiKey.value) payload.bm_api_key = editHsApiKey.value.trim();
        if (editHsPort && editHsPort.value) payload.bm_master_port = parseInt(editHsPort.value, 10) || payload.bm_master_port;
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
      console.error("[BENCH] Error switching BM server:", e);
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
      showToast(window.t ? window.t("bm_bench.switched_toast", { server: serverTitle || serverHost }, `✓ Сервер BM переключен: ${serverTitle || serverHost}`) : `✓ Сервер BM переключен: ${serverTitle || serverHost}`, "success");
    }
    closeBmBenchmarkModal();
  }



export function initBmBenchmark() {
  const closeBmBenchmarkModalBtn = document.getElementById("closeBmBenchmarkModalBtn");
  const btnCloseBmBenchmarkModal = document.getElementById("btnCloseBmBenchmarkModal");
  const bmBenchmarkModal = document.getElementById("bmBenchmarkModal");
  const btnTestBmServers = document.getElementById("btnTestBmServers");
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
  if (btnTestBmServers && !btnTestBmServers._wired) {
    btnTestBmServers._wired = true;
    btnTestBmServers.addEventListener("click", () => {
      const editHsId = document.getElementById("editHsId");
      const hsId = editHsId ? editHsId.value : null;
      openBmBenchmarkModal(hsId);
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
window.renderBmBenchmarkTable = renderBmBenchmarkTable;
window.selectBmBenchmarkServer = selectBmBenchmarkServer;
window.initBmBenchmark = initBmBenchmark;

window.__proxdmr = window.__proxdmr || {};
window.__proxdmr.openBmBenchmarkModal = openBmBenchmarkModal;
window.__proxdmr.closeBmBenchmarkModal = closeBmBenchmarkModal;
window.__proxdmr.startBmBenchmark = startBmBenchmark;
window.__proxdmr.cancelBmBenchmark = cancelBmBenchmark;
window.__proxdmr.initBmBenchmark = initBmBenchmark;
