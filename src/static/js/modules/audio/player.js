import { getCountryInfo, getCallCountryInfo, getFlagBadgeHtml, formatCallerDisplay, formatHistoryTime, updateFlagElement, getNetworkRawTgName, renderTgTextHtml } from '../core/formatters.js?v=2.9.712';
import { showToast } from '../core/toast.js?v=2.9.699';
import {
  DEFAULT_ROGER_BEEP_PATTERN,
  playLocalRogerBeep,
  stopLocalRogerBeep
} from '../ptt/tot.js?v=2.9.542';


export   class RecordingsManager {
    constructor() {
      this.audio = new Audio();
      this.audio.crossOrigin = "anonymous";
      this.audio.preload = "auto";
      this.currentRecording = null;
      this.recordings = [];
      this.totalCount = 0;
      this.currentOffset = 0;
      this.limit = 50;
      this.activeFilter = "ALL";
      this.searchQuery = "";
      this.recordedCallIds = new Set();
      this.isScrubbing = false;
      this.sessionTimerInterval = null;
      this.sessionStartTime = 0;
      this.searchDebounceTimer = null;
      this.isSessionActive = false;
      this.isAutoRecordingActive = false;

      // DOM Elements - Main Inline Player
      this.playerPanel = document.getElementById("livePlayerPanel");
      this.closePlayerBtn = document.getElementById("btnCloseLivePlayer");
      this.openBtn = document.getElementById("openRecordingsBtn");
      this.masterRecBtn = document.getElementById("headerMasterRecBtn");
      this.masterRecTimer = document.getElementById("headerMasterRecTimer");

      // Player Elements
      this.playPauseBtn = document.getElementById("recPlayPauseBtn");
      this.prevTrackBtn = document.getElementById("recPrevTrackBtn");
      this.nextTrackBtn = document.getElementById("recNextTrackBtn");
      this.btnMp3 = document.getElementById("recBtnMp3");

      // Scrubber Elements
      this.segmentedBar = document.getElementById("recSegmentedBar");
      this.segmentedCanvas = document.getElementById("recSegmentedCanvas");
      this.scrubberFill = document.getElementById("recScrubberFill");
      this.globalSegmentedBar = document.getElementById("recGlobalSegmentedBar");
      this.globalScrubberFill = document.getElementById("recGlobalScrubberFill");
      this.globalTimeRemaining = document.getElementById("recGlobalTimeRemaining");
      this._currentPercent = 0;
      this._pendingSeekTime = null;

      this.audio.addEventListener("loadedmetadata", () => {
        if (this._pendingSeekTime !== null) {
          this.audio.currentTime = this._pendingSeekTime;
          this._pendingSeekTime = null;
        }
      });

      // Metadata Elements
      this.stationCallsignEl = document.getElementById("recStationCallsign");
      this.stationFlagEl = document.getElementById("recStationFlag");
      this.stationNameEl = document.getElementById("recStationName");
      this.badgeTypeEl = document.getElementById("recBadgeType");
      this.tgBadgeEl = document.getElementById("recTgBadge");
      this.slotBadgeEl = document.getElementById("recSlotBadge");
      this.timeBadgeEl = document.getElementById("recTimeBadge");

      // Left Tool Elements
      this.toggleSettingsBtn = document.getElementById("btnToggleRecSettings");
      this.downloadBtn = document.getElementById("recDownloadBtn");
      this.deleteBtn = document.getElementById("recDeleteBtn");
      this.soloBtn = document.getElementById("recSoloBtn");
      this.sortBtn = document.getElementById("recSortBtn");
      this.offlineTranscribeBtn = document.getElementById("recOfflineTranscribeBtn");
      this.headerOfflineTranscribeBtn = document.getElementById("headerOfflineTranscribeBtn");
      this.recTtsBtn = document.getElementById("recTtsBtn");
      this.txToggleBtn = document.getElementById("recTxToggleBtn");
      this.txTargetBtn = document.getElementById("recTxTargetBtn");
      this.txTargetLabel = document.getElementById("recTxTargetLabel");
      this.txTargetMenu = document.getElementById("recTxTargetMenu");
      this.txHotspotList = document.getElementById("recTxHotspotList");
      this.txSlotRow = document.getElementById("recTxSlotRow");
      this.isTxArmed = false;
      this.isTxStreaming = false;
      this.txTargetHotspotId = null;
      this.txTargetSlot = null;
      this._txMaxDurationTimer = null;
      this._txCountdownInterval = null;
      this._activeTxVisualState = null;
      this._recTxAnalyser = null;
      this._recTxTimeBuf = null;
      this._recTxByteBuf = null;
      this._recTxHooked = false;

      this.isTtsPlaying = false;
      this._ttsPlayToken = 0;
      this.currentTtsHandle = null;
      this.currentTtsAudioEl = null;
      if (typeof window !== "undefined") {
        window.__proxdmr = window.__proxdmr || {};
        window.__proxdmr.recordingsManager = this;
      }
      this.isOfflineTranscribing = false;
      this.offlineTranscribers = {};
      this._targetOfflineHotspotId = null;

      // Quota, Speed & Clear
      this.quotaBar = document.getElementById("recQuotaBar");
      this.quotaBadge = document.getElementById("recordingsQuotaBadge");
      this.quotaBadgeFilled = document.getElementById("recordingsQuotaBadgeFilled");
      this.quotaFill = document.getElementById("recQuotaFill");
      this.quotaClearMenu = document.getElementById("recQuotaClearMenu");
      this.btnConfirmQuotaClear = document.getElementById("btnConfirmQuotaClear");
      this.btnCancelQuotaClear = document.getElementById("btnCancelQuotaClear");
      this.clearAllBtn = document.getElementById("recClearAllBtn");

      // Settings Modal Elements
      this.settingsModal = document.getElementById("recSettingsModal");
      this.closeSettingsBtn = document.getElementById("btnCloseRecSettings");
      this.saveSettingsBtn = document.getElementById("btnSaveRecSettings");
      this.optAutoRecord = document.getElementById("recOptAutoRecord");
      this.optSeamBeep = document.getElementById("recOptSeamBeep");
      this.inputSeamBeepPattern = document.getElementById("recSeamBeepPattern");
      this.btnTestSeamBeep = document.getElementById("btnTestSeamBeep");
      this.optSeamBeep?.addEventListener("change", () => {
        if (this.inputSeamBeepPattern) {
          this.inputSeamBeepPattern.style.opacity = this.optSeamBeep.checked ? "1" : "0.55";
        }
      });
      this.optAutoCleanup = document.getElementById("recOptAutoCleanup");
      this.inputMinDuration = document.getElementById("recMinDurationInput");
      this.inputQuotaGb = document.getElementById("recQuotaGbInput");

      // Offline Transcribe Confirmation Modal Elements
      this.offlineTranscribeModal = document.getElementById("offlineTranscribeModal");
      this.closeOfflineTranscribeBtn = document.getElementById("btnCloseOfflineTranscribeModal");
      this.cancelOfflineTranscribeBtn = document.getElementById("btnCancelOfflineTranscribe");
      this.confirmOfflineTranscribeBtn = document.getElementById("btnConfirmOfflineTranscribe");
      this.chkDeleteOriginalAudio = document.getElementById("chkDeleteOriginalAudio");
      this.selOfflineTranscribeHotspot = document.getElementById("selOfflineTranscribeHotspot");
      this.offlineTranscribeInfoText = document.getElementById("offlineTranscribeInfoText");
      this.lblDeleteOriginalAudio = document.getElementById("lblDeleteOriginalAudio");

      // Solo mode state (persisted in localStorage, default enabled = true)
      const savedSolo = (typeof localStorage !== "undefined") ? localStorage.getItem("proxdmr_player_solo") : null;
      this.isSoloEnabled = savedSolo !== null ? (savedSolo === "true") : true;

      // Playback speed state (persisted in localStorage, default 1.0)
      const savedSpeed = (typeof localStorage !== "undefined") ? parseFloat(localStorage.getItem("proxdmr_player_speed")) : 1.0;
      this.playbackRate = (!isNaN(savedSpeed) && savedSpeed > 0) ? savedSpeed : 1.0;

      this.initEvents();
      this.preloadRecordedCallIds();
      this.loadStats();
      this.checkOfflineTranscribeStatus();
    }

    formatTime(sec) {
      if (!sec || isNaN(sec) || sec < 0) return "00:00";
      const s = Math.floor(sec);
      const m = Math.floor(s / 60);
      const remSec = s % 60;
      if (m >= 60) {
        const h = Math.floor(m / 60);
        const remMin = m % 60;
        return `${h}:${String(remMin).padStart(2, "0")}:${String(remSec).padStart(2, "0")}`;
      }
      return `${String(m).padStart(2, "0")}:${String(remSec).padStart(2, "0")}`;
    }

    hasRecording(callId) {
      return Boolean(callId && this.recordedCallIds.has(callId));
    }

    isPlayingCall(callId) {
      if (!this.audio || this.audio.paused || this.audio.ended || !this.currentRecording || !callId) {
        return false;
      }
      const strCallId = String(callId);
      const curRec = this.currentRecording;
      return Boolean(
        (curRec.call_id != null && String(curRec.call_id) === strCallId) ||
        (curRec.id != null && String(curRec.id) === strCallId)
      );
    }

    isPlayerOpen() {
      return Boolean(this.playerPanel && this.playerPanel.style.display !== "none");
    }

    get panel() {
      return this.playerPanel;
    }

    set panel(val) {
      this.playerPanel = val;
    }

    getActiveCallId() {
      if (!this.isPlayerOpen()) return null;
      if (this._pendingCallId != null) return String(this._pendingCallId);
      if (this.currentRecording) {
        if (this.currentRecording.call_id != null) return String(this.currentRecording.call_id);
        if (this.currentRecording.id != null) return String(this.currentRecording.id);
      }
      return null;
    }

    updateActiveRowHighlight(explicitCallId = null) {
      const targetCallId = explicitCallId != null ? String(explicitCallId) : this.getActiveCallId();
      document.querySelectorAll(".live-call-row").forEach(row => {
        const matches = Boolean(targetCallId && String(row.dataset.id) === String(targetCallId));
        row.classList.toggle("is-playing-rec", matches);
        if (!matches) {
          row.classList.remove("row-blink-highlight");
        }
      });
    }

    blinkRowHighlight(callId) {
      if (!callId) return;
      if (this._blinkTimer) {
        clearTimeout(this._blinkTimer);
        this._blinkTimer = null;
      }
      document.querySelectorAll(".live-call-row.row-blink-highlight").forEach(r => {
        r.classList.remove("row-blink-highlight");
      });

      const row = document.querySelector(`.live-call-row[data-id="${callId}"]`);
      if (!row) return;

      row.classList.add("is-playing-rec");
      // Force layout reflow so 1.3 Hz animation restarts cleanly
      void row.offsetWidth;
      row.classList.add("row-blink-highlight");

      const cleanUp = () => {
        if (this._blinkTimer) {
          clearTimeout(this._blinkTimer);
          this._blinkTimer = null;
        }
        row.removeEventListener("animationend", cleanUp);
        row.classList.remove("row-blink-highlight");
      };

      row.addEventListener("animationend", cleanUp, { once: true });
      // 3 cycles at 1.3 Hz = 3 * (1000 / 1.3) ms ≈ 2308 ms; fallback timer with 100ms tolerance
      this._blinkTimer = setTimeout(cleanUp, 2408);
    }

    initEvents() {
      // Audio Engine Events
      this.audio.addEventListener("timeupdate", () => this.onTimeUpdate());
      this.audio.addEventListener("play", () => {
        if (this.isTxArmed) {
          this.audio.playbackRate = 1.0;
          this.startRecordingTxStream();
        } else if (this.playbackRate && this.audio && Math.abs(this.audio.playbackRate - this.playbackRate) > 0.05) {
          this.audio.playbackRate = this.playbackRate;
        }
        this.updatePlayState(true);
        this.startSmoothProgress();
      });
      this.audio.addEventListener("pause", () => {
        if (this.isTxStreaming) {
          this.stopRecordingTxStream();
        }
        this.updatePlayState(false);
        this.stopSmoothProgress();
      });
      this.audio.addEventListener("ended", () => {
        if (this.isTxStreaming) {
          this.stopRecordingTxStream();
        }
        this.updatePlayState(false);
        this.stopSmoothProgress();
        this._currentPercent = 0;
        this.drawProgressBar(0);
        if (this.scrubberFill) this.scrubberFill.style.width = "0%";
        const tspan = document.getElementById("recTrackTimeRemaining");
        if (tspan) tspan.textContent = "-00:00";

        if (this._autoPlayTimer) {
          clearTimeout(this._autoPlayTimer);
          this._autoPlayTimer = null;
        }

        // In TX:ON mode only ONE recording may play automatically
        if (this.isTxArmed) {
          this.updateActiveRowHighlight();
          return;
        }

        const curCallId = this.currentRecording ? this.currentRecording.call_id : null;
        const nextId = this.getNextChronologicalCallId(curCallId);
        if (nextId) {
          this._autoPlayTimer = setTimeout(async () => {
            this._autoPlayTimer = null;
            if (this.isPlayerOpen() && (!this.audio || this.audio.paused)) {
              if (this.optSeamBeep && this.optSeamBeep.checked) {
                await this.playSeamBeep();
              }
              // Double check after beep
              if (this.isPlayerOpen() && (!this.audio || this.audio.paused)) {
                this.playByCallId(nextId);
              }
            }
          }, 50); // Small delay to allow UI to update
        } else {
          this.updateActiveRowHighlight();
        }
      });
      this.audio.addEventListener("error", (e) => {
        console.warn("[RECORDINGS] Audio playback error:", e);
        showToast(window.t ? window.t("player.play_err", {}, "⚠️ Ошибка воспроизведения аудиозаписи") : "⚠️ Ошибка воспроизведения аудиозаписи", 3000);
        this.updatePlayState(false);
        this.stopSmoothProgress();
      });

      // Header Open Button (Cassette icon)
      if (this.openBtn) {
        this.openBtn.onclick = (e) => {
          if(e) { e.preventDefault(); e.stopPropagation(); }
          const isPanelOpen = this.playerPanel && this.playerPanel.style.display !== "none";
          if (isPanelOpen) {
            this.closePlayer();
          } else {
            this.openPlayer();
            let targetCallId = null;
            if (!this.currentRecording) {
              const callIds = this.getVisibleRecordedCallIds();
              if (callIds.length > 0) {
                targetCallId = callIds[0];
                this.playByCallId(targetCallId, false);
              }
            } else if (this.currentRecording && this.currentRecording.call_id) {
              targetCallId = this.currentRecording.call_id;
              this.updateActiveRowHighlight();
              const row = document.querySelector(`.live-call-row[data-id="${targetCallId}"]`);
              if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
            if (targetCallId) {
              this.blinkRowHighlight(targetCallId);
            }
          }
        };
      }

      // Close Button on Player Panel
      if (this.closePlayerBtn) {
        this.closePlayerBtn.onclick = () => this.closePlayer();
      }

      // Transport: Play/Pause
      if (this.playPauseBtn) {
        let pressTimer = null;
        let isLongPress = false;
        let lastActionTime = 0;

        const startPress = (e) => {
          if (e.button !== undefined && e.button !== 0) return;
          isLongPress = false;
          if (pressTimer) clearTimeout(pressTimer);
          pressTimer = setTimeout(() => {
            isLongPress = true;
            this.toggleSpeedMenu();
          }, 500);
        };

        const clearPressTimer = () => {
          if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
          }
        };

        this.playPauseBtn.addEventListener("pointerdown", startPress);
        this.playPauseBtn.addEventListener("pointerup", clearPressTimer);
        this.playPauseBtn.addEventListener("pointercancel", () => {
          clearPressTimer();
          isLongPress = false;
        });
        this.playPauseBtn.addEventListener("pointerleave", () => {
          clearPressTimer();
        });

        this.playPauseBtn.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          clearPressTimer();
          isLongPress = true;
          this.toggleSpeedMenu();
        });

        this.playPauseBtn.addEventListener("click", (e) => {
          e.preventDefault();
          clearPressTimer();
          if (isLongPress) {
            isLongPress = false;
            return;
          }

          const now = Date.now();
          if (now - lastActionTime < 300) {
            return;
          }
          lastActionTime = now;

          const menu = document.getElementById("recSpeedMenu");
          if (menu && menu.style.display !== "none") {
            menu.style.display = "none";
          } else {
            this.togglePlayPause();
          }
        });

        // Close menu if clicked outside
        document.addEventListener("click", (e) => {
          const menu = document.getElementById("recSpeedMenu");
          if (menu && menu.style.display !== "none") {
            if (!menu.contains(e.target) && !this.playPauseBtn.contains(e.target)) {
              menu.style.display = "none";
            }
          }
        });
      }

      // Transport: Prev / Next in History table
      if (this.prevTrackBtn) {
        this.prevTrackBtn.onclick = () => this.playPrev();
      }
      if (this.nextTrackBtn) {
        this.nextTrackBtn.onclick = () => this.playNext();
      }


      // Transport: Direct MP3 download button
      if (this.btnMp3) {
        this.btnMp3.onclick = () => this.downloadCurrentMp3();
      }

      // Left Tools: Settings modal toggle
      if (this.toggleSettingsBtn) {
        this.toggleSettingsBtn.onclick = () => this.openSettingsModal();
      }

      // Left Tools: Download MP3 button
      if (this.downloadBtn) {
        this.downloadBtn.onclick = (e) => {
          e.preventDefault();
          if (window.logSelection && window.logSelection.hasSelection()) {
            window.logSelection.downloadSelected();
            return;
          }
          this.downloadCurrentMp3();
        };
      }

      // Left Tools: Delete recording
      if (this.deleteBtn) {
        this.deleteBtn.onclick = () => {
          if (window.logSelection && window.logSelection.hasSelection()) {
            window.logSelection.deleteSelected();
            return;
          }
          this.deleteCurrentRecording();
        };
      }

      // Left Tools: Solo (S)
      if (this.soloBtn) {
        this.soloBtn.onclick = () => this.toggleSolo();
      }

      // Left Tools: Sort Order Toggle
      if (this.sortBtn) {
        this.sortBtn.onclick = (e) => {
          if (e) {
            e.stopPropagation();
            e.preventDefault();
          }
          const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
          const effectiveHid = (isMobile && (!window.currentLogHotspotId || window.currentLogHotspotId === "all"))
            ? (window.activeHotspotId || ((window.currentHotspots || [])[0] && (window.currentHotspots || [])[0].id) || "default")
            : (window.currentLogHotspotId || "all");
          const curOrder = (typeof window.getLogSortOrderForHotspot === "function")
            ? window.getLogSortOrderForHotspot(effectiveHid)
            : (window.__proxdmrLogSortOrder || "desc");
          const nextOrder = (curOrder === "asc") ? "desc" : "asc";
          if (typeof window.setLogSortOrderForHotspot === "function") {
            window.setLogSortOrderForHotspot(effectiveHid, nextOrder);
          }
          window.__proxdmrLogSortOrder = nextOrder;
          this.updateSortUI();
          if (typeof window.renderLogList === "function") window.renderLogList();
        };
      }
      if (typeof window.syncLogSortOrderForCurrentHotspot === "function") {
        window.syncLogSortOrderForCurrentHotspot();
      } else {
        this.updateSortUI();
      }
      this.updateSoloUI();

      // Left Tools: Offline Transcribe Button
      if (this.offlineTranscribeBtn) {
        this.offlineTranscribeBtn.onclick = () => {
          if (window.logSelection && window.logSelection.hasSelection()) {
            window.logSelection.transcribeSelected();
            return;
          }
          this.handleOfflineTranscribeClick();
        };
      }

      // Header Offline Transcribe Indicator & Button
      if (this.headerOfflineTranscribeBtn) {
        this.headerOfflineTranscribeBtn.onclick = (e) => {
          if (e) e.stopPropagation();
          const firstHsId = (typeof currentHotspots !== "undefined" && currentHotspots[0] && currentHotspots[0].id) || "default";
          this.handleOfflineTranscribeClick(firstHsId);
        };
      }
      this.checkOfflineTranscribeStatus();
      this.updateAllHotspotTranscribeUI();
      this.initTtsButton();

      // Scrubber Segmented Bar Seek & Drag
      if (this.segmentedBar) {
        const handleSeek = (e) => {
          if (this.isTtsPlaying) {
            this.stopTtsPlayback();
          }
          const rect = this.segmentedBar.getBoundingClientRect();
          if (!rect.width) return;
          const clientX = e.touches ? e.touches[0].clientX : e.clientX;
          const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          this._currentPercent = percent * 100;
          this.drawProgressBar(this._currentPercent);
          if (this.scrubberFill) {
            this.scrubberFill.style.width = `${percent * 100}%`;
          }
          const dur = this.audio.duration || (this.currentRecording ? this.currentRecording.duration : 0);
          if (dur > 0) {
            this.audio.currentTime = percent * dur;
          }
        };

        let isDragging = false;
        this.segmentedBar.addEventListener("pointerdown", (e) => {
          isDragging = true;
          this.isScrubbing = true;
          try { this.segmentedBar.setPointerCapture(e.pointerId); } catch (_) {}
          handleSeek(e);
        });
        this.segmentedBar.addEventListener("pointermove", (e) => {
          if (isDragging) {
            handleSeek(e);
          }
        });
        const stopDrag = (e) => {
          if (isDragging) {
            isDragging = false;
            this.isScrubbing = false;
            try { this.segmentedBar.releasePointerCapture(e.pointerId); } catch (_) {}
          }
        };
        this.segmentedBar.addEventListener("pointerup", stopDrag);
        this.segmentedBar.addEventListener("pointercancel", stopDrag);

        // Global Scrubber Segmented Bar Seek
        if (this.globalSegmentedBar) {
          const handleGlobalSeek = (e) => {
            const rect = this.globalSegmentedBar.getBoundingClientRect();
            if (!rect.width) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            
            const chronoIds = this.getChronologicalRecordedCallIds();
            if (!chronoIds || chronoIds.length === 0) return;

            let callsMap = new Map();
            if (typeof heardCalls !== "undefined" && Array.isArray(heardCalls)) {
              heardCalls.forEach(c => callsMap.set(String(c.id), c));
            }

            let totalDur = 0;
            const durArr = [];
            for (const cid of chronoIds) {
              const c = callsMap.get(cid);
              const dur = c && c.duration ? parseFloat(c.duration) : 0;
              durArr.push({ cid, dur });
              totalDur += dur;
            }

            if (totalDur <= 0) return;
            let targetGlobalTime = totalDur * percent;
            
            let pastDur = 0;
            let targetCid = null;
            let targetLocalOffset = 0;
            
            for (const item of durArr) {
              if (pastDur + item.dur >= targetGlobalTime) {
                targetCid = item.cid;
                targetLocalOffset = targetGlobalTime - pastDur;
                break;
              }
              pastDur += item.dur;
            }

            if (targetCid) {
              this._pendingSeekTime = targetLocalOffset;
              this.playByCallId(targetCid);
            }
          };

          this.globalSegmentedBar.addEventListener("pointerdown", handleGlobalSeek);
        }

        window.addEventListener("resize", () => {
          this.drawProgressBar();
        });
        if (typeof MutationObserver !== "undefined") {
          const themeObserver = new MutationObserver(() => {
            this.drawProgressBar();
          });
          themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
        }
      }

      // Playback Speed Menu
      const speedMenuBtns = document.querySelectorAll(".rec-speed-menu-btn");
      speedMenuBtns.forEach(btn => {
        const spd = parseFloat(btn.dataset.speed);
        if (Math.abs(spd - this.playbackRate) < 0.05) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
        btn.onclick = (e) => {
          e.stopPropagation();
          const newSpd = parseFloat(btn.dataset.speed);
          if (newSpd > 0) {
            this.playbackRate = newSpd;
            if (this.audio) this.audio.playbackRate = newSpd;
            if (typeof localStorage !== "undefined") {
              localStorage.setItem("proxdmr_player_speed", String(newSpd));
            }
            speedMenuBtns.forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
          }
          const menu = document.getElementById("recSpeedMenu");
          if (menu) menu.style.display = "none";
        };
      });

      // Settings Modal Events
      if (this.closeSettingsBtn) {
        this.closeSettingsBtn.onclick = () => this.closeSettingsModal();
      }
      if (this.saveSettingsBtn) {
        this.saveSettingsBtn.onclick = () => this.saveSettings();
      }
      if (this.btnTestSeamBeep) {
        this.btnTestSeamBeep.onclick = async (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          this.btnTestSeamBeep.classList.add("is-playing");
          try {
            await this.playSeamBeep({ forceTest: true });
          } finally {
            this.btnTestSeamBeep.classList.remove("is-playing");
          }
        };
      }
      if (this.settingsModal) {
        this.settingsModal.onclick = (e) => {
          if (e.target === this.settingsModal) this.closeSettingsModal();
        };
      }
      if (this.settingsModal || this.playerPanel) {
        document.addEventListener("keydown", (e) => {
          if (this.settingsModal && this.settingsModal.classList.contains("active")) {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              this.closeSettingsModal();
            } else if (e.key === "Enter") {
              if (e.target && e.target.closest && e.target.closest("#btnTestSeamBeep")) {
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              this.saveSettings();
            }
            return;
          }
          
          if (this.playerPanel && this.playerPanel.style.display !== "none") {
            if (e.key === "Escape" || e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              this.closePlayer();
            }
          }
        }, true);
      }

      // Clear All Recordings Button & Long-Press on Quota Bar
      if (this.clearAllBtn) {
        this.clearAllBtn.onclick = () => this.clearAllRecordings();
      }
      this.initQuotaLongPressMenu();
      this.initTxControls();

      // Offline Transcribe Modal Events
      if (this.closeOfflineTranscribeBtn) {
        this.closeOfflineTranscribeBtn.onclick = () => this.closeOfflineTranscribeModal();
      }
      if (this.cancelOfflineTranscribeBtn) {
        this.cancelOfflineTranscribeBtn.onclick = () => this.closeOfflineTranscribeModal();
      }
      if (this.confirmOfflineTranscribeBtn) {
        this.confirmOfflineTranscribeBtn.onclick = () => this.confirmAndStartOfflineTranscribe();
      }
      if (this.offlineTranscribeModal) {
        this.offlineTranscribeModal.onclick = (e) => {
          if (e.target === this.offlineTranscribeModal) this.closeOfflineTranscribeModal();
        };
      }
      if (this.chkDeleteOriginalAudio) {
        this.chkDeleteOriginalAudio.onchange = () => {
          try {
            localStorage.setItem("proxdmr_offline_transcribe_delete_original", this.chkDeleteOriginalAudio.checked ? "true" : "false");
          } catch (_) {}
        };
      }
    }

    updateOpenBtnState(isOpen) {
      if (this.openBtn) {
        this.openBtn.classList.toggle("active", Boolean(isOpen));
        const img = this.openBtn.querySelector("img");
        if (img) {
          img.src = isOpen ? "/static/img/Player_On.png?v=2.9.310" : "/static/img/Player_Off.png?v=2.9.310";
          img.alt = isOpen ? (window.t ? window.t("player.active_alt", {}, "Плеер включен") : "Плеер включен") : (window.t ? window.t("player.archive_alt", {}, "Архив записей") : "Архив записей");
        }
      }
    }

    openPlayer() {
      if (this.playerPanel) {
        this.playerPanel.style.display = "flex";
      }
      this.updateTxTargetLabel();
      this.updateOpenBtnState(true);
      this.updateActiveRowHighlight();
      requestAnimationFrame(() => this.drawProgressBar());

      if (typeof window.__proxdmr !== "undefined" && typeof window.__proxdmr.toggleTranscriptionSummary === "function") {
        if (window.isTranscriptionSummaryOpen) {
          window.__proxdmr.toggleTranscriptionSummary(false);
        }
      }

      if (window.logSelection && typeof window.logSelection.updateUI === "function") {
        window.logSelection.updateUI();
      }
    }

    closePlayer() {
      this.resetTxState();
      if (this.quotaClearMenu) {
        this.quotaClearMenu.style.display = "none";
      }
      if (this.isTtsPlaying) {
        this.stopTtsPlayback();
      }
      if (this._blinkTimer) {
        clearTimeout(this._blinkTimer);
        this._blinkTimer = null;
      }
      document.querySelectorAll(".live-call-row.row-blink-highlight").forEach(r => {
        r.classList.remove("row-blink-highlight");
      });
      if (this._autoPlayTimer) {
        clearTimeout(this._autoPlayTimer);
        this._autoPlayTimer = null;
      }
      if (this.audio) {
        this.audio.pause();
      }
      this.stopSmoothProgress();
      this.updatePlayState(false);
      if (this.playerPanel) {
        this.playerPanel.style.display = "none";
      }
      this.updateOpenBtnState(false);
      this._pendingCallId = null;
      this.updateActiveRowHighlight();

      if (window.logSelection && typeof window.logSelection.updateUI === "function") {
        window.logSelection.updateUI();
      }
    }

    async checkOfflineTranscribeStatus() {
      try {
        const resp = await fetch("/api/transcriber/offline/status");
        if (resp.ok) {
          const data = await resp.json();
          if (data.status === "ok") {
            if (data.hotspots && typeof data.hotspots === "object") {
              Object.entries(data.hotspots).forEach(([hid, info]) => {
                this.setOfflineTranscribeState(info.active, info.stats, hid);
              });
            } else {
              this.setOfflineTranscribeState(data.active, data.stats, "default");
            }
          }
        }
      } catch (_) {}
    }

    openOfflineTranscribeModal(targetHotspotId = null) {
      const logTabHid = (typeof window !== "undefined" && window.currentLogHotspotId && window.currentLogHotspotId !== "all")
        ? window.currentLogHotspotId
        : null;
      const curHsId = window.resolveHotspotId(
        targetHotspotId ||
        (this.currentRecording && this.currentRecording.hotspot_id) ||
        logTabHid ||
        (typeof activeHotspotId !== "undefined" ? activeHotspotId : window.activeHotspotId) ||
        "default"
      );
      this._targetOfflineHotspotId = curHsId;

      if (!this.offlineTranscribeModal) {
        this.startOfflineTranscribe(false, this._targetOfflineHotspotId);
        return;
      }

      if (this.selOfflineTranscribeHotspot) {
        this.selOfflineTranscribeHotspot.innerHTML = "";
        const activeHotspots = (typeof currentHotspots !== "undefined" && Array.isArray(currentHotspots))
          ? currentHotspots.filter(h => !h.hidden)
          : [];
        const list = activeHotspots.length > 0
          ? activeHotspots
          : [{ id: "default", name: "Main 📻" }];
        list.forEach(h => {
          const opt = document.createElement("option");
          opt.value = h.id;
          const isRun = this.isHotspotOfflineTranscribing(h.id);
          const hsName = h.name || (window.getHotspotDisplayName ? window.getHotspotDisplayName(h.id) : `${window.t ? window.t("hotspots.default_name", {}, "Hotspot") : "Hotspot"} ${h.id}`);
          opt.textContent = isRun ? (window.t ? window.t("player.hs_running", { name: hsName }, `${hsName} ⏳ (running)`) : `${hsName} ⏳ (running)`) : hsName;
          if (window.resolveHotspotId(h.id) === curHsId || h.id === curHsId) {
            opt.selected = true;
          }
          this.selOfflineTranscribeHotspot.appendChild(opt);
        });

        this.selOfflineTranscribeHotspot.onchange = () => {
          this._syncModalStateForHotspot(this.selOfflineTranscribeHotspot.value);
        };
      }

      this._syncModalStateForHotspot(curHsId);

      const saved = (typeof localStorage !== "undefined") ? localStorage.getItem("proxdmr_offline_transcribe_delete_original") : null;
      if (this.chkDeleteOriginalAudio) {
        this.chkDeleteOriginalAudio.checked = (saved === "true");
      }
      this.offlineTranscribeModal.style.display = "flex";
    }

    _syncModalStateForHotspot(rawHid) {
      const hid = window.resolveHotspotId(rawHid);
      this._targetOfflineHotspotId = hid;
      const isRunning = this.isHotspotOfflineTranscribing(hid);
      const hsName = window.getHotspotDisplayName ? window.getHotspotDisplayName(hid) : hid;

      if (this.offlineTranscribeInfoText) {
        if (isRunning) {
          const info = this.offlineTranscribers && this.offlineTranscribers[hid];
          let progress = "";
          if (info && info.stats && info.stats.total) {
            progress = ` [${info.stats.processed || 0}/${info.stats.total}]`;
          }
          this.offlineTranscribeInfoText.textContent = window.t ? window.t("player.offline_in_progress", { name: hsName, progress: progress }, `Для хотспота "${hsName}" уже выполняется офлайн-транскрибация${progress}. Остановить процесс?`) : `Для хотспота "${hsName}" уже выполняется офлайн-транскрибация${progress}. Остановить процесс?`;
        } else {
          this.offlineTranscribeInfoText.textContent = window.t ? window.t("player.offline_prompt", { name: hsName }, `Запустить транскрибацию накопленных аудиозаписей для "${hsName}" через Google AI?`) : `Запустить транскрибацию накопленных аудиозаписей для "${hsName}" через Google AI?`;
        }
      }

      if (this.lblDeleteOriginalAudio) {
        this.lblDeleteOriginalAudio.style.display = isRunning ? "none" : "flex";
      }

      if (this.confirmOfflineTranscribeBtn) {
        if (isRunning) {
          this.confirmOfflineTranscribeBtn.textContent = window.t ? window.t("player.btn_stop", {}, "Остановить") : "Остановить";
          this.confirmOfflineTranscribeBtn.className = "btn-danger";
          this.confirmOfflineTranscribeBtn.style.background = "#da3633";
          this.confirmOfflineTranscribeBtn.style.borderColor = "#f85149";
          this.confirmOfflineTranscribeBtn.style.color = "#ffffff";
        } else {
          this.confirmOfflineTranscribeBtn.textContent = window.t ? window.t("player.btn_start", {}, "Запустить") : "Запустить";
          this.confirmOfflineTranscribeBtn.className = "btn-primary";
          this.confirmOfflineTranscribeBtn.style.background = "";
          this.confirmOfflineTranscribeBtn.style.borderColor = "";
          this.confirmOfflineTranscribeBtn.style.color = "";
        }
      }
    }

    closeOfflineTranscribeModal() {
      if (this.offlineTranscribeModal) {
        this.offlineTranscribeModal.style.display = "none";
      }
    }

    async confirmAndStartOfflineTranscribe() {
      let hid = this._targetOfflineHotspotId;
      if (this.selOfflineTranscribeHotspot && this.selOfflineTranscribeHotspot.value) {
        hid = this.selOfflineTranscribeHotspot.value;
      }
      hid = window.resolveHotspotId(hid || (this.currentRecording ? this.currentRecording.hotspot_id : (typeof activeHotspotId !== "undefined" ? activeHotspotId : window.activeHotspotId)) || "default");

      if (this.isHotspotOfflineTranscribing(hid)) {
        this.closeOfflineTranscribeModal();
        await this.stopOfflineTranscribe(hid);
        return;
      }

      const deleteOriginal = Boolean(this.chkDeleteOriginalAudio && this.chkDeleteOriginalAudio.checked);
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("proxdmr_offline_transcribe_delete_original", deleteOriginal ? "true" : "false");
        }
      } catch (_) {}
      this.closeOfflineTranscribeModal();
      await this.startOfflineTranscribe(deleteOriginal, hid);
    }

    isHotspotOfflineTranscribing(hotspotId) {
      const hid = window.resolveHotspotId(hotspotId || "default");
      return Boolean(this.offlineTranscribers && this.offlineTranscribers[hid] && this.offlineTranscribers[hid].active);
    }

    async handleOfflineTranscribeClick(hotspotId = null) {
      const hid = window.resolveHotspotId(
        hotspotId ||
        (this.currentRecording && this.currentRecording.hotspot_id) ||
        (typeof activeHotspotId !== "undefined" ? activeHotspotId : window.activeHotspotId) ||
        "default"
      );
      this.openOfflineTranscribeModal(hid);
    }

    async startOfflineTranscribe(deleteOriginal = false, hotspotId = null) {
      const hid = window.resolveHotspotId(
        hotspotId ||
        this._targetOfflineHotspotId ||
        (this.currentRecording && this.currentRecording.hotspot_id) ||
        (typeof activeHotspotId !== "undefined" ? activeHotspotId : window.activeHotspotId) ||
        "default"
      );
      try {
        const resp = await fetch("/api/transcriber/offline/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            delete_original: Boolean(deleteOriginal),
            hotspot_id: hid
          })
        });
        const data = await resp.json();
        if (resp.ok && data.status === "ok") {
          this.setOfflineTranscribeState(true, null, hid);
          const hsName = window.getHotspotDisplayName ? window.getHotspotDisplayName(hid) : hid;
          showToast(deleteOriginal ? (window.t ? window.t("player.transcribe_started_del", { name: hsName }, `Запущена транскрибация [${hsName}] (с удалением оригинала аудио)`) : `Запущена транскрибация [${hsName}] (с удалением оригинала аудио)`) : (window.t ? window.t("player.transcribe_started", { name: hsName }, `Запущена офлайн-транскрибация [${hsName}]`) : `Запущена офлайн-транскрибация [${hsName}]`), 2500);
        } else {
          showToast(data.message || (window.t ? window.t("player.transcribe_start_err", {}, "Ошибка запуска транскрибации") : "Ошибка запуска транскрибации"), 3000);
        }
      } catch (e) {
        console.error("Failed to start offline transcribe:", e);
        showToast(window.t ? window.t("player.transcribe_net_err", {}, "Ошибка сети при запуске транскрибации") : "Ошибка сети при запуске транскрибации", 2500);
      }
    }

    onRecordingDeleted(recId, callId) {
      if (callId) {
        this.recordedCallIds.delete(callId);
        document.querySelectorAll(`.live-call-row[data-id="${callId}"] .log-play-btn`).forEach(btn => btn.remove());
      }
      if (this.currentRecording && (this.currentRecording.id === recId || this.currentRecording.call_id === callId)) {
        const nextId = this.getNextChronologicalCallId(callId);
        if (nextId) {
          this.playByCallId(nextId);
        } else {
          this.closePlayer();
        }
      }
      this.loadStats();
    }

    async stopOfflineTranscribe(hotspotId = null) {
      const hid = window.resolveHotspotId(
        hotspotId ||
        (this.currentRecording && this.currentRecording.hotspot_id) ||
        (typeof activeHotspotId !== "undefined" ? activeHotspotId : window.activeHotspotId) ||
        "default"
      );
      try {
        const resp = await fetch("/api/transcriber/offline/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hotspot_id: hid })
        });
        this.setOfflineTranscribeState(false, null, hid);
        const hsName = window.getHotspotDisplayName ? window.getHotspotDisplayName(hid) : hid;
        showToast(window.t ? window.t("player.transcribe_stopped", { name: hsName }, `Офлайн-транскрибация [${hsName}] остановлена`) : `Офлайн-транскрибация [${hsName}] остановлена`, 2500);
      } catch (e) {
        console.error("Failed to stop offline transcribe:", e);
        this.setOfflineTranscribeState(false, null, hid);
      }
    }

    setOfflineTranscribeState(active, stats = null, hotspotId = null) {
      const hid = window.resolveHotspotId(hotspotId || (stats && stats.hotspot_id) || "default");
      if (!this.offlineTranscribers) this.offlineTranscribers = {};
      const prevStats = (this.offlineTranscribers[hid] && this.offlineTranscribers[hid].stats) || null;
      const mergedStats = stats || (active ? prevStats : null);
      this.offlineTranscribers[hid] = { active: Boolean(active), stats: mergedStats };

      const anyRunning = Object.values(this.offlineTranscribers).some(v => v && v.active);
      this.isOfflineTranscribing = anyRunning;

      if (this.offlineTranscribeBtn) {
        this.offlineTranscribeBtn.classList.toggle("active", this.isOfflineTranscribing);
        this.offlineTranscribeBtn.classList.toggle("is-transcribing", this.isOfflineTranscribing);
        let playerHint = window.t ? window.t("player.offline_transcribe_hint", {}, "Офлайн-транскрибация записей (Google AI)") : "Офлайн-транскрибация записей (Google AI)";
        if (this.isOfflineTranscribing) {
          const curStats = mergedStats || prevStats;
          if (curStats && curStats.total) {
            playerHint = window.t ? window.t("player.offline_transcribe_progress", { processed: curStats.processed || 0, total: curStats.total }, `Офлайн-транскрибация [${curStats.processed || 0}/${curStats.total}] (в процессе, нажмите для параметров / остановки)`) : `Офлайн-транскрибация [${curStats.processed || 0}/${curStats.total}] (в процессе, нажмите для параметров / остановки)`;
          } else {
            playerHint = window.t ? window.t("player.offline_transcribe_progress", { processed: 0, total: "..." }, "Офлайн-транскрибация (в процессе, нажмите для параметров / остановки)") : "Офлайн-транскрибация (в процессе, нажмите для параметров / остановки)";
          }
        }
        this.offlineTranscribeBtn.title = playerHint;
      }

      this.updateCardTranscribeUI(hid);
    }

    updateCardTranscribeUI(hotspotId) {
      const hid = window.resolveHotspotId(hotspotId || "default");
      const info = (this.offlineTranscribers && this.offlineTranscribers[hid]) || { active: false, stats: null };
      const isActive = Boolean(info.active);
      const stats = info.stats;

      const cards = document.querySelectorAll(".radio-container");
      cards.forEach(card => {
        const cardCid = window.resolveHotspotId(card.dataset.hotspotId || "default");
        if (cardCid === hid) {
          const btn = card.querySelector(".btn-hs-transcribe");
          if (btn) {
            if (isActive) {
              btn.style.display = "inline-flex";
              btn.classList.add("transcribing");
              btn.classList.remove("transcribe-off");
              btn.title = (stats && stats.total)
                ? (window.t ? window.t("player.offline_transcribe_progress", { processed: stats.processed || 0, total: stats.total }, `Офлайн-транскрибация [${stats.processed || 0}/${stats.total}] (в процессе, нажмите для параметров / остановки)`) : `Офлайн-транскрибация [${stats.processed || 0}/${stats.total}] (в процессе, нажмите для параметров / остановки)`)
                : (window.t ? window.t("player.offline_transcribe_hint", {}, "Офлайн-транскрибация записей (Google AI)") : "Офлайн-транскрибация записей (Google AI)");
            } else {
              btn.style.display = "none";
              btn.classList.remove("transcribing");
              btn.classList.add("transcribe-off");
              btn.title = window.t ? window.t("player.offline_transcribe_hint", {}, "Офлайн-транскрибация записей (Google AI)") : "Офлайн-транскрибация записей (Google AI)";
            }
          }
        }
      });
      if (typeof window !== "undefined" && typeof window.refreshToolbarProcessIndicators === "function") {
        window.refreshToolbarProcessIndicators();
      }
    }

    updateAllHotspotTranscribeUI() {
      const cards = document.querySelectorAll(".radio-container");
      cards.forEach(card => {
        const cardCid = window.resolveHotspotId(card.dataset.hotspotId || "default");
        this.updateCardTranscribeUI(cardCid);
      });
    }

    startSmoothProgress() {
      this.stopSmoothProgress();
      const step = () => {
        if (!this.audio || this.isScrubbing) {
          if (this.audio && !this.audio.paused && !this.audio.ended) {
            this._progressRaf = requestAnimationFrame(step);
          }
          return;
        }
        const cur = this.audio.currentTime || 0;
        const dur = this.audio.duration || (this.currentRecording ? this.currentRecording.duration : 0);
        if (dur > 0) {
          const percent = Math.min(100, Math.max(0, (cur / dur) * 100));
          this._currentPercent = percent;
          this.drawProgressBar(percent);
          if (this.scrubberFill) {
            this.scrubberFill.style.width = `${percent}%`;
          }
          const tspan = document.getElementById("recTrackTimeRemaining");
          if (tspan) {
            const rem = Math.max(0, Math.round(dur - cur));
            const m = Math.floor(rem / 60);
            const s = Math.floor(rem % 60);
            tspan.textContent = "-" + String(m).padStart(2, '0') + ":" + String(s).padStart(2, '0');
          }
        }
        this.updateGlobalProgressBar(cur);
        if (this.isTxStreaming) {
          this.updateRecTxVuMeter();
        }
        
        if (!this.audio.paused && !this.audio.ended) {
          this._progressRaf = requestAnimationFrame(step);
        } else {
          this._progressRaf = null;
        }
      };
      this._progressRaf = requestAnimationFrame(step);
    }

    stopSmoothProgress() {
      if (this._progressRaf) {
        cancelAnimationFrame(this._progressRaf);
        this._progressRaf = null;
      }
    }

    updateGlobalProgressBar(currentTime) {
      if (!this.globalScrubberFill || !this.globalSegmentedBar) return;
      
      const chronoIds = this.getChronologicalRecordedCallIds();
      if (!chronoIds || chronoIds.length === 0) {
        this.globalScrubberFill.style.width = '0%';
        if (this.globalTimeRemaining) {
          this.globalTimeRemaining.textContent = "00:00";
        }
        return;
      }

      let callsMap = new Map();
      if (typeof heardCalls !== "undefined" && Array.isArray(heardCalls)) {
        heardCalls.forEach(c => callsMap.set(String(c.id), c));
      }

      let totalDuration = 0;
      let pastDuration = 0;
      let foundCurrent = false;
      const curCallId = this.currentRecording ? String(this.currentRecording.call_id) : null;

      for (const cid of chronoIds) {
        const c = callsMap.get(cid);
        const dur = c && c.duration ? parseFloat(c.duration) : 0;
        totalDuration += dur;

        if (cid === curCallId) {
          foundCurrent = true;
        } else if (!foundCurrent) {
          pastDuration += dur;
        }
      }

      if (totalDuration <= 0) {
        this.globalScrubberFill.style.width = '0%';
        if (this.globalTimeRemaining) {
          this.globalTimeRemaining.textContent = "00:00";
        }
        return;
      }

      const currentProgress = pastDuration + (foundCurrent ? (currentTime || 0) : 0);
      let percent = (currentProgress / totalDuration) * 100;
      percent = Math.min(100, Math.max(0, percent));
      
      this.globalScrubberFill.style.width = `${percent}%`;

      if (this.globalTimeRemaining) {
        const remainingSec = Math.max(0, Math.round(totalDuration - currentProgress));
        const hours = Math.floor(remainingSec / 3600);
        const minutes = Math.floor((remainingSec % 3600) / 60);
        this.globalTimeRemaining.textContent = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      }
    }

    onTimeUpdate() {
      this.syncVolumeWithHotspot();
      if (!this.audio || this.isScrubbing) return;
      if (!this._progressRaf) {
        const cur = this.audio.currentTime || 0;
        const dur = this.audio.duration || (this.currentRecording ? this.currentRecording.duration : 0);
        const percent = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
        this._currentPercent = percent;
        this.drawProgressBar(percent);
        if (this.scrubberFill) {
          this.scrubberFill.style.width = `${percent}%`;
        }
        this.updateGlobalProgressBar(cur);
      }
    }

    drawProgressBar(percent = null) {
      if (percent === null || isNaN(percent)) {
        percent = this._currentPercent || 0;
      } else {
        this._currentPercent = percent;
      }
      const canvas = this.segmentedCanvas;
      if (!canvas || !this.segmentedBar) return;

      // Cache dimensions — only recalculate on resize (avoid forced reflow every frame)
      const dpr = window.devicePixelRatio || 1;
      if (!this._cachedBarW || !this._resizeObserverAttached) {
        const rect = this.segmentedBar.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        this._cachedBarW = Math.round(rect.width * dpr);
        this._cachedBarH = Math.round(rect.height * dpr);
        // Attach resize observer once to invalidate cache
        if (!this._resizeObserverAttached && typeof ResizeObserver !== "undefined") {
          this._barResizeObs = new ResizeObserver(entries => {
            for (const e of entries) {
              this._cachedBarW = Math.round(e.contentRect.width * dpr);
              this._cachedBarH = Math.round(e.contentRect.height * dpr);
              this._tickPatternCanvas = null; // invalidate tick pattern
            }
          });
          this._barResizeObs.observe(this.segmentedBar);
          this._resizeObserverAttached = true;
        }
      }

      const w = this._cachedBarW;
      const h = this._cachedBarH;
      if (!w || !h) return;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        this._tickPatternCanvas = null; // invalidate on size change
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const isLight = document.documentElement.getAttribute("data-theme") === "light";
      const colorFill = "#49ca99";
      const colorEmpty = isLight ? "#dde5e0" : "#141d18";

      // 1. Draw empty track background
      ctx.fillStyle = colorEmpty;
      ctx.fillRect(0, 0, w, h);

      // 2. Draw played progress fill
      const fillPx = Math.max(0, Math.min(w, Math.round(w * (percent / 100))));
      if (fillPx > 0) {
        ctx.fillStyle = colorFill;
        ctx.fillRect(0, 0, fillPx, h);
      }

      // 3. Draw tick lines from pre-rendered offscreen canvas (created once, not every frame)
      if (!this._tickPatternCanvas || this._tickPatternCanvas.width !== w || this._tickPatternCanvas.height !== h) {
        const colorTick = isLight ? "#f2f7f4" : "#090d0b";
        this._tickPatternCanvas = document.createElement("canvas");
        this._tickPatternCanvas.width = w;
        this._tickPatternCanvas.height = h;
        const tCtx = this._tickPatternCanvas.getContext("2d");
        tCtx.clearRect(0, 0, w, h);
        tCtx.fillStyle = colorTick;
        for (let x = 0; x < w; x += 3) {
          tCtx.fillRect(x, 0, 1, h);
        }
      }
      ctx.drawImage(this._tickPatternCanvas, 0, 0);
    }

    updatePlayState(isPlaying) {
      if (isPlaying) {
        if (this._blinkTimer) {
          clearTimeout(this._blinkTimer);
          this._blinkTimer = null;
        }
        document.querySelectorAll(".live-call-row.row-blink-highlight").forEach(r => {
          r.classList.remove("row-blink-highlight");
        });
      }

      if (this.playPauseBtn) {
        const iconPlay = this.playPauseBtn.querySelector(".icon-play");
        const iconPause = this.playPauseBtn.querySelector(".icon-pause");
        if (iconPlay) iconPlay.style.display = isPlaying ? "none" : "block";
        if (iconPause) iconPause.style.display = isPlaying ? "block" : "none";
        this.playPauseBtn.classList.toggle("playing", isPlaying);
      }

      const currentCallId = this.currentRecording ? (this.currentRecording.call_id || this.currentRecording.id) : null;
      const strCurCallId = currentCallId != null ? String(currentCallId) : null;
      document.querySelectorAll(".log-play-btn").forEach(btn => {
        const matches = Boolean(strCurCallId && String(btn.dataset.callId) === strCurCallId);
        const isBtnPlaying = Boolean(isPlaying && matches);
        btn.classList.toggle("playing", isBtnPlaying);
        if (!btn.querySelector(".log-play-img")) {
          btn.innerHTML = `<img src="/static/img/Log_PLAY.png" class="log-play-img" alt="Play">`;
        }
      });

      this.updateActiveRowHighlight();
      this.applySoloState();
    }

    toggleSolo() {
      this.isSoloEnabled = !this.isSoloEnabled;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("proxdmr_player_solo", this.isSoloEnabled ? "true" : "false");
      }
      this.updateSoloUI();
      this.applySoloState();
    }

    updateSortUI() {
      if (this.sortBtn) {
        const isAsc = window.__proxdmrLogSortOrder === 'asc';
        this.sortBtn.classList.toggle('active', isAsc);
        this.sortBtn.classList.toggle('is-asc', isAsc);
        this.sortBtn.classList.toggle('is-desc', !isAsc);
        const titleKey = isAsc ? "log.sort_newest_bottom" : "log.sort_newest_top";
        const titleDefault = isAsc ? "Sort: newest at bottom" : "Sort: newest on top";
        const title = (window.t ? window.t(titleKey, {}, titleDefault) : titleDefault);
        this.sortBtn.title = title;
        this.sortBtn.setAttribute("aria-label", title);
        const svg = this.sortBtn.querySelector('svg');
        if (svg) {
          svg.style.transform = isAsc ? 'rotate(180deg)' : 'rotate(0deg)';
          svg.style.transition = 'transform 0.2s ease';
        }
      }
    }

    updateSoloUI() {
      if (this.soloBtn) {
        this.soloBtn.classList.toggle('active', this.isSoloEnabled);
      }
    }

    applySoloState() {
      const isPlaying = Boolean(this.audio && !this.audio.paused && !this.audio.ended);
      const isTtsPlaying = Boolean(this.isTtsPlaying);
      const shouldMuteOthers = Boolean(this.isSoloEnabled && (isPlaying || isTtsPlaying));

      if (this.soloBtn) {
        this.soloBtn.classList.toggle("active", this.isSoloEnabled);
        this.soloBtn.classList.toggle("is-soloing", shouldMuteOthers);
      }

      if (window.audioPlayer && typeof window.audioPlayer.setSoloMuted === "function") {
        window.audioPlayer.setSoloMuted(shouldMuteOthers);
      }
    }

    initTtsButton() {
      this.recTtsBtn = document.getElementById("recTtsBtn");
      if (typeof window.setupRecTtsButton === "function") {
        window.setupRecTtsButton();
      }
    }

    async toggleTtsPlayback() {
      if (this.isTtsPlaying) {
        this.stopTtsPlayback();
        return;
      }
      if (!this.currentRecording) {
        showToast(window.t ? window.t("player.select_for_tts", {}, "Выберите запись для воспроизведения") : "Выберите запись для воспроизведения", 2000);
        return;
      }
      await this.startTtsPlayback();
    }

    async startTtsPlayback() {
      const rec = this.currentRecording;
      if (!rec) return;

      if (this.audio && !this.audio.paused) {
        this.audio.pause();
        this.updatePlayState(false);
      }

      this.isTtsPlaying = true;
      const token = ++this._ttsPlayToken;
      this.updateTtsButtonState(true);

      this.applySoloState();
      if (typeof window.syncTtsSoloMode === "function") {
        window.syncTtsSoloMode();
      }

      const s = window.transcriberSettings || {};
      const engine = s.tts_engine || "gemini";
      const model = s.tts_model || "gemini-3.1-flash-tts-preview";
      const voice = s.tts_voice || "auto";
      const speed = 1.1;
      const targetLang = (s.target_lang && s.target_lang !== "none") ? s.target_lang : "ru";

      const langCode3 = (typeof window.get3LetterLangCode === "function")
        ? window.get3LetterLangCode(targetLang)
        : targetLang.toUpperCase();
      showToast(window.t ? window.t("recordings.tts_loading", { lang: langCode3 }, `🔊 Синтез речи [${langCode3}]...`) : `🔊 Синтез речи [${langCode3}]...`, 2000);

      try {
        const resp = await fetch(`/api/recordings/${rec.id}/tts-translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            target_lang: targetLang,
            engine: engine,
            model: model,
            voice: (engine === "piper") ? ((voice === "__download__" || !voice) ? "" : voice) : (voice === "auto" ? "Puck" : voice),
            speed: speed
          })
        });
        const res = await resp.json();

        if (!this.isTtsPlaying || token !== this._ttsPlayToken) return;

        if (!resp.ok || res.status !== "ok") {
          const errClean = (res && (res.message || res.detail)) || (window.t ? window.t("player.tts_err", {}, "Speech synthesis error") : "Speech synthesis error");
          showToast(`⚠️ TTS: ${errClean}`, 3500);
          this.stopTtsPlayback();
          return;
        }

        if (res.text && !rec.transcription) {
          rec.transcription = res.text;
        }

        const onDone = () => {
          if (!this.isTtsPlaying || token !== this._ttsPlayToken) return;
          this.stopTtsPlayback();
        };

        if (res.engine === "browser" || engine === "browser") {
          this.playBrowserTts(res.text || rec.transcription, targetLang, speed, onDone);
          return;
        }

        if (!res.audio_base64) {
          this.stopTtsPlayback();
          return;
        }

        this.playAudioBase64(res.audio_base64, engine, speed, onDone, rec.hotspot_id, rec.slot);
      } catch (err) {
        console.error("[PLAYER-TTS] Exception:", err);
        showToast(`⚠️ TTS: ${err.message || err}`, 3500);
        this.stopTtsPlayback();
      }
    }

    playAudioBase64(audioBase64, engine, speed, onDone, targetHid = null, targetSlot = null) {
      try {
        const binaryString = atob(audioBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const player = window.dmrAudioPlayer || window.audioPlayer;
        const effectiveRate = (engine === "piper") ? 1.0 : speed;

        if (player && typeof player.playTtsAudio === "function") {
          let ended = false;
          const cb = () => {
            if (ended) return;
            ended = true;
            this.currentTtsHandle = null;
            onDone();
          };

          const hid = targetHid || (this.currentRecording && this.currentRecording.hotspot_id) || "default";
          const slot = parseInt(targetSlot || (this.currentRecording && this.currentRecording.slot) || 1, 10);

          player.playTtsAudio(hid, slot, bytes.buffer, effectiveRate, cb)
            .then(handle => {
              if (!this.isTtsPlaying) {
                if (handle && handle.stop) handle.stop();
                return;
              }
              this.currentTtsHandle = handle;
            })
            .catch(err => {
              console.warn("[PLAYER-TTS] playTtsAudio failed, using HTML5 Audio:", err);
              this.playFallbackAudio(bytes, effectiveRate, onDone);
            });
          return;
        }

        this.playFallbackAudio(bytes, effectiveRate, onDone);
      } catch (e) {
        console.error("[PLAYER-TTS] Audio decode error:", e);
        onDone();
      }
    }

    playFallbackAudio(bytes, speed, onDone) {
      try {
        const blob = new Blob([bytes.buffer], { type: "audio/wav" });
        const blobUrl = URL.createObjectURL(blob);
        const audio = new Audio(blobUrl);
        this.currentTtsAudioEl = audio;
        audio.preservesPitch = true;
        audio.playbackRate = speed;

        const cleanup = () => {
          try { URL.revokeObjectURL(blobUrl); } catch (_) {}
          this.currentTtsAudioEl = null;
        };

        audio.onended = () => {
          cleanup();
          onDone();
        };
        audio.onerror = () => {
          cleanup();
          onDone();
        };

        audio.play().catch(e => {
          console.warn("[PLAYER-TTS] Audio play error:", e);
          cleanup();
          onDone();
        });
      } catch (e) {
        console.error("[PLAYER-TTS] Fallback audio exception:", e);
        onDone();
      }
    }

    playBrowserTts(text, targetLang, speed, onDone) {
      if (!window.speechSynthesis) {
        showToast(window.t ? window.t("player.speech_not_supported", {}, "Web Speech API is not supported by your browser") : "Web Speech API is not supported by your browser", 3000);
        onDone();
        return;
      }
      window.speechSynthesis.cancel();
      const ut = new SpeechSynthesisUtterance(text);
      ut.rate = speed;
      const bcpMap = { "ru": "ru-RU", "en": "en-US", "uk": "uk-UA", "de": "de-DE", "es": "es-ES", "fr": "fr-FR", "it": "it-IT", "nl": "nl-NL" };
      ut.lang = bcpMap[targetLang] || targetLang;

      ut.onend = () => onDone();
      ut.onerror = () => onDone();
      window.speechSynthesis.speak(ut);
    }

    stopTtsPlayback() {
      this._ttsPlayToken++;
      this.isTtsPlaying = false;
      this.updateTtsButtonState(false);

      if (this.currentTtsHandle && typeof this.currentTtsHandle.stop === "function") {
        try { this.currentTtsHandle.stop(); } catch (_) {}
        this.currentTtsHandle = null;
      }
      if (this.currentTtsAudioEl) {
        try {
          this.currentTtsAudioEl.pause();
          this.currentTtsAudioEl.src = "";
        } catch (_) {}
        this.currentTtsAudioEl = null;
      }
      if (window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch (_) {}
      }

      this.applySoloState();
      if (typeof window.syncTtsSoloMode === "function") {
        window.syncTtsSoloMode();
      }
    }

    updateTtsButtonState(isSpeaking) {
      const btn = this.recTtsBtn || document.getElementById("recTtsBtn");
      if (btn) {
        btn.classList.toggle("tts-speaking", Boolean(isSpeaking));
      }
    }

    isPlaying() {
      return Boolean(this.audio && !this.audio.paused && !this.audio.ended);
    }

    pause() {
      if (this.isTxStreaming) {
        this.stopRecordingTxStream();
      }
      if (this.isTtsPlaying) {
        this.stopTtsPlayback();
      }
      if (this._autoPlayTimer) {
        clearTimeout(this._autoPlayTimer);
        this._autoPlayTimer = null;
      }
      if (this.audio && !this.audio.paused) {
        this.audio.pause();
      }
      this.updatePlayState(false);
      this.stopSmoothProgress();
    }

    stop() {
      if (this.isTxStreaming) {
        this.stopRecordingTxStream();
      }
      if (this.isTtsPlaying) {
        this.stopTtsPlayback();
      }
      if (this._autoPlayTimer) {
        clearTimeout(this._autoPlayTimer);
        this._autoPlayTimer = null;
      }
      if (this.audio) {
        try {
          this.audio.pause();
          this.audio.currentTime = 0;
        } catch (_) {}
      }
      this._currentPercent = 0;
      this.drawProgressBar(0);
      if (this.scrubberFill) this.scrubberFill.style.width = "0%";
      const tspan = document.getElementById("recTrackTimeRemaining");
      if (tspan) tspan.textContent = "-00:00";
      this.updatePlayState(false);
      this.stopSmoothProgress();
    }

    toggleSpeedMenu() {
      const menu = document.getElementById("recSpeedMenu");
      if (menu) {
        if (menu.style.display === "none") {
          menu.style.display = "flex";
        } else {
          menu.style.display = "none";
        }
      }
    }

    togglePlayPause() {
      if (this.isTtsPlaying) {
        this.stopTtsPlayback();
      }
      if (this._autoPlayTimer) {
        clearTimeout(this._autoPlayTimer);
        this._autoPlayTimer = null;
      }
      if (!this.audio.src || !this.currentRecording) {
        const chronoIds = this.getChronologicalRecordedCallIds();
        if (chronoIds.length > 0) {
          this.playByCallId(chronoIds[0]);
        } else {
          showToast(window.t ? window.t("player.no_records", {}, "Нет доступных записей для воспроизведения") : "Нет доступных записей для воспроизведения", 2000);
        }
        return;
      }
      if (this.audio.paused) {
        const ap = window.audioPlayer || window.dmrAudioPlayer;
        if (ap) {
          if (typeof ap.ensureInitialized === "function") ap.ensureInitialized();
          if (ap.audioCtx && ap.audioCtx.state === "suspended") {
            ap.audioCtx.resume().catch(() => {});
          }
        }
        this.syncVolumeWithHotspot();
        this.audio.play().catch(e => console.warn(e));
        this.updatePlayState(true);
        this.startSmoothProgress();
      } else {
        this.audio.pause();
        this.updatePlayState(false);
        this.stopSmoothProgress();
      }
    }

    skip(sec) {
      if (this.isTtsPlaying) {
        this.stopTtsPlayback();
      }
      if (!this.audio) return;
      const dur = this.audio.duration || (this.currentRecording ? this.currentRecording.duration : 0);
      const newTime = Math.max(0, Math.min(dur || 99999, (this.audio.currentTime || 0) + sec));
      this.audio.currentTime = newTime;
    }

    getChronologicalRecordedCallIds() {
      const logList = document.getElementById("logList");
      if (!logList) return [];
      const calls = [];
      const rows = logList.querySelectorAll(".live-call-row");
      const heardMap = (typeof heardCalls !== "undefined" && Array.isArray(heardCalls)) 
        ? new Map(heardCalls.map(c => [String(c.id), c.timestamp || 0])) 
        : new Map();

      rows.forEach((row, domIdx) => {
        if (row.offsetParent !== null && row.style.display !== "none") {
          const btn = row.querySelector(".log-play-btn");
          if (btn && btn.dataset.callId) {
            const cid = String(btn.dataset.callId);
            if (!calls.some(item => item.callId === cid)) {
              const ts = heardMap.has(cid) ? heardMap.get(cid) : (1000000000 - domIdx);
              calls.push({ callId: cid, timestamp: ts, domIdx });
            }
          }
        }
      });

      // Sort ascending by timestamp: oldest call first -> newest call last
      calls.sort((a, b) => a.timestamp - b.timestamp);
      return calls.map(c => c.callId);
    }

    getVisibleRecordedCallIds() {
      return this.getChronologicalRecordedCallIds();
    }

    getNextChronologicalCallId(currentCallId) {
      const chronoIds = this.getChronologicalRecordedCallIds();
      if (chronoIds.length === 0) return null;
      if (!currentCallId) return chronoIds[0];
      const idx = chronoIds.indexOf(String(currentCallId));
      if (idx >= 0 && idx < chronoIds.length - 1) {
        return chronoIds[idx + 1];
      }
      return null;
    }

    getPrevChronologicalCallId(currentCallId) {
      const chronoIds = this.getChronologicalRecordedCallIds();
      if (chronoIds.length === 0) return null;
      if (!currentCallId) return chronoIds[chronoIds.length - 1];
      const idx = chronoIds.indexOf(String(currentCallId));
      if (idx > 0) {
        return chronoIds[idx - 1];
      }
      return null;
    }

    playPrev() {
      if (this._autoPlayTimer) {
        clearTimeout(this._autoPlayTimer);
        this._autoPlayTimer = null;
      }
      const curCallId = this.currentRecording ? this.currentRecording.call_id : null;
      const prevId = this.getPrevChronologicalCallId(curCallId);
      if (prevId) {
        this.playByCallId(prevId);
      } else {
        showToast(window.t ? window.t("player.first_record", {}, "Первая запись в хронологии") : "Первая запись в хронологии", 2000);
      }
    }

    async playSeamBeep(options = {}) {
      const forceTest = Boolean(options && options.forceTest);
      if (!forceTest && (!this.optSeamBeep || !this.optSeamBeep.checked)) return;

      const rawVal = this.inputSeamBeepPattern ? this.inputSeamBeepPattern.value.trim() : "";
      const patternStr = rawVal || DEFAULT_ROGER_BEEP_PATTERN;
      await playLocalRogerBeep(patternStr);
    }

    playNext() {
      if (this._autoPlayTimer) {
        clearTimeout(this._autoPlayTimer);
        this._autoPlayTimer = null;
      }
      const curCallId = this.currentRecording ? this.currentRecording.call_id : null;
      const nextId = this.getNextChronologicalCallId(curCallId);
      if (nextId) {
        this.playByCallId(nextId);
      } else {
        showToast(window.t ? window.t("player.last_record", {}, "Достигнут конец хронологии записей") : "Достигнут конец хронологии записей", 2000);
      }
    }


    syncVolumeWithHotspot() {
      if (!this.audio) return;
      const rec = this.currentRecording;
      const hid = (rec && rec.hotspot_id)
        ? (window.resolveHotspotId ? window.resolveHotspotId(rec.hotspot_id) : rec.hotspot_id)
        : (window.getActiveHotspotId ? window.getActiveHotspotId() : "default");

      let isMuted = false;
      let vol = 80;

      // Check global mute state
      if (typeof window.isGlobalAudioMuted === "function" && window.isGlobalAudioMuted()) {
        isMuted = true;
      } else if (typeof window.isGlobalMuted === "function" && window.isGlobalMuted()) {
        isMuted = true;
      } else if (typeof window.isHotspotAudioMuted === "function") {
        isMuted = window.isHotspotAudioMuted(hid);
      }
      if (typeof window.getHotspotVolume === "function") {
        vol = window.getHotspotVolume(hid);
      }

      const ap = window.audioPlayer || window.dmrAudioPlayer;
      const attached = (ap && typeof ap.attachRecordingsAudio === "function")
        ? ap.attachRecordingsAudio(this.audio)
        : null;

      if (attached && attached.gainNode) {
        // Connected to Web Audio graph!
        // HTMLMediaElement.volume stays at 1.0 (so volume is not squared).
        // Gain is applied directly via Web Audio gainNode and routed to master limiter & master gain node.
        if (this.audio.volume !== 1.0) {
          try { this.audio.volume = 1.0; } catch (_) {}
        }
        const targetGain = isMuted ? 0.0 : Math.max(0, Math.min(2.5, (vol / 100.0) * 1.40));
        const now = (ap && ap.audioCtx) ? ap.audioCtx.currentTime : 0;
        try {
          attached.gainNode.gain.cancelScheduledValues(now);
          attached.gainNode.gain.setTargetAtTime(targetGain, now, 0.015);
        } catch (_) {
          attached.gainNode.gain.value = targetGain;
        }
      } else {
        // Fallback for standalone / non-WebAudio environment
        const targetVolFloat = isMuted ? 0.0 : Math.max(0, Math.min(1.0, vol / 100.0));
        if (this.audio.volume !== targetVolFloat) {
          try { this.audio.volume = targetVolFloat; } catch (_) {}
        }
      }
    }

    updateTimeBadge() {
      if (!this.timeBadgeEl || !this.currentRecording) return;
      const rec = this.currentRecording;
      const ts = rec.timestamp || rec.created_at;
      const formatFn = (typeof window !== "undefined" && typeof window.formatHistoryTime === "function")
        ? window.formatHistoryTime
        : (typeof formatHistoryTime === "function" ? formatHistoryTime : null);
      if (ts && formatFn) {
        this.timeBadgeEl.textContent = formatFn(ts);
      } else if (rec.time_str) {
        this.timeBadgeEl.textContent = rec.time_str;
      }
    }

    playRecording(rec, autoPlay = true) {
      if (!rec) return;
      if (this.isTtsPlaying) {
        this.stopTtsPlayback();
      }
      if (this._autoPlayTimer) {
        clearTimeout(this._autoPlayTimer);
        this._autoPlayTimer = null;
      }
      this._pendingCallId = null;
      this.currentRecording = rec;
      window.currentLiveRec = rec;
      const audioUrl = `/api/recordings/${rec.id}/audio`;

      this.openPlayer();
      this.updateActiveRowHighlight();

      const callsign = rec.src_callsign || (rec.src_id ? String(rec.src_id) : "Session");
      if (this.stationCallsignEl) this.stationCallsignEl.textContent = callsign;
      if (this.stationNameEl) this.stationNameEl.textContent = rec.src_name || (rec.talker_alias ? rec.talker_alias : "");

      if (this.stationFlagEl) {
        const liveCall = (window.lastHeardList || []).find(c => c && (c.id === rec.call_id || c.call_id === rec.call_id || c.id === rec.id));
        const country = getCallCountryInfo(liveCall ? { ...rec, ...liveCall } : rec);
        this.stationFlagEl.innerHTML = (rec.call_type === "TX") 
          ? `<span class="tx-mic-icon" title="${window.t ? window.t("live.tx_tooltip", {}, "Моя передача (TX)") : "Моя передача (TX)"}">\u{1F399}\u{FE0F}</span>` 
          : getFlagBadgeHtml(country, false, country.flag);
      }

      if (this.badgeTypeEl) {
        this.badgeTypeEl.textContent = rec.call_type || "RX";
        this.badgeTypeEl.className = "rec-type-badge";
        if (rec.call_type === "TX") this.badgeTypeEl.classList.add("rec-badge-tx");
        else if (rec.call_type === "SESSION") this.badgeTypeEl.classList.add("rec-badge-session");
        else this.badgeTypeEl.classList.add("rec-badge-rx");
      }
      const recLive = (window.lastHeardList || []).find(c => c && (c.id === rec.call_id || c.call_id === rec.call_id || c.id === rec.id));
      const recNet = String(
        rec.network_type ||
        (recLive && recLive.network_type) ||
        ((String(rec.call_id || rec.id || "").startsWith("ysf_") || String(rec.dst_name || (recLive && recLive.dst_name) || "").startsWith("YSF #")) ? "ysf" : (String(rec.call_id || rec.id || "").startsWith("asl_") ? "allstar" : "")) ||
        (rec.hotspot_id && typeof window.getHotspotNetworkType === "function" ? window.getHotspotNetworkType(rec.hotspot_id) : "")
      ).toLowerCase();
      if (this.tgBadgeEl) {
        if (recNet === "ysf") {
          this.tgBadgeEl.textContent = rec.dst_id ? `#${rec.dst_id}` : "#--";
        } else if (recNet === "allstar") {
          this.tgBadgeEl.textContent = rec.dst_id ? `Node ${rec.dst_id}` : "Node --";
        } else {
          this.tgBadgeEl.textContent = rec.dst_id ? `TG ${rec.dst_id}` : "TG --";
        }
      }
      if (this.slotBadgeEl) {
        if (recNet === "ysf") {
          this.slotBadgeEl.textContent = "YSF";
        } else if (recNet === "allstar") {
          this.slotBadgeEl.textContent = "ASL";
        } else {
          this.slotBadgeEl.textContent = rec.slot ? `TS${rec.slot}` : "TS--";
        }
      }
      if (this.timeBadgeEl) {
        this.updateTimeBadge();
        this.timeBadgeEl.title = window.t ? window.t("player.time_badge_hint", {}, "Время записи: нажмите для смены LOC ↔ UTC") : "Время записи: нажмите для смены LOC ↔ UTC";
        this.timeBadgeEl.style.cursor = "pointer";
        this.timeBadgeEl.onclick = (e) => {
          e.stopPropagation();
          if (typeof window.switchHistoryTimeMode === "function") {
            window.switchHistoryTimeMode();
          }
        };
      }

      if (this.downloadBtn) {
        const mp3Filename = (rec.filename || `${rec.id}.wav`).replace(/\.[^/.]+$/, "") + ".mp3";
        this.downloadBtn.href = `/api/recordings/${rec.id}/download?format=mp3&fn=${encodeURIComponent(mp3Filename)}`;
        this.downloadBtn.download = mp3Filename;
        this.downloadBtn.title = window.t ? window.t("player.download_mp3_title", {}, "Сохранить в файл (MP3)") : "Сохранить в файл (MP3)";
      }

      this._currentPercent = 0;
      this.drawProgressBar(0);
      if (this.scrubberFill) {
        this.scrubberFill.style.width = "0%";
      }

      this.audio.src = audioUrl;
      const ap = window.audioPlayer || window.dmrAudioPlayer;
      if (ap) {
        if (typeof ap.ensureInitialized === "function") ap.ensureInitialized();
        if (ap.audioCtx && ap.audioCtx.state === "suspended") {
          ap.audioCtx.resume().catch(() => {});
        }
      }
      this.syncVolumeWithHotspot();
      if (this.playbackRate && this.audio) {
        this.audio.playbackRate = this.playbackRate;
      }
      if (autoPlay) {
        this.audio.play().catch(e => console.warn("[RECORDINGS] Play error:", e));
        this.updatePlayState(true);
      } else {
        this.audio.pause();
        this.updatePlayState(false);
      }

      if (rec.call_id) {
        const row = document.querySelector(`.live-call-row[data-id="${rec.call_id}"]`);
        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    }

    async downloadCurrentMp3() {
      if (window.logSelection && window.logSelection.hasSelection()) {
        window.logSelection.downloadSelected();
        return;
      }
      if (!this.currentRecording) {
        showToast(window.t ? window.t("player.select_for_dl", {}, "Выберите запись для скачивания") : "Выберите запись для скачивания", 2000);
        return;
      }
      const rec = this.currentRecording;
      const mp3Filename = (rec.filename || `rec_${rec.id}.wav`).replace(/\.[^/.]+$/, "") + ".mp3";
      const downloadUrl = `/api/recordings/${rec.id}/download?format=mp3&fn=${encodeURIComponent(mp3Filename)}`;

      const isApk = Boolean(window.AndroidBridge) || (typeof isApkClient === "function" && window.isApkClient());

      if (isApk && window.AndroidBridge) {
        showToast(window.t ? window.t("player.saving_to_downloads", { filename: mp3Filename }, `Сохранение ${mp3Filename} в папку Загрузки (Download)...`) : `Сохранение ${mp3Filename} в папку Загрузки (Download)...`, 2500);

        // 1. If bridge supports direct Base64 stream saving to MediaStore / Download
        if (typeof window.AndroidBridge.saveBase64ToDownloads === "function") {
          try {
            const resp = await fetch(downloadUrl, { credentials: "same-origin" });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const reader = new FileReader();
            reader.onloadend = () => {
              try {
                const base64data = reader.result;
                const saved = window.AndroidBridge.saveBase64ToDownloads(base64data, mp3Filename, "audio/mpeg");
                if (saved) {
                  showToast(window.t ? window.t("player.saved_download", { filename: mp3Filename }, `✓ Аудиозапись ${mp3Filename} сохранена в «Download»`) : `✓ Аудиозапись ${mp3Filename} сохранена в «Download»`, 3000);
                } else {
                  this._fallbackBridgeDownload(downloadUrl, mp3Filename);
                }
              } catch (err) {
                console.warn("[RECORDINGS] saveBase64ToDownloads bridge call error:", err);
                this._fallbackBridgeDownload(downloadUrl, mp3Filename);
              }
            };
            reader.onerror = () => this._fallbackBridgeDownload(downloadUrl, mp3Filename);
            reader.readAsDataURL(blob);
            return;
          } catch (e) {
            console.warn("[RECORDINGS] Blob fetch failed, falling back to direct URL bridge:", e);
            this._fallbackBridgeDownload(downloadUrl, mp3Filename);
            return;
          }
        }

        // 2. Direct bridge fallback
        this._fallbackBridgeDownload(downloadUrl, mp3Filename);
        return;
      }

      // Standard desktop / browser download
      showToast(window.t ? window.t("player.saving_to_downloads", { filename: mp3Filename }, `Saving ${mp3Filename} to Downloads`) : `Saving ${mp3Filename} to Downloads`, 2500);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = mp3Filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    _fallbackBridgeDownload(downloadUrl, mp3Filename) {
      if (!window.AndroidBridge) return;
      try {
        if (typeof window.AndroidBridge.downloadFile === "function") {
          window.AndroidBridge.downloadFile(downloadUrl, mp3Filename);
          showToast(window.t ? window.t("player.saved_download", { filename: mp3Filename }, `✓ Saved ${mp3Filename} to Downloads`) : `✓ Saved ${mp3Filename} to Downloads`, 3000);
        } else if (typeof window.AndroidBridge.saveMp3ToDownloads === "function") {
          window.AndroidBridge.saveMp3ToDownloads(downloadUrl, mp3Filename);
          showToast(window.t ? window.t("player.saved_download", { filename: mp3Filename }, `✓ Saved ${mp3Filename} to Downloads`) : `✓ Saved ${mp3Filename} to Downloads`, 3000);
        } else if (typeof window.AndroidBridge.downloadApkWithFilename === "function") {
          window.AndroidBridge.downloadApkWithFilename(downloadUrl, mp3Filename);
          showToast(window.t ? window.t("player.saved_download", { filename: mp3Filename }, `✓ Saved ${mp3Filename} to Downloads`) : `✓ Saved ${mp3Filename} to Downloads`, 3000);
        }
      } catch (err) {
        console.error("[RECORDINGS] Bridge fallback download failed:", err);
        showToast(window.t ? window.t("player.bridge_save_err", {}, "Error saving file via AndroidBridge") : "Error saving file via AndroidBridge", 3000);
      }
    }

    async deleteCurrentRecording() {
      if (window.logSelection && window.logSelection.hasSelection()) {
        window.logSelection.deleteSelected();
        return;
      }
      if (!this.currentRecording) return;
      if (this.isTtsPlaying) {
        this.stopTtsPlayback();
      }
      const rec = this.currentRecording;
      const name = rec.src_callsign || rec.src_id || (window.t ? window.t("player.this_record", {}, "this recording") : "this recording");
      const ok = await (window.showAppConfirm ? window.showAppConfirm({
        title: window.t ? window.t("player.del_record_title", {}, "Delete recording") : "Delete recording",
        icon: "🗑️",
        message: window.t ? window.t("player.del_record_confirm", { name: name }, `Delete recording ${name}?`) : `Delete recording ${name}?`,
        confirmText: window.t ? window.t("buttons.delete", {}, "Delete") : "Delete",
        confirmStyle: "danger"
      }) : Promise.resolve(confirm(window.t ? window.t("player.del_record_confirm", { name: name }, `Delete recording ${name}?`) : `Delete recording ${name}?`)));
      if (!ok) return;

      try {
        const resp = await fetch(`/api/recordings/${rec.id}`, { method: "DELETE", credentials: "same-origin" });
        const res = await resp.json();
        if (res.status === "ok") {
          showToast(window.t ? window.t("player.del_record_success", {}, "✓ Запись удалена") : "✓ Запись удалена", 2000);
          this.recordedCallIds.delete(rec.call_id);

          const rows = document.querySelectorAll(`.live-call-row[data-id="${rec.call_id}"]`);
          rows.forEach(r => {
            const btn = r.querySelector(".log-play-btn");
            if (btn) btn.remove();
          });

          const callIds = this.getVisibleRecordedCallIds();
          if (callIds.length > 0) {
            this.playNext();
          } else {
            this.closePlayer();
          }
          this.loadStats();
        } else {
          showToast(window.t ? window.t("player.del_record_err", {}, "⚠️ Error deleting recording") : "⚠️ Error deleting recording", 3000);
        }
      } catch (err) {
        console.error(err);
        showToast(window.t ? window.t("player.del_record_err", {}, "⚠️ Error deleting recording") : "⚠️ Error deleting recording", 3000);
      }
    }

    async clearAllRecordings() {
      const ok = await (window.showAppConfirm ? window.showAppConfirm({
        title: window.t ? window.t("player.clear_all_title", {}, "Clear Audio Recordings") : "Clear Audio Recordings",
        icon: "🗑️",
        message: window.t ? window.t("player.clear_all_confirm", {}, "Delete ALL audio recordings?\n\nAll saved calls will be erased from the server. This action cannot be undone.") : "Delete ALL audio recordings?\n\nAll saved calls will be erased from the server. This action cannot be undone.",
        confirmText: window.t ? window.t("buttons.delete_all", {}, "Delete All") : "Delete All",
        confirmStyle: "danger"
      }) : Promise.resolve(confirm(window.t ? window.t("player.clear_all_confirm", {}, "Delete ALL audio recordings? This action cannot be undone.") : "Delete ALL audio recordings? This action cannot be undone.")));
      if (!ok) return;

      try {
        const resp = await fetch("/api/recordings/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({}),
        });
        const data = await resp.json();
        if (data.status === "ok") {
          showToast(window.t ? window.t("player.clear_all_success", { count: data.deleted_count || 0 }, `✓ All audio recordings deleted (${data.deleted_count || 0})`) : `✓ All audio recordings deleted (${data.deleted_count || 0})`, 2500);
          this.onRecordingsCleared();
        } else {
          showToast(window.t ? window.t("player.clear_all_err", {}, "⚠️ Error clearing audio recordings") : "⚠️ Error clearing audio recordings", 3000);
        }
      } catch (err) {
        console.error("[RECORDINGS] Error clearing recordings:", err);
        showToast(window.t ? window.t("player.clear_all_err", {}, "⚠️ Error clearing audio recordings") : "⚠️ Error clearing audio recordings", 3000);
      }
    }

    onRecordingsCleared() {
      if (this._autoPlayTimer) {
        clearTimeout(this._autoPlayTimer);
        this._autoPlayTimer = null;
      }
      if (this.audio) {
        this.audio.pause();
        this.audio.src = "";
      }
      this.currentRecording = null;
      this._pendingCallId = null;
      this.recordedCallIds.clear();

      document.querySelectorAll(".live-call-row .log-play-btn").forEach(btn => btn.remove());
      this.updateActiveRowHighlight();

      this._currentPercent = 0;
      this.drawProgressBar(0);
      if (this.scrubberFill) this.scrubberFill.style.width = "0%";
      const tspan = document.getElementById("recTrackTimeRemaining");
      if (tspan) tspan.textContent = "-00:00";
      this.closePlayer();
      this.loadStats();
    }

    async playByCallId(callId, autoPlay = true) {
      if (!callId) return;
      if (this._autoPlayTimer) {
        clearTimeout(this._autoPlayTimer);
        this._autoPlayTimer = null;
      }

      const strCallId = String(callId);
      const isCurrent = Boolean(
        this.currentRecording &&
        ((this.currentRecording.call_id != null && String(this.currentRecording.call_id) === strCallId) ||
         (this.currentRecording.id != null && String(this.currentRecording.id) === strCallId)) &&
        this.audio && this.audio.src
      );

      if (isCurrent) {
        this.openPlayer();
        this.updateActiveRowHighlight(strCallId);
        if (autoPlay) {
          if (this.audio.paused) {
            const ap = window.audioPlayer || window.dmrAudioPlayer;
            if (ap) {
              if (typeof ap.ensureInitialized === "function") ap.ensureInitialized();
              if (ap.audioCtx && ap.audioCtx.state === "suspended") {
                ap.audioCtx.resume().catch(() => {});
              }
            }
            this.syncVolumeWithHotspot();
            this.audio.play().catch(e => console.warn("[RECORDINGS] Play error:", e));
            this.updatePlayState(true);
            this.startSmoothProgress();
          } else {
            this.audio.pause();
            this.updatePlayState(false);
            this.stopSmoothProgress();
          }
        }
        return;
      }

      this._pendingCallId = strCallId;
      this.openPlayer();
      this.updateActiveRowHighlight(strCallId);

      const targetRow = document.querySelector(`.live-call-row[data-id="${strCallId}"]`);
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }

      try {
        const resp = await fetch(`/api/recordings/call/${encodeURIComponent(strCallId)}`, { credentials: "same-origin" });
        // Guard: if user clicked another recording while fetch was in flight, discard this result
        if (this._pendingCallId !== strCallId) return;
        const data = await resp.json();
        if (data.found && data.recording) {
          this.recordedCallIds.add(strCallId);
          this.playRecording(data.recording, autoPlay);
        } else {
          this._pendingCallId = null;
          this.updateActiveRowHighlight();
          showToast(window.t ? window.t("player.not_found", {}, "Запись для этого вызова не найдена") : "Запись для этого вызова не найдена", 2500);
        }
      } catch (err) {
        this._pendingCallId = null;
        this.updateActiveRowHighlight();
        console.error("[RECORDINGS] Error fetching call recording:", err);
      }
    }

    async preloadRecordedCallIds() {
      try {
        const resp = await fetch("/api/recordings?limit=300", { credentials: "same-origin" });
        const data = await resp.json();
        if (data && data.recordings) {
          data.recordings.forEach(r => {
            if (r.call_id) this.recordedCallIds.add(r.call_id);
          });
          if (typeof renderLogList === "function") {
            renderLogList();
          }
        }
      } catch (_) {}
    }

    initQuotaLongPressMenu() {
      if (!this.quotaBar) return;
      let pressTimer = null;
      const startHold = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          pressTimer = null;
          if (this.quotaClearMenu) {
            this.quotaClearMenu.style.display = "flex";
          }
        }, 550);
      };
      const cancelHold = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };
      this.quotaBar.addEventListener("pointerdown", startHold);
      this.quotaBar.addEventListener("pointerup", cancelHold);
      this.quotaBar.addEventListener("pointerleave", cancelHold);
      this.quotaBar.addEventListener("pointercancel", cancelHold);
      this.quotaBar.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        cancelHold();
        if (this.quotaClearMenu) {
          this.quotaClearMenu.style.display = "flex";
        }
      });
      if (this.btnCancelQuotaClear) {
        this.btnCancelQuotaClear.onclick = (e) => {
          e.stopPropagation();
          if (this.quotaClearMenu) this.quotaClearMenu.style.display = "none";
        };
      }
      if (this.btnConfirmQuotaClear) {
        this.btnConfirmQuotaClear.onclick = async (e) => {
          e.stopPropagation();
          if (this.quotaClearMenu) this.quotaClearMenu.style.display = "none";
          await this.executeClearAllAudioOnly();
        };
      }
      document.addEventListener("click", (e) => {
        if (this.quotaClearMenu && this.quotaClearMenu.style.display !== "none") {
          if (!this.quotaClearMenu.contains(e.target) && (!this.quotaBar || !this.quotaBar.contains(e.target))) {
            this.quotaClearMenu.style.display = "none";
          }
        }
      });
    }

    async executeClearAllAudioOnly() {
      try {
        const resp = await fetch("/api/recordings/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({}),
        });
        const data = await resp.json();
        if (data.status === "ok") {
          showToast(window.t ? window.t("player.clear_all_success", { count: data.deleted_count || 0 }, `✓ Удалены все аудиозаписи (${data.deleted_count || 0})`) : `✓ Удалены все аудиозаписи (${data.deleted_count || 0})`, 2500);
          this.onRecordingsCleared();
        } else {
          showToast(window.t ? window.t("player.clear_all_err", {}, "⚠️ Ошибка очистки аудиозаписей") : "⚠️ Ошибка очистки аудиозаписей", 3000);
        }
      } catch (err) {
        console.error("[RECORDINGS] Error clearing audio files:", err);
        showToast(window.t ? window.t("player.clear_all_err", {}, "⚠️ Ошибка очистки аудиозаписей") : "⚠️ Ошибка очистки аудиозаписей", 3000);
      }
    }

    _resolveHsId(hid) {
      if (!hid) return "default";
      if (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") {
        return window.resolveHotspotId(hid);
      }
      return String(hid);
    }

    findHotspotCard(hid) {
      if (typeof document === "undefined" || !hid) return null;
      const cid = this._resolveHsId(hid);
      const exact = document.querySelector(`.radio-container[data-hotspot-id="${cid}"]`)
        || document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`);
      if (exact) return exact;
      const rc = document.getElementById("radioContainer");
      const hsList = (typeof window !== "undefined" && Array.isArray(window.currentHotspots)) ? window.currentHotspots : [];
      const firstHs = hsList[0];
      if (rc && firstHs && this._resolveHsId(firstHs.id) === cid && (!rc.dataset.hotspotId || rc.dataset.hotspotId === "default" || this._resolveHsId(rc.dataset.hotspotId) === cid)) {
        return rc;
      }
      return null;
    }

    isHotspotTxAvailable(h) {
      if (!h || h.hidden) return false;
      const cid = this._resolveHsId(h.id);
      const isCol = Boolean(
        (typeof window !== "undefined" && typeof window.isHotspotCollapsed === "function" && window.isHotspotCollapsed(cid)) ||
        h.collapsed === true
      );
      const isLive = Boolean(
        typeof window !== "undefined" && typeof window.isHotspotLiveCollapsed === "function" && window.isHotspotLiveCollapsed(cid)
      );
      if (isCol && !isLive) return false;
      const card = this.findHotspotCard(cid);
      if (card && card.classList.contains("collapsed") && !card.classList.contains("live-collapsed")) {
        return false;
      }
      const statusUp = String(h.status || "").trim().toUpperCase();
      const netLower = String(h.network_type || "bm").trim().toLowerCase();
      if (netLower === "ysf") {
        return Boolean(statusUp && !["OFFLINE", "DISCONNECTED", "STANDBY", "ERROR", "AUTH_FAILED"].includes(statusUp));
      }
      return statusUp === "ONLINE";
    }

    getEffectiveTxTarget() {
      const hsList = (typeof window !== "undefined" && Array.isArray(window.currentHotspots))
        ? window.currentHotspots.filter(h => h && !h.hidden)
        : [];
      const availList = hsList.filter(h => this.isHotspotTxAvailable(h));
      const pool = availList.length > 0 ? availList : hsList;

      const defaultHid = (window.currentLogHotspotId && window.currentLogHotspotId !== "all")
        ? window.currentLogHotspotId
        : (window.activeHotspotId || (pool[0] && pool[0].id) || "default");

      let hid = null;
      if (this.txTargetHotspotId && availList.some(h => String(h.id) === String(this.txTargetHotspotId))) {
        hid = String(this.txTargetHotspotId);
      } else if (availList.some(h => String(h.id) === String(defaultHid))) {
        hid = String(defaultHid);
      } else if (availList.length > 0) {
        hid = String(availList[0].id);
      } else {
        hid = String(defaultHid);
      }

      const hsObj = hsList.find(h => String(h.id) === hid) || hsList[0] || { id: hid, network_type: "bm" };
      const available = availList.length > 0 && this.isHotspotTxAvailable(hsObj);
      const net = String(hsObj.network_type || "bm").toLowerCase();
      const isSingleSlot = (net === "allstar" || net === "ysf" || net === "xlx");
      let slot = 2;
      if (net === "allstar" || net === "ysf") {
        slot = 1;
      } else if (net === "xlx") {
        slot = 2;
      } else if (this.txTargetSlot === 1 || this.txTargetSlot === 2) {
        slot = this.txTargetSlot;
      } else if (typeof window.getHotspotSlot === "function") {
        slot = window.getHotspotSlot(hid) || 2;
      }
      const tg = (typeof window.getHotspotTg === "function") ? (window.getHotspotTg(hid, slot) || 0) : 0;
      return { hid, hsObj, net, isSingleSlot, slot, tg, available };
    }

    updateTxTargetLabel() {
      if (!this.txTargetLabel) return;
      const { hid, net, isSingleSlot, slot, available } = this.getEffectiveTxTarget();
      const hsList = (typeof window !== "undefined" && Array.isArray(window.currentHotspots))
        ? window.currentHotspots.filter(h => h && !h.hidden)
        : [];
      const idx = hsList.findIndex(h => String(h.id) === String(hid));
      const numTag = idx >= 0 ? `#${idx + 1}` : `#1`;
      if (!available && hsList.length > 0) {
        this.txTargetLabel.textContent = `--`;
      } else if (isSingleSlot) {
        const netLabel = net === "allstar" ? "ASL" : (net === "ysf" ? "YSF" : "XLX");
        this.txTargetLabel.textContent = `${numTag}•${netLabel}`;
      } else {
        this.txTargetLabel.textContent = `${numTag}•TS${slot}`;
      }
      if (this.txToggleBtn) {
        this.txToggleBtn.classList.toggle("active", Boolean(this.isTxArmed));
        this.txToggleBtn.classList.toggle("transmitting", Boolean(this.isTxStreaming));
      }
    }

    renderTxTargetMenu() {
      if (!this.txHotspotList) return;
      const { hid, isSingleSlot, slot, available } = this.getEffectiveTxTarget();
      const hsList = (typeof window !== "undefined" && Array.isArray(window.currentHotspots))
        ? window.currentHotspots.filter(h => h && !h.hidden)
        : [];
      const disabledHint = window.t
        ? window.t("player.tx_hs_disabled_hint", {}, "Будет доступен только после подключения хотспота")
        : "Будет доступен только после подключения хотспота";
      this.txHotspotList.innerHTML = "";
      hsList.forEach((h, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const canTx = this.isHotspotTxAvailable(h);
        const isAct = canTx && available && String(h.id) === String(hid);
        btn.className = "rec-tx-hs-item" + (isAct ? " active" : "") + (canTx ? "" : " disabled");
        const netUp = String(h.network_type || "bm").toUpperCase();
        const nameStr = h.name || `Hotspot #${i + 1}`;
        if (!canTx) {
          btn.setAttribute("aria-disabled", "true");
          btn.title = disabledHint;
          btn.innerHTML = `<span>#${i + 1} ${nameStr}</span><span style="opacity:0.7;font-size:0.64rem;">🔒 ${netUp}</span>`;
        } else {
          btn.innerHTML = `<span>#${i + 1} ${nameStr}</span><span style="opacity:0.75;font-size:0.66rem;">${netUp}</span>`;
        }
        btn.onclick = (e) => {
          e.stopPropagation();
          if (!canTx) {
            showToast(`ℹ️ ${nameStr}: ${disabledHint}`, 2600);
            return;
          }
          if (this.isTxStreaming) {
            this.pause();
            this.stopRecordingTxStream();
          }
          this.txTargetHotspotId = String(h.id);
          this.txTargetSlot = null;
          this.updateTxTargetLabel();
          this.renderTxTargetMenu();
        };
        this.txHotspotList.appendChild(btn);
      });
      if (this.txSlotRow) {
        this.txSlotRow.style.display = (isSingleSlot || !available) ? "none" : "flex";
        this.txSlotRow.querySelectorAll(".rec-tx-slot-btn").forEach(b => {
          const s = parseInt(b.dataset.slot, 10);
          b.classList.toggle("active", s === slot);
          b.onclick = (e) => {
            e.stopPropagation();
            if (this.isTxStreaming) {
              this.pause();
              this.stopRecordingTxStream();
            }
            this.txTargetSlot = s;
            this.updateTxTargetLabel();
            this.renderTxTargetMenu();
          };
        });
      }
    }

    initTxControls() {
      if (this.txToggleBtn) {
        this.txToggleBtn.onclick = (e) => {
          e.stopPropagation();
          if (!this.isTxArmed) {
            const { available } = this.getEffectiveTxTarget();
            if (!available) {
              showToast(window.t ? window.t("player.tx_no_active_hotspot", {}, "⚠️ Нет подключённого активного хотспота для передачи") : "⚠️ Нет подключённого активного хотспота для передачи", 2800);
              return;
            }
          }
          this.isTxArmed = !this.isTxArmed;
          this.updateTxTargetLabel();
          if (this.isTxArmed && this.isPlaying()) {
            this.audio.playbackRate = 1.0;
            this.startRecordingTxStream();
          } else if (!this.isTxArmed && this.isTxStreaming) {
            this.stopRecordingTxStream();
          }
        };
      }
      if (this.txTargetBtn) {
        this.txTargetBtn.onclick = (e) => {
          e.stopPropagation();
          if (!this.txTargetMenu) return;
          const isOpen = this.txTargetMenu.style.display !== "none";
          if (isOpen) {
            this.txTargetMenu.style.display = "none";
          } else {
            this.renderTxTargetMenu();
            this.txTargetMenu.style.display = "flex";
          }
        };
      }
      document.addEventListener("click", (e) => {
        if (this.txTargetMenu && this.txTargetMenu.style.display !== "none") {
          if (!this.txTargetMenu.contains(e.target) && (!this.txTargetBtn || !this.txTargetBtn.contains(e.target))) {
            this.txTargetMenu.style.display = "none";
          }
        }
      });
      if (!this._recTxHooked && typeof window !== "undefined") {
        this._recTxHooked = true;
        const prevOnServerTxEnded = window.onServerTxEnded;
        window.onServerTxEnded = (msg) => {
          if (typeof prevOnServerTxEnded === "function") {
            prevOnServerTxEnded(msg);
          }
          if (msg && String(msg.client_id || "").startsWith("rec_tx_")) {
            this.onServerRecTxEnded(msg);
          }
        };
      }
      const liveMonitorPanel = document.getElementById("liveMonitorPanel");
      if (liveMonitorPanel && typeof MutationObserver !== "undefined") {
        const obs = new MutationObserver(() => {
          if (liveMonitorPanel.classList.contains("hidden") || liveMonitorPanel.style.display === "none") {
            this.resetTxState();
          }
        });
        obs.observe(liveMonitorPanel, { attributes: true, attributeFilter: ["class", "style"] });
      }
    }

    onServerRecTxEnded(msg) {
      if (!this.isTxStreaming && !this._activeTxVisualState) return;
      if (this._txMaxDurationTimer) {
        clearTimeout(this._txMaxDurationTimer);
        this._txMaxDurationTimer = null;
      }
      this.isTxStreaming = false;
      this.clearRecTxCardVisuals();
      this.updateTxTargetLabel();
    }

    _updateRecTxBadgeCountdown(sec) {
      const st = this._activeTxVisualState;
      if (!st) return;
      const rem = Math.max(0, Math.round(sec));
      if (typeof window !== "undefined") {
        window.activeRecTxRemSec = rem;
      }
      const targetCard = this.findHotspotCard(st.hid);
      const mb = targetCard ? targetCard.querySelector(".mode-badge") : null;
      if (mb) {
        let extraCls = "";
        if (rem <= 10) {
          extraCls = " mode-tx-critical";
        } else if (rem <= 30) {
          extraCls = " mode-tx-warn";
        }
        mb.className = `mode-badge mode-tx${extraCls}`;
        mb.textContent = st.isSingleChannel ? `TX ${rem}s` : `TX TS${st.slot} ${rem}s`;
      }
      if (typeof window !== "undefined" && typeof window.refreshToolbarProcessIndicators === "function") {
        window.refreshToolbarProcessIndicators();
      }
    }

    applyRecTxCardVisuals(hid, slot, tg, maxDurSec = 60) {
      this.clearRecTxCardVisuals();
      const cid = this._resolveHsId(hid);
      const hsList = (typeof window !== "undefined" && Array.isArray(window.currentHotspots)) ? window.currentHotspots : [];
      const hs = hsList.find(h => this._resolveHsId(h.id) === cid || String(h.id) === String(hid)) || null;
      const targetCard = this.findHotspotCard(cid);
      const net = String((hs && hs.network_type) || (targetCard && targetCard.dataset.networkType) || "bm").toLowerCase();
      const isAsl = Boolean(net === "allstar" || (targetCard && targetCard.classList.contains("card-net-allstar")));
      const isYsf = Boolean(net === "ysf" || (targetCard && targetCard.classList.contains("card-net-ysf")));
      const isSingleChannel = isAsl || isYsf;
      const remInit = Math.max(1, Math.round(maxDurSec || 60));

      this._activeTxVisualState = { hid: cid, rawHid: hid, slot, tg, net, isAsl, isYsf, isSingleChannel };
      if (typeof window !== "undefined") {
        window.activeRecTxHotspotId = cid;
        window.activeRecTxSlot = slot;
        window.activeRecTxRemSec = remInit;
      }

      if (targetCard) {
        const pttBtn = targetCard.querySelector(".ptt-button");
        if (pttBtn) {
          pttBtn.classList.add("active");
          pttBtn.classList.remove("tx-slot-1", "tx-slot-2");
          pttBtn.classList.add(`tx-slot-${slot}`);
        }
        if (typeof window !== "undefined" && typeof window.updateCardPttHintForSlot === "function") {
          window.updateCardPttHintForSlot(targetCard, slot);
        }

        this._updateRecTxBadgeCountdown(remInit);

        if (isAsl) {
          if (hs) hs._aslUserTxActive = true;
          if (typeof window !== "undefined" && typeof window.renderAslNodeDashboard === "function") {
            window.renderAslNodeDashboard(cid);
          }
          const badge = document.getElementById(`allstarStatusBadge_${cid}`) || document.getElementById(`allstarStatusBadge_${hid}`);
          if (badge) {
            badge.className = "allstar-status-badge status-tx";
            badge.textContent = "TX";
          }
        } else {
          if (isYsf) {
            const ysfRow = targetCard.querySelector(".vfo-ysf-row");
            if (ysfRow) ysfRow.classList.add("vfo-tx-active");
            if (hs && typeof window !== "undefined" && typeof window.updateYsfVfoHeader === "function") {
              window.updateYsfVfoHeader(targetCard, hs);
            }
          }
          const txRow = targetCard.querySelector(slot === 1 ? ".vfo-ts1-row" : ".vfo-ts2-row");
          if (txRow) {
            txRow.classList.remove("vfo-rx-active", "vfo-last-caller-dimmed");
            txRow.classList.add("vfo-tx-active");
            const callerFlag = txRow.querySelector(".ts-caller-flag");
            const callerCall = txRow.querySelector(".ts-caller-call");
            const callerId = txRow.querySelector(".ts-caller-id");
            const callerCountry = txRow.querySelector(".ts-caller-country");
            const callerMapBtn = txRow.querySelector(".btn-caller-map");
            const tgFlagEl = txRow.querySelector(".ts-tg-flag");
            const tgTextEl = txRow.querySelector(".ts-tg-text");

            const myCall = (hs && hs.callsign) || "N0CALL";
            const myId = (hs && (hs.effective_id || hs.dmr_id)) || 0;
            const myCountry = getCountryInfo(myId, myCall);

            if (callerFlag) {
              updateFlagElement(callerFlag, myCountry);
              callerFlag.style.filter = "none";
            }
            if (callerCall) {
              delete callerCall.dataset.standby;
              callerCall.style.filter = "none";
              callerCall.classList.add("caller-active");
              callerCall.textContent = `${myCall} (TX)`;
            }
            if (callerMapBtn) callerMapBtn.style.display = "none";
            if (callerId) {
              callerId.style.filter = "none";
              callerId.textContent = myId ? `(${myId})` : "";
            }
            if (callerCountry) {
              callerCountry.style.filter = "none";
              callerCountry.textContent = (myCountry && (myCountry.name || myCountry.name_en)) || "";
            }
            if (tg > 0 && tgTextEl) {
              const rawTgName = isYsf
                ? ((hs && (hs.ysf_room_name || hs.ysf_name)) || `YSF #${tg}`)
                : (getNetworkRawTgName(tg, net) || (tg === 9990 ? "Parrot / Echo" : ""));
              if (tgFlagEl) {
                const isNonMcc = (net === "tgif" || net === "xlx");
                const tgCInfo = isYsf
                  ? { name: "YSF", name_en: "YSF", flag: "🌐" }
                  : (isNonMcc ? { name: net.toUpperCase(), name_en: net.toUpperCase(), flag: "🌐" } : getCountryInfo(tg));
                updateFlagElement(tgFlagEl, tgCInfo, !isYsf && tg === 9990);
                tgFlagEl.style.filter = "none";
              }
              const tgPrefix = isYsf ? "#" : ((tg === 9990 || tg > 999999) ? "Call" : "TG");
              tgTextEl.innerHTML = renderTgTextHtml(tg, tgPrefix, rawTgName, "", isYsf ? "ysf" : net);
              tgTextEl.style.filter = "none";
            }
          }
          const rxTag = targetCard.querySelector(slot === 1 ? ".vfo-ts1-rx" : ".vfo-ts2-rx");
          if (rxTag) rxTag.classList.remove("active");
          const txTag = targetCard.querySelector(slot === 1 ? ".vfo-ts1-tx" : ".vfo-ts2-tx");
          if (txTag) txTag.classList.add("active");
        }
      }

      if (typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.updateRadioStatus === "function") {
        try {
          const myCall = (hs && hs.callsign) || "ProxDMR";
          if (isYsf) {
            window.AndroidBridge.updateRadioStatus(tg ? `TX: ${myCall} -> #${tg}` : `TX: ${myCall}`);
          } else if (isAsl) {
            window.AndroidBridge.updateRadioStatus(`TX: ${myCall}`);
          } else {
            const isPriv = (tg === 9990 || tg > 999999);
            window.AndroidBridge.updateRadioStatus(`TX: ${myCall} (TS${slot} -> ${isPriv ? "ID" : "TG"}${tg})`);
          }
        } catch (_) {}
      }

      if (typeof window !== "undefined" && typeof window.updateAllHotspotRecUI === "function") {
        try { window.updateAllHotspotRecUI(); } catch (_) {}
      }

      if (this._txCountdownInterval) {
        clearInterval(this._txCountdownInterval);
      }
      let rem = remInit;
      this._txCountdownInterval = setInterval(() => {
        if (!this.isTxStreaming || !this._activeTxVisualState) {
          clearInterval(this._txCountdownInterval);
          this._txCountdownInterval = null;
          return;
        }
        rem = Math.max(0, rem - 1);
        this._updateRecTxBadgeCountdown(rem);
      }, 1000);
    }

    updateRecTxVuMeter() {
      const stInfo = this._activeTxVisualState;
      if (!stInfo || !this.audio || typeof window === "undefined" || typeof window.getVuState !== "function") return;
      const ap = window.audioPlayer || window.dmrAudioPlayer;
      if (!ap || typeof ap.attachRecordingsAudio !== "function") return;
      const attached = this.audio._webaudioAttachedNode || ap.attachRecordingsAudio(this.audio);
      if (!attached || !attached.sourceNode || !ap.audioCtx) return;

      if (!this._recTxAnalyser || this._recTxAnalyserCtx !== ap.audioCtx) {
        try {
          const an = ap.audioCtx.createAnalyser();
          an.fftSize = 512;
          attached.sourceNode.connect(an);
          this._recTxAnalyser = an;
          this._recTxAnalyserCtx = ap.audioCtx;
          this._recTxTimeBuf = (typeof an.getFloatTimeDomainData === "function") ? new Float32Array(an.fftSize) : null;
          this._recTxByteBuf = this._recTxTimeBuf ? null : new Uint8Array(an.fftSize);
        } catch (_) {
          return;
        }
      }

      let sumSq = 0;
      let len = 0;
      if (this._recTxTimeBuf && typeof this._recTxAnalyser.getFloatTimeDomainData === "function") {
        this._recTxAnalyser.getFloatTimeDomainData(this._recTxTimeBuf);
        len = this._recTxTimeBuf.length;
        for (let i = 0; i < len; i++) {
          const s = this._recTxTimeBuf[i];
          sumSq += s * s;
        }
      } else if (this._recTxByteBuf) {
        this._recTxAnalyser.getByteTimeDomainData(this._recTxByteBuf);
        len = this._recTxByteBuf.length;
        for (let i = 0; i < len; i++) {
          const s = (this._recTxByteBuf[i] - 128) / 128.0;
          sumSq += s * s;
        }
      }
      const rawRms = len > 0 ? Math.sqrt(sumSq / len) : 0;
      const pct = Math.min(100, Math.round(Math.pow(rawRms * 2.5, 0.75) * 100));

      const vuSlot = stInfo.isSingleChannel ? 1 : (stInfo.slot === 2 ? 2 : 1);
      const vuKey = stInfo.rawHid || stInfo.hid || "default";
      const vuSt = window.getVuState(vuKey, vuSlot);
      if (vuSt) {
        vuSt.mode = "TX";
        vuSt.target = pct;
        if (pct > vuSt.current) vuSt.current = pct;
        if (pct >= vuSt.peak) {
          vuSt.peak = pct;
          vuSt.peakHoldUntil = performance.now() + 650;
        }
      }
      if (stInfo.hid && stInfo.hid !== vuKey) {
        const vuStAlias = window.getVuState(stInfo.hid, vuSlot);
        if (vuStAlias) {
          vuStAlias.mode = "TX";
          vuStAlias.target = pct;
          if (pct > vuStAlias.current) vuStAlias.current = pct;
          if (pct >= vuStAlias.peak) {
            vuStAlias.peak = pct;
            vuStAlias.peakHoldUntil = performance.now() + 650;
          }
        }
      }
      if (typeof window.ensureVuMeterLoop === "function") {
        window.ensureVuMeterLoop();
      }
    }

    clearRecTxCardVisuals() {
      if (this._txCountdownInterval) {
        clearInterval(this._txCountdownInterval);
        this._txCountdownInterval = null;
      }
      const stInfo = this._activeTxVisualState;
      this._activeTxVisualState = null;

      if (typeof window !== "undefined") {
        window.activeRecTxHotspotId = null;
        window.activeRecTxSlot = null;
        window.activeRecTxRemSec = null;
      }
      if (!stInfo) return;

      const { hid, rawHid, slot, isAsl, isSingleChannel } = stInfo;
      const hsList = (typeof window !== "undefined" && Array.isArray(window.currentHotspots)) ? window.currentHotspots : [];
      const hs = hsList.find(h => this._resolveHsId(h.id) === hid || String(h.id) === String(rawHid)) || null;
      if (hs && hs._aslUserTxActive) {
        hs._aslUserTxActive = false;
        if (typeof window !== "undefined" && typeof window.renderAslNodeDashboard === "function") {
          window.renderAslNodeDashboard(hid);
        }
      }
      const aslBadge = document.getElementById(`allstarStatusBadge_${hid}`) || document.getElementById(`allstarStatusBadge_${rawHid}`);
      const targetCard = this.findHotspotCard(hid) || this.findHotspotCard(rawHid);
      if (aslBadge) {
        const isOnline = targetCard && (targetCard.dataset.status === "online" || targetCard.dataset.status === "ONLINE");
        aslBadge.className = isOnline ? "allstar-status-badge status-online" : "allstar-status-badge status-idle";
        aslBadge.textContent = isOnline ? "CONNECTED" : "IDLE";
      }

      if (targetCard) {
        const pttBtn = targetCard.querySelector(".ptt-button");
        if (pttBtn && !(typeof window !== "undefined" && window.isPttPressed)) {
          pttBtn.classList.remove("active", "tx-slot-1", "tx-slot-2");
        }
        targetCard.querySelectorAll(".vfo-row").forEach(r => r.classList.remove("vfo-tx-active"));
        targetCard.querySelectorAll(".vfo-tx-tag").forEach(t => t.classList.remove("active"));
        if (typeof window !== "undefined" && typeof window.updateCardPttHint === "function") {
          window.updateCardPttHint(targetCard);
        }
        if (typeof window !== "undefined" && typeof window.updateCardTgDisplay === "function") {
          window.updateCardTgDisplay(targetCard);
        }
        if (typeof window !== "undefined" && typeof window.updateCardModeBadge === "function") {
          window.updateCardModeBadge(targetCard);
        }
      }

      if (typeof window !== "undefined" && typeof window.getVuState === "function") {
        const vuSlot = isSingleChannel ? 1 : (slot === 2 ? 2 : 1);
        [rawHid, hid].filter(Boolean).forEach(k => {
          const vuSt = window.getVuState(k, vuSlot);
          if (vuSt) {
            vuSt.mode = "IDLE";
            vuSt.target = 0;
          }
        });
        if (typeof window.ensureVuMeterLoop === "function") {
          window.ensureVuMeterLoop();
        }
      }

      if (typeof window !== "undefined" && typeof window.updateAllHotspotRecUI === "function") {
        try { window.updateAllHotspotRecUI(); } catch (_) {}
      }
      if (typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.updateRadioStatus === "function" && !(window.isPttPressed)) {
        try {
          window.AndroidBridge.updateRadioStatus(window.t ? window.t("gw.standby_status", {}, "Дежурный прием (Standby)") : "Дежурный прием (Standby)");
        } catch (_) {}
      }
    }

    async startRecordingTxStream() {
      if (!this.isTxArmed || !this.currentRecording) return;
      const recId = this.currentRecording.id || this.currentRecording.call_id;
      if (!recId) return;
      const target = this.getEffectiveTxTarget();
      if (!target.available) {
        this.isTxStreaming = false;
        this.clearRecTxCardVisuals();
        this.updateTxTargetLabel();
        showToast(window.t ? window.t("player.tx_no_active_hotspot", {}, "⚠️ Нет подключённого активного хотспота для передачи") : "⚠️ Нет подключённого активного хотспота для передачи", 2800);
        return;
      }
      if (this._txMaxDurationTimer) {
        clearTimeout(this._txMaxDurationTimer);
        this._txMaxDurationTimer = null;
      }
      const { hid, slot, tg } = target;
      const offsetSec = (this.audio && this.audio.currentTime) ? this.audio.currentTime : 0;
      this.isTxStreaming = true;
      this.applyRecTxCardVisuals(hid, slot, tg, 60);
      this.updateTxTargetLabel();

      // 60-second anti-trash continuous TX limit
      this._txMaxDurationTimer = setTimeout(() => {
        this._txMaxDurationTimer = null;
        if (this.isTxStreaming) {
          this.pause();
          this.stopRecordingTxStream();
          showToast(window.t ? window.t("player.tx_limit_60s", {}, "⏱️ Защита эфира: передача записи ограничена 1 минутой") : "⏱️ Защита эфира: передача записи ограничена 1 минутой", 3500);
        }
      }, 60000);

      try {
        const resp = await fetch(`/api/recordings/${encodeURIComponent(recId)}/tx/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            hotspot_id: hid,
            slot: slot,
            dst_id: tg,
            offset_sec: offsetSec,
            max_duration_sec: 60.0
          })
        });
        if (!resp.ok) {
          let errMsg = window.t ? window.t("player.tx_start_err", {}, "⚠️ Не удалось запустить передачу записи") : "⚠️ Не удалось запустить передачу записи";
          try {
            const errData = await resp.json();
            if (errData && errData.detail) errMsg = `⚠️ ${errData.detail}`;
          } catch (_) {}
          this.isTxStreaming = false;
          this.clearRecTxCardVisuals();
          this.updateTxTargetLabel();
          showToast(errMsg, 3000);
        } else {
          try {
            const okData = await resp.json();
            if (okData && okData.status === "ok" && okData.dst_id && this._activeTxVisualState && okData.dst_id !== tg) {
              this.applyRecTxCardVisuals(okData.hotspot_id || hid, okData.slot || slot, okData.dst_id, okData.max_duration_sec || 60);
            }
          } catch (_) {}
        }
      } catch (err) {
        console.error("[REC_TX] Start error:", err);
        this.isTxStreaming = false;
        this.clearRecTxCardVisuals();
        this.updateTxTargetLabel();
      }
    }

    async stopRecordingTxStream() {
      if (this._txMaxDurationTimer) {
        clearTimeout(this._txMaxDurationTimer);
        this._txMaxDurationTimer = null;
      }
      const wasStreaming = this.isTxStreaming;
      this.isTxStreaming = false;
      this.clearRecTxCardVisuals();
      this.updateTxTargetLabel();
      if (!wasStreaming) return;
      try {
        await fetch("/api/recordings/tx/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin"
        });
      } catch (_) {}
    }

    resetTxState() {
      if (this.isTxStreaming) {
        this.stopRecordingTxStream();
      } else {
        this.clearRecTxCardVisuals();
      }
      if (this._txMaxDurationTimer) {
        clearTimeout(this._txMaxDurationTimer);
        this._txMaxDurationTimer = null;
      }
      this.isTxArmed = false;
      this.txTargetHotspotId = null;
      this.txTargetSlot = null;
      if (this.txTargetMenu) {
        this.txTargetMenu.style.display = "none";
      }
      this.updateTxTargetLabel();
    }

    async loadStats() {
      try {
        const resp = await fetch("/api/recordings/stats", { credentials: "same-origin" });
        const stats = await resp.json();
        if (this.quotaBadge) {
          const rawUsed = typeof stats.used_mb === "number" ? stats.used_mb : (parseFloat(stats.used_mb) || 0);
          const used = rawUsed >= 10 ? Math.round(rawUsed) : Number(rawUsed.toFixed(1));
          const rawPct = (typeof stats.quota_percent === "number" ? stats.quota_percent : parseFloat(stats.quota_percent)) || 0;
          const pct = Math.round(Math.max(0, Math.min(100, rawPct)));
          const text = `${used} MB (${pct}%)`;
          this.quotaBadge.textContent = text;
          if (this.quotaBadgeFilled) {
            this.quotaBadgeFilled.textContent = text;
          }
          if (this.quotaFill) {
            this.quotaFill.style.width = pct + "%";
          }
        }

        if (typeof stats.auto_record === "boolean" && typeof window !== "undefined") {
          window.__proxdmrGlobalAutoRecord = stats.auto_record;
          window.__proxdmrRecSettingsLoaded = true;
        }
        if (typeof stats.session_active === "boolean") {
          this.isSessionActive = stats.session_active;
        }
        if (typeof stats.recording_active === "boolean") {
          this.isAutoRecordingActive = stats.recording_active && !this.isSessionActive;
        }
        this.updateMasterRecIndicator();
        if (this.isSessionActive) {
          if (!this.sessionTimerInterval) {
            this.sessionStartTime = Date.now() / 1000;
          }
        }
      } catch (_) {}
    }

    _populateSettingsForm(s) {
      if (!s) return;
      if (s.auto_record !== undefined && typeof window !== "undefined") {
        window.__proxdmrGlobalAutoRecord = Boolean(s.auto_record);
        window.__proxdmrRecSettingsLoaded = true;
      }
      if (this.optAutoRecord && s.auto_record !== undefined) this.optAutoRecord.checked = Boolean(s.auto_record);
      if (this.optSeamBeep && s.seam_beep !== undefined) this.optSeamBeep.checked = Boolean(s.seam_beep);
      if (this.inputSeamBeepPattern && s.seam_beep_pattern !== undefined) {
        this.inputSeamBeepPattern.value = s.seam_beep_pattern || DEFAULT_ROGER_BEEP_PATTERN;
      }
      if (this.inputSeamBeepPattern && this.optSeamBeep) {
        this.inputSeamBeepPattern.style.opacity = this.optSeamBeep.checked ? "1" : "0.55";
      }
      if (this.optAutoCleanup && s.auto_cleanup !== undefined) this.optAutoCleanup.checked = Boolean(s.auto_cleanup);
      if (this.inputMinDuration && s.min_duration_sec !== undefined) this.inputMinDuration.value = s.min_duration_sec;
      if (this.inputQuotaGb) {
        const gbVal = (s.max_storage_gb !== undefined) ? s.max_storage_gb : (s.max_storage_mb ? (s.max_storage_mb / 1024).toFixed(1) : 2.0);
        this.inputQuotaGb.value = gbVal;
      }
    }

    async openSettingsModal() {
      if (!this.settingsModal) return;
      this.settingsModal.style.display = "flex";
      this.settingsModal.classList.add("active");
      // Pre-fill immediately from local cache if present
      try {
        const cached = localStorage.getItem("proxdmr_rec_settings");
        if (cached) {
          const cs = JSON.parse(cached);
          if (cs) this._populateSettingsForm(cs);
        }
      } catch (_) {}

      try {
        const resp = await fetch("/api/recordings/settings", { credentials: "same-origin" });
        const data = await resp.json();
        if (data.status === "ok" && data.settings) {
          const s = data.settings;
          this._populateSettingsForm(s);
          try {
            localStorage.setItem("proxdmr_rec_settings", JSON.stringify(s));
          } catch (_) {}
        }
      } catch (err) {
        console.warn("[RECORDINGS] Failed to fetch settings:", err);
      }
    }

    closeSettingsModal() {
      stopLocalRogerBeep();
      if (this.settingsModal) {
        this.settingsModal.style.display = "none";
        this.settingsModal.classList.remove("active");
      }
    }

    async saveSettings() {
      const payload = {
        auto_record: this.optAutoRecord ? this.optAutoRecord.checked : true,
        seam_beep: this.optSeamBeep ? this.optSeamBeep.checked : true,
        seam_beep_pattern: this.inputSeamBeepPattern ? this.inputSeamBeepPattern.value.trim() : DEFAULT_ROGER_BEEP_PATTERN,
        auto_cleanup: this.optAutoCleanup ? this.optAutoCleanup.checked : true,
        min_duration_sec: this.inputMinDuration ? (parseFloat(this.inputMinDuration.value) || 0.5) : 0.5,
        max_storage_gb: this.inputQuotaGb ? (parseFloat(this.inputQuotaGb.value) || 2.0) : 2.0,
      };

      if (typeof window !== "undefined") {
        window.__proxdmrGlobalAutoRecord = Boolean(payload.auto_record);
        window.__proxdmrRecSettingsLoaded = true;
      }
      try {
        localStorage.setItem("proxdmr_rec_settings", JSON.stringify(payload));
      } catch (_) {}
      this.updateMasterRecIndicator();

      try {
        const resp = await fetch("/api/recordings/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
        const res = await resp.json();
        if (res.status === "ok") {
          showToast(window.t ? window.t("player.settings_saved", {}, "✓ Recording settings saved") : "✓ Recording settings saved", 2500);
          this.closeSettingsModal();
          this.loadStats();
        } else {
          showToast(window.t ? window.t("player.settings_save_err", {}, "⚠️ Error saving settings") : "⚠️ Error saving settings", 3000);
        }
      } catch (err) {
        console.error("[RECORDINGS] Error saving settings:", err);
        showToast(window.t ? window.t("player.settings_save_err", {}, "⚠️ Error saving settings") : "⚠️ Error saving settings", 3000);
      }
    }

    // Master REC (R Button)
    updateMasterRecIndicator() {
      if (typeof updateAllHotspotRecUI === "function") {
        updateAllHotspotRecUI();
      }
      if (typeof window !== "undefined" && typeof window.refreshToolbarProcessIndicators === "function") {
        window.refreshToolbarProcessIndicators();
      }
    }

    onRecordingStateChanged(msg) {
      if (!msg) return;
      if (!window.activeRecordingHotspotIds) {
        window.activeRecordingHotspotIds = new Set();
      }
      window.activeRecordingHotspotIds.clear();

      if (Array.isArray(msg.recording_hotspots)) {
        msg.recording_hotspots.forEach(hid => {
          window.activeRecordingHotspotIds.add(window.resolveHotspotId(hid));
          window.activeRecordingHotspotIds.add(String(hid));
        });
      } else if (msg.active && (msg.rx_active || msg.tx_active)) {
        const defaultHid = (currentHotspots && currentHotspots[0] && currentHotspots[0].id) || "default";
        window.activeRecordingHotspotIds.add(window.resolveHotspotId(defaultHid));
        window.activeRecordingHotspotIds.add("default");
      }

      this.isAutoRecordingActive = Boolean(msg.rx_active || msg.tx_active);
      if (typeof msg.session_active === "boolean") {
        this.isSessionActive = msg.session_active;
      }
      this.updateMasterRecIndicator();
    }

    async toggleMasterRecording() {
      const isCurrentlyRecording = this.isSessionActive || (this.masterRecBtn && this.masterRecBtn.classList.contains("recording"));
      const action = isCurrentlyRecording ? "stop" : "start";

      // Send via WebSocket if open, else fallback to REST
      if (typeof ws !== "undefined" && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "toggle_recording_session", action: action }));
      } else {
        try {
          const resp = await fetch("/api/recordings/session/toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: action }),
          });
          const res = await resp.json();
          if (res.status === "ok") {
            if (res.action === "started") {
              this.onSessionStateChanged({ active: true, session: res.session });
            } else {
              this.onSessionStateChanged({ active: false, saved_recording: res.saved });
            }
          }
        } catch (err) {
          console.error(err);
        }
      }
    }

    onSessionStateChanged(msg) {
      this.isSessionActive = Boolean(msg.active);
      this.updateMasterRecIndicator();

      if (msg.active) {
        if (this.masterRecTimer) {
          this.masterRecTimer.style.display = "none";
        }
        this.sessionStartTime = (msg.session && msg.session.start_time) ? (msg.session.start_time * 1000) : Date.now();
        if (this.sessionTimerInterval) clearInterval(this.sessionTimerInterval);
        this.sessionTimerInterval = setInterval(() => {
          const elapsedSec = Math.floor((Date.now() - this.sessionStartTime) / 1000);
          if (this.masterRecTimer) {
            this.masterRecTimer.textContent = this.formatTime(elapsedSec);
          }
        }, 1000);
        showToast(window.t ? window.t("player.rec_started", {}, "● Запись разговора (R) запущена") : "● Запись разговора (R) запущена", 2500);
      } else {
        if (this.masterRecTimer) {
          this.masterRecTimer.style.display = "none";
          this.masterRecTimer.textContent = "00:00";
        }
        if (this.sessionTimerInterval) {
          clearInterval(this.sessionTimerInterval);
          this.sessionTimerInterval = null;
        }
        if (msg.saved_recording) {
          showToast(window.t ? window.t("player.rec_saved", { duration: this.formatTime(msg.saved_recording.duration) }, `✓ Сессия разговора сохранена (${this.formatTime(msg.saved_recording.duration)})`) : `✓ Сессия разговора сохранена (${this.formatTime(msg.saved_recording.duration)})`, 3500);
          this.recordedCallIds.add(msg.saved_recording.call_id);
          this.loadRecordings(0);
          this.loadStats();
        } else {
          showToast(window.t ? window.t("player.rec_stopped", {}, "Запись разговора остановлена") : "Запись разговора остановлена", 2500);
        }
      }
    }

    onRecordingSaved(rec, callId) {
      if (!rec) return;
      const cid = callId || rec.call_id;
      if (cid) {
        this.recordedCallIds.add(cid);

        // Update Last Heard row in real time!
        const rows = document.querySelectorAll(`.live-call-row[data-id="${cid}"]`);
        rows.forEach(row => {
          const playCells = row.querySelectorAll(".cell-play");
          playCells.forEach(cell => {
            if (cell && !cell.querySelector(".log-play-btn")) {
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = "log-play-btn";
              btn.dataset.callId = cid;
              btn.title = window.t ? window.t("recordings.play_tooltip", {}, "Прослушать запись") : "Прослушать запись";
              btn.innerHTML = `<img src="/static/img/Log_PLAY.png" class="log-play-img" alt="Play">`;
              btn.onclick = (e) => {
                e.stopPropagation();
                this.playByCallId(cid);
              };
              cell.appendChild(btn);
            }
          });
        });
      }

      this.loadStats();
    }
  }







