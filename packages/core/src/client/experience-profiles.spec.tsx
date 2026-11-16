// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), refetch: vi.fn() }));
vi.mock("./use-action.js", () => ({
  useActionQuery: () => ({
    data: undefined,
    isPending: true,
    refetch: mocks.refetch,
  }),
  useActionMutation: () => ({ mutateAsync: mocks.mutateAsync, error: null }),
}));
import { useExperienceProfile } from "./experience-profiles.js";

let root: Root;
let current: ReturnType<typeof useExperienceProfile>;
beforeEach(async () => {
  vi.clearAllMocks();
  root = createRoot(document.createElement("div"));
  function Probe() {
    current = useExperienceProfile();
    return null;
  }
  await act(async () => root.render(<Probe />));
});
afterEach(() => act(() => root.unmount()));

it("exposes loading without inventing a reference default", () => {
  expect(current.data).toBeUndefined();
  expect(current.isPending).toBe(true);
  expect(current.saving).toBe(false);
});

it("acknowledges saving until persistence and authoritative refresh finish", async () => {
  let finish: (result: unknown) => void = () => {};
  mocks.mutateAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const result = {
    profile: "reference",
    savedProfile: "reference",
    referenceAvailable: true,
    values: {},
  };
  let saving: Promise<unknown>;
  await act(async () => {
    saving = current.setProfile("reference");
  });
  expect(current.saving).toBe(true);
  expect(mocks.mutateAsync).toHaveBeenCalledWith({ profile: "reference" });
  await act(async () => {
    finish(result);
    await expect(saving).resolves.toEqual(result);
  });
  expect(mocks.refetch).toHaveBeenCalledWith({ throwOnError: true });
  expect(current.saving).toBe(false);
});

it("reports rejected writes and resets saving without refetching", async () => {
  mocks.mutateAsync.mockRejectedValueOnce(new Error("forbidden"));
  await act(async () => {
    await expect(current.setProfile("reference")).rejects.toThrow("forbidden");
  });
  expect(mocks.refetch).not.toHaveBeenCalled();
  expect(current.saving).toBe(false);
});

it("does not report success when the saved profile cannot be refreshed", async () => {
  mocks.mutateAsync.mockResolvedValueOnce({ profile: "agent-native" });
  mocks.refetch.mockRejectedValueOnce(new Error("read unavailable"));
  await act(async () => {
    await expect(current.setProfile("agent-native")).rejects.toThrow(
      "read unavailable",
    );
  });
  expect(current.saving).toBe(false);
});
