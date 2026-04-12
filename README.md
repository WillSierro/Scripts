# Lamentosa Userscripts

Esta pasta esta focada apenas em scripts para Tampermonkey no Lamentosa.

## Scripts

- `lamentosa_boss_auto.user.js`
  Monitora a janela do boss, le o chat pela categoria/tag configurada, abre o boss, clica em `Desafiar` e depois no botao final da janela.

- `lamentosa_abre_boss.user.js`
  Clone simplificado do `Boss Auto`. Monitora o chat pela categoria/tag configurada, abre o boss, clica em `Desafiar` e depois no botao final da janela, sem selecao de sessao.

- `lamentosa_boss_join.user.js`
  Le o chat para achar o boss configurado, abre o boss e tenta clicar em `Entrar` seguindo a regra de repeticoes e a janela do timer.

- `lamentosa_dungeon_test.user.js`
  Observa o chat global e reage apenas quando `TheVamp` ou `Nuvem` abrirem `DUNGEON`. Faz alerta sonoro/falado, envia Telegram e clica no link da dungeon.

- `lamentosa_connection_guard.user.js`
  Detecta `Connection lost. Please refresh the page.` e recarrega a pagina automaticamente com cooldown para evitar loop.

## Monitor Externo

- `monitor_externo/`
  Projeto em Python para rodar no PC 24/7, separado do Tampermonkey. Reaproveita os avisos de dungeon, veneno, boss, GVG, TW e o relatorio diario de uniques via Telegram.

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

- `Abre Boss`
  Clique esquerdo reconfigura e liga.
  Clique direito liga/desliga.
  `Ctrl+Alt+A` reconfigura.

- `Boss Join`
  Clique esquerdo liga/desliga.
  Clique direito reconfigura.
  `Ctrl+Alt+J` reconfigura.
  `Ctrl+Alt+K` reseta a contagem do lobby.

- `Dungeon Alert`
  Clique esquerdo liga/desliga.
  `Ctrl+Alt+D` alterna.

- `Connection`
  Clique esquerdo liga/desliga.

## Observacoes

- As configuracoes ficam salvas no navegador, entao em geral nao precisa configurar tudo de novo a cada `F5`.
- O `Dungeon Alert` ja esta com Telegram fixo configurado.
- Se a tag de algum boss mudar no servidor, reconfigure o script correspondente.
