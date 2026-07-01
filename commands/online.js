'use strict';

const { buildOnlineEmbed, buildEnemyOnlineListEmbed } = require('../modules/embeds');
const state = require('../modules/state');

module.exports = {
    name: 'online',
    aliases: [],
    adminOnly: false,
    async execute(msg, args, { config }) {
        // Guilda aliada
        const allyEmbed = buildOnlineEmbed(
            state.guildMembers,
            config.guildName || 'Ascended',
            state.dailyStats
        );
        await msg.reply({ embeds: [allyEmbed] });

        // Guilda inimiga
        if (config.enemyGuildName) {
            const enemyEmbed = buildEnemyOnlineListEmbed(
                state.enemyGuildMembers || [],
                config.enemyGuildName
            );
            await msg.channel.send({ embeds: [enemyEmbed] });
        }
    },
};
