'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../modules/database');
const registerManager = require('../modules/registerManager');
const whatsapp = require('../modules/whatsapp');
const { isNone } = require('./registro');

module.exports = {
    name: 'cadastrar',
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('cadastrar')
        .setDescription('Inicia o seu registro no clã (alternativa sem janelas/modals)')
        .addStringOption(option =>
            option.setName('nickname')
                .setDescription('Nick do seu personagem principal no jogo (deve estar na guilda)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('classe')
                .setDescription('Sua vocação principal')
                .setRequired(true)
                .addChoices(
                    { name: 'EK (Elite Knight)', value: 'EK' },
                    { name: 'ED (Elder Druid)', value: 'ED' },
                    { name: 'RP (Royal Paladin)', value: 'RP' },
                    { name: 'MS (Master Sorcerer)', value: 'MS' },
                    { name: 'EM (Exalted Monk)', value: 'EM' }
                )
        )
        .addStringOption(option =>
            option.setName('bomba')
                .setDescription('Nick do seu personagem bomba secundário (deve estar na guilda)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('telefone')
                .setDescription('Seu WhatsApp completo com o caractere + (Ex: +5519989448376)')
                .setRequired(true)
        ),

    async executeSlash(interaction, { config }) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        const nickname = interaction.options.getString('nickname').trim();
        const classCode = interaction.options.getString('classe').trim().toUpperCase();
        const bomba = interaction.options.getString('bomba').trim();
        const phoneRaw = interaction.options.getString('telefone').trim();

        // 1. Verificar se já está registrado
        const existing = db.getRegisteredMember(userId);
        const hasRole = interaction.member?.roles?.cache?.some(r => r.name.toLowerCase() === 'registrado');

        if (existing || hasRole) {
            return interaction.editReply({
                content: '💡 **Você já está registrado no clã!** Se precisar alterar seus dados, por favor fale com um Administrador.'
            });
        }

        // 2. Validar bomba
        if (isNone(bomba)) {
            return interaction.editReply({
                content: '❌ **Personagem bomba obrigatório!** Você deve informar o nome do seu personagem bomba secundário presente na guilda.'
            });
        }

        // 3. Validar telefone
        if (!phoneRaw.startsWith('+')) {
            return interaction.editReply({
                content: '❌ **Formato de WhatsApp inválido!** O número deve iniciar com **+** seguido pelo código do país (ex: **+5519989448376**).'
            });
        }

        const cleanPhone = phoneRaw.replace(/\D/g, '');
        if (cleanPhone.length < 8) {
            return interaction.editReply({
                content: '❌ **Número de WhatsApp inválido!** Por favor, informe seu número completo com o código do país (ex: **+5519989448376**).'
            });
        }

        // 4. Gerar PIN
        const pin = String(Math.floor(1000 + Math.random() * 9000));

        // 5. Salvar registro pendente
        const resolvedJid = await whatsapp.resolveWhatsAppNumberId(cleanPhone);
        const cleanJid = resolvedJid ? resolvedJid.replace(/\D/g, '') : null;

        registerManager.pendingRegistrations[userId] = {
            charName: nickname,
            classCode,
            bomba,
            phone: cleanPhone,
            jid: cleanJid,
            code: pin,
            expiresAt: Date.now() + 5 * 60 * 1000
        };
        registerManager.savePendingRegistrations();

        // 6. Enviar código via WhatsApp
        const waSent = await whatsapp.sendWhatsAppMessage(cleanPhone,
            `🤖 *Ascended Bot • Verificação*\n\n` +
            `Seu código de confirmação para concluir o registro na guilda é: *${pin}*\n\n` +
            `⚠️ *IMPORTANTE:* Salve este número nos contatos do seu celular para garantir que você receba todos os alertas de guerra e convocações!`
        );

        const waStatus = whatsapp.getStatus();
        const isWaConnected = waStatus.status === 'connected';
        const connectionNote = isWaConnected
            ? ''
            : `\n\n⚠️ *ATENÇÃO:* O WhatsApp do bot está desconectado no momento e não pode enviar o código automaticamente.`;

        const sendNote = waSent
            ? ''
            : `\n\n⚠️ Não foi possível enviar o código automaticamente via WhatsApp. Se você não receber, envie a palavra *codigo* para o bot ou avise um administrador.` + connectionNote;

        console.log(`[Registro Slash] Registro pendente criado para ${interaction.user.tag} — PIN: ${pin} — WhatsApp: ${cleanPhone} — enviado: ${waSent}`);

        const embed = new EmbedBuilder()
            .setColor(0xFF8C00)
            .setTitle('📲 Verificação de WhatsApp Requerida')
            .setDescription(
                `Para concluir o seu registro, você precisa verificar seu número de WhatsApp.\n\n` +
                `🔔 O código de verificação foi enviado para: **+${cleanPhone}**${sendNote}\n\n` +
                `🔗 *Se preferir, você também pode abrir a conversa com o bot manualmente:* ` +
                `https://wa.me/5511926007896?text=codigo\n\n` +
                `Após receber o código de 4 dígitos no WhatsApp, digite o comando **\`/confirmar-codigo codigo: <seu código>\`** aqui no Discord para concluir o seu cadastro.`
            )
            .setFooter({ text: 'O código expira em 5 minutos' });

        return interaction.editReply({ embeds: [embed] });
    }
};
