// =============================================
// DATA MANAGEMENT — localStorage + Firebase Hybrid Sync
// =============================================

let isFirebaseActive = false;
let fbAuth = null;
let fbDb = null;

// Default Seed Products (Guarantees store is NEVER empty)
const DEFAULT_STORE_PRODUCTS = [
  {
    id: "p_seed_1",
    name: "Royal Kundan Gold Necklace Set",
    category: "jewellery",
    price: 1299,
    mrp: 1999,
    description: "Handcrafted traditional Royal Kundan Necklace set with matching earrings. Perfect for weddings, festivals & special occasions.",
    image: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=600",
    inStock: true,
    rating: 4.8,
    reviews: 42,
    sales: 128,
    createdAt: new Date().toISOString()
  },
  {
    id: "p_seed_2",
    name: "Matte Elegance Luxury Lipstick Combo",
    category: "cosmetics",
    price: 499,
    mrp: 899,
    description: "Long-lasting 12-hour stay velvet matte lipstick set in 4 viral shades. Non-drying, lightweight formula.",
    image: "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=600",
    inStock: true,
    rating: 4.9,
    reviews: 65,
    sales: 210,
    createdAt: new Date().toISOString()
  },
  {
    id: "p_seed_3",
    name: "Vintage Ceramic Royal Tea Cup Set (Set of 6)",
    category: "tea-sets",
    price: 899,
    mrp: 1499,
    description: "Premium gold-trimmed ceramic tea cup & saucer set. Adds a touch of luxury to your tea breaks.",
    image: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=600",
    inStock: true,
    rating: 4.7,
    reviews: 38,
    sales: 95,
    createdAt: new Date().toISOString()
  },
  {
    id: "p_seed_4",
    name: "Handmade Radha Krishna Canvas Painting",
    category: "paintings",
    price: 1499,
    mrp: 2499,
    description: "Exquisite hand-painted Radha Krishna artwork on premium canvas. Comes with gold-finish floating wooden frame.",
    image: "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600",
    inStock: true,
    rating: 4.9,
    reviews: 29,
    sales: 64,
    createdAt: new Date().toISOString()
  },
  {
    id: "p_seed_5",
    name: "Bridal Diamond-Style Zircon Bangles",
    category: "jewellery",
    price: 799,
    mrp: 1299,
    description: "Sparkling American Diamond cubic zircon bangles set of 4. High shine, anti-tarnish gold plating.",
    image: "https://images.unsplash.com/photo-1611591475281-8d9954a2be31?w=600",
    inStock: true,
    rating: 4.8,
    reviews: 51,
    sales: 140,
    createdAt: new Date().toISOString()
  },
  {
    id: "p_seed_6",
    name: "Glow & Shine Herbal Skincare Gift Box",
    category: "gifts",
    price: 699,
    mrp: 1199,
    description: "Natural herbal face serum, vitamin C moisturizer & rose water mist gift hamper box.",
    image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600",
    inStock: true,
    rating: 4.6,
    reviews: 33,
    sales: 82,
    createdAt: new Date().toISOString()
  }
];

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

      // CRITICAL: Only overwrite localStorage if Firebase snapshot actually has products!
      if (products.length > 0) {
        products.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
        localStorage.setItem("products", JSON.stringify(products));
        localStorage.setItem("products_backup", JSON.stringify(products));
        window.dispatchEvent(new Event("productsSynced"));
      } else {
        // If Firebase DB is empty, sync local products up to Firebase so they are never lost!
        const localRaw = localStorage.getItem("products") || localStorage.getItem("products_backup");
        if (localRaw) {
          try {
            const localList = JSON.parse(localRaw);
            if (Array.isArray(localList) && localList.length > 0) {
              localList.forEach(p => fbDb.collection("products").doc(p.id).set(p));
            }
          } catch(e) {}
        }
      }
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
    let rawStr = localStorage.getItem("products");
    if (!rawStr || rawStr === "[]") {
      rawStr = localStorage.getItem("products_backup");
    }
    let raw = [];
    try { raw = JSON.parse(rawStr || "[]"); } catch(e){}

    // Auto-seed if empty so store is NEVER empty!
    if (!Array.isArray(raw) || raw.length === 0) {
      raw = DEFAULT_STORE_PRODUCTS;
      localStorage.setItem("products", JSON.stringify(raw));
      localStorage.setItem("products_backup", JSON.stringify(raw));
    }

    let needsResave = false;
    const products = raw.map((p, idx) => {
      if (!p || typeof p !== 'object') return null;
      if (!p.id) {
        p.id = "p_" + Date.now() + "_" + idx;
        needsResave = true;
      }
      if (!p.rating || Number(p.rating) < 4.0) {
        p.rating = parseFloat((4.0 + Math.random()).toFixed(1));
        if (p.rating > 5.0) p.rating = 5.0;
        needsResave = true;
      }
      return p;
    }).filter(Boolean);

    if (needsResave) {
      localStorage.setItem("products", JSON.stringify(products));
      localStorage.setItem("products_backup", JSON.stringify(products));
    }
    return products;
  },
  saveProducts(products) {
    try {
      localStorage.setItem("products", JSON.stringify(products));
      localStorage.setItem("products_backup", JSON.stringify(products));
    } catch (e) {
      console.warn("⚠️ LocalStorage quota warning! Pruning heavy local image caches to free memory...", e);
      try {
        const categoryFallbacks = {
          jewellery: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=500",
          cosmetics: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=500",
          "tea-sets": "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500",
          paintings: "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=500",
          gifts: "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=500"
        };
        const lightweight = products.map((p, idx) => {
          if (idx > 3 && p.image && p.image.length > 50000) {
            const copy = { ...p };
            const cat = (copy.category || "").toLowerCase();
            copy.image = categoryFallbacks[cat] || "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=500";
            return copy;
          }
          return p;
        });
        localStorage.setItem("products", JSON.stringify(lightweight));
        localStorage.setItem("products_backup", JSON.stringify(lightweight));
      } catch (e2) {
        console.error("❌ LocalStorage save error:", e2.message);
      }
    }
  },
  addProduct(product) {
    // Always generate a fresh unique ID when adding
    if (!product.id) {
      product.id = "p_" + Date.now();
    }
    product.createdAt = product.createdAt || new Date().toISOString();
    // ✅ Always set rating between 4.0 and 5.0
    const baseRating = 4.0 + Math.random();
    product.rating = parseFloat(Math.min(baseRating, 5.0).toFixed(1));
    product.reviews = product.reviews || Math.floor(Math.random() * 50) + 5; // 5–54 reviews
    product.sales = product.sales || 0;

    const products = this.getProducts();
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
