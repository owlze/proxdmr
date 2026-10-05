// Toast and HUD Notifications

  export function showCenterHudToast(text, duration = 2000) {
    const old = document.getElementById("proxdmrCenterHudToast");
    if (old) old.remove();

    const hud = document.createElement("div");
    hud.id = "proxdmrCenterHudToast";
    hud.style.cssText = [
      "position: fixed;",
      "top: 50%;",
      "left: 50%;",
      "transform: translate(-50%, -50%) scale(0.85);",
      "z-index: 100000;",
      "background: rgba(18, 22, 30, 0.94);",
      "border: 1.5px solid rgba(255, 255, 255, 0.22);",
      "box-shadow: 0 16px 48px rgba(0, 0, 0, 0.75), 0 0 20px rgba(0,0,0,0.3);",
      "color: #ffffff;",
      "padding: 16px 28px;",
      "border-radius: 16px;",
      "font-size: 1.25rem;",
      "font-weight: 700;",
      "letter-spacing: 0.5px;",
      "text-align: center;",
      "white-space: nowrap;",
      "backdrop-filter: blur(14px);",
      "-webkit-backdrop-filter: blur(14px);",
      "pointer-events: none;",
      "user-select: none;",
      "opacity: 0;",
      "transition: opacity 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);"
    ].join("");

    hud.textContent = text;
    document.body.appendChild(hud);

    requestAnimationFrame(() => {
      hud.style.opacity = "1";
      hud.style.transform = "translate(-50%, -50%) scale(1)";
    });

    setTimeout(() => {
      hud.style.opacity = "0";
      hud.style.transform = "translate(-50%, -50%) scale(0.92)";
      setTimeout(() => {
        if (hud.parentNode) hud.remove();
      }, 300);
    }, duration);
  }


  export function showToast(msg, duration = 3500) {
    let container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "toastContainer";
      container.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;pointer-events:none;display:flex;flex-direction:column;gap:8px;align-items:center;width:max-content;max-width:90vw;";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.style.cssText = "background:rgba(22,27,34,0.96);border:1px solid #30363d;box-shadow:0 8px 24px rgba(0,0,0,0.6);color:#c9d1d9;padding:10px 18px;border-radius:8px;font-size:0.85rem;font-weight:500;text-align:center;backdrop-filter:blur(8px);transition:opacity 0.25s ease,transform 0.25s ease;opacity:0;transform:translateY(10px);pointer-events:auto;";
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  if (typeof window !== "undefined") {
    window.showToast = showToast;
    window.showCenterHudToast = showCenterHudToast;
    window.__proxdmr = window.__proxdmr || {};
    window.__proxdmr.showToast = showToast;
    window.__proxdmr.showCenterHudToast = showCenterHudToast;
  }

