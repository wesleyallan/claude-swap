## Visão geral

O **Claude Swap** mantém o **Claude Code** conectado à melhor de várias contas do Claude (claude.ai).

Você adiciona suas contas e as ordena por prioridade. Um pequeno serviço em segundo plano mantém exatamente uma delas ativa no Claude Code e:

- **desce** para a próxima conta quando a ativa atinge o limite de **5 horas** ou **semanal**;
- **volta a subir** para uma conta de prioridade maior assim que o limite dela reinicia;
- permite **trocar manualmente** com **Usar agora** ou reordenando a lista.

Tudo roda na sua máquina: um processo ligado a `127.0.0.1`, arquivos JSON para o estado, sem banco de dados e sem telemetria. Este painel é opcional — o motor continua funcionando sem nenhum navegador aberto.


## Leve por natureza

O Claude Swap existe para simplificar a vida de quem desenvolve, não para virar mais uma coisa para manter.

- **Nada extra para instalar**: só o Node.js e o próprio app. Sem banco de dados, sem Docker, sem fila, sem conta na nuvem.
- **Um processo pequeno**: o motor, a API e este painel dividem um único processo Node que fica abaixo de 100 MB de memória parado.
- **Arquivos simples**: configurações e estado são arquivos JSON que você pode ler (e copiar) à mão.
- **Só local**: escuta em `127.0.0.1`, conversa apenas com os endpoints da própria Anthropic e não envia telemetria.

Instale uma vez, adicione suas contas e esqueça que ele existe.

## Primeiros passos

1. Em um terminal, rode `claude`, depois `/login` e entre com a primeira conta.
2. Aqui, clique em **Adicionar conta**, dê um nome se quiser e clique em **Importar login atual**.
3. Repita para cada conta que o Claude Swap deve gerenciar.
4. Arraste as contas para a ordem que preferir. A primeira é usada antes.

> Troque de conta no Claude Code com `/login`, **nunca com `/logout`**: sair pode revogar o acesso que o Claude Swap guarda para aquela conta.

## O painel

- **Conta ativa** — a conta que o Claude Code está usando agora. A aba do navegador também mostra o nome dela.
- **Próximo reset** — quando a próxima janela de 5 horas ou semanal de qualquer conta reinicia.
- **Trocas em 24 h** — quantas trocas automáticas ou manuais aconteceram no último dia.
- **Motor** — *Automático* troca ao atingir limites, *Manual* fica na primeira conta, *Pausado* significa que o Claude Code está logado em uma conta que não está na sua lista.
- **Uso ao longo do tempo** — uso de 5 horas das últimas 24 horas e uso semanal dos últimos 7 dias, uma linha por conta.
- **Contas por prioridade** — cada conta com as barras de uso de 5 horas e semanal, horários de reinício e status.

O status do motor ao lado do logo mostra quando será a próxima verificação.

## Prioridade e trocas

A ordem da lista **é** a prioridade. A conta ativa é a primeira que:

- está **habilitada**;
- não **requer novo login**;
- não **atingiu um limite**.

Quando a conta ativa atinge um limite, a próxima conta elegível assume. Quando a janela de uma conta acima reinicia, o Claude Swap volta para ela. Se todas as contas estiverem no limite, ele escolhe a que libera primeiro.

**Usar agora** move uma conta para o topo, o que a torna ativa. Arrastar (mouse ou teclado) e os botões subir/descer mudam a ordem do mesmo jeito. O interruptor de cada cartão desativa uma conta sem removê-la.

## Limites e verificações

Cada conta tem duas janelas de uso, medidas pela Anthropic:

| Janela | Significado |
| --- | --- |
| **5 h** | Limite de sessão móvel de cinco horas |
| **7 d** | Limite semanal |

Uma conta conta como *limite atingido* quando qualquer janela está no limiar ou acima (95 % e 98 % por padrão) e ainda não reiniciou. Trocar um pouco antes de 100 % evita que um prompt em andamento bata no limite real.

A cada **intervalo de verificação** (3 minutos por padrão) o motor lê o uso de cada conta, renova os tokens das contas inativas antes que expirem e escolhe a conta ativa de novo. Mudar a ordem, habilitar uma conta ou clicar em **Usar agora** roda uma verificação na hora. O botão **Forçar verificação** (a seta circular na barra superior) faz o mesmo quando você quiser e reinicia a contagem do intervalo, então duas verificações nunca rodam em seguida.

## Configurações

| Opção | O que faz |
| --- | --- |
| **Tema** | Claro, escuro ou seguir o sistema |
| **Idioma** | English, Español ou Português (Brasil) |
| **Trocar automaticamente** | Desligado, o Claude Code fica na primeira conta até você mudar a ordem |
| **Limite de 5 horas (%)** | Percentual da janela de 5 horas que dispara uma troca (50–100) |
| **Limite semanal (%)** | O mesmo, para a janela semanal (50–100) |
| **Verificar a cada (segundos)** | Com que frequência o uso é consultado (60–3600) |

## Sessões abertas

Uma troca grava o login da conta escolhida nos arquivos do Claude Code (`~/.claude/.credentials.json` e `~/.claude.json`), preservando todas as outras chaves.

- **Sessões novas** sempre começam com a conta ativa.
- **Sessões abertas** trocam quando o Claude Code lê as credenciais de novo — por exemplo, ao renovar o token ou quando uma requisição é recusada. Sua conversa continua onde estava.
- Se um prompt bater no limite antes da troca, o Claude Code interrompe aquele turno com uma mensagem de limite. Depois da troca, envie `continue` (ou repita o pedido) na mesma sessão.

Manter os limiares abaixo de 100 % faz a troca acontecer antes do limite real, então isso é raro.

## Solução de problemas

- **Requer novo login** — o token salvo parou de funcionar. Rode `/login` com essa conta e importe de novo.
- **A troca automática está pausada** — o Claude Code está logado em uma conta que não está na sua lista. Importe-a, ou faça `/login` com uma das suas.
- **A última verificação do motor falhou** — não foi possível ler o uso (rede, limite de requisições). O motor tenta de novo na próxima verificação.
- **Servidor inacessível** — o serviço está parado. Verifique com `systemctl --user status claude-swap` e veja os logs com `journalctl --user -u claude-swap -f`.

## Privacidade e segurança

- O servidor escuta apenas em `127.0.0.1` e recusa requisições de outros sites.
- Os tokens OAuth ficam no disco (modo `0600`). Nunca são enviados ao navegador nem registrados em logs.
- As únicas chamadas externas vão para os endpoints de uso e de tokens da Anthropic. Sem telemetria.
- Os arquivos ficam em `~/.config/claude-swap` (ou `$CLAUDE_SWAP_HOME`). Nunca compartilhe `secrets.json`.

## Sobre mim

Oi, eu sou o **Wesley Silva** (wesleyallan), o desenvolvedor do Claude Swap.

Obrigado por usar o meu software! Eu o criei para parar de perder o raciocínio toda vez que um limite acabava, e espero que ele te poupe desse problema também.

Se o Claude Swap te ajuda, **deixe uma ⭐ no projeto no [GitHub](https://github.com/wesleyallan/claude-swap)**. Isso ajuda outras pessoas a encontrá-lo e me motiva a continuar melhorando. Relatos de bugs e ideias também são bem-vindos por lá.

Me encontre em:

- [GitHub](https://github.com/wesleyallan)
- [LinkedIn](https://www.linkedin.com/in/wesley-silva-229724208/)
- [Instagram](https://www.instagram.com/wesleyallansilva)
- [Facebook](https://facebook.com/wesley.allansilva)
- [Discord](https://discord.gg/hQN2k8N6jf)
- [E-mail](mailto:wesley.allansilva@gmail.com)
