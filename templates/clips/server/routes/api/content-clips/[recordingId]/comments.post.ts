// guard:allow-api-route — Content calls this server to server with a document-scoped A2A token, which no action route accepts.
import { defineEventHandler } from "h3";

import { handleContentClipCommentWrite } from "../../../../lib/content-clip-peer.js";

export default defineEventHandler(handleContentClipCommentWrite);
