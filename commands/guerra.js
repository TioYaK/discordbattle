'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const state = require('../modules/state');

function isAdmin(member, config) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    if (member.permissions.has('ManageGuild'))   return true;
    if (config.adminRoleId && member.roles.cache.has(config.adminRoleId)) return true;
    return false;
}

module.exports = {
    name: 'guerra',
    aliases: ['war', 'placar', 'guerrafull'],
    adminOnly: false,
    async execute(msg, args, { config }) {
        const guildName = config.guildName || 'Ascended';

        // Check for reset/clear command
        if (args[0] === 'zerar' || args[0] === 'reset') {
            if (!isAdmin(msg.member, config)) {
                return msg.reply('🚫 Apenas administradores podem zerar o placar.').catch(() => {});
            }

            try {
                db.db.prepare('DELETE FROM frags').run();
                db.db.prepare('DELETE FROM deaths').run();
                state.dailyDeaths = [];
                state.dailyFrags = [];

                // Refresh scoreboard channel
                const { updateWarScoreboard } = require('../modules/scheduler');
                await updateWarScoreboard().catch(() => {});

                return msg.reply('✅ Placar de guerra resetado com sucesso! Todos os frags e mortes foram zerados.').catch(() => {});
            } catch (err) {
                console.error('[Bot] Erro ao zerar placar:', err);
                return msg.reply('❌ Erro ao zerar placar de guerra.').catch(() => {});
            }
        }

        let minLevel = 0;
        let maxLevel = 0;
        let levelText = '';

        if (args[0]) {
            const argStr = args[0].trim();
            if (argStr.endsWith('-')) {
                maxLevel = parseInt(argStr.slice(0, -1), 10);
                if (!isNaN(maxLevel) && maxLevel > 0) {
                    levelText = ` (Lv. ${maxLevel}-)`;
                } else {
                    maxLevel = 0;
                }
            } else {
                const cleanArg = argStr.endsWith('+') ? argStr.slice(0, -1) : argStr;
                minLevel = parseInt(cleanArg, 10);
                if (!isNaN(minLevel) && minLevel > 0) {
                    levelText = ` (Lv. ${minLevel}+)`;
                } else {
                    minLevel = 0;
                }
            }
        }

        // Query counts and latest records
        let totalFrags, totalDeaths;
        let lastFrags, lastDeaths;

        try {
            if (minLevel > 0) {
                totalFrags = db.db.prepare('SELECT COUNT(*) as count FROM frags WHERE victim_level >= ?').get(minLevel).count;
                totalDeaths = db.db.prepare('SELECT COUNT(*) as count FROM deaths WHERE is_pvp = 1 AND level >= ?').get(minLevel).count;

                lastFrags = db.db.prepare('SELECT killer_name, victim_name, raw_time, victim_level FROM frags WHERE victim_level >= ? ORDER BY created_at DESC LIMIT 5').all(minLevel);
                lastDeaths = db.db.prepare('SELECT name, level, killed_by, raw_time FROM deaths WHERE is_pvp = 1 AND level >= ? ORDER BY created_at DESC LIMIT 5').all(minLevel);
            } else if (maxLevel > 0) {
                totalFrags = db.db.prepare('SELECT COUNT(*) as count FROM frags WHERE victim_level <= ?').get(maxLevel).count;
                totalDeaths = db.db.prepare('SELECT COUNT(*) as count FROM deaths WHERE is_pvp = 1 AND level <= ?').get(maxLevel).count;

                lastFrags = db.db.prepare('SELECT killer_name, victim_name, raw_time, victim_level FROM frags WHERE victim_level <= ? ORDER BY created_at DESC LIMIT 5').all(maxLevel);
                lastDeaths = db.db.prepare('SELECT name, level, killed_by, raw_time FROM deaths WHERE is_pvp = 1 AND level <= ? ORDER BY created_at DESC LIMIT 5').all(maxLevel);
            } else {
                totalFrags = db.db.prepare('SELECT COUNT(*) as count FROM frags').get().count;
                totalDeaths = db.db.prepare('SELECT COUNT(*) as count FROM deaths WHERE is_pvp = 1').get().count;

                lastFrags = db.db.prepare('SELECT killer_name, victim_name, raw_time, victim_level FROM frags ORDER BY created_at DESC LIMIT 5').all();
                lastDeaths = db.db.prepare('SELECT name, level, killed_by, raw_time FROM deaths WHERE is_pvp = 1 ORDER BY created_at DESC LIMIT 5').all();
            }

            // Calculate progress bar
            const total = totalFrags + totalDeaths;
            let progressBar = '🟩🟥';
            if (total > 0) {
                const percent = Math.round((totalFrags / total) * 10);
                progressBar = '🟩'.repeat(percent) + '🟥'.repeat(10 - percent);
            }
            const kdRatio = totalDeaths > 0 ? (totalFrags / totalDeaths).toFixed(2) : totalFrags.toFixed(2);

            // Format lines
            const fragLines = lastFrags.length
                ? lastFrags.map((f, i) => {
                    const lvlSuffix = f.victim_level ? ` [Lv.${f.victim_level}]` : '';
                    return `\`${i + 1}.\` 🎯 **${f.killer_name}** matou **${f.victim_name}**${lvlSuffix} (${f.raw_time || '?'})`;
                })
                : ['_Nenhum frag registrado_'];

            const deathLines = lastDeaths.length
                ? lastDeaths.map((d, i) => {
                    const line = `\`${i + 1}.\` ☠️ **${d.name}** [Lv.${d.level || '?'}] para **${d.killed_by || '?'}**`;
                    return line.length > 75 ? line.slice(0, 75) + '...' + ` (${d.raw_time || '?'})` : line + ` (${d.raw_time || '?'})`;
                })
                : ['_Nenhuma morte registrada_'];

            const embed = new EmbedBuilder()
                .setColor(0xC0392B) // COLORS.WAR
                .setTitle(`⚔️ PLACAR DE GUERRA — ${guildName}${levelText}`)
                .setDescription(
                    `Acompanhe o andamento da guerra em tempo real!\n\n` +
                    `**Balanço Geral:**\n` +
                    `${progressBar} \`${totalFrags} vs ${totalDeaths} (K/D: ${kdRatio})\``
                )
                .addFields(
                    { name: '🎯 Últimos 5 Frags (Aliados)', value: fragLines.join('\n'), inline: false },
                    { name: '☠️ Últimas 5 Mortes (Aliadas)', value: deathLines.join('\n'), inline: false }
                )
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();

            return msg.reply({ embeds: [embed] }).catch(() => {});
        } catch (err) {
            console.error('[Bot] Erro no comando guerra:', err.message, err.stack);
            return msg.reply({
                embeds: [
                    new EmbedBuilder().catch(() => {})
                        .setColor(0xFF4444)
                        .setTitle('❌ Erro Interno')
                        .setDescription('Ocorreu um erro ao calcular o placar de guerra.')
                        .setTimestamp()
                ]
            });
        }
    },
};
