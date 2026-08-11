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
    image: String(product.image || product.imageBackupUrl || ""),
    imageBackupUrl: String(product.imageBackupUrl || ""),
    stock: Math.max(0, Number(product.stock) || 0),
    inStock: product.inStock !== false && Number(product.stock) > 0,
    rating: Math.max(0, Math.min(5, Number(product.rating) || 0)),
    reviews: Math.max(0, Number(product.reviews) || 0),
    sales: Math.max(0, Number(product.sales) || 0),
    createdAt: String(product.createdAt || now),
    updatedAt: String(product.updatedAt || now),
    isDeleted: product.isDeleted === true || product.archived === true,
    deletedAt: String(product.deletedAt || product.archivedAt || ""),
    lastSyncedAt: String(product.lastSyncedAt || now),
    syncSource: String(product.syncSource || "website")
  };
}

function toRow(product) {
  const normalized = normalizeProduct(product);
  return HEADERS.map(header => header === "image"
    ? (normalized.imageBackupUrl || normalized.image)
    : normalized[header]);
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

function parseRFC4180CSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"') {
        if (next === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
      } else if (c === ',') {
        row.push(field);
        field = "";
        i++;
      } else if (c === '\r' && next === '\n') {
        row.push(field);
        field = "";
        if (row.some(f => f.trim())) rows.push(row);
        row = [];
        i += 2;
      } else if (c === '\n' || c === '\r') {
        row.push(field);
        field = "";
        if (row.some(f => f.trim())) rows.push(row);
        row = [];
        i++;
      } else {
        field += c;
        i++;
      }
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    if (row.some(f => f.trim())) rows.push(row);
  }

  return rows;
}

async function fetchPublicCSV() {
  const res = await fetch(PUBLIC_CSV_URL);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  const rows = parseRFC4180CSV(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
  const products = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] || ""; });
    if (obj.name || obj.id) {
      products.push(rowToProduct([
        obj.id, obj.name, obj.category, obj.price, obj.mrp, obj.description,
        obj.image, obj.stock, obj.instock, obj.rating, obj.reviews, obj.sales,
        obj.createdat, obj.updatedat, obj.isdeleted, obj.deletedat,
        obj.lastsyncedat, obj.syncsource
      ]));
    }
  }
  return products;
}

async function readProductsPrivate() {
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
}

async function readProducts() {
  try {
    return await readProductsPrivate();
  } catch (error) {
    console.warn("Private Google Sheet API fallback to Public CSV:", error.message);
    return await fetchPublicCSV();
  }
}

async function backupProducts(products) {
  const { spreadsheetId, sheetName } = config();
  const sheets = sheetsClient();
  const current = await readProductsPrivate();
  const rowById = new Map(current.map((product, index) => [String(product.id), index + 2]));
  const updates = [];
  const appends = [];
  const syncTime = new Date().toISOString();
  const requested = products
    .filter(product => product && product.id)
    .map(product => normalizeProduct({ ...product, lastSyncedAt: syncTime }));

  requested.forEach(product => {
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

  // A Sheet API write acknowledgement is not enough: re-read and verify every
  // requested ID so the admin UI never reports a false "synced" success.
  const verifiedRows = await readProductsPrivate();
  const rowsById = new Map();
  verifiedRows.forEach(product => {
    const id = String(product.id || "");
    if (!rowsById.has(id)) rowsById.set(id, []);
    rowsById.get(id).push(product);
  });

  for (const expected of requested) {
    const matches = rowsById.get(String(expected.id)) || [];
    if (matches.length !== 1) {
      throw new Error(`Google Sheet verification failed for ${expected.id}: expected one row, found ${matches.length}`);
    }
    const actual = matches[0];
    const same = String(actual.name) === String(expected.name)
      && Number(actual.price) === Number(expected.price)
      && Number(actual.stock) === Number(expected.stock)
      && String(actual.updatedAt) === String(expected.updatedAt)
      && Boolean(actual.isDeleted) === Boolean(expected.isDeleted);
    if (!same) throw new Error(`Google Sheet verification mismatch for ${expected.id}`);
  }

  return {
    updated: updates.length,
    appended: appends.length,
    total: requested.length,
    verified: true,
    verifiedIds: requested.map(product => product.id),
    verifiedAt: syncTime
  };
}

module.exports = {
  HEADERS,
  readProducts,
  readProductsPrivate,
  backupProducts,
  normalizeProduct,
  parseRFC4180CSV
};

