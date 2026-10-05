/**
 * ProxDMR - Centralized Hotspot State & Navigation Helpers
 * Module: modules/core/state.js
 *
 * Single source of truth for common utility wrappers that were previously
 * duplicated across dsp.js, routing.js, engine.js, about.js.
 * All modules should import from here instead of copy-pasting window.* wrappers.
 */

// --- Hotspot State ---

export function getActiveHotspotId() {
  return (typeof window !== "undefined" && window.activeHotspotId) || "default";
}

export function resolveHotspotId(hid) {
  if (typeof window !== "undefined" && typeof window.resolveHotspotId === "function") {
    return window.resolveHotspotId(hid);
  }
  const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
  if (!hid || hid === "undefined" || hid === "null" || hid === "default" || hid === "1") {
    return (hsList && hsList[0] && hsList[0].id) || "default";
  }
  return String(hid);
}

export function getHotspotSlot(hid) {
  if (typeof window !== "undefined" && typeof window.getHotspotSlot === "function") {
    return window.getHotspotSlot(hid);
  }
  const id = hid || getActiveHotspotId();
  const saved = localStorage.getItem(`proxdmr_slot_${id}`);
  return saved ? parseInt(saved, 10) : 2;
}

export function isHotspotCollapsed(hid) {
  if (typeof window !== "undefined" && typeof window.isHotspotCollapsed === "function") {
    return window.isHotspotCollapsed(hid);
  }
  return false;
}

export function getCurrentHotspots() {
  return (typeof window !== "undefined" && window.currentHotspots) || [];
}

// --- Navigation Helpers ---

export function pushNavState(type, id) {
  if (typeof window !== "undefined" && typeof window.pushNavState === "function") {
    window.pushNavState(type, id);
  }
}

export function notifyNavClosed() {
  if (typeof window !== "undefined" && typeof window.notifyNavClosed === "function") {
    window.notifyNavClosed();
  }
}

// --- Settings Sync ---

export function scheduleSyncClientSettings(delay = 1000) {
  if (typeof window !== "undefined" && typeof window.scheduleSyncClientSettings === "function") {
    window.scheduleSyncClientSettings(delay);
  }
}
