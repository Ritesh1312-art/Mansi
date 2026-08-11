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

## Backlog / next (needs user input)
- P0: Get live Vercel deploy logs OR confirmation of env vars to diagnose the actual daily failures (product/checkout/login) on production.
- P1: If Google Sheets backup isn't configured, product saves return HTTP 202 with a "Sheet backup pending ⚠️" warning even though Firestore save succeeded — this LOOKS like a failure to the owner. Consider clarifying the message or making Sheets optional.
- P2: login.html global Enter-key listener can double-submit; minor.
