'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../modules/database');
const { buildClaimSuccessEmbed, buildErrorEmbed } = require('../modules/embeds');
const scheduler = require('../modules/scheduler');

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

async function handleExtendLogic(user, member, config) {
    if (config.claimsPaused === 'true') {
        return { error: '⚠️ **O sistema de reservas (claims) está pausado no momento (Guerra ativa).**' };
    }

    // 1. Get player's active claim
    const activeClaim = db.getClaimByPlayer(user.id);
    if (!activeClaim) {
        return { error: 'ℹ️ Você não tem nenhuma reserva ativa no momento.' };
    }

    // 2. Get duration allowed by player's role
    const durationMin = getClaimDuration(member, config);
    if (durationMin === 0) {
        return { error: '🚫 Você não possui um cargo que permite estender reservas.' };
    }

    // 3. Verify if less than 30 minutes are left
    const timeLeftMs = activeClaim.expires_at - Date.now();
    if (timeLeftMs > 30 * 60 * 1000) {
        const minsLeft = Math.floor(timeLeftMs / 60000);
        return { error: `⏳ Sua reserva ainda tem **${minsLeft} minutos** restantes.\nVocê só pode estender quando faltarem menos de **30 minutos**.` };
    }

    // 4. Verify if there is anyone in the queue for this respawn
    const queue = db.getQueue(activeClaim.respawn_id);
    if (queue && queue.length > 0) {
        return { error: `⚠️ Você não pode estender sua reserva pois há **${queue.length} jogador(es)** na fila de espera (Next).` };
    }

    // Check if the extension overlaps with any active planilhado schedules
    const { checkPlanilhadoOverlap } = require('../modules/planilhadoManager');
    const conflictingSchedule = checkPlanilhadoOverlap(activeClaim.respawn_id, durationMin);
    if (conflictingSchedule) {
        return {
            error: `🚫 **Extensão Bloqueada:** O respawn **${activeClaim.respawn_name}** possui uma reserva diária planilhada ativa no horário **${conflictingSchedule.time_slot}** liderada por <@${conflictingSchedule.leader_discord_id}>.`
        };
    }

    // 5. Update claim expiration to a fresh duration from now
    const durationMs = durationMin * 60 * 1000;
    db.insertClaim({
        respawnId: activeClaim.respawn_id,
        respawnName: activeClaim.respawn_name,
        category: activeClaim.category,
        playerId: user.id,
        playerName: user.username,
        durationMs
    });

    if (typeof scheduler.updateLiveDashboard === 'function') {
        scheduler.updateLiveDashboard();
    }

    const updatedClaim = db.getClaimByRespawn(activeClaim.respawn_id);

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

    return { success: true, claim: updatedClaim, duration: durationMin };
}

module.exports = {
    name: 'extend',
    aliases: ['extender', 'prolongar'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('extend')
        .setDescription('Estende sua reserva atual por mais tempo (apenas quando faltarem menos de 30 minutos)'),

    async execute(msg, args, { config }) {
        const result = await handleExtendLogic(msg.author, msg.member, config);

        if (result.error) {
            return msg.reply({ embeds: [buildErrorEmbed(result.error).catch(() => {})] });
        }
        return msg.reply({ embeds: [buildClaimSuccessEmbed(result.claim, result.duration).catch(() => {})] });
    },

    async executeSlash(interaction, { config }) {
        await interaction.deferReply();
        const result = await handleExtendLogic(interaction.user, interaction.member, config);

        if (result.error) {
            return interaction.editReply({ embeds: [buildErrorEmbed(result.error).catch(() => {})], ephemeral: true });
        }
        return interaction.editReply({ embeds: [buildClaimSuccessEmbed(result.claim, result.duration).catch(() => {})] });
    }
};
