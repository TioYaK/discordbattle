'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const { getPlayerTotalAtk } = require('../modules/cityInvasions');
const rpgItems = require('../modules/rpgItems');

// Cooldown de 10 minutos
const HUNT_COOLDOWN_MS = 10 * 60 * 1000;

// Monstros genéricos para a caça (recompensas reduzidas para cooldown menor)
const HUNT_MONSTERS = [
    { name: 'Goblin Ladrão', minLvl: 1, hp: 50, atk: 5, emoji: '👺', ac: [2, 5], xp: [5, 10], dropId: 'goblin_ear', dropChance: 0.40 },
    { name: 'Lobo Selvagem', minLvl: 2, hp: 80, atk: 8, emoji: '🐺', ac: [5, 10], xp: [8, 15], dropId: 'wolf_pelt', dropChance: 0.40 },
    { name: 'Bandido', minLvl: 5, hp: 150, atk: 15, emoji: '🦹‍♂️', ac: [10, 20], xp: [15, 25], dropId: 'iron_ore', dropChance: 0.30 },
    { name: 'Orc Guerreiro', minLvl: 10, hp: 300, atk: 30, emoji: '🧌', ac: [20, 40], xp: [25, 50], dropId: 'wood_log', dropChance: 0.30 },
    { name: 'Minotauro', minLvl: 20, hp: 600, atk: 50, emoji: '🐂', ac: [40, 75], xp: [50, 100], dropId: 'iron_ore', dropChance: 0.60 },
    { name: 'Dragão Jovem', minLvl: 35, hp: 1200, atk: 100, emoji: '🐉', ac: [75, 150], xp: [125, 200], dropId: 'dragon_scale', dropChance: 0.20 },
    { name: 'Demon', minLvl: 50, hp: 2500, atk: 250, emoji: '😈', ac: [150, 300], xp: [250, 400], dropId: 'demon_horn', dropChance: 0.20 }
];

module.exports = {
    name: 'cacar',
    aliases: ['caçar', 'hunt'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('cacar')
        .setDescription('Sai para uma caçada solo e tenta derrotar um monstro (Cooldown de 10m)'),

    async execute(msg) {
        return handleHunt(msg.author.id, msg.channel);
    },

    async executeSlash(interaction) {
        await interaction.deferReply();
        return handleHunt(interaction.user.id, interaction.channel, interaction);
    }
};

async function handleHunt(userId, channel, interaction = null) {
    // 1. Checagens de registro
    const reg = db.getRegisteredMember(userId);
    if (!reg) {
        const err = '🚫 Você precisa se registrar com `/registro` para poder caçar.';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = '🚫 Você precisa de um personagem RPG para caçar! Use `/rpg-registrar`.';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const now = Date.now();
    // 1.5 Death Check
    if (char.death_time && char.death_time > 0) {
        const timeSinceDeath = now - char.death_time;
        if (timeSinceDeath < 60 * 60 * 1000) {
            const remaining = Math.ceil((60 * 60 * 1000 - timeSinceDeath) / 60000);
            const err = `💀 Você está morto e não pode caçar! Aguarde **${remaining} minutos** ou visite o \`!templo\`.`;
            if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
            return channel.send({ content: err }).catch(() => {});
        } else {
            const maxHp = db.getPlayerMaxHp(char);
            db.db.prepare('UPDATE rpg_characters SET death_time = 0, current_hp = ? WHERE discord_id = ?').run(maxHp, userId);
            char.death_time = 0;
            char.current_hp = maxHp;
        }
    }

    // 2. Cooldown
    const lastHunt = db.getConfig(`lastHunt_${userId}`) || 0;
    const diff = now - lastHunt;

    if (diff < HUNT_COOLDOWN_MS) {
        const remaining = Math.ceil((HUNT_COOLDOWN_MS - diff) / 60000);
        const err = `⏳ Você está descansando da última caçada. Tente novamente em **${remaining} minutos**.`;
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    // 3. Escolher monstro baseado no level
    const playerLevel = char.level || 1;
    const possibleMonsters = HUNT_MONSTERS.filter(m => m.minLvl <= playerLevel);
    
    // Tende a pegar monstros mais fortes se o level permitir
    const weights = possibleMonsters.map((m, idx) => idx + 1); 
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalWeight;
    let selectedMonster = possibleMonsters[0];
    for (let i = 0; i < possibleMonsters.length; i++) {
        rand -= weights[i];
        if (rand <= 0) {
            selectedMonster = possibleMonsters[i];
            break;
        }
    }

    // 4. Lógica de Combate
    const playerAtk = getPlayerTotalAtk(char);
    const maxHp = (char.level || 1) * 50 + 100;
    let currentHp = (char.current_hp === -1 || char.current_hp === undefined || char.current_hp === null) ? maxHp : char.current_hp;
    
    let monsterHp = selectedMonster.hp;

    // Simulação rápida (3 turnos)
    let victory = true;
    for (let turn = 0; turn < 3; turn++) {
        const pDmg = Math.floor(playerAtk * (0.8 + Math.random() * 0.4));
        monsterHp -= pDmg;
        if (monsterHp <= 0) break;

        const mDmg = Math.floor(selectedMonster.atk * (0.8 + Math.random() * 0.4));
        currentHp -= mDmg;
        if (currentHp <= 0) {
            victory = false;
            break;
        }
    }

    if (currentHp < 0) currentHp = 0;
    db.updateHp(userId, currentHp);

    // Marca o cooldown
    db.setConfig(`lastHunt_${userId}`, now);

    if (!victory) {
        const deathInfo = db.handleDeath(userId);
        let deathText = `Você encontrou um **${selectedMonster.name}** ${selectedMonster.emoji}, mas seus ferimentos foram muito graves e você **MORREU** na batalha!\n\nVocê perdeu **${deathInfo.xpLost} XP** como penalidade.`;
        if (deathInfo.levelDropped) {
            deathText += `\n📉 Você foi rebaixado para o **Nível ${deathInfo.levelDropped}**.`;
        }
        deathText += '\n\nVisite o \`!templo\` para ser ressuscitado ou aguarde 1 hora.';

        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle('💀 MORTE EM BATALHA!')
            .setDescription(deathText)
            .setFooter({ text: 'Aethelgard Hunts' });

        if (interaction) return interaction.editReply({ embeds: [embed] }).catch(() => {});
        return channel.send({ content: `<@${userId}>`, embeds: [embed] }).catch(() => {});
    }

    // 5. Vitória (Recompensas)
    const acGain = Math.floor(Math.random() * (selectedMonster.ac[1] - selectedMonster.ac[0])) + selectedMonster.ac[0];
    const xpGain = Math.floor(Math.random() * (selectedMonster.xp[1] - selectedMonster.xp[0])) + selectedMonster.xp[0];

    db.addCoins(userId, acGain);
    const lvlUp = db.addRpgXp(userId, xpGain);
    db.progressQuest(userId, 'hunt', 1);
    db.addGuildXp(userId, Math.floor(xpGain / 2), null);

    let dropText = '';
    // Phase 6: Material Drops
    // Chance de dropar a Chave da Masmorra (maior chance em monstros mais fortes)
    const keyChance = Math.min(0.15, selectedMonster.minLvl * 0.002); // ex: level 50 = 10% chance
    if (Math.random() < keyChance) {
        db.addMaterial(userId, 'dungeon_key_1', 1);
        dropText += `\n🗝️ **GOTA RARA:** O monstro derrubou uma **Chave de Masmorra (Cobre)**!`;
    }

    let dropMult = 1;
    let xpMult = 1;

    // Phase 9: Vocation Buffs
    if (char.vocation === 'Arqueiro') dropMult += 0.10;

    // Milestone 2: Profession Buffs
    if (char.profession === 'Domador') dropMult += 0.30; // Domador ganha +30% na chance de achar ovos e loots

    // Phase 8: Pet Buffs
    const activePet = db.getActivePet(userId);
    const petDef = activePet ? require('../modules/rpgPets').RPG_PETS[activePet.pet_id] : null;
    
    if (petDef && petDef.buff === 'drop') dropMult += petDef.value;
    if (petDef && petDef.buff === 'xp') xpMult += petDef.value;

    const eggChance = Math.min(0.05, selectedMonster.minLvl * 0.001) * dropMult; // max 5% chance
    if (Math.random() < eggChance) {
        const rarity = selectedMonster.minLvl >= 35 ? 'rare' : 'common';
        db.addEgg(userId, rarity);
        dropText += `\n🥚 **GOTA ÉPICA:** O monstro derrubou um **Ovo Misterioso (${rarity})**!`;
    }

    if (selectedMonster.dropId && Math.random() < (selectedMonster.dropChance * dropMult)) {
        db.addMaterial(userId, selectedMonster.dropId, 1);
        const materials = require('../modules/rpgMaterials');
        const matDef = materials[selectedMonster.dropId];
        dropText += `\n🎒 **Loot de Caça:** Você obteve **1x ${matDef.name}** ${matDef.emoji}`;
    }

    // 3% chance de drop raro
    if (Math.random() < 0.03) {
        const itemKeys = Object.keys(rpgItems);
        const randomItem = rpgItems[itemKeys[Math.floor(Math.random() * itemKeys.length)]];
        db.addInventoryItem(userId, randomItem.id, 1);
        dropText = `\n🎁 **LOOT RARO!** Você encontrou um(a) **${randomItem.name}**!`;
    }

    const petLvlUp = db.addPetXp(userId, xpGain);
    
    let lvlUpText = lvlUp?.leveledUp ? `\n🎉 **Nível UP!** Você alcançou o Nível **${lvlUp.level}**!` : '';
    if (petLvlUp && petLvlUp.leveledUp) {
        lvlUpText += `\n🐾 **Pet Nível UP!** Seu pet alcançou o Nível **${petLvlUp.newLevel}**!`;
    }

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🏹 Caçada Bem-Sucedida!')
        .setDescription(`Você rastreou e derrotou um **${selectedMonster.name}** ${selectedMonster.emoji} com maestria!\n\n**Recompensas:**\n🪙 **+${acGain} AC**\n✨ **+${xpGain} RPG XP**${lvlUpText}${dropText}`)
        .setFooter({ text: 'Aethelgard Hunts • Próxima caça em 10 minutos' });

    if (interaction) return interaction.editReply({ embeds: [embed] }).catch(() => {});
    return channel.send({ content: `<@${userId}>`, embeds: [embed] }).catch(() => {});
}
