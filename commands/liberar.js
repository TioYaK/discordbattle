'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const { buildClaimReleasedEmbed, buildErrorEmbed } = require('../modules/embeds');
const respawnsList = require('../data/respawns.json');
const scheduler = require('../modules/scheduler');

// Helper to find a respawn by query (code or name)
function findRespawn(query) {
    const q = query.toLowerCase().trim();
    let match = respawnsList.find(r => r.id.toLowerCase() === q);
    if (match) return match;
    match = respawnsList.find(r => r.name.toLowerCase() === q);
    if (match) return match;
    const partials = respawnsList.filter(r => r.name.toLowerCase().includes(q));
    if (partials.length === 1) return partials[0];
    return null;
}

function isUserAdmin(member, config) {
    if (!member) return false;
    return member.permissions.has('Administrator') || 
           member.permissions.has('ManageGuild') || 
           (config.adminRoleId && member.roles.cache.has(config.adminRoleId));
}

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

async function handleLiberarLogic(user, member, query, config, client) {
    if (config.claimsPaused === 'true') {
        return { error: '⚠️ **O sistema de reservas (claims) está pausado no momento (Guerra ativa).**' };
    }

    let activeClaim = null;

    // Case 1: Release specific respawn (Admin only)
    if (query) {
        if (!isUserAdmin(member, config)) {
            return { error: '🚫 Apenas administradores podem liberar respawns de outros jogadores.' };
        }

        const respawn = findRespawn(query);
        if (!respawn) {
            return { error: `❌ Respawn **"${query}"** não encontrado na lista oficial.` };
        }

        activeClaim = db.getClaimByRespawn(respawn.id);
        if (!activeClaim) {
            return { error: `ℹ️ O respawn **${respawn.name}** (${respawn.id}) não está ocupado no momento.` };
        }
    } else {
        // Case 2: Release own claim
        activeClaim = db.getClaimByPlayer(user.id);
        if (!activeClaim) {
            return { error: 'ℹ️ Você não possui nenhuma reserva ativa no momento.' };
        }
    }

    // Delete the active claim
    db.deleteClaim(activeClaim.respawn_id);

    // Promote the next player in the queue (if any)
    await scheduler.promoteNextInQueue(activeClaim.respawn_id, activeClaim.respawn_name, activeClaim.category);

    if (typeof scheduler.updateLiveDashboard === 'function') {
        scheduler.updateLiveDashboard();
    }

    return { success: true, claim: activeClaim };
}

module.exports = {
    name: 'liberar',
    aliases: ['leave', 'unclaim', 'sair'],
    adminOnly: false,
    handleLiberarLogic,

    data: new SlashCommandBuilder()
        .setName('liberar')
        .setDescription('Libera um respawn reservado')
        .addStringOption(option =>
            option.setName('respawn')
                .setDescription('Código ou nome do respawn (Apenas Admins podem liberar respawns alheios)')
                .setRequired(false)
        ),

    async execute(msg, args, { config, client }) {
        const query = args.join(' ');
        const result = await handleLiberarLogic(msg.author, msg.member, query, config, client);

        if (result.error) {
            return msg.reply({ embeds: [buildErrorEmbed(result.error).catch(() => {})] });
        }
        return msg.reply({ embeds: [buildClaimReleasedEmbed(result.claim).catch(() => {})] });
    },

    async executeSlash(interaction, { config, client }) {
        await interaction.deferReply();
        const query = interaction.options.getString('respawn');
        const result = await handleLiberarLogic(interaction.user, interaction.member, query, config, client);

        if (result.error) {
            return interaction.editReply({ embeds: [buildErrorEmbed(result.error).catch(() => {})], ephemeral: true });
        }
        return interaction.editReply({ embeds: [buildClaimReleasedEmbed(result.claim).catch(() => {})] });
    }
};
