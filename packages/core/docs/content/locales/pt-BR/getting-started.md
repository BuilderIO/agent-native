---
title: "Primeiros passos"
description: "Crie um aplicativo de agente, entenda as instruções skills e actions e observe o agente chamar sua primeira ação."
---

# Primeiros passos

Os aplicativos Agent-Native fornecem a um agente de IA e ao seu UI os mesmos actions, dados e
estado. Um agente básico é feito de instruções que o orientam, skills que ensinam
comportamento repetível e actions que permite que ele faça um trabalho real.

**Quer um aplicativo completo para começar?** Clone um de nossos modelos avançados —
[Chat](/docs/template-chat), [Mail](/docs/template-mail),
[Calendar](/docs/template-calendar), [Content](/docs/template-content),
[Analytics](/docs/template-analytics) e [many more](/docs/cloneable-saas) —
cada um deles é um aplicativo completo que você personaliza.

Construir do zero? A única escolha inicial é se você deseja um UI —
tudo depois (escrever instruções, adicionar skills, definir actions, executar
o agente) é o mesmo de qualquer maneira.

```an-file-tree title="A basic Agent-Native agent"
{
  "entries": [
    { "path": "AGENTS.md", "note": "always-on instructions: purpose, rules, tone, and the map of what the agent can do" },
    { "path": ".agents/skills/customer-research/SKILL.md", "note": "a reusable playbook the agent loads when the task matches" },
    { "path": "actions/summarize-week.ts", "note": "typed code the agent, UI, CLI, HTTP, MCP, A2A, jobs, and webhooks can run" }
  ]
}
```

Isso é verdade quer você comece com um bate-papo UI, um agente sem cabeça ou um aplicativo completo.
O UI muda a superfície; instruções, skills e actions dão ao agente seu
orientação e comportamento.

## 1. Crie seu aplicativo

Você precisará de [Node.js 22+](https://nodejs.org) e [pnpm](https://pnpm.io).

Execute `create` sem sinalizadores e ele perguntará como você deseja iniciar (um modelo completo,
Chat ou Headless) antes de mais nada:

```bash
npx @agent-native/core@latest create my-app
```

Ou passe um sinalizador para ignorar o prompt:

**Quer um UI?** Comece pelo modelo de bate-papo. Você recebe um agente ativo mais um
bate-papo personalizável UI, e cada ação que você adiciona aparece nele automaticamente:

```bash
npx @agent-native/core@latest create my-app --template chat
```

**Apenas o primitivo sem cabeça?** Comece sem cabeça — o mesmo actions e agente
loop, sem shell UI:

```bash
npx @agent-native/core@latest create my-agent --headless
```

Em seguida, instale a partir da pasta que você criou:

```bash
cd my-agent # or my-app if you chose the Chat template
pnpm install
```

De agora em diante, os dois são idênticos.

## 2. Adicione uma ação

Uma ação é uma operação que seu agente — e seu UI — podem chamar. Ambos os andaimes
envie com este exemplo:

```an-annotated-code title="Sua primeira action"
{
  "filename": "actions/hello.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Diga olá a partir do agente local.\",\n  schema: z.object({\n    name: z.string().default(\"world\"),\n  }),\n  http: { method: \"GET\" },\n  readOnly: true,\n  run: async ({ name }) => {\n    return { message: `Hello, ${name}!` };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "Descrição da ferramenta", "note": "O agente lê `description` para decidir quando chamar isto como ferramenta." },
    { "lines": "6-8", "label": "Contrato tipado", "note": "Um `schema` zod valida entradas de todas as superfícies: agente, UI, HTTP, MCP e A2A." },
    { "lines": "9", "label": "HTTP verb", "note": "Opt this action into an auto-mounted HTTP endpoint." },
    { "lines": "10", "label": "Read-only", "note": "`readOnly` marks the action as safe to call without approval and cacheable for queries." },
    { "lines": "11-13", "label": "One implementation", "note": "The `run` body is the single source of truth that every surface executes." }
  ]
}
```

Substitua `hello` pela primeira operação real em seu domínio. Você define uma vez;
todas as superfícies captam isso.

Use `AGENTS.md` para orientação que deve ser aplicada a cada turno. Use uma habilidade quando o
o agente precisa de um fluxo de trabalho ou procedimento de domínio reutilizável. Use uma ação quando o
o agente precisa de uma maneira digitada e testável para ler dados, gravar dados, chamar um API ou
realizar uma aprovação.

## 3. Execute-o

Chame a ação diretamente:

```bash
pnpm action hello --name Steve
```

Ou peça ao agente para ligar para você:

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

Se você começou a partir do modelo Chat, execute o aplicativo e use o mesmo agente no
navegador — ele já pode chamar todas as ações que você definir:

```bash
pnpm dev
```

Essa ação agora pode ser acessada no chat UI, CLI, HTTP, MCP, A2A,
trabalhos agendados e webhooks. Defina uma vez, ligue de qualquer lugar.

```an-diagram title="One action, every surface" summary="A single defineAction file fans out to every consumer with no extra wiring."
{
  "html": "<div class=\"diagram-fan\"><div class=\"diagram-box\" data-rough>defineAction</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-surfaces\"><span class=\"diagram-pill\">Chat UI</span><span class=\"diagram-pill\">CLI</span><span class=\"diagram-pill\">HTTP</span><span class=\"diagram-pill\">MCP</span><span class=\"diagram-pill\">A2A</span><span class=\"diagram-pill\">Scheduled jobs</span><span class=\"diagram-pill\">Webhooks</span></div></div>",
  "css": ".diagram-fan{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fan .diagram-surfaces{display:flex;flex-wrap:wrap;gap:8px;max-width:420px}.diagram-fan .diagram-arrow{font-size:22px;line-height:1}"
}
```

## O estado está integrado

Sem cabeça não significa sem estado. Actions, sessões, estado do aplicativo, threads,
histórico de execução e credenciais residem em SQL. Localmente é SQLite em
`data/app.db`; na produção você define `DATABASE_URL`. Veja
[Deployment](/docs/deployment).

```an-callout
{
  "tone": "info",
  "body": "**Headless is still a real app.** The app-agent loop persists sessions, threads, runs, settings, and credentials in SQL — it is not a stateless prompt. You can add a UI later without touching your actions or state."
}
```

## Personalizar o UI

Se você começou a partir do modelo Chat, o UI é seu para editar. O bate-papo em si
é uma pequena rota construída no componente `<AgentChatSurface>`:

```tsx
// app/routes/_index.tsx
import { AgentChatSurface } from "@agent-native/core/client";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-full" />;
}
```

- **`app/routes/_index.tsx`** — a página de bate-papo. Altere as sugestões, vazio
  estado e layout.
- **`app/root.tsx`** — o shell do aplicativo. Adicione suas próprias rotas e telas ao redor
  agente.
- Coloque o agente em qualquer tela com `<AgentSidebar>`, trabalhe manualmente nele a partir de um
  botão com `sendToAgentChat()` ou execute uma ação diretamente com
  `useActionMutation()`.

Veja [Drop-in Agent](/docs/drop-in-agent) para o conjunto completo de componentes e
[Native Chat UI](/docs/native-chat-ui) para renderizar resultados de ações como tabelas,
gráficos e cartões digitados em vez de texto simples.

**Começou sem cabeça e quer um UI mais tarde?** O modelo de bate-papo _é_ a rampa de acesso do UI —
sua camada `app/` (Roteador React + Vite) é exatamente o que o andaime sem cabeça
deixa de fora. A atitude mais limpa é iniciar (ou reformular) a partir do bate-papo
modelo; seu estado `actions/`, agente e SQL permanecem inalterados. Veja
[Agent Surfaces](/docs/agent-surfaces) para cada superfície intermediária.

## Estrutura do projeto

```text
my-app/
  actions/         # Agent-callable actions
  app/             # React frontend (UI templates only; omitted when headless)
  server/          # Nitro API server (routes, plugins)
  AGENTS.md        # Always-on agent instructions
  .agents/         # Skills the agent can pull in when relevant
  data/app.db      # Local SQLite state when DATABASE_URL is unset
```

## Para onde ir a seguir

- **[Key Concepts](/docs/key-concepts)** — a arquitetura principal: SQL, actions,
  sincronização e reconhecimento de contexto.
- **[Actions](/docs/actions)** — a ação completa API: esquemas, HTTP, autenticação e
  aprovação.
- **[Agent Surfaces](/docs/agent-surfaces)** — headless, chat, sidecar incorporado,
  e aplicativo completo.
- **[Drop-in Agent](/docs/drop-in-agent)** — adicione o bate-papo do agente a qualquer aplicativo React.
- **[Deployment](/docs/deployment)** — coloque seu aplicativo em seu próprio domínio.
- **[FAQ](/docs/faq)** — dúvidas sobre configuração e produto.
