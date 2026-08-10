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

    // If password was passed as first arg (single-password login) or email was provided:
    let inputEmail = email;
    let inputPass = password;
    if (!inputPass && inputEmail) {
      inputPass = inputEmail;
      inputEmail = "";
    }

    const candidateEmails = Array.from(new Set([
      String(inputEmail || "").trim(),
      String(window.STORE?.email || "").trim(),
      "mansialwani5@gmail.com",
      "riteshart1312@gmail.com"
    ])).filter(Boolean);

    let lastError = null;
    for (const candidate of candidateEmails) {
      try {
        await fbAuth.signInWithEmailAndPassword(candidate, String(inputPass || ""));
        const session = await authorizedUser();
        if (session) return session.user;
      } catch (err) {
        lastError = err;
      }
    }
    if (fbAuth.currentUser) await fbAuth.signOut();
    throw lastError || new Error("Incorrect Admin Password. Please check your password.");
  }


  async function logout() {
    if (fbAuth) await fbAuth.signOut();
    localStorage.removeItem("adminAuth");
  }

  window.AdminSession = { authorizedUser, requireAdminPage, login, logout };
})();
