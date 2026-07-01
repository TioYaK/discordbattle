'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../modules/database');
const RPG_ITEMS = require('../modules/rpgItems');

module.exports = {
    name: 'refinar',
    aliases: ['refine', 'upgrade', 'aprimorar'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('refinar')
        .setDescription('Melhore seus equipamentos na Forja usando Pó Mágico e AC.'),

    async execute(msg) {
        return handleRefine(msg.author.id, msg.channel);
    },

    async executeSlash(interaction) {
        await interaction.deferReply();
        return handleRefine(interaction.user.id, interaction.channel, interaction);
    }
};

async function handleRefine(userId, channel, interaction = null) {
    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = '🚫 Você precisa de um personagem RPG! Use `/rpg-registrar`.';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const reg = db.getRegisteredMember(userId);
    const dustQty = db.getMaterialQty(userId, 'magic_dust');

    const gearList = db.db.prepare("SELECT id, item_id, upgrade_level FROM member_inventory WHERE discord_id = ? AND item_id != 'booster' AND item_id != 'whatsapp_ad'").all(userId);

    if (gearList.length === 0) {
        const err = '❌ Você não possui nenhum equipamento de RPG no seu `!inventario` para refinar!';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const embed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('🔥 A Bigorna de Refinamento')
        .setDescription(`Refinar equipamentos aumenta os atributos deles permanentemente (+2 Atk e +2 Def por nível).\n\n✨ **Pó Mágico em Mãos:** \${dustQty}x\n💰 **Saldo de AC:** \${reg.coins.toFixed(0)} AC\n\n**Custos de Refinamento:**\n• Para +1: 1 Pó Mágico + 500 AC (100% de Sucesso)\n• Para +2: 2 Pó Mágico + 1000 AC (70% de Sucesso)\n• Para +3: 3 Pó Mágico + 2000 AC (40% de Sucesso - Risco de Quebra)\n\nSelecione um item abaixo para refinar:`);

    const options = gearList.map(g => {
        const def = RPG_ITEMS[g.item_id];
        const lvl = g.upgrade_level || 0;
        return {
            label: `\${def.name} \${lvl > 0 ? '+'+lvl : ''}`,
            description: `Nível atual: \${lvl}`,
            value: g.id.toString(),
            emoji: '🔨'
        };
    });

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_refine')
            .setPlaceholder('Escolha o item...')
            .addOptions(options.slice(0, 25))
    );

    let msg;
    if (interaction) msg = await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
    else msg = await channel.send({ embeds: [embed], components: [row] }).catch(() => {});

    const filter = i => i.user.id === userId;
    const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async i => {
        if (i.customId === 'select_refine') {
            const rowId = i.values[0];
            const item = db.db.prepare('SELECT id, item_id, upgrade_level FROM member_inventory WHERE id = ?').get(rowId);
            
            if (!item) return i.reply({ content: 'Item não encontrado!', ephemeral: true });

            const def = RPG_ITEMS[item.item_id];
            const currLvl = item.upgrade_level || 0;
            
            if (currLvl >= 3) {
                return i.reply({ content: '❌ Este item já atingiu o nível máximo de refinamento (+3)!', ephemeral: true });
            }

            const costDust = currLvl + 1;
            const costAc = costDust === 1 ? 500 : (costDust === 2 ? 1000 : 2000);
            let successRate = costDust === 1 ? 1.0 : (costDust === 2 ? 0.70 : 0.40);
            
            // Bônus de Ferreiro (+15% sucesso)
            if (char.profession === 'Ferreiro') {
                successRate += 0.15;
            }

            // Verifica custos
            const cDust = db.getMaterialQty(userId, 'magic_dust');
            const cReg = db.getRegisteredMember(userId);
            
            if (cDust < costDust) return i.reply({ content: `❌ Você precisa de **${costDust}x Pó Mágico ✨**!`, ephemeral: true });
            if (cReg.coins < costAc) return i.reply({ content: `❌ Você precisa de **${costAc} AC 💰**!`, ephemeral: true });

            // Paga os custos
            db.removeMaterial(userId, 'magic_dust', costDust);
            db.removeCoins(userId, costAc);

            await i.deferUpdate();

            const chance = Math.random();
            if (chance <= successRate) {
                // Sucesso
                db.db.prepare('UPDATE member_inventory SET upgrade_level = ? WHERE id = ?').run(currLvl + 1, item.id);
                
                const winEmbed = new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('🌟 REFINAMENTO BEM SUCEDIDO!')
                    .setDescription(`Você bateu o martelo com perfeição!\n\nO item **${def.name}** evoluiu para **+${currLvl + 1}**!\nSeus atributos foram aumentados permanentemente.`);
                
                await msg.edit({ embeds: [winEmbed], components: [] });
            } else {
                // Falha
                if (currLvl === 2) { // Risco de quebra para +3
                    if (Math.random() < 0.5) { // 50% chance de quebrar na falha do +3
                        db.db.prepare('DELETE FROM member_inventory WHERE id = ?').run(item.id);
                        const breakEmbed = new EmbedBuilder()
                            .setColor(0x000000)
                            .setTitle('💥 O ITEM QUEBROU!')
                            .setDescription(`A magia foi forte demais! O seu **${def.name}** explodiu na bigorna e foi perdido para sempre!`);
                        return msg.edit({ embeds: [breakEmbed], components: [] });
                    }
                }

                const failEmbed = new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setTitle('❌ REFINAMENTO FALHOU!')
                    .setDescription(`O Pó Mágico se dissipou sem efeito... O item continuou no nível **+${currLvl}**.\nVocê perdeu os recursos.`);
                await msg.edit({ embeds: [failEmbed], components: [] });
            }

            collector.stop();
        }
    });
}
