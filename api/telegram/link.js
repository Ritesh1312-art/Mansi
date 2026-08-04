"use strict";
const { randomBytes } = require("node:crypto");
const { requireUser } = require("../_lib/auth");
const { services } = require("../_lib/firebase");
const { send, methodNotAllowed } = require("../_lib/http");
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const user = await requireUser(req);
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await services().db.collection("telegramLinkTokens").doc(token).set({ uid: user.uid, createdAt: new Date().toISOString(), expiresAt });
    const username = String(process.env.TELEGRAM_BOT_USERNAME || "MansiJewellery").replace(/^@/, "");
    return send(res, 200, { ok: true, url: `https://t.me/${username}?start=${token}`, expiresAt });
  } catch (error) {
    return send(res, error.statusCode || 500, { ok: false, error: error.message || "Telegram link could not be created" });
  }
};
