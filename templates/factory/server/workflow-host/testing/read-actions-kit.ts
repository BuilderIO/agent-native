import type { z } from "zod";

import { FakeAudit, SCOPE, type World } from "./read-models-kit.js";

/**
 * Fakes for the specs of the workflow read actions. The actions run for real
 * against the PGlite world of `read-models-kit`; only the framework seams are
 * replaced: `defineAction` and `fail`, the workspace member, the factory
 * registry, the read models' database binding, and the audit reader. Each spec
 * wires them in with `vi.mock` factories that import this module, so every
 * module under test sees the same state.
 */

export const USER_EMAIL = "teammate@example.test";
export const ORG_ID = SCOPE.orgId;
export const FACTORY_ID = SCOPE.factoryId;
export const OTHER_FACTORY_ID = "factory-2";

export { actionModule } from "./action-module.js";

interface Bound {
  world: World;
  audit: FakeAudit;
  org: string;
  factories: Set<string>;
}

let bound: Bound | undefined;

function current(): Bound {
  if (!bound) throw new Error("bind() a world before running an action.");
  return bound;
}

/** A new world for the next test; the caller is a member of the first org. */
export function bind(world: World): FakeAudit {
  const audit = new FakeAudit();
  bound = {
    world,
    audit,
    org: ORG_ID,
    factories: new Set([
      `${ORG_ID}/${FACTORY_ID}`,
      `${ORG_ID}/${OTHER_FACTORY_ID}`,
      "org-2/factory-1",
    ]),
  };
  return audit;
}

/** Makes the caller a member of another organization. */
export function callAsOrg(orgId: string): void {
  current().org = orgId;
}

export const readModelsModule = {
  getWorkflowReadModels: () => current().world.models,
};

export const memberModule = {
  requireWorkspaceMember: async () => ({
    userEmail: USER_EMAIL,
    orgId: current().org,
    role: "member",
  }),
  workspaceMemberIdentityFromContext: () => ({
    userEmail: USER_EMAIL,
    orgId: current().org,
  }),
};

export const factoryDefinitionsModule = {
  readFactoryDefinition: async (orgId: string, factoryId: string) =>
    current().factories.has(`${orgId}/${factoryId}`)
      ? { id: factoryId, orgId }
      : undefined,
};

export const auditModule = {
  resolveAuditReadScope: async (ctx: Record<string, unknown>) => ({ ...ctx }),
  queryAuditEventPage: async (
    _scope: unknown,
    query: Parameters<FakeAudit["readAudit"]>[0],
  ) => current().audit.readAudit(query),
  getAuditEventById: async (id: string) => current().audit.readAuditEvent(id),
};

export const context = { userEmail: USER_EMAIL, caller: "frontend" } as const;

interface TypedFailure extends Error {
  errorCode: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

type ActionShape = {
  schema: z.ZodType;
  run: (input: never, context: unknown) => Promise<unknown>;
};

/** Runs an action as the framework does: the input goes through the schema first, so defaults and bounds apply. */
export function runOf(
  action: unknown,
): (input: Record<string, unknown>) => Promise<any> {
  const definition = action as ActionShape;
  return (input) =>
    definition.run(definition.schema.parse(input) as never, context);
}

export function schemaOf(action: unknown): z.ZodType {
  return (action as ActionShape).schema;
}

/** The typed failure a call raises; the spec fails if it raises none. */
export async function failureOf(
  run: () => Promise<unknown>,
): Promise<TypedFailure> {
  try {
    await run();
  } catch (error) {
    return error as TypedFailure;
  }
  throw new Error("Expected the call to fail.");
}
