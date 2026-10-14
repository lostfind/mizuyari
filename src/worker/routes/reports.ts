import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { createDb, schema } from "../db";
import { fiscalYearStartMonth } from "../env";
import { parsePeriodLabel } from "../lib/dates";
import { getPeriodData, getSprintDetail } from "../lib/queries";
import type { AppContext } from "../lib/session";
import { HttpError, idParam, parseBody } from "../lib/validate";
import { normalizeLang, renderPeriodReport, renderSprintReport } from "../report/template";

export const reportRoutes = new Hono<AppContext>();

reportRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const kind = c.req.query("kind");
  const rows = await db.query.reports.findMany({
    where: kind ? eq(schema.reports.kind, kind as "sprint" | "quarter" | "half_year") : undefined,
    orderBy: [desc(schema.reports.periodEnd)],
    columns: { markdown: false },
  });
  return c.json(rows);
});

reportRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const row = await db.query.reports.findFirst({ where: eq(schema.reports.id, idParam(c)) });
  if (!row) throw new HttpError(404, "report not found");
  return c.json(row);
});

/** 스프린트 리포트 초안 생성(또는 재생성). 확정된 리포트는 덮어쓰지 않는다. */
reportRoutes.post("/sprint/:sprintId/draft", async (c) => {
  const sprintId = idParam(c, "sprintId");
  const body = await parseBody(c, z.object({ lang: z.enum(["ko", "ja"]).optional() }).default({}));
  const db = createDb(c.env.DB);
  const detail = await getSprintDetail(db, sprintId, c.env.TIMEZONE);
  if (!detail) throw new HttpError(404, "sprint not found");

  const lang = normalizeLang(body.lang ?? c.env.REPORT_LANG);
  const markdown = renderSprintReport(detail, lang, c.env.TIMEZONE);
  const title = `${detail.sprint.startDate} 〜 ${detail.sprint.endDate}`;

  const existing = await db.query.reports.findFirst({
    where: and(eq(schema.reports.sprintId, sprintId), eq(schema.reports.kind, "sprint")),
  });
  if (existing?.finalizedAt) throw new HttpError(409, "report is finalized; unfinalize first");

  if (existing) {
    await db.insert(schema.reportVersions).values({ reportId: existing.id, markdown: existing.markdown });
    const [row] = await db
      .update(schema.reports)
      .set({ markdown, title, updatedAt: new Date().toISOString() })
      .where(eq(schema.reports.id, existing.id))
      .returning();
    return c.json(row);
  }
  const [row] = await db
    .insert(schema.reports)
    .values({ sprintId, kind: "sprint", periodStart: detail.sprint.startDate, periodEnd: detail.sprint.endDate, title, markdown })
    .returning();
  return c.json(row, 201);
});

/** 분기·반기 리포트 초안. label: "FY2026-1Q" / "FY2026-H1" */
reportRoutes.post("/period/:label/draft", async (c) => {
  const label = c.req.param("label");
  const period = parsePeriodLabel(label, fiscalYearStartMonth(c.env));
  if (!period) throw new HttpError(400, "label must be FYyyyy-nQ or FYyyyy-Hn");
  const body = await parseBody(c, z.object({ lang: z.enum(["ko", "ja"]).optional() }).default({}));
  const db = createDb(c.env.DB);
  const data = await getPeriodData(db, period.periodStart, period.periodEnd, c.env.TIMEZONE);
  const sprintsById = new Map(data.sprints.map((s) => [s.id, s]));
  const lang = normalizeLang(body.lang ?? c.env.REPORT_LANG);
  const markdown = renderPeriodReport(
    {
      label: period.label,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      sprints: data.sprints,
      goalCounts: data.goalCounts,
      epics: data.epics.map((e) => ({ ...e, sprintsById })),
      highlights: data.highlights,
    },
    lang,
    c.env.TIMEZONE,
  );

  const existing = await db.query.reports.findFirst({
    where: and(
      eq(schema.reports.kind, period.kind),
      eq(schema.reports.periodStart, period.periodStart),
      eq(schema.reports.periodEnd, period.periodEnd),
    ),
  });
  if (existing?.finalizedAt) throw new HttpError(409, "report is finalized; unfinalize first");
  if (existing) {
    await db.insert(schema.reportVersions).values({ reportId: existing.id, markdown: existing.markdown });
    const [row] = await db
      .update(schema.reports)
      .set({ markdown, updatedAt: new Date().toISOString() })
      .where(eq(schema.reports.id, existing.id))
      .returning();
    return c.json(row);
  }
  const [row] = await db
    .insert(schema.reports)
    .values({ kind: period.kind, periodStart: period.periodStart, periodEnd: period.periodEnd, title: period.label, markdown })
    .returning();
  return c.json(row, 201);
});

/** 본문 저장 (이전 버전은 report_versions 에 보관) */
reportRoutes.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await parseBody(c, z.object({ markdown: z.string().max(200_000).optional(), title: z.string().max(200).optional() }));
  const db = createDb(c.env.DB);
  const existing = await db.query.reports.findFirst({ where: eq(schema.reports.id, id) });
  if (!existing) throw new HttpError(404, "report not found");
  if (existing.finalizedAt) throw new HttpError(409, "report is finalized; unfinalize first");
  if (body.markdown !== undefined && body.markdown !== existing.markdown) {
    await db.insert(schema.reportVersions).values({ reportId: id, markdown: existing.markdown });
  }
  const [row] = await db
    .update(schema.reports)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(schema.reports.id, id))
    .returning();
  return c.json(row);
});

reportRoutes.post("/:id/finalize", async (c) => {
  const id = idParam(c);
  const db = createDb(c.env.DB);
  const [row] = await db
    .update(schema.reports)
    .set({ finalizedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(schema.reports.id, id))
    .returning();
  if (!row) throw new HttpError(404, "report not found");
  return c.json(row);
});

reportRoutes.post("/:id/unfinalize", async (c) => {
  const id = idParam(c);
  const db = createDb(c.env.DB);
  const [row] = await db
    .update(schema.reports)
    .set({ finalizedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.reports.id, id))
    .returning();
  if (!row) throw new HttpError(404, "report not found");
  return c.json(row);
});

reportRoutes.get("/:id/versions", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.query.reportVersions.findMany({
    where: eq(schema.reportVersions.reportId, idParam(c)),
    orderBy: [desc(schema.reportVersions.createdAt)],
  });
  return c.json(rows);
});
