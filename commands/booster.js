'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const { buildErrorEmbed } = require('../modules/embeds');
const scheduler = require('../modules/scheduler');

async function handleBoosterLogic(user, member, config) {
    if (config.claimsPaused === 'true') {
        return { error: '⚠️ **O sistema de reservas (claims) está pausado no momento (Guerra ativa).**' };
    }

    const reg = db.getRegisteredMember(user.id);
    if (!reg) {
        return { error: '🚫 Você não está registrado no bot. Registre-se primeiro no canal de registro.' };
    }

    // Check inventory
    const qty = db.getInventoryItemQuantity(user.id, 'booster');
    if (qty < 1) {
        return { error: '❌ Você não possui **Spawn Booster** no seu inventário. Compre um na `!loja`!' };
    }

    // Find active claim
    const activeClaim = db.getClaimByPlayer(user.id);
    if (!activeClaim) {
        return { error: '❌ Você não possui nenhuma reserva de hunt ativa no momento para usar o booster.' };
    }

    // Check queue
    const queue = db.getQueue(activeClaim.respawn_id);
    if (queue && queue.length > 0) {
        return { error: `⚠️ Você não pode usar o booster pois há **${queue.length} jogador(es)** na fila de espera (Next).` };
    }

    // Check planilhado overlap
    const newExpiresAt = activeClaim.expires_at + 60 * 60 * 1000;
    const totalMinsRemaining = Math.ceil((newExpiresAt - Date.now()) / 60000);
    const { checkPlanilhadoOverlap } = require('../modules/planilhadoManager');
    const conflictingSchedule = checkPlanilhadoOverlap(activeClaim.respawn_id, totalMinsRemaining);
    if (conflictingSchedule) {
        return {
            error: `🚫 **Extensão Bloqueada:** A extensão do respawn **${activeClaim.respawn_name}** por booster conflita com uma reserva diária planilhada ativa no horário **${conflictingSchedule.time_slot}** liderada por <@${conflictingSchedule.leader_discord_id}>.`
        };
    }

    // Deduct item and update database
    db.removeInventoryItem(user.id, 'booster', 1);
    db.extendClaim(activeClaim.respawn_id, 60 * 60 * 1000);

    if (typeof scheduler.updateLiveDashboard === 'function') {
        scheduler.updateLiveDashboard();
    }

    const updatedClaim = db.getClaimByRespawn(activeClaim.respawn_id);
    const qtyLeft = db.getInventoryItemQuantity(user.id, 'booster');

    // Verificar conquista RESPAWN_GUARDIAN (4 horas seguidas de claim)
    if (updatedClaim && (updatedClaim.expires_at - updatedClaim.claimed_at) >= 4 * 60 * 60 * 1000) {
        try {
            const achievements = require('../modules/achievements');
            const annChanId = config.reportChannelId || config.claimCommandsChannelId;
            await achievements.checkRespawnGuardian(user.id, member.guild, annChanId);
        } catch (errAch) {
            console.error('[Achievements] Erro ao verificar Guardião do Respawn:', errAch.message);
        }
    }

    return { success: true, claim: updatedClaim, qtyLeft };
}

module.exports = {
    name: 'booster',
    aliases: ['spawnbooster'],
    description: 'Usa um Spawn Booster do seu inventário para estender sua claim ativa por +60 minutos',
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('booster')
        .setDescription('Comandos do Spawn Booster')
        .addSubcommand(sub =>
            sub
                .setName('usar')
                .setDescription('Usa 1 Spawn Booster para estender sua claim ativa em +60 minutos')
        ),

    async execute(msg, args, { config }) {
        if (!args || args[0] !== 'usar') {
            return msg.reply({ embeds: [buildErrorEmbed('❌ Uso correto: `!booster usar`').catch(() => {})] });
        }

        const result = await handleBoosterLogic(msg.author, msg.member, config);
        if (result.error) {
            return msg.reply({ embeds: [buildErrorEmbed(result.error).catch(() => {})] });
        }

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71) // Green
            .setTitle('⏰ Spawn Booster Ativado!')
            .setDescription(
                `Você utilizou com sucesso **1 Spawn Booster** para estender sua reserva de hunt.\n\n` +
                `📌 **Respawn:** **${result.claim.respawn_name}**\n` +
                `⏳ **Novo Horário de Expiração:** <t:${Math.floor(result.claim.expires_at / 1000)}:T> (<t:${Math.floor(result.claim.expires_at / 1000)}:R>)\n\n` +
                `🎒 **Boosters Restantes no Inventário:** \`${result.qtyLeft}\` token(s).`
            )
            .setFooter({ text: 'Ascended Bot • Spawn Booster' })
            .setTimestamp();

        return msg.reply({ embeds: [embed] }).catch(() => {});
    },

    async executeSlash(interaction, { config }) {
        await interaction.deferReply();
        const subcommand = interaction.options.getSubcommand();
        if (subcommand !== 'usar') {
            return interaction.editReply({ embeds: [buildErrorEmbed('❌ Subcomando inválido.').catch(() => {})], ephemeral: true });
        }

        const result = await handleBoosterLogic(interaction.user, interaction.member, config);
        if (result.error) {
            return interaction.editReply({ embeds: [buildErrorEmbed(result.error).catch(() => {})], ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71) // Green
            .setTitle('⏰ Spawn Booster Ativado!')
            .setDescription(
                `Você utilizou com sucesso **1 Spawn Booster** para estender sua reserva de hunt.\n\n` +
                `📌 **Respawn:** **${result.claim.respawn_name}**\n` +
                `⏳ **Novo Horário de Expiração:** <t:${Math.floor(result.claim.expires_at / 1000)}:T> (<t:${Math.floor(result.claim.expires_at / 1000)}:R>)\n\n` +
                `🎒 **Boosters Restantes no Inventário:** \`${result.qtyLeft}\` token(s).`
            )
            .setFooter({ text: 'Ascended Bot • Spawn Booster' })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] }).catch(() => {});
    }
};
