import { menuPopupProps, propAttributes } from "@agent-native/design-system";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconArchive,
  IconChevronDown,
  IconFolder,
  IconHome,
  IconMessageCircle,
  IconSchool,
  IconSearch,
  IconSelector,
  IconStar,
  IconTemplate,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";

import { AgentNativeIcon } from "../../../src/app/shared/AgentNativeIcon.js";
import {
  AppShell,
  AppShellAgent,
  AppShellCanvas,
  SidebarToggle,
} from "../../../src/ui/base-ui/app-shell.js";
import { Avatar, AvatarFallback } from "../../../src/ui/base-ui/avatar.js";
import { Badge } from "../../../src/ui/base-ui/badge.js";
import { IconButton } from "../../../src/ui/base-ui/button.js";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../../../src/ui/base-ui/collapsible.js";
import {
  IconOnlyTooltip,
  useIconOnly,
} from "../../../src/ui/base-ui/icon-only.js";
import { Input, InputSlot } from "../../../src/ui/base-ui/input.js";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../../../src/ui/base-ui/item.js";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "../../../src/ui/base-ui/navigation-menu.js";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderTitle,
} from "../../../src/ui/base-ui/page-header.js";
import { Separator } from "../../../src/ui/base-ui/separator.js";
import {
  Sidebar,
  SidebarBrand,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "../../../src/ui/base-ui/sidebar.js";
import { Toolbar, ToolbarButton } from "../../../src/ui/base-ui/toolbar.js";
import guide from "./sidebar.docs.md?raw";

const meta = {
  title: "Patterns/Sidebar",
  component: Sidebar,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

function Search() {
  const iconOnly = useIconOnly();
  return iconOnly ? (
    <IconOnlyTooltip
      trigger={
        <IconButton
          variant="soft"
          color="gray"
          size="md"
          aria-label="Search all"
        >
          <IconSearch aria-hidden />
        </IconButton>
      }
    >
      Search all
    </IconOnlyTooltip>
  ) : (
    <Input
      aria-label="Search all"
      placeholder="Search all"
      size="md"
      variant="soft"
      color="gray"
    >
      <InputSlot>
        <IconSearch aria-hidden />
      </InputSlot>
      <InputSlot side="right">⌘K</InputSlot>
    </Input>
  );
}

function Library() {
  const iconOnly = useIconOnly();
  const link = (
    <NavigationMenuLink leading={<IconFolder />} trailing="33" href="#library">
      Library
    </NavigationMenuLink>
  );
  if (iconOnly) return <NavigationMenuItem>{link}</NavigationMenuItem>;
  return (
    <NavigationMenuItem>
      <Collapsible defaultOpen>
        {link}
        <CollapsibleTrigger
          render={
            <IconButton
              variant="ghost"
              color="gray"
              size="sm"
              aria-label="Show folders"
            />
          }
        >
          <IconChevronDown className="collapsible-chevron" aria-hidden />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink href="#team">Team</NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink href="#drafts">Drafts</NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </CollapsiblePanel>
      </Collapsible>
    </NavigationMenuItem>
  );
}

function Account() {
  const iconOnly = useIconOnly();
  const avatar = (
    <Avatar color="gray">
      <AvatarFallback>A</AvatarFallback>
    </Avatar>
  );
  const trigger = iconOnly ? (
    <IconOnlyTooltip
      trigger={
        <BaseMenu.Trigger
          render={
            <IconButton
              variant="ghost"
              color="gray"
              size="md"
              aria-label="Ada Lovelace"
            />
          }
        >
          {avatar}
        </BaseMenu.Trigger>
      }
    >
      Ada Lovelace
    </IconOnlyTooltip>
  ) : (
    <BaseMenu.Trigger render={<Item render={<button type="button" />} />}>
      <ItemMedia>{avatar}</ItemMedia>
      <ItemContent>
        <ItemTitle>Ada Lovelace</ItemTitle>
        <ItemDescription>Acme</ItemDescription>
      </ItemContent>
      <ItemActions>
        <IconSelector aria-hidden />
      </ItemActions>
    </BaseMenu.Trigger>
  );
  return (
    <BaseMenu.Root>
      {trigger}
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          className="menu-positioner"
          side="top"
          align="start"
          sideOffset={4}
        >
          <BaseMenu.Popup
            className="menu-popup"
            {...propAttributes(menuPopupProps, {})}
          >
            <BaseMenu.Item className="menu-item">Settings</BaseMenu.Item>
            <BaseMenu.Item className="menu-item">Sign out</BaseMenu.Item>
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

function Frame({ collapsed }: { collapsed?: boolean }) {
  return (
    <div style={{ height: 680 }}>
      <AppShell defaultSidebarCollapsed={collapsed}>
        <Sidebar aria-label="App name">
          <SidebarHeader>
            <SidebarBrand
              href="#home"
              logo={<AgentNativeIcon />}
              badge={<Badge variant="solid">BETA</Badge>}
            >
              App name
            </SidebarBrand>
          </SidebarHeader>
          <SidebarContent>
            <Search />
            <NavigationMenu orientation="vertical" aria-label="App name">
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuLink
                    leading={<IconHome />}
                    active
                    href="#home"
                  >
                    Home
                  </NavigationMenuLink>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <NavigationMenuLink
                    leading={<IconSchool />}
                    trailing={
                      <Badge color="info" dot>
                        New
                      </Badge>
                    }
                    href="#learn"
                  >
                    Learn
                  </NavigationMenuLink>
                </NavigationMenuItem>
              </NavigationMenuList>
              <Separator />
              <NavigationMenuList>
                <Library />
                <NavigationMenuItem>
                  <NavigationMenuLink
                    leading={<IconTemplate />}
                    href="#templates"
                  >
                    Templates
                  </NavigationMenuLink>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <NavigationMenuLink
                    leading={<IconUsers />}
                    trailing="3"
                    href="#shared"
                  >
                    Shared with me
                  </NavigationMenuLink>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <NavigationMenuLink
                    leading={<IconTrash />}
                    trailing="1"
                    href="#trash"
                  >
                    Trash
                  </NavigationMenuLink>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </SidebarContent>
          <SidebarContent>
            <NavigationMenu orientation="vertical" aria-label="Help">
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuLink
                    leading={<IconMessageCircle />}
                    render={<button type="button" />}
                  >
                    Send feedback
                  </NavigationMenuLink>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </SidebarContent>
          <SidebarFooter>
            <Account />
            <SidebarToggle aria-label="Sidebar" size="md" />
          </SidebarFooter>
        </Sidebar>
        <AppShellCanvas>
          <PageHeader>
            <SidebarToggle aria-label="Menu" mobileOnly />
            <PageHeaderTitle>Home</PageHeaderTitle>
            <PageHeaderActions>
              <Toolbar aria-label="Page actions">
                <ToolbarButton aria-label="Archive">
                  <IconArchive />
                </ToolbarButton>
                <ToolbarButton aria-label="Star">
                  <IconStar />
                </ToolbarButton>
              </Toolbar>
            </PageHeaderActions>
          </PageHeader>
        </AppShellCanvas>
        <AppShellAgent aria-label="Agent" />
      </AppShell>
    </div>
  );
}

/**
 * The house sidebar, composed from parts: NavigationMenu for places,
 * Collapsible for nested places, Separator, Badge, Input for search, Button
 * for actions and toggles, Menu for the account.
 */
export const Expanded: StoryObj = { render: () => <Frame /> };

/** As an icon rail: each control shows its icon and names itself in a tooltip. */
export const Collapsed: StoryObj = { render: () => <Frame collapsed /> };
