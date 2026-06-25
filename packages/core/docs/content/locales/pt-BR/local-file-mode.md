---
title: "Modo de arquivo local"
description: "Execute aplicativos nativos do agente com Markdown, MDX locais e outros arquivos repo como fonte da verdade, incluindo documentos MDX no estilo Obsidian com componentes personalizados."
---

# Modo de arquivo local

O modo de arquivo local permite que um aplicativo nativo do agente anexe seu UI normal e sua superfície de ação
diretamente para arquivos em um repositório ou espaço de trabalho. O aplicativo ainda parece hospedado
produto, mas suas visualizações de lista, editor e ferramentas de agente leem e gravam arquivos locais
em vez de registros de aplicativos baseados em SQL.

A primeira implementação está no modelo Conteúdo: a barra lateral esquerda está
preenchido a partir de arquivos locais `.md` e `.mdx`, selecionar uma página abre o padrão
Editor de conteúdo e gravação de gravação no arquivo selecionado. Os mesmos arquivos podem
também pode ser editado por Codex, Claude Code, agente da barra lateral Agent-Native ou um normal
editor.

Para conteúdo, isso faz com que o produto pareça Obsidian de código aberto para MDX:
seus documentos ficam como arquivos, enquanto o aplicativo adiciona um editor visual, o agente actions,
cópias compartilháveis e componentes MDX interativos avançados.

Use o modo de arquivo local quando desejar um fluxo de trabalho com foco no repositório:

- um repositório de documentos com `docs/*.mdx`
- um blog com `blog/*.mdx`
- recursos como posicionamento, mensagens ou notas da equipe em `resources/*.md`
- uma base de conhecimento pessoal no estilo Obsidian com um editor MDX mais rico
- documentos que precisam de blocos MDX personalizados interativos gerados a partir do código React local
- artefatos de aplicativos que devem ser fáceis de serem inspecionados e corrigidos pelos agentes de codificação

Use o modo de banco de dados quando desejar a experiência de aplicativo colaborativo hospedado:
compartilhamento multiusuário, permissões baseadas em SQL, comentários, histórico de versões e
hospedagem de produção sem acesso ao sistema de arquivos local.

## O modelo mental

Existem dois modos de fonte da verdade:

| Modo                  | Fonte da verdade                                         | Melhor para                                                                                                                |
| --------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Modo banco de dados   | Linhas SQL até Drizzle                                   | Aplicativos hospedados, colaboração, compartilhamento, comentários, histórico de versões                                   |
| Modo de arquivo local | Arquivos repositórios declarados por `agent-native.json` | Fluxos de trabalho locais/de desenvolvimento, revisão do Git, edições do agente de codificação, conteúdo nativo de arquivo |

O UI e o agente actions devem permanecer na mesma forma em ambos os modos. Um conteúdo
editor ainda edita documentos; a diferença é se esses documentos resolvem
para linhas SQL ou arquivos locais.

```an-diagram title="Mesmas ações, duas fontes de verdade" summary="A UI e o agente chamam ações idênticas em ambos os modos. A camada de ação decide se cada chamada é resolvida para SQL linhas ou arquivos repo."
{
  "html": "<div class=\"diagram-mode\"><div class=\"diagram-col entry\"><div class=\"diagram-node\">UI de conteúdo</div><div class=\"diagram-node\">Agente + ações<br><small class=\"diagram-muted\">list/get/update-document</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-row resolve\"><div class=\"diagram-panel\" data-rough><span class=\"diagram-pill accent\">Modo banco de dados</span><small class=\"diagram-muted\">SQL rows via Drizzle</small><small class=\"diagram-muted\">hospedado · compartilhamento · comentários · histórico</small></div><div class=\"diagram-panel\" data-rough><span class=\"diagram-pill ok\">Local File Mode</span><small class=\"diagram-muted\">repo files via agent-native.json</small><small class=\"diagram-muted\">revisão Git · edições do agente de código</small></div></div></div>",
  "css": ".diagram-mode{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-mode .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-mode .diagram-arrow{font-size:22px;line-height:1}.diagram-mode .resolve{display:flex;gap:12px;flex-wrap:wrap}.diagram-mode .diagram-panel{display:flex;flex-direction:column;gap:4px;padding:12px 14px}"
}
```

## Exemplo de repositório

Um espaço de trabalho Conteúdo pode ser tão pequeno quanto isto:

```an-file-tree title="Um repo de workspace do Content"
{
  "entries": [
    { "path": "agent-native.json", "note": "Declara quais pastas são raízes de conteúdo e seus tipos" },
    { "path": "docs/", "note": "Raiz de conteúdo: aparece na sidebar como páginas" },
    { "path": "docs/getting-started.mdx" },
    { "path": "docs/guides/custom-components.mdx" },
    { "path": "blog/", "note": "Raiz de conteúdo" },
    { "path": "blog/launch-post.mdx" },
    { "path": "resources/", "note": "Raiz de conteúdo" },
    { "path": "resources/messaging/positioning.md" },
    { "path": "components/", "note": "NÃO é uma raiz de conteúdo: biblioteca de componentes de preview que MDX pode importar" },
    { "path": "components/FrameworkTabs.tsx" },
    { "path": "components/Callout.tsx" },
    { "path": "extensions/", "note": "NÃO é uma raiz de conteúdo: biblioteca local de extensions (widgets em sandbox)" },
    { "path": "extensions/doc-status/extension.json" },
    { "path": "extensions/doc-status/index.html" }
  ]
}
```

No modo de arquivo local, a barra lateral de conteúdo mostra `docs/`, `blog/` e
Árvores `resources/` como páginas. Selecionar `docs/getting-started.mdx` abre isso
arquivo no editor de conteúdo padrão; a edição no UI grava de volta em
`docs/getting-started.mdx`.

`components/` não é uma raiz de conteúdo. É uma biblioteca de componentes de visualização que MDX
arquivos podem ser importados ou referenciados. O editor pode renderizar componentes MDX locais simples
sem precisar clonar ou bifurcar todo o aplicativo Content.

`extensions/` também não é uma raiz de conteúdo. É uma biblioteca de extensão local:
pequenos widgets em sandbox que podem ser renderizados em slots de aplicativos enquanto sua fonte permanece em
o repositório.

## Instalar conteúdo em um repositório

Para documentos, blogs ou espaço de trabalho MDX existentes, instale os arquivos locais de conteúdo
habilidade:

```bash
npx @agent-native/core@latest skills add content --mode local-files --scope project
```

Isso copia a habilidade `content` nas pastas de habilidades do agente do repositório e grava
ou atualiza `agent-native.json` com padrões de conteúdo:

- `mode: "local-files"` no nível do espaço de trabalho
- `apps.content.mode: "local-files"`
- raízes de conteúdo para `docs/`, `blog/`, `content/` e `resources/`
- `components/` para componentes MDX locais
- `extensions/` para widgets de extensão local

A habilidade instalada informa aos agentes de codificação para usarem o Conteúdo actions
(`list-documents`, `get-document`, `edit-document`, `update-document`,
`share-local-file-document` e arquivo de componente actions) quando um aplicativo de conteúdo local
ou Agent Native Desktop bridge os expõe. Se nenhuma ponte estiver funcionando, a habilidade
volta para edições de repositório diretas e seguras, preservando o frontmatter, as importações, JSX,
e MDX desconhecido.

## Configuração

Adicione `agent-native.json` ao repositório ou raiz do espaço de trabalho:

```json
{
  "version": 1,
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [
        {
          "name": "Docs",
          "path": "docs",
          "kind": "docs",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Blog",
          "path": "blog",
          "kind": "blog",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Resources",
          "path": "resources",
          "kind": "resources",
          "extensions": [".md", ".mdx"]
        }
      ],
      "components": "components",
      "extensions": "extensions",
      "hide": ["**/_*.md", "**/_*.mdx"]
    }
  }
}
```

Você também pode ativar arquivos locais com `AGENT_NATIVE_MODE=local-files` ou
`AGENT_NATIVE_DATA_MODE=local-files`; o manifesto é preferido porque
documenta o contrato da pasta no próprio repositório.

## Formato de arquivo de conteúdo

O conteúdo diz Markdown e MDX. Frontmatter contém metadados da página e o corpo é
o documento editável:

```mdx
---
title: "Primeiros passos"
icon: "sparkles"
isFavorite: true
updatedAt: "2026-06-12T20:00:00.000Z"
---

# Primeiros passos

Use <FrameworkTabs value="react" /> to show framework-specific code.
```

O título vem do frontmatter `title` quando presente, caso contrário, do
nome do arquivo. O editor preserva a fonte MDX que ainda não pode ser editada visualmente, portanto
agentes de codificação e editores de texto normais permanecem como saídas de escape seguras.

## Componentes MDX personalizados

O conteúdo pode visualizar componentes locais da pasta `components` configurada.
Isso se destina a componentes MDX de estilo de documento, como guias, textos explicativos, pacote
instale snippets ou blocos de código específicos da estrutura.

Por exemplo, adicione um componente interativo próximo ao seu conteúdo:

```tsx
// components/ImpactCounter.tsx
import { useState } from "react";

export function ImpactCounter({
  label = "points",
  accent = "blue",
  featured = false,
}: {
  label?: string;
  accent?: "blue" | "green" | "purple";
  featured?: boolean;
}) {
  const [count, setCount] = useState(3);
  const accentClass =
    accent === "green"
      ? "border-green-300 bg-green-50"
      : accent === "purple"
        ? "border-purple-300 bg-purple-50"
        : "border-blue-300 bg-blue-50";

  return (
    <div className={`rounded-md border p-4 ${accentClass}`}>
      <div className="text-sm text-muted-foreground">Launch impact</div>
      <div className="mt-1 text-3xl font-semibold">
        {count} {label}
      </div>
      {featured ? <div className="mt-1 text-sm">Featured metric</div> : null}
      <button
        type="button"
        className="mt-3 rounded border px-3 py-1 text-sm"
        onClick={() => setCount((value) => value + 1)}
      >
        Add point
      </button>
    </div>
  );
}

export const ImpactCounterInputs = {
  label: {
    type: "string",
    label: "Metric label",
    default: "points",
  },
  accent: {
    type: "select",
    label: "Accent",
    options: ["blue", "green", "purple"],
    default: "blue",
  },
  featured: {
    type: "boolean",
    label: "Featured",
    default: false,
  },
};
```

Em seguida, use-o em qualquer arquivo MDX local:

```mdx
---
title: "Notas de lançamento"
---

# Notas de lançamento

<ImpactCounter label="wins" />
```

O servidor de desenvolvimento de conteúdo descobre exportações nomeadas de PascalCase e padrão de PascalCase
exporta arquivos `.tsx`, `.jsx`, `.ts` e `.js` em `components/`. Aqueles
componentes são renderizados dentro do editor e aparecem no menu de barras em
**Componentes locais**. A inserção de barra cria uma tag mínima como
`<ImpactCounter />`; adicione adereços na fonte MDX quando necessário.

A execução do componente é intencionalmente um recurso de ponte local-dev/Desktop, não
acesso simples à pasta do navegador hospedado. Se você abrir `content.agent-native.com`,
escolha **Arquivos locais** e escolha uma pasta no Chrome, o app pode ler e gravar
os arquivos `.md` e `.mdx` através do navegador Sistema de Arquivos Acesse API, mas
O Chrome não expõe um caminho de pasta absoluto para Vite compilar
`components/*.tsx`. Para visualizar e recarregar componentes React personalizados, execute
Conteúdo localmente ou use o Agent Native Desktop para que a ponte local confiável possa
registre o espaço de trabalho escolhido no servidor de desenvolvimento de conteúdo local. Nesse modo,
edições em arquivos de componentes existentes, recarregamento a quente por meio de Vite e adição de ou
a remoção de arquivos de componentes recarrega o registro do componente e o menu de barras.

Os agentes também podem trabalhar com esses arquivos de componentes registrados. Usar
`list-local-component-files` para encontrar o ID do espaço de trabalho registrado e, em seguida,
`write-local-component-file` para criar ou atualizar `.tsx`, `.jsx`, `.ts` ou
Arquivos `.js` na pasta `components/` do espaço de trabalho. Os arquivos MDX permanecem os
fonte de verdade para uso de componentes; os arquivos do componente permanecem no repositório normal
arquivos de origem revisados com Git.

Se um componente exportar metadados de entrada, selecione o componente no editor
mostra um botão de edição no canto superior direito do componente. Tipos de entrada suportados
são `string`, `textarea`, `number`, `boolean` e `select`. O formulário escreve
volta para a tag MDX, então os arquivos locais permanecem a fonte da verdade. O
metadados podem ser exportados como `ComponentNameInputs`, `ComponentNameConfig.inputs`,
`Component.inputs` ou `agentNative.inputs`.

Tags de componentes simples com adereços literais podem ser visualizados in-line:

```mdx
<FrameworkTabs value="react" />

<Callout type="warning">This setting affects production deploys.</Callout>
```

Expressões JSX complexas são preservadas na origem. Se o editor não puder com segurança
visualizar um suporte de componente ainda, ele mostra um espaço reservado de aviso em vez de
descartando dados silenciosamente.

## Compartilhando arquivos locais

Os arquivos locais não são compartilhados diretamente porque outros usuários não conseguem ler um caminho
sua máquina. O botão Compartilhar da barra de ferramentas Conteúdo cria ou atualiza um
cópia do arquivo selecionado com base no banco de dados, navega até essa cópia e abre o
popover de compartilhamento normal. O arquivo local original permanece em Arquivos locais; o
a cópia do banco de dados aparece em Cópias compartilhadas no modo de arquivo local e usa o
modelo padrão de compartilhamento de documentos.

## Extensões locais

O modo de arquivo local também pode carregar extensões apoiadas por repositório a partir do configurado
Pasta `extensions`. Cada extensão é um diretório com um `extension.json`
manifesto e um arquivo de entrada HTML:

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

`index.html` é o mesmo formato de corpo de extensão Alpine/Tailwind usado pelo normal
extensões apoiadas por banco de dados. Quando o aplicativo Content vê uma extensão local que
declara `content.sidebar.bottom`, ele renderiza essa extensão na parte inferior de
a barra lateral de Conteúdo. O host passa `window.slotContext` com o selecionado
ID do documento, título, metadados de origem e se o conteúdo está no modo de arquivo local.

As extensões locais são visualizadas pelo aplicativo, mas editadas como arquivos. As extensões
a lista mostra-os com um selo de arquivo local, e o visualizador de página inteira aponta de volta para
o arquivo de entrada. Extensão actions apoiada por SQL, como atualizar, excluir, compartilhar e
história não se aplica; use seu editor, código Codex, Claude ou histórico do Git para
alterações na origem.

Para v1, as extensões locais são intencionalmente conservadoras:

- eles podem usar `extensionData` para seu próprio estado de tempo de execução pequeno
- eles podem ligar apenas para os `appAction`s listados em `extension.json`
- ajudantes SQL brutos e `extensionFetch` externos estão desabilitados
- os destinos dos slots são declarados em `extension.json`, não instalados por meio de SQL

Isso dá aos espaços de trabalho locais uma superfície de plug-in semelhante ao Obsidian, sem permitir
O arquivo repositório arbitrário herda todos os recursos de uma extensão baseada em banco de dados.

## Como os aplicativos usam isso

O modo de arquivo local é implementado por meio dos auxiliares de artefatos locais da estrutura.
Um aplicativo declara raízes para os tipos de artefatos que possui, depois lê e grava
através da mesma ação, o UI e o agente já usam.

Para Conteúdo, isso significa:

- `list-documents` lista os arquivos `.md` e `.mdx` configurados.
- `get-document` lê um arquivo local selecionado.
- `update-document` grava o arquivo local selecionado.
- `create-document` cria um novo arquivo `.mdx` local na pasta selecionada.
- `delete-document` exclui o arquivo local.
- a pesquisa é executada nos arquivos locais configurados.

Mover, renomear e reordenar páginas de arquivos locais do Conteúdo UI não é
ainda compatível. Faça essas operações no espaço de trabalho ou com um agente de codificação; o
A barra lateral de conteúdo refletirá a árvore de arquivos resultante.

Isso mantém o contrato do agente simples: o agente pode continuar usando o Conteúdo actions,
e aqueles actions decidem se o alvo é apoiado por SQL ou por arquivo.

Outros aplicativos podem adotar o mesmo padrão ao longo do tempo. Um aplicativo Apresentações pode mapear
`slides/*.mdx` para decks, um aplicativo de Planos pode mapear `plans/*` para documentos de planejamento e um
O aplicativo Dashboards pode mapear `dashboards/*.mdx` para dashboards. Aqueles específicos do aplicativo
pastas são convenções colocadas em camadas sobre o mesmo contrato de artefato local.

## Arquivos locais x exportação/importação

O conteúdo tem dois fluxos de trabalho de arquivo diferentes:

| Fluxo de trabalho                    | O que acontece                                                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exportação/importação `/local-files` | O modo banco de dados continua sendo a fonte da verdade. Os arquivos são uma superfície de sincronização explícita que você exporta, edita, visualiza e importa. |
| Modo de arquivo local                | Os arquivos são a fonte da verdade. A barra lateral e o editor de conteúdo operam diretamente em arquivos locais.                                                |

Use exportar/importar quando quiser revisar arquivos ocasionalmente em um espaço de trabalho hospedado.
Use o modo de arquivo local quando o próprio repositório for o espaço de trabalho.

## História e colaboração

O modo de arquivo local depende do histórico nativo do arquivo:

- confirmar alterações importantes no Git
- use pull requests para revisão
- permitir que os agentes de codificação editem os mesmos arquivos diretamente
- use diferenças normais de arquivo para entender as alterações

O modo banco de dados continua sendo o mais adequado para recursos de colaboração hospedados, como
compartilhamento, comentários, histórico de versões apoiado por SQL e edição multiusuário ao vivo.

A sincronização do provedor pode ser colocada em camadas sobre qualquer um dos modos. Por exemplo, um repositório de documentos pode
adicione actions que extrai conteúdo de um CMS para arquivos MDX locais ou envia por push os selecionados
arquivos locais de volta para esse CMS.

## Segurança de produção

O modo de arquivo local fornece ao aplicativo actions acesso direto de gravação ao espaço de trabalho configurado
arquivos. Isso é apropriado para desenvolvimento local e arquivo confiável de locatário único
pontes, mas não é o modelo de segurança de produção padrão.

Quando `NODE_ENV=production`, a estrutura recusa o modo `local-files`, a menos que você
definir:

```bash
AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION=true
```

Defina isso apenas para uma implantação confiável de locatário único, onde todos que podem usar
o aplicativo tem permissão para ler e gravar os arquivos configurados. Para hospedagem normal,
aplicativos multiusuário, usam modo de banco de dados e compartilhamento apoiado por SQL.
