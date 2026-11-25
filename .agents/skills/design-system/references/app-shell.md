# App shell and sidebar

`@agent-native/toolkit/app-shell/sidebar-shell` describes an app's frame and
navigation once, as data (`ShellModel`), and draws it with toolkit's frames.
It is the shell half of the from-to pipeline: an existing app's sidebar and
regions map onto the model, and any design system's frames draw it.

## The model

```ts
const model: ShellModel = {
  frame: { key: "mail", routeRuleId: "inbox" },
  regions: [
    /* app-shell.nav, app-shell.topbar, app-shell.main, ... */
  ],
  navigation: {
    /* sections of entries: sidebar.item, sidebar.tree, sidebar.rail, ... */
  },
  shortcuts: [],
  preferences: [],
  effects: [
    /* every action an entry runs, by id */
  ],
};
```

- Identity: every region and entry has an `id`, a `part` (`sidebar` or
  `app-shell`), a `subPart` from the v1 vocabulary (`sidebar.item`,
  `app-shell.topbar`), a `containerId` and an `order`. The id is the join key
  between a source rendering and every frame that draws the model.
- Effects: entries reference `ShellModel.effects` by id
  (`{ kind: "action", effectId }`), so pending and error state lives in one
  place. Navigation, external links and opened surfaces are effects too.
- Bindings: a value an entry edits (a choice, a rename, a disclosure) is a
  `ShellBinding`; writes go through its `changeEffectId`.
- State: `ShellReadState` (`ready`, `loading`, `error` with a reload effect) on
  regions and entries.
- `compatibility`: extra DOM attributes a frame may write for existing
  selectors. Toolkit's frames never write them.

## Drawing it

`AppShell` and `Sidebar` (exported as `ModelSidebar`) draw the model with the
part set's whole parts `app-shell` and `sidebar` (see `model.md`), or
toolkit's house frames (`HouseAppShell`, `HouseSidebar`) when it draws none:

```ts
defineDesignSystem({
  parts: definePartSet({
    name: "app",
    parts: { ...AGENT_NATIVE_PART_SET.parts },
    whole: { sidebar: MySidebar, "app-shell": MyAppShell },
  }),
});
```

A frame takes the model and owns all of its markup, and must emit the same
`data-rid` and `data-part` values as the house frames. `ShellHostProvider`
supplies what the model leaves to the app: the current path, symbols, labels,
navigation and generated owners.

Behaviour hooks are shared by every frame: `useSidebarCollapse`,
`useSidebarResize`, `useSidebarPeek`, `useNavigationOpener`,
`useNavigationDisclosure`, `useNavigationRename`, `useNavigationReorder`,
`useNavigationHistory`, `useShellShortcuts`, `useNavigationPreferences` and
`useNavigationFocusHandoff`. Stored values go through `readShellPreference`
and `writeShellPreference`.

## Checks

- `captureShellSnapshot(root)` reads every rendered region and entry (names,
  state, order, containers); `compareShellSnapshots(source, house, choices,
placements)` lists differences, allowing only the documented
  `ShellLookChoice` and `ShellPlacementDeviation` entries.
- `captureShellContentSlots` and `compareShellContentSlots` check app content
  placed in slots; `shellCoverage` reports which rows each frame rendered.
- `houseShellChoices(model)` lists the house frames' deliberate differences
  (native select for ordered choices, keyboard resize and reorder, the
  compact rail, the mobile drawer), to pass as accepted choices.
