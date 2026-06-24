// background.js — MV3 service worker.
//
// Acts as a CORS-free authenticated fetch proxy. The content script runs
// inside the form-builder iframe (origin leadgen-apps-form-survey-builder…)
// whose CORS allowance for the workflow service is not guaranteed. Fetches
// issued from the service worker use the extension's host_permissions and are
// NOT subject to page CORS, so they always succeed regardless of origin.
//
// Message: { type: "ghl-fetch", method, url, headers, body }
// Reply:   { ok, status, data }   (data = parsed JSON when possible, else text)

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "ghl-fetch") return false;

  (async () => {
    try {
      const init = {
        method: msg.method || "GET",
        headers: msg.headers || {},
        credentials: "omit",
      };
      if (msg.body != null) {
        init.body = typeof msg.body === "string" ? msg.body : JSON.stringify(msg.body);
      }
      const r = await fetch(msg.url, init);
      const text = await r.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      sendResponse({ ok: r.ok, status: r.status, data });
    } catch (e) {
      sendResponse({ ok: false, status: 0, data: String((e && e.message) || e) });
    }
  })();

  return true; // async response
});
