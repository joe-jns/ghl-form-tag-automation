// page-hook.js — runs in the MAIN world of the iframe at
// leadgen-apps-form-survey-builder.leadconnectorhq.com (the GHL form builder).
//
//   (1) Capture the live `token-id` JWT header on outgoing requests to
//       *.leadconnectorhq.com so the rest of the extension can replay GHL
//       workflow/tag API calls with the same auth.
//   (2) Capture the current locationId and formId from the URLs the builder
//       fetches (the iframe URL itself does not carry them reliably).
//   (3) Inject the "Auto-tag" button into the builder toolbar.
//   (4) On click, postMessage to the content script (ISOLATED world), which
//       owns the modal + orchestration.

(function () {
  const SOURCE = "ghl-form-tag-workflow";
  const LC_HOST_RE = /\.leadconnectorhq\.com$/;

  let tokenId = null;
  let locationId = null;
  let formId = null;

  // /forms/{id} sub-paths that are NOT a form id.
  const FORM_NON_IDS = new Set([
    "themes", "default-colors", "theme-style", "submit", "folder", "tags",
  ]);

  function broadcast() {
    window.postMessage(
      {
        source: SOURCE,
        type: "context",
        payload: { tokenId, locationId, formId, capturedAt: Date.now() },
      },
      "*",
    );
  }

  function captureFromUrl(url) {
    let changed = false;
    try {
      const u = new URL(url, window.location.href);
      if (!LC_HOST_RE.test(u.host)) return false;

      // locationId — from query (?locationId=) or /locations/{id}/ path.
      const qLoc = u.searchParams.get("locationId") || u.searchParams.get("location_id");
      if (qLoc && qLoc !== locationId) { locationId = qLoc; changed = true; }
      const mLoc = u.pathname.match(/\/locations\/([A-Za-z0-9]{15,})/);
      if (mLoc && mLoc[1] !== locationId) { locationId = mLoc[1]; changed = true; }

      // formId — from services.../forms/{id} (the form being edited).
      const mForm = u.pathname.match(/\/forms\/([A-Za-z0-9]{15,})(?:[/?#]|$)/);
      if (mForm && !FORM_NON_IDS.has(mForm[1]) && mForm[1] !== formId) {
        formId = mForm[1]; changed = true;
      }
    } catch { /* ignore */ }
    return changed;
  }

  function captureTokenId(value) {
    if (typeof value !== "string" || !value) return false;
    if (value !== tokenId) { tokenId = value; return true; }
    return false;
  }

  function readHeader(hdrs, name) {
    if (!hdrs) return undefined;
    if (hdrs instanceof Headers) return hdrs.get(name);
    if (Array.isArray(hdrs)) {
      const f = hdrs.find((h) => String(h[0]).toLowerCase() === name);
      return f ? f[1] : undefined;
    }
    if (typeof hdrs === "object") {
      for (const k of Object.keys(hdrs)) {
        if (k.toLowerCase() === name) return hdrs[k];
      }
    }
    return undefined;
  }

  // --- Patch fetch ---
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input && input.url;
      let changed = url ? captureFromUrl(url) : false;
      const tok = readHeader(init && init.headers, "token-id")
        || (input instanceof Request ? readHeader(input.headers, "token-id") : undefined);
      if (tok && captureTokenId(tok)) changed = true;
      if (changed) broadcast();
    } catch { /* ignore */ }
    return origFetch.apply(this, arguments);
  };

  // --- Patch XHR ---
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { if (captureFromUrl(url)) broadcast(); } catch { /* ignore */ }
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (name && name.toLowerCase() === "token-id" && captureTokenId(value)) broadcast();
    } catch { /* ignore */ }
    return xhrSet.apply(this, arguments);
  };

  // ----------------------------------------------------------------------
  // Button injection
  // ----------------------------------------------------------------------
  const BTN_ID = "ghl-ftw-button";

  // Matches GHL's secondary (white/outline) toolbar buttons (Preview / Integrate).
  const BTN_STYLE = [
    "display:inline-flex", "align-items:center", "justify-content:center",
    "gap:6px", "height:36px", "padding:0 14px", "margin-right:8px",
    "font-family:inherit", "font-size:13px", "font-weight:600",
    "color:#1e293b",
    "background:#fff",
    "border:1px solid #e2e8f0", "border-radius:8px",
    "cursor:pointer", "white-space:nowrap", "user-select:none", "outline:none",
    "transition:background .12s ease,transform .12s ease",
  ].join(";");

  function buildButton(floating) {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.setAttribute("aria-label", "Create a tag automation");
    btn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/>'
      + '<circle cx="7" cy="7" r="1.2" fill="currentColor"/></svg>'
      + '<span>Auto-tag</span>';
    btn.style.cssText = BTN_STYLE + (floating
      ? ";position:fixed;top:12px;right:16px;z-index:2147483646;box-shadow:0 4px 14px rgba(0,0,0,.18)"
      : "");
    btn.onmouseenter = () => { btn.style.background = "#f8fafc"; };
    btn.onmouseleave = () => { btn.style.background = "#fff"; };
    btn.onmousedown = () => { btn.style.transform = "translateY(1px)"; };
    btn.onmouseup = () => { btn.style.transform = "translateY(0)"; };
    btn.onclick = () => {
      window.postMessage({ source: SOURCE, type: "button-clicked" }, "*");
    };
    return btn;
  }

  // Find a native toolbar button to anchor next to (Save / Publish / Integrate).
  const ANCHOR_RE = /^(save|publish|integrate|enregistrer|publier|int[ée]grer|preview|aper[çc]u)$/i;
  function findAnchor() {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find((b) => ANCHOR_RE.test((b.textContent || "").trim())) || null;
  }

  function ensureButton() {
    if (!formId) return; // wait until we know which form we're on
    const existing = document.getElementById(BTN_ID);
    const anchor = findAnchor();

    if (existing) {
      // Upgrade a floating button to anchored once the toolbar shows up.
      if (existing.dataset.mode === "floating" && anchor) existing.remove();
      else return;
    }

    if (anchor && anchor.parentNode) {
      const btn = buildButton(false);
      btn.dataset.mode = "anchored";
      anchor.parentNode.insertBefore(btn, anchor);
      return;
    }
    if (!document.body) return;
    const btn = buildButton(true);
    btn.dataset.mode = "floating";
    document.body.appendChild(btn);
  }

  const observer = new MutationObserver(() => ensureButton());
  function start() {
    if (!document.body) return false;
    observer.observe(document.body, { childList: true, subtree: true });
    ensureButton();
    return true;
  }
  if (!start()) document.addEventListener("DOMContentLoaded", start, { once: true });

  // Safety net for SPA re-renders + re-broadcast context to a (re)loaded CS.
  setInterval(() => { ensureButton(); if (tokenId && formId) broadcast(); }, 2000);
})();
