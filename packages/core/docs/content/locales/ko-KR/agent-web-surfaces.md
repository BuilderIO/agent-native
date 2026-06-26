---
title: "공무원 웹"
description: "공개 경로를 에이전트(robots.txt, llms.txt, 마크다운 미러, JSON-LD 및 공개 MCP 표면)가 크롤링, 읽기, 인용 및 선택적으로 호출할 수 있도록 만듭니다."
---

# 공무원 웹

공개 에이전트 웹을 사용하면 에이전트가 공개 Agent-Native 경로를 쉽게 크롤링하고, 읽고, 인용하고, 호출할 수 있습니다. 목표는 모든 앱 엔드포인트를 공개하는 것이 아닙니다. 목표는 이미 공개된 페이지에 대해 깨끗한 공개 표면을 게시하는 동시에 개인 데이터 및 도구 액세스를 명시적인 제어로 유지하는 것입니다.

문서 사이트는 참조 구현입니다. 오늘 배송됩니다:

- 검색을 허용하지만 기본적으로 학습을 허용하지 않는 크롤러 정책이 있는 `/robots.txt`.
- 소스 파일이 노출될 때 절대 표준 URL 및 `lastmod`가 포함된 `/sitemap.xml`.
- 상담원 친화적인 콘텐츠 검색을 위한 `/llms.txt` 및 `/llms-full.txt`.
- `/docs/getting-started.md`와 같은 Markdown 미러.
- 프로덕션 빌드 후 공개 문서 페이지에 대한 `Accept: text/markdown` 응답.
- 기본 조직, 웹사이트 및 페이지 메타데이터용 JSON-LD
- 위의 사항을 모두 확인하는 감사 CLI(`npx @agent-native/core@latest audit-agent-web`)

`publicMcp: true`를 설정하면 선택한 actions가 공개 MCP 엔드포인트로 추가로 노출되어 외부 에이전트가 직접 호출할 수 있습니다([MCP Protocol](/docs/mcp-protocol) 참조).

```an-diagram title="공개 경로가 게시하는 내용" summary="공개 경로는 상담원 친화적인 표현으로 전개됩니다. 경로 읽기는 통화 도구와 별개입니다. 도구 액세스는 선택적으로 유지됩니다."
{
  "html": "<div class=\"diagram-web\"><div class=\"diagram-box\" data-rough>공개 라우트<br><small class=\"diagram-muted\">derived from route access settings</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">robots.txt</span><span class=\"diagram-pill\">sitemap.xml</span><span class=\"diagram-pill\">llms.txt</span><span class=\"diagram-pill\">.md mirror</span><span class=\"diagram-pill\">JSON-LD</span><span class=\"diagram-pill\">text/markdown</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col gate\"><span class=\"diagram-pill warn\">도구는 비공개 유지</span><small class=\"diagram-muted\">publicMcp + publicAgent.expose required</small></div></div>",
  "css": ".diagram-web{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-web .diagram-arrow{font-size:22px;line-height:1}.diagram-web .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.diagram-web .gate{display:flex;flex-direction:column;gap:4px;align-items:flex-start}"
}
```

## 구성 {#config}

기존 작업 공간 앱 구성 아래에 `agentWeb`를 추가합니다(앱의 `agent-native` 키 아래 `package.json` 또는 이에 상응하는 `workspace.agentWeb`, `agentWeb` 또는 `root.agentWeb`). 공개 경로 목록은 여전히 ​​앱의 경로 액세스 설정에서 파생됩니다. `agentWeb`는 공개 화면이 상담원에게 표시되는 방식을 제어합니다.

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin/*"],
      "agentWeb": {
        "discoverable": true,
        "markdownTwins": true,
        "llmsTxt": true,
        "jsonLd": true,
        "publicAgentCard": true,
        "publicMcp": false,
        "crawlerPolicy": "discoverable-no-training",
        "crawlers": {
          "training": "disallow",
          "search": "allow",
          "userTriggered": "allow",
          "codingAgents": "allow",
          "autonomousAgents": "allow"
        }
      }
    }
  }
}
```

대부분의 앱에서는 기본값을 그대로 둡니다. 앱에 공개 경로가 있는 경우 `discoverable`가 기본값으로 설정됩니다. 기본 크롤러 정책은 "검색 가능, 훈련 불가능"입니다. 검색, 사용자 트리거 검색, 코딩 에이전트 및 자동 브라우징 에이전트가 허용됩니다. 훈련 크롤러는 허용되지 않습니다.

## 정보 소스 경로 {#route-source}

에이전트 웹 검색은 경로 액세스 모델을 따릅니다.

- 공개 앱은 `protectedPaths`를 제외한 모든 경로를 노출합니다.
- 내부 앱은 `publicPaths`만 노출합니다.
- 공개 공유 및 양식 페이지는 상담원이 읽을 수 있습니다.
- 제출된 비공개 데이터, 인증된 대시보드, 사용자/조직 상태는 단지 근처 페이지가 공개라는 이유만으로 포함되지 않습니다.

이렇게 하면 혼합 앱이 자연스럽게 유지됩니다. 양식 앱은 공개 양식 페이지를 노출하고 제출 내용을 비공개로 유지할 수 있습니다. 콘텐츠 앱은 게시된 게시물을 노출하고 편집자를 비공개로 유지할 수 있습니다. 문서 사이트는 관리 도구를 제외한 모든 것을 노출할 수 있습니다.

## 공개 페이지는 공개 도구가 아닙니다 {#public-tools}

공개 페이지 액세스와 공개 도구 액세스는 별개입니다. 경로가 공개된다는 것은 에이전트가 해당 경로를 HTML, Markdown, 사이트맵 항목, llms 항목 및 구조화된 데이터로 읽을 수 있다는 의미입니다.

```an-callout
{
  "tone": "warning",
  "body": "**A public page is not a public tool.** Making a route crawlable never exposes an action. Tool access requires an explicit `publicAgent.expose` opt-in on the action *and* `publicMcp: true` on the app."
}
```

공개 에이전트 프로토콜을 통해 작업을 노출하려면 작업이 옵트인되어야 합니다.

```an-annotated-code title="공개적으로 하나의 안전한 조치 선택"
{
  "filename": "actions/search-docs.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"검색 published docs\",\n  readOnly: true,\n  publicAgent: {\n    expose: true,\n    readOnly: true,\n    requiresAuth: false,\n    isConsequential: false,\n    title: \"검색 published docs\",\n  },\n  run: async (args) => {\n    // ...\n  },\n});",
  "annotations": [
    { "lines": "4", "label": "명시적 동의", "note": "Without `publicAgent.expose === true`, the action never appears on any public agent surface — no matter how public its routes are." },
    { "lines": "5-7", "label": "자체 설명 안전", "note": "읽기 전용으로 표시하고, 인증이 필요한지 선언하고, 결과적인지 플래그를 지정합니다. 공개 MCP는 정책이 명시적으로 허용하지 않는 한 consequential/write 작업을 제외합니다." }
  ]
}
```

`agentWeb.publicMcp`는 기본적으로 `false`를 유지합니다. 공개 MCP가 활성화되면 서버는 `publicAgent.expose === true`와 함께 actions만 노출해야 하며 작업 및 인증 정책에서 명시적으로 허용하지 않는 한 결과적 제외 또는 actions를 작성해야 합니다.

## 빌드타임 파일 {#build-time}

`@agent-native/core/agent-web`의 프레임워크 유틸리티는 하나의 페이지 목록에서 공통 파일을 생성합니다.

```ts
import {
  buildAgentWebStaticFiles,
  normalizeAgentWebConfig,
} from "@agent-native/core/agent-web";

const config = normalizeAgentWebConfig(
  { crawlerPolicy: "discoverable-no-training" },
  { hasPublicRoutes: true },
);

const files = buildAgentWebStaticFiles({
  siteName: "My Agent-Native App",
  siteUrl: "https://example.com",
  description: "Public docs for my app.",
  config,
  pages: [
    {
      path: "/docs",
      title: "Docs",
      description: "Start here.",
      markdown: "# 문서\n\n여기서 시작하세요.\n",
      markdownPath: "/docs/getting-started.md",
      lastmod: new Date(),
    },
  ],
});
```

Vite 앱은 프로덕션 빌드 중에 `@agent-native/core/vite`의 `createAgentWebVitePlugin`를 사용하여 해당 파일을 `public`, `dist`, `dist/client`, `dist/server/public` 또는 `build/client`에 쓸 수 있습니다.

## 사이트 감사 {#audit}

배포된 사이트 또는 로컬 프로덕션 서버에 대해 CLI 감사를 사용하십시오.

```bash
npx @agent-native/core@latest audit-agent-web --url https://www.agent-native.com
```

감사에서는 다음 사항을 확인합니다:

- SSR-보이는 HTML.
- 표준 URL.
- JSON-LD.
- `robots.txt` 정책 및 절대 사이트맵 URL.
- 절대 사이트맵 항목.
- `/llms.txt` 및 `/llms-full.txt`.
- Markdown 거울.
- `Accept: text/markdown`.
- 일반 에이전트 검색 사용자 에이전트에 대해 실수로 401/403 블록이 발생하지 않습니다.

필요한 공개 표면이 누락된 경우 감사는 0이 아닌 값으로 종료됩니다.

## 다음 단계

- [**Actions**](/docs/actions) — 공공 에이전트 프로토콜에 actions를 선택하는 방법
- [**MCP Protocol**](/docs/mcp-protocol) — `publicMcp: true`가 활성화하는 MCP 표면
- [**Deployment**](/docs/deployment) — 빌드 중에 이러한 정적 파일이 작성되는 위치
