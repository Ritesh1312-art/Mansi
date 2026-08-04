"use strict";

const { services } = require("./_lib/firebase");
const { send, methodNotAllowed } = require("./_lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    const snapshot = await services().db.collection("products").get();
    const products = [];
    snapshot.forEach(doc => {
      const data = doc.data() || {};
      if (data.isDeleted === true || data.archived === true) return;
      products.push({ ...data, id: data.id || doc.id });
    });
    products.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
    return send(res, 200, { ok: true, count: products.length, products });
  } catch (error) {
    console.error("products.get", error.message);
    return send(res, 503, { ok: false, error: "Catalog is temporarily unavailable" });
  }
};
