import { registerFileUploadProvider } from "@agent-native/core/file-upload";
import { runScript } from "@agent-native/core/scripts";

import { s3FileUploadProvider } from "../server/lib/s3-upload-provider.js";

// The provider is registered from a Nitro plugin, which a CLI run never
// mounts. Claiming the slot here is what makes this template's own storage
// configuration — not the framework's stricter one — serve `pnpm action`.
registerFileUploadProvider(s3FileUploadProvider);

void runScript();
