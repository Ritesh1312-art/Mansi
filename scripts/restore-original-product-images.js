#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { put } = require("@vercel/blob");
const { cert, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { backupProducts } = require("../api/_lib/google-sheet");

const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "catalog.json");
const baselineRevision = process.env.BASELINE_CATALOG_REVISION || "9871128";
const dryRun = process.argv.includes("--dry-run");

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is required");
  const value = JSON.parse(raw);
  if (value.private_key) value.private_key = value.private_key.replace(/\\n/g, "\n");
  return value;
}

function baselineCatalog() {
  const raw = execFileSync("git", ["show", `${baselineRevision}:data/catalog.json`], {
    cwd: root,
    encoding: "utf8"
  });
  return JSON.parse(raw).products;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function main() {
  const baseline = baselineCatalog();
  const currentCatalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const currentById = new Map(currentCatalog.products.map(product => [product.id, product]));
  const missing = baseline.filter(product => !currentById.has(product.id));
  if (baseline.length !== 53 || missing.length) {
    throw new Error(`Safety check failed: baseline=${baseline.length}, missing=${missing.length}`);
  }

  const sources = baseline.map(product => {
    const relative = String(product.image || "").replace(/^\/+/, "");
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute)) {
      throw new Error(`Missing or unsafe original image for ${product.id}: ${relative}`);
    }
    const buffer = fs.readFileSync(absolute);
    return {
      id: product.id,
      name: product.name,
      absolute,
      buffer,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      ext: path.extname(absolute).toLowerCase() || ".jpg"
    };
  });

  console.log(JSON.stringify({
    dryRun,
    baselineRevision,
    restoreCount: sources.length,
    currentCount: currentCatalog.products.length,
    uniqueOriginals: new Set(sources.map(source => source.sha256)).size
  }, null, 2));
  if (dryRun) return;
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is required");

  const uploaded = new Map();
  for (const source of sources) {
    const objectPath = `products/${source.id}/original-${source.sha256.slice(0, 16)}${source.ext}`;
    const blob = await put(objectPath, source.buffer, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
      contentType: contentType(source.absolute)
    });
    uploaded.set(source.id, { url: blob.url, pathname: blob.pathname, sha256: source.sha256 });
    console.log(`UPLOADED ${source.id} ${source.name}`);
  }

  const app = initializeApp({ credential: cert(serviceAccount()) }, `restore-${Date.now()}`);
  const db = getFirestore(app);
  const snapshot = await db.collection("products").get();
  const firestoreById = new Map(snapshot.docs.map(doc => [doc.id, doc]));
  const absent = sources.filter(source => !firestoreById.has(source.id));
  if (snapshot.size !== currentCatalog.products.length || absent.length) {
    throw new Error(`Firestore safety check failed: docs=${snapshot.size}, absent=${absent.length}`);
  }

  const restoredAt = new Date().toISOString();
  const batch = db.batch();
  for (const source of sources) {
    const doc = firestoreById.get(source.id);
    const prior = doc.data() || {};
    const restored = uploaded.get(source.id);
    const version = db.collection("productBackups").doc(source.id).collection("versions").doc(`${Date.now()}-pre-original-restore`);
    batch.set(version, {
      ...prior,
      id: prior.id || source.id,
      backupReason: "pre-original-image-restore",
      backupCreatedAt: restoredAt
    });
    batch.set(doc.ref, {
      image: restored.url,
      imageBackupUrl: restored.url,
      imageStoragePath: restored.pathname,
      imageSha256: restored.sha256,
      imageRestoredAt: restoredAt,
      imageRestoreSource: `git:${baselineRevision}`,
      updatedAt: restoredAt,
      lastSyncedAt: restoredAt,
      syncSource: "original-image-recovery"
    }, { merge: true });
  }
  await batch.commit();

  const verifiedSnapshot = await db.collection("products").get();
  const verifiedProducts = verifiedSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const verifiedById = new Map(verifiedProducts.map(product => [product.id, product]));
  for (const source of sources) {
    const expected = uploaded.get(source.id);
    const actual = verifiedById.get(source.id);
    if (!actual || actual.image !== expected.url || actual.imageSha256 !== source.sha256) {
      throw new Error(`Firestore verification failed for ${source.id}`);
    }
  }

  verifiedProducts.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  fs.writeFileSync(catalogPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: restoredAt,
    source: "Firestore after exact original image restoration",
    productCount: verifiedProducts.length,
    products: verifiedProducts
  }, null, 2) + "\n", "utf8");

  const sheet = await backupProducts(verifiedProducts);
  console.log(JSON.stringify({
    restored: sources.length,
    firestoreTotal: verifiedProducts.length,
    active: verifiedProducts.filter(product => !product.archived && !product.isDeleted).length,
    catalogTotal: verifiedProducts.length,
    sheet
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
