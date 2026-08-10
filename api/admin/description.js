"use strict";

const { requireAdmin } = require("../_lib/auth");
const { send, sendError, readJson, methodNotAllowed, withErrorHandler } = require("../_lib/http");

module.exports = withErrorHandler(async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  
  await requireAdmin(req);
  const body = await readJson(req);
  
  const productName = String(body.name || "").trim();
  const category = String(body.category || "").trim();
  const prompt = String(body.prompt || "").trim() || `Write a compelling 2-3 sentence e-commerce description for a product named "${productName}" in the category "${category}". Highlight quality, elegance, and customer appeal for an Indian online store.`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendError(res, 503, "GEMINI_API_KEY is not configured on the server");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    return sendError(res, 502, "Gemini API request failed", { status: response.status, errorText });
  }

  const data = await response.json();
  const description = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  
  return send(res, 200, { ok: true, description });
});
