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
      snapshot.forEach(doc => products.push(doc.data()));
      // Sort by creation date
      products.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
      localStorage.setItem("products", JSON.stringify(products));
      // Dispatch event to update UI dynamically if page supports it
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
    return JSON.parse(localStorage.getItem("products") || "[]");
  },
  saveProducts(products) {
    localStorage.setItem("products", JSON.stringify(products));
  },
  addProduct(product) {
    const products = this.getProducts();
    product.id = product.id || "p_" + Date.now();
    product.createdAt = product.createdAt || new Date().toISOString();
    product.rating = product.rating || 0;
    product.reviews = product.reviews || 0;
    product.sales = product.sales || 0;

    products.unshift(product);
    this.saveProducts(products);

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
    return this.getProducts().find(p => p.id === id) || null;
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
  getOrdersByUser(userId) {
    return this.getOrders().filter(o => o.userId === userId);
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
    if (this.getProducts().length > 0) return;
    const samples = [
      { name: "BSCI Ceramic Tea Cup Set", price: 150, mrp: 200, category: "tea-sets", image: "https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400", description: "Premium BSCI certified ceramic tea cup set. Set of 6 cups with beautiful floral design. Perfect for gifting.", stock: 20 },
      { name: "White Ceramic Tea Cup Set", price: 150, mrp: 200, category: "tea-sets", image: "https://images.unsplash.com/photo-1571934811356-5cc061b6821f?w=400", description: "Elegant white ceramic tea cup set with gold rim. Set of 6. Microwave safe.", stock: 15 },
      { name: "Moody Panda Ceramic Cup Set", price: 150, mrp: 200, category: "tea-sets", image: "https://images.unsplash.com/photo-1514481538271-cf9f99627ab4?w=400", description: "Cute panda themed ceramic cups. Set of 6. Great as a gift.", stock: 18 },
      { name: "Frame Crystal Glass Painting", price: 400, mrp: 550, category: "paintings", image: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400", description: "Stunning crystal glass painting in a beautiful frame. Wall art that transforms any room.", stock: 10 },
      { name: "Frame Wall 5D Diamond Painting", price: 300, mrp: 450, category: "paintings", image: "https://images.unsplash.com/photo-1615361200141-f45040f367be?w=400", description: "Gorgeous 5D diamond painting. Handcrafted with precision. Perfect wall decor.", stock: 12 },
      { name: "Printed Ceramic Tea Cup Set", price: 150, mrp: 200, category: "tea-sets", image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400", description: "Artistic printed ceramic cups. Set of 6. Available in multiple designs.", stock: 25 },
      { name: "Gold Plated Necklace Set", price: 299, mrp: 599, category: "jewellery", image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400", description: "Elegant gold plated necklace with matching earrings. Perfect for weddings and parties.", stock: 8 },
      { name: "Luxury Lipstick Set (6 Shades)", price: 199, mrp: 350, category: "cosmetics", image: "https://images.unsplash.com/photo-1586495777744-4e6232bf2b18?w=400", description: "Long-lasting matte lipstick set in 6 beautiful shades. Paraben free.", stock: 30 },
    ];
    samples.forEach(p => this.addProduct(p));
  }
};

// Start Firebase sync if configured
DB.initFirebase();
// Seed sample data on first load
DB.seedSampleProducts();
