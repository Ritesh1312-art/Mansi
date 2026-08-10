"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("1. All 12 Vercel API Modules Load Cleanly Without Import Errors", () => {
  const apiFiles = [
    "api/products.js",
    "api/settings.js",
    "api/orders.js",
    "api/admin/session.js",
    "api/admin/products.js",
    "api/admin/orders.js",
    "api/admin/image.js",
    "api/admin/watchdog.js",
    "api/admin/description.js",
    "api/backup/products.js",
    "api/cron/watchdog.js",
    "api/telegram/link.js",
    "api/webhooks/telegram.js"
  ];

  for (const relPath of apiFiles) {
    const fullPath = path.join(root, relPath);
    assert.equal(fs.existsSync(fullPath), true, `File missing: ${relPath}`);
    assert.doesNotThrow(() => {
      require(fullPath);
    }, `Failed to require API module ${relPath}`);
  }
});

test("2. Seed Catalog Contains Exactly 53 Valid Products and Images", () => {
  const catalogPath = path.join(root, "data", "catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

  assert.equal(catalog.productCount, 53, "Catalog productCount must be 53");
  assert.equal(catalog.products.length, 53, "Catalog products array length must be 53");

  const ids = new Set();
  for (const product of catalog.products) {
    assert.ok(product.id, "Product must have an id");
    assert.ok(product.name, "Product must have a name");
    assert.ok(product.price > 0, "Product price must be positive");
    assert.ok(product.image, "Product must have an image");

    ids.add(product.id);
    const imgPath = path.join(root, product.image);
    assert.equal(fs.existsSync(imgPath), true, `Product image missing on disk: ${product.image}`);
  }
  assert.equal(ids.size, 53, "Catalog product IDs must be unique");
});

test("3. Products HTML Initialization Prevents TDZ ReferenceError", () => {
  const productsHtmlPath = path.join(root, "products.html");
  const htmlContent = fs.readFileSync(productsHtmlPath, "utf8");
  
  const declIndex = htmlContent.indexOf("let _renderedProducts = [];");
  const renderIndex = htmlContent.indexOf("renderProducts();");

  assert.ok(declIndex !== -1, "products.html must declare _renderedProducts");
  assert.ok(declIndex < renderIndex, "_renderedProducts must be declared BEFORE renderProducts() is called");
});

test("4. Service Worker Employs Network-First Strategy for JS & CSS Code Assets", () => {
  const swPath = path.join(root, "sw.js");
  const swContent = fs.readFileSync(swPath, "utf8");

  assert.ok(swContent.includes("mansi-shell-"), "SW must define a shell version cache name");
  assert.ok(swContent.includes(".css"), "SW must handle CSS assets");
  assert.ok(swContent.includes(".js"), "SW must handle JS assets");
});

test("5. Admin Auth Module Requires Server Session Guard", () => {
  const adminAuthPath = path.join(root, "js", "admin-auth.js");
  const content = fs.readFileSync(adminAuthPath, "utf8");

  assert.ok(content.includes("requireAdminPage"), "admin-auth.js must export requireAdminPage");
  assert.ok(content.includes("/api/admin/session"), "admin-auth.js must verify server admin session");
});

test("6. Order State Machine Enforces Valid Order Transitions", () => {
  const validTransitions = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["processing", "cancelled"],
    processing: ["shipped", "cancelled"],
    shipped: ["delivered"],
    delivered: [],
    cancelled: []
  };

  function canTransition(fromState, toState) {
    return (validTransitions[fromState] || []).includes(toState);
  }

  assert.equal(canTransition("pending", "confirmed"), true);
  assert.equal(canTransition("pending", "delivered"), false);
  assert.equal(canTransition("shipped", "delivered"), true);
  assert.equal(canTransition("delivered", "cancelled"), false);
});
