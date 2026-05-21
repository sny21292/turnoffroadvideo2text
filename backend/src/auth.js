const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_TTL = "7d";

function sign(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email };
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const normalized = String(email).trim().toLowerCase();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalized);
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  return res.json({ token: sign(user), user: publicUser(user) });
});

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

router.get("/me", authMiddleware, (req, res) => {
  const u = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(req.user.id);
  if (!u) return res.status(404).json({ error: "User not found." });
  res.json({ user: publicUser(u) });
});

module.exports = { router, authMiddleware };
