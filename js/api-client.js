(function () {
  "use strict";

  function baseUrl() {
    return String((window.STORE && STORE.apiBase) || "").replace(/\/$/, "");
  }

  async function idToken() {
    if (window.DB && typeof DB.waitForFirebase === "function") await DB.waitForFirebase();
    if (!window.fbAuth || !fbAuth.currentUser) throw new Error("Please sign in again.");
    return fbAuth.currentUser.getIdToken();
  }

  async function request(path, options) {
    const settings = options || {};
    const headers = { "Content-Type": "application/json", ...(settings.headers || {}) };
    if (settings.auth !== false) headers.Authorization = `Bearer ${await idToken()}`;
    const response = await fetch(baseUrl() + path, {
      method: settings.method || "GET",
      headers,
      body: settings.body === undefined ? undefined : JSON.stringify(settings.body)
    });
    let result = {};
    try { result = await response.json(); } catch (_) {}
    if (!response.ok || result.ok === false) throw new Error(result.error || `Request failed (HTTP ${response.status})`);
    return result;
  }

  window.StoreApi = {
    adminSession() {
      return request("/api/admin/session");
    },
    getSettings() {
      return request("/api/settings", { auth: false });
    },
    saveSettings(store, delivery) {
      return request("/api/settings", { method: "PATCH", body: { store, delivery } });
    },
    createTelegramLink() {
      return request("/api/telegram/link", { method: "POST" });
    },
    getCatalog() {
      return request("/api/products", { auth: false });
    },
    saveProduct(product) {
      return request("/api/admin/products", { method: "POST", body: { product } });
    },
    generateProductDescription(name, category, prompt) {
      return request("/api/admin/products", {
        method: "POST",
        body: { action: "generate_description", name, category, prompt }
      });
    },
    archiveProduct(id) {
      return request("/api/admin/products", { method: "DELETE", body: { id } });
    },
    uploadProductImage(productId, dataUrl) {
      return request("/api/admin/image", { method: "POST", body: { productId, dataUrl } });
    },
    backupNow() {
      return request("/api/backup/products", { method: "POST" });
    },
    backupStatus() {
      return request("/api/backup/products");
    },
    restorePreview() {
      return request("/api/backup/products", { method: "PUT", body: { preview: true } });
    },
    restoreMerge() {
      return request("/api/backup/products", { method: "PUT", body: { preview: false } });
    },
    createOrder(order) {
      return request("/api/orders", { method: "POST", body: order });
    },
    getOrders(scope) {
      return request("/api/orders" + (scope === "admin" ? "?scope=admin" : ""));
    },
    cancelOrder(id, reason) {
      return request("/api/orders", { method: "PATCH", body: { id, reason } });
    },
    updateOrderStatus(id, status) {
      return request("/api/admin/orders", { method: "PATCH", body: { id, status } });
    },
    archiveOrder(id) {
      return request("/api/admin/orders", { method: "DELETE", body: { id } });
    },
    getWatchdogReports() {
      return request("/api/admin/watchdog");
    }
  };
})();
