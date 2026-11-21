## Visão geral

Esta página é para desenvolvedores: com o que o Claude Swap foi feito, por quê, e como as partes se encaixam. O guia de uso fica no modal **Documentação** do painel; a especificação e o registro completo de decisões ficam em `docs/architecture.md`.

O Claude Swap mantém o **Claude Code** logado na melhor de várias contas do Claude. Três ideias guiaram todas as decisões:

- **Leve e local.** Um processo Node em `127.0.0.1`, abaixo de 100 MB de memória parado. Sem banco de dados, sem Docker, sem serviço na nuvem: nada para instalar além do Node.js.
- **A ordem é a verdade.** A ordem da lista de contas é a prioridade, e trocar manualmente é só reordenar. Os modos automático e manual nunca discordam.
- **Nunca perder um token.** O Claude Code rotaciona os refresh tokens. Toda gravação é atômica, e o login ativo é sempre salvo de volta antes de ser substituído.

## Tecnologias

| Camada | Tecnologia | Por quê |
| --- | --- | --- |
| Runtime | **Node.js 24** | Já traz `fetch`, `CompressionStream`, `AbortSignal.timeout` e APIs de arquivo, então o servidor precisa de pouquíssimas dependências. |
| HTTP | **Hono** + `@hono/node-server` | Poucos kB, rápido e tipado de ponta a ponta: o app web chama a API pelo cliente RPC do Hono, sem geração de código. Escolhido no lugar do Next.js porque um serviço sempre ligado precisa ser pequeno e um único painel não precisa de SSR. |
| Validação | **zod 4** | Toda fronteira (arquivos de configuração, arquivos do Claude Code, respostas da Anthropic, corpos de requisição) é validada, nunca confiada. Codecs convertem strings ISO em `Date` e de volta. |
| Build | **tsup** (servidor), **Vite** (web) | O tsup empacota o servidor e suas dependências em um arquivo só, então o serviço não precisa de `node_modules`. O Vite dá HMR no desenvolvimento e arquivos com hash, cacheáveis, em produção. |
| UI | **React 19** | Maduro, conhecido, e o ecossistema abaixo foi feito para ele. |
| Rotas | **TanStack Router** | Rotas em código com tipos. Os modais são rotas, então dá para linkar e o botão voltar funciona. |
| Estado do servidor | **TanStack Query** | Polling, cache, mutações otimistas com rollback e pausa enquanto a aba está escondida. |
| Estilo | **Tailwind CSS v4** + **shadcn/ui** (Base UI) | Tokens de design do `DESIGN.md` como variáveis CSS, temas claro e escuro, componentes acessíveis que são código nosso. |
| Gráficos / arrastar | **Recharts** (chart do shadcn), **dnd-kit** | As duas bibliotecas de UI mais pesadas, ambas carregadas sob demanda, fora do bundle inicial. O dnd-kit traz arrastar pelo teclado e anúncios para leitores de tela. |
| i18n | **use-intl** | Mensagens ICU (plurais, tempo relativo) em `en`, `es` e `pt-BR`, com chaves tipadas. |
| Qualidade | **TypeScript 7** (strict), **Biome**, **Vitest**, **Testing Library**, **Playwright** | Uma ferramenta rápida para lint e formatação; testes unitários, de integração e ponta a ponta sem contas reais. |

## Arquitetura

O código segue uma **arquitetura hexagonal** (ports and adapters). As dependências apontam para dentro:

```
web ──(só tipos)──▶ server ──▶ application ──▶ domain
                       │             ▲
                       └──▶ infrastructure (implementa os ports da application)
```

- **domain** — TypeScript puro: contas, janelas de uso, a política de rotação, ordenação. Sem I/O, sem Node, sem React, 100 % de cobertura de testes.
- **application** — o motor e os casos de uso. Fala com o mundo externo só por **ports** (interfaces em `ports.ts`): repositórios, a sessão do Claude Code, a API da Anthropic, relógio, logger, mutex.
- **infrastructure** — **adapters** que implementam esses ports: repositórios em arquivos JSON, os arquivos do Claude Code, o cliente HTTP da Anthropic, o relógio e o logger do sistema.
- **server** — a **composition root** (`container.ts`, o único lugar que instancia adapters), as rotas Hono e os mapeadores de DTO.
- **web** — a SPA React. Importa código do servidor só como tipos, para tipar o cliente RPC.

Essas regras não são só convenção: o `src/architecture.test.ts` varre todos os imports e quebra o build quando uma camada acessa o que não deve. O tempo é injetado pelo port `Clock`, então o código de negócio nunca chama `Date.now()` e todo cenário pode ser testado.

## Estrutura do projeto

```
src/
  domain/          account, usage, rotation-policy, ordering, preferences, errors
  application/     ports.ts, engine.ts, use-cases/, testing/ (fakes em memória)
  infrastructure/
    fs/            gravação atômica, arquivo JSON versionado, migrações, caminhos
    repositories/  repositórios de config, secrets e state + schemas zod
    claude-code/   lê e grava os arquivos de login do Claude Code
    anthropic/     endpoint de uso e renovação de token OAuth
    system/        relógio, logger JSON com mascaramento, mutex de promises
  server/          main.ts, cli.ts, container.ts, app.ts (rotas), dto.ts
  web/             router, providers, features/, components/ui (shadcn), lib/, i18n/
tests/e2e/         specs Playwright, fixtures com HOME temporário, servidor Anthropic falso
deploy/            template da unit systemd de usuário
scripts/           instalar/desinstalar o serviço, orçamento de desempenho
```

Os testes unitários ficam ao lado do código que testam (`foo.ts` → `foo.test.ts`).

## O motor

O motor roda um **tick** a cada intervalo de verificação (3 minutos por padrão). Um tick trabalha numa cópia em memória da configuração e do estado e salva tudo uma vez no final:

1. **Sincroniza de volta** — lê o login ativo do Claude Code. Se for uma das nossas contas, guarda os tokens (o Claude Code pode tê-los rotacionado). Um login desconhecido pausa as trocas até ser importado.
2. **Renova** — os tokens das contas inativas são nossos: renova os que expiram nos próximos 10 minutos. Os tokens da conta ativa são do Claude Code e nunca são renovados por nós, para não competir com a rotação dele.
3. **Consulta** — busca o uso de cada conta habilitada, duas por vez. Um 401 numa conta inativa dispara uma renovação e uma nova tentativa; um 429 põe aquela conta em espera.
4. **Decide** — a função pura `selectActiveAccount` escolhe a conta que deve ficar ativa.
5. **Troca** — se não for a ativa, sincroniza os tokens ativos de novo, grava o login da conta escolhida nos arquivos do Claude Code e registra a troca.

Ticks e mutações da API dividem um **mutex**, então nunca se misturam. Chamadas a `runNow()` têm **debounce** (250 ms), então vários cliques viram um tick só. Todo tick agenda o próximo um intervalo inteiro depois, então **Forçar verificação** reinicia a contagem. Ele chama `checkNow()`, que aproveita um tick já em andamento em vez de enfileirar um segundo logo atrás. Reordenar, Usar agora e habilitar chamam `runNow()`: precisam de um tick que comece depois da mudança.

## Integração com o Claude Code

No Linux, o Claude Code guarda o login em dois arquivos:

| Arquivo | Chave que é nossa | Conteúdo |
| --- | --- | --- |
| `~/.claude/.credentials.json` | `claudeAiOauth` | access token, refresh token, validade, escopos |
| `~/.claude.json` | `oauthAccount` | UUID da conta, e-mail, organização |

Uma troca substitui só essas duas chaves e mantém todas as outras exatamente como estavam. Os dois arquivos são lidos e validados antes de qualquer gravação, então um arquivo malformado nunca é sobrescrito. Os originais são copiados uma vez, antes da primeira gravação. Uma troca "rasgada" (credenciais de uma conta sob a identidade de outra) é detectada e regravada por inteiro.

## Persistência

Não há banco de dados: três arquivos JSON em `~/.config/claude-swap` guardam tudo.

- `config.json` — preferências e contas. A ordem do array é a prioridade.
- `secrets.json` — tokens OAuth por conta, modo `0600`, separados para que a configuração possa ser aberta ou compartilhada com segurança.
- `state.json` — o último uso de cada conta, o histórico de uso e o registro de atividades.

Todo arquivo tem um campo `version` e uma cadeia de migrações, e é validado com zod. As gravações são **atômicas**: arquivo temporário → fsync → rename → fsync da pasta. Um arquivo que não pode ser lido é renomeado para `*.corrupt-<hora>` e substituído pelos padrões, em vez de derrubar o serviço.

O histórico é limitado **por tempo, não por quantidade**: um ponto por conta a cada 3 minutos nas últimas 24 horas, um a cada 15 minutos até 7 dias. O tamanho fica o mesmo seja qual for o intervalo de verificação ou o número de contas.

## API HTTP

| Rota | Para quê |
| --- | --- |
| `GET /api/dashboard` | Preferências, contas com status, último uso, atividades, status do motor |
| `GET /api/history` | Histórico de uso para o gráfico |
| `GET /api/accounts/current` | Com qual conta o Claude Code está logado agora |
| `POST /api/accounts/import` | Importa o login atual do Claude Code |
| `PUT /api/accounts/order` | Reordena (troca manual) |
| `POST /api/accounts/:id/promote` | Usar agora: move para o topo |
| `PATCH /api/accounts/:id` | Renomeia, habilita ou desabilita |
| `DELETE /api/accounts/:id` | Remove uma conta e seus tokens |
| `GET`/`PATCH /api/preferences` | Lê ou altera as configurações |
| `POST /api/engine/run` | Força uma verificação (aproveita uma já em andamento); responde quando ela termina |

As rotas são finas: validam a entrada com zod, chamam um caso de uso e mapeiam o resultado para um DTO. Os mapeadores de DTO escolhem cada campo explicitamente, então tokens nunca chegam ao navegador (um teste garante isso). Toda resposta passa por uma **proteção de Host/Origin** (contra DNS rebinding e CSRF), uma Content-Security-Policy restrita à mesma origem e compressão **gzip**. O `index.html` recebe o tema e o idioma salvos, então a página nunca pisca no tema errado.

## App web

- **Uma tela e rotas de modal.** `/settings`, `/docs`, `/accounts/new` e `/accounts/:id/remove` abrem sobre o painel. Esta página (`/docs-dev`) é a única página inteira fora dele, aberta pelo ícone de código ao lado do botão de fechar do modal de Documentação.
- **Polling.** O painel é buscado a cada 10 segundos enquanto a aba está visível. O histórico só muda quando o motor termina uma verificação, então a consulta dele usa `engine.lastTickAt` como chave e é buscada uma vez por verificação.
- **Atualizações otimistas.** Reordenar, Usar agora, habilitar e as configurações atualizam o cache na hora, desfazem com um aviso se a requisição falhar e buscam de novo quando terminam.
- **Orçamento do bundle.** O JavaScript inicial precisa ficar abaixo de 200 kB gzip. Os modais, o gráfico, o arrastar e o menu de idioma são chunks carregados sob demanda.
- **i18n e temas.** Todo texto fica em `i18n/messages/{en,es,pt-BR}.json` (um teste confere que todos os idiomas têm as mesmas chaves). Os temas claro e escuro vêm dos tokens do `DESIGN.md`.
- **Acessibilidade.** Suporte completo a teclado, arrastar pelo teclado, anúncios para leitores de tela, contraste WCAG AA nos dois temas, `prefers-reduced-motion`.

## Padrões de projeto

| Padrão | Onde |
| --- | --- |
| Ports and adapters | interfaces em `application/ports.ts`, implementadas em `infrastructure/` |
| Composition root / injeção de dependência | `server/container.ts`; os testes passam fakes por `overrides` |
| Repository | `JsonConfigRepository`, `JsonSecretsRepository`, `JsonStateRepository` |
| Casos de uso como funções | `application/use-cases`: funções simples sobre um objeto `deps` |
| Política pura | `domain/rotation-policy.ts`: mesma entrada, mesma escolha, testada com tabelas |
| Unit of work | um tick do motor edita uma cópia do estado e salva uma vez |
| Mapeador de DTO | `server/dto.ts`, o único caminho dos dados do servidor até o navegador |
| Mutex e debounce | um mutex assíncrono para ticks e mutações; `runNow()` junta rajadas |
| Rotas como modais | `components/route-modal.tsx` |
| UI otimista | `useDashboardMutation` em `web/lib/query.ts` |

## Testes e qualidade

| Nível | Ferramentas | O que cobre |
| --- | --- | --- |
| Domínio | Vitest | tabelas da política de rotação, regras de limite e reset (100 % de cobertura) |
| Aplicação | Vitest + fakes em memória | cenários do motor, sincronização, regras de renovação, casos de uso |
| Infraestrutura | Vitest + pastas temporárias + `fetch` simulado | gravação atômica, preservação de chaves, migrações, leitura tolerante |
| Servidor | Vitest + `app.request()` | rotas, validação, proteções, compressão, DTOs sem segredos |
| Web | Vitest + Testing Library | telas, modais, atualizações otimistas, paridade de idiomas |
| Ponta a ponta | Playwright + API Anthropic falsa | importar, reordenar, troca automática, voltar a subir, erros, acessibilidade (axe) |

Os testes nunca tocam o `~/.claude` ou o `~/.config/claude-swap` reais: apontam `HOME`, `CLAUDE_CONFIG_DIR` e `CLAUDE_SWAP_HOME` para pastas temporárias e as URLs da Anthropic para um servidor falso. O `npm run check` (lint, tipos, testes) precisa passar antes de todo commit, e o `npm run perf:budget` confere o tamanho do bundle e a memória parada.

## Como foi desenvolvido

1. **Especificação primeiro.** O `docs/architecture.md` descreve o objetivo, o runtime, a integração com o Claude Code, a estrutura e o modelo de segurança antes de qualquer código.
2. **Tarefas pequenas.** O trabalho foi dividido em treze tarefas (`docs/tasks/T01`–`T13`): base do projeto, domínio, persistência, adapter do Claude Code, cliente da Anthropic, motor, servidor, base da web, painel, modais, testes ponta a ponta, implantação e uma revisão final.
3. **Guiado por testes.** Cada tarefa seguiu vermelho → verde → refatorar, e toda correção de bug começa com um teste que falha.
4. **Decisões por escrito.** Tudo o que a especificação não cobria foi registrado com o motivo no log de decisões (`docs/architecture.md` §9).
5. **Pronto para agentes.** O `AGENTS.md` tem as regras para qualquer agente de código; um grafo de conhecimento (`graphify`) ajuda a navegar no código.

## Mantendo esta página atualizada

Esta página e o `README.md` descrevem o sistema como ele é. Uma mudança nas tecnologias, na estrutura, na API, no motor ou nos arquivos de dados precisa atualizar os dois na mesma mudança (a regra está no `AGENTS.md`). Abra pelo ícone de código no modal de Documentação ou em `/docs-dev`. Ela segue o idioma escolhido no app.
