'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const { formatXp } = require('../modules/embeds');

function formatRemainingTime(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getWeeklyData() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // 1. Top XP Makers (Soma dos últimos 7 dias)
    const topXpRows = db.db.prepare(`
        SELECT name, SUM(gain_xp) as total_xp, SUM(online_ms) as total_online
        FROM daily_stats
        WHERE date >= ? AND gain_xp > 0
        GROUP BY name
        ORDER BY total_xp DESC
        LIMIT 10
    `).all(sevenDaysAgo);

    // 2. Top Fraggers (Soma dos últimos 7 dias)
    const topFragsRows = db.db.prepare(`
        SELECT killer_name as name, COUNT(*) as total_frags
        FROM frags
        WHERE date >= ?
        GROUP BY killer_name
        ORDER BY total_frags DESC
        LIMIT 10
    `).all(sevenDaysAgo);

    // 3. Totais para o K/D Geral da Guilda
    const totalFragsResult = db.db.prepare(`SELECT COUNT(*) as count FROM frags WHERE date >= ?`).get(sevenDaysAgo);
    const totalDeathsResult = db.db.prepare(`SELECT COUNT(*) as count FROM deaths WHERE date >= ?`).get(sevenDaysAgo);

    const totalFrags = totalFragsResult ? totalFragsResult.count : 0;
    const totalDeaths = totalDeathsResult ? totalDeathsResult.count : 0;

    return {
        topXpRows,
        topFragsRows,
        totalFrags,
        totalDeaths,
    };
}

module.exports = {
    name: 'semana',
    aliases: ['relatoriosemanal', 'weekly'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('semana')
        .setDescription('Mostra as estatísticas e os melhores jogadores da guilda nos últimos 7 dias'),

    async execute(msg, args, { config }) {
        const data = getWeeklyData();
        const guildName = config.guildName || 'Ascended';

        const embed = buildWeeklyEmbed(guildName, data);
        return msg.channel.send({ embeds: [embed] }).catch(() => {});
    },

    async executeSlash(interaction, { config }) {
        await interaction.deferReply();
        const data = getWeeklyData();
        const guildName = config.guildName || 'Ascended';

        const embed = buildWeeklyEmbed(guildName, data);
        return interaction.editReply({ embeds: [embed] }).catch(() => {});
    }
};

function buildWeeklyEmbed(guildName, data) {
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    // Formatar XP
    const xpLines = data.topXpRows.length
        ? data.topXpRows.map((r, i) => `${medals[i]} **${r.name}** · +${formatXp(r.total_xp)} XP`)
        : ['_Nenhum XP registrado_'];

    // Formatar Frags
    const fragLines = data.topFragsRows.length
        ? data.topFragsRows.map((r, i) => `${medals[i]} **${r.name}** · ${r.total_frags} ${r.total_frags === 1 ? 'frag' : 'frags'}`)
        : ['_Nenhum frag registrado_'];

    // Calcular K/D Geral da Guilda
    const kdRatio = data.totalDeaths > 0
        ? (data.totalFrags / data.totalDeaths).toFixed(2)
        : data.totalFrags.toFixed(2);

    return new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`📊 Relatório Semanal da Guilda — ${guildName}`)
        .setDescription(`Resumo das atividades e conquistas dos últimos 7 dias:`)
        .addFields(
            { name: '🏆 Top XP Makers (Semana)', value: xpLines.join('\n'), inline: false },
            { name: '🎯 Maiores Matadores (Semana)', value: fragLines.join('\n'), inline: false },
            {
                name: '⚔️ Balanço Geral de Guerra',
                value: `🎯 **Total de Frags:** \`${data.totalFrags}\`\n` +
                       `☠️ **Total de Mortes:** \`${data.totalDeaths}\`\n` +
                       `⚖️ **K/D Ratio da Guilda:** \`${kdRatio}\``,
                inline: false
            }
        )
        .setFooter({ text: 'Ascended Bot • RubinOT' })
        .setTimestamp();
}
