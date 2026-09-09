type CommentAttributionMessages = {
  aiBadge: string;
  aiAttribution: string;
  aiSourceMcp: string;
  aiSourceAgent: string;
};

export const commentAttributionMessagesByLocale: Record<
  | "en-US"
  | "zh-CN"
  | "zh-TW"
  | "es-ES"
  | "fr-FR"
  | "de-DE"
  | "ja-JP"
  | "ko-KR"
  | "pt-BR"
  | "hi-IN"
  | "ar-SA",
  CommentAttributionMessages
> = {
  "en-US": {
    aiBadge: "AI",
    aiAttribution: "Posted via AI on behalf of {{name}}",
    aiSourceMcp: "MCP",
    aiSourceAgent: "In-app agent",
  },
  "zh-CN": {
    aiBadge: "AI",
    aiAttribution: "由 AI 代表 {{name}} 发布",
    aiSourceMcp: "MCP",
    aiSourceAgent: "应用内智能体",
  },
  "zh-TW": {
    aiBadge: "AI",
    aiAttribution: "由 AI 代表 {{name}} 發佈",
    aiSourceMcp: "MCP",
    aiSourceAgent: "應用程式內代理程式",
  },
  "es-ES": {
    aiBadge: "AI",
    aiAttribution: "Publicado mediante IA en nombre de {{name}}",
    aiSourceMcp: "MCP",
    aiSourceAgent: "Agente en la aplicación",
  },
  "fr-FR": {
    aiBadge: "AI",
    aiAttribution: "Publié via l’IA au nom de {{name}}",
    aiSourceMcp: "MCP",
    aiSourceAgent: "Agent intégré",
  },
  "de-DE": {
    aiBadge: "AI",
    aiAttribution: "Über KI im Namen von {{name}} veröffentlicht",
    aiSourceMcp: "MCP",
    aiSourceAgent: "Agent in der App",
  },
  "ja-JP": {
    aiBadge: "AI",
    aiAttribution: "{{name}} の代理として AI 経由で投稿",
    aiSourceMcp: "MCP",
    aiSourceAgent: "アプリ内エージェント",
  },
  "ko-KR": {
    aiBadge: "AI",
    aiAttribution: "{{name}}님을 대신해 AI를 통해 게시됨",
    aiSourceMcp: "MCP",
    aiSourceAgent: "앱 내 에이전트",
  },
  "pt-BR": {
    aiBadge: "AI",
    aiAttribution: "Publicado via IA em nome de {{name}}",
    aiSourceMcp: "MCP",
    aiSourceAgent: "Agente no app",
  },
  "hi-IN": {
    aiBadge: "AI",
    aiAttribution: "{{name}} की ओर से AI के माध्यम से पोस्ट किया गया",
    aiSourceMcp: "MCP",
    aiSourceAgent: "ऐप में एजेंट",
  },
  "ar-SA": {
    aiBadge: "AI",
    aiAttribution: "نُشر عبر الذكاء الاصطناعي نيابةً عن {{name}}",
    aiSourceMcp: "MCP",
    aiSourceAgent: "وكيل داخل التطبيق",
  },
};
