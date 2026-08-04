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

const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const schedules = (vercel.crons || []).map(cron => cron.schedule).sort();
if (JSON.stringify(schedules) !== JSON.stringify(["30 15 * * *", "30 3 * * *"])) {
  failures.push("Watchdog cron must run only at 09:00 and 21:00 Asia/Kolkata");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Build validation passed: ${files.length} files, 53 products, 53 local product images, 2 watchdog schedules.`);
