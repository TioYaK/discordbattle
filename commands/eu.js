'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const embeds = require('../modules/embeds');
const { ACHIEVEMENTS } = require('../modules/achievements');

function formatVoiceMs(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
}

function getLevelProgress(xp) {
    let level = 1;
    if (xp >= 400) {
        level = Math.floor(0.1 * Math.sqrt(xp));
    }
    const currentLevelMinXp = level === 1 ? 0 : 100 * (level ** 2);
    const nextLevelMinXp = 100 * ((level + 1) ** 2);
    const xpInLevel = xp - currentLevelMinXp;
    const xpNeeded = nextLevelMinXp - currentLevelMinXp;
    const percentage = Math.min(100, Math.floor((xpInLevel / xpNeeded) * 100));
    
    const filledSegments = Math.round(percentage / 10);
    const bar = '█'.repeat(filledSegments) + '░'.repeat(10 - filledSegments);
    
    return {
        level,
        xpInLevel,
        xpNeeded,
        percentage,
        bar
    };
}

module.exports = {
    name: 'eu',
    aliases: ['meuPerfil', 'perfil', 'meuperfil'],
    description: 'Exibe seu perfil completo com stats, K/D, conquistas e posição nos rankings.',
    adminOnly: false,

    async execute(message, args, config, client) {
        const discordId = message.author.id;

        // Verificar se o membro está registrado
        const memberRow = db.getRegisteredMember(discordId);
        if (!memberRow) {
            return message.reply('❌ Você não está registrado. Use o canal de registros para se registrar.');
        }

        const sinceDate = db.dateDaysAgo(30);
        const sinceTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000;

        // Coletar dados
        const kd = db.getPlayerKD(discordId, sinceDate);
        const voiceMs = db.getVoiceTimeMs(discordId, sinceTimestamp);
        const totalVoiceMs = db.getTotalVoiceTimeMs(discordId);
        const evasion = db.getMassivoEvasion(discordId);
        const playerAchievements = db.getPlayerAchievements(discordId);
        const allRegistered = db.getAllRegisteredMembers();

        // Ranking K/D
        const topKD = db.getTopKDPlayers(sinceDate, 100);
        const kdRankIdx = topKD.findIndex(r => r.discord_id === discordId || r.discordId === discordId);
        const kdRank = kdRankIdx >= 0 ? kdRankIdx + 1 : null;
        const kdRankStr = kdRank
            ? `#${kdRank} de ${allRegistered.length} guerreiros`
            : '_Fora do ranking_';

        // Ranking de voz
        const voiceRankRows = db.db.prepare(
            `SELECT discord_id FROM voice_sessions
             JOIN registered_members rm ON voice_sessions.discord_id = rm.discord_id
             WHERE voice_sessions.start_time >= ?
             GROUP BY rm.discord_id
             ORDER BY SUM(CASE WHEN end_time IS NOT NULL THEN end_time - start_time ELSE ? - start_time END) DESC`
        ).all(sinceTimestamp, Date.now());
        const voiceRankIdx = voiceRankRows.findIndex(r => r.discord_id === discordId);
        const voiceRank = voiceRankIdx >= 0 ? voiceRankIdx + 1 : null;
        const voiceRankStr = voiceRank
            ? `#${voiceRank} de ${allRegistered.length} guerreiros`
            : '_Fora do ranking_';

        // XP de hoje
        let todayXp = 0;
        try {
            const dailyStats = db.getDailyStatsForDate(db.todayDate());
            const todayRow = dailyStats.find(row =>
                row.name && row.name.toLowerCase() === memberRow.char_name.toLowerCase()
            );
            todayXp = todayRow ? (todayRow.gain_xp || 0) : 0;
        } catch (e) {
            todayXp = 0;
        }

        // XP do mês
        let monthXp = 0;
        try {
            const monthRow = db.db.prepare(
                `SELECT SUM(gain_xp) as total FROM daily_stats WHERE LOWER(name) = LOWER(?) AND date >= ?`
            ).get(memberRow.char_name, sinceDate);
            monthXp = monthRow ? (monthRow.total || 0) : 0;
        } catch (e) {
            monthXp = 0;
        }

        // Bomba
        const bomba = memberRow.bomba;
        const bombaStr = bomba && bomba !== '-' ? ` · Bomba: ${bomba}` : '';

        // Conquistas
        let achievementsStr;
        if (!playerAchievements || playerAchievements.length === 0) {
            achievementsStr = '_Nenhuma conquista ainda._';
        } else {
            achievementsStr = playerAchievements
                .map(a => ACHIEVEMENTS[a.achievement_id]?.name || a.achievement_id)
                .join('\n');
        }

        // Evasão
        const ignoredStr = evasion ? formatVoiceMs(evasion.ignored_ms || 0) : '—';
        const logoffsStr = evasion ? `${evasion.logoffs || 0}` : '—';

        const xpProgress = getLevelProgress(memberRow.guild_xp || 0);
        const levelMultiplier = 1 + (xpProgress.level - 1) * 0.02;
        const multiplierPct = ((levelMultiplier - 1) * 100).toFixed(0);

        // Montar embed
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(`🎖️ Perfil de ${memberRow.char_name}`)
            .setDescription(`Membro registrado · Classe: ${memberRow.class_code}${bombaStr}`)
            .addFields(
                {
                    name: `📈 Nível de Atividade: Lvl ${xpProgress.level}`,
                    value: `\`${xpProgress.bar}\` **${xpProgress.percentage}%**\n` +
                           `✨ **XP:** \`${xpProgress.xpInLevel.toFixed(0)} / ${xpProgress.xpNeeded} XP\` (Total: \`${(memberRow.guild_xp || 0).toFixed(0)} XP\`)\n` +
                           `🪙 **Bônus de AC:** \`+${multiplierPct}%\` extra em calls!`,
                    inline: false
                },
                {
                    name: '⚔️ K/D (30 dias)',
                    value: `${kd.frags} frags / ${kd.deaths} mortes = **${kd.kd.toFixed(2)}**`,
                    inline: true
                },
                {
                    name: '🏆 Rank K/D',
                    value: kdRankStr,
                    inline: true
                },
                {
                    name: '📞 Tempo em Call (30d)',
                    value: formatVoiceMs(voiceMs),
                    inline: true
                },
                {
                    name: '📞 Tempo Total em Call',
                    value: formatVoiceMs(totalVoiceMs),
                    inline: true
                },
                {
                    name: '📅 XP Hoje',
                    value: embeds.formatXp(todayXp),
                    inline: true
                },
                {
                    name: '📅 XP do Mês',
                    value: embeds.formatXp(monthXp),
                    inline: true
                },
                {
                    name: '🚨 Massivo - Ignorou',
                    value: ignoredStr,
                    inline: true
                },
                {
                    name: '🚨 Massivo - Deslogou',
                    value: logoffsStr,
                    inline: true
                },
                {
                    name: '🏅 Conquistas',
                    value: achievementsStr,
                    inline: false
                },
            )
            .setFooter({ text: 'Ascended Bot • Perfil' })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    },
};
