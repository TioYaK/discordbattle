'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('./database');
const whatsapp = require('./whatsapp');

async function handleApproveTax(interaction, paymentId) {
    // Check admin
    const config = db.getGuildConfigMerged(interaction.guildId);
    const adminRoleId = config.adminRoleId;
    const hasRole = adminRoleId && interaction.member.roles.cache.has(adminRoleId);
    const hasPerm = interaction.member.permissions.has('Administrator') || interaction.member.permissions.has('ManageGuild');
    
    if (!hasRole && !hasPerm) {
        return interaction.reply({ content: 'ðŸš« Apenas administradores podem auditar taxas.', ephemeral: true });
    }

    const payment = db.getTaxPayment(paymentId);
    if (!payment) {
        return interaction.reply({ content: '❌ Pagamento não encontrado no banco de dados.', ephemeral: true });
    }

    if (payment.status !== 'submitted') {
        // Already processed, remove buttons just in case
        await interaction.message.edit({ components: [] }).catch(() => {});
        return interaction.reply({ content: `âš ï¸ Esta taxa já foi processada anteriormente (Status: \`${payment.status}\`).`, ephemeral: true });
    }

    // Update status in DB
    db.updateTaxStatus(paymentId, 'paid', interaction.user.id);

    // Assign Taxa Paga role
    const cargoTaxa = config.cargoTaxa;
    if (cargoTaxa && interaction.guild) {
        const guildMember = await interaction.guild.members.fetch(payment.discord_id).catch(() => null);
        if (guildMember) {
            await guildMember.roles.add(cargoTaxa).catch(err => {
                console.warn(`[TaxManager] Falha ao adicionar cargo de taxa para ${payment.discord_id}:`, err.message);
            });
        }
    }

    // Edit message to remove buttons and show approved status
    const oldEmbed = interaction.message.embeds[0];
    if (oldEmbed) {
        const approvedEmbed = EmbedBuilder.from(oldEmbed)
            .setColor(0x44FF88) // Green
            .addFields({ name: 'âœï¸ Decisão', value: `✅ **APROVADO** por <@${interaction.user.id}>` });

        await interaction.message.edit({ embeds: [approvedEmbed], components: [] }).catch(() => {});
    } else {
        await interaction.message.edit({ components: [] }).catch(() => {});
    }

    // Reply to staff
    await interaction.reply({ content: `✅ Taxa #${paymentId} aprovada com sucesso!`, ephemeral: true });

    // Notify member via Discord DM
    const memberUser = await interaction.client.users.fetch(payment.discord_id).catch(() => null);
    const cycleDateStr = `<t:${Math.floor(payment.cycle_start_at / 1000)}:D>`;
    const amount = payment.amount || '500 RC';

    if (memberUser) {
        const dmEmbed = new EmbedBuilder()
            .setColor(0x44FF88)
            .setTitle('✅ Comprovante de Taxa Aprovado')
            .setDescription(`Olá! Seu comprovante de taxa no valor de **${amount}** (Ciclo: ${cycleDateStr}) foi **APROVADO** pela Staff. Obrigado!`)
            .setFooter({ text: 'Ascended Bot â€¢ Taxa de Guerra' })
            .setTimestamp();

        await memberUser.send({ embeds: [dmEmbed] }).catch(() => {
            console.warn(`[TaxManager] Não foi possível enviar DM para o usuário ${payment.discord_id}`);
        });
    }

    // Notify member via WhatsApp
    const regMember = db.getRegisteredMember(payment.discord_id);
    if (regMember && regMember.phone && regMember.phone.trim() !== '') {
        const waMsg = `✅ *Comprovante de Taxa Aprovado*\n\nOlá, *${payment.char_name}*!\n\nSeu comprovante de taxa no valor de *${amount}* foi *APROVADO* pela Staff. Obrigado!`;
        await whatsapp.sendWhatsAppMessage(regMember.phone, waMsg).catch(err => {
            console.warn(`[TaxManager] Falha ao enviar notificação de taxa por WhatsApp para ${payment.char_name}:`, err.message);
        });
    }
}

async function handleRejectTax(interaction, paymentId) {
    // Check admin
    const config = db.getGuildConfigMerged(interaction.guildId);
    const adminRoleId = config.adminRoleId;
    const hasRole = adminRoleId && interaction.member.roles.cache.has(adminRoleId);
    const hasPerm = interaction.member.permissions.has('Administrator') || interaction.member.permissions.has('ManageGuild');
    
    if (!hasRole && !hasPerm) {
        return interaction.reply({ content: 'ðŸš« Apenas administradores podem auditar taxas.', ephemeral: true });
    }

    const payment = db.getTaxPayment(paymentId);
    if (!payment) {
        return interaction.reply({ content: '❌ Pagamento não encontrado no banco de dados.', ephemeral: true });
    }

    if (payment.status !== 'submitted') {
        await interaction.message.edit({ components: [] }).catch(() => {});
        return interaction.reply({ content: `âš ï¸ Esta taxa já foi processada anteriormente (Status: \`${payment.status}\`).`, ephemeral: true });
    }

    // Update status in DB to rejected
    db.updateTaxStatus(paymentId, 'rejected', interaction.user.id);

    // Remove Taxa Paga role just in case
    const cargoTaxa = config.cargoTaxa;
    if (cargoTaxa && interaction.guild) {
        const guildMember = await interaction.guild.members.fetch(payment.discord_id).catch(() => null);
        if (guildMember && guildMember.roles.cache.has(cargoTaxa)) {
            await guildMember.roles.remove(cargoTaxa).catch(() => {});
        }
    }

    // Edit message to remove buttons and show rejected status
    const oldEmbed = interaction.message.embeds[0];
    if (oldEmbed) {
        const rejectedEmbed = EmbedBuilder.from(oldEmbed)
            .setColor(0xFF4444) // Red
            .addFields({ name: 'âœï¸ Decisão', value: `❌ **RECUSADO** por <@${interaction.user.id}>` });

        await interaction.message.edit({ embeds: [rejectedEmbed], components: [] }).catch(() => {});
    } else {
        await interaction.message.edit({ components: [] }).catch(() => {});
    }

    // Reply to staff
    await interaction.reply({ content: `❌ Taxa #${paymentId} recusada.`, ephemeral: true });

    // Notify member via Discord DM
    const memberUser = await interaction.client.users.fetch(payment.discord_id).catch(() => null);
    const cycleDateStr = `<t:${Math.floor(payment.cycle_start_at / 1000)}:D>`;
    const amount = payment.amount || '500 RC';

    const gbName = config.guildBankName || 'Guild Bank';

    if (memberUser) {
        const dmEmbed = new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('❌ Comprovante de Taxa Recusado')
            .setDescription(
                `Olá. Seu comprovante de taxa no valor de **${amount}** (Ciclo: ${cycleDateStr}) foi **RECUSADO** pela Staff.\n\n` +
                `Por favor, verifique se efetuou o depósito corretamente no personagem **${gbName}** in-game e envie novamente a imagem usando o comando \`!taxa-paga\` no Discord.`
            )
            .setFooter({ text: 'Ascended Bot â€¢ Taxa de Guerra' })
            .setTimestamp();

        await memberUser.send({ embeds: [dmEmbed] }).catch(() => {
            console.warn(`[TaxManager] Não foi possível enviar DM para o usuário ${payment.discord_id}`);
        });
    }

    // Notify member via WhatsApp
    const regMember = db.getRegisteredMember(payment.discord_id);
    if (regMember && regMember.phone && regMember.phone.trim() !== '') {
        const waMsg = `❌ *Comprovante de Taxa Recusado*\n\nOlá, *${payment.char_name}*!\n\nSeu comprovante de taxa no valor de *${amount}* foi *RECUSADO* pela Staff.\n\nPor favor, verifique se o depósito foi feito corretamente para o personagem *${gbName}* e envie novamente no Discord usando o comando de taxa.`;
        await whatsapp.sendWhatsAppMessage(regMember.phone, waMsg).catch(err => {
            console.warn(`[TaxManager] Falha ao enviar notificação de recusa por WhatsApp para ${payment.char_name}:`, err.message);
        });
    }
}

async function handleRemindPendingTax(interaction) {
    const config = db.getGuildConfigMerged(interaction.guildId);
    const adminRoleId = config.adminRoleId;
    const hasRole = adminRoleId && interaction.member.roles.cache.has(adminRoleId);
    const hasPerm = interaction.member.permissions.has('Administrator') || interaction.member.permissions.has('ManageGuild');
    
    if (!hasRole && !hasPerm) {
        return interaction.reply({ content: 'ðŸš« Apenas administradores podem enviar cobranças.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const pending = db.getPendingMembersForCycle(cycleStart);

    if (!pending || pending.length === 0) {
        return interaction.followUp({ content: '✅ Nenhum membro pendente de pagamento de taxa no momento.' });
    }

    let sentDiscord = 0;
    let sentWhatsapp = 0;

    const gbName = config.guildBankName || 'Guild Bank';

    for (const member of pending) {
        // Send Discord DM
        const discordUser = await interaction.client.users.fetch(member.discord_id).catch(() => null);
        if (discordUser) {
            const embed = new EmbedBuilder()
                .setColor(0xF1C40F) // Yellow
                .setTitle('ðŸ”” Lembrete: Taxa de Guerra')
                .setDescription(`Olá **${member.char_name}**! Identificamos que você ainda não efetuou ou não teve o comprovante aprovado para a Taxa de Guerra deste mês.\n\nPor favor, efetue a transferência in-game para o personagem **${gbName}** e envie o seu comprovante no DM do bot com \`!taxa-paga\` o mais rápido possível para evitar advertências.`)
                .setFooter({ text: 'Ascended Bot â€¢ Taxa de Guerra Mensal' })
                .setTimestamp();
            
            const sent = await discordUser.send({ embeds: [embed] }).catch(() => null);
            if (sent) sentDiscord++;
        }

        // Send WhatsApp if available
        if (member.phone && member.phone.trim() !== '') {
            const waMsg = `ðŸ”” *Lembrete: Taxa de Guerra*\n\nOlá, *${member.char_name}*!\n\nIdentificamos que você ainda não efetuou o pagamento da sua taxa de guerra mensal.\n\nPor favor, não se esqueça de transferir in-game para *${gbName}* e enviar o comprovante no Discord no PV do bot.`;
            await whatsapp.sendWhatsAppMessage(member.phone, waMsg).catch(() => {});
            sentWhatsapp++;
        }
    }

    return interaction.followUp({ content: `✅ Cobranças enviadas com sucesso!\nâ€¢ DMs no Discord: **${sentDiscord}**\nâ€¢ Mensagens no WhatsApp: **${sentWhatsapp}**` });
}

module.exports = {
    handleApproveTax,
    handleRejectTax,
    handleRemindPendingTax
};
