vi.mock("@agent-native/core/server/builder-dsi-access", () => ({
  assertBuilderDsiAccess: vi.fn(async () => ({
    status: "ready",
    eligible: true,
  })),
  getBuilderDsiAccess: vi.fn(async () => ({ status: "ready", eligible: true })),
}));
import { ActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  resolveEditor: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveBuilderDesignSystemEditor: mocks.resolveEditor,
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("../server/db/index.js", () => ({}));

import action from "./get-design-system-editor.js";

describe("get-design-system-editor", () => {
  const data = JSON.stringify({
    source: "builder",
    builderDesignSystemId: "example-dsi",
    builderJobId: "example-job",
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveAccess.mockResolvedValue({ resource: { data } });
  });

  it("is a read-only GET available to the agent", () => {
    expect(action.http).toEqual({ method: "GET" });
    expect(action.readOnly).toBe(true);
    expect(action.agentTool).toBe(true);
  });

  it("rejects missing or inaccessible local systems before resolving the provider", async () => {
    mocks.resolveAccess.mockResolvedValue(null);
    await expect(action.run({ id: "missing" })).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "design_system_not_found",
      statusCode: 404,
    });
    expect(mocks.resolveEditor).not.toHaveBeenCalled();
  });

  it("waits for local access before resolving the stored identity", async () => {
    let allow!: (value: unknown) => void;
    mocks.resolveAccess.mockReturnValue(
      new Promise((resolve) => {
        allow = resolve;
      }),
    );
    const result = {
      status: "ready",
      editorUrl:
        "https://builder.io/app/projects/example-project/example-branch",
    };
    mocks.resolveEditor.mockResolvedValue(result);
    const pending = action.run({ id: "local-example" });
    await vi.waitFor(() =>
      expect(mocks.resolveAccess).toHaveBeenCalledWith(
        "design-system",
        "local-example",
      ),
    );
    expect(mocks.resolveEditor).not.toHaveBeenCalled();
    allow({ resource: { data } });
    await expect(pending).resolves.toEqual(result);
    expect(mocks.resolveEditor).toHaveBeenCalledWith(data);
  });

  it("returns preparing only when the resolver reports absent editor identity", async () => {
    mocks.resolveEditor.mockResolvedValue({
      status: "preparing",
      editorUrl: null,
    });
    await expect(action.run({ id: "local-example" })).resolves.toEqual({
      status: "preparing",
      editorUrl: null,
    });
  });

  it.each([
    ["builder_design_system_not_found", 404],
    ["builder_design_system_lookup_failed", 502],
    ["invalid_builder_design_system", 400],
    ["builder_connection_required", 412],
    ["builder_design_system_access_denied", 403],
  ])("preserves typed %s failures", async (errorCode, statusCode) => {
    const error = new ActionContractError("Example lookup failure", {
      errorCode,
      statusCode,
    });
    mocks.resolveEditor.mockRejectedValue(error);
    await expect(action.run({ id: "local-example" })).rejects.toBe(error);
  });
  it.each([403, 409, 503])(
    "stops a denied Builder account (%s) before provider work",
    async (statusCode) => {
      const { assertBuilderDsiAccess } =
        await import("@agent-native/core/server/builder-dsi-access");
      const denied = Object.assign(new Error("Builder account denied"), {
        statusCode,
      });
      vi.mocked(assertBuilderDsiAccess).mockRejectedValueOnce(denied);
      await expect(action.run({ id: "local-example" })).rejects.toBe(denied);
      expect(mocks.resolveEditor).not.toHaveBeenCalled();
    },
  );
});
