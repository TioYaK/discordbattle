'use strict';

const { buildRelatorioEmbed } = require('../modules/embeds');
const state = require('../modules/state');
const db    = require('../modules/database');

module.exports = {
    name: 'relatorio',
    aliases: ['report', 'stats'],
    adminOnly: false,
    async execute(msg, args, { config }) {
        const guildName = config.guildName || 'Ascended';
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

        const deathsCount = state.dailyDeaths.length > 0
            ? state.dailyDeaths.length
            : db.getDeathsForDate(today).length;

        const fragsCount = state.dailyFrags.length > 0
            ? state.dailyFrags.length
            : db.getFragsForDate(today).length;

        const embed = buildRelatorioEmbed(
            players.sort((a, b) => (b.dailyXp || 0) - (a.dailyXp || 0)),
            deathsCount,
            fragsCount,
            guildName
        );

        return msg.reply({ embeds: [embed] });
    },
};
