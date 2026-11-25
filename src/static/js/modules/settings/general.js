/**
 * ProxDMR - General Settings Tab Subsystem
 * Manages saving and persistence verification for all controls in Tab 3 (Общие):
 * - Wallpaper & Background Theme styling
 * - Interface Language
 * - Mute on PTT
 * - Sync Hotspots Volume
 * - Sync System Volume (Android)
 * - Volume Down -> PTT (Android)
 * - HamQTH.com Credentials
 * - System Update Notifications Toggle
 */

import { showToast } from "../core/toast.js?v=2.9.699";
import {
  isApkClient,
  setMuteOnPttEnabled,
  setVolumeUpPttEnabled,
  setVolumeDownPttEnabled,
  setHotspotVolumeSyncEnabled,
  setSystemVolumeSyncEnabled,
  isSingleHotspotAudioEnabled,
  setSingleHotspotAudioEnabled,
  isMuteFadeEnabled,
  setMuteFadeEnabled,
  getMuteFadeDuration,
  setMuteFadeDuration,
  applyMuteFadeUIAndEngine
} from "../audio/volume-mute.js?v=2.9.826";
import {
  isCheckMicOnTxEnabled,
  setCheckMicOnTxEnabled
} from "../ptt/engine.js?v=2.9.792";
import { setHapticEnabled, setHapticDuration } from "../core/haptic.js?v=2.9.711";
import {
  isShowServerLoadIndicatorEnabled,
  setShowServerLoadIndicatorEnabled,
  getServerLoadChartSettings,
  syncServerLoadChartSettingsUI,
  setServerLoadChartSettings
} from "../network/ws.js?v=2.9.826";

export function initGeneralSettings() {
  const optCheckMic = document.getElementById("optCheckMicOnTx");
  if (optCheckMic && !optCheckMic._wired) {
    optCheckMic._wired = true;
    optCheckMic.checked = isCheckMicOnTxEnabled();
    optCheckMic.addEventListener("change", () => {
      setCheckMicOnTxEnabled(optCheckMic.checked, true);
    });
  }
  const optSingleHsAudio = document.getElementById("optSingleHotspotAudio");
  if (optSingleHsAudio && !optSingleHsAudio._wired) {
    optSingleHsAudio._wired = true;
    optSingleHsAudio.checked = isSingleHotspotAudioEnabled();
    optSingleHsAudio.addEventListener("change", () => {
      setSingleHotspotAudioEnabled(optSingleHsAudio.checked, true);
    });
  }
  const optMuteFadeEn = document.getElementById("optMuteFadeEnabled");
  if (optMuteFadeEn && !optMuteFadeEn._wired) {
    optMuteFadeEn._wired = true;
    optMuteFadeEn.checked = isMuteFadeEnabled();
    optMuteFadeEn.addEventListener("change", () => {
      setMuteFadeEnabled(optMuteFadeEn.checked, true);
    });
  }
  const optMuteFadeDur = document.getElementById("optMuteFadeDuration");
  if (optMuteFadeDur && !optMuteFadeDur._wired) {
    optMuteFadeDur._wired = true;
    optMuteFadeDur.value = getMuteFadeDuration().toFixed(1);
    optMuteFadeDur.addEventListener("input", () => {
      const parsed = parseFloat(String(optMuteFadeDur.value || "").replace(",", "."));
      if (!isNaN(parsed) && parsed >= 0.1 && parsed <= 2.0) {
        setMuteFadeDuration(parsed, false);
      }
    });
    optMuteFadeDur.addEventListener("change", () => {
      setMuteFadeDuration(optMuteFadeDur.value, true);
      optMuteFadeDur.value = getMuteFadeDuration().toFixed(1);
    });
    optMuteFadeDur.addEventListener("blur", () => {
      optMuteFadeDur.value = getMuteFadeDuration().toFixed(1);
    });
  }
  applyMuteFadeUIAndEngine();
  const optShowServerLoad = document.getElementById("optShowServerLoad");
  if (optShowServerLoad && !optShowServerLoad._wired) {
    optShowServerLoad._wired = true;
    optShowServerLoad.checked = isShowServerLoadIndicatorEnabled();
    optShowServerLoad.addEventListener("change", () => {
      setShowServerLoadIndicatorEnabled(optShowServerLoad.checked, true);
    });
  }
  const optShowServerLoadApp = document.getElementById("optShowServerLoadAppearance");
  if (optShowServerLoadApp && !optShowServerLoadApp._wired) {
    optShowServerLoadApp._wired = true;
    optShowServerLoadApp.checked = isShowServerLoadIndicatorEnabled();
    optShowServerLoadApp.addEventListener("change", () => {
      setShowServerLoadIndicatorEnabled(optShowServerLoadApp.checked, true);
    });
  }

  // Wire Appearance -> Charts (ping / cpu-ram) controls
  syncServerLoadChartSettingsUI(getServerLoadChartSettings());
  const ramPicker = document.getElementById("optSysRamColorPicker");
  const cpuPicker = document.getElementById("optSysCpuColorPicker");
  const pxInput = document.getElementById("optSysChartPx");
  const secInput = document.getElementById("optSysChartSec");
  const btnResetCharts = document.getElementById("btnResetChartsSettings");

  if (ramPicker && !ramPicker._wired) {
    ramPicker._wired = true;
    ramPicker.addEventListener("input", () => {
      setServerLoadChartSettings({ ram_color: ramPicker.value }, false);
      if (typeof window.setSettingsTabDirty === "function") window.setSettingsTabDirty("tab-appearance", true);
    });
    ramPicker.addEventListener("change", () => {
      setServerLoadChartSettings({ ram_color: ramPicker.value }, true);
    });
  }
  if (cpuPicker && !cpuPicker._wired) {
    cpuPicker._wired = true;
    cpuPicker.addEventListener("input", () => {
      setServerLoadChartSettings({ cpu_color: cpuPicker.value }, false);
      if (typeof window.setSettingsTabDirty === "function") window.setSettingsTabDirty("tab-appearance", true);
    });
    cpuPicker.addEventListener("change", () => {
      setServerLoadChartSettings({ cpu_color: cpuPicker.value }, true);
    });
  }
  if (pxInput && !pxInput._wired) {
    pxInput._wired = true;
    pxInput.addEventListener("input", () => {
      const v = parseInt(pxInput.value, 10);
      if (!isNaN(v) && v >= 1 && v <= 60) {
        setServerLoadChartSettings({ scale_px: v }, false);
        if (typeof window.setSettingsTabDirty === "function") window.setSettingsTabDirty("tab-appearance", true);
      }
    });
    pxInput.addEventListener("change", () => {
      const next = setServerLoadChartSettings({ scale_px: pxInput.value }, true);
      pxInput.value = String(next.scale_px);
    });
    pxInput.addEventListener("blur", () => {
      pxInput.value = String(getServerLoadChartSettings().scale_px);
    });
  }
  if (secInput && !secInput._wired) {
    secInput._wired = true;
    secInput.addEventListener("input", () => {
      const v = parseInt(secInput.value, 10);
      if (!isNaN(v) && v >= 1 && v <= 60) {
        setServerLoadChartSettings({ scale_sec: v }, false);
        if (typeof window.setSettingsTabDirty === "function") window.setSettingsTabDirty("tab-appearance", true);
      }
    });
    secInput.addEventListener("change", () => {
      const next = setServerLoadChartSettings({ scale_sec: secInput.value }, true);
      secInput.value = String(next.scale_sec);
    });
    secInput.addEventListener("blur", () => {
      secInput.value = String(getServerLoadChartSettings().scale_sec);
    });
  }
  if (btnResetCharts && !btnResetCharts._wired) {
    btnResetCharts._wired = true;
    btnResetCharts.addEventListener("click", (e) => {
      e.preventDefault();
      const next = setServerLoadChartSettings({
        ram_color: "#3399cc",
        cpu_color: "#99cc00",
        scale_px: 1,
        scale_sec: 1
      }, true);
      if (pxInput) pxInput.value = String(next.scale_px);
      if (secInput) secInput.value = String(next.scale_sec);
    });
  }

  const pingCliPicker = document.getElementById("optPingClientColorPicker");
  const pingSrvPicker = document.getElementById("optPingServerColorPicker");
  const btnResetPing = document.getElementById("btnResetPingColors");
  if (pingCliPicker && !pingCliPicker._wired) {
    pingCliPicker._wired = true;
    pingCliPicker.addEventListener("input", () => {
      setServerLoadChartSettings({ ping_client_color: pingCliPicker.value }, false);
      if (typeof window.setSettingsTabDirty === "function") window.setSettingsTabDirty("tab-appearance", true);
    });
    pingCliPicker.addEventListener("change", () => {
      setServerLoadChartSettings({ ping_client_color: pingCliPicker.value }, true);
    });
  }
  if (pingSrvPicker && !pingSrvPicker._wired) {
    pingSrvPicker._wired = true;
    pingSrvPicker.addEventListener("input", () => {
      setServerLoadChartSettings({ ping_server_color: pingSrvPicker.value }, false);
      if (typeof window.setSettingsTabDirty === "function") window.setSettingsTabDirty("tab-appearance", true);
    });
    pingSrvPicker.addEventListener("change", () => {
      setServerLoadChartSettings({ ping_server_color: pingSrvPicker.value }, true);
    });
  }
  if (btnResetPing && !btnResetPing._wired) {
    btnResetPing._wired = true;
    btnResetPing.addEventListener("click", (e) => {
      e.preventDefault();
      setServerLoadChartSettings({
        ping_client_color: "#22c55e",
        ping_server_color: "#22c55e"
      }, true);
    });
  }

  const btnSave = document.getElementById("btnSaveGeneralSettings");
  if (!btnSave || btnSave._wired) return;
  btnSave._wired = true;

  btnSave.addEventListener("click", async () => {
    const optLang = document.getElementById("optLanguage");
    const optMute = document.getElementById("optMuteOnPtt");
    const optSyncHs = document.getElementById("optSyncHotspotVolume");
    const optSyncSys = document.getElementById("optSyncSystemVolume");
    const optHaptic = document.getElementById("optHapticFeedback");
    const optHapticDur = document.getElementById("optHapticDuration");
    const optHamUser = document.getElementById("optHamQthUsername");
    const optHamPw = document.getElementById("optHamQthPassword");
    const optDisableUpdates = document.getElementById("optDisableUpdateNotifications");

    const optCheckMic = document.getElementById("optCheckMicOnTx");
    const optSingleHsAudio = document.getElementById("optSingleHotspotAudio");
    const optMuteFadeEnEl = document.getElementById("optMuteFadeEnabled");
    const optMuteFadeDurEl = document.getElementById("optMuteFadeDuration");
    const optShowLoadEl = document.getElementById("optShowServerLoad");
    const optShowLoadAppEl = document.getElementById("optShowServerLoadAppearance");
    const optRamColEl = document.getElementById("optSysRamColorPicker");
    const optCpuColEl = document.getElementById("optSysCpuColorPicker");
    const optChartPxEl = document.getElementById("optSysChartPx");
    const optChartSecEl = document.getElementById("optSysChartSec");
    const optPingCliColEl = document.getElementById("optPingClientColorPicker");
    const optPingSrvColEl = document.getElementById("optPingServerColorPicker");

    const lang = optLang ? optLang.value : undefined;
    const muteOnPtt = optMute ? optMute.checked : undefined;
    const syncHs = optSyncHs ? optSyncHs.checked : undefined;
    const syncSys = (isApkClient() && optSyncSys && !optSyncSys.disabled) ? optSyncSys.checked : undefined;
    const checkMicOnTx = optCheckMic ? optCheckMic.checked : undefined;
    const singleHsAudio = optSingleHsAudio ? optSingleHsAudio.checked : undefined;
    const muteFadeEnabled = optMuteFadeEnEl ? optMuteFadeEnEl.checked : undefined;
    const muteFadeDurationRaw = optMuteFadeDurEl ? parseFloat(String(optMuteFadeDurEl.value || "").replace(",", ".")) : undefined;
    const muteFadeDuration = (muteFadeDurationRaw !== undefined && !isNaN(muteFadeDurationRaw))
      ? Math.round(Math.max(0.1, Math.min(2.0, muteFadeDurationRaw)) * 10) / 10
      : undefined;
    const showServerLoad = optShowLoadEl ? optShowLoadEl.checked : (optShowLoadAppEl ? optShowLoadAppEl.checked : undefined);
    const chartCfgSaved = setServerLoadChartSettings({
      ram_color: optRamColEl ? optRamColEl.value : undefined,
      cpu_color: optCpuColEl ? optCpuColEl.value : undefined,
      scale_px: optChartPxEl ? optChartPxEl.value : undefined,
      scale_sec: optChartSecEl ? optChartSecEl.value : undefined,
      ping_client_color: optPingCliColEl ? optPingCliColEl.value : undefined,
      ping_server_color: optPingSrvColEl ? optPingSrvColEl.value : undefined
    }, false);
    if (optChartPxEl) optChartPxEl.value = String(chartCfgSaved.scale_px);
    if (optChartSecEl) optChartSecEl.value = String(chartCfgSaved.scale_sec);
    const hapticFeedback = optHaptic ? optHaptic.checked : undefined;
    const hapticDuration = optHapticDur ? parseInt(optHapticDur.value, 10) : undefined;
    const hamUser = optHamUser ? optHamUser.value.trim() : undefined;
    const hamPw = optHamPw ? optHamPw.value.trim() : undefined;
    const disableUpdates = optDisableUpdates ? optDisableUpdates.checked : undefined;

    // Apply client-side states
    if (muteOnPtt !== undefined) setMuteOnPttEnabled(muteOnPtt, false);
    if (syncHs !== undefined) setHotspotVolumeSyncEnabled(syncHs, false);
    if (syncSys !== undefined) setSystemVolumeSyncEnabled(syncSys, false);
    if (checkMicOnTx !== undefined) setCheckMicOnTxEnabled(checkMicOnTx, false);
    if (singleHsAudio !== undefined) setSingleHotspotAudioEnabled(singleHsAudio, false);
    if (muteFadeEnabled !== undefined) setMuteFadeEnabled(muteFadeEnabled, false);
    if (muteFadeDuration !== undefined) {
      setMuteFadeDuration(muteFadeDuration, false);
      if (optMuteFadeDurEl) optMuteFadeDurEl.value = muteFadeDuration.toFixed(1);
    }
    if (showServerLoad !== undefined) setShowServerLoadIndicatorEnabled(showServerLoad, false);
    if (hapticFeedback !== undefined) setHapticEnabled(hapticFeedback, false);
    if (hapticDuration !== undefined && !isNaN(hapticDuration)) setHapticDuration(hapticDuration, false);
    if (disableUpdates !== undefined) window.DISABLE_UPDATE_NOTIFICATIONS = disableUpdates;
    if (typeof window.commitPendingThemeSettings === "function") {
      window.commitPendingThemeSettings();
    }

    const payload = {};
    if (lang !== undefined) payload.language = lang;
    if (muteOnPtt !== undefined) payload.mute_on_ptt = muteOnPtt;
    if (syncHs !== undefined) payload.sync_hotspot_volume = syncHs;
    if (syncSys !== undefined) payload.sync_system_volume = syncSys;
    if (checkMicOnTx !== undefined) payload.check_mic_on_tx = checkMicOnTx;
    if (singleHsAudio !== undefined) payload.single_hotspot_audio = singleHsAudio;
    if (muteFadeEnabled !== undefined) payload.mute_fade_enabled = muteFadeEnabled;
    if (muteFadeDuration !== undefined) payload.mute_fade_duration = muteFadeDuration;
    if (showServerLoad !== undefined) payload.show_server_load_indicator = showServerLoad;
    payload.server_load_ram_color = chartCfgSaved.ram_color;
    payload.server_load_cpu_color = chartCfgSaved.cpu_color;
    payload.server_load_scale_px = chartCfgSaved.scale_px;
    payload.server_load_scale_sec = chartCfgSaved.scale_sec;
    payload.ping_client_color = chartCfgSaved.ping_client_color;
    payload.ping_server_color = chartCfgSaved.ping_server_color;
    if (hapticFeedback !== undefined) payload.haptic_feedback = hapticFeedback;
    if (hapticDuration !== undefined && !isNaN(hapticDuration)) payload.haptic_duration = hapticDuration;
    if (hamUser !== undefined) payload.hamqth_username = hamUser;
    if (hamPw !== undefined) payload.hamqth_password = hamPw;
    if (disableUpdates !== undefined) payload.disable_update_notifications = disableUpdates;

    btnSave.disabled = true;
    const originalText = btnSave.textContent;
    btnSave.textContent = window.t ? window.t("common.saving", {}, "Сохранение...") : "Сохранение...";

    try {
      const resp = await fetch("/api/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();

      if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        if (muteOnPtt !== undefined) {
          try { window.ws.send(JSON.stringify({ type: "set_mute_on_ptt", enabled: muteOnPtt })); } catch (_) {}
        }
        if (checkMicOnTx !== undefined) {
          try { window.ws.send(JSON.stringify({ type: "set_check_mic_on_tx", enabled: checkMicOnTx })); } catch (_) {}
        }
        if (singleHsAudio !== undefined) {
          try { window.ws.send(JSON.stringify({ type: "set_single_hotspot_audio", enabled: singleHsAudio })); } catch (_) {}
        }
        if (muteFadeEnabled !== undefined) {
          try { window.ws.send(JSON.stringify({ type: "set_mute_fade_enabled", enabled: muteFadeEnabled })); } catch (_) {}
        }
        if (muteFadeDuration !== undefined) {
          try { window.ws.send(JSON.stringify({ type: "set_mute_fade_duration", duration: muteFadeDuration })); } catch (_) {}
        }
        if (showServerLoad !== undefined) {
          try { window.ws.send(JSON.stringify({ type: "set_show_server_load_indicator", enabled: showServerLoad })); } catch (_) {}
        }
        try {
          window.ws.send(JSON.stringify({
            type: "set_server_load_chart_settings",
            ram_color: chartCfgSaved.ram_color,
            cpu_color: chartCfgSaved.cpu_color,
            scale_px: chartCfgSaved.scale_px,
            scale_sec: chartCfgSaved.scale_sec,
            ping_client_color: chartCfgSaved.ping_client_color,
            ping_server_color: chartCfgSaved.ping_server_color
          }));
        } catch (_) {}
        if (lang !== undefined) {
          try { window.ws.send(JSON.stringify({ type: "set_language", language: lang })); } catch (_) {}
        }
      }

      if (typeof window.scheduleSyncClientSettings === "function") {
        window.scheduleSyncClientSettings();
      }

      if (data && data.status === "ok") {
        showToast(window.t ? window.t("general.settings_saved", {}, "✓ Настройки успешно сохранены") : "✓ Настройки успешно сохранены", "success");
        if (typeof window.clearSettingsTabDirty === "function") {
          window.clearSettingsTabDirty("tab-general");
          window.clearSettingsTabDirty("tab-appearance");
        }
        if (typeof window.triggerModalSavePulse === "function") {
          window.triggerModalSavePulse(btnSave, { closeSettings: false });
        }
      } else {
        showToast(window.t ? window.t("general.settings_save_err", {}, "⚠️ Ошибка сохранения настроек") : "⚠️ Ошибка сохранения настроек", "warning");
        if (window._settingsModalAutoCloseTimer) {
          clearTimeout(window._settingsModalAutoCloseTimer);
          window._settingsModalAutoCloseTimer = null;
        }
      }
    } catch (err) {
      console.warn("[GENERAL SETTINGS] Save failed:", err);
      showToast(`✕ ${err.message}`, "error");
      if (window._settingsModalAutoCloseTimer) {
        clearTimeout(window._settingsModalAutoCloseTimer);
        window._settingsModalAutoCloseTimer = null;
      }
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = originalText;
    }
  });
}
