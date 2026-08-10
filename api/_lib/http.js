"use strict";

const crypto = require("node:crypto");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!res.hasHeader("Cache-Control")) res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function sendError(res, status, message, details = null) {
  const requestId = "req_" + crypto.randomBytes(6).toString("hex");
  return send(res, status, {
    ok: false,
    error: message,
    requestId,
    ...(details ? { details } : {})
  });
}

async function readJson(req, maxBytes = 8 * 1024 * 1024) {
  if (req.body && typeof req.body === "object") return req.body;
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new Error("Request body is too large");
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error("Invalid JSON body payload");
  }
}

function methodNotAllowed(res, methods) {
  res.setHeader("Allow", methods.join(", "));
  return sendError(res, 405, "Method not allowed");
}

function withErrorHandler(handler) {
  return async function(req, res) {
    try {
      return await handler(req, res);
    } catch (err) {
      console.error("[API Runtime Error]", req.url, err);
      if (!res.headersSent) {
        return sendError(res, 500, err.message || "Internal server runtime error");
      }
    }
  };
}

module.exports = { send, sendError, readJson, methodNotAllowed, withErrorHandler };
