/* =============================================
   ASCENDED RPG DASHBOARD — app.js
   Vanilla JS, sem dependências externas.
   ============================================= */

// Spawn floating particles
(function spawnParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    for (let i = 0; i < 30; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = Math.random() * 100 + 'vw';
        p.style.animationDuration = (10 + Math.random() * 20) + 's';
        p.style.animationDelay = (Math.random() * 20) + 's';
        p.style.width = p.style.height = (1 + Math.random() * 3) + 'px';
        container.appendChild(p);
    }
})();

// ==================== TABS ====================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
});

// ==================== FETCH ====================
async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        if (!res.ok) throw new Error('Status ' + res.status);
        const data = await res.json();
        document.getElementById('totalPlayers').textContent = data.players ?? '--';
        document.getElementById('currentCycle').textContent = data.currentCycle || 'N/A';
    } catch (err) {
        console.warn('[Stats] Falha ao carregar:', err.message);
    }
}

async function fetchRanking() {
    try {
        const res = await fetch('/api/ranking');
        if (!res.ok) throw new Error('Status ' + res.status);
        const data = await res.json();
        renderLeaderboard(data);
        renderPetGrid(data);
        updateTimestamp();
    } catch (err) {
        console.warn('[Ranking] Falha ao carregar:', err.message);
        const list = document.getElementById('leaderboardList');
        if (list) list.innerHTML = `<div class="loading-state" style="color:#e74c3c">❌ Bot offline ou sem dados. Verifique se o servidor está rodando.</div>`;
    }
}

// ==================== RENDER: LEADERBOARD ====================
function renderLeaderboard(players) {
    const list = document.getElementById('leaderboardList');
    if (!list) return;

    if (!players || players.length === 0) {
        list.innerHTML = '<div class="loading-state">Nenhum herói registrado ainda.</div>';
        return;
    }

    list.innerHTML = '';

    const rankEmojis = ['🥇', '🥈', '🥉'];
    const rankClasses = ['r1', 'r2', 'r3'];

    players.forEach((player, idx) => {
        const rank = idx + 1;
        const rankLabel = rank <= 3 ? rankEmojis[idx] : `#${rank}`;
        const rankCls = rank <= 3 ? rankClasses[idx] : '';

        const formatCoins = (c) => {
            if (!c) return '0 AC';
            if (c >= 1_000_000) return (c / 1_000_000).toFixed(2) + 'kk AC';
            if (c >= 1_000)     return (c / 1_000).toFixed(1) + 'k AC';
            return c + ' AC';
        };

        let petHtml = '';
        if (player.pet) {
            petHtml = `
                <div class="pet-badge" title="${player.pet.name || 'Pet'}">
                    <div class="pet-emoji-lg">${player.pet.emoji || '🐾'}</div>
                    <div class="pet-name-sm">${player.pet.name || 'Pet'}</div>
                    <div class="pet-level-sm">Nv.${player.pet.level || 1}</div>
                </div>`;
        } else {
            petHtml = `
                <div class="pet-badge" style="opacity:0.3" title="Sem Pet">
                    <div class="pet-emoji-lg">🚫</div>
                    <div class="pet-name-sm">Sem Pet</div>
                </div>`;
        }

        const card = document.createElement('div');
        card.className = 'player-card leaderboard-row';
        card.innerHTML = `
            <div class="rank-badge ${rankCls}">${rankLabel}</div>
            <div class="player-main">
                <div class="player-nickname">${escHtml(player.name)}</div>
                <div class="player-meta">
                    <span class="tag tag-class">${escHtml(player.profession || 'Aventureiro')}</span>
                    <span class="tag tag-char">${escHtml(player.char_name || '?')}</span>
                </div>
            </div>
            <div class="player-numbers">
                <div class="num-block">
                    <span class="num-label">Nível</span>
                    <span class="num-val lvl">${player.level || 1}</span>
                </div>
                <div class="num-block">
                    <span class="num-label">Saldo</span>
                    <span class="num-val coin">${formatCoins(player.coins)}</span>
                </div>
            </div>
            ${petHtml}
        `;

        if (player.id) {
            card.addEventListener('click', () => openHeroModal(player.id));
        }

        list.appendChild(card);
    });
}

// ==================== HERO MODAL ====================
async function openHeroModal(discordId) {
    if (!discordId) return;
    const modal = document.getElementById('characterModal');
    if (!modal) return;

    modal.classList.add('show');

    // Reset to loading state
    document.getElementById('modalHeroName').textContent = 'Carregando...';
    document.getElementById('modalHeroVocation').textContent = '—';
    document.getElementById('modalHeroProfession').textContent = '—';
    document.getElementById('modalHeroHp').textContent = '—';
    document.getElementById('modalHeroHpBar').style.width = '0%';
    document.getElementById('modalHeroXp').textContent = '—';
    document.getElementById('modalHeroXpBar').style.width = '0%';
    document.getElementById('modalHeroCoins').textContent = '0';
    document.getElementById('modalHeroWins').textContent = '0';
    document.getElementById('modalHeroLosses').textContent = '0';

    const slots = ['weapon', 'shield', 'armor', 'amulet'];
    slots.forEach(slot => {
        const slotEl = document.getElementById(`equip-${slot}`);
        if (slotEl) {
            slotEl.classList.remove('filled');
            const nameEl = slotEl.querySelector('.slot-name');
            const statsEl = slotEl.querySelector('.slot-stats');
            const iconEl = slotEl.querySelector('.slot-icon');
            if (nameEl) nameEl.textContent = slot === 'weapon' ? 'Arma' : slot === 'shield' ? 'Escudo' : slot === 'armor' ? 'Armadura' : 'Amuleto';
            if (statsEl) statsEl.textContent = 'Nenhum';
            if (iconEl) iconEl.textContent = slot === 'weapon' ? '🗡️' : slot === 'shield' ? '🛡️' : slot === 'armor' ? '👕' : '📿';
        }
    });

    const petContainer = document.getElementById('modalPetContainer');
    if (petContainer) petContainer.innerHTML = '<div class="loading-state">Buscando dados do companheiro...</div>';

    const questsContainer = document.getElementById('modalQuestsContainer');
    if (questsContainer) questsContainer.innerHTML = '<div class="loading-state">Buscando missões da taverna...</div>';

    try {
        const res = await fetch(`/api/player/${discordId}`);
        if (!res.ok) throw new Error('Status ' + res.status);
        const player = await res.json();

        document.getElementById('modalHeroName').textContent = player.name || 'Herói Anônimo';
        document.getElementById('modalHeroVocation').textContent = player.vocation || 'Nenhuma';
        document.getElementById('modalHeroProfession').textContent = player.profession || 'Aventureiro';

        // HP
        const hpVal = player.hp ?? 0;
        const maxHpVal = player.max_hp ?? 100;
        document.getElementById('modalHeroHp').textContent = `${hpVal}/${maxHpVal}`;
        const hpPct = Math.min(100, Math.max(0, Math.floor((hpVal / maxHpVal) * 100)));
        document.getElementById('modalHeroHpBar').style.width = `${hpPct}%`;

        // XP
        const xpVal = player.xp ?? 0;
        const lvlVal = player.level ?? 1;
        const xpNeeded = lvlVal * 100;
        document.getElementById('modalHeroXp').textContent = `Lvl ${lvlVal} (${xpVal}/${xpNeeded} XP)`;
        const xpPct = Math.min(100, Math.max(0, Math.floor((xpVal / xpNeeded) * 100)));
        document.getElementById('modalHeroXpBar').style.width = `${xpPct}%`;

        // Coins & Arena
        document.getElementById('modalHeroCoins').textContent = (player.coins ?? 0).toLocaleString();
        document.getElementById('modalHeroWins').textContent = player.wins ?? 0;
        document.getElementById('modalHeroLosses').textContent = player.losses ?? 0;

        // Avatar
        const avatarEl = document.getElementById('modalHeroAvatar');
        if (avatarEl) {
            let avatarEmoji = '🛡️';
            if (player.vocation) {
                const voc = player.vocation.toLowerCase();
                if (voc.includes('sorc') || voc.includes('mage') || voc.includes('bruxo')) avatarEmoji = '🔮';
                else if (voc.includes('druid') || voc.includes('clérigo') || voc.includes('xamã')) avatarEmoji = '🌿';
                else if (voc.includes('paladin') || voc.includes('archer') || voc.includes('arqueiro')) avatarEmoji = '🏹';
                else if (voc.includes('knight') || voc.includes('warrior') || voc.includes('guerreiro')) avatarEmoji = '🛡️';
            }
            avatarEl.textContent = avatarEmoji;
        }

        // Equipments
        if (player.equipment) {
            slots.forEach(slot => {
                const item = player.equipment[slot];
                const slotEl = document.getElementById(`equip-${slot}`);
                if (slotEl && item) {
                    slotEl.classList.add('filled');
                    const nameEl = slotEl.querySelector('.slot-name');
                    const statsEl = slotEl.querySelector('.slot-stats');
                    const iconEl = slotEl.querySelector('.slot-icon');

                    if (nameEl) nameEl.textContent = item.name || 'Item Equipado';
                    if (statsEl) {
                        const stats = [];
                        if (item.atk) stats.push(`Atk: +${item.atk}`);
                        if (item.def) stats.push(`Def: +${item.def}`);
                        statsEl.textContent = stats.length > 0 ? stats.join(' | ') : 'Sem atributos';
                    }
                    if (iconEl && item.name) {
                        const match = item.name.match(/[\p{Emoji_Presentation}\p{Emoji}\u200d]+/u);
                        if (match) {
                            iconEl.textContent = match[0];
                        }
                    }
                }
            });
        }

        // Pet
        if (petContainer) {
            if (player.pet) {
                const pet = player.pet;
                const rarityCls = pet.rarity || 'common';
                const rarityLabel = {
                    common: 'Comum',
                    uncommon: 'Incomum',
                    rare: 'Raro',
                    epic: 'Épico',
                    legendary: 'Lendário'
                }[rarityCls] || 'Comum';

                petContainer.innerHTML = `
                    <div class="pet-modal-card rarity-${rarityCls}">
                        <div class="pet-modal-icon">${pet.emoji || '🐾'}</div>
                        <div class="pet-modal-info">
                            <h4>${escHtml(pet.name)}</h4>
                            <span class="pet-modal-badge ${rarityCls}">${rarityLabel}</span>
                            <div class="pc-level-text" style="margin-top: 5px;">Nível ${pet.level || 1} / 20</div>
                        </div>
                    </div>
                `;
            } else {
                petContainer.innerHTML = '<div style="color: var(--text-muted); font-style: italic; text-align: center; padding: 1.5rem 0;">Nenhum companheiro ativo</div>';
            }
        }

        // Quests
        if (questsContainer) {
            if (player.quests && player.quests.length > 0) {
                questsContainer.innerHTML = '';
                player.quests.forEach(q => {
                    const completed = q.completed === 1 || q.completed === true;

                    let title = '';
                    let desc = '';
                    let icon = '📜';

                    if (q.quest_type === 'hunt') {
                        title = 'Caça Diária';
                        desc = `Cace monstros com !cacar (${q.reward_ac} AC)`;
                        icon = '⚔️';
                    } else if (q.quest_type === 'duel') {
                        title = 'Duelos de Arena';
                        desc = `Vença duelos de arena com !duelar (${q.reward_ac} AC)`;
                        icon = '🗡️';
                    } else if (q.quest_type === 'tax') {
                        title = 'Taxa Mensal';
                        desc = `Pague a taxa com !taxa enviar (${q.reward_ac} AC)`;
                        icon = '💰';
                    } else {
                        title = 'Missão da Taverna';
                        desc = `Complete a missão (${q.reward_ac} AC)`;
                    }

                    const progressVal = q.progress ?? 0;
                    const statusText = completed ? 'Concluída' : `${progressVal}/${q.goal}`;

                    const questCard = document.createElement('div');
                    questCard.className = `modal-quest-card ${completed ? 'completed' : ''}`;
                    questCard.innerHTML = `
                        <div class="modal-quest-icon">${icon}</div>
                        <div class="modal-quest-details">
                            <h4>${title}</h4>
                            <p>${desc}</p>
                        </div>
                        <div class="modal-quest-status">${statusText}</div>
                    `;
                    questsContainer.appendChild(questCard);
                });
            } else {
                questsContainer.innerHTML = '<div style="color: var(--text-muted); font-style: italic; text-align: center; padding: 1.5rem 0;">Nenhuma missão ativa hoje</div>';
            }
        }
    } catch (err) {
        console.warn('[Profile] Falha ao carregar:', err.message);
        document.getElementById('modalHeroName').textContent = 'Erro ao carregar';
    }
}

// ==================== LIVE EVENTS ====================
async function fetchEvents() {
    try {
        const res = await fetch('/api/events');
        if (!res.ok) throw new Error('Status ' + res.status);
        const data = await res.json();
        renderLiveEvents(data);
    } catch (err) {
        console.warn('[Events] Falha ao carregar:', err.message);
    }
}

function renderLiveEvents(data) {
    const section = document.getElementById('live-events');
    const container = document.getElementById('eventsContainer');
    if (!section || !container) return;

    const activeEvents = [];
    if (data.boss) activeEvents.push({ type: 'boss', ...data.boss });
    if (data.invasion) activeEvents.push({ type: 'invasion', ...data.invasion });

    if (activeEvents.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    container.innerHTML = '';

    activeEvents.forEach(event => {
        const hpPct = Math.min(100, Math.max(0, Math.floor((event.hp / event.maxHp) * 100)));
        const isEnraged = hpPct < 30;

        let title = '';
        let subtitle = '';
        if (event.type === 'boss') {
            title = `👹 INVASÃO DE BOSS: ${escHtml(event.name)}!`;
            subtitle = 'O Senhor dos Demônios espalha o terror! Digite !atacar para desferir golpes!';
        } else {
            title = `⚔️ INVASÃO À CIDADE: ${escHtml(event.name)}!`;
            subtitle = 'Monstros invadiram a cidade! Digite !atacar para defender o reino!';
        }

        let playersHtml = '';
        if (event.players && event.players.length > 0) {
            event.players.forEach((p, idx) => {
                playersHtml += `
                    <div class="event-dmg-item">
                        <span>${idx + 1}. ${escHtml(p.name)}</span>
                        <span>${p.damage.toLocaleString()} dmg</span>
                    </div>`;
            });
        } else {
            playersHtml = `<div class="event-dmg-item" style="font-style: italic; justify-content: center;">Nenhum dano causado ainda.</div>`;
        }

        const card = document.createElement('div');
        card.className = 'event-card';
        card.innerHTML = `
            <div class="event-header">
                <div class="event-title">${title}</div>
                <div class="event-subtitle">${subtitle}</div>
            </div>
            <div class="event-content">
                <div class="event-stats">
                    <div class="event-hp-wrapper">
                        <div class="progress-label">
                            <span>Vida (HP)</span>
                            <span>${event.hp.toLocaleString()} / ${event.maxHp.toLocaleString()} (${hpPct}%)</span>
                        </div>
                        <div class="progress-bar-bg" style="height: 20px;">
                            <div class="progress-bar hp-bar-boss ${isEnraged ? 'enraged' : ''}" style="width: ${hpPct}%"></div>
                        </div>
                    </div>
                </div>
                <div class="event-dmg-list">
                    <h4>🥇 Top 5 Dano</h4>
                    ${playersHtml}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// ==================== RENDER: PET GRID ====================
function renderPetGrid(players) {
    const grid = document.getElementById('petGrid');
    if (!grid) return;

    const withPets = players.filter(p => p.pet);
    if (withPets.length === 0) {
        grid.innerHTML = '<div class="loading-state">Nenhum companheiro equipado entre os jogadores.</div>';
        return;
    }

    grid.innerHTML = '';

    withPets.forEach(player => {
        const pet = player.pet;
        const lvlPct = Math.min(100, ((pet.level || 1) / 20) * 100);
        const rarityCls = 'rarity-' + (pet.rarity || 'common');

        const card = document.createElement('div');
        card.className = 'pet-card';
        card.innerHTML = `
            <div class="pc-emoji">${pet.emoji || '🐾'}</div>
            <div class="pc-name ${rarityCls}">${escHtml(pet.name || 'Pet')}</div>
            <div class="pc-owner">de ${escHtml(player.name)}</div>
            <div class="pc-level-bar">
                <div class="pc-level-fill" style="width: ${lvlPct}%"></div>
            </div>
            <div class="pc-level-text">Nível ${pet.level || 1} / 20</div>
        `;
        grid.appendChild(card);
    });
}

// ==================== UTILS ====================
function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;');
}

function updateTimestamp() {
    const el = document.getElementById('lastUpdate');
    if (el) el.textContent = new Date().toLocaleTimeString('pt-BR');
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    fetchStats();
    fetchRanking();
    fetchEvents();

    setInterval(() => {
        fetchStats();
        fetchRanking();
    }, 30_000);

    setInterval(() => {
        fetchEvents();
    }, 10_000);

    // Modal Close handlers
    const closeModal = document.getElementById('closeModal');
    const modal = document.getElementById('characterModal');
    if (closeModal && modal) {
        closeModal.addEventListener('click', () => {
            modal.classList.remove('show');
        });
        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    }
});
