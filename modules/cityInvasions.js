'use strict';

const { EmbedBuilder, ChannelType } = require('discord.js');
const state = require('./state');
const db = require('./database');
const rpgItems = require('./rpgItems');
const achievements = require('./achievements');

const MONSTERS = [
    {
        id: 'orc_horde',
        name: 'Horda de Orcs 🧌',
        maxHp: 1500,
        atk: 25,
        color: 0x27AE60, // Green
        desc: 'Uma horda de Orcs ferozes marchando pelos portões do Bastião de Aethelgard!'
    },
    {
        id: 'red_dragon',
        name: 'Dragão de Fogo 🐉',
        maxHp: 3000,
        atk: 40,
        color: 0xE74C3C, // Red
        desc: 'Um terrível Dragão Vermelho cuspindo chamas nas muralhas do Bastião de Aethelgard!'
    },
    {
        id: 'demon_lord',
        name: 'Lorde Demônio 😈',
        maxHp: 5000,
        atk: 60,
        color: 0x8E44AD, // Purple
        desc: 'Um Lorde Demônio emergindo de um portal abissal no centro do Bastião de Aethelgard!'
    },
    {
        id: 'medusa',
        name: 'Gorgona Petrificante 🐍',
        maxHp: 2000,
        atk: 30,
        color: 0x16A085, // Teal
        desc: 'Uma Medusa petrificando os defensores nos distritos comerciais do Bastião de Aethelgard!'
    },
    {
        id: 'necromancer',
        name: 'Necromante Sombrio 💀',
        maxHp: 1800,
        atk: 28,
        color: 0x34495E, // Dark Blue/Grey
        desc: 'Um Necromante erguendo mortos-vivos no cemitério do Bastião de Aethelgard!'
    }
];
const SIEGES = [
    {
        id: 'orc_army',
        name: 'Exército Orc 🗡️',
        maxHp: 50000,
        color: 0x27AE60,
        desc: 'O Grande Exército de Grimgor está marchando sobre o Bastião! Eles estão atacando os portões!'
    },
    {
        id: 'undead_legion',
        name: 'Legião dos Mortos 🧟',
        maxHp: 65000,
        color: 0x34495E,
        desc: 'Uma maré inesgotável de cadáveres reanimados liderados por um Lich tenta derrubar os portões de Aethelgard!'
    }
];


const CLASS_GROWTH = {
    EK: { name: 'Knight', hpBase: 150, atkBase: 10, defBase: 15, hplvl: 15, atklvl: 1.0, deflvl: 2.0, emoji: '⚔️', spells: ['Fierce Berserk', 'Front Sweep', 'Brutal Strike'] },
    RP: { name: 'Paladin', hpBase: 120, atkBase: 12, defBase: 12, hplvl: 10, atklvl: 1.5, deflvl: 1.5, emoji: '🎯', spells: ['Divine Caldera', 'Holy Arrow', 'Ethereal Spear'] },
    ED: { name: 'Druid', hpBase: 110, atkBase: 11, defBase: 10, hplvl: 8, atklvl: 1.8, deflvl: 1.0, emoji: '❄️', spells: ['Eternal Winter', 'Ice Strike', 'Terra Strike'] },
    MS: { name: 'Sorcerer', hpBase: 100, atkBase: 15, defBase: 8, hplvl: 8, atklvl: 2.2, deflvl: 0.8, emoji: '🔥', spells: ['Hell\'s Core', 'Sudden Death', 'Energy Strike'] }
};

function getPlayerTotalAtk(char) {
    const growth = CLASS_GROWTH[char.class_code] || CLASS_GROWTH.EK;
    const lvl = char.level || 1;
    const baseAtk = growth.atkBase + (lvl - 1) * growth.atklvl;

    let eqAtk = 0;
    const w = char.equipped_weapon ? rpgItems[char.equipped_weapon] : null;
    const s = char.equipped_shield ? rpgItems[char.equipped_shield] : null;
    const a = char.equipped_armor ? rpgItems[char.equipped_armor] : null;
    const am = char.equipped_amulet ? rpgItems[char.equipped_amulet] : null;

    if (w) { eqAtk += w.atk || 0; }
    if (s) { eqAtk += s.atk || 0; }
    if (a) { eqAtk += a.atk || 0; }
    if (am) { eqAtk += am.atk || 0; }

    return baseAtk + eqAtk;
}

async function spawnCityInvasion(client, forced = false) {
    if (!forced) {
        db.setConfig('lastInvasionSpawnTime', Date.now());
    }

    // Abort if there is already an active boss or active invasion
    if (state.activeBoss || state.activeInvasion) {
        console.log('[City Invasions] Spawn cancelado: Já existe um evento ativo.');
        return;
    }

    const isSiege = Math.random() < 0.25; // 25% chance of Siege
    const monster = isSiege 
        ? SIEGES[Math.floor(Math.random() * SIEGES.length)] 
        : MONSTERS[Math.floor(Math.random() * MONSTERS.length)];

    // Busca canal configurado, senão tenta por nome (minigame/rpg/boss), nunca o geral
    const guild = client.guilds.cache.find(g => g.channels.cache.some(c => c.name.includes('invasoes-e-raids'))) || client.guilds.cache.first();
    if (!guild) {
        console.error('[City Invasions] Nenhuma guilda encontrada para spawnar a invasão.');
        return;
    }
    let channel = null;

    // 1) Canal salvo nas configs
    const savedChannelId = db.getConfig('invasionChannelId');
    if (savedChannelId) {
        channel = guild.channels.cache.get(savedChannelId) || null;
    }

    // 2) Busca por nome de minigame/rpg/boss
    if (!channel) {
        channel = guild.channels.cache.find(c =>
            c.type === ChannelType.GuildText &&
            /invasoes|raids|boss|rpg|minigame/i.test(c.name)
        ) || null;
    }

    if (!channel) {
        console.error('[City Invasions] Nenhum canal de texto encontrado para spawnar a invasão.');
        return;
    }


    // Build progress bar
    const bar = '█'.repeat(10);
    
    const embed = new EmbedBuilder()
        .setColor(monster.color)
        .setTitle(isSiege ? `🏰 CERCO NO BASTIÃO DE AETHELGARD: ${monster.name}! 🏰` : `⚔️ INVASÃO NO BASTIÃO DE AETHELGARD: ${monster.name}! ⚔️`)
        .setDescription(`🏰 **${monster.desc}**\n\n**${monster.name}** invadiu a cidade! Os cidadãos devem defender o Bastião!\nDigite **\`!atacar\`** ou **\`/atacar\`** para desferir golpes no monstro!\n${isSiege ? "🪵 **Use '!construir barricada' para curar o Portão ou '!construir catapulta' para dar dano em área!**\n" : ""}Vocês têm **15 minutos** para derrotá-lo antes que ele saqueie a cidade!`)
        .addFields(
            { name: isSiege ? '💀 Exército Inimigo' : '❤️ Vida do Monstro', value: `\`[${bar}]\` (100%)\n${monster.maxHp.toLocaleString()} / ${monster.maxHp.toLocaleString()} HP`, inline: false },
            { name: '🛡️ Defensores (Top Dano)', value: 'Nenhum dano causado ainda.', inline: false }
        );

    if (isSiege) {
        embed.addFields({ name: '🚪 Portões de Aethelgard', value: `\`[██████████]\` (100%)\n25000 / 25000 HP`, inline: false });
    }

    embed.setFooter({ text: 'Bastião de Aethelgard • Cooldown de ataque: 10 segundos' })
        .setTimestamp();

    // Encontrar o cargo Aethelgard para marcar
    const aethelgardRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'aethelgard');
    const pingText = aethelgardRole ? `<@&${aethelgardRole.id}> 🚨 **INVASÃO NO BASTIÃO DE AETHELGARD!** 🚨` : '🚨 **INVASÃO NO BASTIÃO DE AETHELGARD!** 🚨';

    const message = await channel.send({ content: pingText, embeds: [embed] }).catch(() => null);
    if (!message) {
        console.error('[City Invasions] Falha ao enviar mensagem da invasão no canal.');
        return;
    }

    // Clear any existing escape timeout
    if (state.activeInvasion && state.activeInvasion.escapeTimeout) {
        clearTimeout(state.activeInvasion.escapeTimeout);
    }
    if (state.activeInvasion && state.activeInvasion.siegeInterval) {
        clearInterval(state.activeInvasion.siegeInterval);
    }

    state.activeInvasion = {
        name: monster.name,
        icon: monster.id,
        isSiege: isSiege,
        maxHp: monster.maxHp,
        hp: monster.maxHp,
        gateHp: isSiege ? 25000 : 0,
        maxGateHp: 25000,
        color: monster.color,
        spawnTime: Date.now(),
        players: {}, // { userId: { name, damage, lastAttack } }
        channelId: channel.id,
        messageId: message.id,
        escapeTimeout: setTimeout(() => handleInvasionEscape(client), 15 * 60 * 1000) // 15 minutes
    };

    if (isSiege) {
        state.activeInvasion.siegeInterval = setInterval(() => processSiegeAttack(client), 30000); // Exército ataca a cada 30s
    }

    console.log(`[City Invasions] Monstro ${monster.name} spawnado no canal ${channel.name} (${channel.id}). Message ID: ${message.id}`);
}

async function handleInvasionEscape(client) {
    if (!state.activeInvasion) return;
    const invasion = state.activeInvasion;
    console.log(`[City Invasions] Monstro ${invasion.name} escapou!`);

    try {
        const guild = client.guilds.cache.find(g => g.channels.cache.has(invasion.channelId)) || client.guilds.cache.first();
        if (guild) {
            const channel = await guild.channels.fetch(invasion.channelId).catch(() => null);
            if (channel) {
                const message = await channel.messages.fetch(invasion.messageId).catch(() => null);
                if (message) {
                    const embed = EmbedBuilder.from(message.embeds[0])
                        .setColor(0x7F8C8D) // Grey
                        .setTitle(`🏚️ SAQUE: O monstro saqueou o Bastião!`)
                        .setDescription(`O tempo limite de 15 minutos acabou! **${invasion.name}** destruiu as defesas do Bastião de Aethelgard, saqueou a cidade e escapou de volta para as sombras...`)
                        .setFields([]); // Clear HP/Leaderboard fields
                    await message.edit({ embeds: [embed] }).catch(() => {});
                }
            }
        }
    } catch (err) {
        console.error('[City Invasions] Erro ao processar fuga do monstro:', err.message);
    }

    if (state.activeInvasion && state.activeInvasion.siegeInterval) clearInterval(state.activeInvasion.siegeInterval);
    state.activeInvasion = null;
}

async function handleInvasionAttack(userId, channel, guild, client) {
    // 1. Check if they have an RPG character
    const char = db.getRpgCharacter(userId);
    if (!char) {
        return {
            error: '🚫 Você precisa possuir um personagem RPG registrado para defender a cidade! Crie o seu com **`/rpg-registrar`**.',
            temporaryMessage: `🚫 <@${userId}>, você precisa de um personagem RPG registrado (\`/rpg-registrar\`) para lutar!`
        };
    }

    const now = Date.now();

    // Death Check
    if (char.death_time && char.death_time > 0) {
        const timeSinceDeath = now - char.death_time;
        if (timeSinceDeath < 60 * 60 * 1000) {
            const remaining = Math.ceil((60 * 60 * 1000 - timeSinceDeath) / 60000);
            return {
                error: `💀 Você está morto e não pode atacar! Aguarde **${remaining} minutos** ou visite o \`!templo\`.`,
                temporaryMessage: `💀 <@${userId}>, você está morto! Aguarde **${remaining} minutos** ou ressuscite no \`!templo\`.`
            };
        } else {
            const maxHp = db.getPlayerMaxHp(char);
            require('./database').db.prepare('UPDATE rpg_characters SET death_time = 0, current_hp = ? WHERE discord_id = ?').run(maxHp, userId);
            char.death_time = 0;
            char.current_hp = maxHp;
        }
    }

    const invasion = state.activeInvasion;
    if (!invasion) {
        return {
            error: '❌ Não há nenhuma invasão ativa no Bastião de Aethelgard.',
            temporaryMessage: `❌ <@${userId}>, não há nenhuma invasão ativa no Bastião no momento.`
        };
    }

    // 2. Cooldown check (10 seconds)
    const lastAttack = invasion.players[userId]?.lastAttack || 0;
    const timeDiff = now - lastAttack;
    if (timeDiff < 10000) {
        const remaining = Math.ceil((10000 - timeDiff) / 1000);
        return {
            error: `⏳ Aguarde **${remaining}s** para atacar novamente!`,
            temporaryMessage: `⏳ <@${userId}>, aguarde **${remaining}s** para atacar novamente!`
        };
    }

    // 3. Damage calculation using character Stats
    let totalAtk = getPlayerTotalAtk(char);
    let dmgMult = 1;
    let defMult = 1;
    let healAmt = 0;
    let isDodge = false;

    // Phase 9: Vocation Combat Buffs
    if (char.vocation === 'Mago') dmgMult += 0.30;
    if (char.vocation === 'Cavaleiro') defMult += 0.30;
    if (char.vocation === 'Arqueiro') dmgMult += 0.15;

    // Phase 8: Pet Combat Buffs
    const activePet = db.getActivePet(userId);
    const petDef = activePet ? require('./rpgPets').RPG_PETS[activePet.pet_id] : null;
    
    if (petDef) {
        if (petDef.buff === 'atk' || petDef.buff === 'all') dmgMult += petDef.value;
        if (petDef.buff === 'def' || petDef.buff === 'all') defMult += petDef.value;
        if (petDef.buff === 'heal') healAmt = petDef.value;
    }
    totalAtk = Math.floor(totalAtk * dmgMult);
    const rand = 0.85 + Math.random() * 0.3; // 85% to 115%
    let damage = Math.max(5, Math.floor(totalAtk * rand));

    const classCode = (char.class_code || 'EK').toUpperCase();
    const growth = CLASS_GROWTH[classCode] || CLASS_GROWTH.EK;

    // Check Auto-Special
    const SPECIAL_COOLDOWN_MS = 2 * 60 * 60 * 1000;
    const lastSpecial = db.getConfig(`lastSpecial_${userId}`) || 0;
    let usedSpecial = false;
    let attackText = '';
    let bossAbilityText = '';

    if (now - lastSpecial >= SPECIAL_COOLDOWN_MS) {
        usedSpecial = true;
        db.setConfig(`lastSpecial_${userId}`, now);
        
        if (classCode === 'EK') {
            damage = Math.floor(totalAtk * (2.5 + Math.random()));
            attackText = `🛡️ **FORTRESS STRIKE:** **${char.nickname}** usou sua habilidade suprema, causando **${damage}** de dano massivo em **${invasion.name}**!`;
        } else if (classCode === 'RP') {
            damage = Math.floor(totalAtk * (1.2 + Math.random() * 0.5));
            invasion.noDodgeCount = (invasion.noDodgeCount || 0) + 3;
            attackText = `🏹 **DIVINE SHIELD:** **${char.nickname}** cegou o monstro com luz suprema, causando **${damage}** de dano! Ele não esquivará dos próximos 3 ataques!`;
        } else if (classCode === 'ED') {
            damage = Math.floor(totalAtk * (1.2 + Math.random() * 0.5));
            invasion.vulnCount = (invasion.vulnCount || 0) + 5;
            if (invasion.escapeTimeout) {
                clearTimeout(invasion.escapeTimeout);
                invasion.escapeTimeout = setTimeout(() => handleInvasionEscape(client), 5 * 60 * 1000);
            }
            attackText = `❄️ **BLIZZARD:** **${char.nickname}** usou nevasca suprema, causando **${damage}** de dano! O monstro está Vulnerável (+15% de dano) por 5 turnos e lento!`;
        } else if (classCode === 'MS') {
            if (Math.random() < 0.50) {
                damage = Math.floor(totalAtk * 4);
                attackText = `🔥 **METEOR STRIKE:** O céu se abriu e **${char.nickname}** invocou um METEORO GIGANTE causando avassaladores **${damage}** de dano!`;
            } else {
                damage = 0;
                attackText = `🔥 **METEOR STRIKE:** **${char.nickname}** tentou invocar um meteoro supremo, mas ele caiu fora da rota e errou...`;
            }
        }
    } else {
        // Normal Attack Logic
        // Phase 2: Combos
        if (invasion.lastAttackerUserId === userId) {
            invasion.comboCount = (invasion.comboCount || 1) + 1;
        } else {
            invasion.lastAttackerUserId = userId;
            invasion.comboCount = 1;
        }

        let isCombo = false;
        if (invasion.comboCount >= 3) {
            damage = Math.floor(damage * 1.25); // +25% damage on combo
            invasion.comboCount = 0;
            isCombo = true;
        }

        // Phase 3: Vulnerability (ED Blizzard)
        let isVuln = false;
        if (invasion.vulnCount && invasion.vulnCount > 0) {
            damage = Math.floor(damage * 1.15); // +15% damage
            invasion.vulnCount -= 1;
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
        isDodge = false;
        // Phase 3: No Dodge (RP Divine Shield)
        if (invasion.noDodgeCount && invasion.noDodgeCount > 0) {
            invasion.noDodgeCount -= 1; // Monstro não pode esquivar
        } else {
            if (Math.random() < 0.10) {
                damage = 0;
                isDodge = true;
            }
        }

        // Phase 3: Boss Abilities (Counter-attacks)
        const percentageBefore = invasion.hp / invasion.maxHp;
        if (!isDodge && percentageBefore <= 0.3) {
            if (Math.random() < 0.30) {
                if (invasion.name.includes('Necromante') || invasion.name.includes('Demon')) {
                    // Heal: cura 5% do HP
                    const healAmt = Math.floor(invasion.maxHp * 0.05);
                    invasion.hp = Math.min(invasion.maxHp, invasion.hp + healAmt);
                    bossAbilityText = `\n🩸 **SUGADOR DE ALMAS:** O monstro drenou sua força vital e curou **${healAmt} HP**!`;
                } else if (invasion.name.includes('Dragão') || invasion.name.includes('Dragon')) {
                    // Baforada / Freeze: anula o dano atual e aplica penalidade
                    damage = 0;
                    invasion.players[userId] = invasion.players[userId] || { name: char.nickname, damage: 0 };
                    invasion.players[userId].lastAttack = now + 5000; // +5s penalty
                    bossAbilityText = `\n🔥 **BAFORADA INFERNAL:** O dragão expeliu chamas, anulando seu ataque e te queimando (+5s cooldown)!`;
                } else {
                    damage = 0;
                    bossAbilityText = `\n🛡️ **ARMADURA RÚNICA:** O monstro ergueu um escudo místico que absorveu totalmente seu ataque!`;
                }
            }
        }

        const spell = growth.spells[Math.floor(Math.random() * growth.spells.length)];

        if (isDodge) {
            attackText = `🛡️ **Esquiva!** O ${invasion.name} desviou do seu ataque, **${char.nickname}**!`;
        } else {
            const critText = isCrit ? '💥 **CRÍTICO!** ' : '';
            const comboText = isCombo ? ' 🔥 **COMBO bônus!**' : '';
            const vulnText = isVuln ? ' 🧊 *(Vulnerável)*' : '';
            attackText = `${critText}${growth.emoji} **${char.nickname}** usou **${spell}** e causou **${damage}** de dano em **${invasion.name}**!${comboText}${vulnText}${bossAbilityText}`;
        }
    }

    // Apply Player Damage to Boss HP
    if (damage > 0) {
        invasion.hp = Math.max(0, invasion.hp - damage);
        invasion.players[userId] = invasion.players[userId] || { name: char.nickname, damage: 0 };
        invasion.players[userId].damage += damage;
        invasion.players[userId].lastAttack = now;
    }

    // Phase 5: Monster Counter-attack!
    if (!isDodge && invasion.hp > 0) {
        const maxHp = (char.level || 1) * 50 + 100;
        let currentHp = (char.current_hp === -1 || char.current_hp === undefined || char.current_hp === null) ? maxHp : char.current_hp;
        
        let mDmg = Math.max(5, Math.floor(maxHp * (0.05 + Math.random() * 0.1))); // Boss hits back
        mDmg = Math.floor(mDmg / defMult); // Pet Defense reduces damage
        currentHp -= mDmg;
        
        if (healAmt > 0) {
            currentHp = Math.min(maxHp, currentHp + healAmt);
            attackText += `\n🧚 Seu Pet te curou em **${healAmt} HP**!`;
        }

        attackText += `\n🩸 O monstro contra-atacou e causou **${mDmg}** de dano em você!`;

        if (currentHp <= 0) {
            currentHp = 0;
            const deathInfo = db.handleDeath(userId);
            attackText += `\n💀 **VOCÊ FOI MORTO PELO MONSTRO!** Perdeu **${deathInfo.xpLost} XP** e ficará fora de combate por 1 hora.`;
        }
        db.updateHp(userId, currentHp);
    }

    // 6. Update message
    try {
        const invasionChannel = await client.channels.fetch(invasion.channelId).catch(() => null);
        if (invasionChannel) {
            const invasionMessage = await invasionChannel.messages.fetch(invasion.messageId).catch(() => null);
            if (invasionMessage) {
                if (invasion.hp === 0) {
                    // Set final blow user ID for drop chance
                    invasion.finalBlowUserId = userId;
                    invasion.finalBlowNickname = char.nickname;
                    await handleInvasionDefeat(client, guild);
                } else {
                    const percentage = invasion.hp / invasion.maxHp;
                    const filledBlocks = Math.round(percentage * 10);
                    // Phase 2: Enrage
                    let enrageText = '';
                    let color = invasion.color || 0x2ECC71;
                    if (percentage <= 0.3) {
                        enrageText = ' 😡 **ENRAIVECIDO**';
                        color = 0xE74C3C; // Red
                    }

                    const emptyBlocks = 10 - filledBlocks;
                    const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
                    const barStr = `\`[${bar}]\` (${Math.round(percentage * 100)}%)${enrageText}\n${invasion.hp.toLocaleString()} / ${invasion.maxHp.toLocaleString()} HP`;

                    const sorted = Object.entries(invasion.players)
                        .map(([id, p]) => ({ id, ...p }))
                        .sort((a, b) => b.damage - a.damage);

                    const top5 = sorted.slice(0, 5);
                    const leaderboardText = top5.map((p, idx) => {
                        const emoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '⚔️';
                        return `${emoji} **${p.name}**: ${p.damage.toLocaleString()} dmg`;
                    }).join('\n');

                    const updatedEmbed = EmbedBuilder.from(invasionMessage.embeds[0])
                        .setColor(color)
                        .setFields([
                            { name: '❤️ Vida do Monstro', value: barStr, inline: false },
                            { name: '🛡️ Defensores (Top Dano)', value: leaderboardText, inline: false }
                        ]);

                    await invasionMessage.edit({ embeds: [updatedEmbed] }).catch(() => {});
                }
            }
        }
    } catch (err) {
        console.error('[City Invasions] Erro ao atualizar mensagem da invasão:', err.message);
    }

    return {
        temporaryMessage: attackText
    };
}

async function handleInvasionDefeat(client, guild) {
    if (!state.activeInvasion) return;
    const invasion = state.activeInvasion;
    console.log(`[City Invasions] Monstro ${invasion.name} derrotado!`);

    // Cancel escape timeout
    if (invasion.escapeTimeout) {
        clearTimeout(invasion.escapeTimeout);
    }

    const config = db.loadAllConfig();
    const announcementChannelId = config.reportChannelId || config.claimCommandsChannelId;

    // Calculate ranking and payouts
    const sorted = Object.entries(invasion.players)
        .map(([id, p]) => ({ id, ...p }))
        .sort((a, b) => b.damage - a.damage);

    let payoutDescription = '';

    for (let idx = 0; idx < sorted.length; idx++) {
        const p = sorted[idx];
        const damage = p.damage;
        
        // Payout scaling:
        // Coins (AC): Math.floor(dmg * 0.1) + 30. Top 3 bonuses: +150, +75, +40
        // RPG XP & Guild XP: Math.floor(dmg * 0.05) + 30
        const baseAc = Math.floor(damage * 0.1) + 30;
        const baseXp = Math.floor(damage * 0.05) + 30;

        let bonusAc = 0;
        let medal = '';
        let matDrop = '';
        if (idx === 0) {
            bonusAc = 150;
            medal = '🥇 ';
            db.addMaterial(p.id, 'shadow_essence', 1);
            db.addEgg(p.id, 'epic');
            matDrop = ' | 🌑 **1x Essência Sombria** | 🥚 **1x Ovo Épico**';
        } else if (idx === 1) {
            bonusAc = 75;
            medal = '🥈 ';
            db.addMaterial(p.id, 'magic_dust', 3);
            matDrop = ' | ✨ **3x Pó Mágico**';
        } else if (idx === 2) {
            bonusAc = 40;
            medal = '🥉 ';
            db.addMaterial(p.id, 'magic_dust', 1);
            matDrop = ' | ✨ **1x Pó Mágico**';
        }

        const totalAc = baseAc + bonusAc;
        const totalXp = baseXp;

        // Apply to database
        db.addCoins(p.id, totalAc);
        db.addGuildXp(p.id, totalXp, guild);
        const lvlUp = db.addRpgXp(p.id, totalXp);

        // Update achievements and city defender damage
        try {
            await achievements.checkCityDefender(p.id, damage, guild, announcementChannelId);
        } catch (errAch) {
            console.error(`[City Invasions] Erro ao atualizar dano à cidade para o ID ${p.id}:`, errAch.message);
        }

        // Add to Global Invasion Ranking
        try {
            db.addInvasionDamage(p.id, p.name, damage);
        } catch (errRnk) {
            console.error(`[City Invasions] Erro ao atualizar ranking global para o ID ${p.id}:`, errRnk.message);
        }

        const lvlUpText = lvlUp?.leveledUp ? ` **🎉 NÍVEL ${lvlUp.level}!**` : '';
        const rankLine = `${medal}**${p.name}**: ${damage.toLocaleString()} dmg | **+${totalAc} AC**${matDrop} | **+${totalXp} RPG XP**${lvlUpText}\n`;
        payoutDescription += rankLine;
    }

    if (!payoutDescription) {
        payoutDescription = 'Nenhum defensor registrou dano.';
    }

    // Final Blow reward & 5% drop roll
    const finalBlowUserId = invasion.finalBlowUserId;
    const finalBlowNickname = invasion.finalBlowNickname;
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
                
                try {
                    await achievements.checkLootHunter(finalBlowUserId, guild, announcementChannelId);
                } catch (errAch) {
                    console.error('[City Invasions] Erro ao verificar conquistas de loot:', errAch.message);
                }
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
        .setTitle(`🏆 VITÓRIA: O Bastião de Aethelgard foi defendido!`)
        .setDescription(`O terrível **${invasion.name}** foi dizimado pelos guerreiros do Bastião!\n\n**Recompensas da Batalha:**\n${payoutDescription}${finalBlowSection}`)
        .setFooter({ text: 'Bastião de Aethelgard • Cidade Salva!' })
        .setTimestamp();

    // Edit message
    try {
        const invasionChannel = await client.channels.fetch(invasion.channelId).catch(() => null);
        if (invasionChannel) {
            const invasionMessage = await invasionChannel.messages.fetch(invasion.messageId).catch(() => null);
            if (invasionMessage) {
                await invasionMessage.edit({ embeds: [embed] }).catch(() => {});
            }
            await invasionChannel.send({ content: `🎉 **O MONSTRO ${invasion.name.toUpperCase()} FOI DERROTADO!** O Bastião de Aethelgard está seguro! 🏰` }).catch(() => {});
        }
    } catch (err) {
        console.error('[City Invasions] Erro ao processar finalização da invasão:', err.message);
    }

    // Reset invasion state
    state.activeInvasion = null;
}

module.exports = {
    spawnCityInvasion,
    handleInvasionAttack,
    handleInvasionEscape,
    handleInvasionDefeat,
    CLASS_GROWTH,
    getPlayerTotalAtk
};

async function processSiegeAttack(client) {
    if (!state.activeInvasion || !state.activeInvasion.isSiege) return;
    const invasion = state.activeInvasion;

    const damage = Math.floor(1000 + Math.random() * 1000); // 1000-2000 dmg
    invasion.gateHp -= damage;

    if (invasion.gateHp <= 0) {
        invasion.gateHp = 0;
        // Gate broken! Siege wins.
        try {
            const guild = client.guilds.cache.find(g => g.channels.cache.has(invasion.channelId)) || client.guilds.cache.first();
            if (guild) {
                const channel = await guild.channels.fetch(invasion.channelId).catch(() => null);
                if (channel) {
                    const message = await channel.messages.fetch(invasion.messageId).catch(() => null);
                    if (message) {
                        const embed = EmbedBuilder.from(message.embeds[0])
                            .setColor(0x7F8C8D)
                            .setTitle(`🏚️ PORTÕES DESTRUÍDOS!`)
                            .setDescription(`**${invasion.name}** quebrou os portões do Bastião e saqueou a cidade! Muitos perderam seus AC!`)
                            .setFields([]);
                        await message.edit({ embeds: [embed] }).catch(() => {});
                        await channel.send(`💥 **O Portão Caiu!** O ${invasion.name} invadiu a cidade!`).catch(()=>{});
                    }
                }
            }
        } catch (err) {}
        
        if (invasion.escapeTimeout) clearTimeout(invasion.escapeTimeout);
        if (invasion.siegeInterval) clearInterval(invasion.siegeInterval);
        state.activeInvasion = null;
    } else {
        updateInvasionMessage(client);
    }
}
