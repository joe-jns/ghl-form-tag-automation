<div align="center">

<img src="icons/128.png" width="88" alt="Auto-tag icon" />

# Auto-tag for GoHighLevel Forms

**Tag your form leads automatically — in one click, right from the form builder.**

No more jumping into the workflow builder every time you create a form.

</div>

---

## 🤔 What problem does this solve?

In GoHighLevel, when you want a form to **add a tag** to every person who submits it, you normally have to:

1. leave your form,
2. go to **Automation → Workflows**,
3. create a folder,
4. create a workflow,
5. add a *"Form submitted"* trigger,
6. point it at the right form,
7. add an *"Add tag"* action,
8. pick the tag,
9. publish.

Every. Single. Time. 😮‍💨

**This extension does all of that for you in one click**, without ever leaving the form you're working on.

---

## ✨ How it works

While editing a form, you'll see a new **“Auto-tag”** button in the toolbar:

> 1. Click **Auto-tag**
> 2. Type or pick a **tag** (it's created for you if it doesn't exist yet)
> 3. Click **Create automation**

That's it. Behind the scenes it instantly builds — and publishes — a complete workflow:

```
   📝  Someone submits THIS form
              │
              ▼
   🏷️  The tag you chose is added to their contact
```

It even keeps things tidy by putting every workflow it creates into a single folder (**“Forms → Tags”** by default), and **reuses that folder** instead of making a new one each time.

---

## 🚀 Install (5 minutes, no coding needed)

This extension isn't on the Chrome Web Store yet, so you load it manually. It's easy:

1. **Download this project** — click the green **`Code`** button above → **Download ZIP**, then unzip it somewhere you'll remember.
2. Open Google Chrome and go to **`chrome://extensions`** (copy-paste that into the address bar).
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the folder you just unzipped.
5. Done! Pin the little tag icon to your toolbar so it's easy to find. 📌

> 💡 **Already use Chrome?** This works in any Chromium browser (Chrome, Edge, Brave, Arc…).

---

## 🧭 Using it

1. In GoHighLevel, open a form for editing (**Sites → Forms →** open a form).
2. Look at the top toolbar — the **Auto-tag** button sits next to *Preview / Integrate / Save*.
3. Click it. A small window opens:
   - **Tag to add** — start typing; existing tags show up, or it creates a new one.
   - **Automation folder** — where the workflow is stored (a sensible default is pre-filled).
   - **Workflow name** — auto-suggested, but you can rename it.
   - **Publish immediately** — leave it checked so the automation goes live right away.
4. Click **Create automation** and watch the steps complete. ✅
   A link to your brand-new workflow appears when it's done.

---

## ❓ Frequently asked questions

**Is this safe? Where does my data go?**
Everything happens **inside your own browser, using your own GoHighLevel login**. There's no external server, no account to create, and nothing is sent anywhere else. The extension simply does the same clicks you would — just faster.

**Will it create a duplicate folder every time?**
No. It looks for a folder with the same name first and **reuses it**. A new folder is only created if one doesn't already exist.

**Does it work on white-label / agency domains?**
Yes. It works on custom-branded GoHighLevel domains (e.g. `app.yourbrand.com`) as well as the standard ones.

**Do I need to be an admin?**
You need an account that can create and publish workflows (the same permission you'd need to do it by hand).

**Is this an official GoHighLevel product?**
No — it's an independent, community-built tool. It is not affiliated with or endorsed by GoHighLevel/LeadConnector. Use it at your own discretion.

**Something looks off / the button didn't appear?**
Reload the form page once (GoHighLevel loads in steps). If it still doesn't show, the button appears floating in the top-right while the toolbar finishes loading.

---

## 🔒 Privacy

- Runs **100% locally** in your browser.
- Uses **your existing GoHighLevel session** — no passwords, no API keys to paste.
- **No analytics, no tracking, no third-party servers.**
- Open source — you can read every line below.

---

## 🛠️ For developers

<details>
<summary>Architecture & technical details (click to expand)</summary>

Chrome Extension, Manifest V3. It drives GoHighLevel's own (private) workflow API — the same calls the web app makes — so the automations it creates are indistinguishable from ones built by hand.

```
manifest.json        MV3 manifest
page-hook.js         MAIN world (form-builder iframe): captures the auth token +
                     locationId + formId, injects the toolbar button
content-script.js    ISOLATED world: the modal (Shadow DOM) + orchestration + progress
lib/ghl.js           GHL API client (folder / workflow / trigger / tag / auto-save / publish)
background.js        service worker: CORS-free fetch proxy (host_permissions)
popup.html           info screen
docs/ghl-recon.md    full reverse-engineering notes for the private endpoints
```

**Auth.** The `token-id` header (a short-lived Firebase JWT) is captured at runtime by
patching `fetch`/`XHR` inside the builder iframe. Workflow calls use
`channel:APP`, `source:WEB_USER`, `version:2021-04-15`.

**Why a service-worker proxy?** The content script runs inside the
`leadgen-apps-form-survey-builder.leadconnectorhq.com` iframe, whose CORS allowance toward
the workflow service isn't guaranteed. The service worker issues requests with
`host_permissions`, bypassing page CORS regardless of origin.

Full endpoint + payload reference: [`docs/ghl-recon.md`](docs/ghl-recon.md).

**Build/verify:**
```bash
node --check page-hook.js content-script.js background.js lib/ghl.js
```

</details>

---

## 📄 License

[MIT](LICENSE) — free to use, modify, and share.

<div align="center">
<sub>Built for GoHighLevel users who'd rather click once than nine times.</sub>
</div>
