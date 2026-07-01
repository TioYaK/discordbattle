'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const state = require('./state');

// Número do bot — salve este contato para receber mensagens!
const BOT_PHONE = '+55 11 92600-7896';
const BOT_SIGNATURE = `\n\n━━━━━━━━━━━━━━━
📱 *Ascended Bot* | Salve este número!`;

let wwebClient = null;
let qrBuffer = null;
let connectionStatus = 'disconnected'; // 'disconnected', 'connecting', 'qr_ready', 'connected'
let discordClient = null;

// Cache of resolved JIDs to prevent duplicate getNumberId API lag during mass broadcasts
const resolvedJidsCache = new Map(); // phone → JID serialized
const resolvedPhonesCache = new Map(); // LID digits → phone (reverse lookup)

const AUTH_PRIMARY = path.join(__dirname, '..', '.wwebjs_auth');
const AUTH_FALLBACK = path.join(__dirname, '..', '.wwebjs_auth_fallback');

// Helper para encontrar o Chrome instalado no sistema (idêntico ao do scraper)
function findChrome() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.CHROME_PATH,
    ].filter(Boolean);

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function normalizePhoneNumber(raw) {
    if (!raw) return '';
    let normalized = String(raw).trim();
    normalized = normalized.replace(/@.+$/, '');
    normalized = normalized.replace(/[^0-9]/g, '');
    return normalized;
}

async function extractSenderNumber(msg) {
    let sender = '';
    try {
        const contact = await msg.getContact();
        if (contact?.number) {
            const num = normalizePhoneNumber(contact.number);
            // LIDs têm 14+ dígitos — tentar resolver para telefone real
            if (num.length >= 14) {
                // 1) Busca no cache reverso (populado ao resolver JIDs)
                if (resolvedPhonesCache.has(num)) {
                    return resolvedPhonesCache.get(num);
                }
                // 2) Tenta obter o telefone pelo JID completo do contato
                try {
                    const jid = contact.id?._serialized || (num + '@lid');
                    const resolved = await wwebClient.getContactById(jid);
                    if (resolved?.number && normalizePhoneNumber(resolved.number).length < 14) {
                        const phone = normalizePhoneNumber(resolved.number);
                        resolvedPhonesCache.set(num, phone);
                        return phone;
                    }
                } catch (_) {}
                // 3) Fallback: retorna o LID (isPhoneNumberMatch não vai bater, mas evita crash)
                return num;
            }
            return num;
        }
    } catch (e) {
        console.error('[WhatsApp] Erro ao obter contato:', e.message);
    }

    if (msg.from) {
        sender = msg.from;
    } else if (msg.author) {
        sender = msg.author;
    } else if (msg._data?.id?.user) {
        sender = msg._data.id.user;
    }

    // Se msg.from for um LID, busca no cache reverso
    const raw = normalizePhoneNumber(sender);
    if (raw.length >= 14 && resolvedPhonesCache.has(raw)) {
        return resolvedPhonesCache.get(raw);
    }

    return raw;
}

function cleanupBrowserLocks(authFolder) {
    if (!authFolder || !fs.existsSync(authFolder)) return;

    const lockTargets = [
        path.join(authFolder, 'session', 'SingletonLock'),
        path.join(authFolder, 'session', 'SingletonSocket'),
        path.join(authFolder, 'session', 'SingletonCookie'),
        path.join(authFolder, 'Default', 'SingletonLock'),
        path.join(authFolder, 'Default', 'SingletonSocket'),
        path.join(authFolder, 'Default', 'SingletonCookie'),
    ];

    for (const lockPath of lockTargets) {
        if (!fs.existsSync(lockPath)) continue;
        try {
            fs.unlinkSync(lockPath);
            console.log(`[WhatsApp] Lock removido: ${lockPath}`);
        } catch {
            // ignore
        }
    }
}

function cleanupOrphanedAuthFolders() {
    const root = path.join(__dirname, '..');
    let entries;
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!/^\.wwebjs_auth_fallback_\d+/.test(entry.name)) continue;
        try {
            fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
            console.log(`[WhatsApp] Pasta de sessão órfã removida: ${entry.name}`);
        } catch (err) {
            console.warn(`[WhatsApp] Não foi possível remover pasta órfã ${entry.name}:`, err.message);
        }
    }
}

async function resolveWhatsAppNumberId(phone) {
    if (!wwebClient) {
        console.warn('[WhatsApp] resolveWhatsAppNumberId chamado sem cliente WhatsApp conectado.');
        return null;
    }

    let formattedPhone = normalizePhoneNumber(phone);
    if (!formattedPhone) return null;

    if (resolvedJidsCache.has(formattedPhone)) {
        return resolvedJidsCache.get(formattedPhone);
    }

    // LIDs possuem 14 ou 15 dígitos
    const isLid = formattedPhone.length >= 14;
    if (isLid) {
        const lidJid = formattedPhone + '@lid';
        resolvedJidsCache.set(formattedPhone, lidJid);
        return lidJid;
    }

    const candidates = [];

    // 1. O próprio número formatado (ex: já contém DDI correto)
    candidates.push(formattedPhone);

    // 2. Se não começa com 55 e tem 10-11 dígitos, pode ser brasileiro sem DDI
    if (!formattedPhone.startsWith('55') && (formattedPhone.length === 10 || formattedPhone.length === 11)) {
        candidates.push('55' + formattedPhone);
    }

    // 3. México (52): Tenta com e sem o '1' após o DDI
    if (formattedPhone.startsWith('52')) {
        if (formattedPhone[2] !== '1') {
            candidates.push('521' + formattedPhone.slice(2));
        } else {
            candidates.push('52' + formattedPhone.slice(3));
        }
    }

    // 4. Argentina (54): Tenta com e sem o '9' após o DDI
    if (formattedPhone.startsWith('54')) {
        if (formattedPhone[2] !== '9') {
            candidates.push('549' + formattedPhone.slice(2));
        } else {
            candidates.push('54' + formattedPhone.slice(3));
        }
    }

    // 5. Brasil (55): Tenta com e sem o 9º dígito após o DDD
    if (formattedPhone.startsWith('55')) {
        if (formattedPhone.length === 13 && formattedPhone[4] === '9') {
            const withoutNine = '55' + formattedPhone.slice(2, 4) + formattedPhone.slice(5);
            candidates.push(withoutNine);
        } else if (formattedPhone.length === 12) {
            const withNine = '55' + formattedPhone.slice(2, 4) + '9' + formattedPhone.slice(4);
            candidates.push(withNine);
        }
    }

    // Remove duplicatas mantendo a ordem de inserção
    const uniqueCandidates = [...new Set(candidates)];
    console.log(`[WhatsApp] Resolvendo ID para ${formattedPhone}. Testando candidatos: ${uniqueCandidates.join(', ')}`);

    for (const candidate of uniqueCandidates) {
        try {
            const resolved = await wwebClient.getNumberId(candidate);
            if (resolved && resolved._serialized) {
                const jidSerialized = resolved._serialized;
                console.log(`[WhatsApp] ID resolvido com sucesso para o candidato ${candidate}: ${jidSerialized}`);
                resolvedJidsCache.set(formattedPhone, jidSerialized);
                // Popula cache reverso LID → telefone
                const lidDigits = jidSerialized.replace(/@.+$/, '');
                if (lidDigits.length >= 14) {
                    resolvedPhonesCache.set(lidDigits, formattedPhone);
                }
                return jidSerialized;
            }
        } catch (err) {
            console.warn(`[WhatsApp] Falha ao testar candidato ${candidate}:`, err.message);
        }
    }

    // Fallback padrão se nada resolver na API
    const fallbackId = formattedPhone + '@c.us';
    console.log(`[WhatsApp] Nenhum candidato resolveu via API para ${formattedPhone}. Usando padrão: ${fallbackId}`);
    resolvedJidsCache.set(formattedPhone, fallbackId);
    return fallbackId;
}

function init(discClient, authOverridePath, attemptCount = 0) {
    if (wwebClient) return; // Evita dupla inicialização
    discordClient = discClient;

    if (attemptCount === 0) {
        cleanupOrphanedAuthFolders();
    }

    console.log('[WhatsApp] Inicializando cliente WhatsApp...');
    connectionStatus = 'connecting';
    
    const chromePath = findChrome();
    const puppeteerOpts = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage'
        ]
    };
    if (chromePath) {
        puppeteerOpts.executablePath = chromePath;
        console.log(`[WhatsApp] Usando Chrome em: ${chromePath}`);
    }

    const authFolder = authOverridePath || AUTH_PRIMARY;
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder, { recursive: true });
    }

    wwebClient = new Client({
        authStrategy: new LocalAuth({
            dataPath: authFolder
        }),
        puppeteer: puppeteerOpts
    });

    let pairingCodeRequested = false;
    wwebClient.on('qr', async (qr) => {
        // Verifica se deve usar código de pareamento em vez de QR
        const pairingPhone = db.getConfig('whatsapp_pairing_phone');
        if (pairingPhone) {
            // Só solicita o código UMA vez — eventos 'qr' subsequentes invalidariam o código anterior
            if (pairingCodeRequested && state.whatsappPairingCode) {
                console.log(`[WhatsApp] Código de pareamento já obtido (${state.whatsappPairingCode}), ignorando novo evento QR.`);
                return;
            }
            pairingCodeRequested = true;
            // A página do WhatsApp Web está pronta agora — solicita o código de pareamento
            console.log(`[WhatsApp] Evento QR interceptado — solicitando código de pareamento para: ${pairingPhone}`);
            try {
                state.whatsappPairingCode = null;
                const code = await wwebClient.requestPairingCode(pairingPhone);
                state.whatsappPairingCode = code;
                console.log(`[WhatsApp] Código de pareamento obtido: ${code}`);
            } catch (pairErr) {
                pairingCodeRequested = false; // Permite tentar novamente se falhou
                console.error('[WhatsApp] Falha ao obter código de pareamento:', pairErr.message || pairErr);
                // Fallback: gera QR code normal se o pareamento falhar
                connectionStatus = 'qr_ready';
                try {
                    qrBuffer = await QRCode.toBuffer(qr, { scale: 8 });
                    const dataDir = path.join(__dirname, '..', 'data');
                    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
                    fs.writeFileSync(path.join(dataDir, 'qr.png'), qrBuffer);
                } catch (qrErr) {
                    console.error('[WhatsApp] Erro ao gerar buffer do QR (fallback):', qrErr);
                }
            }
            return;
        }

        // Modo QR normal (sem número de pareamento configurado)
        connectionStatus = 'qr_ready';
        console.log('[WhatsApp] QR Code gerado.');
        try {
            // Gera o buffer da imagem PNG para o QR Code
            qrBuffer = await QRCode.toBuffer(qr, { scale: 8 });
            
            // Grava o arquivo físico em data/qr.png para envio robusto por stream
            const dataDir = path.join(__dirname, '..', 'data');
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
            const qrPath = path.join(dataDir, 'qr.png');
            fs.writeFileSync(qrPath, qrBuffer);
        } catch (err) {
            console.error('[WhatsApp] Erro ao gerar buffer do QR:', err);
        }
    });

    wwebClient.on('ready', () => {
        connectionStatus = 'connected';
        qrBuffer = null;
        state.whatsappPairingCode = null;
        try {
            db.setConfig('whatsapp_pairing_phone', '');
        } catch (dbErr) {
            console.error('[WhatsApp] Erro ao limpar whatsapp_pairing_phone do banco:', dbErr.message);
        }
        console.log('[WhatsApp] Cliente conectado e pronto!');
        
        // Remove o arquivo QR temporário
        const qrPath = path.join(__dirname, '..', 'data', 'qr.png');
        if (fs.existsSync(qrPath)) {
            try { fs.unlinkSync(qrPath); } catch {}
        }
    });

    wwebClient.on('authenticated', () => {
        console.log('[WhatsApp] Autenticado com sucesso no WhatsApp.');
    });

    wwebClient.on('auth_failure', (msg) => {
        connectionStatus = 'disconnected';
        qrBuffer = null;
        state.whatsappPairingCode = null;
        console.error('[WhatsApp] Falha na autenticação do WhatsApp:', msg);
    });

    wwebClient.on('disconnected', (reason) => {
        connectionStatus = 'disconnected';
        qrBuffer = null;
        state.whatsappPairingCode = null;
        console.log('[WhatsApp] Desconectado do WhatsApp:', reason);
    });

    wwebClient.on('message', async (msg) => {
        try {
            const isGroup = msg.from.endsWith('@g.us');
            const parts = msg.body ? msg.body.trim().split(/\s+/) : [];
            if (parts.length === 0) return;
            const cmd = parts[0].toLowerCase();
            const args = parts.slice(1);

            const allowedCmds = [
                '!caçando', '-caçando',
                '!claim', '-claim',
                '!next', '-next',
                '!liberar', '-liberar',
                '!ajuda', '-ajuda',
                '!help', '-help',
                '!respawns', '-respawns',
                '!respawn', '-respawn',
                '!claims', '-claims',
                '!ocupados', '-ocupados',
                '!reservas', '-reservas',
                '!hunts', '-hunts',
                '!lista', '-lista',
                '!listahunts', '-listahunts',
                '!carteira', '-carteira', '!saldo', '-saldo', '!coins', '-coins',
                '!inventario', '-inventario', '!itens', '-itens', '!inv', '-inv',
                '!booster', '-booster'
            ];

            const senderNumber = await extractSenderNumber(msg);
            const chatName = msg.from.split('@')[0];
            const registeredMembers = db.getAllRegisteredMembers();
            const reg = registeredMembers.find(m => isPhoneNumberMatch(m.phone, senderNumber));

            // ── Fluxo de Verificação Inbound ─────────────────────────────────────
            // Se for mensagem direta (DM) e o número não estiver cadastrado, verifica
            // se há um registro pendente para esse número (processo de verificação).
            if (!isGroup && !reg) {
                const normalizedBody = (msg.body || '').trim().toLowerCase();

                // Verifica se algum registro pendente corresponde a este número
                const { pendingRegistrations } = require('./registerManager');
                const pendingEntry = Object.entries(pendingRegistrations).find(([, p]) => {
                    if (isPhoneNumberMatch(p.phone, senderNumber)) return true;
                    if (p.jid && isPhoneNumberMatch(p.jid, senderNumber)) return true;
                    return false;
                });

                if (!pendingEntry && normalizedBody === 'codigo') {
                    console.log(`[WhatsApp] Código recebido de ${senderNumber}, mas nenhum registro pendente correspondeu. Pendentes: ${Object.values(pendingRegistrations).map(p => p.phone).join(', ')}`);
                }

                if (pendingEntry && normalizedBody === 'codigo') {
                    const [, pending] = pendingEntry;

                    if (pending.expiresAt < Date.now()) {
                        console.log(`[WhatsApp] Código expirado para ${senderNumber}.`);
                        await msg.reply(
                            `⏰ *Código expirado!*\n\nSeu código de verificação expirou. Por favor, volte ao Discord e inicie o processo de registro novamente.`
                        );
                        return;
                    }

                    console.log(`[WhatsApp] Código inbound solicitado por ${senderNumber} — respondendo com PIN.`);
                    await msg.reply(
                        `🤖 *Ascended Bot • Verificação*\n\n` +
                        `Seu código de confirmação para concluir o registro na guilda é: *${pending.code}*\n\n` +
                        `⚠️ *IMPORTANTE:* Salve este número nos contatos do seu celular para garantir que você receba todos os alertas de guerra e convocações!`
                    );
                    return;
                }

                // Qualquer outra mensagem de não-cadastrado: orientação genérica
                console.log(`[WhatsApp] Mensagem avulsa "${msg.body}" de ${senderNumber} (DM) sem registro.`);
                await msg.reply(
                    `❌ *WhatsApp não vinculado!*\n\n` +
                    `Para se registrar na guilda, acesse o canal de registro no nosso Discord e siga as instruções.\n` +
                    `Seu número de WhatsApp é: *${senderNumber}*`
                );
                return;
            }

            // Inbound Check-in flow for registered members
            if (!isGroup && reg) {
                const normalizedBody = (msg.body || '').trim().toLowerCase();
                const checkInKeywords = ['ok', '1', 'confirmar', 'checkin', 'presenca'];
                if (checkInKeywords.includes(normalizedBody)) {
                    console.log(`[WhatsApp] Tentativa de Check-in Inbound de ${senderNumber} (Discord ID: ${reg.discord_id}) via palavra-chave: "${normalizedBody}"`);
                    
                    const discordGuild = discordClient.guilds.cache.first();
                    if (!discordGuild) {
                        await msg.reply('❌ *Erro:* Discord não está pronto/conectado no momento.');
                        return;
                    }

                    const member = await discordGuild.members.fetch(reg.discord_id).catch(() => null);
                    if (!member) {
                        await msg.reply('❌ *Erro:* Seu usuário do Discord não foi encontrado no servidor.');
                        return;
                    }

                    const user = member.user;
                    const config = getActiveConfig();
                    
                    const { handleCheckInFlow } = require('./planilhadoManager');
                    const res = await handleCheckInFlow(user, member, discordGuild, config);
                    
                    if (res.error) {
                        await msg.reply(res.error.replace(/\*\*/g, '*'));
                    } else {
                        await msg.reply(res.message.replace(/\*\*/g, '*'));
                    }
                    return;
                }
            }

            if (allowedCmds.includes(cmd)) {
                if (!reg) {
                    console.log(`[WhatsApp] Comando "${cmd}" de ${senderNumber} (chat: ${chatName}) ignorado: número não cadastrado.`);
                    await msg.reply(`❌ *WhatsApp não vinculado!*\n\nSeu ID de WhatsApp é: *${senderNumber}*\n\nPara vincular este número ao seu usuário no Discord, envie o comando abaixo em qualquer canal do Discord:\n👉 \`!whatsapp link ${senderNumber}\``);
                    return;
                }
                console.log(`[WhatsApp] Usuário verificado: ${reg.char_name} (Discord: ${reg.discord_id})`);

                // Carrega guilda do Discord e membro
                const discordGuild = discordClient.guilds.cache.first();
                if (!discordGuild) return;

                const member = await discordGuild.members.fetch(reg.discord_id).catch(() => null);
                if (!member) return;

                const user = member.user;
                const config = getActiveConfig();

                if (cmd === '!caçando' || cmd === '-caçando') {
                    console.log(`[WhatsApp] Comando "-caçando" recebido de ${senderNumber}. Buscando lista...`);

                    const now = Date.now();
                    const INACTIVE_TIMEOUT = 15 * 60 * 1000;
                    const huntingEnemies = [];

                    Object.values(state.trackedEnemyPlayers || {}).forEach(p => {
                        if (p.isHunting) {
                            if (now - p.lastUpdate > INACTIVE_TIMEOUT) {
                                p.isHunting = false;
                                p.huntingStartTime = null;
                            } else {
                                huntingEnemies.push(p);
                            }
                        }
                    });

                    if (huntingEnemies.length === 0) {
                        await msg.reply('✅ *Nenhum inimigo caçando no momento.*');
                        return;
                    }

                    // Ordena por level decrescente
                    huntingEnemies.sort((a, b) => (b.level || 0) - (a.level || 0));

                    let responseText = `🕵️ *INIMIGOS CAÇANDO EM TEMPO REAL* 🕵️\n\n`;
                    huntingEnemies.forEach(p => {
                        const durationMs = Date.now() - p.huntingStartTime;
                        const durationMin = Math.floor(durationMs / 60000);
                        const durationStr = durationMin > 0 ? `${durationMin} min` : 'agora mesmo';
                        const xpGain = p.deltaXp > 0 ? `+${(p.deltaXp / 1000).toFixed(1)}k XP` : 'XP';
                        
                        let vocEmoji = '⚡';
                        const voc = (p.vocation || '').toLowerCase();
                        if (voc.includes('knight')) vocEmoji = '⚔️';
                        else if (voc.includes('paladin')) vocEmoji = '🎯';
                        else if (voc.includes('druid')) vocEmoji = '🌿';
                        else if (voc.includes('sorcerer')) vocEmoji = '🔮';
                        else if (voc.includes('monk')) vocEmoji = '🧘';

                        responseText += `${vocEmoji} *${p.name}* [Lv.${p.level}]\n└ ⏳ Caçando há ${durationStr} · Último ganho: ${xpGain}\n\n`;
                    });

                    await msg.reply(responseText.trim());
                } else if (cmd === '!claim' || cmd === '-claim' || cmd === '!next' || cmd === '-next') {
                    const query = args.join(' ');
                    if (!query) {
                        await msg.reply(`⚠️ Uso correto: *${cmd} <código ou nome>*`);
                        return;
                    }

                    console.log(`[WhatsApp] Comando "${cmd} ${query}" de ${senderNumber} (Discord ID: ${reg.discord_id})`);
                    const { handleClaimLogic } = require('../commands/claim');
                    const result = await handleClaimLogic(user, member, query, config);

                    if (result.error) {
                        const cleanError = result.error.replace(/\*\*/g, '*');
                        await msg.reply(cleanError);
                    } else if (result.isQueue) {
                        await msg.reply(`⏳ *Entrou na Fila (Next)*\n\nVocê entrou na fila para o respawn *${result.respawnName}* (${result.respawnId}).\n🔢 Posição: *${result.position}°*\n👑 Atualmente ocupado por: *${result.ownerName}*`);
                    } else {
                        const expiresDate = new Date(result.claim.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        await msg.reply(`✅ *Respawn Reservado*\n\nVocê reservou o respawn *${result.claim.respawn_name}* (${result.claim.respawn_id}) com sucesso!\n⏱️ Duração: *${result.duration} minutos*\n⏰ Expira às: *${expiresDate}*`);
                    }
                } else if (cmd === '!liberar' || cmd === '-liberar') {
                    const query = args.join(' ');
                    
                    console.log(`[WhatsApp] Comando "${cmd} ${query}" de ${senderNumber} (Discord ID: ${reg.discord_id})`);
                    const { handleLiberarLogic } = require('../commands/liberar');
                    const result = await handleLiberarLogic(user, member, query, config, discordClient);

                    if (result.error) {
                        const cleanError = result.error.replace(/\*\*/g, '*');
                        await msg.reply(cleanError);
                    } else {
                        await msg.reply(`🔓 *Respawn Liberado*\n\nO respawn *${result.claim.respawn_name}* (${result.claim.respawn_id}) está livre agora.`);
                    }
                } else if (['!ajuda', '-ajuda', '!help', '-help'].includes(cmd)) {
                    console.log(`[WhatsApp] Comando "${cmd}" de ${senderNumber}`);
                    const helpText = `📖 *GUIA DE COMANDOS DO BOT (WHATSAPP)* 📖\n\n` +
                        `Olá! Como membro registrado da guilda, você pode utilizar os seguintes comandos diretamente por aqui:\n\n` +
                        `📌 *Reservas e Fila:*\n` +
                        `• *!claim <código/nome>* ou *-claim*: Reserva um respawn ou entra na fila caso ele já esteja ocupado.\n` +
                        `• *!next <código/nome>* ou *-next*: Atalho para entrar diretamente na fila de um respawn.\n` +
                        `• *!liberar* ou *-liberar*: Libera o respawn que você está ocupando no momento.\n` +
                        `*(Apenas Admins)*: \`!liberar <código>\` para forçar a liberação do respawn de outro jogador.\n\n` +
                        `🪙 *Economia e Atividade:*\n` +
                        `• *!carteira* ou *-carteira*: Mostra seu saldo de AC, nível de atividade, XP e bônus ativo.\n` +
                        `• *!inventario* ou *-inventario*: Exibe seus itens e tokens de booster.\n` +
                        `• *!booster usar* ou *-booster usar*: Consome 1 Spawn Booster para estender sua claim ativa em +60 min.\n\n` +
                        `🔍 *Informações de Respawns:*\n` +
                        `• *!respawns* ou *-respawns*: Mostra a lista de todos os respawns ocupados no momento.\n` +
                        `• *!hunts* ou *-hunts*: Lista todas as regiões disponíveis para caça.\n` +
                        `• *!hunts <região>* ou *-hunts <região>*: Lista todos os respawns de uma região/cidade específica.\n` +
                        `• *!hunts <nome>* ou *-hunts <nome>*: Pesquisa respawns pelo nome (ex: *!hunts asura*).\n\n` +
                        `🕵️ *Guerra e Monitoramento:*\n` +
                        `• *!caçando* ou *-caçando*: Mostra a lista em tempo real dos inimigos que estão caçando.\n\n` +
                        `ℹ️ *Informação:*\n` +
                        `• *!ajuda* ou *-ajuda*: Mostra este guia de comandos.\n\n` +
                        `⚠️ *Nota importante*: Para reservar ou entrar na fila de um respawn, você precisa estar conectado a algum canal de voz no Discord da guilda.`;
                    await msg.reply(helpText);
                } else if (['!respawns', '-respawns', '!respawn', '-respawn', '!claims', '-claims', '!ocupados', '-ocupados', '!reservas', '-reservas'].includes(cmd)) {
                    console.log(`[WhatsApp] Comando "${cmd}" de ${senderNumber}`);
                    const claims = db.getActiveClaims();

                    if (claims.length === 0) {
                        await msg.reply('✅ *Nenhum respawn ocupado no momento.*');
                        return;
                    }

                    // Auxiliar para obter nome de exibição do ocupante
                    const getOccupantDisplayName = (playerId, username) => {
                        const memberReg = db.getRegisteredMember(playerId);
                        return memberReg ? memberReg.char_name : username;
                    };

                    let responseText = `📊 *RESPAWNS OCUPADOS NO MOMENTO* 📊\n\n`;
                    claims.forEach(claim => {
                        const expiresDate = new Date(claim.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                        const occupantName = getOccupantDisplayName(claim.player_id, claim.player_name);
                        
                        responseText += `• *${claim.respawn_name}* (${claim.respawn_id})\n`;
                        responseText += `  👤 Ocupante: *${occupantName}*\n`;
                        responseText += `  ⏰ Expira às: *${expiresDate}*\n`;

                        // Mostrar fila de espera (next) se houver
                        const queue = db.getQueue(claim.respawn_id);
                        if (queue.length > 0) {
                            const queueNames = queue.map((q, idx) => {
                                const qName = getOccupantDisplayName(q.player_id, q.player_name);
                                return `*${idx + 1}°* ${qName}`;
                            }).join(', ');
                            responseText += `  ⏳ Fila: ${queueNames}\n`;
                        }
                        responseText += `\n`;
                    });

                    await msg.reply(responseText.trim());
                } else if (['!hunts', '-hunts', '!lista', '-lista', '!listahunts', '-listahunts'].includes(cmd)) {
                    const query = args.join(' ').trim();
                    const respawnsList = require('../data/respawns.json');

                    if (!query) {
                        // Agrupar regiões únicas
                        const categories = [...new Set(respawnsList.map(r => r.category))].sort();
                        let responseText = `🗺️ *REGIÕES DE RESPAWNS* 🗺️\n\n` +
                            `Para listar os respawns de uma região, envie:\n` +
                            `👉 *!hunts <nome da região>*\n\n` +
                            `*Regiões disponíveis:*\n`;
                        
                        categories.forEach(cat => {
                            responseText += `• ${cat}\n`;
                        });

                        responseText += `\n💡 *Dica*: Você também pode pesquisar um respawn específico pelo nome (ex: *!hunts asura* ou *!hunts prison*).`;
                        await msg.reply(responseText);
                    } else {
                        const normalizedQuery = query.toLowerCase();

                        // 1. Verificar se a query corresponde a uma região/categoria (busca exata ou parcial)
                        const matchedCategory = [...new Set(respawnsList.map(r => r.category))].find(cat => 
                            cat.toLowerCase() === normalizedQuery || cat.toLowerCase().includes(normalizedQuery)
                        );

                        if (matchedCategory) {
                            const filtered = respawnsList.filter(r => r.category === matchedCategory);
                            let responseText = `🗺️ *RESPAWNS EM ${matchedCategory.toUpperCase()}* 🗺️\n\n` +
                                `Use o código ou o nome para reservar/entrar na fila:\n\n`;
                            
                            filtered.forEach(r => {
                                responseText += `• *${r.id}*: ${r.name}\n`;
                            });

                            await msg.reply(responseText.trim());
                        } else {
                            // 2. Tentar buscar por nome ou ID do respawn
                            const filtered = respawnsList.filter(r => 
                                r.name.toLowerCase().includes(normalizedQuery) || r.id.toLowerCase() === normalizedQuery
                            );

                            if (filtered.length > 0) {
                                // Limitar resultados para não estourar tamanho da mensagem
                                const limit = 30;
                                const sliced = filtered.slice(0, limit);
                                
                                let responseText = `🔍 *RESULTADOS DA BUSCA* 🔍\n\n`;
                                sliced.forEach(r => {
                                    responseText += `• *${r.id}*: ${r.name} (${r.category})\n`;
                                });

                                if (filtered.length > limit) {
                                    responseText += `\n*... e mais ${filtered.length - limit} respawns encontrados. Seja mais específico!*`;
                                }

                                await msg.reply(responseText.trim());
                            } else {
                                await msg.reply(`❌ Nenhum respawn ou região encontrada com o termo *"${query}"*.\nEnvie *!hunts* para ver todas as regiões.`);
                            }
                        }
                    }
                } else if (['!carteira', '-carteira', '!saldo', '-saldo', '!coins', '-coins'].includes(cmd)) {
                    console.log(`[WhatsApp] Comando "${cmd}" de ${senderNumber}`);
                    
                    const totalFrags = db.getTotalFragsForPlayer(reg.discord_id);
                    const totalVoiceMs = db.getTotalVoiceTimeMs(reg.discord_id);
                    const coins = reg.coins || 0;
                    const coinsFormatted = (coins % 1 === 0) ? coins.toFixed(0) : coins.toFixed(1);

                    const xp = reg.guild_xp || 0;
                    let level = 1;
                    if (xp >= 400) {
                        level = Math.floor(0.1 * Math.sqrt(xp));
                    }
                    const currentLevelMinXp = level === 1 ? 0 : 100 * (level ** 2);
                    const nextLevelMinXp = 100 * ((level + 1) ** 2);
                    const xpInLevel = xp - currentLevelMinXp;
                    const xpNeeded = nextLevelMinXp - currentLevelMinXp;
                    const percentage = Math.min(100, Math.floor((xpInLevel / xpNeeded) * 100));
                    
                    const filledSegments = Math.round(percentage / 10);
                    const bar = '█'.repeat(filledSegments) + '░'.repeat(10 - filledSegments);
                    const multiplierPct = ((level - 1) * 2).toFixed(0);

                    const voiceHours = Math.floor(totalVoiceMs / 3600000);
                    const voiceMins = Math.floor((totalVoiceMs % 3600000) / 60000);

                    const walletText = `💳 *CARTEIRA DE ${reg.char_name.toUpperCase()}* 💳\n\n` +
                        `💰 *Saldo Disponível:* 🪙 *${coinsFormatted} AC* (Ascended Coins)\n\n` +
                        `📈 *Nível de Atividade:* Lvl *${level}*\n` +
                        `└ \`[${bar}]\` *${percentage}%*\n` +
                        `└ ✨ *XP:* \`${xpInLevel.toFixed(0)} / ${xpNeeded} XP\`\n` +
                        `└ 🪙 *Bônus de AC:* \`+${multiplierPct}%\` extra em calls!\n\n` +
                        `🩸 *PvP Kills:* 💀 *${totalFrags} kills*\n` +
                        `🎙️ *Atividade em Voz:* ⏰ *${voiceHours}h ${voiceMins}m* em call`;
                    
                    await msg.reply(walletText);
                } else if (['!inventario', '-inventario', '!itens', '-itens', '!inv', '-inv'].includes(cmd)) {
                    console.log(`[WhatsApp] Comando "${cmd}" de ${senderNumber}`);
                    
                    const inventory = db.getInventory(reg.discord_id);
                    const boosterQty = inventory.find(i => i.item_id === 'booster')?.quantity || 0;
                    const whatsappQty = inventory.find(i => i.item_id === 'whatsapp_ad')?.quantity || 0;

                    const invText = `🎒 *INVENTÁRIO DE ${reg.char_name.toUpperCase()}* 🎒\n\n` +
                        `⏰ *Spawn Booster:* \`${boosterQty}\` tokens disponíveis\n` +
                        `_(Use com *!booster usar* para estender sua claim ativa em +60 min)_\n\n` +
                        `📢 *Anúncio no WhatsApp:* \`${whatsappQty}\` tokens disponíveis\n` +
                        `_(Permite realizar disparos globais pelo bot)_`;
                    
                    await msg.reply(invText);
                } else if (cmd === '!booster' || cmd === '-booster') {
                    const action = args[0] ? args[0].toLowerCase() : '';
                    if (action !== 'usar') {
                        await msg.reply('⚠️ Uso correto: *!booster usar*');
                        return;
                    }

                    console.log(`[WhatsApp] Comando "!booster usar" de ${senderNumber} (Discord ID: ${reg.discord_id})`);

                    if (config.claimsPaused === 'true') {
                        await msg.reply('⚠️ *O sistema de reservas (claims) está pausado no momento (Guerra ativa).*');
                        return;
                    }

                    // Check inventory
                    const qty = db.getInventoryItemQuantity(reg.discord_id, 'booster');
                    if (qty < 1) {
                        await msg.reply('❌ *Você não possui Spawn Booster no seu inventário.* Adquira um na loja do Discord!');
                        return;
                    }

                    // Find active claim
                    const activeClaim = db.getClaimByPlayer(reg.discord_id);
                    if (!activeClaim) {
                        await msg.reply('❌ *Você não possui nenhuma reserva de hunt ativa no momento para usar o booster.*');
                        return;
                    }

                    // Check queue
                    const queue = db.getQueue(activeClaim.respawn_id);
                    if (queue && queue.length > 0) {
                        await msg.reply(`⚠️ *Você não pode usar o booster pois há ${queue.length} jogador(es) na fila de espera.*`);
                        return;
                    }

                    // Check planilhado overlap
                    const newExpiresAt = activeClaim.expires_at + 60 * 60 * 1000;
                    const totalMinsRemaining = Math.ceil((newExpiresAt - Date.now()) / 60000);
                    const { checkPlanilhadoOverlap } = require('./planilhadoManager');
                    const conflictingSchedule = checkPlanilhadoOverlap(activeClaim.respawn_id, totalMinsRemaining);
                    if (conflictingSchedule) {
                        await msg.reply(`🚫 *Extensão Bloqueada:* Conflita com a reserva planilhada no horário ${conflictingSchedule.time_slot}.`);
                        return;
                    }

                    // Deduct item and update database
                    db.removeInventoryItem(reg.discord_id, 'booster', 1);
                    db.extendClaim(activeClaim.respawn_id, 60 * 60 * 1000);

                    const scheduler = require('./scheduler');
                    if (typeof scheduler.updateLiveDashboard === 'function') {
                        scheduler.updateLiveDashboard();
                    }

                    const updatedClaim = db.getClaimByRespawn(activeClaim.respawn_id);
                    const qtyLeft = db.getInventoryItemQuantity(reg.discord_id, 'booster');

                    // Check achievements
                    if (updatedClaim && (updatedClaim.expires_at - updatedClaim.claimed_at) >= 4 * 60 * 60 * 1000) {
                        try {
                            const achievements = require('./achievements');
                            const annChanId = config.reportChannelId || config.claimCommandsChannelId;
                            await achievements.checkRespawnGuardian(reg.discord_id, discordGuild, annChanId);
                        } catch (errAch) {
                            console.error('[WhatsApp] Erro ao verificar Guardião do Respawn:', errAch.message);
                        }
                    }

                    const expiresDate = new Date(updatedClaim.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    await msg.reply(`⏰ *Spawn Booster Ativado!*\n\nVocê estendeu sua reserva do respawn *${updatedClaim.respawn_name}* (${updatedClaim.respawn_id}) em *+60 minutos*.\n⏰ Novo horário de expiração: *${expiresDate}*\n🎒 Boosters restantes: *${qtyLeft}*`);
                }
            }
        } catch (err) {
            console.error('[WhatsApp] Erro ao processar mensagem recebida:', err.message);
        }
    });

    wwebClient.initialize().catch(async err => {
        connectionStatus = 'disconnected';
        console.error('[WhatsApp] Erro ao inicializar o WhatsApp:', err);
        wwebClient = null;

        const errMsg = err?.message || String(err);
        const isSessionLock = /already running|session|EEXIST|EBUSY|lock|Singleton/i.test(errMsg);

        if (attemptCount >= 2) {
            console.error(`[WhatsApp] Máximo de tentativas de inicialização atingido. WhatsApp ficará desconectado até reinício manual.`);
            return;
        }

        const primaryPath = authOverridePath || AUTH_PRIMARY;

        if (isSessionLock && attemptCount === 0) {
            console.log('[WhatsApp] Sessão em uso detectada — limpando locks e tentando novamente...');
            cleanupBrowserLocks(primaryPath);
            await init(discClient, primaryPath, attemptCount + 1);
            return;
        }

        if (isSessionLock && attemptCount === 1) {
            console.log('[WhatsApp] Tentando pasta de sessão fixa de fallback...');
            cleanupBrowserLocks(AUTH_FALLBACK);
            try {
                if (!fs.existsSync(AUTH_FALLBACK)) fs.mkdirSync(AUTH_FALLBACK, { recursive: true });
            } catch (mkdirErr) {
                console.error('[WhatsApp] Falha ao criar pasta de fallback:', mkdirErr.message);
                return;
            }
            await init(discClient, AUTH_FALLBACK, attemptCount + 1);
            return;
        }

        console.error('[WhatsApp] Não foi possível inicializar o WhatsApp. Verifique o Chrome e reinicie o bot.');
    });

    // O código de pareamento agora é solicitado dentro do handler do evento 'qr',
    // que é disparado somente quando a página do WhatsApp Web está totalmente carregada.
    // Isso evita o erro 'Invariant Violation' que ocorria ao chamar requestPairingCode muito cedo.
}

function getStatus() {
    return {
        status: connectionStatus,
        hasQr: !!qrBuffer,
        qrBuffer: qrBuffer
    };
}

async function disconnect() {
    if (!wwebClient) return;
    try {
        await wwebClient.destroy();
    } catch (err) {
        console.error('[WhatsApp] Erro ao destruir cliente:', err);
    }
    
    // Limpar dados de autenticação locais para permitir um novo QR scan
    const authDir = path.join(__dirname, '..', '.wwebjs_auth');
    if (fs.existsSync(authDir)) {
        try {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log('[WhatsApp] Pasta de sessão limpa (.wwebjs_auth)');
        } catch (e) {
            console.error('[WhatsApp] Erro ao apagar pasta de sessão:', e.message);
        }
    }
    
    // Remove o arquivo QR temporário
    const qrPath = path.join(__dirname, '..', 'data', 'qr.png');
    if (fs.existsSync(qrPath)) {
        try { fs.unlinkSync(qrPath); } catch {}
    }
    
    wwebClient = null;
    qrBuffer = null;
    connectionStatus = 'disconnected';
    state.whatsappPairingCode = null;
    try {
        db.setConfig('whatsapp_pairing_phone', '');
    } catch (e) {}
}

async function sendWhatsAppMessage(phone, messageText) {
    if (connectionStatus !== 'connected' || !wwebClient) {
        console.warn(`[WhatsApp] Não enviado (Não conectado). Destinatário: ${phone}`);
        return false;
    }

    try {
        const numberId = await resolveWhatsAppNumberId(phone);
        if (!numberId) {
            console.warn(`[WhatsApp] Não foi possível resolver o ID do número: ${phone}`);
            return false;
        }

        const isLid = normalizePhoneNumber(phone).length === 15;
        const msgWithSig = messageText + BOT_SIGNATURE;

        try {
            await wwebClient.sendMessage(numberId, msgWithSig);
            console.log(`[WhatsApp] Mensagem enviada para ${numberId}`);
            return true;
        } catch (err) {
            console.log(`[WhatsApp] Falha ao enviar para ${numberId}: ${err.message}. Tentando fallback...`);
            
            const cleanedPhone = normalizePhoneNumber(phone);
            if (!isLid && cleanedPhone.length === 13 && cleanedPhone.startsWith('55')) {
                const withoutNine = '55' + cleanedPhone.slice(2, 4) + cleanedPhone.slice(5);
                const numberIdWithoutNine = withoutNine + '@c.us';
                try {
                    await wwebClient.sendMessage(numberIdWithoutNine, msgWithSig);
                    console.log(`[WhatsApp] Mensagem enviada para ${numberIdWithoutNine} (sem 9º dígito)`);
                    resolvedJidsCache.set(cleanedPhone, numberIdWithoutNine);
                    return true;
                } catch (fallbackErr) {
                    console.warn(`[WhatsApp] Falha no fallback sem 9º dígito para ${numberIdWithoutNine}:`, fallbackErr.message);
                }
            }
        }

        console.warn(`[WhatsApp] Não foi possível entregar mensagem para ${phone}`);
        return false;
    } catch (err) {
        console.error(`[WhatsApp] Erro ao enviar mensagem para ${phone}:`, err.message);
        return false;
    }
}

function isPhoneNumberMatch(dbPhone, senderPhone) {
    if (!dbPhone || !senderPhone) return false;
    const cleanDb = dbPhone.replace(/\D/g, '');
    const cleanSender = senderPhone.replace(/\D/g, '');

    if (cleanDb === cleanSender) return true;

    let dbNorm = cleanDb;
    if (!dbNorm.startsWith('55') && (dbNorm.length === 10 || dbNorm.length === 11)) {
        dbNorm = '55' + dbNorm;
    }
    let senderNorm = cleanSender;
    if (!senderNorm.startsWith('55') && (senderNorm.length === 10 || senderNorm.length === 11)) {
        senderNorm = '55' + senderNorm;
    }

    if (dbNorm === senderNorm) return true;

    const stripNine = (num) => {
        if (num.startsWith('55') && num.length === 13 && num[4] === '9') {
            return '55' + num.slice(2, 4) + num.slice(5);
        }
        return num;
    };

    return stripNine(dbNorm) === stripNine(senderNorm);
}

function getActiveConfig() {
    const dbConfig = db.loadAllConfig();
    const CONFIG_PATH = 'c:\\Users\\pifot\\Desktop\\Discord\\bot.config.json';
    let fileConfig = {};
    if (fs.existsSync(CONFIG_PATH)) {
        try { fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* ignore */ }
    }
    return {
        guildName: dbConfig.guildName || fileConfig.guildName || '',
        worldName: dbConfig.worldName || fileConfig.worldName || '',
        enemyGuildName: dbConfig.enemyGuildName || fileConfig.enemyGuildName || null,
        registrationChannelId: dbConfig.registrationChannelId || fileConfig.registrationChannelId || null,
        claimsPaused: dbConfig.claimsPaused || fileConfig.claimsPaused || 'false',
        cargoClaim180: dbConfig.cargoClaim180 || fileConfig.cargoClaim180 || null,
        cargoClaim90: dbConfig.cargoClaim90 || fileConfig.cargoClaim90 || null,
        adminRoleId: dbConfig.adminRoleId || fileConfig.adminRoleId || null,
    };
}

function getBotNumber() {
    if (wwebClient && connectionStatus === 'connected' && wwebClient.info && wwebClient.info.wid) {
        return wwebClient.info.wid.user;
    }
    return null;
}

module.exports = {
    init,
    getStatus,
    disconnect,
    sendWhatsAppMessage,
    resolveWhatsAppNumberId,
    getBotNumber,
    BOT_PHONE,
};
