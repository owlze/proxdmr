/**
 * ProxDMR AMBE+2 Vocoder Modal & Synthesis Tuning Controls (mbelib-neo)
 */

import { scheduleSyncClientSettings } from '../core/state.js?v=2.9.698';

export function setupDsdfmeModal() {
  const ambeModal = document.getElementById("ambeModal");
  if (!ambeModal) return;

  const closeBtn = document.getElementById("closeAmbeBtn");
  const bottomSaveBtn = document.getElementById("btnCloseAmbeBottom");
  const resetBtn = document.getElementById("btnResetAmbeDefaults");

  const chkSpectralEnh = document.getElementById("chkAmbeSpectralEnh");
  const badgeSpectralEnh = document.getElementById("badgeAmbeSpectralEnh");
  const sliderHighBandGain = document.getElementById("sliderAmbeHighBandGain");
  const valHighBandGain = document.getElementById("valAmbeHighBandGain");
  const sliderUnvoicedGain = document.getElementById("sliderAmbeUnvoicedGain");
  const valUnvoicedGain = document.getElementById("valAmbeUnvoicedGain");

  const ambePresetButtons = document.querySelectorAll(".btn-ambe-preset");
  const saveAmbePresetBtn = document.getElementById("saveAmbePresetBtn");
  const saveAmbePresetText = document.getElementById("saveAmbePresetText");

  let activePresetId = localStorage.getItem("proxdmr_ambe_active_preset") || "1";

  const DEFAULT_AMBE_PRESETS = {
    "1": { spectral_enh: true, high_band_gain_db: 0.5, unvoiced_gain_db: -1.5 }, // Default / Balanced
    "2": { spectral_enh: true, high_band_gain_db: 4.5, unvoiced_gain_db: 1.0 },  // Bright / Punchy
    "3": { spectral_enh: true, high_band_gain_db: 0.0, unvoiced_gain_db: -1.5 }  // Soft Studio
  };

  function openModal() {
    ambeModal.classList.add("show");
    ambeModal.style.display = "flex";
  }

  function closeModal() {
    ambeModal.classList.remove("show");
    ambeModal.style.display = "none";
  }

  function formatDb(val) {
    const num = parseFloat(val) || 0.0;
    const u = window.t ? window.t("audio.unit_db", {}, "dB") : "dB";
    return (num > 0 ? `+${num.toFixed(1)}` : num.toFixed(1)) + " " + u;
  }

  function updateControlsUI(cfg) {
    if (chkSpectralEnh) {
      chkSpectralEnh.checked = Boolean(cfg.spectral_enh);
      if (badgeSpectralEnh) {
        badgeSpectralEnh.textContent = cfg.spectral_enh
          ? (window.t ? window.t("common.on", {}, "On") : "On")
          : (window.t ? window.t("audio.limit_off", {}, "Off") : "Off");
        badgeSpectralEnh.style.background = cfg.spectral_enh ? "#1f6feb" : "rgba(110, 118, 129, 0.4)";
      }
    }
    if (sliderHighBandGain) {
      sliderHighBandGain.value = cfg.high_band_gain_db;
      if (valHighBandGain) valHighBandGain.textContent = formatDb(cfg.high_band_gain_db);
    }
    if (sliderUnvoicedGain) {
      sliderUnvoicedGain.value = cfg.unvoiced_gain_db;
      if (valUnvoicedGain) valUnvoicedGain.textContent = formatDb(cfg.unvoiced_gain_db);
    }
  }

  function getCurrentControlsState() {
    return {
      spectral_enh: chkSpectralEnh ? chkSpectralEnh.checked : true,
      high_band_gain_db: sliderHighBandGain ? parseFloat(sliderHighBandGain.value) : 0.5,
      unvoiced_gain_db: sliderUnvoicedGain ? parseFloat(sliderUnvoicedGain.value) : -1.5
    };
  }

  let _syncTimer = null;
  function _readAmbePresetsMap() {
    const out = {};
    ["1", "2", "3"].forEach(pid => {
      const raw = localStorage.getItem(`proxdmr_ambe_preset_${pid}`);
      if (raw) {
        try {
          out[pid] = JSON.parse(raw);
          return;
        } catch (_) {}
      }
      out[pid] = null;
    });
    return out;
  }

  function sendVocoderNow() {
    clearTimeout(_syncTimer);
    _syncTimer = null;
    if (typeof window !== "undefined" && (!window.__proxdmrClientSettingsHydrated || window.__proxdmrHydratingClientSettings)) {
      return;
    }
    const state = getCurrentControlsState();
    if (window.ws && typeof window.ws.send === "function" && window.ws.readyState === WebSocket.OPEN) {
      window.ws.send(JSON.stringify({
        type: "set_vocoder_settings",
        spectral_enh: state.spectral_enh,
        high_band_gain_db: state.high_band_gain_db,
        unvoiced_gain_db: state.unvoiced_gain_db,
        active_preset: activePresetId,
        presets: _readAmbePresetsMap()
      }));
    }
  }

  function scheduleSyncSettings(immediate = false) {
    if (typeof window !== "undefined" && (!window.__proxdmrClientSettingsHydrated || window.__proxdmrHydratingClientSettings)) {
      return;
    }
    clearTimeout(_syncTimer);
    if (immediate) {
      sendVocoderNow();
      return;
    }
    _syncTimer = setTimeout(() => {
      _syncTimer = null;
      sendVocoderNow();
    }, 120);
  }

  function autoSaveCurrentAmbeState(skipRemoteSync = false, immediate = false) {
    const state = getCurrentControlsState();
    localStorage.setItem("proxdmr_ambe_active_preset", activePresetId);
    localStorage.setItem(`proxdmr_ambe_preset_${activePresetId}`, JSON.stringify(state));
    if (!skipRemoteSync) {
      scheduleSyncSettings(immediate);
      scheduleSyncClientSettings(immediate ? 0 : 250);
    }
  }

  function updatePresetButtonsUI() {
    const storedActive = localStorage.getItem("proxdmr_ambe_active_preset");
    if (storedActive && DEFAULT_AMBE_PRESETS[storedActive]) {
      activePresetId = storedActive;
    }
    ambePresetButtons.forEach(btn => {
      const pId = btn.getAttribute("data-ambe-preset");
      btn.classList.toggle("active", pId === activePresetId);
    });
    document.querySelectorAll(".btn-ambe-mini-preset .mini-preset-label").forEach(lbl => {
      lbl.textContent = `P${activePresetId}`;
    });
    document.querySelectorAll(".ambe-menu .mini-preset-item").forEach(item => {
      const pId = item.getAttribute("data-ambe-preset");
      item.classList.toggle("active", pId === activePresetId);
    });
    if (saveAmbePresetText) {
      saveAmbePresetText.textContent = window.t ? window.t("ambe.btn_save_text", { id: activePresetId }) : `Сохранить в P${activePresetId}`;
    }
    if (saveAmbePresetBtn) {
      saveAmbePresetBtn.title = window.t ? window.t("ambe.btn_save_title", { id: activePresetId }) : `Сохранить текущие параметры вокодера в пресет ${activePresetId}`;
    }
  }

  function applyAmbePreset(id, skipRemoteSync = false) {
    const candidate = id ? id.toString() : "1";
    activePresetId = DEFAULT_AMBE_PRESETS[candidate] ? candidate : "1";
    localStorage.setItem("proxdmr_ambe_active_preset", activePresetId);

    const defCfg = DEFAULT_AMBE_PRESETS[activePresetId] || DEFAULT_AMBE_PRESETS["1"];
    let parsed = null;
    const raw = localStorage.getItem(`proxdmr_ambe_preset_${activePresetId}`);
    if (raw) {
      try { parsed = JSON.parse(raw); } catch (e) {}
    }
    const cfg = Object.assign({}, defCfg, (parsed && typeof parsed === "object") ? parsed : {});

    updateControlsUI(cfg);
    updatePresetButtonsUI();
    if (!skipRemoteSync) {
      sendVocoderNow();
      scheduleSyncClientSettings(0);
    }
  }
  window.applyAmbePreset = applyAmbePreset;
  window.updateAmbePresetUI = updatePresetButtonsUI;
  window.refreshAmbeVocoderFromStorage = () => {
    const cur = localStorage.getItem("proxdmr_ambe_active_preset") || "1";
    applyAmbePreset(cur, true);
  };
  window.updateVocoderUI = (conf) => {
    if (conf && typeof conf === "object" && conf.active_preset && DEFAULT_AMBE_PRESETS[String(conf.active_preset)]) {
      localStorage.setItem("proxdmr_ambe_active_preset", String(conf.active_preset));
    }
    const cur = localStorage.getItem("proxdmr_ambe_active_preset") || "1";
    activePresetId = DEFAULT_AMBE_PRESETS[cur] ? cur : "1";
    if (conf && typeof conf === "object" && (conf.high_band_gain_db !== undefined || conf.unvoiced_gain_db !== undefined)) {
      const defCfg = DEFAULT_AMBE_PRESETS[activePresetId] || DEFAULT_AMBE_PRESETS["1"];
      const merged = Object.assign({}, defCfg, conf);
      updateControlsUI(merged);
      updatePresetButtonsUI();
    } else {
      applyAmbePreset(activePresetId, true);
    }
  };

  function saveCurrentToPreset(id) {
    const targetId = DEFAULT_AMBE_PRESETS[String(id)] ? String(id) : "1";
    activePresetId = targetId;
    const state = getCurrentControlsState();
    localStorage.setItem("proxdmr_ambe_active_preset", targetId);
    localStorage.setItem(`proxdmr_ambe_preset_${targetId}`, JSON.stringify(state));
    applyAmbePreset(targetId, false);

    if (saveAmbePresetBtn) {
      saveAmbePresetBtn.classList.add("saved-flash");
      if (saveAmbePresetText) {
        saveAmbePresetText.textContent = window.t ? window.t("ambe.btn_saved_text", { id: targetId }) : `✓ Сохранено в P${targetId}`;
      }
      setTimeout(() => {
        saveAmbePresetBtn.classList.remove("saved-flash");
        if (saveAmbePresetText) {
          saveAmbePresetText.textContent = window.t ? window.t("ambe.btn_save_text", { id: activePresetId }) : `Сохранить в P${activePresetId}`;
        }
      }, 1400);
    }
  }

  // Open modal triggers
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest(".btn-ambe-trigger") || (e.target.id === "btnAmbeMain" ? e.target : null);
    if (trigger) {
      e.preventDefault();
      e.stopPropagation();
      const curId = localStorage.getItem("proxdmr_ambe_active_preset") || activePresetId || "1";
      applyAmbePreset(curId, true);
      openModal();
    }
  });

  if (closeBtn) closeBtn.addEventListener("click", () => {
    closeModal();
    if (typeof window.flushPendingClientSettingsSync === "function") {
      window.flushPendingClientSettingsSync();
    }
  });
  if (bottomSaveBtn) bottomSaveBtn.addEventListener("click", () => {
    saveCurrentToPreset(activePresetId);
    closeModal();
  });
  if (resetBtn) resetBtn.addEventListener("click", () => {
    const def = DEFAULT_AMBE_PRESETS[activePresetId] || DEFAULT_AMBE_PRESETS["1"];
    updateControlsUI(def);
    saveCurrentToPreset(activePresetId);
  });

  if (ambeModal) {
    ambeModal.addEventListener("click", (e) => {
      if (e.target === ambeModal) {
        closeModal();
        if (typeof window.flushPendingClientSettingsSync === "function") {
          window.flushPendingClientSettingsSync();
        }
      }
    });
  }

  // Controls input events
  if (chkSpectralEnh) {
    chkSpectralEnh.addEventListener("change", () => {
      if (badgeSpectralEnh) {
        badgeSpectralEnh.textContent = chkSpectralEnh.checked
          ? (window.t ? window.t("common.on", {}, "Вкл") : "Вкл")
          : (window.t ? window.t("audio.limit_off", {}, "Выкл") : "Выкл");
        badgeSpectralEnh.style.background = chkSpectralEnh.checked ? "#1f6feb" : "rgba(110, 118, 129, 0.4)";
      }
      autoSaveCurrentAmbeState(false, true);
    });
  }

  if (sliderHighBandGain) {
    sliderHighBandGain.addEventListener("input", () => {
      if (valHighBandGain) valHighBandGain.textContent = formatDb(sliderHighBandGain.value);
      autoSaveCurrentAmbeState(false, false);
    });
    sliderHighBandGain.addEventListener("change", () => {
      if (valHighBandGain) valHighBandGain.textContent = formatDb(sliderHighBandGain.value);
      autoSaveCurrentAmbeState(false, true);
    });
  }

  if (sliderUnvoicedGain) {
    sliderUnvoicedGain.addEventListener("input", () => {
      if (valUnvoicedGain) valUnvoicedGain.textContent = formatDb(sliderUnvoicedGain.value);
      autoSaveCurrentAmbeState(false, false);
    });
    sliderUnvoicedGain.addEventListener("change", () => {
      if (valUnvoicedGain) valUnvoicedGain.textContent = formatDb(sliderUnvoicedGain.value);
      autoSaveCurrentAmbeState(false, true);
    });
  }

  // Preset buttons
  ambePresetButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const pId = btn.getAttribute("data-ambe-preset");
      if (pId) applyAmbePreset(pId, false);
    });
  });

  if (saveAmbePresetBtn) {
    saveAmbePresetBtn.addEventListener("click", () => {
      saveCurrentToPreset(activePresetId);
    });
  }

  window.addEventListener("languageChanged", () => {
    updateControlsUI(getCurrentControlsState());
    updatePresetButtonsUI();
  });

  // Initial load without mutating server before WS init
  applyAmbePreset(activePresetId, true);
}

if (typeof window !== "undefined") {
  window.setupDsdfmeModal = setupDsdfmeModal;
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.setupDsdfmeModal = setupDsdfmeModal;
}

export default { setupDsdfmeModal };
