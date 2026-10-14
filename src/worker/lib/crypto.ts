// Credential 암호화 (AES-256-GCM) 와 세션 서명 (HMAC-SHA256).
// 키는 Workers Secrets 에서 온다. 저장 형식: base64(iv) + "." + base64(ciphertext)

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  return b64encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return b64decode(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const raw = b64decode(base64Key);
  if (raw.byteLength !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes (base64). Generate with: openssl rand -base64 32");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encrypt(plaintext: string, base64Key: string): Promise<string> {
  const key = await importAesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return `${b64encode(iv)}.${b64encode(ct)}`;
}

export async function decrypt(payload: string, base64Key: string): Promise<string> {
  const [ivB64, ctB64] = payload.split(".");
  if (!ivB64 || !ctB64) throw new Error("Malformed encrypted payload");
  const key = await importAesKey(base64Key);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64decode(ivB64) }, key, b64decode(ctB64));
  return dec.decode(pt);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** JSON 객체를 서명해 쿠키에 넣을 수 있는 토큰으로 만든다: base64url(payload).base64url(sig) */
export async function signToken(payload: unknown, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return `${body}.${b64urlEncode(sig)}`;
}

export async function verifyToken<T>(token: string, secret: string): Promise<T | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const key = await importHmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(sig), enc.encode(body));
  if (!ok) return null;
  try {
    return JSON.parse(dec.decode(b64urlDecode(body))) as T;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return b64urlEncode(digest);
}
