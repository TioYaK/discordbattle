'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const db = require('../modules/database');

const SHOP_ITEMS = {
    gold: { name: 'Dourado Legendário', cost: 2000, color: '#FFD700', type: 'color' },
    crimson: { name: 'Vermelho Carmim', cost: 2000, color: '#DC143C', type: 'color' },
    pink: { name: 'Rosa Choque', cost: 1000, color: '#FF69B4', type: 'color' },
    cyan: { name: 'Azul Ciano', cost: 1000, color: '#00FFFF', type: 'color' },
    purple: { name: 'Roxo Místico', cost: 1000, color: '#9B59B6', type: 'color' },
    green: { name: 'Verde Esmeralda', cost: 1000, color: '#2ECC71', type: 'color' },
    booster: { name: 'Spawn Booster', cost: 1500, type: 'item', itemId: 'booster' },
    banner: { name: 'Banner Customizado', cost: 2500, type: 'banner' },
    whatsapp: { name: 'Anúncio no WhatsApp', cost: 2000, type: 'item', itemId: 'whatsapp_ad' },
    tax: { name: 'Isenção de Taxa Mensal', cost: 5000, type: 'tax' },
    dungeon_key: { name: 'Chave da Masmorra 🗝️', cost: 1500, type: 'material', itemId: 'dungeon_key' },
    dungeon_key_1: { name: 'Chave de Cobre (Nv 1) 🗝️', cost: 1000, type: 'material', itemId: 'dungeon_key_1' },
    dungeon_key_2: { name: 'Chave de Prata (Nv 2) 🗝️', cost: 2500, type: 'material', itemId: 'dungeon_key_2' },
    dungeon_key_3: { name: 'Chave de Ouro (Nv 3) 🗝️', cost: 5000, type: 'material', itemId: 'dungeon_key_3' },
    megafone_guilda: { name: 'Megafone da Guilda 📢', cost: 5000, type: 'material', itemId: 'megafone_guilda' },
    fire_sword: { name: 'Fire Sword 🗡️', cost: 700, type: 'item', itemId: 'fire_sword' },
    skull_staff: { name: 'Skull Staff 🪄', cost: 900, type: 'item', itemId: 'skull_staff' },
    dragon_shield: { name: 'Dragon Shield 🛡️', cost: 800, type: 'item', itemId: 'dragon_shield' },
    vampire_shield: { name: 'Vampire Shield 🛡️', cost: 1000, type: 'item', itemId: 'vampire_shield' },
    crown_armor: { name: 'Crown Armor 👕', cost: 1100, type: 'item', itemId: 'crown_armor' },
    golden_armor: { name: 'Golden Armor 👕', cost: 1500, type: 'item', itemId: 'golden_armor' },
    amulet_of_loss: { name: 'Amulet of Loss 📿', cost: 1000, type: 'item', itemId: 'amulet_of_loss' },
    // Virtual Gear
    giant_sword: { name: 'Giant Sword 🗡️', cost: 500, type: 'item', itemId: 'giant_sword' },
    magic_sword: { name: 'Magic Sword (SOV) 🗡️', cost: 1200, type: 'item', itemId: 'magic_sword' },
    stonecutter_axe: { name: 'Stonecutter Axe 🪓', cost: 1300, type: 'item', itemId: 'stonecutter_axe' },
    demon_shield: { name: 'Demon Shield 🛡️', cost: 600, type: 'item', itemId: 'demon_shield' },
    mastermind_shield: { name: 'Mastermind Shield 🛡️', cost: 1200, type: 'item', itemId: 'mastermind_shield' },
    drakonite_armor: { name: 'Drakonite Armor 👕', cost: 800, type: 'item', itemId: 'drakonite_armor' },
    magic_plate_armor: { name: 'Magic Plate Armor (MPA) 👕', cost: 2000, type: 'item', itemId: 'magic_plate_armor' },
    platinum_amulet: { name: 'Platinum Amulet 📿', cost: 400, type: 'item', itemId: 'platinum_amulet' }
};

function getCycleStartMonday() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday.getTime();
}

async function handleLoja(ctx, userId, isSlash = false) {
    const memberRow = db.getRegisteredMember(userId);
    let coins = 0;
    if (memberRow) {
        coins = memberRow.coins || 0;
    }
    const coinsFormatted = (coins % 1 === 0) ? coins.toFixed(0) : coins.toFixed(1);

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6) // Purple
        .setTitle('🏪 Loja da Guilda — Ascended Store')
        .setDescription(
            `Bem-vindo à loja oficial da nossa guilda!\n` +
            `Aqui você pode usar suas **Ascended Coins (AC)** para comprar cores, boosters de spawn, isenções de taxa ou equipamentos de RPG para o minigame!\n\n` +
            `🪙 **Seu Saldo:** **${coinsFormatted} AC**\n\n` +
            `**🎨 Cores Cosméticas (7 dias)**\n` +
            `• 🥇 **Dourado** — \`2000 AC\` | 🔥 **Vermelho** — \`2000 AC\`\n` +
            `• 💖 **Rosa** — \`1000 AC\` | 💎 **Ciano** — \`1000 AC\` | 🔮 **Roxo** — \`1000 AC\`\n\n` +
            `**📜 Itens Especiais**\n` +
            '• 🗝️ **Chave de Masmorra (Nv 1)** — `1000 AC`\n' +
            '• 🗝️ **Chave de Masmorra (Nv 2)** — `2500 AC`\n' +
            '• 🗝️ **Chave de Masmorra (Nv 3)** — `5000 AC`\n\n' +
            `**🛡️ Equipamentos de RPG (Aethelgard)**\n` +
            '• 🗡️ **Fire Sword** — `700 AC` (+18 Atk, +1 Def)\n' +
            '• 🪄 **Skull Staff** — `900 AC` (+22 Atk)\n' +
            '• 🛡️ **Dragon Shield** — `800 AC` (+18 Def)\n' +
            '• 🛡️ **Vampire Shield** — `1000 AC` (+22 Def)\n' +
            '• 👕 **Crown Armor** — `1100 AC` (+2 Atk, +20 Def)\n' +
            '• 👕 **Golden Armor** — `1500 AC` (+3 Atk, +25 Def)\n' +
            '• 📿 **Amulet of Loss** — `1000 AC` (+5 Atk, +10 Def)\n' +
            `• 🗡️ **Giant Sword** — \`500 AC\` (+15 Atk)\n` +
            `• 🗡️ **Magic Sword (SOV)** — \`1200 AC\` (+25 Atk, +5 Def)\n` +
            `• 🪓 **Stonecutter Axe** — \`1300 AC\` (+27 Atk, +3 Def)\n` +
            `• 🛡️ **Demon Shield** — \`600 AC\` (+15 Def)\n` +
            `• 🛡️ **Mastermind Shield** — \`1200 AC\` (+25 Def)\n` +
            `• 👕 **Drakonite Armor** — \`800 AC\` (+5 Atk, +15 Def)\n` +
            `• 👕 **Magic Plate Armor** — \`2000 AC\` (+5 Atk, +30 Def)\n` +
            `• 📿 **Platinum Amulet** — \`400 AC\` (+2 Atk, +5 Def)\n\n` +
            `**✨ Upgrades & Itens Especiais**\n` +
            `• ⏰ **Spawn Booster** — \`1500 AC\` (+60 min de claim)\n` +
            `• 🖼️ **Banner Customizado (30 dias)** — \`2500 AC\`\n` +
            `• 📢 **Anúncio no WhatsApp** — \`2000 AC\`\n` +
            `• 📢 **Megafone da Guilda (!zapall)** — \`5000 AC\`\n` +
            `• 💰 **Isenção de Taxa Mensal** — \`5000 AC\``
        )
        .setFooter({ text: 'Selecione o item desejado no menu abaixo para comprar.' })
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('shop_buy_select')
        .setPlaceholder('Escolha um item para comprar...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Dourado Legendário (2000 AC)')
                .setValue('gold')
                .setEmoji('🥇'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Vermelho Carmim (2000 AC)')
                .setValue('crimson')
                .setEmoji('🔥'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Rosa Choque (1000 AC)')
                .setValue('pink')
                .setEmoji('💖'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Azul Ciano (1000 AC)')
                .setValue('cyan')
                .setEmoji('💎'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Roxo Místico (1000 AC)')
                .setValue('purple')
                .setEmoji('🔮'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Spawn Booster (1500 AC)')
                .setValue('booster')
                .setEmoji('⏰'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Megafone da Guilda (5000 AC)')
                .setValue('megafone_guilda')
                .setEmoji('📢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Isenção de Taxa (5000 AC)')
                .setValue('tax')
                .setEmoji('💰'),
            // RPG Items
            new StringSelectMenuOptionBuilder()
                .setLabel('Chave Cobre Nv1 (1000 AC)')
                .setValue('dungeon_key_1')
                .setEmoji('🗝️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Chave Prata Nv2 (2500 AC)')
                .setValue('dungeon_key_2')
                .setEmoji('🗝️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Chave Ouro Nv3 (5000 AC)')
                .setValue('dungeon_key_3')
                .setEmoji('🗝️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Fire Sword (700 AC)')
                .setDescription('+18 Atk, +1 Def')
                .setValue('fire_sword')
                .setEmoji('🗡️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Skull Staff (900 AC)')
                .setDescription('+22 Atk')
                .setValue('skull_staff')
                .setEmoji('🪄'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Dragon Shield (800 AC)')
                .setDescription('+18 Def')
                .setValue('dragon_shield')
                .setEmoji('🛡️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Vampire Shield (1000 AC)')
                .setDescription('+22 Def')
                .setValue('vampire_shield')
                .setEmoji('🛡️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Crown Armor (1100 AC)')
                .setDescription('+2 Atk, +20 Def')
                .setValue('crown_armor')
                .setEmoji('👕'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Golden Armor (1500 AC)')
                .setDescription('+3 Atk, +25 Def')
                .setValue('golden_armor')
                .setEmoji('👕'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Amulet of Loss (1000 AC)')
                .setDescription('+5 Atk, +10 Def')
                .setValue('amulet_of_loss')
                .setEmoji('📿'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Giant Sword (500 AC)')
                .setDescription('+15 Atk | Arma')
                .setValue('giant_sword')
                .setEmoji('🗡️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Magic Sword (1200 AC)')
                .setDescription('+25 Atk, +5 Def | SOV')
                .setValue('magic_sword')
                .setEmoji('🗡️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Stonecutter Axe (1300 AC)')
                .setDescription('+27 Atk, +3 Def | Machado')
                .setValue('stonecutter_axe')
                .setEmoji('📿'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Demon Shield (600 AC)')
                .setDescription('+15 Def | Escudo')
                .setValue('demon_shield')
                .setEmoji('🛡️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Mastermind Shield (1200 AC)')
                .setDescription('+25 Def | Escudo')
                .setValue('mastermind_shield')
                .setEmoji('🛡️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Drakonite Armor (800 AC)')
                .setDescription('+5 Atk, +15 Def | Armadura')
                .setValue('drakonite_armor')
                .setEmoji('👕'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Magic Plate Armor (2000 AC)')
                .setDescription('+5 Atk, +30 Def | MPA')
                .setValue('magic_plate_armor')
                .setEmoji('👕'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Platinum Amulet (400 AC)')
                .setDescription('+2 Atk, +5 Def | Amuleto')
                .setValue('platinum_amulet')
                .setEmoji('📿')
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const replyData = { embeds: [embed], components: [row] };
    return isSlash ? ctx.editReply(replyData) : ctx.reply(replyData);
}

async function handleShopPurchase(interaction, itemId) {
    const item = SHOP_ITEMS[itemId];
    if (!item) return;

    await interaction.deferReply({ ephemeral: true });

    const memberRow = db.getRegisteredMember(interaction.user.id);
    if (!memberRow) {
        return interaction.editReply({ content: '❌ Você não está registrado no bot. Use o canal de registros primeiro.' }).catch(() => {});
    }

    if (memberRow.coins < item.cost) {
        return interaction.editReply({ content: `❌ Saldo insuficiente! Você precisa de **${item.cost} AC**, mas seu saldo atual é de **${(memberRow.coins || 0).catch(() => {}).toFixed(1)} AC**.` });
    }

    try {
        // Deduct coins
        db.removeCoins(interaction.user.id, item.cost);

        if (item.type === 'color') {
            const roleName = `🎨 ${item.name} Ascended`;
            let role = interaction.guild.roles.cache.find(r => r.name === roleName);

            if (!role) {
                role = await interaction.guild.roles.create({
                    name: roleName,
                    color: item.color,
                    permissions: [],
                    reason: 'Cargo cosmético de cor da guilda'
                });
            }

            // Reposicionar cargo de cor acima do cargo "Registrado" para aplicar a cor do nome corretamente
            const registradoRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'registrado');
            if (registradoRole && role.position <= registradoRole.position) {
                try {
                    await role.setPosition(registradoRole.position + 1);
                } catch (errPos) {
                    console.warn(`[Shop] Não foi possível reposicionar o cargo ${roleName} acima de Registrado:`, errPos.message);
                }
            }

            // Add role to user
            await interaction.member.roles.add(role);

            // Database entries cleanup and insertion
            db.db.prepare('DELETE FROM member_shop_roles WHERE discord_id = ? AND role_id = ?').run(interaction.user.id, role.id);
            db.addShopRole(interaction.user.id, role.id, 7 * 24 * 60 * 60 * 1000);

            return interaction.editReply({
                content: `🎉 **Compra Realizada!** Você comprou a cor **${item.name}** por **${item.cost} AC**.\nO cargo foi aplicado com sucesso e expirará em 7 dias!`
            }).catch(() => {});
        } 
        
        if (item.type === 'material') {
            db.addMaterial(interaction.user.id, item.itemId, 1);
            return interaction.editReply({
                content: `🎉 **Compra Realizada!** Você comprou **${item.name}** por **${item.cost} AC**.\nO item foi guardado em sua mochila de materiais! Use \`!materiais\` para ver.`
            }).catch(() => {});
        }

        if (item.type === 'item') {
            db.addInventoryItem(interaction.user.id, item.itemId, 1);
            return interaction.editReply({
                content: `🎉 **Compra Realizada!** Você comprou **${item.name}** por **${item.cost} AC**.\nO item foi adicionado ao seu inventário! Use \`!inventario\` ou \`/inventario\` para ver.`
            }).catch(() => {});
        }

        if (item.type === 'banner') {
            const now = Date.now();
            let newExpiry = now + 30 * 24 * 60 * 60 * 1000;
            if (memberRow.custom_banner_expires_at && memberRow.custom_banner_expires_at > now) {
                newExpiry = memberRow.custom_banner_expires_at + 30 * 24 * 60 * 60 * 1000;
            }
            db.db.prepare('UPDATE registered_members SET custom_banner_expires_at = ? WHERE discord_id = ?').run(newExpiry, interaction.user.id);
            
            return interaction.editReply({
                content: `🎉 **Compra Realizada!** Você comprou **${item.name} (30 dias).catch(() => {})** por **${item.cost} AC**.\nAgora você pode definir seu banner personalizado usando \`/carteira banner <URL_da_Imagem>\`! Permissão ativa até <t:${Math.floor(newExpiry / 1000)}:F>.`
            });
        }

        if (item.type === 'tax') {
            const cycleStart = getCycleStartMonday();
            const existing = db.db.prepare('SELECT id, status FROM guild_taxes WHERE discord_id = ? AND cycle_start_at = ?').get(interaction.user.id, cycleStart);

            if (existing) {
                if (existing.status === 'paid') {
                    // Revert coin deduction since they already paid
                    db.addCoins(interaction.user.id, item.cost);
                    return interaction.editReply({ content: '❌ Você já pagou ou está isento da taxa neste ciclo!' }).catch(() => {});
                } else {
                    db.db.prepare('UPDATE guild_taxes SET status = "paid", amount = "0 RC (Isento)", proof_url = "Isenção Comprada", verified_by = ?, verified_at = ? WHERE id = ?')
                         .run(interaction.client.user.id, Date.now(), existing.id);
                }
            } else {
                db.db.prepare(`
                    INSERT INTO guild_taxes (discord_id, char_name, cycle_start_at, amount, proof_url, status, verified_by, verified_at, created_at)
                    VALUES (?, ?, ?, '0 RC (Isento)', 'Isenção Comprada', 'paid', ?, ?, ?)
                `).run(interaction.user.id, memberRow.char_name, cycleStart, interaction.client.user.id, Date.now(), Date.now());
            }

            return interaction.editReply({
                content: `🎉 **Compra Realizada!** Você comprou **Isenção de Taxa Mensal** por **${item.cost} AC**.\nSua taxa para o ciclo de <t:${Math.floor(cycleStart / 1000).catch(() => {})}:D> foi marcada como isenta e aprovada!`
            });
        }

    } catch (err) {
        console.error(`[Shop] Erro ao processar compra de ${itemId}:`, err.message);
        return interaction.editReply({ content: `❌ Ocorreu um erro ao processar sua compra: ${err.message}` }).catch(() => {});
    }
}

module.exports = {
    name: 'loja',
    aliases: ['shop', 'store', 'comprar'],
    description: 'Exibe a loja da guilda para comprar cargos cosméticos de cores, boosters, banners e isenções de taxa',
    adminOnly: false,

    data: new SlashCommandBuilder()
        .setName('loja')
        .setDescription('Exibe a loja da guilda para comprar itens, boosters, banners e isenções de taxa'),

    async execute(msg, args, { config }) {
        return handleLoja(msg, msg.author.id, false);
    },

    async executeSlash(interaction, { config }) {
        return handleLoja(interaction, interaction.user.id, true);
    },

    handleShopPurchase
};
