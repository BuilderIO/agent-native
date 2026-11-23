Use tabs when one area of a screen can show several related views. In an inspector, users can move between Design and Inspect without changing documents or routes.

Name the `TabsList` and give each `TabsTab` a stable value matching exactly one `TabsPanel`. The list supplies arrow-key navigation. Base UI connects the tab and its panel for assistive technology. Use `defaultValue` for the first view, or `value` and `onValueChange` when another part of the editor can change the view.

Choose `SegmentedTabsList` with `SegmentedTabsTab` for the compact raised treatment used by the File panel. It keeps the same root, values and panels. Set `orientation="vertical"` on the root when the tab list runs down the side.

```tsx
import {
  Tabs,
  TabsList,
  TabsTab,
  TabsPanel,
} from "@agent-native/toolkit/ui/base-ui/tabs";

export function FrameViews() {
  return (
    <Tabs defaultValue="design">
      <TabsList aria-label="Frame view">
        <TabsTab value="design">Design</TabsTab>
        <TabsTab value="inspect">Inspect</TabsTab>
      </TabsList>
      <TabsPanel value="design">Layout and appearance controls</TabsPanel>
      <TabsPanel value="inspect">
        Frame measurements and generated CSS
      </TabsPanel>
    </Tabs>
  );
}
```

[Explore disabled and vertical tabs](?path=/story/components-tabs--states)

[Base UI Tabs](https://base-ui.com/react/components/tabs) · [Radix Tabs](https://www.radix-ui.com/themes/docs/components/tabs)

For a horizontal tool panel, set `variant="framed"` on `Tabs`. The 24px tab sits in a 32px row. Its upper corners use the compact control radius (`--radius-2`), and the smaller return into the panel uses `--radius-1`. Both follow the theme’s radius scale. The rail scrolls on narrow panels. Set `--tabs-frame-surface` and `--tabs-frame-rail` on the root to match the surrounding workspace. Vertical tabs keep their side indicator.
