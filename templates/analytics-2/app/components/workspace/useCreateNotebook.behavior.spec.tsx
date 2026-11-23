// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { notebookCreationMessages } from "../../i18n/messages/notebook-creation";
import { ProvisionalNotebook } from "./ProvisionalNotebook";
import { useCreateNotebook } from "./useCreateNotebook";

const fetchAction = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: fetchAction,
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT:
    () => (key: string, params?: { defaultValue?: string; title?: string }) => {
      const message = Object.entries(
        notebookCreationMessages.notebookCreation,
      ).find(([name]) => key === `notebookCreation.${name}`)?.[1];
      return (
        message?.replace("{{title}}", params?.title ?? "") ??
        params?.defaultValue ??
        key
      );
    },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  fetchAction.mockReset();
});

function Shell() {
  const create = useCreateNotebook(true, "account:workspace");
  const location = useLocation();
  return (
    <>
      <output>{location.pathname}</output>
      <button type="button" onClick={create.start}>
        New project
      </button>
      {create.creation ? <ProvisionalNotebook {...create} /> : <Outlet />}
    </>
  );
}

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const queryClient = new QueryClient();
  const router = createMemoryRouter(
    [
      {
        path: "/",
        Component: Shell,
        children: [
          { path: "home", element: <div>Home</div> },
          { path: "projects", element: <div>Projects</div> },
          { path: "project/:projectId/latest", element: <div>Notebook</div> },
        ],
      },
    ],
    { basename: "/analytics", initialEntries: ["/analytics/home"] },
  );
  cleanups.push(() => {
    act(() => root.unmount());
    queryClient.clear();
    router.dispose();
    host.remove();
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  );
  return { host, router };
}

function button(host: HTMLElement, label: string) {
  const control = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (!control) throw new Error(`Missing button: ${label}`);
  return control;
}

function keyboard(
  target: Window | HTMLElement,
  key: string,
  options?: KeyboardEventInit,
) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...options }),
  );
}

function storedReceipt(requestId: string) {
  const committedAt = "2026-11-18T12:15:30.000Z";
  return {
    requestId,
    projectId: "project-recovered",
    workingVersionId: "working-1",
    href: "/project/project-recovered/latest",
    id: "project-recovered",
    committedAt,
    snapshot: {
      status: "accepted",
      snapshot: {
        workspaceId: "workspace",
        projectId: "project-recovered",
        eventSeq: "0",
        head: { versionId: "working-1", revision: "0" },
      },
      metadata: { title: "Untitled project", description: "", statusId: null },
      resources: {
        orderRevision: "0",
        metadataRevision: "0",
        inputRevision: "0",
        layoutRevision: "0",
      },
      cells: [],
    },
  };
}

function deferredReply() {
  let resolve: (value: unknown) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<unknown>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

it("shares one create request across click and shortcut, then flushes the typed title from a recovered receipt", async () => {
  const firstReply = deferredReply();
  const lookup = deferredReply();
  fetchAction.mockImplementation(
    async (
      name: string,
      args: {
        opId: string;
        observedHead: { versionId: string; revision: string };
      },
    ) => {
      if (name === "create-project") return firstReply.promise;
      if (name === "get-project-creation") return lookup.promise;
      if (name === "apply-notebook-operation")
        return {
          status: "no_change",
          eventSeq: "0",
          opId: args.opId,
          previousHead: args.observedHead,
          nextHead: args.observedHead,
          committedAt: "2026-11-18T12:15:30.000Z",
        };
      throw new Error(`Unexpected action: ${name}`);
    },
  );
  const { host, router } = await mount();
  const create = button(host, "New project");
  await act(async () => {
    create.click();
    keyboard(window, "n", { altKey: true, shiftKey: true, code: "KeyN" });
    create.click();
  });
  expect(fetchAction).toHaveBeenCalledTimes(1);
  expect(host.querySelector("[role=status]")?.textContent).toBe(
    "Creating project…",
  );
  expect(router.state.location.pathname).toBe("/analytics/home");
  const provisionalTitle = button(host, "Untitled project");
  expect(document.activeElement).toBe(provisionalTitle);
  await act(async () => provisionalTitle.click());
  const input = host.querySelector<HTMLInputElement>(
    '[aria-label="Project title"]',
  );
  if (!input) throw new Error("Project title input missing");
  expect(input.value).toBe("");
  const entered = "Parity 03 – Revenue 42";
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, entered);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    keyboard(input, "Enter");
  });
  expect(fetchAction).toHaveBeenCalledTimes(1);
  await act(async () => firstReply.reject(new TypeError("Connection closed")));
  expect(host.querySelector("[role=status]")?.textContent).toBe(
    "Checking whether the project was created…",
  );
  const inputArgument = fetchAction.mock.calls[0]?.[1] as { requestId: string };
  expect(fetchAction.mock.calls[1]?.slice(0, 2)).toEqual([
    "get-project-creation",
    inputArgument,
  ]);
  await act(async () =>
    lookup.resolve({
      status: "committed",
      receipt: storedReceipt(inputArgument.requestId),
    }),
  );
  expect(fetchAction.mock.calls.map(([name]) => name)).toEqual([
    "create-project",
    "get-project-creation",
    "apply-notebook-operation",
  ]);
  expect(fetchAction.mock.calls[2]?.[1]).toMatchObject({
    projectId: "project-recovered",
    workingVersionId: "working-1",
    observedHead: { versionId: "working-1", revision: "0" },
    changes: [
      {
        type: "set-metadata",
        expectedMetadataRevision: "0",
        metadata: { title: entered },
      },
    ],
  });
  expect(router.state.location.pathname).toBe(
    "/analytics/project/project-recovered/latest",
  );
});

it("keeps a late receipt from hijacking a different workspace route", async () => {
  const firstReply = deferredReply();
  fetchAction.mockReturnValueOnce(firstReply.promise);
  const { host, router } = await mount();
  await act(async () => button(host, "New project").click());
  const input = fetchAction.mock.calls[0]?.[1] as { requestId: string };
  await act(async () => router.navigate("/projects"));
  await act(async () => firstReply.resolve(storedReceipt(input.requestId)));
  expect(router.state.location.pathname).toBe("/analytics/projects");
  expect(host.textContent).not.toContain("Creating project");
});

it("retains the request ID of an interrupted create and reconciles with it after a reload", async () => {
  window.sessionStorage.clear();
  const never = deferredReply();
  fetchAction.mockImplementation(async (name: string) => {
    if (name === "create-project") return never.promise;
    throw new Error(`Unexpected action: ${name}`);
  });
  const first = await mount();
  await act(async () => button(first.host, "New project").click());
  const { requestId } = fetchAction.mock.calls[0]?.[1] as {
    requestId: string;
  };
  expect(Object.values({ ...window.sessionStorage })).toContain(requestId);
  cleanups.splice(0).forEach((cleanup) => cleanup());
  fetchAction.mockReset();

  fetchAction.mockImplementation(async (name: string) => {
    if (name === "get-project-creation")
      return { status: "committed", receipt: storedReceipt(requestId) };
    if (name === "apply-notebook-operation")
      throw new Error("no title to save");
    throw new Error(`Unexpected action: ${name}`);
  });
  const second = await mount();
  await act(async () => button(second.host, "New project").click());
  expect(fetchAction.mock.calls[0]).toEqual([
    "get-project-creation",
    { requestId },
    { method: "GET" },
  ]);
  expect(fetchAction.mock.calls.map(([name]) => name)).not.toContain(
    "create-project",
  );
  expect(Object.values({ ...window.sessionStorage })).not.toContain(requestId);
});

it("creates a fresh project after a create that finished away from its route", async () => {
  window.sessionStorage.clear();
  const firstReply = deferredReply();
  fetchAction.mockReturnValueOnce(firstReply.promise);
  const { host, router } = await mount();
  await act(async () => button(host, "New project").click());
  const first = fetchAction.mock.calls[0]?.[1] as { requestId: string };
  await act(async () => router.navigate("/projects"));
  await act(async () => firstReply.resolve(storedReceipt(first.requestId)));
  expect(Object.values({ ...window.sessionStorage })).not.toContain(
    first.requestId,
  );

  fetchAction.mockReset();
  fetchAction.mockImplementation(async (name: string) => {
    if (name === "create-project")
      return storedReceipt(
        (fetchAction.mock.calls.at(-1)?.[1] as { requestId: string }).requestId,
      );
    throw new Error(`Unexpected action: ${name}`);
  });
  await act(async () => button(host, "New project").click());
  const names = fetchAction.mock.calls.map(([name]) => name);
  expect(names).toContain("create-project");
  expect(names).not.toContain("get-project-creation");
  const second = fetchAction.mock.calls[0]?.[1] as { requestId: string };
  expect(second.requestId).not.toBe(first.requestId);
});
