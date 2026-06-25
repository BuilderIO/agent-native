---
title: "Envio"
description: "Dispatch é o plano de controle do espaço de trabalho: caixa de entrada central, orquestração entre aplicativos, cofre de segredos, integração Slack/Telegram e trabalhos agendados."
---

# Envio

> **Veja também:** para uma visão geral conceitual do que o Dispatch faz e quando você deseja, consulte [Dispatch](/docs/dispatch). Esta página é a referência específica do modelo.

Dispatch é o **plano de controle do espaço de trabalho**. Enquanto outros modelos são aplicativos de domínio (Mail, Calendar, Analytics, Brain), o Dispatch é o aplicativo que você executa _juntamente_ com eles para coordenar tudo: uma caixa de entrada central, um cofre de segredos, trabalhos agendados, integração Slack/Telegram e um agente orquestrador que delega o trabalho do domínio ao aplicativo especializado certo por meio de [A2A](/docs/a2a-protocol).

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Dispatch</h1><span class='wf-pill accent'>Overview</span><span class='wf-pill'>Inbox</span><span class='wf-pill'>Secrets</span><span class='wf-pill'>Approvals</span><div style='flex:1'></div><button>Schedules</button></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>O que devemos fazer agora?</strong><div class='wf-box'>Peça ao Analytics os cadastros desta semana e rascunhe uma atualização no Slack.</div><button class='primary'>Delegate</button></div><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:10px'><div class='wf-card'><strong>Mail</strong><br/><small>/mail</small></div><div class='wf-card'><strong>Calendar</strong><br/><small>/calendar</small></div><div class='wf-card'><strong>Analytics</strong><br/><small>/analytics</small></div><div class='wf-card'><strong>Slides</strong><br/><small>/slides</small></div><div class='wf-card'><strong>Forms</strong><br/><small>/forms</small></div><div class='wf-card'><strong>Criar app</strong><br/><small>+</small></div></div><div class='wf-card' style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px'><div class='wf-box'>DM do Slack needs reply</div><div class='wf-box'>Tarefa A2A concluída</div><div class='wf-box'>Aprovação necessária</div></div></div>"
}
```

Se você estiver executando um [multi-app workspace](/docs/multi-app-workspace) com muitos aplicativos, o Dispatch é a cola.

```an-diagram title="Orquestre, não se especialize" summary="As mensagens de todos os canais chegam a uma caixa de entrada; o orquestrador faz a triagem e delega o trabalho do domínio para o aplicativo especializado certo em A2A — segredos, recursos e aprovações permanecem centrais."
{
  "html": "<div class=\"diagram-dispatch\"><div class=\"diagram-col\"><div class=\"diagram-node\">Slack · Telegram</div><div class=\"diagram-node\">Email</div><div class=\"diagram-node\">Solicitações A2A</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill accent\">Orchestrator</span><small class=\"diagram-muted\">caixa central · triagem · roteamento</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-node\">Agente Mail</div><div class=\"diagram-node\">Agente Analytics</div><div class=\"diagram-node\">Brain · Slides &hellip;</div></div></div><div class=\"diagram-shared\"><span class=\"diagram-pill\">Cofre de segredos</span><span class=\"diagram-pill\">Recursos do workspace</span><span class=\"diagram-pill warn\">Approvals</span><span class=\"diagram-pill\">Jobs agendados</span></div>",
  "css": ".diagram-dispatch{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-dispatch .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-dispatch .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-dispatch .diagram-arrow{font-size:20px;line-height:1}.diagram-shared{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}"
}
```

## O que faz {#what-it-does}

- **Caixa de entrada central.** DMs Slack, mensagens de telegrama, notificações por e-mail, solicitações A2A de outros agentes — tudo em um só lugar. O agente do Dispatch faz a triagem e cuida deles sozinho ou delega. Consulte [Messaging](/docs/messaging) para saber como conectar Slack, e-mail e Telegram ao seu espaço de trabalho.
- **Orquestrador, não especialista.** O Dispatch _não_ tenta ser o aplicativo de e-mail ou de análise. Quando alguém pergunta “resuma as inscrições da semana passada”, o Dispatch liga para o agente analítico pelo A2A e retorna a resposta. Quando alguém pede "rascunha uma resposta para Alice", o Dispatch liga para o agente de correio.
- **Shell do plano de controle.** Bate-papos, projetos, execuções, aplicativos de espaço de trabalho, agentes e automações vivem em um shell operacional, com listas de status primeiro e detalhamentos em vez de painéis únicos.
- **Cofre de segredos.** Um armazenamento central para chaves API, tokens OAuth e credenciais compartilhadas. Os aplicativos no espaço de trabalho resolvem segredos do Dispatch em vez de duplicá-los em cada `.env`. Solicitações + aprovações para acesso confidencial.
- **Recursos de espaço de trabalho.** skills global, instruções de proteção, perfis de agentes personalizados, recursos de referência e servidores HTTP MCP podem ser criados uma vez no Dispatch. Todos os recursos do aplicativo são herdados em tempo de execução por cada aplicativo, sem cópia ou etapa de sincronização manual; as concessões selecionadas são para exceções específicas de aplicativos.
- **Integrações reutilizáveis.** Um lugar para conectar contas de provedores e rastrear
  referências de credenciais e conceder acesso aos aplicativos. O Dispatch possui a identidade do provedor e
  concessões de aplicativos; aplicativos de domínio ainda possuem opções de origem específicas do aplicativo, como Brain's
  Lista de permissões de canal Slack ou configuração de métrica/painel do Analytics.
- **Hub de empregos agendados.** [recurring jobs](/docs/recurring-jobs) entre aplicativos ao vivo aqui: "todos os dias da semana às 7, extraia as principais métricas de ontem da análise e elabore um e-mail de resumo matinal."
- **Dreams.** O Dispatch pode analisar execuções recentes do agente, falhas, feedback e padrões de sucesso para propor melhorias de memória, habilidade, trabalho e instrução antes que qualquer coisa durável seja aplicada.
- **Fluxo de aprovação.** actions destrutivo ou externo (envio de dinheiro, envio de um e-mail de saída, postagem em Slack em grande escala) pode exigir a aprovação do administrador antes de disparar. O despacho é dono da fila.

## Quando usar {#when-to-use}

Use o envio quando:

- Você tem **dois ou mais** aplicativos nativos de agente em um espaço de trabalho e deseja um local para coordenar entre eles.
- Você precisa de **segredos centralizados** com concessões por aplicativo e uma trilha de auditoria.
- Você deseja um **hub de mensagens** que encaminhe Slack ou Telegram para o agente de domínio certo.
- Você quer **trabalhos agendados** que extraiam dados de vários aplicativos.

Ignore o scaffold de aplicativo único. Use o [Chat template](/docs/template-chat) ou qualquer um dos modelos de domínio diretamente.

Demonstração ao vivo: [dispatch.agent-native.com](https://dispatch.agent-native.com).

## O que você fará com isso {#what-youll-do}

No dia a dia, o Dispatch é o lugar onde os administradores e o pessoal de operações abrem para manter o espaço de trabalho funcionando:

- **Conecte Slack, e-mail e Telegram** para que as pessoas possam enviar mensagens para seu agente de onde quer que já trabalhem. Consulte [Messaging](/docs/messaging) para obter as etapas de fiação.
- **Salve os segredos compartilhados uma vez.** As chaves API, os tokens OAuth e as credenciais de serviço ficam no cofre e os outros aplicativos no seu espaço de trabalho são extraídos de lá, em vez de cada membro da equipe fazer malabarismos com seu próprio `.env`.
- **Conecte os provedores uma vez.** Integrações reutilizáveis armazenam metadados seguros da conta
  e referências de credenciais e conceda aplicativos como Brain, Analytics, Mail ou
  Acesso de despacho sem copiar segredos brutos. Fonte específica do aplicativo
  a configuração permanece no aplicativo que usa o provedor.
- **Exponha um conector MCP.** Adicione
  `https://dispatch.agent-native.com/_agent-native/mcp` em Claude, ChatGPT,
  Codex, Cursor ou outro host MCP e escolha quais aplicativos de espaço de trabalho serão
  pode ser acessado na página **Agentes** do Dispatch. Use um aplicativo direto URL
  somente quando esse host deve ser isolado para um aplicativo.
- **Gerenciar automações.** A visualização Automações mostra o estado ativado, última execução,
  próxima execução e último erro das programações `jobs/*.md` subjacentes e vamos
  você ativa ou desativa um trabalho sem editar os arquivos manualmente.
- **Mantenha o contexto da empresa global.** Coloque personas, posicionamento, mensagens, fatos da empresa, diretrizes de marca e proteções nos Recursos de despacho uma vez e, em seguida, visualize o espaço de trabalho efetivo -> app/org -> pilha pessoal para qualquer aplicativo/usuário ou inspecione a pilha na visualização de contexto de um cartão de aplicativo.
- **Configure trabalhos recorrentes.** "Toda segunda-feira, às 7h, pergunte ao agente de análise sobre as inscrições da semana passada e me envie um resumo por e-mail." Consulte [Recurring Jobs](/docs/recurring-jobs).
- **Analise as propostas dos sonhos.** O Dispatch Dreams inspeciona execuções anteriores do agente e cria propostas baseadas em fontes sobre o que o espaço de trabalho deve lembrar, quais notas obsoletas devem ser limpas e quais lições repetidas devem se tornar skills ou trabalhos.
- **Aprovar actions de saída antes que eles sejam disparados.** Enviar dinheiro, enviar e-mails em massa para clientes ou postar em um canal Slack público pode ser controlado por um OK do administrador.
- **Veja quem tem acesso a quê.** Concessões por aplicativo, fila de solicitações e um registro de auditoria de quem usou qual segredo e quando.
- **Encaminhe mensagens para o especialista certo.** Um DM Slack sobre análise vai para o agente de análise; um sobre e-mail vai para o agente de e-mail — Escolhas de despacho.

## Visão geral da arquitetura {#architecture}

_Como funciona nos bastidores (para desenvolvedores)._

- **Agente orquestrador.** O chat é configurado como um roteador: ele lê `AGENTS.md`, `LEARNINGS.md` e encaminha para subagentes especializados ou agentes A2A remotos.
- **Registro de agente remoto.** Os manifestos do agente A2A são entradas de tempo de execução do espaço de trabalho (não uma pasta de origem do modelo com check-in): em um espaço de trabalho com vários aplicativos, os aplicativos irmãos em `apps/` são descobertos automaticamente como pares A2A — sem necessidade de registro manual. O Dispatch os chama usando a ação `call-agent`.
- **Esquema do Vault.** Tabelas Drizzle para segredos, concessões, solicitações, aprovações e registros de auditoria. Eles residem no pacote `@agent-native/dispatch` (`packages/dispatch/src/db/schema.ts`) e são reexportados para o modelo via `templates/dispatch/server/db/index.ts` - não há `server/db/schema.ts` local de modelo. O tempo de execução do Dispatch é fornecido no pacote, não na fonte do modelo (consistente com a observação abaixo de que `@agent-native/dispatch` possui o shell, a barra lateral e as páginas integradas).
- **Plugins Slack / Telegram.** Plug-ins de servidor que registram webhooks e encaminham mensagens recebidas para o agente orquestrador.
- **Recursos MCP do espaço de trabalho.** Adicione definições de servidor HTTP MCP em `mcp-servers/*.json` em Recursos e, em seguida, coloque-as no escopo de Todos os aplicativos ou concessões de aplicativos selecionados, assim como skills e contexto.

```an-schema title="Esquema do cofre de segredos" summary="Secrets are stored once; grants give a named app access; requests + reviews gate sensitive access; the audit log records who used which secret when. Defined in @agent-native/dispatch (packages/dispatch/src/db/schema.ts)."
{
  "entities": [
    { "id": "secrets", "name": "vault_secrets", "note": "Valores de credenciais armazenados", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "owner_email", "type": "text" },
      { "name": "org_id", "type": "text", "nullable": true },
      { "name": "name", "type": "text" },
      { "name": "credential_key", "type": "text" },
      { "name": "value", "type": "text", "note": "secret value" },
      { "name": "provider", "type": "text", "nullable": true }
    ] },
    { "id": "grants", "name": "vault_grants", "note": "Concessão de acesso por aplicativo", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "secret_id", "type": "text", "fk": "vault_secrets.id" },
      { "name": "app_id", "type": "text" },
      { "name": "granted_by", "type": "text" },
      { "name": "status", "type": "text" }
    ] },
    { "id": "requests", "name": "vault_requests", "note": "Solicitação de acesso + revisão", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "credential_key", "type": "text" },
      { "name": "app_id", "type": "text" },
      { "name": "reason", "type": "text", "nullable": true },
      { "name": "status", "type": "text" },
      { "name": "reviewed_by", "type": "text", "nullable": true }
    ] },
    { "id": "audit", "name": "vault_audit_log", "note": "Quem usou qual segredo quando", "fields": [
      { "name": "id", "type": "text", "pk": true },
      { "name": "secret_id", "type": "text", "fk": "vault_secrets.id", "nullable": true },
      { "name": "app_id", "type": "text", "nullable": true },
      { "name": "action", "type": "text" },
      { "name": "actor", "type": "text" }
    ] }
  ],
  "relations": [
    { "from": "secrets", "to": "grants", "kind": "1-n", "label": "granted via" },
    { "from": "secrets", "to": "audit", "kind": "1-n", "label": "use recorded by" }
  ]
}
```

- **Modo hub MCP.** O Dispatch ainda pode atuar como o [MCP hub](/docs/mcp-clients#hub) do espaço de trabalho para que todos os outros aplicativos no espaço de trabalho extraiam a mesma lista de servidores MCP de escopo organizacional. Separadamente, o endpoint `/_agent-native/mcp` do próprio Dispatch é o conector MCP externo recomendado para Claude, ChatGPT e outros hosts que devem alcançar vários aplicativos de espaço de trabalho.

## Sonhos {#dreams}

Os sonhos são o ciclo de revisão do Dispatch para a memória do agente. Um passe de sonho examina execuções de agentes existentes, dados de depuração de thread, feedback, avaliações e falhas repetidas de ferramentas e, em seguida, escreve um relatório com as alterações propostas. As propostas podem ter como alvo memória pessoal, `LEARNINGS.md` compartilhado, instruções de espaço de trabalho, espaço de trabalho skills, conhecimento de espaço de trabalho, agentes de espaço de trabalho ou trabalhos recorrentes, mas as alterações compartilhadas e no nível do espaço de trabalho permanecem revisáveis em vez de serem aplicadas silenciosamente.

As propostas dos sonhos são verificadas em relação ao índice de memória pessoal, arquivos `memory/*.md` existentes e `LEARNINGS.md` compartilhados antes de serem salvas. Lições duplicadas são ignoradas no relatório, enquanto memórias pessoais provavelmente obsoletas são atualizadas em vez de produzir notas paralelas. Em um relatório, o Dreams também desduplica evidências repetidas por thread, tipo de sinal e cotação normalizada, retira o contexto injetado da detecção de correção do usuário e resume as linhas brutas de avaliação/ferramenta em marcadores legíveis por humanos antes de aparecerem no texto da proposta. Quando um passe encontra sinais, mas não cria propostas intencionalmente, o relatório inclui notas de proteção explicando quais evidências foram suprimidas.

Quando a política de aprovação do Dispatch está habilitada, a aplicação de uma proposta de sonho compartilhada ou de toda a equipe cria uma solicitação de aprovação pendente em vez de ser escrita imediatamente. Criar, atualizar ou excluir um recurso de espaço de trabalho para todos os aplicativos também coloca uma solicitação de aprovação na fila. Propostas de memória pessoal e edições de recursos somente selecionados ainda podem ser aplicadas diretamente após a revisão.

Use Dreams quando quiser responder a perguntas como "o que os agentes continuaram errando esta semana?", "o que devemos lembrar?" ou "qual lição repetida merece uma habilidade?" Slack de entrada, e-mail, Telegram, WhatsApp e evidências derivadas da web são tratados como informações não confiáveis, portanto, as propostas dessas fontes exigem revisão e procedência antes que afetem a memória compartilhada. As propostas de instrução de espaço de trabalho exigem evidências duráveis ​​abrangendo pelo menos dois threads ou dois aplicativos de origem; ruído somente de avaliação, problemas de configuração de conta, limites de cota e correções de texto UI de aplicativo único ficam fora das instruções globais.

### Limites de validação de entrada do sonho

Como as evidências são coletadas de fontes externas e não confiáveis (como transcrições de bate-papo, webhooks e integrações de terceiros), o processador Dream impõe limites rígidos de validação de entrada para evitar injeção imediata e ataques de tamanho de carga útil:

- **Limites de tamanho de bytes:** cargas úteis de threads individuais são limitadas a um máximo de 10 KB de conteúdo de texto por mensagem, e as verificações candidatas são truncadas se excederem 100 KB no total para evitar o esgotamento do contexto.
- **Sanitização:** todas as entradas de texto são limpas para remover caracteres de controle, cargas binárias e intervalos Unicode não imprimíveis.
- **Validação de esquema:** Os dados de depuração de entrada e o histórico de threads são analisados em relação a esquemas Zod estritos antes de serem compilados em prompts LLM. Qualquer estrutura candidata que falhe na validação do esquema é imediatamente descartada do lote de processamento.
- **Escapando:** Todos os pedaços de texto fornecidos pelo usuário são escapados dinamicamente quando formatados nos modelos de prompt para evitar injeções de prompt (por exemplo, tentar sequestrar o loop Dream para escrever instruções arbitrárias).

No Dispatch UI, abra **Dreams** para executar uma aprovação manual, revisar tópicos de candidatos, inspecionar o relatório e abrir a planilha de revisão de cada proposta antes de aplicá-la ou rejeitá-la. Use **Configurações** para editar a programação cron recorrente, o escopo de origem, os limites de tempo limite/simultaneidade, o limite de candidatos e o limite mínimo de candidatos; use **Garantir agendamento** depois de salvar quando desejar que o trabalho recorrente `jobs/dispatch-dream.md` se materialize a partir dessas configurações. A folha de revisão mostra o comportamento de aprovação, o conteúdo alvo atual, o conteúdo proposto e as evidências de origem. Os agentes usam o mesmo fluxo de trabalho por meio do actions:

- `list-dream-candidates` encontra threads recentes com sinais fundamentados, como correções explícitas do usuário, execuções com falha, erros de ferramenta, feedback, falhas de avaliação e fluxos de trabalho com pontos de verificação bem-sucedidos. Passe `sourceId: "all"` ou `sourceIds` para verificar várias fontes de depuração de thread; `sourceTimeoutMs`, `sourceConcurrency`, `sourceStartStaggerMs`, `threadConcurrency` e `threadTimeoutMs` mantêm as varreduras de produção parciais e limitadas, e a resposta inclui a integridade por origem.
- `create-dream-report` cria o relatório e as propostas pendentes. Os relatórios de várias fontes incluem uma seção Source Health para que verificações parciais fiquem visíveis durante a revisão. Correções repetidas e falhas recorrentes podem se tornar propostas de recursos de espaço de trabalho como `workspace-instruction`; Fluxos de trabalho repetidos e bem-sucedidos com pontos de verificação podem se tornar propostas `workspace-skill`.
- `get-dream-settings` e `set-dream-settings` leem e atualizam a programação de sonho recorrente, escopo de origem, controles de tempo limite/simultaneidade, limite e limite mínimo de candidato.
- `get-dream`, `preview-dream-proposal`, `apply-dream-proposal` e `reject-dream-proposal` controlam a revisão.
- `ensure-dream-job` cria o trabalho dos sonhos recorrente e seguro, uma vez que os relatórios manuais são úteis.

O executor de ação local do modelo Dispatch também expõe o pacote Dispatch actions, portanto, no desenvolvimento, você pode executar o mesmo fluxo de trabalho de `apps/dispatch`:

```bash
pnpm action get-dream-settings
pnpm action set-dream-settings --enabled true --schedule "0 9 * * 1" --allSources true --limit 8
pnpm action create-dream-report --allSources true --sourceTimeoutMs 30000 --limit 8
```

## Andaimes {#scaffolding}

```bash
npx @agent-native/core@latest create my-platform
# escolha "Dispatch" no seletor de seleção múltipla, além de quaisquer aplicativos de domínio que você desejar
```

Se preferir nomear o modelo diretamente em vez de usar o seletor:

```bash
npx @agent-native/core@latest create my-platform --template dispatch
# add more apps in the same workspace as you go
```

O Dispatch geralmente é estruturado em um espaço de trabalho junto com os aplicativos que ele coordena. Para um espaço de trabalho, a autenticação compartilhada, o banco de dados e a marca do Dispatch são herdados do núcleo do espaço de trabalho — consulte [Multi-App Workspace](/docs/multi-app-workspace).

Não há despacho `--standalone` significativo: um plano de controle sem nada para coordenar é apenas uma caixa de entrada vazia. Crie um scaffold em um espaço de trabalho com pelo menos um aplicativo de domínio para que ele tenha agentes para rotear por meio de A2A. (A sinalização ainda funciona e produz um aplicativo executável, mas o orquestrador não tem especialistas a quem delegar até que você adicione aplicativos irmãos.)

## Primeira execução local {#first-local-run}

Da raiz do espaço de trabalho:

```bash
pnpm install
pnpm dev
```

Abra o Dispatch URL impresso pelo servidor de desenvolvimento. O desenvolvimento local usa o mesmo fluxo de login do Better Auth que a produção. Crie uma conta local com email + senha; a verificação de e-mail é ignorada no desenvolvimento e a senha é armazenada apenas no banco de dados local do aplicativo. Não há desvio de autenticação compatível no scaffold padrão, porque o agente, os recursos do espaço de trabalho, o cofre e o modelo de compartilhamento dependem de uma sessão de usuário real.

Você pode clicar no Dispatch UI após fazer login. Para usar o compositor de bate-papo ou executar tarefas de agente, primeiro conecte um provedor LLM:

1. Abra **Configurações**.
2. Em **LLM**, conecte Builder.io ou adicione sua própria chave de provedor, como `ANTHROPIC_API_KEY`.
3. Volte para **Visão geral** e experimente o compositor.

## Personalizando {#customize}

Dispatch é um modelo completo como qualquer outro — consulte [Templates](/docs/cloneable-saas). Peça ao agente para "adicionar uma nova integração para Datadog" ou "rotear DMs Slack do canal X para o agente de análise" e ele editará a configuração de roteamento, adicionará o manipulador de webhook e conectará tudo.

Para telas de gerenciamento específicas do espaço de trabalho, adicione páginas locais do roteador React e
registrá-los em `app/dispatch-extensions.tsx`. O espaço de trabalho gerado possui
apenas a guia e rota extras; `@agent-native/dispatch` continua possuindo o shell,
barra lateral, páginas integradas e futuras atualizações de pacotes.

## O que vem a seguir

- [**Messaging**](/docs/messaging) — conectando Slack, e-mail e Telegram para que você possa falar com seu agente de qualquer lugar
- [**Multi-App Workspace**](/docs/multi-app-workspace) — executando o Dispatch junto com vários aplicativos
- [**A2A Protocol**](/docs/a2a-protocol) — como o Dispatch delega para agentes especializados
- [**MCP Clients — Hub Mode**](/docs/mcp-clients#hub) — compartilhando servidores MCP no espaço de trabalho
- [**Recurring Jobs**](/docs/recurring-jobs) — execuções de despacho de tarefas agendadas
