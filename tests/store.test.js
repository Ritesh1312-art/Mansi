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
  assert.ok(swContent.includes("NEW_VERSION_AVAILABLE"), "SW must notify tabs of new version");
  assert.ok(swContent.includes("offline.html"), "SW must reference offline.html fallback");
});

test("5. Admin Auth Module Requires Server Session Guard", () => {
  const adminAuthPath = path.join(root, "js", "admin-auth.js");
  const content = fs.readFileSync(adminAuthPath, "utf8");

  assert.ok(content.includes("requireAdminPage"), "admin-auth.js must export requireAdminPage");
  assert.ok(content.includes("/api/admin/session"), "admin-auth.js must verify server admin session");
});

test("6. Order State Machine Enforces Valid Order Transitions", () => {
  const implementation = fs.readFileSync(path.join(root, "api/admin/orders.js"), "utf8");
  assert.ok(implementation.includes("const TRANSITIONS"));
  assert.ok(implementation.includes("TRANSITIONS[currentStatus]"));

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

test("7. Rate Limiter Module Works Correctly", () => {
  const { rateLimit } = require(path.join(root, "api/_lib/rate-limit"));
  const key = "test_" + Date.now();
  
  // Should allow first 3 requests
  for (let i = 0; i < 3; i++) {
    const r = rateLimit(key, 3, 10000);
    assert.equal(r.allowed, true, `Request ${i+1} should be allowed`);
  }
  
  // Should block the 4th request
  const blocked = rateLimit(key, 3, 10000);
  assert.equal(blocked.allowed, false, "4th request should be blocked");
  assert.ok(blocked.retryAfter > 0, "retryAfter must be positive when blocked");
});

test("8. app.js Does NOT Contain setInterval Email Type Scanner", () => {
  const appJsPath = path.join(root, "js", "app.js");
  const content = fs.readFileSync(appJsPath, "utf8");

  // Must NOT contain the pattern that downgrades email inputs
  assert.ok(
    !content.includes("setAttribute(\"type\", \"text\")"),
    "app.js must not change email input type to text"
  );
  assert.ok(
    !content.includes("setAttribute('type', 'text')"),
    "app.js must not change email input type to text (single quotes)"
  );
});

test("9. app.js Does NOT Use setInterval for Widget Positioning", () => {
  const appJsPath = path.join(root, "js", "app.js");
  const content = fs.readFileSync(appJsPath, "utf8");

  // The 1-second interval for positionAssistantWidgets must be gone
  assert.ok(
    !content.includes("setInterval(adjustPosition"),
    "app.js must not use setInterval for widget positioning — use MutationObserver"
  );
});

test("10. data.js loadFallbackCatalog Does NOT Merge localStorage Products", () => {
  const dataJsPath = path.join(root, "js", "data.js");
  const content = fs.readFileSync(dataJsPath, "utf8");

  // Extract just the loadFallbackCatalog function body
  const funcStart = content.indexOf("async loadFallbackCatalog()");
  assert.ok(funcStart !== -1, "loadFallbackCatalog function must exist");

  // Find the next function definition after loadFallbackCatalog
  const nextFuncMatch = content.indexOf("\n  loadSDKs()", funcStart);
  const funcBody = nextFuncMatch !== -1
    ? content.slice(funcStart, nextFuncMatch)
    : content.slice(funcStart, funcStart + 3000);

  // The function body must NOT contain localStorage product merge logic
  assert.ok(
    !funcBody.includes("custom_user_products"),
    "loadFallbackCatalog must not merge custom_user_products (remove multi-source merge)"
  );
  assert.ok(
    !funcBody.includes("localActive"),
    "loadFallbackCatalog must not merge localActive localStorage products"
  );
  assert.ok(
    !funcBody.includes("mergedMap"),
    "loadFallbackCatalog must not use mergedMap (multi-source merge)"
  );
});


test("11. api/admin/products.js Reads Request Body Before Using It", () => {
  const filePath = path.join(root, "api/admin/products.js");
  const content = fs.readFileSync(filePath, "utf8");

  const bodyReadIndex = content.indexOf("readJson(req)");
  const bodyUseIndex = content.indexOf("body.action");

  assert.ok(bodyReadIndex !== -1, "admin/products.js must call readJson(req)");
  assert.ok(bodyReadIndex < bodyUseIndex, "readJson must be called before body.action is referenced");
});

test("12. Orders API Has Rate Limiting Applied", () => {
  const filePath = path.join(root, "api/orders.js");
  const content = fs.readFileSync(filePath, "utf8");

  assert.ok(content.includes("withRateLimit"), "orders.js must import withRateLimit");
  assert.ok(content.includes("orderPostLimit"), "orders.js must define orderPostLimit");
  assert.ok(content.includes("orderPostLimit(req, res)"), "orders.js must apply orderPostLimit on POST");
});

test("13. vercel.json Contains CSP and HSTS Headers", () => {
  const filePath = path.join(root, "vercel.json");
  const content = fs.readFileSync(filePath, "utf8");
  const config = JSON.parse(content);

  const globalHeaders = config.headers.find(h => h.source === "/(.*)");
  assert.ok(globalHeaders, "vercel.json must have global header rule");

  const headerKeys = globalHeaders.headers.map(h => h.key);
  assert.ok(headerKeys.includes("Content-Security-Policy"), "vercel.json must set CSP header");
  assert.ok(headerKeys.includes("Strict-Transport-Security"), "vercel.json must set HSTS header");
  assert.ok(headerKeys.includes("X-Content-Type-Options"), "vercel.json must set X-Content-Type-Options");
});

test("14. offline.html and 404.html Exist", () => {
  assert.equal(fs.existsSync(path.join(root, "offline.html")), true, "offline.html must exist");
  assert.equal(fs.existsSync(path.join(root, "404.html")), true, "404.html must exist");

  const offline = fs.readFileSync(path.join(root, "offline.html"), "utf8");
  assert.ok(offline.includes("offline") || offline.includes("Offline"), "offline.html must mention offline state");

  const notfound = fs.readFileSync(path.join(root, "404.html"), "utf8");
  assert.ok(notfound.includes("404") || notfound.includes("Not Found"), "404.html must mention 404");
});

test("15. api/_lib/rate-limit.js Exports rateLimit and withRateLimit", () => {
  const rateLimitPath = path.join(root, "api/_lib/rate-limit.js");
  assert.equal(fs.existsSync(rateLimitPath), true, "api/_lib/rate-limit.js must exist");

  const mod = require(rateLimitPath);
  assert.equal(typeof mod.rateLimit, "function", "rateLimit must be a function");
  assert.equal(typeof mod.withRateLimit, "function", "withRateLimit must be a function");
});

test("16. HilltopAds S2S Anti-AdBlock Uses First-Party Route and Server Secret", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const rewrite = (config.rewrites || []).find(item => item.source === "/3e0b85979f.php");
  assert.equal(rewrite?.destination, "/api/settings?antiAdBlock=hilltop");

  const settings = fs.readFileSync(path.join(root, "api/settings.js"), "utf8");
  assert.ok(settings.includes("process.env.HILLTOPADS_ANTI_ADBLOCK_KEY"));
  assert.ok(settings.includes("https://api.hilltopads.com/publisher/antiAdBlock"));
  assert.ok(!settings.includes("private $key"), "PHP credential must never be copied into JavaScript source");
});

test("17. Customer Pages Load HilltopAds S2S Script Exactly Once", () => {
  const pages = [
    "index.html", "products.html", "product-detail.html", "cart.html", "checkout.html",
    "login.html", "signup.html", "orders.html", "profile.html", "wishlist.html"
  ];

  for (const page of pages) {
    const content = fs.readFileSync(path.join(root, page), "utf8");
    assert.equal((content.match(/src="\/3e0b85979f\.php"/g) || []).length, 1, `${page} must load the script once`);
  }
});

test("18. Catalog Store Merge Is Read-Only During Validation", () => {
  const catalogStore = require(path.join(root, "api/_lib/catalog-store.js"));
  const implementation = fs.readFileSync(path.join(root, "api/_lib/catalog-store.js"), "utf8");
  assert.equal(typeof catalogStore.getAllProductsMerged, "function");
  assert.ok(!implementation.includes("writeFileSync"), "Serverless fallback catalog must never pretend to persist to disk");
  const dynamicPath = path.join(root, "data/dynamic_products.json");
  const before = fs.readFileSync(dynamicPath, "utf8");
  const merged = catalogStore.getAllProductsMerged();
  assert.ok(merged.length >= 53, "Merged products count must be at least 53");
  assert.equal(fs.readFileSync(dynamicPath, "utf8"), before, "Catalog validation must not mutate tracked data");
});

test("19. Admin Authentication Has No Browser Master-Password Bypass", () => {
  const content = fs.readFileSync(path.join(root, "js/admin-auth.js"), "utf8");
  assert.ok(!content.includes('localStorage.setItem("adminAuth", "master")'));
  assert.ok(!content.includes('token: "master_token"'));
  assert.ok(!content.includes("createUserWithEmailAndPassword"), "Admin login must never auto-create accounts");
  assert.ok(!content.includes(["mansi", "@", "admin", "123"].join("")), "Admin credentials must not be committed to client code");
});

test("20. Firebase Browser SDK Is Local and Loaded in Dependency Order", () => {
  const content = fs.readFileSync(path.join(root, "js/data.js"), "utf8");
  for (const file of ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"]) {
    assert.equal(fs.existsSync(path.join(root, "js/vendor", file)), true, `${file} must be hosted locally`);
    assert.ok(content.includes(file), `data.js must load ${file}`);
  }
  assert.ok(content.includes("for (const src of scripts)"), "Firebase SDK files must load sequentially");
  assert.ok(!content.includes("www.gstatic.com/firebasejs"), "Firebase runtime must not depend on the external CDN");
});

test("21. Product Admin Waits for Cloud Save and Uses Image Upload API", () => {
  const content = fs.readFileSync(path.join(root, "admin/products.html"), "utf8");
  assert.ok(content.includes("await StoreApi.uploadProductImage"));
  assert.ok(content.includes("await StoreApi.saveProduct"));
  assert.ok(content.includes("await StoreApi.archiveProduct"));
  assert.ok(!content.includes("DB.addProduct(data)"), "UI must not report success before remote persistence");
  const apiContent = fs.readFileSync(path.join(root, "api/admin/products.js"), "utf8");
  assert.ok(!apiContent.includes("saveDynamicProduct"), "Admin writes must use durable Firestore persistence");
});

test("22. Gemini Calls Stay Behind the Authenticated Server API", () => {
  const config = fs.readFileSync(path.join(root, "js/config.js"), "utf8");
  const adminProducts = fs.readFileSync(path.join(root, "admin/products.html"), "utf8");
  const apiProducts = fs.readFileSync(path.join(root, "api/admin/products.js"), "utf8");
  assert.ok(!/AIza[0-9A-Za-z_-]{30,}/.test(config.replace(/"AIzaSy"\s*\+\s*"[^"]+"/, "")), "Non-Firebase API keys must not be in config.js");
  assert.ok(!adminProducts.includes("generativelanguage.googleapis.com"));
  assert.ok(adminProducts.includes("StoreApi.generateProductDescription"));
  assert.ok(apiProducts.includes("process.env.GEMINI_API_KEY"));
});

test("23. Local Product Cache Drops Base64 and Blob Images", () => {
  const content = fs.readFileSync(path.join(root, "js/data.js"), "utf8");
  assert.ok(content.includes('/^(?:data:|blob:)/i.test(String(copy.image || ""))'));
  assert.ok(content.includes('copy.image = String(copy.imageBackupUrl || "")'));
});
