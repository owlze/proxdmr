import { showCenterHudToast } from '../core/toast.js';

/**
 * ProxDMR BLE PTT Subsystem
 * Handles Web Bluetooth / AndroidBridge BLE PTT scanning, connection, detection, and settings panel
 */

function bridge() { return window.AndroidBridge || null; }
function hasBle() { return bridge() && typeof bridge().startBleScan === "function"; }
function isApkClient() {
  if (typeof window.isApkClient === "function") return window.isApkClient();
  return Boolean(window.AndroidBridge);
}

var blePtt = (function() {
  var _scanning = false;
  var _detecting = false;
  var _config = null; // cached config object

  // ── AndroidBridge helpers ─────────────────────────────────
  function bridge() { return window.AndroidBridge || null; }
  function hasBle() { return bridge() && typeof bridge().startBleScan === "function"; }

  // ── Callbacks from Kotlin (called via evaluateJavascript) ─
  window.onBleScanResult = function(jsonStr) {
    try {
      var devices = JSON.parse(jsonStr);
      _renderScanList(devices);
    } catch(e) { console.warn("[BLE] onBleScanResult parse error", e); }
  };

  window.onBleDeviceConnected = function(address, name) {
    _scanning = false;
    _setStatus("connected", name || address);
    _renderConnectedState(address, name);
  };

  window.onBleDeviceDisconnected = function() {
    _setStatus("disconnected", "");
    var statusEl = document.getElementById("blePttConnStatus");
    if (statusEl) statusEl.textContent = (window.t ? window.t("ble.status_reconnecting", {}, "Отключено (переподключение...)") : "Отключено (переподключение...)");
  };

  window.onBleDetectionComplete = function(address, name, charUuid) {
    _detecting = false;
    _config = null; // force reload
    var detectBtn = document.getElementById("blePttDetectBtn");
    if (detectBtn) detectBtn.textContent = window.t ? window.t("ble.detect_btn", {}, "Опрос кнопки (нажмите кнопку PTT)") : "Опрос кнопки (нажмите кнопку PTT)";
    _setStatus("configured", name || address);
    _renderConfiguredState();
    if (navigator.vibrate) try { navigator.vibrate([40, 60, 40]); } catch(_) {}
    var displayKey = charUuid || name || address;
    showCenterHudToast(window.t ? window.t("ble.ptt_configured", { key: displayKey }, "🎉 Кнопка PTT настроена: " + displayKey) : "🎉 Кнопка PTT настроена: " + displayKey, 3000);
  };

  window.onBlePttPressed = function(pressed) {
    // triggerHardwarePtt is called directly from Kotlin too, but handle here for web
    if (typeof window.triggerHardwarePtt === "function") {
      window.triggerHardwarePtt(pressed);
    }
  };

  window.onBleTotExpired = function() {
    // PTT already released by Kotlin; just update UI if needed
    if (typeof window.triggerHardwarePtt === "function") {
      window.triggerHardwarePtt(false);
    }
  };

  // ── Status badge ──────────────────────────────────────────
  function _setStatus(state, label) {
    var el = document.getElementById("blePttConnStatus");
    if (!el) return;
    el.className = "ble-ptt-status-badge ble-ptt-status-" + state;
    var texts = {
      connected: window.t ? window.t("ble.status_connected", {}, "Подключено") : "Подключено",
      configured: window.t ? window.t("ble.status_configured", {}, "Активен") : "Активен",
      disconnected: window.t ? window.t("ble.status_disconnected", {}, "Отключено") : "Отключено",
      scanning: window.t ? window.t("ble.status_scanning", {}, "Сканирование...") : "Сканирование...",
      connecting: window.t ? window.t("ble.status_connecting", {}, "Подключение...") : "Подключение..."
    };
    el.textContent = (texts[state] || state) + (label ? ": " + label : "");
  }

  // ── Load config from bridge ───────────────────────────────
  function _loadConfig() {
    if (!hasBle()) return null;
    try {
      var json = bridge().getBlePttConfig();
      _config = JSON.parse(json);
      return _config;
    } catch(e) { return null; }
  }

  // ── Render functions ──────────────────────────────────────
  function _renderPanel() {
    var panel = document.getElementById("blePttPanel");
    if (!panel) return;
    if (!isApkClient() || !hasBle()) {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "";
    var cfg = _loadConfig();
    if (!cfg) return;

    // Enable toggle
    var chkEnable = document.getElementById("blePttEnable");
    if (chkEnable) chkEnable.checked = !!cfg.enabled;



    // Connection
    if (cfg.address) {
      _renderConfiguredState();
      if (cfg.connected) _setStatus("connected", cfg.name || cfg.address);
      else _setStatus("disconnected", "");
    } else {
      _renderIdleState();
    }
  }

  function _renderIdleState() {
    var scanBtn = document.getElementById("blePttScanBtn");
    var deviceInfo = document.getElementById("blePttDeviceInfo");
    var scanList = document.getElementById("blePttScanList");
    if (scanBtn) scanBtn.style.display = "";
    if (deviceInfo) deviceInfo.style.display = "none";
    if (scanList) { scanList.innerHTML = ""; scanList.style.display = "none"; }
    _setStatus("disconnected", "");
  }

  function _renderConnectedState(address, name) {
    var scanList = document.getElementById("blePttScanList");
    var detectBtn = document.getElementById("blePttDetectBtn");
    var deviceInfo = document.getElementById("blePttDeviceInfo");
    if (scanList) scanList.style.display = "none";
    if (deviceInfo) { deviceInfo.style.display = ""; }
    if (detectBtn) { detectBtn.style.display = ""; }
    var nameEl = document.getElementById("blePttDeviceName");
    if (nameEl) {
      var hasRealName = name && name !== address;
      nameEl.textContent = hasRealName ? (name + " (" + address + ")") : address;
    }
  }

  function _renderConfiguredState() {
    var cfg = _loadConfig();
    var deviceInfo = document.getElementById("blePttDeviceInfo");
    var detectBtn = document.getElementById("blePttDetectBtn");
    var scanList = document.getElementById("blePttScanList");
    var scanBtn = document.getElementById("blePttScanBtn");
    if (scanList) { scanList.innerHTML = ""; scanList.style.display = "none"; }
    if (scanBtn) scanBtn.style.display = "";
    if (deviceInfo) deviceInfo.style.display = "";
    if (detectBtn) {
      detectBtn.style.display = "";
      detectBtn.textContent = window.t ? window.t("ble.detect_btn", {}, "Опрос кнопки (нажмите кнопку PTT)") : "Опрос кнопки (нажмите кнопку PTT)";
    }
    var nameEl = document.getElementById("blePttDeviceName");
    if (nameEl && cfg) {
      var hasRealName = cfg.name && cfg.name !== cfg.address;
      var baseName = hasRealName ? (cfg.name + " (" + cfg.address + ")") : (cfg.address || "—");
      if (cfg.charUuid) {
        baseName += " [" + cfg.charUuid + "]";
      }
      nameEl.textContent = baseName;
    }
  }

  function _renderScanList(devices) {
    var list = document.getElementById("blePttScanList");
    if (!list) return;
    list.style.display = "";
    list.innerHTML = "";
    if (!devices || devices.length === 0) {
      list.innerHTML = `<div class='ble-scan-empty'>${window.t ? window.t("ble.no_devices", {}, "Устройства не найдены") : "Устройства не найдены"}</div>`;
      return;
    }
    devices.forEach(function(d) {
      var item = document.createElement("div");
      item.className = "ble-scan-item";
      var hasRealName = d.name && d.name !== d.address;
      var displayName = hasRealName ? d.name : (window.t ? window.t("ble.unnamed_device", {}, "BLE Устройство") : "BLE Устройство");
      item.innerHTML =
        "<span class='ble-scan-name'>" + _esc(displayName) + "</span>" +
        "<span class='ble-scan-addr'>" + _esc(d.address) + "</span>" +
        "<button class='ble-scan-connect-btn btn-xs-primary'>" + (window.t ? window.t("ble.select_device", {}, "Выбрать") : "Выбрать") + "</button>";
      item.querySelector("button").addEventListener("click", function() {
        _connecting(d.address, d.name);
      });
      list.appendChild(item);
    });
  }

  // ── Actions ───────────────────────────────────────────────
  function startScan() {
    if (!hasBle()) return;
    _scanning = true;
    _setStatus("scanning", "");
    var list = document.getElementById("blePttScanList");
    if (list) { list.innerHTML = `<div class='ble-scan-empty'>${window.t ? window.t("ble.searching_devices", {}, "Поиск устройств...") : "Поиск устройств..."}</div>`; list.style.display = ""; }
    try { bridge().startBleScan(); } catch(e) { console.warn("[BLE] startBleScan error", e); }
  }

  function _connecting(address, name) {
    _setStatus("connecting", (name && name !== address) ? name : address);
    var list = document.getElementById("blePttScanList");
    if (list) { list.innerHTML = ""; list.style.display = "none"; }
    try {
      if (bridge().connectBleDeviceWithName) {
        bridge().connectBleDeviceWithName(address, name || "");
      } else {
        bridge().connectBleDevice(address);
      }
    } catch(e) { console.warn("[BLE] connectBleDevice error", e); }
  }

  function startDetection() {
    if (!hasBle()) return;
    _detecting = true;
    var detectBtn = document.getElementById("blePttDetectBtn");
    if (detectBtn) detectBtn.textContent = (window.t ? window.t("ble.press_button", {}, "Нажмите кнопку на устройстве...") : "Нажмите кнопку на устройстве...");
    _setStatus("scanning", window.t ? window.t("ble.status_waiting_press", {}, "Ожидание нажатия...") : "Ожидание нажатия...");
    try { bridge().startBleDetection(); } catch(e) { console.warn("[BLE] startBleDetection error", e); }
  }

  function clearDevice() {
    if (!hasBle()) return;
    try { bridge().clearBlePttDevice(); } catch(e) {}
    _config = null;
    _renderIdleState();
    _setStatus("disconnected", "");
  }

  function setEnabled(enabled) {
    if (!hasBle()) return;
    try { bridge().setBlePttEnabled(enabled); } catch(e) {}
  }

  function setMode(mode) {
    if (!hasBle()) return;
    try { bridge().setBlePttMode(mode); } catch(e) {}
    var totRow = document.getElementById("blePttTotRow");
    if (totRow) totRow.style.display = (mode === "tot") ? "" : "none";
  }

  function setTot(seconds) {
    if (!hasBle()) return;
    try { bridge().setBleTotSeconds(parseInt(seconds, 10)); } catch(e) {}
    var totLabel = document.getElementById("blePttTotLabel");
    if (totLabel) totLabel.textContent = seconds + " " + (window.t ? window.t("ble.unit_s", {}, "с") : "с");
  }

  // ── Init & event wiring ───────────────────────────────────
  function init() {
    var panel = document.getElementById("blePttPanel");
    var toggle = document.getElementById("blePttToggle");
    if (panel && toggle && !toggle._wired) {
      toggle._wired = true;
      toggle.addEventListener("click", function() {
        panel.classList.toggle("collapsed");
      });
    }

    if (!isApkClient() || !hasBle()) return;

    var scanBtn = document.getElementById("blePttScanBtn");
    if (scanBtn) scanBtn.addEventListener("click", startScan);

    var detectBtn = document.getElementById("blePttDetectBtn");
    if (detectBtn) detectBtn.addEventListener("click", startDetection);

    var clearBtn = document.getElementById("blePttClearBtn");
    if (clearBtn) clearBtn.addEventListener("click", async function() {
      var msg = window.t ? window.t("dialog.confirm_clear_ble", {}, "Сбросить BLE PTT устройство?") : "Сбросить BLE PTT устройство?";
      var ok = await (window.showAppConfirm ? window.showAppConfirm({
        title: window.t ? window.t("ble.reset_confirm_title", {}, "Сброс устройства") : "Сброс устройства",
        icon: "🔄",
        message: msg,
        confirmText: window.t ? window.t("ble.reset_confirm_btn", {}, "Сбросить") : "Сбросить",
        confirmStyle: "danger"
      }) : Promise.resolve(confirm(msg)));
      if (ok) clearDevice();
    });

    var chkEnable = document.getElementById("blePttEnable");
    if (chkEnable) chkEnable.addEventListener("change", function() { setEnabled(this.checked); });

    _renderPanel();
  }

  function _esc(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  return { init: init, renderPanel: _renderPanel };
})();


export { blePtt };

if (typeof window !== "undefined") {
  window.blePtt = blePtt;
  window.__proxdmr = window.__proxdmr || {};
  window.__proxdmr.blePtt = blePtt;
}
