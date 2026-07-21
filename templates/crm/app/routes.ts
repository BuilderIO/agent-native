import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("./routes/_index.tsx"),
  route("accounts", "./routes/accounts.tsx"),
  route("people", "./routes/people.tsx"),
  route("opportunities", "./routes/opportunities.tsx"),
  route("records/:recordId", "./routes/records.$recordId.tsx"),
  route("tasks", "./routes/tasks.tsx"),
  route("proposals", "./routes/proposals.tsx"),
  route("views", "./routes/views.tsx"),
  route("ask", "./routes/ask.tsx"),
  route("setup", "./routes/setup.tsx"),
  route("settings/*", "./routes/settings.tsx"),
  route("agent", "./routes/agent.tsx"),
] satisfies RouteConfig;
