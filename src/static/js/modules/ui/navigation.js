/**
 * ProxDMR - Global Navigation, Modal Stack & Back Handling Subsystem
 * Module: modules/ui/navigation.js
 */

  // --- Central App Navigation & Back State Management ---
  let _navHistoryDepth = 0;
  let _isProgrammaticNavPop = false;

  function pushNavState(type = "view", id = "") {
    try {
      _navHistoryDepth++;
      window.history.pushState({ proxdmr_nav: true, depth: _navHistoryDepth, type, id }, "");
    } catch (_) {}
  }

  window.notifyNavClosed = notifyNavClosed;
  function notifyNavClosed() {
    if (_navHistoryDepth > 0) {
      _navHistoryDepth--;
      _isProgrammaticNavPop = true;
      try {
        window.history.back();
      } catch (_) {}
      setTimeout(() => {
        _isProgrammaticNavPop = false;
      }, 150);
    }
  }

  // --- Mutual Primary Modals Exclusivity Helper ---
  export function closePrimaryModals(exceptId = null) {
    const primaryModals = [
      {
        id: "settingsModal",
        close: () => {
          const m = document.getElementById("settingsModal");
          if (m) {
            m.classList.remove("active");
            m.style.display = "";
          }
        }
      },
      {
        id: "searchTgIdModal",
        close: () => {
          if (typeof window.closeSearchTgIdModal === "function") {
            window.closeSearchTgIdModal();
          } else {
            const m = document.getElementById("searchTgIdModal");
            if (m) {
              m.classList.remove("active");
              m.style.display = "";
            }
          }
        }
      },
      {
        id: "myContactsModal",
        close: () => {
          if (typeof window.closeMyContactsModal === "function") {
            window.closeMyContactsModal();
          } else {
            const m = document.getElementById("myContactsModal");
            if (m) {
              m.classList.remove("active");
              m.style.display = "";
            }
          }
        }
      },
      {
        id: "bmTgStaticModal",
        close: () => {
          if (typeof window.closeBmTgStaticModal === "function") {
            window.closeBmTgStaticModal();
          } else {
            const m = document.getElementById("bmTgStaticModal");
            if (m) {
              m.classList.remove("active");
              m.style.display = "";
            }
          }
        }
      },
      {
        id: "dsdfmeModal",
        close: () => {
          const m = document.getElementById("dsdfmeModal");
          if (m) {
            m.classList.remove("active");
            m.style.display = "";
          }
        }
      },
      {
        id: "audioRxModal",
        close: () => {
          const m = document.getElementById("audioRxModal");
          if (m) {
            m.classList.remove("active");
            m.style.display = "";
          }
        }
      },
      {
        id: "audioTxModal",
        close: () => {
          const m = document.getElementById("audioTxModal");
          if (m) {
            m.classList.remove("active");
            m.style.display = "";
          }
        }
      }
    ];

    primaryModals.forEach(item => {
      if (item.id === exceptId) return;
      const el = document.getElementById(item.id);
      if (el && (el.classList.contains("active") || el.style.display === "flex")) {
        try {
          item.close();
        } catch (_) {
          el.classList.remove("active");
          el.style.display = "";
        }
      }
    });
  }
  if (typeof window !== "undefined") {
    window.closePrimaryModals = closePrimaryModals;
  }



  // --- Global Unified Back Navigation Handler (Browser + Android APK + PC Escape Key) ---
  export function handleAppBack(fromPopstate = false) {
    // -1. Auth Modal (Mandatory Login Screen): user skipping auth immediately exits application
    const authModalEl = document.getElementById("authModal");
    if (authModalEl && authModalEl.classList.contains("active")) {
      if (window.AndroidBridge && typeof window.AndroidBridge.exitImmediately === "function") {
        window.AndroidBridge.exitImmediately();
        return true;
      }
      if (window.AndroidBridge && typeof window.AndroidBridge.exitApp === "function") {
        window.AndroidBridge.exitApp();
        return true;
      }
      // In browser: do not dismiss modal while unauthenticated
      return true;
    }

    // 0. Transient popups & overlays
    const modelPickerOverlay = document.getElementById("transcriberModelPickerOverlay");
    if (modelPickerOverlay) {
      if (typeof window.closeTranscriberModelPicker === "function") {
        window.closeTranscriberModelPicker();
      } else {
        modelPickerOverlay.remove();
      }
      return true;
    }

    const openMenus = document.querySelectorAll(".mini-preset-menu.show");
    if (openMenus.length > 0) {
      openMenus.forEach(m => m.classList.remove("show"));
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    const bmApiHelpCardEl = document.getElementById("bmApiHelpCard");
    if (bmApiHelpCardEl && !bmApiHelpCardEl.classList.contains("hidden")) {
      bmApiHelpCardEl.classList.add("hidden");
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    // 1. Topmost sub-modals, confirmations & editors (stacked on top of other modals)
    const directCallModalEl = document.getElementById("directCallModal");
    if (directCallModalEl && directCallModalEl.classList.contains("active")) {
      if (typeof window.closeDirectCallModal === "function") {
        window.closeDirectCallModal(fromPopstate);
      } else {
        directCallModalEl.classList.remove("active");
        if (!fromPopstate) notifyNavClosed();
      }
      return true;
    }

    const quickMemPickerModalEl = document.getElementById("quickMemPickerModal");
    if (quickMemPickerModalEl && quickMemPickerModalEl.classList.contains("active")) {
      if (typeof window.closeQuickMemPicker === "function") {
        window.closeQuickMemPicker(fromPopstate);
      } else {
        quickMemPickerModalEl.classList.remove("active");
        if (!fromPopstate) notifyNavClosed();
      }
      return true;
    }

    const tgIdActionMenuModalEl = document.getElementById("tgIdActionMenuModal");
    if (tgIdActionMenuModalEl && tgIdActionMenuModalEl.classList.contains("active")) {
      if (typeof window.closeTgIdActionMenu === "function") {
        window.closeTgIdActionMenu(fromPopstate);
      } else {
        tgIdActionMenuModalEl.classList.remove("active");
        if (!fromPopstate) notifyNavClosed();
      }
      return true;
    }

    const fileConfirmModal = document.getElementById("bmFileConfirmModal");
    if (fileConfirmModal && fileConfirmModal.classList.contains("active")) {
      fileConfirmModal.classList.remove("active");
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    const contactCallProposalModalEl = document.getElementById("contactCallProposalModal");
    if (contactCallProposalModalEl && contactCallProposalModalEl.classList.contains("active")) {
      if (typeof window.closeContactCallProposalModal === "function") {
        window.closeContactCallProposalModal();
      } else {
        contactCallProposalModalEl.classList.remove("active");
      }
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    const contactEditModalEl = document.getElementById("contactEditModal");
    if (contactEditModalEl && contactEditModalEl.classList.contains("active")) {
      if (typeof window.closeContactEditModal === "function") {
        window.closeContactEditModal();
      } else {
        contactEditModalEl.classList.remove("active");
      }
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    const bmInfoModalEl = document.getElementById("bmInfoModal");
    if (bmInfoModalEl && bmInfoModalEl.classList.contains("active")) {
      if (typeof window.closeBmInfoModal === "function") {
        window.closeBmInfoModal();
      } else {
        bmInfoModalEl.classList.remove("active");
        if (!fromPopstate) notifyNavClosed();
      }
      return true;
    }

    const aboutModalEl = document.getElementById("aboutModal");
    if (aboutModalEl && aboutModalEl.classList.contains("active")) {
      if (typeof window.closeAboutModal === "function") {
        window.closeAboutModal();
      } else {
        aboutModalEl.classList.remove("active");
        if (!fromPopstate) notifyNavClosed();
      }
      return true;
    }

    const bmBenchmarkModalEl = document.getElementById("bmBenchmarkModal");
    if (bmBenchmarkModalEl && bmBenchmarkModalEl.classList.contains("active")) {
      if (typeof window.closeBmBenchmarkModal === "function") {
        window.closeBmBenchmarkModal();
      } else {
        bmBenchmarkModalEl.classList.remove("active");
        if (!fromPopstate) notifyNavClosed();
      }
      return true;
    }

    // 2. Primary Functional Modals
    const quickAssignModalEl = document.getElementById("quickAssignModal");
    if (quickAssignModalEl && quickAssignModalEl.classList.contains("active")) {
      if (typeof window.closeQuickAssignModal === "function") {
        window.closeQuickAssignModal();
      } else {
        quickAssignModalEl.classList.remove("active");
        if (!fromPopstate) notifyNavClosed();
      }
      return true;
    }

    const searchTgIdModalEl = document.getElementById("searchTgIdModal");
    if (searchTgIdModalEl && searchTgIdModalEl.classList.contains("active")) {
      if (typeof window.closeSearchTgIdModal === "function") {
        window.closeSearchTgIdModal();
      } else {
        searchTgIdModalEl.classList.remove("active");
        if (!fromPopstate) notifyNavClosed();
      }
      return true;
    }

    const myContactsModalEl = document.getElementById("myContactsModal");
    if (myContactsModalEl && myContactsModalEl.classList.contains("active")) {
      if (typeof window.closeMyContactsModal === "function") {
        window.closeMyContactsModal();
      } else {
        myContactsModalEl.classList.remove("active");
        if (!fromPopstate) notifyNavClosed();
      }
      return true;
    }

    const bmTgStaticModalEl = document.getElementById("bmTgStaticModal");
    if (bmTgStaticModalEl && bmTgStaticModalEl.classList.contains("active")) {
      if (typeof window.closeBmTgStaticModal === "function") {
        window.closeBmTgStaticModal();
      } else {
        bmTgStaticModalEl.classList.remove("active");
        if (!fromPopstate) notifyNavClosed();
      }
      return true;
    }

    const audioRxModalEl = document.getElementById("audioRxModal");
    if (audioRxModalEl && audioRxModalEl.classList.contains("active")) {
      audioRxModalEl.classList.remove("active");
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    const audioTxModalEl = document.getElementById("audioTxModal");
    if (audioTxModalEl && audioTxModalEl.classList.contains("active")) {
      audioTxModalEl.classList.remove("active");
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    const dsdfmeModalEl = document.getElementById("dsdfmeModal");
    if (dsdfmeModalEl && dsdfmeModalEl.classList.contains("active")) {
      dsdfmeModalEl.classList.remove("active");
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    // 3. Settings modal
    const settingsModalEl = document.getElementById("settingsModal");
    if (settingsModalEl && settingsModalEl.classList.contains("active")) {
      if (typeof window.saveCurrentSettingsState === "function") {
        try {
          window.saveCurrentSettingsState();
        } catch (_) {}
      }
      settingsModalEl.classList.remove("active");
      settingsModalEl.style.display = "";
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    // Legacy aliases support (if somehow opened)
    const tgTxUseModalEl = document.getElementById("tgTxUseModal");
    if (tgTxUseModalEl && tgTxUseModalEl.classList.contains("active")) {
      if (typeof window.closeTgTxUseModal === "function") window.closeTgTxUseModal();
      else tgTxUseModalEl.classList.remove("active");
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    const callIdModalEl = document.getElementById("callIdModal");
    if (callIdModalEl && callIdModalEl.classList.contains("active")) {
      if (typeof window.closeCallIdModal === "function") window.closeCallIdModal();
      else callIdModalEl.classList.remove("active");
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    // 4. Universal Fallback: Any active modal dialog on screen (excluding mandatory authModal)
    const activeModals = Array.from(document.querySelectorAll(".modal.active, .modal-backdrop.active, [role='dialog'].active"))
      .filter(m => m.id !== "authModal" && !m.classList.contains("auth-modal"));
    if (activeModals.length > 0) {
      const topModal = activeModals[activeModals.length - 1];
      topModal.classList.remove("active");
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    // 5. Activity / Call Log drawer
    const liveMonitorPanelEl = document.getElementById("liveMonitorPanel");
    if (liveMonitorPanelEl && window.isLogVisible && !liveMonitorPanelEl.classList.contains("hidden")) {
      window.isLogVisible = false;
      if (typeof window.updateLogVisibility === "function") window.updateLogVisibility(true);
      else liveMonitorPanelEl.classList.add("hidden");
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    // 6. Maximized transcription slot zoom
    const maximizedRow = document.querySelector(".vfo-row.is-maximized");
    if (maximizedRow) {
      const slot = parseInt(maximizedRow.getAttribute("data-slot") || "1", 10);
      if (typeof window.setSlotMaximized === "function") {
        window.setSlotMaximized(maximizedRow, slot, false, true);
      } else {
        maximizedRow.classList.remove("is-maximized");
      }
      if (!fromPopstate) notifyNavClosed();
      return true;
    }

    // 7. Base screen: no active mode/modal to go back from
    return false;
  };


  // --- Global Escape Key Listener for Modals & Drawers ---
  function onGlobalEscapeKey(e) {
    const isEscape = e.key === "Escape" || e.key === "Esc" || e.code === "Escape" || e.keyCode === 27 || e.which === 27;
    if (!isEscape) return;

    if (typeof window.handleAppBack === "function") {
      const handled = window.handleAppBack(false);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        if (document.activeElement && typeof document.activeElement.blur === "function" && document.activeElement !== document.body) {
          document.activeElement.blur();
        }
      }
    }
  }



export function initNavigation() {
  // Handle smartphone "Back" gesture / browser Back button
  window.addEventListener("popstate", () => {
    if (_isProgrammaticNavPop) {
      _isProgrammaticNavPop = false;
      return;
    }
    if (_navHistoryDepth > 0) {
      _navHistoryDepth--;
    }
    window.handleAppBack(true /* fromPopstate */);
  });


  // Register in capture phase so focused inputs/controls cannot swallow Escape
  window.addEventListener("keydown", onGlobalEscapeKey, true);
  window.addEventListener("keydown", onGlobalEscapeKey, false);

  // (Keyboard Spacebar & Volume Down PTT listeners extracted to ./modules/ptt/engine.js)


}


export {
  _navHistoryDepth,
  _isProgrammaticNavPop,
  pushNavState,
  notifyNavClosed,
  onGlobalEscapeKey
};

if (typeof window !== "undefined") {
  window.pushNavState = pushNavState;
  window.notifyNavClosed = notifyNavClosed;
  window.handleAppBack = handleAppBack;
  window.onGlobalEscapeKey = onGlobalEscapeKey;
  window.initNavigation = initNavigation;

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.handleAppBack = handleAppBack;
}
