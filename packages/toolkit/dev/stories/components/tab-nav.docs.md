Use Tab Nav when a row of tab-shaped links leads to separate routes. Overview, Activity and Settings can each have their own URL, browser history entry and page load. Use the Tabs component when the choices reveal panels inside one page.

Give the `TabNav` landmark a name. Every `TabNavLink` needs a destination. Pass `active` from the router so direct visits and Back navigation keep the underline and current-page announcement in sync. Ordinary anchor behavior supports copying links and opening them in another tab.

For a router that supplies its own link component, compose it through `render` while preserving the anchor element and destination. The Colors and With Icons stories show styling independent of route state.

```tsx
import { TabNav, TabNavLink } from "@agent-native/toolkit/ui/base-ui/tab-nav";

export function ProjectPages({ pathname }: { pathname: string }) {
  return (
    <TabNav aria-label="Project">
      <TabNavLink href="/project" active={pathname === "/project"}>
        Overview
      </TabNavLink>
      <TabNavLink
        href="/project/activity"
        active={pathname === "/project/activity"}
      >
        Activity
      </TabNavLink>
    </TabNav>
  );
}
```

[Navigate using labeled icon links](?path=/story/components-tab-nav--with-icons)

[Radix Tab Nav](https://www.radix-ui.com/themes/docs/components/tab-nav) · [Base UI Navigation Menu](https://base-ui.com/react/components/navigation-menu)
