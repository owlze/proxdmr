/**
 * ProxDMR Auth Module — Login, Logout, Settings Export/Import
 */
(function () {
  'use strict';

  try {
    if (window.location && window.location.search && window.location.search.includes('logged_out=')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('logged_out');
      const cleanUrl = url.pathname + (url.search ? url.search : '') + (url.hash ? url.hash : '');
      window.history.replaceState({}, document.title, cleanUrl);
    }
  } catch (e) {}

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
    releaseAuthShield: releaseAuthShield,
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
        btn.setAttribute('data-i18n-title', 'vfo.swl_badge_title');
      } else {
        btn.classList.remove('swl-disabled');
        const card = btn.closest('.radio-container');
        const cNet = card ? String(card.dataset.networkType || '').toLowerCase() : '';
        const isSingle = Boolean(card && (card.classList.contains('card-net-ysf') || card.classList.contains('card-net-m17') || card.classList.contains('card-net-allstar') || cNet === 'ysf' || cNet === 'm17' || cNet === 'allstar'));
        if (isSingle) {
          btn.removeAttribute('title');
          btn.removeAttribute('data-i18n-title');
        } else {
          btn.setAttribute('title', window.t ? window.t('ptt.dual_slot_ptt_title', {}, 'Нажмите слева для передачи на TS1, справа — на TS2') : 'Нажмите слева для передачи на TS1, справа — на TS2');
          btn.setAttribute('data-i18n-title', 'ptt.dual_slot_ptt_title');
        }
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
        roleBadge.setAttribute('data-i18n', 'admin.role_superadmin');
        roleBadge.textContent = window.t ? window.t('admin.role_superadmin', {}, '👑 Superadmin') : '👑 Superadmin';
        roleBadge.style.color = '#ffcc00';
        roleBadge.style.display = 'inline-block';
      } else if (role === 'admin') {
        roleBadge.setAttribute('data-i18n', 'admin.role_admin');
        roleBadge.textContent = window.t ? window.t('admin.role_admin', {}, '🛡️ Administrator') : '🛡️ Administrator';
        roleBadge.style.color = '#58a6ff';
        roleBadge.style.display = 'inline-block';
      } else {
        roleBadge.removeAttribute('data-i18n');
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
        deleteBtn.setAttribute('data-i18n-title', 'account.superadmin_delete_disabled');
        deleteBtn.title = window.t ? window.t('account.superadmin_delete_disabled', {}, '🛡️ Superadmin account is protected from deletion') : '🛡️ Superadmin account is protected from deletion';
        if (deleteSpan) {
          deleteSpan.setAttribute('data-i18n', 'account.superadmin_delete_btn_disabled');
          deleteSpan.textContent = window.t ? window.t('account.superadmin_delete_btn_disabled', {}, '🔒 Account deletion locked') : '🔒 Account deletion locked';
        }
        if (deleteHint) deleteHint.style.display = 'block';
      } else {
        deleteBtn.disabled = false;
        deleteBtn.style.opacity = '';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.filter = '';
        deleteBtn.removeAttribute('data-i18n-title');
        deleteBtn.title = '';
        if (deleteSpan) {
          deleteSpan.setAttribute('data-i18n', 'account.delete_btn');
          deleteSpan.textContent = window.t ? window.t('account.delete_btn', {}, '🗑️ Delete Account') : '🗑️ Delete Account';
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


  // --- Demo Mode Frontend Support ---
  let demoStatusTimer = null;
  let demoCountdownInterval = null;
  let demoHeaderTimer = null;

  function _formatMinSec(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function startDemoCountdown(type, seconds, maxSessions = 10) {
    if (demoCountdownInterval) clearInterval(demoCountdownInterval);
    const box = document.getElementById('authDemoCountdownBox');
    const btn = document.getElementById('btnAuthDemoLogin');
    if (btn) btn.disabled = true;
    if (box) box.style.display = 'block';

    let rem = Math.max(0, parseInt(seconds) || 0);

    const updateUI = () => {
      const timeStr = _formatMinSec(rem);
      if (type === 'cooldown') {
        if (box) box.textContent = (typeof window.t === 'function')
          ? window.t('demo.cooldown_wait', { time: timeStr }, `⏳ Demo re-entry available in ${timeStr}`)
          : `⏳ Demo re-entry available in ${timeStr}`;
      } else {
        if (box) box.textContent = (typeof window.t === 'function')
          ? window.t('demo.slots_full_wait', { max: maxSessions, time: timeStr }, `⏳ All demo slots are busy (${maxSessions}/${maxSessions}). Next free slot in ${timeStr}`)
          : `⏳ All demo slots are busy (${maxSessions}/${maxSessions}). Next free slot in ${timeStr}`;
      }
    };

    updateUI();

    demoCountdownInterval = setInterval(() => {
      rem--;
      if (rem <= 0) {
        clearInterval(demoCountdownInterval);
        demoCountdownInterval = null;
        if (box) box.style.display = 'none';
        if (btn) btn.disabled = false;
        fetchDemoStatus();
      } else {
        updateUI();
      }
    }, 1000);
  }

  async function fetchDemoStatus() {
    try {
      const res = await fetch('/api/auth/status?_t=' + Date.now());
      if (!res.ok) return;
      const data = await res.json();
      const sec = document.getElementById('authDemoSection');
      if (!sec) return;

      if (!data.demo || !data.demo.enabled) {
        sec.style.display = 'none';
        return;
      }

      sec.style.display = 'block';
      const sessMin = (data.demo.session_minutes !== undefined && data.demo.session_minutes !== null) ? data.demo.session_minutes : 10;
      window._lastDemoSessionMinutes = sessMin;
      const btnTxt = document.getElementById('btnAuthDemoLoginText');
      if (btnTxt) {
        btnTxt.textContent = (typeof window.t === 'function')
          ? window.t('demo.login_btn', { minutes: sessMin }, `Demo Login (${sessMin} min)`)
          : `Demo Login (${sessMin} min)`;
      }
      const slotsInfo = document.getElementById('authDemoSlotsInfo');
      if (slotsInfo) {
        slotsInfo.textContent = (typeof window.t === 'function')
          ? window.t('demo.free_slots_info', { free: data.demo.free_slots, max: data.demo.max_sessions }, `Free slots: ${data.demo.free_slots} of ${data.demo.max_sessions}`)
          : `Free slots: ${data.demo.free_slots} of ${data.demo.max_sessions}`;
      }

      const btn = document.getElementById('btnAuthDemoLogin');
      const box = document.getElementById('authDemoCountdownBox');

      if (data.demo.cooldown_remaining_sec > 0) {
        startDemoCountdown('cooldown', data.demo.cooldown_remaining_sec);
      } else if (data.demo.slots_full) {
        startDemoCountdown('slots_full', data.demo.nearest_slot_sec, data.demo.max_sessions);
      } else {
        if (!demoCountdownInterval) {
          if (box) box.style.display = 'none';
          if (btn) btn.disabled = false;
        }
      }
    } catch (_) {}
  }

  function startDemoStatusPolling() {
    stopDemoStatusPolling();
    fetchDemoStatus();
    demoStatusTimer = setInterval(fetchDemoStatus, 5000);
  }

  function stopDemoStatusPolling() {
    if (demoStatusTimer) {
      clearInterval(demoStatusTimer);
      demoStatusTimer = null;
    }
  }

  function initDemoHeaderTimer(expiresAt, sessionMinutes, cooldownSeconds) {
    if (demoHeaderTimer) clearInterval(demoHeaderTimer);
    const badge = document.getElementById('demoHeaderBadge');
    const timeEl = document.getElementById('demoHeaderTime');
    if (!badge || !timeEl) return;

    badge.style.display = 'inline-flex';

    if (sessionMinutes) {
      window._lastDemoSessionMinutes = sessionMinutes;
    }
    const fallbackSec = ((sessionMinutes || window._lastDemoSessionMinutes || 10) * 60);
    const targetExpiresAt = expiresAt || (Math.floor(Date.now() / 1000) + fallbackSec);

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const rem = Math.max(0, targetExpiresAt - now);
      const m = Math.floor(rem / 60);
      const s = Math.floor(rem % 60);
      const timeStr = `${m}.${String(s).padStart(2, '0')}`;
      timeEl.textContent = (typeof window.t === 'function')
        ? window.t('demo.header_timer', { time: timeStr }, `Demo: ${timeStr}`)
        : `Demo: ${timeStr}`;

      badge.classList.remove('warning', 'danger');
      if (rem <= 20) {
        badge.classList.add('danger');
      } else if (rem <= 60) {
        badge.classList.add('warning');
      }

      if (rem <= 0) {
        clearInterval(demoHeaderTimer);
        demoHeaderTimer = null;
        window.onDemoSessionExpired(cooldownSeconds || 60);
      }
    };

    tick();
    demoHeaderTimer = setInterval(tick, 1000);
  }
  window.initDemoHeaderTimer = initDemoHeaderTimer;

  window.onDemoSessionExpired = function (cooldownSec = 60) {
    if (window.isDemoExpiredHandled) return;
    window.isDemoExpiredHandled = true;
    window.isDemoExpired = true;
    window.isDemoMode = false;
    document.body.classList.remove('is-demo-mode');

    const badge = document.getElementById('demoHeaderBadge');
    if (badge) badge.style.display = 'none';

    try {
      if (window.audioPlayer && typeof window.audioPlayer.stop === 'function') {
        window.audioPlayer.stop();
      }
    } catch (_) {}

    performLogout(true);

    setTimeout(() => {
      window.isDemoExpiredHandled = false;
      showModal(true);
      if (loginError) {
        loginError.textContent = (typeof window.t === 'function')
          ? window.t('demo.session_expired', {}, '⏱️ Demo session expired. Re-entry will be available after cooldown.')
          : '⏱️ Demo session expired. Re-entry will be available after cooldown.';
      }
      startDemoCountdown('cooldown', cooldownSec);
    }, 150);
  };

  function applyDemoReadOnlyLock() {
    if (!window.isDemoMode) return;

    const containers = [
      document.getElementById('settingsModal'),
      document.getElementById('bmTgStaticModal'),
      document.getElementById('tab-edit-hs'),
    ].filter(Boolean);

    containers.forEach(container => {
      const demoAllowedInputIds = new Set([
        'optLanguage',
        'languageSelect',
        'themeSelect',
        'optTranscriberSourceLang',
        'optTranscriberTargetLang',
        'optTranscriberNoTranslate',
        'optTtsEngine',
        'optTtsModel',
        'optTtsStyle',
        'optTtsVoice',
        'optTtsDucking',
        'optTtsPauseDucking',
        'optTtsMuteOthers',
        'optTtsAnnounceCallsign',
        'optTtsSkipShortCallsign',
      ]);
      container.querySelectorAll('input, select, textarea').forEach(el => {
        if (demoAllowedInputIds.has(el.id) || el.classList.contains('local-demo-allowed')) {
          el.disabled = false;
          el.classList.remove('demo-disabled-control');
          return;
        }
        el.disabled = true;
        el.classList.add('demo-disabled-control');
      });

      container.querySelectorAll('button').forEach(btn => {
        if (
          btn.classList.contains('tab-btn') ||
          btn.classList.contains('account-subtab-btn') ||
          btn.classList.contains('icon-btn') ||
          btn.classList.contains('modal-close') ||
          btn.classList.contains('btn-subtab') ||
          btn.id === 'closeSettingsBtn' ||
          btn.id === 'adminCancelAddBtn' ||
          btn.id === 'adminResetPwdCancelBtn' ||
          btn.id === 'btnTestTts' ||
          (btn.type === 'submit' && btn.closest('#transcriberSettingsForm')) ||
          btn.hasAttribute('data-tab') ||
          btn.hasAttribute('data-account-tab') ||
          btn.hasAttribute('data-subtab')
        ) {
          btn.disabled = false;
          btn.classList.remove('demo-disabled-control');
          return;
        }
        btn.disabled = true;
        btn.classList.add('demo-disabled-control');
      });
    });

    document.querySelectorAll('.demo-readonly-banner').forEach(b => {
      b.style.display = 'flex';
    });
  }
  window.applyDemoReadOnlyLock = applyDemoReadOnlyLock;

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
    const authServerSettingsRow = document.getElementById('authServerSettingsRow');
    const authServerSettingsBtn = document.getElementById('authServerSettingsBtn');
    if (authServerSettingsRow && authServerSettingsBtn) {
      const isApk = isApkMode() || Boolean(window.AndroidBridge && typeof window.AndroidBridge.openServerSettings === 'function');
      if (isApk) {
        authServerSettingsRow.style.display = 'block';
      }
      if (!authServerSettingsBtn._wired) {
        authServerSettingsBtn._wired = true;
        authServerSettingsBtn.addEventListener('click', () => {
          if (window.AndroidBridge && typeof window.AndroidBridge.openServerSettings === 'function') {
            try {
              window.AndroidBridge.openServerSettings();
            } catch (err) {
              console.warn('[AndroidBridge] openServerSettings failed:', err);
            }
          } else {
            console.log('[AndroidBridge] openServerSettings only available in APK mode');
          }
        });
      }
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

    const btnDemoLogin = document.getElementById('btnAuthDemoLogin');
    if (btnDemoLogin && !btnDemoLogin._wired) {
      btnDemoLogin._wired = true;
      btnDemoLogin.addEventListener('click', () => {
        const uInput = document.getElementById('authLoginInput');
        const pInput = document.getElementById('authPasswordInput');
        if (uInput) uInput.value = 'demo';
        if (pInput) pInput.value = 'demo';
        doLogin();
      });
    }

    const demoHeaderLogoutBtn = document.getElementById('demoHeaderLogoutBtn');
    if (demoHeaderLogoutBtn && !demoHeaderLogoutBtn._wired) {
      demoHeaderLogoutBtn._wired = true;
      demoHeaderLogoutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        doLogout();
      });
    }

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn && !settingsBtn._demoWired) {
      settingsBtn._demoWired = true;
      settingsBtn.addEventListener('click', () => {
        if (window.isDemoMode && typeof window.applyDemoReadOnlyLock === 'function') {
          setTimeout(window.applyDemoReadOnlyLock, 50);
        }
      });
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

    const onLangUpdate = () => {
      updateAccountUI();
      const btnTxt = document.getElementById('btnAuthDemoLoginText');
      if (btnTxt) {
        const mins = window._lastDemoSessionMinutes || 10;
        btnTxt.textContent = (typeof window.t === 'function')
          ? window.t('demo.login_btn', { minutes: mins }, `Demo Login (${mins} min)`)
          : `Demo Login (${mins} min)`;
      }
    };
    window.refreshAuthLocalization = onLangUpdate;

    if (window.I18N && typeof window.I18N.onLanguageChange === 'function') {
      window.I18N.onLanguageChange(onLangUpdate);
    } else if (window.i18n && typeof window.i18n.onChange === 'function') {
      window.i18n.onChange(onLangUpdate);
    }
    window.addEventListener('languageChanged', onLangUpdate);
    
  window.localizeDemoText = function(val) {
    if (!val || typeof val !== "string") return val;
    const callLabel = window.t ? window.t("demo.your_callsign", {}, "Your Callsign") : "Your Callsign";
    const nameLabel = window.t ? window.t("demo.your_name", {}, "Your Name") : "Your Name";
    if (val === "Ваш позывной" || val === "Your CALL" || val === "Your Callsign") return callLabel;
    if (val === "Your Name" || val === "Ваше имя") return nameLabel;
    if (val === "Ваш позывной (Your Name)" || val === "Your Callsign (Your Name)") return `${callLabel} (${nameLabel})`;
    return val
      .replace(/Ваш позывной/g, callLabel)
      .replace(/Your CALL/g, callLabel)
      .replace(/Your Callsign/g, callLabel)
      .replace(/Your Name/g, nameLabel)
      .replace(/Ваше имя/g, nameLabel);
  };

  window.refreshDemoMasksInDom = function() {
    const isDemo = (typeof window.isDemoMode === "function") ? window.isDemoMode() : Boolean(window.isDemoMode);
    if (!isDemo) return;
    document.querySelectorAll(".callsign-display").forEach(el => {
      if (!el.dataset.rawCallsign) {
        el.dataset.rawCallsign = el.textContent.trim();
      }
      el.textContent = window.localizeDemoText(el.dataset.rawCallsign);
    });
    document.querySelectorAll(".hotspot-card-meta").forEach(el => {
      if (el.textContent.includes("|")) {
        const parts = el.textContent.split("|");
        const cs = parts[0].trim();
        const id = parts[1].trim();
        if (cs === "Ваш позывной" || cs === "Your CALL" || cs === "Your Callsign" || cs === (window.t ? window.t("demo.your_callsign") : "")) {
          el.textContent = `${window.localizeDemoText("Ваш позывной")} | ${id}`;
        }
      }
    });
    ["editHsCallsign", "editHsTalkerAlias", "optQrzComUsername", "optHamQthUsername"].forEach(id => {
      const inp = document.getElementById(id);
      if (inp && inp.value) {
        inp.value = window.localizeDemoText(inp.value);
      }
    });
  };

  window.addEventListener('languageChanged', () => {
    updateAccountUI();
    if (typeof window.refreshDemoMasksInDom === "function") {
      window.refreshDemoMasksInDom();
    }
    const authModal = document.getElementById("authModal");
    if (authModal && authModal.classList.contains("active")) {
      if (typeof fetchDemoStatus === "function") {
        fetchDemoStatus();
      }
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
            errBox2.textContent = window.t ? window.t('auth.err_login_min3', {}, 'Логин должен содержать минимум 3 символа') : 'Логин должен содержать минимум 3 символа';
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
            const err = data.detail || (window.t ? window.t('auth.err_register', {}, 'Ошибка регистрации') : 'Ошибка регистрации');
            if (errBox3) {
              errBox3.textContent = err;
              errBox3.style.display = 'block';
            }
            btnFinish.disabled = false;
            btnFinish.textContent = origText;
          }
        } catch (e) {
          if (errBox3) {
            errBox3.textContent = window.t ? window.t('auth.err_server_conn', {}, 'Ошибка подключения к серверу') : 'Ошибка подключения к серверу';
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

  function releaseAuthShield() {
    if (window._authPendingTimer) {
      clearTimeout(window._authPendingTimer);
      window._authPendingTimer = null;
    }
    document.documentElement.classList.remove('auth-pending');
    if (window.AndroidBridge && typeof window.AndroidBridge.notifyAppReady === 'function') {
      try {
        window.AndroidBridge.notifyAppReady();
      } catch (_) {}
    }
  }

  function showModal(show) {
    if (show) {
      startDemoStatusPolling();
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
      stopDemoStatusPolling();
      if (authModal) authModal.classList.remove('active');
      showOnboarding(false);
      document.body.classList.remove('auth-locked');
      document.documentElement.classList.remove('initial-auth');
      releaseAuthShield();
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
          if (data.is_demo !== undefined) currentUser.is_demo = data.is_demo;
          if (data.demo_expires_at) currentUser.demo_expires_at = data.demo_expires_at;
          if (data.demo_cooldown_seconds) currentUser.demo_cooldown_seconds = data.demo_cooldown_seconds;
        }
        if (currentUser && currentUser.is_demo) {
          window.isDemoMode = true;
          document.body.classList.add('is-demo-mode');
          if (typeof window.stopAndReleaseMic === 'function') {
            window.stopAndReleaseMic();
          }
          initDemoHeaderTimer(currentUser.demo_expires_at, currentUser.demo_session_minutes, currentUser.demo_cooldown_seconds);
        } else {
          window.isDemoMode = false;
          document.body.classList.remove('is-demo-mode');
        }
        const checkedUid = currentUser ? (currentUser.id || currentUser.user_id) : null;
        try {
          const prevUid = localStorage.getItem('proxdmr_last_uid');
          if (checkedUid && prevUid && String(prevUid) !== String(checkedUid)) {
            clearLocalUserData();
          }
          if (checkedUid) {
            localStorage.setItem('proxdmr_last_uid', String(checkedUid));
          }
        } catch (e) {}
        window.currentUserId = checkedUid;
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
        document.documentElement.classList.remove('initial-auth');
        releaseAuthShield();
        return true;
      }
    } catch (e) { /* ignore */ }
    isAuthenticated = false;
    currentUser = null;
    window.currentUserId = null;
    showModal(true);
    if (logoutBtn) logoutBtn.style.display = 'none';
    updateAccountUI();
    releaseAuthShield();
    return false;
  }

  async function doLogin() {
    clearErrors();
    const login = document.getElementById('authLoginInput')?.value?.trim();
    const password = document.getElementById('authPasswordInput')?.value;
    const remember = isApkMode() ? true : (document.getElementById('authRememberMe')?.checked ?? true);

    if (!login || !password) {
      if (loginError) {
        loginError.textContent = (typeof window.t === 'function')
          ? window.t('auth.enter_login_pwd', {}, 'Please enter login and password')
          : 'Please enter login and password';
      }
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
        if (currentUser && currentUser.is_demo) {
          window.isDemoMode = true;
          document.body.classList.add('is-demo-mode');
          if (typeof window.stopAndReleaseMic === 'function') {
            window.stopAndReleaseMic();
          }
          initDemoHeaderTimer(currentUser.demo_expires_at, currentUser.demo_session_minutes, currentUser.demo_cooldown_seconds);
        } else {
          window.isDemoMode = false;
          document.body.classList.remove('is-demo-mode');
        }
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
        try {
          const loggedInUid = currentUser ? (currentUser.id || currentUser.user_id) : null;
          if (loggedInUid) {
            localStorage.setItem('proxdmr_last_uid', String(loggedInUid));
          }
        } catch (e) {}
        if (data.bootstrap_state) {
          try {
            const bs = data.bootstrap_state;
            const cs = bs.client_settings || {};
            if (cs.storage_dump && typeof cs.storage_dump === "object") {
              for (const [k, v] of Object.entries(cs.storage_dump)) {
                if (k && k.startsWith("proxdmr_") && v !== null && v !== undefined &&
                    k !== "proxdmr_pre_gain_db" &&
                    k !== "proxdmr_demo_language" && k !== "proxdmr_last_uid" &&
                    k !== "proxdmr_auth_token" && k !== "proxdmr_auth_login") {
                  localStorage.setItem(k, String(v));
                }
              }
              localStorage.removeItem("proxdmr_pre_gain_db");
            }
            if (cs.audio_rx && typeof cs.audio_rx === "object") {
              if (cs.audio_rx.active_preset) localStorage.setItem("proxdmr_audio_rx_active_preset", String(cs.audio_rx.active_preset));
              if (cs.audio_rx.jitter_buffer_ms !== undefined) localStorage.setItem("proxdmr_jitter_buffer_ms", String(cs.audio_rx.jitter_buffer_ms));
              if (cs.audio_rx.boost_pct !== undefined) localStorage.setItem("proxdmr_rx_boost_pct", String(cs.audio_rx.boost_pct));
              if (cs.audio_rx.agc_enabled !== undefined) localStorage.setItem("proxdmr_agc", cs.audio_rx.agc_enabled !== false ? "true" : "false");
              if (cs.audio_rx.presets && typeof cs.audio_rx.presets === "object") {
                for (const [pid, pdata] of Object.entries(cs.audio_rx.presets)) {
                  if (pdata && typeof pdata === "object" && ("eq10Gains" in pdata || "eq10Enable" in pdata || "limiterEnable" in pdata || "boostPct" in pdata)) {
                    localStorage.setItem(`proxdmr_audio_rx_preset_${pid}`, JSON.stringify(pdata));
                  }
                }
              }
            }
            if (cs.asl_audio_rx && typeof cs.asl_audio_rx === "object") {
              if (cs.asl_audio_rx.active_preset) localStorage.setItem("proxdmr_asl_audio_rx_active_preset", String(cs.asl_audio_rx.active_preset));
              if (cs.asl_audio_rx.jitter_buffer_ms !== undefined) localStorage.setItem("proxdmr_asl_jitter_buffer_ms", String(cs.asl_audio_rx.jitter_buffer_ms));
              if (cs.asl_audio_rx.presets && typeof cs.asl_audio_rx.presets === "object") {
                for (const [pid, pdata] of Object.entries(cs.asl_audio_rx.presets)) {
                  if (pdata && typeof pdata === "object" && ("eq10Gains" in pdata || "eq10Enable" in pdata || "limiterEnable" in pdata || "boostPct" in pdata)) {
                    localStorage.setItem(`proxdmr_asl_audio_rx_preset_${pid}`, JSON.stringify(pdata));
                  }
                }
              }
            }
            if (cs.ambe_rx && typeof cs.ambe_rx === "object" && (cs.ambe_rx.high_band_gain_db !== undefined || cs.ambe_rx.unvoiced_gain_db !== undefined)) {
              if (cs.ambe_rx.active_preset) localStorage.setItem("proxdmr_ambe_active_preset", String(cs.ambe_rx.active_preset));
              if (cs.ambe_rx.presets && typeof cs.ambe_rx.presets === "object") {
                for (const [pid, pdata] of Object.entries(cs.ambe_rx.presets)) {
                  if (pdata && typeof pdata === "object" && pdata.high_band_gain_db !== undefined) {
                    localStorage.setItem(`proxdmr_ambe_preset_${pid}`, JSON.stringify(pdata));
                  }
                }
              }
            }
            const applyTxBoot = (obj, flatPfx, presetPfx) => {
              if (!obj || typeof obj !== "object") return;
              const isModern = ("dsp_agc" in obj) || ("eq_low" in obj) || (obj.presets && obj.presets["1"] && ("txDspAgc" in obj.presets["1"]));
              if (!isModern) return;
              if (obj.active_preset) localStorage.setItem(`${presetPfx}_active_preset`, String(obj.active_preset));
              if (obj.presets && typeof obj.presets === "object") {
                for (const [pid, pdata] of Object.entries(obj.presets)) {
                  if (pdata && typeof pdata === "object") localStorage.setItem(`${presetPfx}_preset_${pid}`, JSON.stringify(pdata));
                }
              }
              if (obj.mic_gain !== undefined) localStorage.setItem(`${flatPfx}mic_gain`, String(obj.mic_gain));
              if (obj.noise_suppression !== undefined) localStorage.setItem(`${flatPfx}ns`, obj.noise_suppression ? "true" : "false");
              if (obj.browser_agc !== undefined) localStorage.setItem(`${flatPfx}agc`, obj.browser_agc ? "true" : "false");
              if (obj.dsp_agc !== undefined) localStorage.setItem(`${flatPfx}dsp_agc`, obj.dsp_agc ? "true" : "false");
              if (obj.echo_cancellation !== undefined) localStorage.setItem(`${flatPfx}aec`, obj.echo_cancellation ? "true" : "false");
              if (obj.gate_enabled !== undefined) localStorage.setItem(`${flatPfx}gate_enabled`, obj.gate_enabled !== false ? "true" : "false");
              if (obj.gate_threshold !== undefined) localStorage.setItem(`${flatPfx}gate_threshold`, String(obj.gate_threshold));
              if (obj.hpf_enabled !== undefined) localStorage.setItem(`${flatPfx}hpf`, obj.hpf_enabled !== false ? "true" : "false");
              if (obj.presence_boost !== undefined) localStorage.setItem(`${flatPfx}presence`, String(obj.presence_boost));
              if (obj.eq_low !== undefined) localStorage.setItem(`${flatPfx}eq_low`, String(obj.eq_low));
              if (obj.eq_mid !== undefined) localStorage.setItem(`${flatPfx}eq_mid`, String(obj.eq_mid));
              if (obj.eq_high !== undefined) localStorage.setItem(`${flatPfx}eq_high`, String(obj.eq_high));
              if (obj.eq_preset) localStorage.setItem(`${flatPfx}eq_preset`, String(obj.eq_preset));
            };
            applyTxBoot(cs.audio_tx, "proxdmr_tx_", "proxdmr_audio_tx");
            applyTxBoot(cs.asl_audio_tx, "proxdmr_asl_tx_", "proxdmr_asl_audio_tx");
            const as = bs.app_settings || {};
            if (as.theme) localStorage.setItem("proxdmr_theme", as.theme === "light" ? "light" : "dark");
            if (as.language) localStorage.setItem("proxdmr_language", as.language);
            localStorage.removeItem("proxdmr_demo_language");
            if (as.bg_type_dark) localStorage.setItem("proxdmr_bg_type_dark", as.bg_type_dark);
            if (as.bg_color_dark) localStorage.setItem("proxdmr_bg_color_dark", as.bg_color_dark);
            if (as.bg_type_light) localStorage.setItem("proxdmr_bg_type_light", as.bg_type_light);
            if (as.bg_color_light) localStorage.setItem("proxdmr_bg_color_light", as.bg_color_light);
            if (as.custom_wallpaper_dark) localStorage.setItem("proxdmr_bg_custom_dark", as.custom_wallpaper_dark);
            if (as.custom_wallpaper_light) localStorage.setItem("proxdmr_bg_custom_light", as.custom_wallpaper_light);
            if (as.active_hotspot_id) localStorage.setItem("proxdmr_active_hotspot_id", as.active_hotspot_id);
            if (bs.hotspots_collapsed && typeof bs.hotspots_collapsed === "object") {
              for (const [hid, isCol] of Object.entries(bs.hotspots_collapsed)) {
                localStorage.setItem(`proxdmr_collapsed_${hid}`, isCol ? "true" : "false");
              }
            }
          } catch (e) {
            console.warn("[DEMO] Failed to apply bootstrap_state:", e);
          }
        }
        if (token) {
          try {
            localStorage.setItem('proxdmr_auth_token', token);
            localStorage.setItem('proxdmr_auth_login', currentUser?.login || login);
          } catch (e) {}
        }
        location.reload();
      } else {
                if (resp.status === 429) {
          if (data.code === 'DEMO_COOLDOWN' && data.cooldown_remaining_sec) {
            startDemoCountdown('cooldown', data.cooldown_remaining_sec);
          } else if (data.code === 'DEMO_SLOTS_FULL' && data.nearest_slot_sec) {
            startDemoCountdown('slots_full', data.nearest_slot_sec, data.max_sessions || 10);
          }
        }
        if (loginError) {
          let errText = data.detail || data.message || ((typeof window.t === 'function') ? window.t('auth.login_failed', {}, 'Login failed') : 'Login failed');
          if (errText === 'Неверный логин или пароль') {
            errText = (typeof window.t === 'function')
              ? window.t('auth.invalid_credentials', {}, 'Invalid login or password')
              : 'Invalid login or password';
          }
          loginError.textContent = errText;
        }
      }
    } catch (e) {
      if (loginError) {
        loginError.textContent = (typeof window.t === 'function')
          ? window.t('auth.err_server_conn', {}, 'Server connection error')
          : 'Server connection error';
      }
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
      if (typeof window.flushPendingClientSettingsSync === 'function') {
        await window.flushPendingClientSettingsSync({ keepalive: true });
      }
    } catch (e) {}
    try {
      window.__proxdmrClientSettingsHydrated = false;
    } catch (e) {}
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
      const msg = t('account.superadmin_delete_disabled', {}, '🛡️ Superadmin account is protected from deletion');
      if (window.showAppAlert) {
        await window.showAppAlert(msg, { title: t('auth.protected_title', {}, 'Protected'), icon: '🛡️' });
      }
      return;
    }
    const login = currentUser.login || '';
    const confirmMsg = t('account.delete_confirm', { login: login }, `Are you sure you want to delete account "${login}"?\nAll settings, hotspots, and call logs will be permanently deleted.`);
    const ok = await showAppConfirm({
      title: t('auth.delete_account_title', {}, 'Delete Account'),
      icon: '🗑️',
      message: confirmMsg,
      confirmText: t('auth.continue_btn', {}, 'Continue'),
      confirmStyle: 'danger'
    });
    if (!ok) return;

    const promptMsg = t('account.delete_prompt', { login: login }, `To confirm deletion, enter your login (${login}):`);
    const typed = await showAppPrompt({
      title: t('auth.delete_confirm_modal_title', {}, 'Confirm Deletion'),
      icon: '⚠️',
      message: promptMsg,
      placeholder: login,
      confirmText: t('auth.delete_account_confirm', {}, 'Delete Account'),
      confirmStyle: 'danger'
    });
    if (!typed || typed.trim().toLowerCase() !== login.toLowerCase()) {
      if (typed !== null) {
        await showAppAlert(t('account.delete_mismatch', {}, 'Incorrect login entered. Account deletion cancelled.'), { title: t('auth.delete_cancelled_title', {}, 'Deletion Cancelled'), icon: 'ℹ️' });
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
        await showAppAlert(data.message || t('account.delete_success', {}, 'Account successfully deleted'), { title: t('auth.deleted_title', {}, 'Deleted'), icon: '✅' });
        isAuthenticated = false;
        currentUser = null;
        location.reload();
      } else {
        await showAppAlert(data.detail || t('auth.err_delete_title', {}, 'Error deleting account'), { title: t('common.error', {}, 'Error'), icon: '⚠️' });
      }
    } catch (e) {
      await showAppAlert(t('auth.err_server_conn', {}, 'Server connection error'), { title: t('auth.err_conn_title', {}, 'Connection Error'), icon: '⚠️' });
    }
  }

  // --- Settings Export/Import ---

  async function exportSettings() {
    const t = (k, p, d) => (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(k, p, d) : (typeof p === 'string' ? p : d);
    const promptMsg = t('account.export_prompt', {}, 'Enter your account password (also used for the 7z archive):');
    const password = await showAppPrompt({
      title: t('auth.export_title', {}, 'Export Settings'),
      icon: '🔑',
      message: promptMsg,
      isPassword: true,
      confirmText: t('auth.export_btn', {}, 'Export')
    });
    if (!password) return;

    try {
      const client_storage = getClientStorageFullSnapshot();
      const resp = await fetch('/api/user/settings/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          password: password,
          client_storage: client_storage
        })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        await showAppAlert(data.detail || t('account.export_error', {}, 'Export error'), { title: t('account.export_error', {}, 'Export error'), icon: '⚠️' });
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
      await showAppAlert(t('account.export_conn_error', {}, 'Error exporting settings'), { title: t('auth.err_conn_title', {}, 'Connection Error'), icon: '⚠️' });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isAllowedExportStorageKey(k) {
    if (!k || typeof k !== 'string') return false;
    if (k === 'proxdmr_auth_token' || k === 'proxdmr_demo_language') return false;
    if (k.startsWith('proxdmr_gw_disconnected_')) return false;
    if (k.startsWith('proxdmr_client_ping_') || k.startsWith('proxdmr_ping_hist_')) return false;
    if (k.startsWith('proxdmr_tg_names_') || k === 'proxdmr_tgif_tg_names_cache' || k === 'proxdmr_freedmr_tg_names_cache' || k === 'proxdmr_adn_tg_names_cache') return false;
    if (k.startsWith('proxdmr_user_callsigns_') || k === 'proxdmr_allstar_directory') return false;
    if (k === 'proxdmr_transcribe_ts1' || k === 'proxdmr_transcribe_ts2' || k === 'proxdmr_tts_ts1' || k === 'proxdmr_tts_ts2') return false;
    if (k === 'proxdmr_tts_solo_muted_slots' || k === 'proxdmr_tts_solo_muted_hs') return false;
    if (k.startsWith('proxdmr_pre_tts_ts_mode_') || k.startsWith('proxdmr_transcribe_automuted_') || k.startsWith('proxdmr_max_transcribe_')) return false;
    if (/^proxdmr_(?:transcribe|tts)_.*_ts[12]$/.test(k)) return false;

    return (
      k.startsWith('proxdmr_') ||
      k.startsWith('dmr_') ||
      k.startsWith('pinnedServers_') ||
      k.startsWith('srvSortMode_') ||
      k.startsWith('srvSortDir_')
    );
  }

  function getClientStorageFullSnapshot() {
    const snapshot = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && isAllowedExportStorageKey(k)) {
          snapshot[k] = localStorage.getItem(k);
        }
      }
      if (window.AndroidBridge && typeof window.AndroidBridge.getBlePttConfig === 'function') {
        try {
          const bleCfg = window.AndroidBridge.getBlePttConfig();
          if (bleCfg) snapshot['proxdmr_ble_ptt_config'] = bleCfg;
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[STORAGE] Failed to capture full client storage snapshot:', e);
    }
    return snapshot;
  }

  function restoreClientStorageSnapshot(storageObj, targetUid, oldUid) {
    if (!storageObj || typeof storageObj !== 'object') return;
    try {
      const curUid = targetUid || window.currentUserId || (getUser() ? (getUser().id || getUser().user_id) : null);
      let detectedOld = oldUid || null;
      if (!detectedOld && curUid) {
        const foundUids = new Set();
        Object.keys(storageObj).forEach(k => {
          const m = k.match(/^proxdmr_u(\d+)_/);
          if (m) foundUids.add(parseInt(m[1], 10));
        });
        if (foundUids.size === 1) detectedOld = Array.from(foundUids)[0];
      }

      // Restore BLE PTT if on Android APK
      if (storageObj.proxdmr_ble_ptt_config && window.AndroidBridge) {
        try {
          const cfg = JSON.parse(storageObj.proxdmr_ble_ptt_config);
          if (cfg && cfg.address && typeof window.AndroidBridge.connectBleDeviceWithName === 'function') {
            window.AndroidBridge.connectBleDeviceWithName(cfg.address, cfg.name || '');
          }
        } catch (_) {}
      }

      for (const [rawK, rawV] of Object.entries(storageObj)) {
        if (!rawK || rawK === 'proxdmr_auth_token' || rawK === 'proxdmr_ble_ptt_config') continue;
        if (!isAllowedExportStorageKey(rawK)) continue;

        let k = rawK;
        if (curUid) {
          const m = rawK.match(/^proxdmr_u(\d+)_(.+)$/);
          if (m) {
            const keyUid = parseInt(m[1], 10);
            const suffix = m[2];
            if (detectedOld && keyUid === detectedOld) {
              k = `proxdmr_u${curUid}_${suffix}`;
            } else if (keyUid === curUid) {
              k = rawK;
            } else {
              continue;
            }
          }
        }

        let valStr = typeof rawV === 'string' ? rawV : JSON.stringify(rawV);
        if (curUid && typeof valStr === 'string') {
          if (detectedOld && detectedOld !== curUid) {
            valStr = valStr.split(`/static/img/wallpapers/bg-custom-u${detectedOld}-`).join(`/static/img/wallpapers/bg-custom-u${curUid}-`);
          }
          if (valStr.includes('/static/img/bg-custom-dark.jpg')) {
            valStr = valStr.split('/static/img/bg-custom-dark.jpg').join(`/static/img/wallpapers/bg-custom-u${curUid}-dark.jpg`);
          }
          if (valStr.includes('/static/img/bg-custom-light.jpg')) {
            valStr = valStr.split('/static/img/bg-custom-light.jpg').join(`/static/img/wallpapers/bg-custom-u${curUid}-light.jpg`);
          }
        }

        if (rawV === null || rawV === undefined) {
          localStorage.removeItem(k);
        } else {
          localStorage.setItem(k, valStr);
        }
      }
    } catch (e) {
      console.warn('[STORAGE] Failed to restore client storage snapshot:', e);
    }
  }

  function showSuperadminImportModal(meta) {
    return new Promise((resolve) => {
      const modal = document.getElementById('superadminImportModal');
      if (!modal) {
        resolve({ mode: 'superadmin_only', selected_users: [] });
        return;
      }

      const usersListEl = document.getElementById('saImportUsersList');
      const checklistBlock = document.getElementById('saImportUsersChecklistBlock');
      const subtitleEl = document.getElementById('saImportArchiveSubtitle');
      const radioOptions = modal.querySelectorAll('input[name="saImportMode"]');
      const checkAllBtn = document.getElementById('saImportCheckAll');
      const uncheckAllBtn = document.getElementById('saImportUncheckAll');
      const cancelBtn = document.getElementById('btnCancelSaImportModal');
      const confirmBtn = document.getElementById('btnConfirmSaImportModal');

      const users = (meta && Array.isArray(meta.users)) ? meta.users : [];
      if (subtitleEl && meta.superadmin_login) {
        subtitleEl.textContent = window.t
          ? window.t('account.import_superadmin_subtitle', { login: meta.superadmin_login, count: users.length }, `Superadmin archive (${meta.superadmin_login}), users in archive: ${users.length}`)
          : `Superadmin archive (${meta.superadmin_login}), users in archive: ${users.length}`;
      }

      // Reset radio to default option 1
      radioOptions.forEach(r => {
        r.checked = (r.value === 'superadmin_only');
      });
      if (checklistBlock) checklistBlock.style.display = 'none';

      // Populate users list
      if (usersListEl) {
        usersListEl.innerHTML = '';
        if (users.length === 0) {
          const noUsersMsg = window.t ? window.t('account.import_no_other_users', {}, 'No other users in archive') : 'No other users in archive';
          usersListEl.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);padding:4px;">${escapeHtml(noUsersMsg)}</div>`;
        } else {
          users.forEach(u => {
            const row = document.createElement('label');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.style.fontSize = '0.84rem';
            row.style.cursor = 'pointer';
            row.style.padding = '3px 4px';
            row.style.borderRadius = '4px';

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'sa-user-checkbox';
            chk.value = u.login;
            chk.checked = true;

            const text = document.createElement('span');
            const roleStr = u.role === 'admin'
              ? (window.t ? window.t('account.import_role_admin', {}, 'admin') : 'admin')
              : (u.is_swl ? 'SWL' : (window.t ? window.t('account.import_role_user', {}, 'user') : 'user'));
            const hsCntStr = u.hotspots_count
              ? `, ${(window.t ? window.t('account.import_hotspots_count', { count: u.hotspots_count }, `hotspots: ${u.hotspots_count}`) : `hotspots: ${u.hotspots_count}`)}`
              : '';
            text.innerHTML = `<strong>${escapeHtml(u.login)}</strong> <span style="color:var(--text-muted);font-size:0.78rem;">(${escapeHtml(roleStr)}${escapeHtml(hsCntStr)})</span>`;

            row.appendChild(chk);
            row.appendChild(text);
            usersListEl.appendChild(row);
          });
        }
      }

      function onRadioChange() {
        const selected = modal.querySelector('input[name="saImportMode"]:checked')?.value;
        if (checklistBlock) {
          checklistBlock.style.display = (selected === 'selected_users') ? 'block' : 'none';
        }
      }

      radioOptions.forEach(r => r.addEventListener('change', onRadioChange));

      function onCheckAll(e) {
        if (e) e.preventDefault();
        modal.querySelectorAll('.sa-user-checkbox').forEach(c => { c.checked = true; });
      }

      function onUncheckAll(e) {
        if (e) e.preventDefault();
        modal.querySelectorAll('.sa-user-checkbox').forEach(c => { c.checked = false; });
      }

      if (checkAllBtn) checkAllBtn.onclick = onCheckAll;
      if (uncheckAllBtn) uncheckAllBtn.onclick = onUncheckAll;

      function cleanup() {
        radioOptions.forEach(r => r.removeEventListener('change', onRadioChange));
        if (cancelBtn) cancelBtn.onclick = null;
        if (confirmBtn) confirmBtn.onclick = null;
        if (checkAllBtn) checkAllBtn.onclick = null;
        if (uncheckAllBtn) uncheckAllBtn.onclick = null;
        modal.style.display = 'none';
      }

      if (cancelBtn) {
        cancelBtn.onclick = () => {
          cleanup();
          resolve(null);
        };
      }

      const srvRow = document.getElementById('saImportServerConfigRow');
      const srvBox = document.getElementById('saImportServerConfig');
      if (srvRow && srvBox) {
        if (meta && meta.has_server_config) {
          srvRow.style.display = 'flex';
          srvBox.checked = true;
        } else {
          srvRow.style.display = 'none';
          srvBox.checked = false;
        }
      }

      if (confirmBtn) {
        confirmBtn.onclick = () => {
          const mode = modal.querySelector('input[name="saImportMode"]:checked')?.value || 'superadmin_only';
          let selected = [];
          if (mode === 'selected_users') {
            modal.querySelectorAll('.sa-user-checkbox:checked').forEach(c => {
              if (c.value) selected.push(c.value);
            });
          }
          const restoreSrv = srvBox ? srvBox.checked : false;
          cleanup();
          resolve({ mode: mode, selected_users: selected, restore_server_config: restoreSrv });
        };
      }

      modal.style.display = 'flex';
    });
  }

  async function importSettings() {
    const t = (k, p, d) => (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(k, p, d) : (typeof p === 'string' ? p : d);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.7z';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const promptMsg = t('account.import_prompt', {}, 'Enter archive password (your account password):');
      const password = await showAppPrompt({
        title: t('auth.import_title', {}, 'Import Settings'),
        icon: '🔑',
        message: promptMsg,
        isPassword: true,
        confirmText: t('auth.import_btn', {}, 'Import')
      });
      if (password === null || !password) return;

      // 1. Inspect backup first
      let inspectMeta = null;
      try {
        const inspectFormData = new FormData();
        inspectFormData.append('file', file);
        inspectFormData.append('password', password);

        const inspResp = await fetch('/api/user/settings/inspect-backup', {
          method: 'POST',
          credentials: 'same-origin',
          body: inspectFormData
        });
        const inspData = await inspResp.json();
        if (!inspResp.ok) {
          await showAppAlert(inspData.detail || t('account.import_error', {}, 'Archive read error'), { title: t('account.import_archive_err_title', {}, 'Archive error'), icon: '⚠️' });
          return;
        }
        inspectMeta = inspData;
      } catch (e) {
        await showAppAlert(t('account.import_conn_error', {}, 'Error checking archive'), { title: t('auth.err_conn_title', {}, 'Connection error'), icon: '⚠️' });
        return;
      }

      let mode = 'default';
      let selectedUsers = [];
      let restoreServerConfig = true;

      // 2. Check if superadmin backup and current user is superadmin
      if (inspectMeta && inspectMeta.is_superadmin_backup && inspectMeta.current_user_role === 'superadmin') {
        const dialogRes = await showSuperadminImportModal(inspectMeta);
        if (!dialogRes) {
          return; // User cancelled modal
        }
        mode = dialogRes.mode;
        selectedUsers = dialogRes.selected_users;
        restoreServerConfig = Boolean(dialogRes.restore_server_config);
      }

      // 3. Apply import
      const formData = new FormData();
      formData.append('file', file);
      formData.append('password', password);
      formData.append('mode', mode);
      formData.append('restore_server_config', restoreServerConfig ? 'true' : 'false');
      if (selectedUsers && selectedUsers.length > 0) {
        formData.append('selected_users', JSON.stringify(selectedUsers));
      }

      try {
        const resp = await fetch('/api/user/settings/import', {
          method: 'POST',
          credentials: 'same-origin',
          body: formData,
        });
        const data = await resp.json();
        if (resp.ok) {
          if (data.client_storage) {
            restoreClientStorageSnapshot(data.client_storage, data.restored_user_id, data.exported_user_id);
          }
          await showAppAlert(t('account.import_success', {}, 'Settings imported successfully. Page will reload.'), { title: t('common.success', {}, 'Success'), icon: '✅' });
          location.reload();
        } else {
          await showAppAlert(data.detail || t('account.import_error', {}, 'Import error'), { title: t('account.import_err_title', {}, 'Import error'), icon: '⚠️' });
        }
      } catch (e) {
        await showAppAlert(t('account.import_conn_error', {}, 'Error importing settings'), { title: t('auth.err_conn_title', {}, 'Connection error'), icon: '⚠️' });
      }
    };
    input.click();
  }

  async function doImportConfigFromLoginScreen() {
    clearErrors();
    const t = (key, params, fallback) => (typeof window.t === 'function' ? window.t(key, params || {}, fallback || '') : (fallback || key));
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.7z';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;

      let password = document.getElementById('authPasswordInput')?.value;
      if (!password) {
        password = await showAppPrompt({
          title: t('auth.import_cfg_title', {}, 'Import Configuration'),
          icon: '🔑',
          message: t('auth.import_cfg_pwd_msg', {}, 'Enter archive password (your account password):'),
          isPassword: true,
          confirmText: t('auth.btn_continue', {}, 'Continue')
        });
        if (!password) return;
      }

      let login = document.getElementById('authLoginInput')?.value?.trim() || '';
      if (!login) {
        const enteredLogin = await showAppPrompt({
          title: t('auth.recovery_title', {}, 'Account Recovery'),
          icon: '👤',
          message: t('auth.recovery_login_msg', {}, 'Enter account login to restore (leave empty to auto-detect):'),
          placeholder: t('auth.recovery_login_ph', {}, 'login (optional)'),
          confirmText: t('auth.btn_continue', {}, 'Continue')
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
          if (data.client_storage) {
            restoreClientStorageSnapshot(data.client_storage);
          }
          await showAppAlert(t('account.import_success', {}, 'Settings imported successfully. Reloading...'), { title: t('common.success', {}, 'Success'), icon: '✅' });
          if (token) {
            try {
              localStorage.setItem('proxdmr_auth_token', token);
              localStorage.setItem('proxdmr_auth_login', data.user?.login || login);
            } catch (e) {}
          }
          location.reload();
        } else {
          const errDetail = data.detail || t('account.import_error', {}, 'Import error');
          if (loginError) loginError.textContent = errDetail;
          await showAppAlert(errDetail, { title: t('account.import_err_title', {}, 'Import Error'), icon: '⚠️' });
        }
      } catch (e) {
        const connErr = t('account.import_conn_error', {}, 'Error importing settings');
        if (loginError) loginError.textContent = connErr;
        await showAppAlert(connErr, { title: t('auth.err_conn_title', {}, 'Connection Error'), icon: '⚠️' });
      } finally {
        if (importBtn) importBtn.disabled = false;
      }
    };
    input.click();
  }

})();
