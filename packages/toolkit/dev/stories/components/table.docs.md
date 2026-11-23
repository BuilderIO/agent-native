A Table presents comparable records in rows with consistently named columns. Use it when readers need to scan down a column or compare values across records.

Use column and row header cells to preserve relationships for assistive technology. Put links, sorting buttons and row actions in individual cells. Right-align comparable numbers and keep units consistent within a column.

```tsx
import {
  Table,
  TableHeader,
  TableRow,
  TableColumnHeaderCell,
  TableBody,
  TableCell,
} from "@agent-native/toolkit/ui/base-ui/table";

<Table aria-label="Recent runs">
  <TableHeader>
    <TableRow>
      <TableColumnHeaderCell>Run</TableColumnHeaderCell>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Weekly summary</TableCell>
    </TableRow>
  </TableBody>
</Table>;
```

[Radix Themes · Table](https://www.radix-ui.com/themes/docs/components/table)
