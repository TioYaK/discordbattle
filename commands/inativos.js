'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const state = require('../modules/state');

// Helper for vocation emojis
const VOCATION_EMOJI = {
    'knight'              : '🗡️',
    'elite knight'        : '⚔️',
    'paladin'             : '🏹',
    'royal paladin'       : '🎯',
    'sorcerer'            : '🔮',
    'master sorcerer'     : '✨',
    'druid'               : '🌿',
    'elder druid'         : '🌳',
};

function vocEmoji(vocation = '') {
    const key = vocation.toLowerCase().trim();
    return VOCATION_EMOJI[key] || '⚡';
}

module.exports = {
    name: 'inativos',
    aliases: ['inativos', 'inactivo', 'inactivos', 'inactive'],
    adminOnly: false,
    async execute(msg, args, { config }) {
        const guildName = config.guildName || 'Ascended Auroria';
        
        if (!state.guildMembers || state.guildMembers.length === 0) {
            return msg.reply('❌ Nenhum dado de guilda foi monitorado/scraped ainda. Por favor, aguarde alguns segundos e tente novamente.');
        }

        let days = 7;
        if (args.length > 0) {
            const parsed = parseInt(args[0], 10);
            if (isNaN(parsed) || parsed <= 0) {
                return msg.reply('⚠️ Por favor, forneça um número válido de dias maior que 0. Exemplo: `!inativos 7`');
            }
            days = parsed;
        }

        const now = Date.now();
        const inactiveMsThreshold = days * 24 * 60 * 60 * 1000;
        
        const lastSeenMap = db.getAllLastSeen();
        
        const neverSeen = [];
        const inactive = [];
        let onlineCount = 0;
        let activeOfflineCount = 0;

        state.guildMembers.forEach(m => {
            if (m.status === 'Online') {
                onlineCount++;
                return;
            }

            const lastSeen = lastSeenMap.get(m.name.toLowerCase());
            if (!lastSeen) {
                neverSeen.push(m);
            } else {
                const diffMs = now - lastSeen;
                if (diffMs >= inactiveMsThreshold) {
                    inactive.push({
                        ...m,
                        lastSeen,
                        diffDays: diffMs / (24 * 60 * 60 * 1000)
                    });
                } else {
                    activeOfflineCount++;
                }
            }
        });

        // Sort inactive by longest offline first (since lastSeen timestamp is smaller, we sort ascending to get oldest first)
        inactive.sort((a, b) => a.lastSeen - b.lastSeen);

        // Sort neverSeen by level descending
        neverSeen.sort((a, b) => b.level - a.level);

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6) // ASCENDED color
            .setTitle(`👥 Membros Inativos · ${guildName}`)
            .setDescription(`Filtro: offline há pelo menos **${days}** dias.`)
            .addFields(
                {
                    name: '📊 Resumo Geral',
                    value: `🟢 **Online:** \`${onlineCount}\` · 💤 **Ativos (Offline recente):** \`${activeOfflineCount}\`\n` +
                           `⏳ **Inativos:** \`${inactive.length}\` · ❓ **Nunca Vistos:** \`${neverSeen.length}\`\n` +
                           `👥 **Total na Guilda:** \`${state.guildMembers.length}\``,
                    inline: false
                }
            );

        // Format inactive list
        if (inactive.length > 0) {
            const displayLimit = 15;
            const lines = inactive.slice(0, displayLimit).map(m => {
                return `${vocEmoji(m.vocation)} **${m.name}** (Lv.${m.level}, ${m.rank}) · *há ${Math.floor(m.diffDays)}d*`;
            });
            
            if (inactive.length > displayLimit) {
                lines.push(`*... e mais ${inactive.length - displayLimit} membros inativos.*`);
            }

            embed.addFields({
                name: `⏳ Inativos (Exibindo ${Math.min(inactive.length, displayLimit)} de ${inactive.length})`,
                value: lines.join('\n'),
                inline: false
            });
        } else {
            embed.addFields({
                name: '⏳ Inativos',
                value: `_Nenhum membro inativo (há ${days}d+) registrado._`,
                inline: false
            });
        }

        // Format never seen list
        if (neverSeen.length > 0) {
            const displayLimit = 15;
            const lines = neverSeen.slice(0, displayLimit).map(m => {
                return `${vocEmoji(m.vocation)} **${m.name}** (Lv.${m.level}, ${m.rank})`;
            });

            if (neverSeen.length > displayLimit) {
                lines.push(`*... e mais ${neverSeen.length - displayLimit} membros nunca vistos.*`);
            }

            embed.addFields({
                name: `❓ Nunca Vistos Online (Exibindo ${Math.min(neverSeen.length, displayLimit)} de ${neverSeen.length})`,
                value: lines.join('\n'),
                inline: false
            });
        }

        embed.setFooter({ text: 'Ascended Bot • RubinOT', iconURL: 'https://rubinot.com.br/favicon.ico' })
             .setTimestamp();

        return msg.reply({ embeds: [embed] });
    }
};
