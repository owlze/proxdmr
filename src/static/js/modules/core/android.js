import { disableAllTranscribe } from '../dmr/transcriber.js?v=2.9.729';
import { initHapticSettingsUI } from './haptic.js?v=2.9.711';
import { showToast } from './toast.js?v=2.9.699';

/**
 * Android Bridge & APK Client Integration Module
 * Handles Tailscale settings, APK version display, full app exit,
 * and Android-specific header button modifications.
 */

export function isProxDmrApkMode() {
  return Boolean(
    (typeof window !== "undefined" && window.AndroidBridge && (
      typeof window.AndroidBridge.exitApp === "function" ||
      typeof window.AndroidBridge.exitAppWithTexts === "function"
    )) ||
    (typeof document !== "undefined" && (
      (document.body && document.body.classList.contains("is-apk-mode")) ||
      (document.documentElement && document.documentElement.classList.contains("is-apk-mode"))
    ))
  );
}

export function requestAndroidExit() {
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

export function wireAndroidExitButton(btn) {
  if (!btn || btn._androidExitWired) return;
  btn._androidExitWired = true;
  btn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });
  btn.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
  btn.addEventListener("click", (e) => {
    if (e._androidExitHandled) return;
    e._androidExitHandled = true;
    e.preventDefault();
    e.stopPropagation();
    requestAndroidExit();
  });
}

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

  const isApk = isProxDmrApkMode();

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

    // Hardware PTT Button configuration (APK v1.35+)
    initHardwarePttSettingsUI();

    // Full exit button in settings
    const authServerSettingsRow = document.getElementById("authServerSettingsRow");
    if (authServerSettingsRow) {
      authServerSettingsRow.style.display = "block";
    }

    const btnServerSettings = document.getElementById("btnAndroidServerSettings");
    if (btnServerSettings && !btnServerSettings._wired) {
      btnServerSettings._wired = true;
      btnServerSettings.addEventListener("click", () => {
        if (window.AndroidBridge && typeof window.AndroidBridge.openServerSettings === "function") {
          try {
            window.AndroidBridge.openServerSettings();
          } catch (err) {
            console.warn("[AndroidBridge] openServerSettings failed:", err);
          }
        }
      });
    }

    const btnExit = document.getElementById("btnExitApp");
    if (btnExit) {
      btnExit.addEventListener("click", () => {
        requestAndroidExit();
      });
    }

    document.body.classList.add("is-apk-mode");
    if (document.documentElement) {
      document.documentElement.classList.add("is-apk-mode");
    }

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

    // Replace fullscreen button with exit button on #proxdmrTopToolbar
    const mainExitBtn = document.querySelector("#proxdmrTopToolbar .fullscreen-toggle-btn, .proxdmr-top-toolbar .fullscreen-toggle-btn, .fullscreen-toggle-btn");
    if (mainExitBtn) {
      mainExitBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      const exitTitle = typeof window.t === "function" ? window.t("app.quit_title", {}, "Полный выход из приложения") : "Полный выход из приложения";
      mainExitBtn.title = exitTitle;
      mainExitBtn.setAttribute("aria-label", exitTitle);
      mainExitBtn.classList.add("android-exit-btn");
      // Remove old fullscreen click handler by cloning
      const newBtn = mainExitBtn.cloneNode(true);
      mainExitBtn.parentNode.replaceChild(newBtn, mainExitBtn);
      wireAndroidExitButton(newBtn);
    }

    if (!window._androidExitDelegationWired) {
      window._androidExitDelegationWired = true;
      document.addEventListener("pointerdown", (e) => {
        if (e.target && e.target.closest && e.target.closest(".android-exit-btn")) {
          e.stopPropagation();
        }
      });
      document.addEventListener("mousedown", (e) => {
        if (e.target && e.target.closest && e.target.closest(".android-exit-btn")) {
          e.stopPropagation();
        }
      });
      document.addEventListener("click", (e) => {
        const exitBtn = e.target && e.target.closest ? e.target.closest(".android-exit-btn") : null;
        if (!exitBtn || e._androidExitHandled) return;
        e._androidExitHandled = true;
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

function initHardwarePttSettingsUI() {
  const select = document.getElementById("optHardwarePttMode");
  const customRow = document.getElementById("hwPttCustomRow");
  const customLabel = document.getElementById("hwPttCustomKeyLabel");
  const btnCapture = document.getElementById("btnHwPttCapture");
  const btnClear = document.getElementById("btnHwPttClear");
  const hintVolBoth = document.getElementById("hintHwPttVolBoth");
  const hintOldApk = document.getElementById("hintHwPttOldApk");
  if (!select) return;

  const bridge = window.AndroidBridge;
  const hasNativeHwPtt = Boolean(
    bridge &&
    typeof bridge.getHardwarePttConfig === "function" &&
    typeof bridge.setHardwarePttMode === "function"
  );

  if (!hasNativeHwPtt) {
    select.disabled = true;
    select.value = "off";
    if (customRow) customRow.style.display = "none";
    if (hintVolBoth) hintVolBoth.style.display = "none";
    if (hintOldApk) hintOldApk.style.display = "block";
    return;
  }

  select.disabled = false;
  if (hintOldApk) hintOldApk.style.display = "none";

  const tr = (key, fallback, params = {}) =>
    typeof window.t === "function" ? window.t(key, params, fallback) : fallback;

  let state = {
    mode: "volume_up",
    customKeyCode: -1,
    customScanCode: -1,
    customKeyName: "",
    capturing: false
  };

  function loadState() {
    try {
      const raw = bridge.getHardwarePttConfig();
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state = {
          mode: parsed.mode || "volume_up",
          customKeyCode: typeof parsed.customKeyCode === "number" ? parsed.customKeyCode : -1,
          customScanCode: typeof parsed.customScanCode === "number" ? parsed.customScanCode : -1,
          customKeyName: parsed.customKeyName || "",
          capturing: Boolean(parsed.capturing)
        };
      }
    } catch (e) {
      console.warn("[AndroidBridge] getHardwarePttConfig failed:", e);
    }
  }

  function hasCustomKey() {
    return state.customKeyCode > 0 || (state.customKeyCode === 0 && state.customScanCode > 0);
  }

  function render() {
    select.value = state.mode || "volume_up";
    if (customRow) {
      customRow.style.display = state.mode === "custom" ? "block" : "none";
    }
    if (hintVolBoth) {
      hintVolBoth.style.display = state.mode === "volume_both" ? "block" : "none";
    }
    if (customLabel) {
      if (hasCustomKey()) {
        customLabel.textContent = state.customKeyName || `Key #${state.customKeyCode}`;
        customLabel.style.color = "#58a6ff";
      } else {
        customLabel.textContent = tr("android.hw_ptt_not_assigned", "Не назначена");
        customLabel.style.color = "var(--text-secondary, #8b949e)";
      }
    }
    if (btnCapture) {
      if (state.capturing) {
        btnCapture.textContent = tr("android.hw_ptt_capturing", "⏳ Нажмите физическую кнопку... (Отмена)");
        btnCapture.style.borderColor = "#d29922";
        btnCapture.style.color = "#e3b341";
      } else {
        btnCapture.textContent = tr("android.hw_ptt_capture_btn", "🎯 Назначить кнопку");
        btnCapture.style.borderColor = "";
        btnCapture.style.color = "";
      }
    }
    if (btnClear) {
      btnClear.style.display = hasCustomKey() && !state.capturing ? "inline-flex" : "none";
    }
  }

  function cancelCaptureIfActive() {
    if (!state.capturing) return;
    state.capturing = false;
    try {
      if (typeof bridge.cancelHardwarePttKeyCapture === "function") {
        bridge.cancelHardwarePttKeyCapture();
      }
    } catch (_) {}
    render();
  }

  window.onHardwarePttKeyCaptured = function(keyCode, keyName, scanCode) {
    state.mode = "custom";
    state.customKeyCode = typeof keyCode === "number" ? keyCode : -1;
    state.customScanCode = typeof scanCode === "number" ? scanCode : -1;
    state.customKeyName = keyName || `Key #${keyCode}`;
    state.capturing = false;
    render();
    showToast(
      tr("android.hw_ptt_captured_toast", `Аппаратная кнопка PTT назначена: ${state.customKeyName}`, { key: state.customKeyName }),
      "success"
    );
  };

  window.onHardwarePttCaptureCancelled = function() {
    if (state.capturing) {
      state.capturing = false;
      render();
    }
  };

  if (!select._hwPttWired) {
    select._hwPttWired = true;
    select.addEventListener("change", () => {
      cancelCaptureIfActive();
      const nextMode = select.value || "volume_up";
      state.mode = nextMode;
      try {
        bridge.setHardwarePttMode(nextMode);
      } catch (err) {
        console.warn("[AndroidBridge] setHardwarePttMode failed:", err);
      }
      render();
    });
  }

  if (btnCapture && !btnCapture._hwPttWired) {
    btnCapture._hwPttWired = true;
    btnCapture.addEventListener("click", () => {
      if (state.capturing) {
        cancelCaptureIfActive();
        return;
      }
      state.capturing = true;
      render();
      try {
        if (typeof bridge.startHardwarePttKeyCapture === "function") {
          bridge.startHardwarePttKeyCapture();
        }
      } catch (err) {
        state.capturing = false;
        render();
        console.warn("[AndroidBridge] startHardwarePttKeyCapture failed:", err);
      }
    });
  }

  if (btnClear && !btnClear._hwPttWired) {
    btnClear._hwPttWired = true;
    btnClear.addEventListener("click", () => {
      cancelCaptureIfActive();
      state.customKeyCode = -1;
      state.customScanCode = -1;
      state.customKeyName = "";
      try {
        if (typeof bridge.clearHardwarePttCustomKey === "function") {
          bridge.clearHardwarePttCustomKey();
        }
      } catch (err) {
        console.warn("[AndroidBridge] clearHardwarePttCustomKey failed:", err);
      }
      render();
    });
  }

  // Cancel key capture automatically if the Settings modal is closed
  const settingsModal = document.getElementById("settingsModal");
  if (settingsModal && !settingsModal._hwPttObserverWired && typeof MutationObserver === "function") {
    settingsModal._hwPttObserverWired = true;
    const obs = new MutationObserver(() => {
      if (!settingsModal.classList.contains("active")) {
        cancelCaptureIfActive();
      }
    });
    obs.observe(settingsModal, { attributes: true, attributeFilter: ["class"] });
  }

  if (window.I18N && typeof window.I18N.onChange === "function" && !window._hwPttI18nWired) {
    window._hwPttI18nWired = true;
    window.I18N.onChange(() => render());
  }

  loadState();
  render();
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.initAndroidBridge = initAndroidBridge;
  window.isProxDmrApkMode = isProxDmrApkMode;
  window.requestAndroidExit = requestAndroidExit;
  window.wireAndroidExitButton = wireAndroidExitButton;
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.initAndroidBridge = initAndroidBridge;
  window.__proxdmr.requestAndroidExit = requestAndroidExit;
}
