import type { Meta, StoryObj } from "@storybook/react-vite";
import status from "virtual:migration-status";

import { MigrationStatusPage } from "../migration-status/MigrationStatus.js";

const meta = {
  title: "Migration status",
  // A scan of every app's source, which moves with app code the story tests
  // do not watch, so main's screenshot is stale on most pull requests.
  parameters: { layout: "fullscreen", screenshot: false },
  tags: ["!autodocs", "!manifest"],
} satisfies Meta;

export default meta;

/** Which apps get each component from the design system, scanned from source. */
export const Apps: StoryObj = {
  name: "Migration status",
  render: () => <MigrationStatusPage status={status} />,
};
