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
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
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

// Retorna a data (YYYY-MM-DD) no fuso America/Sao_Paulo, para comparar "mesmo dia"
function getDayKey(timestamp) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'America/Sao_Paulo'
    });
    return formatter.format(new Date(timestamp)); // ex: "2026-07-21"
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

// Versão curta usada no /historico (ex: "2h 13min 22s")
function formatDurationShort(ms) {
    let totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0) parts.push(`${minutes}min`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const formatter = new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Sao_Paulo'
    });
    return formatter.format(date);
}

function formatDateOnly(timestamp) {
    const date = new Date(timestamp);
    const formatter = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'America/Sao_Paulo'
    });
    return formatter.format(date);
}

// ====== MODELO DE DADOS ======
// data[userId] = { records: [ { id, dayKey, start, pausas: [{pausa, volta}], end, status } ] }
// status: 'aberto' | 'pausado' | 'finalizado'

function getUserRecords(data, userId) {
    if (!data[userId]) data[userId] = { records: [] };
    if (!Array.isArray(data[userId].records)) data[userId].records = [];
    return data[userId].records;
}

function getActiveRecord(records) {
    return records.find(r => r.status !== 'finalizado') || null;
}

// Soma o tempo total pausado de um registro (contando pausas já fechadas
// e, se ainda estiver pausado, o tempo até "até" — normalmente Date.now() ou o término)
function getPausedMs(record, until) {
    let total = 0;
    for (const p of record.pausas || []) {
        const fim = p.volta ?? until;
        total += Math.max(0, fim - p.pausa);
    }
    return total;
}

function buildReabrirRow(userId, recordId, disabled = false) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`reabrir_${userId}_${recordId}`)
            .setLabel('REABRIR')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled)
    );
    return row;
}

function buildPausarRow(userId, recordId, disabled = false) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`pausar_${userId}_${recordId}`)
            .setLabel('PAUSAR')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled)
    );
    return row;
}

// Reabre um registro pausado (volta) ou finalizado (reabre o dia, se ainda for o mesmo dia)
// Retorna { ok: true, embed, row } ou { ok: false, motivo }
function reabrirRegistro(record, userId) {
    if (record.status === 'pausado') {
        const ultimaPausa = record.pausas[record.pausas.length - 1];
        ultimaPausa.volta = Date.now();
        record.status = 'aberto';

        const embed = new EmbedBuilder()
            .setTitle('📁 Bate-Ponto')
            .setDescription('Ponto retomado. Use o botão PAUSAR ou `/ponto finalizar` quando precisar.')
            .addFields(
                { name: 'Usuário', value: `<@${userId}>` },
                { name: 'Início', value: formatDateTime(record.start) },
                { name: 'Pausa', value: formatDateTime(ultimaPausa.pausa) },
                { name: 'Volta', value: formatDateTime(ultimaPausa.volta) }
            )
            .setFooter({ text: BRAND_FOOTER });

        return { ok: true, embed, disableButton: true };
    }

    if (record.status === 'finalizado') {
        if (getDayKey(record.end) !== getDayKey(Date.now())) {
            return {
                ok: false,
                motivo: '⚠️ Esse ponto foi finalizado em outro dia e não pode mais ser reaberto. Use `/ponto iniciar` para começar um novo registro.'
            };
        }

        record.end = null;
        record.status = 'aberto';

        const embed = new EmbedBuilder()
            .setTitle('📁 Bate-Ponto')
            .setDescription('Este ponto foi reaberto. Use `/ponto finalizar` para encerrá-lo novamente.')
            .addFields(
                { name: 'Usuário', value: `<@${userId}>` },
                { name: 'Início original', value: formatDateTime(record.start) }
            )
            .setFooter({ text: BRAND_FOOTER });

        return { ok: true, embed, disableButton: true };
    }

    return { ok: false, motivo: '⚠️ Esse ponto já está aberto no momento.' };
}

// ====== CLIENTE DISCORD ======
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
    console.log(`✅ ${client.user.tag} está online!`);
});

client.on('interactionCreate', async interaction => {
    try {
        await handleInteraction(interaction);
    } catch (error) {
        console.error('Erro ao processar interação:', error);
        try {
            const payload = {
                content: '⚠️ Ocorreu um erro ao processar esse comando. Tente novamente.',
                flags: MessageFlags.Ephemeral
            };
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(payload);
            } else {
                await interaction.reply(payload);
            }
        } catch (_) { /* interação pode já ter expirado, ignora */ }
    }
});

// Também evita que qualquer erro não tratado derrube o processo no Render
process.on('unhandledRejection', err => console.error('unhandledRejection:', err));
process.on('uncaughtException', err => console.error('uncaughtException:', err));

async function handleInteraction(interaction) {
    // ============ BOTÃO "PAUSAR" ============
    if (interaction.isButton() && interaction.customId.startsWith('pausar_')) {
        const [, donoId, recordId] = interaction.customId.split('_');

        if (interaction.user.id !== donoId) {
            return interaction.reply({
                content: '⚠️ Somente quem bateu esse ponto pode pausá-lo.',
                flags: MessageFlags.Ephemeral
            });
        }

        const data = loadData();
        const records = getUserRecords(data, donoId);
        const record = records.find(r => String(r.id) === recordId);

        if (!record) {
            return interaction.reply({
                content: '⚠️ Registro não encontrado.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (record.status !== 'aberto') {
            return interaction.reply({
                content: `⚠️ Esse ponto não está aberto no momento (status: ${record.status}).`,
                flags: MessageFlags.Ephemeral
            });
        }

        const now = Date.now();
        record.pausas.push({ pausa: now, volta: null });
        record.status = 'pausado';
        saveData(data);

        const embed = new EmbedBuilder()
            .setTitle('📁 Bate-Ponto')
            .setDescription('Use o botão REABRIR para abrir esse ponto novamente')
            .addFields(
                { name: 'Usuário', value: `<@${donoId}>` },
                { name: 'Início', value: formatDateTime(record.start) },
                { name: 'Pausa', value: formatDateTime(now) }
            )
            .setFooter({ text: BRAND_FOOTER });

        await interaction.update({ embeds: [embed], components: [buildReabrirRow(donoId, recordId)] });
        return;
    }

    // ============ BOTÃO "REABRIR" ============
    if (interaction.isButton() && interaction.customId.startsWith('reabrir_')) {
        const [, donoId, recordId] = interaction.customId.split('_');

        if (interaction.user.id !== donoId) {
            return interaction.reply({
                content: '⚠️ Somente quem bateu esse ponto pode reabri-lo.',
                flags: MessageFlags.Ephemeral
            });
        }

        const data = loadData();
        const records = getUserRecords(data, donoId);
        const record = records.find(r => String(r.id) === recordId);

        if (!record) {
            return interaction.reply({
                content: '⚠️ Registro não encontrado.',
                flags: MessageFlags.Ephemeral
            });
        }

        const resultado = reabrirRegistro(record, donoId);

        if (!resultado.ok) {
            // Desabilita o botão permanentemente na mensagem original, já que
            // esse ponto nunca mais poderá ser reaberto (virou o dia).
            try {
                await interaction.message.edit({
                    components: [buildReabrirRow(donoId, recordId, true)]
                });
            } catch (_) { /* ignora falha ao editar */ }

            return interaction.reply({ content: resultado.motivo, flags: MessageFlags.Ephemeral });
        }

        saveData(data);

        await interaction.update({ embeds: [resultado.embed], components: [buildPausarRow(donoId, recordId)] });
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const data = loadData();
    const records = getUserRecords(data, userId);

    // ---------- /ponto (comando único de alternância) ----------
    if (interaction.commandName === 'ponto') {
        const ativo = getActiveRecord(records);

        // Se NÃO houver registro ativo → INICIAR
        if (!ativo) {
            const now = Date.now();
            const novoRegistro = {
                id: `${userId}-${now}`,
                dayKey: getDayKey(now),
                start: now,
                pausas: [],
                end: null,
                status: 'aberto'
            };
            records.push(novoRegistro);
            saveData(data);

            const embed = new EmbedBuilder()
                .setTitle('📁 Bate-Ponto')
                .setDescription('Seu expediente foi iniciado com sucesso.')
                .addFields(
                    { name: 'Usuário', value: `<@${userId}>` },
                    { name: 'Início', value: formatDateTime(now) }
                )
                .setFooter({ text: BRAND_FOOTER });

            return interaction.reply({ embeds: [embed], components: [buildPausarRow(userId, novoRegistro.id)] });
        }

        // Se houver registro ativo → FINALIZAR
        const now = Date.now();

        // Se estava pausado, fecha a última pausa no momento da finalização
        if (ativo.status === 'pausado') {
            const ultimaPausa = ativo.pausas[ativo.pausas.length - 1];
            if (ultimaPausa && ultimaPausa.volta === null) ultimaPausa.volta = now;
        }

        ativo.end = now;
        ativo.status = 'finalizado';
        saveData(data);

        const totalMs = (ativo.end - ativo.start) - getPausedMs(ativo, ativo.end);

        const fields = [
            { name: 'Usuário', value: `<@${userId}>` },
            { name: 'Início', value: formatDateTime(ativo.start) }
        ];

        if (ativo.pausas.length > 0) {
            const ultimaPausa = ativo.pausas[ativo.pausas.length - 1];
            fields.push({ name: 'Pausa', value: formatDateTime(ultimaPausa.pausa) });
            if (ultimaPausa.volta) {
                fields.push({ name: 'Volta', value: formatDateTime(ultimaPausa.volta) });
            }
        }

        fields.push(
            { name: 'Término', value: formatDateTime(ativo.end) },
            { name: 'Tempo total', value: formatDuration(totalMs) }
        );

        const embed = new EmbedBuilder()
            .setTitle('📁 Bate-Ponto')
            .setDescription('Use o botão REABRIR para abrir esse ponto novamente')
            .addFields(...fields)
            .setFooter({ text: BRAND_FOOTER });

        return interaction.reply({ embeds: [embed], components: [buildReabrirRow(userId, ativo.id)] });
    }

    // ---------- /historico ----------
    if (interaction.commandName === 'historico') {
        const alvo = interaction.options.getUser('usuario') || interaction.user;

        if (alvo.id !== userId && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                content: '⚠️ Você não tem permissão para ver o histórico de outro usuário.',
                flags: MessageFlags.Ephemeral
            });
        }

        const alvoRecords = getUserRecords(data, alvo.id)
            .filter(r => r.status === 'finalizado')
            .sort((a, b) => b.start - a.start)
            .slice(0, 10);

        if (alvoRecords.length === 0) {
            return interaction.reply({
                content: `📚 <@${alvo.id}> ainda não tem nenhum ponto finalizado no histórico.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const linhas = alvoRecords.map(r => {
            const totalMs = (r.end - r.start) - getPausedMs(r, r.end);
            let bloco = `📅 **${formatDateOnly(r.start)}**\n⏱️ ${formatDurationShort(totalMs)}\n🟢 Início: ${formatTime(r.start)}`;

            const ultimaPausa = r.pausas[r.pausas.length - 1];
            if (ultimaPausa) {
                bloco += `\n⏸️ Pausa: ${formatTime(ultimaPausa.pausa)}`;
                if (ultimaPausa.volta) bloco += `\n▶️ Retorno: ${formatTime(ultimaPausa.volta)}`;
            }

            bloco += `\n🔴 Término: ${formatTime(r.end)}`;
            return bloco;
        });

        const embed = new EmbedBuilder()
            .setTitle('📚 Histórico de Ponto')
            .setDescription(`👤 <@${alvo.id}>\n\n${linhas.join('\n\n')}`)
            .setFooter({ text: BRAND_FOOTER });

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}

client.login(process.env.DISCORD_TOKEN);
