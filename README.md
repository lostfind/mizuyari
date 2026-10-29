# Mizuyari (水やり)

GitHub·Google Tasks·Calendar 활동을 자동으로 모아 2주 단위 컨디셔닝 미팅 리포트를 만들고, 분기·반기 평가용으로 쌓아 두는 개인용 웹앱입니다.

- **Sprint**: 2주 목표(Goal)와 수집된 활동을 연결하고 메모·하이라이트를 남긴다
- **Epics**: 스프린트를 넘어 이어지는 긴 목표. Goal 이 그 아래에 붙는다
- **Board**: GitHub Project 를 대체하는 칸반. Backlog 는 스프린트와 무관하게 모두 보이고, Todo 부터가 현재 스프린트 대상이다 (Todo 로 옮기면 현재 스프린트 지정, Backlog 로 되돌리면 해제). 스프린트를 넘길 때 남은 Todo·In Progress 는 다음 스프린트로 이월된다
  - 동기화 때 나에게 할당된 Open Issue/PR 과 내가 연 Open PR 을 가져온다. 진행 중(열린 PR, 열린 PR 이 연결된 Issue)이면 현재 스프린트의 In Progress, 아니면 스프린트 없이 Backlog. Issue/PR 이 닫히면 자동으로 Done
  - 한 번 가져온 항목은 Task 를 지워도 다시 만들지 않는다. 제목이 제외 패턴(설정, 기본 `^Release \d{14}$`)에 맞는 항목은 가져오지 않는다
- **Report**: 템플릿으로 리포트 초안 생성 → 편집 → 확정 (버전 이력 보관)
- **Archive**: 10월 시작 회계연도 기준 분기·반기 성과 (1Q = 10–12월)
- **Today**: 오늘 일정, 진행 중 Task, Google TODO (체크로 완료, 체크 해제로 완료 취소)

스택: Cloudflare Workers + Hono + D1 + Drizzle, Svelte 5 + Vite. 무료 플랜으로 운영 가능.

## 1. 사전 준비

### Google Cloud (OAuth)

개인 Google 계정으로 충분하며 결제 계정 등록은 필요 없습니다.

1. [Google Cloud Console](https://console.cloud.google.com/) 에서 프로젝트 생성
2. **API 및 서비스 → 라이브러리**에서 **Google Tasks API**, **Google Calendar API** 사용 설정
3. **Google Auth Platform** (구 OAuth 동의 화면) → **시작하기**: 앱 이름, 지원 이메일, 대상은 **외부(External)**, 연락처 입력 후 만들기
4. **Data Access**: 범위 추가 → `openid`, `userinfo.email`, `userinfo.profile`, `auth/tasks`, `auth/calendar.readonly`
   - `tasks` 는 Today 화면에서 TODO 를 완료 / 완료 취소하기 위한 쓰기 권한입니다 (완료 상태 변경 외의 쓰기는 하지 않음)
5. **Branding**: 앱 홈페이지 `https://github.com/lostfind/mizuyari`, 개인정보처리방침 `https://github.com/lostfind/mizuyari/blob/main/PRIVACY.md` 입력. 승인된 도메인에 `github.com` 추가 (프로덕션 전환에 필요)
6. **Audience**: **앱 게시**로 프로덕션 전환. 민감한 범위 때문에 "확인 필요" 안내가 나오지만 개인용은 그대로 진행하면 됩니다. 테스트 상태로 두면 refresh token 이 7일 만에 만료되므로 반드시 전환하세요. 로그인 시 "확인되지 않은 앱" 경고는 고급 → 계속으로 넘깁니다
7. **Clients** → 클라이언트 만들기 → **웹 애플리케이션**
   - 승인된 리디렉션 URI: `https://<your-worker>.workers.dev/auth/google/callback` 와 로컬용 `http://localhost:5173/auth/google/callback`
   - client ID / client secret 을 기록 (secret 은 대화상자를 닫으면 다시 볼 수 없음)

> 스코프를 나중에 바꾸면 앱 설정 화면에 "Google 다시 연결" 안내가 뜹니다. 한 번 재로그인하면 새 권한으로 refresh token 이 갱신됩니다.

### GitHub

- Fine-grained PAT (권장): 대상 저장소에 **Issues: Read, Pull requests: Read, Metadata: Read**. Organization 승인이 번거로우면 classic PAT 의 `repo` 스코프
- Organization 이 SAML SSO 를 쓰면 토큰에 SSO 승인 필요

### Cloudflare

- 계정 생성 후 `pnpm exec wrangler login`

## 2. 설치와 로컬 실행

```bash
pnpm install
cp .dev.vars.example .dev.vars   # 값 채우기 (ENCRYPTION_KEY: openssl rand -base64 32)
pnpm db:migrate:local
pnpm dev                          # http://localhost:5173
```

로컬에서는 `.dev.vars` 의 `ALLOWED_EMAIL` 계정으로 Google 로그인하면 됩니다.

## 3. 배포

```bash
# D1 생성 → 출력된 database_id 를 wrangler.jsonc 에 넣는다
pnpm exec wrangler d1 create mizuyari

# 시크릿 등록
pnpm exec wrangler secret put ALLOWED_EMAIL
pnpm exec wrangler secret put SESSION_SECRET        # 긴 랜덤 문자열
pnpm exec wrangler secret put ENCRYPTION_KEY        # openssl rand -base64 32
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put GITHUB_TOKEN
pnpm exec wrangler secret put GITHUB_LOGIN

# 마이그레이션 → 배포
pnpm db:migrate:remote
pnpm run deploy
```

배포 후 `https://<your-worker>.workers.dev` 로 접속해 Google 로그인을 한 번 하면 Tasks/Calendar 토큰이 저장되고, 이후 매일 00:00 UTC (09:00 JST) 에 자동 수집됩니다. 상단의 "지금 동기화"로 즉시 수집할 수도 있습니다.

### GitHub Actions 자동 배포

`.github/workflows/check.yml` 이 PR 에서 `pnpm check` 와 빌드를 돌리고, `.github/workflows/deploy.yml` 이 `main` push 시 마이그레이션과 배포를 실행합니다. 저장소 Secrets 에 다음을 등록하세요.

- `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit 권한)
- `CLOUDFLARE_ACCOUNT_ID`

## 4. 운영 메모

- **스키마 변경**: `src/worker/db/schema.ts` 수정 → `pnpm db:generate` → 생성된 SQL 확인 → `pnpm db:migrate:remote`. 적용 전 `pnpm db:bookmark` 로 Time Travel 북마크를 기록해 두면 `wrangler d1 time-travel restore mizuyari --bookmark=<id>` 로 되돌릴 수 있습니다. 테이블 관계는 [docs/ERD.md](docs/ERD.md) 를 참조하고, 스키마를 바꾸면 함께 갱신합니다.
- **Google 토큰 오류**(`invalid_grant` 등): 설정 화면의 "Google 다시 연결"로 재로그인.
- **Calendar 노이즈**: 설정 화면에서 제외 키워드를 지정 (예: 집중, 점심).
- **MCP 연동**(claude.ai 커스텀 커넥터)은 Phase 2 에서 `/mcp` 에 추가 예정입니다.

## API 요약

| 경로 | 설명 |
| --- | --- |
| `GET /api/sprints/current`, `POST /api/sprints`, `POST /api/sprints/:id/next` | 스프린트 조회·생성·다음 스프린트(목표 이월) |
| `GET/POST/PATCH/DELETE /api/goals`, `/api/epics`, `/api/tasks` | 목표·Epic·Task |
| `POST /api/tasks/import-github` | 할당된 Open Issue/PR·내가 연 Open PR 을 Task 로 (동기화 때도 자동 실행) |
| `GET/POST/PATCH /api/activities` | 활동 조회, 수동 추가, 목표 연결·메모·하이라이트 |
| `POST /api/reports/sprint/:id/draft`, `POST /api/reports/period/FY2026-1Q/draft` | 리포트 초안 |
| `PATCH /api/reports/:id`, `POST /api/reports/:id/finalize` | 편집·확정 |
| `GET /api/periods`, `GET /api/periods/FY2026-H1` | 분기·반기 집계 |
| `POST /api/sync`, `GET /api/sync/status` | 즉시 수집, 상태 |
