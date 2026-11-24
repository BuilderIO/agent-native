Use an alert dialog when continuing requires a decision, such as discarding unsaved frame edits. Name the decision in `AlertDialogTitle` and put its consequence in `AlertDialogDescription`, so someone entering the dialog with a screen reader hears what is at stake.

`AlertDialogTrigger` can render a toolkit Button. Inside `AlertDialogPopup`, put the safe exit first and use a precise verb on `AlertDialogAction`. Both footer buttons close the dialog. The handler on the action performs the operation.

When the operation can fail asynchronously, control `open` and handle `onOpenChange`. Keep the dialog visible through failure and show the error beside the action so the user can try again.

Use `render` on `AlertDialogHeader` or `AlertDialogFooter` to supply your own element and keep the part’s styles.

```tsx
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@agent-native/toolkit/ui/base-ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/base-ui/button";

export function DiscardEdits({ discard }: { discard: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" />}>
        Discard edits
      </AlertDialogTrigger>
      <AlertDialogPopup>
        <AlertDialogTitle>Discard frame edits?</AlertDialogTitle>
        <AlertDialogDescription>
          The frame will return to its saved dimensions.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction color="danger" onClick={discard}>
            Discard edits
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
```

[Try confirmation and cancellation](?path=/story/components-alert-dialog--interactive)

[Base UI Alert Dialog](https://base-ui.com/react/components/alert-dialog) · [Radix Alert Dialog](https://www.radix-ui.com/themes/docs/components/alert-dialog)
