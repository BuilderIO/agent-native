// @agent-native/pinpoint — List/filter annotations script
// MIT License

import { parseArgs } from "@agent-native/core/scripts";
import { FileStore } from "../storage/file-store.js";
import type { PinStatus } from "../types/index.js";

export default async function (args: string[]) {
  const { pageUrl, status } = parseArgs(args) as {
    pageUrl?: string;
    status?: PinStatus;
  };

  const store = new FileStore();
  const pins = await store.list({ pageUrl, status });

  if (pins.length === 0) {
    console.log("No annotations found.");
    return;
  }

  console.log(`Found ${pins.length} annotation(s):\n`);

  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    console.log(`${i + 1}. [${pin.status.state}] ${pin.element.selector}`);
    console.log(`   Comment: ${pin.comment}`);
    if (pin.author) console.log(`   Author: ${pin.author}`);
    if (pin.framework?.sourceFile)
      console.log(`   Source: ${pin.framework.sourceFile}`);
    console.log(`   Page: ${pin.pageUrl}`);
    console.log(`   ID: ${pin.id}`);
    console.log();
  }
}
