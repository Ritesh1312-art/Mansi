const { requireAdmin } = require("../_lib/auth");
const { services } = require("../_lib/firebase");
const { backupProducts, normalizeProduct } = require("../_lib/google-sheet");
const { send, readJson, methodNotAllowed } = require("../_lib/http");

function validateProduct(input) {
  const product = normalizeProduct(input || {});
  if (!product.id) product.id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  product.id = String(product.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 150);
  if (!product.id) throw new Error("Valid product id is required");
  if (!product.name) throw new Error("Product name is required");
  if (!(product.price > 0)) throw new Error("Selling price must be greater than zero");
  if (product.mrp < product.price) product.mrp = product.price;
  product.inStock = product.stock > 0;
  product.updatedAt = new Date().toISOString();
  return product;
}

async function queueBackup(db, product, operation, error) {
  const ref = db.collection("backupOutbox").doc(product.id);
  const existing = await ref.get();
  const previous = existing.exists ? existing.data() || {} : {};
  const now = new Date().toISOString();
  await ref.set({
    type: "product-upsert",
    operation: operation || "upsert",
    product,
    attempts: Number(previous.attempts) || 0,
    lastError: error ? String(error.message || error).slice(0, 500) : "",
    createdAt: previous.createdAt || now,
    updatedAt: now
  }, { merge: true });
}

function productVersionRef(db, productId) {
  const versionId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return db.collection("productBackups").doc(String(productId)).collection("versions").doc(versionId);
}

async function markBackupVerified(db, ref, product, backup) {
  const now = backup.verifiedAt || new Date().toISOString();
  const batch = db.batch();
  batch.set(ref, {
    backupStatus: "synced",
    backupVerifiedAt: now,
    backupLastError: null,
    updatedAt: product.updatedAt
  }, { merge: true });
  batch.delete(db.collection("backupOutbox").doc(product.id));
  await batch.commit();
}

module.exports = async function handler(req, res) {
  if (!["POST", "PATCH", "DELETE"].includes(req.method)) {
    return methodNotAllowed(res, ["POST", "PATCH", "DELETE"]);
  }
  try {
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    const { db } = services();
    if (!db) return send(res, 503, { ok: false, error: "Cloud database service is not configured" });

    if (body && body.action === "generate_description") {
      const productName = String(body.name || "").trim();
      const category = String(body.category || "").trim();
      const prompt = (String(body.prompt || "").trim() || `Write a compelling 2-3 sentence e-commerce description for a product named "${productName}" in the category "${category}". Highlight quality, elegance, and customer appeal for an Indian online store.`).slice(0, 2000);

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return send(res, 503, { ok: false, error: "GEMINI_API_KEY is not configured on the server" });
      }

      const model = String(process.env.GEMINI_MODEL || "gemini-2.0-flash").replace(/[^A-Za-z0-9._-]/g, "");
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        return send(res, 502, { ok: false, error: "Gemini API request failed", status: response.status });
      }

      const data = await response.json();
      const description = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      return send(res, 200, { ok: true, description });
    }

    if (req.method === "DELETE") {
      const id = String(body.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 150);
      if (!id) return send(res, 400, { ok: false, error: "Product id is required" });
      const ref = db.collection("products").doc(id);
      const existing = await ref.get();
      if (!existing.exists) return send(res, 404, { ok: false, error: "Product not found" });
      const archived = {
        ...existing.data(),
        id,
        archived: true,
        archivedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedBy: admin.email || admin.uid,
        backupStatus: "pending",
        backupLastError: null
      };
      const writeBatch = db.batch();
      writeBatch.set(ref, archived, { merge: true });
      writeBatch.set(productVersionRef(db, id), {
        product: archived,
        operation: "archive",
        actor: admin.email || admin.uid,
        createdAt: new Date().toISOString()
      });
      writeBatch.set(db.collection("backupOutbox").doc(id), {
        type: "product-upsert",
        operation: "archive",
        product: { ...archived, isDeleted: true, syncSource: "website-archive" },
        attempts: 0,
        lastError: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      await writeBatch.commit();
      try {
        const backup = await backupProducts([{ ...archived, isDeleted: true, syncSource: "website-archive" }]);
        await markBackupVerified(db, ref, archived, backup);
        return send(res, 200, { ok: true, archived: true, id, durable: true, backup });
      } catch (backupError) {
        await queueBackup(db, { ...archived, isDeleted: true, syncSource: "website-archive" }, "archive", backupError);
        await ref.set({ backupStatus: "pending", backupLastError: String(backupError.message || backupError).slice(0, 500) }, { merge: true });
        return send(res, 202, {
          ok: true,
          archived: true,
          id,
          durable: false,
          backup: { pending: true, verified: false },
          warning: "Product was archived in Firebase, but Google Sheet verification is pending and will retry automatically."
        });
      }
    }

    const rawProduct = body.product || body;
    const product = validateProduct(rawProduct);
    product.updatedBy = admin.email || admin.uid;
    product.archived = false;
    product.isDeleted = false;
    product.archivedAt = null;
    product.archivedBy = null;
    product.deletedAt = null;

    const ref = db.collection("products").doc(product.id);
    const existing = await ref.get();
    if (existing.exists) {
      const old = existing.data() || {};
      product.createdAt = old.createdAt || product.createdAt;
      if (!Object.prototype.hasOwnProperty.call(rawProduct, "sales")) {
        product.sales = Math.max(0, Number(old.sales) || 0);
      }
    }
    product.backupStatus = "pending";
    product.backupLastError = null;

    // Product and its retry job are committed atomically in Firestore. A Google
    // outage can delay the mirror, but can never make the product disappear.
    const writeBatch = db.batch();
    writeBatch.set(ref, product, { merge: true });
    writeBatch.set(productVersionRef(db, product.id), {
      product,
      operation: existing.exists ? "update" : "create",
      actor: admin.email || admin.uid,
      createdAt: new Date().toISOString()
    });
    writeBatch.set(db.collection("backupOutbox").doc(product.id), {
      type: "product-upsert",
      operation: "upsert",
      product: { ...product, syncSource: "website-admin" },
      attempts: 0,
      lastError: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
    await writeBatch.commit();

    try {
      const backup = {
        pending: false,
        ...(await backupProducts([{ ...product, syncSource: "website-admin" }]))
      };
      await markBackupVerified(db, ref, product, backup);
      const saved = await ref.get();
      return send(res, existing.exists ? 200 : 201, {
        ok: true,
        durable: true,
        product: { ...(saved.data() || product), id: product.id },
        backup
      });
    } catch (backupError) {
      await queueBackup(db, { ...product, syncSource: "website-admin" }, "upsert", backupError);
      await ref.set({
        backupStatus: "pending",
        backupLastError: String(backupError.message || backupError).slice(0, 500)
      }, { merge: true });
      return send(res, 202, {
        ok: true,
        durable: false,
        productVisible: true,
        product,
        backup: { pending: true, verified: false },
        warning: "Product is safely saved in Firebase and visible, but Google Sheet verification is pending and will retry automatically."
      });
    }
  } catch (error) {
    console.error("admin.products", error.message);
    return send(res, error.statusCode || 400, { ok: false, error: error.message || "Product save failed" });
  }
};

