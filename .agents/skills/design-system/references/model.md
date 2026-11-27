# Headless model and part sets

The model is the middle of a from-to pipeline: a surface is described once,
as data, and any number of part sets draw it. Existing screens map onto it
(from), and part sets render it (to); the row ids join every side.

## The model

A surface is described once as rows (`@agent-native/design-system/model`):

```ts
const navigation: ScreenModel = {
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
      ],
    },
  ],
};
```

- `id`: dotted, lowercase, two or more segments, unique in the model. It is
  the join key between a source rendering and every part set that draws the
  model, so keep it stable when the UI changes; tests depend on it.
- `part`: a model part or `part.sub-part` from `MODEL_PARTS` (below), never
  a catalog component such as `navigation-menu.link`.
- `label`: the accessible name both part sets must expose, exactly.
- `kind`, `state`, `effect`, `badge`: what the row is, how it currently is, and
  what it does. No layout, no styling.
- `slot`: content that belongs to one app (a canvas, a player), filled by
  the app through `slots` and drawn beside the parts.
- `regions`: app content for a part's other named regions, each a slot key.
  `settings.row` draws `label` and `description` (in place of the text, which
  stays the row's label for search and tests), `status` (beside the label,
  after the badge) and `detail` (below the row, across its width). A part
  throws on a region it does not draw.
- `settings.content`: app content at its place among a group's rows (a
  skeleton, an empty or error state, a notice). It draws only its slot, so the
  slot is a function of the row that spreads `rowAttributes(row)` on its root.
- `settings.notice`: a row standing alone in place of content that could not
  load: the message is its label, the recovering action a `button` child row.
- `settings.report`: a titled block of a report page (Usage): its child
  rows, then its slot, in a card; the `action` region sits beside the title
  and the `body` region is content with its own card, drawn without one.
- `settings.section`: a titled block, collapsible in the sidebar (`expanded`,
  effect toggles it) and always open on a page. `complete` draws the
  connected check; a label badge with `tone: "attention"` reads as required.
  Content is the slot and child rows, in a card on a page; the `body` region
  draws without the card. Inside a `settings.group` it drops its header and
  card.
- `labelHidden`: the label still names the row, drawn visually hidden (a
  settings group with no visible title).
- `anchor`: the row element's DOM id, for deep links and settings search.

Ids built from data go through `rowIdSegment(value)`, which keeps a valid
segment and slugs anything else (an email, a name) with a hash, so two values
that slug alike stay apart.

`validateModel` lists every issue; `ModelSurface` throws on an invalid model.

## The vocabulary

`MODEL_PARTS` is version 1 of the parts a row can name, shared by every app
and part set: shell and navigation (`app-shell`, `sidebar`, `page-header`,
`toolbar`, `filter-bar`, `tabs`, `search`, `command-palette`,
`shortcuts-panel`, `settings`), overlays and controls (`menu`, `popover`,
`picker`, `select`, `date-picker`, `dialog`, `toast`, `tooltip`, `banner`,
`form`, `file-upload`, `empty-state`, `skeleton`), content (`list`, `card`,
`table`, `data-grid`, `board`, `timeline`, `calendar-view`, `chart`,
`inspector`, `property-list`, `activity-feed`, `rich-text-editor`), agent
(`chat-thread`, `composer`, `agent-panel`) and primitives (`button`, `input`,
`checkbox`, `switch`, `badge`, `avatar`, `kbd`).

It is separate from the component catalog: catalog components are what a
part set builds its markup from, and a model never names one. Version 1 is
frozen. A sub-part arrives with the part set that first draws it, and any
change updates the snapshot in `model/parts.spec.ts`, so it is reviewed.

## Drawing it

```tsx
<ModelSurface
  model={navigation}
  navigate={(to) => router.navigate(to)}
  actions={{ "create-issue": () => createIssue() }}
  slots={{ canvas: <Player /> }}
/>
```

A row whose state lives in one component and whose group is drawn by another
comes from a fragment: the owning component returns `{ rows, actions, slots }`
(`ModelFragment`) from a hook, and the surface draws `combineFragments([...])`,
which throws on two fragments defining the same action or slot.

When the owning component mounts only when shown (a section behind a filter)
or rows sit inside custom content, a fragment would need conditional hooks.
Then the component draws its own `ModelSurface` inside the host's slot, and
the host row lists those rows in `hosts` (`"any"` for content an app passed
in, whose rows it cannot know). A `ModelSurface` nested in a slot or region
whose row does not host its rows throws `UndeclaredNestedSurfaceError`.

Rows render through the design system's part set (`defineDesignSystem({ parts
})`), or toolkit's own when the app names none. A part set draws every part
its screens use: a part it leaves out throws `MissingPartError` even when
toolkit draws it, so a look never borrows another look's markup by accident.
To reuse toolkit's parts, spread them in on purpose:

```ts
const parts = definePartSet({
  name: "app",
  parts: { ...AGENT_NATIVE_PART_SET.parts, "sidebar.item": SidebarItem },
});
```

An effect nobody handles or an unfilled slot throws too; none of them
degrades silently.

### Whole parts

A surface with its own typed model (settings sections, the sidebar, the app
shell) can be drawn whole: the part set's `whole` map, keyed by part name,
holds a component that takes that model and owns all of its markup.

```ts
const parts = definePartSet({
  name: "app",
  parts: { ...AGENT_NATIVE_PART_SET.parts },
  whole: { settings: AppSettingsSections },
});
```

`useWholePart("settings")` returns it, and `SettingsSections` draws through it
unless a `SettingsSectionsRendererProvider` above it says otherwise. A whole
part the set leaves out is drawn by toolkit's own: a whole part draws its
surface alone, so no surface mixes two part sets. It writes the same
`data-rid` and `data-part` values as toolkit's, so the checks compare them.
`withDesignSystemParts(name, { SettingsSections, Sidebar, AppShell })` and
`useDesignSystemPart(name)` take the earlier names and are deprecated.

## Choosing a design system

An app's design system lives in one app-local module, `app/design-system.ts`,
which exports `designSystem` (`defineDesignSystem({ name, parts, primitives,
theme })`); the app's `ToolkitProvider` imports it as `@/design-system`. That file is the only choice:
nothing picks a design system at runtime, so one that a build leaves out never
reaches its bundle.

A build that needs another design system points the module at its own file
with the Vite plugin's `aliases` option, which resolves before the plugin's
own `@/` alias:

```ts
agentNative({
  aliases: { "@/design-system": "./app/alternate/design-system.ts" },
});
```

A build that must not ship a design system checks its emitted modules for
that file's path; the alias is the only import of it.

`primitives` replaces Base UI primitives by export name. A replacement takes
exactly the primitive's props, ref included (`DesignSystemPrimitiveOverrides`);
primitives it leaves out stay toolkit's, and code that imports them changes
nothing. A primitive becomes replaceable when its export is wrapped with
`swappable(name, primitive)` and listed in `DesignSystemPrimitives`; the
Button family is the first.

## Writing a part

A part receives `{ row, children }` and must:

1. spread `rowAttributes(row)` on the element that represents the row. It
   writes `data-rid` (the row id), `data-part` and `data-rid-*` for the rest,
   the same names the shell frames and toolkit's settings rows write; never
   `data-row`, which tables and grids use for their own cells;
2. expose state through ARIA or native state: `aria-current` or
   `aria-selected` for selected, `aria-checked` or a checked input,
   `aria-expanded`, `disabled` or `aria-disabled`, `aria-busy` for pending;
3. give the element the row's `label` as its accessible name;
4. render `children` (the nested rows) and run `useRowEffect(row)` on activation.

Two part sets that do this agree on what assistive technology hears, whatever
their markup.

## The two checks

- **Equivalence** (two part sets, structural):
  `checkPartSetEquivalence({ model, target })` from
  `@agent-native/toolkit/design-system/parts-testing` renders both, captures
  every row, and compares tree, order, names, kinds, states, effects, badges
  and slots. `equivalent` is false when anything differs or a part set left a
  model row unrendered. A deliberate difference goes in `accepted` with a
  reason of 10+ characters.
- **Row styles** (a target against its source, visual): map a source
  rendering that has no row ids with `applyRowLocators(document, [{ rowId,
selector }])` (missing and ambiguous selectors are reported, never guessed),
  capture both with `captureRowStyles`, and diff with
  `compareRowStyles(source, target, properties)`. `properties` limits the diff
  to what the target is meant to carry over.

Worked example: toolkit's settings. `app/settings/settings-part-sets.spec.tsx`
draws the real Preferences, Profile and Security screens and the settings nav
with toolkit's parts and the plain set in
`design-system/testing/plain-settings-parts.tsx`, and fails on purpose for a
set that drops a label. The `Patterns/Settings` story `RowStyleCheck` runs the
row style check in Chromium (`test:storybook`) against a set composed from the
same components, and catches a row drawn soft.
