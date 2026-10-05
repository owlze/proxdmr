import { showToast } from '../core/toast.js';

  // --- Fullscreen Toggle Support for Mobile & Desktop ---
  export function isFullscreenActive() {
    return Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
  }

export async function toggleFullscreen() {
  const docEl = document.documentElement || document.body;
  const requestFn = docEl.requestFullscreen ||
                    docEl.webkitRequestFullscreen ||
                    docEl.mozRequestFullScreen ||
                    docEl.msRequestFullscreen;
  const exitFn = document.exitFullscreen ||
                 document.webkitExitFullscreen ||
                 document.mozCancelFullScreen ||
                 document.msExitFullscreen;

  if (!requestFn && !exitFn) {
    showToast(window.t ? window.t("ui.fullscreen_iphone", {}, "Для полноэкранного режима на iPhone нажмите «Поделиться» ⎋ и выберите «На экран Домой» 📲") : "Для полноэкранного режима на iPhone нажмите «Поделиться» ⎋ и выберите «На экран Домой» 📲");
    return;
  }

  try {
    if (!isFullscreenActive()) {
      if (requestFn) {
        await requestFn.call(docEl);
      }
    } else {
      if (exitFn) {
        await exitFn.call(document);
      }
    }
  } catch (err) {
    console.warn("[FULLSCREEN] Toggle error:", err);
    showToast(window.t ? window.t("ui.fullscreen_restricted", {}, "Браузер ограничил полноэкранный режим. Попробуйте установить как PWA (Добавить на главный экран).") : "Браузер ограничил полноэкранный режим. Попробуйте установить как PWA (Добавить на главный экран).");
  }
}

export function updateFullscreenButtonsUI() {
  if (window.AndroidBridge) return;
  const active = isFullscreenActive();
  document.querySelectorAll(".fullscreen-toggle-btn:not(.android-exit-btn)").forEach(btn => {
    btn.classList.toggle("is-fullscreen", active);
    const enterIcon = btn.querySelector(".fullscreen-icon.enter");
    const exitIcon = btn.querySelector(".fullscreen-icon.exit");
    if (enterIcon && exitIcon) {
      enterIcon.style.display = active ? "none" : "block";
      exitIcon.style.display = active ? "block" : "none";
    }
    const title = active ? (window.t ? window.t("app.fullscreen_exit", {}, "Выйти из полноэкранного режима") : "Выйти из полноэкранного режима") : (window.t ? window.t("app.fullscreen_enter", {}, "Развернуть на весь экран") : "Развернуть на весь экран");
    btn.title = title;
    btn.setAttribute("aria-label", title);
  });
}

export function handleFullscreenChange() {
  updateFullscreenButtonsUI();
  if (typeof window.handleLogHeightOnFullscreenOrResize === "function") {
    window.handleLogHeightOnFullscreenOrResize();
  }
}

export function initFullscreen() {
  updateFullscreenButtonsUI();
}

if (typeof window !== "undefined") {
  window.toggleFullscreen = toggleFullscreen;
  window.isFullscreenActive = isFullscreenActive;
  window.updateFullscreenButtonsUI = updateFullscreenButtonsUI;
  window.initFullscreen = initFullscreen;
}

document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
document.addEventListener("mozfullscreenchange", handleFullscreenChange);
document.addEventListener("MSFullscreenChange", handleFullscreenChange);

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".fullscreen-toggle-btn");
  if (btn) {
    if (btn.classList.contains("android-exit-btn")) return;
    if (window.AndroidBridge) {
      e.preventDefault();
      e.stopPropagation();
      btn.remove();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    toggleFullscreen();
  }
});

