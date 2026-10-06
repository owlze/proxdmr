/**
 * ProxDMR Auth Module — Login, Logout, Settings Export/Import
 */
(function () {
  'use strict';

  // --- DOM Elements ---
  let authModal, loginForm;
  let loginError;
  let loginBtn, logoutBtn;

  // --- State ---
  let isAuthenticated = false;
  let currentUser = null;

  // --- Init (called from app.js after DOM ready) ---
  window.ProxDMRAuth = {
    init: initAuth,
    checkAuth: checkAuth,
    isAuthenticated: () => isAuthenticated,
    getUser: () => currentUser,
    logout: doLogout,
    deleteAccount: deleteAccount,
    exportSettings: exportSettings,
    importSettings: importSettings,
    importConfigFromLogin: doImportConfigFromLoginScreen,
  };

  function clearLocalUserData() {
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('proxdmr_') || k.startsWith('dmr_')) && k !== 'proxdmr_auth_token' && k !== 'proxdmr_auth_login') {
          toRemove.push(k);
        }
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }

  window.setSwlState = function (isSwl) {
    const swl = Boolean(isSwl);
    window.isSwl = swl;
    if (document.body) {
      document.body.classList.toggle('is-swl-mode', swl);
    }
    const vfoBadge = document.getElementById('vfoSwlBadge');
    if (vfoBadge) {
      vfoBadge.style.display = swl ? 'inline-flex' : 'none';
    }
    const accountBadge = document.getElementById('accountSwlBadge');
    if (accountBadge) {
      accountBadge.style.display = swl ? 'inline-block' : 'none';
    }
    // Update PTT buttons
    document.querySelectorAll('.ptt-button').forEach(btn => {
      if (swl) {
        btn.classList.add('swl-disabled');
        btn.setAttribute('title', window.t ? window.t('vfo.swl_badge_title', {}, 'Режим радиоприёмника-наблюдателя (SWL): передача отключена') : 'Режим радиоприёмника-наблюдателя (SWL): передача отключена');
      } else {
        btn.classList.remove('swl-disabled');
        btn.setAttribute('title', window.t ? window.t('ptt.dual_slot_ptt_title', {}, 'Нажмите слева для передачи на TS1, справа — на TS2') : 'Нажмите слева для передачи на TS1, справа — на TS2');
      }
    });
  };

  function updateAccountUI() {
    const span = document.getElementById('accountCurrentUsername');
    if (span) {
      span.textContent = (currentUser && currentUser.login) ? currentUser.login : '—';
    }
    const role = currentUser ? (currentUser.role || 'user') : 'user';
    const roleBadge = document.getElementById('accountUserRoleBadge');
    if (roleBadge) {
      if (role === 'superadmin') {
        roleBadge.textContent = window.t ? window.t('admin.role_superadmin', {}, '👑 Суперадмин') : '👑 Суперадмин';
        roleBadge.style.color = '#ffcc00';
        roleBadge.style.display = 'inline-block';
      } else if (role === 'admin') {
        roleBadge.textContent = window.t ? window.t('admin.role_admin', {}, '🛡️ Админ') : '🛡️ Админ';
        roleBadge.style.color = '#58a6ff';
        roleBadge.style.display = 'inline-block';
      } else {
        roleBadge.style.display = 'none';
      }
    }
    const isSwl = currentUser ? Boolean(currentUser.is_swl) : Boolean(window.isSwl);
    window.setSwlState(isSwl);

    // Superadmin: disable delete account button and show security notice
    const deleteBtn = document.getElementById('btnDeleteAccount');
    const deleteHint = document.getElementById('superadminDeleteDisabledHint');
    if (deleteBtn) {
      const deleteSpan = deleteBtn.querySelector('span[data-i18n="account.delete_btn"]') || deleteBtn.querySelector('span');
      if (role === 'superadmin') {
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = '0.45';
        deleteBtn.style.cursor = 'not-allowed';
        deleteBtn.style.filter = 'grayscale(0.6)';
        deleteBtn.title = window.t ? window.t('account.superadmin_delete_disabled', {}, '🛡️ Аккаунт суперадминистратора защищен от удаления') : '🛡️ Аккаунт суперадминистратора защищен от удаления';
        if (deleteSpan) {
          deleteSpan.textContent = window.t ? window.t('account.superadmin_delete_btn_disabled', {}, '🔒 Удаление аккаунта заблокировано') : '🔒 Удаление аккаунта заблокировано';
        }
        if (deleteHint) deleteHint.style.display = 'block';
      } else {
        deleteBtn.disabled = false;
        deleteBtn.style.opacity = '';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.filter = '';
        deleteBtn.title = '';
        if (deleteSpan) {
          deleteSpan.textContent = window.t ? window.t('account.delete_btn', {}, '🗑️ Удалить аккаунт') : '🗑️ Удалить аккаунт';
        }
        if (deleteHint) deleteHint.style.display = 'none';
      }
    }
  }

  function isApkMode() {
    return !!(window.AndroidBridge || (document.documentElement && document.documentElement.classList.contains('is-apk-mode')) || (document.body && document.body.classList.contains('is-apk-mode')));
  }

  function clearErrors() {
    if (loginError) loginError.textContent = '';
  }

  function initAuth() {
    authModal = document.getElementById('authModal');
    loginForm = document.getElementById('authLoginForm');
    loginError = document.getElementById('authLoginError');
    loginBtn = document.getElementById('authLoginBtn');
    logoutBtn = document.getElementById('btnLogout');
    const deleteBtn = document.getElementById('btnDeleteAccount');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', deleteAccount);
    }

    initOnboarding();

    if (!authModal) return;

    // In APK mode: hide 'remember me' checkbox since mobile client is always permanently remembered
    if (isApkMode()) {
      const rememberRow = document.getElementById('authRememberRow');
      if (rememberRow) rememberRow.style.display = 'none';
      const rememberChk = document.getElementById('authRememberMe');
      if (rememberChk) rememberChk.checked = true;
    }

    const authLoginInput = document.getElementById('authLoginInput');
    if (authLoginInput && !authLoginInput.value) {
      let savedLogin = '';
      if (window.AndroidBridge && typeof window.AndroidBridge.getAuthLogin === 'function') {
        savedLogin = window.AndroidBridge.getAuthLogin();
      }
      if (!savedLogin) {
        try { savedLogin = localStorage.getItem('proxdmr_auth_login') || ''; } catch (e) {}
      }
      if (savedLogin) authLoginInput.value = savedLogin;
    }

    // Login form submit
    if (loginBtn) {
      loginBtn.addEventListener('click', doLogin);
    }
    const authImportConfigBtn = document.getElementById('authImportConfigBtn');
    if (authImportConfigBtn) {
      authImportConfigBtn.addEventListener('click', doImportConfigFromLoginScreen);
    }
    if (loginForm) {
      loginForm.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
      });
    }

    // Password visibility toggles
    wirePasswordToggle('btnToggleAuthPassword', 'authPasswordInput');

    // Logout
    if (logoutBtn) {
      logoutBtn.addEventListener('click', doLogout);
    }

    // Custom logout modal buttons
    const cancelLogoutBtn = document.getElementById('btnCancelLogoutModal');
    if (cancelLogoutBtn) {
      cancelLogoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showLogoutModal(false);
      });
    }
    const confirmLogoutBtn = document.getElementById('btnConfirmLogoutModal');
    if (confirmLogoutBtn) {
      confirmLogoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        performLogout();
      });
    }
    const logoutModal = document.getElementById('authLogoutConfirmModal');
    if (logoutModal) {
      logoutModal.addEventListener('click', (e) => {
        if (e.target === logoutModal) showLogoutModal(false);
      });
    }

    // Global delegation for logout button (handles nested spans and dynamic re-renders)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#btnLogout');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        doLogout();
      }
    });
  }

  function wirePasswordToggle(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (btn && input && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = '🙈';
        } else {
          input.type = 'password';
          btn.textContent = '👁️';
        }
      });
    }
  }

  let onboardingModal = null;
  let selectedOnboardingLang = 'uk';

  function showOnboarding(show) {
    if (!onboardingModal) onboardingModal = document.getElementById('onboardingModal');
    if (!onboardingModal) return;
    if (show) {
      onboardingModal.style.display = 'flex';
      onboardingModal.classList.add('active');
      document.body.classList.add('auth-locked');
      showOnboardingStep(1);
    } else {
      onboardingModal.style.display = 'none';
      onboardingModal.classList.remove('active');
    }
  }

  function showOnboardingStep(stepNum) {
    const p1 = document.getElementById('onboardingStep1');
    const p2 = document.getElementById('onboardingStep2');
    const p3 = document.getElementById('onboardingStep3');

    if (p1) p1.style.display = (stepNum === 1) ? 'flex' : 'none';
    if (p2) p2.style.display = (stepNum === 2) ? 'flex' : 'none';
    if (p3) p3.style.display = (stepNum === 3) ? 'flex' : 'none';

    const s1 = document.getElementById('stepItem1');
    const s2 = document.getElementById('stepItem2');
    const s3 = document.getElementById('stepItem3');
    const l1 = document.getElementById('stepLine1');
    const l2 = document.getElementById('stepLine2');

    if (s1 && s2 && s3) {
      s1.classList.toggle('active', stepNum === 1);
      s1.classList.toggle('completed', stepNum > 1);

      s2.classList.toggle('active', stepNum === 2);
      s2.classList.toggle('completed', stepNum > 2);

      s3.classList.toggle('active', stepNum === 3);

      if (l1) l1.classList.toggle('completed', stepNum > 1);
      if (l2) l2.classList.toggle('completed', stepNum > 2);
    }
  }

  function initOnboarding() {
    onboardingModal = document.getElementById('onboardingModal');
    if (!onboardingModal) return;

    // Password toggles
    wirePasswordToggle('btnToggleOnboardingPwd', 'onboardingPassword');
    wirePasswordToggle('btnToggleOnboardingConfirmPwd', 'onboardingConfirmPassword');
    wirePasswordToggle('btnToggleOnboardingBmPwd', 'onboardingBmPassword');

    // Language selection
    const langCards = onboardingModal.querySelectorAll('.onboarding-lang-card');
    selectedOnboardingLang = (window.I18N ? window.I18N.currentLanguage : 'uk') || 'uk';

    // Highlight initial selected card
    langCards.forEach(c => {
      if (c.dataset.lang === selectedOnboardingLang) {
        c.classList.add('selected');
      } else {
        c.classList.remove('selected');
      }

      c.addEventListener('click', () => {
        langCards.forEach(card => card.classList.remove('selected'));
        c.classList.add('selected');
        selectedOnboardingLang = c.dataset.lang;
        if (window.I18N && typeof window.I18N.setLanguage === 'function') {
          window.I18N.setLanguage(selectedOnboardingLang);
        }
      });
    });

    // Step 1 Next
    const btnNext1 = document.getElementById('btnOnboardingNext1');
    if (btnNext1) {
      btnNext1.addEventListener('click', () => {
        showOnboardingStep(2);
        const loginInp = document.getElementById('onboardingLogin');
        if (loginInp) loginInp.focus();
      });
    }

    // Step 2 Back
    const btnBack2 = document.getElementById('btnOnboardingBack2');
    if (btnBack2) {
      btnBack2.addEventListener('click', () => {
        showOnboardingStep(1);
      });
    }

    // Step 2 Next
    const btnNext2 = document.getElementById('btnOnboardingNext2');
    const errBox2 = document.getElementById('onboardingErrorStep2');
    if (btnNext2) {
      btnNext2.addEventListener('click', () => {
        if (errBox2) { errBox2.textContent = ''; errBox2.style.display = 'none'; }
        const login = document.getElementById('onboardingLogin')?.value?.trim().toUpperCase();
        const pwd = document.getElementById('onboardingPassword')?.value;
        const conf = document.getElementById('onboardingConfirmPassword')?.value;

        if (!login) {
          if (errBox2) {
            errBox2.textContent = window.t ? window.t('setup.login_required') : 'Введите позывной или логин';
            errBox2.style.display = 'block';
          }
          return;
        }
        if (login.length < 3) {
          if (errBox2) {
            errBox2.textContent = 'Логин должен содержать минимум 3 символа';
            errBox2.style.display = 'block';
          }
          return;
        }
        if (!pwd || pwd.length < 6) {
          if (errBox2) {
            errBox2.textContent = window.t ? window.t('setup.pwd_min_len') : 'Пароль должен содержать минимум 6 символов';
            errBox2.style.display = 'block';
          }
          return;
        }
        if (pwd !== conf) {
          if (errBox2) {
            errBox2.textContent = window.t ? window.t('setup.pwd_mismatch') : 'Пароли не совпадают';
            errBox2.style.display = 'block';
          }
          return;
        }

        showOnboardingStep(3);
        const dmrInp = document.getElementById('onboardingDmrId');
        if (dmrInp) dmrInp.focus();
      });
    }

    // Step 3 Back
    const btnBack3 = document.getElementById('btnOnboardingBack3');
    if (btnBack3) {
      btnBack3.addEventListener('click', () => {
        showOnboardingStep(2);
      });
    }

    // Step 3 Finish
    const btnFinish = document.getElementById('btnOnboardingFinish');
    const errBox3 = document.getElementById('onboardingErrorStep3');
    if (btnFinish) {
      btnFinish.addEventListener('click', async () => {
        if (errBox3) { errBox3.textContent = ''; errBox3.style.display = 'none'; }
        const login = document.getElementById('onboardingLogin')?.value?.trim().toUpperCase();
        const password = document.getElementById('onboardingPassword')?.value;
        const dmrIdRaw = document.getElementById('onboardingDmrId')?.value?.trim();
        const dmrId = parseInt(dmrIdRaw, 10) || 0;
        const bmPassword = document.getElementById('onboardingBmPassword')?.value?.trim() || '';
        const bmServer = document.getElementById('onboardingBmServer')?.value?.trim() || '';

        btnFinish.disabled = true;
        const origText = btnFinish.textContent;
        btnFinish.textContent = '⏳ ...';

        try {
          const resp = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              login: login,
              password: password,
              language: selectedOnboardingLang,
              dmr_id: dmrId,
              bm_password: bmPassword,
              bm_master_host: bmServer
            })
          });

          const data = await resp.json();
          if (resp.ok && data.status === 'ok') {
            window.isFirstRun = false;
            if (data.token) {
              if (window.AndroidBridge && typeof window.AndroidBridge.saveAuthToken === 'function') {
                window.AndroidBridge.saveAuthToken(data.token, data.user?.login || login);
              }
              try {
                localStorage.setItem('proxdmr_auth_token', data.token);
                localStorage.setItem('proxdmr_auth_login', data.user?.login || login);
                localStorage.setItem('proxdmr_language', selectedOnboardingLang);
              } catch (e) {}
            }
            showOnboarding(false);
            window.location.reload();
          } else {
            const err = data.detail || 'Ошибка регистрации';
            if (errBox3) {
              errBox3.textContent = err;
              errBox3.style.display = 'block';
            }
            btnFinish.disabled = false;
            btnFinish.textContent = origText;
          }
        } catch (e) {
          if (errBox3) {
            errBox3.textContent = 'Ошибка подключения к серверу';
            errBox3.style.display = 'block';
          }
          btnFinish.disabled = false;
          btnFinish.textContent = origText;
        }
      });
    }

    if (window.isFirstRun) {
      showOnboarding(true);
    }
  }

  function showModal(show) {
    if (show) {
      if (window.isFirstRun) {
        showOnboarding(true);
        if (authModal) authModal.classList.remove('active');
        document.body.classList.add('auth-locked');
        return;
      }
      showOnboarding(false);
      if (authModal) authModal.classList.add('active');
      document.body.classList.add('auth-locked');
    } else {
      if (authModal) authModal.classList.remove('active');
      showOnboarding(false);
      document.body.classList.remove('auth-locked');
    }
  }

  // --- API calls ---

  async function checkAuth() {
    try {
      const headers = {};
      let token = null;
      if (window.AndroidBridge && typeof window.AndroidBridge.getAuthToken === 'function') {
        token = window.AndroidBridge.getAuthToken();
      }
      if (!token) {
        try { token = localStorage.getItem('proxdmr_auth_token'); } catch (e) {}
      }
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
      }
      const resp = await fetch('/api/auth/me?_t=' + Date.now(), {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: headers
      });
      if (resp.ok) {
        const data = await resp.json();
        currentUser = data.user;
        if (currentUser) {
          if (data.role) currentUser.role = data.role;
          if (data.is_swl !== undefined) currentUser.is_swl = data.is_swl;
        }
        window.currentUserId = currentUser ? (currentUser.id || currentUser.user_id) : null;
        isAuthenticated = true;
        const respToken = data.token || token;
        if (respToken) {
          if (window.AndroidBridge && typeof window.AndroidBridge.saveAuthToken === 'function') {
            window.AndroidBridge.saveAuthToken(respToken, currentUser?.login || '');
          }
          try {
            localStorage.setItem('proxdmr_auth_token', respToken);
            if (currentUser?.login) localStorage.setItem('proxdmr_auth_login', currentUser.login);
          } catch (e) {}
        }
        showModal(false);
        if (logoutBtn) logoutBtn.style.display = '';
        updateAccountUI();
        return true;
      }
    } catch (e) { /* ignore */ }
    isAuthenticated = false;
    currentUser = null;
    window.currentUserId = null;
    showModal(true);
    if (logoutBtn) logoutBtn.style.display = 'none';
    updateAccountUI();
    return false;
  }

  async function doLogin() {
    clearErrors();
    const login = document.getElementById('authLoginInput')?.value?.trim();
    const password = document.getElementById('authPasswordInput')?.value;
    const remember = isApkMode() ? true : (document.getElementById('authRememberMe')?.checked ?? true);

    if (!login || !password) {
      if (loginError) loginError.textContent = (window.t ? window.t('auth.err_enter_login_pwd', {}, 'Введите логин и пароль') : 'Введите логин и пароль');
      return;
    }

    if (loginBtn) loginBtn.disabled = true;
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ login, password, remember }),
      });
      const data = await resp.json();
      if (resp.ok) {
        currentUser = data.user;
        window.currentUserId = currentUser ? (currentUser.id || currentUser.user_id) : null;
        isAuthenticated = true;
        const token = data.token;
        if (token) {
          if (window.AndroidBridge && typeof window.AndroidBridge.saveAuthToken === 'function') {
            window.AndroidBridge.saveAuthToken(token, currentUser?.login || login);
          }
          try {
            localStorage.setItem('proxdmr_auth_token', token);
            localStorage.setItem('proxdmr_auth_login', currentUser?.login || login);
          } catch (e) {}
        }
        showModal(false);
        if (logoutBtn) logoutBtn.style.display = '';
        updateAccountUI();
        // Clear local storage for clean user isolation before reload
        clearLocalUserData();
        if (token) {
          try {
            localStorage.setItem('proxdmr_auth_token', token);
            localStorage.setItem('proxdmr_auth_login', currentUser?.login || login);
          } catch (e) {}
        }
        location.reload();
      } else {
        if (loginError) loginError.textContent = data.detail || (window.t ? window.t('auth.err_login_failed', {}, 'Ошибка входа') : 'Ошибка входа');
      }
    } catch (e) {
      if (loginError) loginError.textContent = (window.t ? window.t('auth.err_server_conn', {}, 'Ошибка подключения к серверу') : 'Ошибка подключения к серверу');
    } finally {
      if (loginBtn) loginBtn.disabled = false;
    }
  }

  function showLogoutModal(show) {
    const modal = document.getElementById('authLogoutConfirmModal');
    if (!modal) return;
    if (show) {
      modal.classList.add('active');
    } else {
      modal.classList.remove('active');
    }
  }

  function doLogout() {
    showLogoutModal(true);
  }

  async function performLogout() {
    showLogoutModal(false);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store'
      });
    } catch (e) {
      console.warn('[AUTH] Logout request failed:', e);
    }
    if (window.AndroidBridge && typeof window.AndroidBridge.clearAuthToken === 'function') {
      window.AndroidBridge.clearAuthToken();
    }
    try {
      localStorage.removeItem('proxdmr_auth_token');
      localStorage.removeItem('proxdmr_auth_login');
    } catch (e) {}
    isAuthenticated = false;
    currentUser = null;
    window.currentUserId = null;
    clearLocalUserData();
    try {
      document.cookie = 'proxdmr_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; samesite=lax';
      document.cookie = 'proxdmr_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    } catch (e) {}
    window.location.href = '/?logged_out=' + Date.now();
  }

  async function deleteAccount() {
    if (!currentUser) return;
    const t = (k, p, d) => (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(k, p, d) : (typeof p === 'string' ? p : d);
    if (currentUser.role === 'superadmin') {
      const msg = t('account.superadmin_delete_disabled', {}, '🛡️ Аккаунт суперадминистратора защищен от удаления');
      if (window.showAppAlert) {
        await window.showAppAlert(msg, { title: 'Защищено', icon: '🛡️' });
      }
      return;
    }
    const login = currentUser.login || '';
    const confirmMsg = t('account.delete_confirm', { login: login }, `Вы действительно хотите удалить аккаунт "${login}"?\nВсе настройки, хотспоты и журнал вызовов будут безвозвратно удалены.`);
    const ok = await showAppConfirm({
      title: t('auth.delete_account_title', {}, 'Удаление аккаунта'),
      icon: '🗑️',
      message: confirmMsg,
      confirmText: t('auth.continue_btn', {}, 'Продолжить'),
      confirmStyle: 'danger'
    });
    if (!ok) return;

    const promptMsg = t('account.delete_prompt', { login: login }, `Для подтверждения удаления введите ваш логин (${login}):`);
    const typed = await showAppPrompt({
      title: t('auth.delete_confirm_modal_title', {}, 'Подтверждение удаления'),
      icon: '⚠️',
      message: promptMsg,
      placeholder: login,
      confirmText: t('auth.delete_account_confirm', {}, 'Удалить аккаунт'),
      confirmStyle: 'danger'
    });
    if (!typed || typed.trim().toLowerCase() !== login.toLowerCase()) {
      if (typed !== null) {
        await showAppAlert(t('account.delete_mismatch', {}, 'Введен неверный логин. Удаление аккаунта отменено.'), { title: 'Отмена удаления', icon: 'ℹ️' });
      }
      return;
    }

    try {
      const resp = await fetch('/api/auth/delete', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await resp.json();
      if (resp.ok) {
        if (window.AndroidBridge && typeof window.AndroidBridge.clearAuthToken === 'function') {
          window.AndroidBridge.clearAuthToken();
        }
        try {
          localStorage.removeItem('proxdmr_auth_token');
          localStorage.removeItem('proxdmr_auth_login');
        } catch (e) {}
        clearLocalUserData();
        await showAppAlert(data.message || t('account.delete_success', {}, 'Аккаунт успешно удален'), { title: 'Удалено', icon: '✅' });
        isAuthenticated = false;
        currentUser = null;
        location.reload();
      } else {
        await showAppAlert(data.detail || t('auth.err_delete_title', {}, 'Ошибка при удалении аккаунта'), { title: t('common.error', {}, 'Ошибка'), icon: '⚠️' });
      }
    } catch (e) {
      await showAppAlert(t('auth.err_server_conn', {}, 'Ошибка подключения к серверу'), { title: t('auth.err_conn_title', {}, 'Ошибка связи'), icon: '⚠️' });
    }
  }

  // --- Settings Export/Import ---

  async function exportSettings() {
    const t = (k, p, d) => (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(k, p, d) : (typeof p === 'string' ? p : d);
    const promptMsg = t('account.export_prompt', {}, 'Введите пароль вашего аккаунта (он же пароль для архива 7z):');
    const password = await showAppPrompt({
      title: t('auth.export_title', {}, 'Экспорт настроек'),
      icon: '🔑',
      message: promptMsg,
      isPassword: true,
      confirmText: t('auth.export_btn', {}, 'Экспортировать')
    });
    if (!password) return;
    try {
      const resp = await fetch(`/api/user/settings/export?password=${encodeURIComponent(password)}`, {
        credentials: 'same-origin',
      });
      if (!resp.ok) {
        const data = await resp.json();
        await showAppAlert(data.detail || t('account.export_error', {}, 'Ошибка экспорта'), { title: 'Ошибка экспорта', icon: '⚠️' });
        return;
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get('Content-Disposition') || '';
      const fnMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = fnMatch ? fnMatch[1] : 'ProxDMR_backup.7z';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) {
      await showAppAlert(t('account.export_conn_error', {}, 'Ошибка при экспорте настроек'), { title: 'Ошибка связи', icon: '⚠️' });
    }
  }

  async function importSettings() {
    const t = (k, p, d) => (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(k, p, d) : (typeof p === 'string' ? p : d);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.7z';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const promptMsg = t('account.import_prompt', {}, 'Введите пароль от архива (пароль вашего аккаунта):');
      const password = await showAppPrompt({
        title: t('auth.import_title', {}, 'Импорт настроек'),
        icon: '🔑',
        message: promptMsg,
        isPassword: true,
        confirmText: t('auth.import_btn', {}, 'Импортировать')
      });
      if (password === null) return;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('password', password);

      try {
        const resp = await fetch('/api/user/settings/import', {
          method: 'POST',
          credentials: 'same-origin',
          body: formData,
        });
        const data = await resp.json();
        if (resp.ok) {
          await showAppAlert(t('account.import_success', {}, 'Настройки успешно импортированы. Страница будет перезагружена.'), { title: 'Успешно', icon: '✅' });
          clearLocalUserData();
          location.reload();
        } else {
          await showAppAlert(data.detail || t('account.import_error', {}, 'Ошибка импорта'), { title: 'Ошибка импорта', icon: '⚠️' });
        }
      } catch (e) {
        await showAppAlert(t('account.import_conn_error', {}, 'Ошибка при импорте настроек'), { title: 'Ошибка связи', icon: '⚠️' });
      }
    };
    input.click();
  }

  async function doImportConfigFromLoginScreen() {
    clearErrors();
    const t = (k, p, d) => (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(k, p, d) : (typeof p === 'string' ? p : d);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.7z';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;

      let password = document.getElementById('authPasswordInput')?.value;
      if (!password) {
        const promptMsg = t('account.import_prompt', {}, 'Введите пароль от архива (пароль вашего аккаунта):');
        password = await showAppPrompt({
          title: t('auth.import_config_title', {}, 'Импорт конфигурации'),
          icon: '🔑',
          message: promptMsg,
          isPassword: true,
          confirmText: t('auth.continue_btn', {}, 'Продолжить')
        });
        if (!password) return;
      }

      let login = document.getElementById('authLoginInput')?.value?.trim() || '';
      if (!login) {
        const promptLogin = t('account.prompt_backup_login', {}, 'Введите логин аккаунта для восстановления (оставьте пустым для автоопределения из файла):');
        const enteredLogin = await showAppPrompt({
          title: t('auth.restore_account_title', {}, 'Восстановление аккаунта'),
          icon: '👤',
          message: promptLogin,
          placeholder: t('auth.restore_login_placeholder', {}, 'логин (необязательно)'),
          confirmText: t('auth.continue_btn', {}, 'Продолжить')
        });
        if (enteredLogin !== null) {
          login = enteredLogin.trim();
        }
      }

      const remember = isApkMode() ? true : (document.getElementById('authRememberMe')?.checked ?? true);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('login', login);
      formData.append('password', password);
      formData.append('remember', remember ? 'true' : 'false');

      const importBtn = document.getElementById('authImportConfigBtn');
      if (importBtn) importBtn.disabled = true;
      if (loginError) loginError.textContent = '';

      try {
        const resp = await fetch('/api/auth/import-config', {
          method: 'POST',
          credentials: 'same-origin',
          body: formData,
        });
        const data = await resp.json();
        if (resp.ok) {
          const token = data.token;
          if (token) {
            if (window.AndroidBridge && typeof window.AndroidBridge.saveAuthToken === 'function') {
              window.AndroidBridge.saveAuthToken(token, data.user?.login || login);
            }
            try {
              localStorage.setItem('proxdmr_auth_token', token);
              localStorage.setItem('proxdmr_auth_login', data.user?.login || login);
            } catch (e) {}
          }
          await showAppAlert(t('account.import_success', {}, 'Настройки успешно импортированы. Страница будет перезагружена.'), { title: 'Успешно', icon: '✅' });
          clearLocalUserData();
          if (token) {
            try {
              localStorage.setItem('proxdmr_auth_token', token);
              localStorage.setItem('proxdmr_auth_login', data.user?.login || login);
            } catch (e) {}
          }
          location.reload();
        } else {
          const errDetail = data.detail || t('account.import_error', {}, 'Ошибка импорта');
          if (loginError) loginError.textContent = errDetail;
          await showAppAlert(errDetail, { title: t('auth.err_import_title', {}, 'Ошибка импорта'), icon: '⚠️' });
        }
      } catch (e) {
        const connErr = t('account.import_conn_error', {}, 'Ошибка при импорте настроек');
        if (loginError) loginError.textContent = connErr;
        await showAppAlert(connErr, { title: t('auth.err_conn_title', {}, 'Ошибка связи'), icon: '⚠️' });
      } finally {
        if (importBtn) importBtn.disabled = false;
      }
    };
    input.click();
  }

})();
