A Data List pairs field names and values for one record. Use it for metadata such as owner, status and run ID. A table is useful when readers compare those same fields across records.

Keep each label and its value together in one item. Values can contain a link or badge. Choose a vertical orientation when long labels leave too little space for values.

```tsx
import {
  DataList,
  DataListItem,
  DataListLabel,
  DataListValue,
} from "@agent-native/toolkit/ui/base-ui/data-list";

<DataList>
  <DataListItem>
    <DataListLabel>Owner</DataListLabel>
    <DataListValue>Ada Lovelace</DataListValue>
  </DataListItem>
</DataList>;
```

[Radix Themes · Data List](https://www.radix-ui.com/themes/docs/components/data-list)
