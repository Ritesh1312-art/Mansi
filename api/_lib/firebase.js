"use strict";

const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

function parseServiceAccount(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  } catch (e) {
    console.warn("[Firebase Admin] Service account JSON parse warning:", e.message);
    return null;
  }
}

function getFirebaseApp() {
  if (getApps().length) return getApps()[0];
  const serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!serviceAccount) return null;
  try {
    return initializeApp({
      credential: cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "mansi-9e187.firebasestorage.app"
    });
  } catch (e) {
    console.error("[Firebase Admin] App initialization error:", e.message);
    return null;
  }
}

function services() {
  try {
    const app = getFirebaseApp();
    if (!app) {
      return {
        app: null,
        auth: null,
        db: null,
        storage: null,
        isConfigured: false,
        error: "FIREBASE_SERVICE_ACCOUNT_JSON is not configured or invalid"
      };
    }
    return {
      app,
      auth: getAuth(app),
      db: getFirestore(app),
      storage: getStorage(app),
      isConfigured: true,
      error: null
    };
  } catch (err) {
    return {
      app: null,
      auth: null,
      db: null,
      storage: null,
      isConfigured: false,
      error: err.message
    };
  }
}

module.exports = { services, parseServiceAccount, getFirebaseApp };
