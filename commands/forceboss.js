'use strict';

const { SlashCommandBuilder } = require('discord.js');
const scheduler = require('../modules/scheduler');

module.exports = {
    name: 'forceboss',
    aliases: ['spawnarboss', 'spawnar-boss'],
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('forceboss')
        .setDescription('Força o spawn de um Boss de invasão diário imediatamente (Admin Only)'),

    async execute(msg, args, { client }) {
        try {
            await scheduler.spawnRaidBoss(true);
            await msg.reply('✅ Invasão de Boss iniciada com sucesso no chat geral!').catch(() => {});
        } catch (err) {
            console.error('[Admin] Erro ao forçar spawn do boss:', err.message);
            await msg.reply(`❌ Falha ao iniciar invasão: ${err.message}`).catch(() => {});
        }
    },

    async executeSlash(interaction, { client }) {
        await interaction.deferReply();
        try {
            await scheduler.spawnRaidBoss(true);
            await interaction.editReply({ content: '✅ Invasão de Boss iniciada com sucesso no chat geral!', ephemeral: true }).catch(() => {});
        } catch (err) {
            console.error('[Admin] Erro ao forçar spawn do boss:', err.message);
            await interaction.editReply({ content: `❌ Falha ao iniciar invasão: ${err.message}`, ephemeral: true }).catch(() => {});
        }
    }
};
