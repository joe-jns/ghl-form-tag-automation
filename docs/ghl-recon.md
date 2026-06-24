# GHL recon — « Form → tag automation » en un clic

Reverse-engineering des endpoints privés GoHighLevel (tenant white-label `app.business-toolbox.com`)
pour une extension Chrome qui, depuis le **form builder**, crée en un clic :
dossier (si absent) → workflow → trigger « Form submitted » filtré sur le form courant → action « Add tag » → publish.

Recon réalisée le 2026-06-24 via Playwright, session réelle. Toutes les écritures ont été exécutées pour de vrai
(workflow + dossier de test ensuite supprimés ; tag `recon-test-tag` laissé, inoffensif).

## Contexte / IDs observés (à NE PAS committer en dur)

| Donnée | Valeur (exemple de session) | Source au runtime |
|---|---|---|
| `locationId` | `{locationId}` | URL du form builder : `/v2/location/{locationId}/form-builder-v2/{formId}` |
| `formId` | `{formId}` | URL du form builder (2e segment) |
| `userId` | `{userId}` | JWT `token-id` → `user_id` |
| `companyId` | `{companyId}` | JWT `token-id` → `company_id` |

## Origins / iframes

| Surface | Origin |
|---|---|
| Wrapper white-label (top page) | `app.business-toolbox.com` |
| **Form builder (où injecter le bouton)** | iframe `leadgen-apps-form-survey-builder.leadconnectorhq.com` |
| Workflow list + builder | iframe `client-app-automation-workflows.leadconnectorhq.com` |
| API workflow / contacts / tags | `backend.leadconnectorhq.com` |
| API forms | `services.leadconnectorhq.com/forms/*` |

## Auth (VALIDÉ par replay — 200 avec `token-id` seul, sans Bearer)

Tous les endpoints d'écriture workflow acceptent le header **`token-id`** (JWT Firebase, audience `highlevel-backend`,
contient `permissions.workflows_enabled:true`). Le header `Authorization: Bearer …` présent dans l'UI n'est **pas** requis.

Headers requis pour `backend.leadconnectorhq.com/workflow/*` :

```
token-id: <JWT capturé au runtime>
channel: APP
source: WEB_USER
version: 2021-04-15
accept: application/json
content-type: application/json   (pour POST/PUT)
```

⚠️ Le service **forms** (`services.leadconnectorhq.com`) utilise `version: 2021-07-28` (le `token-id` est le même).

**Capture du `token-id` au runtime** : patcher `fetch` + `XMLHttpRequest.setRequestHeader` dans le MAIN world de
l'iframe form builder et lire le header `token-id` sortant (même pattern que `page-hook.js` de `ghl-aistudio-exporter`,
mais on lit `token-id` au lieu de `authorization`). Le JWT expire ~1 h → toujours utiliser le dernier capturé.

---

## Endpoints (ordre d'orchestration de l'extension)

### 1. Lister dossiers + workflows (pour « créer le dossier si absent »)
```
GET backend.leadconnectorhq.com/workflow/{loc}/list?parentId=root&limit=50&offset=0&sortBy=name&sortOrder=asc&includeCustomObjects=true&includeObjectiveBuilder=true
→ {"rows":[{ "_id","name","type":"directory","parentId":null, ... }], "count":N}
```
Un dossier = `type:"directory"`. Matcher par `name` (insensible casse) pour décider create-or-reuse.

### 2. Créer un dossier
```
POST backend.leadconnectorhq.com/workflow/{loc}/directory
body: {"type":"directory","name":"<nom>","updatedBy":"<userId>","parentId":null,"company_id":"<companyId>","company_age":27}
→ {"id":"<folderId>"}
```
`company_age` ≈ jours depuis création de la company ; valeur observée 27, vraisemblablement non critique.

### 3. Créer le workflow (dans le dossier)
```
POST backend.leadconnectorhq.com/workflow/{loc}
body: {
  "name":"<nom>","status":"draft","parentId":"<folderId>","updatedBy":"<userId>",
  "modifiedSteps":[],"deletedSteps":[],"createdSteps":[],
  "senderAddress":{},"stopOnResponse":false,"allowMultiple":true,"allowMultipleOpportunity":true,
  "autoMarkAsRead":false,"eventStartDate":"","timezone":"","workflowData":{"templates":[]},
  "triggersChanged":false,"company_id":"<companyId>","company_age":27
}
→ {"id":"<wfId>"}
```

### 4. Créer le trigger « Form submitted » lié au form courant  ⭐ pièce maîtresse
```
POST backend.leadconnectorhq.com/workflow/{loc}/trigger
body: {
  "status":"draft","workflowId":"<wfId>","schedule_config":{},
  "conditions":[{"operator":"is-any-of","field":"form.id","value":["<formId>"],"title":"Form is","type":"string"}],
  "type":"form_submission","masterType":"highlevel","name":"Form Submitted",
  "actions":[{"workflow_id":"<wfId>","type":"add_to_workflow"}],
  "active":true,"triggersChanged":true,
  "location_id":"<loc>","company_id":"<companyId>","company_age":27
}
→ {"id":"<triggerId>"}
```
Le lien au formulaire = `conditions[0]` avec `field:"form.id"`, `value:[<formId>]`.

### 5. Gérer le tag (modal « liste + création »)
```
GET  backend.leadconnectorhq.com/locations/{loc}/tags                         → {"tags":[ ... ]}        (liste complète)
GET  backend.leadconnectorhq.com/locations/{loc}/tags/search?query=<q>&limit=30&skip=0                 (autocomplete)
POST backend.leadconnectorhq.com/workflow/{loc}/tags/create   body: {"tag":"<nom>"}   → "OK"             (création à la volée)
```
L'action stocke le tag **par nom**, pas par id — donc créer le tag puis l'utiliser tel quel suffit.

### 6. Ajouter l'action « Add tag » + sauver (auto-save)
```
PUT backend.leadconnectorhq.com/workflow/{loc}/{wfId}/auto-save
body (objet workflow COMPLET) dont les champs clefs :
  "workflowData": { "templates": [
      { "id":"<uuidStep>", "order":0, "name":"Add Tag", "type":"add_contact_tag",
        "attributes": { "tags": ["<nomTag>"] } }
  ]},
  "createdSteps": ["<uuidStep>"],
  "modifiedSteps": [], "deletedSteps": [],
  "newTriggers": [ <le trigger de l'étape 4, tel que renvoyé> ],
  "oldTriggers": [ ... ], "triggersChanged": false,
  "isAutoSave": true,
  "autoSaveSession": { "workflowId":"<wfId>", "id":"<sessionUuid>", "userId":"<userId>", "version":1, "inProgress":true }
```
`<uuidStep>` = UUID généré côté client. `<sessionUuid>` = identifiant de session d'édition (généré client).
L'objet complet reprend la réponse du GET `/workflow/{loc}/{wfId}?...` enrichie de la step + des triggers.

### 7. Publier (sinon le workflow ne se déclenche jamais)
```
PUT backend.leadconnectorhq.com/workflow/{loc}/{wfId}
body: objet workflow complet avec "status":"published", "createdSteps":[], "triggersChanged":false
→ 200
```
Dans l'UI : toggle Draft→Publish **puis** bouton « Save » (c'est Save qui envoie ce PUT).

---

## Reste à reconnaître (build-time, faible risque)
- **Point d'ancrage du bouton** dans la toolbar du form builder (iframe `leadgen-apps-form-survey-builder…`).
  À snapshotter au moment du build pour trouver l'élément natif à côté duquel insérer le bouton (style natif).

## Réutilisable depuis `ghl-aistudio-exporter`
- `page-hook.js` (MAIN world : capture header + injection bouton + MutationObserver de ré-attache)
- `content-script.js` (bridge ISOLATED ↔ modal), structure MV3 (`manifest.json`), modal host.
- Adapter : header capturé `token-id` (pas `authorization`) ; origin form builder ci-dessus ; flux d'orchestration 1→7.
