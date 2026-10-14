import type { Context } from "hono";
import { z } from "zod";
import type { AppContext } from "./session";

/** JSON 본문을 zod 로 검증한다. 실패하면 400 응답을 던진다. */
export async function parseBody<S extends z.ZodTypeAny>(c: Context<AppContext>, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, "validation failed", r.error.issues);
  return r.data;
}

/** http(s) URL 만 허용. z.string().url() 은 javascript: 도 통과시키므로 화면의 href 로 쓰는 값은 이걸 쓴다. */
export const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "http(s) URL only");

export function idParam(c: Context<AppContext>, name = "id"): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `invalid ${name}`);
  return n;
}

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 500,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
