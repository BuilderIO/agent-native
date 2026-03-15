import serverless from "serverless-http";
import { createAppServer } from "../../server/index.js";

export const handler = serverless(createAppServer());
