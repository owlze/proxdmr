import { showToast } from '../core/toast.js';

/**
 * Account Management & Auth Module
 * Handles user authentication initialization, settings export/import,
 * account deletion/logout, ProxDMR server restart, and account subtabs.
 */

export function initAccountSubtabs() {
  const nav = document.getElementById("accountSubtabsNav");
  if (!nav || nav._subtabsWired) return;
  nav._subtabsWired = true;

  const buttons = nav.querySelectorAll(".account-subtab-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.accountTab;
      if (targetId) {
        switchAccountSubtab(targetId, true);
      }
    });
  });

  restoreAccountSubtab();
}

export function switchAccountSubtab(targetId, save = true) {
  const nav = document.getElementById("accountSubtabsNav");
  const buttons = nav ? nav.querySelectorAll(".account-subtab-btn") : [];
  const contents = document.querySelectorAll("#tab-account .account-subtab-content");

  const validIds = ["account-subtab-profile", "account-subtab-users"];
  if (!validIds.includes(targetId)) {
    targetId = "account-subtab-profile";
  }

  // If user is not admin (nav is hidden or ProxDMRAdmin.isAdmin() returns false), force profile subtab
  const isAdmin = window.ProxDMRAdmin && typeof window.ProxDMRAdmin.isAdmin === "function"
    ? window.ProxDMRAdmin.isAdmin()
    : (nav && nav.style.display !== "none");

  if (!isAdmin && targetId === "account-subtab-users") {
    targetId = "account-subtab-profile";
  }

  buttons.forEach(b => {
    if (b.dataset.accountTab === targetId) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });

  contents.forEach(c => {
    if (c.id === targetId) {
      c.classList.add("active");
    } else {
      c.classList.remove("active");
    }
  });

  if (save && isAdmin) {
    try {
      localStorage.setItem("proxdmr_account_subtab", targetId);
    } catch (_) {}
  }

  // If switched to users tab and admin module exists, refresh users list
  if (targetId === "account-subtab-users" && window.ProxDMRAdmin && typeof window.ProxDMRAdmin.refresh === "function") {
    window.ProxDMRAdmin.refresh();
  }
}

export function restoreAccountSubtab() {
  const nav = document.getElementById("accountSubtabsNav");
  const isAdmin = window.ProxDMRAdmin && typeof window.ProxDMRAdmin.isAdmin === "function"
    ? window.ProxDMRAdmin.isAdmin()
    : (nav && nav.style.display !== "none");

  if (!isAdmin) {
    switchAccountSubtab("account-subtab-profile", false);
    return;
  }

  let saved = null;
  try {
    saved = localStorage.getItem("proxdmr_account_subtab");
  } catch (_) {}
  const targetId = saved || "account-subtab-profile";
  switchAccountSubtab(targetId, false);
}

export function initAuth() {
  if (window.ProxDMRAuth) {
    window.ProxDMRAuth.init();
    window.ProxDMRAuth.checkAuth().then(ok => {
      if (!ok) console.log("[APP] Not authenticated, showing login modal");
    });
  }
}

export function initChangePassword() {
  const btnOpen = document.getElementById("btnOpenChangePassword");
  const panel = document.getElementById("changePasswordPanel");
  const btnCancel = document.getElementById("changePwdCancelBtn");
  const btnSubmit = document.getElementById("changePwdSubmitBtn");
  const inputCurrent = document.getElementById("changePwdCurrentInput");
  const inputNew = document.getElementById("changePwdNewInput");
  const inputConfirm = document.getElementById("changePwdConfirmInput");
  const errEl = document.getElementById("changePwdError");
  const warnSuperadmin = document.getElementById("superadminPasswordWarning");

  if (!btnOpen || !panel || btnOpen._wired) return;
  btnOpen._wired = true;

  function resetForm() {
    if (inputCurrent) inputCurrent.value = "";
    if (inputNew) inputNew.value = "";
    if (inputConfirm) inputConfirm.value = "";
    if (errEl) errEl.textContent = "";
  }

  function togglePanel(show) {
    const isVisible = show !== undefined ? show : (panel.style.display !== "block");
    panel.style.display = isVisible ? "block" : "none";
    if (isVisible) {
      resetForm();
      const user = window.ProxDMRAuth && typeof window.ProxDMRAuth.getUser === "function" ? window.ProxDMRAuth.getUser() : null;
      const role = (user && user.role) || window.currentUserRole || "user";
      const isSuper = (role === "superadmin");
      if (warnSuperadmin) {
        warnSuperadmin.style.display = isSuper ? "block" : "none";
      }
      setTimeout(() => {
        if (inputCurrent) inputCurrent.focus();
      }, 50);
    } else {
      resetForm();
    }
  }

  btnOpen.addEventListener("click", () => {
    togglePanel();
  });

  if (btnCancel) {
    btnCancel.addEventListener("click", () => {
      togglePanel(false);
    });
  }

  if (btnSubmit) {
    btnSubmit.addEventListener("click", async () => {
      const cur = inputCurrent ? inputCurrent.value : "";
      const pwd = inputNew ? inputNew.value : "";
      const confirm = inputConfirm ? inputConfirm.value : "";

      if (errEl) errEl.textContent = "";

      if (!cur) {
        if (errEl) errEl.textContent = (window.t ? window.t("account.err_enter_cur_pwd", {}, "Введите текущий пароль") : "Введите текущий пароль");
        if (inputCurrent) inputCurrent.focus();
        return;
      }

      if (!pwd || pwd.length < 6) {
        if (errEl) errEl.textContent = (window.t ? window.t("account.err_pwd_length", {}, "Новый пароль должен содержать не менее 6 символов") : "Новый пароль должен содержать не менее 6 символов");
        if (inputNew) inputNew.focus();
        return;
      }

      if (pwd !== confirm) {
        if (errEl) errEl.textContent = (window.t ? window.t("account.err_pwd_mismatch", {}, "Новые пароли не совпадают") : "Новые пароли не совпадают");
        if (inputConfirm) inputConfirm.focus();
        return;
      }

      const user = window.ProxDMRAuth && typeof window.ProxDMRAuth.getUser === "function" ? window.ProxDMRAuth.getUser() : null;
      const role = (user && user.role) || window.currentUserRole || "user";
      const isSuper = (role === "superadmin");

      if (isSuper) {
        const confirmMsg = (window.t
          ? window.t("account.superadmin_confirm_msg", {}, "ВНИМАНИЕ: Восстановить пароль суперадмина будет НЕВОЗМОЖНО!\n\nВы точно запомнили или сохранили новый пароль?")
          : "ВНИМАНИЕ: Восстановить пароль суперадмина будет НЕВОЗМОЖНО!\n\nВы точно запомнили или сохранили новый пароль?");
        const ok = await (window.showAppConfirm ? window.showAppConfirm({
          title: (window.t ? window.t("account.superadmin_warn_title", {}, "Внимание: Суперадминистратор") : "Внимание: Суперадминистратор"),
          icon: "⚠️",
          message: confirmMsg,
          confirmText: (window.t ? window.t("account.superadmin_confirm_btn", {}, "Да, сменить пароль") : "Да, сменить пароль"),
          confirmStyle: "danger"
        }) : Promise.resolve(confirm(confirmMsg)));

        if (!ok) return;
      }

      btnSubmit.disabled = true;
      const origText = btnSubmit.innerHTML;
      btnSubmit.innerHTML = `<span>⏳ ${window.t ? window.t("account.saving_pwd", {}, "Сохранение...") : "Сохранение..."}</span>`;

      try {
        const resp = await fetch("/api/user/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ current_password: cur, new_password: pwd })
        });
        const data = await resp.json();

        if (resp.ok) {
          togglePanel(false);
          const successMsg = data.message || (window.t ? window.t("account.pwd_changed_success", {}, "Пароль успешно изменен!") : "Пароль успешно изменен!");
          showToast(successMsg, 5000);
          if (window.showAppAlert) {
            await window.showAppAlert(successMsg, { title: "✅", icon: "🔑" });
          }
        } else {
          if (errEl) errEl.textContent = data.detail || (window.t ? window.t("account.err_change_pwd", {}, "Ошибка при смене пароля") : "Ошибка при смене пароля");
        }
      } catch (err) {
        if (errEl) errEl.textContent = (window.t ? window.t("account.err_network", {}, "Ошибка связи с сервером") : "Ошибка связи с сервером");
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = origText;
      }
    });
  }
}

export function initAccountManager() {
  initAccountSubtabs();
  initChangePassword();
  const btnExportSettings = document.getElementById("btnExportSettings");
  if (btnExportSettings && window.ProxDMRAuth) {
    btnExportSettings.addEventListener("click", () => window.ProxDMRAuth.exportSettings());
  }

  const btnImportSettings = document.getElementById("btnImportSettings");
  if (btnImportSettings && window.ProxDMRAuth) {
    btnImportSettings.addEventListener("click", () => window.ProxDMRAuth.importSettings());
  }

  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout && window.ProxDMRAuth) {
    btnLogout.addEventListener("click", () => window.ProxDMRAuth.logout());
  }

  const btnDeleteAccount = document.getElementById("btnDeleteAccount");
  if (btnDeleteAccount && window.ProxDMRAuth) {
    btnDeleteAccount.addEventListener("click", () => window.ProxDMRAuth.deleteAccount());
  }

  // Server restart button in Settings modal
  const btnRestartServer = document.getElementById("btnRestartServer");
  if (btnRestartServer) {
    btnRestartServer.addEventListener("click", async () => {
      const confirmMsg = (window.i18n && typeof window.i18n.t === "function")
        ? window.i18n.t("general.restart_server_confirm")
        : "Вы действительно хотите перезагрузить сервер ProxDMR?\n\nСвязь будет кратковременно прервана, после чего трансивер автоматически переподключится.";
      const ok = await (window.showAppConfirm ? window.showAppConfirm({
        title: (window.i18n && typeof window.i18n.t === "function") ? window.i18n.t("general.restart_server_title") : (window.t ? window.t("general.restart_server_title", {}, "Перезагрузка сервера") : "Перезагрузка сервера"),
        icon: "🔄",
        message: confirmMsg,
        confirmText: (window.i18n && typeof window.i18n.t === "function") ? window.i18n.t("general.restart_btn") : (window.t ? window.t("general.restart_btn", {}, "Перезагрузить") : "Перезагрузить"),
        confirmStyle: "danger"
      }) : Promise.resolve(confirm(confirmMsg)));
      if (!ok) return;

      window._isServerRestarting = true;

      try {
        if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === "function") {
          window.AndroidBridge.vibrate(40);
        }
      } catch (_) {}

      btnRestartServer.disabled = true;
      const originalHtml = btnRestartServer.innerHTML;
      const restartingBtnText = (window.i18n && typeof window.i18n.t === "function") ? window.i18n.t("general.restarting_btn") : (window.t ? window.t("general.restarting_btn", {}, "Перезагрузка...") : "Перезагрузка...");
      btnRestartServer.innerHTML = `<span>⏳ ${restartingBtnText}</span>`;

      const toastMsg = (window.i18n && typeof window.i18n.t === "function")
        ? window.i18n.t("general.restarting_toast")
        : "Сервер ProxDMR перезагружается... Ожидание восстановления связи";
      showToast(toastMsg, 8000);

      // Close settings modal
      const settingsModal = document.getElementById("settingsModal");
      if (settingsModal) {
        settingsModal.classList.remove("active");
      }

      if (typeof window.updateGwStatus === "function") {
        const restartingGwText = (window.i18n && typeof window.i18n.t === "function") ? window.i18n.t("general.restarting_gw") : (window.t ? window.t("general.restarting_gw", {}, "Перезагрузка сервера...") : "Перезагрузка сервера...");
        window.updateGwStatus(false, restartingGwText);
      }

      try {
        await fetch("/api/system/restart", {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        console.warn("[SYSTEM] Restart fetch initiated or socket reset:", err);
      }

      setTimeout(() => {
        btnRestartServer.disabled = false;
        btnRestartServer.innerHTML = originalHtml;
      }, 6000);
    });
  }
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.initAuth = initAuth;
  window.initAccountManager = initAccountManager;
  window.initAccountSubtabs = initAccountSubtabs;
  window.initChangePassword = initChangePassword;
  window.switchAccountSubtab = switchAccountSubtab;
  window.restoreAccountSubtab = restoreAccountSubtab;
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.initAuth = initAuth;
  window.__proxdmr.initAccountManager = initAccountManager;
  window.__proxdmr.initAccountSubtabs = initAccountSubtabs;
  window.__proxdmr.initChangePassword = initChangePassword;
  window.__proxdmr.switchAccountSubtab = switchAccountSubtab;
  window.__proxdmr.restoreAccountSubtab = restoreAccountSubtab;
}
