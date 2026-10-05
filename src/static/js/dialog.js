/**
 * ProxDMR Universal Custom Modal Dialogs (Alert / Confirm / Prompt)
 * Replaces native browser alert(), confirm(), prompt() with styled HTML modals.
 */
(function (global) {
  'use strict';

  let dialogModalEl = null;
  let currentResolve = null;

  function ensureDialogDOM() {
    if (dialogModalEl && document.body.contains(dialogModalEl)) {
      return dialogModalEl;
    }

    let existing = document.getElementById('appDialogModal');
    if (existing) {
      dialogModalEl = existing;
      return dialogModalEl;
    }

    const modal = document.createElement('div');
    modal.id = 'appDialogModal';
    modal.className = 'modal app-dialog-modal';
    modal.style.cssText = 'z-index: 11000; display: none;';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    modal.innerHTML = `
      <div class="modal-content app-dialog-content" style="max-width: 420px; width: 92%; box-sizing: border-box; padding: 22px 20px; display: flex; flex-direction: column; gap: 14px; border-radius: 14px; box-shadow: 0 16px 40px rgba(0,0,0,0.65); animation: appDialogFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);">
        <!-- Header -->
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <span id="appDialogIcon" style="font-size: 1.8rem; line-height: 1; flex-shrink: 0; user-select: none;">💬</span>
          <div style="min-width: 0; flex: 1;">
            <div id="appDialogTitle" style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary, #fff); line-height: 1.3;" data-i18n="dialog.confirm_title">Подтверждение</div>
            <div id="appDialogSubtitle" style="font-size: 0.78rem; color: var(--text-muted, #8b949e); margin-top: 3px; display: none;"></div>
          </div>
          <button type="button" id="appDialogCloseBtn" class="icon-btn" style="background: none; border: none; font-size: 1.15rem; cursor: pointer; color: var(--text-secondary, #8b949e); width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 6px; padding: 0; margin: -2px -2px 0 0;" title="Закрыть" data-i18n-title="buttons.close">✕</button>
        </div>

        <!-- Message Body -->
        <div id="appDialogMessage" style="font-size: 0.92rem; color: var(--text-primary, #e6edf3); line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 50vh; overflow-y: auto;"></div>

        <!-- Input for Prompt -->
        <div id="appDialogInputWrap" style="display: none; margin-top: 2px;">
          <div style="position: relative; display: flex; align-items: center;">
            <input type="text" id="appDialogInput" class="form-input" style="width: 100%; padding: 8px 36px 8px 12px; border-radius: 6px; border: 1px solid var(--border-color, #444); background: var(--bg-input, #2a2a2e); color: var(--text-primary, #fff); font-size: 0.94rem; box-sizing: border-box;" autocomplete="off">
            <button type="button" id="appDialogTogglePwd" style="position: absolute; right: 6px; background: none; border: none; font-size: 1rem; cursor: pointer; color: var(--text-secondary, #8b949e); display: none; padding: 4px; border-radius: 4px;" title="Показать/скрыть" data-i18n-title="dialog.show_hide">👁️</button>
          </div>
          <div id="appDialogInputError" style="color: #f85149; font-size: 0.8rem; min-height: 1.1em; margin-top: 4px; display: none;"></div>
        </div>

        <!-- Action Buttons Footer -->
        <div id="appDialogFooter" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;">
          <button type="button" id="appDialogCancelBtn" class="btn-secondary" style="padding: 7px 16px; border-radius: 6px; cursor: pointer; font-size: 0.88rem; min-width: 80px;" data-i18n="buttons.cancel">Отмена</button>
          <button type="button" id="appDialogConfirmBtn" class="btn-primary" style="padding: 7px 18px; border-radius: 6px; cursor: pointer; font-size: 0.88rem; font-weight: 600; min-width: 80px;" data-i18n="buttons.ok">ОК</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    dialogModalEl = modal;

    // Attach base event listeners
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeDialog(null);
      }
    });

    const closeBtn = document.getElementById('appDialogCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        closeDialog(null);
      });
    }

    const cancelBtn = document.getElementById('appDialogCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        closeDialog(null);
      });
    }

    const togglePwd = document.getElementById('appDialogTogglePwd');
    const inputEl = document.getElementById('appDialogInput');
    if (togglePwd && inputEl) {
      togglePwd.addEventListener('click', function () {
        if (inputEl.type === 'password') {
          inputEl.type = 'text';
          togglePwd.textContent = '🙈';
        } else {
          inputEl.type = 'password';
          togglePwd.textContent = '👁️';
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if (!dialogModalEl || !dialogModalEl.classList.contains('active')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog(null);
      } else if (e.key === 'Enter') {
        const inputWrap = document.getElementById('appDialogInputWrap');
        if (inputWrap && inputWrap.style.display !== 'none') {
          // If input is focused or Enter pressed in prompt
          e.preventDefault();
          const confirmBtn = document.getElementById('appDialogConfirmBtn');
          if (confirmBtn) confirmBtn.click();
        }
      }
    });

    return dialogModalEl;
  }

  function closeDialog(value) {
    if (!dialogModalEl) return;
    dialogModalEl.classList.remove('active');
    dialogModalEl.style.display = 'none';
    if (typeof currentResolve === 'function') {
      const res = currentResolve;
      currentResolve = null;
      res(value);
    }
  }

  /**
   * Universal custom confirm modal dialog.
   * @param {string|Object} optionsOrMsg
   * @returns {Promise<boolean>}
   */
  function showAppConfirm(optionsOrMsg) {
    ensureDialogDOM();

    let opts = {};
    if (typeof optionsOrMsg === 'string') {
      opts = { message: optionsOrMsg };
    } else if (optionsOrMsg && typeof optionsOrMsg === 'object') {
      opts = Object.assign({}, optionsOrMsg);
    }

    const title = opts.title || (window.t ? window.t('dialog.confirm_title', {}, 'Подтверждение') : 'Подтверждение');
    const message = opts.message || '';
    const icon = opts.icon || (opts.confirmStyle === 'danger' ? '⚠️' : '❓');
    const confirmText = opts.confirmText || (window.t ? window.t('buttons.confirm', {}, 'Да') : 'Да');
    const cancelText = opts.cancelText || (window.t ? window.t('buttons.cancel', {}, 'Отмена') : 'Отмена');
    const confirmStyle = opts.confirmStyle || 'primary'; // 'primary' | 'danger' | 'success'

    const titleEl = document.getElementById('appDialogTitle');
    const subtitleEl = document.getElementById('appDialogSubtitle');
    const iconEl = document.getElementById('appDialogIcon');
    const msgEl = document.getElementById('appDialogMessage');
    const inputWrap = document.getElementById('appDialogInputWrap');
    const cancelBtn = document.getElementById('appDialogCancelBtn');
    const confirmBtn = document.getElementById('appDialogConfirmBtn');

    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) {
      if (opts.subtitle) {
        subtitleEl.textContent = opts.subtitle;
        subtitleEl.style.display = 'block';
      } else {
        subtitleEl.style.display = 'none';
      }
    }
    if (iconEl) iconEl.textContent = icon;
    if (msgEl) {
      if (opts.html || /<[a-z][\s\S]*>/i.test(message)) {
        msgEl.innerHTML = message;
      } else {
        msgEl.textContent = message;
      }
    }
    if (inputWrap) inputWrap.style.display = 'none';

    if (cancelBtn) {
      cancelBtn.style.display = 'inline-block';
      cancelBtn.textContent = cancelText;
    }

    if (confirmBtn) {
      confirmBtn.textContent = confirmText;
      confirmBtn.className = 'btn-' + confirmStyle;
      if (confirmStyle === 'danger') {
        confirmBtn.style.cssText = 'padding: 7px 18px; border-radius: 6px; cursor: pointer; font-size: 0.88rem; font-weight: 600; min-width: 80px; background: #da3633; color: #fff; border: 1px solid #f85149;';
      } else if (confirmStyle === 'success') {
        confirmBtn.style.cssText = 'padding: 7px 18px; border-radius: 6px; cursor: pointer; font-size: 0.88rem; font-weight: 600; min-width: 80px; background: #238636; color: #fff; border: 1px solid #2ea043;';
      } else {
        confirmBtn.style.cssText = 'padding: 7px 18px; border-radius: 6px; cursor: pointer; font-size: 0.88rem; font-weight: 600; min-width: 80px; background: #1f6feb; color: #fff; border: 1px solid #388bfd;';
      }

      confirmBtn.onclick = function () {
        closeDialog(true);
      };
    }

    dialogModalEl.style.display = 'flex';
    dialogModalEl.classList.add('active');

    if (confirmBtn) confirmBtn.focus();

    return new Promise(function (resolve) {
      currentResolve = function (val) {
        resolve(Boolean(val));
      };
    });
  }

  /**
   * Universal custom alert modal dialog.
   * @param {string|Object} optionsOrMsg
   * @param {Object} [extraOpts]
   * @returns {Promise<void>}
   */
  function showAppAlert(optionsOrMsg, extraOpts) {
    ensureDialogDOM();

    let opts = {};
    if (typeof optionsOrMsg === 'string') {
      opts = Object.assign({ message: optionsOrMsg }, extraOpts || {});
    } else if (optionsOrMsg && typeof optionsOrMsg === 'object') {
      opts = Object.assign({}, optionsOrMsg, extraOpts || {});
    }

    const title = opts.title || (window.t ? window.t('dialog.alert_title', {}, 'Внимание') : 'Внимание');
    const message = opts.message || '';
    const icon = opts.icon || 'ℹ️';
    const confirmText = opts.confirmText || (window.t ? window.t('buttons.ok', {}, 'ОК') : 'ОК');

    const titleEl = document.getElementById('appDialogTitle');
    const subtitleEl = document.getElementById('appDialogSubtitle');
    const iconEl = document.getElementById('appDialogIcon');
    const msgEl = document.getElementById('appDialogMessage');
    const inputWrap = document.getElementById('appDialogInputWrap');
    const cancelBtn = document.getElementById('appDialogCancelBtn');
    const confirmBtn = document.getElementById('appDialogConfirmBtn');

    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.style.display = 'none';
    if (iconEl) iconEl.textContent = icon;
    if (msgEl) msgEl.textContent = message;
    if (inputWrap) inputWrap.style.display = 'none';

    if (cancelBtn) cancelBtn.style.display = 'none';

    if (confirmBtn) {
      confirmBtn.textContent = confirmText;
      confirmBtn.style.cssText = 'padding: 7px 22px; border-radius: 6px; cursor: pointer; font-size: 0.88rem; font-weight: 600; min-width: 80px; background: #1f6feb; color: #fff; border: 1px solid #388bfd;';
      confirmBtn.onclick = function () {
        closeDialog(true);
      };
    }

    dialogModalEl.style.display = 'flex';
    dialogModalEl.classList.add('active');

    if (confirmBtn) confirmBtn.focus();

    return new Promise(function (resolve) {
      currentResolve = function () {
        resolve();
      };
    });
  }

  /**
   * Universal custom prompt modal dialog (with support for passwords and validation).
   * @param {string|Object} optionsOrMsg
   * @returns {Promise<string|null>}
   */
  function showAppPrompt(optionsOrMsg) {
    ensureDialogDOM();

    let opts = {};
    if (typeof optionsOrMsg === 'string') {
      opts = { message: optionsOrMsg };
    } else if (optionsOrMsg && typeof optionsOrMsg === 'object') {
      opts = Object.assign({}, optionsOrMsg);
    }

    const title = opts.title || (window.t ? window.t('dialog.prompt_title', {}, 'Ввод данных') : 'Ввод данных');
    const message = opts.message || '';
    const icon = opts.icon || (opts.isPassword ? '🔑' : '✏️');
    const placeholder = opts.placeholder || '';
    const defaultValue = opts.defaultValue || '';
    const isPassword = Boolean(opts.isPassword);
    const confirmText = opts.confirmText || (window.t ? window.t('buttons.ok', {}, 'ОК') : 'ОК');
    const cancelText = opts.cancelText || (window.t ? window.t('buttons.cancel', {}, 'Отмена') : 'Отмена');
    const confirmStyle = opts.confirmStyle || 'primary';

    const titleEl = document.getElementById('appDialogTitle');
    const subtitleEl = document.getElementById('appDialogSubtitle');
    const iconEl = document.getElementById('appDialogIcon');
    const msgEl = document.getElementById('appDialogMessage');
    const inputWrap = document.getElementById('appDialogInputWrap');
    const inputEl = document.getElementById('appDialogInput');
    const togglePwd = document.getElementById('appDialogTogglePwd');
    const errorEl = document.getElementById('appDialogInputError');
    const cancelBtn = document.getElementById('appDialogCancelBtn');
    const confirmBtn = document.getElementById('appDialogConfirmBtn');

    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.style.display = 'none';
    if (iconEl) iconEl.textContent = icon;
    if (msgEl) msgEl.textContent = message;

    if (inputWrap && inputEl) {
      inputWrap.style.display = 'block';
      inputEl.type = isPassword ? 'password' : 'text';
      inputEl.value = defaultValue;
      inputEl.placeholder = placeholder;
      if (errorEl) errorEl.style.display = 'none';

      if (togglePwd) {
        togglePwd.style.display = isPassword ? 'block' : 'none';
        togglePwd.textContent = '👁️';
      }
    }

    if (cancelBtn) {
      cancelBtn.style.display = 'inline-block';
      cancelBtn.textContent = cancelText;
    }

    if (confirmBtn) {
      confirmBtn.textContent = confirmText;
      if (confirmStyle === 'danger') {
        confirmBtn.style.cssText = 'padding: 7px 18px; border-radius: 6px; cursor: pointer; font-size: 0.88rem; font-weight: 600; min-width: 80px; background: #da3633; color: #fff; border: 1px solid #f85149;';
      } else {
        confirmBtn.style.cssText = 'padding: 7px 18px; border-radius: 6px; cursor: pointer; font-size: 0.88rem; font-weight: 600; min-width: 80px; background: #1f6feb; color: #fff; border: 1px solid #388bfd;';
      }

      confirmBtn.onclick = function () {
        const val = inputEl ? inputEl.value : '';
        if (typeof opts.validate === 'function') {
          const err = opts.validate(val);
          if (err) {
            if (errorEl) {
              errorEl.textContent = err;
              errorEl.style.display = 'block';
            }
            if (inputEl) inputEl.focus();
            return;
          }
        }
        closeDialog(val);
      };
    }

    dialogModalEl.style.display = 'flex';
    dialogModalEl.classList.add('active');

    setTimeout(function () {
      if (inputEl) {
        inputEl.focus();
        if (inputEl.value) inputEl.select();
      }
    }, 50);

    return new Promise(function (resolve) {
      currentResolve = function (val) {
        resolve(val);
      };
    });
  }

  // Expose globally
  global.showAppConfirm = showAppConfirm;
  global.showAppAlert = showAppAlert;
  global.showAppPrompt = showAppPrompt;

  // ── Universal Modal Save Confirmation Green Glow Pulse ───────────────────
  function triggerModalSavePulse(targetEl) {
    if (typeof document === 'undefined') return;

    let modalContent = null;
    if (targetEl && targetEl.nodeType) {
      modalContent = targetEl.closest('.modal-content') || targetEl.closest('.modal');
    }
    if (!modalContent) {
      const activeModal = document.querySelector('#settingsModal.active, .modal.active, .modal[style*="display: flex"], .modal[style*="display: block"]');
      if (activeModal) {
        modalContent = activeModal.querySelector('.modal-content') || activeModal;
      }
    }
    if (!modalContent) {
      modalContent = document.querySelector('#settingsModal .modal-content') || document.querySelector('.modal-content');
    }
    if (!modalContent) return;

    modalContent.classList.remove('modal-save-pulse');
    void modalContent.offsetWidth; // Force reflow to restart animation from 0%
    modalContent.classList.add('modal-save-pulse');

    if (modalContent._savePulseTimer) {
      clearTimeout(modalContent._savePulseTimer);
    }
    modalContent._savePulseTimer = setTimeout(() => {
      modalContent.classList.remove('modal-save-pulse');
      modalContent._savePulseTimer = null;
    }, 1050);
  }

  global.triggerModalSavePulse = triggerModalSavePulse;

  if (typeof document !== 'undefined') {
    // Delegated click listener: capture click on any save button in any settings / modal
    document.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('button, input[type="submit"]') : null;
      if (!btn) return;

      const modal = btn.closest('#settingsModal, .modal');
      if (!modal) return;

      const text = (btn.textContent || '').trim().toLowerCase();
      const i18n = (btn.getAttribute('data-i18n') || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const isSubmit = btn.type === 'submit';

      const isSaveBtn = isSubmit ||
        text.includes('сохранить') ||
        text.includes('save') ||
        i18n.includes('save') ||
        i18n.includes('btn_save') ||
        title.includes('сохранить') ||
        btn.classList.contains('btn-preset-save') ||
        (btn.id && btn.id.toLowerCase().includes('save'));

      if (isSaveBtn) {
        triggerModalSavePulse(btn);
      }
    }, true);

    // Delegated submit listener: forms submitted inside modal
    document.addEventListener('submit', function (e) {
      const form = e.target;
      if (!form) return;
      const modal = form.closest ? form.closest('#settingsModal, .modal') : null;
      if (modal) {
        triggerModalSavePulse(form);
      }
    }, true);
  }

  // Keyframes for smooth entrance
  if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes appDialogFadeIn {
        from { opacity: 0; transform: scale(0.92); }
        to { opacity: 1; transform: scale(1); }
      }
      .app-dialog-modal {
        transition: opacity 0.15s ease-out;
      }
    `;
    document.head.appendChild(style);
  }

})(typeof window !== 'undefined' ? window : this);
