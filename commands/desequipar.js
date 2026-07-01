'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const rpgItems = require('../modules/rpgItems');

const SLOT_MAP = {
    arma: 'weapon',
    weapon: 'weapon',
    escudo: 'shield',
    shield: 'shield',
    armadura: 'armor',
    armor: 'armor',
    amuleto: 'amulet',
    amulet: 'amulet'
};

module.exports = {
    name: 'desequipar',
    aliases: ['unequip', 'takeoff'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('desequipar')
        .setDescription('Remove um item equipado do seu personagem e devolve ao seu inventário')
        .addStringOption(option =>
            option.setName('slot')
                .setDescription('Slot para desequipar')
                .setRequired(true)
                .addChoices(
                    { name: '🗡️ Arma', value: 'weapon' },
                    { name: '🛡️ Escudo', value: 'shield' },
                    { name: '👕 Armadura', value: 'armor' },
                    { name: '📿 Amuleto', value: 'amulet' }
                )),

    async execute(msg, args, { client }) {
        const userId = msg.author.id;

        if (args.length < 1) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Sintaxe Incorreta')
                        .setDescription('Use: **`!desequipar [arma / escudo / armadura / amuleto]`**\n\nExemplo: `!desequipar arma`')
                ]
            });
        }

        const inputSlot = args[0].toLowerCase().trim();
        const slot = SLOT_MAP[inputSlot];

        if (!slot) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Slot Inválido')
                        .setDescription('Escolha entre: **arma**, **escudo**, **armadura** ou **amuleto**.')
                ]
            });
        }

        const result = await unequipItem(userId, slot);

        if (result.error) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Falha ao Desequipar')
                        .setDescription(result.error)
                ]
            });
        }

        return msg.reply({ embeds: [result.embed] });
    },

    async executeSlash(interaction, { client }) {
        const userId = interaction.user.id;
        const slot = interaction.options.getString('slot');

        const result = await unequipItem(userId, slot);

        if (result.error) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Falha ao Desequipar')
                        .setDescription(result.error)
                ],
                ephemeral: true
            });
        }

        return interaction.reply({ embeds: [result.embed] });
    }
};

async function unequipItem(userId, slot) {
    // 1. Verify RPG Character
    const char = db.getRpgCharacter(userId);
    if (!char) {
        return { error: 'Você não possui um personagem RPG criado no Bastião. Crie o seu usando **`/rpg-registrar`**!' };
    }

    const itemId = char[`equipped_${slot}`];
    if (!itemId) {
        return { error: `Você não possui nenhum item equipado no slot de **${slot.toUpperCase()}**.` };
    }

    const item = rpgItems[itemId];

    try {
        // 2. Remove item from slot
        db.updateRpgEquipment(userId, slot, null);

        // 3. Return item to inventory
        db.addInventoryItem(userId, itemId, 1);

        const embed = new EmbedBuilder()
            .setColor(0xE67E22) // Orange
            .setTitle('🛡️ Equipamento Removido')
            .setDescription(
                `Você desequipou o item **${item ? item.name : itemId}** do slot de **${slot.toUpperCase()}**.\n\n` +
                `📦 O item foi devolvido ao seu inventário.`
            )
            .setFooter({ text: 'Ascended RPG • Bastião de Aethelgard' })
            .setTimestamp();

        return { embed };
    } catch (err) {
        console.error('[RPG] Erro ao desequipar item:', err.message);
        return { error: `Erro interno ao desequipar item: ${err.message}` };
    }
}
