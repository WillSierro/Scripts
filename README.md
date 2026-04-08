# Scripts

Colecao de userscripts do Tampermonkey focada no Lamentosa.

## Arquivos

- `Abre_Boss.user.js`
  Monitora o chat do boss, abre o boss, clica em `Desafiar` e depois no OK, sem selecao de sessao.

- `Auto_Heal.user.js`
  Curador principal. Se a vida nao estiver cheia, espera `Finished/Terminado` quando voce estiver em boss ou dungeon, vai ao templo e usa ate `2x` a cura de `50%`.

- `Auto_HP.user.js`
  Usa automaticamente o item `use-haste/20` quando ele aparecer na tela.

- `Boss_Auto.user.js`
  Monitora o chat do boss, clica no boss, em `Desafiar` e depois no OK.

- `Boss_Com.user.js`
  Abre somente os bosses que estiverem na lista configurada dentro do script.

- `Boss_Join.user.js`
  Le o chat do boss por categoria e entra automaticamente no lobby seguindo a regra `1/2/3/4`.

- `Boss_Sem.user.js`
  Abre qualquer boss que estiver fora da lista usada pelo `Boss_Com.user.js`.

- `Connection_Guard.user.js`
  Detecta `Connection lost. Please refresh the page.` e recarrega a pagina com cooldown para evitar loop.

- `Dungeon_Test.user.js`
  Entra na `DUNGEON` de `TheVamp` ou `Nuvem`, arma o veneno aos `4s` do running e ataca aos `1s`, com suporte a Telegram.

- `Teste_Dungeon.user.js`
  Script minimo para validar o clique automatico em qualquer `DUNGEON` nova que aparecer no chat.

- `Teste_Poison_Timer.user.js`
  Testa os tempos para abrir o veneno, usar, preencher a `Nuvem` e procurar sem atacar.

## Controles

- Verde = ativo
- Vermelho = desativado
- Os botoes aparecem empilhados na lateral direita
- Se um script estiver desligado, os outros ocupam o espaco livre automaticamente

## Observacoes

- As configuracoes ficam salvas no navegador, entao em geral nao precisa configurar tudo de novo a cada `F5`.
- Alguns scripts usam clique esquerdo, clique direito e atalhos para ligar, desligar ou reconfigurar.
- Se a tag ou categoria de algum boss mudar no servidor, reconfigure o script correspondente.
