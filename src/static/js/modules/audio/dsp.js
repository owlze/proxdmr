/**
 * ProxDMR - Audio DSP, Equalizers, AGC, RX/TX Modals & Smooth VU Meter Engine
 * Module: modules/audio/dsp.js
 */

import { getHotspotSlot as _getHotspotSlot } from '../core/state.js';
import { pushNavState as _pushNavState, notifyNavClosed as _notifyNavClosed, scheduleSyncClientSettings as _scheduleSyncClientSettings } from '../core/state.js';

  // --- Audio Settings & DSP Modal Handler (RX / TX) ---
  // --- Audio RX Modal & DSP ---
  let _rxModalSetup = false;
  function setupAudioRxModal() {
    if (_rxModalSetup) return;
    _rxModalSetup = true;
    const audioRxModal = document.getElementById("audioRxModal");
    const closeBtn = document.getElementById("closeAudioRxBtn");
    const closeBottomBtn = document.getElementById("btnCloseAudioRxBottom");
    const resetDefaultsBtn = document.getElementById("btnResetAudioRxDefaults");
    const resetEqBtn = document.getElementById("btnResetEqOnly");

    // Pre-Gain controls
    const optPreGain = document.getElementById("optPreGain");
    const optPreGainVal = document.getElementById("optPreGainVal");

    // AGC controls
    const agcProfileBtns = document.querySelectorAll(".btn-agc-profile");
    const badgeAgcProfile = document.getElementById("badgeAgcProfile");
    const sliderAgcBoost = document.getElementById("sliderAgcBoost");
    const valAgcBoost = document.getElementById("valAgcBoost");
    const sliderAgcAtten = document.getElementById("sliderAgcAtten");
    const valAgcAtten = document.getElementById("valAgcAtten");
    const sliderAgcHang = document.getElementById("sliderAgcHang");
    const valAgcHang = document.getElementById("valAgcHang");

    // Equalizer controls
    const sliderEqLow = document.getElementById("sliderEqLow");
    const valEqLow = document.getElementById("valEqLow");
    const sliderEqMid = document.getElementById("sliderEqMid");
    const valEqMid = document.getElementById("valEqMid");
    const sliderEqHigh = document.getElementById("sliderEqHigh");
    const valEqHigh = document.getElementById("valEqHigh");
    const chkDeemphasis = document.getElementById("chkDeemphasis");

    function formatDb(val) {
      const v = Math.round(val);
      return v > 0 ? `+${v} dB` : `${v} dB`;
    }

    function openModal() {
      if (audioRxModal) {
        audioRxModal.classList.add("active");
        _pushNavState("modal", "audioRxModal");
      }
    }

    function closeModal() {
      if (audioRxModal && audioRxModal.classList.contains("active")) {
        audioRxModal.classList.remove("active");
        _notifyNavClosed();
      }
    }

    document.addEventListener("click", (e) => {
      const trigger = e.target.closest(".btn-audio-rx-trigger") || (e.target.id === "btnAudioRxMain" ? e.target : null);
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        openModal();
      }
    });

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (closeBottomBtn) closeBottomBtn.addEventListener("click", closeModal);
    if (audioRxModal) {
      audioRxModal.addEventListener("click", (e) => {
        if (e.target === audioRxModal) closeModal();
      });
    }

    // 1. Pre-Gain Setup
    if (optPreGain) {
      const savedPreGain = localStorage.getItem("proxdmr_pre_gain_db");
      const preGainNum = savedPreGain !== null ? Math.max(-20, Math.min(12, Math.round(parseFloat(savedPreGain) || 0))) : 0;
      optPreGain.value = preGainNum;

      const formatPreGainBadge = (val) => {
        const rounded = Math.round(val);
        const isCyrillic = window.I18N && (window.I18N.currentLang === "ru" || window.I18N.currentLang === "uk");
        const unit = isCyrillic ? "дБ" : "dB";
        return rounded > 0 ? `+${rounded} ${unit}` : `${rounded} ${unit}`;
      };

      if (optPreGainVal) optPreGainVal.textContent = formatPreGainBadge(preGainNum);
      if (window.audioPlayer && window.audioPlayer.setPreGainDb) {
        window.audioPlayer.setPreGainDb(preGainNum);
      }

      const onPreGainInput = () => {
        const val = Math.max(-20, Math.min(12, Math.round(parseFloat(optPreGain.value) || 0)));
        if (optPreGainVal) optPreGainVal.textContent = formatPreGainBadge(val);
        localStorage.setItem("proxdmr_pre_gain_db", val.toString());
        if (window.audioPlayer && window.audioPlayer.setPreGainDb) {
          window.audioPlayer.setPreGainDb(val);
        }
        _scheduleSyncClientSettings();
      };

      optPreGain.addEventListener("input", onPreGainInput);
      optPreGain.addEventListener("change", onPreGainInput);
    }

    // 2. AGC Controls Setup
    function getAgcProfileTitles() {
      return {
        soft: window.t ? window.t("audio.agc_soft", {}, "Мягкая (±8 dB)") : "Мягкая (±8 dB)",
        standard: window.t ? window.t("audio.agc_standard", {}, "Стандартная (±12 dB)") : "Стандартная (±12 dB)",
        deep: window.t ? window.t("audio.agc_deep", {}, "Глубокая ⭐ (вытягивание тихих)") : "Глубокая ⭐ (вытягивание тихих)",
        max: window.t ? window.t("audio.agc_max", {}, "Максимальная (+22/-24 dB)") : "Максимальная (+22/-24 dB)"
      };
    }

    function updateAgcUI(profile, boost, atten, hang) {
      agcProfileBtns.forEach(btn => {
        const p = btn.getAttribute("data-profile");
        btn.classList.toggle("active", p === profile);
      });
      if (badgeAgcProfile) {
        badgeAgcProfile.textContent = getAgcProfileTitles()[profile] || (window.t ? window.t("audio.agc_custom", {}, "Пользовательская") : "Пользовательская");
      }
      if (sliderAgcBoost && boost !== undefined) {
        sliderAgcBoost.value = Math.round(boost);
        if (valAgcBoost) valAgcBoost.textContent = `+${Math.round(boost)} dB`;
      }
      if (sliderAgcAtten && atten !== undefined) {
        sliderAgcAtten.value = Math.abs(Math.round(atten));
        if (valAgcAtten) valAgcAtten.textContent = `-${Math.abs(Math.round(atten))} dB`;
      }
      if (sliderAgcHang && hang !== undefined) {
        sliderAgcHang.value = Math.round(hang * 1000);
        if (valAgcHang) valAgcHang.textContent = `${Math.round(hang * 1000)} ms`;
      }
    }
    window.updateAgcUI = updateAgcUI;

    let currentProfile = localStorage.getItem("proxdmr_agc_profile") || "standard";
    const initBoost = parseFloat(localStorage.getItem("proxdmr_agc_max_gain_db") || "12") || 12;
    const initAtten = parseFloat(localStorage.getItem("proxdmr_agc_min_gain_db") || "-12") || -12;
    const initHang = parseFloat(localStorage.getItem("proxdmr_agc_hang_time") || "0.35") || 0.35;

    updateAgcUI(currentProfile, initBoost, initAtten, initHang);
    // Send initial AGC profile to backend
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
      window.ws.send(JSON.stringify({ type: "set_agc_profile", profile: currentProfile }));
    }

    const AGC_PRESETS = {
      soft: { boost: 8, atten: -8, hang: 0.30 },
      standard: { boost: 12, atten: -12, hang: 0.35 },
      deep: { boost: 18, atten: -18, hang: 0.40 },
      max: { boost: 22, atten: -24, hang: 0.45 }
    };

    agcProfileBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const prof = btn.getAttribute("data-profile");
        currentProfile = prof;
        localStorage.setItem("proxdmr_agc_profile", prof);
        const pValues = AGC_PRESETS[prof] || AGC_PRESETS.standard;
        updateAgcUI(prof, pValues.boost, pValues.atten, pValues.hang);
        localStorage.setItem("proxdmr_agc_max_gain_db", pValues.boost.toString());
        localStorage.setItem("proxdmr_agc_min_gain_db", pValues.atten.toString());
        localStorage.setItem("proxdmr_agc_hang_time", pValues.hang.toString());
        if (window.ws && window.ws.readyState === WebSocket.OPEN) {
          window.ws.send(JSON.stringify({ type: "set_agc_profile", profile: prof }));
        }
        _scheduleSyncClientSettings();
      });
    });

    function onAgcSliderChange() {
      const boost = parseFloat(sliderAgcBoost ? sliderAgcBoost.value : "12") || 12;
      const atten = -(parseFloat(sliderAgcAtten ? sliderAgcAtten.value : "12") || 12);
      const hang = (parseFloat(sliderAgcHang ? sliderAgcHang.value : "350") || 350) / 1000.0;

      if (valAgcBoost) valAgcBoost.textContent = `+${Math.round(boost)} dB`;
      if (valAgcAtten) valAgcAtten.textContent = `${Math.round(atten)} dB`;
      if (valAgcHang) valAgcHang.textContent = `${Math.round(hang * 1000)} ms`;

      // Send custom AGC params to backend
      if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
          type: "set_agc_params",
          min_gain_db: atten,
          max_gain_db: boost,
          hang_time: hang
        }));
      }

      if (boost === 8 && atten === -8) currentProfile = "soft";
      else if (boost === 12 && atten === -12) currentProfile = "standard";
      else if (boost === 18 && atten === -18) currentProfile = "deep";
      else if (boost === 22 && atten === -24) currentProfile = "max";
      else currentProfile = "custom";

      localStorage.setItem("proxdmr_agc_max_gain_db", boost.toString());
      localStorage.setItem("proxdmr_agc_min_gain_db", atten.toString());
      localStorage.setItem("proxdmr_agc_hang_time", hang.toString());
      localStorage.setItem("proxdmr_agc_profile", currentProfile);

      agcProfileBtns.forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-profile") === currentProfile);
      });
      if (badgeAgcProfile) {
        const titles = getAgcProfileTitles();
        badgeAgcProfile.textContent = titles[currentProfile] || (window.t ? window.t("audio.agc_custom", {}, "Пользовательская") : "Пользовательская");
      }
      _scheduleSyncClientSettings();
    }

    if (sliderAgcBoost) {
      sliderAgcBoost.addEventListener("input", onAgcSliderChange);
      sliderAgcBoost.addEventListener("change", onAgcSliderChange);
    }
    if (sliderAgcAtten) {
      sliderAgcAtten.addEventListener("input", onAgcSliderChange);
      sliderAgcAtten.addEventListener("change", onAgcSliderChange);
    }
    if (sliderAgcHang) {
      sliderAgcHang.addEventListener("input", onAgcSliderChange);
      sliderAgcHang.addEventListener("change", onAgcSliderChange);
    }

    // 3. Equalizer Setup
    if (window.audioPlayer && window.audioPlayer.getEqualizer) {
      const eq = window.audioPlayer.getEqualizer();
      if (sliderEqLow) {
        sliderEqLow.value = eq.low;
        if (valEqLow) valEqLow.textContent = formatDb(eq.low);
      }
      if (sliderEqMid) {
        sliderEqMid.value = eq.mid;
        if (valEqMid) valEqMid.textContent = formatDb(eq.mid);
      }
      if (sliderEqHigh) {
        sliderEqHigh.value = eq.high;
        if (valEqHigh) valEqHigh.textContent = formatDb(eq.high);
      }
      if (chkDeemphasis) {
        chkDeemphasis.checked = Boolean(eq.deemphasis);
      }
    }

    function applyEq() {
      const low = parseFloat(sliderEqLow ? sliderEqLow.value : "0") || 0;
      const mid = parseFloat(sliderEqMid ? sliderEqMid.value : "0") || 0;
      const high = parseFloat(sliderEqHigh ? sliderEqHigh.value : "0") || 0;
      const deemph = chkDeemphasis ? chkDeemphasis.checked : false;

      if (valEqLow) valEqLow.textContent = formatDb(low);
      if (valEqMid) valEqMid.textContent = formatDb(mid);
      if (valEqHigh) valEqHigh.textContent = formatDb(high);

      localStorage.setItem("proxdmr_eq_low", low.toString());
      localStorage.setItem("proxdmr_eq_mid", mid.toString());
      localStorage.setItem("proxdmr_eq_high", high.toString());
      localStorage.setItem("proxdmr_deemphasis", deemph ? "true" : "false");

      if (window.audioPlayer && window.audioPlayer.setEqualizer) {
        window.audioPlayer.setEqualizer(low, mid, high);
      }
      if (window.audioPlayer && window.audioPlayer.setDeemphasis) {
        window.audioPlayer.setDeemphasis(deemph);
      }
      _scheduleSyncClientSettings();
    }

    if (sliderEqLow) sliderEqLow.addEventListener("input", applyEq);
    if (sliderEqMid) sliderEqMid.addEventListener("input", applyEq);
    if (sliderEqHigh) sliderEqHigh.addEventListener("input", applyEq);
    if (chkDeemphasis) chkDeemphasis.addEventListener("change", applyEq);

    if (resetEqBtn) {
      resetEqBtn.addEventListener("click", () => {
        if (sliderEqLow) sliderEqLow.value = 0;
        if (sliderEqMid) sliderEqMid.value = 0;
        if (sliderEqHigh) sliderEqHigh.value = 0;
        if (chkDeemphasis) chkDeemphasis.checked = false;
        applyEq();
      });
    }

    // 3.5. Jitter Buffer Controls
    const sliderJitterBuffer = document.getElementById("sliderJitterBuffer");
    const valJitterBuffer = document.getElementById("valJitterBuffer");
    const jitterPresetBtns = document.querySelectorAll(".btn-jitter-preset");

    function updateJitterUI(ms) {
      const val = Math.max(40, Math.min(500, parseInt(ms, 10) || 120));
      if (sliderJitterBuffer) sliderJitterBuffer.value = val;
      if (valJitterBuffer) valJitterBuffer.textContent = `${val} ms`;
      jitterPresetBtns.forEach(btn => {
        const j = parseInt(btn.getAttribute("data-jitter"), 10);
        btn.classList.toggle("active", j === val);
      });
      localStorage.setItem("proxdmr_jitter_buffer_ms", val.toString());
      if (window.audioPlayer && typeof window.audioPlayer.setJitterBufferMs === "function") {
        window.audioPlayer.setJitterBufferMs(val);
      }
    }

    if (sliderJitterBuffer) {
      const savedJitter = localStorage.getItem("proxdmr_jitter_buffer_ms");
      const initVal = savedJitter !== null ? parseInt(savedJitter, 10) || 120 : 120;
      updateJitterUI(initVal);

      sliderJitterBuffer.addEventListener("input", () => {
        updateJitterUI(sliderJitterBuffer.value);
      });
      sliderJitterBuffer.addEventListener("change", () => {
        updateJitterUI(sliderJitterBuffer.value);
        _scheduleSyncClientSettings();
      });
    }

    jitterPresetBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const j = parseInt(btn.getAttribute("data-jitter"), 10);
        if (j) {
          updateJitterUI(j);
          _scheduleSyncClientSettings();
        }
      });
    });

    // 4. Audio RX 3-Preset System (P1 - P3)
    const audioRxPresetButtons = document.querySelectorAll(".btn-audio-rx-preset");
    const saveAudioRxPresetBtn = document.getElementById("btnSaveAudioRxPreset");
    const saveAudioRxPresetText = document.getElementById("saveAudioRxPresetText");

    const defaultAudioRxPresets = {
      "1": {
        name: "Стандарт",
        preGain: 0,
        agcProfile: "standard",
        agcBoost: 12,
        agcAtten: -12,
        agcHang: 0.35,
        eqLow: 0,
        eqMid: 0,
        eqHigh: 0,
        deemphasis: false,
        jitterBuffer: 120
      },
      "2": {
        name: "Мягкий эфир",
        preGain: 2,
        agcProfile: "soft",
        agcBoost: 8,
        agcAtten: -8,
        agcHang: 0.30,
        eqLow: 2,
        eqMid: 0,
        eqHigh: -3,
        deemphasis: true,
        jitterBuffer: 140
      },
      "3": {
        name: "Разборчивость",
        preGain: 4,
        agcProfile: "deep",
        agcBoost: 18,
        agcAtten: -18,
        agcHang: 0.40,
        eqLow: -4,
        eqMid: 4,
        eqHigh: 2,
        deemphasis: false,
        jitterBuffer: 120
      }
    };

    let activeAudioRxPresetId = localStorage.getItem("proxdmr_audio_rx_active_preset") || 
                                localStorage.getItem("proxdmr_audio_active_preset") || "1";
    if (activeAudioRxPresetId === "4" || !defaultAudioRxPresets[activeAudioRxPresetId]) activeAudioRxPresetId = "1";

    function getAudioRxPresetData(id) {
      const stored = localStorage.getItem(`proxdmr_audio_rx_preset_${id}`) ||
                     localStorage.getItem(`proxdmr_audio_preset_${id}`);
      if (stored) {
        try {
          return Object.assign({}, defaultAudioRxPresets[id] || defaultAudioRxPresets["1"], JSON.parse(stored));
        } catch (e) {
          console.warn("Failed to parse Audio RX preset", id, e);
        }
      }
      return defaultAudioRxPresets[id] || defaultAudioRxPresets["1"];
    }

    function applyAudioRxPreset(id) {
      activeAudioRxPresetId = String(id);
      if (activeAudioRxPresetId === "4" || !defaultAudioRxPresets[activeAudioRxPresetId]) activeAudioRxPresetId = "1";
      localStorage.setItem("proxdmr_audio_rx_active_preset", activeAudioRxPresetId);
      const data = getAudioRxPresetData(activeAudioRxPresetId);

      const pGain = data.preGain !== undefined ? data.preGain : 0;
      if (optPreGain) {
        optPreGain.value = pGain;
        if (optPreGainVal) {
          const isCyrillic = window.I18N && (window.I18N.currentLang === "ru" || window.I18N.currentLang === "uk");
          const unit = isCyrillic ? "дБ" : "dB";
          optPreGainVal.textContent = pGain > 0 ? `+${pGain} ${unit}` : `${pGain} ${unit}`;
        }
      }
      localStorage.setItem("proxdmr_pre_gain_db", pGain.toString());
      if (window.audioPlayer && window.audioPlayer.setPreGainDb) {
        window.audioPlayer.setPreGainDb(pGain);
      }

      currentProfile = data.agcProfile || "standard";
      const boost = data.agcBoost !== undefined ? data.agcBoost : 12;
      const atten = data.agcAtten !== undefined ? data.agcAtten : -12;
      const hang = data.agcHang !== undefined ? data.agcHang : 0.35;

      updateAgcUI(currentProfile, boost, atten, hang);
      // Send AGC preset to backend
      if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
          type: "set_agc_params",
          min_gain_db: atten,
          max_gain_db: boost,
          hang_time: hang
        }));
      }
      localStorage.setItem("proxdmr_agc_profile", currentProfile);
      localStorage.setItem("proxdmr_agc_max_gain_db", boost.toString());
      localStorage.setItem("proxdmr_agc_min_gain_db", atten.toString());
      localStorage.setItem("proxdmr_agc_hang_time", hang.toString());

      const eqLow = data.eqLow !== undefined ? data.eqLow : 0;
      const eqMid = data.eqMid !== undefined ? data.eqMid : 0;
      const eqHigh = data.eqHigh !== undefined ? data.eqHigh : 0;
      const deemph = Boolean(data.deemphasis);

      if (sliderEqLow) sliderEqLow.value = eqLow;
      if (sliderEqMid) sliderEqMid.value = eqMid;
      if (sliderEqHigh) sliderEqHigh.value = eqHigh;
      if (chkDeemphasis) chkDeemphasis.checked = deemph;
      applyEq();

      if (data.jitterBuffer !== undefined && typeof updateJitterUI === "function") {
        updateJitterUI(data.jitterBuffer);
      }

      updateAudioRxPresetUI();
      _scheduleSyncClientSettings();
    }

    function saveCurrentToAudioRxPreset(id) {
      const pGain = optPreGain ? (Math.round(parseFloat(optPreGain.value)) || 0) : 0;
      const boost = sliderAgcBoost ? (Math.round(parseFloat(sliderAgcBoost.value)) || 12) : 12;
      const atten = sliderAgcAtten ? (-(Math.round(parseFloat(sliderAgcAtten.value)) || 12)) : -12;
      const hang = sliderAgcHang ? ((parseFloat(sliderAgcHang.value) || 350) / 1000.0) : 0.35;
      const eqLow = sliderEqLow ? (parseFloat(sliderEqLow.value) || 0) : 0;
      const eqMid = sliderEqMid ? (parseFloat(sliderEqMid.value) || 0) : 0;
      const eqHigh = sliderEqHigh ? (parseFloat(sliderEqHigh.value) || 0) : 0;
      const deemph = chkDeemphasis ? chkDeemphasis.checked : false;
      const jBuf = sliderJitterBuffer ? (parseInt(sliderJitterBuffer.value, 10) || 120) : 120;

      const currentData = {
        preGain: pGain,
        agcProfile: currentProfile,
        agcBoost: boost,
        agcAtten: atten,
        agcHang: hang,
        eqLow: eqLow,
        eqMid: eqMid,
        eqHigh: eqHigh,
        deemphasis: deemph,
        jitterBuffer: jBuf
      };

      localStorage.setItem(`proxdmr_audio_rx_preset_${id}`, JSON.stringify(currentData));
      _scheduleSyncClientSettings();

      if (saveAudioRxPresetBtn) {
        saveAudioRxPresetBtn.classList.add("saved-flash");
        if (saveAudioRxPresetText) {
          saveAudioRxPresetText.textContent = window.t ? window.t("audio_rx.btn_saved_text", { id }) : `✓ Сохранено в P${id}`;
        }
        setTimeout(() => {
          saveAudioRxPresetBtn.classList.remove("saved-flash");
          if (saveAudioRxPresetText) {
            saveAudioRxPresetText.textContent = window.t ? window.t("audio_rx.btn_save_text", { id: activeAudioRxPresetId }) : `Сохранить в P${activeAudioRxPresetId}`;
          }
        }, 1400);
      }
    }

    function updateAudioRxPresetUI() {
      audioRxPresetButtons.forEach(btn => {
        const pId = btn.getAttribute("data-audio-rx-preset");
        btn.classList.toggle("active", pId === activeAudioRxPresetId);
      });
      document.querySelectorAll(".btn-audio-rx-mini-preset .mini-preset-label").forEach(lbl => {
        lbl.textContent = `P${activeAudioRxPresetId}`;
      });
      document.querySelectorAll(".audio-rx-menu .mini-preset-item").forEach(item => {
        const pId = item.getAttribute("data-audio-rx-preset");
        item.classList.toggle("active", pId === activeAudioRxPresetId);
      });
      if (saveAudioRxPresetText) {
        saveAudioRxPresetText.textContent = window.t ? window.t("audio_rx.btn_save_text", { id: activeAudioRxPresetId }) : `Сохранить в P${activeAudioRxPresetId}`;
      }
      if (saveAudioRxPresetBtn) {
        saveAudioRxPresetBtn.title = window.t ? window.t("audio_rx.btn_save_title", { id: activeAudioRxPresetId }) : `Сохранить текущие параметры звука в пресет ${activeAudioRxPresetId}`;
      }
    }

    audioRxPresetButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-audio-rx-preset");
        if (id) applyAudioRxPreset(id);
      });
    });

    if (saveAudioRxPresetBtn) {
      saveAudioRxPresetBtn.addEventListener("click", () => {
        saveCurrentToAudioRxPreset(activeAudioRxPresetId);
      });
    }

    window.addEventListener("languageChanged", updateAudioRxPresetUI);
    window.applyAudioRxPreset = applyAudioRxPreset;
    window.updateAudioRxPresetUI = updateAudioRxPresetUI;

    // Do NOT overwrite user manual adjustments with preset on startup!
    updateAudioRxPresetUI();

    if (resetDefaultsBtn) {
      resetDefaultsBtn.addEventListener("click", () => {
        applyAudioRxPreset("1");
      });
    }
  }

  // --- Audio TX Modal & DSP ---
  let _txModalSetup = false;
  function setupAudioTxModal() {
    if (_txModalSetup) return;
    _txModalSetup = true;
    const audioTxModal = document.getElementById("audioTxModal");
    const closeBtn = document.getElementById("closeAudioTxBtn");
    const closeBottomBtn = document.getElementById("btnCloseAudioTxBottom");
    const resetDefaultsBtn = document.getElementById("btnResetAudioTxDefaults");

    const sliderTxMicGain = document.getElementById("sliderTxMicGain");
    const valTxMicGain = document.getElementById("valTxMicGain");
    const chkTxNoiseSuppression = document.getElementById("chkTxNoiseSuppression");
    const chkTxBrowserAgc = document.getElementById("chkTxBrowserAgc");
    const chkTxDspAgc = document.getElementById("chkTxDspAgc");
    const chkTxEchoCancellation = document.getElementById("chkTxEchoCancellation");
    const chkTxGate = document.getElementById("chkTxGate");
    const sliderTxGate = document.getElementById("sliderTxGate");
    const valTxGate = document.getElementById("valTxGate");
    const chkTxHpf = document.getElementById("chkTxHpf");
    const sliderTxPresence = document.getElementById("sliderTxPresence");
    const valTxPresence = document.getElementById("valTxPresence");

    function openModal() {
      if (audioTxModal) {
        audioTxModal.classList.add("active");
        _pushNavState("modal", "audioTxModal");
      }
    }

    function closeModal() {
      if (audioTxModal && audioTxModal.classList.contains("active")) {
        audioTxModal.classList.remove("active");
        _notifyNavClosed();
      }
    }

    document.addEventListener("click", (e) => {
      const trigger = e.target.closest(".btn-audio-tx-trigger") || (e.target.id === "btnAudioTxMain" ? e.target : null);
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        openModal();
      }
    });

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (closeBottomBtn) closeBottomBtn.addEventListener("click", closeModal);
    if (audioTxModal) {
      audioTxModal.addEventListener("click", (e) => {
        if (e.target === audioTxModal) closeModal();
      });
    }

    function updateTxBadges() {
      const isCyr = window.I18N && (window.I18N.currentLang === "ru" || window.I18N.currentLang === "uk");
      const u = isCyr ? "дБ" : "dB";
      if (sliderTxMicGain && valTxMicGain) {
        const v = Math.round(parseFloat(sliderTxMicGain.value) || 0);
        valTxMicGain.textContent = v > 0 ? `+${v} ${u}` : `${v} ${u}`;
      }
      if (sliderTxGate && valTxGate) {
        const v = Math.round(parseFloat(sliderTxGate.value) || -45);
        valTxGate.textContent = `${v} ${u}`;
      }
      if (sliderTxPresence && valTxPresence) {
        const v = Math.round(parseFloat(sliderTxPresence.value) || 0);
        valTxPresence.textContent = v > 0 ? `+${v} ${u}` : `0 ${u}`;
      }
    }

    function saveTxSettingsToStorage() {
      if (sliderTxMicGain) localStorage.setItem("proxdmr_tx_mic_gain", sliderTxMicGain.value);
      if (chkTxNoiseSuppression) localStorage.setItem("proxdmr_tx_ns", chkTxNoiseSuppression.checked.toString());
      if (chkTxBrowserAgc) localStorage.setItem("proxdmr_tx_agc", chkTxBrowserAgc.checked.toString());
      if (chkTxDspAgc) localStorage.setItem("proxdmr_tx_dsp_agc", chkTxDspAgc.checked.toString());
      if (chkTxEchoCancellation) localStorage.setItem("proxdmr_tx_aec", chkTxEchoCancellation.checked.toString());
      if (chkTxGate) localStorage.setItem("proxdmr_tx_gate_enabled", chkTxGate.checked.toString());
      if (sliderTxGate) localStorage.setItem("proxdmr_tx_gate_threshold", sliderTxGate.value);
      if (chkTxHpf) localStorage.setItem("proxdmr_tx_hpf", chkTxHpf.checked.toString());
      if (sliderTxPresence) localStorage.setItem("proxdmr_tx_presence", sliderTxPresence.value);
      _scheduleSyncClientSettings();
    }

    const onTxControlChange = () => {
      updateTxBadges();
      saveTxSettingsToStorage();
      applyTxDspSettings();
    };

    if (sliderTxMicGain) {
      sliderTxMicGain.addEventListener("input", onTxControlChange);
      sliderTxMicGain.addEventListener("change", onTxControlChange);
    }
    if (chkTxNoiseSuppression) {
      chkTxNoiseSuppression.addEventListener("change", () => {
        saveTxSettingsToStorage();
        updateMicTrackConstraints();
      });
    }
    if (chkTxBrowserAgc) {
      chkTxBrowserAgc.addEventListener("change", () => {
        saveTxSettingsToStorage();
        updateMicTrackConstraints();
      });
    }
    if (chkTxDspAgc) {
      chkTxDspAgc.addEventListener("change", onTxControlChange);
    }
    if (chkTxEchoCancellation) {
      chkTxEchoCancellation.addEventListener("change", () => {
        saveTxSettingsToStorage();
        updateMicTrackConstraints();
      });
    }
    if (chkTxGate) {
      chkTxGate.addEventListener("change", onTxControlChange);
    }
    if (sliderTxGate) {
      sliderTxGate.addEventListener("input", onTxControlChange);
      sliderTxGate.addEventListener("change", onTxControlChange);
    }
    if (chkTxHpf) {
      chkTxHpf.addEventListener("change", onTxControlChange);
    }
    if (sliderTxPresence) {
      sliderTxPresence.addEventListener("input", onTxControlChange);
      sliderTxPresence.addEventListener("change", onTxControlChange);
    }

    const audioTxPresetButtons = document.querySelectorAll(".btn-audio-tx-preset");
    const saveAudioTxPresetBtn = document.getElementById("btnSaveAudioTxPreset");
    const saveAudioTxPresetText = document.getElementById("saveAudioTxPresetText");

    const defaultAudioTxPresets = {
      "1": {
        name: "Стандарт",
        txMicGain: 0,
        txNoiseSuppression: true,
        txBrowserAgc: false,
        txDspAgc: false,
        txEchoCancellation: true,
        txGateEnabled: true,
        txGateThreshold: -45,
        txHpfEnabled: true,
        txPresenceBoost: 3
      },
      "2": {
        name: "Мягкий голос",
        txMicGain: 2,
        txNoiseSuppression: true,
        txBrowserAgc: false,
        txDspAgc: false,
        txEchoCancellation: true,
        txGateEnabled: false,
        txGateThreshold: -45,
        txHpfEnabled: false,
        txPresenceBoost: 0
      },
      "3": {
        name: "Пробивной / DX",
        txMicGain: 3,
        txNoiseSuppression: true,
        txBrowserAgc: false,
        txDspAgc: false,
        txEchoCancellation: true,
        txGateEnabled: true,
        txGateThreshold: -40,
        txHpfEnabled: true,
        txPresenceBoost: 6
      }
    };

    let activeAudioTxPresetId = localStorage.getItem("proxdmr_audio_tx_active_preset") || "1";
    if (!defaultAudioTxPresets[activeAudioTxPresetId]) activeAudioTxPresetId = "1";

    function getAudioTxPresetData(id) {
      const stored = localStorage.getItem(`proxdmr_audio_tx_preset_${id}`);
      if (stored) {
        try {
          return Object.assign({}, defaultAudioTxPresets[id] || defaultAudioTxPresets["1"], JSON.parse(stored));
        } catch (e) {
          console.warn("Failed to parse Audio TX preset", id, e);
        }
      }
      return defaultAudioTxPresets[id] || defaultAudioTxPresets["1"];
    }

    function applyAudioTxPreset(id) {
      activeAudioTxPresetId = String(id);
      if (!defaultAudioTxPresets[activeAudioTxPresetId]) activeAudioTxPresetId = "1";
      localStorage.setItem("proxdmr_audio_tx_active_preset", activeAudioTxPresetId);
      const data = getAudioTxPresetData(activeAudioTxPresetId);

      const txMicGain = data.txMicGain !== undefined ? data.txMicGain : 0;
      const txNs = data.txNoiseSuppression !== undefined ? Boolean(data.txNoiseSuppression) : true;
      const txAgc = data.txBrowserAgc !== undefined ? Boolean(data.txBrowserAgc) : false;
      const txDspAgcVal = data.txDspAgc !== undefined ? Boolean(data.txDspAgc) : false;
      const txAec = data.txEchoCancellation !== undefined ? Boolean(data.txEchoCancellation) : true;
      const txGate = data.txGateEnabled !== undefined ? Boolean(data.txGateEnabled) : true;
      const txGateThr = data.txGateThreshold !== undefined ? data.txGateThreshold : -45;
      const txHpf = data.txHpfEnabled !== undefined ? Boolean(data.txHpfEnabled) : true;
      const txPres = data.txPresenceBoost !== undefined ? data.txPresenceBoost : 3;

      if (sliderTxMicGain) sliderTxMicGain.value = txMicGain;
      if (chkTxNoiseSuppression) chkTxNoiseSuppression.checked = txNs;
      if (chkTxBrowserAgc) chkTxBrowserAgc.checked = txAgc;
      if (chkTxDspAgc) chkTxDspAgc.checked = txDspAgcVal;
      if (chkTxEchoCancellation) chkTxEchoCancellation.checked = txAec;
      if (chkTxGate) chkTxGate.checked = txGate;
      if (sliderTxGate) sliderTxGate.value = txGateThr;
      if (chkTxHpf) chkTxHpf.checked = txHpf;
      if (sliderTxPresence) sliderTxPresence.value = txPres;

      updateTxBadges();
      saveTxSettingsToStorage();
      applyTxDspSettings();
      updateMicTrackConstraints();

      updateAudioTxPresetUI();
      _scheduleSyncClientSettings();
    }

    function saveCurrentToAudioTxPreset(id) {
      const currentData = {
        txMicGain: sliderTxMicGain ? (parseFloat(sliderTxMicGain.value) || 0) : 0,
        txNoiseSuppression: chkTxNoiseSuppression ? chkTxNoiseSuppression.checked : true,
        txBrowserAgc: chkTxBrowserAgc ? chkTxBrowserAgc.checked : false,
        txDspAgc: chkTxDspAgc ? chkTxDspAgc.checked : false,
        txEchoCancellation: chkTxEchoCancellation ? chkTxEchoCancellation.checked : true,
        txGateEnabled: chkTxGate ? chkTxGate.checked : true,
        txGateThreshold: sliderTxGate ? (parseFloat(sliderTxGate.value) || -45) : -45,
        txHpfEnabled: chkTxHpf ? chkTxHpf.checked : true,
        txPresenceBoost: sliderTxPresence ? (parseFloat(sliderTxPresence.value) || 0) : 0
      };

      localStorage.setItem(`proxdmr_audio_tx_preset_${id}`, JSON.stringify(currentData));
      _scheduleSyncClientSettings();

      if (saveAudioTxPresetBtn) {
        saveAudioTxPresetBtn.classList.add("saved-flash");
        if (saveAudioTxPresetText) {
          saveAudioTxPresetText.textContent = window.t ? window.t("audio_tx.btn_saved_text", { id }) : `✓ Сохранено в P${id}`;
        }
        setTimeout(() => {
          saveAudioTxPresetBtn.classList.remove("saved-flash");
          if (saveAudioTxPresetText) {
            saveAudioTxPresetText.textContent = window.t ? window.t("audio_tx.btn_save_text", { id: activeAudioTxPresetId }) : `Сохранить в P${activeAudioTxPresetId}`;
          }
        }, 1400);
      }
    }

    function updateAudioTxPresetUI() {
      audioTxPresetButtons.forEach(btn => {
        const pId = btn.getAttribute("data-audio-tx-preset");
        btn.classList.toggle("active", pId === activeAudioTxPresetId);
      });
      document.querySelectorAll(".btn-audio-tx-mini-preset .mini-preset-label").forEach(lbl => {
        lbl.textContent = `P${activeAudioTxPresetId}`;
      });
      document.querySelectorAll(".audio-tx-menu .mini-preset-item").forEach(item => {
        const pId = item.getAttribute("data-audio-tx-preset");
        item.classList.toggle("active", pId === activeAudioTxPresetId);
      });
      if (saveAudioTxPresetText) {
        saveAudioTxPresetText.textContent = window.t ? window.t("audio_tx.btn_save_text", { id: activeAudioTxPresetId }) : `Сохранить в P${activeAudioTxPresetId}`;
      }
      if (saveAudioTxPresetBtn) {
        saveAudioTxPresetBtn.title = window.t ? window.t("audio_tx.btn_save_title", { id: activeAudioTxPresetId }) : `Сохранить текущие параметры передачи в пресет ${activeAudioTxPresetId}`;
      }
    }

    audioTxPresetButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-audio-tx-preset");
        if (id) applyAudioTxPreset(id);
      });
    });

    if (saveAudioTxPresetBtn) {
      saveAudioTxPresetBtn.addEventListener("click", () => {
        saveCurrentToAudioTxPreset(activeAudioTxPresetId);
      });
    }

    window.addEventListener("languageChanged", () => {
      updateTxBadges();
      updateAudioTxPresetUI();
    });
    window.applyAudioTxPreset = applyAudioTxPreset;
    window.updateAudioTxPresetUI = updateAudioTxPresetUI;
    window.updateTxBadges = updateTxBadges;
    window.applyTxDspSettings = applyTxDspSettings;

    // Restore saved TX settings from localStorage without blind overwrite
    const savedTxMicGain = localStorage.getItem("proxdmr_tx_mic_gain");
    if (savedTxMicGain !== null && sliderTxMicGain) sliderTxMicGain.value = savedTxMicGain;
    const savedTxNs = localStorage.getItem("proxdmr_tx_ns");
    if (savedTxNs !== null && chkTxNoiseSuppression) chkTxNoiseSuppression.checked = savedTxNs !== "false";
    const savedTxAgc = localStorage.getItem("proxdmr_tx_agc");
    if (savedTxAgc !== null && chkTxBrowserAgc) chkTxBrowserAgc.checked = savedTxAgc === "true";
    const savedTxDspAgc = localStorage.getItem("proxdmr_tx_dsp_agc");
    if (savedTxDspAgc !== null && chkTxDspAgc) chkTxDspAgc.checked = savedTxDspAgc === "true";
    const savedTxAec = localStorage.getItem("proxdmr_tx_aec");
    if (savedTxAec !== null && chkTxEchoCancellation) chkTxEchoCancellation.checked = savedTxAec !== "false";
    const savedTxGate = localStorage.getItem("proxdmr_tx_gate_enabled");
    if (savedTxGate !== null && chkTxGate) chkTxGate.checked = savedTxGate !== "false";
    const savedTxGateThr = localStorage.getItem("proxdmr_tx_gate_threshold");
    if (savedTxGateThr !== null && sliderTxGate) sliderTxGate.value = savedTxGateThr;
    const savedTxHpf = localStorage.getItem("proxdmr_tx_hpf");
    if (savedTxHpf !== null && chkTxHpf) chkTxHpf.checked = savedTxHpf !== "false";
    const savedTxPres = localStorage.getItem("proxdmr_tx_presence");
    if (savedTxPres !== null && sliderTxPresence) sliderTxPresence.value = savedTxPres;
    updateTxBadges();
    applyTxDspSettings();
    updateAudioTxPresetUI();

    if (resetDefaultsBtn) {
      resetDefaultsBtn.addEventListener("click", () => {
        applyAudioTxPreset("1");
      });
    }
  }

  // --- Mini-Preset Dropdown Manager ---
  if (!window.__miniPresetDropdownManagerInitialized) {
    window.__miniPresetDropdownManagerInitialized = true;

    let lastToggleTime = 0;

    const handleMiniPresetTrigger = (e) => {
      const miniTrigger = e.target.closest(".btn-mini-preset");
      if (!miniTrigger) return;

      const now = Date.now();
      if (now - lastToggleTime < 250) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        return;
      }
      lastToggleTime = now;

      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();

      const pair = miniTrigger.closest(".control-pair-btn");
      const menu = pair ? pair.querySelector(".mini-preset-menu") : null;
      const isAlreadyOpen = menu && menu.classList.contains("show");

      // Close all open dropdown menus & pairs
      document.querySelectorAll(".mini-preset-menu.show").forEach(m => m.classList.remove("show"));
      document.querySelectorAll(".control-pair-btn.open").forEach(p => p.classList.remove("open"));

      if (menu && !isAlreadyOpen) {
        menu.classList.add("show");
        if (pair) pair.classList.add("open");
      }
    };

    const handlePresetItemSelect = (e) => {
      const presetItem = e.target.closest(".mini-preset-item");
      if (!presetItem) return;

      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();

      if (presetItem.hasAttribute("data-preset")) {
        const pId = presetItem.getAttribute("data-preset");
        if (typeof window.applyDsdfmePreset === "function") window.applyDsdfmePreset(pId);
      } else if (presetItem.hasAttribute("data-audio-rx-preset")) {
        const pId = presetItem.getAttribute("data-audio-rx-preset");
        if (typeof window.applyAudioRxPreset === "function") window.applyAudioRxPreset(pId);
      } else if (presetItem.hasAttribute("data-audio-tx-preset")) {
        const pId = presetItem.getAttribute("data-audio-tx-preset");
        if (typeof window.applyAudioTxPreset === "function") window.applyAudioTxPreset(pId);
      }

      document.querySelectorAll(".mini-preset-menu.show").forEach(m => m.classList.remove("show"));
      document.querySelectorAll(".control-pair-btn.open").forEach(p => p.classList.remove("open"));
    };

    document.addEventListener("click", (e) => {
      if (e.target.closest(".btn-mini-preset")) {
        handleMiniPresetTrigger(e);
        return;
      }
      if (e.target.closest(".mini-preset-item")) {
        handlePresetItemSelect(e);
        return;
      }
      // Click outside: close any open dropdown menu
      document.querySelectorAll(".mini-preset-menu.show").forEach(m => m.classList.remove("show"));
      document.querySelectorAll(".control-pair-btn.open").forEach(p => p.classList.remove("open"));
    });
  }

  setupAudioRxModal();
  setupAudioTxModal();

  // --- TX DSP Nodes & Functions ---
  let txMicGainNode = null;
  let txHpfNode = null;
  let txPresenceNode = null;
  let txAgcGainNode = null;
  let txAgc = null;

  function applyTxDspSettings() {
    // All TX DSP audio processing (HPF, Presence, Mic Gain, DSP AGC, Limiter)
    // is now performed server-side in Python (ServerTxDsp).
    // Here we sync parameters to the server and update the worklet noise gate.
    _scheduleSyncClientSettings();

    if (window.workletNode && window.workletNode.port) {
      const gateEl = document.getElementById("chkTxGate");
      const gateThrEl = document.getElementById("sliderTxGate");
      const gateEn = gateEl ? gateEl.checked : (localStorage.getItem("proxdmr_tx_gate_enabled") !== "false");
      const gateThr = gateThrEl ? (parseFloat(gateThrEl.value) || -45) : (parseFloat(localStorage.getItem("proxdmr_tx_gate_threshold")) || -45);
      window.workletNode.port.postMessage({
        command: "set_tx_params",
        gateEnabled: gateEn,
        gateThresholdDb: gateThr
      });
    }
  }

  async function updateMicTrackConstraints() {
    if (!window.micStream) return;
    const nsEl = document.getElementById("chkTxNoiseSuppression");
    const agcEl = document.getElementById("chkTxBrowserAgc");
    const aecEl = document.getElementById("chkTxEchoCancellation");

    const ns = nsEl ? nsEl.checked : (localStorage.getItem("proxdmr_tx_ns") !== "false");
    const agc = agcEl ? agcEl.checked : (localStorage.getItem("proxdmr_tx_agc") === "true");
    const aec = aecEl ? aecEl.checked : (localStorage.getItem("proxdmr_tx_aec") !== "false");

    for (const track of window.micStream.getAudioTracks()) {
      try {
        await track.applyConstraints({
          noiseSuppression: ns,
          autoGainControl: agc,
          echoCancellation: aec
        });
      } catch (e) {
        console.warn("[TX] applyConstraints notice:", e);
      }
    }
  }

  // --- Audio Pipeline ---
  let isAudioReady = false;
  let isAudioInitializing = false;

  async function initAudio() {
    if (isAudioReady && window.audioCtx && window.audioCtx.state !== "closed") {
      const isTrackAlive = window.micStream && window.micStream.getAudioTracks().some(t => t.readyState === "live");
      if (isTrackAlive && window.workletNode) {
        if (window.audioCtx.state === "suspended") await window.audioCtx.resume();
        return true;
      }
      // If mic track died (e.g. unplugged/disabled), reset mic nodes and re-acquire
      if (window.micSourceNode) {
        try { window.micSourceNode.disconnect(); } catch (_) {}
        window.micSourceNode = null;
      }
      window.micStream = null;
      isAudioReady = false;
    }
    if (isAudioInitializing) {
      let wait = 0;
      while (isAudioInitializing && wait < 20) {
        await new Promise(r => setTimeout(r, 50));
        wait++;
      }
      return isAudioReady;
    }

    isAudioInitializing = true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!window.audioCtx || window.audioCtx.state === "closed") {
        window.audioCtx = (window.audioPlayer && window.audioPlayer.audioCtx) ? window.audioPlayer.audioCtx : new AudioContextClass();
      }
      if (window.audioCtx.state === "suspended") {
        await window.audioCtx.resume();
      }

      await window.audioPlayer.init(window.audioCtx);

      try {
        await window.audioCtx.audioWorklet.addModule("/static/js/audio-processor.js");
      } catch (modErr) {
        // AudioWorklet module already added
      }

      if (!window.micStream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const ns = localStorage.getItem("proxdmr_tx_ns") !== "false";
          const agc = localStorage.getItem("proxdmr_tx_agc") === "true";
          const aec = localStorage.getItem("proxdmr_tx_aec") !== "false";
          window.micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: aec,
              noiseSuppression: ns,
              autoGainControl: agc
            },
            video: false
          });
        } catch (micErr) {
          console.warn("[AUDIO] getUserMedia error or device missing:", micErr);
          window.micStream = null;
        }
      }

      if (window.micStream && !window.micSourceNode) {
        window.micSourceNode = window.audioCtx.createMediaStreamSource(window.micStream);

        window.analyserNode = window.audioCtx.createAnalyser();
        window.analyserNode.fftSize = 256;

        if (!window.workletNode) {
          window.workletNode = new AudioWorkletNode(window.audioCtx, "dmr-mic-processor");

          // Web Audio pull sink: Connect worklet to destination through a zero-gain node.
          // Web Audio uses a pull architecture; without an active downstream path to destination,
          // Chromium/Safari/Firefox consider the AudioWorklet subgraph unrooted and stop calling process()
          // after 1-3 seconds, silently killing TX audio!
          const workletSink = window.audioCtx.createGain();
          workletSink.gain.value = 0;
          window.workletNode.connect(workletSink);
          workletSink.connect(window.audioCtx.destination);
          window._workletSink = workletSink;

          let txPacketCount = 0;
          window.workletNode.port.onmessage = (event) => {
            if (window.isPttPressed && window.ws && window.ws.readyState === WebSocket.OPEN) {
              window.ws.send(event.data);
              txPacketCount++;
              if (txPacketCount === 1 || txPacketCount % 50 === 0) {
                console.log(`[AUDIO_TX] Sent packet #${txPacketCount} (${event.data.byteLength || 0}B)`);
              }
            } else {
              txPacketCount = 0;
            }
          };
        }

        // Direct connection: Mic Stream -> Analyser (VU meter) and Worklet (8kHz resampler)
        // All audio DSP (HPF, Presence Boost, Mic Gain, DSP AGC, Limiter) is executed on the server.
        window.micSourceNode.connect(window.analyserNode);
        window.micSourceNode.connect(window.workletNode);

        applyTxDspSettings();
      }

      if (window.micStream) {
        window.micStream.getAudioTracks().forEach(t => {
          t.enabled = true;
          t.onended = () => {
            const checkMic = (typeof window.isCheckMicOnTxEnabled === "function")
              ? window.isCheckMicOnTxEnabled()
              : (localStorage.getItem("proxdmr_check_mic_on_tx") !== "false");

            if (checkMic) {
              console.warn("[AUDIO] Microphone track ended unexpectedly");
              isAudioReady = false;
              if (window.isPttPressed && typeof window.stopTransmission === "function") {
                window.stopTransmission();
                if (typeof window.showToast === "function") {
                  const msg = window.t
                    ? window.t("ptt.mic_disconnected_toast", {}, "⚠️ Микрофон отключен во время передачи!")
                    : "⚠️ Микрофон отключен во время передачи!";
                  window.showToast(msg, 3500);
                }
              }
            } else {
              console.warn("[AUDIO] Microphone track ended, but mic check is disabled. Continuing transmission with silence fallback.");
              if (window.isPttPressed && typeof window.ensureTxSilenceFallback === "function") {
                window.ensureTxSilenceFallback();
              }
            }
          };
        });
      }

      const hasLiveTrack = Boolean(window.micStream && window.micStream.getAudioTracks().some(t => t.readyState === "live"));
      isAudioReady = Boolean(window.workletNode && window.micStream && hasLiveTrack);
      console.log("[AUDIO] Audio pipeline ready at", window.audioCtx.sampleRate, "Hz, mic:", hasLiveTrack);
      return isAudioReady;
    } catch (err) {
      console.warn("[AUDIO] Microphone or AudioContext init notice:", err);
      isAudioReady = false;
      return false;
    } finally {
      isAudioInitializing = false;
    }
  }

  // --- Per-Hotspot & Per-Timeslot Smooth VU Meter Engine (Peak Attack, Ballistic Release, Peak Hold) ---
  const VU_PEAK_HOLD_MS = 1000;
  const VU_PEAK_DECAY_RATE = 55.0; // % per second decay after hold
  const vuHotspotStates = {};
  let lastVuTickTime = performance.now();
  let vuAnimFrameId = null;

  function getVuState(hid, slot = 1) {
    if (!hid) hid = "default";
    const s = Number(slot) === 2 ? 2 : 1;
    const key = `${hid}_ts${s}`;
    if (!vuHotspotStates[key]) {
      vuHotspotStates[key] = {
        current: 0.0,
        target: 0.0,
        peak: 0.0,
        peakHoldUntil: 0,
        mode: "IDLE",
        lastRxTime: 0
      };
    }
    return vuHotspotStates[key];
  }

  function ensureVuMeterLoop() {
    if (!vuAnimFrameId) {
      lastVuTickTime = performance.now();
      vuAnimFrameId = requestAnimationFrame(vuMeterTick);
    }
  }

  function updateHotspotVuMeter(hotspotId, slotOrBuf, arrayBuffer) {
    let slot = 0;
    let buf = arrayBuffer;
    if (slotOrBuf instanceof ArrayBuffer) {
      buf = slotOrBuf;
      slot = 0;
    } else if (typeof slotOrBuf === "number") {
      slot = slotOrBuf === 2 ? 2 : (slotOrBuf === 1 ? 1 : 0);
    } else {
      const parsed = parseInt(slotOrBuf, 10);
      slot = parsed === 2 ? 2 : (parsed === 1 ? 1 : 0);
    }
    if (!buf) return;

    const hid = hotspotId || window.activeHotspotId || "default";

    // Strict slot resolution: if slot wasn't specified and this hotspot currently has an active RX call in UI, route strictly to it!
    if (!slot) {
      const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`);
      if (targetCard) {
        const isTs1Rx = targetCard.querySelector(".vfo-ts1-row")?.classList.contains("vfo-rx-active");
        const isTs2Rx = targetCard.querySelector(".vfo-ts2-row")?.classList.contains("vfo-rx-active");
        if (isTs1Rx && !isTs2Rx) {
          slot = 1;
        } else if (isTs2Rx && !isTs1Rx) {
          slot = 2;
        }
      }
    }

    if (!slot) {
      slot = _getHotspotSlot(hid) || 1;
    }

    const int16 = new Int16Array(buf);
    if (int16.length === 0) return;
    let sumSquares = 0;
    for (let i = 0; i < int16.length; i++) {
      const norm = int16[i] / 32768.0;
      sumSquares += norm * norm;
    }
    const rawRms = Math.sqrt(sumSquares / int16.length);

    // Calculate level taking digital Pre-Gain and AGC into account if enabled for this hotspot
    const preGainDb = (window.audioPlayer && typeof window.audioPlayer.getPreGainDb === "function")
      ? window.audioPlayer.getPreGainDb() : 0;
    const preGainLinear = Math.pow(10.0, preGainDb / 20.0);
    const effectiveInputRms = rawRms * preGainLinear;

    let effectiveRms = effectiveInputRms;
    // AGC is applied server-side, effectiveRms = effectiveInputRms

    const pct = Math.min(100, Math.round(Math.pow(effectiveRms * 2.5, 0.75) * 100));

    const st = getVuState(hid, slot);
    st.mode = "RX";
    st.lastRxTime = performance.now();
    st.target = pct;
    if (pct > st.current) {
      st.current = pct;
    }
    if (pct >= st.peak) {
      st.peak = pct;
      st.peakHoldUntil = performance.now() + VU_PEAK_HOLD_MS;
    }
    ensureVuMeterLoop();
  }

  function updateRxVuMeter(arrayBuffer) {
    updateHotspotVuMeter(window.activeHotspotId, window.activeSlot || 1, arrayBuffer);
  }
  window.__proxdmr.updateHotspotVuMeter = updateHotspotVuMeter;

  function vuMeterTick(now) {
    const dt = Math.min(0.1, (now - lastVuTickTime) / 1000.0);
    lastVuTickTime = now;
    let anyActive = false;

    const allCards = document.querySelectorAll(".radio-container");
    allCards.forEach(card => {
      const hid = card.dataset.hotspotId || "default";
      const activeSlotForCard = _getHotspotSlot(hid) || 1;

      for (const slot of [1, 2]) {
        const st = getVuState(hid, slot);

        // Ballistic release decay (~3x slower: smooth fall over ~550ms)
        if (st.current > st.target) {
          st.current = Math.max(st.target, st.current * Math.exp(-4.2 * dt) - (10.0 * dt));
        } else if (st.current < st.target) {
          st.current = st.target;
        }
        if (st.current < 0.5) st.current = 0;

        // Target decays to 0 when audio stops arriving
        if (st.mode === "RX") {
          if (now - st.lastRxTime > 60) {
            st.target = 0;
          }
          if (now - st.lastRxTime > 700 && st.current <= 0) {
            st.mode = "IDLE";
          }
        } else if (st.mode === "TX") {
          if (!window.isPttPressed || hid !== window.activeHotspotId || activeSlotForCard !== slot) {
            st.target = 0;
            if (st.current <= 0) st.mode = "IDLE";
          }
        } else {
          st.target = 0;
        }

        // Peak Hold & Decay logic
        if (st.current > st.peak) {
          st.peak = st.current;
          st.peakHoldUntil = now + VU_PEAK_HOLD_MS;
        } else if (now > st.peakHoldUntil) {
          st.peak = Math.max(st.current, st.peak - (VU_PEAK_DECAY_RATE * dt));
          if (st.peak < 1.0) st.peak = 0;
        }

        if (!card._vuEls) card._vuEls = {};
        if (!card._vuEls[slot]) {
          let peakEl = card.querySelector(slot === 1 ? ".vu-peak-ts1" : ".vu-peak-ts2");
          if (!peakEl) {
            const vuBar = card.querySelector(slot === 1 ? ".clock-vu-track.track-ts1, .vfo-ts1-row .vfo-vu-bar" : ".clock-vu-track.track-ts2, .vfo-ts2-row .vfo-vu-bar");
            if (vuBar) {
              peakEl = document.createElement("div");
              peakEl.className = `clock-vu-peak ${slot === 1 ? "vu-peak-ts1" : "vu-peak-ts2"}`;
              vuBar.appendChild(peakEl);
            }
          }
          let vertPeakEl = card.querySelector(slot === 1 ? ".vu-peak-vert-ts1" : ".vu-peak-vert-ts2");
          if (!vertPeakEl) {
            const vertVuBar = card.querySelector(slot === 1 ? ".vfo-ts1-row .vfo-vu-vert-bar" : ".vfo-ts2-row .vfo-vu-vert-bar");
            if (vertVuBar) {
              vertPeakEl = document.createElement("div");
              vertPeakEl.className = `vfo-vu-vert-peak ${slot === 1 ? "vu-peak-vert-ts1" : "vu-peak-vert-ts2"}`;
              vertVuBar.appendChild(vertPeakEl);
            }
          }
          card._vuEls[slot] = {
            fillEl: card.querySelector(slot === 1 ? ".vu-fill-ts1" : ".vu-fill-ts2"),
            vertFillEl: card.querySelector(slot === 1 ? ".vu-fill-vert-ts1" : ".vu-fill-vert-ts2"),
            peakEl,
            vertPeakEl
          };
        }

        const { fillEl, vertFillEl, peakEl, vertPeakEl } = card._vuEls[slot];

        if (fillEl) {
          fillEl.style.width = `${st.current.toFixed(1)}%`;
        }
        if (peakEl) {
          if (st.peak > 1.0) {
            peakEl.style.left = `${Math.min(100, Math.max(0, st.peak)).toFixed(1)}%`;
            peakEl.style.opacity = "1";
            if (st.peak >= 85) {
              peakEl.classList.add("vu-peak-overload");
            } else {
              peakEl.classList.remove("vu-peak-overload");
            }
          } else {
            peakEl.style.opacity = "0";
            peakEl.classList.remove("vu-peak-overload");
          }
        }

        if (vertFillEl) {
          vertFillEl.style.height = `${st.current.toFixed(1)}%`;
        }
        if (vertPeakEl) {
          if (st.peak > 1.0) {
            vertPeakEl.style.bottom = `${Math.min(100, Math.max(0, st.peak)).toFixed(1)}%`;
            vertPeakEl.style.opacity = "1";
            if (st.peak >= 85) {
              vertPeakEl.classList.add("vu-peak-overload");
            } else {
              vertPeakEl.classList.remove("vu-peak-overload");
            }
          } else {
            vertPeakEl.style.opacity = "0";
            vertPeakEl.classList.remove("vu-peak-overload");
          }
        }

        const isSlotActive = (st.mode === "TX" && window.isPttPressed && hid === window.activeHotspotId && activeSlotForCard === slot) ||
                             (st.mode === "RX" && (now - st.lastRxTime < 700)) ||
                             (st.current > 0) ||
                             (st.peak > 0);
        if (isSlotActive) anyActive = true;
      }
    });

    if (anyActive) {
      vuAnimFrameId = requestAnimationFrame(vuMeterTick);
    } else {
      vuAnimFrameId = null;
    }
  }

  function startVuMeter() {
    if (!window.analyserNode) return;
    // Guard against double-start (two parallel rAF loops)
    if (window.animationFrameId) {
      cancelAnimationFrame(window.animationFrameId);
      window.animationFrameId = null;
    }
    const txTimeBuf = (typeof window.analyserNode.getFloatTimeDomainData === "function") ? new Float32Array(window.analyserNode.fftSize) : null;
    const txByteBuf = txTimeBuf ? null : new Uint8Array(window.analyserNode.fftSize);

    // Cache DOM refs and localStorage values OUTSIDE rAF loop to avoid IPC overhead on APK
    const cachedGateEl = document.getElementById("chkTxGate");
    const cachedGateThrEl = document.getElementById("sliderTxGate");
    let cachedGateEnabled = cachedGateEl ? cachedGateEl.checked : (localStorage.getItem("proxdmr_tx_gate_enabled") !== "false");
    let cachedGateThreshold = cachedGateThrEl ? (parseFloat(cachedGateThrEl.value) || -45) : (parseFloat(localStorage.getItem("proxdmr_tx_gate_threshold")) || -45);

    // Update cached values only on user interaction (not every frame)
    if (cachedGateEl) {
      cachedGateEl.addEventListener("change", () => { cachedGateEnabled = cachedGateEl.checked; }, { passive: true });
    }
    if (cachedGateThrEl) {
      cachedGateThrEl.addEventListener("input", () => { cachedGateThreshold = parseFloat(cachedGateThrEl.value) || -45; }, { passive: true });
    }

    function draw() {
      const txSlot = _getHotspotSlot(window.activeHotspotId) || 1;
      if (!window.isPttPressed) {
        const st = getVuState(window.activeHotspotId, txSlot);
        st.mode = "IDLE";
        st.target = 0;
        ensureVuMeterLoop();
        return;
      }

      let sumSq = 0;
      let len = 0;
      if (txTimeBuf && typeof window.analyserNode.getFloatTimeDomainData === "function") {
        window.analyserNode.getFloatTimeDomainData(txTimeBuf);
        len = txTimeBuf.length;
        for (let i = 0; i < len; i++) {
          const s = txTimeBuf[i];
          sumSq += s * s;
        }
      } else {
        const bBuf = txByteBuf || new Uint8Array(window.analyserNode.fftSize);
        window.analyserNode.getByteTimeDomainData(bBuf);
        len = bBuf.length;
        for (let i = 0; i < len; i++) {
          const s = (bBuf[i] - 128) / 128.0;
          sumSq += s * s;
        }
      }
      const rawRms = len > 0 ? Math.sqrt(sumSq / len) : 0;

      // Microphone input level directly from AnalyserNode (DSP AGC & Gain run server-side)
      let effectiveRms = rawRms;

      // Respect Noise Gate silence suppression (using cached values, not live DOM/localStorage)
      const gateEn = cachedGateEl ? cachedGateEl.checked : cachedGateEnabled;
      const gateThr = cachedGateThrEl ? (parseFloat(cachedGateThrEl.value) || -45) : cachedGateThreshold;

      if (gateEn && effectiveRms > 0) {
        const rmsDb = effectiveRms > 0.00001 ? 20.0 * Math.log10(effectiveRms) : -100.0;
        if (rmsDb < gateThr) {
          effectiveRms = 0;
        }
      }

      // Percentage computed with same power-curve formula as RX
      const pct = Math.min(100, Math.round(Math.pow(effectiveRms * 2.5, 0.75) * 100));

      const st = getVuState(window.activeHotspotId, txSlot);
      st.mode = "TX";
      st.target = pct;
      if (pct > st.current) {
        st.current = pct;
      }
      if (pct >= st.peak) {
        st.peak = pct;
        st.peakHoldUntil = performance.now() + VU_PEAK_HOLD_MS;
      }

      ensureVuMeterLoop();
      window.animationFrameId = requestAnimationFrame(draw);
    }
    draw();
  }



export function stopVuMeter() {
  if (typeof window !== "undefined" && window.animationFrameId) {
    cancelAnimationFrame(window.animationFrameId);
    window.animationFrameId = null;
  }
}

export function resetTxDsp() {
  stopVuMeter();
  if (txAgc) {
    txAgc.reset();
  }
  const actx = typeof window !== "undefined" && window.audioCtx;
  if (txAgcGainNode && actx && actx.state !== "closed") {
    txAgcGainNode.gain.setValueAtTime(1.0, actx.currentTime);
  }
}

export function initAudioDsp() {
  setupAudioRxModal();
  setupAudioTxModal();
}

export {
  setupAudioRxModal,
  setupAudioTxModal,
  applyTxDspSettings,
  updateMicTrackConstraints,
  initAudio,
  getVuState,
  ensureVuMeterLoop,
  updateHotspotVuMeter,
  updateRxVuMeter,
  vuMeterTick,
  startVuMeter,
  txMicGainNode,
  txHpfNode,
  txPresenceNode,
  txAgcGainNode,
  txAgc
};

if (typeof window !== "undefined") {
  window.setupAudioRxModal = setupAudioRxModal;
  window.setupAudioTxModal = setupAudioTxModal;
  window.applyTxDspSettings = applyTxDspSettings;
  window.updateMicTrackConstraints = updateMicTrackConstraints;
  window.initAudio = initAudio;
  window.getVuState = getVuState;
  window.ensureVuMeterLoop = ensureVuMeterLoop;
  window.updateHotspotVuMeter = updateHotspotVuMeter;
  window.updateRxVuMeter = updateRxVuMeter;
  window.vuMeterTick = vuMeterTick;
  window.startVuMeter = startVuMeter;
  window.stopVuMeter = stopVuMeter;
  window.resetTxDsp = resetTxDsp;
  window.initAudioDsp = initAudioDsp;

  window.__testVuMeter = (buf, slot = 1) => updateHotspotVuMeter(window.activeHotspotId, slot, buf);
  window.__testVuPeak = (pct = 80, slot = 1, hid = null) => {
    const h = hid || window.activeHotspotId || "default";
    const st = getVuState(h, slot);
    st.mode = "RX";
    st.lastRxTime = performance.now();
    st.target = pct;
    st.current = pct;
    st.peak = pct;
    st.peakHoldUntil = performance.now() + VU_PEAK_HOLD_MS;
    ensureVuMeterLoop();
  };

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.updateHotspotVuMeter = updateHotspotVuMeter;
  window.__proxdmr.dsp = {
    setupAudioRxModal,
    setupAudioTxModal,
    applyTxDspSettings,
    updateMicTrackConstraints,
    initAudio,
    getVuState,
    ensureVuMeterLoop,
    updateHotspotVuMeter,
    updateRxVuMeter,
    vuMeterTick,
    startVuMeter,
    stopVuMeter,
    resetTxDsp,
    initAudioDsp
  };
}
