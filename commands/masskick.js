'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isProtectedVoiceChannel } = require('../modules/configHelpers');

module.exports = {
    name: 'masskick',
    aliases: ['kicarvoz', 'kickallvoice', 'voicekick'],
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('masskick')
        .setDescription('Desconecta todos os membros de todos os canais de voz do servidor')
        .addStringOption(option =>
            option.setName('mensagem')
                .setDescription('Mensagem personalizada para enviar aos membros cadastrados')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('whatsapp')
                .setDescription('Se deve enviar a mensagem também para o WhatsApp dos membros cadastrados')
                .setRequired(false)
        ),

    async execute(msg, args, { config }) {
        let customMessage = args ? args.join(' ').trim() : '';
        let sendWa = false;

        // Processa flag de WhatsApp na mensagem do comando prefixado (ex: -w ou -wa)
        if (customMessage) {
            if (/\s+-w(a)?\b/i.test(customMessage) || customMessage.trim() === '-w' || customMessage.trim() === '-wa') {
                sendWa = true;
                customMessage = customMessage.replace(/\s*-w(a)?\b/ig, '').trim();
            }
        }

        const voiceStates = msg.guild.voiceStates.cache;
        let kickedCount = 0;

        for (const [memberId, voiceState] of voiceStates) {
            // Skip protected voice channels
            if (voiceState.channelId && isProtectedVoiceChannel(voiceState.channelId, config)) {
                continue;
            }
            if (voiceState.channelId) {
                try {
                    await voiceState.setChannel(null);
                    kickedCount++;
                } catch {
                    // Ignore
                }
            }
        }

        // Envia notificações para membros registrados em background
        const db = require('../modules/database');
        const whatsapp = require('../modules/whatsapp');
        const registered = db.getAllRegisteredMembers();

        if (registered.length > 0) {
            const warChanMention = config.warChannelId ? `<#${config.warChannelId}>` : 'warchannel';
            const dmMessage = customMessage || `⚠️ **Aviso de Guerra:** Todos os membros foram desconectados dos canais de voz. Por favor, fiquem prontos no **warchannel** (${warChanMention})!`;
            const waMessageText = customMessage || `⚠️ *Aviso de Guerra:* Todos os membros foram desconectados dos canais de voz. Fiquem prontos no warchannel agora!`;

            (async () => {
                for (const member of registered) {
                    // 1. Sempre envia DM no Discord
                    try {
                        const user = await msg.client.users.fetch(member.discord_id).catch(() => null);
                        if (user) {
                            await user.send({ content: dmMessage }).catch(() => {});
                        }
                    } catch (err) {
                        console.error(`[MassKick] Erro ao enviar DM no Discord para ${member.discord_id}:`, err.message);
                    }

                    // 2. Sempre envia no WhatsApp se o membro tiver phone cadastrado
                    if (member.phone && member.phone.trim() !== '') {
                        console.log(`[MassKick] Enviando WhatsApp para ${member.char_name} (${member.phone})...`);
                        await whatsapp.sendWhatsAppMessage(member.phone, waMessageText);
                    }

                    // Delay de 500ms para rate limit
                    await new Promise(r => setTimeout(r, 500));
                }
            })();
        }

        const embed = new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('🔇 Canal de Voz Limpo')
            .setDescription(`Sucesso! **${kickedCount}** membros foram desconectados dos canais de voz.\n\n📲 *Notificações enviadas aos membros cadastrados (Discord DM & WhatsApp).*`)
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
                console.error(`[MassKick] Falha ao enviar embed para o canal de log. Tentando texto plano:`, err.message);
                try {
                    await targetChannel.send(`🔇 **Canal de Voz Limpo**\nSucesso! **${kickedCount}** membros foram desconectados dos canais de voz.\n\n📲 *Notificações enviadas aos membros cadastrados (Discord DM & WhatsApp).*`);
                } catch (err2) {
                    console.error(`[MassKick] Falha ao enviar texto plano para o canal de log:`, err2.message);
                }
            }
        } else {
            console.error(`[MassKick] Canal de log ${targetChannelId} não foi encontrado ou não é baseado em texto.`);
        }

        return msg.channel.send({ embeds: [embed] });
    },

    async executeSlash(interaction, { config }) {
        const customMessage = interaction.options.getString('mensagem');
        const sendWa = interaction.options.getBoolean('whatsapp') || false;

        const voiceStates = interaction.guild.voiceStates.cache;
        let kickedCount = 0;

        for (const [memberId, voiceState] of voiceStates) {
            // Skip protected voice channels
            if (voiceState.channelId && isProtectedVoiceChannel(voiceState.channelId, config)) {
                continue;
            }
            if (voiceState.channelId) {
                try {
                    await voiceState.setChannel(null);
                    kickedCount++;
                } catch {
                    // Ignore
                }
            }
        }

        // Envia notificações para membros registrados em background
        const db = require('../modules/database');
        const whatsapp = require('../modules/whatsapp');
        const registered = db.getAllRegisteredMembers();

        if (registered.length > 0) {
            const warChanMention = config.warChannelId ? `<#${config.warChannelId}>` : 'warchannel';
            const dmMessage = customMessage || `⚠️ **Aviso de Guerra:** Todos os membros foram desconectados dos canais de voz. Por favor, fiquem prontos no **warchannel** (${warChanMention})!`;
            const waMessageText = customMessage || `⚠️ *Aviso de Guerra:* Todos os membros foram desconectados dos canais de voz. Fiquem prontos no warchannel agora!`;

            (async () => {
                for (const member of registered) {
                    // 1. Sempre envia DM no Discord
                    try {
                        const user = await interaction.client.users.fetch(member.discord_id).catch(() => null);
                        if (user) {
                            await user.send({ content: dmMessage }).catch(() => {});
                        }
                    } catch (err) {
                        console.error(`[MassKick] Erro ao enviar DM no Discord para ${member.discord_id}:`, err.message);
                    }

                    // 2. Sempre envia no WhatsApp se o membro tiver phone cadastrado
                    if (member.phone && member.phone.trim() !== '') {
                        console.log(`[MassKick] Enviando WhatsApp para ${member.char_name} (${member.phone})...`);
                        await whatsapp.sendWhatsAppMessage(member.phone, waMessageText);
                    }

                    // Delay de 500ms para rate limit
                    await new Promise(r => setTimeout(r, 500));
                }
            })();
        }

        const embed = new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('🔇 Canal de Voz Limpo')
            .setDescription(`Sucesso! **${kickedCount}** membros foram desconectados dos canais de voz.\n\n📲 *Notificações enviadas aos membros cadastrados (Discord DM & WhatsApp).*`)
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
                console.error(`[MassKick Slash] Falha ao enviar embed para o canal de log. Tentando texto plano:`, err.message);
                try {
                    await targetChannel.send(`🔇 **Canal de Voz Limpo**\nSucesso! **${kickedCount}** membros foram desconectados dos canais de voz.\n\n📲 *Notificações enviadas aos membros cadastrados (Discord DM & WhatsApp).*`);
                } catch (err2) {
                    console.error(`[MassKick Slash] Falha ao enviar texto plano para o canal de log:`, err2.message);
                }
            }
        } else {
            console.error(`[MassKick Slash] Canal de log ${targetChannelId} não foi encontrado ou não é baseado em texto.`);
        }

        return interaction.reply({ embeds: [embed] });
    }
};
