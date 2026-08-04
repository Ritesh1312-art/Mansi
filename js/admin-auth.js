(function () {
  "use strict";

  async function authorizedUser() {
    const user = await DB.waitForAuthState();
    if (!user) return null;
    try {
      await StoreApi.adminSession();
      localStorage.setItem("adminAuth", "firebase");
      return user;
    } catch (_) {
      await fbAuth.signOut();
      localStorage.removeItem("adminAuth");
      return null;
    }
  }

  async function login(email, password) {
    await DB.waitForFirebase();
    if (!fbAuth) throw new Error("Firebase Auth is unavailable");
    await fbAuth.signInWithEmailAndPassword(String(email || "").trim(), String(password || ""));
    const user = await authorizedUser();
    if (!user) throw new Error("This Firebase account is not authorized as an admin");
    return user;
  }

  async function logout() {
    if (fbAuth) await fbAuth.signOut();
    localStorage.removeItem("adminAuth");
  }

  window.AdminSession = { authorizedUser, login, logout };
})();
