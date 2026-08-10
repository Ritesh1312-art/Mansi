"use strict";

const TOKEN = "870ceb61d8a2f0d50a9c";

module.exports = function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.statusCode = 405;
    return res.end();
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.setHeader("Content-Length", String(Buffer.byteLength(TOKEN)));
  res.statusCode = 200;
  return res.end(req.method === "HEAD" ? undefined : TOKEN);
};
