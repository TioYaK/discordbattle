'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');

function formatDuration(ms) {
    if (ms <= 0) return '0m';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

module.exports = {
    name: 'presenca',
    aliases: ['presenca', 'presence'],
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('presenca')
        .setDescription('Relatório de presença em canais de voz e evasão de combate')
        .addIntegerOption(option =>
            option.setName('dias')
                .setDescription('Número de dias para o relatório')
                .setRequired(false)
        ),

    async execute(msg, args, { config }) {
        let days = 7;
        if (args.length > 0) {
            const parsed = parseInt(args[0], 10);
            if (!isNaN(parsed) && parsed > 0) {
                days = parsed;
            }
        }

        const embed = await this.buildReportEmbed(days);
        return msg.reply({ embeds: [embed] });
    },

    async executeSlash(interaction, { config }) {
        const days = interaction.options.getInteger('dias') || 7;
        await interaction.deferReply();
        const embed = await this.buildReportEmbed(days);
        return interaction.editReply({ embeds: [embed] });
    },

    async buildReportEmbed(days) {
        const sinceDate = db.dateDaysAgo(days);
        const sinceTimestamp = Date.now() - days * 24 * 60 * 60 * 1000;

        const registered = db.getAllRegisteredMembers();
        const stats = [];

        for (const r of registered) {
            const voiceMs = db.getVoiceTimeMs(r.discord_id, sinceTimestamp);
            if (voiceMs <= 0) continue; // Only list those who stayed in call

            const gameOnlineMs = db.getGameOnlineTimeMs(r.char_name, sinceDate);
            const outOfCallMs = Math.max(0, gameOnlineMs - voiceMs);

            const evasion = db.getMassivoEvasion(r.discord_id) || { logoffs: 0, ignored_ms: 0 };

            stats.push({
                charName: r.char_name,
                discordId: r.discord_id,
                voiceTime: voiceMs,
                outOfCallTime: outOfCallMs,
                ignoredMs: evasion.ignored_ms,
                logoffs: evasion.logoffs
            });
        }

        // Sort by voice time descending
        stats.sort((a, b) => b.voiceTime - a.voiceTime);

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle(`📞 Relatório de Presença e Evasão (${days} dias)`)
            .setDescription(`Lista de membros registrados que participaram de calls no canal de guerra, com tempo fora de call e registros de evasão durante Massivos (pelegos).`)
            .setFooter({ text: 'Ascended Bot • RubinOT', iconURL: 'https://rubinot.com.br/favicon.ico' })
            .setTimestamp();

        if (stats.length === 0) {
            embed.setDescription(`_Nenhum membro registrado registrou tempo em call nos últimos ${days} dias._`);
            return embed;
        }

        // We can display players in fields or in a split description.
        // Discord allows up to 1024 chars per field, and 4096 in description.
        const chunk = 10;
        for (let i = 0; i < stats.length; i += chunk) {
            const currentStats = stats.slice(i, i + chunk);
            const lines = currentStats.map((p, idx) => {
                return `**#${i + idx + 1} ${p.charName}** (<@${p.discordId}>)\n` +
                       `• 📞 **Em Call:** \`${formatDuration(p.voiceTime)}\`\n` +
                       `• 💤 **Fora de Call:** \`${formatDuration(p.outOfCallTime)}\`\n` +
                       `• 🏃 **Ignorou Pelego:** \`${formatDuration(p.ignoredMs)}\`\n` +
                       `• 🚪 **Deslogou em Pelego:** \`${p.logoffs}\` ${p.logoffs > 0 ? '🚨' : ''}`;
            });

            embed.addFields({
                name: `👥 Jogadores ${i + 1} - ${Math.min(stats.length, i + chunk)} (de ${stats.length})`,
                value: lines.join('\n\n'),
                inline: false
            });
        }

        return embed;
    }
};
