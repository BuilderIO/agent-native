// @vitest-environment happy-dom

import type { AgentChatContextItem } from "@agent-native/core/client/agent-chat";
import { describe, expect, it } from "vitest";

import {
  composerContextFits,
  snapshotComposerContextItems,
} from "../../composer/context-items.js";
import {
  mergeHiddenComposerContextItems,
  partitionComposerContextItemsForComposer,
} from "./AgentKitAssistantChat.js";

const NAMESPACE = "analytics-app:org:qa-workspace";
const THREAD_ID = "thread-1";

function item(
  key: string,
  context: string,
  overrides: Partial<AgentChatContextItem> = {},
): AgentChatContextItem {
  return { key, title: key, context, ...overrides };
}

function submit(
  visible: readonly AgentChatContextItem[],
  hidden: readonly AgentChatContextItem[],
) {
  return snapshotComposerContextItems(
    mergeHiddenComposerContextItems(visible, hidden),
  );
}

describe("hidden composer context items", () => {
  it("removes only the named chip and restores it once in the submitted snapshot", () => {
    const resourceKey = `${NAMESPACE}:resource`;
    const resource = item(resourceKey, "Resource context: workspace-app:qa", {
      contextNamespace: NAMESPACE,
    });
    const selection = item("selection:quote", "Selected report rows");
    const partition = partitionComposerContextItemsForComposer(
      [resource, selection],
      [resourceKey],
      NAMESPACE,
      THREAD_ID,
    );

    expect(partition.visible.map(({ key }) => key)).toEqual([selection.key]);
    expect(partition.hidden.map(({ key }) => key)).toEqual([resourceKey]);

    // PromptComposer hands the adapter a frozen snapshot of only the chips it
    // rendered. The adapter must reattach the hidden registered item.
    const composerVisibleSnapshot = snapshotComposerContextItems(
      partition.visible,
    )!;
    const submitted = submit(composerVisibleSnapshot, partition.hidden);
    expect(submitted?.filter(({ key }) => key === resourceKey)).toHaveLength(1);
    expect(submitted?.map(({ key }) => key)).toEqual([
      selection.key,
      resourceKey,
    ]);
  });

  it("keeps ordinary context visible and in the same submission position", () => {
    const resourceKey = `${NAMESPACE}:resource`;
    const ordinary = [
      item("selection:quote", "Selected report rows"),
      item("table:orders", "Orders table"),
    ];
    const partition = partitionComposerContextItemsForComposer(
      [ordinary[0], item(resourceKey, "Resource context"), ordinary[1]],
      [resourceKey],
      NAMESPACE,
      THREAD_ID,
    );

    expect(partition.visible).toEqual(ordinary);
    expect(
      submit(partition.visible, partition.hidden)?.map(({ key }) => key),
    ).toEqual([ordinary[0].key, ordinary[1].key, resourceKey]);
  });

  it("never injects a matching key registered under another namespace", () => {
    const resourceKey = `${NAMESPACE}:resource`;
    const foreign = item(resourceKey, "Other workspace resource", {
      contextNamespace: "analytics-app:org:other-workspace",
    });
    const partition = partitionComposerContextItemsForComposer(
      [foreign],
      [resourceKey],
      NAMESPACE,
      THREAD_ID,
    );

    expect(partition.hidden).toEqual([]);
    expect(partition.visible).toEqual([foreign]);
    expect(
      submit(partition.visible, partition.hidden)?.map(({ key }) => key),
    ).toEqual([foreign.key]);
  });

  it("never injects a matching key scoped to another thread", () => {
    const resourceKey = `${NAMESPACE}:resource`;
    const foreign = item(resourceKey, "Other thread resource", {
      contextNamespace: NAMESPACE,
      targetThreadId: "thread-2",
    });
    const partition = partitionComposerContextItemsForComposer(
      [foreign],
      [resourceKey],
      NAMESPACE,
      THREAD_ID,
    );

    expect(partition.hidden).toEqual([]);
    expect(
      submit(partition.visible, partition.hidden)?.map(({ key }) => key),
    ).toEqual([foreign.key]);
  });

  it("keeps the composer's own copy when it already submitted the hidden item", () => {
    const resourceKey = `${NAMESPACE}:resource`;
    const registered = item(resourceKey, "Registered resource context");
    const submittedByComposer = item(resourceKey, "Fresh resource context");

    expect(
      mergeHiddenComposerContextItems([submittedByComposer], [registered]),
    ).toEqual([submittedByComposer]);
  });

  it("still applies readiness validation to a hidden item", () => {
    const resourceKey = `${NAMESPACE}:resource`;
    const loadingItem = {
      key: resourceKey,
      title: resourceKey,
      context: "Resource context",
      status: "loading",
      statusMessage: "Loading resource",
    } as unknown as AgentChatContextItem;
    const partition = partitionComposerContextItemsForComposer(
      [loadingItem],
      [resourceKey],
      NAMESPACE,
      THREAD_ID,
    );
    const merged = mergeHiddenComposerContextItems(
      partition.visible,
      partition.hidden,
    );

    expect(() => snapshotComposerContextItems(merged)).toThrow(/not ready/i);
    expect(() => composerContextFits(merged)).toThrow(/not ready/i);
  });

  it("defaults to the previous visible-and-submitted behavior", () => {
    const resource = item(`${NAMESPACE}:resource`, "Resource context", {
      contextNamespace: NAMESPACE,
    });
    const selection = item("selection:quote", "Selected report rows", {
      contextNamespace: NAMESPACE,
    });
    const partition = partitionComposerContextItemsForComposer(
      [resource, selection],
      undefined,
      NAMESPACE,
      THREAD_ID,
    );

    expect(partition.visible).toEqual([resource, selection]);
    expect(partition.hidden).toEqual([]);
    expect(
      submit(partition.visible, partition.hidden)?.map(({ key }) => key),
    ).toEqual([resource.key, selection.key]);
  });

  it("ignores blank hidden keys instead of hiding an unnamed item", () => {
    const partition = partitionComposerContextItemsForComposer(
      [item("selection:quote", "Selected report rows")],
      ["", "   "],
      NAMESPACE,
      THREAD_ID,
    );

    expect(partition.visible.map(({ key }) => key)).toEqual([
      "selection:quote",
    ]);
    expect(partition.hidden).toEqual([]);
  });
});
