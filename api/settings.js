const { requireAdmin } = require("./_lib/auth");
const { services } = require("./_lib/firebase");
const { send, sendError, readJson, methodNotAllowed, withErrorHandler } = require("./_lib/http");

const STORE_FIELDS = new Set(["name","tagline","address","city","pincode","email","phone","offerBanner","telegramUsername","gpayUpi","phonepeUpi","paytmUpi"]);
const DELIVERY_FIELDS = new Set(["sameCity","sameState","nearbyStates","restOfIndia"]);

const DEFAULT_STORE = {
  name: "Mansi Jewellery & Cosmetics",
  tagline: "Apna Local Market — Style Meets Tradition",
  address: "Ward No 47, Near Gurudwara, Raipur, Chhattisgarh",
  city: "Raipur",
  pincode: "492001",
  email: "mansialwani5@gmail.com",
  phone: "+91 98765 43210",
  offerBanner: "✨ Browse our latest jewellery and cosmetics collection",
  telegramUsername: "MansiJewellery"
};

const DEFAULT_DELIVERY = {
  sameCity:     { prepaid: 50,  cod: 95  },
  sameState:    { prepaid: 80,  cod: 125 },
  nearbyStates: { prepaid: 120, cod: 165 },
  restOfIndia:  { prepaid: 150, cod: 195 },
};

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

module.exports = withErrorHandler(async function handler(req, res) {
  if (!["GET", "PATCH"].includes(req.method)) return methodNotAllowed(res, ["GET", "PATCH"]);
  const { db, isConfigured } = services();

  if (req.method === "GET") {
    if (!isConfigured || !db) {
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
      return send(res, 200, { ok: true, store: DEFAULT_STORE, delivery: DEFAULT_DELIVERY, source: "default_fallback" });
    }
    try {
      const ref = db.collection("settings").doc("public");
      const snapshot = await ref.get();
      const data = snapshot.exists ? snapshot.data() : {};
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
      return send(res, 200, {
        ok: true,
        store: { ...DEFAULT_STORE, ...(data.store || {}) },
        delivery: { ...DEFAULT_DELIVERY, ...(data.delivery || {}) },
        updatedAt: data.updatedAt || "",
        source: "firestore"
      });
    } catch (e) {
      console.warn("[api/settings] Firestore read warning:", e.message);
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
      return send(res, 200, { ok: true, store: DEFAULT_STORE, delivery: DEFAULT_DELIVERY, source: "default_fallback" });
    }
  }

  if (!isConfigured || !db) {
    return sendError(res, 503, "Cloud database service is not configured for settings modification");
  }

  const admin = await requireAdmin(req);
  const body = await readJson(req);
  const ref = db.collection("settings").doc("public");
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
});
