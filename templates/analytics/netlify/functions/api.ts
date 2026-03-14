import serverless from "serverless-http";

import { createAppServer } from "../../server";

export const handler = serverless(createAppServer());
