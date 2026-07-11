// =============================================
// CART MANAGEMENT
// =============================================

const Cart = {
  get() {
    return JSON.parse(localStorage.getItem("cart") || "[]");
  },
  save(cart) {
    localStorage.setItem("cart", JSON.stringify(cart));
    this.updateCount();
  },
  add(productId, qty = 1) {
    const cart = this.get();
    const product = DB.getProductById(productId);
    if (!product) return;
    const existing = cart.find(i => i.productId === productId);
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({ productId, name: product.name, price: product.price, image: product.image, qty });
    }
    this.save(cart);
    this.showToast(`${product.name} added to cart!`);
  },
  remove(productId) {
    const cart = this.get().filter(i => i.productId !== productId);
    this.save(cart);
  },
  updateQty(productId, qty) {
    const cart = this.get();
    const item = cart.find(i => i.productId === productId);
    if (item) {
      if (qty <= 0) return this.remove(productId);
      item.qty = qty;
      this.save(cart);
    }
  },
  clear() {
    localStorage.removeItem("cart");
    this.updateCount();
  },
  total() {
    return this.get().reduce((sum, i) => sum + i.price * i.qty, 0);
  },
  count() {
    return this.get().reduce((sum, i) => sum + i.qty, 0);
  },
  updateCount() {
    const badges = document.querySelectorAll(".cart-count");
    const count = this.count();
    badges.forEach(b => {
      b.textContent = count;
      b.style.display = count > 0 ? "flex" : "none";
    });
  },
  showToast(msg) {
    const toast = document.createElement("div");
    toast.className = "toast-notification";
    toast.innerHTML = `<span>🛒</span> ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 100);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 400); }, 2500);
  }
};

// =============================================
// SHEET SYNC — Google Sheet CSV
// =============================================
const SheetSync = {
  async importFromSheet(csvUrl) {
    try {
      const response = await fetch(csvUrl);
      const text = await response.text();
      const rows = text.split("\n").slice(1); // skip header
      let imported = 0;
      rows.forEach(row => {
        const cols = row.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        if (cols.length < 4 || !cols[0]) return;
        const [name, price, mrp, category, image, description, stock] = cols;
        if (name && price) {
          DB.addProduct({ name, price: +price, mrp: +(mrp || price), category: category || "all", image: image || "", description: description || "", stock: +(stock || 10) });
          imported++;
        }
      });
      return { success: true, count: imported };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
  exportToCSV() {
    const products = DB.getProducts();
    const header = "Name,Price,MRP,Category,Image,Description,Stock";
    const rows = products.map(p =>
      `"${p.name}",${p.price},${p.mrp},"${p.category}","${p.image}","${p.description}",${p.stock}`
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mansi-products.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
};

// =============================================
// PAYMENT — Razorpay Integration
// =============================================
const Payment = {
  async initOnlinePayment(order, onSuccess) {
    if (typeof Razorpay === "undefined") {
      alert("Payment gateway loading failed. Please try COD.");
      return;
    }
    const options = {
      key: STORE.razorpayKey,
      amount: order.grandTotal * 100, // paise
      currency: "INR",
      name: STORE.name,
      description: `Order #${order.id}`,
      handler: function (response) {
        order.paymentId = response.razorpay_payment_id;
        order.status = "confirmed";
        DB.updateOrderStatus(order.id, "confirmed");
        onSuccess(order);
      },
      prefill: {
        name: order.customerName,
        contact: order.phone,
      },
      theme: { color: "var(--primary, #F59E0B)" }
    };
    const rzp = new Razorpay(options);
    rzp.open();
  }
};

// =============================================
// NAVBAR & FOOTER — shared across all pages
// =============================================
function openWhatsAppChat(e) {
  if (e) e.preventDefault();
  window.open(`https://wa.me/${STORE.whatsapp}`, "_blank");
}

function callSupport(e) {
  if (e) e.preventDefault();
  window.location.href = `tel:${STORE.phone}`;
}

function renderFooter() {
  const footer = document.querySelector(".footer");
  if (!footer) return;
  footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-brand">
        <div style="font-size:1.2rem;font-weight:800;color:var(--primary);">💍 ${STORE.name}</div>
        <p>${STORE.tagline}</p>
        <div style="margin-top:16px;display:flex;gap:10px;">
          <a href="#" onclick="openWhatsAppChat(event)"
             style="background:#25D366;color:#fff;padding:8px 16px;border-radius:8px;font-size:0.85rem;font-weight:700;display:inline-flex;align-items:center;gap:6px;text-decoration:none;">
            💬 WhatsApp Us
          </a>
        </div>
      </div>
      <div class="footer-col">
        <h4>Quick Links</h4>
        <a href="index.html">🏠 Home</a>
        <a href="products.html">🛍️ Products</a>
        <a href="cart.html">🛒 Cart</a>
        <a href="orders.html">📦 My Orders</a>
      </div>
      <div class="footer-col">
        <h4>Contact</h4>
        <a href="#">📍 ${STORE.address}</a>
        <a href="#" onclick="callSupport(event)">📞 Call Support</a>
        <a href="mailto:${STORE.email}">✉️ ${STORE.email}</a>
        <a href="admin/index.html" style="color:var(--text-light);font-size:0.78rem;margin-top:8px;">🔐 Admin Panel</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2025 ${STORE.name}. All rights reserved.</span>
    </div>
  `;
}

function initNavbar() {
  const session = DB.getSession();
  const userArea = document.getElementById("user-area");
  if (!userArea) return;

  if (session) {
    userArea.innerHTML = `
      <a href="orders.html" class="nav-link">My Orders</a>
      <div class="user-dropdown">
        <button class="nav-btn user-btn">👤 ${session.name.split(" ")[0]}</button>
        <div class="dropdown-menu">
          <a href="orders.html">📦 My Orders</a>
          <a href="#" onclick="DB.clearSession();location.href='index.html'">🚪 Logout</a>
        </div>
      </div>`;
  } else {
    userArea.innerHTML = `
      <a href="login.html" class="nav-btn outline-btn">Login</a>
      <a href="signup.html" class="nav-btn primary-btn">Sign Up</a>`;
  }
  Cart.updateCount();
  renderFooter();
}

// Automatically add mobile admin navigation bar if in admin subdirectory
document.addEventListener("DOMContentLoaded", () => {
  if (window.location.pathname.includes("/admin/")) {
    initAdminMobileNav();
  }
});

function initAdminMobileNav() {
  const nav = document.createElement("div");
  nav.className = "admin-mobile-nav";
  
  const path = window.location.pathname;
  const isDashboard = path.includes("index.html") || path.endsWith("/admin/") || path.endsWith("/admin");
  const isProducts = path.includes("products.html");
  const isOrders = path.includes("orders.html");
  const isSettings = path.includes("settings.html");

  nav.innerHTML = `
    <a href="index.html" class="admin-mob-item ${isDashboard ? 'active' : ''}">
      <span>📊</span> Dashboard
    </a>
    <a href="products.html" class="admin-mob-item ${isProducts ? 'active' : ''}">
      <span>🛍️</span> Products
    </a>
    <a href="orders.html" class="admin-mob-item ${isOrders ? 'active' : ''}">
      <span>📦</span> Orders
    </a>
    <a href="settings.html" class="admin-mob-item ${isSettings ? 'active' : ''}">
      <span>⚙️</span> Settings
    </a>
  `;
  document.body.appendChild(nav);
  document.body.style.paddingBottom = "80px";
}
