export type AgentNativeRouteWarmupStrategy =
  | "off"
  | "marked"
  | "intent"
  | "render"
  | "viewport";

const AGENT_NATIVE_ROUTE_WARMUP_STRATEGIES =
  new Set<AgentNativeRouteWarmupStrategy>([
    "off",
    "marked",
    "intent",
    "render",
    "viewport",
  ]);

export interface AgentNativeRouteWarmupResolvedConfig {
  /**
   * How unmarked internal route links are warmed.
   *
   * Links can opt in/out individually with `data-an-prefetch`:
   * - `render`: warm as soon as the link renders.
   * - `intent`: warm on hover/focus/touch.
   * - `viewport`: warm when the link scrolls into view.
   * - `none`: never warm this link.
   */
  strategy: AgentNativeRouteWarmupStrategy;
  /** Warm React Router `.data` URLs with ordinary fetches. */
  data: boolean;
  /** Warm matched route JS chunks with `modulepreload`. */
  modules: boolean;
  /** Selector for links explicitly marked for render-time warmup. */
  selector: string;
  /** Maximum concurrent `.data` fetches. */
  maxConcurrent: number;
}

export type AgentNativeRouteWarmupConfigInput =
  | boolean
  | AgentNativeRouteWarmupStrategy
  | Partial<AgentNativeRouteWarmupResolvedConfig>;

export const DEFAULT_AGENT_NATIVE_ROUTE_WARMUP_SELECTOR =
  'a[data-an-prefetch="render"][href]';

export const DEFAULT_AGENT_NATIVE_ROUTE_WARMUP_CONFIG: AgentNativeRouteWarmupResolvedConfig =
  {
    strategy: "intent",
    data: true,
    modules: true,
    selector: DEFAULT_AGENT_NATIVE_ROUTE_WARMUP_SELECTOR,
    maxConcurrent: 4,
  };

export function isAgentNativeRouteWarmupStrategy(
  value: unknown,
): value is AgentNativeRouteWarmupStrategy {
  return (
    typeof value === "string" &&
    AGENT_NATIVE_ROUTE_WARMUP_STRATEGIES.has(
      value as AgentNativeRouteWarmupStrategy,
    )
  );
}

function normalizeRouteWarmupStrategy(
  value: unknown,
  fallback = DEFAULT_AGENT_NATIVE_ROUTE_WARMUP_CONFIG.strategy,
): AgentNativeRouteWarmupStrategy {
  return isAgentNativeRouteWarmupStrategy(value) ? value : fallback;
}

function applyRouteWarmupConfigInput(
  base: AgentNativeRouteWarmupResolvedConfig,
  input: AgentNativeRouteWarmupConfigInput | undefined = true,
): AgentNativeRouteWarmupResolvedConfig {
  if (input === false) {
    return { ...base, strategy: "off" };
  }

  if (typeof input === "string") {
    return {
      ...base,
      strategy: normalizeRouteWarmupStrategy(input, base.strategy),
    };
  }

  if (input === true || input === undefined) {
    return { ...base };
  }

  return {
    ...base,
    ...input,
    strategy: normalizeRouteWarmupStrategy(input.strategy, base.strategy),
    data: typeof input.data === "boolean" ? input.data : base.data,
    modules: typeof input.modules === "boolean" ? input.modules : base.modules,
    selector:
      typeof input.selector === "string" && input.selector.trim()
        ? input.selector
        : base.selector,
    maxConcurrent:
      typeof input.maxConcurrent === "number" &&
      Number.isFinite(input.maxConcurrent) &&
      input.maxConcurrent > 0
        ? Math.floor(input.maxConcurrent)
        : base.maxConcurrent,
  };
}

export function normalizeAgentNativeRouteWarmupConfig(
  input: AgentNativeRouteWarmupConfigInput | undefined = true,
): AgentNativeRouteWarmupResolvedConfig {
  return applyRouteWarmupConfigInput(
    DEFAULT_AGENT_NATIVE_ROUTE_WARMUP_CONFIG,
    input,
  );
}

export function mergeAgentNativeRouteWarmupConfig(
  baseInput: AgentNativeRouteWarmupConfigInput | undefined,
  overrideInput: AgentNativeRouteWarmupConfigInput | undefined,
): AgentNativeRouteWarmupResolvedConfig {
  return applyRouteWarmupConfigInput(
    normalizeAgentNativeRouteWarmupConfig(baseInput),
    overrideInput,
  );
}
