import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("./routes/_index.tsx"),
  route("search", "./routes/search.tsx"),
  route("knowledge", "./routes/knowledge.tsx"),
  route("review", "./routes/review.tsx"),
  route("sources", "./routes/sources.tsx"),
  route("ops", "./routes/ops.tsx"),
  route("settings", "./routes/settings.tsx"),
  route("extensions", "./routes/extensions.tsx", [
    index("./routes/extensions._index.tsx"),
    route(":id", "./routes/extensions.$id.tsx"),
    route(":id/:slug", "./routes/extensions.$id.$slug.tsx"),
  ]),
] satisfies RouteConfig;
