'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');

module.exports = {
    name: 'ranking-invasoes',
    aliases: ['rankinginvasoes', 'topinvasoes'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('ranking-invasoes')
        .setDescription('Mostra o ranking global de dano causado nas invasões da cidade'),

    async execute(msg) {
        return handleRanking(msg.channel);
    },

    async executeSlash(interaction) {
        await interaction.deferReply();
        return handleRanking(interaction.channel, interaction);
    }
};

async function handleRanking(channel, interaction = null) {
    const ranking = db.getInvasionRanking(10); // get top 10

    if (!ranking || ranking.length === 0) {
        const err = '❌ Ainda não há dados de invasões suficientes para montar o ranking.';
        if (interaction) return interaction.editReply({ content: err }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    let description = '';
    const medals = ['🥇', '🥈', '🥉'];

    ranking.forEach((player, index) => {
        const medal = index < 3 ? medals[index] : '🏅';
        description += `${medal} **${player.char_name}**\n`;
        description += `└ 💥 **${player.total_damage.toLocaleString()}** Dano Total | 🗡️ **${player.invasions_participated}** Invasões\n\n`;
    });

    const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('🏆 Ranking Global de Invasões 🏆')
        .setDescription('Os heróis mais poderosos que defenderam o Bastião de Aethelgard:\n\n' + description)
        .setFooter({ text: 'Aethelgard RPG • Atualizado em tempo real' })
        .setTimestamp();

    if (interaction) {
        return interaction.editReply({ embeds: [embed] }).catch(() => {});
    }
    return channel.send({ embeds: [embed] }).catch(() => {});
}
