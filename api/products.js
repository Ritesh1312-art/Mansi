"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { services } = require("./_lib/firebase");
const { send, sendError, methodNotAllowed, withErrorHandler } = require("./_lib/http");

function getFallbackCatalog() {
  try {
    const catalogPath = path.join(__dirname, "..", "data", "catalog.json");
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    return catalog.products || [];
  } catch (e) {
    return [];
  }
}

module.exports = withErrorHandler(async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const { db, isConfigured } = services();
  if (!isConfigured || !db) {
    const fallbackProducts = getFallbackCatalog();
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
    return send(res, 200, {
      ok: true,
      count: fallbackProducts.length,
      products: fallbackProducts,
      source: "fallback_catalog"
    });
  }

  try {
    const snapshot = await db.collection("products").get();
    const products = [];
    snapshot.forEach(doc => {
      const data = doc.data() || {};
      if (data.isDeleted === true || data.archived === true) return;
      products.push({ ...data, id: data.id || doc.id });
    });
    if (products.length === 0) {
      const fallbackProducts = getFallbackCatalog();
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
      return send(res, 200, {
        ok: true,
        count: fallbackProducts.length,
        products: fallbackProducts,
        source: "fallback_catalog"
      });
    }
    products.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
    return send(res, 200, { ok: true, count: products.length, products, source: "firestore" });
  } catch (error) {
    console.warn("[api/products] Firestore read warning:", error.message);
    const fallbackProducts = getFallbackCatalog();
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
    return send(res, 200, {
      ok: true,
      count: fallbackProducts.length,
      products: fallbackProducts,
      source: "fallback_catalog"
    });
  }
});
