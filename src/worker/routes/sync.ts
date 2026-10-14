import { Hono } from "hono";
import { z } from "zod";
import { SYNC_PROVIDERS } from "$shared/types";
import { lastSyncInfo, runSync } from "../collectors/run";
import { createDb, schema } from "../db";
import { dayRangeToIso, isYmd } from "../lib/dates";
import type { AppContext } from "../lib/session";
import { parseBody } from "../lib/validate";
import { eq } from "drizzle-orm";

export const syncRoutes = new Hono<AppContext>();

syncRoutes.get("/status", async (c) => {
  const db = createDb(c.env.DB);
  return c.json(await lastSyncInfo(db));
});

/** 즉시 수집. from/to 를 주면 그 기간만 (재수집용). */
syncRoutes.post("/", async (c) => {
  const body = await parseBody(
    c,
    z
      .object({
        providers: z.array(z.enum(SYNC_PROVIDERS)).optional(),
        from: z.string().refine(isYmd, "YYYY-MM-DD").optional(),
        to: z.string().refine(isYmd, "YYYY-MM-DD").optional(),
      })
      .default({}),
  );
  const db = createDb(c.env.DB);
  const window = body.from && body.to ? dayRangeToIso(body.from, body.to, c.env.TIMEZONE) : undefined;
  const results = await runSync(db, c.env, { providers: body.providers, window });
  return c.json(results);
});

/** 설정값 (캘린더 제외 키워드 등) */
syncRoutes.get("/settings", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.query.settings.findMany();
  return c.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

syncRoutes.put("/settings", async (c) => {
  const body = await parseBody(c, z.record(z.string().max(100), z.string().max(2000)));
  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(body)) {
    await db
      .insert(schema.settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now } });
  }
  const rows = await db.query.settings.findMany();
  return c.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

export { eq };
