/**
 * ProxDMR - HamQTH.com Settings & Connection Test Subsystem
 */

import { showToast } from "../core/toast.js";

export function initHamQthSettings() {
  const optUsername = document.getElementById("optHamQthUsername");
  const optPassword = document.getElementById("optHamQthPassword");
  const btnTogglePw = document.getElementById("btnToggleHamQthPassword");
  const btnTest = document.getElementById("btnTestHamQth");
  const testStatus = document.getElementById("hamQthTestStatus");
  const btnOpenFromModal = document.getElementById("btnOpenHamQthSettings");
  const frame = document.getElementById("hamQthSettingsFrame");
  const toggle = document.getElementById("hamQthSettingsToggle");

  // Collapsible frame toggle
  if (frame && toggle && !toggle._wired) {
    toggle._wired = true;
    toggle.addEventListener("click", () => {
      frame.classList.toggle("collapsed");
    });
  }

  // Toggle password visibility
  if (btnTogglePw && optPassword) {
    btnTogglePw.addEventListener("click", () => {
      if (optPassword.type === "password") {
        optPassword.type = "text";
        btnTogglePw.textContent = "🙈";
      } else {
        optPassword.type = "password";
        btnTogglePw.textContent = "👁️";
      }
    });
  }

  // Save helper function
  async function saveHamQthSettings(showNotify = false) {
    const username = optUsername ? optUsername.value.trim() : "";
    const password = optPassword ? optPassword.value.trim() : "";

    try {
      const resp = await fetch("/api/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hamqth_username: username,
          hamqth_password: password
        })
      });
      const data = await resp.json();
      if (showNotify && data.status === "ok") {
        showToast(window.t ? window.t("hamqth.settings_saved", {}, "✓ Настройки HamQTH сохранены") : "✓ Настройки HamQTH сохранены", 2500);
      }
      return data;
    } catch (err) {
      console.warn("[HamQTH] Failed to save settings:", err);
      if (showNotify) {
        showToast(window.t ? window.t("hamqth.settings_save_err", {}, "⚠️ Ошибка сохранения настроек HamQTH") : "⚠️ Ошибка сохранения настроек HamQTH", 3000);
      }
      return null;
    }
  }

  // Auto-save on change / blur
  if (optUsername) {
    optUsername.addEventListener("change", () => saveHamQthSettings(false));
    optUsername.addEventListener("blur", () => saveHamQthSettings(false));
  }
  if (optPassword) {
    optPassword.addEventListener("change", () => saveHamQthSettings(false));
    optPassword.addEventListener("blur", () => saveHamQthSettings(false));
  }

  // Test connection button
  if (btnTest) {
    btnTest.addEventListener("click", async () => {
      const username = optUsername ? optUsername.value.trim() : "";
      const password = optPassword ? optPassword.value.trim() : "";

      if (!username || !password) {
        if (testStatus) {
          testStatus.style.display = "block";
          testStatus.style.color = "#f85149";
          testStatus.textContent = window.t ? window.t("hamqth.err_specify_creds", {}, "⚠️ Укажите логин и пароль") : "⚠️ Укажите логин и пароль";
        }
        showToast(window.t ? window.t("hamqth.err_fill_creds", {}, "⚠️ Заполните логин и пароль HamQTH") : "⚠️ Заполните логин и пароль HamQTH", 3000);
        return;
      }

      // Save first
      await saveHamQthSettings(false);

      btnTest.disabled = true;
      const originalText = btnTest.innerHTML;
      btnTest.innerHTML = `<span>${window.t ? window.t("hamqth.checking", {}, "⏳ Проверка...") : "⏳ Проверка..."}</span>`;

      if (testStatus) {
        testStatus.style.display = "block";
        testStatus.style.color = "#58a6ff";
        testStatus.textContent = window.t ? window.t("hamqth.checking_auth", {}, "Проверка авторизации на HamQTH.com...") : "Проверка авторизации на HamQTH.com...";
      }

      try {
        const resp = await fetch("/api/hamqth/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: username,
            password: password
          })
        });
        const resJson = await resp.json();

        if (resJson.status === "ok") {
          if (testStatus) {
            testStatus.style.color = "#3fb950";
            testStatus.textContent = "✓ " + (resJson.message || (window.t ? window.t("hamqth.conn_success", {}, "Успешно подключено") : "Успешно подключено"));
          }
          showToast(window.t ? window.t("hamqth.auth_success", {}, "✓ Успешная авторизация на HamQTH.com") : "✓ Успешная авторизация на HamQTH.com", 3000);
        } else {
          if (testStatus) {
            testStatus.style.color = "#f85149";
            testStatus.textContent = "✕ " + (resJson.message || (window.t ? window.t("hamqth.auth_err", {}, "Ошибка авторизации") : "Ошибка авторизации"));
          }
          showToast(`✕ HamQTH: ${resJson.message || (window.t ? window.t("common.error", {}, "Ошибка") : "Ошибка")}`, 4000);
        }
      } catch (err) {
        if (testStatus) {
          testStatus.style.color = "#f85149";
          testStatus.textContent = window.t ? window.t("hamqth.net_err", { err: err.message }, `✕ Сетевая ошибка: ${err.message}`) : `✕ Сетевая ошибка: ${err.message}`;
        }
        showToast(window.t ? window.t("hamqth.server_unreachable", {}, "✕ Не удалось связаться с сервером") : "✕ Не удалось связаться с сервером", 3500);
      } finally {
        btnTest.disabled = false;
        btnTest.innerHTML = originalText;
      }
    });
  }

  // Handle open settings button from HamQTH empty state in bmInfoModal
  if (btnOpenFromModal) {
    btnOpenFromModal.addEventListener("click", () => {
      // Close bmInfoModal
      if (typeof window.closeBmInfoModal === "function") {
        window.closeBmInfoModal();
      }
      // Open settings modal and activate tab-general
      if (typeof window.openHotspotSettings === "function") {
        window.openHotspotSettings(null, "tab-general");
      }
      setTimeout(() => {
        if (frame && frame.classList.contains("collapsed")) {
          frame.classList.remove("collapsed");
        }
        if (optUsername) optUsername.focus();
      }, 250);
    });
  }
}
