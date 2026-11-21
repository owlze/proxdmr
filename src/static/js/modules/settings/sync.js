/**
 * ProxDMR - Account Client Settings Sync & Persistence Subsystem
 * Collects client-side preferences (audio RX/TX presets, AGC, vocoder presets,
 * local storage dumps) and syncs them bi-directionally with the backend.
 */

import { resolveHotspotId } from "../network/ping-sparklines.js?v=2.9.712";
import { updateSlotLangBadge } from "../dmr/transcriber.js?v=2.9.787";

let clientSettingsSyncTimer = null;
let lastClientSettingsPushAt = 0;

function getWs() {
  return (typeof window !== "undefined" && window.ws) || null;
}

function getAudioPlayer() {
  return (typeof window !== "undefined" && (window.audioPlayer || (window.__proxdmr && window.__proxdmr.audioPlayer))) || null;
}

function _numFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === "") return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch (_) {
    return fallback;
  }
}

function isTransientTranscribeOrTtsKey(k) {
  if (!k) return false;
  return (
    k.startsWith("proxdmr_pre_tts_ts_mode_") ||
    k === "proxdmr_transcribe_ts1" ||
    k === "proxdmr_transcribe_ts2" ||
    k.startsWith("proxdmr_max_transcribe_") ||
    k.startsWith("proxdmr_transcribe_automuted_") ||
    /^proxdmr_transcribe_.*_ts[12]$/.test(k) ||
    k === "proxdmr_tts_ts1" ||
    k === "proxdmr_tts_ts2" ||
    k === "proxdmr_tts_solo_muted_slots" ||
    k === "proxdmr_tts_solo_muted_hs" ||
    /^proxdmr_tts_.*_ts[12]$/.test(k)
  );
}

function isPersistentUserStorageKey(k) {
  if (!k || typeof k !== "string") return false;
  if (k === "proxdmr_auth_token" || k === "proxdmr_auth_login" || k === "proxdmr_demo_language" || k === "proxdmr_last_uid") return false;
  if (k.startsWith("proxdmr_gw_disconnected_")) return false;
  if (k.startsWith("proxdmr_client_ping_") || k.startsWith("proxdmr_ping_hist_")) return false;
  if (k.startsWith("proxdmr_tg_names_") || k === "proxdmr_tgif_tg_names_cache" || k === "proxdmr_freedmr_tg_names_cache" || k === "proxdmr_adn_tg_names_cache") return false;
  if (k.startsWith("proxdmr_user_callsigns_") || k === "proxdmr_allstar_directory") return false;
  if (isTransientTranscribeOrTtsKey(k)) return false;

  // Исключаем ВСЕ коллекции (user_collections) и серверные состояния хотспотов
  if (k.startsWith("pinnedServers_") || k.startsWith("srvSortMode_") || k.startsWith("srvSortDir_")) return false;
  if (k.startsWith("proxdmr_quick_mem") || /^proxdmr_u\d+_quick_mem/.test(k) || k.startsWith("proxdmr_asl_mem")) return false;
  if (
    k.startsWith("proxdmr_ysf_matrix_") ||
    k.startsWith("proxdmr_m17_matrix_") ||
    k.startsWith("proxdmr_asl_quick_nodes_") ||
    k.startsWith("proxdmr_asl_default_nodes_") ||
    k.startsWith("proxdmr_ysf_scan_cfg_") ||
    k.startsWith("proxdmr_ysf_dice_cfg_") ||
    k.startsWith("proxdmr_m17_scan_cfg_") ||
    k.startsWith("proxdmr_m17_dice_cfg_") ||
    k.startsWith("proxdmr_adn_dice_cfg_") ||
    k.startsWith("proxdmr_asl_scan_cfg_") ||
    k.startsWith("proxdmr_asl_dice_cfg_") ||
    k.startsWith("proxdmr_ysf_dash_auto_") ||
    k.startsWith("proxdmr_m17_dash_auto_") ||
    k.startsWith("proxdmr_dstar_dash_auto_") ||
    k.startsWith("proxdmr_svx_dash_auto_") ||
    k.startsWith("proxdmr_asl_dash_auto_")
  ) return false;
  if (
    k.startsWith("proxdmr_collapsed_") ||
    k.startsWith("proxdmr_live_collapsed_") ||
    k.startsWith("proxdmr_pre_collapse_mute_") ||
    k.startsWith("proxdmr_autorec_") ||
    k === "proxdmr_active_hotspot_id"
  ) return false;
  if (k === "proxdmr_my_contacts_tree" || k === "proxdmr_contacts_gw" || k === "proxdmr_ysf_bookmarks" || k === "proxdmr_m17_bookmarks" || k.startsWith("proxdmr_ysf_favorites") || k.startsWith("proxdmr_m17_favorites") || k.startsWith("proxdmr_dstar_favorites") || k.startsWith("proxdmr_svx_favorites")) return false;

  // Аппаратный кеш драйвера микрофона/BT-промпта сессии и устаревший скрытый pre-gain не синхронизируем
  if (k === "proxdmr_audio_input_device" || k.startsWith("proxdmr_bt_mic_") || k === "proxdmr_pre_gain_db") return false;

  return (
    k.startsWith("proxdmr_") ||
    k.startsWith("dmr_")
  );
}

/**
 * Capture full snapshot of client settings and non-transient localStorage state
 * @returns {object}
 */
export function getClientSettingsSnapshot() {
  let rxPresets = {};
  let vrxPresets = {};
  let txPresets = {};
  try {
    rxPresets = {
      "1": JSON.parse(localStorage.getItem("proxdmr_audio_rx_preset_1") || "null"),
      "2": JSON.parse(localStorage.getItem("proxdmr_audio_rx_preset_2") || "null"),
      "3": JSON.parse(localStorage.getItem("proxdmr_audio_rx_preset_3") || "null")
    };
  } catch (_) {}
  try {
    vrxPresets = {
      "1": JSON.parse(localStorage.getItem("proxdmr_ambe_preset_1") || "null"),
      "2": JSON.parse(localStorage.getItem("proxdmr_ambe_preset_2") || "null"),
      "3": JSON.parse(localStorage.getItem("proxdmr_ambe_preset_3") || "null")
    };
  } catch (_) {}
  try {
    txPresets = {
      "1": JSON.parse(localStorage.getItem("proxdmr_audio_tx_preset_1") || "null"),
      "2": JSON.parse(localStorage.getItem("proxdmr_audio_tx_preset_2") || "null"),
      "3": JSON.parse(localStorage.getItem("proxdmr_audio_tx_preset_3") || "null")
    };
  } catch (_) {}
  let aslTxPresets = {};
  try {
    aslTxPresets = {
      "1": JSON.parse(localStorage.getItem("proxdmr_asl_audio_tx_preset_1") || "null"),
      "2": JSON.parse(localStorage.getItem("proxdmr_asl_audio_tx_preset_2") || "null"),
      "3": JSON.parse(localStorage.getItem("proxdmr_asl_audio_tx_preset_3") || "null")
    };
  } catch (_) {}

  const rxBoostPct = Math.max(1, Math.min(100, parseInt(localStorage.getItem("proxdmr_rx_boost_pct") || "50", 10) || 50));
  const audioRx = {
    agc_enabled: localStorage.getItem("proxdmr_agc") !== "false",
    boost_pct: rxBoostPct,
    active_preset: localStorage.getItem("proxdmr_audio_rx_active_preset") || "1",
    jitter_buffer_ms: Math.max(40, Math.min(2000, parseInt(localStorage.getItem("proxdmr_jitter_buffer_ms") || "120", 10) || 120)),
    presets: rxPresets
  };
  const aslAudioRx = {
    boost_pct: rxBoostPct,
    active_preset: localStorage.getItem("proxdmr_asl_audio_rx_active_preset") || "1",
    jitter_buffer_ms: Math.max(40, Math.min(2000, parseInt(localStorage.getItem("proxdmr_asl_jitter_buffer_ms") || "80", 10) || 80)),
    presets: {
      "1": JSON.parse(localStorage.getItem("proxdmr_asl_audio_rx_preset_1") || "null"),
      "2": JSON.parse(localStorage.getItem("proxdmr_asl_audio_rx_preset_2") || "null"),
      "3": JSON.parse(localStorage.getItem("proxdmr_asl_audio_rx_preset_3") || "null")
    }
  };

    const ambeActivePreset = localStorage.getItem("proxdmr_ambe_active_preset") || "1";
    const ambeDefByPreset = {
      "1": { spectral_enh: true, high_band_gain_db: 0.5, unvoiced_gain_db: -1.5 },
      "2": { spectral_enh: true, high_band_gain_db: 4.5, unvoiced_gain_db: 1.0 },
      "3": { spectral_enh: true, high_band_gain_db: 0.0, unvoiced_gain_db: -1.5 }
    };
    const ambeCurCfg = Object.assign(
      {},
      ambeDefByPreset[ambeActivePreset] || ambeDefByPreset["1"],
      (vrxPresets[ambeActivePreset] && typeof vrxPresets[ambeActivePreset] === "object") ? vrxPresets[ambeActivePreset] : {}
    );

    const ambeRx = {
      spectral_enh: ambeCurCfg.spectral_enh !== false,
      high_band_gain_db: Number.isFinite(Number(ambeCurCfg.high_band_gain_db)) ? Number(ambeCurCfg.high_band_gain_db) : 0.5,
      unvoiced_gain_db: Number.isFinite(Number(ambeCurCfg.unvoiced_gain_db)) ? Number(ambeCurCfg.unvoiced_gain_db) : -1.5,
      active_preset: ambeActivePreset,
      presets: vrxPresets
    };

    const presenceBoost = _numFromStorage("proxdmr_tx_presence", 0);

    const audioTx = {
      mic_gain: _numFromStorage("proxdmr_tx_mic_gain", 0),
      bt_mic: localStorage.getItem("proxdmr_tx_bt_mic") === "true",
      bt_mic_selected_id: localStorage.getItem("proxdmr_tx_bt_mic_selected_id") || "",
      browser_mic_id: localStorage.getItem("proxdmr_tx_browser_mic_id") || "",
      noise_suppression: localStorage.getItem("proxdmr_tx_ns") === "true",
      browser_agc: localStorage.getItem("proxdmr_tx_agc") === "true",
      dsp_agc: localStorage.getItem("proxdmr_tx_dsp_agc") === "true",
      echo_cancellation: localStorage.getItem("proxdmr_tx_aec") === "true",
      gate_enabled: localStorage.getItem("proxdmr_tx_gate_enabled") !== "false",
      gate_threshold: _numFromStorage("proxdmr_tx_gate_threshold", -45),
      hpf_enabled: localStorage.getItem("proxdmr_tx_hpf") !== "false",
      presence_boost: presenceBoost,
      eq_low: _numFromStorage("proxdmr_tx_eq_low", 0),
      eq_mid: _numFromStorage("proxdmr_tx_eq_mid", 0),
      eq_high: _numFromStorage("proxdmr_tx_eq_high", 0),
      eq_preset: localStorage.getItem("proxdmr_tx_eq_preset") || "standard",
      active_preset: localStorage.getItem("proxdmr_audio_tx_active_preset") || "1",
      presets: txPresets
    };

    const aslAudioTx = {
      mic_gain: _numFromStorage("proxdmr_asl_tx_mic_gain", 0),
      bt_mic: localStorage.getItem("proxdmr_asl_tx_bt_mic") === "true",
      noise_suppression: localStorage.getItem("proxdmr_asl_tx_ns") === "true",
      browser_agc: localStorage.getItem("proxdmr_asl_tx_agc") === "true",
      dsp_agc: localStorage.getItem("proxdmr_asl_tx_dsp_agc") !== "false",
      echo_cancellation: localStorage.getItem("proxdmr_asl_tx_aec") === "true",
      gate_enabled: localStorage.getItem("proxdmr_asl_tx_gate_enabled") !== "false",
      gate_threshold: _numFromStorage("proxdmr_asl_tx_gate_threshold", -45),
      hpf_enabled: localStorage.getItem("proxdmr_asl_tx_hpf") !== "false",
      presence_boost: _numFromStorage("proxdmr_asl_tx_presence", 0),
      eq_low: _numFromStorage("proxdmr_asl_tx_eq_low", 0),
      eq_mid: _numFromStorage("proxdmr_asl_tx_eq_mid", 0),
      eq_high: _numFromStorage("proxdmr_asl_tx_eq_high", 0),
      eq_preset: localStorage.getItem("proxdmr_asl_tx_eq_preset") || "standard",
      active_preset: localStorage.getItem("proxdmr_asl_audio_tx_active_preset") || "1",
      presets: aslTxPresets
    };

  const storageDump = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isPersistentUserStorageKey(k)) {
        storageDump[k] = localStorage.getItem(k);
      }
    }
  } catch (_) {}

  return {
    audio_rx: audioRx,
    asl_audio_rx: aslAudioRx,
    ambe_rx: ambeRx,
    audio_tx: audioTx,
    asl_audio_tx: aslAudioTx,
    storage_dump: storageDump
  };
}

function sendClientSettingsHttp(snapshot, keepalive = false) {
  if (typeof fetch !== "function") return Promise.resolve(null);
  const headers = { "Content-Type": "application/json" };
  try {
    const tok = localStorage.getItem("proxdmr_auth_token");
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
  } catch (_) {}
  try {
    return fetch("/api/user/client-settings", {
      method: "POST",
      headers,
      credentials: "same-origin",
      keepalive: Boolean(keepalive),
      body: JSON.stringify({ client_settings: snapshot })
    }).catch(e => {
      console.warn("[SETTINGS] HTTP client-settings save error:", e);
      return null;
    });
  } catch (e) {
    console.warn("[SETTINGS] HTTP client-settings exception:", e);
    return Promise.resolve(null);
  }
}

export function cancelPendingClientSettingsSync() {
  if (clientSettingsSyncTimer) {
    clearTimeout(clientSettingsSyncTimer);
    clientSettingsSyncTimer = null;
  }
}

export function syncClientSettingsNow(options = {}) {
  if (typeof window !== "undefined") {
    if (window.isDemoMode) return Promise.resolve(null);
    if (!window.__proxdmrClientSettingsHydrated) return Promise.resolve(null);
    if (window.__proxdmrHydratingClientSettings) return Promise.resolve(null);
  }
  cancelPendingClientSettingsSync();
  const snapshot = getClientSettingsSnapshot();
  lastClientSettingsPushAt = Date.now();
  const useKeepalive = Boolean(options && options.keepalive);
  const ws = getWs();

  if (useKeepalive) {
    if (ws && ws.readyState === WebSocket.OPEN && !options.skipWs) {
      try {
        ws.send(JSON.stringify({
          type: "save_client_settings",
          client_settings: snapshot
        }));
      } catch (_) {}
    }
    return sendClientSettingsHttp(snapshot, true);
  }

  if (ws && ws.readyState === WebSocket.OPEN && !options.forceHttp) {
    try {
      ws.send(JSON.stringify({
        type: "save_client_settings",
        client_settings: snapshot
      }));
      return Promise.resolve(true);
    } catch (e) {
      console.warn("[SETTINGS] WS save failed, falling back to HTTP:", e);
    }
  }
  return sendClientSettingsHttp(snapshot, false);
}

/**
 * Push of current client settings to server (0ms immediate or debounced)
 */
export function scheduleSyncClientSettings(delay = 250) {
  if (typeof window !== "undefined") {
    if (window.isDemoMode) return;
    if (!window.__proxdmrClientSettingsHydrated) return;
    if (window.__proxdmrHydratingClientSettings) return;
  }
  cancelPendingClientSettingsSync();
  const waitMs = Number(delay);
  if (!Number.isFinite(waitMs) || waitMs <= 0) {
    syncClientSettingsNow();
    return;
  }
  clientSettingsSyncTimer = setTimeout(() => {
    clientSettingsSyncTimer = null;
    syncClientSettingsNow();
  }, Math.max(40, waitMs));
}

/**
 * Flushes any pending or very recent client settings push with HTTP keepalive fallback.
 */
export function flushPendingClientSettingsSync(options = {}) {
  if (typeof window !== "undefined") {
    if (window.isDemoMode) return Promise.resolve(null);
    if (!window.__proxdmrClientSettingsHydrated) return Promise.resolve(null);
    if (window.__proxdmrHydratingClientSettings) return Promise.resolve(null);
  }
  const hasTimer = Boolean(clientSettingsSyncTimer);
  const recentlyPushed = lastClientSettingsPushAt > 0 && (Date.now() - lastClientSettingsPushAt) < 1500;
  if (hasTimer || recentlyPushed || (options && options.force)) {
    return syncClientSettingsNow({ keepalive: true, ...(options || {}) });
  }
  return Promise.resolve(null);
}

/**
 * Apply server-sent client settings into localStorage, DOM controls, and audio DSP
 * @param {object} cs
 */
export function applyServerClientSettings(cs) {
  if (!cs || typeof cs !== "object") return;
  if (typeof window !== "undefined") {
    window.__proxdmrHydratingClientSettings = true;
  }
  try {
    // 1. Restore from storage_dump if present (excluding transient UI state, auth credentials & live transcribe/TTS flags)
    if (cs.storage_dump && typeof cs.storage_dump === "object") {
      try {
        const dumpKeys = Object.keys(cs.storage_dump);
        if (dumpKeys.length > 0) {
          const resettableColorKeyRe = /^proxdmr_(?:u\d+_)?(?:vfo_(?:rx|rx_muted|standby)_(?:top|bot)_(?:dark|light)|vfo_tx_bg_(?:top|bot)|toolbar_bg_(?:top|bottom)(?:_light)?)$/;
          const staleColorKeys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const lk = localStorage.key(i);
            if (lk && resettableColorKeyRe.test(lk) && !Object.prototype.hasOwnProperty.call(cs.storage_dump, lk)) {
              staleColorKeys.push(lk);
            }
          }
          staleColorKeys.forEach(lk => localStorage.removeItem(lk));
        }
        for (const [k, v] of Object.entries(cs.storage_dump)) {
          if (k && (k.startsWith("proxdmr_") || k.startsWith("dmr_")) && v !== null && v !== undefined &&
              !k.startsWith("proxdmr_gw_disconnected_") &&
              !isTransientTranscribeOrTtsKey(k) &&
              k !== "proxdmr_pre_gain_db" &&
              k !== "proxdmr_demo_language" &&
              k !== "proxdmr_auth_token" &&
              k !== "proxdmr_auth_login" &&
              k !== "proxdmr_last_uid") {
            localStorage.setItem(k, String(v));
          }
        }
        localStorage.removeItem("proxdmr_pre_gain_db");
      } catch (e) {
        console.warn("[SETTINGS] Error restoring storage_dump:", e);
      }
    }

    const audioPlayer = getAudioPlayer();

    const _isModernRxPresetObj = (p) => {
      return Boolean(p && typeof p === "object" && (
        "eq10Gains" in p || "eq10Enable" in p || "limiterEnable" in p || "boostPct" in p
      ));
    };

    // 2. Restore structured Audio RX
    if (cs.audio_rx && typeof cs.audio_rx === "object") {
      const arx = cs.audio_rx;
      if (arx.agc_enabled !== undefined) {
        const ab = arx.agc_enabled !== false;
        localStorage.setItem("proxdmr_agc", ab ? "true" : "false");
        localStorage.setItem("proxdmr_agc_default", ab ? "true" : "false");
      }
      if (arx.boost_pct !== undefined) {
        const bVal = Math.max(1, Math.min(100, parseInt(arx.boost_pct, 10) || 50));
        localStorage.setItem("proxdmr_rx_boost_pct", String(bVal));
      }
      if (arx.active_preset) localStorage.setItem("proxdmr_audio_rx_active_preset", arx.active_preset.toString());
      if (arx.presets && typeof arx.presets === "object") {
        for (const [pid, pdata] of Object.entries(arx.presets)) {
          let parsedObj = pdata;
          if (typeof pdata === "string") {
            try { parsedObj = JSON.parse(pdata); } catch (_) { parsedObj = null; }
          }
          if (_isModernRxPresetObj(parsedObj)) {
            localStorage.setItem(`proxdmr_audio_rx_preset_${pid}`, JSON.stringify(parsedObj));
          }
        }
      }
      if (arx.jitter_buffer_ms !== undefined) {
        localStorage.setItem("proxdmr_jitter_buffer_ms", arx.jitter_buffer_ms.toString());
      }
      if (arx.backend_buffer_ms !== undefined) {
        localStorage.setItem("proxdmr_backend_buffer_ms", arx.backend_buffer_ms.toString());
        if (typeof window !== "undefined" && typeof window.updateBackendBufferUI === "function") {
          window.updateBackendBufferUI(arx.backend_buffer_ms, false);
        }
      }
    }

    // 2b. Restore structured ASL Audio RX
    if (cs.asl_audio_rx && typeof cs.asl_audio_rx === "object") {
      const aslrx = cs.asl_audio_rx;
      if (aslrx.active_preset) localStorage.setItem("proxdmr_asl_audio_rx_active_preset", aslrx.active_preset.toString());
      if (aslrx.jitter_buffer_ms !== undefined) localStorage.setItem("proxdmr_asl_jitter_buffer_ms", aslrx.jitter_buffer_ms.toString());
      if (aslrx.boost_pct !== undefined && !localStorage.getItem("proxdmr_rx_boost_pct")) {
        const bVal = Math.max(1, Math.min(100, parseInt(aslrx.boost_pct, 10) || 50));
        localStorage.setItem("proxdmr_rx_boost_pct", String(bVal));
      }
      if (aslrx.presets && typeof aslrx.presets === "object") {
        for (const [pid, pdata] of Object.entries(aslrx.presets)) {
          let parsedObj = pdata;
          if (typeof pdata === "string") {
            try { parsedObj = JSON.parse(pdata); } catch (_) { parsedObj = null; }
          }
          if (_isModernRxPresetObj(parsedObj)) {
            localStorage.setItem(`proxdmr_asl_audio_rx_preset_${pid}`, JSON.stringify(parsedObj));
          }
        }
      }
    }

    // 3. Restore structured AMBE+2 RX (mbelib-neo Vocoder)
    if (cs.ambe_rx && typeof cs.ambe_rx === "object") {
      const vrx = cs.ambe_rx;
      const isModernAmbe = vrx.high_band_gain_db !== undefined || vrx.unvoiced_gain_db !== undefined ||
        (vrx.presets && Object.values(vrx.presets).some(p => p && typeof p === "object" && p.high_band_gain_db !== undefined));
      if (isModernAmbe) {
        if (vrx.active_preset) {
          localStorage.setItem("proxdmr_ambe_active_preset", vrx.active_preset.toString());
        }
        if (vrx.presets && typeof vrx.presets === "object") {
          for (const [pid, pdata] of Object.entries(vrx.presets)) {
            let parsedObj = pdata;
            if (typeof pdata === "string") {
              try { parsedObj = JSON.parse(pdata); } catch (_) { parsedObj = null; }
            }
            if (parsedObj && typeof parsedObj === "object" && parsedObj.high_band_gain_db !== undefined) {
              localStorage.setItem(`proxdmr_ambe_preset_${pid}`, JSON.stringify({
                spectral_enh: parsedObj.spectral_enh !== false,
                high_band_gain_db: Number.isFinite(Number(parsedObj.high_band_gain_db)) ? Number(parsedObj.high_band_gain_db) : 0.5,
                unvoiced_gain_db: Number.isFinite(Number(parsedObj.unvoiced_gain_db)) ? Number(parsedObj.unvoiced_gain_db) : -1.5
              }));
            }
          }
        }
        const actAmbeId = (vrx.active_preset ? vrx.active_preset.toString() : null) || localStorage.getItem("proxdmr_ambe_active_preset") || "1";
        if (vrx.high_band_gain_db !== undefined || vrx.unvoiced_gain_db !== undefined) {
          const curRaw = localStorage.getItem(`proxdmr_ambe_preset_${actAmbeId}`);
          if (!curRaw) {
            localStorage.setItem(`proxdmr_ambe_preset_${actAmbeId}`, JSON.stringify({
              spectral_enh: vrx.spectral_enh !== false,
              high_band_gain_db: Number.isFinite(Number(vrx.high_band_gain_db)) ? Number(vrx.high_band_gain_db) : 0.5,
              unvoiced_gain_db: Number.isFinite(Number(vrx.unvoiced_gain_db)) ? Number(vrx.unvoiced_gain_db) : -1.5
            }));
          }
        }
      }
    }

    // 4. Restore structured Audio TX & ASL Audio TX (100% per account)
    const _restoreStructuredTx = (txObj, flatPfx, presetPfx, isAslNet) => {
      if (!txObj || typeof txObj !== "object") return;
      const isModernTx = ("dsp_agc" in txObj) || ("eq_low" in txObj) ||
        (txObj.presets && Object.values(txObj.presets).some(p => p && typeof p === "object" && "txDspAgc" in p));
      if (!isModernTx) return;
      if (txObj.active_preset) localStorage.setItem(`${presetPfx}_active_preset`, txObj.active_preset.toString());
      if (txObj.presets && typeof txObj.presets === "object") {
        for (const [pid, pdata] of Object.entries(txObj.presets)) {
          if (pdata && typeof pdata === "object") {
            localStorage.setItem(`${presetPfx}_preset_${pid}`, JSON.stringify(pdata));
          }
        }
      }
      if (txObj.mic_gain !== undefined) localStorage.setItem(`${flatPfx}mic_gain`, String(txObj.mic_gain));
      if (txObj.bt_mic !== undefined) localStorage.setItem(`${flatPfx}bt_mic`, txObj.bt_mic ? "true" : "false");
      if (!isAslNet && txObj.bt_mic_selected_id !== undefined) localStorage.setItem("proxdmr_tx_bt_mic_selected_id", String(txObj.bt_mic_selected_id));
      if (!isAslNet && txObj.browser_mic_id !== undefined) localStorage.setItem("proxdmr_tx_browser_mic_id", String(txObj.browser_mic_id));
      if (txObj.noise_suppression !== undefined) localStorage.setItem(`${flatPfx}ns`, txObj.noise_suppression ? "true" : "false");
      if (txObj.browser_agc !== undefined) localStorage.setItem(`${flatPfx}agc`, txObj.browser_agc ? "true" : "false");
      if (txObj.dsp_agc !== undefined) localStorage.setItem(`${flatPfx}dsp_agc`, txObj.dsp_agc ? "true" : "false");
      if (txObj.echo_cancellation !== undefined) localStorage.setItem(`${flatPfx}aec`, txObj.echo_cancellation ? "true" : "false");
      if (txObj.gate_enabled !== undefined) localStorage.setItem(`${flatPfx}gate_enabled`, txObj.gate_enabled !== false ? "true" : "false");
      if (txObj.gate_threshold !== undefined) localStorage.setItem(`${flatPfx}gate_threshold`, String(txObj.gate_threshold));
      if (txObj.hpf_enabled !== undefined) localStorage.setItem(`${flatPfx}hpf`, txObj.hpf_enabled !== false ? "true" : "false");
      if (txObj.presence_boost !== undefined) localStorage.setItem(`${flatPfx}presence`, String(txObj.presence_boost));
      if (txObj.eq_low !== undefined) localStorage.setItem(`${flatPfx}eq_low`, String(txObj.eq_low));
      if (txObj.eq_mid !== undefined) localStorage.setItem(`${flatPfx}eq_mid`, String(txObj.eq_mid));
      if (txObj.eq_high !== undefined) localStorage.setItem(`${flatPfx}eq_high`, String(txObj.eq_high));
      if (txObj.eq_preset) localStorage.setItem(`${flatPfx}eq_preset`, String(txObj.eq_preset));
    };
    _restoreStructuredTx(cs.audio_tx, "proxdmr_tx_", "proxdmr_audio_tx", false);
    _restoreStructuredTx(cs.asl_audio_tx, "proxdmr_asl_tx_", "proxdmr_asl_audio_tx", true);

    // Apply restored RX / TX / AMBE state immediately to audioPlayer, DOM controls and cards
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

    if (audioPlayer) {
      if (typeof audioPlayer.setRxBoostDb === "function") {
        audioPlayer.setRxBoostDb(parseInt(localStorage.getItem("proxdmr_rx_boost_pct") || "50", 10) || 50);
      }
      if (typeof audioPlayer.loadDspProfilesFromStorage === "function") {
        audioPlayer.loadDspProfilesFromStorage();
      }
      if (typeof audioPlayer.ensureNetworkProfile === "function") {
        let targetNet = null;
        if (typeof window !== "undefined" && Array.isArray(window.currentHotspots) && window.currentHotspots.length > 0) {
          const aid = String(window.activeHotspotId || "default");
          const activeHs = window.currentHotspots.find(h => String(h.id) === aid) || window.currentHotspots[0];
          if (activeHs && activeHs.network_type) {
            targetNet = String(activeHs.network_type).toLowerCase() === "allstar" ? "allstar" : "dmr";
          }
        }
        if (!targetNet) {
          targetNet = localStorage.getItem("proxdmr_audio_rx_net") === "allstar" ? "allstar" : (audioPlayer.activeProfileNet || "dmr");
        }
        audioPlayer.ensureNetworkProfile(targetNet, true);
      }
    }

    // 5. Update Hotspot UI & Audio Engine
    const agcBool = localStorage.getItem("proxdmr_agc") !== "false";
    document.querySelectorAll(".agc-toggle").forEach(chk => { chk.checked = agcBool; });
    const mainAgcChk = document.getElementById("agcToggle");
    if (mainAgcChk) mainAgcChk.checked = agcBool;

    if (typeof window !== "undefined" && typeof window.updateAllVolumeAndMuteUI === "function") {
      window.updateAllVolumeAndMuteUI();
    }
    if (typeof window !== "undefined" && typeof window.updateAllHotspotTsAudioModeUI === "function") {
      window.updateAllHotspotTsAudioModeUI();
    }
    if (typeof window !== "undefined") {
      if (typeof window.applyBackgroundForActiveTheme === "function") {
        try { window.applyBackgroundForActiveTheme(); } catch (_) {}
      }
      if (typeof window.applyToolbarBgForActiveTheme === "function") {
        try { window.applyToolbarBgForActiveTheme(); } catch (_) {}
      }
      if (typeof window.applyHotspotTsColorsForActiveTheme === "function") {
        try { window.applyHotspotTsColorsForActiveTheme(); } catch (_) {}
      }
    }
  document.querySelectorAll(".vfo-row").forEach(row => {
    const card = row.closest(".radio-container");
    if (!card) return;
    const netType = (card.dataset.networkType || "").toLowerCase();
    const isAslOrYsf = card.classList.contains("card-net-allstar") ||
                       card.classList.contains("card-net-ysf") ||
                       card.classList.contains("card-net-m17") ||
                       card.classList.contains("card-net-dstar") ||
                       card.classList.contains("card-net-svx") ||
                       netType === "allstar" || netType === "ysf" || netType === "m17" || netType === "dstar" || netType === "svx";
    if (isAslOrYsf && (row.classList.contains("vfo-ts1-row") || row.classList.contains("vfo-ts2-row"))) {
      return;
    }
    const cid = resolveHotspotId(card.dataset.hotspotId);
    const isRowSlot1 = row.classList.contains("vfo-ts1-row") ||
                       row.classList.contains("vfo-allstar-row") ||
                       row.classList.contains("vfo-ysf-row");
    const slot = isRowSlot1 ? 1 : 2;
    const isCurtainRow = row.classList.contains("vfo-allstar-row") || row.classList.contains("vfo-ysf-row");
    const isCardInTranscribeMode = row.classList.contains("has-transcribe") &&
                                   (card.classList.contains("has-transcribe-mode") || isCurtainRow);
    if (!isCardInTranscribeMode) {
      try {
        localStorage.setItem(`proxdmr_transcribe_${cid}_ts${slot}`, "0");
        localStorage.setItem(`proxdmr_tts_${cid}_ts${slot}`, "0");
      } catch (_) {}
      row.classList.remove("has-transcribe", "is-maximized", "vfo-hidden-by-max");
      if (typeof updateSlotLangBadge === "function") {
        updateSlotLangBadge(row, slot, false);
      }
      if (typeof window !== "undefined" && typeof window.updateSlotTtsBadge === "function") {
        window.updateSlotTtsBadge(row, slot, false);
      }
      if (typeof window !== "undefined" && typeof window.updateCardTranscribeLayout === "function") {
        window.updateCardTranscribeLayout(card);
      }
    }
  });
  } finally {
    if (typeof window !== "undefined") {
      window.__proxdmrHydratingClientSettings = false;
    }
  }
}

// ── Authoritative Server Collections Cache ("лицо" -> "эталон") ───────────
const _serverCollections = (typeof window !== "undefined")
  ? (window.__proxdmrCollections = window.__proxdmrCollections || {})
  : {};

const _COLLECTION_LS_CLEANUP = [
  { cat: "ysf_matrix", lsPrefix: "proxdmr_ysf_matrix_", json: true },
  { cat: "m17_matrix", lsPrefix: "proxdmr_m17_matrix_", json: true },
  { cat: "asl_quick_nodes", lsPrefix: "proxdmr_asl_quick_nodes_", json: true },
  { cat: "asl_default_nodes", lsPrefix: "proxdmr_asl_default_nodes_", json: true },
  { cat: "ysf_scan_cfg", lsPrefix: "proxdmr_ysf_scan_cfg_", json: true },
  { cat: "ysf_dice_cfg", lsPrefix: "proxdmr_ysf_dice_cfg_", json: true },
  { cat: "m17_scan_cfg", lsPrefix: "proxdmr_m17_scan_cfg_", json: true },
  { cat: "m17_dice_cfg", lsPrefix: "proxdmr_m17_dice_cfg_", json: true },
  { cat: "adn_dice_cfg", lsPrefix: "proxdmr_adn_dice_cfg_", json: true },
  { cat: "asl_scan_cfg", lsPrefix: "proxdmr_asl_scan_cfg_", json: true },
  { cat: "asl_dice_cfg", lsPrefix: "proxdmr_asl_dice_cfg_", json: true },
  { cat: "ysf_dash_auto", lsPrefix: "proxdmr_ysf_dash_auto_", json: false },
  { cat: "m17_dash_auto", lsPrefix: "proxdmr_m17_dash_auto_", json: false },
  { cat: "dstar_dash_auto", lsPrefix: "proxdmr_dstar_dash_auto_", json: false },
  { cat: "svx_dash_auto", lsPrefix: "proxdmr_svx_dash_auto_", json: false },
  { cat: "asl_dash_auto", lsPrefix: "proxdmr_asl_dash_auto_", json: false },
  { cat: "pinned_servers", lsPrefix: "pinnedServers_", json: true },
  { cat: "ysf_room_types", lsPrefix: "", json: false },
];

function _removeStorageKeysByPrefix(prefix) {
  if (!prefix) return;
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch (_) {}
}

export function hydrateServerCollections(collectionsMap) {
  if (!collectionsMap || typeof collectionsMap !== "object") return;
  for (const spec of _COLLECTION_LS_CLEANUP) {
    if (Object.prototype.hasOwnProperty.call(collectionsMap, spec.cat)) {
      const serverObj = (collectionsMap[spec.cat] && typeof collectionsMap[spec.cat] === "object")
        ? collectionsMap[spec.cat]
        : {};
      _serverCollections[spec.cat] = { ...serverObj };
      if (spec.lsPrefix) {
        _removeStorageKeysByPrefix(spec.lsPrefix);
        try {
          for (const [k, v] of Object.entries(serverObj)) {
            if (v === null || v === undefined) continue;
            localStorage.setItem(spec.lsPrefix + k, spec.json ? (typeof v === "string" ? v : JSON.stringify(v)) : String(v));
          }
        } catch (_) {}
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(collectionsMap, "srv_sort_prefs")) {
    const sortObj = (collectionsMap.srv_sort_prefs && typeof collectionsMap.srv_sort_prefs === "object")
      ? collectionsMap.srv_sort_prefs
      : {};
    _serverCollections.srv_sort_prefs = { ...sortObj };
    _removeStorageKeysByPrefix("srvSortMode_");
    _removeStorageKeysByPrefix("srvSortDir_");
    try {
      for (const [k, v] of Object.entries(sortObj)) {
        if (v !== null && v !== undefined) localStorage.setItem(k, String(v));
      }
    } catch (_) {}
  }
  if (typeof window !== "undefined" && typeof window.__proxdmrApplyBannerCollections === "function") {
    try {
      window.__proxdmrApplyBannerCollections(_serverCollections.pinned_servers || {}, _serverCollections.srv_sort_prefs || {});
    } catch (_) {}
  }
}

export function getServerCollectionValue(category, key) {
  const catMap = _serverCollections[category];
  if (catMap && Object.prototype.hasOwnProperty.call(catMap, key)) {
    return catMap[key];
  }
  return undefined;
}

export function hasServerCollectionKey(category, key) {
  const catMap = _serverCollections[category];
  return Boolean(catMap && Object.prototype.hasOwnProperty.call(catMap, key));
}

export function setServerCollectionKey(category, key, value, mirrorPrefix = null, asJson = true) {
  if (!category || !key) return;
  if (!_serverCollections[category] || typeof _serverCollections[category] !== "object") {
    _serverCollections[category] = {};
  }
  _serverCollections[category][key] = value;
  if (mirrorPrefix) {
    try {
      if (value === null || value === undefined) {
        localStorage.removeItem(mirrorPrefix + key);
      } else {
        localStorage.setItem(mirrorPrefix + key, asJson ? (typeof value === "string" ? value : JSON.stringify(value)) : String(value));
      }
    } catch (_) {}
  }
  if (typeof window !== "undefined" && window.isDemoMode) return;
  try {
    fetch(`/api/collections/${encodeURIComponent(category)}/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ value })
    }).catch(e => console.warn(`[COLLECTIONS] Failed PUT ${category}/${key}:`, e));
  } catch (_) {}
}

export function deleteServerCollectionKey(category, key, mirrorPrefix = null) {
  if (!category || !key) return;
  if (_serverCollections[category]) {
    delete _serverCollections[category][key];
  }
  if (mirrorPrefix) {
    try { localStorage.removeItem(mirrorPrefix + key); } catch (_) {}
  }
  if (typeof window !== "undefined" && window.isDemoMode) return;
  try {
    fetch(`/api/collections/${encodeURIComponent(category)}/${encodeURIComponent(key)}`, {
      method: "DELETE",
      keepalive: true
    }).catch(e => console.warn(`[COLLECTIONS] Failed DELETE ${category}/${key}:`, e));
  } catch (_) {}
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.getClientSettingsSnapshot = getClientSettingsSnapshot;
  window.scheduleSyncClientSettings = scheduleSyncClientSettings;
  window.syncClientSettingsNow = syncClientSettingsNow;
  window.cancelPendingClientSettingsSync = cancelPendingClientSettingsSync;
  window.applyServerClientSettings = applyServerClientSettings;
  window.flushPendingClientSettingsSync = flushPendingClientSettingsSync;
  window.hydrateServerCollections = hydrateServerCollections;
  window.getServerCollectionValue = getServerCollectionValue;
  window.hasServerCollectionKey = hasServerCollectionKey;
  window.setServerCollectionKey = setServerCollectionKey;
  window.deleteServerCollectionKey = deleteServerCollectionKey;

  window.__proxdmr = window.__proxdmr || {};
  Object.assign(window.__proxdmr, {
    getClientSettingsSnapshot,
    scheduleSyncClientSettings,
    syncClientSettingsNow,
    cancelPendingClientSettingsSync,
    applyServerClientSettings,
    flushPendingClientSettingsSync,
    hydrateServerCollections,
    getServerCollectionValue,
    hasServerCollectionKey,
    setServerCollectionKey,
    deleteServerCollectionKey
  });
}
