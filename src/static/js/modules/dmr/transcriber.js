import { getCountryInfo, getFlagBadgeHtml, formatCallerDisplay } from '../core/formatters.js';
import { showToast } from '../core/toast.js';
import {
  formatCaptionHtml,
  renderTranscriptionSummary,
  updateLogTranscriptionPopoverIfActive
} from './transcription.js';
import { resolveHotspotId, scheduleSyncClientSettings, pushNavState } from '../core/state.js';
import { getHotspotMute, setHotspotMute, getSoloMutedSet, saveSoloMutedSet, updateHotspotCardMuteUI } from '../audio/routing.js';
import { triggerHaptic } from '../core/haptic.js';

/**
 * ProxDMR AI Speech Transcriber & Teleprompter Module
 * Handles Gemini model selection, slot transcribe buttons, live speech caption streams, and settings
 */

function getWs() {
  return window.ws;
}

function openHotspotSettings(hs, tab) {
  if (typeof window.openHotspotSettings === "function") {
    return window.openHotspotSettings(hs, tab);
  }
}

function pruneHeardCalls() {
  if (typeof window.pruneHeardCalls === "function") {
    return window.pruneHeardCalls();
  }
}

function renderLogList() {
  if (typeof window.renderLogList === "function") {
    return window.renderLogList();
  }
}

// --- AI Speech Transcriber & Teleprompter Functions ---

window.transcriberSettings = {
  enabled: true,
  api_key: "",
  model: "gemini-3.5-flash",
  target_lang: "ru",
  tts_enabled: false,
  tts_engine: "piper",
  tts_model: "gemini-3.1-flash-tts-preview",
  tts_voice: "ru_RU-terra5871-medium",
  tts_speed: 1.0,
  tts_ducking_level: 0.03,
  tts_pause_ducking_level: 0.13,
  tts_mute_others: true,
  tts_announce_callsign: true
};

export const TTS_TEST_PHRASES = {
  ru: "Всем радиолюбителям, семьдесят три! Проверка голосового синтеза ProxDMR.",
  en: "To all radio amateurs, seventy-three! ProxDMR voice synthesis test.",
  uk: "Всім радіоаматорам, сімдесят три! Перевірка голосового синтезу ProxDMR.",
  de: "An alle Funkamateure, dreiundsiebzig! Test der ProxDMR-Sprachausgabe.",
  fr: "À tous les radioamateurs, soixante-treize ! Test de synthèse vocale ProxDMR.",
  es: "A todos los radioaficionados, setenta y tres! Prueba de síntesis de voz ProxDMR.",
  it: "A tutti i radioamatori, settantatré! Test di sintesi vocale ProxDMR.",
  pl: "Do wszystkich krótkofalowców, 73! Test syntezy mowy ProxDMR.",
  pt: "A todos os radioamadores, 73! Teste de síntese de voz ProxDMR.",
  nl: "Aan alle zendamateurs, 73! Test van ProxDMR-spraaksynthese.",
  tr: "Tüm amatör telsizcilere, 73! ProxDMR ses sentezi testi.",
  ja: "すべてのアマチュア無線家の皆様、73！ProxDMR音声合成テストです。",
  zh: "致全体业余无线电爱好者，73！ProxDMR语音合成测试。",
  ko: "모든 아마추어 무선사 여러분, 73! ProxDMR 음성 합성 테스트입니다.",
  cs: "Všem radioamatérům, 73! Test hlasové syntézy ProxDMR.",
  ro: "Către toți radioamatorii, 73! Test de sinteză vocală ProxDMR.",
  bg: "До всички радиолюбители, 73! Проверка на гласовия синтез ProxDMR.",
  el: "Προς όλους τους ραδιοερασιτέχνες, 73! Δοκιμή σύνθεσης φωνής ProxDMR.",
  hu: "Minden rádióamatőrnek, 73! A ProxDMR beszédszintézis tesztje.",
  sv: "Till alla radioamatörer, 73! Test av ProxDMR-talsyntes.",
  no: "Til alle radioamatører, 73! Test av ProxDMR-talesyntese.",
  fi: "Kaikille radioamatööreille, 73! ProxDMR-puhesynteesitesti.",
  da: "Til alle radioamatører, 73! Test af ProxDMR-talesyntese.",
  he: "לכל חובבי הרדיו, 73! בדיקת סינתזת דיבור ProxDMR.",
  ar: "إلى جميع هواة اللاسلكي، 73! اختبار تركيب الصوت ProxDMR."
};

export function cleanTextForClientTts(text, lang = "ru") {
  if (!text) return "";
  let s = String(text);
  s = s.replace(/<call>[^<]*<\/call>/gi, "");
  const l = (lang || "ru").substring(0, 2).toLowerCase();
  if (l === "ru" || l === "uk" || l === "bg") {
    s = s.replace(/\b73\b/g, "семьдесят три");
    s = s.replace(/\b88\b/g, "восемьдесят восемь");
  } else if (l === "fr") {
    s = s.replace(/\b73\b/g, "soixante-treize");
    s = s.replace(/\b88\b/g, "quatre-vingt-huit");
  } else if (l === "de") {
    s = s.replace(/\b73\b/g, "dreiundsiebzig");
    s = s.replace(/\b88\b/g, "achtundachtzig");
  } else if (l === "es") {
    s = s.replace(/\b73\b/g, "setenta y tres");
    s = s.replace(/\b88\b/g, "ochenta y ocho");
  } else if (l === "it") {
    s = s.replace(/\b73\b/g, "settantatré");
    s = s.replace(/\b88\b/g, "ottantotto");
  } else {
    s = s.replace(/\b73\b/g, "seventy-three");
    s = s.replace(/\b88\b/g, "eighty-eight");
  }
  return s.trim();
}
window.cleanTextForClientTts = cleanTextForClientTts;

export const BCP47_LANG_MAP = {
  ru: "ru-RU",
  en: "en-US",
  uk: "uk-UA",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  it: "it-IT",
  pl: "pl-PL",
  pt: "pt-PT",
  nl: "nl-NL",
  tr: "tr-TR",
  ja: "ja-JP",
  zh: "zh-CN",
  ko: "ko-KR",
  cs: "cs-CZ",
  ro: "ro-RO",
  bg: "bg-BG",
  el: "el-GR",
  hu: "hu-HU",
  sv: "sv-SE",
  no: "nb-NO",
  fi: "fi-FI",
  da: "da-DK",
  he: "he-IL",
  ar: "ar-SA"
};

export function getTtsTestPhrase(lang = null) {
  const uiLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) ||
                 (typeof localStorage !== "undefined" && localStorage.getItem("proxdmr_language")) ||
                 "ru";
  const code = (lang || uiLang || "ru").toLowerCase().trim();
  if (typeof window !== "undefined" && window.t && (!lang || code === uiLang)) {
    const fromI18n = window.t("transcriber.tts_test_phrase");
    if (fromI18n && fromI18n !== "transcriber.tts_test_phrase") {
      return fromI18n;
    }
  }
  return TTS_TEST_PHRASES[code] || TTS_TEST_PHRASES[uiLang] || TTS_TEST_PHRASES.en || TTS_TEST_PHRASES.ru;
}
window.getTtsTestPhrase = getTtsTestPhrase;

/**
 * Formats raw Gemini / TTS API errors into a short, clean, user-friendly localized message.
 * Never dumps raw JSON or technical stack traces to screen.
 * @param {string|object} rawError
 * @param {"tts"|"transcribe"} context
 * @returns {string} Clean localized message
 */
function formatGeminiError(rawError, context = "tts") {
  let errStr = "";
  if (!rawError) {
    errStr = "";
  } else if (typeof rawError === "string") {
    errStr = rawError;
  } else if (typeof rawError === "object") {
    errStr = rawError.message || rawError.detail || rawError.error || JSON.stringify(rawError);
  }
  const low = (errStr || "").toLowerCase();

  // 1. Quota / Rate limit (RESOURCE_EXHAUSTED / 429)
  if (
    low.includes("resource_exhausted") ||
    low.includes("429") ||
    low.includes("quota") ||
    low.includes("rate_limit") ||
    low.includes("rate-limit") ||
    low.includes("exceeded your current quota")
  ) {
    const retryMatch = errStr.match(/(?:retry\s+in|retry\s+after)\s+([\d\.]+)\s*s?/i);
    if (retryMatch && retryMatch[1]) {
      const sec = Math.ceil(parseFloat(retryMatch[1]));
      if (!isNaN(sec) && sec > 0) {
        if (typeof window.t === "function") {
          const trans = window.t("gemini_err.quota_retry", { sec });
          if (trans && trans !== "gemini_err.quota_retry") return trans;
        }
        const lang = (window.I18N && window.I18N.currentLang) || "ru";
        if (lang === "en") return `API quota exceeded (retry in ${sec}s)`;
        if (lang === "uk") return `Вичерпано ліміт API (повтор через ${sec} с)`;
        if (lang === "de") return `API-Kontingent erschöpft (in ${sec}s wiederholen)`;
        if (lang === "fr") return `Quota API dépassé (réessayer dans ${sec}s)`;
        if (lang === "it") return `Quota API esaurita (riprova tra ${sec}s)`;
        return `Исчерпан лимит API (повтор через ${sec} с)`;
      }
    }
    if (typeof window.t === "function") {
      const trans = window.t("gemini_err.quota");
      if (trans && trans !== "gemini_err.quota") return trans;
    }
    const lang = (window.I18N && window.I18N.currentLang) || "ru";
    if (lang === "en") return "API quota exceeded";
    if (lang === "uk") return "Вичерпано ліміт API";
    if (lang === "de") return "API-Kontingent erschöpft";
    if (lang === "fr") return "Quota API dépassé";
    if (lang === "it") return "Quota API esaurita";
    return "Исчерпан лимит API";
  }

  // 2. Overloaded server (503 / UNAVAILABLE / high demand)
  if (
    low.includes("503") ||
    low.includes("unavailable") ||
    low.includes("overloaded") ||
    low.includes("high demand") ||
    low.includes("temporarily unavailable")
  ) {
    if (typeof window.t === "function") {
      const trans = window.t("gemini_err.overloaded");
      if (trans && trans !== "gemini_err.overloaded") return trans;
    }
    const lang = (window.I18N && window.I18N.currentLang) || "ru";
    if (lang === "en") return "Server overloaded, please retry later";
    if (lang === "uk") return "Сервер перевантажений, повторіть пізніше";
    if (lang === "de") return "Server überlastet, bitte später versuchen";
    if (lang === "fr") return "Serveur surchargé, réessayez plus tard";
    if (lang === "it") return "Server sovraccarico, riprova più tardi";
    return "Сервер перегружен, повторите позже";
  }

  // 3. Invalid API key (API_KEY_INVALID / 400 / key not valid)
  if (
    low.includes("api_key_invalid") ||
    low.includes("api key not valid") ||
    low.includes("invalid api key") ||
    low.includes("key expired") ||
    low.includes("не указан api ключ")
  ) {
    if (typeof window.t === "function") {
      const trans = window.t("gemini_err.invalid_key");
      if (trans && trans !== "gemini_err.invalid_key") return trans;
    }
    const lang = (window.I18N && window.I18N.currentLang) || "ru";
    if (lang === "en") return "Invalid API key";
    if (lang === "uk") return "Невірний ключ API";
    if (lang === "de") return "Ungültiger API-Schlüssel";
    if (lang === "fr") return "Clé API invalide";
    if (lang === "it") return "Chiave API non valida";
    return "Неверный API ключ";
  }

  // 4. Permission Denied (403 / PERMISSION_DENIED)
  if (
    low.includes("permission_denied") ||
    low.includes("403") ||
    low.includes("access denied") ||
    low.includes("forbidden")
  ) {
    if (typeof window.t === "function") {
      const trans = window.t("gemini_err.permission_denied");
      if (trans && trans !== "gemini_err.permission_denied") return trans;
    }
    const lang = (window.I18N && window.I18N.currentLang) || "ru";
    if (lang === "en") return "Access denied (check API key)";
    if (lang === "uk") return "Доступ заборонено (перевірте ключ API)";
    if (lang === "de") return "Zugriff verweigert (API-Schlüssel prüfen)";
    if (lang === "fr") return "Accès refusé (vérifiez la clé API)";
    if (lang === "it") return "Accesso negato (controlla la chiave API)";
    return "Доступ запрещен (проверьте ключ API)";
  }

  // 5. Model Not Found / Unsupported (404 / NOT_FOUND)
  if (
    low.includes("not_found") ||
    low.includes("404") ||
    low.includes("not found") ||
    low.includes("not supported for this model")
  ) {
    if (typeof window.t === "function") {
      const trans = window.t("gemini_err.model_not_found");
      if (trans && trans !== "gemini_err.model_not_found") return trans;
    }
    const lang = (window.I18N && window.I18N.currentLang) || "ru";
    if (lang === "en") return "Model unavailable or not found";
    if (lang === "uk") return "Модель недоступна або не знайдена";
    if (lang === "de") return "Modell nicht verfügbar oder nicht gefunden";
    if (lang === "fr") return "Modèle indisponible ou introuvable";
    if (lang === "it") return "Modello non disponibile o non trovato";
    return "Модель недоступна или не найдена";
  }

  // 6. Timeout (504 / DEADLINE_EXCEEDED / timeout)
  if (
    low.includes("deadline_exceeded") ||
    low.includes("504") ||
    low.includes("timeout") ||
    low.includes("таймаут")
  ) {
    if (typeof window.t === "function") {
      const trans = window.t("gemini_err.timeout");
      if (trans && trans !== "gemini_err.timeout") return trans;
    }
    const lang = (window.I18N && window.I18N.currentLang) || "ru";
    if (lang === "en") return "Server connection timeout";
    if (lang === "uk") return "Таймаут з'єднання з сервером";
    if (lang === "de") return "Server-Verbindungs-Timeout";
    if (lang === "fr") return "Délai de connexion dépassé";
    if (lang === "it") return "Timeout connessione al server";
    return "Таймаут соединения с сервером";
  }

  // 7. Network / connection
  if (
    low.includes("network") ||
    low.includes("сеть") ||
    low.includes("сетев") ||
    low.includes("urlerror") ||
    low.includes("failed to fetch") ||
    low.includes("connection refused") ||
    low.includes("econnrefused")
  ) {
    if (typeof window.t === "function") {
      const trans = window.t("gemini_err.network");
      if (trans && trans !== "gemini_err.network") return trans;
    }
    const lang = (window.I18N && window.I18N.currentLang) || "ru";
    if (lang === "en") return "Network or connection error";
    if (lang === "uk") return "Помилка мережі або з'єднання";
    if (lang === "de") return "Netzwerk- oder Verbindungsfehler";
    if (lang === "fr") return "Erreur de réseau ou de connexion";
    if (lang === "it") return "Errore di rete o di connessione";
    return "Ошибка сети или соединения";
  }

  // 8. Safety Filter Block
  if (
    low.includes("safety") ||
    low.includes("blockreason") ||
    low.includes("блокировк") ||
    low.includes("фильтр")
  ) {
    if (typeof window.t === "function") {
      const trans = window.t("gemini_err.safety");
      if (trans && trans !== "gemini_err.safety") return trans;
    }
    const lang = (window.I18N && window.I18N.currentLang) || "ru";
    if (lang === "en") return "Blocked by safety filter";
    if (lang === "uk") return "Заблоковано фільтром безпеки";
    if (lang === "de") return "Durch Sicherheitsfilter blockiert";
    if (lang === "fr") return "Bloqué par le filtre de sécurité";
    if (lang === "it") return "Bloccato dal filtre de sécurité";
    return "Заблокировано фильтром безопасности";
  }

  // 9. Internal error (500 / INTERNAL)
  if (low.includes("500") || low.includes("internal")) {
    if (typeof window.t === "function") {
      const trans = window.t("gemini_err.internal");
      if (trans && trans !== "gemini_err.internal") return trans;
    }
    const lang = (window.I18N && window.I18N.currentLang) || "ru";
    if (lang === "en") return "Internal Gemini server error";
    if (lang === "uk") return "Внутрішня помилка сервера Gemini";
    if (lang === "de") return "Interner Gemini-Serverfehler";
    if (lang === "fr") return "Erreur interne du serveur Gemini";
    if (lang === "it") return "Errore interno del server Gemini";
    return "Внутренняя ошибка сервера Gemini";
  }

  // 10. Default fallback
  const fallbackKey = (context === "transcribe") ? "gemini_err.transcribe_fail" : "gemini_err.tts_fail";
  if (typeof window.t === "function") {
    const trans = window.t(fallbackKey);
    if (trans && trans !== fallbackKey) return trans;
  }
  const lang = (window.I18N && window.I18N.currentLang) || "ru";
  if (context === "transcribe") {
    if (lang === "en") return "Speech recognition error";
    if (lang === "uk") return "Збій розпізнавання мовлення";
    if (lang === "de") return "Spracherkennungsfehler";
    if (lang === "fr") return "Erreur de reconnaissance vocale";
    if (lang === "it") return "Errore di riconoscimento vocale";
    return "Сбой распознавания речи";
  } else {
    if (lang === "en") return "Speech synthesis error";
    if (lang === "uk") return "Збій синтезу мовлення";
    if (lang === "de") return "Sprachsynthesefehler";
    if (lang === "fr") return "Échec de la synthèse vocale";
    if (lang === "it") return "Errore di sintesi vocale";
    return "Сбой синтеза речи";
  }
}
window.formatGeminiError = formatGeminiError;
if (window.__proxdmr) window.__proxdmr.formatGeminiError = formatGeminiError;

export function resolveCurrentTargetLang() {
  const optNoTranslate = document.getElementById("optTranscriberNoTranslate");
  const optTargetLang = document.getElementById("optTranscriberTargetLang");
  if (optNoTranslate && optNoTranslate.checked) {
    return "ru";
  }
  if (optTargetLang && optTargetLang.value && optTargetLang.value !== "none") {
    return optTargetLang.value;
  }
  if (window.transcriberSettings && window.transcriberSettings.target_lang && window.transcriberSettings.target_lang !== "none") {
    return window.transcriberSettings.target_lang;
  }
  return "ru";
}
window.resolveCurrentTargetLang = resolveCurrentTargetLang;

const SUPPORTED_TARGET_LANGUAGES = [
  { code: "en", flag: "🇬🇧", native: "English" },
  { code: "uk", flag: "🇺🇦", native: "Українська" },
  { code: "de", flag: "🇩🇪", native: "Deutsch" },
  { code: "fr", flag: "🇫🇷", native: "Français" },
  { code: "es", flag: "🇪🇸", native: "Español" },
  { code: "it", flag: "🇮🇹", native: "Italiano" },
  { code: "ru", flag: "🇷🇺", native: "Русский" },
  { code: "pl", flag: "🇵🇱", native: "Polski" },
  { code: "pt", flag: "🇵🇹", native: "Português" },
  { code: "nl", flag: "🇳🇱", native: "Nederlands" },
  { code: "tr", flag: "🇹🇷", native: "Türkçe" },
  { code: "ja", flag: "🇯🇵", native: "日本語" },
  { code: "zh", flag: "🇨🇳", native: "中文" },
  { code: "ko", flag: "🇰🇷", native: "한국어" },
  { code: "cs", flag: "🇨🇿", native: "Čeština" },
  { code: "ro", flag: "🇷🇴", native: "Română" },
  { code: "bg", flag: "🇧🇬", native: "Български" },
  { code: "el", flag: "🇬🇷", native: "Ελληνικά" },
  { code: "hu", flag: "🇭🇺", native: "Magyar" },
  { code: "sv", flag: "🇸🇪", native: "Svenska" },
  { code: "no", flag: "🇳🇴", native: "Norsk" },
  { code: "fi", flag: "🇫🇮", native: "Suomi" },
  { code: "da", flag: "🇩🇰", native: "Dansk" },
  { code: "he", flag: "🇮🇱", native: "עברית" },
  { code: "ar", flag: "🇸🇦", native: "العربية" }
];

const LANG_3LETTER_MAP = {
  "ru": "RUS",
  "en": "ENG",
  "uk": "UKR",
  "de": "DEU",
  "fr": "FRA",
  "es": "ESP",
  "it": "ITA",
  "pl": "POL",
  "pt": "POR",
  "nl": "NLD",
  "tr": "TUR",
  "ja": "JPN",
  "zh": "CHN",
  "ko": "KOR",
  "cs": "CZE",
  "ro": "RON",
  "bg": "BUL",
  "el": "GRE",
  "hu": "HUN",
  "sv": "SWE",
  "no": "NOR",
  "fi": "FIN",
  "da": "DAN",
  "he": "HEB",
  "ar": "ARA",
  "none": "RAW"
};

function get3LetterLangCode(code) {
  if (!code) return "RUS";
  const c = String(code).trim().toLowerCase();
  if (c === "none" || c === "off" || c === "raw" || c === "direct") return "RAW";
  if (LANG_3LETTER_MAP[c]) return LANG_3LETTER_MAP[c];
  if (c.length === 2 && LANG_3LETTER_MAP[c]) return LANG_3LETTER_MAP[c];
  if (c.length === 3) return c.toUpperCase();
  return c.slice(0, 3).toUpperCase();
}
window.get3LetterLangCode = get3LetterLangCode;
window.LANG_3LETTER_MAP = LANG_3LETTER_MAP;

function renderTargetLangSelect(selectEl) {
  const el = selectEl || document.getElementById("optTranscriberTargetLang");
  if (!el) return;
  const curVal = el.value || (window.transcriberSettings && window.transcriberSettings.target_lang) || "ru";
  const curLang = (window.I18N && window.I18N.currentLanguage) || "ru";
  let langDisplay = null;
  try {
    langDisplay = new Intl.DisplayNames([curLang], { type: 'language' });
  } catch (_) {}

  el.innerHTML = "";
  SUPPORTED_TARGET_LANGUAGES.forEach(l => {
    const opt = document.createElement("option");
    opt.value = l.code;
    let localizedName = "";
    if (langDisplay) {
      try {
        const trans = langDisplay.of(l.code);
        if (trans) {
          localizedName = trans.charAt(0).toUpperCase() + trans.slice(1);
        }
      } catch (_) {}
    }
    if (localizedName && localizedName.toLowerCase() !== l.native.toLowerCase()) {
      opt.textContent = `${l.flag} ${l.native} (${localizedName})`;
    } else {
      opt.textContent = `${l.flag} ${l.native}`;
    }
    if (l.code === curVal) {
      opt.selected = true;
    }
    el.appendChild(opt);
  });
  if (curVal && curVal !== "none" && !Array.from(el.options).some(o => o.value === curVal)) {
    const opt = document.createElement("option");
    opt.value = curVal;
    opt.textContent = curVal.toUpperCase();
    opt.selected = true;
    el.appendChild(opt);
  }
}
window.renderTargetLangSelect = renderTargetLangSelect;

function safeEscapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getSlotTranscribeKey(hid, slot) {
  return `proxdmr_transcribe_${resolveHotspotId(hid)}_ts${slot}`;
}

function isSlotTranscribeActive(hid, slot) {
  const key = getSlotTranscribeKey(hid, slot);
  const val = localStorage.getItem(key);
  if (val !== null) return val === "1";
  // Migration: fallback to legacy global key if on default hotspot
  const legacy = localStorage.getItem(`proxdmr_transcribe_ts${slot}`);
  if (legacy === "1" && resolveHotspotId(hid) === "default") {
    return true;
  }
  return false;
}

// ── Slot TTS (Voice Synthesis) Helpers ─────────────────────────────────────
function getSlotTtsKey(hid, slot) {
  return `proxdmr_tts_${resolveHotspotId(hid)}_ts${slot}`;
}

function isSlotTtsActive(hid, slot) {
  try {
    const key = getSlotTtsKey(hid, slot);
    const val = localStorage.getItem(key);
    if (val !== null) return val === "1";
    const legacy = localStorage.getItem(`proxdmr_tts_ts${slot}`);
    if (legacy === "1" && resolveHotspotId(hid) === "default") {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function updateSlotTtsBadge(row, slot, isActive, customLangCode = null) {
  if (!row) return;
  const ttsBadge = row.querySelector(".vfo-tts-badge");
  if (!ttsBadge) return;

  let lang3 = "RUS";
  if (customLangCode) {
    lang3 = get3LetterLangCode(customLangCode);
  } else {
    const s = window.transcriberSettings || {};
    const isNoTranslate = (s.target_lang === "none") || (document.getElementById("optTranscriberNoTranslate")?.checked) || false;
    if (isNoTranslate) {
      lang3 = "RAW";
    } else if (s.target_lang && s.target_lang !== "none") {
      lang3 = get3LetterLangCode(s.target_lang);
    } else {
      const optTl = document.getElementById("optTranscriberTargetLang");
      lang3 = get3LetterLangCode((optTl && optTl.value && optTl.value !== "none") ? optTl.value : "ru");
    }
  }

  let codeSpan = ttsBadge.querySelector(".tts-lang-code");
  let spkSpan = ttsBadge.querySelector(".tts-icon-spk");
  if (!codeSpan || !spkSpan || ttsBadge.querySelector(".tts-icon-globe")) {
    ttsBadge.innerHTML = `<span class="tts-icon-spk">🔊</span><span class="tts-lang-code">${lang3}</span>`;
  } else {
    codeSpan.textContent = lang3;
  }

  ttsBadge.classList.toggle("tts-on", Boolean(isActive));
  const langTitleStr = lang3 === "RAW" ? "RAW" : lang3;
  ttsBadge.title = isActive
    ? (window.t ? window.t("transcriber.tts_badge_active_hint", { slot, lang: langTitleStr }, `Озвучка речи TS${slot} [${langTitleStr}] включена (клик — выключить, удержание — настройки)`) : `Озвучка речи TS${slot} [${langTitleStr}] включена (клик — выключить, удержание — настройки)`)
    : (window.t ? window.t("transcriber.tts_badge_inactive_hint", { slot, lang: langTitleStr }, `Озвучка речи TS${slot} [${langTitleStr}]: клик — вкл/выкл, удержание — настройки`) : `Озвучка речи TS${slot} [${langTitleStr}]: клик — вкл/выкл, удержание — настройки`);
}

function refreshAllSlotTtsBadges(customLangCode = null) {
  document.querySelectorAll(".vfo-row[data-slot]").forEach(row => {
    const slot = parseInt(row.dataset.slot, 10);
    const card = row.closest(".radio-container");
    const cid = resolveHotspotId(card ? card.dataset.hotspotId : window.activeHotspotId);
    const active = isSlotTtsActive(cid, slot);
    updateSlotTtsBadge(row, slot, active, customLangCode);
  });

  // Also update recordings player TTS button (#recTtsBtn)
  const recTtsBtn = document.getElementById("recTtsBtn");
  if (recTtsBtn) {
    let recLang3 = "RUS";
    if (customLangCode) {
      recLang3 = get3LetterLangCode(customLangCode);
    } else {
      const s = window.transcriberSettings || {};
      const isNoTranslate = (s.target_lang === "none") || (document.getElementById("optTranscriberNoTranslate")?.checked) || false;
      if (isNoTranslate) {
        recLang3 = "RAW";
      } else if (s.target_lang && s.target_lang !== "none") {
        recLang3 = get3LetterLangCode(s.target_lang);
      } else {
        const optTl = document.getElementById("optTranscriberTargetLang");
        recLang3 = get3LetterLangCode((optTl && optTl.value && optTl.value !== "none") ? optTl.value : "ru");
      }
    }
    const recLangSpan = recTtsBtn.querySelector(".rec-tts-lang");
    if (recLangSpan) {
      recLangSpan.textContent = recLang3;
    } else {
      recTtsBtn.innerHTML = `<span class="rec-tts-spk">🔊</span><span class="rec-tts-lang">${recLang3}</span>`;
    }
    recTtsBtn.title = window.t
      ? window.t("recordings.tts_play_title", { lang: recLang3 }, `Озвучить перевод [${recLang3}] синтезатором речи (удержание: настройки)`)
      : `Озвучить перевод [${recLang3}] синтезатором речи (удержание: настройки)`;

    if (typeof setupRecTtsButton === "function") {
      setupRecTtsButton();
    }
  }

  syncTtsSoloMode();
}
window.refreshAllSlotTtsBadges = refreshAllSlotTtsBadges;
if (window.__proxdmr) window.__proxdmr.refreshAllSlotTtsBadges = refreshAllSlotTtsBadges;

/**
 * Synchronizes TTS Solo Mode across all audio channels/slots.
 * When Solo mode is active and any slot has TTS turned ON:
 * - All other channels across all hotspots are muted immediately (setHotspotMute(hid, slot, true))
 *   and their VFO mute buttons display 🔇.
 * - Only the active TTS translation slot(s) remain unmuted.
 * - When TTS is turned OFF on that slot (or Solo mode is unchecked), all channels that were
 *   muted specifically by Solo mode are restored/unmuted back to their previous state.
 * - Pre-existing manual mutes set prior to Solo mode are preserved.
 */
function syncTtsSoloMode() {
  const s = window.transcriberSettings || {};
  const soloEnabled = (s.tts_mute_others !== false);

  const soloSet = (typeof getSoloMutedSet === "function") ? getSoloMutedSet() : (window._ttsSoloMutedSlots || new Set());

  // 1. Gather all hotspots
  const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
  const hidSet = new Set();
  hidSet.add(resolveHotspotId("default"));
  if (Array.isArray(hsList)) {
    hsList.forEach(hs => {
      if (hs && hs.id) hidSet.add(resolveHotspotId(hs.id));
    });
  }
  if (typeof document !== "undefined") {
    document.querySelectorAll(".radio-container[data-hotspot-id]").forEach(el => {
      if (el.dataset.hotspotId) hidSet.add(resolveHotspotId(el.dataset.hotspotId));
    });
  }

  // 2. Find which slots have TTS active
  const activeTtsSlots = [];
  hidSet.forEach(hid => {
    [1, 2].forEach(slot => {
      if (isSlotTtsActive(hid, slot)) {
        activeTtsSlots.push({ hid, slot, key: `${hid}_ts${slot}` });
      }
    });
  });

  const shouldSolo = soloEnabled && (activeTtsSlots.length > 0);

  if (shouldSolo) {
    // Solo is active!
    hidSet.forEach(hid => {
      [1, 2].forEach(slot => {
        const slotKey = `${hid}_ts${slot}`;
        const isTts = activeTtsSlots.some(t => t.hid === hid && t.slot === slot);

        if (isTts) {
          // This is a speech translation channel.
          // Ensure it is NOT marked in soloSet
          if (soloSet.has(slotKey)) {
            soloSet.delete(slotKey);
          }
          if (getHotspotMute(hid, slot)) {
            setHotspotMute(hid, slot, false);
          }
        } else {
          // This is an other channel.
          // If not already muted, mute it and record in soloSet!
          const currentlyMuted = getHotspotMute(hid, slot);
          if (!currentlyMuted) {
            soloSet.add(slotKey);
            setHotspotMute(hid, slot, true);
          }
        }
      });
    });
    if (typeof saveSoloMutedSet === "function") {
      saveSoloMutedSet(soloSet);
    }
  } else {
    // Solo is NOT active (either soloEnabled is false or no slots have TTS enabled)
    // Restore all channels that were muted by Solo mode
    if (soloSet.size > 0) {
      const toRestore = Array.from(soloSet);
      soloSet.clear();
      if (typeof saveSoloMutedSet === "function") {
        saveSoloMutedSet(soloSet);
      }
      toRestore.forEach(slotKey => {
        const idx = slotKey.lastIndexOf("_ts");
        if (idx !== -1) {
          const hid = slotKey.substring(0, idx);
          const slot = parseInt(slotKey.substring(idx + 3), 10) || 1;
          setHotspotMute(hid, slot, false);
        }
      });
      if (typeof updateHotspotCardMuteUI === "function") {
        updateHotspotCardMuteUI(null);
      }
    }
  }

  // Also sync idle ducking on player if present
  if (window.ttsAudioQueueManager && typeof window.ttsAudioQueueManager.syncIdleDucking === "function") {
    window.ttsAudioQueueManager.syncIdleDucking(0.12);
  }
}
window.syncTtsSoloMode = syncTtsSoloMode;
if (window.__proxdmr) window.__proxdmr.syncTtsSoloMode = syncTtsSoloMode;


let activeTtsPopoverOverlay = null;
let activeTxtPopoverOverlay = null;

function closeTxtQuickSettingsPopover() {
  if (activeTxtPopoverOverlay) {
    const overlay = activeTxtPopoverOverlay;
    activeTxtPopoverOverlay = null;
    overlay.classList.add("closing");
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, 160);
  }
}

function closeTtsQuickSettingsPopover() {
  if (activeTtsPopoverOverlay) {
    const overlay = activeTtsPopoverOverlay;
    activeTtsPopoverOverlay = null;
    overlay.classList.add("closing");
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, 160);
  }
}

function positionTtsQuickSettingsPopover(popup, targetBadge) {
  if (!popup || !targetBadge) return;
  const badgeRect = targetBadge.getBoundingClientRect();
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  if (screenW <= 520) {
    popup.style.left = "10px";
    popup.style.right = "10px";
    popup.style.width = "auto";
    popup.style.maxWidth = "calc(100vw - 20px)";
    popup.style.bottom = "14px";
    popup.style.top = "auto";
    return;
  }

  const popupRect = popup.getBoundingClientRect();
  const popupW = popupRect.width || 330;
  const popupH = popupRect.height || 360;

  let top = badgeRect.bottom + 6;
  let left = badgeRect.right - popupW;

  if (top + popupH > screenH - 12) {
    top = Math.max(12, badgeRect.top - popupH - 6);
  }
  if (left < 10) {
    left = Math.max(10, badgeRect.left);
  }
  if (left + popupW > screenW - 10) {
    left = screenW - popupW - 10;
  }

  popup.style.top = `${Math.round(top)}px`;
  popup.style.left = `${Math.round(left)}px`;
  popup.style.right = "auto";
  popup.style.bottom = "auto";
}

function getGeminiTtsVoices() {
  return [
    { value: "auto", label: window.t ? window.t("transcriber.voice_auto", {}, "✨ Авто (по полу и тембру оператора)") : "✨ Авто (по полу и тембру оператора)" },
    { value: "Puck", label: window.t ? window.t("transcriber.voice_puck", {}, "Puck — Мужской, бодрый и отчетливый (Upbeat, по умолчанию)") : "Puck — Мужской, бодрый и отчетливый (Upbeat, по умолчанию)" },
    { value: "Charon", label: window.t ? window.t("transcriber.voice_charon", {}, "Charon — Мужской, информативный и уверенный (Informative)") : "Charon — Мужской, информативный и уверенный (Informative)" },
    { value: "Fenrir", label: window.t ? window.t("transcriber.voice_fenrir", {}, "Fenrir — Мужской, энергичный и выразительный (Excitable)") : "Fenrir — Мужской, энергичный и выразительный (Excitable)" },
    { value: "Orus", label: window.t ? window.t("transcriber.voice_orus", {}, "Orus — Мужской, строгий и солидный (Firm)") : "Orus — Мужской, строгий и солидный (Firm)" },
    { value: "Iapetus", label: window.t ? window.t("transcriber.voice_iapetus", {}, "Iapetus — Мужской, чистый и четкий (Clear)") : "Iapetus — Мужской, чистый и четкий (Clear)" },
    { value: "Kore", label: window.t ? window.t("transcriber.voice_kore", {}, "Kore — Женский, уверенный и четкий (Firm)") : "Kore — Женский, уверенный и четкий (Firm)" },
    { value: "Aoede", label: window.t ? window.t("transcriber.voice_aoede", {}, "Aoede — Женский, мягкий и плавный (Breezy)") : "Aoede — Женский, мягкий и плавный (Breezy)" },
    { value: "Leda", label: window.t ? window.t("transcriber.voice_leda", {}, "Leda — Женский, молодой и легкий (Youthful)") : "Leda — Женский, молодой и легкий (Youthful)" },
    { value: "Zephyr", label: window.t ? window.t("transcriber.voice_zephyr", {}, "Zephyr — Женский, яркий и открытый (Bright)") : "Zephyr — Женский, яркий и открытый (Bright)" },
    { value: "Despina", label: window.t ? window.t("transcriber.voice_despina", {}, "Despina — Женский, спокойный и гладкий (Smooth)") : "Despina — Женский, спокойный и гладкий (Smooth)" },
    { value: "Achernar", label: window.t ? window.t("transcriber.voice_achernar", {}, "Achernar — Нейтральный, мягкий диктор (Soft)") : "Achernar — Нейтральный, мягкий диктор (Soft)" },
  ];
}

const GEMINI_TTS_VOICES = getGeminiTtsVoices();

/**
 * Dynamically populates a voice select dropdown based on TTS engine and target language.
 * - Gemini API: list of Gemini voices.
 * - Piper TTS: list of downloaded voices for current target language (or download prompt).
 * - System TTS: empty list.
 */
async function populateVoiceSelect(selectEl, engine, targetLang, currentVoiceValue, hintEl) {
  if (!selectEl) return;
  const eng = engine || "gemini";
  const lang = (targetLang || resolveCurrentTargetLang() || "ru").toLowerCase();

  if (eng === "gemini") {
    selectEl.innerHTML = "";
    selectEl.disabled = false;
    const voices = getGeminiTtsVoices();
    voices.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.value;
      opt.textContent = v.label;
      selectEl.appendChild(opt);
    });
    if (currentVoiceValue && Array.from(selectEl.options).some(o => o.value === currentVoiceValue)) {
      selectEl.value = currentVoiceValue;
    } else {
      selectEl.value = "auto";
    }
    if (hintEl) {
      hintEl.style.display = "none";
      hintEl.textContent = "";
    }
    return;
  }

  if (eng === "browser") {
    selectEl.innerHTML = "";
    selectEl.disabled = true;
    if (hintEl) {
      hintEl.style.display = "block";
      hintEl.textContent = window.t
        ? window.t("transcriber.browser_tts_hint", { lang: lang.toUpperCase() }, `Используется системный голос браузера для языка [${lang.toUpperCase()}].`)
        : `Используется системный голос браузера для языка [${lang.toUpperCase()}].`;
    }
    return;
  }

  if (eng === "piper") {
    selectEl.innerHTML = "";
    const loadingOpt = document.createElement("option");
    loadingOpt.value = "";
    loadingOpt.textContent = window.t ? window.t("transcriber.piper_loading", {}, "⏳ Загрузка списка моделей Piper...") : "⏳ Загрузка списка моделей Piper...";
    selectEl.appendChild(loadingOpt);
    selectEl.disabled = true;

    try {
      const resp = await fetch(`/api/transcriber/piper/check-lang?lang=${encodeURIComponent(lang)}`);
      const data = await resp.json();
      selectEl.innerHTML = "";

      if (data && data.status === "ok") {
        if (data.has_installed && data.installed_voices && data.installed_voices.length > 0) {
          selectEl.disabled = false;
          data.installed_voices.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v.id;
            const gText = v.gender === "female"
              ? (window.t ? window.t("transcriber.gender_female", {}, "Женский") : "Женский")
              : (v.gender === "male" ? (window.t ? window.t("transcriber.gender_male", {}, "Мужской") : "Мужской") : "");
            const qText = v.quality || "medium";
            opt.textContent = `${v.name} — ${gText ? gText + ", " : ""}${qText} (${v.id})`;
            selectEl.appendChild(opt);
          });

          // Show available uninstalled voices for on-demand download
          const uninstalled = (data.available_voices || []).filter(v => !v.installed);
          if (uninstalled.length > 0) {
            uninstalled.forEach(v => {
              const opt = document.createElement("option");
              opt.value = `__download__:${v.id}`;
              const gText = v.gender === "female"
                ? (window.t ? window.t("transcriber.gender_female", {}, "Женский") : "Жен.")
                : (v.gender === "male" ? (window.t ? window.t("transcriber.gender_male", {}, "Мужской") : "Муж.") : "");
              opt.textContent = `⬇️ [Скачать: ${v.name} (${gText ? gText + ", " : ""}${v.quality || "medium"}, ~${v.size_mb || 60} МБ)]`;
              selectEl.appendChild(opt);
            });
          }

          if (currentVoiceValue && Array.from(selectEl.options).some(o => o.value === currentVoiceValue)) {
            selectEl.value = currentVoiceValue;
          } else if (data.default_voice && Array.from(selectEl.options).some(o => o.value === data.default_voice)) {
            selectEl.value = data.default_voice;
          } else {
            selectEl.value = data.installed_voices[0].id;
          }

          if (hintEl) {
            hintEl.style.display = "none";
            hintEl.textContent = "";
          }
        } else if (data.supported) {
          selectEl.disabled = false;
          const opt = document.createElement("option");
          opt.value = "__download__";
          opt.textContent = window.t
            ? window.t("transcriber.piper_download_opt", { lang: lang.toUpperCase(), count: data.available_count }, `⬇️ [Скачать модель для ${lang.toUpperCase()}] (доступно: ${data.available_count})`)
            : `⬇️ [Скачать модель для ${lang.toUpperCase()}] (доступно: ${data.available_count})`;
          selectEl.appendChild(opt);
          if (hintEl) {
            hintEl.style.display = "block";
            hintEl.textContent = window.t
              ? window.t("transcriber.piper_download_hint", { lang: lang.toUpperCase(), count: data.available_count }, `Для языка ${lang.toUpperCase()} есть ${data.available_count} моделей. Нажмите для скачивания.`)
              : `Для языка ${lang.toUpperCase()} есть ${data.available_count} моделей. Нажмите для скачивания.`;
          }
        } else {
          selectEl.disabled = true;
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = window.t
            ? window.t("transcriber.piper_unsupported_opt", { lang: lang.toUpperCase() }, `— Язык [${lang.toUpperCase()}] не поддерживается в Piper —`)
            : `— Язык [${lang.toUpperCase()}] не поддерживается в Piper —`;
          selectEl.appendChild(opt);
          if (hintEl) {
            hintEl.style.display = "block";
            hintEl.textContent = window.t
              ? window.t("transcriber.piper_unsupported_hint", { lang: lang.toUpperCase() }, `Язык «${lang.toUpperCase()}» отсутствует в каталоге Piper. Используйте Gemini API или System TTS.`)
              : `Язык «${lang.toUpperCase()}» отсутствует в каталоге Piper. Используйте Gemini API или System TTS.`;
          }
        }
      } else {
        selectEl.disabled = true;
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = window.t ? window.t("transcriber.piper_load_failed", {}, "— Не удалось загрузить голоса —") : "— Не удалось загрузить голоса —";
        selectEl.appendChild(opt);
      }
    } catch (err) {
      console.error("[PIPER] Failed to fetch voices:", err);
      selectEl.innerHTML = "";
      selectEl.disabled = true;
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = window.t ? window.t("transcriber.piper_net_error", {}, "— Ошибка связи с сервером —") : "— Ошибка связи с сервером —";
      selectEl.appendChild(opt);
    }
  }
}

let _lastTtsDownloadState = { progress: 0, status: "idle", voiceName: "" };

/**
 * Updates the miniature TTS upload indicators (header, settings frame, quick popover) with percentage progress.
 */
export function updateTtsUploadIndicator(progress, status = "running", voiceName = "") {
  _lastTtsDownloadState = { progress, status, voiceName };
  const indicators = document.querySelectorAll(".header-tts-upload-indicator, #headerTtsUploadIndicator, #settingsTtsUploadIndicator, #quickTtsUploadIndicator");
  if (!indicators || indicators.length === 0) return;

  const pct = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));

  indicators.forEach(ind => {
    const percentEl = ind.querySelector(".tts-upload-percent, #headerTtsUploadPercent, #settingsTtsUploadPercent");
    if (ind._hideTimer) {
      clearTimeout(ind._hideTimer);
      ind._hideTimer = null;
    }
    if (status === "running") {
      ind.style.display = "inline-flex";
      if (percentEl) percentEl.textContent = `${pct}%`;
      ind.title = voiceName
        ? `Загрузка голосовой модели Piper (${voiceName}): ${pct}%`
        : `Загрузка голосовой модели Piper TTS: ${pct}%`;
    } else if (status === "completed") {
      ind.style.display = "inline-flex";
      if (percentEl) percentEl.textContent = "100%";
      ind.title = voiceName
        ? `Модель Piper (${voiceName}) успешно установлена`
        : "Модель Piper TTS успешно установлена";
      ind._hideTimer = setTimeout(() => {
        ind.style.display = "none";
        ind._hideTimer = null;
      }, 2500);
    } else if (status === "error") {
      ind.style.display = "inline-flex";
      if (percentEl) percentEl.textContent = "ERR";
      ind.title = `Ошибка загрузки модели Piper: ${voiceName || "сбой"}`;
      ind._hideTimer = setTimeout(() => {
        ind.style.display = "none";
        ind._hideTimer = null;
      }, 3500);
    } else {
      ind.style.display = "none";
    }
  });
}
window.updateTtsUploadIndicator = updateTtsUploadIndicator;

let _piperWatcherStarted = false;
export function initPiperDownloadWatcher() {
  if (_piperWatcherStarted) return;
  _piperWatcherStarted = true;
  let isWatching = false;

  setInterval(async () => {
    try {
      const resp = await fetch("/api/transcriber/piper/download/status");
      const data = await resp.json();
      if (data && data.status === "ok" && data.download) {
        const d = data.download;
        if (d.status === "downloading") {
          isWatching = true;
          updateTtsUploadIndicator(d.progress || 0, "running", d.voice_id);
        } else if (isWatching && d.status === "completed") {
          isWatching = false;
          updateTtsUploadIndicator(100, "completed", d.voice_id);
        } else if (isWatching && d.status === "error") {
          isWatching = false;
          updateTtsUploadIndicator(0, "error", d.error || "Сбой");
        }
      }
    } catch (_) {}
  }, 2500);
}
window.initPiperDownloadWatcher = initPiperDownloadWatcher;

/**
 * Checks if target language is supported by Piper TTS.
 * If not supported, displays an informative prompt offering fallback to Gemini API or System TTS.
 * If supported but model not installed, offers to download the default voice.
 */
async function checkAndPromptPiperModel(lang, onModelDownloaded, onFallbackRequested, targetVoiceId = null) {
  const cleanLang = (lang || resolveCurrentTargetLang() || "ru").toLowerCase().trim();
  try {
    const resp = await fetch(`/api/transcriber/piper/check-lang?lang=${encodeURIComponent(cleanLang)}`);
    const data = await resp.json();
    if (!data || data.status !== "ok") {
      return { ok: false, error: "bad_response" };
    }

    if (!data.supported) {
      const msg = `Язык «${cleanLang.toUpperCase()}» отсутствует в каталоге моделей Piper TTS.<br><br>Переключить синтез речи на <b>Gemini API</b>?`;
      let fallback = true;
      if (typeof window.showAppConfirm === "function") {
        fallback = await window.showAppConfirm({
          title: "Язык не поддерживается в Piper TTS",
          message: msg,
          confirmText: "Переключить на Gemini API",
          cancelText: "Использовать System TTS"
        });
      } else {
        fallback = window.confirm(`Язык ${cleanLang.toUpperCase()} не поддерживается в Piper TTS. Переключить на Gemini API?`);
      }

      if (fallback) {
        if (typeof onFallbackRequested === "function") onFallbackRequested("gemini");
      } else {
        if (typeof onFallbackRequested === "function") onFallbackRequested("browser");
      }
      return { ok: false, reason: "unsupported" };
    }

    let normVoiceId = targetVoiceId;
    if (normVoiceId && normVoiceId.startsWith("__download__:")) {
      normVoiceId = normVoiceId.split(":")[1];
    }

    if (normVoiceId) {
      const isInstalled = (data.installed_voices || []).some(v => v.id === normVoiceId);
      if (isInstalled) {
        return { ok: true, installed_voices: data.installed_voices, default_voice: data.default_voice, voice_id: normVoiceId };
      }
    } else if (data.has_installed) {
      return { ok: true, installed_voices: data.installed_voices, default_voice: data.default_voice };
    }

    // Supported -> Offer download
    const voiceToDownload = normVoiceId || data.default_voice || (data.available_voices && data.available_voices[0] && data.available_voices[0].id);
    if (!voiceToDownload) {
      return { ok: false, reason: "no_voice_available" };
    }

    const vObj = (data.available_voices || []).find(v => v.id === voiceToDownload) || {};
    const vName = vObj.name || voiceToDownload;
    const vSize = vObj.size_mb || 60;

    let shouldDownload = false;
    const confirmMsg = normVoiceId
      ? (window.t ? window.t("transcriber.piper_dl_confirm_named", { name: vName, size: vSize, lang: cleanLang.toUpperCase() }, `Скачать модель голоса <b>${vName}</b> (~${vSize} МБ) для языка «${cleanLang.toUpperCase()}»?`) : `Скачать модель голоса <b>${vName}</b> (~${vSize} МБ) для языка «${cleanLang.toUpperCase()}»?`)
      : (window.t ? window.t("transcriber.piper_dl_confirm_rec", { name: vName, size: vSize, lang: cleanLang.toUpperCase() }, `Для языка «${cleanLang.toUpperCase()}» голосовая модель ещё не установлена на сервере.<br><br>Рекомендуемая модель: <b>${vName}</b> (~${vSize} МБ).<br>Скачать модель сейчас?`) : `Для языка «${cleanLang.toUpperCase()}» голосовая модель ещё не установлена на сервере.<br><br>Рекомендуемая модель: <b>${vName}</b> (~${vSize} МБ).<br>Скачать модель сейчас?`);

    const confirmTitle = window.t ? window.t("transcriber.piper_dl_title", {}, "Загрузка модели Piper TTS") : "Загрузка модели Piper TTS";
    const confirmBtn = window.t ? window.t("transcriber.piper_dl_btn", {}, "Скачать модель") : "Скачать модель";
    const cancelBtn = window.t ? window.t("common.cancel", {}, "Отмена") : "Отмена";

    if (typeof window.showAppConfirm === "function") {
      shouldDownload = await window.showAppConfirm({
        title: confirmTitle,
        message: confirmMsg,
        confirmText: confirmBtn,
        cancelText: cancelBtn
      });
    } else {
      shouldDownload = window.confirm(confirmMsg.replace(/<[^>]+>/g, ""));
    }

    if (!shouldDownload) {
      return { ok: false, reason: "cancelled" };
    }

    // Trigger download
    updateTtsUploadIndicator(0, "running", vName);
    const dlResp = await fetch("/api/transcriber/piper/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice_id: voiceToDownload })
    });
    const dlData = await dlResp.json();
    if (!dlData || dlData.status !== "ok") {
      updateTtsUploadIndicator(0, "error", "Ошибка запуска");
      return { ok: false, reason: "download_start_failed" };
    }

    // Poll download status
    return new Promise((resolve) => {
      let attempts = 0;
      const pollTimer = setInterval(async () => {
        attempts++;
        try {
          const stResp = await fetch(`/api/transcriber/piper/download/status?voice_id=${encodeURIComponent(voiceToDownload)}`);
          const stData = await stResp.json();
          if (stData && stData.status === "ok" && stData.download) {
            const d = stData.download;
            if (d.status === "completed") {
              clearInterval(pollTimer);
              updateTtsUploadIndicator(100, "completed", vName);
              if (typeof onModelDownloaded === "function") {
                onModelDownloaded(voiceToDownload);
              }
              resolve({ ok: true, downloaded: true, voice_id: voiceToDownload });
            } else if (d.status === "error") {
              clearInterval(pollTimer);
              updateTtsUploadIndicator(0, "error", d.error || "Сбой");
              resolve({ ok: false, reason: "download_failed", error: d.error });
            } else {
              updateTtsUploadIndicator(d.progress || 0, "running", vName);
            }
          }
        } catch (pollErr) {
          console.error("[PIPER] Poll error:", pollErr);
        }
        if (attempts > 300) { // 5 minutes max
          clearInterval(pollTimer);
          updateTtsUploadIndicator(0, "error", "Таймаут");
          resolve({ ok: false, reason: "timeout" });
        }
      }, 1000);
    });

  } catch (err) {
    console.error("[PIPER] checkAndPromptPiperModel exception:", err);
    return { ok: false, error: err };
  }
}

function openTtsQuickSettingsPopover(targetBadge, row, slot) {
  closeTtsQuickSettingsPopover();
  closeTxtQuickSettingsPopover();
  if (typeof closeTranscriberModelPicker === "function") {
    closeTranscriberModelPicker();
  }

  const overlay = document.createElement("div");
  overlay.className = "tts-quick-settings-overlay";

  const popup = document.createElement("div");
  popup.className = "tts-quick-settings-popup";

  const s = window.transcriberSettings || {};
  const curEngine = s.tts_engine || "gemini";
  const curModel = s.tts_model || "gemini-3.1-flash-tts-preview";
  const curVoice = s.tts_voice || "auto";
  const rawDuck = (s.tts_ducking_level !== undefined) ? s.tts_ducking_level : 0.80;
  const duckLevel = (rawDuck === 0.05) ? 0.80 : rawDuck;
  const duckPercent = Math.round(duckLevel * 100);
  const rawPauseDuck = (s.tts_pause_ducking_level !== undefined && s.tts_pause_ducking_level !== null) ? s.tts_pause_ducking_level : 1.0;
  const pauseDuckPercent = Math.round(rawPauseDuck * 100);
  const curSolo = (s.tts_mute_others !== undefined) ? Boolean(s.tts_mute_others) : true;
  const curAnnounce = (s.tts_announce_callsign !== undefined) ? Boolean(s.tts_announce_callsign) : false;
  const curStyle = s.tts_style || "radio";

  const duckMute = window.t ? window.t("transcriber.tts_ducking_mute", {}, "0% (тишина)") : "0% (тишина)";
  const duckNone = window.t ? window.t("transcriber.tts_ducking_none", {}, "100% (без приглушения)") : "100% (без приглушения)";

  // Header
  const header = document.createElement("div");
  header.className = "tts-quick-header";
  const titleTxt = (slot != null && slot !== "")
    ? (window.t ? window.t("transcriber.tts_modal_title", { slot }, `Синтез речи TS${slot}`) : `Синтез речи TS${slot}`)
    : (window.t ? window.t("transcriber.tts_settings_title", {}, "Настройки синтеза речи") : "Настройки синтеза речи");
  header.innerHTML = `
    <div class="tts-quick-title">
      <span class="tts-quick-icon">🔊</span>
      <span>${titleTxt}</span>
    </div>
    <button type="button" class="tts-quick-close" aria-label="${window.t ? window.t("buttons.close", {}, "Закрыть") : "Закрыть"}">&times;</button>
  `;

  // Body
  const body = document.createElement("div");
  body.className = "tts-quick-body";

  // 0. Target Language select (duplicated from Transcriber settings)
  let curTargetLang = (s.target_lang && s.target_lang !== "none") ? s.target_lang : null;
  if (!curTargetLang) {
    const optTl = document.getElementById("optTranscriberTargetLang");
    curTargetLang = (optTl && optTl.value) ? optTl.value : "ru";
  }

  const rowTargetLang = document.createElement("div");
  rowTargetLang.className = "tts-quick-row";
  rowTargetLang.id = "ttsQuickRowTargetLang";
  rowTargetLang.innerHTML = `
    <label class="tts-quick-label" for="ttsQuickTargetLang">${window.t ? window.t("transcriber.target_lang", {}, "🌐 Целевой язык перевода / Target Language:") : "🌐 Целевой язык перевода / Target Language:"}</label>
    <select class="tts-quick-select" id="ttsQuickTargetLang"></select>
  `;
  const selTargetLang = rowTargetLang.querySelector("#ttsQuickTargetLang");
  renderTargetLangSelect(selTargetLang);
  if (curTargetLang && curTargetLang !== "none") {
    selTargetLang.value = curTargetLang;
  }

  // 1. Engine
  const rowEngine = document.createElement("div");
  rowEngine.className = "tts-quick-row";
  rowEngine.innerHTML = `
    <label class="tts-quick-label">${window.t ? window.t("transcriber.tts_engine_lbl", {}, "🎙️ Движок синтеза речи:") : "🎙️ Движок синтеза речи:"}</label>
    <select class="tts-quick-select" id="ttsQuickEngine">
      <option value="gemini" ${curEngine === "gemini" ? "selected" : ""}>${window.t ? window.t("transcriber.tts_engine_gemini", {}, "Gemini API (AI — Нейросетевой)") : "Gemini API (AI — Нейросетевой)"}</option>
      <option value="piper" ${curEngine === "piper" ? "selected" : ""}>${window.t ? window.t("transcriber.tts_engine_piper", {}, "Локальный Piper TTS") : "Локальный Piper TTS"}</option>
      <option value="browser" ${curEngine === "browser" ? "selected" : ""}>${window.t ? window.t("transcriber.tts_engine_browser", {}, "System TTS (Web Speech API)") : "System TTS (Web Speech API)"}</option>
    </select>
  `;

  // 2. Model (shown only if gemini)
  const recLabel = window.t ? window.t("transcriber.model_rec", {}, "⚡ Рекомендуется") : "⚡ Рекомендуется";
  const fastLabel = window.t ? window.t("transcriber.model_fast", {}, "Быстрый") : "Быстрый";
  const qualLabel = window.t ? window.t("transcriber.model_qual", {}, "Качество") : "Качество";
  const rowModel = document.createElement("div");
  rowModel.className = "tts-quick-row";
  rowModel.id = "ttsQuickRowModel";
  rowModel.style.display = (curEngine === "gemini") ? "flex" : "none";
  rowModel.innerHTML = `
    <label class="tts-quick-label">${window.t ? window.t("transcriber.tts_model_lbl", {}, "🤖 Модель Gemini TTS:") : "🤖 Модель Gemini TTS:"}</label>
    <select class="tts-quick-select" id="ttsQuickModel">
      <option value="gemini-3.1-flash-tts-preview" ${curModel === "gemini-3.1-flash-tts-preview" ? "selected" : ""}>Gemini 3.1 Flash TTS Preview (${recLabel})</option>
      <option value="gemini-3.8-flash-lite-tts" ${curModel === "gemini-3.8-flash-lite-tts" ? "selected" : ""}>Gemini 3.8 Flash-Lite TTS (${fastLabel})</option>
      <option value="gemini-3.8-flash-tts" ${curModel === "gemini-3.8-flash-tts" ? "selected" : ""}>Gemini 3.8 Flash TTS (${qualLabel})</option>
      <option value="gemini-2.5-flash-preview-tts" ${curModel === "gemini-2.5-flash-preview-tts" ? "selected" : ""}>Gemini 2.5 Flash TTS Preview (Free)</option>
      <option value="gemini-2.5-pro-preview-tts" ${curModel === "gemini-2.5-pro-preview-tts" ? "selected" : ""}>Gemini 2.5 Pro TTS Preview (Pro)</option>
      <option value="gemini-3.1-flash-live-preview" ${curModel === "gemini-3.1-flash-live-preview" ? "selected" : ""}>Gemini 3.1 Flash Live (Live Voice)</option>
    </select>
  `;

  // 2b. Gemini Speech Style (shown only if gemini)
  const rowStyle = document.createElement("div");
  rowStyle.className = "tts-quick-row";
  rowStyle.id = "ttsQuickRowStyle";
  rowStyle.style.display = (curEngine === "gemini") ? "flex" : "none";
  rowStyle.innerHTML = `
    <label class="tts-quick-label">${window.t ? window.t("transcriber.tts_style_lbl", {}, "🎭 Стиль речи (Gemini):") : "🎭 Стиль речи (Gemini):"}</label>
    <select class="tts-quick-select" id="ttsQuickStyle">
      <option value="radio" ${curStyle === "radio" ? "selected" : ""}>${window.t ? window.t("transcriber.tts_style_radio", {}, "📻 Нейтральный радиообмен (спокойный, без эмоций)") : "📻 Нейтральный радиообмен (спокойный, без эмоций)"}</option>
      <option value="monotone" ${curStyle === "monotone" ? "selected" : ""}>${window.t ? window.t("transcriber.tts_style_monotone", {}, "🤖 Монотонный (сухой, строгий)") : "🤖 Монотонный (сухой, строгий)"}</option>
      <option value="clear" ${curStyle === "clear" ? "selected" : ""}>${window.t ? window.t("transcriber.tts_style_clear", {}, "🎙️ Чёткий дикторский (деловой, информативный)") : "🎙️ Чёткий дикторский (деловой, информативный)"}</option>
      <option value="natural" ${curStyle === "natural" ? "selected" : ""}>${window.t ? window.t("transcriber.tts_style_natural", {}, "🗣️ Естественный (живой, разговорный)") : "🗣️ Естественный (живой, разговорный)"}</option>
    </select>
  `;

  // 3. Voice (dynamic)
  const rowVoice = document.createElement("div");
  rowVoice.className = "tts-quick-row";
  rowVoice.innerHTML = `
    <label class="tts-quick-label">${window.t ? window.t("transcriber.tts_voice_lbl", {}, "🗣️ Голос озвучки:") : "🗣️ Голос озвучки:"}</label>
    <select class="tts-quick-select" id="ttsQuickVoice"></select>
    <div id="ttsQuickVoiceHint" style="font-size: 0.72rem; color: #8b949e; margin-top: 3px; display: none;"></div>
  `;

  // 3b. Speed range slider (1.0x - 2.0x)
  const curSpeed = (s.tts_speed !== undefined) ? Math.max(1.0, Math.min(2.0, parseFloat(s.tts_speed) || 1.1)) : 1.1;
  const speedText = `${curSpeed.toFixed(2).replace(/\.?0+$/, "")}x`;
  const rowSpeed = document.createElement("div");
  rowSpeed.className = "tts-quick-row";
  rowSpeed.innerHTML = `
    <div class="tts-quick-row-header">
      <label class="tts-quick-label" for="ttsQuickSpeed">${window.t ? window.t("transcriber.tts_speed_lbl", {}, "⚡ Скорость воспроизведения:") : "⚡ Скорость воспроизведения:"}</label>
      <span class="tts-quick-val" id="ttsQuickSpeedVal">${speedText}</span>
    </div>
    <input type="range" class="tts-quick-range" id="ttsQuickSpeed" min="1.0" max="2.0" step="0.05" value="${curSpeed.toFixed(2)}">
  `;

  // 4. Ducking range slider (during speech)
  const rowDucking = document.createElement("div");
  rowDucking.className = "tts-quick-row";
  rowDucking.innerHTML = `
    <div class="tts-quick-row-header">
      <label class="tts-quick-label" for="ttsQuickDucking">${window.t ? window.t("transcriber.tts_ducking_lbl", {}, "🎚️ Громкость эфира при озвучке перевода:") : "🎚️ Громкость эфира при озвучке перевода:"}</label>
      <span class="tts-quick-val" id="ttsQuickDuckingVal">${duckPercent === 0 ? duckMute : (duckPercent === 100 ? duckNone : `${duckPercent}%`)}</span>
    </div>
    <input type="range" class="tts-quick-range" id="ttsQuickDucking" min="0" max="100" step="1" value="${duckPercent}">
  `;

  // 4b. Pause Ducking range slider (in pauses between speech)
  const rowPauseDucking = document.createElement("div");
  rowPauseDucking.className = "tts-quick-row";
  rowPauseDucking.innerHTML = `
    <div class="tts-quick-row-header">
      <label class="tts-quick-label" for="ttsQuickPauseDucking">${window.t ? window.t("transcriber.tts_pause_ducking_lbl", {}, "🎚️ Громкость эфира в паузах перевода:") : "🎚️ Громкость эфира в паузах перевода:"}</label>
      <span class="tts-quick-val" id="ttsQuickPauseDuckingVal">${pauseDuckPercent === 0 ? duckMute : (pauseDuckPercent === 100 ? duckNone : `${pauseDuckPercent}%`)}</span>
    </div>
    <input type="range" class="tts-quick-range" id="ttsQuickPauseDucking" min="0" max="100" step="1" value="${pauseDuckPercent}">
    <div style="font-size: 0.72rem; color: #8b949e; margin-top: 2px;">${window.t ? window.t("transcriber.tts_pause_ducking_hint", {}, "0% — тишина в паузах, 10-20% — тихий фон, 100% — без приглушения") : "0% — тишина в паузах, 10-20% — тихий фон, 100% — без приглушения"}</div>
  `;

  // 5. Solo mode and Announce callsign checkboxes (stacked vertically and left-aligned)
  const rowSolo = document.createElement("div");
  rowSolo.className = "tts-quick-row tts-quick-checkboxes-row";
  rowSolo.style.display = "flex";
  rowSolo.style.flexDirection = "column";
  rowSolo.style.alignItems = "flex-start";
  rowSolo.style.justifyContent = "flex-start";
  rowSolo.style.gap = "6px";
  rowSolo.style.marginTop = "4px";
  rowSolo.style.marginBottom = "0px";
  rowSolo.innerHTML = `
    <label class="tts-quick-cb-label">
      <input type="checkbox" id="ttsQuickSolo" ${curSolo ? "checked" : ""}>
      <span>${window.t ? window.t("transcriber.tts_solo_mode", {}, "Соло режим") : "Соло режим"}</span>
    </label>
    <label class="tts-quick-cb-label">
      <input type="checkbox" id="ttsQuickAnnounceCallsign" ${curAnnounce ? "checked" : ""}>
      <span>${window.t ? window.t("transcriber.tts_announce_callsign", {}, "Проговаривать позывной") : "Проговаривать позывной"}</span>
    </label>
  `;

  body.appendChild(rowTargetLang);
  body.appendChild(rowEngine);
  body.appendChild(rowModel);
  body.appendChild(rowStyle);
  body.appendChild(rowVoice);
  body.appendChild(rowSpeed);
  body.appendChild(rowDucking);
  body.appendChild(rowPauseDucking);
  body.appendChild(rowSolo);

  // Footer
  const footer = document.createElement("div");
  footer.className = "tts-quick-footer";
  footer.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <button type="button" class="btn-tts-quick-test" id="btnTtsQuickTest">${window.t ? window.t("transcriber.tts_btn_quick_test", {}, "🔊 Тест") : "🔊 Тест"}</button>
      <div id="quickTtsUploadIndicator" class="header-tts-upload-indicator" style="display: none;" title="Загрузка голосовой модели Piper TTS" role="status" tabindex="0" onclick="event.stopPropagation();">
        <img src="/static/img/TTS_Upload.png?v=2.9.172" alt="TTS Upload" class="tts-upload-img">
        <span class="tts-upload-percent">0%</span>
      </div>
    </div>
    <button type="button" class="btn-tts-quick-save" id="btnTtsQuickSave">${window.t ? window.t("transcriber.tts_btn_quick_save", {}, "✓ Сохранить") : "✓ Сохранить"}</button>
  `;

  popup.appendChild(header);
  popup.appendChild(body);
  popup.appendChild(footer);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  activeTtsPopoverOverlay = overlay;

  positionTtsQuickSettingsPopover(popup, targetBadge);

  if (_lastTtsDownloadState && _lastTtsDownloadState.status === "running") {
    const qInd = popup.querySelector("#quickTtsUploadIndicator");
    if (qInd) {
      qInd.style.display = "inline-flex";
      const pctEl = qInd.querySelector(".tts-upload-percent");
      const pct = Math.max(0, Math.min(100, Math.round(Number(_lastTtsDownloadState.progress) || 0)));
      if (pctEl) pctEl.textContent = `${pct}%`;
      qInd.title = _lastTtsDownloadState.voiceName
        ? `Загрузка голосовой модели Piper (${_lastTtsDownloadState.voiceName}): ${pct}%`
        : `Загрузка голосовой модели Piper TTS: ${pct}%`;
    }
  }

  const selEngine = popup.querySelector("#ttsQuickEngine");
  const selVoice = popup.querySelector("#ttsQuickVoice");
  const hintVoice = popup.querySelector("#ttsQuickVoiceHint");
  const getActiveLang = () => (selTargetLang && selTargetLang.value && selTargetLang.value !== "none") ? selTargetLang.value : (resolveCurrentTargetLang() || "ru");

  // Populate dynamic voice select
  populateVoiceSelect(selVoice, curEngine, getActiveLang(), curVoice, hintVoice);

  // Wire Target Language change to update voices dynamically
  if (selTargetLang) {
    selTargetLang.addEventListener("change", async () => {
      const chosenLang = getActiveLang();
      const eng = selEngine ? selEngine.value : (s.tts_engine || "gemini");
      if (eng === "piper") {
        const checkRes = await checkAndPromptPiperModel(chosenLang, (newVoiceId) => {
          populateVoiceSelect(selVoice, "piper", chosenLang, newVoiceId, hintVoice);
        }, (fallbackEng) => {
          if (selEngine) selEngine.value = fallbackEng;
          rowModel.style.display = (fallbackEng === "gemini") ? "flex" : "none";
          rowStyle.style.display = (fallbackEng === "gemini") ? "flex" : "none";
          populateVoiceSelect(selVoice, fallbackEng, chosenLang, null, hintVoice);
        });
        if (checkRes && checkRes.ok) {
          populateVoiceSelect(selVoice, "piper", chosenLang, checkRes.default_voice || null, hintVoice);
        }
      } else {
        populateVoiceSelect(selVoice, eng, chosenLang, (eng === "gemini" ? (selVoice ? selVoice.value : curVoice) : null), hintVoice);
      }
      positionTtsQuickSettingsPopover(popup, targetBadge);
    });
  }

  // Wire Engine change to show/hide model & update voices
  if (selEngine) {
    selEngine.addEventListener("change", async () => {
      const eng = selEngine.value;
      const chosenLang = getActiveLang();
      rowModel.style.display = (eng === "gemini") ? "flex" : "none";
      rowStyle.style.display = (eng === "gemini") ? "flex" : "none";
      if (eng === "piper") {
        const checkRes = await checkAndPromptPiperModel(chosenLang, (newVoiceId) => {
          populateVoiceSelect(selVoice, "piper", chosenLang, newVoiceId, hintVoice);
        }, (fallbackEng) => {
          selEngine.value = fallbackEng;
          rowModel.style.display = (fallbackEng === "gemini") ? "flex" : "none";
          rowStyle.style.display = (fallbackEng === "gemini") ? "flex" : "none";
          populateVoiceSelect(selVoice, fallbackEng, chosenLang, null, hintVoice);
        });
        if (checkRes && checkRes.ok) {
          populateVoiceSelect(selVoice, "piper", chosenLang, curVoice, hintVoice);
        }
      } else {
        populateVoiceSelect(selVoice, eng, chosenLang, (eng === "gemini" ? curVoice : null), hintVoice);
      }
      positionTtsQuickSettingsPopover(popup, targetBadge);
    });
  }

  // Handle click on download option in voice select
  if (selVoice) {
    selVoice.addEventListener("change", async () => {
      if (selVoice.value && selVoice.value.startsWith("__download__")) {
        const specificVoice = selVoice.value.includes(":") ? selVoice.value.split(":")[1] : null;
        await checkAndPromptPiperModel(getActiveLang(), (newVoiceId) => {
          populateVoiceSelect(selVoice, "piper", getActiveLang(), newVoiceId, hintVoice);
        }, null, specificVoice);
      }
    });
  }

  // Wire Ducking range input display and live ducking
  const rngDucking = popup.querySelector("#ttsQuickDucking");
  const valDucking = popup.querySelector("#ttsQuickDuckingVal");
  if (rngDucking && valDucking) {
    rngDucking.addEventListener("input", () => {
      const val = parseInt(rngDucking.value, 10) || 0;
      valDucking.textContent = val === 0 ? duckMute : (val === 100 ? duckNone : `${val}%`);
      const duckFactor = val / 100.0;
      if (window.transcriberSettings) {
        window.transcriberSettings.tts_ducking_level = duckFactor;
      }
      if (window.ttsAudioQueueManager) {
        window.ttsAudioQueueManager.updateLiveDucking(duckFactor);
      }
    });
  }

  // Wire Pause Ducking range input display and live idle ducking
  const rngPauseDucking = popup.querySelector("#ttsQuickPauseDucking");
  const valPauseDucking = popup.querySelector("#ttsQuickPauseDuckingVal");
  if (rngPauseDucking && valPauseDucking) {
    rngPauseDucking.addEventListener("input", () => {
      const val = parseInt(rngPauseDucking.value, 10) || 0;
      valPauseDucking.textContent = val === 0 ? duckMute : (val === 100 ? duckNone : `${val}%`);
      const pauseDuckFactor = val / 100.0;
      if (window.transcriberSettings) {
        window.transcriberSettings.tts_pause_ducking_level = pauseDuckFactor;
      }
      if (window.ttsAudioQueueManager) {
        window.ttsAudioQueueManager.syncIdleDucking(0.08);
      }
    });
  }

  // Wire Speed range input display
  const rngSpeed = popup.querySelector("#ttsQuickSpeed");
  const valSpeed = popup.querySelector("#ttsQuickSpeedVal");
  if (rngSpeed && valSpeed) {
    rngSpeed.addEventListener("input", () => {
      const v = Math.max(1.0, Math.min(2.0, parseFloat(rngSpeed.value) || 1.1));
      valSpeed.textContent = `${v.toFixed(2).replace(/\.?0+$/, "")}x`;
      if (window.transcriberSettings) {
        window.transcriberSettings.tts_speed = v;
      }
      const optTtsSpeed = document.getElementById("optTtsSpeed");
      const optTtsSpeedVal = document.getElementById("optTtsSpeedVal");
      if (optTtsSpeed) optTtsSpeed.value = v.toFixed(2);
      if (optTtsSpeedVal) optTtsSpeedVal.textContent = valSpeed.textContent;
    });
  }

  // Wire Solo mode checkbox
  const cbSolo = popup.querySelector("#ttsQuickSolo");
  if (cbSolo) {
    cbSolo.addEventListener("change", () => {
      const isSolo = cbSolo.checked;
      if (window.transcriberSettings) {
        window.transcriberSettings.tts_mute_others = isSolo;
      }
      const optMute = document.getElementById("optTtsMuteOthers");
      if (optMute) optMute.checked = isSolo;
      syncTtsSoloMode();
      if (typeof window.summaryTtsReader !== "undefined" && window.summaryTtsReader && window.summaryTtsReader.isPlaying) {
        window.summaryTtsReader.applySoloMute(isSolo);
      }
    });
  }

  // Wire Announce callsign checkbox
  const cbAnnounce = popup.querySelector("#ttsQuickAnnounceCallsign");
  if (cbAnnounce) {
    cbAnnounce.addEventListener("change", () => {
      const isAnnounce = cbAnnounce.checked;
      if (window.transcriberSettings) {
        window.transcriberSettings.tts_announce_callsign = isAnnounce;
      }
      const optAnnounce = document.getElementById("optTtsAnnounceCallsign");
      if (optAnnounce) optAnnounce.checked = isAnnounce;
    });
  }

  // Test button
  const btnTest = popup.querySelector("#btnTtsQuickTest");
  if (btnTest) {
    btnTest.addEventListener("click", async (e) => {
      e.stopPropagation();
      const eng = selEngine ? selEngine.value : "gemini";
      const mod = popup.querySelector("#ttsQuickModel") ? popup.querySelector("#ttsQuickModel").value : "gemini-3.1-flash-tts-preview";
      const sty = popup.querySelector("#ttsQuickStyle") ? popup.querySelector("#ttsQuickStyle").value : "radio";
      const voi = selVoice ? selVoice.value : "auto";
      const spd = rngSpeed ? (parseFloat(rngSpeed.value) || 1.1) : (s.tts_speed || 1.1);
      const duckVal = rngDucking ? (Math.max(0, Math.min(100, parseFloat(rngDucking.value) || 20)) / 100.0) : 0.20;
      const solo = popup.querySelector("#ttsQuickSolo") ? popup.querySelector("#ttsQuickSolo").checked : true;
      const announce = popup.querySelector("#ttsQuickAnnounceCallsign") ? popup.querySelector("#ttsQuickAnnounceCallsign").checked : false;
      const actHid = (typeof window.getActiveHotspotId === "function") ? window.getActiveHotspotId() : "default";

      btnTest.disabled = true;
      const oldTxt = btnTest.textContent;
      btnTest.textContent = "⏳...";

      const uiLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) ||
                     (typeof localStorage !== "undefined" && localStorage.getItem("proxdmr_language")) ||
                     "ru";
      let testLang = uiLang;
      let testVoice = voi || "";
      if (testVoice.startsWith("__download__:")) {
        testVoice = testVoice.split(":")[1];
      } else if (testVoice === "__download__") {
        testVoice = "";
      }
      if (eng === "piper" && testVoice && testVoice !== "auto") {
        const vMatch = testVoice.match(/^([a-z]{2})_[A-Z]{2}-/i);
        if (vMatch) {
          testLang = vMatch[1].toLowerCase();
        }
      }
      const testText = getTtsTestPhrase(testLang);

      try {
        if (eng === "browser") {
          if (!window.speechSynthesis) {
            showToast("Web Speech API не поддерживается браузером", 3000);
          } else {
            // Cancel any running speech
            window.speechSynthesis.cancel();

            // Duck original DMR audio during test
            if (window.ttsAudioQueueManager) {
              window.ttsAudioQueueManager.applyDucking(actHid, slot, duckVal, solo);
            }

            const cleanPhrase = cleanTextForClientTts(testText, testLang);
            const ut = new SpeechSynthesisUtterance(cleanPhrase);
            ut.rate = spd;
            ut.lang = BCP47_LANG_MAP[testLang] || testLang;

            let vol = 80;
            if (typeof window.getHotspotVolume === "function") {
              vol = window.getHotspotVolume(actHid);
            }
            ut.volume = Math.max(0.0, Math.min(1.0, (vol / 100.0) * 0.40));

            try {
              const voices = window.speechSynthesis.getVoices();
              if (voices && voices.length > 0) {
                const langPrefix = testLang.substring(0, 2).toLowerCase();
                const matching = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(langPrefix));
                if (matching.length > 0) ut.voice = matching[0];
              }
            } catch (_) {}

            let restored = false;
            const onTestDone = () => {
              if (restored) return;
              restored = true;
              if (window.ttsAudioQueueManager) {
                window.ttsAudioQueueManager.finishPlayback();
              }
            };

            ut.onend = onTestDone;
            ut.onerror = onTestDone;

            window.speechSynthesis.speak(ut);
            showToast(`🔊 Локальный синтез [${testLang.toUpperCase()}]`, 2000);
          }
        } else if (eng === "piper") {
          const checkRes = await checkAndPromptPiperModel(testLang, null, null, testVoice);
          if (!checkRes || !checkRes.ok) {
            btnTest.disabled = false;
            btnTest.textContent = oldTxt;
            return;
          }
          const resp = await fetch("/api/transcriber/tts-test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: testText,
              engine: "piper",
              voice: testVoice,
              speed: spd,
              target_lang: testLang,
              announce_callsign: announce,
              callsign: "RX6AWG"
            })
          });
          const res = await resp.json();
          if (res.status === "ok" && res.audio_base64) {
            if (window.ttsAudioQueueManager) {
              window.ttsAudioQueueManager.enqueue({
                hotspot_id: actHid,
                slot: slot,
                audio_base64: res.audio_base64,
                text: testText,
                engine: "piper",
                speed: spd,
                ducking_level: duckVal,
                mute_others: solo,
                is_test: true,
                bypassMute: true
              });
            }
            showToast(window.t ? window.t("transcriber.piper_toast_test", { lang: testLang.toUpperCase(), voice: testVoice || "default" }, `🔊 Тест Piper TTS [${testLang.toUpperCase()}] (${testVoice || "default"})...`) : `🔊 Тест Piper TTS [${testLang.toUpperCase()}] (${testVoice || "default"})...`, 2500);
          } else {
            console.warn("[TTS] Quick test Piper error:", res);
            const errDetail = res.message || res.detail || "Ошибка синтеза";
            showToast(window.t ? window.t("transcriber.toast_tts_piper_err", { error: errDetail }, `⚠️ Piper TTS: ${errDetail}`) : `⚠️ Piper TTS: ${errDetail}`, 3500);
          }
        } else {
          const testVoice = (voi === "auto") ? "Puck" : voi;
          const keyInp = document.querySelector('#geminiApiKeysBody .apikey-cb:checked + .apikey-name + .apikey-input-wrap .apikey-input, #geminiApiKeysBody .apikey-cb:checked ~ .apikey-input-wrap .apikey-input');
          const key = (keyInp && keyInp.value.trim()) ? keyInp.value.trim() : (window.transcriberSettings ? window.transcriberSettings.api_key : "");

          const resp = await fetch("/api/transcriber/tts-test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: testText,
              voice: testVoice,
              model: mod,
              api_key: key,
              target_lang: testLang,
              engine: "gemini",
              speed: spd,
              announce_callsign: announce,
              callsign: "RX6AWG",
              tts_style: sty
            })
          });
          const res = await resp.json();
          if (res.status === "ok" && res.audio_base64) {
            if (window.ttsAudioQueueManager) {
              window.ttsAudioQueueManager.enqueue({
                hotspot_id: actHid,
                slot: slot,
                audio_base64: res.audio_base64,
                text: testText,
                engine: "gemini",
                speed: spd,
                ducking_level: duckVal,
                mute_others: solo,
                is_test: true,
                bypassMute: true
              });
            }
            showToast(`🔊 Тест Gemini TTS [${testLang.toUpperCase()}] (${testVoice})...`, 2500);
          } else {
            console.warn("[TTS] Quick test error:", res);
            showToast(`⚠️ ${formatGeminiError(res.message || res.detail || res, "tts")}`, 3500);
          }
        }
      } catch (err) {
        console.error("[TTS] Quick test exception:", err);
        showToast(`⚠️ ${formatGeminiError(err, "tts")}`, 3500);
      } finally {
        btnTest.disabled = false;
        btnTest.textContent = oldTxt;
      }
    });
  }

  // Save button
  const btnSave = popup.querySelector("#btnTtsQuickSave");
  if (btnSave) {
    btnSave.addEventListener("click", async (e) => {
      e.stopPropagation();
      const chosenTargetLang = getActiveLang();
      const eng = selEngine ? selEngine.value : "gemini";
      const mod = popup.querySelector("#ttsQuickModel") ? popup.querySelector("#ttsQuickModel").value : "gemini-3.1-flash-tts-preview";
      const sty = popup.querySelector("#ttsQuickStyle") ? popup.querySelector("#ttsQuickStyle").value : "radio";
      const voi = (selVoice && selVoice.value && !selVoice.value.startsWith("__download__")) ? selVoice.value : "auto";
      const spd = rngSpeed ? (parseFloat(rngSpeed.value) || 1.1) : (s.tts_speed || 1.1);
      const dVal = rngDucking ? (Math.max(0, Math.min(100, parseFloat(rngDucking.value) || 80)) / 100.0) : 0.80;
      const pVal = rngPauseDucking ? (Math.max(0, Math.min(100, parseFloat(rngPauseDucking.value) || 100)) / 100.0) : 1.0;
      const solo = popup.querySelector("#ttsQuickSolo") ? popup.querySelector("#ttsQuickSolo").checked : true;
      const announce = popup.querySelector("#ttsQuickAnnounceCallsign") ? popup.querySelector("#ttsQuickAnnounceCallsign").checked : false;

      btnSave.disabled = true;
      btnSave.textContent = "⏳...";

      // Stop active TTS audio queue if target language changed
      if (chosenTargetLang !== s.target_lang && window.ttsAudioQueueManager) {
        window.ttsAudioQueueManager.stopAll();
      }

      const payload = {
        target_lang: chosenTargetLang,
        tts_engine: eng,
        tts_model: mod,
        tts_voice: voi,
        tts_speed: spd,
        tts_ducking_level: dVal,
        tts_pause_ducking_level: pVal,
        tts_mute_others: solo,
        tts_announce_callsign: announce,
        tts_style: sty
      };

      try {
        const resp = await fetch("/api/transcriber/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const resJson = await resp.json();
        if (resJson.status === "ok") {
          if (resJson.settings) {
            window.transcriberSettings = resJson.settings;
          } else {
            if (!window.transcriberSettings) window.transcriberSettings = {};
            window.transcriberSettings.target_lang = chosenTargetLang;
            window.transcriberSettings.tts_engine = eng;
            window.transcriberSettings.tts_model = mod;
            window.transcriberSettings.tts_voice = voi;
            window.transcriberSettings.tts_speed = spd;
            window.transcriberSettings.tts_ducking_level = dVal;
            window.transcriberSettings.tts_pause_ducking_level = pVal;
            window.transcriberSettings.tts_mute_others = solo;
            window.transcriberSettings.tts_announce_callsign = announce;
            window.transcriberSettings.tts_style = sty;
          }

          // Refresh TTS badges on all cards
          refreshAllSlotTtsBadges(chosenTargetLang);

          // Sync main settings modal form inputs if they exist
          const optTl = document.getElementById("optTranscriberTargetLang");
          if (optTl) optTl.value = chosenTargetLang;
          const optNoTrans = document.getElementById("optTranscriberNoTranslate");
          if (optNoTrans && optNoTrans.checked) {
            optNoTrans.checked = false;
            optNoTrans.dispatchEvent(new Event("change"));
          }

          const optEng = document.getElementById("optTtsEngine");
          if (optEng) optEng.value = eng;
          const optMod = document.getElementById("optTtsModel");
          if (optMod) optMod.value = mod;
          const grpModel = document.getElementById("groupGeminiTtsModel");
          if (grpModel) grpModel.style.display = (eng === "gemini") ? "block" : "none";
          const optSty = document.getElementById("optTtsStyle");
          if (optSty) optSty.value = sty;
          const grpStyle = document.getElementById("groupGeminiTtsStyle");
          if (grpStyle) grpStyle.style.display = (eng === "gemini") ? "block" : "none";
          const optVoi = document.getElementById("optTtsVoice");
          const optHint = document.getElementById("ttsVoiceHint");
          if (optVoi) {
            populateVoiceSelect(optVoi, eng, chosenTargetLang, voi, optHint);
          }
          const optDck = document.getElementById("optTtsDucking");
          if (optDck) {
            optDck.value = String(Math.round(dVal * 100));
            const dValEl = document.getElementById("optTtsDuckingVal");
            if (dValEl) dValEl.textContent = `${Math.round(dVal * 100)}%`;
          }
          const optPauseDck = document.getElementById("optTtsPauseDucking");
          if (optPauseDck) {
            const pPct = Math.round(pVal * 100);
            optPauseDck.value = String(pPct);
            const pValEl = document.getElementById("optTtsPauseDuckingVal");
            if (pValEl) pValEl.textContent = (pPct === 0) ? "0% (тишина)" : (pPct === 100 ? "100% (без приглушения)" : `${pPct}%`);
          }
          const optSpd = document.getElementById("optTtsSpeed");
          if (optSpd) {
            optSpd.value = spd.toFixed(2);
            const spdValEl = document.getElementById("optTtsSpeedVal");
            if (spdValEl) spdValEl.textContent = `${spd.toFixed(2).replace(/\.?0+$/, "")}x`;
          }
          const optMute = document.getElementById("optTtsMuteOthers");
          if (optMute) optMute.checked = solo;
          const optAnnounce = document.getElementById("optTtsAnnounceCallsign");
          if (optAnnounce) optAnnounce.checked = announce;

          syncTtsSoloMode();
          if (typeof window.summaryTtsReader !== "undefined" && window.summaryTtsReader && window.summaryTtsReader.isPlaying) {
            window.summaryTtsReader.applySoloMute(solo);
          }

          if (window.ttsAudioQueueManager) {
            window.ttsAudioQueueManager.syncIdleDucking(0.15);
          }

          showToast("✓ Параметры синтеза речи сохранены", 2500);
          closeTtsQuickSettingsPopover();
        } else {
          showToast("⚠️ Ошибка сохранения настроек синтеза", 3000);
          btnSave.disabled = false;
          btnSave.textContent = "✓ Сохранить";
        }
      } catch (err) {
        console.error(err);
        showToast("⚠️ Ошибка связи с сервером", 3000);
        btnSave.disabled = false;
        btnSave.textContent = "✓ Сохранить";
      }
    });
  }

  // Close handlers
  const closeBtn = header.querySelector(".tts-quick-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTtsQuickSettingsPopover();
    });
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeTtsQuickSettingsPopover();
    }
  });

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      window.removeEventListener("keydown", onKeyDown);
      closeTtsQuickSettingsPopover();
    }
  };
  window.addEventListener("keydown", onKeyDown);
}

function setupSlotTtsClick(row, slot) {
  if (!row) return;
  const ttsBadge = row.querySelector(".vfo-tts-badge");
  if (!ttsBadge || ttsBadge._wiredTts) return;
  ttsBadge._wiredTts = true;
  ttsBadge.setAttribute("role", "button");
  ttsBadge.setAttribute("tabindex", "0");

  let pressTimer = null;
  let isLongPress = false;
  let startX = 0;
  let startY = 0;
  const LONG_PRESS_MS = 500;

  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    ttsBadge.classList.remove("vfo-tts-pressing");
  };

  const startPress = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    isLongPress = false;
    startX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    startY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    ttsBadge.classList.add("vfo-tts-pressing");

    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      isLongPress = true;
      ttsBadge.classList.remove("vfo-tts-pressing");
      triggerHaptic(35);
      openTtsQuickSettingsPopover(ttsBadge, row, slot);
    }, LONG_PRESS_MS);
  };

  const movePress = (e) => {
    if (!pressTimer) return;
    const curX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const curY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    if (Math.hypot(curX - startX, curY - startY) > 10) {
      cancelPress();
    }
  };

  ttsBadge.addEventListener("pointerdown", startPress);
  ttsBadge.addEventListener("pointermove", movePress);
  ttsBadge.addEventListener("pointerup", cancelPress);
  ttsBadge.addEventListener("pointercancel", cancelPress);
  ttsBadge.addEventListener("pointerleave", cancelPress);

  ttsBadge.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cancelPress();
    openTtsQuickSettingsPopover(ttsBadge, row, slot);
  });

  const onTtsClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (isLongPress) {
      isLongPress = false;
      return;
    }
    toggleSlotTts(row, slot);
  };
  ttsBadge.addEventListener("click", onTtsClick);

  let keyTimer = null;
  let isKeyLongPress = false;
  ttsBadge.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      if (e.repeat) return;
      if (e.shiftKey || e.altKey) {
        e.preventDefault();
        openTtsQuickSettingsPopover(ttsBadge, row, slot);
        return;
      }
      isKeyLongPress = false;
      keyTimer = setTimeout(() => {
        keyTimer = null;
        isKeyLongPress = true;
        openTtsQuickSettingsPopover(ttsBadge, row, slot);
      }, LONG_PRESS_MS);
    }
  });
  ttsBadge.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      if (keyTimer) {
        clearTimeout(keyTimer);
        keyTimer = null;
      }
      if (!isKeyLongPress) {
        e.preventDefault();
        toggleSlotTts(row, slot);
      }
      isKeyLongPress = false;
    }
  });
}

function setupRecTtsButton() {
  const recTtsBtn = document.getElementById("recTtsBtn");
  if (!recTtsBtn || recTtsBtn._wiredRecTts) return;
  recTtsBtn._wiredRecTts = true;
  recTtsBtn.setAttribute("role", "button");
  recTtsBtn.setAttribute("tabindex", "0");

  let pressTimer = null;
  let isLongPress = false;
  let startX = 0;
  let startY = 0;
  const LONG_PRESS_MS = 500;

  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    recTtsBtn.classList.remove("vfo-tts-pressing");
  };

  const getRecSlot = () => {
    const recMgr = window.recordingsManager || (window.__proxdmr && window.__proxdmr.recordingsManager);
    return (recMgr && recMgr.currentRecording) ? recMgr.currentRecording.slot : null;
  };

  const startPress = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    isLongPress = false;
    startX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    startY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    recTtsBtn.classList.add("vfo-tts-pressing");

    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      isLongPress = true;
      recTtsBtn.classList.remove("vfo-tts-pressing");
      triggerHaptic(35);
      openTtsQuickSettingsPopover(recTtsBtn, null, getRecSlot());
    }, LONG_PRESS_MS);
  };

  const movePress = (e) => {
    if (!pressTimer) return;
    const curX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const curY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    if (Math.hypot(curX - startX, curY - startY) > 10) {
      cancelPress();
    }
  };

  recTtsBtn.addEventListener("pointerdown", startPress);
  recTtsBtn.addEventListener("pointermove", movePress);
  recTtsBtn.addEventListener("pointerup", cancelPress);
  recTtsBtn.addEventListener("pointercancel", cancelPress);
  recTtsBtn.addEventListener("pointerleave", cancelPress);

  recTtsBtn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cancelPress();
    openTtsQuickSettingsPopover(recTtsBtn, null, getRecSlot());
  });

  recTtsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (isLongPress) {
      isLongPress = false;
      return;
    }
    const recMgr = window.recordingsManager || (window.__proxdmr && window.__proxdmr.recordingsManager);
    if (recMgr && typeof recMgr.toggleTtsPlayback === "function") {
      recMgr.toggleTtsPlayback();
    }
  });

  let keyTimer = null;
  let isKeyLongPress = false;
  recTtsBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      if (e.repeat) return;
      if (e.shiftKey || e.altKey) {
        e.preventDefault();
        openTtsQuickSettingsPopover(recTtsBtn, null, getRecSlot());
        return;
      }
      isKeyLongPress = false;
      keyTimer = setTimeout(() => {
        keyTimer = null;
        isKeyLongPress = true;
        openTtsQuickSettingsPopover(recTtsBtn, null, getRecSlot());
      }, LONG_PRESS_MS);
    }
  });
  recTtsBtn.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      if (keyTimer) {
        clearTimeout(keyTimer);
        keyTimer = null;
      }
      if (!isKeyLongPress) {
        e.preventDefault();
        const recMgr = window.recordingsManager || (window.__proxdmr && window.__proxdmr.recordingsManager);
        if (recMgr && typeof recMgr.toggleTtsPlayback === "function") {
          recMgr.toggleTtsPlayback();
        }
      }
      isKeyLongPress = false;
    }
  });
}

function toggleSlotTts(row, slot) {
  if (!row) return;
  const card = row.closest(".radio-container");
  const rawHid = card ? card.dataset.hotspotId : null;
  const hid = resolveHotspotId(rawHid || window.activeHotspotId);

  const isCurrentlyActive = isSlotTtsActive(hid, slot);
  const newState = !isCurrentlyActive;

  try {
    localStorage.setItem(getSlotTtsKey(hid, slot), newState ? "1" : "0");
  } catch (_) {}

  updateSlotTtsBadge(row, slot, newState);

  // Synchronize TTS Solo mode across all channels
  syncTtsSoloMode();

  // If TTS turned ON and transcription is OFF on this slot, auto-turn ON transcription
  if (newState && !row.classList.contains("has-transcribe")) {
    toggleSlotTranscribe(row, slot);
  } else if (newState) {
    // If transcription was already ON, also enforce mutual exclusion on TTS for other slot
    const otherSlot = slot === 1 ? 2 : 1;
    const otherRow = card ? card.querySelector(`.vfo-ts${otherSlot}-row`) : null;
    if (otherRow && isSlotTtsActive(hid, otherSlot)) {
      try {
        localStorage.setItem(getSlotTtsKey(hid, otherSlot), "0");
      } catch (_) {}
      updateSlotTtsBadge(otherRow, otherSlot, false);
      const ws = getWs();
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: "set_tts_slot",
            hotspot_id: hid,
            slot: otherSlot,
            enabled: false
          }));
        } catch (_) {}
      }
      if (window.ttsAudioQueueManager) {
        window.ttsAudioQueueManager.stopSlot(hid, otherSlot);
      }
    }
  }

  const ws = getWs();
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({
        type: "set_tts_slot",
        hotspot_id: hid,
        slot: slot,
        enabled: newState
      }));
    } catch (err) {
      console.error("[TRANSCRIBER] Failed to send set_tts_slot:", err);
    }
  }

  if (newState) {
    showToast(`✓ Голосовой синтез TS${slot} включен`, 2000);
    if (window.ttsAudioQueueManager) {
      window.ttsAudioQueueManager.syncIdleDucking(0.15);
    }
  } else {
    if (window.ttsAudioQueueManager) {
      window.ttsAudioQueueManager.stopSlot(hid, slot);
    }
    showToast(`✕ Голосовой синтез TS${slot} выключен`, 2000);
  }
}

// ── TTS Audio Queue Manager (Sequential Playback, Dynamic Catch-up Rate & Ducking) ──
class TtsAudioQueueManager {
  constructor() {
    this.queue = [];
    this.isPlaying = false;
    this.currentAudio = null;
    this.currentTtsHandle = null;
    this.activeHotspotId = null;
    this.activeSlot = null;
  }

  enqueue(item) {
    if (!item) return;
    this.queue.push(item);
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  playNext() {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      this.finishPlayback();
      return;
    }

    this.isPlaying = true;
    const item = this.queue.shift();
    this.currentItem = item;
    const hid = resolveHotspotId(item.hotspot_id);
    const slot = item.slot || 1;
    this.activeHotspotId = hid;
    this.activeSlot = slot;

    // Visual pulse on VFO TTS badge
    this.setBadgeSpeaking(hid, slot, true);

    // Duck original DMR radio channels
    const duckLevel = (item.ducking_level !== undefined && item.ducking_level !== null)
      ? item.ducking_level
      : ((window.transcriberSettings && window.transcriberSettings.tts_ducking_level) !== undefined
          ? window.transcriberSettings.tts_ducking_level
          : 0.80);
    const muteOthers = item.mute_others !== false;
    this.applyDucking(hid, slot, duckLevel, muteOthers);

    // Playback speed: configurable 1.0x - 2.0x (default 1.1x)
    const effectiveSpeed = (item.speed !== undefined && item.speed !== null)
      ? Number(item.speed)
      : ((window.transcriberSettings && window.transcriberSettings.tts_speed !== undefined)
          ? Number(window.transcriberSettings.tts_speed)
          : 1.1);
    const speed = Math.max(1.0, Math.min(2.0, effectiveSpeed || 1.1));

    if (item.engine === "browser" || (!item.audio_base64 && item.text)) {
      this.playBrowserSpeech(item, speed);
    } else if (item.audio_base64) {
      this.playAudioBase64(item, speed);
    } else {
      this.playNext();
    }
  }

  playAudioBase64(item, speed) {
    const hid = resolveHotspotId(item.hotspot_id);
    const slot = item.slot || 1;
    try {
      const binaryString = atob(item.audio_base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const player = window.dmrAudioPlayer || window.audioPlayer;
      // Piper already synthesizes speech at fixed 1.1x natively on backend (via length_scale).
      // Web Audio playbackRate for Piper is 1.0 to preserve native pitch and avoid double acceleration.
      // For other engines (Gemini/fallback), effectiveRate is fixed at 1.1x.
      const effectiveRate = (item.engine === "piper") ? 1.0 : (parseFloat(speed) || 1.1);

      if (player && typeof player.playTtsAudio === "function") {
        let endedCalled = false;
        const onDone = () => {
          if (endedCalled) return;
          endedCalled = true;
          this.currentTtsHandle = null;
          this.setBadgeSpeaking(hid, slot, false);
          this.playNext();
        };

        player.playTtsAudio(hid, slot, bytes.buffer, effectiveRate, onDone, {
          isTest: Boolean(item.is_test || item.bypassMute),
          bypassMute: Boolean(item.bypassMute || item.is_test)
        })
          .then(handle => {
            this.currentTtsHandle = handle;
          })
          .catch(err => {
            console.warn("[TTS] Web Audio playTtsAudio failed, falling back to Audio element:", err);
            this.playAudioBase64Fallback(item, effectiveRate, bytes);
          });
        return;
      }

      this.playAudioBase64Fallback(item, effectiveRate, bytes);
    } catch (err) {
      console.error("[TTS] Failed to decode base64 audio:", err);
      this.setBadgeSpeaking(hid, slot, false);
      this.playNext();
    }
  }

  playAudioBase64Fallback(item, speed, bytes) {
    const hid = resolveHotspotId(item.hotspot_id);
    const slot = item.slot || 1;
    try {
      const blob = new Blob([bytes.buffer], { type: "audio/wav" });
      const blobUrl = URL.createObjectURL(blob);

      const audio = new Audio(blobUrl);
      this.currentAudio = audio;
      audio.preservesPitch = true;
      audio.playbackRate = speed;

      // Apply calibrated volume
      this.syncCurrentVolume();

      const cleanup = () => {
        try { URL.revokeObjectURL(blobUrl); } catch (_) {}
        this.currentAudio = null;
        this.setBadgeSpeaking(hid, slot, false);
      };

      audio.onended = () => {
        cleanup();
        this.playNext();
      };

      audio.onerror = (e) => {
        console.warn("[TTS] Audio playback error:", e);
        cleanup();
        this.playNext();
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.warn("[TTS] Autoplay prevented or audio play error:", err);
          cleanup();
          this.playNext();
        });
      }
    } catch (err) {
      console.error("[TTS] Fallback playback exception:", err);
      this.setBadgeSpeaking(hid, slot, false);
      this.playNext();
    }
  }

  playBrowserSpeech(item, speed) {
    if (!window.speechSynthesis) {
      console.warn("[TTS] Web Speech API not supported");
      this.setBadgeSpeaking(item.hotspot_id, item.slot, false);
      this.playNext();
      return;
    }

    const hid = resolveHotspotId(item.hotspot_id);
    const slot = item.slot || 1;

    try {
      const rawText = item.text || "";
      const targetLang = (window.transcriberSettings && window.transcriberSettings.target_lang) || "ru";
      const cleanText = cleanTextForClientTts(rawText, targetLang);
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = Math.max(0.7, Math.min(2.0, speed));
      if (targetLang && targetLang !== "none") {
        utterance.lang = BCP47_LANG_MAP[targetLang] || targetLang;
      }

      // Voice pitch modulation based on detected operator pitch & gender
      let pitchVal = 1.0;
      const p = (item.pitch || "medium").toLowerCase();
      const g = (item.gender || "male").toLowerCase();
      if (p === "low") {
        pitchVal = 0.85;
      } else if (p === "high") {
        pitchVal = 1.25;
      }
      if (g === "female" && pitchVal <= 1.0) {
        pitchVal = Math.min(1.4, pitchVal * 1.15);
      }
      utterance.pitch = pitchVal;

      // Scale volume according to hotspot volume and mute states
      let vol = 80;
      if (typeof window.getHotspotVolume === "function") {
        vol = window.getHotspotVolume(hid);
      } else {
        const v = localStorage.getItem(`proxdmr_vol_${hid}`);
        if (v !== null) vol = parseInt(v, 10) || 80;
      }
      let isMuted = false;
      const isTestItem = Boolean(item && (item.is_test || item.bypassMute));
      if (!isTestItem) {
        if (typeof window.isGlobalAudioMuted === "function" && window.isGlobalAudioMuted()) isMuted = true;
        if (typeof window.isHotspotAudioMuted === "function" && window.isHotspotAudioMuted(hid)) isMuted = true;
        if (typeof window.getHotspotMute === "function" && window.getHotspotMute(hid, slot)) isMuted = true;
      }

      // Web Speech API utterance.volume range is 0.0 - 1.0. Calibrate to match DMR audio level (~0.40 max)
      utterance.volume = isMuted ? 0.0 : Math.max(0.0, Math.min(1.0, (vol / 100.0) * 0.40));

      // Select system voice by gender if available
      try {
        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          const langPrefix = targetLang.substring(0, 2).toLowerCase();
          const matchingLangVoices = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(langPrefix));
          const pool = matchingLangVoices.length > 0 ? matchingLangVoices : voices;
          if (g === "female") {
            const femaleVoice = pool.find(v => /(female|woman|девушка|женский|anna|irina|elena|tatyana|maria|yandex)/i.test(v.name));
            if (femaleVoice) utterance.voice = femaleVoice;
          } else {
            const maleVoice = pool.find(v => /(male|man|мужской|pavel|dmitry|aleksandr|boris|yuriy)/i.test(v.name));
            if (maleVoice) utterance.voice = maleVoice;
          }
        }
      } catch (_) {}

      utterance.onend = () => {
        this.setBadgeSpeaking(hid, slot, false);
        this.playNext();
      };

      utterance.onerror = (err) => {
        console.warn("[TTS] SpeechSynthesis error:", err);
        this.setBadgeSpeaking(hid, slot, false);
        this.playNext();
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error("[TTS] SpeechSynthesis exception:", err);
      this.setBadgeSpeaking(hid, slot, false);
      this.playNext();
    }
  }

  syncIdleDucking(fadeTimeSec = 0.20) {
    const player = window.dmrAudioPlayer || window.audioPlayer;
    if (!player) return;
    const s = window.transcriberSettings || {};
    const rawPauseDuck = (s.tts_pause_ducking_level !== undefined && s.tts_pause_ducking_level !== null)
      ? s.tts_pause_ducking_level
      : 1.0;
    const pauseDuckLevel = Math.max(0.0, Math.min(1.0, Number(rawPauseDuck)));
    const soloMode = (s.tts_mute_others !== false);

    let hasActiveTts = false;
    if (player.channels && player.channels.forEach) {
      player.channels.forEach((channel, hidKey) => {
        const hid = resolveHotspotId(hidKey);
        if (isSlotTtsActive(hid, 1) || isSlotTtsActive(hid, 2)) {
          hasActiveTts = true;
        }
      });
    }
    const summaryReader = (typeof window !== "undefined" && (window.summaryTtsReader || (window.__proxdmr && window.__proxdmr.summaryTtsReader))) || null;
    if (summaryReader && summaryReader.isPlaying) {
      hasActiveTts = true;
    }

    if (player.channels && player.channels.forEach) {
      player.channels.forEach((channel, hidKey) => {
        const hid = resolveHotspotId(hidKey);
        [1, 2].forEach(slot => {
          if (this.isPlaying && this.activeHotspotId === hid && this.activeSlot === slot) {
            return;
          }
          const isTts = isSlotTtsActive(hid, slot);
          if (isTts && pauseDuckLevel < 0.999) {
            channel.setSlotDucking(slot, true, pauseDuckLevel, fadeTimeSec);
          } else if (!isTts && soloMode && hasActiveTts) {
            channel.setSlotDucking(slot, true, 0.0, fadeTimeSec);
          } else {
            channel.setSlotDucking(slot, false, 1.0, fadeTimeSec);
          }
        });
      });
    }
  }

  applyDucking(hid, slot, duckLevel, muteOthers) {
    const player = window.dmrAudioPlayer || window.audioPlayer;
    if (!player) return;
    try {
      let rawVal = (duckLevel !== undefined && duckLevel !== null) ? Number(duckLevel) : 0.80;
      // rawVal: decimal factor (0.0..1.0) or percentage (0..100) representing DMR background volume level during TTS
      let residualGain = (rawVal > 1.0) ? (rawVal / 100.0) : rawVal;
      residualGain = Math.max(0.0, Math.min(1.0, residualGain));

      player.setSlotDucking(hid, slot, (residualGain < 0.999), residualGain, 0.12);
      if (muteOthers && typeof player.setOtherChannelsDucking === "function") {
        player.setOtherChannelsDucking(hid, slot, true, 0.0, 0.12);
      } else {
        const s = window.transcriberSettings || {};
        const rawPauseDuck = (s.tts_pause_ducking_level !== undefined && s.tts_pause_ducking_level !== null)
          ? s.tts_pause_ducking_level
          : 1.0;
        const pauseDuckLevel = Math.max(0.0, Math.min(1.0, Number(rawPauseDuck)));
        if (player.channels && player.channels.forEach) {
          player.channels.forEach((channel, hidKey) => {
            const chHid = resolveHotspotId(hidKey);
            [1, 2].forEach(sl => {
              if (chHid === hid && sl === slot) return;
              const isTts = isSlotTtsActive(chHid, sl);
              if (isTts && pauseDuckLevel < 0.999) {
                channel.setSlotDucking(sl, true, pauseDuckLevel, 0.12);
              } else {
                channel.setSlotDucking(sl, false, 1.0, 0.12);
              }
            });
          });
        }
      }
    } catch (e) {
      console.warn("[TTS] Ducking error:", e);
    }
  }

  updateLiveDucking(newLevel) {
    if (!this.isPlaying) return;
    const hid = this.activeHotspotId || (typeof window.getActiveHotspotId === "function" ? window.getActiveHotspotId() : "default");
    const slot = this.activeSlot || 1;
    const s = window.transcriberSettings || {};
    const muteOthers = (s.tts_mute_others !== undefined) ? Boolean(s.tts_mute_others) : true;
    this.applyDucking(hid, slot, newLevel, muteOthers);
  }

  finishPlayback() {
    this.setBadgeSpeaking(this.activeHotspotId, this.activeSlot, false);
    this.isPlaying = false;
    this.activeHotspotId = null;
    this.activeSlot = null;
    this.syncIdleDucking(0.25);
  }

  stopSlot(hid, slot) {
    const targetHid = resolveHotspotId(hid);
    const targetSlot = parseInt(slot, 10) || 1;

    // 1. Purge pending items for this slot from queue
    this.queue = this.queue.filter(item => {
      const itemHid = resolveHotspotId(item.hotspot_id);
      const itemSlot = parseInt(item.slot, 10) || 1;
      return !(itemHid === targetHid && itemSlot === targetSlot);
    });

    // 2. If the active playback is on this slot, abort immediately
    const isCurrentActive = (
      (this.activeHotspotId === targetHid || !this.activeHotspotId) &&
      (this.activeSlot === targetSlot || !this.activeSlot)
    );

    if (this.isPlaying && isCurrentActive) {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch (_) {}
      }
      if (this.currentTtsHandle && typeof this.currentTtsHandle.stop === "function") {
        try { this.currentTtsHandle.stop(); } catch (_) {}
        this.currentTtsHandle = null;
      }
      if (this.currentAudio) {
        try {
          this.currentAudio.pause();
          this.currentAudio.currentTime = 0;
          this.currentAudio.src = "";
        } catch (_) {}
        this.currentAudio = null;
      }
      this.finishPlayback();

      if (this.queue.length > 0) {
        setTimeout(() => this.playNext(), 50);
      }
    } else {
      this.syncIdleDucking(0.20);
    }
  }

  stopAll() {
    this.queue = [];
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
    if (this.currentTtsHandle && typeof this.currentTtsHandle.stop === "function") {
      try { this.currentTtsHandle.stop(); } catch (_) {}
      this.currentTtsHandle = null;
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio.src = "";
      } catch (_) {}
      this.currentAudio = null;
    }
    this.finishPlayback();
    this.isPlaying = false;
  }

  syncCurrentVolume() {
    const hid = this.activeHotspotId || (this.currentTtsHandle && this.currentTtsHandle.hotspotId) || "default";
    const slot = this.activeSlot || (this.currentTtsHandle && this.currentTtsHandle.slot) || 1;

    let vol = 80;
    if (typeof window.getHotspotVolume === "function") {
      vol = window.getHotspotVolume(hid);
    } else {
      const v = localStorage.getItem(`proxdmr_vol_${hid}`);
      if (v !== null) vol = parseInt(v, 10) || 80;
    }

    let isMuted = false;
    const isTestItem = Boolean(this.currentItem && (this.currentItem.is_test || this.currentItem.bypassMute));
    if (!isTestItem) {
      if (typeof window.isGlobalAudioMuted === "function" && window.isGlobalAudioMuted()) {
        isMuted = true;
      } else if (typeof window.isHotspotAudioMuted === "function" && window.isHotspotAudioMuted(hid)) {
        isMuted = true;
      } else if (typeof window.getHotspotMute === "function" && window.getHotspotMute(hid, slot)) {
        isMuted = true;
      }
    }

    // 1. If WebAudio TTS handle is active
    if (this.currentTtsHandle && this.currentTtsHandle.gainNode) {
      try {
        const targetGain = isMuted ? 0.0 : 0.70;
        const now = (this.currentTtsHandle.audioCtx && this.currentTtsHandle.audioCtx.currentTime) || 0;
        this.currentTtsHandle.gainNode.gain.cancelScheduledValues(now);
        this.currentTtsHandle.gainNode.gain.setValueAtTime(targetGain, now);
      } catch (_) {}
    }

    // 2. If HTML5 fallback Audio element is active
    if (this.currentAudio) {
      try {
        const linearVol = isMuted ? 0.0 : Math.max(0.0, Math.min(1.0, (vol / 100.0) * 0.35));
        this.currentAudio.volume = linearVol;
      } catch (_) {}
    }
  }

  setBadgeSpeaking(hid, slot, isSpeaking) {
    if (!hid) return;
    const card = document.querySelector(`.radio-container[data-hotspot-id="${resolveHotspotId(hid)}"]`) ||
                 document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`);
    if (!card) return;
    const row = card.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
    if (!row) return;
    const badge = row.querySelector(".vfo-tts-badge");
    if (badge) {
      badge.classList.toggle("tts-speaking", Boolean(isSpeaking));
    }
  }

  clear() {
    this.stopAll();
  }
}

window.ttsAudioQueueManager = new TtsAudioQueueManager();

function handleTtsSpeech(msg) {
  if (!msg) return;
  const hid = resolveHotspotId(msg.hotspot_id);
  const slot = msg.slot || 1;
  if (!isSlotTtsActive(hid, slot)) return;
  if (window.ttsAudioQueueManager) {
    window.ttsAudioQueueManager.enqueue(msg);
  }
}


function resolveTranscribeCallsign(msg, targetCard, vfoRow, slot, callEntry) {
  if (msg && msg.callsign && typeof msg.callsign === "string") {
    const cs = msg.callsign.trim().toUpperCase();
    if (cs && cs !== "---" && cs !== "UNKNOWN" && cs !== "DMR" && !cs.startsWith("ID ")) {
      return cs;
    }
  }
  if (callEntry) {
    const cs = (callEntry.src_callsign || callEntry.callsign || "").trim().toUpperCase();
    if (cs && cs !== "---" && cs !== "UNKNOWN" && cs !== "DMR" && !cs.startsWith("ID ")) {
      return cs;
    }
  }
  if (targetCard && targetCard._lastRx && targetCard._lastRx[slot]) {
    const cs = (targetCard._lastRx[slot].src_callsign || "").trim().toUpperCase();
    if (cs && cs !== "---" && cs !== "UNKNOWN" && cs !== "DMR" && !cs.startsWith("ID ")) {
      return cs;
    }
  }
  if (vfoRow) {
    const callerCallEl = vfoRow.querySelector(".vfo-caller-call");
    if (callerCallEl) {
      const dsCall = (callerCallEl.dataset.callsign || "").trim().toUpperCase();
      if (dsCall && dsCall !== "---" && dsCall !== "UNKNOWN" && dsCall !== "DMR" && !dsCall.startsWith("ID ")) {
        return dsCall;
      }
      const textCall = (callerCallEl.textContent || "").trim().toUpperCase();
      if (textCall && !textCall.includes("ОЖИДАНИЕ") && !textCall.includes("STANDBY") && textCall !== "---" && textCall !== "UNKNOWN" && textCall !== "DMR" && !textCall.startsWith("ID ")) {
        return textCall;
      }
    }
  }
  const srcId = (msg && msg.src_id) || (callEntry && callEntry.src_id) || (targetCard && targetCard._lastRx && targetCard._lastRx[slot] && targetCard._lastRx[slot].src_id);
  if (srcId) {
    return `ID ${srcId}`;
  }
  return "DMR";
}

function formatCaptionEntryHtml(entry) {
  if (!entry) return "";
  const cs = (entry.callsign || "DMR").trim();
  const textHtml = formatCaptionHtml((entry.text || "").trim());
  const country = getCountryInfo(entry.srcId, cs);
  const flagHtml = getFlagBadgeHtml(country, false, (country && country.flag) ? country.flag : "🌐");
  return `<div class="vfo-caption-entry"><span class="vfo-caption-badge"><span class="vfo-caption-flag">${flagHtml}</span> <strong class="vfo-caption-callsign">${safeEscapeHtml(cs)}</strong></span>: <span class="vfo-caption-text">${textHtml}</span></div>`;
}

function updateCallLogTranscription(msg) {
  if (!msg || !msg.text) return null;
  const newChunk = (msg.text || "").trim();
  if (!newChunk) return null;

  const targetHid = resolveHotspotId(msg.hotspot_id);
  const callId = msg.call_id ? String(msg.call_id) : "";
  const recId = msg.recording_id ? String(msg.recording_id) : "";
  const srcId = msg.src_id ? Number(msg.src_id) : null;
  const createdAt = msg.created_at ? Number(msg.created_at) : null;
  const slot = msg.slot ? Number(msg.slot) : 1;
  const now = Date.now();

  // 1. Resolve matching callEntry from heardCalls
  let callEntry = null;
  if (callId) {
    callEntry = (window.heardCalls || []).find(c => String(c.id) === callId);
  }
  if (!callEntry && recId) {
    callEntry = (window.heardCalls || []).find(c => String(c.id) === recId || String(c.recording_id) === recId);
  }
  if (!callEntry && srcId && createdAt) {
    callEntry = (window.heardCalls || []).find(c => {
      const cTime = c.timestamp || 0;
      return Number(c.src_id) === srcId && Math.abs(cTime - createdAt) < 5.0;
    });
  }
  if (!callEntry && srcId) {
    callEntry = (window.heardCalls || []).find(c => {
      const cHid = c.hotspot_id || "default";
      return (cHid === targetHid || cHid === msg.hotspot_id) &&
             c.slot === slot &&
             Number(c.src_id) === srcId &&
             (now / 1000 - (c.timestamp || 0) < 120);
    });
  }

  // 2. Update or insert callEntry
  if (callEntry) {
    if (callEntry.transcription) {
      if (!callEntry.transcription.includes(newChunk)) {
        callEntry.transcription = `${callEntry.transcription} ${newChunk}`.trim();
      }
    } else {
      callEntry.transcription = newChunk;
    }
    if (msg.lang && msg.lang !== "---") {
      callEntry.transcription_lang = msg.lang;
    }
  } else if (callId || recId) {
    const timeVal = createdAt || (Date.now() / 1000);
    const dateObj = new Date(timeVal * 1000);
    const timeStr = dateObj.toTimeString().substring(0, 8);
    callEntry = {
      id: callId || recId,
      recording_id: recId,
      hotspot_id: targetHid || "default",
      slot: slot,
      src_id: srcId || 0,
      src_callsign: (msg.callsign && msg.callsign !== "DMR" && !msg.callsign.startsWith("ID ")) ? msg.callsign : (msg.src_callsign || ""),
      src_name: msg.src_name || "",
      dst_id: msg.dst_id || 0,
      call_type: "GROUP",
      active: false,
      timestamp: timeVal,
      time_str: timeStr,
      duration: msg.duration || 0,
      transcription: newChunk,
      transcription_lang: (msg.lang && msg.lang !== "---") ? msg.lang : ""
    };
    if (window.heardCalls) { window.heardCalls.unshift(callEntry); }
    pruneHeardCalls();
  }

  // 3. Update window.recordingsManager if available
  if (window.recordingsManager) {
    if (callId) window.recordingsManager.recordedCallIds.add(callId);
    if (recId) window.recordingsManager.recordedCallIds.add(recId);
    if (Array.isArray(window.recordingsManager.recordings)) {
      const rItem = window.recordingsManager.recordings.find(r => 
        (recId && String(r.id) === recId) || (callId && String(r.call_id) === callId)
      );
      if (rItem) {
        rItem.transcription = newChunk;
        if (msg.lang && msg.lang !== "---") rItem.transcription_lang = msg.lang;
      }
    }
    if (window.recordingsManager.currentRecording) {
      const cr = window.recordingsManager.currentRecording;
      if ((recId && String(cr.id) === recId) || (callId && String(cr.call_id) === callId)) {
        cr.transcription = newChunk;
        if (msg.lang && msg.lang !== "---") cr.transcription_lang = msg.lang;
      }
    }
  }

  // 4. Always re-render Live Activity Log (dynamic update of history markers!)
  renderLogList();

  // 5. Update active popover if currently viewing this call
  if (typeof updateLogTranscriptionPopoverIfActive === "function" && callEntry) {
    updateLogTranscriptionPopoverIfActive(callEntry);
  }

  // 6. Always update 24h Transcription Summary if open (dynamic update of transcript mode!)
  if (typeof renderTranscriptionSummary === "function" && window.isTranscriptionSummaryOpen) {
    renderTranscriptionSummary();
  }

  return callEntry;
}

function setLangBadgeText(badge, code) {
  if (!badge) return;
  let micSpan = badge.querySelector(".lang-icon-mic");
  let textSpan = badge.querySelector(".lang-code-text");
  if (!micSpan || !textSpan) {
    badge.innerHTML = `<span class="lang-icon-mic">🎙️</span><span class="lang-code-text">${code || "TXT"}</span>`;
  } else {
    textSpan.textContent = code || "TXT";
  }
}

function getLangBadgeText(badge) {
  if (!badge) return "";
  const textSpan = badge.querySelector(".lang-code-text");
  if (textSpan) return textSpan.textContent.trim();
  return badge.textContent.replace(/🎙️/g, "").trim();
}

function handleCallTranscription(msg) {
  if (!msg || !msg.text) return;

  // A. Always update call log, markers, and transcription summary first!
  const callEntry = updateCallLogTranscription(msg);

  // B. Live VFO Card & teleprompter display (only if card and has-transcribe is active on this slot)
  const targetHid = resolveHotspotId(msg.hotspot_id);
  const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${targetHid}"]`) ||
                     document.querySelector(`.radio-container[data-hotspot-id="${msg.hotspot_id}"]`);
  if (!targetCard) return;

  const slot = msg.slot || 1;
  const vfoRow = targetCard.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
  if (!vfoRow || !vfoRow.classList.contains("has-transcribe")) return;

  // 1. Update language badge
  const langBadge = vfoRow.querySelector(".vfo-lang-badge");
  if (langBadge) {
    langBadge.classList.remove("has-ai-error", "ai-error-blink");
    if (langBadge._errorTimer) {
      clearTimeout(langBadge._errorTimer);
      langBadge._errorTimer = null;
    }
    if (msg.lang && msg.lang !== "---") {
      setLangBadgeText(langBadge, msg.lang.toUpperCase());
      langBadge.classList.add("has-lang");
      langBadge.title = window.t ? window.t("transcriber.lang_original_title", { lang: msg.lang.toUpperCase() }, `Язык оригинала речи: ${msg.lang.toUpperCase()}`) : `Язык оригинала речи: ${msg.lang.toUpperCase()}`;
    }
  }

  // 2. Update caption stream and teleprompter
  const captionStream = vfoRow.querySelector(".vfo-caption-stream");
  const captionBox = vfoRow.querySelector(".vfo-caption-box");
  if (!captionStream || !captionBox) return;

  const now = Date.now();
  const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes retention

  const callerCallsign = resolveTranscribeCallsign(msg, targetCard, vfoRow, slot, callEntry);
  const resolvedSrcId = msg.src_id || (callEntry && callEntry.src_id) || null;
  const currentCallKey = `${msg.src_id || ""}_${callerCallsign || msg.callsign || ""}`;
  const newChunk = (msg.text || "").trim();

  if (newChunk) {
    if (!Array.isArray(captionStream._entries)) {
      captionStream._entries = [];
    }

    // 1. Prune entries older than 30 minutes
    captionStream._entries = captionStream._entries.filter(e => (now - e.timestamp) <= MAX_AGE_MS);

    // 2. Check if this chunk continues the last active transmission
    const lastEntry = captionStream._entries[captionStream._entries.length - 1];
    const isSameCall = lastEntry && (
      (msg.call_id && lastEntry.callId && msg.call_id === lastEntry.callId) ||
      (lastEntry.callKey === currentCallKey && (now - (captionStream._lastMsgTime || 0)) < 12000)
    );

    if (isSameCall) {
      if (!lastEntry.text.includes(newChunk)) {
        lastEntry.text = lastEntry.text ? `${lastEntry.text} ${newChunk}` : newChunk;
      }
      lastEntry.timestamp = now;
      // Upgrade fallback callsign if real callsign became known
      if (callerCallsign && callerCallsign !== "DMR" && (!lastEntry.callsign || lastEntry.callsign === "DMR" || lastEntry.callsign.startsWith("ID "))) {
        lastEntry.callsign = callerCallsign;
      }
      if (!lastEntry.srcId && resolvedSrcId) {
        lastEntry.srcId = resolvedSrcId;
      }
    } else {
      captionStream._entries.push({
        id: msg.call_id || `${currentCallKey}_${now}`,
        callKey: currentCallKey,
        callId: msg.call_id || null,
        callsign: callerCallsign,
        srcId: resolvedSrcId,
        timestamp: now,
        text: newChunk
      });
    }

    // 3. Keep within 30-minute limit
    captionStream._entries = captionStream._entries.filter(e => (now - e.timestamp) <= MAX_AGE_MS);

    captionStream._lastCallKey = currentCallKey;
    captionStream._lastCallId = msg.call_id || null;
    captionStream._lastMsgTime = now;

    // 4. Render accumulated messages as discrete entries with caller badge
    if (captionStream._entries.length === 0) {
      captionStream.innerHTML = "";
    } else {
      captionStream.innerHTML = captionStream._entries
        .map(formatCaptionEntryHtml)
        .join("");
    }

    // 5. Autoscroll only if user hasn't scrolled up to read earlier text
    requestAnimationFrame(() => {
      if (!captionBox._isUserScrolled) {
        captionBox.scrollTop = captionBox.scrollHeight;
      }
    });
  }
}

function triggerSlotTranscribeError(langBadge, slot, errorMsg) {
  if (!langBadge) return;
  console.warn(`[TRANSCRIBER] Gemini TS${slot} raw error:`, errorMsg);
  const cleanError = formatGeminiError(errorMsg, "transcribe");
  langBadge.title = `⚠️ Gemini (TS${slot}): ${cleanError}`;

  // Restart 1Hz 5-cycle blink cleanly (5 cycles: 5 seconds total)
  langBadge.classList.remove("ai-error-blink");
  void langBadge.offsetWidth;
  langBadge.classList.add("ai-error-blink");
  langBadge.classList.add("has-ai-error");

  if (langBadge._errorTimer) clearTimeout(langBadge._errorTimer);
  langBadge._errorTimer = setTimeout(() => {
    langBadge.classList.remove("ai-error-blink");
  }, 5050);

  showToast(`⚠️ Gemini (TS${slot}): ${cleanError}`, 3500);
}

function handleTtsError(msg) {
  if (!msg) return;
  const slot = msg.slot || 1;
  console.warn(`[TTS] Slot TS${slot} raw error:`, msg);
  const cleanError = formatGeminiError(msg.error || msg.message, "tts");
  showToast(`⚠️ TTS (TS${slot}): ${cleanError}`, 3500);
}
window.handleTtsError = handleTtsError;
if (window.__proxdmr) window.__proxdmr.handleTtsError = handleTtsError;

function handleTranscriptionError(msg) {
  if (!msg) return;
  const targetHid = resolveHotspotId(msg.hotspot_id);
  const targetCard = document.querySelector(`.radio-container[data-hotspot-id="${targetHid}"]`) ||
                     document.querySelector(`.radio-container[data-hotspot-id="${msg.hotspot_id}"]`);
  if (!targetCard) return;

  const slot = msg.slot || 1;
  const vfoRow = targetCard.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
  if (!vfoRow) return;

  const langBadge = vfoRow.querySelector(".vfo-lang-badge");
  if (!langBadge) return;

  triggerSlotTranscribeError(langBadge, slot, msg.error);
}

function updateSlotLangBadge(row, slot, isActive, langCode = null) {
  if (!row) return;
  const langBadge = row.querySelector(".vfo-lang-badge");
  if (!langBadge) return;

  if (isActive) {
    langBadge.classList.add("transcribe-on");
    if (langCode && langCode !== "---") {
      setLangBadgeText(langBadge, langCode.toUpperCase());
      langBadge.classList.add("has-lang");
      langBadge.title = window.t ? window.t("transcriber.lang_badge_on", { slot, lang: langCode.toUpperCase() }, `Транскрибатор TS${slot}: ВКЛЮЧЕН (Язык: ${langCode.toUpperCase()}). Клик — выкл, удержание — параметры`) : `Транскрибатор TS${slot}: ВКЛЮЧЕН (Язык: ${langCode.toUpperCase()}). Клик — выкл, удержание — параметры`;
    } else {
      const curText = getLangBadgeText(langBadge);
      if (!curText || curText === "---" || curText === "AI" || curText === "TXT") {
        setLangBadgeText(langBadge, "TXT");
      }
      langBadge.title = window.t ? window.t("transcriber.lang_badge_on", { slot, lang: "AUTO" }, `Транскрибатор TS${slot}: ВКЛЮЧЕН. Клик — выкл, удержание — параметры`) : `Транскрибатор TS${slot}: ВКЛЮЧЕН. Клик — выкл, удержание — параметры`;
    }
  } else {
    langBadge.classList.remove("transcribe-on", "has-lang", "has-ai-error", "ai-error-blink");
    if (langBadge._errorTimer) {
      clearTimeout(langBadge._errorTimer);
      langBadge._errorTimer = null;
    }
    setLangBadgeText(langBadge, "TXT");
    langBadge.title = window.t ? window.t("transcriber.lang_badge_off", { slot }, `Транскрибатор TS${slot}: выключен. Клик — вкл, удержание — параметры`) : `Транскрибатор TS${slot}: выключен. Клик — вкл, удержание — параметры`;
  }
}

// --- Transcriber Model Picker Subsystem ---
const TRANSCRIBER_MODELS_META = {
  "gemini-3.1-flash-lite": { name: "Gemini 3.1 Flash-Lite", badgeKey: "transcriber.model_badge_free", badge: "Free Tier", descKey: "transcriber.model_desc_31_flash_lite", desc: "⚡ Free Tier (Ультрабыстрая, для бесплатных ключей)" },
  "gemini-3.5-flash": { name: "Gemini 3.5 Flash", badgeKey: "transcriber.model_badge_rec", badge: "Рекомендуется", descKey: "transcriber.model_desc_35_flash", desc: "⚡ Оптимальный баланс скорости и качества" },
  "gemini-3.5-flash-lite": { name: "Gemini 3.5 Flash-Lite", badgeKey: "transcriber.model_badge_fast", badge: "Ультрабыстрая", descKey: "transcriber.model_desc_35_flash_lite", desc: "🚀 Минимальная задержка отклика в плотном эфире" },
  "gemini-3.1-flash-lite-preview": { name: "Gemini 3.1 Flash-Lite Preview", badgeKey: "transcriber.model_badge_fast", badge: "Free Preview", descKey: "transcriber.model_desc_31_flash_lite_prev", desc: "⚡ Предварительная версия Flash-Lite" },
  "gemini-3.6-flash": { name: "Gemini 3.6 Flash", badgeKey: "transcriber.model_badge_new", badge: "Новое поколение", descKey: "transcriber.model_desc_36_flash", desc: "✨ Улучшенное распознавание зашумленной речи" },
  "gemini-3.7-flash": { name: "Gemini 3.7 Flash", badgeKey: "transcriber.model_badge_new", badge: "Flash 3.7", descKey: "transcriber.model_desc_37_flash", desc: "⚡ Новая гибридная модель Flash" },
  "gemini-3.8-flash": { name: "Gemini 3.8 Flash", badgeKey: "transcriber.model_badge_new", badge: "Flash 3.8", descKey: "transcriber.model_desc_38_flash", desc: "⚡ Новейшая версия Flash" },
  "gemini-flash-latest": { name: "Gemini Flash Latest", badgeKey: "transcriber.model_badge_auto", badge: "Авто Flash", descKey: "transcriber.model_desc_flash_latest", desc: "🔄 Самая свежая стабильная версия Flash" },
  "gemini-flash-lite-latest": { name: "Gemini Flash-Lite Latest", badgeKey: "transcriber.model_badge_auto_lite", badge: "Авто Lite", descKey: "transcriber.model_desc_flash_lite_latest", desc: "🔄 Самая свежая облегченная версия Lite" },
  "gemini-2.5-flash": { name: "Gemini 2.5 Flash", badge: "Flash 2.5", descKey: "transcriber.model_desc_25_flash", desc: "⚡ Стабильная рабочая модель Flash" },
  "gemini-2.5-flash-lite": { name: "Gemini 2.5 Flash-Lite", badge: "Lite 2.5", descKey: "transcriber.model_desc_25_flash_lite", desc: "⚡ Облегченная стабильная модель Flash-Lite" },
  "gemini-3.5-transcribe": { name: "Gemini 3.5 Transcribe", badge: "ASR", descKey: "transcriber.model_desc_35_transcribe", desc: "🎙️ Распознавание речи радиоэфира" },
  "gemini-3.1-pro-preview": { name: "Gemini 3.1 Pro", badgeKey: "transcriber.model_badge_pro", badge: "Pro", descKey: "transcriber.model_desc_31_pro", desc: "🧠 Флагманская модель с глубоким пониманием радио-жаргона" },
  "gemini-2.5-pro": { name: "Gemini 2.5 Pro", badgeKey: "transcriber.model_badge_pro", badge: "Pro", descKey: "transcriber.model_desc_25_pro", desc: "🧠 Качественный контекстный анализ речи" },
};

const TTS_MODELS_META = {
  "gemini-3.1-flash-tts-preview": { name: "Gemini 3.1 Flash TTS Preview", badgeKey: "transcriber.model_badge_rec", badge: "Рекомендуется", descKey: "transcriber.tts_model_desc_31_flash", desc: "Новейшая TTS: низкая задержка, 30 голосов, поддержка стриминга, мульти-спикеры." },
  "gemini-3.8-flash-lite-tts": { name: "Gemini 3.8 Flash-Lite TTS", badgeKey: "transcriber.model_badge_fast", badge: "Быстрая TTS", descKey: "transcriber.tts_model_desc_38_flash_lite", desc: "Облегченная модель генерации речи Text-to-Speech с ультранизкой задержкой." },
  "gemini-3.8-flash-tts": { name: "Gemini 3.8 Flash TTS", badge: "TTS", descKey: "transcriber.tts_model_desc_38_flash", desc: "Полноформатная модель Text-to-Speech высокого качества." },
  "gemini-2.5-flash-preview-tts": { name: "Gemini 2.5 Flash TTS Preview", badgeKey: "transcriber.model_badge_fast", badge: "Быстрая", descKey: "transcriber.tts_model_desc_25_flash", desc: "Быстрая и экономичная генерация речи с минимальной задержкой." },
  "gemini-2.5-pro-preview-tts": { name: "Gemini 2.5 Pro TTS Preview", badgeKey: "transcriber.model_badge_pro", badge: "Pro", descKey: "transcriber.tts_model_desc_25_pro", desc: "Студийное качество синтеза речи — для подкастов и аудиокниг. Только платный тариф." },
  "gemini-3.1-flash-live-preview": { name: "Gemini 3.1 Flash Live", badgeKey: "transcriber.model_badge_new", badge: "Live Voice", descKey: "transcriber.tts_model_desc_31_live", desc: "Интерактивная голосовая модель реального времени Live API." },
};

function getLocalizedModelLabel(m, isTts = false) {
  const id = (typeof m === 'string') ? m : (m ? (m.id || m.value) : "");
  const meta = isTts ? (TTS_MODELS_META[id] || {}) : (TRANSCRIBER_MODELS_META[id] || {});
  const name = meta.name || (typeof m === 'object' && m ? (m.name || id) : id);
  const desc = (meta.descKey && window.t) ? window.t(meta.descKey, {}, meta.desc || (m && m.description) || "") : (meta.desc || (m && m.description) || "");
  const badge = (meta.badgeKey && window.t) ? window.t(meta.badgeKey, {}, meta.badge || (m && m.badge) || "") : (meta.badge || (m && m.badge) || "");

  if (isTts) {
    const badgePart = badge ? ` — ⚡ ${badge}` : (desc ? ` — ${desc}` : "");
    return { id, name, label: `${name}${badgePart}`, badge, title: desc };
  } else {
    const descPart = desc ? ` — ${desc}` : (badge ? ` — (${badge})` : "");
    return { id, name, label: `${name}${descPart}`, badge, title: desc };
  }
}

function renderTranscriberModelOptions(selectEl) {
  const el = selectEl || document.getElementById("optTranscriberModel");
  if (!el) return;
  const curVal = el.value || localStorage.getItem("proxdmr_transcribe_model") || "gemini-3.1-flash-lite";

  const models = (cachedTranscriberModels && cachedTranscriberModels.length > 0)
    ? cachedTranscriberModels.filter(m => {
        if (!m) return false;
        const id = (m.id || "").toLowerCase();
        return !id.includes("tts");
      })
    : DEFAULT_TRANSCRIBER_MODELS;

  el.innerHTML = "";
  models.forEach(m => {
    const info = getLocalizedModelLabel(m, false);
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = info.label;
    if (info.title) opt.title = info.title;
    if (m.id === curVal) opt.selected = true;
    el.appendChild(opt);
  });
  if (curVal && !Array.from(el.options).some(o => o.value === curVal)) {
    const opt = document.createElement("option");
    opt.value = curVal;
    opt.textContent = curVal;
    opt.selected = true;
    el.appendChild(opt);
  }
}
window.renderTranscriberModelOptions = renderTranscriberModelOptions;

function renderTtsModelOptions(selectEl) {
  const el = selectEl || document.getElementById("optTtsModel");
  if (!el) return;
  const curVal = el.value || localStorage.getItem("proxdmr_tts_model") || "gemini-3.1-flash-tts-preview";

  el.innerHTML = "";
  Object.keys(TTS_MODELS_META).forEach(id => {
    const meta = TTS_MODELS_META[id];
    const info = getLocalizedModelLabel({ id, ...meta }, true);
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = info.label;
    if (info.title) opt.title = info.title;
    if (id === curVal) opt.selected = true;
    el.appendChild(opt);
  });
  if (curVal && !Array.from(el.options).some(o => o.value === curVal)) {
    const opt = document.createElement("option");
    opt.value = curVal;
    opt.textContent = curVal;
    opt.selected = true;
    el.appendChild(opt);
  }
}
window.renderTtsModelOptions = renderTtsModelOptions;

const DEFAULT_TRANSCRIBER_MODELS = [
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash-Lite",
    badge: "Free Tier",
    badgeType: "fast",
    description: "⚡ Free Tier (Ультрабыстрая, для бесплатных ключей)"
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    badge: "Рекомендуется",
    badgeType: "recommended",
    description: "⚡ Оптимальный баланс скорости и качества"
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    badge: "Ультрабыстрая",
    badgeType: "fast",
    description: "🚀 Минимальная задержка отклика в плотном эфире"
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash-Lite Preview",
    badge: "Free Preview",
    badgeType: "fast",
    description: "⚡ Предварительная версия Flash-Lite"
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    badge: "Новое поколение",
    badgeType: "new",
    description: "✨ Улучшенное распознавание зашумленной речи"
  },
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    badge: "Flash 3.7",
    badgeType: "new",
    description: "⚡ Новая гибридная модель Flash"
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    badge: "Flash 3.8",
    badgeType: "new",
    description: "⚡ Новейшая версия Flash"
  },
  {
    id: "gemini-flash-latest",
    name: "Gemini Flash Latest",
    badge: "Авто Flash",
    badgeType: "auto",
    description: "🔄 Самая свежая стабильная версия Flash"
  },
  {
    id: "gemini-flash-lite-latest",
    name: "Gemini Flash-Lite Latest",
    badge: "Авто Lite",
    badgeType: "auto",
    description: "🔄 Самая свежая облегченная версия Lite"
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    badge: "Flash 2.5",
    badgeType: "default",
    description: "⚡ Стабильная рабочая модель Flash"
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    badge: "Lite 2.5",
    badgeType: "fast",
    description: "⚡ Облегченная стабильная модель Flash-Lite"
  },
  {
    id: "gemini-3.5-transcribe",
    name: "Gemini 3.5 Transcribe",
    badge: "ASR",
    badgeType: "default",
    description: "🎙️ Распознавание речи радиоэфира"
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    badge: "Pro",
    badgeType: "pro",
    description: "🧠 Флагманская модель с глубоким пониманием радио-жаргона"
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    badge: "Pro",
    badgeType: "pro",
    description: "🧠 Качественный контекстный анализ речи"
  }
];

let cachedTranscriberModels = [...DEFAULT_TRANSCRIBER_MODELS];
let activeModelPickerOverlay = null;

async function loadTranscriberModelsCache() {
  try {
    const resp = await fetch("/api/transcriber/models");
    const data = await resp.json();
    let rawList = (data && Array.isArray(data.transcribe_models) && data.transcribe_models.length > 0)
      ? data.transcribe_models
      : (data && Array.isArray(data.models) ? data.models : []);

    // Strictly filter out any models with TTS in category, id, or name
    const validTranscribeModels = rawList.filter(m => {
      if (!m) return false;
      if (m.category === "tts") return false;
      const id = (m.id || "").toLowerCase();
      const name = (m.name || "").toLowerCase();
      if (id.includes("tts") || name.includes("tts")) return false;
      return true;
    });

    if (validTranscribeModels.length > 0) {
      cachedTranscriberModels = validTranscribeModels.map(m => {
        let bType = "default";
        const bLower = (m.badge || "").toLowerCase();
        if (bLower.includes("рекоменд")) bType = "recommended";
        else if (bLower.includes("free") || bLower.includes("быстр") || bLower.includes("задерж")) bType = "fast";
        else if (bLower.includes("нов")) bType = "new";
        else if (bLower.includes("pro")) bType = "pro";
        else if (bLower.includes("авто")) bType = "auto";

        let shortName = m.name || m.id;
        if (shortName.includes("—")) {
          shortName = shortName.split("—")[0].trim();
        } else if (shortName.includes("-")) {
          shortName = shortName.split("-")[0].trim();
        }
        return {
          id: m.id,
          name: shortName,
          fullName: m.name || m.id,
          badge: m.badge || "",
          badgeType: bType,
          description: m.description || ""
        };
      });
    }
  } catch (_) {}
}

function getCurrentTranscriberModel() {
  let m = (window.transcriberSettings && window.transcriberSettings.model) ? window.transcriberSettings.model : null;
  if (!m) {
    const optModel = document.getElementById("optTranscriberModel");
    if (optModel && optModel.value) {
      m = optModel.value;
    }
  }
  if (!m) m = "gemini-3.1-flash-lite";
  return m;
}

async function selectTranscriberModel(modelId, modelName) {
  if (!modelId) return;
  if (!window.transcriberSettings) {
    window.transcriberSettings = {};
  }
  window.transcriberSettings.model = modelId;

  const optModel = document.getElementById("optTranscriberModel");
  if (optModel) {
    optModel.value = modelId;
  }

  try {
    const resp = await fetch("/api/transcriber/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId })
    });
    const data = await resp.json();
    if (data && data.status === "ok") {
      if (data.settings) {
        window.transcriberSettings = data.settings;
      }
      showToast(window.t ? window.t("transcriber.model_changed", { model: modelName || modelId }, `✓ Модель AI изменена: ${modelName || modelId}`) : `✓ Модель AI изменена: ${modelName || modelId}`, 2500);
    } else {
      showToast(window.t ? window.t("transcriber.model_change_err", {}, "⚠️ Ошибка смены модели транскрибатора") : "⚠️ Ошибка смены модели транскрибатора", 3000);
    }
  } catch (err) {
    console.error("[TRANSCRIBER] Error updating model:", err);
    showToast(window.t ? window.t("transcriber.model_net_err", {}, "⚠️ Ошибка связи с сервером при смене модели") : "⚠️ Ошибка связи с сервером при смене модели", 3000);
  }
}

function closeTranscriberModelPicker() {
  if (activeModelPickerOverlay) {
    const overlay = activeModelPickerOverlay;
    activeModelPickerOverlay = null;
    overlay.classList.add("closing");
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, 160);
  }
}

function positionModelPicker(popup, targetBadge) {
  if (!popup || !targetBadge) return;
  const badgeRect = targetBadge.getBoundingClientRect();
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  if (screenW <= 520) {
    popup.style.left = "10px";
    popup.style.right = "10px";
    popup.style.width = "auto";
    popup.style.maxWidth = "calc(100vw - 20px)";
    popup.style.bottom = "14px";
    popup.style.top = "auto";
    return;
  }

  const popupRect = popup.getBoundingClientRect();
  const popupW = popupRect.width || 324;
  const popupH = popupRect.height || 340;

  let top = badgeRect.bottom + 6;
  let left = badgeRect.right - popupW;

  if (top + popupH > screenH - 12) {
    top = Math.max(12, badgeRect.top - popupH - 6);
  }
  if (left < 10) {
    left = Math.max(10, badgeRect.left);
  }
  if (left + popupW > screenW - 10) {
    left = screenW - popupW - 10;
  }

  popup.style.top = `${Math.round(top)}px`;
  popup.style.left = `${Math.round(left)}px`;
  popup.style.right = "auto";
  popup.style.bottom = "auto";
}

function openTxtQuickSettingsPopover(targetBadge, row, slot) {
  closeTxtQuickSettingsPopover();
  closeTtsQuickSettingsPopover();
  if (typeof closeTranscriberModelPicker === "function") {
    closeTranscriberModelPicker();
  }

  if (!slot && targetBadge) {
    const cardRow = targetBadge.closest(".vfo-ts1-row, .vfo-ts2-row");
    if (cardRow) {
      slot = cardRow.classList.contains("vfo-ts1-row") ? 1 : 2;
    } else {
      slot = 1;
    }
  }

  const overlay = document.createElement("div");
  overlay.className = "tts-quick-settings-overlay txt-quick-settings-overlay";

  const popup = document.createElement("div");
  popup.className = "tts-quick-settings-popup txt-quick-settings-popup";

  const s = window.transcriberSettings || {};
  const curModel = s.model || getCurrentTranscriberModel() || "gemini-3.5-flash";
  const isNoTranslate = (s.target_lang === "none") || (document.getElementById("optTranscriberNoTranslate")?.checked) || false;
  let curTargetLang = (s.target_lang && s.target_lang !== "none") ? s.target_lang : null;
  if (!curTargetLang) {
    const optTl = document.getElementById("optTranscriberTargetLang");
    curTargetLang = (optTl && optTl.value) ? optTl.value : "ru";
  }

  // Header
  const header = document.createElement("div");
  header.className = "tts-quick-header";
  header.innerHTML = `
    <div class="tts-quick-title">
      <span class="tts-quick-icon">📝</span>
      <span>${window.t ? window.t("transcriber.txt_modal_title", { slot }, `Параметры транскрибатора TS${slot}`) : `Параметры транскрибатора TS${slot}`}</span>
    </div>
    <button type="button" class="tts-quick-close" aria-label="${window.t ? window.t("buttons.close", {}, "Закрыть") : "Закрыть"}">&times;</button>
  `;

  // Body
  const body = document.createElement("div");
  body.className = "tts-quick-body";

  // 1. Model select
  const rowModel = document.createElement("div");
  rowModel.className = "tts-quick-row";
  rowModel.innerHTML = `
    <label class="tts-quick-label" for="txtQuickModel">${window.t ? window.t("transcriber.model", {}, "🤖 Модель Gemini:") : "🤖 Модель Gemini:"}</label>
    <select class="tts-quick-select" id="txtQuickModel"></select>
  `;
  const selModel = rowModel.querySelector("#txtQuickModel");

  // Populate models
  const displayModels = (cachedTranscriberModels && cachedTranscriberModels.length > 0)
    ? cachedTranscriberModels.filter(m => {
        if (!m) return false;
        const id = (m.id || "").toLowerCase();
        const name = (m.name || "").toLowerCase();
        const full = (m.fullName || "").toLowerCase();
        return !id.includes("tts") && !name.includes("tts") && !full.includes("tts");
      })
    : DEFAULT_TRANSCRIBER_MODELS;

  let modelFound = false;
  displayModels.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    const info = getLocalizedModelLabel(m, false);
    opt.textContent = info.name + (info.badge ? ` (${info.badge})` : "");
    if (info.title) opt.title = info.title;
    if (m.id === curModel) {
      opt.selected = true;
      modelFound = true;
    }
    selModel.appendChild(opt);
  });
  if (!modelFound && curModel) {
    const opt = document.createElement("option");
    opt.value = curModel;
    opt.textContent = curModel;
    opt.selected = true;
    selModel.appendChild(opt);
  }

  // 2. No Translate checkbox
  const rowNoTrans = document.createElement("div");
  rowNoTrans.className = "tts-quick-row";
  rowNoTrans.innerHTML = `
    <label class="tts-quick-cb-label">
      <input type="checkbox" id="txtQuickNoTranslate" ${isNoTranslate ? "checked" : ""}>
      <span>${window.t ? window.t("transcriber.no_translate", {}, "Без перевода (транскрипция на языке оригинала речи)") : "Без перевода (транскрипция на языке оригинала речи)"}</span>
    </label>
  `;
  const cbNoTranslate = rowNoTrans.querySelector("#txtQuickNoTranslate");

  // 3. Target Language select
  const rowTargetLang = document.createElement("div");
  rowTargetLang.className = "tts-quick-row";
  rowTargetLang.id = "txtQuickRowTargetLang";
  rowTargetLang.innerHTML = `
    <label class="tts-quick-label" for="txtQuickTargetLang">${window.t ? window.t("transcriber.target_lang", {}, "🌐 Целевой язык перевода / Target Language:") : "🌐 Целевой язык перевода / Target Language:"}</label>
    <select class="tts-quick-select" id="txtQuickTargetLang"></select>
  `;
  const selTargetLang = rowTargetLang.querySelector("#txtQuickTargetLang");
  renderTargetLangSelect(selTargetLang);
  if (curTargetLang && curTargetLang !== "none") {
    selTargetLang.value = curTargetLang;
  }

  // Toggle Target Lang enabled state based on No Translate
  const syncTargetLangDisabled = () => {
    const disabled = cbNoTranslate.checked;
    selTargetLang.disabled = disabled;
    rowTargetLang.style.opacity = disabled ? "0.4" : "1";
    rowTargetLang.style.filter = disabled ? "grayscale(80%)" : "none";
    rowTargetLang.style.pointerEvents = disabled ? "none" : "";
  };
  cbNoTranslate.addEventListener("change", syncTargetLangDisabled);
  syncTargetLangDisabled();

  selTargetLang.addEventListener("change", async () => {
    const effEng = (window.transcriberSettings && window.transcriberSettings.tts_engine) || "gemini";
    const selectedLang = selTargetLang.value;
    if (effEng === "piper" && selectedLang && selectedLang !== "none" && !cbNoTranslate.checked) {
      await checkAndPromptPiperModel(selectedLang);
    }
  });

  body.appendChild(rowModel);
  body.appendChild(rowNoTrans);
  body.appendChild(rowTargetLang);

  // Footer
  const footer = document.createElement("div");
  footer.className = "tts-quick-footer";
  footer.style.justifyContent = "flex-end";
  footer.innerHTML = `
    <button type="button" class="btn-tts-quick-save" id="btnTxtQuickSave">${window.t ? window.t("transcriber.txt_btn_quick_save", {}, "✓ Сохранить") : "✓ Сохранить"}</button>
  `;

  popup.appendChild(header);
  popup.appendChild(body);
  popup.appendChild(footer);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  activeTxtPopoverOverlay = overlay;

  positionTtsQuickSettingsPopover(popup, targetBadge);

  // Save handler
  const btnSave = footer.querySelector("#btnTxtQuickSave");
  if (btnSave) {
    btnSave.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newModel = selModel ? selModel.value : curModel;
      const newNoTrans = cbNoTranslate ? cbNoTranslate.checked : false;
      const newTargetLang = newNoTrans ? "none" : (selTargetLang ? selTargetLang.value : "ru");

      btnSave.disabled = true;
      // Immediately stop any active or queued TTS speech on language change
      if (window.ttsAudioQueueManager) {
        window.ttsAudioQueueManager.stopAll();
      }

      // If Piper TTS is active and language is translated, check Piper model
      let resolvedPiperVoice = null;
      const effEng = (window.transcriberSettings && window.transcriberSettings.tts_engine) || "gemini";
      if (effEng === "piper" && !newNoTrans && newTargetLang !== "none") {
        try {
          const checkRes = await checkAndPromptPiperModel(newTargetLang);
          if (checkRes && (checkRes.default_voice || checkRes.voice_id)) {
            resolvedPiperVoice = checkRes.default_voice || checkRes.voice_id;
          }
        } catch (_) {}
      }

      const payload = {
        model: newModel,
        target_lang: newTargetLang
      };
      if (resolvedPiperVoice) {
        payload.tts_voice = resolvedPiperVoice;
      }

      try {
        const resp = await fetch("/api/transcriber/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const resJson = await resp.json();
        if (resJson && resJson.status === "ok") {
          if (resJson.settings) {
            window.transcriberSettings = resJson.settings;
          } else {
            if (!window.transcriberSettings) window.transcriberSettings = {};
            window.transcriberSettings.model = newModel;
            window.transcriberSettings.target_lang = newTargetLang;
          }
          refreshAllSlotTtsBadges(newTargetLang);

          // Sync main settings modal form inputs if they exist
          const optModel = document.getElementById("optTranscriberModel");
          if (optModel) optModel.value = newModel;

          const optNoTrans = document.getElementById("optTranscriberNoTranslate");
          if (optNoTrans) {
            optNoTrans.checked = newNoTrans;
            optNoTrans.dispatchEvent(new Event("change"));
          }

          const optTl = document.getElementById("optTranscriberTargetLang");
          if (optTl && !newNoTrans) {
            optTl.value = newTargetLang;
          }

          // Refresh Piper TTS voice list if target language changed
          const effLang = newNoTrans ? "ru" : newTargetLang;
          const optTtsVoice = document.getElementById("optTtsVoice");
          const ttsVoiceHint = document.getElementById("ttsVoiceHint");
          const optTtsEngine = document.getElementById("optTtsEngine");
          const effEngine = (window.transcriberSettings && window.transcriberSettings.tts_engine) || (optTtsEngine ? optTtsEngine.value : "gemini");
          const effVoice = (window.transcriberSettings && window.transcriberSettings.tts_voice) || "auto";
          if (optTtsVoice) {
            populateVoiceSelect(optTtsVoice, effEngine, effLang, effVoice, ttsVoiceHint);
          }

          showToast(window.t ? window.t("transcriber.txt_saved", {}, "✓ Параметры транскрибатора сохранены") : "✓ Параметры транскрибатора сохранены", 2500);
          closeTxtQuickSettingsPopover();
        } else {
          showToast(window.t ? window.t("transcriber.save_error", {}, "⚠️ Ошибка сохранения параметров") : "⚠️ Ошибка сохранения параметров", 3000);
          btnSave.disabled = false;
          btnSave.textContent = window.t ? window.t("transcriber.txt_btn_quick_save", {}, "✓ Сохранить") : "✓ Сохранить";
        }
      } catch (err) {
        console.error("[TRANSCRIBER] Quick save exception:", err);
        showToast(window.t ? window.t("transcriber.net_error", {}, "⚠️ Ошибка связи с сервером") : "⚠️ Ошибка связи с сервером", 3000);
        btnSave.disabled = false;
        btnSave.textContent = window.t ? window.t("transcriber.txt_btn_quick_save", {}, "✓ Сохранить") : "✓ Сохранить";
      }
    });
  }

  // Close handlers
  const closeBtn = header.querySelector(".tts-quick-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTxtQuickSettingsPopover();
    });
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeTxtQuickSettingsPopover();
    }
  });

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      window.removeEventListener("keydown", onKeyDown);
      closeTxtQuickSettingsPopover();
    }
  };
  window.addEventListener("keydown", onKeyDown);
}

function openTranscriberModelPicker(targetBadge) {
  closeTranscriberModelPicker();

  const overlay = document.createElement("div");
  overlay.className = "transcriber-model-picker-overlay";

  const popup = document.createElement("div");
  popup.className = "transcriber-model-picker-popup";

  const curModel = getCurrentTranscriberModel();

  // Header
  const header = document.createElement("div");
  header.className = "model-picker-header";
  header.innerHTML = `
    <div class="model-picker-title">
      <span class="model-picker-icon">⚡</span>
      <span>${window.t ? window.t("transcriber.model_picker_title", {}, "Модели AI (Gemini)") : "Модели AI (Gemini)"}</span>
    </div>
    <button type="button" class="model-picker-close" aria-label="${window.t ? window.t("buttons.close", {}, "Закрыть") : "Закрыть"}">&times;</button>
  `;

  // List container
  const list = document.createElement("div");
  const displayModels = cachedTranscriberModels.filter(m => {
    if (!m) return false;
    const id = (m.id || "").toLowerCase();
    const name = (m.name || "").toLowerCase();
    const full = (m.fullName || "").toLowerCase();
    return !id.includes("tts") && !name.includes("tts") && !full.includes("tts");
  });

  displayModels.forEach(m => {
    const isSelected = (m.id === curModel);
    const item = document.createElement("div");
    item.className = `model-picker-item ${isSelected ? "active" : ""}`;
    item.dataset.modelId = m.id;

    const badgeHtml = m.badge ? `<span class="model-picker-badge badge-${m.badgeType || 'default'}">${safeEscapeHtml(m.badge)}</span>` : "";

    item.innerHTML = `
      <div class="model-picker-radio">
        <span class="model-picker-check">✓</span>
      </div>
      <div class="model-picker-info">
        <div class="model-picker-name-row">
          <span class="model-picker-name">${safeEscapeHtml(m.name)}</span>
          ${badgeHtml}
        </div>
        <div class="model-picker-desc">${safeEscapeHtml(m.description)}</div>
      </div>
    `;

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      list.querySelectorAll(".model-picker-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      if (navigator.vibrate) {
        try { navigator.vibrate(25); } catch (_) {}
      }
      selectTranscriberModel(m.id, m.name);
      setTimeout(closeTranscriberModelPicker, 130);
    });

    list.appendChild(item);
  });

  popup.appendChild(header);
  popup.appendChild(list);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  activeModelPickerOverlay = overlay;

  positionModelPicker(popup, targetBadge);

  const closeBtn = header.querySelector(".model-picker-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTranscriberModelPicker();
    });
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeTranscriberModelPicker();
    }
  });

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      window.removeEventListener("keydown", onKeyDown);
      closeTranscriberModelPicker();
    }
  };
  window.addEventListener("keydown", onKeyDown);
}

function setupSlotTranscribeClick(row, slot) {
  if (!row) return;
  const langBadge = row.querySelector(".vfo-lang-badge");
  if (langBadge && !langBadge._clickAttached) {
    langBadge._clickAttached = true;
    langBadge.setAttribute("role", "button");
    langBadge.setAttribute("tabindex", "0");
    langBadge.style.cursor = "pointer";

    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let isLongPress = false;
    const LONG_PRESS_MS = 500;

    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      langBadge.classList.remove("vfo-lang-pressing");
    };

    const startPress = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      isLongPress = false;
      startX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      startY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
      langBadge.classList.add("vfo-lang-pressing");

      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        pressTimer = null;
        isLongPress = true;
        langBadge.classList.remove("vfo-lang-pressing");
        if (navigator.vibrate) {
          try { navigator.vibrate(35); } catch (_) {}
        }
        openTxtQuickSettingsPopover(langBadge, row, slot);
      }, LONG_PRESS_MS);
    };

    const movePress = (e) => {
      if (!pressTimer) return;
      const curX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const curY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
      if (Math.hypot(curX - startX, curY - startY) > 10) {
        cancelPress();
      }
    };

    langBadge.addEventListener("pointerdown", startPress);
    langBadge.addEventListener("pointermove", movePress);
    langBadge.addEventListener("pointerup", cancelPress);
    langBadge.addEventListener("pointercancel", cancelPress);
    langBadge.addEventListener("pointerleave", cancelPress);

    langBadge.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelPress();
      openTxtQuickSettingsPopover(langBadge, row, slot);
    });

    const onLangClick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (isLongPress) {
        isLongPress = false;
        return;
      }
      toggleSlotTranscribe(row, slot);
    };
    langBadge.addEventListener("click", onLangClick);

    let keyTimer = null;
    let isKeyLongPress = false;
    langBadge.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (e.repeat) return;
        if (e.shiftKey || e.altKey) {
          e.preventDefault();
          openTxtQuickSettingsPopover(langBadge, row, slot);
          return;
        }
        isKeyLongPress = false;
        keyTimer = setTimeout(() => {
          keyTimer = null;
          isKeyLongPress = true;
          openTxtQuickSettingsPopover(langBadge, row, slot);
        }, LONG_PRESS_MS);
      }
    });
    langBadge.addEventListener("keyup", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (keyTimer) {
          clearTimeout(keyTimer);
          keyTimer = null;
        }
        if (!isKeyLongPress) {
          e.preventDefault();
          toggleSlotTranscribe(row, slot);
        }
        isKeyLongPress = false;
      }
    });
  }
}

// Alias for compatibility if called anywhere else
function setupSlotLongPress(row, slot) {
  setupSlotTranscribeClick(row, slot);
}

function toggleSlotTranscribe(row, slot) {
  if (!row) return;
  const card = row.closest(".radio-container");
  const rawHid = card ? card.dataset.hotspotId : null;
  const hid = resolveHotspotId(rawHid || window.activeHotspotId);

  const langBadge = row.querySelector(".vfo-lang-badge");
  if (langBadge) {
    langBadge.classList.remove("has-ai-error", "ai-error-blink");
    if (langBadge._errorTimer) {
      clearTimeout(langBadge._errorTimer);
      langBadge._errorTimer = null;
    }
  }

  const isCurrentlyActive = row.classList.contains("has-transcribe");
  const newState = !isCurrentlyActive;

  row.classList.toggle("has-transcribe", newState);
  updateSlotLangBadge(row, slot, newState);

  const key = getSlotTranscribeKey(hid, slot);
  localStorage.setItem(key, newState ? "1" : "0");

  const ws = getWs();
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({
        type: "set_transcribe_slot",
        hotspot_id: hid,
        slot: slot,
        enabled: newState
      }));
    } catch (err) {
      console.error("[TRANSCRIBER] Failed to send set_transcribe_slot:", err);
    }
  }

  if (newState) {
    // Mutual exclusion: Auto-mute other slot and deactivate any transcription/TTS on it
    const otherSlot = slot === 1 ? 2 : 1;
    const autoMuteKey = `proxdmr_transcribe_automuted_${hid}_ts${otherSlot}`;
    if (!getHotspotMute(hid, otherSlot)) {
      try {
        sessionStorage.setItem(autoMuteKey, "1");
      } catch (_) {}
    }
    setHotspotMute(hid, otherSlot, true);

    const otherRow = card ? card.querySelector(`.vfo-ts${otherSlot}-row`) : null;
    if (otherRow) {
      if (otherRow.classList.contains("has-transcribe")) {
        otherRow.classList.remove("has-transcribe");
        updateSlotLangBadge(otherRow, otherSlot, false);
        try {
          localStorage.setItem(getSlotTranscribeKey(hid, otherSlot), "0");
        } catch (_) {}
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({
              type: "set_transcribe_slot",
              hotspot_id: hid,
              slot: otherSlot,
              enabled: false
            }));
          } catch (_) {}
        }
      }
      if (isSlotTtsActive(hid, otherSlot)) {
        try {
          localStorage.setItem(getSlotTtsKey(hid, otherSlot), "0");
        } catch (_) {}
        updateSlotTtsBadge(otherRow, otherSlot, false);
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({
              type: "set_tts_slot",
              hotspot_id: hid,
              slot: otherSlot,
              enabled: false
            }));
          } catch (_) {}
        }
        if (window.ttsAudioQueueManager) {
          window.ttsAudioQueueManager.stopSlot(hid, otherSlot);
        }
        syncTtsSoloMode();
      }
    }

    scheduleSyncClientSettings();
    showToast(window.t ? window.t("transcriber.ts_on", { slot }, `✓ Режим транскрибации TS${slot} включен`) : `✓ Режим транскрибации TS${slot} включен`, 2000);
    const hasKey = Boolean(window.transcriberSettings && window.transcriberSettings.api_key);
    if (!hasKey) {
      showToast(window.t ? window.t("transcriber.token_missing_toast", {}, "⚠️ Укажите токен Gemini API в Настройках ➔ AI Транскрибатор") : "⚠️ Укажите токен Gemini API в Настройках ➔ AI Транскрибатор", 4000);
      openHotspotSettings(null, "tab-transcriber");
    }
  } else {
    scheduleSyncClientSettings();
    const captionStream = row.querySelector(".vfo-caption-stream");
    const captionBox = row.querySelector(".vfo-caption-box");
    if (captionStream) {
      captionStream._entries = [];
      captionStream.innerHTML = "";
      captionStream._lastCallKey = null;
      captionStream._lastCallId = null;
      captionStream._lastMsgTime = null;
    }
    if (captionBox) {
      captionBox.scrollTop = 0;
      captionBox._isUserScrolled = false;
    }
    try {
      localStorage.setItem(getSlotTtsKey(hid, slot), "0");
    } catch (_) {}
    updateSlotTtsBadge(row, slot, false);
    if (window.ttsAudioQueueManager) {
      window.ttsAudioQueueManager.stopSlot(hid, slot);
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: "set_tts_slot",
          hotspot_id: hid,
          slot: slot,
          enabled: false
        }));
      } catch (_) {}
    }

    // Restore mutual-exclusion auto-muted other slot if it was muted by this transcription
    const otherSlot = slot === 1 ? 2 : 1;
    const autoMuteKey = `proxdmr_transcribe_automuted_${hid}_ts${otherSlot}`;
    let wasAutoMuted = false;
    try {
      wasAutoMuted = sessionStorage.getItem(autoMuteKey) === "1";
      sessionStorage.removeItem(autoMuteKey);
    } catch (_) {}
    if (wasAutoMuted) {
      setHotspotMute(hid, otherSlot, false);
    }

    // Synchronize TTS Solo mode (restores all channels muted by Solo mode)
    syncTtsSoloMode();

    showToast(window.t ? window.t("transcriber.ts_off", { slot }, `✕ Режим транскрибации TS${slot} выключен`) : `✕ Режим транскрибации TS${slot} выключен`, 2000);
  }

  if (card) {
    updateCardTranscribeLayout(card);
  }
}

function getMaximizedKey(hid) {
  return `proxdmr_max_transcribe_${resolveHotspotId(hid)}`;
}

function alignTranscribeCardHeight(card) {
  // Pure CSS deterministic layout: heights are invariant across all modes
}

function updateCardTranscribeLayout(card) {
  if (!card) return;
  const ts1Row = card.querySelector(".vfo-ts1-row");
  const ts2Row = card.querySelector(".vfo-ts2-row");
  if (!ts1Row || !ts2Row) return;

  const ts1Active = ts1Row.classList.contains("has-transcribe");
  const ts2Active = ts2Row.classList.contains("has-transcribe");

  // State 0: Neither slot has TXT active -> restore standard un-transcribed dual-watch mode (106px each)
  if (!ts1Active && !ts2Active) {
    card.classList.remove(
      "has-transcribe-mode",
      "transcribe-ts1-only",
      "transcribe-ts2-only",
      "transcribe-both",
      "has-maximized-vfo"
    );
    ts1Row.classList.remove("is-maximized", "vfo-hidden-by-max");
    ts2Row.classList.remove("is-maximized", "vfo-hidden-by-max");

    [ts1Row, ts2Row].forEach(row => {
      row.style.removeProperty("height");
      row.style.removeProperty("min-height");
      row.style.removeProperty("max-height");
      row.style.removeProperty("display");
      const box = row.querySelector(".vfo-caption-box");
      if (box) {
        box.style.removeProperty("height");
        box.style.removeProperty("min-height");
        box.style.removeProperty("max-height");
        box.style.removeProperty("display");
      }
    });

    return;
  }

  // Active transcribe mode: single slot expands to 100% height (216px), other is hidden
  card.classList.add("has-transcribe-mode");

  if (ts1Active) {
    card.classList.remove("transcribe-ts2-only", "transcribe-both", "has-maximized-vfo");
    card.classList.add("transcribe-ts1-only");
    ts1Row.classList.remove("is-maximized", "vfo-hidden-by-max");
    ts2Row.classList.remove("is-maximized");
    ts2Row.classList.add("vfo-hidden-by-max");
  } else if (ts2Active) {
    card.classList.remove("transcribe-ts1-only", "transcribe-both", "has-maximized-vfo");
    card.classList.add("transcribe-ts2-only");
    ts2Row.classList.remove("is-maximized", "vfo-hidden-by-max");
    ts1Row.classList.remove("is-maximized");
    ts1Row.classList.add("vfo-hidden-by-max");
  }

  // Clear inline styles so CSS deterministic classes govern layout
  [ts1Row, ts2Row].forEach(row => {
    row.style.removeProperty("height");
    row.style.removeProperty("min-height");
    row.style.removeProperty("max-height");
    row.style.removeProperty("display");
    const box = row.querySelector(".vfo-caption-box");
    if (box) {
      box.style.removeProperty("height");
      box.style.removeProperty("min-height");
      box.style.removeProperty("max-height");
      box.style.removeProperty("display");
    }
  });
}

function setSlotMaximized(row, slot, isMax, savePref = true) {
  if (!row) return;
  const card = row.closest(".radio-container");
  if (!card) return;
  const cid = resolveHotspotId(card.dataset.hotspotId || window.activeHotspotId);

  if (isMax) {
    row.classList.add("is-maximized");
    pushNavState("zoom", `ts${slot}`);
    if (savePref) {
      localStorage.setItem(getMaximizedKey(cid), slot.toString());
    }
  } else {
    row.classList.remove("is-maximized");
    if (savePref) {
      const saved = localStorage.getItem(getMaximizedKey(cid));
      if (saved === slot.toString()) {
        localStorage.removeItem(getMaximizedKey(cid));
      }
    }
  }

  updateCardTranscribeLayout(card);

  const captionBox = row.querySelector(".vfo-caption-box");
  const captionStream = row.querySelector(".vfo-caption-stream");
  if (captionStream && captionBox) {
    requestAnimationFrame(() => {
      if (!captionBox._isUserScrolled) {
        captionBox.scrollTop = captionBox.scrollHeight;
      }
    });
  }
}

function setupCaptionBoxLongPress(row, slot) {
  if (!row) return;
  const captionBox = row.querySelector(".vfo-caption-box");
  if (!captionBox || captionBox._longPressAttached) return;
  captionBox._longPressAttached = true;
  captionBox.title = (window.t ? window.t("transcriber.caption_expand_hint", {}, "AI Расшифровка речи (длительное удержание для увеличения)") : "AI Расшифровка речи (длительное удержание для увеличения)");

  // Track scroll position to allow user reading history without forced autoscroll
  captionBox.addEventListener("scroll", () => {
    const atBottom = captionBox.scrollHeight - captionBox.scrollTop - captionBox.clientHeight <= 10;
    captionBox._isUserScrolled = !atBottom;
  }, { passive: true });

  captionBox.addEventListener("wheel", () => {
    setTimeout(() => {
      const atBottom = captionBox.scrollHeight - captionBox.scrollTop - captionBox.clientHeight <= 10;
      captionBox._isUserScrolled = !atBottom;
    }, 50);
  }, { passive: true });

  captionBox.addEventListener("touchend", () => {
    setTimeout(() => {
      const atBottom = captionBox.scrollHeight - captionBox.scrollTop - captionBox.clientHeight <= 10;
      captionBox._isUserScrolled = !atBottom;
    }, 50);
  }, { passive: true });

  let pressTimer = null;
  let startX = 0;
  let startY = 0;
  let isTriggered = false;

  const clearTimer = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    captionBox.classList.remove("is-holding");
  };

  const startPress = (clientX, clientY) => {
    clearTimer();
    isTriggered = false;
    startX = clientX;
    startY = clientY;
    captionBox.classList.add("is-holding");

    pressTimer = setTimeout(() => {
      isTriggered = true;
      clearTimer();
      if (navigator.vibrate) {
        try { navigator.vibrate(60); } catch (_) {}
      }
      const isCurrentlyMax = row.classList.contains("is-maximized");
      const nextState = !isCurrentlyMax;
      setSlotMaximized(row, slot, nextState, true);
      if (nextState) {
        showToast(window.t ? window.t("transcriber.mode_expanded", { slot }, `Увеличенный режим транскрибации TS${slot}`) : `Увеличенный режим транскрибации TS${slot}`, 2000);
      } else {
        showToast(window.t ? window.t("transcriber.mode_standard", {}, "Стандартный режим TS1 / TS2") : "Стандартный режим TS1 / TS2", 1500);
      }
      row._suppressClickUntil = Date.now() + 500;
    }, 500);
  };

  captionBox.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    startPress(e.clientX, e.clientY);
  });

  captionBox.addEventListener("pointermove", (e) => {
    if (!pressTimer) return;
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dx > 5 || dy > 5) {
      clearTimer();
    }
  });

  captionBox.addEventListener("touchmove", (e) => {
    if (!pressTimer) return;
    if (e.touches && e.touches[0]) {
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dx > 5 || dy > 5) {
        clearTimer();
      }
    }
  }, { passive: true });

  const endPress = (e) => {
    if (isTriggered) {
      e.preventDefault();
      e.stopPropagation();
    }
    clearTimer();
  };

  captionBox.addEventListener("pointerup", endPress);
  captionBox.addEventListener("pointercancel", endPress);
  captionBox.addEventListener("pointerleave", endPress);

  captionBox.addEventListener("contextmenu", (e) => {
    if (isTriggered || pressTimer) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  captionBox.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isTriggered) {
      e.preventDefault();
    }
  });
}

// Auto-prune caption box entries older than 30 minutes every minute
setInterval(() => {
  const now = Date.now();
  const MAX_AGE_MS = 30 * 60 * 1000;
  document.querySelectorAll(".vfo-caption-stream").forEach(stream => {
    if (Array.isArray(stream._entries) && stream._entries.length > 0) {
      const initialLen = stream._entries.length;
      stream._entries = stream._entries.filter(e => (now - e.timestamp) <= MAX_AGE_MS);
      if (stream._entries.length !== initialLen) {
        if (stream._entries.length === 0) {
          stream.innerHTML = "";
        } else {
          stream.innerHTML = stream._entries
            .map(formatCaptionEntryHtml)
            .join("");
        }
      }
    }
  });
}, 60000);

function clearAllTranscribeLocalStorage() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k !== "proxdmr_tts_solo_muted_slots" && (k.startsWith("proxdmr_transcribe_") || k.startsWith("proxdmr_max_transcribe_") || k.startsWith("proxdmr_tts_"))) {
        localStorage.removeItem(k);
      }
    }
  } catch (_) {}
}

function disableSlotTranscribe(row, slot, hid, silent = true, notifyWs = true) {
  if (!row) return;
  const cid = resolveHotspotId(hid);
  const key = getSlotTranscribeKey(cid, slot);
  const ttsKey = getSlotTtsKey(cid, slot);
  try {
    localStorage.setItem(key, "0");
    localStorage.setItem(ttsKey, "0");
  } catch (_) {}

  const wasActive = row.classList.contains("has-transcribe");
  row.classList.remove("has-transcribe");
  updateSlotLangBadge(row, slot, false);
  updateSlotTtsBadge(row, slot, false);
  if (window.ttsAudioQueueManager) {
    window.ttsAudioQueueManager.stopSlot(cid, slot);
  }

  // Restore mutual-exclusion auto-muted other slot if it was muted by this transcription
  const otherSlot = slot === 1 ? 2 : 1;
  const autoMuteKey = `proxdmr_transcribe_automuted_${cid}_ts${otherSlot}`;
  try {
    if (sessionStorage.getItem(autoMuteKey) === "1") {
      sessionStorage.removeItem(autoMuteKey);
      setHotspotMute(cid, otherSlot, false);
    }
  } catch (_) {}

  const langBadge = row.querySelector(".vfo-lang-badge");
  if (langBadge) {
    langBadge.classList.remove("has-ai-error", "ai-error-blink");
    if (langBadge._errorTimer) {
      clearTimeout(langBadge._errorTimer);
      langBadge._errorTimer = null;
    }
  }

  if (row.classList.contains("is-maximized")) {
    setSlotMaximized(row, slot, false, true);
  }
  const captionStream = row.querySelector(".vfo-caption-stream");
  const captionBox = row.querySelector(".vfo-caption-box");
  if (captionStream) {
    captionStream._entries = [];
    captionStream.innerHTML = "";
    captionStream._lastCallKey = null;
    captionStream._lastCallId = null;
    captionStream._lastMsgTime = null;
  }
  if (captionBox) {
    captionBox.scrollTop = 0;
    captionBox._isUserScrolled = false;
  }

  const ws = getWs();
  if (notifyWs && ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({
        type: "set_transcribe_slot",
        hotspot_id: cid,
        slot: slot,
        enabled: false
      }));
    } catch (_) {}
  }

  const card = row.closest(".radio-container");
  if (card) {
    updateCardTranscribeLayout(card);
  }

  syncTtsSoloMode();

  if (!silent && wasActive) {
    showToast(window.t ? window.t("transcriber.ts_off", { slot }, `✕ Режим транскрибации TS${slot} выключен`) : `✕ Режим транскрибации TS${slot} выключен`, 1500);
  }
}

function disableHotspotTranscribe(hid, silent = true, notifyWs = true) {
  if (typeof closeTranscriberModelPicker === "function") {
    closeTranscriberModelPicker();
  }
  const cid = resolveHotspotId(hid);
  const card = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`);
  [1, 2].forEach(slot => {
    const row = card ? card.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row") : null;
    if (row) {
      disableSlotTranscribe(row, slot, cid, silent, false);
    } else {
      try {
        localStorage.setItem(getSlotTranscribeKey(cid, slot), "0");
      } catch (_) {}
    }
  });

  const ws = getWs();
  if (notifyWs && ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({
        type: "disable_hotspot_transcribe",
        hotspot_id: cid
      }));
    } catch (_) {}
  }

  syncTtsSoloMode();
}

function disableAllTranscribe(silent = true, notifyWs = true) {
  if (typeof closeTranscriberModelPicker === "function") {
    closeTranscriberModelPicker();
  }
  if (window.ttsAudioQueueManager) {
    window.ttsAudioQueueManager.stopAll();
  }
  clearAllTranscribeLocalStorage();

  const cards = document.querySelectorAll(".radio-container");
  cards.forEach(card => {
    const hid = resolveHotspotId(card.dataset.hotspotId);
    [1, 2].forEach(slot => {
      const row = card.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
      if (row) {
        disableSlotTranscribe(row, slot, hid, silent, false);
      }
    });
  });

  const ws = getWs();
  if (notifyWs && ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({
        type: "disable_all_transcribe_slots"
      }));
    } catch (_) {}
  }

  syncTtsSoloMode();
  if (!silent) {
    showToast(window.t ? window.t("transcriber.all_off", {}, "✕ Все распознаватели текста выключены") : "✕ Все распознаватели текста выключены", 2000);
  }
}

window.disableSlotTranscribe = disableSlotTranscribe;
window.disableHotspotTranscribe = disableHotspotTranscribe;
window.disableAllTranscribe = disableAllTranscribe;

window.addEventListener("beforeunload", () => {
  try {
    disableAllTranscribe(true, true);
  } catch (_) {}
  try {
    navigator.sendBeacon("/api/transcriber/disable_all");
  } catch (_) {}
});

window.addEventListener("pagehide", () => {
  try {
    disableAllTranscribe(true, true);
  } catch (_) {}
  try {
    navigator.sendBeacon("/api/transcriber/disable_all");
  } catch (_) {}
});

function syncCardSlotTranscribeUI(card, hid) {
  if (!card) return;
  const cid = resolveHotspotId(hid || card.dataset.hotspotId);

  // Enforce single-slot mutual exclusion from saved preferences
  const ts1Active = isSlotTranscribeActive(cid, 1);
  const ts2Active = isSlotTranscribeActive(cid, 2);
  if (ts1Active && ts2Active) {
    try {
      localStorage.setItem(getSlotTranscribeKey(cid, 2), "0");
      localStorage.setItem(getSlotTtsKey(cid, 2), "0");
    } catch (_) {}
  }

  [1, 2].forEach(slot => {
    const row = card.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
    if (!row) return;
    const isActive = isSlotTranscribeActive(cid, slot);
    row.classList.toggle("has-transcribe", isActive);
    row.classList.remove("is-maximized");
    updateSlotLangBadge(row, slot, isActive);
    setupSlotTranscribeClick(row, slot);
    setupCaptionBoxLongPress(row, slot);

    setupSlotTtsClick(row, slot);
    updateSlotTtsBadge(row, slot, isSlotTtsActive(cid, slot));
  });

  updateCardTranscribeLayout(card);
}

function syncAllTranscribeSlotsToServer() {
  const ws = getWs();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const hotspots = (Array.isArray(window.currentHotspots) && window.currentHotspots.length) ? currentHotspots : [{ id: "default" }];
  hotspots.forEach(hs => {
    const hid = resolveHotspotId(hs.id);
    [1, 2].forEach(slot => {
      const isActive = isSlotTranscribeActive(hid, slot);
      if (isActive) {
        try {
          ws.send(JSON.stringify({
            type: "set_transcribe_slot",
            hotspot_id: hid,
            slot: slot,
            enabled: true
          }));
        } catch (_) {}
      }
    });
  });
}

function initSlotTranscribeState() {
  // Requirements: All text recognizers MUST be automatically disabled on program startup for all hotspots.
  disableAllTranscribe(true, true);

  const cards = document.querySelectorAll(".radio-container");
  cards.forEach(card => {
    const hid = resolveHotspotId(card.dataset.hotspotId);
    [1, 2].forEach(slot => {
      const row = card.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
      if (row) {
        row.classList.remove("has-transcribe");
        updateSlotLangBadge(row, slot, false);
        setupSlotTranscribeClick(row, slot);
        setupCaptionBoxLongPress(row, slot);

        updateSlotTtsBadge(row, slot, false);
        setupSlotTtsClick(row, slot);
      }
    });
  });

  try {
    fetch("/api/transcriber/disable_all", { method: "POST" }).catch(() => {});
  } catch (_) {}
}

// ── Gemini API Keys frame: collapse / eye toggles / checkbox status / test ──
function initGeminiApiKeysFrame() {
  const frame    = document.getElementById('geminiApiKeysFrame');
  const toggle   = document.getElementById('geminiApiKeysToggle');
  const body     = document.getElementById('geminiApiKeysBody');
  if (!frame || !toggle) return;

  const LS_KEYS = 'proxdmr_gemini_apikeys'; // JSON array of {name, key, enabled}

  // ── Persist helpers ────────────────────────────────────────────────────
  function saveAll() {
    const data = [];
    body.querySelectorAll('.apikey-row').forEach(row => {
      const cb   = row.querySelector('.apikey-cb');
      const name = row.querySelector('.apikey-name');
      const inp  = row.querySelector('.apikey-input');
      data.push({
        enabled: cb  ? cb.checked      : false,
        name:    name ? name.value      : '',
        key:     inp  ? inp.value       : ''
      });
    });
    try { localStorage.setItem(LS_KEYS, JSON.stringify(data)); } catch (_) {}
  }

  function loadAll() {
    let data;
    try { data = JSON.parse(localStorage.getItem(LS_KEYS) || 'null'); } catch (_) {}
    const rows = body.querySelectorAll('.apikey-row');
    if (Array.isArray(data)) {
      data.forEach((item, i) => {
        if (i >= rows.length) return;
        const row  = rows[i];
        const cb   = row.querySelector('.apikey-cb');
        const name = row.querySelector('.apikey-name');
        const inp  = row.querySelector('.apikey-input');
        if (cb   && item.enabled !== undefined) cb.checked  = Boolean(item.enabled);
        if (name && item.name    !== undefined) name.value  = item.name;
        if (inp  && item.key     !== undefined) inp.value   = item.key;
      });
    }
    if (rows.length > 0) {
      const firstRowName = rows[0].querySelector('.apikey-name');
      if (firstRowName && !firstRowName.value.trim()) {
        firstRowName.value = 'name';
      }
    }
  }

  // ── Restore saved data ─────────────────────────────────────────────────
  loadAll();

  // ── Collapse toggle (always closed by default on entry) ─────────────────
  frame.classList.add('collapsed');
  if (!toggle._wired) {
    toggle._wired = true;
    toggle.addEventListener('click', () => frame.classList.toggle('collapsed'));
  }

  // ── Eye toggle buttons ─────────────────────────────────────────────────
  body.querySelectorAll('.apikey-eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.target);
      if (!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁️';
    });
  });

  // ── Checkbox → grey status + auto-save ────────────────────────────────
  function applyKeyStatus(input, cb) {
    input.classList.remove('key-status-ok', 'key-status-fail', 'key-status-disabled');
    if (!cb.checked) input.classList.add('key-status-disabled');
  }

  body.querySelectorAll('.apikey-cb').forEach(cb => {
    const row = cb.closest('.apikey-row');
    const inp = row ? row.querySelector('.apikey-input') : null;
    if (!inp) return;
    applyKeyStatus(inp, cb);
    cb.addEventListener('change', () => { applyKeyStatus(inp, cb); saveAll(); });
  });

  // ── Auto-save on input change ──────────────────────────────────────────
  body.querySelectorAll('.apikey-input, .apikey-name').forEach(el => {
    el.addEventListener('input', saveAll);
  });

  // ── Test button — sequential API key validation ─────────────────────────
  window.testGeminiApiKeys = async function () {
    const btn = document.getElementById('btnTestApiKeys');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Тест...'; }

    const rows = body.querySelectorAll('.apikey-row');
    for (const row of rows) {
      const cb  = row.querySelector('.apikey-cb');
      const inp = row.querySelector('.apikey-input');
      if (!inp) continue;
      inp.classList.remove('key-status-ok', 'key-status-fail', 'key-status-disabled');
      if (!cb || !cb.checked) {
        inp.classList.add('key-status-disabled');
        continue;
      }
      const key = inp.value.trim();
      if (!key) { inp.classList.add('key-status-disabled'); continue; }

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1`;
        const res = await fetch(url, { method: 'GET' });
        inp.classList.add(res.ok ? 'key-status-ok' : 'key-status-fail');
      } catch (_) {
        inp.classList.add('key-status-fail');
      }
    }

    if (btn) { btn.disabled = false; btn.textContent = '🧪 Тест'; }
  };
}

// ── Gemini TTS frame: collapse / test speech ─────────────────────────────
function initGeminiTtsFrame() {
  const frame  = document.getElementById('geminiTtsFrame');
  const toggle = document.getElementById('geminiTtsToggle');
  if (!frame || !toggle) return;

  // Frame is collapsed by default on open
  frame.classList.add('collapsed');
  if (!toggle._wired) {
    toggle._wired = true;
    toggle.addEventListener('click', () => frame.classList.toggle('collapsed'));
  }

  const optEngine = document.getElementById('optTtsEngine');
  const groupModel = document.getElementById('groupGeminiTtsModel');
  const groupStyle = document.getElementById('groupGeminiTtsStyle');
  const updateEngineUI = () => {
    if (!optEngine) return;
    const isGemini = optEngine.value === 'gemini';
    if (groupModel) groupModel.style.display = isGemini ? 'block' : 'none';
    if (groupStyle) groupStyle.style.display = isGemini ? 'block' : 'none';
  };
  if (optEngine && !optEngine._wired) {
    optEngine._wired = true;
    optEngine.addEventListener('change', async () => {
      updateEngineUI();
      const effLang = resolveCurrentTargetLang();
      const optVoi = document.getElementById("optTtsVoice");
      const hint = document.getElementById("ttsVoiceHint");
      if (optEngine.value === "piper") {
        const checkRes = await checkAndPromptPiperModel(effLang, (newVoiceId) => {
          populateVoiceSelect(optVoi, "piper", effLang, newVoiceId, hint);
        }, (fallbackEng) => {
          optEngine.value = fallbackEng;
          updateEngineUI();
          populateVoiceSelect(optVoi, fallbackEng, effLang, null, hint);
        });
        if (checkRes.ok) {
          populateVoiceSelect(optVoi, "piper", effLang, (window.transcriberSettings && window.transcriberSettings.tts_voice), hint);
        }
      } else {
        populateVoiceSelect(optVoi, optEngine.value, effLang, (optEngine.value === "gemini" ? (window.transcriberSettings && window.transcriberSettings.tts_voice) : null), hint);
      }
    });
    updateEngineUI();
  }

  const optVoice = document.getElementById("optTtsVoice");
  if (optVoice && !optVoice._downloadWired) {
    optVoice._downloadWired = true;
    optVoice.addEventListener("change", async () => {
      if (optVoice.value && optVoice.value.startsWith("__download__")) {
        const specificVoice = optVoice.value.includes(":") ? optVoice.value.split(":")[1] : null;
        const effLang = resolveCurrentTargetLang();
        const hint = document.getElementById("ttsVoiceHint");
        await checkAndPromptPiperModel(effLang, (newVoiceId) => {
          populateVoiceSelect(optVoice, "piper", effLang, newVoiceId, hint);
        }, null, specificVoice);
      }
    });
  }

  const optTargetLangEl = document.getElementById("optTranscriberTargetLang");
  if (optTargetLangEl && !optTargetLangEl._piperLangWired) {
    optTargetLangEl._piperLangWired = true;
    optTargetLangEl.addEventListener("change", async () => {
      const curEng = optEngine ? optEngine.value : "gemini";
      const newLang = optTargetLangEl.value || "ru";
      if (newLang === "none") return;
      const optVoi = document.getElementById("optTtsVoice");
      const hint = document.getElementById("ttsVoiceHint");
      if (curEng === "piper") {
        const checkRes = await checkAndPromptPiperModel(newLang, (newVoiceId) => {
          populateVoiceSelect(optVoi, "piper", newLang, newVoiceId, hint);
        }, (fallbackEng) => {
          if (optEngine) optEngine.value = fallbackEng;
          updateEngineUI();
          populateVoiceSelect(optVoi, fallbackEng, newLang, null, hint);
        });
        if (checkRes.ok) {
          populateVoiceSelect(optVoi, "piper", newLang, null, hint);
        }
      } else if (curEng === "browser") {
        populateVoiceSelect(optVoi, "browser", newLang, null, hint);
      }
    });
  }

  window.testGeminiTts = async function () {
    const btn = document.getElementById('btnTestTts');
    const optTtsEngine = document.getElementById('optTtsEngine');
    const optTtsModel = document.getElementById('optTtsModel');
    const optTtsVoice = document.getElementById('optTtsVoice');
    const optApiKey = document.getElementById('optTranscriberApiKey');
    const optTtsDucking = document.getElementById('optTtsDucking');
    const optTtsMuteOthers = document.getElementById('optTtsMuteOthers');
    const optTtsAnnounceCallsign = document.getElementById('optTtsAnnounceCallsign');

    let key = '';
    const keyInp = document.querySelector('#geminiApiKeysBody .apikey-cb:checked + .apikey-name + .apikey-input-wrap .apikey-input, #geminiApiKeysBody .apikey-cb:checked ~ .apikey-input-wrap .apikey-input');
    if (keyInp && keyInp.value.trim()) {
      key = keyInp.value.trim();
    } else if (optApiKey && optApiKey.value.trim()) {
      key = optApiKey.value.trim();
    }

    const engine = optTtsEngine ? optTtsEngine.value : 'gemini';
    const model = optTtsModel ? optTtsModel.value : 'gemini-3.1-flash-tts-preview';
    const optTtsStyle = document.getElementById('optTtsStyle');
    const style = optTtsStyle ? optTtsStyle.value : 'radio';
    const voice = (optTtsVoice && optTtsVoice.value && !optTtsVoice.value.startsWith('__download__')) ? optTtsVoice.value : 'auto';
    const optTtsSpeed = document.getElementById('optTtsSpeed');
    const speed = optTtsSpeed ? (parseFloat(optTtsSpeed.value) || 1.1) : (window.transcriberSettings?.tts_speed || 1.1);
    const duckVal = optTtsDucking ? (Math.max(0, Math.min(100, parseFloat(optTtsDucking.value) || 20)) / 100.0) : 0.20;
    const solo = optTtsMuteOthers ? optTtsMuteOthers.checked : true;
    const announce = optTtsAnnounceCallsign ? optTtsAnnounceCallsign.checked : false;
    const actHid = (typeof window.getActiveHotspotId === 'function') ? window.getActiveHotspotId() : 'default';
    const uiLang = (typeof window !== "undefined" && window.I18N && (window.I18N.currentLanguage || window.I18N.currentLang)) ||
                   (typeof localStorage !== "undefined" && localStorage.getItem("proxdmr_language")) ||
                   "ru";
    let testLang = uiLang;
    let testVoice = (!voice || voice === 'auto') ? '' : voice;
    if (testVoice.startsWith('__download__:')) {
      testVoice = testVoice.split(':')[1];
    } else if (testVoice === '__download__') {
      testVoice = '';
    }
    if (engine === 'piper' && testVoice && testVoice !== 'auto') {
      const vMatch = testVoice.match(/^([a-z]{2})_[A-Z]{2}-/i);
      if (vMatch) {
        testLang = vMatch[1].toLowerCase();
      }
    }
    const testText = getTtsTestPhrase(testLang);

    if (engine === 'browser') {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        if (window.ttsAudioQueueManager) {
          window.ttsAudioQueueManager.applyDucking(actHid, 1, duckVal, solo);
        }
        const cleanPhrase = cleanTextForClientTts(testText, testLang);
        const u = new SpeechSynthesisUtterance(cleanPhrase);
        u.rate = speed;
        u.lang = BCP47_LANG_MAP[testLang] || testLang;

        let vol = 80;
        if (typeof window.getHotspotVolume === 'function') {
          vol = window.getHotspotVolume(actHid);
        }
        u.volume = Math.max(0.0, Math.min(1.0, (vol / 100.0) * 0.40));

        try {
          const voices = window.speechSynthesis.getVoices();
          if (voices && voices.length > 0) {
            const langPrefix = testLang.substring(0, 2).toLowerCase();
            const matching = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(langPrefix));
            if (matching.length > 0) u.voice = matching[0];
          }
        } catch (_) {}

        let restored = false;
        const onDone = () => {
          if (restored) return;
          restored = true;
          if (window.ttsAudioQueueManager) {
            window.ttsAudioQueueManager.finishPlayback();
          }
        };
        u.onend = onDone;
        u.onerror = onDone;

        showToast(window.t ? window.t("transcriber.toast_tts_local", { lang: testLang.toUpperCase() }, `🔊 Локальный синтез речи [${testLang.toUpperCase()}]`) : `🔊 Локальный синтез речи [${testLang.toUpperCase()}]`, 2500);
        window.speechSynthesis.speak(u);
      } else {
        showToast(window.t ? window.t("transcriber.toast_tts_unsupported", {}, "⚠️ Браузерный синтез речи не поддерживается") : "⚠️ Браузерный синтез речи не поддерживается", 3000);
      }
      return;
    }

    if (engine === 'piper') {
      const checkRes = await checkAndPromptPiperModel(testLang, null, null, testVoice);
      if (!checkRes || !checkRes.ok) {
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = window.t ? window.t("transcriber.tts_synthesizing", {}, "⏳ Синтез...") : "⏳ Синтез..."; }
      try {
        const resp = await fetch('/api/transcriber/tts-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: testText,
            engine: 'piper',
            voice: testVoice,
            speed: speed,
            target_lang: testLang,
            announce_callsign: announce,
            callsign: "RX6AWG"
          })
        });
        const data = await resp.json();
        if (data && data.status === 'ok' && data.audio_base64) {
          showToast(window.t ? window.t("transcriber.toast_tts_piper", { lang: testLang.toUpperCase(), voice: testVoice || "default" }, `🔊 Озвучка Piper TTS [${testLang.toUpperCase()}] (${testVoice || "default"})`) : `🔊 Озвучка Piper TTS [${testLang.toUpperCase()}] (${testVoice || "default"})`, 2500);
          if (window.ttsAudioQueueManager) {
            window.ttsAudioQueueManager.enqueue({
              hotspot_id: actHid,
              slot: 1,
              audio_base64: data.audio_base64,
              text: testText,
              engine: 'piper',
              speed: speed,
              ducking_level: duckVal,
              mute_others: solo,
              is_test: true,
              bypassMute: true
            });
          }
        } else {
          console.warn('[TTS] Settings Piper test error:', data);
          const errDetail = data.message || data.detail || 'Ошибка синтеза';
          showToast(window.t ? window.t("transcriber.toast_tts_piper_err", { error: errDetail }, `⚠️ Piper TTS: ${errDetail}`) : `⚠️ Piper TTS: ${errDetail}`, 3500);
        }
      } catch (err) {
        console.error('[TTS] Piper test error:', err);
        const errDetail = err.message || err;
        showToast(window.t ? window.t("transcriber.toast_tts_piper_err", { error: errDetail }, `⚠️ Piper TTS: ${errDetail}`) : `⚠️ Piper TTS: ${errDetail}`, 3500);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = window.t ? window.t("transcriber.tts_btn_test", {}, "🔊 Проверить звук") : "🔊 Проверить звук"; }
      }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = window.t ? window.t("transcriber.tts_synthesizing", {}, "⏳ Синтез...") : "⏳ Синтез..."; }
    try {
      const resp = await fetch('/api/transcriber/tts-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: testText,
          model: model,
          voice: voice,
          api_key: key,
          target_lang: testLang,
          engine: 'gemini',
          speed: speed,
          announce_callsign: announce,
          callsign: "RX6AWG",
          tts_style: style
        })
      });
      const data = await resp.json();
      if (data && data.status === 'ok' && data.audio_base64) {
        showToast(window.t ? window.t("transcriber.toast_tts_gemini", { lang: testLang.toUpperCase(), voice }, `🔊 Озвучка Gemini TTS [${testLang.toUpperCase()}] (${voice})`) : `🔊 Озвучка Gemini TTS [${testLang.toUpperCase()}] (${voice})`, 2500);
        if (window.ttsAudioQueueManager) {
          window.ttsAudioQueueManager.enqueue({
            hotspot_id: actHid,
            slot: 1,
            audio_base64: data.audio_base64,
            text: testText,
            engine: 'gemini',
            speed: speed,
            ducking_level: duckVal,
            mute_others: solo,
            is_test: true,
            bypassMute: true
          });
        }
      } else {
        console.warn('[TTS] Settings test error:', data);
        showToast(`⚠️ ${formatGeminiError(data.message || data.detail || data, 'tts')}`, 3500);
      }
    } catch (err) {
      console.error('[TTS] Test error:', err);
      showToast(`⚠️ ${formatGeminiError(err, 'tts')}`, 3500);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = window.t ? window.t("transcriber.tts_btn_test", {}, "🔊 Проверить звук") : "🔊 Проверить звук"; }
    }
  };
}

function initTranscriberSettings() {
  initPiperDownloadWatcher();
  const form = document.getElementById("transcriberSettingsForm");
  const optEnabled = document.getElementById("optTranscriberEnabled");
  const optApiKey = document.getElementById("optTranscriberApiKey");
  const optModel = document.getElementById("optTranscriberModel");
  if (optModel) {
    Array.from(optModel.options).forEach(opt => {
      const val = (opt.value || "").toLowerCase();
      const txt = (opt.textContent || "").toLowerCase();
      if (val.includes("tts") || txt.includes("tts")) {
        opt.remove();
      }
    });
  }
  const optTtsModel = document.getElementById("optTtsModel");
  const optTtsEngine = document.getElementById("optTtsEngine");
  const optTtsVoice = document.getElementById("optTtsVoice");
  const optTtsDucking = document.getElementById("optTtsDucking");
  const optTtsPauseDucking = document.getElementById("optTtsPauseDucking");
  const optTtsMuteOthers = document.getElementById("optTtsMuteOthers");
  const optNoTranslate = document.getElementById("optTranscriberNoTranslate");
  const optTargetLang = document.getElementById("optTranscriberTargetLang");
  const groupTargetLang = document.getElementById("groupTranscriberTargetLang");
  const btnFetchModels = document.getElementById("btnFetchTranscriberModels");

  // Init collapsible frames
  initGeminiApiKeysFrame();
  initGeminiTtsFrame();

  // ── Model selectors: localStorage persistence ──────────────────────────
  const LS_TRANSCRIBE_MODEL   = 'proxdmr_transcribe_model';
  const LS_TRANSCRIBE_OPTS    = 'proxdmr_transcribe_model_opts';
  const LS_TTS_MODEL          = 'proxdmr_tts_model';
  const LS_TTS_OPTS           = 'proxdmr_tts_model_opts';

  function restoreSelectFromLS(selectEl, lsModelKey, lsOptsKey) {
    if (!selectEl) return;
    // Restore cached option list if available
    const savedOpts = localStorage.getItem(lsOptsKey);
    if (savedOpts) {
      try {
        const opts = JSON.parse(savedOpts);
        if (Array.isArray(opts) && opts.length > 0) {
          // Validation: if this is TTS select, ensure it does NOT contain misplaced transcribe-only models
          if (lsOptsKey === LS_TTS_OPTS) {
            const hasTts = opts.some(o => {
              const val = (o.value || "").toLowerCase();
              return val.includes("tts") || val.includes("live") || val.includes("audio");
            });
            const has38 = opts.some(o => (o.value || "") === "gemini-3.8-flash-lite-tts");
            if (!hasTts || !has38) {
              // Cache was poisoned or outdated — purge it and retain default TTS options
              localStorage.removeItem(LS_TTS_OPTS);
              localStorage.removeItem(LS_TTS_MODEL);
              return;
            }
          }
          if (lsOptsKey === LS_TRANSCRIBE_OPTS) {
            // Strictly exclude any option with 'tts' in value or text
            opts = opts.filter(o => {
              const val = (o.value || "").toLowerCase();
              const txt = (o.text || "").toLowerCase();
              return !val.includes("tts") && !txt.includes("tts");
            });
            const hasFlashLite = opts.some(o => (o.value || "") === "gemini-3.1-flash-lite");
            if (opts.length === 0 || !hasFlashLite) {
              // Cache was outdated — purge it and retain default options
              localStorage.removeItem(LS_TRANSCRIBE_OPTS);
              return;
            }
          }

          selectEl.innerHTML = "";
          opts.forEach(o => {
            const val = (o.value || "").toLowerCase();
            const txt = (o.text || "").toLowerCase();
            if (lsOptsKey === LS_TRANSCRIBE_OPTS && (val.includes("tts") || txt.includes("tts"))) {
              return;
            }
            const opt = document.createElement("option");
            opt.value = o.value;
            opt.textContent = o.text;
            if (o.title) opt.title = o.title;
            selectEl.appendChild(opt);
          });
        }
      } catch (_) {}
    }
    // Restore selected value
    const savedVal = localStorage.getItem(lsModelKey);
    if (savedVal) {
      const exists = Array.from(selectEl.options).some(o => o.value === savedVal);
      if (exists) selectEl.value = savedVal;
    }
  }

  function saveSelectOptsToLS(selectEl, lsModelKey, lsOptsKey) {
    if (!selectEl) return;
    const opts = Array.from(selectEl.options)
      .filter(o => {
        if (lsOptsKey === LS_TRANSCRIBE_OPTS) {
          const val = (o.value || "").toLowerCase();
          const txt = (o.textContent || "").toLowerCase();
          return !val.includes("tts") && !txt.includes("tts");
        }
        return true;
      })
      .map(o => ({
        value: o.value, text: o.textContent, title: o.title || ""
      }));
    try {
      localStorage.setItem(lsOptsKey,  JSON.stringify(opts));
      localStorage.setItem(lsModelKey, selectEl.value);
    } catch (_) {}
  }

  // Dynamic localized rendering for models and target languages
  renderTranscriberModelOptions(optModel);
  renderTtsModelOptions(optTtsModel);
  renderTargetLangSelect(optTargetLang);

  // Restore selected value from LS if present
  const savedTranscribeModel = localStorage.getItem(LS_TRANSCRIBE_MODEL);
  if (savedTranscribeModel && optModel && Array.from(optModel.options).some(o => o.value === savedTranscribeModel)) {
    optModel.value = savedTranscribeModel;
  }
  const savedTtsModel = localStorage.getItem(LS_TTS_MODEL);
  if (savedTtsModel && optTtsModel && Array.from(optTtsModel.options).some(o => o.value === savedTtsModel)) {
    optTtsModel.value = savedTtsModel;
  }

  // Extra safety: purge any TTS options that might still be present in optModel
  if (optModel) {
    Array.from(optModel.options).forEach(opt => {
      const val = (opt.value || "").toLowerCase();
      const txt = (opt.textContent || "").toLowerCase();
      if (val.includes("tts") || txt.includes("tts")) {
        opt.remove();
      }
    });
  }

  saveSelectOptsToLS(optModel, LS_TRANSCRIBE_MODEL, LS_TRANSCRIBE_OPTS);
  saveSelectOptsToLS(optTtsModel, LS_TTS_MODEL, LS_TTS_OPTS);

  // Save selected value on change
  if (optModel)    optModel.addEventListener("change",    () => localStorage.setItem(LS_TRANSCRIBE_MODEL, optModel.value));
  if (optTtsModel) optTtsModel.addEventListener("change", () => localStorage.setItem(LS_TTS_MODEL, optTtsModel.value));

  const duckValEl = document.getElementById("optTtsDuckingVal");
  if (optTtsDucking && duckValEl) {
    optTtsDucking.addEventListener("input", () => {
      const val = parseInt(optTtsDucking.value, 10) || 0;
      duckValEl.textContent = val === 0 ? (window.t ? window.t("transcriber.duck_silence", {}, "0% (тишина)") : "0% (тишина)") : (val === 100 ? (window.t ? window.t("transcriber.duck_none", {}, "100% (без приглушения)") : "100% (без приглушения)") : `${val}%`);
      const duckFactor = val / 100.0;
      if (window.transcriberSettings) {
        window.transcriberSettings.tts_ducking_level = duckFactor;
      }
      if (window.ttsAudioQueueManager) {
        window.ttsAudioQueueManager.updateLiveDucking(duckFactor);
      }
    });
  }

  const pauseDuckValEl = document.getElementById("optTtsPauseDuckingVal");
  if (optTtsPauseDucking && pauseDuckValEl) {
    optTtsPauseDucking.addEventListener("input", () => {
      const val = parseInt(optTtsPauseDucking.value, 10) || 0;
      pauseDuckValEl.textContent = val === 0 ? (window.t ? window.t("transcriber.duck_silence", {}, "0% (тишина)") : "0% (тишина)") : (val === 100 ? (window.t ? window.t("transcriber.duck_none", {}, "100% (без приглушения)") : "100% (без приглушения)") : `${val}%`);
      const pauseDuckFactor = val / 100.0;
      if (window.transcriberSettings) {
        window.transcriberSettings.tts_pause_ducking_level = pauseDuckFactor;
      }
      if (window.ttsAudioQueueManager) {
        window.ttsAudioQueueManager.syncIdleDucking(0.08);
      }
    });
  }

  const optTtsSpeed = document.getElementById("optTtsSpeed");
  const optTtsSpeedVal = document.getElementById("optTtsSpeedVal");
  if (optTtsSpeed && optTtsSpeedVal) {
    optTtsSpeed.addEventListener("input", () => {
      const v = Math.max(1.0, Math.min(2.0, parseFloat(optTtsSpeed.value) || 1.1));
      optTtsSpeedVal.textContent = `${v.toFixed(2).replace(/\.?0+$/, "")}x`;
      if (window.transcriberSettings) {
        window.transcriberSettings.tts_speed = v;
      }
      const qSpeed = document.getElementById("ttsQuickSpeed");
      const qSpeedVal = document.getElementById("ttsQuickSpeedVal");
      if (qSpeed) qSpeed.value = v.toFixed(2);
      if (qSpeedVal) qSpeedVal.textContent = optTtsSpeedVal.textContent;
    });
  }

  const updateNoTranslateUI = () => {
    const isNoTrans = optNoTranslate ? optNoTranslate.checked : false;
    if (optTargetLang) {
      optTargetLang.disabled = isNoTrans;
    }
    if (groupTargetLang) {
      groupTargetLang.style.opacity = isNoTrans ? "0.4" : "1";
      groupTargetLang.style.filter = isNoTrans ? "grayscale(80%)" : "none";
      groupTargetLang.style.pointerEvents = isNoTrans ? "none" : "";
    }
    refreshAllSlotTtsBadges(isNoTrans ? "none" : (optTargetLang ? optTargetLang.value : "ru"));
  };

  if (optNoTranslate) {
    optNoTranslate.addEventListener("change", updateNoTranslateUI);
  }
  if (optTargetLang) {
    optTargetLang.addEventListener("change", () => {
      refreshAllSlotTtsBadges(optTargetLang.value);
    });
  }
  if (optTtsMuteOthers) {
    optTtsMuteOthers.addEventListener("change", () => {
      const isSolo = optTtsMuteOthers.checked;
      if (window.transcriberSettings) {
        window.transcriberSettings.tts_mute_others = isSolo;
      }
      const qSolo = document.getElementById("ttsQuickSolo");
      if (qSolo) qSolo.checked = isSolo;
      syncTtsSoloMode();
      if (typeof window.summaryTtsReader !== "undefined" && window.summaryTtsReader && window.summaryTtsReader.isPlaying) {
        window.summaryTtsReader.applySoloMute(isSolo);
      }
    });
  }
  const optTtsAnnounceCallsign = document.getElementById("optTtsAnnounceCallsign");
  if (optTtsAnnounceCallsign) {
    optTtsAnnounceCallsign.addEventListener("change", () => {
      const isAnnounce = optTtsAnnounceCallsign.checked;
      if (window.transcriberSettings) {
        window.transcriberSettings.tts_announce_callsign = isAnnounce;
      }
      const qAnnounce = document.getElementById("ttsQuickAnnounceCallsign");
      if (qAnnounce) qAnnounce.checked = isAnnounce;
    });
  }

  fetch("/api/transcriber/settings")
    .then(r => r.json())
    .then(data => {
      if (data && data.settings) {
        window.transcriberSettings = data.settings;
        if (optApiKey) optApiKey.value = data.settings.api_key || "";
        if (optModel && data.settings.model) {
          let mVal = data.settings.model;
          optModel.value = mVal;
        }
        const effEngine = data.settings.tts_engine || "gemini";
        const effVoice = data.settings.tts_voice || "auto";
        if (optTtsEngine) {
          optTtsEngine.value = effEngine;
          const groupModel = document.getElementById('groupGeminiTtsModel');
          if (groupModel) groupModel.style.display = (effEngine === 'gemini') ? 'block' : 'none';
          const groupStyle = document.getElementById('groupGeminiTtsStyle');
          if (groupStyle) groupStyle.style.display = (effEngine === 'gemini') ? 'block' : 'none';
        }
        if (data.settings.tts_model && optTtsModel) optTtsModel.value = data.settings.tts_model;
        const optTtsStyle = document.getElementById('optTtsStyle');
        if (data.settings.tts_style && optTtsStyle) optTtsStyle.value = data.settings.tts_style;
        if (data.settings.tts_ducking_level !== undefined && optTtsDucking) {
          let dVal = data.settings.tts_ducking_level;
          const dPct = (dVal <= 1.0) ? Math.round(dVal * 100) : Math.round(dVal);
          optTtsDucking.value = String(dPct);
          if (duckValEl) {
            duckValEl.textContent = (dPct === 0) ? (window.t ? window.t("transcriber.duck_silence", {}, "0% (тишина)") : "0% (тишина)") : (dPct === 100 ? (window.t ? window.t("transcriber.duck_none", {}, "100% (без приглушения)") : "100% (без приглушения)") : `${dPct}%`);
          }
        }
        if (data.settings.tts_pause_ducking_level !== undefined && optTtsPauseDucking) {
          let pVal = data.settings.tts_pause_ducking_level;
          const pPct = (pVal <= 1.0) ? Math.round(pVal * 100) : Math.round(pVal);
          optTtsPauseDucking.value = String(pPct);
          if (pauseDuckValEl) {
            pauseDuckValEl.textContent = (pPct === 0) ? (window.t ? window.t("transcriber.duck_silence", {}, "0% (тишина)") : "0% (тишина)") : (pPct === 100 ? (window.t ? window.t("transcriber.duck_none", {}, "100% (без приглушения)") : "100% (без приглушения)") : `${pPct}%`);
          }
        }
        if (data.settings.tts_mute_others !== undefined && optTtsMuteOthers) optTtsMuteOthers.checked = Boolean(data.settings.tts_mute_others);
        if (data.settings.tts_announce_callsign !== undefined && optTtsAnnounceCallsign) optTtsAnnounceCallsign.checked = Boolean(data.settings.tts_announce_callsign);
        const optTtsSpeed = document.getElementById("optTtsSpeed");
        const speedValEl = document.getElementById("optTtsSpeedVal");
        if (data.settings.tts_speed !== undefined && optTtsSpeed) {
          const sVal = Math.max(1.0, Math.min(2.0, parseFloat(data.settings.tts_speed) || 1.1));
          optTtsSpeed.value = sVal.toFixed(2);
          if (speedValEl) {
            speedValEl.textContent = `${sVal.toFixed(2).replace(/\.?0+$/, "")}x`;
          }
        }

        if (window.ttsAudioQueueManager) {
          window.ttsAudioQueueManager.syncIdleDucking(0.15);
        }

        const isNoTranslate = (data.settings.target_lang === "none");
        if (optNoTranslate) optNoTranslate.checked = isNoTranslate;
        if (optTargetLang) {
          if (!isNoTranslate && data.settings.target_lang) {
            optTargetLang.value = data.settings.target_lang;
          } else if (!optTargetLang.value) {
            optTargetLang.value = "ru";
          }
        }
        updateNoTranslateUI();

        const effLang = (!isNoTranslate && data.settings.target_lang) ? data.settings.target_lang : (optTargetLang ? optTargetLang.value : "ru");
        const ttsVoiceHint = document.getElementById("ttsVoiceHint");
        if (optTtsVoice) {
          populateVoiceSelect(optTtsVoice, effEngine, effLang, effVoice, ttsVoiceHint);
        }
        refreshAllSlotTtsBadges();
      }
    })
    .catch(err => console.error("[TRANSCRIBER] Failed to load settings:", err));

  loadTranscriberModelsCache();


  const btnGeminiHelp = document.getElementById("btnGeminiApiHelp");
  const btnCloseGeminiHelp = document.getElementById("btnCloseGeminiApiHelp");
  const geminiHelpCard = document.getElementById("geminiApiHelpCard");

  if (btnGeminiHelp && geminiHelpCard) {
    btnGeminiHelp.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      geminiHelpCard.classList.toggle("hidden");
    });
  }

  if (btnCloseGeminiHelp && geminiHelpCard) {
    btnCloseGeminiHelp.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      geminiHelpCard.classList.add("hidden");
    });
  }

  if (btnFetchModels) {
    btnFetchModels.addEventListener("click", async () => {
      // Use first enabled API key from keys frame
      const keyInp = document.querySelector('#geminiApiKeysBody .apikey-cb:checked + .apikey-name + .apikey-input-wrap .apikey-input, #geminiApiKeysBody .apikey-cb:checked ~ .apikey-input-wrap .apikey-input');
      const key = (keyInp && keyInp.value.trim()) ? keyInp.value.trim()
                : (optApiKey ? optApiKey.value.trim() : "");

      btnFetchModels.disabled = true;
      const originalText = btnFetchModels.textContent;
      btnFetchModels.textContent = window.t ? window.t("transcriber.models_fetching", {}, "⏳ Загрузка...") : "⏳ Загрузка...";

      try {
        const url = key ? `/api/transcriber/models?api_key=${encodeURIComponent(key)}` : "/api/transcriber/models";
        const resp = await fetch(url);
        const resJson = await resp.json();
        if (resJson && ((resJson.models && resJson.models.length > 0) || (resJson.transcribe_models && resJson.transcribe_models.length > 0))) {
          const allModels = Array.isArray(resJson.models) ? resJson.models : [];

          // Transcription models: Audio -> Text & Translation (Strictly NO TTS)
          function isTranscriptionModel(m) {
            if (!m) return false;
            if (m.category === "tts") return false;
            const id = (m.id || "").toLowerCase();
            const name = (m.name || "").toLowerCase();
            if (id.includes("tts") || name.includes("tts")) return false;
            if (id.includes("native-audio")) return false;
            if (id.includes("-live") && !id.includes("live-translate")) return false;
            if (id.includes("-image") || id.includes("embedding") || id.startsWith("veo") || id.startsWith("lyria") || id.startsWith("imagen") || id.includes("omni")) return false;
            return true;
          }

          // TTS models: Text -> Audio
          function isTtsModel(m) {
            if (m.category === "tts") return true;
            if (m.category === "transcribe") return false;
            const id = (m.id || "").toLowerCase();
            if (id.includes("-tts") || id.includes("native-audio") || id.includes("-live")) return true;
            return false;
          }

          function populateSelect(selectEl, models, lsModelKey, lsOptsKey) {
            if (!selectEl || !models || models.length === 0) return;
            const prevVal = selectEl.value;
            const isTts = (lsModelKey === LS_TTS_MODEL);
            selectEl.innerHTML = "";
            models.forEach(m => {
              const info = getLocalizedModelLabel(m, isTts);
              const opt = document.createElement("option");
              opt.value = m.id;
              opt.textContent = info.label;
              if (info.title) opt.title = info.title;
              if (info.badge) opt.dataset.badge = info.badge;
              selectEl.appendChild(opt);
            });
            const exists = Array.from(selectEl.options).some(o => o.value === prevVal);
            if (exists) {
              selectEl.value = prevVal;
            } else if (selectEl.options.length > 0) {
              selectEl.value = selectEl.options[0].value;
            }
            saveSelectOptsToLS(selectEl, lsModelKey, lsOptsKey);
          }

          let transcribeModels = (resJson.transcribe_models && resJson.transcribe_models.length > 0)
            ? resJson.transcribe_models.filter(isTranscriptionModel)
            : allModels.filter(isTranscriptionModel);

          let ttsModels = (resJson.tts_models && resJson.tts_models.length > 0)
            ? resJson.tts_models
            : allModels.filter(isTtsModel);

          // Guarantee valid lists even if remote backend returned unusual response
          if (ttsModels.length === 0) {
            ttsModels = [
              { id: "gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS Preview — ⚡ Новейшая (Рекомендуется)", description: "Новейшая TTS: низкая задержка, 30 голосов, поддержка стриминга, мульти-спикеры.", badge: "Рекомендуется" },
              { id: "gemini-3.8-flash-lite-tts", name: "Gemini 3.8 Flash-Lite TTS — ⚡ Быстрый синтез (TTS)", description: "Облегченная модель генерации речи Text-to-Speech с ультранизкой задержкой.", badge: "Быстрая TTS" },
              { id: "gemini-3.8-flash-tts", name: "Gemini 3.8 Flash TTS — 🔊 Синтез речи (TTS)", description: "Полноформатная модель Text-to-Speech высокого качества.", badge: "TTS" },
              { id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS Preview — 🚀 Быстрая (Free Tier)", description: "Быстрая и экономичная генерация речи с минимальной задержкой.", badge: "Быстрая" },
              { id: "gemini-2.5-pro-preview-tts", name: "Gemini 2.5 Pro TTS Preview — 🧠 Студийное качество (Paid)", description: "Студийное качество синтеза речи — для подкастов и аудиокниг. Только платный тариф.", badge: "Pro" },
              { id: "gemini-3.1-flash-live-preview", name: "Gemini 3.1 Flash Live — 🎙️ Live Voice (Двустороннее аудио)", description: "Интерактивная голосовая модель реального времени Live API.", badge: "Live Voice" }
            ];
          }

          if (transcribeModels.length === 0) {
            transcribeModels = cachedTranscriberModels.filter(isTranscriptionModel);
          }

          populateSelect(optModel,    transcribeModels, LS_TRANSCRIBE_MODEL, LS_TRANSCRIBE_OPTS);
          populateSelect(optTtsModel, ttsModels,        LS_TTS_MODEL,        LS_TTS_OPTS);

          const updatedMsg = window.t ? window.t("transcriber.toast_models_updated", { transcribe: transcribeModels.length, tts: ttsModels.length }, `✓ Модели обновлены: ${transcribeModels.length} для транскрибации, ${ttsModels.length} для синтеза`) : `✓ Модели обновлены: ${transcribeModels.length} для транскрибации, ${ttsModels.length} для синтеза`;
          showToast(updatedMsg, 3000);
        } else {
          showToast(window.t ? window.t("transcriber.models_fetch_fail", {}, "⚠️ Не удалось получить модели. Проверьте ключ API.") : "⚠️ Не удалось получить модели. Проверьте ключ API.", 3500);
        }
      } catch (err) {
        console.error(err);
        showToast(window.t ? window.t("transcriber.models_fetch_err", {}, "⚠️ Ошибка запроса моделей к Gemini API") : "⚠️ Ошибка запроса моделей к Gemini API", 3500);
      } finally {
        btnFetchModels.disabled = false;
        btnFetchModels.textContent = originalText;
      }
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const isNoTrans = optNoTranslate ? optNoTranslate.checked : false;
      const targetLangVal = isNoTrans ? "none" : (optTargetLang && optTargetLang.value ? optTargetLang.value : "ru");

      // Collect all enabled keys from keys frame
      const enabledKeys = [];
      const keysBody = document.getElementById("geminiApiKeysBody");
      if (keysBody) {
        keysBody.querySelectorAll(".apikey-row").forEach(row => {
          const cb = row.querySelector(".apikey-cb");
          const inp = row.querySelector(".apikey-input");
          if (cb && cb.checked && inp && inp.value.trim()) {
            enabledKeys.push(inp.value.trim());
          }
        });
      }
      if (enabledKeys.length === 0 && optApiKey && optApiKey.value.trim()) {
        enabledKeys.push(optApiKey.value.trim());
      }

      const payload = {
        enabled: true,
        api_key: enabledKeys[0] || (optApiKey ? optApiKey.value.trim() : ""),
        api_keys: enabledKeys,
        model: optModel ? optModel.value : "gemini-3.5-flash",
        target_lang: targetLangVal,
        tts_engine: optTtsEngine ? optTtsEngine.value : "gemini",
        tts_model: optTtsModel ? optTtsModel.value : "gemini-3.1-flash-tts-preview",
        tts_voice: (optTtsVoice && optTtsVoice.value && !optTtsVoice.value.startsWith("__download__")) ? optTtsVoice.value : "auto",
        tts_speed: optTtsSpeed ? (parseFloat(optTtsSpeed.value) || 1.1) : 1.1,
        tts_ducking_level: optTtsDucking ? (Math.max(0, Math.min(100, parseFloat(optTtsDucking.value) || 80)) / 100.0) : 0.80,
        tts_pause_ducking_level: optTtsPauseDucking ? (Math.max(0, Math.min(100, parseFloat(optTtsPauseDucking.value) || 100)) / 100.0) : 1.0,
        tts_mute_others: optTtsMuteOthers ? optTtsMuteOthers.checked : true,
        tts_announce_callsign: (optTtsAnnounceCallsign ? optTtsAnnounceCallsign.checked : false),
        tts_style: (document.getElementById("optTtsStyle") ? document.getElementById("optTtsStyle").value : "radio")
      };

      try {
        const resp = await fetch("/api/transcriber/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const resJson = await resp.json();
        if (resJson.status === "ok") {
          window.transcriberSettings = resJson.settings;
          const qAnnounce = document.getElementById("ttsQuickAnnounceCallsign");
          if (qAnnounce) qAnnounce.checked = Boolean(resJson.settings?.tts_announce_callsign);
          const qSolo = document.getElementById("ttsQuickSolo");
          if (qSolo) qSolo.checked = Boolean(resJson.settings?.tts_mute_others);
          const qStyle = document.getElementById("ttsQuickStyle");
          if (qStyle) qStyle.value = resJson.settings?.tts_style || "radio";
          const qSpeed = document.getElementById("ttsQuickSpeed");
          const qSpeedVal = document.getElementById("ttsQuickSpeedVal");
          const curSpd = Number(resJson.settings?.tts_speed || 1.1);
          if (qSpeed) qSpeed.value = curSpd.toFixed(2);
          if (qSpeedVal) qSpeedVal.textContent = `${curSpd.toFixed(2).replace(/\.?0+$/, "")}x`;
          refreshAllSlotTtsBadges();
          if (window.ttsAudioQueueManager) {
            window.ttsAudioQueueManager.syncIdleDucking(0.15);
          }
          showToast(window.t ? window.t("transcriber.settings_saved", {}, "✓ Настройки AI Транскрибатора сохранены") : "✓ Настройки AI Транскрибатора сохранены", 3000);
          if (typeof window.triggerModalSavePulse === "function") {
            window.triggerModalSavePulse(form);
          }
        }
      } catch (err) {
        console.error(err);
        showToast(window.t ? window.t("transcriber.settings_save_err", {}, "⚠️ Ошибка сохранения настроек транскрибатора") : "⚠️ Ошибка сохранения настроек транскрибатора", 3500);
      }
    });
  }
}


// --- Module Exports ---
export {
  safeEscapeHtml,
  getSlotTranscribeKey,
  isSlotTranscribeActive,
  resolveTranscribeCallsign,
  formatCaptionEntryHtml,
  updateCallLogTranscription,
  handleCallTranscription,
  triggerSlotTranscribeError,
  handleTranscriptionError,
  updateSlotLangBadge,
  DEFAULT_TRANSCRIBER_MODELS,
  loadTranscriberModelsCache,
  getCurrentTranscriberModel,
  selectTranscriberModel,
  closeTranscriberModelPicker,
  positionModelPicker,
  openTranscriberModelPicker,
  setupSlotTranscribeClick,
  setupSlotLongPress,
  toggleSlotTranscribe,
  getMaximizedKey,
  alignTranscribeCardHeight,
  updateCardTranscribeLayout,
  setSlotMaximized,
  setupCaptionBoxLongPress,
  clearAllTranscribeLocalStorage,
  disableSlotTranscribe,
  disableHotspotTranscribe,
  disableAllTranscribe,
  syncCardSlotTranscribeUI,
  syncAllTranscribeSlotsToServer,
  initSlotTranscribeState,
  initTranscriberSettings,
  handleTtsSpeech,
  setupSlotTtsClick,
  setupRecTtsButton,
  toggleSlotTts,
  updateSlotTtsBadge,
  isSlotTtsActive,
  getSlotTtsKey,
  openTtsQuickSettingsPopover,
  closeTtsQuickSettingsPopover,
  openTxtQuickSettingsPopover,
  closeTxtQuickSettingsPopover,
  formatGeminiError,
  handleTtsError,
  TtsAudioQueueManager,
  GEMINI_TTS_VOICES,
  getGeminiTtsVoices,
  populateVoiceSelect,
  checkAndPromptPiperModel,
  SUPPORTED_TARGET_LANGUAGES,
  renderTargetLangSelect,
  renderTranscriberModelOptions,
  renderTtsModelOptions,
  getLocalizedModelLabel,
  get3LetterLangCode,
  LANG_3LETTER_MAP,
  refreshAllSlotTtsBadges,
  syncTtsSoloMode,
  TRANSCRIBER_MODELS_META,
  TTS_MODELS_META
};

if (typeof window !== "undefined") {
  window.handleCallTranscription = handleCallTranscription;
  window.handleTranscriptionError = handleTranscriptionError;
  window.handleTtsError = handleTtsError;
  window.formatGeminiError = formatGeminiError;
  window.updateCallLogTranscription = updateCallLogTranscription;
  window.handleTtsSpeech = handleTtsSpeech;
  window.setupSlotTranscribeClick = setupSlotTranscribeClick;
  window.setupSlotTtsClick = setupSlotTtsClick;
  window.setupRecTtsButton = setupRecTtsButton;
  window.setupSlotLongPress = setupSlotLongPress;
  window.setupCaptionBoxLongPress = setupCaptionBoxLongPress;
  window.syncCardSlotTranscribeUI = syncCardSlotTranscribeUI;
  window.syncAllTranscribeSlotsToServer = syncAllTranscribeSlotsToServer;
  window.disableAllTranscribe = disableAllTranscribe;
  window.disableHotspotTranscribe = disableHotspotTranscribe;
  window.disableSlotTranscribe = disableSlotTranscribe;
  window.isSlotTranscribeActive = isSlotTranscribeActive;
  window.isSlotTtsActive = isSlotTtsActive;
  window.toggleSlotTranscribe = toggleSlotTranscribe;
  window.toggleSlotTts = toggleSlotTts;
  window.updateSlotTtsBadge = updateSlotTtsBadge;
  window.openTranscriberModelPicker = openTranscriberModelPicker;
  window.closeTranscriberModelPicker = closeTranscriberModelPicker;
  window.openTtsQuickSettingsPopover = openTtsQuickSettingsPopover;
  window.closeTtsQuickSettingsPopover = closeTtsQuickSettingsPopover;
  window.openTxtQuickSettingsPopover = openTxtQuickSettingsPopover;
  window.closeTxtQuickSettingsPopover = closeTxtQuickSettingsPopover;
  window.getCurrentTranscriberModel = getCurrentTranscriberModel;
  window.selectTranscriberModel = selectTranscriberModel;
  window.initSlotTranscribeState = initSlotTranscribeState;
  window.initTranscriberSettings = initTranscriberSettings;
  window.setSlotMaximized = setSlotMaximized;
  window.alignTranscribeCardHeight = alignTranscribeCardHeight;
  window.updateCardTranscribeLayout = updateCardTranscribeLayout;
  window.updateSlotLangBadge = updateSlotLangBadge;
  window.GEMINI_TTS_VOICES = GEMINI_TTS_VOICES;
  window.getGeminiTtsVoices = getGeminiTtsVoices;
  window.populateVoiceSelect = populateVoiceSelect;
  window.checkAndPromptPiperModel = checkAndPromptPiperModel;
  window.SUPPORTED_TARGET_LANGUAGES = SUPPORTED_TARGET_LANGUAGES;
  window.renderTargetLangSelect = renderTargetLangSelect;
  window.renderTranscriberModelOptions = renderTranscriberModelOptions;
  window.renderTtsModelOptions = renderTtsModelOptions;
  window.getLocalizedModelLabel = getLocalizedModelLabel;
  window.get3LetterLangCode = get3LetterLangCode;
  window.LANG_3LETTER_MAP = LANG_3LETTER_MAP;
  window.refreshAllSlotTtsBadges = refreshAllSlotTtsBadges;
  window.syncTtsSoloMode = syncTtsSoloMode;

  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.handleCallTranscription = handleCallTranscription;
  window.__proxdmr.handleTranscriptionError = handleTranscriptionError;
  window.__proxdmr.updateCallLogTranscription = updateCallLogTranscription;
  window.__proxdmr.handleTtsSpeech = handleTtsSpeech;
  window.__proxdmr.toggleSlotTranscribe = toggleSlotTranscribe;
  window.__proxdmr.toggleSlotTts = toggleSlotTts;
  window.__proxdmr.setupRecTtsButton = setupRecTtsButton;
  window.__proxdmr.openTranscriberModelPicker = openTranscriberModelPicker;
  window.__proxdmr.closeTranscriberModelPicker = closeTranscriberModelPicker;
  window.__proxdmr.openTtsQuickSettingsPopover = openTtsQuickSettingsPopover;
  window.__proxdmr.closeTtsQuickSettingsPopover = closeTtsQuickSettingsPopover;
  window.__proxdmr.openTxtQuickSettingsPopover = openTxtQuickSettingsPopover;
  window.__proxdmr.closeTxtQuickSettingsPopover = closeTxtQuickSettingsPopover;
  window.__proxdmr.syncCardSlotTranscribeUI = syncCardSlotTranscribeUI;
  window.__proxdmr.syncAllTranscribeSlotsToServer = syncAllTranscribeSlotsToServer;
  window.__proxdmr.disableAllTranscribe = disableAllTranscribe;
  window.__proxdmr.disableHotspotTranscribe = disableHotspotTranscribe;
  window.__proxdmr.disableSlotTranscribe = disableSlotTranscribe;
  window.__proxdmr.isSlotTranscribeActive = isSlotTranscribeActive;
  window.__proxdmr.isSlotTtsActive = isSlotTtsActive;
  window.__proxdmr.alignTranscribeCardHeight = alignTranscribeCardHeight;
  window.__proxdmr.updateCardTranscribeLayout = updateCardTranscribeLayout;
  window.__proxdmr.populateVoiceSelect = populateVoiceSelect;
  window.__proxdmr.checkAndPromptPiperModel = checkAndPromptPiperModel;
  window.__proxdmr.renderTargetLangSelect = renderTargetLangSelect;
  window.__proxdmr.renderTranscriberModelOptions = renderTranscriberModelOptions;
  window.__proxdmr.renderTtsModelOptions = renderTtsModelOptions;
  window.__proxdmr.getGeminiTtsVoices = getGeminiTtsVoices;
  window.__proxdmr.getLocalizedModelLabel = getLocalizedModelLabel;
  window.__proxdmr.get3LetterLangCode = get3LetterLangCode;
  window.__proxdmr.LANG_3LETTER_MAP = LANG_3LETTER_MAP;
  window.__proxdmr.refreshAllSlotTtsBadges = refreshAllSlotTtsBadges;
  window.__proxdmr.syncTtsSoloMode = syncTtsSoloMode;
}
