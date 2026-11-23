Use a toast for the outcome of a background action while the user keeps working, such as a successful export or an opportunity to undo a deletion. Put errors that need a field correction beside that field so the correction stays available after a notification closes.

Mount one `Toaster` for the application and give it localized `regionLabel` and `closeLabel` values. Call `toast.add` from the action's completion handler. It returns an ID for `toast.update` and `toast.close`. A toast with an action persists by default so users have time to reach it.

To anchor notifications inside a themed canvas, pass its element or ref to `Toaster` through `container`. [Canvas notifications](?path=/story/components-theme-provider--canvas-notifications)

For an asynchronous export, `toast.promise` updates the same notification as the promise settles and returns the underlying result. The Promise story exercises success and failure. The With Action story demonstrates Undo and an optional secondary action.

```tsx
import { Toaster, toast } from "@agent-native/toolkit/ui/base-ui/toast";
import { Button } from "@agent-native/toolkit/ui/base-ui/button";

export function ExportPanel({
  exportFrame,
}: {
  exportFrame: () => Promise<void>;
}) {
  async function run() {
    await toast.promise(exportFrame(), {
      loading: { title: "Exporting frame" },
      success: { title: "Frame exported" },
      error: { title: "Export failed" },
    });
  }

  return (
    <>
      <Toaster regionLabel="Notifications" closeLabel="Dismiss notification" />
      <Button onClick={() => void run().catch(console.error)}>
        Export frame
      </Button>
    </>
  );
}
```

Swipe down or toward the side where the stack sits to dismiss a toast. With reduced motion, it fades in place. For a standalone notification region, import `@agent-native/design-system/components/toast.css` alongside tokens and your app theme.

[Respond with Undo](?path=/story/components-toast--with-action) · [Right-to-left stack](?path=/story/components-toast--stacked&globals=direction:rtl)

[Base UI Toast](https://base-ui.com/react/components/toast) · [Radix Toast](https://www.radix-ui.com/primitives/docs/components/toast)
