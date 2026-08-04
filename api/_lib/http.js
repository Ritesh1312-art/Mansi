"use strict";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!res.hasHeader("Cache-Control")) res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 8 * 1024 * 1024) {
  if (req.body && typeof req.body === "object") return req.body;
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new Error("Request body is too large");
  }
  if (!body) return {};
  return JSON.parse(body);
}

function methodNotAllowed(res, methods) {
  res.setHeader("Allow", methods.join(", "));
  return send(res, 405, { ok: false, error: "Method not allowed" });
}

module.exports = { send, readJson, methodNotAllowed };
