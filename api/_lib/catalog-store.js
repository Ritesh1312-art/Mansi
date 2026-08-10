"use strict";

const fs = require("node:fs");
const path = require("node:path");

const catalogPath = path.join(__dirname, "..", "..", "data", "catalog.json");
const dynamicPath = path.join(__dirname, "..", "..", "data", "dynamic_products.json");

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

function saveDynamicProduct(product) {
  const current = getDynamicProducts();
  const index = current.findIndex(p => p.id === product.id);
  if (index >= 0) {
    current[index] = { ...current[index], ...product };
  } else {
    current.unshift(product);
  }
  inMemoryDynamic = current;
  try {
    fs.writeFileSync(dynamicPath, JSON.stringify(current, null, 2), "utf8");
  } catch (e) {}
  return product;
}

function archiveDynamicProduct(id) {
  const current = getDynamicProducts();
  const index = current.findIndex(p => p.id === id);
  if (index >= 0) {
    current[index] = { ...current[index], archived: true, isDeleted: true };
  }
  inMemoryDynamic = current;
  try {
    fs.writeFileSync(dynamicPath, JSON.stringify(current, null, 2), "utf8");
  } catch (e) {}
  return id;
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
  saveDynamicProduct,
  archiveDynamicProduct,
  getAllProductsMerged
};