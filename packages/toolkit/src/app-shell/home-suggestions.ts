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

export function HomeSuggestionSeedProvider({
  seed,
  children,
}: {
  seed: number;
  children: ReactNode;
}) {
  return createElement(
    HomeSuggestionSeedContext.Provider,
    { value: seed },
    children,
  );
}

export function useHomeSuggestionSeed(): number {
  return useContext(HomeSuggestionSeedContext);
}

export function useHomeSuggestionSeedForHome(isHome: boolean): number {
  const [seed, setSeed] = useState(() => {
    if (typeof document === "undefined") return createHomeSuggestionSeed();
    const serialized = document
      .querySelector("[data-home-suggestion-seed]")
      ?.getAttribute("data-home-suggestion-seed");
    const parsed = Number(serialized);
    return serialized && Number.isInteger(parsed) && parsed >= 0
      ? parsed >>> 0
      : createHomeSuggestionSeed();
  });
  const wasHome = useRef(isHome);
  const useIsomorphicLayoutEffect =
    typeof window === "undefined" ? useEffect : useLayoutEffect;

  useIsomorphicLayoutEffect(() => {
    if (isHome && !wasHome.current) setSeed(createHomeSuggestionSeed());
    wasHome.current = isHome;
  }, [isHome]);

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
): T[] {
  const rolePool = pools[normalizeHomeSuggestionRole(role)];
  const source = rolePool?.length ? rolePool : pools.general;
  const seen = new Set<string>();
  const unique = source.filter((suggestion) => {
    if (seen.has(suggestion.id)) return false;
    seen.add(suggestion.id);
    return true;
  });

  for (let index = unique.length - 1; index > 0; index -= 1) {
    const value = random();
    const offset = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
    const swapIndex = Math.floor(offset * (index + 1));
    const current = unique.at(index);
    const target = unique.at(swapIndex);
    if (current === undefined || target === undefined) {
      throw new Error("Could not shuffle the home suggestion pool");
    }
    unique[index] = target;
    unique[swapIndex] = current;
  }

  return unique.slice(0, 3);
}
