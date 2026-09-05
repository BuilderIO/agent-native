import { createCoreRoutesPlugin } from "@agent-native/core/server";

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  envKeys: [
    {
      key: "FORMS_DATABASE_URL",
      label: "Forms Database URL",
      required: false,
    },
    {
      key: "FORMS_DATABASE_URL_UNPOOLED",
      label: "Forms Unpooled Database URL",
      required: false,
    },
    { key: "DATABASE_URL", label: "Database URL", required: false },
    {
      key: "DATABASE_URL_UNPOOLED",
      label: "Unpooled Database URL",
      required: false,
    },
    {
      key: "NETLIFY_DATABASE_URL",
      label: "Netlify Database URL",
      required: false,
    },
    {
      key: "NETLIFY_DATABASE_URL_UNPOOLED",
      label: "Netlify Unpooled Database URL",
      required: false,
    },
    {
      key: "TURNSTILE_SECRET_KEY",
      label: "Turnstile Secret Key",
      required: false,
    },
    {
      key: "VITE_TURNSTILE_SITE_KEY",
      label: "Turnstile Site Key",
      required: false,
    },
    {
      key: "AGENT_NATIVE_COMMUNITY_APP_PUBLISHING_ORG_ID",
      label: "Community app publishing organization ID",
      required: false,
    },
  ],
});
