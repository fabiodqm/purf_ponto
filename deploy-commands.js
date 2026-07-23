require('dotenv').config();

const {
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('ponto')
        .setDescription('Gerencia seu ponto (bate-ponto)')
        .addSubcommand(sub =>
            sub.setName('iniciar').setDescription('Inicia um novo ponto')
        )
        .addSubcommand(sub =>
            sub.setName('finalizar').setDescription('Finaliza o ponto em aberto')
        )
        .toJSON(),

    new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Mostra o histórico de pontos')
        .addUserOption(opt =>
            opt.setName('usuario')
                .setDescription('Usuário para consultar (requer permissão)')
                .setRequired(false)
        )
        .toJSON()
];

const rest = new REST({ version: '10' })
    .setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🔄 Registrando comandos /ponto e /historico...');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        console.log('✅ Comandos registrados com sucesso!');
    } catch (error) {
        console.error(error);
    }
})();
