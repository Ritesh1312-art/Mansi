// =============================================
// STORE CONFIGURATION — Edit these values
// =============================================
const defaultStore = {
  name: "Mansi Jewellery & Cosmetics",
  tagline: "Apna Local Market — Style Meets Tradition",
  address: "Ward No 47, Near Gurudwara, Raipur, Chhattisgarh",
  city: "Raipur",
  pincode: "492001",
  email: "mansialwani5@gmail.com",
  phone: "+91 98765 43210",
  offerBanner: "✨ Browse our latest jewellery and cosmetics collection",
  googleSheetCSV: "",
  googleSheet: {
    spreadsheetId: "1YPOM0mE6hBYnhco-JKhKohSkbhIVCx2abB2HKTEkmss",
    productSheet: "Products",
    productSheetId: 1836818113
  },
  apiBase: "",
  firebaseConfig: {
    apiKey: "AIzaSy" + "CtfYpLZYJNauPrNbnSY8Tv7kKzusQpr6U",
    authDomain: "mansi-9e187.firebaseapp.com",
    projectId: "mansi-9e187",
    storageBucket: "mansi-9e187.firebasestorage.app",
    messagingSenderId: "399147392144",
    appId: "1:399147392144:web:00166d6c57b146914f8c15"
  },
  telegramUsername: "MansiJewellery",
  gpayUpi: "",
  phonepeUpi: "",
  paytmUpi: "",
};

const defaultDelivery = {
  sameCity:     { prepaid: 50,  cod: 95  },
  sameState:    { prepaid: 80,  cod: 125 },
  nearbyStates: { prepaid: 120, cod: 165 },
  restOfIndia:  { prepaid: 150, cod: 195 },
};

let storedSettings = {};
try { storedSettings = JSON.parse(localStorage.getItem("storeSettings") || "{}"); } catch (_) {}
const STORE = {
  ...defaultStore,
  ...storedSettings,
  firebaseConfig: { ...defaultStore.firebaseConfig },
  googleSheet: { ...defaultStore.googleSheet }
};
const DELIVERY = { ...defaultDelivery, ...JSON.parse(localStorage.getItem("deliverySettings") || "{}") };

// =============================================
// PINCODE ZONE DETECTION
// =============================================
function getDeliveryZone(pincode) {
  const p = pincode.toString().trim();
  if (p.length !== 6 || isNaN(p)) return null;

  // Raipur — Same City
  const raipurPins = [
    "492001","492002","492003","492004","492005","492006",
    "492007","492008","492009","492010","492012","492013",
    "492015","492099","492101","492109"
  ];
  if (raipurPins.includes(p)) return "sameCity";

  // Chhattisgarh — starts with 49
  if (p.startsWith("49")) return "sameState";

  // Nearby States: MP (45-48), Odisha (75-77), Jharkhand (82-83), UP (20-28), Telangana (50)
  const nearbyPrefixes = ["45","46","47","48","75","76","77","82","83","20","21","22","23","24","25","26","27","28","50","51","52","53"];
  if (nearbyPrefixes.some(prefix => p.startsWith(prefix))) return "nearbyStates";

  return "restOfIndia";
}

function getDeliveryCharges(pincode, paymentMode = "prepaid") {
  const zone = getDeliveryZone(pincode);
  if (!zone) return null;
  const charges = DELIVERY[zone];
  return {
    zone,
    charge: paymentMode === "cod" ? charges.cod : charges.prepaid,
    prepaid: charges.prepaid,
    cod: charges.cod,
    label: { sameCity: "Same City (Raipur)", sameState: "Chhattisgarh", nearbyStates: "Nearby States", restOfIndia: "All India" }[zone],
    days: { sameCity: "1-2 days", sameState: "2-3 days", nearbyStates: "3-5 days", restOfIndia: "5-7 days" }[zone]
  };
}

// =============================================
// THEMES — 15 Vibrant Presets + Custom Theme
// =============================================
const THEMES = [
  { id: "default",   name: "Golden Classic", icon: "✨" },
  { id: "dark",      name: "Obsidian Dark",  icon: "🌙" },
  { id: "rose",      name: "Rose Blush",     icon: "🌸" },
  { id: "royal",     name: "Royal Blue",     icon: "💙" },
  { id: "emerald",   name: "Royal Violet",   icon: "💜" },
  { id: "cyberpunk", name: "Cyber Neon",     icon: "⚡" },
  { id: "sunset",    name: "Sunset Orange",  icon: "🌅" },
  { id: "forest",    name: "Emerald Forest", icon: "🌲" },
  { id: "sapphire",  name: "Sapphire Glow",  icon: "💎" },
  { id: "lavender",  name: "Lavender Dream", icon: "🍇" },
  { id: "dracula",   name: "Dracula Purple", icon: "🧛" },
  { id: "coffee",    name: "Warm Mocha",     icon: "☕" },
  { id: "neongold",  name: "Luxury Gold",    icon: "👑" },
  { id: "retro",     name: "Retro Wave",     icon: "🌆" },
  { id: "custom",    name: "Custom Theme",   icon: "🎨" },
];

function applyTheme(themeId, customColors = null) {
  document.documentElement.setAttribute("data-theme", themeId);
  localStorage.setItem("theme", themeId);

  if (themeId === "custom") {
    const savedCustom = customColors || JSON.parse(localStorage.getItem("customTheme") || "{}");
    if (savedCustom.primary) {
      document.documentElement.style.setProperty("--primary", savedCustom.primary);
      document.documentElement.style.setProperty("--primary-dark", savedCustom.primaryDark || savedCustom.primary);
      document.documentElement.style.setProperty("--primary-light", savedCustom.primaryLight || "#1F1F2A");
      document.documentElement.style.setProperty("--bg", savedCustom.bg || "#121218");
      document.documentElement.style.setProperty("--bg-card", savedCustom.card || "#1A1A24");
      document.documentElement.style.setProperty("--text", savedCustom.text || "#FFFFFF");
      document.documentElement.style.setProperty("--text-muted", savedCustom.textMuted || "#A0A0B0");
      document.documentElement.style.setProperty("--border", savedCustom.border || "#2A2A38");
      localStorage.setItem("customTheme", JSON.stringify(savedCustom));
    }
  } else {
    // Reset custom properties
    const customProps = ["--primary", "--primary-dark", "--primary-light", "--bg", "--bg-card", "--text", "--text-muted", "--border"];
    customProps.forEach(prop => document.documentElement.style.removeProperty(prop));
  }
}

function loadTheme() {
  const saved = localStorage.getItem("theme") || "default";
  applyTheme(saved);
}

// Auto-run loadTheme so every page applies theme immediately
try { loadTheme(); } catch(e) {}

// =============================================
// CATEGORIES
// =============================================
const CATEGORIES = [
  { id: "all",       name: "All Products",    icon: "🛍️" },
  { id: "jewellery", name: "Jewellery",       icon: "💍" },
  { id: "cosmetics", name: "Cosmetics",       icon: "💄" },
  { id: "paintings", name: "Paintings",       icon: "🖼️" },
  { id: "gifts",     name: "Gift Items",      icon: "🎁" }
];

// =============================================
// ALL 36 INDIAN STATES & UNION TERRITORIES
// =============================================
const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry"
];
