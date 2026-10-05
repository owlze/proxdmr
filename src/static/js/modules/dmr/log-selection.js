/**
 * ProxDMR - Log Multiple & Range Selection Subsystem
 * Handles batch selection of calls history items (Ctrl+click, Shift+click, mobile long-press, A-B range mode),
 * selection action toolbar, mini context menu, and batch delete/download/transcribe actions.
 */

import { showToast } from '../core/toast.js';

class LogSelectionManager {
  constructor() {
    this.selectedIds = new Set();
    this.lastAnchorId = null;
    this.isRangeMode = false;
    this.isSelectionActive = false;

    this.toolbar = null;
    this.countEl = null;
    this.btnAll = null;
    this.btnRange = null;
    this.btnClear = null;

    this.miniMenu = null;
    this.btnMenuDelete = null;
    this.btnMenuDownload = null;
    this.btnMenuTranscribe = null;
    this.btnMenuCancel = null;

    this._longPressTimer = null;
    this._longPressCoords = { x: 0, y: 0 };
    this._longPressTargetEl = null;
    this._justLongPressed = false;
    this._isTouchScrolling = false;

    this._boundOnPointerDown = this._onPointerDown.bind(this);
    this._boundOnPointerMove = this._onPointerMove.bind(this);
    this._boundOnPointerUp = this._onPointerUp.bind(this);
    this._boundOnClick = this._onClick.bind(this);
    this._boundOnContextMenu = this._onContextMenu.bind(this);
  }

  init() {
    this.toolbar = document.getElementById("logSelectionToolbar");
    this.countEl = document.getElementById("logSelectedCount");
    this.btnAll = document.getElementById("btnLogSelectAll");
    this.btnRange = document.getElementById("btnLogSelectRange");
    this.btnClear = document.getElementById("btnLogSelectClear");

    this.miniMenu = document.getElementById("logMiniContextMenu");
    this.btnMenuDelete = document.getElementById("btnMenuDelete");
    this.btnMenuDownload = document.getElementById("btnMenuDownload");
    this.btnMenuTranscribe = document.getElementById("btnMenuTranscribe");
    this.btnMenuCancel = document.getElementById("btnMenuCancel");

    if (this.btnAll) {
      this.btnAll.onclick = (e) => {
        e.stopPropagation();
        this.toggleSelectAll();
      };
    }

    if (this.btnRange) {
      this.btnRange.onclick = (e) => {
        e.stopPropagation();
        this.toggleRangeMode();
      };
    }

    if (this.btnClear) {
      this.btnClear.onclick = (e) => {
        e.stopPropagation();
        this.clearSelection();
      };
    }

    const countBadge = this.toolbar ? this.toolbar.querySelector(".sel-count-badge") : null;
    if (countBadge) {
      countBadge.style.cursor = "pointer";
      countBadge.title = window.t ? window.t("log_sel.actions_title") : "Нажмите для вызова действий с выбранными";
      countBadge.onclick = (e) => {
        e.stopPropagation();
        if (this.selectedIds.size > 0) {
          const rect = countBadge.getBoundingClientRect();
          this.showMiniMenu(rect.left + rect.width / 2, rect.bottom + 12);
        }
      };
    }

    if (this.btnMenuDelete) {
      this.btnMenuDelete.onclick = (e) => {
        e.stopPropagation();
        this.hideMiniMenu();
        this.deleteSelected();
      };
    }

    if (this.btnMenuDownload) {
      this.btnMenuDownload.onclick = (e) => {
        e.stopPropagation();
        this.hideMiniMenu();
        this.downloadSelected();
      };
    }

    if (this.btnMenuTranscribe) {
      this.btnMenuTranscribe.onclick = (e) => {
        e.stopPropagation();
        this.hideMiniMenu();
        this.transcribeSelected();
      };
    }

    if (this.btnMenuCancel) {
      this.btnMenuCancel.onclick = (e) => {
        e.stopPropagation();
        this.clearSelection();
      };
    }

    // Escape key listener: cancel selection session and hide mini-menu
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if ((this.miniMenu && this.miniMenu.style.display !== "none") || this.isSelectionActive) {
          e.preventDefault();
          e.stopPropagation();
          this.clearSelection();
        }
      }
    });

    // Close mini menu on click outside
    document.addEventListener("pointerdown", (e) => {
      if (this.miniMenu && this.miniMenu.style.display !== "none") {
        if (!this.miniMenu.contains(e.target)) {
          this.hideMiniMenu();
        }
      }
    });

    // Close log button or log panel hiding: cancel selection session and clear all selected items
    const closeLogBtn = document.getElementById("closeLogBtn");
    if (closeLogBtn) {
      closeLogBtn.addEventListener("click", () => {
        this.clearSelection();
      });
    }

    const liveMonitorPanel = document.getElementById("liveMonitorPanel");
    if (liveMonitorPanel && typeof window.MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => {
        const isHidden = liveMonitorPanel.classList.contains("hidden") ||
                         liveMonitorPanel.style.display === "none";
        if (isHidden && (this.isSelectionActive || this.selectedIds.size > 0)) {
          this.clearSelection();
        }
      });
      observer.observe(liveMonitorPanel, { attributes: true, attributeFilter: ["class", "style"] });
    }

    // Attach delegated events to log table content
    const tableContent = document.getElementById("logTableContent");
    if (tableContent) {
      tableContent.addEventListener("pointerdown", this._boundOnPointerDown, { passive: false });
      tableContent.addEventListener("pointermove", this._boundOnPointerMove, { passive: true });
      tableContent.addEventListener("pointerup", this._boundOnPointerUp, { passive: true });
      tableContent.addEventListener("pointercancel", this._boundOnPointerUp, { passive: true });
      tableContent.addEventListener("click", this._boundOnClick, true);
      tableContent.addEventListener("contextmenu", this._boundOnContextMenu);
    }
  }

  hasSelection() {
    return this.selectedIds.size > 0;
  }

  getSelectedIds() {
    return Array.from(this.selectedIds);
  }

  getSelectionCount() {
    return this.selectedIds.size;
  }

  clearSelection() {
    this.selectedIds.clear();
    this.lastAnchorId = null;
    this.isRangeMode = false;
    this.isSelectionActive = false;
    this.hideMiniMenu();
    this.updateUI();
  }

  _getAllRenderedRowIds() {
    const rows = document.querySelectorAll("#logList .live-call-row");
    const ids = [];
    rows.forEach(r => {
      const id = r.dataset.id;
      if (id) ids.push(String(id));
    });
    return ids;
  }

  toggleSelectAll() {
    const allIds = this._getAllRenderedRowIds();
    if (allIds.length === 0) return;

    const allSelected = allIds.every(id => this.selectedIds.has(id));
    if (allSelected) {
      this.clearSelection();
    } else {
      allIds.forEach(id => this.selectedIds.add(id));
      this.isSelectionActive = true;
      this.updateUI();
    }
  }

  toggleRangeMode() {
    this.isRangeMode = !this.isRangeMode;
    if (this.isRangeMode) {
      if (!this.lastAnchorId && this.selectedIds.size > 0) {
        this.lastAnchorId = Array.from(this.selectedIds)[0];
      }
      showToast(window.t ? window.t("log_sel.range_prompt", {}, "Режим A-B: нажмите вторую запись для выбора диапазона") : "Режим A-B: нажмите вторую запись для выбора диапазона", 2500);
    }
    this.updateUI();
  }

  toggleId(id) {
    const sId = String(id);
    if (this.selectedIds.has(sId)) {
      this.selectedIds.delete(sId);
      if (this.selectedIds.size === 0) {
        this.clearSelection();
        return;
      }
    } else {
      this.selectedIds.add(sId);
      this.lastAnchorId = sId;
      this.isSelectionActive = true;
    }
    this.updateUI();
  }

  selectRangeTo(toId) {
    const sToId = String(toId);
    const allIds = this._getAllRenderedRowIds();
    if (!this.lastAnchorId) {
      this.toggleId(sToId);
      return;
    }

    const fromIdx = allIds.indexOf(String(this.lastAnchorId));
    const toIdx = allIds.indexOf(sToId);

    if (fromIdx === -1 || toIdx === -1) {
      this.toggleId(sToId);
      return;
    }

    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);

    for (let i = start; i <= end; i++) {
      this.selectedIds.add(allIds[i]);
    }
    this.lastAnchorId = sToId;
    this.isRangeMode = false;
    this.isSelectionActive = true;
    this.updateUI();
  }

  updateUI() {
    const count = this.selectedIds.size;
    this.isSelectionActive = (count > 0);

    // Update row DOM styles
    const rows = document.querySelectorAll("#logList .live-call-row");
    rows.forEach(r => {
      const id = String(r.dataset.id || "");
      const isSel = this.selectedIds.has(id);
      r.classList.toggle("is-selected", isSel);
    });

    // Update toolbar
    if (this.toolbar) {
      if (this.isSelectionActive) {
        this.toolbar.style.display = "flex";
        if (this.countEl) this.countEl.textContent = count;
        if (this.btnRange) {
          this.btnRange.classList.toggle("active", this.isRangeMode);
        }
        if (this.btnAll) {
          const allIds = this._getAllRenderedRowIds();
          const allSelected = allIds.length > 0 && allIds.every(id => this.selectedIds.has(id));
          this.btnAll.textContent = allSelected
            ? (window.t ? window.t("log_sel.unselect_btn", {}, "Снять") : "Снять")
            : "All";
        }
      } else {
        this.toolbar.style.display = "none";
      }
    }

    // Update Player buttons if player is open
    this.updatePlayerButtons();
  }

  updatePlayerButtons() {
    const count = this.selectedIds.size;
    const deleteBtn = document.getElementById("recDeleteBtn");
    const downloadBtn = document.getElementById("recDownloadBtn");
    const transBtn = document.getElementById("recOfflineTranscribeBtn");

    [deleteBtn, downloadBtn, transBtn].forEach(btn => {
      if (!btn) return;
      btn.classList.toggle("has-batch-active", count > 0);
      let badge = btn.querySelector(".batch-count-pill");
      if (count > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "batch-count-pill";
          btn.appendChild(badge);
        }
        badge.textContent = count > 99 ? "99+" : count;
      } else if (badge) {
        badge.remove();
      }
    });

    if (deleteBtn) {
      deleteBtn.title = count > 0
        ? (window.t ? `${window.t("log_sel.del_btn")} (${count})` : `Удалить выбранные записи (${count})`)
        : (window.t ? window.t("log.del_rec_title") : "Удалить запись");
    }
    if (downloadBtn) {
      downloadBtn.title = count > 0
        ? (window.t ? `${window.t("log_sel.dl_btn")} (${count})` : `Скачать выбранные аудио (${count})`)
        : (window.t ? window.t("log.save_mp3_title") : "Сохранить в файл (MP3)");
    }
    if (transBtn) {
      transBtn.title = count > 0
        ? (window.t ? `${window.t("log_sel.transcribe_btn")} (${count})` : `Транскрибировать выбранные (${count})`)
        : (window.t ? window.t("recordings.offline_transcribe_title") : "Офлайн-транскрибация записей (Google AI)");
    }
  }

  showMiniMenu(x, y) {
    if (!this.miniMenu || this.selectedIds.size === 0) return;

    // Remove any badges if present
    const existingBadges = this.miniMenu.querySelectorAll(".log-menu-badge");
    existingBadges.forEach(b => b.remove());

    this.miniMenu.style.display = "flex";
    this.miniMenu.style.visibility = "hidden";

    // Position menu safely inside window bounds (vertical menu dimensions)
    const rect = this.miniMenu.getBoundingClientRect();
    const w = rect.width || 145;
    const h = rect.height || 148;
    const pad = 10;

    let left = x - (w / 2);
    let top = y - h - 10;

    if (left < pad) left = pad;
    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (top < pad) top = y + 16;
    if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
    if (top < pad) top = pad;

    this.miniMenu.style.left = `${Math.round(left)}px`;
    this.miniMenu.style.top = `${Math.round(top)}px`;
    this.miniMenu.style.visibility = "visible";
  }

  hideMiniMenu() {
    if (this.miniMenu) {
      this.miniMenu.style.display = "none";
    }
  }

  _isPlayerOpen() {
    return Boolean(window.recordingsManager && typeof window.recordingsManager.isPlayerOpen === "function" && window.recordingsManager.isPlayerOpen());
  }

  _onPointerDown(e) {
    const row = e.target.closest(".live-call-row");
    if (!row) return;

    // Do not intercept audio play button click or direct TG quick-tune if user is clicking them
    if (e.target.closest(".log-play-btn, .btn-quick-tune-tg")) {
      return;
    }

    this._isTouchScrolling = false;
    this._longPressCoords = { x: e.clientX, y: e.clientY };
    this._longPressTargetEl = e.target;

    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }

    const rowId = String(row.dataset.id || "");

    // Set 450ms long-press timer
    this._longPressTimer = setTimeout(() => {
      this._longPressTimer = null;
      if (this._isTouchScrolling) return;

      // Haptic feedback
      if (navigator.vibrate) {
        try { navigator.vibrate(45); } catch (_) {}
      }

      this._justLongPressed = true;
      setTimeout(() => { this._justLongPressed = false; }, 400);

      const targetEl = this._longPressTargetEl;

      // 1. Повторное длительное нажатие в режиме выбора:
      // "ветвление убираем и сразу идем в мини-меню из трех кнопок"
      if (this.isSelectionActive) {
        if (!this.selectedIds.has(rowId)) {
          this.selectedIds.add(rowId);
          this.updateUI();
        }
        this.showMiniMenu(this._longPressCoords.x, this._longPressCoords.y);
        return;
      }

      // 2. Первое длительное нажатие: проверяем нажатие на цифре с ID
      // "на цифре с ID - значит идем в меню для передачи ID, иначе идем в активацию мини-меню из трех кнопок"
      const isIdDigit = Boolean(targetEl && targetEl.closest && targetEl.closest(".dmr-id-text"));
      if (isIdDigit) {
        let tgOrIdInfo = (typeof window.extractTgOrIdFromElement === "function")
          ? window.extractTgOrIdFromElement(targetEl)
          : null;

        if (!tgOrIdInfo) {
          const stationEl = row.querySelector(".cell-station");
          const radioId = (stationEl && stationEl.dataset.radioId) || row.dataset.radioId;
          if (radioId) {
            const callsign = (stationEl && stationEl.dataset.callsign) || "";
            const name = (stationEl && stationEl.dataset.name) || "";
            tgOrIdInfo = {
              type: "ID",
              value: parseInt(radioId, 10),
              name: [callsign, name].filter(Boolean).join(" "),
              element: targetEl,
              hotspotId: window.activeHotspotId || "default"
            };
          }
        }

        if (tgOrIdInfo && typeof window.openQuickAssignModal === "function") {
          window.openQuickAssignModal(tgOrIdInfo);
          return;
        }
      }

      // Иначе: стартуем режим выбора первой строкой (мини-меню не открываем)
      if (!this.selectedIds.has(rowId)) {
        this.selectedIds.add(rowId);
        this.lastAnchorId = rowId;
        this.isSelectionActive = true;
        this.updateUI();
      }
    }, 450);
  }

  _onPointerMove(e) {
    if (this._longPressTimer) {
      const dx = Math.abs(e.clientX - this._longPressCoords.x);
      const dy = Math.abs(e.clientY - this._longPressCoords.y);
      if (dx > 10 || dy > 10) {
        this._isTouchScrolling = true;
        clearTimeout(this._longPressTimer);
        this._longPressTimer = null;
      }
    }
  }

  _onPointerUp(e) {
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  _onContextMenu(e) {
    const row = e.target.closest(".live-call-row");
    if (!row) return;

    e.preventDefault();
    const rowId = String(row.dataset.id || "");

    // 1. Повторное длительное нажатие / контекстное меню в режиме выбора:
    // "ветвление убираем и сразу идем в мини-меню из трех кнопок"
    if (this.isSelectionActive) {
      if (!this.selectedIds.has(rowId)) {
        this.selectedIds.add(rowId);
        this.updateUI();
      }
      this.showMiniMenu(e.clientX, e.clientY);
      return;
    }

    // 2. Первое контекстное нажатие: ветвление
    const isIdDigit = Boolean(e.target && e.target.closest && e.target.closest(".dmr-id-text"));
    if (isIdDigit) {
      let tgOrIdInfo = (typeof window.extractTgOrIdFromElement === "function")
        ? window.extractTgOrIdFromElement(e.target)
        : null;

      if (!tgOrIdInfo) {
        const stationEl = row.querySelector(".cell-station");
        const radioId = (stationEl && stationEl.dataset.radioId) || row.dataset.radioId;
        if (radioId) {
          const callsign = (stationEl && stationEl.dataset.callsign) || "";
          const name = (stationEl && stationEl.dataset.name) || "";
          tgOrIdInfo = {
            type: "ID",
            value: parseInt(radioId, 10),
            name: [callsign, name].filter(Boolean).join(" "),
            element: e.target,
            hotspotId: window.activeHotspotId || "default"
          };
        }
      }

      if (tgOrIdInfo && typeof window.openQuickAssignModal === "function") {
        window.openQuickAssignModal(tgOrIdInfo);
        return;
      }
    }

    // Иначе: стартуем режим выбора первой строкой (мини-меню не открываем)
    if (!this.selectedIds.has(rowId)) {
      this.selectedIds.add(rowId);
      this.lastAnchorId = rowId;
      this.isSelectionActive = true;
      this.updateUI();
    }
  }

  _onClick(e) {
    if (this._justLongPressed) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const row = e.target.closest(".live-call-row");
    if (!row) return;

    // Allow play button and quick tune TG to work normally
    if (e.target.closest(".log-play-btn, .btn-quick-tune-tg")) {
      return;
    }

    const rowId = String(row.dataset.id || "");
    const isShift = Boolean(e.shiftKey);
    const isCtrl = Boolean(e.ctrlKey || e.metaKey);

    // If Ctrl or Shift is pressed on Desktop:
    if (isShift) {
      e.preventDefault();
      e.stopPropagation();
      this.selectRangeTo(rowId);
      return;
    }

    if (isCtrl) {
      e.preventDefault();
      e.stopPropagation();
      this.toggleId(rowId);
      return;
    }

    // If selection mode is active or A-B mode is active:
    if (this.isRangeMode) {
      e.preventDefault();
      e.stopPropagation();
      this.selectRangeTo(rowId);
      return;
    }

    if (this.isSelectionActive) {
      e.preventDefault();
      e.stopPropagation();
      this.toggleId(rowId);
      return;
    }
  }

  async deleteSelected() {
    const count = this.selectedIds.size;
    if (count === 0) return;

    const confirmTitle = window.t ? window.t("log_sel.confirm_delete_title", {}, "Удаление записей") : "Удаление записей";
    const confirmMsg = window.t ? window.t("log_sel.confirm_delete_msg", { count }, `Удалить выбранные записи (${count}) и связанные аудиофайлы?`) : `Удалить выбранные записи (${count}) и связанные аудиофайлы?`;
    const confirmBtnText = window.t ? window.t("buttons.delete", {}, "Удалить") : "Удалить";

    const confirmed = await (window.showAppConfirm ? window.showAppConfirm({
      title: confirmTitle,
      icon: "🗑️",
      message: confirmMsg,
      confirmText: confirmBtnText,
      confirmStyle: "danger"
    }) : Promise.resolve(confirm(confirmMsg)));
    if (!confirmed) return;

    const ids = Array.from(this.selectedIds);
    try {
      const resp = await fetch("/api/calls/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_ids: ids })
      });
      const data = await resp.json();
      if (resp.ok) {
        // Remove deleted calls from in-memory heardCalls
        if (window.heardCalls && Array.isArray(window.heardCalls)) {
          const idSet = new Set(ids);
          window.heardCalls = window.heardCalls.filter(c => !idSet.has(String(c.id)));
        }
        if (typeof window.renderLogList === "function") {
          window.renderLogList();
        }
        this.clearSelection();
        showToast(window.t ? window.t("log_sel.deleted_toast", { count: data.deleted_calls || count }, `Удалено записей: ${data.deleted_calls || count}`) : `Удалено записей: ${data.deleted_calls || count}`, 3000);
      } else {
        showToast(window.t ? window.t("log_sel.err_delete", { error: data.detail || "Error" }, `Ошибка удаления: ${data.detail || "Сервер вернул ошибку"}`) : `Ошибка удаления: ${data.detail || "Сервер вернул ошибку"}`, 3000);
      }
    } catch (err) {
      showToast(window.t ? window.t("log_sel.err_network", { error: err.message }, `Сбой сети: ${err.message}`) : `Сбой сети: ${err.message}`, 3000);
    }
  }

  async downloadSelected() {
    const count = this.selectedIds.size;
    if (count === 0) return;

    const ids = Array.from(this.selectedIds);
    showToast(window.t ? window.t("log_sel.download_prep_toast", { count }, `Подготовка скачивания (${count})...`) : `Подготовка скачивания (${count})...`, 2500);

    try {
      const resp = await fetch("/api/calls/batch-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_ids: ids })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showToast(err.detail || (window.t ? window.t("log_sel.err_no_audio", {}, "Нет аудиозаписей для выбранных вызовов") : "Нет аудиозаписей для выбранных вызовов"), 3000);
        return;
      }

      // Check header for filename
      let filename = `proxdmr_recordings_${Date.now()}.zip`;
      const cd = resp.headers.get("Content-Disposition");
      if (cd && cd.includes("filename=")) {
        const m = cd.match(/filename="?([^"]+)"?/);
        if (m && m[1]) filename = m[1];
      } else {
        const ct = resp.headers.get("Content-Type") || "";
        if (ct.includes("audio/mpeg")) filename = `recording_${ids[0]}.mp3`;
        else if (ct.includes("audio/wav")) filename = `recording_${ids[0]}.wav`;
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 500);

      this.clearSelection();
      showToast(window.t ? window.t("log_sel.download_start_toast") : "Скачивание начато", 2000);
    } catch (err) {
      showToast(window.t ? window.t("log_sel.err_download", { error: err.message }, `Ошибка скачивания: ${err.message}`) : `Ошибка скачивания: ${err.message}`, 3000);
    }
  }

  async transcribeSelected() {
    const count = this.selectedIds.size;
    if (count === 0) return;

    const ids = Array.from(this.selectedIds);
    const hid = window.currentLogHotspotId || window.activeHotspotId || "default";

    try {
      const resp = await fetch("/api/calls/batch-transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_ids: ids, hotspot_id: hid })
      });
      const data = await resp.json();
      if (resp.ok) {
        if (data.queued === 0) {
          showToast(data.message || (window.t ? window.t("log_sel.no_audio_for_transcribe") : "Среди выбранных записей нет аудиофайлов для транскрибации"), 3500);
        } else {
          showToast(data.message || (window.t ? window.t("log_sel.transcribe_started", { count: data.queued }) : `Запущена транскрибация (${data.queued} записей)`), 3500);
          this.clearSelection();
        }
      } else {
        showToast(data.detail || data.message || (window.t ? window.t("log_sel.err_transcribe_start", {}, "Не удалось запустить транскрибацию") : "Не удалось запустить транскрибацию"), 3000);
      }
    } catch (err) {
      showToast(`Ошибка: ${err.message}`, 3000);
    }
  }
}

export const logSelection = new LogSelectionManager();

if (typeof window !== "undefined") {
  window.logSelection = logSelection;
}
