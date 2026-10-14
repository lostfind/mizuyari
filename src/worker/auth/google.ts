// Google OAuth: 로그인(openid/email/profile) + Tasks/Calendar 읽기 권한을 한 번에 받는다.
// refresh token 은 암호화해 credentials 테이블에 저장하고, access token 은 만료 전까지 재사용한다.

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "../env";
import type { Db } from "../db";
import { createDb, schema } from "../db";
import { decrypt, encrypt, randomToken, sha256Base64Url } from "../lib/crypto";
import { type AppContext, clearSession, createSession, readSession } from "../lib/session";
import { HttpError } from "../lib/validate";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  // Tasks 는 Today 화면에서 TODO 를 완료 처리하기 위해 쓰기 권한이 필요하다 (완료 처리 외의 쓰기는 하지 않는다)
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/calendar.readonly",
];

/** 저장된 토큰이 현재 요구 스코프를 모두 갖고 있는지. 부족하면 재로그인(consent) 이 필요하다. */
export function hasRequiredScopes(grantedScopes: string | null | undefined): boolean {
  if (!grantedScopes) return false;
  const granted = new Set(grantedScopes.split(/\s+/));
  return GOOGLE_SCOPES.filter((s) => s.startsWith("https://")).every((s) => granted.has(s));
}

const STATE_COOKIE = "mz_oauth";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

function redirectUri(reqUrl: string): string {
  const u = new URL(reqUrl);
  return `${u.origin}/auth/google/callback`;
}

export const authRoutes = new Hono<AppContext>();

authRoutes.get("/google/start", async (c) => {
  const state = randomToken(16);
  const verifier = randomToken(48);
  const challenge = await sha256Base64Url(verifier);
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, STATE_COOKIE, JSON.stringify({ state, verifier }), {
    path: "/auth",
    httpOnly: true,
    secure,
    sameSite: "Lax",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c.req.url),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // 처음 한 번, 또는 스코프가 늘어난 경우는 consent 로 refresh_token 을 확실히 받는다.
    prompt: (await hasCurrentGoogleCredential(createDb(c.env.DB))) ? "select_account" : "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    login_hint: c.env.ALLOWED_EMAIL,
  });
  return c.redirect(`${AUTH_URL}?${params.toString()}`);
});

authRoutes.get("/google/callback", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const raw = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/auth" });
  if (!code || !state || !raw) return c.text("Invalid OAuth callback", 400);
  let saved: { state: string; verifier: string };
  try {
    saved = JSON.parse(raw);
  } catch {
    return c.text("Invalid OAuth state", 400);
  }
  if (saved.state !== state) return c.text("OAuth state mismatch", 400);

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(c.req.url),
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
  });
  const token = (await tokenRes.json()) as TokenResponse;
  if (!tokenRes.ok || token.error) {
    return c.text(`Token exchange failed: ${token.error_description ?? token.error ?? tokenRes.status}`, 400);
  }

  const infoRes = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${token.access_token}` } });
  const info = (await infoRes.json()) as { email?: string; name?: string; picture?: string; email_verified?: boolean };
  if (!info.email || info.email_verified !== true || info.email.toLowerCase() !== c.env.ALLOWED_EMAIL.toLowerCase()) {
    return c.text("This account is not allowed.", 403);
  }

  const db = createDb(c.env.DB);
  await saveGoogleTokens(db, c.env, token, info.email);
  await createSession(c, { email: info.email, name: info.name ?? null, picture: info.picture ?? null });
  return c.redirect("/");
});

authRoutes.post("/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ user: null }, 200);
  const db = createDb(c.env.DB);
  const cred = await db.query.credentials.findFirst({ where: eq(schema.credentials.provider, "google") });
  return c.json({
    user,
    googleConnected: !!cred,
    // 스코프가 바뀐 뒤 재로그인이 필요한지 (설정 화면에서 안내)
    googleNeedsReauth: !!cred && !hasRequiredScopes(cred.scopes),
  });
});

async function hasCurrentGoogleCredential(db: Db): Promise<boolean> {
  const row = await db.query.credentials.findFirst({ where: eq(schema.credentials.provider, "google") });
  return !!row && hasRequiredScopes(row.scopes);
}

async function saveGoogleTokens(db: Db, env: Env, token: TokenResponse, email: string): Promise<void> {
  const existing = await db.query.credentials.findFirst({ where: eq(schema.credentials.provider, "google") });
  const expiresAt = new Date(Date.now() + (token.expires_in - 60) * 1000).toISOString();
  const encAccess = await encrypt(token.access_token, env.ENCRYPTION_KEY);
  const now = new Date().toISOString();

  if (token.refresh_token) {
    const encRefresh = await encrypt(token.refresh_token, env.ENCRYPTION_KEY);
    if (existing) {
      await db
        .update(schema.credentials)
        .set({
          encryptedRefreshToken: encRefresh,
          encryptedAccessToken: encAccess,
          accessTokenExpiresAt: expiresAt,
          scopes: token.scope,
          accountEmail: email,
          updatedAt: now,
        })
        .where(eq(schema.credentials.id, existing.id));
    } else {
      await db.insert(schema.credentials).values({
        provider: "google",
        encryptedRefreshToken: encRefresh,
        encryptedAccessToken: encAccess,
        accessTokenExpiresAt: expiresAt,
        scopes: token.scope,
        accountEmail: email,
      });
    }
    return;
  }

  // refresh_token 없이 돌아온 경우(재로그인): access token 만 갱신
  if (existing) {
    await db
      .update(schema.credentials)
      .set({ encryptedAccessToken: encAccess, accessTokenExpiresAt: expiresAt, scopes: token.scope, updatedAt: now })
      .where(eq(schema.credentials.id, existing.id));
  } else {
    throw new HttpError(
      400,
      "Google did not return a refresh_token. Revoke the app at myaccount.google.com and sign in again.",
    );
  }
}

/** 수집기에서 쓸 유효한 access token 을 돌려준다. 만료면 refresh 한다. */
export async function getGoogleAccessToken(db: Db, env: Env): Promise<string> {
  const row = await db.query.credentials.findFirst({ where: eq(schema.credentials.provider, "google") });
  if (!row) throw new Error("Google is not connected. Sign in once from the app.");

  if (row.encryptedAccessToken && row.accessTokenExpiresAt && new Date(row.accessTokenExpiresAt) > new Date()) {
    return decrypt(row.encryptedAccessToken, env.ENCRYPTION_KEY);
  }

  const refreshToken = await decrypt(row.encryptedRefreshToken, env.ENCRYPTION_KEY);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const token = (await res.json()) as TokenResponse;
  if (!res.ok || token.error) {
    // invalid_grant 등: 재로그인이 필요하다. 호출자가 SyncRun 에 기록한다.
    throw new Error(`Google token refresh failed: ${token.error_description ?? token.error ?? res.status}`);
  }
  const expiresAt = new Date(Date.now() + (token.expires_in - 60) * 1000).toISOString();
  await db
    .update(schema.credentials)
    .set({
      encryptedAccessToken: await encrypt(token.access_token, env.ENCRYPTION_KEY),
      accessTokenExpiresAt: expiresAt,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.credentials.id, row.id));
  return token.access_token;
}
