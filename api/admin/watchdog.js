"use strict";

const { requireAdmin } = require("../_lib/auth");
const { services } = require("../_lib/firebase");
const { send, methodNotAllowed } = require("../_lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    await requireAdmin(req);
    const snapshot = await services().db.collection("watchdogReports")
      .orderBy("createdAt", "desc").limit(20).get();
    const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return send(res, 200, { ok: true, reports });
  } catch (error) {
    return send(res, error.statusCode || 500, { ok: false, error: error.message || "Watchdog reports unavailable" });
  }
};
