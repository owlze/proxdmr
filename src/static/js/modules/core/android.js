import { disableAllTranscribe } from '../dmr/transcriber.js';
import { initHapticSettingsUI } from './haptic.js';

/**
 * Android Bridge & APK Client Integration Module
 * Handles Tailscale settings, APK version display, full app exit,
 * and Android-specific header button modifications.
 */

export function initAndroidBridge() {
  initHapticSettingsUI();
  const frame = document.getElementById("androidSettingsBlock");
  const toggle = document.getElementById("androidSettingsToggle");
  if (frame && toggle && !toggle._wired) {
    toggle._wired = true;
    toggle.addEventListener("click", () => {
      frame.classList.toggle("collapsed");
    });
  }

  const isApk = Boolean(
    (window.AndroidBridge && typeof window.AndroidBridge.exitApp === "function") ||
    (typeof document !== "undefined" && document.body && document.body.classList.contains("is-apk-mode"))
  );

  if (isApk) {
    if (frame) frame.style.display = "block";
    const grpSyncSystemVolume = document.getElementById("groupSyncSystemVolume");
    if (grpSyncSystemVolume) grpSyncSystemVolume.style.display = "block";
    const optSyncSystemVolume = document.getElementById("optSyncSystemVolume");
    const hintSyncSystemVolumeWeb = document.getElementById("hintSyncSystemVolumeWeb");
    if (hintSyncSystemVolumeWeb) hintSyncSystemVolumeWeb.style.display = "none";
    if (optSyncSystemVolume) {
      optSyncSystemVolume.disabled = false;
      const saved = localStorage.getItem("proxdmr_sync_system_volume");
      optSyncSystemVolume.checked = saved !== null ? saved === "true" : true;
    }

    // Load saved Tailscale prefs from Android SharedPreferences
    try {
      const tsJson = window.AndroidBridge.getTailscaleSettings();
      const ts = JSON.parse(tsJson);
      const chkStart = document.getElementById("optTsOnStart");
      const chkResume = document.getElementById("optTsOnResume");
      if (chkStart) chkStart.checked = ts.tsOnStart;
      if (chkResume) chkResume.checked = ts.tsOnResume;

      if (chkStart) {
        chkStart.addEventListener("change", () => {
          try {
            window.AndroidBridge.setTailscaleSettings(chkStart.checked, chkResume ? chkResume.checked : true);
          } catch (err) {
            console.warn("[AndroidBridge] setTailscaleSettings failed:", err);
          }
        });
      }
      if (chkResume) {
        chkResume.addEventListener("change", () => {
          try {
            window.AndroidBridge.setTailscaleSettings(chkStart ? chkStart.checked : true, chkResume.checked);
          } catch (err) {
            console.warn("[AndroidBridge] setTailscaleSettings failed:", err);
          }
        });
      }
    } catch (e) {
      console.warn("Failed to load Tailscale settings:", e);
    }

    function requestAndroidExit() {
      try {
        if (typeof disableAllTranscribe === "function") {
          disableAllTranscribe(true);
        }
        try {
          navigator.sendBeacon("/api/transcriber/disable_all");
        } catch (_) {
          fetch("/api/transcriber/disable_all", { method: "POST", keepalive: true }).catch(() => {});
        }
        if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === "function") {
          window.AndroidBridge.vibrate(40);
        }
        if (window.AndroidBridge) {
          if (typeof window.AndroidBridge.exitAppWithTexts === "function") {
            const title = typeof window.t === "function" ? window.t("apk.exit_dialog_title", {}, "Выход из ProxDMR") : "Выход из ProxDMR";
            const msg = typeof window.t === "function" ? window.t("apk.exit_dialog_msg", {}, "Вы уверены, что хотите полностью закрыть программу?") : "Вы уверены, что хотите полностью закрыть программу?";
            const tsMsg = typeof window.t === "function" ? window.t("apk.exit_dialog_ts_msg", {}, "Tailscale VPN будет отключен.") : "Tailscale VPN будет отключен.";
            const btnExit = typeof window.t === "function" ? window.t("apk.exit_dialog_btn_exit", {}, "Выйти") : "Выйти";
            const btnCancel = typeof window.t === "function" ? window.t("apk.exit_dialog_btn_cancel", {}, "Отмена") : "Отмена";
            window.AndroidBridge.exitAppWithTexts(title, msg, tsMsg, btnExit, btnCancel);
          } else if (typeof window.AndroidBridge.exitApp === "function") {
            window.AndroidBridge.exitApp();
          }
        }
      } catch (err) {
        console.error("[EXIT] Error calling exitApp:", err);
      }
    }

    // Full exit button in settings
    const btnExit = document.getElementById("btnExitApp");
    if (btnExit) {
      btnExit.addEventListener("click", () => {
        requestAndroidExit();
      });
    }

    document.body.classList.add("is-apk-mode");

    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.setAppLanguage === "function") {
        const curLang = (window.I18N && window.I18N.currentLang) || localStorage.getItem("proxdmr_language") || localStorage.getItem("proxdmr_lang");
        if (curLang) {
          window.AndroidBridge.setAppLanguage(curLang);
        }
      }
    } catch (_) {}

    const initApkVer = document.getElementById("aboutApkVersion");
    const initApkDate = document.getElementById("aboutApkVersionDate");
    if (initApkVer && initApkDate) {
      let apkVer = "apk-1.03";
      let apkDate = "23.09.2026";
      try {
        if (typeof window.AndroidBridge.getAppVersion === "function") {
          const v = window.AndroidBridge.getAppVersion();
          if (v) apkVer = `apk-${v}`;
        }
        if (typeof window.AndroidBridge.getAppVersionDate === "function") {
          const d = window.AndroidBridge.getAppVersionDate();
          if (d) apkDate = d;
        }
      } catch (e) {}
      initApkVer.textContent = apkVer;
      initApkDate.textContent = apkDate;
      initApkVer.style.display = "inline-block";
      initApkDate.style.display = "inline-block";
    }

    // Replace fullscreen button with exit button ONLY on the main card header
    const mainExitBtn = document.querySelector("#radioContainer .fullscreen-toggle-btn, .radio-header.app-header .fullscreen-toggle-btn, .fullscreen-toggle-btn");
    if (mainExitBtn) {
      mainExitBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      const exitTitle = typeof window.t === "function" ? window.t("app.quit_title", {}, "Полный выход из приложения") : "Полный выход из приложения";
      mainExitBtn.title = exitTitle;
      mainExitBtn.setAttribute("aria-label", exitTitle);
      mainExitBtn.classList.add("android-exit-btn");
      // Remove old fullscreen click handler by cloning
      const newBtn = mainExitBtn.cloneNode(true);
      mainExitBtn.parentNode.replaceChild(newBtn, mainExitBtn);
      newBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        requestAndroidExit();
      });
    }

    // Remove any other fullscreen buttons in the document across all hotspot cards
    document.querySelectorAll(".fullscreen-toggle-btn:not(.android-exit-btn)").forEach(btn => {
      btn.remove();
    });

    // Remove fullscreen button from radio card template so no secondary cards ever have it
    const tpl = document.getElementById("radioCardTemplate");
    if (tpl && tpl.content) {
      tpl.content.querySelectorAll(".fullscreen-toggle-btn").forEach(btn => {
        btn.remove();
      });
    }
  } else {
    const optSyncSystemVolume = document.getElementById("optSyncSystemVolume");
    const hintSyncSystemVolumeWeb = document.getElementById("hintSyncSystemVolumeWeb");
    if (optSyncSystemVolume) {
      optSyncSystemVolume.disabled = true;
      optSyncSystemVolume.checked = false;
    }
    if (hintSyncSystemVolumeWeb) {
      hintSyncSystemVolumeWeb.style.display = "block";
    }
  }
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.initAndroidBridge = initAndroidBridge;
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.initAndroidBridge = initAndroidBridge;
}
