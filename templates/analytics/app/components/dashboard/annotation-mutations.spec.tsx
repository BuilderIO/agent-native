// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  CONNECT_UNDERCOUNT,
  SETUP_INCIDENT,
} from "@shared/annotation-fixtures";
import type { DataNote } from "@shared/data-notes";
import type { KeyDate, KeyDateSet } from "@shared/key-dates";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn<(action: string, input: unknown) => Promise<unknown>>(),
  read: vi.fn<(action: string) => Promise<unknown>>(),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async () => {
  const { useMutation, useQueryClient } = await vi.importActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  return {
    // The real hook without the network: unless a write opts out, its success
    // refreshes every action query.
    useActionMutation: (
      action: string,
      {
        skipActionQueryInvalidation,
        onSuccess,
        ...options
      }: Record<string, any>,
    ) => {
      const client = useQueryClient();
      return useMutation({
        ...options,
        mutationFn: (input: unknown) => mocks.run(action, input),
        onSuccess: (...args: unknown[]) => {
          if (!skipActionQueryInvalidation) {
            void client.invalidateQueries({ queryKey: ["action"] });
          }
          return onSuccess?.(...args);
        },
      });
    },
  };
});

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

import { i18nCatalog } from "../../i18n";
import {
  isPendingAnnotation,
  useDeleteDataNote,
  useDeleteKeyDate,
  useDeleteKeyDateSet,
  useRenameKeyDateSet,
  useSaveDataNote,
  useSaveKeyDate,
} from "./annotation-mutations";

const NOTES_KEY = ["action", "list-data-notes", undefined];
const SETS_KEY = ["action", "list-key-dates", undefined];

const keyDate = (id: string, label: string, date: string): KeyDate => ({
  id,
  setId: "launches",
  date,
  label,
  addedBy: "alice@example.test",
  updatedAt: "2026-10-14T12:00:00.000Z",
});
const LAUNCH = keyDate("launch", "Product Hunt launch", "2026-10-01");
const PRICING = keyDate("pricing", "Pricing page live", "2026-10-08");
const LAUNCHES: KeyDateSet = {
  id: "launches",
  name: "Launches",
  createdBy: "alice@example.test",
  updatedAt: "2026-10-14T12:00:00.000Z",
  dates: [LAUNCH, PRICING],
};
const CHANGES: KeyDateSet = {
  ...LAUNCHES,
  id: "changes",
  name: "Changes",
  dates: [],
};

type Write = { mutate: (input: any) => void };

let client: QueryClient;
let unmounts: (() => void)[];

function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          initialLocale="en-US"
          persistPreference={false}
        >
          {node}
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    ),
  );
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
    container.remove();
  };
  unmounts.push(unmount);
  return unmount;
}

/** Waits out the mutation's async callbacks and any refetch they start. */
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** A component that owns one write, as a dialog does. */
async function owner(useWrite: () => Write, input: unknown) {
  let write!: Write;
  function Owner() {
    write = useWrite();
    return null;
  }
  const unmount = mount(<Owner />);
  let settle!: { resolve(value: unknown): void; reject(error: Error): void };
  mocks.run.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );
  act(() => write.mutate(input));
  await flush();
  return {
    unmount,
    succeed: async () => {
      settle.resolve({});
      await flush();
    },
    fail: async (message = "Network down") => {
      settle.reject(new Error(message));
      await flush();
    },
  };
}

/** A chart reading the list, so invalidating it refetches. */
function watch(action: "list-data-notes" | "list-key-dates") {
  function Reader() {
    useQuery({
      queryKey: ["action", action, undefined],
      queryFn: () => mocks.read(action),
      staleTime: Infinity,
    });
    return null;
  }
  mount(<Reader />);
}

const notes = () =>
  client.getQueryData<{ notes: DataNote[] }>(NOTES_KEY)?.notes;
const sets = () => client.getQueryData<{ sets: KeyDateSet[] }>(SETS_KEY)?.sets;

describe("annotation writes", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    client = new QueryClient();
    unmounts = [];
    client.setQueryData(NOTES_KEY, {
      notes: [SETUP_INCIDENT, CONNECT_UNDERCOUNT],
    });
    client.setQueryData(SETS_KEY, { sets: [LAUNCHES, CHANGES] });
  });

  afterEach(() => {
    for (const unmount of unmounts) unmount();
    client.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([
    [
      "saving a data note",
      useSaveDataNote,
      { id: SETUP_INCIDENT.id, title: "Edited" },
      "Couldn't save: Network down",
    ],
    [
      "deleting a data note",
      useDeleteDataNote,
      { id: SETUP_INCIDENT.id },
      "Couldn't delete: Network down",
    ],
    [
      "saving a key date",
      useSaveKeyDate,
      { setName: "Incidents", date: "2026-10-09", label: "Setup outage" },
      "Couldn't save: Network down",
    ],
    [
      "deleting a key date",
      useDeleteKeyDate,
      { id: LAUNCH.id },
      "Couldn't delete: Network down",
    ],
    [
      "renaming a key-date set",
      useRenameKeyDateSet,
      { id: LAUNCHES.id, name: "Releases" },
      "Couldn't save: Network down",
    ],
    [
      "deleting a key-date set",
      useDeleteKeyDateSet,
      { id: LAUNCHES.id },
      "Couldn't delete: Network down",
    ],
  ])(
    "reports a failure %s after the dialog that started it has closed",
    async (_name, useWrite, input, message) => {
      const write = await owner(useWrite as () => Write, input);
      expect({ notes: notes(), sets: sets() }).not.toEqual({
        notes: [SETUP_INCIDENT, CONNECT_UNDERCOUNT],
        sets: [LAUNCHES, CHANGES],
      });

      write.unmount();
      await write.fail();

      expect(mocks.toastError).toHaveBeenCalledWith(message);
      expect(notes()).toEqual([SETUP_INCIDENT, CONNECT_UNDERCOUNT]);
      expect(sets()).toEqual([LAUNCHES, CHANGES]);
    },
  );

  it("takes back only the failed data-note write while another is in flight", async () => {
    const edit = await owner(useSaveDataNote, {
      id: SETUP_INCIDENT.id,
      title: "Edited",
    });
    await owner(useDeleteDataNote, { id: CONNECT_UNDERCOUNT.id });
    const add = await owner(useSaveDataNote, {
      kind: "incident",
      title: "Signup form outage",
      note: "The signup form failed to load.",
      panels: [{ dashboardId: "dash", panelId: "signups" }],
    });
    expect(notes()?.map((note) => note.title)).toEqual([
      "Signup form outage",
      "Edited",
    ]);

    await edit.fail();
    expect(notes()?.map((note) => note.title)).toEqual([
      "Signup form outage",
      SETUP_INCIDENT.title,
    ]);
    expect(notes()?.[1]).toEqual(SETUP_INCIDENT);

    await add.fail();
    expect(notes()).toEqual([SETUP_INCIDENT]);
  });

  it("takes back only the failed key-date write while others are in flight", async () => {
    const move = await owner(useSaveKeyDate, {
      id: LAUNCH.id,
      setId: CHANGES.id,
      date: "2026-10-02",
      label: "Product Hunt relaunch",
    });
    await owner(useRenameKeyDateSet, { id: LAUNCHES.id, name: "Releases" });
    const add = await owner(useSaveKeyDate, {
      setName: "Incidents",
      date: "2026-10-09",
      label: "Setup outage",
    });
    expect(sets()?.map((set) => set.dates.map((date) => date.label))).toEqual([
      [PRICING.label],
      ["Product Hunt relaunch"],
      ["Setup outage"],
    ]);

    await move.fail();
    const [launches, changes, incidents] = sets() ?? [];
    expect(launches).toEqual({ ...LAUNCHES, name: "Releases" });
    expect(changes).toEqual(CHANGES);
    expect(incidents).toMatchObject({
      name: "Incidents",
      dates: [{ label: "Setup outage" }],
    });

    await add.fail();
    expect(sets()).toEqual([{ ...LAUNCHES, name: "Releases" }, CHANGES]);
  });

  it("marks what it adds as pending until the server's ids arrive", async () => {
    await owner(useSaveDataNote, {
      kind: "incident",
      title: "Signup form outage",
      note: "The signup form failed to load.",
      panels: [{ dashboardId: "dash", panelId: "signups" }],
    });
    await owner(useSaveKeyDate, {
      setName: "Incidents",
      date: "2026-10-09",
      label: "Setup outage",
    });
    await owner(useSaveKeyDate, {
      id: PRICING.id,
      setName: "Pricing",
      date: PRICING.date,
      label: PRICING.label,
    });

    const [added] = notes() ?? [];
    const [launches, changes, incidents, pricing] = sets() ?? [];
    expect(added?.title).toBe("Signup form outage");
    expect(isPendingAnnotation(added!.id)).toBe(true);
    expect(isPendingAnnotation(incidents!.id)).toBe(true);
    expect(isPendingAnnotation(incidents!.dates[0]!.id)).toBe(true);
    // A date moved into a new set keeps its own id; only its set is new.
    expect(pricing!.dates).toEqual([
      expect.objectContaining({ id: PRICING.id }),
    ]);
    expect(isPendingAnnotation(pricing!.id)).toBe(true);
    expect(
      [SETUP_INCIDENT.id, launches!.id, changes!.id, LAUNCH.id].some(
        isPendingAnnotation,
      ),
    ).toBe(false);
  });

  it("refetches the list after a failed write, so the server's version wins", async () => {
    watch("list-data-notes");
    mocks.read.mockResolvedValue({ notes: [CONNECT_UNDERCOUNT] });

    const remove = await owner(useDeleteDataNote, { id: SETUP_INCIDENT.id });
    await remove.fail();

    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(notes()).toEqual([CONNECT_UNDERCOUNT]);
  });

  it("waits for the last overlapping write before refetching", async () => {
    watch("list-key-dates");
    mocks.read.mockResolvedValue({ sets: [CHANGES] });

    const rename = await owner(useRenameKeyDateSet, {
      id: LAUNCHES.id,
      name: "Releases",
    });
    const remove = await owner(useDeleteKeyDate, { id: PRICING.id });

    await rename.succeed();
    // A refetch now would drop the delete still in flight.
    expect(mocks.read).not.toHaveBeenCalled();
    expect(sets()?.[0]).toMatchObject({ name: "Releases", dates: [LAUNCH] });

    await remove.fail();
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(sets()).toEqual([CHANGES]);
  });
});
