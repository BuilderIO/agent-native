import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("./routes/_index.tsx"),
  route("search", "./routes/search.tsx"),
  route("knowledge", "./routes/knowledge.tsx"),
  route("review", "./routes/review.tsx"),
  route("sources", "./routes/sources.tsx"),
  route("ops", "./routes/ops.tsx"),
  route("settings", "./routes/settings.tsx"),
] satisfies RouteConfig;
