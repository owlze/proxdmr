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
 */

import { showToast } from "../core/toast.js";
import {
  setMuteOnPttEnabled,
  setVolumeUpPttEnabled,
  setVolumeDownPttEnabled,
  setHotspotVolumeSyncEnabled,
  setSystemVolumeSyncEnabled
} from "../audio/volume-mute.js";
import {
  isCheckMicOnTxEnabled,
  setCheckMicOnTxEnabled
} from "../ptt/engine.js?v=2.9.260";
import { setHapticEnabled, setHapticDuration } from "../core/haptic.js";

export function initGeneralSettings() {
  const optCheckMic = document.getElementById("optCheckMicOnTx");
  if (optCheckMic && !optCheckMic._wired) {
    optCheckMic._wired = true;
    optCheckMic.checked = isCheckMicOnTxEnabled();
    optCheckMic.addEventListener("change", () => {
      setCheckMicOnTxEnabled(optCheckMic.checked, true);
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

    const optCheckMic = document.getElementById("optCheckMicOnTx");

    const lang = optLang ? optLang.value : undefined;
    const muteOnPtt = optMute ? optMute.checked : undefined;
    const syncHs = optSyncHs ? optSyncHs.checked : undefined;
    const syncSys = optSyncSys ? optSyncSys.checked : undefined;
    const checkMicOnTx = optCheckMic ? optCheckMic.checked : undefined;
    const hapticFeedback = optHaptic ? optHaptic.checked : undefined;
    const hapticDuration = optHapticDur ? parseInt(optHapticDur.value, 10) : undefined;
    const hamUser = optHamUser ? optHamUser.value.trim() : undefined;
    const hamPw = optHamPw ? optHamPw.value.trim() : undefined;

    // Apply client-side states
    if (muteOnPtt !== undefined) setMuteOnPttEnabled(muteOnPtt, false);
    if (syncHs !== undefined) setHotspotVolumeSyncEnabled(syncHs, false);
    if (syncSys !== undefined) setSystemVolumeSyncEnabled(syncSys, false);
    if (checkMicOnTx !== undefined) setCheckMicOnTxEnabled(checkMicOnTx, false);
    if (hapticFeedback !== undefined) setHapticEnabled(hapticFeedback, false);
    if (hapticDuration !== undefined && !isNaN(hapticDuration)) setHapticDuration(hapticDuration, false);

    const payload = {};
    if (lang !== undefined) payload.language = lang;
    if (muteOnPtt !== undefined) payload.mute_on_ptt = muteOnPtt;
    if (syncHs !== undefined) payload.sync_hotspot_volume = syncHs;
    if (syncSys !== undefined) payload.sync_system_volume = syncSys;
    if (checkMicOnTx !== undefined) payload.check_mic_on_tx = checkMicOnTx;
    if (hapticFeedback !== undefined) payload.haptic_feedback = hapticFeedback;
    if (hapticDuration !== undefined && !isNaN(hapticDuration)) payload.haptic_duration = hapticDuration;
    if (hamUser !== undefined) payload.hamqth_username = hamUser;
    if (hamPw !== undefined) payload.hamqth_password = hamPw;

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
        if (lang !== undefined) {
          try { window.ws.send(JSON.stringify({ type: "set_language", language: lang })); } catch (_) {}
        }
      }

      if (typeof window.scheduleSyncClientSettings === "function") {
        window.scheduleSyncClientSettings();
      }

      if (data && data.status === "ok") {
        showToast(window.t ? window.t("general.settings_saved", {}, "✓ Настройки успешно сохранены") : "✓ Настройки успешно сохранены", "success");
      } else {
        showToast(window.t ? window.t("general.settings_save_err", {}, "⚠️ Ошибка сохранения настроек") : "⚠️ Ошибка сохранения настроек", "warning");
      }
    } catch (err) {
      console.warn("[GENERAL SETTINGS] Save failed:", err);
      showToast(`✕ ${err.message}`, "error");
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = originalText;
    }
  });
}
