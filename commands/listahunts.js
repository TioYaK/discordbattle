'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const respawnsList = require('../data/respawns.json');

// Group respawns strictly by category, returning one chunk per category
function getFullFormattedList() {
    const groups = {};
    respawnsList.forEach(r => {
        if (!groups[r.category]) groups[r.category] = [];
        groups[r.category].push(r);
    });

    const chunks = [];
    const categories = Object.keys(groups).sort();
    for (const cat of categories) {
        let text = `**📍 ${cat}**\n`;
        groups[cat].forEach(r => {
            text += `\`${r.id}\` — ${r.name}\n`;
        });
        chunks.push({ text, categories: [cat] });
    }
    return chunks;
}

// Find category matching query
function findCategory(query) {
    const q = query.toLowerCase().trim();
    const categories = [...new Set(respawnsList.map(r => r.category))];
    
    // Exact match
    let match = categories.find(c => c.toLowerCase() === q);
    if (match) return match;

    // Partial match
    match = categories.find(c => c.toLowerCase().includes(q));
    if (match) return match;

    return null;
}

async function handleListaHuntsLogic(query) {
    const categories = [...new Set(respawnsList.map(r => r.category))].sort();

    // Case 1: No query -> Return chunks of all respawns categorized by city
    if (!query) {
        const chunks = getFullFormattedList();
        return { chunks };
    }

    // Case 2: Query provided -> Find matching category
    const matchedCategory = findCategory(query);
    if (!matchedCategory) {
        const errorEmbed = new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('❌ Categoria não encontrada')
            .setDescription(
                `Não encontramos nenhuma categoria correspondente a **"${query}"**.\n\n` +
                `**Categorias válidas:**\n` +
                categories.map(c => `• ${c}`).join('\n')
            )
            .setFooter({ text: 'Ascended Bot • RubinOT' })
            .setTimestamp();

        return { embed: errorEmbed };
    }

    // Filter hunts by category
    const filtered = respawnsList.filter(r => r.category === matchedCategory);
    const lines = filtered.map(r => `\`${r.id}\` — **${r.name}**`);

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`📍 Respawns em ${matchedCategory}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Ascended Bot • RubinOT' })
        .setTimestamp();

    return { embed };
}

module.exports = {
    name: 'listahunts',
    aliases: ['hunts', 'lista', 'respawnslist'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('listahunts')
        .setDescription('Lista todos os respawns e seus respectivos códigos')
        .addStringOption(option =>
            option.setName('categoria')
                .setDescription('Filtre os respawns por uma categoria específica (Ex: Roshamuul, Yalahar)')
                .setRequired(false)
        ),

    async execute(msg, args) {
        const query = args.join(' ');
        const result = await handleListaHuntsLogic(query);

        if (result.chunks) {
            const sentMessages = [];
            // Send the first message as a direct message in channel (no reply link)
            const firstMsg = await msg.channel.send({ content: result.chunks[0].text });
            sentMessages.push(firstMsg);

            for (let i = 1; i < result.chunks.length; i++) {
                const s = await msg.channel.send({ content: result.chunks[i].text });
                sentMessages.push(s);
            }

            // Build rapid navigation index for each city
            const indexLines = [
                '📌 **Navegação Rápida (Índice de Cidades)**',
                'Clique na cidade abaixo para ir direto à lista correspondente:\n'
            ];
            
            sentMessages.forEach((sent, idx) => {
                const catName = result.chunks[idx].categories[0];
                indexLines.push(`• **[${catName}](${sent.url})**`);
            });

            let currentMsg = '';
            for (const line of indexLines) {
                if (currentMsg.length + line.length + 1 > 1900) {
                    await msg.channel.send({ content: currentMsg });
                    currentMsg = '';
                }
                currentMsg += line + '\n';
            }
            if (currentMsg.length > 0) {
                await msg.channel.send({ content: currentMsg });
            }
            return;
        }

        return msg.channel.send({ embeds: [result.embed] });
    },

    async executeSlash(interaction) {
        const query = interaction.options.getString('categoria');
        const result = await handleListaHuntsLogic(query);

        if (result.chunks) {
            // Reply ephemerally to acknowledge the slash command interaction immediately
            await interaction.reply({ content: 'Gerando a lista de hunts...', ephemeral: true });

            const sentMessages = [];
            for (let i = 0; i < result.chunks.length; i++) {
                const s = await interaction.channel.send({ content: result.chunks[i].text });
                sentMessages.push(s);
            }

            // Build rapid navigation index for each city
            const indexLines = [
                '📌 **Navegação Rápida (Índice de Cidades)**',
                'Clique na cidade abaixo para ir direto à lista correspondente:\n'
            ];
            
            sentMessages.forEach((sent, idx) => {
                const catName = result.chunks[idx].categories[0];
                indexLines.push(`• **[${catName}](${sent.url})**`);
            });

            let currentMsg = '';
            for (const line of indexLines) {
                if (currentMsg.length + line.length + 1 > 1900) {
                    await interaction.channel.send({ content: currentMsg });
                    currentMsg = '';
                }
                currentMsg += line + '\n';
            }
            if (currentMsg.length > 0) {
                await interaction.channel.send({ content: currentMsg });
            }

            // Edit the ephemeral reply to show completion
            await interaction.editReply({ content: 'Lista de hunts gerada com sucesso!' });
            return;
        }

        return interaction.reply({ embeds: [result.embed] });
    }
};
