"use strict";

const { requireAdmin } = require("../_lib/auth");
const { send, methodNotAllowed } = require("../_lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    const admin = await requireAdmin(req);
    return send(res, 200, { ok: true, uid: admin.uid, email: admin.email || "" });
  } catch (error) {
    return send(res, error.statusCode || 500, { ok: false, error: error.message || "Admin session check failed" });
  }
};
