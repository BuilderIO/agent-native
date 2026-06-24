---
title: "Formulários"
description: "Construtor de formulários nativo do agente: crie, edite, publique e encaminhe envios de formulários por meio de linguagem natural e um editor visual."
---

# Formulários

Forms é um construtor de formulários nativo do agente. Descreva o formulário desejado, refine-o no editor e publique um formulário público que armazene os envios em seu próprio banco de dados SQL.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1.4px solid var(--wf-line)'><strong>Beta signup</strong><span class='wf-pill accent'>published</span><div style='flex:1'></div><button>Share</button><button class='primary'>Unpublish</button></div><div style='display:flex;gap:8px;padding:12px 16px;border-bottom:1.4px solid var(--wf-line)'><span class='wf-pill accent'>Edit</span><span class='wf-pill'>Results 187</span><span class='wf-pill'>Settings</span><span class='wf-pill'>Integrations</span></div><div style='display:flex;flex-direction:column;gap:12px;padding:30px 78px;overflow:hidden'><h2 style='margin:0'>Beta signup</h2><p class='wf-muted' style='margin:0'>Reserve a spot in the upcoming private beta cohort.</p><div class='wf-card'><strong>Full name</strong><input value='Ada Lovelace'/></div><div class='wf-card'><strong>Work email</strong><input value='you@company.com'/></div><div class='wf-card'><strong>Your role</strong><input value='Select...'/></div><div class='wf-card'><strong>Team size</strong><input value='Select...'/></div></div></div>"
}
```

Ao abrir o aplicativo, você vê seus formulários, o editor atual e uma visualização ao vivo. O agente pode criar um formulário a partir de um prompt, atualizar rótulos e opções de campos, alterar a validação e conectar destinos de envio usando o mesmo actions que o UI usa.

```an-diagram title="Build, publish, collect" summary="The agent and the visual editor edit one SQL-backed form definition. The public fill page is unauthenticated, and submissions route server-side to your destinations."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Agent prompt<br><small class=\"diagram-muted\">\"add an NPS question\"</small></div><div class=\"diagram-node\">Visual editor<br><small class=\"diagram-muted\">labels, validation, order</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">create-form · update-form</span><small class=\"diagram-muted\">fields JSON, settings JSON</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">forms table<br><small class=\"diagram-muted\">SQL via Drizzle</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Public fill page<br><small class=\"diagram-muted\">unauthenticated</small></div><div class=\"diagram-box\">responses<br><small class=\"diagram-muted\">+ Slack / webhook / Sheets</small></div></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## O que você pode fazer com isso

- **Crie formulários de forma conversacional.** "Crie um formulário de contato", "adicione uma pergunta de pontuação NPS", "torne o campo de e-mail obrigatório." O agente atualiza o esquema do formulário e as atualizações de visualização do estado apoiado por SQL.
- **Ajuste visual.** Edite rótulos, espaços reservados, estado obrigatório, opções e ordem de campos do construtor UI quando desejar controle direto.
- **Use os tipos de campo enviados.** Campos de texto, e-mail, número, texto longo, seleção, seleção múltipla, caixa de seleção, rádio, data, classificação e escala são compatíveis imediatamente.
- **Colete respostas.** Cada envio é armazenado em SQL com uma visualização detalhada por resposta e um painel para revisão de entradas.
- **Rotear envios.** Envie cargas de envio para webhooks, Slack, Discord ou Planilhas Google usando as integrações integradas.
- **Publique formulários públicos.** Compartilhe um formulário público URL e mostre uma mensagem de agradecimento após o envio.

## Primeiros passos

Demonstração ao vivo: [forms.agent-native.com](https://forms.agent-native.com).

1. **Crie um formulário a partir de um prompt.** Peça o formulário desejado, incluindo o
   público e o que deve acontecer após o envio.
2. **Refine no editor.** Ajuste rótulos, validação, opções e ordem
   o construtor visual quando a edição direta é mais rápida.
3. **Publique e compartilhe.** Use o formulário público URL para os entrevistados e assista
   os resultados chegam na visualização Respostas.
4. **Conecte destinos.** Encaminhe novos envios para Slack, Discord, Google
   Folhas, webhooks ou seu próprio ponto de extensão.

### Instruções úteis

- "Crie um formulário de inscrição beta com função, tamanho da equipe e caso de uso prioritário."
- "Adicione uma pergunta NPS obrigatória e um acompanhamento em texto livre."
- "Postar cada nova resposta no canal do produto Slack."
- "Resuma os envios desta semana e agrupe-os por segmento de cliente."
- "Torne este formulário mais curto sem perder os campos necessários para o roteamento."

## Para desenvolvedores

O restante deste documento é para qualquer pessoa que faça bifurcação do modelo Formulários ou estenda-o.

### Início rápido

```bash
npx @agent-native/core@latest create my-forms --standalone --template forms
cd my-forms
pnpm install
pnpm dev
```

Para um espaço de trabalho com Formulários junto com outros aplicativos:

```bash
npx @agent-native/core@latest create my-platform
```

Escolha formulários e quaisquer outros modelos desejados durante a configuração do espaço de trabalho.

### Principais recursos {#key-features}

**Definições de formulário JSON.** Os campos ficam em uma coluna `fields` JSON, para que o agente possa fazer edições cirúrgicas sem alterações de esquema para cada tipo de campo.

**Páginas de preenchimento público.** Os entrevistados podem enviar formulários não autenticados, enquanto as configurações privadas são removidas antes que os dados cheguem ao navegador.

**Destinos no lado do servidor.** Slack, Discord, Planilhas Google e integrações de webhook ficam nas configurações do formulário e são executadas após o envio.

### Modelo de dados

Todos os dados residem em SQL via Drizzle ORM. Esquema: `templates/forms/server/db/schema.ts`. Os formulários carregam o `ownableColumns` padrão e uma tabela de compartilhamentos de estrutura correspondente, para que eles se encaixem no modelo de compartilhamento por usuário/por organização.

| Tabela        | O que ele contém                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms`       | Uma definição de formulário - `title`, `description`, `slug` exclusivo, `fields` (matriz JSON de `FormField`), `settings` (JSON `FormSettings`), `status` (`draft` / `published` / `closed`) e um `deleted_at` de exclusão reversível |
| `responses`   | Um envio por linha — `form_id`, `data` (JSON `{ fieldId: value }`), `submitted_at`, `ip` opcional e `submitter_email`                                                                                                                 |
| `form_shares` | O Framework compartilha princípios de mapeamento de tabela (usuários ou organizações) com funções (visualizador, editor, administrador) por formulário                                                                                |

As formas `fields` e `settings` JSON são definidas em `templates/forms/shared/types.ts` (`FormField`, `FormSettings`). As configurações privadas do proprietário, como webhook de integração URLs e origens permitidas, são removidas antes que qualquer dado chegue à página de preenchimento público via `toPublicFormSettings`.

```an-schema title="Forms data model" summary="Three tables. Fields and integrations are JSON columns on forms, so the agent's edits are surgical patches rather than cross-table row changes."
{
  "entities": [
    {
      "id": "forms",
      "name": "forms",
      "note": "A form definition (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "slug", "type": "string", "note": "unique; public URL" },
        { "name": "fields", "type": "json", "note": "FormField[] — all field types" },
        { "name": "settings", "type": "json", "note": "FormSettings — integrations, etc." },
        { "name": "status", "type": "enum", "note": "draft | published | closed" },
        { "name": "deleted_at", "type": "datetime", "nullable": true, "note": "soft delete" },
        { "name": "owner_email", "type": "string" },
        { "name": "org_id", "type": "id", "nullable": true }
      ]
    },
    {
      "id": "responses",
      "name": "responses",
      "note": "One submission per row",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "data", "type": "json", "note": "{ fieldId: value }" },
        { "name": "submitted_at", "type": "datetime" },
        { "name": "ip", "type": "string", "nullable": true },
        { "name": "submitter_email", "type": "string", "nullable": true }
      ]
    },
    {
      "id": "form_shares",
      "name": "form_shares",
      "note": "Framework shares table — principals to roles per form",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "viewer | editor | admin" }
      ]
    }
  ],
  "relations": [
    { "from": "forms", "to": "responses", "kind": "1-n", "label": "has responses" },
    { "from": "forms", "to": "form_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

### Chave actions

Cada operação é um arquivo TypeScript em `templates/forms/actions/`, montado automaticamente em `POST /_agent-native/actions/:name`:

- `create-form` — crie um novo formulário (título, descrição, campos, configurações)
- `update-form` — atualizar campos, configurações ou status
- `get-form` — recupera um formulário por id ou slug
- `list-forms` — listar formulários acessíveis
- `delete-form` — exclusão reversível (configura `deleted_at`)
- `restore-form` — restaura um formulário excluído de forma reversível
- `list-responses` — lista os envios para um formulário com filtros opcionais
- `export-responses` — exporta respostas como CSV ou JSON

### Personalizando

Pergunte primeiro ao agente sobre o comportamento enviado:

- "Adicione um campo de opção obrigatório para o método de contato preferido."
- "Postar cada novo envio em Slack." Conecte Slack primeiro via [Messaging](/docs/messaging).
- "Adicione um destino de webhook para nosso CRM."
- "Crie um formulário de feedback do cliente com uma escala de 1 a 10 e um texto longo de acompanhamento."
- "Tornar alguns formulários públicos e outros apenas para login."

Se você precisar de novos recursos, como uploads de arquivos, assinaturas ou widgets de campos personalizados, trate-os como extensões de modelo: adicione a forma SQL, os controles do editor actions, UI, o suporte ao renderizador público e as instruções do agente juntos. Consulte [Creating Templates](/docs/creating-templates) para o padrão de construção atual.

## O que vem a seguir

- [**Templates**](/docs/cloneable-saas) — o modelo clone e próprio
- [**Actions**](/docs/actions) — o sistema de ação que alimenta o construtor
- [**Messaging**](/docs/messaging) — Slack e outros destinos de envio
