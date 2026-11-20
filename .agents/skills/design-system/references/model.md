# Headless model and part sets

## The model

A surface is described once as rows (`@agent-native/design-system/model`):

```ts
const navigation: ScreenModel = {
  id: "sidebar",
  rows: [
    {
      id: "sidebar.main",
      part: "navigation-menu.list",
      kind: "section",
      label: "Main",
      rows: [
        {
          id: "sidebar.nav.inbox",
          part: "navigation-menu.link",
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
  the join key between our part set, a reference part set and the original
  product, so keep it stable when the UI changes; tests depend on it.
- `part`: a catalog part or `part.sub-part`.
- `label`: the accessible name both part sets must expose, exactly.
- `kind`, `state`, `effect`, `badge`: what the row is, how it currently is, and
  what it does. No layout, no styling.
- `slot`: content that belongs to one product (a canvas, a player), filled by
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
})`), falling back to toolkit's own parts. An unregistered part, an effect
nobody handles, or an unfilled slot throws; none of them degrades silently.

## Writing a part

A part receives `{ row, children }` and must:

1. spread `rowAttributes(row)` on the element that represents the row;
2. expose state through ARIA or native state: `aria-current` or
   `aria-selected` for selected, `aria-checked` or a checked input,
   `aria-expanded`, `disabled` or `aria-disabled`, `aria-busy` for pending;
3. give the element the row's `label` as its accessible name;
4. render `children` (the nested rows) and run `useRowEffect(row)` on activation.

Two part sets that do this agree on what assistive technology hears, whatever
their markup.

## The two checks

- **Equivalence** (ours against the reference, structural):
  `checkPartSetEquivalence({ model, reference })` from
  `@agent-native/toolkit/design-system/parts-testing` renders both, captures
  every row, and compares tree, order, names, kinds, states, effects, badges
  and slots. `equivalent` is false when anything differs or a part set left a
  model row unrendered. A deliberate difference goes in `accepted` with a
  reason of 10+ characters.
- **Fidelity** (the reference against the original product, visual): tag the
  original with `applyRowLocators(document, [{ rowId, selector }])` (missing
  and ambiguous selectors are reported, never guessed), capture both with
  `captureRowStyles`, and diff with `compareRowStyles(original, reference,
  properties)`.

Ours is never compared with the original: it is meant to look different.
Reference part sets and captures of other products live in the private repo,
never here or on npm.
