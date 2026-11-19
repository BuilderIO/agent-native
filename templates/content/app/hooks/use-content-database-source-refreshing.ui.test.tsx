// @vitest-environment happy-dom
import { useMutation } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { click, renderUi } from "@/test-utils/render-ui";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  // A refresh that never settles, so it stays in flight for the whole test.
  useActionMutation: (_name: string, options: object) =>
    useMutation({ ...options, mutationFn: () => new Promise(() => {}) }),
}));

import {
  useContentDatabaseSourceRefreshing,
  useRefreshContentDatabaseSource,
} from "./use-content-database";

function Probe() {
  const refresh = useRefreshContentDatabaseSource("collection-1");
  const thisOne = useContentDatabaseSourceRefreshing("source-1");
  const another = useContentDatabaseSourceRefreshing("source-2");
  return (
    <button
      type="button"
      data-this-one={String(thisOne)}
      data-another={String(another)}
      onClick={() =>
        refresh.mutate({ documentId: "collection-1", sourceId: "source-1" })
      }
    >
      Sync now
    </button>
  );
}

describe("useContentDatabaseSourceRefreshing", () => {
  it("sees a refresh another control started, for that source only", async () => {
    const { container } = renderUi(<Probe />);
    const probe = container.querySelector("button");
    if (!probe) throw new Error("No probe");
    expect(probe.dataset.thisOne).toBe("false");

    await click(probe);
    expect(probe.dataset.thisOne).toBe("true");
    expect(probe.dataset.another).toBe("false");
  });
});
