import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/core/client/agentkit-chat";
import { ASSETS_VARIATION_GRID_RENDERER } from "@shared/action-ui";

import { VariationGridWidget } from "@/components/generation/VariationGridWidget";

registerActionChatRenderer({
  id: "assets.variation-grid",
  renderer: ASSETS_VARIATION_GRID_RENDERER,
  Component: (props: ToolRendererProps) => <VariationGridWidget {...props} />,
});
