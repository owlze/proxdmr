/**
 * ProxDMR - Audio DSP, Equalizers, AGC, RX/TX Modals & Smooth VU Meter Engine
 * Module: modules/audio/dsp.js
 */

import { getHotspotSlot as _getHotspotSlot } from '../core/state.js?v=2.9.698';
import { pushNavState as _pushNavState, notifyNavClosed as _notifyNavClosed, scheduleSyncClientSettings as _scheduleSyncClientSettings } from '../core/state.js?v=2.9.698';

  // --- Audio Settings & DSP Modal Handler (RX / TX) ---
  // --- Audio RX Modal & DSP ---
  let _rxModalSetup = false;
  let _currentAudioRxNet = "dmr";
  let _currentAudioRxHid = "";

  export function getActiveAudioRxNet() {
    return _currentAudioRxNet;
  }

  function syncActiveAudioRxPreset(targetCardOrHid = null) {
    if (!_rxModalSetup && typeof setupAudioRxModal === "function") {
      setupAudioRxModal();
    }
    let isAsl = false;
    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    const activeId = (typeof window !== "undefined" && window.activeHotspotId) || "default";
    const hid = (typeof targetCardOrHid === "string" ? targetCardOrHid : activeId) || "default";

    if (targetCardOrHid && typeof targetCardOrHid !== "string" && targetCardOrHid.getAttribute) {
      const netType = (targetCardOrHid.getAttribute("data-network-type") || "").toLowerCase();
      if (netType === "allstar" || targetCardOrHid.classList.contains("card-net-allstar")) {
        isAsl = true;
      }
    } else {
      let hs = currentHotspots.find(h => String(h.id) === String(hid));
      if (!hs && (hid === "default" || currentHotspots.length === 1)) {
        hs = currentHotspots[0];
      }
      if (hs && ((hs.network_type || "").toLowerCase() === "allstar")) {
        isAsl = true;
      } else if (!hs) {
        const activeCard = document.querySelector(`.radio-container[data-hotspot-id="${hid}"].card-net-allstar`) ||
                           document.querySelector(".radio-container.active-hotspot.card-net-allstar") ||
                           document.querySelector(".hotspot-card.active-card.card-net-allstar");
        if (activeCard) {
          isAsl = true;
        } else if (!currentHotspots.length && !document.querySelector(".radio-container")) {
          try {
            if (localStorage.getItem("proxdmr_audio_rx_net") === "allstar") {
              isAsl = true;
            }
          } catch (_) {}
        }
      }
    }

    _currentAudioRxNet = isAsl ? "allstar" : "dmr";
    try {
      localStorage.setItem("proxdmr_audio_rx_net", _currentAudioRxNet);
    } catch (_) {}

    const audioRxModal = document.getElementById("audioRxModal");
    const modalTitle = audioRxModal ? audioRxModal.querySelector(".modal-title, h3") : null;
    const oldRxBadge = audioRxModal ? audioRxModal.querySelector(".badge-audio-mode") : null;
    if (oldRxBadge) oldRxBadge.remove();
    if (modalTitle) {
      const titleKey = isAsl ? "audio_rx.modal_title_analog" : "audio_rx.modal_title";
      const titleDef = isAsl ? "Audio RX Settings (Analog)" : "Audio RX Settings";
      modalTitle.textContent = window.t ? window.t(titleKey, {}, titleDef) : titleDef;
    }

    const prefix = isAsl ? "proxdmr_asl_audio_rx" : "proxdmr_audio_rx";
    const curPres = localStorage.getItem(`${prefix}_active_preset`) || "1";
    if (typeof window.applyAudioRxPreset === "function") {
      window.applyAudioRxPreset(curPres, true);
    }
  }

  function syncActiveAudioTxPreset(targetCardOrHid = null) {
    if (!_txModalSetup && typeof setupAudioTxModal === "function") {
      setupAudioTxModal();
    }
    let isAsl = false;
    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    const activeId = (typeof window !== "undefined" && window.activeHotspotId) || "default";
    const hid = (typeof targetCardOrHid === "string" ? targetCardOrHid : activeId) || "default";

    if (targetCardOrHid && typeof targetCardOrHid !== "string" && targetCardOrHid.getAttribute) {
      const netType = (targetCardOrHid.getAttribute("data-network-type") || "").toLowerCase();
      if (netType === "allstar" || targetCardOrHid.classList.contains("card-net-allstar")) {
        isAsl = true;
      }
    } else {
      let hs = currentHotspots.find(h => String(h.id) === String(hid));
      if (!hs && (hid === "default" || currentHotspots.length === 1)) {
        hs = currentHotspots[0];
      }
      if (hs && ((hs.network_type || "").toLowerCase() === "allstar")) {
        isAsl = true;
      } else if (!hs) {
        const activeCard = document.querySelector(`.radio-container[data-hotspot-id="${hid}"].card-net-allstar`) ||
                           document.querySelector(".radio-container.active-hotspot.card-net-allstar") ||
                           document.querySelector(".hotspot-card.active-card.card-net-allstar");
        if (activeCard) {
          isAsl = true;
        } else if (!currentHotspots.length && !document.querySelector(".radio-container")) {
          try {
            if (localStorage.getItem("proxdmr_audio_tx_net") === "allstar") {
              isAsl = true;
            }
          } catch (_) {}
        }
      }
    }

    _currentAudioTxNet = isAsl ? "allstar" : "dmr";
    try {
      localStorage.setItem("proxdmr_audio_tx_net", _currentAudioTxNet);
    } catch (_) {}

    const audioTxModal = document.getElementById("audioTxModal");
    const modalTitle = audioTxModal ? audioTxModal.querySelector(".modal-title, h3") : null;
    const oldTxBadge = audioTxModal ? audioTxModal.querySelector(".badge-audio-mode") : null;
    if (oldTxBadge) oldTxBadge.remove();
    if (modalTitle) {
      const titleKey = isAsl ? "audio_tx.modal_title_analog" : "audio_tx.modal_title";
      const titleDef = isAsl ? "Audio TX Settings (Analog)" : "Audio TX Settings";
      modalTitle.textContent = window.t ? window.t(titleKey, {}, titleDef) : titleDef;
    }

    const prefix = isAsl ? "proxdmr_asl_audio_tx" : "proxdmr_audio_tx";
    const curPres = localStorage.getItem(`${prefix}_active_preset`) || "1";
    if (typeof window.applyAudioTxPreset === "function") {
      window.applyAudioTxPreset(curPres, true);
    }
  }

  function setupAudioRxModal() {
    if (_rxModalSetup) return;
    _rxModalSetup = true;

    const audioRxModal = document.getElementById("audioRxModal");
    const closeBtn = document.getElementById("closeAudioRxBtn");

    // Presets
    const audioRxPresetButtons = document.querySelectorAll(".btn-audio-rx-preset");
    const saveAudioRxPresetBtn = document.getElementById("btnSaveAudioRxPreset");
    const saveAudioRxPresetText = document.getElementById("saveAudioRxPresetText");

    // 10-Band EQ
    const chkEq10Enable = document.getElementById("chkEq10Enable");
    const chkEq10Linked = document.getElementById("chkEq10Linked");
    const btnResetEq10Profile = document.getElementById("btnResetEq10Profile");

    // AGC
    const chkAgcEnable = document.getElementById("chkAgcEnable");
    const badgeAgcStatus = document.getElementById("badgeAgcStatus");
    const sliderAgcDepth = document.getElementById("sliderAgcDepth");
    const lblAgcDepth = document.getElementById("lblAgcDepth");
    const sliderAgcGain = document.getElementById("sliderAgcGain");
    const lblAgcGain = document.getElementById("lblAgcGain");

    // Limiter
    const chkLimiterEnable = document.getElementById("chkLimiterEnable");

    // Jitter & Boost
    const sliderJitterBuffer = document.getElementById("sliderJitterBuffer");
    const valJitterBuffer = document.getElementById("valJitterBuffer");
    const inputRxBoostDb = document.getElementById("inputRxBoostDb");

    function clampRxBoostDb(v) {
      const n = parseInt(v, 10);
      if (isNaN(n)) return 50;
      if (n < 1) return 1;
      if (n > 100) return 100;
      return n;
    }

    const DEFAULT_SPEECH_EQ = [-10, -15, -5, 0, 10, 20, 25, 20, 10, -15];
    const DEFAULT_ANALOG_SPEECH_EQ = [0, 0, 0, 0, 5, 15, 20, 15, 5, -10];

    const DEFAULT_PRESETS = {
      "1": {
        name: "Standard",
        eq10Enable: true,
        eq10Linked: true,
        eq10Gains: [-10, -15, -5, 0, 10, 20, 25, 20, 10, -15],
        agcEnable: true,
        agcDepth: 18,
        agcGain: 35,
        limiterEnable: true,
        jitterBuffer: 180,
        boostPct: 50
      },
      "2": {
        name: "Soft Ether",
        eq10Enable: true,
        eq10Linked: true,
        eq10Gains: [10, 5, -10, -15, 0, -10, -10, -15, -10, -15],
        agcEnable: true,
        agcDepth: 12,
        agcGain: 30,
        limiterEnable: true,
        jitterBuffer: 180,
        boostPct: 50
      },
      "3": {
        name: "Clarity (DX)",
        eq10Enable: true,
        eq10Linked: true,
        eq10Gains: [-30, -25, -15, 0, 15, 30, 35, 25, 10, -20],
        agcEnable: true,
        agcDepth: 20,
        agcGain: 40,
        limiterEnable: true,
        jitterBuffer: 180,
        boostPct: 50
      }
    };

    const DEFAULT_ANALOG_RX_PRESETS = {
      "1": {
        name: "Standard (Linear)",
        eq10Enable: false,
        eq10Linked: true,
        eq10Gains: [0, 0, 0, 0, 5, 15, 20, 15, 5, -10],
        agcEnable: true,
        agcDepth: 16,
        agcGain: 25,
        limiterEnable: true,
        jitterBuffer: 240,
        boostPct: 50
      },
      "2": {
        name: "Soft Ether",
        eq10Enable: false,
        eq10Linked: true,
        eq10Gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        agcEnable: false,
        agcDepth: 12,
        agcGain: 15,
        limiterEnable: true,
        jitterBuffer: 240,
        boostPct: 50
      },
      "3": {
        name: "Clear",
        eq10Enable: true,
        eq10Linked: true,
        eq10Gains: [-20, -15, -5, 0, 10, 20, 25, 20, 10, -15],
        agcEnable: false,
        agcDepth: 18,
        agcGain: 25,
        limiterEnable: true,
        jitterBuffer: 240,
        boostPct: 50
      }
    };

    function openModal() {
      if (audioRxModal) {
        if (typeof window.closePrimaryModals === "function") {
          window.closePrimaryModals("audioRxModal");
        }
        audioRxModal.style.display = "flex";
        audioRxModal.classList.add("active");
        _pushNavState("modal", "audioRxModal");
      }
    }

    function closeModal() {
      if (audioRxModal && (audioRxModal.classList.contains("active") || audioRxModal.style.display === "flex")) {
        audioRxModal.classList.remove("active");
        audioRxModal.style.display = "";
        _notifyNavClosed();
      }
    }
    window.closeAudioRxModal = closeModal;

    document.addEventListener("click", (e) => {
      const trigger = e.target.closest(".btn-audio-rx-trigger") || (e.target.id === "btnAudioRxMain" ? e.target : null);
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        const card = trigger.closest(".radio-container") || trigger.closest(".hotspot-card");
        const isAsl = card && (card.classList.contains("card-net-allstar") || card.getAttribute("data-network-type") === "allstar");
        _currentAudioRxNet = isAsl ? "allstar" : "dmr";
        _currentAudioRxHid = card ? (card.getAttribute("data-hotspot-id") || "") : "";

        const modalTitle = audioRxModal ? audioRxModal.querySelector(".modal-title, h3") : null;
        const oldRxBadge = audioRxModal ? audioRxModal.querySelector(".badge-audio-mode") : null;
        if (oldRxBadge) oldRxBadge.remove();
        if (modalTitle) {
          const titleKey = isAsl ? "audio_rx.modal_title_analog" : "audio_rx.modal_title";
          const titleDef = isAsl ? "Audio RX Settings (Analog)" : "Audio RX Settings";
          modalTitle.textContent = window.t ? window.t(titleKey, {}, titleDef) : titleDef;
        }
        const curPres = localStorage.getItem(getPresetStorageKey("active")) || "1";
        applyAudioRxPreset(curPres, true);
        openModal();
      }
    });

    const bottomSaveRxBtn = document.getElementById("btnCloseAudioRxBottom");
    if (bottomSaveRxBtn) {
      bottomSaveRxBtn.addEventListener("click", () => {
        autoSaveCurrentState();
        _scheduleSyncClientSettings(0);
        closeModal();
      });
    }
    if (closeBtn) closeBtn.addEventListener("click", () => {
      closeModal();
      if (typeof window.flushPendingClientSettingsSync === "function") {
        window.flushPendingClientSettingsSync();
      }
    });
    if (audioRxModal) {
      audioRxModal.addEventListener("click", (e) => {
        if (e.target === audioRxModal) {
          closeModal();
          if (typeof window.flushPendingClientSettingsSync === "function") {
            window.flushPendingClientSettingsSync();
          }
        }
      });
    }

    function getPresetStorageKey(type, id) {
      const prefix = _currentAudioRxNet === "allstar" ? "proxdmr_asl_audio_rx" : "proxdmr_audio_rx";
      return type === "active" ? `${prefix}_active_preset` : `${prefix}_preset_${id}`;
    }

    // 10-Band EQ Controls & Elastic Dragging
    let _prevEqSliderVals = DEFAULT_SPEECH_EQ.slice();
    for (let i = 0; i < 10; i++) {
      const s = document.getElementById(`eqSlider_${i}`);
      if (s) _prevEqSliderVals[i] = parseInt(s.value, 10);
    }

    function updateEqLabelsAndAudio() {
      const gains = [];
      const enabled = chkEq10Enable ? chkEq10Enable.checked : (_currentAudioRxNet !== "allstar");
      const defFallbackGains = _currentAudioRxNet === "allstar" ? DEFAULT_ANALOG_SPEECH_EQ : DEFAULT_SPEECH_EQ;
      for (let i = 0; i < 10; i++) {
        const slider = document.getElementById(`eqSlider_${i}`);
        const valLbl = document.getElementById(`eqVal_${i}`);
        const rawVal = slider ? parseInt(slider.value, 10) : defFallbackGains[i];
        const dbVal = rawVal / 10.0;
        gains.push(dbVal);
        if (valLbl) {
          valLbl.textContent = dbVal > 0 ? `+${dbVal.toFixed(1)}` : dbVal.toFixed(1);
        }
      }
      if (window.audioPlayer) {
        const curNet = _currentAudioRxNet === "allstar" ? "allstar" : "dmr";
        if (window.audioPlayer.dspProfiles && window.audioPlayer.dspProfiles[curNet]) {
          window.audioPlayer.dspProfiles[curNet].eq10Enabled = enabled;
          window.audioPlayer.dspProfiles[curNet].eq10Gains = gains.slice();
        }
        if (!window.audioPlayer.activeProfileNet || window.audioPlayer.activeProfileNet === curNet) {
          if (typeof window.audioPlayer.setEq10Enabled === "function") {
            window.audioPlayer.setEq10Enabled(enabled);
          }
          if (typeof window.audioPlayer.setEq10Gains === "function") {
            window.audioPlayer.setEq10Gains(gains);
          }
        }
      }
    }

    function onEqSliderInput(idx, immediate = false) {
      const mainSlider = document.getElementById(`eqSlider_${idx}`);
      if (!mainSlider) return;
      const newVal = parseInt(mainSlider.value, 10);
      const delta = newVal - _prevEqSliderVals[idx];
      _prevEqSliderVals[idx] = newVal;

      const isLinked = chkEq10Linked && chkEq10Linked.checked;
      if (isLinked && delta !== 0) {
        const weights = { 1: 0.25, 2: 0.08 };
        for (const [distStr, w] of Object.entries(weights)) {
          const dist = parseInt(distStr, 10);
          for (const neighborIdx of [idx - dist, idx + dist]) {
            if (neighborIdx >= 0 && neighborIdx < 10) {
              const nSlider = document.getElementById(`eqSlider_${neighborIdx}`);
              if (nSlider) {
                const curN = parseInt(nSlider.value, 10);
                const adjN = Math.max(-200, Math.min(200, Math.round(curN + delta * w)));
                nSlider.value = adjN;
                _prevEqSliderVals[neighborIdx] = adjN;
              }
            }
          }
        }
      }

      updateEqLabelsAndAudio();
      autoSaveCurrentState();
      _scheduleSyncClientSettings(immediate ? 0 : 200);
    }

    for (let i = 0; i < 10; i++) {
      const slider = document.getElementById(`eqSlider_${i}`);
      if (slider) {
        slider.addEventListener("input", () => onEqSliderInput(i, false));
        slider.addEventListener("change", () => onEqSliderInput(i, true));
      }
    }

    if (chkEq10Enable) {
      chkEq10Enable.addEventListener("change", () => {
        updateEqLabelsAndAudio();
        autoSaveCurrentState();
        _scheduleSyncClientSettings(0);
      });
    }

    if (chkEq10Linked) {
      chkEq10Linked.addEventListener("change", () => {
        autoSaveCurrentState();
        _scheduleSyncClientSettings(0);
      });
    }

    if (btnResetEq10Profile) {
      btnResetEq10Profile.addEventListener("click", () => {
        for (let i = 0; i < 10; i++) {
          const s = document.getElementById(`eqSlider_${i}`);
          if (s) {
            s.value = 0;
            _prevEqSliderVals[i] = 0;
          }
        }
        updateEqLabelsAndAudio();
        autoSaveCurrentState();
        _scheduleSyncClientSettings(0);
      });
    }

    // AGC UI Listeners
    function updateAgcUI() {
      const depth = sliderAgcDepth ? parseInt(sliderAgcDepth.value, 10) : 18;
      const gainRaw = sliderAgcGain ? parseInt(sliderAgcGain.value, 10) : 35;
      const gainMult = (gainRaw / 10.0).toFixed(1);
      const en = chkAgcEnable ? chkAgcEnable.checked : true;
      const uDb = window.t ? window.t("audio.unit_db", {}, "dB") : "dB";
      if (lblAgcDepth) lblAgcDepth.textContent = `${depth} ${uDb}`;
      if (lblAgcGain) lblAgcGain.textContent = `${gainMult}x`;
      if (badgeAgcStatus) {
        badgeAgcStatus.textContent = en ? `${depth} ${uDb} / ${gainMult}x` : (window.t ? window.t("audio.limit_off", {}, "Off") : "Off");
      }
      if (window.audioPlayer && typeof window.audioPlayer.setRxAgcConfig === "function") {
        const curNet = _currentAudioRxNet === "allstar" ? "allstar" : "dmr";
        window.audioPlayer.setRxAgcConfig({ enabled: en, depthDb: depth, gainRaw }, curNet);
      }
    }
    window.updateAgcUI = updateAgcUI;
    if (chkAgcEnable) chkAgcEnable.addEventListener("change", () => { updateAgcUI(); autoSaveCurrentState(); _scheduleSyncClientSettings(0); });
    if (sliderAgcDepth) {
      sliderAgcDepth.addEventListener("input", () => { updateAgcUI(); autoSaveCurrentState(); _scheduleSyncClientSettings(200); });
      sliderAgcDepth.addEventListener("change", () => { updateAgcUI(); autoSaveCurrentState(); _scheduleSyncClientSettings(0); });
    }
    if (sliderAgcGain) {
      sliderAgcGain.addEventListener("input", () => { updateAgcUI(); autoSaveCurrentState(); _scheduleSyncClientSettings(200); });
      sliderAgcGain.addEventListener("change", () => { updateAgcUI(); autoSaveCurrentState(); _scheduleSyncClientSettings(0); });
    }

    // Limiter UI Listener
    if (chkLimiterEnable) {
      chkLimiterEnable.addEventListener("change", () => {
        const curNet = _currentAudioRxNet === "allstar" ? "allstar" : "dmr";
        if (window.audioPlayer) {
          if (window.audioPlayer.dspProfiles && window.audioPlayer.dspProfiles[curNet]) {
            window.audioPlayer.dspProfiles[curNet].limiterEnabled = chkLimiterEnable.checked;
          }
          if ((!window.audioPlayer.activeProfileNet || window.audioPlayer.activeProfileNet === curNet) && typeof window.audioPlayer.setLimiterEnabled === "function") {
            window.audioPlayer.setLimiterEnabled(chkLimiterEnable.checked);
          }
        }
        autoSaveCurrentState();
        _scheduleSyncClientSettings(0);
      });
    }

    // Jitter Buffer UI Listeners (Network-isolated: ASL vs DMR)
    function updateJitterUI(ms) {
      const defMs = _currentAudioRxNet === "allstar" ? 240 : 180;
      const minMs = _currentAudioRxNet === "allstar" ? 180 : 60;
      const val = Math.max(minMs, Math.min(2000, parseInt(ms, 10) || defMs));
      if (sliderJitterBuffer) sliderJitterBuffer.value = val;
      if (valJitterBuffer) valJitterBuffer.textContent = `${val} ms`;
      const jitterKey = _currentAudioRxNet === "allstar" ? "proxdmr_asl_jitter_buffer_ms" : "proxdmr_jitter_buffer_ms";
      localStorage.setItem(jitterKey, val.toString());
      if (window.audioPlayer && (!window.audioPlayer.activeProfileNet || window.audioPlayer.activeProfileNet === (_currentAudioRxNet === "allstar" ? "allstar" : "dmr")) && typeof window.audioPlayer.setJitterBufferMs === "function") {
        window.audioPlayer.setJitterBufferMs(val);
      }
    }
    window.updateJitterUI = updateJitterUI;
    if (sliderJitterBuffer) {
      sliderJitterBuffer.addEventListener("input", () => {
        const v = parseInt(sliderJitterBuffer.value, 10) || 120;
        if (valJitterBuffer) valJitterBuffer.textContent = `${v} ms`;
        updateJitterUI(v);
        autoSaveCurrentState();
        _scheduleSyncClientSettings(200);
      });
      sliderJitterBuffer.addEventListener("change", () => {
        updateJitterUI(sliderJitterBuffer.value);
        autoSaveCurrentState();
        _scheduleSyncClientSettings(0);
      });
    }

    if (inputRxBoostDb) {
      const handleBoostChange = (e) => {
        const isInputEvt = e && e.type === "input";
        const safe = clampRxBoostDb(inputRxBoostDb.value);
        if (!isInputEvt) inputRxBoostDb.value = safe;
        localStorage.setItem("proxdmr_rx_boost_pct", safe.toString());
        if (window.audioPlayer && typeof window.audioPlayer.setRxBoostDb === "function") {
          window.audioPlayer.setRxBoostDb(safe);
        }
        autoSaveCurrentState();
        _scheduleSyncClientSettings(isInputEvt ? 200 : 0);
      };
      inputRxBoostDb.addEventListener("input", handleBoostChange);
      inputRxBoostDb.addEventListener("change", handleBoostChange);
      inputRxBoostDb.addEventListener("blur", handleBoostChange);
    }


    // Presets P1 - P3 Management
    let activeAudioRxPresetId = "1";

    function getAudioRxPresetData(id) {
      const defs = _currentAudioRxNet === "allstar" ? DEFAULT_ANALOG_RX_PRESETS : DEFAULT_PRESETS;
      const baseDef = defs[id] || defs["1"];
      const stored = localStorage.getItem(getPresetStorageKey("preset", id));
      if (stored) {
        try {
          const rawObj = JSON.parse(stored);
          const parsed = Object.assign({}, baseDef, rawObj);
          if (rawObj && rawObj.boostPct === undefined) {
            const legacyBoost = localStorage.getItem("proxdmr_rx_boost_pct");
            if (legacyBoost !== null) parsed.boostPct = clampRxBoostDb(legacyBoost);
          }
          if (_currentAudioRxNet === "allstar" && (!parsed.jitterBuffer || parsed.jitterBuffer < 180)) {
            parsed.jitterBuffer = baseDef.jitterBuffer || 240;
            localStorage.setItem(getPresetStorageKey("preset", id), JSON.stringify(parsed));
          }
          return parsed;
        } catch (_) {}
      }
      return baseDef;
    }

    function autoSaveCurrentState() {
      const currentGains = [];
      for (let i = 0; i < 10; i++) {
        const slider = document.getElementById(`eqSlider_${i}`);
        currentGains.push(slider ? parseInt(slider.value, 10) : DEFAULT_SPEECH_EQ[i]);
      }
      const data = {
        eq10Enable: chkEq10Enable ? chkEq10Enable.checked : true,
        eq10Linked: chkEq10Linked ? chkEq10Linked.checked : true,
        eq10Gains: currentGains,
        agcEnable: chkAgcEnable ? chkAgcEnable.checked : true,
        agcDepth: sliderAgcDepth ? parseInt(sliderAgcDepth.value, 10) : 18,
        agcGain: sliderAgcGain ? parseInt(sliderAgcGain.value, 10) : 45,
        limiterEnable: chkLimiterEnable ? chkLimiterEnable.checked : true,
        jitterBuffer: sliderJitterBuffer ? parseInt(sliderJitterBuffer.value, 10) : 120,
        boostPct: inputRxBoostDb ? clampRxBoostDb(inputRxBoostDb.value) : 50
      };
      localStorage.setItem(getPresetStorageKey("preset", activeAudioRxPresetId), JSON.stringify(data));
      localStorage.setItem(getPresetStorageKey("active"), activeAudioRxPresetId);
    }
    const autoSaveCurrentPreset = autoSaveCurrentState;

    function applyAudioRxPreset(id, skipRemoteSync = false) {
      activeAudioRxPresetId = String(id);
      const defs = _currentAudioRxNet === "allstar" ? DEFAULT_ANALOG_RX_PRESETS : DEFAULT_PRESETS;
      if (!defs[activeAudioRxPresetId]) activeAudioRxPresetId = "1";
      localStorage.setItem(getPresetStorageKey("active"), activeAudioRxPresetId);
      const data = getAudioRxPresetData(activeAudioRxPresetId);

      // 10-Band EQ
      const eqEnabled = data.eq10Enable !== undefined ? Boolean(data.eq10Enable) : (_currentAudioRxNet !== "allstar");
      if (chkEq10Enable) chkEq10Enable.checked = eqEnabled;
      if (chkEq10Linked) chkEq10Linked.checked = data.eq10Linked !== undefined ? Boolean(data.eq10Linked) : true;
      const defGains = _currentAudioRxNet === "allstar" ? DEFAULT_ANALOG_SPEECH_EQ : DEFAULT_SPEECH_EQ;
      const gains = Array.isArray(data.eq10Gains) && data.eq10Gains.length === 10 ? data.eq10Gains : defGains;
      for (let i = 0; i < 10; i++) {
        const slider = document.getElementById(`eqSlider_${i}`);
        if (slider) {
          slider.value = gains[i];
          _prevEqSliderVals[i] = gains[i];
        }
      }

      // AGC
      if (chkAgcEnable) chkAgcEnable.checked = data.agcEnable !== undefined ? Boolean(data.agcEnable) : true;
      if (sliderAgcDepth) sliderAgcDepth.value = data.agcDepth !== undefined ? data.agcDepth : 18;
      if (sliderAgcGain) sliderAgcGain.value = data.agcGain !== undefined ? data.agcGain : 45;

      // Limiter
      const limEn = data.limiterEnable !== undefined ? Boolean(data.limiterEnable) : true;
      if (chkLimiterEnable) chkLimiterEnable.checked = limEn;
      if (window.audioPlayer) {
        const curNet = _currentAudioRxNet === "allstar" ? "allstar" : "dmr";
        if (window.audioPlayer.dspProfiles && window.audioPlayer.dspProfiles[curNet]) {
          window.audioPlayer.dspProfiles[curNet].limiterEnabled = limEn;
        }
        if ((!window.audioPlayer.activeProfileNet || window.audioPlayer.activeProfileNet === curNet) && typeof window.audioPlayer.setLimiterEnabled === "function") {
          window.audioPlayer.setLimiterEnabled(limEn);
        }
      }

      // Jitter & Boost
      const jBuf = data.jitterBuffer !== undefined ? data.jitterBuffer : 120;
      updateJitterUI(jBuf);

      // Jitter & Boost (1..100%, default 50%)
      const storedBoost = localStorage.getItem("proxdmr_rx_boost_pct");
      const bPct = data.boostPct !== undefined 
        ? clampRxBoostDb(data.boostPct) 
        : (storedBoost !== null ? clampRxBoostDb(storedBoost) : 50);
      if (inputRxBoostDb) inputRxBoostDb.value = bPct;
      localStorage.setItem("proxdmr_rx_boost_pct", bPct.toString());
      if (window.audioPlayer && typeof window.audioPlayer.setRxBoostDb === "function") {
        window.audioPlayer.setRxBoostDb(bPct);
      }

      updateEqLabelsAndAudio();
      updateAgcUI();
      updateAudioRxPresetUI();
      if (!skipRemoteSync) {
        _scheduleSyncClientSettings(0);
      }
    }
    window.applyAudioRxPreset = applyAudioRxPreset;

    function saveCurrentToAudioRxPreset(id) {
      autoSaveCurrentState();
      _scheduleSyncClientSettings(0);

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
      const dmrPres = localStorage.getItem("proxdmr_audio_rx_active_preset") || "1";
      const aslPres = localStorage.getItem("proxdmr_asl_audio_rx_active_preset") || "1";
      audioRxPresetButtons.forEach(btn => {
        const pId = btn.getAttribute("data-audio-rx-preset");
        btn.classList.toggle("active", pId === activeAudioRxPresetId);
      });
      document.querySelectorAll(".radio-container, .hotspot-card").forEach(card => {
        const isCardAsl = card.classList.contains("card-net-allstar") || (card.getAttribute("data-network-type") || "").toLowerCase() === "allstar";
        const cardPres = isCardAsl ? aslPres : dmrPres;
        card.querySelectorAll(".btn-audio-rx-mini-preset .mini-preset-label").forEach(lbl => {
          lbl.textContent = `P${cardPres}`;
        });
        card.querySelectorAll(".audio-rx-menu .mini-preset-item").forEach(item => {
          const pId = item.getAttribute("data-audio-rx-preset");
          item.classList.toggle("active", pId === cardPres);
        });
      });
      document.querySelectorAll(".btn-audio-rx-mini-preset .mini-preset-label").forEach(lbl => {
        if (!lbl.closest(".radio-container, .hotspot-card")) lbl.textContent = `P${activeAudioRxPresetId}`;
      });
      document.querySelectorAll(".audio-rx-menu .mini-preset-item").forEach(item => {
        if (!item.closest(".radio-container, .hotspot-card")) {
          const pId = item.getAttribute("data-audio-rx-preset");
          item.classList.toggle("active", pId === activeAudioRxPresetId);
        }
      });
      if (saveAudioRxPresetText) {
        saveAudioRxPresetText.textContent = window.t ? window.t("audio_rx.btn_save_text", { id: activeAudioRxPresetId }) : `Сохранить в P${activeAudioRxPresetId}`;
      }
      if (saveAudioRxPresetBtn) {
        saveAudioRxPresetBtn.title = window.t ? window.t("audio_rx.btn_save_title", { id: activeAudioRxPresetId }) : `Сохранить текущие параметры звука в пресет ${activeAudioRxPresetId}`;
      }
    }
    window.updateAudioRxPresetUI = updateAudioRxPresetUI;

    audioRxPresetButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-audio-rx-preset");
        if (id) applyAudioRxPreset(id, false);
      });
    });

    if (saveAudioRxPresetBtn) {
      saveAudioRxPresetBtn.addEventListener("click", () => {
        saveCurrentToAudioRxPreset(activeAudioRxPresetId);
      });
    }

    const btnResetAudioRxDefaults = document.getElementById("btnResetAudioRxDefaults");
    if (btnResetAudioRxDefaults) {
      btnResetAudioRxDefaults.addEventListener("click", () => {
        const defs = _currentAudioRxNet === "allstar" ? DEFAULT_ANALOG_RX_PRESETS : DEFAULT_PRESETS;
        const fresh = defs[activeAudioRxPresetId] || defs["1"];
        localStorage.setItem(getPresetStorageKey("preset", activeAudioRxPresetId), JSON.stringify(fresh));
        applyAudioRxPreset(activeAudioRxPresetId, false);
      });
    }

    window.addEventListener("languageChanged", updateAudioRxPresetUI);

    // Initial setup on load - Guaranteed load active preset synchronized with active card!
    syncActiveAudioRxPreset();
  }

  // --- Microphone Management & Hardware Routing (APK: Bluetooth SCO, Browser: Any AudioInput) ---
  function isAndroidApkEnvironment() {
    return Boolean(
      typeof window !== "undefined" &&
      window.AndroidBridge &&
      typeof window.AndroidBridge.getConnectedBtMics === "function"
    );
  }

  async function queryConnectedBtMics() {
    if (isAndroidApkEnvironment()) {
      try {
        const raw = window.AndroidBridge.getConnectedBtMics();
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(d => ({ id: String(d.id), name: d.name || "Bluetooth Headset" }));
        }
      } catch (e) {
        console.warn("[BT] Failed to parse AndroidBridge getConnectedBtMics:", e);
      }
    }
    return [];
  }

  async function queryBrowserAudioInputs() {
    if (typeof navigator !== "undefined" && navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === "function") {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(d => d.kind === "audioinput");
        return inputs.map((d, idx) => ({
          id: d.deviceId || "",
          name: (d.label && d.label.trim()) ? d.label.trim() : `Microphone ${idx + 1}`
        }));
      } catch (err) {
        console.warn("[MIC] enumerateDevices error:", err);
      }
    }
    return [];
  }

  async function syncBtMicAvailability() {
    const isApk = isAndroidApkEnvironment();
    const apkRow = document.getElementById("txApkBtRow");
    const browserRow = document.getElementById("txBrowserMicRow");
    const chkTxBluetoothMic = document.getElementById("chkTxBluetoothMic");
    const txBtDeviceBadge = document.getElementById("txBtDeviceBadge");
    const selectTxBrowserMic = document.getElementById("selectTxBrowserMic");

    if (apkRow) apkRow.style.display = isApk ? "flex" : "none";
    if (browserRow) browserRow.style.display = isApk ? "none" : "flex";

    // 1. Ветка обычного браузера: заполняем выпадающий список всех доступных микрофонов
    if (!isApk) {
      if (!selectTxBrowserMic) return false;
      const inputs = await queryBrowserAudioInputs();
      const savedMicId = localStorage.getItem("proxdmr_tx_browser_mic_id") || "";
      const defLabel = (typeof window !== "undefined" && typeof window.t === "function")
        ? window.t("audio_tx.mic_default", {}, "По умолчанию (Системный)")
        : "По умолчанию (Системный)";

      selectTxBrowserMic.innerHTML = "";
      const defOpt = document.createElement("option");
      defOpt.value = "";
      defOpt.textContent = defLabel;
      selectTxBrowserMic.appendChild(defOpt);

      let foundSaved = false;
      inputs.forEach((inp) => {
        if (!inp.id || inp.id === "default") return;
        const opt = document.createElement("option");
        opt.value = inp.id;
        opt.textContent = inp.name;
        if (inp.id === savedMicId) {
          foundSaved = true;
        }
        selectTxBrowserMic.appendChild(opt);
      });

      selectTxBrowserMic.value = foundSaved ? savedMicId : "";
      return true;
    }

    // 2. Ветка Android APK: переключатель Bluetooth SCO
    if (!chkTxBluetoothMic) return false;
    const btDevices = await queryConnectedBtMics();
    const hasBt = Array.isArray(btDevices) && btDevices.length > 0;

    if (!hasBt) {
      chkTxBluetoothMic.checked = false;
      chkTxBluetoothMic.disabled = true;
      if (apkRow) {
        apkRow.style.opacity = "0.5";
        apkRow.style.cursor = "not-allowed";
        apkRow.title = window.t ? window.t("audio_tx.bt_not_connected_tip", {}, "Bluetooth-гарнитура с микрофоном не подключена") : "Bluetooth-гарнитура с микрофоном не подключена";
      }
      if (txBtDeviceBadge) txBtDeviceBadge.style.display = "none";
      if (window.AndroidBridge && typeof window.AndroidBridge.setBluetoothMicEnabled === "function") {
        window.AndroidBridge.setBluetoothMicEnabled(false, "");
      }
      return false;
    }

    chkTxBluetoothMic.disabled = false;
    if (apkRow) {
      apkRow.style.opacity = "1";
      apkRow.style.cursor = "pointer";
      apkRow.title = window.t ? window.t("audio_tx.bt_use_mic_tip", {}, "Использовать микрофон Bluetooth-гарнитуры для передачи") : "Использовать микрофон Bluetooth-гарнитуры для передачи";
    }

    const savedPref = localStorage.getItem("proxdmr_tx_bt_mic") === "true";
    chkTxBluetoothMic.checked = savedPref;

    if (savedPref) {
      const targetId = localStorage.getItem("proxdmr_tx_bt_mic_selected_id") || "";
      const dev = btDevices.find(d => d.id === targetId) || btDevices[0];
      if (dev) {
        localStorage.setItem("proxdmr_tx_bt_mic_selected_id", dev.id);
        if (window.AndroidBridge && typeof window.AndroidBridge.setBluetoothMicEnabled === "function") {
          window.AndroidBridge.setBluetoothMicEnabled(true, dev.id);
        }
        if (txBtDeviceBadge) {
          txBtDeviceBadge.textContent = `🎙️ ${dev.name}`;
          txBtDeviceBadge.style.display = "inline-block";
        }
      }
    } else {
      if (txBtDeviceBadge) txBtDeviceBadge.style.display = "none";
    }
    return true;
  }

  // Live-отслеживание подключения/отключения аудиоустройств
  if (typeof navigator !== "undefined" && navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === "function") {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      syncBtMicAvailability().catch(() => {});
    });
  }

  function showBtMicSelectorModal(btDevices, onSelectCallback) {
    const modal = document.getElementById("btMicSelectorModal");
    const listEl = document.getElementById("btMicDeviceList");
    const confirmBtn = document.getElementById("btnConfirmBtMic");
    const closeBtn = document.getElementById("closeBtMicModalBtn");
    if (!modal || !listEl) return;

    listEl.innerHTML = "";
    let selectedId = localStorage.getItem("proxdmr_tx_bt_mic_selected_id") || (btDevices[0] && btDevices[0].id) || "";

    btDevices.forEach((dev) => {
      const item = document.createElement("label");
      item.className = `bt-mic-device-item ${dev.id === selectedId ? "selected" : ""}`;
      item.innerHTML = `
        <input type="radio" name="bt_mic_radio" value="${dev.id}" ${dev.id === selectedId ? "checked" : ""}>
        <span class="bt-mic-device-name">${dev.name}</span>
      `;
      item.addEventListener("click", () => {
        selectedId = dev.id;
        listEl.querySelectorAll(".bt-mic-device-item").forEach(it => it.classList.remove("selected"));
        item.classList.add("selected");
      });
      listEl.appendChild(item);
    });

    const closeModal = () => {
      modal.style.display = "none";
    };

    if (closeBtn) closeBtn.onclick = closeModal;
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        localStorage.setItem("proxdmr_tx_bt_mic_selected_id", selectedId);
        sessionStorage.setItem("proxdmr_bt_mic_prompt_shown", "true");
        closeModal();
        if (typeof onSelectCallback === "function") onSelectCallback(selectedId);
      };
    }

    modal.style.display = "flex";
  }

  let _currentAudioTxNet = "dmr";
  let _currentAudioTxHid = null;

  function getTxPrefix() {
    return _currentAudioTxNet === "allstar" ? "proxdmr_asl_tx_" : "proxdmr_tx_";
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
    const chkTxBluetoothMic = document.getElementById("chkTxBluetoothMic");
    const txBtDeviceBadge = document.getElementById("txBtDeviceBadge");
    const selectTxBrowserMic = document.getElementById("selectTxBrowserMic");
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
    const sliderTxEqLow = document.getElementById("sliderTxEqLow");
    const valTxEqLow = document.getElementById("valTxEqLow");
    const sliderTxEqMid = document.getElementById("sliderTxEqMid");
    const valTxEqMid = document.getElementById("valTxEqMid");
    const sliderTxEqHigh = document.getElementById("sliderTxEqHigh");
    const valTxEqHigh = document.getElementById("valTxEqHigh");

    let _txModalMeterAnimId = null;
    let _lastMeterLevel = 0;

    function startTxMicModalMeter() {
      stopTxMicModalMeter();
      const meterBar = document.getElementById("txMicMeterBar");
      const clipLabel = document.getElementById("txMicMeterClip");
      const clipLed = document.getElementById("txMicMeterClipLed") || (audioTxModal ? audioTxModal.querySelector(".tx-meter-clip") : null);
      if (!meterBar) return;

      _lastMeterLevel = 0;

      function renderMeter() {
        let peakVal = 0;
        if (window.analyserNode && (window.isPttPressed || window.isParrotTestRecording || window.micStream)) {
          const timeBuf = new Float32Array(window.analyserNode.fftSize);
          window.analyserNode.getFloatTimeDomainData(timeBuf);
          for (let i = 0; i < timeBuf.length; i++) {
            const absVal = Math.abs(timeBuf[i]);
            if (absVal > peakVal) peakVal = absVal;
          }
        }

        // Чувствительность регулятора Mic Gain напрямую влияет на показания индикатора
        const sliderGain = document.getElementById("sliderTxMicGain");
        const gainDb = sliderGain ? (parseFloat(sliderGain.value) || 0) : 0;
        const gainLinear = Math.pow(10, gainDb / 20.0);
        const scaledPeak = peakVal * gainLinear;

        // Логарифмический диапазон (-50 dBFS .. 0 dBFS -> 0% .. 100%)
        const db = 20 * Math.log10(Math.max(scaledPeak, 1e-3));
        let instantPercent = Math.max(0, Math.min(100, ((db + 50) / 50) * 100));

        // Баллистика PPM: мгновенная атака (0 мс), плавный экспоненциальный спад (0.92)
        if (instantPercent >= _lastMeterLevel) {
          _lastMeterLevel = instantPercent;
        } else {
          _lastMeterLevel = Math.max(0, _lastMeterLevel * 0.92);
        }

        const currentPct = Math.round(_lastMeterLevel);
        meterBar.style.width = `${currentPct}%`;

        const isClipping = (scaledPeak >= 0.95 || _lastMeterLevel >= 96);
        meterBar.classList.toggle("is-clipping", isClipping);

        if (clipLabel) {
          if (isClipping) {
            clipLabel.textContent = "CLIP 0 dBFS";
            clipLabel.style.color = "#f85149";
          } else if (scaledPeak > 0.003) {
            clipLabel.textContent = `${db.toFixed(1)} dBFS`;
            clipLabel.style.color = currentPct > 75 ? "#e3b341" : "#8b949e";
          } else {
            clipLabel.textContent = "-∞ dBFS";
            clipLabel.style.color = "#8b949e";
          }
        }

        if (clipLed) {
          if (isClipping) {
            clipLed.classList.add("active");
            if (window._clipHoldTimer) clearTimeout(window._clipHoldTimer);
            window._clipHoldTimer = setTimeout(() => {
              clipLed.classList.remove("active");
              window._clipHoldTimer = null;
            }, 800);
          }
        }

        _txModalMeterAnimId = requestAnimationFrame(renderMeter);
      }
      renderMeter();
    }

    function stopTxMicModalMeter() {
      if (_txModalMeterAnimId) {
        cancelAnimationFrame(_txModalMeterAnimId);
        _txModalMeterAnimId = null;
      }
      _lastMeterLevel = 0;
      if (window._clipHoldTimer) {
        clearTimeout(window._clipHoldTimer);
        window._clipHoldTimer = null;
      }
      const meterBar = document.getElementById("txMicMeterBar");
      if (meterBar) {
        meterBar.style.width = "0%";
        meterBar.classList.remove("is-clipping");
      }
      const clipLabel = document.getElementById("txMicMeterClip");
      if (clipLabel) {
        clipLabel.textContent = "-∞ dBFS";
        clipLabel.style.color = "#8b949e";
      }
      const clipLed = document.getElementById("txMicMeterClipLed") || (audioTxModal ? audioTxModal.querySelector(".tx-meter-clip") : null);
      if (clipLed) clipLed.classList.remove("active");
      const parrotBar = document.getElementById("txParrotProgressBar");
      if (parrotBar) {
        parrotBar.style.transition = "none";
        parrotBar.style.width = "0%";
        void parrotBar.offsetWidth;
        parrotBar.style.transition = "";
      }
    }

    function openModal() {
      if (audioTxModal) {
        if (typeof window.closePrimaryModals === "function") {
          window.closePrimaryModals("audioTxModal");
        }
        audioTxModal.style.display = "flex";
        audioTxModal.classList.add("active");
        _pushNavState("modal", "audioTxModal");
      }
    }

    function closeModal() {
      if (audioTxModal && (audioTxModal.classList.contains("active") || audioTxModal.style.display === "flex")) {
        audioTxModal.classList.remove("active");
        audioTxModal.style.display = "";
        stopTxMicModalMeter();
        stopParrotPlayback();
        releaseMicrophone();
        _notifyNavClosed();
      }
    }
    window.closeAudioTxModal = closeModal;

    _currentAudioTxNet = "dmr";
    _currentAudioTxHid = null;

    async function updateBtMicRouting() {
      if (!isAndroidApkEnvironment()) return;
      const isBtEnabled = chkTxBluetoothMic ? chkTxBluetoothMic.checked : false;

      if (isBtEnabled) {
        const btDevices = await queryConnectedBtMics();
        if (!btDevices || btDevices.length === 0) {
          if (chkTxBluetoothMic) {
            chkTxBluetoothMic.checked = false;
            chkTxBluetoothMic.disabled = true;
          }
          if (txBtDeviceBadge) txBtDeviceBadge.style.display = "none";
          localStorage.setItem("proxdmr_tx_bt_mic", "false");
          if (typeof window.showToast === "function") {
            window.showToast(window.t ? window.t("audio_tx.bt_not_found_toast", {}, "⚠️ Bluetooth-гарнитура с микрофоном не обнаружена") : "⚠️ Bluetooth-гарнитура с микрофоном не обнаружена", 3000);
          }
          return;
        }

        const targetId = localStorage.getItem("proxdmr_tx_bt_mic_selected_id") || "";
        if (btDevices.length > 1) {
          const promptShown = sessionStorage.getItem("proxdmr_bt_mic_prompt_shown") === "true";
          if (!promptShown) {
            showBtMicSelectorModal(btDevices, async (chosenId) => {
              await applyBtMicDevice(chosenId, btDevices);
            });
            return;
          }
        }

        const activeDev = btDevices.find(d => d.id === targetId) || btDevices[0];
        await applyBtMicDevice(activeDev ? activeDev.id : "", btDevices);
      } else {
        localStorage.setItem("proxdmr_tx_bt_mic", "false");
        if (typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.setBluetoothMicEnabled === "function") {
          window.AndroidBridge.setBluetoothMicEnabled(false, "");
        }
        if (txBtDeviceBadge) txBtDeviceBadge.style.display = "none";
        releaseMicrophone();
        if (typeof initAudio === "function") {
          await initAudio();
        }
        startTxMicModalMeter();
      }
    }

    async function applyBtMicDevice(deviceId, btDevices) {
      const dev = (btDevices && btDevices.find(d => d.id === deviceId)) || (btDevices && btDevices[0]);
      const targetId = dev ? dev.id : deviceId;

      if (targetId) {
        localStorage.setItem("proxdmr_tx_bt_mic_selected_id", targetId);
      }
      localStorage.setItem("proxdmr_tx_bt_mic", "true");

      if (typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.setBluetoothMicEnabled === "function") {
        window.AndroidBridge.setBluetoothMicEnabled(true, targetId);
      }
      if (txBtDeviceBadge) {
        if (dev) {
          txBtDeviceBadge.textContent = `🎙️ ${dev.name}`;
          txBtDeviceBadge.style.display = "inline-block";
        } else {
          txBtDeviceBadge.textContent = window.t ? window.t("audio_tx.bt_connected_badge", {}, "🎙️ Bluetooth connected") : "🎙️ Bluetooth connected";
          txBtDeviceBadge.style.display = "inline-block";
        }
      }

      autoSaveCurrentTxState(false, true);
      releaseMicrophone();
      if (typeof initAudio === "function") {
        await initAudio();
      }
      startTxMicModalMeter();
    }

    let activeAudioTxPresetId = "1";
    let _currentActiveTxEqPreset = "standard";

    function autoSaveCurrentTxState(skipRemoteSync = false, immediate = false) {
      const pfx = getTxPrefix();
      const mgVal = sliderTxMicGain ? (parseFloat(sliderTxMicGain.value) || 0) : 0;
      const btVal = (chkTxBluetoothMic && !chkTxBluetoothMic.disabled)
        ? chkTxBluetoothMic.checked
        : (localStorage.getItem(`${pfx}bt_mic`) === "true" || localStorage.getItem("proxdmr_tx_bt_mic") === "true");
      const nsVal = chkTxNoiseSuppression ? chkTxNoiseSuppression.checked : false;
      const agcVal = chkTxBrowserAgc ? chkTxBrowserAgc.checked : false;
      const dspAgcVal = chkTxDspAgc ? chkTxDspAgc.checked : false;
      const aecVal = chkTxEchoCancellation ? chkTxEchoCancellation.checked : false;
      const gateEn = chkTxGate ? chkTxGate.checked : true;
      const gateThr = sliderTxGate ? (parseFloat(sliderTxGate.value) || -45) : -45;
      const hpfVal = chkTxHpf ? chkTxHpf.checked : true;
      const presVal = sliderTxPresence ? (parseFloat(sliderTxPresence.value) || 0) : 0;
      const eqLowVal = sliderTxEqLow ? (parseFloat(sliderTxEqLow.value) || 0) : 0;
      const eqMidVal = sliderTxEqMid ? (parseFloat(sliderTxEqMid.value) || 0) : 0;
      const eqHighVal = sliderTxEqHigh ? (parseFloat(sliderTxEqHigh.value) || 0) : 0;
      const eqPresetVal = _currentActiveTxEqPreset || "standard";

      // 1. Плоские ключи с префиксом сети (proxdmr_tx_ / proxdmr_asl_tx_)
      localStorage.setItem(`${pfx}mic_gain`, mgVal.toString());
      localStorage.setItem(`${pfx}bt_mic`, btVal.toString());
      localStorage.setItem(`${pfx}ns`, nsVal.toString());
      localStorage.setItem(`${pfx}agc`, agcVal.toString());
      localStorage.setItem(`${pfx}dsp_agc`, dspAgcVal.toString());
      localStorage.setItem(`${pfx}aec`, aecVal.toString());
      localStorage.setItem(`${pfx}gate_enabled`, gateEn.toString());
      localStorage.setItem(`${pfx}gate_threshold`, gateThr.toString());
      localStorage.setItem(`${pfx}hpf`, hpfVal.toString());
      localStorage.setItem(`${pfx}presence`, presVal.toString());
      localStorage.setItem(`${pfx}eq_low`, eqLowVal.toString());
      localStorage.setItem(`${pfx}eq_mid`, eqMidVal.toString());
      localStorage.setItem(`${pfx}eq_high`, eqHighVal.toString());
      localStorage.setItem(`${pfx}eq_preset`, eqPresetVal);

      // 2. Мгновенная запись в текущий активный пресет
      const presetData = {
        txBtMicEnabled: btVal,
        txMicGain: mgVal,
        txNoiseSuppression: nsVal,
        txBrowserAgc: agcVal,
        txDspAgc: dspAgcVal,
        txEchoCancellation: aecVal,
        txGateEnabled: gateEn,
        txGateThreshold: gateThr,
        txHpfEnabled: hpfVal,
        txPresenceBoost: presVal,
        txEqLow: eqLowVal,
        txEqMid: eqMidVal,
        txEqHigh: eqHighVal,
        txEqPreset: eqPresetVal
      };
      localStorage.setItem(getTxPresetStorageKey("preset", activeAudioTxPresetId), JSON.stringify(presetData));
      localStorage.setItem(getTxPresetStorageKey("active"), activeAudioTxPresetId);

      if (!skipRemoteSync) {
        _scheduleSyncClientSettings(immediate ? 0 : 200);
      }
    }
    const saveTxSettingsToStorage = autoSaveCurrentTxState;

    const defaultAnalogTxPresets = {
      1: { txBtMicEnabled: false, txMicGain: 0, txNoiseSuppression: false, txBrowserAgc: false, txDspAgc: true, txEchoCancellation: false, txGateEnabled: true, txGateThreshold: -45, txHpfEnabled: true, txPresenceBoost: 0, txEqLow: 0, txEqMid: 0, txEqHigh: 0 },
      2: { txBtMicEnabled: false, txMicGain: 2, txNoiseSuppression: false, txBrowserAgc: false, txDspAgc: true, txEchoCancellation: false, txGateEnabled: true, txGateThreshold: -42, txHpfEnabled: true, txPresenceBoost: 2, txEqLow: 3, txEqMid: -1, txEqHigh: 2 },
      3: { txBtMicEnabled: false, txMicGain: 3, txNoiseSuppression: false, txBrowserAgc: false, txDspAgc: true, txEchoCancellation: false, txGateEnabled: true, txGateThreshold: -40, txHpfEnabled: true, txPresenceBoost: 4, txEqLow: -2, txEqMid: 1, txEqHigh: 4 },
      4: { txBtMicEnabled: false, txMicGain: 4, txNoiseSuppression: false, txBrowserAgc: false, txDspAgc: true, txEchoCancellation: false, txGateEnabled: true, txGateThreshold: -38, txHpfEnabled: true, txPresenceBoost: 6, txEqLow: -4, txEqMid: 4, txEqHigh: 5 },
      5: { txBtMicEnabled: false, txMicGain: 0, txNoiseSuppression: false, txBrowserAgc: false, txDspAgc: true, txEchoCancellation: false, txGateEnabled: true, txGateThreshold: -45, txHpfEnabled: true, txPresenceBoost: 0, txEqLow: 0, txEqMid: 0, txEqHigh: 0 }
    };

    function getTxPresetStorageKey(type, id) {
      const prefix = _currentAudioTxNet === "allstar" ? "proxdmr_asl_audio_tx" : "proxdmr_audio_tx";
      return type === "active" ? `${prefix}_active_preset` : `${prefix}_preset_${id}`;
    }

    document.addEventListener("click", (e) => {
      const trigger = e.target.closest(".btn-audio-tx-trigger") || (e.target.id === "btnAudioTxMain" ? e.target : null);
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        const card = trigger.closest(".radio-container") || trigger.closest(".hotspot-card");
        const isAsl = card && (card.classList.contains("card-net-allstar") || card.getAttribute("data-network-type") === "allstar");
        _currentAudioTxNet = isAsl ? "allstar" : "dmr";
        _currentAudioTxHid = (card && card.dataset && card.dataset.hotspotId) || null;

        // Обновление заголовка
        const modalTitle = audioTxModal ? audioTxModal.querySelector(".modal-title, h3") : null;
        const oldTxBadge = audioTxModal ? audioTxModal.querySelector(".badge-audio-mode") : null;
        if (oldTxBadge) oldTxBadge.remove();
        if (modalTitle) {
          const titleKey = isAsl ? "audio_tx.modal_title_analog" : "audio_tx.modal_title";
          const titleDef = isAsl ? "Audio TX Settings (Analog)" : "Audio TX Settings";
          modalTitle.textContent = window.t ? window.t(titleKey, {}, titleDef) : titleDef;
        }

        // In both modes (DMR and ASL) presets, Mic Gain, Gate, DSP compressor and 3-band EQ are available
        const sections = audioTxModal ? audioTxModal.querySelectorAll(".audio-section, .dsp-section") : [];
        sections.forEach((sec) => {
          sec.style.display = "";
        });

        openModal();
        const curPres = localStorage.getItem(getTxPresetStorageKey("active")) || "1";
        applyAudioTxPreset(curPres, true);
        (async () => {
          try {
            if (!window.micStream && typeof initAudio === "function") {
              await initAudio();
            }
          } catch (_) {}
          await syncBtMicAvailability().catch(() => {});
          startTxMicModalMeter();
        })();
      }
    });

    const expertDrawer = document.getElementById("audioTxExpertDrawer");
    const closeExpertBtn = document.getElementById("btnCloseExpertDrawer");
    if (closeExpertBtn && expertDrawer) {
      closeExpertBtn.addEventListener("click", () => expertDrawer.classList.remove("active"));
    }

    let closeLongPressTimer = null;
    let isLongPressFired = false;
    if (closeBtn) {
      closeBtn.addEventListener("pointerdown", () => {
        isLongPressFired = false;
        closeLongPressTimer = setTimeout(() => {
          isLongPressFired = true;
          if (expertDrawer) {
            expertDrawer.classList.toggle("active");
            if (navigator.vibrate) navigator.vibrate(60);
          }
        }, 1000);
      });
      closeBtn.addEventListener("pointerup", (e) => {
        if (closeLongPressTimer) clearTimeout(closeLongPressTimer);
        if (isLongPressFired) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        closeModal();
        if (typeof window.flushPendingClientSettingsSync === "function") {
          window.flushPendingClientSettingsSync();
        }
      });
      closeBtn.addEventListener("pointercancel", () => {
        if (closeLongPressTimer) clearTimeout(closeLongPressTimer);
      });
    }
    if (closeBottomBtn) closeBottomBtn.addEventListener("click", () => {
      saveTxSettingsToStorage(false, true);
      applyTxDspSettings(true);
      closeModal();
    });
    if (audioTxModal) {
      audioTxModal.addEventListener("click", (e) => {
        if (e.target === audioTxModal) {
          closeModal();
          if (typeof window.flushPendingClientSettingsSync === "function") {
            window.flushPendingClientSettingsSync();
          }
        }
      });
    }

    function updateTxBadges() {
      const u = window.t ? window.t("audio.unit_db", {}, "dB") : "dB";
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
      if (sliderTxEqLow && valTxEqLow) {
        valTxEqLow.textContent = `${sliderTxEqLow.value} ${u}`;
      }
      if (sliderTxEqMid && valTxEqMid) {
        const v = parseFloat(sliderTxEqMid.value) || 0;
        valTxEqMid.textContent = `${v > 0 ? "+" : ""}${v} ${u}`;
      }
      if (sliderTxEqHigh && valTxEqHigh) {
        const v = parseFloat(sliderTxEqHigh.value) || 0;
        valTxEqHigh.textContent = `${v > 0 ? "+" : ""}${v} ${u}`;
      }
    }
    window.refreshDspPresetLocalization = function () {
      if (typeof window.updateAgcUI === "function") window.updateAgcUI();
      updateTxBadges();
      if (typeof window.updateAudioRxPresetUI === "function") window.updateAudioRxPresetUI();
      if (typeof window.updateAudioTxPresetUI === "function") window.updateAudioTxPresetUI();
    };



    const onTxControlChange = (e) => {
      const isImmediate = !e || e.type !== "input";
      updateTxBadges();
      saveTxSettingsToStorage(false, isImmediate);
      applyTxDspSettings(true);
    };

    if (sliderTxMicGain) {
      sliderTxMicGain.addEventListener("input", onTxControlChange);
      sliderTxMicGain.addEventListener("change", onTxControlChange);
    }
    if (chkTxBluetoothMic) {
      chkTxBluetoothMic.addEventListener("change", () => {
        updateBtMicRouting();
        autoSaveCurrentTxState(false, true);
      });
    }
    if (selectTxBrowserMic) {
      selectTxBrowserMic.addEventListener("change", async () => {
        const chosenMicId = selectTxBrowserMic.value || "";
        localStorage.setItem("proxdmr_tx_browser_mic_id", chosenMicId);
        _scheduleSyncClientSettings(0);
        releaseMicrophone();
        if (typeof initAudio === "function") {
          await initAudio();
        }
        await syncBtMicAvailability().catch(() => {});
        startTxMicModalMeter();
      });
    }
    if (chkTxNoiseSuppression) {
      chkTxNoiseSuppression.addEventListener("change", () => {
        saveTxSettingsToStorage(false, true);
        updateMicTrackConstraints();
      });
    }
    if (chkTxBrowserAgc) {
      chkTxBrowserAgc.addEventListener("change", () => {
        saveTxSettingsToStorage(false, true);
        updateMicTrackConstraints();
      });
    }
    if (chkTxDspAgc) {
      chkTxDspAgc.addEventListener("change", onTxControlChange);
    }
    if (chkTxEchoCancellation) {
      chkTxEchoCancellation.addEventListener("change", () => {
        saveTxSettingsToStorage(false, true);
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

    const eqPresetButtons = document.querySelectorAll(".btn-tx-eq-preset");

    function setEqPresetActive(presetKey, skipRemoteSync = false, immediate = false) {
      eqPresetButtons.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.eqPreset === presetKey);
      });
      _currentActiveTxEqPreset = presetKey;
      autoSaveCurrentTxState(skipRemoteSync, immediate);
    }

    eqPresetButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const pKey = btn.dataset.eqPreset;
        const vals = defaultEqPresets[pKey];
        if (vals) {
          const u = window.t ? window.t("audio.unit_db", {}, "dB") : "dB";
          if (sliderTxEqLow) { sliderTxEqLow.value = vals.low; if (valTxEqLow) valTxEqLow.textContent = `${vals.low} ${u}`; }
          if (sliderTxEqMid) { sliderTxEqMid.value = vals.mid; if (valTxEqMid) valTxEqMid.textContent = `${vals.mid > 0 ? "+" : ""}${vals.mid} ${u}`; }
          if (sliderTxEqHigh) { sliderTxEqHigh.value = vals.high; if (valTxEqHigh) valTxEqHigh.textContent = `${vals.high > 0 ? "+" : ""}${vals.high} ${u}`; }
          setEqPresetActive(pKey, false, true);
          applyTxDspSettings(true);
        }
      });
    });

    const onEqSliderInput = (e) => {
      const isImmediate = !e || e.type !== "input";
      const u = window.t ? window.t("audio.unit_db", {}, "dB") : "dB";
      if (valTxEqLow && sliderTxEqLow) valTxEqLow.textContent = `${sliderTxEqLow.value} ${u}`;
      if (valTxEqMid && sliderTxEqMid) valTxEqMid.textContent = `${sliderTxEqMid.value > 0 ? "+" : ""}${sliderTxEqMid.value} ${u}`;
      if (valTxEqHigh && sliderTxEqHigh) valTxEqHigh.textContent = `${sliderTxEqHigh.value > 0 ? "+" : ""}${sliderTxEqHigh.value} ${u}`;
      setEqPresetActive("custom", false, isImmediate);
      applyTxDspSettings(true);
    };

    if (sliderTxEqLow) {
      sliderTxEqLow.addEventListener("input", onEqSliderInput);
      sliderTxEqLow.addEventListener("change", onEqSliderInput);
    }
    if (sliderTxEqMid) {
      sliderTxEqMid.addEventListener("input", onEqSliderInput);
      sliderTxEqMid.addEventListener("change", onEqSliderInput);
    }
    if (sliderTxEqHigh) {
      sliderTxEqHigh.addEventListener("input", onEqSliderInput);
      sliderTxEqHigh.addEventListener("change", onEqSliderInput);
    }

    // --- Parrot Test Button Setup (Trigger PTT, 30s Countdown, Progress Bar & Audio Fix) ---
    const PARROT_RECORD_DURATION_MS = 30000;
    const btnParrotTest = document.getElementById("btnParrotTest");
    const parrotTestText = document.getElementById("parrotTestText");
    const txParrotProgressBar = document.getElementById("txParrotProgressBar");
    let _parrotState = "idle"; // "idle" | "starting" | "recording" | "waiting" | "playing"
    let _parrotCountdownInterval = null;
    let _parrotRemainingSec = 30;
    let _parrotRecordStartMs = 0;

    function _triggerParrotHaptic(duration = 40) {
      try {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate(duration);
        }
      } catch (_) {}
    }

    function _setParrotProgress(percent) {
      const bar = txParrotProgressBar || document.getElementById("txParrotProgressBar");
      if (!bar) return;
      const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
      if (clamped <= 0) {
        bar.style.transition = "none";
        bar.style.width = "0%";
        void bar.offsetWidth;
        bar.style.transition = "";
      } else {
        bar.style.width = `${clamped.toFixed(1)}%`;
      }
    }

    function _setParrotButtonUI(state, titleText) {
      if (!btnParrotTest) return;
      btnParrotTest.classList.remove("recording", "waiting", "playing");
      if (state !== "idle") {
        btnParrotTest.classList.add(state);
      }
      if (titleText) {
        btnParrotTest.title = titleText;
      }
    }

    async function handleParrotTestClick() {
      // 1. Если идет воспроизведение — клик прерывает воспроизведение
      if (_parrotState === "playing") {
        stopParrotPlayback();
        return;
      }

      // 2. Если идет запись микрофона — повторный клик останавливает запись (переход к ожиданию)
      if (_parrotState === "recording") {
        stopParrotRecording();
        return;
      }

      // 3. Если уже ждем сервер — игнорируем клик
      if (_parrotState === "waiting" || _parrotState === "starting") {
        return;
      }

      // 4. Старт: переводим в статус starting и инициализируем микрофон
      _parrotState = "starting";
      _setParrotProgress(0);
      _setParrotButtonUI("waiting", window.t ? window.t("audio_tx.parrot_starting", {}, "Подготовка...") : "Подготовка...");

      // Гарантируем захват микрофона до отправки parrot_test_start
      if (!window.micStream && typeof initAudio === "function") {
        try {
          await initAudio();
        } catch (e) {
          console.warn("[PARROT] Mic initialization error:", e);
        }
      }

      startTxMicModalMeter();

      if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
          type: "parrot_test_start",
          network: _currentAudioTxNet || "dmr",
          hotspot_id: _currentAudioTxHid || window.activeHotspotId || "default"
        }));
      } else {
        stopParrotPlayback();
      }
    }

    function onParrotServerReady() {
      if (_parrotState !== "starting" && _parrotState !== "idle") return;
      _parrotState = "recording";
      window.isParrotTestRecording = true;
      window.isParrotActive = true;

      // Обязательно активируем ворклет микрофона перед захватом
      if (window.workletNode && window.workletNode.port) {
        window.workletNode.port.postMessage({ command: "set_active", active: true });
      }
      if (window.micStream) {
        window.micStream.getAudioTracks().forEach(t => { t.enabled = true; });
      }

      _triggerParrotHaptic(40);
      _parrotRecordStartMs = Date.now();
      _parrotRemainingSec = 30;
      let lastShownSec = 30;
      _setParrotProgress(0);
      _setParrotButtonUI("recording", window.t ? window.t("audio_tx.parrot_recording", { sec: _parrotRemainingSec }, `Запись (${_parrotRemainingSec} сек)... Кликните для остановки`) : `Запись (${_parrotRemainingSec} сек)... Кликните для остановки`);

      clearInterval(_parrotCountdownInterval);
      _parrotCountdownInterval = setInterval(() => {
        const elapsedMs = Math.max(0, Date.now() - _parrotRecordStartMs);
        const progressPct = Math.min(100, (elapsedMs / PARROT_RECORD_DURATION_MS) * 100);
        _setParrotProgress(progressPct);

        const secLeft = Math.max(0, Math.ceil((PARROT_RECORD_DURATION_MS - elapsedMs) / 1000));
        if (elapsedMs >= PARROT_RECORD_DURATION_MS || secLeft <= 0) {
          _parrotRemainingSec = 0;
          _setParrotProgress(100);
          clearInterval(_parrotCountdownInterval);
          _parrotCountdownInterval = null;
          stopParrotRecording();
        } else if (secLeft !== lastShownSec) {
          lastShownSec = secLeft;
          _parrotRemainingSec = secLeft;
          _setParrotButtonUI("recording", window.t ? window.t("audio_tx.parrot_recording", { sec: _parrotRemainingSec }, `Запись (${_parrotRemainingSec} сек)... Кликните для остановки`) : `Запись (${_parrotRemainingSec} сек)... Кликните для остановки`);
        }
      }, 100);
    }

    function stopParrotRecording() {
      if (_parrotState !== "recording" && _parrotState !== "starting") return;
      clearInterval(_parrotCountdownInterval);
      _parrotCountdownInterval = null;
      window.isParrotTestRecording = false;
      _setParrotProgress(0);

      // Деактивируем захват ворклета микрофона
      if (window.workletNode && window.workletNode.port) {
        window.workletNode.port.postMessage({ command: "set_active", active: false });
      }

      // Мгновенно освобождаем микрофон ОС после окончания записи
      releaseMicrophone();

      _parrotState = "waiting";
      _setParrotButtonUI("waiting", window.t ? window.t("audio_tx.parrot_waiting", {}, "Ожидание ответа с сервера...") : "Ожидание ответа с сервера...");

      if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
          type: "parrot_test_stop"
        }));
      }
    }

    function onParrotPlaybackStart() {
      _parrotState = "playing";
      clearInterval(_parrotCountdownInterval);
      _parrotCountdownInterval = null;
      window.isParrotTestRecording = false;
      window.isParrotActive = true;
      _setParrotProgress(0);

      _triggerParrotHaptic(40);
      _setParrotButtonUI("playing", window.t ? window.t("audio_tx.parrot_playing", {}, "Воспроизведение ответа попугая...") : "Воспроизведение ответа попугая...");

      // Гарантированно сбрасываем pttMuted и возобновляем AudioContext для воспроизведения
      if (window.audioPlayer) {
        if (typeof window.audioPlayer.setPttMuted === "function") {
          window.audioPlayer.setPttMuted(false);
        }
        if (typeof window.audioPlayer.ensureInitialized === "function") {
          window.audioPlayer.ensureInitialized();
        }
        if (window.audioPlayer.audioCtx && window.audioPlayer.audioCtx.state === "suspended") {
          window.audioPlayer.audioCtx.resume().catch(() => {});
        }
        const effectiveHid = _currentAudioTxHid || (typeof window.resolveHotspotId === "function" ? window.resolveHotspotId("default") : (window.activeHotspotId || "default"));
        if (typeof window.audioPlayer.setHotspotMute === "function" && window.audioPlayer.isHotspotMuted && window.audioPlayer.isHotspotMuted(effectiveHid)) {
          window.audioPlayer.setHotspotMute(effectiveHid, false);
        }
        if (typeof window.audioPlayer.setSlotMute === "function" && window.audioPlayer.isSlotMuted && window.audioPlayer.isSlotMuted(effectiveHid, 1)) {
          window.audioPlayer.setSlotMute(effectiveHid, 1, false);
        }
      }
      window.isPttMuteActive = false;
      if (window.pttMuteReleaseTimer) {
        clearTimeout(window.pttMuteReleaseTimer);
        window.pttMuteReleaseTimer = null;
      }
    }

    function stopParrotPlayback() {
      clearInterval(_parrotCountdownInterval);
      _parrotCountdownInterval = null;
      _parrotState = "idle";
      window.isParrotTestRecording = false;
      window.isParrotActive = false;
      _setParrotProgress(0);
      releaseMicrophone();
      _setParrotButtonUI("idle", window.t ? window.t("audio_tx.parrot_test_title", {}, "Эхо-тест попугая: клик — запись, ответ — воспроизведение") : "Эхо-тест попугая: клик — запись, ответ — воспроизведение");

      const targetHid = (typeof window.resolveHotspotId === "function")
        ? window.resolveHotspotId("default")
        : (window.activeHotspotId || "default");

      if (window.audioPlayer && window.audioPlayer.workletNode) {
        try {
          window.audioPlayer.workletNode.port.postMessage({
            type: "tx_ended",
            hotspotId: targetHid,
            slot: 1
          });
        } catch (_) {}
      }

      if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
          type: "parrot_test_cancel"
        }));
      }
    }

    if (btnParrotTest) {
      btnParrotTest.addEventListener("click", (e) => {
        e.preventDefault();
        handleParrotTestClick();
      });
    }

    window.onParrotTestMessage = (msg) => {
      if (msg.type === "parrot_test_ready") {
        onParrotServerReady();
      } else if (msg.type === "parrot_playback_start") {
        onParrotPlaybackStart();
      } else if (msg.type === "parrot_audio_chunk" && msg.pcm) {
        if (_parrotState !== "playing") {
          onParrotPlaybackStart();
        }
        try {
          const binaryStr = atob(msg.pcm);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const targetHid = _currentAudioTxHid || (typeof window.resolveHotspotId === "function"
            ? window.resolveHotspotId("default")
            : (window.activeHotspotId || "default"));

          if (window.audioPlayer && typeof window.audioPlayer.feed === "function") {
            window.audioPlayer.feed(bytes.buffer, targetHid, 1);
          }
        } catch (e) {
          console.warn("[PARROT] Audio chunk decode error:", e);
        }
      } else if (msg.type === "parrot_test_done") {
        stopParrotPlayback();
      }
    };

    const audioTxPresetButtons = document.querySelectorAll(".btn-audio-tx-preset");
    const saveAudioTxPresetBtn = document.getElementById("btnSaveAudioTxPreset");
    const saveAudioTxPresetText = document.getElementById("saveAudioTxPresetText");

    const defaultEqPresets = {
      standard: { low: 0, mid: 0, high: 0 },
      baritone: { low: -3, mid: 1, high: 1 },
      bright:   { low: -3, mid: 1, high: 3 },
      dx:       { low: -6, mid: 3, high: 3 },
      custom:   { low: 0, mid: 0, high: 0 }
    };

    const defaultAudioTxPresets = {
      "1": {
        name: "Standard",
        txBtMicEnabled: false,
        txMicGain: 0,
        txNoiseSuppression: false,
        txBrowserAgc: false,
        txDspAgc: true,
        txEchoCancellation: false,
        txGateEnabled: true,
        txGateThreshold: -45,
        txHpfEnabled: true,
        txPresenceBoost: 2,
        txEqLow: -2,
        txEqMid: 1,
        txEqHigh: 2,
        txEqPreset: "standard"
      },
      "2": {
        name: "Soft Voice",
        txBtMicEnabled: false,
        txMicGain: 1,
        txNoiseSuppression: false,
        txBrowserAgc: false,
        txDspAgc: true,
        txEchoCancellation: false,
        txGateEnabled: true,
        txGateThreshold: -45,
        txHpfEnabled: true,
        txPresenceBoost: 3,
        txEqLow: -3,
        txEqMid: 1,
        txEqHigh: 3,
        txEqPreset: "bright"
      },
      "3": {
        name: "Punchy / DX",
        txBtMicEnabled: false,
        txMicGain: 2,
        txNoiseSuppression: false,
        txBrowserAgc: false,
        txDspAgc: true,
        txEchoCancellation: false,
        txGateEnabled: true,
        txGateThreshold: -42,
        txHpfEnabled: true,
        txPresenceBoost: 4,
        txEqLow: -6,
        txEqMid: 3,
        txEqHigh: 3,
        txEqPreset: "dx"
      }
    };

    activeAudioTxPresetId = localStorage.getItem(getTxPresetStorageKey("active")) || "1";

    function getAudioTxPresetData(id) {
      const defs = _currentAudioTxNet === "allstar" ? defaultAnalogTxPresets : defaultAudioTxPresets;
      const stored = localStorage.getItem(getTxPresetStorageKey("preset", id));
      if (stored) {
        try {
          return Object.assign({}, defs[id] || defs["1"], JSON.parse(stored));
        } catch (_) {}
      }
      return Object.assign({}, defs[id] || defs["1"]);
    }

    function applyAudioTxPreset(id, skipRemoteSync = false) {
      activeAudioTxPresetId = String(id);
      const defs = _currentAudioTxNet === "allstar" ? defaultAnalogTxPresets : defaultAudioTxPresets;
      if (!defs[activeAudioTxPresetId]) activeAudioTxPresetId = "1";
      localStorage.setItem(getTxPresetStorageKey("active"), activeAudioTxPresetId);
      const data = getAudioTxPresetData(activeAudioTxPresetId);

      const isAsl = (_currentAudioTxNet === "allstar");
      const txMicGain = data.txMicGain !== undefined ? data.txMicGain : 0;
      const txNs = data.txNoiseSuppression !== undefined ? Boolean(data.txNoiseSuppression) : false;
      const txAgc = data.txBrowserAgc !== undefined ? Boolean(data.txBrowserAgc) : false;
      const txDspAgcVal = data.txDspAgc !== undefined ? Boolean(data.txDspAgc) : (isAsl ? true : false);
      const txAec = data.txEchoCancellation !== undefined ? Boolean(data.txEchoCancellation) : false;
      const txGate = data.txGateEnabled !== undefined ? Boolean(data.txGateEnabled) : true;
      const txGateThr = data.txGateThreshold !== undefined ? data.txGateThreshold : -45;
      const txHpf = data.txHpfEnabled !== undefined ? Boolean(data.txHpfEnabled) : true;
      const txPres = data.txPresenceBoost !== undefined ? data.txPresenceBoost : 0;
      const txEqLowVal = data.txEqLow !== undefined ? data.txEqLow : 0;
      const txEqMidVal = data.txEqMid !== undefined ? data.txEqMid : 0;
      const txEqHighVal = data.txEqHigh !== undefined ? data.txEqHigh : 0;
      const txEqPresetVal = data.txEqPreset || "standard";

      if (chkTxBluetoothMic && !chkTxBluetoothMic.disabled && data.txBtMicEnabled !== undefined) {
        chkTxBluetoothMic.checked = Boolean(data.txBtMicEnabled);
      }
      if (sliderTxMicGain) sliderTxMicGain.value = txMicGain;
      if (chkTxNoiseSuppression) chkTxNoiseSuppression.checked = txNs;
      if (chkTxBrowserAgc) chkTxBrowserAgc.checked = txAgc;
      if (chkTxDspAgc) chkTxDspAgc.checked = txDspAgcVal;
      if (chkTxEchoCancellation) chkTxEchoCancellation.checked = txAec;
      if (chkTxGate) chkTxGate.checked = txGate;
      if (sliderTxGate) sliderTxGate.value = txGateThr;
      if (chkTxHpf) chkTxHpf.checked = txHpf;
      if (sliderTxPresence) sliderTxPresence.value = txPres;
      if (sliderTxEqLow) sliderTxEqLow.value = txEqLowVal;
      if (sliderTxEqMid) sliderTxEqMid.value = txEqMidVal;
      if (sliderTxEqHigh) sliderTxEqHigh.value = txEqHighVal;
      setEqPresetActive(txEqPresetVal, true);

      updateTxBadges();
      saveTxSettingsToStorage(true);
      applyTxDspSettings(true);
      updateMicTrackConstraints();
      if (!skipRemoteSync && chkTxBluetoothMic && !chkTxBluetoothMic.disabled && isAndroidApkEnvironment() && data.txBtMicEnabled !== undefined) {
        updateBtMicRouting();
      }

      updateAudioTxPresetUI();
      if (!skipRemoteSync) {
        _scheduleSyncClientSettings(0);
      }
    }

    function saveCurrentToAudioTxPreset(id) {
      const targetId = String(id || activeAudioTxPresetId || "1");
      activeAudioTxPresetId = targetId;
      autoSaveCurrentTxState(false, true);

      if (saveAudioTxPresetBtn) {
        saveAudioTxPresetBtn.classList.add("saved-flash");
        if (saveAudioTxPresetText) {
          saveAudioTxPresetText.textContent = window.t ? window.t("audio_tx.btn_saved_text", { id: targetId }) : `✓ Сохранено в P${targetId}`;
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
      const dmrPres = localStorage.getItem("proxdmr_audio_tx_active_preset") || "1";
      const aslPres = localStorage.getItem("proxdmr_asl_audio_tx_active_preset") || "1";
      audioTxPresetButtons.forEach(btn => {
        const pId = btn.getAttribute("data-audio-tx-preset");
        btn.classList.toggle("active", pId === activeAudioTxPresetId);
      });
      document.querySelectorAll(".radio-container, .hotspot-card").forEach(card => {
        const isCardAsl = card.classList.contains("card-net-allstar") || (card.getAttribute("data-network-type") || "").toLowerCase() === "allstar";
        const cardPres = isCardAsl ? aslPres : dmrPres;
        card.querySelectorAll(".btn-audio-tx-mini-preset .mini-preset-label").forEach(lbl => {
          lbl.textContent = `P${cardPres}`;
        });
        card.querySelectorAll(".audio-tx-menu .mini-preset-item").forEach(item => {
          const pId = item.getAttribute("data-audio-tx-preset");
          item.classList.toggle("active", pId === cardPres);
        });
      });
      document.querySelectorAll(".btn-audio-tx-mini-preset .mini-preset-label").forEach(lbl => {
        if (!lbl.closest(".radio-container, .hotspot-card")) lbl.textContent = `P${activeAudioTxPresetId}`;
      });
      document.querySelectorAll(".audio-tx-menu .mini-preset-item").forEach(item => {
        if (!item.closest(".radio-container, .hotspot-card")) {
          const pId = item.getAttribute("data-audio-tx-preset");
          item.classList.toggle("active", pId === activeAudioTxPresetId);
        }
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
        if (id) applyAudioTxPreset(id, false);
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
      syncBtMicAvailability().catch(() => {});
    });
    window.applyAudioTxPreset = applyAudioTxPreset;
    window.updateAudioTxPresetUI = updateAudioTxPresetUI;
    window.updateTxBadges = updateTxBadges;
    window.applyTxDspSettings = applyTxDspSettings;

    // Restore saved TX settings from localStorage without blind overwrite or server write
    const pfx = getTxPrefix();
    const savedActiveTxPres = localStorage.getItem(getTxPresetStorageKey("active"));
    const txDefsBoot = _currentAudioTxNet === "allstar" ? defaultAnalogTxPresets : defaultAudioTxPresets;
    if (savedActiveTxPres && txDefsBoot[savedActiveTxPres]) {
      activeAudioTxPresetId = savedActiveTxPres;
    }
    const readTxKey = (suffix) => {
      const v = localStorage.getItem(`${pfx}${suffix}`);
      return v !== null ? v : localStorage.getItem(`proxdmr_tx_${suffix}`);
    };
    const savedTxMicGain = readTxKey("mic_gain");
    if (savedTxMicGain !== null && sliderTxMicGain) sliderTxMicGain.value = savedTxMicGain;
    const savedTxBtMic = localStorage.getItem("proxdmr_tx_bt_mic") || localStorage.getItem(`${pfx}bt_mic`);
    if (savedTxBtMic !== null && chkTxBluetoothMic) chkTxBluetoothMic.checked = savedTxBtMic === "true";
    syncBtMicAvailability().catch(() => {});
    const savedTxNs = readTxKey("ns");
    if (savedTxNs !== null && chkTxNoiseSuppression) chkTxNoiseSuppression.checked = savedTxNs === "true";
    const savedTxAgc = readTxKey("agc");
    if (savedTxAgc !== null && chkTxBrowserAgc) chkTxBrowserAgc.checked = savedTxAgc === "true";
    const savedTxDspAgc = readTxKey("dsp_agc");
    if (savedTxDspAgc !== null && chkTxDspAgc) chkTxDspAgc.checked = savedTxDspAgc === "true";
    const savedTxAec = readTxKey("aec");
    if (savedTxAec !== null && chkTxEchoCancellation) chkTxEchoCancellation.checked = savedTxAec === "true";
    const savedTxGate = readTxKey("gate_enabled");
    if (savedTxGate !== null && chkTxGate) chkTxGate.checked = savedTxGate !== "false";
    const savedTxGateThr = readTxKey("gate_threshold");
    if (savedTxGateThr !== null && sliderTxGate) sliderTxGate.value = savedTxGateThr;
    const savedTxHpf = readTxKey("hpf");
    if (savedTxHpf !== null && chkTxHpf) chkTxHpf.checked = savedTxHpf !== "false";
    const savedTxPres = readTxKey("presence");
    if (savedTxPres !== null && sliderTxPresence) sliderTxPresence.value = savedTxPres;
    const savedTxEqLow = readTxKey("eq_low");
    if (savedTxEqLow !== null && sliderTxEqLow) sliderTxEqLow.value = savedTxEqLow;
    const savedTxEqMid = readTxKey("eq_mid");
    if (savedTxEqMid !== null && sliderTxEqMid) sliderTxEqMid.value = savedTxEqMid;
    const savedTxEqHigh = readTxKey("eq_high");
    if (savedTxEqHigh !== null && sliderTxEqHigh) sliderTxEqHigh.value = savedTxEqHigh;
    const savedTxEqPreset = readTxKey("eq_preset") || "standard";
    setEqPresetActive(savedTxEqPreset, true);

    updateTxBadges();
    applyTxDspSettings(true);
    updateAudioTxPresetUI();

    if (resetDefaultsBtn) {
      resetDefaultsBtn.addEventListener("click", () => {
        const defs = _currentAudioTxNet === "allstar" ? defaultAnalogTxPresets : defaultAudioTxPresets;
        const fresh = defs[activeAudioTxPresetId] || defs["1"];
        localStorage.setItem(getTxPresetStorageKey("preset", activeAudioTxPresetId), JSON.stringify(fresh));
        applyAudioTxPreset(activeAudioTxPresetId, false);
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

      if (presetItem.hasAttribute("data-preset") || presetItem.hasAttribute("data-ambe-preset")) {
        const pId = presetItem.getAttribute("data-preset") || presetItem.getAttribute("data-ambe-preset");
        if (typeof window.applyAmbePreset === "function") window.applyAmbePreset(pId);
      } else if (presetItem.hasAttribute("data-audio-rx-preset")) {
        const pId = presetItem.getAttribute("data-audio-rx-preset");
        const card = presetItem.closest(".radio-container") || presetItem.closest(".hotspot-card");
        if (typeof window.syncActiveAudioRxPreset === "function" && card) {
          window.syncActiveAudioRxPreset(card);
        }
        if (typeof window.applyAudioRxPreset === "function") window.applyAudioRxPreset(pId);
      } else if (presetItem.hasAttribute("data-audio-tx-preset")) {
        const pId = presetItem.getAttribute("data-audio-tx-preset");
        const card = presetItem.closest(".radio-container") || presetItem.closest(".hotspot-card");
        if (typeof window.syncActiveAudioTxPreset === "function" && card) {
          window.syncActiveAudioTxPreset(card);
        }
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

  function applyTxDspSettings(skipRemoteSync = false, immediate = false) {
    // All TX DSP audio processing (HPF, Presence, Mic Gain, DSP AGC, Limiter)
    // is now performed server-side in Python (ServerTxDsp).
    // Here we sync parameters to the server and update the worklet noise gate.
    if (!skipRemoteSync) {
      _scheduleSyncClientSettings(immediate ? 0 : 200);
    }

    if (window.workletNode && window.workletNode.port) {
      const pfx = getTxPrefix();
      const gateEl = document.getElementById("chkTxGate");
      const gateThrEl = document.getElementById("sliderTxGate");
      const gateEn = gateEl ? gateEl.checked : (localStorage.getItem(`${pfx}gate_enabled`) !== "false");
      const gateThr = gateThrEl ? (parseFloat(gateThrEl.value) || -45) : (parseFloat(localStorage.getItem(`${pfx}gate_threshold`)) || -45);
      window.workletNode.port.postMessage({
        command: "set_tx_params",
        gateEnabled: gateEn,
        gateThresholdDb: gateThr
      });
    }
  }

  async function updateMicTrackConstraints() {
    if (!window.micStream) return;
    const pfx = getTxPrefix();
    const nsEl = document.getElementById("chkTxNoiseSuppression");
    const agcEl = document.getElementById("chkTxBrowserAgc");
    const aecEl = document.getElementById("chkTxEchoCancellation");

    const ns = nsEl ? nsEl.checked : (localStorage.getItem(`${pfx}ns`) === "true");
    const agc = agcEl ? agcEl.checked : (localStorage.getItem(`${pfx}agc`) === "true");
    const aec = aecEl ? aecEl.checked : (localStorage.getItem(`${pfx}aec`) === "true");

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

      // В демо-режиме, режиме SWL и пока открыто окно входа (#authModal) —
      // микрофон (getUserMedia) НЕ запрашиваем вообще (нужен только приём audioPlayer)
      const authModalEl = document.getElementById("authModal");
      const isAuthModalOpen = Boolean(authModalEl && authModalEl.classList.contains("active"));
      if (
        window.isDemoMode ||
        window.isUserSwl ||
        document.body.classList.contains("is-demo-mode") ||
        isAuthModalOpen
      ) {
        isAudioReady = false;
        return false;
      }

      try {
        await window.audioCtx.audioWorklet.addModule("/static/js/audio-processor.js?v=2.9.730");
      } catch (modErr) {
        // AudioWorklet module already added
      }

      if (!window.micStream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const pfx = getTxPrefix();
          const ns = localStorage.getItem(`${pfx}ns`) === "true";
          const agc = localStorage.getItem(`${pfx}agc`) === "true";
          const aec = localStorage.getItem(`${pfx}aec`) === "true";
          const isAndroidApp = isAndroidApkEnvironment();
          const audioConstraints = {
            echoCancellation: aec,
            noiseSuppression: ns,
            autoGainControl: agc
          };

          if (isAndroidApp) {
            // В Android APK маршрутизацией заведует AudioManager (Bluetooth SCO / CommunicationDevice)
            const isBt = localStorage.getItem("proxdmr_tx_bt_mic") === "true";
            const btId = localStorage.getItem("proxdmr_tx_bt_mic_selected_id") || "";
            if (window.AndroidBridge && typeof window.AndroidBridge.setBluetoothMicEnabled === "function") {
              window.AndroidBridge.setBluetoothMicEnabled(isBt, btId);
            }
          } else {
            // В веб-браузере используем явно выбранный пользователем микрофон из выпадающего списка
            const browserMicId = localStorage.getItem("proxdmr_tx_browser_mic_id") || "";
            if (browserMicId) {
              audioConstraints.deviceId = { ideal: browserMicId };
            }
          }

          try {
            window.micStream = await navigator.mediaDevices.getUserMedia({
              audio: audioConstraints,
              video: false
            });
          } catch (micErr) {
            console.warn("[AUDIO] getUserMedia with constraints failed, retrying with fallback audio:true", micErr);
            if (!isAndroidApp) {
              localStorage.setItem("proxdmr_tx_browser_mic_id", "");
            }
            window.micStream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: false
            });
          }
        } catch (finalErr) {
          console.warn("[AUDIO] getUserMedia final error or device missing:", finalErr);
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
            if ((window.isPttPressed || window.isParrotTestRecording) && window.ws && window.ws.readyState === WebSocket.OPEN) {
              window.ws.send(event.data);
              txPacketCount++;
              if (txPacketCount === 1 || txPacketCount % 50 === 0) {
                console.log(`[AUDIO_TX] Sent packet #${txPacketCount} (${event.data.byteLength || 0}B, parrot=${Boolean(window.isParrotTestRecording)})`);
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

        applyTxDspSettings(true);
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

  function stopAndReleaseMic() {
    releaseMicrophone();
  }
  window.stopAndReleaseMic = releaseMicrophone;

  function releaseMicrophone() {
    if (window.micStream) {
      try {
        window.micStream.getTracks().forEach(t => t.stop());
      } catch (_) {}
      window.micStream = null;
    }
    if (window.micSourceNode) {
      try {
        window.micSourceNode.disconnect();
      } catch (_) {}
      window.micSourceNode = null;
    }
    isAudioReady = false;
    isAudioInitializing = false;
    console.log("[AUDIO] Microphone hardware released");
  }
  window.releaseMicrophone = releaseMicrophone;

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
        lastRxTime: 0,
        _lastRenderMs: 0,
        _lastRenderedPct: -1,
        _lastRenderedPeak: -1
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

    // Calculate level taking digital Pre-Gain and active client RX AGC into account
    const preGainDb = (window.audioPlayer && typeof window.audioPlayer.getPreGainDb === "function")
      ? window.audioPlayer.getPreGainDb() : 0;
    const preGainLinear = Math.pow(10.0, preGainDb / 20.0);
    const effectiveInputRms = rawRms * preGainLinear;

    let effectiveRms = effectiveInputRms;
    const agcCfg = (window.audioPlayer && typeof window.audioPlayer.getRxAgcConfig === "function")
      ? window.audioPlayer.getRxAgcConfig() : null;
    if (agcCfg) {
      const gainMult = Math.max(1.0, Math.min(12.0, (Number(agcCfg.gainRaw) || 35) / 10.0));
      if (!agcCfg.enabled) {
        const manualGain = Math.min(4.0, Math.max(0.4, gainMult / 2.5));
        effectiveRms = Math.min(1.0, effectiveInputRms * manualGain);
      } else if (effectiveInputRms >= 0.006) {
        const targetRms = Math.min(0.42, Math.max(0.08, 0.065 * gainMult));
        const depthDb = Math.max(6.0, Math.min(30.0, Number(agcCfg.depthDb) || 18.0));
        const boostRatio = Math.min(1.0, 0.55 + (depthDb / 48.0));
        const minGainDb = -Math.min(16.0, Math.round(depthDb * 0.8));
        const diffDb = 20.0 * Math.log10(targetRms) - 20.0 * Math.log10(Math.max(0.001, effectiveInputRms));
        let gainDb = (diffDb > 0) ? Math.min(depthDb, diffDb * boostRatio) : Math.max(minGainDb, diffDb * 0.85);
        if (gainMult > 6.0) {
          gainDb += 20.0 * Math.log10(1.0 + (gainMult - 6.0) * 0.12);
        }
        effectiveRms = Math.min(1.0, effectiveInputRms * Math.pow(10.0, gainDb / 20.0));
      }
    }

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

        const shouldRender = (now - (st._lastRenderMs || 0) >= 32) || (st.current === 0 && st._lastRenderedPct > 0);
        if (shouldRender) {
          const curPct = Math.round(st.current * 10) / 10;
          const curPeak = Math.round(st.peak * 10) / 10;
          const pctChanged = Math.abs(curPct - st._lastRenderedPct) >= 0.5;
          const peakChanged = Math.abs(curPeak - st._lastRenderedPeak) >= 0.5;

          if (pctChanged || peakChanged) {
            st._lastRenderMs = now;
            st._lastRenderedPct = curPct;
            st._lastRenderedPeak = curPeak;

            if (fillEl && pctChanged) {
              fillEl.style.width = `${curPct}%`;
            }
            if (peakEl && peakChanged) {
              if (curPeak > 1.0) {
                peakEl.style.left = `${Math.min(100, Math.max(0, curPeak))}%`;
                peakEl.style.opacity = "1";
                if (curPeak >= 85) {
                  peakEl.classList.add("vu-peak-overload");
                } else {
                  peakEl.classList.remove("vu-peak-overload");
                }
              } else {
                peakEl.style.opacity = "0";
                peakEl.classList.remove("vu-peak-overload");
              }
            }

            if (vertFillEl && pctChanged) {
              vertFillEl.style.height = `${curPct}%`;
            }
            if (vertPeakEl && peakChanged) {
              if (curPeak > 1.0) {
                vertPeakEl.style.bottom = `${Math.min(100, Math.max(0, curPeak))}%`;
                vertPeakEl.style.opacity = "1";
                if (curPeak >= 85) {
                  vertPeakEl.classList.add("vu-peak-overload");
                } else {
                  vertPeakEl.classList.remove("vu-peak-overload");
                }
              } else {
                vertPeakEl.style.opacity = "0";
                vertPeakEl.classList.remove("vu-peak-overload");
              }
            }
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
  syncActiveAudioRxPreset,
  syncActiveAudioTxPreset,
  applyTxDspSettings,
  updateMicTrackConstraints,
  initAudio,
  releaseMicrophone,
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
  window.syncActiveAudioRxPreset = syncActiveAudioRxPreset;
  window.syncActiveAudioTxPreset = syncActiveAudioTxPreset;
  window.applyTxDspSettings = applyTxDspSettings;
  window.updateMicTrackConstraints = updateMicTrackConstraints;
  window.initAudio = initAudio;
  window.releaseMicrophone = releaseMicrophone;
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
    syncActiveAudioRxPreset,
    syncActiveAudioTxPreset,
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

export function getRxBoostDb() {
  const input = document.getElementById("inputRxBoostDb");
  if (input) {
    const n = parseInt(input.value, 10);
    if (!isNaN(n) && n >= 1 && n <= 100) return n;
  }
  const s = localStorage.getItem("proxdmr_rx_boost_pct");
  const p = parseInt(s, 10);
  return (!isNaN(p) && p >= 1 && p <= 100) ? p : 50;
}
window.getRxBoostDb = getRxBoostDb;
