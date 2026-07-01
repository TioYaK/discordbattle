'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const scheduler = require('../modules/scheduler');

module.exports = {
    name: 'resume',
    aliases: ['despausar', 'retomar'],
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Retoma globalmente o sistema de reservas (claims)'),

    async execute(msg, args, { config, saveConfig }) {
        config.claimsPaused = 'false';
        db.setConfig('claimsPaused', 'false');
        saveConfig(config);

        // Update live panel
        if (typeof scheduler.updateLiveDashboard === 'function') {
            await scheduler.updateLiveDashboard();
        }

        const embed = new EmbedBuilder()
            .setColor(0x44FF88)
            .setTitle('▶️ Reservas Retomadas')
            .setDescription('O sistema de claims/reservas foi **retomado**. Os jogadores já podem fazer novas reservas.')
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        return msg.channel.send({ embeds: [embed] }).catch(() => {});
    },

    async executeSlash(interaction, { config, saveConfig }) {
        await interaction.deferReply();
        config.claimsPaused = 'false';
        db.setConfig('claimsPaused', 'false');
        saveConfig(config);

        // Update live panel
        if (typeof scheduler.updateLiveDashboard === 'function') {
            await scheduler.updateLiveDashboard();
        }

        const embed = new EmbedBuilder()
            .setColor(0x44FF88)
            .setTitle('▶️ Reservas Retomadas')
            .setDescription('O sistema de claims/reservas foi **retomado**. Os jogadores já podem fazer novas reservas.')
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] }).catch(() => {});
    }
};
