export function buildDesktopLocalAppPrompt(input: {
  userPrompt: string;
  targetPath: string;
  port: number;
}): string {
  return [
    input.userPrompt.trim(),
    "",
    "---",
    `Desktop: build this as a new standalone Agent-Native app in ${input.targetPath}, the current folder. It runs on this computer and is not part of a hosted workspace.`,
    "",
    "Desktop has already created the app from the starter (chat) template and installed its dependencies. Do not scaffold another app or reinstall.",
    "Start by reading AGENTS.md and .agents/skills/build-an-app/SKILL.md in this folder, then build the requested app.",
    "",
    "Rules:",
    `- Desktop runs the dev server on http://localhost:${input.port} and shows the app next to this chat, reloading as you edit. Do not start, stop or restart a dev server, and do not open a browser.`,
    "- Work only inside this folder.",
    "- The starter is scaffolding only. Make `/` the requested app's real home screen, with its own name, layout and navigation. Remove visible Chat, Starter, Blank app or New app UI.",
    '- Set "displayName" and a one-sentence "description" in package.json for the real app. Desktop shows that name in its sidebar.',
    "- Data lives in the bundled local database (PGlite). Do not add DATABASE_URL, a hosted database, sign-up, or any account.",
    "- When the app needs outside data, use a free public API that needs no key (for weather: Open-Meteo, https://api.open-meteo.com, with its free geocoding API for place search). Never require an API key the user has not given you.",
    "- Avoid new npm dependencies; the template already has React, React Router, Tailwind, shadcn/ui components, @tabler/icons-react and fetch. If you truly need one and can run a shell, run pnpm add in this folder.",
    "- Do not edit .env files to change authentication. Desktop already runs the app signed in as the local user.",
    "- If the request names a well-known product as a style reference, match the general look and feel with your own layout, copy and artwork. Do not copy its logo, icons, images or name.",
    "- If you can run a shell, run pnpm typecheck when done and fix any errors.",
    "- Finish with two or three sentences on what you built.",
    "",
    "Later messages in this chat are changes to this same app; edit it in place.",
  ].join("\n");
}
