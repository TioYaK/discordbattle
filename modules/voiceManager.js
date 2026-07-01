'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('./database');
const state = require('./state');
const whatsapp = require('./whatsapp');
const { getWarVoiceChannelId } = require('./configHelpers');

let botConfig = null;

function init(client, config) {
    botConfig = config;

    client.on('voiceStateUpdate', async (oldState, newState) => {
        const guild = newState.guild || oldState.guild;
        if (!guild) return;

        const guildId = guild.id;
        await state.guildLocalStorage.run({ guildId }, async () => {
            const member = newState.member || oldState.member;
            if (!member || member.user.bot) return;

            const config = db.getGuildConfigMerged(guildId);

            // ─── Monitoramento do Canal de Guerra ──────────────────────────────────────────
            const warChannelId = getWarVoiceChannelId(config);

            if (warChannelId && newState.channelId === warChannelId && oldState.channelId !== warChannelId) {
                db.startVoiceSession(member.id);
                console.log(`[VoiceManager] ${member.displayName} entrou no canal de guerra.`);
            }
            
            if (warChannelId && oldState.channelId === warChannelId && newState.channelId !== warChannelId) {
                db.endVoiceSession(member.id);
                console.log(`[VoiceManager] ${member.displayName} saiu do canal de guerra.`);
                // Check voice-based achievements
                try {
                    const achievements = require('./achievements');
                    await achievements.checkVoiceAchievements(member.id, guild, null);
                } catch (errAch) {
                    console.warn(`[VoiceManager] Erro ao verificar conquistas de voz:`, errAch.message);
                }
            }

            // 1. Entrada no canal gerador de voz
            const generatorId = config.voiceGeneratorChannelId;
            if (generatorId && newState.channelId === generatorId) {
                try {
                    const generatorChannel = newState.channel;
                    if (!generatorChannel) return;

                    console.log(`[VoiceManager] ${member.displayName} entrou no canal gerador.`);

                    // Definir permissões para o criador e para o bot
                    const permissionOverwrites = [
                        {
                            id: member.id,
                            allow: [
                                PermissionFlagsBits.ManageChannels,
                                PermissionFlagsBits.MoveMembers,
                                PermissionFlagsBits.MuteMembers,
                                PermissionFlagsBits.DeafenMembers,
                                PermissionFlagsBits.Connect,
                            ]
                        },
                        {
                            id: guild.members.me.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.Connect,
                                PermissionFlagsBits.MoveMembers,
                                PermissionFlagsBits.ManageChannels,
                            ]
                        }
                    ];

                    // Criar o canal de voz temporário
                    const tempChannel = await guild.channels.create({
                        name: `Lobby de ${member.displayName}`,
                        type: ChannelType.GuildVoice,
                        parent: generatorChannel.parentId,
                        permissionOverwrites: permissionOverwrites
                    });

                    // Registrar no banco de dados
                    db.addTempVoiceChannel(tempChannel.id, member.id);
                    console.log(`[VoiceManager] Canal temporário criado: ${tempChannel.name} (${tempChannel.id})`);

                    // Mover o membro para a nova sala
                    await member.voice.setChannel(tempChannel);

                } catch (err) {
                    console.error('[VoiceManager] Erro ao criar canal de voz temporário:', err.message, err.stack);
                }
                return;
            }

            // 2. Saída ou mudança de canal
            // Se mudou de canal ou saiu completamente, verificar se o canal antigo era temporário e ficou vazio
            const oldChannelId = oldState.channelId;
            const newChannelId = newState.channelId;

            if (oldChannelId && oldChannelId !== newChannelId) {
                if (db.isTempVoiceChannel(oldChannelId)) {
                    try {
                        const oldChannel = oldState.channel || await guild.channels.fetch(oldChannelId).catch(() => null);
                        if (oldChannel) {
                            if (oldChannel.members.size === 0) {
                                console.log(`[VoiceManager] Canal temporário vazio: ${oldChannel.name} (${oldChannel.id}). Deletando...`);
                                await oldChannel.delete('Canal temporário vazio.');
                                db.deleteTempVoiceChannel(oldChannel.id);
                            }
                        } else {
                            // Canal já não existe no Discord, limpa do DB
                            db.deleteTempVoiceChannel(oldChannelId);
                        }
                    } catch (err) {
                        console.error(`[VoiceManager] Erro ao deletar canal temporário ${oldChannelId}:`, err.message);
                    }
                }
            }

            // 3. Monitoramento de canais de voz para claims/reservas
            // Se o usuário está em algum canal de voz, garanta que ele NÃO está no leftVoiceMap
            if (newChannelId) {
                if (state.leftVoiceMap[member.id]) {
                    delete state.leftVoiceMap[member.id];
                    console.log(`[VoiceManager] ${member.displayName} retornou a um canal de voz. Limpando cronômetro de 5m.`);

                    const claim = db.getClaimByPlayer(member.id);
                    if (claim) {
                        const returnMsg = `✅ **Retorno detectado:** Você voltou para um canal de voz do Discord. Sua reserva do respawn **${claim.respawn_name}** (\`${claim.respawn_id}\`) foi mantida com sucesso!`;
                        
                        // Notificar por Discord DM
                        try {
                            await member.send(returnMsg);
                        } catch (e) {
                            console.warn(`[VoiceManager] Falha ao enviar DM para ${member.displayName}:`, e.message);
                        }

                        // Notificar por WhatsApp
                        try {
                            const reg = db.getRegisteredMember(member.id);
                            if (reg && reg.phone) {
                                await whatsapp.sendWhatsAppMessage(reg.phone, returnMsg);
                            }
                        } catch (e) {
                            console.warn(`[VoiceManager] Falha ao enviar WhatsApp para ${member.displayName}:`, e.message);
                        }
                    }
                }
            } else if (oldChannelId && !newChannelId) {
                // Se o usuário saiu completamente dos canais de voz
                const claim = db.getClaimByPlayer(member.id);
                if (claim && claim.status === 'active') {
                    state.leftVoiceMap[member.id] = Date.now();
                    console.log(`[VoiceManager] ${member.displayName} saiu de todos os canais de voz. Fila de 5 min iniciada.`);

                    const warningMsg = `⚠️ **Aviso de Canal de Voz:** Você saiu dos canais de voz do Discord. Caso não retorne para um canal de voz nos próximos **5 minutos**, sua reserva do respawn **${claim.respawn_name}** (\`${claim.respawn_id}\`) será cancelada automaticamente.`;
                    
                    // Notificar por Discord DM
                    try {
                        await member.send(warningMsg);
                    } catch (e) {
                        console.warn(`[VoiceManager] Falha ao enviar DM para ${member.displayName}:`, e.message);
                    }

                    // Notificar por WhatsApp
                    try {
                        const reg = db.getRegisteredMember(member.id);
                        if (reg && reg.phone) {
                            await whatsapp.sendWhatsAppMessage(reg.phone, warningMsg);
                        }
                    } catch (e) {
                        console.warn(`[VoiceManager] Falha ao enviar WhatsApp para ${member.displayName}:`, e.message);
                    }
                }
            }
        });
    });

    // Executa a limpeza na inicialização
    cleanupEmptyChannels(client);
    initVoiceSessionsOnStartup(client);
}

async function initVoiceSessionsOnStartup(client) {
    const warChannelId = getWarVoiceChannelId(botConfig);
    if (!warChannelId) {
        console.log('[VoiceManager] Canal de voz de guerra não configurado — pulando inicialização de sessões.');
        return;
    }
    console.log('[VoiceManager] Inicializando sessões de voz ativas no canal de guerra...');
    try {
        // Encerra qualquer sessão aberta no DB para evitar dangling sessions
        db.db.prepare('UPDATE voice_sessions SET end_time = ? WHERE end_time IS NULL').run(Date.now());
        
        // Busca o canal
        const warChannel = await client.channels.fetch(warChannelId).catch(() => null);
        if (warChannel && warChannel.members) {
            warChannel.members.forEach(member => {
                if (!member.user.bot) {
                    db.startVoiceSession(member.id);
                    console.log(`[VoiceManager] Sessão de voz inicializada para ${member.displayName} (já no canal de guerra).`);
                }
            });
        }
    } catch (err) {
        console.error('[VoiceManager] Erro ao inicializar sessões no startup:', err.message);
    }
}

async function cleanupEmptyChannels(client) {
    console.log('[VoiceManager] Executando rotina de limpeza de canais temporários...');
    try {
        const tempChannels = db.getAllTempVoiceChannels();
        for (const row of tempChannels) {
            const channel = await client.channels.fetch(row.channel_id).catch(() => null);
            if (channel) {
                if (channel.members.size === 0) {
                    try {
                        await channel.delete('Limpeza de inicialização - canal vazio.');
                        db.deleteTempVoiceChannel(row.channel_id);
                        console.log(`[VoiceManager] Canal temporário órfão deletado: ${row.channel_id}`);
                    } catch (err) {
                        console.error(`[VoiceManager] Erro ao deletar canal órfão ${row.channel_id}:`, err.message);
                    }
                }
            } else {
                db.deleteTempVoiceChannel(row.channel_id);
                console.log(`[VoiceManager] Registro de canal inexistente limpo do DB: ${row.channel_id}`);
            }
        }
    } catch (err) {
        console.error('[VoiceManager] Erro na limpeza inicial:', err.message);
    }
}

function updateConfig(config) {
    botConfig = config;
}

module.exports = {
    init,
    updateConfig,
};
