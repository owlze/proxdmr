/**
 * alerts.js — клиентский модуль управления Telegram-оповещениями и мониторингом Watchdog.
 */

function t(key, fallback) {
  if (typeof window !== "undefined" && typeof window.t === "function") {
    return window.t(key, {}, fallback);
  }
  return fallback;
}

function formatUptime(sec) {
  if (!sec || sec < 0) return "-";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}д`);
  if (h > 0 || d > 0) parts.push(`${h}ч`);
  parts.push(`${m}м`);
  return parts.join(" ");
}

function formatTimestamp(ts) {
  if (!ts) return "-";
  try {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (_) {
    return "-";
  }
}

export function initAlertsSettings() {
  const tabBtn = document.getElementById("tabBtnAlerts");
  const tabContent = document.getElementById("tab-alerts");
  if (!tabContent) return;

  const isAdmin = Boolean(
    window.isDemoMode ||
    (window.ProxDMRAdmin && typeof window.ProxDMRAdmin.isAdmin === "function"
      ? window.ProxDMRAdmin.isAdmin()
      : true)
  );

  if (tabBtn) {
    tabBtn.style.display = isAdmin ? "" : "none";
  }

  if (window.isDemoMode && typeof window.applyDemoReadOnlyLock === "function") {
    setTimeout(window.applyDemoReadOnlyLock, 50);
  }

  // Elements
  const badge = document.getElementById("alertsWdBadge");
  const elVersion = document.getElementById("alertsWdVersion");
  const elUptime = document.getElementById("alertsWdUptime");
  const elLastCheck = document.getElementById("alertsWdLastCheck");
  const elSentCount = document.getElementById("alertsWdSentCount");
  const elModeNote = document.getElementById("alertsWdModeNote");

  const chkEnabled = document.getElementById("alertsEnabled");
  const inputToken = document.getElementById("alertsBotToken");
  const btnToggleToken = document.getElementById("btnToggleAlertsToken");
  const btnEditToken = document.getElementById("btnEditAlertsToken");
  const inputChatId = document.getElementById("alertsChatId");
  const inputThreadId = document.getElementById("alertsThreadId");
  const selLang = document.getElementById("alertsLanguage");
  const inputServerIcon = document.getElementById("alertsServerIcon");
  const inputServerLabel = document.getElementById("alertsServerLabel");
  const iconPresetBtns = document.querySelectorAll(".alerts-icon-preset");

  function syncIconPresetHighlight() {
    if (!inputServerIcon) return;
    const cur = inputServerIcon.value.trim();
    iconPresetBtns.forEach((btn) => {
      const isMatch = btn.dataset.icon === cur;
      btn.style.borderColor = isMatch ? "#58a6ff" : "";
      btn.style.background = isMatch ? "rgba(56, 139, 253, 0.2)" : "";
    });
  }

  iconPresetBtns.forEach((btn) => {
    if (!btn._wired) {
      btn._wired = true;
      btn.addEventListener("click", () => {
        if (inputServerIcon) {
          inputServerIcon.value = btn.dataset.icon || "";
          syncIconPresetHighlight();
        }
      });
    }
  });
  if (inputServerIcon && !inputServerIcon._wired) {
    inputServerIcon._wired = true;
    inputServerIcon.addEventListener("input", syncIconPresetHighlight);
  }

  const chkOffline = document.getElementById("notifyOffline");
  const chkRestart = document.getElementById("notifyRestart");
  const chkOom = document.getElementById("notifyOom");
  const chkHang = document.getElementById("notifyHang");
  const chkCmem = document.getElementById("notifyCmemHigh");
  const chkLeak = document.getElementById("notifyLeak");
  const chkHostRam = document.getElementById("notifyHostRam");
  const chkHostSwap = document.getElementById("notifyHostSwap");
  const chkHostDisk = document.getElementById("notifyHostDisk");

  const inThreshCmem = document.getElementById("threshCmem");
  const inThreshLeak = document.getElementById("threshLeak");
  const inThreshHostRam = document.getElementById("threshHostRam");
  const inThreshHostSwap = document.getElementById("threshHostSwap");
  const inThreshHostDisk = document.getElementById("threshHostDisk");
  const inThreshHang = document.getElementById("threshHang");

  const chkSilence = document.getElementById("silenceEnabled");
  const inSilenceStart = document.getElementById("silenceStart");
  const inSilenceEnd = document.getElementById("silenceEnd");
  const chkSilenceCritical = document.getElementById("silenceAllowCritical");

  const inRateLimit = document.getElementById("alertsRateLimit");
  const chkForceDirect = document.getElementById("alertsForceDirect");

  const btnSave = document.getElementById("btnSaveAlerts");
  const btnTest = document.getElementById("btnTestAlert");
  const feedback = document.getElementById("alertsFeedback");

  let isEditingToken = false;

  function setFeedback(msg, isError = false) {
    if (!feedback) return;
    feedback.textContent = msg;
    feedback.style.color = isError ? "#f85149" : "#3fb950";
    if (msg) {
      setTimeout(() => {
        if (feedback.textContent === msg) feedback.textContent = "";
      }, 5000);
    }
  }

  async function loadAlerts() {
    try {
      const res = await fetch("/api/admin/alerts");
      if (!res.ok) {
        if (res.status === 403 || res.status === 401) {
          if (tabBtn) tabBtn.style.display = "none";
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (tabBtn) tabBtn.style.display = "";
      const cfg = data.config || {};
      const wd = data.watchdog || {};

      // Update Watchdog card
      const isWdOnline = wd.status === "online";
      if (badge) {
        badge.textContent = isWdOnline
          ? t("alerts.status_online", "🟢 Онлайн")
          : t("alerts.status_offline", "🔴 Офлайн");
        badge.style.background = isWdOnline ? "rgba(63, 185, 80, 0.2)" : "rgba(248, 81, 73, 0.2)";
        badge.style.color = isWdOnline ? "#3fb950" : "#f85149";
      }
      if (elVersion) elVersion.textContent = wd.version || "-";
      if (elUptime) elUptime.textContent = isWdOnline ? formatUptime(wd.uptime_sec) : "-";
      if (elLastCheck) elLastCheck.textContent = isWdOnline ? formatTimestamp(wd.last_check_proxdmr) : "-";
      if (elSentCount) elSentCount.textContent = wd.alerts_sent_total ?? 0;
      if (elModeNote) {
        elModeNote.textContent = isWdOnline
          ? t("alerts.mode_watchdog", "Режим: через независимый Watchdog (рекомендуется)")
          : t("alerts.mode_direct", "Режим: прямое аварийное вещание из ProxDMR");
        elModeNote.style.color = isWdOnline ? "#58a6ff" : "#d29922";
      }

      // Populate config
      if (chkEnabled) chkEnabled.checked = Boolean(cfg.enabled);
      if (inputToken) {
        inputToken.value = cfg.bot_token || "";
        inputToken.readOnly = true;
        isEditingToken = false;
        if (btnEditToken) btnEditToken.textContent = t("alerts.change_token", "Изменить");
      }
      if (inputChatId) inputChatId.value = cfg.chat_id || "";
      if (inputThreadId) inputThreadId.value = cfg.thread_id ?? "";
      if (selLang) selLang.value = cfg.language || "ru";
      if (inputServerIcon) {
        inputServerIcon.value = cfg.server_icon !== undefined ? cfg.server_icon : (window.isDemoMode ? "🟧" : "🟦");
        syncIconPresetHighlight();
      }
      if (inputServerLabel) {
        inputServerLabel.value = cfg.server_label || "";
      }

      const notif = cfg.notify_on || {};
      if (chkOffline) chkOffline.checked = Boolean(notif.offline !== false);
      if (chkRestart) chkRestart.checked = Boolean(notif.restart !== false);
      if (chkOom) chkOom.checked = Boolean(notif.oom !== false);
      if (chkHang) chkHang.checked = Boolean(notif.hang !== false);
      if (chkCmem) chkCmem.checked = Boolean(notif.cmem_high !== false);
      if (chkLeak) chkLeak.checked = Boolean(notif.leak_suspected !== false);
      if (chkHostRam) chkHostRam.checked = Boolean(notif.host_ram_high);
      if (chkHostSwap) chkHostSwap.checked = Boolean(notif.host_swap_high);
      if (chkHostDisk) chkHostDisk.checked = Boolean(notif.host_disk_high);

      const thresh = cfg.thresholds || {};
      if (inThreshCmem) inThreshCmem.value = thresh.cmem_percent ?? 85;
      if (inThreshLeak) inThreshLeak.value = thresh.leak_mb_per_hour ?? 150;
      if (inThreshHostRam) inThreshHostRam.value = thresh.host_ram_percent ?? 90;
      if (inThreshHostSwap) inThreshHostSwap.value = thresh.host_swap_percent ?? 50;
      if (inThreshHostDisk) inThreshHostDisk.value = thresh.host_disk_percent ?? 90;
      if (inThreshHang) inThreshHang.value = thresh.hang_timeout_sec ?? 60;

      const sil = cfg.silence_hours || {};
      if (chkSilence) chkSilence.checked = Boolean(sil.enabled);
      if (inSilenceStart) inSilenceStart.value = sil.start || "23:00";
      if (inSilenceEnd) inSilenceEnd.value = sil.end || "07:00";
      if (chkSilenceCritical) chkSilenceCritical.checked = Boolean(sil.allow_critical !== false);

      if (inRateLimit) inRateLimit.value = cfg.rate_limit_per_hour ?? 10;
    } catch (e) {
      console.warn("[ALERTS] Failed to load config:", e);
    }
  }

  if (tabBtn && !tabBtn._wiredAlerts) {
    tabBtn._wiredAlerts = true;
    tabBtn.addEventListener("click", () => {
      loadAlerts();
    });
  }

  // Edit / Cancel Token button
  if (btnEditToken && !btnEditToken._wired) {
    btnEditToken._wired = true;
    btnEditToken.addEventListener("click", () => {
      if (!isEditingToken) {
        isEditingToken = true;
        inputToken.readOnly = false;
        inputToken.value = "";
        inputToken.focus();
        btnEditToken.textContent = t("alerts.keep_token", "Отмена");
      } else {
        isEditingToken = false;
        inputToken.readOnly = true;
        btnEditToken.textContent = t("alerts.change_token", "Изменить");
        loadAlerts();
      }
    });
  }

  // Toggle token password mask
  if (btnToggleToken && !btnToggleToken._wired) {
    btnToggleToken._wired = true;
    btnToggleToken.addEventListener("click", () => {
      if (inputToken.type === "password") {
        inputToken.type = "text";
        btnToggleToken.textContent = "🙈";
      } else {
        inputToken.type = "password";
        btnToggleToken.textContent = "👁️";
      }
    });
  }

  // Save button
  if (btnSave && !btnSave._wired) {
    btnSave._wired = true;
    btnSave.addEventListener("click", async () => {
      btnSave.disabled = true;
      setFeedback("");
      try {
        const payload = {
          enabled: chkEnabled.checked,
          bot_token: inputToken.value,
          chat_id: inputChatId.value.trim(),
          thread_id: inputThreadId.value.trim() ? parseInt(inputThreadId.value.trim(), 10) : null,
          language: selLang.value,
          server_icon: inputServerIcon ? inputServerIcon.value.trim() : "🟦",
          server_label: inputServerLabel ? inputServerLabel.value.trim() : "",
          notify_on: {
            offline: chkOffline.checked,
            restart: chkRestart.checked,
            oom: chkOom.checked,
            hang: chkHang.checked,
            cmem_high: chkCmem.checked,
            leak_suspected: chkLeak.checked,
            host_ram_high: chkHostRam.checked,
            host_swap_high: chkHostSwap.checked,
            host_disk_high: chkHostDisk.checked,
          },
          thresholds: {
            cmem_percent: parseInt(inThreshCmem.value, 10) || 85,
            leak_mb_per_hour: parseInt(inThreshLeak.value, 10) || 150,
            host_ram_percent: parseInt(inThreshHostRam.value, 10) || 90,
            host_swap_percent: parseInt(inThreshHostSwap.value, 10) || 50,
            host_disk_percent: parseInt(inThreshHostDisk.value, 10) || 90,
            hang_timeout_sec: parseInt(inThreshHang.value, 10) || 60,
          },
          silence_hours: {
            enabled: chkSilence.checked,
            start: inSilenceStart.value || "23:00",
            end: inSilenceEnd.value || "07:00",
            tz: "UTC",
            allow_critical: chkSilenceCritical.checked,
          },
          rate_limit_per_hour: parseInt(inRateLimit.value, 10) || 10,
        };

        const res = await fetch("/api/admin/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${res.status}`);
        }

        setFeedback(t("alerts.save_success", "Настройки оповещений сохранены"), false);
        await loadAlerts();
      } catch (e) {
        setFeedback(`${t("alerts.save_error", "Ошибка сохранения")}: ${e.message}`, true);
      } finally {
        btnSave.disabled = false;
      }
    });
  }

  // Test Alert button
  if (btnTest && !btnTest._wired) {
    btnTest._wired = true;
    btnTest.addEventListener("click", async () => {
      btnTest.disabled = true;
      setFeedback(t("alerts.test_sending", "Отправка тестового оповещения..."), false);
      try {
        const forceDirect = Boolean(chkForceDirect && chkForceDirect.checked);
        const res = await fetch("/api/admin/alerts/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force_direct: forceDirect }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data.mode === "direct") {
          if (data.ok) {
            setFeedback(t("alerts.test_success", "Тестовое сообщение успешно отправлено!"), false);
          } else {
            setFeedback(`${t("alerts.test_failed", "Ошибка отправки")}: ${data.error || "Unknown"}`, true);
          }
        } else if (data.mode === "watchdog") {
          const testId = data.test_id;
          let pollCount = 0;
          const pollInterval = setInterval(async () => {
            pollCount++;
            try {
              const pollRes = await fetch(`/api/admin/alerts/test/${testId}`);
              if (pollRes.ok) {
                const pollData = await pollRes.json();
                if (pollData.status === "done") {
                  clearInterval(pollInterval);
                  btnTest.disabled = false;
                  if (pollData.result?.ok) {
                    setFeedback(t("alerts.test_success", "Тестовое сообщение успешно отправлено!"), false);
                  } else {
                    setFeedback(`${t("alerts.test_failed", "Ошибка отправки")}: ${pollData.result?.error || "Error"}`, true);
                  }
                  loadAlerts();
                  return;
                }
              }
            } catch (_) {}

            if (pollCount >= 10) {
              clearInterval(pollInterval);
              btnTest.disabled = false;
              setFeedback(t("alerts.test_timeout", "Watchdog не подтвердил отправку вовремя (проверьте настройки)"), true);
            }
          }, 1000);
          return;
        }
      } catch (e) {
        setFeedback(`${t("alerts.test_failed", "Ошибка отправки")}: ${e.message}`, true);
      } finally {
        btnTest.disabled = false;
      }
    });
  }

  // Initial load if tab is visible or on demand
  loadAlerts();
}

if (typeof window !== "undefined") {
  window.initAlertsSettings = initAlertsSettings;
}
