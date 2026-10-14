// 아주 작은 해시 없는 History 라우터. 외부 라이브러리 없이 Svelte 5 runes 로 상태를 든다.

export type Route =
  | { name: "today" }
  | { name: "board" }
  | { name: "sprint"; id?: number }
  | { name: "report"; id?: number }
  | { name: "archive"; period?: string }
  | { name: "epics"; id?: number }
  | { name: "settings" }
  | { name: "login" };

function parse(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  const [head, arg] = parts;
  switch (head) {
    case undefined:
    case "today":
      return { name: "today" };
    case "board":
      return { name: "board" };
    case "sprint":
      return { name: "sprint", id: arg ? Number(arg) : undefined };
    case "report":
      return { name: "report", id: arg ? Number(arg) : undefined };
    case "archive":
      return { name: "archive", period: arg };
    case "epics":
      return { name: "epics", id: arg ? Number(arg) : undefined };
    case "settings":
      return { name: "settings" };
    case "login":
      return { name: "login" };
    default:
      return { name: "today" };
  }
}

export function routePath(r: Route): string {
  switch (r.name) {
    case "today":
      return "/";
    case "sprint":
      return r.id ? `/sprint/${r.id}` : "/sprint";
    case "report":
      return r.id ? `/report/${r.id}` : "/report";
    case "archive":
      return r.period ? `/archive/${r.period}` : "/archive";
    case "epics":
      return r.id ? `/epics/${r.id}` : "/epics";
    default:
      return `/${r.name}`;
  }
}

class Router {
  route = $state<Route>(parse(location.pathname));

  constructor() {
    window.addEventListener("popstate", () => {
      this.route = parse(location.pathname);
    });
  }

  go(r: Route | string, replace = false) {
    const path = typeof r === "string" ? r : routePath(r);
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    this.route = parse(path);
    window.scrollTo({ top: 0 });
  }

  /** <a> 클릭을 가로채 SPA 이동으로 바꾼다. */
  link = (node: HTMLAnchorElement) => {
    const onClick = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const href = node.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      e.preventDefault();
      this.go(href);
    };
    node.addEventListener("click", onClick);
    return { destroy: () => node.removeEventListener("click", onClick) };
  };
}

export const router = new Router();
