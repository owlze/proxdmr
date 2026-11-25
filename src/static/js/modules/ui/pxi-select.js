/**
 * ProxDMR - Styled Custom Select Dropdown with IconMCP Vector Icons (modules/ui/pxi-select.js)
 * Transparently enhances <select> elements containing mapped UI emojis so both the trigger button
 * and every dropdown option render crisp IconMCP SVG icons & CSS status dots while preserving
 * 100% of native <select> state, events, demo-mode locks, i18n updates, and form behavior.
 */

import { hasMappedProxDMREmoji, upgradeProxDMRIcons } from './icons.js?v=2.9.770';

const ENHANCED_SET = new Set();
const SELECT_META = new WeakMap();

let _portalMenu = null;
let _activeSelect = null;
let _activeTrigger = null;
let _bodyObserver = null;
let _scanScheduled = false;
let _pendingRoots = new Set();
let _globalsWired = false;

const _nativeValueDesc = (typeof HTMLSelectElement !== "undefined")
  ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")
  : null;
const _nativeIndexDesc = (typeof HTMLSelectElement !== "undefined")
  ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex")
  : null;

const FLAG_EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;

function _flagPairToIso(pair) {
  const cps = Array.from(pair);
  if (cps.length !== 2) return "";
  const c1 = cps[0].codePointAt(0);
  const c2 = cps[1].codePointAt(0);
  if (c1 < 0x1F1E6 || c1 > 0x1F1FF || c2 < 0x1F1E6 || c2 > 0x1F1FF) return "";
  return String.fromCharCode(97 + (c1 - 0x1F1E6), 97 + (c2 - 0x1F1E6));
}

function _upgradeFlagEmojis(rootEl) {
  if (!rootEl || typeof document === "undefined" || typeof document.createTreeWalker !== "function") return;
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let cur;
  while ((cur = walker.nextNode())) {
    const p = cur.parentElement;
    if (!p || p.closest(".pxi-icon, .pxi-dot, .pxi-swatch, .pxi-select-flag")) continue;
    const val = cur.nodeValue;
    if (val && /[\u{1F1E6}-\u{1F1FF}]{2}/u.test(val)) {
      nodes.push(cur);
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    const tn = nodes[i];
    const val = tn.nodeValue;
    if (!val || !tn.parentNode) continue;
    FLAG_EMOJI_RE.lastIndex = 0;
    let m;
    let lastIdx = 0;
    const frag = document.createDocumentFragment();
    let changed = false;
    while ((m = FLAG_EMOJI_RE.exec(val)) !== null) {
      const pair = m[0];
      const iso = _flagPairToIso(pair);
      if (!iso) continue;
      if (m.index > lastIdx) {
        frag.appendChild(document.createTextNode(val.slice(lastIdx, m.index)));
      }
      const badge = document.createElement("span");
      badge.className = "flag-badge pxi-select-flag";
      badge.setAttribute("aria-hidden", "true");
      const img = document.createElement("img");
      img.src = `/static/flags/${iso}.svg`;
      img.alt = iso.toUpperCase();
      img.className = "flag-svg flag-img";
      img.loading = "eager";
      img.onerror = () => {
        badge.textContent = pair;
      };
      badge.appendChild(img);
      frag.appendChild(badge);
      lastIdx = m.index + pair.length;
      changed = true;
    }
    if (!changed) continue;
    if (lastIdx < val.length) {
      frag.appendChild(document.createTextNode(val.slice(lastIdx)));
    }
    tn.parentNode.replaceChild(frag, tn);
  }
}

function _isExcludedSelect(sel) {
  if (!sel || sel.tagName !== "SELECT") return true;
  if (sel.multiple || (sel.size && sel.size > 1)) return true;
  if (sel.id === "editHsSelect" || sel.id === "selectPresetTs1" || sel.id === "selectPresetTs2") return true;
  if (sel.closest && sel.closest(".srv-combo-wrap")) return true;
  if (sel.getAttribute("data-no-pxi-select") === "true" || sel.getAttribute("data-no-pxi") === "true") return true;
  return false;
}

function _selectNeedsEnhancement(sel) {
  return !_isExcludedSelect(sel);
}

function _isBannerServerSelect(sel) {
  return Boolean(sel && sel.classList && sel.classList.contains("bm-server-select"));
}

function _isServerSelect(sel) {
  if (!sel) return false;
  if (sel.id === "editHsMasterSelect") return true;
  return _isBannerServerSelect(sel);
}

function _isSearchableSelect(sel) {
  if (!sel) return false;
  if (_isServerSelect(sel)) return true;
  return Boolean(sel.dataset && sel.dataset.pxiSearchable === "true");
}

function _normalizeSearchText(str) {
  let s = String(str || "").toLowerCase().replace(/ё/g, "е");
  try {
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {}
  return s;
}

function _isCompactSelect(sel) {
  if (!sel || !sel.classList) return false;
  return Boolean(
    sel.id === "editHsSelect" ||
    sel.id === "adminNewRole" ||
    sel.classList.contains("tts-quick-select") ||
    sel.classList.contains("ysf-type-select") ||
    sel.classList.contains("ysf-room-type-select") ||
    sel.classList.contains("ysf-card-type-select") ||
    sel.classList.contains("ysf-edit-room-type") ||
    sel.classList.contains("bm-preset-select") ||
    sel.classList.contains("gw-hotspot-select") ||
    sel.classList.contains("routing-select") ||
    sel.classList.contains("tx-browser-mic-select")
  );
}

function _isInlineSelect(sel) {
  if (!sel || !sel.classList) return false;
  return Boolean(
    sel.id === "adminNewRole" ||
    sel.classList.contains("gw-hotspot-select") ||
    sel.classList.contains("routing-select")
  );
}

function _isFlexSelect(sel) {
  if (!sel || !sel.classList) return false;
  return Boolean(
    sel.classList.contains("tx-browser-mic-select") ||
    (sel.style && sel.style.flex && !sel.style.width)
  );
}

function _isMiniSelect(sel) {
  return Boolean(sel && sel.classList && sel.classList.contains("ysf-card-type-select"));
}

function _ensurePortalMenu() {
  if (_portalMenu && _portalMenu.isConnected) return _portalMenu;
  const menu = document.createElement("div");
  menu.id = "proxdmrPxiSelectMenu";
  menu.className = "pxi-select-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("tabindex", "-1");
  menu.hidden = true;
  document.body.appendChild(menu);
  _portalMenu = menu;
  return menu;
}

function _syncTriggerVisuals(sel) {
  const meta = SELECT_META.get(sel);
  if (!meta || !meta.trigger) return;
  const btn = meta.trigger;

  if (meta.isBannerWrap) {
    const isHiddenWrap = Boolean(
      sel.hidden ||
      sel.style.display === "none" ||
      btn.style.display === "none" ||
      (sel.classList && sel.classList.contains("hidden"))
    );
    const isDisWrap = Boolean(sel.disabled);
    btn.classList.toggle("is-disabled", isDisWrap);
    btn.setAttribute("aria-disabled", isDisWrap ? "true" : "false");
    if (isHiddenWrap || isDisWrap) {
      if (_activeSelect === sel) closeProxDMRSelectMenu(false);
    }
    return;
  }

  // Mirror visibility controlled by app JS (style.display / hidden / .hidden)
  const isHiddenByApp = Boolean(
    sel.hidden ||
    sel.style.display === "none" ||
    (sel.classList && sel.classList.contains("hidden"))
  );
  btn.style.display = isHiddenByApp ? "none" : "";

  // Mirror disabled state (including auth.js demo-mode lock & editHsNetworkType lock)
  const isDis = Boolean(sel.disabled);
  btn.disabled = isDis;
  btn.classList.toggle("is-disabled", isDis);

  // Mirror inline width/flex constraints if specified on the native select
  btn.style.width = sel.style.width || (sel.style.flex ? "auto" : "");
  btn.style.flex = sel.style.flex || "";
  btn.style.minWidth = sel.style.minWidth || (sel.style.flex ? "0" : "");
  btn.style.maxWidth = sel.style.maxWidth || "";

  // Mirror tooltip / aria-label
  const titleAttr = sel.getAttribute("title");
  if (titleAttr) btn.setAttribute("title", titleAttr);
  else btn.removeAttribute("title");

  const selectedOpt = (sel.selectedIndex >= 0 && sel.options[sel.selectedIndex])
    ? sel.options[sel.selectedIndex]
    : (sel.options[0] || null);
  const labelText = selectedOpt ? (selectedOpt.textContent || "").trim() : "";

  meta.labelEl.textContent = labelText;
  if (typeof window !== "undefined" && typeof window.upgradeProxDMRIcons === "function") {
    window.upgradeProxDMRIcons(meta.labelEl);
  } else {
    upgradeProxDMRIcons(meta.labelEl);
  }
  _upgradeFlagEmojis(meta.labelEl);

  if (isHiddenByApp || isDis) {
    if (_activeSelect === sel) closeProxDMRSelectMenu(false);
  }
}

function _positionPortalMenu() {
  if (!_portalMenu || _portalMenu.hidden || !_activeTrigger || !_activeTrigger.isConnected) return;
  const rect = _activeTrigger.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 360;
  const vh = window.innerHeight || document.documentElement.clientHeight || 640;

  if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > vh) {
    closeProxDMRSelectMenu(false);
    return;
  }

  const gap = 4;
  const edgePad = 8;
  const spaceBelow = Math.max(80, vh - rect.bottom - gap - edgePad);
  const spaceAbove = Math.max(80, rect.top - gap - edgePad);
  const openUp = (spaceBelow < 190 && spaceAbove > spaceBelow);

  const isServerList = _isServerSelect(_activeSelect);
  const baseMinW = isServerList ? Math.max(Math.round(rect.width), 290) : Math.round(rect.width);
  const baseMaxW = isServerList ? Math.max(Math.round(rect.width), 420) : Math.max(Math.round(rect.width), 310);
  const minW = Math.min(baseMinW, vw - edgePad * 2);
  const maxW = Math.min(baseMaxW, vw - edgePad * 2);

  _portalMenu.style.minWidth = minW + "px";
  _portalMenu.style.maxWidth = maxW + "px";
  _portalMenu.style.maxHeight = Math.min(isServerList ? 400 : 340, Math.floor(openUp ? spaceAbove : spaceBelow)) + "px";

  const menuRect = _portalMenu.getBoundingClientRect();
  const actualW = Math.min(Math.max(menuRect.width, minW), vw - edgePad * 2);
  let left = Math.round(rect.left);
  if (left + actualW > vw - edgePad) {
    left = Math.max(edgePad, vw - edgePad - actualW);
  }
  if (left < edgePad) left = edgePad;
  _portalMenu.style.left = left + "px";

  if (openUp) {
    _portalMenu.style.top = "auto";
    _portalMenu.style.bottom = Math.round(vh - rect.top + gap) + "px";
    _portalMenu.classList.add("is-dropup");
  } else {
    _portalMenu.style.bottom = "auto";
    _portalMenu.style.top = Math.round(rect.bottom + gap) + "px";
    _portalMenu.classList.remove("is-dropup");
  }
}

function _buildMenuOptionButton(sel, opt, optIndex) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pxi-select-option";
  btn.setAttribute("role", "option");
  btn.dataset.optIndex = String(optIndex);

  const isActionOpt = (opt.value === "__TEST_SERVERS__" || opt.value === "__OPEN_YSF_CATALOG__" || opt.value === "__REFRESH_TTS_MODELS__");
  const isSelected = !isActionOpt && (optIndex === sel.selectedIndex);
  const isDisabled = Boolean(opt.disabled || (opt.parentElement && opt.parentElement.tagName === "OPTGROUP" && opt.parentElement.disabled));
  if (isActionOpt) {
    btn.classList.add("is-action-option");
  }
  if (opt.dataset && opt.dataset.dead === "1") {
    btn.classList.add("is-dead-option");
  }
  if (isSelected) {
    btn.classList.add("is-selected");
    btn.setAttribute("aria-selected", "true");
  } else {
    btn.setAttribute("aria-selected", "false");
  }
  if (isDisabled) {
    btn.disabled = true;
    btn.classList.add("is-disabled");
  }

  const textSpan = document.createElement("span");
  textSpan.className = "pxi-select-option-text";
  textSpan.textContent = (opt.textContent || "").trim();
  btn.appendChild(textSpan);

  if (isSelected) {
    const chk = document.createElement("span");
    chk.className = "pxi-select-check";
    chk.setAttribute("aria-hidden", "true");
    chk.textContent = "\u2713";
    btn.appendChild(chk);
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isDisabled) return;
    _commitSelection(sel, optIndex);
  });

  return btn;
}

function _commitSelection(sel, optIndex) {
  const prevIdx = sel.selectedIndex;
  const opt = sel.options[optIndex];
  if (!opt) {
    closeProxDMRSelectMenu(true);
    return;
  }

  const isActionOpt = (opt.value === "__TEST_SERVERS__" || opt.value === "__OPEN_YSF_CATALOG__" || opt.value === "__REFRESH_TTS_MODELS__");

  if (_nativeIndexDesc && _nativeIndexDesc.set) {
    _nativeIndexDesc.set.call(sel, optIndex);
  } else {
    sel.selectedIndex = optIndex;
  }

  _syncTriggerVisuals(sel);
  closeProxDMRSelectMenu(true);

  if (prevIdx !== optIndex || isActionOpt) {
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function _upgradeMenuChunkIcons(containerEl) {
  if (!containerEl) return;
  if (typeof window !== "undefined" && typeof window.upgradeProxDMRIcons === "function") {
    window.upgradeProxDMRIcons(containerEl);
  } else {
    upgradeProxDMRIcons(containerEl);
  }
  _upgradeFlagEmojis(containerEl);
}

function _openMenuForSelect(sel, initialSearchQuery = "", focusSearchInput = false) {
  const meta = SELECT_META.get(sel);
  if (!meta || !meta.trigger || sel.disabled) return;

  _wrapBackHandler();

  if (typeof window !== "undefined" && typeof window.closeAllServerComboboxes === "function") {
    try { window.closeAllServerComboboxes(); } catch (_) {}
  }

  if (!initialSearchQuery && !focusSearchInput && _activeSelect === sel && _portalMenu && !_portalMenu.hidden) {
    closeProxDMRSelectMenu(true);
    return;
  }

  closeProxDMRSelectMenu(false);

  const menu = _ensurePortalMenu();
  menu.innerHTML = "";
  menu.onscroll = null;
  const isServerSelect = _isServerSelect(sel);
  const isSearchableSelect = _isSearchableSelect(sel);
  menu.classList.toggle("is-compact", _isCompactSelect(sel));
  menu.classList.toggle("is-server-list", isServerSelect);
  menu.classList.toggle("is-searchable", isSearchableSelect);

  if (isSearchableSelect) {
    const actionEntries = [];
    const serverEntries = [];
    let flatIndex = 0;
    const children = sel.children;

    const collectOption = (optEl, idx) => {
      const isHiddenOpt = Boolean(optEl.hidden || (optEl.dataset && optEl.dataset.currentOnly === "1"));
      if (isHiddenOpt) return;
      const val = String(optEl.value || "");
      const text = String(optEl.textContent || "").trim();
      const isActionOpt = (val === "__TEST_SERVERS__" || val === "__OPEN_YSF_CATALOG__" || val === "__REFRESH_TTS_MODELS__");
      if (isActionOpt) {
        actionEntries.push({ optEl, flatIndex: idx });
        return;
      }
      const desig = (optEl.dataset && optEl.dataset.designator) ? String(optEl.dataset.designator) : "";
      const proto = (optEl.dataset && optEl.dataset.protocol) ? String(optEl.dataset.protocol) : "";
      const extraSearch = (optEl.dataset && optEl.dataset.search) ? String(optEl.dataset.search) : "";
      const isPlaceholder = (val === "");
      const isCustomOpt = (val === "CUSTOM");
      const haystack = isPlaceholder ? "" : _normalizeSearchText(`${val} ${text} ${desig} ${proto} ${extraSearch}`);
      serverEntries.push({
        optEl,
        flatIndex: idx,
        val,
        text,
        isPlaceholder,
        isCustomOpt,
        haystack
      });
    };

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.tagName === "OPTGROUP") {
        const grpOpts = child.children;
        for (let j = 0; j < grpOpts.length; j++) {
          const optEl = grpOpts[j];
          if (optEl.tagName === "OPTION") {
            collectOption(optEl, flatIndex);
            flatIndex++;
          }
        }
      } else if (child.tagName === "OPTION") {
        collectOption(child, flatIndex);
        flatIndex++;
      }
    }

    if (actionEntries.length === 0 && serverEntries.length === 0) {
      return;
    }

    const stickyTop = document.createElement("div");
    stickyTop.className = "pxi-select-sticky-top";

    const searchRow = document.createElement("div");
    searchRow.className = "pxi-select-search-row";

    const searchIcon = document.createElement("span");
    searchIcon.className = "pxi-select-search-icon";
    searchIcon.setAttribute("aria-hidden", "true");
    searchIcon.textContent = "🔍";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "pxi-select-search-input";
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    const customPlaceholder = (sel.dataset && sel.dataset.pxiSearchPlaceholder) ? String(sel.dataset.pxiSearchPlaceholder) : "";
    searchInput.placeholder = customPlaceholder || (
      (typeof window !== "undefined" && typeof window.t === "function")
        ? window.t("servers.search_addr_desc_placeholder", {}, "Поиск по адресу или описанию сервера...")
        : "Поиск по адресу или описанию сервера..."
    );

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "pxi-select-search-clear";
    clearBtn.title = (typeof window !== "undefined" && typeof window.t === "function")
      ? window.t("servers.clear_search", {}, "Очистить поиск")
      : "Очистить поиск";
    clearBtn.textContent = "✕";
    clearBtn.hidden = true;

    searchRow.appendChild(searchIcon);
    searchRow.appendChild(searchInput);
    searchRow.appendChild(clearBtn);
    stickyTop.appendChild(searchRow);

    actionEntries.forEach((act) => {
      const actBtn = _buildMenuOptionButton(sel, act.optEl, act.flatIndex);
      stickyTop.appendChild(actBtn);
    });

    _upgradeMenuChunkIcons(stickyTop);
    menu.appendChild(stickyTop);

    const listContainer = document.createElement("div");
    listContainer.className = "pxi-select-options-list";
    menu.appendChild(listContainer);

    const BATCH_SIZE = 160;
    let activeFiltered = [];
    let renderedUpTo = 0;
    let moreHintEl = null;

    const appendNextBatch = () => {
      if (moreHintEl && moreHintEl.parentNode) {
        moreHintEl.remove();
        moreHintEl = null;
      }
      if (renderedUpTo >= activeFiltered.length) return;
      const nextSlice = activeFiltered.slice(renderedUpTo, renderedUpTo + BATCH_SIZE);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < nextSlice.length; i++) {
        const entry = nextSlice[i];
        frag.appendChild(_buildMenuOptionButton(sel, entry.optEl, entry.flatIndex));
      }
      _upgradeMenuChunkIcons(frag);
      listContainer.appendChild(frag);
      renderedUpTo += nextSlice.length;

      const remaining = activeFiltered.length - renderedUpTo;
      if (remaining > 0) {
        moreHintEl = document.createElement("button");
        moreHintEl.type = "button";
        moreHintEl.className = "pxi-select-more-hint";
        moreHintEl.textContent = (typeof window !== "undefined" && typeof window.t === "function")
          ? window.t("servers.more_items", { count: remaining }, `...и ещё ${remaining} серверов (прокрутите или уточните поиск)`)
          : `...и ещё ${remaining} серверов (прокрутите или уточните поиск)`;
        moreHintEl.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          appendNextBatch();
        });
        listContainer.appendChild(moreHintEl);
      }
    };

    const renderFilteredServerOptions = (rawQuery) => {
      const rawTrim = String(rawQuery || "").trim();
      const q = _normalizeSearchText(rawTrim);
      clearBtn.hidden = !rawTrim;
      listContainer.innerHTML = "";
      renderedUpTo = 0;
      moreHintEl = null;

      const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
      if (!tokens.length) {
        activeFiltered = serverEntries.slice();
        const selPos = activeFiltered.findIndex(e => e.flatIndex === sel.selectedIndex);
        if (selPos >= BATCH_SIZE) {
          const [selEntry] = activeFiltered.splice(selPos, 1);
          const insertAt = (activeFiltered.length > 0 && activeFiltered[0].isPlaceholder) ? 1 : 0;
          activeFiltered.splice(insertAt, 0, selEntry);
        }
      } else {
        activeFiltered = serverEntries.filter((entry) => {
          if (entry.isPlaceholder) return false;
          if (entry.isCustomOpt) return tokens.every(tok => entry.haystack.includes(tok));
          return tokens.every(tok => entry.haystack.includes(tok));
        });
      }

      if (activeFiltered.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "pxi-select-empty";
        emptyEl.textContent = (typeof window !== "undefined" && typeof window.t === "function")
          ? window.t("servers.nothing_found", {}, "Ничего не найдено")
          : "Ничего не найдено";
        listContainer.appendChild(emptyEl);
        return;
      }

      appendNextBatch();
    };

    searchInput.addEventListener("input", (e) => {
      e.stopPropagation();
      renderFilteredServerOptions(searchInput.value);
      menu.scrollTop = 0;
    });

    searchInput.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    searchInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        if (searchInput.value) {
          searchInput.value = "";
          renderFilteredServerOptions("");
        } else {
          closeProxDMRSelectMenu(true);
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const firstOpt = listContainer.querySelector(".pxi-select-option:not(:disabled)") ||
                         stickyTop.querySelector(".pxi-select-option:not(:disabled)");
        if (firstOpt) firstOpt.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const allOpts = listContainer.querySelectorAll(".pxi-select-option:not(:disabled)");
        if (allOpts.length) allOpts[allOpts.length - 1].focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const firstServerOpt = listContainer.querySelector(".pxi-select-option:not(:disabled)");
        if (firstServerOpt) {
          firstServerOpt.click();
        }
      }
    });

    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      searchInput.value = "";
      renderFilteredServerOptions("");
      searchInput.focus();
    });

    menu.onscroll = () => {
      if (renderedUpTo < activeFiltered.length) {
        if (menu.scrollTop + menu.clientHeight >= menu.scrollHeight - 140) {
          appendNextBatch();
        }
      }
    };

    if (initialSearchQuery) {
      searchInput.value = initialSearchQuery;
    }
    renderFilteredServerOptions(initialSearchQuery);

    _activeSelect = sel;
    _activeTrigger = meta.trigger;
    meta.trigger.classList.add("is-open");
    meta.trigger.setAttribute("aria-expanded", "true");

    menu.hidden = false;
    _positionPortalMenu();

    if (focusSearchInput) {
      try {
        searchInput.focus();
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      } catch (_) {}
    } else if (!initialSearchQuery) {
      const selectedBtn = listContainer.querySelector(".pxi-select-option.is-selected");
      if (selectedBtn && typeof selectedBtn.scrollIntoView === "function") {
        selectedBtn.scrollIntoView({ block: "nearest" });
      }
    }
    return;
  }

  let flatIndex = 0;
  let renderedCount = 0;
  const children = sel.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.tagName === "OPTGROUP") {
      const grpOpts = child.children;
      const groupButtons = [];
      for (let j = 0; j < grpOpts.length; j++) {
        const optEl = grpOpts[j];
        if (optEl.tagName === "OPTION") {
          const isHiddenOpt = Boolean(optEl.hidden || (optEl.dataset && optEl.dataset.currentOnly === "1"));
          if (!isHiddenOpt) {
            groupButtons.push(_buildMenuOptionButton(sel, optEl, flatIndex));
          }
          flatIndex++;
        }
      }
      if (groupButtons.length > 0) {
        const grpLbl = document.createElement("div");
        grpLbl.className = "pxi-select-group-label";
        grpLbl.textContent = child.label || "";
        menu.appendChild(grpLbl);
        groupButtons.forEach((b) => menu.appendChild(b));
        renderedCount += groupButtons.length;
      }
    } else if (child.tagName === "OPTION") {
      const isHiddenOpt = Boolean(child.hidden || (child.dataset && child.dataset.currentOnly === "1"));
      if (!isHiddenOpt) {
        menu.appendChild(_buildMenuOptionButton(sel, child, flatIndex));
        renderedCount++;
      }
      flatIndex++;
    }
  }

  if (renderedCount === 0) {
    return;
  }

  _upgradeMenuChunkIcons(menu);

  _activeSelect = sel;
  _activeTrigger = meta.trigger;
  meta.trigger.classList.add("is-open");
  meta.trigger.setAttribute("aria-expanded", "true");

  menu.hidden = false;
  _positionPortalMenu();

  const selectedBtn = menu.querySelector(".pxi-select-option.is-selected");
  if (selectedBtn && typeof selectedBtn.scrollIntoView === "function") {
    selectedBtn.scrollIntoView({ block: "nearest" });
  }
}

export function closeProxDMRSelectMenu(restoreFocus = false) {
  const prevTrigger = _activeTrigger;
  if (_portalMenu) {
    _portalMenu.hidden = true;
    _portalMenu.innerHTML = "";
  }
  if (_activeTrigger) {
    _activeTrigger.classList.remove("is-open");
    _activeTrigger.setAttribute("aria-expanded", "false");
  }
  _activeSelect = null;
  _activeTrigger = null;
  if (restoreFocus && prevTrigger && prevTrigger.isConnected && !prevTrigger.disabled) {
    try { prevTrigger.focus(); } catch (_) {}
  }
}

function _moveMenuHighlight(delta) {
  if (!_portalMenu || _portalMenu.hidden) return;
  const opts = Array.from(_portalMenu.querySelectorAll(".pxi-select-option:not(:disabled)"));
  if (!opts.length) return;
  const focusedIdx = opts.indexOf(document.activeElement);
  const selectedIdx = opts.findIndex((b) => b.classList.contains("is-selected"));
  let nextIdx;
  if (focusedIdx >= 0) {
    nextIdx = (focusedIdx + delta + opts.length) % opts.length;
  } else if (selectedIdx >= 0) {
    nextIdx = (selectedIdx + delta + opts.length) % opts.length;
  } else {
    nextIdx = delta >= 0 ? 0 : opts.length - 1;
  }
  const target = opts[nextIdx];
  if (target) {
    target.focus();
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "nearest" });
    }
  }
}

function _wrapBackHandler() {
  if (typeof window === "undefined") return;
  const orig = window.handleAppBack;
  if (typeof orig === "function" && !orig.__pxiSelectWrapped) {
    const wrapped = function (...args) {
      if (_portalMenu && !_portalMenu.hidden) {
        closeProxDMRSelectMenu(true);
        return true;
      }
      return orig.apply(this, args);
    };
    wrapped.__pxiSelectWrapped = true;
    window.handleAppBack = wrapped;
  }
}

function _wireGlobalListeners() {
  _wrapBackHandler();
  if (_globalsWired || typeof window === "undefined") return;
  _globalsWired = true;

  document.addEventListener("pointerdown", (e) => {
    if (!_portalMenu || _portalMenu.hidden) return;
    if (_portalMenu.contains(e.target)) return;
    if (_activeTrigger && _activeTrigger.contains(e.target)) return;
    closeProxDMRSelectMenu(false);
  }, true);

  document.addEventListener("keydown", (e) => {
    if (!_portalMenu || _portalMenu.hidden) return;
    const isSearchInputTarget = Boolean(
      e.target && e.target.classList && e.target.classList.contains("pxi-select-search-input")
    );
    if (isSearchInputTarget) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeProxDMRSelectMenu(true);
    } else if (e.key === "Tab") {
      closeProxDMRSelectMenu(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      _moveMenuHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      _moveMenuHighlight(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = _portalMenu.querySelector(".pxi-select-option:not(:disabled)");
      if (first) first.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const all = _portalMenu.querySelectorAll(".pxi-select-option:not(:disabled)");
      if (all.length) all[all.length - 1].focus();
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key && e.key.length === 1) {
      const searchEl = _portalMenu.querySelector(".pxi-select-search-input");
      if (searchEl) {
        e.preventDefault();
        searchEl.focus();
        searchEl.value = (searchEl.value || "") + e.key;
        searchEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } else if (e.key === "Backspace") {
      const searchEl = _portalMenu.querySelector(".pxi-select-search-input");
      if (searchEl && searchEl.value) {
        e.preventDefault();
        searchEl.focus();
        searchEl.value = searchEl.value.slice(0, -1);
        searchEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }, true);

  window.addEventListener("resize", () => {
    if (_portalMenu && !_portalMenu.hidden) _positionPortalMenu();
  }, { passive: true });

  window.addEventListener("scroll", (e) => {
    if (!_portalMenu || _portalMenu.hidden) return;
    if (e.target === _portalMenu || (_portalMenu.contains && e.target instanceof Node && _portalMenu.contains(e.target))) {
      return;
    }
    _positionPortalMenu();
  }, { passive: true, capture: true });
}

function _installPropertyHooks(sel) {
  if (sel._pxiPropHooked) return;
  sel._pxiPropHooked = true;

  if (_nativeValueDesc && _nativeValueDesc.get && _nativeValueDesc.set) {
    try {
      Object.defineProperty(sel, "value", {
        configurable: true,
        get() {
          return _nativeValueDesc.get.call(this);
        },
        set(v) {
          _nativeValueDesc.set.call(this, v);
          _syncTriggerVisuals(this);
        },
      });
    } catch (_) {}
  }

  if (_nativeIndexDesc && _nativeIndexDesc.get && _nativeIndexDesc.set) {
    try {
      Object.defineProperty(sel, "selectedIndex", {
        configurable: true,
        get() {
          return _nativeIndexDesc.get.call(this);
        },
        set(v) {
          _nativeIndexDesc.set.call(this, v);
          _syncTriggerVisuals(this);
        },
      });
    } catch (_) {}
  }
}

function _enhanceSelect(sel) {
  if (!sel || !sel.isConnected || !sel.parentNode) return;
  if (SELECT_META.has(sel)) {
    _syncTriggerVisuals(sel);
    return;
  }

  _wireGlobalListeners();
  _installPropertyHooks(sel);

  const bannerWrap = _isBannerServerSelect(sel) ? sel.closest(".bm-server-label-wrap") : null;
  let triggerEl;
  let labelEl;
  let arrowEl;
  const isBannerWrap = Boolean(bannerWrap);

  if (isBannerWrap) {
    triggerEl = bannerWrap;
    labelEl = bannerWrap.querySelector(".bm-server-name");
    arrowEl = bannerWrap.querySelector(".bm-server-dropdown-arrow");

    if (!bannerWrap.hasAttribute("tabindex")) bannerWrap.setAttribute("tabindex", "0");
    bannerWrap.setAttribute("role", "button");
    bannerWrap.setAttribute("aria-haspopup", "listbox");
    bannerWrap.setAttribute("aria-expanded", "false");

    sel.classList.add("pxi-select-native-hidden");
    sel.setAttribute("tabindex", "-1");
    sel.setAttribute("aria-hidden", "true");

    if (!bannerWrap._pxiBannerWired) {
      bannerWrap._pxiBannerWired = true;
      bannerWrap.addEventListener("click", (e) => {
        if (bannerWrap.classList.contains("srv-combo-active")) return;
        e.preventDefault();
        e.stopPropagation();
        _syncTriggerVisuals(sel);
        if (sel.disabled) return;
        try { sel.dispatchEvent(new Event("focus")); } catch (_) {}
        _openMenuForSelect(sel);
      });
      bannerWrap.addEventListener("keydown", (e) => {
        if (bannerWrap.classList.contains("srv-combo-active") || sel.disabled) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          try { sel.dispatchEvent(new Event("focus")); } catch (_) {}
          if (!_portalMenu || _portalMenu.hidden || _activeSelect !== sel) {
            _openMenuForSelect(sel);
          }
          if (e.key === "ArrowDown") _moveMenuHighlight(1);
          else if (e.key === "ArrowUp") _moveMenuHighlight(-1);
        }
      });
    }
  } else {
    const staleNext = sel.nextElementSibling;
    if (staleNext && staleNext.classList && staleNext.classList.contains("pxi-select-trigger")) {
      staleNext.remove();
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pxi-select-trigger";
    if (_isCompactSelect(sel)) btn.classList.add("pxi-select-compact");
    if (_isInlineSelect(sel)) btn.classList.add("pxi-select-inline");
    if (_isFlexSelect(sel)) btn.classList.add("pxi-select-flex");
    if (_isMiniSelect(sel)) btn.classList.add("pxi-select-mini");
    if (sel.classList.contains("local-demo-allowed")) btn.classList.add("local-demo-allowed");
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    if (sel.id) btn.dataset.forSelect = sel.id;

    labelEl = document.createElement("span");
    labelEl.className = "pxi-select-label";

    arrowEl = document.createElement("span");
    arrowEl.className = "pxi-select-arrow";
    arrowEl.setAttribute("aria-hidden", "true");
    arrowEl.textContent = "\u{1F53D}";

    btn.appendChild(labelEl);
    btn.appendChild(arrowEl);

    if (typeof window !== "undefined" && typeof window.upgradeProxDMRIcons === "function") {
      window.upgradeProxDMRIcons(arrowEl);
    } else {
      upgradeProxDMRIcons(arrowEl);
    }

    sel.classList.add("pxi-select-native-hidden");
    sel.setAttribute("tabindex", "-1");
    sel.setAttribute("aria-hidden", "true");
    sel.insertAdjacentElement("afterend", btn);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      _syncTriggerVisuals(sel);
      if (sel.disabled) return;
      _openMenuForSelect(sel);
    });

    btn.addEventListener("keydown", (e) => {
      if (sel.disabled) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        if (!_portalMenu || _portalMenu.hidden || _activeSelect !== sel) {
          _openMenuForSelect(sel);
        }
        if (e.key === "ArrowDown") _moveMenuHighlight(1);
        else if (e.key === "ArrowUp") _moveMenuHighlight(-1);
      }
    });

    sel.addEventListener("focus", () => {
      if (btn.isConnected && !btn.disabled && btn.style.display !== "none") {
        try { btn.focus(); } catch (_) {}
      }
    });

    triggerEl = btn;
  }

  sel.addEventListener("change", () => {
    _syncTriggerVisuals(sel);
  });

  const selObserver = new MutationObserver(() => {
    _syncTriggerVisuals(sel);
    if (_activeSelect === sel && _portalMenu && !_portalMenu.hidden) {
      const prevScroll = _portalMenu.scrollTop;
      const activeSearchEl = _portalMenu.querySelector(".pxi-select-search-input");
      const prevQuery = activeSearchEl ? activeSearchEl.value : "";
      const wasSearchFocused = Boolean(activeSearchEl && document.activeElement === activeSearchEl);
      closeProxDMRSelectMenu(false);
      _openMenuForSelect(sel, prevQuery, wasSearchFocused);
      if (_portalMenu && !_portalMenu.hidden) {
        _portalMenu.scrollTop = prevScroll;
      }
    }
  });
  selObserver.observe(sel, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "hidden", "style", "class", "title", "selected"],
  });

  SELECT_META.set(sel, { trigger: triggerEl, labelEl, arrowEl, isBannerWrap, observer: selObserver });
  ENHANCED_SET.add(sel);
  _syncTriggerVisuals(sel);
}

function _cleanupDisconnected() {
  for (const sel of Array.from(ENHANCED_SET)) {
    if (!sel.isConnected) {
      const meta = SELECT_META.get(sel);
      if (meta) {
        if (meta.observer) {
          try { meta.observer.disconnect(); } catch (_) {}
        }
        if (!meta.isBannerWrap && meta.trigger && meta.trigger.isConnected) {
          meta.trigger.remove();
        }
        SELECT_META.delete(sel);
      }
      if (_activeSelect === sel) {
        closeProxDMRSelectMenu(false);
      }
      ENHANCED_SET.delete(sel);
    }
  }
}

export function upgradeProxDMRSelects(root) {
  if (typeof document === "undefined") return;
  _cleanupDisconnected();

  const target = root || document.body;
  if (!target) return;

  const list = [];
  if (target.nodeType === 1 && target.tagName === "SELECT") {
    list.push(target);
  } else if (typeof target.querySelectorAll === "function") {
    target.querySelectorAll("select").forEach((s) => list.push(s));
  }

  for (let i = 0; i < list.length; i++) {
    const sel = list[i];
    if (SELECT_META.has(sel)) {
      _syncTriggerVisuals(sel);
    } else if (_selectNeedsEnhancement(sel)) {
      _enhanceSelect(sel);
    }
  }
}

function _scheduleScan() {
  if (_scanScheduled) return;
  _scanScheduled = true;
  queueMicrotask(() => {
    _scanScheduled = false;
    const roots = Array.from(_pendingRoots);
    _pendingRoots.clear();
    _cleanupDisconnected();
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      if (r && r.isConnected) {
        upgradeProxDMRSelects(r);
      }
    }
  });
}

function _startBodyObserver() {
  if (_bodyObserver || typeof MutationObserver === "undefined" || !document.body) return;
  _bodyObserver = new MutationObserver((mutations) => {
    let dirty = false;
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      if (m.type === "childList") {
        if (m.target && m.target.tagName === "SELECT") {
          _pendingRoots.add(m.target);
          dirty = true;
        }
        if (m.addedNodes && m.addedNodes.length) {
          for (let j = 0; j < m.addedNodes.length; j++) {
            const n = m.addedNodes[j];
            if (n.nodeType !== 1) continue;
            if (n.id === "proxdmrPxiSelectMenu" || (n.classList && n.classList.contains("pxi-select-trigger"))) continue;
            if (n.tagName === "SELECT" || n.tagName === "OPTION" || n.tagName === "OPTGROUP") {
              const sel = (n.tagName === "SELECT") ? n : n.closest("select");
              if (sel) {
                _pendingRoots.add(sel);
                dirty = true;
              }
            } else if (n.querySelector && n.querySelector("select")) {
              _pendingRoots.add(n);
              dirty = true;
            }
          }
        }
        if (m.removedNodes && m.removedNodes.length) {
          for (let j = 0; j < m.removedNodes.length; j++) {
            const r = m.removedNodes[j];
            if (r.nodeType === 1 && (r.tagName === "SELECT" || (r.querySelector && r.querySelector("select")))) {
              dirty = true;
            }
          }
        }
      }
    }
    if (dirty) _scheduleScan();
  });

  _bodyObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

export function initProxDMRSelects() {
  if (typeof document === "undefined" || !document.body) return;
  upgradeProxDMRSelects(document.body);
  _startBodyObserver();
}

if (typeof window !== "undefined") {
  window.upgradeProxDMRSelects = upgradeProxDMRSelects;
  window.closeProxDMRSelectMenu = closeProxDMRSelectMenu;
  window.ProxDMRSelects = {
    init: initProxDMRSelects,
    upgrade: upgradeProxDMRSelects,
    close: closeProxDMRSelectMenu,
    count: () => ENHANCED_SET.size,
  };
  window.addEventListener("languageChanged", () => {
    upgradeProxDMRSelects(document.body);
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { initProxDMRSelects(); }, { once: true });
  } else {
    initProxDMRSelects();
  }
}
