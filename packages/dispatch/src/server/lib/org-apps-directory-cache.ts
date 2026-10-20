export interface CachedOrgDirectoryAgent {
  id: string;
  name: string;
  description?: string;
  whenToUse?: string[];
  url: string;
  source?: "workspace" | "org-directory" | "remote-agent" | "builtin";
}

export interface OrgDirectorySuccessCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
}

export function createOrgDirectorySuccessCache<T>(input?: {
  ttlMs?: number;
  now?: () => number;
}): OrgDirectorySuccessCache<T> {
  const ttlMs = input?.ttlMs ?? 60_000;
  const now = input?.now ?? Date.now;
  const values = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, Promise<T>>();
  let generation = 0;

  return {
    async get(key, load) {
      const cached = values.get(key);
      if (cached && cached.expiresAt > now()) return cached.value;
      values.delete(key);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const loadGeneration = generation;
      const refresh = load()
        .then((value) => {
          if (loadGeneration === generation) {
            values.set(key, { value, expiresAt: now() + ttlMs });
          }
          return value;
        })
        .finally(() => {
          if (inFlight.get(key) === refresh) inFlight.delete(key);
        });
      inFlight.set(key, refresh);
      return refresh;
    },
    clear() {
      generation += 1;
      values.clear();
      inFlight.clear();
    },
  };
}

export const orgAppsDirectoryCache =
  createOrgDirectorySuccessCache<CachedOrgDirectoryAgent[]>();

export function invalidateOrgAppsDirectoryCache(): void {
  orgAppsDirectoryCache.clear();
}
