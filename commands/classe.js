'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../modules/database');

module.exports = {
    name: 'classe',
    aliases: ['vocation', 'promover', 'classes'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('classe')
        .setDescription('Escolha sua vocação ao atingir o Nível 10.'),

    async execute(msg) {
        return handleClassCommand(msg.author.id, msg.channel);
    },

    async executeSlash(interaction) {
        return handleClassCommand(interaction.user.id, interaction.channel, interaction);
    }
};

async function handleClassCommand(userId, channel, interaction = null) {
    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = '🚫 Você precisa de um personagem RPG! Use `/rpg-registrar`.';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send({ content: err });
    }

    if (char.vocation !== 'None' && char.vocation) {
        let emoji = '🔰';
        if (char.vocation === 'Cavaleiro') emoji = '🛡️';
        if (char.vocation === 'Mago') emoji = '🧙‍♂️';
        if (char.vocation === 'Arqueiro') emoji = '🏹';

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle(`🎓 Vocação de ${char.nickname}`)
            .setDescription(`Você já é um **${emoji} ${char.vocation}**!\nVocê honra sua classe no campo de batalha.`);
        
        if (interaction) return interaction.reply({ embeds: [embed] });
        return channel.send({ embeds: [embed] });
    }

    if ((char.level || 1) < 10) {
        const err = '❌ Você ainda é muito inexperiente! Alcance o **Nível 10** nas caçadas para poder escolher uma classe.';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send({ content: err });
    }

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🔮 A Escolha do Destino')
        .setDescription('Você alcançou poder suficiente para se especializar. Escolha o seu caminho sábia e permanentemente:\n\n' +
            '🛡️ **Cavaleiro:** Focado em sobrevivência. Ganha +20% HP Máximo e +30% Defesa.\n' +
            '🧙‍♂️ **Mago:** Focado em destruição. Ganha +30% Dano Mágico, mas perde -20% do HP Máximo.\n' +
            '🏹 **Arqueiro:** Focado em caça. Ganha +15% de Dano e +10% na chance de achar materiais!');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('class_knight').setLabel('Cavaleiro').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('class_mage').setLabel('Mago').setEmoji('🧙‍♂️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('class_archer').setLabel('Arqueiro').setEmoji('🏹').setStyle(ButtonStyle.Success)
    );

    let msg;
    if (interaction) {
        msg = await interaction.reply({ embeds: [embed], components: [row] });
    } else {
        msg = await channel.send({ embeds: [embed], components: [row] });
    }

    const filter = i => i.user.id === userId;
    const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async i => {
        let chosen = '';
        if (i.customId === 'class_knight') chosen = 'Cavaleiro';
        if (i.customId === 'class_mage') chosen = 'Mago';
        if (i.customId === 'class_archer') chosen = 'Arqueiro';

        db.db.prepare('UPDATE rpg_characters SET vocation = ? WHERE discord_id = ?').run(chosen, userId);

        const confirmEmbed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('✨ Promoção Alcançada!')
            .setDescription(`Parabéns! Você se tornou um glorioso **${chosen}**!\nSeus atributos serão ajustados na próxima batalha.`);

        await i.update({ embeds: [confirmEmbed], components: [] });
        collector.stop();
    });
}
