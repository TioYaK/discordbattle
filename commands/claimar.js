'use strict';

const { SlashCommandBuilder } = require('discord.js');
const claim = require('./claim');

module.exports = {
    name: 'claimar',
    aliases: [],
    adminOnly: false,
    
    data: new SlashCommandBuilder()
        .setName('claimar')
        .setDescription('Reserva um respawn do Tibia')
        .addStringOption(option =>
            option.setName('respawn')
                .setDescription('Código ou nome do respawn (Ex: Q2 ou Guzzlemaw)')
                .setRequired(true)
        ),

    async execute(msg, args, context) {
        return claim.execute(msg, args, context);
    },

    async executeSlash(interaction, context) {
        return claim.executeSlash(interaction, context);
    }
};
