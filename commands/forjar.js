'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('../modules/database');
const recipes = require('../modules/rpgRecipes');
const materials = require('../modules/rpgMaterials');

module.exports = {
    name: 'forjar',
    aliases: ['forge', 'craft', 'forja'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('forjar')
        .setDescription('Abre a Forja para criar itens lendários a partir de materiais'),

    async execute(msg) {
        return handleForge(msg.author.id, msg.channel);
    },

    async executeSlash(interaction) {
        await interaction.deferReply();
        return handleForge(interaction.user.id, interaction.channel, interaction);
    }
};

async function handleForge(userId, channel, interaction = null) {
    const char = db.getRpgCharacter(userId);
    if (!char) {
        const err = '🚫 Você precisa de um personagem RPG para usar a forja! Use `/rpg-registrar`.';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    if (char.death_time && char.death_time > 0) {
        const err = '💀 Você está morto e fantasmas não podem forjar itens!';
        if (interaction) return interaction.editReply({ content: err, ephemeral: true }).catch(() => {});
        return channel.send({ content: err }).catch(() => {});
    }

    const playerMaterials = db.getMaterials(userId);
    const reg = db.getRegisteredMember(userId);
    const playerCoins = reg ? reg.coins : 0;

    // Build the dropdown options
    const options = [];
    Object.keys(recipes).forEach(key => {
        const r = recipes[key];
        if (r.reqProfession && r.reqProfession !== char.profession) return; // Filtra profissão
        
        options.push({
            label: r.name,
            description: `Custo: ${r.costAc} AC + Materiais`,
            value: key
        });
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('forge_select')
        .setPlaceholder('Escolha um item para forjar')
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle('⚒️ A Forja de Aethelgard')
        .setDescription('Bem-vindo à forja! Aqui você pode combinar materiais encontrados nas caçadas e minerações para criar equipamentos poderosos que não são vendidos na loja.\n\nSelecione um item abaixo para ver a receita ou tentar forjá-lo.');

    let response;
    if (interaction) {
        response = await interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
    } else {
        response = await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
    }

    // Collector
    const filter = i => i.user.id === userId && i.customId === 'forge_select';
    const collector = response.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async i => {
        const recipeId = i.values[0];
        const recipe = recipes[recipeId];

        // Check if player has the materials
        let hasMaterials = true;
        let missingText = '';

        if (playerCoins < recipe.costAc) {
            hasMaterials = false;
            missingText += `- ❌ **${recipe.costAc} AC** (Você tem ${playerCoins})\n`;
        } else {
            missingText += `- ✅ **${recipe.costAc} AC**\n`;
        }

        for (const matReq of recipe.materials) {
            const matDef = materials[matReq.id];
            const playerQty = db.getMaterialQty(userId, matReq.id);
            if (playerQty < matReq.qty) {
                hasMaterials = false;
                missingText += `- ❌ **${matReq.qty}x ${matDef.name}** ${matDef.emoji} (Você tem ${playerQty})\n`;
            } else {
                missingText += `- ✅ **${matReq.qty}x ${matDef.name}** ${matDef.emoji} (Você tem ${playerQty})\n`;
            }
        }

        if (!hasMaterials) {
            const errEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle(`⚒️ Receita: ${recipe.name}`)
                .setDescription(`Você não possui todos os recursos necessários para forjar este item.\\n\\n**Requisitos:**\\n${missingText}`);
            return i.update({ embeds: [errEmbed], components: [row] });
        }

        // Deduct materials and coins
        db.removeCoins(userId, recipe.costAc);
        for (const matReq of recipe.materials) {
            db.removeMaterial(userId, matReq.id, matReq.qty);
        }

        // Give the item
        db.addInventoryItem(userId, recipe.result_item, 1);

        const successEmbed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('⚒️ Forja Concluída!')
            .setDescription(`O som do martelo ecoa pela sala... O item esfria e está pronto!\\n\\nVocê forjou com sucesso um(a) **${recipe.name}**!\\n*(Item adicionado ao seu \`!inventario\`)*`);

        await i.update({ embeds: [successEmbed], components: [] });
        collector.stop();
    });
}
