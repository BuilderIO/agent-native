import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  layout("routes/shell.tsx", [
    index("routes/home.tsx"),
    route("journeys", "routes/journeys.tsx"),
    route("journeys/:id", "routes/journey-canvas.tsx"),
    route("journeys/:id/report", "routes/journey-report.tsx"),
    route("emails", "routes/emails.tsx"),
    route("emails/:id", "routes/email-editor.tsx"),
    route("audiences", "routes/audiences.tsx"),
    route("audiences/:id", "routes/audience-builder.tsx"),
    route("contacts", "routes/contacts.tsx"),
    route("contacts/:id", "routes/contact-detail.tsx"),
    route("accounts", "routes/accounts.tsx"),
    route("tokens", "routes/tokens.tsx"),
    route("conversions", "routes/conversions.tsx"),
    route("connections", "routes/connections.tsx"),
    route("settings", "routes/settings.tsx"),
    route("*", "routes/not-found.tsx"),
  ]),
] satisfies RouteConfig;
