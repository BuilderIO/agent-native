// @vitest-environment happy-dom

import {
  AgentNativeI18nProvider,
  useLocale,
  useT,
} from "@agent-native/core/client/i18n";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: { email: "me@example.com" } }),
}));

import { i18nCatalog } from "@/i18n";
import * as upload from "@/lib/local-recording-upload";
import {
  claimRecordingBackupLock,
  putRecordingBackupMeta,
} from "@/lib/recording-backup";
import { FakeLockManager } from "@/lib/testing/fake-lock-manager";

import {
  findLocalRecordingsToFinish,
  offerLocalRecording,
  useLocalRecordingRecovery,
  watchLocalRecordings,
} from "./use-local-recording-recovery";

const english = "A recording hasn't finished uploading";
const spanish = "Una grabación no ha terminado de subirse";
const toastId = "clips-local-recording-recovery";

function SecondProbe() {
  useLocalRecordingRecovery();
  return null;
}

function Probe() {
  const { setPreference } = useLocale();
  const t = useT();
  const [secondMount, setSecondMount] = useState(false);
  useLocalRecordingRecovery();
  return (
    <>
      <button type="button" onClick={() => void setPreference("es-ES")}>
        {t("recordRoute.unfinishedRecording")}
      </button>
      {secondMount && <SecondProbe />}
      <button
        type="button"
        aria-label="Mount another recovery watcher"
        onClick={() => setSecondMount(true)}
      />
    </>
  );
}

function recoveryToast() {
  const item = toast.getToasts().find((toast) => toast.id === toastId);
  return item && "title" in item ? item : undefined;
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

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    toast.dismiss(toastId);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(initialLocale: "en-US" | "es-ES") {
    const deferred = {
      release: (): void => {
        throw new Error("Locale load gate was not initialized");
      },
    };
    const gate = new Promise<void>((resolve) => {
      deferred.release = resolve;
    });
    const catalog = {
      ...i18nCatalog,
      loadMessages: async (
        locale: Parameters<typeof i18nCatalog.loadMessages>[0],
      ) => {
        if (locale === "es-ES") await gate;
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
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    await vi.waitFor(() => expect(recoveryToast()?.title).toBe(english));
    return deferred.release;
  }

  async function expectSpanishToast() {
    await vi.waitFor(() => expect(container.textContent).toBe(spanish));
    await vi.waitFor(() => {
      expect(recoveryToast()).toMatchObject({
        title: spanish,
        action: { label: "Terminar la subida" },
        cancel: { label: "Recordármelo mañana" },
      });
    });
  }

  it("keeps the unreadable-store error when a scan fails", async () => {
    await mount("en-US");
    vi.spyOn(IDBFactory.prototype, "open").mockImplementation(() => {
      throw new Error("blocked");
    });
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await vi.waitFor(() =>
      expect(recoveryToast()?.title).toBe(
        "Clips couldn't read the recordings saved in this browser.",
      ),
    );
  });

  it("does not restore an older pending result after a second mount finds the copy active", async () => {
    await mount("en-US");
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
      serverRecordingId: "server-recording",
    });
    const statusControl = {
      release: (): void => {
        throw new Error("Status gate was not initialized");
      },
    };
    const statusGate = new Promise<void>((resolve) => {
      statusControl.release = resolve;
    });
    const status = vi
      .spyOn(upload, "fetchServerUploadStatus")
      .mockImplementation(async () => {
        await statusGate;
        return { found: false };
      });
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await vi.waitFor(() => expect(status).toHaveBeenCalledOnce());
    const claim = await claimRecordingBackupLock("unfinished");
    if (claim.status !== "held")
      throw new Error("Could not hold recording lock");
    const query = vi.spyOn(navigator.locks, "query");
    try {
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Mount another recovery watcher"]',
          )
          ?.click(),
      );
      // A concurrent implementation reaches the second snapshot before the
      // first status returns; a serialized one waits for that first scan.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await act(async () => {
        statusControl.release();
        await status.mock.results[0]?.value;
      });
      await vi.waitFor(() => expect(query).toHaveBeenCalled());
      await vi.waitFor(() => expect(recoveryToast()).toBeUndefined());
    } finally {
      statusControl.release();
      claim.release();
    }
  });

  it("keeps a recorder's newer prompt when an earlier scan finds nothing to offer", async () => {
    await mount("en-US");
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
      savedAt: new Date().toISOString(),
      uploadedAt: new Date().toISOString(),
      completedAt: null,
      ownerEmail: "me@example.com",
      serverRecordingId: "server-recording",
    });
    const statusControl = {
      release: (): void => {
        throw new Error("Status gate was not initialized");
      },
    };
    const gate = new Promise<void>((resolve) => {
      statusControl.release = resolve;
    });
    const status = vi
      .spyOn(upload, "fetchServerUploadStatus")
      .mockImplementation(async () => {
        await gate;
        return {
          found: true,
          status: "processing",
          verificationPending: true,
          sourceSizeBytes: null,
          durationMs: null,
        };
      });
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await vi.waitFor(() => expect(status).toHaveBeenCalledOnce());
    offerLocalRecording({
      meta: { recordingId: "new-copy", ownerEmail: "me@example.com" },
      t: ((key: string) => key) as never,
      navigate: () => {},
    });
    const completion = {
      finish: (): void => {
        throw new Error("Scan barrier was not initialized");
      },
    };
    const barrier = new Promise<void>((resolve) => {
      completion.finish = resolve;
    });
    const stop = watchLocalRecordings("me@example.com", {
      onResult: completion.finish,
      onError: (error) => {
        throw error;
      },
    });
    try {
      statusControl.release();
      await barrier;
      expect(recoveryToast()?.title).toBe("recordRoute.unfinishedRecording");
    } finally {
      statusControl.release();
      stop();
    }
  });

  it("updates an existing prompt after changing the interface language", async () => {
    const release = await mount("en-US");
    await act(async () => {
      container.querySelector("button")?.click();
      release();
    });
    await expectSpanishToast();
  });

  it("updates a fallback prompt when the initial Spanish catalog finishes loading", async () => {
    const release = await mount("es-ES");
    await act(async () => release());
    await expectSpanishToast();
  });

  it.each([
    { initialLocale: "en-US" as const, trigger: "a language change" },
    { initialLocale: "es-ES" as const, trigger: "the initial catalog load" },
  ])(
    "does not leave an English prompt when a copy becomes active elsewhere before $trigger",
    async ({ initialLocale }) => {
      const release = await mount(initialLocale);
      const claim = await claimRecordingBackupLock("unfinished");
      expect(claim.status).toBe("held");
      if (claim.status !== "held")
        throw new Error("Could not hold recording lock");
      try {
        expect(
          (await findLocalRecordingsToFinish("me@example.com")).pending,
        ).toEqual([]);
        await act(async () => {
          if (initialLocale === "en-US")
            container.querySelector("button")?.click();
          release();
        });
        await vi.waitFor(() => expect(container.textContent).toBe(spanish));
        await vi.waitFor(() =>
          expect(recoveryToast()?.title ?? spanish).toBe(spanish),
        );
      } finally {
        claim.release();
      }
    },
  );
});
