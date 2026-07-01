'use strict';

const db = require('../modules/database');
const embeds = require('../modules/embeds');

module.exports = {
    name: 'reputacao',
    aliases: ['kd', 'rankguerra', 'kdrank', 'warrank'],
    description: 'Exibe o ranking de K/D de guerra dos membros registrados (main + bomba).',
    usage: '!reputacao [dias]',
    adminOnly: false,

    async execute(message, args, config, client) {
        // Verificar se o membro está registrado
        const memberRow = db.getRegisteredMember(message.author.id);
        if (!memberRow) {
            return message.reply('❌ Você não está registrado. Use o canal de registros para se registrar.');
        }

        // Parse de dias (1-365), padrão 30
        let dias = 30;
        if (args.length > 0) {
            const parsed = parseInt(args[0], 10);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 365) {
                dias = parsed;
            }
        }

        // Calcular sinceDate manualmente
        const sinceDate = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        // Buscar top K/D
        const rows = db.getTopKDPlayers(sinceDate, 15);

        // Montar e enviar embed
        const embed = embeds.buildKDLeaderboardEmbed(rows, sinceDate, dias);
        return message.reply({ embeds: [embed] });
    },
};
