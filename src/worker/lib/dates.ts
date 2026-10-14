// 날짜 유틸. 저장은 UTC ISO, 기간 계산은 YYYY-MM-DD 문자열로 한다.

export function todayInTz(tz: string, now = new Date()): string {
  // en-CA 로케일은 YYYY-MM-DD 형식을 돌려준다.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** YYYY-MM-DD 기간을 ISO datetime 경계로 바꾼다 (해당 타임존 기준, end 포함). */
export function dayRangeToIso(startYmd: string, endYmd: string, tz: string): { from: string; to: string } {
  return { from: zonedStartOfDayIso(startYmd, tz), to: zonedStartOfDayIso(addDays(endYmd, 1), tz) };
}

/** 지정 타임존의 해당 날짜 00:00 을 UTC ISO 로 바꾼다. */
export function zonedStartOfDayIso(ymd: string, tz: string): string {
  // 타임존 오프셋을 구하기 위해 UTC 자정을 해당 타임존으로 포맷해 차이를 계산한다.
  const utcMidnight = new Date(`${ymd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcMidnight);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour") % 24;
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  const offsetMs = asIfUtc - utcMidnight.getTime();
  return new Date(utcMidnight.getTime() - offsetMs).toISOString();
}

export interface FiscalPeriod {
  label: string; // "FY2026 1Q", "FY2026 H1"
  kind: "quarter" | "half_year";
  fiscalYear: number;
  index: number; // 1..4 or 1..2
  periodStart: string;
  periodEnd: string;
}

function monthStart(year: number, month1: number): string {
  // month1 은 1..12, 12를 넘으면 다음 해로 넘긴다.
  const d = new Date(Date.UTC(year, month1 - 1, 1));
  return d.toISOString().slice(0, 10);
}

/** 회계연도 시작 월 기준으로 분기·반기 기간을 계산한다. fiscalYear 는 시작 연도. */
export function fiscalPeriod(
  kind: "quarter" | "half_year",
  fiscalYear: number,
  index: number,
  startMonth: number,
): FiscalPeriod {
  const span = kind === "quarter" ? 3 : 6;
  const offset = (index - 1) * span;
  const periodStart = monthStart(fiscalYear, startMonth + offset);
  const periodEnd = addDays(monthStart(fiscalYear, startMonth + offset + span), -1);
  const label = kind === "quarter" ? `FY${fiscalYear} ${index}Q` : `FY${fiscalYear} H${index}`;
  return { label, kind, fiscalYear, index, periodStart, periodEnd };
}

/** 날짜가 속한 분기를 돌려준다. */
export function fiscalQuarterOf(ymd: string, startMonth: number): FiscalPeriod {
  const [y, m] = ymd.split("-").map(Number);
  // 시작 월 이전이면 회계연도는 전년도
  const fiscalYear = m >= startMonth ? y : y - 1;
  const monthsFromStart = (m - startMonth + 12) % 12;
  const index = Math.floor(monthsFromStart / 3) + 1;
  return fiscalPeriod("quarter", fiscalYear, index, startMonth);
}

export function fiscalHalfOf(ymd: string, startMonth: number): FiscalPeriod {
  const q = fiscalQuarterOf(ymd, startMonth);
  return fiscalPeriod("half_year", q.fiscalYear, q.index <= 2 ? 1 : 2, startMonth);
}

/** 라벨 "FY2026-1Q" / "FY2026-H1" 파싱 */
export function parsePeriodLabel(label: string, startMonth: number): FiscalPeriod | null {
  const m = /^FY(\d{4})-(?:([1-4])Q|H([12]))$/i.exec(label.trim());
  if (!m) return null;
  const fy = Number(m[1]);
  if (m[2]) return fiscalPeriod("quarter", fy, Number(m[2]), startMonth);
  return fiscalPeriod("half_year", fy, Number(m[3]), startMonth);
}
