# Userscripts

## Scripts

- `Boss_Auto.user.js`
  Monitora a janela do boss, le o chat pela categoria/tag configurada, abre o boss, clica em `Desafiar` e depois no botao final da janela.

- `Boss_Join.user.js`
  Le o chat para achar o boss configurado, abre o boss e tenta clicar em `Entrar` seguindo a regra de repeticoes e a janela do timer.

- `Auto_Heal.user.js`
  E o curador principal. Se a vida nao estiver cheia, ele espera `Finished/Terminado` quando voce estiver em boss/dungeon, vai ao templo e usa ate `2x` a cura de `50%`.

- `Dungeon_Test.user.js`
  Observa o chat global e reage apenas quando `TheVamp` ou `Nuvem` abrirem `DUNGEON`. Faz alerta sonoro/falado, envia Telegram e clica no link da dungeon.

- `Connection_Guard.user.js`
  Detecta `Connection lost. Please refresh the page.` e recarrega a pagina automaticamente com cooldown para evitar loop.

## Controles visuais

- Os scripts aparecem como botoes empilhados na lateral direita.
- Verde = ativo.
- Vermelho = desativado.
- Se um script estiver desligado, os outros sobem automaticamente e ocupam o lugar dele.
- Os textos de status na tela foram removidos para nao atrapalhar a visao.

## Atalhos e cliques

- `Boss Auto`
  Clique esquerdo reconfigura e liga.
  Clique direito liga/desliga.
  `Ctrl+Alt+B` reconfigura.

- `Boss Join`
  Clique esquerdo liga/desliga.
  Clique direito reconfigura.
  `Ctrl+Alt+J` reconfigura.
  `Ctrl+Alt+K` reseta a contagem do lobby.

- `Auto Heal`
  Clique esquerdo liga/desliga.
  `Ctrl+Alt+L` alterna.

- `Dungeon Alert`
  Clique esquerdo liga/desliga.
  `Ctrl+Alt+D` alterna.

- `Connection`
  Clique esquerdo liga/desliga.

## Observacoes

- As configuracoes ficam salvas no navegador, entao em geral nao precisa configurar tudo de novo a cada `F5`.
- O `Dungeon Alert` ja esta com Telegram fixo configurado.
- Se a tag de algum boss mudar no servidor, reconfigure o script correspondente.
- O `Auto Heal` hoje e a logica principal de cura.
