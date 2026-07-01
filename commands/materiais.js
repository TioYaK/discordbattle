'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const materials = require('../modules/rpgMaterials');

module.exports = {
    name: 'materiais',
    aliases: ['mats', 'recursos', 'resources'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('materiais')
        .setDescription('Mostra os materiais brutos no seu inventário para uso na Forja.'),

    async execute(msg) {
        return handleMats(msg.author.id, msg.channel);
    },

    async executeSlash(interaction) {
        await interaction.deferReply();
        return handleMats(interaction.user.id, interaction.channel, interaction);
    }
};

async function handleMats(userId, channel, interaction = null) {
    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = '🚫 Você precisa de um personagem RPG para ter materiais! Use `/rpg-registrar`.';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const playerMats = db.getMaterials(userId);

    let matText = '';
    if (!playerMats || playerMats.length === 0) {
        matText = 'Sua mochila de materiais está completamente vazia.\\nUse `!coletar` ou `!cacar` para encontrar recursos!';
    } else {
        playerMats.forEach(m => {
            const matDef = materials[m.material_id];
            if (matDef) {
                matText += `**${matDef.emoji} ${matDef.name}:** ${m.quantity}x\\n`;
            }
        });
    }

    const currentStamina = char.stamina !== undefined ? char.stamina : 100;

    const embed = new EmbedBuilder()
        .setColor(0x8B4513) // Brown/Wood color
        .setTitle(`🎒 Materiais de ${char.nickname}`)
        .setDescription(`Estes são os recursos brutos que você encontrou pelo Bastião. Use-os no comando \`!forjar\` para criar equipamentos lendários!\\n\\n${matText}\\n\\n💦 **Stamina Atual:** ${currentStamina}/100`)
        .setFooter({ text: 'Aethelgard RPG • Coleta e Forja' });

    if (interaction) return interaction.editReply({ embeds: [embed] }).catch(() => {});
    return channel.send({ embeds: [embed] }).catch(() => {});
}
