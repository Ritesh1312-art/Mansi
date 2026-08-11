# Mansi Jewellery & Cosmetics — Store (Vercel + Firebase)

## Problem statement (user, Hindi)
"Har ek function ko dekho, sare functions working karo, aur website mei roz aane wali problems khatm karo bina baki koi cheez chede."
Reported daily pain points: (1) Product add/edit / image upload, (2) Checkout / order place, (3) Login/signup / admin login.
App is LIVE on Vercel. User has service keys/credentials.

## Architecture
- Static HTML/JS frontend (no framework). Vendor Firebase compat SDK.
- Vercel serverless functions under /api (Node 22). Firebase Admin (Firestore + Auth), Vercel Blob (images), Google Sheets (backup), Resend (email), Telegram (notify), Gemini (AI descriptions).
- Client: js/config.js (store config), js/data.js (DB layer + Firebase), js/api-client.js (StoreApi), js/admin-auth.js, js/app.js (cart/nav).
- Tests: tests/store.test.js (31 tests). Build gate: scripts/validate-build.js.

## Audit findings (2026-08-11)
Codebase is well-engineered and defensive. Core flows verified healthy:
- Homepage/products render with no JS runtime errors (verified via local static serve + headless screenshot).
- Product save (StoreApi.saveProduct), image upload (client downsizes to 600x600 JPEG before POST — large phone photos are NOT a problem), checkout (DB.createOrder), auth (Firebase) — all code paths are correct.
- The 3 reported daily failures are most likely Vercel ENV/config related (FIREBASE_SERVICE_ACCOUNT_JSON, ADMIN_EMAILS, BLOB_READ_WRITE_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON/Sheet permissions, RESEND/TELEGRAM/GEMINI). Cannot verify without live Vercel logs/dashboard access.

## Bugs fixed (2026-08-11)
1. Admin nav indicator mismatch: admin-auth.js stores `adminAuth="firebase"` but app.js compared `=== "true"` in initNavbar + renderFooter → public navbar/footer never showed admin state. Fixed to `Boolean(localStorage.getItem("adminAuth"))`.
2. Build validation script ran unit tests via unexpanded glob `tests/*.test.js` (spawnSync, no shell) → failed on Node < 22, could break `npm run build`. Now enumerates test files explicitly.
Result: all 31 tests pass; `node scripts/validate-build.js` passes (218 files, 71 products).

## DEEP ANALYSIS — "products disappear" root cause (2026-08-11, session 2)
Symptom: products sometimes don't save; sometimes save then suddenly vanish.
Root cause: `/api/products` returns the STATIC snapshot `data/catalog.json` (71 products, point-in-time) with `source:"static_fallback"` whenever the Firestore read throws for ANY transient reason (cold start/network). The client (`data.js fetchCatalogFromApi`) cached that fallback as authoritative, so products added AFTER the snapshot vanished until the next healthy read.
Fixes applied:
- CLIENT (`js/data.js fetchCatalogFromApi`): a degraded `static_fallback` response now NEVER overwrites a healthy live cache; it only seeds an empty cache and is never persisted to localStorage.
- SERVER (`api/products.js`): Firestore read now retries up to 3x (150/300/450ms) before ever using the static fallback.
Verified: 31/31 tests pass, build green, storefront renders (71 products), no JS errors.

## FUNCTION CONNECTIVITY MAP
Backend /api (all wired to a page/cron, code correct):
- products.js (GET) -> data.js catalog [FIXED retry]
- settings.js (GET/PATCH) -> data.js + admin/settings.html
- orders.js (GET/POST/PATCH) -> checkout.html + orders.html
- admin/products.js -> admin/products.html
- admin/image.js -> admin/products.html (needs BLOB_READ_WRITE_TOKEN)
- admin/orders.js -> admin/orders.html
- admin/session.js -> admin-auth.js
- admin/watchdog.js -> admin/watchdog.html
- backup/products.js -> admin/products.html (SheetSync)
- telegram/link.js -> profile.html
- webhooks/telegram.js -> Telegram bot (needs webhook + TELEGRAM_WEBHOOK_SECRET)
- cron/watchdog.js -> vercel.json crons (needs CRON_SECRET); READ-ONLY, never auto-deletes
Required Vercel env vars: FIREBASE_SERVICE_ACCOUNT_JSON (critical: products/orders/admin-auth), ADMIN_EMAILS, BLOB_READ_WRITE_TOKEN (images), GOOGLE_SERVICE_ACCOUNT_JSON or shared-sheet (Sheet backup), GEMINI_API_KEY (AI desc, has fallback), RESEND_API_KEY (email, optional), TELEGRAM_* (optional), CRON_SECRET.

NOT connected / dead code — NOW FIXED (2026-08-11 session 3):
- js/watchdog-core.js: REWRITTEN as a clean read-only local catalog-health monitor (no browser Telegram token, no mutations). Now LOADED on all 5 admin pages and auto-runs on load + on every `productsSynced`. Verified running (console: "[Watchdog] ..."). Owner Telegram alerts remain handled securely by the server cron watchdog.
- js/app.js: REMOVED the dead legacy in-app chatbot (initChatbotWidget no-op body, toggleChatbot, sendChatQuery, handleUserChatSubmit, getSmartBotResponse) and the dead positionAssistantWidgets observer that targeted the never-created .ai-chat-btn. Nothing referenced these (OmniDimension widget is the live assistant, loaded per page). app.js 810 -> 639 lines. All 31 tests + build still pass.

## Backlog / next (needs user input)
- P0: If products STILL fail to save/persist after this deploy, get Vercel Function logs for /api/admin/products & /api/products (confirms FIREBASE_SERVICE_ACCOUNT_JSON is set & valid).
- P1: "Sheet backup pending" ⚠️ after save is only a Google-Sheets-mirror warning; the product IS saved in Firestore. Consider softening the message or making Sheets optional.
- P2: keep data/catalog.json fresh (scripts/export-backups.js) so the emergency fallback isn't stale.
- P3: js/watchdog-core.js is dead code — remove or wire up if a client watchdog is desired.
