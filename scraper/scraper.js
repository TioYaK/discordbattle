'use strict';

const fs   = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');

puppeteer.use(StealthPlugin());

// ─── Localizar Chrome ─────────────────────────────────────────────────────────
function findChrome() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.CHROME_PATH,
    ].filter(Boolean);

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null; // puppeteer usará o bundled chromium
}

// ─── Estado do browser ────────────────────────────────────────────────────────
let globalBrowser  = null;
let guildPage      = null;
let highscoresPage = null;
let isRestarting   = false;
let cfRestartCount = 0;
const MAX_CF_RESTARTS = 3;

// locks para evitar concorrência/navegações simultâneas na mesma página/aba do Puppeteer
let guildPageLock = Promise.resolve();
let highscoresPageLock = Promise.resolve();

// ─── Detecção de Cloudflare ───────────────────────────────────────────────────
async function isCloudflareBlocked(page) {
    try {
        const title = await page.title();
        const url   = page.url();
        const html  = await page.content();

        const titleBlocked = title.includes('Just a moment') ||
                             title.includes('Attention Required') ||
                             title.includes('Access denied') ||
                             title.includes('Please Wait');
        const urlBlocked   = url.includes('cloudflare') || url.includes('/cdn-cgi/');
        const bodyBlocked  = html.includes('cf-browser-verification') ||
                             html.includes('cf-challenge') ||
                             html.includes('cf_clearance') ||
                             html.includes('__cf_chl') ||
                             html.includes('Checking your browser') ||
                             html.includes('Enable JavaScript and cookies to continue');

        return titleBlocked || urlBlocked || bodyBlocked;
    } catch {
        return false;
    }
}

// ─── Gerenciamento do Browser ─────────────────────────────────────────────────
async function closeBrowser() {
    try {
        if (guildPage)      { await guildPage.close().catch(() => {}); guildPage = null; }
        if (highscoresPage) { await highscoresPage.close().catch(() => {}); highscoresPage = null; }
        if (globalBrowser)  { await globalBrowser.close().catch(() => {}); globalBrowser = null; }
    } catch (e) {
        console.error('[Scraper] Erro ao fechar browser:', e.message);
    }
}

async function initBrowser() {
    if (globalBrowser) return;
    console.log('[Scraper] Abrindo browser...');
    const chromeExe = findChrome();
    const launchOpts = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--window-size=1920,1080',
        ],
    };
    if (chromeExe) launchOpts.executablePath = chromeExe;

    globalBrowser = await puppeteer.launch(launchOpts);
    globalBrowser.on('disconnected', () => {
        console.log('[Scraper] Browser desconectado. Limpando estado...');
        globalBrowser  = null;
        guildPage      = null;
        highscoresPage = null;
    });
    console.log('[Scraper] 🌐 Browser iniciado.');
}

async function restartBrowserDueToCloudflare() {
    if (isRestarting) return;
    isRestarting = true;
    cfRestartCount++;
    console.warn(`[Scraper] ⚠ Cloudflare! Reiniciando browser... (${cfRestartCount}/${MAX_CF_RESTARTS})`);

    if (cfRestartCount > MAX_CF_RESTARTS) {
        console.error('[Scraper] ❌ Muitas tentativas CF. Aguardando 5min...');
        await new Promise(r => setTimeout(r, 5 * 60 * 1000));
        cfRestartCount = 0;
    }

    await closeBrowser();
    const waitSec = cfRestartCount * 10;
    console.log(`[Scraper] Aguardando ${waitSec}s antes de reabrir...`);
    await new Promise(r => setTimeout(r, waitSec * 1000));

    try {
        await initBrowser();
    } finally {
        isRestarting = false;
    }
}

async function getGuildPage() {
    await initBrowser();
    if (!guildPage || guildPage.isClosed()) {
        guildPage = await globalBrowser.newPage();
        await guildPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    }
    return guildPage;
}

async function getHighscorePage() {
    await initBrowser();
    if (!highscoresPage || highscoresPage.isClosed()) {
        highscoresPage = await globalBrowser.newPage();
        await highscoresPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    }
    return highscoresPage;
}

// ─── Navegação com proteção Cloudflare ───────────────────────────────────────
async function safeGoto(page, url, { timeout = 30000 } = {}) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout });
    } catch (e) {
        console.warn(`[Scraper] Timeout/erro ao navegar para ${url}: ${e.message}`);
    }

    if (await isCloudflareBlocked(page)) {
        console.log('[Scraper] Challenge do Cloudflare detectado. Aguardando resolução...');
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 });
        } catch { /* não resolveu automaticamente */ }

        if (await isCloudflareBlocked(page)) {
            console.warn('[Scraper] Cloudflare NÃO resolvido. Reiniciando browser...');
            return null;
        }
        console.log('[Scraper] ✅ Cloudflare resolvido!');
        cfRestartCount = 0;
    }

    try {
        return await page.content();
    } catch (e) {
        return null;
    }
}

async function getPageContent(url, { isHighscores = false } = {}) {
    const pageLock = isHighscores ? highscoresPageLock : guildPageLock;
    
    // Adquire o lock (enfileira a requisição)
    let release;
    const nextLock = new Promise(r => release = r);
    if (isHighscores) {
        highscoresPageLock = highscoresPageLock.then(() => nextLock);
    } else {
        guildPageLock = guildPageLock.then(() => nextLock);
    }
    
    await pageLock;

    try {
        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const page = isHighscores ? await getHighscorePage() : await getGuildPage();
                console.log(`[Scraper] Navegando para: ${url} (tentativa ${attempt}/${MAX_RETRIES})`);
                const html = await safeGoto(page, url);
                if (html === null) {
                    await restartBrowserDueToCloudflare();
                    continue;
                }
                return html;
            } catch (error) {
                console.error(`[Scraper] Erro na tentativa ${attempt}:`, error.message);
                if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000 * attempt));
            }
        }
        console.error(`[Scraper] ❌ Falha após ${MAX_RETRIES} tentativas para: ${url}`);
        return null;
    } finally {
        // Libera o lock para o próximo na fila
        release();
    }
}

const https = require('https');
const zlib = require('zlib');
const RUBINOTEVE_API_BASE = 'https://rubinot-eve.otservices.space';

async function safeFetchJson(fullUrl, method = 'GET') {
    if (typeof fetch === 'function') {
        const res = await fetch(fullUrl, {
            method,
            headers: {
                Accept: 'application/json',
                'User-Agent': 'AscendedBot/1.0',
            },
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const text = await res.text();
        return text ? JSON.parse(text) : null;
    }

    return await httpsJsonRequest(fullUrl, method);
}

function buildOutfitUrl(profile) {
    if (!profile || typeof profile.outfitLooktype !== 'number') return null;
    const params = new URLSearchParams();
    params.set('type', String(profile.outfitLooktype));
    if (profile.outfitLookhead !== undefined) params.set('head', String(profile.outfitLookhead));
    if (profile.outfitLookbody !== undefined) params.set('body', String(profile.outfitLookbody));
    if (profile.outfitLooklegs !== undefined) params.set('legs', String(profile.outfitLooklegs));
    if (profile.outfitLookfeet !== undefined) params.set('feet', String(profile.outfitLookfeet));
    if (profile.outfitAddons !== undefined) params.set('addons', String(profile.outfitAddons));
    params.set('direction', '3');
    params.set('animated', '1');
    params.set('walk', '1');
    params.set('format', 'gif');
    return `${RUBINOTEVE_API_BASE}/api/data/v1/outfit?${params.toString()}`;
}

function httpsJsonRequest(fullUrl, method = 'GET') {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(fullUrl);
        const options = {
            method,
            headers: {
                Accept: 'application/json',
                'User-Agent': 'AscendedBot/1.0',
                'Accept-Encoding': 'gzip,deflate',
                Connection: 'close',
            },
        };

        const req = https.request(urlObj, options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const encoding = (res.headers['content-encoding'] || '').toLowerCase();
                let raw = buffer;

                try {
                    if (encoding === 'gzip') raw = zlib.gunzipSync(buffer);
                    else if (encoding === 'deflate') raw = zlib.inflateSync(buffer);
                } catch (err) {
                    return reject(err);
                }

                const text = raw.toString('utf8');
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`HTTP ${res.statusCode}: ${text}`));
                }

                try {
                    resolve(text ? JSON.parse(text) : null);
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Request timed out')));
        if (method === 'POST') {
            req.end();
        } else {
            req.end();
        }
    });
}

async function fetchRubinotEveCharacter(characterName, world) {
    if (!characterName) return null;
    const encodedName = encodeURIComponent(characterName);
    const worldQuery = world ? `world=${encodeURIComponent(world)}` : '';
    const base = RUBINOTEVE_API_BASE;

    const profilePath = `${base}/api/characters/${encodedName}/enrich?${worldQuery}`;
    const timeOnlinePath = `${base}/api/characters/${encodedName}/time-online?${worldQuery}&range=30d&tz=America%2FSao_Paulo`;
    const huntingPath = `${base}/api/characters/${encodedName}/hunting-heatmap?${worldQuery}&range=30d&tz=America%2FSao_Paulo`;

    const [profile, timeOnline, huntingHeatmap] = await Promise.all([
        safeFetchJson(profilePath, 'POST'),
        safeFetchJson(timeOnlinePath, 'GET'),
        safeFetchJson(huntingPath, 'GET'),
    ]);

    return {
        profile,
        timeOnline,
        huntingHeatmap,
        outfitUrl: buildOutfitUrl(profile),
    };
}

async function scrapeRubinotCharacterPage(characterName) {
    if (!characterName) return null;
    await initBrowser();

    let tempPage = null;
    try {
        tempPage = await globalBrowser.newPage();
        await tempPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const url = `https://rubinot-eve.otservices.space/characters/${encodeURIComponent(characterName)}`;
        await tempPage.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 1200));

        const tabs = [
            ['character', 'character'],
            ['history', 'history'],
            ['skills', 'skills'],
            ['experience', 'experience'],
            ['time-online', 'timeOnline'],
        ];

        const pageData = {};

        for (const [tabName, key] of tabs) {
            const trigger = await tempPage.$(`[id$="-trigger-${tabName}"]`);
            if (trigger) {
                try {
                    await trigger.click();
                } catch (e) {
                    // ignore click failures; try to parse whatever is available
                }
                await new Promise(resolve => setTimeout(resolve, 900));
            }

            const panelData = await tempPage.evaluate((tabName) => {
                function getPanel() {
                    return document.querySelector(`[id$="-content-${tabName}"]`);
                }

                function extractLabel(text, label) {
                    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const stopTerms = ['Party exp sharing range', 'Vocation', 'Level', 'World', 'Residence', 'Sex', 'Guild', 'Achievement Points', 'Charm Points', 'Boss Points', 'Bounty Points', 'Tibian Age', 'Online', 'Hunting', 'Avg XP/h', 'Avg Raw XP/h', 'Total'];
                    const stops = stopTerms.filter(term => term !== label).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
                    const regex = new RegExp(`${escaped}\\s*:?\\s*([\\s\\S]*?)(?=\\s*(?:${stops})|$)`, 'i');
                    const match = text.match(regex);
                    return match ? match[1].trim() : null;
                }

                const panel = getPanel();
                if (!panel) return null;
                const text = panel.innerText.trim();

                if (tabName === 'character') {
                    const result = {
                        partyExpSharingRange: extractLabel(text, 'Party exp sharing range'),
                        vocation: extractLabel(text, 'Vocation'),
                        level: extractLabel(text, 'Level'),
                        world: extractLabel(text, 'World'),
                        residence: extractLabel(text, 'Residence'),
                        sex: extractLabel(text, 'Sex'),
                        guild: extractLabel(text, 'Guild'),
                        achievementPoints: extractLabel(text, 'Achievement Points'),
                        charmPoints: extractLabel(text, 'Charm Points'),
                        bossPoints: extractLabel(text, 'Boss Points'),
                        bountyPoints: extractLabel(text, 'Bounty Points'),
                        tibianAge: extractLabel(text, 'Tibian Age'),
                        rawText: text,
                        progression: {},
                    };

                    const completeNode = panel.querySelector('.text-2xl.font-bold');
                    if (completeNode) {
                        result.rubinotComplete = completeNode.innerText.trim();
                        const sibling = completeNode.nextElementSibling;
                        if (sibling) result.rubinotPoints = sibling.innerText.trim();
                    }

                    const rows = Array.from(panel.querySelectorAll('div.flex.justify-between'));
                    rows.forEach(row => {
                        const labelEl = row.querySelector('span.text-muted-foreground');
                        const valueEl = row.querySelector('span.font-mono.tabular-nums, span.font-mono');
                        if (labelEl && valueEl) {
                            result.progression[labelEl.innerText.trim()] = valueEl.innerText.trim();
                        }
                    });

                    return result;
                }

                if (tabName === 'history') {
                    const rows = Array.from(panel.querySelectorAll('div.flex.items-start.gap-3.text-sm')).map(row => {
                        const when = row.querySelector('span.tabular-nums')?.innerText.trim() || null;
                        const title = row.querySelector('span.inline-flex')?.innerText.trim() || null;
                        const description = row.querySelector('span.text-muted-foreground')?.innerText.trim() || null;
                        return { when, title, description };
                    }).filter(r => r.when || r.title || r.description);
                    return { rows, rawText: text };
                }

                if (tabName === 'skills') {
                    const cards = Array.from(panel.querySelectorAll('div.bg-card'));
                    const skills = cards.map(card => {
                        const name = card.querySelector('span.text-xs.text-muted-foreground')?.innerText.trim() || null;
                        const value = card.querySelector('span.font-mono.text-2xl')?.innerText.trim() || card.querySelector('span.font-mono')?.innerText.trim() || null;
                        const rankText = card.querySelector('div.flex.items-center.justify-between')?.innerText.trim() || null;
                        const worldRank = rankText ? rankText.match(/#([\d,]+)\s*world/i)?.[1] || null : null;
                        const globalRank = rankText ? rankText.match(/#([\d,]+)\s*global/i)?.[1] || null : null;
                        const change = Array.from(card.querySelectorAll('span')).find(span => /30d change/i.test(span.innerText))?.innerText.trim() || null;
                        return { name, value, worldRank, globalRank, change };
                    }).filter(skill => skill.name || skill.value);
                    return { skills, rawText: text };
                }

                if (tabName === 'experience') {
                    const result = {
                        totalExperience: extractLabel(text, 'Total'),
                        avgExpHour: extractLabel(text, 'Avg Exp/h'),
                        rawText: text,
                    };
                    return result;
                }

                if (tabName === 'time-online') {
                    const result = {
                        online: extractLabel(text, 'Online'),
                        hunting: extractLabel(text, 'Hunting'),
                        avgXpHour: extractLabel(text, 'Avg XP/h'),
                        avgRawXpHour: extractLabel(text, 'Avg Raw XP/h'),
                        rawText: text,
                    };
                    return result;
                }

                return { rawText: text };
            }, tabName);
            pageData[key] = panelData;
        }

        return pageData;
    } catch (error) {
        console.error('[Scraper] Erro ao coletar página de personagem:', error.message);
        return null;
    } finally {
        if (tempPage) await tempPage.close().catch(() => {});
    }
}

// ─── Cache helpers ────────────────────────────────────────────────────────────
const CACHE_DIR  = path.join(__dirname, '..', 'data');
const CACHE_TTL  = 15 * 1000; // 15 segundos

function readCache(name) {
    const p = path.join(CACHE_DIR, `cache_${name}.json`);
    if (!fs.existsSync(p)) return null;
    const age = Date.now() - fs.statSync(p).mtimeMs;
    if (age >= CACHE_TTL) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeCache(name, data) {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    try { fs.writeFileSync(path.join(CACHE_DIR, `cache_${name}.json`), JSON.stringify(data)); } catch { /* ignore */ }
}

// ─── scrapeGuild ──────────────────────────────────────────────────────────────
async function scrapeGuild(guildName) {
    const key = `guild_${guildName.replace(/\s+/g, '_')}`;
    const cached = readCache(key);
    if (cached) {
        console.log(`[Scraper] ⚡ Cache de Guilda (${guildName})`);
        return cached;
    }

    console.log(`[Scraper] Scraping Guild: ${guildName}...`);
    const url  = `https://rubinot.com.br/guilds/${encodeURIComponent(guildName)}`;
    const html = await getPageContent(url);
    if (!html) return [];

    const $ = cheerio.load(html);
    const members = [];

    $('tr').each((i, row) => {
        const cols = $(row).find('td');
        if (cols.length >= 6) {
            const rank          = $(cols[0]).text().trim();
            const nameAndTitle  = $(cols[1]).find('a').first().text().trim() || $(cols[1]).text().trim();
            const vocation      = $(cols[2]).text().trim();
            const level         = parseInt($(cols[3]).text().trim(), 10);
            const joiningDate   = $(cols[4]).text().trim();
            const status        = $(cols[5]).text().trim();

            if (nameAndTitle && !isNaN(level) && nameAndTitle !== 'Name and Title') {
                const name = nameAndTitle.replace(/\s*\([^)]*\)/g, '').trim();
                members.push({
                    rank: rank || 'Member',
                    name,
                    vocation,
                    level,
                    joiningDate,
                    status: status.toLowerCase().includes('online') ? 'Online' : 'Offline',
                });
            }
        }
    });

    if (members.length > 0) writeCache(key, members);
    return members;
}

// ─── scrapeHighscores ─────────────────────────────────────────────────────────
async function scrapeHighscores(world, onPageScraped, maxPages = 20) {
    const key = `highscores_${(world || 'all').toLowerCase().replace(/\s+/g, '_')}`;
    const cached = readCache(key);
    if (cached) {
        console.log(`[Scraper] ⚡ Cache de Highscores (${world || 'Global'})`);
        if (onPageScraped) {
            for (let i = 0; i < cached.length; i += 50) onPageScraped(cached.slice(i, i + 50));
        }
        return cached;
    }

    console.log(`[Scraper] Scraping Highscores para: ${world}...`);
    const allPlayers = [];
    let pageNum = 1;
    let keepGoing = true;

    try {
        const page = await getHighscorePage();
        const html = await safeGoto(page, 'https://rubinot.com.br/highscores', { timeout: 30000 });
        if (html === null) {
            await restartBrowserDueToCloudflare();
            return allPlayers;
        }

        if (world) {
            const optionValue = await page.evaluate((worldName) => {
                const opt = Array.from(document.querySelectorAll('select option'))
                    .find(o => o.textContent.trim().toLowerCase() === worldName.toLowerCase());
                return opt ? opt.value : null;
            }, world);

            if (optionValue) {
                try {
                    await page.select('select', optionValue);
                    await new Promise(r => setTimeout(r, 2000));
                } catch (e) {
                    if (!e.message.includes('Target closed') && !e.message.includes('Session closed')) {
                        console.warn(`[Scraper] Erro ao selecionar mundo: ${e.message}`);
                    }
                }
            }
        }

        while (keepGoing && pageNum <= maxPages) {
            if (isRestarting) break;

            let pageHtml;
            try {
                pageHtml = await page.content();
            } catch (e) {
                if (e.message.includes('Target closed') || e.message.includes('Session closed')) break;
                throw e;
            }

            if (await isCloudflareBlocked(page)) {
                await restartBrowserDueToCloudflare();
                break;
            }

            const $ = cheerio.load(pageHtml);
            const playersOnPage = [];

            $('tr').each((i, row) => {
                const cols = $(row).find('td');
                if (cols.length >= 6) {
                    const rank       = $(cols[0]).text().trim();
                    const name       = $(cols[1]).text().trim();
                    const vocation   = $(cols[2]).text().trim();
                    const worldCol   = $(cols[3]).text().trim();
                    const level      = parseInt($(cols[4]).text().trim(), 10);
                    const experience = parseInt($(cols[5]).text().replace(/[,.]/g, '').trim(), 10);

                    if (name && !isNaN(level) && !isNaN(experience) && rank !== 'Rank') {
                        if (!world || worldCol.toLowerCase() === world.toLowerCase()) {
                            playersOnPage.push({ rank, name, vocation, world: worldCol, level, experience });
                        }
                    }
                }
            });

            if (playersOnPage.length === 0) {
                keepGoing = false;
            } else {
                allPlayers.push(...playersOnPage);
                console.log(`[Scraper] Página ${pageNum}: ${playersOnPage.length} jogadores`);
                if (onPageScraped) onPageScraped(playersOnPage);

                if (pageNum >= maxPages) { keepGoing = false; break; }

                const oldFirstName = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('tr'));
                    for (const row of rows) {
                        const cols = Array.from(row.querySelectorAll('td'));
                        if (cols.length >= 6) {
                            const rank = cols[0].textContent.trim();
                            if (rank !== 'Rank' && rank !== '') {
                                return cols[1].textContent.trim();
                            }
                        }
                    }
                    return null;
                }).catch(() => null);

                await new Promise(r => setTimeout(r, 300));

                let clicked = false;
                try {
                    clicked = await page.evaluate((next) => {
                        const link = Array.from(document.querySelectorAll('a, button'))
                            .find(el => el.textContent.trim() === String(next));
                        if (link) { link.click(); return true; }
                        return false;
                    }, pageNum + 1);
                } catch (e) {
                    if (e.message.includes('Target closed') || e.message.includes('Session closed')) break;
                    throw e;
                }

                if (clicked) {
                    if (oldFirstName) {
                        try {
                            await page.waitForFunction((oldName) => {
                                const rows = Array.from(document.querySelectorAll('tr'));
                                for (const row of rows) {
                                    const cols = Array.from(row.querySelectorAll('td'));
                                    if (cols.length >= 6) {
                                        const rank = cols[0].textContent.trim();
                                        if (rank !== 'Rank' && rank !== '') {
                                            const currentName = cols[1].textContent.trim();
                                            return currentName !== oldName;
                                        }
                                    }
                                }
                                return false;
                            }, { timeout: 1000 }, oldFirstName);
                        } catch (e) {
                            // Prossegue após 1s de timeout se não atualizar no DOM
                        }
                    } else {
                        await new Promise(r => setTimeout(r, 800));
                    }
                    pageNum++;
                } else {
                    keepGoing = false;
                }
            }
        }

        if (allPlayers.length > 0) writeCache(key, allPlayers);
    } catch (error) {
        console.error('[Scraper] Erro ao scraping highscores:', error);
    }

    return allPlayers;
}

// ─── scrapePlayer ─────────────────────────────────────────────────────────────
async function scrapePlayer(playerName) {
    const cleanPlayerName = playerName ? playerName.replace(/\s*\(.*?\)/g, '').trim() : '';
    console.log(`[Scraper] Buscando personagem: "${cleanPlayerName}"...`);

    let tempPage = null;
    try {
        await initBrowser();
        tempPage = await globalBrowser.newPage();
        await tempPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await tempPage.goto('https://rubinot.com.br/characters', { waitUntil: 'networkidle2', timeout: 30000 });
        const input = await tempPage.waitForSelector('input[placeholder="Digite o nome do personagem..."]', { timeout: 10000 });
        if (!input) {
            console.warn('[Scraper] Campo de busca não encontrado.');
            return null;
        }

        await input.click({ clickCount: 3 });
        await input.type(cleanPlayerName, { delay: 50 });

        const clicked = await tempPage.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button'))
                .find(b => b.innerText.trim().toLowerCase().includes('buscar'));
            if (btn) { btn.click(); return true; }
            return false;
        });

        if (!clicked) await input.press('Enter');

        try {
            await tempPage.waitForFunction(() => {
                const body = document.body.innerText;
                return body.includes('Level:') || body.includes('Vocation:') ||
                       body.includes('não encontrado') || body.includes('not found') ||
                       body.includes('Nível:') || body.includes('Vocação:');
            }, { timeout: 10000 });
        } catch { /* timeout — captura o que tiver */ }

        await new Promise(r => setTimeout(r, 1000));

        const result = await tempPage.evaluate(() => {
            const bodyText = document.body.innerText;
            if (bodyText.toLowerCase().includes('não encontrado') || bodyText.toLowerCase().includes('not found')) return null;

            const data = { level: null, vocation: null, guild: null, world: null, isOnline: false };

            Array.from(document.querySelectorAll('*')).forEach(el => {
                if (el.children.length > 0) return;
                const text = (el.innerText || '').trim();
                if (!text) return;
                const parent   = el.parentElement;
                if (!parent) return;
                const siblings = Array.from(parent.children);
                const idx      = siblings.indexOf(el);
                const nextVal  = siblings[idx + 1] ? (siblings[idx + 1].innerText || '').trim() : '';

                if (text === 'Level:' || text === 'Nível:')   data.level   = nextVal;
                if (text === 'Vocation:' || text === 'Vocação:') data.vocation = nextVal;
                if (text === 'Guild:' || text === 'Guilda:' || text === 'Guild membership:') data.guild = nextVal;
                if (text === 'World:' || text === 'Mundo:')   data.world   = nextVal;
            });

            data.isOnline = bodyText.toLowerCase().includes('online') && !bodyText.toLowerCase().includes('offline');

            if (!data.level) {
                const m = bodyText.match(/(?:Level|Nível)[:\s]+(\d+)/i);
                if (m) data.level = m[1];
            }
            if (!data.vocation) {
                const m = bodyText.match(/(?:Vocation|Vocação)[:\s]+([^\n]+)/i);
                if (m) data.vocation = m[1].trim();
            }

            return data.level ? data : null;
        });

        if (!result) {
            console.warn(`[Scraper] Personagem "${playerName}" não encontrado.`);
            return null;
        }

        console.log(`[Scraper] ✅ ${cleanPlayerName} — Lv.${result.level} ${result.vocation}`);
        return {
            name:     cleanPlayerName,
            level:    result.level    || 'Desconhecido',
            vocation: result.vocation || 'Desconhecida',
            guild:    result.guild    || 'Nenhuma',
            world:    result.world    || 'Desconhecido',
            status:   result.isOnline ? 'Online' : 'Offline',
        };

    } catch (err) {
        console.error(`[Scraper] Erro ao buscar "${cleanPlayerName}":`, err.message);
        return null;
    } finally {
        if (tempPage) tempPage.close().catch(() => {});
    }
}

// ─── scrapeDeaths ─────────────────────────────────────────────────────────────
async function scrapeDeaths(world) {
    const key    = `deaths_${(world || 'all').toLowerCase().replace(/\s+/g, '_')}`;
    const cached = readCache(key);
    if (cached) {
        console.log(`[Scraper] ⚡ Cache de Mortes (${world || 'Global'})`);
        return cached;
    }

    console.log(`[Scraper] Buscando mortes para: ${world}...`);
    const allDeaths = [];

    try {
        const page = await getGuildPage();
        const html = await safeGoto(page, 'https://rubinot.com.br/deaths', { timeout: 30000 });
        if (html === null) {
            await restartBrowserDueToCloudflare();
            return allDeaths;
        }

        const $ = cheerio.load(html);

        $('tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 3) {
                const timeStr  = $(cols[0]).text().trim();
                const worldCol = $(cols[1]).text().trim();
                const infoText = $(cols[2]).text().trim();
                const isPvP    = $(cols[2]).find('a').length > 1;

                if (timeStr && infoText) {
                    if (!world || worldCol.toLowerCase() === world.toLowerCase()) {
                        const m = infoText.match(/^(.*?)\s+morreu no level\s+(\d+)\s+por\s+(.*?)\.?$/i);
                        if (m) {
                            allDeaths.push({
                                timeStr,
                                world: worldCol,
                                name:     m[1].trim(),
                                level:    parseInt(m[2], 10),
                                killedBy: m[3].trim(),
                                info:     infoText,
                                isPvP:    isPvP,
                            });
                        }
                    }
                }
            }
        });

        if (allDeaths.length > 0) writeCache(key, allDeaths);
    } catch (error) {
        console.error('[Scraper] Erro ao scraping mortes:', error);
    }

    return allDeaths;
}

module.exports = {
    scrapeGuild,
    scrapeHighscores,
    scrapePlayer,
    scrapeDeaths,
    fetchRubinotEveCharacter,
    scrapeRubinotCharacterPage,
    closeBrowser,
};
