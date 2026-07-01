'use strict';

/**
 * achievements.js — Sistema de Conquistas/Badges
 * Define todas as conquistas disponíveis e verifica desbloqueios automaticamente.
 */

const db = require('./database');
const { EmbedBuilder } = require('discord.js');

// ─── Definições das Conquistas ────────────────────────────────────────────────
const ACHIEVEMENTS = {
    FIRST_BLOOD: {
        id: 'FIRST_BLOOD',
        name: '🩸 Primeiro Sangue',
        description: 'Realizou o primeiro frag da sua carreira na guilda.',
        roleName: null,
        roleColor: null
    },
    CENTURION: {
        id: 'CENTURION',
        name: '💯 Centurião',
        description: 'Acumulou 100 frags (main + bomba combinados).',
        roleName: 'Centurião ⚔️',
        roleColor: '#C0392B'
    },
    WAR_MACHINE: {
        id: 'WAR_MACHINE',
        name: '🔥 Máquina de Guerra',
        description: 'Acumulou 500 frags (main + bomba combinados).',
        roleName: 'Máquina de Guerra 🔥',
        roleColor: '#8B0000'
    },
    LEGEND: {
        id: 'LEGEND',
        name: '🌟 Lenda da Guilda',
        description: 'Acumulou 1000 frags (main + bomba combinados).',
        roleName: 'Lenda da Guilda 🌟',
        roleColor: '#FF8C00'
    },
    GUARDIAN: {
        id: 'GUARDIAN',
        name: '🛡️ Guardião',
        description: 'Passou 100 horas em call de voz da guilda.',
        roleName: 'Guardião 🛡️',
        roleColor: '#2980B9'
    },
    VETERAN: {
        id: 'VETERAN',
        name: '🏅 Veterano',
        description: 'Passou 200 horas em call de voz da guilda.',
        roleName: 'Veterano 🏅',
        roleColor: '#1A5276'
    },
    DECIMATOR: {
        id: 'DECIMATOR',
        name: '💀 Dizimador',
        description: 'Realizou 10 ou mais frags em um único dia.',
        roleName: null,
        roleColor: null
    },
    NIGHT_OWL: {
        id: 'NIGHT_OWL',
        name: '🦉 Coruja da Noite',
        description: 'Acumulou 2 horas de presença em canais de voz da guilda entre 02h e 06h da manhã.',
        roleName: 'Coruja da Noite 🦉',
        roleColor: '#34495E',
        reward: 500
    },
    RESPAWN_GUARDIAN: {
        id: 'RESPAWN_GUARDIAN',
        name: '🛡️ Guardião do Respawn',
        description: 'Manteve uma reserva ativa de respawn (claim original + extensões) por 4 horas ou mais seguidas.',
        roleName: 'Guardião do Respawn 🛡️',
        roleColor: '#27AE60',
        reward: 500
    },
    UNSTOPPABLE_EXECUTIONER: {
        id: 'UNSTOPPABLE_EXECUTIONER',
        name: '🩸 Carrasco Imparável',
        description: 'Realizou 5 ou mais frags PvP em um período de 24 horas.',
        roleName: 'Carrasco Imparável 🩸',
        roleColor: '#E74C3C',
        reward: 1000
    },
    ARENA_CHAMPION: {
        id: 'ARENA_CHAMPION',
        name: '⚔️ Gladiador da Arena',
        description: 'Venceu 10 duelos na Arena do Bastião.',
        roleName: 'Gladiador da Arena ⚔️',
        roleColor: '#D4AC0D',
        reward: 300
    },
    UNSTOPPABLE_DUELIST: {
        id: 'UNSTOPPABLE_DUELIST',
        name: '🏆 Invicto da Arena',
        description: 'Alcançou uma sequência de 5 vitórias em duelos da Arena.',
        roleName: 'Invicto da Arena 🏆',
        roleColor: '#7D6608',
        reward: 500
    },
    CITY_DEFENDER: {
        id: 'CITY_DEFENDER',
        name: '🛡️ Defensor de Aethelgard',
        description: 'Causou um total de 10.000 de dano defendendo o Bastião de Aethelgard de invasões.',
        roleName: 'Defensor de Aethelgard 🛡️',
        roleColor: '#E67E22',
        reward: 400
    },
    LOOT_HUNTER: {
        id: 'LOOT_HUNTER',
        name: '💎 Caçador de Relíquias',
        description: 'Obteve um equipamento raro como loot de um monstro invasor.',
        roleName: 'Caçador de Relíquias 💎',
        roleColor: '#2E4053',
        reward: 300
    },
};

// ─── Thresholds de frags ──────────────────────────────────────────────────────
const FRAG_THRESHOLDS = [
    { count: 1,    id: 'FIRST_BLOOD' },
    { count: 100,  id: 'CENTURION'   },
    { count: 500,  id: 'WAR_MACHINE' },
    { count: 1000, id: 'LEGEND'      },
];

// ─── Thresholds de voz (em ms) ────────────────────────────────────────────────
const VOICE_THRESHOLDS = [
    { ms: 100 * 60 * 60 * 1000,  id: 'GUARDIAN' }, // 100h
    { ms: 200 * 60 * 60 * 1000,  id: 'VETERAN'  }, // 200h
];

// ─── Helper: obter ou criar role de conquista ─────────────────────────────────
async function getOrCreateAchievementRole(guild, achievementDef) {
    if (!achievementDef.roleName) return null;
    let role = guild.roles.cache.find(r => r.name === achievementDef.roleName);
    if (!role) {
        try {
            role = await guild.roles.create({
                name: achievementDef.roleName,
                color: achievementDef.roleColor || '#AAAAAA',
                hoist: false,
                reason: `Cargo de conquista: ${achievementDef.name}`
            });
            console.log(`[Achievements] Cargo criado: ${achievementDef.roleName}`);
        } catch (err) {
            console.error(`[Achievements] Erro ao criar cargo ${achievementDef.roleName}:`, err.message);
        }
    }
    return role;
}

// ─── Notificar conquista desbloqueada ─────────────────────────────────────────
async function notifyAchievement(discordId, achievementId, guild, announcementChannelId = null) {
    const def = ACHIEVEMENTS[achievementId];
    if (!def) return;

    const memberReg = db.getRegisteredMember(discordId);
    const charName = memberReg ? memberReg.char_name : `<@${discordId}>`;

    console.log(`[Achievements] 🏆 ${charName} desbloqueou: ${def.name}`);

    // Recompensa financeira
    if (def.reward) {
        try {
            db.addCoins(discordId, def.reward);
            console.log(`[Achievements] Concedido bônus de ${def.reward} AC para o jogador pelo desbloqueio.`);
        } catch (errCoins) {
            console.error('[Achievements] Erro ao adicionar moedas de conquista:', errCoins.message);
        }
    }

    // Adicionar role se houver
    if (def.roleName && guild) {
        try {
            const role = await getOrCreateAchievementRole(guild, def);
            if (role) {
                const member = guild.members.cache.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
                if (member && !member.roles.cache.has(role.id)) {
                    await member.roles.add(role).catch(() => {});
                    console.log(`[Achievements] Role ${role.name} adicionado a ${charName}.`);
                }
            }
        } catch (err) {
            console.error(`[Achievements] Erro ao adicionar role de conquista:`, err.message);
        }
    }

    // Enviar DM para o membro
    try {
        const client = require('./state')._client;
        if (client) {
            const user = await client.users.fetch(discordId).catch(() => null);
            if (user) {
                const dmEmbed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle('🏆 Conquista Desbloqueada!')
                    .setDescription(`**${def.name}**\n${def.description}${def.reward ? `\n\n🪙 **Recompensa:** **+${def.reward} AC**` : ''}`)
                    .setFooter({ text: 'Ascended Bot • Conquistas' })
                    .setTimestamp();
                await user.send({ embeds: [dmEmbed] }).catch(() => {});
            }
        }
    } catch {}

    // Anúncio no canal
    if (announcementChannelId && guild) {
        try {
            const channel = await guild.channels.fetch(announcementChannelId).catch(() => null);
            if (channel?.isTextBased()) {
                const embed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle('🏆 Nova Conquista Desbloqueada!')
                    .setDescription(`<@${discordId}> desbloqueou a conquista **${def.name}**!\n\n_${def.description}_${def.reward ? `\n\n🪙 **Recompensa:** **+${def.reward} AC**` : ''}`)
                    .setFooter({ text: 'Ascended Bot • Conquistas' })
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
        } catch {}
    }
}

// ─── Verificar conquistas de frags ────────────────────────────────────────────
async function checkFragAchievements(discordId, guild, announcementChannelId = null) {
    if (!discordId) return;
    try {
        const totalFrags = db.getTotalFragsForPlayer(discordId);

        // Verificar frags do dia (Dizimador)
        const today = db.todayDate();
        const member = db.getRegisteredMember(discordId);
        if (member) {
            const charNames = [member.char_name];
            const bomba = member.bomba;
            const hasBomba = bomba && bomba !== '-' && bomba.toLowerCase() !== 'none' && bomba.toLowerCase() !== 'nenhum';
            if (hasBomba) charNames.push(bomba);
            const dailyFragRow = db.db.prepare(
                `SELECT COUNT(*) as count FROM frags WHERE (${charNames.map(() => 'LOWER(killer_name) = LOWER(?)').join(' OR ')}) AND date = ?`
            ).get(...charNames, today);
            const dailyFrags = dailyFragRow ? dailyFragRow.count : 0;
            if (dailyFrags >= 10 && db.unlockAchievement(discordId, 'DECIMATOR')) {
                await notifyAchievement(discordId, 'DECIMATOR', guild, announcementChannelId);
            }
        }

        // Verificar thresholds acumulados
        for (const threshold of FRAG_THRESHOLDS) {
            if (totalFrags >= threshold.count) {
                if (db.unlockAchievement(discordId, threshold.id)) {
                    await notifyAchievement(discordId, threshold.id, guild, announcementChannelId);
                }
            }
        }
    } catch (err) {
        console.error('[Achievements] Erro em checkFragAchievements:', err.message);
    }
}

// ─── Verificar conquistas de voz ──────────────────────────────────────────────
async function checkVoiceAchievements(discordId, guild, announcementChannelId = null) {
    if (!discordId) return;
    try {
        const totalVoiceMs = db.getTotalVoiceTimeMs(discordId);

        for (const threshold of VOICE_THRESHOLDS) {
            if (totalVoiceMs >= threshold.ms) {
                if (db.unlockAchievement(discordId, threshold.id)) {
                    await notifyAchievement(discordId, threshold.id, guild, announcementChannelId);
                }
            }
        }
    } catch (err) {
        console.error('[Achievements] Erro em checkVoiceAchievements:', err.message);
    }
}

// ─── Verificar conquistas de voz noturna ──────────────────────────────────────
async function checkNightVoiceAchievements(discordId, guild, announcementChannelId = null) {
    if (!discordId) return;
    try {
        const member = db.getRegisteredMember(discordId);
        if (member && (member.night_voice_mins || 0) >= 120) { // 2 horas = 120 minutos
            if (db.unlockAchievement(discordId, 'NIGHT_OWL')) {
                await notifyAchievement(discordId, 'NIGHT_OWL', guild, announcementChannelId);
            }
        }
    } catch (err) {
        console.error('[Achievements] Erro em checkNightVoiceAchievements:', err.message);
    }
}

// ─── Verificar conquista de claims seguidos ───────────────────────────────────
async function checkRespawnGuardian(discordId, guild, announcementChannelId = null) {
    if (!discordId) return;
    try {
        if (db.unlockAchievement(discordId, 'RESPAWN_GUARDIAN')) {
            await notifyAchievement(discordId, 'RESPAWN_GUARDIAN', guild, announcementChannelId);
        }
    } catch (err) {
        console.error('[Achievements] Erro em checkRespawnGuardian:', err.message);
    }
}

// ─── Verificar conquistas de frag consecutivas nas últimas 24h ────────────────
async function checkUnstoppableExecutioner(discordId, guild, announcementChannelId = null) {
    if (!discordId) return;
    try {
        const member = db.getRegisteredMember(discordId);
        if (!member) return;

        const charNames = [member.char_name];
        const bomba = member.bomba;
        const hasBomba = bomba && bomba !== '-' && bomba.toLowerCase() !== 'none' && bomba.toLowerCase() !== 'nenhum';
        if (hasBomba) charNames.push(bomba);

        const row = db.db.prepare(
            `SELECT COUNT(*) as count FROM frags WHERE (${charNames.map(() => 'LOWER(killer_name) = LOWER(?)').join(' OR ')}) AND created_at >= datetime('now', '-1 day')`
        ).get(...charNames);

        const fragsLast24h = row ? row.count : 0;
        if (fragsLast24h >= 5) {
            if (db.unlockAchievement(discordId, 'UNSTOPPABLE_EXECUTIONER')) {
                await notifyAchievement(discordId, 'UNSTOPPABLE_EXECUTIONER', guild, announcementChannelId);
            }
        }
    } catch (err) {
        console.error('[Achievements] Erro em checkUnstoppableExecutioner:', err.message);
    }
}

async function checkArenaAchievements(discordId, guild, announcementChannelId = null) {
    if (!discordId) return;
    try {
        const char = db.getRpgCharacter(discordId);
        if (!char) return;

        if (char.wins >= 10 && db.unlockAchievement(discordId, 'ARENA_CHAMPION')) {
            await notifyAchievement(discordId, 'ARENA_CHAMPION', guild, announcementChannelId);
        }
        if (char.streak >= 5 && db.unlockAchievement(discordId, 'UNSTOPPABLE_DUELIST')) {
            await notifyAchievement(discordId, 'UNSTOPPABLE_DUELIST', guild, announcementChannelId);
        }
    } catch (err) {
        console.error('[Achievements] Erro em checkArenaAchievements:', err.message);
    }
}

async function checkCityDefender(discordId, damageDealt, guild, announcementChannelId = null) {
    if (!discordId) return;
    try {
        db.db.prepare('UPDATE rpg_characters SET city_damage = city_damage + ? WHERE discord_id = ?').run(damageDealt, discordId);
        
        const char = db.getRpgCharacter(discordId);
        if (char && char.city_damage >= 10000 && db.unlockAchievement(discordId, 'CITY_DEFENDER')) {
            await notifyAchievement(discordId, 'CITY_DEFENDER', guild, announcementChannelId);
        }
    } catch (err) {
        console.error('[Achievements] Erro em checkCityDefender:', err.message);
    }
}

async function checkLootHunter(discordId, guild, announcementChannelId = null) {
    if (!discordId) return;
    try {
        if (db.unlockAchievement(discordId, 'LOOT_HUNTER')) {
            await notifyAchievement(discordId, 'LOOT_HUNTER', guild, announcementChannelId);
        }
    } catch (err) {
        console.error('[Achievements] Erro em checkLootHunter:', err.message);
    }
}

module.exports = {
    ACHIEVEMENTS,
    checkFragAchievements,
    checkVoiceAchievements,
    checkNightVoiceAchievements,
    checkRespawnGuardian,
    checkUnstoppableExecutioner,
    notifyAchievement,
    checkArenaAchievements,
    checkCityDefender,
    checkLootHunter,
};
