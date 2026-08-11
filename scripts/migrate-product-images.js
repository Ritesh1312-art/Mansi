#!/usr/bin/env node
"use strict";

const sharp = require("sharp");
const { put } = require("@vercel/blob");
const { cert, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const dryRun = process.argv.includes("--dry-run");
const restoreArchived = process.argv.includes("--restore-archived");

function credentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is required");
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

function parseDataUrl(value) {
  const match = String(value || "").match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/s);
  if (!match) return null;
  return Buffer.from(match[2], "base64");
}

async function retry(task, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

async function main() {
  const app = initializeApp({
    credential: cert(credentials())
  });
  const db = getFirestore(app);
  const snapshot = await db.collection("products").get();
  const docs = snapshot.docs;
  const base64Docs = docs.filter(doc => parseDataUrl(doc.data().image));
  const archivedDocs = docs.filter(doc => doc.data().archived === true || doc.data().isDeleted === true);

  console.log(JSON.stringify({
    dryRun,
    total: docs.length,
    base64Images: base64Docs.length,
    archived: archivedDocs.map(doc => ({ id: doc.id, name: doc.data().name || "" })),
    restoreArchived
  }, null, 2));

  if (dryRun) return;

  let migrated = 0;
  let restored = 0;
  const failures = [];

  for (const doc of docs) {
    const product = doc.data() || {};
    const input = parseDataUrl(product.image);
    const shouldRestore = restoreArchived && (product.archived === true || product.isDeleted === true);
    if (!input && !shouldRestore) continue;

    try {
      const updates = {
        recoveryUpdatedAt: new Date().toISOString(),
        recoverySource: "scripts/migrate-product-images.js"
      };

      if (input) {
        const output = await sharp(input, { failOn: "error" })
          .rotate()
          .resize(900, 900, { fit: "contain", background: "#ffffff", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .webp({ quality: 86, effort: 4 })
          .toBuffer();
        const objectPath = `products/${doc.id}/recovered-${Date.now()}.webp`;
        const blob = await retry(() => put(objectPath, output, {
          access: "public",
          addRandomSuffix: true,
          cacheControlMaxAge: 31536000,
          contentType: "image/webp",
        }));
        updates.image = blob.url;
        updates.imageBackupUrl = blob.url;
        updates.imageStoragePath = blob.pathname;
        updates.imageMigratedAt = new Date().toISOString();
      }

      if (shouldRestore) {
        updates.archived = false;
        updates.isDeleted = false;
        updates.archivedAt = FieldValue.delete();
        updates.deletedAt = FieldValue.delete();
      }

      const version = `${Date.now()}-pre-recovery`;
      const batch = db.batch();
      batch.set(db.collection("productBackups").doc(doc.id).collection("versions").doc(version), {
        ...product,
        id: product.id || doc.id,
        backupReason: "pre-image-migration",
        backupCreatedAt: new Date().toISOString()
      });
      batch.set(doc.ref, updates, { merge: true });
      await retry(() => batch.commit());
      if (input) migrated++;
      if (shouldRestore) restored++;
      console.log(`OK ${doc.id}${input ? " image" : ""}${shouldRestore ? " restored" : ""}`);
    } catch (error) {
      failures.push({ id: doc.id, error: error.message });
      console.error(`FAILED ${doc.id}: ${error.message}`);
    }
  }

  const verify = await db.collection("products").get();
  const verified = verify.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const result = {
    total: verified.length,
    active: verified.filter(p => !p.archived && !p.isDeleted).length,
    remainingBase64: verified.filter(p => String(p.image || "").startsWith("data:")).length,
    migrated,
    restored,
    failures
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length || result.remainingBase64) process.exitCode = 2;
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
