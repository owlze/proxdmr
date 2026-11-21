/**
 * ProxDMR - IconMCP Unified Vector Icon Subsystem (modules/ui/icons.js)
 * Replaces UI emojis across buttons, headings, badges, and text with crisp MIT-licensed
 * SVG symbols from the local IconMCP sprite (/static/img/proxdmr-icons.svg),
 * while safely preserving native <select>/<option>, <input>, <textarea>, attributes,
 * Telegram icon values, and country flags.
 */

const SPRITE_URL = "/static/img/proxdmr-icons.svg?v=2.9.762";
const SPRITE_DOM_ID = "proxdmrIconSprite";

// Complete mapping of 124 graphic UI emojis (normalized without U+FE0F) -> IconMCP symbol + optional semantic class
const EMOJI_SVG_MAP = {
  // Group A: Actions, controls, sorting & navigation
  "\u2715": { id: "close" },                      // ✕
  "\u2713": { id: "check", cls: "pxi-ok" },       // ✓
  "\u2714": { id: "check", cls: "pxi-ok" },       // ✔
  "\u{1F50D}": { id: "search" },                  // 🔍
  "\u{1F50E}": { id: "search" },                  // 🔎
  "\u{1F5D1}": { id: "trash" },                   // 🗑️
  "\u{1F504}": { id: "refresh" },                 // 🔄 (context -> sync)
  "\u2795": { id: "plus" },                       // ➕
  "\u23F9": { id: "stop" },                       // ⏹
  "\u2699": { id: "settings" },                   // ⚙️
  "\u2794": { id: "arrow-right" },                // ➔
  "\u27A1": { id: "arrow-right" },                // ➡️
  "\u{1F4BE}": { id: "save" },                    // 💾 (context -> hard-drive for swap)
  "\u{1F441}": { id: "eye" },                     // 👁️
  "\u{1F648}": { id: "eye-off" },                 // 🙈
  "\u{1F4E5}": { id: "download" },                // 📥
  "\u{1F4CC}": { id: "pin" },                     // 📌
  "\u23F8": { id: "pause" },                      // ⏸️
  "\u{1F50C}": { id: "plug" },                    // 🔌
  "\u270F": { id: "edit" },                       // ✏️
  "\u270E": { id: "edit" },                       // ✎
  "\u2717": { id: "close", cls: "pxi-err" },      // ✗
  "\u25B6": { id: "play" },                       // ▶️
  "\u{1F517}": { id: "link" },                    // 🔗
  "\u{1F4CB}": { id: "clipboard-copy" },          // 📋 (context -> file-text for changelog)
  "\u{1F4E4}": { id: "upload" },                  // 📤
  "\u{1F6AA}": { id: "log-out" },                 // 🚪
  "\u2725": { id: "move" },                       // ✥
  "\u2611": { id: "checkbox-checked", cls: "pxi-ok" }, // ☑️
  "\u2610": { id: "checkbox" },                   // ☐
  "\u{1F522}": { id: "sort-1-9" },                // 🔢
  "\u{1F524}": { id: "sort-a-z" },                // 🔤
  "\u23CF": { id: "eject" },                      // ⏏
  "\u{1F9F9}": { id: "broom" },                   // 🧹
  "\u{1F3F3}": { id: "flag" },                    // 🏳
  "\u{1F53D}": { id: "chevron-down" },            // 🔽

  // Group B: Radio, audio, air & domain
  "\u{1F399}": { id: "mic" },                     // 🎙️
  "\u{1F3B2}": { id: "dice-pair" },               // 🎲
  "\u{1F50A}": { id: "volume" },                  // 🔊
  "\u{1F4FB}": { id: "radio" },                   // 📻
  "\u{1F3A7}": { id: "headphones" },              // 🎧
  "\u{1F3AF}": { id: "crosshair" },               // 🎯
  "\u{1F4E1}": { id: "broadcast" },               // 📡
  "\u{1F507}": { id: "volume-off" },              // 🔇
  "\u{1F99C}": { id: "parrot" },                  // 🦜
  "\u260E": { id: "dialpad" },                    // ☎️
  "\u{1F5E3}": { id: "user-voice" },              // 🗣️
  "\u{1F4DE}": { id: "phone-call" },              // 📞
  "\u{1F39A}": { id: "sliders" },                 // 🎚️
  "\u2328": { id: "keyboard" },                   // ⌨️
  "\u{1F9E9}": { id: "puzzle-piece" },            // 🧩
  "\u{1F5FC}": { id: "radio-tower" },             // 🗼
  "\u{1F194}": { id: "id-card" },                 // 🆔
  "\u{1F4FA}": { id: "tv" },                      // 📺
  "\u{1F3DD}": { id: "tree-palm" },               // 🏝️
  "\u{1F4F7}": { id: "camera" },                  // 📷

  // Group C: Status, alerts, security, time & monitoring
  "\u26A0": { id: "alert", cls: "pxi-warn" },     // ⚠️
  "\u26A1": { id: "bolt", cls: "pxi-bolt" },      // ⚡
  "\u2705": { id: "circle-check", cls: "pxi-ok" },// ✅
  "\u{1F512}": { id: "lock", cls: "pxi-lock" },   // 🔒
  "\u23F3": { id: "hourglass" },                  // ⏳
  "\u{1F511}": { id: "key" },                     // 🔑
  "\u2139": { id: "info", cls: "pxi-info" },      // ℹ️
  "\u{1F525}": { id: "flame", cls: "pxi-flame" }, // 🔥
  "\u{1F6E1}": { id: "shield", cls: "pxi-shield" }, // 🛡️
  "\u274C": { id: "x-circle", cls: "pxi-err" },   // ❌
  "\u2753": { id: "help", cls: "pxi-info" },      // ❓
  "\u23F1": { id: "timer" },                      // ⏱️
  "\u{1F680}": { id: "rocket" },                  // 🚀
  "\u{1F6AB}": { id: "ban", cls: "pxi-err" },     // 🚫
  "\u{1F552}": { id: "clock" },                   // 🕒
  "\u{1F9EA}": { id: "flask" },                   // 🧪
  "\u{1F5A5}": { id: "monitor" },                 // 🖥️ (context -> memory for RAM)
  "\u{1F389}": { id: "party-hat", cls: "pxi-gold" }, // 🎉
  "\u{1F4A5}": { id: "explosion", cls: "pxi-err" },  // 💥
  "\u{1F4C8}": { id: "trending-up" },             // 📈 (context -> memory-leak)
  "\u{1F4BD}": { id: "hard-drive" },              // 💽
  "\u{1F510}": { id: "shield-lock", cls: "pxi-shield" }, // 🔐
  "\u{1F6A8}": { id: "siren", cls: "pxi-err" },   // 🚨
  "\u{1F4AC}": { id: "message" },                 // 💬
  "\u{1F4ED}": { id: "inbox" },                   // 📭
  "\u23F0": { id: "alarm-clock" },                // ⏰
  "\u{1F513}": { id: "unlock" },                  // 🔓

  // Group D: Accounts, contacts, files, awards & geo
  "\u{1F310}": { id: "globe" },                   // 🌐
  "\u{1F464}": { id: "user" },                    // 👤
  "\u2B50": { id: "star-solid", cls: "pxi-star" },// ⭐
  "\u2605": { id: "star-solid", cls: "pxi-star" },// ★
  "\u2606": { id: "star" },                       // ☆
  "\u{1F4C1}": { id: "folder" },                  // 📁
  "\u{1F3E0}": { id: "home" },                    // 🏠
  "\u{1F4E6}": { id: "archive" },                 // 📦
  "\u{1F4D6}": { id: "book-open" },               // 📖
  "\u{1F465}": { id: "users" },                   // 👥
  "\u{1F30D}": { id: "globe" },                   // 🌍
  "\u{1F4CD}": { id: "pin" },                     // 📍
  "\u{1F451}": { id: "crown", cls: "pxi-gold" },  // 👑
  "\u{1F4D2}": { id: "contact-book" },            // 📒
  "\u{1F4C4}": { id: "file-text" },               // 📄
  "\u{1F5FA}": { id: "map" },                     // 🗺️
  "\u{1F4C7}": { id: "contact" },                 // 📇
  "\u{1F382}": { id: "birthday-cake" },           // 🎂
  "\u{1F4C5}": { id: "calendar" },                // 📅
  "\u{1F4DD}": { id: "note" },                    // 📝
  "\u{1F3C6}": { id: "trophy", cls: "pxi-gold" }, // 🏆
  "\u{1F947}": { id: "medal", cls: "pxi-gold" },  // 🥇
  "\u{1F948}": { id: "medal", cls: "pxi-silver" },// 🥈
  "\u{1F949}": { id: "medal", cls: "pxi-bronze" },// 🥉

  // Group E: Appearance, AI, Android/APK & misc
  "\u{1F4A1}": { id: "lightbulb", cls: "pxi-warn" }, // 💡
  "\u{1F916}": { id: "ai-agent", cls: "pxi-ai" },    // 🤖
  "\u{1F9E0}": { id: "ai-brain", cls: "pxi-ai" },    // 🧠
  "\u{1F4F1}": { id: "smartphone" },                 // 📱
  "\u2728": { id: "ai-sparkle", cls: "pxi-ai" },     // ✨
  "\u{1F319}": { id: "moon" },                       // 🌙
  "\u2600": { id: "sun", cls: "pxi-warn" },          // ☀️
  "\u{1F3AD}": { id: "theater-masks" },              // 🎭
  "\u{1F3A8}": { id: "palette" },                    // 🎨
  "\u{1F4F2}": { id: "mobile-data" },                // 📲
  "\u{1F4F3}": { id: "vibrate-phone" },              // 📳
  "\u{1F5BC}": { id: "image" },                      // 🖼️
  "\u{1F4D0}": { id: "corner-radius" },              // 📐
  "\u{1F308}": { id: "swap-colors" },                // 🌈
  "\u{1F6A7}": { id: "horizontal-rule", cls: "pxi-flame" }, // 🚧
  "\u{1F381}": { id: "gift", cls: "pxi-ok" },        // 🎁
  "\u{1F48E}": { id: "diamond", cls: "pxi-cyan" },   // 💎
};

// Group F (Part 1): 9 colored status & network circles/hearts -> crisp lightweight CSS dots
const EMOJI_DOT_MAP = {
  "\u{1F7E2}": "pxi-dot-green",  // 🟢
  "\u{1F534}": "pxi-dot-red",    // 🔴
  "\u{1F7E1}": "pxi-dot-yellow", // 🟡
  "\u{1F7E0}": "pxi-dot-orange", // 🟠
  "\u{1F535}": "pxi-dot-blue",   // 🔵
  "\u{1F7E3}": "pxi-dot-purple", // 🟣
  "\u26AA": "pxi-dot-gray",      // ⚪
  "\u{1FA75}": "pxi-dot-cyan",   // 🩵
  "\u{1FA77}": "pxi-dot-pink",   // 🩷
};

// Group F (Part 2): 6 Telegram server color markers -> crisp CSS swatches in UI (input values stay native emoji)
const EMOJI_SWATCH_MAP = {
  "\u{1F7E6}": "pxi-swatch-blue",   // 🟦
  "\u{1F7E7}": "pxi-swatch-orange", // 🟧
  "\u{1F7E9}": "pxi-swatch-green",  // 🟩
  "\u{1F7E5}": "pxi-swatch-red",    // 🟥
  "\u{1F7EA}": "pxi-swatch-purple", // 🟪
  "\u{1F7E8}": "pxi-swatch-yellow", // 🟨
};

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "SVG",
  "SELECT",
  "OPTION",
  "OPTGROUP",
  "TEXTAREA",
  "INPUT",
  "CODE",
  "PRE",
  "TITLE",
]);

function _escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ALL_KEYS = [
  ...Object.keys(EMOJI_SVG_MAP),
  ...Object.keys(EMOJI_DOT_MAP),
  ...Object.keys(EMOJI_SWATCH_MAP),
].sort((a, b) => b.length - a.length);

// Matches any mapped UI emoji (with optional variation selector U+FE0E/U+FE0F); never matches country flags or U+00D7
const EMOJI_MATCH_RE = new RegExp(
  "(?:" + ALL_KEYS.map(_escapeRegex).join("|") + ")[\uFE0E\uFE0F]?",
  "gu"
);
const EMOJI_TEST_RE = new RegExp(
  "(?:" + ALL_KEYS.map(_escapeRegex).join("|") + ")",
  "u"
);

let _spriteReady = false;
let _availableSymbols = new Set();
let _observer = null;
let _isUpgrading = false;
let _pendingNodes = new Set();
let _flushScheduled = false;

function _isProtectedNode(el) {
  if (!el || el.nodeType !== 1) return false;
  let cur = el;
  while (cur && cur.nodeType === 1) {
    if (SKIP_TAGS.has(cur.tagName)) return true;
    if (
      cur.id === SPRITE_DOM_ID ||
      cur.getAttribute("data-no-pxi") === "true" ||
      cur.getAttribute("contenteditable") === "true" ||
      (cur.classList && (
        cur.classList.contains("pxi-icon") ||
        cur.classList.contains("pxi-dot") ||
        cur.classList.contains("pxi-swatch") ||
        cur.classList.contains("pxi-raw-emoji")
      ))
    ) {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

function _resolveSvgSpec(normKey, parentEl, textStr) {
  const base = EMOJI_SVG_MAP[normKey];
  if (!base) return null;

  const i18nKey = (parentEl && parentEl.getAttribute && parentEl.getAttribute("data-i18n")) || "";
  const ctx = (i18nKey + " " + (textStr || "")).toLowerCase();

  if (normKey === "\u{1F4BE}" && (ctx.includes("swap") || ctx.includes("своп"))) {
    return { id: "hard-drive", cls: base.cls };
  }
  if (normKey === "\u{1F5A5}" && (ctx.includes("ram") || ctx.includes("памяти"))) {
    return { id: "memory", cls: base.cls };
  }
  if (normKey === "\u{1F4C8}" && (ctx.includes("leak") || ctx.includes("утечк"))) {
    return { id: "memory-leak", cls: "pxi-warn" };
  }
  if (normKey === "\u{1F4CB}" && (ctx.includes("whats_new") || ctx.includes("changelog") || ctx.includes("что нового") || ctx.includes("what's new"))) {
    return { id: "file-text", cls: base.cls };
  }
  if (normKey === "\u{1F504}" && (ctx.includes("sync") || ctx.includes("синхр"))) {
    return { id: "sync", cls: base.cls };
  }
  return base;
}

function _createIconElement(normKey, parentEl, fullText) {
  if (Object.prototype.hasOwnProperty.call(EMOJI_DOT_MAP, normKey)) {
    const dot = document.createElement("span");
    dot.className = "pxi-dot " + EMOJI_DOT_MAP[normKey];
    dot.setAttribute("aria-hidden", "true");
    return dot;
  }

  if (Object.prototype.hasOwnProperty.call(EMOJI_SWATCH_MAP, normKey)) {
    const sw = document.createElement("span");
    sw.className = "pxi-swatch " + EMOJI_SWATCH_MAP[normKey];
    sw.setAttribute("aria-hidden", "true");
    return sw;
  }

  const spec = _resolveSvgSpec(normKey, parentEl, fullText);
  if (!spec || !_availableSymbols.has("pxi-" + spec.id)) {
    return null;
  }

  const wrap = document.createElement("span");
  wrap.className = spec.cls ? ("pxi-icon " + spec.cls) : "pxi-icon";
  wrap.setAttribute("aria-hidden", "true");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");

  const useEl = document.createElementNS("http://www.w3.org/2000/svg", "use");
  useEl.setAttribute("href", "#pxi-" + spec.id);
  svg.appendChild(useEl);
  wrap.appendChild(svg);
  return wrap;
}

function _upgradeTextNode(textNode) {
  if (!textNode || textNode.nodeType !== 3) return;
  const val = textNode.nodeValue;
  if (!val || !EMOJI_TEST_RE.test(val)) return;
  const parent = textNode.parentElement;
  if (!parent || _isProtectedNode(parent)) return;

  EMOJI_MATCH_RE.lastIndex = 0;
  let match;
  let lastIdx = 0;
  let changed = false;
  const frag = document.createDocumentFragment();

  while ((match = EMOJI_MATCH_RE.exec(val)) !== null) {
    const raw = match[0];
    const norm = raw.replace(/[\uFE0E\uFE0F]/g, "");
    const iconEl = _createIconElement(norm, parent, val);
    if (!iconEl) continue;

    if (match.index > lastIdx) {
      frag.appendChild(document.createTextNode(val.slice(lastIdx, match.index)));
    }
    frag.appendChild(iconEl);
    lastIdx = match.index + raw.length;
    changed = true;
  }

  if (!changed) return;
  if (lastIdx < val.length) {
    frag.appendChild(document.createTextNode(val.slice(lastIdx)));
  }
  if (textNode.parentNode) {
    textNode.parentNode.replaceChild(frag, textNode);
  }
}

export function upgradeProxDMRIcons(root) {
  if (!_spriteReady || typeof document === "undefined") return;
  const target = root || document.body;
  if (!target) return;

  const prevFlag = _isUpgrading;
  _isUpgrading = true;
  try {
    if (target.nodeType === 3) {
      _upgradeTextNode(target);
      return;
    }
    if (target.nodeType === 1 && _isProtectedNode(target)) return;

    const walker = document.createTreeWalker(
      target,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !EMOJI_TEST_RE.test(node.nodeValue)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (!node.parentElement || _isProtectedNode(node.parentElement)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const nodes = [];
    let current;
    while ((current = walker.nextNode())) {
      nodes.push(current);
    }
    for (let i = 0; i < nodes.length; i++) {
      _upgradeTextNode(nodes[i]);
    }
  } finally {
    _isUpgrading = prevFlag;
    if (!prevFlag && _observer) {
      _observer.takeRecords();
    }
  }
}

function _scheduleFlush() {
  if (_flushScheduled) return;
  _flushScheduled = true;
  queueMicrotask(() => {
    _flushScheduled = false;
    if (_pendingNodes.size === 0) return;
    const batch = Array.from(_pendingNodes);
    _pendingNodes.clear();
    for (let i = 0; i < batch.length; i++) {
      const node = batch[i];
      if (node && node.isConnected) {
        upgradeProxDMRIcons(node);
      }
    }
  });
}

function _startObserver() {
  if (_observer || typeof MutationObserver === "undefined" || !document.body) return;
  _observer = new MutationObserver((mutations) => {
    if (_isUpgrading) return;
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      if (m.type === "characterData") {
        if (m.target && m.target.nodeValue && EMOJI_TEST_RE.test(m.target.nodeValue)) {
          _pendingNodes.add(m.target);
        }
      } else if (m.type === "childList" && m.addedNodes && m.addedNodes.length > 0) {
        for (let j = 0; j < m.addedNodes.length; j++) {
          const added = m.addedNodes[j];
          if (added.nodeType === 3) {
            if (added.nodeValue && EMOJI_TEST_RE.test(added.nodeValue)) {
              _pendingNodes.add(added);
            }
          } else if (added.nodeType === 1 && !_isProtectedNode(added)) {
            _pendingNodes.add(added);
          }
        }
      }
    }
    if (_pendingNodes.size > 0) {
      _scheduleFlush();
    }
  });

  _observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

export function renderProxDMRIconHtml(symbolId, extraClass = "") {
  const cls = extraClass ? ("pxi-icon " + extraClass) : "pxi-icon";
  return `<span class="${cls}" aria-hidden="true"><svg focusable="false" aria-hidden="true"><use href="#pxi-${symbolId}"></use></svg></span>`;
}

export async function initProxDMRIcons() {
  if (typeof document === "undefined" || typeof fetch === "undefined") return false;
  if (_spriteReady) {
    upgradeProxDMRIcons(document.body);
    return true;
  }

  try {
    let existing = document.getElementById(SPRITE_DOM_ID);
    if (!existing) {
      const resp = await fetch(SPRITE_URL, { credentials: "same-origin" });
      if (!resp.ok) {
        console.warn("[ProxDMRIcons] Sprite fetch failed:", resp.status);
        return false;
      }
      const svgText = await resp.text();
      if (!svgText || svgText.indexOf("<symbol") === -1) {
        console.warn("[ProxDMRIcons] Invalid sprite payload");
        return false;
      }
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, "image/svg+xml");
      const svgEl = doc.documentElement;
      if (!svgEl || svgEl.tagName.toLowerCase() !== "svg") {
        console.warn("[ProxDMRIcons] Failed to parse SVG sprite");
        return false;
      }
      svgEl.id = SPRITE_DOM_ID;
      svgEl.setAttribute("aria-hidden", "true");
      svgEl.setAttribute("focusable", "false");
      svgEl.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
      if (document.body) {
        document.body.insertBefore(document.importNode(svgEl, true), document.body.firstChild);
      }
      existing = document.getElementById(SPRITE_DOM_ID);
    }

    if (!existing) return false;
    const syms = existing.querySelectorAll("symbol[id]");
    _availableSymbols = new Set();
    syms.forEach((s) => {
      if (s.id) _availableSymbols.add(s.id);
    });
    if (_availableSymbols.size === 0) return false;

    _spriteReady = true;
    if (document.body) {
      document.body.classList.add("pxi-icons-ready");
    }
    upgradeProxDMRIcons(document.body);
    if (typeof window !== "undefined" && typeof window.upgradeProxDMRSelects === "function") {
      window.upgradeProxDMRSelects(document.body);
    }
    _startObserver();
    return true;
  } catch (err) {
    console.warn("[ProxDMRIcons] Init error (falling back to native emojis):", err);
    return false;
  }
}

export function hasMappedProxDMREmoji(str) {
  return Boolean(str && typeof str === "string" && EMOJI_TEST_RE.test(str));
}

if (typeof window !== "undefined") {
  window.upgradeProxDMRIcons = upgradeProxDMRIcons;
  window.renderProxDMRIconHtml = renderProxDMRIconHtml;
  window.ProxDMRIcons = {
    init: initProxDMRIcons,
    upgrade: upgradeProxDMRIcons,
    renderHtml: renderProxDMRIconHtml,
    hasEmoji: hasMappedProxDMREmoji,
    isReady: () => _spriteReady,
    symbolCount: () => _availableSymbols.size,
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { initProxDMRIcons(); }, { once: true });
  } else {
    initProxDMRIcons();
  }
}
