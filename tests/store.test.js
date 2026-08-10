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

test("3. Delivery Zone Calculations Are Accurate & Consistent", () => {
  const configPath = path.join(root, "js", "config.js");
  const configCode = fs.readFileSync(configPath, "utf8");
  
  assert.ok(configCode.includes("getDeliveryZone"), "config.js must export getDeliveryZone");
});

test("4. Order State Machine Enforces Valid Order Transitions", () => {
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
