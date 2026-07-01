'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { handleClaimLogic } = require('./claim');
const { buildClaimSuccessEmbed, buildErrorEmbed, buildQueueSuccessEmbed } = require('../modules/embeds');

module.exports = {
    name: 'next',
    aliases: ['fila', 'entrarfila'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('next')
        .setDescription('Entra na fila (Next) de um respawn ocupado')
        .addStringOption(option =>
            option.setName('respawn')
                .setDescription('Código ou nome do respawn (Ex: Q2 ou Guzzlemaw)')
                .setRequired(true)
        ),

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

    async executeSlash(interaction, { config }) {
        await interaction.deferReply();
        const query = interaction.options.getString('respawn');
        const result = await handleClaimLogic(interaction.user, interaction.member, query, config);

        if (result.error) {
            return interaction.editReply({ embeds: [buildErrorEmbed(result.error).catch(() => {})], ephemeral: true });
        }
        if (result.isQueue) {
            return interaction.editReply({ embeds: [buildQueueSuccessEmbed(result.respawnId, result.respawnName, result.position, result.ownerName).catch(() => {})] });
        }
        return interaction.editReply({ embeds: [buildClaimSuccessEmbed(result.claim, result.duration).catch(() => {})] });
    }
};
