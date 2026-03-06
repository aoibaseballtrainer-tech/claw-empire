import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, createHash, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// User Auth — Email + Password login for app.prost-ai.com
// ---------------------------------------------------------------------------

interface RegisterUserAuthRoutesOptions {
  app: Express;
  db: DatabaseSync;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const USER_SESSION_COOKIE = "claw_user";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;

type UserRole = "admin" | "operator";

const ALLOWED_USERS: { email: string; name: string; role: UserRole }[] = [
  { email: "okuda@prost-mark.com", name: "Okuda", role: "operator" },
  { email: "tanaka@prost-mark.com", name: "Tanaka", role: "operator" },
  { email: "oka@prost-mark.com", name: "Oka", role: "operator" },
  { email: "nishiwaki@prost-mark.com", name: "Nishiwaki", role: "operator" },
  { email: "ogawa@prost-mark.com", name: "Ogawa", role: "admin" },
  { email: "info@prost-mark.com", name: "Info", role: "operator" },
];

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  const a = Buffer.from(derived, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// CSRF token for user sessions
// ---------------------------------------------------------------------------
export function userSessionCsrfToken(sessionToken: string): string {
  return createHash("sha256").update(`user_csrf:${sessionToken}`, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Session helpers (exported for auth.ts)
// ---------------------------------------------------------------------------
let _db: DatabaseSync | null = null;

export function setUserAuthDb(db: DatabaseSync): void {
  _db = db;
}

export function lookupUserSession(token: string): { email: string; name: string; role: string } | null {
  if (!_db || !token) return null;
  try {
    const row = _db
      .prepare("SELECT s.email, u.name, u.role FROM app_sessions s JOIN app_users u ON s.email = u.email WHERE s.token = ? AND s.expires_at > ?")
      .get(token, Math.floor(Date.now() / 1000)) as { email: string; name: string; role: string } | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

export function getUserSessionCookie(req: Request): string | null {
  const raw = req.header("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== USER_SESSION_COOKIE) continue;
    const value = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------
function initTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_users (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator',
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL
    )
  `);

  // Migration: add role column if missing (existing DB)
  try {
    const cols = db.prepare("PRAGMA table_info(app_users)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "role")) {
      db.exec("ALTER TABLE app_users ADD COLUMN role TEXT NOT NULL DEFAULT 'operator'");
      // Set ogawa as admin
      db.prepare("UPDATE app_users SET role = 'admin' WHERE email = ?").run("ogawa@prost-mark.com");
      console.log("✅ Migrated app_users: added role column");
    }
  } catch {
    // ignore migration errors
  }
}

function generatePassword(): string {
  // Generate a readable 12-char password
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  let pw = "";
  for (let i = 0; i < 12; i++) {
    pw += chars[bytes[i]! % chars.length];
  }
  return pw;
}

function seedUsers(db: DatabaseSync): void {
  const existingCount = (
    db.prepare("SELECT COUNT(*) as cnt FROM app_users").get() as { cnt: number }
  ).cnt;

  if (existingCount > 0) return;

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║       🔑  Initial User Credentials                  ║");
  console.log("╠══════════════════════════════════════════════════════╣");

  for (const user of ALLOWED_USERS) {
    const password = generatePassword();
    const hash = hashPassword(password);
    db.prepare("INSERT OR IGNORE INTO app_users (email, password_hash, name, role) VALUES (?, ?, ?, ?)").run(
      user.email,
      hash,
      user.name,
      user.role,
    );
    const padEmail = user.email.padEnd(28);
    console.log(`║  ${padEmail} → ${password}   ║`);
  }

  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("⚠️  Save these passwords! They will NOT be shown again.\n");
}

function cleanExpiredSessions(db: DatabaseSync): void {
  try {
    db.prepare("DELETE FROM app_sessions WHERE expires_at < ?").run(
      Math.floor(Date.now() / 1000),
    );
  } catch {
    // ignore cleanup errors
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------
function shouldUseSecureCookie(req: Request): boolean {
  const xfProto = req.header("x-forwarded-proto");
  return Boolean(req.secure || xfProto === "https");
}

function cookieDomain(req: Request): string | null {
  const host = (req.hostname || "").toLowerCase();
  if (host.endsWith("prost-ai.com")) return "prost-ai.com";
  return null;
}

function issueUserSessionCookie(req: Request, res: Response, token: string): void {
  const cookie = [
    `${USER_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  const domain = cookieDomain(req);
  if (domain) cookie.push(`Domain=${domain}`);
  if (shouldUseSecureCookie(req)) cookie.push("Secure");
  res.append("Set-Cookie", cookie.join("; "));
}

function clearUserSessionCookie(req: Request, res: Response): void {
  const cookie = [
    `${USER_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  const domain = cookieDomain(req);
  if (domain) cookie.push(`Domain=${domain}`);
  if (shouldUseSecureCookie(req)) cookie.push("Secure");
  res.append("Set-Cookie", cookie.join("; "));
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export function registerUserAuthRoutes({ app, db }: RegisterUserAuthRoutesOptions): void {
  initTables(db);
  seedUsers(db);
  setUserAuthDb(db);

  // Clean expired sessions on startup
  cleanExpiredSessions(db);

  // Periodic cleanup every hour
  setInterval(() => cleanExpiredSessions(db), 60 * 60 * 1000);

  // -----------------------------------------------------------------------
  // POST /api/auth/login
  // -----------------------------------------------------------------------
  app.post("/api/auth/login", (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ error: "missing_credentials", message: "メールアドレスとパスワードを入力してください。" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check user exists
    const user = db
      .prepare("SELECT email, password_hash, name, role FROM app_users WHERE email = ?")
      .get(normalizedEmail) as { email: string; password_hash: string; name: string; role: string } | undefined;

    if (!user) {
      return res.status(401).json({ error: "invalid_credentials", message: "メールアドレスまたはパスワードが正しくありません。" });
    }

    // Verify password
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "invalid_credentials", message: "メールアドレスまたはパスワードが正しくありません。" });
    }

    // Create session
    const sessionToken = randomBytes(32).toString("hex");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + Math.floor(SESSION_TTL_MS / 1000);

    db.prepare("INSERT INTO app_sessions (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
      sessionToken,
      user.email,
      now,
      expiresAt,
    );

    // Issue cookie
    issueUserSessionCookie(req, res, sessionToken);

    // Return CSRF token + user info
    const csrf = userSessionCsrfToken(sessionToken);
    res.json({
      ok: true,
      csrf_token: csrf,
      user: { email: user.email, name: user.name, role: user.role },
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/auth/me
  // -----------------------------------------------------------------------
  app.get("/api/auth/me", (req: Request, res: Response) => {
    const token = getUserSessionCookie(req);
    if (!token) {
      return res.status(401).json({ error: "not_authenticated" });
    }

    const user = lookupUserSession(token);
    if (!user) {
      clearUserSessionCookie(req, res);
      return res.status(401).json({ error: "session_expired" });
    }

    const csrf = userSessionCsrfToken(token);
    res.json({
      ok: true,
      csrf_token: csrf,
      user: { email: user.email, name: user.name, role: user.role },
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/auth/logout
  // -----------------------------------------------------------------------
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    const token = getUserSessionCookie(req);
    if (token) {
      try {
        db.prepare("DELETE FROM app_sessions WHERE token = ?").run(token);
      } catch {
        // ignore deletion errors
      }
    }
    clearUserSessionCookie(req, res);
    res.json({ ok: true });
  });
}
