import { defineEventHandler } from "h3";

import { handlePrivateVaultBrokerRoute } from "../../../../../lib/private-vault-broker-routes.js";

export default defineEventHandler((event) =>
  handlePrivateVaultBrokerRoute(event, "request"),
);
