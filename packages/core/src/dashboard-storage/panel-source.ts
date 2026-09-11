import { runDataProgram } from "../data-programs/index.js";

export interface DashboardPanelColumn {
  name: string;
  type: string;
}

export interface PanelSourceRequest<TSource extends string = string> {
  source: TSource;
  query: string;
}

export interface PanelSourceResult {
  rows: Record<string, unknown>[];
  schema?: DashboardPanelColumn[];
  truncated?: boolean;
  bytesProcessed?: number;
}

export interface PanelSourceFailure {
  error: string;
  message?: string;
}

export type PanelSourceResponse = PanelSourceResult | PanelSourceFailure;

export interface PanelSourceResolver<
  TSource extends string = string,
  TContext = unknown,
> {
  source: TSource;
  resolve(
    request: PanelSourceRequest<TSource>,
    context: TContext,
  ): Promise<PanelSourceResponse>;
}

export interface PanelSourceResolverRegistry<
  TSource extends string = string,
  TContext = unknown,
> {
  readonly sources: readonly TSource[];
  resolve(
    request: PanelSourceRequest<TSource>,
    context: TContext,
  ): Promise<PanelSourceResponse>;
}

export function createPanelSourceResolverRegistry<
  TSource extends string = string,
  TContext = unknown,
>(options: {
  resolvers: readonly PanelSourceResolver<TSource, TContext>[];
}): PanelSourceResolverRegistry<TSource, TContext> {
  const resolvers = new Map<TSource, PanelSourceResolver<TSource, TContext>>();
  for (const resolver of options.resolvers) {
    const source = resolver.source.trim() as TSource;
    if (!source) throw new Error("Panel source resolver requires a source.");
    if (resolvers.has(source)) {
      throw new Error(`Duplicate panel source resolver: ${source}`);
    }
    resolvers.set(source, resolver);
  }

  return {
    sources: [...resolvers.keys()],
    async resolve(request, context) {
      const resolver = resolvers.get(request.source);
      if (!resolver) {
        throw new Error(
          `Unsupported dashboard panel source: ${request.source}`,
        );
      }
      return resolver.resolve(request, context);
    },
  };
}

export interface ProgramPanelContext {
  userEmail: string;
  orgId?: string | null;
}

export interface ProgramPanelDescriptor {
  programId: string;
  params?: Record<string, unknown>;
}

export interface ProgramPanelRunResult {
  ok: boolean;
  rows?: Record<string, unknown>[];
  schema?: DashboardPanelColumn[];
  truncated?: boolean;
  lastGoodRun?: {
    rows: Record<string, unknown>[];
    schema: DashboardPanelColumn[];
    truncated?: boolean;
  };
  error?: { code: string; message: string };
}

export function parseProgramPanelDescriptor(
  query: string,
): ProgramPanelDescriptor {
  let value: unknown;
  try {
    value = JSON.parse(query);
  } catch {
    throw new Error("Program panel query must be a JSON object.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Program panel query must be a JSON object.");
  }
  const descriptor = value as Record<string, unknown>;
  if (
    typeof descriptor.programId !== "string" ||
    !descriptor.programId.trim()
  ) {
    throw new Error("Program panel query requires a programId.");
  }
  const params =
    descriptor.params &&
    typeof descriptor.params === "object" &&
    !Array.isArray(descriptor.params)
      ? (descriptor.params as Record<string, unknown>)
      : undefined;
  return { programId: descriptor.programId.trim(), params };
}

export function createProgramPanelSourceResolver(options: {
  appId: string;
  run?: (args: {
    programId: string;
    appId: string;
    params?: Record<string, unknown>;
    ctx: { userEmail: string; orgId: string | null };
    triggeredBy: "panel_view";
  }) => Promise<ProgramPanelRunResult>;
}): PanelSourceResolver<"program", ProgramPanelContext> {
  const run = options.run ?? runDataProgram;
  return {
    source: "program",
    async resolve(request, context) {
      const descriptor = parseProgramPanelDescriptor(request.query);
      const result = await run({
        programId: descriptor.programId,
        appId: options.appId,
        params: descriptor.params,
        ctx: {
          userEmail: context.userEmail,
          orgId: context.orgId ?? null,
        },
        triggeredBy: "panel_view",
      });
      if (result.ok) {
        return {
          rows: result.rows ?? [],
          schema: result.schema,
          truncated: result.truncated,
        };
      }
      if (result.lastGoodRun) return result.lastGoodRun;
      throw new Error(
        `${result.error?.code ?? "program_failed"}: ${result.error?.message ?? "Data program failed."}`,
      );
    },
  };
}
