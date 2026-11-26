import type { Meta, StoryObj } from "@storybook/react-vite";
import status from "virtual:migration-status";

import { MigrationStatusPage } from "../migration-status/MigrationStatus.js";

const meta = {
  title: "Migration status",
  parameters: { layout: "fullscreen", screenshot: false },
  tags: ["!autodocs", "!manifest"],
} satisfies Meta;

export default meta;

/** Which apps get each component from the design system, scanned from source. */
export const Apps: StoryObj = {
  name: "Migration status",
  render: () => <MigrationStatusPage status={status} />,
};
