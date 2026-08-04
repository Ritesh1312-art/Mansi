"use strict";

const { services } = require("../_lib/firebase");
const { readProducts, backupProducts } = require("../_lib/google-sheet");
const { sendTelegram, notifyOrder } = require("../_lib/notifications");
const { send, methodNotAllowed } = require("../_lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || req.headers.authorization !== expected) {
    return send(res, 401, { ok: false, error: "Unauthorized" });
  }

  try {
    const { db } = services();
    const pendingBackups = await db.collection("backupOutbox").limit(100).get();
    if (!pendingBackups.empty) {
      try {
        await backupProducts(pendingBackups.docs.map(doc => doc.data().product).filter(Boolean));
        const batch = db.batch();
        pendingBackups.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      } catch (error) {
        console.warn("watchdog.backup-retry", error.message);
      }
    }

    const notificationRetries = await db.collection("orders").where("notificationRetryPending", "==", true).limit(25).get();
    for (const orderDoc of notificationRetries.docs) {
      try {
        const order = { ...orderDoc.data(), id: orderDoc.data().id || orderDoc.id };
        const userSnapshot = order.userId ? await db.collection("users").doc(String(order.userId)).get() : null;
        const chatId = userSnapshot?.exists ? userSnapshot.data().telegramChatId : "";
        const notifications = await notifyOrder(order, chatId);
        const notificationRetryPending = Object.values(notifications).some(result => result.sent !== true && !String(result.reason || "").startsWith("not-configured"));
        await orderDoc.ref.set({ notifications, notificationRetryPending, notificationUpdatedAt: new Date().toISOString() }, { merge: true });
      } catch (error) {
        console.warn("watchdog.notification-retry", orderDoc.id, error.message);
      }
    }

    const [productSnapshot, orderSnapshot, outboxSnapshot, sheetResult] = await Promise.all([
      db.collection("products").get(),
      db.collection("orders").get(),
      db.collection("backupOutbox").get(),
      readProducts().then(products => ({ ok: true, products })).catch(error => ({ ok: false, error: error.message }))
    ]);
    const activeProducts = productSnapshot.docs.filter(doc => {
      const product = doc.data() || {};
      return !product.archived && !product.isDeleted;
    });
    const sheetProducts = sheetResult.ok ? sheetResult.products.filter(product => !product.isDeleted) : [];
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short"
    });
    const status = activeProducts.length > 0 && sheetResult.ok && outboxSnapshot.size === 0 ? "HEALTHY" : "ATTENTION";
    const report = [
      `MANSI STORE WATCHDOG — ${status}`,
      formatter.format(now),
      "",
      `Website products: ${activeProducts.length}`,
      `Google Sheet products: ${sheetResult.ok ? sheetProducts.length : "unavailable"}`,
      `Orders: ${orderSnapshot.size}`,
      `Backup retry queue: ${outboxSnapshot.size}`,
      "",
      activeProducts.length === 0 ? "Catalog alert: Firestore returned zero active products." : "Catalog: available",
      sheetResult.ok ? "Sheet backup: reachable" : "Sheet backup: unreachable",
      "No automatic deletion was performed."
    ].join("\n");

    const telegram = await sendTelegram(process.env.TELEGRAM_OWNER_CHAT_ID, report);
    await db.collection("watchdogReports").add({
      status,
      activeProducts: activeProducts.length,
      sheetProducts: sheetResult.ok ? sheetProducts.length : null,
      orders: orderSnapshot.size,
      backupOutbox: outboxSnapshot.size,
      telegramSent: telegram.sent === true,
      createdAt: now.toISOString(),
      schedule: "09:00-and-21:00-Asia/Kolkata"
    });
    return send(res, 200, { ok: true, status, telegramSent: telegram.sent === true });
  } catch (error) {
    console.error("watchdog", error.message);
    return send(res, 500, { ok: false, error: "Watchdog check failed" });
  }
};
