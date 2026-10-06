export interface AuthMarketingPresentation {
  headline: string;
  description: string;
}

export const AUTH_MARKETING_PRESENTATION: Record<
  string,
  AuthMarketingPresentation
> = {
  analytics: {
    headline: "Ask it. See it.\nMake better decisions from here.",
    description: "Live data, agent-built dashboards, and answers in one place.",
  },
  assets: {
    headline: "Make it. Refine it.\nKeep your brand in the loop.",
    description: "On-brand assets and references, organized by your agent.",
  },
  brain: {
    headline: "Remember it. Find it.\nKeep your company moving.",
    description: "Reviewed knowledge for every team and every agent.",
  },
  calendar: {
    headline: "Plan it. Book it.\nLet your agent handle the details.",
    description: "Scheduling that keeps up with the way you work.",
  },
  chat: {
    headline: "Start here.\nLet your agent take it further.",
    description: "A chat-first workspace for actions and workflows.",
  },
  clips: {
    headline: "Show it. Say it.\nLet your agent take it from here.",
    description: "Screen recordings built for people and agents.",
  },
  content: {
    headline: "Write it. Shape it.\nLet your agent keep it organized.",
    description: "Local documents, custom blocks, and shared context.",
  },
  crm: {
    headline: "Know your customers.\nMove the work forward.",
    description: "A CRM your team and agent can work from together.",
  },
  design: {
    headline: "Imagine it. Make it.\nLet your agent bring it to life.",
    description: "Interactive, responsive designs from a description.",
  },
  dispatch: {
    headline: "Route it. Run it.\nKeep every agent in sync.",
    description: "Secrets, messages, and delegated work in one place.",
  },
  factory: {
    headline: "Build it. Ship it.\nKeep the gates in your hands.",
    description: "Agent work with reviewable feedback and durable control.",
  },
  forms: {
    headline: "Ask once. Ship it.\nLet your agent build the flow.",
    description: "Forms that publish, collect, and explain themselves.",
  },
  mail: {
    headline: "Read it. Write it.\nLet your agent take it from here.",
    description: "An inbox that drafts, sorts, and follows up with you.",
  },
  plan: {
    headline: "Think it through.\nMake the work visible.",
    description: "Visual plans and reviews for coding-agent work.",
  },
  slides: {
    headline: "Say it. Show it.\nLet your agent build the story.",
    description: "Presentations that grow with your ideas.",
  },
  tasks: {
    headline: "Capture it. Finish it.\nLet your agent handle the list.",
    description: "Personal tasks that stay in the order you set.",
  },
};
