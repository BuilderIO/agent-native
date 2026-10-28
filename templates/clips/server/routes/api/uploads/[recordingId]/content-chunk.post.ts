// guard:allow-api-route - a document's uploads are a ticketed byte transport from the paired Content's pages, not a CRUD API.
import { defineEventHandler } from "h3";

import { handleContentClipChunk } from "../../../../lib/content-clip-uploads.js";

export default defineEventHandler(handleContentClipChunk);
