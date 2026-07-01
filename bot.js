'use strict';

// ─── Dependências ─────────────────────────────────────────────────────────────
require('dotenv').config();

let isShuttingDown = false;

const fs   = require('fs');
const path = require('path');
const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
    EmbedBuilder,
} = require('discord.js');

const db        = require('./modules/database');
const battlestormSync = require('./scraper/battlestormSync');
const state     = require('./modules/state');
const scheduler = require('./modules/scheduler');
const voiceManager = require('./modules/voiceManager');

const RPG_COMMANDS = new Set([
    'atacar', 'construir', 'desequipar', 'duelar', 'equipar', 
    'forceboss', 'forceinvasion', 'forjar', 'inventario', 'loja', 
    'masmorra', 'materiais', 'pets', 'profissao', 'refinar', 
    'rpg-perfil', 'rpg-registrar', 'rpg-wiki', 'taverna', 'templo'
]);

// Pre-requiring modules to prevent interaction timeouts on first load
const ptManager = require('./modules/ptManager');
const claimPanelManager = require('./modules/claimPanelManager');
const registerManager = require('./modules/registerManager');
const ticketManager = require('./modules/ticketManager');
const planilhadoManager = require('./modules/planilhadoManager');
const taxManager = require('./modules/taxManager');
const loja = require('./commands/loja');
const sorteio = require('./commands/sorteio');

// ─── Configuração do bot ──────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'bot.config.json');

function loadConfig() {
    // Carregar do banco de dados (tem prioridade)
    const dbConfig = db.loadAllConfig();

    // Fallback: arquivo JSON local
    let fileConfig = {};
    if (fs.existsSync(CONFIG_PATH)) {
        try { fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* ignore */ }
    }

    const defaultKeys = [
        'guildName', 'worldName', 'enemyGuildName', 'deathChannelId', 'reportChannelId',
        'enemyChannelId', 'fragChannelId', 'warChannelId', 'warMode', 'adminRoleId',
        'cargoClaim90', 'cargoClaim180', 'claimCommandsChannelId', 'claimsPanelChannelId',
        'panelMessageId', 'cleanChannelId', 'claimsPaused', 'voiceGeneratorChannelId',
        'registrationChannelId', 'warScoreboardChannelId', 'warScoreboardMessageId',
        'onlineGuildChannelId', 'onlineEnemyChannelId', 'enemyHuntingChannelId',
        'enemyHuntingMessageId', 'allyHuntingChannelId', 'allyHuntingMessageId', 'warVoiceChannelId', 'levelUpChannelId',
        'protectedVoiceChannelIds', 'ticketCategoryId', 'ticketSupportRoleId',
        'ticketPanelChannelId', 'ticketPanelMessageId', 'ticketLogChannelId',
        'planilhadoCategoryId', 'planilhadoRequestChannelId', 'planilhadoAdminChannelId',
        'planilhadoListChannelId', 'announcementChannelId', 'taxEnabled', 'taxValue',
        'taxPlanilhadoValue', 'taxTargetChar', 'taxCycleDays', 'taxAuditChannelId',
        'taxPanelChannelId', 'cargoTaxa', 'guildBankName', 'whatsappMassLogEnabled'
    ];

    const config = {};
    defaultKeys.forEach(k => {
        if (dbConfig[k] !== undefined && dbConfig[k] !== null) {
            config[k] = dbConfig[k];
        } else if (fileConfig[k] !== undefined && fileConfig[k] !== null) {
            config[k] = fileConfig[k];
        } else {
            config[k] = null;
        }
    });

    if (config.warMode === null) config.warMode = 'false';
    if (config.claimsPaused === null) config.claimsPaused = 'false';
    if (config.taxEnabled === null) config.taxEnabled = 'false';
    if (config.whatsappMassLogEnabled === null) config.whatsappMassLogEnabled = 'true';
    if (config.taxValue === null) config.taxValue = '500 RC';
    if (config.taxPlanilhadoValue === null) config.taxPlanilhadoValue = '1000 RC';
    if (config.taxTargetChar === null) config.taxTargetChar = 'Bank Ascended';
    if (config.taxCycleDays === null) config.taxCycleDays = '7';
    if (config.protectedVoiceChannelIds === null) config.protectedVoiceChannelIds = '';

    return config;
}

function saveConfig(cfg) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    } catch (e) {
        console.error('[Config] Erro ao salvar bot.config.json:', e.message);
    }
}

let botConfig = loadConfig();

// Sync warMode do config para o state
state.warMode = botConfig.warMode === 'true';

// ─── Cliente Discord ──────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    rest: {
        timeout: 60000,
    },
});

// ─── Carregar Comandos ────────────────────────────────────────────────────────
const commands = new Collection();
const xpCooldowns = new Set();
const COMMANDS_DIR = path.join(__dirname, 'commands');

fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.js')).forEach(file => {
    const cmd = require(path.join(COMMANDS_DIR, file));
    commands.set(cmd.name, cmd);
    (cmd.aliases || []).forEach(alias => commands.set(alias, cmd));
    console.log(`[Bot] Comando carregado: ${cmd.name} (aliases: ${(cmd.aliases || []).join(', ') || 'nenhum'})`);
});

client.commands = commands;

// ─── Prefixos ─────────────────────────────────────────────────────────────────
const PREFIXES = ['!', '.', '/'];

function parseCommand(content) {
    for (const prefix of PREFIXES) {
        if (content.startsWith(prefix)) {
            const body  = content.slice(prefix.length).trim();
            const parts = body.split(/\s+/);
            const name  = parts[0].toLowerCase();
            const args  = parts.slice(1);
            return { name, args };
        }
    }
    return null;
}

// ─── Verificação de Admin ─────────────────────────────────────────────────────
function isAdmin(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    if (member.permissions.has('ManageGuild'))   return true;
    
    const guildId = member.guild?.id;
    const config = db.getGuildConfigMerged(guildId);
    const adminRoleId = config.adminRoleId;
    if (adminRoleId && member.roles.cache.has(adminRoleId)) return true;
    return false;
}

// ─── Fuzzy command matching ───────────────────────────────────────────────────
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

const ALL_COMMAND_NAMES = [...new Set([...commands.keys()])];

function findClosestCommand(input) {
    let best = null, bestDist = Infinity;
    for (const name of ALL_COMMAND_NAMES) {
        const dist = levenshtein(input, name);
        if (dist < bestDist) { bestDist = dist; best = name; }
    }
    const maxLen = Math.max(input.length, (best || '').length);
    const similarity = maxLen > 0 ? ((maxLen - bestDist) / maxLen) * 100 : 0;
    return { command: best, similarity };
}

// ─── Evento: Ready ────────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`[Bot] ✅ Conectado como: ${client.user.tag}`);
    console.log(`[Bot] Guilda configurada: ${botConfig.guildName || '(não definida)'}`);
    console.log(`[Bot] Mundo configurado:  ${botConfig.worldName || '(não definido)'}`);

    client.user.setPresence({
        status: 'online',
        activities: [{ name: `${botConfig.guildName || 'Ascended'} | !ajuda`, type: 0 }],
    });

    // Registra todas as guildas ativas no banco de dados e configura canais do Bastião para cada uma
    client.guilds.cache.forEach(async (guild) => {
        db.addGuild(guild.id, guild.name);
        await setupAethelgardChannels(guild).catch(err => {
            console.error(`[Bot] Erro ao configurar canais do Bastião para guilda ${guild.name}:`, err.message);
        });
    });

    // Inicia os scrapers e notificações automáticas
    await scheduler.init(client, botConfig);
    voiceManager.init(client, botConfig);

    // Contribui com dados de highscore para o BattleStorm
    battlestormSync.start().catch(e => console.error('[BattleStorm] Falha ao iniciar sync:', e.message));

    // Inicializa o cliente WhatsApp
    const whatsapp = require('./modules/whatsapp');
    whatsapp.init(client);
});

client.on('guildCreate', async (guild) => {
    console.log(`[Bot] Entrou no servidor: ${guild.name} (${guild.id})`);
    db.addGuild(guild.id, guild.name);
    await setupAethelgardChannels(guild).catch(err => {
        console.error(`[Bot] Erro ao configurar canais do Bastião para guilda recém-adicionada ${guild.name}:`, err.message);
    });
});

client.on('guildDelete', async (guild) => {
    console.log(`[Bot] Saiu do servidor: ${guild.name} (${guild.id})`);
    db.removeGuild(guild.id);
});

// ─── Evento: Message ──────────────────────────────────────────────────────────
client.on('messageCreate', async (msg) => {
    const guildId = msg.guildId;
    await state.guildLocalStorage.run({ guildId }, async () => {
        const config = db.getGuildConfigMerged(guildId);
        
        const saveConfigForGuild = (updatedConfig) => {
            if (guildId) {
                for (const [k, v] of Object.entries(updatedConfig)) {
                    db.setGuildConfig(guildId, k, v);
                }
            } else {
                saveConfig(updatedConfig);
            }
        };

        // Se for uma mensagem enviada por este próprio bot no canal limpo, agendar deleção após 5 segundos
        if (msg.author.id === client.user.id) {
            if (config.cleanChannelId && msg.channelId === config.cleanChannelId) {
                setTimeout(async () => {
                    try {
                        // Busca a versão mais atual da mensagem para obter os embeds preenchidos
                        const freshMsg = await msg.channel.messages.fetch(msg.id).catch(() => null);
                        if (!freshMsg) return;

                        const hasPanelTitle = freshMsg.embeds?.[0]?.title === '📊 PAINEL DE RESPAWNS EM TEMPO REAL';
                        const isPanelMessage = (config.panelMessageId && freshMsg.id === config.panelMessageId) || hasPanelTitle;
                        if (!isPanelMessage) {
                            await freshMsg.delete().catch(() => {});
                        }
                    } catch (e) { /* ignore */ }
                }, 5000);
            }
            return;
        }

        if (msg.author.bot) return;

        // Gamification: conceder XP por mensagem de texto
        const userId = msg.author.id;
        const reg = db.getRegisteredMember(userId);
        if (reg && !xpCooldowns.has(userId)) {
            xpCooldowns.add(userId);
            setTimeout(() => xpCooldowns.delete(userId), 60000);

            const xpToAward = Math.floor(Math.random() * 11) + 15; // 15 a 25 XP
            db.addGuildXp(userId, xpToAward, msg.guild);
        }

        const parsedCmd = parseCommand(msg.content);
        const isCommand = parsedCmd && (commands.has(parsedCmd.name) || ['ajuda', 'help', 'comandos'].includes(parsedCmd.name));

        // Auto-clean channels: delete human messages immediately (unless it's a valid command)
        const isCleanChannel = msg.channelId === config.cleanChannelId || msg.channelId === config.claimsPanelChannelId;
        if (isCleanChannel && !isCommand) {
            msg.delete().catch(() => {});
            return;
        }

        // Auto-clean non-commands in the commands channel (delete after 5s)
        if (config.claimCommandsChannelId && msg.channelId === config.claimCommandsChannelId) {
            if (!isCommand) {
                setTimeout(() => msg.delete().catch(() => {}), 5000);
                return;
            }
        }

        // Hook da roleta para coletar participantes
        const roletaCmd = commands.get('roleta');
        if (roletaCmd?.onMessage) roletaCmd.onMessage(msg);

        let parsed = parseCommand(msg.content);
        
        // Support sending tax via DM by just uploading an image with "taxa" or "taxa-paga" in the caption
        if (!msg.guild && !parsed && msg.attachments.size > 0) {
            const lowerContent = msg.content.toLowerCase();
            if (lowerContent.includes('taxa') || lowerContent.includes('paga')) {
                parsed = { name: 'taxa-paga', args: [] };
            }
        }

        if (!parsed) return;

        const { name, args } = parsed;

        console.log(`[Bot] Comando prefixado recebido: !${name} com argumentos: [${args.join(', ')}] de ${msg.author.tag} (${msg.author.id}) no canal ${msg.channelId}`);

        // Ajuda geral
        if (name === 'ajuda' || name === 'help' || name === 'comandos') {
            const cmd = commands.get('ajuda');
            if (cmd) {
                try {
                    await cmd.execute(msg, args, {
                        client,
                        config,
                        saveConfig: saveConfigForGuild,
                    });
                } catch (err) {
                    console.error('[Bot] Erro ao executar ajuda:', err.message);
                }
                return;
            }
        }

        const cmd = commands.get(name);

        if (!cmd) {
            // Sugere o comando mais próximo
            const { command, similarity } = findClosestCommand(name);
            if (command && similarity >= 60) {
                return msg.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF8C00)
                            .setTitle('❓ Comando não encontrado')
                            .setDescription(`Você quis dizer **\`!${command}\`**? _(similaridade: ${similarity.toFixed(0)}%)_\nUse **\`!ajuda\`** para ver todos os comandos.`)
                            .setFooter({ text: 'Ascended Bot • RubinOT' })
                            .setTimestamp()
                    ]
                });
            }
            return; // Ignora silenciosamente se não for parecido com nada
        }

        // RPG Minigame Deactivation Check
        if (RPG_COMMANDS.has(cmd.name) && !state.rpgMinigameEnabled) {
            return msg.reply('⚠️ O minigame de RPG está temporariamente desativado.');
        }

        // Restrição de Canal para Comandos de Claim
        const isClaimCmd = ['claim', 'liberar', 'respawns', 'extend', 'next', 'listahunts'].includes(cmd.name);

        if (isClaimCmd && config.claimCommandsChannelId && msg.channelId !== config.claimCommandsChannelId) {
            try {
                const errorMsg = await msg.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF4444)
                            .setTitle('🚫 Canal Incorreto')
                            .setDescription(`Os comandos de reserva só podem ser usados no canal <#${config.claimCommandsChannelId}>.`)
                            .setFooter({ text: 'Ascended Bot • RubinOT' })
                            .setTimestamp()
                    ]
                });
                setTimeout(() => {
                    msg.delete().catch(() => {});
                    errorMsg.delete().catch(() => {});
                }, 5000);
            } catch { /* ignore */ }
            return;
        }

        // Verifica permissão de admin
        if (cmd.adminOnly && !isAdmin(msg.member)) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Acesso Negado')
                        .setDescription('Apenas administradores podem usar este comando.')
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                        .setTimestamp()
                ]
            });
        }

        try {
            await cmd.execute(msg, args, {
                client,
                config,
                saveConfig: saveConfigForGuild,
            });
            if (isClaimCmd || (config.cleanChannelId && msg.channelId === config.cleanChannelId)) {
                setTimeout(() => msg.delete().catch(() => {}), 5000);
            }
        } catch (err) {
            console.error(`[Bot] Erro no comando "${name}":`, err.message, err.stack);
            msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('❌ Erro Interno')
                        .setDescription('Ocorreu um erro ao executar o comando. Tente novamente.')
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                        .setTimestamp()
                ]
            }).catch(() => {});
        }
    });
});

// ─── Evento: Interaction (Slash Commands) ─────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    const guildId = interaction.guildId;
    await state.guildLocalStorage.run({ guildId }, async () => {
        const config = db.getGuildConfigMerged(guildId);
        
        const saveConfigForGuild = (updatedConfig) => {
            if (guildId) {
                for (const [k, v] of Object.entries(updatedConfig)) {
                    db.setGuildConfig(guildId, k, v);
                }
            } else {
                saveConfig(updatedConfig);
            }
        };

        console.log(`[Interaction] Received: type=${interaction.type} | customId=${interaction.customId || 'N/A'} | user=${interaction.user?.tag || 'Unknown'}`);
        if (interaction.isButton()) {
            const customId = interaction.customId;
            if (customId.startsWith('pt_')) {
                try {
                    await ptManager.handleButton(interaction);
                } catch (err) {
                    console.error('[Interaction] Error handling PT button:', err.message);
                }
            } else if (customId.startsWith('claims_panel_')) {
                try {
                    await claimPanelManager.handlePanelButton(interaction, config);
                } catch (err) {
                    console.error('[Interaction] Error handling claims panel button:', err.message);
                }
            } else if (customId === 'register_start') {
                try {
                    await registerManager.handleRegisterButtonClick(interaction, config);
                } catch (err) {
                    console.error('[Interaction] Error handling register button click:', err.message);
                }
            } else if (customId === 'register_verify_code') {
                try {
                    await registerManager.handleVerifyCodeButtonClick(interaction);
                } catch (err) {
                    console.error('[Interaction] Error handling verify code button click:', err.message);
                }
            } else if (customId.startsWith('ticket_')) {
                try {
                    await ticketManager.handleTicketInteraction(interaction);
                } catch (err) {
                    console.error('[Interaction] Error handling ticket button:', err.message);
                }
            } else if (customId.startsWith('pl_approve_')) {
                try {
                    const requestId = customId.replace('pl_approve_', '');
                    await planilhadoManager.handleApproveRequest(interaction, requestId);
                } catch (err) {
                    console.error('[Interaction] Error handling planilhado approve button:', err.message);
                }
            } else if (customId.startsWith('pl_reject_')) {
                try {
                    const requestId = customId.replace('pl_reject_', '');
                    await planilhadoManager.handleRejectRequest(interaction, requestId);
                } catch (err) {
                    console.error('[Interaction] Error handling planilhado reject button:', err.message);
                }
            } else if (customId === 'planilhado_solicitar_btn') {
                try {
                    await planilhadoManager.handlePlanilhadoButtonClick(interaction, config);
                } catch (err) {
                    console.error('[Interaction] Error handling planilhado solicit button:', err.message);
                }
            } else if (customId.startsWith('tax_approve_')) {
                try {
                    const paymentId = customId.replace('tax_approve_', '');
                    await taxManager.handleApproveTax(interaction, paymentId);
                } catch (err) {
                    console.error('[Interaction] Error handling tax approve button:', err.message);
                }
            } else if (customId.startsWith('tax_reject_')) {
                try {
                    const paymentId = customId.replace('tax_reject_', '');
                    await taxManager.handleRejectTax(interaction, paymentId);
                } catch (err) {
                    console.error('[Interaction] Error handling tax reject button:', err.message);
                }
            } else if (customId === 'tax_remind_pending') {
                try {
                    await taxManager.handleRemindPendingTax(interaction);
                } catch (err) {
                    console.error('[Interaction] Error handling tax remind pending button:', err.message);
                }
            } else if (customId === 'tax_download_list') {
                try {
                    await taxManager.handleDownloadPendingList(interaction);
                } catch (err) {
                    console.error('[Interaction] Error handling tax download list button:', err.message);
                }
            } else if (customId === 'tax_remind_individual') {
                try {
                    await taxManager.handleRemindIndividualPrompt(interaction);
                } catch (err) {
                    console.error('[Interaction] Error handling tax remind individual button:', err.message);
                }
            } else if (customId.startsWith('shop_buy_')) {
                try {
                    const itemId = customId.replace('shop_buy_', '');
                    await loja.handleShopPurchase(interaction, itemId);
                } catch (err) {
                    console.error('[Interaction] Error handling shop purchase button:', err.message);
                }
            } else if (customId.startsWith('raffle_buy_')) {
                try {
                    const raffleId = parseInt(customId.replace('raffle_buy_', ''), 10);
                    await sorteio.handleRaffleTicketPurchase(interaction, raffleId);
                } catch (err) {
                    console.error('[Interaction] Error handling raffle purchase button:', err.message);
                }
            }
            return;
        }

        if (interaction.isStringSelectMenu()) {
            const customId = interaction.customId;
            if (customId === 'shop_buy_select') {
                try {
                    const itemId = interaction.values[0];
                    await loja.handleShopPurchase(interaction, itemId);
                } catch (err) {
                    console.error('[Interaction] Error handling shop purchase select:', err.message);
                }
            } else if (customId === 'ticket_category_select') {
                try {
                    await ticketManager.handleCategorySelect(interaction);
                } catch (err) {
                    console.error('[Interaction] Error handling ticket category select:', err.message);
                }
            }
            return;
        }

        if (interaction.isModalSubmit()) {
            const customId = interaction.customId;
            
            if (customId === 'tax_individual_submit') {
                try {
                    await taxManager.handleRemindIndividualSubmit(interaction);
                } catch (err) {
                    console.error('[Interaction] Error handling tax individual submit:', err.message);
                }
            } else if (customId === 'modal_claim_respawn' || customId === 'modal_queue_respawn') {
                try {
                    await claimPanelManager.handleModalSubmit(interaction, config);
                } catch (err) {
                    console.error('[Interaction] Error handling modal submit:', err.message);
                }
            } else if (customId === 'modal_planilhado_solicitar') {
                try {
                    await planilhadoManager.handlePlanilhadoModalSubmit(interaction, config);
                } catch (err) {
                    console.error('[Interaction] Error handling planilhado modal submit:', err.message);
                }
            } else if (customId === 'modal_user_register') {
                try {
                    await registerManager.handleRegisterModalSubmit(interaction, config);
                } catch (err) {
                    console.error('[Interaction] Error handling register modal submit:', err.message);
                }
            } else if (customId === 'modal_verify_code') {
                try {
                    await registerManager.handleVerifyCodeModalSubmit(interaction, config);
                } catch (err) {
                    console.error('[Interaction] Error handling verify code modal submit:', err.message);
                }
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const cmd = client.commands.get(interaction.commandName);
        if (!cmd) return;

        // RPG Minigame Deactivation Check
        if (RPG_COMMANDS.has(cmd.name) && !state.rpgMinigameEnabled) {
            return interaction.reply({ content: '⚠️ O minigame de RPG está temporariamente desativado.', ephemeral: true });
        }

        // Restrição de Canal para Comandos de Claim
        const isClaimCmd = ['claim', 'liberar', 'respawns', 'extend', 'next', 'listahunts'].includes(cmd.name);

        if (isClaimCmd && config.claimCommandsChannelId && interaction.channelId !== config.claimCommandsChannelId) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Canal Incorreto')
                        .setDescription(`Os comandos de reserva só podem ser usados no canal <#${config.claimCommandsChannelId}>.`)
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                        .setTimestamp()
                ],
                ephemeral: true
            });
        }

        // Check admin permissions
        if (cmd.adminOnly && !isAdmin(interaction.member)) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Acesso Negado')
                        .setDescription('Apenas administradores podem usar este comando.')
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                        .setTimestamp()
                ],
                ephemeral: true
            });
        }

        try {
            await cmd.executeSlash(interaction, {
                client,
                config: config,
                saveConfig: saveConfigForGuild,
            });
        } catch (err) {
            console.error(`[Slash] Erro no comando "${interaction.commandName}":`, err.message, err.stack);
            const replyOpts = {
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('❌ Erro Interno')
                        .setDescription('Ocorreu um erro ao executar o comando. Tente novamente.')
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                        .setTimestamp()
                ],
                ephemeral: true
            };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(replyOpts).catch(() => {});
            } else {
                await interaction.reply(replyOpts).catch(() => {});
            }
        }
    });
});

// Helper para enviar DM de boas-vindas
async function sendWelcomeDM(member) {
    try {
        console.log(`[Boas-vindas] Enviando DM para o novo membro: ${member.user.tag} (${member.id})`);

        const guildId = member.guild.id;
        const config = db.getGuildConfigMerged(guildId);

        const regChannel = config.registrationChannelId
            ? `<#${config.registrationChannelId}>`
            : 'o canal de registro';

        const welcomeEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('⚔️ Boas-vindas ao Clã Ascended! ⚔️')
            .setDescription(
                `Olá! Seja muito bem-vindo ao servidor de Discord da guilda **Ascended**.\n\n` +
                `Para ter acesso completo aos canais do clã (guerra, claims de respawns, radar, relatórios, etc.), você precisa concluir o seu registro.\n\n` +
                `Por favor, acesse o canal de registro clicando no link abaixo, clique no botão **Iniciar Registro** e siga as instruções:\n` +
                `👉 ${regChannel}\n\n` +
                `*Se precisar de ajuda ou tiver qualquer dúvida, fale com um Administrador.*`
            )
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        await member.send({ embeds: [welcomeEmbed] });
        console.log(`[Boas-vindas] DM enviada com sucesso para: ${member.user.tag}`);
    } catch (err) {
        console.warn(`[Boas-vindas] Não foi possível enviar DM para ${member.user.tag}:`, err.message);
    }
}

// ─── Evento: Guild Member Add (Novo membro entra) ─────────────────────────────
client.on('guildMemberAdd', async (member) => {
    // Se o membro não estiver pendente de rule screening, envia a DM imediatamente
    if (!member.pending) {
        await sendWelcomeDM(member);
    }
});

// ─── Evento: Guild Member Update (Mudança de estado do membro) ──────────────────
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // Se o membro concluiu o screening de regras (passou de pendente para não pendente)
    if (oldMember.pending && !newMember.pending) {
        await sendWelcomeDM(newMember);
    }
});


async function setupAethelgardChannels(guild) {
    if (!guild) return;
    const { ChannelType } = require('discord.js');

    try {
        // 1. Look for the category
        let category = guild.channels.cache.find(c => c.name === '⚔️ BASTIÃO DE AETHELGARD' && c.type === ChannelType.GuildCategory);
        if (!category) {
            category = await guild.channels.create({
                name: '⚔️ BASTIÃO DE AETHELGARD',
                type: ChannelType.GuildCategory,
                reason: 'Categoria do Minigame RPG Bastião de Aethelgard'
            });
            console.log(`[Setup] Categoria "${category.name}" criada com sucesso.`);
        }

        // 2. Look for/create channels under this category
        const channelsToCreate = [
            { name: '⚔-aethelgard-geral', topic: 'Comandos gerais do RPG: /rpg-registrar, /rpg-perfil, /equipar, /desequipar, /loja' },
            { name: '⚔-arena-de-duelos', topic: 'Desafie outros guerreiros para combates na Arena: /duelar' },
            { name: '⚔-invasoes-e-raids', topic: 'Defenda o Bastião de Aethelgard e enfrente os Bosses: /atacar' }
        ];

        for (const chan of channelsToCreate) {
            let channel = guild.channels.cache.find(c => c.name === chan.name && c.parentId === category.id && c.type === ChannelType.GuildText);
            if (!channel) {
                channel = await guild.channels.create({
                    name: chan.name,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    topic: chan.topic,
                    reason: 'Canal do Minigame RPG Bastião de Aethelgard'
                });
                console.log(`[Setup] Canal "${channel.name}" criado com sucesso sob a categoria.`);
            }
        }
    } catch (err) {
        console.error('[Setup] Erro ao criar categoria e canais do minigame:', err.message);
    }
}


// ─── Login ────────────────────────────────────────────────────────────────────
const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('[Bot] ❌ BOT_TOKEN não definido! Crie um arquivo .env com BOT_TOKEN=seu_token_aqui');
    process.exit(1);
}

require('./api/server').startServer(3000);

client.login(token).catch(err => {
    console.error('[Bot] ❌ Erro ao fazer login:', err.message);
    process.exit(1);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal, exitCode = 0) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[Bot] Sinal ${signal}. Encerrando...`);
    try {
        const { closeBrowser } = require('./scraper/scraper');
        await closeBrowser();
    } catch { /* ignore */ }
    try {
        client.destroy();
    } catch { /* ignore */ }
    process.exit(exitCode);
}

process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err.stack || err);
    shutdown('uncaughtException', 1).catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
    // Apenas logamos a rejeição. Falhas na API do Discord não devem derrubar o bot inteiro.
    console.error('[WARN] unhandledRejection mitigado:', reason);
});

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
