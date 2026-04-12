# Monitor Externo Lamentosa

Monitor em Python para rodar no PC da casa, separado do Tampermonkey.

## O que faz

- observa o chat global
- avisa no Telegram sobre dungeon de `Nuvem` e `TheVamp`
- avisa tentativa de veneno contra `Nuvem` e `TheVamp`
- avisa boss `soldier`, `elder` e `elder2`
- avisa `GVG` com `Infernnum/Infernium`
- avisa `Tormentus War` com `Infernnum/Infernium`
- envia o relatorio de uniques uma vez por dia as `22h` `pt-BR`

## Como usar no Windows

1. Crie um ambiente virtual:

```powershell
python -m venv .venv
```

2. Ative o ambiente:

```powershell
.venv\Scripts\Activate.ps1
```

3. Instale as dependencias:

```powershell
pip install -r monitor_externo\requirements.txt
python -m playwright install chromium
```

4. Copie `monitor_externo\.env.example` para `monitor_externo\.env` e preencha:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_GROUP_CHAT_ID`
- `TELEGRAM_PRIVATE_USERNAME`

5. Faça o login uma vez no perfil persistente:

```powershell
python monitor_externo\monitor.py setup
```

6. Depois rode o monitor em segundo plano:

```powershell
python monitor_externo\monitor.py run
```

## Observacoes

- O login fica salvo no perfil do Playwright, entao nao precisa deixar senha no codigo.
- O monitor pode rodar em `headless` depois do `setup`.
- Se quiser mudar a pagina-base do monitor, altere `LAMENTOSA_MONITOR_URL` no `.env`.
