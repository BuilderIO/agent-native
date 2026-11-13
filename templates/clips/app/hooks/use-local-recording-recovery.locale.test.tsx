// @vitest-environment happy-dom

import {
  AgentNativeI18nProvider,
  useLocale,
  useT,
} from "@agent-native/core/client/i18n";
import { IDBFactory, IDBKeyRange, IDBOpenDBRequest } from "fake-indexeddb";
import React, { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { toast, Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: { email: "me@example.com" } }),
}));

import { i18nCatalog } from "@/i18n";
import * as upload from "@/lib/local-recording-upload";
import {
  claimRecordingBackupLock,
  putRecordingBackupMeta,
  updateRecordingBackupMeta,
} from "@/lib/recording-backup";
import { FakeLockManager } from "@/lib/testing/fake-lock-manager";

import {
  offerLocalRecording,
  useLocalRecordingRecovery,
} from "./use-local-recording-recovery";

const toastId = "clips-local-recording-recovery";
const english = "A recording hasn't finished uploading";
const spanish = "Una grabación no ha terminado de subirse";

function Watcher() {
  useLocalRecordingRecovery();
  return null;
}

function Probe() {
  const { setPreference } = useLocale();
  const t = useT();
  const oldT = useRef(t);
  const [watching, setWatching] = useState(true);
  return (
    <>
      {watching && <Watcher />}
      <button onClick={() => void setPreference("es-ES")}>
        Change language
      </button>
      <button onClick={() => setWatching(false)}>Unmount watcher</button>
      <button
        onClick={() =>
          offerLocalRecording({
            meta: { recordingId: "unfinished", ownerEmail: null },
            t: oldT.current,
            navigate: () => {},
          })
        }
      >
        Offer from recorder
      </button>
    </>
  );
}

function renderedToast() {
  return document.querySelector<HTMLElement>("[data-sonner-toast]");
}

function expectToast(title: string, action: string, cancel: string) {
  const current = renderedToast();
  expect(current?.querySelector("[data-title]")?.textContent).toBe(title);
  expect(current?.querySelector("[data-action]")?.textContent).toBe(action);
  expect(current?.querySelector("[data-cancel]")?.textContent).toBe(cancel);
}

describe("recovery toast localization", () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US"],
      locks: new FakeLockManager(),
    });
    await putRecordingBackupMeta({
      recordingId: "unfinished",
      mimeType: "video/webm",
      durationMs: 4000,
      width: 1,
      height: 1,
      hasAudio: true,
      hasCamera: false,
      bytes: 4,
      chunkCount: 1,
      savedAt: "2026-10-01T10:00:00.000Z",
      completedAt: null,
      ownerEmail: "me@example.com",
      localOnly: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    container.remove();
    toast.dismiss(toastId);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(initialLocale: "en-US" | "es-ES" = "en-US") {
    const gate = {
      release: (): void => {
        throw new Error("Locale gate was not initialized");
      },
    };
    const waiting = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const catalog = {
      ...i18nCatalog,
      loadMessages: async (
        locale: Parameters<typeof i18nCatalog.loadMessages>[0],
      ) => {
        if (locale === "es-ES") await waiting;
        return i18nCatalog.loadMessages(locale);
      },
    };
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={catalog}
          initialLocale={initialLocale}
          initialPreference={initialLocale}
          persistPreference={false}
        >
          <MemoryRouter>
            <Probe />
            <Toaster />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    await vi.waitFor(() =>
      expectToast(english, "Finish upload", "Remind me tomorrow"),
    );
    return gate.release;
  }

  async function switchToSpanish(release: () => void) {
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Change language")
        ?.click();
      release();
    });
  }

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
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Unmount watcher")
        ?.click(),
    );
    await switchToSpanish(release);
    await act(async () =>
      [...container.querySelectorAll("button")]
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
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Unmount watcher")
        ?.click(),
    );
    await switchToSpanish(release);
    await act(async () =>
      [...container.querySelectorAll("button")]
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

  it("updates the fallback prompt when the initial Spanish catalog loads", async () => {
    const release = await mount("es-ES");
    await act(async () => release());
    await vi.waitFor(() =>
      expectToast(spanish, "Terminar la subida", "Recordármelo mañana"),
    );
  });
});
