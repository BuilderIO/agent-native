---
title: "Extensões"
description: "Miniaplicativos que seus usuários criam dentro do seu modelo: um bloco KPI personalizado no Analytics, uma lista de verificação de preparação para reuniões no Agenda, um widget de contato CRM no Mail. Sem implantações, sem edições de código, sem alterações de esquema."
---

# Extensões

Extensões são **miniaplicativos que seus usuários criam dentro do seu modelo**.

Se você usou QuickBooks Online, você viu o modelo: QBO fornece um produto contábil básico e os usuários usam pequenos widgets personalizados - um relatório personalizado, uma calculadora de folha de pagamento, um verificador de regras fiscais - que ficam dentro do mesmo aplicativo e usam os mesmos dados. As extensões são a versão nativa do agente dessa ideia, exceto que seus usuários não escrevem nenhum código. Eles descrevem o que querem e o agente constrói.

O enquadramento é importante: uma extensão não é uma sandbox genérica do tipo "faça o que quiser". É um **miniaplicativo que estende um modelo específico** — Mail, Analytics, Calendar, Clips, Design — e usa o actions e os dados desse modelo. Uma extensão Mail lê e-mails. Uma extensão do Analytics lê as métricas de um painel. Uma extensão do Calendário atua no evento aberto. Eles se sentem parte do produto hospedeiro porque _são_ parte do produto hospedeiro.

Três coisas fazem as extensões funcionarem:

- **Sem código, sem implantação.** O agente os grava e eles ficam ativos em segundos. Armazenado no banco de dados, não no repositório.
- **Acesso total aos dados do modelo.** As extensões podem chamar o mesmo actions que o agente chama (`list-emails` no Mail, `list-decks` no Apresentações, `list-recordings` no Clips), para que tenham tudo o que o aplicativo host tem.
- **Armazenamento integrado.** Cada extensão tem seu próprio armazenamento de valores-chave por usuário/por organização, para que possa salvar o estado sem você adicionar uma nova tabela SQL.

Se um modelo não deve expor extensões de autoria do usuário, defina
`extensionTools: false` em `createAgentChatPlugin()`. Isso remove o
extensão actions voltada para o agente e orientação imediata enquanto deixa o restante
agente de aplicativo intacto.

```an-diagram title="A ponte da caixa de areia" summary="A extensão HTML é executada em um iframe isolado e atinge o host apenas por meio de um conjunto fixo de auxiliares de ponte - cada chamada tem escopo e acesso verificado."
{
  "html": "<div class=\"ext-bridge\"><div class=\"diagram-card sandbox\" data-rough><span class=\"diagram-pill warn\">Sandboxed iframe</span><small class=\"diagram-muted\">Alpine.js HTML &middot; no host cookies, session, or DOM</small><div class=\"ext-helpers\"><span class=\"diagram-pill\">appAction</span><span class=\"diagram-pill\">appFetch</span><span class=\"diagram-pill\">dbQuery / dbExec</span><span class=\"diagram-pill\">extensionData</span><span class=\"diagram-pill\">extensionFetch</span></div></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Template host<br><small class=\"diagram-muted\">ações, SQL com escopo automático</small></div><div class=\"diagram-box\">Secret proxy<br><small class=\"diagram-muted\"><code>${keys.NAME}</code>, travado ao domínio</small></div><div class=\"diagram-box\">APIs externas<br><small class=\"diagram-muted\">somente via extensionFetch</small></div></div></div>",
  "css": ".ext-bridge{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.ext-bridge .sandbox{display:flex;flex-direction:column;gap:8px;padding:16px 18px;flex:1;min-width:240px}.ext-bridge .ext-helpers{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.ext-bridge .diagram-col{display:flex;flex-direction:column;gap:8px}.ext-bridge .diagram-arrow{font-size:24px}"
}
```

As extensões também podem ser **repo-apoiadas no modo de arquivo local**. Nesse fluxo de trabalho,
`agent-native.json` declara uma pasta `extensions`, cada extensão tem um
Manifesto `extension.json` mais um arquivo de entrada HTML, e o aplicativo os renderiza
arquivos através da mesma sandbox. Extensões apoiadas por arquivo são editadas alterando
os arquivos repo; extensões apoiadas por banco de dados mantêm o tempo de execução criar/editar/compartilhar
experiência descrita abaixo.

## Uma galeria rápida {#gallery}

Extensões reais que as pessoas criariam, agrupadas pelo modelo em que vivem. Cada uma é uma coisa focada - não um canivete suíço.

### Correio

Um usuário está lendo um e-mail de `priya@acme.com`. Que tipo de widget ajudaria nesse caso?

- **Notas de contato** — um bloco de anotações fixado na pessoa para quem o usuário está enviando o e-mail. Carrega notas para esse contato e permite que o usuário faça mais anotações.
- **Tópicos recentes com esta pessoa** — uma pequena lista dos últimos cinco tópicos com o contato aberto, separada da visualização da caixa de entrada.
- **Enriquecimento CRM** — extrai o tamanho da empresa do contato, a data da última reunião ou negócios abertos do seu CRM.
- **Atalho do agendador de reuniões** — transforma "encontre um horário na próxima semana" em um widget "enviar estes horários" com um clique.

Sketch — Notas de contato (salva uma nota vinculada à pessoa para quem você está enviando o e-mail):

```html
<div
  class="p-4"
  x-data="{
    contactEmail: window.slotContext?.contactEmail,
    note: '',
    async init() {
      if (!this.contactEmail) return;
      const saved = await extensionData.get('notes', this.contactEmail);
      if (saved) this.note = JSON.parse(saved.data).text;
    },
    async save() {
      await extensionData.set('notes', this.contactEmail, { text: this.note });
    }
  }"
>
  <p class="text-xs text-muted-foreground mb-2" x-text="contactEmail"></p>
  <textarea
    x-model="note"
    @blur="save()"
    class="w-full rounded-md border bg-background p-2 text-sm"
    rows="4"
    placeholder="Notes about this contact..."
  ></textarea>
</div>
```

### Análise

Um usuário está olhando para um painel. Qual é o bloco que falta?

- **Caixa KPI personalizada** — um único grande número para uma métrica que não é um painel integrado. "Os testes começaram esta semana", "MRR delta vs mês passado."
- **Rastreador de metas** — extrai uma métrica escolhida pelo usuário e mostra o progresso em relação a uma meta digitada pelo usuário.
- **Tabela de classificação dos principais clientes** — junta uma métrica a uma tabela de clientes e classifica os 10 primeiros.

Esboço — caixa KPI personalizada (chama uma das consultas `appAction` do modelo de análise):

```html
<div
  class="p-4"
  x-data="{
  value: null,
  async init() {
    const result = await appAction('query-agent-native-analytics', {
      metric: 'trials_started',
      range: '7d'
    });
    this.value = result?.total ?? 0;
  }
}"
>
  <p class="text-xs uppercase tracking-wider text-muted-foreground">
    Trials this week
  </p>
  <p class="text-3xl font-bold mt-1" x-text="value ?? '—'"></p>
</div>
```

### Calendário

O usuário tem um evento aberto. O que ajudaria nesse momento?

- **Lista de verificação de preparação para reuniões** — carrega automaticamente itens da agenda, participantes e resumos de conversas anteriores do evento aberto.
- **Tempo de viagem** — "você tem 35 minutos até sua próxima reunião no local da missão."
- **Ajudante de fuso horário** — mostra rapidamente o horário da reunião no horário local de cada participante.

### Clipes

Um usuário está revisando uma gravação de tela. O que melhora essa visão?

- **Extrator de item de ação** — lê a transcrição do clipe (o agente o busca via `appAction`), lista as tarefas.
- **Compartilhamento automático** — um clique em "postar o link deste clipe no meu canal #recordings Slack."
- **Carretel de destaque** — extrai os capítulos gerados pelo agente e os transforma em um menu de navegação rápida.

### Projeto

Um usuário tem uma página de rascunho do Alpine/Tailwind aberta. O que suavizaria o ciclo de prototipagem?

- **Amostra de cores da marca** — paleta extraída da configuração da marca do usuário, clique para copiar uma cor no editor.
- **Seletor de recursos** — lista as imagens que o usuário enviou e descarta o URL ao clicar.
- **Inspetor de espaçamento** — mostra os tokens de espaço/preenchimento/margem que a página ativa usa, para que o usuário possa permanecer consistente.

Padrão em tudo isso: as extensões são sobre **o momento** em que o usuário está dentro do modelo de host. O agente já sabe qual contato, qual painel, qual evento, qual clipe — a extensão usa esse contexto.

## Como um usuário cria um {#building}

O caminho simples:

1. **Clique em "Nova extensão"** na barra lateral (ou simplesmente pergunte no chat).
2. **Descreva o que você deseja em uma frase.** "Um bloco de notas para o contato que estou enviando por e-mail." "Uma caixa KPI para testes começou esta semana."
3. **O agente escreve e ele aparece na sua lista de extensões, pronto para uso.**

Nenhum arquivo para editar, sem implantação. O agente escolhe os auxiliares certos (`appAction`, `extensionData`, `extensionFetch`) e escreve o Alpine.js HTML.

Se a extensão precisar de uma chave API — um token CRM, um API meteorológico — o agente informará o que adicionar e onde adicioná-lo. As chaves são armazenadas criptografadas e bloqueadas em domínios específicos.

Se quiser alterar algo mais tarde, basta dizer: "Adicionar uma caixa de pesquisa às minhas notas de contato." O agente edita o HTML no local — sem regeneração de tudo.

Cada alteração é versionada. Abra o controle Histórico do visualizador de extensão para ver
versões salvas, inspecione a diferença da versão anterior e restaure um
snapshot de nome/descrição/ícone/conteúdo mais antigo sem alteração de propriedade ou
compartilhamento.

## O que uma extensão pode fazer {#capabilities}

Dentro da sandbox iframe, cada extensão tem estes auxiliares em `window`:

| Ajudante                                         | Propósito                                                      | Exemplo                                                   |
| ------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------- |
| `appAction(name, params)`                        | Chame qualquer actions do modelo de host                       | `appAction('list-emails', { view: 'inbox' })`             |
| `appFetch(path, options)`                        | Chamar endpoints de estrutura permitidos em `/_agent-native/*` | `appFetch('/_agent-native/application-state/navigation')` |
| `dbQuery(sql, args)`                             | Ler de SQL (com escopo automático para o usuário)              | `dbQuery('SELECT id, name FROM tools')`                   |
| `dbExec(sql, args)`                              | Escrever para SQL                                              | `dbExec('INSERT INTO ...')`                               |
| `extensionFetch(url, options)`                   | Atingir APIs externos através de um proxy seguro com segredos  | `extensionFetch('https://api.github.com/user')`           |
| `extensionData.set(collection, id, data, opts?)` | Persistir dados por extensão (escopo de usuário/organização)   | `extensionData.set('notes', id, { text: '...' })`         |
| `extensionData.list(collection, opts?)`          | Listar itens persistentes                                      | `extensionData.list('notes', { scope: 'all' })`           |
| `extensionData.get(collection, id, opts?)`       | Obtenha um único item                                          | `extensionData.get('notes', 'note-1')`                    |
| `extensionData.remove(collection, id, opts?)`    | Excluir um item persistido                                     | `extensionData.remove('notes', 'note-1')`                 |

Três regras básicas:

- **Prefira `appAction` a `dbQuery`.** Actions é a superfície oficial do modelo — eles cuidam do controle de acesso, do escopo e da validação para você. Alcance o SQL bruto apenas quando nenhuma ação for adequada.
- **Use `appAction` para dados de modelo.** A extensão `appFetch` é limitada aos endpoints da estrutura `/_agent-native/*`; as rotas do modelo `/api/*` são bloqueadas pela ponte iframe.
- **Prefira `extensionData` a criar novas tabelas.** Cada extensão obtém seu próprio armazenamento de chave-valor isolado. Sem esquema, sem migração. Defina `{ scope: 'org' }` para compartilhar com a organização do usuário, `'user'` (padrão) para privado.

```html
<script>
  // Private to me
  await extensionData.set('notes', 'note-1', { title: 'My note' });

  // Shared with my org
  await extensionData.set('notes', 'team-note', { title: 'Team note' }, { scope: 'org' });

  // List everything visible to me (mine + org)
  const all = await extensionData.list('notes', { scope: 'all' });
</script>
```

APIs externos passam por `extensionFetch`, que faz proxy da chamada no lado do servidor e substitui segredos por meio do modelo `${keys.NAME}`:

```html
<script>
  const res = await extensionFetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ${keys.GITHUB_TOKEN}' },
  });
</script>
```

A chave real nunca chega ao navegador. Cada chave é bloqueada para uma lista de domínios permitidos, portanto, uma extensão vazada não pode exfiltrá-la em outro lugar.

## Slots — colocando uma extensão dentro do host UI {#slots}

A galeria acima descreve _o que_ uma extensão faz. Os slots descrevem _onde_ ele aparece.

Por padrão, uma extensão fica em sua própria página na lista de Extensões – abra-a como um pequeno aplicativo. Isso é adequado para painéis, calculadoras e widgets independentes.

Mas o caso de uso com formato mais QBO é diferente: o usuário deseja que seu widget seja fixado _dentro_ do UI do modelo – abaixo das informações de contato na barra lateral do Mail, no canto de um painel do Analytics, no lado direito de um evento do Calendário. É para isso que servem os **slots**.

Um slot é um widget nomeado onde um modelo é enviado:

| Modelo         | Exemplo de espaço              | Onde aparece                                                       |
| -------------- | ------------------------------ | ------------------------------------------------------------------ |
| **E-mail**     | `mail.contact-sidebar.bottom`  | Abaixo das informações de contato em todas as conversas por e-mail |
| **Análise**    | `analytics.dashboard.tiles`    | Juntamente com os painéis integrados do painel                     |
| **Calendário** | `calendar.event-detail.bottom` | Abaixo do evento aberto                                            |
| **Clipes**     | `clips.right-panel.tabs`       | Uma nova guia no painel de revisão de clipes                       |

Quando uma extensão é **instalada em um slot**, o host envia o contexto relevante — o e-mail do contato, o ID do painel, o ID do evento — para o iframe. A extensão lê `window.slotContext` para saber o que o usuário está vendo.

```an-diagram title="Os slots empurram o contexto para o widget" summary="O modelo de host possui slots nomeados; instalar uma extensão em um alimenta window.slotContext para tudo o que o usuário está visualizando no momento."
{
"html": "<div class=\"slot\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Thread de e-mail</span><small class=\"diagram-muted\">slot <code>mail.contact-sidebar.bottom</code></small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box accent\"><code>window.slotContext</code><br><small class=\"diagram-muted\">{ contactEmail }</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">Notas de contato</span><small class=\"diagram-muted\">loads notes for that contact &mdash; same widget, different context</small></div></div>",
"css": ".slot{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.slot .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px;min-width:180px}.slot .diagram-arrow{font-size:22px}"
}

```

### Um exemplo concreto

Imagine a extensão de notas de contato da galeria. Por si só, é um widget independente. Para fazê-lo aparecer na barra lateral de contatos do Mail:

1. Crie a extensão uma vez. Use `window.slotContext.contactEmail` para saber em qual contato o usuário está.
2. Diga qual espaço ele pode preencher: `add-extension-slot-target { extensionId, slotId: "mail.contact-sidebar.bottom" }`.
3. Instale: `install-extension { extensionId, slotId: "mail.contact-sidebar.bottom" }`.

Na próxima vez que você abrir uma conversa por e-mail, seu bloco de notas estará logo abaixo das informações de contato, preenchido com notas para a pessoa para quem você está enviando o e-mail. Mude para um tópico diferente, as notas para _esse_ contato serão carregadas. Mesma extensão, contexto diferente, sem reescrita.

Na prática você não executa esses três comandos manualmente. Basta dizer "fixar este widget na barra lateral de meus contatos" e o agente cuidará do target + install para você.

> **Os slots são um recurso _adicionado_, não um pré-requisito.** Muitas extensões úteis nunca são instaladas em um slot — elas vivem felizes em sua própria página. Alcance espaços quando o widget precisar estar _próximo_ ao que o usuário está vendo no modelo de host.

Para obter detalhes mais profundos sobre slots — como declará-los em seu modelo, como funciona o contrato de contexto, como o escopo das instalações é definido — consulte a habilidade `extension-points`. Skills é enviado dentro de cada modelo de andaime em `.agents/skills/`; consulte [Skills Guide](/docs/skills-guide) para saber como eles funcionam.

## Extensões de arquivos locais {#local-file-extensions}

O modo de arquivo local permite que um espaço de trabalho mantenha extensões no repositório:

```text
extensions/
  doc-status/
    extension.json
    index.html
```

```json
{
  "id": "doc-status",
  "name": "Doc Status",
  "description": "Shows metadata for the selected Content file.",
  "entry": "index.html",
  "slots": ["content.sidebar.bottom"],
  "permissions": {
    "appActions": ["list-documents"],
    "extensionData": true
  }
}
```

Adicione a pasta ao aplicativo relevante em `agent-native.json`:

```json
{
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [{ "name": "Docs", "path": "docs", "extensions": [".mdx"] }],
      "components": "components",
      "extensions": "extensions"
    }
  }
}
```

O aplicativo lista extensões baseadas em arquivos junto com extensões e renderizações baseadas em banco de dados
-los através do iframe normal da sandbox. Declarações de slot em `extension.json`
montar automaticamente a extensão em `ExtensionSlot`s correspondentes; não há por usuário
Linha de instalação SQL para extensões locais.

As extensões locais têm um modelo de permissão v1 mais rígido:

- `extensionData` está disponível para estado de tempo de execução pequeno, a menos que esteja desativado.
- As chamadas `appAction` devem ser listadas explicitamente em `permissions.appActions`.
- `dbQuery`, `dbExec` e `extensionFetch` estão bloqueados por enquanto.
- Atualização, exclusão, compartilhamento e histórico apoiados por SQL actions retornam uma mensagem que
  aponta para o arquivo de entrada local.

Use extensões baseadas em banco de dados quando os usuários precisarem criar/compartilhar/editar widgets em
tempo de execução. Use extensões de arquivo locais quando a extensão fizer parte de um repositório primeiro
espaço de trabalho e deve ser passível de revisão, correção e controle de versão com o restante
os arquivos.

## Compartilhamento {#sharing}

As extensões são privadas para o usuário que as criou por padrão. Para compartilhar:

- **Visível para a organização** — todos na organização podem vê-lo e usá-lo.
- **Concessões por usuário** — convide pessoas específicas como visualizadores/editores/administradores.

As extensões compartilhadas têm seus próprios URLs e se conectam à mesma caixa de diálogo de compartilhamento que documentos, apresentações e painéis. As instalações de slots são sempre pessoais – compartilhar uma extensão significa que outras pessoas _podem_ instalá-la; ele não o fixa automaticamente no UI.

## Extensões versus edição do código do aplicativo {#vs-app-code}

A estrutura permite que o agente edite o código-fonte do aplicativo diretamente – componentes, rotas, estilos. Então, quando você deve solicitar uma extensão?

|                            | Extensão                                                      | Edição do código do aplicativo                         |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| **Criado por**             | Agente (ou usuário) em tempo de execução                      | Agente editando arquivos de origem                     |
| **Armazenado em**          | O banco de dados                                              | O repositório git                                      |
| **Requer uma versão**      | Não                                                           | Sim                                                    |
| **Requer uma implantação** | Não                                                           | Sim                                                    |
| **Escopo**                 | Um usuário (ou compartilhado com a organização)               | O produto inteiro, cada usuário                        |
| **Melhor para**            | Widgets pessoais, KPIs personalizados, utilitários por equipe | Recursos principais disponíveis para todos os usuários |

Regra geral: **se for para um usuário ou uma equipe, é uma extensão.** Se todos os usuários do modelo quiserem obtê-lo, envie-o como um recurso real.

## Segurança {#security}

```an-callout
{ "tone": "success", "body": "**The raw secret never reaches the browser.** `extensionFetch` substitutes `${keys.NAME}` server-side and each key is locked to a URL allowlist, so even a leaked extension can't exfiltrate it elsewhere." }
```

As extensões são executadas em um iframe em sandbox:

- **Isolado** dos cookies, da sessão e do DOM do aplicativo pai.
- **Injeção de segredo no lado do servidor** por meio do modelo `${keys.NAME}` — o valor real da chave nunca chega ao navegador.
- **Segredos bloqueados por domínio** — cada chave está vinculada a uma lista de permissões URL; o proxy recusa solicitações para outros hosts.
- **Proteção de rede privada** — as extensões não podem alcançar endereços internos.
- **Autenticação necessária** — as extensões são executadas apenas para usuários logados, e as chamadas `dbQuery`/`dbExec` têm escopo automático.

## Algumas coisas que você deve saber sobre nomenclatura {#naming-back-compat}

Se você estiver fuçando no SQL ou na fonte, verá uma mistura de nomes de "extensão" e "ferramenta". Decodificador rápido:

- A primitiva voltada para o usuário costumava ser chamada de "Ferramentas". Agora é **Extensões**.
- As tabelas físicas SQL (`tools`, `tool_data`, `tool_shares`, `tool_slots`, `tool_slot_installs`) mantêm seus nomes originais. Renomear uma tabela é uma migração destrutiva, e a estrutura não envia migrações destrutivas.
- As exportações Drizzle/TypeScript usam os novos nomes: `extensions`, `extensionData`, `extensionShares`, `extensionSlots`, `extensionSlotInstalls`.
- Dentro do iframe de uma extensão, os auxiliares canônicos são `extensionFetch` e `extensionData`. Os nomes herdados `toolFetch` e `toolData` ainda são resolvidos, então a extensão mais antiga HTML continua funcionando.

Você também não verá isso em uso normal, mas o agente tem um terceiro conceito relacionado chamado "ferramentas LLM" — a área de superfície de chamada de função em um giro de modelo (definido via `defineAction`, MCP, etc.). Esses são os primitivos de chamada de função, não os widgets voltados para o usuário. Quando esta página diz “extensão”, significa o widget voltado para o usuário; quando outros documentos dizem "ferramenta" ao lado de `defineAction`, esse é o conceito LLM.

## O que vem a seguir

- [**Templates**](/docs/cloneable-saas) — extensão das extensões dos aplicativos host
- [**Actions**](/docs/actions) — as operações que um ramal chama via `appAction`
- [**Sharing & Privacy**](/docs/sharing) — como funcionam a visibilidade de extensões, o compartilhamento organizacional e as concessões por usuário
- [**Onboarding & API Keys**](/docs/onboarding) — como os segredos aparecem nas configurações UI
- [**Security**](/docs/security) — o modelo de escopo e acesso de dados da estrutura
