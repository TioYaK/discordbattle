'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');

function formatRemainingTime(ms) {
    if (ms <= 0) return 'Pronto!';
    const totalSecs = Math.floor(ms / 1000);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

module.exports = {
    name: 'bosses',
    aliases: ['meusbosses', 'timers'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('bosses')
        .setDescription('Mostra todos os seus cooldowns de boss ativos'),

    async execute(msg) {
        const cooldowns = db.getActiveBossCooldowns(msg.author.id);

        if (!cooldowns.length) {
            return msg.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x4488FF)
                        .setTitle('🔮 Seus Cooldowns de Boss')
                        .setDescription('✅ Você **não tem nenhum** cooldown de boss ativo no momento! Todos estão livres para matar.')
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                        .setTimestamp()
                ]
            });
        }

        const lines = cooldowns.map(c => {
            const timeLeft = c.expires_at - Date.now();
            const timeStr = formatRemainingTime(timeLeft);
            const timeFormatted = new Date(c.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            return `⏳ **${c.boss_name}** — resta **${timeStr}** (livre às \`${timeFormatted}\`)`;
        });

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🔮 Seus Cooldowns de Boss')
            .setDescription('Veja abaixo os cronômetros ativos para os seus bosses:\n\n' + lines.join('\n'))
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        return msg.channel.send({ embeds: [embed] });
    },

    async executeSlash(interaction) {
        const cooldowns = db.getActiveBossCooldowns(interaction.user.id);

        if (!cooldowns.length) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x4488FF)
                        .setTitle('🔮 Seus Cooldowns de Boss')
                        .setDescription('✅ Você **não tem nenhum** cooldown de boss ativo no momento! Todos estão livres para matar.')
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                        .setTimestamp()
                ],
                ephemeral: true
            });
        }

        const lines = cooldowns.map(c => {
            const timeLeft = c.expires_at - Date.now();
            const timeStr = formatRemainingTime(timeLeft);
            const timeFormatted = new Date(c.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            return `⏳ **${c.boss_name}** — resta **${timeStr}** (livre às \`${timeFormatted}\`)`;
        });

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🔮 Seus Cooldowns de Boss')
            .setDescription('Veja abaixo os cronômetros ativos para os seus bosses:\n\n' + lines.join('\n'))
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
