// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { _resetCollabDocRegistryForTests } from "../../collab/client.js";
import { _resetSyncTransportRegistryForTests } from "../use-db-sync.js";
import {
  useCollaborativeDoc,
  type CollabUpdateAck,
  type UseCollaborativeDocOptions,
  type UseCollaborativeDocResult,
} from "./index.js";

let root: Root;
let container: HTMLDivElement;
let server: Y.Doc;
let outcome: CollabUpdateAck["liveCopy"];
const state: { current?: UseCollaborativeDocResult } = {};
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

function Consumer({ options }: { options: UseCollaborativeDocOptions }) {
  state.current = useCollaborativeDoc(options);
  return null;
}

function ready() {
  const current = state.current;
  if (!current?.ydoc) throw new Error("Public collab consumer is not ready");
  return { ...current, ydoc: current.ydoc };
}

function storedUpdates() {
  return Object.keys(localStorage).filter((key) =>
    key.startsWith("agent-native-collab-outbox-"),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  _resetCollabDocRegistryForTests();
  _resetSyncTransportRegistryForTests();
  localStorage.clear();
  state.current = undefined;
  outcome = null;
  server = new Y.Doc();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        name: string,
        callback: (lock: Pick<Lock, "name" | "mode">) => Promise<void>,
      ) => callback({ name, mode: "exclusive" }),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (/\/collab\/[^/]+\/state/.test(url)) {
        return new Response(
          JSON.stringify({
            state: btoa(String.fromCharCode(...Y.encodeStateAsUpdate(server))),
          }),
        );
      }
      if (/\/collab\/[^/]+\/update/.test(url)) {
        const payload: { update: string } = JSON.parse(String(init?.body));
        Y.applyUpdate(
          server,
          Uint8Array.from(atob(payload.update), (char) => char.charCodeAt(0)),
        );
        return new Response(
          JSON.stringify(
            outcome ? { ok: true, liveCopy: outcome } : { ok: true },
          ),
        );
      }
      return new Response(JSON.stringify({ states: [] }));
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  _resetCollabDocRegistryForTests();
  _resetSyncTransportRegistryForTests();
  server.destroy();
  container.remove();
  if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
  else Reflect.deleteProperty(navigator, "locks");
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps a public consumer's edit until its live-copy outcome is acknowledged", async () => {
  const acknowledged = vi.fn<(ack: CollabUpdateAck) => void>();
  const options: UseCollaborativeDocOptions = {
    docId: "public-collab-consumer",
    user: { name: "Ada", email: "ada@example.com", color: "#123456" },
    durableUpdates: true,
    requireLiveCopyOutcome: true,
    onUpdateAcknowledged: acknowledged,
  };
  await act(async () => {
    root.render(<Consumer options={options} />);
    await vi.advanceTimersByTimeAsync(50);
  });
  await act(async () => {
    ready().ydoc.getText("t").insert(0, "public edit");
    await expect(ready().flushUpdates()).resolves.toBe(false);
  });
  expect(server.getText("t").toString()).toBe("public edit");
  expect(acknowledged).not.toHaveBeenCalled();
  expect(storedUpdates()).toHaveLength(1);

  outcome = "derived";
  await act(async () => {
    await expect(ready().flushUpdates()).resolves.toBe(true);
  });
  expect(acknowledged).toHaveBeenCalledExactlyOnceWith({ liveCopy: "derived" });
  expect(storedUpdates()).toEqual([]);
  expect(server.getText("t").toString()).toBe("public edit");
});
