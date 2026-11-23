import { z } from "zod";

import { releaseIdSchema } from "./notebook-execution.js";
import {
  notebookCellIdSchema,
  notebookProjectIdSchema,
  workspaceIdSchema,
} from "./notebook-snapshot-contract.js";

export const CONTRACT_VERSION = 1;

const key = z.string().min(1);
const routeIdSchema = key.brand<"RouteId">();
export const controlIdSchema = key.brand<"ControlId">();
export type ControlId = z.infer<typeof controlIdSchema>;

const workspace = z.strictObject({ workspaceId: workspaceIdSchema });
const project = workspace.extend({ projectId: notebookProjectIdSchema });
export const capabilityScopeRefSchema = z.discriminatedUnion("kind", [
  workspace.extend({ kind: z.literal("workspace") }),
  project.extend({ kind: z.literal("project") }),
  project.extend({ kind: z.literal("cell"), cellId: notebookCellIdSchema }),
  project.extend({ kind: z.literal("release"), releaseId: releaseIdSchema }),
  workspace.extend({
    kind: z.literal("connection"),
    connectionId: key.brand<"ConnectionId">(),
  }),
]);
export type CapabilityScopeRef = z.infer<typeof capabilityScopeRefSchema>;

export const capabilityTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("action"), actionName: key }),
  z.strictObject({ kind: z.literal("route"), routeId: routeIdSchema }),
  z.strictObject({ kind: z.literal("local-transition"), transition: key }),
]);
export type CapabilityTarget = z.infer<typeof capabilityTargetSchema>;

const capabilityReadbackSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("action"), actionName: key }),
  z.strictObject({ kind: z.literal("route"), routeId: routeIdSchema }),
  z.strictObject({ kind: z.literal("local-state"), stateKey: key }),
]);

export const capabilityDefinitionSchema = z.strictObject({
  controlId: controlIdSchema,
  surfaces: z.array(key).min(1),
  aliases: z.array(controlIdSchema),
  resourceKind: z.enum([
    "workspace",
    "project",
    "cell",
    "release",
    "connection",
  ]),
  target: capabilityTargetSchema,
  prerequisites: z.array(
    z.enum([
      "workspace_permission",
      "resource_permission",
      "source_permission",
      "provider_ready",
      "worker_ready",
    ]),
  ),
  postcondition: capabilityReadbackSchema,
});
export type CapabilityDefinition = z.infer<typeof capabilityDefinitionSchema>;

const scopedDecision = z.strictObject({
  controlId: controlIdSchema,
  scope: capabilityScopeRefSchema,
});
const allowedCapability = scopedDecision.extend({
  status: z.literal("allowed"),
  target: capabilityTargetSchema,
});

export const capabilityDecisionSchema = z.discriminatedUnion("status", [
  allowedCapability,
  scopedDecision.extend({
    status: z.literal("absent"),
    reason: z.enum(["unknown_control", "not_found"]),
  }),
  scopedDecision.extend({
    status: z.literal("unavailable"),
    reason: z.enum(["unsupported", "missing_backing"]),
  }),
  scopedDecision.extend({
    status: z.literal("denied"),
    reason: z.enum([
      "wrong_workspace",
      "access_denied",
      "source_access_denied",
    ]),
  }),
  scopedDecision.extend({
    status: z.literal("unreadable"),
    reason: z.enum(["read_failed", "readiness_unknown"]),
  }),
  scopedDecision.extend({
    status: z.literal("pending"),
    reason: z.literal("not_ready"),
  }),
]);
export type CapabilityDecision = z.infer<typeof capabilityDecisionSchema>;
export type CapabilityReasonCode = Exclude<
  CapabilityDecision,
  { status: "allowed" }
>["reason"];

export interface CapabilityPolicy {
  evaluateCapability(
    controlId: ControlId,
    scope: CapabilityScopeRef,
  ): Promise<CapabilityDecision>;
  requireCapability(
    controlId: ControlId,
    scope: CapabilityScopeRef,
  ): Promise<CapabilityDecision>;
}
