Use `Stack` for a column, `Inline` for a row, and `Grid` when items in different rows need to align.

Set `gap` to a spacing step. Use `wrap` on an Inline to let items flow onto a second line. Use `render` to supply a semantic element.

```tsx
import { Grid, Inline, Stack } from "@agent-native/toolkit/ui/base-ui/layout";

<Grid columns="repeat(auto-fit, minmax(min(100%, 12rem), 1fr))" gap={3}>
  <Stack gap={2}>
    <h2>Research workspace</h2>
    <p>Owned by the design team</p>
  </Stack>
  <Inline gap={2} wrap>
    <a href="/projects/research">Open project</a>
    <a href="/projects/research/activity">View activity</a>
  </Inline>
</Grid>;
```

The grid above adds columns as space allows. Below 12rem, its single column shrinks to fit the container. Nested layouts can set their own gap and tracks. Keep children in reading order as the layout reflows.

[Radix Themes · Grid](https://www.radix-ui.com/themes/docs/components/grid)
