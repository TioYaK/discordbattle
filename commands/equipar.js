'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('../modules/database');
const rpgItems = require('../modules/rpgItems');

module.exports = {
    name: 'equipar',
    aliases: ['wear'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('equipar')
        .setDescription('Abra o guarda-roupas para equipar um item do seu inventario no seu personagem RPG')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('(Opcional) ID do item para equipar direto')
                .setRequired(false)),

    async execute(msg, args, { client }) {
        const userId = msg.author.id;
        if (args.length > 0) {
            const itemId = args[0].toLowerCase().trim();
            const result = await equipItem(userId, itemId);
            if (result.error) {
                return msg.reply({ embeds: [new EmbedBuilder().setColor(0xFF4444).setTitle('🚫 Falha').setDescription(result.error)] });
            }
            return msg.reply({ embeds: [result.embed] });
        }
        return showEquipMenu(userId, msg.channel, msg);
    },

    async executeSlash(interaction, { client }) {
        const userId = interaction.user.id;
        const itemId = interaction.options.getString('item');
        if (itemId) {
            const result = await equipItem(userId, itemId.toLowerCase().trim());
            if (result.error) {
                return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4444).setTitle('🚫 Falha').setDescription(result.error)], ephemeral: true });
            }
            return interaction.reply({ embeds: [result.embed] });
        }
        return showEquipMenu(userId, interaction.channel, interaction, true);
    }
};

async function showEquipMenu(userId, channel, context, isSlash = false) {
    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = 'Você não possui um personagem RPG criado no Bastião. Crie o seu usando /rpg-registrar!';
        if (isSlash) return context.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }

    const gearList = db.db.prepare("SELECT id, item_id, upgrade_level FROM member_inventory WHERE discord_id = ? AND item_id != 'booster' AND item_id != 'whatsapp_ad'").all(userId);

    if (gearList.length === 0) {
        const err = '❌ Você não possui nenhum equipamento de RPG na sua mochila!';
        if (isSlash) return context.reply({ content: err, ephemeral: true });
        return channel.send(err);
    }

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('🎒 Guarda-Roupas de Aethelgard')
        .setDescription('Selecione abaixo qual equipamento da sua mochila você deseja vestir no seu personagem.\n\n*Nota: Ao vestir um item, a peça anterior daquele slot voltará para a sua mochila.*');

    const options = gearList.map(g => {
        const def = rpgItems[g.item_id];
        const lvl = g.upgrade_level || 0;
        const upLvlStr = lvl > 0 ? '+' + lvl + ' ' : '';
        return {
            label: (def.name + ' ' + upLvlStr).substring(0, 100),
            description: '(Slot: ' + def.type.toUpperCase() + ') ATK: ' + (def.atk || 0) + ' | DEF: ' + (def.def || 0),
            value: g.item_id,
            emoji: '👕'
        };
    });

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_equip')
            .setPlaceholder('Escolher Equipamento...')
            .addOptions(options.slice(0, 25))
    );

    let msg;
    if (isSlash) {
        msg = await context.reply({ embeds: [embed], components: [row], fetchReply: true });
    } else {
        msg = await channel.send({ embeds: [embed], components: [row] });
    }

    const filter = i => i.user.id === userId;
    const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async i => {
        if (i.customId === 'select_equip') {
            const selectedItemId = i.values[0];
            const result = await equipItem(userId, selectedItemId);
            
            if (result.error) {
                await i.update({ content: result.error, embeds: [], components: [] });
            } else {
                await i.update({ embeds: [result.embed], components: [] });
            }
            collector.stop();
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            msg.edit({ components: [] }).catch(()=>{});
        }
    });
}

async function equipItem(userId, itemId) {
    const char = db.getRpgCharacter(userId);
    if (!char) return { error: 'Você não possui um personagem RPG criado no Bastião. Crie o seu usando /rpg-registrar!' };

    const item = rpgItems[itemId];
    if (!item) return { error: 'Este item não existe ou não é um equipamento válido.' };

    const quantity = db.getInventoryItemQuantity(userId, itemId);
    if (quantity <= 0) return { error: 'Você não possui o item **' + item.name + '** no seu inventário (!inventario).' };

    const slot = item.type;
    const currentEquippedId = char['equipped_' + slot];

    try {
        if (currentEquippedId) {
            db.addInventoryItem(userId, currentEquippedId, 1);
        }

        db.removeInventoryItem(userId, itemId, 1);
        db.updateRpgEquipment(userId, slot, itemId);

        const atkBonus = item.atk > 0 ? ' +' + item.atk + ' Atk' : '';
        const defBonus = item.def > 0 ? ' +' + item.def + ' Def' : '';
        const bonusStr = (atkBonus + defBonus).trim();

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('🛡️ Equipamento Vestido!')
            .setDescription(
                'Você equipou o item **' + item.name + '** no slot de **' + slot.toUpperCase() + '**!\n' +
                (bonusStr ? '✨ **Bônus:** `' + bonusStr + '`\n\n' : '\n') +
                (currentEquippedId && rpgItems[currentEquippedId]
                    ? '🔄 O item anterior **' + rpgItems[currentEquippedId].name + '** foi devolvido ao seu inventário.'
                    : '')
            )
            .setFooter({ text: 'Ascended RPG • Use !rpg-perfil para ver seus atributos' })
            .setTimestamp();

        return { embed };
    } catch (err) {
        console.error('[RPG] Erro ao equipar item:', err.message);
        return { error: 'Erro interno ao equipar item: ' + err.message };
    }
}
