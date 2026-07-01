'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  BattleStorm Sync — Alimenta o backend do BattleStorm com dados do scraper
//
//  Usa o mesmo Puppeteer+Stealth já configurado no scraper.js do bot.
//  Consome a fila de jobs do backend e envia dados de highscore e char info.
//
//  Configuração: adicione ao .env do bot:
//    BATTLESTORM_API_URL=https://seu-backend.railway.app/api
// ─────────────────────────────────────────────────────────────────────────────

const { getHighscorePage, getGuildPage, safeGoto, initBrowser, closeBrowser } = require('./scraper');
const cheerio = require('cheerio');

const API_URL = (process.env.BATTLESTORM_API_URL || '').replace(/\/$/, '');

// Categorias do Rubinot (mesmo mapa do backend)
const CAT_LABELS = {
    16: 'Exp Hoje',
    6:  'Experiência',
};

// ── Estado interno ────────────────────────────────────────────────────────────
const state = {
    running: false,
    paused: false,
    stats: { processed: 0, errors: 0, skipped: 0, lastJobAt: null, startedAt: null },
    currentJob: null,
    loopTimer: null,
};

// ── Helpers HTTP ──────────────────────────────────────────────────────────────
async function apiPost(path, body) {
    const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
    return res.json();
}

async function apiGet(path) {
    const res = await fetch(`${API_URL}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
    return res.json();
}

// ── Busca próximo job na fila do backend ─────────────────────────────────────
async function getNextJob() {
    try {
        const data = await apiPost('/highscore/job', {});
        if (data && data.job) return data.job;
    } catch (e) {
        console.error('[BattleStorm] ❌ Erro ao buscar job:', e.message);
    }
    return null;
}

// ── Parseia tabela de highscore do HTML ──────────────────────────────────────
function parseHighscorePage(html, expectedWorld) {
    const $ = cheerio.load(html);
    const players = [];

    $('tr').each((_, row) => {
        const cols = $(row).find('td');
        if (cols.length < 5) return;

        // Tenta detectar a estrutura da tabela (rank, nome, vocação, mundo, nível, valor)
        const texts = cols.map((_, c) => $(c).text().trim()).get();

        // Ignora linhas de header
        if (texts[0] === 'Rank' || texts[0] === '#') return;

        const rank     = texts[0];
        const namEl    = $(cols[1]).find('a').first();
        const name     = namEl.length ? namEl.text().trim() : texts[1];
        const vocation = texts[2] || '';
        const world    = texts[3] || expectedWorld || '';
        const level    = parseInt(texts[4], 10) || 0;
        const value    = parseInt((texts[5] || '0').replace(/[.,\s]/g, ''), 10) || 0;

        if (name && !isNaN(level) && level > 0 && rank !== 'Rank') {
            if (!expectedWorld || world.toLowerCase() === expectedWorld.toLowerCase()) {
                players.push({ name, vocation, world, level, value });
            }
        }
    });

    return players;
}

// ── Seleciona mundo e categoria na página de highscores ─────────────────────
async function selectFilters(page, world, catLabel) {
    return page.evaluate((world, catLabel) => {
        function reactSet(select, value) {
            const nativeSet = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
            nativeSet.call(select, value);
            select.dispatchEvent(new Event('change', { bubbles: true }));
            select.dispatchEvent(new Event('input',  { bubbles: true }));
        }

        const selects = Array.from(document.querySelectorAll('select'));
        let worldSel = null, catSel = null;

        for (const sel of selects) {
            const opts = Array.from(sel.options).map(o => o.text.trim().toLowerCase());
            const joined = opts.join('|');
            if (joined.includes('auroria') || joined.includes('bellum') || joined.includes('tenebrium')) worldSel = sel;
            else if (joined.includes('exp hoje') || joined.includes('experiência')) catSel = sel;
        }

        let changedWorld = false, changedCat = false;

        if (worldSel && world) {
            const opt = Array.from(worldSel.options).find(o => o.text.trim().toLowerCase() === world.toLowerCase());
            if (opt && worldSel.value !== opt.value) { reactSet(worldSel, opt.value); changedWorld = true; }
        }

        if (catSel && catLabel) {
            const opt = Array.from(catSel.options).find(o => o.text.trim().toLowerCase() === catLabel.toLowerCase());
            if (opt && catSel.value !== opt.value) { reactSet(catSel, opt.value); changedCat = true; }
        }

        // Clica no submit se mudou algo
        if (changedWorld || changedCat) {
            const btn = document.querySelector('form button[type="submit"], form input[type="submit"], button.btn-buscar');
            if (btn) btn.click();
        }

        return { changedWorld, changedCat };
    }, world, catLabel);
}

// ── Navega para a página correta do highscore ────────────────────────────────
async function goToPage(page, targetPage) {
    if (targetPage <= 1) return;

    for (let current = 1; current < targetPage; current++) {
        const clicked = await page.evaluate((next) => {
            const allBtns = Array.from(document.querySelectorAll('a, button, span'));
            const btn = allBtns.find(el =>
                el.textContent.trim() === String(next) && el.offsetHeight > 0
            ) || allBtns.find(el =>
                (el.textContent.trim() === '›' || el.textContent.trim() === '>') && el.offsetHeight > 0
            );
            if (btn) { btn.click(); return true; }
            return false;
        }, current + 1);

        if (!clicked) break;
        await new Promise(r => setTimeout(r, 1200));
    }
}

// ── Scrapa uma página de highscore e envia ao backend ───────────────────────
async function scrapeAndSendJob(job) {
    const { world, cat, page } = job;
    const catLabel = CAT_LABELS[cat];

    if (!catLabel) {
        console.warn(`[BattleStorm] ⚠ Categoria desconhecida: ${cat}`);
        return false;
    }

    try {
        const hsPage = await getHighscorePage();

        // Navega para highscores (só se não estiver lá)
        const currentUrl = hsPage.url();
        if (!currentUrl.includes('highscores')) {
            const html = await safeGoto(hsPage, 'https://rubinot.com.br/highscores', { timeout: 30000 });
            if (!html) return false;
            await new Promise(r => setTimeout(r, 1500));
        }

        // Seleciona filtros (mundo + categoria)
        const changed = await selectFilters(hsPage, world, catLabel);
        if (changed.changedWorld || changed.changedCat) {
            await new Promise(r => setTimeout(r, 2500));
        }

        // Navega para a página correta
        if (page > 1) {
            await goToPage(hsPage, page);
            await new Promise(r => setTimeout(r, 800));
        }

        // Captura e parseia o HTML
        const html = await hsPage.content();
        const players = parseHighscorePage(html, world);

        if (players.length === 0) {
            console.warn(`[BattleStorm] ⚠ Sem players em ${world}/cat${cat}/pg${page}`);
            state.stats.skipped++;
            return false;
        }

        // Envia ao backend
        const result = await apiPost('/highscore/data', { world, category: cat, players });

        if (result.success) {
            state.stats.processed += players.length;
            state.stats.lastJobAt = new Date().toISOString();
            console.log(`[BattleStorm] ✅ ${world}/cat${cat}/pg${page} → ${players.length} players (${result.saved} salvos, ${result.skipped} pulados)`);
            return true;
        } else {
            state.stats.errors++;
            console.warn(`[BattleStorm] ⚠ Backend rejeitou dados: ${result.error}`);
            return false;
        }

    } catch (e) {
        state.stats.errors++;
        console.error(`[BattleStorm] ❌ Erro no job ${world}/cat${cat}/pg${page}:`, e.message);
        return false;
    }
}

// ── Loop principal do Scraper A (EXP diária) ─────────────────────────────────
async function scraperALoop() {
    if (!state.running || state.paused) return;

    const job = await getNextJob();
    if (!job) {
        console.log('[BattleStorm] 💤 Sem jobs disponíveis, aguardando 30s...');
        state.loopTimer = setTimeout(scraperALoop, 30000);
        return;
    }

    state.currentJob = job;
    await scrapeAndSendJob(job);

    // Próximo job: 3-6s de espera (gentil com o servidor)
    const delay = 3000 + Math.random() * 3000;
    state.loopTimer = setTimeout(scraperALoop, delay);
}

// ── Scraper B: atualiza info dos chars da guild (1x/dia) ─────────────────────
async function runCharSync() {
    console.log('[BattleStorm] 🎮 Iniciando sync de chars...');
    let processed = 0, updated = 0, errors = 0;

    try {
        // Busca lista de chars do backend
        const data = await apiPost('/highscore/char-jobs', {});
        if (!data.success || !data.jobs || data.jobs.length === 0) {
            console.log('[BattleStorm] Nenhum char para atualizar.');
            return;
        }

        console.log(`[BattleStorm] 📋 ${data.jobs.length} chars na fila`);

        // Importa scrapePlayer do scraper existente
        const { scrapePlayer } = require('./scraper');

        for (const job of data.jobs) {
            try {
                const charInfo = await scrapePlayer(job.charName);

                if (charInfo) {
                    const result = await apiPost('/highscore/char-update', {
                        charName:    job.charName,
                        world:       job.world,
                        level:       charInfo.level,
                        vocation:    charInfo.vocation,
                        lastLogin:   '',
                        lastDeath:   '',
                        currentName: charInfo.name,
                        currentWorld: charInfo.world || job.world,
                    });

                    if (result.success) {
                        updated++;
                        console.log(`[BattleStorm] ✓ ${charInfo.name} Lv${charInfo.level} ${charInfo.vocation}`);
                    }
                } else {
                    console.warn(`[BattleStorm] ⚠ Char não encontrado: ${job.charName}`);
                }

                processed++;
                // 1.5-3s entre chars (gentil com o servidor)
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));

            } catch (e) {
                errors++;
                console.error(`[BattleStorm] ❌ Erro no char ${job.charName}:`, e.message);
            }
        }

        console.log(`[BattleStorm] ✅ Char sync completo: ${updated}/${processed} atualizados, ${errors} erros`);

    } catch (e) {
        console.error('[BattleStorm] ❌ Erro no char sync:', e.message);
    }
}

// ── Agendamento do Scraper B (1x/dia após 09:00 BRT) ─────────────────────────
function scheduleCharSync() {
    const now = new Date();
    // BRT = UTC-3
    const brtHour = (now.getUTCHours() - 3 + 24) % 24;
    const brtMin  = now.getUTCMinutes();

    let msUntilTrigger;

    if (brtHour < 9 || (brtHour === 9 && brtMin === 0)) {
        // Agenda para às 09:01 BRT de hoje
        const target = new Date(now);
        const hoursUntil = (9 - brtHour + 24) % 24;
        target.setUTCHours(now.getUTCHours() + hoursUntil, 1, 0, 0);
        msUntilTrigger = target - now;
    } else {
        // Agenda para às 09:01 BRT de amanhã
        const target = new Date(now);
        target.setUTCDate(target.getUTCDate() + 1);
        target.setUTCHours(12, 1, 0, 0); // 09:01 BRT = 12:01 UTC
        msUntilTrigger = target - now;
    }

    const horas = Math.round(msUntilTrigger / 3600000);
    console.log(`[BattleStorm] ⏰ Char sync agendado para daqui ${horas}h`);

    setTimeout(async () => {
        await runCharSync();
        scheduleCharSync(); // Re-agenda para o próximo dia
    }, msUntilTrigger);
}

// ── API pública ───────────────────────────────────────────────────────────────
function getStatus() {
    return {
        running:    state.running,
        paused:     state.paused,
        currentJob: state.currentJob,
        stats:      state.stats,
    };
}

function pause()  { state.paused = true;  console.log('[BattleStorm] ⏸ Scraper pausado.'); }
function resume() { state.paused = false; console.log('[BattleStorm] ▶ Scraper retomado.'); scraperALoop(); }

// ── Inicialização ─────────────────────────────────────────────────────────────
async function start() {
    if (!API_URL) {
        console.warn('[BattleStorm] ⚠ BATTLESTORM_API_URL não configurada no .env — sync desabilitado.');
        return;
    }

    // Testa conectividade com o backend
    try {
        await apiGet('/health');
        console.log(`[BattleStorm] 🔗 Backend conectado: ${API_URL}`);
    } catch (e) {
        console.warn(`[BattleStorm] ⚠ Backend inacessível (${e.message}) — sync desabilitado por enquanto.`);
        // Tenta novamente em 5 minutos
        setTimeout(start, 5 * 60 * 1000);
        return;
    }

    state.running    = true;
    state.stats      = { processed: 0, errors: 0, skipped: 0, lastJobAt: null, startedAt: new Date().toISOString() };
    state.currentJob = null;

    console.log('[BattleStorm] ⚔️  Scraper iniciado! Contribuindo para o banco de dados da guild...');

    // Inicia loop do scraper A imediatamente
    scraperALoop();

    // Agendamento do char sync (1x/dia)
    scheduleCharSync();
}

module.exports = { start, pause, resume, getStatus, runCharSync };
