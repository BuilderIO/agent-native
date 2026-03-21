import { defineEventHandler } from "h3";
export default defineEventHandler(() => ({
  message: process.env.PING_MESSAGE ?? "ping",
}));
