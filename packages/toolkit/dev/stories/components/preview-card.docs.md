Use a preview card to give a link extra context while a reader explores a page. A linked component name might preview its owner and current version. The link still navigates directly to the full record.

Put a real destination on `PreviewCardTrigger`. Place optional summary content in `PreviewCardPopup`, with `PreviewCardArrow` when an arrow helps connect it to the trigger. Make the link text useful by itself and keep essential information on the destination page, where keyboard, screen-reader and touch users can reach it.

The trigger accepts `delay` to tune opening on hover. Use `defaultOpen` to inspect a specific initial state in a story and `open` with `onOpenChange` when the application owns the preview state.

```tsx
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardPopup,
  PreviewCardArrow,
} from "@agent-native/toolkit/ui/base-ui/preview-card";

export function ComponentLink() {
  return (
    <PreviewCard>
      <PreviewCardTrigger href="/library/navigation">
        Navigation library
      </PreviewCardTrigger>
      <PreviewCardPopup>
        <PreviewCardArrow />
        <strong>Navigation library</strong>
        <p>Menus, toolbars and tabs maintained by the design team.</p>
      </PreviewCardPopup>
    </PreviewCard>
  );
}
```

[Inspect a positioned link preview](?path=/story/components-preview-card--playground)

[Base UI Preview Card](https://base-ui.com/react/components/preview-card) · [Radix Hover Card](https://www.radix-ui.com/themes/docs/components/hover-card)
