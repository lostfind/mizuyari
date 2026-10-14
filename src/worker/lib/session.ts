import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { SessionUser } from "$shared/types";
import type { Env } from "../env";
import { signToken, verifyToken } from "./crypto";

export const SESSION_COOKIE = "mz_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30일

interface SessionPayload {
  u: SessionUser;
  exp: number; // unix seconds
}

export type AppVariables = { user: SessionUser };
export type AppContext = { Bindings: Env; Variables: AppVariables };

export async function createSession(c: Context<AppContext>, user: SessionUser): Promise<void> {
  const payload: SessionPayload = { u: user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC };
  const token = await signToken(payload, c.env.SESSION_SECRET);
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "Lax",
    maxAge: SESSION_TTL_SEC,
  });
}

export function clearSession(c: Context<AppContext>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function readSession(c: Context<AppContext>): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const payload = await verifyToken<SessionPayload>(token, c.env.SESSION_SECRET);
  if (!payload || payload.exp < Date.now() / 1000) return null;
  if (payload.u.email.toLowerCase() !== c.env.ALLOWED_EMAIL.toLowerCase()) return null;
  return payload.u;
}

/** /api/* 보호. 로그인 안 됐으면 401. */
export const requireAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
};
