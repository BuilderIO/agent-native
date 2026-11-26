import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  DesignColorToken,
  DesignColorTokens,
} from "../inspector/color-picker-tokens";

/**
 * The design's color tokens for the inspector's color pickers. The list comes
 * from `index-design-tokens`, which reads every screen, so nothing is fetched
 * until a picker opens or a fill is already written as `var(--token)`.
 */

export interface DesignColorTokenSource {
  tokens: DesignColorTokens;
  /** Starts loading the token list; a no-op once requested. */
  request: () => void;
}

export interface DesignToken {
  cssVar: string;
  value: string;
  type: string;
}

export type DesignTokenList =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; tokens: DesignToken[] };

export interface DesignTokenSource {
  tokens: DesignTokenList;
  request: () => void;
}

interface DesignTokensContextValue {
  colors: DesignColorTokenSource;
  all: DesignTokenSource;
}

const DesignTokensContext = createContext<DesignTokensContextValue | null>(
  null,
);

interface IndexedToken {
  name: string;
  cssVar: string;
  value: string;
  type: string;
}

export function readDesignTokens(query: {
  data: unknown;
  isError: boolean;
}): DesignTokenList {
  const data = query.data;
  if (data === undefined || data === null) {
    return query.isError ? { status: "error" } : { status: "loading" };
  }
  const tokens = (data as { tokens?: unknown }).tokens;
  if (!Array.isArray(tokens)) return { status: "error" };
  const list: DesignToken[] = [];
  for (const entry of tokens as IndexedToken[]) {
    if (
      typeof entry.cssVar !== "string" ||
      typeof entry.value !== "string" ||
      typeof entry.type !== "string"
    ) {
      continue;
    }
    list.push({ cssVar: entry.cssVar, value: entry.value, type: entry.type });
  }
  return { status: "ready", tokens: list };
}

/**
 * The color tokens in an `index-design-tokens` answer. A payload that is not
 * the expected list is an error, not an empty design.
 */
export function readColorTokens(query: {
  data: unknown;
  isError: boolean;
}): DesignColorTokens {
  const data = query.data;
  if (data === undefined || data === null) {
    return query.isError ? { status: "error" } : { status: "loading" };
  }
  const tokens = (data as { tokens?: unknown }).tokens;
  if (!Array.isArray(tokens)) return { status: "error" };
  const colors: DesignColorToken[] = [];
  for (const entry of tokens as IndexedToken[]) {
    if (
      entry?.type !== "color" ||
      typeof entry.cssVar !== "string" ||
      typeof entry.value !== "string"
    ) {
      continue;
    }
    colors.push({
      name: typeof entry.name === "string" ? entry.name : entry.cssVar,
      cssVar: entry.cssVar,
      value: entry.value,
    });
  }
  return { status: "ready", tokens: colors };
}

function TokenLoader({
  designId,
  onTokens,
}: {
  designId: string;
  onTokens: (tokens: {
    colors: DesignColorTokens;
    all: DesignTokenList;
  }) => void;
}) {
  const query = useActionQuery<unknown>("index-design-tokens", {
    designId,
    compact: true,
  });
  const tokens = useMemo(
    () => ({
      colors: readColorTokens({ data: query.data, isError: query.isError }),
      all: readDesignTokens({ data: query.data, isError: query.isError }),
    }),
    [query.data, query.isError],
  );
  useEffect(() => onTokens(tokens), [tokens, onTokens]);
  return null;
}

export function DesignColorTokensProvider({
  designId,
  children,
}: {
  designId: string | undefined;
  children: ReactNode;
}) {
  const [requested, setRequested] = useState(false);
  const [loaded, setLoaded] = useState<{
    designId: string;
    tokens: { colors: DesignColorTokens; all: DesignTokenList };
  } | null>(null);
  const request = useCallback(() => setRequested(true), []);
  const onTokens = useCallback(
    (next: { colors: DesignColorTokens; all: DesignTokenList }) => {
      if (designId) setLoaded({ designId, tokens: next });
    },
    [designId],
  );
  const tokens =
    loaded && loaded.designId === designId ? loaded.tokens : LOADING_TOKENS;
  const value = useMemo(
    () =>
      designId
        ? {
            colors: { tokens: tokens.colors, request },
            all: { tokens: tokens.all, request },
          }
        : null,
    [designId, tokens, request],
  );
  return (
    <DesignTokensContext.Provider value={value}>
      {requested && designId ? (
        <TokenLoader key={designId} designId={designId} onTokens={onTokens} />
      ) : null}
      {children}
    </DesignTokensContext.Provider>
  );
}

const LOADING_TOKENS = {
  colors: { status: "loading" },
  all: { status: "loading" },
} as const satisfies { colors: DesignColorTokens; all: DesignTokenList };

/** The token source for the inspector's pickers, or null when none is provided. */
export function useDesignColorTokenSource(): DesignColorTokenSource | null {
  return useContext(DesignTokensContext)?.colors ?? null;
}

export function useDesignTokenSource(): DesignTokenSource | null {
  return useContext(DesignTokensContext)?.all ?? null;
}
