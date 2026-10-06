/**
 * ProxDMR - WebSocket Subsystem (modules/network/ws.js)
 * Manages WebSocket connection, auto-reconnect backoff, client ping heartbeat,
 * and dispatching 46+ server messages (audio, transcription, status, recordings, etc.).
 */

import { getCountryInfo, renderTgTextHtml, updateFlagElement } from '../core/formatters.js';
import { showToast } from '../core/toast.js';
import {
  updateGwStatus,
  checkBmApiStatus,
  setIsManualGwDisconnect,
  setWasGwConnected,
  setGwIsFastReconnecting,
  setGwConnectAttempt,
  setWsReconnectTimer,
  clearWsReconnectTimer
} from './watchdog.js';
import { getVuState, ensureVuMeterLoop, updateHotspotVuMeter } from '../audio/dsp.js';
import { getHotspotMute, syncAllSlotMutesToServer, updateCardRecUI, updateAllHotspotRecUI } from '../audio/routing.js';
import {
  handleCallTranscription,
  handleTranscriptionError,
  handleTtsSpeech,
  handleTtsError,
  updateCallLogTranscription,
  syncAllTranscribeSlotsToServer,
  disableAllTranscribe,
  disableHotspotTranscribe
} from '../dmr/transcriber.js';
import { renderTranscriptionSummary } from '../dmr/transcription.js';
import { renderQuickMemButtons } from '../dmr/quick-assign.js';
import { updateApkUpdateUI } from '../core/updater.js';
import { setHapticEnabled, setHapticDuration } from '../core/haptic.js';

// State variables declared in module scope
export let ws = null;
export let pingTimer = null;
export let pingSeq = 0;
export const pendingPings = new Map();
export let serverClockOffsetSec = 0;
export let lastReportedClientRtt = null;
export let lastRxStation = null;
export let lastRxSignalTimestamp = 0;

export let tgTs1 = window.tgTs1 !== undefined ? window.tgTs1 : (parseInt(localStorage.getItem("proxdmr_tg_ts1"), 10) || 91);
export let tgTs2 = window.tgTs2 !== undefined ? window.tgTs2 : (parseInt(localStorage.getItem("proxdmr_tg_ts2"), 10) || 2501);
export let heardCalls = window.heardCalls || [];
export let cachedBmPings = window.cachedBmPings || {};
export let cachedBmHostPings = window.cachedBmHostPings || {};
export let cachedBmLosses = window.cachedBmLosses || {};
export let cachedBmHostLosses = window.cachedBmHostLosses || {};
export let cachedBenchmarkResults = window.cachedBenchmarkResults || {};
export let isBenchmarkRunning = Boolean(window.isBenchmarkRunning);
export let clientPingHistory = window.clientPingHistory || [];
export let cachedClientRtt = null;
export let cachedClientLoss = 0.0;

export function getWs() { return ws || window.ws; }
export function setWs(v) {
  ws = v;
  try { window.ws = v; } catch (_) {}
}

try {
  Object.defineProperty(window, "ws", {
    get: () => ws,
    set: (v) => { ws = v; },
    configurable: true
  });
  Object.defineProperty(window, "pendingPings", {
    get: () => pendingPings,
    configurable: true
  });
  Object.defineProperty(window, "lastReportedClientRtt", {
    get: () => lastReportedClientRtt,
    set: (v) => { lastReportedClientRtt = v; },
    configurable: true
  });
  Object.defineProperty(window, "serverClockOffsetSec", {
    get: () => serverClockOffsetSec,
    set: (v) => { serverClockOffsetSec = v; },
    configurable: true
  });
  Object.defineProperty(window, "pingTimer", {
    get: () => pingTimer,
    set: (v) => { pingTimer = v; },
    configurable: true
  });
  Object.defineProperty(window, "tgTs1", {
    get: () => tgTs1,
    set: (v) => { tgTs1 = v; },
    configurable: true
  });
  Object.defineProperty(window, "tgTs2", {
    get: () => tgTs2,
    set: (v) => { tgTs2 = v; },
    configurable: true
  });
  Object.defineProperty(window, "cachedBmPings", {
    get: () => cachedBmPings,
    set: (v) => { cachedBmPings = v; },
    configurable: true
  });
  Object.defineProperty(window, "cachedBmHostPings", {
    get: () => cachedBmHostPings,
    set: (v) => { cachedBmHostPings = v; },
    configurable: true
  });
  Object.defineProperty(window, "cachedBmLosses", {
    get: () => cachedBmLosses,
    set: (v) => { cachedBmLosses = v; },
    configurable: true
  });
  Object.defineProperty(window, "cachedBmHostLosses", {
    get: () => cachedBmHostLosses,
    set: (v) => { cachedBmHostLosses = v; },
    configurable: true
  });
  Object.defineProperty(window, "cachedBenchmarkResults", {
    get: () => cachedBenchmarkResults,
    set: (v) => { cachedBenchmarkResults = v; },
    configurable: true
  });
  Object.defineProperty(window, "isBenchmarkRunning", {
    get: () => isBenchmarkRunning,
    set: (v) => { isBenchmarkRunning = Boolean(v); },
    configurable: true
  });
  Object.defineProperty(window, "clientPingHistory", {
    get: () => clientPingHistory,
    set: (v) => { clientPingHistory = v; },
    configurable: true
  });
  Object.defineProperty(window, "cachedClientRtt", {
    get: () => cachedClientRtt,
    set: (v) => { cachedClientRtt = v; },
    configurable: true
  });
  Object.defineProperty(window, "cachedClientLoss", {
    get: () => cachedClientLoss,
    set: (v) => { cachedClientLoss = v; },
    configurable: true
  });
} catch (_) {}

// DOM Element Accessors
const getRttDisplay = () => document.getElementById("rttDisplay");
const getLoopbackToggle = () => document.getElementById("loopbackToggle");
const getOptLoopback = () => document.getElementById("optLoopback") || document.getElementById("loopbackToggle");
const getOptLanguage = () => document.getElementById("optLanguage");

// Accessors for app functions
const resolveHotspotId = (id) => (window.resolveHotspotId ? window.resolveHotspotId(id) : id);
const getHotspotLoop = (cid) => (window.getHotspotLoop ? window.getHotspotLoop(cid) : false);
const getHotspotPingMode = (hid) => (window.getHotspotPingMode ? window.getHotspotPingMode(hid) : "bm");
const isHotspotCollapsed = (hid) => (window.isHotspotCollapsed ? window.isHotspotCollapsed(hid) : false);
const isHotspotLiveCollapsed = (hid) => (window.isHotspotLiveCollapsed ? window.isHotspotLiveCollapsed(hid) : (localStorage.getItem(`proxdmr_live_collapsed_${resolveHotspotId(hid)}`) === "true"));
const isGlobalAudioMuted = () => (window.isGlobalAudioMuted ? window.isGlobalAudioMuted() : false);
const isHotspotAudioMuted = (cid) => (window.isHotspotAudioMuted ? window.isHotspotAudioMuted(cid) : false);
const isPttAudioMuted = () => (window.isPttAudioMuted ? window.isPttAudioMuted() : false);
const isSimultaneousSlotsEnabled = () => (window.isSimultaneousSlotsEnabled ? window.isSimultaneousSlotsEnabled() : false);
const getHotspotSlot = (cid) => (window.getHotspotSlot ? window.getHotspotSlot(cid) : 1);
const updateCardModeBadge = (card) => { if (window.updateCardModeBadge) window.updateCardModeBadge(card); };
const updateCardTgDisplay = (card) => { if (window.updateCardTgDisplay) window.updateCardTgDisplay(card); };
const updateTgDisplay = () => { if (window.updateTgDisplay) window.updateTgDisplay(); };
const updateAllHotspotsTgDisplay = () => { if (window.updateAllHotspotsTgDisplay) window.updateAllHotspotsTgDisplay(); };
const updateAllVolumeAndMuteUI = () => { if (window.updateAllVolumeAndMuteUI) window.updateAllVolumeAndMuteUI(); };
const updateRadioStatus = (status, text) => { if (window.updateRadioStatus) window.updateRadioStatus(status, text); };
const updateAgcUI = (conf) => { if (window.updateAgcUI) window.updateAgcUI(conf); };
const updateVocoderUI = (conf) => { if (window.updateVocoderUI) window.updateVocoderUI(conf); };
const updateBmStatus = (st, dt, hid) => { if (window.updateBmStatus) window.updateBmStatus(st, dt, hid); };
const refreshAllCardsBmBanner = () => { if (window.refreshAllCardsBmBanner) window.refreshAllCardsBmBanner(); };
const renderHotspotsList = () => { if (window.renderHotspotsList) window.renderHotspotsList(); };
const renderHotspotSelect = () => { if (window.renderHotspotSelect) window.renderHotspotSelect(); };
const renderLogList = () => { if (window.renderLogList) window.renderLogList(); };
const addOrUpdateCall = (entry) => { if (window.addOrUpdateCall) window.addOrUpdateCall(entry); };
const loadHotspots = () => { if (window.loadHotspots) window.loadHotspots(); };
const loadStats = () => { if (window.loadStats) window.loadStats(); };
const applyActiveHotspotToUI = (hid) => { if (window.applyActiveHotspotToUI) window.applyActiveHotspotToUI(hid); };
const applyServerClientSettings = (s) => { if (window.applyServerClientSettings) window.applyServerClientSettings(s); };
const calculateClientPacketLoss = (cid) => (window.calculateClientPacketLoss ? window.calculateClientPacketLoss(cid) : { lossPercent: 0, lostCount: 0 });
const updatePingElement = (el, lat, loss, mode) => { if (window.updatePingElement) window.updatePingElement(el, lat, loss, mode); };
const renderCardPingSparkline = (card, host) => { if (window.renderCardPingSparkline) window.renderCardPingSparkline(card, host); };
const loadCardPingHistory = (cid) => (window.loadCardPingHistory ? window.loadCardPingHistory(cid) : []);
const saveCardPingHistory = (cid) => { if (window.saveCardPingHistory) window.saveCardPingHistory(cid); };
const renderBmBenchmarkTable = (r) => { if (window.renderBmBenchmarkTable) window.renderBmBenchmarkTable(r); };
const setBenchmarkRunningUI = (r) => { if (window.setBenchmarkRunningUI) window.setBenchmarkRunningUI(r); };
const handleBmBenchmarkProgress = (m) => { if (window.handleBmBenchmarkProgress) window.handleBmBenchmarkProgress(m); };
const handleBmBenchmarkComplete = (m) => { if (window.handleBmBenchmarkComplete) window.handleBmBenchmarkComplete(m); };
const setActiveSlot = (s, n) => { if (window.setActiveSlot) window.setActiveSlot(s, n); };
const setCardSlot = (c, s, n) => { if (window.setCardSlot) window.setCardSlot(c, s, n); };
const setLanguage = (l) => { if (window.setLanguage) window.setLanguage(l); };
const setTheme = (t, s) => { if (window.setTheme) window.setTheme(t, s); };
const applyBackground = (t, c) => { if (window.applyBackground) window.applyBackground(t, c); };
const applyBackgroundForActiveTheme = () => { if (window.applyBackgroundForActiveTheme) window.applyBackgroundForActiveTheme(); };
const syncThemeBgTabs = (t) => { if (window.syncThemeBgTabs) window.syncThemeBgTabs(t); };
const setOfflineTranscribeState = (s) => { if (window.setOfflineTranscribeState) window.setOfflineTranscribeState(s); };
const setMuteOnPttEnabled = (e, s) => { if (window.setMuteOnPttEnabled) window.setMuteOnPttEnabled(e, s); };
const setSimultaneousSlotsEnabled = (e) => { if (window.setSimultaneousSlotsEnabled) window.setSimultaneousSlotsEnabled(e); };
const setVolumeUpPttEnabled = (e, s) => { if (window.setVolumeUpPttEnabled) window.setVolumeUpPttEnabled(e, s); else if (window.setVolumeDownPttEnabled) window.setVolumeDownPttEnabled(e, s); };
const setVolumeDownPttEnabled = (e, s) => { if (window.setVolumeUpPttEnabled) window.setVolumeUpPttEnabled(e, s); else if (window.setVolumeDownPttEnabled) window.setVolumeDownPttEnabled(e, s); };
const setHotspotVolumeSyncEnabled = (e, s) => { if (window.setHotspotVolumeSyncEnabled) window.setHotspotVolumeSyncEnabled(e, s); };
const setSystemVolumeSyncEnabled = (e, s) => { if (window.setSystemVolumeSyncEnabled) window.setSystemVolumeSyncEnabled(e, s); };
const updateCardRxLiveBanner = (card, d) => { if (window.updateCardRxLiveBanner) window.updateCardRxLiveBanner(card, d); };
const updateRxLiveBanner = (d) => { if (window.updateRxLiveBanner) window.updateRxLiveBanner(d); };
const updateRxBannerFreshness = () => { if (window.updateRxBannerFreshness) window.updateRxBannerFreshness(); };

// State getters for functions
const getCurrentHotspots = () => window.currentHotspots || [];
const getActiveHotspotId = () => window.activeHotspotId || "default";

  // --- WebSocket Connection ---
let isWsConnecting = false;
let wsConnectStartTime = 0;
let wsConnectTimeoutTimer = null;
const lastRxBurstMap = new Map();

export function connectWebSocket(force = false) {
    if (force) {
      setIsManualGwDisconnect(false);
      clearWsReconnectTimer();
      isWsConnecting = false;
    }

    if (window.isManualGwDisconnect) {
      console.log("[WS] connectWebSocket called while window.isManualGwDisconnect is true. Ignoring.");
      return;
    }

    // Singleton check: prevent creating duplicate parallel WebSocket connections!
    if (ws) {
      if (!force && ws.readyState === WebSocket.OPEN) {
        console.log("[WS] connectWebSocket: WebSocket is already OPEN. Ignoring duplicate connect call.");
        return;
      }
      if (!force && ws.readyState === WebSocket.CONNECTING && (Date.now() - wsConnectStartTime < 5500)) {
        console.log("[WS] connectWebSocket: WebSocket is already CONNECTING. Ignoring duplicate connect call.");
        return;
      }
      // Detach event listeners and clean up previous closed/closing socket
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      } catch (_) {}
      ws = null;
      window.ws = null;
      isWsConnecting = false;
    }

    if (wsConnectTimeoutTimer) {
      clearTimeout(wsConnectTimeoutTimer);
      wsConnectTimeoutTimer = null;
    }

    if (force) {
      isWsConnecting = false;
    } else if (isWsConnecting) {
      if (Date.now() - wsConnectStartTime < 5500) {
        console.log("[WS] connectWebSocket: Connection attempt already in flight. Ignoring.");
        return;
      }
      console.warn("[WS] Previous connection attempt timed out or lost. Overriding stuck isWsConnecting flag.");
      isWsConnecting = false;
    }

    isWsConnecting = true;
    wsConnectStartTime = Date.now();

    clearWsReconnectTimer();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let token = "";
    if (window.AndroidBridge && typeof window.AndroidBridge.getAuthToken === "function") {
      token = window.AndroidBridge.getAuthToken();
    }
    if (!token) {
      try { token = localStorage.getItem("proxdmr_auth_token") || ""; } catch (e) {}
    }
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
    const wsUrl = `${protocol}//${window.location.host}/ws/radio${tokenQuery}`;

    const attemptText = window.gwIsFastReconnecting
      ? `Быстрое переподключение к шлюзу (${window.gwConnectAttempt} из 5)...`
      : `Подключение к шлюзу (попытка ${window.gwConnectAttempt} из 5)...`;
    updateGwStatus(false, attemptText);

    console.log(`[WS] Connecting to: ${wsUrl} (attempt=${window.gwConnectAttempt}, fast=${window.gwIsFastReconnecting}, force=${force})`);
    try {
      ws = new WebSocket(wsUrl);
      window.ws = ws;
    } catch (e) {
      isWsConnecting = false;
      console.error("[WS] Exception creating WebSocket:", e);
      handleGwDisconnectFailure(window.t ? window.t("gw.socket_create_err", { error: e ? e.message : e }, "Ошибка создания сокета: " + (e ? e.message : e)) : ("Ошибка создания сокета: " + (e ? e.message : e)));
      return;
    }
    ws.binaryType = "arraybuffer";

    // Set connection timeout (5.5s) to prevent browser from hanging in CONNECTING indefinitely
    wsConnectTimeoutTimer = setTimeout(() => {
      wsConnectTimeoutTimer = null;
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        console.warn("[WS] Connection attempt timed out (>5.5s). Aborting and retrying...");
        isWsConnecting = false;
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.close();
        } catch (_) {}
        ws = null;
        window.ws = null;
        handleGwDisconnectFailure("Connection attempt timed out");
      }
    }, 5500);

    ws.onopen = () => {
      if (wsConnectTimeoutTimer) {
        clearTimeout(wsConnectTimeoutTimer);
        wsConnectTimeoutTimer = null;
      }
      isWsConnecting = false;
      console.log("[WS] Connected");
      clearWsReconnectTimer();
      setIsManualGwDisconnect(false);
      setWasGwConnected(true);
      setGwIsFastReconnecting(false);
      setGwConnectAttempt(1);
      updateGwStatus(true);
      pendingPings.clear();
      startPing();
      if (window._isServerRestarting) {
        window._isServerRestarting = false;
        const reconnectedMsg = (window.i18n && typeof window.i18n.t === "function")
          ? window.i18n.t("general.reconnected_toast")
          : (window.t ? window.t("gw.restored_toast", {}, "Связь с сервером успешно восстановлена!") : "Связь с сервером успешно восстановлена!");
        showToast(reconnectedMsg, 4000);
      }

      // Synchronize all hotspot collapse states with the server
      const curHotspotsList = (typeof window !== "undefined" && window.currentHotspots) || [];
      if (curHotspotsList && curHotspotsList.length) {
        curHotspotsList.forEach(h => {
          const isLive = isHotspotLiveCollapsed(h.id);
          const col = isHotspotCollapsed(h.id) && !isLive;
          try {
            ws.send(JSON.stringify({ type: "hotspot_collapse", hotspot_id: h.id, collapsed: col }));
          } catch (_) {}
        });
      }

      // Synchronize all active AI transcribe slots with the server (ensuring clean startup OFF)
      if (!window._appTranscribeWsInitDone) {
        window._appTranscribeWsInitDone = true;
        try {
          ws.send(JSON.stringify({ type: "disable_all_transcribe_slots" }));
        } catch (_) {}
      } else if (typeof syncAllTranscribeSlotsToServer === "function") {
        syncAllTranscribeSlotsToServer();
      }

      // Synchronize selective slot mute states with the server
      if (typeof syncAllSlotMutesToServer === "function") {
        syncAllSlotMutesToServer();
      }
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          handleServerMessage(msg);
        } catch (e) {
          console.error("[WS] Parse error:", e);
        }
      } else if (event.data instanceof ArrayBuffer) {
        let slot = 0;
        let hotspotId = (typeof window !== "undefined" && window.activeHotspotId) || "default";
        let pcmBuffer = event.data;

        // Parse tagged audio header: [slot (1 byte), hid_len (1 byte), hid_bytes, pcm_bytes]
        if (event.data.byteLength > 2) {
          const view = new DataView(event.data);
          const rawSlot = view.getUint8(0);
          slot = (rawSlot === 2) ? 2 : (rawSlot === 1 ? 1 : 0);
          const hidLen = view.getUint8(1);
          if (hidLen > 0 && hidLen < 32 && event.data.byteLength >= 2 + hidLen + 32) {
            const dec = new TextDecoder("utf-8");
            hotspotId = dec.decode(new Uint8Array(event.data, 2, hidLen));
            pcmBuffer = event.data.slice(2 + hidLen);
          } else {
            // Legacy 1-byte slot prefix
            pcmBuffer = event.data.slice(1);
          }
        }

        // Fallback to UI state only if slot wasn't resolved by header
        if (!slot) {
          const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${hotspotId}"]`);
          if (targetCard) {
            const ts1Rx = targetCard.querySelector(".vfo-ts1-row")?.classList.contains("vfo-rx-active");
            const ts2Rx = targetCard.querySelector(".vfo-ts2-row")?.classList.contains("vfo-rx-active");
            if (ts1Rx && !ts2Rx) slot = 1;
            else if (ts2Rx && !ts1Rx) slot = 2;
          }
        }
        if (!slot) slot = 1;

        // 1. Update VU meter on the SPECIFIC hotspot card and slot that received audio
        updateHotspotVuMeter(hotspotId, slot, pcmBuffer);

        const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${hotspotId}"]`);
        if (targetCard && slot) {
          const vfoRow = targetCard.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
          if (vfoRow && !vfoRow.classList.contains("vfo-rx-active")) {
            vfoRow.classList.add("vfo-rx-active");
            updateCardModeBadge(targetCard);
          }
          if (targetCard._lastRx && targetCard._lastRx[slot]) {
            targetCard._lastRx[slot].lastAudioTime = Date.now() / 1000;
          }
        }

        // 2. Multi-layer selective muting and simultaneous slot checks
        const cid = resolveHotspotId(hotspotId);

        // Check per-hotspot GW disconnect state (decoupled GW button)
        if (typeof window.isHotspotGwDisconnected === "function" && window.isHotspotGwDisconnected(cid)) {
          return;
        }


        const isSlotMutedInStorage = getHotspotMute(cid, slot);
        const isSlotMutedInAudio = window.audioPlayer && audioPlayer.isSlotMuted && audioPlayer.isSlotMuted(cid, slot);
        const loopbackToggle = document.getElementById("loopbackToggle");
        const isLoopActive = Boolean(getHotspotLoop(cid) || (loopbackToggle && loopbackToggle.checked));
        if (isSlotMutedInStorage || isSlotMutedInAudio || isHotspotAudioMuted(cid) || isGlobalAudioMuted() || (isPttAudioMuted() && !isLoopActive)) {
          return;
        }

        // Ensure buffer has even length for 16-bit PCM playback
        if (pcmBuffer.byteLength % 2 !== 0) {
          pcmBuffer = pcmBuffer.slice(0, pcmBuffer.byteLength - 1);
        }

        // 2.5 Prevent duplicate audio burst playback (stutter/doubling & 0.5x speed reduction protection)
        const burstKey = `${cid}_${slot}`;
        const nowMs = Date.now();
        const prevBurst = lastRxBurstMap.get(burstKey);
        let sampleHash = pcmBuffer.byteLength;
        if (pcmBuffer.byteLength >= 16) {
          try {
            const u32 = new Uint32Array(pcmBuffer.buffer || pcmBuffer, pcmBuffer.byteOffset || 0, Math.min(8, Math.floor(pcmBuffer.byteLength / 4)));
            sampleHash = (u32[0] ^ u32[u32.length - 1] ^ pcmBuffer.byteLength) >>> 0;
          } catch (_) {
            sampleHash = pcmBuffer.byteLength;
          }
        }
        if (prevBurst && prevBurst.hash === sampleHash && (nowMs - prevBurst.time) < 40) {
          // Exact duplicate audio burst arriving within 40ms; drop immediately
          return;
        }
        lastRxBurstMap.set(burstKey, { hash: sampleHash, time: nowMs });

        // 3. Play audio through speakers into isolated channel
        audioPlayer.feed(pcmBuffer, cid, slot);
      }
    };

    ws.onclose = (event) => {
      if (wsConnectTimeoutTimer) {
        clearTimeout(wsConnectTimeoutTimer);
        wsConnectTimeoutTimer = null;
      }
      isWsConnecting = false;
      try {
        if (ws) {
          ws.onmessage = null;
          ws.onerror = null;
        }
      } catch (_) {}
      handleGwDisconnectFailure(event);
    };

    ws.onerror = (err) => {
      if (wsConnectTimeoutTimer) {
        clearTimeout(wsConnectTimeoutTimer);
        wsConnectTimeoutTimer = null;
      }
      isWsConnecting = false;
      console.error("[WS] Socket error:", err);
    };
  }
export function handleGwDisconnectFailure(eventOrReason) {
    if (wsConnectTimeoutTimer) {
      clearTimeout(wsConnectTimeoutTimer);
      wsConnectTimeoutTimer = null;
    }
    isWsConnecting = false;

    // Convert in-flight pending pings to lost entries
    if (typeof pendingPings !== "undefined" && pendingPings.size > 0) {
      for (const [s, sentTime] of pendingPings.entries()) {
        clientPingHistory.push({ t: sentTime / 1000, ping: null });
      }
      pendingPings.clear();
    }
    // Keep ping timer running so packet loss and sparklines update continuously
    startPing();

    // Auth rejected by server
    if (eventOrReason && eventOrReason.code === 4001) {
      console.warn("[WS] Auth rejected (4001), showing login modal");
      updateGwStatus(false, window.t ? window.t("gw.auth_required", {}, "Требуется авторизация") : "Требуется авторизация");
      if (window.ProxDMRAuth) window.ProxDMRAuth.checkAuth();
      return;
    }

    if (window.isManualGwDisconnect) {
      console.log("[WS] Disconnected manually by user, auto-reconnect disabled.");
      clearWsReconnectTimer();
      updateGwStatus(false, window.t ? window.t("gw.disconnected_user", {}, "Отключено пользователем") : "Отключено пользователем");
      return;
    }

    if (window._isServerRestarting) {
      clearWsReconnectTimer();
      setWasGwConnected(false);
      setGwIsFastReconnecting(true);
      setGwConnectAttempt(1);
      updateGwStatus(false, window.t ? window.t("gw.restarting_wait", {}, "Перезагрузка сервера... Ожидание готовности") : "Перезагрузка сервера... Ожидание готовности");
      setWsReconnectTimer(setTimeout(connectWebSocket, 1500));
      return;
    }

    clearWsReconnectTimer();

    // Case 1: Unexpected disconnect from active ONLINE state
    if (window.wasGwConnected) {
      setWasGwConnected(false);
      setGwIsFastReconnecting(true);
      setGwConnectAttempt(1);
      const delay = 1.0;
      console.warn(`[WS] Disconnected from server. Starting fast reconnect in ${delay}s (attempt 1/5)...`);
      updateGwStatus(false, window.t ? window.t("gw.reconnect_quick_first", {}, "Разрыв связи со шлюзом. Быстрый повтор через 1с (1 из 5)...") : "Разрыв связи со шлюзом. Быстрый повтор через 1с (1 из 5)...");
      setWsReconnectTimer(setTimeout(connectWebSocket, delay * 1000));
      return;
    }

    // Case 2: In fast reconnect series (after disconnect)
    if (window.gwIsFastReconnecting) {
      if (window.gwConnectAttempt < 5) {
        setGwConnectAttempt(window.gwConnectAttempt + 1);
        const delay = 1.0;
        console.warn(`[WS] Fast reconnect attempt failed. Retrying in ${delay}s (${window.gwConnectAttempt}/5)...`);
        updateGwStatus(false, window.t ? window.t("gw.reconnect_quick_attempt", { attempt: window.gwConnectAttempt }, `Разрыв связи. Быстрый повтор через 1с (${window.gwConnectAttempt} из 5)...`) : `Разрыв связи. Быстрый повтор через 1с (${window.gwConnectAttempt} из 5)...`);
        setWsReconnectTimer(setTimeout(connectWebSocket, delay * 1000));
      } else {
        // All 5 fast attempts failed -> 7s pause, transition to standard progressive cycle
        setGwIsFastReconnecting(false);
        setGwConnectAttempt(1);
        const delay = 7.0;
        console.warn(`[WS] All 5 fast reconnect attempts failed. Pausing 7s before standard cycle...`);
        updateGwStatus(false, window.t ? window.t("gw.reconnect_pause", {}, "Быстрое восстановление не удалось. Пауза 7с перед повторным циклом...") : "Быстрое восстановление не удалось. Пауза 7с перед повторным циклом...");
        setWsReconnectTimer(setTimeout(connectWebSocket, delay * 1000));
      }
      return;
    }

    // Case 3: Standard progressive retry cycle (startup or after fast attempts exhausted)
    if (window.gwConnectAttempt < 5) {
      const nextAttempt = window.gwConnectAttempt + 1;
      const delay = window.gwConnectAttempt + 1; // 1->2s, 2->3s, 3->4s, 4->5s
      setGwConnectAttempt(nextAttempt);
      console.warn(`[WS] Connection attempt failed. Retrying in ${delay}s (${window.gwConnectAttempt}/5)...`);
      updateGwStatus(false, window.t ? window.t("gw.unreachable_attempt", { delay, attempt: window.gwConnectAttempt }, `Шлюз недоступен. Повтор через ${delay}с (${window.gwConnectAttempt} из 5)...`) : `Шлюз недоступен. Повтор через ${delay}с (${window.gwConnectAttempt} из 5)...`);
      setWsReconnectTimer(setTimeout(connectWebSocket, delay * 1000));
    } else {
      // All 5 attempts in progressive cycle failed -> 7s pause, repeat cycle from Attempt 1
      setGwConnectAttempt(1);
      const delay = 7.0;
      console.warn(`[WS] All 5 connection attempts failed. Pausing 7s before repeating cycle...`);
      updateGwStatus(false, window.t ? window.t("gw.all_attempts_failed", {}, "Все 5 попыток завершились неудачей. Пауза 7с перед повтором...") : "Все 5 попыток завершились неудачей. Пауза 7с перед повтором...");
      setWsReconnectTimer(setTimeout(connectWebSocket, delay * 1000));
    }
  }
export function handleServerMessage(msg) {
    if (msg.type === "bm_import_progress") {
      if (typeof window.onBmImportProgress === "function") {
        window.onBmImportProgress(msg.task || msg);
      }
      return;
    }
    if (msg.type === "bm_import_finished") {
      if (typeof window.onBmImportFinished === "function") {
        window.onBmImportFinished(msg.task || msg);
      }
      return;
    }
    if (msg.type === "recording_saved") {
      if (window.recordingsManager) {
        window.recordingsManager.onRecordingSaved(msg.recording, msg.call_id);
      }
      return;
    }
    if (msg.type === "recording_state") {
      if (window.recordingsManager) {
        window.recordingsManager.onRecordingStateChanged(msg);
      }
      return;
    }
    if (msg.type === "recording_session_state") {
      if (window.recordingsManager) {
        window.recordingsManager.onSessionStateChanged(msg);
      }
      return;
    }
    if (msg.type === "recordings_pruned") {
      if (window.recordingsManager) {
        window.recordingsManager.loadStats();
      }
      return;
    }
    if (msg.type === "recordings_cleared") {
      if (window.recordingsManager) {
        window.recordingsManager.onRecordingsCleared();
      }
      return;
    }
    if (msg.type === "recording_deleted") {
      if (window.recordingsManager) {
        window.recordingsManager.onRecordingDeleted(msg.recording_id, msg.call_id);
      }
      return;
    }
    if (msg.type === "offline_transcribe_state") {
      if (window.recordingsManager) {
        window.recordingsManager.setOfflineTranscribeState(msg.active, msg.stats, msg.hotspot_id);
      }
      if (msg.message) {
        showToast(msg.message, 2500);
      }
      return;
    }
    if (msg.type === "offline_transcribe_progress") {
      if (window.recordingsManager) {
        window.recordingsManager.setOfflineTranscribeState(true, msg, msg.hotspot_id);
      }
      return;
    }
    if (msg.type === "calls_deleted") {
      const delIds = new Set((msg.call_ids || []).map(String));
      if (delIds.size > 0) {
        if (window.heardCalls && Array.isArray(window.heardCalls)) {
          window.heardCalls = window.heardCalls.filter(c => !delIds.has(String(c.id)));
        }
        if (window.recordingsManager) {
          delIds.forEach(id => window.recordingsManager.recordedCallIds.delete(id));
          const curActive = window.recordingsManager.getActiveCallId();
          if (curActive && delIds.has(String(curActive))) {
            const nextId = window.recordingsManager.getNextChronologicalCallId(curActive);
            if (nextId) {
              window.recordingsManager.playByCallId(nextId);
            } else {
              window.recordingsManager.closePlayer();
            }
          }
        }
        if (typeof window.renderLogList === "function") {
          window.renderLogList();
        }
      }
      return;
    }

    if (msg.type === "server_restart") {
      window._isServerRestarting = true;
      const restartMsg = msg.message || "Сервер перезагружается...";
      showToast(restartMsg, 8000);
      updateGwStatus(false, window.t ? window.t("gw.restarting_server", {}, "Перезагрузка сервера...") : "Перезагрузка сервера...");
      return;
    }
    if (msg.type === "init") {
      if (msg.user_id) {
        window.currentUserId = msg.user_id;
      }
      if (msg.is_swl !== undefined && typeof window.setSwlState === "function") {
        window.setSwlState(Boolean(msg.is_swl));
      }
      window.activeHotspotId = msg.active_hotspot_id || "default";
      window.currentHotspots = msg.hotspots || [];

      // Restore user account client_settings from server if available
      if (msg.client_settings && typeof msg.client_settings === "object" && Object.keys(msg.client_settings).length > 0) {
        applyServerClientSettings(msg.client_settings);
      }

      // Restore last combination of open/collapsed hotspots from localStorage
      const allHs = window.currentHotspots || [];
      allHs.forEach((hs, idx) => {
        const cid = resolveHotspotId(hs.id);
        const saved = localStorage.getItem(`proxdmr_collapsed_${cid}`);
        const shouldCollapse = (saved !== null) ? (saved === "true") : (typeof hs.collapsed === "boolean" ? hs.collapsed : (idx > 0));
        if (saved === null) {
          try {
            localStorage.setItem(`proxdmr_collapsed_${cid}`, shouldCollapse ? "true" : "false");
          } catch (_) {}
        }
        const isLive = isHotspotLiveCollapsed(cid);
        if (shouldCollapse && !isLive) {
          hs.collapsed = true;
          hs.isLiveCollapsed = false;
          if (typeof disableHotspotTranscribe === "function") {
            disableHotspotTranscribe(cid, true, false);
          }
          if (hs.status !== "DISCONNECTED" && hs.status !== "OFFLINE") {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "bm_disconnect", hotspot_id: hs.id }));
              ws.send(JSON.stringify({ type: "hotspot_collapse", hotspot_id: hs.id, collapsed: true }));
            }
            fetch(`/api/hotspots/${hs.id}/disconnect`, { method: "POST" }).catch(() => {});
          }
          hs.status = "DISCONNECTED";
          hs.detail = window.t ? window.t("status.bm_collapsed_detail", {}, "Свернут / отключен") : "Свернут / отключен";
        } else if (shouldCollapse && isLive) {
          hs.collapsed = true;
          hs.isLiveCollapsed = true;
          // Keep live in background! Ensure server sees uncollapsed state
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "hotspot_collapse", hotspot_id: hs.id, collapsed: false }));
          }
          fetch(`/api/hotspots/${hs.id}/expand`, { method: "POST" }).catch(() => {});
        } else {
          hs.collapsed = false;
          hs.isLiveCollapsed = false;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "hotspot_collapse", hotspot_id: hs.id, collapsed: false }));
          }
          fetch(`/api/hotspots/${hs.id}/expand`, { method: "POST" }).catch(() => {});
        }
      });

      let savedActiveHs = null;
      try {
        savedActiveHs = localStorage.getItem("proxdmr_active_hotspot_id");
      } catch (_) {}

      if (savedActiveHs && allHs.some(h => h.id === savedActiveHs && (!isHotspotCollapsed(h.id) || isHotspotLiveCollapsed(h.id)))) {
        window.activeHotspotId = savedActiveHs;
      } else if (isHotspotCollapsed(window.activeHotspotId) && !isHotspotLiveCollapsed(window.activeHotspotId)) {
        const firstOpen = allHs.find(h => !isHotspotCollapsed(h.id) || isHotspotLiveCollapsed(h.id));
        if (firstOpen) {
          window.activeHotspotId = firstOpen.id;
        } else if (allHs[0]) {
          window.activeHotspotId = allHs[0].id;
        }
      }

      if (typeof window.renderRadiosGrid === "function") {
        window.renderRadiosGrid();
      }
      if (typeof window.applyActiveHotspotToUI === "function") {
        window.applyActiveHotspotToUI();
      }
      if (msg.bm_pings) cachedBmPings = { ...cachedBmPings, ...msg.bm_pings };
      if (msg.bm_host_pings) cachedBmHostPings = { ...cachedBmHostPings, ...msg.bm_host_pings };
      if (msg.bm_losses) cachedBmLosses = { ...cachedBmLosses, ...msg.bm_losses };
      if (msg.bm_host_losses) cachedBmHostLosses = { ...cachedBmHostLosses, ...msg.bm_host_losses };
      if (msg.bm_ping_history) {
        const pingHist = (typeof window !== "undefined" && window.bmPingHistory) || (window.bmPingHistory = {});
        Object.keys(msg.bm_ping_history).forEach(h => {
          pingHist[h] = (msg.bm_ping_history[h] || []).map(pt => ({ t: pt[0], ping: pt[1] }));
        });
      }
      if (msg.bm_benchmark_results && Array.isArray(msg.bm_benchmark_results)) {
        cachedBenchmarkResults = msg.bm_benchmark_results;
        if (typeof renderBmBenchmarkTable === "function") {
          renderBmBenchmarkTable(msg.bm_benchmark_results);
          const rCount = document.getElementById("bmBenchResultsCount");
          if (rCount) rCount.textContent = `${msg.bm_benchmark_results.length} серверов`;
        }
      }
      if (msg.bm_benchmark_running !== undefined) {
        isBenchmarkRunning = Boolean(msg.bm_benchmark_running);
        if (typeof setBenchmarkRunningUI === "function") {
          setBenchmarkRunningUI(isBenchmarkRunning);
        }
      }
      if (msg.server_time) {
        serverClockOffsetSec = (Date.now() - msg.server_time) / 1000;
      }
      if (msg.version) {
        window.APP_VERSION = msg.version;
        document.querySelectorAll(".badge-about-ver:not(.badge-about-apk-ver)").forEach(el => {
          el.textContent = `v${msg.version}`;
          el.title = window.t ? window.t("general.version_title", { version: msg.version, date: msg.version_date || "" }, `Версия ProxDMR: v${msg.version} (${msg.version_date || ""})`) : `Версия ProxDMR: v${msg.version} (${msg.version_date || ""})`;
        });
      }
      if (msg.version_date) {
        window.APP_VERSION_DATE = msg.version_date;
        document.querySelectorAll(".badge-about-date:not(.badge-about-apk-date)").forEach(el => {
          el.textContent = msg.version_date;
          el.title = window.t ? window.t("general.updated_title", { date: msg.version_date }, `Дата последнего обновления: ${msg.version_date}`) : `Дата последнего обновления: ${msg.version_date}`;
        });
      }
      if (msg.apk_filename || msg.apk_version || msg.apk_path) {
        if (msg.apk_filename) window.APK_FILENAME = msg.apk_filename;
        if (msg.apk_version) window.APK_VERSION = msg.apk_version;
        if (msg.apk_path) window.APK_PATH = msg.apk_path;
        if (typeof window.updateApkUpdateUI === "function") {
          window.updateApkUpdateUI({
            apk_version: msg.apk_version,
            apk_filename: msg.apk_filename,
            apk_path: msg.apk_path || msg.apk_url
          });
        }
        const apkVerEl = document.getElementById("aboutApkVersion");
        if (apkVerEl && !window.AndroidBridge && msg.apk_version) {
          apkVerEl.textContent = `apk-${msg.apk_version}`;
        }
      }
      if (msg.client_ping_history && Array.isArray(msg.client_ping_history)) {
        const mapByT = new Map();
        (clientPingHistory || []).forEach(pt => {
          const t = Number(pt.t !== undefined ? pt.t : pt[0]);
          const ping = pt.ping !== undefined ? pt.ping : pt[1];
          if (!isNaN(t) && t > 0) mapByT.set(Math.round(t), { t: Math.round(t), ping });
        });
        msg.client_ping_history.forEach(pt => {
          const rawT = Number(pt[0]);
          const t = Math.round(rawT + serverClockOffsetSec);
          const ping = pt[1];
          if (!isNaN(t) && t > 0 && !mapByT.has(t)) {
            mapByT.set(t, { t, ping });
          }
        });
        clientPingHistory = Array.from(mapByT.values()).sort((a, b) => a.t - b.t).slice(-15000);
        window.clientPingHistory = clientPingHistory;
        try {
          localStorage.setItem("proxdmr_client_ping_recent", JSON.stringify(clientPingHistory.slice(-500)));
        } catch (_) {}
      }
      if (msg.client_rtt !== undefined && msg.client_rtt !== null) {
        cachedClientRtt = msg.client_rtt;
      }
      if (msg.client_packet_loss !== undefined && msg.client_packet_loss !== null) {
        cachedClientLoss = msg.client_packet_loss;
      }
      (msg.hotspots || []).forEach((hs, idx) => {
        const hid = hs.id || (idx === 0 ? "default" : `hs_${idx}`);
        const hhost = hs.bm_master_host || "2322.master.brandmeister.network";
        const hist = loadCardPingHistory(hid);
        const serverHist = bmPingHistory[hhost] || [];
        if (serverHist.length > 0) {
          // Merge server 24h background history into local card history by timestamp
          const mapByT = new Map();
          hist.forEach(pt => {
            const t = Number(pt.t !== undefined ? pt.t : pt.time);
            if (!isNaN(t)) mapByT.set(t, { t, ping: pt.ping, host: pt.host || hhost });
          });
          serverHist.forEach(pt => {
            const t = Number(pt.t !== undefined ? pt.t : pt.time);
            if (!isNaN(t) && !mapByT.has(t)) {
              mapByT.set(t, { t, ping: pt.ping, host: hhost });
            }
          });
          const merged = Array.from(mapByT.values()).sort((a, b) => a.t - b.t);
          const cHistories = (typeof window !== "undefined" && window.cardPingHistories) || (window.cardPingHistories = {});
          cHistories[hid] = merged;
          saveCardPingHistory(hid);
        }
      });
      renderHotspotSelect();
      renderHotspotsList();
      applyActiveHotspotToUI();
      refreshAllCardsBmBanner();
      // Verify BrandMeister API connection on initial load
      if (typeof checkBmApiStatus === "function") {
        checkBmApiStatus(true);
      }

      if (msg.calls && Array.isArray(msg.calls)) {
        const nowSec = Date.now() / 1000;
        const cutoff = nowSec - 86400;
        // Clean up any stale active calls and filter to retention window of 24h
        const cleanCalls = msg.calls
          .filter(c => (c.timestamp || nowSec) >= cutoff && (c.active || (c.duration && c.duration >= 0.5) || c.transcription))
          .map(c => {
            if (c.active && c.timestamp && (nowSec - c.timestamp > 3.0)) {
              return {
                ...c,
                active: false,
                duration: c.duration || Math.max(0.5, Number((nowSec - c.timestamp).toFixed(1)))
              };
            }
            return c;
          });
        heardCalls = cleanCalls;
        window.heardCalls = cleanCalls;
        if (window.__proxdmr && typeof window.__proxdmr.setHeardCalls === "function") {
          window.__proxdmr.setHeardCalls(cleanCalls);
        }
        renderLogList();
        if (typeof renderTranscriptionSummary === "function" && typeof window !== "undefined" && window.isTranscriptionSummaryOpen) {
          renderTranscriptionSummary();
        }
        const activeCallsList = (window.__proxdmr && window.__proxdmr.getHeardCalls) ? window.__proxdmr.getHeardCalls() : (window.heardCalls || cleanCalls);
        if (activeCallsList.length > 0 && !lastRxStation) {
          const latest = activeCallsList.find(c => !c.is_tx) || activeCallsList[0];
          lastRxStation = {
            active: false,
            slot: latest.slot,
            src_id: latest.src_id,
            src_callsign: latest.src_callsign,
            src_name: latest.src_name,
            talker_alias: latest.talker_alias,
            city: latest.city
          };
          if (latest.timestamp) {
            lastRxSignalTimestamp = latest.timestamp * 1000;
          }
          updateRxLiveBanner({ active: false });
          updateRxBannerFreshness();
        }
      }

      if (msg.app_settings) {
        if (msg.app_settings.theme) {
          const sTheme = msg.app_settings.theme === "light" ? "light" : "dark";
          setTheme(sTheme, false);
        }
        const uid = window.currentUserId;
        if (msg.app_settings.bg_type_dark) {
          const dt = msg.app_settings.bg_type_dark === "color" ? "color" : "pattern";
          if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_type_dark`, dt);
          localStorage.setItem("proxdmr_bg_type_dark", dt);
        }
        if (msg.app_settings.bg_color_dark) {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_color_dark`, msg.app_settings.bg_color_dark);
          localStorage.setItem("proxdmr_bg_color_dark", msg.app_settings.bg_color_dark);
        }
        if (msg.app_settings.bg_type_light) {
          const lt = msg.app_settings.bg_type_light === "color" ? "color" : "pattern";
          if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_type_light`, lt);
          localStorage.setItem("proxdmr_bg_type_light", lt);
        }
        if (msg.app_settings.bg_color_light) {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_color_light`, msg.app_settings.bg_color_light);
          localStorage.setItem("proxdmr_bg_color_light", msg.app_settings.bg_color_light);
        }
        if (msg.app_settings.custom_wallpaper_dark !== undefined) {
          if (msg.app_settings.custom_wallpaper_dark) {
            if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_custom_dark`, msg.app_settings.custom_wallpaper_dark);
            localStorage.setItem("proxdmr_bg_custom_dark", msg.app_settings.custom_wallpaper_dark);
          } else {
            if (uid) localStorage.removeItem(`proxdmr_u${uid}_bg_custom_dark`);
            localStorage.removeItem("proxdmr_bg_custom_dark");
          }
        }
        if (msg.app_settings.custom_wallpaper_light !== undefined) {
          if (msg.app_settings.custom_wallpaper_light) {
            if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_custom_light`, msg.app_settings.custom_wallpaper_light);
            localStorage.setItem("proxdmr_bg_custom_light", msg.app_settings.custom_wallpaper_light);
          } else {
            if (uid) localStorage.removeItem(`proxdmr_u${uid}_bg_custom_light`);
            localStorage.removeItem("proxdmr_bg_custom_light");
          }
        }
        applyBackgroundForActiveTheme();
        if (typeof syncThemeBgTabs === "function") {
          syncThemeBgTabs(typeof window !== "undefined" ? window.currentTheme : "default");
        }
        if (msg.app_settings.language) {
          const sLang = msg.app_settings.language;
          if (uid) localStorage.setItem(`proxdmr_u${uid}_language`, sLang);
          localStorage.setItem("proxdmr_language", sLang);
          const optLanguage = document.getElementById("optLanguage");
          if (optLanguage) optLanguage.value = sLang;
          if (window.I18N && window.I18N.currentLanguage !== sLang) {
            window.I18N.setLanguage(sLang);
          }
        }
        if (msg.app_settings.simultaneous_slots !== undefined) {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_simultaneous_slots`, msg.app_settings.simultaneous_slots ? "true" : "false");
          localStorage.setItem("proxdmr_simultaneous_slots", msg.app_settings.simultaneous_slots ? "true" : "false");
          setSimultaneousSlotsEnabled(msg.app_settings.simultaneous_slots, false);
        }
        if (msg.app_settings.check_mic_on_tx !== undefined) {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_check_mic_on_tx`, msg.app_settings.check_mic_on_tx ? "true" : "false");
          localStorage.setItem("proxdmr_check_mic_on_tx", msg.app_settings.check_mic_on_tx ? "true" : "false");
          if (typeof window.setCheckMicOnTxEnabled === "function") {
            window.setCheckMicOnTxEnabled(msg.app_settings.check_mic_on_tx, false);
          }
        }
        if (msg.app_settings.mute_on_ptt !== undefined) {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_mute_on_ptt`, msg.app_settings.mute_on_ptt ? "true" : "false");
          localStorage.setItem("proxdmr_mute_on_ptt", msg.app_settings.mute_on_ptt ? "true" : "false");
          setMuteOnPttEnabled(msg.app_settings.mute_on_ptt, false);
        }
        const vup = msg.app_settings.volume_up_ptt !== undefined
          ? msg.app_settings.volume_up_ptt
          : msg.app_settings.volume_down_ptt;
        if (vup !== undefined) {
          if (uid) {
            localStorage.setItem(`proxdmr_u${uid}_volume_up_ptt`, vup ? "true" : "false");
            localStorage.setItem(`proxdmr_u${uid}_volume_down_ptt`, vup ? "true" : "false");
          }
          localStorage.setItem("proxdmr_volume_up_ptt", vup ? "true" : "false");
          localStorage.setItem("proxdmr_volume_down_ptt", vup ? "true" : "false");
          setVolumeUpPttEnabled(vup, false);
        }
        if (msg.app_settings.sync_hotspot_volume !== undefined) {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_sync_hotspot_volume`, msg.app_settings.sync_hotspot_volume ? "true" : "false");
          localStorage.setItem("proxdmr_sync_hotspot_volume", msg.app_settings.sync_hotspot_volume ? "true" : "false");
          setHotspotVolumeSyncEnabled(msg.app_settings.sync_hotspot_volume, false);
        }
        if (msg.app_settings.sync_system_volume !== undefined) {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_sync_system_volume`, msg.app_settings.sync_system_volume ? "true" : "false");
          localStorage.setItem("proxdmr_sync_system_volume", msg.app_settings.sync_system_volume ? "true" : "false");
          setSystemVolumeSyncEnabled(msg.app_settings.sync_system_volume, false);
        }
        if (msg.app_settings.haptic_feedback !== undefined) {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_haptic_feedback`, msg.app_settings.haptic_feedback ? "true" : "false");
          localStorage.setItem("proxdmr_haptic_feedback", msg.app_settings.haptic_feedback ? "true" : "false");
          setHapticEnabled(msg.app_settings.haptic_feedback, false);
        }
        if (msg.app_settings.haptic_duration !== undefined) {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_haptic_duration`, String(msg.app_settings.haptic_duration));
          localStorage.setItem("proxdmr_haptic_duration", String(msg.app_settings.haptic_duration));
          setHapticDuration(msg.app_settings.haptic_duration, false);
        }
        if (msg.app_settings.hamqth_username !== undefined) {
          const optU = document.getElementById("optHamQthUsername");
          if (optU && (!optU.value || optU.value === "")) optU.value = msg.app_settings.hamqth_username || "";
        }
        if (msg.app_settings.hamqth_password !== undefined) {
          const optP = document.getElementById("optHamQthPassword");
          if (optP && (!optP.value || optP.value === "")) optP.value = msg.app_settings.hamqth_password || "";
        }
        if (msg.app_settings.quick_mem && typeof msg.app_settings.quick_mem === "object") {
          for (const [k, v] of Object.entries(msg.app_settings.quick_mem)) {
            const locKey = k.startsWith("hs_") ? `proxdmr_quick_mem_${k}` : `proxdmr_quick_mem_hs_${k}`;
            const userLocKey = uid ? `proxdmr_u${uid}_quick_mem_${k}` : null;
            if (v) {
              if (userLocKey) localStorage.setItem(userLocKey, JSON.stringify(v));
              localStorage.setItem(locKey, JSON.stringify(v));
            } else {
              if (userLocKey) localStorage.removeItem(userLocKey);
              localStorage.removeItem(locKey);
            }
          }
          if (typeof renderQuickMemButtons === "function") {
            renderQuickMemButtons(activeHotspotId);
          }
        }
      }

      if (msg.state) {
        const uid = window.currentUserId;
        const savedTg = parseInt((uid ? localStorage.getItem(`proxdmr_u${uid}_tg`) : null) || localStorage.getItem("proxdmr_tg"), 10);
        const savedTg1 = parseInt((uid ? localStorage.getItem(`proxdmr_u${uid}_tg_ts1`) : null) || localStorage.getItem("proxdmr_tg_ts1"), 10);
        const savedTg2 = parseInt((uid ? localStorage.getItem(`proxdmr_u${uid}_tg_ts2`) : null) || localStorage.getItem("proxdmr_tg_ts2"), 10);
        const unifiedTg = (!isNaN(savedTg) && savedTg > 0) ? savedTg : ((!isNaN(savedTg2) && savedTg2 > 0) ? savedTg2 : ((!isNaN(savedTg1) && savedTg1 > 0) ? savedTg1 : (msg.state.active_tg || 2501)));

        tgTs1 = unifiedTg;
        tgTs2 = unifiedTg;
        if (uid) localStorage.setItem(`proxdmr_u${uid}_tg`, unifiedTg.toString());
        localStorage.setItem("proxdmr_tg", unifiedTg.toString());
        localStorage.setItem("proxdmr_tg_ts1", unifiedTg.toString());
        localStorage.setItem("proxdmr_tg_ts2", unifiedTg.toString());

        const initialSlot = (msg.state && msg.state.tx_slot) || parseInt((uid ? localStorage.getItem(`proxdmr_u${uid}_active_slot`) : null) || localStorage.getItem("proxdmr_active_slot"), 10) || 2;
        setActiveSlot(initialSlot, false);
        updateTgDisplay();

        if (ws && ws.readyState === WebSocket.OPEN) {
          if (unifiedTg !== msg.state.active_tg) {
            ws.send(JSON.stringify({ type: "set_tg", tg: unifiedTg, slot: initialSlot }));
          }
        }

        if (msg.state.loopback_mode !== undefined) {
          const actId = resolveHotspotId(activeHotspotId);
          const optLoopback = getOptLoopback();
          if (optLoopback) optLoopback.checked = getHotspotLoop(actId);
          document.querySelectorAll(".radio-container").forEach(card => {
            const cid = resolveHotspotId(card.dataset.hotspotId);
            const chk = card.querySelector(".loopback-toggle");
            if (chk) chk.checked = getHotspotLoop(cid);
          });
        }

        if (msg.state.mute_on_ptt !== undefined) {
          const mop = (msg.app_settings && msg.app_settings.mute_on_ptt !== undefined)
            ? msg.app_settings.mute_on_ptt
            : msg.state.mute_on_ptt;
          setMuteOnPttEnabled(mop);
        }

        if (msg.state.simultaneous_slots !== undefined) {
          const sim = (msg.app_settings && msg.app_settings.simultaneous_slots !== undefined)
            ? msg.app_settings.simultaneous_slots
            : msg.state.simultaneous_slots;
          setSimultaneousSlotsEnabled(sim);
        }

        const vStatePtt = msg.state.volume_up_ptt !== undefined
          ? msg.state.volume_up_ptt
          : msg.state.volume_down_ptt;
        if (vStatePtt !== undefined) {
          const appV = (msg.app_settings && (msg.app_settings.volume_up_ptt !== undefined ? msg.app_settings.volume_up_ptt : msg.app_settings.volume_down_ptt));
          const vdp = appV !== undefined ? appV : vStatePtt;
          setVolumeUpPttEnabled(vdp);
          setVolumeDownPttEnabled(vdp);
        }

        if (msg.state.vocoder_uvquality !== undefined && window.updateVocoderUI) {
          window.updateVocoderUI({
            uvquality: msg.state.vocoder_uvquality,
            spectral_enh: msg.state.vocoder_spectral_enh,
            float_mode: msg.state.vocoder_float_mode,
            max_repeats: msg.state.vocoder_max_repeats
          });
        }

        // Sync AGC state from server
        if (msg.state.agc) {
          const agcEnabled = msg.state.agc.enabled !== false;
          localStorage.setItem("proxdmr_agc", agcEnabled ? "true" : "false");
          localStorage.setItem("proxdmr_agc_default", agcEnabled ? "true" : "false");
          document.querySelectorAll(".agc-toggle").forEach(chk => {
            chk.checked = agcEnabled;
          });
          const mainAgcChk = document.getElementById("agcToggle");
          if (mainAgcChk) mainAgcChk.checked = agcEnabled;
          if (msg.state.agc.profile && window.updateAgcUI) {
            window.updateAgcUI(msg.state.agc.profile, msg.state.agc.max_gain_db, msg.state.agc.min_gain_db, msg.state.agc.hang_time);
          }
        }
        updateAllVolumeAndMuteUI();
        if (msg.client_settings && typeof msg.client_settings === "object" && Object.keys(msg.client_settings).length > 0) {
          applyServerClientSettings(msg.client_settings);
        }
      }
    } else if (msg.type === "theme_change") {
      const theme = msg.theme === "light" ? "light" : "dark";
      if (theme !== currentTheme) {
        setTheme(theme, false);
      }
    } else if (msg.type === "background_change") {
      const uid = window.currentUserId;
      if (msg.bg_type_dark) {
        const dt = msg.bg_type_dark === "color" ? "color" : "pattern";
        if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_type_dark`, dt);
        localStorage.setItem("proxdmr_bg_type_dark", dt);
      }
      if (msg.bg_color_dark) {
        if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_color_dark`, msg.bg_color_dark);
        localStorage.setItem("proxdmr_bg_color_dark", msg.bg_color_dark);
      }
      if (msg.bg_type_light) {
        const lt = msg.bg_type_light === "color" ? "color" : "pattern";
        if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_type_light`, lt);
        localStorage.setItem("proxdmr_bg_type_light", lt);
      }
      if (msg.bg_color_light) {
        if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_color_light`, msg.bg_color_light);
        localStorage.setItem("proxdmr_bg_color_light", msg.bg_color_light);
      }
      if (msg.theme_target && msg.bg_type) {
        const norm = msg.bg_type === "color" ? "color" : "pattern";
        if (msg.theme_target === "light") {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_type_light`, norm);
          localStorage.setItem("proxdmr_bg_type_light", norm);
          if (msg.bg_color) {
            if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_color_light`, msg.bg_color);
            localStorage.setItem("proxdmr_bg_color_light", msg.bg_color);
          }
        } else {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_type_dark`, norm);
          localStorage.setItem("proxdmr_bg_type_dark", norm);
          if (msg.bg_color) {
            if (uid) localStorage.setItem(`proxdmr_u${uid}_bg_color_dark`, msg.bg_color);
            localStorage.setItem("proxdmr_bg_color_dark", msg.bg_color);
          }
        }
      }
      applyBackgroundForActiveTheme();
      if (typeof syncThemeBgTabs === "function") {
        syncThemeBgTabs(currentTheme);
      }
    } else if (msg.type === "wallpaper_change") {
      const theme = msg.theme || "dark";
      const url = msg.url;
      if (url) {
        const uid = window.currentUserId;
        if (uid) {
          localStorage.setItem(`proxdmr_u${uid}_bg_custom_${theme}`, url);
        }
        localStorage.setItem("proxdmr_bg_custom_" + theme, url);
        if (theme === currentTheme) {
          applyBackground("pattern");
        }
        if (typeof syncThemeBgTabs === "function") {
          syncThemeBgTabs(currentTheme);
        }
      }
    } else if (msg.type === "wallpaper_reset") {
      const theme = msg.theme || "dark";
      const uid = window.currentUserId;
      if (uid) {
        localStorage.removeItem(`proxdmr_u${uid}_bg_custom_${theme}`);
      }
      localStorage.removeItem("proxdmr_bg_custom_" + theme);
      if (theme === currentTheme) {
        applyBackground("pattern");
      }
      if (typeof syncThemeBgTabs === "function") {
        syncThemeBgTabs(currentTheme);
      }
    } else if (msg.type === "calls_cleared") {
      heardCalls = [];
      window.heardCalls = [];
      if (window.__proxdmr && typeof window.__proxdmr.clearHeardCalls === "function") {
        window.__proxdmr.clearHeardCalls();
      } else if (window.__proxdmr && typeof window.__proxdmr.setHeardCalls === "function") {
        window.__proxdmr.setHeardCalls([]);
      }
      renderLogList();
      if (typeof showToast === "function") {
        showToast(window.t ? window.t("live.log_cleared", {}, "Буфер лога очищен") : "Буфер лога очищен", "info");
      }
    } else if (msg.type === "swl_change") {
      if (typeof window.setSwlState === "function") {
        window.setSwlState(Boolean(msg.is_swl));
      }
    } else if (msg.type === "language_change") {
      const lang = msg.language;
      if (lang) {
        localStorage.setItem("proxdmr_language", lang);
        const optLanguage = document.getElementById("optLanguage");
        if (optLanguage) optLanguage.value = lang;
        if (window.I18N && window.I18N.currentLanguage !== lang) {
          window.I18N.setLanguage(lang);
        }
      }
    } else if (msg.type === "quick_mem_change") {
      if (msg.all_quick_mem && typeof msg.all_quick_mem === "object") {
        for (const [k, v] of Object.entries(msg.all_quick_mem)) {
          const locKey = k.startsWith("hs_") ? `proxdmr_quick_mem_${k}` : `proxdmr_quick_mem_hs_${k}`;
          if (v) {
            localStorage.setItem(locKey, JSON.stringify(v));
          } else {
            localStorage.removeItem(locKey);
          }
        }
      } else if (msg.key) {
        const locKey = msg.key.startsWith("hs_") ? `proxdmr_quick_mem_${msg.key}` : `proxdmr_quick_mem_hs_${msg.key}`;
        if (msg.data) {
          localStorage.setItem(locKey, JSON.stringify(msg.data));
        } else {
          localStorage.removeItem(locKey);
        }
      }
      if (typeof renderQuickMemButtons === "function") {
        renderQuickMemButtons(activeHotspotId);
      }
    } else if (msg.type === "loopback_change") {
      const enabled = Boolean(msg.enabled);
      const loopbackToggle = document.getElementById("loopbackToggle");
        if (loopbackToggle) loopbackToggle.checked = enabled;
      document.querySelectorAll(".loopback-toggle").forEach(chk => {
        chk.checked = enabled;
      });
    } else if (msg.type === "mute_on_ptt_change") {
      setMuteOnPttEnabled(Boolean(msg.enabled));
    } else if (msg.type === "volume_up_ptt_change" || msg.type === "volume_down_ptt_change") {
      setVolumeUpPttEnabled(Boolean(msg.enabled));
      setVolumeDownPttEnabled(Boolean(msg.enabled));
    } else if (msg.type === "haptic_feedback_change") {
      setHapticEnabled(Boolean(msg.enabled), false);
    } else if (msg.type === "haptic_duration_change") {
      setHapticDuration(Number(msg.duration), false);
    } else if (msg.type === "simultaneous_slots_change") {
      setSimultaneousSlotsEnabled(Boolean(msg.enabled), false);
    } else if (msg.type === "check_mic_on_tx_change") {
      if (typeof window.setCheckMicOnTxEnabled === "function") {
        window.setCheckMicOnTxEnabled(Boolean(msg.enabled), false);
      }
    } else if (msg.type === "vocoder_settings_change") {
      if (window.updateVocoderUI) {
        window.updateVocoderUI(msg.settings);
      }
    } else if (msg.type === "agc_state" || msg.type === "agc_settings") {
      const agcEnabled = msg.enabled !== false;
      localStorage.setItem("proxdmr_agc", agcEnabled ? "true" : "false");
      localStorage.setItem("proxdmr_agc_default", agcEnabled ? "true" : "false");
      document.querySelectorAll(".agc-toggle").forEach(chk => {
        chk.checked = agcEnabled;
      });
      const mainAgcChk = document.getElementById("agcToggle");
      if (mainAgcChk) mainAgcChk.checked = agcEnabled;
      if (msg.profile && window.updateAgcUI) {
        window.updateAgcUI(msg.profile, msg.max_gain_db, msg.min_gain_db, msg.hang_time);
      }
      if (msg.profile) {
        localStorage.setItem("proxdmr_agc_profile", msg.profile);
      }
      if (msg.max_gain_db !== undefined) localStorage.setItem("proxdmr_agc_max_gain_db", String(msg.max_gain_db));
      if (msg.min_gain_db !== undefined) localStorage.setItem("proxdmr_agc_min_gain_db", String(msg.min_gain_db));
      if (msg.hang_time !== undefined) localStorage.setItem("proxdmr_agc_hang_time", String(msg.hang_time));
    } else if (msg.type === "bm_benchmark_progress") {
      if (typeof handleBmBenchmarkProgress === "function") {
        handleBmBenchmarkProgress(msg);
      }
    } else if (msg.type === "bm_benchmark_complete") {
      if (typeof handleBmBenchmarkComplete === "function") {
        handleBmBenchmarkComplete(msg);
      }
    } else if (msg.type === "bm_ping") {
      if (msg.pings) cachedBmPings = { ...cachedBmPings, ...msg.pings };
      if (msg.host_pings) cachedBmHostPings = { ...cachedBmHostPings, ...msg.host_pings };
      if (msg.hosts) cachedBmHostPings = { ...cachedBmHostPings, ...msg.hosts };
      if (msg.losses) cachedBmLosses = { ...cachedBmLosses, ...msg.losses };
      if (msg.host_losses) cachedBmHostLosses = { ...cachedBmHostLosses, ...msg.host_losses };

      const nowSec = msg.ts || Math.floor(Date.now() / 1000);
      const hp = msg.host_pings || msg.hosts || {};
      const pingHistObj = (typeof window !== "undefined" && window.bmPingHistory) || (window.bmPingHistory = {});
      Object.keys(hp).forEach(h => {
        if (!pingHistObj[h]) pingHistObj[h] = [];
        pingHistObj[h].push({ t: nowSec, ping: hp[h] });
        if (pingHistObj[h].length > 3000) {
          pingHistObj[h].splice(0, pingHistObj[h].length - 3000);
        }
      });

      const allCurHs = (typeof window !== "undefined" && window.currentHotspots && window.currentHotspots.length)
        ? window.currentHotspots
        : [{ id: ((typeof window !== "undefined" && window.activeHotspotId) || "default") }];

      allCurHs.forEach((hs, idx) => {
        const hid = hs.id || (idx === 0 ? "default" : `hs_${idx}`);
        const hhost = hs.bm_master_host || "2322.master.brandmeister.network";
        const isPrimary = (idx === 0) || (hid === "default") || (allCurHs[0] && allCurHs[0].id === hid);
        const isOnline = Boolean(hs && (hs.status === "ONLINE" || hs.status === "CONNECTING" || hs.status === "AUTHENTICATING" || hs.status === "CONFIGURING"));

        // For primary hotspot: always record ping 24/7 even when disconnected
        // For secondary hotspot: only record when active
        const hostAttempted = (hp[hhost] !== undefined);
        const hidAttempted = (msg.pings && msg.pings[hid] !== undefined);

        if ((hostAttempted || hidAttempted) && (isPrimary || isOnline)) {
          let pVal = null;
          if (hp[hhost] !== undefined && hp[hhost] !== null && !isNaN(Number(hp[hhost]))) {
            pVal = Number(hp[hhost]);
          } else if (msg.pings && msg.pings[hid] !== undefined && msg.pings[hid] !== null && !isNaN(Number(msg.pings[hid]))) {
            pVal = Number(msg.pings[hid]);
          }
          const hist = loadCardPingHistory(hid);
          hist.push({ t: nowSec, ping: pVal, host: hhost });
          saveCardPingHistory(hid);
        }
      });

      refreshAllCardsBmBanner();
    } else if (msg.type === "bm_status") {
      const targetHs = getCurrentHotspots().find(h => h.id === msg.hotspot_id);
      const isLive = isHotspotLiveCollapsed(msg.hotspot_id);
      if (isHotspotCollapsed(msg.hotspot_id) && !isLive) {
        if (targetHs) {
          targetHs.status = "DISCONNECTED";
          targetHs.detail = "Свернут / отключен";
        }
        updateBmStatus("DISCONNECTED", window.t ? window.t("status.bm_collapsed_detail", {}, "Свернут / отключен") : "Свернут / отключен", msg.hotspot_id);
        if (msg.status !== "DISCONNECTED" && msg.status !== "OFFLINE") {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "bm_disconnect", hotspot_id: msg.hotspot_id }));
            ws.send(JSON.stringify({ type: "hotspot_collapse", hotspot_id: msg.hotspot_id, collapsed: true }));
          }
          fetch(`/api/hotspots/${msg.hotspot_id}/disconnect`, { method: "POST" }).catch(() => {});
        }
        if (targetHs) {
          renderHotspotsList();
          renderHotspotSelect();
        }
        return;
      }
      if (targetHs) {
        targetHs.status = msg.status;
        targetHs.detail = msg.detail;
      }
      updateBmStatus(msg.status, msg.detail, msg.hotspot_id);
      if (targetHs) {
        renderHotspotsList();
        renderHotspotSelect();
      }
    } else if (msg.type === "dmr_activity") {
      if (msg.call_entry) {
        if (window.__proxdmr && typeof window.__proxdmr.addOrUpdateCall === "function") {
          window.__proxdmr.addOrUpdateCall(msg.call_entry);
        } else if (typeof addOrUpdateCall === "function") {
          addOrUpdateCall(msg.call_entry);
        }
      } else if (!msg.active) {
        if (window.__proxdmr && typeof window.__proxdmr.endCall === "function") {
          window.__proxdmr.endCall(msg);
        } else {
          const targetCalls = window.heardCalls || heardCalls;
          if (msg.discard || (msg.duration !== undefined && msg.duration < 0.5)) {
            if (msg.call_id) {
              window.heardCalls = targetCalls.filter(c => c.id !== msg.call_id);
            } else if (msg.slot && msg.hotspot_id) {
              window.heardCalls = targetCalls.filter(c => !((c.hotspot_id || "default") === msg.hotspot_id && c.slot === msg.slot && c.active));
            }
          } else {
            const nowSec = Date.now() / 1000;
            let matched = false;
            targetCalls.forEach(c => {
              if (msg.call_id && c.id === msg.call_id) {
                c.active = false;
                c.duration = msg.duration !== undefined ? msg.duration : Math.max(0.5, Number((nowSec - (c.timestamp || nowSec)).toFixed(1)));
                matched = true;
              }
            });
            if (!matched && msg.slot && msg.hotspot_id) {
              targetCalls.forEach(c => {
                if ((c.hotspot_id || "default") === msg.hotspot_id && c.slot === msg.slot && c.active) {
                  c.active = false;
                  c.duration = msg.duration !== undefined ? msg.duration : Math.max(0.5, Number((nowSec - (c.timestamp || nowSec)).toFixed(1)));
                }
              });
            }
          }
          renderLogList();
        }
        if (window.audioPlayer && typeof window.audioPlayer.onTransmissionEnd === "function") {
          window.audioPlayer.onTransmissionEnd(msg.hotspot_id, msg.slot);
        }
      }

      // Update EXACT hotspot card (RX only; TX is handled by PTT state)
      if (!msg.is_tx) {
        const targetHid = msg.hotspot_id || activeHotspotId || "default";
        const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${targetHid}"]`);
        if (targetCard) {
        const slot = msg.slot;
        const vfoRow = targetCard.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
        const rxTag = targetCard.querySelector(slot === 1 ? ".vfo-ts1-rx" : ".vfo-ts2-rx");
        const modeBadgeEl = targetCard.querySelector(".mode-badge");

        if (msg.active) {
          if (vfoRow) {
            vfoRow.classList.add("vfo-rx-active");
            const callerFlagEl = vfoRow.querySelector(".ts-caller-flag");
            const callerCallEl = vfoRow.querySelector(".ts-caller-call");
            const callerIdEl = vfoRow.querySelector(".ts-caller-id");
            const callerCountryEl = vfoRow.querySelector(".ts-caller-country");
            const tgFlagEl = vfoRow.querySelector(".ts-tg-flag");
            const tgTextEl = vfoRow.querySelector(".ts-tg-text");

            const callerCountry = getCountryInfo(msg.src_id, msg.src_callsign);
            const tgCountry = getCountryInfo(msg.dst_id);
            const tgName = (window.TG_NAMES || {})[msg.dst_id] || (msg.dst_id === 9990 ? "Parrot / Echo" : "");

            const cCall = msg.src_callsign || (msg.src_id ? `ID: ${msg.src_id}` : "Unknown");
            const cName = msg.src_name || "";
            const displayName = `${cCall} ${cName}`.trim();

            if (callerFlagEl) {
              updateFlagElement(callerFlagEl, callerCountry);
              callerFlagEl.style.filter = "none";
            }
            if (callerCallEl) {
              if (!msg.src_callsign && msg.src_id) {
                callerCallEl.innerHTML = `ID: <span class="dmr-id-text">${msg.src_id}</span>`;
              } else {
                callerCallEl.textContent = displayName;
              }
              callerCallEl.classList.add("caller-active");
              callerCallEl.style.filter = "none";
              if (msg.src_id) {
                callerCallEl.dataset.radioId = msg.src_id;
                callerCallEl.dataset.callsign = msg.src_callsign || "";
                callerCallEl.dataset.name = msg.src_name || "";
                callerCallEl.title = window.t ? window.t("vfo.set_caller_tx_title", { id: msg.src_id }) : `Задать ID ${msg.src_id} для передачи (Private Call)`;
              }
            }
            if (callerIdEl) {
              callerIdEl.innerHTML = msg.src_id ? `(<span class="dmr-id-text">${msg.src_id}</span>)` : "";
              callerIdEl.style.filter = "none";
              if (msg.src_id) {
                callerIdEl.dataset.radioId = msg.src_id;
                callerIdEl.dataset.callsign = msg.src_callsign || "";
                callerIdEl.dataset.name = msg.src_name || "";
                callerIdEl.dataset.country = callerCountry?.name_en || "";
                callerIdEl.title = window.t ? window.t("vfo.set_caller_tx_title", { id: msg.src_id }) : `Задать ID ${msg.src_id} для передачи (Private Call)`;
              }
            }
            if (callerCountryEl) {
              callerCountryEl.textContent = callerCountry?.name_en || "";
              callerCountryEl.style.filter = "none";
            }

            if (tgFlagEl) {
              updateFlagElement(tgFlagEl, tgCountry, msg.dst_id === 9990);
              tgFlagEl.style.filter = "none";
            }
            if (tgTextEl) {
              const tgPrefix = msg.call_type === "GROUP" ? "TG" : "Call";
              const tgTitle = window.t ? window.t("vfo.set_tg_tx_title", { tg: msg.dst_id }) : `Задать TG ${msg.dst_id} для передачи на этом хотспоте`;
              tgTextEl.innerHTML = renderTgTextHtml(msg.dst_id, tgPrefix, tgName, tgTitle);
              tgTextEl.dataset.tgId = msg.dst_id;
              tgTextEl.style.filter = "none";
              tgTextEl.title = tgTitle;
            }

            // Persist last RX data on the card so it survives heardCalls trimming
            if (!targetCard._lastRx) targetCard._lastRx = {};
            targetCard._lastRx[slot] = {
              src_id: msg.src_id,
              src_callsign: msg.src_callsign,
              src_name: msg.src_name,
              dst_id: msg.dst_id,
              call_type: msg.call_type,
              active: true,
              timestamp: Date.now() / 1000,
              lastAudioTime: Date.now() / 1000
            };

          }
          if (rxTag) rxTag.classList.add("active");
          updateCardModeBadge(targetCard);
          updateCardRecUI(targetCard, targetHid);
          if (typeof window.updateCardPttHint === "function") {
            window.updateCardPttHint(targetCard);
          }
          updateCardRxLiveBanner(targetCard, {
            active: true,
            slot: slot,
            src_id: msg.src_id,
            src_callsign: msg.src_callsign,
            src_name: msg.src_name,
            talker_alias: msg.talker_alias,
            dst_id: msg.dst_id,
            hotspot_id: targetHid
          });

          if (window.AndroidBridge && typeof window.AndroidBridge.updateRadioStatus === "function") {
            try {
              const cCall = msg.src_callsign || (msg.src_id ? `ID: ${msg.src_id}` : "Unknown");
              window.AndroidBridge.updateRadioStatus(`RX: ${cCall} -> TG${msg.dst_id} (TS${slot})`);
            } catch (err) {
              console.warn("[AndroidBridge] updateRadioStatus RX failed:", err);
            }
          }
        } else {
          if (vfoRow) {
            vfoRow.classList.remove("vfo-rx-active");
            const callerCallEl = vfoRow.querySelector(".ts-caller-call");
            if (callerCallEl) callerCallEl.classList.remove("caller-active");
          }
          if (rxTag) rxTag.classList.remove("active");
          if (targetCard._lastRx && targetCard._lastRx[slot]) {
            targetCard._lastRx[slot].active = false;
            targetCard._lastRx[slot].endTime = Date.now() / 1000;
          }
          if (window.audioPlayer && typeof window.audioPlayer.onTransmissionEnd === "function") {
            window.audioPlayer.onTransmissionEnd(targetHid, slot);
          }
          updateCardModeBadge(targetCard);
          updateCardRecUI(targetCard, targetHid);
          const tsVuFill = targetCard.querySelector(slot === 1 ? ".vu-fill-ts1" : ".vu-fill-ts2");
          if (tsVuFill) tsVuFill.style.width = "0%";
          const tsVuFillVert = targetCard.querySelector(slot === 1 ? ".vu-fill-vert-ts1" : ".vu-fill-vert-ts2");
          if (tsVuFillVert) tsVuFillVert.style.height = "0%";
          const vuSt = getVuState(targetHid, slot);
          vuSt.mode = "IDLE";
          vuSt.target = 0;
          vuSt.current = 0;
          ensureVuMeterLoop();
          updateCardRxLiveBanner(targetCard, { active: false, hotspot_id: targetHid });

          if (window.AndroidBridge && typeof window.AndroidBridge.updateRadioStatus === "function") {
            if (typeof window !== "undefined" && !window.isPttPressed) {
              try {
                window.AndroidBridge.updateRadioStatus(window.t ? window.t("gw.standby_status", {}, "Дежурный прием (Standby)") : "Дежурный прием (Standby)");
              } catch (err) {
                console.warn("[AndroidBridge] updateRadioStatus standby failed:", err);
              }
            }
          }
        }
      }
    }
  } else if (msg.type === "caller_resolved") {
      if (window.__proxdmr && typeof window.__proxdmr.resolveCaller === "function") {
        window.__proxdmr.resolveCaller(msg);
      } else {
        let updated = false;
        (window.heardCalls || heardCalls).forEach(c => {
          if (c.src_id === msg.src_id) {
            if (msg.src_callsign) c.src_callsign = msg.src_callsign;
            if (msg.src_name) c.src_name = msg.src_name;
            if (msg.talker_alias) c.talker_alias = msg.talker_alias;
            if (msg.city) c.city = msg.city;
            c.caller_display = msg.caller_display;
            updated = true;
          }
        });
        if (updated) {
          renderLogList();
          if (typeof renderTranscriptionSummary === "function" && isTranscriptionSummaryOpen) {
            renderTranscriptionSummary();
          }
        }
      }

      const targetHid = msg.hotspot_id || activeHotspotId || "default";
      const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${targetHid}"]`);
      if (targetCard) {
        updateCardRxLiveBanner(targetCard, {
          active: true,
          slot: msg.slot,
          src_id: msg.src_id,
          src_callsign: msg.src_callsign,
          src_name: msg.src_name,
          talker_alias: msg.talker_alias,
          dst_id: msg.dst_id,
          hotspot_id: targetHid
        });

        const slot = msg.slot;
        const vfoRow = targetCard.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
        if (vfoRow) {
          const callerFlagEl = vfoRow.querySelector(".ts-caller-flag");
          const callerCallEl = vfoRow.querySelector(".ts-caller-call");
          const callerIdEl = vfoRow.querySelector(".ts-caller-id");
          const callerCountryEl = vfoRow.querySelector(".ts-caller-country");
          const country = getCountryInfo(msg.src_id, msg.src_callsign);
          const cCall = msg.src_callsign || (msg.src_id ? `ID: ${msg.src_id}` : "Unknown");
          const cName = msg.src_name || "";
          const displayName = `${cCall} ${cName}`.trim();

          if (callerFlagEl) {
            updateFlagElement(callerFlagEl, country);
            callerFlagEl.style.filter = "none";
          }
          if (callerCallEl) {
            if (!msg.src_callsign && msg.src_id) {
              callerCallEl.innerHTML = `ID: <span class="dmr-id-text">${msg.src_id}</span>`;
            } else {
              callerCallEl.textContent = displayName;
            }
            callerCallEl.style.filter = "none";
            if (msg.src_id) {
              callerCallEl.dataset.radioId = msg.src_id;
              if (msg.src_callsign) callerCallEl.dataset.callsign = msg.src_callsign;
              if (msg.src_name) callerCallEl.dataset.name = msg.src_name;
              callerCallEl.title = window.t ? window.t("vfo.set_caller_tx_title", { id: msg.src_id }) : `Задать ID ${msg.src_id} для передачи (Private Call)`;
            }
          }
          if (callerIdEl && msg.src_id) {
            callerIdEl.innerHTML = `(<span class="dmr-id-text">${msg.src_id}</span>)`;
            callerIdEl.style.filter = "none";
            callerIdEl.dataset.radioId = msg.src_id;
            if (msg.src_callsign) callerIdEl.dataset.callsign = msg.src_callsign;
            if (msg.src_name) callerIdEl.dataset.name = msg.src_name;
            if (country?.name_en) callerIdEl.dataset.country = country.name_en;
            callerIdEl.title = window.t ? window.t("vfo.set_caller_tx_title", { id: msg.src_id }) : `Задать ID ${msg.src_id} для передачи (Private Call)`;
          }
          if (callerCountryEl) {
            callerCountryEl.textContent = country?.name_en || "";
            callerCountryEl.style.filter = "none";
          }
        }
        if (targetCard._lastRx && targetCard._lastRx[slot]) {
          if (msg.src_callsign) targetCard._lastRx[slot].src_callsign = msg.src_callsign;
          if (msg.src_name) targetCard._lastRx[slot].src_name = msg.src_name;
        }
      }
    } else if (msg.type === "slot_change") {
      const hid = msg.hotspot_id || activeHotspotId;
      const card = document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`);
      if (card) {
        setCardSlot(card, msg.slot, false);
      }
    } else if (msg.type === "tg_change") {
      const hid = msg.hotspot_id || activeHotspotId;
      const hsObj = getCurrentHotspots().find(h => h.id === hid);
      const newTg = msg.active_tg || msg.tg || 2501;
      if (hsObj) {
        hsObj.default_tg = newTg;
        hsObj.default_tg_ts1 = newTg;
        hsObj.default_tg_ts2 = newTg;
      }
      localStorage.setItem(`proxdmr_tg_${hid}`, newTg.toString());
      localStorage.setItem(`proxdmr_tg_${hid}_ts1`, newTg.toString());
      localStorage.setItem(`proxdmr_tg_${hid}_ts2`, newTg.toString());
      if (hid === activeHotspotId) {
        tgTs1 = newTg;
        tgTs2 = newTg;
        localStorage.setItem("proxdmr_tg", newTg.toString());
        localStorage.setItem("proxdmr_tg_ts1", newTg.toString());
        localStorage.setItem("proxdmr_tg_ts2", newTg.toString());
      }
      const card = document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`);
      if (card) {
        updateCardTgDisplay(card);
        updateCardPttHint(card);
      } else {
        updateAllHotspotsTgDisplay();
      }
    } else if (msg.type === "active_hotspot_changed") {
      window.activeHotspotId = msg.active_hotspot_id;
      renderHotspotSelect();
      renderHotspotsList();
      applyActiveHotspotToUI();
    } else if (msg.type === "hotspot_collapse") {
      const hid = resolveHotspotId(msg.hotspot_id);
      const isCol = Boolean(msg.collapsed);
      const isLive = isHotspotLiveCollapsed(hid);
      const card = document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`)
        || (hid === resolveHotspotId("default") ? document.getElementById("radioContainer") : null);
      const hs = getCurrentHotspots().find(h => resolveHotspotId(h.id) === hid || h.id === hid);
      if (hs) {
        hs.collapsed = isCol;
        if (!isCol) hs.isLiveCollapsed = false;
      }
      localStorage.setItem(`proxdmr_collapsed_${hid}`, isCol ? "true" : "false");
      if (hid === resolveHotspotId("default") || hid === "default" || hid === "1") {
        localStorage.setItem("proxdmr_collapsed_default", isCol ? "true" : "false");
      }
      if (!isCol) {
        localStorage.setItem(`proxdmr_live_collapsed_${hid}`, "false");
        if (hid === resolveHotspotId("default") || hid === "default" || hid === "1") {
          localStorage.setItem("proxdmr_live_collapsed_default", "false");
        }
      }
      if (card) {
        card.classList.toggle("collapsed", isCol);
        card.classList.toggle("live-collapsed", isCol && isLive);
        const btn = card.querySelector(".hotspot-collapse-btn");
        if (btn) btn.title = isCol ? (window.t ? window.t("vfo.hotspot_expand_title") : "Развернуть этот хотспот") : (window.t ? window.t("vfo.hotspot_collapse_title") : "Свернуть этот хотспот (удержание: свернуть без отключения)");
        const nBadge = card.querySelector(".hotspot-name-badge");
        if (nBadge && isCol && !isLive) nBadge.classList.remove("is-online");
      }
      if (isCol && !isLive && typeof disableHotspotTranscribe === "function") {
        disableHotspotTranscribe(hid, true, false);
      }
      renderHotspotsList();
      renderHotspotSelect();
    } else if (msg.type === "transcribe_all_disabled") {
      if (typeof disableAllTranscribe === "function") {
        disableAllTranscribe(true, false);
      }
    } else if (msg.type === "hotspot_transcribe_disabled") {
      const hid = resolveHotspotId(msg.hotspot_id);
      if (typeof disableHotspotTranscribe === "function") {
        disableHotspotTranscribe(hid, true, false);
      }
    } else if (msg.type === "hotspot_updated") {
      const allHs = getCurrentHotspots();
      if (msg.hotspot && Array.isArray(allHs)) {
        const targetId = msg.hotspot.id;
        const resolvedTarget = resolveHotspotId(targetId);
        const hsObj = allHs.find(h => h.id === targetId || resolveHotspotId(h.id) === resolvedTarget);
        if (hsObj) {
          Object.assign(hsObj, msg.hotspot);
          if (msg.hotspot.auto_record !== undefined) {
            try { localStorage.setItem(`proxdmr_autorec_${resolvedTarget}`, msg.hotspot.auto_record ? "1" : "0"); } catch (_) {}
          }
          updateAllHotspotRecUI();
          if (typeof window.refreshAllCardsBmBanner === "function") {
            window.refreshAllCardsBmBanner();
          }
        } else {
          loadHotspots();
        }
      } else {
        loadHotspots();
      }
    } else if (msg.type === "hotspot_created" || msg.type === "hotspot_deleted") {
      loadHotspots();
    } else if (msg.type === "recording_transcribed") {
      updateCallLogTranscription(msg);
    } else if (msg.type === "call_transcription") {
      handleCallTranscription(msg);
    } else if (msg.type === "tts_speech") {
      if (typeof handleTtsSpeech === "function") {
        handleTtsSpeech(msg);
      } else if (window.__proxdmr && typeof window.__proxdmr.handleTtsSpeech === "function") {
        window.__proxdmr.handleTtsSpeech(msg);
      }
    } else if (msg.type === "transcription_error") {
      handleTranscriptionError(msg);
    } else if (msg.type === "tts_error") {
      if (typeof handleTtsError === "function") {
        handleTtsError(msg);
      } else if (window.handleTtsError) {
        window.handleTtsError(msg);
      }
    } else if (msg.type === "transcriber_settings_change") {
      if (window.transcriberSettings) {
        if (msg.target_lang !== undefined && msg.target_lang !== window.transcriberSettings.target_lang) {
          if (window.ttsAudioQueueManager) {
            window.ttsAudioQueueManager.stopAll();
          }
        }
        window.transcriberSettings.enabled = msg.enabled;
        window.transcriberSettings.model = msg.model;
        window.transcriberSettings.target_lang = msg.target_lang;
        if (msg.tts_engine !== undefined) window.transcriberSettings.tts_engine = msg.tts_engine;
        if (msg.tts_voice !== undefined) window.transcriberSettings.tts_voice = msg.tts_voice;
        if (msg.tts_speed !== undefined) window.transcriberSettings.tts_speed = msg.tts_speed;
        if (msg.tts_ducking_level !== undefined) window.transcriberSettings.tts_ducking_level = msg.tts_ducking_level;
        if (msg.tts_pause_ducking_level !== undefined) window.transcriberSettings.tts_pause_ducking_level = msg.tts_pause_ducking_level;
        if (msg.tts_mute_others !== undefined) {
          window.transcriberSettings.tts_mute_others = msg.tts_mute_others;
          const optMute = document.getElementById("optTtsMuteOthers");
          if (optMute) optMute.checked = Boolean(msg.tts_mute_others);
          const qSolo = document.getElementById("ttsQuickSolo");
          if (qSolo) qSolo.checked = Boolean(msg.tts_mute_others);
          if (typeof window.summaryTtsReader !== "undefined" && window.summaryTtsReader && window.summaryTtsReader.isPlaying) {
            window.summaryTtsReader.applySoloMute(Boolean(msg.tts_mute_others));
          }
        }
        if (msg.tts_announce_callsign !== undefined) {
          window.transcriberSettings.tts_announce_callsign = msg.tts_announce_callsign;
          const optAnnounce = document.getElementById("optTtsAnnounceCallsign");
          if (optAnnounce) optAnnounce.checked = Boolean(msg.tts_announce_callsign);
          const qAnnounce = document.getElementById("ttsQuickAnnounceCallsign");
          if (qAnnounce) qAnnounce.checked = Boolean(msg.tts_announce_callsign);
        }
      }
      const optNoTrans = document.getElementById("optTranscriberNoTranslate");
      const optTgtLang = document.getElementById("optTranscriberTargetLang");
      const grpTgtLang = document.getElementById("groupTranscriberTargetLang");
      if (optNoTrans && msg.target_lang !== undefined) {
        const isNo = (msg.target_lang === "none");
        optNoTrans.checked = isNo;
        if (optTgtLang) {
          optTgtLang.disabled = isNo;
          if (!isNo && msg.target_lang) optTgtLang.value = msg.target_lang;
        }
        if (grpTgtLang) {
          grpTgtLang.style.opacity = isNo ? "0.4" : "1";
          grpTgtLang.style.filter = isNo ? "grayscale(80%)" : "none";
          grpTgtLang.style.pointerEvents = isNo ? "none" : "";
        }
      }
    } else if (msg.type === "pong" || msg.type === "client_pong") {
      const now = Date.now();
      let sentTs = msg.client_ts;
      if (msg.seq !== undefined && msg.seq !== null && pendingPings.has(msg.seq)) {
        sentTs = pendingPings.get(msg.seq);
        pendingPings.delete(msg.seq);
      } else if (msg.client_ts) {
        for (const [s, sentTime] of pendingPings.entries()) {
          if (Math.abs(sentTime - msg.client_ts) < 200) {
            sentTs = sentTime;
            pendingPings.delete(s);
            break;
          }
        }
      }
      if (pendingPings.size > 0 && (msg.seq === undefined || !pendingPings.has(msg.seq))) {
        const oldestKey = pendingPings.keys().next().value;
        if (oldestKey !== undefined) {
          sentTs = sentTs || pendingPings.get(oldestKey);
          pendingPings.delete(oldestKey);
        }
      }
      const rtt = Math.max(0, Math.round(now - (sentTs || now)));
      lastReportedClientRtt = rtt;
      cachedClientRtt = (msg.rtt !== undefined && msg.rtt !== null) ? msg.rtt : rtt;
      if (msg.loss !== undefined && msg.loss !== null) {
        cachedClientLoss = msg.loss;
      }

      const nowSec = now / 1000;
      const pointPing = cachedClientRtt;
      const pointT = nowSec;

      if (clientPingHistory.length > 0) {
        const lastPt = clientPingHistory[clientPingHistory.length - 1];
        if (pointT <= lastPt.t) {
          lastPt.ping = pointPing;
        } else {
          clientPingHistory.push({ t: pointT, ping: pointPing });
        }
      } else {
        clientPingHistory.push({ t: pointT, ping: pointPing });
      }
      if (clientPingHistory.length > 3000) {
        clientPingHistory.splice(0, clientPingHistory.length - 3000);
      }
      window.clientPingHistory = clientPingHistory;
      try {
        localStorage.setItem("proxdmr_client_ping_recent", JSON.stringify(clientPingHistory.slice(-500)));
      } catch (_) {}

      document.querySelectorAll(".rtt-display").forEach(el => {
        el.textContent = `RTT: ${rtt}ms`;
      });
      const rttDisplay = document.getElementById("rttDisplay");
    if (rttDisplay) rttDisplay.textContent = `RTT: ${rtt}ms`;

      // Dynamically update UI on cards currently in client mode
      document.querySelectorAll(".radio-container").forEach(card => {
        const hid = resolveHotspotId(card.dataset.hotspotId || activeHotspotId || "default");
        if (getHotspotPingMode(hid) === "client") {
          const banner = card.querySelector(".bm-info-banner");
          if (banner) {
            const pingEl = banner.querySelector(".bm-banner-ping");
            if (pingEl) {
              const clientLossData = calculateClientPacketLoss();
              updatePingElement(pingEl, cachedClientRtt, clientLossData, "client");
            }
          }
          renderCardPingSparkline(card, "gw");
        }
      });
    } else if (msg.type === "bm_reconnecting_groups") {
      const hid = msg.hotspot_id || activeHotspotId;
      const hs = getCurrentHotspots().find(h => h.id === hid);
      if (hs) {
        hs.isManualBmDisconnect = false;
      }
      if (hid === activeHotspotId) {
        window.isManualBmDisconnect = false;
      }
      const notifyText = (window.t ? window.t("bmtg.reconnecting_after_mods") : null) || msg.message || "Переподключение к BrandMeister после изменения групп...";
      if (typeof showToast === "function") {
        showToast("🔄 " + notifyText, 3500);
      }
      const bmModalStatusText = document.getElementById("bmModalStatusText");
      if (bmModalStatusText) {
        bmModalStatusText.textContent = "🔄 " + notifyText;
      }
    }
  }
  window.__proxdmr.handleServerMessage = handleServerMessage;
export function startPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      const now = Date.now();
      const nowSec = now / 1000;
      if (ws && ws.readyState === WebSocket.OPEN) {
        let lostCount = 0;
        // Check if any previous pings timed out (> 3500ms)
        for (const [s, sentTime] of pendingPings.entries()) {
          if (now - sentTime > 3500) {
            pendingPings.delete(s);
            lostCount++;
            const lostT = sentTime / 1000;
            clientPingHistory.push({ t: lostT, ping: null });
          }
        }
        pingSeq = (pingSeq + 1) % 1000000;
        pendingPings.set(pingSeq, now);
        const clientLossData = (typeof window.calculateClientPacketLoss === "function")
          ? window.calculateClientPacketLoss()
          : null;
        try {
          ws.send(JSON.stringify({
            type: "client_ping",
            seq: pingSeq,
            ts: now,
            rtt: lastReportedClientRtt,
            lost: lostCount > 0,
            loss_pct: clientLossData ? clientLossData.lossPercent : undefined
          }));
        } catch (_) {}
      } else {
        // Gateway link unreachable: record lost ping and refresh UI
        if (pendingPings && pendingPings.size > 0) {
          for (const [s, sentTime] of pendingPings.entries()) {
            clientPingHistory.push({ t: sentTime / 1000, ping: null });
          }
          pendingPings.clear();
        }
        clientPingHistory.push({ t: nowSec, ping: null });
        if (clientPingHistory.length > 3000) {
          clientPingHistory.splice(0, clientPingHistory.length - 3000);
        }
        window.clientPingHistory = clientPingHistory;
        try {
          localStorage.setItem("proxdmr_client_ping_recent", JSON.stringify(clientPingHistory.slice(-500)));
        } catch (_) {}

        // Dynamically update UI on cards currently in client mode
        document.querySelectorAll(".radio-container").forEach(card => {
          const hid = resolveHotspotId(card.dataset.hotspotId || activeHotspotId || "default");
          if (getHotspotPingMode(hid) === "client") {
            const banner = card.querySelector(".bm-info-banner");
            if (banner) {
              const pingEl = banner.querySelector(".bm-banner-ping");
              if (pingEl) {
                const clientLossData = calculateClientPacketLoss(hid);
                updatePingElement(pingEl, null, clientLossData, "client");
              }
            }
            renderCardPingSparkline(card, "gw");
          }
        });
      }
    }, 1500);
  }

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("[NET] Browser online event detected. Forcing immediate WebSocket reconnection...");
    if (typeof window.connectWebSocket === "function" && !window.isManualGwDisconnect) {
      window.connectWebSocket(true);
    }
  });
}



// Global attachments
window.connectWebSocket = connectWebSocket;
window.handleGwDisconnectFailure = handleGwDisconnectFailure;
window.handleServerMessage = handleServerMessage;
window.startPing = startPing;

window.__proxdmr = window.__proxdmr || {};
window.__proxdmr.connectWebSocket = connectWebSocket;
window.__proxdmr.handleGwDisconnectFailure = handleGwDisconnectFailure;
window.__proxdmr.handleServerMessage = handleServerMessage;
window.__proxdmr.startPing = startPing;
