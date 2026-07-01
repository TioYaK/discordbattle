'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('../modules/database');
const RPG_ITEMS = require('../modules/rpgItems');

module.exports = {
    name: 'beber',
    aliases: ['usar', 'use', 'drink', 'consumir'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('beber')
        .setDescription('Beba Poções ou Elixires que estão no seu inventário'),

    async execute(msg) {
        return handleDrink(msg.author.id, msg.channel);
    },

    async executeSlash(interaction) {
        await interaction.deferReply();
        return handleDrink(interaction.user.id, interaction.channel, interaction);
    }
};

async function handleDrink(userId, channel, interaction = null) {
    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = '🚫 Você precisa de um personagem RPG para usar itens! Use `/rpg-registrar`.';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    if (char.death_time && char.death_time > 0) {
        const err = '💀 Você está morto e fantasmas não podem beber poções!';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const inventory = db.db.prepare("SELECT id, item_id FROM member_inventory WHERE discord_id = ?").all(userId);
    
    const consumables = [];
    inventory.forEach(inv => {
        const def = RPG_ITEMS[inv.item_id];
        if (def && def.type === 'consumable') {
            consumables.push({ id: inv.id, def });
        }
    });

    if (consumables.length === 0) {
        const err = '❌ Você não tem nenhuma poção ou consumível no inventário!';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const options = consumables.map(c => {
        return {
            label: c.def.name,
            description: c.def.heal ? `Cura ${c.def.heal} HP` : `Dá bônus temporário`,
            value: c.id.toString(),
            emoji: '🧪'
        };
    });

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_drink')
            .setPlaceholder('Escolha a poção para beber...')
            .addOptions(options.slice(0, 25))
    );

    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🧪 Suas Poções')
        .setDescription(`Você tem **${char.current_hp === -1 ? db.getPlayerMaxHp(char) : char.current_hp} / ${db.getPlayerMaxHp(char)} HP**.\n\nEscolha qual poção deseja beber abaixo:`);

    let msg;
    if (interaction) msg = await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
    else msg = await channel.send({ embeds: [embed], components: [row] }).catch(() => {});

    const filter = i => i.user.id === userId && i.customId === 'select_drink';
    const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async i => {
        const rowId = i.values[0];
        const itemRow = db.db.prepare('SELECT id, item_id FROM member_inventory WHERE id = ?').get(rowId);
        
        if (!itemRow) return i.reply({ content: 'Poção não encontrada no inventário!', ephemeral: true });

        const def = RPG_ITEMS[itemRow.item_id];
        if (!def || def.type !== 'consumable') return i.reply({ content: 'Isso não é uma poção!', ephemeral: true });

        // Consome a poção
        db.db.prepare('DELETE FROM member_inventory WHERE id = ?').run(rowId);

        let resultText = '';

        if (def.heal) {
            const maxHp = db.getPlayerMaxHp(char);
            let currentHp = char.current_hp === -1 ? maxHp : char.current_hp;
            
            if (currentHp >= maxHp) {
                resultText = `Você bebeu **${def.name}**, mas sua vida já estava cheia! A poção foi desperdiçada.`;
            } else {
                currentHp = Math.min(maxHp, currentHp + def.heal);
                db.updateHp(userId, currentHp);
                resultText = `Você bebeu **${def.name}** e recuperou **${def.heal} HP**!\n❤️ Vida Atual: **${currentHp} / ${maxHp}**`;
            }
        } 
        else if (def.buff) {
            resultText = `Você bebeu **${def.name}**! Você sente uma energia muito forte fluindo... (Buff aplicado em batalhas futuras!)`;
            db.setConfig(`buff_${userId}_${def.buff}`, Date.now() + (def.duration * 3600000));
        }

        const winEmbed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('🧪 Poção Consumida')
            .setDescription(resultText);

        await i.update({ embeds: [winEmbed], components: [] });
        collector.stop();
    });
}
