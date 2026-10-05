/**
 * ProxDMR Application Updater & AndroidBridge APK Installer
 * Handles SemVer comparison, background APK update check, and UI alert banners
 */

// --- Version comparison helper (semver/numeric safe) ---
function compareVersions(v1, v2) {
  if (!v1 && !v2) return 0;
  if (!v1) return -1;
  if (!v2) return 1;
  const clean1 = String(v1).replace(/^[^\d]+/, "").trim();
  const clean2 = String(v2).replace(/^[^\d]+/, "").trim();
  const parts1 = clean1.split(".").map(p => parseInt(p, 10) || 0);
  const parts2 = clean2.split(".").map(p => parseInt(p, 10) || 0);
  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}
window.compareVersions = compareVersions;

// --- Safe APK download trigger via AndroidBridge with backward-compatible fallback ---
function triggerApkDownload(targetUrl, targetFilename) {
  if (!window.AndroidBridge) return;
  const url = targetUrl || "/download/apk";
  const filename = targetFilename || "ProxDMR.apk";
  console.log(`[APK Update] Requesting download: url=${url}, filename=${filename}`);
  if (typeof window.AndroidBridge.downloadApkWithFilename === "function") {
    try {
      window.AndroidBridge.downloadApkWithFilename(url, filename);
      return;
    } catch (err) {
      console.warn("[APK Update] downloadApkWithFilename failed:", err);
    }
  }
  if (typeof window.AndroidBridge.downloadApk === "function") {
    try {
      window.AndroidBridge.downloadApk(url, filename);
    } catch (err) {
      console.warn("[APK Update] downloadApk(url, filename) failed, trying downloadApk(url):", err);
      try {
        window.AndroidBridge.downloadApk(url);
      } catch (err2) {
        console.error("[APK Update] downloadApk(url) failed:", err2);
      }
    }
  }
}
window.triggerApkDownload = triggerApkDownload;

// --- Dynamic APK Update UI Updater ---
function updateApkUpdateUI(serverInfo) {
  if (serverInfo) {
    if (serverInfo.apk_version || serverInfo.version) {
      window.SERVER_APK_VERSION = String(serverInfo.apk_version || serverInfo.version);
    }
    if (serverInfo.apk_filename || serverInfo.filename) {
      window.SERVER_APK_FILENAME = String(serverInfo.apk_filename || serverInfo.filename);
    }
    if (serverInfo.apk_path || serverInfo.path || serverInfo.apk_url || serverInfo.url) {
      window.SERVER_APK_PATH = String(serverInfo.apk_path || serverInfo.path || serverInfo.apk_url || serverInfo.url);
    }
  }

  const webApkBlock = document.getElementById("webApkDownloadBlock");
  if (!webApkBlock) return;

  const serverVer = window.SERVER_APK_VERSION || webApkBlock.dataset.serverApkVersion || (window.__SERVER_APK && window.__SERVER_APK.version) || null;
  const serverFilename = window.SERVER_APK_FILENAME || webApkBlock.dataset.serverApkFilename || (window.__SERVER_APK && window.__SERVER_APK.filename) || (serverVer ? `ProxDMR-${serverVer}.apk` : "ProxDMR.apk");
  const serverPath = window.SERVER_APK_PATH || webApkBlock.dataset.serverApkPath || (window.__SERVER_APK && window.__SERVER_APK.path) || `/download/${serverFilename}`;

  webApkBlock.style.display = "block";

  const titleEl = webApkBlock.querySelector(".settings-apk-title span") || webApkBlock.querySelector(".settings-apk-title");
  const descEl = webApkBlock.querySelector("p");
  const dlLink = document.getElementById("btnDownloadApkSettings") || webApkBlock.querySelector("a[href*='/download']");
  if (!dlLink) return;
  const dlSpan = dlLink.querySelector("span") || dlLink;

  const curLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) || 
                  (typeof localStorage !== "undefined" && localStorage.getItem("proxdmr_language")) || 
                  "ru";
  const isCyr = (curLang === "ru" || curLang === "uk");

  const isApk = !!(window.AndroidBridge && typeof window.AndroidBridge.getAppVersion === "function");

  if (isApk) {
    // Running inside Android APK
    let installedVer = null;
    try {
      installedVer = window.AndroidBridge.getAppVersion();
    } catch (e) {
      console.warn("[APK Update] Error getting installed version:", e);
    }

    // Check if server version is strictly newer than installed version
    const hasUpdate = (serverVer && installedVer) ? (compareVersions(serverVer, installedVer) > 0) : false;

    if (hasUpdate) {
      // Requirement 1: Active only when server version is newer than running version
      // Requirement 2: Must display the new version number
      const defaultTitle = isCyr ? `📱 Доступно обновление ProxDMR v${serverVer}` : `📱 ProxDMR update available v${serverVer}`;
      const defaultDesc = isCyr 
        ? `Доступна новая версия v${serverVer} (у вас установлена v${installedVer}). Нажмите кнопку ниже для загрузки и обновления поверх текущей версии. Ваши настройки сохранятся.`
        : `A new version v${serverVer} is available (you have v${installedVer} installed). Click the button below to download and update over the current version. Your settings will be preserved.`;
      const defaultBtn = isCyr ? `📥 Скачать обновление v${serverVer}` : `📥 Download update v${serverVer}`;

      if (titleEl) {
        titleEl.textContent = window.t ? window.t("updater.update_available_title", { ver: serverVer }, defaultTitle) : defaultTitle;
      }
      if (descEl) {
        descEl.textContent = window.t ? window.t("updater.update_available_desc", { server_ver: serverVer, installed_ver: installedVer }, defaultDesc) : defaultDesc;
      }
      dlSpan.textContent = window.t ? window.t("updater.update_dl_btn", { ver: serverVer }, defaultBtn) : defaultBtn;

      dlLink.href = serverPath;
      dlLink.setAttribute("download", serverFilename);
      dlLink.removeAttribute("disabled");
      dlLink.classList.remove("btn-apk-update-disabled", "btn-secondary");
      dlLink.classList.add("btn-primary", "btn-apk-update-active");
      dlLink.style.pointerEvents = "auto";
      dlLink.style.opacity = "1";
      dlLink.style.cursor = "pointer";

      // Highlight Settings button in header to alert the user about update
      const settingsBtn = document.getElementById("settingsBtn") || document.getElementById("btnSettings") || document.getElementById("btnOpenSettings");
      if (settingsBtn) {
        settingsBtn.classList.add("has-update-badge");
        settingsBtn.title = window.t ? window.t("updater.update_available_btn_title", { ver: serverVer }, defaultTitle) : defaultTitle;
      }
    } else {
      // App is up-to-date (installed >= server):
      // Requirement 1: Button is INACTIVE / DISABLED!
      const displayVer = installedVer || serverVer || "";
      const defaultTitle = isCyr ? `📱 ProxDMR актуален (v${displayVer})` : `📱 ProxDMR is up to date (v${displayVer})`;
      const defaultDesc = isCyr 
        ? `У вас установлена последняя версия v${displayVer}. Обновлений не требуется.`
        : `You have the latest version v${displayVer}. No updates required.`;
      const defaultBtn = isCyr ? `✓ Установлена актуальная версия v${displayVer}` : `✓ Current version v${displayVer} installed`;

      if (titleEl) {
        titleEl.textContent = window.t ? window.t("updater.up_to_date_title", { ver: displayVer }, defaultTitle) : defaultTitle;
      }
      if (descEl) {
        descEl.textContent = window.t ? window.t("updater.up_to_date_desc", { ver: displayVer }, defaultDesc) : defaultDesc;
      }
      dlSpan.textContent = window.t ? window.t("updater.up_to_date_btn", { ver: displayVer }, defaultBtn) : defaultBtn;

      dlLink.removeAttribute("href");
      dlLink.setAttribute("disabled", "true");
      dlLink.classList.remove("btn-primary", "btn-apk-update-active");
      dlLink.classList.add("btn-secondary", "btn-apk-update-disabled");
      dlLink.style.pointerEvents = "none";
      dlLink.style.opacity = "0.55";
      dlLink.style.cursor = "not-allowed";

      const settingsBtn = document.getElementById("settingsBtn") || document.getElementById("btnSettings") || document.getElementById("btnOpenSettings");
      if (settingsBtn) {
        settingsBtn.classList.remove("has-update-badge");
      }
    }

    // Requirement 3: Passes server path and filename to Android download trigger
    if (!dlLink.dataset.updateBound) {
      dlLink.dataset.updateBound = "true";
      dlLink.addEventListener("click", (e) => {
        e.preventDefault();
        if (dlLink.getAttribute("disabled") === "true") {
          return;
        }
        const currentServerPath = window.SERVER_APK_PATH || (window.__SERVER_APK && window.__SERVER_APK.path) || `/download/${serverFilename}`;
        const currentServerFilename = window.SERVER_APK_FILENAME || (window.__SERVER_APK && window.__SERVER_APK.filename) || serverFilename;
        triggerApkDownload(currentServerPath, currentServerFilename);
      });
    }
  } else {
    // In standard web browser: simply a download button for the latest APK
    const defaultTitle = isCyr ? "📱 Приложение ProxDMR для Android" : "📱 ProxDMR App for Android";
    const defaultDesc = isCyr 
      ? "Для стабильного приема радиосигнала в фоновом режиме, автоподключения VPN и поддержки гарнитуры установите APK."
      : "For stable background radio reception, automatic VPN connection, and headset support, please install the APK.";
    const defaultBtn = isCyr 
      ? (`📥 Скачать ${serverFilename}` + (serverVer ? ` (v${serverVer})` : ""))
      : (`📥 Download ${serverFilename}` + (serverVer ? ` (v${serverVer})` : ""));

    if (titleEl) {
      titleEl.textContent = window.t ? window.t("updater.android_app_title", {}, defaultTitle) : defaultTitle;
    }
    if (descEl) {
      descEl.textContent = window.t ? window.t("apk.settings_desc", {}, defaultDesc) : defaultDesc;
    }
    dlSpan.textContent = window.t ? window.t("updater.android_dl_btn", { filename: serverFilename + (serverVer ? ` (v${serverVer})` : "") }, defaultBtn) : defaultBtn;
    dlLink.href = serverPath;
    dlLink.setAttribute("download", serverFilename);
    dlLink.removeAttribute("disabled");
    dlLink.classList.remove("btn-apk-update-disabled", "btn-secondary");
    dlLink.classList.add("btn-primary");
    dlLink.style.pointerEvents = "auto";
    dlLink.style.opacity = "1";
    dlLink.style.cursor = "pointer";
  }

  // Also update banner download link if present
  const bannerLink = document.getElementById("btnDownloadApkBanner");
  if (bannerLink) {
    bannerLink.href = serverPath;
    bannerLink.setAttribute("download", serverFilename);
  }
}
window.updateApkUpdateUI = updateApkUpdateUI;

async function checkServerApkUpdate() {
  try {
    const res = await fetch(`/api/apk/info?_t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const info = await res.json();
      if (info && (info.apk_version || info.version)) {
        updateApkUpdateUI(info);
        return info;
      }
    }
  } catch (e) {
    console.warn("[APK Update] Failed to check server APK update:", e);
  }
  return null;
}
window.checkServerApkUpdate = checkServerApkUpdate;

// Initial call on page load with embedded or global server info
function initApkUpdater() {
  updateApkUpdateUI();
  checkServerApkUpdate();
}



export {
  compareVersions,
  triggerApkDownload,
  updateApkUpdateUI,
  checkServerApkUpdate,
  initApkUpdater
};

if (typeof window !== "undefined") {
  window.compareVersions = compareVersions;
  window.triggerApkDownload = triggerApkDownload;
  window.updateApkUpdateUI = updateApkUpdateUI;
  window.checkServerApkUpdate = checkServerApkUpdate;
  window.initApkUpdater = initApkUpdater;

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.compareVersions = compareVersions;
  window.__proxdmr.updateApkUpdateUI = updateApkUpdateUI;

  window.addEventListener("languageChanged", () => {
    updateApkUpdateUI();
  });
  if (window.I18N && typeof window.I18N.onLanguageChange === "function") {
    window.I18N.onLanguageChange(() => {
      updateApkUpdateUI();
    });
  }
}
