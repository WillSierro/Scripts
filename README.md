# Scripts

Colecao de userscripts do Tampermonkey.

## Arquivos

- `Auto_Heal.user.js`
  Curador principal. Se a vida nao estiver cheia, espera `Finished/Terminado` quando voce estiver em boss ou dungeon, vai ao templo e usa ate `2x` a cura de `50%`.

- `Boss_Auto.user.js`
  Monitora a janela do boss, le o chat pela categoria/tag configurada, abre o boss, clica em `Desafiar`, escolhe `Normal` ou `Prioridade` quando necessario e confirma o desafio.

- `Boss_Join.user.js`
  Le o chat para achar o boss configurado, abre o boss e tenta clicar em `Entrar` seguindo a regra de repeticoes e a janela do timer.

- `Connection_Guard.user.js`
  Detecta `Connection lost`, `Bad gateway` e erros parecidos, e recarrega a pagina automaticamente com cooldown.

- `Dungeon_Test.user.js`
  Observa o chat global e reage apenas quando `TheVamp` ou `Nuvem` abrirem `DUNGEON`. Faz alerta e pode enviar Telegram.

## Controles

- Verde = ativo
- Vermelho = desativado
- Os botoes aparecem empilhados na lateral direita
- Se um script estiver desligado, os outros sobem automaticamente

## Observacoes

- As configuracoes ficam salvas no navegador, entao em geral nao precisa configurar tudo de novo a cada `F5`.
- O `Dungeon_Test.user.js` ja pode trabalhar com Telegram configurado.
- Se a tag de algum boss mudar no servidor, reconfigure o script correspondente.
