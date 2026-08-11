"use strict";

const { services } = require("../_lib/firebase");
const { readProductsPrivate, backupProducts } = require("../_lib/google-sheet");
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
    const pendingBackups = await db.collection("backupOutbox").orderBy("updatedAt", "asc").limit(100).get();
    for (const pendingDoc of pendingBackups.docs) {
      const pending = pendingDoc.data() || {};
      const product = pending.product;
      if (!product || !product.id) continue;
      try {
        const backup = await backupProducts([product]);
        const batch = db.batch();
        batch.set(db.collection("products").doc(String(product.id)), {
          backupStatus: "synced",
          backupVerifiedAt: backup.verifiedAt || new Date().toISOString(),
          backupLastError: null
        }, { merge: true });
        batch.delete(pendingDoc.ref);
        await batch.commit();
      } catch (error) {
        const attempts = (Number(pending.attempts) || 0) + 1;
        await pendingDoc.ref.set({
          attempts,
          lastAttemptAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastError: String(error.message || error).slice(0, 500),
          deadLetter: attempts >= 20
        }, { merge: true });
        console.warn("watchdog.backup-retry", product.id, error.message);
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

    const [productResult, orderResult, outboxResult, sheetResult] = await Promise.all([
      db.collection("products").get().then(snapshot => ({ ok: true, snapshot })).catch(error => ({ ok: false, error: error.message })),
      db.collection("orders").get().then(snapshot => ({ ok: true, snapshot })).catch(error => ({ ok: false, error: error.message })),
      db.collection("backupOutbox").get().then(snapshot => ({ ok: true, snapshot })).catch(error => ({ ok: false, error: error.message })),
      readProductsPrivate().then(products => ({ ok: true, products })).catch(error => ({ ok: false, error: error.message }))
    ]);
    const firestoreProducts = (productResult.snapshot?.docs || []).filter(doc => {
      const product = typeof doc.data === 'function' ? doc.data() : (doc || {});
      return !product.archived && !product.isDeleted;
    });
    const sheetProducts = sheetResult.ok ? sheetResult.products.filter(product => !product.isDeleted) : [];
    const activeCount = firestoreProducts.length;

    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short"
    });
    const outboxSize = outboxResult.snapshot?.size || 0;
    const ordersCount = orderResult.snapshot?.size || 0;
    const countsMatch = productResult.ok && sheetResult.ok && activeCount === sheetProducts.length;
    const status = productResult.ok && orderResult.ok && outboxResult.ok
      && sheetResult.ok && activeCount > 0 && outboxSize === 0 && countsMatch
      ? "HEALTHY"
      : "ATTENTION";
    const report = [
      `MANSI STORE WATCHDOG — ${status}`,
      formatter.format(now),
      "",
      `Active Products: ${activeCount}`,
      `Google Sheet Backup: ${sheetResult.ok ? sheetProducts.length + " items synced" : "unavailable"}`,
      `Orders Total: ${ordersCount}`,
      `Backup retry queue: ${outboxSize}`,
      "",
      !productResult.ok ? "Catalog alert: Firestore is unreachable." :
        activeCount === 0 ? "Catalog alert: No active products found." :
        countsMatch ? "Catalog: Firestore and Sheet counts verified." : "Catalog alert: Firestore and Sheet counts differ.",
      sheetResult.ok ? "Sheet backup: Connected & Healthy" : "Sheet backup: Unreachable",
      "No automatic deletion was performed."
    ].join("\n");

    const telegram = await sendTelegram(process.env.TELEGRAM_OWNER_CHAT_ID, report);
    await db.collection("watchdogReports").add({
      status,
      activeProducts: activeCount,
      sheetProducts: sheetResult.ok ? sheetProducts.length : null,
      orders: ordersCount,
      backupOutbox: outboxSize,
      firestoreReachable: productResult.ok,
      sheetReachable: sheetResult.ok,
      countsMatch,
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
