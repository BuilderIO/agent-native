import { describe, expect, it, vi } from "vitest";

import { resolveDesignSystemGenerationSelection } from "./design-system-generation-selection.js";

const ref = { id: "system", ownerApp: "design" as const, consumedRevision: 11 };
const reader = () => ({
  run: vi.fn(
    async ({
      id,
      ownerApp,
      consumedRevision,
    }: {
      id: string;
      ownerApp?: string;
      consumedRevision?: number;
    }) => ({
      id,
      title: "System",
      agentContext: "Actual tokens",
      reference: { systemId: id, ownerApp, revision: consumedRevision ?? 11 },
    }),
  ),
});
describe("native generation system selection", () => {
  it("derives an actual reference for a legacy ID and preserves a repeated ID's existing pin", async () => {
    const read = reader();
    expect(
      await resolveDesignSystemGenerationSelection(
        { ownerApp: "design", designSystemId: "system" },
        read,
      ),
    ).toMatchObject({ designSystemId: "system", designSystemRef: ref });
    expect(
      await resolveDesignSystemGenerationSelection(
        {
          ownerApp: "design",
          designSystemId: "system",
          existingReference: ref,
        },
        read,
      ),
    ).toMatchObject({ designSystemRef: ref });
    expect(read.run).toHaveBeenLastCalledWith({
      id: "system",
      ownerApp: "design",
      consumedRevision: 11,
      compact: "true",
    });
  });
  it("keeps foreign identities out of the local ID column and retains an omitted ref", async () => {
    const read = reader();
    expect(
      await resolveDesignSystemGenerationSelection(
        { ownerApp: "slides", designSystemRef: ref },
        read,
      ),
    ).toMatchObject({ designSystemId: null, designSystemRef: ref });
    expect(
      await resolveDesignSystemGenerationSelection(
        { ownerApp: "slides", existingReference: ref },
        read,
      ),
    ).toMatchObject({ designSystemId: null, designSystemRef: ref });
  });
  it("honors explicit null and rejects conflicting owner/local IDs", async () => {
    const read = reader();
    expect(
      await resolveDesignSystemGenerationSelection(
        { ownerApp: "design", designSystemRef: null, existingReference: ref },
        read,
      ),
    ).toMatchObject({ designSystemId: null, designSystemRef: null });
    expect(read.run).not.toHaveBeenCalled();
    await expect(
      resolveDesignSystemGenerationSelection(
        { ownerApp: "slides", designSystemRef: ref, designSystemId: "system" },
        read,
      ),
    ).rejects.toMatchObject({ errorCode: "design_system_selection_conflict" });
  });
  it.each([403, 409])(
    "propagates scoped read failures without fallback (%s)",
    async (statusCode) => {
      const read = reader();
      read.run.mockRejectedValueOnce(
        Object.assign(new Error("not available"), { statusCode }),
      );
      await expect(
        resolveDesignSystemGenerationSelection(
          { ownerApp: "slides", designSystemRef: ref },
          read,
        ),
      ).rejects.toMatchObject({ statusCode });
      expect(read.run).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects missing or different resolved revision instead of inventing zero or accepting latest", async () => {
    const read = {
      run: vi.fn(async () => ({
        id: "system",
        title: "System",
        agentContext: "Actual tokens",
      })),
    };
    await expect(
      resolveDesignSystemGenerationSelection(
        { ownerApp: "design", designSystemId: "system" },
        read,
      ),
    ).rejects.toMatchObject({
      errorCode: "design_system_reference_unresolved",
    });
    const changed = {
      run: async () => ({
        id: "system",
        title: "System",
        agentContext: "Changed",
        reference: { systemId: "system", ownerApp: "design", revision: 12 },
      }),
    };
    await expect(
      resolveDesignSystemGenerationSelection(
        { ownerApp: "design", designSystemRef: ref },
        changed,
      ),
    ).rejects.toMatchObject({
      errorCode: "design_system_reference_unresolved",
    });
  });
});
