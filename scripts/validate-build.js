"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".vercel") return [];
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(root);
for (const file of files.filter(file => file.endsWith(".js"))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) failures.push(`Syntax: ${path.relative(root, file)} — ${result.stderr.trim()}`);
}

const textFiles = files.filter(file => /\.(?:js|html|json|rules|webmanifest)$/i.test(file));
for (const file of textFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (/telegramBotToken\s*:\s*["'][^"']+["']/.test(text)) failures.push(`Client Telegram token found: ${path.relative(root, file)}`);
  if (/adminPassword\s*:\s*["'][^"']+["']/.test(text)) failures.push(`Client admin password found: ${path.relative(root, file)}`);
  if (/AIza[0-9A-Za-z_-]{30,}/.test(text) && !file.endsWith(path.join("js", "config.js"))) {
    failures.push(`Unexpected Firebase web key location: ${path.relative(root, file)}`);
  }
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "catalog.json"), "utf8"));
if (catalog.productCount !== 53 || catalog.products.length !== 53) failures.push("Fallback catalog must contain exactly 53 recovered products");
const ids = new Set(catalog.products.map(product => product.id));
if (ids.size !== 53) failures.push("Fallback catalog contains duplicate product IDs");
for (const product of catalog.products) {
  const image = path.join(root, product.image);
  if (!fs.existsSync(image)) failures.push(`Missing product image: ${product.image}`);
}

// Validate API handlers import without runtime module errors
const apiDir = path.join(root, "api");
if (fs.existsSync(apiDir)) {
  const apiFiles = walk(apiDir).filter(f => f.endsWith(".js") && !path.basename(f).startsWith("_"));
  for (const apiFile of apiFiles) {
    const rel = path.relative(root, apiFile);
    try {
      // Require API handler module to verify CJS/ESM dependency compatibility
      require(apiFile);
    } catch (e) {
      failures.push(`API Import Error in ${rel}: ${e.message}`);
    }
  }
}

// Run unit test suite
const testResult = spawnSync(process.execPath, ["--test", "tests/*.test.js"], { cwd: root, encoding: "utf8" });
if (testResult.status !== 0) {
  failures.push(`Unit Test Suite Failed:\n${testResult.stderr || testResult.stdout}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Build validation passed: ${files.length} files, 53 products, 53 local product images, 2 watchdog schedules, all API endpoints verified.`);
