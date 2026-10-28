export const TEMPLATE_SCREENSHOTS = {
  clips: {
    dark: "/app-hero-screenshots/clips-dark.jpg",
    light: "/app-hero-screenshots/clips-light.jpg",
  },
  plan: {
    dark: "/app-hero-screenshots/plan-dark.jpg",
    light: "/app-hero-screenshots/plan-light.jpg",
  },
  design: {
    dark: "/app-hero-screenshots/design-dark.jpg",
    light: "/app-hero-screenshots/design-light.jpg",
  },
  content: {
    dark: "/app-hero-screenshots/content-dark.jpg",
    light: "/app-hero-screenshots/content-light.jpg",
  },
  slides: {
    dark: "/app-hero-screenshots/slides-dark.jpg",
    light: "/app-hero-screenshots/slides-light.jpg",
  },
  analytics: {
    dark: "/app-hero-screenshots/analytics-dark.jpg",
    light: "/app-hero-screenshots/analytics-light.jpg",
  },
  mail: {
    dark: "/app-hero-screenshots/mail-dark.jpg",
    light: "/app-hero-screenshots/mail-light.jpg",
  },
  forms: {
    dark: "/app-hero-screenshots/forms-dark.jpg",
    light: "/app-hero-screenshots/forms-light.jpg",
  },
  assets: {
    dark: "/app-hero-screenshots/assets-dark.jpg",
    light: "/app-hero-screenshots/assets-light.jpg",
  },
  calendar: {
    dark: "/app-hero-screenshots/calendar-dark.jpg",
    light: "/app-hero-screenshots/calendar-light.jpg",
  },
  dispatch: {
    dark: "/app-hero-screenshots/dispatch-dark.jpg",
    light: "/app-hero-screenshots/dispatch-light.jpg",
  },
  chat: {
    dark: "/app-hero-screenshots/chat-dark.jpg",
    light: "/app-hero-screenshots/chat-light.jpg",
  },
} as const;

export function getScreenshotTileScaleX(slug: string) {
  // These hero exports include a 40px outer gutter on each side of the app window.
  return slug === "design" || slug === "slides" ? 15 / 14 : undefined;
}
