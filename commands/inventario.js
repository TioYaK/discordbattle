'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');

async function handleInventario(ctx, userId, isSlash = false) {
    const memberRow = db.getRegisteredMember(userId);
    if (!memberRow) {
        const msgText = '❌ Você não está registrado no bot. Registre-se primeiro no canal correspondente.';
        return isSlash ? ctx.editReply({ content: msgText, ephemeral: true }) : ctx.reply(msgText);
    }

    const inventory = db.getInventory(userId);
    const boosterQty = inventory.find(i => i.item_id === 'booster')?.quantity || 0;
    const whatsappQty = inventory.find(i => i.item_id === 'whatsapp_ad')?.quantity || 0;
    
    const key1Qty = db.getMaterialQty(userId, 'dungeon_key_1');
    const key2Qty = db.getMaterialQty(userId, 'dungeon_key_2');
    const key3Qty = db.getMaterialQty(userId, 'dungeon_key_3');

    const embed = new EmbedBuilder()
        .setColor(0x3498DB) // Blue
        .setTitle(`🎒 Inventário de ${memberRow.char_name}`)
        .setDescription('Aqui estão os seus itens adquiridos na loja virtual da guilda!')
        .addFields(
            { name: '⏰ Spawn Booster', value: `\`${boosterQty}\` tokens disponíveis\n_(Use com \`/booster usar\` ou \`!booster usar\` para estender seu claim de hunt por 60 min)_`, inline: false },
            { name: '📢 Anúncio no WhatsApp', value: `\`${whatsappQty}\` tokens disponíveis\n_(Permite realizar disparos globais via bot)_`, inline: false },
            { name: '🗝️ Chaves de Masmorra', value: `Cobre (Nv1): \`${key1Qty}\` | Prata (Nv2): \`${key2Qty}\` | Ouro (Nv3): \`${key3Qty}\``, inline: false }
        )
        .setFooter({ text: 'Ascended Bot • Inventário & Economia' });


    const RPG_ITEMS = require('../modules/rpgItems');
    let gearText = '';
    const gearList = db.db.prepare('SELECT item_id, upgrade_level FROM member_inventory WHERE discord_id = ? AND item_id != \'booster\' AND item_id != \'whatsapp_ad\'').all(userId);
    
    if (gearList.length > 0) {
        gearList.forEach(g => {
            const def = RPG_ITEMS[g.item_id];
            if (def) {
                const upLvl = g.upgrade_level > 0 ? ` **+${g.upgrade_level}**` : '';
                gearText += `• ${def.name}${upLvl} (ATK: ${def.atk || 0} | DEF: ${def.def || 0}) \`ID: ${g.item_id}\`\n`;
            }
        });
        gearText += '\n*Use `!equipar <ID>` para vestir o equipamento.*';
    } else {
        gearText = 'Você não possui nenhum equipamento de RPG. Use `!loja` ou `!forjar`.';
    }

    embed.addFields({ name: '🛡️ Seus Equipamentos (RPG)', value: gearText, inline: false });


    embed.setTimestamp();

    const replyData = { embeds: [embed] };
    return isSlash ? ctx.editReply(replyData) : ctx.reply(replyData);
}

module.exports = {
    name: 'inventario',
    aliases: ['inv', 'inventory', 'itens'],
    description: 'Mostra o inventário de itens adquiridos',
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('inventario')
        .setDescription('Mostra o seu inventário de itens adquiridos'),

    async execute(msg, args, { config }) {
        return handleInventario(msg, msg.author.id, false);
    },

    async executeSlash(interaction, { config }) {
        await interaction.deferReply();
        return handleInventario(interaction, interaction.user.id, true);
    }
};
