import { showToast } from '../core/toast.js';
import { pushNavState, notifyNavClosed, scheduleSyncClientSettings } from '../core/state.js';

/**
 * ProxDMR DSD-FME Vocoder Settings Modal Handler
 * Manages vocoder parameters (uvquality, spectral enh, float mode, repeats, decay, FEC tolerance, audio gain, presets)
 */

function getWs() {
  return window.ws;
}

// --- DSD-FME Vocoder Modal Handler ---
function setupDsdfmeModal() {
  const dsdfmeModal = document.getElementById("dsdfmeModal");
  const closeBtn = document.getElementById("closeDsdfmeBtn");
  const closeBottomBtn = document.getElementById("btnCloseDsdfmeBottom");
  const resetBtn = document.getElementById("btnResetDsdfmeDefaults");

  const sliderUvquality = document.getElementById("sliderUvquality");
  const valUvquality = document.getElementById("valUvquality");
  const chkSpectralEnh = document.getElementById("chkSpectralEnh");
  const radFloatMode = document.getElementById("radFloatMode");
  const radShortMode = document.getElementById("radShortMode");
  const sliderMaxRepeats = document.getElementById("sliderMaxRepeats");
  const valMaxRepeats = document.getElementById("valMaxRepeats");
  const sliderRepeatDecay = document.getElementById("sliderRepeatDecay");
  const valRepeatDecay = document.getElementById("valRepeatDecay");
  const radFecStrict = document.getElementById("radFecStrict");
  const radFecBalanced = document.getElementById("radFecBalanced");
  const radFecDx = document.getElementById("radFecDx");
  const sliderAudioGain = document.getElementById("sliderAudioGain");
  const valAudioGain = document.getElementById("valAudioGain");

  function openModal() {
    if (dsdfmeModal) {
      if (typeof window.closePrimaryModals === "function") {
        window.closePrimaryModals("dsdfmeModal");
      }
      const savedFec = localStorage.getItem("proxdmr_dsdfme_fec_tolerance");
      setFecToleranceValue(savedFec !== null ? savedFec : 1);
      dsdfmeModal.style.display = "flex";
      dsdfmeModal.classList.add("active");
      pushNavState("modal", "dsdfmeModal");
    }
  }
  function closeModal() {
    if (dsdfmeModal && (dsdfmeModal.classList.contains("active") || dsdfmeModal.style.display === "flex")) {
      dsdfmeModal.classList.remove("active");
      dsdfmeModal.style.display = "";
      notifyNavClosed();
    }
  }

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest(".btn-dsdfme-trigger") || (e.target.id === "btnDsdfmeMain" ? e.target : null);
    if (trigger) {
      e.preventDefault();
      e.stopPropagation();
      openModal();
    }
  });

  if (closeBtn) closeBtn.addEventListener("click", () => {
    sendVocoderSettings();
    closeModal();
  });
  if (closeBottomBtn) closeBottomBtn.addEventListener("click", () => {
    sendVocoderSettings();
    closeModal();
  });
  if (dsdfmeModal) {
    dsdfmeModal.addEventListener("click", (e) => {
      if (e.target === dsdfmeModal) {
        sendVocoderSettings();
        closeModal();
      }
    });
  }

  // Helper for FEC tolerance radio buttons
  function getFecToleranceValue() {
    if (radFecStrict && radFecStrict.checked) return 0;
    if (radFecDx && radFecDx.checked) return 2;
    return 1;
  }
  function setFecToleranceValue(val) {
    const v = parseInt(val, 10);
    if (radFecStrict) radFecStrict.checked = (v === 0);
    if (radFecBalanced) radFecBalanced.checked = (v === 1 || isNaN(v));
    if (radFecDx) radFecDx.checked = (v === 2);
  }

  // Load initial vocoder settings from localStorage if present
  const savedUvq = localStorage.getItem("proxdmr_dsdfme_uvquality") || localStorage.getItem("proxdmr_vocoder_uvquality");
  if (savedUvq !== null && sliderUvquality) {
    const clampedUvq = Math.min(8, Math.max(1, parseInt(savedUvq, 10) || 3));
    sliderUvquality.value = clampedUvq;
    if (valUvquality) valUvquality.textContent = String(clampedUvq);
  }
  const savedEnh = localStorage.getItem("proxdmr_dsdfme_spectral_enh") || localStorage.getItem("proxdmr_vocoder_spectral_enh");
  if (savedEnh !== null && chkSpectralEnh) {
    chkSpectralEnh.checked = savedEnh === "true";
  }
  const savedFloat = localStorage.getItem("proxdmr_dsdfme_float_mode") || localStorage.getItem("proxdmr_vocoder_float_mode");
  if (savedFloat !== null) {
    const isFloat = savedFloat === "true";
    if (radFloatMode) radFloatMode.checked = isFloat;
    if (radShortMode) radShortMode.checked = !isFloat;
  }
  const savedReps = localStorage.getItem("proxdmr_dsdfme_max_repeats") || localStorage.getItem("proxdmr_vocoder_max_repeats");
  if (savedReps !== null && sliderMaxRepeats) {
    sliderMaxRepeats.value = savedReps;
    if (valMaxRepeats) valMaxRepeats.textContent = savedReps;
  }
  const savedDecay = localStorage.getItem("proxdmr_dsdfme_repeat_decay");
  if (savedDecay !== null && sliderRepeatDecay) {
    sliderRepeatDecay.value = savedDecay;
    if (valRepeatDecay) valRepeatDecay.textContent = `${savedDecay}%`;
  }
  const savedFec = localStorage.getItem("proxdmr_dsdfme_fec_tolerance");
  if (savedFec !== null) {
    setFecToleranceValue(savedFec);
  }
  const savedGain = localStorage.getItem("proxdmr_dsdfme_audio_gain");
  if (savedGain !== null && sliderAudioGain) {
    const clampedGain = Math.min(8.0, Math.max(1.0, parseFloat(savedGain) || 7.0));
    sliderAudioGain.value = clampedGain;
    if (valAudioGain) valAudioGain.textContent = `${clampedGain.toFixed(1)}x`;
  }

  function sendVocoderSettings() {
    const uvquality = Math.min(8, Math.max(1, parseInt(sliderUvquality ? sliderUvquality.value : "3", 10) || 3));
    const spectralEnh = chkSpectralEnh ? chkSpectralEnh.checked : true;
    const floatMode = radFloatMode ? radFloatMode.checked : true;
    const maxRepeats = parseInt(sliderMaxRepeats ? sliderMaxRepeats.value : "3", 10) || 3;
    const repeatDecay = parseInt(sliderRepeatDecay ? sliderRepeatDecay.value : "75", 10) || 75;
    const fecTolerance = getFecToleranceValue();
    const audioGain = Math.min(8.0, Math.max(1.0, parseFloat(sliderAudioGain ? sliderAudioGain.value : "7.0") || 7.0));

    localStorage.setItem("proxdmr_dsdfme_uvquality", uvquality);
    localStorage.setItem("proxdmr_dsdfme_spectral_enh", spectralEnh ? "true" : "false");
    localStorage.setItem("proxdmr_dsdfme_float_mode", floatMode ? "true" : "false");
    localStorage.setItem("proxdmr_dsdfme_max_repeats", maxRepeats);
    localStorage.setItem("proxdmr_dsdfme_repeat_decay", repeatDecay);
    localStorage.setItem("proxdmr_dsdfme_fec_tolerance", fecTolerance);
    localStorage.setItem("proxdmr_dsdfme_audio_gain", audioGain);

    const curActiveId = localStorage.getItem("proxdmr_dsdfme_active_preset") || "1";
    if (curActiveId) {
      const curPresetData = {
        uvquality,
        spectral_enh: spectralEnh,
        float_mode: floatMode,
        max_repeats: maxRepeats,
        repeat_decay: repeatDecay,
        fec_tolerance: fecTolerance,
        audio_gain: audioGain
      };
      localStorage.setItem(`proxdmr_dsdfme_preset_${curActiveId}`, JSON.stringify(curPresetData));
    }

    const ws = getWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "set_vocoder_settings",
        uvquality: uvquality,
        spectral_enh: spectralEnh,
        float_mode: floatMode,
        max_repeats: maxRepeats,
        repeat_decay: repeatDecay / 100.0,
        fec_tolerance: fecTolerance,
        audio_gain: audioGain
      }));
    }
    scheduleSyncClientSettings();
  }

  if (sliderUvquality) {
    sliderUvquality.addEventListener("input", () => {
      if (valUvquality) valUvquality.textContent = sliderUvquality.value;
    });
    sliderUvquality.addEventListener("change", sendVocoderSettings);
  }
  if (chkSpectralEnh) {
    chkSpectralEnh.addEventListener("change", sendVocoderSettings);
  }
  if (radFloatMode) {
    radFloatMode.addEventListener("change", sendVocoderSettings);
  }
  if (radShortMode) {
    radShortMode.addEventListener("change", sendVocoderSettings);
  }
  if (sliderMaxRepeats) {
    sliderMaxRepeats.addEventListener("input", () => {
      if (valMaxRepeats) valMaxRepeats.textContent = sliderMaxRepeats.value;
    });
    sliderMaxRepeats.addEventListener("change", sendVocoderSettings);
  }
  if (sliderRepeatDecay) {
    sliderRepeatDecay.addEventListener("input", () => {
      if (valRepeatDecay) valRepeatDecay.textContent = `${sliderRepeatDecay.value}%`;
    });
    sliderRepeatDecay.addEventListener("change", sendVocoderSettings);
  }
  [radFecStrict, radFecBalanced, radFecDx].forEach(rad => {
    if (rad) {
      rad.addEventListener("change", sendVocoderSettings);
      rad.addEventListener("click", sendVocoderSettings);
    }
  });
  if (sliderAudioGain) {
    sliderAudioGain.addEventListener("input", () => {
      if (valAudioGain) valAudioGain.textContent = `${parseFloat(sliderAudioGain.value).toFixed(1)}x`;
    });
    sliderAudioGain.addEventListener("change", sendVocoderSettings);
  }

  // 3-Preset System for DSD-FME (P1 - P3)
  const defaultPresets = {
    "1": { uvquality: 3, spectral_enh: true, float_mode: true, max_repeats: 3, repeat_decay: 75, fec_tolerance: 1, audio_gain: 7.0 },
    "2": { uvquality: 4, spectral_enh: true, float_mode: true, max_repeats: 4, repeat_decay: 70, fec_tolerance: 1, audio_gain: 6.5 },
    "3": { uvquality: 6, spectral_enh: true, float_mode: true, max_repeats: 5, repeat_decay: 85, fec_tolerance: 2, audio_gain: 8.0 }
  };

  let activePresetId = localStorage.getItem("proxdmr_dsdfme_active_preset") || 
                       localStorage.getItem("proxdmr_mbe_active_preset") || "1";
  if (activePresetId === "4") activePresetId = "1";
  const presetButtons = document.querySelectorAll(".btn-dsdfme-preset");
  const savePresetBtn = document.getElementById("btnSaveDsdfmePreset");
  const savePresetText = savePresetBtn ? savePresetBtn.querySelector(".btn-preset-save-text") : null;

  function getPresetData(id) {
    const stored = localStorage.getItem(`proxdmr_dsdfme_preset_${id}`) || 
                   localStorage.getItem(`proxdmr_mbe_preset_${id}`);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.warn("Failed to parse preset", id, e);
      }
    }
    return defaultPresets[id] || defaultPresets["1"];
  }

  function applyPreset(id) {
    activePresetId = String(id);
    if (activePresetId === "4") activePresetId = "1";
    localStorage.setItem("proxdmr_dsdfme_active_preset", activePresetId);
    const data = getPresetData(activePresetId);

    // Update Vocoder Controls
    if (sliderUvquality) {
      sliderUvquality.value = data.uvquality !== undefined ? data.uvquality : 3;
      if (valUvquality) valUvquality.textContent = String(sliderUvquality.value);
    }
    if (chkSpectralEnh) {
      chkSpectralEnh.checked = Boolean(data.spectral_enh !== undefined ? data.spectral_enh : true);
    }
    if (radFloatMode && radShortMode) {
      const isFloat = Boolean(data.float_mode !== undefined ? data.float_mode : true);
      radFloatMode.checked = isFloat;
      radShortMode.checked = !isFloat;
    }
    if (sliderMaxRepeats) {
      sliderMaxRepeats.value = data.max_repeats !== undefined ? data.max_repeats : 3;
      if (valMaxRepeats) valMaxRepeats.textContent = String(sliderMaxRepeats.value);
    }
    if (sliderRepeatDecay) {
      sliderRepeatDecay.value = data.repeat_decay !== undefined ? data.repeat_decay : 75;
      if (valRepeatDecay) valRepeatDecay.textContent = `${sliderRepeatDecay.value}%`;
    }
    setFecToleranceValue(data.fec_tolerance !== undefined ? data.fec_tolerance : 1);
    if (sliderAudioGain) {
      sliderAudioGain.value = data.audio_gain !== undefined ? data.audio_gain : 7.0;
      if (valAudioGain) valAudioGain.textContent = `${parseFloat(sliderAudioGain.value).toFixed(1)}x`;
    }

    sendVocoderSettings();
    updatePresetUI();
  }

  function saveCurrentToPreset(id) {
    const currentData = {
      uvquality: Math.min(8, Math.max(1, parseInt(sliderUvquality ? sliderUvquality.value : "3", 10) || 3)),
      spectral_enh: chkSpectralEnh ? chkSpectralEnh.checked : true,
      float_mode: radFloatMode ? radFloatMode.checked : true,
      max_repeats: parseInt(sliderMaxRepeats ? sliderMaxRepeats.value : "3", 10) || 3,
      repeat_decay: parseInt(sliderRepeatDecay ? sliderRepeatDecay.value : "75", 10) || 75,
      fec_tolerance: getFecToleranceValue(),
      audio_gain: Math.min(8.0, Math.max(1.0, parseFloat(sliderAudioGain ? sliderAudioGain.value : "7.0") || 7.0))
    };

    localStorage.setItem(`proxdmr_dsdfme_preset_${id}`, JSON.stringify(currentData));
    scheduleSyncClientSettings();

    if (savePresetBtn) {
      savePresetBtn.classList.add("saved-flash");
      const msg = (window.t ? window.t("dsdfme.btn_saved_text", { id }) : null) || 
                                      (window.t ? window.t("vocoder.saved_in_preset", { id }, `✓ Сохранено в P${id}`) : `✓ Сохранено в P${id}`);
      if (savePresetText) savePresetText.textContent = msg;
      setTimeout(() => {
        savePresetBtn.classList.remove("saved-flash");
        const defaultMsg = (window.t ? window.t("dsdfme.btn_save_text", { id: activePresetId }) : null) || 
                                                        (window.t ? window.t("vocoder.save_in_preset", { id: activePresetId }, `Сохранить в P${activePresetId}`) : `Сохранить в P${activePresetId}`);
        if (savePresetText) savePresetText.textContent = defaultMsg;
      }, 1400);
    }
  }

  function updatePresetUI() {
    presetButtons.forEach(btn => {
      const pId = btn.getAttribute("data-preset");
      btn.classList.toggle("active", pId === activePresetId);
    });
    document.querySelectorAll(".btn-dsdfme-mini-preset .mini-preset-label").forEach(lbl => {
      lbl.textContent = `P${activePresetId}`;
    });
    document.querySelectorAll(".dsdfme-menu .mini-preset-item").forEach(item => {
      const pId = item.getAttribute("data-preset");
      item.classList.toggle("active", pId === activePresetId);
    });
    if (savePresetText) {
      savePresetText.textContent = (window.t ? window.t("dsdfme.btn_save_text", { id: activePresetId }) : null) || 
                                                                        (window.t ? window.t("vocoder.save_in_preset", { id: activePresetId }, `Сохранить в P${activePresetId}`) : `Сохранить в P${activePresetId}`);
    }
    if (savePresetBtn) {
      savePresetBtn.title = (window.t ? window.t("dsdfme.btn_save_title", { id: activePresetId }) : null) || 
                                                          (window.t ? window.t("vocoder.save_preset_title", { id: activePresetId }, `Сохранить текущие параметры в Пресет ${activePresetId}`) : `Сохранить текущие параметры в Пресет ${activePresetId}`);
    }
  }
  window.applyDsdfmePreset = applyPreset;

  presetButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-preset");
      if (id) applyPreset(id);
    });
  });

  document.addEventListener("click", (e) => {
    const cardPresetBtn = e.target.closest(".btn-card-preset[data-preset]");
    if (cardPresetBtn) {
      e.preventDefault();
      e.stopPropagation();
      const pId = cardPresetBtn.getAttribute("data-preset");
      if (pId) applyPreset(pId);
    }
  });

  if (savePresetBtn) {
    savePresetBtn.addEventListener("click", () => {
      saveCurrentToPreset(activePresetId);
    });
  }

  updatePresetUI();
  window.updateDsdfmePresetUI = updatePresetUI;
  window.addEventListener("languageChanged", updatePresetUI);
  if (window.I18N && typeof window.I18N.onLanguageChange === "function") {
    window.I18N.onLanguageChange(updatePresetUI);
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (sliderUvquality) {
        sliderUvquality.value = 3;
        if (valUvquality) valUvquality.textContent = "3";
      }
      if (chkSpectralEnh) chkSpectralEnh.checked = true;
      if (radFloatMode) radFloatMode.checked = true;
      if (radShortMode) radShortMode.checked = false;
      if (sliderMaxRepeats) {
        sliderMaxRepeats.value = 3;
        if (valMaxRepeats) valMaxRepeats.textContent = "3";
      }
      if (sliderRepeatDecay) {
        sliderRepeatDecay.value = 75;
        if (valRepeatDecay) valRepeatDecay.textContent = "75%";
      }
      setFecToleranceValue(1);
      if (sliderAudioGain) {
        sliderAudioGain.value = 7.0;
        if (valAudioGain) valAudioGain.textContent = "7.0x";
      }
      sendVocoderSettings();
    });
  }

  window.updateVocoderUI = function(settings) {
    if (!settings) return;
    if (settings.uvquality !== undefined && sliderUvquality) {
      const clampedUvq = Math.min(8, Math.max(1, parseInt(settings.uvquality, 10) || 3));
      sliderUvquality.value = clampedUvq;
      if (valUvquality) valUvquality.textContent = String(clampedUvq);
      localStorage.setItem("proxdmr_dsdfme_uvquality", clampedUvq);
    }
    if (settings.spectral_enh !== undefined && chkSpectralEnh) {
      chkSpectralEnh.checked = Boolean(settings.spectral_enh);
      localStorage.setItem("proxdmr_dsdfme_spectral_enh", settings.spectral_enh ? "true" : "false");
    }
    if (settings.float_mode !== undefined) {
      const isFloat = Boolean(settings.float_mode);
      if (radFloatMode) radFloatMode.checked = isFloat;
      if (radShortMode) radShortMode.checked = !isFloat;
      localStorage.setItem("proxdmr_dsdfme_float_mode", isFloat ? "true" : "false");
    }
    if (settings.max_repeats !== undefined && sliderMaxRepeats) {
      sliderMaxRepeats.value = settings.max_repeats;
      if (valMaxRepeats) valMaxRepeats.textContent = settings.max_repeats;
      localStorage.setItem("proxdmr_dsdfme_max_repeats", settings.max_repeats);
    }
    if (settings.repeat_decay !== undefined && sliderRepeatDecay) {
      const pct = Math.round(settings.repeat_decay * 100);
      sliderRepeatDecay.value = pct;
      if (valRepeatDecay) valRepeatDecay.textContent = `${pct}%`;
      localStorage.setItem("proxdmr_dsdfme_repeat_decay", pct);
    }
    if (settings.fec_tolerance !== undefined) {
      setFecToleranceValue(settings.fec_tolerance);
      localStorage.setItem("proxdmr_dsdfme_fec_tolerance", settings.fec_tolerance);
    }
    if (settings.audio_gain !== undefined && sliderAudioGain) {
      const clampedGain = Math.min(8.0, Math.max(1.0, parseFloat(settings.audio_gain) || 7.0));
      sliderAudioGain.value = clampedGain;
      if (valAudioGain) valAudioGain.textContent = `${clampedGain.toFixed(1)}x`;
      localStorage.setItem("proxdmr_dsdfme_audio_gain", clampedGain);
    }
  };
}

setupDsdfmeModal();


export {
  setupDsdfmeModal
};

if (typeof window !== "undefined") {
  window.setupDsdfmeModal = setupDsdfmeModal;
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.setupDsdfmeModal = setupDsdfmeModal;
}
