"use strict";

const { services } = require("./firebase");

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function requireUser(req) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error("Sign in required");
    error.statusCode = 401;
    throw error;
  }
  try {
    return await services().auth.verifyIdToken(token, true);
  } catch {
    const error = new Error("Session expired or invalid");
    error.statusCode = 401;
    throw error;
  }
}

async function requireAdmin(req) {
  const decoded = await requireUser(req);
  const allowlist = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const email = String(decoded.email || "").toLowerCase();
  if (!decoded.admin && (!email || !allowlist.includes(email))) {
    const error = new Error("Admin access required");
    error.statusCode = 403;
    throw error;
  }
  return decoded;
}

module.exports = { requireUser, requireAdmin };
