import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const HOME_SUGGESTION_ROLES = [
  "product",
  "design",
  "developer",
  "marketing",
  "sales",
  "ops",
  "individual",
] as const;

export type HomeSuggestionRole = (typeof HOME_SUGGESTION_ROLES)[number];
export type HomeSuggestionRoleKey = HomeSuggestionRole | "general";

export interface HomeSuggestionClick {
  appId: string;
  role: HomeSuggestionRoleKey;
  suggestionId: string;
  position: number;
}

const HomeSuggestionSeedContext = createContext(0);
const HomeSuggestionRoleContext = createContext<HomeSuggestionRoleKey | null>(
  null,
);
const homeSuggestionSeeds = new Map<string, number>();

function homeSuggestionSeedStorageKey(appId: string): string {
  return `agent-native:home-suggestion-seed:${appId}`;
}

function homeSuggestionRoleStorageKey(appId: string): string {
  return `agent-native:home-suggestion-role:${appId}`;
}

export function readHomeSuggestionRole(appId: string): HomeSuggestionRoleKey {
  if (typeof document !== "undefined") {
    const shellRole = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-home-suggestion-shell-role]",
      ),
    ).find(
      (element) =>
        element.getAttribute("data-home-suggestion-app-id") === appId,
    );
    if (shellRole) {
      return normalizeHomeSuggestionRole(
        shellRole.getAttribute("data-home-suggestion-shell-role"),
      );
    }
  }

  try {
    return normalizeHomeSuggestionRole(
      window.sessionStorage.getItem(homeSuggestionRoleStorageKey(appId)),
    );
  } catch {
    // coercion-ok: a blocked hint cache uses the designed general pool.
    return "general";
  }
}

export function writeHomeSuggestionRole(
  appId: string,
  role: string | null | undefined,
): void {
  try {
    window.sessionStorage.setItem(
      homeSuggestionRoleStorageKey(appId),
      normalizeHomeSuggestionRole(role),
    );
  } catch {
    // coercion-ok: this optional cache only personalizes a later home visit.
  }
}

function parseHomeSuggestionSeed(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed >>> 0 : null;
}

function readHomeSuggestionSeed(appId: string): number {
  const shellSeed = Array.from(
    document.querySelectorAll<HTMLElement>("[data-home-suggestion-seed]"),
  ).find(
    (element) => element.getAttribute("data-home-suggestion-app-id") === appId,
  );
  const fromShell = parseHomeSuggestionSeed(
    shellSeed?.getAttribute("data-home-suggestion-seed"),
  );
  if (fromShell !== null) return fromShell;

  const fromMemory = homeSuggestionSeeds.get(appId);
  if (fromMemory !== undefined) return fromMemory;

  const fromSession = parseHomeSuggestionSeed(
    window.sessionStorage.getItem(homeSuggestionSeedStorageKey(appId)),
  );
  return fromSession ?? createHomeSuggestionSeed();
}

function writeHomeSuggestionSeed(appId: string, seed: number): void {
  homeSuggestionSeeds.set(appId, seed);
  window.sessionStorage.setItem(homeSuggestionSeedStorageKey(appId), `${seed}`);
}

function clearHomeSuggestionSeed(appId: string): void {
  homeSuggestionSeeds.delete(appId);
  window.sessionStorage.removeItem(homeSuggestionSeedStorageKey(appId));
}

export function createHomeSuggestionRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function createHomeSuggestionSeed(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  const seed = values.at(0);
  if (seed === undefined)
    throw new Error("Could not create a home suggestion seed");
  return seed;
}

export function createHomeSuggestionOrder(
  length: number,
  random: () => number,
): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const value = random();
    const offset = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
    const swapIndex = Math.floor(offset * (index + 1));
    const current = order.at(index);
    const target = order.at(swapIndex);
    if (current === undefined || target === undefined) {
      throw new Error("Could not shuffle the home suggestion order");
    }
    order[index] = target;
    order[swapIndex] = current;
  }
  return order;
}

export function HomeSuggestionSeedProvider({
  seed,
  role = "general",
  children,
}: {
  seed: number;
  role?: HomeSuggestionRoleKey;
  children: ReactNode;
}) {
  return createElement(
    HomeSuggestionSeedContext.Provider,
    { value: seed },
    createElement(
      HomeSuggestionRoleContext.Provider,
      { value: role },
      children,
    ),
  );
}

export function useHomeSuggestionSeed(): number {
  return useContext(HomeSuggestionSeedContext);
}

export function useHomeSuggestionRole(): HomeSuggestionRoleKey | null {
  return useContext(HomeSuggestionRoleContext);
}

export function useHomeSuggestionSeedForHome(
  isHome: boolean,
  appId: string,
): number {
  const [seed, setSeed] = useState(() => {
    if (typeof document === "undefined") return createHomeSuggestionSeed();
    return readHomeSuggestionSeed(appId);
  });
  const wasHome = useRef(isHome);
  const useIsomorphicLayoutEffect =
    typeof window === "undefined" ? useEffect : useLayoutEffect;

  useIsomorphicLayoutEffect(() => {
    if (isHome && !wasHome.current) {
      const nextSeed = createHomeSuggestionSeed();
      setSeed(nextSeed);
      writeHomeSuggestionSeed(appId, nextSeed);
    } else if (isHome) {
      writeHomeSuggestionSeed(appId, seed);
    } else {
      clearHomeSuggestionSeed(appId);
    }
    wasHome.current = isHome;
  }, [appId, isHome, seed]);

  return seed;
}

export interface HomeSuggestionPrompt {
  id: string;
  label: string;
  prompt?: string;
}

export type HomeSuggestionPools<T extends HomeSuggestionPrompt> = Partial<
  Record<HomeSuggestionRole, readonly T[]>
> & { general: readonly T[] };

export function normalizeHomeSuggestionRole(
  role: string | null | undefined,
): HomeSuggestionRoleKey {
  if (
    role === "product" ||
    role === "design" ||
    role === "developer" ||
    role === "marketing" ||
    role === "sales" ||
    role === "ops" ||
    role === "individual"
  ) {
    return role;
  }
  return "general";
}

export function pickHomeSuggestions<T extends HomeSuggestionPrompt>(
  pools: HomeSuggestionPools<T>,
  role: string | null | undefined,
  random: () => number = Math.random,
  selectionOrder?: readonly number[],
): T[] {
  const rolePool = pools[normalizeHomeSuggestionRole(role)];
  const source = rolePool?.length ? rolePool : pools.general;
  const seen = new Set<string>();
  const unique = source.filter((suggestion) => {
    if (seen.has(suggestion.id)) return false;
    seen.add(suggestion.id);
    return true;
  });

  const order = selectionOrder?.length
    ? selectionOrder
    : createHomeSuggestionOrder(unique.length, random);
  const selected: T[] = [];
  const seenIndexes = new Set<number>();
  for (const index of order) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= unique.length ||
      seenIndexes.has(index)
    ) {
      continue;
    }
    const suggestion = unique.at(index);
    if (suggestion === undefined) {
      throw new Error("Could not select a home suggestion");
    }
    selected.push(suggestion);
    seenIndexes.add(index);
    if (selected.length === 3) break;
  }
  if (selected.length !== Math.min(unique.length, 3)) {
    throw new Error("Could not select three distinct home suggestions");
  }
  return selected;
}
