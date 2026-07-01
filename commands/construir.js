'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const state = require('../modules/state');
const db = require('../modules/database');
const cityInvasions = require('../modules/cityInvasions');

module.exports = {
    name: 'construir',
    aliases: ['build', 'cerco'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('construir')
        .setDescription('Constrói defesas de cerco durante uma Invasão do Bastião!')
        .addStringOption(opt => opt.setName('tipo')
            .setDescription('O tipo de máquina de cerco')
            .setRequired(true)
            .addChoices(
                { name: 'Barricada (Cura Portões)', value: 'barricada' },
                { name: 'Catapulta (Dano em Área)', value: 'catapulta' }
            )
        ),

    async execute(msg, args) {
        if (args.length < 1) {
            return msg.channel.send('❌ Uso correto: `!construir barricada` ou `!construir catapulta`');
        }
        return handleConstruir(msg.author.id, msg.channel, args[0].toLowerCase(), msg.client, null, msg);
    },

    async executeSlash(interaction) {
        const type = interaction.options.getString('tipo');
        return handleConstruir(interaction.user.id, interaction.channel, type, interaction.client, interaction, null);
    }
};

async function handleConstruir(userId, channel, type, client, interaction, msg) {
    const invasion = state.activeInvasion;
    
    // Validar se há invasão e se é cerco
    if (!invasion || !invasion.isSiege) {
        const err = '❌ Não há nenhuma Invasão de Cerco acontecendo no momento!';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }

    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = '🚫 Você precisa de um personagem RPG para construir defesas (`/rpg-registrar`).';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }

    let woodCost = 0;
    let ironCost = 0;
    
    if (type === 'barricada') {
        woodCost = 3;
        ironCost = 1;
    } else if (type === 'catapulta') {
        woodCost = 2;
        ironCost = 3;
    } else {
        const err = '❌ Tipo inválido! Tente `barricada` ou `catapulta`.';
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }

    // Checar inventário
    const userWood = db.getMaterialQty(userId, 'wood_log');
    const userIron = db.getMaterialQty(userId, 'iron_ore');

    if (userWood < woodCost || userIron < ironCost) {
        const err = `🧱 **Recursos Insuficientes!**\nPara construir **${type}** você precisa de:\n🪵 **${woodCost}x Tora de Madeira** (Você tem ${userWood})\n🪨 **${ironCost}x Minério de Ferro** (Você tem ${userIron})`;
        if (interaction) return interaction.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }

    // Deduzir recursos
    db.removeMaterial(userId, 'wood_log', woodCost);
    db.removeMaterial(userId, 'iron_ore', ironCost);

    let replyText = '';

    if (type === 'barricada') {
        const heal = 5000 + Math.floor(Math.random() * 2000);
        invasion.gateHp = Math.min(invasion.maxGateHp, invasion.gateHp + heal);
        replyText = `🛡️ <@${userId}> gastou recursos valiosos e ergueu uma forte **BARRICADA**! O Portão da Cidade recuperou **${heal} HP**!`;
    } else if (type === 'catapulta') {
        const damage = 15000 + Math.floor(Math.random() * 5000);
        invasion.hp -= damage;
        replyText = `☄️ <@${userId}> finalizou a construção de uma **CATAPULTA** e disparou uma rocha flamejante no exército inimigo causando impressionantes **${damage} de dano**!`;
        
        // Atribui esse dano à leaderboard do player pra ele ganhar AC
        if (!invasion.players[userId]) {
            invasion.players[userId] = { name: char.nickname || 'Desconhecido', damage: 0, lastAttack: 0 };
        }
        invasion.players[userId].damage += damage;
    }

    // Enviar mensagem
    if (interaction) {
        await interaction.reply({ content: replyText });
    } else {
        await channel.send({ content: replyText });
    }

    // Tentar atualizar a mensagem global
    if (typeof cityInvasions.updateInvasionMessage === 'function') {
        if (invasion.hp <= 0) {
            // Se morreu com catapulta, simulamos um ataque vazio para desencadear a vitória
            await cityInvasions.handleInvasionAttack(client.user.id, channel, channel.guild, client);
        } else {
            cityInvasions.updateInvasionMessage(client);
        }
    }
}
