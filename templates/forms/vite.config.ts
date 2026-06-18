import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig({
  plugins: [reactRouter()],
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
  // shiki only runs in AssistantChat's useEffect — keep it out of the
  // CF Pages Functions bundle (25 MiB limit).
  ssrStubs: ["shiki"],
});
