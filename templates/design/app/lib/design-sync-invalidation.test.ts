import { describe, expect, it } from "vitest";

import { shouldInvalidateDesignQueryForSync } from "./design-sync-invalidation";

const query = (name: string, args: unknown = { designId: "d1" }) => ({
  queryKey: ["action", name, args] as const,
});

const fileSave = {
  source: "action",
  key: "update-file",
  resourceType: "design",
  resourceId: "d1",
  requestSource: "tab-b",
};
const yjsUpdate = {
  source: "collab",
  requestSource: "tab-b",
  resourceType: "design",
  resourceId: "d1",
};

const DEPENDS_ON_CONTENT = [
  "get-design",
  "get-motion-timeline",
  "index-design-tokens",
  "list-source-files",
  "read-source-file",
  "list-design-components",
  "list-designs",
];
const UNRELATED = [
  "get-lab-states",
  "get-feature-flags",
  "get-agentkit-capabilities",
  "list-localhost-connections",
  "get-localhost-write-consent-request",
  "get-visual-edit-pending",
  "list-resource-shares",
  "list-review-comments",
];

describe("design sync invalidation", () => {
  it("refetches what depends on a collaborator's file save and Yjs updates", () => {
    for (const name of DEPENDS_ON_CONTENT) {
      expect(
        shouldInvalidateDesignQueryForSync(query(name), [fileSave, yjsUpdate]),
      ).toBe(true);
      expect(shouldInvalidateDesignQueryForSync(query(name), [yjsUpdate])).toBe(
        true,
      );
    }
  });

  it("leaves unrelated reads alone for a batch of design content only", () => {
    for (const name of UNRELATED) {
      expect(
        shouldInvalidateDesignQueryForSync(query(name), [fileSave, yjsUpdate]),
      ).toBe(false);
    }
  });

  it("ignores app-state and awareness events when judging the batch", () => {
    const events = [
      fileSave,
      { source: "app-state", key: "design-selection" },
      { source: "awareness" },
    ];
    expect(
      shouldInvalidateDesignQueryForSync(query("get-lab-states"), events),
    ).toBe(false);
  });

  it("refetches everything once any event is not design content", () => {
    for (const other of [
      {
        source: "action",
        key: "create-review-comment",
        resourceType: "design",
      },
      { source: "action", key: "update-file" },
      { source: "action", key: "share-resource", resourceType: "design" },
      { source: "settings", key: "active-org-id" },
    ]) {
      for (const name of UNRELATED) {
        expect(
          shouldInvalidateDesignQueryForSync(query(name), [fileSave, other]),
        ).toBe(true);
      }
    }
  });

  it("keeps collab events without a valid design scope on the broad fallback", () => {
    for (const event of [
      { source: "collab", requestSource: "tab-b" },
      {
        source: "collab",
        requestSource: "tab-b",
        resourceType: "design",
        resourceId: "",
      },
      {
        source: "collab",
        requestSource: "tab-b",
        resourceType: "document",
        resourceId: "d1",
      },
    ]) {
      for (const name of UNRELATED) {
        expect(shouldInvalidateDesignQueryForSync(query(name), [event])).toBe(
          true,
        );
      }
    }
  });

  it("refetches version history when a design save may have checkpointed", () => {
    const versions = query("list-design-versions");
    expect(shouldInvalidateDesignQueryForSync(versions, [fileSave])).toBe(true);
    expect(
      shouldInvalidateDesignQueryForSync(versions, [
        { ...fileSave, requestSource: "agent" },
      ]),
    ).toBe(true);
    expect(
      shouldInvalidateDesignQueryForSync(versions, [
        { ...fileSave, requestSource: undefined },
      ]),
    ).toBe(true);
    expect(shouldInvalidateDesignQueryForSync(versions, [yjsUpdate])).toBe(
      false,
    );
  });

  it("never matches queries outside the action namespace", () => {
    expect(
      shouldInvalidateDesignQueryForSync({ queryKey: ["designs"] }, [fileSave]),
    ).toBe(false);
  });
});
