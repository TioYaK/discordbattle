'use strict';

const { buildOraculoEmbed, buildErrorEmbed } = require('../modules/embeds');
const state = require('../modules/state');

module.exports = {
    name: 'oraculo',
    aliases: ['previsao', 'nextlevel', 'level'],
    adminOnly: false,
    async execute(msg, args, { }) {
        const name = args.join(' ').trim();
        if (!name) {
            return msg.reply({ embeds: [buildErrorEmbed('Uso: `!oraculo <nome do personagem>`')] });
        }

        const player = state.trackedPlayers[name] ||
            Object.values(state.trackedPlayers).find(p => p.name.toLowerCase() === name.toLowerCase());

        if (!player) {
            return msg.reply({ embeds: [buildErrorEmbed(`**${name}** não está sendo rastreado no momento. Use \`!jogador\` para buscar informações do personagem.`)] });
        }

        if (!player.experience || player.experience <= 0) {
            return msg.reply({ embeds: [buildErrorEmbed(`Sem dados de experiência para **${player.name}** ainda. Aguarde o próximo ciclo de highscores.`)] });
        }

        const stats = state.dailyStats[player.name] || { gainXp: 0, onlineMs: 0 };
        const embed = buildOraculoEmbed(player, stats);
        return msg.reply({ embeds: [embed] });
    },
};
