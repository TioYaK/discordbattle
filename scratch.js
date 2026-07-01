const { Client, GatewayIntentBits } = require('discord.js');
const db = require('../../modules/database');
require('dotenv').config({ path: '../../.env' });
const scheduler = require('../../modules/scheduler');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on('ready', async () => {
    console.log(`Logado como ${client.user.tag}`);
    const botConfig = {
        taxPanelChannelId: db.getConfig('taxPanelChannelId'),
        taxValue: db.getConfig('taxValue'),
        taxPlanilhadoValue: db.getConfig('taxPlanilhadoValue')
    };
    
    console.log('Bot Config:', botConfig);
    
    // We cannot call updateTaxDashboard easily since it's not exported.
    // Let's rewrite the logic here to see what fails.
    
    try {
        const channel = await client.channels.fetch(botConfig.taxPanelChannelId);
        if (!channel?.isTextBased()) {
            console.log('Canal nao é text based ou nao foi encontrado.');
            process.exit(1);
        }
        console.log(`Canal encontrado: ${channel.name}`);
        
        // Let's just try to send a test message
        const sent = await channel.send('Teste de Permissão de Painel');
        console.log(`Mensagem teste enviada: ${sent.id}`);
        
        // Agora fetch members
        const cycleStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
        const paid = db.db.prepare('SELECT * FROM guild_taxes WHERE cycle_start_at = ? AND status = "paid"').all(cycleStart);
        console.log(`Membros pagos: ${paid.length}`);
        
    } catch (e) {
        console.error('Erro:', e);
    }
    
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
