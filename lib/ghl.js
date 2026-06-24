// lib/ghl.js — GoHighLevel private-API client + orchestration.
// Runs in the content script (ISOLATED world). All network calls are proxied
// through the background service worker (background.js) to bypass page CORS.
//
// Endpoints + payload shapes are documented in docs/ghl-recon.md (validated
// 2026-06-24 by live replay).

(function () {
  const BACKEND = "https://backend.leadconnectorhq.com";
  const SERVICES = "https://services.leadconnectorhq.com";
  const WF_VERSION = "2021-04-15";   // workflow / tags service
  const FORM_VERSION = "2021-07-28"; // forms service

  // --- low-level proxy fetch via background ---
  function proxyFetch(method, url, { token, body, version }) {
    const headers = {
      "token-id": token,
      "channel": "APP",
      "source": "WEB_USER",
      "version": version || WF_VERSION,
      "accept": "application/json",
    };
    if (body != null) headers["content-type"] = "application/json";
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "ghl-fetch", method, url, headers, body },
        (res) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          if (!res) return reject(new Error("No response from the service worker"));
          if (!res.ok) {
            const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
            return reject(new Error(`HTTP ${res.status} — ${String(detail).slice(0, 300)}`));
          }
          resolve(res.data);
        },
      );
    });
  }

  // --- helpers ---
  function decodeJwt(token) {
    try {
      const payload = token.split(".")[1];
      const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(json);
    } catch {
      return {};
    }
  }

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    // Fallback RFC4122-ish.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // --- forms ---
  async function getFormName(token, formId) {
    try {
      const d = await proxyFetch("GET", `${SERVICES}/forms/${encodeURIComponent(formId)}`, {
        token, version: FORM_VERSION,
      });
      return (d && (d.name || (d.form && d.form.name))) || null;
    } catch {
      return null;
    }
  }

  // --- folders ---
  async function listEntries(token, loc, parentId = "root") {
    const url = `${BACKEND}/workflow/${loc}/list?parentId=${parentId}`
      + `&limit=200&offset=0&sortBy=name&sortOrder=asc`
      + `&includeCustomObjects=true&includeObjectiveBuilder=true`;
    const d = await proxyFetch("GET", url, { token });
    return (d && d.rows) || [];
  }

  async function findOrCreateFolder(token, loc, userId, companyId, name) {
    const rows = await listEntries(token, loc, "root");
    const wanted = name.trim().toLowerCase();
    const existing = rows.find(
      (r) => r.type === "directory" && (r.name || "").trim().toLowerCase() === wanted,
    );
    if (existing) return { id: existing.id || existing._id, created: false };

    const res = await proxyFetch("POST", `${BACKEND}/workflow/${loc}/directory`, {
      token,
      body: {
        type: "directory",
        name: name.trim(),
        updatedBy: userId,
        parentId: null,
        company_id: companyId,
        company_age: 0,
      },
    });
    return { id: res.id, created: true };
  }

  // --- workflow ---
  async function createWorkflow(token, loc, userId, companyId, name, folderId) {
    const res = await proxyFetch("POST", `${BACKEND}/workflow/${loc}`, {
      token,
      body: {
        name,
        status: "draft",
        parentId: folderId,
        updatedBy: userId,
        modifiedSteps: [],
        deletedSteps: [],
        createdSteps: [],
        senderAddress: {},
        stopOnResponse: false,
        allowMultiple: true,
        allowMultipleOpportunity: true,
        autoMarkAsRead: false,
        eventStartDate: "",
        timezone: "",
        workflowData: { templates: [] },
        triggersChanged: false,
        company_id: companyId,
        company_age: 0,
      },
    });
    return res.id;
  }

  async function getWorkflow(token, loc, wfId, sessionId) {
    const url = `${BACKEND}/workflow/${loc}/${wfId}`
      + `?includeScheduledPauseInfo=true&sessionId=${sessionId}`;
    return proxyFetch("GET", url, { token });
  }

  // --- trigger (Form submitted, bound to this form) ---
  async function createFormTrigger(token, loc, companyId, wfId, formId) {
    const triggerBody = {
      status: "draft",
      workflowId: wfId,
      schedule_config: {},
      conditions: [
        { operator: "is-any-of", field: "form.id", value: [formId], title: "Form is", type: "string" },
      ],
      type: "form_submission",
      masterType: "highlevel",
      name: "Form Submitted",
      actions: [{ workflow_id: wfId, type: "add_to_workflow" }],
      active: true,
      triggersChanged: true,
      location_id: loc,
      company_id: companyId,
      company_age: 0,
    };
    const res = await proxyFetch("POST", `${BACKEND}/workflow/${loc}/trigger`, {
      token, body: triggerBody,
    });
    // Reconstruct the stored trigger object for the workflow doc (new/oldTriggers).
    const stored = {
      status: "draft",
      workflowId: wfId,
      schedule_config: {},
      conditions: triggerBody.conditions,
      type: "form_submission",
      masterType: "highlevel",
      name: "Form Submitted",
      actions: [{ workflow_id: wfId, type: "add_to_workflow" }],
      active: true,
      id: res.id,
      location_id: loc,
    };
    return stored;
  }

  // --- tags ---
  async function searchTags(token, loc, query) {
    const url = `${BACKEND}/locations/${loc}/tags/search`
      + `?query=${encodeURIComponent(query)}&limit=30&skip=0`;
    const d = await proxyFetch("GET", url, { token });
    return (d && d.tags) || [];
  }

  async function listTags(token, loc) {
    const d = await proxyFetch("GET", `${BACKEND}/locations/${loc}/tags`, { token });
    return (d && d.tags) || [];
  }

  async function createTag(token, loc, tag) {
    await proxyFetch("POST", `${BACKEND}/workflow/${loc}/tags/create`, {
      token, body: { tag },
    });
  }

  async function ensureTag(token, loc, tag) {
    const name = tag.trim();
    const found = await searchTags(token, loc, name);
    const exact = found.find(
      (t) => (typeof t === "string" ? t : t.name || "").trim().toLowerCase() === name.toLowerCase(),
    );
    if (exact) return false;
    await createTag(token, loc, name);
    return true;
  }

  // --- add-tag action via auto-save ---
  async function addTagAction(token, loc, userId, wfId, sessionId, trigger, tag) {
    const base = await getWorkflow(token, loc, wfId, sessionId);
    const stepId = uuid();
    const step = {
      id: stepId,
      order: (base.workflowData && base.workflowData.templates ? base.workflowData.templates.length : 0),
      name: "Add Tag",
      type: "add_contact_tag",
      attributes: { tags: [tag] },
    };
    const templates = (base.workflowData && base.workflowData.templates) || [];
    const body = {
      ...base,
      workflowData: { ...(base.workflowData || {}), templates: [...templates, step] },
      modifiedSteps: [],
      deletedSteps: [],
      createdSteps: [stepId],
      senderAddress: base.senderAddress || {},
      eventStartDate: base.eventStartDate || "",
      triggersChanged: false,
      oldTriggers: [trigger],
      newTriggers: [trigger],
      isAutoSave: true,
      autoSaveSession: { workflowId: wfId, id: sessionId, userId, version: 1, inProgress: true },
    };
    await proxyFetch("PUT", `${BACKEND}/workflow/${loc}/${wfId}/auto-save`, { token, body });
    return stepId;
  }

  // --- publish ---
  async function publishWorkflow(token, loc, wfId, sessionId, trigger, tag) {
    const base = await getWorkflow(token, loc, wfId, sessionId);
    // Safety: make sure the add-tag step survived into the fetched doc.
    let templates = (base.workflowData && base.workflowData.templates) || [];
    if (!templates.some((t) => t.type === "add_contact_tag")) {
      templates = [...templates, {
        id: uuid(), order: templates.length, name: "Add Tag",
        type: "add_contact_tag", attributes: { tags: [tag] },
      }];
    }
    const body = {
      ...base,
      status: "published",
      workflowData: { ...(base.workflowData || {}), templates },
      modifiedSteps: [],
      deletedSteps: [],
      createdSteps: [],
      senderAddress: base.senderAddress || {},
      eventStartDate: base.eventStartDate || "",
      triggersChanged: false,
      oldTriggers: [trigger],
      newTriggers: [trigger],
    };
    delete body.isAutoSave;
    delete body.autoSaveSession;
    await proxyFetch("PUT", `${BACKEND}/workflow/${loc}/${wfId}`, { token, body });
  }

  // --- full orchestration ---
  // ctx: { token, locationId, formId }
  // opts: { folderName, workflowName, tag, publish, onStep }
  async function orchestrate(ctx, opts) {
    const { token, locationId: loc, formId } = ctx;
    const { folderName, workflowName, tag } = opts;
    const onStep = opts.onStep || (() => {});
    const jwt = decodeJwt(token);
    const userId = jwt.user_id;
    const companyId = jwt.company_id;
    if (!userId || !companyId) throw new Error("Invalid token-id (missing user_id/company_id)");

    const sessionId = uuid();

    onStep("folder", "run", "Folder…");
    const folder = await findOrCreateFolder(token, loc, userId, companyId, folderName);
    onStep("folder", "done", folder.created ? "Folder created" : "Reused existing folder");

    onStep("workflow", "run", "Creating workflow…");
    const wfId = await createWorkflow(token, loc, userId, companyId, workflowName, folder.id);
    onStep("workflow", "done", "Workflow created");

    onStep("trigger", "run", "Trigger \"Form submitted\"…");
    const trigger = await createFormTrigger(token, loc, companyId, wfId, formId);
    onStep("trigger", "done", "Trigger bound to the form");

    onStep("tag", "run", "Tag…");
    const tagCreated = await ensureTag(token, loc, tag);
    onStep("tag", "done", tagCreated ? `Tag "${tag}" created` : `Tag "${tag}" already exists`);

    onStep("action", "run", "Action \"Add tag\"…");
    await addTagAction(token, loc, userId, wfId, sessionId, trigger, tag);
    onStep("action", "done", "Action added");

    if (opts.publish) {
      onStep("publish", "run", "Publishing…");
      await publishWorkflow(token, loc, wfId, sessionId, trigger, tag);
      onStep("publish", "done", "Workflow published");
    }

    return { wfId, folderId: folder.id };
  }

  globalThis.GHL = {
    decodeJwt, getFormName, searchTags, listTags, orchestrate,
  };
})();
