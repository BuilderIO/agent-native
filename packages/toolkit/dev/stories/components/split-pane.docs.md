Split Pane lets people resize two neighboring regions, such as an outline and a document.

```tsx
import { SplitPane } from "@agent-native/toolkit/ui/base-ui/split-pane";

<SplitPane
  label="Outline width"
  defaultSize={240}
  minSize={120}
  pane={<nav aria-label="Outline">Pages</nav>}
>
  Document
</SplitPane>;
```

Set `defaultSize` for an initial width, or pass `size` and update it on commit to control the pane. Use `minContentSize` to reserve space for the neighboring region. Changing the size limits or supplying a new controlled size during a drag cancels the gesture at the rendered size. A host can echo the current preview without interrupting the drag.

Use `snapToStep` for grid-aligned panels. Pointer and arrow-key resizing use the same `step` (8 px by default). A saved width between grid lines stays in place until resized. Size limits take precedence at either edge.

Set `disabled` to lock the divider while keeping both panes interactive. A drag is canceled when the divider becomes disabled or its window loses focus.

### Keyboard

| Key                         | Action                                 |
| --------------------------- | -------------------------------------- |
| Arrow along the resize axis | Move the divider one step              |
| Shift + Arrow               | Move ten steps                         |
| Home / End                  | Use the smallest or largest size       |
| Enter                       | Collapse or restore a collapsible pane |
| Escape                      | Cancel a drag                          |

Give the separator a label that identifies the pane. Use `separatorRef` to return focus when an external control hides the pane.

[WAI-ARIA Authoring Practices · Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
