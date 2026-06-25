/**
 * Core script: resource-effective
 *
 * Show the workspace -> organization/app -> personal inheritance stack for a
 * resource path and which layer is active.
 *
 * Usage:
 *   pnpm action resource-effective --path <path> [--format json|text]
 */

import {
  ensurePersonalDefaults,
  resourceEffectiveContext,
} from "../../resources/store.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { parseArgs, fail } from "../utils.js";

export default async function resourceEffectiveScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action resource-effective --path <path> [options]

Options:
  --path <path>        Resource path (required)
  --format json|text   Output format (default: text)
  --help               Show this help message`);
    return;
  }

  const resourcePath = parsed.path;
  if (!resourcePath) {
    fail("--path is required. Example: --path instructions/guardrails.md");
  }

  const owner = getRequestUserEmail() ?? process.env.AGENT_USER_EMAIL;
  if (!owner) {
    fail(
      "resource-effective requires an authenticated user (request context or AGENT_USER_EMAIL env var).",
    );
  }

  await ensurePersonalDefaults(owner);
  const context = await resourceEffectiveContext(owner, resourcePath);

  if (parsed.format === "json") {
    console.log(JSON.stringify(context, null, 2));
    return;
  }

  console.log(`Effective resource: ${context.path}`);
  console.log(`Active scope: ${context.effectiveScope ?? "none"}\n`);

  for (const layer of context.layers) {
    const state = layer.effective
      ? "active"
      : layer.overridden
        ? "overridden"
        : layer.exists
          ? "available"
          : "missing";
    const updated = layer.resource?.updatedAt
      ? `, updated ${new Date(layer.resource.updatedAt).toISOString()}`
      : "";
    console.log(
      `- ${layer.label} (${layer.scope}): ${state}${layer.resource ? `, id ${layer.resource.id}${updated}` : ""}`,
    );
  }
}
