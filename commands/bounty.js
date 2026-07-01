'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../modules/database');

function isAdmin(member, config) {
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (member.permissions.has(PermissionFlagsBits.ManageGuild))   return true;
    if (config.adminRoleId && member.roles.cache.has(config.adminRoleId)) return true;
    return false;
}

module.exports = {
    name: 'bounty',
    aliases: ['recompensa', 'procurado', 'bounties'],
    adminOnly: false, // Controlado internamente por subcomandos

    data: new SlashCommandBuilder()
        .setName('bounty')
        .setDescription('Sistema de Caça a Recompensas (Bounties)')
        .addSubcommand(sub =>
            sub.setName('criar')
                .setDescription('Cria uma nova recompensa para um alvo inimigo (Admin apenas)')
                .addStringOption(opt => opt.setName('alvo').setDescription('Nome do personagem alvo').setRequired(true))
                .addStringOption(opt => opt.setName('recompensa').setDescription('Recompensa (Ex: 100 Coins, 5kk Gold)').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('cancelar')
                .setDescription('Cancela uma recompensa ativa (Admin apenas)')
                .addIntegerOption(opt => opt.setName('id').setDescription('ID da recompensa').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('listar')
                .setDescription('Lista todas as recompensas ativas no momento')
        ),

    async execute(msg, args, { config }) {
        if (!args.length) {
            args = ['listar'];
        }

        const subCmd = args[0].toLowerCase();

        if (subCmd === 'criar' || subCmd === 'create') {
            if (!isAdmin(msg.member, config)) {
                return msg.reply('🚫 Apenas administradores podem criar recompensas.');
            }

            if (args.length < 3) {
                return msg.reply('⚠️ Uso correto: `!bounty criar <Nome_do_Alvo> <Recompensa>`');
            }

            const targetName = args[1].replace(/_/g, ' ');
            const reward = args.slice(2).join(' ');

            db.addBounty(targetName, reward, msg.author.id);

            const embed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('🎯 ALVO PROCURADO! (New Bounty)')
                .setDescription(`Uma recompensa foi colocada pela cabeça de **${targetName}**!\n\n` +
                                 `💰 **Recompensa**: *${reward}*\n` +
                                 `👤 **Autorizado por**: <@${msg.author.id}>\n\n` +
                                 `*Elimine o alvo no jogo para receber a recompensa automaticamente.*`)
                .setThumbnail('https://rubinot.com.br/favicon.ico')
                .setFooter({ text: 'Ascended Bounty System' })
                .setTimestamp();

            return msg.channel.send({ embeds: [embed] });
        }

        if (subCmd === 'cancelar' || subCmd === 'cancel') {
            if (!isAdmin(msg.member, config)) {
                return msg.reply('🚫 Apenas administradores podem cancelar recompensas.');
            }

            if (args.length < 2) {
                return msg.reply('⚠️ Uso correto: `!bounty cancelar <ID>`');
            }

            const id = parseInt(args[1], 10);
            if (isNaN(id)) {
                return msg.reply('⚠️ O ID fornecido é inválido.');
            }

            db.cancelBounty(id);
            return msg.reply(`✅ Recompensa ID **#${id}** cancelada com sucesso!`);
        }

        if (subCmd === 'listar' || subCmd === 'list') {
            const bounties = db.getActiveBounties();

            if (!bounties.length) {
                return msg.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setTitle('🎯 Recompensas Ativas')
                            .setDescription('Não há nenhuma recompensa ativa no momento.')
                            .setFooter({ text: 'Ascended Bounty System' })
                            .setTimestamp()
                    ]
                });
            }

            const lines = bounties.map(b => {
                return `• **#${b.id}** — **${b.target_name}** | Recompensa: *${b.reward}*`;
            });

            const embed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('🎯 Quadro de Recompensas Ativas')
                .setDescription('Elimine qualquer um dos alvos abaixo para receber a recompensa:\n\n' + lines.join('\n'))
                .setFooter({ text: 'Ascended Bounty System' })
                .setTimestamp();

            return msg.reply({ embeds: [embed] });
        }

        return msg.reply('⚠️ Comando desconhecido. Use `!bounty listar`, `!bounty criar` ou `!bounty cancelar`.');
    },

    async executeSlash(interaction, { config }) {
        const subCmd = interaction.options.getSubcommand();

        if (subCmd === 'criar') {
            if (!isAdmin(interaction.member, config)) {
                return interaction.reply({ content: '🚫 Apenas administradores podem criar recompensas.', ephemeral: true });
            }

            const targetName = interaction.options.getString('alvo');
            const reward = interaction.options.getString('recompensa');

            db.addBounty(targetName, reward, interaction.user.id);

            const embed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('🎯 ALVO PROCURADO! (New Bounty)')
                .setDescription(`Uma recompensa foi colocada pela cabeça de **${targetName}**!\n\n` +
                                 `💰 **Recompensa**: *${reward}*\n` +
                                 `👤 **Autorizado por**: <@${interaction.user.id}>\n\n` +
                                 `*Elimine o alvo no jogo para receber a recompensa automaticamente.*`)
                .setThumbnail('https://rubinot.com.br/favicon.ico')
                .setFooter({ text: 'Ascended Bounty System' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        if (subCmd === 'cancelar') {
            if (!isAdmin(interaction.member, config)) {
                return interaction.reply({ content: '🚫 Apenas administradores podem cancelar recompensas.', ephemeral: true });
            }

            const id = interaction.options.getInteger('id');

            db.cancelBounty(id);
            return interaction.reply({ content: `✅ Recompensa ID **#${id}** cancelada com sucesso!`, ephemeral: true });
        }

        if (subCmd === 'listar') {
            const bounties = db.getActiveBounties();

            if (!bounties.length) {
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setTitle('🎯 Recompensas Ativas')
                            .setDescription('Não há nenhuma recompensa ativa no momento.')
                            .setFooter({ text: 'Ascended Bounty System' })
                            .setTimestamp()
                    ],
                    ephemeral: true
                });
            }

            const lines = bounties.map(b => {
                return `• **#${b.id}** — **${b.target_name}** | Recompensa: *${b.reward}*`;
            });

            const embed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('🎯 Quadro de Recompensas Ativas')
                .setDescription('Elimine qualquer um dos alvos abaixo para receber a recompensa:\n\n' + lines.join('\n'))
                .setFooter({ text: 'Ascended Bounty System' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }
    }
};
