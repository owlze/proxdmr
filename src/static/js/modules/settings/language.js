import { refreshAllCardsBmBanner } from '../dmr/bm-banner.js?v=2.9.378';
import { currentBmStatus, updateBmStatus } from '../dmr/bm-status.js';
import { renderHotspotsList } from '../dmr/hotspots.js?v=2.9.367';

/**
 * Language Selector & i18n Localization Engine Module
 */
export function initLanguageManager() {
  const optLanguage = document.getElementById("optLanguage");
  if (optLanguage) {
    if (window.I18N) {
      window.I18N.populateLanguageSelect();
    }
    const savedLang = localStorage.getItem("proxdmr_language") || "ru";
    optLanguage.value = savedLang;
    optLanguage.addEventListener("change", () => {
      const chosenLang = optLanguage.value;
      if (window.isDemoMode) {
        try { localStorage.setItem("proxdmr_demo_language", chosenLang); } catch (_) {}
      }
      if (window.I18N) {
        window.I18N.setLanguage(chosenLang);
      } else {
        localStorage.setItem("proxdmr_language", chosenLang);
      }
      if (window.isDemoMode) {
        return;
      }
      const ws = window.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "set_language", language: chosenLang }));
      }
      try {
        fetch("/api/settings/general", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: chosenLang })
        }).catch(() => {});
      } catch (e) {}
    });
  }

  if (window.I18N) {
    window.I18N.onLanguageChange((lang) => {
      // Re-apply static translations
      window.I18N.apply();

      if (window.isDemoMode) {
        const demoCallTxt = window.t ? window.t("demo.your_callsign", {}, "Ваш позывной") : "Ваш позывной";
        const optQrzComU = document.getElementById("optQrzComUsername");
        if (optQrzComU) optQrzComU.value = demoCallTxt;
        const optHamU = document.getElementById("optHamQthUsername");
        if (optHamU) optHamU.value = demoCallTxt;
        const editHsCall = document.getElementById("editHsCallsign");
        if (editHsCall) editHsCall.value = demoCallTxt;

        const demoNameTxt = window.t ? window.t("demo.your_name", {}, "Ваше имя") : "Ваше имя";
        const editHsTa = document.getElementById("editHsTalkerAlias");
        if (editHsTa) editHsTa.value = demoNameTxt;
      }
      // Update pre-gain badge unit
      const optPreGain = document.getElementById("optPreGain");
      const optPreGainVal = document.getElementById("optPreGainVal");
      if (optPreGain && optPreGainVal) {
        const val = Math.round(parseFloat(optPreGain.value) || 0);
        const unit = (lang === "ru" || lang === "uk") ? "дБ" : "dB";
        optPreGainVal.textContent = val > 0 ? `+${val} ${unit}` : `${val} ${unit}`;
      }
      // Update idle standby caller texts
      document.querySelectorAll(".ts-caller-call").forEach(el => {
        if (!el.classList.contains("caller-active") && (!el.textContent || el.textContent === "Ожидание вызова..." || el.textContent === "Waiting for call...")) {
          el.textContent = window.t ? window.t("vfo.standby") : "Ожидание вызова...";
        }
      });
      // Update standby mode badges
      document.querySelectorAll(".mode-badge.mode-standby").forEach(el => {
        el.textContent = window.t ? window.t("status.standby_mode") : "STANDBY";
      });
      // Dynamic updates for modals and panels
      if (typeof window.renderLogHotspotTabs === "function") window.renderLogHotspotTabs();
      if (typeof window.renderLogList === "function") window.renderLogList();
      if (typeof renderHotspotsList === "function") renderHotspotsList();
      if (typeof window.renderBmMastersDropdown === "function") {
        const editHsHostEl = document.getElementById("editHsHost");
        window.renderBmMastersDropdown(editHsHostEl ? editHsHostEl.value : "");
      }
      if (typeof window.renderContactsTree === "function") {
        window.renderContactsTree();
      }
      if (typeof window.renderTranscriberModelOptions === "function") {
        window.renderTranscriberModelOptions();
      }
      if (typeof window.renderTtsModelOptions === "function") {
        window.renderTtsModelOptions();
      }
      if (typeof window.renderTargetLangSelect === "function") {
        window.renderTargetLangSelect();
      }
      if (typeof window.populateVoiceSelect === "function") {
        const selVoice = document.getElementById("optTtsVoice");
        const selEngine = document.getElementById("optTtsEngine");
        const hintVoice = document.getElementById("ttsVoiceHint");
        if (selVoice) {
          window.populateVoiceSelect(selVoice, selEngine ? selEngine.value : "gemini", null, selVoice.value, hintVoice);
        }
      }
      if (typeof window.renderSlotList === "function") {
        window.renderSlotList(1);
        window.renderSlotList(2);
      }
      if (typeof window.updateDsdfmePresetUI === "function") window.updateDsdfmePresetUI();
      if (typeof window.updateAudioPresetUI === "function") window.updateAudioPresetUI();
      if (typeof refreshAllCardsBmBanner === "function") refreshAllCardsBmBanner();
      if (typeof window.updateGwStatus === "function") {
        const ws = window.ws;
        window.updateGwStatus(Boolean(ws && ws.readyState === WebSocket.OPEN));
      }
      if (typeof window.updateBmStatus === "function") {
        const hsList = (typeof window !== "undefined" && Array.isArray(window.currentHotspots)) ? window.currentHotspots : [];
        if (hsList.length > 0) {
          hsList.forEach(h => window.updateBmStatus(h.status || "OFFLINE", h.detail || "", h.id));
        } else {
          window.updateBmStatus(currentBmStatus);
        }
      }
      if (typeof window.updateApkUpdateUI === "function") window.updateApkUpdateUI();
      if (typeof window.updateTgDisplay === "function") window.updateTgDisplay();
      if (typeof window.renderQuickMemButtons === "function") window.renderQuickMemButtons();
    });
  }
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.initLanguageManager = initLanguageManager;
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.initLanguageManager = initLanguageManager;
}
