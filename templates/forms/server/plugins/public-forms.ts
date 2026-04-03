import { defineEventHandler } from "h3";
import { renderPublicForm } from "../lib/public-form-ssr.js";

/**
 * Nitro plugin that registers the SSR handler for public form pages.
 * Runs as a plugin so it intercepts /f/* before Vite's dev middleware.
 */
export default (nitroApp: any) => {
  nitroApp.h3App.use(
    "/f",
    defineEventHandler((event) => renderPublicForm(event)),
  );
};
