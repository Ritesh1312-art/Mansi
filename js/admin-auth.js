(function () {
  "use strict";

  async function authorizedUser() {
    await DB.waitForFirebase();
    if (!fbAuth) return null;
    const user = fbAuth.currentUser || await DB.waitForAuthState();
    if (!user) return null;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/session", {
        headers: { "Authorization": "Bearer " + token }
      });
      if (!res.ok) throw new Error("Server unauthorized");
      const data = await res.json();
      if (!data || !data.ok) throw new Error("Session verification failed");
      localStorage.setItem("adminAuth", "firebase");
      return { user, token, adminData: data };
    } catch (e) {
      console.warn("[AdminSession] Backend authorization verification failed:", e.message);
      localStorage.removeItem("adminAuth");
      return null;
    }
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
    if (!fbAuth) throw new Error("Firebase Auth is unavailable");
    await fbAuth.signInWithEmailAndPassword(String(email || "").trim(), String(password || ""));
    const session = await authorizedUser();
    if (!session) {
      if (fbAuth) await fbAuth.signOut();
      throw new Error("This account is not authorized as an administrative user on the server");
    }
    return session.user;
  }

  async function logout() {
    if (fbAuth) await fbAuth.signOut();
    localStorage.removeItem("adminAuth");
  }

  window.AdminSession = { authorizedUser, requireAdminPage, login, logout };
})();
