import { showToast } from '../core/toast.js?v=2.9.699';

  function getUserPrefix() {
    const uid = window.currentUserId || (window.ProxDMRAuth && window.ProxDMRAuth.getUser() ? (window.ProxDMRAuth.getUser().id || window.ProxDMRAuth.getUser().user_id) : null);
    return uid ? `proxdmr_u${uid}_` : null;
  }

  function getLocalUserItem(key, fallback = null) {
    const uPrefix = getUserPrefix();
    if (uPrefix) {
      const val = localStorage.getItem(uPrefix + key);
      if (val !== null && val !== undefined) return val;
    }
    const gVal = localStorage.getItem("proxdmr_" + key);
    return (gVal !== null && gVal !== undefined) ? gVal : fallback;
  }

  function setLocalUserItem(key, val) {
    const uPrefix = getUserPrefix();
    if (uPrefix) {
      localStorage.setItem(uPrefix + key, val);
    }
    localStorage.setItem("proxdmr_" + key, val);
  }

  function removeLocalUserItem(key) {
    const uPrefix = getUserPrefix();
    if (uPrefix) {
      localStorage.removeItem(uPrefix + key);
    }
    localStorage.removeItem("proxdmr_" + key);
  }

  let currentTheme = getLocalUserItem("theme", "dark");
  let isThemeLongPressed = false;
  let themeSwitchSuppressionTimer = null;
  let syncThemeBgTabs = null;
  let syncToolbarBgTabs = null;
  let syncTsColorsTabs = null;
  let _commitBgFn = null;
  let _revertBgFn = null;
  let _commitToolbarBgFn = null;
  let _revertToolbarBgFn = null;
  let _commitTsColorsFn = null;
  let _revertTsColorsFn = null;

  function getTheme() {
    return currentTheme;
  }

  function applyThemeUI(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (theme === "light") {
      document.documentElement.classList.add("theme-light");
    } else {
      document.documentElement.classList.remove("theme-light");
    }

    const btns = document.querySelectorAll("#themeToggleBtn, .theme-toggle-btn");
    btns.forEach(btn => {
      const moon = btn.querySelector(".icon-moon");
      const sun = btn.querySelector(".icon-sun");
      if (moon && sun) {
        moon.style.display = (theme === "light") ? "none" : "block";
        sun.style.display = (theme === "light") ? "block" : "none";
      }
    });
    if (typeof window !== "undefined" && typeof window.syncToolbarLogoContrast === "function") {
      window.syncToolbarLogoContrast();
    }
  }

  function setTheme(theme, showNotification = false, syncServer = null) {
    if (theme !== "light" && theme !== "dark") {
      theme = "dark";
    }
    currentTheme = theme;
    setLocalUserItem("theme", theme);
    applyThemeUI(theme);

    // Apply the wallpaper, toolbar gradient and hotspot TS gradients saved for this theme
    applyBackgroundForActiveTheme();
    if (typeof window.applyToolbarBgForActiveTheme === "function") {
      window.applyToolbarBgForActiveTheme();
    }
    if (typeof window.applyHotspotTsColorsForActiveTheme === "function") {
      window.applyHotspotTsColorsForActiveTheme();
    }

    // Align Appearance subblock theme switchers
    if (typeof syncThemeBgTabs === "function") {
      syncThemeBgTabs(theme);
    }
    if (typeof syncToolbarBgTabs === "function") {
      syncToolbarBgTabs(theme);
    }
    if (typeof syncTsColorsTabs === "function") {
      syncTsColorsTabs(theme);
    }

    // Persist theme to server only when user explicitly changed it
    const shouldSync = syncServer !== null ? Boolean(syncServer) : Boolean(showNotification);
    if (shouldSync) {
      if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        try {
          window.ws.send(JSON.stringify({ type: "set_theme", theme: theme }));
        } catch (e) {}
      }
      try {
        fetch("/api/settings/general", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ theme: theme })
        }).catch(() => {});
      } catch (e) {}
      if (window.scheduleSyncClientSettings) window.scheduleSyncClientSettings();
    }

    if (showNotification) {
      const msg = (theme === "light")
        ? (typeof t === "function" && t("theme.switched_light") ? t("theme.switched_light") : "☀️ Дневная тема активирована")
        : (typeof t === "function" && t("theme.switched_dark") ? t("theme.switched_dark") : "🌙 Ночная тема активирована");
      if (typeof showToast === "function") {
        showToast(msg, "success");
      }
    }
  }

  function toggleTheme() {
    const nextTheme = (currentTheme === "light") ? "dark" : "light";
    setTheme(nextTheme, true);
  }

  function wireThemeToggleButton(btn) {
    if (!btn || btn._themeToggleWired) return;
    btn._themeToggleWired = true;

    btn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    btn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    btn.addEventListener("click", (e) => {
      if (e._themeToggleHandled) return;
      e._themeToggleHandled = true;
      e.preventDefault();
      e.stopPropagation();
      if (navigator.vibrate) {
        try { navigator.vibrate(35); } catch (err) {}
      }
      toggleTheme();
    });
  }

  function initTheme() {
    // Synchronize UI with saved theme immediately
    applyThemeUI(currentTheme);

    const themeBtns = document.querySelectorAll(".theme-toggle-btn, #themeToggleBtn");
    themeBtns.forEach(btn => wireThemeToggleButton(btn));

    if (!window._themeDelegationWired) {
      window._themeDelegationWired = true;
      document.addEventListener("pointerdown", (e) => {
        if (e.target && e.target.closest && e.target.closest("#themeToggleBtn, .theme-toggle-btn")) {
          e.stopPropagation();
        }
      });
      document.addEventListener("mousedown", (e) => {
        if (e.target && e.target.closest && e.target.closest("#themeToggleBtn, .theme-toggle-btn")) {
          e.stopPropagation();
        }
      });
      document.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("#themeToggleBtn, .theme-toggle-btn") : null;
        if (!btn || e._themeToggleHandled) return;
        e._themeToggleHandled = true;
        e.preventDefault();
        e.stopPropagation();
        if (navigator.vibrate) {
          try { navigator.vibrate(35); } catch (err) {}
        }
        toggleTheme();
      });
    }
  }

  // --- Background Wallpaper / Color Customization Subsystem ---
  let currentEditingBgTheme = currentTheme || "dark";
  let _hasUnsavedBg = false;
  const _draftBg = { dark: null, light: null };

  function _getEffectiveBgConfig(theme) {
    const target = (theme === "light") ? "light" : "dark";
    if (_hasUnsavedBg && _draftBg[target]) {
      return { ..._draftBg[target] };
    }
    return getBgConfigForTheme(target);
  }

  function _resetBgDraftFromStorage() {
    _hasUnsavedBg = false;
    _draftBg.dark = null;
    _draftBg.light = null;
  }

  function getBgConfigForTheme(theme) {
    const target = (theme === "light") ? "light" : "dark";
    let bgType, bgColor;
    if (target === "light") {
      bgType = getLocalUserItem("bg_type_light", "pattern");
      if (bgType !== "color") bgType = "pattern";
      bgColor = getLocalUserItem("bg_color_light", "#f4f6f8");
    } else {
      bgType = getLocalUserItem("bg_type_dark", "color");
      if (bgType !== "color") bgType = "pattern";
      bgColor = getLocalUserItem("bg_color_dark", "#04170c");
    }
    return { type: bgType, color: bgColor };
  }

  function setBgConfigForTheme(theme, bgType, bgColor) {
    const target = (theme === "light") ? "light" : "dark";
    const normType = (bgType === "color") ? "color" : "pattern";
    if (target === "light") {
      if (normType) setLocalUserItem("bg_type_light", normType);
      if (bgColor) setLocalUserItem("bg_color_light", bgColor);
    } else {
      if (normType) {
        setLocalUserItem("bg_type_dark", normType);
        setLocalUserItem("bg_type", normType);
      }
      if (bgColor) {
        setLocalUserItem("bg_color_dark", bgColor);
        setLocalUserItem("bg_color", bgColor);
      }
    }
    if (window.scheduleSyncClientSettings) window.scheduleSyncClientSettings();
  }

  function applyBackground(type, color) {
    const activeTheme = currentTheme || "dark";
    const fallback = getBgConfigForTheme(activeTheme);
    let bgType = type || fallback.type;
    if (bgType !== "color") bgType = "pattern";
    const bgColor = color || fallback.color;
    const htmlEl = document.documentElement;
    const bodyEl = document.body;

    if (bgType === "color") {
      htmlEl.style.backgroundColor = bgColor;
      htmlEl.style.backgroundImage = "none";

      if (bodyEl) {
        bodyEl.style.backgroundColor = bgColor;
        bodyEl.style.backgroundImage = "none";
      }
    } else {
      // Graphical wallpaper pattern: Custom user photo, or default theme pattern
      const customImg = getLocalUserItem("bg_custom_" + activeTheme);
      const appVer = (typeof window !== "undefined" && window.APP_VERSION) ? window.APP_VERSION : "0.32";
      const patternImg = customImg || ((activeTheme === "light")
        ? "/static/img/bg-pattern-day.jpg?v=" + appVer
        : "/static/img/bg-pattern-night.jpg?v=" + appVer);
      const defBg = (activeTheme === "light") ? "#f4f6f8" : "var(--bg-primary, #04170c)";
      const savedScale = getLocalUserItem("bg_scale_" + activeTheme) || getLocalUserItem("bg_scale") || "450";

      htmlEl.style.backgroundColor = defBg;
      htmlEl.style.backgroundImage = "url('" + patternImg + "')";
      htmlEl.style.backgroundAttachment = "fixed";
      htmlEl.style.backgroundRepeat = "repeat";
      htmlEl.style.backgroundPosition = "0 0";
      htmlEl.style.backgroundSize = savedScale + "px " + savedScale + "px";
      htmlEl.style.setProperty("--bg-pattern-size", savedScale + "px " + savedScale + "px");

      if (bodyEl) {
        bodyEl.style.backgroundColor = "transparent";
        bodyEl.style.backgroundImage = "none";
      }
    }
  }

  function applyBackgroundForActiveTheme() {
    const conf = _getEffectiveBgConfig(currentTheme);
    applyBackground(conf.type, conf.color);
  }

  function initBackgroundSettings() {
    applyBackgroundForActiveTheme();

    const frame = document.getElementById("wallpaperSettingsFrame");
    const toggle = document.getElementById("wallpaperSettingsToggle");
    if (frame && toggle && !toggle._wired) {
      toggle._wired = true;
      toggle.addEventListener("click", () => {
        frame.classList.toggle("collapsed");
      });
    }

    const radioInputs = document.querySelectorAll('input[name="optBgType"]');
    const colorPicker = document.getElementById("optBgColorPicker");
    const colorPreview = document.getElementById("bgColorPreview");
    const patternPreview = document.getElementById("bgPatternPreview");
    const tabDark = document.getElementById("themeBgTabDark");
    const tabLight = document.getElementById("themeBgTabLight");
    const fileInput = document.getElementById("optBgFileInput");
    const btnUpload = document.getElementById("btnUploadBgFile");
    const btnReset = document.getElementById("btnResetBgFile");

    [tabDark, tabLight].forEach(tab => {
      if (tab) {
        tab.addEventListener("click", (e) => {
          e.stopPropagation();
          if (frame && frame.classList.contains("collapsed")) {
            frame.classList.remove("collapsed");
          }
        });
      }
    });

    currentEditingBgTheme = currentTheme || "dark";

    const sliderScale = document.getElementById("sliderBgScale");
    const labelScale = document.getElementById("bgScaleValueLabel");
    const presetButtons = document.querySelectorAll(".btn-scale-preset");

    function updateScaleUI(scaleVal) {
      const val = parseInt(scaleVal, 10) || 450;
      if (sliderScale) sliderScale.value = val;
      if (labelScale) {
        const pct = Math.round((val / 900) * 100);
        labelScale.textContent = val + " px (" + pct + "%)";
      }
      if (presetButtons) {
        presetButtons.forEach(btn => {
          btn.classList.toggle("active", parseInt(btn.getAttribute("data-scale"), 10) === val);
        });
      }
    }

    function setScale(scaleVal) {
      const targetTheme = currentEditingBgTheme;
      const val = parseInt(scaleVal, 10) || 450;
      setLocalUserItem("bg_scale_" + targetTheme, val);
      setLocalUserItem("bg_scale", val);
      updateScaleUI(val);
      if (targetTheme === currentTheme) {
        document.documentElement.style.backgroundSize = val + "px " + val + "px";
        document.documentElement.style.setProperty("--bg-pattern-size", val + "px " + val + "px");
      }
      if (window.scheduleSyncClientSettings) window.scheduleSyncClientSettings();
    }

    if (sliderScale) {
      sliderScale.addEventListener("input", (e) => {
        setScale(parseInt(e.target.value, 10) || 450);
      });
    }

    if (presetButtons) {
      presetButtons.forEach(btn => {
        btn.addEventListener("click", () => {
          const val = parseInt(btn.getAttribute("data-scale"), 10) || 450;
          setScale(val);
        });
      });
    }

    function syncCardActiveClasses(activeType) {
      const normType = (activeType === "color") ? "color" : "pattern";
      document.querySelectorAll(".bg-option-card").forEach(card => {
        const inp = card.querySelector('input[name="optBgType"]');
        if (inp) {
          const isCurrent = inp.value === normType;
          card.classList.toggle("active", isCurrent);
          inp.checked = isCurrent;
        }
      });
    }

    function syncUIForEditingTheme(targetTheme) {
      currentEditingBgTheme = (targetTheme === "light") ? "light" : "dark";
      if (tabDark && tabLight) {
        tabDark.classList.toggle("active", currentEditingBgTheme === "dark");
        tabLight.classList.toggle("active", currentEditingBgTheme === "light");
      }
      const customImg = getLocalUserItem("bg_custom_" + currentEditingBgTheme);
      if (patternPreview) {
        const appVer = (typeof window !== "undefined" && window.APP_VERSION) ? window.APP_VERSION : "0.32";
        const previewImg = customImg || ((currentEditingBgTheme === "light")
          ? "/static/img/bg-pattern-day.jpg?v=" + appVer
          : "/static/img/bg-pattern-night.jpg?v=" + appVer);
        patternPreview.style.backgroundImage = "url('" + previewImg + "')";
        patternPreview.style.backgroundRepeat = "repeat";
        patternPreview.style.backgroundPosition = "center center";
        patternPreview.style.backgroundSize = "140px";
      }
      const currentScale = parseInt(getLocalUserItem("bg_scale_" + currentEditingBgTheme) || getLocalUserItem("bg_scale") || "450", 10);
      updateScaleUI(currentScale);
      if (btnReset) {
        btnReset.style.display = customImg ? "inline-flex" : "none";
      }
      const cardPattern = document.getElementById("bgCardPattern");
      if (cardPattern) {
        const titleEl = cardPattern.querySelector(".bg-option-title");
        if (titleEl) {
          titleEl.textContent = customImg
            ? (window.t ? window.t("general.bg_custom_title", {}, "Пользовательский фон") : "Пользовательский фон")
            : (window.t ? window.t("general.bg_pattern", {}, "Радио-паттерн") : "Радио-паттерн");
        }
      }
      const conf = _getEffectiveBgConfig(currentEditingBgTheme);
      syncCardActiveClasses(conf.type);
      if (colorPicker) {
        colorPicker.value = conf.color;
      }
      if (colorPreview) {
        colorPreview.style.backgroundColor = conf.color;
      }
    }

    syncThemeBgTabs = function(theme) {
      syncUIForEditingTheme(theme || currentTheme);
    };

    if (tabDark) {
      tabDark.addEventListener("click", () => syncUIForEditingTheme("dark"));
    }
    if (tabLight) {
      tabLight.addEventListener("click", () => syncUIForEditingTheme("light"));
    }

    // Custom wallpaper file picker handlers
    function triggerWallpaperPicker() {
      if (fileInput) {
        fileInput.value = "";
        fileInput.click();
      }
    }

    if (btnUpload) {
      btnUpload.addEventListener("click", triggerWallpaperPicker);
    }

    if (patternPreview) {
      patternPreview.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setBgConfigForTheme(currentEditingBgTheme, "pattern");
        syncCardActiveClasses("pattern");
        if (currentEditingBgTheme === currentTheme) {
          applyBackground("pattern");
          sendBackgroundToServer("pattern", getBgConfigForTheme(currentEditingBgTheme).color);
        }
        triggerWallpaperPicker();
      });
    }

    const cardPatternEl = document.getElementById("bgCardPattern");
    if (cardPatternEl) {
      cardPatternEl.addEventListener("click", (e) => {
        if (e.target && e.target.tagName === "INPUT") return;
        setBgConfigForTheme(currentEditingBgTheme, "pattern");
        syncCardActiveClasses("pattern");
        if (currentEditingBgTheme === currentTheme) {
          applyBackground("pattern");
          sendBackgroundToServer("pattern", getBgConfigForTheme(currentEditingBgTheme).color);
        }
        triggerWallpaperPicker();
      });
    }

    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
          if (typeof showToast === "function") {
            showToast(window.t ? window.t("general.bg_select_img", {}, "Выберите файл изображения (JPG, PNG, WebP)") : "Выберите файл изображения (JPG, PNG, WebP)", "warning");
          }
          return;
        }

        const reader = new FileReader();
        reader.onload = (re) => {
          const rawBase64 = re.target.result;
          const img = new Image();
          img.onload = () => {
            let w = img.width;
            let h = img.height;
            const maxDim = 2560;
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            const compressedBase64 = canvas.toDataURL("image/jpeg", 0.94);

            const targetTheme = currentEditingBgTheme;
            setLocalUserItem("bg_custom_" + targetTheme, compressedBase64);

            // Switch theme mode to pattern/image
            setBgConfigForTheme(targetTheme, "pattern");
            syncCardActiveClasses("pattern");

            if (targetTheme === currentTheme) {
              applyBackground("pattern");
              sendBackgroundToServer("pattern", getBgConfigForTheme(targetTheme).color);
            }
            syncUIForEditingTheme(targetTheme);

            if (typeof showToast === "function") {
              showToast(window.t ? window.t("general.bg_updated", {}, "Фон рабочего стола обновлен") : "Фон рабочего стола обновлен", "success");
            }

            // Upload to backend server
            fetch("/api/settings/wallpaper", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ theme: targetTheme, image_base64: compressedBase64 })
            })
            .then(res => res.json())
            .then(data => {
              if (data && data.url) {
                setLocalUserItem("bg_custom_" + targetTheme, data.url);
                if (targetTheme === currentTheme) {
                  applyBackground("pattern");
                }
                syncUIForEditingTheme(targetTheme);
              }
            })
            .catch(err => {
              console.warn("Backend wallpaper upload warning:", err);
            });
          };
          img.src = rawBase64;
        };
        reader.readAsDataURL(file);
      });
    }

    // Reset to default pattern
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        const targetTheme = currentEditingBgTheme;
        removeLocalUserItem("bg_custom_" + targetTheme);
        removeLocalUserItem("bg_scale_" + targetTheme);
        if (typeof updateScaleUI === "function") updateScaleUI(450);
        fetch("/api/settings/wallpaper/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ theme: targetTheme })
        }).catch(() => {});

        if (targetTheme === currentTheme) {
          applyBackground("pattern");
        }
        syncUIForEditingTheme(targetTheme);

        if (typeof showToast === "function") {
          showToast(window.t ? window.t("general.bg_restored", {}, "Стандартный паттерн восстановлен") : "Стандартный паттерн восстановлен", "info");
        }
      });
    }

    function sendBackgroundToServer(bgType, bgColor, explicitTheme = null) {
      const targetTheme = (explicitTheme === "light" || explicitTheme === "dark")
        ? explicitTheme
        : (currentEditingBgTheme || currentTheme || "dark");
      const normType = (bgType === "color") ? "color" : "pattern";
      if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
          type: "set_background",
          theme_target: targetTheme,
          bg_type: normType,
          bg_color: bgColor
        }));
      }
      try {
        const payload = {
          bg_type: normType,
          bg_color: bgColor,
          theme_target: targetTheme
        };
        if (targetTheme === "light") {
          payload.bg_type_light = normType;
          payload.bg_color_light = bgColor;
        } else {
          payload.bg_type_dark = normType;
          payload.bg_color_dark = bgColor;
        }
        fetch("/api/settings/general", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).catch(() => {});
      } catch (e) {}
      if (window.scheduleSyncClientSettings) window.scheduleSyncClientSettings();
    }
    window.sendBackgroundToServer = sendBackgroundToServer;
    window.syncBgCardActiveClasses = syncCardActiveClasses;

    radioInputs.forEach(radio => {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        const chosenType = (radio.value === "color") ? "color" : "pattern";
        const currentConf = _getEffectiveBgConfig(currentEditingBgTheme);
        const currentColor = colorPicker ? colorPicker.value : currentConf.color;

        _draftBg[currentEditingBgTheme] = { type: chosenType, color: currentColor };
        _hasUnsavedBg = true;
        syncCardActiveClasses(chosenType);

        if (currentEditingBgTheme === currentTheme) {
          applyBackground(chosenType, currentColor);
        }
        if (typeof window.setSettingsTabDirty === "function") {
          window.setSettingsTabDirty("tab-appearance", true);
        }
      });
    });

    if (colorPicker) {
      const onColorChange = (e) => {
        const newColor = e.target.value;
        _draftBg[currentEditingBgTheme] = { type: "color", color: newColor };
        _hasUnsavedBg = true;
        if (colorPreview) {
          colorPreview.style.backgroundColor = newColor;
        }
        syncCardActiveClasses("color");

        if (currentEditingBgTheme === currentTheme) {
          applyBackground("color", newColor);
        }
        if (typeof window.setSettingsTabDirty === "function") {
          window.setSettingsTabDirty("tab-appearance", true);
        }
      };

      colorPicker.addEventListener("input", onColorChange);
      colorPicker.addEventListener("change", onColorChange);
    }

    function commitPendingBgSettings() {
      if (!_hasUnsavedBg) return false;
      ["dark", "light"].forEach((themeKey) => {
        const draft = _draftBg[themeKey];
        if (draft) {
          setBgConfigForTheme(themeKey, draft.type, draft.color);
          sendBackgroundToServer(draft.type, draft.color, themeKey);
        }
      });
      _resetBgDraftFromStorage();
      applyBackgroundForActiveTheme();
      syncUIForEditingTheme(currentEditingBgTheme || currentTheme);
      return true;
    }

    function revertUnsavedBgSettings() {
      if (!_hasUnsavedBg) return false;
      _resetBgDraftFromStorage();
      applyBackgroundForActiveTheme();
      syncUIForEditingTheme(currentEditingBgTheme || currentTheme);
      return true;
    }

    _commitBgFn = commitPendingBgSettings;
    _revertBgFn = revertUnsavedBgSettings;

    syncUIForEditingTheme(currentTheme);
  }


  function initBorderRadiusSettings() {
    const slider = document.getElementById("sliderBorderRadius");
    const label = document.getElementById("borderRadiusValueLabel");

    function applyRadius(val, save = true) {
      const num = Math.max(0, Math.min(20, parseInt(val, 10) || 0));
      document.documentElement.style.setProperty("--app-border-radius", num + "px");
      if (slider) slider.value = num;
      if (label) label.textContent = num + " px";
      if (save) {
        setLocalUserItem("border_radius", num);
        if (window.scheduleSyncClientSettings) window.scheduleSyncClientSettings();
      }
    }

    const saved = parseInt(getLocalUserItem("border_radius", "5"), 10);
    applyRadius(isNaN(saved) ? 5 : saved, false);

    if (slider) {
      slider.addEventListener("input", (e) => {
        applyRadius(e.target.value, true);
      });
    }

    window.applyAppBorderRadius = applyRadius;
  }

  const DEFAULT_TOOLBAR_BG_TOP = "#003e94";
  const DEFAULT_TOOLBAR_BG_BOTTOM = "#051226";
  const DEFAULT_TOOLBAR_BG_TOP_LIGHT = "#67d477";
  const DEFAULT_TOOLBAR_BG_BOTTOM_LIGHT = "#b9e8ee";

  function _normalizeHexColor(val, fallback) {
    const raw = String(val || "").trim();
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
  }

  function _hexRgbLuminance(hex) {
    const h = _normalizeHexColor(hex, "#000000");
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    return (0.299 * r) + (0.587 * g) + (0.114 * b);
  }

  function getToolbarBgConfigForTheme(theme) {
    const target = (theme === "light") ? "light" : "dark";
    if (target === "light") {
      return {
        theme: "light",
        topKey: "toolbar_bg_top_light",
        bottomKey: "toolbar_bg_bottom_light",
        defTop: DEFAULT_TOOLBAR_BG_TOP_LIGHT,
        defBottom: DEFAULT_TOOLBAR_BG_BOTTOM_LIGHT,
        top: _normalizeHexColor(getLocalUserItem("toolbar_bg_top_light", DEFAULT_TOOLBAR_BG_TOP_LIGHT), DEFAULT_TOOLBAR_BG_TOP_LIGHT),
        bottom: _normalizeHexColor(getLocalUserItem("toolbar_bg_bottom_light", DEFAULT_TOOLBAR_BG_BOTTOM_LIGHT), DEFAULT_TOOLBAR_BG_BOTTOM_LIGHT)
      };
    }
    return {
      theme: "dark",
      topKey: "toolbar_bg_top",
      bottomKey: "toolbar_bg_bottom",
      defTop: DEFAULT_TOOLBAR_BG_TOP,
      defBottom: DEFAULT_TOOLBAR_BG_BOTTOM,
      top: _normalizeHexColor(getLocalUserItem("toolbar_bg_top", DEFAULT_TOOLBAR_BG_TOP), DEFAULT_TOOLBAR_BG_TOP),
      bottom: _normalizeHexColor(getLocalUserItem("toolbar_bg_bottom", DEFAULT_TOOLBAR_BG_BOTTOM), DEFAULT_TOOLBAR_BG_BOTTOM)
    };
  }

  function syncToolbarLogoContrast(topHex, bottomHex) {
    const activeCfg = getToolbarBgConfigForTheme(currentTheme);
    const inlineTop = (typeof document !== "undefined" && document.documentElement && document.documentElement.style && typeof document.documentElement.style.getPropertyValue === "function")
      ? document.documentElement.style.getPropertyValue("--toolbar-bg-top")
      : "";
    const inlineBottom = (typeof document !== "undefined" && document.documentElement && document.documentElement.style && typeof document.documentElement.style.getPropertyValue === "function")
      ? document.documentElement.style.getPropertyValue("--toolbar-bg-bottom")
      : "";
    const tColor = _normalizeHexColor(
      topHex || inlineTop || activeCfg.top,
      activeCfg.defTop
    );
    const bColor = _normalizeHexColor(
      bottomHex || inlineBottom || activeCfg.bottom,
      activeCfg.defBottom
    );
    const avgLum = (_hexRgbLuminance(tColor) + _hexRgbLuminance(bColor)) / 2;
    const isLightBg = avgLum >= 150;
    document.querySelectorAll("#proxdmrTopToolbar, .proxdmr-top-toolbar").forEach(tb => {
      tb.classList.toggle("toolbar-bg-light", isLightBg);
      tb.classList.toggle("toolbar-bg-dark", !isLightBg);
    });
  }

  function _wireCollapsibleToggle(frameId, toggleId) {
    const frame = document.getElementById(frameId);
    const toggle = document.getElementById(toggleId);
    if (frame && toggle && !toggle._wired) {
      toggle._wired = true;
      toggle.addEventListener("click", () => {
        frame.classList.toggle("collapsed");
      });
    }
  }

  function initInterfaceElementsSettings() {
    _wireCollapsibleToggle("borderRadiusSettingsFrame", "borderRadiusSettingsToggle");
    _wireCollapsibleToggle("toolbarBgColorsFrame", "toolbarBgColorsToggle");
    _wireCollapsibleToggle("hotspotTsColorsFrame", "hotspotTsColorsToggle");
    _wireCollapsibleToggle("mobileHsDividerFrame", "mobileHsDividerToggle");
    _wireCollapsibleToggle("chartsSettingsFrame", "chartsSettingsToggle");
  }

  function initSettingsTabHints() {
    if (typeof document === "undefined") return;
    let hintEl = document.getElementById("proxdmrSettingsTabHint");
    if (!hintEl) {
      hintEl = document.createElement("div");
      hintEl.id = "proxdmrSettingsTabHint";
      hintEl.className = "settings-tab-hint";
      hintEl.setAttribute("role", "tooltip");
      hintEl.setAttribute("aria-hidden", "true");
      document.body.appendChild(hintEl);
    }

    let _touchHoldTimer = null;
    let _touchHideTimer = null;
    let _touchLongPressedBtn = null;
    let _touchStartX = 0;
    let _touchStartY = 0;
    let _recentTouchAt = 0;

    function resolveHintText(btn) {
      if (!btn) return "";
      const key = btn.getAttribute("data-hint-i18n") || "";
      const fb = btn.getAttribute("data-hint-fallback") || btn.getAttribute("aria-label") || "";
      if (key && typeof window !== "undefined" && typeof window.t === "function") {
        const translated = window.t(key, {}, fb);
        if (translated && translated !== key) return translated;
      }
      return fb;
    }

    function hideHint() {
      if (_touchHideTimer) {
        clearTimeout(_touchHideTimer);
        _touchHideTimer = null;
      }
      hintEl.classList.remove("is-visible");
      hintEl.setAttribute("aria-hidden", "true");
    }

    function showHintAt(text, x, y) {
      if (!text) return;
      if (_touchHideTimer) {
        clearTimeout(_touchHideTimer);
        _touchHideTimer = null;
      }
      hintEl.textContent = text;
      hintEl.classList.add("is-visible");
      hintEl.setAttribute("aria-hidden", "false");

      const rect = hintEl.getBoundingClientRect();
      const hw = rect.width || 110;
      const hh = rect.height || 30;
      const margin = 10;
      const clampedX = Math.max(margin, Math.min(window.innerWidth - hw - margin, x));
      const clampedY = Math.max(margin, Math.min(window.innerHeight - hh - margin, y));
      hintEl.style.left = `${Math.round(clampedX)}px`;
      hintEl.style.top = `${Math.round(clampedY)}px`;
    }

    function showDesktopHint(btn) {
      const txt = resolveHintText(btn);
      if (!txt) return;
      hintEl.textContent = txt;
      const btnRect = btn.getBoundingClientRect();
      hintEl.classList.add("is-visible");
      const hRect = hintEl.getBoundingClientRect();
      const x = btnRect.left + (btnRect.width / 2) - ((hRect.width || 90) / 2);
      const y = btnRect.bottom + 8;
      showHintAt(txt, x, y);
    }

    function showTouchOffsetHint(btn, clientX, clientY) {
      const txt = resolveHintText(btn);
      if (!txt) return;
      hintEl.textContent = txt;
      hintEl.classList.add("is-visible");
      const hRect = hintEl.getBoundingClientRect();
      const hw = hRect.width || 110;
      const hh = hRect.height || 30;
      // Offset ~2cm down (+76px) and sideways (+56px / -56px away from finger)
      let x = (clientX < window.innerWidth * 0.55) ? (clientX + 56) : (clientX - hw - 56);
      let y = clientY + 76;
      if (y + hh > window.innerHeight - 10) {
        y = Math.max(10, clientY - hh - 76);
      }
      showHintAt(txt, x, y);
    }

    function cancelTouchHold() {
      if (_touchHoldTimer) {
        clearTimeout(_touchHoldTimer);
        _touchHoldTimer = null;
      }
    }

    const tabs = document.querySelectorAll("#settingsModal .modal-tabs .tab-btn");
    tabs.forEach((btn) => {
      if (btn._tabHintWired) return;
      btn._tabHintWired = true;

      btn.addEventListener("mouseenter", () => {
        if (Date.now() - _recentTouchAt < 700) return;
        showDesktopHint(btn);
      });
      btn.addEventListener("mouseleave", hideHint);

      btn.addEventListener("touchstart", (e) => {
        _recentTouchAt = Date.now();
        cancelTouchHold();
        _touchLongPressedBtn = null;
        const touch = e.touches && e.touches[0];
        if (!touch) return;
        _touchStartX = touch.clientX;
        _touchStartY = touch.clientY;
        _touchHoldTimer = setTimeout(() => {
          _touchLongPressedBtn = btn;
          if (navigator.vibrate) {
            try { navigator.vibrate(25); } catch (_) {}
          }
          showTouchOffsetHint(btn, _touchStartX, _touchStartY);
        }, 380);
      }, { passive: true });

      btn.addEventListener("touchmove", (e) => {
        const touch = e.touches && e.touches[0];
        if (!touch) return;
        if (Math.hypot(touch.clientX - _touchStartX, touch.clientY - _touchStartY) > 12) {
          cancelTouchHold();
        }
      }, { passive: true });

      const onTouchEndOrCancel = () => {
        _recentTouchAt = Date.now();
        cancelTouchHold();
        if (_touchLongPressedBtn === btn) {
          _touchHideTimer = setTimeout(() => {
            _touchLongPressedBtn = null;
            hideHint();
          }, 1400);
        }
      };
      btn.addEventListener("touchend", onTouchEndOrCancel, { passive: true });
      btn.addEventListener("touchcancel", () => {
        cancelTouchHold();
        _touchLongPressedBtn = null;
        hideHint();
      }, { passive: true });

      btn.addEventListener("click", (e) => {
        if (_touchLongPressedBtn === btn) {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
          return;
        }
        hideHint();
      }, true);
    });

    if (!window._settingsTabHintGlobalWired) {
      window._settingsTabHintGlobalWired = true;
      window.addEventListener("scroll", hideHint, { passive: true, capture: true });
      window.addEventListener("resize", hideHint, { passive: true });
    }
  }

  function initToolbarBgSettings() {
    const frame = document.getElementById("toolbarBgColorsFrame");
    const tabDark = document.getElementById("toolbarBgTabDark");
    const tabLight = document.getElementById("toolbarBgTabLight");
    const groupEl = document.getElementById("toolbarBgGroup");
    const editingLbl = document.getElementById("toolbarBgEditingLabel");
    const topPicker = document.getElementById("optToolbarBgTopPicker");
    const bottomPicker = document.getElementById("optToolbarBgBottomPicker");
    const topSwatch = document.getElementById("toolbarBgTopSwatch");
    const bottomSwatch = document.getElementById("toolbarBgBottomSwatch");
    const topHexEl = document.getElementById("toolbarBgTopHex");
    const bottomHexEl = document.getElementById("toolbarBgBottomHex");
    const previewBar = document.getElementById("toolbarBgPreviewBar");
    const btnReset = document.getElementById("btnResetToolbarBg");

    let currentEditingToolbarTheme = (currentTheme === "light") ? "light" : "dark";
    let _hasUnsavedToolbarBg = false;
    const _draftToolbarBg = { dark: null, light: null };

    function _getEffectiveToolbarBgConfig(theme) {
      const target = (theme === "light") ? "light" : "dark";
      const savedCfg = getToolbarBgConfigForTheme(target);
      if (_hasUnsavedToolbarBg && _draftToolbarBg[target]) {
        return {
          ...savedCfg,
          top: _draftToolbarBg[target].top,
          bottom: _draftToolbarBg[target].bottom
        };
      }
      return savedCfg;
    }

    function _resetToolbarBgDraftFromStorage() {
      _hasUnsavedToolbarBg = false;
      _draftToolbarBg.dark = null;
      _draftToolbarBg.light = null;
    }

    function renderToolbarBgEditorForTheme(targetTheme) {
      currentEditingToolbarTheme = (targetTheme === "light") ? "light" : "dark";
      if (tabDark && tabLight) {
        tabDark.classList.toggle("active", currentEditingToolbarTheme === "dark");
        tabLight.classList.toggle("active", currentEditingToolbarTheme === "light");
      }
      if (groupEl) {
        groupEl.classList.toggle("is-active-theme", currentEditingToolbarTheme === ((currentTheme === "light") ? "light" : "dark"));
      }
      if (editingLbl) {
        const isLight = currentEditingToolbarTheme === "light";
        const lblKey = isLight ? "general.bg_tab_light" : "general.bg_tab_dark";
        const lblDef = isLight ? "Светлая тема" : "Тёмная тема";
        const lblText = (typeof window !== "undefined" && typeof window.t === "function") ? window.t(lblKey, {}, lblDef) : lblDef;
        editingLbl.innerHTML = `<span>${isLight ? "☀️" : "🌙"}</span> <span data-i18n="${lblKey}">${lblText}</span>`;
      }
      const cfg = _getEffectiveToolbarBgConfig(currentEditingToolbarTheme);
      const topColor = _normalizeHexColor(cfg.top, cfg.defTop);
      const bottomColor = _normalizeHexColor(cfg.bottom, cfg.defBottom);
      if (topPicker && topPicker.value.toLowerCase() !== topColor) topPicker.value = topColor;
      if (bottomPicker && bottomPicker.value.toLowerCase() !== bottomColor) bottomPicker.value = bottomColor;
      if (topSwatch) topSwatch.style.background = topColor;
      if (bottomSwatch) bottomSwatch.style.background = bottomColor;
      if (topHexEl) topHexEl.textContent = topColor.toUpperCase();
      if (bottomHexEl) bottomHexEl.textContent = bottomColor.toUpperCase();
      if (previewBar) {
        previewBar.style.background = `linear-gradient(180deg, ${topColor} 0%, ${bottomColor} 100%)`;
      }
    }

    function applyToolbarBgGradientForTheme(theme, topVal, bottomVal, save = true) {
      const target = (theme === "light") ? "light" : "dark";
      const cfg = getToolbarBgConfigForTheme(target);
      const topColor = _normalizeHexColor(topVal !== undefined && topVal !== null ? topVal : cfg.top, cfg.defTop);
      const bottomColor = _normalizeHexColor(bottomVal !== undefined && bottomVal !== null ? bottomVal : cfg.bottom, cfg.defBottom);

      if (save) {
        setLocalUserItem(cfg.topKey, topColor);
        setLocalUserItem(cfg.bottomKey, bottomColor);
        if (window.scheduleSyncClientSettings) window.scheduleSyncClientSettings();
      }

      const active = (currentTheme === "light") ? "light" : "dark";
      if (target === active) {
        document.documentElement.style.setProperty("--toolbar-bg-top", topColor);
        document.documentElement.style.setProperty("--toolbar-bg-bottom", bottomColor);
        syncToolbarLogoContrast(topColor, bottomColor);
      }
      if (target === currentEditingToolbarTheme) {
        renderToolbarBgEditorForTheme(currentEditingToolbarTheme);
      }
    }

    function applyToolbarBgForActiveTheme() {
      const darkCfg = _getEffectiveToolbarBgConfig("dark");
      const lightCfg = _getEffectiveToolbarBgConfig("light");
      applyToolbarBgGradientForTheme("dark", darkCfg.top, darkCfg.bottom, false);
      applyToolbarBgGradientForTheme("light", lightCfg.top, lightCfg.bottom, false);
      renderToolbarBgEditorForTheme(currentEditingToolbarTheme);
      if (typeof window.syncMobileHsDividerFromStorage === "function") {
        window.syncMobileHsDividerFromStorage();
      }
    }

    function applyToolbarBgGradient(topVal, bottomVal, save = true, targetTheme = null) {
      const theme = (targetTheme === "light" || targetTheme === "dark")
        ? targetTheme
        : ((currentTheme === "light") ? "light" : "dark");
      applyToolbarBgGradientForTheme(theme, topVal, bottomVal, save);
    }

    syncToolbarBgTabs = function (theme) {
      renderToolbarBgEditorForTheme((theme === "light") ? "light" : "dark");
    };

    [tabDark, tabLight].forEach((tab) => {
      if (tab && !tab._wiredToolbarTab) {
        tab._wiredToolbarTab = true;
        tab.addEventListener("click", (e) => {
          e.stopPropagation();
          if (frame && frame.classList.contains("collapsed")) {
            frame.classList.remove("collapsed");
          }
          renderToolbarBgEditorForTheme(tab.dataset.themeTarget || "dark");
        });
      }
    });

    if (topPicker && !topPicker._wiredToolbarTop) {
      topPicker._wiredToolbarTop = true;
      const onTopInput = (e) => {
        const tKey = currentEditingToolbarTheme;
        const curCfg = _getEffectiveToolbarBgConfig(tKey);
        const bVal = bottomPicker ? bottomPicker.value : curCfg.bottom;
        const topNorm = _normalizeHexColor(e.target.value, curCfg.defTop);
        const botNorm = _normalizeHexColor(bVal, curCfg.defBottom);
        _hasUnsavedToolbarBg = true;
        _draftToolbarBg[tKey] = { top: topNorm, bottom: botNorm };
        applyToolbarBgGradientForTheme(tKey, topNorm, botNorm, false);
        if (typeof window.setSettingsTabDirty === "function") {
          window.setSettingsTabDirty("tab-appearance", true);
        }
      };
      topPicker.addEventListener("input", onTopInput);
      topPicker.addEventListener("change", onTopInput);
    }

    if (bottomPicker && !bottomPicker._wiredToolbarBottom) {
      bottomPicker._wiredToolbarBottom = true;
      const onBottomInput = (e) => {
        const tKey = currentEditingToolbarTheme;
        const curCfg = _getEffectiveToolbarBgConfig(tKey);
        const tVal = topPicker ? topPicker.value : curCfg.top;
        const topNorm = _normalizeHexColor(tVal, curCfg.defTop);
        const botNorm = _normalizeHexColor(e.target.value, curCfg.defBottom);
        _hasUnsavedToolbarBg = true;
        _draftToolbarBg[tKey] = { top: topNorm, bottom: botNorm };
        applyToolbarBgGradientForTheme(tKey, topNorm, botNorm, false);
        if (typeof window.setSettingsTabDirty === "function") {
          window.setSettingsTabDirty("tab-appearance", true);
        }
      };
      bottomPicker.addEventListener("input", onBottomInput);
      bottomPicker.addEventListener("change", onBottomInput);
    }

    if (btnReset && !btnReset._wiredToolbarReset) {
      btnReset._wiredToolbarReset = true;
      btnReset.addEventListener("click", (e) => {
        e.stopPropagation();
        const tKey = currentEditingToolbarTheme;
        const defCfg = getToolbarBgConfigForTheme(tKey);
        _hasUnsavedToolbarBg = true;
        _draftToolbarBg[tKey] = { top: defCfg.defTop, bottom: defCfg.defBottom };
        applyToolbarBgGradientForTheme(tKey, defCfg.defTop, defCfg.defBottom, false);
        if (typeof window.setSettingsTabDirty === "function") {
          window.setSettingsTabDirty("tab-appearance", true);
        }
      });
    }

    applyToolbarBgForActiveTheme();

    function commitPendingToolbarBgSettings() {
      if (!_hasUnsavedToolbarBg) return false;
      ["dark", "light"].forEach((themeKey) => {
        const draft = _draftToolbarBg[themeKey];
        if (draft && draft.top && draft.bottom) {
          applyToolbarBgGradientForTheme(themeKey, draft.top, draft.bottom, true);
        }
      });
      _resetToolbarBgDraftFromStorage();
      return true;
    }

    function revertUnsavedToolbarBgSettings() {
      if (!_hasUnsavedToolbarBg) return false;
      _resetToolbarBgDraftFromStorage();
      applyToolbarBgForActiveTheme();
      return true;
    }

    _commitToolbarBgFn = commitPendingToolbarBgSettings;
    _revertToolbarBgFn = revertUnsavedToolbarBgSettings;

    window.applyToolbarBgGradient = applyToolbarBgGradient;
    window.applyToolbarBgForActiveTheme = applyToolbarBgForActiveTheme;
    window.syncToolbarLogoContrast = syncToolbarLogoContrast;
  }

  function initHotspotTsColorsSettings() {
    const VFO_DEFAULTS = {
      active: {
        dark: { top: "#00a527", bottom: "#21512e" },
        light: { top: "#00bb40", bottom: "#bbf7d0" }
      },
      muted: {
        dark: { top: "#004410", bottom: "#0a2106" },
        light: { top: "#dbffe8", bottom: "#ffffff" }
      },
      standby: {
        dark: { top: "#22272e", bottom: "#101317" },
        light: { top: "#f8fafc", bottom: "#f1f5f9" }
      },
      tx: {
        top: "#bc3232",
        bottom: "#791f1f"
      }
    };

    const frame = document.getElementById("hotspotTsColorsFrame");
    const tabDark = document.getElementById("tsColorsTabDark");
    const tabLight = document.getElementById("tsColorsTabLight");

    const uiPairs = {
      active: {
        topPicker: document.getElementById("optTsActiveTopPicker"),
        bottomPicker: document.getElementById("optTsActiveBottomPicker"),
        topSwatch: document.getElementById("tsActiveTopSwatch"),
        bottomSwatch: document.getElementById("tsActiveBottomSwatch"),
        topHex: document.getElementById("tsActiveTopHex"),
        bottomHex: document.getElementById("tsActiveBottomHex"),
        preview: document.getElementById("tsActivePreviewBar"),
        btnReset: document.getElementById("btnResetTsActiveColor")
      },
      muted: {
        topPicker: document.getElementById("optTsMutedTopPicker"),
        bottomPicker: document.getElementById("optTsMutedBottomPicker"),
        topSwatch: document.getElementById("tsMutedTopSwatch"),
        bottomSwatch: document.getElementById("tsMutedBottomSwatch"),
        topHex: document.getElementById("tsMutedTopHex"),
        bottomHex: document.getElementById("tsMutedBottomHex"),
        preview: document.getElementById("tsMutedPreviewBar"),
        btnReset: document.getElementById("btnResetTsMutedColor")
      },
      standby: {
        topPicker: document.getElementById("optTsStandbyTopPicker"),
        bottomPicker: document.getElementById("optTsStandbyBottomPicker"),
        topSwatch: document.getElementById("tsStandbyTopSwatch"),
        bottomSwatch: document.getElementById("tsStandbyBottomSwatch"),
        topHex: document.getElementById("tsStandbyTopHex"),
        bottomHex: document.getElementById("tsStandbyBottomHex"),
        preview: document.getElementById("tsStandbyPreviewBar"),
        btnReset: document.getElementById("btnResetTsStandbyColor")
      },
      tx: {
        topPicker: document.getElementById("optTsTxTopPicker"),
        bottomPicker: document.getElementById("optTsTxBottomPicker"),
        topSwatch: document.getElementById("tsTxTopSwatch"),
        bottomSwatch: document.getElementById("tsTxBottomSwatch"),
        topHex: document.getElementById("tsTxTopHex"),
        bottomHex: document.getElementById("tsTxBottomHex"),
        preview: document.getElementById("tsTxPreviewBar"),
        btnReset: document.getElementById("btnResetTsTxColor")
      }
    };

    let currentEditingTsTheme = (currentTheme === "light") ? "light" : "dark";
    let _hasUnsavedTsColors = false;
    const _draftTs = {
      active: { dark: null, light: null },
      muted: { dark: null, light: null },
      standby: { dark: null, light: null },
      tx: null
    };

    const _TS_KEY_PREFIXES = {
      active: "vfo_rx",
      muted: "vfo_rx_muted",
      standby: "vfo_standby"
    };

    function _getSavedPair(kind, theme) {
      if (kind === "tx") {
        const rawTop = getLocalUserItem("vfo_tx_bg_top", "");
        const rawBot = getLocalUserItem("vfo_tx_bg_bot", "");
        const hasCustom = /^#[0-9a-f]{6}$/i.test(rawTop || "") && /^#[0-9a-f]{6}$/i.test(rawBot || "");
        const defs = VFO_DEFAULTS.tx;
        return {
          customized: hasCustom,
          top: hasCustom ? rawTop.toLowerCase() : defs.top,
          bottom: hasCustom ? rawBot.toLowerCase() : defs.bottom
        };
      }
      const suf = (theme === "light") ? "_light" : "_dark";
      const keyPrefix = _TS_KEY_PREFIXES[kind] || "vfo_standby";
      const defs = VFO_DEFAULTS[kind][(theme === "light") ? "light" : "dark"];
      const rawTop = getLocalUserItem(`${keyPrefix}_top${suf}`, "");
      const rawBot = getLocalUserItem(`${keyPrefix}_bot${suf}`, "");
      const hasCustom = /^#[0-9a-f]{6}$/i.test(rawTop || "") && /^#[0-9a-f]{6}$/i.test(rawBot || "");
      return {
        customized: hasCustom,
        top: hasCustom ? rawTop.toLowerCase() : defs.top,
        bottom: hasCustom ? rawBot.toLowerCase() : defs.bottom
      };
    }

    function _getEffectivePair(kind, theme) {
      if (kind === "tx") {
        if (_draftTs.tx) return { ..._draftTs.tx };
        return _getSavedPair("tx", theme);
      }
      const tKey = (theme === "light") ? "light" : "dark";
      if (_draftTs[kind] && _draftTs[kind][tKey]) {
        return { ..._draftTs[kind][tKey] };
      }
      return _getSavedPair(kind, tKey);
    }

    function _syncContrastAttr(attrName, topHex, botHex, isCustomized) {
      const docEl = document.documentElement;
      if (!isCustomized) {
        docEl.removeAttribute(attrName);
        return;
      }
      const avgLum = (_hexRgbLuminance(topHex) + _hexRgbLuminance(botHex)) / 2;
      docEl.setAttribute(attrName, avgLum < 145 ? "light" : "dark");
    }

    function _renderPairUI(kind, pair) {
      const ui = uiPairs[kind];
      if (!ui || !pair) return;
      const topHex = _normalizeHexColor(pair.top, "#000000");
      const botHex = _normalizeHexColor(pair.bottom, "#000000");
      if (ui.topPicker && ui.topPicker.value.toLowerCase() !== topHex) ui.topPicker.value = topHex;
      if (ui.bottomPicker && ui.bottomPicker.value.toLowerCase() !== botHex) ui.bottomPicker.value = botHex;
      if (ui.topSwatch) ui.topSwatch.style.background = topHex;
      if (ui.bottomSwatch) ui.bottomSwatch.style.background = botHex;
      if (ui.topHex) ui.topHex.textContent = topHex.toUpperCase();
      if (ui.bottomHex) ui.bottomHex.textContent = botHex.toUpperCase();
      if (ui.preview) {
        ui.preview.style.background = `linear-gradient(180deg, ${topHex} 0%, ${botHex} 100%)`;
      }
    }

    function _applyCssVarsForActiveTheme() {
      const activeTheme = (currentTheme === "light") ? "light" : "dark";
      const docEl = document.documentElement;

      const rxPair = _getEffectivePair("active", activeTheme);
      if (rxPair.customized) {
        docEl.style.setProperty("--vfo-rx-custom-top", rxPair.top);
        docEl.style.setProperty("--vfo-rx-custom-bot", rxPair.bottom);
      } else {
        docEl.style.removeProperty("--vfo-rx-custom-top");
        docEl.style.removeProperty("--vfo-rx-custom-bot");
      }
      _syncContrastAttr("data-vfo-rx-contrast", rxPair.top, rxPair.bottom, rxPair.customized);

      const mutedPair = _getEffectivePair("muted", activeTheme);
      if (mutedPair.customized) {
        docEl.style.setProperty("--vfo-rx-muted-custom-top", mutedPair.top);
        docEl.style.setProperty("--vfo-rx-muted-custom-bot", mutedPair.bottom);
      } else {
        docEl.style.removeProperty("--vfo-rx-muted-custom-top");
        docEl.style.removeProperty("--vfo-rx-muted-custom-bot");
      }
      _syncContrastAttr("data-vfo-rx-muted-contrast", mutedPair.top, mutedPair.bottom, mutedPair.customized);

      const stPair = _getEffectivePair("standby", activeTheme);
      if (stPair.customized) {
        docEl.style.setProperty("--vfo-standby-top", stPair.top);
        docEl.style.setProperty("--vfo-standby-bot", stPair.bottom);
      } else {
        docEl.style.removeProperty("--vfo-standby-top");
        docEl.style.removeProperty("--vfo-standby-bot");
      }
      _syncContrastAttr("data-vfo-standby-contrast", stPair.top, stPair.bottom, stPair.customized);

      const txPair = _getEffectivePair("tx", activeTheme);
      if (txPair.customized) {
        docEl.style.setProperty("--vfo-tx-custom-top", txPair.top);
        docEl.style.setProperty("--vfo-tx-custom-bot", txPair.bottom);
      } else {
        docEl.style.removeProperty("--vfo-tx-custom-top");
        docEl.style.removeProperty("--vfo-tx-custom-bot");
      }
      _syncContrastAttr("data-vfo-tx-contrast", txPair.top, txPair.bottom, true);
    }

    function renderTsEditorForTheme(targetTheme) {
      currentEditingTsTheme = (targetTheme === "light") ? "light" : "dark";
      if (tabDark && tabLight) {
        tabDark.classList.toggle("active", currentEditingTsTheme === "dark");
        tabLight.classList.toggle("active", currentEditingTsTheme === "light");
      }
      _renderPairUI("active", _getEffectivePair("active", currentEditingTsTheme));
      _renderPairUI("muted", _getEffectivePair("muted", currentEditingTsTheme));
      _renderPairUI("standby", _getEffectivePair("standby", currentEditingTsTheme));
      _renderPairUI("tx", _getEffectivePair("tx", currentEditingTsTheme));
    }

    function applyHotspotTsColorsForActiveTheme() {
      _applyCssVarsForActiveTheme();
      renderTsEditorForTheme(currentEditingTsTheme);
    }

    syncTsColorsTabs = function (theme) {
      renderTsEditorForTheme((theme === "light") ? "light" : "dark");
    };

    [tabDark, tabLight].forEach((tab) => {
      if (tab && !tab._wiredTsColorsTab) {
        tab._wiredTsColorsTab = true;
        tab.addEventListener("click", (e) => {
          e.stopPropagation();
          if (frame && frame.classList.contains("collapsed")) {
            frame.classList.remove("collapsed");
          }
          renderTsEditorForTheme(tab.dataset.themeTarget || "dark");
        });
      }
    });

    ["active", "muted", "standby", "tx"].forEach((kind) => {
      const ui = uiPairs[kind];
      if (!ui) return;
      const onSlotChange = () => {
        const topVal = _normalizeHexColor(ui.topPicker ? ui.topPicker.value : "", "#000000");
        const botVal = _normalizeHexColor(ui.bottomPicker ? ui.bottomPicker.value : "", "#000000");
        _hasUnsavedTsColors = true;
        if (kind === "tx") {
          _draftTs.tx = { customized: true, top: topVal, bottom: botVal };
        } else {
          _draftTs[kind][currentEditingTsTheme] = { customized: true, top: topVal, bottom: botVal };
        }
        _renderPairUI(kind, { customized: true, top: topVal, bottom: botVal });
        _applyCssVarsForActiveTheme();
        if (typeof window.setSettingsTabDirty === "function") {
          window.setSettingsTabDirty("tab-appearance", true);
        }
      };

      if (ui.topPicker && !ui.topPicker._wiredTsColor) {
        ui.topPicker._wiredTsColor = true;
        ui.topPicker.addEventListener("input", onSlotChange);
        ui.topPicker.addEventListener("change", onSlotChange);
      }
      if (ui.bottomPicker && !ui.bottomPicker._wiredTsColor) {
        ui.bottomPicker._wiredTsColor = true;
        ui.bottomPicker.addEventListener("input", onSlotChange);
        ui.bottomPicker.addEventListener("change", onSlotChange);
      }
      if (ui.btnReset && !ui.btnReset._wiredTsReset) {
        ui.btnReset._wiredTsReset = true;
        ui.btnReset.addEventListener("click", (e) => {
          e.stopPropagation();
          _hasUnsavedTsColors = true;
          if (kind === "tx") {
            const defs = VFO_DEFAULTS.tx;
            _draftTs.tx = { customized: false, top: defs.top, bottom: defs.bottom };
            _renderPairUI("tx", _draftTs.tx);
          } else {
            const defs = VFO_DEFAULTS[kind][currentEditingTsTheme];
            _draftTs[kind][currentEditingTsTheme] = { customized: false, top: defs.top, bottom: defs.bottom };
            _renderPairUI(kind, _draftTs[kind][currentEditingTsTheme]);
          }
          _applyCssVarsForActiveTheme();
          if (typeof window.setSettingsTabDirty === "function") {
            window.setSettingsTabDirty("tab-appearance", true);
          }
        });
      }
    });

    function _resetTsDraftFromStorage() {
      _hasUnsavedTsColors = false;
      _draftTs.active = { dark: null, light: null };
      _draftTs.muted = { dark: null, light: null };
      _draftTs.standby = { dark: null, light: null };
      _draftTs.tx = null;
    }

    function commitPendingTsColorsSettings() {
      if (!_hasUnsavedTsColors) return false;
      ["active", "muted", "standby"].forEach((kind) => {
        const keyPrefix = _TS_KEY_PREFIXES[kind] || "vfo_standby";
        ["dark", "light"].forEach((tKey) => {
          const draft = _draftTs[kind][tKey];
          if (!draft) return;
          const suf = (tKey === "light") ? "_light" : "_dark";
          if (draft.customized) {
            setLocalUserItem(`${keyPrefix}_top${suf}`, draft.top);
            setLocalUserItem(`${keyPrefix}_bot${suf}`, draft.bottom);
          } else {
            removeLocalUserItem(`${keyPrefix}_top${suf}`);
            removeLocalUserItem(`${keyPrefix}_bot${suf}`);
          }
        });
      });
      if (_draftTs.tx) {
        if (_draftTs.tx.customized) {
          setLocalUserItem("vfo_tx_bg_top", _draftTs.tx.top);
          setLocalUserItem("vfo_tx_bg_bot", _draftTs.tx.bottom);
        } else {
          removeLocalUserItem("vfo_tx_bg_top");
          removeLocalUserItem("vfo_tx_bg_bot");
        }
      }
      _resetTsDraftFromStorage();
      applyHotspotTsColorsForActiveTheme();
      if (window.scheduleSyncClientSettings) window.scheduleSyncClientSettings();
      return true;
    }

    function revertUnsavedTsColorsSettings() {
      if (!_hasUnsavedTsColors) return false;
      _resetTsDraftFromStorage();
      applyHotspotTsColorsForActiveTheme();
      return true;
    }

    _commitTsColorsFn = commitPendingTsColorsSettings;
    _revertTsColorsFn = revertUnsavedTsColorsSettings;

    applyHotspotTsColorsForActiveTheme();
    window.applyHotspotTsColorsForActiveTheme = applyHotspotTsColorsForActiveTheme;
  }

  function _parseMobileHsDividerBool(raw) {
    if (raw === false || raw === 0) return false;
    const s = String(raw === null || raw === undefined ? "true" : raw).trim().toLowerCase();
    return !(s === "false" || s === "0" || s === "off" || s === "no");
  }

  function initMobileHsDividerSettings() {
    const chk = document.getElementById("optMobileHsDivider");
    const preview = document.getElementById("mobileHsDividerPreview");

    function applyMobileHsDivider(val, save = true) {
      const enabled = _parseMobileHsDividerBool(val);
      if (document.body) {
        document.body.classList.toggle("mobile-hs-divider-on", enabled);
      }
      if (chk) {
        chk.checked = enabled;
      }
      if (preview) {
        preview.classList.toggle("is-disabled", !enabled);
      }
      if (save) {
        setLocalUserItem("mobile_hs_divider", enabled ? "true" : "false");
        if (window.scheduleSyncClientSettings) window.scheduleSyncClientSettings();
      }
    }

    function syncMobileHsDividerFromStorage() {
      const saved = getLocalUserItem("mobile_hs_divider", "true");
      applyMobileHsDivider(saved, false);
    }

    syncMobileHsDividerFromStorage();

    if (chk && !chk._wiredMobileHsDivider) {
      chk._wiredMobileHsDivider = true;
      chk.addEventListener("change", (e) => {
        applyMobileHsDivider(Boolean(e.target.checked), true);
      });
    }

    window.applyMobileHsDivider = applyMobileHsDivider;
    window.syncMobileHsDividerFromStorage = syncMobileHsDividerFromStorage;
  }

  function commitPendingThemeSettings() {
    let committed = false;
    if (typeof _commitBgFn === "function" && _commitBgFn()) committed = true;
    if (typeof _commitToolbarBgFn === "function" && _commitToolbarBgFn()) committed = true;
    if (typeof _commitTsColorsFn === "function" && _commitTsColorsFn()) committed = true;
    return committed;
  }

  function revertUnsavedThemeSettings() {
    if (
      typeof window !== "undefined" &&
      window.ProxDMRColorPicker &&
      typeof window.ProxDMRColorPicker.isOpen === "function" &&
      window.ProxDMRColorPicker.isOpen() &&
      typeof window.ProxDMRColorPicker.close === "function"
    ) {
      try { window.ProxDMRColorPicker.close(); } catch (_) {}
    }
    let reverted = false;
    if (typeof _revertBgFn === "function" && _revertBgFn()) reverted = true;
    if (typeof _revertToolbarBgFn === "function" && _revertToolbarBgFn()) reverted = true;
    if (typeof _revertTsColorsFn === "function" && _revertTsColorsFn()) reverted = true;
    if (reverted && typeof window !== "undefined" && typeof window.clearSettingsTabDirty === "function") {
      window.clearSettingsTabDirty("tab-appearance");
    }
    return reverted;
  }

  function initSettingsModalThemeRollbackWatcher() {
    if (typeof document === "undefined") return;
    const settingsModal = document.getElementById("settingsModal");
    if (!settingsModal || settingsModal._themeRollbackObserverWired || typeof MutationObserver !== "function") return;
    settingsModal._themeRollbackObserverWired = true;
    let wasActive = settingsModal.classList.contains("active");
    const obs = new MutationObserver(() => {
      const isNowActive = settingsModal.classList.contains("active");
      if (wasActive && !isNowActive) {
        revertUnsavedThemeSettings();
      }
      wasActive = isNowActive;
    });
    obs.observe(settingsModal, { attributes: true, attributeFilter: ["class"] });
  }

  initTheme();
  initInterfaceElementsSettings();
  initSettingsTabHints();
  initBackgroundSettings();
  initBorderRadiusSettings();
  initToolbarBgSettings();
  initHotspotTsColorsSettings();
  initMobileHsDividerSettings();
  initSettingsModalThemeRollbackWatcher();
  window.getTheme = getTheme;
  window.setTheme = setTheme;
  window.toggleTheme = toggleTheme;
  window.initTheme = initTheme;
  window.applyThemeUI = applyThemeUI;
  window.wireThemeToggleButton = wireThemeToggleButton;
  window.applyBackground = applyBackground;
  window.initInterfaceElementsSettings = initInterfaceElementsSettings;
  window.initSettingsTabHints = initSettingsTabHints;
  window.initBackgroundSettings = initBackgroundSettings;
  window.initBorderRadiusSettings = initBorderRadiusSettings;
  window.initToolbarBgSettings = initToolbarBgSettings;
  window.initHotspotTsColorsSettings = initHotspotTsColorsSettings;
  window.initMobileHsDividerSettings = initMobileHsDividerSettings;
  window.syncThemeBgTabs = syncThemeBgTabs;
  window.syncToolbarBgTabs = syncToolbarBgTabs;
  window.syncTsColorsTabs = syncTsColorsTabs;
  window.commitPendingThemeSettings = commitPendingThemeSettings;
  window.revertUnsavedThemeSettings = revertUnsavedThemeSettings;

Object.defineProperty(window, 'currentTheme', { get: () => currentTheme, set: (v) => currentTheme = v, configurable: true });
window.applyBackgroundForActiveTheme = applyBackgroundForActiveTheme;
