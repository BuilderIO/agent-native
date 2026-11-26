Scroll Area keeps a bounded region scrollable with styled overlay scrollbars. Use it for a list or panel that must scroll independently of the page.

Give the region a height or width constraint on the scrolling axis. Select horizontal, vertical or both scrollbars to match the content. For a very long collection, window the rows separately. A scroll viewport alone still mounts every child.

```tsx
import { ScrollArea } from "@agent-native/toolkit/ui/base-ui/scroll-area";

function ProjectActivity({
  entries,
}: {
  entries: { id: string; title: string }[];
}) {
  return (
    <ScrollArea scrollbars="vertical" style={{ maxBlockSize: "12rem" }}>
      <ul aria-label="Project activity">
        {entries.map((entry) => (
          <li key={entry.id}>{entry.title}</li>
        ))}
      </ul>
    </ScrollArea>
  );
}
```

[Base UI · Scroll Area](https://base-ui.com/react/components/scroll-area)
