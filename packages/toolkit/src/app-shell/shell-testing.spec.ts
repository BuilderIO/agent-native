import { runInNewContext } from "node:vm";

import { parseHTML } from "linkedom";
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import type {
  NavigationEntry,
  NavigationSection,
  ShellModel,
  ShellRegion,
} from "./contracts.js";
import {
  captureShellSnapshot,
  compareShellSnapshots,
  shellCoverage,
  shellTags,
  type ShellCoverageRow,
  type ShellMountWitness,
  type ShellSemanticSnapshot,
} from "./shell-testing.js";

const snapshot = (id: string, order = 0): ShellSemanticSnapshot => ({
  id,
  part: "sidebar.item",
  containerId: "main",
  order,
  present: true,
  family: "button",
  role: "button",
  expanded: null,
  name: "Task list",
  value: null,
  choices: [],
  enabled: true,
  selected: null,
  checked: null,
  shortcut: null,
  badge: null,
  effect: { kind: "none", target: null, result: null },
  read: { status: "ready", message: null, recovery: null },
  action: { pending: false, error: null, recovery: null },
  keyboard: { reachable: true, operable: true },
});
describe("semantic equivalence", () => {
  it("preserves word boundaries and fails missing rows in both directions", () => {
    expect(
      compareShellSnapshots(
        [snapshot("one")],
        [{ ...snapshot("one"), name: "Tasklist" }],
      ).differences,
    ).toContain('["one",null]: name');
    expect(
      compareShellSnapshots(
        [snapshot("one")],
        [{ ...snapshot("one"), name: " Task   list " }],
      ).differences,
    ).toEqual([]);
    expect(
      compareShellSnapshots([snapshot("one")], [snapshot("two")]).differences,
    ).toEqual(
      expect.arrayContaining([
        '["one",null]: missing in house',
        '["two",null]: missing in source',
      ]),
    );
  });
  it("compares order within each container, disregarding inter-container traversal order", () => {
    const a = snapshot("a");
    const b = snapshot("b", 1);
    const c = { ...snapshot("c"), containerId: "footer" };
    expect(compareShellSnapshots([a, b, c], [c, a, b]).differences).toEqual([]);
    expect(
      compareShellSnapshots(
        [a, b],
        [
          { ...a, order: 1 },
          { ...b, order: 0 },
        ],
      ).differences,
    ).toContain("main: order");
  });
  it.each([
    "effect",
    "read",
    "action",
    "keyboard",
    "value",
    "choices",
    "enabled",
    "checked",
    "selected",
    "badge",
    "shortcut",
    "present",
  ] as const)("does not waive %s for a registered family change", (field) => {
    const a = snapshot("one");
    const b: ShellSemanticSnapshot = {
      ...a,
      family: "link",
      role: "link",
      expanded: true,
    };
    const changed: Partial<ShellSemanticSnapshot> = {
      effect: { kind: "route", target: "/wrong", result: null },
      read: { status: "error", message: "failed", recovery: "reload" },
      action: { pending: true, error: "failed", recovery: "retry" },
      keyboard: { reachable: false, operable: false },
      value: "different",
      choices: [{ value: "x", label: "Extra", enabled: true }],
      enabled: false,
      checked: true,
      selected: true,
      badge: { kind: "dot", value: null, accessibleLabel: "Unread" },
      shortcut: "Alt X",
      present: false,
    };
    Object.assign(b, { [field]: changed[field] });
    const result = compareShellSnapshots([a], [b], {
      lookChoices: [
        {
          id: "one",
          sourceFamily: "button",
          houseFamily: "link",
          reason: "Reviewed control family choice",
        },
      ],
    });
    expect(result.differences).toContain(`["one",null]: ${field}`);
    expect(result.differences).not.toContain('["one",null]: role');
  });
  it("requires independent matching family registrations and checks roles when families match", () => {
    const a = snapshot("one");
    const b = { ...a, family: "link", role: "link" };
    expect(compareShellSnapshots([a], [b]).differences).toContain(
      '["one",null]: unregistered control family',
    );
    expect(
      compareShellSnapshots([a], [b], {
        lookChoices: [
          {
            id: "one",
            sourceFamily: "button",
            houseFamily: "link",
            reason: "Reviewed",
          },
        ],
      }).differences,
    ).toEqual([]);
    expect(
      compareShellSnapshots([a], [{ ...a, role: "link" }]).differences,
    ).toContain('["one",null]: role');
    expect(() => compareShellSnapshots([a, a], [a])).toThrow(
      "Duplicate visible identity",
    );
  });
});
it("groups row/control tags, excludes hidden copies and rejects duplicate visible copies", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<div data-rid="one" data-part="sidebar.item"><button data-rid="one" data-part="sidebar.item">One</button></div><button hidden data-rid="one" data-part="sidebar.item">Hidden</button>';
  const options = {
    visible: (element: Element) => !element.hasAttribute("hidden"),
    observe: (
      identity: { id: string },
      _elements: readonly Element[],
      order: number,
    ) => snapshot(identity.id, order),
  };
  expect(captureShellSnapshot(root, options)).toEqual([snapshot("one")]);
  root.insertAdjacentHTML(
    "beforeend",
    '<button data-rid="one" data-part="sidebar.item">Duplicate</button>',
  );
  expect(() => captureShellSnapshot(root, options)).toThrow(
    "Duplicate visible identity",
  );
  expect(
    shellTags({ id: "one", entityKey: "entity" }, "sidebar.item", "main"),
  ).toEqual({
    "data-rid": "one",
    "data-rid-key": "entity",
    "data-part": "sidebar.item",
    "data-rid-container": "main",
  });
});
it("gives no family credit until every member and presentation mounts, and keeps body strictness separate", () => {
  const rows: ShellCoverageRow[] = [
    {
      id: "family",
      counted: true,
      forecast: "supported",
      contractEntry: "NavigationEntry",
      members: ["a", "b"],
      presentations: ["desktop", "mobile"],
    },
    {
      id: "body",
      counted: true,
      forecast: "custom",
      contractEntry: null,
      reason: "Domain body",
      members: [],
      presentations: ["desktop"],
    },
    {
      id: "outside",
      counted: false,
      forecast: "custom",
      contractEntry: null,
      reason: "Separate scope",
      members: [],
      presentations: [],
    },
  ];
  const witnesses: ShellMountWitness[] = [
    {
      id: "family",
      member: "a",
      presentation: "desktop",
      mounted: true,
      sharedBody: true,
    },
  ];
  expect(shellCoverage(rows, witnesses)).toMatchObject({
    denominator: 2,
    expressible: 1,
    covered: 0,
    strict: 0,
  });
  witnesses.push(
    {
      id: "family",
      member: "b",
      presentation: "desktop",
      mounted: true,
      sharedBody: true,
    },
    {
      id: "family",
      member: "a",
      presentation: "mobile",
      mounted: true,
      sharedBody: true,
    },
    {
      id: "family",
      member: "b",
      presentation: "mobile",
      mounted: true,
      sharedBody: false,
    },
  );
  expect(shellCoverage(rows, witnesses)).toMatchObject({
    denominator: 2,
    expressible: 1,
    covered: 1,
    strict: 0,
  });
  witnesses[3] = { ...witnesses[3], sharedBody: true };
  expect(shellCoverage(rows, witnesses).strict).toBe(1);
  expect(() =>
    shellCoverage(rows, [
      {
        id: "unknown",
        member: null,
        presentation: "desktop",
        mounted: true,
        sharedBody: true,
      },
    ]),
  ).toThrow("Unknown witness row");
});

it("accepts ordinary controlled string bindings and composes the approved owners without JSX bodies", () => {
  const entry: NavigationEntry = {
    id: "sidebar.nav.one",
    part: "sidebar",
    subPart: "sidebar.item",
    containerId: "primary",
    order: 0,
    kind: "choice",
    binding: { value: "one", set: (_value: string) => {} },
    choices: [{ value: "one", label: "One" }],
    state: {
      status: "error",
      message: "Read failed",
      reloadEffectId: "reload",
    },
    effect: { kind: "action", effectId: "save" },
  };
  const section: NavigationSection = {
    id: "sidebar.primary",
    part: "sidebar",
    subPart: "sidebar.section",
    containerId: "nav",
    order: 0,
    entries: [entry],
    hideIfEmpty: false,
  };
  const region: ShellRegion = {
    id: "shell.main",
    part: "app-shell",
    subPart: "app-shell.main",
    containerId: "shell",
    order: 0,
    content: { owner: "page", key: "current-route" },
  };
  const model: ShellModel = {
    frame: { key: "workspace", routeRuleId: "workspace-route" },
    regions: [region],
    navigation: {
      entries: [],
      sections: [section],
      presentation: {
        collapsed: { value: false },
        mobileOpen: { value: false },
        peekOpen: false,
        profile: "standard",
        themeFamily: "default",
        visibility: "visible",
        width: 244,
      },
    },
    shortcuts: [],
    preferences: [],
    effects: [
      {
        kind: "action",
        id: "save",
        actionName: "save-navigation",
        run: () => {},
      },
      {
        kind: "action",
        id: "reload",
        actionName: "load-navigation",
        run: () => {},
      },
    ],
  };
  expect(model.navigation.sections[0].entries[0].binding?.value).toBe("one");
});

it("compares stored strings and effect payloads byte for byte", () => {
  const a = {
    ...snapshot("one"),
    value: "a  b",
    effect: {
      kind: "write" as const,
      target: "save",
      result: { name: "a  b" },
    },
  };
  const b = {
    ...a,
    value: "a b",
    effect: { ...a.effect, result: { name: "a b" } },
  };
  expect(compareShellSnapshots([a], [b]).differences).toEqual([
    '["one",null]: value',
    '["one",null]: effect',
  ]);
});
it("rejects duplicate tagged controls even when they share one tagged wrapper", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<div data-rid="one" data-part="sidebar.item"><button data-rid="one" data-part="sidebar.item">First</button><button data-rid="one" data-part="sidebar.item">Second</button></div>';
  expect(() =>
    captureShellSnapshot(root, {
      visible: () => true,
      observe: (identity) => snapshot(identity.id),
    }),
  ).toThrow("Duplicate visible identity");
});

it.each([
  "menuitemradio",
  "menuitemcheckbox",
  "checkbox",
  "radio",
  "option",
  "tab",
  "treeitem",
  "switch",
  "combobox",
  "listbox",
  "slider",
  "spinbutton",
])("rejects sibling %s controls sharing a row identity", (role) => {
  const root = document.createElement("div");
  root.innerHTML = `<div data-rid="one" data-part="sidebar.item"><div role="${role}" data-rid="one" data-part="sidebar.item">First</div><div role="${role}" data-rid="one" data-part="sidebar.item">Second</div></div>`;
  expect(() =>
    captureShellSnapshot(root, {
      visible: () => true,
      observe: (identity) => snapshot(identity.id),
    }),
  ).toThrow("Duplicate visible identity");
});

it.each([
  'contenteditable=""',
  'contenteditable="plaintext-only"',
  'role="link"',
])("rejects duplicate controls with %s", (attribute) => {
  const root = document.createElement("div");
  root.innerHTML = `<div data-rid="one" data-part="sidebar.item"><div ${attribute} data-rid="one" data-part="sidebar.item">First</div><div ${attribute} data-rid="one" data-part="sidebar.item">Second</div></div>`;
  expect(() =>
    captureShellSnapshot(root, {
      visible: () => true,
      observe: (identity) => snapshot(identity.id),
    }),
  ).toThrow("Duplicate visible identity");
});

const rowTag = 'data-rid="one" data-part="sidebar.item"';
const captureOptions = {
  visible: (element: Element) => !element.closest("[hidden]"),
  observe: (identity: { id: string }) => snapshot(identity.id),
};

it("review 4: rejects duplicate controls with fallback role tokens", () => {
  const root = document.createElement("div");
  root.innerHTML = `<div ${rowTag}><span ${rowTag} role="link button">A</span><span ${rowTag} role="link button">B</span></div>`;
  expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
    'Duplicate visible identity: ["one",null]',
  );
});
it("review 4: rejects a disclosure containing an independently interactive link", () => {
  const root = document.createElement("div");
  root.innerHTML = `<details open><summary ${rowTag}>Toggle<a ${rowTag} href="/x">Navigate</a></summary></details>`;
  expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
    'Duplicate visible identity: ["one",null]',
  );
});
it("review 4: compares displayed choice order even with a family witness", () => {
  const a = {
    ...snapshot("one"),
    choices: [
      { value: "a", label: "A", enabled: true },
      { value: "b", label: "B", enabled: false },
    ],
  };
  for (const family of ["button", "link"]) {
    const b = { ...a, family, choices: [...a.choices].reverse() };
    expect(
      compareShellSnapshots(
        [a],
        [b],
        family === "link"
          ? {
              lookChoices: [
                {
                  id: "one",
                  sourceFamily: "button",
                  houseFamily: "link",
                  reason: "Reviewed",
                },
              ],
            }
          : {},
      ).differences,
    ).toEqual(['["one",null]: choices']);
  }
});
it("review 4: rejects non-finite values and nested effect results with the row id", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const a = snapshot("one");
    expect(() => compareShellSnapshots([a], [{ ...a, value }])).toThrow(/one/);
    expect(() =>
      compareShellSnapshots(
        [a],
        [{ ...a, effect: { ...a.effect, result: { amount: value } } }],
      ),
    ).toThrow(/one/);
  }
});

const domEngines = [
  { name: "happy-dom", root: () => document.createElement("div") },
  {
    name: "linkedom",
    root: () =>
      parseHTML("<html><body></body></html>").document.createElement("div"),
  },
];
const roleSpellings = [
  "link",
  " LINK ",
  "link button",
  "future-widget link",
  "future-widget LINK button",
  "\tLiNk\nbutton",
  "button link",
  "future-widget\tbutton",
  "textbox",
  " searchbox ",
  "scrollbar",
  "gridcell",
  "doc-noteref",
  " DOC-BACKLINK ",
  "future-widget doc-biblioref",
  "doc-glossref link",
  "\fbutton\r\tlink\n",
  ...[
    "\u00a0",
    "\u2003",
    "\u202f",
    "\u000b",
    "\u0085",
    "\u2028",
    "\u2029",
    "\ufeff",
  ].map((separator) => `group${separator}button link`),
];
const nestingShapes = [
  "siblings",
  "nested",
  "wrapper",
  "label",
  "owned-siblings",
  "owned-nested",
] as const;
const visibilities = ["visible", "second-hidden", "all-hidden"] as const;
const roleMatrix = roleSpellings.flatMap((role) =>
  nestingShapes.flatMap((shape) =>
    visibilities.map((visibility) => ({ role, shape, visibility })),
  ),
);
const renderRoleShape = (
  root: Element,
  { role, shape, visibility }: (typeof roleMatrix)[number],
) => {
  const hidden = visibility === "second-hidden" ? "hidden" : "";
  const first = `<span ${rowTag} role="${role}">First</span>`;
  const second = `<span ${rowTag} role="${role}" ${hidden}>Second</span>`;
  if (shape === "siblings")
    root.innerHTML = `<div ${rowTag}>${first}${second}</div>`;
  if (shape === "nested")
    root.innerHTML = `<span ${rowTag} role="${role}">First${second}</span>`;
  if (shape === "wrapper")
    root.innerHTML = `<div ${rowTag}>${first}<span ${rowTag} ${hidden}>Label</span></div>`;
  if (shape === "label")
    root.innerHTML = `<label ${rowTag}>Label${first}<span ${rowTag} ${hidden}>Hint</span></label>`;
  if (shape === "owned-siblings")
    root.innerHTML = `<div ${rowTag}><div ${rowTag}><span role="${role}">First</span></div><div ${rowTag} ${hidden}><span role="${role}">Second</span></div></div>`;
  if (shape === "owned-nested")
    root.innerHTML = `<div ${rowTag}><span role="${role}">First<div ${rowTag} ${hidden}><span role="${role}">Second</span></div></span></div>`;
  if (visibility === "all-hidden") root.setAttribute("hidden", "");
};
const duplicatesVisibleIdentity = ({
  shape,
  visibility,
}: (typeof roleMatrix)[number]) =>
  (shape === "siblings" ||
    shape === "nested" ||
    shape === "owned-siblings" ||
    shape === "owned-nested") &&
  visibility === "visible";
describe.each(domEngines)("capture in $name", ({ root: makeRoot }) => {
  it.each(roleMatrix.filter(duplicatesVisibleIdentity))(
    "role=$role shape=$shape visibility=$visibility rejects the duplicate",
    (shape) => {
      const root = makeRoot();
      renderRoleShape(root, shape);
      let observations = 0;
      const options = {
        ...captureOptions,
        observe: (identity: { id: string }) => {
          observations++;
          return snapshot(identity.id);
        },
      };
      expect(() => captureShellSnapshot(root, options)).toThrow(
        'Duplicate visible identity: ["one",null]',
      );
      expect(observations).toBe(0);
    },
  );
  it.each(roleMatrix.filter((shape) => !duplicatesVisibleIdentity(shape)))(
    "role=$role shape=$shape visibility=$visibility",
    (shape) => {
      const root = makeRoot();
      renderRoleShape(root, shape);
      let observations = 0;
      const options = {
        ...captureOptions,
        observe: (identity: { id: string }) => {
          observations++;
          return snapshot(identity.id);
        },
      };
      const expected =
        shape.visibility === "all-hidden" ? [] : [snapshot("one")];
      expect(captureShellSnapshot(root, options)).toEqual(expected);
      expect(observations).toBe(expected.length);
    },
  );
  it.each([
    "checkbox",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "progressbar",
    "radio",
    "slider",
    "spinbutton",
    "switch",
    "tab",
    "tabpanel",
    "treeitem",
    "combobox",
    "grid",
    "listbox",
    "menu",
    "menubar",
    "radiogroup",
    "tablist",
    "tree",
    "treegrid",
    "doc-backlink",
    "doc-biblioref",
    "doc-glossref",
    "doc-noteref",
  ])("rejects widget role %s without tabindex", (role) => {
    const root = makeRoot();
    root.innerHTML = `<div ${rowTag}><div ${rowTag} role="${role}">A</div><div ${rowTag} role="${role}">B</div></div>`;
    expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
      "Duplicate visible identity",
    );
  });
  const firstRecognizedRoles: readonly (readonly [string, boolean])[] = [
    ["group link", false],
    ["future-widget group link", false],
    ["presentation button", false],
    ["none link", false],
    ["article button", false],
    ["comment link", false],
    ["separator link", false],
    ["doc-abstract link", false],
    ["doc-pageheader button", false],
    ["graphics-symbol button", false],
    ["future-widget", false],
    ["widget link", true],
    ["constructor link", true],
    ["lin\u212a group", false],
  ];
  it.each(firstRecognizedRoles.filter(([, control]) => control))(
    "uses the first recognized non-abstract role in %s as a control",
    (role) => {
      const root = makeRoot();
      root.innerHTML = `<div ${rowTag} role="${role}"><button ${rowTag}>A</button></div>`;
      expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
        "Duplicate visible identity",
      );
    },
  );
  it.each(firstRecognizedRoles.filter(([, control]) => !control))(
    "uses the first recognized non-abstract role in %s as a row",
    (role) => {
      const root = makeRoot();
      root.innerHTML = `<div ${rowTag} role="${role}"><button ${rowTag}>A</button></div>`;
      expect(captureShellSnapshot(root, captureOptions)).toEqual([
        snapshot("one"),
      ]);
    },
  );
  it.each([
    "<button>One</button>",
    '<a href="/one">One</a>',
    '<area href="/one">',
    "<input>",
    "<select></select>",
    "<textarea></textarea>",
    '<div tabindex="0">One</div>',
    '<div tabindex="-1">One</div>',
    "<div contenteditable>One</div>",
    '<div contenteditable="true">One</div>',
    '<div contenteditable="TrUe">One</div>',
    '<div contenteditable="plaintext-only">One</div>',
    '<div contenteditable="PLAINTEXT-ONLY">One</div>',
    "<video controls></video>",
    "<audio controls></audio>",
  ])("recognizes native/focus/edit control %s", (html) => {
    const root = makeRoot();
    root.innerHTML = `<div ${rowTag}>${html}${html}</div>`;
    for (const child of root.children[0].children) {
      child.setAttribute("data-rid", "one");
      child.setAttribute("data-part", "sidebar.item");
    }
    expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
      "Duplicate visible identity",
    );
  });
  it("rejects summary/link nesting in either engine", () => {
    const root = makeRoot();
    root.innerHTML = `<details open><summary ${rowTag}>Toggle<a ${rowTag} href="/x">Navigate</a></summary></details>`;
    expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
      "Duplicate visible identity",
    );
  });
  it.each([
    'contenteditable="false"',
    'contenteditable="inherit"',
    'contenteditable="invalid"',
  ])("groups non-editing wrapper %s with one control", (attribute) => {
    const root = makeRoot();
    root.innerHTML = `<div ${rowTag} ${attribute}><button ${rowTag}>A</button></div>`;
    expect(captureShellSnapshot(root, captureOptions)).toEqual([
      snapshot("one"),
    ]);
  });
});

it("distinguishes negative zero at every payload depth with and without a family witness", () => {
  for (const family of ["button", "link"]) {
    const a = {
      ...snapshot("one"),
      value: -0,
      effect: { ...snapshot("one").effect, result: { amount: [-0] } },
    };
    const b = {
      ...a,
      family,
      value: 0,
      effect: { ...a.effect, result: { amount: [0] } },
    };
    expect(
      compareShellSnapshots(
        [a],
        [b],
        family === "link"
          ? {
              lookChoices: [
                {
                  id: "one",
                  sourceFamily: "button",
                  houseFamily: "link",
                  reason: "Reviewed",
                },
              ],
            }
          : {},
      ).differences,
    ).toEqual(['["one",null]: value', '["one",null]: effect']);
  }
});
const lossyValues: { name: string; make: () => unknown }[] = [
  { name: "undefined", make: () => undefined },
  { name: "NaN", make: () => NaN },
  { name: "positive infinity", make: () => Infinity },
  { name: "negative infinity", make: () => -Infinity },
  { name: "date", make: () => new Date("2026-01-01T00:00:00Z") },
  { name: "invalid date", make: () => new Date(NaN) },
  { name: "map", make: () => new Map([["x", 1]]) },
  { name: "set", make: () => new Set([1]) },
  { name: "regexp", make: () => /x/ },
  { name: "boxed number", make: () => Object(1) },
  { name: "bigint", make: () => 1n },
  { name: "function", make: () => () => 1 },
  { name: "symbol", make: () => Symbol("x") },
  { name: "symbol key", make: () => ({ [Symbol("x")]: 1 }) },
  {
    name: "non-enumerable key",
    make: () => Object.defineProperty({}, "x", { value: 1 }),
  },
  {
    name: "accessor",
    make: () => ({
      get x() {
        throw new Error("Getter must not execute");
      },
    }),
  },
  { name: "toJSON", make: () => ({ toJSON: () => null }) },
  { name: "sparse array", make: () => Array(1) },
  {
    name: "extended sparse array",
    make: () => Object.assign(Array(1), { extra: 1 }),
  },
  { name: "extended array", make: () => Object.assign([1], { extra: 1 }) },
  {
    name: "cycle",
    make: () => {
      const value: Record<string, unknown> = {};
      value.self = value;
      return value;
    },
  },
];
it.each(lossyValues)(
  "rejects $name with row and field, in either input and with a family witness",
  ({ make }) => {
    const a = snapshot("one");
    for (const family of ["button", "link"]) {
      const options =
        family === "link"
          ? {
              lookChoices: [
                {
                  id: "one",
                  sourceFamily: "button",
                  houseFamily: "link",
                  reason: "Reviewed",
                },
              ],
            }
          : {};
      for (const field of ["value", "effect"] as const) {
        const payload = make() as ShellSemanticSnapshot["value"];
        const bad =
          field === "value"
            ? { ...a, value: payload }
            : { ...a, effect: { ...a.effect, result: { nested: [payload] } } };
        expect(() =>
          compareShellSnapshots([a], [{ ...bad, family }], options),
        ).toThrow(`Invalid snapshot ["one",null].${field}`);
        expect(() =>
          compareShellSnapshots([bad], [{ ...a, family }], options),
        ).toThrow(`Invalid snapshot ["one",null].${field}`);
      }
    }
  },
);
it("accepts independently built records in different key order, dense arrays and repeated references", () => {
  const repeated = { x: 1 };
  const a = {
    ...snapshot("one"),
    value: { b: [repeated, repeated], a: false },
  };
  const b = {
    ...snapshot("one"),
    value: { a: false, b: [{ x: 1 }, { x: 1 }] },
  };
  expect(compareShellSnapshots([a], [b]).differences).toEqual([]);
  expect(
    compareShellSnapshots([a], [{ ...b, value: { a: false, b: [{ x: 1 }] } }])
      .differences,
  ).toEqual(['["one",null]: value']);
});

it("follow-up: rejects untagged independent controls owned by tagged wrappers", () => {
  for (const engine of domEngines) {
    const root = engine.root();
    root.innerHTML = `<div ${rowTag}><div ${rowTag}><button>A</button></div><div ${rowTag}><button>B</button></div></div>`;
    expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
      "Duplicate visible identity",
    );
  }
});
it("follow-up: rejects publishing link widgets in both engines", () => {
  for (const engine of domEngines) {
    const root = engine.root();
    root.innerHTML = `<div ${rowTag}><span ${rowTag} role="doc-noteref">A</span><span ${rowTag} role="doc-noteref">B</span></div>`;
    expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
      "Duplicate visible identity",
    );
  }
});
it("follow-up: accepts the optional undefined entity key on snapshots and witnesses", () => {
  const a = snapshot("one");
  expect(
    compareShellSnapshots([a], [{ ...a, entityKey: undefined }]).differences,
  ).toEqual([]);
  expect(
    compareShellSnapshots(
      [a],
      [{ ...a, family: "link", entityKey: undefined }],
      {
        lookChoices: [
          {
            id: "one",
            entityKey: undefined,
            sourceFamily: "button",
            houseFamily: "link",
            reason: "Reviewed",
          },
        ],
      },
    ).differences,
  ).toEqual([]);
});
it("follow-up: accepts plain records and arrays across realms and with null prototypes", () => {
  const a = { ...snapshot("one"), value: { amount: [1, null, false] } };
  for (const value of [
    runInNewContext(
      "({ amount: [1, null, false] })",
    ) as ShellSemanticSnapshot["value"],
    Object.assign(Object.create(null), {
      amount: [1, null, false],
    }) as ShellSemanticSnapshot["value"],
  ])
    expect(compareShellSnapshots([a], [{ ...a, value }]).differences).toEqual(
      [],
    );
});

describe.each(domEngines)("row ownership in $name", ({ root: makeRoot }) => {
  it("keeps differently identified descendant controls with their own rows", () => {
    const root = makeRoot();
    root.innerHTML = `<div ${rowTag}><div data-rid="two" data-part="sidebar.item"><button>A</button></div><div data-rid="three" data-part="sidebar.item"><button>B</button></div></div>`;
    expect(captureShellSnapshot(root, captureOptions)).toEqual([
      snapshot("one"),
      snapshot("two"),
      snapshot("three"),
    ]);
  });
  it("keeps separate entity keys with their controls", () => {
    const root = makeRoot();
    root.innerHTML = `<div ${rowTag}><div ${rowTag} data-rid-key="a"><button>A</button></div><div ${rowTag} data-rid-key="b"><button>B</button></div></div>`;
    expect(
      captureShellSnapshot(root, {
        ...captureOptions,
        observe: (identity) => ({ ...snapshot(identity.id), ...identity }),
      }),
    ).toEqual([
      snapshot("one"),
      { ...snapshot("one"), entityKey: "a" },
      { ...snapshot("one"), entityKey: "b" },
    ]);
  });
});
it("validates foreign payloads recursively without waiving their differences", () => {
  const a = { ...snapshot("one"), value: { amount: [1] } };
  expect(
    compareShellSnapshots(
      [a],
      [
        {
          ...a,
          value: runInNewContext(
            "({amount:[2]})",
          ) as ShellSemanticSnapshot["value"],
        },
      ],
    ).differences,
  ).toEqual(['["one",null]: value']);
  expect(() =>
    compareShellSnapshots(
      [a],
      [
        {
          ...a,
          value: runInNewContext(
            "({amount:[NaN]})",
          ) as ShellSemanticSnapshot["value"],
        },
      ],
    ),
  ).toThrow('Invalid snapshot ["one",null].value.amount.0');
  expect(() =>
    compareShellSnapshots(
      [a],
      [
        {
          ...a,
          value: {
            entityKey: undefined,
          } as unknown as ShellSemanticSnapshot["value"],
        },
      ],
    ),
  ).toThrow('Invalid snapshot ["one",null].value.entityKey');
});

it("final-round: uses HTML token separators for fallback roles", () => {
  for (const engine of domEngines)
    for (const separator of ["\u00a0", "\u2003", "\u202f", "\u000b"]) {
      const root = engine.root();
      root.innerHTML = `<div ${rowTag}><span ${rowTag} role="group${separator}button link">A</span><span ${rowTag} role="group${separator}button link">B</span></div>`;
      expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
        "Duplicate visible identity",
      );
    }
});
it("final-round: captures one native select including explicitly marked options", () => {
  for (const engine of domEngines) {
    const root = engine.root();
    root.innerHTML = `<select ${rowTag}><option role="option" value="a">A</option><option role="option" value="b" disabled>B</option></select>`;
    let observations = 0;
    const result = captureShellSnapshot(root, {
      ...captureOptions,
      observe: (identity) => {
        observations++;
        return {
          ...snapshot(identity.id),
          choices: [...root.querySelectorAll("option")].map((option) => ({
            value: option.getAttribute("value") ?? "",
            label: option.textContent,
            enabled: !option.hasAttribute("disabled"),
          })),
        };
      },
    });
    expect(observations).toBe(1);
    expect(result).toEqual([
      {
        ...snapshot("one"),
        choices: [
          { value: "a", label: "A", enabled: true },
          { value: "b", label: "B", enabled: false },
        ],
      },
    ]);
  }
});

describe.each(domEngines)(
  "native choice ownership in $name",
  ({ root: makeRoot }) => {
    it("counts separate selects under one tagged wrapper separately", () => {
      const root = makeRoot();
      root.innerHTML = `<div ${rowTag}><select><option role="option">A</option></select><select><option role="option">B</option></select></div>`;
      expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
        "Duplicate visible identity",
      );
    });
    it("keeps choice internals with their select through repeated wrapper tags", () => {
      const root = makeRoot();
      root.innerHTML = `<div ${rowTag}><select ${rowTag}><optgroup label="Group"><option ${rowTag} role="option">A</option><option ${rowTag} role="option">B</option></optgroup></select></div>`;
      expect(captureShellSnapshot(root, captureOptions)).toEqual([
        snapshot("one"),
      ]);
    });
  },
);

describe.each(domEngines)(
  "post-review corrections in $name",
  ({ root: makeRoot }) => {
    it.each(["columnheader", "rowheader"])(
      "rejects independently active grid %s controls",
      (role) => {
        const root = makeRoot();
        root.innerHTML = `<div role="future-widget GRID" tabindex="0" aria-activedescendant="a"><div ${rowTag} role="row"><span ${rowTag} id="a" role="${role}">A</span><span ${rowTag} id="b" role="${role}">B</span></div></div>`;
        expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
          "Duplicate visible identity",
        );
      },
    );
    it("captures one ARIA listbox with its managed choices", () => {
      const root = makeRoot();
      root.innerHTML = `<div ${rowTag} role="listbox" tabindex="0" aria-activedescendant="a"><div id="a" role="option" aria-selected="true">A</div><div id="b" role="option" aria-selected="false">B</div></div>`;
      expect(captureShellSnapshot(root, captureOptions)).toEqual([
        snapshot("one"),
      ]);
    });
  },
);

describe.each(domEngines)(
  "compound control boundaries in $name",
  ({ root: makeRoot }) => {
    it.each(["grid", "treegrid", "future-widget GRID"])(
      "detects header controls inside %s",
      (context) => {
        for (const role of ["columnheader", "rowheader"]) {
          const root = makeRoot();
          root.innerHTML = `<div role="${context}"><div ${rowTag} role="row"><span ${rowTag} role="${role}">A</span><span ${rowTag} role="${role}">B</span></div></div>`;
          expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
            "Duplicate visible identity",
          );
        }
      },
    );
    it("groups static table headers and respects a nested table boundary", () => {
      const root = makeRoot();
      root.innerHTML = `<div role="grid"><div ${rowTag} role="table"><span ${rowTag} role="columnheader">A</span><span ${rowTag} role="rowheader">B</span></div></div>`;
      expect(captureShellSnapshot(root, captureOptions)).toEqual([
        snapshot("one"),
      ]);
    });
    it.each([
      [
        'role="listbox" tabindex="0"',
        '<div role="option">A</div><div role="option">B</div>',
      ],
      [
        'role="radiogroup"',
        '<div role="radio">A</div><div role="radio">B</div>',
      ],
      ['role="radiogroup"', '<input type="radio"><input type="radio">'],
      [
        'role="combobox"',
        '<input role="textbox"><div role="listbox"><span role="option">A</span><span role="option">B</span></div>',
      ],
    ])("captures one compound choice %s", (attributes, children) => {
      const root = makeRoot();
      root.innerHTML = `<div ${rowTag} ${attributes}>${children}</div>`;
      expect(captureShellSnapshot(root, captureOptions)).toEqual([
        snapshot("one"),
      ]);
      root.innerHTML = `<div ${rowTag}><div ${rowTag} ${attributes}>${children}</div><div ${rowTag} ${attributes}>${children}</div></div>`;
      expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
        "Duplicate visible identity",
      );
    });
    it("keeps independently identified options with their own rows", () => {
      const root = makeRoot();
      root.innerHTML = `<div ${rowTag} role="listbox"><div data-rid="two" data-part="sidebar.item"><span role="option">A</span><span role="option">B</span></div></div>`;
      expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
        'Duplicate visible identity: ["two",null]',
      );
    });
    it("rejects an independent link inside a choice widget", () => {
      const root = makeRoot();
      root.innerHTML = `<div ${rowTag} role="listbox"><span role="option">A</span><a href="/help">Help</a></div>`;
      expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
        "Duplicate visible identity",
      );
    });
    it("permits one visible combobox delegate, rejects multiple independent delegates", () => {
      const root = makeRoot();
      root.innerHTML = `<div ${rowTag} role="combobox"><input><input hidden></div>`;
      expect(captureShellSnapshot(root, captureOptions)).toEqual([
        snapshot("one"),
      ]);
      root.querySelector("[hidden]")?.removeAttribute("hidden");
      expect(() => captureShellSnapshot(root, captureOptions)).toThrow(
        "Duplicate visible identity",
      );
    });
  },
);
