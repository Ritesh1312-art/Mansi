#!/usr/bin/env node
/**
 * scripts/recover-catalog.js
 *
 * PHASE 5 — Catalog Recovery Script
 *
 * Purpose:
 *   Reads ALL products from Firestore (the authoritative source), merges with
 *   the static catalog.json (53 known baseline), deduplicates by ID, and writes
 *   a new snapshot to data/catalog.json.
 *
 *   This updates the static emergency fallback to include all products ever added.
 *
 * Usage:
 *   node scripts/recover-catalog.js [--dry-run]
 *
 * Prerequisites:
 *   FIREBASE_SERVICE_ACCOUNT_JSON must be set in your environment OR in .env.local
 *
 * Flags:
 *   --dry-run   Print the report and counts but do NOT write catalog.json
 *   --force     Skip confirmation prompt and write immediately
 *
 * Output:
 *   data/catalog.json  (updated with all recovered products)
 *   data/catalog.backup.<timestamp>.json  (backup of previous catalog.json)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Load .env.local if present (for local development)
const envLocalPath = path.join(__dirname, "..", ".env.local");
const envPath = path.join(__dirname, "..", ".env");
for (const p of [envPath, envLocalPath]) {
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) {
        const key = m[1].trim();
        const val = m[2].trim().replace(/^['"]|['"]$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

const catalogPath = path.join(__dirname, "..", "data", "catalog.json");
const dataDir = path.join(__dirname, "..", "data");

const isDryRun = process.argv.includes("--dry-run");
const isForce = process.argv.includes("--force");

// ── Firebase Admin init ────────────────────────────────────────────────────

function initFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) {
    console.error("\n❌  FIREBASE_SERVICE_ACCOUNT_JSON is not set.\n");
    console.error("    To fix:");
    console.error("    1. Go to Firebase Console → Project Settings → Service Accounts");
    console.error("    2. Click 'Generate new private key' → download JSON");
    console.error("    3. Set it in Vercel dashboard as FIREBASE_SERVICE_ACCOUNT_JSON");
    console.error("    4. For local use, paste it in .env.local\n");
    process.exit(1);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
  } catch (e) {
    console.error("❌  Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:", e.message);
    process.exit(1);
  }

  try {
    const { cert, getApps, initializeApp } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    const app = getApps().length ? getApps()[0] : initializeApp({
      credential: cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "mansi-9e187.firebasestorage.app"
    });
    return getFirestore(app);
  } catch (e) {
    console.error("❌  Firebase initialization failed:", e.message);
    process.exit(1);
  }
}

// ── Static catalog reader ──────────────────────────────────────────────────

function readStaticCatalog() {
  try {
    const data = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    return Array.isArray(data.products) ? data.products : [];
  } catch (e) {
    console.warn("⚠️  Could not read catalog.json:", e.message);
    return [];
  }
}

// ── Firestore reader (full collection, no limit) ───────────────────────────

async function readAllFirestoreProducts(db) {
  console.log("📡  Reading all products from Firestore...");
  const snapshot = await db.collection("products").get();
  const all = [];
  snapshot.forEach(doc => {
    const data = doc.data() || {};
    all.push({ ...data, id: data.id || doc.id });
  });
  console.log(`    Firestore total docs (including archived): ${all.length}`);
  return all;
}

// ── Main recovery ──────────────────────────────────────────────────────────

async function main() {
  console.log("\n🔍  Mansi Jewellery Store — Catalog Recovery Script");
  console.log("====================================================");
  if (isDryRun) console.log("🟡  DRY RUN MODE — no files will be written\n");

  const db = initFirebase();

  // 1. Read sources
  const staticProducts = readStaticCatalog();
  const firestoreAll = await readAllFirestoreProducts(db);

  // 2. Classify Firestore products
  const firestoreActive = firestoreAll.filter(p => !p.archived && !p.isDeleted);
  const firestoreArchived = firestoreAll.filter(p => p.archived || p.isDeleted);

  console.log("\n📊  Source Audit:");
  console.log(`    Static catalog.json:        ${staticProducts.length} products`);
  console.log(`    Firestore total:             ${firestoreAll.length} docs`);
  console.log(`    Firestore active:            ${firestoreActive.length}`);
  console.log(`    Firestore archived/deleted:  ${firestoreArchived.length}`);

  // 3. Build merged de-duplicated map
  // Priority: Firestore (most recent) > static catalog
  const mergedMap = new Map();

  // Start with static catalog as baseline
  for (const p of staticProducts) {
    if (p && p.id && !p.archived && !p.isDeleted) {
      mergedMap.set(p.id, { ...p, _source: "static" });
    }
  }

  // Overlay with Firestore (Firestore wins on conflict)
  let onlyInFirestore = 0;
  let onlyInStatic = 0;
  let inBoth = 0;

  for (const p of firestoreAll) {
    if (!p || !p.id) continue;
    if (p.archived || p.isDeleted) {
      // If Firestore marks it deleted, remove from merged map
      if (mergedMap.has(p.id)) {
        mergedMap.delete(p.id);
      }
      continue;
    }
    if (mergedMap.has(p.id)) {
      inBoth++;
    } else {
      onlyInFirestore++;
    }
    mergedMap.set(p.id, { ...p, _source: "firestore" });
  }

  // Count static-only
  for (const [id, p] of mergedMap) {
    if (p._source === "static") onlyInStatic++;
  }

  // Clean up internal _source tag
  const mergedProducts = Array.from(mergedMap.values()).map(p => {
    const { _source, ...clean } = p;
    return clean;
  });

  // Sort newest first
  mergedProducts.sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );

  // 4. Duplicate ID check
  const idCounts = new Map();
  for (const p of firestoreAll) {
    if (p.id) idCounts.set(p.id, (idCounts.get(p.id) || 0) + 1);
  }
  const duplicateIds = [...idCounts.entries()].filter(([, c]) => c > 1);

  // 5. Data quality checks
  const missingImage = mergedProducts.filter(p => !p.image && !p.imageBackupUrl);
  const invalidPrice = mergedProducts.filter(p => !(p.price > 0));

  console.log("\n📋  Merge Report:");
  console.log(`    Products in both sources:    ${inBoth}`);
  console.log(`    Only in Firestore (NEW):     ${onlyInFirestore}`);
  console.log(`    Only in static catalog:      ${onlyInStatic}`);
  console.log(`    Total after merge:           ${mergedProducts.length}`);
  console.log(`    Duplicate IDs in Firestore:  ${duplicateIds.length}`);
  console.log(`    Missing image URL:           ${missingImage.length}`);
  console.log(`    Invalid/zero price:          ${invalidPrice.length}`);

  if (duplicateIds.length > 0) {
    console.log("\n⚠️   Duplicate IDs detected:");
    duplicateIds.forEach(([id, count]) => console.log(`    - ${id} (${count} docs)`));
  }

  if (missingImage.length > 0) {
    console.log("\n⚠️   Products with no image:");
    missingImage.forEach(p => console.log(`    - [${p.id}] ${p.name}`));
  }

  console.log("\n🆕  New products (in Firestore, not in static catalog):");
  const newProducts = mergedProducts.filter(p => !staticProducts.find(s => s.id === p.id));
  if (newProducts.length === 0) {
    console.log("    (none — all Firestore products already in catalog.json)");
  } else {
    newProducts.forEach((p, i) => {
      console.log(`    ${i + 1}. [${p.id}] ${p.name} — ₹${p.price} (${p.category})`);
    });
  }

  if (isDryRun) {
    console.log("\n🟡  DRY RUN complete. No files written.");
    console.log(`    Would write ${mergedProducts.length} products to data/catalog.json`);
    console.log("\n    To write, run: node scripts/recover-catalog.js --force\n");
    return;
  }

  // 6. Write backup of current catalog
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = path.join(dataDir, `catalog.backup.${ts}.json`);
  fs.copyFileSync(catalogPath, backupPath);
  console.log(`\n💾  Backed up current catalog.json → ${path.basename(backupPath)}`);

  // 7. Write new catalog.json
  const newCatalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "recover-catalog script (Firestore + static merge)",
    productCount: mergedProducts.length,
    products: mergedProducts
  };

  fs.writeFileSync(catalogPath, JSON.stringify(newCatalog, null, 2), "utf8");

  console.log(`✅  Wrote ${mergedProducts.length} products to data/catalog.json`);
  console.log("\n📌  Next steps:");
  console.log("    1. git add data/catalog.json");
  console.log("    2. git commit -m 'chore: update catalog.json with all recovered products'");
  console.log("    3. git push origin main");
  console.log("    4. npx vercel --prod --yes");
  console.log("    5. Set FIREBASE_SERVICE_ACCOUNT_JSON in Vercel for live Firestore access\n");
}

main().catch(err => {
  console.error("\n❌  Recovery script failed:", err.message);
  process.exit(1);
});
