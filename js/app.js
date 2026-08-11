// =============================================
// CART MANAGEMENT
// =============================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function safeProductId(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "");
}

function safeImageUrl(value) {
  const fallback = "assets/brand/icon.svg";
  try {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    if (/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,/i.test(raw) || /^blob:/i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    const cleanPath = raw.startsWith("/") ? raw : "/" + raw.replace(/^(\.\.\/|\.\/)+/, "");
    return window.location.origin + cleanPath;
  } catch (_) {}
  return fallback;
}

const Cart = {
  get() {
    try {
      const cart = JSON.parse(localStorage.getItem("cart") || "[]");
      return Array.isArray(cart) ? cart : [];
    } catch (_) {
      return [];
    }
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
    const icon = document.createElement("span");
    icon.textContent = "🛒";
    toast.append(icon, document.createTextNode(" " + String(msg || "")));
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 100);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 400); }, 2500);
  }
};

// =============================================
// SHEET SYNC — authenticated server backup and merge-only restore
// =============================================
const SheetSync = {
  async backupNow() {
    if (!window.StoreApi) throw new Error("Backup service is unavailable");
    return StoreApi.backupNow();
  },

  async previewRestore() {
    if (!window.StoreApi) throw new Error("Restore service is unavailable");
    return StoreApi.restorePreview();
  },

  async restoreMerge() {
    if (!window.StoreApi) throw new Error("Restore service is unavailable");
    return StoreApi.restoreMerge();
  },

  exportToCSV() {
    const products = DB.getProducts();
    const header = "Name,Price,MRP,Category,Image,Description,Stock";
    const csvCell = value => {
      let text = String(value ?? "");
      if (/^[=+\-@]/.test(text)) text = "'" + text;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = products.map(p => [
      csvCell(p.name), Number(p.price) || 0, Number(p.mrp) || 0,
      csvCell(p.category || "jewellery"), csvCell(p.image), csvCell(p.description), Math.max(0, Number(p.stock) || 0)
    ].join(","));
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mansi-store-products-backup.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
};

// Google Sheet sync is server-managed after authenticated product writes.

// Re-render whichever catalog view is open after products are fetched from the API.
window.addEventListener("productsSynced", () => {
  const isAdminPage = window.location.pathname.includes("/admin/");
  [
    "renderProducts",
    "renderProductsTable",
    "renderFeatured",
    "renderNewArrivals",
    "renderWishlist"
  ].forEach(functionName => {
    if (typeof window[functionName] === "function") {
      try { window[functionName](); } catch (e) {
        console.warn("Could not refresh " + functionName, e);
      }
    }
  });
  // Only call initDashboard if on admin pages to prevent spurious admin metric renders on public pages
  const adminContent = document.getElementById("admin-content");
  const adminUnlocked = adminContent && window.getComputedStyle(adminContent).display !== "none";
  if (isAdminPage && adminUnlocked && typeof window["initDashboard"] === "function") {
    try { window["initDashboard"](); } catch (e) {
      console.warn("Could not refresh initDashboard", e);
    }
  }
});


// =============================================
// NAVBAR & FOOTER — shared across all pages
// =============================================
function openTelegramChat(e) {
  if (e) e.preventDefault();
  const username = (STORE.telegramUsername || "MansiJewellery").replace('@', '');
  window.open(`https://t.me/${username}`, "_blank");
}

function callSupport(e) {
  if (e) e.preventDefault();
  const username = (STORE.telegramUsername || "MansiJewellery").replace('@', '');
  window.open(`https://t.me/${username}`, "_blank");
}

async function logoutAdmin(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (window.AdminSession) await AdminSession.logout();
  else localStorage.removeItem("adminAuth");
  alert("🚪 Logged out from Admin Panel!");
  if (window.location.pathname.includes("/admin/")) {
    window.location.href = "../index.html";
  } else {
    window.location.href = "index.html";
  }
}

function renderFooter() {
  const footer = document.querySelector(".footer");
  if (!footer) return;
  const inAdmin = window.location.pathname.includes("/admin/");
  const prefix = inAdmin ? "../" : "";
  const adminPrefix = inAdmin ? "" : "admin/";
  const session = DB.getSession();
  const isAdmin = localStorage.getItem("adminAuth") === "true";
  const tgUser = String(STORE.telegramUsername || "").replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");
  const storeName = escapeHTML(STORE.name || "Mansi Jewellery & Cosmetics");
  const tagline = escapeHTML(STORE.tagline || "");
  const address = escapeHTML(STORE.address || "");
  const email = String(STORE.email || "").trim().replace(/[^A-Za-z0-9.!#$%&'*+/=?^_`{|}~@-]/g, "");

  footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-brand">
        <div style="font-size:1.2rem;font-weight:800;color:var(--primary);">💍 ${storeName}</div>
        <p>${tagline}</p>
        <div style="margin-top:16px;display:flex;gap:10px;align-items:center;">
          <a href="${tgUser ? 'https://t.me/' + tgUser : '#'}" target="_blank" onclick="${!tgUser ? 'openTelegramChat(event)' : ''}"
             style="background:#0088cc;color:#fff;padding:8px 16px;border-radius:8px;font-size:0.85rem;font-weight:700;display:inline-flex;align-items:center;gap:6px;text-decoration:none;">
            ✈️ Telegram Support ${tgUser ? '(@' + tgUser + ')' : ''}
          </a>
          <button onclick="openThemeModal()" style="background:var(--bg-input);color:var(--text);border:1px solid var(--border);padding:8px 14px;border-radius:8px;font-size:0.85rem;font-weight:600;display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
            🎨 Theme Switcher
          </button>
        </div>
      </div>
      <div class="footer-col">
        <h4>Quick Links</h4>
        <a href="${prefix}index.html">🏠 Home</a>
        <a href="${prefix}products.html">🛍️ Products</a>
        <a href="${prefix}cart.html">🛒 Cart</a>
        ${isAdmin 
          ? `<a href="${adminPrefix}index.html">⚙️ Admin Dashboard</a>` 
          : session 
            ? `<a href="${prefix}orders.html">📦 My Orders</a>` 
            : `<a href="${prefix}login.html">👤 Login / Sign Up</a>`}
      </div>
      <div class="footer-col">
        <h4>Contact</h4>
        <span>📍 ${address}</span>
        <a href="mailto:${email}">✉️ ${escapeHTML(email)}</a>
        ${!session && !isAdmin ? `<a href="${adminPrefix}index.html" style="color:var(--text-light);font-size:0.78rem;margin-top:8px;">🔐 Admin Panel</a>` : ""}
        ${isAdmin ? `<a href="javascript:void(0)" onclick="logoutAdmin(event)" style="color:var(--error);font-size:0.85rem;margin-top:8px;font-weight:600;">🚪 Admin Logout</a>` : ""}
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${new Date().getFullYear()} ${storeName}. All rights reserved.</span>
    </div>
  `;
}

// =============================================
// WISHLIST MANAGEMENT
// =============================================
const Wishlist = {
  get() {
    try {
      const list = JSON.parse(localStorage.getItem("wishlist") || "[]");
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
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

async function logoutUser(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (fbAuth && fbAuth.currentUser) await fbAuth.signOut();
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

  const themeBtnHTML = `<button onclick="openThemeModal()" class="cart-btn theme-nav-btn" style="background:var(--primary-light);color:var(--primary);margin-right:4px;padding:8px 12px;cursor:pointer;" title="Change App Theme">🎨 Theme</button>`;

  if (userArea) {
    if (isAdmin) {
      userArea.innerHTML = `
        ${themeBtnHTML}
        <a href="wishlist.html" class="cart-btn wishlist-nav-btn" style="background:var(--primary-light);color:var(--primary);margin-right:4px;">
          ❤️ Wishlist
          <span class="cart-count wishlist-count" id="wishlist-badge">0</span>
        </a>
        <a href="admin/index.html" class="nav-btn primary-btn" style="margin-right:4px;">⚙️ Admin Panel</a>
        <button class="nav-btn outline-btn" onclick="logoutAdmin(event)" style="color:var(--error);">🚪 Admin Logout</button>`;
    } else if (session) {
      userArea.innerHTML = `
        ${themeBtnHTML}
        <a href="wishlist.html" class="cart-btn wishlist-nav-btn" style="background:var(--primary-light);color:var(--primary);margin-right:4px;">
          ❤️ Wishlist
          <span class="cart-count wishlist-count" id="wishlist-badge">0</span>
        </a>
        <div class="user-dropdown">
          <button class="nav-btn user-btn" onclick="toggleUserDropdown(event)">👤 ${escapeHTML(String(session.name || "User").split(" ")[0])} ▾</button>
          <div class="dropdown-menu">
            <a href="profile.html">👤 My Profile & Address</a>
            <a href="orders.html">📦 My Orders</a>
            <a href="wishlist.html">❤️ My Wishlist</a>
            <a href="javascript:void(0)" onclick="openThemeModal()">🎨 Change App Theme</a>
            <a href="javascript:void(0)" onclick="logoutUser(event)" style="color:var(--error);">🚪 Logout</a>
          </div>
        </div>`;
    } else {
      userArea.innerHTML = `
        ${themeBtnHTML}
        <a href="wishlist.html" class="cart-btn wishlist-nav-btn" style="background:var(--primary-light);color:var(--primary);margin-right:4px;">
          ❤️ Wishlist
          <span class="cart-count wishlist-count" id="wishlist-badge">0</span>
        </a>
        <a href="login.html" class="nav-btn outline-btn">Login</a>
        <a href="signup.html" class="nav-btn primary-btn">Sign Up</a>`;
    }
  }

  if (mobileMenu) {
    const themeMobileLink = `<a href="javascript:void(0)" onclick="openThemeModal();document.getElementById('mobile-menu').style.display='none';" style="font-weight:600;color:var(--primary);">🎨 Change Theme (15 Colors)</a>`;
    if (isAdmin) {
      mobileMenu.innerHTML = `
        <a href="products.html" style="font-weight:600;color:var(--text);">🛍️ Products</a>
        <a href="wishlist.html" style="font-weight:600;color:var(--text);">❤️ Wishlist</a>
        <a href="cart.html" style="font-weight:600;color:var(--text);">🛒 Cart</a>
        ${themeMobileLink}
        <a href="admin/index.html" style="font-weight:600;color:var(--primary);">⚙️ Admin Dashboard</a>
        <a href="javascript:void(0)" onclick="logoutAdmin(event)" style="font-weight:600;color:var(--error);">🚪 Admin Logout</a>`;
    } else if (session) {
      mobileMenu.innerHTML = `
        <a href="products.html" style="font-weight:600;color:var(--text);">🛍️ Products</a>
        <a href="wishlist.html" style="font-weight:600;color:var(--text);">❤️ Wishlist</a>
        <a href="cart.html" style="font-weight:600;color:var(--text);">🛒 Cart</a>
        <a href="profile.html" style="font-weight:600;color:var(--text);">👤 My Profile & Address</a>
        <a href="orders.html" style="font-weight:600;color:var(--text);">📦 My Orders</a>
        ${themeMobileLink}
        <a href="javascript:void(0)" onclick="logoutUser(event)" style="font-weight:600;color:var(--error);">🚪 Logout</a>`;
    } else {
      mobileMenu.innerHTML = `
        <a href="products.html" style="font-weight:600;color:var(--text);">🛍️ Products</a>
        <a href="wishlist.html" style="font-weight:600;color:var(--text);">❤️ Wishlist</a>
        <a href="cart.html" style="font-weight:600;color:var(--text);">🛒 Cart</a>
        ${themeMobileLink}
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

// Global Quick Buy — Add to cart and redirect straight to Checkout
function quickBuy(productId) {
  if (typeof Cart !== 'undefined') {
    Cart.add(productId);
  }
  setTimeout(() => {
    window.location.href = "checkout.html";
  }, 150);
}

// Automatically initialize Navbar, Wishlist, Admin mobile nav, and Click Burst animation
document.addEventListener("DOMContentLoaded", () => {
  if (typeof initNavbar === "function") {
    initNavbar();
  }
  if (window.location.pathname.includes("/admin/")) {
    initAdminMobileNav();
  }
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



// Global TempMail & Extension Overlay Blocker
function initTempMailBlocker() {
  function cleanInputs() {
    document.querySelectorAll("input, select, textarea").forEach(el => {
      el.style.setProperty("background-image", "none", "important");
      el.style.setProperty("background-repeat", "no-repeat", "important");
    });
    document.querySelectorAll("[class*='tempmail'], [id*='tempmail'], [class*='temp-mail'], [data-tempmail], tempmail-button, iframe[src*='tempmail'], div[style*='tempmail']").forEach(el => el.remove());
  }

  cleanInputs();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", cleanInputs, { once: true });
  }
  window.addEventListener("load", cleanInputs, { once: true });

  // Use MutationObserver so any extension dynamic DOM insertion is instantly stripped
  const observer = new MutationObserver(() => cleanInputs());
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  }
}
initTempMailBlocker();



// =============================================
// RULE-BASED STORE ASSISTANT
// =============================================
function initChatbotWidget() {
  if (document.getElementById("ai-chat-btn")) return;

  const btn = document.createElement("button");
  btn.id = "ai-chat-btn";
  btn.className = "ai-chat-btn";
  btn.innerHTML = `💬 <span>Store Assistant</span>`;
  btn.onclick = toggleChatbot;

  const box = document.createElement("div");
  box.id = "ai-chat-box";
  box.className = "ai-chat-box";
  box.style.display = "none";

  box.innerHTML = `
    <div class="ai-chat-header">
      <h4>💬 Mansi Store Assistant</h4>
      <button class="ai-chat-close" onclick="toggleChatbot()">✕</button>
    </div>
    <div class="ai-chat-body" id="ai-chat-messages">
      <div class="ai-msg bot">
        👋 Hello! Welcome to <strong>${escapeHTML(STORE.name || "Mansi Jewellery & Cosmetics")}</strong>.<br/>
        How can I help you today? Ask me anything about products, delivery, orders or discounts!
      </div>
      <div class="ai-chips">
        <button class="ai-chip" onclick="sendChatQuery('🚚 Delivery & COD Info')">🚚 Delivery & COD</button>
        <button class="ai-chip" onclick="sendChatQuery('📦 Track My Order')">📦 Track Order</button>
        <button class="ai-chip" onclick="sendChatQuery('💰 Active Offers & Coupons')">💰 Offers & Codes</button>
        <button class="ai-chip" onclick="sendChatQuery('💎 Product Price Range')">💎 Price Range</button>
        <button class="ai-chip" onclick="sendChatQuery('✈️ Talk to Store Owner')">✈️ Live Telegram</button>
      </div>
    </div>
    <div class="ai-chat-input-row">
      <input type="text" id="ai-chat-input" class="ai-chat-input" placeholder="Type your query here..." onkeydown="if(event.key==='Enter') handleUserChatSubmit()" />
      <button class="ai-chat-send" onclick="handleUserChatSubmit()">➤</button>
    </div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(box);
}

function toggleChatbot() {
  const box = document.getElementById("ai-chat-box");
  if (!box) return;
  const isHidden = box.style.display === "none";
  box.style.display = isHidden ? "flex" : "none";
  if (isHidden) {
    const input = document.getElementById("ai-chat-input");
    if (input) input.focus();
  }
}

function sendChatQuery(text) {
  const input = document.getElementById("ai-chat-input");
  if (input) {
    input.value = text;
    handleUserChatSubmit();
  }
}

function handleUserChatSubmit() {
  const input = document.getElementById("ai-chat-input");
  const messages = document.getElementById("ai-chat-messages");
  if (!input || !messages) return;

  const query = input.value.trim();
  if (!query) return;

  // Append user message
  const userMsg = document.createElement("div");
  userMsg.className = "ai-msg user";
  userMsg.textContent = query;
  messages.appendChild(userMsg);
  input.value = "";
  messages.scrollTop = messages.scrollHeight;

  // Generate Smart Bot Response
  setTimeout(() => {
    const botMsg = document.createElement("div");
    botMsg.className = "ai-msg bot";
    botMsg.innerHTML = getSmartBotResponse(query);
    messages.appendChild(botMsg);
    messages.scrollTop = messages.scrollHeight;
  }, 350);
}

function getSmartBotResponse(q) {
  const lower = q.toLowerCase();
  const tgUser = String(STORE.telegramUsername || "MansiJewellery").replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");

  if (lower.includes("delivery") || lower.includes("cod") || lower.includes("ship") || lower.includes("time") || lower.includes("raipur")) {
    return `🚚 <strong>Delivery & COD Information:</strong><br/>
    • Delivery zone and charge are calculated from your checkout address.<br/>
    • <strong>Cash on Delivery (COD)</strong> and configured UPI options appear at checkout.<br/>
    • The store confirms dispatch timing after the order is placed.`;
  }

  if (lower.includes("track") || lower.includes("order") || lower.includes("status") || lower.includes("where")) {
    return `📦 <strong>Order Tracking & Status:</strong><br/>
    You can view and track all your orders anytime from your <a href="orders.html" style="color:var(--primary);font-weight:700;">📦 My Orders Page</a>.<br/>
    You can also track instantly on Telegram by messaging <a href="https://t.me/${tgUser}" target="_blank" style="color:#0088cc;font-weight:700;">@${tgUser}</a>.`;
  }

  if (lower.includes("offer") || lower.includes("coupon") || lower.includes("discount") || lower.includes("code") || lower.includes("deal")) {
    return `🎉 <strong>Current Offers:</strong><br/>
    Any active offer is shown in the store banner and reflected in the final checkout total. We do not apply hidden or unverified coupon claims.`;
  }

  if (lower.includes("price") || lower.includes("product") || lower.includes("jewel") || lower.includes("cosmetic") || lower.includes("item")) {
    const prices = DB.getProducts().map(product => Number(product.price)).filter(price => Number.isFinite(price) && price >= 0);
    const range = prices.length ? `<strong>₹${Math.min(...prices)} to ₹${Math.max(...prices)}</strong>` : "shown on each product";
    return `💎 <strong>Our Collections & Price Range:</strong><br/>
    Current catalogue prices are ${range}.<br/>
    👉 Browse all collections on our <a href="products.html" style="color:var(--primary);font-weight:700;">🛍️ Collections Page</a>.`;
  }

  if (lower.includes("owner") || lower.includes("human") || lower.includes("contact") || lower.includes("talk") || lower.includes("telegram") || lower.includes("whatsapp") || lower.includes("phone")) {
    return `✈️ <strong>Direct Live Support:</strong><br/>
    Connect directly with the store owner for live product photos or custom queries:<br/><br/>
    <a href="https://t.me/${tgUser}" target="_blank" style="background:#0088cc;color:#fff;padding:8px 16px;border-radius:10px;display:inline-block;font-weight:700;text-decoration:none;">
      ✈️ Chat on Telegram (@${tgUser})
    </a>`;
  }

  return `😊 Thank you for asking! I can help you with:<br/>
  • 🚚 Delivery & Shipping Times<br/>
  • 📦 Order Tracking & Status<br/>
  • 💰 Coupon Codes & Discounts<br/>
  • 💎 Product Prices & Stock<br/><br/>
  Or chat directly with our store team on <a href="https://t.me/${tgUser}" target="_blank" style="color:#0088cc;font-weight:700;">Telegram @${tgUser}</a>!`;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChatbotWidget);
} else {
  initChatbotWidget();
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    const appScript = Array.from(document.scripts).find(script => /\/js\/app\.js(?:\?|$)/.test(script.src));
    const root = appScript ? new URL("../", appScript.src) : new URL("./", document.baseURI);
    navigator.serviceWorker.register(new URL("sw.js", root)).catch(error => {
      console.warn("PWA service worker registration skipped:", error.message);
    });
  });
}

// Auto-position Store Assistant button — uses MutationObserver instead of setInterval
// so it never burns CPU polling on an empty function call every second.
(function positionAssistantWidgets() {
  function adjustPosition() {
    const aiBtn = document.querySelector('.ai-chat-btn');
    if (aiBtn && aiBtn.style) {
      aiBtn.style.setProperty('bottom', '100px', 'important');
      aiBtn.style.setProperty('right', '24px', 'important');
      aiBtn.style.setProperty('z-index', '99990', 'important');
    }
  }

  // Run once on ready events
  window.addEventListener('load', adjustPosition, { once: true });
  document.addEventListener('DOMContentLoaded', adjustPosition, { once: true });

  // Watch for the button being dynamically inserted
  const observer = new MutationObserver(() => {
    if (document.querySelector('.ai-chat-btn')) {
      adjustPosition();
      observer.disconnect();
    }
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: false });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: false });
    }, { once: true });
  }
})();

