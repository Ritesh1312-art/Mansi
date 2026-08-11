"use strict";

const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { put } = require("@vercel/blob");
const { requireAdmin } = require("../_lib/auth");
const { send, readJson, methodNotAllowed } = require("../_lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    await requireAdmin(req);
    const body = await readJson(req, 4 * 1024 * 1024);
    const productId = String(body.productId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
    const match = String(body.dataUrl || "").match(/^data:image\/(?:png|jpe?g|webp);base64,(.+)$/);
    if (!productId || !match) throw new Error("Valid product image is required");
    const input = Buffer.from(match[1], "base64");
    if (input.length > 3 * 1024 * 1024) throw new Error("Processed image must be smaller than 3 MB");
    const output = await sharp(input, { failOn: "error" })
      .rotate()
      .resize(900, 900, { fit: "contain", background: "#ffffff", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .webp({ quality: 86, effort: 4 })
      .toBuffer();
    const path = `products/${productId}/${Date.now()}-${randomUUID()}.webp`;
    const blob = await put(path, output, {
      access: "public",
      addRandomSuffix: false,
      cacheControlMaxAge: 31536000,
      contentType: "image/webp",
    });
    return send(res, 201, { ok: true, url: blob.url, path: blob.pathname, bytes: output.length });
  } catch (error) {
    console.error("admin.image", error.message);
    return send(res, error.statusCode || 400, { ok: false, error: error.message || "Image upload failed" });
  }
};
