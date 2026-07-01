'use strict';

const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType,
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const db = require('./database');
const respawnsList = require('../data/respawns.json');

// Nomes padrão de canais e categorias
const CATEGORY_NAME = '📅 PLANILHAS';
const CHANNEL_SOLICITAR = 'solicitar-planilhado';
const CHANNEL_PAINEL = 'painel-solicitações';
const CHANNEL_LISTA = 'lista-planilhados';

function findRespawn(query) {
    if (!query) return null;
    const q = query.toLowerCase().trim();
    return respawnsList.find(r => r.id.toLowerCase() === q || r.name.toLowerCase() === q);
}

/**
 * Auxiliar para buscar ou criar a categoria de planilhados
 */
async function getOrCreatePlanilhadoCategory(guild) {
    let category = guild.channels.cache.find(c => c.name === CATEGORY_NAME && c.type === ChannelType.GuildCategory);
    if (!category) {
        try {
            category = await guild.channels.create({
                name: CATEGORY_NAME,
                type: ChannelType.GuildCategory
            });
            console.log(`[Planilhado] Categoria "${CATEGORY_NAME}" criada com sucesso.`);
        } catch (err) {
            console.error('[Planilhado] Erro ao criar categoria:', err.message);
        }
    }
    return category;
}

/**
 * Cria ou busca os canais na categoria de planilhado
 */
async function getOrCreatePlanilhadoChannels(guild, category) {
    const parentId = category ? category.id : null;

    // 1. Canal #solicitar-planilhado (Público - Leitura apenas)
    let chanSolicitar = guild.channels.cache.find(c => c.name === CHANNEL_SOLICITAR && c.type === ChannelType.GuildText && c.parentId === parentId);
    if (!chanSolicitar) {
        try {
            chanSolicitar = await guild.channels.create({
                name: CHANNEL_SOLICITAR,
                type: ChannelType.GuildText,
                parent: parentId,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        allow: [PermissionFlagsBits.ViewChannel],
                        deny: [PermissionFlagsBits.SendMessages] // Usuários não digitam aqui, usam botões/comandos
                    },
                    {
                        id: guild.client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
                    }
                ]
            });
        } catch (e) { console.error('[Planilhado] Erro ao criar canal solicitar:', e.message); }
    }

    // 2. Canal #painel-solicitações (Admin apenas)
    let chanPainel = guild.channels.cache.find(c => c.name === CHANNEL_PAINEL && c.type === ChannelType.GuildText && c.parentId === parentId);
    if (!chanPainel) {
        try {
            chanPainel = await guild.channels.create({
                name: CHANNEL_PAINEL,
                type: ChannelType.GuildText,
                parent: parentId,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel] // Oculto para todos
                    },
                    {
                        id: guild.client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    }
                ]
            });
        } catch (e) { console.error('[Planilhado] Erro ao criar canal painel:', e.message); }
    }

    // 3. Canal #lista-planilhados (Público - Leitura apenas)
    let chanLista = guild.channels.cache.find(c => c.name === CHANNEL_LISTA && c.type === ChannelType.GuildText && c.parentId === parentId);
    if (!chanLista) {
        try {
            chanLista = await guild.channels.create({
                name: CHANNEL_LISTA,
                type: ChannelType.GuildText,
                parent: parentId,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        allow: [PermissionFlagsBits.ViewChannel],
                        deny: [PermissionFlagsBits.SendMessages]
                    },
                    {
                        id: guild.client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
                    }
                ]
            });
        } catch (e) { console.error('[Planilhado] Erro ao criar canal lista:', e.message); }
    }

    return { chanSolicitar, chanPainel, chanLista };
}

/**
 * Atualiza o painel público com a listagem dos planilhados ativos e as filas de espera
 */
async function updatePlanilhadoListDashboard(guild) {
    const config = db.loadAllConfig();
    const listChannelId = config.planilhadoListChannelId;
    if (!listChannelId) return;

    try {
        const channel = await guild.channels.fetch(listChannelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        const allSchedules = db.getAllSchedules();
        const activeSchedules = allSchedules.filter(s => s.active === 1);
        const queuedSchedules = allSchedules.filter(s => s.active === 0);

        const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle('📋 LISTAGEM DE RESPONSABILIDADE DIÁRIA (PLANILHADOS)')
            .setDescription(
                `Abaixo estão os respawns com reservas diárias fixas aprovadas pela administração.\n` +
                `*A prioridade é rotacionada automaticamente a cada 15 dias se houver fila de espera.*\n\n` +
                `**Como caçar hoje no seu horário?**\n` +
                `Líderes devem marcar presença enviando **\`!planilhado checkin\`** ou usando o comando slash **\`/planilhado checkin\`** entre **1 hora antes** e **15 minutos após** o horário de início da caçada.`
            )
            .setTimestamp();

        if (activeSchedules.length === 0) {
            embed.addFields({ name: '📭 Nenhum Planilhado', value: 'Nenhuma reserva diária ativa no momento.' });
        } else {
            // Agrupar por categoria do respawn
            const groups = {};
            activeSchedules.forEach(s => {
                const resp = findRespawn(s.respawn_id);
                const category = resp ? resp.category : 'Outros';
                if (!groups[category]) groups[category] = [];
                groups[category].push({ s, resp });
            });

            for (const category in groups) {
                const lines = groups[category].map(({ s, resp }) => {
                    const respName = resp ? resp.name : s.respawn_id;
                    const membersStr = s.member_ids ? s.member_ids.split(',').map(id => `<@${id}>`).join(', ') : 'Nenhum';
                    
                    const rotationDateStr = new Date(s.last_active_at + 15 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR');

                    // Verifica se há fila para este respawn e horário
                    const queue = queuedSchedules.filter(q => q.respawn_id.toLowerCase() === s.respawn_id.toLowerCase() && q.time_slot === s.time_slot);
                    let queueStr = '';
                    if (queue.length > 0) {
                        queueStr = `\n   ↳ ⏳ **Fila Próximo Ciclo:** ` + queue.map(q => `<@${q.leader_discord_id}>`).join(', ');
                    }

                    return `🔹 \`${s.respawn_id}\` **${respName}** · ⏰ **${s.time_slot}**\n` +
                           `   └ 👑 **Líder:** <@${s.leader_discord_id}>\n` +
                           `   └ 👥 **Membros:** ${membersStr}\n` +
                           `   └ 🔄 **Próxima rotação:** \`${rotationDateStr}\`${queueStr}`;
                });
                embed.addFields({ name: `📍 ${category}`, value: lines.join('\n\n'), inline: false });
            }
        }

        // Tenta editar a mensagem anterior do bot ou envia uma nova
        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const existingMsg = messages ? messages.find(m => m.author.id === guild.client.user.id && m.embeds?.[0]?.title === '📋 LISTAGEM DE RESPONSABILIDADE DIÁRIA (PLANILHADOS)') : null;

        if (existingMsg) {
            await existingMsg.edit({ embeds: [embed] }).catch(() => {});
        } else {
            // Apaga mensagens antigas do bot para não poluir
            if (messages) {
                const toDelete = messages.filter(m => m.author.id === guild.client.user.id);
                for (const m of toDelete.values()) {
                    await m.delete().catch(() => {});
                }
            }
            await channel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('[PlanilhadoManager] Erro ao atualizar dashboard de listagem:', err.message);
    }
}

/**
 * Trata o clique no botão de Aprovar Solicitação
 */
async function handleApproveRequest(interaction, requestId) {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const config = db.loadAllConfig();

    const req = db.getScheduleRequest(requestId);
    if (!req) {
        return interaction.editReply('❌ Solicitação não encontrada no banco de dados.');
    }

    if (req.status !== 'pending') {
        return interaction.editReply(`⚠️ Esta solicitação já foi resolvida com o status: **${req.status.toUpperCase()}**.`);
    }

    try {
        // Atualiza status da solicitação
        db.updateScheduleRequestStatus(requestId, 'approved');

        // Verifica se já existe um planilhado ativo para a mesma hunt e horário
        const existingActive = db.getActiveScheduleByRespawnAndSlot(req.respawn_id, req.time_slot);
        
        let active = 1;
        let replyMsg = '';

        if (existingActive) {
            active = 0; // Vai para a fila de rotação
            replyMsg = `✅ **Solicitação Aprovada!** Como já existe uma PT ativa para o respawn **${req.respawn_id}** às **${req.time_slot}**, a nova PT foi colocada na **fila de rotação** e assumirá no próximo ciclo de 15 dias.`;
        } else {
            replyMsg = `✅ **Solicitação Aprovada!** A reserva diária para a hunt **${req.respawn_id}** às **${req.time_slot}** foi ativada com sucesso!`;
        }

        // Cria o planilhado
        db.createSchedule(req.respawn_id, req.time_slot, req.leader_discord_id, req.member_ids, active);

        // Edita a mensagem do painel para desativar botões e mostrar quem aprovou
        const originalEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(originalEmbed)
            .setColor(0x2ecc71)
            .setTitle(`✅ Planilhado Aprovado por ${interaction.user.username}`)
            .setDescription(`Status: **Aprovado**\n\n` + originalEmbed.description);

        await interaction.message.edit({ embeds: [updatedEmbed], components: [] }).catch(() => {});

        // Notifica o líder por DM
        try {
            const leader = await guild.client.users.fetch(req.leader_discord_id);
            if (leader) {
                const dmEmbed = new EmbedBuilder()
                    .setColor(0x2ecc71)
                    .setTitle('✅ Seu Planilhado foi Aprovado!')
                    .setDescription(
                        `Olá! A solicitação da sua PT para caçar no respawn **${req.respawn_id}** no horário **${req.time_slot}** foi aprovada pelos administradores.\n\n` +
                        (active === 1 
                            ? `🎉 **Status:** Ativo para o ciclo de 15 dias atual! Lembre-se de dar o check-in diariamente.`
                            : `⏳ **Status:** Fila de Espera. Sua PT entrará automaticamente quando o ciclo da PT atual de 15 dias expirar.`)
                    )
                    .setTimestamp();
                await leader.send({ embeds: [dmEmbed] });
            }
        } catch (e) {
            console.warn(`[PlanilhadoManager] Não foi possível notificar o líder ${req.leader_discord_id} por DM.`);
        }

        // Atualiza a listagem pública
        await updatePlanilhadoListDashboard(guild);

        return interaction.editReply(replyMsg);
    } catch (err) {
        console.error('[PlanilhadoManager] Erro ao aprovar planilhado:', err.message);
        return interaction.editReply('❌ Ocorreu um erro interno ao processar a aprovação.');
    }
}

/**
 * Trata o clique no botão de Recusar Solicitação
 */
async function handleRejectRequest(interaction, requestId) {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;

    const req = db.getScheduleRequest(requestId);
    if (!req) {
        return interaction.editReply('❌ Solicitação não encontrada no banco de dados.');
    }

    if (req.status !== 'pending') {
        return interaction.editReply(`⚠️ Esta solicitação já foi resolvida com o status: **${req.status.toUpperCase()}**.`);
    }

    try {
        db.updateScheduleRequestStatus(requestId, 'rejected');

        // Edita o painel de aprovação
        const originalEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(originalEmbed)
            .setColor(0xe74c3c)
            .setTitle(`❌ Planilhado Recusado por ${interaction.user.username}`)
            .setDescription(`Status: **Recusado**\n\n` + originalEmbed.description);

        await interaction.message.edit({ embeds: [updatedEmbed], components: [] }).catch(() => {});

        // Notifica o líder por DM
        try {
            const leader = await guild.client.users.fetch(req.leader_discord_id);
            if (leader) {
                const dmEmbed = new EmbedBuilder()
                    .setColor(0xe74c3c)
                    .setTitle('❌ Solicitação de Planilhado Recusada')
                    .setDescription(
                        `Olá! A solicitação da sua PT para o respawn **${req.respawn_id}** no horário **${req.time_slot}** foi recusada pelos administradores.\n` +
                        `Fale com um admin para mais detalhes.`
                    )
                    .setTimestamp();
                await leader.send({ embeds: [dmEmbed] });
            }
        } catch (e) {
            console.warn(`[PlanilhadoManager] Não foi possível notificar o líder ${req.leader_discord_id} por DM.`);
        }

        return interaction.editReply('✅ Solicitação recusada e líder notificado.');
    } catch (err) {
        console.error('[PlanilhadoManager] Erro ao recusar planilhado:', err.message);
        return interaction.editReply('❌ Ocorreu um erro interno ao processar a recusa.');
    }
}

/**
 * Lógica comum de Check-in para o líder da PT
 */
async function handleCheckInFlow(user, member, guild, config) {
    const activeSchedules = db.getActiveSchedulesByLeader(user.id);
    if (activeSchedules.length === 0) {
        return { error: '❌ **Acesso Negado:** Você não é líder de nenhuma PT com planilhado ativo no momento.' };
    }

    const todayStr = db.todayDate();
    let checkedInAny = false;
    const details = [];

    for (const s of activeSchedules) {
        const timeMatch = s.time_slot.match(/^([0-9]{2}):([0-9]{2})-([0-9]{2}):([0-9]{2})$/);
        if (!timeMatch) {
            details.push(`⚠️ Planilhado para a hunt **${s.respawn_id}** possui horário inválido (\`${s.time_slot}\`).`);
            continue;
        }

        const startHour = parseInt(timeMatch[1], 10);
        const startMin = parseInt(timeMatch[2], 10);
        const endHour = parseInt(timeMatch[3], 10);
        const endMin = parseInt(timeMatch[4], 10);

        // Define os limites do check-in
        const startToday = new Date();
        startToday.setHours(startHour, startMin, 0, 0);

        // Ajuste para cruzamento de meia-noite (se o slot inicia nas primeiras horas do dia seguinte)
        if (Date.now() - startToday.getTime() > 12 * 60 * 60 * 1000) {
            startToday.setDate(startToday.getDate() + 1);
        }

        const now = Date.now();
        const checkInStart = startToday.getTime() - 60 * 60 * 1000; // 1 hora antes
        const checkInEnd = startToday.getTime() + 15 * 60 * 1000;  // 15 minutos depois

        // Calcula a duração do claim
        const endToday = new Date();
        endToday.setHours(endHour, endMin, 0, 0);
        if (endToday < startToday) {
            endToday.setDate(endToday.getDate() + 1); // Cruza a meia-noite
        }
        const durationMs = endToday.getTime() - now;

        const slotDateStr = `${startToday.getFullYear()}-${String(startToday.getMonth() + 1).padStart(2, '0')}-${String(startToday.getDate()).padStart(2, '0')}`;

        if (now >= checkInStart && now <= checkInEnd) {
            // Verifica se já fez check-in hoje
            const existingAttendance = db.getAttendance(s.id, slotDateStr);
            if (existingAttendance && existingAttendance.checked_in === 1) {
                details.push(`ℹ️ A presença já havia sido marcada hoje para o respawn **${s.respawn_id}** às **${s.time_slot}**.`);
                continue;
            }

            // Confirma presença no banco
            db.markAttendance(s.id, slotDateStr);

            // Cria automaticamente a reserva (claim) no painel de respawns em tempo real
            const resp = findRespawn(s.respawn_id);
            const respName = resp ? resp.name : s.respawn_id;
            const respCategory = resp ? resp.category : 'Planilhados';

            // Registra o claim ativo
            db.insertClaim({
                respawnId: s.respawn_id,
                respawnName: respName,
                category: respCategory,
                playerId: s.leader_discord_id,
                playerName: user.username,
                durationMs,
                status: 'active'
            });

            // Força a atualização do Live Dashboard de Respawns
            const scheduler = require('./scheduler');
            if (typeof scheduler.updateLiveDashboard === 'function') {
                scheduler.updateLiveDashboard();
            }

            checkedInAny = true;
            details.push(`✅ **Presença Confirmada!** Hunt **${respName}** (\`${s.respawn_id}\`) foi reservada para você hoje até as **${timeMatch[3]}:${timeMatch[4]}**.`);
        } else {
            const startStr = new Date(checkInStart).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const endStr = new Date(checkInEnd).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            details.push(`❌ **Fora do Horário de Check-in** para a hunt **${s.respawn_id}** (\`${s.time_slot}\`).\nO check-in deve ser feito entre **${startStr}** e **${endStr}**.`);
        }
    }

    return { success: checkedInAny, message: details.join('\n\n') };
}

/**
 * Verifica se a duração pretendida de uma reserva/claim normal conflita com algum planilhado ativo
 * Retorna o planilhado conflitante ou null se livre.
 */
function checkPlanilhadoOverlap(respawnId, durationMin) {
    const activeSchedules = db.getActiveSchedules();
    if (!activeSchedules || activeSchedules.length === 0) return null;

    const schedules = activeSchedules.filter(s => s.respawn_id.toLowerCase() === respawnId.toLowerCase());
    if (schedules.length === 0) return null;

    const now = Date.now();
    const claimStart = now;
    const claimEnd = now + durationMin * 60 * 1000;

    for (const s of schedules) {
        const timeMatch = s.time_slot.match(/^([0-9]{2}):([0-9]{2})-([0-9]{2}):([0-9]{2})$/);
        if (!timeMatch) continue;

        const startHour = parseInt(timeMatch[1], 10);
        const startMin = parseInt(timeMatch[2], 10);
        const endHour = parseInt(timeMatch[3], 10);
        const endMin = parseInt(timeMatch[4], 10);

        // Verifica 3 dias: Ontem, Hoje, Amanhã
        const offsets = [-1, 0, 1];
        for (const offset of offsets) {
            const planStart = new Date();
            planStart.setDate(planStart.getDate() + offset);
            planStart.setHours(startHour, startMin, 0, 0);

            const planEnd = new Date(planStart);
            planEnd.setHours(endHour, endMin, 0, 0);
            if (planEnd < planStart) {
                planEnd.setDate(planEnd.getDate() + 1); // Cruza a meia-noite
            }

            // Formata YYYY-MM-DD
            const year = planStart.getFullYear();
            const month = String(planStart.getMonth() + 1).padStart(2, '0');
            const day = String(planStart.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            // Se o check-in foi perdido hoje (checked_in === 0), a hunt está livre
            const attendance = db.getAttendance(s.id, dateStr);
            if (attendance && attendance.checked_in === 0) {
                continue;
            }

            // Overlap check
            const overlap = claimStart < planEnd.getTime() && planStart.getTime() < claimEnd;
            if (overlap) {
                return s;
            }
        }
    }
    return null;
}

async function handlePlanilhadoButtonClick(interaction, config) {
    const leaderReg = db.getRegisteredMember(interaction.user.id);
    if (!leaderReg) {
        return interaction.reply({
            content: '🚫 **Vínculo Obrigatório:** Você precisa estar registrado no bot do clã para solicitar um planilhado.',
            ephemeral: true
        });
    }

    const modal = new ModalBuilder()
        .setCustomId('modal_planilhado_solicitar')
        .setTitle('Solicitar Planilhado');

    const respawnInput = new TextInputBuilder()
        .setCustomId('pl_respawn')
        .setLabel('Código ou Nome do Respawn')
        .setPlaceholder('Ex: B16, P17')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const horarioInput = new TextInputBuilder()
        .setCustomId('pl_horario')
        .setLabel('Horário da Hunt (HH:MM-HH:MM)')
        .setPlaceholder('Ex: 20:00-22:00')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const membersInput = new TextInputBuilder()
        .setCustomId('pl_members')
        .setLabel('Companheiros da PT (Você + 3 ou 4)')
        .setPlaceholder('Marque ou digite os nicks: @Membro1 @Membro2 @Membro3')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(respawnInput),
        new ActionRowBuilder().addComponents(horarioInput),
        new ActionRowBuilder().addComponents(membersInput)
    );

    await interaction.showModal(modal);
}

async function handlePlanilhadoModalSubmit(interaction, config) {
    const leaderReg = db.getRegisteredMember(interaction.user.id);
    if (!leaderReg) {
        return interaction.reply({
            content: '🚫 **Vínculo Obrigatório:** Você precisa estar registrado no bot para solicitar um planilhado.',
            ephemeral: true
        });
    }

    const respawnArg = interaction.fields.getTextInputValue('pl_respawn').trim();
    const timeSlotArg = interaction.fields.getTextInputValue('pl_horario').trim();
    const membersInput = interaction.fields.getTextInputValue('pl_members');

    // Valida o horário (HH:MM-HH:MM)
    const timeMatch = timeSlotArg.match(/^([0-9]{2}):([0-9]{2})-([0-9]{2}):([0-9]{2})$/);
    if (!timeMatch) {
        return interaction.reply({ content: '❌ Horário inválido! Use o formato de 24 horas `HH:MM-HH:MM`. Ex: `20:00-22:00`.', ephemeral: true });
    }

    // Valida o respawn
    const respawn = findRespawn(respawnArg);
    if (!respawn) {
        return interaction.reply({ content: `❌ O respawn **"${respawnArg}"** não foi encontrado na lista oficial de hunts.`, ephemeral: true });
    }

    // Parser inteligente dos nicks/mentions
    const parsedIds = new Set();
    const tokens = membersInput.split(/[\s,;\n]+/);
    for (const token of tokens) {
        if (!token) continue;
        const match = token.match(/<@!?(\d+)>/);
        if (match) {
            parsedIds.add(match[1]);
            continue;
        }
        const cleanName = token.startsWith('@') ? token.slice(1) : token;
        let member = interaction.guild.members.cache.find(m => 
            m.user.username.toLowerCase() === cleanName.toLowerCase() || 
            m.displayName.toLowerCase() === cleanName.toLowerCase()
        );
        if (!member) {
            try {
                const fetched = await interaction.guild.members.fetch({ query: cleanName, limit: 1 }).catch(() => null);
                if (fetched && fetched.size > 0) {
                    member = fetched.first();
                }
            } catch (err) {
                // Ignore fetch errors
            }
        }
        if (member) {
            parsedIds.add(member.id);
        }
    }

    // Remove o líder
    parsedIds.delete(interaction.user.id);

    const mentionedUsers = [];
    for (const id of parsedIds) {
        const user = await interaction.guild.client.users.fetch(id).catch(() => null);
        if (user && !user.bot) {
            mentionedUsers.push(user);
        }
    }

    if (mentionedUsers.length < 3 || mentionedUsers.length > 4) {
        return interaction.reply({
            content: `❌ A Party deve ter exatamente **4 ou 5 membros** no total.\n` +
                     `Detectamos apenas **${mentionedUsers.length + 1}** membros na sua PT (Você + ${mentionedUsers.length}):\n` +
                     `• Líder (Você): <@${interaction.user.id}>\n` +
                     mentionedUsers.map((u, i) => `• Membro ${i + 1}: <@${u.id}>`).join('\n') + `\n\n` +
                     `*Certifique-se de digitar ou marcar exatamente 3 ou 4 companheiros cadastrados.*`,
            ephemeral: true
        });
    }

    // Verifica se todos estão registrados
    for (const user of mentionedUsers) {
        const reg = db.getRegisteredMember(user.id);
        if (!reg) {
            return interaction.reply({ content: `❌ O membro <@${user.id}> não está registrado no bot. Peça para ele se registrar primeiro.`, ephemeral: true });
        }
    }

    const memberIds = mentionedUsers.map(u => u.id).join(',');

    try {
        const requestId = db.createScheduleRequest(respawn.id, timeSlotArg, interaction.user.id, memberIds);

        // Envia painel de aprovação para os admins
        const adminChannelId = config.planilhadoAdminChannelId;
        if (adminChannelId) {
            const adminChannel = await interaction.guild.channels.fetch(adminChannelId).catch(() => null);
            if (adminChannel && adminChannel.isTextBased()) {
                const adminEmbed = new EmbedBuilder()
                    .setColor(0xf39c12)
                    .setTitle('📥 Nova Solicitação de Planilhado (Painel)')
                    .setDescription(
                        `**Líder da PT:** ${interaction.user} (${interaction.user.tag})\n` +
                        `**Respawn solicitado:** \`${respawn.id}\` — **${respawn.name}** (${respawn.category})\n` +
                        `**Horário pretendido:** \`${timeSlotArg}\`\n\n` +
                        `**Membros da PT:**\n` +
                        mentionedUsers.map((u, i) => `· Membro ${i + 1}: <@${u.id}>`).join('\n')
                    )
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`pl_approve_${requestId}`)
                        .setLabel('Aprovar')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`pl_reject_${requestId}`)
                        .setLabel('Recusar')
                        .setStyle(ButtonStyle.Danger)
                );

                await adminChannel.send({ embeds: [adminEmbed], components: [row] });
            }
        }

        return interaction.reply({ content: '✅ **Solicitação enviada com sucesso!** Os administradores analisarão seu planilhado e você receberá uma DM com a resposta em breve.', ephemeral: true });
    } catch (err) {
        console.error('[PlanilhadoManager] Erro ao enviar solicitação via modal:', err.message);
        return interaction.reply({ content: '❌ Ocorreu um erro interno ao processar a solicitação.', ephemeral: true });
    }
}

async function deleteOldPlanilhadoSetup(guild) {
    const config = db.loadAllConfig();
    const channelIds = [
        config.planilhadoRequestChannelId,
        config.planilhadoAdminChannelId,
        config.planilhadoListChannelId
    ];

    // 1. Deleta canais por ID da configuração
    for (const id of channelIds) {
        if (id) {
            const chan = await guild.channels.fetch(id).catch(() => null);
            if (chan) {
                await chan.delete().catch(e => console.warn(`[Planilhado] Erro ao deletar canal ${id}:`, e.message));
            }
        }
    }

    // 2. Deleta categoria por ID da configuração
    if (config.planilhadoCategoryId) {
        const cat = await guild.channels.fetch(config.planilhadoCategoryId).catch(() => null);
        if (cat) {
            await cat.delete().catch(e => console.warn(`[Planilhado] Erro ao deletar categoria ${config.planilhadoCategoryId}:`, e.message));
        }
    }

    // 3. Deleta canais por nome (fallback)
    const channelNames = [CHANNEL_SOLICITAR, CHANNEL_PAINEL, CHANNEL_LISTA];
    for (const name of channelNames) {
        const chan = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildText);
        if (chan) {
            await chan.delete().catch(() => {});
        }
    }

    // 4. Deleta categoria por nome (fallback)
    const catByName = guild.channels.cache.find(c => c.name === CATEGORY_NAME && c.type === ChannelType.GuildCategory);
    if (catByName) {
        await catByName.delete().catch(() => {});
    }

    console.log('[Planilhado] Setup antigo limpo/deletado com sucesso.');
}

module.exports = {
    getOrCreatePlanilhadoCategory,
    getOrCreatePlanilhadoChannels,
    updatePlanilhadoListDashboard,
    handleApproveRequest,
    handleRejectRequest,
    handleCheckInFlow,
    findRespawn,
    checkPlanilhadoOverlap,
    handlePlanilhadoButtonClick,
    handlePlanilhadoModalSubmit,
    deleteOldPlanilhadoSetup
};
