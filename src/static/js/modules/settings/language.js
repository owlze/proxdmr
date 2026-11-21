import { refreshAllCardsBmBanner } from '../dmr/bm-banner.js?v=2.9.799';
import { currentBmStatus, updateBmStatus } from '../dmr/bm-status.js?v=2.9.799';
import { renderHotspotsList } from '../dmr/hotspots.js?v=2.9.799';

/**
 * Language Selector & i18n Localization Engine Module
 */
export function initLanguageManager() {
  const optLanguage = document.getElementById("optLanguage");
  if (optLanguage) {
    if (window.I18N) {
      window.I18N.populateLanguageSelect();
    }
    const savedLang = (window.I18N && window.I18N.currentLang) || localStorage.getItem("proxdmr_language") || "ru";
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
      const ws = window.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "set_language", language: chosenLang }));
      }
      if (window.isDemoMode) {
        return;
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

        const demoNameTxt = window.t ? window.t("demo.your_name", {}, "Your Name") : "Your Name";
        const editHsTa = document.getElementById("editHsTalkerAlias");
        if (editHsTa) editHsTa.value = demoNameTxt;
      }
      // Update pre-gain badge unit
      const optPreGain = document.getElementById("optPreGain");
      const optPreGainVal = document.getElementById("optPreGainVal");
      if (optPreGain && optPreGainVal) {
        const val = Math.round(parseFloat(optPreGain.value) || 0);
        const unit = window.t ? window.t("audio.unit_db", {}, "dB") : "dB";
        optPreGainVal.textContent = val > 0 ? `+${val} ${unit}` : `${val} ${unit}`;
      }
      // Update idle standby caller texts across any previously selected language
      document.querySelectorAll(".ts-caller-call").forEach(el => {
        if (el.classList.contains("caller-active")) return;
        const txt = (el.textContent || "").trim();
        const isStandby = el.dataset.standby === "1" || !txt ||
          txt === "Ожидание вызова..." || txt === "Waiting for call..." ||
          (window.I18N && typeof window.I18N.isTranslationOf === "function" && window.I18N.isTranslationOf("vfo.standby", txt));
        if (isStandby) {
          el.textContent = window.t ? window.t("vfo.standby") : "Waiting for call...";
          el.dataset.standby = "1";
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
      if (typeof window.renderSourceLangSelect === "function") {
        window.renderSourceLangSelect();
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
      if (typeof window.updateAudioRxPresetUI === "function") window.updateAudioRxPresetUI();
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
      if (typeof window.updateHotspotCardPanUI === "function") window.updateHotspotCardPanUI();
      if (typeof window.updateAllHotspotRecUI === "function") window.updateAllHotspotRecUI();
      if (typeof window.setSwlState === "function" && typeof window.isSwlMode === "boolean") {
        window.setSwlState(window.isSwlMode);
      }
      if (typeof window.renderQuickMemButtons === "function") window.renderQuickMemButtons();
      if (typeof window.renderBmBenchmarkTable === "function") window.renderBmBenchmarkTable();
      if (typeof window.updatePttLockUI === "function") window.updatePttLockUI();
      if (typeof window.refreshAuthLocalization === "function") window.refreshAuthLocalization();
      if (typeof window.refreshAdminLocalization === "function") window.refreshAdminLocalization();
      if (typeof window.refreshSearchLocalization === "function") window.refreshSearchLocalization();
      if (typeof window.refreshStaticTgLocalization === "function") window.refreshStaticTgLocalization();
      if (typeof window.refreshSystemUpdaterLocalization === "function") window.refreshSystemUpdaterLocalization();
      if (typeof window.refreshAlertsLocalization === "function") window.refreshAlertsLocalization();
      if (typeof window.refreshDspPresetLocalization === "function") window.refreshDspPresetLocalization();
      if (typeof window.updateAllVolumeAndMuteUI === "function") window.updateAllVolumeAndMuteUI();
    });
  }
}

// Window & __proxdmr bridge for backward compatibility
if (typeof window !== "undefined") {
  window.initLanguageManager = initLanguageManager;
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.initLanguageManager = initLanguageManager;
}
