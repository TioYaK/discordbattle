'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('❌ BOT_TOKEN não definido no arquivo .env!');
    process.exit(1);
}

// Extract Client ID from Discord Bot Token (First segment of token in Base64)
const tokenParts = token.split('.');
let clientId;
try {
    clientId = Buffer.from(tokenParts[0], 'base64').toString('ascii');
    if (!/^\d+$/.test(clientId)) {
        throw new Error('Formato inválido');
    }
} catch (err) {
    console.error('❌ Erro ao extrair o Client ID do token. Verifique se o seu BOT_TOKEN no .env está correto.');
    process.exit(1);
}

console.log(`🤖 Client ID detectado: ${clientId}`);

const commands = [];
const COMMANDS_DIR = path.join(__dirname, 'commands');

const commandFiles = fs.readdirSync(COMMANDS_DIR).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(COMMANDS_DIR, file);
    try {
        const command = require(filePath);
        if (command.data && typeof command.data.toJSON === 'function') {
            commands.push(command.data.toJSON());
            console.log(`✅ Carregado comando para Slash: ${command.name}`);
        } else {
            console.log(`⚠️ Ignorando comando (sem suporte Slash): ${file}`);
        }
    } catch (err) {
        console.error(`❌ Erro ao carregar o comando ${file}:`, err.message);
    }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log(`🔄 Iniciando deploy de ${commands.length} comandos Slash (Globais)...`);

        // Register commands globally
        const data = await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands }
        );

        console.log(`🎉 Sucesso! ${data.length} comandos Slash registrados com sucesso globalmente!`);
        console.log(`💡 Nota: Pode levar até alguns minutos para o Discord atualizar a lista no seu aplicativo.`);
    } catch (error) {
        console.error('❌ Erro durante o deploy dos comandos:', error);
    }
})();
