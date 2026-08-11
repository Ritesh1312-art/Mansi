// =============================================
// DATA MANAGEMENT — localStorage + Firebase Hybrid Sync
// =============================================

let isFirebaseActive = false;
let fbAuth = null;
let fbDb = null;
let firebaseProductsCache = null;
let firebaseInitPromise = null;

const DB = {
  // ---- DYNAMIC FIREBASE LOADER ----
  async initFirebase() {
    await this.loadFallbackCatalog();
    await this.loadRemoteSettings();
    if (STORE.firebaseConfig && STORE.firebaseConfig.apiKey) {
      try {
        await this.loadSDKs();
        if (!firebase.apps.length) {
          firebase.initializeApp(STORE.firebaseConfig);
        }
        fbAuth = firebase.auth();
        fbDb = firebase.firestore();
        window.fbAuth = fbAuth;
        window.fbDb = fbDb;
        isFirebaseActive = true;
        console.log("🔥 Firebase Hybrid Sync is active!");
        this.setupRealtimeSync();
        return true;
      } catch (e) {
        console.error("❌ Failed to initialize Firebase:", e);
      }
    }
    return false;
  },

  waitForFirebase() {
    return firebaseInitPromise || Promise.resolve(false);
  },

  async loadRemoteSettings() {
    try {
      const response = await fetch((STORE.apiBase || "") + "/api/settings", { cache: "no-cache" });
      if (!response.ok) return false;
      const result = await response.json();
      if (result.ok) {
        Object.assign(STORE, result.store || {});
        Object.keys(result.delivery || {}).forEach(zone => {
          DELIVERY[zone] = { ...(DELIVERY[zone] || {}), ...(result.delivery[zone] || {}) };
        });
        window.dispatchEvent(new Event("settingsSynced"));
        return true;
      }
    } catch (_) {}
    return false;
  },

  async waitForAuthState() {
    await this.waitForFirebase();
    if (!fbAuth) return null;
    return new Promise(resolve => {
      const unsubscribe = fbAuth.onAuthStateChanged(user => {
        unsubscribe();
        resolve(user || null);
      }, () => resolve(null));
    });
  },

  async loadFallbackCatalog() {
    // Emergency read-only fallback — loads static data/catalog.json only.
    // Does NOT merge any browser localStorage data.
    // The authoritative API fetch (fetchCatalogFromApi) always takes precedence.
    try {
      const dataScript = Array.from(document.scripts).find(script => /\/js\/data\.js(?:\?|$)/.test(script.src));
      const siteRoot = dataScript ? new URL("../", dataScript.src) : new URL("./", document.baseURI);
      const response = await fetch(new URL("data/catalog.json", siteRoot), { cache: "no-cache" });
      if (!response.ok) throw new Error("Fallback catalog HTTP " + response.status);
      const payload = await response.json();
      const seedProducts = (Array.isArray(payload.products) ? payload.products : []).map(product => ({
        ...product,
        image: product.image && !/^(?:https?:|data:|blob:)/i.test(product.image)
          ? new URL(product.image, siteRoot).href
          : product.image
      })).filter(p => p && p.id && !p.archived && !p.isDeleted);

      if (seedProducts.length > 0) {
        firebaseProductsCache = seedProducts;
        this.saveLocalProductCache(seedProducts);
        window.dispatchEvent(new Event("productsSynced"));
        window.dispatchEvent(new CustomEvent("catalogStatus", { detail: { source: "static-catalog-fallback", count: seedProducts.length } }));
      }
    } catch (error) {
      console.warn("Static catalog fallback could not load:", error.message);
    }
  },


  async loadSDKs() {
    if (typeof firebase !== "undefined" && firebase.auth && firebase.firestore) return;
    const dataScript = Array.from(document.scripts).find(script => /\/js\/data\.js(?:\?|$)/.test(script.src));
    const dataUrl = dataScript ? dataScript.src : new URL("js/data.js", document.baseURI).href;
    const scripts = [
      new URL("vendor/firebase-app-compat.js", dataUrl).href,
      new URL("vendor/firebase-auth-compat.js", dataUrl).href,
      new URL("vendor/firebase-firestore-compat.js", dataUrl).href
    ];

    // Compat Auth and Firestore depend on firebase-app. Load sequentially so a
    // slow connection can never execute a dependent SDK before its base SDK.
    for (const src of scripts) {
      await new Promise((resolve, reject) => {
        const existing = Array.from(document.scripts).find(script => script.src === src);
        if (existing?.dataset.loaded === "true") return resolve();
        const script = existing || document.createElement("script");
        const timeout = setTimeout(() => reject(new Error("Timed out loading Firebase SDK: " + src)), 15000);
        script.onload = () => {
          clearTimeout(timeout);
          script.dataset.loaded = "true";
          resolve();
        };
        script.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Failed to load Firebase SDK: " + src));
        };
        if (!existing) {
          script.src = src;
          script.defer = true;
          document.head.appendChild(script);
        }
      });
    }
    if (typeof firebase === "undefined" || !firebase.auth || !firebase.firestore) {
      throw new Error("Firebase SDK loaded without required Auth/Firestore modules");
    }
  },

  async fetchCatalogFromApi() {
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error("API HTTP " + res.status);
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.products) && data.products.length > 0) {
        const active = data.products.filter(p => p && p.id && !p.archived && !p.isDeleted);
        firebaseProductsCache = active;
        
        // Single versioned disposable cache
        const versionedCache = {
          schemaVersion: 1,
          catalogRevision: "2026-08-11",
          fetchedAt: new Date().toISOString(),
          products: this.lightweightProducts(active)
        };
        try { localStorage.setItem("mansi_catalog_cache_v1", JSON.stringify(versionedCache)); } catch(e){}
        this.saveLocalProductCache(active);

        window.dispatchEvent(new Event("productsSynced"));
        window.dispatchEvent(new CustomEvent("catalogStatus", { detail: { source: "api_authoritative", count: active.length } }));
        return active;
      }
    } catch (e) {
      console.warn("[DB] API catalog fetch skipped or offline:", e.message);
    }
    return null;
  },

  setupRealtimeSync() {
    // Authoritative catalog fetch via server API without throwing unauthenticated Firestore snapshot permission errors
    this.fetchCatalogFromApi().catch(() => {});
  },

  getCustomUserProducts() {
    try {
      const raw = localStorage.getItem("custom_user_products");
      return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  },
  saveCustomUserProduct(product) {
    if (!product || !product.id || this.isTombstoned(product.id)) return;
    const custom = this.getCustomUserProducts();
    const idx = custom.findIndex(p => p.id === product.id);
    if (idx !== -1) custom[idx] = product;
    else custom.unshift(product);
    try {
      localStorage.setItem("custom_user_products", JSON.stringify(custom));
    } catch (e) {
      console.warn("Could not write to custom_user_products:", e);
    }
  },
  removeCustomUserProduct(id) {
    if (!id) return;
    const custom = this.getCustomUserProducts().filter(p => p.id !== id);
    try {
      localStorage.setItem("custom_user_products", JSON.stringify(custom));
    } catch (e) {}
  },
  recordDeletedTombstone(id) {
    if (!id) return;
    try {
      const raw = localStorage.getItem("deleted_product_ids");
      const list = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
      if (!list.includes(id)) list.push(id);
      localStorage.setItem("deleted_product_ids", JSON.stringify(list));
    } catch (e) {}
  },
  isTombstoned(id) {
    if (!id) return false;
    try {
      const raw = localStorage.getItem("deleted_product_ids");
      const list = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
      return list.includes(id);
    } catch (e) {
      return false;
    }
  },

  // ---- PRODUCTS ----
  getProducts() {
    // 1. Primary Authoritative Cache (Server API / Firestore)
    if (Array.isArray(firebaseProductsCache) && firebaseProductsCache.length > 0) {
      return firebaseProductsCache.filter(p => p && p.id && !p.archived && !p.isDeleted);
    }

    // 2. Versioned Disposable Cache
    try {
      const vCacheRaw = localStorage.getItem("mansi_catalog_cache_v1");
      if (vCacheRaw) {
        const vCache = JSON.parse(vCacheRaw);
        if (vCache && Array.isArray(vCache.products) && vCache.products.length > 0) {
          const valid = vCache.products.filter(p => p && p.id && !p.archived && !p.isDeleted && !this.isTombstoned(p.id));
          if (valid.length > 0) return valid;
        }
      }
    } catch (e) {}

    // 3. Fallback Catalog
    let rawStr = localStorage.getItem("products");
    let raw = [];
    try { raw = JSON.parse(rawStr || "[]"); } catch(e){}
    if (!Array.isArray(raw)) raw = [];

    const active = raw.filter(p => p && p.id && !p.archived && !p.isDeleted && !this.isTombstoned(p.id));
    return active.sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  },
  saveLocalProductCache(products) {
    const lightweight = this.lightweightProducts(products);

    try {
      const previous = localStorage.getItem("products");
      if (previous && previous !== "[]") localStorage.setItem("products_last_good", previous);
      localStorage.setItem("products", JSON.stringify(lightweight));
    } catch (e) {
      console.warn("Storage quota fallback active:", e);
      try {
        localStorage.setItem("products", JSON.stringify(lightweight));
      } catch (err2) {
        console.error("Storage save notice:", err2);
      }
    }
  },
  saveProducts(products) {
    firebaseProductsCache = products;
    this.saveLocalProductCache(products);
  },
  lightweightProducts(products) {
    return products.map(product => {
      const copy = { ...product };
      if (/^(?:data:|blob:)/i.test(String(copy.image || ""))) {
        copy.image = String(copy.imageBackupUrl || "");
      }
      return copy;
    });
  },
  cachePersistedProduct(product) {
    if (!product || !product.id) return null;
    this.saveCustomUserProduct(product);
    const products = this.getProducts().filter(existing => existing.id !== product.id);
    products.unshift(product);
    this.saveProducts(products);
    return product;
  },
  cacheArchivedProduct(id) {
    if (!id) return null;
    const product = this.getProductById(id);
    this.removeCustomUserProduct(id);
    this.recordDeletedTombstone(id);
    this.saveProducts(this.getProducts().filter(existing => existing.id !== id));
    return { ...(product || { id }), archived: true, isDeleted: true };
  },
  addProduct(product) {
    // Always generate a fresh unique ID when adding
    if (!product.id) {
      product.id = "p_" + Date.now();
    }
    product.createdAt = product.createdAt || new Date().toISOString();
    product.rating = Math.max(0, Math.min(5, Number(product.rating) || 0));
    product.reviews = Math.max(0, Number(product.reviews) || 0);
    product.sales = product.sales || 0;

    this.cachePersistedProduct(product);

    // Auto persist to remote database in background
    this.persistProduct(product).catch(err => console.warn("Background persist product warning:", err));

    return product;
  },
  updateProduct(id, updates) {
    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx !== -1) {
      const updated = { ...products[idx], ...updates, updatedAt: new Date().toISOString() };
      products[idx] = updated;

      this.cachePersistedProduct(updated);

      // Auto persist to remote database in background
      this.persistProduct(updated).catch(err => console.warn("Background persist product warning:", err));

      return updated;
    }
    return null;
  },
  deleteProduct(id) {
    const product = this.getProductById(id);
    if (!id) return null;

    this.cacheArchivedProduct(id);

    // Auto persist archive to remote database in background
    this.persistArchive(id).catch(err => console.warn("Background archive product warning:", err));

    return { ...(product || { id }), archived: true, isDeleted: true, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  },
  async persistProduct(product) {
    // All product writes must go through the server Admin API.
    // Never write directly to Firestore from the browser client — no auth token is available here.
    if (window.StoreApi && STORE.apiBase) {
      try {
        const result = await StoreApi.saveProduct(product);
        return result.product;
      } catch(e) {
        console.warn("StoreApi persist warning:", e.message);
      }
    }
    return product;
  },
  async persistArchive(id) {
    if (window.StoreApi && STORE.apiBase) {
      try { return await StoreApi.archiveProduct(id); } catch(e) {}
    }
    return { id, archived: true };
  },

  getProductById(id) {
    if (!id && id !== 0) return null;
    const cleanId = decodeURIComponent(String(id)).trim();
    const products = this.getProducts();
    if (!products || products.length === 0) return null;

    const norm = str => String(str || "").toLowerCase().replace(/^p_/, '').replace(/[^a-z0-9]/g, "");
    const targetNorm = norm(cleanId);

    // 1. Direct ID match
    let found = products.find(p => p && p.id && String(p.id).trim() === cleanId);
    if (found) return found;

    // 2. Case-insensitive ID match
    found = products.find(p => p && p.id && String(p.id).trim().toLowerCase() === cleanId.toLowerCase());
    if (found) return found;

    // 3. Normalized ID match
    found = products.find(p => p && p.id && norm(p.id) === targetNorm);
    if (found) return found;

    // 4. Normalized Name match
    found = products.find(p => p && p.name && norm(p.name) === targetNorm);
    if (found) return found;

    // 5. Fuzzy Substring match on name or ID
    found = products.find(p => {
      if (!p) return false;
      const pNameNorm = norm(p.name);
      const pIdNorm = norm(p.id);
      return (
        (pNameNorm && targetNorm && (pNameNorm.includes(targetNorm) || targetNorm.includes(pNameNorm))) ||
        (pIdNorm && targetNorm && (pIdNorm.includes(targetNorm) || targetNorm.includes(pIdNorm)))
      );
    });
    if (found) return found;

    // 6. Index fallback if cleanId is a numeric index
    if (!isNaN(cleanId) && products[parseInt(cleanId)]) {
      return products[parseInt(cleanId)];
    }

    return null;
  },
  async fetchProductById(id) {
    if (!id && id !== 0) return null;
    const cleanId = decodeURIComponent(String(id)).trim();
    const norm = str => String(str || "").toLowerCase().replace(/^p_/, '').replace(/[^a-z0-9]/g, "");
    const targetNorm = norm(cleanId);
    
    // 1. Local storage lookup
    let product = this.getProductById(cleanId);
    if (product) return product;

    // 2. Direct Firebase lookup if active
    if (isFirebaseActive) {
      try {
        const doc = await fbDb.collection("products").doc(cleanId).get();
        if (doc.exists) {
          const pData = doc.data() || {};
          pData.id = pData.id || doc.id;
          const products = this.getProducts();
          const idx = products.findIndex(p => p.id === pData.id);
          if (idx !== -1) products[idx] = pData;
          else products.unshift(pData);
          this.saveProducts(products);
          return pData;
        }

        const snap = await fbDb.collection("products").get();
        let match = null;
        snap.forEach(d => {
          const data = d.data() || {};
          data.id = data.id || d.id;
          const pNameNorm = norm(data.name);
          const pIdNorm = norm(data.id);

          if (
            String(data.id).trim() === cleanId || 
            pIdNorm === targetNorm ||
            pNameNorm === targetNorm ||
            (pNameNorm && targetNorm && (pNameNorm.includes(targetNorm) || targetNorm.includes(pNameNorm)))
          ) {
            match = data;
          }
        });
        if (match) {
          const products = this.getProducts();
          if (!products.some(p => p.id === match.id)) {
            products.unshift(match);
            this.saveProducts(products);
          }
          return match;
        }
      } catch (e) {
        console.error("Firebase product fetch error:", e);
      }
    }

    return null;
  },

  // ---- USERS ----
  getUsers() {
    try {
      const users = JSON.parse(localStorage.getItem("users") || "[]");
      return Array.isArray(users) ? users : [];
    } catch (_) {
      return [];
    }
  },
  saveUsers(users) {
    localStorage.setItem("users", JSON.stringify(users));
  },
  async registerUser(data) {
    await this.waitForFirebase();
    if (isFirebaseActive) {
      try {
        // 1. Create in Firebase Auth
        const cred = await fbAuth.createUserWithEmailAndPassword(data.email, data.password);
        cred.user.sendEmailVerification().catch(error => console.warn("Verification email could not be sent:", error.message));
        const user = {
          id: cred.user.uid,
          name: data.name,
          email: data.email,
          phone: data.phone,
          createdAt: new Date().toISOString()
        };
        // 2. Save in Firestore
        await fbDb.collection("users").doc(user.id).set(user);
        return { user };
      } catch (e) {
        return { error: e.message };
      }
    }
    return { error: "Secure sign-up is temporarily unavailable. Please try again." };
  },
  async loginUser(email, password) {
    await this.waitForFirebase();
    if (isFirebaseActive) {
      try {
        const cred = await fbAuth.signInWithEmailAndPassword(email, password);
        const doc = await fbDb.collection("users").doc(cred.user.uid).get();
        if (doc.exists) {
          return { user: doc.data() };
        } else {
          return { error: "User profile details not found in Firestore!" };
        }
      } catch (e) {
        return { error: e.message };
      }
    }
    return { error: "Secure login is temporarily unavailable. Please try again." };
  },
  getUserById(id) {
    if (!id) return null;
    const users = this.getUsers();
    return users.find(u => u.id === id || u.email === id) || null;
  },
  updateUserProfile(userId, updates) {
    const session = this.getSession();
    const users = this.getUsers();
    
    // Flexible user lookup: by id, or by session id, or by session email
    let idx = users.findIndex(u => 
      (userId && u.id === userId) ||
      (session && session.id && u.id === session.id) ||
      (session && session.email && u.email === session.email) ||
      (updates.email && u.email === updates.email)
    );

    let updatedUser = null;
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...updates, updatedAt: new Date().toISOString() };
      updatedUser = users[idx];
    } else {
      updatedUser = {
        id: userId || (session ? session.id : "u_" + Date.now()),
        name: updates.name || (session ? session.name : ""),
        email: updates.email || (session ? session.email : ""),
        phone: updates.phone || (session ? session.phone : ""),
        ...updates,
        createdAt: new Date().toISOString()
      };
      users.unshift(updatedUser);
    }
    this.saveUsers(users);

    // Sync session in localStorage
    if (session) {
      const newSession = { ...session, ...updatedUser };
      this.setSession(newSession);
    }

    if (isFirebaseActive && updatedUser.id) {
      try {
        fbDb.collection("users").doc(updatedUser.id).set(updatedUser, { merge: true });
      } catch(e) {}
    }
    return updatedUser;
  },
  updateUserAddress(userId, address) {
    const session = this.getSession();
    const targetId = userId || (session ? session.id : null);
    const user = (targetId ? this.getUserById(targetId) : null) || session || {};
    
    let savedAddresses = Array.isArray(user.savedAddresses) ? [...user.savedAddresses] : [];
    
    // Add to savedAddresses if not duplicate
    const isDup = savedAddresses.some(a => 
      a && a.house === address.house && a.street === address.street && a.pincode === address.pincode
    );

    if (!isDup) {
      savedAddresses.unshift({
        id: "addr_" + Date.now(),
        ...address,
        isDefault: savedAddresses.length === 0
      });
    }

    return this.updateUserProfile(targetId, { address, savedAddresses });
  },
  async updateUserPassword(userId, oldPassword, newPassword) {
    const session = this.getSession();
    const userInfo = session || {};
    const val = validatePassword(newPassword, userInfo);
    if (!val.valid) return { error: val.error };
    await this.waitForFirebase();
    if (!fbAuth || !fbAuth.currentUser || !session || !session.email) {
      return { error: "Please log in again before changing your password." };
    }
    try {
      const credential = firebase.auth.EmailAuthProvider.credential(session.email, oldPassword);
      await fbAuth.currentUser.reauthenticateWithCredential(credential);
      await fbAuth.currentUser.updatePassword(newPassword);
      return { success: true };
    } catch (error) {
      return { error: error.message || "Password update failed." };
    }
  },
  async sendPasswordReset(email) {
    if (isFirebaseActive) {
      await fbAuth.sendPasswordResetEmail(email);
      return { success: true };
    } else {
      return { success: false, error: "Firebase configuration is not active. Please configure Firebase in settings to send real reset emails." };
    }
  },

  // ---- SESSION ----
  setSession(user) {
    localStorage.setItem("session", JSON.stringify({ id: user.id, name: user.name, email: user.email, phone: user.phone || "" }));
  },
  getSession() {
    try {
      const session = JSON.parse(localStorage.getItem("session") || "null");
      return session && typeof session === "object" ? session : null;
    } catch (_) {
      return null;
    }
  },
  clearSession() {
    localStorage.removeItem("session");
  },

  // ---- ORDERS ----
  getOrders() {
    try {
      const orders = JSON.parse(localStorage.getItem("orders") || "[]");
      return Array.isArray(orders) ? orders : [];
    } catch (_) {
      return [];
    }
  },
  saveOrders(orders) {
    localStorage.setItem("orders", JSON.stringify(orders));
  },
  addOrder(order) {
    const orders = this.getOrders();
    order.id = order.id || "ORD" + Date.now();
    order.createdAt = order.createdAt || new Date().toISOString();
    order.status = order.status || "pending";

    // Update product stock and sales
    order.items.forEach(item => {
      const product = this.getProductById(item.productId);
      if (product) {
        const newStock = Math.max(0, (product.stock || 0) - item.qty);
        this.updateProduct(item.productId, { 
          stock: newStock,
          sales: (product.sales || 0) + item.qty 
        });
      }
    });

    orders.unshift(order);
    this.saveOrders(orders);

    if (isFirebaseActive) {
      fbDb.collection("orders").doc(order.id).set(order);
    }

    return order;
  },
  updateOrderStatus(orderId, status) {
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) {
      orders[idx].status = status;
      orders[idx].updatedAt = new Date().toISOString();
      this.saveOrders(orders);

      if (isFirebaseActive) {
        fbDb.collection("orders").doc(orderId).update({ status, updatedAt: new Date().toISOString() });
      }
    }
  },
  cancelOrder(orderId, reason = "Cancelled by customer") {
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) {
      orders[idx].status = "cancelled";
      orders[idx].cancelReason = reason;
      orders[idx].cancelledAt = new Date().toISOString();
      orders[idx].updatedAt = new Date().toISOString();
      this.saveOrders(orders);

      if (isFirebaseActive) {
        fbDb.collection("orders").doc(orderId).update({
          status: "cancelled",
          cancelReason: reason,
          cancelledAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      return orders[idx];
    }
    return null;
  },
  deleteOrder(id) {
    const orders = this.getOrders();
    const order = orders.find(o => o.id === id);
    if (!order) return false;
    order.archived = true;
    order.archivedAt = new Date().toISOString();
    order.updatedAt = order.archivedAt;
    this.saveOrders(orders);
    return true;
  },
  getOrdersByUser(userIdOrUser) {
    const orders = this.getOrders();
    if (!userIdOrUser) return [];

    let targetId = typeof userIdOrUser === "object" ? userIdOrUser.id : userIdOrUser;
    let targetEmail = typeof userIdOrUser === "object" ? userIdOrUser.email : "";
    let targetPhone = typeof userIdOrUser === "object" ? userIdOrUser.phone : "";

    const userOrders = orders.filter(o => {
      if (targetId && o.userId === targetId) return true;
      if (targetEmail && (o.userId === targetEmail || o.customerEmail === targetEmail)) return true;
      if (targetPhone && (o.phone === targetPhone || o.userId === targetPhone)) return true;
      return false;
    });

    return userOrders;
  },

  async createOrder(order) {
    if (!window.StoreApi) throw new Error("Secure order service is unavailable");
    const result = await StoreApi.createOrder(order);
    const orders = this.getOrders().filter(existing => existing.id !== result.order.id);
    orders.unshift(result.order);
    this.saveOrders(orders);
    return result;
  },

  // ---- REVENUE ----
  getRevenue() {
    const orders = this.getOrders();
    const confirmed = orders.filter(o => ["confirmed","shipped","delivered"].includes(o.status));
    const total = confirmed.reduce((sum, o) => sum + o.grandTotal, 0);
    const today = new Date().toDateString();
    const todayRev = confirmed
      .filter(o => new Date(o.createdAt).toDateString() === today)
      .reduce((sum, o) => sum + o.grandTotal, 0);
    return {
      total,
      todayRevenue: todayRev,
      totalOrders: orders.length,
      pendingOrders: orders.filter(o => o.status === "pending").length,
      deliveredOrders: orders.filter(o => o.status === "delivered").length,
    };
  },

  // ---- SEED SAMPLE DATA ----
  seedSampleProducts() {
    // Only real products added by Admin via Admin Panel or Firebase real-time database are used.
    // Zero hardcoded sample products injected.
  }
};

// Start Firebase sync if configured
firebaseInitPromise = DB.initFirebase();

// Global Strict Password Validator Function (Requirement 3)
function validatePassword(password, userInfo = {}) {
  if (!password) {
    return { valid: false, error: "Password is required." };
  }

  // 1. Length: 8 to 12 characters
  if (password.length < 8 || password.length > 12) {
    return { valid: false, error: "Password must be between 8 and 12 characters long." };
  }

  // 2. Prohibited Item: No Spaces
  if (/\s/.test(password)) {
    return { valid: false, error: "Password cannot contain spaces." };
  }

  // 3. Uppercase (A-Z)
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one uppercase letter (A-Z)." };
  }

  // 4. Lowercase (a-z)
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one lowercase letter (a-z)." };
  }

  // 5. Numbers (0-9)
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: "Password must contain at least one digit (0-9)." };
  }

  // 6. Special Characters (!@#$%^&* etc.)
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, error: "Password must contain at least one special character (e.g. !, @, #, $, %, ^, *)." };
  }

  const lower = password.toLowerCase();

  // 7. Prohibited Item: No Sequences (1234, abcd, qwer, etc.)
  const sequences = ["1234", "2345", "3456", "4567", "5678", "6789", "abcd", "bcde", "cdef", "defg", "qwer", "asdf", "zxcv"];
  for (const seq of sequences) {
    if (lower.includes(seq)) {
      return { valid: false, error: "Password cannot contain predictable sequences (e.g. '1234' or 'abcd')." };
    }
  }

  // 8. Prohibited Item: No Common Words (password, qwerty, admin, welcome)
  const commonWords = ["password", "qwerty", "admin", "welcome", "123456"];
  for (const word of commonWords) {
    if (lower.includes(word)) {
      return { valid: false, error: `Password cannot contain common words like '${word}'.` };
    }
  }

  // 9. Prohibited Item: No Personal Info (name, email prefix)
  if (userInfo.name && userInfo.name.trim().length >= 3) {
    const nameParts = userInfo.name.trim().toLowerCase().split(/\s+/);
    for (const part of nameParts) {
      if (part.length >= 3 && lower.includes(part)) {
        return { valid: false, error: "Password cannot contain parts of your name." };
      }
    }
  }
  if (userInfo.email) {
    const emailPrefix = userInfo.email.split('@')[0].toLowerCase();
    if (emailPrefix.length >= 3 && lower.includes(emailPrefix)) {
      return { valid: false, error: "Password cannot contain parts of your email address." };
    }
  }

  return { valid: true, error: null };
}
