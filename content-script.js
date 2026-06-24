// content-script.js — ISOLATED world, form-builder iframe.
//
//   (1) Inject page-hook.js into the MAIN world (captures token-id, ids, button).
//   (2) Track context (tokenId / locationId / formId) from the MAIN world.
//   (3) On button click, host a Shadow-DOM modal: pick a tag (existing + create),
//       folder, workflow name → run GHL.orchestrate() with live progress.
//
// All GHL API calls go through lib/ghl.js (loaded before this file) which proxies
// through the background service worker. See docs/ghl-recon.md.

(function () {
  const SOURCE = "ghl-form-tag-workflow";
  const DEFAULT_FOLDER = "Forms → Tags";

  // --- inject MAIN-world hook ---
  try {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("page-hook.js");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    console.warn("[ghl-form-tag-workflow] page-hook injection failed:", e);
  }

  // --- context from MAIN world ---
  const ctx = { token: null, locationId: null, formId: null };
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== SOURCE) return;
    if (d.type === "context") {
      if (d.payload.tokenId) ctx.token = d.payload.tokenId;
      if (d.payload.locationId) ctx.locationId = d.payload.locationId;
      if (d.payload.formId) ctx.formId = d.payload.formId;
    } else if (d.type === "button-clicked") {
      openModal();
    }
  });

  function ready() { return !!(ctx.token && ctx.locationId && ctx.formId); }

  // ----------------------------------------------------------------------
  // Modal (Shadow DOM so GHL's CSS can't bleed in)
  // ----------------------------------------------------------------------
  const HOST_ID = "ghl-ftw-modal-host";
  let host = null;
  let shadow = null;
  let escHandler = null;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .backdrop {
      position: fixed; inset: 0; background: rgba(15,23,42,.55);
      backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
      z-index: 2147483647; display: flex; align-items: center; justify-content: center;
      animation: fade .16s ease;
    }
    @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
    @keyframes pop { from { opacity: 0; transform: scale(.97) } to { opacity: 1; transform: scale(1) } }
    .card {
      width: 460px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);
      background: #fff; border-radius: 8px; box-shadow: 0 10px 40px rgba(16,24,40,.18);
      overflow: hidden; animation: pop .16s ease; display: flex; flex-direction: column;
    }
    .head { padding: 20px 24px 14px; border-bottom: 1px solid #eaecf0; position: relative; }
    .head h2 { margin: 0; font-size: 18px; font-weight: 600; color: #101828; letter-spacing: -.01em; }
    .head p { margin: 5px 0 0; font-size: 13px; color: #667085; }
    .close {
      position: absolute; top: 18px; right: 18px; width: 24px; height: 24px;
      border: 0; background: transparent; color: #98a2b3; font-size: 20px;
      border-radius: 6px; cursor: pointer; line-height: 1;
    }
    .close:hover { background: #f2f4f7; color: #475467; }
    .body { padding: 18px 24px 6px; overflow: auto; }
    .field { margin: 0 0 16px; }
    label { display: block; font-size: 13px; font-weight: 500; color: #344054; margin-bottom: 6px; }
    input[type=text] {
      width: 100%; height: 40px; padding: 0 12px; font-size: 14px; color: #101828;
      border: 1px solid #d0d5dd; border-radius: 6px; outline: none; background: #fff;
      box-shadow: 0 1px 2px rgba(16,24,40,.05);
    }
    input[type=text]::placeholder { color: #98a2b3; }
    input[type=text]:focus { border-color: #2f6bf5; box-shadow: 0 0 0 3px rgba(47,107,245,.18); }
    .hint { font-size: 12px; color: #667085; margin-top: 6px; }
    .sugg { position: relative; }
    .sugglist {
      position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5;
      background: #fff; border: 1px solid #eaecf0; border-radius: 6px; box-shadow: 0 8px 24px rgba(16,24,40,.12);
      max-height: 180px; overflow: auto; padding: 4px;
    }
    .suggitem { padding: 8px 10px; font-size: 14px; border-radius: 4px; cursor: pointer; color: #101828; }
    .suggitem:hover, .suggitem.active { background: #f9fafb; }
    .suggitem .new { color: #2f6bf5; font-weight: 500; }
    .row { display: flex; align-items: center; gap: 8px; margin: 4px 0 2px; }
    .row input[type=checkbox] { width: 16px; height: 16px; accent-color: #2f6bf5; }
    .row label { margin: 0; font-weight: 400; font-size: 14px; color: #344054; }
    .foot { padding: 16px 24px 20px; border-top: 1px solid #eaecf0; margin-top: 16px; }
    .btn {
      width: 100%; height: 44px; border: 1px solid #2f6bf5; border-radius: 6px; cursor: pointer;
      font-size: 14px; font-weight: 600; color: #fff; background: #2f6bf5;
      box-shadow: 0 1px 2px rgba(16,24,40,.05);
    }
    .btn:hover { background: #2257d6; border-color: #2257d6; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .steps { margin: 4px 0 0; padding: 0; list-style: none; }
    .steps li { display: flex; align-items: center; gap: 9px; font-size: 13px; color: #475467; padding: 4px 0; }
    .dot { width: 16px; height: 16px; border-radius: 50%; flex: none; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; }
    .dot.pending { background: #eaecf0; }
    .dot.run { background: #b2ccff; }
    .dot.done { background: #12b76a; color: #fff; }
    .dot.err { background: #f04438; color: #fff; }
    .msg { font-size: 13px; margin-top: 14px; padding: 10px 12px; border-radius: 6px; display: none; }
    .msg.show { display: block; }
    .msg.error { background: #fffbfa; color: #b42318; border: 1px solid #fecdca; }
    .msg.success { background: #f6fef9; color: #027a48; border: 1px solid #a6f4c5; }
    .msg a { color: inherit; font-weight: 600; }
  `;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k.startsWith("on") && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
      else if (k === "checked") n.checked = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  }

  function closeModal() {
    if (host) { host.remove(); host = null; shadow = null; }
    if (escHandler) { document.removeEventListener("keydown", escHandler); escHandler = null; }
  }

  async function openModal() {
    if (host) return; // already open
    if (!ready()) {
      toast("Form is still loading… try again in a moment.");
      return;
    }

    host = el("div", { id: HOST_ID });
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    shadow.append(el("style", null, CSS));

    let chosenTag = "";
    let formName = null;

    // --- fields ---
    const tagInput = el("input", { type: "text", placeholder: "e.g. form-lead", autocomplete: "off" });
    const suggList = el("div", { class: "sugglist-wrap" });
    const folderInput = el("input", { type: "text", value: DEFAULT_FOLDER });
    const wfInput = el("input", { type: "text", placeholder: "Workflow name" });
    const publishCb = el("input", { type: "checkbox", checked: true });
    const createBtn = el("button", { class: "btn" }, "Create automation");
    const steps = el("ul", { class: "steps" });
    const msg = el("div", { class: "msg" });

    // restore last folder name (v2 key — ignores the stale pre-i18n value)
    try {
      chrome.storage.local.get(["folderNameV2"], (r) => {
        if (r && r.folderNameV2) folderInput.value = r.folderNameV2;
      });
    } catch { /* ignore */ }

    function refreshWfDefault() {
      if (wfInput.dataset.touched) return;
      const t = (chosenTag || tagInput.value || "tag").trim();
      const f = formName || "this form";
      wfInput.value = `Tag "${t}" — ${f}`;
    }
    wfInput.addEventListener("input", () => { wfInput.dataset.touched = "1"; });

    // --- tag suggestions (existing + create) ---
    let suggBox = null;
    let debounce = null;
    function clearSugg() { if (suggBox) { suggBox.remove(); suggBox = null; } }
    function showSugg(items, query) {
      clearSugg();
      if (!query) return;
      suggBox = el("div", { class: "sugglist" });
      const q = query.trim().toLowerCase();
      const exact = items.some((t) => (t).toLowerCase() === q);
      for (const t of items.slice(0, 6)) {
        suggBox.append(el("div", { class: "suggitem", onclick: () => pickTag(t) }, t));
      }
      if (!exact && query.trim()) {
        suggBox.append(el("div", { class: "suggitem", onclick: () => pickTag(query.trim()) },
          el("span", { class: "new" }, `+ Create "${query.trim()}"`)));
      }
      suggList.append(suggBox);
    }
    function pickTag(t) {
      chosenTag = t; tagInput.value = t; clearSugg(); refreshWfDefault();
    }
    tagInput.addEventListener("input", () => {
      chosenTag = tagInput.value.trim();
      refreshWfDefault();
      const q = tagInput.value.trim();
      clearTimeout(debounce);
      if (!q) { clearSugg(); return; }
      debounce = setTimeout(async () => {
        try {
          const tags = await GHL.searchTags(ctx.token, ctx.locationId, q);
          const names = tags.map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean);
          showSugg(names, q);
        } catch { /* ignore search errors */ }
      }, 250);
    });
    tagInput.addEventListener("blur", () => setTimeout(clearSugg, 150));

    // --- assemble ---
    const card = el("div", { class: "card" },
      el("div", { class: "head" },
        el("h2", null, "Create a tag automation"),
        el("p", null, "Form submitted → add a tag, without leaving the form."),
        el("button", { class: "close", title: "Close", onclick: closeModal }, "×"),
      ),
      el("div", { class: "body" },
        el("div", { class: "field" },
          el("label", null, "Tag to add"),
          el("div", { class: "sugg" }, tagInput, suggList),
          el("div", { class: "hint" }, "Pick an existing tag or type a new name (it will be created)."),
        ),
        el("div", { class: "field" },
          el("label", null, "Automation folder"),
          folderInput,
          el("div", { class: "hint" }, "Created automatically if it doesn't exist."),
        ),
        el("div", { class: "field" },
          el("label", null, "Workflow name"),
          wfInput,
        ),
        el("div", { class: "row" }, publishCb, el("label", null, "Publish the workflow immediately")),
        steps,
        msg,
      ),
      el("div", { class: "foot" }, createBtn),
    );

    const backdrop = el("div", { class: "backdrop", onclick: (e) => { if (e.target === backdrop) closeModal(); } }, card);
    shadow.append(backdrop);

    escHandler = (e) => { if (e.key === "Escape") closeModal(); };
    document.addEventListener("keydown", escHandler);

    // fetch form name for a nicer default
    refreshWfDefault();
    GHL.getFormName(ctx.token, ctx.formId).then((n) => { if (n) { formName = n; refreshWfDefault(); } });

    tagInput.focus();

    // --- step UI helpers ---
    const STEP_LABELS = {
      folder: "Folder", workflow: "Workflow", trigger: "Trigger \"Form submitted\"",
      tag: "Tag", action: "Action \"Add tag\"", publish: "Publish",
    };
    const stepNodes = {};
    function renderStep(key, status, text) {
      let li = stepNodes[key];
      if (!li) {
        const dot = el("span", { class: "dot pending" });
        const span = el("span", null, STEP_LABELS[key] || key);
        li = el("li", null, dot, span);
        li._dot = dot; li._span = span;
        stepNodes[key] = li; steps.append(li);
      }
      li._dot.className = "dot " + (status === "done" ? "done" : status === "err" ? "err" : status === "run" ? "run" : "pending");
      li._dot.textContent = status === "done" ? "✓" : status === "err" ? "!" : "";
      if (text) li._span.textContent = text;
    }
    function showMsg(kind, html) {
      msg.className = "msg show " + kind;
      msg.innerHTML = html;
    }

    // --- submit ---
    createBtn.addEventListener("click", async () => {
      const tag = (chosenTag || tagInput.value).trim();
      const folderName = folderInput.value.trim() || DEFAULT_FOLDER;
      const workflowName = wfInput.value.trim() || `Tag "${tag}"`;
      if (!tag) { showMsg("error", "Please enter a tag."); tagInput.focus(); return; }
      clearSugg();
      createBtn.disabled = true;
      msg.className = "msg";
      try { chrome.storage.local.set({ folderNameV2: folderName }); } catch { /* ignore */ }

      try {
        const res = await GHL.orchestrate(
          { token: ctx.token, locationId: ctx.locationId, formId: ctx.formId },
          {
            folderName, workflowName, tag, publish: publishCb.checked,
            onStep: (key, status, text) => renderStep(key, status, text),
          },
        );
        // The wrapper (white-label) origin is the parent page that embedded this iframe.
        let wrapperOrigin = "https://app.gohighlevel.com";
        try { if (document.referrer) wrapperOrigin = new URL(document.referrer).origin; } catch { /* ignore */ }
        const wfUrl = `${wrapperOrigin}/v2/location/${ctx.locationId}/automation/workflow/${res.wfId}`;
        showMsg("success",
          `Automation created${publishCb.checked ? " and published" : " (draft)"}. `
          + `<a href="${wfUrl}" target="_blank" rel="noopener">Open workflow →</a>`);
        createBtn.textContent = "Done";
      } catch (e) {
        // mark the running step as errored
        for (const k in stepNodes) {
          if (stepNodes[k]._dot.classList.contains("run")) renderStep(k, "err");
        }
        showMsg("error", "Failed: " + String((e && e.message) || e));
        createBtn.disabled = false;
      }
    });
  }

  // --- tiny toast for "not ready yet" ---
  function toast(text) {
    const t = el("div", null, text);
    t.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);"
      + "background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;"
      + "font-family:sans-serif;z-index:2147483647;box-shadow:0 6px 20px rgba(0,0,0,.25)";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
})();
