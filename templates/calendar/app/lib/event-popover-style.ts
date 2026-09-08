// Shared chrome for the two event popovers (detail and create). Both are meant
// to read as the same surface, and they drifted apart the last time each file
// carried its own copy of these values.
//
// The geometry is measured from Notion Calendar's event popover: a 284px shell,
// a single 13px/18px type scale for every row, 30px rows, and a 16px icon /
// 42px text column (16px inset + 18px icon + 8px gap). The one deliberate
// difference is color — these use our own tokens so light mode and theming come
// from the same place as the rest of the app.

/** Popover shell: translucent, blurred, and the source of the 13px type scale. */
export const eventPopoverShell =
  "flex max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden rounded-xl border-border/60 bg-popover/85 p-0 text-[13px] leading-[18px] shadow-[0_24px_48px_-8px_rgb(0_0_0/0.22),0_4px_12px_-1px_rgb(0_0_0/0.12)] backdrop-blur-md backdrop-saturate-150";

/** 284px, but never wider than the viewport on small screens. */
export const eventPopoverWidth = "w-[min(284px,calc(100vw-2rem))]";

/** 44px header. Right padding is tighter than left to sit under the icon buttons. */
export const eventPopoverHeader =
  "flex h-11 shrink-0 items-center justify-between border-b border-border/60 pl-4 pr-2.5";

export const eventPopoverHeaderTitle =
  "text-[13px] font-medium text-foreground";

/** Header icon buttons — 30px hit target around a 16px icon. */
export const eventPopoverHeaderButton =
  "size-[30px] rounded-md text-muted-foreground hover:text-foreground";

/** Full-bleed 1px rule between sections, matching Notion's edge-to-edge divider. */
export const eventPopoverDivider = "my-2 border-t border-border/60";

/** A 30px row: 16px inset, 18px icon, 8px gap, 13px text. */
export const eventPopoverRow = "flex items-start gap-2 px-4 py-1.5";

/** Row leading icon. Thin stroke keeps Tabler from reading heavier than Notion's. */
export const eventPopoverRowIcon = "size-[18px] shrink-0 text-muted-foreground";

/** Placeholder rows ("Add location", "Conferencing") sit a step further back. */
export const eventPopoverGhostText = "text-muted-foreground/60";

/** Full-width primary action (Join Zoom / Join Meet). */
export const eventPopoverPrimaryAction =
  "flex h-[30px] w-full items-center justify-center rounded-md px-2 text-[13px] font-medium";
