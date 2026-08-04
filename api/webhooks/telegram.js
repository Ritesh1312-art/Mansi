"use strict";
const { services } = require("../_lib/firebase");
const { send, readJson, methodNotAllowed } = require("../_lib/http");
const { sendTelegram } = require("../_lib/notifications");
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || "");
  if (!expected || req.headers["x-telegram-bot-api-secret-token"] !== expected) return send(res, 401, { ok: false });
  try {
    const update = await readJson(req);
    const message = update.message || {};
    const match = String(message.text || "").match(/^\/start\s+([A-Za-z0-9_-]{20,})$/);
    if (!match || !message.chat?.id) return send(res, 200, { ok: true, ignored: true });
    const tokenRef = services().db.collection("telegramLinkTokens").doc(match[1]);
    await services().db.runTransaction(async transaction => {
      const snapshot = await transaction.get(tokenRef);
      if (!snapshot.exists) throw new Error("Link expired or already used");
      const data = snapshot.data() || {};
      if (!data.uid || new Date(data.expiresAt).getTime() < Date.now()) throw new Error("Link expired");
      transaction.set(services().db.collection("users").doc(data.uid), {
        telegramChatId: String(message.chat.id),
        telegramUsername: String(message.from?.username || ""),
        telegramLinkedAt: new Date().toISOString()
      }, { merge: true });
      transaction.delete(tokenRef);
    });
    await sendTelegram(message.chat.id, "✅ Your Telegram is now linked to Mansi Store. Future order confirmations can be sent here.");
    return send(res, 200, { ok: true, linked: true });
  } catch (error) {
    console.error("telegram.webhook", error.message);
    return send(res, 200, { ok: true, linked: false });
  }
};
