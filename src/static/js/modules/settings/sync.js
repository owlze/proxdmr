/**
 * ProxDMR - Account Client Settings Sync & Persistence Subsystem
 * Collects client-side preferences (audio RX/TX presets, AGC, vocoder presets,
 * local storage dumps) and syncs them bi-directionally with the backend.
 */

import { resolveHotspotId } from "../network/ping-sparklines.js";
import { updateSlotLangBadge } from "../dmr/transcriber.js";

let clientSettingsSyncTimer = null;

function getWs() {
  return (typeof window !== "undefined" && window.ws) || null;
}

function getAudioPlayer() {
  return (typeof window !== "undefined" && (window.audioPlayer || (window.__proxdmr && window.__proxdmr.audioPlayer))) || null;
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
      "1": JSON.parse(localStorage.getItem("proxdmr_dsdfme_preset_1") || "null"),
      "2": JSON.parse(localStorage.getItem("proxdmr_dsdfme_preset_2") || "null"),
      "3": JSON.parse(localStorage.getItem("proxdmr_dsdfme_preset_3") || "null")
    };
  } catch (_) {}
  try {
    txPresets = {
      "1": JSON.parse(localStorage.getItem("proxdmr_audio_tx_preset_1") || "null"),
      "2": JSON.parse(localStorage.getItem("proxdmr_audio_tx_preset_2") || "null"),
      "3": JSON.parse(localStorage.getItem("proxdmr_audio_tx_preset_3") || "null")
    };
  } catch (_) {}

  const audioRx = {
    pre_gain_db: parseFloat(localStorage.getItem("proxdmr_pre_gain_db") || "0") || 0,
    agc_profile: localStorage.getItem("proxdmr_agc_profile") || "standard",
    agc_max_gain_db: parseFloat(localStorage.getItem("proxdmr_agc_max_gain_db") || "12") || 12,
    agc_min_gain_db: parseFloat(localStorage.getItem("proxdmr_agc_min_gain_db") || "-12") || -12,
    agc_hang_time: parseFloat(localStorage.getItem("proxdmr_agc_hang_time") || "0.35") || 0.35,
    agc_enabled: localStorage.getItem("proxdmr_agc") !== "false",
    eq_low: parseFloat(localStorage.getItem("proxdmr_eq_low") || "0") || 0,
    eq_mid: parseFloat(localStorage.getItem("proxdmr_eq_mid") || "0") || 0,
    eq_high: parseFloat(localStorage.getItem("proxdmr_eq_high") || "0") || 0,
    deemphasis: localStorage.getItem("proxdmr_deemphasis") === "true",
    active_preset: localStorage.getItem("proxdmr_audio_rx_active_preset") || "1",
    presets: rxPresets
  };

    const rawFec = localStorage.getItem("proxdmr_dsdfme_fec_tolerance");
    const parsedFec = rawFec !== null ? parseInt(rawFec, 10) : 1;
    const fecTolerance = isNaN(parsedFec) ? 1 : parsedFec;

    const ambeRx = {
      uvquality: parseInt(localStorage.getItem("proxdmr_dsdfme_uvquality") || "3", 10) || 3,
      spectral_enh: localStorage.getItem("proxdmr_dsdfme_spectral_enh") !== "false",
      float_mode: localStorage.getItem("proxdmr_dsdfme_float_mode") !== "false",
      max_repeats: parseInt(localStorage.getItem("proxdmr_dsdfme_max_repeats") || "3", 10) || 3,
      repeat_decay: (parseInt(localStorage.getItem("proxdmr_dsdfme_repeat_decay") || "75", 10) || 75) / 100.0,
      fec_tolerance: fecTolerance,
      audio_gain: parseFloat(localStorage.getItem("proxdmr_dsdfme_audio_gain") || "7.0") || 7.0,
      active_preset: localStorage.getItem("proxdmr_dsdfme_active_preset") || "1",
      presets: vrxPresets
    };

    const rawPres = localStorage.getItem("proxdmr_tx_presence");
    const parsedPres = rawPres !== null ? parseFloat(rawPres) : 3;
    const presenceBoost = isNaN(parsedPres) ? 3 : parsedPres;

    const audioTx = {
      mic_gain: parseFloat(localStorage.getItem("proxdmr_tx_mic_gain") || "0") || 0,
      noise_suppression: localStorage.getItem("proxdmr_tx_ns") !== "false",
      browser_agc: localStorage.getItem("proxdmr_tx_agc") === "true",
      dsp_agc: localStorage.getItem("proxdmr_tx_dsp_agc") === "true",
      echo_cancellation: localStorage.getItem("proxdmr_tx_aec") !== "false",
      gate_enabled: localStorage.getItem("proxdmr_tx_gate_enabled") !== "false",
      gate_threshold: parseFloat(localStorage.getItem("proxdmr_tx_gate_threshold") || "-45") || -45,
      hpf_enabled: localStorage.getItem("proxdmr_tx_hpf") !== "false",
      presence_boost: presenceBoost,
      active_preset: localStorage.getItem("proxdmr_audio_tx_active_preset") || "1",
      presets: txPresets
    };

  const storageDump = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("proxdmr_") &&
          !k.startsWith("proxdmr_client_ping_") &&
          !k.startsWith("proxdmr_tg_names_") &&
          !k.startsWith("proxdmr_user_callsigns_") &&
          !k.startsWith("proxdmr_collapsed_") &&
          !k.startsWith("proxdmr_gw_disconnected_") &&
          k !== "proxdmr_log_visible" &&
          k !== "proxdmr_log_hotspot") {
        storageDump[k] = localStorage.getItem(k);
      }
    }
  } catch (_) {}

  return {
    audio_rx: audioRx,
    ambe_rx: ambeRx,
    audio_tx: audioTx,
    storage_dump: storageDump
  };
}

/**
 * Debounced push of current client settings to server via WebSocket
 */
export function scheduleSyncClientSettings() {
  if (clientSettingsSyncTimer) clearTimeout(clientSettingsSyncTimer);
  clientSettingsSyncTimer = setTimeout(() => {
    clientSettingsSyncTimer = null;
    const ws = getWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      const snapshot = getClientSettingsSnapshot();
      try {
        ws.send(JSON.stringify({
          type: "save_client_settings",
          client_settings: snapshot
        }));
      } catch (e) {
        console.warn("[SETTINGS] Failed to send client settings:", e);
      }
    }
  }, 400);
}

/**
 * Apply server-sent client settings into localStorage, DOM controls, and audio DSP
 * @param {object} cs
 */
export function applyServerClientSettings(cs) {
  if (!cs || typeof cs !== "object") return;

  // 1. Restore from storage_dump if present (excluding transient UI state)
  if (cs.storage_dump && typeof cs.storage_dump === "object") {
    try {
      for (const [k, v] of Object.entries(cs.storage_dump)) {
        if (k && k.startsWith("proxdmr_") && v !== null && v !== undefined &&
            !k.startsWith("proxdmr_collapsed_") &&
            !k.startsWith("proxdmr_gw_disconnected_") &&
            k !== "proxdmr_log_visible" &&
            k !== "proxdmr_log_hotspot") {
          localStorage.setItem(k, String(v));
        }
      }
    } catch (e) {
      console.warn("[SETTINGS] Error restoring storage_dump:", e);
    }
  }

  const audioPlayer = getAudioPlayer();

  // 2. Restore structured Audio RX
  if (cs.audio_rx && typeof cs.audio_rx === "object") {
    const arx = cs.audio_rx;
    if (arx.pre_gain_db !== undefined) localStorage.setItem("proxdmr_pre_gain_db", arx.pre_gain_db.toString());
    if (arx.agc_profile) localStorage.setItem("proxdmr_agc_profile", arx.agc_profile);
    if (arx.agc_max_gain_db !== undefined) localStorage.setItem("proxdmr_agc_max_gain_db", arx.agc_max_gain_db.toString());
    if (arx.agc_min_gain_db !== undefined) localStorage.setItem("proxdmr_agc_min_gain_db", arx.agc_min_gain_db.toString());
    if (arx.agc_hang_time !== undefined) localStorage.setItem("proxdmr_agc_hang_time", arx.agc_hang_time.toString());
    if (arx.agc_enabled !== undefined) {
      const ab = arx.agc_enabled !== false;
      localStorage.setItem("proxdmr_agc", ab ? "true" : "false");
      localStorage.setItem("proxdmr_agc_default", ab ? "true" : "false");
    }
    if (arx.eq_low !== undefined) localStorage.setItem("proxdmr_eq_low", arx.eq_low.toString());
    if (arx.eq_mid !== undefined) localStorage.setItem("proxdmr_eq_mid", arx.eq_mid.toString());
    if (arx.eq_high !== undefined) localStorage.setItem("proxdmr_eq_high", arx.eq_high.toString());
    if (arx.deemphasis !== undefined) localStorage.setItem("proxdmr_deemphasis", arx.deemphasis ? "true" : "false");
    if (arx.active_preset) localStorage.setItem("proxdmr_audio_rx_active_preset", arx.active_preset.toString());
    if (arx.presets && typeof arx.presets === "object") {
      for (const [pid, pdata] of Object.entries(arx.presets)) {
        if (pdata) localStorage.setItem(`proxdmr_audio_rx_preset_${pid}`, typeof pdata === "string" ? pdata : JSON.stringify(pdata));
      }
    }

    // Sync Audio RX DOM & audioPlayer
    const optPreGain = document.getElementById("optPreGain");
    const optPreGainVal = document.getElementById("optPreGainVal");
    const preGain = parseFloat(localStorage.getItem("proxdmr_pre_gain_db") || "0") || 0;
    if (optPreGain) optPreGain.value = preGain;
    if (optPreGainVal) {
      const isCyr = typeof window !== "undefined" && window.I18N && (window.I18N.currentLang === "ru" || window.I18N.currentLang === "uk");
      const u = isCyr ? "дБ" : "dB";
      optPreGainVal.textContent = preGain > 0 ? `+${preGain} ${u}` : `${preGain} ${u}`;
    }
    if (audioPlayer && audioPlayer.setPreGainDb) {
      audioPlayer.setPreGainDb(preGain);
    }

    const prof = localStorage.getItem("proxdmr_agc_profile") || "standard";
    const boost = parseFloat(localStorage.getItem("proxdmr_agc_max_gain_db") || "12") || 12;
    const atten = parseFloat(localStorage.getItem("proxdmr_agc_min_gain_db") || "-12") || -12;
    const hang = parseFloat(localStorage.getItem("proxdmr_agc_hang_time") || "0.35") || 0.35;
    if (typeof window !== "undefined" && typeof window.updateAgcUI === "function") {
      window.updateAgcUI(prof, boost, atten, hang);
    }

    const eqL = parseFloat(localStorage.getItem("proxdmr_eq_low") || "0") || 0;
    const eqM = parseFloat(localStorage.getItem("proxdmr_eq_mid") || "0") || 0;
    const eqH = parseFloat(localStorage.getItem("proxdmr_eq_high") || "0") || 0;
    const deemph = localStorage.getItem("proxdmr_deemphasis") === "true";
    const sliderEqLow = document.getElementById("sliderEqLow");
    const valEqLow = document.getElementById("valEqLow");
    const sliderEqMid = document.getElementById("sliderEqMid");
    const valEqMid = document.getElementById("valEqMid");
    const sliderEqHigh = document.getElementById("sliderEqHigh");
    const valEqHigh = document.getElementById("valEqHigh");
    const chkDeemphasis = document.getElementById("chkDeemphasis");
    if (sliderEqLow) sliderEqLow.value = eqL;
    if (valEqLow) valEqLow.textContent = eqL > 0 ? `+${eqL} dB` : `${eqL} dB`;
    if (sliderEqMid) sliderEqMid.value = eqM;
    if (valEqMid) valEqMid.textContent = eqM > 0 ? `+${eqM} dB` : `${eqM} dB`;
    if (sliderEqHigh) sliderEqHigh.value = eqH;
    if (valEqHigh) valEqHigh.textContent = eqH > 0 ? `+${eqH} dB` : `${eqH} dB`;
    if (chkDeemphasis) chkDeemphasis.checked = deemph;
    if (audioPlayer && audioPlayer.setEqualizer) {
      audioPlayer.setEqualizer(eqL, eqM, eqH);
    }
    if (audioPlayer && audioPlayer.setDeemphasis) {
      audioPlayer.setDeemphasis(deemph);
    }

    if (typeof window !== "undefined" && typeof window.updateAudioRxPresetUI === "function") {
      window.updateAudioRxPresetUI();
    }
  }

  // 3. Restore structured ambe+ RX (Vocoder)
  if (cs.ambe_rx && typeof cs.ambe_rx === "object") {
    const vrx = cs.ambe_rx;
    if (vrx.uvquality !== undefined) localStorage.setItem("proxdmr_dsdfme_uvquality", vrx.uvquality);
    if (vrx.spectral_enh !== undefined) localStorage.setItem("proxdmr_dsdfme_spectral_enh", vrx.spectral_enh ? "true" : "false");
    if (vrx.float_mode !== undefined) localStorage.setItem("proxdmr_dsdfme_float_mode", vrx.float_mode ? "true" : "false");
    if (vrx.max_repeats !== undefined) localStorage.setItem("proxdmr_dsdfme_max_repeats", vrx.max_repeats);
    if (vrx.repeat_decay !== undefined) {
      const pct = vrx.repeat_decay > 1 ? Math.round(vrx.repeat_decay) : Math.round(vrx.repeat_decay * 100);
      localStorage.setItem("proxdmr_dsdfme_repeat_decay", pct);
    }
    let effFec = vrx.fec_tolerance;
    const activeP = vrx.active_preset ? String(vrx.active_preset) : null;
    if (activeP && vrx.presets && vrx.presets[activeP] && vrx.presets[activeP].fec_tolerance !== undefined) {
      effFec = vrx.presets[activeP].fec_tolerance;
    }
    if (effFec !== undefined) localStorage.setItem("proxdmr_dsdfme_fec_tolerance", effFec);
    if (vrx.audio_gain !== undefined) localStorage.setItem("proxdmr_dsdfme_audio_gain", vrx.audio_gain);
    if (vrx.active_preset) localStorage.setItem("proxdmr_dsdfme_active_preset", vrx.active_preset.toString());
    if (vrx.presets && typeof vrx.presets === "object") {
      for (const [pid, pdata] of Object.entries(vrx.presets)) {
        if (pdata) localStorage.setItem(`proxdmr_dsdfme_preset_${pid}`, typeof pdata === "string" ? pdata : JSON.stringify(pdata));
      }
    }

    if (typeof window !== "undefined" && typeof window.updateVocoderUI === "function") {
      window.updateVocoderUI({
        uvquality: vrx.uvquality,
        spectral_enh: vrx.spectral_enh,
        float_mode: vrx.float_mode,
        max_repeats: vrx.max_repeats,
        repeat_decay: vrx.repeat_decay,
        fec_tolerance: effFec !== undefined ? effFec : vrx.fec_tolerance,
        audio_gain: vrx.audio_gain
      });
    }
    if (typeof window !== "undefined" && typeof window.updateDsdfmePresetUI === "function") {
      window.updateDsdfmePresetUI();
    }
  }

  // 4. Restore structured Audio TX
  if (cs.audio_tx && typeof cs.audio_tx === "object") {
    const atx = cs.audio_tx;
    if (atx.mic_gain !== undefined) localStorage.setItem("proxdmr_tx_mic_gain", atx.mic_gain);
    if (atx.noise_suppression !== undefined) localStorage.setItem("proxdmr_tx_ns", atx.noise_suppression ? "true" : "false");
    if (atx.browser_agc !== undefined) localStorage.setItem("proxdmr_tx_agc", atx.browser_agc ? "true" : "false");
    if (atx.dsp_agc !== undefined) localStorage.setItem("proxdmr_tx_dsp_agc", atx.dsp_agc ? "true" : "false");
    if (atx.echo_cancellation !== undefined) localStorage.setItem("proxdmr_tx_aec", atx.echo_cancellation ? "true" : "false");
    if (atx.gate_enabled !== undefined) localStorage.setItem("proxdmr_tx_gate_enabled", atx.gate_enabled ? "true" : "false");
    if (atx.gate_threshold !== undefined) localStorage.setItem("proxdmr_tx_gate_threshold", atx.gate_threshold);
    if (atx.hpf_enabled !== undefined) localStorage.setItem("proxdmr_tx_hpf", atx.hpf_enabled ? "true" : "false");
    if (atx.presence_boost !== undefined) localStorage.setItem("proxdmr_tx_presence", atx.presence_boost);
    if (atx.active_preset) localStorage.setItem("proxdmr_audio_tx_active_preset", atx.active_preset.toString());
    if (atx.presets && typeof atx.presets === "object") {
      for (const [pid, pdata] of Object.entries(atx.presets)) {
        if (pdata) localStorage.setItem(`proxdmr_audio_tx_preset_${pid}`, typeof pdata === "string" ? pdata : JSON.stringify(pdata));
      }
    }

    // Sync Audio TX DOM
    const sliderTxMicGain = document.getElementById("sliderTxMicGain");
    const chkTxNoiseSuppression = document.getElementById("chkTxNoiseSuppression");
    const chkTxBrowserAgc = document.getElementById("chkTxBrowserAgc");
    const chkTxDspAgc = document.getElementById("chkTxDspAgc");
    const chkTxEchoCancellation = document.getElementById("chkTxEchoCancellation");
    const chkTxGate = document.getElementById("chkTxGate");
    const sliderTxGate = document.getElementById("sliderTxGate");
    const chkTxHpf = document.getElementById("chkTxHpf");
    const sliderTxPresence = document.getElementById("sliderTxPresence");

    if (sliderTxMicGain && atx.mic_gain !== undefined) sliderTxMicGain.value = atx.mic_gain;
    if (chkTxNoiseSuppression && atx.noise_suppression !== undefined) chkTxNoiseSuppression.checked = Boolean(atx.noise_suppression);
    if (chkTxBrowserAgc && atx.browser_agc !== undefined) chkTxBrowserAgc.checked = Boolean(atx.browser_agc);
    if (chkTxDspAgc && atx.dsp_agc !== undefined) chkTxDspAgc.checked = Boolean(atx.dsp_agc);
    if (chkTxEchoCancellation && atx.echo_cancellation !== undefined) chkTxEchoCancellation.checked = Boolean(atx.echo_cancellation);
    if (chkTxGate && atx.gate_enabled !== undefined) chkTxGate.checked = Boolean(atx.gate_enabled);
    if (sliderTxGate && atx.gate_threshold !== undefined) sliderTxGate.value = atx.gate_threshold;
    if (chkTxHpf && atx.hpf_enabled !== undefined) chkTxHpf.checked = Boolean(atx.hpf_enabled);
    if (sliderTxPresence && atx.presence_boost !== undefined) sliderTxPresence.value = atx.presence_boost;

    if (typeof window !== "undefined" && typeof window.updateTxBadges === "function") {
      window.updateTxBadges();
    }
    if (typeof window !== "undefined" && typeof window.applyTxDspSettings === "function") {
      window.applyTxDspSettings();
    }
    if (typeof window !== "undefined" && typeof window.updateAudioTxPresetUI === "function") {
      window.updateAudioTxPresetUI();
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

  // Update transcribe badges if rows exist
  document.querySelectorAll(".vfo-row").forEach(row => {
    const card = row.closest(".radio-container");
    if (!card) return;
    const cid = resolveHotspotId(card.dataset.hotspotId);
    const slot = row.classList.contains("vfo-ts1-row") ? 1 : 2;
    const isTranscribeActive = localStorage.getItem(`proxdmr_transcribe_${cid}_ts${slot}`) === "1" ||
      (cid === "default" && localStorage.getItem(`proxdmr_transcribe_ts${slot}`) === "1");
    row.classList.toggle("has-transcribe", isTranscribeActive);
    if (typeof updateSlotLangBadge === "function") {
      updateSlotLangBadge(row, slot, isTranscribeActive);
    }
  });
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.getClientSettingsSnapshot = getClientSettingsSnapshot;
  window.scheduleSyncClientSettings = scheduleSyncClientSettings;
  window.applyServerClientSettings = applyServerClientSettings;

  window.__proxdmr = window.__proxdmr || {};
  Object.assign(window.__proxdmr, {
    getClientSettingsSnapshot,
    scheduleSyncClientSettings,
    applyServerClientSettings
  });
}
