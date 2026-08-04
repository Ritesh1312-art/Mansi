"use strict";

const { requireAdmin } = require("../_lib/auth");
const { services } = require("../_lib/firebase");
const { send, readJson, methodNotAllowed } = require("../_lib/http");

const STATUSES = new Set(["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"]);

module.exports = async function handler(req, res) {
  if (!["PATCH", "DELETE"].includes(req.method)) return methodNotAllowed(res, ["PATCH", "DELETE"]);
  try {
    const admin = await requireAdmin(req);
    const body = await readJson(req);
    const id = String(body.id || "").trim();
    if (!id) throw new Error("Order id is required");
    const { db } = services();
    const ref = db.collection("orders").doc(id);

    if (req.method === "DELETE") {
      const snapshot = await ref.get();
      if (!snapshot.exists) return send(res, 404, { ok: false, error: "Order not found" });
      await ref.set({
        archived: true,
        archivedAt: new Date().toISOString(),
        archivedBy: admin.email || admin.uid,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      return send(res, 200, { ok: true, archived: true, id });
    }

    const status = String(body.status || "").toLowerCase();
    if (!STATUSES.has(status)) throw new Error("Invalid order status");
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Order not found");
      const order = snapshot.data() || {};
      if (order.status === "cancelled" && status !== "cancelled") {
        throw new Error("Cancelled orders cannot be reopened automatically");
      }
      if (status === "cancelled" && order.status !== "cancelled" && !order.inventoryRestored) {
        const orderItems = order.items || [];
        const productRefs = orderItems.map(item => db.collection("products").doc(String(item.productId)));
        const productSnapshots = await Promise.all(productRefs.map(productRef => transaction.get(productRef)));
        orderItems.forEach((item, index) => {
          const productRef = productRefs[index];
          const productSnapshot = productSnapshots[index];
          if (!productSnapshot.exists) return;
          const product = productSnapshot.data() || {};
          const stock = Math.max(0, Number(product.stock) || 0) + Math.max(1, Number(item.qty) || 1);
          transaction.update(productRef, {
            stock,
            inStock: stock > 0,
            sales: Math.max(0, (Number(product.sales) || 0) - Math.max(1, Number(item.qty) || 1)),
            updatedAt: new Date().toISOString()
          });
        });
        transaction.update(ref, { inventoryRestored: true });
      }
      transaction.update(ref, {
        status,
        updatedAt: new Date().toISOString(),
        updatedBy: admin.email || admin.uid
      });
    });
    return send(res, 200, { ok: true, id, status });
  } catch (error) {
    console.error("admin.orders", error.message);
    return send(res, error.statusCode || 400, { ok: false, error: error.message || "Order update failed" });
  }
};
