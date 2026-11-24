SegmentedControl keeps a few mutually exclusive settings visible in one track. A view selector can switch the same collection between list and grid without taking space for a popup.

SegmentedControlItem values are strings. The selected segment stays selected if activated again. A named group and labels for icon-only items make the options understandable to keyboard and screen-reader users.

```tsx
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@agent-native/toolkit/ui/base-ui/segmented-control";

<SegmentedControl aria-label="View style" defaultValue="list">
  <SegmentedControlItem value="list">List</SegmentedControlItem>
  <SegmentedControlItem value="grid">Grid</SegmentedControlItem>
</SegmentedControl>;
```

[Radix Themes design reference](https://www.radix-ui.com/themes/docs/components/segmented-control)
