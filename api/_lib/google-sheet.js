"use strict";

const { google } = require("googleapis");
const { parseServiceAccount } = require("./firebase");

const HEADERS = [
  "id", "name", "category", "price", "mrp", "description", "image", "stock",
  "inStock", "rating", "reviews", "sales", "createdAt", "updatedAt",
  "isDeleted", "deletedAt", "lastSyncedAt", "syncSource"
];

function config() {
  return {
    spreadsheetId: process.env.GOOGLE_SHEET_ID || "1YPOM0mE6hBYnhco-JKhKohSkbhIVCx2abB2HKTEkmss",
    sheetName: process.env.GOOGLE_SHEET_PRODUCTS_TAB || "Products"
  };
}

function sheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credentials = parseServiceAccount(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

function normalizeProduct(product) {
  const now = new Date().toISOString();
  return {
    id: String(product.id || "").trim(),
    name: String(product.name || "").trim(),
    category: String(product.category || "jewellery").trim().toLowerCase(),
    price: Number(product.price) || 0,
    mrp: Number(product.mrp) || Number(product.price) || 0,
    description: String(product.description || ""),
    image: String(product.imageBackupUrl || product.image || ""),
    stock: Math.max(0, Number(product.stock) || 0),
    inStock: product.inStock !== false && Number(product.stock) > 0,
    rating: Math.max(0, Math.min(5, Number(product.rating) || 0)),
    reviews: Math.max(0, Number(product.reviews) || 0),
    sales: Math.max(0, Number(product.sales) || 0),
    createdAt: String(product.createdAt || now),
    updatedAt: String(product.updatedAt || now),
    isDeleted: product.isDeleted === true || product.archived === true,
    deletedAt: String(product.deletedAt || product.archivedAt || ""),
    lastSyncedAt: now,
    syncSource: String(product.syncSource || "website")
  };
}

function toRow(product) {
  const normalized = normalizeProduct(product);
  return HEADERS.map(header => normalized[header]);
}

function rowToProduct(row) {
  const product = {};
  HEADERS.forEach((header, index) => {
    product[header] = row[index] ?? "";
  });
  product.price = Number(product.price) || 0;
  product.mrp = Number(product.mrp) || product.price;
  product.stock = Math.max(0, Number(product.stock) || 0);
  product.inStock = product.inStock === true || String(product.inStock).toLowerCase() === "true";
  product.rating = Math.max(0, Math.min(5, Number(product.rating) || 0));
  product.reviews = Math.max(0, Number(product.reviews) || 0);
  product.sales = Math.max(0, Number(product.sales) || 0);
  product.isDeleted = product.isDeleted === true || String(product.isDeleted).toLowerCase() === "true";
  return product;
}

const PUBLIC_CSV_URL = process.env.GOOGLE_SHEET_CSV_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxjU88A3UAAG-S9qK9AkGKybrh4VEUPxMzA7RSFfdyktaFcDJmMzkcTCnGGPgZuodDXC800tBn6wmR/pub?output=csv";

async function fetchPublicCSV() {
  const res = await fetch(PUBLIC_CSV_URL);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];

  function parseCSVLine(line) {
    const result = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { result.push(cur.replace(/^"|"$/g, '')); cur = ""; }
      else { cur += c; }
    }
    result.push(cur.replace(/^"|"$/g, ''));
    return result;
  }

  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const products = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] || ""; });
    if (obj.name || obj.id) {
      products.push(rowToProduct([
        obj.id, obj.name, obj.category, obj.price, obj.mrp, obj.description,
        obj.image, obj.stock, obj.instock, obj.rating, obj.reviews, obj.sales,
        obj.createdat, obj.updatedat, obj.isdeleted
      ]));
    }
  }
  return products;
}

async function readProducts() {
  try {
    const { spreadsheetId, sheetName } = config();
    const sheets = sheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:R`,
      valueRenderOption: "UNFORMATTED_VALUE"
    });
    const rows = response.data.values || [];
    if (!rows.length) return [];
    return rows.slice(1).filter(row => row[0]).map(rowToProduct);
  } catch (error) {
    console.warn("Private Google Sheet API fallback to Public CSV:", error.message);
    return await fetchPublicCSV();
  }
}

async function backupProducts(products) {
  const { spreadsheetId, sheetName } = config();
  const sheets = sheetsClient();
  const current = await readProducts();
  const rowById = new Map(current.map((product, index) => [String(product.id), index + 2]));
  const updates = [];
  const appends = [];

  products.filter(product => product && product.id).forEach(product => {
    const row = toRow(product);
    const rowNumber = rowById.get(String(product.id));
    if (rowNumber) {
      updates.push({ range: `${sheetName}!A${rowNumber}:R${rowNumber}`, values: [row] });
    } else {
      appends.push(row);
    }
  });

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: updates }
    });
  }
  if (appends.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:R`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: appends }
    });
  }
  return { updated: updates.length, appended: appends.length, total: products.length };
}

module.exports = { HEADERS, readProducts, backupProducts, normalizeProduct };
