import { defineEventHandler } from "h3";

export default defineEventHandler(() => {
  return [
    {
      key: "DATABASE_URL",
      label: "Database URL",
      required: false,
      configured: !!process.env.DATABASE_URL,
    },
    {
      key: "DATABASE_AUTH_TOKEN",
      label: "Database Auth Token",
      required: false,
      configured: !!process.env.DATABASE_AUTH_TOKEN,
    },
  ];
});
