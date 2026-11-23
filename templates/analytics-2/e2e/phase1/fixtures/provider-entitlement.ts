import { randomUUID } from "node:crypto";

import { z } from "zod";

import { FixtureControlError } from "./control-server.js";

export const entitlementInput = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("warehouse-create-entitlement"),
    colleagueEmail: z.email(),
  }),
  z.strictObject({
    operation: z.literal("warehouse-revoke-entitlement"),
    fixtureId: z.uuid(),
  }),
  z.strictObject({
    operation: z.literal("warehouse-restore-entitlement"),
    fixtureId: z.uuid(),
  }),
]);
export type EntitlementInput = z.infer<typeof entitlementInput>;

const groupSchema = z.object({
  id: z.string().min(1),
  memberEmails: z.array(z.string()),
});

export function entitlementControl(deps: {
  action: (name: string, input: object, uiOnly?: boolean) => Promise<unknown>;
  credential: string;
  projectId: string;
}) {
  const fixtures = new Map<
    string,
    { groupId: string; name: string; colleagueEmail: string }
  >();
  return async (input: EntitlementInput) => {
    if (input.operation === "warehouse-create-entitlement") {
      const fixtureId = randomUUID();
      const name = `Phase 1 entitlement ${fixtureId}`;
      const colleagueEmail = input.colleagueEmail.toLowerCase();
      const group = groupSchema.parse(
        await deps.action("upsert-workspace-user-group", {
          name,
          memberEmails: [colleagueEmail],
        }),
      );
      if (!group.memberEmails.includes(colleagueEmail))
        throw new Error("Fixture group did not grant the colleague membership");
      const source = z.object({ id: z.string().min(1) }).parse(
        await deps.action(
          "save-data-connection",
          {
            requestId: randomUUID(),
            type: "bigquery",
            draft: false,
            values: {
              name,
              projectId: deps.projectId,
              serviceAccount: deps.credential,
              datasetNames: "a2_parity",
              includeForAI: true,
              queryAccessGroupIds: [group.id],
              viewAccessGroupIds: [group.id],
              useBQStorageAPI: false,
            },
          },
          true,
        ),
      );
      fixtures.set(fixtureId, { groupId: group.id, name, colleagueEmail });
      return { fixtureId, connectionId: source.id };
    }
    const fixture = fixtures.get(input.fixtureId);
    if (!fixture)
      throw new FixtureControlError("Unknown scoped entitlement fixture", 404);
    const memberEmails =
      input.operation === "warehouse-revoke-entitlement"
        ? []
        : [fixture.colleagueEmail];
    const group = groupSchema.parse(
      await deps.action("upsert-workspace-user-group", {
        id: fixture.groupId,
        name: fixture.name,
        memberEmails,
      }),
    );
    if (
      group.id !== fixture.groupId ||
      group.memberEmails.length !== memberEmails.length ||
      !memberEmails.every((email) => group.memberEmails.includes(email))
    )
      throw new Error("Fixture membership did not match the requested state");
    return { fixtureId: input.fixtureId, entitled: memberEmails.length > 0 };
  };
}
