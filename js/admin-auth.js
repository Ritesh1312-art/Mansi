(function () {
  "use strict";

  async function authorizedUser() {
    await DB.waitForFirebase();
    if (fbAuth) {
      const user = fbAuth.currentUser || (typeof DB.waitForAuthState === "function" ? await DB.waitForAuthState() : null);
      if (user) {
        try {
          const token = await user.getIdToken();
          const res = await fetch("/api/admin/session", {
            headers: { "Authorization": "Bearer " + token }
          });
          if (res.ok) {
            const data = await res.json();
            if (data && data.ok) {
              localStorage.setItem("adminAuth", "firebase");
              return { user, token, adminData: data };
            }
          }
        } catch (e) {
          console.warn("[AdminSession] Backend verification warning:", e.message);
        }
      }
    }
    if (localStorage.getItem("adminAuth") === "master" || localStorage.getItem("adminAuth") === "firebase") {
      return { user: { email: "mansialwani5@gmail.com", uid: "admin_master" }, token: "master_token", adminData: { ok: true } };
    }
    return null;
  }

  async function requireAdminPage() {
    const session = await authorizedUser();
    if (!session) {
      localStorage.removeItem("adminAuth");
      const isSubdir = window.location.pathname.includes("/admin/");
      const loginUrl = isSubdir ? "index.html?auth_required=1" : "admin/index.html?auth_required=1";
      if (!window.location.pathname.endsWith("index.html") && !window.location.pathname.endsWith("/admin/")) {
        window.location.href = loginUrl;
      }
      return null;
    }
    return session;
  }

  async function login(email, password) {
    await DB.waitForFirebase();

    let inputEmail = email;
    let inputPass = password;
    if (!inputPass && inputEmail) {
      inputPass = inputEmail;
      inputEmail = "";
    }
    const pwd = String(inputPass || "").trim();

    const candidateEmails = Array.from(new Set([
      String(inputEmail || "").trim(),
      String(window.STORE?.email || "").trim(),
      "mansialwani5@gmail.com",
      "riteshart1312@gmail.com"
    ])).filter(Boolean);

    let lastError = null;

    if (fbAuth) {
      for (const candidate of candidateEmails) {
        // 1. Try normal signIn
        try {
          await fbAuth.signInWithEmailAndPassword(candidate, pwd);
          const session = await authorizedUser();
          if (session) return session.user;
        } catch (err) {
          lastError = err;
          // 2. If user doesn't exist yet in Firebase Auth, auto-create admin account with this password!
          if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential" || err.code === "auth/invalid-email") {
            try {
              await fbAuth.createUserWithEmailAndPassword(candidate, pwd);
              const session = await authorizedUser();
              if (session) return session.user;
            } catch (_) {}
          }
        }
      }
    }

    // Master password fallback check for "mansi@admin123" or legacy password
    if (pwd === "mansi@admin123" || pwd === "admin123" || pwd === "mansiadmin") {
      localStorage.setItem("adminAuth", "master");
      return { email: "mansialwani5@gmail.com", uid: "admin_master" };
    }

    if (fbAuth && fbAuth.currentUser) await fbAuth.signOut();
    throw lastError || new Error("Incorrect Admin Password. Please enter valid password.");
  }



  async function logout() {
    if (fbAuth) await fbAuth.signOut();
    localStorage.removeItem("adminAuth");
  }

  window.AdminSession = { authorizedUser, requireAdminPage, login, logout };
})();
