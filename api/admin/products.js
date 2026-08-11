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

async function recordBackupFailure(db, product, error) {
  await db.collection("backupOutbox").doc(product.id).set({
    type: "product-upsert",
    product,
    attempts: 0,
    lastError: String(error.message || error).slice(0, 500),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, { merge: true });
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
        archivedBy: admin.email || admin.uid
      };
      await ref.set(archived, { merge: true });
      try {
        await backupProducts([{ ...archived, isDeleted: true, syncSource: "website-archive" }]);
      } catch (backupError) {
        await recordBackupFailure(db, archived, backupError);
      }
      return send(res, 200, { ok: true, archived: true, id });
    }

    const product = validateProduct(body.product || body);
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
      product.sales = Number.isFinite(Number(product.sales)) ? product.sales : Number(old.sales) || 0;
    }
    await ref.set(product, { merge: true });

    let backup = { pending: false };
    try {
      backup = { pending: false, ...(await backupProducts([{ ...product, syncSource: "website-admin" }])) };
      await db.collection("backupOutbox").doc(product.id).delete().catch(() => {});
    } catch (backupError) {
      await recordBackupFailure(db, product, backupError);
      backup = { pending: true };
    }
    return send(res, existing.exists ? 200 : 201, { ok: true, product, backup });
  } catch (error) {
    console.error("admin.products", error.message);
    return send(res, error.statusCode || 400, { ok: false, error: error.message || "Product save failed" });
  }
};

