Use navigation links for destinations people can bookmark, open in another tab or revisit with Back. `NavigationMenu` brings those links together in a named navigation landmark. Use a vertical menu for a sidebar and a horizontal menu for top-level destinations.

Place each link in a `NavigationMenuItem` within `NavigationMenuList`. Give each link an `href` and derive its `active` value from the current route. The active link exposes the current page to assistive technology. Choose distinct landmark labels when a screen has several navigation regions.

A link accepts `leading` and `trailing` content for icons and counts. Keep its text label present when a sidebar collapses to an icon rail, as in the App Shell story.

```tsx
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
} from "@agent-native/toolkit/ui/base-ui/navigation-menu";

export function WorkspaceNav({ pathname }: { pathname: string }) {
  return (
    <NavigationMenu orientation="vertical" aria-label="Workspace">
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuLink href="/files" active={pathname === "/files"}>
            Files
          </NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="/library" active={pathname === "/library"}>
            Library
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}
```

[Compare active links and navigation orientations](?path=/story/components-navigation-menu--states)

[Base UI Navigation Menu](https://base-ui.com/react/components/navigation-menu) · [Radix Navigation Menu](https://www.radix-ui.com/primitives/docs/components/navigation-menu)
