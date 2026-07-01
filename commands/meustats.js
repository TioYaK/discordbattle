'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const embeds = require('../modules/embeds');

function formatDuration(ms) {
    if (!ms || ms === 0) return '0h 0m';
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
}

function calculateXpHour(gainXp, onlineMs) {
    if (!onlineMs || onlineMs === 0) return 0;
    const hours = onlineMs / 3600000;
    return Math.round(gainXp / hours);
}

function formatCharStats(name, stats, isBomba = false) {
    const xpGained = embeds.formatXp(stats.gain_xp || 0);
    const xpLost = embeds.formatXp(stats.lost_xp || 0);
    const xpNet = (stats.daily_xp || 0) >= 0 
        ? `+${embeds.formatXp(stats.daily_xp || 0)}` 
        : `-${embeds.formatXp(Math.abs(stats.daily_xp || 0))}`;
    const lvlGained = stats.levels_gained || 0;
    const onlineStr = formatDuration(stats.online_ms || 0);
    const xpHour = embeds.formatXp(calculateXpHour(stats.gain_xp || 0, stats.online_ms || 0));

    const emoji = isBomba ? '💣' : '⚔️';
    
    return `**${emoji} ${name}**\n` +
           `• ✨ **XP Ganhada:** \`${xpGained}\`\n` +
           `• 💀 **XP Perdida:** \`${xpLost}\`\n` +
           `• 📈 **XP Líquida:** \`${xpNet}\`\n` +
           `• ⭐ **Níveis Ganhos:** \`+${lvlGained}\`\n` +
           `• ⏱️ **Tempo Online:** \`${onlineStr}\`\n` +
           `• ⚡ **Média de XP/h:** \`${xpHour}/h\`\n`;
}

async function handleMeuStats(user, guild, client, config) {
    const memberRow = db.getRegisteredMember(user.id);
    if (!memberRow) {
        throw new Error(
            `Você não está registrado no banco de dados. Use o canal de registros primeiro.`
        );
    }

    const today = db.todayDate();
    const mainName = memberRow.char_name;
    const bombaName = memberRow.bomba;
    const hasBomba = bombaName && bombaName !== '-' && bombaName.toLowerCase() !== 'none' && bombaName.toLowerCase() !== 'nenhum';

    // Busca estatísticas de hoje para o personagem principal e bomba (se houver)
    const statsRows = db.db.prepare(`
        SELECT * FROM daily_stats 
        WHERE date = ? AND (LOWER(name) = LOWER(?) OR LOWER(name) = LOWER(?))
    `).all(today, mainName, hasBomba ? bombaName : '');

    const mainStats = statsRows.find(r => r.name.toLowerCase() === mainName.toLowerCase()) || { daily_xp: 0, gain_xp: 0, lost_xp: 0, online_ms: 0, levels_gained: 0 };
    const bombaStats = hasBomba ? (statsRows.find(r => r.name.toLowerCase() === bombaName.toLowerCase()) || { daily_xp: 0, gain_xp: 0, lost_xp: 0, online_ms: 0, levels_gained: 0 }) : null;

    const hasAnyActivity = (mainStats.gain_xp > 0 || mainStats.lost_xp > 0 || mainStats.online_ms > 0) ||
                           (bombaStats && (bombaStats.gain_xp > 0 || bombaStats.lost_xp > 0 || bombaStats.online_ms > 0));

    // Monta a descrição com os dados
    let description = `Visualizando dados diários de atividade no RubinOT.\n\n` +
                      `📅 **Data:** \`${today}\`\n\n`;

    description += formatCharStats(mainName, mainStats, false);

    if (hasBomba && bombaStats) {
        description += `\n` + formatCharStats(bombaName, bombaStats, true);

        // Se tiver bomba, cria uma seção consolidada com os totais somados
        const totalXpGained = (mainStats.gain_xp || 0) + (bombaStats.gain_xp || 0);
        const totalXpLost = (mainStats.lost_xp || 0) + (bombaStats.lost_xp || 0);
        const totalXpNet = (mainStats.daily_xp || 0) + (bombaStats.daily_xp || 0);
        const totalLvlGained = (mainStats.levels_gained || 0) + (bombaStats.levels_gained || 0);
        const totalOnlineMs = (mainStats.online_ms || 0) + (bombaStats.online_ms || 0);
        const totalXpHour = calculateXpHour(totalXpGained, totalOnlineMs);

        const totalNetStr = totalXpNet >= 0 
            ? `+${embeds.formatXp(totalXpNet)}` 
            : `-${embeds.formatXp(Math.abs(totalXpNet))}`;

        description += `\n**📊 TOTAL CONSOLIDADO**\n` +
                       `• ✨ **XP Ganhada:** \`${embeds.formatXp(totalXpGained)}\`\n` +
                       `• 💀 **XP Perdida:** \`${embeds.formatXp(totalXpLost)}\`\n` +
                       `• 📈 **XP Líquida:** \`${totalNetStr}\`\n` +
                       `• ⭐ **Níveis Ganhos:** \`+${totalLvlGained}\`\n` +
                       `• ⏱️ **Tempo Online:** \`${formatDuration(totalOnlineMs)}\`\n` +
                       `• ⚡ **Média de XP/h:** \`${embeds.formatXp(totalXpHour)}/h\`\n`;
    }

    if (!hasAnyActivity) {
        description += `\n⚠️ _Nenhuma atividade de caça ou tempo online detectado hoje até o momento._`;
    }

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`📊 Estatísticas de Caça · ${user.username}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }) || null)
        .setDescription(description)
        .setFooter({ text: 'Ascended Bot • RubinOT' })
        .setTimestamp();

    return embed;
}

module.exports = {
    name: 'meustats',
    aliases: ['stats', 'huntingstats', 'caça', 'caca', 'minhasstats'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('meustats')
        .setDescription('Mostra suas estatísticas diárias de caça (XP, levels, tempo online e XP/h)')
        .addUserOption(option =>
            option.setName('membro')
                .setDescription('Membro para visualizar estatísticas (opcional)')
                .setRequired(false)
        ),

    async execute(msg, args, { client, config }) {
        let targetUser = msg.author;
        if (args.length > 0) {
            const mentionOrId = args[0];
            const idMatch = mentionOrId.match(/^<@!?(\d+)>$/) || mentionOrId.match(/^(\d+)$/);
            if (idMatch) {
                const fetchedUser = await client.users.fetch(idMatch[1]).catch(() => null);
                if (fetchedUser) {
                    targetUser = fetchedUser;
                } else {
                    return msg.reply('❌ Membro não encontrado.');
                }
            }
        }

        try {
            const embed = await handleMeuStats(targetUser, msg.guild, client, config);
            return msg.reply({ embeds: [embed] });
        } catch (err) {
            console.error('[MeuStats] Erro ao buscar stats:', err.message);
            return msg.reply(`❌ ${err.message}`);
        }
    },

    async executeSlash(interaction, { client, config }) {
        const optUser = interaction.options.getUser('membro');
        const targetUser = optUser || interaction.user;

        await interaction.deferReply();

        try {
            const embed = await handleMeuStats(targetUser, interaction.guild, client, config);
            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('[MeuStats] Erro no slash stats:', err.message);
            return interaction.editReply({ content: `❌ ${err.message}` });
        }
    }
};
