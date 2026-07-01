'use strict';

const { buildDeathsEmbed } = require('../modules/embeds');
const state = require('../modules/state');
const db    = require('../modules/database');

module.exports = {
    name: 'mortes',
    aliases: ['deaths', 'pvp'],
    adminOnly: false,
    async execute(msg, args, { }) {
        const deaths = state.dailyDeaths.length > 0
            ? state.dailyDeaths
            : db.getDeathsForDate(db.todayDate());

        const embed = buildDeathsEmbed(deaths);
        return msg.reply({ embeds: [embed] });
    },
};
