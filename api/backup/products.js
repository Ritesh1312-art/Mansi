"use strict";

const { requireAdmin } = require("../_lib/auth");
const { services } = require("../_lib/firebase");
const { readProducts, backupProducts, normalizeProduct } = require("../_lib/google-sheet");
const { send, readJson, methodNotAllowed } = require("../_lib/http");

async function firestoreProducts(db) {
  const snapshot = await db.collection("products").get();
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.data().id || doc.id }));
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST", "PUT"].includes(req.method)) {
    return methodNotAllowed(res, ["GET", "POST", "PUT"]);
  }
  try {
    const admin = await requireAdmin(req);
    const { db } = services();
    const sheetProducts = await readProducts();

    if (req.method === "GET") {
      const live = await firestoreProducts(db);
      const activeLive = live.filter(product => !product.archived && !product.isDeleted);
      const liveIds = new Set(activeLive.map(product => String(product.id)));
      const restorable = sheetProducts.filter(product => !product.isDeleted);
      const pendingSnapshot = await db.collection("backupOutbox").get();
      return send(res, 200, {
        ok: true,
        sheetCount: restorable.length,
        liveCount: activeLive.length,
        missingOnWebsite: restorable.filter(product => !liveIds.has(String(product.id))).length,
        pendingBackups: pendingSnapshot.size || 0,
        sheetUpdatedAt: restorable.reduce((latest, product) =>
          String(product.lastSyncedAt || "") > latest ? String(product.lastSyncedAt) : latest, "")
      });
    }

    if (req.method === "POST") {
      const live = await firestoreProducts(db);
      const result = await backupProducts(live.map(product => ({ ...product, syncSource: "manual-backup" })));
      return send(res, 200, { ok: true, ...result });
    }

    const body = await readJson(req);
    const previewOnly = body.preview !== false;
    const existing = await firestoreProducts(db);
    const existingById = new Map(existing.map(product => [String(product.id), product]));
    const candidates = sheetProducts
      .filter(product => /^[A-Za-z0-9_-]{1,150}$/.test(String(product.id || "")) && !product.isDeleted)
      .map(normalizeProduct);
    const creates = candidates.filter(product => !existingById.has(String(product.id)));
    const updates = candidates.filter(product => {
      const live = existingById.get(String(product.id));
      return live && String(product.updatedAt || "") > String(live.updatedAt || live.createdAt || "");
    });

    if (previewOnly) {
      return send(res, 200, {
        ok: true,
        preview: true,
        creates: creates.length,
        updates: updates.length,
        unchanged: candidates.length - creates.length - updates.length,
        deletes: 0
      });
    }

    const writeList = [...creates, ...updates];
    for (let index = 0; index < writeList.length; index += 200) {
      const batch = db.batch();
      writeList.slice(index, index + 200).forEach(product => {
        const restored = {
          ...product,
          archived: false,
          isDeleted: false,
          archivedAt: null,
          archivedBy: null,
          deletedAt: null,
          backupStatus: "synced",
          backupVerifiedAt: new Date().toISOString(),
          backupLastError: null,
          restoredAt: new Date().toISOString(),
          restoredBy: admin.email || admin.uid,
          restoreSource: "google-sheet"
        };
        batch.set(db.collection("products").doc(String(product.id)), restored, { merge: true });
        const versionId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        batch.set(db.collection("productBackups").doc(String(product.id)).collection("versions").doc(versionId), {
          product: restored,
          operation: "sheet-restore",
          actor: admin.email || admin.uid,
          createdAt: new Date().toISOString()
        });
      });
      await batch.commit();
    }
    await db.collection("auditLogs").add({
      type: "sheet-restore",
      creates: creates.length,
      updates: updates.length,
      deletes: 0,
      actor: admin.email || admin.uid,
      createdAt: new Date().toISOString()
    });
    return send(res, 200, { ok: true, preview: false, creates: creates.length, updates: updates.length, deletes: 0 });
  } catch (error) {
    console.error("backup.products", error.message);
    return send(res, error.statusCode || 500, { ok: false, error: error.message || "Backup operation failed" });
  }
};
