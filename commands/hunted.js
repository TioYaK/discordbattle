'use strict';

const { buildErrorEmbed, buildHuntedListEmbed } = require('../modules/embeds');
const db = require('../modules/database');
const state = require('../modules/state');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'hunted',
    aliases: ['hunt'],
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName('hunted')
        .setDescription('Gerencia a lista de hunted')
        .addSubcommand(sub => sub.setName('add').setDescription('Adiciona um hunted').addStringOption(o => o.setName('name').setDescription('Nome do personagem').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Motivo').setRequired(false)))
        .addSubcommand(sub => sub.setName('info').setDescription('Mostra info de um hunted').addStringOption(o => o.setName('name').setDescription('Nome do personagem').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Pede confirmação para remover um hunted').addStringOption(o => o.setName('name').setDescription('Nome do personagem').setRequired(true)))
        .addSubcommand(sub => sub.setName('confirm').setDescription('Confirma remoção do hunted').addStringOption(o => o.setName('name').setDescription('Nome do personagem').setRequired(true))),

    async execute(msg, args) {
        const [subCmd, ...rest] = args;
        const joined = rest.join(' ').trim();

        function parseQuotedTwo(str) {
            if (!str) return [null, null];
            const m = str.match(/^"([^\"]+)"\s*"([^\"]+)"$/) || str.match(/^'([^']+)'\s*'([^']+)'$/);
            if (m) return [m[1].trim(), m[2].trim()];
            const parts = str.split(/\s+/);
            if (!parts.length) return [null, null];
            const name = parts.shift();
            return [name, parts.join(' ').trim()];
        }

        if (!subCmd) {
            const list = db.getHuntedList();
            return msg.reply({ embeds: [buildHuntedListEmbed(list).catch(() => {})] });
        }

        const s = subCmd.toLowerCase();

        if (s === 'add' || s === 'adicionar') {
            const [name, reason] = parseQuotedTwo(joined);
            if (!name) return msg.reply({ embeds: [buildErrorEmbed('Uso: !hunted add "nome" "motivo"').catch(() => {})] });
            db.addHunted(name, msg.author.username, reason || '');
            state.huntedList = db.getHuntedList();
            const embed = new EmbedBuilder()
                .setColor(0x44FF88)
                .setTitle('✅ Hunted Adicionado')
                .setDescription(`**${name}** adicionado à lista de hunted.`)
                .addFields(
                    { name: 'Motivo', value: reason || '_Nenhum motivo registrado._', inline: false },
                    { name: 'Adicionado por', value: `\`${msg.author.username}\``, inline: true }
                )
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();
            return msg.reply({ embeds: [embed] }).catch(() => {});
        }

        if (s === 'info') {
            const name = (joined.replace(/^"(.+)"$/, '$1') || rest[0]);
            if (!name) return msg.reply({ embeds: [buildErrorEmbed('Uso: !hunted info "nome"').catch(() => {})] });
            const entry = db.getHuntedEntry(name);
            if (!entry) return msg.reply({ embeds: [buildErrorEmbed(`**${name}** não está na lista de hunted.`).catch(() => {})] });
            const embed = new EmbedBuilder()
                .setColor(0xFF8C00)
                .setTitle(`👁️ Info — ${entry.name}`)
                .addFields(
                    { name: 'Motivo', value: entry.reason || '_Nenhum motivo registrado._', inline: false },
                    { name: 'Adicionado por', value: `\`${entry.added_by || 'Desconhecido'}\``, inline: true },
                    { name: 'Adicionado em', value: `\`${entry.added_at || 'N/D'}\``, inline: true },
                )
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();
            return msg.reply({ embeds: [embed] }).catch(() => {});
        }

        if (s === 'remove' || s === 'remover' || s === 'unhunted') {
            const name = (joined.replace(/^"(.+)"$/, '$1') || rest[0]);
            if (!name) return msg.reply({ embeds: [buildErrorEmbed('Uso: !hunted remove "nome"').catch(() => {})] });
            const entry = db.getHuntedEntry(name);
            if (!entry) return msg.reply({ embeds: [buildErrorEmbed(`**${name}** não está na lista de hunted.`).catch(() => {})] });
            const embed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle(`⚠️ Remover Hunted — ${entry.name}`)
                .setDescription(`Motivo registrado: ${entry.reason || '_Nenhum motivo registrado._'}`)
                .addFields({ name: 'Como confirmar', value: `Use: \`!hunted confirm "${entry.name}"\``, inline: false })
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();
            return msg.reply({ embeds: [embed] }).catch(() => {});
        }

        if (s === 'confirm' || s === 'confirm-remove' || s === 'confirmar') {
            const name = (joined.replace(/^"(.+)"$/, '$1') || rest[0]);
            if (!name) return msg.reply({ embeds: [buildErrorEmbed('Uso: !hunted confirm "nome"').catch(() => {})] });
            const entry = db.getHuntedEntry(name);
            if (!entry) return msg.reply({ embeds: [buildErrorEmbed(`**${name}** não está na lista de hunted.`).catch(() => {})] });
            db.removeHunted(name);
            state.huntedList = db.getHuntedList();
            const embed = new EmbedBuilder()
                .setColor(0x44FF88)
                .setTitle('✅ Hunted Removido')
                .setDescription(`**${entry.name}** removido da lista de hunted.`)
                .addFields({ name: 'Motivo anterior', value: entry.reason || '_Nenhum motivo registrado._', inline: false })
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();
            return msg.reply({ embeds: [embed] }).catch(() => {});
        }

        return msg.reply({ embeds: [buildErrorEmbed('Subcomando inválido. Use `add|info|remove|confirm`.').catch(() => {})] });
    },

    async executeSlash(interaction) {
        await interaction.deferReply();
        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            const name = interaction.options.getString('name');
            const reason = interaction.options.getString('reason') || '';
            db.addHunted(name, interaction.user.username, reason);
            state.huntedList = db.getHuntedList();
            const embed = new EmbedBuilder()
                .setColor(0x44FF88)
                .setTitle('✅ Hunted Adicionado')
                .setDescription(`**${name}** adicionado à lista de hunted.`)
                .addFields(
                    { name: 'Motivo', value: reason || '_Nenhum motivo registrado._', inline: false },
                    { name: 'Adicionado por', value: `\`${interaction.user.username}\``, inline: true }
                )
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed], ephemeral: true }).catch(() => {});
        }

        if (sub === 'info') {
            const name = interaction.options.getString('name');
            const entry = db.getHuntedEntry(name);
            if (!entry) return interaction.editReply({ embeds: [buildErrorEmbed(`**${name}** não está na lista de hunted.`).catch(() => {})], ephemeral: true });
            const embed = new EmbedBuilder()
                .setColor(0xFF8C00)
                .setTitle(`👁️ Info — ${entry.name}`)
                .addFields(
                    { name: 'Motivo', value: entry.reason || '_Nenhum motivo registrado._', inline: false },
                    { name: 'Adicionado por', value: `\`${entry.added_by || 'Desconhecido'}\``, inline: true },
                    { name: 'Adicionado em', value: `\`${entry.added_at || 'N/D'}\``, inline: true },
                )
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed], ephemeral: true }).catch(() => {});
        }

        if (sub === 'remove') {
            const name = interaction.options.getString('name');
            const entry = db.getHuntedEntry(name);
            if (!entry) return interaction.editReply({ embeds: [buildErrorEmbed(`**${name}** não está na lista de hunted.`).catch(() => {})], ephemeral: true });
            const embed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle(`⚠️ Remover Hunted — ${entry.name}`)
                .setDescription(`Motivo registrado: ${entry.reason || '_Nenhum motivo registrado._'}`)
                .addFields({ name: 'Como confirmar', value: `Use: /hunted confirm name:${entry.name}`, inline: false })
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed], ephemeral: true }).catch(() => {});
        }

        if (sub === 'confirm') {
            const name = interaction.options.getString('name');
            const entry = db.getHuntedEntry(name);
            if (!entry) return interaction.editReply({ embeds: [buildErrorEmbed(`**${name}** não está na lista de hunted.`).catch(() => {})], ephemeral: true });
            db.removeHunted(name);
            state.huntedList = db.getHuntedList();
            const embed = new EmbedBuilder()
                .setColor(0x44FF88)
                .setTitle('✅ Hunted Removido')
                .setDescription(`**${entry.name}** removido da lista de hunted.`)
                .addFields({ name: 'Motivo anterior', value: entry.reason || '_Nenhum motivo registrado._', inline: false })
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed], ephemeral: true }).catch(() => {});
        }
    }
};
