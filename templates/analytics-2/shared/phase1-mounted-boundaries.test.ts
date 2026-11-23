// @vitest-environment happy-dom
import type { Locator, Page, Route } from "@playwright/test";
import { expect, it, vi } from "vitest";

import {
  holdCreationReceipt,
  notebookCreateViewer,
  pressHomeNewProjectShortcut,
} from "../e2e/phase1/creation-receipt.js";
import {
  createWarehouseFaultControl,
  warehouseFaultInput,
} from "../e2e/phase1/fixtures/provider-fault.js";
import { settleHeldRoute } from "../e2e/phase1/held-route.js";
import { UnavailableFixture } from "../e2e/phase1/verdict.js";
import {
  expectWarehouseFixtureSaved,
  warehouseFaultFixture,
  warehouseOption,
} from "../e2e/phase1/warehouse-fixtures.js";
import { readSqlEditor, writeSqlEditor } from "../e2e/sql-editor.js";

it("selects only the requested warehouse when a second source shares its name prefix", async () => {
  const sources = [
    { id: "fixture", name: "Parity Warehouse" },
    { id: "later-fixture", name: "Parity Warehouse 0123" },
  ];
  const page = {
    getByRole(
      role: string,
      { name, exact }: { name: string | RegExp; exact?: boolean },
    ) {
      expect(role).toBe("menuitemradio");
      return {
        allTextContents: async () =>
          sources
            .filter((source) =>
              name instanceof RegExp
                ? name.test(source.name)
                : exact
                  ? source.name === name
                  : source.name.includes(name),
            )
            .map((source) => source.name),
      };
    },
  } as unknown as Page;

  await expect(
    warehouseOption(page, {
      id: "fixture",
      name: "Parity Warehouse",
    }).allTextContents(),
  ).resolves.toEqual(["Parity Warehouse"]);
});

it("keeps unexpected warehouse Create failures red and reports a missing required regional fixture", async () => {
  const requested = "orders_us, orders_east";
  const rejected = (
    dataset: string,
    errorCode = "data_connection_dataset_unverified",
  ) => ({
    ok: () => false,
    status: () => 400,
    json: async () => ({
      error: "Dataset could not be verified.",
      errorCode,
      details: { field: "datasetNames", dataset },
    }),
  });

  await expect(
    expectWarehouseFixtureSaved(rejected("orders_east"), requested),
  ).rejects.toBeInstanceOf(UnavailableFixture);
  await expect(
    expectWarehouseFixtureSaved(rejected("unrelated"), requested),
  ).rejects.toThrow("Warehouse Create HTTP 400");
  await expect(
    expectWarehouseFixtureSaved(
      rejected("orders_east", "connection_denied"),
      requested,
    ),
  ).rejects.toThrow("Warehouse Create HTTP 400");
  await expect(
    expectWarehouseFixtureSaved(
      {
        ok: () => false,
        status: () => 400,
        json: async () => ({ error: "Bad request" }),
      },
      requested,
    ),
  ).rejects.toThrow("Warehouse Create HTTP 400: invalid action error body");
  await expect(
    expectWarehouseFixtureSaved(
      {
        ok: () => false,
        status: () => 400,
        json: async () => {
          throw new SyntaxError("body unavailable");
        },
      },
      requested,
    ),
  ).rejects.toThrow("Warehouse Create HTTP 400: unreadable error response");
});

it("distinguishes a scope-only provider from a broken warehouse fault fixture", async () => {
  const connectionId = `wconn1:${"a".repeat(64)}`;
  const fixture = {
    providerFixtureUrl: "http://127.0.0.1:4451",
    unavailable(reason: string): never {
      throw new UnavailableFixture(reason);
    },
  };
  const fetch = vi.fn(async () =>
    Response.json({ errorCode: "fixture_route_not_found" }, { status: 404 }),
  );
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(
      warehouseFaultFixture(fixture, connectionId),
    ).rejects.toBeInstanceOf(UnavailableFixture);
    fetch.mockResolvedValueOnce(
      Response.json({ errorCode: "other" }, { status: 404 }),
    );
    await expect(warehouseFaultFixture(fixture, connectionId)).rejects.toThrow(
      "Warehouse fixture scenario HTTP 404",
    );
    fetch.mockResolvedValueOnce(
      Response.json({ errorCode: "fixture_route_not_found" }, { status: 503 }),
    );
    await expect(warehouseFaultFixture(fixture, connectionId)).rejects.toThrow(
      "Warehouse fixture scenario HTTP 503",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("opens signed-in provider fault controls, scopes them to the new source, and closes them", async () => {
  const connectionId = `wconn1:${"a".repeat(64)}`;
  const rig = {
    providerFixtureUrl: "http://127.0.0.1:4411",
    unavailable(reason: string): never {
      throw new UnavailableFixture(reason);
    },
  };
  const { control } = createWarehouseFaultControl();
  const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
    if (url.pathname === "/__control/scenario")
      return Response.json(
        { errorCode: "fixture_route_not_found" },
        { status: 404 },
      );
    expect(url.pathname).toBe("/phase1/provider-control");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const input = warehouseFaultInput.parse(JSON.parse(String(init?.body)));
    expect(input.connectionId).toBe(connectionId);
    return Response.json(await control(input));
  });
  vi.stubGlobal("fetch", fetch);
  try {
    {
      await using fixture = await warehouseFaultFixture(rig, connectionId);
      await fixture.patch({ bigqueryStorageFailure: true });
      await expect(fixture.calls()).resolves.toEqual([]);
    }
    await expect(
      control({ operation: "warehouse-fault-calls", connectionId }),
    ).rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledTimes(5);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("disposes a held creation receipt even when Playwright already handled the route", async () => {
  const intercepted = vi.fn();
  const dispose = vi.fn(async () => {});
  const page: Pick<Page, "route" | "unroute"> = {
    route: vi.fn(async (_path, handler) => {
      intercepted.mockImplementation(handler);
      return { dispose, [Symbol.asyncDispose]: dispose };
    }),
    unroute: vi.fn(async () => {}),
  };
  const hold = await holdCreationReceipt(page);
  const resume = vi.fn(async () => {
    throw new Error("Route is already handled!");
  });
  const pending = intercepted({ continue: resume } satisfies Pick<
    Route,
    "continue"
  >);
  expect(resume).not.toHaveBeenCalled();

  await hold.dispose();

  await expect(pending).resolves.toBeUndefined();
  expect(resume).toHaveBeenCalledTimes(1);
  expect(page.unroute).toHaveBeenCalledTimes(1);
});

it("propagates a genuine route failure", async () => {
  const failure = new Error("Connection reset");
  await expect(
    settleHeldRoute(async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
});

it("sends the physical new-project shortcut only after the Home button mounts", async () => {
  let ready: () => void = () => {};
  const mounted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const dispatch = vi.fn();
  const page = {
    keyboard: { press: dispatch },
    getByRole(role: string, options: { name: string; exact: boolean }) {
      if (role !== "button" || options.name !== "New project" || !options.exact)
        throw new Error("The Home create button was not targeted");
      return {
        press: async (key: string) => {
          await mounted;
          dispatch(key);
        },
      };
    },
  } as unknown as Page;

  const shortcut = pressHomeNewProjectShortcut(page);
  expect(dispatch).not.toHaveBeenCalled();
  ready();
  await shortcut;
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("Alt+Shift+KeyN");
});

it("uses the joined colleague for Create denial and rejects an owner of another workspace", async () => {
  const actorStateAvailable = (actor: string) => actor === "colleague";
  const unavailable = (reason: string): never => {
    throw new UnavailableFixture(reason);
  };
  const identity = vi.fn(async (actor?: string) => ({
    user: {
      id: actor ?? "owner",
      email: "person@example.test",
      name: "Person",
    },
    workspace: { id: "owner-workspace" },
  }));
  const flow = { actorStateAvailable, identity, unavailable };
  await expect(notebookCreateViewer(flow)).resolves.toBe("colleague");
  expect(identity.mock.calls).toEqual([[], ["colleague"]]);
  identity.mockResolvedValueOnce(await identity());
  identity.mockResolvedValueOnce({
    user: {
      id: "other-owner",
      email: "outsider@example.test",
      name: "Outsider",
    },
    workspace: { id: "other-workspace" },
  });
  await expect(notebookCreateViewer(flow)).rejects.toBeInstanceOf(
    UnavailableFixture,
  );
});

it("reads the exact CodeMirror source across empty and decorated lines", async () => {
  const content = document.createElement("div");
  const locator = {
    evaluate: async (read: (element: HTMLElement) => string) => read(content),
  } as unknown as Locator;
  content.innerHTML = '<div class="cm-line"><br></div>';
  Object.defineProperty(content, "innerText", { value: "\n" });
  await expect(readSqlEditor(locator)).resolves.toBe("");
  content.innerHTML =
    '<div class="cm-line"><span>select</span>  42</div><div class="cm-line"><br></div><div class="cm-line">order by 1</div>';
  await expect(readSqlEditor(locator)).resolves.toBe(
    "select  42\n\norder by 1",
  );
});

it("replaces a populated CodeMirror editor through its keyboard selection", async () => {
  const content = document.createElement("div");
  const line = document.createElement("div");
  line.className = "cm-line";
  line.textContent = "select 42";
  content.append(line);
  let focused = false;
  let selected = false;
  const editor = {
    click: async () => {
      focused = true;
    },
    press: async (shortcut: string) => {
      selected = focused && shortcut === "ControlOrMeta+a";
    },
    page: () => ({
      keyboard: {
        insertText: async (text: string) => {
          line.textContent = selected ? text : line.textContent + text;
        },
      },
    }),
    evaluate: async (read: (element: HTMLElement) => string) => read(content),
  } as unknown as Locator;
  await writeSqlEditor(editor, "select 84");
  await expect(readSqlEditor(editor)).resolves.toBe("select 84");
});
