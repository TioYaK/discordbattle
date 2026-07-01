'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const whatsapp = require('../modules/whatsapp');
const fs = require('fs');
const path = require('path');

const db = require('../modules/database');
const state = require('../modules/state');

function isUserAdmin(member, config) {
    if (!member) return false;
    let hasAdmin = false;
    try {
        hasAdmin = member.permissions && (member.permissions.has('Administrator') || member.permissions.has('ManageGuild'));
    } catch (e) {}
    
    let hasRole = false;
    if (config.adminRoleId) {
        if (member.roles && member.roles.cache) {
            hasRole = member.roles.cache.has(config.adminRoleId);
        } else if (Array.isArray(member.roles)) {
            hasRole = member.roles.includes(config.adminRoleId);
        }
    }
    return hasAdmin || hasRole;
}

function getOnboardingEmbed(botNumber) {
    return new EmbedBuilder()
        .setColor(0x00E676) // WhatsApp green
        .setTitle('📞 Como Vincular seu WhatsApp ao Bot')
        .setDescription(
            'Siga o passo a passo abaixo para começar a interagir com o bot diretamente pelo seu WhatsApp:\n\n' +
            '1️⃣ **Inicie a conversa:**\n' +
            (botNumber 
                ? `Clique no link a seguir para abrir o chat com o bot e envie a mensagem pré-definida:\n👉 **[CLIQUE AQUI PARA ABRIR O WHATSAPP](https://wa.me/${botNumber}?text=-ajuda)**\n\n`
                : `⚠️ **O WhatsApp do bot está desconectado no momento.**\nPeça para um administrador conectar o WhatsApp usando \`/whatsapp status\` ou \`!whatsapp conectar\` primeiro.\n\n`) +
            '2️⃣ **Obtenha seu código:**\n' +
            'O bot responderá no WhatsApp informando que seu número não está vinculado e apresentará um comando de vínculo contendo o seu ID único.\n\n' +
            '3️⃣ **Vincule sua conta:**\n' +
            'Copie o comando fornecido pelo bot no WhatsApp (ou apenas o ID) e envie aqui no Discord:\n' +
            '• Por comando Slash: `/whatsapp link id:<seu_id>`\n' +
            '• Por comando de texto: `!whatsapp link <seu_id>`\n\n' +
            '_Dica: A mensagem do comando de texto `!whatsapp link` será apagada automaticamente após o envio para garantir a privacidade do seu número._'
        )
        .setFooter({ text: 'Ascended Bot • Integração WhatsApp' })
        .setTimestamp();
}

module.exports = {
    name: 'whatsapp',
    aliases: ['wa', 'zap'],
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('whatsapp')
        .setDescription('Gerencia a conexão ou vincula sua conta do WhatsApp')
        .addSubcommand(sub =>
            sub.setName('iniciar')
                .setDescription('Inicia o processo de vinculação do seu WhatsApp com o bot')
        )
        .addSubcommand(sub =>
            sub.setName('link')
                .setDescription('Vincula o seu WhatsApp ao bot usando o ID fornecido pelo WhatsApp')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('ID do WhatsApp (LID ou JID)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('tutorial')
                .setDescription('Posta o tutorial passo a passo de vinculação do WhatsApp neste canal (Admin apenas)')
        )
        .addSubcommand(sub =>
            sub.setName('testar')
                .setDescription('Envia uma mensagem de teste "." para todos os membros cadastrados no WhatsApp (Admin apenas)')
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Mostra o status de conexão atual ou exibe o QR code se necessário')
        )
        .addSubcommand(sub =>
            sub.setName('conectar')
                .setDescription('Força a inicialização e reconexão do WhatsApp')
        )
        .addSubcommand(sub =>
            sub.setName('desconectar')
                .setDescription('Desconecta o WhatsApp e limpa os dados da sessão atual')
        )
        .addSubcommand(sub =>
            sub.setName('parear')
                .setDescription('Conecta o WhatsApp do bot via Código de Pareamento (Admin apenas)')
                .addStringOption(option =>
                    option.setName('numero')
                        .setDescription('Número de telefone do WhatsApp com DDI (ex: 5511999999999)')
                        .setRequired(true)
                )
        ),

    async execute(msg, args, { client, config }) {
        console.log('[WhatsApp Command] execute started');
        const sub = args[0]?.toLowerCase() || 'status';
        console.log('[WhatsApp Command] sub:', sub);

        // Subcomando iniciar disponível para todos
        if (sub === 'iniciar') {
            const botNumber = whatsapp.getBotNumber();
            const embed = getOnboardingEmbed(botNumber);
            return msg.reply({ embeds: [embed] });
        }

        // Subcomando testar disponível apenas para admins (para evitar abuso)
        if (sub === 'testar') {
            if (whatsapp.getStatus().status !== 'connected') {
                return msg.reply('❌ O bot não está conectado ao WhatsApp.');
            }
            if (!isUserAdmin(msg.member, config)) {
                return msg.reply('🚫 Apenas administradores podem disparar o envio de teste.');
            }
            
            const rows = db.db.prepare("SELECT char_name, phone FROM registered_members WHERE phone IS NOT NULL AND phone != '' AND phone != '-'").all();
            await msg.reply(`🔄 Iniciando envio de teste "." para ${rows.length} membros no WhatsApp...`);
            
            let successCount = 0;
            for (const row of rows) {
                // Personalize and randomize greeting
                const greetings = [
                    `Olá, *${row.char_name}*!\n`,
                    `Ei, *${row.char_name}*!\n`,
                    `Tudo bem, *${row.char_name}*?\n`,
                    `Aviso para *${row.char_name}*:\n`
                ];
                const greeting = greetings[Math.floor(Math.random() * greetings.length)];
                
                // Add timestamp and random tag to footer to ensure uniqueness
                const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const randomHash = Math.random().toString(36).substring(2, 6).toUpperCase();
                const testMsg = greeting + `Este é um teste rápido de comunicação do bot.` + `\n\n_[Ref: ${timeStr} | ${randomHash}]_`;

                const sent = await whatsapp.sendWhatsAppMessage(row.phone, testMsg);
                if (sent) successCount++;
                
                // Delay randômico seguro entre 3 e 7 segundos
                const delay = Math.floor(Math.random() * (7000 - 3000 + 1)) + 3000;
                await new Promise(r => setTimeout(r, delay));
            }
            
            return msg.channel.send(`🎉 Envio de teste finalizado! Mensagens entregues com sucesso: **${successCount}/${rows.length}**`);
        }

        // Subcomando link disponível para todos
        if (sub === 'link') {
            const rawJid = args[1];
            if (!rawJid) {
                return msg.reply('⚠️ Forneça o ID do WhatsApp. Uso: `!whatsapp link <ID>`');
            }
            
            // Apaga a mensagem do usuário imediatamente para evitar vazamento do ID
            msg.delete().catch(() => {});

            const jid = rawJid.split('@')[0].split(':')[0].trim();
            const reg = db.getRegisteredMember(msg.author.id);
            if (!reg) {
                const errorReply = await msg.channel.send(`<@${msg.author.id}> ❌ Você não está registrado no bot. Use \`!registro\` primeiro.`);
                setTimeout(() => errorReply.delete().catch(() => {}), 8000);
                return;
            }
            
            db.db.prepare('UPDATE registered_members SET phone = ? WHERE discord_id = ?').run(jid, msg.author.id);
            
            const successReply = await msg.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x44FF88)
                        .setTitle('✅ WhatsApp Vinculado')
                        .setDescription(`Seu WhatsApp foi vinculado com sucesso ao usuário **${reg.char_name}**!\n_(Mensagem temporária, será apagada em 8 segundos)_`)
                ]
            });
            
            // Apaga a mensagem de sucesso após 8 segundos
            setTimeout(() => successReply.delete().catch(() => {}), 8000);
            return;
        }

        // Tutorial subcommand is admin only
        if (sub === 'tutorial') {
            if (!isUserAdmin(msg.member, config)) {
                return msg.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF4444)
                            .setTitle('🚫 Acesso Negado')
                            .setDescription('Apenas administradores podem postar o tutorial do WhatsApp.')
                    ]
                });
            }
            const botNumber = whatsapp.getBotNumber();
            const embed = getOnboardingEmbed(botNumber);
            return msg.channel.send({ embeds: [embed] });
        }

        // Redireciona não-admin no status para o onboarding
        if (sub === 'status' && !isUserAdmin(msg.member, config)) {
            const botNumber = whatsapp.getBotNumber();
            const embed = getOnboardingEmbed(botNumber);
            return msg.reply({ embeds: [embed] });
        }

        // Subcomandos administrativos exigem permissão de admin
        if (!isUserAdmin(msg.member, config)) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Acesso Negado')
                        .setDescription('Apenas administradores podem gerenciar a conexão do WhatsApp.')
                ]
            });
        }

        if (sub === 'conectar') {
            console.log('[WhatsApp Command] sub is conectar');
            whatsapp.init(client);
            return msg.channel.send({
                content: `<@${msg.author.id}>`,
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x44FF88)
                        .setTitle('📞 WhatsApp: Inicializando')
                        .setDescription('A conexão do WhatsApp está sendo inicializada. Use `!whatsapp` em alguns segundos para verificar o status ou ver o QR code.')
                ]
            });
        }

        if (sub === 'desconectar') {
            console.log('[WhatsApp Command] sub is desconectar');
            await whatsapp.disconnect();
            return msg.channel.send({
                content: `<@${msg.author.id}>`,
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('📞 WhatsApp: Desconectado')
                        .setDescription('O cliente WhatsApp foi desconectado e a sessão local foi removida. Para conectar novamente, use `!whatsapp conectar`.')
                ]
            });
        }

        if (sub === 'parear') {
            if (!isUserAdmin(msg.member, config)) {
                return msg.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF4444)
                            .setTitle('🚫 Acesso Negado')
                            .setDescription('Apenas administradores podem parear o WhatsApp do bot.')
                    ]
                });
            }

            const rawPhone = args[1];
            if (!rawPhone) {
                return msg.reply('⚠️ Por favor, informe o número de telefone com DDI (ex: `!whatsapp parear 5511999999999`).');
            }

            const normalized = rawPhone.replace(/\D/g, '');
            if (!normalized || normalized.length < 8) {
                return msg.reply('⚠️ Número de telefone inválido. Certifique-se de incluir o DDI (ex: 55 para Brasil) e o número correto.');
            }

            state.whatsappPairingCode = null;

            // Desconecta e limpa a sessão antiga antes de definir o novo número
            await whatsapp.disconnect();
            
            // Grava o novo número de pareamento no banco
            db.setConfig('whatsapp_pairing_phone', normalized);
            whatsapp.init(client);

            return msg.channel.send({
                content: `<@${msg.author.id}>`,
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x00E676)
                        .setTitle('📞 Inicializando Pareamento por Código')
                        .setDescription(`Iniciando o processo de pareamento para o número **+${normalized}**.\n\nAguarde cerca de 10 segundos e use o comando \`!whatsapp status\` para obter o código de pareamento de 8 dígitos.`)
                ]
            });
        }

        // Default: status
        console.log('[WhatsApp Command] getting status...');
        const { status, hasQr, qrBuffer } = whatsapp.getStatus();

        const pairingPhone = db.getConfig('whatsapp_pairing_phone');
        if (status !== 'connected' && pairingPhone) {
            let statusText = '⏳ Gerando Código...';
            let color = 0xFF8C00;
            let description = `O bot está solicitando o código de pareamento para o número **+${pairingPhone}**.\n\nPor favor, aguarde de 5 a 10 segundos e use o comando \`!whatsapp status\` novamente para visualizar o código.`;

            if (state.whatsappPairingCode) {
                statusText = '🔑 Código de Pareamento Pronto';
                color = 0x00E676;
                const code = state.whatsappPairingCode;
                const formattedCode = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
                description = `Para conectar o bot ao WhatsApp do número **+${pairingPhone}**, siga os passos abaixo:\n\n` +
                    `1️⃣ Abra o WhatsApp no celular do número **+${pairingPhone}**.\n` +
                    `2️⃣ Vá em **Aparelhos Conectados** (Configurações > Aparelhos Conectados).\n` +
                    `3️⃣ Toque em **Conectar um aparelho**.\n` +
                    `4️⃣ Toque em **Conectar com número de telefone** na parte inferior.\n` +
                    `5️⃣ Digite o seguinte código no seu celular:\n\n` +
                    `👉 🏆 **\`\`\`${formattedCode}\`\`\`** 🏆\n\n` +
                    `⚠️ *Nota:* Esse código expira em alguns minutos. Se expirar, solicite o pareamento novamente.`;
            }

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle('📞 Pareamento do WhatsApp')
                .setDescription(description)
                .setFooter({ text: 'Ascended Bot • WhatsApp Pairing' })
                .setTimestamp();

            return msg.channel.send({ content: `<@${msg.author.id}>`, embeds: [embed] });
        }
        console.log('[WhatsApp Command] status:', status, 'hasQr:', hasQr);

        let statusText = 'Desconhecido';
        let color = 0x808080;
        let description = 'Use `!whatsapp conectar` para iniciar a sessão.';

        if (status === 'disconnected') {
            statusText = '❌ Desconectado';
            color = 0xFF4444;
            description = 'O bot não está conectado ao WhatsApp. Use `!whatsapp conectar` para iniciar a sessão e gerar o QR Code.';
        } else if (status === 'connecting') {
            statusText = '⏳ Conectando...';
            color = 0xFF8C00;
            description = 'O bot está iniciando o WhatsApp Web em segundo plano. Por favor, aguarde alguns segundos.';
        } else if (status === 'qr_ready') {
            statusText = '🔑 Aguardando Scan (QR Code)';
            color = 0xFF8C00;
            description = 'Escaneie o código QR abaixo com o seu celular no WhatsApp (Aparelhos Conectados) para realizar o login.';
        } else if (status === 'connected') {
            statusText = '🟢 Conectado';
            color = 0x44FF88;
            description = 'O bot está conectado com sucesso ao WhatsApp e pronto para enviar mensagens!';
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle('📞 Status do WhatsApp')
            .setDescription(`**Status:** ${statusText}\n\n${description}`)
            .setFooter({ text: 'Ascended Bot • WhatsApp Integration' })
            .setTimestamp();

        if (status === 'qr_ready') {
            if (qrBuffer) {
                try {
                    const qrPath = path.join(__dirname, '..', 'data', 'temp_qr.png');
                    fs.writeFileSync(qrPath, qrBuffer);

                    // Try to upload to tmpfiles.org to bypass Discord multipart socket issues
                    let directUrl = null;
                    try {
                        const { execSync } = require('child_process');
                        const responseText = execSync(`curl.exe -s -F "file=@${qrPath}" https://tmpfiles.org/api/v1/upload`, { encoding: 'utf8' }).trim();
                        const result = JSON.parse(responseText);
                        if (result.status === 'success' && result.data && result.data.url) {
                            directUrl = result.data.url.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');
                        }
                    } catch (uploadErr) {
                        console.warn('[WhatsApp Command] Failed uploading to tmpfiles.org:', uploadErr.message);
                    }

                    if (directUrl) {
                        embed.setImage(directUrl);
                        console.log('[WhatsApp Command] sending channel.send with hosted QR code...');
                        const res = await msg.channel.send({
                            content: `<@${msg.author.id}> 🔑 QR Code de pareamento do WhatsApp enviado abaixo!`,
                            embeds: [embed]
                        });
                        return res;
                    } else {
                        // Fallback to local attachment upload
                        embed.setImage('attachment://qr.png');
                        const attachment = new AttachmentBuilder(qrPath, { name: 'qr.png' });
                        console.log('[WhatsApp Command] sending channel.send with standard attachment...');
                        const res = await msg.channel.send({
                            content: `<@${msg.author.id}>`,
                            embeds: [embed],
                            files: [attachment]
                        });
                        console.log('[WhatsApp Command] channel.send sent successfully with attachment, ID:', res.id);
                        return res;
                    }
                } catch (err) {
                    console.error('[WhatsApp Command] error sending channel.send with attachment:', err.message, err.stack);
                    throw err;
                }
            }
        }

        try {
            console.log('[WhatsApp Command] sending channel.send without attachment...');
            const res = await msg.channel.send({ content: `<@${msg.author.id}>`, embeds: [embed] });
            console.log('[WhatsApp Command] channel.send sent successfully, ID:', res.id);
            return res;
        } catch (err) {
            console.error('[WhatsApp Command] error sending channel.send without attachment:', err.message, err.stack);
            throw err;
        }
    },

    async executeSlash(interaction, { config }) {
        console.log('[WhatsApp Command] executeSlash started');
        const sub = interaction.options.getSubcommand(false);
        const client = interaction.client;
        console.log('[WhatsApp Command] sub (Slash):', sub);

        // Defer reply: link, iniciar and parear are ephemeral to protect phone numbers/linking privacy
        const isEphemeral = ['link', 'iniciar', 'parear'].includes(sub);
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: isEphemeral });
        }

        // Subcomando iniciar disponível para todos
        if (sub === 'iniciar') {
            const botNumber = whatsapp.getBotNumber();
            const embed = getOnboardingEmbed(botNumber);
            return interaction.editReply({ embeds: [embed] });
        }

        // Subcomando testar disponível apenas para admins (para evitar abuso)
        if (sub === 'testar') {
            if (whatsapp.getStatus().status !== 'connected') {
                return interaction.reply({ content: '❌ O bot não está conectado ao WhatsApp.', ephemeral: true });
            }
            if (!isUserAdmin(interaction.member, config)) {
                return interaction.editReply('🚫 Apenas administradores podem disparar o envio de teste.');
            }
            
            const rows = db.db.prepare("SELECT char_name, phone FROM registered_members WHERE phone IS NOT NULL AND phone != '' AND phone != '-'").all();
            await interaction.editReply(`🔄 Iniciando envio de teste "." para ${rows.length} membros no WhatsApp...`);
            
            let successCount = 0;
            for (const row of rows) {
                const sent = await whatsapp.sendWhatsAppMessage(row.phone, '.');
                if (sent) successCount++;
                await new Promise(r => setTimeout(r, 400));
            }
            
            return interaction.channel.send(`🎉 Envio de teste finalizado! Mensagens entregues com sucesso: **${successCount}/${rows.length}**`);
        }

        // Subcomando link disponível para todos
        if (sub === 'link') {
            const rawJid = interaction.options.getString('id');
            const jid = rawJid.split('@')[0].split(':')[0].trim();
            const reg = db.getRegisteredMember(interaction.user.id);
            if (!reg) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF4444)
                            .setTitle('❌ Erro de Vínculo')
                            .setDescription('Você não está registrado no bot. Use `!registro` primeiro.')
                    ]
                });
            }
            db.db.prepare('UPDATE registered_members SET phone = ? WHERE discord_id = ?').run(jid, interaction.user.id);
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x44FF88)
                        .setTitle('✅ WhatsApp Vinculado')
                        .setDescription(`O ID **${jid}** foi vinculado com sucesso ao seu usuário **${reg.char_name}**!`)
                ]
            });
        }

        // Tutorial subcommand is admin only
        if (sub === 'tutorial') {
            if (!isUserAdmin(interaction.member, config)) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF4444)
                            .setTitle('🚫 Acesso Negado')
                            .setDescription('Apenas administradores podem postar o tutorial do WhatsApp.')
                    ]
                });
            }
            const botNumber = whatsapp.getBotNumber();
            const embed = getOnboardingEmbed(botNumber);
            await interaction.channel.send({ embeds: [embed] });
            return interaction.editReply({ content: '✅ O tutorial foi postado com sucesso neste canal!' });
        }

        // Redireciona não-admin no status para o onboarding
        if (sub === 'status' && !isUserAdmin(interaction.member, config)) {
            const botNumber = whatsapp.getBotNumber();
            const embed = getOnboardingEmbed(botNumber);
            return interaction.editReply({ embeds: [embed] });
        }

        // Subcomandos administrativos exigem permissão de admin
        if (!isUserAdmin(interaction.member, config)) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('🚫 Acesso Negado')
                        .setDescription('Apenas administradores podem gerenciar a conexão do WhatsApp.')
                ]
            });
        }

        if (sub === 'conectar') {
            console.log('[WhatsApp Command] sub (Slash) is conectar');
            whatsapp.init(client);
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x44FF88)
                        .setTitle('📞 WhatsApp: Inicializando')
                        .setDescription('A conexão do WhatsApp está sendo inicializada. Use `/whatsapp status` em alguns segundos para verificar o status ou ver o QR code.')
                ]
            });
        }

        if (sub === 'desconectar') {
            console.log('[WhatsApp Command] sub (Slash) is desconectar');
            await whatsapp.disconnect();
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('📞 WhatsApp: Desconectado')
                        .setDescription('O cliente WhatsApp foi desconectado e a sessão local foi removida. Para conectar novamente, use `/whatsapp conectar`.')
                ]
            });
        }

        if (sub === 'parear') {
            if (!isUserAdmin(interaction.member, config)) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF4444)
                            .setTitle('🚫 Acesso Negado')
                            .setDescription('Apenas administradores podem parear o WhatsApp do bot.')
                    ]
                });
            }

            const rawPhone = interaction.options.getString('numero');
            const normalized = rawPhone.replace(/\D/g, '');
            if (!normalized || normalized.length < 8) {
                return interaction.editReply('⚠️ Número de telefone inválido. Certifique-se de incluir o DDI (ex: 55 para Brasil) e o número correto.');
            }

            state.whatsappPairingCode = null;

            // Desconecta e limpa a sessão antiga antes de definir o novo número
            await whatsapp.disconnect();
            
            // Grava o novo número de pareamento no banco
            db.setConfig('whatsapp_pairing_phone', normalized);
            whatsapp.init(client);

            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x00E676)
                        .setTitle('📞 Inicializando Pareamento por Código')
                        .setDescription(`Iniciando o processo de pareamento para o número **+${normalized}**.\n\nAguarde cerca de 10 segundos e use o comando \`/whatsapp status\` para obter o código de pareamento de 8 dígitos.`)
                ]
            });
        }

        // status
        console.log('[WhatsApp Command] getting status (Slash)...');
        const { status, hasQr, qrBuffer } = whatsapp.getStatus();

        const pairingPhone = db.getConfig('whatsapp_pairing_phone');
        if (status !== 'connected' && pairingPhone) {
            let statusText = '⏳ Gerando Código...';
            let color = 0xFF8C00;
            let description = `O bot está solicitando o código de pareamento para o número **+${pairingPhone}**.\n\nPor favor, aguarde de 5 a 10 segundos e use o comando \`/whatsapp status\` novamente para visualizar o código.`;

            if (state.whatsappPairingCode) {
                statusText = '🔑 Código de Pareamento Pronto';
                color = 0x00E676;
                const code = state.whatsappPairingCode;
                const formattedCode = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
                description = `Para conectar o bot ao WhatsApp do número **+${pairingPhone}**, siga os passos abaixo:\n\n` +
                    `1️⃣ Abra o WhatsApp no celular do número **+${pairingPhone}**.\n` +
                    `2️⃣ Vá em **Aparelhos Conectados** (Configurações > Aparelhos Conectados).\n` +
                    `3️⃣ Toque em **Conectar um aparelho**.\n` +
                    `4️⃣ Toque em **Conectar com número de telefone** na parte inferior.\n` +
                    `5️⃣ Digite o seguinte código no seu celular:\n\n` +
                    `👉 🏆 **\`\`\`${formattedCode}\`\`\`** 🏆\n\n` +
                    `⚠️ *Nota:* Esse código expira em alguns minutos. Se expirar, solicite o pareamento novamente.`;
            }

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle('📞 Pareamento do WhatsApp')
                .setDescription(description)
                .setFooter({ text: 'Ascended Bot • WhatsApp Pairing' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }
        console.log('[WhatsApp Command] status (Slash):', status, 'hasQr (Slash):', hasQr);

        let statusText = 'Desconhecido';
        let color = 0x808080;
        let description = 'Use `/whatsapp conectar` para iniciar a sessão.';

        if (status === 'disconnected') {
            statusText = '❌ Desconectado';
            color = 0xFF4444;
            description = 'O bot não está conectado ao WhatsApp. Use `/whatsapp conectar` para iniciar a sessão e gerar o QR Code.';
        } else if (status === 'connecting') {
            statusText = '⏳ Conectando...';
            color = 0xFF8C00;
            description = 'O bot está iniciando o WhatsApp Web em segundo plano. Por favor, aguarde alguns segundos.';
        } else if (status === 'qr_ready') {
            statusText = '🔑 Aguardando Scan (QR Code)';
            color = 0xFF8C00;
            description = 'Escaneie o código QR abaixo com o seu celular no WhatsApp (Aparelhos Conectados) para realizar o login.';
        } else if (status === 'connected') {
            statusText = '🟢 Conectado';
            color = 0x44FF88;
            description = 'O bot está conectado com sucesso ao WhatsApp e pronto para enviar mensagens!';
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle('📞 Status do WhatsApp')
            .setDescription(`**Status:** ${statusText}\n\n${description}`)
            .setFooter({ text: 'Ascended Bot • WhatsApp Integration' })
            .setTimestamp();

        if (status === 'qr_ready') {
            if (qrBuffer) {
                try {
                    const qrPath = path.join(__dirname, '..', 'data', 'temp_qr.png');
                    fs.writeFileSync(qrPath, qrBuffer);

                    // Try to upload to tmpfiles.org to bypass Discord multipart socket issues
                    let directUrl = null;
                    try {
                        const { execSync } = require('child_process');
                        const responseText = execSync(`curl.exe -s -F "file=@${qrPath}" https://tmpfiles.org/api/v1/upload`, { encoding: 'utf8' }).trim();
                        const result = JSON.parse(responseText);
                        if (result.status === 'success' && result.data && result.data.url) {
                            directUrl = result.data.url.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');
                        }
                    } catch (uploadErr) {
                        console.warn('[WhatsApp Command] Failed uploading to tmpfiles.org:', uploadErr.message);
                    }

                    if (directUrl) {
                        embed.setImage(directUrl);
                        console.log('[WhatsApp Command] sending Slash reply with hosted QR code...');
                        const res = await interaction.editReply({
                            content: '🔑 QR Code de pareamento do WhatsApp enviado abaixo!',
                            embeds: [embed]
                        });
                        return res;
                    } else {
                        // Fallback to local attachment upload
                        embed.setImage('attachment://qr.png');
                        const attachment = new AttachmentBuilder(qrPath, { name: 'qr.png' });
                        console.log('[WhatsApp Command] sending Slash reply with standard attachment...');
                        const res = await interaction.editReply({
                            content: '🔑 QR Code de pareamento do WhatsApp enviado abaixo!',
                            embeds: [embed],
                            files: [attachment]
                        });
                        console.log('[WhatsApp Command] Slash reply sent successfully with attachment');
                        return res;
                    }
                } catch (err) {
                    console.error('[WhatsApp Command] error sending Slash reply with attachment:', err.message, err.stack);
                    throw err;
                }
            }
        }

        try {
            console.log('[WhatsApp Command] sending Slash reply without attachment...');
            const res = await interaction.editReply({ embeds: [embed] });
            console.log('[WhatsApp Command] Slash reply sent successfully without attachment');
            return res;
        } catch (err) {
            console.error('[WhatsApp Command] error sending Slash reply without attachment:', err.message, err.stack);
            throw err;
        }
    }
};
