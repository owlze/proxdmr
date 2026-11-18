/**
 * ProxDMR - WebSocket Subsystem (modules/network/ws.js)
 * Manages WebSocket connection, auto-reconnect backoff, client ping heartbeat,
 * and dispatching 46+ server messages (audio, transcription, status, recordings, etc.).
 */

import { getCountryInfo, getCallCountryInfo, renderTgTextHtml, updateFlagElement, formatCallerLocation, getHotspotNetworkType } from '../core/formatters.js?v=2.9.712';
import { showToast } from '../core/toast.js?v=2.9.699';
import {
  updateGwStatus,
  checkBmApiStatus,
  setIsManualGwDisconnect,
  setWasGwConnected,
  setGwIsFastReconnecting,
  setGwConnectAttempt,
  setWsReconnectTimer,
  clearWsReconnectTimer
} from './watchdog.js?v=2.9.712';
import { getVuState, ensureVuMeterLoop, updateHotspotVuMeter } from '../audio/dsp.js?v=2.9.733';
import { getHotspotMute, getHotspotTsAudioMode, syncAllSlotMutesToServer, updateCardRecUI, updateAllHotspotRecUI } from '../audio/routing.js?v=2.9.729';
import {
  handleCallTranscription,
  handlePipelineStage,
  handleTranscriptionError,
  handleTtsSpeech,
  handleTtsError,
  updateCallLogTranscription,
  syncAllTranscribeSlotsToServer,
  disableAllTranscribe,
  disableHotspotTranscribe
} from '../dmr/transcriber.js?v=2.9.729';
import { renderTranscriptionSummary } from '../dmr/transcription.js?v=2.9.738';
import { renderQuickMemButtons } from '../dmr/quick-assign.js?v=2.9.736';
import { hydrateServerCollections } from '../settings/sync.js?v=2.9.737';
import { updateApkUpdateUI } from '../core/updater.js?v=2.9.711';
import { setHapticEnabled, setHapticDuration } from '../core/haptic.js?v=2.9.711';

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
const getOptLanguage = () => document.getElementById("optLanguage");

// Accessors for app functions
const resolveHotspotId = (id) => (window.resolveHotspotId ? window.resolveHotspotId(id) : id);
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
const RX_VISUAL_HOLD_MS = 850;

function _clearRxVisualHoldTimer(card, slot) {
  if (!card || !card._rxVisualHoldTimers) return;
  const s = Number(slot) === 2 ? 2 : 1;
  if (card._rxVisualHoldTimers[s]) {
    clearTimeout(card._rxVisualHoldTimers[s]);
    card._rxVisualHoldTimers[s] = null;
  }
}

export function connectWebSocket(force = false) {
    if (window.isSessionPausedByAnotherDevice && !force) {
      console.log("[WS] connectWebSocket ignored: session is paused by another device.");
      return;
    }
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
    const qp = new URLSearchParams();
    if (token) qp.set("token", token);
    if (window.PROXDMR_CLIENT_ID) qp.set("cid", window.PROXDMR_CLIENT_ID);
    const curLang = (window.I18N && typeof window.I18N.getLanguage === "function")
      ? window.I18N.getLanguage()
      : (localStorage.getItem("proxdmr_language") || "ru");
    if (curLang) qp.set("lang", curLang);
    const qs = qp.toString();
    const wsUrl = `${protocol}//${window.location.host}/ws/radio${qs ? "?" + qs : ""}`;

    window._gwIsConnectingPhase = true;
    const attemptText = window.gwIsFastReconnecting
      ? (window.t
          ? window.t("gw.fast_reconnect_attempt", { attempt: window.gwConnectAttempt }, `Быстрое переподключение к шлюзу (${window.gwConnectAttempt} из 5)...`)
          : `Быстрое переподключение к шлюзу (${window.gwConnectAttempt} из 5)...`)
      : (window.t
          ? window.t("gw.connect_attempt", { attempt: window.gwConnectAttempt }, `Подключение к шлюзу (попытка ${window.gwConnectAttempt} из 5)...`)
          : `Подключение к шлюзу (попытка ${window.gwConnectAttempt} из 5)...`);
    updateGwStatus(false, attemptText);

    if (window.isDemoExpired) {
      console.warn("[WS] Reconnect cancelled: demo session expired");
      return;
    }
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

    if (typeof window !== "undefined" && !window._wsUnloadListenerAdded) {
      window._wsUnloadListenerAdded = true;
      const closeOnUnload = () => {
        try {
          if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            ws.onclose = null;
            ws.close(1000, "Page unload");
          }
        } catch (_) {}
      };
      window.addEventListener("pagehide", closeOnUnload);
      window.addEventListener("beforeunload", closeOnUnload);
    }

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
      window._gwIsConnectingPhase = false;
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
        try {
          ws.send(JSON.stringify({ type: "disable_all_tts_slots" }));
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

        // 1. Multi-layer selective muting and simultaneous slot checks
        const cid = resolveHotspotId(hotspotId);

        // Check per-hotspot GW disconnect state (decoupled GW button)
        if (typeof window.isHotspotGwDisconnected === "function" && window.isHotspotGwDisconnected(cid)) {
          return;
        }

        // Ensure buffer has even length for 16-bit PCM playback & VU level calculation
        if (pcmBuffer.byteLength % 2 !== 0) {
          pcmBuffer = pcmBuffer.slice(0, pcmBuffer.byteLength - 1);
        }

        // 2. Exact duplicate guard ONLY for non-silent frames arriving within 10ms
        const burstKey = `${cid}_${slot}`;
        const nowMs = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        const prevBurst = lastRxBurstMap.get(burstKey);
        let sampleHash = 2166136261;
        let nonZeroSamples = 0;
        if (pcmBuffer.byteLength >= 4) {
          try {
            const u32 = new Uint32Array(pcmBuffer.buffer || pcmBuffer, pcmBuffer.byteOffset || 0, Math.floor(pcmBuffer.byteLength / 4));
            for (let i = 0; i < u32.length; i++) {
              const v = u32[i];
              if (v !== 0) nonZeroSamples++;
              sampleHash = Math.imul(sampleHash ^ v, 16777619);
            }
            sampleHash = (sampleHash ^ pcmBuffer.byteLength) >>> 0;
          } catch (_) {
            sampleHash = pcmBuffer.byteLength;
          }
        }
        if (nonZeroSamples > 8 && prevBurst && prevBurst.hash === sampleHash && (nowMs - prevBurst.time) < 10) {
          return;
        }
        lastRxBurstMap.set(burstKey, { hash: sampleHash, time: nowMs });

        // Во время попугай-теста отсекаем входящий сторонний радиоэфир
        if (window.isParrotActive) {
          return;
        }

        let targetCard = document.querySelector(`.radio-container[data-hotspot-id="${hotspotId}"]`)
          || document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
        if (!targetCard) {
          targetCard = Array.from(document.querySelectorAll(".radio-container")).find(
            c => resolveHotspotId(c.dataset.hotspotId) === cid
          ) || null;
        }
        const rxHid = targetCard ? resolveHotspotId(targetCard.dataset.hotspotId || cid) : cid;
        const nowSec = Date.now() / 1000;
        if (targetCard && slot) {
          const hsForRx = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(
            h => String(h.id) === String(hotspotId) || resolveHotspotId(h.id) === rxHid
          );
          const hsSlotObj = hsForRx ? (slot === 1 ? hsForRx.ts1 : hsForRx.ts2) : null;
          const prevSlotRx = targetCard._lastRx && targetCard._lastRx[slot];
          if (
            prevSlotRx &&
            !prevSlotRx.active &&
            prevSlotRx.endTime &&
            (nowSec - prevSlotRx.endTime) < 0.75 &&
            (!hsSlotObj || !hsSlotObj.active)
          ) {
            return;
          }
        }

        // Notify auto arbitration state machine only for live non-stale audio packets
        if (typeof window.handleAutoSlotActivity === "function") {
          window.handleAutoSlotActivity(cid, slot, true);
        }

        const mode = typeof getHotspotTsAudioMode === "function" ? getHotspotTsAudioMode(cid) : "solo";
        const isSlotMutedInStorage = (mode !== "auto") ? getHotspotMute(cid, slot) : false;
        const isSlotMutedInAudio = window.audioPlayer && audioPlayer.isSlotMuted && audioPlayer.isSlotMuted(cid, slot);
        const isAudioMuted = Boolean(isSlotMutedInStorage || isSlotMutedInAudio || isHotspotAudioMuted(cid) || isGlobalAudioMuted() || isPttAudioMuted());

        // 3. VU meter must read the buffer BEFORE feed(): feed() transfers the
        // ArrayBuffer to the AudioWorklet and detaches it on this thread.
        // VU meter and signal level indication MUST ALWAYS be active, even when audio playback is muted!
        updateHotspotVuMeter(hotspotId, slot, pcmBuffer);

        // 4. Feed audio to AudioWorklet ONLY if audio playback is unmuted (visual VU meters and timeslot indication continue regardless of mute)
        if (!isAudioMuted && window.audioPlayer && typeof audioPlayer.feed === "function") {
          audioPlayer.feed(pcmBuffer, cid, slot);
        }

        if (targetCard && slot) {
          if (!targetCard._lastRx) targetCard._lastRx = {};
          if (!targetCard._lastRx[slot]) {
            targetCard._lastRx[slot] = { active: true, slot: slot, _fromBinaryOnly: true };
          } else if (!targetCard._lastRx[slot].active) {
            targetCard._lastRx[slot]._fromBinaryOnly = true;
          }
          targetCard._lastRx[slot].lastAudioTime = nowSec;
          targetCard._lastRx[slot].active = true;

          const recBtn = targetCard.querySelector(".header-rec-btn");
          const recNeedsSync = Boolean(recBtn && !recBtn.classList.contains("rec-off") && !recBtn.classList.contains("recording"));

          const isAllStar = targetCard.classList.contains("card-net-allstar") || (typeof getHotspotNetworkType === "function" && getHotspotNetworkType(rxHid) === "allstar");
          if (isAllStar) {
            const aslHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(
              h => String(h.id) === String(hotspotId) || resolveHotspotId(h.id) === rxHid
            );
            let wasCarrierRx = false;
            if (aslHs) {
              wasCarrierRx = Boolean(aslHs._aslCarrierRx);
              aslHs._aslCarrierRx = true;
              aslHs._aslLastRxAudioMs = Date.now();
            }
            const aslRow = targetCard.querySelector(".vfo-allstar-row");
            let stateChanged = false;
            if (aslRow && !aslRow.classList.contains("allstar-rx-active")) {
              aslRow.classList.add("allstar-rx-active");
              stateChanged = true;
            }
            if (targetCard._aslRxSilenceTimer) {
              clearTimeout(targetCard._aslRxSilenceTimer);
            }
            targetCard._aslRxSilenceTimer = setTimeout(() => {
              targetCard._aslRxSilenceTimer = null;
              const lastSec = targetCard._lastRx?.[1]?.lastAudioTime || 0;
              if ((Date.now() / 1000) - lastSec >= 0.85) {
                const r = targetCard.querySelector(".vfo-allstar-row");
                if (r) r.classList.remove("allstar-rx-active");
                if (aslHs) {
                  aslHs._aslCarrierRx = false;
                  aslHs._aslRxActiveNode = "";
                  aslHs._aslKeyedNodes = [];
                }
                if (targetCard._lastRx?.[1]) {
                  targetCard._lastRx[1].active = false;
                }
                updateCardModeBadge(targetCard);
                updateCardRecUI(targetCard, rxHid);
                if (window.isAslDashVisible && typeof window.renderAslNodeDashboard === "function") {
                  window.renderAslNodeDashboard(rxHid);
                }
              }
            }, 900);
            if (stateChanged || !wasCarrierRx || recNeedsSync) {
              updateCardModeBadge(targetCard);
              updateCardRecUI(targetCard, rxHid);
              if (window.isAslDashVisible && typeof window.renderAslNodeDashboard === "function") {
                window.renderAslNodeDashboard(rxHid);
              }
            }
          } else {
            const isYsf = targetCard.classList.contains("card-net-ysf") || (typeof getHotspotNetworkType === "function" && getHotspotNetworkType(rxHid) === "ysf");
            if (isYsf) {
              const ysfHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(
                h => String(h.id) === String(hotspotId) || resolveHotspotId(h.id) === rxHid
              );
              if (ysfHs) {
                ysfHs._ysfCarrierRx = true;
                ysfHs._ysfLastRxAudioMs = Date.now();
              }
            }
            _clearRxVisualHoldTimer(targetCard, slot);
            const vfoRow = targetCard.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
            const rxTag = targetCard.querySelector(slot === 1 ? ".vfo-ts1-rx" : ".vfo-ts2-rx");
            let stateChanged = false;
            if (vfoRow && !vfoRow.classList.contains("vfo-rx-active") && !vfoRow.classList.contains("vfo-tx-active")) {
              vfoRow.classList.add("vfo-rx-active");
              stateChanged = true;
            }
            if (rxTag && !rxTag.classList.contains("active")) {
              rxTag.classList.add("active");
              stateChanged = true;
            }
            if (stateChanged || recNeedsSync) {
              updateCardModeBadge(targetCard);
              updateCardRecUI(targetCard, rxHid);
            }
          }
        }
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
      resetTranscribeAndTtsOnDisconnect();
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

export function resetTranscribeAndTtsOnDisconnect() {
  try {
    if (typeof window.disableAllTranscribe === "function") {
      window.disableAllTranscribe(true, false);
    } else if (window.__proxdmr && typeof window.__proxdmr.disableAllTranscribe === "function") {
      window.__proxdmr.disableAllTranscribe(true, false);
    }
  } catch (err) {
    console.warn("[WS] Error resetting transcribe on disconnect:", err);
  }
  try {
    if (typeof window.disableAllTts === "function") {
      window.disableAllTts(true, false);
    } else if (window.__proxdmr && typeof window.__proxdmr.disableAllTts === "function") {
      window.__proxdmr.disableAllTts(true, false);
    }
  } catch (err) {
    console.warn("[WS] Error resetting TTS on disconnect:", err);
  }
  window._appTranscribeWsInitDone = false;
}

export function handleGwDisconnectFailure(eventOrReason) {
    if (
      (eventOrReason && eventOrReason.code === 4010) ||
      window.isSessionPausedByAnotherDevice
    ) {
      enterSessionPausedState();
      return;
    }
    if (eventOrReason && eventOrReason.code === 4000) {
      // Stale socket silently replaced by same client instance
      return;
    }
    if (window._isRestoringPausedSession) {
      const btn = document.getElementById("btnRestorePausedSession");
      const btnLbl = document.getElementById("btnRestorePausedSessionLabel");
      if (btn) btn.disabled = false;
      if (btnLbl) {
        btnLbl.textContent = window.t
          ? window.t("gw.session_paused_restore_btn", {}, "Восстановить")
          : "Восстановить";
      }
    }
    resetTranscribeAndTtsOnDisconnect();
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

    // Demo session expired
    if ((eventOrReason && eventOrReason.code === 4009) || window.isDemoExpired) {
      console.warn("[WS] Demo session expired (4009)");
      window.isDemoExpired = true;
      window._gwIsConnectingPhase = false;
      clearWsReconnectTimer();
      setWasGwConnected(false);
      setIsManualGwDisconnect(true);
      if (typeof window.onDemoSessionExpired === "function") {
        window.onDemoSessionExpired();
      }
      return;
    }

    // Auth rejected by server
    if (eventOrReason && eventOrReason.code === 4001) {
      console.warn("[WS] Auth rejected (4001), showing login modal");
      window._gwIsConnectingPhase = false;
      updateGwStatus(false, window.t ? window.t("gw.auth_required", {}, "Требуется авторизация") : "Требуется авторизация");
      if (window.ProxDMRAuth) window.ProxDMRAuth.checkAuth();
      return;
    }

    // Connection limit exceeded (max 3 connections per account)
    if ((eventOrReason && eventOrReason.code === 4008) || window._isSessionLimitExceeded) {
      console.warn("[WS] Connection limit reached (4008)");
      window._gwIsConnectingPhase = false;
      clearWsReconnectTimer();
      setWasGwConnected(false);
      setIsManualGwDisconnect(true);
      const limitStatusTxt = window.t ? window.t("gw.session_limit_status", {}, "Лимит подключений (макс. 3 на аккаунт)") : "Лимит подключений (макс. 3 на аккаунт)";
      updateGwStatus(false, limitStatusTxt);
      if (!window._sessionLimitModalOpen) {
        window._sessionLimitModalOpen = true;
        const limitTitle = window.t ? window.t("gw.session_limit_title", {}, "Лимит одновременных подключений") : "Лимит одновременных подключений";
        const limitMsg = window.t
          ? window.t("gw.session_limit_msg", {}, "Допускается не более 3 одновременных подключений от одного аккаунта ProxDMR.<br><br>Пожалуйста, закройте одно из активных подключений (вкладку браузера или приложение на другом устройстве) и нажмите кнопку ниже для повторного входа.")
          : "Допускается не более 3 одновременных подключений от одного аккаунта ProxDMR.<br><br>Пожалуйста, закройте одно из активных подключений (вкладку браузера или приложение на другом устройстве) и нажмите кнопку ниже для повторного входа.";
        const retryBtnTxt = window.t ? window.t("gw.session_limit_retry_btn", {}, "🔄 Повторить подключение") : "🔄 Повторить подключение";
        if (typeof window.showAppAlert === "function") {
          window.showAppAlert({
            title: limitTitle,
            message: limitMsg,
            html: true,
            icon: "🚫",
            confirmText: retryBtnTxt
          }).then(() => {
            window._sessionLimitModalOpen = false;
            window._isSessionLimitExceeded = false;
            setIsManualGwDisconnect(false);
            connectWebSocket(true);
          });
        } else {
          showToast(`🚫 ${limitStatusTxt}`, 6000);
          window._sessionLimitModalOpen = false;
        }
      }
      return;
    }

    if (window.isManualGwDisconnect) {
      console.log("[WS] Disconnected manually by user, auto-reconnect disabled.");
      window._gwIsConnectingPhase = false;
      clearWsReconnectTimer();
      updateGwStatus(false, window.t ? window.t("gw.disconnected_user", {}, "Отключено пользователем") : "Отключено пользователем");
      return;
    }

    if (window._isServerRestarting) {
      clearWsReconnectTimer();
      setWasGwConnected(false);
      setGwIsFastReconnecting(true);
      setGwConnectAttempt(1);
      window._gwIsConnectingPhase = true;
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
      window._gwIsConnectingPhase = true;
      const delay = 1.0;
      console.warn(`[WS] Disconnected from server. Starting fast reconnect in ${delay}s (attempt 1/5)...`);
      updateGwStatus(false, window.t ? window.t("gw.reconnect_quick_first", {}, "Разрыв связи со шлюзом. Быстрый повтор через 1с (1 из 5)...") : "Разрыв связи со шлюзом. Быстрый повтор через 1с (1 из 5)...");
      setWsReconnectTimer(setTimeout(connectWebSocket, delay * 1000));
      return;
    }

    // Case 2: In fast reconnect series (after disconnect)
    if (window.gwIsFastReconnecting) {
      window._gwIsConnectingPhase = true;
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
    window._gwIsConnectingPhase = true;
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
    if (msg.type === "session_paused") {
      enterSessionPausedState();
      return;
    }
    if (msg.type === "session_limit_exceeded") {
      window._isSessionLimitExceeded = true;
      handleGwDisconnectFailure({ code: 4008 });
      return;
    }
    if (msg.type === "state_change") {
      if (msg.hotspot_id) {
        const badge = document.getElementById(`allstarStatusBadge_${msg.hotspot_id}`);
        if (badge) {
          if (msg.is_tx) {
            badge.className = "allstar-status-badge status-tx";
            badge.textContent = "TX";
          } else {
            const card = document.querySelector(`.radio-container[data-hotspot-id="${msg.hotspot_id}"]`);
            const isOnline = card && (card.dataset.status === "online" || card.dataset.status === "ONLINE");
            badge.className = isOnline ? "allstar-status-badge status-online" : "allstar-status-badge status-idle";
            badge.textContent = isOnline ? "CONNECTED" : "IDLE";
          }
        }
      }
      if (msg.is_tx === false) {
        if (typeof window.onServerTxEnded === "function") {
          window.onServerTxEnded(msg);
        }
      }
      return;
    }
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
    if (typeof msg.type === "string" && msg.type.startsWith("parrot_")) {
      if (typeof window.onParrotTestMessage === "function") {
        window.onParrotTestMessage(msg);
      }
      return;
    }
    if (msg.type === "transcriber_settings_change" || msg.type === "transcriber_settings_update") {
      if (typeof window.onTranscriberSettingsUpdate === "function") {
        window.onTranscriberSettingsUpdate(msg.settings || msg);
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
      window._gwIsConnectingPhase = true;
      const restartMsg = msg.message || (window.t ? window.t("gw.restarting_server", {}, "Перезагрузка сервера...") : "Перезагрузка сервера...");
      showToast(restartMsg, 8000);
      updateGwStatus(false, window.t ? window.t("gw.restarting_server", {}, "Перезагрузка сервера...") : "Перезагрузка сервера...");
      return;
    }
    if (msg.type === "demo_expired") {
      console.warn("[WS] Demo expired message received");
      window.isDemoExpired = true;
      if (typeof window.onDemoSessionExpired === "function") {
        window.onDemoSessionExpired(msg.cooldown_seconds || 60);
      }
      return;
    }

    if (msg.type === "init") {
      if (window._isRestoringPausedSession || document.getElementById("sessionPausedModal")?.classList.contains("active")) {
        window._isRestoringPausedSession = false;
        window.isSessionPausedByAnotherDevice = false;
        const pm = document.getElementById("sessionPausedModal");
        if (pm) {
          pm.classList.remove("active");
          pm.style.display = "none";
        }
      }
      if (msg.is_demo) {
        window.isDemoMode = true;
        document.body.classList.add("is-demo-mode");
        const updBanner = document.getElementById("systemUpdateBanner");
        if (updBanner) updBanner.style.display = "none";
        const updBadge = document.getElementById("systemUpdateBadgeHeader");
        if (updBadge) updBadge.style.display = "none";
        if (typeof window.stopAndReleaseMic === "function") {
          window.stopAndReleaseMic();
        }
        if (typeof window.initDemoHeaderTimer === "function") {
          window.initDemoHeaderTimer(msg.demo_expires_at, msg.demo_session_minutes, msg.demo_cooldown_seconds);
        }
      }
      if (msg.user_id) {
        window.currentUserId = msg.user_id;
      }
      if (msg.is_swl !== undefined && typeof window.setSwlState === "function") {
        window.setSwlState(Boolean(msg.is_swl));
      }
      window.activeHotspotId = msg.active_hotspot_id || "default";
      window.currentHotspots = msg.hotspots || [];
      if (msg.recording_state) {
        if (window.recordingsManager && typeof window.recordingsManager.onRecordingStateChanged === "function") {
          window.recordingsManager.onRecordingStateChanged(msg.recording_state);
        } else {
          if (!window.activeRecordingHotspotIds) window.activeRecordingHotspotIds = new Set();
          window.activeRecordingHotspotIds.clear();
          (msg.recording_state.recording_hotspots || []).forEach(hid => {
            window.activeRecordingHotspotIds.add(resolveHotspotId(hid));
            window.activeRecordingHotspotIds.add(String(hid));
          });
        }
      }

      // Атомарно гидратируем все серверные коллекции ДО первой отрисовки карточек/матриц
      if (msg.collections && typeof msg.collections === "object") {
        hydrateServerCollections(msg.collections);
        if (Array.isArray(msg.collections.ysf_favorites)) {
          try {
            localStorage.setItem("proxdmr_ysf_favorites", JSON.stringify(msg.collections.ysf_favorites));
          } catch (_) {}
          if (typeof window.loadYsfFavoritesFromServer === "function") {
            try { window.loadYsfFavoritesFromServer(); } catch (_) {}
          }
        }
      }

      const prevStorageUid = (() => {
        try { return localStorage.getItem("proxdmr_last_uid"); } catch (_) { return null; }
      })();
      if (msg.user_id && prevStorageUid && String(prevStorageUid) !== String(msg.user_id)) {
        try {
          const preserve = new Set(["proxdmr_auth_token", "proxdmr_auth_login", "proxdmr_demo_language"]);
          const toRm = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith("proxdmr_") || k.startsWith("dmr_")) && !preserve.has(k)) {
              toRm.push(k);
            }
          }
          toRm.forEach(k => localStorage.removeItem(k));
        } catch (_) {}
      }
      if (msg.user_id) {
        try { localStorage.setItem("proxdmr_last_uid", String(msg.user_id)); } catch (_) {}
      }
      if (typeof window !== "undefined" && typeof window.cancelPendingClientSettingsSync === "function") {
        window.cancelPendingClientSettingsSync();
      }

      // Restore user account client_settings from server if available
      if (msg.client_settings && typeof msg.client_settings === "object" && Object.keys(msg.client_settings).length > 0) {
        applyServerClientSettings(msg.client_settings);
        const uidPref = window.currentUserId ? `proxdmr_u${window.currentUserId}_` : null;
        if (typeof window.applyAppBorderRadius === "function") {
          const rVal = (uidPref && localStorage.getItem(uidPref + "border_radius")) || localStorage.getItem("proxdmr_border_radius") || "0";
          window.applyAppBorderRadius(rVal, false);
        }
        if (typeof window.applyToolbarBgForActiveTheme === "function") {
          window.applyToolbarBgForActiveTheme();
        } else if (typeof window.applyToolbarBgGradient === "function") {
          const tbTop = (uidPref && localStorage.getItem(uidPref + "toolbar_bg_top")) || localStorage.getItem("proxdmr_toolbar_bg_top") || "#0037b4";
          const tbBot = (uidPref && localStorage.getItem(uidPref + "toolbar_bg_bottom")) || localStorage.getItem("proxdmr_toolbar_bg_bottom") || "#001b43";
          window.applyToolbarBgGradient(tbTop, tbBot, false);
        }
      }
      if (typeof window !== "undefined") {
        window.__proxdmrClientSettingsHydrated = true;
      }

      // Сервер (hs.collapsed, active_hotspot_id) — эталон, с сохранением клиентского live-collapsed пока сервер держит хотспот активным
      const allHs = window.currentHotspots || [];
      const preListActiveHid = window.activeHotspotId;
      allHs.forEach((hs, idx) => {
        const cid = resolveHotspotId(hs.id);
        const serverCollapsed = (typeof hs.collapsed === "boolean") ? hs.collapsed : (idx > 0);
        const isLive = !hs.hidden && !serverCollapsed && isHotspotLiveCollapsed(cid);
        const shouldCollapse = serverCollapsed || isLive;
        try {
          localStorage.setItem(`proxdmr_collapsed_${cid}`, shouldCollapse ? "true" : "false");
          if (hs.hidden || serverCollapsed) {
            localStorage.setItem(`proxdmr_live_collapsed_${cid}`, "false");
          }
        } catch (_) {}
        hs.collapsed = shouldCollapse;
        hs.isLiveCollapsed = Boolean(shouldCollapse && isLive);
        if (shouldCollapse && !isLive) {
          if (typeof disableHotspotTranscribe === "function") {
            disableHotspotTranscribe(cid, true, false);
          }
          hs.status = "DISCONNECTED";
          hs.detail = window.t ? window.t("status.bm_collapsed_detail", {}, "Свернут / отключен") : "Свернут / отключен";
        }
      });

      const srvActiveHs = msg.active_hotspot_id || (msg.active_hotspot && msg.active_hotspot.id) || null;
      if (srvActiveHs && allHs.some(h => h.id === srvActiveHs && (!isHotspotCollapsed(h.id) || isHotspotLiveCollapsed(h.id)))) {
        window.activeHotspotId = srvActiveHs;
      } else if (isHotspotCollapsed(window.activeHotspotId) && !isHotspotLiveCollapsed(window.activeHotspotId)) {
        const firstOpen = allHs.find(h => !isHotspotCollapsed(h.id) || isHotspotLiveCollapsed(h.id));
        if (firstOpen) {
          window.activeHotspotId = firstOpen.id;
        } else if (allHs[0]) {
          window.activeHotspotId = allHs[0].id;
        }
      }
      if (window.activeHotspotId) {
        try { localStorage.setItem("proxdmr_active_hotspot_id", window.activeHotspotId); } catch (_) {}
      }

      if (typeof window !== "undefined" && window.isLogVisible && typeof window.closeLogIfOpenForHotspot === "function") {
        for (const hs of allHs) {
          if (hs && (hs.hidden || hs.collapsed)) {
            if (window.closeLogIfOpenForHotspot(hs.id, { previousActiveHotspotId: preListActiveHid, skipRefreshIfKeptOpen: true })) {
              break;
            }
          }
        }
      }

      if (typeof window.renderHotspotSelect === "function") {
        window.renderHotspotSelect();
      }
      if (typeof window.renderHotspotsList === "function") {
        window.renderHotspotsList();
      }
      if (typeof window.renderRadiosGrid === "function") {
        window.renderRadiosGrid();
      }
      if (typeof window.applyActiveHotspotToUI === "function") {
        window.applyActiveHotspotToUI();
      }
      if (typeof window.renderToolbarHotspotSlots === "function") {
        window.renderToolbarHotspotSlots();
      }
      if (typeof window.updateAllHotspotRecUI === "function") {
        window.updateAllHotspotRecUI();
      }
      if (window.recordingsManager) {
        if (typeof window.recordingsManager.preloadRecordedCallIds === "function") {
          window.recordingsManager.preloadRecordedCallIds();
        }
        if (typeof window.recordingsManager.loadStats === "function") {
          window.recordingsManager.loadStats();
        }
        if (typeof window.recordingsManager.checkOfflineTranscribeStatus === "function") {
          window.recordingsManager.checkOfflineTranscribeStatus();
        }
      }
      if (typeof window !== "undefined") {
        if (typeof window.syncActiveAudioRxPreset === "function") {
          try { window.syncActiveAudioRxPreset(window.activeHotspotId); } catch (_) {}
        }
        if (typeof window.syncActiveAudioTxPreset === "function") {
          try { window.syncActiveAudioTxPreset(window.activeHotspotId); } catch (_) {}
        }
        if (typeof window.refreshAmbeVocoderFromStorage === "function") {
          try { window.refreshAmbeVocoderFromStorage(); } catch (_) {}
        }
        if (typeof window.updateAudioRxPresetUI === "function") {
          try { window.updateAudioRxPresetUI(); } catch (_) {}
        }
        if (typeof window.updateAudioTxPresetUI === "function") {
          try { window.updateAudioTxPresetUI(); } catch (_) {}
        }
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
          if (rCount) {
            rCount.textContent = window.t
              ? window.t("bmbench.servers_count", { count: msg.bm_benchmark_results.length }, `${msg.bm_benchmark_results.length} серверов`)
              : `${msg.bm_benchmark_results.length} серверов`;
          }
        }
      }
      if (msg.bm_benchmark_running !== undefined) {
        isBenchmarkRunning = Boolean(msg.bm_benchmark_running);
        if (typeof setBenchmarkRunningUI === "function") {
          setBenchmarkRunningUI(isBenchmarkRunning);
        }
      }
      if (msg.server_probe_cache && typeof msg.server_probe_cache === "object") {
        window._dmrServersCache = window._dmrServersCache || {};
        Object.keys(msg.server_probe_cache).forEach(k => {
          const entry = msg.server_probe_cache[k];
          if (entry && Array.isArray(entry.results) && entry.results.length > 0) {
            window._dmrServersCache[k.toLowerCase()] = entry.results;
          }
        });
        window._dmrServersCacheVer = Date.now();
        if (typeof refreshAllCardsBmBanner === "function") {
          refreshAllCardsBmBanner();
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
        const serverNowSec = msg.server_time ? (msg.server_time / 1000) : nowSec;
        const cutoff = serverNowSec - 86400;
        const activeCallIdSet = Array.isArray(msg.active_call_ids) ? new Set(msg.active_call_ids.map(String)) : null;
        // Clean up any stale active calls and filter to retention window of 24h
        const cleanCalls = msg.calls
          .filter(c => {
            if ((c.timestamp || serverNowSec) < cutoff) return false;
            const isAsl = Boolean(c.is_asl || c.mode === "asl" || c.network_type === "allstar" || String(c.hotspot_id).toLowerCase().includes("asl") || String(c.hotspot_id).toLowerCase().includes("allstar"));
            if (isAsl && !c.is_tx && (!c.duration || c.duration < 0.8) && !c.transcription && !c.active) {
              return false;
            }
            return (c.active || (c.duration && c.duration >= 0.5) || c.transcription);
          })
          .map(c => {
            const cIdStr = String(c.id || "");
            const isAuthoritativeActive = activeCallIdSet
              ? activeCallIdSet.has(cIdStr)
              : Boolean(c.active && c.timestamp && (serverNowSec - c.timestamp <= 120.0));
            if (c.active && !isAuthoritativeActive) {
              return {
                ...c,
                active: false,
                duration: c.duration || Math.max(0.5, Number((serverNowSec - (c.timestamp || serverNowSec)).toFixed(1)))
              };
            }
            return c;
          });
        heardCalls = cleanCalls;
        window.heardCalls = cleanCalls;
        if (window.__proxdmr && typeof window.__proxdmr.setHeardCalls === "function") {
          window.__proxdmr.setHeardCalls(cleanCalls);
        }
        if (typeof window.getStoredLastRx === "function" && typeof window.saveStoredLastRx === "function") {
          cleanCalls.forEach(c => {
            if (!c.is_tx && (c.slot === 1 || c.slot === 2)) {
              const hid = c.hotspot_id || "default";
              if (!window.getStoredLastRx(hid, c.slot)) {
                window.saveStoredLastRx(hid, c.slot, c);
              }
            }
          });
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
          const demoLang = (msg.is_demo || window.isDemoMode) ? localStorage.getItem("proxdmr_demo_language") : null;
          const sLang = demoLang || msg.app_settings.language;
          if (!msg.is_demo && !window.isDemoMode) {
            if (uid) localStorage.setItem(`proxdmr_u${uid}_language`, sLang);
            localStorage.setItem("proxdmr_language", sLang);
          }
          const optLanguage = document.getElementById("optLanguage");
          if (optLanguage) optLanguage.value = sLang;
          if (window.I18N && window.I18N.currentLanguage !== sLang) {
            window.I18N.setLanguage(sLang);
          }
        }
        if (msg.app_settings.simultaneous_slots !== undefined) {
          const rawLocalMode = localStorage.getItem("proxdmr_ts_mode_default");
          const rawLocalSim = localStorage.getItem("proxdmr_simultaneous_slots");
          // If the user already has a saved local choice, prioritize it and heal/sync back to server
          if (rawLocalMode === "solo" || rawLocalSim === "false") {
            if (msg.app_settings.simultaneous_slots) {
              setSimultaneousSlotsEnabled(false, true);
            } else {
              setSimultaneousSlotsEnabled(false, false);
            }
          } else if (rawLocalMode === "auto" || rawLocalSim === "true") {
            if (!msg.app_settings.simultaneous_slots) {
              setSimultaneousSlotsEnabled(true, true);
            } else {
              setSimultaneousSlotsEnabled(true, false);
            }
          } else {
            const srvEnabled = Boolean(msg.app_settings.simultaneous_slots);
            setSimultaneousSlotsEnabled(srvEnabled, false);
          }
          if (uid) localStorage.setItem(`proxdmr_u${uid}_simultaneous_slots`, localStorage.getItem("proxdmr_simultaneous_slots"));
        }
        if (msg.app_settings.check_mic_on_tx !== undefined) {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_check_mic_on_tx`, msg.app_settings.check_mic_on_tx ? "true" : "false");
          localStorage.setItem("proxdmr_check_mic_on_tx", msg.app_settings.check_mic_on_tx ? "true" : "false");
          if (typeof window.setCheckMicOnTxEnabled === "function") {
            window.setCheckMicOnTxEnabled(msg.app_settings.check_mic_on_tx, false);
          }
        }
        if (msg.app_settings.single_hotspot_audio !== undefined) {
          if (uid) localStorage.setItem(`proxdmr_u${uid}_single_hotspot_audio`, msg.app_settings.single_hotspot_audio ? "true" : "false");
          localStorage.setItem("proxdmr_single_hotspot_audio", msg.app_settings.single_hotspot_audio ? "true" : "false");
          if (typeof window.setSingleHotspotAudioEnabled === "function") {
            window.setSingleHotspotAudioEnabled(msg.app_settings.single_hotspot_audio, false);
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
        // HAM Web Portals Settings (QRZ.com, HamQTH)
        const demoCallPlaceholder = window.t ? window.t("demo.your_callsign", {}, "Your CALL") : "Your CALL";
        const isDemoClient = Boolean(msg.is_demo || window.isDemoMode);

        if (msg.app_settings.qrz_com_username !== undefined) {
          const opt = document.getElementById("optQrzComUsername");
          if (opt) {
            if (isDemoClient) opt.value = demoCallPlaceholder;
            else if (!opt.value || opt.value === "") opt.value = msg.app_settings.qrz_com_username || "";
          }
        }
        if (msg.app_settings.qrz_com_password !== undefined) {
          const opt = document.getElementById("optQrzComPassword");
          if (opt) {
            if (isDemoClient) opt.value = "••••••••••••";
            else if (!opt.value || opt.value === "") opt.value = msg.app_settings.qrz_com_password || "";
          }
        }
        if (msg.app_settings.hamqth_username !== undefined) {
          const optU = document.getElementById("optHamQthUsername");
          if (optU) {
            if (isDemoClient) optU.value = demoCallPlaceholder;
            else if (!optU.value || optU.value === "") optU.value = msg.app_settings.hamqth_username || "";
          }
        }
        if (msg.app_settings.hamqth_password !== undefined) {
          const optP = document.getElementById("optHamQthPassword");
          if (optP) {
            if (isDemoClient) optP.value = "••••••••••••";
            else if (!optP.value || optP.value === "") optP.value = msg.app_settings.hamqth_password || "";
          }
        }
        try {
          const toWipe = [];
          for (let i = 0; i < localStorage.length; i++) {
            const lk = localStorage.key(i);
            if (lk && (lk.startsWith("proxdmr_quick_mem") || /^proxdmr_u\d+_quick_mem/.test(lk) || lk.startsWith("proxdmr_asl_mem_"))) {
              toWipe.push(lk);
            }
          }
          toWipe.forEach(lk => localStorage.removeItem(lk));
        } catch (_) {}

        if (msg.app_settings.quick_mem && typeof msg.app_settings.quick_mem === "object") {
          for (const [k, v] of Object.entries(msg.app_settings.quick_mem)) {
            const locKey = k.startsWith("hs_") ? `proxdmr_quick_mem_${k}` : `proxdmr_quick_mem_hs_${k}`;
            const userLocKey = uid ? `proxdmr_u${uid}_quick_mem_${k}` : null;
            if (v) {
              if (userLocKey) localStorage.setItem(userLocKey, JSON.stringify(v));
              localStorage.setItem(locKey, JSON.stringify(v));
            }
          }
        }
        if (msg.app_settings.asl_mem && typeof msg.app_settings.asl_mem === "object") {
          for (const [k, v] of Object.entries(msg.app_settings.asl_mem)) {
            const locKey = `proxdmr_asl_mem_${k}`;
            if (v) {
              localStorage.setItem(locKey, String(v));
            }
          }
        }
        if (typeof renderQuickMemButtons === "function") {
          renderQuickMemButtons(activeHotspotId);
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

        if (msg.state.mute_on_ptt !== undefined) {
          const mop = (msg.app_settings && msg.app_settings.mute_on_ptt !== undefined)
            ? msg.app_settings.mute_on_ptt
            : msg.state.mute_on_ptt;
          setMuteOnPttEnabled(mop);
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
          const uidPref = window.currentUserId ? `proxdmr_u${window.currentUserId}_` : null;
          if (typeof window.applyAppBorderRadius === "function") {
            const rVal = (uidPref && localStorage.getItem(uidPref + "border_radius")) || localStorage.getItem("proxdmr_border_radius") || "0";
            window.applyAppBorderRadius(rVal, false);
          }
          if (typeof window.applyToolbarBgForActiveTheme === "function") {
            window.applyToolbarBgForActiveTheme();
          } else if (typeof window.applyToolbarBgGradient === "function") {
            const tbTop = (uidPref && localStorage.getItem(uidPref + "toolbar_bg_top")) || localStorage.getItem("proxdmr_toolbar_bg_top") || "#0037b4";
            const tbBot = (uidPref && localStorage.getItem(uidPref + "toolbar_bg_bottom")) || localStorage.getItem("proxdmr_toolbar_bg_bottom") || "#001b43";
            window.applyToolbarBgGradient(tbTop, tbBot, false);
          }
        }
        if (typeof window !== "undefined") {
          window.__proxdmrClientSettingsHydrated = true;
        }
      }
      // Always reset interface to standard VFO view with transcription and TTS turned off on initial open
      try {
        if (typeof disableAllTranscribe === "function") {
          disableAllTranscribe(true, false);
        } else if (typeof window.disableAllTranscribe === "function") {
          window.disableAllTranscribe(true, false);
        }
      } catch (_) {}
      try {
        if (typeof window.disableAllTts === "function") {
          window.disableAllTts(true, false);
        }
      } catch (_) {}
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
      const uid = window.currentUserId;
      if (msg.all_quick_mem && typeof msg.all_quick_mem === "object") {
        try {
          const toWipe = [];
          for (let i = 0; i < localStorage.length; i++) {
            const lk = localStorage.key(i);
            if (lk && (lk.startsWith("proxdmr_quick_mem") || /^proxdmr_u\d+_quick_mem/.test(lk))) {
              toWipe.push(lk);
            }
          }
          toWipe.forEach(lk => localStorage.removeItem(lk));
        } catch (_) {}
        for (const [k, v] of Object.entries(msg.all_quick_mem)) {
          const locKey = k.startsWith("hs_") ? `proxdmr_quick_mem_${k}` : `proxdmr_quick_mem_hs_${k}`;
          const userLocKey = uid ? `proxdmr_u${uid}_quick_mem_${k}` : null;
          if (v) {
            if (userLocKey) localStorage.setItem(userLocKey, JSON.stringify(v));
            localStorage.setItem(locKey, JSON.stringify(v));
          }
        }
      } else if (msg.key) {
        const locKey = msg.key.startsWith("hs_") ? `proxdmr_quick_mem_${msg.key}` : `proxdmr_quick_mem_hs_${msg.key}`;
        const userLocKey = uid ? `proxdmr_u${uid}_quick_mem_${msg.key}` : null;
        if (msg.data) {
          if (userLocKey) localStorage.setItem(userLocKey, JSON.stringify(msg.data));
          localStorage.setItem(locKey, JSON.stringify(msg.data));
        } else {
          if (userLocKey) localStorage.removeItem(userLocKey);
          localStorage.removeItem(locKey);
        }
      }
      if (typeof renderQuickMemButtons === "function") {
        renderQuickMemButtons(activeHotspotId);
      }
    } else if (msg.type === "asl_mem_change") {
      if (msg.all_asl_mem && typeof msg.all_asl_mem === "object") {
        try {
          const toWipe = [];
          for (let i = 0; i < localStorage.length; i++) {
            const lk = localStorage.key(i);
            if (lk && lk.startsWith("proxdmr_asl_mem_")) toWipe.push(lk);
          }
          toWipe.forEach(lk => localStorage.removeItem(lk));
        } catch (_) {}
        for (const [k, v] of Object.entries(msg.all_asl_mem)) {
          const locKey = `proxdmr_asl_mem_${k}`;
          if (v) localStorage.setItem(locKey, String(v));
        }
      } else if (msg.key) {
        const locKey = `proxdmr_asl_mem_${msg.key}`;
        if (msg.data) {
          localStorage.setItem(locKey, String(msg.data));
        } else {
          localStorage.removeItem(locKey);
        }
      }
      if (typeof renderQuickMemButtons === "function") {
        renderQuickMemButtons(activeHotspotId);
      }
    } else if (msg.type === "collection_change" && msg.category) {
      const cols = window.__proxdmrCollections = window.__proxdmrCollections || {};
      const cat = msg.category;
      if (msg.action === "replace" && msg.data && typeof msg.data === "object") {
        cols[cat] = { ...msg.data };
      } else if (msg.action === "set" && msg.key) {
        cols[cat] = cols[cat] || {};
        cols[cat][msg.key] = msg.value;
      } else if (msg.action === "delete" && msg.key && cols[cat]) {
        delete cols[cat][msg.key];
      }
      hydrateServerCollections({ [cat]: cols[cat] || {} });
      if (typeof window.renderRadiosGrid === "function") {
        window.renderRadiosGrid();
      }
      if (cat === "ysf_room_types") {
        const curHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : window.currentHotspots) || [];
        document.querySelectorAll('.radio-container.card-net-ysf, .radio-container[data-network-type="ysf"]').forEach(cardEl => {
          const hCid = cardEl.dataset.hotspotId;
          const hsObj = curHsList.find(h => h && h.id === hCid);
          if (hsObj) {
            if (typeof window.updateCardYsfPanel === "function") window.updateCardYsfPanel(cardEl, hsObj);
            if (typeof window.syncCardYsfDgIdBar === "function") window.syncCardYsfDgIdBar(cardEl, hsObj);
          }
        });
        const ysfView = document.getElementById("ysfRoomsView");
        if (ysfView && ysfView.style.display !== "none" && typeof window.renderYsfRoomsList === "function") {
          window.renderYsfRoomsList(document.getElementById("ysfRoomSearchInput")?.value || "");
        }
      }
    } else if (msg.type === "contacts_change") {
      if (typeof window.loadContactsFromServer === "function") {
        try { window.loadContactsFromServer(); } catch (_) {}
      }
    } else if (msg.type === "ysf_favorites_change") {
      if (typeof window.loadYsfFavoritesFromServer === "function") {
        try { window.loadYsfFavoritesFromServer(); } catch (_) {}
      }
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
      const enabled = Boolean(msg.enabled);
      localStorage.setItem("proxdmr_simultaneous_slots", enabled ? "true" : "false");
      if (typeof window.setHotspotTsAudioMode === "function") {
        const curMode = (typeof window.getHotspotTsAudioMode === "function") ? window.getHotspotTsAudioMode("default") : null;
        const targetMode = enabled ? "auto" : "solo";
        if (curMode !== targetMode) {
          window.setHotspotTsAudioMode("default", targetMode, { skipServerSync: true });
        }
      }
    } else if (msg.type === "check_mic_on_tx_change") {
      if (typeof window.setCheckMicOnTxEnabled === "function") {
        window.setCheckMicOnTxEnabled(Boolean(msg.enabled), false);
      }
    } else if (msg.type === "single_hotspot_audio_change") {
      const chk = document.getElementById("optSingleHotspotAudio");
      if (chk) chk.checked = Boolean(msg.enabled);
      if (typeof window.setSingleHotspotAudioEnabled === "function") {
        window.setSingleHotspotAudioEnabled(msg.enabled, false);
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
    } else if (msg.type === "backend_buffer_settings") {
      if (typeof window !== "undefined" && typeof window.updateBackendBufferUI === "function") {
        window.updateBackendBufferUI(msg.buffer_ms, false);
      }
    } else if (msg.type === "bm_benchmark_progress") {
      if (typeof handleBmBenchmarkProgress === "function") {
        handleBmBenchmarkProgress(msg);
      }
    } else if (msg.type === "bm_benchmark_complete") {
      if (typeof handleBmBenchmarkComplete === "function") {
        handleBmBenchmarkComplete(msg);
      }
    } else if (msg.type === "server_probe_progress") {
      if (typeof window.handleServerProbeProgress === "function") {
        window.handleServerProbeProgress(msg);
      }
    } else if (msg.type === "server_probe_complete") {
      if (typeof window.handleServerProbeComplete === "function") {
        window.handleServerProbeComplete(msg);
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
        const isAsl = Boolean(hs && hs.network_type === "allstar");
        const actNode = isAsl ? ((hs && (hs.connected_node || hs._active_asl_node || hs._last_asl_node)) || "") : "";
        const hhost = isAsl
          ? ((actNode && String(actNode).trim() !== "1999" && String(actNode).trim() !== "0") ? `asl_node_${actNode}` : "")
          : (hs.bm_master_host || "2322.master.brandmeister.network");
        const isOnline = Boolean(hs && (hs.status === "ONLINE" || hs.status === "CONNECTING" || hs.status === "AUTHENTICATING" || hs.status === "CONFIGURING"));

        // Equal telemetry recording: record ping when the hotspot is actively online/connecting
        const hostAttempted = Boolean(hhost && hp[hhost] !== undefined);
        const hidAttempted = Boolean(msg.pings && msg.pings[hid] !== undefined);

        if ((hostAttempted || hidAttempted) && isOnline) {
          let pVal = null;
          if (hhost && hp[hhost] !== undefined && hp[hhost] !== null && !isNaN(Number(hp[hhost]))) {
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
        const colDetail = window.t ? window.t("status.bm_collapsed_detail", {}, "Свернут / отключен") : "Свернут / отключен";
        if (targetHs) {
          targetHs.status = "DISCONNECTED";
          targetHs.detail = colDetail;
        }
        updateBmStatus("DISCONNECTED", colDetail, msg.hotspot_id);
        const stUpper = String(msg.status || "").toUpperCase();
        if (ws && ws.readyState === WebSocket.OPEN && stUpper !== "DISCONNECTED" && stUpper !== "OFFLINE") {
          ws.send(JSON.stringify({ type: "hotspot_collapse", hotspot_id: msg.hotspot_id, collapsed: true }));
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
    } else if (msg.type === "allstar_carrier") {
      const cid = msg.hotspot_id;
      const badge = document.getElementById(`allstarStatusBadge_${cid}`);
      const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
      if (badge) {
        if (msg.is_rx) {
          badge.className = "allstar-status-badge status-rx";
          badge.textContent = "RX";
        } else {
          const isOnline = card && (card.dataset.status === "online" || card.dataset.status === "ONLINE");
          badge.className = isOnline ? "allstar-status-badge status-online" : "allstar-status-badge status-idle";
          badge.textContent = isOnline ? "CONNECTED" : "IDLE";
        }
      }
      const targetHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(h => h.id === cid);
      if (targetHs) {
        targetHs._aslCarrierRx = Boolean(msg.is_rx);
        if (targetHs.ts1) targetHs.ts1.active = Boolean(msg.is_rx);
        if (msg.is_rx) {
          targetHs._aslLastRxAudioMs = Date.now();
        }
        targetHs._aslRxActiveNode = msg.is_rx ? String(msg.node || "").trim() : "";
        targetHs._aslKeyedNodes = msg.is_rx && Array.isArray(msg.keyed_nodes) ? msg.keyed_nodes.map(String) : [];
      }
      if (card) {
        if (!card._lastRx) card._lastRx = {};
        if (!card._lastRx[1]) card._lastRx[1] = { slot: 1, network_type: "allstar", active: false };
        card._lastRx[1].active = Boolean(msg.is_rx);
        if (msg.is_rx) {
          card._lastRx[1].lastAudioTime = Date.now() / 1000;
        }
        const vfoAllStar = card.querySelector(".vfo-allstar-row");
        if (vfoAllStar) {
          vfoAllStar.classList.toggle("allstar-rx-active", !!msg.is_rx);
        }
        updateCardModeBadge(card);
        updateCardRecUI(card, cid);
      }
      if (card && typeof window.syncAslMatrixButtonsState === "function") {
        window.syncAslMatrixButtonsState(card, targetHs);
      }
      if (window.isAslDashVisible && typeof window.renderAslNodeDashboard === "function") {
        window.renderAslNodeDashboard(cid);
      }
      if (!msg.is_rx && msg.duration) {
        if (typeof window.appendAllStarLogEntry === "function") {
          window.appendAllStarLogEntry(cid, {
            flag: msg.flag,
            source_type: msg.source_type || "VoIP",
            node: msg.node,
            callsign: msg.callsign,
            city: msg.city,
            duration: msg.duration
          });
        }
      } else if (msg.is_rx && msg.callsign) {
        if (typeof window.appendAllStarLogEntry === "function") {
          window.appendAllStarLogEntry(cid, {
            flag: msg.flag,
            source_type: msg.source_type || "VoIP",
            node: msg.node,
            callsign: msg.callsign,
            city: msg.city,
          });
        }
      }
    } else if (msg.type === "ysf_carrier") {
      const cid = msg.hotspot_id;
      const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
      const targetHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(h => h && h.id === cid) || (window.currentHotspots && window.currentHotspots[0]);
      let typePromoted = false;
      if (targetHs) {
        targetHs._ysfCarrierRx = Boolean(msg.is_rx);
        targetHs._ysfRxActiveRoom = msg.is_rx ? String(msg.room || targetHs.ysf_room || "").trim() : "";
        const rxDg = Number(msg.dg_id || 0);
        targetHs.ysf_rx_dg_id = msg.is_rx ? rxDg : 0;
        const rId = String(msg.room || targetHs.ysf_room || targetHs.ysf_room_id || "").trim();
        const manualOvr = (rId && typeof window.getYsfRoomTypeOverride === "function")
          ? window.getYsfRoomTypeOverride(rId)
          : "";
        if (msg.is_rx && rxDg >= 1 && rxDg <= 99) {
          targetHs._ysfLastRxDgId = rxDg;
          if (msg.caller) targetHs._ysfLastRxCaller = String(msg.caller).trim();
        }
        if (manualOvr !== "single" && rId && ((rxDg >= 1 && rxDg <= 99) || msg.reflector_type === "multi_mutant")) {
          const kindStr = String(msg.multiroom_kind || "LIVE_DGID").trim().toUpperCase() || "LIVE_DGID";
          if (typeof window.markYsfRoomRuntimeMutant === "function") {
            window.markYsfRoomRuntimeMutant(rId, kindStr);
          }
          if (targetHs.ysf_reflector_type !== "multi_mutant" || !targetHs.ysf_is_multiroom) {
            typePromoted = true;
          }
          if (targetHs.ysf_reflector_type !== "multi_standard") {
            targetHs.ysf_reflector_type = "multi_mutant";
            targetHs.ysf_multiroom_kind = kindStr;
            targetHs.ysf_is_multiroom = true;
          }
        } else if (msg.reflector_type) {
          targetHs.ysf_reflector_type = String(msg.reflector_type);
          if (msg.multiroom_kind !== undefined) targetHs.ysf_multiroom_kind = String(msg.multiroom_kind || "");
          if (msg.is_multiroom !== undefined) targetHs.ysf_is_multiroom = Boolean(msg.is_multiroom);
        }
        if (msg.online_count !== undefined && msg.online_count !== null) {
          targetHs.ysf_online_count = Number(msg.online_count) || 0;
          if (window._ysfGlobalRoomProbeCache && rId) {
            const curProbe = window._ysfGlobalRoomProbeCache[rId] || { room: rId, online: true };
            curProbe.connections = targetHs.ysf_online_count;
            curProbe.keyed = Boolean(msg.is_rx);
            window._ysfGlobalRoomProbeCache[rId] = curProbe;
          }
        }
      }
      if (typePromoted && card && typeof window.updateCardYsfPanel === "function") {
        window.updateCardYsfPanel(card, targetHs);
      } else if (card && typeof window.syncYsfMatrixButtonsState === "function") {
        window.syncYsfMatrixButtonsState(card, targetHs);
      }
      if (card && typeof window.updateYsfVfoHeader === "function") {
        window.updateYsfVfoHeader(card, targetHs);
      }
      if (card && typeof window.syncCardYsfDgIdBar === "function") {
        window.syncCardYsfDgIdBar(card, targetHs);
      }
      if (targetHs) {
        if (targetHs.ts1) targetHs.ts1.active = Boolean(msg.is_rx);
        if (msg.is_rx) targetHs._ysfLastRxAudioMs = Date.now();
      }
      if (card) {
        const ysfRow = card.querySelector(".vfo-ts1-row");
        const ysfRxTag = card.querySelector(".vfo-ts1-rx");
        if (!card._lastRx) card._lastRx = {};
        if (!card._lastRx[1]) card._lastRx[1] = { slot: 1, network_type: "ysf", active: false };
        card._lastRx[1].active = Boolean(msg.is_rx);
        if (msg.is_rx) {
          card._lastRx[1].lastAudioTime = Date.now() / 1000;
        }
        if (ysfRow) ysfRow.classList.toggle("vfo-rx-active", Boolean(msg.is_rx));
        if (ysfRxTag) ysfRxTag.classList.toggle("active", Boolean(msg.is_rx));
        updateCardModeBadge(card);
        updateCardRecUI(card, cid);
      }
    } else if (msg.type === "allstar_tx_ready") {
      if (typeof window.triggerAslTxReadyHaptic === "function") {
        window.triggerAslTxReadyHaptic(msg.hotspot_id);
      }
    } else if (msg.type === "allstar_telemetry") {
      const cid = msg.hotspot_id;
      if (typeof window.appendAllStarTelemetryLog === "function") {
        window.appendAllStarTelemetryLog(cid, msg.rtt, msg.jitter);
      }
      const rawRtt = Number(msg.rtt);
      if (msg.rtt !== null && msg.rtt !== undefined && !isNaN(rawRtt) && rawRtt > 0) {
        const rttVal = Math.round(rawRtt);
        if (typeof window !== "undefined") {
          if (!window.cachedBmPings) window.cachedBmPings = {};
          window.cachedBmPings[cid] = rttVal;
        }
        cachedBmPings[cid] = rttVal;

        const targetNode = msg.node ? String(msg.node).trim() : "";
        const hostKey = (targetNode && targetNode !== "1999" && targetNode !== "0") ? `asl_node_${targetNode}` : "";
        const nowSec = Math.floor(Date.now() / 1000);

        if (hostKey) {
          if (typeof window !== "undefined") {
            if (!window.cachedBmHostPings) window.cachedBmHostPings = {};
            window.cachedBmHostPings[hostKey] = rttVal;
            if (!window.cachedBmHostLosses) window.cachedBmHostLosses = {};
            window.cachedBmHostLosses[hostKey] = 0.0;
            if (!window.bmPingHistory) window.bmPingHistory = {};
            if (!window.bmPingHistory[hostKey]) window.bmPingHistory[hostKey] = [];
            window.bmPingHistory[hostKey].push({ t: nowSec, ping: rttVal });
            if (window.bmPingHistory[hostKey].length > 3000) {
              window.bmPingHistory[hostKey].splice(0, window.bmPingHistory[hostKey].length - 3000);
            }
          }
          cachedBmHostPings[hostKey] = rttVal;
          cachedBmHostLosses[hostKey] = 0.0;

          const hist = loadCardPingHistory(cid);
          hist.push({ t: nowSec, ping: rttVal, host: hostKey });
          if (hist.length > 3000) hist.splice(0, hist.length - 3000);
          saveCardPingHistory(cid);
        }

        const card = document.querySelector(`.dmr-card[data-hotspot-id="${cid}"]`) ||
                     document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) ||
                     document.querySelector(".dmr-card");
        if (card && typeof window.updateCardBmBanner === "function") {
          window.updateCardBmBanner(card);
        }
      }
    } else if (msg.type === "allstar_node_changed") {
      const cid = msg.hotspot_id;
      const targetHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(h => h.id === cid);
      if (targetHs) {
        targetHs.connected_node = msg.node;
        targetHs.is_asl_linked = Boolean(msg.node && msg.node !== "0");
        const nodeMode = (msg.mode === "*3" || msg.mode === "3") ? "*3" : "*2";
        if (targetHs.is_asl_linked) {
          targetHs.asl_links = [{ node: msg.node, mode: nodeMode, direction: "OUT" }];
          targetHs.asl_online_count = 1;
          targetHs._aslLinkMode = nodeMode;
          if (typeof window.setHotspotAslMode === "function") {
            window.setHotspotAslMode(cid, nodeMode);
          }
          if (typeof window.updateHotspotTsAudioModeUI === "function") {
            window.updateHotspotTsAudioModeUI(cid);
          }
          targetHs.status = "ONLINE";
          if (typeof updateBmStatus === "function") {
            updateBmStatus("ONLINE", `Node ${msg.node}`, cid);
          }
        } else {
          targetHs.asl_links = [];
          targetHs.asl_online_count = 0;
          targetHs.status = "ONLINE";
          if (typeof updateBmStatus === "function") {
            const aslActTxt = window.t ? window.t("asl.active_status", {}, "AllStarLink активен") : "AllStarLink активен";
            updateBmStatus("ONLINE", targetHs.allstar_node ? `Node ${targetHs.allstar_node}` : aslActTxt, cid);
          }
        }
      }
      const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
      if (card) {
        if (card.querySelector(".asl-matrix-grid") && !(targetHs && targetHs._aslDynamicMatrixMode) && typeof window.syncAslMatrixButtonsState === "function") {
          window.syncAslMatrixButtonsState(card, targetHs);
        } else if (typeof window.updateCardAllStarPanel === "function") {
          window.updateCardAllStarPanel(card, targetHs);
        }
      }
      if (card && typeof window.updateCardBmBanner === "function") {
        window.updateCardBmBanner(card, targetHs);
      }
      if (targetHs && targetHs.is_asl_linked && !(targetHs._aslScanActive) && typeof window.isAslDashAutoOpenEnabled === "function" && window.isAslDashAutoOpenEnabled(cid)) {
        if (typeof window.openAslNodeDashboard === "function") {
          window.openAslNodeDashboard(cid);
        }
      } else if (window.isAslDashVisible && typeof window.refreshAslNodeDashboardData === "function") {
        window.refreshAslNodeDashboardData(cid, false);
      }
    } else if (msg.type === "allstar_hub_telemetry") {
      const cid = msg.hotspot_id;
      const targetHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(h => h.id === cid);
      if (targetHs) {
        if (Array.isArray(msg.keyed_nodes)) targetHs._aslKeyedNodes = msg.keyed_nodes.map(String);
        if (msg.active_node !== undefined) targetHs._aslRxActiveNode = String(msg.active_node || "").trim();
        if (msg.hub_info) targetHs.asl_hub_info = msg.hub_info;
        if (Array.isArray(msg.hub_nodes) && msg.hub_nodes.length > 0) {
          const prevHubNodes = Array.isArray(targetHs.asl_hub_nodes) ? targetHs.asl_hub_nodes : [];
          if (msg.hub_nodes.length === 1 && prevHubNodes.length > 1) {
            const kSet = new Set((targetHs._aslKeyedNodes || []).map(String));
            msg.hub_nodes.forEach(x => { if (x && x.keyed && x.node) kSet.add(String(x.node).trim()); });
            targetHs.asl_hub_nodes = prevHubNodes.map(item => ({
              ...item,
              keyed: kSet.has(String(item.node || "").trim()),
            }));
          } else {
            targetHs.asl_hub_nodes = msg.hub_nodes;
          }
        }
      }
      const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
      if (card && typeof window.syncAslMatrixButtonsState === "function") {
        window.syncAslMatrixButtonsState(card, targetHs);
      }
      if (window.isAslDashVisible && typeof window.renderAslNodeDashboard === "function") {
        window.renderAslNodeDashboard(cid);
      }
    } else if (msg.type === "allstar_node_disconnected") {
      const cid = msg.hotspot_id;
      const targetHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(h => h.id === cid);
      const wasDynamicMode = Boolean(targetHs && targetHs._aslDynamicMatrixMode);
      if (targetHs) {
        if (targetHs._aslDisconnectingNodes && msg.node) {
          targetHs._aslDisconnectingNodes.delete(String(msg.node).trim());
        }
        targetHs._aslDynamicMatrixMode = false;
        targetHs._aslDashMatrixOpen = false;
        targetHs._aslDashCurrentHub = "";
        targetHs._aslDashHeardOrder = [];
        targetHs._aslDashHeardSet = new Set();
        targetHs._aslDashKnownMap = new Map();
        targetHs.asl_unlisted_links = [];
        targetHs.connected_node = "";
        targetHs.is_asl_linked = false;
        targetHs.asl_links = [];
        targetHs.asl_hub_nodes = [];
        targetHs.asl_hub_info = null;
        targetHs.asl_online_count = 0;
        targetHs.status = "ONLINE";
        if (typeof updateBmStatus === "function") {
          const aslActTxt = window.t ? window.t("asl.active_status", {}, "AllStarLink активен") : "AllStarLink активен";
          updateBmStatus("ONLINE", targetHs.allstar_node ? `Node ${targetHs.allstar_node}` : aslActTxt, cid);
        }
      }
      const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
      if (card) {
        if (card.querySelector(".asl-matrix-grid") && !wasDynamicMode && typeof window.syncAslMatrixButtonsState === "function") {
          window.syncAslMatrixButtonsState(card, targetHs);
        } else if (typeof window.updateCardAllStarPanel === "function") {
          window.updateCardAllStarPanel(card, targetHs);
        }
      }
      if (card && typeof window.updateCardBmBanner === "function") {
        window.updateCardBmBanner(card, targetHs);
      }
      if (typeof window.renderAslNodeDashboard === "function") {
        window.renderAslNodeDashboard(cid);
      }
    } else if (msg.type === "allstar_proc_step") {
      const cid = msg.hotspot_id;
      const targetHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(h => h.id === cid);
      const card = document.querySelector(`.dmr-card[data-hotspot-id="${cid}"]`) || document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) || document.querySelector(".dmr-card");

      const phrase = (typeof window.formatAslProcMessage === "function")
        ? window.formatAslProcMessage(msg)
        : (msg.code || "");

      // 1. Управление статусной плашкой процесса (верхняя строка экрана)
      if (msg.show_status_banner !== false && card && typeof window.setAslProcBannerState === "function") {
        const isProgress = msg.state === "progress" || msg.state === "active" || msg.auto_hide_ms === 0;
        const autoHide = isProgress
          ? 0
          : ((typeof msg.auto_hide_ms === "number" && msg.auto_hide_ms > 0) ? msg.auto_hide_ms : 4000);
        window.setAslProcBannerState(card, {
          active: true,
          text: phrase,
          tone: msg.tone || "neutral",
          autoHideMs: autoHide,
          fadeOutMs: 2000
        });
      }

      // 2. Управление эффектами карточек в матрице
      if (msg.show_card_effects !== false && targetHs) {
        const nodeStr = String(msg.node || "").trim();
        if (msg.proc === "disconnect") {
          if (msg.state === "progress") {
            if (!targetHs._aslDisconnectingNodes) targetHs._aslDisconnectingNodes = new Set();
            if (nodeStr && nodeStr !== "all") targetHs._aslDisconnectingNodes.add(nodeStr);
            else targetHs._aslDisconnectingNodes.add("all");
          } else if (msg.state === "done" || msg.state === "failed") {
            if (targetHs._aslDisconnectingNodes) {
              if (nodeStr && nodeStr !== "all") targetHs._aslDisconnectingNodes.delete(nodeStr);
              else targetHs._aslDisconnectingNodes.clear();
            }
            if (msg.state === "done") {
              if (targetHs._aslDisconnectingNodes) {
                targetHs._aslDisconnectingNodes.clear();
              }
              targetHs.asl_unlisted_links = [];
              targetHs._aslDynamicMatrixMode = false;
              targetHs.connected_node = "";
              targetHs.is_asl_linked = false;
              targetHs.asl_links = [];
              targetHs.asl_hub_nodes = [];
              targetHs.asl_hub_info = null;
              targetHs.asl_online_count = 0;
              targetHs._aslDashMatrixOpen = false;
              targetHs._aslDashCurrentHub = "";
              targetHs._aslDashHeardOrder = [];
              targetHs._aslDashHeardSet = new Set();
              if (typeof window.renderAslNodeDashboard === "function") {
                window.renderAslNodeDashboard(cid);
              }
            }
          }
        } else if (msg.proc === "connect") {
          if (msg.state === "progress") {
            if (targetHs._aslDisconnectingNodes) targetHs._aslDisconnectingNodes.clear();
            if (!targetHs._aslConnectingNodes) targetHs._aslConnectingNodes = new Map();
            if (nodeStr) {
              targetHs._aslConnectingNodes.set(nodeStr, {
                mode: msg.mode || "*2",
                startedAt: Date.now()
              });
            }
          } else if (msg.state === "done") {
            if (targetHs) {
              if (targetHs._aslConnectingNodes && nodeStr) {
                targetHs._aslConnectingNodes.delete(nodeStr);
              }
              if (targetHs._aslDisconnectingNodes) {
                targetHs._aslDisconnectingNodes.clear();
              }
              targetHs.asl_unlisted_links = [];
              targetHs._aslDynamicMatrixMode = false;
            }
            if (nodeStr) {
              const finalMode = (msg.mode === "*3" || msg.mode === "3") ? "*3" : "*2";
              targetHs.connected_node = nodeStr;
              targetHs.is_asl_linked = true;
              targetHs.asl_links = [{ node: nodeStr, mode: finalMode, direction: "OUT" }];
              targetHs.asl_online_count = 1;
              targetHs._aslLinkMode = finalMode;
              if (typeof window.setHotspotAslMode === "function") {
                window.setHotspotAslMode(cid, finalMode);
              }
              if (typeof window.updateHotspotTsAudioModeUI === "function") {
                window.updateHotspotTsAudioModeUI(cid);
              }
              if (!targetHs._aslScanActive && typeof window.isAslDashAutoOpenEnabled === "function" && window.isAslDashAutoOpenEnabled(cid)) {
                if (typeof window.openAslNodeDashboard === "function") {
                  window.openAslNodeDashboard(cid);
                }
              } else if (window.isAslDashVisible && typeof window.refreshAslNodeDashboardData === "function") {
                window.refreshAslNodeDashboardData(cid, false);
              }
            }
          } else if (msg.state === "failed") {
            if (targetHs) {
              if (targetHs._aslConnectingNodes && nodeStr) {
                targetHs._aslConnectingNodes.delete(nodeStr);
              }
              if (targetHs._aslDisconnectingNodes) {
                targetHs._aslDisconnectingNodes.clear();
              }
              targetHs.asl_unlisted_links = [];
              targetHs._aslDynamicMatrixMode = false;
              targetHs.connected_node = "";
              targetHs.is_asl_linked = false;
              targetHs.asl_links = [];
              targetHs.asl_hub_nodes = [];
              targetHs.asl_hub_info = null;
              targetHs.asl_online_count = 0;
            }
          }
        }

        if (card && typeof window.syncAslMatrixButtonsState === "function" && card.querySelector(".asl-matrix-grid")) {
          window.syncAslMatrixButtonsState(card, targetHs);
        } else if (card && typeof window.updateCardAllStarPanel === "function") {
          window.updateCardAllStarPanel(card, targetHs);
        }
      }
    } else if (msg.type === "ysf_proc_step") {
      const cid = msg.hotspot_id;
      const targetHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(h => h && h.id === cid);
      const card = document.querySelector(`.dmr-card[data-hotspot-id="${cid}"]`) ||
                   document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);

      if (msg.show_status_banner !== false && card && typeof window.setAslProcBannerState === "function") {
        const isProgress = msg.state === "progress" || msg.state === "active" || msg.auto_hide_ms === 0;
        const autoHide = isProgress
          ? 0
          : ((typeof msg.auto_hide_ms === "number" && msg.auto_hide_ms > 0) ? msg.auto_hide_ms : 4000);
        window.setAslProcBannerState(card, {
          active: true,
          text: msg.text || "",
          tone: msg.tone || "neutral",
          autoHideMs: autoHide,
          fadeOutMs: 2000
        });
      }

      if (targetHs) {
        if (msg.state === "progress") {
          if (msg.proc === "connect" && msg.room_id) {
            targetHs._ysfConnectingRoom = String(msg.room_id).trim();
            targetHs._ysfDisconnectingRoom = null;
          } else if (msg.proc === "disconnect") {
            targetHs._ysfDisconnectingRoom = targetHs.ysf_room || "all";
            targetHs._ysfConnectingRoom = null;
          }
          if (card && typeof window.syncYsfMatrixButtonsState === "function") {
            window.syncYsfMatrixButtonsState(card, targetHs);
          }
        } else if (msg.state === "done") {
          targetHs._ysfConnectingRoom = null;
          targetHs._ysfDisconnectingRoom = null;
          if (msg.proc === "connect") {
            targetHs.isManualBmDisconnect = false;
            if (typeof window !== "undefined" && (cid === window.activeHotspotId || targetHs.id === window.activeHotspotId)) {
              window.isManualBmDisconnect = false;
            }
            if (msg.room_id) {
              const sRid = String(msg.room_id).trim();
              targetHs.ysf_room = sRid;
              targetHs.ysf_room_id = sRid;
            }
            if (msg.room_name) {
              const sName = String(msg.room_name).trim();
              targetHs.ysf_name = sName;
              targetHs.ysf_room_name = sName;
            }
            if (msg.host) {
              targetHs.bm_master_host = String(msg.host).trim();
              targetHs.ysf_host = String(msg.host).trim();
            }
            if (msg.port) {
              targetHs.bm_master_port = Number(msg.port) || 42000;
              targetHs.ysf_port = Number(msg.port) || 42000;
            }
            if (msg.dg_id !== undefined) {
              targetHs.ysf_dg_id = String(msg.dg_id || "00");
            }
            if (msg.tx_dg_id !== undefined) {
              targetHs.ysf_tx_dg_id = msg.tx_dg_id;
            }
            if (msg.is_multiroom !== undefined) {
              targetHs.ysf_is_multiroom = Boolean(msg.is_multiroom);
            }
            if (msg.reflector_type !== undefined) {
              targetHs.ysf_reflector_type = String(msg.reflector_type || "single");
            }
            if (msg.multiroom_kind !== undefined) {
              targetHs.ysf_multiroom_kind = String(msg.multiroom_kind || "");
            }
            targetHs.status = "ONLINE";
            if (typeof window.isYsfDashAutoOpenEnabled === "function" && window.isYsfDashAutoOpenEnabled(cid)) {
              targetHs._ysfDashOpen = true;
            }
          } else if (msg.proc === "disconnect") {
            targetHs.ysf_room = "";
            targetHs.ysf_room_id = "";
            targetHs.ysf_name = "";
            targetHs.ysf_room_name = "";
            targetHs.ysf_host = "";
            targetHs.bm_master_host = "";
            targetHs.status = "DISCONNECTED";
            targetHs._ysfDashOpen = false;
            targetHs.isManualBmDisconnect = true;
            if (typeof window !== "undefined" && (cid === window.activeHotspotId || targetHs.id === window.activeHotspotId)) {
              window.isManualBmDisconnect = true;
            }
          }
          if (card && typeof window.updateCardYsfPanel === "function") {
            window.updateCardYsfPanel(card, targetHs);
          }
          if (card && typeof window.syncYsfMatrixButtonsState === "function") {
            window.syncYsfMatrixButtonsState(card, targetHs);
          }
          if (card && typeof window.renderYsfDashboard === "function") {
            window.renderYsfDashboard(card, targetHs, cid);
          }
        } else if (msg.state === "failed") {
          targetHs._ysfConnectingRoom = null;
          targetHs._ysfDisconnectingRoom = null;
          if (msg.proc === "connect") {
            targetHs.status = "DISCONNECTED";
          }
          if (card && typeof window.syncYsfMatrixButtonsState === "function") {
            window.syncYsfMatrixButtonsState(card, targetHs);
          }
        }
      }
      if (msg.state === "done" || msg.state === "failed") {
        try {
          window.dispatchEvent(new CustomEvent("proxdmr:ysf-proc-result", {
            detail: {
              hotspot_id: cid,
              proc: msg.proc || "",
              state: msg.state,
              code: msg.code || "",
              room_id: msg.room_id ? String(msg.room_id).trim() : "",
              text: msg.text || ""
            }
          }));
        } catch (_) {}
      }
    } else if (msg.type === "allstar_macro_tx_state") {
      const cid = msg.hotspot_id;
      const card = document.querySelector(`.dmr-card[data-hotspot-id="${cid}"]`) || document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`) || document.querySelector(".dmr-card");
      if (card) {
        const pttBtn = card.querySelector(".ptt-button");
        if (pttBtn) {
          if (msg.active) {
            pttBtn.classList.add("active", "tx-slot-2");
          } else {
            pttBtn.classList.remove("active", "tx-slot-2");
          }
        }
        if (typeof window.updateCardModeBadge === "function") {
          window.updateCardModeBadge(card);
        }
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
        if (!msg.keep_audio && window.audioPlayer && typeof window.audioPlayer.onTransmissionEnd === "function") {
          window.audioPlayer.onTransmissionEnd(msg.hotspot_id, msg.slot);
        }
      }

      // Update EXACT hotspot card (RX only; TX is handled by PTT state)
      if (!msg.is_tx) {
        const rawActivityHid = msg.hotspot_id || activeHotspotId || "default";
        const resolvedActivityCid = resolveHotspotId(rawActivityHid);
        const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${rawActivityHid}"]`)
          || document.querySelector(`.radio-container[data-hotspot-id="${resolvedActivityCid}"]`)
          || Array.from(document.querySelectorAll(".radio-container")).find(
            c => resolveHotspotId(c.dataset.hotspotId) === resolvedActivityCid
          ) || null;
        const targetHid = (targetCard && targetCard.dataset.hotspotId) || resolvedActivityCid;
        const activityHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(
          h => String(h.id) === String(targetHid) || resolveHotspotId(h.id) === resolvedActivityCid
        );
        if (activityHs && (msg.slot === 1 || msg.slot === 2)) {
          const slotObj = msg.slot === 1 ? activityHs.ts1 : activityHs.ts2;
          if (slotObj && typeof slotObj === "object") {
            slotObj.active = Boolean(msg.active);
          }
          if (!msg.active && msg.slot === 1 && activityHs._ysfCarrierRx) {
            activityHs._ysfCarrierRx = false;
          }
        }
        if (targetCard) {
        const slot = msg.slot;
        const vfoRow = targetCard.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
        const rxTag = targetCard.querySelector(slot === 1 ? ".vfo-ts1-rx" : ".vfo-ts2-rx");
        const modeBadgeEl = targetCard.querySelector(".mode-badge");

        if (msg.active) {
          _clearRxVisualHoldTimer(targetCard, slot);
          if (typeof window.handleAutoSlotActivity === "function") {
            window.handleAutoSlotActivity(targetHid, slot, true);
          }
          if (vfoRow) {
            if (!vfoRow.classList.contains("vfo-tx-active")) {
              vfoRow.classList.add("vfo-rx-active");
            }
            const callerFlagEl = vfoRow.querySelector(".ts-caller-flag");
            const callerCallEl = vfoRow.querySelector(".ts-caller-call");
            const callerIdEl = vfoRow.querySelector(".ts-caller-id");
            const callerCountryEl = vfoRow.querySelector(".ts-caller-country");
            const tgFlagEl = vfoRow.querySelector(".ts-tg-flag");
            const tgTextEl = vfoRow.querySelector(".ts-tg-text");

            const hsLookupNet = (typeof getHotspotNetworkType === "function") ? (getHotspotNetworkType(targetCard) || getHotspotNetworkType(targetHid)) : "";
            const rxNetType = String(msg.network_type || (hsLookupNet && hsLookupNet !== "bm" ? hsLookupNet : "") || targetCard.dataset.networkType || hsLookupNet || "bm").toLowerCase();
            const isYsfRxCard = targetCard.classList.contains("card-net-ysf") || rxNetType === "ysf" || String(msg.call_id || (msg.call_entry && msg.call_entry.id) || "").startsWith("ysf_") || String(msg.dst_name || "").startsWith("YSF #");
            const isAslRxCard = targetCard.classList.contains("card-net-allstar") || rxNetType === "allstar" || String(msg.call_id || (msg.call_entry && msg.call_entry.id) || "").startsWith("asl_");
            const isSingleRxCard = isYsfRxCard || isAslRxCard;

            const callerCountry = getCallCountryInfo(msg, msg.country);
            const userCached = (typeof window !== "undefined" && window.USER_CALLSIGNS && window.USER_CALLSIGNS[msg.src_id]) || {};
            const callerCity = msg.city || userCached.city || "";
            const tgCountry = isYsfRxCard ? { name: "YSF", name_en: "YSF", flag: "🌐" } : getCountryInfo(msg.dst_id);
            const tgName = isYsfRxCard
              ? (msg.dst_name || (msg.dst_id ? `YSF #${msg.dst_id}` : ""))
              : (msg.dst_name || (window.TG_NAMES || {})[msg.dst_id] || (msg.dst_id === 9990 ? "Parrot / Echo" : ""));
            if (!isSingleRxCard && msg.dst_name && msg.dst_id) {
              if (!window.TG_NAMES) window.TG_NAMES = {};
              window.TG_NAMES[msg.dst_id] = msg.dst_name;
            }

            const cCall = msg.src_callsign || (msg.src_id ? `ID: ${msg.src_id}` : "Unknown");
            const cName = msg.src_name || "";
            const displayName = `${cCall} ${cName}`.trim();

            if (vfoRow) {
              vfoRow.classList.remove("vfo-last-caller-dimmed");
            }

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
              if (msg.src_id && !isSingleRxCard) {
                callerCallEl.dataset.radioId = msg.src_id;
                callerCallEl.dataset.callsign = msg.src_callsign || "";
                callerCallEl.dataset.name = msg.src_name || "";
                callerCallEl.title = window.t ? window.t("vfo.set_caller_tx_title", { id: msg.src_id }) : `Задать ID ${msg.src_id} для передачи (Private Call)`;
              } else {
                delete callerCallEl.dataset.radioId;
                delete callerCallEl.dataset.callsign;
                delete callerCallEl.dataset.name;
                callerCallEl.removeAttribute("title");
              }
            }
            if (callerIdEl) {
              callerIdEl.innerHTML = msg.src_id ? `(<span class="dmr-id-text">${msg.src_id}</span>)` : "";
              callerIdEl.style.filter = "none";
              if (msg.src_id && !isSingleRxCard) {
                callerIdEl.dataset.radioId = msg.src_id;
                callerIdEl.dataset.callsign = msg.src_callsign || "";
                callerIdEl.dataset.name = msg.src_name || "";
                callerIdEl.dataset.country = callerCountry?.name_en || "";
                if (callerCity) callerIdEl.dataset.city = callerCity;
                callerIdEl.title = window.t ? window.t("vfo.set_caller_tx_title", { id: msg.src_id }) : `Задать ID ${msg.src_id} для передачи (Private Call)`;
              } else {
                delete callerIdEl.dataset.radioId;
                delete callerIdEl.dataset.callsign;
                delete callerIdEl.dataset.name;
                delete callerIdEl.dataset.country;
                delete callerIdEl.dataset.city;
                callerIdEl.removeAttribute("title");
              }
            }
            if (callerCountryEl) {
              callerCountryEl.textContent = formatCallerLocation(callerCountry, callerCity);
              callerCountryEl.dataset.city = callerCity;
              callerCountryEl.style.filter = "none";
            }

            if (tgFlagEl) {
              updateFlagElement(tgFlagEl, tgCountry, !isYsfRxCard && msg.dst_id === 9990);
              tgFlagEl.style.filter = "none";
            }
            if (tgTextEl) {
              const tgPrefix = isYsfRxCard ? "#" : (msg.call_type === "GROUP" ? "TG" : "Call");
              const tgTitle = isYsfRxCard
                ? (window.t ? window.t("ysf.vfo_room_title", { id: msg.dst_id }, `Комната YSF #${msg.dst_id}`) : `Комната YSF #${msg.dst_id}`)
                : (window.t ? window.t("vfo.set_tg_tx_title", { tg: msg.dst_id }) : `Задать TG ${msg.dst_id} для передачи на этом хотспоте`);
              tgTextEl.innerHTML = renderTgTextHtml(msg.dst_id, tgPrefix, tgName, tgTitle, isYsfRxCard ? "ysf" : (msg.call_type === "GROUP" ? rxNetType : null));
              tgTextEl.dataset.tgId = msg.dst_id;
              tgTextEl.style.filter = "none";
              tgTextEl.title = tgTitle;
            }

            // Persist last RX data on the card so it survives heardCalls trimming
            if (!targetCard._lastRx) targetCard._lastRx = {};
            targetCard._lastRx[slot] = {
              id: msg.call_id || (msg.call_entry && msg.call_entry.id) || "",
              network_type: isYsfRxCard ? "ysf" : (isAslRxCard ? "allstar" : rxNetType),
              src_id: msg.src_id,
              src_callsign: msg.src_callsign,
              src_name: msg.src_name,
              city: callerCity,
              country: callerCountry?.name_en || (callerCountry && callerCountry.name) || msg.country || "",
              dst_id: msg.dst_id,
              dst_name: tgName,
              call_type: msg.call_type,
              active: true,
              timestamp: Date.now() / 1000,
              lastAudioTime: Date.now() / 1000
            };
            if (typeof window.saveStoredLastRx === "function") {
              window.saveStoredLastRx(targetHid, slot, targetCard._lastRx[slot]);
            }

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

          const isAllStarCardActive = targetCard.classList.contains("card-net-allstar") || (typeof getHotspotNetworkType === "function" && getHotspotNetworkType(targetHid) === "allstar");
          if (isAllStarCardActive) {
            const aslHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(h => String(h.id) === String(targetHid));
            if (aslHs) {
              aslHs._aslCarrierRx = true;
              aslHs._aslLastRxAudioMs = Date.now();
              if (msg.node || msg.src_id) {
                aslHs._aslRxActiveNode = String(msg.node || msg.src_id).trim();
              }
            }
            if (window.isAslDashVisible && typeof window.renderAslNodeDashboard === "function") {
              window.renderAslNodeDashboard(targetHid);
            }
          }

          if (window.AndroidBridge && typeof window.AndroidBridge.updateRadioStatus === "function") {
            try {
              const cCall = msg.src_callsign || (msg.src_id ? `ID: ${msg.src_id}` : "Unknown");
              const hsBrNet = (typeof getHotspotNetworkType === "function") ? (getHotspotNetworkType(targetCard) || getHotspotNetworkType(targetHid)) : "";
              const netRxBr = String(msg.network_type || (hsBrNet && hsBrNet !== "bm" ? hsBrNet : "") || (targetCard && targetCard.dataset.networkType) || hsBrNet || "bm").toLowerCase();
              const isAsl = (targetCard && targetCard.classList.contains("card-net-allstar")) || netRxBr === "allstar";
              const isYsf = (targetCard && targetCard.classList.contains("card-net-ysf")) || netRxBr === "ysf" || String(msg.call_id || "").startsWith("ysf_");
              if (isAsl) {
                window.AndroidBridge.updateRadioStatus(`RX: ${cCall}`);
              } else if (isYsf) {
                window.AndroidBridge.updateRadioStatus(`RX: ${cCall} -> #${msg.dst_id}`);
              } else {
                window.AndroidBridge.updateRadioStatus(`RX: ${cCall} -> TG${msg.dst_id} (TS${slot})`);
              }
            } catch (err) {
              console.warn("[AndroidBridge] updateRadioStatus RX failed:", err);
            }
          }
        } else {
          if (typeof window.handleAutoSlotActivity === "function") {
            window.handleAutoSlotActivity(targetHid, slot, false);
          }
          if (vfoRow) {
            const callerCallEl = vfoRow.querySelector(".ts-caller-call");
            if (callerCallEl) callerCallEl.classList.remove("caller-active");
          }
          const isAllStarCard = targetCard.classList.contains("card-net-allstar") || (typeof getHotspotNetworkType === "function" && getHotspotNetworkType(targetHid) === "allstar");
          if (isAllStarCard) {
            const aslRow = targetCard.querySelector(".vfo-allstar-row");
            if (aslRow) aslRow.classList.remove("allstar-rx-active");
            const aslHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(h => String(h.id) === String(targetHid));
            if (aslHs) {
              aslHs._aslCarrierRx = false;
              aslHs._aslRxActiveNode = "";
              aslHs._aslKeyedNodes = [];
            }
            if (window.isAslDashVisible && typeof window.renderAslNodeDashboard === "function") {
              window.renderAslNodeDashboard(targetHid);
            }
          }
          if (targetCard._lastRx && targetCard._lastRx[slot]) {
            targetCard._lastRx[slot].active = false;
            targetCard._lastRx[slot].endTime = Date.now() / 1000;
          }
          _clearRxVisualHoldTimer(targetCard, slot);
          if (isAllStarCard || (vfoRow && vfoRow.classList.contains("vfo-tx-active"))) {
            if (vfoRow) vfoRow.classList.remove("vfo-rx-active");
            if (rxTag) rxTag.classList.remove("active");
          } else {
            if (!targetCard._rxVisualHoldTimers) targetCard._rxVisualHoldTimers = {};
            const holdHid = targetHid;
            targetCard._rxVisualHoldTimers[slot] = setTimeout(() => {
              if (targetCard._rxVisualHoldTimers) {
                targetCard._rxVisualHoldTimers[slot] = null;
              }
              if (!targetCard.isConnected) return;
              const liveHs = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(
                h => String(h.id) === String(holdHid) || resolveHotspotId(h.id) === resolveHotspotId(holdHid)
              );
              const liveSlotObj = liveHs ? (slot === 1 ? liveHs.ts1 : liveHs.ts2) : null;
              if (
                (targetCard._lastRx && targetCard._lastRx[slot] && targetCard._lastRx[slot].active) ||
                (liveSlotObj && liveSlotObj.active)
              ) {
                return;
              }
              const rowEl = targetCard.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
              if (rowEl) rowEl.classList.remove("vfo-rx-active");
              const tagEl = targetCard.querySelector(slot === 1 ? ".vfo-ts1-rx" : ".vfo-ts2-rx");
              if (tagEl) tagEl.classList.remove("active");
              updateCardModeBadge(targetCard);
            }, RX_VISUAL_HOLD_MS);
          }
          const otherSlot = slot === 1 ? 2 : 1;
          const otherSlotActive = Boolean(
            (targetCard._lastRx && targetCard._lastRx[otherSlot] && targetCard._lastRx[otherSlot].active) ||
            (activityHs && (otherSlot === 1 ? activityHs.ts1?.active : activityHs.ts2?.active))
          );
          if (!otherSlotActive && window.activeRecordingHotspotIds) {
            window.activeRecordingHotspotIds.delete(resolvedActivityCid);
            window.activeRecordingHotspotIds.delete(String(targetHid));
            const allHsList = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []);
            const firstHs = allHsList.find(h => !h.hidden) || allHsList[0];
            if (firstHs && resolveHotspotId(firstHs.id) === resolvedActivityCid) {
              window.activeRecordingHotspotIds.delete("default");
            }
          }
          if (!msg.keep_audio && window.audioPlayer && typeof window.audioPlayer.onTransmissionEnd === "function") {
            window.audioPlayer.onTransmissionEnd(targetHid, slot);
          }
          updateCardModeBadge(targetCard);
          updateCardRecUI(targetCard, targetHid);
          if (typeof window.refreshToolbarProcessIndicators === "function") {
            window.refreshToolbarProcessIndicators();
          }
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
          const match = (msg.call_id && (c.id === msg.call_id || String(c.id) === String(msg.call_id))) || (!msg.call_id && c.src_id === msg.src_id);
          if (match) {
            if (msg.src_callsign) c.src_callsign = msg.src_callsign;
            if (msg.src_name) c.src_name = msg.src_name;
            if (msg.talker_alias) c.talker_alias = msg.talker_alias;
            if (msg.city) c.city = msg.city;
            if (msg.country) c.country = msg.country;
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
        const aslHsResolved = (typeof getCurrentHotspots === "function" ? getCurrentHotspots() : []).find(h => String(h.id) === String(targetHid));
        if (aslHsResolved && (aslHsResolved.network_type || "").toLowerCase() === "allstar" && msg.src_id) {
          const resolvedNodeStr = String(msg.src_id).trim();
          if (resolvedNodeStr && resolvedNodeStr !== "1999") {
            aslHsResolved._aslRxActiveNode = resolvedNodeStr;
            if (!Array.isArray(aslHsResolved._aslKeyedNodes) || !aslHsResolved._aslKeyedNodes.includes(resolvedNodeStr)) {
              aslHsResolved._aslKeyedNodes = [resolvedNodeStr, ...(aslHsResolved._aslKeyedNodes || [])];
            }
            if (window.isAslDashVisible && typeof window.renderAslNodeDashboard === "function") {
              window.renderAslNodeDashboard(targetHid);
            }
          }
        }
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
          const knownCall = (window.heardCalls || []).find(c => String(c.id) === String(msg.call_id));
          const country = getCallCountryInfo({ ...(knownCall || {}), ...msg });
          const cCall = msg.src_callsign || (msg.src_id ? `ID: ${msg.src_id}` : "Unknown");
          const cName = msg.src_name || "";
          const displayName = `${cCall} ${cName}`.trim();
          const resHsNet = (typeof getHotspotNetworkType === "function") ? (getHotspotNetworkType(targetCard) || getHotspotNetworkType(targetHid)) : "";
          const resNetType = String(msg.network_type || (knownCall && knownCall.network_type) || (resHsNet && resHsNet !== "bm" ? resHsNet : "") || targetCard.dataset.networkType || resHsNet || "bm").toLowerCase();
          const isSingleResCard = targetCard.classList.contains("card-net-ysf") || targetCard.classList.contains("card-net-allstar") || resNetType === "ysf" || resNetType === "allstar" || String(msg.call_id || "").startsWith("ysf_") || String(msg.call_id || "").startsWith("asl_");

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
            if (msg.src_id && !isSingleResCard) {
              callerCallEl.dataset.radioId = msg.src_id;
              if (msg.src_callsign) callerCallEl.dataset.callsign = msg.src_callsign;
              if (msg.src_name) callerCallEl.dataset.name = msg.src_name;
              callerCallEl.title = window.t ? window.t("vfo.set_caller_tx_title", { id: msg.src_id }) : `Задать ID ${msg.src_id} для передачи (Private Call)`;
            } else {
              delete callerCallEl.dataset.radioId;
              delete callerCallEl.dataset.callsign;
              delete callerCallEl.dataset.name;
              callerCallEl.removeAttribute("title");
            }
          }
          const city = msg.city || "";
          if (callerIdEl && msg.src_id) {
            callerIdEl.innerHTML = `(<span class="dmr-id-text">${msg.src_id}</span>)`;
            callerIdEl.style.filter = "none";
            if (!isSingleResCard) {
              callerIdEl.dataset.radioId = msg.src_id;
              if (msg.src_callsign) callerIdEl.dataset.callsign = msg.src_callsign;
              if (msg.src_name) callerIdEl.dataset.name = msg.src_name;
              if (country?.name_en) callerIdEl.dataset.country = country.name_en;
              if (city) callerIdEl.dataset.city = city;
              callerIdEl.title = window.t ? window.t("vfo.set_caller_tx_title", { id: msg.src_id }) : `Задать ID ${msg.src_id} для передачи (Private Call)`;
            } else {
              delete callerIdEl.dataset.radioId;
              delete callerIdEl.dataset.callsign;
              delete callerIdEl.dataset.name;
              delete callerIdEl.dataset.country;
              delete callerIdEl.dataset.city;
              callerIdEl.removeAttribute("title");
            }
          }
          if (callerCountryEl) {
            callerCountryEl.textContent = formatCallerLocation(country, city);
            callerCountryEl.dataset.city = city;
            callerCountryEl.style.filter = "none";
          }
        }
        if (targetCard._lastRx && targetCard._lastRx[slot]) {
          if (msg.src_callsign) targetCard._lastRx[slot].src_callsign = msg.src_callsign;
          if (msg.src_name) targetCard._lastRx[slot].src_name = msg.src_name;
          if (city) targetCard._lastRx[slot].city = city;
          if (country?.name_en || (country && country.name)) targetCard._lastRx[slot].country = country?.name_en || country?.name;
          if (typeof window.saveStoredLastRx === "function") {
            window.saveStoredLastRx(targetHid, slot, targetCard._lastRx[slot]);
          }
        }
        if (msg.src_id) {
          if (!window.USER_CALLSIGNS) window.USER_CALLSIGNS = {};
          window.USER_CALLSIGNS[msg.src_id] = {
            callsign: msg.src_callsign || "",
            name: msg.src_name || "",
            country: country?.name_en || (country && country.name) || msg.country || "",
            city: city
          };
          try {
            localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify(window.USER_CALLSIGNS));
          } catch (_) {}
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
      const isLive = false;
      const curList = getCurrentHotspots();
      const isDefaultAlias = (typeof window.isPrimaryDefaultAlias === "function")
        ? window.isPrimaryDefaultAlias(hid, curList)
        : (hid === "default" || (!curList.some(h => h && String(h.id) === "default") && hid === resolveHotspotId("default")));
      const rc = document.getElementById("radioContainer");
      const rcMatch = rc && (!rc.dataset.hotspotId || rc.dataset.hotspotId === hid || (isDefaultAlias && rc.dataset.hotspotId === "default")) ? rc : null;
      const card = document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`) || rcMatch;
      const hs = curList.find(h => String(h.id) === String(hid) || String(h.id) === String(msg.hotspot_id));
      if (hs) {
        hs.collapsed = isCol;
        hs.isLiveCollapsed = false;
        if (hs._aslDynamicMatrixMode) {
          hs._aslDynamicMatrixMode = false;
          hs._aslDismissedUnlisted = new Set((hs.asl_unlisted_links || []).map(l => String(l.node).trim()));
        }
      }
      localStorage.setItem(`proxdmr_collapsed_${hid}`, isCol ? "true" : "false");
      if (isDefaultAlias) {
        localStorage.setItem("proxdmr_collapsed_default", isCol ? "true" : "false");
      }
      localStorage.setItem(`proxdmr_live_collapsed_${hid}`, "false");
      if (isDefaultAlias) {
        localStorage.setItem("proxdmr_live_collapsed_default", "false");
      }
      if (isCol && typeof window.closeLogIfOpenForHotspot === "function") {
        window.closeLogIfOpenForHotspot(hid, { card });
      }
      if (card) {
        card.classList.toggle("collapsed", isCol);
        card.classList.toggle("live-collapsed", false);
        const btn = card.querySelector(".hotspot-collapse-btn");
        if (btn) btn.title = isCol ? (window.t ? window.t("vfo.hotspot_expand_title", {}, "Развернуть этот хотспот (удержание: отправить в архив)") : "Развернуть этот хотспот (удержание: отправить в архив)") : (window.t ? window.t("vfo.hotspot_collapse_title", {}, "Свернуть этот хотспот (удержание: свернуть без отключения)") : "Свернуть этот хотспот (удержание: свернуть без отключения)");
        const nBadge = card.querySelector(".hotspot-name-badge");
        if (nBadge && isCol && !isLive) nBadge.classList.remove("is-online");
      }
      if (isCol && !isLive && typeof disableHotspotTranscribe === "function") {
        disableHotspotTranscribe(hid, true, false);
      }
      renderHotspotsList();
      renderHotspotSelect();
      if (typeof window.renderToolbarHotspotSlots === "function") {
        window.renderToolbarHotspotSlots();
      }
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
          const prevCollapsed = hsObj.collapsed;
          const prevLive = hsObj.isLiveCollapsed;
          Object.assign(hsObj, msg.hotspot);
          if (typeof prevCollapsed === "boolean") hsObj.collapsed = prevCollapsed;
          if (typeof prevLive === "boolean") hsObj.isLiveCollapsed = prevLive;
          if (msg.hotspot.auto_record !== undefined) {
            try { localStorage.setItem(`proxdmr_autorec_${resolvedTarget}`, msg.hotspot.auto_record ? "1" : "0"); } catch (_) {}
          }
          updateAllHotspotRecUI();
          if (typeof window.refreshAllCardsBmBanner === "function") {
            window.refreshAllCardsBmBanner();
          }
          if (typeof window.renderToolbarHotspotSlots === "function") {
            window.renderToolbarHotspotSlots();
          }
          if ((hsObj.network_type || "").toLowerCase() === "ysf") {
            const cEl = document.querySelector(`.radio-container[data-hotspot-id="${hsObj.id}"]`);
            if (cEl) {
              if (typeof window.updateCardYsfPanel === "function") {
                window.updateCardYsfPanel(cEl, hsObj);
              } else if (typeof window.syncCardYsfDgIdBar === "function") {
                window.syncCardYsfDgIdBar(cEl, hsObj);
              }
              if (typeof window.syncYsfMatrixButtonsState === "function") {
                window.syncYsfMatrixButtonsState(cEl, hsObj);
              }
              if (typeof window.updateCardPttHint === "function") {
                window.updateCardPttHint(cEl);
              }
            }
          }
        } else {
          loadHotspots();
        }
      }
    } else if (msg.type === "hotspots_reordered") {
      if (Array.isArray(msg.hotspots) && msg.hotspots.length > 0) {
        window.currentHotspots = msg.hotspots;
        if (typeof renderRadiosGrid === "function") renderRadiosGrid();
        if (typeof renderHotspotSelect === "function") renderHotspotSelect();
        if (typeof renderHotspotsList === "function") renderHotspotsList();
        if (typeof window.renderToolbarHotspotSlots === "function") window.renderToolbarHotspotSlots();
        if (typeof populateEditHotspotFormFields === "function") {
          const curHs = window.currentHotspots.find(h => h.id === window.activeHotspotId) || window.currentHotspots[0];
          populateEditHotspotFormFields(curHs);
        }
      } else {
        loadHotspots();
      }
    } else if (msg.type === "hotspot_created" || msg.type === "hotspot_deleted") {
      loadHotspots();
    } else if (msg.type === "recording_transcribed") {
      updateCallLogTranscription(msg);
    } else if (msg.type === "pipeline_stage") {
      if (typeof handlePipelineStage === "function") {
        handlePipelineStage(msg);
      }
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
        if (msg.tts_skip_short_callsign !== undefined) {
          window.transcriberSettings.tts_skip_short_callsign = msg.tts_skip_short_callsign;
          const optSkipShort = document.getElementById("optTtsSkipShortCallsign");
          if (optSkipShort) optSkipShort.checked = Boolean(msg.tts_skip_short_callsign);
          const qSkipShort = document.getElementById("ttsQuickSkipShortCallsign");
          if (qSkipShort) qSkipShort.checked = Boolean(msg.tts_skip_short_callsign);
        }
      }
      if (msg.source_lang !== undefined) {
        if (window.transcriberSettings) window.transcriberSettings.source_lang = msg.source_lang;
        const optSrcLang = document.getElementById("optTranscriberSourceLang");
        if (optSrcLang) optSrcLang.value = msg.source_lang;
        const popSrcLang = document.getElementById("popTxtSourceLang");
        if (popSrcLang) popSrcLang.value = msg.source_lang;
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

      document.querySelectorAll(".radio-container").forEach(card => {
        if (typeof window.updateCardE2eDisplay === "function") {
          window.updateCardE2eDisplay(card);
        } else {
          const rttEl = card.querySelector(".rtt-display");
          const srvMs = (card._lastServerPingMs !== null && card._lastServerPingMs !== undefined && !isNaN(Number(card._lastServerPingMs)))
            ? Math.round(Number(card._lastServerPingMs))
            : 0;
          const totalMs = rtt + srvMs;
          if (rttEl) {
            rttEl.textContent = `E2E: ${totalMs}ms`;
            rttEl.classList.remove("e2e-good", "e2e-warn", "e2e-bad");
            rttEl.classList.add(totalMs <= 150 ? "e2e-good" : (totalMs <= 350 ? "e2e-warn" : "e2e-bad"));
          }
        }
      });

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
export function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  pendingPings.clear();
}

export function enterSessionPausedState() {
  if (window.isDemoMode) return; // На режим ДЕМО система паузы одного подключения НЕ распространяется

  console.warn("[WS] Entering session PAUSED state (account opened on another device)");
  // Мгновенный сброс несохранённого локального состояния на сервер перед уходом в паузу
  if (typeof window.flushPendingClientStateToServer === "function") {
    try { window.flushPendingClientStateToServer(); } catch (_) {}
  }
  window.isSessionPausedByAnotherDevice = true;
  window._isRestoringPausedSession = false;

  // 1. Останавливаем авто-реконнекты и пинг (без разлогина — токены НЕ трогаем!)
  clearWsReconnectTimer();
  if (wsConnectTimeoutTimer) {
    clearTimeout(wsConnectTimeoutTimer);
    wsConnectTimeoutTimer = null;
  }
  isWsConnecting = false;
  setWasGwConnected(false);
  setGwIsFastReconnecting(false);
  setIsManualGwDisconnect(true);
  stopPing();

  // 2. Закрываем текущий сокет локально, если он ещё открыт
  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, "Session paused locally");
      }
    } catch (_) {}
    ws = null;
    window.ws = null;
  }

  // 3. Немедленно гасим передачу PTT и освобождаем микрофон
  try {
    if (typeof window.stopTransmission === "function") {
      window.stopTransmission({ silentCancel: true });
    }
  } catch (_) {}
  try {
    if (typeof window.stopAndReleaseMic === "function") {
      window.stopAndReleaseMic();
    } else if (window.micStream) {
      window.micStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      window.micStream = null;
    }
  } catch (_) {}

  // 4. Полностью останавливаем весь вывод звука (RX WebAudio, плеер Истории, TTS, тоны)
  try {
    if (typeof window.stopLocalRogerBeep === "function") {
      window.stopLocalRogerBeep();
    }
  } catch (_) {}
  try {
    if (window.audioPlayer) {
      if (typeof window.audioPlayer.reset === "function") {
        window.audioPlayer.reset();
      }
      if (window.audioPlayer.audioCtx && window.audioPlayer.audioCtx.state === "running") {
        window.audioPlayer.audioCtx.suspend().catch(() => {});
      }
    }
  } catch (_) {}
  try {
    if (window.recordingsManager && window.recordingsManager.audio && !window.recordingsManager.audio.paused) {
      window.recordingsManager.audio.pause();
    }
  } catch (_) {}
  try {
    if (window.ttsAudioQueueManager && typeof window.ttsAudioQueueManager.stopAll === "function") {
      window.ttsAudioQueueManager.stopAll();
    }
  } catch (_) {}
  resetTranscribeAndTtsOnDisconnect();

  // Сбрасываем визуальную индикацию активного RX и отложенные hold-таймеры на всех карточках
  document.querySelectorAll(".radio-container").forEach(card => {
    _clearRxVisualHoldTimer(card, 1);
    _clearRxVisualHoldTimer(card, 2);
  });
  document.querySelectorAll(".vfo-rx-active").forEach(el => el.classList.remove("vfo-rx-active"));
  document.querySelectorAll(".allstar-rx-active").forEach(el => el.classList.remove("allstar-rx-active"));
  document.querySelectorAll(".vfo-ts1-rx.active, .vfo-ts2-rx.active").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".radio-container").forEach(card => updateCardModeBadge(card));

  // 5. Обновляем статус GW на карточках и в шторке Android APK
  const pausedStatusTxt = window.t
    ? window.t("gw.session_paused_status", {}, "На паузе (активно другое устройство)")
    : "На паузе (активно другое устройство)";
  updateGwStatus(false, pausedStatusTxt);
  if (window.AndroidBridge && typeof window.AndroidBridge.updateRadioStatus === "function") {
    try { window.AndroidBridge.updateRadioStatus(pausedStatusTxt); } catch (_) {}
  }

  // 6. Показываем модальное окно с кнопкой [Восстановить]
  const modal = document.getElementById("sessionPausedModal");
  const btn = document.getElementById("btnRestorePausedSession");
  const btnLbl = document.getElementById("btnRestorePausedSessionLabel");
  if (btn) {
    btn.disabled = false;
    if (btnLbl) {
      btnLbl.textContent = window.t
        ? window.t("gw.session_paused_restore_btn", {}, "Восстановить")
        : "Восстановить";
    }
    if (!btn._restoreWired) {
      btn._restoreWired = true;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        restorePausedSession();
      });
    }
  }
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("active");
  }
}

export function restorePausedSession() {
  const btn = document.getElementById("btnRestorePausedSession");
  const btnLbl = document.getElementById("btnRestorePausedSessionLabel");
  if (btn) btn.disabled = true;
  if (btnLbl) {
    btnLbl.textContent = window.t
      ? window.t("gw.session_paused_restoring_btn", {}, "Восстановление...")
      : "Восстановление...";
  }

  window._isRestoringPausedSession = true;
  window.isSessionPausedByAnotherDevice = false;
  setIsManualGwDisconnect(false);
  setGwConnectAttempt(1);
  setGwIsFastReconnecting(false);

  // Принудительно запрашиваем свежие серверные коллекции, пресеты баннеров и состояние хотспотов
  if (typeof window._loadPinnedServersFromServer === "function") {
    try { window._loadPinnedServersFromServer(); } catch (_) {}
  }
  if (typeof window.loadContactsFromServer === "function") {
    try { window.loadContactsFromServer(); } catch (_) {}
  }
  if (typeof window.loadYsfFavoritesFromServer === "function") {
    try { window.loadYsfFavoritesFromServer(); } catch (_) {}
  }

  // Возобновляем AudioContext прямо внутри пользовательского клика по [Восстановить]
  try {
    if (window.audioPlayer) {
      if (typeof window.audioPlayer.ensureInitialized === "function") {
        window.audioPlayer.ensureInitialized();
      }
      if (window.audioPlayer.audioCtx && window.audioPlayer.audioCtx.state === "suspended") {
        window.audioPlayer.audioCtx.resume().catch(() => {});
      }
    }
    if (window.audioCtx && window.audioCtx.state === "suspended") {
      window.audioCtx.resume().catch(() => {});
    }
  } catch (_) {}

  connectWebSocket(true);
}

export function startPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
    if (window.isSessionPausedByAnotherDevice) return;
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
  window.addEventListener("offline", () => {
    console.warn("[NET] Browser offline event detected. Disconnecting and resetting transcribe/TTS buttons...");
    resetTranscribeAndTtsOnDisconnect();
    if (typeof handleGwDisconnectFailure === "function") {
      handleGwDisconnectFailure("Browser offline");
    }
  });

  window.addEventListener("online", () => {
    console.log("[NET] Browser online event detected. Forcing immediate WebSocket reconnection...");
    if (typeof window.connectWebSocket === "function" && !window.isManualGwDisconnect && !window.isSessionPausedByAnotherDevice) {
      window.connectWebSocket(true);
    }
  });
}

// Global attachments
window.connectWebSocket = connectWebSocket;
window.handleGwDisconnectFailure = handleGwDisconnectFailure;
window.handleServerMessage = handleServerMessage;
window.startPing = startPing;
window.stopPing = stopPing;
window.enterSessionPausedState = enterSessionPausedState;
window.restorePausedSession = restorePausedSession;
window.resetTranscribeAndTtsOnDisconnect = resetTranscribeAndTtsOnDisconnect;

window.__proxdmr = window.__proxdmr || {};
window.__proxdmr.connectWebSocket = connectWebSocket;
window.__proxdmr.handleGwDisconnectFailure = handleGwDisconnectFailure;
window.__proxdmr.handleServerMessage = handleServerMessage;
window.__proxdmr.startPing = startPing;
window.__proxdmr.stopPing = stopPing;
window.__proxdmr.enterSessionPausedState = enterSessionPausedState;
window.__proxdmr.restorePausedSession = restorePausedSession;
window.__proxdmr.resetTranscribeAndTtsOnDisconnect = resetTranscribeAndTtsOnDisconnect;
