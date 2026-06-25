---
title: "Cérebro"
description: "Bate-papo limpo da empresa, apoiado pela memória institucional citada, ingestão de fontes revisáveis e integrações reutilizáveis de espaço de trabalho."
---

# Cérebro

O cérebro é um bate-papo limpo da empresa, apoiado pela memória institucional citada. As pessoas perguntam
perguntas em inglês simples; O cérebro responde a partir do conhecimento aprovado da empresa com
links de volta para o thread Slack, reunião, transcrição, problema ou captura de webhook
que apoia a resposta.

Brain ingere canais Slack aprovados, gravações de clipes, Granola Team-space
notas, problemas/PRs GitHub e cargas genéricas de transcrição/webhook. Ele armazena matéria-prima
captura, destila fatos/decisões/processos duráveis e roteia informações sensíveis ou
memórias de baixa confiança são revisadas antes de se tornarem conhecimento da empresa.

A superfície do produto permanece simples de propósito: **Perguntar** é o chat principal
experiência, enquanto **Fontes**, **Revisão** e **Conhecimento** são de administração/suporte
superfícies para conectar dados, aprovar propostas e inspecionar a memória citada.

```an-diagram title="Da fonte à resposta citada" summary="O Brain ingere fontes aprovadas em capturas brutas, destila memória durável, passa por revisão e só então responde com citações."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Sources</span><small class=\"diagram-muted\">Slack · Granola · GitHub · Clips · webhooks</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Capturas brutas<br><small class=\"diagram-muted\">deduplicado, redigido</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Distill<br><small class=\"diagram-muted\">fatos · decisões · processos</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">Review</span><small class=\"diagram-muted\">sensitive / low-confidence queue</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><span class=\"diagram-pill ok\">Knowledge</span><small class=\"diagram-muted\">aprovado, atômico</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Ask</span><small class=\"diagram-muted\">cited answer</small></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagram-flow .diagram-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px}.diagram-flow .diagram-box{display:flex;flex-direction:column;gap:4px}.diagram-flow .diagram-arrow{font-size:20px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Perguntar à memória da empresa</h1><span class='wf-pill accent'>42 approved memories</span><span class='wf-pill'>3 sources</span><div style='flex:1'></div><button>Sources</button><button>Review</button></div><div class='wf-card' style='display:flex;align-items:center;gap:10px'><span data-icon='search' aria-label='Pesquisar'></span><strong style='flex:1'>Por que escolhemos preços por uso?</strong><button class='primary'>Ask</button></div><div class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>Answer</strong><p style='margin:0'>A equipe escolheu preços por uso depois que os pilotos mostraram que contagens de assentos subestimavam o valor da automação.</p><div style='display:flex;gap:8px;flex-wrap:wrap'><span class='wf-pill accent'>RFC de preços</span><span class='wf-pill'>Retro de lançamento</span><span class='wf-pill'>Notas de vendas</span></div></div><div class='wf-card' style='flex:1;display:flex;flex-direction:column;gap:8px'><strong>Linha do tempo das fontes</strong><div class='wf-box'>3 de maio · Decisão capturada</div><div class='wf-box'>8 de maio · Evidência de cliente adicionada</div><div class='wf-box'>12 de maio · Nota legal aprovada</div></div></div>"
}
```

Quando você abre o aplicativo, **Ask** está em destaque: um bate-papo limpo e revisado
memória da empresa. **Fontes**, **Revisão** e **Conhecimento** acompanham-no como
superfícies administrativas para conectar dados, aprovar propostas e inspecionar citações
entradas.

## Quando escolher

Use o Brain quando sua equipe quiser que os agentes respondam perguntas como "por que fizemos
esta decisão do produto?", "como funciona esse recurso em desenvolvimento?" ou "o quê
mudou neste processo?" com links para a conversa de origem, reunião,
ou problema.

Brain e Dispatch são complementares, mas fazem trabalhos diferentes:

- **O cérebro é dono da memória da empresa.** Ele ingere fontes, analisa capturas brutas,
  destila fatos/decisões/processos duráveis, respostas de evidências citadas e
  expõe o conhecimento aprovado aos agentes.
- **O Dispatch possui o plano de controle do espaço de trabalho.** Ele centraliza as mensagens,
  segredos, trabalhos recorrentes, aprovações, orquestração A2A e distribuição
  e aprovação de recursos para todo o espaço de trabalho.

Em um espaço de trabalho com vários aplicativos, o Dispatch pode encaminhar uma pergunta para o Brain por meio de A2A e
pode conceder credenciais de provedor compartilhadas ao Brain. Brain continua sendo o especialista em
ingestão, revisão, recuperação de fontes aprovadas e respostas citadas do Company Brain.
Brain expõe a recuperação somente leitura e baseada em citações como seu recurso público A2A
para que os aplicativos Dispatch e irmãos possam fazer perguntas sobre a memória da empresa — o agente A2A
cartão são metadados de descoberta pública, enquanto a recuperação ainda acontece dentro do Brain
superfície de ação autenticada.

## O que você pode fazer com isso

- **Faça perguntas citadas.** Perguntar é a principal superfície do produto: um bate-papo limpo
  memória da empresa revisada, com integridade da fonte, contagem de revisões e sugestões
  perguntas mantidas em segundo plano. Cada resposta está vinculada ao tópico Slack,
  reunião, problema ou captura que suporte isso.
- **Conecte fontes aprovadas.** Configure manual, webhook genérico, Clips, Slack,
  Granola e fontes GitHub. As fontes são compartilhadas pela organização por padrão, então a empresa
  a memória é útil para todo o espaço de trabalho.
- **Revise antes de publicar.** As memórias propostas recebem um caminho de revisão de primeira classe
  onde os revisores editam o texto, inspecionam links de evidências/fontes e aprovam ou
  rejeitar. Entradas de alta confiança e não confidenciais podem ser publicadas imediatamente;
  Entradas confidenciais ou do nível da empresa são enfileiradas como propostas.
- **Inspecione o conhecimento citado.** A rota Conhecimento mostra destilado, atômico
  entradas com tipo, tópico, entidades, confiança, citações de evidências exatas e
  substituir links.
- **Reutilize integrações de espaços de trabalho.** Fontes cerebrais podem reutilizar espaços de trabalho compartilhados
  concessões de conexão em vez de inserir novamente os tokens do provedor. A página Fontes
  mostra registros de origem do Brain ao lado de provedores e concessões de conexão reutilizáveis
  prontidão.
- **Espelhe a memória aprovada como contexto de ambiente.** Entradas canônicas aprovadas podem
  espelhar os recursos do espaço de trabalho em `context/company-brain/...` e outros
  aplicativos podem usá-los como contexto. Ambos os fluxos visualizam o Markdown exato antes do
  o recurso foi gravado ou removido.

## Primeiros passos

Demonstração ao vivo: [brain.agent-native.com](https://brain.agent-native.com).

1. **Experimente a demonstração.** Abra o Ask e escolha **Iniciar demonstração**. O cérebro semeia um pequeno
   corpus de decisão do produto, executa as verificações de confiança e faz uma pergunta citada, portanto
   você pode ver respostas, citações, análises e comportamentos não encontrados antes de adicionar
   dados reais da empresa.
2. **Adicione uma fonte.** Comece com um único canal Slack, Granola Team-space
   feed, repositório GitHub, exportação de clipes ou webhook de transcrição genérico. Manter
   o escopo é pequeno até que as citações e a qualidade da revisão pareçam corretas.
3. **Revise antes de publicar.** Use a revisão para inspecionar evidências, editar o texto,
   e aprove apenas memórias duráveis da empresa.
4. **Pergunte da fonte.** Use Perguntar para perguntas que devem ser fundamentadas
   conhecimento aprovado, não registros brutos de bate-papo.

Para uma demonstração pública, o corpus propagado demonstra o recall da decisão do produto,
links de citação, comportamento de substituição, bloqueio de revisão, redação, conteúdo pessoal
exclusão e comportamento honesto não encontrado sem conectar um espaço de trabalho real.

### Instruções úteis

- "O que decidimos sobre o preço anual e onde isso foi discutido?"
- "Encontre a alteração mais recente no processo de integração e cite a fonte."
- "Resuma o que esta discussão sobre GitHub significa para o plano de lançamento."
- "Revise as propostas de memória pendentes e sinalize qualquer coisa muito vaga para ser publicada."
- "Quais fontes estão desatualizadas ou com falha na sincronização?"

## Para desenvolvedores

O restante deste documento é para qualquer pessoa que faça bifurcação do modelo Brain ou estenda-o.

### Início rápido

```bash
npx @agent-native/core@latest create my-brain --standalone --template brain
cd my-brain
pnpm install
pnpm dev
```

Abra o aplicativo e escolha **Iniciar demonstração** para ver a memória citada sem conectar um espaço de trabalho real.

### Modelo de dados

O Brain usa intencionalmente a pesquisa de texto SQL e a expansão de consulta de agente — existe
não há necessidade de banco de dados vetorial, portanto o modelo permanece portátil em SQLite,
Postgres, Neon, D1, Turso e hosts semelhantes. O estado do aplicativo reflete o
rota atual, filtros e IDs selecionados para que o agente sempre saiba a rota atual
navegação e seleção.

O esquema do cérebro reside em `templates/brain/server/db/schema.ts`. Oito tabelas:

| Tabela                   | O que ele contém                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `brain_sources`          | Configuração do conector — provedor, canais/repos permitidos, cursores de sincronização, postura de revisão, `ingest_token_hash`, `status`, `last_synced_at` |
| `brain_source_shares`    | Concessões de compartilhamento por origem (visualizador/editor/administrador)                                                                                |
| `brain_raw_captures`     | Transcrições, exportações de canal, notas e importações de webhook com chave de desduplicação `external_id`, `content_hash`, tipo e status de destilação     |
| `brain_knowledge`        | Entradas atômicas destiladas — tipo (decisão/fato/processo/…), tópico, entidades, citações de evidências, confiança, `publish_tier`, links de substituição   |
| `brain_knowledge_shares` | Concessões de compartilhamento por conhecimento                                                                                                              |
| `brain_proposals`        | Itens de revisão pendentes — proposta de criação/atualização/arquivamento com evidências e notas do revisor                                                  |
| `brain_proposal_shares`  | Concessões de ações por proposta                                                                                                                             |
| `brain_sync_runs`        | Registro de auditoria de sincronização — provedor, status, estatísticas JSON, erro, carimbos de data/hora de início/término                                  |
| `brain_ingest_queue`     | Fila de destilação em segundo plano — operação, status, prioridade, contagem de novas tentativas, `run_after`                                                |

```an-schema title="Modelo de dados cerebrais" summary="Connectors produce raw captures; distillation turns captures into reviewable knowledge; proposals gate sensitive entries. Sync runs and the ingest queue track background work."
{
  "entities": [
    { "id": "sources", "name": "brain_sources", "note": "Configuração do conector", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "provider", "type": "text", "note": "slack / granola / github / clips / webhook" },
      { "name": "ingest_token_hash", "type": "text" },
      { "name": "status", "type": "text" },
      { "name": "last_synced_at", "type": "timestamp", "nullable": true }
    ] },
    { "id": "source_shares", "name": "brain_source_shares", "note": "viewer / editor / admin", "fields": [
      { "name": "source_id", "type": "id", "fk": "brain_sources.id" }
    ] },
    { "id": "captures", "name": "brain_raw_captures", "note": "Cargas brutas ingeridas", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "source_id", "type": "id", "fk": "brain_sources.id" },
      { "name": "external_id", "type": "text", "note": "dedupe key" },
      { "name": "content_hash", "type": "text" },
      { "name": "kind", "type": "text" }
    ] },
    { "id": "knowledge", "name": "brain_knowledge", "note": "Entradas atômicas destiladas", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "kind", "type": "text", "note": "decision / fact / process" },
      { "name": "topic", "type": "text" },
      { "name": "entities", "type": "json" },
      { "name": "confidence", "type": "real" },
      { "name": "publish_tier", "type": "text" }
    ] },
    { "id": "knowledge_shares", "name": "brain_knowledge_shares", "fields": [
      { "name": "knowledge_id", "type": "id", "fk": "brain_knowledge.id" }
    ] },
    { "id": "proposals", "name": "brain_proposals", "note": "Itens de revisão pendentes", "fields": [
      { "name": "id", "type": "id", "pk": true },
      { "name": "op", "type": "text", "note": "create / update / archive" }
    ] },
    { "id": "proposal_shares", "name": "brain_proposal_shares", "fields": [
      { "name": "proposal_id", "type": "id", "fk": "brain_proposals.id" }
    ] },
    { "id": "sync_runs", "name": "brain_sync_runs", "note": "Sincronizar registro de auditoria", "fields": [
      { "name": "source_id", "type": "id", "fk": "brain_sources.id" },
      { "name": "status", "type": "text" },
      { "name": "stats", "type": "json" }
    ] },
    { "id": "ingest_queue", "name": "brain_ingest_queue", "note": "Fila de destilação em segundo plano", "fields": [
      { "name": "operation", "type": "text" },
      { "name": "status", "type": "text" },
      { "name": "priority", "type": "int" },
      { "name": "run_after", "type": "timestamp", "nullable": true }
    ] }
  ],
  "relations": [
    { "from": "sources", "to": "captures", "kind": "1-n", "label": "ingested into" },
    { "from": "knowledge", "to": "captures", "kind": "n-n", "label": "evidence" },
    { "from": "knowledge", "to": "proposals", "kind": "1-n", "label": "gated by" },
    { "from": "sources", "to": "sync_runs", "kind": "1-n", "label": "audited by" }
  ]
}
```

### Chave actions

Agrupado por área (`templates/brain/actions/`):

- **Gerenciamento de origem** — `create-source`, `update-source`, `delete-source`, `get-source`, `list-sources`, `sync-source`, `sync-due-sources`, `run-slack-pilot`, `test-slack-connection`
- **Ingestão de captura** — `import-capture`, `import-transcript`, `list-captures`, `get-capture`, `mark-capture-distilled`, `resanitize-captures`
- **Destilação** — `enqueue-distillation`, `enqueue-captures-distillation`, `claim-distillation`, `retry-distillation`, `list-distillation-queue`
- **Conhecimento e revisão** — `write-knowledge`, `get-knowledge`, `list-knowledge`, `set-knowledge-canonical`, `preview-canonical-resource`, `list-proposals`, `review-proposal`, `approve-proposal`, `reject-proposal`, `update-proposal`
- **Pesquisa e recuperação** — `ask-brain`, `search-knowledge`, `search-everything`
- **Configurações** — `get-brain-settings`, `update-brain-settings`, `set-settings`, `get-settings`
- **Avaliação e demonstração** — `seed-demo-data`, `run-demo-eval`, `run-retrieval-eval`
- **Contexto e navegação** — `view-screen`, `navigate`
- **Provedor APIs** — `provider-api-catalog`, `provider-api-docs`, `provider-api-request`

### Conectando fontes

O Brain resolve primeiro as credenciais do provedor de uma conexão de espaço de trabalho concedida,
em seguida, a partir de credenciais de cofre locais ou registradas do Brain compatíveis com versões anteriores.
As credenciais de origem cerebral não recorrem a variáveis de ambiente no nível de implantação.
Se já existir um provedor compartilhado, conceda acesso ao Brain em vez de copiar o
mesmo segredo em um ambiente específico do Cérebro.

**Slack.** Crie uma origem com escopo para IDs de canal específicos. O conector
verifica cada conversa configurada, rejeita DMs e MPIMs e armazena o cursor
estado para que cada sincronização seja retomada onde a última parou. Um fluxo de implementação seguro ativado
cada placa de origem Slack permite **testar** a credencial e a lista de permissões sem
ler o histórico, executar uma pequena amostra limitada do **Piloto seguro**, **Revisar capturas**,
e aprove na **Fila de revisão** antes que qualquer coisa se torne questionável. Conceda o
bot apenas os escopos que a fonte precisa (validação de credenciais, lista de permissões
verificação, histórico de canais permitidos e links permanentes duráveis).

**Granola.** Crie uma fonte com uma janela de votação e tamanho de página. Granola
As chaves Enterprise API expõem notas do espaço da equipe, não notas ou pastas privadas. Cérebro
armazena o resumo da nota, a transcrição, os participantes, os metadados do calendário e a fonte
URL como captura bruta antes da destilação.

**GitHub.** Crie uma fonte com escopo para repositórios aprovados. O conector
importa problema limitado e contexto de solicitação pull com URLs de origem estáveis que podem
ser destilado como Slack ou contexto de reunião. Esta é a ingestão de contexto cerebral, não
um substituto para relatórios GitHub no estilo Analytics.

**Clips e webhooks genérico.** Brain expõe um webhook assinado para Clips e
importações genéricas de transcrição/captura em `/api/_agent-native/brain/ingest`. Criar
uma fonte com um `sourceKey` para receber um token de portador e, em seguida, enviar um
`RawCapturePayload` com `Authorization: Bearer <ingestToken>`. Fontes genéricas
use o mesmo formato de carga útil para transcrições de chamadas, pesquisas de clientes, importadas
notas ou qualquer outra fonte que possa produzir uma captura limitada.

```an-api title="Webhook de ingestão assinado" summary="Clipes e importações transcript/capture genéricas postam um RawCapturePayload com um token de portador por origem."
{
  "method": "POST",
  "path": "/api/_agent-native/brain/ingest",
  "summary": "Importe uma captura bruta de Clips ou de uma fonte genérica",
  "auth": "Bearer <ingestToken> issued per source via its sourceKey",
  "request": {
    "contentType": "application/json",
    "example": "RawCapturePayload — bounded transcript / capture body"
  },
  "responses": [
    { "status": "200", "description": "Capture accepted and queued for distillation" },
    { "status": "401", "description": "Missing or invalid ingest bearer token" }
  ]
}
```

As fontes Slack, Granola e GitHub podem ativar o `autoSync` em segundo plano com um
cadência da pesquisa assim que a qualidade da avaliação for comprovada.

### Privacidade e controle

O cérebro foi projetado para a memória da empresa, não para a vigilância pessoal:

- A sincronização Slack lê apenas canais configurados explicitamente e rejeita DMs/MPIMs.
- A sincronização do Granola lê notas do espaço da equipe expostas pelo API do Granola, não privadas
  notas ou pastas privadas.
- As capturas brutas são editadas das superfícies de listagem/pesquisa por padrão; revisores
  e os fluxos de destilação solicitam visualizações ou conteúdo bruto somente quando necessário.
- As configurações de origem podem exigir revisão antes que o conhecimento destilado se torne durável
  memória da empresa.
- As configurações controlam o nível de publicação padrão, se o conhecimento do nível da empresa exigir
  aprovação, requisitos de citação, redação de e-mail e erro de conector
  notificações.

### Personalizando

Brain segue o contrato de quatro áreas do agente nativo – mude o comportamento editando
a área correspondente e o agente pode fazer estas edições para você:

- `templates/brain/app/routes/` — a superfície UI: Perguntar, Pesquisar, Conhecimento,
  Revisão, fontes, configurações e rotas da equipe.
- `templates/brain/actions/` — todas as operações que podem ser chamadas pelo agente (importações, origem
  gestão, relatórios piloto, destilação, revisão de propostas, pesquisa citada,
  navegação/contexto). Adicione um novo arquivo com `defineAction` para expor um novo
  capacidade.
- `templates/brain/.agents/skills/` — Orientação específica do cérebro para destilação
  e recuperação. Atualize ou adicione uma habilidade ao ensinar um novo fluxo de trabalho ao agente.
- `templates/brain/AGENTS.md` — guia de agente de nível superior. Atualizar ao adicionar major
  recursos.
- `templates/brain/server/db/schema.ts` — modelo de dados. Apenas migrações aditivas;
  rota, filtros e IDs selecionados são espelhados em `application_state` para agente
  contexto.

Peça ao agente para fazer alterações para você — ele pode editar sua própria fonte. Veja
[Self-Modifying Code](/docs/key-concepts#agent-modifies-code).

## O que vem a seguir

- [**Dispatch**](/docs/dispatch) — o plano de controle do espaço de trabalho
- [**Dispatch template**](/docs/template-dispatch) — o aplicativo de coordenação de andaimes
- [**Workspace**](/docs/workspace) — recursos compartilhados entre aplicativos
- [**A2A Protocol**](/docs/a2a-protocol) — delegação entre aplicativos
