'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const registerManager = require('../modules/registerManager');

module.exports = {
    name: 'confirmar-codigo',
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('confirmar-codigo')
        .setDescription('Confirma o código de 4 dígitos recebido por WhatsApp')
        .addStringOption(option =>
            option.setName('codigo')
                .setDescription('O código PIN de 4 dígitos enviado ao seu WhatsApp')
                .setRequired(true)
                .setMaxLength(4)
                .setMinLength(4)
        ),

    async executeSlash(interaction, { config }) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const pending = registerManager.pendingRegistrations[userId];

        if (!pending || pending.expiresAt < Date.now()) {
            return interaction.editReply({
                content: '❌ **Sua solicitação de registro expirou ou não foi encontrada!**\nPor favor, inicie o processo novamente usando o comando `/cadastrar`.'
            });
        }

        const enteredCode = interaction.options.getString('codigo').trim();

        if (enteredCode !== pending.code) {
            return interaction.editReply({
                content: '❌ **Código de verificação incorreto!**\nVerifique a mensagem enviada ao seu WhatsApp e tente digitar novamente.'
            });
        }

        try {
            const { handleRegistro, checkSpy } = require('./registro');
            const res = await handleRegistro(
                interaction.guild,
                interaction.user.id,
                pending.charName,
                interaction.member,
                pending.classCode,
                pending.bomba,
                '+' + pending.phone,
                config
            );

            // Executa a verificação de espiões (anti-spy) em segundo plano
            checkSpy(interaction.guild, pending.charName, interaction.user.id, config).catch(err => {
                console.error('[Spy-Detector] Erro no checkSpy em background:', err.message);
            });

            // Limpa o registro pendente da memória
            delete registerManager.pendingRegistrations[userId];
            registerManager.savePendingRegistrations();

            const descLines = [
                `👤 Discord: <@${interaction.user.id}>`,
                `📝 Novo Apelido: \`${res.newNick}\``,
                `🛡️ Classe/Cargo: \`${res.roleName}\``,
                `📲 WhatsApp: \`+${pending.phone}\``,
                '',
                '✅ **Seu WhatsApp foi vinculado e validado com sucesso!** Agora você receberá os alertas de pelegos (Masslog) da guilda automaticamente.',
                '',
                res.nicknameWarning,
                res.roleWarning,
                res.channelStatus
            ].filter(Boolean);

            const discordEmbed = new EmbedBuilder()
                .setColor(0x44FF88)
                .setTitle('🎉 Registro Concluído com Sucesso!')
                .setDescription(descLines.join('\n'))
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();

            // Envia confirmação de sucesso também via WhatsApp
            try {
                const whatsapp = require('../modules/whatsapp');
                const vocEmojis = { EK: '⚔️', ED: '🌳', RP: '🎯', MS: '✨', EM: '🧘' };
                const vocEmoji = vocEmojis[pending.classCode] || '';
                const discordUsername = interaction.user.username;
                const waSuccessMsg =
                    `🎉 *Registro Concluído com Sucesso!*\n\n` +
                    `👤 Discord: *${discordUsername}*\n` +
                    `📝 Personagem: *${res.newNick}* ${vocEmoji}\n` +
                    `🛡️ Classe/Cargo: *${res.roleName}*\n` +
                    `📲 WhatsApp: *+${pending.phone}*\n\n` +
                    `✅ Seu WhatsApp foi vinculado e validado com sucesso! Agora você receberá os alertas de pelegos (Masslog) da guilda automaticamente por aqui.\n\n` +
                    `⚠️ *Não se esqueça de manter este número salvo nos seus contatos!*`;
                await whatsapp.sendWhatsAppMessage(pending.phone, waSuccessMsg);
            } catch (errWa) {
                console.warn('[Registro Slash] Não foi possível enviar confirmação de sucesso via WhatsApp:', errWa.message);
            }

            return interaction.editReply({ embeds: [discordEmbed] });
        } catch (err) {
            console.error('[Registro Slash] Erro ao concluir registro:', err.message);
            return interaction.editReply({
                content: `❌ **Falha ao concluir o Registro:**\n${err.message}`
            });
        }
    }
};
