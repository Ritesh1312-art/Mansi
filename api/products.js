"use strict";

const { services } = require("./_lib/firebase");
const { send, methodNotAllowed, withErrorHandler } = require("./_lib/http");
const { getAllProductsMerged } = require("./_lib/catalog-store");

const PUBLIC_PRODUCT_FIELDS = [
  "id", "name", "category", "price", "mrp", "description", "image",
  "imageBackupUrl", "stock", "inStock", "rating", "reviews", "sales",
  "createdAt", "updatedAt"
];

function publicProduct(product, fallbackId) {
  const source = product || {};
  const clean = {};
  PUBLIC_PRODUCT_FIELDS.forEach(field => {
    if (source[field] !== undefined) clean[field] = source[field];
  });
  clean.id = String(clean.id || fallbackId || "");
  return clean;
}

/**
 * GET /api/products
 *
 * Priority:
 *   1. Firestore (authoritative source of truth) — full collection, no limit
 *   2. Static catalog.json (emergency fallback on Firestore exception ONLY)
 *
 * NEVER uses static fallback just because Firestore returned an empty set.
 * Only falls back on genuine connection/read failure.
 */
module.exports = withErrorHandler(async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const { db, isConfigured, error: firebaseError } = services();

  // Firestore not configured — serve static fallback honestly
  if (!isConfigured || !db) {
    const products = getAllProductsMerged().map(product => publicProduct(product));
    res.setHeader("Cache-Control", "no-store");
    return send(res, 200, {
      ok: true,
      count: products.length,
      products,
      source: "static_fallback",
      warning: "Firebase not configured. Showing static catalog only. Products added via admin are not visible until Firebase credentials are set."
    });
  }

  // Firestore is configured — fetch full collection with no arbitrary limit
  try {
    // Retry transient read failures (cold start / network blip) before ever
    // falling back to the static snapshot, so live products never vanish.
    let snapshot = null;
    let readError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        snapshot = await db.collection("products").get();
        readError = null;
        break;
      } catch (err) {
        readError = err;
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    if (readError) throw readError;
    const firestoreProducts = [];
    const inactiveIds = new Set();
    snapshot.forEach(doc => {
      const data = doc.data() || {};
      // Exclude soft-deleted and archived products
      if (data.isDeleted === true || data.archived === true) {
        inactiveIds.add(String(doc.id));
        return;
      }
      firestoreProducts.push(publicProduct(data, doc.id));
    });

    // If a verified backup product is missing from Firestore, keep it visible.
    // Firestore archive/delete records remain authoritative and block recovery.
    const byId = new Map(firestoreProducts.map(product => [product.id, product]));
    const recoveredIds = [];
    getAllProductsMerged().forEach(product => {
      const id = String(product && product.id || "");
      if (!id || byId.has(id) || inactiveIds.has(id)) return;
      byId.set(id, publicProduct(product, id));
      recoveredIds.push(id);
    });
    const visibleProducts = Array.from(byId.values());

    // Sort newest first
    visibleProducts.sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );

    // Product mutations must be visible immediately after the admin re-read.
    res.setHeader("Cache-Control", "no-store");
    return send(res, 200, {
      ok: true,
      count: visibleProducts.length,
      products: visibleProducts,
      source: recoveredIds.length ? "firestore_with_verified_recovery" : "firestore",
      recoveredCount: recoveredIds.length
    });

  } catch (error) {
    // Genuine Firestore failure — use static catalog as honest fallback
    console.error("[api/products] Firestore read error:", error.message);
    const products = getAllProductsMerged().map(product => publicProduct(product));
    res.setHeader("Cache-Control", "no-store");
    return send(res, 200, {
      ok: true,
      count: products.length,
      products,
      source: "static_fallback",
      warning: "Firestore temporarily unavailable. Showing static catalog."
    });
  }
});
