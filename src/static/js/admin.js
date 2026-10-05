/**
 * ProxDMR Admin Panel — User Management (admin/superadmin only)
 */
(function () {
  'use strict';

  let currentUserRole = null;
  let currentUserId = null;

  window.ProxDMRAdmin = {
    init: initAdmin,
    refresh: loadUsers,
    isAdmin: () => currentUserRole === 'admin' || currentUserRole === 'superadmin',
    getRole: () => currentUserRole,
  };

  async function initAdmin() {
    const serverRestartBlock = document.getElementById('serverRestartBlock');

    // Fetch current user role
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        if (serverRestartBlock) serverRestartBlock.style.display = 'none';
        return;
      }
      const data = await res.json();
      currentUserRole = data.role;
      currentUserId = data.user_id;
    } catch (e) {
      if (serverRestartBlock) serverRestartBlock.style.display = 'none';
      return;
    }

    const subtabsNav = document.getElementById('accountSubtabsNav');

    // Show admin subtabs navigation and server restart block only for admin/superadmin
    if (currentUserRole === 'admin' || currentUserRole === 'superadmin') {
      if (subtabsNav) subtabsNav.style.display = 'flex';
      if (serverRestartBlock) serverRestartBlock.style.display = 'block';
      if (typeof window.restoreAccountSubtab === 'function') {
        window.restoreAccountSubtab();
      } else {
        loadUsers();
      }
    } else {
      // Non-admin: hide the subtabs navigation bar completely, hide server restart block and activate profile subtab
      if (subtabsNav) subtabsNav.style.display = 'none';
      if (serverRestartBlock) serverRestartBlock.style.display = 'none';
      if (typeof window.switchAccountSubtab === 'function') {
        window.switchAccountSubtab('account-subtab-profile', false);
      }
      return; // Not admin, don't init anything
    }

    // Bind events
    const addBtn = document.getElementById('adminAddUserBtn');
    const cancelBtn = document.getElementById('adminCancelAddBtn');
    const confirmBtn = document.getElementById('adminConfirmAddBtn');
    const resetPwdCancelBtn = document.getElementById('adminResetPwdCancelBtn');
    const resetPwdConfirmBtn = document.getElementById('adminResetPwdConfirmBtn');

    if (addBtn && !addBtn._wired) {
      addBtn._wired = true;
      addBtn.addEventListener('click', showAddForm);
    }
    if (cancelBtn && !cancelBtn._wired) {
      cancelBtn._wired = true;
      cancelBtn.addEventListener('click', hideAddForm);
    }
    if (confirmBtn && !confirmBtn._wired) {
      confirmBtn._wired = true;
      confirmBtn.addEventListener('click', doCreateUser);
    }
    if (resetPwdCancelBtn && !resetPwdCancelBtn._wired) {
      resetPwdCancelBtn._wired = true;
      resetPwdCancelBtn.addEventListener('click', hideResetPwd);
    }
    if (resetPwdConfirmBtn && !resetPwdConfirmBtn._wired) {
      resetPwdConfirmBtn._wired = true;
      resetPwdConfirmBtn.addEventListener('click', doResetPassword);
    }

    // Role select change listener for SWL row visibility
    const roleSelect = document.getElementById('adminNewRole');
    if (roleSelect && !roleSelect._swlWired) {
      roleSelect._swlWired = true;
      roleSelect.addEventListener('change', () => {
        const swlRow = document.getElementById('adminNewSwlRow');
        const swlBox = document.getElementById('adminNewSwl');
        if (roleSelect.value === 'admin') {
          if (swlBox) swlBox.checked = false;
          if (swlRow) swlRow.style.display = 'none';
        } else {
          if (swlRow) swlRow.style.display = 'inline-flex';
        }
      });
    }

    // Load users when users subtab button is clicked
    const usersSubtabBtn = document.getElementById('accountSubtabBtnUsers');
    if (usersSubtabBtn && !usersSubtabBtn._adminWired) {
      usersSubtabBtn._adminWired = true;
      usersSubtabBtn.addEventListener('click', () => {
        setTimeout(loadUsers, 50);
      });
    }

    if (!window._adminLangListenerWired) {
      window._adminLangListenerWired = true;
      window.addEventListener('languageChanged', () => {
        if (currentUserRole === 'admin' || currentUserRole === 'superadmin') {
          loadUsers();
        }
      });
    }
  }

  // --- Add User Form ---
  function showAddForm() {
    const form = document.getElementById('adminAddUserForm');
    if (form) {
      form.style.display = 'block';
      document.getElementById('adminNewLogin').value = '';
      document.getElementById('adminNewPassword').value = '';
      const roleSelect = document.getElementById('adminNewRole');
      if (roleSelect) roleSelect.value = 'user';
      const swlBox = document.getElementById('adminNewSwl');
      if (swlBox) swlBox.checked = false;
      const swlRow = document.getElementById('adminNewSwlRow');
      if (swlRow) swlRow.style.display = 'inline-flex';
      document.getElementById('adminAddError').textContent = '';
      document.getElementById('adminNewLogin').focus();
    }
  }

  function hideAddForm() {
    const form = document.getElementById('adminAddUserForm');
    if (form) form.style.display = 'none';
  }

  async function doCreateUser() {
    const login = document.getElementById('adminNewLogin').value.trim();
    const password = document.getElementById('adminNewPassword').value;
    const role = document.getElementById('adminNewRole').value;
    const is_swl = Boolean(document.getElementById('adminNewSwl')?.checked);
    const errEl = document.getElementById('adminAddError');

    if (!login || login.length < 3) {
      errEl.textContent = window.t ? window.t('admin.err_login_length', {}, 'Логин должен быть не менее 3 символов') : 'Логин должен быть не менее 3 символов';
      return;
    }
    if (!password || password.length < 6) {
      errEl.textContent = window.t ? window.t('admin.err_pwd_length', {}, 'Пароль должен быть не менее 6 символов') : 'Пароль должен быть не менее 6 символов';
      return;
    }

    try {
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password, role, is_swl }),
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.detail || (window.t ? window.t('admin.err_create', {}, 'Ошибка создания пользователя') : 'Ошибка создания пользователя');
        return;
      }
      hideAddForm();
      loadUsers();
    } catch (e) {
      errEl.textContent = window.t ? window.t('admin.err_network', {}, 'Сетевая ошибка') : 'Сетевая ошибка';
    }
  }

  // --- Load Users Table ---
  async function loadUsers() {
    const tbody = document.getElementById('adminUsersTableBody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        let msg = window.t ? window.t('admin.err_load', {}, 'Ошибка загрузки') : 'Ошибка загрузки';
        try {
          const err = await res.json();
          if (err && (err.detail || err.error)) msg += ': ' + (err.detail || err.error);
        } catch (_) {}
        tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:#f85149;">${msg}</td></tr>`;
        return;
      }
      const data = await res.json();
      renderUsers(data.users || []);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:#f85149;">${window.t ? window.t('admin.err_network', {}, 'Сетевая ошибка') : 'Сетевая ошибка'}</td></tr>`;
    }
  }

  function renderUsers(users) {
    const tbody = document.getElementById('adminUsersTableBody');
    if (!tbody) return;

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:#8b949e;">${window.t ? window.t('admin.no_users', {}, 'Нет пользователей') : 'Нет пользователей'}</td></tr>`;
      return;
    }

    const roleLabels = {
      superadmin: window.t ? window.t('admin.role_superadmin', {}, '👑 Суперадмин') : '👑 Суперадмин',
      admin: window.t ? window.t('admin.role_admin', {}, '🛡️ Админ') : '🛡️ Админ',
      user: window.t ? window.t('admin.role_user', {}, '👤 Пользователь') : '👤 Пользователь',
    };
    const roleColors = {
      superadmin: '#ffcc00',
      admin: '#58a6ff',
      user: '#8b949e',
    };

    let html = '';
    for (const u of users) {
      const role = u.role || 'user';
      const blocked = !!u.is_blocked;
      const isSwl = !!u.is_swl;
      const isSelf = u.id === currentUserId;
      const isSuperadmin = role === 'superadmin';
      const lastLogin = u.last_login ? formatTime(u.last_login) : '—';
      const statusBadge = blocked
        ? `<span style="color:#f85149;font-weight:600;">${window.t ? window.t('admin.status_blocked', {}, '🚫 Заблокирован') : '🚫 Заблокирован'}</span>`
        : `<span style="color:#3fb950;">${window.t ? window.t('admin.status_active', {}, '✅ Активен') : '✅ Активен'}</span>`;

      let swlCell = '';
      if (role === 'user') {
        swlCell = `<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;" title="${window.t ? window.t('admin.swl_toggle_hint', {}, 'Режим SWL: только приём (запрет передачи)') : 'Режим SWL: только приём (запрет передачи)'}">
          <input type="checkbox" onchange="ProxDMRAdmin._setSwl(${u.id}, this.checked)" ${isSwl ? 'checked' : ''} style="cursor:pointer;width:14px;height:14px;accent-color:#58a6ff;">
          <span style="font-size:0.82em;${isSwl ? 'color:#58a6ff;font-weight:600;' : 'color:#8b949e;'}">${isSwl ? (window.t ? window.t('admin.swl_active', {}, '🎧 SWL') : '🎧 SWL') : (window.t ? window.t('admin.swl_off', {}, 'Выкл') : 'Выкл')}</span>
        </label>`;
      } else {
        swlCell = `<span style="color:#6e7681;font-size:0.82em;" title="${window.t ? window.t('admin.swl_not_applicable', {}, 'Не применимо к администраторам (только для обычных пользователей)') : 'Не применимо к администраторам (только для обычных пользователей)'}">—</span>`;
      }

      let actions = '';

      if (!isSelf && !isSuperadmin) {
        // Block / Unblock
        if (blocked) {
          actions += `<button class="admin-act-btn" onclick="ProxDMRAdmin._unblock(${u.id})" title="${window.t ? window.t('admin.action_unblock', {}, 'Разблокировать') : 'Разблокировать'}" style="color:#3fb950;">✅</button>`;
        } else {
          actions += `<button class="admin-act-btn" onclick="ProxDMRAdmin._block(${u.id})" title="${window.t ? window.t('admin.action_block', {}, 'Заблокировать') : 'Заблокировать'}" style="color:#f85149;">🚫</button>`;
        }

        // Role toggle (superadmin only)
        if (currentUserRole === 'superadmin') {
          if (role === 'user') {
            actions += `<button class="admin-act-btn" onclick="ProxDMRAdmin._setRole(${u.id},'admin')" title="${window.t ? window.t('admin.action_promote', {}, 'Повысить до админа') : 'Повысить до админа'}" style="color:#58a6ff;">⬆️</button>`;
          } else if (role === 'admin') {
            actions += `<button class="admin-act-btn" onclick="ProxDMRAdmin._setRole(${u.id},'user')" title="${window.t ? window.t('admin.action_demote', {}, 'Понизить до пользователя') : 'Понизить до пользователя'}" style="color:#8b949e;">⬇️</button>`;
          }
        }

        // Reset password
        actions += `<button class="admin-act-btn" onclick="ProxDMRAdmin._showResetPwd(${u.id},'${escHtml(u.login)}')" title="${window.t ? window.t('admin.action_reset_pwd', {}, 'Сбросить пароль') : 'Сбросить пароль'}" style="color:#ffcc00;">🔑</button>`;

        // Delete
        actions += `<button class="admin-act-btn" onclick="ProxDMRAdmin._delete(${u.id},'${escHtml(u.login)}')" title="${window.t ? window.t('buttons.delete', {}, 'Удалить') : 'Удалить'}" style="color:#f85149;">🗑️</button>`;
      } else if (isSelf) {
        actions = `<span style="color:#8b949e;font-size:0.78em;margin-right:6px;">${window.t ? window.t('admin.badge_you', {}, '(вы)') : '(вы)'}</span>` +
                  `<button class="admin-act-btn" onclick="ProxDMRAdmin._showResetPwd(${u.id},'${escHtml(u.login)}')" title="${window.t ? window.t('admin.action_change_my_pwd', {}, 'Сменить свой пароль') : 'Сменить свой пароль'}" style="color:#ffcc00;">🔑</button>`;
      } else if (isSuperadmin) {
        actions = `<span style="color:#ffcc00;font-size:0.78em;">${window.t ? window.t('admin.badge_protected', {}, 'защищён') : 'защищён'}</span>`;
      }

      html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="padding:8px;font-weight:600;color:var(--text-primary);">${escHtml(u.login)}</td>
        <td style="padding:8px;color:${roleColors[role] || '#8b949e'};">${roleLabels[role] || role}</td>
        <td style="padding:8px;">${swlCell}</td>
        <td style="padding:8px;">${statusBadge}</td>
        <td style="padding:8px;color:#8b949e;font-size:0.8em;">${lastLogin}</td>
        <td style="padding:8px;text-align:right;white-space:nowrap;">${actions}</td>
      </tr>`;
    }
    tbody.innerHTML = html;
  }

  // --- Actions ---
  window.ProxDMRAdmin._block = async function (userId) {
    const ok = await showAppConfirm({
      title: window.t ? window.t('admin.confirm_block_title', {}, 'Блокировка пользователя') : 'Блокировка пользователя',
      icon: '🚫',
      message: window.t ? window.t('admin.confirm_block_msg', {}, 'Заблокировать этого пользователя? Он потеряет доступ к системе.') : 'Заблокировать этого пользователя? Он потеряет доступ к системе.',
      confirmText: window.t ? window.t('admin.action_block', {}, 'Заблокировать') : 'Заблокировать',
      confirmStyle: 'danger'
    });
    if (!ok) return;
    await apiAction('/api/admin/users/block', { user_id: userId });
  };

  window.ProxDMRAdmin._unblock = async function (userId) {
    await apiAction('/api/admin/users/unblock', { user_id: userId });
  };

  window.ProxDMRAdmin._setRole = async function (userId, role) {
    const roleName = role === 'admin'
      ? (window.t ? window.t('admin.role_admin', {}, '🛡️ Администратор') : '🛡️ Администратор')
      : (window.t ? window.t('admin.role_user', {}, '👤 Пользователь') : '👤 Пользователь');
    const msg = window.t
      ? window.t('admin.confirm_role_msg', { role: roleName }, `Назначить роль ${roleName}?`)
      : `Назначить роль ${roleName}?`;
    const ok = await showAppConfirm({
      title: window.t ? window.t('admin.confirm_role_title', {}, 'Изменение роли') : 'Изменение роли',
      icon: role === 'admin' ? '🛡️' : '👤',
      message: msg,
      confirmText: window.t ? window.t('admin.confirm_role_btn', {}, 'Назначить') : 'Назначить',
      confirmStyle: 'primary'
    });
    if (!ok) return;
    await apiAction('/api/admin/users/role', { user_id: userId, role: role });
  };

  window.ProxDMRAdmin._delete = async function (userId, login) {
    const msg = window.t
      ? window.t('admin.confirm_delete_msg', { login: login }, `Удалить пользователя "${login}"?\n\nВсе настройки и данные аккаунта будут безвозвратно удалены. Это действие необратимо!`)
      : `Удалить пользователя "${login}"?\n\nВсе настройки и данные аккаунта будут безвозвратно удалены. Это действие необратимо!`;
    const ok = await showAppConfirm({
      title: window.t ? window.t('admin.confirm_delete_title', {}, 'Удаление пользователя') : 'Удаление пользователя',
      icon: '🗑️',
      message: msg,
      confirmText: window.t ? window.t('admin.confirm_delete_btn', {}, 'Удалить навсегда') : 'Удалить навсегда',
      confirmStyle: 'danger'
    });
    if (!ok) return;
    await apiAction('/api/admin/users/delete', { user_id: userId });
  };

  window.ProxDMRAdmin._showResetPwd = function (userId, login) {
    document.getElementById('adminResetPwdPanel').style.display = 'block';
    document.getElementById('adminResetPwdUserId').value = userId;
    document.getElementById('adminResetPwdUsername').textContent = login;
    document.getElementById('adminResetPwdInput').value = '';
    document.getElementById('adminResetPwdError').textContent = '';
    document.getElementById('adminResetPwdInput').focus();
  };

  function hideResetPwd() {
    document.getElementById('adminResetPwdPanel').style.display = 'none';
  }

  async function doResetPassword() {
    const userId = parseInt(document.getElementById('adminResetPwdUserId').value);
    const newPassword = document.getElementById('adminResetPwdInput').value;
    const errEl = document.getElementById('adminResetPwdError');

    if (!newPassword || newPassword.length < 6) {
      errEl.textContent = window.t ? window.t('admin.err_pwd_length', {}, 'Пароль должен быть не менее 6 символов') : 'Пароль должен быть не менее 6 символов';
      return;
    }

    try {
      const res = await fetch('/api/admin/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.detail || (window.t ? window.t('admin.err_reset_pwd', {}, 'Ошибка сброса пароля') : 'Ошибка сброса пароля');
        return;
      }
      hideResetPwd();
      loadUsers();
    } catch (e) {
      errEl.textContent = window.t ? window.t('admin.err_network', {}, 'Сетевая ошибка') : 'Сетевая ошибка';
    }
  }

  window.ProxDMRAdmin._setSwl = async function (userId, isSwl) {
    await apiAction('/api/admin/users/swl', { user_id: userId, is_swl: Boolean(isSwl) });
  };

  // --- Helpers ---
  async function apiAction(url, body) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        await showAppAlert(data.detail || (window.t ? window.t('admin.err_create', {}, 'Произошла ошибка при выполнении операции') : 'Произошла ошибка при выполнении операции'), { title: '⚠️', icon: '⚠️' });
        return;
      }
      loadUsers();
    } catch (e) {
      await showAppAlert(window.t ? window.t('admin.err_network', {}, 'Сетевая ошибка') : 'Не удалось связаться с сервером. Проверьте сетевое подключение.', { title: '⚠️', icon: '⚠️' });
    }
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
})();
