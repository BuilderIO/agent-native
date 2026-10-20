import { configureClientRouterBasename } from "@agent-native/core/client/api-path";
import { installRouteChunkRecovery } from "@agent-native/core/client/route-chunk-recovery";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { DashboardNameDrafts } from "./pages/adhoc/sql-dashboard/DashboardNameDrafts";

installRouteChunkRecovery();

configureClientRouterBasename();

hydrateRoot(
  document,
  <DashboardNameDrafts>
    <HydratedRouter />
  </DashboardNameDrafts>,
);
