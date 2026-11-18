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

  function setTheme(theme, showNotification = false) {
    if (theme !== "light" && theme !== "dark") {
      theme = "dark";
    }
    currentTheme = theme;
    setLocalUserItem("theme", theme);
    applyThemeUI(theme);

    // Apply the wallpaper and toolbar gradient saved specifically for this theme
    applyBackgroundForActiveTheme();
    if (typeof window.applyToolbarBgForActiveTheme === "function") {
      window.applyToolbarBgForActiveTheme();
    }

    // If Settings modal is open, align the wallpaper mode tab
    if (typeof syncThemeBgTabs === "function") {
      syncThemeBgTabs(theme);
    }

    // Persist theme to server
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

  function getBgConfigForTheme(theme) {
    const target = (theme === "light") ? "light" : "dark";
    let bgType, bgColor;
    if (target === "light") {
      bgType = getLocalUserItem("bg_type_light", "pattern");
      if (bgType !== "color") bgType = "pattern";
      bgColor = getLocalUserItem("bg_color_light", "#f4f6f8");
    } else {
      bgType = getLocalUserItem("bg_type_dark", "pattern");
      if (bgType !== "color") bgType = "pattern";
      bgColor = getLocalUserItem("bg_color_dark", "#0f1115");
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
      const defBg = (activeTheme === "light") ? "#f4f6f8" : "var(--bg-primary, #0f1115)";
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
    const conf = getBgConfigForTheme(currentTheme);
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
      const conf = getBgConfigForTheme(currentEditingBgTheme);
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

    function sendBackgroundToServer(bgType, bgColor) {
      const targetTheme = currentEditingBgTheme || currentTheme || "dark";
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
        const currentConf = getBgConfigForTheme(currentEditingBgTheme);
        const currentColor = colorPicker ? colorPicker.value : currentConf.color;

        setBgConfigForTheme(currentEditingBgTheme, chosenType, currentColor);
        syncCardActiveClasses(chosenType);

        if (currentEditingBgTheme === currentTheme) {
          applyBackground(chosenType, currentColor);
          sendBackgroundToServer(chosenType, currentColor);
        }
      });
    });

    if (colorPicker) {
      let colorTimer = null;
      const onColorChange = (e, isFinal) => {
        const newColor = e.target.value;
        setBgConfigForTheme(currentEditingBgTheme, "color", newColor);
        if (colorPreview) {
          colorPreview.style.backgroundColor = newColor;
        }
        syncCardActiveClasses("color");

        if (currentEditingBgTheme === currentTheme) {
          applyBackground("color", newColor);
          if (isFinal) {
            sendBackgroundToServer("color", newColor);
          } else {
            clearTimeout(colorTimer);
            colorTimer = setTimeout(() => {
              sendBackgroundToServer("color", newColor);
            }, 250);
          }
        }
      };

      colorPicker.addEventListener("input", (e) => onColorChange(e, false));
      colorPicker.addEventListener("change", (e) => onColorChange(e, true));
    }

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

  const DEFAULT_TOOLBAR_BG_TOP = "#0037b4";
  const DEFAULT_TOOLBAR_BG_BOTTOM = "#001b43";
  const DEFAULT_TOOLBAR_BG_TOP_LIGHT = "#f4f7fb";
  const DEFAULT_TOOLBAR_BG_BOTTOM_LIGHT = "#dbe6f4";

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

  function initInterfaceElementsSettings() {
    const frame = document.getElementById("interfaceElementsSettingsFrame");
    const toggle = document.getElementById("interfaceElementsSettingsToggle");
    if (frame && toggle && !toggle._wired) {
      toggle._wired = true;
      toggle.addEventListener("click", () => {
        frame.classList.toggle("collapsed");
      });
    }
  }

  function initToolbarBgSettings() {
    const kits = {
      dark: {
        groupEl: document.getElementById("toolbarBgGroupDark"),
        topPicker: document.getElementById("optToolbarBgTopPicker"),
        bottomPicker: document.getElementById("optToolbarBgBottomPicker"),
        topSwatch: document.getElementById("toolbarBgTopSwatch"),
        bottomSwatch: document.getElementById("toolbarBgBottomSwatch"),
        topHexEl: document.getElementById("toolbarBgTopHex"),
        bottomHexEl: document.getElementById("toolbarBgBottomHex"),
        previewBar: document.getElementById("toolbarBgPreviewBarDark"),
        btnReset: document.getElementById("btnResetToolbarBgDark")
      },
      light: {
        groupEl: document.getElementById("toolbarBgGroupLight"),
        topPicker: document.getElementById("optToolbarBgTopLightPicker"),
        bottomPicker: document.getElementById("optToolbarBgBottomLightPicker"),
        topSwatch: document.getElementById("toolbarBgTopLightSwatch"),
        bottomSwatch: document.getElementById("toolbarBgBottomLightSwatch"),
        topHexEl: document.getElementById("toolbarBgTopLightHex"),
        bottomHexEl: document.getElementById("toolbarBgBottomLightHex"),
        previewBar: document.getElementById("toolbarBgPreviewBarLight"),
        btnReset: document.getElementById("btnResetToolbarBgLight")
      }
    };

    function syncActiveThemeKitHighlight() {
      const active = (currentTheme === "light") ? "light" : "dark";
      if (kits.dark.groupEl) kits.dark.groupEl.classList.toggle("is-active-theme", active === "dark");
      if (kits.light.groupEl) kits.light.groupEl.classList.toggle("is-active-theme", active === "light");
    }

    function applyToolbarBgGradientForTheme(theme, topVal, bottomVal, save = true) {
      const target = (theme === "light") ? "light" : "dark";
      const cfg = getToolbarBgConfigForTheme(target);
      const ui = kits[target];

      const topColor = _normalizeHexColor(
        topVal !== undefined && topVal !== null ? topVal : cfg.top,
        cfg.defTop
      );
      const bottomColor = _normalizeHexColor(
        bottomVal !== undefined && bottomVal !== null ? bottomVal : cfg.bottom,
        cfg.defBottom
      );

      if (ui.topPicker && ui.topPicker.value.toLowerCase() !== topColor) ui.topPicker.value = topColor;
      if (ui.bottomPicker && ui.bottomPicker.value.toLowerCase() !== bottomColor) ui.bottomPicker.value = bottomColor;
      if (ui.topSwatch) ui.topSwatch.style.background = topColor;
      if (ui.bottomSwatch) ui.bottomSwatch.style.background = bottomColor;
      if (ui.topHexEl) ui.topHexEl.textContent = topColor.toUpperCase();
      if (ui.bottomHexEl) ui.bottomHexEl.textContent = bottomColor.toUpperCase();
      if (ui.previewBar) {
        ui.previewBar.style.background = `linear-gradient(180deg, ${topColor} 0%, ${bottomColor} 100%)`;
      }

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
      syncActiveThemeKitHighlight();
    }

    function applyToolbarBgForActiveTheme() {
      const darkCfg = getToolbarBgConfigForTheme("dark");
      const lightCfg = getToolbarBgConfigForTheme("light");
      applyToolbarBgGradientForTheme("dark", darkCfg.top, darkCfg.bottom, false);
      applyToolbarBgGradientForTheme("light", lightCfg.top, lightCfg.bottom, false);
      syncActiveThemeKitHighlight();
    }

    function applyToolbarBgGradient(topVal, bottomVal, save = true, targetTheme = null) {
      const theme = (targetTheme === "light" || targetTheme === "dark")
        ? targetTheme
        : ((currentTheme === "light") ? "light" : "dark");
      applyToolbarBgGradientForTheme(theme, topVal, bottomVal, save);
    }

    applyToolbarBgForActiveTheme();

    ["dark", "light"].forEach((themeKey) => {
      const ui = kits[themeKey];
      if (ui.topPicker && !ui.topPicker._wiredToolbarTop) {
        ui.topPicker._wiredToolbarTop = true;
        const onTopInput = (e) => {
          const curCfg = getToolbarBgConfigForTheme(themeKey);
          const bVal = ui.bottomPicker ? ui.bottomPicker.value : curCfg.bottom;
          applyToolbarBgGradientForTheme(themeKey, e.target.value, bVal, true);
        };
        ui.topPicker.addEventListener("input", onTopInput);
        ui.topPicker.addEventListener("change", onTopInput);
      }

      if (ui.bottomPicker && !ui.bottomPicker._wiredToolbarBottom) {
        ui.bottomPicker._wiredToolbarBottom = true;
        const onBottomInput = (e) => {
          const curCfg = getToolbarBgConfigForTheme(themeKey);
          const tVal = ui.topPicker ? ui.topPicker.value : curCfg.top;
          applyToolbarBgGradientForTheme(themeKey, tVal, e.target.value, true);
        };
        ui.bottomPicker.addEventListener("input", onBottomInput);
        ui.bottomPicker.addEventListener("change", onBottomInput);
      }

      if (ui.btnReset && !ui.btnReset._wiredToolbarReset) {
        ui.btnReset._wiredToolbarReset = true;
        ui.btnReset.addEventListener("click", (e) => {
          e.stopPropagation();
          const defCfg = getToolbarBgConfigForTheme(themeKey);
          applyToolbarBgGradientForTheme(themeKey, defCfg.defTop, defCfg.defBottom, true);
        });
      }
    });

    window.applyToolbarBgGradient = applyToolbarBgGradient;
    window.applyToolbarBgForActiveTheme = applyToolbarBgForActiveTheme;
    window.syncToolbarLogoContrast = syncToolbarLogoContrast;
  }

  initTheme();
  initInterfaceElementsSettings();
  initBackgroundSettings();
  initBorderRadiusSettings();
  initToolbarBgSettings();
  window.getTheme = getTheme;
  window.setTheme = setTheme;
  window.toggleTheme = toggleTheme;
  window.initTheme = initTheme;
  window.applyThemeUI = applyThemeUI;
  window.wireThemeToggleButton = wireThemeToggleButton;
  window.applyBackground = applyBackground;
  window.initInterfaceElementsSettings = initInterfaceElementsSettings;
  window.initBackgroundSettings = initBackgroundSettings;
  window.initBorderRadiusSettings = initBorderRadiusSettings;
  window.initToolbarBgSettings = initToolbarBgSettings;
  window.syncThemeBgTabs = syncThemeBgTabs;

Object.defineProperty(window, 'currentTheme', { get: () => currentTheme, set: (v) => currentTheme = v, configurable: true });
window.applyBackgroundForActiveTheme = applyBackgroundForActiveTheme;
