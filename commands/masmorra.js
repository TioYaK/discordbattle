'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../modules/database');
const dungeonSystem = require('../modules/dungeonSystem');

module.exports = {
    name: 'masmorra',
    aliases: ['dungeon', 'expedicao'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('masmorra')
        .setDescription('Abra o portão para uma perigosa masmorra cheia de monstros e tesouros.'),

    async execute(msg, args, { client }) {
        return handleMasmorra(msg.channel, msg.author.id, client, null);
    },

    async executeSlash(interaction, { client }) {
        await interaction.deferReply();
        return handleMasmorra(interaction.channel, interaction.user.id, client, interaction);
    }
};

async function handleMasmorra(channel, userId, client, interaction) {
    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = 'Você não possui um personagem RPG criado no Bastião. Crie o seu usando **`/rpg-registrar`**!';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    if (char.death_time && char.death_time > 0) {
        const err = '💀 Você está morto! Fantasmas não podem explorar masmorras.';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const key1Qty = db.getMaterialQty(userId, 'dungeon_key_1');
    const key2Qty = db.getMaterialQty(userId, 'dungeon_key_2');
    const key3Qty = db.getMaterialQty(userId, 'dungeon_key_3');
    const oldKeyQty = db.getMaterialQty(userId, 'dungeon_key');

    const totalKeys = key1Qty + key2Qty + key3Qty + oldKeyQty;

    if (totalKeys < 1) {
        const err = '❌ Você não tem nenhuma **Chave da Masmorra 🗝️**! Você pode encontrá-las na `!loja` ou dropando de monstros raros.';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const embed = new EmbedBuilder()
        .setColor(0x34495E)
        .setTitle('🏰 Os Portões da Masmorra')
        .setDescription('Na sua frente ergue-se um enorme portão de pedra antigo com três fechaduras diferentes.\n\nQual chave você usará para entrar? Lembre-se: chaves melhores destravam masmorras mais profundas e com recompensas melhores, mas os perigos são muito maiores!');

    const buttons = [];
    if (key1Qty > 0 || oldKeyQty > 0) {
        buttons.push(new ButtonBuilder().setCustomId('enter_t1').setLabel(`Chave de Cobre (${key1Qty + oldKeyQty}x)`).setStyle(ButtonStyle.Secondary).setEmoji('🗝️'));
    }
    if (key2Qty > 0) {
        buttons.push(new ButtonBuilder().setCustomId('enter_t2').setLabel(`Chave de Prata (${key2Qty}x)`).setStyle(ButtonStyle.Primary).setEmoji('🗝️'));
    }
    if (key3Qty > 0) {
        buttons.push(new ButtonBuilder().setCustomId('enter_t3').setLabel(`Chave de Ouro (${key3Qty}x)`).setStyle(ButtonStyle.Success).setEmoji('🗝️'));
    }

    const row = new ActionRowBuilder().addComponents(buttons);

    let sentMsg;
    if (interaction) {
        sentMsg = await interaction.editReply({ embeds: [embed], components: [row], fetchReply: true }).catch(() => {});
    } else {
        sentMsg = await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
    }

    const filter = i => i.user.id === userId;
    const collector = sentMsg.createMessageComponentCollector({ filter, time: 120000 });

    collector.on('collect', async i => { console.log("[Masmorra] Collector pegou:", i.customId);
        let tier = 1;
        let keyUsed = 'dungeon_key_1';

        if (i.customId === 'enter_t1') {
            tier = 1;
            keyUsed = key1Qty > 0 ? 'dungeon_key_1' : 'dungeon_key';
        } else if (i.customId === 'enter_t2') {
            tier = 2;
            keyUsed = 'dungeon_key_2';
        } else if (i.customId === 'enter_t3') {
            tier = 3;
            keyUsed = 'dungeon_key_3';
        }

        // Consume the key
        db.removeMaterial(userId, keyUsed, 1);

        // Stop lobby collector
        collector.stop('started');

        try {
            await dungeonSystem.startDungeon(i, userId, client, tier);
        } catch (err) {
            console.error('[Masmorra] Erro ao iniciar masmorra:', err);
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            if (interaction) {
                interaction.editReply({ content: '⏳ Você demorou demais para decidir e o portão se fechou.', embeds: [], components: [] }).catch(()=>{});
            } else {
                sentMsg.edit({ content: '⏳ Você demorou demais para decidir e o portão se fechou.', embeds: [], components: [] }).catch(()=>{});
            }
        }
    });
}
