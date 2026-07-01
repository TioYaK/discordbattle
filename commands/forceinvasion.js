'use strict';

const { SlashCommandBuilder } = require('discord.js');
const scheduler = require('../modules/scheduler');

module.exports = {
    name: 'forceinvasion',
    aliases: ['spawnarinvasion', 'spawnar-invasion', 'forcarinvasao', 'forcar-invasao'],
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('forceinvasion')
        .setDescription('Força o spawn de uma Invasão de Monstros no Bastião imediatamente (Admin Only)'),

    async execute(msg, args, { client }) {
        try {
            await scheduler.spawnCityInvasion(true);
            await msg.reply('✅ Invasão de Cidade iniciada com sucesso no chat geral!').catch(() => {});
        } catch (err) {
            console.error('[Admin] Erro ao forçar spawn da invasão:', err.message);
            await msg.reply(`❌ Falha ao iniciar invasão: ${err.message}`).catch(() => {});
        }
    },

    async executeSlash(interaction, { client }) {
        await interaction.deferReply();
        try {
            await scheduler.spawnCityInvasion(true);
            await interaction.editReply({ content: '✅ Invasão de Cidade iniciada com sucesso no chat geral!', ephemeral: true }).catch(() => {});
        } catch (err) {
            console.error('[Admin] Erro ao forçar spawn da invasão:', err.message);
            await interaction.editReply({ content: `❌ Falha ao iniciar invasão: ${err.message}`, ephemeral: true }).catch(() => {});
        }
    }
};
