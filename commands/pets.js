'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../modules/database');
const { RPG_PETS, getRandomPetId } = require('../modules/rpgPets');

const EGG_COSTS = {
    'common': 1000,
    'rare': 2500,
    'epic': 5000
};

module.exports = {
    name: 'pets',
    aliases: ['pet', 'ovos', 'chocar'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('pets')
        .setDescription('Gerencie seus Pets e Ovos Misteriosos'),

    async execute(msg) {
        return handlePetsCommand(msg.author.id, msg.channel);
    },

    async executeSlash(interaction) {
        await interaction.deferReply();
        return handlePetsCommand(interaction.user.id, interaction.channel, interaction);
    }
};

async function handlePetsCommand(userId, channel, interaction = null) {
    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = '🚫 Você precisa de um personagem RPG para ter Pets! Use `/rpg-registrar`.';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const reg = db.getRegisteredMember(userId);
    const coins = reg ? reg.coins : 0;

    const eggs = db.getEggs(userId);
    const pets = db.getPets(userId);
    const activePetRow = db.getActivePet(userId);
    let activePetDef = activePetRow ? RPG_PETS[activePetRow.pet_id] : null;

    let embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`🐾 Companheiros de ${char.nickname}`)
        .setDescription(`Os Pets te acompanham nas batalhas dando bônus passivos essenciais!\n\n🪙 **Seu Saldo:** ${coins.toFixed(0)} AC`);

    let canEvolve = false;
    let evolveTo = null;

    if (activePetDef) {
        const lvl = activePetRow.level || 1;
        const xp = activePetRow.xp || 0;
        const nextXp = 50 * lvl;
        
        embed.addFields({ name: '🌟 Pet Ativo', value: `${activePetDef.emoji} **${activePetDef.name}** (Nível ${lvl})\n*Efeito: ${activePetDef.desc}*\n**XP:** ${xp}/${nextXp}`, inline: false });
        
        if (activePetDef.evolvesTo && lvl >= activePetDef.evolvesAt) {
            canEvolve = true;
            evolveTo = RPG_PETS[activePetDef.evolvesTo];
        }
    } else {
        embed.addFields({ name: '🌟 Pet Ativo', value: 'Nenhum companheiro equipado.', inline: false });
    }

    let eggCountStr = '';
    const eggCounts = { common: 0, rare: 0, epic: 0 };
    eggs.forEach(e => eggCounts[e.rarity]++);
    if (eggCounts.common > 0) eggCountStr += `🥚 Ovo Comum: **${eggCounts.common}**\n`;
    if (eggCounts.rare > 0) eggCountStr += `🥚 Ovo Raro: **${eggCounts.rare}**\n`;
    if (eggCounts.epic > 0) eggCountStr += `🥚 Ovo Épico: **${eggCounts.epic}**\n`;

    embed.addFields({ name: '🎒 Ovos no Inventário', value: eggCountStr || 'Nenhum ovo encontrado.', inline: false });

    let costCommon = EGG_COSTS.common;
    let costRare = EGG_COSTS.rare;
    let costEpic = EGG_COSTS.epic;

    if (char.profession === 'Domador') {
        costCommon = Math.floor(costCommon / 2);
        costRare = Math.floor(costRare / 2);
        costEpic = Math.floor(costEpic / 2);
    }

    // Build interactive rows
    const rowButtons = new ActionRowBuilder();
    if (canEvolve && evolveTo) {
        rowButtons.addComponents(new ButtonBuilder().setCustomId('evolve_pet').setLabel(`Evoluir para ${evolveTo.name}`).setEmoji('✨').setStyle(ButtonStyle.Success));
    }
    if (eggCounts.common > 0) {
        rowButtons.addComponents(new ButtonBuilder().setCustomId('hatch_common').setLabel(`Chocar Comum (${costCommon} AC)`).setEmoji('🥚').setStyle(ButtonStyle.Success));
    }
    if (eggCounts.rare > 0) {
        rowButtons.addComponents(new ButtonBuilder().setCustomId('hatch_rare').setLabel(`Chocar Raro (${costRare} AC)`).setEmoji('🥚').setStyle(ButtonStyle.Primary));
    }
    if (eggCounts.epic > 0) {
        rowButtons.addComponents(new ButtonBuilder().setCustomId('hatch_epic').setLabel(`Chocar Épico (${costEpic} AC)`).setEmoji('🥚').setStyle(ButtonStyle.Danger));
    }

    let rowSelect = null;
    if (pets.length > 0) {
        const options = pets.map(p => {
            const def = RPG_PETS[p.pet_id];
            return {
                label: def.name,
                description: def.desc.substring(0, 50),
                value: p.pet_id,
                emoji: def.emoji
            };
        });
        
        rowSelect = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('equip_pet')
                .setPlaceholder('Escolha um Pet para Equipar')
                .addOptions(options.slice(0, 25))
        );
    }

    const components = [];
    if (rowSelect) components.push(rowSelect);
    if (rowButtons.components.length > 0) components.push(rowButtons);

    let msg;
    if (interaction) {
        msg = await interaction.editReply({ embeds: [embed], components }).catch(() => {});
    } else {
        msg = await channel.send({ embeds: [embed], components }).catch(() => {});
    }

    const filter = i => i.user.id === userId;
    const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async i => {
        const currentReg = db.getRegisteredMember(userId);
        
        if (i.customId.startsWith('hatch_')) {
            const rarity = i.customId.split('_')[1];
            let cost = EGG_COSTS[rarity];
            if (char.profession === 'Domador') {
                cost = Math.floor(cost / 2);
            }

            // Pega o primeiro ovo daquela raridade
            const userEggs = db.getEggs(userId);
            const targetEgg = userEggs.find(e => e.rarity === rarity);

            if (!targetEgg) return i.reply({ content: 'Você não tem esse ovo!', ephemeral: true });
            if (currentReg.coins < cost) return i.reply({ content: `❌ Você não tem moedas suficientes! Você precisa de **${cost} AC** para pagar a encubadora.`, ephemeral: true });

            // Hatch Process
            db.removeCoins(userId, cost);
            db.removeEgg(targetEgg.id);
            
            const newPetId = getRandomPetId(rarity);
            db.addPet(userId, newPetId);
            db.progressQuest(userId, 'hatch', 1);
            
            const newDef = RPG_PETS[newPetId];

            const hatchEmbed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setTitle('✨ UM OVO ESTÁ CHOCANDO!')
                .setDescription(`O ovo tremeu e se rompeu...\n\n**Você obteve o Companheiro:**\n${newDef.emoji} **${newDef.name}**!\n*(Raridade: ${newDef.rarity.toUpperCase()})*\n\nAbra o \`!pets\` novamente para equipá-lo!`);

            await i.update({ embeds: [hatchEmbed], components: [] });
            collector.stop();
        }
        else if (i.customId === 'equip_pet') {
            const petId = i.values[0];
            db.setActivePet(userId, petId);
            const def = RPG_PETS[petId];

            const equipEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('🐾 Pet Equipado!')
                .setDescription(`O ${def.emoji} **${def.name}** agora está ao seu lado e te dará: **${def.desc}** nas batalhas!`);

            await i.update({ embeds: [equipEmbed], components: [] });
            collector.stop();
        }
        else if (i.customId === 'evolve_pet') {
            if (!canEvolve || !evolveTo || !activePetRow) return;
            
            // Transform the pet
            db.db.prepare('UPDATE player_pets SET pet_id = ?, level = 1, xp = 0 WHERE id = ?').run(evolveTo.id, activePetRow.id);
            
            const evolveEmbed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('✨ EVOLUÇÃO COMPLETA! ✨')
                .setDescription(`Seu pet irradiou uma luz ofuscante e se transformou!\n\n**Novo Companheiro:**\n${evolveTo.emoji} **${evolveTo.name}**\n*Efeito Passivo:* ${evolveTo.desc}\n\n*O nível dele foi resetado, mas ele agora possui um poder oculto devastador nas Caçadas de Elite.*`);
                
            await i.update({ embeds: [evolveEmbed], components: [] });
            collector.stop();
        }
    });
}
