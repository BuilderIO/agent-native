Use a dialog when someone needs to finish or dismiss a focused task before returning to the page.

```tsx
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@agent-native/toolkit/ui/base-ui/dialog";
import { Button, ButtonLink } from "@agent-native/toolkit/ui/base-ui/button";

export function ImportAnnouncement() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="surface" />}>
        About import
      </DialogTrigger>
      <DialogPopup>
        <DialogTitle>Import a project</DialogTitle>
        <DialogDescription>
          Bring an existing website into your workspace.
        </DialogDescription>
        <DialogFooter>
          <DialogClose render={<Button variant="surface" />}>Later</DialogClose>
          <ButtonLink href="/import">Import now</ButtonLink>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
```

## Composition

`DialogPopup` includes the portal, backdrop, and close button. Give the dialog a name with `DialogTitle`. Use `DialogDescription` for a short introduction. If you omit it, pass `aria-describedby={undefined}` to the popup. Localize the close button with `closeLabel`.

For edge-to-edge artwork, place `DialogMedia` before `DialogBody`. Give meaningful images alternative text and videos playback controls. Group actions in `DialogFooter`. Both the footer and `DialogHeader` accept a custom element through `render`.

## State

Use `open` and `onOpenChange` on `Dialog` to control visibility. Set `keepMounted` on `DialogPopup` to preserve local form state between visits. For a custom transition, `className`, `backdropClassName` and `backdropStyle` accept callbacks that receive `open` and `transitionStatus`.

[Open a media-led tutorial](?path=/story/components-dialog--tutorial)

[Base UI Dialog](https://base-ui.com/react/components/dialog) · [Radix Dialog](https://www.radix-ui.com/themes/docs/components/dialog)
