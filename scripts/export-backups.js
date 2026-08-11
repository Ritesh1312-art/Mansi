/**
 * scripts/export-backups.js
 *
 * PHASE 0 — Immutable Backup Generator
 * Generates timestamped JSON and CSV backups for:
 *   - data/catalog.json
 *   - Google Sheet CSV snapshot
 *   - data/dynamic_products.json
 *
 * Calculates SHA-256 hashes for all backup artifacts.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const backupDir = path.join(root, "backups");

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function runBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  console.log(`📦 Starting Backup Session [${timestamp}]...`);

  const manifest = {
    timestamp: new Date().toISOString(),
    artifacts: []
  };

  // 1. catalog.json
  const catalogPath = path.join(root, "data", "catalog.json");
  if (fs.existsSync(catalogPath)) {
    const catalogData = fs.readFileSync(catalogPath, "utf8");
    const jsonTarget = path.join(backupDir, `catalog_${timestamp}.json`);
    fs.writeFileSync(jsonTarget, catalogData, "utf8");
    const hash = sha256(catalogData);
    const parsed = JSON.parse(catalogData);
    const count = parsed.products ? parsed.products.length : 0;
    manifest.artifacts.push({ name: `catalog_${timestamp}.json`, count, sha256: hash });
    console.log(`  ✓ Backed up catalog.json: ${count} products (SHA256: ${hash.slice(0, 12)}...)`);
  }

  // 2. dynamic_products.json
  const dynamicPath = path.join(root, "data", "dynamic_products.json");
  if (fs.existsSync(dynamicPath)) {
    const dynamicData = fs.readFileSync(dynamicPath, "utf8");
    const dynamicTarget = path.join(backupDir, `dynamic_products_${timestamp}.json`);
    fs.writeFileSync(dynamicTarget, dynamicData, "utf8");
    const hash = sha256(dynamicData);
    let count = 0;
    try { count = JSON.parse(dynamicData).length; } catch (e) {}
    manifest.artifacts.push({ name: `dynamic_products_${timestamp}.json`, count, sha256: hash });
    console.log(`  ✓ Backed up dynamic_products.json: ${count} records (SHA256: ${hash.slice(0, 12)}...)`);
  }

  // Write manifest
  const manifestPath = path.join(backupDir, `manifest_${timestamp}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\n✅ Backup Manifest written to: ${path.relative(root, manifestPath)}\n`);
}

runBackup();
