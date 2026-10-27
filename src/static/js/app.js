import { safeEscapeHtml } from './modules/core/formatters.js?v=2.9.380';
import { RecordingsManager } from './modules/audio/player.js';
import './modules/ui/theme.js';
import './modules/dmr/bm-monitor.js?v=2.9.367';
import './modules/dmr/log-selection.js';
import {
  handleCallTranscription,
  handleTranscriptionError,
  updateCallLogTranscription,
  setupSlotTranscribeClick,
  setupSlotLongPress,
  setupCaptionBoxLongPress,
  syncCardSlotTranscribeUI,
  syncAllTranscribeSlotsToServer,
  initSlotTranscribeState,
  initTranscriberSettings,
  disableAllTranscribe,
  disableHotspotTranscribe,
  disableSlotTranscribe,
  isSlotTranscribeActive,
  toggleSlotTranscribe,
  openTranscriberModelPicker,
  closeTranscriberModelPicker,
  openTxtQuickSettingsPopover,
  closeTxtQuickSettingsPopover,
  setSlotMaximized,
  updateSlotLangBadge,
  getCurrentTranscriberModel,
  selectTranscriberModel
} from './modules/dmr/transcriber.js?v=2.9.387';
import { blePtt } from './modules/ptt/ble.js';
import { initApkUpdater } from './modules/core/updater.js?v=2.9.367';
import { initAndroidBridge } from './modules/core/android.js';
import { setupDsdfmeModal } from './modules/settings/vocoder.js?v=2.9.367';
import { initAuth, initAccountManager } from './modules/settings/account.js';
import { initLanguageManager } from './modules/settings/language.js?v=2.9.367';
import { initHamQthSettings } from './modules/settings/hamqth.js';
import { initGeneralSettings } from './modules/settings/general.js?v=2.9.375';
import { initAlertsSettings } from './modules/settings/alerts.js?v=2.9.374';
import { initSystemUpdater } from './modules/settings/system-updater.js';
import { initOrientationLock } from './modules/ui/orientation.js';
import {
  initQuickAssign,
  renderQuickMemButtons
} from './modules/dmr/quick-assign.js?v=2.9.367';
import { initStationClocks, updateClocks } from './modules/ui/clocks.js';
import {
  renderTranscriptionSummary
} from './modules/dmr/transcription.js?v=2.9.367';
import {
  initSearchManager,
  loadCallDbStats,
  loadTgDbStats,
  closeCallIdModal
} from './modules/dmr/search.js?v=2.9.380';
import {
  initContactsManager,
  openContactEditModal,
  saveContactsToServer,
  renderContactsTree,
  findNodeInTree,
  findParentNodeInTree
} from './modules/dmr/contacts.js?v=2.9.367';
import {
  initWatchdog,
  startSystemLinkWatchdog,
  checkBmApiStatus,
  updateGwStatus
} from './modules/network/watchdog.js';
import {
  initHotspotsManager,
  loadHotspots,
  renderHotspotSelect,
  renderHotspotsList,
  openHotspotSettings,
  saveCurrentSettingsState,
  openEditHotspotForm,
  applyActiveHotspotToUI,
  switchActiveHotspot
} from './modules/dmr/hotspots.js?v=2.9.382';
import {
  initBmTgStaticManager
} from './modules/dmr/bm-static-manager.js?v=2.9.372';
import {
  initAudioRouting
} from './modules/audio/routing.js?v=2.9.387';
import {
  initAudioDsp
} from './modules/audio/dsp.js?v=2.9.367';
import {
  initPttEngine,
  updatePttLockUI,
  checkPttConnectionStatus,
  notifyPttConnectionBlocked
} from './modules/ptt/engine.js?v=2.9.367';
import { initAboutModal } from './modules/ui/about.js';
import { initNavigation, pushNavState, closePrimaryModals } from './modules/ui/navigation.js?v=2.9.367';
import {
  initFullscreen,
  toggleFullscreen,
  isFullscreenActive,
  updateFullscreenButtonsUI
} from './modules/ui/fullscreen.js';
import {
  initBmBenchmark,
  renderBmBenchmarkTable,
  handleBmBenchmarkComplete,
  handleBmBenchmarkProgress,
  setBenchmarkRunningUI
} from './modules/dmr/bm-benchmark.js?v=2.9.367';
import {
  getHotspotSlot,
  setCardSlot,
  setActiveSlot,
  getHotspotTg,
  getHotspotPttTarget,
  setHotspotPttTarget,
  updateCardPttHint,
  updateCardModeBadge,
  updateCardTgDisplay,
  updateAllHotspotsTgDisplay,
  updateTgDisplay,
  setHotspotTg,
  setHotspotSlot,
  setTg,
  selectHotspotTargetId,
  getStoredLastRx,
  saveStoredLastRx
} from './modules/ui/vfo-display.js?v=2.9.367';
import {
  loadCardPingHistory,
  saveCardPingHistory,
  getHotspotPingMode,
  setHotspotPingMode,
  toggleHotspotPingMode,
  getHotspotPingScale,
  setHotspotPingScale,
  cycleHotspotPingScale,
  cyclePingScale,
  renderCardPingSparkline,
  generateSparklineGradientStops,
  decimatePingPoints,
  getPingColor,
  getClientPingColor,
  updatePingElement,
  calculateCardPacketLoss,
  calculateClientPacketLoss
} from './modules/network/ping-sparklines.js?v=2.9.367';
import {
  getClientSettingsSnapshot,
  scheduleSyncClientSettings,
  applyServerClientSettings
} from './modules/settings/sync.js?v=2.9.367';
import {
  initVolumeMute,
  isMuteOnPttEnabled,
  setMuteOnPttEnabled,
  isPttAudioMuted,
  isSimultaneousSlotsEnabled,
  setSimultaneousSlotsEnabled,
  isApkClient,
  isVolumeUpPttEnabled,
  setVolumeUpPttEnabled,
  isVolumeDownPttEnabled,
  setVolumeDownPttEnabled,
  toggleVolumeDownPttQuick,
  isGlobalAudioMuted,
  setGlobalAudioMute,
  toggleGlobalAudioMute,
  isHotspotAudioMuted,
  setHotspotAudioMute,
  toggleHotspotAudioMute,
  handleMuteButtonClick,
  handleMuteButtonDblClick,
  getHotspotVolume,
  setHotspotVolume,
  getHotspotAgc,
  setHotspotAgc,
  getHotspotLoop,
  setHotspotLoop,
  isHotspotCollapsed,
  collapseHotspot,
  expandHotspot,
  toggleHotspotCollapse,
  updateHotspotVolumeAndMuteUI,
  updateAllVolumeAndMuteUI,
  isHotspotVolumeSyncEnabled,
  setHotspotVolumeSyncEnabled,
  isSystemVolumeSyncEnabled,
  setSystemVolumeSyncEnabled,
  onSystemVolumeChanged
} from './modules/audio/volume-mute.js?v=2.9.387';
import {
  KNOWN_BM_MASTERS,
  getBmFlagBadgeHtml,
  getBmServerInfo,
  populateBmServerSelect,
  isHotspotFullyOnline,
  updateCardBmBanner,
  refreshAllCardsBmBanner,
  updateRxBannerFreshness,
  updateCardRxLiveBanner,
  updateRxLiveBanner
} from './modules/dmr/bm-banner.js?v=2.9.378';
import {
  currentBmStatus,
  isTogglingConnection,
  updateBmStatus,
  toggleHotspotConnection
} from './modules/dmr/bm-status.js?v=2.9.367';
import {
  connectWebSocket,
  handleServerMessage,
  startPing,
  pendingPings,
  lastReportedClientRtt,
  serverClockOffsetSec,
  pingTimer
} from './modules/network/ws.js?v=2.9.387';

/**
 * ProxDMR Duplex & Multi-Instance Web Application
 * Modular Application Orchestrator & Bootstrapper
 */

document.addEventListener("DOMContentLoaded", () => {
  window.safeEscapeHtml = safeEscapeHtml;
  window.escapeHtml = safeEscapeHtml;
  let isLogVisible = false;
  window.isLogVisible = false;

  let USER_CALLSIGNS = {};
  try {
    const savedUsers = localStorage.getItem("proxdmr_user_callsigns_cache");
    if (savedUsers) USER_CALLSIGNS = JSON.parse(savedUsers);
  } catch (e) {}

  let activeSlot = parseInt(localStorage.getItem("proxdmr_active_slot"), 10) || 2;
  let cachedBmPings = {};
  window.cachedBmPings = cachedBmPings;
  let isPttPressed = false;
  try {
    Object.defineProperty(window, "activeSlot", {
      get: () => activeSlot,
      set: (v) => { activeSlot = v; },
      configurable: true
    });
    Object.defineProperty(window, "isPttPressed", {
      get: () => isPttPressed,
      set: (v) => { isPttPressed = v; },
      configurable: true
    });
    Object.defineProperty(window, "USER_CALLSIGNS", {
      get: () => USER_CALLSIGNS,
      set: (v) => { USER_CALLSIGNS = v; },
      configurable: true
    });
  } catch (_) {}
  window.getActiveHotspotId = () => (window.activeHotspotId || "default");
  window.getCurrentHotspots = () => (window.currentHotspots || []);

  let audioCtx = null;
  try { Object.defineProperty(window, "audioCtx", { get: () => audioCtx, set: (v) => { audioCtx = v; }, configurable: true }); } catch (_) {}
  let micStream = null;
  try { Object.defineProperty(window, "micStream", { get: () => micStream, set: (v) => { micStream = v; }, configurable: true }); } catch (_) {}
  let micSourceNode = null;
  try { Object.defineProperty(window, "micSourceNode", { get: () => micSourceNode, set: (v) => { micSourceNode = v; }, configurable: true }); } catch (_) {}
  let analyserNode = null;
  try { Object.defineProperty(window, "analyserNode", { get: () => analyserNode, set: (v) => { analyserNode = v; }, configurable: true }); } catch (_) {}
  let workletNode = null;
  try { Object.defineProperty(window, "workletNode", { get: () => workletNode, set: (v) => { workletNode = v; }, configurable: true }); } catch (_) {}
  let audioPlayer = new DMRAudioPlayer();
  window.audioPlayer = audioPlayer;
  window.dmrAudioPlayer = audioPlayer;
  let bmMastersList = [];
  let txTimer = null;
  let txStartTime = 0;
  let animationFrameId = null;
  try { Object.defineProperty(window, "animationFrameId", { get: () => animationFrameId, set: (v) => { animationFrameId = v; }, configurable: true }); } catch (_) {}
  let rxVuTimeout = null;

  // Unlock Web Audio on first user interaction (browser autoplay policy)
  const unlockAudio = (e) => {
    if (window.audioPlayer) {
      audioPlayer.ensureInitialized();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    const authModalEl = document.getElementById("authModal");
    const isAuthOpen = Boolean(authModalEl && authModalEl.classList.contains("active"));
    const isDemoClick = Boolean(e && e.target && e.target.closest && e.target.closest("#btnAuthDemoLogin"));
    if (isAuthOpen || isDemoClick || window.isDemoMode || window.isUserSwl || document.body.classList.contains("is-demo-mode")) {
      return;
    }
    if (typeof window.initAudio === "function") {
      window.initAudio().catch(() => {});
    }
  };
  document.addEventListener("pointerdown", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });

  // Init BLE PTT panel (only active inside APK with AndroidBridge)
  if (window.blePtt) {
    try { window.blePtt.init(); } catch(e) { console.warn("[BLE] init error", e); }
  }

  // Vocoder settings
  setupDsdfmeModal();

  function initRecordingsManager() {
    window.recordingsManager = new RecordingsManager();
  }

  // Window bridges for backward compatibility
  window.updateBmStatus = updateBmStatus;
  window.toggleHotspotConnection = toggleHotspotConnection;
  window.refreshAllCardsBmBanner = refreshAllCardsBmBanner;
  window.openEditHotspotForm = openEditHotspotForm;
  window.applyActiveHotspotToUI = applyActiveHotspotToUI;
  window.calculateClientPacketLoss = calculateClientPacketLoss;
  window.getHotspotPingMode = getHotspotPingMode;
  window.handleBmBenchmarkComplete = handleBmBenchmarkComplete;
  window.handleBmBenchmarkProgress = handleBmBenchmarkProgress;
  window.isGlobalAudioMuted = isGlobalAudioMuted;
  window.isVolumeUpPttEnabled = isVolumeUpPttEnabled;
  window.setVolumeUpPttEnabled = setVolumeUpPttEnabled;
  window.isVolumeDownPttEnabled = isVolumeDownPttEnabled;
  window.setVolumeDownPttEnabled = setVolumeDownPttEnabled;
  window.loadCardPingHistory = loadCardPingHistory;
  window.saveCardPingHistory = saveCardPingHistory;
  window.loadHotspots = loadHotspots;
  window.renderBmBenchmarkTable = renderBmBenchmarkTable;
  window.renderHotspotSelect = renderHotspotSelect;
  window.renderHotspotsList = renderHotspotsList;
  window.setBenchmarkRunningUI = setBenchmarkRunningUI;
  window.updateAllHotspotsTgDisplay = updateAllHotspotsTgDisplay;
  window.updateCardModeBadge = updateCardModeBadge;
  window.updatePingElement = updatePingElement;
  window.switchActiveHotspot = switchActiveHotspot;
  window.setTg = setTg;
  window.renderQuickMemButtons = renderQuickMemButtons;
  window.updateTgDisplay = updateTgDisplay;
  window.pushNavState = pushNavState;
  window.setActiveSlot = setActiveSlot;
  window.renderTranscriptionSummary = renderTranscriptionSummary;
  window.updateCardRxLiveBanner = updateCardRxLiveBanner;
  window.openHotspotSettings = openHotspotSettings;
  window.saveCurrentSettingsState = saveCurrentSettingsState;
  window.setCardSlot = setCardSlot;
  window.getHotspotTg = getHotspotTg;
  window.getHotspotPttTarget = getHotspotPttTarget;
  window.setHotspotPttTarget = setHotspotPttTarget;
  window.setHotspotTg = setHotspotTg;
  window.setHotspotSlot = setHotspotSlot;
  window.selectHotspotTargetId = selectHotspotTargetId;
  window.closeCallIdModal = closeCallIdModal;
  window.openContactEditModal = openContactEditModal;
  window.saveContactsToServer = saveContactsToServer;
  window.renderContactsTree = renderContactsTree;
  window.findNodeInTree = findNodeInTree;
  window.findParentNodeInTree = findParentNodeInTree;
  window.scheduleSyncClientSettings = scheduleSyncClientSettings;
  window.getStoredLastRx = getStoredLastRx;
  window.saveStoredLastRx = saveStoredLastRx;

  window.__proxdmr.handleServerMessage = handleServerMessage;
  window.__proxdmr.updateCardTgDisplay = updateCardTgDisplay;
  window.__proxdmr.updateCardModeBadge = updateCardModeBadge;
  window.__proxdmr.getStoredLastRx = getStoredLastRx;
  window.__proxdmr.saveStoredLastRx = saveStoredLastRx;
  window.__proxdmr.toggleFullscreen = toggleFullscreen;
  window.__proxdmr.isFullscreenActive = isFullscreenActive;

  // Start initialization of all subsystems
  initAuth();
  initStationClocks();
  updateClocks();
  updateRxBannerFreshness();
  setInterval(() => {
    updateClocks();
    updateRxBannerFreshness();
    document.querySelectorAll(".radio-container").forEach(c => updateCardTgDisplay(c));
  }, 1000);

  initLanguageManager();
  initVolumeMute();
  initAudioRouting();
  initAudioDsp();
  initPttEngine();
  initHotspotsManager();
  initBmBenchmark();
  initWatchdog();
  initOrientationLock();
  initFullscreen();
  initAndroidBridge();
  initQuickAssign();
  initBmTgStaticManager();
  initAboutModal();
  initNavigation();
  initSearchManager();
  initContactsManager();
  initAccountManager();
  if (window.ProxDMRAdmin && window.ProxDMRAdmin.init) window.ProxDMRAdmin.init();
  initHamQthSettings();
  initGeneralSettings();
  initAlertsSettings();
  initSystemUpdater();
  initApkUpdater();
  initSlotTranscribeState();
  initTranscriberSettings();
  if (typeof updatePttLockUI === "function") updatePttLockUI();
  initRecordingsManager();

  loadHotspots();
  loadTgDbStats();
  loadCallDbStats();
  connectWebSocket();
  startPing();
  startSystemLinkWatchdog();
  checkBmApiStatus();
  setInterval(checkBmApiStatus, 60000);
});
