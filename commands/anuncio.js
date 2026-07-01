'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../modules/database');
const whatsapp = require('../modules/whatsapp');

module.exports = {
    name: 'anuncio',
    aliases: ['anunciar', 'announcement'],
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('anuncio')
        .setDescription('Envia um anúncio formatado no canal de anúncios configurado')
        .addStringOption(opt =>
            opt.setName('titulo')
                .setDescription('Título do anúncio')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('mensagem')
                .setDescription('Corpo da mensagem (use \\n para pular linha)')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('ping')
                .setDescription('Menção opcional (Ex: @everyone, @here ou mencione um cargo)')
                .setRequired(false)
        )
        .addAttachmentOption(opt =>
            opt.setName('imagem')
                .setDescription('Imagem ilustrativa para o anúncio')
                .setRequired(false)
        )
        .addBooleanOption(opt =>
            opt.setName('whatsapp')
                .setDescription('Se deve enviar também por WhatsApp para todos os membros registrados')
                .setRequired(false)
        ),

    async execute(msg, args, { config }) {
        if (!config.announcementChannelId) {
            return msg.reply('❌ O canal de anúncios não está configurado. Use `!config canal-anuncios #canal` primeiro.');
        }

        const input = args.join(' ');
        const parts = input.split('|').map(p => p.trim());

        if (parts.length < 2 || !parts[0] || !parts[1]) {
            return msg.reply('⚠️ Formato incorreto! Use: `!anuncio Título | Mensagem | [Mencao] | [WhatsApp: sim/nao]`\n*Exemplo:* `!anuncio Nova Hunt | Adicionamos a hunt B16 ao painel! | @everyone | sim`');
        }

        const title = parts[0];
        const body = parts[1].replace(/\\n/g, '\n');
        const ping = parts[2] || '';
        const waString = parts[3]?.toLowerCase() || '';
        const sendWa = ['sim', 'yes', 'true', '1', 's'].includes(waString);

        const targetChannel = msg.guild.channels.cache.get(config.announcementChannelId) ||
                              await msg.guild.channels.fetch(config.announcementChannelId).catch(() => null);

        if (!targetChannel || !targetChannel.isTextBased()) {
            return msg.reply('❌ Não foi possível encontrar o canal de anúncios ou ele não é baseado em texto. Verifique as configurações.');
        }

        // Criar Embed
        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle(`📢 ${title}`)
            .setDescription(body)
            .setFooter({ text: 'Ascended Comunidade • RubinOT', iconURL: 'https://rubinot.com.br/favicon.ico' })
            .setTimestamp();

        // Enviar anúncio no Discord
        const messagePayload = { embeds: [embed] };
        if (ping) {
            messagePayload.content = ping;
        }

        await targetChannel.send(messagePayload);
        await msg.reply(`✅ Anúncio enviado com sucesso no canal <#${config.announcementChannelId}>!`);

        // Enviar por WhatsApp se solicitado
        if (sendWa) {
            const waMessage = `📢 *ANÚNCIO ASCENDED*\n\n*${title}*\n\n${body}`;
            await runWhatsAppBroadcast(msg.channel, waMessage, msg.author.username);
        }
    },

    async executeSlash(interaction, { config }) {
        if (!config.announcementChannelId) {
            return interaction.reply({ content: '❌ O canal de anúncios não está configurado. Use `/config` para configurar.', ephemeral: true });
        }

        const title = interaction.options.getString('titulo');
        const body = interaction.options.getString('mensagem').replace(/\\n/g, '\n');
        const ping = interaction.options.getString('ping') || '';
        const image = interaction.options.getAttachment('imagem');
        const sendWa = interaction.options.getBoolean('whatsapp') || false;

        const targetChannel = interaction.guild.channels.cache.get(config.announcementChannelId) ||
                              await interaction.guild.channels.fetch(config.announcementChannelId).catch(() => null);

        if (!targetChannel || !targetChannel.isTextBased()) {
            return interaction.reply({ content: '❌ Canal de anúncios inválido ou não configurado.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        // Criar Embed
        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle(`📢 ${title}`)
            .setDescription(body)
            .setFooter({ text: 'Ascended Comunidade • RubinOT', iconURL: 'https://rubinot.com.br/favicon.ico' })
            .setTimestamp();

        if (image) {
            embed.setImage(image.url);
        }

        const messagePayload = { embeds: [embed] };
        if (ping) {
            messagePayload.content = ping;
        }

        await targetChannel.send(messagePayload);
        await interaction.editReply({ content: `✅ Anúncio enviado com sucesso no canal <#${config.announcementChannelId}>!` });

        // Enviar por WhatsApp se solicitado
        if (sendWa) {
            const waMessage = `📢 *ANÚNCIO ASCENDED*\n\n*${title}*\n\n${body}`;
            await runWhatsAppBroadcast(targetChannel, waMessage, interaction.user.username);
        }
    }
};

async function runWhatsAppBroadcast(logChannel, message, senderName) {
    // 1. Verify WhatsApp session status
    const wsStatus = whatsapp.getStatus();
    if (wsStatus.status !== 'connected') {
        return logChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xFF4444)
                    .setTitle('❌ Falha no WhatsApp')
                    .setDescription('O bot não está conectado ao WhatsApp. Use `!whatsapp` ou `/whatsapp status` para conectar.')
            ]
        });
    }

    const registered = db.getAllRegisteredMembers();
    const withPhone = registered.filter(m => m.phone && m.phone.trim() !== '');

    if (withPhone.length === 0) {
        return logChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xFF4444)
                    .setTitle('❌ Falha no WhatsApp')
                    .setDescription('Nenhum membro registrado possui telefone cadastrado para o envio do anúncio.')
            ]
        });
    }

    const startEmbed = new EmbedBuilder()
        .setColor(0x25D366)
        .setTitle('📲 Enviando anúncio via WhatsApp...')
        .setDescription(`Enviando para **${withPhone.length}** membros registrados.\n\n💬 Mensagem:\n> ${message}`)
        .setFooter({ text: `Disparado por ${senderName} • Ascended Bot` })
        .setTimestamp();

    const statusMsg = await logChannel.send({ embeds: [startEmbed] });

    // Envio assíncrono em background
    (async () => {
        let sent = 0;
        let failed = 0;

        for (const member of withPhone) {
            try {
                const success = await whatsapp.sendWhatsAppMessage(member.phone, message);
                if (success) {
                    sent++;
                } else {
                    console.error(`[Anuncio WA] Falha ao enviar para ${member.char_name} (Retornou false)`);
                    failed++;
                }
            } catch (err) {
                console.error(`[Anuncio WA] Falha ao enviar para ${member.char_name}:`, err.message);
                failed++;
            }
            await new Promise(r => setTimeout(r, 600)); // 600ms de delay para evitar block
        }

        const doneEmbed = new EmbedBuilder()
            .setColor(failed === 0 ? 0x25D366 : 0xFF9900)
            .setTitle(failed === 0 ? '✅ Anúncio enviado via WhatsApp!' : '⚠️ Envio WA concluído com falhas')
            .addFields(
                { name: '✅ Enviados', value: `${sent}`, inline: true },
                { name: '❌ Falhas',   value: `${failed}`, inline: true },
                { name: '📋 Total',    value: `${withPhone.length}`, inline: true },
            )
            .setFooter({ text: `Disparado por ${senderName} • Ascended Bot` })
            .setTimestamp();

        await logChannel.send({ embeds: [doneEmbed] });
    })();
}
