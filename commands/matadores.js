'use strict';

const { buildMatadoresEmbed } = require('../modules/embeds');
const db    = require('../modules/database');

function buildFragsCount(frags) {
    const count = {};
    frags.forEach(f => {
        const killer = f.killerName || f.killer_name;
        if (!killer) return;

        const key = killer.toLowerCase();
        if (!count[key]) count[key] = { name: killer, kills: 0 };
        count[key].kills++;
    });
    return Object.values(count).sort((a, b) => b.kills - a.kills);
}

module.exports = {
    name: 'matadores',
    aliases: ['killers', 'frags', 'topmatadores'],
    adminOnly: false,
    async execute(msg, args, { }) {
        const isHistorical = msg.content.toLowerCase().includes('topmatadores');

        let frags;
        let title;

        if (isHistorical) {
            frags = db.getAllFrags();
            title = 'Grandes Matadores Históricos';
        } else {
            frags = db.db.prepare("SELECT * FROM frags WHERE created_at >= datetime('now', '-24 hours') ORDER BY created_at DESC").all();
            title = 'Maiores Matadores (Últimas 24h)';
        }

        const killers = buildFragsCount(frags).slice(0, 100);
        const embed   = buildMatadoresEmbed(killers, title);
        return msg.reply({ embeds: [embed] });
    },
};
