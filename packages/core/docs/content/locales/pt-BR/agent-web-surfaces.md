---
title: "Web de agente público"
description: "Torne as rotas públicas rastreáveis, legíveis, citáveis e opcionalmente chamadas por agentes — robots.txt, llms.txt, espelhos de remarcação, JSON-LD e uma superfície pública MCP."
---

# Web de agente público

A web pública do agente torna as rotas Agent-Native públicas fáceis para os agentes rastrearem, lerem, citarem e ligarem. O objetivo não é tornar públicos todos os endpoints do aplicativo. O objetivo é publicar uma superfície pública limpa para páginas que já são públicas, mantendo dados privados e acesso a ferramentas sob controles explícitos.

O site de documentos é a implementação de referência. Hoje é enviado:

- `/robots.txt` com uma política de rastreador que permite a recuperação, mas não permite o treinamento por padrão.
- `/sitemap.xml` com URLs canônicos absolutos e `lastmod` quando o arquivo de origem o expõe.
- `/llms.txt` e `/llms-full.txt` para descoberta de conteúdo amigável ao agente.
- Espelhos Markdown como `/docs/getting-started.md`.
- Respostas `Accept: text/markdown` para páginas de documentos públicos após uma compilação de produção.
- JSON-LD para organização base, site e metadados de página.
- Uma auditoria CLI (`npx @agent-native/core@latest audit-agent-web`) que verifica todos os itens acima.

A configuração de `publicMcp: true` também expõe o actions ativado como um endpoint MCP público, permitindo que agentes externos liguem para eles diretamente (consulte [MCP Protocol](/docs/mcp-protocol)).

```an-diagram title="O que uma rota pública publica" summary="Uma rota pública se transforma em representações amigáveis ​​aos agentes. A leitura da rota é separada da chamada de ferramentas – o acesso à ferramenta permanece opcional."
{
  "html": "<div class=\"diagram-web\"><div class=\"diagram-box\" data-rough>Rota pública<br><small class=\"diagram-muted\">derived from route access settings</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">robots.txt</span><span class=\"diagram-pill\">sitemap.xml</span><span class=\"diagram-pill\">llms.txt</span><span class=\"diagram-pill\">.md mirror</span><span class=\"diagram-pill\">JSON-LD</span><span class=\"diagram-pill\">text/markdown</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col gate\"><span class=\"diagram-pill warn\">Ferramentas continuam privadas</span><small class=\"diagram-muted\">publicMcp + publicAgent.expose required</small></div></div>",
  "css": ".diagram-web{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-web .diagram-arrow{font-size:22px;line-height:1}.diagram-web .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.diagram-web .gate{display:flex;flex-direction:column;gap:4px;align-items:flex-start}"
}
```

## Configuração {#config}

Adicione `agentWeb` na configuração do aplicativo de espaço de trabalho existente (no `package.json` do seu aplicativo na chave `agent-native` — ou equivalentemente `workspace.agentWeb`, `agentWeb` ou `root.agentWeb`). A lista de rotas públicas ainda é derivada das configurações de acesso à rota do aplicativo; `agentWeb` controla como essa superfície pública é representada para os agentes.

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

Para a maioria dos aplicativos, deixe os padrões como estão. Se um aplicativo tiver alguma rota pública, `discoverable` será ativado por padrão. A política padrão do rastreador é "detectável, não treinável": pesquisa, recuperação acionada pelo usuário, agentes de codificação e agentes de navegação autônomos são permitidos; rastreadores de treinamento não são permitidos.

## Fonte da verdade da rota {#route-source}

A descoberta na Web do agente segue o modelo de acesso por rota:

- Aplicativos públicos expõem todas as rotas, exceto `protectedPaths`.
- Aplicativos internos expõem apenas `publicPaths`.
- As páginas de compartilhamento público e de formulário podem ser lidas pelos agentes.
- Dados privados enviados, painéis autenticados e estado do usuário/organização nunca são incluídos apenas porque uma página próxima é pública.

Isso mantém os aplicativos mistos naturais. Um aplicativo de formulários pode expor uma página de formulário pública e manter os envios privados. Um aplicativo de conteúdo pode expor postagens publicadas e manter o editor privado. Um site de documentos pode expor tudo, exceto ferramentas administrativas.

## Páginas públicas não são ferramentas públicas {#public-tools}

O acesso à página pública e o acesso à ferramenta pública são separados. Uma rota pública significa apenas que os agentes podem ler essa rota como HTML, Markdown, entradas de mapa do site, entradas de llms e dados estruturados.

```an-callout
{
  "tone": "warning",
  "body": "**A public page is not a public tool.** Making a route crawlable never exposes an action. Tool access requires an explicit `publicAgent.expose` opt-in on the action *and* `publicMcp: true` on the app."
}
```

Para expor uma ação por meio de um protocolo de agente público, a ação deve aceitar:

```an-annotated-code title="Optando por uma ação segura na superfície pública"
{
  "filename": "actions/search-docs.ts",
  "language": "ts",
  "code": "export default defineAction({\n  description: \"Pesquisar published docs\",\n  readOnly: true,\n  publicAgent: {\n    expose: true,\n    readOnly: true,\n    requiresAuth: false,\n    isConsequential: false,\n    title: \"Pesquisar published docs\",\n  },\n  run: async (args) => {\n    // ...\n  },\n});",
  "annotations": [
    { "lines": "4", "label": "Aceitação explícita", "note": "Without `publicAgent.expose === true`, the action never appears on any public agent surface — no matter how public its routes are." },
    { "lines": "5-7", "label": "Autodescrever segurança", "note": "Marque-o como somente leitura, declare se ele precisa de autenticação e sinalize se é consequencial. MCP público exclui ações consequential/write, a menos que a política as permita explicitamente." }
  ]
}
```

`agentWeb.publicMcp` permanece `false` por padrão. Quando MCP público estiver habilitado, o servidor deverá expor apenas actions com `publicAgent.expose === true` e ainda deverá excluir actions consequente ou de gravação, a menos que a ação e a política de autenticação permitam explicitamente.

## Arquivos em tempo de compilação {#build-time}

Os utilitários de estrutura em `@agent-native/core/agent-web` geram os arquivos comuns a partir de uma lista de páginas:

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
      markdown: "# Documentos\n\nComece aqui.\n",
      markdownPath: "/docs/getting-started.md",
      lastmod: new Date(),
    },
  ],
});
```

Os aplicativos Vite podem usar `createAgentWebVitePlugin` de `@agent-native/core/vite` para gravar esses arquivos em `public`, `dist`, `dist/client`, `dist/server/public` ou `build/client` durante compilações de produção.

## Auditar um site {#audit}

Use a auditoria CLI em um site implantado ou em um servidor de produção local:

```bash
npx @agent-native/core@latest audit-agent-web --url https://www.agent-native.com
```

A auditoria verifica:

- SSR HTML visível.
- URLs canônicos.
- JSON-LD.
- Política `robots.txt` e mapa do site absoluto URL.
- Entradas absolutas no mapa do site.
- `/llms.txt` e `/llms-full.txt`.
- Espelhos Markdown.
- `Accept: text/markdown`.
- Nenhum bloqueio 401/403 acidental para agentes comuns de recuperação de agentes.

A auditoria sai diferente de zero se uma superfície pública obrigatória estiver faltando.

## O que vem a seguir

- [**Actions**](/docs/actions) — como incluir actions no protocolo de agente público
- [**MCP Protocol**](/docs/mcp-protocol) — a superfície MCP que `publicMcp: true` permite
- [**Deployment**](/docs/deployment) — onde esses arquivos estáticos são gravados durante as compilações
