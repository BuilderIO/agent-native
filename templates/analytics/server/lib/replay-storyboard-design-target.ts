import {
  assertCredentialedA2AUrl,
  resolveAgentInvocationTarget,
} from "@agent-native/core/a2a";
import {
  getBuiltinAgents,
  getBuiltinAgentsForSeeding,
} from "@agent-native/core/server/agent-discovery";

export type ReplayStoryboardDesignTargetClass =
  | "beta_design"
  | "production_design"
  | "configured_design";

export type ReplayStoryboardDesignTargetFailureCode =
  | "discovery_unavailable"
  | "target_unavailable"
  | "target_mismatch"
  | "unsafe_target";

export type ReplayStoryboardDesignTargetResult =
  | {
      code: "ready";
      targetClass: ReplayStoryboardDesignTargetClass;
      url: string;
    }
  | {
      code: "notready";
      failureCode: ReplayStoryboardDesignTargetFailureCode;
      targetClass: ReplayStoryboardDesignTargetClass;
    };

type TargetUrlParseResult =
  | { kind: "parsed"; url: URL }
  | { kind: "invalid"; reason: "malformed" };

type SafeTargetUrlResult =
  | { kind: "safe"; url: URL }
  | { kind: "invalid"; reason: "malformed" | "unsafe" };

type ProductionTargetLookup =
  | { kind: "available"; url: string | undefined }
  | { kind: "unavailable" };

function parseTargetUrl(value: string): TargetUrlParseResult {
  try {
    return { kind: "parsed", url: new URL(value) };
  } catch {
    return { kind: "invalid", reason: "malformed" };
  }
}

function safeTargetUrl(value: string): SafeTargetUrlResult {
  const parsed = parseTargetUrl(value);
  if (parsed.kind === "invalid") return parsed;
  const { url } = parsed;

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  ) {
    return { kind: "invalid", reason: "unsafe" };
  }

  try {
    assertCredentialedA2AUrl(value, true);
  } catch {
    return { kind: "invalid", reason: "unsafe" };
  }
  return { kind: "safe", url };
}

function sameEndpoint(left: URL, right: URL): boolean {
  return (
    left.origin === right.origin &&
    left.pathname.replace(/\/$/, "") === right.pathname.replace(/\/$/, "")
  );
}

function targetClassForUrl(
  value: string | undefined,
  productionTarget: ProductionTargetLookup,
): ReplayStoryboardDesignTargetClass {
  if (!value) return "configured_design";
  const parsed = parseTargetUrl(value);
  if (parsed.kind === "invalid") return "configured_design";
  const { url } = parsed;

  if (url.hostname === "beta.design.agent-native.com") return "beta_design";
  return productionTargetClassForUrl(url, productionTarget);
}

function productionTargetClassForUrl(
  url: URL,
  productionTarget: ProductionTargetLookup,
): "production_design" | "configured_design" {
  if (productionTarget.kind === "unavailable") return "configured_design";
  if (!productionTarget.url) return "configured_design";

  const production = parseTargetUrl(productionTarget.url);
  if (production.kind === "invalid") return "configured_design";
  return sameEndpoint(url, production.url)
    ? "production_design"
    : "configured_design";
}

function readProductionTargetLookup(): ProductionTargetLookup {
  try {
    return {
      kind: "available",
      url: getBuiltinAgentsForSeeding().find((agent) => agent.id === "design")
        ?.url,
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function resolveReplayStoryboardDesignTarget(): Promise<ReplayStoryboardDesignTargetResult> {
  let builtinTarget: ReturnType<typeof getBuiltinAgents>[number] | undefined;
  try {
    builtinTarget = getBuiltinAgents("analytics").find(
      (agent) => agent.id === "design",
    );
  } catch {
    return {
      code: "notready",
      failureCode: "discovery_unavailable",
      targetClass: "configured_design",
    };
  }
  const productionTarget = readProductionTargetLookup();
  if (!builtinTarget) {
    return {
      code: "notready",
      failureCode: "target_unavailable",
      targetClass: "configured_design",
    };
  }
  let resolvedTarget: Awaited<ReturnType<typeof resolveAgentInvocationTarget>>;
  try {
    resolvedTarget = await resolveAgentInvocationTarget("design", {
      selfAppId: "analytics",
    });
  } catch {
    return {
      code: "notready",
      failureCode: "discovery_unavailable",
      targetClass: targetClassForUrl(builtinTarget?.url, productionTarget),
    };
  }

  if (
    !resolvedTarget ||
    typeof resolvedTarget.id !== "string" ||
    typeof resolvedTarget.url !== "string"
  ) {
    return {
      code: "notready",
      failureCode: "discovery_unavailable",
      targetClass: targetClassForUrl(builtinTarget.url, productionTarget),
    };
  }
  const targetClass = targetClassForUrl(resolvedTarget.url, productionTarget);
  const expectedUrl = builtinTarget.url;
  const expected = expectedUrl ? safeTargetUrl(expectedUrl) : undefined;
  const resolved = safeTargetUrl(resolvedTarget.url);
  if (expected?.kind !== "safe" || resolved.kind !== "safe") {
    return { code: "notready", failureCode: "unsafe_target", targetClass };
  }
  if (
    resolvedTarget.id !== "design" ||
    !sameEndpoint(expected.url, resolved.url)
  ) {
    return { code: "notready", failureCode: "target_mismatch", targetClass };
  }

  return { code: "ready", targetClass, url: resolvedTarget.url };
}
