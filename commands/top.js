'use strict';

const { buildTopEmbed } = require('../modules/embeds');
const state = require('../modules/state');
const db    = require('../modules/database');

module.exports = {
    name: 'top',
    aliases: ['topxp', 'ranking'],
    adminOnly: false,
    async execute(msg, args, { config }) {
        const limit = parseInt(args[0], 10) || 10;
        const today = db.todayDate();

        const players = Object.keys(state.dailyStats).length > 0
            ? Object.keys(state.dailyStats).map(name => ({ name, ...state.dailyStats[name] }))
            : db.getDailyStatsForDate(today).map(r => ({
                name: r.name,
                dailyXp: r.daily_xp || 0,
                gainXp: r.gain_xp || 0,
                lostXp: r.lost_xp || 0,
                onlineMs: r.online_ms || 0,
            }));

        const topPlayers = players
            .sort((a, b) => (b.dailyXp || 0) - (a.dailyXp || 0))
            .slice(0, Math.min(limit, 10));

        const embed = buildTopEmbed(topPlayers, `Top ${topPlayers.length} XP do Dia`);
        return msg.reply({ embeds: [embed] });
    },
};
