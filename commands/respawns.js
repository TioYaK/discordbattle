'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../modules/database');
const { buildActiveClaimsEmbed } = require('../modules/embeds');

module.exports = {
    name: 'respawns',
    aliases: ['claims', 'ocupados', 'reservas'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('respawns')
        .setDescription('Mostra a lista de respawns reservados no momento'),

    async execute(msg, args) {
        const claims = db.getActiveClaims();
        return msg.reply({ embeds: [buildActiveClaimsEmbed(claims).catch(() => {})] });
    },

    async executeSlash(interaction) {
        await interaction.deferReply();
        const claims = db.getActiveClaims();
        return interaction.editReply({ embeds: [buildActiveClaimsEmbed(claims).catch(() => {})] });
    }
};
