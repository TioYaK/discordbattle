'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const state = require('../modules/state');

module.exports = {
    name: 'atacar',
    aliases: ['attack'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('atacar')
        .setDescription('Desfere um ataque contra o Boss da guilda invasor'),

    async execute(msg, args, { client }) {
        // Delete trigger message immediately to keep general chat clean
        msg.delete().catch(() => {});

        const userId = msg.author.id;
        const channel = msg.channel;
        const guild = msg.guild;

        const result = await processAttack(userId, channel, guild, client);
        if (result && result.temporaryMessage) {
            const tempMsg = await channel.send({ content: result.temporaryMessage }).catch(() => {});
            setTimeout(() => tempMsg.delete().catch(() => {}), 3000);
        }
    },

    async executeSlash(interaction, { client }) {
        await interaction.deferReply();
        const userId = interaction.user.id;
        const channel = interaction.channel;
        const guild = interaction.guild;

        const result = await processAttack(userId, channel, guild, client);
        if (!result) return;

        if (result.error) {
            return interaction.editReply({ content: result.error, ephemeral: true }).catch(() => {});
        }

        // Send attack log as response, then delete it after 3 seconds
        await interaction.editReply({ content: result.temporaryMessage, fetchReply: true }).catch(() => {});
        setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }
};

async function processAttack(userId, channel, guild, client) {
    // 1. Check if registered
    const reg = db.getRegisteredMember(userId);
    if (!reg) {
        return {
            error: '🚫 Você precisa estar registrado para participar da invasão! Use `/registro` para se registrar.',
            temporaryMessage: `🚫 <@${userId}>, você precisa se registrar usando \`/registro\` para participar da invasão!`
        };
    }

    const charName = reg.char_name;

    // 2. Check if active boss exists
    if (!state.activeBoss) {
        // If a city invasion is active, attack the city monster instead
        if (state.activeInvasion) {
            const cityInvasions = require('../modules/cityInvasions');
            return await cityInvasions.handleInvasionAttack(userId, channel, guild, client);
        }

        return {
            error: '❌ Não há nenhuma invasão activa no momento.',
            temporaryMessage: `❌ <@${userId}>, não há nenhuma invasão activa no momento.`
        };
    }

    const boss = state.activeBoss;

    // 3. Verify individual cooldown (10 seconds)
    const now = Date.now();
    const lastAttack = boss.players[userId]?.lastAttack || 0;
    const timeDiff = now - lastAttack;
    if (timeDiff < 10000) {
        const remaining = Math.ceil((10000 - timeDiff) / 1000);
        return {
            error: `⏳ Aguarde **${remaining}s** para atacar novamente!`,
            temporaryMessage: `⏳ <@${userId}>, aguarde **${remaining}s** para atacar novamente!`
        };
    }

    // 4. Calculate damage and select flavor text based on class
    const cityInvasions = require('../modules/cityInvasions');
    const rpgChar = db.getRpgCharacter(userId);
    let damage = 0;
    
    if (rpgChar) {
        // Usa a fórmula do RPG se o jogador tiver personagem
        const totalAtk = cityInvasions.getPlayerTotalAtk(rpgChar);
        const rand = 0.85 + Math.random() * 0.3; // 85% to 115%
        damage = Math.max(5, Math.floor(totalAtk * rand));
    } else {
        // Fallback pra quem não tem RPG char (dano bem baixo)
        damage = Math.floor(Math.random() * 11) + 5; // 5-15
    }

    const classCode = (reg.class_code || 'EK').toUpperCase();
    const growth = cityInvasions.CLASS_GROWTH[classCode] || cityInvasions.CLASS_GROWTH.EK;

    // Check Auto-Special
    const SPECIAL_COOLDOWN_MS = 2 * 60 * 60 * 1000;
    const lastSpecial = db.getConfig(`lastSpecial_${userId}`) || 0;
    let usedSpecial = false;
    let attackText = '';
    let bossAbilityText = '';

    if (now - lastSpecial >= SPECIAL_COOLDOWN_MS) {
        // Usa a habilidade especial!
        usedSpecial = true;
        db.setConfig(`lastSpecial_${userId}`, now);
        const totalAtk = cityInvasions.getPlayerTotalAtk(rpgChar || { class_code: 'EK' }); // fallback safe
        
        if (classCode === 'EK') {
            damage = Math.floor(totalAtk * (2.5 + Math.random()));
            attackText = `🛡️ **FORTRESS STRIKE:** **${charName}** usou sua habilidade suprema, causando **${damage}** de dano massivo no boss!`;
        } else if (classCode === 'RP') {
            damage = Math.floor(totalAtk * (1.2 + Math.random() * 0.5));
            boss.noDodgeCount = (boss.noDodgeCount || 0) + 3;
            attackText = `🏹 **DIVINE SHIELD:** **${charName}** cegou o boss com luz suprema, causando **${damage}** de dano! Ele não esquivará dos próximos 3 ataques!`;
        } else if (classCode === 'ED') {
            damage = Math.floor(totalAtk * (1.2 + Math.random() * 0.5));
            boss.vulnCount = (boss.vulnCount || 0) + 5;
            if (boss.escapeTimeout) {
                clearTimeout(boss.escapeTimeout);
                boss.escapeTimeout = setTimeout(() => {
                    const sched = require('../modules/scheduler');
                    if(sched.handleBossEscape) sched.handleBossEscape();
                }, 5 * 60 * 1000);
            }
            attackText = `❄️ **BLIZZARD:** **${charName}** usou nevasca suprema, causando **${damage}** de dano! O boss está Vulnerável (+15% de dano) por 5 turnos e lento!`;
        } else if (classCode === 'MS') {
            if (Math.random() < 0.50) {
                damage = Math.floor(totalAtk * 4);
                attackText = `🔥 **METEOR STRIKE:** O céu se abriu e **${charName}** invocou um METEORO GIGANTE causando avassaladores **${damage}** de dano!`;
            } else {
                damage = 0;
                attackText = `🔥 **METEOR STRIKE:** **${charName}** tentou invocar um meteoro supremo, mas ele caiu fora da rota e errou o boss...`;
            }
        }
    } else {
        // Normal Attack Logic
        // Phase 2: Combos
        if (boss.lastAttackerUserId === userId) {
            boss.comboCount = (boss.comboCount || 1) + 1;
        } else {
            boss.lastAttackerUserId = userId;
            boss.comboCount = 1;
        }

        let isCombo = false;
        if (boss.comboCount >= 3) {
            damage = Math.floor(damage * 1.25); // +25% damage on combo
            boss.comboCount = 0; // reset combo
            isCombo = true;
        }

        // Phase 3: Vulnerability (ED Blizzard)
        let isVuln = false;
        if (boss.vulnCount && boss.vulnCount > 0) {
            damage = Math.floor(damage * 1.15); // +15% damage
            boss.vulnCount -= 1;
            isVuln = true;
        }

        // Phase 2: Crítico (EK 8%, RP 10%, ED 12%, MS 15%)
        let critChance = 0.08;
        if (classCode === 'RP') critChance = 0.10;
        if (classCode === 'ED') critChance = 0.12;
        if (classCode === 'MS') critChance = 0.15;

        let isCrit = false;
        if (Math.random() < critChance) {
            damage = damage * 2;
            isCrit = true;
        }

        // Phase 2: Esquiva do Monstro (10%)
        let isDodge = false;
        // Phase 3: No Dodge (RP Divine Shield)
        if (boss.noDodgeCount && boss.noDodgeCount > 0) {
            boss.noDodgeCount -= 1; // Monstro não pode esquivar
        } else {
            if (Math.random() < 0.10) {
                damage = 0;
                isDodge = true;
            }
        }

        // Phase 3: Boss Abilities (Counter-attacks)
        const percentageBefore = boss.hp / boss.maxHp;
        if (!isDodge && percentageBefore <= 0.3) {
            // Enraged Bosses tem 30% de chance de usar uma habilidade ao serem atacados
            if (Math.random() < 0.30) {
                if (boss.name.includes('Morgaroth') || boss.name.includes('Demon')) {
                    // Heal: cura 5% do HP máximo
                    const healAmt = Math.floor(boss.maxHp * 0.05);
                    boss.hp = Math.min(boss.maxHp, boss.hp + healAmt);
                    bossAbilityText = `\n🩸 **SUGADOR DE ALMAS:** O boss drenou sua força vital e se curou em **${healAmt} HP**!`;
                } else if (boss.name.includes('Ghazbaran') || boss.name.includes('Orshabaal')) {
                    // Baforada / Freeze: anula o dano atual e aplica penalidade de cooldown (simulado aumentando lastAttack)
                    damage = 0;
                    boss.players[userId] = boss.players[userId] || { name: charName, damage: 0 };
                    boss.players[userId].lastAttack = now + 5000; // +5s penalty
                    bossAbilityText = `\n🌪️ **FÚRIA ELEMENTAL:** O boss rugiu brutalmente, anulando seu ataque e deixando você atordoado (+5s cooldown)!`;
                }
            }
        }

        const spell = growth.spells[Math.floor(Math.random() * growth.spells.length)];

        if (isDodge) {
            attackText = `🛡️ **Esquiva!** O boss desviou do seu ataque normal, **${charName}**!`;
        } else {
            const critText = isCrit ? '💥 **CRÍTICO!** ' : '';
            const comboText = isCombo ? ' 🔥 **COMBO bônus!**' : '';
            const vulnText = isVuln ? ' 🧊 *(Vulnerável)*' : '';
            attackText = `${critText}${growth.emoji} **${charName}** usou **${spell}** e causou **${damage}** de dano no boss!${comboText}${vulnText}${bossAbilityText}`;
        }
    }

    // 5. Update boss state
    if (damage > 0) {
        db.addCityDamage(userId, damage);
    }
    boss.hp = Math.max(0, boss.hp - damage);
    if (!boss.players[userId]) {
        boss.players[userId] = { name: charName, damage: 0 };
    }
    boss.players[userId].damage += damage;
    boss.players[userId].lastAttack = now;

    // 6. Fetch boss message and edit it
    try {
        const bossChannel = await client.channels.fetch(boss.channelId).catch(() => null);
        if (bossChannel) {
            const bossMessage = await bossChannel.messages.fetch(boss.messageId).catch(() => null);
            if (bossMessage) {
                if (boss.hp === 0) {
                    boss.finalBlowUserId = userId;
                    boss.finalBlowNickname = charName;
                    await handleBossDeath(boss, bossMessage, guild);
                } else {
                    // Update HP Bar and Leaderboard
                    const percentage = boss.hp / boss.maxHp;
                    const filledBlocks = Math.round(percentage * 10);
                    // Phase 2: Enrage
                    let enrageText = '';
                    let color = 0x2ECC71; // Default
                    if (percentage <= 0.3) {
                        enrageText = ' 😡 **ENRAIVECIDO**';
                        color = 0xE74C3C; // Red
                    }

                    const emptyBlocks = 10 - filledBlocks;
                    const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
                    const barStr = `\`[${bar}]\` (${Math.round(percentage * 100)}%)${enrageText}\n${boss.hp.toLocaleString()} / ${boss.maxHp.toLocaleString()} HP`;

                    const sorted = Object.entries(boss.players)
                        .map(([id, p]) => ({ id, ...p }))
                        .sort((a, b) => b.damage - a.damage);

                    const top5 = sorted.slice(0, 5);
                    const leaderboardText = top5.map((p, idx) => {
                        const emoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '⚔️';
                        return `${emoji} **${p.name}**: ${p.damage.toLocaleString()} dmg`;
                    }).join('\n');

                    const updatedEmbed = EmbedBuilder.from(bossMessage.embeds[0])
                        .setColor(color)
                        .setFields([
                            { name: '❤️ Vida', value: barStr, inline: false },
                            { name: '🥇 Top 5 Dano', value: leaderboardText, inline: false }
                        ]);

                    await bossMessage.edit({ embeds: [updatedEmbed] }).catch(() => {});
                }
            }
        }
    } catch (err) {
        console.error('[Raids] Erro ao atualizar mensagem do boss:', err.message);
    }

    return {
        temporaryMessage: attackText
    };
}

async function handleBossDeath(boss, bossMessage, guild) {
    console.log(`[Raids] Boss ${boss.name} derrotado!`);

    // Cancel escape timeout
    if (boss.escapeTimeout) {
        clearTimeout(boss.escapeTimeout);
    }

    const guildName = guild?.name || 'Ascended';

    // Calculate ranking and payouts
    const sorted = Object.entries(boss.players)
        .map(([id, p]) => ({ id, ...p }))
        .sort((a, b) => b.damage - a.damage);

    const rpgItems = require('../modules/rpgItems');

    let payoutDescription = '';

    sorted.forEach((p, idx) => {
        const damage = p.damage;
        // Payout scaling igual ao de Invasão:
        const baseAc = Math.floor(damage * 0.1) + 30;
        const baseXp = Math.floor(damage * 0.05) + 30;
        
        let bonusAc = 0;
        let medal = '';
        if (idx === 0) {
            bonusAc = 150;
            medal = '🥇 ';
        } else if (idx === 1) {
            bonusAc = 75;
            medal = '🥈 ';
        } else if (idx === 2) {
            bonusAc = 40;
            medal = '🥉 ';
        }

        const totalAc = baseAc + bonusAc;
        const totalXp = baseXp;

        // Deposit coins, guild XP and RPG XP
        db.addCoins(p.id, totalAc);
        db.addGuildXp(p.id, totalXp, guild);
        const lvlUp = db.addRpgXp(p.id, totalXp);

        const lvlUpText = lvlUp?.leveledUp ? ` **🎉 NÍVEL ${lvlUp.level}!**` : '';
        const rankLine = `${medal}**${p.name}**: ${damage.toLocaleString()} dmg | **+${totalAc} AC** | **+${totalXp} RPG XP**${lvlUpText}\n`;
        payoutDescription += rankLine;
    });

    if (!payoutDescription) {
        payoutDescription = 'Nenhum participante registrou dano.';
    }

    // Final Blow reward & 5% drop roll
    const finalBlowUserId = boss.finalBlowUserId;
    const finalBlowNickname = boss.finalBlowNickname;
    let lootDropped = null;

    if (finalBlowUserId) {
        const roll = Math.random();
        if (roll < 0.05) {
            // Find rare items from rpgItems (cost >= 1000)
            const rareItemKeys = Object.keys(rpgItems).filter(key => rpgItems[key].cost >= 1000);
            if (rareItemKeys.length > 0) {
                const randomKey = rareItemKeys[Math.floor(Math.random() * rareItemKeys.length)];
                lootDropped = rpgItems[randomKey];
                db.addInventoryItem(finalBlowUserId, lootDropped.id, 1);
            }
        }
    }

    let finalBlowSection = '';
    if (finalBlowUserId) {
        finalBlowSection = `\n💀 **Golpe Final:** **${finalBlowNickname}** (<@${finalBlowUserId}>)`;
        if (lootDropped) {
            finalBlowSection += `\n🎁 **Loot Raro Detectado!** Encontrou um **${lootDropped.name}** (adicionado ao inventário)!`;
        }
    }

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71) // Green
        .setTitle(`🏆 VITÓRIA: O ${boss.name} foi derrotado!`)
        .setDescription(`O terrível **${boss.name}** foi dizimado pelos guerreiros da guilda **${guildName}**!\n\n**Recompensas da Batalha:**\n${payoutDescription}${finalBlowSection}`)
        .setFooter({ text: 'Ascended Raids • Parabéns a todos!' })
        .setTimestamp();

    await bossMessage.edit({ embeds: [embed] }).catch(() => {});
    
    // Announce victory publicly
    await bossMessage.channel.send({ content: `🎉 **O BOSS ${boss.name.toUpperCase()} FOI DERROTADO!** Parabéns a todos os participantes pelas recompensas! 🏆` }).catch(() => {});

    // Clear active boss state
    state.activeBoss = null;
}
