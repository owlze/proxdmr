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
} from "../audio/volume-mute.js?v=2.9.809";
import {
  isCheckMicOnTxEnabled,
  setCheckMicOnTxEnabled
} from "../ptt/engine.js?v=2.9.792";
import { setHapticEnabled, setHapticDuration } from "../core/haptic.js?v=2.9.711";

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

    const lang = optLang ? optLang.value : undefined;
    const muteOnPtt = optMute ? optMute.checked : undefined;
    const syncHs = optSyncHs ? optSyncHs.checked : undefined;
    const syncSys = optSyncSys ? optSyncSys.checked : undefined;
    const checkMicOnTx = optCheckMic ? optCheckMic.checked : undefined;
    const singleHsAudio = optSingleHsAudio ? optSingleHsAudio.checked : undefined;
    const muteFadeEnabled = optMuteFadeEnEl ? optMuteFadeEnEl.checked : undefined;
    const muteFadeDurationRaw = optMuteFadeDurEl ? parseFloat(String(optMuteFadeDurEl.value || "").replace(",", ".")) : undefined;
    const muteFadeDuration = (muteFadeDurationRaw !== undefined && !isNaN(muteFadeDurationRaw))
      ? Math.round(Math.max(0.1, Math.min(2.0, muteFadeDurationRaw)) * 10) / 10
      : undefined;
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
