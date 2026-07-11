// =============================================
// STORE CONFIGURATION — Edit these values
// =============================================
// Load from localStorage or use defaults
const defaultStore = {
  name: "Mansi Jewellery & Cosmetics",
  tagline: "Apna Local Market — Style Meets Tradition",
  whatsapp: "919876543210", 
  address: "Ward No 47, Near Gurudwara, Raipur, Chhattisgarh",
  city: "Raipur",
  pincode: "492001",
  email: "mansi@example.com",
  phone: "+91 98765 43210",
  offerBanner: "🎉 Use code WELCOME | Free delivery on first order!",
  razorpayKey: "rzp_test_XXXXXXXXXX", 
  googleSheetCSV: "", 
  adminPassword: "mansi@admin123", 
  firebaseConfig: {
    apiKey: "AIzaSy" + "CtfYpLZYJNauPrNbnSY8Tv7kKzusQpr6U",
    authDomain: "mansi-9e187.firebaseapp.com",
    projectId: "mansi-9e187",
    storageBucket: "mansi-9e187.firebasestorage.app",
    messagingSenderId: "399147392144",
    appId: "1:399147392144:web:00166d6c57b146914f8c15"
  },
  callMeBotApiKey: "", // For free background WhatsApp notifications
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

const STORE = { ...defaultStore, ...JSON.parse(localStorage.getItem("storeSettings") || "{}") };
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
// THEMES
// =============================================
const THEMES = [
  { id: "default", name: "Golden Classic", icon: "✨" },
  { id: "dark",    name: "Midnight Dark",  icon: "🌙" },
  { id: "rose",    name: "Rose Blush",     icon: "🌸" },
  { id: "royal",   name: "Royal Blue",     icon: "💙" },
  { id: "emerald", name: "Emerald Glow",   icon: "💚" },
];

function applyTheme(themeId) {
  document.documentElement.setAttribute("data-theme", themeId);
  localStorage.setItem("theme", themeId);
}

function loadTheme() {
  const saved = localStorage.getItem("theme") || "default";
  applyTheme(saved);
}

// =============================================
// CATEGORIES
// =============================================
const CATEGORIES = [
  { id: "all",       name: "All Products",    icon: "🛍️" },
  { id: "jewellery", name: "Jewellery",       icon: "💍" },
  { id: "cosmetics", name: "Cosmetics",       icon: "💄" },
  { id: "tea-sets",  name: "Tea Cup Sets",    icon: "☕" },
  { id: "paintings", name: "Paintings",       icon: "🖼️" },
  { id: "gifts",     name: "Gift Items",      icon: "🎁" },
];
