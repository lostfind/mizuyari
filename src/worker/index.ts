import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
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
// API·인증 응답용. 정적 자산(SPA) 의 헤더와 CSP 는 public/_headers 에서 준다.
app.use("*", secureHeaders());

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, details: err.details ?? null }, err.status);
  }
  // 예상하지 못한 에러는 내부 정보가 담길 수 있으니 로그에만 남기고 응답에는 일반 메시지만 준다.
  console.error(err);
  return c.json({ error: "internal error" }, 500);
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
// ASSETS 응답은 헤더가 immutable 이라 secureHeaders 가 헤더를 붙일 수 있도록 복사해서 돌려준다.
app.notFound(async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(res.body, res);
});

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
