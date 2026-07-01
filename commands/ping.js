const { SlashCommandBuilder } = require('discord.js');
const { buildPingEmbed } = require('../modules/embeds');

module.exports = {
    name: 'ping',
    aliases: [],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Verifica a latência do bot e da API'),

    async execute(msg, args, { client }) {
        const sent = await msg.reply('🏓 Calculando...');
        const latency = sent.createdTimestamp - msg.createdTimestamp;
        const apiLatency = Math.round(client.ws.ping);
        return sent.edit({ content: '', embeds: [buildPingEmbed(latency, apiLatency)] });
    },

    async executeSlash(interaction, { client }) {
        const sent = await interaction.reply({ content: '🏓 Calculando...', fetchReply: true });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(client.ws.ping);
        return interaction.editReply({ content: '', embeds: [buildPingEmbed(latency, apiLatency)] });
    }
};
