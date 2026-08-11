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
    // A browser flag is never proof of admin access. Only a Firebase ID token
    // accepted by the server may unlock an admin page.
    localStorage.removeItem("adminAuth");
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

    const candidateEmail = String(inputEmail || window.STORE?.email || "").trim();
    if (!candidateEmail) throw new Error("Admin email is required.");

    let lastError = null;

    if (!fbAuth) throw new Error("Secure admin login is temporarily unavailable.");
    try {
      await fbAuth.signInWithEmailAndPassword(candidateEmail, pwd);
      const session = await authorizedUser();
      if (session) return session.user;
      throw new Error("This account is not authorized for admin access.");
    } catch (err) {
      lastError = err;
    }

    if (fbAuth && fbAuth.currentUser) await fbAuth.signOut();
    localStorage.removeItem("adminAuth");
    throw lastError || new Error("Incorrect admin credentials.");
  }



  async function logout() {
    if (fbAuth) await fbAuth.signOut();
    localStorage.removeItem("adminAuth");
  }

  window.AdminSession = { authorizedUser, requireAdminPage, login, logout };
})();
