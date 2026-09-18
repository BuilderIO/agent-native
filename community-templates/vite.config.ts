import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appSlugs = [
  "agent-advisor",
  "account-tiering",
  "call-follow-up-drafter",
  "win-loss-memo",
  "churn-early-warning",
  "account-expert",
  "demo-clip-library",
  "outbound-in-your-voice",
  "linkedin-signal-watch",
  "linkedin-icp-prospect-tracker",
];

const page = (path: string) => new URL(path, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: Object.fromEntries([
        ["catalog", page("./index.html")],
        ...appSlugs.map((slug) => [slug, page(`./apps/${slug}/index.html`)]),
      ]),
    },
  },
});
