'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildPlayerEmbed, buildErrorEmbed } = require('../modules/embeds');
const { scrapePlayer, fetchRubinotEveCharacter, scrapeRubinotCharacterPage } = require('../scraper/scraper');
const db = require('../modules/database');

const VOCATION_MAP = {
    1: 'Knight',
    2: 'Paladin',
    3: 'Sorcerer',
    4: 'Druid',
    5: 'Elite Knight',
    6: 'Royal Paladin',
    7: 'Master Sorcerer',
    8: 'Elder Druid',
};

const MAX_EMBED_FIELDS = 25;
const MAX_FIELD_VALUE  = 1024;

function clampFieldValue(value) {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    if (!str) return null;
    if (str.length <= MAX_FIELD_VALUE) return str;
    return `${str.slice(0, MAX_FIELD_VALUE - 3)}...`;
}

function safeAddField(embed, { name, value, inline = true }) {
    if ((embed.data.fields?.length ?? 0) >= MAX_EMBED_FIELDS) return false;
    const clamped = clampFieldValue(value);
    if (!clamped) return false;
    embed.addFields({ name, value: clamped, inline });
    return true;
}

function parseNameAndWorld(raw, defaultWorld) {
    const split = raw.split('|').map(part => part.trim()).filter(Boolean);
    if (split.length === 0) {
        return { name: '', world: defaultWorld || '' };
    }

    if (split.length === 1) {
        return { name: split[0], world: defaultWorld || '' };
    }

    return {
        name: split[0],
        world: split.slice(1).join(' | ') || defaultWorld || '',
    };
}

function formatMinutes(minutes) {
    if (typeof minutes !== 'number' || Number.isNaN(minutes)) return '0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h${mins > 0 ? ` ${mins}m` : ''}`;
}

function vocationFromId(id) {
    if (!id) return 'Desconhecida';
    return VOCATION_MAP[id] || `ID ${id}`;
}

function formatDate(value) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date)) return 'N/A';
    return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatDateOnly(value) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date)) return 'N/A';
    return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatVipExpiry(value) {
    if (!value) return 'N/A';
    const timestamp = Number(value) > 1e12 ? Number(value) : Number(value) * 1000;
    const date = new Date(timestamp);
    if (Number.isNaN(date)) return 'N/A';
    return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatCharacterProg(pageCharacter = {}) {
    const lines = [];
    if (pageCharacter.rubinotComplete) {
        const points = pageCharacter.rubinotPoints ? ` (${pageCharacter.rubinotPoints})` : '';
        lines.push(`Rubinot Complete: ${pageCharacter.rubinotComplete}${points}`);
    }
    const progression = pageCharacter.progression || {};
    for (const key of ['Bosstiary', 'Bestiary', 'Achievements (x10)', 'Linked Tasks (x100)']) {
        if (progression[key]) lines.push(`${key}: ${progression[key]}`);
    }
    return lines.length ? lines.join('\n') : null;
}

function formatPageSkills(skills = []) {
    if (!Array.isArray(skills) || !skills.length) return null;
    return skills.map(skill => {
        const ranks = [];
        if (skill.worldRank) ranks.push(`W:${skill.worldRank}`);
        if (skill.globalRank) ranks.push(`G:${skill.globalRank}`);
        const rankInfo = ranks.length ? ` (${ranks.join(' | ')})` : '';
        const change = skill.change ? ` · ${skill.change}` : '';
        return `**${skill.name || 'Skill'}** ${skill.value || ''}${rankInfo}${change}`.trim();
    }).slice(0, 6).join('\n');
}

function formatPageHistory(history = {}) {
    if (!history || !Array.isArray(history.rows) || !history.rows.length) return null;
    return history.rows.slice(0, 3).map(r => {
        return `${r.when ? `${r.when} ` : ''}${r.title || ''}${r.description ? ` · ${r.description}` : ''}`.trim();
    }).join('\n');
}

function formatPageActivity(activity = {}) {
    const pieces = [];
    if (activity.online) pieces.push(`Online: ${activity.online}`);
    if (activity.hunting) pieces.push(`Hunting: ${activity.hunting}`);
    if (activity.avgXpHour) pieces.push(`Avg XP/h: ${activity.avgXpHour}`);
    if (activity.avgRawXpHour) pieces.push(`Avg Raw XP/h: ${activity.avgRawXpHour}`);
    return pieces.length ? pieces.join(' · ') : null;
}

function getRecentOnlineDays(daily) {
    if (!Array.isArray(daily) || !daily.length) return null;
    return daily.slice(-3).map(entry => {
        const parts = entry.date.split('-');
        const day = parts.length === 3 ? `${parts[2]}/${parts[1]}` : entry.date;
        return `${day}: ${formatMinutes(entry.onlineMinutes)}`;
    }).join(' · ');
}

function buildCharacterEmbed(name, world, playerData, apiData, pageData) {
    const apiProfile = apiData?.profile?.profile || {};
    const lastLogin = apiProfile.lastLogin ? Date.parse(apiProfile.lastLogin) : null;
    const apiStatus = lastLogin && (Date.now() - lastLogin <= 30 * 60 * 1000) ? 'Online' : 'Offline';
    const status = playerData?.status || apiStatus || 'Offline';
    const lastSeen = status === 'Online' ? null : (lastLogin || db.getLastSeen(name));
    const vocation = playerData?.vocation || pageData?.character?.vocation || vocationFromId(apiProfile.vocationId);
    const currentWorld = playerData?.world || pageData?.character?.world || world || (apiProfile.worldName || apiProfile.world || 'N/A');
    const level = playerData?.level || apiProfile.level || pageData?.character?.level || 'Desconhecido';
    const guild = playerData?.guild || apiProfile.guildName || pageData?.character?.guild || 'Nenhuma';

    const outfitUrl = apiData?.outfitUrl;
    const embed = buildPlayerEmbed({
        name:     playerData?.name || name,
        level:    level,
        vocation: vocation,
        guild:    guild,
        world:    currentWorld,
        status:   status,
        lastSeen: lastSeen,
    })
        .setURL(`https://rubinot-eve.otservices.space/characters/${encodeURIComponent(name)}`)
        .setThumbnail(outfitUrl || undefined);

    if (apiProfile.characterId) {
        safeAddField(embed, { name: '🆔 ID', value: `\`${apiProfile.characterId}\``, inline: true });
    }

    if (apiProfile.title) {
        safeAddField(embed, { name: '🏅 Título', value: `\`${apiProfile.title}\``, inline: true });
    }

    if (apiProfile.guildRank) {
        safeAddField(embed, { name: '🏰 Posição', value: `\`${apiProfile.guildRank}\``, inline: true });
    }

    if (apiProfile.sex) {
        safeAddField(embed, { name: '⚧ Sexo', value: `\`${apiProfile.sex}\``, inline: true });
    }

    if (apiProfile.residence) {
        safeAddField(embed, { name: '🏠 Residência', value: `\`${apiProfile.residence}\``, inline: true });
    }

    if (apiProfile.houseName) {
        safeAddField(embed, { name: '🏡 Casa', value: `\`${apiProfile.houseName}\``, inline: true });
    }

    if (apiProfile.comment) {
        safeAddField(embed, { name: '📝 Comentário', value: `\`${apiProfile.comment}\``, inline: false });
    }

    if (apiProfile.marriedTo) {
        safeAddField(embed, { name: '💍 Casado com', value: `\`${apiProfile.marriedTo}\``, inline: true });
    }

    if (apiProfile.loyaltyPoints !== undefined) {
        safeAddField(embed, { name: '💎 Lealdade', value: `\`${apiProfile.loyaltyPoints}\``, inline: true });
    }

    if (apiProfile.accountStatus) {
        safeAddField(embed, { name: '🧭 Status da conta', value: `\`${apiProfile.accountStatus}\``, inline: true });
    }

    if (apiProfile.deletionDate) {
        safeAddField(embed, { name: '🗓️ Exclusão', value: `\`${formatDate(apiProfile.deletionDate)}\``, inline: true });
    }

    if (apiProfile.vipTime) {
        safeAddField(embed, { name: '✨ VIP até', value: `\`${formatVipExpiry(apiProfile.vipTime)}\``, inline: true });
    }

    if (apiProfile.characterCreatedAt) {
        safeAddField(embed, { name: '📅 Criado em', value: `\`${formatDateOnly(apiProfile.characterCreatedAt)}\``, inline: true });
    }

    if (apiProfile.accountCreatedAt) {
        safeAddField(embed, { name: '🔐 Conta criada', value: `\`${formatDateOnly(apiProfile.accountCreatedAt)}\``, inline: true });
    }

    if (apiProfile.isHidden) {
        safeAddField(embed, { name: '🕵️ Invisível', value: '`Sim`', inline: true });
    }

    if (apiProfile.isBanned) {
        safeAddField(embed, { name: '⛔ Banido', value: '`Sim`', inline: true });
        if (apiProfile.banReason) {
            safeAddField(embed, { name: '📝 Motivo do ban', value: `\`${apiProfile.banReason}\``, inline: false });
        }
    }

    if (lastLogin) {
        safeAddField(embed, { name: '🕒 Último login', value: `\`${formatDate(apiProfile.lastLogin)}\``, inline: true });
    }

    if (apiData?.timeOnline?.summary) {
        const summary = apiData.timeOnline.summary;
        const recent = getRecentOnlineDays(apiData.timeOnline.daily);
        const average = Math.round(summary.currentWeekMinutes / 7);
        safeAddField(embed, { name: '⏱️ Online (7d)', value: `\`${formatMinutes(summary.currentWeekMinutes)}\``, inline: true });
        safeAddField(embed, { name: '📈 Média diária', value: `\`${formatMinutes(average)}\``, inline: true });
        if (recent) {
            safeAddField(embed, { name: '📅 Últimos 3 dias', value: recent, inline: false });
        }
    }

    if (apiData?.huntingHeatmap?.heatmap) {
        const huntingEntries = apiData.huntingHeatmap.heatmap;
        const huntingHours = huntingEntries.filter(h => h.isHunting).length;
        const huntingDays = new Set(huntingEntries.map(h => h.day)).size;
        safeAddField(embed, { name: '🔥 Hunting (7d)', value: `\`${huntingHours}h em ${huntingDays} dias\``, inline: true });
    }

    if (pageData?.timeOnline) {
        const activitySummary = formatPageActivity(pageData.timeOnline);
        if (activitySummary) {
            safeAddField(embed, { name: '⏱️ Atividade', value: `\`${activitySummary}\``, inline: true });
        }
    }

    if (pageData?.experience?.totalExperience) {
        safeAddField(embed, { name: '📈 Experiência', value: `\`${pageData.experience.totalExperience}\``, inline: true });
    }

    if (pageData?.character?.partyExpSharingRange) {
        safeAddField(embed, { name: '📌 Party range', value: `\`${pageData.character.partyExpSharingRange}\``, inline: true });
    }

    if (pageData?.skills?.skills) {
        const skillsText = formatPageSkills(pageData.skills.skills);
        if (skillsText) {
            safeAddField(embed, { name: '🧠 Skills', value: skillsText, inline: false });
        }
    }

    if (pageData?.history) {
        const historyText = formatPageHistory(pageData.history);
        if (historyText) {
            safeAddField(embed, { name: '👗 Outfit / Histórico', value: historyText, inline: false });
        }
    }

    if (pageData?.character) {
        const charProg = formatCharacterProg(pageData.character);
        if (charProg) {
            safeAddField(embed, { name: '🎯 Rubinot Progress', value: charProg, inline: false });
        }
    }

    if (apiProfile.achievementPoints !== undefined) {
        safeAddField(embed, { name: '⭐ Pontos de conquista', value: `\`${apiProfile.achievementPoints}\``, inline: true });
    }

    return embed;
}

async function lookupCharacterInfo(name, world, config) {
    const lookupName = name.trim();
    const lookupWorld = world.trim() || config.worldName || '';

    let playerData = null;
    let apiData = null;
    let pageData = null;

    const tasks = [
        scrapePlayer(lookupName),
        fetchRubinotEveCharacter(lookupName, lookupWorld),
        scrapeRubinotCharacterPage(lookupName),
    ];

    const [scrapeResult, apiResult, pageResult] = await Promise.allSettled(tasks);

    if (scrapeResult.status === 'fulfilled') playerData = scrapeResult.value;
    if (apiResult.status === 'fulfilled') apiData = apiResult.value;
    if (pageResult.status === 'fulfilled') pageData = pageResult.value;

    if (!playerData && !apiData) {
        throw new Error('not_found');
    }

    return buildCharacterEmbed(lookupName, lookupWorld, playerData, apiData, pageData);
}

module.exports = {
    name: 'info',
    aliases: ['track', 'char', 'personagem', 'player', 'jogador'],
    adminOnly: false,
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Busca informações do personagem usando a API RubinOT Eve')
        .addStringOption(option => option.setName('nome').setDescription('Nome do personagem').setRequired(true))
        .addStringOption(option => option.setName('mundo').setDescription('Mundo do personagem (opcional)')),

    async execute(msg, args, { config }) {
        const raw = args.join(' ').trim();
        if (!raw) {
            return msg.reply({ embeds: [buildErrorEmbed('Uso: `!info <nome do personagem> [| mundo]`')] });
        }

        const { name, world } = parseNameAndWorld(raw, config.worldName || '');
        if (!name) {
            return msg.reply({ embeds: [buildErrorEmbed('Uso: `!info <nome do personagem> [| mundo]`')] });
        }

        const loading = await msg.reply('⏳ Buscando informações do personagem...');
        try {
            const embed = await lookupCharacterInfo(name, world, config);
            await loading.delete().catch(() => {});

            if (embed.data.fields.some(field => field.name === '🟢 Status' && field.value.includes('Online'))) {
                db.updateLastSeen(name, Date.now());
            }

            return msg.reply({ embeds: [embed] });
        } catch (err) {
            await loading.delete().catch(() => {});
            if (err.message === 'not_found') {
                return msg.reply({ embeds: [buildErrorEmbed(`Personagem **${name}** não encontrado.`)] });
            }
            console.error('[Cmd:info]', err.stack || err.message);
            return msg.reply({ embeds: [buildErrorEmbed('Erro ao buscar personagem. Tente novamente.')] });
        }
    },

    async executeSlash(interaction, { config }) {
        const name = interaction.options.getString('nome', true).trim();
        const world = interaction.options.getString('mundo')?.trim() || config.worldName || '';

        await interaction.deferReply();
        try {
            const embed = await lookupCharacterInfo(name, world, config);
            if (embed.data.fields.some(field => field.name === '🟢 Status' && field.value.includes('Online'))) {
                db.updateLastSeen(name, Date.now());
            }
            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('[Slash:info]', err.stack || err.message);
            if (err.message === 'not_found') {
                return interaction.editReply({ embeds: [buildErrorEmbed(`Personagem **${name}** não encontrado.`)] });
            }
            return interaction.editReply({ embeds: [buildErrorEmbed('Erro ao buscar personagem. Tente novamente.')] });
        }
    },
};
