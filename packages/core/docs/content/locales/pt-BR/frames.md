---
title: "Quadros"
description: "O quadro de desenvolvimento local, o painel do agente incorporado e o quadro da nuvem: as formas como um agente de IA é executado junto com seu aplicativo."
---

# Quadros

Todo aplicativo nativo do agente é executado com um agente de IA próximo ao aplicativo UI. Um **quadro** é
o wrapper que hospeda ambos: ele mostra seu aplicativo e dá ao agente um local para
converse, execute e (no desenvolvimento) edite o código. Existem três frames, compartilhando um tempo de execução:

- **Painel de agente incorporado** — fornecido em todos os aplicativos do `@agent-native/core`.
  Esta é a barra lateral que seu aplicativo renderiza, em desenvolvimento e em produção.
- **Quadro de desenvolvimento local** — um wrapper fino que carrega seu aplicativo em execução em um iframe
  e adiciona o mesmo painel de agente mais um terminal CLI integrado ao lado dele. Usado
  para desenvolvimento local de modelos neste repositório.
- **Frame cloud Builder.io** — um frame gerenciado e hospedado com colaboração,
  edição visual e execução de agentes paralelos.

O código do seu aplicativo é idêntico, independentemente do quadro que o hospeda. O agente fala
ao seu aplicativo por meio do mesmo actions e estado do aplicativo em todos os casos.

```an-diagram title="Três frames, um tempo de execução" summary="Seu aplicativo e o painel do agente são iguais em todos os frames; apenas o invólucro em torno deles muda."
{
  "html": "<div class=\"diagram-frames\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">Painel incorporado</span><small class=\"diagram-muted\">incluído em todo app · dev + prod</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Frame local de desenvolvimento</span><small class=\"diagram-muted\">app em iframe + painel + terminal CLI</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill\">Frame cloud Builder.io</span><small class=\"diagram-muted\">hospedado: colaboração · edição visual · execuções paralelas</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>Mesmo runtime<br><small class=\"diagram-muted\">seu app · ações · estado da aplicação</small></div></div>",
  "css": ".diagram-frames{display:flex;flex-direction:column;gap:10px;align-items:stretch}.diagram-frames .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.diagram-frames .diagram-arrow{font-size:22px;line-height:1;align-self:center}"
}
```

## Painel de agente incorporado {#embedded-agent}

O painel incorporado é a barra lateral do agente que seu aplicativo renderiza. Ele é enviado com
`@agent-native/core` — não há pacote separado para instalar — e é o mesmo
componente em desenvolvimento e produção.

- Exportado como `AgentPanel` de `@agent-native/core/client`, com um
  variante somente de produção `ProductionAgentPanel`.
- Fornece a superfície completa do Chat / CLI / Workspace, para que a entrada do agente permaneça ativada
  a pilha compartilhada do compositor usada em todos os outros lugares da estrutura.
- Lê `application_state.navigation` a cada turno, então já sabe qual
  visualização em que você está e o que está selecionado. Você não precisa explicar novamente "isso".

### Modos de ferramenta Aplicativo vs Código {#tool-modes}

O painel é executado em um dos dois modos de ferramenta:

- **Modo aplicativo** — o agente possui apenas as ferramentas próprias do seu aplicativo: o actions você
  definido com `defineAction`, além de navegação e contexto. Nenhum sistema de arquivos ou
  acesso ao shell. Isso é o que os usuários finais recebem.
- **Modo de código** — adiciona as ferramentas de codificação compartilhadas (`bash`, `read`, `edit`, `write`)
  e acesso ao banco de dados além das ferramentas do aplicativo, para que o agente possa alterar as configurações do aplicativo
  fonte própria. Solicitações de código são bloqueadas: quando uma mensagem requer código
  (`type: "code"`) e nenhum quadro com capacidade de código estiver conectado, o painel mostra um
  caixa de diálogo explicando que alterações de código precisam de Agent Native Desktop ou Builder;
  quando um quadro é conectado, a solicitação é roteada para ele e para um agente de código
  indicador mostra enquanto funciona (`useSendToAgentChat`). Para o canônico
  lista de ferramentas de codificação e contratos UI compartilhados, consulte
  [Agent-Native Code UI](/docs/code-agents-ui).

```an-diagram title="Controle de solicitação de código" summary="Uma mensagem digitada em código precisa de um quadro compatível com código. Com um conectado, a solicitação é encaminhada para lá; sem ele, o painel explica que as alterações de código precisam de Desktop ou Builder."
{
  "html": "<div class=\"diagram-gate\"><div class=\"diagram-node\" data-rough>message<br><small class=\"diagram-muted\">type: \\\"code\\\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>code-capable frame connected?</div><div class=\"diagram-col\"><div class=\"diagram-pill ok\">yes &rarr; route to frame, show code-agent indicator</div><div class=\"diagram-pill warn\">no &rarr; dialog: needs Desktop or Builder</div></div></div>",
  "css": ".diagram-gate{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-gate .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-gate .diagram-arrow{font-size:22px;line-height:1}.diagram-gate .center{text-align:center}"
}
```

"Modo de código" é a alternância da capacidade do agente — diferente do modo de desenvolvimento do ambiente
(`NODE_ENV`/Vite). O gancho do cliente é `useCodeMode()`. (Veja
[Compatibility notes](#compatibility) para os aliases de retrocompatibilidade.)

No quadro de desenvolvimento local, a engrenagem de configurações alterna entre esses modos. Troca
o modo off Code oculta a barra lateral do próprio frame e mostra o agente no aplicativo do aplicativo
barra lateral dentro do iframe, para que você possa visualizar exatamente o que os usuários finais veem.

## Terminal integrado e comutação CLI {#cli-terminal}

Em desenvolvimento, o painel inclui um terminal incorporado (`AgentTerminal`, também
de `@agent-native/core/client`) apoiado por um servidor PTY. Você pode executar um verdadeiro
codifique CLI ao lado do aplicativo e alterne entre eles; o terminal reinicia
com o CLI selecionado.

Os CLIs suportados vêm do registro CLI principal
(`packages/core/src/terminal/cli-registry.ts`). Somente estes comandos são permitidos
para gerar — o servidor PTY valida o comando solicitado no registro
lista de permissões para evitar injeção:

| CLI           | Comando    | Instalar pacote             |
| ------------- | ---------- | --------------------------- |
| Código Claude | `claude`   | `@anthropic-ai/claude-code` |
| Builder.io    | `builder`  | (integrado)                 |
| Codex         | `codex`    | `@openai/codex`             |
| Gêmeos CLI    | `gemini`   | `@google/gemini-cli`        |
| OpenCode      | `opencode` | `opencode-ai`               |

Se o CLI selecionado não for encontrado em `PATH`, o terminal volta a executá-lo
através de `npx --yes <install-package>@latest` (onde existe um pacote de instalação). O
o comando padrão é `claude`. Alterne CLIs nas configurações do painel do agente a qualquer momento
hora.

## Quadro de nuvem Builder.io {#cloud-frame}

[Builder.io](https://www.builder.io) fornece um quadro gerenciado que hospeda o
mesmo aplicativo e mesmo painel de agente, na nuvem:

- Colaboração em tempo real: vários usuários podem assistir e interagir ao mesmo tempo.
- Edição visual, funções e permissões.
- Execução paralela do agente para iteração mais rápida.
- Bom para uso em equipe, onde todos compartilham um ambiente hospedado.

As solicitações de código do painel incorporado são roteadas para o quadro Builder da mesma maneira
eles roteiam para o quadro de desenvolvimento local, então o comportamento dev-vs-prod acima é
consistente em ambos.

## APIs de tempo de execução {#runtime-apis}

Eles são fornecidos com o `@agent-native/core` e são o que seu aplicativo usa para se comunicar com o
agente, independentemente do frame que o hospeda:

1. **Enviar uma mensagem** — `sendToAgentChat()` envia uma mensagem ao agente. O
   O gancho `useSendToAgentChat()` envolve-o com o gate de solicitação de código descrito
   acima e retorna um elemento `codeRequiredDialog` para renderizar. Veja
   [Drop-in Agent](/docs/drop-in-agent) para uso completo e opções.
2. **Estado de geração** — `useAgentChatGenerating()` rastreia quando o agente está
   em execução, para que o UI possa mostrar o progresso sem consultar o agente diretamente.
3. **Sincronização de pesquisa** — a sincronização baseada em banco de dados mantém os caches UI atualizados quando o agente
   altera os dados ou o estado do aplicativo.
4. **Sistema de ação** — `pnpm action <name>` despacha para o mesmo chamável
   actions que o agente invoca como ferramentas, então tudo o que o agente pode fazer, você pode
   roteiro.

## Executando {#running}

O painel do agente incorporado faz parte de todos os aplicativos. Crie um modelo e pronto
já está lá:

```bash
npx @agent-native/core@latest create my-app --template mail --standalone
cd my-app
pnpm dev
```

O quadro de desenvolvimento local (o pacote `@agent-native/frame` privado no repositório da estrutura) é um pacote de ferramentas interno que não é publicado no npm. Ele carrega o servidor de desenvolvimento do aplicativo ativo em um iframe e monta o painel incorporado ao lado dele, selecionando o aplicativo por meio do parâmetro de consulta `app`. O terminal CLI integrado requer o Agent Native Desktop, que fornece o código local e acesso PTY às necessidades do terminal; sem ele, o painel mostra a superfície de bate-papo e solicita que você abra a área de trabalho para usar o CLI.

## Notas de compatibilidade {#compatibility}

O conceito de "modo de código" era anteriormente chamado de "modo de desenvolvimento", portanto, alguns retrocompatibilidades
os nomes persistem. Você pode ignorá-los, a menos que esteja mantendo uma integração mais antiga
código:

- A variável de ambiente `AGENT_MODE` subjacente, o `/_agent-native/agent-chat/mode`
  endpoint (cuja chave de carga útil ainda é `devMode`) e o `agent-chat.mode`
  a chave de configurações permanece inalterada.
- `useDevMode()` permanece como um alias obsoleto para `useCodeMode()`.
