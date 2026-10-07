import crypto from "node:crypto";
import { env } from "./env";

/** AES-256-GCM; output "iv.tag.ciphertext" (base64url). */
export function encrypt(plain: string, key: Buffer = env.encryptionKey): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(blob: string, key: Buffer = env.encryptionKey): string {
  const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${h.toString("base64url")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, s, h] = stored.split("$");
  if (alg !== "scrypt" || !s || !h) return false;
  const expected = Buffer.from(h, "base64url");
  const actual = crypto.scryptSync(pw, Buffer.from(s, "base64url"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function sign(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySigned<T>(token: string, secret: string): T | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
