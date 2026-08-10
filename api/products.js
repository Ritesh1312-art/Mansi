"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { services } = require("./_lib/firebase");
const { send, sendError, methodNotAllowed, withErrorHandler } = require("./_lib/http");
const { getAllProductsMerged } = require("./_lib/catalog-store");

module.exports = withErrorHandler(async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const { db, isConfigured } = services();
  if (!isConfigured || !db) {
    const products = getAllProductsMerged();
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
    return send(res, 200, {
      ok: true,
      count: products.length,
      products,
      source: "catalog_merged"
    });
  }

  try {
    const snapshot = await db.collection("products").get();
    const firestoreProducts = [];
    snapshot.forEach(doc => {
      const data = doc.data() || {};
      if (data.isDeleted === true || data.archived === true) return;
      firestoreProducts.push({ ...data, id: data.id || doc.id });
    });

    const products = firestoreProducts.length > 0 ? firestoreProducts : getAllProductsMerged();
    products.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
    return send(res, 200, { ok: true, count: products.length, products, source: firestoreProducts.length > 0 ? "firestore" : "catalog_merged" });
  } catch (error) {
    console.warn("[api/products] Firestore read warning:", error.message);
    const products = getAllProductsMerged();
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
    return send(res, 200, {
      ok: true,
      count: products.length,
      products,
      source: "catalog_merged"
    });
  }
});

