'use strict';

const { buildRadarEmbed } = require('../modules/embeds');
const state = require('../modules/state');

module.exports = {
    name: 'radar',
    aliases: ['inimigos', 'enemies'],
    adminOnly: false,
    async execute(msg, args, { }) {
        const onlineEnemies = state.huntedList
            .map(name => {
                const p = state.trackedEnemyPlayers[name] ||
                    Object.values(state.trackedEnemyPlayers).find(pl => pl.name.toLowerCase() === name.toLowerCase());
                if (p && p.status === 'Online') return p;
                
                if (state.huntedOnlineAlerted.has(name)) {
                    return { name, level: '?', vocation: '?' };
                }
                return null;
            })
            .filter(Boolean);

        const embed = buildRadarEmbed(onlineEnemies);
        return msg.reply({ embeds: [embed] });
    },
};
