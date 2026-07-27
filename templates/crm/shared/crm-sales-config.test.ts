import { describe, expect, it } from "vitest";

import {
  CRM_SALES_ROUTINE_LOCAL_POLICY_ID,
  resolveCrmSalesDelegatedWrite,
} from "./crm-sales-config.js";

const routineLocalUpdate = {
  initiatedBy: "automation" as const,
  target: "local" as const,
  reversibility: "compensatable" as const,
  scope: "single-record" as const,
  risk: "routine" as const,
  delegatedAuthority: false,
  storedAutomationPolicy: false,
};

describe("CRM sales config pack", () => {
  it("grants only its stored routine local-update policy to trusted automation context", () => {
    expect(
      resolveCrmSalesDelegatedWrite({
        context: {
          caller: "automation",
          automation: {
            triggerId: "trigger-1",
            triggerName: "follow-up",
            policyId: CRM_SALES_ROUTINE_LOCAL_POLICY_ID,
          },
        },
        operation: "update",
        policy: routineLocalUpdate,
      }),
    ).toEqual({ delegatedAuthority: true, storedAutomationPolicy: true });
  });

  it("fails closed for provider, risky, and untrusted calls", () => {
    for (const [context, policy] of [
      [
        {
          caller: "automation" as const,
          automation: {
            triggerId: "trigger-1",
            triggerName: "follow-up",
            policyId: CRM_SALES_ROUTINE_LOCAL_POLICY_ID,
          },
        },
        { ...routineLocalUpdate, target: "provider" as const },
      ],
      [
        {
          caller: "automation" as const,
          automation: {
            triggerId: "trigger-1",
            triggerName: "follow-up",
            policyId: CRM_SALES_ROUTINE_LOCAL_POLICY_ID,
          },
        },
        { ...routineLocalUpdate, risk: "stage" as const },
      ],
      [{ caller: "tool" as const }, routineLocalUpdate],
    ] as const) {
      expect(
        resolveCrmSalesDelegatedWrite({
          context,
          operation: "update",
          policy,
        }),
      ).toEqual({ delegatedAuthority: false, storedAutomationPolicy: false });
    }
  });
});
