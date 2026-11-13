// @vitest-environment happy-dom

import { IDBFactory, IDBOpenDBRequest } from "fake-indexeddb";
import { act } from "react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: { email: "me@example.com" } }),
}));

import {
  renderedToast,
  setupRecoveryLocale,
} from "./__tests__/recovery-locale-fixture";

// oracle-change: Warning tests and fixture assertions moved intact to the warning suite and shared fixture.
describe("recovery unreadable-store localization", () => {
  const { mount, switchToSpanish } = setupRecoveryLocale();

  it("updates an unreadable-store error while a later scan is stalled", async () => {
    const release = await mount();
    vi.spyOn(IDBFactory.prototype, "open")
      .mockImplementationOnce(() => {
        throw new Error("blocked");
      })
      .mockImplementation(() => new IDBOpenDBRequest());
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await vi.waitFor(() =>
      expect(renderedToast()?.querySelector("[data-title]")?.textContent).toBe(
        "Clips couldn't read the recordings saved in this browser.",
      ),
    );
    expect(renderedToast()?.querySelector("[data-cancel]")).toBeNull();
    await switchToSpanish(release);
    await vi.waitFor(() => {
      expect(renderedToast()?.querySelector("[data-title]")?.textContent).toBe(
        "Clips no pudo leer las grabaciones guardadas en este navegador.",
      );
      expect(renderedToast()?.querySelector("[data-action]")?.textContent).toBe(
        "Intentar de nuevo",
      );
    });
  });

  it("retries an unreadable store after changing the interface language", async () => {
    const release = await mount();
    const open = vi
      .spyOn(IDBFactory.prototype, "open")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const errors = vi.spyOn(toast, "error");
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await vi.waitFor(() =>
      expect(renderedToast()?.querySelector("[data-title]")?.textContent).toBe(
        "Clips couldn't read the recordings saved in this browser.",
      ),
    );
    expect(errors).toHaveBeenCalledTimes(1);
    open.mockImplementation(() => new IDBOpenDBRequest());
    await switchToSpanish(release);
    await vi.waitFor(() =>
      expect(renderedToast()?.querySelector("[data-action]")?.textContent).toBe(
        "Intentar de nuevo",
      ),
    );
    open.mockImplementation(() => {
      throw new Error("still blocked");
    });
    const opensBeforeRetry = open.mock.calls.length;
    await act(async () =>
      renderedToast()
        ?.querySelector<HTMLButtonElement>("[data-action]")
        ?.click(),
    );
    await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(2));
    expect(open).toHaveBeenCalledTimes(opensBeforeRetry + 1);
  });
});
