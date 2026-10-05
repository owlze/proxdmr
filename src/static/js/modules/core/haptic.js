/**
 * ProxDMR - Haptic Feedback & Tactile Vibration Subsystem
 * Manages tactile vibration confirmation for long-press gestures,
 * PTT transmission start/stop, PTT lock toggles, and duration/intensity scaling.
 * Supports Android APK (AndroidBridge.vibrate) and Web Vibration API (navigator.vibrate).
 */

export function isHapticEnabled() {
  const saved = localStorage.getItem("proxdmr_haptic_feedback");
  if (saved !== null) return saved === "true";
  if (typeof window !== "undefined" && window.APP_SETTINGS && window.APP_SETTINGS.haptic_feedback !== undefined) {
    return Boolean(window.APP_SETTINGS.haptic_feedback);
  }
  return true; // Enabled by default
}

export function getHapticDuration() {
  const saved = localStorage.getItem("proxdmr_haptic_duration");
  if (saved !== null) {
    const val = parseInt(saved, 10);
    if (!isNaN(val) && val >= 10 && val <= 300) return val;
  }
  if (typeof window !== "undefined" && window.APP_SETTINGS && window.APP_SETTINGS.haptic_duration !== undefined) {
    const val = parseInt(window.APP_SETTINGS.haptic_duration, 10);
    if (!isNaN(val) && val >= 10 && val <= 300) return val;
  }
  return 45; // Default 45ms
}

export function setHapticEnabled(enabled, syncServer = true) {
  const boolVal = Boolean(enabled);
  localStorage.setItem("proxdmr_haptic_feedback", boolVal ? "true" : "false");
  if (typeof window !== "undefined") {
    if (!window.APP_SETTINGS) window.APP_SETTINGS = {};
    window.APP_SETTINGS.haptic_feedback = boolVal;

    // Sync UI elements if present
    const chk = document.getElementById("optHapticFeedback");
    if (chk && chk.checked !== boolVal) chk.checked = boolVal;
    const durSubrow = document.getElementById("hapticDurationSubrow");
    if (durSubrow) {
      durSubrow.style.opacity = boolVal ? "1" : "0.45";
      durSubrow.style.pointerEvents = boolVal ? "auto" : "none";
    }

    if (window.AndroidBridge && typeof window.AndroidBridge.setHapticEnabled === "function") {
      try { window.AndroidBridge.setHapticEnabled(boolVal); } catch (_) {}
    }

    if (syncServer && window.ws && window.ws.readyState === WebSocket.OPEN) {
      try {
        window.ws.send(JSON.stringify({ type: "set_haptic_feedback", enabled: boolVal }));
      } catch (_) {}
    }
  }
}

export function setHapticDuration(duration, syncServer = true) {
  let val = parseInt(duration, 10);
  if (isNaN(val)) val = 45;
  val = Math.max(15, Math.min(150, val));
  localStorage.setItem("proxdmr_haptic_duration", String(val));
  if (typeof window !== "undefined") {
    if (!window.APP_SETTINGS) window.APP_SETTINGS = {};
    window.APP_SETTINGS.haptic_duration = val;

    const slider = document.getElementById("optHapticDuration");
    if (slider && parseInt(slider.value, 10) !== val) slider.value = String(val);
    const label = document.getElementById("hapticDurationVal");
    if (label) label.textContent = `${val} мс`;

    if (window.AndroidBridge && typeof window.AndroidBridge.setHapticDuration === "function") {
      try { window.AndroidBridge.setHapticDuration(val); } catch (_) {}
    }

    if (syncServer && window.ws && window.ws.readyState === WebSocket.OPEN) {
      try {
        window.ws.send(JSON.stringify({ type: "set_haptic_duration", duration: val }));
      } catch (_) {}
    }
  }
}

export function triggerHaptic(patternOrMs = 45) {
  if (!isHapticEnabled()) return false;
  const userDuration = getHapticDuration();

  // Proportional scale factor relative to default 45ms
  const ratio = userDuration / 45;

  let scaledPattern;
  let singleMs;

  if (Array.isArray(patternOrMs)) {
    scaledPattern = patternOrMs.map(ms => Math.max(10, Math.round(ms * ratio)));
    singleMs = scaledPattern[0] || userDuration;
  } else {
    const rawMs = typeof patternOrMs === "number" ? patternOrMs : userDuration;
    singleMs = Math.max(10, Math.round(rawMs * ratio));
    scaledPattern = singleMs;
  }

  try {
    if (typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.vibrate === "function") {
      window.AndroidBridge.vibrate(singleMs);
      return true;
    } else if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(scaledPattern);
      return true;
    }
  } catch (_) {}
  return false;
}

export function initHapticSettingsUI() {
  const chk = document.getElementById("optHapticFeedback");
  const slider = document.getElementById("optHapticDuration");
  const label = document.getElementById("hapticDurationVal");
  const durSubrow = document.getElementById("hapticDurationSubrow");
  const btnTest = document.getElementById("btnTestHaptic");

  const enabled = isHapticEnabled();
  const duration = getHapticDuration();

  if (chk) {
    chk.checked = enabled;
    if (durSubrow) {
      durSubrow.style.opacity = enabled ? "1" : "0.45";
      durSubrow.style.pointerEvents = enabled ? "auto" : "none";
    }
    if (!chk._wired) {
      chk._wired = true;
      chk.addEventListener("change", () => {
        setHapticEnabled(chk.checked, true);
        if (chk.checked) {
          triggerHaptic(45);
        }
      });
    }
  }

  if (slider) {
    slider.value = String(duration);
    if (label) label.textContent = `${duration} мс`;

    if (!slider._wired) {
      slider._wired = true;
      slider.addEventListener("input", () => {
        const val = parseInt(slider.value, 10) || 45;
        if (label) label.textContent = `${val} мс`;
      });
      slider.addEventListener("change", () => {
        const val = parseInt(slider.value, 10) || 45;
        setHapticDuration(val, true);
        triggerHaptic(val);
      });
    }
  }

  if (btnTest && !btnTest._wired) {
    btnTest._wired = true;
    btnTest.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const val = slider ? (parseInt(slider.value, 10) || 45) : getHapticDuration();
      try {
        if (typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.vibrate === "function") {
          window.AndroidBridge.vibrate(val);
        } else if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(val);
        }
      } catch (_) {}
    });
  }
}

// Window bridge for global access and backwards-compatibility
if (typeof window !== "undefined") {
  window.triggerTactileVibrate = triggerHaptic;
  window.triggerHaptic = triggerHaptic;
  window.isHapticFeedbackEnabled = isHapticEnabled;
  window.setHapticFeedbackEnabled = setHapticEnabled;
  window.getHapticDuration = getHapticDuration;
  window.setHapticDuration = setHapticDuration;
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.triggerHaptic = triggerHaptic;
  window.__proxdmr.initHapticSettingsUI = initHapticSettingsUI;
}
