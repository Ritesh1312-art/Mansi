"use strict";

const { requireUser, requireAdmin } = require("./_lib/auth");
const { services } = require("./_lib/firebase");
const { notifyOrder } = require("./_lib/notifications");
const { send, readJson, methodNotAllowed } = require("./_lib/http");

function deliveryFor(pincode, paymentMode, configuredFees = {}) {
  const pin = String(pincode || "").trim();
  if (!/^\d{6}$/.test(pin)) throw new Error("Valid 6-digit pincode is required");
  let zone = "restOfIndia";
  if (["492001","492002","492003","492004","492005","492006","492007","492008","492009","492010","492012","492013","492015","492099","492101","492109"].includes(pin)) zone = "sameCity";
  else if (pin.startsWith("49")) zone = "sameState";
  else if (["45","46","47","48","75","76","77","82","83","20","21","22","23","24","25","26","27","28","50","51","52","53"].some(prefix => pin.startsWith(prefix))) zone = "nearbyStates";
  const defaults = {
    sameCity: { prepaid: 50, cod: 95 },
    sameState: { prepaid: 80, cod: 125 },
    nearbyStates: { prepaid: 120, cod: 165 },
    restOfIndia: { prepaid: 150, cod: 195 }
  };
  const fees = Object.fromEntries(Object.entries(defaults).map(([key, value]) => {
    const configured = configuredFees[key] || {};
    const prepaid = Number(configured.prepaid);
    const cod = Number(configured.cod);
    return [key, {
      prepaid: Number.isFinite(prepaid) && prepaid >= 0 ? prepaid : value.prepaid,
      cod: Number.isFinite(cod) && cod >= 0 ? cod : value.cod
    }];
  }));
  const mode = paymentMode === "cod" ? "cod" : "prepaid";
  return { zone, charge: fees[zone][mode] };
}

function cleanAddress(address) {
  const result = {
    house: String(address?.house || "").trim().slice(0, 160),
    street: String(address?.street || "").trim().slice(0, 240),
    city: String(address?.city || "").trim().slice(0, 100),
    state: String(address?.state || "").trim().slice(0, 100),
    pincode: String(address?.pincode || "").trim()
  };
  if (!result.street || !result.city || !result.state) throw new Error("Complete delivery address is required");
  return result;
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST", "PATCH"].includes(req.method)) return methodNotAllowed(res, ["GET", "POST", "PATCH"]);
  try {
    if (req.method === "GET") {
      const adminScope = String(req.query?.scope || "") === "admin";
      const user = adminScope ? await requireAdmin(req) : await requireUser(req);
      const { db } = services();
      const snapshot = adminScope
        ? await db.collection("orders").orderBy("createdAt", "desc").limit(500).get()
        : await db.collection("orders").where("userId", "==", user.uid).limit(100).get();
      const orders = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.data().id || doc.id }))
        .filter(order => !order.archived)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      return send(res, 200, { ok: true, count: orders.length, orders });
    }
    if (req.method === "PATCH") {
      const user = await requireUser(req);
      const body = await readJson(req);
      const id = String(body.id || "").trim();
      const reason = String(body.reason || "Cancelled by customer").trim().slice(0, 300);
      if (!id) throw new Error("Order id is required");
      const { db } = services();
      const ref = db.collection("orders").doc(id);
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error("Order not found");
        const order = snapshot.data() || {};
        if (order.userId !== user.uid) {
          const denied = new Error("You cannot modify this order");
          denied.statusCode = 403;
          throw denied;
        }
        if (!["pending", "confirmed"].includes(order.status)) throw new Error("This order can no longer be cancelled online");
        if (!order.inventoryRestored) {
          const orderItems = order.items || [];
          const productRefs = orderItems.map(item => db.collection("products").doc(String(item.productId)));
          const productSnapshots = await Promise.all(productRefs.map(productRef => transaction.get(productRef)));
          orderItems.forEach((item, index) => {
            const productRef = productRefs[index];
            const productSnapshot = productSnapshots[index];
            if (!productSnapshot.exists) return;
            const product = productSnapshot.data() || {};
            const qty = Math.max(1, Number(item.qty) || 1);
            const stock = Math.max(0, Number(product.stock) || 0) + qty;
            transaction.update(productRef, {
              stock,
              inStock: true,
              sales: Math.max(0, (Number(product.sales) || 0) - qty),
              updatedAt: new Date().toISOString()
            });
          });
        }
        transaction.update(ref, {
          status: "cancelled",
          cancelReason: reason,
          cancelledAt: new Date().toISOString(),
          inventoryRestored: true,
          updatedAt: new Date().toISOString()
        });
      });
      return send(res, 200, { ok: true, id, status: "cancelled" });
    }
    const user = await requireUser(req);
    const body = await readJson(req);
    const paymentMode = String(body.paymentMode || "").toLowerCase();
    if (!["cod", "upi"].includes(paymentMode)) {
      return send(res, 503, { ok: false, error: "Razorpay remains test-only and disabled until server-side payment verification is configured. Please use UPI or COD." });
    }
    const requested = Array.isArray(body.items) ? body.items : [];
    if (!requested.length || requested.length > 50) throw new Error("Cart is empty or invalid");
    const address = cleanAddress(body.address);
    const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
    if (!/^\d{10}$/.test(phone)) throw new Error("Valid 10-digit phone number is required");
    const customerName = String(body.customerName || "").trim().slice(0, 120);
    if (!customerName) throw new Error("Customer name is required");

    const { db } = services();
    const orderId = `ORD${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const userRef = db.collection("users").doc(user.uid);
    const orderRef = db.collection("orders").doc(orderId);
    const settingsSnapshot = await db.collection("settings").doc("public").get();
    const configuredDelivery = settingsSnapshot.exists ? settingsSnapshot.data()?.delivery || {} : {};
    const delivery = deliveryFor(address.pincode, paymentMode, configuredDelivery);
    let order;

    await db.runTransaction(async transaction => {
      const productIds = requested.map(item => String(item.productId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 150));
      if (productIds.some(id => !id)) throw new Error("Cart contains an invalid product");
      if (new Set(productIds).size !== productIds.length) throw new Error("Cart contains duplicate product rows");
      const productRefs = productIds.map(id => db.collection("products").doc(id));
      const [profileSnapshot, ...snapshots] = await Promise.all([
        transaction.get(userRef),
        ...productRefs.map(ref => transaction.get(ref))
      ]);
      const items = snapshots.map((snapshot, index) => {
        if (!snapshot.exists) throw new Error("A product in your cart is no longer available");
        const product = snapshot.data() || {};
        if (product.archived || product.isDeleted) throw new Error(`${product.name || "Product"} is not available`);
        const qty = Math.max(1, Math.min(20, Number(requested[index].qty) || 1));
        const stock = Math.max(0, Number(product.stock) || 0);
        if (qty > stock) throw new Error(`Only ${stock} unit(s) of ${product.name} are available`);
        const price = Number(product.price) || 0;
        if (!(price > 0)) throw new Error("A product has invalid pricing");
        return { productId: snapshot.id, name: String(product.name || ""), image: String(product.image || ""), price, qty, lineTotal: price * qty, nextStock: stock - qty, nextSales: (Number(product.sales) || 0) + qty };
      });
      const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
      const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
      items.forEach((item, index) => transaction.update(productRefs[index], {
        stock: item.nextStock,
        inStock: item.nextStock > 0,
        sales: item.nextSales,
        updatedAt: new Date().toISOString()
      }));
      order = {
        id: orderId,
        userId: user.uid,
        customerEmail: user.email || profile.email || "",
        customerName,
        phone,
        address,
        items: items.map(({ nextStock, nextSales, ...item }) => item),
        subtotal,
        deliveryCharge: delivery.charge,
        grandTotal: subtotal + delivery.charge,
        deliveryZone: delivery.zone,
        paymentMode,
        paymentStatus: paymentMode === "cod" ? "pay_on_delivery" : "verification_pending",
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      transaction.create(orderRef, order);
      transaction.set(userRef, { name: customerName, phone, email: user.email || profile.email || "", address, updatedAt: new Date().toISOString() }, { merge: true });
    });

    const profile = await userRef.get();
    const customerTelegramChatId = profile.exists ? profile.data().telegramChatId : "";
    const notifications = await notifyOrder(order, customerTelegramChatId);
    const notificationRetryPending = Object.values(notifications).some(result => result.sent !== true && !String(result.reason || "").startsWith("not-configured"));
    await orderRef.set({ notifications, notificationRetryPending, notificationUpdatedAt: new Date().toISOString() }, { merge: true });
    return send(res, 201, { ok: true, order, notifications });
  } catch (error) {
    console.error("orders.create", error.message);
    return send(res, error.statusCode || 400, { ok: false, error: error.message || "Order could not be placed" });
  }
};
