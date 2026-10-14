import type { SessionUser } from "$shared/types";
import { api } from "./api";

class Session {
  user = $state<SessionUser | null>(null);
  googleConnected = $state(false);
  googleNeedsReauth = $state(false);
  loaded = $state(false);

  async load() {
    try {
      const r = await api.me();
      this.user = r.user;
      this.googleConnected = r.googleConnected ?? false;
      this.googleNeedsReauth = r.googleNeedsReauth ?? false;
    } catch {
      this.user = null;
    } finally {
      this.loaded = true;
    }
  }

  async logout() {
    await api.logout();
    this.user = null;
  }
}

export const session = new Session();
