'use strict';

const fs = require('fs');
const path = require('path');
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const state = require('./state');
const phoneCrypto = require('./phoneCrypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PENDING_REG_PATH = path.join(DATA_DIR, 'pending_registrations.json');

// Dicionário em memória para guardar registros pendentes de verificação de WhatsApp
// Formato: { [discordId]: { charName, classCode, bomba, phone, jid, code, expiresAt } }
const pendingRegistrations = {};

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function savePendingRegistrations() {
    try {
        ensureDataDir();
        const toSave = {};
        for (const [discordId, pending] of Object.entries(pendingRegistrations)) {
            toSave[discordId] = {
                ...pending,
                phone: pending.phone ? phoneCrypto.encrypt(pending.phone) : pending.phone,
            };
        }
        fs.writeFileSync(PENDING_REG_PATH, JSON.stringify(toSave, null, 2), 'utf8');
    } catch (err) {
        console.error('[RegisterManager] Falha ao salvar registros pendentes:', err.message);
    }
}

function loadPendingRegistrations() {
    if (!fs.existsSync(PENDING_REG_PATH)) return;
    try {
        const content = fs.readFileSync(PENDING_REG_PATH, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object') {
            for (const discordId in parsed) {
                const pending = parsed[discordId];
                if (pending?.phone) {
                    pending.phone = phoneCrypto.decrypt(pending.phone);
                }
                pendingRegistrations[discordId] = pending;
            }
        }
    } catch (err) {
        console.error('[RegisterManager] Falha ao carregar registros pendentes:', err.message);
        return;
    }

    const now = Date.now();
    let changed = false;
    for (const discordId in pendingRegistrations) {
        const pending = pendingRegistrations[discordId];
        if (!pending || !pending.expiresAt || Number(pending.expiresAt) < now) {
            delete pendingRegistrations[discordId];
            changed = true;
        }
    }

    if (changed) {
        savePendingRegistrations();
    }
}

loadPendingRegistrations();

// Limpa registros pendentes expirados a cada 1 minuto
setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const discordId in pendingRegistrations) {
        if (pendingRegistrations[discordId].expiresAt < now) {
            delete pendingRegistrations[discordId];
            changed = true;
        }
    }
    if (changed) savePendingRegistrations();
}, 60 * 1000);

async function handleRegisterButtonClick(interaction, config) {
    const customId = interaction.customId;

    if (customId === 'register_start') {
        // Verifica se o usuário já possui registro no banco de dados
        const existing = db.getRegisteredMember(interaction.user.id);

        if (existing) {
            return interaction.reply({
                content: '💡 **Você já está registrado no clã!** Se precisar alterar seus dados (apelido, vocação, bomba ou telefone), por favor fale com um Administrador.',
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('modal_user_register')
            .setTitle('Registrar-se na Guilda');

        const charInput = new TextInputBuilder()
            .setCustomId('char_name')
            .setLabel('Seu Nick no Jogo')
            .setPlaceholder('Ex: Majin Ascended')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const classInput = new TextInputBuilder()
            .setCustomId('class_code')
            .setLabel('Sua Vocação (EK, ED, RP, MS ou EM)')
            .setPlaceholder('Digite apenas a sigla correspondente: EK, ED, RP, MS ou EM')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(2)
            .setMinLength(2)
            .setRequired(true);

        const bombaInput = new TextInputBuilder()
            .setCustomId('bomba')
            .setLabel('Nick do seu Bomba (Personagem secundário)')
            .setPlaceholder('Ex: Kit Immortal Bomba (Deve estar na guilda)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const phoneInput = new TextInputBuilder()
            .setCustomId('phone')
            .setLabel('Seu WhatsApp (Iniciar com + e cód. país)')
            .setPlaceholder('Ex: +5519989448376 (BR) ou +351912345678 (PT)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(charInput),
            new ActionRowBuilder().addComponents(classInput),
            new ActionRowBuilder().addComponents(bombaInput),
            new ActionRowBuilder().addComponents(phoneInput)
        );

        await interaction.showModal(modal);
    }
}

async function handleRegisterModalSubmit(interaction, config) {
    const customId = interaction.customId;

    if (customId === 'modal_user_register') {
        const rawCharName = interaction.fields.getTextInputValue('char_name').trim();
        const classCode = interaction.fields.getTextInputValue('class_code').trim().toUpperCase();
        const rawBomba = interaction.fields.getTextInputValue('bomba').trim();
        const phoneRaw = interaction.fields.getTextInputValue('phone').trim();

        // Limpa nomes de parênteses e espaços extras
        const charName = rawCharName.replace(/\s*\(.*?\)/g, '').trim();
        const bomba = rawBomba.replace(/\s*\(.*?\)/g, '').trim();

        // Validação da classe informada pelo usuário
        const validClasses = ['EK', 'ED', 'RP', 'MS', 'EM'];
        if (!validClasses.includes(classCode)) {
            return interaction.reply({
                content: `❌ **Vocação inválida!**\nPor favor, utilize apenas as siglas correspondentes:\n• **EK** (Elite Knight)\n• **ED** (Elder Druid)\n• **RP** (Royal Paladin)\n• **MS** (Master Sorcerer)\n• **EM** (Exalted Monk)\n\nClique no botão de registro e preencha novamente.`,
                ephemeral: true
            });
        }

        // Importa helpers para validar o bomba
        const { isNone } = require('../commands/registro');

        // Validação da bomba (obrigatória e não pode ser nenhuma)
        if (isNone(bomba)) {
            return interaction.reply({
                content: `❌ **Personagem bomba obrigatório!**\nVocê deve informar o nome do seu personagem bomba secundário, e ele deve estar presente na guilda no jogo.`,
                ephemeral: true
            });
        }

        // Validação do telefone informado pelo usuário (deve iniciar com +)
        if (!phoneRaw.trim().startsWith('+')) {
            return interaction.reply({
                content: `❌ **Formato de WhatsApp inválido!**\nO número de WhatsApp deve, obrigatoriamente, iniciar com o caractere **+** e o código de país (ex: **+5519989448376** para Brasil, **+351912345678** para Portugal).\n\nClique no botão de registro e tente novamente.`,
                ephemeral: true
            });
        }

        const cleanPhone = phoneRaw.replace(/\D/g, '');
        if (cleanPhone.length < 8) {
            return interaction.reply({
                content: `❌ **Número de WhatsApp inválido!**\nPor favor, informe seu número completo incluindo o código do país (ex: **+5519989448376**).\n\nClique no botão de registro e tente novamente.`,
                ephemeral: true
            });
        }

        // Gera um PIN de 4 dígitos e armazena o registro pendente (expiração 5 minutos)
        const pin = String(Math.floor(1000 + Math.random() * 9000));

        const whatsapp = require('./whatsapp');
        const resolvedJid = await whatsapp.resolveWhatsAppNumberId(cleanPhone);
        const cleanJid = resolvedJid ? resolvedJid.replace(/\D/g, '') : null;

        pendingRegistrations[interaction.user.id] = {
            charName,
            classCode,
            bomba,
            phone: cleanPhone,
            jid: cleanJid,
            code: pin,
            expiresAt: Date.now() + 5 * 60 * 1000
        };
        savePendingRegistrations();

        const waSent = await whatsapp.sendWhatsAppMessage(cleanPhone,
            `🤖 *Ascended Bot • Verificação*\n\n` +
            `Seu código de confirmação para concluir o registro na guilda é: *${pin}*\n\n` +
            `⚠️ *IMPORTANTE:* Salve este número nos contatos do seu celular para garantir que você receba todos os alertas de guerra e convocações!`
        );

        const waStatus = whatsapp.getStatus();
        const isWaConnected = waStatus.status === 'connected';
        const connectionNote = isWaConnected
            ? ''
            : `\n\n⚠️ *ATENÇÃO:* O WhatsApp do bot está desconectado no momento e não pode enviar o código automaticamente. Assim que o bot reconectar, você deverá tentar novamente ou pedir ajuda a um administrador.`;

        const sendNote = waSent
            ? ''
            : `\n\n⚠️ Não foi possível enviar o código automaticamente via WhatsApp. Se você não receber, envie a palavra *codigo* para este número ou avise um administrador.` + connectionNote;

        console.log(`[Registro Interativo] Registro pendente criado para ${interaction.user.tag} — PIN: ${pin} — WhatsApp: ${cleanPhone} — enviado: ${waSent}`);

        const embed = new EmbedBuilder()
            .setColor(0xFF8C00)
            .setTitle('📲 Verificação de WhatsApp Requerida')
            .setDescription(
                `Para concluir o seu registro, você precisa verificar seu número de WhatsApp.\n\n` +
                `🔔 O código de verificação foi enviado para: **+${cleanPhone}**${sendNote}\n\n` +
                `🔗 *Se preferir, você também pode abrir a conversa com o bot manualmente:* ` +
                `https://wa.me/5511926007896?text=codigo\n\n` +
                `Depois que o bot responder com o código no seu WhatsApp, clique no botão **Digitar Código** abaixo para concluir.`
            )
            .setFooter({ text: 'O código expira em 5 minutos' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('register_verify_code')
                .setLabel('🔑 Digitar Código')
                .setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
}

async function handleVerifyCodeButtonClick(interaction) {
    const customId = interaction.customId;

    if (customId === 'register_verify_code') {
        const pending = pendingRegistrations[interaction.user.id];

        if (!pending || pending.expiresAt < Date.now()) {
            return interaction.reply({
                content: '❌ **Sua solicitação de registro expirou ou não foi encontrada!**\nPor favor, feche esta mensagem e inicie o registro novamente clicando em "Iniciar Registro".',
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('modal_verify_code')
            .setTitle('Confirmar Código de WhatsApp');

        const codeInput = new TextInputBuilder()
            .setCustomId('verification_code')
            .setLabel('Código de 4 dígitos recebido no WhatsApp')
            .setPlaceholder('Ex: 1234')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(4)
            .setMinLength(4)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
        await interaction.showModal(modal);
    }
}

async function handleVerifyCodeModalSubmit(interaction, config) {
    const customId = interaction.customId;

    if (customId === 'modal_verify_code') {
        const pending = pendingRegistrations[interaction.user.id];

        if (!pending || pending.expiresAt < Date.now()) {
            return interaction.reply({
                content: '❌ **Sua solicitação de registro expirou ou não foi encontrada!**\nPor favor, inicie o processo novamente.',
                ephemeral: true
            });
        }

        const enteredCode = interaction.fields.getTextInputValue('verification_code').trim();

        if (enteredCode !== pending.code) {
            return interaction.reply({
                content: '❌ **Código de verificação incorreto!**\nVerifique a mensagem enviada ao seu WhatsApp e tente digitar novamente clicando no botão "Digitar Código".',
                ephemeral: true
            });
        }

        // Defer reply ephemeramente para completar o cadastro no banco e cargos
        await interaction.deferReply({ ephemeral: true });

        try {
            const { handleRegistro, checkSpy } = require('../commands/registro');
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
            delete pendingRegistrations[interaction.user.id];
            savePendingRegistrations();

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
                const whatsapp = require('./whatsapp');
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
                console.warn('[Registro Interativo] Não foi possível enviar confirmação de sucesso via WhatsApp:', errWa.message);
            }

            return interaction.editReply({ embeds: [discordEmbed], components: [] });
        } catch (err) {
            console.error('[Registro Interativo] Erro ao concluir registro:', err.message);
            return interaction.editReply({
                content: `❌ **Falha ao concluir o Registro:**\n${err.message}`,
                embeds: [],
                components: []
            });
        }
    }
}

module.exports = {
    handleRegisterButtonClick,
    handleRegisterModalSubmit,
    handleVerifyCodeButtonClick,
    handleVerifyCodeModalSubmit,
    pendingRegistrations, // Exportado para uso pelo handler inbound do WhatsApp
    savePendingRegistrations
};
