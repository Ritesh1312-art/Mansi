// =============================================
// MANSI STORE — CLIENT CATALOG HEALTH MONITOR
// Read-only. Zero mutations. No credentials in the browser.
// Owner-facing Telegram alerts are handled securely server-side
// by the scheduled cron watchdog at /api/cron/watchdog.
// =============================================

const Watchdog = {
  KEY_BASELINE: "watchdog_baseline_count",
  KEY_LAST_CHECK: "watchdog_last_check_time",
  KEY_STATUS: "watchdog_status",

  // Warn if the live catalog drops below 50% of the recorded baseline.
  DROP_RATIO_ALERT: 0.5,

  getBaseline() {
    const b = parseInt(localStorage.getItem(this.KEY_BASELINE), 10);
    return (b && !isNaN(b) && b > 0) ? b : 10;
  },

  updateBaseline(newCount) {
    if (typeof newCount === "number" && newCount > 0) {
      const current = this.getBaseline();
      if (newCount > current || current === 10) {
        localStorage.setItem(this.KEY_BASELINE, String(newCount));
      }
    }
  },

  // Read-only inspection of the current catalog. Never mutates products.
  inspect() {
    const timestamp = new Date().toISOString();
    localStorage.setItem(this.KEY_LAST_CHECK, timestamp);

    let products = [];
    try {
      products = (window.DB && typeof DB.getProducts === "function") ? DB.getProducts() : [];
    } catch (e) {
      console.error("[Watchdog] Could not read products:", e);
    }

    const baseline = this.getBaseline();
    const count = Array.isArray(products) ? products.length : 0;
    if (count > baseline) this.updateBaseline(count);

    const issues = [];
    let status = "HEALTHY";

    if (count === 0) {
      status = "ALERT";
      issues.push("Product count is 0 (expected around " + baseline + ").");
    } else if (count < Math.ceil(baseline * this.DROP_RATIO_ALERT)) {
      status = "WARNING";
      issues.push("Product count dropped from " + baseline + " to " + count + ".");
    }

    let corrupted = 0;
    if (Array.isArray(products)) {
      products.forEach(p => {
        if (!p || typeof p !== "object" || !p.name || typeof p.price !== "number" || isNaN(p.price)) corrupted++;
      });
    }
    if (corrupted > 0) {
      if (status !== "ALERT") status = "WARNING";
      issues.push(corrupted + " item(s) have an invalid name or price.");
    }

    const report = {
      status,
      productCount: count,
      baselineCount: this.getBaseline(),
      corruptedItems: corrupted,
      issues,
      timestamp
    };
    try { localStorage.setItem(this.KEY_STATUS, JSON.stringify(report)); } catch (e) {}
    return report;
  },

  getStatus() {
    try { return JSON.parse(localStorage.getItem(this.KEY_STATUS) || "null"); }
    catch (e) { return null; }
  },

  // Optionally paint the status into #watchdog-health-badge if a page provides it.
  renderBadge(report) {
    const el = document.getElementById("watchdog-health-badge");
    if (!el || !report) return;
    const map = {
      HEALTHY: ["🟢", "var(--success, #16a34a)"],
      WARNING: ["⚠️", "var(--accent, #d97706)"],
      ALERT: ["🛑", "var(--error, #dc2626)"]
    };
    const [icon, color] = map[report.status] || map.HEALTHY;
    el.textContent = icon + " Catalog " + report.status + " · " + report.productCount + " products";
    el.style.color = color;
    el.title = report.issues.length ? report.issues.join(" ") : "Catalog is healthy.";
  },

  runHealthCheck() {
    try {
      const report = this.inspect();
      this.renderBadge(report);
      const method = report.status === "HEALTHY" ? "log" : "warn";
      console[method]("[Watchdog] " + report.status + " — " + report.productCount + "/" + report.baselineCount + " products");
      return report;
    } catch (e) {
      console.error("[Watchdog] Health check exception:", e);
      return null;
    }
  }
};

window.Watchdog = Watchdog;

// Auto-run a read-only health check on load and whenever the live catalog syncs.
(function scheduleWatchdog() {
  window.addEventListener("productsSynced", () => Watchdog.runHealthCheck());
  const kickoff = () => setTimeout(() => Watchdog.runHealthCheck(), 800);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kickoff);
  } else {
    kickoff();
  }
})();
