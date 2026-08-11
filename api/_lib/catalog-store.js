"use strict";

const fs = require("node:fs");
const path = require("node:path");

const catalogPath = path.join(__dirname, "..", "..", "data", "catalog.json");
const dynamicPath = path.join(__dirname, "..", "..", "data", "dynamic_products.json");

// This module is an immutable deployment fallback. Vercel Functions cannot
// durably write repository files; all live admin mutations belong in Firestore.

let inMemoryDynamic = null;

function getStaticCatalog() {
  try {
    if (fs.existsSync(catalogPath)) {
      const data = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
      return Array.isArray(data.products) ? data.products : [];
    }
  } catch (e) {
    console.warn("Failed to read static catalog.json:", e.message);
  }
  return [];
}

function getDynamicProducts() {
  if (inMemoryDynamic !== null) return inMemoryDynamic;
  try {
    if (fs.existsSync(dynamicPath)) {
      const data = JSON.parse(fs.readFileSync(dynamicPath, "utf8"));
      inMemoryDynamic = Array.isArray(data) ? data : [];
      return inMemoryDynamic;
    }
  } catch (e) {
    console.warn("Failed to read dynamic_products.json:", e.message);
  }
  inMemoryDynamic = [];
  return inMemoryDynamic;
}

function getAllProductsMerged() {
  const staticProducts = getStaticCatalog();
  const dynamicProducts = getDynamicProducts();

  const map = new Map();
  staticProducts.forEach(p => {
    if (p && p.id && !p.archived && !p.isDeleted) map.set(p.id, p);
  });
  dynamicProducts.forEach(p => {
    if (!p || !p.id) return;
    if (p.archived || p.isDeleted) {
      map.delete(p.id);
    } else {
      map.set(p.id, p);
    }
  });

  return Array.from(map.values()).sort((a, b) => 
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
}

module.exports = {
  getStaticCatalog,
  getDynamicProducts,
  getAllProductsMerged
};
