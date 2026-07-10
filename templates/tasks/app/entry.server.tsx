import { ServerRouter } from "react-router";
import {
  createDocumentRequestHandler,
  streamTimeout,
} from "@agent-native/core/server/entry-server";

const handleDocumentRequest = createDocumentRequestHandler(ServerRouter);

export { streamTimeout };
export default handleDocumentRequest;
