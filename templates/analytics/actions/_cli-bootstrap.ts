import { registerFileUploadProvider } from "@agent-native/core/file-upload";

import { s3FileUploadProvider } from "../server/lib/s3-upload-provider.js";

registerFileUploadProvider(s3FileUploadProvider);
