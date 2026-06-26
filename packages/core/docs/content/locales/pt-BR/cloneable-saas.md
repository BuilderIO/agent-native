---
title: "Modelos"
description: "Fork um produto SaaS funcional e torne-o seu - agente incluído."
---

# Modelos

Deseja enviar sua própria ferramenta de análise baseada em IA? Cliente de e-mail? Construtor de formulários? Escolha um modelo e você terá um SaaS funcional em minutos: agente, banco de dados, autenticação e pipeline de implantação já conectados.

A maioria dos "modelos" oferece um andaime em branco e uma longa lista TODO. O agente nativo inverte isso. Cada um deles é um **produto completo de nível SaaS** — já executável no primeiro dia, já disponível para entrega e inteiramente seu para personalizar, marcar e implantar. Pense neles como SaaS clonáveis, não como kits iniciais: você está criando um produto acabado, e não olhando para um padrão.

## Modelos disponíveis {#catalog}

Cada um é um aplicativo real que você pode usar hoje e a plataforma de lançamento para sua própria versão.

| Modelo                                    | O que é                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [**Chat**](/docs/template-chat)           | Aplicativo mínimo de bate-papo com threads duráveis, actions, autenticação e um caminho limpo para UI personalizado ou seu próprio back-end. |
| [**Mail**](/docs/template-mail)           | Um super-humano nativo do agente. Caixa de entrada, marcadores, triagem de IA, teclado, rascunhos e envios por meio do agente.               |
| [**Calendar**](/docs/template-calendar)   | Um Google Calendar nativo do agente. Eventos, sincronização, links públicos para reservas, agendamento orientado por agentes.                |
| [**Content**](/docs/template-content)     | Obsidiana de código aberto para MDX. Markdown/MDX local, editor Tiptap, sincronização Notion, colaboração multiusuário em tempo real.        |
| [**Brain**](/docs/template-brain)         | Bate-papo limpo da empresa, respaldado pela memória institucional citada, fontes aprovadas, portas de revisão e citações.                    |
| [**Assets**](/docs/template-assets)       | Gerenciador de ativos digitais para bibliotecas de marcas, uploads, referências e geração de imagens/vídeos da marca.                        |
| [**Slides**](/docs/template-slides)       | Um Apresentações Google nativo do agente. Decks baseados em React que o agente gera e edita diretamente.                                     |
| [**Video**](/docs/template-videos)        | Motion graphics programáticos e vídeos de demonstração de produtos no Remotion.                                                              |
| [**Analytics**](/docs/template-analytics) | Um Amplitude/Mixpanel nativo do agente. Conecte fontes de dados, solicite gráficos e fixe em painéis.                                        |
| [**Clips**](/docs/template-clips)         | Tela assíncrona + gravação de câmera com transcrição, capítulos e resumos de IA.                                                             |
| [**Design**](/docs/template-design)       | Estúdio de prototipagem HTML nativo do agente para designs interativos Alpine/Tailwind.                                                      |
| [**Forms**](/docs/template-forms)         | Um Typeform nativo do agente. Crie, compartilhe, colete e encaminhe envios para Slack, Planilhas, webhooks ou Discord.                       |
| [**Plan**](/docs/template-plan)           | Planos visuais e recapitulações de relações públicas com diagramas, wireframes e anotações.                                                  |
| [**Dispatch**](/docs/template-dispatch)   | O plano de controle do espaço de trabalho: segredos compartilhados, integrações reutilizáveis, Slack/Telegram, trabalhos agendados.          |

Não quer um modelo de domínio? Use [Chat](/docs/template-chat) quando quiser um aplicativo básico com o qual os usuários possam conversar imediatamente ou comece a agir primeiro com [Pure-Agent Apps](/docs/pure-agent-apps).

Veja o catálogo completo em [Templates](/templates) ou vá direto para um. Por exemplo, [Dispatch](/docs/template-dispatch) é um ótimo lugar para começar se você quiser um aplicativo estilo espaço de trabalho.

## O que você ganha imediatamente {#what-you-get}

Cada modelo vem com peças que normalmente levam meses para serem construídas:

- **Um agente funcional** — já conectado ao aplicativo, já capaz de capturar actions em seus dados, já ciente do contexto sobre o que você está vendo. Veja [Messaging the agent](/docs/messaging) para saber como funciona.
- **Auth** — login, sessões, organizações, isolamento multilocatário. Já pronto.
- **Um banco de dados** — cada modelo tem seu esquema, consultas e migrações prontos para uso. Traga seu próprio banco de dados SQL (Postgres, SQLite, Turso, D1) — a estrutura se adapta.
- **UI em tempo real** — a tela permanece sincronizada com o que o agente faz. Clique em "rascunhar um e-mail" no bate-papo e veja o rascunho aparecer na sua caixa de entrada imediatamente.
- **Pronto para implantação** — envie para Netlify, Vercel, Cloudflare, AWS ou qualquer outro lugar que execute Node. Sem dependência de fornecedor.
- **Ganchos de branding** — nome, cores, logotipo e cópia são fáceis de alterar.

Esta não é uma afirmação teórica. O autor da estrutura executa sua caixa de entrada real no modelo Mail, seu calendário real no modelo Calendário e suas análises reais no modelo Analytics. Os modelos são softwares de driver diário.

## O que você faz {#what-you-do}

O caminho de "Quero meu próprio SaaS" até "Tenho meu próprio SaaS" é curto:

```an-diagram title="Garfo e personalize" summary="Escolha um produto acabado, marque-o, desenvolva-o em inglês simples e envie-o para seu próprio domínio."
{
  "html": "<div class=\"diagram-fork\"><div class=\"diagram-card\"><span class=\"diagram-pill\">1</span><strong>Pick</strong><small class=\"diagram-muted\">a complete template</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2</span><strong>Brand</strong><small class=\"diagram-muted\">nome, cores, logo, texto</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">3</span><strong>Customize</strong><small class=\"diagram-muted\">ask the agent &#8635;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill ok\">4</span><strong>Ship</strong><small class=\"diagram-muted\">your own domain</small></div></div>",
  "css": ".diagram-fork{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.diagram-fork .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:130px}.diagram-fork .diagram-arrow{font-size:22px;line-height:1}"
}
```

1. **Escolha um modelo.** Use o seletor CLI ou navegue nos documentos e escolha um para começar.
2. **Marque.** Altere o nome, as cores, o logotipo e a cópia. A maioria dos modelos expõe isso em um único arquivo de configuração.
3. **Personalize.** Peça ao agente para adicionar a coluna que você precisa, altere a forma como os grupos de caixa de entrada, conecte-se ao seu API interno, adicione uma nova visualização. O agente edita o código; você analisa a diferença.
4. **Envie.** Execute o comando de implantação. Agora você tem seu próprio SaaS de produção em seu próprio domínio.

As etapas 2 a 4 normalmente levam dias, não meses. A etapa 3 é aberta: seu SaaS bifurcado evolui com o tempo, em inglês simples, conversando com o agente.

## Por que isso é prático {#why}

Um modelo tradicional de fork-the-codebase se decompõe em grande escala: cada usuário mantendo sua própria caixa de entrada parece um pesadelo de manutenção. Duas decisões-quadro fazem com que tudo funcione:

1. **O agente faz a manutenção.** Você não escreve código para adicionar uma coluna ou conectar uma nova integração — você pergunta ao agente. Portanto, "sua própria caixa de entrada bifurcada" é um recurso, não um fardo.
2. **Personalização por usuário sem código por usuário.** Skills, memória, instruções, servidores MCP conectados e subagentes, todos residem em SQL. Cada usuário obtém sua própria camada de personalização; a base de código compartilhada hospeda todos eles de uma vez.

O resultado: flexibilidade em nível de código Claude para cada usuário, com economia normal de implantação de SaaS.

```an-diagram title="Por que os garfos por usuário são escalonados" summary="Duas ideias mantêm prático o modelo bifurcar e personalizar: o agente faz a manutenção e a personalização por usuário reside em SQL - não no código por usuário."
{
  "html": "<div class=\"diagram-why\"><div class=\"diagram-panel\" data-rough><strong>Compartilhard codebase</strong><small class=\"diagram-muted\">um app, implantado uma vez</small><div class=\"diagram-pill accent\">agent does the maintenance</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-panel\" data-rough><strong>Camada por usuário em SQL</strong><small class=\"diagram-muted\">skills · memória · instruções · MCP · subagentes</small><div class=\"diagram-pill ok\">no per-user code</div></div></div>",
  "css": ".diagram-why{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-why .diagram-panel{display:flex;flex-direction:column;gap:8px;padding:14px 18px;min-width:240px;flex:1}.diagram-why .diagram-arrow{font-size:24px;line-height:1}"
}
```

## Não quer desembolsar? {#hosted}

Você não precisa. Cada modelo também está disponível como um aplicativo hospedado em `agent-native.com` — `mail.agent-native.com`, `calendar.agent-native.com` e assim por diante. Use a versão hospedada gratuitamente ou paga; bifurque apenas quando quiser alterar algo que a versão hospedada não expõe.

## Experimente com habilidade {#try-with-a-skill}

Não está pronto para montar o andaime? Você pode adicionar superpoderes nativos do agente a um agente de codificação que você já usa com um único comando – sem necessidade de aplicativo. Veja o [Skills Guide](/docs/skills-guide#app-backed-skills).

## Com base nisso

- [**Getting Started**](/docs/getting-started) — crie um aplicativo de bate-papo mínimo ou um agente sem cabeça
- [**Messaging the agent**](/docs/messaging) — como os usuários (e você) conversam com o agente que acompanha cada modelo
- [**Multi-App Workspace**](/docs/multi-app-workspace) — agrupa vários modelos em um espaço de trabalho que compartilha autenticação, marca e agente
- [**Dispatch**](/docs/template-dispatch) — o modelo do plano de controle do espaço de trabalho
- [**Creating Templates**](/docs/creating-templates) — crie e publique seu próprio modelo

### Para desenvolvedores {#dev-details}

Se você estiver montando um andaime agora, o comando CLI é:

```bash
npx @agent-native/core@latest create my-platform
```

Você receberá um seletor de seleção múltipla. Escolha um aplicativo (autônomo) ou vários (espaço de trabalho — os aplicativos compartilham autenticação, marca, configuração do agente e banco de dados). Cada modelo escolhido é estruturado em `apps/<name>/` com todos os arquivos que você precisa. Para um aplicativo somente de ação em vez de um modelo UI, use `npx @agent-native/core@latest create my-agent --headless`.

Preencha `.env` (principalmente `ANTHROPIC_API_KEY` e `DATABASE_URL`), `pnpm install`, `pnpm dev` e funciona. Sem "TODO: implementar login", sem rotas de espaço reservado.

Destinos de implantação: qualquer host compatível com Nitro (Node, Cloudflare, Netlify, Vercel, Deno, Lambda, Bun) e qualquer banco de dados SQL compatível com Drizzle (SQLite, Postgres, Turso, D1, Supabase, Neon). Para espaços de trabalho, `npx @agent-native/core@latest deploy` cria todos os aplicativos de uma vez e os envia para uma única origem. Consulte [Deployment](/docs/deployment).

Para criar e publicar seu próprio modelo, consulte [Creating Templates](/docs/creating-templates).
