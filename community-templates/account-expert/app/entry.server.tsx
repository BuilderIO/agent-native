import {
  createDocumentRequestHandler,
  streamTimeout,
} from "@agent-native/core/server/entry-server";
import { ServerRouter } from "react-router";

const handleDocumentRequest = createDocumentRequestHandler(ServerRouter);

export { streamTimeout };
export default handleDocumentRequest;
