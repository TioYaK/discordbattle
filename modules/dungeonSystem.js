'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const materials = require('./rpgMaterials');
const cityInvasions = require('./cityInvasions');
const rpgPets = require('./rpgPets').RPG_PETS;

const ROOM_SCENARIOS = {
    empty: [
        "Uma caverna com cristais brilhantes iluminando as paredes.",
        "Um corredor fétido com marcas de garras espalhadas pelo chão."
    ],
    chest: [
        "No centro da sala, há um baú de madeira ornado com ouro."
    ],
    trap: [
        "O chão afunda sob o seu pé! Dardos voam das paredes."
    ],
    shrine: [
        "Uma estátua de uma deusa gentil que parece chorar."
    ],
    merchant: [
        "Um goblin encapuzado oferece mercadorias debaixo de um cogumelo."
    ],
    riddle: [
        { q: "O que tem que ser quebrado antes que você possa usá-lo?", a: "Um ovo", w1: "Uma porta", w2: "Um cadeado" },
        { q: "Sou alto quando jovem, e curto quando velho. O que eu sou?", a: "Uma vela", w1: "Um humano", w2: "Uma árvore" }
    ]
};

const RELICS = {
    'presa_vampiro': { name: 'Presa de Vampiro', desc: 'Recupera 10% do dano causado como HP.' },
    'polvora_instavel': { name: 'Pólvora Instável', desc: 'Dá 30% a mais de dano, mas você perde 5 HP a cada ataque.' },
    'escudo_espinhos': { name: 'Escudo de Espinhos', desc: 'Reflete 15% do dano recebido de volta ao atacante.' },
    'bota_hermes': { name: 'Bota de Hermes', desc: '15% de chance de esquivar completamente de qualquer ataque.' }
};

function getRandomRoom() {
    const r = Math.random();
    if (r < 0.3) return 'empty';
    if (r < 0.45) return 'chest';
    if (r < 0.55) return 'trap';
    if (r < 0.60) return 'shrine';
    if (r < 0.65) return 'merchant';
    if (r < 0.70) return 'riddle';
    return 'monster';
}

function getRnd(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

async function startDungeon(interaction, userId, client, tierId) {
    const char = db.getRpgCharacter(userId);
    const petDb = db.getActivePet(userId);
    let petDef = petDb ? rpgPets[petDb.pet_id] : null;

    let dmgMult = 1.0;
    let defMult = 1.0;
    let healAmt = 0;

    if (petDef) {
        if (petDef.buff === 'atk') dmgMult += petDef.value;
        if (petDef.buff === 'def') defMult += petDef.value;
        if (petDef.buff === 'all') { dmgMult += petDef.value; defMult += petDef.value; }
        if (petDef.buff === 'heal') healAmt = petDef.value;
    }

    const eqAtk = db.getPlayerEquipBonus(userId, 'atk');
    const eqDef = db.getPlayerEquipBonus(userId, 'def');
    const maxHp = (char.level || 1) * 50 + 100;
    const baseAtk = (char.level || 1) * 10 + eqAtk;
    defMult += (eqDef * 0.05);

    const DUNG_TIERS = {
        1: { name: 'Caverna dos Slimes (Cobre)', maxLvl: 10, reqKey: 'dungeon_key_1', lootMult: 1, rooms: 3,
            monsters: [{ name: 'Slime Verde', emoji: '🟢', hp: 30, atk: 5 }],
            bosses: [{ name: 'Rei Slime', emoji: '👑🟢', hp: 100, atk: 15 }]
        },
        2: { name: 'Tumbas Esquecidas (Prata)', maxLvl: 30, reqKey: 'dungeon_key_2', lootMult: 2.5, rooms: 5,
            monsters: [{ name: 'Esqueleto', emoji: '💀', hp: 80, atk: 25 }],
            bosses: [{ name: 'Rei Esqueleto', emoji: '👑💀', hp: 250, atk: 45 }]
        },
        3: { name: 'Santuário Corrompido (Ouro)', maxLvl: 999, reqKey: 'dungeon_key_3', lootMult: 5, rooms: 7,
            equipDrops: ['crystal_wand', 'dragon_shield'],
            monsters: [{ name: 'Cultista', emoji: '🧙‍♂️', hp: 150, atk: 50 }],
            bosses: [{ name: 'Demônio Ancestral', emoji: '👹', hp: 600, atk: 90 }]
        }
    };

    const tier = DUNG_TIERS[tierId];

    const session = {
        userId, tierId, tier, char, petDef,
        maxHp, currentHp: (char.current_hp === -1 || char.current_hp === undefined) ? maxHp : char.current_hp,
        baseAtk: Math.floor(baseAtk * dmgMult), defMult, healAmt,
        roomIndex: 1, maxRooms: tier.rooms,
        loot: { ac: 0, mats: [] },
        buffs: { defBuff: 0 },
        relics: [],
        cooldowns: { skill1: 0, skill2: 0, petSkill: 0 },
        status: []
    };

    try { await interaction.deferUpdate(); } catch(e) {}
    await generateRoom(interaction, session, true);
}

async function generateRoom(i, session, isFirst = false) {
    if (session.currentHp <= 0) return handleDeath(i, session);
    if (session.roomIndex > session.maxRooms) return handleVictory(i, session);

    let roomType = 'boss';
    if (session.roomIndex < session.maxRooms) roomType = isFirst ? 'empty' : getRandomRoom();

    let embed = new EmbedBuilder().setColor(0x2C3E50).setTitle(`🏰 Masmorra de ${session.tier.name} — Sala ${session.roomIndex}/${session.maxRooms}`)
        .setFooter({ text: `❤️ HP: ${Math.floor(session.currentHp)}/${session.maxHp} | 🎒 Loot: ${session.loot.ac} AC` });
    let buttons = [];

    if (roomType === 'empty') {
        embed.setDescription(`${getRnd(ROOM_SCENARIOS.empty)}\n\nHá dois caminhos à sua frente. Qual direção você escolhe?`);
        buttons = [new ButtonBuilder().setCustomId('move_left').setLabel('Porta Esquerda').setEmoji('🚪').setStyle(ButtonStyle.Secondary),
                   new ButtonBuilder().setCustomId('move_right').setLabel('Porta Direita').setEmoji('🚪').setStyle(ButtonStyle.Secondary)];
    } else if (roomType === 'chest') {
        embed.setDescription(`${getRnd(ROOM_SCENARIOS.chest)}\n\nPode ser uma armadilha ou uma recompensa...`);
        buttons = [new ButtonBuilder().setCustomId('open_chest').setLabel('Abrir Baú').setEmoji('🧰').setStyle(ButtonStyle.Success),
                   new ButtonBuilder().setCustomId('ignore_chest').setLabel('Ignorar').setEmoji('🚶').setStyle(ButtonStyle.Secondary)];
    } else if (roomType === 'trap') {
        const trapDmg = Math.floor((session.maxHp * 0.1) / session.defMult); session.currentHp -= trapDmg; db.updateHp(session.userId, session.currentHp);
        embed.setColor(0xE74C3C).setDescription(`⚠️ **ARMADILHA!**\n${getRnd(ROOM_SCENARIOS.trap)}\nPerdeu **${trapDmg} HP**!`);
        if (session.currentHp <= 0) return handleDeath(i, session);
        buttons = [new ButtonBuilder().setCustomId('move_next').setLabel('Continuar').setStyle(ButtonStyle.Danger)];
    } else if (roomType === 'shrine') {
        embed.setColor(0xF1C40F).setDescription(`✨ **SANTUÁRIO ENCONTRADO!**\n${getRnd(ROOM_SCENARIOS.shrine)}`);
        buttons = [new ButtonBuilder().setCustomId('shrine_drink').setLabel('Beber Água').setStyle(ButtonStyle.Primary),
                   new ButtonBuilder().setCustomId('shrine_pray').setLabel('Rezar').setStyle(ButtonStyle.Success),
                   new ButtonBuilder().setCustomId('move_next').setLabel('Ignorar').setStyle(ButtonStyle.Secondary)];
    } else if (roomType === 'merchant') {
        const cost = 250 * session.tier.lootMult; session.currentMerchantCost = cost;
        embed.setColor(0x3498DB).setDescription(`💰 **MERCADOR CLANDESTINO!**\nCura total por **${cost} AC**?`);
        buttons = [new ButtonBuilder().setCustomId('merchant_buy').setLabel('Comprar Cura').setStyle(ButtonStyle.Success),
                   new ButtonBuilder().setCustomId('move_next').setLabel('Ignorar').setStyle(ButtonStyle.Secondary)];
    } else if (roomType === 'riddle') {
        const r = getRnd(ROOM_SCENARIOS.riddle); session.currentRiddle = r;
        embed.setColor(0x9B59B6).setDescription(`📜 **CHARADA!**\n*"${r.q}"*`);
        let answers = [{ id: 'riddle_correct', label: r.a }, { id: 'riddle_wrong1', label: r.w1 }, { id: 'riddle_wrong2', label: r.w2 }];
        shuffle(answers); answers.forEach(ans => buttons.push(new ButtonBuilder().setCustomId(ans.id).setLabel(ans.label).setStyle(ButtonStyle.Primary)));
    } else if (roomType === 'monster') {
        const monster = getRnd(session.tier.monsters); session.combat = { ...monster, maxHp: monster.hp };
        embed.setColor(0xE67E22).setDescription(`⚔️ **MONSTRO ENCONTRADO!**\nUm **${monster.name}** ${monster.emoji}!`);
        buttons = [new ButtonBuilder().setCustomId('start_combat').setLabel('Atacar!').setStyle(ButtonStyle.Danger)];
    } else if (roomType === 'boss') {
        const boss = getRnd(session.tier.bosses); session.combat = { ...boss, maxHp: boss.hp, isBoss: true };
        embed.setColor(0x8E44AD).setDescription(`👑 **SALA DO CHEFE!**\nO **${boss.name}** ${boss.emoji} te encara!`);
        buttons = [new ButtonBuilder().setCustomId('start_combat').setLabel('Lutar até a Morte!').setStyle(ButtonStyle.Danger)];
    }

    const row = new ActionRowBuilder().addComponents(buttons);
    let msg; try { msg = await i.editReply({ embeds: [embed], components: [row], content: '' }); } catch(e) { return; }

    const filter = inter => inter.user.id === session.userId;
    const collector = msg.createMessageComponentCollector({ filter, time: 120000 });

    collector.on('collect', async inter => {
        try { await inter.deferUpdate(); } catch(e) { return; }
        collector.stop();
        const action = inter.customId;

        if (action === 'start_combat') return handleCombatAction(inter, session, 'start', '');
        if (action === 'move_left' || action === 'move_right' || action === 'ignore_chest' || action === 'move_next') {
            session.roomIndex++; return generateRoom(inter, session);
        }
        if (action === 'open_chest') {
            if (Math.random() < 0.20 && session.tierId >= 2) {
                const availableRelics = Object.keys(RELICS).filter(r => !session.relics.includes(r));
                if (availableRelics.length > 0) {
                    const rId = availableRelics[Math.floor(Math.random() * availableRelics.length)];
                    session.relics.push(rId);
                    await inter.editReply({ content: `🏆 **Relíquia Encontrada:** ${RELICS[rId].name}!`, embeds: [], components: [] });
                } else {
                    await inter.editReply({ content: `📦 Baú vazio.`, embeds: [], components: [] });
                }
            } else {
                const gainAc = Math.floor((Math.random() * 300 + 100) * session.tier.lootMult);
                session.loot.ac += gainAc;
                await inter.editReply({ content: `💰 Achou **${gainAc} AC**!`, embeds: [], components: [] });
            }
            await new Promise(r => setTimeout(r, 2000)); session.roomIndex++; return generateRoom(inter, session);
        }
        if (action.startsWith('riddle_')) {
            if (action === 'riddle_correct') {
                session.loot.ac += 500 * session.tier.lootMult;
                await inter.editReply({ content: `✅ Resposta correta! Ganhou AC extra!`, embeds: [], components: [] });
            } else {
                session.currentHp -= 50; db.updateHp(session.userId, session.currentHp);
                if (session.currentHp <= 0) return handleDeath(inter, session);
                await inter.editReply({ content: `❌ Errado! Tomou 50 de Dano.`, embeds: [], components: [] });
            }
            await new Promise(r => setTimeout(r, 2000)); session.roomIndex++; return generateRoom(inter, session);
        }
        if (action === 'shrine_drink' || action === 'shrine_pray') {
            session.currentHp = session.maxHp; db.updateHp(session.userId, session.currentHp);
            await inter.editReply({ content: `❤️ Você foi curado totalmente!`, embeds: [], components: [] });
            await new Promise(r => setTimeout(r, 2000)); session.roomIndex++; return generateRoom(inter, session);
        }
        if (action === 'merchant_buy') {
            const reg = db.getRegisteredMember(session.userId);
            if (reg.coins >= session.currentMerchantCost) {
                db.removeCoins(session.userId, session.currentMerchantCost);
                session.currentHp = session.maxHp; db.updateHp(session.userId, session.currentHp);
                await inter.editReply({ content: `💊 Curado totalmente!`, embeds: [], components: [] });
            } else {
                await inter.editReply({ content: `❌ AC insuficiente!`, embeds: [], components: [] });
            }
            await new Promise(r => setTimeout(r, 2000)); session.roomIndex++; return generateRoom(inter, session);
        }
    });

    collector.on('end', (c, r) => { if (r === 'time') i.editReply({ content: '⏳ Tempo esgotado.', components: [] }).catch(()=>{}); });
}

// ---------------------------
// COMBAT SYSTEM (PETS + SKILLS)
// ---------------------------
async function handleCombatAction(inter, session, action, previousLog) {
    let newLog = previousLog ? "\n---" : "O combate começou!";
    const c = session.combat;
    let isDefending = false;

    if (action !== 'start') {
        if (session.cooldowns.skill1 > 0) session.cooldowns.skill1--;
        if (session.cooldowns.skill2 > 0) session.cooldowns.skill2--;
        if (session.cooldowns.petSkill > 0) session.cooldowns.petSkill--;

        let pDmg = 0; let pMultiplier = 1;

        if (session.relics.includes('polvora_instavel')) {
            pMultiplier += 0.3; session.currentHp -= 5; newLog += `\n💣 Pólvora instável tirou 5 HP.`;
        }

        if (action === 'combat_atk') {
            pDmg = Math.max(5, Math.floor(session.baseAtk * (0.8 + Math.random() * 0.4) * pMultiplier));
            newLog += `\n🗡️ Você atacou causando **${pDmg} dano**.`;
        } 
        else if (action === 'skill_1') {
            if (session.char.vocation === 'Mago') { session.cooldowns.skill1 = 2; pDmg = Math.floor(session.baseAtk * 1.8 * pMultiplier); newLog += `\n🔥 **Bola de Fogo!** Causou **${pDmg} dano**!`; }
            else if (session.char.vocation === 'Cavaleiro') { session.cooldowns.skill1 = 3; pDmg = Math.floor(session.baseAtk * 2.2 * pMultiplier); session.buffs.vuln = true; newLog += `\n⚔️ **Golpe Demolidor!** Causa **${pDmg} dano**, guarda aberta!`; }
            else if (session.char.vocation === 'Arqueiro') { session.cooldowns.skill1 = 3; pDmg = Math.floor(session.baseAtk * 1.2 * pMultiplier); session.status.push('poison'); newLog += `\n🏹 **Flecha Venenosa!** ${pDmg} dano!`; }
        }
        else if (action === 'skill_2') {
            if (session.char.vocation === 'Mago') { session.cooldowns.skill2 = 4; pDmg = Math.floor(session.baseAtk * 1.0 * pMultiplier); c.frozen = true; newLog += `\n❄️ **Congelar!** ${pDmg} dano!`; }
            else if (session.char.vocation === 'Cavaleiro') { session.cooldowns.skill2 = 4; session.buffs.wall = true; isDefending = true; newLog += `\n🧱 **Muralha de Escudos!**`; }
            else if (session.char.vocation === 'Arqueiro') { session.cooldowns.skill2 = 3; const isCrit = Math.random() < 0.20; pDmg = Math.floor(session.baseAtk * (isCrit ? 3.0 : 1.0) * pMultiplier); newLog += isCrit ? `\n🎯 **CRÍTICO!** ${pDmg} dano!` : `\n🎯 Tiro comum: ${pDmg} dano.`; }
        }
        else if (action === 'combat_def') {
            isDefending = true; newLog += `\n🛡️ Você se preparou para o impacto!`;
            if (session.healAmt > 0) { session.currentHp = Math.min(session.maxHp, session.currentHp + session.healAmt); newLog += `\n🧚 Seu pet curou **${session.healAmt} HP**.`; }
        } 
        else if (action === 'use_pet') {
            const askill = session.petDef.active_skill;
            session.cooldowns.petSkill = askill.cd;
            newLog += `\n🐾 **COMANDO:** ${askill.msg}`;

            if (askill.type.includes('atk')) {
                pDmg = Math.floor(session.baseAtk * askill.power * pMultiplier);
                newLog += ` (Causou **${pDmg} dano**!)`;
                if (askill.type === 'atk_fire') c.hp -= Math.floor(pDmg * 0.2); // extra tick immediately
                if (askill.type === 'atk_blind') c.blind = true;
            } else if (askill.type === 'heal') {
                const heal = Math.floor(session.maxHp * askill.power);
                session.currentHp = Math.min(session.maxHp, session.currentHp + heal);
                newLog += ` (Curou **${heal} HP**!)`;
            } else if (askill.type === 'def') {
                session.buffs.petDefBlock = true;
            }
        }
        else if (action === 'combat_flee') {
            const fleeDmg = Math.floor(c.atk * 0.5); session.currentHp -= fleeDmg; db.updateHp(session.userId, session.currentHp);
            if (session.currentHp <= 0) return handleDeath(inter, session);
            await inter.editReply({ embeds: [], components: [], content: `🏃 Você fugiu e perdeu **${fleeDmg} HP**!` }).catch(()=>{});
            await new Promise(r => setTimeout(r, 2000)); session.roomIndex++; return generateRoom(inter, session);
        }

        if (pDmg > 0) {
            c.hp -= pDmg;
            if (session.relics.includes('presa_vampiro')) {
                const heal = Math.floor(pDmg * 0.1); session.currentHp = Math.min(session.maxHp, session.currentHp + heal); newLog += `\n🦇 Presa roubou **${heal} HP**!`;
            }
        }

        if (c.hp <= 0) {
            const gainAc = Math.floor(c.maxHp * 0.5 * session.tier.lootMult); session.loot.ac += gainAc;
            if (Math.random() < 0.3) session.loot.mats.push('magic_dust');
            await inter.editReply({ embeds: [], components: [], content: newLog + `\n☠️ O ${c.name} morreu! Você ganhou **${gainAc} AC**!` }).catch(()=>{});
            await new Promise(r => setTimeout(r, 2000)); session.roomIndex++; return generateRoom(inter, session);
        }

        // Enemy Attack
        let eDmg = 0;
        if (c.frozen) {
            newLog += `\n❄️ O ${c.name} está congelado!`; c.frozen = false;
        } else if (c.blind && Math.random() < 0.5) {
            newLog += `\n🦉 O ${c.name} está cego e errou o ataque!`; c.blind = false;
        } else {
            eDmg = Math.floor(c.atk * (0.8 + Math.random() * 0.4));
            if (c.charging) { eDmg *= 3.0; c.charging = false; newLog += `\n💥 **O ${c.name} acerta o ATAQUE DEVASTADOR!**`; }

            if (session.relics.includes('bota_hermes') && Math.random() < 0.15) { newLog += `\n👟 Bota de Hermes esquivou!`; eDmg = 0; }

            if (eDmg > 0) {
                let finalMult = session.defMult + session.buffs.defBuff;
                if (session.buffs.vuln) finalMult *= 0.5;
                eDmg = Math.floor(eDmg / finalMult);

                if (session.buffs.petDefBlock) { eDmg = Math.floor(eDmg * 0.2); newLog += `\n🐢 Casco bloqueou 80%!`; session.buffs.petDefBlock = false; }
                else if (isDefending) { eDmg = Math.floor(eDmg * 0.3); }

                session.currentHp -= eDmg;
                newLog += `\n🩸 ${c.name} causou **${eDmg} dano**!`;

                if (session.buffs.wall && eDmg > 0) { const reflect = Math.floor(eDmg * 0.5); c.hp -= reflect; newLog += `\n🧱 Muralha reflete **${reflect} dano**!`; }
            }
        }

        session.buffs.vuln = false; session.buffs.wall = false;
        db.updateHp(session.userId, session.currentHp);
        
        if (session.currentHp <= 0) return handleDeath(inter, session);
        if (c.hp <= 0) {
            await inter.editReply({ embeds: [], components: [], content: newLog + `\n☠️ O ${c.name} morreu no reflexo!` }).catch(()=>{});
            await new Promise(r => setTimeout(r, 2000)); session.roomIndex++; return generateRoom(inter, session);
        }
    }

    // Prepare Next Turn UI
    if (Math.random() < 0.20 && !c.charging && c.isBoss) {
        c.charging = true; newLog += `\n\n⚠️ **O CHEFE PUXA O FÔLEGO! CUBRA-SE!!**`;
    }

    let embed = new EmbedBuilder().setColor(0xE67E22).setTitle(`⚔️ Combate: ${c.name} ${c.emoji}`)
        .setDescription(newLog).addFields(
            { name: `Seu HP ❤️`, value: `**${Math.floor(session.currentHp)}** / ${session.maxHp}`, inline: true },
            { name: `HP Inimigo 🖤`, value: `**${Math.floor(c.hp)}** / ${c.maxHp}`, inline: true }
        );

    let buttons = [
        new ButtonBuilder().setCustomId('combat_atk').setLabel('Atacar').setEmoji('🗡️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('combat_def').setLabel('Defender').setEmoji('🛡️').setStyle(ButtonStyle.Primary)
    ];

    if (session.char.vocation === 'Mago') {
        buttons.push(new ButtonBuilder().setCustomId('skill_1').setLabel('Bola de Fogo (CD: ' + session.cooldowns.skill1 + ')').setEmoji('🔥').setStyle(ButtonStyle.Success).setDisabled(session.cooldowns.skill1 > 0));
        buttons.push(new ButtonBuilder().setCustomId('skill_2').setLabel('Congelar (CD: ' + session.cooldowns.skill2 + ')').setEmoji('❄️').setStyle(ButtonStyle.Success).setDisabled(session.cooldowns.skill2 > 0));
    } else if (session.char.vocation === 'Cavaleiro') {
        buttons.push(new ButtonBuilder().setCustomId('skill_1').setLabel('Golpe Demolidor (CD: ' + session.cooldowns.skill1 + ')').setEmoji('⚔️').setStyle(ButtonStyle.Success).setDisabled(session.cooldowns.skill1 > 0));
        buttons.push(new ButtonBuilder().setCustomId('skill_2').setLabel('Muralha (CD: ' + session.cooldowns.skill2 + ')').setEmoji('🧱').setStyle(ButtonStyle.Success).setDisabled(session.cooldowns.skill2 > 0));
    } else if (session.char.vocation === 'Arqueiro') {
        buttons.push(new ButtonBuilder().setCustomId('skill_1').setLabel('Flecha Venenosa (CD: ' + session.cooldowns.skill1 + ')').setEmoji('🏹').setStyle(ButtonStyle.Success).setDisabled(session.cooldowns.skill1 > 0));
        buttons.push(new ButtonBuilder().setCustomId('skill_2').setLabel('Tiro na Cabeça (CD: ' + session.cooldowns.skill2 + ')').setEmoji('🎯').setStyle(ButtonStyle.Success).setDisabled(session.cooldowns.skill2 > 0));
    }

    if (session.petDef && session.petDef.active_skill) {
        buttons.push(new ButtonBuilder().setCustomId('use_pet').setLabel(`${session.petDef.active_skill.name} (CD: ${session.cooldowns.petSkill})`).setEmoji('🐾').setStyle(ButtonStyle.Secondary).setDisabled(session.cooldowns.petSkill > 0));
    }

    if (!c.isBoss && buttons.length < 5) buttons.push(new ButtonBuilder().setCustomId('combat_flee').setLabel('Fugir').setEmoji('🏃').setStyle(ButtonStyle.Secondary));

    const row1 = new ActionRowBuilder().addComponents(buttons.slice(0, 5));
    const components = [row1];
    if (buttons.length > 5) components.push(new ActionRowBuilder().addComponents(buttons.slice(5)));

    let msg; try { msg = await inter.editReply({ embeds: [embed], components, content: '' }); } catch(e) { return; }
    const collector = msg.createMessageComponentCollector({ filter: i => i.user.id === session.userId, time: 120000 });
    collector.on('collect', i => { collector.stop(); handleCombatAction(i, session, i.customId, ""); });
}

async function handleDeath(i, session) {
    db.db.prepare('UPDATE rpg_characters SET death_time = ?, current_hp = 0 WHERE discord_id = ?').run(Date.now() + 1800000, session.userId);
    await i.editReply({ embeds: [new EmbedBuilder().setColor(0x000000).setTitle('☠️ VOCÊ MORREU').setDescription(`Pereceu na Sala ${session.roomIndex}.`)], components: [], content: '' }).catch(()=>{});
}

async function handleVictory(i, session) {
    if (session.loot.ac > 0) db.addCoins(session.userId, session.loot.ac);
    for (const mat of session.loot.mats) db.addMaterial(session.userId, mat, 1);
    
    let droppedEquip = null;
    if (session.tier.equipDrops && session.tier.equipDrops.length > 0 && Math.random() < 0.15) {
        const dropId = session.tier.equipDrops[Math.floor(Math.random() * session.tier.equipDrops.length)];
        const rpgItems = require('./rpgItems').RPG_ITEMS;
        if (rpgItems[dropId]) { db.addInventoryItem(session.userId, dropId, 1); droppedEquip = rpgItems[dropId]; }
    }

    let matText = session.loot.mats.length > 0 ? session.loot.mats.join(', ') : 'Nenhum';
    let desc = `**Seus Tesouros:**\n💰 ${session.loot.ac} AC\n🎒 Materiais: ${matText}`;
    if (droppedEquip) desc += `\n\n🎁 **DROP ÉPICO!** Vocę encontrou: **${droppedEquip.name}**!`;

    await i.editReply({ embeds: [new EmbedBuilder().setColor(0xF1C40F).setTitle('🎉 MASMORRA CONCLUÍDA!').setDescription(desc)], components: [], content: '' }).catch(()=>{});
}

module.exports = { startDungeon };
