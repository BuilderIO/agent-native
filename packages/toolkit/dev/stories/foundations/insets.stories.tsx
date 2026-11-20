import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconArrowUpRight,
  IconBold,
  IconCode,
  IconHome,
  IconPencil,
  IconPlus,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import * as React from "react";
import { expect } from "storybook/test";

import { Badge } from "../../../src/ui/base-ui/badge.js";
import {
  Button,
  ButtonLink,
  IconButton,
} from "../../../src/ui/base-ui/button.js";
import { Input, InputSlot } from "../../../src/ui/base-ui/input.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../src/ui/base-ui/menu.js";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "../../../src/ui/base-ui/navigation-menu.js";
import {
  NumberField,
  NumberFieldScrubArea,
} from "../../../src/ui/base-ui/number-field.js";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../../../src/ui/base-ui/segmented-control.js";
import {
  Select,
  SelectTrigger,
  SelectValue,
} from "../../../src/ui/base-ui/select.js";
import { TabNav, TabNavLink } from "../../../src/ui/base-ui/tab-nav.js";
import { Tabs, TabsList, TabsTab } from "../../../src/ui/base-ui/tabs.js";
import { ToggleGroup } from "../../../src/ui/base-ui/toggle-group.js";
import { Toggle } from "../../../src/ui/base-ui/toggle.js";
import { Toolbar, ToolbarButton } from "../../../src/ui/base-ui/toolbar.js";
import { measureAllInsets } from "../../foundations/insets.js";

const SIZES = ["1", "2", "3", "4"] as const;
const ITEMS = [{ value: "todo", label: "To do" }];

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-1">
      <span className="w-32 shrink-0 type-caption text-fg-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Probes() {
  return (
    <div className="flex flex-col">
      <Row label="Button">
        {SIZES.map((size) => (
          <React.Fragment key={size}>
            <Button size={size} data-inset-probe={`button ${size} leading`}>
              <IconPlus aria-hidden /> New
            </Button>
            <Button size={size} data-inset-probe={`button ${size} trailing`}>
              Open <IconArrowUpRight aria-hidden />
            </Button>
            <Button size={size} data-inset-probe={`button ${size} text`}>
              Save
            </Button>
          </React.Fragment>
        ))}
      </Row>
      <Row label="Icon Button">
        {SIZES.map((size) => (
          <IconButton
            key={size}
            size={size}
            aria-label="Close"
            data-inset-probe={`icon-button ${size}`}
          >
            <IconX aria-hidden />
          </IconButton>
        ))}
      </Row>
      <Row label="Button Link">
        {SIZES.map((size) => (
          <ButtonLink
            key={size}
            size={size}
            href="#docs"
            data-inset-probe={`button-link ${size} leading`}
          >
            <IconCode aria-hidden /> Docs
          </ButtonLink>
        ))}
      </Row>
      <Row label="Toggle">
        {SIZES.map((size) => (
          <React.Fragment key={size}>
            <Toggle size={size} data-inset-probe={`toggle ${size} leading`}>
              <IconBold aria-hidden /> Bold
            </Toggle>
            <Toggle
              size={size}
              aria-label="Bold"
              data-inset-probe={`toggle ${size} glyph`}
            >
              <IconBold aria-hidden />
            </Toggle>
          </React.Fragment>
        ))}
      </Row>
      <Row label="Toggle Group">
        {SIZES.map((size) => (
          <ToggleGroup key={size} size={size} aria-label="Format">
            <Toggle
              value="bold"
              data-inset-probe={`toggle-group ${size} leading`}
            >
              <IconBold aria-hidden /> Bold
            </Toggle>
          </ToggleGroup>
        ))}
      </Row>
      <Row label="Badge">
        {(["1", "2", "3"] as const).map((size) => (
          <React.Fragment key={size}>
            <Badge size={size} data-inset-probe={`badge ${size} leading`}>
              <IconCode aria-hidden /> Code
            </Badge>
            <Badge size={size} data-inset-probe={`badge ${size} text`}>
              Beta
            </Badge>
          </React.Fragment>
        ))}
      </Row>
      <Row label="Input">
        {SIZES.map((size) => (
          <React.Fragment key={size}>
            <Input
              size={size}
              aria-label="Search"
              placeholder="Search"
              className="w-40"
              data-inset-probe={`input ${size} leading`}
            >
              <InputSlot>
                <IconSearch aria-hidden />
              </InputSlot>
            </Input>
            <Input
              size={size}
              aria-label="Name"
              defaultValue="Ada"
              className="w-40"
              data-inset-probe={`input ${size} text`}
            />
          </React.Fragment>
        ))}
      </Row>
      <Row label="Number Field">
        {SIZES.map((size) => (
          <NumberField
            key={size}
            size={size}
            defaultValue={12}
            className="w-28"
            data-inset-probe={`number-field ${size}`}
          >
            <NumberFieldScrubArea>Width</NumberFieldScrubArea>
          </NumberField>
        ))}
      </Row>
      <Row label="Select">
        {SIZES.map((size) => (
          <Select key={size} size={size} items={ITEMS} defaultValue="todo">
            <SelectTrigger
              aria-label="Status"
              className="w-fit"
              data-inset-probe={`select ${size}`}
            >
              <SelectValue />
            </SelectTrigger>
          </Select>
        ))}
      </Row>
      <Row label="Segmented Control">
        {(["2", "3", "4"] as const).map((size) => (
          <SegmentedControl
            key={size}
            size={size}
            aria-label="View"
            defaultValue="code"
          >
            <SegmentedControlItem
              value="code"
              data-inset-probe={`segmented-control ${size} leading`}
            >
              <IconCode aria-hidden /> Code
            </SegmentedControlItem>
          </SegmentedControl>
        ))}
      </Row>
      <Row label="Tabs">
        {(["3", "4"] as const).map((size) => (
          <Tabs key={size} defaultValue="code">
            <TabsList size={size} aria-label="View">
              <TabsTab value="code" data-inset-probe={`tabs ${size} leading`}>
                <IconCode aria-hidden /> Code
              </TabsTab>
            </TabsList>
          </Tabs>
        ))}
      </Row>
      <Row label="Tab Nav">
        {(["3", "4"] as const).map((size) => (
          <TabNav key={size} size={size} aria-label={`Project, size ${size}`}>
            <TabNavLink
              href="#code"
              data-inset-probe={`tab-nav ${size} leading`}
            >
              <IconCode aria-hidden /> Code
            </TabNavLink>
          </TabNav>
        ))}
      </Row>
      <Row label="Navigation Menu">
        <NavigationMenu
          orientation="vertical"
          aria-label="App"
          className="w-48"
        >
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink
                href="#home"
                leading={<IconHome aria-hidden />}
                data-inset-probe="navigation-menu leading"
                data-inset-end="free"
              >
                Home
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </Row>
      <Row label="Menu">
        {(["2", "3"] as const).map((size) => (
          <DropdownMenu key={size} open modal={false}>
            <DropdownMenuTrigger render={<Button size={size} />}>
              Menu {size}
            </DropdownMenuTrigger>
            <DropdownMenuContent size={size} align="start" className="w-48">
              <DropdownMenuItem
                leading={<IconPencil aria-hidden />}
                data-inset-probe={`menu ${size} leading`}
                data-inset-end="free"
              >
                Rename
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      </Row>
      <Row label="Toolbar">
        {(["2", "3", "4"] as const).map((size) => (
          <Toolbar key={size} size={size} aria-label="Format">
            <ToolbarButton data-inset-probe={`toolbar ${size} leading`}>
              <IconPlus aria-hidden /> Insert
            </ToolbarButton>
          </Toolbar>
        ))}
      </Row>
    </div>
  );
}

const meta = {
  title: "Foundations/Control insets",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Every part that sets a glyph at an edge, at every size it has. A glyph at
 * an edge sits (height - glyph) / 2 from that edge and from its text, and text
 * at an edge sits the control's text inset from it.
 */
export const AllParts: Story = {
  name: "Control insets",
  render: () => <Probes />,
  play: async ({ canvasElement }) => {
    const document = canvasElement.ownerDocument;
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished),
    );
    await expect(measureAllInsets(document)).toEqual([]);
  },
};
