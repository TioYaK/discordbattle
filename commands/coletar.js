'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const materials = require('../modules/rpgMaterials');

module.exports = {
    name: 'coletar',
    aliases: ['minerar', 'lenhar', 'collect', 'mine'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('coletar')
        .setDescription('Gasta Stamina para tentar coletar recursos primários (Minério, Madeira, etc)'),

    async execute(msg) {
        return handleCollect(msg.author.id, msg.channel);
    },

    async executeSlash(interaction) {
        return handleCollect(interaction.user.id, interaction.channel, interaction);
    }
};

async function handleCollect(userId, channel, interaction = null) {
    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = '🚫 Você precisa de um personagem RPG para coletar recursos! Use `/rpg-registrar`.';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send({ content: err });
    }

    if (char.death_time && char.death_time > 0) {
        const err = '💀 Você está morto e não pode trabalhar!';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send({ content: err });
    }

    const currentStamina = char.stamina !== undefined ? char.stamina : 100;
    const STAMINA_COST = 10;

    if (currentStamina < STAMINA_COST) {
        const err = '💦 Você está exausto! Você não tem Stamina suficiente para coletar materiais agora (Requer 10). Sua Stamina regenera automaticamente com o tempo.';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send({ content: err });
    }

    // Deduct stamina
    db.updateStamina(userId, currentStamina - STAMINA_COST);

    // Roll for materials
    const rand = Math.random();
    let foundMaterial = null;
    let qty = 1;

    // Erva Medicinal has a ~15% chance
    if (rand < 0.15) {
        foundMaterial = materials.medicinal_herb;
        qty = Math.floor(Math.random() * 2) + 1;
    } else if (rand < 0.45) {
        foundMaterial = materials.iron_ore;
        qty = Math.floor(Math.random() * 3) + 1;
    } else if (rand < 0.75) {
        foundMaterial = materials.wood_log;
        qty = Math.floor(Math.random() * 3) + 1;
    } else if (rand < 0.95) {
        foundMaterial = materials.magic_dust;
        qty = 1;
    } else {
        // 5% de falhar e não achar nada
        const failEmbed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setTitle('⛏️ Coleta Infrutífera')
            .setDescription(`Você procurou por recursos, mas não encontrou nada de útil desta vez...\n\n💦 Stamina restante: **${currentStamina - STAMINA_COST}/100**`);
        
        if (interaction) return interaction.reply({ embeds: [failEmbed] });
        return channel.send({ content: `<@${userId}>`, embeds: [failEmbed] });
    }

    // Ferreiro Bônus
    let extraLog = '';
    if (char.profession === 'Ferreiro' && (foundMaterial.id === 'iron_ore' || foundMaterial.id === 'wood_log')) {
        qty *= 2;
        extraLog = '\n🔨 *Bônus de Ferreiro: Quantidade Dobrada!*';
    }

    // Add material
    db.addMaterial(userId, foundMaterial.id, qty);

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('⛏️ Coleta Bem-Sucedida!')
        .setDescription(`Você trabalhou duro e coletou recursos valiosos!\n\n**+${qty}x ${foundMaterial.name} ${foundMaterial.emoji}**${extraLog}\n\n💦 Stamina restante: **${currentStamina - STAMINA_COST}/100**`);

    if (interaction) return interaction.reply({ embeds: [embed] });
    return channel.send({ content: `<@${userId}>`, embeds: [embed] });
}
