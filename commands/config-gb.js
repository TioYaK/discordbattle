'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../modules/database');

function buildOkEmbed(msg) {
    return new EmbedBuilder()
        .setColor(0x44FF88)
        .setDescription(`✅ ${msg}`);
}

module.exports = {
    name: 'config-gb',
    aliases: ['gb-config', 'banco-guilda'],
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('config-gb')
        .setDescription('Configura todos os parâmetros do Guild Bank (Taxas) de uma vez')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild)
        .addStringOption(opt =>
            opt.setName('personagem_gb')
                .setDescription('Nome do personagem que receberá o dinheiro in-game')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('taxa_padrao')
                .setDescription('Valor da taxa padrão (ex: 500 RC)')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('taxa_planilhado')
                .setDescription('Valor da taxa para planilhados (ex: 1000 RC)')
                .setRequired(true)
        )
        .addRoleOption(opt =>
            opt.setName('cargo_taxa')
                .setDescription('Cargo que será dado automaticamente ao pagar')
                .setRequired(false)
        ),

    async executeSlash(interaction, { config, saveConfig }) {
        const personagemGb = interaction.options.getString('personagem_gb');
        const taxaPadrao = interaction.options.getString('taxa_padrao');
        const taxaPlanilhado = interaction.options.getString('taxa_planilhado');
        const cargoTaxa = interaction.options.getRole('cargo_taxa');

        // Update Configs
        config.guildBankName = personagemGb;
        db.setConfig('guildBankName', personagemGb);

        config.taxValue = taxaPadrao;
        db.setConfig('taxValue', taxaPadrao);

        config.taxPlanilhadoValue = taxaPlanilhado;
        db.setConfig('taxPlanilhadoValue', taxaPlanilhado);

        // Auto-ativar o sistema
        config.taxEnabled = 'true';
        db.setConfig('taxEnabled', 'true');

        let cargoMsg = '';
        if (cargoTaxa) {
            config.cargoTaxa = cargoTaxa.id;
            db.setConfig('cargoTaxa', cargoTaxa.id);
            cargoMsg = `\n**Cargo de Taxa Paga:** <@&${cargoTaxa.id}>`;
        } else {
            // Keep existing if not provided
            const existingCargo = db.getConfig('cargoTaxa');
            if (existingCargo) {
                cargoMsg = `\n**Cargo de Taxa Paga:** <@&${existingCargo}> (Mantido)`;
            }
        }

        saveConfig(config);

        const embed = new EmbedBuilder()
            .setColor(0xF1C40F) // Amarelo (Gold)
            .setTitle('🏦 Configuração do Guild Bank')
            .setDescription(
                `As configurações de taxa foram atualizadas com sucesso!\n\n` +
                `**Personagem Recebedor (GB):** \`${personagemGb}\`\n` +
                `**Taxa Padrão Mensal:** \`${taxaPadrao}\`\n` +
                `**Taxa Planilhados:** \`${taxaPlanilhado}\`` +
                cargoMsg
            )
            .setFooter({ text: 'Ascended Bot • Guild Bank' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    },

    async execute(msg, args, { config }) {
        return msg.reply('⚠️ Por favor, use o comando `/config-gb` (Slash Command) para configurar as taxas do Guild Bank, é muito mais fácil e rápido!');
    }
};
