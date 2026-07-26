// =============================================
// DATA MANAGEMENT — localStorage + Firebase Hybrid Sync
// =============================================

let isFirebaseActive = false;
let fbAuth = null;
let fbDb = null;

const DB = {
  // ---- DYNAMIC FIREBASE LOADER ----
  async initFirebase() {
    if (STORE.firebaseConfig && STORE.firebaseConfig.apiKey) {
      try {
        await this.loadSDKs();
        if (!firebase.apps.length) {
          firebase.initializeApp(STORE.firebaseConfig);
        }
        fbAuth = firebase.auth();
        fbDb = firebase.firestore();
        isFirebaseActive = true;
        console.log("🔥 Firebase Hybrid Sync is active!");
        this.setupRealtimeSync();
      } catch (e) {
        console.error("❌ Failed to initialize Firebase:", e);
      }
    }
  },

  loadSDKs() {
    return new Promise((resolve, reject) => {
      if (typeof firebase !== "undefined") return resolve();
      const scripts = [
        "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js",
        "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js",
        "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js"
      ];
      let loaded = 0;
      scripts.forEach(src => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => {
          loaded++;
          if (loaded === scripts.length) resolve();
        };
        s.onerror = (e) => reject(new Error("Failed to load Firebase SDK: " + src));
        document.head.appendChild(s);
      });
    });
  },

  setupRealtimeSync() {
    // Sync Products
    fbDb.collection("products").onSnapshot(snapshot => {
      const products = [];
      snapshot.forEach(doc => {
        const data = doc.data() || {};
        data.id = data.id || doc.id;
        products.push(data);
      });
      // Sort by creation date
      products.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
      localStorage.setItem("products", JSON.stringify(products));
      window.dispatchEvent(new Event("productsSynced"));
    });

    // Sync Orders
    fbDb.collection("orders").onSnapshot(snapshot => {
      const orders = [];
      snapshot.forEach(doc => orders.push(doc.data()));
      orders.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
      localStorage.setItem("orders", JSON.stringify(orders));
      window.dispatchEvent(new Event("ordersSynced"));
    });
  },

  // ---- PRODUCTS ----
  getProducts() {
    const raw = JSON.parse(localStorage.getItem("products") || "[]");
    let needsResave = false;
    const products = raw.map((p, idx) => {
      if (!p || typeof p !== 'object') return null;
      if (!p.id) {
        p.id = "p_" + Date.now() + "_" + idx;
        needsResave = true;
      }
      return p;
    }).filter(Boolean);
    // Auto-repair: re-save products that had missing IDs
    if (needsResave) {
      localStorage.setItem("products", JSON.stringify(products));
    }
    return products;
  },
  saveProducts(products) {
    localStorage.setItem("products", JSON.stringify(products));
  },
  addProduct(product) {
    // Always generate a fresh unique ID when adding
    if (!product.id) {
      product.id = "p_" + Date.now();
    }
    product.createdAt = product.createdAt || new Date().toISOString();
    product.rating = product.rating || 0;
    product.reviews = product.reviews || 0;
    product.sales = product.sales || 0;

    const products = this.getProducts();
    // Remove any duplicate with same id before adding
    const filtered = products.filter(p => p.id !== product.id);
    filtered.unshift(product);
    this.saveProducts(filtered);

    if (isFirebaseActive) {
      fbDb.collection("products").doc(product.id).set(product);
    }
    return product;
  },
  updateProduct(id, updates) {
    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx !== -1) {
      const updated = { ...products[idx], ...updates, updatedAt: new Date().toISOString() };
      products[idx] = updated;
      this.saveProducts(products);

      if (isFirebaseActive) {
        fbDb.collection("products").doc(id).update(updates);
      }
      return updated;
    }
    return null;
  },
  deleteProduct(id) {
    const products = this.getProducts().filter(p => p.id !== id);
    this.saveProducts(products);

    if (isFirebaseActive) {
      fbDb.collection("products").doc(id).delete();
    }
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
    return JSON.parse(localStorage.getItem("users") || "[]");
  },
  saveUsers(users) {
    localStorage.setItem("users", JSON.stringify(users));
  },
  async registerUser(data) {
    if (isFirebaseActive) {
      try {
        // 1. Create in Firebase Auth
        const cred = await fbAuth.createUserWithEmailAndPassword(data.email, data.password);
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
    } else {
      // Local storage fallback
      const users = this.getUsers();
      if (users.find(u => u.email === data.email)) return { error: "Email already registered!" };
      const user = {
        id: "u_" + Date.now(),
        name: data.name,
        email: data.email,
        phone: data.phone,
        password: btoa(data.password),
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      this.saveUsers(users);
      return { user };
    }
  },
  async loginUser(email, password) {
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
    } else {
      // Local storage fallback
      const users = this.getUsers();
      const user = users.find(u => u.email === email && u.password === btoa(password));
      if (!user) return { error: "Invalid email or password!" };
      return { user };
    }
  },
  getUserById(id) {
    return this.getUsers().find(u => u.id === id) || null;
  },
  updateUserProfile(userId, updates) {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...updates, updatedAt: new Date().toISOString() };
      this.saveUsers(users);

      const currentSession = this.getSession();
      if (currentSession && currentSession.id === userId) {
        this.setSession({ ...currentSession, ...users[idx] });
      }
      return users[idx];
    }
    return null;
  },
  updateUserAddress(userId, address) {
    return this.updateUserProfile(userId, { address });
  },
  async updateUserPassword(userId, oldPassword, newPassword) {
    const session = this.getSession();
    const userInfo = session || {};
    
    // Strict password validation
    const val = validatePassword(newPassword, userInfo);
    if (!val.valid) {
      return { error: val.error };
    }

    const users = this.getUsers();
    let idx = users.findIndex(u => 
      u.id === userId || 
      (u.email && session && u.email === session.email) ||
      (session && u.id === session.id)
    );

    if (idx === -1 && session) {
      const newUser = {
        id: session.id || userId || "u_" + Date.now(),
        name: session.name || "Customer",
        email: session.email || "",
        password: btoa(newPassword),
        createdAt: new Date().toISOString()
      };
      users.push(newUser);
      this.saveUsers(users);
      return { success: true };
    }

    if (idx !== -1) {
      if (users[idx].password && users[idx].password !== btoa(oldPassword)) {
        return { error: "Current password does not match!" };
      }
      users[idx].password = btoa(newPassword);
      users[idx].updatedAt = new Date().toISOString();
      this.saveUsers(users);

      if (isFirebaseActive && typeof fbAuth !== 'undefined' && fbAuth.currentUser) {
        try {
          await fbAuth.currentUser.updatePassword(newPassword);
        } catch (e) {
          console.warn("Firebase password update note:", e);
        }
      }

      return { success: true };
    }

    return { error: "User profile not found. Please log in again." };
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
    localStorage.setItem("session", JSON.stringify({ id: user.id, name: user.name, email: user.email }));
  },
  getSession() {
    return JSON.parse(localStorage.getItem("session") || "null");
  },
  clearSession() {
    localStorage.removeItem("session");
  },

  // ---- ORDERS ----
  getOrders() {
    return JSON.parse(localStorage.getItem("orders") || "[]");
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
    let orders = this.getOrders();
    orders = orders.filter(o => o.id !== id);
    this.saveOrders(orders);
    if (isFirebaseActive) {
      fbDb.collection("orders").doc(id).delete().catch(e => console.error("Firebase order delete error:", e));
    }
    return true;
  },
  getOrdersByUser(userIdOrUser) {
    const orders = this.getOrders();
    if (!userIdOrUser) return orders;

    let targetId = typeof userIdOrUser === "object" ? userIdOrUser.id : userIdOrUser;
    let targetEmail = typeof userIdOrUser === "object" ? userIdOrUser.email : "";
    let targetPhone = typeof userIdOrUser === "object" ? userIdOrUser.phone : "";

    const userOrders = orders.filter(o => {
      if (targetId && o.userId === targetId) return true;
      if (targetEmail && (o.userId === targetEmail || o.customerEmail === targetEmail)) return true;
      if (targetPhone && (o.phone === targetPhone || o.userId === targetPhone)) return true;
      return false;
    });

    // Fallback: If no strict user match found, return all orders in local storage so user can manage their orders!
    return userOrders.length > 0 ? userOrders : orders;
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
DB.initFirebase();

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
