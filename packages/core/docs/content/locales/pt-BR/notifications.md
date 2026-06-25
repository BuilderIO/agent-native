---
title: "Notificações"
description: "Notificações no aplicativo com canais conectáveis — caixa de entrada, webhook ou personalizado"
---

# Notificações

Uma função, muitos destinos. Chame `notify()` a partir de qualquer código do lado do servidor – uma ação, uma automação, um plugin – e o evento chega à caixa de entrada do aplicativo do usuário e se espalha para todos os canais registrados. Vem com um componente UI suspenso que o modelo de host coloca em seu cabeçalho.

As notificações são alertas unidirecionais na caixa de entrada do sino do aplicativo (além da distribuição de webhook). Para _conversar_ com seu agente por Slack/email/Telegram/WhatsApp, consulte [Messaging](/docs/messaging).

```ts
import { notify } from "@agent-native/core/notifications";

await notify(
  { severity: "info", title: "Booking confirmed", body: "Jane at 3pm" },
  { owner: "steve@builder.io" },
);
```

```an-diagram title="Uma chamada, muitos destinos" summary="notify() sempre grava a linha da caixa de entrada com escopo do proprietário, espalha todos os canais registrados em paralelo (melhor esforço) e emite warning.sent no barramento de eventos."
{
  "html": "<div class=\"diagram-notify\"><div class=\"diagram-node\">notify(input, { owner })<br><small class=\"diagram-muted\">any server code &middot; action, automation, plugin</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel fan\" data-rough><div class=\"fan-row\"><span class=\"diagram-pill accent\">inbox</span><div class=\"diagram-box\" data-rough>notifications table &rarr; bell UI<br><small class=\"diagram-muted\">always on &middot; owner-scoped</small></div></div><div class=\"fan-row\"><span class=\"diagram-pill\">webhook</span><div class=\"diagram-box\" data-rough>POST JSON to NOTIFICATIONS_WEBHOOK_URL<br><small class=\"diagram-muted\">best-effort</small></div></div><div class=\"fan-row\"><span class=\"diagram-pill\">custom</span><div class=\"diagram-box\" data-rough>registerNotificationChannel(...)<br><small class=\"diagram-muted\">best-effort &middot; runs in parallel</small></div></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill ok\">notification.sent</span><small class=\"diagram-muted\">event bus &middot; automations can chain</small></div></div>",
  "css": ".diagram-notify{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-notify .fan{display:flex;flex-direction:column;gap:10px;padding:14px}.diagram-notify .fan-row{display:flex;align-items:center;gap:10px}.diagram-notify .diagram-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px}.diagram-notify .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Gravidades {#severities}

| Gravidade  | Usar para                              |
| ---------- | -------------------------------------- |
| `info`     | Confirmações, marcos de progresso, FYI |
| `warning`  | Algo que o usuário deve ver em breve   |
| `critical` | Requer atenção imediata                |

A gravidade orienta o estilo do selo no menu suspenso e é transmitida aos canais para que eles possam diversificar com urgência.

## Canais integrados {#channels}

| Canal     | Entrega                                                 | Requer                                                         |
| --------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| `inbox`   | Persiste na tabela `notifications`; toca a campainha UI | Sempre ligado — parte do primitivo.                            |
| `webhook` | POST JSON para um URL configurado                       | `NOTIFICATIONS_WEBHOOK_URL` env var definida na inicialização. |

O canal webhook resolve referências `${keys.NAME}` em URL e `NOTIFICATIONS_WEBHOOK_AUTH` em relação ao [secrets](/docs/security) ad-hoc do proprietário, de forma que o valor bruto nunca entre no contexto do agente. As listas de permissões URL por chave são aplicadas – a mesma regra que a ferramenta de automações `web-request` usa.

```an-diagram title="Canais e gravidade" summary="a caixa de entrada está sempre ativada; o webhook precisa de um env var; canais personalizados são registrados na inicialização. A severidade impulsiona o estilo do emblema e é transmitida a todos os canais."
{
  "html": "<div class=\"diagram-channels\"><div class=\"diagram-panel col\" data-rough><strong>Channels</strong><div class=\"diagram-box\" data-rough>inbox<br><small class=\"diagram-muted\">always on &mdash; part of the primitive</small></div><div class=\"diagram-box\" data-rough>webhook<br><small class=\"diagram-muted\">needs NOTIFICATIONS_WEBHOOK_URL</small></div><div class=\"diagram-box\" data-rough>custom<br><small class=\"diagram-muted\">registerNotificationChannel()</small></div></div><div class=\"diagram-panel col\" data-rough><strong>A gravidade define o badge</strong><div class=\"sev-row\"><span class=\"diagram-pill\">info</span><span class=\"diagram-muted\">confirmações, FYI</span></div><div class=\"sev-row\"><span class=\"diagram-pill warn\">warning</span><span class=\"diagram-muted\">look at soon</span></div><div class=\"sev-row\"><span class=\"diagram-pill accent\">critical</span><span class=\"diagram-muted\">needs immediate attention</span></div></div></div>",
  "css": ".diagram-channels{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}.diagram-channels .col{display:flex;flex-direction:column;gap:10px;padding:14px;min-width:240px}.diagram-channels .sev-row{display:flex;align-items:center;gap:10px}"
}
```

## API {#api}

### `notify(input, meta)` {#notify}

Entregue uma notificação. Sempre persiste na caixa de entrada, a menos que seja explicitamente excluído; canais registrados adicionais são executados em paralelo, melhor esforço.

```ts
await notify(
  {
    severity: "critical",
    title: "Database offline",
    body: "Primary dropped connections",
    metadata: { runbookUrl: "https://runbooks/db-offline" },
    channels: ["inbox", "webhook"], // optional allowlist; omit to run all
  },
  { owner: "ops@company.com" },
);
```

`meta.owner` é obrigatório — define o escopo da notificação para que apenas o usuário a veja no sino.

### `registerNotificationChannel(channel)` {#register}

Registre um canal personalizado de qualquer plugin de servidor.

```ts
import { registerNotificationChannel } from "@agent-native/core/notifications";

registerNotificationChannel({
  name: "slack-ops",
  async deliver(input, meta) {
    await fetch(process.env.OPS_SLACK_WEBHOOK!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `*${input.severity.toUpperCase()}* — ${input.title}\n${input.body ?? ""}`,
        owner: meta.owner,
      }),
    });
  },
});
```

Os nomes dos canais são exclusivos – o novo registro substitui o canal anterior. `deliver()` é o melhor esforço; lançar registra o erro, mas não bloqueia outros canais ou a linha da caixa de entrada.

### Listagem e leitura {#read}

```ts
import {
  listNotifications,
  countUnread,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "@agent-native/core/notifications";

const rows = await listNotifications("steve@builder.io", {
  unreadOnly: true,
  limit: 50,
});
const unread = await countUnread("steve@builder.io");
await markNotificationRead(rows[0].id, "steve@builder.io");
await markAllNotificationsRead("steve@builder.io");
await deleteNotification(rows[0].id, "steve@builder.io");
```

Cada função tem escopo de proprietário — sem leituras entre usuários, sem gravações entre usuários.

## A interface do NotificationChannel {#channel-interface}

```ts
interface NotificationChannel {
  name: string;
  deliver(
    input: NotificationInput,
    meta: NotificationMeta,
  ): void | Promise<void>;
}

interface NotificationInput {
  severity: "info" | "warning" | "critical";
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  channels?: string[];
}

interface NotificationMeta {
  owner: string;
}
```

## HTTP API {#http}

Montado em `/_agent-native/notifications/*` pelo plugin core-routes. Todas as rotas têm como escopo o e-mail da sessão autenticada.

| Método   | Caminho                                             |
| -------- | --------------------------------------------------- |
| `GET`    | `/_agent-native/notifications?unread=true&limit=50` |
| `GET`    | `/_agent-native/notifications/count`                |
| `POST`   | `/_agent-native/notifications/:id/read`             |
| `POST`   | `/_agent-native/notifications/read-all`             |
| `DELETE` | `/_agent-native/notifications/:id`                  |

```an-api title="Listar notificações" summary="The route behind listNotifications() — scoped to the authenticated session's email."
{
  "method": "GET",
  "path": "/_agent-native/notifications?unread=true&limit=50",
  "summary": "Listar notificações recentes para o usuário atual",
  "auth": "Authenticated session; results are scoped to the session's email.",
  "params": [
    { "name": "unread", "in": "query", "type": "boolean", "required": false, "description": "When true, returns only unread notifications." },
    { "name": "limit", "in": "query", "type": "number", "required": false, "description": "Max rows to return." }
  ],
  "responses": [
    { "status": "200", "description": "Owner-scoped notification rows, newest first." }
  ]
}
```

## Componente UI {#ui}

```tsx
import { NotificationsBell } from "@agent-native/core/client/notifications";

export function HeaderBar() {
  return (
    <header className="flex items-center gap-2">
      {/* … */}
      <NotificationsBell browserNotifications />
    </header>
  );
}
```

Ícone de sino com selo de não lido. Clicar abre uma lista suspensa de notificações recentes. Usa tokens semânticos shadcn e se adapta ao tema claro/escuro do modelo de host.

Passe `browserNotifications` para também disparar pop-ups do sistema `new Notification(...)` para cada novo item não lido - útil quando a guia do usuário está em segundo plano. A lista suspensa exibe um prompt "Ativar" até que o usuário conceda permissão; duplicatas são evitadas por ID por meio do campo Notificação `tag`.

## Ferramentas do agente {#agent-tools}

Uma única ferramenta `manage-notifications` é registrada em cada modelo. O parâmetro `action` seleciona a operação:

| Ação   | Parâmetros                                                                          | Propósito                                                                      |
| ------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `send` | `severity` (obrigatório), `title` (obrigatório), `body`, `metadataJson`, `channels` | Enviar uma notificação para a caixa de entrada do usuário e canais cadastrados |
| `list` | `unreadOnly`, `limit` (máx. 200, padrão 20)                                         | Listar notificações recentes por contexto                                      |

Automações (veja [Automations](/docs/automations)) podem chamar `manage-notifications` com `action=send` em seu corpo — este é o padrão canônico para transformar um evento externo em um alerta visível ao usuário.

## Barramento de eventos {#event-bus}

Cada entrega bem-sucedida emite `notification.sent` no [event bus](/docs/automations#event-bus):

```json
{
  "notificationId": "n-123",
  "severity": "critical",
  "title": "DB offline",
  "body": "Primary dropped connections",
  "deliveredChannels": ["inbox", "webhook"]
}
```

As automações podem encadear isso - por exemplo. _"se uma notificação crítica for disparada, chame também de plantão."_

## Como funciona {#internals}

- **Escopo do proprietário** — cada linha tem uma coluna `owner`; cada consulta é filtrada; cada rota usa o email da sessão autenticada. Os usuários nunca veem as notificações uns dos outros.
- **Integração de pesquisa** — cada mutação chama `recordChange()` para que os modelos que usam [`useDbSync`](/docs/client) sejam invalidados automaticamente sem qualquer conexão extra.
- **Distribuição de melhor esforço** — erros de canal são detectados e registrados; um canal com falha não bloqueia outros ou a gravação da caixa de entrada.
- **Disparar e esquecer** — `notify()` retorna após a conclusão da gravação da caixa de entrada; canais personalizados são executados em segundo plano.

## O que vem a seguir

- [**Automations**](/docs/automations) — o chamador mais comum de `notify()`
- [**Security**](/docs/security) — a substituição `${keys.NAME}` que alimenta o canal webhook
- [**Server plugins**](/docs/server) — onde os canais personalizados são registrados na inicialização
