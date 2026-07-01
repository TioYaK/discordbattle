'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const { buildClaimSuccessEmbed, buildErrorEmbed, buildQueueSuccessEmbed } = require('../modules/embeds');
const respawnsList = require('../data/respawns.json');
const scheduler = require('../modules/scheduler');

// Helper to find a respawn by query (code or name)
function findRespawn(query) {
    const q = query.toLowerCase().trim();
    
    // 1. Match code exact (ex: Q2, P16)
    let match = respawnsList.find(r => r.id.toLowerCase() === q);
    if (match) return match;

    // 2. Match name exact
    match = respawnsList.find(r => r.name.toLowerCase() === q);
    if (match) return match;

    // 3. Match name partial
    const partials = respawnsList.filter(r => r.name.toLowerCase().includes(q));
    if (partials.length === 1) {
        return partials[0];
    } else if (partials.length > 1) {
        return { error: 'multiple', matches: partials.slice(0, 8) };
    }

    return null;
}

// Helper to get allowed claim duration in minutes
function getClaimDuration(member, config) {
    // Admin bypass: 180m default
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

async function handleClaimLogic(user, member, query, config) {
    if (config.claimsPaused === 'true') {
        return { error: '⚠️ **O sistema de reservas (claims) está pausado no momento (Guerra ativa).**' };
    }

    if (!query) {
        return { error: 'Uso: `!claim <código ou nome>`' };
    }

    // Verificar obrigatoriedade de estar em um canal de voz
    if (!member || !member.voice || !member.voice.channelId) {
        return { error: '⚠️ **Presença em canal de voz obrigatória:** Você precisa estar obrigatoriamente conectado a um canal de voz no Discord para claimar ou dar next.' };
    }

    // 1. Check permissions / roles
    const durationMin = getClaimDuration(member, config);
    if (durationMin === 0) {
        return { error: '🚫 Você não possui um cargo que permite fazer reservas (claims).' };
    }

    // 2. Find respawn
    const respawn = findRespawn(query);
    if (!respawn) {
        return { error: `❌ Respawn **"${query}"** não encontrado na lista oficial.` };
    }
    if (respawn.error === 'multiple') {
        const list = respawn.matches.map(r => `\`${r.id}\` — **${r.name}** (${r.category})`).join('\n');
        return { error: `❓ Múltiplos respawns encontrados. Seja mais específico ou use o código:\n\n${list}` };
    }

    // Check if the claim overlaps with any active planilhado schedules
    const { checkPlanilhadoOverlap } = require('../modules/planilhadoManager');
    const conflictingSchedule = checkPlanilhadoOverlap(respawn.id, durationMin);
    if (conflictingSchedule) {
        return {
            error: `🚫 **Reserva Bloqueada:** O respawn **${respawn.name}** possui uma reserva diária planilhada ativa no horário **${conflictingSchedule.time_slot}** liderada por <@${conflictingSchedule.leader_discord_id}>.`
        };
    }

    // 3. Check if player already has an active or pending claim
    const existingPlayerClaim = db.getClaimByPlayer(user.id);
    if (existingPlayerClaim) {
        // Se a reserva atual for PENDENTE e for do mesmo respawn, aceita e ativa!
        if (existingPlayerClaim.status === 'pending' && existingPlayerClaim.respawn_id.toLowerCase() === respawn.id.toLowerCase()) {
            const durationMs = durationMin * 60 * 1000;
            db.insertClaim({
                respawnId: respawn.id,
                respawnName: respawn.name,
                category: respawn.category,
                playerId: user.id,
                playerName: user.username,
                durationMs,
                status: 'active'
            });

            if (typeof scheduler.updateLiveDashboard === 'function') {
                scheduler.updateLiveDashboard();
            }

            const activeClaim = db.getClaimByRespawn(respawn.id);
            return { success: true, claim: activeClaim, duration: durationMin };
        } else {
            const statusLabel = existingPlayerClaim.status === 'pending' ? 'pendente' : 'ativa';
            return {
                error: `⚠️ Você já tem uma reserva ${statusLabel} no respawn **${existingPlayerClaim.respawn_name}** (${existingPlayerClaim.respawn_id}).\nUse \`!liberar\` antes de reservar outro.`
            };
        }
    }

    // 4. Check if player is already in a queue
    const existingPlayerQueue = db.getPlayerQueue(user.id);
    if (existingPlayerQueue) {
        if (existingPlayerQueue.respawn_id.toLowerCase() === respawn.id.toLowerCase()) {
            return { error: `⚠️ Você já está na fila do respawn **${respawn.name}** (${respawn.id}).` };
        } else {
            return { error: `⚠️ Você já está na fila de outro respawn: **${existingPlayerQueue.respawn_id.toUpperCase()}**.` };
        }
    }

    // 5. Check if respawn is already claimed -> Join Queue (Next)
    const existingRespawnClaim = db.getClaimByRespawn(respawn.id);
    if (existingRespawnClaim) {
        db.addToQueue(respawn.id, user.id, user.username);
        const queue = db.getQueue(respawn.id);
        const position = queue.findIndex(q => q.player_id === user.id) + 1;

        if (typeof scheduler.updateLiveDashboard === 'function') {
            scheduler.updateLiveDashboard();
        }

        return {
            isQueue: true,
            respawnId: respawn.id,
            respawnName: respawn.name,
            position,
            ownerName: existingRespawnClaim.player_name
        };
    }

    // 6. Save claim
    const durationMs = durationMin * 60 * 1000;
    db.insertClaim({
        respawnId: respawn.id,
        respawnName: respawn.name,
        category: respawn.category,
        playerId: user.id,
        playerName: user.username,
        durationMs,
        status: 'active'
    });

    if (typeof scheduler.updateLiveDashboard === 'function') {
        scheduler.updateLiveDashboard();
    }

    const activeClaim = db.getClaimByRespawn(respawn.id);
    return { success: true, claim: activeClaim, duration: durationMin };
}

module.exports = {
    name: 'claim',
    aliases: ['respawn', 'reservar', 'claimar'],
    adminOnly: false,
    handleClaimLogic,
    
    // Command definition for Slash Commands
    data: new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Reserva um respawn do Tibia')
        .addStringOption(option =>
            option.setName('respawn')
                .setDescription('Código ou nome do respawn (Ex: Q2 ou Guzzlemaw)')
                .setRequired(true)
        ),

    // Execution via text message
    async execute(msg, args, { config }) {
        const query = args.join(' ');
        const result = await handleClaimLogic(msg.author, msg.member, query, config);
        
        if (result.error) {
            return msg.reply({ embeds: [buildErrorEmbed(result.error).catch(() => {})] });
        }
        if (result.isQueue) {
            return msg.reply({ embeds: [buildQueueSuccessEmbed(result.respawnId, result.respawnName, result.position, result.ownerName).catch(() => {})] });
        }
        return msg.reply({ embeds: [buildClaimSuccessEmbed(result.claim, result.duration).catch(() => {})] });
    },

    // Execution via Slash Interaction
    async executeSlash(interaction, { config }) {
        await interaction.deferReply();
        const query = interaction.options.getString('respawn');
        const result = await handleClaimLogic(interaction.user, interaction.member, query, config);

        if (result.error) {
            return interaction.editReply({ embeds: [buildErrorEmbed(result.error).catch(() => {})], ephemeral: true });
        }
        if (result.isQueue) {
            return interaction.editReply({ embeds: [buildQueueSuccessEmbed(result.respawnId, result.respawnName, result.position, result.ownerName).catch(() => {})], ephemeral: true });
        }
        return interaction.editReply({ embeds: [buildClaimSuccessEmbed(result.claim, result.duration).catch(() => {})], ephemeral: true });
    },

    handleClaimLogic
};
