import { Hono } from "hono";
import type { PeriodSummary } from "$shared/types";
import { createDb } from "../db";
import { fiscalYearStartMonth } from "../env";
import { fiscalHalfOf, fiscalPeriod, fiscalQuarterOf, parsePeriodLabel, todayInTz } from "../lib/dates";
import { getPeriodData } from "../lib/queries";
import type { AppContext } from "../lib/session";
import { HttpError } from "../lib/validate";

export const periodRoutes = new Hono<AppContext>();

/** 선택 가능한 기간 목록: 현재 회계연도와 직전 회계연도의 분기·반기 */
periodRoutes.get("/", (c) => {
  const startMonth = fiscalYearStartMonth(c.env);
  const today = todayInTz(c.env.TIMEZONE);
  const current = fiscalQuarterOf(today, startMonth);
  const years = [current.fiscalYear, current.fiscalYear - 1];
  const list = years.flatMap((fy) => [
    ...[1, 2, 3, 4].map((i) => fiscalPeriod("quarter", fy, i, startMonth)),
    ...[1, 2].map((i) => fiscalPeriod("half_year", fy, i, startMonth)),
  ]);
  return c.json({
    current: { quarter: current, half: fiscalHalfOf(today, startMonth) },
    periods: list.map((p) => ({ ...p, key: `FY${p.fiscalYear}-${p.kind === "quarter" ? `${p.index}Q` : `H${p.index}`}` })),
  });
});

/** GET /api/periods/FY2026-1Q */
periodRoutes.get("/:label", async (c) => {
  const period = parsePeriodLabel(c.req.param("label"), fiscalYearStartMonth(c.env));
  if (!period) throw new HttpError(400, "label must be FYyyyy-nQ or FYyyyy-Hn");
  const db = createDb(c.env.DB);
  const data = await getPeriodData(db, period.periodStart, period.periodEnd, c.env.TIMEZONE);
  const summary: PeriodSummary = {
    label: period.label,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    sprints: data.sprints,
    goalCounts: data.goalCounts,
    epics: data.epics,
    highlights: data.highlights,
    reports: data.reports,
  };
  return c.json(summary);
});
