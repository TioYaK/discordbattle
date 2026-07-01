const { AttachmentBuilder } = require('discord.js');

module.exports = {
    name: 'testfile',
    adminOnly: true,
    async execute(msg) {
        console.log('[Testfile Command] execute started');
        try {
            const buffer = Buffer.from('Hello from main bot process!', 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { name: 'test.txt' });
            console.log('[Testfile Command] sending channel.send with attachment...');
            const res = await msg.channel.send({ content: 'Test attachment from main process', files: [attachment] });
            console.log('[Testfile Command] sent successfully! ID:', res.id);
        } catch (err) {
            console.error('[Testfile Command] error:', err.message, err.stack);
        }
    }
};
