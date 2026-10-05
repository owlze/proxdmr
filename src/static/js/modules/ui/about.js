/**
 * ProxDMR - About & Open Source Credits Modal Subsystem
 * Module: modules/ui/about.js
 */

import { showToast } from '../core/toast.js';
import { showLongPressEffect } from './long-press.js';
import { pushNavState as _pushNavState, notifyNavClosed as _notifyNavClosed } from '../core/state.js';

  // --- About ProxDMR & Open Source Credits Modal ---
  const aboutModal = document.getElementById("aboutModal");
  const closeAboutBtn = document.getElementById("closeAboutBtn");
  const btnCloseAboutModalBottom = document.getElementById("btnCloseAboutModalBottom");
  const btnRevealEmail = document.getElementById("btnRevealEmail");
  const aboutEmailImgBox = document.getElementById("aboutEmailImgBox");
  const aboutTimerVal = document.getElementById("aboutTimerVal");
  const aboutTimerProgressBar = document.getElementById("aboutTimerProgressBar");

  let aboutAutoCloseTimer = null;
  let aboutCountdownInterval = null;
  let aboutSecondsLeft = 40;
  let aboutScrollStartTimeout = null;
  let aboutScrollAnimId = null;
  let aboutUserInteractedScroll = false;

  function resetAboutScrollToTop() {
    const list = document.querySelector(".about-credits-list");
    if (list) {
      list.scrollTop = 0;
    }
    const body = document.querySelector(".about-modal-body");
    if (body) {
      body.scrollTop = 0;
    }
    const content = document.querySelector(".about-modal-content");
    if (content) {
      content.scrollTop = 0;
    }
  }

  function startCreditsAutoScroll() {
    stopCreditsAutoScroll();
    aboutUserInteractedScroll = false;

    resetAboutScrollToTop();

    // Start auto-scroll after 5 seconds
    aboutScrollStartTimeout = setTimeout(() => {
      if (!aboutModal || !aboutModal.classList.contains("active")) return;
      if (aboutUserInteractedScroll) return;

      const list = document.querySelector(".about-credits-list");
      if (!list) return;

      const startTop = list.scrollTop;
      const maxScroll = list.scrollHeight - list.clientHeight;
      if (maxScroll <= 0) return;

      const durationMs = 30000; // Reach end in 30 seconds
      const startTime = performance.now();

      function step(now) {
        if (!aboutModal || !aboutModal.classList.contains("active")) return;
        if (aboutUserInteractedScroll) return;

        const elapsed = now - startTime;
        const progress = Math.min(1.0, elapsed / durationMs);
        list.scrollTop = startTop + (maxScroll - startTop) * progress;

        if (progress < 1.0) {
          aboutScrollAnimId = requestAnimationFrame(step);
        }
      }

      aboutScrollAnimId = requestAnimationFrame(step);
    }, 5000);
  }

  function stopCreditsAutoScroll() {
    if (aboutScrollStartTimeout) {
      clearTimeout(aboutScrollStartTimeout);
      aboutScrollStartTimeout = null;
    }
    if (aboutScrollAnimId) {
      cancelAnimationFrame(aboutScrollAnimId);
      aboutScrollAnimId = null;
    }
  }

  let emailBlinkTimer = null;
  let emailOutsideClickListener = null;

  function resetEmailBtn() {
    if (emailBlinkTimer) {
      clearTimeout(emailBlinkTimer);
      emailBlinkTimer = null;
    }
    if (emailOutsideClickListener) {
      document.removeEventListener("click", emailOutsideClickListener, true);
      document.removeEventListener("pointerdown", emailOutsideClickListener, true);
      emailOutsideClickListener = null;
    }
    if (btnRevealEmail) {
      btnRevealEmail.classList.remove("copied");
      btnRevealEmail.textContent = "e-mail";
      btnRevealEmail.title = window.t ? window.t("about.click_email") : "Показать e-mail";
      btnRevealEmail.style.display = "inline-block";
    }
    if (aboutEmailImgBox) {
      aboutEmailImgBox.style.display = "none";
    }
  }

  function fallbackCopyText(text) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      textArea.setAttribute("readonly", "");
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    } catch (err) {
      console.warn("Fallback copy failed:", err);
    }
  }

  function openAboutModal() {
    if (!aboutModal) return;

    // Reset email display: button visible, image hidden, copied state cleared
    resetEmailBtn();

    // Reset countdown to 40 seconds
    aboutSecondsLeft = 40;
    if (aboutTimerVal) aboutTimerVal.textContent = "40";
    if (aboutTimerProgressBar) aboutTimerProgressBar.style.width = "100%";

    // Clear any active timers
    if (aboutAutoCloseTimer) clearTimeout(aboutAutoCloseTimer);
    if (aboutCountdownInterval) clearInterval(aboutCountdownInterval);
    stopCreditsAutoScroll();

    // Show modal first so it is rendered in layout
    aboutModal.classList.add("active");

    // Force scroll position to the very top immediately and on next render frame
    resetAboutScrollToTop();
    requestAnimationFrame(() => {
      resetAboutScrollToTop();
    });

    // Start smooth autoscroll of credits (starts after 5s, ends at 30s)
    startCreditsAutoScroll();

    _pushNavState("modal", "aboutModal");

    // Configure APK version and date display (only in Android APK mode)
    const aboutApkVer = document.getElementById("aboutApkVersion");
    const aboutApkDate = document.getElementById("aboutApkVersionDate");
    if (aboutApkVer && aboutApkDate) {
      if (window.AndroidBridge) {
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
        } catch (e) {
          console.warn("[About] Error reading APK version from AndroidBridge:", e);
        }
        aboutApkVer.textContent = apkVer;
        aboutApkDate.textContent = apkDate;
        aboutApkVer.style.display = "inline-block";
        aboutApkDate.style.display = "inline-block";
      } else {
        aboutApkVer.style.display = "none";
        aboutApkDate.style.display = "none";
      }
    }

    // Translate modal elements if i18n is available
    if (window.__proxdmr_i18n && typeof window.__proxdmr_i18n.translateDom === "function") {
      window.__proxdmr_i18n.translateDom(aboutModal);
    }

    // Countdown interval (every 1s)
    aboutCountdownInterval = setInterval(() => {
      aboutSecondsLeft--;
      if (aboutTimerVal) aboutTimerVal.textContent = String(Math.max(0, aboutSecondsLeft));
      if (aboutTimerProgressBar) {
        const pct = Math.max(0, (aboutSecondsLeft / 40) * 100);
        aboutTimerProgressBar.style.width = `${pct}%`;
      }
      if (aboutSecondsLeft <= 0) {
        closeAboutModal();
      }
    }, 1000);

    // Auto-close timeout at 40s
    aboutAutoCloseTimer = setTimeout(() => {
      closeAboutModal();
    }, 40000);
  }

  function closeAboutModal() {
    if (!aboutModal || !aboutModal.classList.contains("active")) return;

    resetEmailBtn();

    if (aboutAutoCloseTimer) {
      clearTimeout(aboutAutoCloseTimer);
      aboutAutoCloseTimer = null;
    }
    if (aboutCountdownInterval) {
      clearInterval(aboutCountdownInterval);
      aboutCountdownInterval = null;
    }
    stopCreditsAutoScroll();
    resetAboutScrollToTop();

    aboutModal.classList.remove("active");
    _notifyNavClosed();
  }



export function initAboutModal() {
  // Pause credits autoscroll on manual user interaction
  const creditsList = document.querySelector(".about-credits-list");
  if (creditsList) {
    const onUserScroll = () => {
      aboutUserInteractedScroll = true;
      stopCreditsAutoScroll();
    };
    creditsList.addEventListener("wheel", onUserScroll, { passive: true });
    creditsList.addEventListener("touchstart", onUserScroll, { passive: true });
    creditsList.addEventListener("pointerdown", onUserScroll, { passive: true });
  }

  // Copy email to clipboard and blink 5 times at 0.5 Hz with localized confirmation
  if (btnRevealEmail) {
    btnRevealEmail.addEventListener("click", (e) => {
      e.stopPropagation();

      const emailToCopy = "proxydmr@gmail.com";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(emailToCopy).catch(() => {
          fallbackCopyText(emailToCopy);
        });
      } else {
        fallbackCopyText(emailToCopy);
      }

      if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === "function") {
        window.AndroidBridge.vibrate(40);
      } else if (navigator.vibrate) {
        try { navigator.vibrate(40); } catch (_) {}
      }

      if (emailBlinkTimer) {
        clearTimeout(emailBlinkTimer);
        emailBlinkTimer = null;
      }
      if (emailOutsideClickListener) {
        document.removeEventListener("click", emailOutsideClickListener, true);
        document.removeEventListener("pointerdown", emailOutsideClickListener, true);
        emailOutsideClickListener = null;
      }

      const copiedText = window.t ? window.t("about.email_copied") : "e-mail скопирован в буфер";
      btnRevealEmail.textContent = copiedText;
      btnRevealEmail.title = copiedText;
      btnRevealEmail.classList.remove("copied");
      void btnRevealEmail.offsetWidth; // force DOM reflow to restart CSS animation
      btnRevealEmail.classList.add("copied");

      if (aboutEmailImgBox) {
        aboutEmailImgBox.style.display = "none";
      }

      // Blink once: 1.8s total duration, then reset back to original "e-mail"
      emailBlinkTimer = setTimeout(() => {
        resetEmailBtn();
      }, 1800);

      // Cancel early if user clicks anywhere else
      setTimeout(() => {
        if (!btnRevealEmail.classList.contains("copied")) return;
        emailOutsideClickListener = (event) => {
          if (btnRevealEmail && (event.target === btnRevealEmail || btnRevealEmail.contains(event.target))) {
            return;
          }
          resetEmailBtn();
        };
        document.addEventListener("click", emailOutsideClickListener, true);
        document.addEventListener("pointerdown", emailOutsideClickListener, true);
      }, 50);
    });
  }

  // Close button handlers
  if (closeAboutBtn) {
    closeAboutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closeAboutModal();
    });
  }
  if (btnCloseAboutModalBottom) {
    btnCloseAboutModalBottom.addEventListener("click", (e) => {
      e.preventDefault();
      closeAboutModal();
    });
  }

  // Click outside (backdrop click) to close modal
  if (aboutModal) {
    aboutModal.addEventListener("click", (e) => {
      if (e.target === aboutModal) {
        closeAboutModal();
      }
    });
  }

  // Long press (Touch / Mouse hold, ~600ms) on Logo / Brand Title -> Open About Modal
  let logoLongPressTimer = null;
  let logoPressStartX = 0;
  let logoPressStartY = 0;
  let logoLongPressTriggered = false;
  let activeLogoEl = null;

  function cancelLogoLongPress() {
    if (logoLongPressTimer) {
      clearTimeout(logoLongPressTimer);
      logoLongPressTimer = null;
    }
    if (activeLogoEl) {
      activeLogoEl.classList.remove("brand-logo-holding");
      activeLogoEl = null;
    }
  }

  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const logoTarget = e.target.closest(".brand-logo-wrap, .brand-title");
    if (!logoTarget) return;

    cancelLogoLongPress();
    logoLongPressTriggered = false;
    logoPressStartX = e.clientX;
    logoPressStartY = e.clientY;
    activeLogoEl = logoTarget;
    logoTarget.classList.add("brand-logo-holding");

    logoLongPressTimer = setTimeout(() => {
      logoLongPressTimer = null;
      logoLongPressTriggered = true;
      if (activeLogoEl) {
        activeLogoEl.classList.remove("brand-logo-holding");
        activeLogoEl = null;
      }
      try {
        if (navigator.vibrate) navigator.vibrate(40);
      } catch (_) {}
      openAboutModal();
    }, 600);
  }, { passive: true });

  document.addEventListener("pointermove", (e) => {
    if (!logoLongPressTimer) return;
    const dx = Math.abs(e.clientX - logoPressStartX);
    const dy = Math.abs(e.clientY - logoPressStartY);
    if (dx > 12 || dy > 12) {
      cancelLogoLongPress();
    }
  }, { passive: true });

  document.addEventListener("pointerup", (e) => {
    if (logoLongPressTriggered) {
      const logoTarget = e.target.closest(".brand-logo-wrap, .brand-title");
      if (logoTarget) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    cancelLogoLongPress();
  });

  document.addEventListener("pointercancel", () => {
    cancelLogoLongPress();
  });

  document.addEventListener("contextmenu", (e) => {
    const logoTarget = e.target.closest(".brand-logo-wrap, .brand-title");
    if (logoTarget && (logoLongPressTriggered || logoLongPressTimer)) {
      e.preventDefault();
      cancelLogoLongPress();
    }
  });

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.openAboutModal = openAboutModal;
  window.__proxdmr.closeAboutModal = closeAboutModal;


}


export {
  openAboutModal,
  closeAboutModal,
  resetAboutScrollToTop,
  startCreditsAutoScroll,
  stopCreditsAutoScroll,
  resetEmailBtn
};

if (typeof window !== "undefined") {
  window.openAboutModal = openAboutModal;
  window.closeAboutModal = closeAboutModal;
  window.initAboutModal = initAboutModal;

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.openAboutModal = openAboutModal;
  window.__proxdmr.closeAboutModal = closeAboutModal;
}
