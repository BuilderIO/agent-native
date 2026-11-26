// @vitest-environment jsdom
import {
  modelPartRefs,
  type ScreenModel,
} from "@agent-native/design-system/model";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesignSystemContext } from "./context.js";
import { checkPartSetEquivalence } from "./parts-testing.js";
import {
  AGENT_NATIVE_PART_SET,
  definePartSet,
  MissingEffectError,
  MissingPartError,
  combineFragments,
  ModelSurface,
  type PartProps,
  rowAttributes,
  UndeclaredNestedSurfaceError,
  useRowEffect,
  useRowSlot,
} from "./parts.js";

afterEach(cleanup);

const model: ScreenModel = {
  id: "sidebar",
  rows: [
    {
      id: "sidebar.main",
      part: "sidebar.section",
      kind: "section",
      label: "Main",
      rows: [
        {
          id: "sidebar.nav.inbox",
          part: "sidebar.item",
          kind: "destination",
          label: "Inbox",
          state: { selected: true, badge: { kind: "count", value: 19 } },
          effect: { kind: "navigate", to: "/inbox" },
        },
        {
          id: "sidebar.create.issue",
          part: "sidebar.item",
          kind: "action",
          label: "New issue",
          effect: { kind: "action", effectId: "create-issue" },
        },
      ],
    },
  ],
};

const ours = definePartSet({
  name: "ours",
  parts: {
    "sidebar.section": ({ row, children }: PartProps) => (
      <nav {...rowAttributes(row)} aria-label={row.label}>
        {children}
      </nav>
    ),
    "sidebar.item": function Item({ row }: PartProps) {
      const run = useRowEffect(row);
      return row.kind === "destination" ? (
        <a
          {...rowAttributes(row)}
          href={row.effect?.kind === "navigate" ? row.effect.to : undefined}
          aria-current={row.state?.selected ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            run?.();
          }}
        >
          {row.label}
        </a>
      ) : (
        <button {...rowAttributes(row)} type="button" onClick={run}>
          {row.label}
        </button>
      );
    },
  },
});

const target = definePartSet({
  name: "target",
  parts: {
    "sidebar.section": ({ row, children }: PartProps) => (
      <div {...rowAttributes(row)} role="listbox" aria-label={row.label}>
        {children}
      </div>
    ),
    "sidebar.item": ({ row }: PartProps) => (
      <div
        {...rowAttributes(row)}
        role="option"
        aria-selected={Boolean(row.state?.selected)}
      >
        <span>{row.label}</span>
      </div>
    ),
  },
});

describe("part sets", () => {
  it("draws a model with the design system's part set", () => {
    render(
      <DesignSystemContext.Provider value={{ definition: { parts: ours } }}>
        <ModelSurface model={model} navigate={vi.fn()} />
      </DesignSystemContext.Provider>,
    );
    const inbox = screen.getByRole("link", { name: "Inbox" });
    expect(inbox.dataset.rid).toBe("sidebar.nav.inbox");
    expect(inbox.getAttribute("aria-current")).toBe("page");
    expect(inbox.closest("nav")?.dataset.part).toBe("sidebar.section");
  });

  it("runs effects through the model runtime", () => {
    const navigate = vi.fn();
    const createIssue = vi.fn();
    render(
      <DesignSystemContext.Provider value={{ definition: { parts: ours } }}>
        <ModelSurface
          model={model}
          navigate={navigate}
          actions={{ "create-issue": createIssue }}
        />
      </DesignSystemContext.Provider>,
    );
    act(() => screen.getByRole("link", { name: "Inbox" }).click());
    act(() => screen.getByRole("button", { name: "New issue" }).click());
    expect(navigate).toHaveBeenCalledWith(
      "/inbox",
      expect.objectContaining({ id: "sidebar.nav.inbox" }),
    );
    expect(createIssue).toHaveBeenCalledTimes(1);
  });

  it("throws when an effect has no handler instead of doing nothing", () => {
    render(
      <DesignSystemContext.Provider value={{ definition: { parts: ours } }}>
        <ModelSurface model={model} navigate={vi.fn()} />
      </DesignSystemContext.Provider>,
    );
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      act(() => screen.getByRole("button", { name: "New issue" }).click());
    } finally {
      window.removeEventListener("error", onError);
    }
    expect(errors).toEqual([expect.any(MissingEffectError)]);
  });

  it("throws for a part no part set draws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unknown: ScreenModel = {
      id: "page",
      rows: [{ id: "page.header", part: "page-header", label: "Title" }],
    };
    expect(() =>
      render(
        <DesignSystemContext.Provider value={{ definition: { parts: ours } }}>
          <ModelSurface model={unknown} />
        </DesignSystemContext.Provider>,
      ),
    ).toThrow(MissingPartError);
  });

  it("throws for a part the app's part set leaves out, even one toolkit draws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const save: ScreenModel = {
      id: "form",
      rows: [{ id: "form.save", part: "button", label: "Save" }],
    };
    expect(() =>
      render(
        <DesignSystemContext.Provider value={{ definition: { parts: ours } }}>
          <ModelSurface model={save} />
        </DesignSystemContext.Provider>,
      ),
    ).toThrow(new MissingPartError("button", "ours"));
    cleanup();
    const reusing = definePartSet({
      name: "reusing",
      parts: { ...AGENT_NATIVE_PART_SET.parts, ...ours.parts },
    });
    render(
      <DesignSystemContext.Provider value={{ definition: { parts: reusing } }}>
        <ModelSurface model={save} />
      </DesignSystemContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "Save" })).not.toBeNull();
  });

  it("draws only parts the model vocabulary names", () => {
    const refs = modelPartRefs();
    expect(
      Object.keys(AGENT_NATIVE_PART_SET.parts).filter((ref) => !refs.has(ref)),
    ).toEqual([]);
  });

  it("refuses an invalid model with every issue listed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const invalid: ScreenModel = {
      id: "bad",
      rows: [
        { id: "Bad", part: "sidebar.item", label: "x" },
        { id: "bad.b", part: "nope", label: "y" },
      ],
    };
    expect(() =>
      render(
        <DesignSystemContext.Provider value={{ definition: { parts: ours } }}>
          <ModelSurface model={invalid} />
        </DesignSystemContext.Provider>,
      ),
    ).toThrow(/invalid-id \(Bad\), unknown-part \(bad\.b\)/);
  });

  it("fills a row's slot with the app's content, and refuses an unfilled slot", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const withSlot: ScreenModel = {
      id: "player",
      rows: [
        { id: "player.canvas", part: "card", label: "Player", slot: "canvas" },
      ],
    };
    const parts = definePartSet({
      name: "slots",
      parts: {
        card: function Card({ row }: PartProps) {
          return <section {...rowAttributes(row)}>{useRowSlot(row)}</section>;
        },
      },
    });
    render(
      <DesignSystemContext.Provider value={{ definition: { parts } }}>
        <ModelSurface
          model={withSlot}
          slots={{ canvas: <video aria-label="Clip" /> }}
        />
      </DesignSystemContext.Provider>,
    );
    expect(
      screen.getByLabelText("Clip").closest("[data-rid-slot]"),
    ).not.toBeNull();
    cleanup();
    expect(() =>
      render(
        <DesignSystemContext.Provider value={{ definition: { parts } }}>
          <ModelSurface model={withSlot} />
        </DesignSystemContext.Provider>,
      ),
    ).toThrow(/did not fill/);
  });
});

describe("checkPartSetEquivalence", () => {
  it("finds two differently drawn part sets equivalent", async () => {
    const report = await checkPartSetEquivalence({ model, ours, target });
    expect(report.differences).toEqual([]);
    expect(report.unrendered).toEqual({ ours: [], target: [] });
    expect(report.compared).toBe(3);
    expect(report.equivalent).toBe(true);
  });

  it("catches a target that drops a state", async () => {
    const stateless = definePartSet({
      name: "stateless",
      parts: {
        ...target.parts,
        "sidebar.item": ({ row }: PartProps) => (
          <div {...rowAttributes(row)} role="option">
            {row.label}
          </div>
        ),
      },
    });
    const report = await checkPartSetEquivalence({
      model,
      ours,
      target: stateless,
    });
    expect(report.equivalent).toBe(false);
    expect(report.differences).toEqual([
      expect.objectContaining({
        rowId: "sidebar.nav.inbox",
        field: "selected",
      }),
    ]);
  });

  it("catches a part set that forgets the row attributes", async () => {
    const anonymous = definePartSet({
      name: "anonymous",
      parts: {
        ...target.parts,
        "sidebar.item": ({ row }: PartProps) => (
          <div role="option">{row.label}</div>
        ),
      },
    });
    const report = await checkPartSetEquivalence({
      model,
      ours,
      target: anonymous,
    });
    expect(report.equivalent).toBe(false);
    expect(report.unrendered.target).toEqual([
      "sidebar.nav.inbox",
      "sidebar.create.issue",
    ]);
  });
});

describe("combineFragments", () => {
  it("joins rows in order and merges their actions and slots", () => {
    const first = vi.fn();
    const combined = combineFragments([
      {
        rows: [{ id: "settings.a.one", part: "settings.row", label: "One" }],
        actions: { first },
      },
      {
        rows: [{ id: "settings.a.two", part: "settings.row", label: "Two" }],
        slots: { two: <span>Two</span> },
      },
    ]);
    expect(combined.rows.map((row) => row.id)).toEqual([
      "settings.a.one",
      "settings.a.two",
    ]);
    expect(combined.actions).toEqual({ first });
    expect(Object.keys(combined.slots ?? {})).toEqual(["two"]);
  });

  it("throws when two fragments define the same key", () => {
    expect(() =>
      combineFragments([
        { rows: [], slots: { status: null } },
        { rows: [], slots: { status: null } },
      ]),
    ).toThrow(/slot "status"/);
  });
});

describe("nested surfaces", () => {
  const host = (hosts?: readonly string[] | "any"): ScreenModel => ({
    id: "settings",
    rows: [
      {
        id: "settings.panel.agent",
        part: "settings.group",
        label: "Agent",
        slot: "body",
        hosts,
      },
    ],
  });
  const inner: ScreenModel = {
    id: "settings",
    rows: [
      { id: "settings.panel.limits", part: "settings.row", label: "Limits" },
    ],
  };

  it("draws a surface in a slot whose row hosts its rows", () => {
    render(
      <ModelSurface
        model={host(["settings.panel.limits"])}
        slots={{ body: <ModelSurface model={inner} /> }}
      />,
    );
    expect(screen.getByText("Limits")).not.toBeNull();
  });

  it("draws any surface in a slot that hosts any rows", () => {
    render(
      <ModelSurface
        model={host("any")}
        slots={{ body: <ModelSurface model={inner} /> }}
      />,
    );
    expect(screen.getByText("Limits")).not.toBeNull();
  });

  it("throws for a surface in a slot that does not host its rows", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <ModelSurface
          model={host()}
          slots={{ body: <ModelSurface model={inner} /> }}
        />,
      ),
    ).toThrow(UndeclaredNestedSurfaceError);
  });
});
