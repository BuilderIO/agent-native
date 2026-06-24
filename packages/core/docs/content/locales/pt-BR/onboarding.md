---
title: "Integração e chaves API"
description: "Lista de verificação de configuração para configuração inicial — chaves API, OAuth e conexões de provedor"
---

# Integração

Ao abrir pela primeira vez um aplicativo criado na estrutura nativa do agente, você verá um
**Lista de verificação de configuração** na barra lateral do agente. Ele mantém a configuração da primeira execução próxima
para o chat do agente: conecte um mecanismo de IA, opcionalmente aponte o aplicativo para compartilhado
infraestrutura e adicione provedores somente quando precisar deles.

```an-diagram title="The setup checklist" summary="Only Connect an AI engine is required. The panel tracks completion and auto-hides once everything required is done."
{
  "html": "<div class=\"ob\"><div class=\"diagram-card\"><span class=\"diagram-pill warn\">required</span><strong>Connect an AI engine</strong><small class=\"diagram-muted\">Connect Builder (one click) or paste an LLM key</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Database</strong><small class=\"diagram-muted\">set <code>DATABASE_URL</code></small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Authentication</strong><small class=\"diagram-muted\">OAuth / access token</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">optional</span><strong>Email delivery</strong><small class=\"diagram-muted\">Resend / SendGrid</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box ok\">all required done &rarr; panel auto-hides</div></div>",
  "css": ".ob{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ob .diagram-card{display:flex;flex-direction:column;gap:3px;padding:12px 14px}.ob .diagram-arrow{font-size:22px}"
}
```

## Para usuários finais

### O que você verá

- Um painel de **Configuração** acima do chat do agente com uma lista de verificação como "Conectar uma IA
  mecanismo", "Entrega de e-mail", etc.
- Um contador na parte superior (por exemplo, "1 de 4") mostra quantas etapas estão prontas.
- A etapa atual é expandida; as etapas concluídas mostram uma marca verde e permanecem
  legíveis se você abri-los.
- As etapas obrigatórias mostram uma pequena pílula vermelha **obrigatória**. O painel permanece visível
  até que todas as etapas necessárias sejam concluídas.
- Depois que tudo o que for necessário for feito, o painel se ocultará automaticamente.
- O painel inteiro pode ser recolhido com a divisa no canto superior direito ou
  oculto totalmente com **Ocultar configuração** na parte inferior.

### Como concluir cada etapa

As etapas oferecem um ou mais **métodos** — diferentes maneiras de satisfazer o mesmo
requisito. O caminho principal é mostrado primeiro; caminhos secundários são mantidos compactos
por trás de um seletor ou divulgação quando uma etapa tem vários provedores equivalentes.

- **Conecte um serviço (um clique)** — por exemplo, _Conecte Builder_ para o gerenciado
  Portal de IA. Clique no botão, uma janela se abre, você faz login, a janela fecha,
  e a etapa será marcada como concluída. Não há chaves para copiar.
- **Cole uma chave API ou preencha um formulário** — por exemplo, escolha um provedor LLM, banco de dados,
  Provedor OAuth ou provedor de e-mail, cole os valores e clique em **Salvar**.
  Os campos secretos usam uma entrada de senha para que o valor não seja mostrado na tela. Salvo
  os valores vão para seu `.env` local (ou configurações do espaço de trabalho) — consulte
  [Security](/docs/security) para onde moram.
- **Abra um link** — algumas etapas apontam para uma página de login ou documentos. Clique
  **Continue** e finalize o fluxo na nova guia.
- **Pergunte ao agente** — algumas etapas oferecem a opção "Deixe o agente configurar".
  Clique nele e o agente atende no chat, orientando você em qualquer
  configuração externa (criação de credenciais OAuth, etc.).

### As etapas integradas que você normalmente verá

- **Conecte um mecanismo de IA** (obrigatório) — a única etapa obrigatória. Conectar
  Builder para um gateway gerenciado com um clique ou abra a chave do provedor secundário
  selecione e cole sua própria chave LLM.
- **Banco de dados** (opcional) — defina `DATABASE_URL` quando quiser usar um
  Sequência de conexão do banco de dados SQL.
- **Autenticação** (opcional) — contas de e-mail/senha integradas funcionam por
  padrão. Adicione OAuth ou login com token de acesso somente quando desejar esses caminhos.
- **Entrega de e-mail** (opcional) — útil antes da implantação para redefinições de senha,
  convites de equipe e notificações de compartilhamento. Use o provedor que você já usa;
  o desenvolvimento local pode funcionar sem ele.

Os modelos podem adicionar suas próprias etapas acima delas - por exemplo, um modelo CRM pode
adicionar "Conectar Gmail", um modelo de documentos pode adicionar "Escolha um espaço de trabalho padrão". Veja
[Authentication](/docs/authentication) para detalhes de configuração de login.

### Voltando à lista de verificação

Se você clicar em **Ocultar configuração**, o painel desaparecerá dessa sessão do navegador.
As etapas necessárias que ainda não foram concluídas aparecerão novamente no próximo carregamento. Uma vez
tudo o que é necessário é feito, o painel é ocultado automaticamente para sempre — não há nada
falta fazer.

## Para desenvolvedores

Se você estiver criando um modelo, registre as etapas de integração para que elas apareçam
lista de verificação da barra lateral do usuário. A estrutura lida com renderização, conclusão
rastreamento e demissão — basta declarar qual é a etapa e como ela é
satisfeito.

O sistema é **montado automaticamente**. Os modelos não precisam conectar nada para serem obtidos
as quatro etapas integradas (LLM, banco de dados, autenticação, e-mail). Para adicionar aplicativos específicos
etapas (Gmail, Slack, Notion, etc.), chame `registerOnboardingStep()` de um
plug-in do servidor.

### Rotas montadas automaticamente

Todas as rotas estão sob `/_agent-native/onboarding/`:

| Rota                                                | Propósito                              |
| --------------------------------------------------- | -------------------------------------- |
| `GET /_agent-native/onboarding/steps`               | Listar etapas com status de conclusão  |
| `POST /_agent-native/onboarding/steps/:id/complete` | Marcar etapa concluída (substituir)    |
| `POST /_agent-native/onboarding/dismiss`            | Dispensar o banner de integração       |
| `POST /_agent-native/onboarding/reopen`             | Limpar dispensa (reexibir painel)      |
| `GET /_agent-native/onboarding/dismissed`           | Ler dispensa + sinalizador allComplete |

```an-api title="List onboarding steps"
{
  "method": "GET",
  "path": "/_agent-native/onboarding/steps",
  "summary": "List all registered steps with their completion status",
  "description": "Drives the sidebar checklist — returns each step's id, title, methods, required flag, and whether `isComplete` currently passes.",
  "responses": [
    { "status": "200", "description": "Array of steps with completion status for the current user/app." }
  ]
}
```

### Adicionando uma etapa de um modelo

```an-annotated-code title="Registering a custom onboarding step"
{
  "filename": "server/plugins/my-onboarding.ts",
  "language": "ts",
  "code": "import { defineNitroPlugin } from \"@agent-native/core/server\";\nimport { registerOnboardingStep } from \"@agent-native/core/onboarding\";\nimport { listOAuthAccounts } from \"@agent-native/core/oauth-tokens\";\n\nexport default defineNitroPlugin(() => {\n  registerOnboardingStep({\n    id: \"gmail\",\n    order: 100,\n    title: \"Connect Gmail\",\n    description: \"Grant read/send access so the agent can work with email.\",\n    methods: [\n      {\n        id: \"oauth\",\n        kind: \"link\",\n        primary: true,\n        label: \"Sign in with Google\",\n        payload: { url: \"/_agent-native/google/auth-url?scope=mail\", external: false },\n      },\n      {\n        id: \"delegate\",\n        kind: \"agent-task\",\n        label: \"Let the agent set it up\",\n        badge: \"beta\",\n        payload: { prompt: \"Walk me through connecting Gmail. Set env vars as needed.\" },\n      },\n    ],\n    isComplete: async () => {\n      const accounts = await listOAuthAccounts(\"google\");\n      return accounts.length > 0;\n    },\n  });\n});",
  "annotations": [
    { "lines": "5", "label": "Auto-mounted", "note": "Register from a Nitro plugin — the framework handles rendering, completion tracking, and dismissal." },
    { "lines": "7", "label": "Stable id", "note": "Re-registering with the same `id` after defaults load overrides a built-in step." },
    { "lines": "12-19", "label": "Primary method", "note": "`primary: true` marks the big CTA. `kind: \"link\"` sends the user into the OAuth flow." },
    { "lines": "20-26", "label": "Delegate path", "note": "`kind: \"agent-task\"` hands the setup to the agent chat with a prompt." },
    { "lines": "28-31", "label": "Completion check", "note": "`isComplete` runs server-side. OAuth tokens live in the `oauth_tokens` store — check it, not `process.env.GMAIL_REFRESH_TOKEN`." }
  ]
}
```

### Verificando conexões do espaço de trabalho na integração

Ao criar modelos que interagem com serviços externos (como Slack, Google Workspace, GitHub ou HubSpot), verifique se o workspace já se conectou e concedeu a conexão desse provedor ao seu aplicativo. Isso evita que os usuários tenham que duplicar credenciais (como chaves API ou tokens de atualização) em suas variáveis de ambiente locais quando existe uma conexão gerenciada central.

Você pode verificar a disponibilidade da conexão no retorno de chamada `isComplete` usando o catálogo de conexão APIs:

```ts
import { listWorkspaceConnectionProviderCatalogForApp } from "@agent-native/core/workspace-connections";

// Inside registerOnboardingStep:
isComplete: async () => {
  // Check if a managed workspace connection exists and is ready
  const catalog = await listWorkspaceConnectionProviderCatalogForApp({
    appId: "mail",
    templateUse: "mail",
    provider: "gmail",
  });
  const connection = catalog.providers[0];

  if (
    connection?.readiness.status === "ready" &&
    connection.workspaceConnection.grantState === "granted"
  ) {
    return true;
  }

  // Fall back to local environment variable check
  return !!process.env.GMAIL_REFRESH_TOKEN;
};
```

Consulte a documentação do [Workspace Connections](/docs/workspace-connections) para obter a lista completa de métodos de catálogo do provedor de conexão.

### Tipos de métodos

| Gentil             | Carga útil                                            | Usar para                                                    |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------ |
| `link`             | `{ url, external? }`                                  | Enviar o usuário para um fluxo OAuth ou página de documentos |
| `form`             | `{ fields, writeScope? }`                             | Colete variáveis de ambiente (chaves, segredos, URLs)        |
| `builder-cli-auth` | `{ scope: "llm" \| "browser" \| "image-generation" }` | Connect Builder (unlocks shared infra)                       |
| `agent-task`       | `{ prompt }`                                          | Envie uma solicitação ao chat do agente para tratar          |

O sinalizador `primary: true` marca um método como o grande CTA para sua etapa.
Use `badge: "soon"` mais `disabled: true` quando um caminho de configuração estiver visível
antes de estar disponível.

### Etapas integradas

| ID         | Obrigatório | Descrição                                            |
| ---------- | ----------- | ---------------------------------------------------- |
| `llm`      | sim         | Conexão Builder ou chave LLM do provedor             |
| `database` | não         | Banco de dados padrão ou qualquer SQL `DATABASE_URL` |
| `auth`     | não         | Contas integradas, OAuth opcional ou token de acesso |
| `email`    | não         | Reenviar ou SendGrid para e-mail transacional        |

Qualquer um deles pode ser substituído registrando-se novamente com o mesmo `id` após
carregamento padrão.

### Uso do cliente

O painel já está dentro do `<AgentPanel>`. Para criar um layout personalizado:

```tsx
import {
  OnboardingPanel,
  OnboardingBanner,
  useOnboarding,
} from "@agent-native/core/client/onboarding";

function MySidebar() {
  const { allComplete, dismissed, currentStepId } = useOnboarding();
  if (allComplete || dismissed) return <Chat />;
  return (
    <>
      <OnboardingPanel />
      <Chat />
    </>
  );
}
```

Para saber onde os valores das etapas são armazenados e como os segredos são tratados,
veja [Security](/docs/security). Para pontos de contato de mensagens do usuário final (convites,
redefinições de senha) que dependem da etapa **Entrega de e-mail**, consulte
[Messaging](/docs/messaging).
