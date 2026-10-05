/**
 * Unified i18n Localization Engine for ProxDMR
 * v2 — Lazy-loading: translations loaded from /static/locales/{lang}.json
 * Fully backward-compatible with v1 API:
 *   window.I18N / window.i18n  — engine instance
 *   window.t(key, params, fallback) — translate function
 *   I18N.t / .apply / .setLanguage / .currentLang / .currentLanguage
 *   I18N.onLanguageChange / .populateLanguageSelect / .registerLanguage
 */
(function () {
  'use strict';

  const SUPPORTED_LANGUAGES = [
    { code: "uk", name: "Українська", flag: "🇺🇦", flagSvg: "/static/flags/ua.svg" },
    { code: "en", name: "English",    flag: "🇬🇧", flagSvg: "/static/flags/gb.svg" },
    { code: "de", name: "Deutsch",    flag: "🇩🇪", flagSvg: "/static/flags/de.svg" },
    { code: "es", name: "Español",    flag: "🇪🇸", flagSvg: "/static/flags/es.svg" },
    { code: "fr", name: "Français",   flag: "🇫🇷", flagSvg: "/static/flags/fr.svg" },
    { code: "it", name: "Italiano",   flag: "🇮🇹", flagSvg: "/static/flags/it.svg" },
    { code: "ru", name: "Русский",    flag: "🇷🇺", flagSvg: "/static/flags/ru.svg" }
  ];

  // Cache-busting version — bump when locales JSON changes
  const LOCALES_VER = "2.9.247";
  const LOCALES_BASE = "/static/locales/";
  const FALLBACK_LANG = "en";

  class I18nEngine {
    constructor() {
      this.supportedLanguages = [...SUPPORTED_LANGUAGES];
      this.translations = {};   // { lang: { key: value } }
      this.loadedFiles  = {};   // { lang: true }
      this.listeners    = [];
      this._pendingApply = false;
      this.currentLang  = this._detectLanguage();
    }

    // ── Compat alias ──────────────────────────────────────────────────────────
    get currentLanguage() { return this.currentLang; }

    // ── Language detection ────────────────────────────────────────────────────
    _detectLanguage() {
      try {
        const saved = localStorage.getItem("proxdmr_language");
        if (saved && this.supportedLanguages.some(l => l.code === saved)) return saved;
      } catch(e) {}
      const nav = (navigator.language || navigator.userLanguage || "").slice(0, 2).toLowerCase();
      if (this.supportedLanguages.some(l => l.code === nav)) return nav;
      return "ru";
    }

    // ── Fetch single language JSON ────────────────────────────────────────────
    async _fetchLang(lang) {
      if (this.loadedFiles[lang]) return true;
      try {
        const resp = await fetch(`${LOCALES_BASE}${lang}.json?v=${LOCALES_VER}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        this.translations[lang] = Object.assign({}, this.translations[lang] || {}, data);
        this.loadedFiles[lang] = true;
        return true;
      } catch (e) {
        console.warn(`[i18n] Could not load ${lang}.json:`, e.message);
        this.loadedFiles[lang] = true; // don't retry
        return false;
      }
    }

    // ── Init: load current language + fallback in parallel ───────────────────
    async init() {
      const toLoad = [this._fetchLang(this.currentLang)];
      if (this.currentLang !== FALLBACK_LANG) toLoad.push(this._fetchLang(FALLBACK_LANG));
      await Promise.all(toLoad);
      this.apply();
      this.populateLanguageSelect();
      this.notify();
      if (window.AndroidBridge && typeof window.AndroidBridge.setAppLanguage === "function") {
        try { window.AndroidBridge.setAppLanguage(this.currentLang); } catch (_) {}
      }
    }

    // ── Translate ─────────────────────────────────────────────────────────────
    t(key, params = {}, fallback = "") {
      const dict     = this.translations[this.currentLang] || {};
      const fallDict = this.translations[FALLBACK_LANG]    || {};
      let str = dict[key] ?? fallDict[key] ?? fallback ?? key;
      if (params && typeof params === "object") {
        for (const [k, v] of Object.entries(params)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), v);
        }
      }
      return str;
    }

    // ── Apply translations to DOM ─────────────────────────────────────────────
    apply(rootElement) {
      const root = rootElement || document;

      root.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (!key) return;
        const val = this.t(key);
        if (val && val !== key) el.innerHTML = val;
      });

      root.querySelectorAll("[data-i18n-html]").forEach(el => {
        const key = el.getAttribute("data-i18n-html");
        if (!key) return;
        const val = this.t(key);
        if (val && val !== key) el.innerHTML = val;
      });

      root.querySelectorAll("[data-i18n-title]").forEach(el => {
        const key = el.getAttribute("data-i18n-title");
        if (!key) return;
        const val = this.t(key);
        if (val && val !== key) el.setAttribute("title", val);
      });

      root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
        const key = el.getAttribute("data-i18n-placeholder");
        if (!key) return;
        const val = this.t(key);
        if (val && val !== key) el.setAttribute("placeholder", val);
      });

      root.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
        const key = el.getAttribute("data-i18n-aria-label");
        if (!key) return;
        const val = this.t(key);
        if (val && val !== key) el.setAttribute("aria-label", val);
      });
    }

    // ── Set language (async, called from ws.js / language.js) ─────────────────
    async setLanguage(langCode) {
      if (!this.supportedLanguages.some(l => l.code === langCode)) {
        console.warn(`[i18n] Unknown language: ${langCode}`);
        return;
      }
      this.currentLang = langCode;
      try { localStorage.setItem("proxdmr_language", langCode); } catch(e) {}

      await this._fetchLang(langCode);
      this.apply();
      this.populateLanguageSelect();
      this.notify();
      if (window.AndroidBridge && typeof window.AndroidBridge.setAppLanguage === "function") {
        try { window.AndroidBridge.setAppLanguage(langCode); } catch (_) {}
      }
    }

    // ── Register external language (plugin API, backward compat) ─────────────
    registerLanguage(code, name, flag, translations = null) {
      if (!this.supportedLanguages.some(l => l.code === code)) {
        this.supportedLanguages.push({ code, name, flag });
      }
      if (translations) {
        this.translations[code] = Object.assign({}, this.translations[code] || {}, translations);
        this.loadedFiles[code] = true;
      }
      this.populateLanguageSelect();
    }

    // ── Backward compat: loadLanguageFile (used nowhere internally now) ───────
    async loadLanguageFile(langCode) {
      return this._fetchLang(langCode);
    }

    // ── Populate <select> elements ────────────────────────────────────────────
    populateLanguageSelect() {
      const selects = document.querySelectorAll("#optLanguage, .language-selector");
      selects.forEach(select => {
        if (!select) return;
        select.innerHTML = "";
        this.supportedLanguages.forEach(lang => {
          const opt = document.createElement("option");
          opt.value = lang.code;
          opt.textContent = `${lang.flag} ${lang.name}`;
          if (lang.code === this.currentLang) opt.selected = true;
          select.appendChild(opt);
        });
      });
    }

    // ── Event listeners ───────────────────────────────────────────────────────
    onLanguageChange(callback) {
      if (typeof callback === "function") this.listeners.push(callback);
    }

    notify() {
      this.listeners.forEach(cb => {
        try { cb(this.currentLang); } catch(e) { console.error("[i18n] listener error:", e); }
      });
      try {
        window.dispatchEvent(new CustomEvent("languageChanged", { detail: { lang: this.currentLang } }));
      } catch(e) {}
    }
  }

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  const i18n = new I18nEngine();

  // Expose both spellings for full backward compat
  window.I18N  = i18n;
  window.i18n  = i18n;
  window.t     = (key, params, fallback) => i18n.t(key, params, fallback);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => i18n.init());
  } else {
    i18n.init();
  }
})();
