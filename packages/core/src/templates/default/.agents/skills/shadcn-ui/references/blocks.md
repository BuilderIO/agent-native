# UI Blocks

Recipes for the composed patterns agents build most often. Each one is a
skeleton built from the app's `@/components/ui/*` shims and the house rules in
`SKILL.md` → Blocks. Copy the structure, then fill in domain content. If the
app has no shim for a primitive you need, add a one-line re-export next to the
existing ones (`export * from "@agent-native/toolkit/ui/<name>";`), not a
direct toolkit import.

Every user-visible string goes through `t()`. Skeletons below show keys as
`t("ns.key")`.

## Dialogs

Pick the primitive by what the user is deciding:

| Situation                                   | Primitive                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| Collect input, then do something            | `Dialog` (form dialog)                                                         |
| Confirm an action that is not destructive   | `AlertDialog`                                                                  |
| Confirm something that destroys data        | `AlertDialog` + `variant="destructive"`                                        |
| Several dependent decisions in order        | `Dialog` with steps (multi-step)                                               |
| A tool the user keeps open beside live work | Not a dialog. Use a `Popover`, `Sheet` with `modal={false}`, or a docked panel |

### Form dialog

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent aria-describedby={undefined}>
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("ns.renameTitle")}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={nameId}>{t("ns.nameLabel")}</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {error && (
          <p id={errorId} className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          {t("ns.rename")}
        </Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
```

- The title names the task ("Rename design"). No `DialogDescription` unless it
  says something the title and labels do not. With no description, pass
  `aria-describedby={undefined}`.
- Wrap the body in a `<form>` so Enter submits. Radix focuses the first field,
  so don't add manual focus timers.
- The primary button's label is the verb from the title ("Rename", "Create
  token"), never "OK", "Submit", or "Done".
- A load inside the dialog gets a `Skeleton` that matches the fields. The
  `Spinner` belongs only on the submit button while the mutation runs.

### Confirm dialog

```tsx
<AlertDialog open={open} onOpenChange={setOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{t("ns.publishTitle")}</AlertDialogTitle>
      <AlertDialogDescription>{t("ns.publishBody")}</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
      <AlertDialogAction onClick={onConfirm}>
        {t("ns.publish")}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- The title is the question ("Publish this form?"). The description is the
  message: what happens and to what. Here the description is the body, so the
  title-or-description rule does not apply.
- `AlertDialogCancel` is already `outline`. Don't restyle either button.

### Destructive confirm

Same as the confirm dialog, with three differences:

```tsx
<AlertDialogTitle>{t("ns.deleteTitle", { name })}</AlertDialogTitle>
...
<AlertDialogAction variant="destructive" onClick={onDelete}>
  {t("ns.delete")}
</AlertDialogAction>
```

- Name the object in the title ("Delete “Q3 launch”?"), with long names
  truncated. Say in the description whether it can be undone.
- Use `variant="destructive"`. Never hand-roll
  `bg-destructive text-destructive-foreground hover:bg-destructive/90`.
- Red is only for destroying something. Archive, sign out, disconnect, and
  revert-to-saved are reversible or non-destructive, so they use the default
  confirm. When a risky action destroys nothing, put an amber warning in the
  body: `IconAlertTriangle` plus the app's warning treatment, never red.

### Multi-step dialog

- One `DialogContent` whose size stays fixed across steps. Stack step panes in
  one grid cell so switching steps never resizes the dialog.
- The title names the whole flow. Show progress as a compact step indicator
  ("Step 2 of 3" or dots), with no per-step subtitle.
- Footer: Back (`outline` or `ghost`) at the start, the primary at the end.
  The last step's primary is the flow's verb ("Create workspace"), not "Next".
- Each step validates before Next. Errors stay on the step's fields.
- Sensible defaults let the user finish without touching optional steps.

## Menus

Applies to `DropdownMenu`, `ContextMenu`, `Menubar`, overflow (`IconDots`)
menus, card menus, and command palettes.

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t("ns.actionsFor", { name })}
    >
      <IconDots />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuGroup>
      <DropdownMenuItem onSelect={open}>{t("common.open")}</DropdownMenuItem>
      <DropdownMenuItem onSelect={startRename}>
        {t("ns.rename")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={duplicate}>
        {t("ns.duplicate")}
      </DropdownMenuItem>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuGroup>
      <DropdownMenuItem onSelect={openSaveAsTemplate}>
        {t("ns.saveAsTemplate")} {/* "Save as template…": opens a dialog */}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{t("ns.export")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>...</DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuItem
      className="text-destructive focus:text-destructive"
      onSelect={askDelete}
    >
      {t("ns.delete")}
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

**Text only.** Items have no leading icons. Keep what carries state or content:
check and radio indicators, submenu chevrons, `DropdownMenuShortcut`, a
trailing status or pending `Spinner` in `DropdownMenuTrailing`, and glyphs that
_are_ the content (color swatches, avatars, file-type badges, a layer-kind icon
that tells apart two rows with the same name).

**One exception: the prompt composer's `+` menu** (`ComposerContextMenu`: image,
file, Figma design, and so on). Its leading icons identify the kind of content
being added to the prompt, so they are part of the content. This exception
covers no other menu, including other menus that create or add things.

**Ellipsis (macOS HIG).** A label ends in `…` (U+2026, never `...`) only when the
row opens a dialog that asks for more input, or a system file panel. No
ellipsis when the row:

- acts immediately ("Duplicate", "Save local copy" that downloads at once),
- opens a submenu ("Export" with a chevron),
- opens a popover, panel, picker, or the composer ("Edit with agent", "Shader"
  opening a popover picker, "Publish app" opening a panel),
- only opens a confirmation alert ("Delete").

Dialog titles never end in `…`.

**Grouping and order.** `DropdownMenuGroup` sections divided by
`DropdownMenuSeparator`, most-used first: open and navigate, then create and
edit, then clipboard, arrange, and view toggles. Destructive items go last,
after a separator. A `DropdownMenuLabel` names a group only when the items
need it. Don't use it as a heading that restates the trigger or shows a value.

**State.** A choice the menu reflects uses `DropdownMenuRadioGroup` +
`DropdownMenuRadioItem indicator="check"` (single) or
`DropdownMenuCheckboxItem` (toggles), never plain items with a hand-drawn
check.

**Copy and overflow.** Sentence case. Names and paths truncate
(`min-w-0 truncate`, with `title=` for the full text). Items use `onSelect`.

**Placement.** A panel header's `+` or Import icon opens a menu, never a modal.
An overflow trigger that only shows on hover must also show on
`focus-visible` and while open (`data-[state=open]:opacity-100`).

Context menus follow the same rules with `ContextMenu*` parts.

## Popover forms

For a small edit anchored to its control (rename inline, a width, a link):

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline" size="sm">{t("ns.setWidth")}</Button>
  </PopoverTrigger>
  <PopoverContent aria-labelledby={headingId} className="grid gap-3">
    <h3 id={headingId} className="text-sm font-medium">{t("ns.width")}</h3>
    <form onSubmit={apply} className="flex gap-2">
      <Input aria-labelledby={headingId} ... />
      <Button type="submit" size="sm">{t("ns.apply")}</Button>
    </form>
  </PopoverContent>
</Popover>
```

- Name the popover (`aria-labelledby` a visible heading, or `aria-label`).
- One primary button, sized to the popover's controls. Dismissing is the
  cancel, so a Cancel button is optional.
- When it outgrows two or three fields, it is a dialog or a sheet.

## Sheet / side panel

```tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent
    side="right"
    className="flex flex-col gap-0 p-0"
    aria-describedby={undefined}
  >
    <SheetHeader className="border-b px-4 py-3">
      <SheetTitle>{t("ns.addItem")}</SheetTitle>
    </SheetHeader>
    <ScrollArea className="flex-1">
      <form id={formId} onSubmit={onSubmit} className="grid gap-6 p-4">
        {/* sections divided by <Separator />, each a grid of Label + control */}
      </form>
    </ScrollArea>
    <SheetFooter className="border-t px-4 py-3">
      <SheetClose asChild>
        <Button variant="outline">{t("common.cancel")}</Button>
      </SheetClose>
      <Button type="submit" form={formId}>
        {t("ns.add")}
      </Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

- Use a sheet for a long form or a record's details beside a list. The header
  and footer stay fixed and the body scrolls.
- `SheetTitle` is required. Make it `sr-only` if it isn't shown.
- Sections get a short heading only when there are several. No
  section-description lines.

## Settings rows

Use the Settings kit (`SettingsGroup`, `SettingsRow` from
`@agent-native/toolkit/app/settings`) inside the app's Settings group. Read
`agent-native-toolkit` → Settings Direction for page placement.

```tsx
<SettingsGroup id="notifications" title={t("settings.notifications")}>
  <SettingsRow
    id="email-on-response"
    label={t("settings.emailOnResponse")}
    control={
      <Switch
        checked={on}
        onCheckedChange={setOn}
        aria-label={t("settings.emailOnResponse")}
      />
    }
  />
  <SettingsRow
    id="export"
    label={t("settings.exportData")}
    control={
      <Button variant="outline" size="sm">
        {t("settings.export")}
      </Button>
    }
  />
</SettingsGroup>
```

- A group gets a title or a description, never both. No About group.
- A row is a label and its control. Extra explanation goes in a tooltip on the
  label, not a description line, unless the label truly cannot say it.
- The control matches the choice: `Switch` for on/off that applies at once,
  `Select` for a list, `RadioGroup` for two or three visible options.
- Row action buttons are `variant="outline" size="sm"`. A destructive row
  action is `variant="outline-destructive"` and opens a destructive confirm.
- Settings save as they change. No page-level Save button unless the group is a
  form that must submit together.
- Give every row an `id` and a search entry.

## Empty state

```tsx
<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon">
      <IconForms />
    </EmptyMedia>
    <EmptyTitle>{t("forms.emptyTitle")}</EmptyTitle>
  </EmptyHeader>
  <EmptyContent>
    <Button onClick={create}>{t("forms.create")}</Button>
  </EmptyContent>
</Empty>
```

| Kind                 | Content                                                   |
| -------------------- | --------------------------------------------------------- |
| First run            | Title plus one primary action that creates the first item |
| No results           | "No matches" title plus an `outline` "Clear filters"      |
| Cleared (inbox zero) | Title only                                                |
| Error                | What failed plus "Try again". Use `Alert`, not `Empty`    |

- A title or a description, not both. No illustration unless the product
  already has that imagery.
- Empty is for "loaded, and there is nothing". While loading, show `Skeleton`
  rows in the list's own layout.
- Render it inside the region that would hold the content, at that region's
  size, so the layout doesn't jump when the data arrives.

## List / table with row actions

```
[search InputGroup] [filter DropdownMenus] .................. [primary action]
┌──────────────────────────────────────────────────────────────────────────┐
│ [☐] Name ▲        Status      Updated           [⋯]                      │
│ [☐] Row           <Badge>     <time>            [⋯] (hover + focus)      │
└──────────────────────────────────────────────────────────────────────────┘
```

- Use `Table` for columns of comparable data, an `Item` list for one-line
  records, and `@agent-native/toolkit/data-grid` for spreadsheet editing.
- Toolbar: search on the start side, filters next to it (`DropdownMenu`
  with checkbox or radio items, `FilterTriggerIndicator` when active), the
  page's one primary action on the end side. No count strip over the rows.
- Row actions live in one trailing overflow menu (the menu recipe above).
  Keep one or two inline icon buttons only when they're the row's main job.
- Selecting rows swaps the toolbar for a bulk bar ("3 selected", bulk actions,
  Clear). It doesn't add a second toolbar.
- Loading: 5–8 `Skeleton` rows with the real column widths. Empty: the empty
  state inside the table area. Status: `Badge` variants, with no raw colors.
- Names truncate, and timestamps use the app's formatter.

## Command palette

```tsx
<CommandDialog open={open} onOpenChange={setOpen}>
  <CommandInput placeholder={t("ns.searchCommands")} />{" "}
  {/* "Search commands…" */}
  <CommandList>
    <CommandEmpty>{t("ns.noResults")}</CommandEmpty>
    <CommandGroup heading={t("ns.recent")}>
      <CommandItem onSelect={go}>
        {title}
        <CommandShortcut>⌘K</CommandShortcut>
      </CommandItem>
    </CommandGroup>
  </CommandList>
</CommandDialog>
```

- Check the toolkit's navigation and command kit before building one. Apps
  usually register entries rather than own a palette.
- Items follow the menu rules: text only (content glyphs allowed), sentence
  case, and shortcuts on the trailing edge.
- Group headings are nouns ("Recent", "Actions"). Hide a group when it has no
  matches.

## Toolbar

- Icon buttons are `variant="ghost" size="icon-sm"` with a localized
  `aria-label` and a `Tooltip`, never a native `title` too (two tooltips show).
  Put the shortcut in the tooltip with `Kbd`.
- Group related tools with `ButtonGroup`, mutually exclusive modes with
  `ToggleGroup type="single"` (it gives arrow-key focus), and divide groups
  with a vertical `Separator`.
- Controls sit beside the thing they affect. Don't regroup them by control type.
- Rarely used tools go in a trailing overflow `DropdownMenu`, not a second row.
- Keep the toolbar's height and button sizes fixed across modes and states.
  Switching a mode never resizes the bar.
- The surface's one primary action may sit at the end as a `default` button.
  Everything else is ghost or outline.
