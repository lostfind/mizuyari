import type { ActivitySource } from "$shared/types";

/** 수집기가 돌려주는 활동 한 건. DB 에 upsert 된다. */
export interface CollectedActivity {
  source: ActivitySource;
  externalId: string;
  title: string;
  url: string | null;
  occurredAt: string; // ISO
  metadata?: Record<string, unknown>;
}

export interface CollectWindow {
  from: string; // ISO
  to: string; // ISO
}
