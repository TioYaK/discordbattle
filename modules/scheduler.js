'use strict';

/**
 * scheduler.js — Loops de scraping e notificações automáticas
 *
 * Loops seriais (igual ao server.js do WhatsApp tracker):
 *  - Guild:      a cada 10s
 *  - Highscores: contínuo (após finalizar recomeça)
 *  - Deaths:     a cada 15s
 *  - Hunted:     a cada 30s (verifica se inimigos estão online)
 *  - Midnight:   reset de stats à meia-noite
 */

const state  = require('./state');
const db     = require('./database');
const embeds = require('./embeds');
const achievements = require('./achievements');
const cityInvasions = require('./cityInvasions');
const { getWarVoiceChannelId } = require('./configHelpers');
const { scrapeGuild, scrapeHighscores, scrapeDeaths, scrapePlayer } = require('../scraper/scraper');
const whatsapp = require('./whatsapp');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');

let client = null; // discord.js Client
const { guildLocalStorage } = require('./state');
function getCurrentGuild(client) {
    if (!client) return null;
    const activeGuildId = guildLocalStorage.getStore()?.guildId;
    if (activeGuildId) {
        const g = client.guilds.cache.get(activeGuildId);
        if (g) return g;
    }
    return client.guilds.cache.first();
}
let defaultConfig = {};
const config = new Proxy({}, {
    get(target, prop) {
        const store = guildLocalStorage.getStore();
        const guildId = store ? store.guildId : null;
        if (!guildId) return (defaultConfig || {})[prop];
        const merged = db.getGuildConfigMerged(guildId);
        return merged[prop];
    },
    set(target, prop, value) {
        const store = guildLocalStorage.getStore();
        const guildId = store ? store.guildId : null;
        if (!guildId) {
            if (defaultConfig) defaultConfig[prop] = value;
        } else {
            db.setConfig(prop, value, guildId);
        }
        return true;
    }
});

async function init(discordClient, botConfig) {
    client = discordClient;
    state._client = discordClient; // expose to achievements module
    defaultConfig = botConfig;
    
    // Auto setup tax system before routines
    await runAllGuilds(async () => { await setupTaxSystem(client); });

    await startRoutines();
}

function updateConfig(newConfig) {
    config = newConfig;
}

// ─── Helper: enviar para canal ────────────────────────────────────────────────
async function sendToChannel(channelId, embed, content = null) {
    if (!channelId || !client) return;
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel?.isTextBased()) {
            const options = { embeds: [embed] };
            if (content) {
                options.content = content;
            }
            await channel.send(options);
        }
    } catch (e) {
        console.warn(`[Scheduler] Falha ao enviar para canal ${channelId}:`, e.message);
    }
}

// ─── Helper: enviar DMs para membros registrados ──────────────────────────────
async function sendDirectMessagesToRegistered(messageContent) {
    if (!client) return;
    try {
        const registered = db.getAllRegisteredMembers();
        if (registered.length === 0) return;

        console.log(`[Scheduler] Iniciando envio de DM de masslog para ${registered.length} membros registrados...`);

        for (const memberRow of registered) {
            try {
                const user = await client.users.fetch(memberRow.discord_id).catch(() => null);
                if (user) {
                    await user.send({ content: messageContent });
                    console.log(`[Scheduler] DM de masslog enviada com sucesso para ${user.tag} (${memberRow.char_name})`);
                } else {
                    console.warn(`[Scheduler] Não foi possível encontrar usuário do Discord com ID: ${memberRow.discord_id}`);
                }
            } catch (err) {
                console.warn(`[Scheduler] Falha ao enviar DM de masslog para o ID ${memberRow.discord_id} (${memberRow.char_name}):`, err.message);
            }
            // Pequeno delay para evitar rate limit do Discord
            await new Promise(r => setTimeout(r, 200));
        }
    } catch (err) {
        console.error('[Scheduler] Erro ao enviar DMs de masslog:', err.message);
    }
}

// Helper: enviar WhatsApp para membros registrados
async function sendWhatsAppToRegistered(messageContent) {
    try {
        const registered = db.getAllRegisteredMembers();
        const withPhone = registered.filter(m => m.phone && m.phone.replace(/\D/g, '') !== '');
        if (withPhone.length === 0) return;

        // Clean up markdown for WhatsApp: convert ** to *
        let cleanContent = messageContent.replace(/\*\*/g, '*');
        // Replace channel link `<#123456...>` with a text label
        cleanContent = cleanContent.replace(/<#[0-9]+>/g, 'canal de voz');

        console.log(`[Scheduler] Iniciando envio de WhatsApp de masslog para ${withPhone.length} membros...`);
        const whatsapp = require('./whatsapp');

        for (const memberRow of withPhone) {
            try {
                // Personalize and randomize greeting
                const greetings = [
                    `Olá, *${memberRow.char_name}*!\n`,
                    `Ei, *${memberRow.char_name}*!\n`,
                    `Tudo bem, *${memberRow.char_name}*?\n`,
                    `Aviso para *${memberRow.char_name}*:\n`
                ];
                const greeting = greetings[Math.floor(Math.random() * greetings.length)];
                
                // Add timestamp and random tag to footer to ensure uniqueness
                const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const randomHash = Math.random().toString(36).substring(2, 6).toUpperCase();
                const footer = `\n\n_[Ref: ${timeStr} | ${randomHash}]_`;

                const personalizedMsg = greeting + cleanContent + footer;

                const sent = await whatsapp.sendWhatsAppMessage(memberRow.phone, personalizedMsg);
                if (sent) {
                    console.log(`[Scheduler] WhatsApp de masslog enviado para ${memberRow.char_name} (${memberRow.phone})`);
                }
            } catch (err) {
                console.warn(`[Scheduler] Falha ao enviar WhatsApp de masslog para ${memberRow.char_name}:`, err.message);
            }
            // Delay fixo de 1s entre envios (usuários agora têm o número salvo nos contatos)
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (err) {
        console.error('[Scheduler] Erro ao enviar WhatsApp de masslog:', err.message);
    }
}

// ─── Helper: parseKillers ─────────────────────────────────────────────────────
function parseKillers(killedBy) {
    if (!killedBy) return [];
    const killers = [];
    const parentMatch = killedBy.match(/\((?:maior dano por|most damage by)\s+([^)]+)\)/i);
    if (parentMatch) killers.push(parentMatch[1].trim());

    let clean = killedBy.replace(/\s*\([^)]+\)/g, '').trim();
    clean.split(',').forEach(part => {
        part.split(/\s+and\s+|\s+e\s+/i).forEach(sp => {
            const name = sp.trim();
            if (name) killers.push(name);
        });
    });
    return [...new Set(killers)];
}

async function getWarChannelMemberIds() {
    const warChannelId = getWarVoiceChannelId(config);
    const ids = new Set();
    if (!warChannelId || !client) return ids;
    try {
        const channel = await client.channels.fetch(warChannelId).catch(() => null);
        if (channel && channel.members) {
            channel.members.forEach(member => {
                ids.add(member.id);
            });
        }
    } catch (e) {
        console.warn(`[Scheduler] Falha ao buscar membros do canal de voz de guerra:`, e.message);
    }
    return ids;
}

async function handlePlayerLeftGuild(playerName, oldGuildName) {
    console.log(`[GuildLeave] Detectado que ${playerName} saiu da guilda ${oldGuildName}. Aguardando para verificar novo destino...`);
    
    // Pequeno atraso para dar tempo do site/banco atualizar
    await new Promise(r => setTimeout(r, 8000));
    
    try {
        const charInfo = await scrapePlayer(playerName);
        let destination = 'Nenhuma (Sem Guilda)';
        let isEnemy = false;
        
        if (charInfo && charInfo.guild && charInfo.guild.toLowerCase() !== 'nenhuma') {
            destination = charInfo.guild;
            const enemyGuild = config.enemyGuildName;
            if (enemyGuild && destination.toLowerCase() === enemyGuild.toLowerCase()) {
                isEnemy = true;
            }
        }
        
        console.log(`[GuildLeave] ${playerName} saiu da guilda ${oldGuildName}. Novo destino: ${destination}`);
        
        const embed = new EmbedBuilder()
            .setColor(isEnemy ? 0xD35400 : 0xE74C3C)
            .setTitle(isEnemy ? `🚨 SAÍDA PARA GUILDA INIMIGA!` : `🚪 SAÍDA DE MEMBRO DA GUILDA`)
            .setDescription(`O jogador **${playerName}** saiu da guilda **${oldGuildName}**.`);
            
        embed.addFields(
            { name: '👤 Personagem', value: `\`${playerName}\``, inline: true },
            { name: '🏰 Novo Destino', value: isEnemy ? `🚨 **${destination}** (Inimigos)` : `\`${destination}\``, inline: true }
        );
        
        embed.setTimestamp();
        
        if (config.reportChannelId) {
            await sendToChannel(config.reportChannelId, embed);
        }
    } catch (err) {
        console.error(`[GuildLeave] Erro ao processar saída de ${playerName}:`, err.message);
    }
}

// ─── updateGuildMembers ───────────────────────────────────────────────────────
async function updateGuildMembers() {
    const guildName = config.guildName;
    if (!guildName) return;

    try {
        const members = await scrapeGuild(guildName);
        if (!members || members.length === 0) return;

        // Detecta quem saiu da guilda comparando com a lista anterior
        if (state.guildMembers && state.guildMembers.length > 0) {
            const currentNames = new Set(members.map(m => m.name.toLowerCase()));
            const leftPlayers = state.guildMembers.filter(m => !currentNames.has(m.name.toLowerCase()));
            
            leftPlayers.forEach(p => {
                handlePlayerLeftGuild(p.name, guildName).catch(() => {});
            });
        }

        state.guildMembers = members;

        const registered = db.getAllRegisteredMembers();
        const registeredMap = new Map();
        registered.forEach(r => registeredMap.set(r.char_name.toLowerCase(), r));

        const inWarChannelDiscordIds = await getWarChannelMemberIds();
        const today = db.todayDate();
        const onlineScrapedNames = new Set();

        members.forEach(m => {
            state.playerGuildCache[m.name] = guildName;

            const regRecord = registeredMap.get(m.name.toLowerCase());
            if (regRecord) {
                const wasOnline = state.trackedPlayers[m.name] && state.trackedPlayers[m.name].status === 'Online';
                const isOfflineNow = m.status === 'Offline';
                if (wasOnline && isOfflineNow) {
                    // Logoff detected
                    if (state.isMassivoActive && !inWarChannelDiscordIds.has(regRecord.discord_id)) {
                        db.incrementMassivoLogoffs(regRecord.discord_id, regRecord.char_name);
                        console.log(`[Massivo] ${regRecord.char_name} (<@${regRecord.discord_id}>) deslogou do jogo durante o Massivo.`);
                    }
                }
            }

            // Level-up detection for allies
            const prevLevel = db.getPlayerLevel(m.name);
            if (prevLevel !== null && m.level > prevLevel) {
                console.log(`[LevelUp] ✨ Aliado ${m.name} subiu de level: ${prevLevel} → ${m.level}`);
                
                const levelDiff = m.level - prevLevel;
                db.upsertDailyStats({ date: today, name: m.name, levelsGained: levelDiff });
                
                if (!state.dailyStats[m.name]) {
                    state.dailyStats[m.name] = { dailyXp: 0, gainXp: 0, lostXp: 0, onlineMs: 0, levelsGained: 0 };
                }
                state.dailyStats[m.name].levelsGained = (state.dailyStats[m.name].levelsGained || 0) + levelDiff;

                const levelUpEmbed = embeds.buildLevelUpEmbed(m, prevLevel, m.level, true);
                if (config.levelUpChannelId) {
                    sendToChannel(config.levelUpChannelId, levelUpEmbed).catch(() => {});
                }
            }
            db.upsertPlayerLevel(m.name, m.level);

            if (!state.trackedPlayers[m.name]) {
                state.trackedPlayers[m.name] = { ...m, deltaXp: 0, streak: 0, isHunting: false };
            } else {
                Object.assign(state.trackedPlayers[m.name], m);
            }

            if (m.status === 'Online') {
                state.lastSeenMap[m.name] = Date.now();
                db.updateLastSeen(m.name, Date.now());
                db.upsertDailyStats({ date: today, name: m.name, onlineMs: 50000 });
                onlineScrapedNames.add(m.name.toLowerCase());
            }
        });

        // Massivo Logic: >= 50% of registered allies in any voice channel are in the war voice channel (min 4 registered allies in voice)
        const guildObj = getCurrentGuild(client);
        const voiceStates = guildObj ? guildObj.voiceStates.cache : new Map();

        const registeredInVoice = registered.filter(r => voiceStates.has(r.discord_id));
        const warChannelId = getWarVoiceChannelId(config);
        const registeredInWarVoice = registered.filter(r => {
            const vs = voiceStates.get(r.discord_id);
            return warChannelId && vs && vs.channelId === warChannelId;
        });

        const isMassivo = registeredInVoice.length >= 4 && (registeredInWarVoice.length >= 0.5 * registeredInVoice.length);
        state.isMassivoActive = isMassivo;

        if (isMassivo) {
            const onlineRegistered = registered.filter(r => 
                onlineScrapedNames.has(r.char_name.toLowerCase())
            );
            const onlineRegisteredOutOfCall = onlineRegistered.filter(r => 
                !inWarChannelDiscordIds.has(r.discord_id)
            );
            onlineRegisteredOutOfCall.forEach(r => {
                db.incrementMassivoIgnored(r.discord_id, r.char_name, 50000);
            });
        }



        console.log(`[Scheduler] ✅ Guilda atualizada: ${members.length} membros (${members.filter(m => m.status === 'Online').length} online)`);

    } catch (err) {
        console.error('[Scheduler] updateGuildMembers:', err.message);
    }
}

async function syncNicknames() {
    try {
        const guilds = db.getActiveGuilds();
        for (const guildRow of guilds) {
            const guild = client.guilds.cache.get(guildRow.guild_id);
            if (!guild) continue;

            const registered = db.prepare('SELECT discord_id, char_name, class_code FROM registered_members WHERE guild_id = ?').all(guild.id);
            if (registered.length === 0) continue;

            const CLASSES_EMOJIS = {
                'EK': '⚔️',
                'MS': '✨',
                'RP': '🎯',
                'ED': '🌳',
                'EM': '🧘'
            };

            const memberIds = registered.map(r => r.discord_id);
            const membersMap = await guild.members.fetch({ user: memberIds }).catch(err => {
                console.warn(`[NicknameSync] Error fetching members in batch for guild ${guild.name}:`, err.message);
                return new Map();
            });

            for (const memberRow of registered) {
                try {
                    // Procurar personagem na lista de membros da guilda sincronizada
                    const charData = state.guildMembers.find(m => m.name.toLowerCase() === memberRow.char_name.toLowerCase());
                    if (!charData) continue;

                    const discordMember = membersMap.get(memberRow.discord_id);
                    if (!discordMember) continue;

                    const emoji = CLASSES_EMOJIS[memberRow.class_code] || '';
                    const expectedNick = `${charData.name} [${charData.level}] ${emoji}`.slice(0, 32);

                    if (discordMember.nickname !== expectedNick) {
                        await discordMember.setNickname(expectedNick);
                        console.log(`[NicknameSync] Apelido de ${discordMember.user.tag} sincronizado para: ${expectedNick} na guilda ${guild.name}`);
                    }
                } catch (err) {
                    // Ignorar erro de permissão (ex: dono do servidor, administrador ou cargo superior)
                }
            }
        }
    } catch (err) {
        console.error('[Scheduler] syncNicknames:', err.message);
    }
}

// ─── updateHighscores ─────────────────────────────────────────────────────────
async function updateHighscores() {
    const world = config.worldName;
    try {
        await scrapeHighscores(world, (playersOnPage) => {
            const today = db.todayDate();

            playersOnPage.forEach(p => {
                // 1. Processar aliado
                const tracked = state.trackedPlayers[p.name];
                if (tracked) {
                    const prevExp = tracked.experience || 0;

                    if (prevExp > 0 && p.experience > prevExp) {
                        const diff = p.experience - prevExp;
                        tracked.deltaXp   = diff;
                        if (!tracked.isHunting) {
                            tracked.isHunting = true;
                            tracked.huntingStartTime = Date.now();
                        }
                        tracked.streak    = (tracked.streak || 0) + 1;
                        tracked.lastUpdate = Date.now();
                        state.lastSeenMap[p.name] = Date.now();
                        db.updateLastSeen(p.name, Date.now());

                        if (!state.dailyStats[p.name]) {
                            state.dailyStats[p.name] = { dailyXp: 0, gainXp: 0, lostXp: 0, onlineMs: 0 };
                        }
                        state.dailyStats[p.name].dailyXp += diff;
                        state.dailyStats[p.name].gainXp  += diff;

                        const hour = new Date().getHours();
                        state.hourlyActivityStats[hour] = (state.hourlyActivityStats[hour] || 0) + diff;

                        db.upsertDailyStats({ date: today, name: p.name, gainXp: diff, dailyXp: diff });

                        // Alerta modo guerra
                        if (state.warMode) {
                            state.warXp[p.name] = (state.warXp[p.name] || 0) + diff;
                            if (state.warXp[p.name] >= 1_000_000 && !state.warAlerted.has(p.name)) {
                                state.warAlerted.add(p.name);
                                const embed = embeds.buildWarXpAlertEmbed(p.name, state.warXp[p.name]);
                                sendToChannel(config.warChannelId || config.reportChannelId, embed);
                            }
                        }

                    } else if (prevExp > 0 && p.experience < prevExp) {
                        const lostXp = prevExp - p.experience;
                        tracked.isHunting = false;
                        tracked.huntingStartTime = null;
                        tracked.deltaXp   = 0;
                        tracked.streak    = 0;
                        if (!state.dailyStats[p.name]) {
                            state.dailyStats[p.name] = { dailyXp: 0, gainXp: 0, lostXp: 0, onlineMs: 0 };
                        }
                        state.dailyStats[p.name].lostXp  += lostXp;
                        state.dailyStats[p.name].dailyXp -= lostXp;
                        db.upsertDailyStats({ date: today, name: p.name, lostXp });
                    }

                    tracked.experience = p.experience;
                    tracked.level      = p.level;
                }

                // 2. Processar inimigo
                const trackedEnemy = state.trackedEnemyPlayers[p.name];
                if (trackedEnemy) {
                    const prevExp = trackedEnemy.experience || 0;
                    if (prevExp === 0) {
                        trackedEnemy.experience = p.experience;
                        trackedEnemy.level = p.level;
                        trackedEnemy.lastUpdate = Date.now();
                    } else if (p.experience > prevExp) {
                        const diff = p.experience - prevExp;
                        trackedEnemy.deltaXp = diff;
                        if (!trackedEnemy.isHunting) {
                            trackedEnemy.isHunting = true;
                            trackedEnemy.huntingStartTime = Date.now();
                        }
                        trackedEnemy.lastUpdate = Date.now();
                        state.lastSeenMap[p.name] = Date.now();
                        db.updateLastSeen(p.name, Date.now());
                        trackedEnemy.experience = p.experience;
                        trackedEnemy.level = p.level;
                    } else if (p.experience < prevExp) {
                        // Inimigo morreu ou perdeu XP
                        trackedEnemy.isHunting = false;
                        trackedEnemy.huntingStartTime = null;
                        trackedEnemy.experience = p.experience;
                        trackedEnemy.level = p.level;
                        trackedEnemy.lastUpdate = Date.now();
                    }
                }
            });
        });
    } catch (err) {
        console.error('[Scheduler] updateHighscores:', err.message);
    }
}

// ─── updateDeaths ─────────────────────────────────────────────────────────────

const worldDeathsCache = {};
async function getDeathsForWorldCached(world) {
    const now = Date.now();
    if (worldDeathsCache[world] && (now - worldDeathsCache[world].time) < 10000) {
        return worldDeathsCache[world].deaths;
    }
    try {
        const deaths = await scrapeDeaths(world);
        worldDeathsCache[world] = { time: now, deaths };
        return deaths;
    } catch (err) {
        console.error(`[Scheduler] Erro ao obter mortes de ${world}:`, err.message);
        return [];
    }
}

async function updateDeaths() {
    const world = config.worldName;
    try {
        const deaths = await getDeathsForWorldCached(world);

        if (state.isFirstDeathScrape) {
            // Primeiro scrape — apenas popula o cache silenciosamente
            deaths.forEach(d => state.processedDeaths.add(d.name + '|' + d.timeStr));
            state.isFirstDeathScrape = false;
            console.log(`[Scheduler] Primeiro scrape de mortes — ${deaths.length} registros no cache.`);
            return;
        }

        const today = db.todayDate();

        for (const d of deaths) {
            const sig = d.name + '|' + d.timeStr;
            if (state.processedDeaths.has(sig)) continue;
            state.processedDeaths.add(sig);

            if (state.processedDeaths.size > 5000) {
                state.processedDeaths.delete(state.processedDeaths.values().next().value);
            }

            const isAlly = state.playerGuildCache[d.name] === config.guildName ||
                state.guildMembers.some(m => m.name.toLowerCase() === d.name.toLowerCase());

            // Registra morte
            if (isAlly) {
                const deathRecord = {
                    name:     d.name,
                    level:    d.level,
                    killedBy: d.killedBy,
                    time:     new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    rawTime:  d.timeStr,
                    world:    d.world,
                    isPvP:    d.isPvP,
                };
                state.dailyDeaths.push(deathRecord);
                db.insertDeath({ date: today, name: d.name, level: d.level, killedBy: d.killedBy, rawTime: d.timeStr, isPvP: d.isPvP });

                // Notificação de morte de aliado
                if (config.deathChannelId) {
                    const embed = embeds.buildAllyDeathEmbed(deathRecord, true);
                    await sendToChannel(config.deathChannelId, embed);
                }
                await updateWarScoreboard();
            }

            // Verifica frags: se o killer é um membro da guilda e a vítima não é aliada
            const killers = parseKillers(d.killedBy);
            for (const killerName of killers) {
                const isGuildKiller = state.playerGuildCache[killerName] === config.guildName ||
                    state.guildMembers.some(m => m.name.toLowerCase() === killerName.toLowerCase());

                if (isGuildKiller && !isAlly) {
                    const fragRecord = {
                        killerName,
                        victimName: d.name,
                        victimLevel: d.level,
                        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                        rawTime: d.timeStr,
                    };
                    state.dailyFrags.push(fragRecord);
                    db.insertFrag({ date: today, killerName, victimName: d.name, rawTime: d.timeStr, victimLevel: d.level });

                    // Conceder 20 AC por kill a aliados registrados
                    try {
                        const coinsDiscordId = db.awardCoinsByCharName(killerName, 20);
                        if (coinsDiscordId) {
                            console.log(`[Gamification] Concedido 20 AC para o membro registrado (Discord ID: ${coinsDiscordId}) pelo kill em ${d.name}.`);
                        }
                    } catch (errCoins) {
                        console.error('[Gamification] Erro ao conceder moedas por kill:', errCoins.message);
                    }

                    // Notificação de frag
                    if (config.fragChannelId) {
                        const embed = embeds.buildFragEmbed(fragRecord);
                        await sendToChannel(config.fragChannelId, embed);
                    }
                    await updateWarScoreboard();
 
                    // Verificar se existe recompensa (Bounty) ativa para a vítima
                    try {
                        const activeBounty = db.getBountyByTarget(d.name);
                        if (activeBounty) {
                            const killerReg = db.getAllRegisteredMembers().find(r =>
                                r.char_name.toLowerCase() === killerName.toLowerCase() ||
                                (r.bomba && r.bomba.toLowerCase() === killerName.toLowerCase())
                            );
                            const killerDiscordId = killerReg ? killerReg.discord_id : null;
                            
                            db.claimBounty(activeBounty.id, killerDiscordId, killerName);
                            
                            const targetChanId = config.reportChannelId || config.fragChannelId;
                            if (targetChanId) {
                                const scraper = require('../scraper/scraper');
                                const apiData = await scraper.fetchRubinotEveCharacter(killerName).catch(() => null);
                                const outfitUrl = apiData?.outfitUrl;

                                const bountyClaimEmbed = new EmbedBuilder()
                                    .setColor(0xFFD700)
                                    .setTitle('🏆 RECOMPENSA COBRADA! (Bounty Claimed)')
                                    .setDescription(`O alvo **${d.name}** (Level ${d.level}) foi eliminado por **${killerName}**!\n\n` +
                                                     `💰 **Recompensa**: *${activeBounty.reward}*\n` +
                                                     `👤 **Contratante**: <@${activeBounty.created_by}>\n` +
                                                     `☠️ **Assassino**: ${killerDiscordId ? `<@${killerDiscordId}>` : `\`${killerName}\``}`)
                                    .setFooter({ text: 'Ascended Bot • RubinOT' })
                                    .setTimestamp();

                                if (outfitUrl) {
                                    bountyClaimEmbed.setThumbnail(outfitUrl);
                                }

                                await sendToChannel(targetChanId, bountyClaimEmbed);
                            }
                        }
                    } catch (bountyErr) {
                        console.error('[Scheduler] Erro ao processar claim de Bounty:', bountyErr.message);
                    }

                    // Verificar conquistas do matador
                    try {
                        const killerReg = db.getAllRegisteredMembers().find(r =>
                            r.char_name.toLowerCase() === killerName.toLowerCase() ||
                            (r.bomba && r.bomba.toLowerCase() === killerName.toLowerCase())
                        );
                        if (killerReg) {
                            const guild = getCurrentGuild(client);
                            const annChanId = config.reportChannelId || config.claimCommandsChannelId;
                            await achievements.checkFragAchievements(killerReg.discord_id, guild, annChanId);
                            await achievements.checkUnstoppableExecutioner(killerReg.discord_id, guild, annChanId);
                        }
                    } catch (errAch) {
                        console.warn('[Scheduler] Erro ao verificar conquistas de frag:', errAch.message);
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Scheduler] updateDeaths:', err.message);
    }
}

// ─── updateHunted ─────────────────────────────────────────────────────────────
async function updateHunted() {
    if (!state.huntedList || state.huntedList.length === 0) return;
    if (!config.enemyChannelId) return;

    for (const enemyName of state.huntedList) {
        try {
            const data = await scrapePlayer(enemyName);
            if (!data) continue;

            if (data.status === 'Online') {
                state.lastSeenMap[data.name] = Date.now();
                db.updateLastSeen(data.name, Date.now());

                if (!state.huntedOnlineAlerted.has(enemyName)) {
                    state.huntedOnlineAlerted.add(enemyName);
                    const embed = embeds.buildEnemyOnlineEmbed(data.name, data.level, data.vocation);
                    await sendToChannel(config.enemyChannelId, embed);
                    console.log(`[Scheduler] 👁️ Inimigo online: ${enemyName}`);
                }
            } else if (data.status === 'Offline') {
                state.huntedOnlineAlerted.delete(enemyName);
            }

            // Pequeno delay entre cada player para não sobrecarregar
            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
            console.error(`[Scheduler] updateHunted (${enemyName}):`, err.message);
        }
    }
}

// ─── Relatório de meia-noite ──────────────────────────────────────────────────
async function sendMidnightReport() {
    if (!config.reportChannelId) return;

    try {
        const yesterday = db.todayDate(); // ainda é "ontem" se chamado à meia-noite
        const statsRows = db.getDailyStatsForDate(yesterday);
        const deathRows = db.getDeathsForDate(yesterday);
        const fragRows  = db.getFragsForDate(yesterday);

        const players = statsRows.map(r => ({
            name:    r.name,
            dailyXp: r.daily_xp,
            gainXp:  r.gain_xp,
            lostXp:  r.lost_xp,
            onlineMs: r.online_ms,
        })).sort((a, b) => b.dailyXp - a.dailyXp);

        const embed = embeds.buildRelatorioEmbed(
            players,
            deathRows.length,
            fragRows.length,
            config.guildName || 'Ascended'
        );

        await sendToChannel(config.reportChannelId, embed);
        console.log(`[Scheduler] 📊 Relatório de meia-noite enviado.`);

        // Atualização dos cargos de gamificação da temporada
        try {
            const guild = getCurrentGuild(client);
            const gamificationWinners = await updateGamificationRoles(guild);
            if (gamificationWinners && (gamificationWinners.carrasco || gamificationWinners.presenca || gamificationWinners.xp)) {
                const announceEmbed = new EmbedBuilder()
                    .setColor(0x9B59B6)
                    .setTitle('🏆 Títulos e Honrarias da Temporada Atualizados!')
                    .setDescription('Os cargos honorários da guilda para os últimos 30 dias foram redistribuídos aos maiores guerreiros:')
                    .addFields(
                        { 
                            name: '🩸 Carrasco do Mês', 
                            value: gamificationWinners.carrasco ? `<@${gamificationWinners.carrasco}>` : '_Nenhum frag registrado nos últimos 30 dias._', 
                            inline: true 
                        },
                        { 
                            name: '📞 Presença de Ferro', 
                            value: gamificationWinners.presenca ? `<@${gamificationWinners.presenca}>` : '_Nenhuma presença em call registrada nos últimos 30 dias._', 
                            inline: true 
                        },
                        { 
                            name: '✨ XP Maker Lendário', 
                            value: gamificationWinners.xp ? `<@${gamificationWinners.xp}>` : '_Nenhum XP ganho nos últimos 30 dias._', 
                            inline: true 
                        }
                    )
                    .setFooter({ text: 'Ascended Bot • Gamificação' })
                    .setTimestamp();
                await sendToChannel(config.reportChannelId, announceEmbed);
            }
        } catch (errGame) {
            console.error('[Scheduler] Erro ao processar cargos de gamificação no relatório de meia-noite:', errGame.message);
        }

        // Se for domingo (dia 0), envia também o relatório semanal acumulado
        if (new Date().getDay() === 0) {
            try {
                const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

                const topXpRows = db.db.prepare(`
                    SELECT name, SUM(gain_xp) as total_xp, SUM(online_ms) as total_online
                    FROM daily_stats
                    WHERE date >= ? AND gain_xp > 0
                    GROUP BY name
                    ORDER BY total_xp DESC
                    LIMIT 10
                `).all(sevenDaysAgo);

                const topFragsRows = db.db.prepare(`
                    SELECT killer_name as name, COUNT(*) as total_frags
                    FROM frags
                    WHERE date >= ?
                    GROUP BY killer_name
                    ORDER BY total_frags DESC
                    LIMIT 10
                `).all(sevenDaysAgo);

                const totalFragsResult = db.db.prepare(`SELECT COUNT(*) as count FROM frags WHERE date >= ?`).get(sevenDaysAgo);
                const totalDeathsResult = db.db.prepare(`SELECT COUNT(*) as count FROM deaths WHERE date >= ?`).get(sevenDaysAgo);

                const totalFrags = totalFragsResult ? totalFragsResult.count : 0;
                const totalDeaths = totalDeathsResult ? totalDeathsResult.count : 0;

                // Top K/D da semana (contando main + bomba)
                const topKD = db.getTopKDPlayers(sevenDaysAgo, 5);

                // Top voz da semana
                const sinceTs7 = Date.now() - 7 * 24 * 60 * 60 * 1000;
                const topVoiceRows = db.db.prepare(`
                    SELECT rm.char_name, rm.discord_id,
                           SUM(CASE WHEN vs.end_time IS NOT NULL THEN (vs.end_time - vs.start_time) ELSE (${Date.now()} - vs.start_time) END) as total_ms
                    FROM voice_sessions vs
                    JOIN registered_members rm ON vs.discord_id = rm.discord_id
                    WHERE vs.start_time >= ?
                    GROUP BY rm.discord_id
                    ORDER BY total_ms DESC
                    LIMIT 5
                `).all(sinceTs7);

                // Conquistas desbloqueadas na semana
                const weekAchievements = db.getAchievementsUnlockedSince(sinceTs7);

                const weeklyMedals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
                const xpLines = topXpRows.length
                    ? topXpRows.map((r, i) => `${weeklyMedals[i]} **${r.name}** · +${embeds.formatXp(r.total_xp)} XP`)
                    : ['_Nenhum XP registrado_'];

                const fragLines = topFragsRows.length
                    ? topFragsRows.map((r, i) => `${weeklyMedals[i]} **${r.name}** · ${r.total_frags} ${r.total_frags === 1 ? 'frag' : 'frags'}`)
                    : ['_Nenhum frag registrado_'];

                const kdLines = topKD.length
                    ? topKD.map((r, i) => `${weeklyMedals[i]} **${r.charName}** · ${r.frags}F / ${r.deaths}M = **${r.kd.toFixed(2)} K/D**`)
                    : ['_Nenhum dado de K/D_'];

                const voiceLines = topVoiceRows.length
                    ? topVoiceRows.map((r, i) => {
                        const h = Math.floor(r.total_ms / 3600000);
                        const m2 = Math.floor((r.total_ms % 3600000) / 60000);
                        return `${weeklyMedals[i]} **${r.char_name}** · ${h}h ${m2}m em call`;
                    })
                    : ['_Nenhuma presença em call registrada_'];

                const kdRatio = totalDeaths > 0
                    ? (totalFrags / totalDeaths).toFixed(2)
                    : totalFrags.toFixed(2);

                const weeklyEmbed = new EmbedBuilder()
                    .setColor(0x9B59B6)
                    .setTitle(`📊 Relatório Semanal da Guilda — ${config.guildName || 'Ascended'}`)
                    .setDescription(`Resumo das atividades e conquistas dos últimos 7 dias:`)
                    .addFields(
                        { name: '🏆 Top XP Makers (Semana)', value: xpLines.join('\n'), inline: false },
                        { name: '🎯 Maiores Matadores (Semana)', value: fragLines.join('\n'), inline: false },
                        { name: '⚔️ Melhor K/D da Semana', value: kdLines.join('\n'), inline: false },
                        { name: '📞 Mais Tempo em Call', value: voiceLines.join('\n'), inline: false },
                        {
                            name: '⚖️ Balanço Geral de Guerra',
                            value: `🎯 **Total de Frags:** \`${totalFrags}\`\n` +
                                   `☠️ **Total de Mortes:** \`${totalDeaths}\`\n` +
                                   `⚖️ **K/D Ratio da Guilda:** \`${kdRatio}\``,
                            inline: false
                        },
                        weekAchievements.length > 0 ? {
                            name: `🏅 Conquistas Desbloqueadas esta Semana (${weekAchievements.length})`,
                            value: weekAchievements.slice(0, 5).map(a => `<@${a.discord_id}> desbloqueou **${a.achievement_id}**`).join('\n'),
                            inline: false
                        } : { name: '🏅 Conquistas', value: '_Nenhuma conquista desbloqueada esta semana._', inline: false }
                    )
                    .setFooter({ text: 'Ascended Bot • RubinOT' })
                    .setTimestamp();

                await sendToChannel(config.reportChannelId, weeklyEmbed);
                console.log(`[Scheduler] 📊 Relatório semanal de domingo enviado.`);
            } catch (errWeek) {
                console.error('[Scheduler] Erro ao enviar relatório semanal no domingo:', errWeek.message);
            }
        }

        // Reset das stats diárias em memória
        state.dailyStats          = {};
        state.hourlyActivityStats = {};
        state.dailyDeaths         = [];
        state.dailyFrags          = [];
        state.processedDeaths     = new Set();
        state.isFirstDeathScrape  = true;
        state.warXp               = {};
        state.warAlerted          = new Set();
        Object.values(state.trackedPlayers).forEach(p => {
            p.deltaXp   = 0;
            p.isHunting = false;
            p.streak    = 0;
        });

        // Rotação de planilhados de 15 dias
        try {
            const guilds = Array.from(client.guilds.cache.values());
            for (const guild of guilds) {
                await checkPlanilhadoRotation(guild);
            }
        } catch (errRot) {
            console.error('[Scheduler] Erro ao executar rotação de planilhados:', errRot.message);
        }

    } catch (err) {
        console.error('[Scheduler] sendMidnightReport:', err.message);
    }
}

function getClaimDuration(member, config) {
    const isUserAdmin = member && (
        member.permissions.has('Administrator') || 
        member.permissions.has('ManageGuild') || 
        (config.adminRoleId && member.roles.cache.has(config.adminRoleId))
    );

    if (config.cargoClaim180 && member.roles.cache.has(config.cargoClaim180)) {
        return 180;
    }
    if (config.cargoClaim90 && member.roles.cache.has(config.cargoClaim90)) {
        return 90;
    }
    
    return isUserAdmin ? 180 : 0;
}

async function promoteNextInQueue(respawnId, respawnName, category) {
    if (!client) return;

    try {
        const nextInQueue = db.getNextInQueue(respawnId);
        if (!nextInQueue) return;

        // Remove do banco de dados da fila
        db.removeFromQueue(respawnId, nextInQueue.player_id);

        // Insere como reserva PENDENTE de 10 minutos (600.000 ms)
        const durationMs = 10 * 60 * 1000;
        db.insertClaim({
            respawnId,
            respawnName,
            category,
            playerId: nextInQueue.player_id,
            playerName: nextInQueue.player_name,
            durationMs,
            status: 'pending'
        });

        const pendingClaim = db.getClaimByRespawn(respawnId);
        const notificationMsg = `🔔 **Sua vez chegou!** O respawn **${respawnName}** (\`${respawnId}\`) está livre e você foi promovido da fila.\nVocê tem exatamente **10 minutos** para claimar/aceitar usando o comando \`!claim ${respawnId}\` ou clicando em "Reservar" no painel, caso contrário sua vez expirará automaticamente!`;

        // 1. Notificar via Discord DM
        try {
            const user = await client.users.fetch(nextInQueue.player_id);
            if (user) {
                await user.send(notificationMsg);
                console.log(`[Scheduler] Notificação de promoção enviada por DM para ${nextInQueue.player_name}`);
            }
        } catch (e) {
            console.warn(`[Scheduler] Erro ao enviar DM de promoção para ${nextInQueue.player_name}:`, e.message);
        }

        // 2. Notificar via WhatsApp
        try {
            const reg = db.getRegisteredMember(nextInQueue.player_id);
            if (reg && reg.phone) {
                const whatsapp = require('./whatsapp');
                await whatsapp.sendWhatsAppMessage(reg.phone, notificationMsg);
            }
        } catch (e) {
            console.warn(`[Scheduler] Erro ao enviar WhatsApp de promoção para ${nextInQueue.player_name}:`, e.message);
        }

        // 3. Notificar no canal de comandos
        const commandsChannelId = config.claimCommandsChannelId;
        if (commandsChannelId) {
            try {
                const channel = await client.channels.fetch(commandsChannelId);
                if (channel?.isTextBased()) {
                    const mentionEmbed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('⏳ Vez na Fila (Aguardando Aceitação)')
                        .setDescription(`O respawn **${respawnName}** (\`${respawnId}\`) está livre e o próximo da fila é <@${nextInQueue.player_id}>.\n\n⚠️ Você tem **10 minutos** para aceitar/claimar!`)
                        .setFooter({ text: 'Ascended Bot • RubinOT', iconURL: 'https://rubinot.com.br/favicon.ico' })
                        .setTimestamp();

                    await channel.send({ content: `<@${nextInQueue.player_id}>`, embeds: [mentionEmbed] });
                }
            } catch (e) {
                console.error(`[Scheduler] Erro ao notificar canal de comandos na promoção:`, e.message);
            }
        }

        // Atualiza painel
        await updateLiveDashboard();
    } catch (err) {
        console.error('[Scheduler] promoteNextInQueue erro:', err.message);
    }
}

async function checkExpiredClaims() {
    if (!client) return;
    try {
        const now = Date.now();
        // Busca claims expirados (tanto ativos quanto pendentes de 10 min)
        const expiredClaims = db.db.prepare('SELECT * FROM claims WHERE expires_at <= ?').all(now);
        
        if (expiredClaims.length === 0) return;

        console.log(`[Scheduler] Encontrados ${expiredClaims.length} claims expirados. Processando...`);

        for (const claim of expiredClaims) {
            // Delete expired claim
            db.deleteClaim(claim.respawn_id);

            // Se o claim expirado era ativo, avisa que o tempo acabou
            if (claim.status === 'active') {
                const expireMsg = `⏰ **Reserva Expirada:** O seu tempo de reserva do respawn **${claim.respawn_name}** (\`${claim.respawn_id}\`) terminou.`;
                try {
                    const user = await client.users.fetch(claim.player_id);
                    if (user) await user.send(expireMsg);
                } catch {}
                try {
                    const reg = db.getRegisteredMember(claim.player_id);
                    if (reg && reg.phone) {
                        const whatsapp = require('./whatsapp');
                        await whatsapp.sendWhatsAppMessage(reg.phone, expireMsg);
                    }
                } catch {}
            } else if (claim.status === 'pending') {
                // Se era pendente, avisa que o prazo de aceitação de 10 min expirou
                const expireMsg = `⏰ **Tempo de Aceitação Expirado:** Você não aceitou a reserva do respawn **${claim.respawn_name}** (\`${claim.respawn_id}\`) dentro do prazo de 10 minutos, portanto perdeu a sua vez.`;
                try {
                    const user = await client.users.fetch(claim.player_id);
                    if (user) await user.send(expireMsg);
                } catch {}
                try {
                    const reg = db.getRegisteredMember(claim.player_id);
                    if (reg && reg.phone) {
                        const whatsapp = require('./whatsapp');
                        await whatsapp.sendWhatsAppMessage(reg.phone, expireMsg);
                    }
                } catch {}
            }

            // Promove o próximo da fila
            await promoteNextInQueue(claim.respawn_id, claim.respawn_name, claim.category);
        }

        await runAllGuilds(async () => {
            await updateLiveDashboard();
        });
    } catch (err) {
        console.error('[Scheduler] checkExpiredClaims:', err.message);
    }
}

async function checkVoiceChannelPenalties() {
    if (!client) return;
    try {
        const now = Date.now();
        const penaltyTime = 5 * 60 * 1000; // 5 minutos

        for (const [userId, leftTime] of Object.entries(state.leftVoiceMap)) {
            if (now - leftTime >= penaltyTime) {
                // Remove do leftVoiceMap
                delete state.leftVoiceMap[userId];

                // Busca a reserva ativa dele
                const claim = db.getClaimByPlayer(userId);
                if (claim && claim.status === 'active') {
                    console.log(`[Scheduler] Cancelando reserva de ${claim.player_name} (ID: ${userId}) no respawn ${claim.respawn_name} devido a penalidade de canal de voz.`);
                    
                    db.deleteClaim(claim.respawn_id);

                    const cancelMsg = `❌ **Reserva Cancelada:** Sua reserva do respawn **${claim.respawn_name}** (\`${claim.respawn_id}\`) foi cancelada porque você ficou mais de 5 minutos fora de um canal de voz do Discord.`;

                    // Notificar via Discord DM
                    try {
                        const user = await client.users.fetch(userId);
                        if (user) await user.send(cancelMsg);
                    } catch (e) {
                        console.warn(`[Scheduler] Erro ao enviar DM de cancelamento para ${userId}:`, e.message);
                    }

                    // Notificar via WhatsApp
                    try {
                        const reg = db.getRegisteredMember(userId);
                        if (reg && reg.phone) {
                            const whatsapp = require('./whatsapp');
                            await whatsapp.sendWhatsAppMessage(reg.phone, cancelMsg);
                        }
                    } catch (e) {
                        console.warn(`[Scheduler] Erro ao enviar WhatsApp de cancelamento para ${userId}:`, e.message);
                    }

                    // Promove o próximo da fila se houver
                    await promoteNextInQueue(claim.respawn_id, claim.respawn_name, claim.category);
                }
            }
        }
    } catch (err) {
        console.error('[Scheduler] checkVoiceChannelPenalties erro:', err.message);
    }
}

async function checkInitialVoiceStates() {
    if (!client) return;
    console.log('[Scheduler] Verificando estados de voz iniciais para reservas ativas...');
    try {
        const guilds = db.getActiveGuilds();
        for (const guildRow of guilds) {
            const guild = client.guilds.cache.get(guildRow.guild_id);
            if (!guild) continue;

            await guildLocalStorage.run({ guildId: guild.id }, async () => {
                const activeClaims = db.getActiveClaims();
                for (const claim of activeClaims) {
                    if (claim.status !== 'active') continue; // Ignora pendentes
                    try {
                        const member = await guild.members.fetch(claim.player_id).catch(() => null);
                        if (!member || !member.voice || !member.voice.channelId) {
                            // Não está em canal de voz, inicia a contagem de 5 min
                            state.leftVoiceMap[claim.player_id] = Date.now();
                            console.log(`[Scheduler] ${claim.player_name} não está em canal de voz. Fila de 5 min iniciada na inicialização.`);
                        }
                    } catch (err) {
                        console.warn(`[Scheduler] Erro ao verificar voz inicial para ${claim.player_name}:`, err.message);
                    }
                }
            });
        }
    } catch (e) {
        console.error('[Scheduler] checkInitialVoiceStates erro:', e.message);
    }
}

async function checkBossCooldowns() {
    if (!client) return;
    try {
        const pending = db.getPendingBossNotifications();
        if (pending.length === 0) return;

        console.log(`[Scheduler] Encontrados ${pending.length} notificações de bosses pendentes.`);

        for (const notification of pending) {
            try {
                const user = await client.users.fetch(notification.player_id).catch(() => null);
                if (user) {
                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('🔔 Boss Disponível!')
                        .setDescription(`Olá! Seu cooldown de 20h para o boss **${notification.boss_name}** expirou. Você já pode derrotá-lo novamente no Tibia!`)
                        .setFooter({ text: 'Ascended Bot • RubinOT', iconURL: 'https://rubinot.com.br/favicon.ico' })
                        .setTimestamp();

                    await user.send({ embeds: [embed] });
                }
            } catch (e) {
                console.warn(`[Scheduler] Falha ao notificar player por DM (${notification.player_id}):`, e.message);
            }
            // Mark notified in database
            db.markBossNotified(notification.id);
        }
    } catch (err) {
        console.error('[Scheduler] checkBossCooldowns:', err.message);
    }
}

// --- Funções de Taxa Automática ---
async function setupTaxSystem(discordClient) {
    const store = guildLocalStorage.getStore();
    const guildId = store ? store.guildId : null;
    if (!guildId) return;
    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) return;

    try {
        console.log('[TaxSystem] Verificando infraestrutura automática de taxas...');
        // 1. Verificar/Criar Cargo "Taxa Paga"
        let cargoTaxaId = config.cargoTaxa;
        let role = cargoTaxaId ? guild.roles.cache.get(cargoTaxaId) : null;
        if (!role) {
            role = await guild.roles.create({
                name: 'Taxa Paga',
                color: 0xF1C40F, // Amarelo
                reason: 'Sistema automático de taxas'
            });
            config.cargoTaxa = role.id;
            console.log(`[TaxSystem] Cargo "Taxa Paga" criado automaticamente (${role.id}).`);
        }

        // Permissões para canais de admin
        const adminPerms = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: discordClient.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }
        ];
        if (config.adminRoleId) {
            adminPerms.push({ id: config.adminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
        }

        // 2. Verificar/Criar Canal "auditoria-taxas"
        let auditId = config.taxAuditChannelId;
        let auditChannel = auditId ? guild.channels.cache.get(auditId) : null;
        if (!auditChannel) {
            auditChannel = await guild.channels.create({
                name: 'auditoria-taxas',
                type: ChannelType.GuildText,
                permissionOverwrites: adminPerms,
                reason: 'Canal de auditoria de taxas automático'
            });
            config.taxAuditChannelId = auditChannel.id;
            console.log(`[TaxSystem] Canal #auditoria-taxas criado automaticamente (${auditChannel.id}).`);
        }

        // 3. Verificar/Criar Canal "painel-taxas"
        let painelId = config.taxPanelChannelId;
        let painelChannel = painelId ? guild.channels.cache.get(painelId) : null;
        if (!painelChannel) {
            painelChannel = await guild.channels.create({
                name: 'painel-taxas',
                type: ChannelType.GuildText,
                permissionOverwrites: adminPerms,
                reason: 'Canal do painel de taxas automático'
            });
            config.taxPanelChannelId = painelChannel.id;
            console.log(`[TaxSystem] Canal #painel-taxas criado automaticamente (${painelChannel.id}).`);
        }

    } catch (err) {
        console.error('[TaxSystem] Erro ao configurar sistema de taxas automático:', err.message);
    }
}

function getCycleStartMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function isMemberPlanilhado(discordId) {
    const activeSchedules = db.getActiveSchedules();
    if (!activeSchedules || activeSchedules.length === 0) return false;
    for (const s of activeSchedules) {
        const leaderId = s.leader_discord_id;
        const memberIds = s.member_ids ? s.member_ids.split(',').filter(Boolean) : [];
        if (leaderId === discordId || memberIds.includes(discordId)) {
            return true;
        }
    }
    return false;
}

async function updateTaxDashboard() {
    if (!client || !config.taxPanelChannelId) return;

    try {
        const channel = await client.channels.fetch(config.taxPanelChannelId);
        if (!channel?.isTextBased()) return;

        const cycleStart = getCycleStartMonth();
        const paid = db.getPaidMembersForCycle(cycleStart);
        const pending = db.getPendingMembersForCycle(cycleStart);

        const totalMembers = paid.length + pending.length;
        const rate = totalMembers > 0 ? (paid.length / totalMembers) * 100 : 100;

        let totalCollectedRC = 0;
        paid.forEach(p => {
            const match = p.amount ? p.amount.match(/(\d+)/) : null;
            if (match) totalCollectedRC += parseInt(match[1], 10);
        });

        let totalPendingRC = 0;
        const pendingLines = pending.map(m => {
            const isPlanilhado = isMemberPlanilhado(m.discord_id);
            const amount = isPlanilhado ? (config.taxPlanilhadoValue || '1000 RC') : (config.taxValue || '500 RC');
            const match = amount.match(/(\d+)/);
            if (match) totalPendingRC += parseInt(match[1], 10);
            return `• <@${m.discord_id}> (${m.char_name}) — [${amount}]`;
        });

        const descText = 
            `**Status Financeiro Global**\n` +
            `• **Membros Registrados:** \`${totalMembers}\`\n` +
            `• **Aprovados (Com Cargo):** \`${paid.length}\` (${rate.toFixed(1)}%)\n` +
            `• **Pendentes (Inadimplentes):** \`${pending.length}\` (${(100 - rate).toFixed(1)}%)\n\n` +
            `💵 **Arrecadado:** \`${totalCollectedRC} RC\`\n` +
            `⏳ **Pendente:** \`${totalPendingRC} RC\`\n\n` +
            `*Use os botões abaixo para gerenciar a lista de inadimplentes sem sobrecarregar o painel.*`;

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle(`📊 Painel de Taxas — Ciclo <t:${Math.floor(cycleStart / 1000)}:D>`)
            .setDescription(descText)
            .setFooter({ text: 'Ascended Bot • Atualização em Tempo Real' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('tax_download_list')
                .setLabel('📑 Baixar Lista')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('tax_remind_individual')
                .setLabel('🔎 Cobrar Específico')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('tax_remind_pending')
                .setLabel('🔔 Cobrar Todos')
                .setStyle(ButtonStyle.Danger)
        );

        // Deleta as mensagens antigas
        let msgs = await channel.messages.fetch({ limit: 5 });
        const myMsgs = msgs.filter(m => m.author.id === client.user.id);

        if (myMsgs.size === 0) {
            await channel.send({ embeds: [embed], components: [row] });
            console.log('[TaxDashboard] Painel CRIADO no canal', channel.id);
        } else {
            const msgToEdit = myMsgs.first();
            await msgToEdit.edit({ embeds: [embed], components: [row] }).catch((e) => { console.error('[TaxDashboard] Erro edit:', e) });
            console.log('[TaxDashboard] Painel EDITADO no canal', channel.id);
            // Deleta as extras
            for (const [, m] of myMsgs) {
                if (m.id !== msgToEdit.id) await m.delete().catch(() => {});
            }
        }
    } catch (err) {
        console.error('[Scheduler] updateTaxDashboard Error:', err.message);
    }
}

async function updateLiveDashboard() {
    if (!client || !config.claimsPanelChannelId) return;

    try {
        const channel = await client.channels.fetch(config.claimsPanelChannelId);
        if (!channel?.isTextBased()) return;

        const activeClaims = db.getActiveClaims();
        const embed = embeds.buildLiveDashboardEmbed(activeClaims);

        // Build interactive buttons for claims panel
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('claims_panel_claim')
                .setLabel('🟢 Reservar Respawn')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('claims_panel_queue')
                .setLabel('⏳ Entrar na Fila (Next)')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('claims_panel_release')
                .setLabel('🔴 Liberar Meu Respawn')
                .setStyle(ButtonStyle.Danger)
        );

        const claimsPaused = config.claimsPaused === 'true';
        const components = claimsPaused ? [] : [row];

        let messageEdited = false;

        if (config.panelMessageId) {
            try {
                const message = await channel.messages.fetch(config.panelMessageId);
                if (message) {
                    await message.edit({ embeds: [embed], components });
                    messageEdited = true;
                }
            } catch (err) {
                console.log(`[Scheduler] Painel: mensagem ${config.panelMessageId} não encontrada ou inválida. Criando nova...`);
            }
        }

        if (!messageEdited) {
            try {
                const messages = await channel.messages.fetch({ limit: 100 });
                const existingMsg = messages.find(m => m.author.id === client.user.id && m.embeds?.[0]?.title === '📊 PAINEL DE RESPAWNS EM TEMPO REAL');
                if (existingMsg) {
                    await existingMsg.edit({ embeds: [embed], components });
                    config.panelMessageId = existingMsg.id;
                    db.setConfig('panelMessageId', existingMsg.id);
                    messageEdited = true;
                    console.log(`[Scheduler] Painel existente encontrado no canal e reaproveitado com ID: ${existingMsg.id}`);

                    // Remove extra duplicates if somehow they exist
                    const duplicates = messages.filter(m => m.id !== existingMsg.id && m.author.id === client.user.id && m.embeds?.[0]?.title === '📊 PAINEL DE RESPAWNS EM TEMPO REAL');
                    for (const dupMsg of duplicates.values()) {
                        await dupMsg.delete().catch(() => {});
                    }
                }
            } catch (e) {
                console.warn(`[Scheduler] Erro ao buscar/limpar painéis existentes no canal:`, e.message);
            }
        }

        if (!messageEdited) {
            const newMessage = await channel.send({ embeds: [embed], components });
            config.panelMessageId = newMessage.id;
            db.setConfig('panelMessageId', newMessage.id);
            console.log(`[Scheduler] Novo painel em tempo real criado com ID: ${newMessage.id}`);
        }
    } catch (err) {
        console.error('[Scheduler] updateLiveDashboard:', err.message);
    }
}

// ─── Loop de meia-noite ───────────────────────────────────────────────────────
async function purgeTaxRoles() {
    try {
        const guilds = db.getActiveGuilds();
        for (const gInfo of guilds) {
            const guild = client.guilds.cache.get(gInfo.id);
            if (!guild) continue;

            await guildLocalStorage.run({ guildId: guild.id }, async () => {
                const cargoTaxa = config.cargoTaxa;
                if (!cargoTaxa) return;

                try {
                    console.log(`[Scheduler] [${guild.name}] Executando expurgo mensal da Taxa Paga (The Purge)...`);
                    await guild.members.fetch(); // Load all members
                    let count = 0;
                    
                    for (const member of guild.members.cache.values()) {
                        if (member.roles.cache.has(cargoTaxa)) {
                            await member.roles.remove(cargoTaxa).catch(() => {});
                            count++;
                        }
                    }
                    console.log(`[Scheduler] [${guild.name}] Purge concluído. Cargo removido de ${count} membros.`);
                } catch (err) {
                    console.error(`[Scheduler] [${guild.name}] Erro no expurgo mensal da taxa:`, err.message);
                }
            });
        }
    } catch (err) {
        console.error('[Scheduler] Erro geral ao executar purge mensal das taxas:', err.message);
    }
}

function scheduleMidnight() {
    const now      = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight - now;

    setTimeout(async () => {
        await sendMidnightReport();
        
        // Se for o dia 1 do mês, limpa o cargo de taxa
        if (new Date().getDate() === 1) {
            await purgeTaxRoles();
        }

        scheduleMidnight(); // Agenda o próximo
    }, msUntilMidnight);

    console.log(`[Scheduler] ⏰ Próximo relatório de meia-noite em ${Math.round(msUntilMidnight / 60000)}min`);
}

// ─── Restauração do estado diário a partir do banco ──────────────────────────
// Chamada no startup para que o bot não "esqueça" os dados do dia ao reiniciar.
async function restoreStateFromDB() {
    const today = db.todayDate();
    console.log(`[Scheduler] 🔄 Restaurando estado diário do banco (${today})...`);

    // 1. Restaura dailyStats — XP, mortes e online_ms do dia atual
    const statsRows = db.getDailyStatsForDate(today);
    statsRows.forEach(r => {
        state.dailyStats[r.name] = {
            dailyXp:  r.daily_xp  || 0,
            gainXp:   r.gain_xp   || 0,
            lostXp:   r.lost_xp   || 0,
            onlineMs: r.online_ms || 0,
        };
    });
    console.log(`[Scheduler] ✅ dailyStats restaurado: ${statsRows.length} jogadores.`);

    // 2. Restaura dailyDeaths — mortes registradas hoje
    const deathRows = db.getDeathsForDate(today);
    state.dailyDeaths = deathRows.map(d => ({
        name:     d.name,
        level:    d.level,
        killedBy: d.killed_by,
        rawTime:  d.raw_time,
        time:     d.raw_time || '',
        isPvP:    !!d.is_pvp,
    }));
    console.log(`[Scheduler] ✅ dailyDeaths restaurado: ${state.dailyDeaths.length} mortes.`);

    // 3. Restaura dailyFrags — frags registrados hoje
    const fragRows = db.getFragsForDate(today);
    state.dailyFrags = fragRows.map(f => ({
        killerName:  f.killer_name,
        victimName:  f.victim_name,
        victimLevel: f.victim_level,
        rawTime:     f.raw_time,
        time:        f.raw_time || '',
    }));
    console.log(`[Scheduler] ✅ dailyFrags restaurado: ${state.dailyFrags.length} frags.`);

    // 4. Pré-popula processedDeaths para evitar re-notificar mortes antigas ao reiniciar
    deathRows.forEach(d => {
        if (d.name && d.raw_time) {
            state.processedDeaths.add(d.name + '|' + d.raw_time);
        }
    });

    // Com os dados restaurados, o primeiro scrape pode processar normalmente (sem silêncio)
    state.isFirstDeathScrape = false;
    console.log(`[Scheduler] ✅ processedDeaths pré-populado: ${state.processedDeaths.size} entradas. Reinicialização sem perda de dados concluída.`);
}

// ─── Inicia todos os loops ────────────────────────────────────────────────────
async function runAllGuilds(taskFn) {
    const guilds = db.getActiveGuilds();
    for (const guildRow of guilds) {
        await guildLocalStorage.run({ guildId: guildRow.guild_id }, async () => {
            try {
                await taskFn();
            } catch (e) {
                console.error(`[Scheduler] Erro ao executar tarefa para guilda ${guildRow.guild_name} (${guildRow.guild_id}):`, e.message);
            }
        });
    }
}

async function startRoutines() {
    console.log('[Scheduler] Iniciando rotinas...');

    // Restaura dados do dia atual do banco antes de qualquer scrape
    await restoreStateFromDB();

    // Carrega hunted do banco
    state.huntedList = db.getHuntedList();
    console.log(`[Scheduler] Hunted carregados: ${state.huntedList.length}`);

    // Primeiro scrape imediato
    await runAllGuilds(async () => {
        await updateGuildMembers();
        if (config.enemyGuildName) {
            await updateEnemyGuildMembers().catch(() => {});
        }
        await updateCounterChannels();
    });

    // Guild: a cada 50s
    (async function loopGuild() {
        while (true) {
            await new Promise(r => setTimeout(r, 50000));
            if (!state.scraperPaused) {
                await runAllGuilds(async () => {
                    await updateGuildMembers();
                    await updateCounterChannels();
                });
            }
        }
    })();

    // Guilda inimiga: a cada 45s
    (async function loopEnemyGuild() {
        while (true) {
            await new Promise(r => setTimeout(r, 45000));
            if (!state.scraperPaused) {
                await runAllGuilds(async () => {
                    if (config.enemyGuildName) {
                        await updateEnemyGuildMembers();
                    }
                });
            }
        }
    })();

    // Highscores: loop contínuo
    (async function loopHighscores() {
        while (true) {
            if (!state.scraperPaused) {
                await runAllGuilds(async () => {
                    await updateHighscores();
                });
            }
            await new Promise(r => setTimeout(r, 3000));
        }
    })();

    // Deaths: a cada 10s
    (async function loopDeaths() {
        while (true) {
            if (!state.scraperPaused) {
                await runAllGuilds(async () => {
                    await updateDeaths();
                });
            }
            await new Promise(r => setTimeout(r, 10000));
        }
    })();

        // Hunted: a cada 30s
    (async function loopHunted() {
        while (true) {
            await new Promise(r => setTimeout(r, 30000));
            if (!state.scraperPaused) {
                await runAllGuilds(async () => {
                    await updateHunted();
                });
            }
        }
    })();

    // Expiração de claims e penalidades de voz: a cada 10s
    (async function loopExpiredClaims() {
        while (true) {
            await new Promise(r => setTimeout(r, 10000));
            await checkExpiredClaims();
            await checkVoiceChannelPenalties();
        }
    })();

    // Painel em tempo real: a cada 20s
    (async function loopDashboard() {
        while (true) {
            await new Promise(r => setTimeout(r, 20000));
            await runAllGuilds(async () => {
                await updateLiveDashboard();
                await updateWarScoreboard();
                await updateEnemyHuntingDashboard();
                await updateAllyHuntingDashboard();
                await updateTaxDashboard();
            });
        }
    })();

    // Cooldowns de bosses: a cada 30s
    (async function loopBossCooldowns() {
        while (true) {
            await new Promise(r => setTimeout(r, 30000));
            await checkBossCooldowns();
        }
    })();

    // Sincronização de apelidos: a cada 15min
    (async function loopSyncNicknames() {
        // Aguarda 10 segundos na inicialização para evitar sobrecarga
        await new Promise(r => setTimeout(r, 10000));
        while (true) {
            if (!state.scraperPaused) {
                await syncNicknames();
            }
            await new Promise(r => setTimeout(r, 15 * 60 * 1000)); // 15 minutos
        }
    })();

    // Primeiro dashboard update imediato
    await runAllGuilds(async () => {
        await updateLiveDashboard();
        await updateWarScoreboard();
        await updateEnemyHuntingDashboard();
        await updateAllyHuntingDashboard();
        await updateTaxDashboard();
    });
    await checkInitialVoiceStates();

    // Meia-noite
    scheduleMidnight();

    // Loop para manter o bot conectado no canal de voz: a cada 10 minutos
    (async function loopVoiceConnection() {
        await new Promise(r => setTimeout(r, 5000)); // Aguarda 5 segundos na inicialização
        while (true) {
            await keepVoiceConnected();
            await new Promise(r => setTimeout(r, 10 * 60 * 1000)); // 10 minutos
        }
    })();

    // Auditoria de planilhados (check-in e caçada): a cada 1 minuto (60s)
    (async function loopPlanilhadoRoutines() {
        while (true) {
            await new Promise(r => setTimeout(r, 60000));
            if (!state.scraperPaused) {
                const guilds = Array.from(client.guilds.cache.values());
                for (const guild of guilds) {
                    await checkPlanilhadoRoutines(guild).catch(errRoutine => {
                        console.error(`[Scheduler] Erro na rotina de planilhado para a guilda ${guild.name}:`, errRoutine.message);
                    });
                }
            }
        }
    })();

    // Hall da Fama Semanal: a cada 1 minuto (60s)
    (async function loopWeeklyHallOfFame() {
        while (true) {
            await new Promise(r => setTimeout(r, 60000));
            if (!state.scraperPaused) {
                await checkWeeklyHallOfFame().catch(errWeekly => {
                    console.error(`[Scheduler] Erro na rotina do Hall da Fama Semanal:`, errWeekly.message);
                });
            }
        }
    })();

    // Backup Diário do Banco de Dados: a cada 1 minuto (60s)
    (async function loopDailyBackup() {
        while (true) {
            await new Promise(r => setTimeout(r, 60000));
            if (!state.scraperPaused) {
                await checkDailyBackup().catch(errBackup => {
                    console.error(`[Scheduler] Erro na rotina de Backup Diário:`, errBackup.message);
                });
            }
        }
    })();

    // Gamification - Moedas de Voz: a cada 1 minuto (60s)
    (async function loopGamificationVoiceCoins() {
        while (true) {
            await new Promise(r => setTimeout(r, 60000));
            if (!state.scraperPaused) {
                await checkGamificationVoiceCoins().catch(errVoice => {
                    console.error(`[Scheduler] Erro na rotina de moedas de voz:`, errVoice.message);
                });
            }
        }
    })();

    // Gamification - Sorteios: a cada 1 minuto (60s)
    (async function loopGamificationRaffles() {
        while (true) {
            await new Promise(r => setTimeout(r, 60000));
            if (!state.scraperPaused) {
                await checkGamificationRaffles().catch(errRaffle => {
                    console.error(`[Scheduler] Erro na rotina de sorteios:`, errRaffle.message);
                });
            }
        }
    })();

    // Gamification - Expiração de Cargos de Loja: a cada 1 minuto (60s)
    (async function loopGamificationExpiredRoles() {
        while (true) {
            await new Promise(r => setTimeout(r, 60000));
            if (!state.scraperPaused) {
                await checkGamificationExpiredRoles().catch(errRoles => {
                    console.error(`[Scheduler] Erro na rotina de expiração de cargos de loja:`, errRoles.message);
                });
            }
        }
    })();

    // Gamification - Ascended Boss Raids: a cada 1 minuto (60s)
    (async function loopGamificationRaids() {
        while (true) {
            await new Promise(r => setTimeout(r, 60000));
            if (!state.scraperPaused) {
                await runAllGuilds(async () => {
                    await checkGamificationRaids().catch(errRaids => {
                        console.error(`[Scheduler] Erro na rotina de invasão de boss:`, errRaids.message);
                    });
                });
            }
        }
    })();

    // Gamification - Bastião de Aethelgard City Invasions: a cada 1 minuto (60s)
    (async function loopCityInvasions() {
        while (true) {
            await new Promise(r => setTimeout(r, 60000));
            if (!state.scraperPaused) {
                await runAllGuilds(async () => {
                    await checkCityInvasions().catch(errInvasions => {
                        console.error(`[Scheduler] Erro na rotina de invasão de cidade:`, errInvasions.message);
                    });
                });
            }
        }
    })();

    console.log('[Scheduler] ✅ Todas as rotinas iniciadas.');
}

async function keepVoiceConnected() {
    const targetChannelId = config.onlineGuildChannelId || '1512577937101160600';
    if (!targetChannelId || !client) return;

    try {
        const voiceChannel = await client.channels.fetch(targetChannelId).catch(() => null);
        if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
            console.warn(`[Voice Keep-Alive] Canal de voz ${targetChannelId} não encontrado ou não é canal de voz.`);
            return;
        }

        const guild = voiceChannel.guild;
        let connection = getVoiceConnection(guild.id);

        if (!connection || connection.state.status === 'disconnected' || connection.state.status === 'destroyed') {
            console.log(`[Voice Keep-Alive] Bot não está conectado ou conexão foi perdida. Conectando ao canal de voz: ${voiceChannel.name} (${voiceChannel.id})...`);
            joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfMute: true,
                selfDeaf: true,
            });
        }
    } catch (err) {
        console.error('[Voice Keep-Alive] Erro ao manter conexão de voz:', err.message);
    }
}

const guildTrackers = {};
const trackers = new Proxy({}, {
    get(target, prop) {
        const store = guildLocalStorage.getStore();
        const guildId = store ? store.guildId : null;
        const gid = guildId || 'default';
        if (!guildTrackers[gid]) {
            guildTrackers[gid] = {
                lastGuildCounterUpdate: 0,
                lastEnemyCounterUpdate: 0,
                lastMassLogAlertTime: 0,
                lastMassLog1MinAlertTime: 0,
                lastWhatsAppMassLogAlertTime: 0,
                isFirstEnemyScrape: true,
                enemyLogins: []
            };
        }
        return guildTrackers[gid][prop];
    },
    set(target, prop, value) {
        const store = guildLocalStorage.getStore();
        const guildId = store ? store.guildId : null;
        const gid = guildId || 'default';
        if (!guildTrackers[gid]) {
            guildTrackers[gid] = {
                lastGuildCounterUpdate: 0,
                lastEnemyCounterUpdate: 0,
                lastMassLogAlertTime: 0,
                lastMassLog1MinAlertTime: 0,
                lastWhatsAppMassLogAlertTime: 0,
                isFirstEnemyScrape: true,
                enemyLogins: []
            };
        }
        guildTrackers[gid][prop] = value;
        return true;
    }
});

async function updateEnemyGuildMembers() {
    const enemyGuildName = config.enemyGuildName;
    if (!enemyGuildName) {
        state.enemyGuildMembers = [];
        return;
    }

    const nowTime = new Date();
    const hours = nowTime.getHours();
    const minutes = nowTime.getMinutes();
    const isServerSaveWindow = (hours === 10 && minutes >= 0 && minutes <= 30);

    try {
        const members = await scrapeGuild(enemyGuildName);
        if (!members || members.length === 0) return;

        state.enemyGuildMembers = members;

        // Conta quantos estavam online antes desta atualização para evitar falso-positivo de reinicialização do servidor (de 0 para N)
        const prevOnlineCount = Object.values(state.enemyOnlineStatus).filter(status => status === 'Online').length;
        const newOnlineCount = members.filter(m => m.status === 'Online').length;

        // Dispara o alerta de "Servidor Online" quando o servidor sai de offline (0 online) para online
        if (!trackers.isFirstEnemyScrape && prevOnlineCount === 0 && newOnlineCount > 0) {
            try {
                const allyCount = state.guildMembers ? state.guildMembers.filter(m => m.status === 'Online').length : 0;
                
                // Discord Embed (Sem menção)
                const discordEmbed = new EmbedBuilder()
                    .setColor(0x44FF88) // Verde
                    .setTitle('🟢 SERVIDOR ONLINE!')
                    .setDescription(
                        `O servidor de RubinOT acaba de voltar a ficar ativo!\n\n` +
                        `📊 **Status de Login:**\n` +
                        `• 🔴 Inimigos online: **${newOnlineCount}**\n` +
                        `• 🟢 Aliados online: **${allyCount}**`
                    )
                    .setFooter({ text: 'Ascended Bot • RubinOT' })
                    .setTimestamp();

                const warChannelId = config.warChannelId || config.reportChannelId;
                if (warChannelId) {
                    await sendToChannel(warChannelId, discordEmbed);
                    console.log(`[Scheduler] Alerta de Servidor Online enviado para o canal: ${warChannelId}`);
                }

                // WhatsApp message (convertido para o formato do whats)
                const whatsappMsg = 
                    `🟢 *O SERVIDOR ESTÁ ONLINE!*\n` +
                    `O servidor de RubinOT acaba de voltar a ficar ativo!\n\n` +
                    `🔴 Inimigos online: *${newOnlineCount}*\n` +
                    `🟢 Aliados online: *${allyCount}*`;

                sendWhatsAppToRegistered(whatsappMsg).catch(errWa => {
                    console.error('[Scheduler] Erro ao enviar WhatsApp de Servidor Online:', errWa.message);
                });
            } catch (errAlert) {
                console.error('[Scheduler] Erro ao disparar alerta de Servidor Online:', errAlert.message);
            }
        }

        // Popula cache de guilda inimiga e conta novos logins
        let newLoginsCount = 0;
        members.forEach(m => {
            state.playerGuildCache[m.name] = enemyGuildName;
            
            const prevStatus = state.enemyOnlineStatus[m.name];
            if (m.status === 'Online') {
                state.lastSeenMap[m.name] = Date.now();
                db.updateLastSeen(m.name, Date.now());

                if (prevStatus !== 'Online') {
                    if (!trackers.isFirstEnemyScrape && !isServerSaveWindow && prevOnlineCount > 0) {
                        trackers.enemyLogins.push(Date.now());
                    }
                    newLoginsCount++;
                }
            }
            state.enemyOnlineStatus[m.name] = m.status;

            // Level-up detection for enemies
            const prevEnemyLevel = db.getPlayerLevel(m.name);
            if (prevEnemyLevel !== null && m.level > prevEnemyLevel) {
                console.log(`[LevelUp] 🔴 Inimigo ${m.name} subiu de level: ${prevEnemyLevel} → ${m.level}`);
                const levelUpEmbed = embeds.buildLevelUpEmbed(m, prevEnemyLevel, m.level, false);
                if (config.levelUpChannelId) {
                    sendToChannel(config.levelUpChannelId, levelUpEmbed).catch(() => {});
                }
            }
            db.upsertPlayerLevel(m.name, m.level);

            if (!state.trackedEnemyPlayers[m.name]) {
                state.trackedEnemyPlayers[m.name] = { ...m, deltaXp: 0, streak: 0, isHunting: false, huntingStartTime: null, lastUpdate: Date.now() };
            } else {
                Object.assign(state.trackedEnemyPlayers[m.name], m);
                // Se o status mudou para Offline, limpa o status de caça
                if (m.status === 'Offline') {
                    state.trackedEnemyPlayers[m.name].isHunting = false;
                    state.trackedEnemyPlayers[m.name].huntingStartTime = null;
                }
            }
        });

        // Filtra logins dos últimos 5 minutos
        const limitTime = Date.now() - 5 * 60 * 1000;
        trackers.enemyLogins = trackers.enemyLogins.filter(t => t >= limitTime);

        if (!isServerSaveWindow) {
            // Alerta Rápido: >= 10 logins nos últimos 2 minutos e respeitar cooldown de 5 minutos
            const limitTime2Min = Date.now() - 120 * 1000;
            const enemyLogins2Min = trackers.enemyLogins.filter(t => t >= limitTime2Min);
            if (enemyLogins2Min.length >= 10 && Date.now() - trackers.lastMassLog1MinAlertTime >= 5 * 60 * 1000) {
                trackers.lastMassLog1MinAlertTime = Date.now();
                const warChannelId = config.warChannelId || config.reportChannelId;
                if (warChannelId) {
                    const embed = new EmbedBuilder()
                        .setColor(0xC0392B) // WAR color
                        .setTitle('🚨 ALERTA RÁPIDO: MASS LOG INIMIGO!')
                        .setDescription(`Detectados **${enemyLogins2Min.length}** logins da guilda inimiga **${enemyGuildName}** nos últimos 2 minutos!\n\n🔴 **Inimigos Online Agora**: \`${members.filter(m => m.status === 'Online').length}\``)
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                        .setTimestamp();
                    
                    await sendToChannel(warChannelId, embed, '@everyone');
                }

                // Envia DMs para os membros registrados (em background)
                const onlineEnemiesCount = members.filter(m => m.status === 'Online').length;
                const warVoiceId = getWarVoiceChannelId(config);
                const channelLink = warVoiceId ? `<#${warVoiceId}>` : 'canal de voz de guerra';
                const dmContent = `🚨 **ALERTA RÁPIDO: MASS LOG INIMIGO!** 🚨\n\nDetectados **${enemyLogins2Min.length}** logins da guilda inimiga **${enemyGuildName}** nos últimos 2 minutos!\n🔴 **Inimigos Online Agora**: \`${onlineEnemiesCount}\`\n\n👉 **Fique pronto no ${channelLink}!**`;
                sendDirectMessagesToRegistered(dmContent).catch(err => {
                    console.error('[Scheduler] Falha ao enviar DMs de masslog rápido:', err.message);
                });
                
                // Envia WhatsApp com cooldown independente de 30 minutos para evitar spam no telefone
                if (config.whatsappMassLogEnabled !== 'false' && Date.now() - trackers.lastWhatsAppMassLogAlertTime >= 30 * 60 * 1000) {
                    trackers.lastWhatsAppMassLogAlertTime = Date.now();
                    sendWhatsAppToRegistered(dmContent).catch(err => {
                        console.error('[Scheduler] Falha ao enviar WhatsApp de masslog rápido:', err.message);
                    });
                } else if (config.whatsappMassLogEnabled === 'false') {
                    console.log(`[Scheduler] WhatsApp Masslog rápido desativado por configuração.`);
                } else {
                    console.log(`[Scheduler] WhatsApp Masslog rápido suprimido pelo cooldown de 30min.`);
                }
            }

            // Se houver >= 20 logins nos últimos 5 minutos e respeitar o cooldown de 30 minutos
            if (trackers.enemyLogins.length >= 20 && Date.now() - trackers.lastMassLogAlertTime >= 30 * 60 * 1000) {
                trackers.lastMassLogAlertTime = Date.now();
                const warChannelId = config.warChannelId || config.reportChannelId;
                if (warChannelId) {
                    const embed = new EmbedBuilder()
                        .setColor(0xC0392B) // WAR color
                        .setTitle('🚨 ALERTA DE MASS LOG INIMIGO!')
                        .setDescription(`Detectados **${trackers.enemyLogins.length}** logins da guilda inimiga **${enemyGuildName}** nos últimos 5 minutos!\n\n🔴 **Inimigos Online Agora**: \`${members.filter(m => m.status === 'Online').length}\``)
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                        .setTimestamp();
                    
                    await sendToChannel(warChannelId, embed, '@everyone');
                }

                // Envia DMs para os membros registrados (em background)
                const onlineEnemiesCount = members.filter(m => m.status === 'Online').length;
                const warVoiceId = getWarVoiceChannelId(config);
                const channelLink = warVoiceId ? `<#${warVoiceId}>` : 'canal de voz de guerra';
                const dmContent = `🚨 **ALERTA DE MASS LOG INIMIGO!** 🚨\n\nDetectados **${trackers.enemyLogins.length}** logins da guilda inimiga **${enemyGuildName}** nos últimos 5 minutos!\n🔴 **Inimigos Online Agora**: \`${onlineEnemiesCount}\`\n\n👉 **Fique pronto no ${channelLink}!**`;
                sendDirectMessagesToRegistered(dmContent).catch(err => {
                    console.error('[Scheduler] Falha ao enviar DMs de masslog:', err.message);
                });
                
                // Envia WhatsApp com cooldown independente de 30 minutos para evitar spam no telefone
                if (config.whatsappMassLogEnabled !== 'false' && Date.now() - trackers.lastWhatsAppMassLogAlertTime >= 30 * 60 * 1000) {
                    trackers.lastWhatsAppMassLogAlertTime = Date.now();
                    sendWhatsAppToRegistered(dmContent).catch(err => {
                        console.error('[Scheduler] Falha ao enviar WhatsApp de masslog:', err.message);
                    });
                } else if (config.whatsappMassLogEnabled === 'false') {
                    console.log(`[Scheduler] WhatsApp Masslog desativado por configuração.`);
                } else {
                    console.log(`[Scheduler] WhatsApp Masslog suprimido pelo cooldown de 30min.`);
                }
            }
        }
        if (trackers.isFirstEnemyScrape) {
            trackers.isFirstEnemyScrape = false;
        }

        console.log(`[Scheduler] ✅ Guilda inimiga atualizada: ${members.length} membros (${members.filter(m => m.status === 'Online').length} online)`);

        // ─── CHECK ANTI-SPY ───────────────────────────────────────────────────
        try {
            const guildId = guildLocalStorage.getStore()?.guildId;
            if (guildId && client) {
                const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
                if (guild) {
                    const registered = db.getAllRegisteredMembers();
                    const enemyNamesSet = new Set(members.map(m => m.name.toLowerCase()));
                    
                    for (const reg of registered) {
                        const mainMatch = reg.char_name && enemyNamesSet.has(reg.char_name.toLowerCase());
                        const bombaMatch = reg.bomba && reg.bomba !== '-' && reg.bomba.toLowerCase() !== 'none' && enemyNamesSet.has(reg.bomba.toLowerCase());
                        
                        if (mainMatch || bombaMatch) {
                            const matchedName = mainMatch ? reg.char_name : reg.bomba;
                            console.log(`[Anti-Spy] 🚨 Espião detectado: Membro <@${reg.discord_id}> possui personagem ${matchedName} na guilda inimiga ${enemyGuildName}! Removendo...`);
                            
                            const desregistrarModule = require('../commands/desregistrar');
                            await desregistrarModule.handleDesregistrar(
                                guild,
                                client.user.id,
                                reg.discord_id,
                                `🚨 [ANTI-SPY] Personagem ${matchedName} detectado na guilda inimiga: ${enemyGuildName}`,
                                config,
                                client
                            ).catch(e => {
                                console.error(`[Anti-Spy] Erro ao desregistrar espião ${reg.discord_id}:`, e.message);
                            });
                        }
                    }
                }
            }
        } catch (spyErr) {
            console.error('[Anti-Spy] Erro no loop de verificação de espiões:', spyErr.message);
        }
    } catch (err) {
        console.error('[Scheduler] updateEnemyGuildMembers:', err.message);
    }
}

async function updateWarScoreboard() {
    if (!client || !config.warScoreboardChannelId) return;

    try {
        const channel = await client.channels.fetch(config.warScoreboardChannelId);
        if (!channel?.isTextBased()) return;

        const lastFrags = db.db.prepare('SELECT killer_name, victim_name, raw_time FROM frags ORDER BY created_at DESC LIMIT 5').all();
        const lastDeaths = db.db.prepare('SELECT name, level, killed_by, raw_time FROM deaths WHERE is_pvp = 1 ORDER BY created_at DESC LIMIT 5').all();
        const totalFrags = db.db.prepare('SELECT COUNT(*) as count FROM frags').get().count;
        const totalDeaths = db.db.prepare('SELECT COUNT(*) as count FROM deaths WHERE is_pvp = 1').get().count;

        const embed = embeds.buildWarScoreboardEmbed(lastFrags, lastDeaths, totalFrags, totalDeaths, config.guildName || 'Ascended');

        let messageEdited = false;

        if (config.warScoreboardMessageId) {
            try {
                const message = await channel.messages.fetch(config.warScoreboardMessageId);
                if (message) {
                    await message.edit({ embeds: [embed] });
                    messageEdited = true;
                }
            } catch (err) {
                console.log(`[Scheduler] Placar: mensagem ${config.warScoreboardMessageId} não encontrada ou inválida. Criando nova...`);
            }
        }

        if (!messageEdited) {
            try {
                const messages = await channel.messages.fetch({ limit: 100 });
                const existingMsg = messages.find(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith('⚔️ PLACAR DE GUERRA'));
                if (existingMsg) {
                    await existingMsg.edit({ embeds: [embed] });
                    config.warScoreboardMessageId = existingMsg.id;
                    db.setConfig('warScoreboardMessageId', existingMsg.id);
                    messageEdited = true;
                    console.log(`[Scheduler] Placar existente encontrado no canal e reaproveitado com ID: ${existingMsg.id}`);

                    // Remove extra duplicates if somehow they exist
                    const duplicates = messages.filter(m => m.id !== existingMsg.id && m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith('⚔️ PLACAR DE GUERRA'));
                    for (const dupMsg of duplicates.values()) {
                        await dupMsg.delete().catch(() => {});
                    }
                }
            } catch (e) {
                console.warn(`[Scheduler] Erro ao buscar/limpar placares existentes no canal:`, e.message);
            }
        }

        if (!messageEdited) {
            const newMessage = await channel.send({ embeds: [embed] });
            config.warScoreboardMessageId = newMessage.id;
            db.setConfig('warScoreboardMessageId', newMessage.id);
            console.log(`[Scheduler] Novo placar de guerra criado com ID: ${newMessage.id}`);
        }
    } catch (err) {
        console.error('[Scheduler] updateWarScoreboard:', err.message);
    }
}

async function updateEnemyHuntingDashboard() {
    if (!client || !config.enemyHuntingChannelId) return;

    try {
        const channel = await client.channels.fetch(config.enemyHuntingChannelId);
        if (!channel?.isTextBased()) return;

        // Limpa caças inativas (ex: 15 minutos sem novas alterações de XP)
        const now = Date.now();
        const INACTIVE_TIMEOUT = 15 * 60 * 1000;

        const huntingEnemies = [];
        Object.values(state.trackedEnemyPlayers).forEach(p => {
            if (p.isHunting) {
                if (now - p.lastUpdate > INACTIVE_TIMEOUT) {
                    p.isHunting = false;
                    p.huntingStartTime = null;
                } else {
                    huntingEnemies.push(p);
                }
            }
        });

        const embed = embeds.buildEnemyHuntingEmbed(huntingEnemies, config.enemyGuildName || 'Inimigos');

        let messageEdited = false;

        if (config.enemyHuntingMessageId) {
            try {
                const message = await channel.messages.fetch(config.enemyHuntingMessageId);
                if (message) {
                    await message.edit({ embeds: [embed] });
                    messageEdited = true;
                }
            } catch (err) {
                console.log(`[Scheduler] Monitor Inimigos: mensagem ${config.enemyHuntingMessageId} não encontrada. Criando nova...`);
            }
        }

        if (!messageEdited) {
            try {
                const messages = await channel.messages.fetch({ limit: 100 });
                const existingMsg = messages.find(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith('🕵️ INIMIGOS CAÇANDO EM TEMPO REAL'));
                if (existingMsg) {
                    await existingMsg.edit({ embeds: [embed] });
                    config.enemyHuntingMessageId = existingMsg.id;
                    db.setConfig('enemyHuntingMessageId', existingMsg.id);
                    messageEdited = true;
                    console.log(`[Scheduler] Monitor de inimigos existente encontrado no canal e reaproveitado com ID: ${existingMsg.id}`);

                    // Remove extra duplicates if somehow they exist
                    const duplicates = messages.filter(m => m.id !== existingMsg.id && m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith('🕵️ INIMIGOS CAÇANDO EM TEMPO REAL'));
                    for (const dupMsg of duplicates.values()) {
                        await dupMsg.delete().catch(() => {});
                    }
                }
            } catch (e) {
                console.warn(`[Scheduler] Erro ao buscar/limpar monitores de inimigos existentes no canal:`, e.message);
            }
        }

        if (!messageEdited) {
            const newMessage = await channel.send({ embeds: [embed] });
            config.enemyHuntingMessageId = newMessage.id;
            db.setConfig('enemyHuntingMessageId', newMessage.id);
            console.log(`[Scheduler] Novo monitor de inimigos caçando criado com ID: ${newMessage.id}`);
        }
    } catch (err) {
        console.error('[Scheduler] updateEnemyHuntingDashboard error:', err);
    }
}

async function updateAllyHuntingDashboard() {
    if (!client || !config.allyHuntingChannelId) return;

    try {
        const channel = await client.channels.fetch(config.allyHuntingChannelId);
        if (!channel?.isTextBased()) return;

        // Limpa caças inativas (ex: 15 minutos sem novas alterações de XP)
        const now = Date.now();
        const INACTIVE_TIMEOUT = 15 * 60 * 1000;

        const huntingAllies = [];
        Object.values(state.trackedPlayers).forEach(p => {
            if (p.isHunting) {
                if (now - p.lastUpdate > INACTIVE_TIMEOUT) {
                    p.isHunting = false;
                    p.huntingStartTime = null;
                } else {
                    huntingAllies.push(p);
                }
            }
        });

        const store = guildLocalStorage.getStore();
        const isBelariaTracker = store && store.guildId === 'belaria_tracker';
        const embed = embeds.buildAllyHuntingEmbed(huntingAllies, config.guildName || 'Aliados', isBelariaTracker);

        let messageEdited = false;

        if (config.allyHuntingMessageId) {
            try {
                const message = await channel.messages.fetch(config.allyHuntingMessageId);
                if (message) {
                    await message.edit({ embeds: [embed] });
                    messageEdited = true;
                }
            } catch (err) {
                console.log(`[Scheduler] Monitor Aliados: mensagem ${config.allyHuntingMessageId} não encontrada. Criando nova...`);
            }
        }

        if (!messageEdited) {
            try {
                const messages = await channel.messages.fetch({ limit: 100 });
                const expectedTitlePrefix = isBelariaTracker ? '🕵️ INIMIGOS CAÇANDO EM TEMPO REAL' : '🛡️ ALIADOS CAÇANDO EM TEMPO REAL';
                const existingMsg = messages.find(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith(expectedTitlePrefix));
                if (existingMsg) {
                    await existingMsg.edit({ embeds: [embed] });
                    config.allyHuntingMessageId = existingMsg.id;
                    db.setConfig('allyHuntingMessageId', existingMsg.id);
                    messageEdited = true;
                    console.log(`[Scheduler] Monitor de aliados/inimigos existente encontrado no canal e reaproveitado com ID: ${existingMsg.id}`);

                    // Remove extra duplicates if somehow they exist
                    const duplicates = messages.filter(m => m.id !== existingMsg.id && m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith(expectedTitlePrefix));
                    for (const dupMsg of duplicates.values()) {
                        await dupMsg.delete().catch(() => {});
                    }
                }
            } catch (e) {
                console.warn(`[Scheduler] Erro ao buscar/limpar monitores de aliados existentes no canal:`, e.message);
            }
        }

        if (!messageEdited) {
            const newMessage = await channel.send({ embeds: [embed] });
            config.allyHuntingMessageId = newMessage.id;
            db.setConfig('allyHuntingMessageId', newMessage.id);
            console.log(`[Scheduler] Novo monitor de aliados caçando criado com ID: ${newMessage.id}`);
        }
    } catch (err) {
        console.error('[Scheduler] updateAllyHuntingDashboard error:', err);
    }
}

async function syncOnlineListToChannel(channelId, members, guildName, isEnemy, dailyStats = {}) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) return;

        const online = members.filter(m => m.status === 'Online').sort((a, b) => b.level - a.level);

        const lines = online.map(m => {
            const xp = !isEnemy ? (dailyStats[m.name]?.dailyXp || 0) : 0;
            const xpStr = xp > 0 ? ` · +${embeds.formatXp(xp)} XP` : '';
            return `${embeds.vocEmoji(m.vocation)} **${m.name}** · Lv.${m.level} · ${m.vocation}${xpStr}`;
        });

        const chunks = [];
        let currentChunk = '';
        lines.forEach(line => {
            if (currentChunk.length + line.length + 1 > 1800) {
                chunks.push(currentChunk);
                currentChunk = line;
            } else {
                currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
            }
        });
        if (currentChunk) {
            chunks.push(currentChunk);
        }

        const embedsList = chunks.map((chunk, index) => {
            const embed = new EmbedBuilder()
                .setColor(isEnemy ? 0xFF4444 : 0x44FF88)
                .setDescription(chunk)
                .setTimestamp();
            
            if (index === 0) {
                embed.setTitle(`${isEnemy ? '🔴' : '🟢'} ${guildName} — Online Agora (${online.length} online)`);
            } else {
                embed.setTitle(`${isEnemy ? '🔴' : '🟢'} ${guildName} — Online (Continuação - ${index + 1}/${chunks.length})`);
            }
            return embed;
        });

        // Se ninguém estiver online, cria um embed de placeholder
        if (embedsList.length === 0) {
            embedsList.push(
                new EmbedBuilder()
                    .setColor(0x808080)
                    .setTitle(`${isEnemy ? '🔴' : '🟢'} ${guildName} — Ninguém Online`)
                    .setDescription('Nenhum jogador online no momento.')
                    .setTimestamp()
            );
        }

        // Busca mensagens e filtra as do bot de lista online
        const messages = await channel.messages.fetch({ limit: 50 });
        const botOnlineMessages = messages
            .filter(m => m.author.id === client.user.id && m.embeds?.[0]?.title && (m.embeds[0].title.includes('Online Agora') || m.embeds[0].title.includes('Online (Continuação') || m.embeds[0].title.includes('Ninguém Online')))
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        const botMsgsArray = Array.from(botOnlineMessages.values());
        const N = embedsList.length;
        const M = botMsgsArray.length;

        for (let i = 0; i < Math.max(N, M); i++) {
            if (i < N && i < M) {
                // Edita mensagem existente
                await botMsgsArray[i].edit({ embeds: [embedsList[i]] }).catch(() => {});
            } else if (i < N) {
                // Envia nova mensagem
                await channel.send({ embeds: [embedsList[i]] }).catch(() => {});
            } else if (i >= N && i < M) {
                // Deleta mensagem excedente
                await botMsgsArray[i].delete().catch(() => {});
            }
        }
    } catch (err) {
        console.error(`[Scheduler] Error in syncOnlineListToChannel for ${guildName}:`, err.message);
    }
}

async function updateCounterChannels(force = false) {
    if (!client) return;

    const now = Date.now();
    const COOLDOWN = 5 * 60 * 1000; // 5 minutes in ms

    // 1. Guild counter channel
    if (config.onlineGuildChannelId) {
        try {
            const guildCount = state.guildMembers ? state.guildMembers.filter(m => m.status === 'Online').length : 0;
            const newName = `🟢 Guilda: ${guildCount} Online`;
            
            const channel = await client.channels.fetch(config.onlineGuildChannelId);
            if (channel && channel.name !== newName) {
                if (force || now - trackers.lastGuildCounterUpdate >= COOLDOWN) {
                    channel.setName(newName)
                        .then(() => console.log(`[Scheduler] Canal de voz da guilda atualizado para: "${newName}"`))
                        .catch(err => console.error('[Scheduler] Erro ao renomear canal da guilda:', err.message));
                    trackers.lastGuildCounterUpdate = now;
                } else {
                    const waitMin = Math.ceil((COOLDOWN - (now - trackers.lastGuildCounterUpdate)) / 60000);
                    console.log(`[Scheduler] Rename de guilda em cooldown. Restam ${waitMin}min.`);
                }
            }
            // Sincroniza lista no chat de texto do canal
            await syncOnlineListToChannel(config.onlineGuildChannelId, state.guildMembers || [], config.guildName || 'Ascended', false, state.dailyStats).catch(() => {});
        } catch (e) {
            console.error('[Scheduler] Erro ao atualizar canal de voz da guilda:', e.message);
        }
    }

    // 2. Enemy counter channel
    if (config.onlineEnemyChannelId) {
        try {
            let enemyCount = 0;
            if (config.enemyGuildName && state.enemyGuildMembers) {
                enemyCount = state.enemyGuildMembers.filter(m => m.status === 'Online').length;
            } else {
                enemyCount = state.huntedOnlineAlerted.size;
            }
            const newName = `🔴 Inimigos: ${enemyCount} Online`;
            
            const channel = await client.channels.fetch(config.onlineEnemyChannelId);
            if (channel && channel.name !== newName) {
                if (force || now - trackers.lastEnemyCounterUpdate >= COOLDOWN) {
                    channel.setName(newName)
                        .then(() => console.log(`[Scheduler] Canal de voz dos inimigos atualizado para: "${newName}"`))
                        .catch(err => console.error('[Scheduler] Erro ao renomear canal dos inimigos:', err.message));
                    trackers.lastEnemyCounterUpdate = now;
                } else {
                    const waitMin = Math.ceil((COOLDOWN - (now - trackers.lastEnemyCounterUpdate)) / 60000);
                    console.log(`[Scheduler] Rename de inimigos em cooldown. Restam ${waitMin}min.`);
                }
            }
            // Sincroniza lista no chat de texto do canal
            const enemyList = config.enemyGuildName ? (state.enemyGuildMembers || []) : Array.from(state.huntedOnlineAlerted).map(name => ({ name, status: 'Online', level: '?', vocation: '?' }));
            await syncOnlineListToChannel(config.onlineEnemyChannelId, enemyList, config.enemyGuildName || 'Inimigos', true, {}).catch(() => {});
        } catch (e) {
            console.error('[Scheduler] Erro ao atualizar canal de voz dos inimigos:', e.message);
        }
    }
}

async function updateGamificationRoles(guild) {
    if (!guild) return null;
    console.log('[Scheduler] Executando atualização de cargos de gamificação (Temporada/Mensal)...');
    try {
        const getOrCreateHoistedRole = async (name, color, reason) => {
            let role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
            if (!role) {
                try {
                    role = await guild.roles.create({
                        name,
                        color,
                        hoist: true,
                        reason
                    });
                    console.log(`[Scheduler] Cargo de gamificação criado: ${name}`);
                } catch (err) {
                    console.error(`[Scheduler] Erro ao criar cargo ${name}:`, err.message);
                }
            } else {
                if (!role.hoist) {
                    await role.edit({ hoist: true }).catch(() => {});
                }
            }
            return role;
        };

        const carrascoRole = await getOrCreateHoistedRole('Carrasco do Mês', '#E74C3C', 'Título para o maior matador de inimigos dos últimos 30 dias.');
        const presencaRole = await getOrCreateHoistedRole('Presença de Ferro', '#2980B9', 'Título para o aliado com mais presença em voz nos últimos 30 dias.');
        const xpRole = await getOrCreateHoistedRole('XP Maker Lendário', '#F1C40F', 'Título para o aliado com mais XP ganho nos últimos 30 dias.');

        const sinceDate = db.dateDaysAgo(30);
        const sinceTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000;

        const topFragWinner = db.getTopFraggedPlayer(sinceDate);
        const topVoiceWinner = db.getTopVoicePlayer(sinceTimestamp);
        const topXpWinner = db.getTopXpPlayer(sinceDate);

        const syncRoleWinner = async (role, winnerId) => {
            if (!role) return null;
            
            const currentHolders = guild.members.cache.filter(m => m.roles.cache.has(role.id));
            
            if (winnerId) {
                for (const [id, member] of currentHolders) {
                    if (id !== winnerId) {
                        await member.roles.remove(role).catch(() => {});
                        console.log(`[Scheduler] Removido cargo ${role.name} de <@${id}>.`);
                    }
                }
                
                const winnerMember = guild.members.cache.get(winnerId) || await guild.members.fetch(winnerId).catch(() => null);
                if (winnerMember) {
                    if (!winnerMember.roles.cache.has(role.id)) {
                        await winnerMember.roles.add(role).catch(() => {});
                        console.log(`[Scheduler] Adicionado cargo ${role.name} para <@${winnerId}>.`);
                    }
                    return winnerId;
                }
            } else {
                for (const [id, member] of currentHolders) {
                    await member.roles.remove(role).catch(() => {});
                    console.log(`[Scheduler] Limpando cargo ${role.name} de <@${id}> (sem ganhador).`);
                }
            }
            return null;
        };

        const finalCarrasco = await syncRoleWinner(carrascoRole, topFragWinner);
        const finalPresenca = await syncRoleWinner(presencaRole, topVoiceWinner);
        const finalXp = await syncRoleWinner(xpRole, topXpWinner);

        return {
            carrasco: finalCarrasco,
            presenca: finalPresenca,
            xp: finalXp
        };
    } catch (err) {
        console.error('[Scheduler] Erro em updateGamificationRoles:', err.message);
        return null;
    }
}

function getTrackedPlayerCaseInsensitive(charName) {
    if (!charName) return null;
    const lowerName = charName.toLowerCase();
    for (const key of Object.keys(state.trackedPlayers)) {
        if (key.toLowerCase() === lowerName) {
            return state.trackedPlayers[key];
        }
    }
    return null;
}

async function checkPlanilhadoRoutines(guild) {
    if (!client) return;
    const todayStr = db.todayDate();

    const activeSchedules = db.getActiveSchedules();
    if (!activeSchedules || activeSchedules.length === 0) return;

    for (const s of activeSchedules) {
        const timeMatch = s.time_slot.match(/^([0-9]{2}):([0-9]{2})-([0-9]{2}):([0-9]{2})$/);
        if (!timeMatch) continue;

        const startHour = parseInt(timeMatch[1], 10);
        const startMin = parseInt(timeMatch[2], 10);

        const startToday = new Date();
        startToday.setHours(startHour, startMin, 0, 0);
        
        // Ajuste para cruzamento de meia-noite (se o slot inicia nas primeiras horas do dia seguinte)
        if (Date.now() - startToday.getTime() > 12 * 60 * 60 * 1000) {
            startToday.setDate(startToday.getDate() + 1);
        }

        const startTimeMs = startToday.getTime();
        const nowMs = Date.now();

        // 1. Auditoria de Check-in (15 minutos após o início do horário)
        const checkInDeadlineMs = startTimeMs + 15 * 60 * 1000;
        const existingAttendance = db.getAttendance(s.id, todayStr);

        if (!existingAttendance && nowMs > checkInDeadlineMs) {
            console.log(`[Planilhado] Check-in perdido detectado para o planilhado ID ${s.id} (Hunt: ${s.respawn_id}, Horário: ${s.time_slot}) hoje.`);

            // Marca a falta no banco
            db.db.prepare('INSERT OR IGNORE INTO hunts_schedule_attendance (schedule_id, date, checked_in) VALUES (?, ?, 0)').run(s.id, todayStr);

            const { findRespawn } = require('./planilhadoManager');
            const resp = findRespawn(s.respawn_id);
            const respName = resp ? resp.name : s.respawn_id;
            const category = resp ? resp.category : 'Planilhados';

            // Cancela a reserva se houver claim ativo
            const activeClaim = db.getClaimByRespawn(s.respawn_id);
            if (activeClaim && activeClaim.player_id === s.leader_discord_id) {
                db.deleteClaim(s.respawn_id);
                console.log(`[Planilhado] Claim ativo do líder ${s.leader_discord_id} removido por falta de check-in.`);
            }

            const alertMsg = `❌ **Falta de Check-in (Planilhado):** Você não confirmou presença para a caçada no respawn **${respName}** (\`${s.respawn_id}\`) no horário **${s.time_slot}** hoje. Sua reserva diária foi cancelada para o dia de hoje.`;
            try {
                const leaderUser = await client.users.fetch(s.leader_discord_id).catch(() => null);
                if (leaderUser) {
                    await leaderUser.send(alertMsg);
                }
            } catch (dmErr) {
                console.warn(`[Planilhado] Falha ao notificar líder ${s.leader_discord_id} por DM:`, dmErr.message);
            }

            try {
                const reg = db.getRegisteredMember(s.leader_discord_id);
                if (reg && reg.phone) {
                    const whatsapp = require('./whatsapp');
                    await whatsapp.sendWhatsAppMessage(reg.phone, alertMsg);
                }
            } catch (waErr) {
                console.warn(`[Planilhado] Falha ao enviar WhatsApp para líder ${s.leader_discord_id}:`, waErr.message);
            }

            const commandsChanId = config.claimCommandsChannelId;
            if (commandsChanId) {
                try {
                    const channel = await client.channels.fetch(commandsChanId).catch(() => null);
                    if (channel?.isTextBased()) {
                        const embed = new EmbedBuilder()
                            .setColor(0xe74c3c)
                            .setTitle('❌ Reserva Diária Cancelada (Falta de Check-in)')
                            .setDescription(
                                `O planilhado do respawn **${respName}** (\`${s.respawn_id}\`) no horário **${s.time_slot}** foi liberado hoje porque o líder <@${s.leader_discord_id}> não confirmou presença a tempo (janela de check-in encerrada).`
                            )
                            .setTimestamp();
                        await channel.send({ embeds: [embed] });
                    }
                } catch (chanErr) {
                    console.error('[Planilhado] Erro ao enviar aviso de falta no canal de comandos:', chanErr.message);
                }
            }

            await promoteNextInQueue(s.respawn_id, respName, category);
            await updateLiveDashboard();
        }

        // 2. Auditoria de Caçada (30 minutos após o início do horário)
        if (existingAttendance && existingAttendance.checked_in === 1) {
            state.planilhadoAuditedToday = state.planilhadoAuditedToday || new Set();
            const auditKey = `${s.id}|${todayStr}`;

            const auditTimeMs = startTimeMs + 30 * 60 * 1000;
            const auditTimeoutMs = startTimeMs + 90 * 60 * 1000;

            if (!state.planilhadoAuditedToday.has(auditKey) && nowMs >= auditTimeMs && nowMs < auditTimeoutMs) {
                state.planilhadoAuditedToday.add(auditKey);
                console.log(`[Planilhado] Iniciando auditoria de atividade para planilhado ID ${s.id} (Hunt: ${s.respawn_id})...`);

                const partyDiscordIds = [s.leader_discord_id, ...s.member_ids.split(',').filter(Boolean)];
                const inactiveMembers = [];
                const offlineMembers = [];

                for (const discordId of partyDiscordIds) {
                    const reg = db.getRegisteredMember(discordId);
                    if (!reg) {
                        offlineMembers.push(`<@${discordId}> (Não registrado no bot)`);
                        continue;
                    }

                    const tracked = getTrackedPlayerCaseInsensitive(reg.char_name);
                    if (!tracked) {
                        offlineMembers.push(`<@${discordId}> (${reg.char_name} - Dados offline no cache)`);
                        continue;
                    }

                    const isOnline = tracked.status === 'Online';
                    const isHunting = tracked.isHunting === true;

                    if (!isOnline) {
                        offlineMembers.push(`<@${discordId}> (${reg.char_name} - Offline no Tibia)`);
                    } else if (!isHunting) {
                        inactiveMembers.push(`<@${discordId}> (${reg.char_name} - Online, mas sem detectar ganho de XP)`);
                    }
                }

                if (offlineMembers.length > 0 || inactiveMembers.length > 0) {
                    const adminChanId = config.planilhadoAdminChannelId;
                    if (adminChanId) {
                        try {
                            const channel = await client.channels.fetch(adminChanId).catch(() => null);
                            if (channel?.isTextBased()) {
                                const embed = new EmbedBuilder()
                                    .setColor(0xe74c3c)
                                    .setTitle('⚠️ Alerta: Suspeita de Vaga Fantasma (Planilhado)')
                                    .setDescription(
                                        `Auditoria realizada 30 minutos após o início do planilhado.\n\n` +
                                        `📍 **Respawn:** \`${s.respawn_id}\` · ⏰ **Horário:** \`${s.time_slot}\`\n` +
                                        `👑 **Líder:** <@${s.leader_discord_id}>\n\n` +
                                        (offlineMembers.length > 0 ? `🔴 **Membros Offline:**\n${offlineMembers.join('\n')}\n\n` : '') +
                                        (inactiveMembers.length > 0 ? `⏳ **Membros Inativos (Sem ganhar XP):**\n${inactiveMembers.join('\n')}\n\n` : '') +
                                        `*Por favor, verifiquem se a PT está realmente caçando no local.*`
                                    )
                                    .setTimestamp();
                                await channel.send({ embeds: [embed] });
                                console.log(`[Planilhado] Alerta de Vaga Fantasma enviado para o canal de administração para o respawn ${s.respawn_id}.`);
                            }
                        } catch (errAdmin) {
                            console.error('[Planilhado] Erro ao enviar alerta de vaga fantasma:', errAdmin.message);
                        }
                    }
                } else {
                    console.log(`[Planilhado] Auditoria concluída com sucesso para o respawn ${s.respawn_id}: todos os membros ativos caçando.`);
                }
            }
        }

        // 3. Pré-Alerta de Planilhado (1 hora antes do início do horário)
        state.planilhadoPreAlertedToday = state.planilhadoPreAlertedToday || new Set();
        const preAlertKey = `${s.id}|${todayStr}`;
        const timeLeftMs = startTimeMs - nowMs;
        const fiftyMinMs = 50 * 60 * 1000;
        const sixtyFiveMinMs = 65 * 60 * 1000;

        if (!state.planilhadoPreAlertedToday.has(preAlertKey) && timeLeftMs >= fiftyMinMs && timeLeftMs <= sixtyFiveMinMs) {
            const attendance = db.getAttendance(s.id, todayStr);
            if (!attendance || attendance.checked_in !== 1) {
                state.planilhadoPreAlertedToday.add(preAlertKey);
                console.log(`[Planilhado] Enviando pré-alerta de 1h para líder ${s.leader_discord_id} do planilhado ID ${s.id}.`);
                
                const { findRespawn } = require('./planilhadoManager');
                const resp = findRespawn(s.respawn_id);
                const respName = resp ? resp.name : s.respawn_id;
                
                const preAlertMsg = `📅 *Alerta de Caçada Ascended* 📅\n\n` +
                    `Líder, seu planilhado no respawn *${respName}* (${s.respawn_id}) começa em aproximadamente *1 hora* (às ${timeMatch[1]}:${timeMatch[2]}).\n\n` +
                    `👉 Responda com *OK*, *1*, *confirmar*, *checkin* ou *presenca* para confirmar sua presença e reservar o respawn automaticamente.`;

                try {
                    const reg = db.getRegisteredMember(s.leader_discord_id);
                    if (reg && reg.phone) {
                        const whatsapp = require('./whatsapp');
                        await whatsapp.sendWhatsAppMessage(reg.phone, preAlertMsg);
                    }
                } catch (waErr) {
                    console.warn(`[Planilhado] Falha ao enviar WhatsApp de pré-alerta para líder ${s.leader_discord_id}:`, waErr.message);
                }
            }
        }
    }
}

async function checkPlanilhadoRotation(guild) {
    if (!client) return;

    const activeSchedules = db.getActiveSchedules();
    if (!activeSchedules || activeSchedules.length === 0) return;

    const CYCLE_MS = 15 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const { findRespawn, updatePlanilhadoListDashboard } = require('./planilhadoManager');

    let updatedAny = false;

    for (const oldPt of activeSchedules) {
        const elapsed = nowMs - oldPt.last_active_at;
        if (elapsed >= CYCLE_MS) {
            const resp = findRespawn(oldPt.respawn_id);
            const respName = resp ? resp.name : oldPt.respawn_id;

            const nextPt = db.db.prepare(
                'SELECT * FROM hunts_schedule WHERE LOWER(respawn_id) = LOWER(?) AND time_slot = ? AND active = 0 ORDER BY created_at ASC LIMIT 1'
            ).get(oldPt.respawn_id, oldPt.time_slot);

            if (nextPt) {
                db.db.prepare('UPDATE hunts_schedule SET active = 0, created_at = ? WHERE id = ?').run(nowMs, oldPt.id);
                db.activateSchedule(nextPt.id);
                updatedAny = true;

                console.log(`[Planilhado Rotation] Rotação efetuada no respawn ${oldPt.respawn_id} (${oldPt.time_slot}): PT de ${oldPt.leader_discord_id} -> PT de ${nextPt.leader_discord_id}`);

                const oldMsg = `🔄 **Rotação de Planilhado:** O ciclo de 15 dias da sua PT para o respawn **${respName}** (\`${oldPt.respawn_id}\`) no horário **${oldPt.time_slot}** terminou. Sua PT foi colocada na fila de espera para a próxima rotação.`;
                try {
                    const oldLeader = await client.users.fetch(oldPt.leader_discord_id).catch(() => null);
                    if (oldLeader) await oldLeader.send(oldMsg);
                } catch {}
                try {
                    const reg = db.getRegisteredMember(oldPt.leader_discord_id);
                    if (reg && reg.phone) {
                        const whatsapp = require('./whatsapp');
                        await whatsapp.sendWhatsAppMessage(reg.phone, oldMsg);
                    }
                } catch {}

                const newMsg = `🎉 **Planilhado Ativado:** Sua PT foi promovida da fila de espera! A reserva diária do respawn **${respName}** (\`${nextPt.respawn_id}\`) no horário **${nextPt.time_slot}** está ativa para você pelos próximos 15 dias. Lembre-se de fazer o check-in diariamente!`;
                try {
                    const newLeader = await client.users.fetch(nextPt.leader_discord_id).catch(() => null);
                    if (newLeader) await newLeader.send(newMsg);
                } catch {}
                try {
                    const reg = db.getRegisteredMember(nextPt.leader_discord_id);
                    if (reg && reg.phone) {
                        const whatsapp = require('./whatsapp');
                        await whatsapp.sendWhatsAppMessage(reg.phone, newMsg);
                    }
                } catch {}
            } else {
                db.db.prepare('UPDATE hunts_schedule SET last_active_at = ? WHERE id = ?').run(nowMs, oldPt.id);
                updatedAny = true;

                console.log(`[Planilhado Rotation] Planilhado no respawn ${oldPt.respawn_id} (${oldPt.time_slot}) renovado automaticamente para ${oldPt.leader_discord_id} por falta de fila.`);

                const renewMsg = `🔄 **Planilhado Renovado:** Como não há outras PTs na fila de espera, o ciclo de 15 dias da sua PT para o respawn **${respName}** (\`${oldPt.respawn_id}\`) no horário **${oldPt.time_slot}** foi renovado automaticamente por mais 15 dias!`;
                try {
                    const leader = await client.users.fetch(oldPt.leader_discord_id).catch(() => null);
                    if (leader) await leader.send(renewMsg);
                } catch {}
                try {
                    const reg = db.getRegisteredMember(oldPt.leader_discord_id);
                    if (reg && reg.phone) {
                        const whatsapp = require('./whatsapp');
                        await whatsapp.sendWhatsAppMessage(reg.phone, renewMsg);
                    }
                } catch {}
            }
        }
    }

    if (updatedAny) {
        await updatePlanilhadoListDashboard(guild);
    }
}

async function checkWeeklyHallOfFame() {
    const now = new Date();
    // Monday is day 1. Hour is 10. Minute is 00.
    if (now.getDay() !== 1 || now.getHours() !== 10 || now.getMinutes() !== 0) {
        return;
    }

    const currentWeek = getISOWeekString(now);
    const lastSentWeek = db.getConfig('lastWeeklyHallOfFameSentWeek');
    if (lastSentWeek === currentWeek) {
        return; // Already sent this week
    }

    console.log(`[Scheduler] Iniciando geração do Hall da Fama Semanal para a semana ${currentWeek}...`);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const sinceTs7 = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // 1. XP Makers
    const topXp = db.db.prepare(`
        SELECT rm.discord_id, rm.char_name, SUM(ds.gain_xp) as total_xp
        FROM daily_stats ds
        JOIN registered_members rm ON LOWER(ds.name) = LOWER(rm.char_name) OR LOWER(ds.name) = LOWER(rm.bomba)
        WHERE ds.date >= ? AND ds.gain_xp > 0
        GROUP BY rm.discord_id
        ORDER BY total_xp DESC
        LIMIT 3
    `).all(sevenDaysAgo);

    // 2. PvP Fraggers
    const topFrags = db.db.prepare(`
        SELECT rm.discord_id, rm.char_name, COUNT(*) as total_frags
        FROM frags f
        JOIN registered_members rm ON LOWER(f.killer_name) = LOWER(rm.char_name) OR LOWER(f.killer_name) = LOWER(rm.bomba)
        WHERE f.date >= ?
        GROUP BY rm.discord_id
        ORDER BY total_frags DESC
        LIMIT 3
    `).all(sevenDaysAgo);

    // 3. Voice Active Members
    const topVoice = db.db.prepare(`
        SELECT rm.discord_id, rm.char_name,
               SUM(CASE WHEN vs.end_time IS NOT NULL THEN (vs.end_time - vs.start_time) ELSE (? - vs.start_time) END) as total_ms
        FROM voice_sessions vs
        JOIN registered_members rm ON vs.discord_id = rm.discord_id
        WHERE vs.start_time >= ?
        GROUP BY rm.discord_id
        ORDER BY total_ms DESC
        LIMIT 3
    `).all(now.getTime(), sinceTs7);

    // Format fields
    const medals = ['🥇', '🥈', '🥉'];
    
    const xpLines = topXp.length 
        ? topXp.map((r, i) => `${medals[i]} <@${r.discord_id}> (${r.char_name}) · **+${embeds.formatXp(r.total_xp)} XP**`)
        : ['_Nenhum XP ganho por membros registrados esta semana._'];

    const fragLines = topFrags.length
        ? topFrags.map((r, i) => `${medals[i]} <@${r.discord_id}> (${r.char_name}) · **${r.total_frags} ${r.total_frags === 1 ? 'frag' : 'frags'}**`)
        : ['_Nenhum frag registrado por membros registrados esta semana._'];

    const voiceLines = topVoice.length
        ? topVoice.map((r, i) => {
            const h = Math.floor(r.total_ms / 3600000);
            const m = Math.floor((r.total_ms % 3600000) / 60000);
            return `${medals[i]} <@${r.discord_id}> (${r.char_name}) · **${h}h ${m}m**`;
        })
        : ['_Nenhum tempo em voz registrado por membros registrados esta semana._'];

    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(`🏆 HALL DA FAMA SEMANAL — ${config.guildName || 'Ascended'} 🏆`)
        .setDescription(`Estes são os membros que mais se destacaram nos últimos 7 dias na nossa guilda!\nParabéns a todos os vencedores pelo empenho e dedicação! 🎉`)
        .addFields(
            { name: '⚡ Maior XP Conquistada (Soma da Semana)', value: xpLines.join('\n'), inline: false },
            { name: '🩸 Maior Número de Frags PvP (Semana)', value: fragLines.join('\n'), inline: false },
            { name: '🎙️ Membro Mais Ativo em Voz (Discord)', value: voiceLines.join('\n'), inline: false }
        )
        .setFooter({ text: 'Ascended Bot • RubinOT', iconURL: 'https://rubinot.com.br/favicon.ico' })
        .setTimestamp();

    const channelId = config.announcementChannelId;
    if (channelId) {
        await sendToChannel(channelId, embed);
        db.setConfig('lastWeeklyHallOfFameSentWeek', currentWeek);
        console.log(`[Scheduler] Hall da Fama Semanal enviado e registrado para a semana ${currentWeek}.`);
    } else {
        console.warn(`[Scheduler] Canal de anúncios (announcementChannelId) não configurado. Não foi possível enviar o Hall da Fama.`);
    }
}

function getISOWeekString(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

async function getOrCreateBackupChannel(guild) {
    let adminCategory = guild.channels.cache.find(c => 
        (c.name.toLowerCase().includes('admin') || c.name.toLowerCase().includes('staff')) && 
        c.type === ChannelType.GuildCategory
    );

    if (!adminCategory) {
        try {
            adminCategory = await guild.channels.create({
                name: '🔒 ADMIN',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: guild.client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    }
                ]
            });
            const adminRoleId = config.adminRoleId;
            if (adminRoleId) {
                await adminCategory.permissionOverwrites.create(adminRoleId, {
                    ViewChannel: true,
                    SendMessages: true
                }).catch(() => {});
            }
        } catch (err) {
            console.error('[Backup] Erro ao criar categoria ADMIN:', err.message);
        }
    }

    const parentId = adminCategory ? adminCategory.id : null;

    let backupChannel = guild.channels.cache.find(c => 
        c.name === 'backup' && 
        c.type === ChannelType.GuildText && 
        c.parentId === parentId
    );

    if (!backupChannel) {
        try {
            backupChannel = await guild.channels.create({
                name: 'backup',
                type: ChannelType.GuildText,
                parent: parentId,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: guild.client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    }
                ]
            });
            const adminRoleId = config.adminRoleId;
            if (adminRoleId) {
                await backupChannel.permissionOverwrites.create(adminRoleId, {
                    ViewChannel: true,
                    SendMessages: true,
                    AttachFiles: true
                }).catch(() => {});
            }
            console.log('[Backup] Canal "backup" criado com sucesso.');
        } catch (err) {
            console.error('[Backup] Erro ao criar canal backup:', err.message);
        }
    }

    return backupChannel;
}

async function checkDailyBackup() {
    const now = new Date();
    if (now.getHours() !== 4 || now.getMinutes() !== 0) {
        return;
    }

    const todayStr = db.todayDate();
    const lastBackupDate = db.getConfig('lastDailyBackupDate');
    if (lastBackupDate === todayStr) {
        return;
    }

    console.log(`[Scheduler] Iniciando backup diário do banco de dados (${todayStr})...`);

    const guild = getCurrentGuild(client);
    if (!guild) {
        console.warn('[Scheduler] Nenhuma guilda encontrada para gerar backup.');
        return;
    }

    const backupChannel = await getOrCreateBackupChannel(guild);
    if (!backupChannel) {
        console.error('[Scheduler] Não foi possível encontrar ou criar o canal de backup.');
        return;
    }

    const path = require('path');
    const fs = require('fs');
    const { AttachmentBuilder } = require('discord.js');

    const backupFile = path.join(__dirname, '..', 'data', `backup-${todayStr}.db`);

    try {
        await db.db.backup(backupFile);

        const attachment = new AttachmentBuilder(backupFile, { name: `backup-${todayStr}.db` });

        const embed = new EmbedBuilder()
            .setColor(0x44FF88)
            .setTitle('💾 Backup Diário do Banco de Dados')
            .setDescription(`O backup do banco de dados SQLite foi gerado e enviado com sucesso.\n\n📅 **Data:** \`${new Date().toLocaleDateString('pt-BR')}\`\n🕒 **Horário:** \`04:00\``)
            .setFooter({ text: 'Ascended Bot • Backup Automatizado' })
            .setTimestamp();

        await backupChannel.send({ embeds: [embed], files: [attachment] });

        db.setConfig('lastDailyBackupDate', todayStr);
        console.log(`[Scheduler] Backup diário enviado e registrado para o dia ${todayStr}.`);
    } catch (err) {
        console.error('[Scheduler] Falha ao gerar ou enviar o backup diário:', err.message);
    } finally {
        if (fs.existsSync(backupFile)) {
            try { fs.unlinkSync(backupFile); } catch {}
        }
    }
}

async function checkGamificationVoiceCoins() {
    const guild = getCurrentGuild(client);
    if (!guild) return;

    const { getWarVoiceChannelId } = require('./configHelpers');
    const warChannelId = getWarVoiceChannelId(config);

    const nowHour = new Date().getHours();
    const isNight = nowHour >= 2 && nowHour < 6;

    const voiceStates = guild.voiceStates.cache;
    for (const [memberId, voiceState] of voiceStates.entries()) {
        if (!voiceState.channelId) continue;

        const member = voiceState.member || await guild.members.fetch(memberId).catch(() => null);
        if (!member || member.user.bot) continue;

        // Verify if member is registered
        const reg = db.getRegisteredMember(memberId);
        if (!reg) continue;

        const channel = voiceState.channel || await guild.channels.fetch(voiceState.channelId).catch(() => null);
        if (!channel) continue;

        // Skip AFK channel
        const isAfkChannel = (channel.id === guild.afkChannelId) || /afk|ausente/i.test(channel.name);
        if (isAfkChannel) continue;

        const isWar = warChannelId && voiceState.channelId === warChannelId;
        
        // 1. Increment minutes and stats in DB
        db.incrementVoiceTimeStats(memberId, isWar ? 1 : 0, isNight ? 1 : 0);

        // 2. Grant Voice XP (10 XP per minute)
        db.addGuildXp(memberId, 10, guild);

        // 3. Award coins with Level Multiplier (+2% per level above 1)
        const ratePerHour = isWar ? 25.0 : 10.0;
        const level = reg.guild_level || 1;
        const multiplier = 1 + (level - 1) * 0.02;
        const coinsToAdd = (ratePerHour / 60.0) * multiplier;

        db.addCoins(memberId, coinsToAdd);

        // 4. Check achievements
        try {
            const achievements = require('./achievements');
            await achievements.checkVoiceAchievements(memberId, guild, config.reportChannelId || config.claimCommandsChannelId);
            await achievements.checkNightVoiceAchievements(memberId, guild, config.reportChannelId || config.claimCommandsChannelId);
        } catch (errAch) {
            console.error('[Scheduler] Erro ao processar conquistas de voz para', reg.char_name, errAch.message);
        }
    }
}

async function checkGamificationRaffles() {
    const activeRaffles = db.getActiveRaffles();
    if (activeRaffles.length === 0) return;

    const now = Date.now();
    for (const raffle of activeRaffles) {
        if (raffle.ends_at > now) continue;

        try {
            console.log(`[Scheduler] Finalizando sorteio ID #${raffle.id}: "${raffle.title}"`);
            
            // Get all tickets
            const tickets = db.getRaffleTickets(raffle.id);
            const totalTickets = tickets.length;

            const guild = client.guilds.cache.find(g => g.channels.cache.has(raffle.channel_id)) || client.guilds.cache.first();
            if (!guild) continue;

            const channel = await guild.channels.fetch(raffle.channel_id).catch(() => null);
            if (!channel) {
                console.error(`[Scheduler] Canal do sorteio ${raffle.channel_id} não encontrado.`);
                continue;
            }

            const message = await channel.messages.fetch(raffle.message_id).catch(() => null);

            if (totalTickets === 0) {
                db.finishRaffle(raffle.id, null, null);

                if (message) {
                    const embed = EmbedBuilder.from(message.embeds[0])
                        .setColor(0x7F8C8D) // Grey
                        .setDescription(`❌ **Sorteio Encerrado**\n\nNenhum participante comprou bilhetes para este sorteio.\n\nPreço por ticket: **${raffle.ticket_cost} AC**`);
                    await message.edit({ embeds: [embed], components: [] }).catch(() => {});
                }
                
                await channel.send(`⚠️ O sorteio **${raffle.title}** foi encerrado sem nenhum bilhete comprado.`);
                continue;
            }

            // Pick winner
            const winnerTicket = tickets[Math.floor(Math.random() * tickets.length)];
            const winnerId = winnerTicket.discord_id;

            db.finishRaffle(raffle.id, winnerId, winnerTicket.id);

            // Edit original message
            if (message) {
                const embed = EmbedBuilder.from(message.embeds[0])
                    .setColor(0x2ECC71) // Green
                    .setDescription(
                        `🎉 **Sorteio Encerrado!**\n\n` +
                        `🏆 **Vencedor:** <@${winnerId}>\n` +
                        `🎟️ **Ticket Sorteado:** \`#${winnerTicket.id}\` (de ${totalTickets} bilhetes)\n\n` +
                        `Preço por ticket: **${raffle.ticket_cost} AC**`
                    );
                await message.edit({ embeds: [embed], components: [] }).catch(() => {});
            }

            await channel.send(`🎉 **PARABÉNS!** <@${winnerId}> ganhou o sorteio **${raffle.title}**! (Bilhete premiado: \`#${winnerTicket.id}\` de um total de ${totalTickets} bilhetes) 🏆`);
        } catch (err) {
            console.error(`[Scheduler] Erro ao processar finalização do sorteio #${raffle.id}:`, err.message);
        }
    }
}

async function checkGamificationExpiredRoles() {
    const expired = db.getExpiredShopRoles();
    if (expired.length === 0) return;

    for (const record of expired) {
        try {
            const guild = client.guilds.cache.find(g => g.roles.cache.has(record.role_id)) || client.guilds.cache.first();
            if (!guild) continue;

            console.log(`[Scheduler] Removendo cargo cosmético expirado ${record.role_id} do usuário ${record.discord_id}`);
            const member = await guild.members.fetch(record.discord_id).catch(() => null);
            if (member) {
                await member.roles.remove(record.role_id).catch(() => {});
            }
            db.deleteShopRole(record.id);
        } catch (err) {
            console.error(`[Scheduler] Erro ao remover cargo cosmético ${record.role_id} do usuário ${record.discord_id}:`, err.message);
        }
    }
}

async function checkGamificationRaids() {
    if (!state.rpgMinigameEnabled) return;
    if (state.activeBoss || state.activeInvasion) return;

    const now = Date.now();
    let lastSpawn = db.getConfig('lastBossSpawnTime') || 0;
    lastSpawn = parseInt(lastSpawn, 10);

    const minutesSince = (now - lastSpawn) / 60000;
    if (minutesSince < 120) return; // 2 hours cooldown min

    // Risk increases 0.05% per minute after 2h cooldown
    let chance = ((minutesSince - 120) * 0.0005);
    if (chance > 0.1) chance = 0.1; // Cap at 10% per minute

    if (Math.random() < chance) {
        await spawnRaidBoss();
    }
}

async function spawnRaidBoss(forced = false) {
    if (!forced) {
        db.setConfig('lastBossSpawnTime', Date.now());
    }

    const BOSSES = [
        { name: 'Ghazbaran', icon: '❄️', maxHp: 20000, color: 0x00D2FF, desc: 'O Senhor das Lâminas de Gelo desperta!' },
        { name: 'Morgaroth', icon: '🔥', maxHp: 25000, color: 0xFF3300, desc: 'O Conspirador do Triângulo do Terror surge das profundezas!' },
        { name: 'Ferumbras', icon: '🧙‍♂️', maxHp: 35000, color: 0x9B59B6, desc: 'O Mago Ascendido retorna à sua torre!' },
        { name: 'Orshabaal', icon: '👹', maxHp: 15000, color: 0xE67E22, desc: 'O Senhor dos Demônios espalha o terror!' }
    ];

    const boss = BOSSES[Math.floor(Math.random() * BOSSES.length)];

    // Find general chat
    const guild = client.guilds.cache.find(g => g.channels.cache.some(c => c.name.includes('invasoes-e-raids'))) || client.guilds.cache.first();
    if (!guild) {
        console.error('[Raids] Nenhuma guilda encontrada para spawnar o boss.');
        return;
    }

    // Busca canal configurado, senão tenta por nome (minigame/rpg/boss), nunca o geral
    let channel = null;

    // 1) Canal salvo nas configs
    const savedChannelId = db.getConfig('invasionChannelId');
    if (savedChannelId) {
        channel = guild.channels.cache.get(savedChannelId) || null;
    }

    // 2) Busca por nome de minigame/rpg/boss
    if (!channel) {
        channel = guild.channels.cache.find(c =>
            c.type === ChannelType.GuildText &&
            /minigame|mini-game|rpg|boss|batalha|adventure|aventura/i.test(c.name)
        ) || null;
    }

    // 3) Fallback: busca específica para evitar canais gerais ou aleatórios
    if (!channel) {
        channel = guild.channels.cache.find(c =>
            c.type === ChannelType.GuildText &&
            /invasoes|raids|boss|rpg|minigame/i.test(c.name)
        ) || null;
    }

    if (!channel) {
        console.error('[Raids] Nenhum canal de texto encontrado para spawnar o boss.');
        return;
    }

    // Build progress bar
    const bar = '█'.repeat(10);
    
    const embed = new EmbedBuilder()
        .setColor(boss.color)
        .setTitle(`${boss.icon} INVASÃO DE BOSS: ${boss.name}!`)
        .setDescription(`⚠️ **${boss.desc}**\n\n**${boss.name}** invadiu o chat geral! Digite **\`!atacar\`** para desferir golpes no Boss!\nVocês têm **10 minutos** para derrotá-lo antes que ele escape!`)
        .addFields(
            { name: '❤️ Vida', value: `\`[${bar}]\` (100%)\n${boss.maxHp.toLocaleString()} / ${boss.maxHp.toLocaleString()} HP`, inline: false },
            { name: '🥇 Top 5 Dano', value: 'Nenhum dano causado ainda.', inline: false }
        )
        .setFooter({ text: 'Ascended Raids • Cooldown de ataque: 10 segundos' })
        .setTimestamp();

    const aethelgardRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'aethelgard');
    const pingText = aethelgardRole ? `<@&${aethelgardRole.id}> 🚨 **BOSS INVASION!** 🚨` : '🚨 **BOSS INVASION!** 🚨';

    const message = await channel.send({ content: pingText, embeds: [embed] }).catch(() => null);
    if (!message) {
        console.error('[Raids] Falha ao enviar mensagem do boss no canal.');
        return;
    }

    // Clear any existing boss escape timeout to avoid leaks
    if (state.activeBoss && state.activeBoss.escapeTimeout) {
        clearTimeout(state.activeBoss.escapeTimeout);
    }

    state.activeBoss = {
        name: boss.name,
        icon: boss.icon,
        maxHp: boss.maxHp,
        hp: boss.maxHp,
        color: boss.color,
        spawnTime: Date.now(),
        players: {}, // { userId: { name, damage, lastAttack } }
        channelId: channel.id,
        messageId: message.id,
        escapeTimeout: setTimeout(() => handleBossEscape(), 10 * 60 * 1000) // 10 minutes
    };

    console.log(`[Raids] Boss ${boss.name} spawnado no canal ${channel.name} (${channel.id}). Message ID: ${message.id}`);
}

async function handleBossEscape() {
    if (!state.activeBoss) return;
    const boss = state.activeBoss;
    console.log(`[Raids] Boss ${boss.name} escapou!`);

    try {
        const guild = client.guilds.cache.find(g => g.channels.cache.has(boss.channelId)) || client.guilds.cache.first();
        if (guild) {
            const channel = await guild.channels.fetch(boss.channelId).catch(() => null);
            if (channel) {
                const message = await channel.messages.fetch(boss.messageId).catch(() => null);
                if (message) {
                    const embed = EmbedBuilder.from(message.embeds[0])
                        .setColor(0x7F8C8D) // Grey
                        .setTitle(`💨 FUGA: O ${boss.name} escapou!`)
                        .setDescription(`O tempo limite de 10 minutos acabou e o Boss **${boss.name}** escapou de volta para as sombras...`)
                        .setFields([]); // clear HP/Leaderboard fields
                    await message.edit({ embeds: [embed] }).catch(() => {});
                }
            }
        }
    } catch (err) {
        console.error('[Raids] Erro ao processar fuga do boss:', err.message);
    }

    state.activeBoss = null;
}

async function checkCityInvasions() {
    if (!state.rpgMinigameEnabled) return;
    if (state.activeBoss || state.activeInvasion) return;

    const now = new Date();
    const hour = now.getHours();
    
    // Horários fixos para Invasão: 10h, 15h, 20h
    const targetHours = [10, 15, 20];
    if (!targetHours.includes(hour)) return;

    // Para evitar múltiplos spawns dentro da mesma hora
    const todayStr = now.toISOString().split('T')[0];
    const spawnKey = `invasion_${todayStr}_${hour}`;
    const alreadySpawned = require('./database').getConfig(spawnKey);

    if (!alreadySpawned) {
        require('./database').setConfig(spawnKey, '1');
        await cityInvasions.spawnCityInvasion(client);
    }
}


// Phase 5: Passive HP Regeneration
function healPlayers() {
    try {
        const chars = require('./database').db.prepare('SELECT discord_id, current_hp, level, death_time FROM rpg_characters WHERE death_time = 0 AND current_hp >= 0').all();
        const updateStmt = require('./database').db.prepare('UPDATE rpg_characters SET current_hp = ? WHERE discord_id = ?');
        
        require('./database').db.transaction(() => {
            for (const char of chars) {
                const maxHp = (char.level || 1) * 50 + 100;
                if (char.current_hp < maxHp) {
                    // Heal 10% of max HP every 5 mins
                    const healAmount = Math.max(10, Math.floor(maxHp * 0.10));
                    const newHp = Math.min(maxHp, char.current_hp + healAmount);
                    updateStmt.run(newHp, char.discord_id);
                }
            }
        })();
    } catch (err) {
        console.error('[Scheduler] Erro ao curar jogadores:', err.message);
    }
}

// Inicia o auto-heal a cada 5 minutos
setInterval(healPlayers, 5 * 60 * 1000);


// Phase 6: Passive Stamina Regeneration
function restoreStamina() {
    try {
        const chars = require('./database').db.prepare('SELECT discord_id, stamina FROM rpg_characters WHERE stamina < 100').all();
        const updateStmt = require('./database').db.prepare('UPDATE rpg_characters SET stamina = ? WHERE discord_id = ?');
        
        require('./database').db.transaction(() => {
            for (const char of chars) {
                // Restore 5 stamina every 10 mins
                const newStamina = Math.min(100, (char.stamina || 0) + 5);
                updateStmt.run(newStamina, char.discord_id);
            }
        })();
    } catch (err) {
        console.error('[Scheduler] Erro ao restaurar stamina:', err.message);
    }
}

// Inicia a regeneração de stamina a cada 10 minutos
setInterval(restoreStamina, 10 * 60 * 1000);

module.exports = { init, updateConfig, updateLiveDashboard, updateWarScoreboard, updateEnemyHuntingDashboard, updateAllyHuntingDashboard, updateCounterChannels, promoteNextInQueue, sendWhatsAppToRegistered, updateEnemyGuildMembers, updateGuildMembers, updateGamificationRoles, checkPlanilhadoRoutines, checkPlanilhadoRotation, spawnRaidBoss, handleBossEscape, checkCityInvasions, spawnCityInvasion: (forced) => cityInvasions.spawnCityInvasion(client, forced) };
