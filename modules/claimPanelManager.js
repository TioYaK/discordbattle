'use strict';

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const scheduler = require('./scheduler');
const { buildErrorEmbed, buildQueueSuccessEmbed, buildClaimSuccessEmbed } = require('./embeds');

async function handlePanelButton(interaction, config) {
    const customId = interaction.customId;

    if (customId === 'claims_panel_claim') {
        const reg = db.getRegisteredMember(interaction.user.id);
        if (!reg) {
            return interaction.reply({
                content: '🚫 **Registro Requerido:** Você precisa estar registrado para reservar respawns. Peça a um Administrador.',
                ephemeral: true
            });
        }

        if (!interaction.member?.voice?.channelId) {
            return interaction.reply({
                content: '⚠️ **Presença em canal de voz obrigatória:** Você precisa estar obrigatoriamente conectado a um canal de voz no Discord para claimar ou dar next.',
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('modal_claim_respawn')
            .setTitle('Reservar Respawn');

        const respawnInput = new TextInputBuilder()
            .setCustomId('claim_respawn_id')
            .setLabel('Código ou Nome do Respawn (ex: B16, P17)')
            .setPlaceholder('Ex: B16 (Cobras) ou P17 (Asuras)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(respawnInput));
        await interaction.showModal(modal);

    } else if (customId === 'claims_panel_queue') {
        const reg = db.getRegisteredMember(interaction.user.id);
        if (!reg) {
            return interaction.reply({
                content: '🚫 **Registro Requerido:** Você precisa estar registrado para entrar na fila. Peça a um Administrador.',
                ephemeral: true
            });
        }

        if (!interaction.member?.voice?.channelId) {
            return interaction.reply({
                content: '⚠️ **Presença em canal de voz obrigatória:** Você precisa estar obrigatoriamente conectado a um canal de voz no Discord para claimar ou dar next.',
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('modal_queue_respawn')
            .setTitle('Entrar na Fila (Next)');

        const respawnInput = new TextInputBuilder()
            .setCustomId('queue_respawn_id')
            .setLabel('Código ou Nome do Respawn (ex: B16, P17)')
            .setPlaceholder('Ex: B16 (Cobras) ou P17 (Asuras)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(respawnInput));
        await interaction.showModal(modal);

    } else if (customId === 'claims_panel_release') {
        const reg = db.getRegisteredMember(interaction.user.id);
        if (!reg) {
            return interaction.reply({
                content: '🚫 **Registro Requerido:** Você precisa estar registrado para liberar respawns.',
                ephemeral: true
            });
        }

        const claim = db.getClaimByPlayer(interaction.user.id);
        if (!claim) {
            return interaction.reply({
                content: '💡 Você não possui nenhuma reserva ativa no momento.',
                ephemeral: true
            });
        }

        db.deleteClaimByPlayer(interaction.user.id);
        
        // Promote next in queue if any
        await scheduler.promoteNextInQueue(claim.respawn_id, claim.respawn_name, claim.category);
        return interaction.reply({
            content: `✅ Você liberou o respawn **${claim.respawn_name}** (${claim.respawn_id}) com sucesso!`,
            ephemeral: true
        });
    }
}

async function handleModalSubmit(interaction, config) {
    const customId = interaction.customId;

    if (customId === 'modal_claim_respawn') {
        const query = interaction.fields.getTextInputValue('claim_respawn_id');
        const { handleClaimLogic } = require('../commands/claim');

        const result = await handleClaimLogic(interaction.user, interaction.member, query, config);

        if (result.error) {
            return interaction.reply({ embeds: [buildErrorEmbed(result.error)], ephemeral: true });
        }

        await scheduler.updateLiveDashboard();

        if (result.isQueue) {
            return interaction.reply({
                embeds: [buildQueueSuccessEmbed(result.respawnId, result.respawnName, result.position, result.ownerName)],
                ephemeral: true
            });
        }

        return interaction.reply({
            embeds: [buildClaimSuccessEmbed(result.claim, result.duration)],
            ephemeral: true
        });

    } else if (customId === 'modal_queue_respawn') {
        const query = interaction.fields.getTextInputValue('queue_respawn_id');
        const { handleClaimLogic } = require('../commands/claim');

        // We run the same claim logic. If it is already claimed, handleClaimLogic automatically joins the queue!
        const result = await handleClaimLogic(interaction.user, interaction.member, query, config);

        if (result.error) {
            return interaction.reply({ embeds: [buildErrorEmbed(result.error)], ephemeral: true });
        }

        await scheduler.updateLiveDashboard();

        if (result.isQueue) {
            return interaction.reply({
                embeds: [buildQueueSuccessEmbed(result.respawnId, result.respawnName, result.position, result.ownerName)],
                ephemeral: true
            });
        }

        // If it was actually free and they got the claim instead of queue:
        return interaction.reply({
            embeds: [buildClaimSuccessEmbed(result.claim, result.duration)],
            ephemeral: true
        });
    }
}

module.exports = {
    handlePanelButton,
    handleModalSubmit
};
