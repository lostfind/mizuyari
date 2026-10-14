import { Hono } from "hono";
import { logger } from "hono/logger";
import { authRoutes } from "./auth/google";
import { runSync } from "./collectors/run";
import { createDb } from "./db";
import type { Env } from "./env";
import { type AppContext, requireAuth } from "./lib/session";
import { HttpError } from "./lib/validate";
import { activityRoutes } from "./routes/activities";
import { epicRoutes } from "./routes/epics";
import { goalRoutes } from "./routes/goals";
import { periodRoutes } from "./routes/periods";
import { reportRoutes } from "./routes/reports";
import { sprintRoutes } from "./routes/sprints";
import { syncRoutes } from "./routes/sync";
import { taskRoutes } from "./routes/tasks";
import { todayRoutes } from "./routes/today";
import { todoRoutes } from "./routes/todos";

const app = new Hono<AppContext>();

app.use("*", logger());

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, details: err.details ?? null }, err.status);
  }
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : "internal error" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true, app: c.env.APP_NAME, time: new Date().toISOString() }));

app.route("/auth", authRoutes);

const api = new Hono<AppContext>();
api.use("*", requireAuth);
api.route("/sprints", sprintRoutes);
api.route("/goals", goalRoutes);
api.route("/epics", epicRoutes);
api.route("/tasks", taskRoutes);
api.route("/activities", activityRoutes);
api.route("/reports", reportRoutes);
api.route("/periods", periodRoutes);
api.route("/sync", syncRoutes);
api.route("/today", todayRoutes);
api.route("/todos", todoRoutes);
api.get("/config", (c) =>
  c.json({
    appName: c.env.APP_NAME,
    fiscalYearStartMonth: Number(c.env.FISCAL_YEAR_START_MONTH ?? 10),
    reportLang: c.env.REPORT_LANG ?? "ko",
    timezone: c.env.TIMEZONE,
    githubLogin: c.env.GITHUB_LOGIN ?? null,
  }),
);
app.route("/api", api);

// MCP 엔드포인트는 Phase 2 에서 추가한다.
app.all("/mcp", (c) => c.json({ error: "MCP endpoint is not implemented yet (Phase 2)" }, 501));

// 그 외 경로는 정적 자산(SPA) 으로. run_worker_first 에 걸리지 않는 경로는 여기 오지 않는다.
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = createDb(env.DB);
    ctx.waitUntil(
      runSync(db, env).then((results) => {
        for (const r of results) {
          console.log(`[sync] ${r.provider}: ${r.ok ? `ok +${r.inserted} ~${r.updated}` : `error ${r.error}`}`);
        }
      }),
    );
  },
} satisfies ExportedHandler<Env>;
