# Ascended Bot — Discord Bot para RubinOT

Bot do Discord para a guilda **Ascended** no servidor RubinOT.  
Inspirado no X3TBot (bot de TS3 para guildas de Tibia OT).

---

## ⚡ Setup Rápido

### 1. Instalar dependências
```bash
npm install
```

### 2. Configurar o token do bot
Crie um arquivo `.env` na pasta raiz com o seu token do Discord:
```
BOT_TOKEN=seu_token_aqui_do_discord_developer_portal
```

**Como obter o token:**
1. Acesse https://discord.com/developers/applications
2. Clique em "New Application" e dê um nome
3. Vá em "Bot" → "Reset Token" → copie o token
4. Em "Privileged Gateway Intents", ative: **Message Content Intent** e **Server Members Intent**
5. Em "OAuth2 → URL Generator", selecione: `bot` + permissões:
   - Read Messages/View Channels
   - Send Messages
   - Embed Links
   - Read Message History
   - Manage Messages (opcional)

### 3. Iniciar o bot
```bash
node bot.js
```

---

## ⚙️ Configuração (dentro do Discord)

Após o bot estar online, use os comandos de admin no servidor:

```
!config guilda Ascended
!config mundo Auroria
!config canal-mortes #canal-de-mortes
!config canal-relatorio #relatorio-diario
!config canal-inimigos #radar
!config canal-frags #frags
```

---

## 📖 Comandos

| Comando | Descrição |
|---|---|
| `!jogador <nome>` | Busca dados de um personagem |
| `!online` | Membros da guilda online agora |
| `!mortes` | Mortes PvP do dia |
| `!top [n]` | Top XP do dia |
| `!relatorio` | Relatório diário completo |
| `!guerra` | Placar de guerra |
| `!guerrafull` | Placar acumulado |
| `!matadores` | Ranking de frags do dia |
| `!topmatadores` | Ranking histórico de frags |
| `!oraculo <nome>` | Previsão de próximo level |
| `!radar` | Inimigos online no momento |
| `!roleta <n1> <n2>...` | Sorteia entre nomes |
| `!ativaroleta` | Ativa coleta de participantes |
| `!roleta sortear` | Sorteia participantes |
| `!config` | Configuração do bot |
| `!ajuda` | Lista de comandos |
| `!ping` | Latência do bot |

**Prefixos aceitos:** `!`, `.`, `/`

---

## 🔔 Notificações Automáticas

Quando configurados, os seguintes alertas são enviados **automaticamente** nos canais escolhidos:

| Canal | Trigger |
|---|---|
| `canal-mortes` | Membro da guilda morreu em PvP |
| `canal-frags` | Membro da guilda matou alguém em PvP |
| `canal-inimigos` | Inimigo da lista de hunted ficou online |
| `canal-relatorio` | Relatório diário automático à meia-noite |
| `canal-guerra` | Membro farmou 1M+ XP no modo guerra |

---

## 📁 Estrutura

```
Discord/
├── bot.js              # Entry point
├── bot.config.json     # Config salva (gerado automaticamente)
├── .env                # Token do bot
├── commands/           # Módulos de comandos
├── modules/            # State, DB, Embeds, Scheduler
├── scraper/            # Scraper do RubinOT (Puppeteer)
└── data/               # SQLite + cache
```

---

## ⚠️ Notas

- O bot usa **Puppeteer** para fazer scraping do `rubinot.com.br` (incluindo bypass de Cloudflare)
- O primeiro scrape de mortes é silencioso (popula o cache para evitar spam)
- A guilda e o mundo são configuráveis pelo Discord sem reiniciar o bot
- O banco SQLite (`data/ascended_bot.db`) armazena histórico de mortes, frags e configurações
