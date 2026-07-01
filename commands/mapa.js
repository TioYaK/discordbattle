'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const TIBIA_MAP_URL = 'https://files.catbox.moe/07qrwl.jpg';

module.exports = {
    name: 'mapa',
    aliases: ['map', 'respawnmap', 'respawnsmap'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('mapa')
        .setDescription('Mostra a imagem do mapa do Tibia Global'),

    async execute(msg, args) {
        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('🗺️ Mapa do Tibia Global')
            .setImage(TIBIA_MAP_URL)
            .setFooter({ text: 'Ascended Bot • RubinOT', iconURL: 'https://rubinot.com.br/favicon.ico' })
            .setTimestamp();

        return msg.reply({ embeds: [embed] });
    },

    async executeSlash(interaction) {
        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('🗺️ Mapa do Tibia Global')
            .setImage(TIBIA_MAP_URL)
            .setFooter({ text: 'Ascended Bot • RubinOT', iconURL: 'https://rubinot.com.br/favicon.ico' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};
