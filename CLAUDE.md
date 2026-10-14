# Mizuyari

개인용 업무 관리 웹앱. GitHub·Google Tasks·Calendar 활동을 모아 2주 단위 컨디셔닝 미팅 리포트와 분기·반기 성과를 정리한다. 사용자 1명.

## 스택

- Cloudflare Workers + Hono (TypeScript), D1 (SQLite) + Drizzle ORM, Cron Triggers
- Svelte 5 SPA (Vite) — Workers 정적 자산으로 배포, SvelteKit 미사용
- 빌드는 `@cloudflare/vite-plugin` 하나로 Worker 와 클라이언트를 함께 만든다

## 규칙

- **Svelte 5 runes 만 사용** (`$state`, `$derived`, `$props`, `$effect`). `$:`, `export let`, writable store 금지.
- 클라이언트와 Worker 가 공유하는 타입은 `src/shared/types.ts` 에 둔다. `$shared/*` 별칭.
- 날짜: DB 에는 ISO 문자열. 날짜만(YYYY-MM-DD)은 `text`, 시각은 UTC ISO. 기간 계산은 `src/worker/lib/dates.ts`.
- 활동(activities)은 `(source, external_id)` 로 upsert. 수집기는 제목·URL·시각만 갱신하고 사용자가 붙인 goal/note/highlight 는 건드리지 않는다.
- 고정 비밀은 Workers Secrets, 런타임에 갱신되는 Google 토큰만 D1 `credentials` 에 AES-GCM 암호화 저장.
- 외부 API 는 읽기 전용이 원칙. 예외는 Google Tasks 의 TODO 완료 처리(`status=completed` PATCH) 하나뿐이다. GitHub 에는 쓰지 않고, TODO 삭제·수정도 하지 않는다.
- 미완료 Google TODO 는 `google_todos` 스냅샷에 두고, 완료되면 `activities(google_task)` 로 옮기고 스냅샷에서 지운다.
- 리포트 출력 언어는 한국어 기본, 요청 시에만 일본어.
- 활동 제목·일정 제목은 외부인이 정할 수 있는 값이다. `{@html}` 로 내보낼 땐 반드시 이스케이프하고, href 에 넣는 URL 은 서버에서 `httpUrl`, 화면에서 `safeHref` 로 http(s) 만 허용한다.
- 스키마를 바꾸면 `pnpm db:generate` 로 마이그레이션 파일을 만들고 SQL 을 확인한다. 컬럼 타입·제약 변경은 테이블 재구성이 필요하니 확장→이행→축소 순서로.

## 구조

```
src/worker/         Hono 앱 (index.ts), auth/, collectors/, routes/, report/, lib/, db/
src/client/         Svelte SPA (App.svelte, routes/, components/, lib/)
src/shared/         공유 타입
migrations/         Drizzle 가 생성한 D1 마이그레이션
```

## 명령

- `pnpm dev` — Vite + Workers 로컬 (D1 로컬 상태 사용, `.dev.vars` 필요)
- `pnpm check` — Worker tsc + svelte-check
- `pnpm build` / `pnpm run deploy`
- `pnpm db:generate`, `pnpm db:migrate:local`, `pnpm db:migrate:remote`, `pnpm db:bookmark`

## 범위 밖 (설계서 참조)

- Mizuyari 가 Claude API 를 직접 호출하는 기능 (추후)
- Slack 수집 (추후)
- MCP 엔드포인트 `/mcp` 는 Phase 2 (현재 501)
