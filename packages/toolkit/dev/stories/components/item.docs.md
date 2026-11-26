An Item arranges a title, supporting content and optional actions in one row. Use it for settings and resource lists whose rows share a structure.

Keep a row with secondary actions noninteractive so each action receives focus independently. Add `ItemMedia` for a leading visual and `ItemDescription` only when there is additional information. Give repeated row actions names that identify their target.

```tsx
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
} from "@agent-native/toolkit/ui/base-ui/item";

<Item>
  <ItemContent>
    <ItemTitle>Delivery preferences</ItemTitle>
  </ItemContent>
  <ItemActions>
    <a href="/settings/delivery">Edit preferences</a>
  </ItemActions>
</Item>;
```

[Base UI · Composition](https://base-ui.com/react/handbook/composition)
