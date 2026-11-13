// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: { email: "me@example.com" } }),
}));

import * as upload from "@/lib/local-recording-upload";
import {
  claimRecordingBackupLock,
  updateRecordingBackupMeta,
} from "@/lib/recording-backup";

import {
  expectToast,
  renderedToast,
  setupRecoveryLocale,
  spanish,
} from "./__tests__/recovery-locale-fixture";

// oracle-change: The watcher regression moved intact to the locale suite.
describe("recovery warning localization", () => {
  const { mount, switchToSpanish, getContainer } = setupRecoveryLocale();

  it("updates title and controls when the interface language changes", async () => {
    const release = await mount();
    await switchToSpanish(release);
    await vi.waitFor(() =>
      expectToast(spanish, "Terminar la subida", "Recordármelo mañana"),
    );
  });

  it("updates title and controls when the pending copy becomes active in another tab", async () => {
    const release = await mount();
    const claim = await claimRecordingBackupLock("unfinished");
    if (claim.status !== "held")
      throw new Error("Could not hold recording lock");
    try {
      await switchToSpanish(release);
      await vi.waitFor(() =>
        expectToast(spanish, "Terminar la subida", "Recordármelo mañana"),
      );
    } finally {
      claim.release();
    }
  });

  it("updates an existing prompt while recovery scans are stalled", async () => {
    const release = await mount();
    await updateRecordingBackupMeta("unfinished", {
      localOnly: false,
      serverRecordingId: "server-recording",
    });
    const gate = {
      release: (): void => {
        throw new Error("Status gate was not initialized");
      },
    };
    const waiting = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const status = vi
      .spyOn(upload, "fetchServerUploadStatus")
      .mockImplementation(async () => {
        await waiting;
        return { found: false };
      });
    try {
      await act(async () =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      await vi.waitFor(() => expect(status).toHaveBeenCalled());
      await switchToSpanish(release);
      await vi.waitFor(() =>
        expectToast(spanish, "Terminar la subida", "Recordármelo mañana"),
      );
    } finally {
      gate.release();
    }
  });

  it("uses the current locale when a recorder offers a copy with its old translator", async () => {
    const release = await mount();
    await act(async () =>
      [...getContainer().querySelectorAll("button")]
        .find((button) => button.textContent === "Unmount watcher")
        ?.click(),
    );
    await switchToSpanish(release);
    await act(async () =>
      [...getContainer().querySelectorAll("button")]
        .find((button) => button.textContent === "Offer from recorder")
        ?.click(),
    );
    await vi.waitFor(() =>
      expectToast(
        "Hay una grabación en este navegador que no está vinculada a ninguna cuenta",
        "Revisar",
        "Recordármelo mañana",
      ),
    );
  });

  it("uses the current locale for the open-elsewhere action feedback", async () => {
    const release = await mount();
    await act(async () =>
      [...getContainer().querySelectorAll("button")]
        .find((button) => button.textContent === "Unmount watcher")
        ?.click(),
    );
    await switchToSpanish(release);
    await act(async () =>
      [...getContainer().querySelectorAll("button")]
        .find((button) => button.textContent === "Offer from recorder")
        ?.click(),
    );
    await vi.waitFor(() =>
      expectToast(
        "Hay una grabación en este navegador que no está vinculada a ninguna cuenta",
        "Revisar",
        "Recordármelo mañana",
      ),
    );
    const claim = await claimRecordingBackupLock("unfinished");
    if (claim.status !== "held")
      throw new Error("Could not hold recording lock");
    try {
      await act(async () =>
        renderedToast()
          ?.querySelector<HTMLButtonElement>("[data-action]")
          ?.click(),
      );
      await vi.waitFor(() =>
        expect(
          document.querySelector(
            '[data-sonner-toast][data-type="info"] [data-title]',
          )?.textContent,
        ).toBe("Esa grabación sigue abierta en otra pestaña de Clips."),
      );
    } finally {
      claim.release();
    }
  });

  it("updates the fallback prompt when the initial Spanish catalog loads", async () => {
    const release = await mount("es-ES");
    await act(async () => release());
    await vi.waitFor(() =>
      expectToast(spanish, "Terminar la subida", "Recordármelo mañana"),
    );
  });
});
