import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

export default defineConfig({
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      // shiki only runs in AssistantChat's useEffect — keep it out of the
      // CF Pages Functions bundle (25 MiB limit).
      ssrStubs: ["shiki"],
    }),
  ],
  optimizeDeps: {
    include: [
      "@hookform/resolvers",
      "@radix-ui/react-aspect-ratio",
      "date-fns",
      "embla-carousel-react",
      "input-otp",
      "nanoid",
      "react-day-picker",
      "react-resizable-panels",
      "recharts",
      "vaul",
    ],
  },
});
