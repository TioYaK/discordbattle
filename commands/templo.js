'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const db = require('../modules/database');

module.exports = {
    name: 'templo',
    aliases: ['temple', 'curar', 'heal', 'revive'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('templo')
        .setDescription('Visite o Templo para restaurar sua vida ou reviver após a morte.'),

    async execute(msg) {
        return handleTemplo(msg.author.id, msg.channel);
    },

    async executeSlash(interaction) {
        await interaction.deferReply();
        return handleTemplo(interaction.user.id, interaction.channel, interaction);
    }
};

async function handleTemplo(userId, channel, interaction = null) {
    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = '🚫 Você precisa de um personagem RPG para visitar o Templo! Use `/rpg-registrar`.';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const reg = db.getRegisteredMember(userId);
    const coins = reg ? reg.coins : 0;

    const now = Date.now();
    const isDead = char.death_time && char.death_time > 0 && (now - char.death_time < 60 * 60 * 1000);
    const maxHp = (char.level || 1) * 50 + 100;
    const currentHp = (char.current_hp === -1 || char.current_hp === undefined || char.current_hp === null) ? maxHp : char.current_hp;

    let embed = new EmbedBuilder()
        .setTitle('⛪ Templo de Aethelgard')
        .setFooter({ text: 'Aethelgard RPG' })
        .setTimestamp();

    if (isDead) {
        const remaining = Math.ceil((60 * 60 * 1000 - (now - char.death_time)) / 60000);
        const reviveCost = (char.level || 1) * 100;

        embed.setColor(0x8E44AD)
            .setDescription(`**${char.nickname}**, seu espírito está vagando pelas sombras.\n\nVocê voltará à vida naturalmente em **${remaining} minutos**.\nSe desejar, os monges podem acelerar sua ressurreição por uma doação de **${reviveCost} AC**.`);

        const reviveBtn = new ButtonBuilder()
            .setCustomId('templo_revive')
            .setLabel(`Ressuscitar (${reviveCost} AC)`)
            .setEmoji('✨')
            .setStyle(ButtonStyle.Success);
            
        const row = new ActionRowBuilder().addComponents(reviveBtn);
        
        let response;
        if (interaction) {
            response = await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
        } else {
            response = await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
        }

        const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
        collector.on('collect', async i => {
            if (i.user.id !== userId) return i.reply({ content: 'Você não pode usar isso!', ephemeral: true });
            
            const currentReg = db.getRegisteredMember(userId);
            if (currentReg.coins < reviveCost) {
                return i.reply({ content: `❌ Você não tem moedas suficientes! Você precisa de **${reviveCost} AC**, mas só tem **${currentReg.coins} AC**.`, ephemeral: true });
            }

            db.removeCoins(userId, reviveCost);
            db.db.prepare('UPDATE rpg_characters SET death_time = 0, current_hp = ? WHERE discord_id = ?').run(maxHp, userId);

            const successEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('✨ Ressurreição Completa!')
                .setDescription(`Os monges entoaram cânticos antigos e sua alma retornou ao seu corpo!\n\nVocê está com **${maxHp}/${maxHp} HP** e pronto para batalhar novamente! (Custo: ${reviveCost} AC)`);
            
            await i.update({ embeds: [successEmbed], components: [] });
            collector.stop();
        });
        
    } else {
        // Alive, check if needs heal
        if (currentHp >= maxHp) {
            embed.setColor(0x3498DB)
                .setDescription(`**${char.nickname}**, você já está com a vida cheia! (**${maxHp}/${maxHp} HP**)\nOs monges te abençoam para sua próxima jornada.`);
            if (interaction) return interaction.editReply({ embeds: [embed] }).catch(() => {});
            return channel.send({ embeds: [embed] }).catch(() => {});
        }

        const missingHp = maxHp - currentHp;
        // Cost: 1 AC per 5 HP missing, minimum 10 AC
        const healCost = Math.max(10, Math.ceil(missingHp / 5));

        embed.setColor(0x3498DB)
            .setDescription(`**${char.nickname}**, você está ferido (**${currentHp}/${maxHp} HP**).\n\nOs monges podem curar completamente seus ferimentos por uma doação de **${healCost} AC**.`);

        const healBtn = new ButtonBuilder()
            .setCustomId('templo_heal')
            .setLabel(`Curar Tudo (${healCost} AC)`)
            .setEmoji('❤️')
            .setStyle(ButtonStyle.Success);
            
        const row = new ActionRowBuilder().addComponents(healBtn);

        let response;
        if (interaction) {
            response = await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
        } else {
            response = await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
        }

        const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
        collector.on('collect', async i => {
            if (i.user.id !== userId) return i.reply({ content: 'Você não pode usar isso!', ephemeral: true });
            
            const currentReg = db.getRegisteredMember(userId);
            if (currentReg.coins < healCost) {
                return i.reply({ content: `❌ Você não tem moedas suficientes! Você precisa de **${healCost} AC**.`, ephemeral: true });
            }

            db.removeCoins(userId, healCost);
            db.updateHp(userId, maxHp);

            const successEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('❤️ Cura Completa!')
                .setDescription(`Suas feridas foram totalmente curadas!\n\nVocê está com **${maxHp}/${maxHp} HP** e pronto para batalhar novamente! (Custo: ${healCost} AC)`);
            
            await i.update({ embeds: [successEmbed], components: [] });
            collector.stop();
        });
    }
}
