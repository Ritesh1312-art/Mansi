// =============================================
// MANSI STORE — FAIL-SAFE WATCHDOG MONITOR
// Core Rule: Read-Only Audit, Zero Silent Mutations,
// Always Owner-Approved Alerts.
// =============================================

const Watchdog = {
  // Storage keys
  KEY_BASELINE: "watchdog_baseline_count",
  KEY_LAST_ALERT: "watchdog_last_alert_time",
  KEY_LAST_CHECK: "watchdog_last_check_time",
  KEY_STATUS: "watchdog_status",

  // Drop ratio threshold for warnings (50% drop)
  DROP_RATIO_ALERT: 0.5,

  // Rate-limiting alert interval (ms) — max 1 alert per 2 hours unless forced
  ALERT_INTERVAL_MS: 2 * 60 * 60 * 1000,

  /**
   * Get the recorded highest valid baseline product count
   */
  getBaseline() {
    const b = parseInt(localStorage.getItem(this.KEY_BASELINE));
    if (b && !isNaN(b) && b > 0) return b;
    return 10;
  },

  /**
   * Update the baseline count when legitimate additions occur
   */
  updateBaseline(newCount) {
    if (typeof newCount === 'number' && newCount > 0) {
      const current = this.getBaseline();
      if (newCount > current || current === 10) {
        localStorage.setItem(this.KEY_BASELINE, newCount.toString());
        console.log(`[Watchdog] 📈 Updated baseline count to ${newCount}`);
      }
    }
  },

  /**
   * Perform a Read-Only Health Inspection on the store catalog
   */
  inspect() {
    const timestamp = new Date().toISOString();
    localStorage.setItem(this.KEY_LAST_CHECK, timestamp);

    let products = [];
    try {
      products = DB.getProducts();
    } catch(e) {
      console.error("[Watchdog] Could not retrieve products:", e);
    }

    const baseline = this.getBaseline();
    const count = Array.isArray(products) ? products.length : 0;

    // Update baseline if count increased legitimately
    if (count > baseline) {
      this.updateBaseline(count);
    }

    const issues = [];
    let status = "HEALTHY";

    // Check 1: Severe Product Wipeout (0 products)
    if (count === 0) {
      status = "ALERT";
      issues.push(`🛑 CRITICAL: Product count dropped to 0! (Expected baseline: ${baseline})`);
    } 
    // Check 2: Unusually large data drop
    else if (count < Math.ceil(baseline * this.DROP_RATIO_ALERT)) {
      status = "WARNING";
      issues.push(`⚠️ WARNING: Product count dropped from ${baseline} to ${count}.`);
    }

    // Check 3: Data Schema Integrity (Missing name, price, or ID)
    let corruptedItems = 0;
    if (Array.isArray(products)) {
      products.forEach((p) => {
        if (!p || typeof p !== 'object' || !p.name || typeof p.price !== 'number' || isNaN(p.price)) {
          corruptedItems++;
        }
      });
    }

    if (corruptedItems > 0) {
      if (status !== "ALERT") status = "WARNING";
      issues.push(`⚠️ DATA CORRUPTION: ${corruptedItems} item(s) have invalid name or price.`);
    }

    const report = {
      status,
      productCount: count,
      baselineCount: this.getBaseline(),
      corruptedItems,
      issues,
      timestamp
    };

    localStorage.setItem(this.KEY_STATUS, JSON.stringify(report));
    return report;
  },

  /**
   * Send a safe alert notification to Telegram
   */
  async sendTelegramAlert(report, force = false) {
    const token = (STORE.telegramBotToken || "").trim();
    const chatId = (STORE.telegramChatId || "").trim();

    if (!token || !chatId) {
      console.warn("[Watchdog] Telegram token or chatId missing.");
      return { success: false, reason: "Missing bot token or chat ID" };
    }

    // Rate Limiting Check
    const lastAlert = parseInt(localStorage.getItem(this.KEY_LAST_ALERT) || "0");
    const now = Date.now();
    if (!force && (now - lastAlert < this.ALERT_INTERVAL_MS)) {
      console.log("[Watchdog] Alert suppressed by rate limiter.");
      return { success: false, reason: "Rate limited" };
    }

    const isHealthy = report.status === "HEALTHY";
    const emoji = isHealthy ? "🟢" : (report.status === "WARNING" ? "⚠️" : "🛑");
    
    const message = [
      `${emoji} *MANSI STORE WATCHDOG REPORT* ${emoji}`,
      `*Status:* ${report.status}`,
      `*Current Products:* ${report.productCount}`,
      `*Baseline Target:* ${report.baselineCount}`,
      `*Timestamp:* ${new Date().toLocaleString("en-IN")}`,
      "",
      report.issues.length > 0 ? "*Issues Detected:*" : "✅ All store systems running smoothly.",
      ...report.issues.map(i => `• ${i}`),
      "",
      isHealthy 
        ? "✨ Store catalog is safe and intact." 
        : "⚠️ *No automatic changes were made to your store.*\nTo inspect or restore, open Admin Dashboard or pull from Google Sheets Master CSV."
    ].join("\n");

    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown"
        })
      });
      const resData = await response.json();
      if (resData.ok) {
        localStorage.setItem(this.KEY_LAST_ALERT, now.toString());
        console.log("[Watchdog] 📲 Telegram alert sent successfully.");
        return { success: true };
      } else {
        return { success: false, reason: resData.description };
      }
    } catch(e) {
      console.error("[Watchdog] Telegram alert failed:", e);
      return { success: false, reason: e.message };
    }
  },

  /**
   * Checks if 9 AM or 9 PM scheduled report needs to be sent
   */
  async checkScheduledReport() {
    const now = new Date();
    const hour = now.getHours();
    const dateStr = now.toISOString().split('T')[0];

    let slot = null;
    if (hour === 9) slot = "9AM";
    if (hour === 21) slot = "9PM";

    if (slot) {
      const slotKey = `watchdog_scheduled_${dateStr}_${slot}`;
      if (!localStorage.getItem(slotKey)) {
        console.log(`[Watchdog] ⏰ Triggering scheduled ${slot} Telegram health report...`);
        const report = this.inspect();
        const res = await this.sendTelegramAlert(report, true);
        if (res.success) {
          localStorage.setItem(slotKey, "sent");
        }
      }
    }
  },

  /**
   * Run non-blocking health check on app startup
   */
  async runHealthCheck() {
    try {
      const report = this.inspect();
      console.log(`[Watchdog] Health Check Status: ${report.status} (${report.productCount}/${report.baselineCount} products)`);

      // 1. Scheduled 9 AM & 9 PM report check
      await this.checkScheduledReport();

      // 2. Only alert on emergency warnings if count drops
      if (report.status === "WARNING" || report.status === "ALERT") {
        await this.sendTelegramAlert(report, false);
      }
      return report;
    } catch (e) {
      console.error("[Watchdog] Health check exception:", e);
      return null;
    }
  }
};

// Expose globally
window.Watchdog = Watchdog;
