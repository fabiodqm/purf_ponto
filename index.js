require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');

// ====== SERVIDOR HTTP FAKE (só para o Render não derrubar o Web Service) ======
// O Render espera algo escutando na porta process.env.PORT. O bot em si não usa
// HTTP, então isso é só para passar no health check e manter o serviço no ar.
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot online!');
}).listen(PORT, () => {
    console.log(`🌐 Servidor HTTP fake escutando na porta ${PORT}`);
});

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');

// ====== CONFIGURAÇÃO / MARCA ======
// Troque o texto abaixo pelo nome que aparece no rodapé dos embeds.
const BRAND_FOOTER = 'Sistema de Ponto • Versão gratuita';

// ====== ARMAZENAMENTO (arquivo JSON simples) ======
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'pontos.json');

function loadData() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ====== FORMATAÇÃO (pt-BR) ======
function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    const formatter = new Intl.DateTimeFormat('pt-BR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Sao_Paulo'
    });
    const parts = {};
    formatter.formatToParts(date).forEach(p => (parts[p.type] = p.value));
    return `${parts.day} de ${parts.month} de ${parts.year} ${parts.hour}:${parts.minute}`;
}

function formatDuration(ms) {
    let totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hora' : 'horas'}`);
    if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`);
    parts.push(`${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`);
    return parts.join(', ');
}

// ====== CLIENTE DISCORD ======
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
    console.log(`✅ ${client.user.tag} está online!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const data = loadData();

    // ---------- /ponto iniciar | finalizar ----------
    if (interaction.commandName === 'ponto') {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'iniciar') {
            const registro = data[userId];

            if (registro && registro.end === null) {
                return interaction.reply({
                    content: '⚠️ Você já tem um ponto em aberto. Use `/ponto finalizar` para encerrá-lo.',
                    flags: MessageFlags.Ephemeral
                });
            }

            data[userId] = { start: Date.now(), end: null };
            saveData(data);

            const embed = new EmbedBuilder()
                .setTitle('📁 Bate-Ponto')
                .setDescription('Seu expediente foi iniciado com sucesso.')
                .addFields(
                    { name: 'Usuário', value: `<@${userId}>` },
                    { name: 'Início', value: formatDateTime(data[userId].start) }
                )
                .setFooter({ text: BRAND_FOOTER });

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'finalizar') {
            const registro = data[userId];

            if (!registro || registro.end !== null) {
                return interaction.reply({
                    content: '⚠️ Você não tem nenhum ponto em aberto. Use `/ponto iniciar` primeiro.',
                    flags: MessageFlags.Ephemeral
                });
            }

            registro.end = Date.now();
            saveData(data);

            const totalMs = registro.end - registro.start;

            const embed = new EmbedBuilder()
                .setTitle('📁 Bate-Ponto')
                .setDescription('Use o comando `/reabrir` para abrir esse ponto novamente')
                .addFields(
                    { name: 'Usuário', value: `<@${userId}>` },
                    { name: 'Início', value: formatDateTime(registro.start) },
                    { name: 'Término', value: formatDateTime(registro.end) },
                    { name: 'Tempo total', value: formatDuration(totalMs) }
                )
                .setFooter({ text: BRAND_FOOTER });

            return interaction.reply({ embeds: [embed] }); // público, igual ao print
        }
    }

    // ---------- /reabrir ----------
    if (interaction.commandName === 'reabrir') {
        const registro = data[userId];

        if (!registro || registro.end === null) {
            return interaction.reply({
                content: '⚠️ Você não tem nenhum ponto finalizado para reabrir.',
                flags: MessageFlags.Ephemeral
            });
        }

        registro.end = null;
        saveData(data);

        const embed = new EmbedBuilder()
            .setTitle('📁 Bate-Ponto')
            .setDescription('Este ponto foi reaberto. Use `/ponto finalizar` para encerrá-lo novamente.')
            .addFields(
                { name: 'Usuário', value: `<@${userId}>` },
                { name: 'Início original', value: formatDateTime(registro.start) }
            )
            .setFooter({ text: BRAND_FOOTER });

        return interaction.reply({ embeds: [embed] });
    }
});

client.login(process.env.DISCORD_TOKEN);
