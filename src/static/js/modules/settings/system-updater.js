/**
 * ProxDMR - System Updater Client Subsystem
 * Checks GitHub for ProxDMR application updates, handles 24h notification banner,
 * responsive & mobile fullscreen multilingual changelog modal, and initiates server update.
 */

import { showToast } from "../core/toast.js";

let _latestUpdateInfo = null;
let _selectedLang = "ru";

const SUPPORTED_LANGS = ["ru", "en", "uk", "de", "es", "fr", "it"];

const LANG_NAMES = {
  ru: "🇷🇺 Русский",
  en: "🇬🇧 English",
  uk: "🇺🇦 Українська",
  de: "🇩🇪 Deutsch",
  es: "🇪🇸 Español",
  fr: "🇫🇷 Français",
  it: "🇮🇹 Italiano"
};

function getActiveLanguage() {
  const current = (window.currentLang || (window.I18N && window.I18N.currentLanguage) || localStorage.getItem("proxdmr_language") || "ru").toLowerCase();
  return SUPPORTED_LANGS.includes(current) ? current : "ru";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMarkdown(text) {
  if (!text) return '<p style="color:#8b949e;font-style:italic;">Нет описания изменений</p>';

  const lines = text.split(/\r?\n/);
  let html = "";
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Headers
    if (line.startsWith("### ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h4 style="margin: 14px 0 6px; font-size: 0.95rem; font-weight: 700; color: #58a6ff;">${escapeHtml(line.slice(4))}</h4>`;
      continue;
    }
    if (line.startsWith("## ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h3 style="margin: 18px 0 8px; font-size: 1.05rem; font-weight: 700; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">${escapeHtml(line.slice(3))}</h3>`;
      continue;
    }
    if (line.startsWith("# ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h2 style="margin: 20px 0 10px; font-size: 1.15rem; font-weight: 700; color: #fff;">${escapeHtml(line.slice(2))}</h2>`;
      continue;
    }

    // List item
    const listMatch = line.match(/^[\*\-]\s+(.*)$/);
    if (listMatch) {
      if (!inList) {
        html += '<ul style="margin: 6px 0 10px 18px; padding: 0; list-style-type: disc;">';
        inList = true;
      }
      let content = escapeHtml(listMatch[1]);
      // Bold
      content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Inline code
      content = content.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius: 0px;font-size:0.85em;color:#f39c12;">$1</code>');
      html += `<li style="margin-bottom: 4px; line-height: 1.45;">${content}</li>`;
      continue;
    }

    if (inList) {
      html += "</ul>";
      inList = false;
    }

    // Empty line
    if (!line.trim()) {
      html += '<div style="height: 6px;"></div>';
      continue;
    }

    // Regular line
    let content = escapeHtml(line);
    content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    content = content.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius: 0px;font-size:0.85em;color:#f39c12;">$1</code>');
    html += `<p style="margin: 0 0 6px 0; line-height: 1.5;">${content}</p>`;
  }

  if (inList) {
    html += "</ul>";
  }

  return html;
}

export function initSystemUpdater() {
  if (window._systemUpdaterInitialized) return;
  window._systemUpdaterInitialized = true;

  const frame = document.getElementById("updateSettingsFrame");
  const toggle = document.getElementById("updateSettingsToggle");
  const optDisable = document.getElementById("optDisableUpdateNotifications");
  const btnManualCheck = document.getElementById("btnCheckUpdateManual");
  const btnViewNotesSettings = document.getElementById("btnViewReleaseNotesSettings");
  const btnApplySettings = document.getElementById("btnApplyUpdateSettings");

  // Mini Banner Elements
  const banner = document.getElementById("systemUpdateBanner");
  const btnCloseBanner = document.getElementById("btnCloseUpdateBanner");
  const chkDismissNext = document.getElementById("chkDismissUntilNextVer");
  const btnOpenNotesBanner = document.getElementById("btnOpenChangelogFromBanner");
  const btnApplyBanner = document.getElementById("btnApplyUpdateFromBanner");

  // Changelog Modal Elements
  const modal = document.getElementById("systemChangelogModal");
  const btnCloseModal = document.getElementById("btnCloseChangelogModal");
  const btnCloseModalBottom = document.getElementById("btnChangelogCloseBottom");
  const btnApplyModal = document.getElementById("btnApplyUpdateFromModal");

  // 1. Collapsible Frame Toggle & State
  if (frame && toggle && !toggle._wired) {
    toggle._wired = true;
    const body = document.getElementById("updateSettingsBody");
    const chevron = document.getElementById("updateSettingsChevron");

    const savedState = localStorage.getItem("proxdmr_update_frame_collapsed");
    if (savedState === "false") {
      frame.classList.remove("collapsed");
      if (body) body.style.display = "block";
      if (chevron) chevron.style.transform = "rotate(0deg)";
    } else {
      frame.classList.add("collapsed");
      if (body) body.style.display = "none";
      if (chevron) chevron.style.transform = "rotate(-90deg)";
    }

    toggle.addEventListener("click", () => {
      const isNowCollapsed = frame.classList.toggle("collapsed");
      if (body) body.style.display = isNowCollapsed ? "none" : "block";
      if (chevron) chevron.style.transform = isNowCollapsed ? "rotate(-90deg)" : "rotate(0deg)";
      localStorage.setItem("proxdmr_update_frame_collapsed", isNowCollapsed ? "true" : "false");
    });
  }

  // 2. Global Checkbox: Disable Update Notifications
  if (optDisable && !optDisable._wired) {
    optDisable._wired = true;
    if (typeof window.DISABLE_UPDATE_NOTIFICATIONS !== "undefined") {
      optDisable.checked = !!window.DISABLE_UPDATE_NOTIFICATIONS;
    }

    optDisable.addEventListener("change", async () => {
      const disabled = optDisable.checked;
      window.DISABLE_UPDATE_NOTIFICATIONS = disabled;

      if (disabled && banner) {
        banner.style.display = "none";
      }

      try {
        const resp = await fetch("/api/settings/general", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disable_update_notifications: disabled })
        });
        const data = await resp.json();
        if (data && data.status === "ok") {
          showToast(disabled ? (window.t ? window.t("updates.notif_disabled", {}, "Оповещения об обновлениях отключены") : "Оповещения об обновлениях отключены")
                             : (window.t ? window.t("updates.notif_enabled", {}, "Оповещения об обновлениях включены") : "Оповещения об обновлениях включены"), 2500);
        }
      } catch (err) {
        console.warn("[UPDATER] Failed to save disable_update_notifications:", err);
      }
    });
  }

  // 3. Manual Check Button
  if (btnManualCheck && !btnManualCheck._wired) {
    btnManualCheck._wired = true;
    btnManualCheck.addEventListener("click", () => {
      checkUpdates(true);
    });
  }

  // 4. View Release Notes / Changelog
  const openChangelog = () => {
    openChangelogModal();
  };
  if (btnViewNotesSettings) btnViewNotesSettings.addEventListener("click", openChangelog);
  if (btnOpenNotesBanner) btnOpenNotesBanner.addEventListener("click", openChangelog);

  // 5. Apply Update Buttons
  const triggerUpdate = () => {
    confirmAndApplyUpdate();
  };
  if (btnApplySettings) btnApplySettings.addEventListener("click", triggerUpdate);
  if (btnApplyBanner) btnApplyBanner.addEventListener("click", triggerUpdate);
  if (btnApplyModal) btnApplyModal.addEventListener("click", triggerUpdate);

  // 6. Dismiss & Close Mini Banner
  if (btnCloseBanner) {
    btnCloseBanner.addEventListener("click", () => {
      if (banner) banner.style.display = "none";
      if (chkDismissNext && chkDismissNext.checked && _latestUpdateInfo && _latestUpdateInfo.latest_version) {
        localStorage.setItem("proxdmr_update_dismissed_ver", _latestUpdateInfo.latest_version);
      }
      localStorage.setItem("proxdmr_update_last_prompt", Date.now().toString());
    });
  }

  if (chkDismissNext) {
    chkDismissNext.addEventListener("change", () => {
      if (chkDismissNext.checked && _latestUpdateInfo && _latestUpdateInfo.latest_version) {
        localStorage.setItem("proxdmr_update_dismissed_ver", _latestUpdateInfo.latest_version);
      } else {
        localStorage.removeItem("proxdmr_update_dismissed_ver");
      }
    });
  }

  // 7. Modal Close
  const closeModal = () => {
    if (modal) modal.style.display = "none";
  };
  if (btnCloseModal) btnCloseModal.addEventListener("click", closeModal);
  if (btnCloseModalBottom) btnCloseModalBottom.addEventListener("click", closeModal);
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // 8. Language pills in modal
  document.querySelectorAll(".changelog-lang-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const lang = pill.getAttribute("data-lang");
      if (lang) {
        _selectedLang = lang;
        updateChangelogContent();
      }
    });
  });

  // Background check on boot after 2.5s
  setTimeout(() => {
    checkUpdates(false);
  }, 2500);
}

export async function checkUpdates(manual = false) {
  const btnManualCheck = document.getElementById("btnCheckUpdateManual");
  const checkStatusText = document.getElementById("systemCheckStatusText");
  const btnIcon = document.getElementById("btnCheckUpdateIcon");
  const btnText = document.getElementById("btnCheckUpdateText");

  if (manual && btnManualCheck) {
    btnManualCheck.disabled = true;
    if (btnIcon) btnIcon.style.animation = "spin 1s linear infinite";
    if (btnText) btnText.textContent = window.t ? window.t("updates.checking", {}, "Проверка...") : "Проверка...";
    if (checkStatusText) checkStatusText.textContent = "";
  }

  try {
    const url = `/api/system/check-update${manual ? "?force=true" : ""}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data && data.status === "ok") {
      _latestUpdateInfo = data;
      renderUpdateStatus(data, manual);
    } else {
      if (manual && checkStatusText) {
        checkStatusText.style.color = "#f85149";
        checkStatusText.textContent = `Ошибка проверки: ${data.message || "Сбой соединения"}`;
      }
    }
  } catch (err) {
    console.warn("[UPDATER] Update check failed:", err);
    if (manual && checkStatusText) {
      checkStatusText.style.color = "#f85149";
      checkStatusText.textContent = `Ошибка: ${err.message}`;
    }
  } finally {
    if (manual && btnManualCheck) {
      btnManualCheck.disabled = false;
      if (btnIcon) btnIcon.style.animation = "none";
      if (btnText) btnText.textContent = window.t ? window.t("updates.check_btn", {}, "Проверить обновления") : "Проверить обновления";
    }
  }
}

function renderUpdateStatus(data, manual = false) {
  const badgeHeader = document.getElementById("systemUpdateBadgeHeader");
  const statusPill = document.getElementById("systemUpdateStatusPill");
  const currentVerLabel = document.getElementById("systemCurrentVerLabel");
  const currentDateLabel = document.getElementById("systemCurrentDateLabel");
  const availableBlock = document.getElementById("systemUpdateAvailableBlock");
  const newVerLabel = document.getElementById("systemNewVerLabel");
  const newDateLabel = document.getElementById("systemNewDateLabel");
  const banner = document.getElementById("systemUpdateBanner");
  const bannerTitle = document.getElementById("systemBannerVerTitle");
  const checkStatusText = document.getElementById("systemCheckStatusText");

  if (currentVerLabel && data.current_version) {
    currentVerLabel.textContent = `v${data.current_version}`;
  }
  if (currentDateLabel && data.current_date) {
    currentDateLabel.textContent = `(${data.current_date})`;
  }

  if (data.has_update) {
    // Update Available!
    if (badgeHeader) {
      badgeHeader.style.display = "inline-block";
      badgeHeader.textContent = `v${data.latest_version}`;
    }
    if (statusPill) {
      statusPill.style.background = "rgba(231, 76, 60, 0.18)";
      statusPill.style.color = "#ff7675";
      statusPill.textContent = `⚡ Доступна v${data.latest_version}`;
    }
    if (availableBlock) availableBlock.style.display = "block";
    if (newVerLabel) newVerLabel.textContent = `Доступна v${data.latest_version}`;
    if (newDateLabel && data.release_date) newDateLabel.textContent = `(${data.release_date})`;

    if (manual && checkStatusText) {
      checkStatusText.style.color = "#ff7675";
      checkStatusText.textContent = `Найдено обновление: v${data.latest_version}`;
      showToast(`🚀 Найдено обновление ProxDMR: v${data.latest_version}`, 3500);
    }

    // Mini Banner Logic:
    const disableNotif = !!data.disable_update_notifications || (window.DISABLE_UPDATE_NOTIFICATIONS === true);
    const dismissedVer = localStorage.getItem("proxdmr_update_dismissed_ver");
    const lastPrompt = parseInt(localStorage.getItem("proxdmr_update_last_prompt") || "0", 10);
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Banner conditions:
    // 1. Not globally disabled
    // 2. Not dismissed for this exact version
    // 3. Once per 24 hours (or if checked manually)
    const canPromptBanner = !disableNotif && (dismissedVer !== data.latest_version) && ((now - lastPrompt > oneDayMs) || manual);

    if (banner && canPromptBanner) {
      if (bannerTitle) {
        bannerTitle.textContent = (window.t ? window.t("updates.banner_title", { ver: data.latest_version }, `Доступно обновление ProxDMR v${data.latest_version}`)
                                           : `Доступно обновление ProxDMR v${data.latest_version}`);
      }
      banner.style.display = "block";
      localStorage.setItem("proxdmr_update_last_prompt", now.toString());
    }
  } else {
    // Up to date!
    if (badgeHeader) badgeHeader.style.display = "none";
    if (statusPill) {
      statusPill.style.background = "rgba(46, 204, 113, 0.15)";
      statusPill.style.color = "#2ecc71";
      statusPill.textContent = window.t ? window.t("updates.up_to_date", {}, "✓ Актуальна") : "✓ Актуальна";
    }
    if (availableBlock) availableBlock.style.display = "none";
    if (banner) banner.style.display = "none";

    if (manual) {
      if (checkStatusText) {
        checkStatusText.style.color = "#2ecc71";
        checkStatusText.textContent = "✓ У вас самая последняя версия";
      }
      showToast("✓ У вас установлена актуальная версия ProxDMR", 2500);
    }
  }
}

export function openChangelogModal() {
  const modal = document.getElementById("systemChangelogModal");
  if (!modal) return;

  _selectedLang = getActiveLanguage();
  updateChangelogContent();
  modal.style.display = "flex";
}

function updateChangelogContent() {
  const title = document.getElementById("systemChangelogModalTitle");
  const contentEl = document.getElementById("systemChangelogContent");

  const ver = _latestUpdateInfo ? _latestUpdateInfo.latest_version : (window.APP_VERSION || "");
  if (title) {
    title.textContent = window.t ? window.t("updates.modal_title", { ver }, `Что нового в ProxDMR v${ver}`) : `Что нового в ProxDMR v${ver}`;
  }

  // Update active pill
  document.querySelectorAll(".changelog-lang-pill").forEach(pill => {
    if (pill.getAttribute("data-lang") === _selectedLang) {
      pill.classList.add("active");
    } else {
      pill.classList.remove("active");
    }
  });

  if (!contentEl) return;

  if (!_latestUpdateInfo) {
    contentEl.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 25px;">Загрузка описания изменений...</div>';
    return;
  }

  const notesByLang = _latestUpdateInfo.notes_by_lang || {};
  let text = notesByLang[_selectedLang] || notesByLang["ru"] || notesByLang["en"] || _latestUpdateInfo.raw_notes || "";

  contentEl.innerHTML = formatMarkdown(text);
}

export async function confirmAndApplyUpdate() {
  if (!_latestUpdateInfo || !_latestUpdateInfo.has_update) {
    showToast("⚠️ Нет доступных обновлений для установки", 2500);
    return;
  }

  const newVer = _latestUpdateInfo.latest_version;
  const promptMsg = window.t ? window.t("updates.confirm_apply", { ver: newVer },
    `Вы действительно хотите обновить ProxDMR до версии v${newVer}?\n\nСервер автоматически скачает обновление с GitHub, создаст резервную копию и перезагрузится.`)
    : `Вы действительно хотите обновить ProxDMR до версии v${newVer}?\n\nСервер автоматически скачает обновление с GitHub, создаст резервную копию и перезагрузится.`;

  if (!confirm(promptMsg)) return;

  // Show blocking overlay / loader
  const modal = document.getElementById("systemChangelogModal");
  if (modal) modal.style.display = "none";
  const banner = document.getElementById("systemUpdateBanner");
  if (banner) banner.style.display = "none";

  showUpdatingOverlay(newVer);

  try {
    const resp = await fetch("/api/system/apply-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tarball_url: _latestUpdateInfo.tarball_url })
    });
    const res = await resp.json();

    if (res && res.status === "ok") {
      pollServerRebootAndReload();
    } else {
      hideUpdatingOverlay();
      showToast(`✕ ${res.message || "Ошибка обновления"}`, 5000);
    }
  } catch (err) {
    // If request failed because server rebooted immediately, poll for reconnection
    pollServerRebootAndReload();
  }
}

function showUpdatingOverlay(version) {
  let overlay = document.getElementById("systemUpdateOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "systemUpdateOverlay";
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(10,12,16,0.95);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;padding:20px;text-align:center;backdrop-filter:blur(8px);";
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div style="background:#161b22;border:1px solid #30363d;padding:28px 24px;border-radius: 0px;max-width:420px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.8);">
      <div style="font-size:2.8rem;margin-bottom:14px;animation:spin 2s linear infinite;">🔄</div>
      <h3 style="margin:0 0 10px;font-size:1.2rem;color:#58a6ff;">Установка обновления ProxDMR v${version}</h3>
      <p style="font-size:0.88rem;color:#8b949e;line-height:1.5;margin-bottom:16px;">
        Скачивание исходных кодов с GitHub, создание резервной копии и перезапуск сервера... Пожалуйста, подождите.
      </p>
      <div id="systemUpdateProgressDots" style="font-size:0.82rem;color:#a4b0be;font-family:monospace;">
        Перезапуск сервера...
      </div>
    </div>
  `;
  overlay.style.display = "flex";
}

function hideUpdatingOverlay() {
  const overlay = document.getElementById("systemUpdateOverlay");
  if (overlay) overlay.style.display = "none";
}

function pollServerRebootAndReload() {
  let attempts = 0;
  const maxAttempts = 50;

  const interval = setInterval(async () => {
    attempts++;
    try {
      const resp = await fetch(`/api/system/check-update?_t=${Date.now()}`, { cache: "no-store" });
      if (resp.ok) {
        clearInterval(interval);
        const dots = document.getElementById("systemUpdateProgressDots");
        if (dots) dots.textContent = "✓ Сервер запущен! Перезагрузка страницы...";
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      }
    } catch (_) {
      // Server still rebooting...
      const dots = document.getElementById("systemUpdateProgressDots");
      if (dots) dots.textContent = `Ожидание запуска сервера (${attempts}с)...`;
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      const dots = document.getElementById("systemUpdateProgressDots");
      if (dots) dots.innerHTML = `⚠️ Сервер перезапускается дольше обычного.<br><a href="/" style="color:#58a6ff;text-decoration:underline;">Нажмите сюда для перехода</a>`;
    }
  }, 1200);
}

// Window exports
if (typeof window !== "undefined") {
  window.initSystemUpdater = initSystemUpdater;
  window.checkSystemUpdates = checkUpdates;
  window.openChangelogModal = openChangelogModal;
  window.confirmAndApplyUpdate = confirmAndApplyUpdate;
}
