// GitHub GraphQL: 본인이 만든 Issue/PR, 리뷰한 PR 을 기간으로 수집한다.
// contributionsCollection 은 최대 1년 범위, 각 리스트 100건까지. 2주 수집이면 충분하다.
// 추가로 Task 에 연결된 Issue/PR 의 open/closed 상태를 동기화한다.

import type { CollectWindow, CollectedActivity } from "./types";

const GQL = "https://api.github.com/graphql";

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function gql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(GQL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "mizuyari",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as GqlResponse<T>;
  if (body.errors?.length) throw new Error(`GitHub GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
  if (!body.data) throw new Error("GitHub GraphQL: empty response");
  return body.data;
}

const CONTRIBUTIONS_QUERY = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      issueContributions(first: 100, orderBy: {direction: DESC}) {
        nodes {
          occurredAt
          issue { id number title url state closedAt repository { nameWithOwner } }
        }
      }
      pullRequestContributions(first: 100, orderBy: {direction: DESC}) {
        nodes {
          occurredAt
          pullRequest { id number title url state merged mergedAt closedAt repository { nameWithOwner } }
        }
      }
      pullRequestReviewContributions(first: 100, orderBy: {direction: DESC}) {
        nodes {
          occurredAt
          pullRequest { id number title url state repository { nameWithOwner } author { login } }
          pullRequestReview { id state }
        }
      }
    }
  }
}`;

// issueContributions 는 본인이 「연」 Issue 만 돌려준다. 남이 열어 본인에게 할당된 Issue 나 기간 전에 연 Issue 를
// 닫은 것은 기여로 잡히지 않으므로, 기간 안에 닫힌 본인 할당·작성 Issue 를 검색으로 따로 모은다.
const CLOSED_ISSUES_QUERY = `
query($assigned: String!, $authored: String!) {
  assigned: search(type: ISSUE, query: $assigned, first: 100) { nodes { ...ClosedIssue } }
  authored: search(type: ISSUE, query: $authored, first: 100) { nodes { ...ClosedIssue } }
}
fragment ClosedIssue on Issue { id number title url state closedAt repository { nameWithOwner } }`;

interface ClosedIssueNode {
  id?: string;
  number: number;
  title: string;
  url: string;
  state: string;
  closedAt: string | null;
  repository: { nameWithOwner: string };
}

interface ClosedIssuesData {
  assigned: { nodes: ClosedIssueNode[] };
  authored: { nodes: ClosedIssueNode[] };
}

interface ContributionsData {
  user: {
    contributionsCollection: {
      issueContributions: {
        nodes: Array<{
          occurredAt: string;
          issue: {
            id: string;
            number: number;
            title: string;
            url: string;
            state: string;
            closedAt: string | null;
            repository: { nameWithOwner: string };
          };
        }>;
      };
      pullRequestContributions: {
        nodes: Array<{
          occurredAt: string;
          pullRequest: {
            id: string;
            number: number;
            title: string;
            url: string;
            state: string;
            merged: boolean;
            mergedAt: string | null;
            closedAt: string | null;
            repository: { nameWithOwner: string };
          };
        }>;
      };
      pullRequestReviewContributions: {
        nodes: Array<{
          occurredAt: string;
          pullRequest: {
            id: string;
            number: number;
            title: string;
            url: string;
            state: string;
            repository: { nameWithOwner: string };
            author: { login: string } | null;
          };
          pullRequestReview: { id: string; state: string };
        }>;
      };
    };
  } | null;
}

export async function collectGithub(
  token: string,
  login: string,
  win: CollectWindow,
): Promise<CollectedActivity[]> {
  const data = await gql<ContributionsData>(token, CONTRIBUTIONS_QUERY, { login, from: win.from, to: win.to });
  if (!data.user) throw new Error(`GitHub user not found: ${login}`);
  const cc = data.user.contributionsCollection;
  // 제목은 「원래 제목 (repo#번호)」. 종류와 상태(closed / merged)는 화면·리포트의 라벨이 보여 준다.
  const out: CollectedActivity[] = [];

  for (const n of cc.issueContributions.nodes) {
    const i = n.issue;
    const closed = i.state === "CLOSED";
    out.push({
      source: "github_issue",
      externalId: i.id,
      title: `${i.title} (${i.repository.nameWithOwner}#${i.number})`,
      url: i.url,
      // 닫힌 Issue 는 닫힌 시각을 활동 시각으로 쓴다 (성과 기준).
      occurredAt: closed && i.closedAt ? i.closedAt : n.occurredAt,
      metadata: { repo: i.repository.nameWithOwner, number: i.number, state: i.state, kind: "issue" },
    });
  }

  for (const n of cc.pullRequestContributions.nodes) {
    const p = n.pullRequest;
    out.push({
      source: "github_pr",
      externalId: p.id,
      title: `${p.title} (${p.repository.nameWithOwner}#${p.number})`,
      url: p.url,
      occurredAt: p.merged && p.mergedAt ? p.mergedAt : n.occurredAt,
      metadata: {
        repo: p.repository.nameWithOwner,
        number: p.number,
        state: p.state,
        merged: p.merged,
        kind: "pull_request",
      },
    });
  }

  for (const n of cc.pullRequestReviewContributions.nodes) {
    const p = n.pullRequest;
    out.push({
      source: "github_review",
      externalId: n.pullRequestReview.id,
      title: `${p.title} (${p.repository.nameWithOwner}#${p.number})`,
      url: p.url,
      occurredAt: n.occurredAt,
      metadata: {
        repo: p.repository.nameWithOwner,
        number: p.number,
        reviewState: n.pullRequestReview.state,
        author: p.author?.login ?? null,
        kind: "review",
      },
    });
  }

  // 기간 안에 닫힌 본인 할당·작성 Issue. 같은 Issue 가 위 issueContributions 에 있으면 이쪽(닫힌 시각 기준)으로 덮는다.
  const closedRange = `closed:${win.from}..${win.to}`;
  const closed = await gql<ClosedIssuesData>(token, CLOSED_ISSUES_QUERY, {
    assigned: `is:issue assignee:${login} ${closedRange}`,
    authored: `is:issue author:${login} ${closedRange}`,
  });
  const byId = new Map(out.map((a, i) => [a.externalId, i]));
  for (const i of [...closed.assigned.nodes, ...closed.authored.nodes]) {
    if (!i.id || !i.closedAt) continue;
    const item: CollectedActivity = {
      source: "github_issue",
      externalId: i.id,
      title: `${i.title} (${i.repository.nameWithOwner}#${i.number})`,
      url: i.url,
      occurredAt: i.closedAt,
      metadata: { repo: i.repository.nameWithOwner, number: i.number, state: i.state, kind: "issue" },
    };
    const at = byId.get(i.id);
    if (at === undefined) {
      byId.set(i.id, out.length);
      out.push(item);
    } else {
      out[at] = item;
    }
  }

  return out;
}

/** Task 에 연결된 Issue/PR URL 의 현재 상태를 조회한다. 돌려주는 값: open / closed / merged */
export async function fetchGithubStates(
  token: string,
  urls: string[],
): Promise<Map<string, { state: "open" | "closed" | "merged"; title: string }>> {
  const result = new Map<string, { state: "open" | "closed" | "merged"; title: string }>();
  const parsed = urls
    .map((u) => ({ u, m: /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/(issues|pull)\/(\d+)/.exec(u) }))
    .filter((x): x is { u: string; m: RegExpExecArray } => !!x.m);
  if (parsed.length === 0) return result;

  // 한 쿼리에 alias 로 묶는다 (최대 50개씩). owner/repo 는 위 정규식으로 문자를 제한해 쿼리 문자열에 넣는다.
  for (let i = 0; i < parsed.length; i += 50) {
    const chunk = parsed.slice(i, i + 50);
    const fields = chunk
      .map(({ m }, idx) => {
        const [, owner, repo, kind, num] = m;
        const field = kind === "pull" ? "pullRequest" : "issue";
        return `n${idx}: repository(owner: "${owner}", name: "${repo}") { ${field}(number: ${num}) { title state ${
          kind === "pull" ? "merged" : ""
        } } }`;
      })
      .join("\n");
    const data = await gql<Record<string, { issue?: NodeState; pullRequest?: NodeState } | null>>(
      token,
      `query { ${fields} }`,
      {},
    );
    chunk.forEach(({ u }, idx) => {
      const node = data[`n${idx}`]?.issue ?? data[`n${idx}`]?.pullRequest;
      if (!node) return;
      const state = node.merged ? "merged" : node.state === "CLOSED" || node.state === "MERGED" ? "closed" : "open";
      result.set(u, { state, title: node.title });
    });
  }
  return result;
}

interface NodeState {
  title: string;
  state: string;
  merged?: boolean;
}

export interface OpenWorkItem {
  url: string;
  title: string;
  repo: string;
  number: number;
  /** 열린 PR 이거나, 열린 PR 이 연결된(closing reference) Issue */
  inProgress: boolean;
  /** PR 이 닫을 Issue URL (내가 연 PR 만) */
  closes: string[];
}

interface SearchNode {
  __typename?: "Issue" | "PullRequest";
  title?: string;
  url?: string;
  number?: number;
  repository?: { nameWithOwner: string };
  closedByPullRequestsReferences?: { totalCount: number };
  closingIssuesReferences?: { nodes: Array<{ url: string }> };
}

/**
 * Board 로 가져올 진행 대상: 나에게 할당된 Open Issue/PR + 내가 연 Open PR.
 * 내가 연 PR 이 할당 Issue 를 닫는 PR 이면 PR 은 따로 돌려주지 않는다 (Issue 쪽이 진행 중으로 잡힌다).
 */
export async function fetchOpenWorkItems(token: string): Promise<OpenWorkItem[]> {
  const fields = `__typename title url number repository { nameWithOwner }`;
  const data = await gql<{ assigned: { nodes: SearchNode[] }; authored: { nodes: SearchNode[] } }>(
    token,
    `query {
      assigned: search(type: ISSUE, first: 50, query: "is:open assignee:@me") {
        nodes {
          ... on Issue { ${fields} closedByPullRequestsReferences(first: 1, includeClosedPrs: false) { totalCount } }
          ... on PullRequest { ${fields} }
        }
      }
      authored: search(type: ISSUE, first: 50, query: "is:open is:pr author:@me") {
        nodes { ... on PullRequest { ${fields} closingIssuesReferences(first: 10) { nodes { url } } } }
      }
    }`,
    {},
  );
  const out = new Map<string, OpenWorkItem>();
  const toItem = (n: SearchNode, inProgress: boolean, closes: string[] = []): OpenWorkItem => ({
    url: n.url!,
    title: n.title ?? "",
    repo: n.repository?.nameWithOwner ?? "",
    number: n.number ?? 0,
    inProgress,
    closes,
  });
  for (const n of data.assigned.nodes) {
    if (!n.url) continue;
    const inProgress = n.__typename === "PullRequest" || (n.closedByPullRequestsReferences?.totalCount ?? 0) > 0;
    out.set(n.url, toItem(n, inProgress));
  }
  for (const n of data.authored.nodes) {
    if (!n.url || out.has(n.url)) continue;
    const closes = n.closingIssuesReferences?.nodes.map((x) => x.url) ?? [];
    if (closes.some((u) => out.has(u))) continue;
    out.set(n.url, toItem(n, true, closes));
  }
  return [...out.values()];
}
