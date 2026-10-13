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

const DesignColorTokensContext = createContext<DesignColorTokenSource | null>(
  null,
);

interface IndexedToken {
  name: string;
  cssVar: string;
  value: string;
  type: string;
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
  onTokens: (tokens: DesignColorTokens) => void;
}) {
  const query = useActionQuery<unknown>("index-design-tokens", { designId });
  const tokens = useMemo(
    () => readColorTokens({ data: query.data, isError: query.isError }),
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
  const [tokens, setTokens] = useState<DesignColorTokens>({
    status: "loading",
  });
  const request = useCallback(() => setRequested(true), []);
  useEffect(() => setTokens({ status: "loading" }), [designId]);
  const source = useMemo(
    () => (designId ? { tokens, request } : null),
    [designId, tokens, request],
  );
  return (
    <DesignColorTokensContext.Provider value={source}>
      {requested && designId ? (
        <TokenLoader key={designId} designId={designId} onTokens={setTokens} />
      ) : null}
      {children}
    </DesignColorTokensContext.Provider>
  );
}

/** The token source for the inspector's pickers, or null when none is provided. */
export function useDesignColorTokenSource(): DesignColorTokenSource | null {
  return useContext(DesignColorTokensContext);
}
