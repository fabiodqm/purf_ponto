require('dotenv').config();

const {
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('ponto')
        .setDescription('Bate seu ponto (inicia ou finaliza automaticamente)')
        .toJSON(),

    new SlashCommandBuilder()
        .setName('reabrir')
        .setDescription('Reabre seu último ponto finalizado')
        .toJSON()
];

const rest = new REST({ version: '10' })
    .setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🔄 Registrando comandos /ponto e /reabrir...');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        console.log('✅ Comandos registrados com sucesso!');
    } catch (error) {
        console.error(error);
    }
})();
