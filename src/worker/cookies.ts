// Cookie signing for the Worker build. The Express build used
// cookie-parser's signed-cookie format (HMAC-SHA256, base64, value.sig);
// this is a clean reimplementation using Web Crypto with the same
// SESSION_SECRET, following the same shape (httpOnly/secure/sameSite/
// expires). Because the Worker is served from a brand-new origin
// (workers.dev, then the production domain only after cutover), no
// cookie issued by the old Express build is ever presented to this code
// path, so byte-for-byte signature compatibility with cookie-parser is not
// required — only internal consistency between sign() and verify() here.
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signValue(value: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return `${value}.${toBase64Url(sig)}`;
}

export async function unsignValue(signed: string, secret: string): Promise<string | null> {
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const expected = await signValue(value, secret);
  // Constant-time-ish compare via the same encoding path; lengths differing is fine to short-circuit.
  if (expected.length !== signed.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signed.charCodeAt(i);
  return diff === 0 ? value : null;
}

export async function setSignedCookie(
  c: Context,
  name: string,
  value: string,
  secret: string,
  opts: { expires: Date; secure: boolean }
): Promise<void> {
  const signed = await signValue(value, secret);
  setCookie(c, name, signed, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: "Lax",
    expires: opts.expires,
    path: "/",
  });
}

export async function readSignedCookie(c: Context, name: string, secret: string): Promise<string | null> {
  const raw = getCookie(c, name);
  if (!raw) return null;
  return unsignValue(raw, secret);
}

export function clearSignedCookie(c: Context, name: string): void {
  deleteCookie(c, name, { path: "/" });
}
