Use `DesignFilePanel` as the document navigator when a file contains pages, layers and related resources. Each tab has a stable value, a label and a panel. Pass the current `tab`, `onTabChange` and an accessible `tabsLabel`. The `brand`, `headerActions` and `footer` slots accept application content.

Build the File tab with `DesignFileContents`. Supply `pages` with the current page ID and change handler, and `tree` with the current page’s layer records, the selected IDs and edit callbacks. The contents component measures the space available to the tree. `layerTools` and `searchResults` let the application supply filtering and results.

When Pages and Layers are expanded, the page list scrolls independently. The Pages section can occupy up to half the panel height. Set `--design-file-panel-pages-max-height` on the panel to change that limit.

For layer results, pass `current="true"` to `DesignFilePageList`. Selecting a match should expand its ancestors so clearing the query reveals the selected row.

Keep the active tab, current page and layer selection distinct. When switching pages, update the selection to a valid target on that page. If a header action closes the panel, give focus to the visible opener and return focus to the panel control when reopened. Navigate and Edit exercises that round trip.

```tsx
import { DesignFilePanel } from "@agent-native/toolkit/ui/base-ui/design-file-panel";

<DesignFilePanel
  title={fileName}
  tabsLabel="Document panels"
  tab={tab}
  onTabChange={setTab}
  tabs={[
    { value: "file", label: "File", panel: fileContents },
    { value: "library", label: "Library", panel: library },
  ]}
/>;
```

See [Layer Tree](?path=/docs/patterns-layer-tree--docs) for editing, navigating and reordering layers.
