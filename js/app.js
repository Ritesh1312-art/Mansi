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

function logoutAdmin(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  localStorage.removeItem("adminAuth");
  alert("🚪 Admin logged out!");
  window.location.href = "index.html";
}

function renderFooter() {
  const footer = document.querySelector(".footer");
  if (!footer) return;
  const session = DB.getSession();
  const isAdmin = localStorage.getItem("adminAuth") === "true";

  footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-brand">
        <div style="font-size:1.2rem;font-weight:800;color:var(--primary);">💍 ${STORE.name}</div>
        <p>${STORE.tagline}</p>
        <div style="margin-top:16px;display:flex;gap:10px;align-items:center;">
          <a href="#" onclick="openWhatsAppChat(event)"
             style="background:#25D366;color:#fff;padding:8px 16px;border-radius:8px;font-size:0.85rem;font-weight:700;display:inline-flex;align-items:center;gap:6px;text-decoration:none;">
            💬 WhatsApp Us
          </a>
          <button onclick="openThemeModal()" style="background:var(--bg-input);color:var(--text);border:1px solid var(--border);padding:8px 14px;border-radius:8px;font-size:0.85rem;font-weight:600;display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
            🎨 Theme Switcher
          </button>
        </div>
      </div>
      <div class="footer-col">
        <h4>Quick Links</h4>
        <a href="index.html">🏠 Home</a>
        <a href="products.html">🛍️ Products</a>
        <a href="cart.html">🛒 Cart</a>
        ${isAdmin 
          ? `<a href="admin/index.html">⚙️ Admin Dashboard</a>` 
          : session 
            ? `<a href="orders.html">📦 My Orders</a>` 
            : `<a href="login.html">👤 Login / Sign Up</a>`}
      </div>
      <div class="footer-col">
        <h4>Contact</h4>
        <a href="#">📍 ${STORE.address}</a>
        <a href="mailto:${STORE.email}">✉️ ${STORE.email}</a>
        ${!session && !isAdmin ? `<a href="admin/index.html" style="color:var(--text-light);font-size:0.78rem;margin-top:8px;">🔐 Admin Panel</a>` : ""}
        ${isAdmin ? `<a href="javascript:void(0)" onclick="logoutAdmin(event)" style="color:var(--error);font-size:0.85rem;margin-top:8px;font-weight:600;">🚪 Admin Logout</a>` : ""}
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2025 ${STORE.name}. All rights reserved.</span>
    </div>
  `;
}

// =============================================
// WISHLIST MANAGEMENT
// =============================================
const Wishlist = {
  get() {
    return JSON.parse(localStorage.getItem("wishlist") || "[]");
  },
  save(list) {
    localStorage.setItem("wishlist", JSON.stringify(list));
    this.updateCount();
  },
  toggle(productId) {
    const list = this.get();
    const idx = list.indexOf(productId);
    let added = false;
    if (idx !== -1) {
      list.splice(idx, 1);
    } else {
      list.push(productId);
      added = true;
    }
    this.save(list);
    Cart.showToast(added ? "❤️ Added to Wishlist!" : "🤍 Removed from Wishlist!");
    
    // Update any heart icons on page
    const btns = document.querySelectorAll(`[data-wishlist-id="${productId}"]`);
    btns.forEach(b => {
      b.textContent = added ? "❤️" : "🤍";
      b.classList.toggle("active", added);
    });
    return added;
  },
  contains(productId) {
    return this.get().includes(productId);
  },
  count() {
    return this.get().length;
  },
  updateCount() {
    const badges = document.querySelectorAll(".wishlist-count");
    const count = this.count();
    badges.forEach(b => {
      b.textContent = count;
      b.style.display = count > 0 ? "flex" : "none";
    });
  }
};

function toggleUserDropdown(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const dropdown = document.querySelector(".user-dropdown");
  if (dropdown) dropdown.classList.toggle("open");
}

document.addEventListener("click", () => {
  const dropdown = document.querySelector(".user-dropdown");
  if (dropdown) dropdown.classList.remove("open");
});

function logoutUser(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  DB.clearSession();
  alert("🚪 Logged out successfully!");
  window.location.href = "index.html";
  return false;
}

function initNavbar() {
  const session = DB.getSession();
  const isAdmin = localStorage.getItem("adminAuth") === "true";
  const userArea = document.getElementById("user-area");
  const mobileMenu = document.getElementById("mobile-menu");

  if (userArea) {
    if (isAdmin) {
      userArea.innerHTML = `
        <a href="wishlist.html" class="cart-btn wishlist-nav-btn" style="background:var(--primary-light);color:var(--primary);margin-right:4px;">
          ❤️ Wishlist
          <span class="cart-count wishlist-count" id="wishlist-badge">0</span>
        </a>
        <a href="admin/index.html" class="nav-btn primary-btn" style="margin-right:4px;">⚙️ Admin Panel</a>
        <button class="nav-btn outline-btn" onclick="logoutAdmin(event)" style="color:var(--error);">🚪 Admin Logout</button>`;
    } else if (session) {
      userArea.innerHTML = `
        <a href="wishlist.html" class="cart-btn wishlist-nav-btn" style="background:var(--primary-light);color:var(--primary);margin-right:4px;">
          ❤️ Wishlist
          <span class="cart-count wishlist-count" id="wishlist-badge">0</span>
        </a>
        <div class="user-dropdown">
          <button class="nav-btn user-btn" onclick="toggleUserDropdown(event)">👤 ${session.name.split(" ")[0]} ▾</button>
          <div class="dropdown-menu">
            <a href="profile.html">👤 My Profile & Address</a>
            <a href="orders.html">📦 My Orders</a>
            <a href="wishlist.html">❤️ My Wishlist</a>
            <a href="javascript:void(0)" onclick="logoutUser(event)" style="color:var(--error);">🚪 Logout</a>
          </div>
        </div>`;
    } else {
      userArea.innerHTML = `
        <a href="wishlist.html" class="cart-btn wishlist-nav-btn" style="background:var(--primary-light);color:var(--primary);margin-right:4px;">
          ❤️ Wishlist
          <span class="cart-count wishlist-count" id="wishlist-badge">0</span>
        </a>
        <a href="login.html" class="nav-btn outline-btn">Login</a>
        <a href="signup.html" class="nav-btn primary-btn">Sign Up</a>`;
    }
  }

  if (mobileMenu) {
    if (isAdmin) {
      mobileMenu.innerHTML = `
        <a href="products.html" style="font-weight:600;color:var(--text);">🛍️ Products</a>
        <a href="wishlist.html" style="font-weight:600;color:var(--text);">❤️ Wishlist</a>
        <a href="cart.html" style="font-weight:600;color:var(--text);">🛒 Cart</a>
        <a href="admin/index.html" style="font-weight:600;color:var(--primary);">⚙️ Admin Dashboard</a>
        <a href="javascript:void(0)" onclick="logoutAdmin(event)" style="font-weight:600;color:var(--error);">🚪 Admin Logout</a>`;
    } else if (session) {
      mobileMenu.innerHTML = `
        <a href="products.html" style="font-weight:600;color:var(--text);">🛍️ Products</a>
        <a href="wishlist.html" style="font-weight:600;color:var(--text);">❤️ Wishlist</a>
        <a href="cart.html" style="font-weight:600;color:var(--text);">🛒 Cart</a>
        <a href="profile.html" style="font-weight:600;color:var(--text);">👤 My Profile & Address</a>
        <a href="orders.html" style="font-weight:600;color:var(--text);">📦 My Orders</a>
        <a href="javascript:void(0)" onclick="logoutUser(event)" style="font-weight:600;color:var(--error);">🚪 Logout</a>`;
    } else {
      mobileMenu.innerHTML = `
        <a href="products.html" style="font-weight:600;color:var(--text);">🛍️ Products</a>
        <a href="wishlist.html" style="font-weight:600;color:var(--text);">❤️ Wishlist</a>
        <a href="cart.html" style="font-weight:600;color:var(--text);">🛒 Cart</a>
        <a href="login.html" style="font-weight:600;color:var(--text);">👤 Login</a>
        <a href="signup.html" style="font-weight:600;color:var(--text);">✨ Sign Up</a>`;
    }
  }

  Cart.updateCount();
  Wishlist.updateCount();
  renderFooter();
  injectThemeModalHTML();
}

function openThemeModal() {
  const modal = document.getElementById("theme-modal-overlay");
  if (modal) {
    renderThemeModalGrid();
    modal.classList.add("open");
  }
}

function closeThemeModal() {
  const modal = document.getElementById("theme-modal-overlay");
  if (modal) modal.classList.remove("open");
}

function injectThemeModalHTML() {
  if (document.getElementById("theme-modal-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "theme-modal-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:650px;">
      <div class="modal-header">
        <h3>🎨 Select Application Theme (15 Styles)</h3>
        <button class="modal-close" onclick="closeThemeModal()">✕</button>
      </div>
      <div class="theme-grid" id="modal-theme-grid" style="grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; margin-bottom: 16px;"></div>
      <div id="custom-theme-picker" style="display:none; border-top: 1px solid var(--border); padding-top: 14px; margin-top: 14px;">
        <h4 style="font-size:0.9rem; font-weight:700; margin-bottom:10px;">🛠️ Custom Theme Creator</h4>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          <div><label style="font-size:0.8rem; font-weight:600;">Primary Color:</label> <input type="color" id="cp-primary" value="#FF4F7E" onchange="updateCustomThemeFromPicker()" style="width:100%; height:36px; border:none; cursor:pointer;" /></div>
          <div><label style="font-size:0.8rem; font-weight:600;">Background Color:</label> <input type="color" id="cp-bg" value="#121218" onchange="updateCustomThemeFromPicker()" style="width:100%; height:36px; border:none; cursor:pointer;" /></div>
          <div><label style="font-size:0.8rem; font-weight:600;">Card Background:</label> <input type="color" id="cp-card" value="#1A1A24" onchange="updateCustomThemeFromPicker()" style="width:100%; height:36px; border:none; cursor:pointer;" /></div>
          <div><label style="font-size:0.8rem; font-weight:600;">Text Color:</label> <input type="color" id="cp-text" value="#FFFFFF" onchange="updateCustomThemeFromPicker()" style="width:100%; height:36px; border:none; cursor:pointer;" /></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function renderThemeModalGrid() {
  const container = document.getElementById("modal-theme-grid");
  if (!container) return;
  const currentTheme = localStorage.getItem("theme") || "default";

  container.innerHTML = THEMES.map(t => `
    <div class="theme-chip ${t.id === currentTheme ? 'active' : ''}" onclick="selectThemeFromModal('${t.id}')">
      <span class="icon">${t.icon}</span>
      <span>${t.name}</span>
    </div>
  `).join("");

  const customPicker = document.getElementById("custom-theme-picker");
  if (customPicker) {
    customPicker.style.display = currentTheme === "custom" ? "block" : "none";
  }
}

function selectThemeFromModal(themeId) {
  applyTheme(themeId);
  renderThemeModalGrid();
  if (themeId !== "custom") closeThemeModal();
}

function updateCustomThemeFromPicker() {
  const primary = document.getElementById("cp-primary")?.value || "#FF4F7E";
  const bg = document.getElementById("cp-bg")?.value || "#121218";
  const card = document.getElementById("cp-card")?.value || "#1A1A24";
  const text = document.getElementById("cp-text")?.value || "#FFFFFF";
  applyTheme("custom", { primary, primaryDark: primary, primaryLight: bg, bg, card, text, textMuted: text, border: "#2A2A38" });
}

// Automatically add mobile admin navigation bar if in admin subdirectory
// Automatically add mobile admin navigation bar, Kinetic Grid, and Click Burst animation
document.addEventListener("DOMContentLoaded", () => {
  if (window.location.pathname.includes("/admin/")) {
    initAdminMobileNav();
  }
  initKineticGrid();
  initClickAnimation();
});

// =============================================
// MOUSE CLICK ANIMATION — Ripple & Sparkle Burst
// =============================================
function initClickAnimation() {
  document.addEventListener("click", (e) => {
    const x = e.clientX;
    const y = e.clientY;

    const computed = getComputedStyle(document.documentElement);
    const primary = computed.getPropertyValue("--primary").trim() || "#FF4F7E";
    const accent = computed.getPropertyValue("--accent").trim() || "#FBBF24";

    // 1. Expanding Ripple Ring
    const ring = document.createElement("div");
    ring.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: 12px;
      height: 12px;
      margin-left: -6px;
      margin-top: -6px;
      border: 2px solid ${primary};
      border-radius: 50%;
      pointer-events: none;
      z-index: 9999999;
      box-shadow: 0 0 12px ${primary};
      animation: clickRipple 0.45s ease-out forwards;
    `;
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 450);

    // 2. Radial Sparkle Particles (8 particles)
    const particleCount = 8;
    for (let i = 0; i < particleCount; i++) {
      const p = document.createElement("div");
      const angle = (i / particleCount) * Math.PI * 2;
      const distance = 24 + Math.random() * 20;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      const color = i % 2 === 0 ? primary : accent;

      p.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        width: 6px;
        height: 6px;
        margin-left: -3px;
        margin-top: -3px;
        background: ${color};
        border-radius: 50%;
        pointer-events: none;
        z-index: 9999999;
        box-shadow: 0 0 8px ${color};
        transition: transform 0.4s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 0.4s ease-out;
      `;
      document.body.appendChild(p);

      requestAnimationFrame(() => {
        p.style.transform = `translate(${dx}px, ${dy}px) scale(0.2)`;
        p.style.opacity = "0";
      });

      setTimeout(() => p.remove(), 420);
    }
  });
}

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

// =============================================
// KINETIC GRID BACKGROUND — Reactive Dot & Trail
// =============================================
function initKineticGrid() {
  if (document.getElementById("kinetic-grid-canvas")) return;

  const canvas = document.createElement("canvas");
  canvas.id = "kinetic-grid-canvas";
  canvas.style.position = "fixed";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "-1";
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const mouseRef = { x: -9999, y: -9999, active: false };
  const trailRef = [];

  let W = window.innerWidth;
  let H = window.innerHeight;
  let cols = [];
  let dots = [];

  const getThemeColors = () => {
    const computed = getComputedStyle(document.documentElement);
    const primary = computed.getPropertyValue("--primary").trim() || "#FF4F7E";
    const bg = computed.getPropertyValue("--bg").trim() || "#0B0B0F";
    const accent = computed.getPropertyValue("--accent").trim() || primary;

    return {
      background: bg,
      dotColor: primary,
      lineColor: primary,
      trailColor: accent,
      spacing: 45,
      radius: 220,
      strength: 4,
      trail: true
    };
  };

  let config = getThemeColors();

  const build = () => {
    W = window.innerWidth;
    H = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    config = getThemeColors();
    const GAP = Math.max(8, config.spacing);

    cols = [];
    dots = [];
    const nCols = Math.floor(W / GAP) + 2;
    const nRows = Math.floor(H / GAP) + 2;
    for (let c = 0; c < nCols; c++) {
      const col = [];
      for (let rIdx = 0; rIdx < nRows; rIdx++) {
        const hx = c * GAP;
        const hy = rIdx * GAP;
        const d = { hx, hy, x: hx, y: hy, vx: 0, vy: 0 };
        col.push(d);
        dots.push(d);
      }
      cols.push(col);
    }
  };

  build();

  window.addEventListener("resize", build);

  const setMouse = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    const mx = clientX - r.left;
    const my = clientY - r.top;
    mouseRef.x = mx;
    mouseRef.y = my;
    mouseRef.active = true;
    const now = performance.now();
    trailRef.push({ x: mx, y: my, t: now });
    if (trailRef.length > 80) trailRef.shift();
  };

  window.addEventListener("mousemove", (e) => setMouse(e.clientX, e.clientY));
  window.addEventListener("mouseleave", () => {
    mouseRef.active = false;
    mouseRef.x = -9999;
    mouseRef.y = -9999;
  });
  window.addEventListener("touchmove", (e) => {
    if (e.touches[0]) setMouse(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener("touchend", () => {
    mouseRef.active = false;
    mouseRef.x = -9999;
    mouseRef.y = -9999;
  });

  let raf = 0;
  const frame = () => {
    const m = mouseRef;
    const { background, dotColor, lineColor, trailColor, radius, strength, trail } = config;
    const R = Math.max(1, radius);
    const PULL = (Math.max(1, Math.min(10, strength)) / 10) * 4;

    ctx.clearRect(0, 0, W, H);

    // Draw background color from current theme
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, W, H);

    // Update dot physics: spring home + attraction toward cursor.
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      let ax = (d.hx - d.x) * 0.08;
      let ay = (d.hy - d.y) * 0.08;
      if (m.active) {
        const dx = m.x - d.x;
        const dy = m.y - d.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < R && dist > 0.001) {
          const f = (1 - dist / R) * PULL;
          ax += (dx / dist) * f;
          ay += (dy / dist) * f;
        }
      }
      d.vx = (d.vx + ax) * 0.82;
      d.vy = (d.vy + ay) * 0.82;
      d.x += d.vx;
      d.y += d.vy;
    }

    // Grid mesh lines (brighten near the cursor).
    for (let c = 0; c < cols.length; c++) {
      for (let rIdx = 0; rIdx < cols[c].length; rIdx++) {
        const d = cols[c][rIdx];
        const right = cols[c + 1]?.[rIdx];
        const down = cols[c]?.[rIdx + 1];
        const prox = m.active
          ? Math.max(0, 1 - Math.sqrt((m.x - d.x) ** 2 + (m.y - d.y) ** 2) / R)
          : 0;
        if (right) {
          ctx.globalAlpha = 0.15 + prox * 0.8;
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 0.8 + prox * 1.8;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(right.x, right.y);
          ctx.stroke();
        }
        if (down) {
          ctx.globalAlpha = 0.15 + prox * 0.8;
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 0.8 + prox * 1.8;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(down.x, down.y);
          ctx.stroke();
        }
      }
    }

    // Dots.
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      const prox = m.active
        ? Math.max(0, 1 - Math.sqrt((m.x - d.x) ** 2 + (m.y - d.y) ** 2) / R)
        : 0;
      ctx.globalAlpha = 0.35 + prox * 0.65;
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.2 + prox * 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Cursor trail line — visible on mouse move, fades out.
    if (trail) {
      const now = performance.now();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < trailRef.length; i++) {
        const a = trailRef[i - 1];
        const b = trailRef[i];
        const age = now - b.t;
        if (age > 260) continue;
        ctx.globalAlpha = Math.max(0, 1 - age / 260) * 0.85;
        ctx.strokeStyle = trailColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);
}
