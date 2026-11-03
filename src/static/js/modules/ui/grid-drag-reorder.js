/**
 * ProxDMR - Hotspot Grid Drag-and-Drop Reorder Module
 *
 * Implements intuitive grid-based reordering for both expanded and collapsed hotspot cards.
 * Key constraints:
 * - 1st hotspot is permanently fixed in top-left (is-primary-fixed, never moved or displaced).
 * - Grab handle is strictly the empty/neutral space of .radio-header (interactive children excluded).
 * - 8px movement threshold prevents accidental drag on normal clicks.
 * - Smooth visual avatar clone + placeholder with real-time slot displacement.
 * - Modern PointerEvents for 100% desktop, touch & Android APK compatibility.
 */

let _dragState = null;
let _isDragReorderWired = false;

export function initGridDragReorder(radiosGrid, onReorderCallback) {
  if (!radiosGrid || radiosGrid._dragReorderWired) return;
  radiosGrid._dragReorderWired = true;

  const interactiveSelector = `
    button,
    input,
    select,
    textarea,
    a,
    [role="button"],
    .hotspot-collapse-btn,
    .hotspot-network-badge,
    .header-rec-btn,
    .header-transcribe-btn,
    .btn-header-power,
    .fullscreen-toggle-btn,
    .brand-logo-wrap,
    .chip-del,
    .header-bm-upload-indicator,
    .header-tts-upload-indicator,
    .hotspot-delete-btn
  `;

  // 1. Pointer Down: detect intention to drag
  radiosGrid.addEventListener("pointerdown", (e) => {
    // Only primary button (left mouse) or touch/pen
    if (e.pointerType === "mouse" && e.button !== 0) return;

    // Check if target is inside an interactive control
    if (e.target.closest(interactiveSelector)) return;

    // Must be inside .radio-header
    const header = e.target.closest(".radio-header");
    if (!header) return;

    // Must be inside a .radio-container
    const card = header.closest(".radio-container");
    if (!card) return;

    // 1st hotspot is fixed and immutable
    if (card.classList.contains("is-primary-fixed")) return;

    // Ensure it's inside radiosGrid
    if (!radiosGrid.contains(card)) return;

    // Register pending drag state
    const rect = card.getBoundingClientRect();
    _dragState = {
      card,
      cardId: card.dataset.hotspotId || "",
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      initialRect: rect,
      pointerId: e.pointerId,
      isDragging: false,
      avatar: null,
      lastTarget: null
    };
  });

  // 2. Pointer Move: threshold check & active dragging
  window.addEventListener("pointermove", (e) => {
    if (!_dragState) return;

    if (!_dragState.isDragging) {
      const dist = Math.hypot(e.clientX - _dragState.startX, e.clientY - _dragState.startY);
      if (dist < 8) return; // Below threshold

      // Activate Drag Mode!
      _dragState.isDragging = true;
      document.body.classList.add("is-hotspot-dragging");

      // Capture pointer
      try {
        _dragState.card.setPointerCapture(_dragState.pointerId);
      } catch (_) {}

      // Create floating avatar clone
      const card = _dragState.card;
      const rect = card.getBoundingClientRect();
      const avatar = card.cloneNode(true);
      avatar.className = `${card.className} hotspot-drag-avatar`;
      avatar.style.width = `${rect.width}px`;
      avatar.style.height = `${rect.height}px`;
      avatar.style.left = `${rect.left}px`;
      avatar.style.top = `${rect.top}px`;
      avatar.style.transform = "translate3d(0, 0, 0) rotate(1.5deg) scale(1.02)";
      document.body.appendChild(avatar);
      _dragState.avatar = avatar;

      // Mark original card as placeholder in grid
      card.classList.add("is-drag-placeholder");
    }

    if (_dragState.isDragging && _dragState.avatar) {
      // Update avatar position
      const dx = e.clientX - _dragState.startX;
      const dy = e.clientY - _dragState.startY;
      _dragState.avatar.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(1.5deg) scale(1.02)`;

      // Real-time slot displacement
      const elemBelow = document.elementFromPoint(e.clientX, e.clientY);
      const targetCard = elemBelow ? elemBelow.closest(".radio-container") : null;

      if (
        targetCard &&
        targetCard !== _dragState.card &&
        radiosGrid.contains(targetCard) &&
        !targetCard.classList.contains("is-primary-fixed")
      ) {
        const stack = targetCard.closest(".collapsed-hotspots-stack");
        const isDraggingCollapsed = _dragState.card.classList.contains("collapsed");

        if (stack && !isDraggingCollapsed) {
          // Dragging an expanded card over a collapsed card in a stack:
          // displace relative to the stack container in radiosGrid
          const sRect = stack.getBoundingClientRect();
          const isPastCenter = e.clientX > sRect.left + sRect.width / 2;
          if (isPastCenter) {
            if (stack.nextElementSibling !== _dragState.card) {
              stack.after(_dragState.card);
            }
          } else {
            if (stack.previousElementSibling !== _dragState.card) {
              stack.before(_dragState.card);
            }
          }
        } else {
          // Standard displacement within stack or grid
          const tRect = targetCard.getBoundingClientRect();
          const isHorizontal = Math.abs(e.clientX - (tRect.left + tRect.width / 2)) > Math.abs(e.clientY - (tRect.top + tRect.height / 2));
          const isPastCenter = isHorizontal
            ? (e.clientX > tRect.left + tRect.width / 2)
            : (e.clientY > tRect.top + tRect.height / 2);

          if (isPastCenter) {
            if (targetCard.nextElementSibling !== _dragState.card) {
              targetCard.after(_dragState.card);
            }
          } else {
            if (targetCard.previousElementSibling !== _dragState.card) {
              targetCard.before(_dragState.card);
            }
          }
        }
      }
    }
  });

  // 3. Pointer Up / Cancel: finish and commit reorder
  const finishDrag = async (e) => {
    if (!_dragState) return;
    const state = _dragState;
    _dragState = null;

    if (!state.isDragging) return;

    // Release pointer capture
    try {
      state.card.releasePointerCapture(state.pointerId);
    } catch (_) {}

    document.body.classList.remove("is-hotspot-dragging");

    // Smoothly remove avatar
    if (state.avatar) {
      state.avatar.remove();
    }

    // Restore source card appearance
    state.card.classList.remove("is-drag-placeholder");

    // Read new order from DOM
    const allCards = Array.from(radiosGrid.querySelectorAll(".radio-container"));
    const visibleNewIds = allCards.map(c => c.dataset.hotspotId).filter(Boolean);

    // Ensure 1st fixed primary card is always at index 0
    const allHotspots = (typeof window !== "undefined" && Array.isArray(window.currentHotspots)) ? window.currentHotspots : [];
    const primaryId = (allHotspots[0] && allHotspots[0].id) ||
      (radiosGrid.querySelector(".radio-container.is-primary-fixed")?.dataset.hotspotId);

    let reorderedVisible = visibleNewIds;
    if (primaryId) {
      reorderedVisible = [primaryId, ...visibleNewIds.filter(id => id !== primaryId)];
    }

    // Preserve any hidden / archived hotspots (not present in DOM) at the end in their existing relative order
    const hiddenIds = allHotspots.map(h => h.id).filter(id => !reorderedVisible.includes(id));
    const finalOrder = [...reorderedVisible, ...hiddenIds];

    // Check if order actually changed across all known hotspots
    const oldOrder = allHotspots.map(h => h.id);
    const hasChanged = finalOrder.length === oldOrder.length && finalOrder.some((id, idx) => id !== oldOrder[idx]);

    if (hasChanged && typeof onReorderCallback === "function") {
      try {
        await onReorderCallback(finalOrder);
      } catch (err) {
        console.error("[GRID-DRAG] Failed to commit reorder:", err);
      }
    } else {
      if (typeof window.renderRadiosGrid === "function") {
        window.renderRadiosGrid();
      }
    }
  };

  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", finishDrag);

  // Prevent browser contextmenu on touch hold when dragging on mobile
  radiosGrid.addEventListener("contextmenu", (e) => {
    if (_dragState) {
      e.preventDefault();
    }
  });
}
