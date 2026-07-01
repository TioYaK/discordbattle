'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');

// Standard Tibia daily boss cooldown: 20 hours in milliseconds
const BOSS_COOLDOWN_MS = 20 * 60 * 60 * 1000;

// Common boss mappings for convenience/formatting
const BOSS_MAP = {
    'scarlett': 'Scarlett Etzel',
    'scarlet': 'Scarlett Etzel',
    'oberon': 'Grand Master Oberon',
    'drume': 'Drume',
    'timira': 'Timira',
    'zelos': 'King Zelos',
    'bakragore': 'Bakragore',
    'ferumbras': 'Ferumbras Mortalis',
    'leopold': 'Grand Canon Dominus',
    'faceless': 'Faceless Bane',
};

function formatBossName(input) {
    const key = input.toLowerCase().trim();
    if (BOSS_MAP[key]) return BOSS_MAP[key];
    
    // Capitalize each word if custom
    return input.split(/\s+/).map(word => {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
}

module.exports = {
    name: 'boss',
    aliases: ['bosstimer', 'matouboss'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('boss')
        .setDescription('Registra que você matou um boss diário para marcar o cooldown de 20h')
        .addStringOption(option =>
            option.setName('nome')
                .setDescription('Nome do boss (Ex: Scarlett, Oberon, Drume)')
                .setRequired(true)
        ),

    async execute(msg, args) {
        if (!args.length) {
            return msg.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('❌ Uso Incorreto')
                        .setDescription('Você precisa informar o nome do boss. Ex: `!boss Scarlett`')
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                ]
            });
        }

        const rawName = args.join(' ');
        const bossName = formatBossName(rawName);
        
        db.addBossCooldown(msg.author.id, bossName, BOSS_COOLDOWN_MS);

        const expiresAt = Date.now() + BOSS_COOLDOWN_MS;
        const expiresTimeStr = new Date(expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const embed = new EmbedBuilder()
            .setColor(0x44FF88)
            .setTitle('⏳ Cooldown de Boss Marcado')
            .setDescription(`Seu cooldown para o boss **${bossName}** foi registrado com sucesso!\n\n` +
                             `🔔 **Vou te avisar por DM privada** assim que expirar.`)
            .addFields(
                { name: '⏰ Expira em', value: '20 horas', inline: true },
                { name: '📅 Disponível às', value: `\`${expiresTimeStr}\` de amanhã`, inline: true }
            )
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        return msg.channel.send({ embeds: [embed] });
    },

    async executeSlash(interaction) {
        const rawName = interaction.options.getString('nome');
        const bossName = formatBossName(rawName);

        db.addBossCooldown(interaction.user.id, bossName, BOSS_COOLDOWN_MS);

        const expiresAt = Date.now() + BOSS_COOLDOWN_MS;
        const expiresTimeStr = new Date(expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const embed = new EmbedBuilder()
            .setColor(0x44FF88)
            .setTitle('⏳ Cooldown de Boss Marcado')
            .setDescription(`Seu cooldown para o boss **${bossName}** foi registrado com sucesso!\n\n` +
                             `🔔 **Vou te avisar por DM privada** assim que expirar.`)
            .addFields(
                { name: '⏰ Expira em', value: '20 horas', inline: true },
                { name: '📅 Disponível às', value: `\`${expiresTimeStr}\` de amanhã`, inline: true }
            )
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
