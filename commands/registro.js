'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../modules/database');
const state = require('../modules/state');

const CLASSES = {
    'EK': {
        emoji: '⚔️',
        roleName: 'Elite Knight',
        color: '#95A5A6',
    },
    'MS': {
        emoji: '✨',
        roleName: 'Master Sorcerer',
        color: '#9B59B6',
    },
    'RP': {
        emoji: '🎯',
        roleName: 'Royal Paladin',
        color: '#F1C40F',
    },
    'ED': {
        emoji: '🌳',
        roleName: 'Elder Druid',
        color: '#2ECC71',
    },
    'EM': {
        emoji: '🧘',
        roleName: 'Exalted Monk',
        color: '#E67E22',
    }
};

function isAdmin(member, config) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    if (member.permissions.has('ManageGuild'))   return true;
    if (config.adminRoleId && member.roles.cache.has(config.adminRoleId)) return true;
    return false;
}

function isNone(str) {
    if (!str) return true;
    const s = str.toLowerCase().trim();
    return s === 'não' || s === 'nao' || s === 'nenhum' || s === 'no' || s === '-' || s === 'n' || s === 'none' || s === 'n/a';
}

async function getOrCreateRole(guild, name, colorHex) {
    let role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (!role) {
        try {
            role = await guild.roles.create({
                name: name,
                color: colorHex,
                reason: `Criado automaticamente pelo sistema de registro.`
            });
            console.log(`[Registro] Cargo criado automaticamente: ${name} com cor ${colorHex}`);
        } catch (err) {
            console.error(`[Registro] Erro ao criar cargo ${name}:`, err.message);
        }
    }
    return role;
}

async function handleRegistro(guild, authorId, nickname, targetMember, classe, bomba, telefone, config, isBypassBomba = false) {
    const cleanNickname = nickname ? nickname.replace(/\s*\(.*?\)/g, '').trim() : '';
    const cleanBomba = bomba ? bomba.replace(/\s*\(.*?\)/g, '').trim() : '';

    const classeUpper = classe.toUpperCase().trim();
    const classInfo = CLASSES[classeUpper];

    if (!classInfo) {
        throw new Error('Classe inválida. Use uma das opções: EK, MS, RP, ED, EM.');
    }

    // Validação: Personagem principal na guilda
    let charData = state.guildMembers?.find(m => m.name.toLowerCase() === cleanNickname.toLowerCase());
    if (!charData) {
        try {
            console.log(`[Registro] Personagem ${cleanNickname} não encontrado no cache. Buscando direto no site...`);
            const { scrapePlayer } = require('../scraper/scraper');
            const playerProfile = await scrapePlayer(cleanNickname);
            if (playerProfile && playerProfile.guild && playerProfile.guild.toLowerCase().includes(config.guildName.toLowerCase())) {
                charData = {
                    name: playerProfile.name,
                    level: parseInt(playerProfile.level, 10) || 0,
                    vocation: playerProfile.vocation,
                    status: playerProfile.status
                };
            }
        } catch (err) {
            console.error(`[Registro] Falha ao buscar personagem principal no fallback:`, err.message);
        }
    }

    if (!charData) {
        throw new Error(`O personagem principal **"${cleanNickname}"** não foi encontrado na guilda monitorada (${config.guildName || 'Ascended'}) no site do RubinOT. Ele precisa estar na guilda no jogo.`);
    }

    // Validação: Personagem principal único
    const existingChar = db.db.prepare('SELECT discord_id FROM registered_members WHERE LOWER(char_name) = LOWER(?)').get(cleanNickname);
    if (existingChar && existingChar.discord_id !== targetMember.id) {
        throw new Error(`O personagem principal **"${cleanNickname}"** já está registrado pelo usuário <@${existingChar.discord_id}>.`);
    }

    // Validação: Personagem bomba (obrigatório e deve estar na guilda no jogo, a menos que seja admin fazendo bypass)
    let bombaNameForDb = '-';
    if (!isBypassBomba || !isNone(cleanBomba)) {
        if (isNone(cleanBomba)) {
            throw new Error('O personagem bomba é obrigatório e deve estar na guilda no jogo.');
        }

        let bombaData = state.guildMembers?.find(m => m.name.toLowerCase() === cleanBomba.toLowerCase());
        if (!bombaData) {
            try {
                console.log(`[Registro] Personagem bomba ${cleanBomba} não encontrado no cache. Buscando direto no site...`);
                const { scrapePlayer } = require('../scraper/scraper');
                const playerProfile = await scrapePlayer(cleanBomba);
                if (playerProfile && playerProfile.guild && playerProfile.guild.toLowerCase().includes(config.guildName.toLowerCase())) {
                    bombaData = {
                        name: playerProfile.name,
                        level: parseInt(playerProfile.level, 10) || 0,
                        vocation: playerProfile.vocation,
                        status: playerProfile.status
                    };
                }
            } catch (err) {
                console.error(`[Registro] Falha ao buscar personagem bomba no fallback:`, err.message);
            }
        }

        if (!bombaData) {
            throw new Error(`O personagem bomba **"${cleanBomba}"** não foi encontrado na guilda monitorada (${config.guildName || 'Ascended'}) no site do RubinOT. Ele precisa estar na guilda no jogo.`);
        }

        // Validação: Personagem bomba único
        const existingBomba = db.db.prepare('SELECT discord_id, char_name FROM registered_members WHERE LOWER(bomba) = LOWER(?)').get(cleanBomba);
        if (existingBomba && existingBomba.discord_id !== targetMember.id) {
            throw new Error(`O personagem bomba **"${cleanBomba}"** já está vinculado ao registro de **${existingBomba.char_name}** (<@${existingBomba.discord_id}>).`);
        }
        bombaNameForDb = bombaData.name;
    } else {
        bombaNameForDb = '-';
    }

    // Validação do WhatsApp/Telefone: deve iniciar com + ou conter código de país
    if (!telefone) {
        throw new Error('O número de WhatsApp é obrigatório.');
    }
    const telTrimmed = telefone.trim();
    const hasPlus = telTrimmed.startsWith('+');
    const isCleanDigits = /^\d+$/.test(telTrimmed);

    if (!hasPlus && !isCleanDigits) {
        throw new Error('O número de WhatsApp deve, obrigatoriamente, iniciar com "+" seguido do código do país (ex: +5519989448376).');
    }

    const cleanPhone = telTrimmed.replace(/\D/g, '');
    if (cleanPhone.length < 8) {
        throw new Error('O número de WhatsApp deve conter o código de país e pelo menos 8 dígitos (ex: +5519989448376).');
    }

    // 1. Alterar apelido do membro
    const finalName = charData.name;
    const levelSuffix = ` [${charData.level}]`;
    const newNick = `${finalName}${levelSuffix} ${classInfo.emoji}`.slice(0, 32);

    let nicknameWarning = '';
    try {
        await targetMember.setNickname(newNick);
    } catch (err) {
        nicknameWarning = `⚠️ Não foi possível alterar o nickname de <@${targetMember.id}> (Bot sem permissão ou membro com cargo superior).`;
    }

    // 2. Adicionar cargo da classe e cargo "Registrado" e cargo "Aethelgard"
    let roleWarning = '';
    const classRole = await getOrCreateRole(guild, classInfo.roleName, classInfo.color);
    const registeredRole = await getOrCreateRole(guild, 'Registrado', '#3498DB');
    const aethelgardRole = await getOrCreateRole(guild, 'Aethelgard', '#E74C3C');

    const rolesToAdd = [];
    if (classRole) rolesToAdd.push(classRole);
    if (registeredRole) rolesToAdd.push(registeredRole);
    if (aethelgardRole) rolesToAdd.push(aethelgardRole);

    if (rolesToAdd.length > 0) {
        try {
            await targetMember.roles.add(rolesToAdd);
        } catch (err) {
            roleWarning = `⚠️ Não foi possível adicionar os cargos (${rolesToAdd.map(r => r.name).join(', ')}) ao membro (Bot sem permissão ou membro com cargo superior).`;
        }
    } else {
        roleWarning = `⚠️ Não foi possível obter ou criar os cargos necessários.`;
    }

    // 3. Salvar no banco de dados para sincronização de apelidos (salva limpo)
    db.addRegisteredMember({
        discordId: targetMember.id,
        charName: finalName,
        classCode: classeUpper,
        bomba: bombaNameForDb,
        phone: cleanPhone
    });

    // 4. Gerar linha para o Excel (TSV)
    const dateStr = new Date().toLocaleDateString('pt-BR');
    const tsvLine = `${finalName}\t${targetMember.id}\t${classeUpper}\t${bombaNameForDb}\t+${cleanPhone}\t${dateStr}`;

    // 5. Enviar no canal de registros se estiver configurado
    const regChannelId = config.registrationChannelId;
    let channelStatus = '';

    if (regChannelId) {
        const regChannel = guild.channels.cache.get(regChannelId) || await guild.channels.fetch(regChannelId).catch(() => null);
        if (regChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('📝 Novo Membro Registrado')
                .setDescription(`Registro efetuado por <@${authorId}>.`)
                .addFields(
                    { name: '👤 Nickname', value: `\`${finalName}\``, inline: true },
                    { name: '🆔 Discord ID', value: `\`${targetMember.id}\``, inline: true },
                    { name: '⚡ Classe', value: `\`${classeUpper} (${classInfo.roleName})\``, inline: true },
                    { name: '💣 Bomba', value: `\`${bombaNameForDb}\``, inline: true },
                    { name: '📞 Telefone', value: `\`+${cleanPhone}\``, inline: true },
                    { name: '📅 Data', value: `\`${dateStr}\``, inline: true }
                )
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();

            await regChannel.send({
                embeds: [logEmbed],
                content: `📋 **Cópia rápida para o Excel:**\n\`\`\`text\n${tsvLine}\n\`\`\``
            });
        } else {
            channelStatus = '⚠️ Canal de registros configurado mas não encontrado no servidor.';
        }
    } else {
        channelStatus = '⚠️ Canal de registros não configurado! Use `!config canal-registros #canal` para habilitar a exportação para o Excel.';
    }

    return {
        newNick,
        roleName: classInfo.roleName,
        nicknameWarning,
        roleWarning,
        channelStatus,
        tsvLine
    };
}

async function checkSpy(guild, nickname, memberId, config) {
    const cleanNickname = nickname ? nickname.replace(/\s*\(.*?\)/g, '').trim() : '';
    const warnings = [];
    
    // 1. Check if Discord ID is already registered under a different name
    const existing = db.getRegisteredMember(memberId);
    if (existing && existing.char_name.toLowerCase() !== cleanNickname.toLowerCase()) {
        warnings.push(`⚠️ **Troca de Personagem/Contas**: Este ID do Discord (<@${memberId}>) já estava registrado anteriormente com o personagem **${existing.char_name}**.`);
    }

    // 2. Check if the character has ever been killed by allies (fragged)
    const frags = db.db.prepare('SELECT COUNT(*) as count FROM frags WHERE LOWER(victim_name) = LOWER(?)').get(cleanNickname);
    if (frags && frags.count > 0) {
        warnings.push(`⚠️ **Ficha Suja (PvP)**: Este personagem já foi morto por aliados **${frags.count}** vezes na guerra.`);
    }

    // 3. Scrape player to get current guild
    try {
        const { scrapePlayer } = require('../scraper/scraper');
        const playerInfo = await scrapePlayer(cleanNickname);
        if (playerInfo) {
            const curGuild = playerInfo.guild || 'Nenhuma';
            let cleanGuild = curGuild.trim();
            if (curGuild && curGuild !== 'Nenhuma') {
                const curGuildClean = curGuild.replace(/\s*\(.*?\)/g, '').trim();
                const match = curGuildClean.match(/^.*?\s+(?:of\s+the|of|da|do|de|dos|das)\s+(.+)$/i);
                if (match) {
                    cleanGuild = match[1].trim();
                } else {
                    cleanGuild = curGuildClean;
                }
            }

            if (config.enemyGuildName && cleanGuild.toLowerCase() === config.enemyGuildName.toLowerCase()) {
                warnings.push(`🚨 **ALERTA MÁXIMO**: O personagem está atualmente na guilda inimiga **${curGuild}**!`);
            } else if (cleanGuild.toLowerCase() !== config.guildName.toLowerCase() && cleanGuild !== 'Nenhuma') {
                warnings.push(`⚠️ **Guilda Estranha**: O personagem pertence à guilda **${curGuild}** (não é da nossa guilda nem inimiga).`);
            }
        }
    } catch (err) {
        console.error('[Spy-Detector] Erro ao buscar jogador no scraper:', err.message);
    }

    // Send warnings to the registrations channel if any exist
    if (warnings.length > 0 && config.registrationChannelId) {
        const regChannel = guild.channels.cache.get(config.registrationChannelId) || await guild.channels.fetch(config.registrationChannelId).catch(() => null);
        if (regChannel) {
            const embed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('🕵️ DETECTOR DE ESPIÕES (ANTI-SPY)')
                .setDescription(`Alertas de segurança para o registro de **${cleanNickname}** (<@${memberId}>):\n\n` + warnings.join('\n\n'))
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();
            await regChannel.send({ embeds: [embed] });
        }
    }
}

module.exports = {
    name: 'registro',
    aliases: ['registrar'],
    adminOnly: true,
    handleRegistro,
    checkSpy,
    isNone,

    data: new SlashCommandBuilder()
        .setName('registro')
        .setDescription('Registra um novo membro no clã, alterando apelido e cargo, e gerando a linha do Excel')
        .addStringOption(option =>
            option.setName('nickname')
                .setDescription('Nickname do jogador no jogo')
                .setRequired(true)
        )
        .addUserOption(option =>
            option.setName('membro')
                .setDescription('Membro do Discord a ser registrado')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('classe')
                .setDescription('Classe do personagem')
                .setRequired(true)
                .addChoices(
                    { name: 'EK (Elite Knight)', value: 'EK' },
                    { name: 'MS (Master Sorcerer)', value: 'MS' },
                    { name: 'RP (Royal Paladin)', value: 'RP' },
                    { name: 'ED (Elder Druid)', value: 'ED' },
                    { name: 'EM (Exalted Monk)', value: 'EM' }
                )
        )
        .addStringOption(option =>
            option.setName('telefone')
                .setDescription('Telefone de contato')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('bomba')
                .setDescription('Informações sobre Bomba')
                .setRequired(false)
        ),

    async execute(msg, args, { config }) {
        if (args[0] === 'permissoes') {
            if (!isAdmin(msg.member, config)) {
                return msg.reply('🚫 Apenas administradores podem configurar permissões de canais.');
            }
            
            const registradoRole = msg.guild.roles.cache.get('1512515674776408114') || 
                                   msg.guild.roles.cache.find(r => r.name.toLowerCase() === 'registrado');
                                   
            if (!registradoRole) {
                return msg.reply('❌ Cargo **Registrado** não encontrado no servidor.');
            }

            const callerRole = await getOrCreateRole(msg.guild, 'Caller', '#E74C3C');
            if (!callerRole) {
                return msg.reply('❌ Não foi possível criar ou obter o cargo **Caller**.');
            }
            
            await msg.reply('🔄 Configurando permissões de canais no servidor, por favor aguarde...');
            
            const channels = await msg.guild.channels.fetch();
            let countSuccess = 0;
            let countFail = 0;
            
            for (const [id, channel] of channels) {
                try {
                    const name = channel.name.toLowerCase();

                    const warChannelId = config.warVoiceChannelId;
                    if (warChannelId && channel.id === warChannelId) {
                        await channel.permissionOverwrites.edit(msg.guild.roles.everyone, {
                            Speak: false
                        });
                        await channel.permissionOverwrites.edit(registradoRole, {
                            Speak: false
                        });
                        await channel.permissionOverwrites.edit(callerRole, {
                            Speak: true,
                            Connect: true,
                            ViewChannel: true
                        });
                        countSuccess++;
                        continue;
                    }
                    
                    // 1. Skip and lock down admin areas (skip if name contains "admin" or parent category name contains "admin")
                    const isInsideAdminCategory = channel.parentId && 
                        channels.get(channel.parentId)?.name.toLowerCase().includes('admin');
                    
                    if (name.includes('admin') || isInsideAdminCategory) {
                        // Explicit deny for Registrado and @everyone in admin areas to ensure security
                        await channel.permissionOverwrites.edit(msg.guild.roles.everyone, {
                            ViewChannel: false
                        });
                        await channel.permissionOverwrites.edit(registradoRole, {
                            ViewChannel: false
                        });
                        countSuccess++;
                        continue;
                    }
                    
                    // 2. Registro channel
                    if (name === 'registro' || name.includes('registro')) {
                        // Everyone sees, Registrado doesn't (to keep user channel lists clean once registered)
                        await channel.permissionOverwrites.edit(msg.guild.roles.everyone, {
                            ViewChannel: true,
                            SendMessages: false,
                            ReadMessageHistory: true
                        });
                        await channel.permissionOverwrites.edit(registradoRole, {
                            ViewChannel: false
                        });
                        countSuccess++;
                        continue;
                    }
                    
                    // 3. For all other channels/categories
                    // Deny @everyone, Allow Registrado
                    await channel.permissionOverwrites.edit(msg.guild.roles.everyone, {
                        ViewChannel: false
                    });
                    await channel.permissionOverwrites.edit(registradoRole, {
                        ViewChannel: true
                    });
                    
                    countSuccess++;
                } catch (err) {
                    console.error(`Erro ao atualizar canal ${channel.name}:`, err.message);
                    countFail++;
                }
            }
            
            return msg.channel.send(`✅ **Configuração de permissões concluída!**\n• Canais/Categorias atualizados com sucesso: **${countSuccess}**\n• Falhas: **${countFail}**\n\n*Os usuários sem cargo agora só veem o canal #registro, e os registrados possuem acesso a todos os outros.*`);
        }

        if (args[0] === 'painel') {
            if (!isAdmin(msg.member, config)) {
                return msg.reply('🚫 Apenas administradores podem criar o painel de registro.');
            }
            msg.delete().catch(() => {});
            
            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('⚔️ REGISTRO DA GUILDA — ASCENDED ⚔️')
                .setDescription(
                    'Bem-vindo ao servidor da guilda!\n\n' +
                    'Para ter acesso aos canais de guerra, claims, radar, relatórios e PTs, você precisa se registrar no bot.\n\n' +
                    '**Antes de começar, certifique-se de que:**\n' +
                    '1. Seu personagem principal está na guilda **no jogo**.\n' +
                    '2. Você sabe o nome do seu personagem bomba (se houver).\n' +
                    '3. **Salve o número do bot nos seus contatos:** `+55 11 92600-7896` (se não salvar, o código de verificação por WhatsApp irá para a pasta "Filtros" ou "Desconhecidos" e você não receberá a notificação).\n\n' +
                    'Clique no botão abaixo para abrir o formulário de registro:'
                )
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('register_start')
                    .setLabel('📝 Iniciar Registro')
                    .setStyle(ButtonStyle.Primary)
            );

            return msg.channel.send({ embeds: [embed], components: [row] });
        }

        if (!args.length) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('❌ Uso Incorreto')
                        .setDescription('Como usar:\n`!registro Nickname, @membro, classe(EK/MS/RP/ED/EM), bomba, telefone`\n\n*Os argumentos devem ser separados por vírgula.*')
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                ]
            });
        }

        const rawArgs = args.join(' ');
        const parts = rawArgs.split(',').map(p => p.trim().replace(/^["']|["']$/g, '').trim());

        if (parts.length < 5) {
            return msg.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFF4444)
                        .setTitle('❌ Argumentos Insuficientes')
                        .setDescription('Você precisa fornecer todos os 5 argumentos separados por vírgula:\n`!registro Nickname, @membro, classe, bomba, telefone`')
                        .setFooter({ text: 'Ascended Bot • RubinOT' })
                ]
            });
        }

        const [nickname, memberMention, classe, bomba, telefone] = parts;

        if (!telefone || !telefone.trim().startsWith('+')) {
            return msg.reply('❌ **Formato de WhatsApp inválido!**\nO número de WhatsApp deve, obrigatoriamente, iniciar com **+** e o código de país (ex: **+5519989448376**).');
        }

        const memberIdMatch = memberMention.match(/^<@!?(\d+)>$/) || memberMention.match(/^(\d+)$/);
        if (!memberIdMatch) {
            return msg.reply('❌ Membro inválido. Por favor, mencione o membro ou passe seu ID (ex: @Membro ou 1234567890).');
        }
        const memberId = memberIdMatch[1];
        const targetMember = await msg.guild.members.fetch(memberId).catch(() => null);
        if (!targetMember) {
            return msg.reply('❌ Membro não encontrado no servidor.');
        }

        const classeUpper = classe.toUpperCase().trim();
        if (!CLASSES[classeUpper]) {
            return msg.reply('❌ Classe inválida. Escolhas aceitas: EK, MS, RP, ED, EM.');
        }

        try {
            const res = await handleRegistro(msg.guild, msg.author.id, nickname, targetMember, classeUpper, bomba, telefone, config, true);

            // Rodar o detector de espiões em background
            checkSpy(msg.guild, nickname, targetMember.id, config).catch(err => {
                console.error('[Spy-Detector] Erro no checkSpy em background:', err.message);
            });

            const descLines = [
                `👤 Membro: <@${targetMember.id}>`,
                `📝 Novo Apelido: \`${res.newNick}\``,
                `🛡️ Classe/Cargo: \`${res.roleName}\``,
                '',
                res.nicknameWarning,
                res.roleWarning,
                res.channelStatus
            ].filter(Boolean);

            const embed = new EmbedBuilder()
                .setColor(0x44FF88)
                .setTitle('✅ Membro Registrado com Sucesso')
                .setDescription(descLines.join('\n'))
                .addFields(
                    { name: '📋 Linha do Excel gerada:', value: `\`\`\`text\n${res.tsvLine}\n\`\`\`` }
                )
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();

            return msg.reply({ embeds: [embed] });
        } catch (err) {
            console.error('[Registro] Erro no comando prefixo:', err.message);
            return msg.reply(`❌ Ocorreu um erro ao registrar: ${err.message}`);
        }
    },

    async executeSlash(interaction, { config }) {
        const nickname = interaction.options.getString('nickname');
        const targetMember = interaction.options.getMember('membro');
        const classe = interaction.options.getString('classe');
        const bomba = interaction.options.getString('bomba') || '-';
        const telefone = interaction.options.getString('telefone');

        if (!telefone || !telefone.trim().startsWith('+')) {
            return interaction.reply({
                content: '❌ **Formato de WhatsApp inválido!**\nO número de WhatsApp deve, obrigatoriamente, iniciar com **+** e o código de país (ex: **+5519989448376**).',
                ephemeral: true
            });
        }

        if (!targetMember) {
            return interaction.reply({ content: '❌ Membro inválido ou não encontrado no servidor.', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });
            const res = await handleRegistro(interaction.guild, interaction.user.id, nickname, targetMember, classe, bomba, telefone, config, true);

            // Rodar o detector de espiões em background
            checkSpy(interaction.guild, nickname, targetMember.id, config).catch(err => {
                console.error('[Spy-Detector] Erro no checkSpy em background:', err.message);
            });

            const descLines = [
                `👤 Membro: <@${targetMember.id}>`,
                `📝 Novo Apelido: \`${res.newNick}\``,
                `🛡️ Classe/Cargo: \`${res.roleName}\``,
                '',
                res.nicknameWarning,
                res.roleWarning,
                res.channelStatus
            ].filter(Boolean);

            const embed = new EmbedBuilder()
                .setColor(0x44FF88)
                .setTitle('✅ Membro Registrado com Sucesso')
                .setDescription(descLines.join('\n'))
                .addFields(
                    { name: '📋 Linha do Excel gerada:', value: `\`\`\`text\n${res.tsvLine}\n\`\`\`` }
                )
                .setFooter({ text: 'Ascended Bot • RubinOT' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('[Registro] Erro no comando slash:', err.message);
            return interaction.editReply({ content: `❌ Ocorreu um erro ao registrar: ${err.message}` });
        }
    }
};
