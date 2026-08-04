"use strict";

const { Resend } = require("resend");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function orderText(order) {
  const items = order.items.map(item => `• ${item.name} × ${item.qty} — ₹${item.lineTotal}`).join("\n");
  const address = [order.address.house, order.address.street, order.address.city, order.address.state, order.address.pincode]
    .filter(Boolean).join(", ");
  return [
    `NEW ORDER #${order.id}`,
    `Customer: ${order.customerName}`,
    `Phone: ${order.phone}`,
    `Email: ${order.customerEmail || "-"}`,
    `Address: ${address}`,
    "",
    items,
    "",
    `Subtotal: ₹${order.subtotal}`,
    `Delivery: ₹${order.deliveryCharge}`,
    `Total: ₹${order.grandTotal}`,
    `Payment: ${String(order.paymentMode).toUpperCase()} (${order.paymentStatus})`
  ].join("\n");
}

async function sendTelegram(chatId, text) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token || !chatId) return { sent: false, reason: "not-configured-or-not-linked" };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: String(chatId), text }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram send failed");
  return { sent: true };
}

async function sendOrderEmail(order) {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key || !order.customerEmail) return { sent: false, reason: "not-configured-or-no-email" };
  const resend = new Resend(key);
  const itemsHtml = order.items.map(item =>
    `<tr><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(item.name)} × ${item.qty}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">₹${item.lineTotal}</td></tr>`
  ).join("");
  const { data, error } = await resend.emails.send({
    from: process.env.ORDER_EMAIL_FROM || "Mansi Store <onboarding@resend.dev>",
    to: order.customerEmail,
    subject: `Mansi Store order received — ${order.id}`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f7f4ee;padding:24px;color:#241f1a"><div style="max-width:600px;margin:auto;background:white;border-radius:16px;padding:28px"><h1 style="color:#8a5b16">Order received</h1><p>Namaste ${escapeHtml(order.customerName)}, your order <strong>${escapeHtml(order.id)}</strong> has been safely received.</p><table style="width:100%;border-collapse:collapse">${itemsHtml}</table><p style="font-size:18px"><strong>Total: ₹${order.grandTotal}</strong></p><p>Payment status: ${escapeHtml(order.paymentStatus)}</p><p style="color:#777">Mansi Jewellery &amp; Cosmetics</p></div></body></html>`
  }, {
    headers: { "Idempotency-Key": `order-confirmation-${order.id}` }
  });
  if (error) throw new Error(error.message || "Email send failed");
  return { sent: true, id: data && data.id };
}

async function notifyOrder(order, customerTelegramChatId) {
  const text = orderText(order);
  const ownerChatId = String(process.env.TELEGRAM_OWNER_CHAT_ID || "").trim();
  const results = await Promise.allSettled([
    sendTelegram(ownerChatId, text),
    sendTelegram(customerTelegramChatId, `Your Mansi Store order is confirmed in our system.\n\n${text}`),
    sendOrderEmail(order)
  ]);
  return {
    ownerTelegram: results[0].status === "fulfilled" ? results[0].value : { sent: false, reason: "send-failed" },
    customerTelegram: results[1].status === "fulfilled" ? results[1].value : { sent: false, reason: "send-failed" },
    customerEmail: results[2].status === "fulfilled" ? results[2].value : { sent: false, reason: "send-failed" }
  };
}

module.exports = { notifyOrder, sendTelegram, orderText };
