'use strict';

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { isProtectedVoiceChannel } = require('../modules/configHelpers');

module.exports = {
    name: 'massmove',
    aliases: ['movergeral', 'moveall'],
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('massmove')
        .setDescription('Move todos os membros em canais de voz para o seu canal de voz atual ou um canal específico')
        .addChannelOption(option =>
            option.setName('canal')
                .setDescription('Canal de voz específico para onde mover todos os membros')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('mensagem')
                .setDescription('Mensagem personalizada para enviar por DM aos membros movidos')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('whatsapp')
                .setDescription('Se deve enviar a mensagem também para o WhatsApp dos membros cadastrados')
                .setRequired(false)
        ),

    async execute(msg, args, { config }) {
        let voiceChannel = null;
        let customMessage = null;
        let sendWa = false;

        if (args && args.length > 0) {
            // Tenta obter o canal pelo ID/Menção fornecido na primeira palavra
            const firstArgClean = args[0].replace(/[<#>]/g, '');
            let channelCandidate = msg.guild.channels.cache.get(firstArgClean) || 
                                   await msg.guild.channels.fetch(firstArgClean).catch(() => null);

            if (!channelCandidate) {
                // Tenta buscar por nome exato na primeira palavra
                channelCandidate = msg.guild.channels.cache.find(c =>
                    (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) &&
                    c.name.toLowerCase() === args[0].toLowerCase()
                );
            }

            if (channelCandidate && (channelCandidate.type === ChannelType.GuildVoice || channelCandidate.type === ChannelType.GuildStageVoice)) {
                voiceChannel = channelCandidate;
                customMessage = args.slice(1).join(' ').trim();
            } else {
                // Tenta casar as primeiras N palavras como nome do canal se existir tal canal
                for (let i = args.length; i >= 1; i--) {
                    const nameInput = args.slice(0, i).join(' ').toLowerCase().trim();
                    const matchedChan = msg.guild.channels.cache.find(c =>
                        (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) &&
                        c.name.toLowerCase() === nameInput
                    );
                    if (matchedChan) {
                        voiceChannel = matchedChan;
                        customMessage = args.slice(i).join(' ').trim();
                        break;
                    }
                }
            }
        }

        if (!voiceChannel) {
            voiceChannel = msg.member?.voice?.channel;
            if (voiceChannel) {
                customMessage = args ? args.join(' ').trim() : '';
            }
        }

        if (!voiceChannel) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Canal de Voz Requerido')
                        .setDescription('Você precisa estar em um canal de voz para mover os outros membros, ou especificar um ID/Nome de canal: `!massmove <ID/Nome> [mensagem]`')
                ]
            });
        }

        // Processa flag de WhatsApp na mensagem do comando prefixado (ex: -w ou -wa no final ou início)
        if (customMessage) {
            if (/\s+-w(a)?\b/i.test(customMessage) || customMessage.trim() === '-w' || customMessage.trim() === '-wa') {
                sendWa = true;
                customMessage = customMessage.replace(/\s*-w(a)?\b/ig, '').trim();
            }
        }

        const voiceStates = msg.guild.voiceStates.cache;
        let movedCount = 0;
        const movedMembers = [];

        for (const [memberId, voiceState] of voiceStates) {
            // Skip protected voice channels
            if (voiceState.channelId && isProtectedVoiceChannel(voiceState.channelId, config)) {
                continue;
            }
            // Ignore if same channel or not connected to voice
            if (voiceState.channelId && voiceState.channelId !== voiceChannel.id) {
                try {
                    const member = voiceState.member;
                    await voiceState.setChannel(voiceChannel);
                    movedCount++;
                    if (member && !member.user.bot) {
                        movedMembers.push(member);
                    }
                } catch {
                    // Ignore individual permission failures
                }
            }
        }

        // Envia notificações para membros registrados em background
        const db = require('../modules/database');
        const whatsapp = require('../modules/whatsapp');
        const registered = db.getAllRegisteredMembers();

        if (registered.length > 0 && (customMessage || sendWa)) {
            const warChanMention = config.warChannelId ? `<#${config.warChannelId}>` : 'warchannel';
            const dmMessage = customMessage || `⚠️ **Aviso de Guerra:** Todos os membros foram convocados no warchannel! Por favor, fiquem prontos agora!`;
            const waMessageText = customMessage || `⚠️ *Aviso de Guerra:* Todos os membros foram convocados no warchannel! Por favor, fiquem prontos agora!`;

            (async () => {
                for (const member of registered) {
                    // 1. Sempre envia DM no Discord se for uma guerra
                    try {
                        const user = await msg.client.users.fetch(member.discord_id).catch(() => null);
                        if (user) {
                            await user.send({ content: dmMessage }).catch(() => {});
                        }
                    } catch (err) {
                        console.error(`[MassMove] Erro ao enviar DM no Discord para ${member.discord_id}:`, err.message);
                    }

                    // 2. Envia no WhatsApp se a flag foi passada
                    if (sendWa && member.phone && member.phone.trim() !== '') {
                        await whatsapp.sendWhatsAppMessage(member.phone, waMessageText);
                    }

                    // Delay de 500ms para evitar rate limit
                    await new Promise(r => setTimeout(r, 500));
                }
            })();
        }

        const embed = new EmbedBuilder()
            .setColor(0x44FF88)
            .setTitle('🔊 Canais de Voz Movidos')
            .setDescription(`Sucesso! **${movedCount}** membros foram movidos para o canal <#${voiceChannel.id}>.

📲 *Notificações enviadas aos membros cadastrados (Discord DM & WhatsApp).*`)
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        // Envia no canal de notificações específico
        const targetChannelId = '1512258789536039113';
        const targetChannel = msg.guild.channels.cache.get(targetChannelId) || 
                              await msg.guild.channels.fetch(targetChannelId).catch(() => null) ||
                              await msg.client.channels.fetch(targetChannelId).catch(() => null);
        if (targetChannel && targetChannel.isTextBased()) {
            try {
                await targetChannel.send({ embeds: [embed] });
            } catch (err) {
                console.error(`[MassMove] Falha ao enviar embed para o canal de log. Tentando texto plano:`, err.message);
                try {
                    await targetChannel.send(`🔊 **Canais de Voz Movidos**\nSucesso! **${movedCount}** membros foram movidos para o canal <#${voiceChannel.id}>.\n\n📲 *Notificações enviadas aos membros cadastrados (Discord DM & WhatsApp).*`);
                } catch (err2) {
                    console.error(`[MassMove] Falha ao enviar texto plano para o canal de log:`, err2.message);
                }
            }
        } else {
            console.error(`[MassMove] Canal de log ${targetChannelId} não foi encontrado ou não é baseado em texto.`);
        }

        return msg.channel.send({ embeds: [embed] });
    },

    async executeSlash(interaction, { config }) {
        let voiceChannel = interaction.options.getChannel('canal');
        const customMessage = interaction.options.getString('mensagem');
        const sendWa = interaction.options.getBoolean('whatsapp') || false;

        if (!voiceChannel) {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            voiceChannel = member?.voice?.channel;
        }

        if (!voiceChannel) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Canal de Voz Requerido')
                        .setDescription('Você precisa estar em um canal de voz para mover os outros membros, ou selecionar a opção `canal`.')
                ],
                ephemeral: true
            });
        }

        const voiceStates = interaction.guild.voiceStates.cache;
        let movedCount = 0;
        const movedMembers = [];

        for (const [memberId, voiceState] of voiceStates) {
            // Skip protected voice channels
            if (voiceState.channelId && isProtectedVoiceChannel(voiceState.channelId, config)) {
                continue;
            }
            if (voiceState.channelId && voiceState.channelId !== voiceChannel.id) {
                try {
                    const member = voiceState.member;
                    await voiceState.setChannel(voiceChannel);
                    movedCount++;
                    if (member && !member.user.bot) {
                        movedMembers.push(member);
                    }
                } catch {
                    // Ignore
                }
            }
        }

        // Envia notificações para membros registrados em background
        const db = require('../modules/database');
        const whatsapp = require('../modules/whatsapp');
        const registered = db.getAllRegisteredMembers();

        if (registered.length > 0 && (customMessage || sendWa)) {
            const warChanMention = config.warChannelId ? `<#${config.warChannelId}>` : 'warchannel';
            const dmMessage = customMessage || `⚠️ **Aviso de Guerra:** Todos os membros foram convocados no warchannel! Por favor, fiquem prontos agora!`;
            const waMessageText = customMessage || `⚠️ *Aviso de Guerra:* Todos os membros foram convocados no warchannel! Por favor, fiquem prontos agora!`;

            (async () => {
                for (const member of registered) {
                    // 1. Sempre envia DM no Discord se for uma guerra
                    try {
                        const user = await interaction.client.users.fetch(member.discord_id).catch(() => null);
                        if (user) {
                            await user.send({ content: dmMessage }).catch(() => {});
                        }
                    } catch (err) {
                        console.error(`[MassMove] Erro ao enviar DM no Discord para ${member.discord_id}:`, err.message);
                    }

                    // 2. Envia no WhatsApp se a flag foi passada
                    if (sendWa && member.phone && member.phone.trim() !== '') {
                        await whatsapp.sendWhatsAppMessage(member.phone, waMessageText);
                    }

                    // Delay de 500ms para evitar rate limit
                    await new Promise(r => setTimeout(r, 500));
                }
            })();
        }

        const embed = new EmbedBuilder()
            .setColor(0x44FF88)
            .setTitle('🔊 Canais de Voz Movidos')
            .setDescription(`Sucesso! **${movedCount}** membros foram movidos para o canal <#${voiceChannel.id}>.

📲 *Notificações enviadas aos membros cadastrados (Discord DM & WhatsApp).*`)
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        // Envia no canal de notificações específico
        const targetChannelId = '1512258789536039113';
        const targetChannel = interaction.guild.channels.cache.get(targetChannelId) || 
                              await interaction.guild.channels.fetch(targetChannelId).catch(() => null) ||
                              await interaction.client.channels.fetch(targetChannelId).catch(() => null);
        if (targetChannel && targetChannel.isTextBased()) {
            try {
                await targetChannel.send({ embeds: [embed] });
            } catch (err) {
                console.error(`[MassMove Slash] Falha ao enviar embed para o canal de log. Tentando texto plano:`, err.message);
                try {
                    await targetChannel.send(`🔊 **Canais de Voz Movidos**\nSucesso! **${movedCount}** membros foram movidos para o canal <#${voiceChannel.id}>.\n\n📲 *Notificações enviadas aos membros cadastrados (Discord DM & WhatsApp).*`);
                } catch (err2) {
                    console.error(`[MassMove Slash] Falha ao enviar texto plano para o canal de log:`, err2.message);
                }
            }
        } else {
            console.error(`[MassMove Slash] Canal de log ${targetChannelId} não foi encontrado ou não é baseado em texto.`);
        }

        return interaction.reply({ embeds: [embed] });
    }
};
