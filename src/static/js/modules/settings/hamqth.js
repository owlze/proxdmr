/**
 * ProxDMR - HAM Web Portals Settings & Connection Test Subsystem
 * Supports QRZ.com and HamQTH.com
 */

import { showToast } from "../core/toast.js";

export function initHamQthSettings() {
  const frame = document.getElementById("hamQthSettingsFrame");
  const toggle = document.getElementById("hamQthSettingsToggle");
  const btnOpenFromModal = document.getElementById("btnOpenHamQthSettings");

  // 1. QRZ.com elements
  const optQrzComUser = document.getElementById("optQrzComUsername");
  const optQrzComPass = document.getElementById("optQrzComPassword");
  const btnToggleQrzCom = document.getElementById("btnToggleQrzComPassword");
  const btnTestQrzCom = document.getElementById("btnTestQrzCom");
  const statusQrzCom = document.getElementById("qrzComTestStatus");

  // 2. HamQTH.com elements
  const optHamQthUser = document.getElementById("optHamQthUsername");
  const optHamQthPass = document.getElementById("optHamQthPassword");
  const btnToggleHamQth = document.getElementById("btnToggleHamQthPassword");
  const btnTestHamQth = document.getElementById("btnTestHamQth");
  const statusHamQth = document.getElementById("hamQthTestStatus");
  // Collapsible frame toggle
  if (frame && toggle && !toggle._wired) {
    toggle._wired = true;
    toggle.addEventListener("click", () => {
      frame.classList.toggle("collapsed");
    });
  }

  // Password visibility helper
  function wirePasswordToggle(inputEl, btnEl) {
    if (!inputEl || !btnEl || btnEl._wired) return;
    btnEl._wired = true;
    btnEl.addEventListener("click", () => {
      if (inputEl.type === "password") {
        inputEl.type = "text";
        btnEl.textContent = "🙈";
      } else {
        inputEl.type = "password";
        btnEl.textContent = "👁️";
      }
    });
  }

  wirePasswordToggle(optQrzComPass, btnToggleQrzCom);
  wirePasswordToggle(optHamQthPass, btnToggleHamQth);

  // Save helper function
  async function saveHamQthSettings(showNotify = false) {
    if (window.isDemoMode) {
      return { status: "demo_blocked" };
    }

    const payload = {
      qrz_com_username: optQrzComUser ? optQrzComUser.value.trim() : "",
      qrz_com_password: optQrzComPass ? optQrzComPass.value.trim() : "",
      hamqth_username: optHamQthUser ? optHamQthUser.value.trim() : "",
      hamqth_password: optHamQthPass ? optHamQthPass.value.trim() : "",
    };

    try {
      const resp = await fetch("/api/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (showNotify && data && data.status === "ok") {
        showToast(window.t ? window.t("hamqth.settings_saved", {}, "✓ Настройки HAM порталов сохранены") : "✓ Настройки HAM порталов сохранены", 2500);
      }
      return data;
    } catch (err) {
      console.warn("[HAM Portals] Failed to save settings:", err);
      if (showNotify) {
        showToast(window.t ? window.t("hamqth.settings_save_err", {}, "⚠️ Ошибка сохранения настроек HAM порталов") : "⚠️ Ошибка сохранения настроек HAM порталов", 3000);
      }
      return null;
    }
  }

  // Auto-save on change / blur for all 6 inputs
  [optQrzComUser, optQrzComPass, optHamQthUser, optHamQthPass].forEach(input => {
    if (!input || input._wiredAutoSave) return;
    input._wiredAutoSave = true;
    input.addEventListener("change", () => saveHamQthSettings(false));
    input.addEventListener("blur", () => saveHamQthSettings(false));
  });

  // Universal test connection helper
  function wirePortalTest(btnEl, statusEl, userEl, passEl, portalName, portalLabel) {
    if (!btnEl || btnEl._wiredTest) return;
    btnEl._wiredTest = true;

    btnEl.addEventListener("click", async () => {
      const username = userEl ? userEl.value.trim() : "";
      const password = passEl ? passEl.value.trim() : "";

      if (!username || !password) {
        if (statusEl) {
          statusEl.style.display = "block";
          statusEl.style.color = "#f85149";
          statusEl.textContent = window.t ? window.t("hamqth.err_specify_creds", {}, "⚠️ Укажите логин и пароль") : "⚠️ Укажите логин и пароль";
        }
        showToast(`⚠️ Заполните логин и пароль ${portalLabel}`, 3000);
        return;
      }

      // Save first
      await saveHamQthSettings(false);

      btnEl.disabled = true;
      const originalText = btnEl.innerHTML;
      btnEl.innerHTML = `<span>${window.t ? window.t("hamqth.checking", {}, "⏳ Проверка...") : "⏳ Проверка..."}</span>`;

      if (statusEl) {
        statusEl.style.display = "block";
        statusEl.style.color = "#58a6ff";
        statusEl.textContent = `Проверка авторизации на ${portalLabel}...`;
      }

      try {
        const resp = await fetch("/api/hamqth/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portal: portalName,
            username: username,
            password: password
          })
        });
        const resJson = await resp.json();

        if (resJson && resJson.status === "ok") {
          if (statusEl) {
            statusEl.style.color = "#3fb950";
            statusEl.textContent = "✓ " + (resJson.message || "Успешно подключено");
          }
          showToast(`✓ Успешная авторизация на ${portalLabel}`, 3000);
        } else {
          if (statusEl) {
            statusEl.style.color = "#f85149";
            statusEl.textContent = "✕ " + (resJson.message || "Ошибка авторизации");
          }
          showToast(`✕ ${portalLabel}: ${resJson.message || "Ошибка"}`, 4000);
        }
      } catch (err) {
        if (statusEl) {
          statusEl.style.color = "#f85149";
          statusEl.textContent = `✕ Сетевая ошибка: ${err.message}`;
        }
        showToast(window.t ? window.t("hamqth.server_unreachable", {}, "✕ Не удалось связаться с сервером") : "✕ Не удалось связаться с сервером", 3500);
      } finally {
        btnEl.disabled = false;
        btnEl.innerHTML = originalText;
      }
    });
  }

  wirePortalTest(btnTestQrzCom, statusQrzCom, optQrzComUser, optQrzComPass, "qrz_com", "QRZ.com");
  wirePortalTest(btnTestHamQth, statusHamQth, optHamQthUser, optHamQthPass, "hamqth", "HamQTH.com");

  // Handle open settings button from HAM portals empty state in bmInfoModal
  if (btnOpenFromModal && !btnOpenFromModal._wired) {
    btnOpenFromModal._wired = true;
    btnOpenFromModal.addEventListener("click", () => {
      if (typeof window.closeBmInfoModal === "function") {
        window.closeBmInfoModal();
      }
      if (typeof window.openHotspotSettings === "function") {
        window.openHotspotSettings(null, "tab-general");
      }
      setTimeout(() => {
        if (frame && frame.classList.contains("collapsed")) {
          frame.classList.remove("collapsed");
        }
        if (optQrzComUser) optQrzComUser.focus();
      }, 250);
    });
  }
}
