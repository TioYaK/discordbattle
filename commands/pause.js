'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const scheduler = require('../modules/scheduler');

module.exports = {
    name: 'pause',
    aliases: ['pausar'],
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pausa globalmente o sistema de reservas (claims) durante a guerra'),

    async execute(msg, args, { config, saveConfig }) {
        config.claimsPaused = 'true';
        db.setConfig('claimsPaused', 'true');
        saveConfig(config);
        
        // Clear all active claims and queues
        db.db.exec('DELETE FROM claims');
        db.db.exec('DELETE FROM claims_queue');

        // Update live panel
        if (typeof scheduler.updateLiveDashboard === 'function') {
            await scheduler.updateLiveDashboard();
        }

        const embed = new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('⏸️ Reservas Pausadas')
            .setDescription('O sistema de claims/reservas foi **pausado globalmente**. Todas as reservas e filas ativas foram limpas.')
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        return msg.channel.send({ embeds: [embed] }).catch(() => {});
    },

    async executeSlash(interaction, { config, saveConfig }) {
        await interaction.deferReply();
        config.claimsPaused = 'true';
        db.setConfig('claimsPaused', 'true');
        saveConfig(config);

        // Clear all active claims and queues
        db.db.exec('DELETE FROM claims');
        db.db.exec('DELETE FROM claims_queue');

        // Update live panel
        if (typeof scheduler.updateLiveDashboard === 'function') {
            await scheduler.updateLiveDashboard();
        }

        const embed = new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('⏸️ Reservas Pausadas')
            .setDescription('O sistema de claims/reservas foi **pausado globalmente**. Todas as reservas e filas ativas foram limpas.')
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] }).catch(() => {});
    }
};
