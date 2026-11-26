import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconArchive, IconStar } from "@tabler/icons-react";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderTitle,
} from "../../../src/ui/base-ui/page-header.js";
import { Toolbar, ToolbarButton } from "../../../src/ui/base-ui/toolbar.js";
import guide from "./page-header.docs.md?raw";

const meta = {
  title: "Patterns/Page Header",
  component: PageHeader,
  parameters: {
    docs: { description: { component: guide } },
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

/** A title, then actions at the end: a toolbar of icon buttons and a primary action. */
export const States: StoryObj = {
  render: () => (
    <PageHeader>
      <PageHeaderTitle>Inbox</PageHeaderTitle>
      <PageHeaderActions>
        <Toolbar aria-label="Inbox actions">
          <ToolbarButton aria-label="Archive">
            <IconArchive />
          </ToolbarButton>
          <ToolbarButton aria-label="Star">
            <IconStar />
          </ToolbarButton>
        </Toolbar>
        <Button size="sm">Compose</Button>
      </PageHeaderActions>
    </PageHeader>
  ),
};
