'use strict';

const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const db = require('../modules/database');
const whatsapp = require('../modules/whatsapp');

module.exports = {
    name: 'zapall',
    aliases: ['wabroadcast', 'wamsg', 'broadcast'],
    description: 'Envia uma mensagem de WhatsApp para todos os membros registrados com telefone cadastrado.',

    data: new SlashCommandBuilder()
        .setName('zapall')
        .setDescription('Envia mensagem WhatsApp para todos os membros com telefone cadastrado')
        .addStringOption(opt =>
            opt.setName('mensagem')
                .setDescription('Mensagem a enviar')
                .setRequired(true)
        ),

    async execute(msg, args, { config }) {
        const message = args.join(' ').trim();
        if (!message) {
            return msg.reply({ embeds: [buildErrorEmbed('Uso: `!zapall <mensagem>`')] });
        }
        await runBroadcast(msg.channel, message, msg.author.username, false, msg.author.id, msg.member, config);
    },

    async executeSlash(interaction, { config }) {
        const message = interaction.options.getString('mensagem');
        await interaction.deferReply();
        await runBroadcast(interaction, message, interaction.user.username, true, interaction.user.id, interaction.member, config);
    },
};

async function runBroadcast(ctx, message, senderName, isSlash = false, userId, member, config) {
    // Admins bypass item requirement
    let hasAdmin = false;
    try { hasAdmin = member.permissions && (member.permissions.has('Administrator') || member.permissions.has('ManageGuild')); } catch (e) {}
    if (!hasAdmin && config.adminRoleId) {
        if (member.roles && member.roles.cache) hasAdmin = member.roles.cache.has(config.adminRoleId);
        else if (Array.isArray(member.roles)) hasAdmin = member.roles.includes(config.adminRoleId);
    }

    if (!hasAdmin) {
        const megafones = db.getMaterialQty(userId, 'megafone_guilda');
        if (!megafones || megafones.quantity < 1) {
            const embed = buildErrorEmbed('Você precisa de um **Megafone da Guilda 📢** para enviar um ZapAll.\nAdquira o item na `!loja`.');
            if (isSlash) return ctx.editReply({ embeds: [embed] });
            return ctx.send({ embeds: [embed] });
        }
        // Consume 1 megafone
        db.removeMaterial(userId, 'megafone_guilda', 1);
    }

    // 1. Verify WhatsApp session status
    const wsStatus = whatsapp.getStatus();
    if (wsStatus.status !== 'connected') {
        const embed = buildErrorEmbed('O bot não está conectado ao WhatsApp. Use `!whatsapp` ou `/whatsapp status` para verificar e conectar.');
        if (isSlash) return ctx.editReply({ embeds: [embed] });
        return ctx.send({ embeds: [embed] });
    }

    const registered = db.getAllRegisteredMembers();
    const withPhone = registered.filter(m => m.phone && String(m.phone).trim() !== '');

    if (withPhone.length === 0) {
        const embed = buildErrorEmbed('Nenhum membro com telefone cadastrado.');
        if (isSlash) return ctx.editReply({ embeds: [embed] });
        return ctx.send({ embeds: [embed] });
    }

    // Responde imediatamente mostrando que está enviando
    const startEmbed = new EmbedBuilder()
        .setColor(0x25D366)
        .setTitle('📲 Enviando WhatsApp em massa...')
        .setDescription(`Enviando para **${withPhone.length}** membros com telefone cadastrado.\n\n💬 Mensagem:\n> ${message}`)
        .setFooter({ text: `Disparado por ${senderName} • Ascended Bot` })
        .setTimestamp();

    const reply = isSlash
        ? await ctx.editReply({ embeds: [startEmbed] })
        : await ctx.send({ embeds: [startEmbed] });

    // Envia em background
    (async () => {
        let sent = 0;
        let failed = 0;
        const failedNames = [];

        for (const member of withPhone) {
            try {
                const success = await whatsapp.sendWhatsAppMessage(member.phone, message);
                if (success) {
                    console.log(`[ZapAll] ✅ Enviado para ${member.char_name} (${member.phone})`);
                    sent++;
                } else {
                    console.error(`[ZapAll] ❌ Falha ao enviar para ${member.char_name} (${member.phone}) (Retornou false)`);
                    failedNames.push(member.char_name);
                    failed++;
                }
            } catch (err) {
                console.error(`[ZapAll] ❌ Falha ao enviar para ${member.char_name} (${member.phone}):`, err.message);
                failedNames.push(member.char_name);
                failed++;
            }
            // Delay aleatório de 3s a 7s para evitar ban de rate-limit do WhatsApp
            const randomDelay = Math.floor(Math.random() * (7000 - 3000 + 1)) + 3000;
            await new Promise(r => setTimeout(r, randomDelay));
        }

        const failedText = failedNames.length > 0 
            ? `\n\n❌ Falhas: ${failedNames.slice(0, 20).join(', ')}${failedNames.length > 20 ? ` e mais ${failedNames.length - 20}...` : ''}` 
            : '';

        // Atualiza a mensagem com o resultado final
        const doneEmbed = new EmbedBuilder()
            .setColor(failed === 0 ? 0x25D366 : 0xFF9900)
            .setTitle(failed === 0 ? '✅ WhatsApp enviado para todos!' : '⚠️ Envio concluído com falhas')
            .addFields(
                { name: '✅ Enviados', value: `${sent}`, inline: true },
                { name: '❌ Falhas',   value: `${failed}`, inline: true },
                { name: '📋 Total',    value: `${withPhone.length}`, inline: true },
            )
            .setDescription(`💬 Mensagem:\n> ${message}${failedText}`)
            .setFooter({ text: `Disparado por ${senderName} • Ascended Bot` })
            .setTimestamp();

        try {
            if (isSlash) {
                await ctx.editReply({ embeds: [doneEmbed] }).catch(async () => {
                    // Fallback se a interação expirou (passou de 15 minutos de token)
                    if (ctx.channel) {
                        await ctx.channel.send({ content: `<@${ctx.user.id}> O envio do WhatsApp terminou!`, embeds: [doneEmbed] });
                    }
                });
            } else {
                const ch = ctx.channel || ctx;
                await ch.send({ content: `<@${ctx.author ? ctx.author.id : ctx.id}> O envio em massa terminou!`, embeds: [doneEmbed] });
            }
        } catch (e) { /* ignora erro de edição */ }
    })();
}

function buildErrorEmbed(text) {
    return new EmbedBuilder().setColor(0xFF4444).setTitle('❌ Erro').setDescription(text);
}
