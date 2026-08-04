"use strict";

const { requireAdmin } = require("./_lib/auth");
const { services } = require("./_lib/firebase");
const { send, readJson, methodNotAllowed } = require("./_lib/http");

const STORE_FIELDS = new Set(["name","tagline","address","city","pincode","email","phone","offerBanner","telegramUsername","gpayUpi","phonepeUpi","paytmUpi"]);
const DELIVERY_FIELDS = new Set(["sameCity","sameState","nearbyStates","restOfIndia"]);

function pick(source, allowed) {
  return Object.fromEntries(Object.entries(source || {}).filter(([key]) => allowed.has(key)));
}

function cleanStore(source) {
  const result = pick(source, STORE_FIELDS);
  Object.keys(result).forEach(key => {
    result[key] = String(result[key] ?? "").trim().slice(0, key === "offerBanner" ? 300 : 160);
  });
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error("Valid store email is required");
  if (result.telegramUsername) result.telegramUsername = result.telegramUsername.replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");
  for (const key of ["gpayUpi", "phonepeUpi", "paytmUpi"]) {
    if (result[key] && !/^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/.test(result[key])) throw new Error(`Invalid ${key} value`);
  }
  return result;
}

function cleanDelivery(source) {
  const result = {};
  Object.entries(pick(source, DELIVERY_FIELDS)).forEach(([zone, value]) => {
    const prepaid = Number(value?.prepaid);
    const cod = Number(value?.cod);
    if (!Number.isFinite(prepaid) || !Number.isFinite(cod) || prepaid < 0 || cod < 0 || prepaid > 10000 || cod > 10000) {
      throw new Error(`Invalid delivery rates for ${zone}`);
    }
    result[zone] = { prepaid, cod };
  });
  return result;
}

module.exports = async function handler(req, res) {
  if (!["GET", "PATCH"].includes(req.method)) return methodNotAllowed(res, ["GET", "PATCH"]);
  try {
    const { db } = services();
    const ref = db.collection("settings").doc("public");
    if (req.method === "GET") {
      const snapshot = await ref.get();
      const data = snapshot.exists ? snapshot.data() : {};
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
      return send(res, 200, { ok: true, store: data.store || {}, delivery: data.delivery || {}, updatedAt: data.updatedAt || "" });
    }
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    const currentSnapshot = await ref.get();
    const current = currentSnapshot.exists ? currentSnapshot.data() || {} : {};
    const update = {
      store: { ...(current.store || {}), ...cleanStore(body.store) },
      delivery: { ...(current.delivery || {}), ...cleanDelivery(body.delivery) },
      updatedAt: new Date().toISOString(),
      updatedBy: admin.email || admin.uid
    };
    await ref.set(update, { merge: true });
    return send(res, 200, { ok: true, ...update });
  } catch (error) {
    console.error("settings", error.message);
    return send(res, error.statusCode || 500, { ok: false, error: error.message || "Settings request failed" });
  }
};
