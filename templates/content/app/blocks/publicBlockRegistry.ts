import { BlockRegistry } from "@agent-native/core/blocks/server";

import { analyticsChartBlock } from "@/components/editor/analytics-chart/AnalyticsChartBlock";
import { clipEmbedBlock } from "@/components/editor/clip-embed/ClipEmbedBlock";
import { designScreenBlock } from "@/components/editor/design-screen/DesignScreenBlock";
import { linkCardBlock } from "@/components/editor/link-card/LinkCardBlock";

/**
 * Blocks a public page renders for a signed-out reader. Only blocks whose
 * reads work without a session belong here; the rest keep their fallback.
 */
export const publicContentBlockRegistry = new BlockRegistry();

publicContentBlockRegistry.register(clipEmbedBlock);
publicContentBlockRegistry.register(analyticsChartBlock);
publicContentBlockRegistry.register(linkCardBlock);
publicContentBlockRegistry.register(designScreenBlock);
