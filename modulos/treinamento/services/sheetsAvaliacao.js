'use strict';

// ─── services/sheetsAvaliacao.js ─────────────────────────────────────────────
// Serviço de acesso à planilha de avaliações de treinamento.
// Planilha: https://docs.google.com/spreadsheets/d/1m2C0V1vYZ99prMs7g7CCaUOwWRah_7Sv0YtJoGLO-gw
// Aba:      "Respostas ao formulário 1"
// Padrão:   espelho de sheets.js — mesma estrutura, mesma autenticação.
// ─────────────────────────────────────────────────────────────────────────────

const { google } = require('googleapis');

// ── Configuração ──────────────────────────────────────────────────────────────
const SPREADSHEET_ID = '1m2C0V1vYZ99prMs7g7CCaUOwWRah_7Sv0YtJoGLO-gw';
const KEY_FILE       = process.env.GOOGLE_KEY_FILE;
const ABA            = 'Respostas ao formulário 1';

// ── Mapeamento de colunas (A=0 … AB=27) ──────────────────────────────────────
// A  0  dataHora               — Data e horário (preenchido automaticamente pelo Forms)
// B  1  avaliador              — Nome de quem avaliou o(a) colaborador(a)
// C  2  treinadorFuncao        — Nome e função de quem treinou o(a) colaborador(a)
// D  3  unidade                — Unidade onde foi realizado o treinamento
// E  4  colaborador            — Nome do(a) Colaborador(a) AVALIADO
// F  5  funcaoColab            — Qual função do(a) colaborador(a)?
// G  6  lojaTreinada           — Nome da loja TREINADA
// H  7  inicioTrein            — Data início do treinamento
// I  8  fimTrein               — Data fim do treinamento
// J  9  refeicoes              — Quantas refeições foram realizadas?
// K  10 bebidas                — Consumo de bebidas?
// L  11 compreensao            — Compreensão do Treinamento
// M  12 habilidadesTec         — Habilidades Técnicas
// N  13 atitudes               — Atitudes e Comportamento
// O  14 resolucaoProb          — Capacidade de Resolução de Problemas
// P  15 trabalhoEquipe         — Trabalho em Equipe
// Q  16 adesaoPadroes          — Adesão aos Padrões e Procedimentos da Franqueadora
// R  17 feedbackMelhoria       — Feedback e Melhoria Contínua
// S  18 confiancaAutonomia     — Confiança e Autonomia
// T  19 destaque               — Destaque importante
// U  20 comportamento          — Avalie o comportamento do colaborador
// V  21 entendimentoConteudo   — Como avalia o entendimento do colaborador?
// W  22 prontidaoFuncao        — Como avalia que está pronto para desempenhar a função?
// X  23 multiplicador          — Em escala de 0 a 10, será multiplicador?
// Y  24 fotoTecnica            — Habilidades Técnicas: envio de foto
// Z  25 aprovado               — Para finalizar, considera que o colaborador está aprovado?
// AA 26 checkpointLoja         — Check-point loja treinadora
// AB 27 inseridoSistema        — Inserido pelo sistema

const CAMPOS = {
    dataHora:             { col: 0,  letra: 'A' },
    avaliador:            { col: 1,  letra: 'B' },
    treinadorFuncao:      { col: 2,  letra: 'C' },
    unidade:              { col: 3,  letra: 'D' },
    colaborador:          { col: 4,  letra: 'E' },
    funcaoColab:          { col: 5,  letra: 'F' },
    lojaTreinada:         { col: 6,  letra: 'G' },
    inicioTrein:          { col: 7,  letra: 'H' },
    fimTrein:             { col: 8,  letra: 'I' },
    refeicoes:            { col: 9,  letra: 'J' },
    bebidas:              { col: 10, letra: 'K' },
    compreensao:          { col: 11, letra: 'L' },
    habilidadesTec:       { col: 12, letra: 'M' },
    atitudes:             { col: 13, letra: 'N' },
    resolucaoProb:        { col: 14, letra: 'O' },
    trabalhoEquipe:       { col: 15, letra: 'P' },
    adesaoPadroes:        { col: 16, letra: 'Q' },
    feedbackMelhoria:     { col: 17, letra: 'R' },
    confiancaAutonomia:   { col: 18, letra: 'S' },
    destaque:             { col: 19, letra: 'T' },
    comportamento:        { col: 20, letra: 'U' },
    entendimentoConteudo: { col: 21, letra: 'V' },
    prontidaoFuncao:      { col: 22, letra: 'W' },
    multiplicador:        { col: 23, letra: 'X' },
    fotoTecnica:          { col: 24, letra: 'Y' },
    aprovado:             { col: 25, letra: 'Z' },
    checkpointLoja:       { col: 26, letra: 'AA' },
    inseridoSistema:      { col: 27, letra: 'AB' },
};

// Linha 1 = cabeçalho → dados a partir da linha 2
// rowIndex 0-based  →  linha real = rowIndex + 2
const HEADER_OFFSET = 2;
const TOTAL_COLUNAS = 28; // A → AB

// ── Auth (mesmo padrão do sheets.js) ─────────────────────────────────────────
async function getAuth() {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return auth;
}

// ── Helper: índice 0-based → letra(s) de coluna ──────────────────────────────
function colLetra(index) {
    let letter = '';
    let n = index;
    while (n >= 0) {
        letter = String.fromCharCode((n % 26) + 65) + letter;
        n = Math.floor(n / 26) - 1;
    }
    return letter;
}

// ── Mapeia linha bruta → objeto nomeado ──────────────────────────────────────
function montarAvaliacao(row, rowIndex) {
    return {
        rowIndex,
        linhaReal:            rowIndex + HEADER_OFFSET,
        dataHora:             row[0]  || '',
        avaliador:            row[1]  || '',
        treinadorFuncao:      row[2]  || '',
        unidade:              row[3]  || '',
        colaborador:          row[4]  || '',
        funcaoColab:          row[5]  || '',
        lojaTreinada:         row[6]  || '',
        inicioTrein:          row[7]  || '',
        fimTrein:             row[8]  || '',
        refeicoes:            row[9]  || '',
        bebidas:              row[10] || '',
        compreensao:          row[11] || '',
        habilidadesTec:       row[12] || '',
        atitudes:             row[13] || '',
        resolucaoProb:        row[14] || '',
        trabalhoEquipe:       row[15] || '',
        adesaoPadroes:        row[16] || '',
        feedbackMelhoria:     row[17] || '',
        confiancaAutonomia:   row[18] || '',
        destaque:             row[19] || '',
        comportamento:        row[20] || '',
        entendimentoConteudo: row[21] || '',
        prontidaoFuncao:      row[22] || '',
        multiplicador:        row[23] || '',
        fotoTecnica:          row[24] || '',
        aprovado:             row[25] || '',
        checkpointLoja:       row[26] || '',
        inseridoSistema:      row[27] || '',
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEITURA
// ═══════════════════════════════════════════════════════════════════════════════

// ── getAvaliacoesData() — retorna todas as linhas brutas ──────────────────────
async function getAvaliacoesData() {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range:         `'${ABA}'!A2:AB`, // pula linha 1 (cabeçalho)
    });

    return resp.data.values || [];
}

// ── getRows() — retorna objetos nomeados (espelho de sheets.getRows) ──────────
async function getRows() {
    const rows = await getAvaliacoesData();
    return rows
        .map((row, idx) => montarAvaliacao(row, idx))
        .filter(a => a.colaborador || a.avaliador);
}

// ── getAvaliacaoPorRowIndex() — busca avaliação individual ────────────────────
async function getAvaliacaoPorRowIndex(rowIndex) {
    const rows = await getAvaliacoesData();
    const row  = rows[rowIndex];
    if (!row) return null;
    return montarAvaliacao(row, rowIndex);
}

// ── buscarAvaliacoes() — busca filtrada ───────────────────────────────────────
async function buscarAvaliacoes({ q, loja, colaborador, aprovado, mes, ano } = {}) {
    const rows = await getRows();
    let res    = rows;

    if (q) {
        const t = q.toLowerCase().trim();
        res = res.filter(a =>
            (a.colaborador     && a.colaborador.toLowerCase().includes(t))     ||
            (a.avaliador       && a.avaliador.toLowerCase().includes(t))       ||
            (a.lojaTreinada    && a.lojaTreinada.toLowerCase().includes(t))    ||
            (a.funcaoColab     && a.funcaoColab.toLowerCase().includes(t))     ||
            (a.unidade         && a.unidade.toLowerCase().includes(t))         ||
            (a.treinadorFuncao && a.treinadorFuncao.toLowerCase().includes(t))
        );
    }
    if (loja)        res = res.filter(a => a.lojaTreinada === loja);
    if (colaborador) res = res.filter(a => a.colaborador.toLowerCase().includes(colaborador.toLowerCase()));
    if (aprovado)    res = res.filter(a => a.aprovado.toUpperCase() === aprovado.toUpperCase());
    if (mes)         res = res.filter(a => {
        const p = (a.fimTrein || a.inicioTrein || '').split('/');
        return p.length === 3 && parseInt(p[1]) === parseInt(mes);
    });
    if (ano)         res = res.filter(a => {
        const p = (a.fimTrein || a.inicioTrein || '').split('/');
        return p.length === 3 && p[2] === String(ano);
    });

    return res;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESCRITA
// ═══════════════════════════════════════════════════════════════════════════════

// ── atualizarCelula() — atualiza um campo pelo nome (espelho de sheets.js) ────
async function atualizarCelula(rowIndex, campo, valor) {
    const campoMeta = CAMPOS[campo];
    if (!campoMeta) {
        throw new Error(`[sheetsAvaliacao] Campo desconhecido: "${campo}". Verifique CAMPOS.`);
    }

    const linhaReal = parseInt(rowIndex, 10) + HEADER_OFFSET;
    const range     = `'${ABA}'!${campoMeta.letra}${linhaReal}`;

    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.update({
        spreadsheetId:    SPREADSHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody:      { values: [[valor]] },
    });

    console.log(`[sheetsAvaliacao] atualizarCelula → ${range} = "${valor}"`);
}

// ── editarAvaliacao() — atualiza múltiplos campos de uma vez (batchUpdate) ────
// alteracoes = { nomeDoCampo: valor }  ex: { "aprovado": "SIM", "multiplicador": "9" }
// Aceita nome de campo ou índice numérico (como o buscaAvaliacoes.js faz)
async function editarAvaliacao(rowIndex, alteracoes) {
    if (!alteracoes || !Object.keys(alteracoes).length) {
        throw new Error('[sheetsAvaliacao] alteracoes não pode ser vazio');
    }

    const linhaReal = parseInt(rowIndex, 10) + HEADER_OFFSET;
    const data      = [];

    for (const [chave, valor] of Object.entries(alteracoes)) {
        let letra;

        // Aceita nome de campo ("aprovado") ou índice numérico ("25")
        const comoNum = parseInt(chave, 10);
        if (!isNaN(comoNum) && String(comoNum) === String(chave)) {
            letra = colLetra(comoNum);
        } else {
            const meta = CAMPOS[chave];
            if (!meta) {
                console.warn(`[sheetsAvaliacao/editar] Campo desconhecido ignorado: "${chave}"`);
                continue;
            }
            letra = meta.letra;
        }

        data.push({
            range:  `'${ABA}'!${letra}${linhaReal}`,
            values: [[valor]],
        });
    }

    if (!data.length) throw new Error('[sheetsAvaliacao] Nenhum campo válido para atualizar');

    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data,
        },
    });

    console.log(`[sheetsAvaliacao] ✏️ rowIndex=${rowIndex} → linha ${linhaReal} — ${data.length} campo(s): ${data.map(d => d.range).join(', ')}`);
}

// ── excluirAvaliacao() — limpa a linha inteira ────────────────────────────────
async function excluirAvaliacao(rowIndex) {
    const linhaReal = parseInt(rowIndex, 10) + HEADER_OFFSET;
    const range     = `'${ABA}'!${colLetra(0)}${linhaReal}:${colLetra(TOTAL_COLUNAS - 1)}${linhaReal}`;

    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range,
    });

    console.log(`[sheetsAvaliacao] 🗑️ rowIndex=${rowIndex} → linha ${linhaReal} apagada (${range})`);
    return { linhaReal, range };
}

// ── marcarInseridoSistema() — marca coluna AB com data/hora ──────────────────
async function marcarInseridoSistema(rowIndex) {
    const dataHora = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
    await atualizarCelula(rowIndex, 'inseridoSistema', `Inserido em ${dataHora}`);
    console.log(`[sheetsAvaliacao] ✅ AB${rowIndex + HEADER_OFFSET} = Inserido pelo sistema`);
}

// ── marcarCheckpoint() — atualiza coluna AA ───────────────────────────────────
async function marcarCheckpoint(rowIndex, valor) {
    await atualizarCelula(rowIndex, 'checkpointLoja', valor || 'SIM');
    console.log(`[sheetsAvaliacao] ✅ AA${rowIndex + HEADER_OFFSET} = Checkpoint`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD / KPI
// ═══════════════════════════════════════════════════════════════════════════════

// ── getDashboardData() — resumo geral ─────────────────────────────────────────
async function getDashboardData() {
    const rows = await getRows();

    const lojas   = {};
    const funcoes = {};
    let   total = 0, aprovados = 0, reprovados = 0;
    const somaMulti = [];

    rows.forEach(a => {
        total++;

        const loja   = a.lojaTreinada || 'Sem loja';
        const funcao = a.funcaoColab  || 'Sem função';
        lojas[loja]     = (lojas[loja]    || 0) + 1;
        funcoes[funcao] = (funcoes[funcao] || 0) + 1;

        const aprov = a.aprovado.toUpperCase().trim();
        if (aprov === 'SIM' || aprov === 'YES' || aprov === 'APROVADO') aprovados++;
        else if (aprov) reprovados++;

        const multi = parseFloat(a.multiplicador);
        if (!isNaN(multi)) somaMulti.push(multi);
    });

    const mediaMulti = somaMulti.length
        ? +(somaMulti.reduce((s, n) => s + n, 0) / somaMulti.length).toFixed(1)
        : null;

    const topLojas = Object.entries(lojas)
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([nome, count]) => ({ nome, count }));

    const topFuncoes = Object.entries(funcoes)
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([nome, count]) => ({ nome, count }));

    return {
        total,
        aprovados,
        reprovados,
        pendentes:   total - aprovados - reprovados,
        mediaMulti,
        topLojas,
        topFuncoes,
    };
}

// ── getKpiAvaliacoes() — KPI detalhado por mês/ano ───────────────────────────
async function getKpiAvaliacoes(ano, mes) {
    const rows = await getRows();
    ano = String(ano || new Date().getFullYear());

    const MESES_NOMES = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

    // Filtra por ano (baseado no fimTrein ou dataHora)
    const filtrado = rows.filter(a => {
        const ref = a.fimTrein || a.inicioTrein || a.dataHora || '';
        const p   = ref.split('/');
        if (p.length === 3) return p[2] === ano;
        // Suporte a formato ISO (dataHora do Forms: "DD/MM/YYYY HH:mm:ss" ou similar)
        const m = ref.match(/(\d{4})/);
        return m && m[1] === ano;
    });

    const mesFiltrado = mes
        ? filtrado.filter(a => {
            const p = (a.fimTrein || a.inicioTrein || '').split('/');
            return p.length === 3 && parseInt(p[1]) === parseInt(mes);
          })
        : filtrado;

    const total       = mesFiltrado.length;
    const aprovados   = mesFiltrado.filter(a => /^(sim|yes|aprovado)$/i.test(a.aprovado.trim())).length;
    const reprovados  = mesFiltrado.filter(a => a.aprovado.trim() && !/^(sim|yes|aprovado)$/i.test(a.aprovado.trim())).length;
    const checkpoints = mesFiltrado.filter(a => a.checkpointLoja && a.checkpointLoja.trim()).length;

    const camposNota = [
        'compreensao','habilidadesTec','atitudes','resolucaoProb',
        'trabalhoEquipe','adesaoPadroes','feedbackMelhoria','confiancaAutonomia',
        'multiplicador',
    ];

    // Médias por critério
    const medias = {};
    camposNota.forEach(campo => {
        const vals = mesFiltrado
            .map(a => parseFloat(a[campo]))
            .filter(n => !isNaN(n));
        medias[campo] = vals.length
            ? +(vals.reduce((s, n) => s + n, 0) / vals.length).toFixed(1)
            : null;
    });

    // Por loja
    const porLojaMap = {};
    mesFiltrado.forEach(a => {
        const loja = a.lojaTreinada || 'Não informado';
        if (!porLojaMap[loja]) porLojaMap[loja] = { loja, total: 0, aprovados: 0, somaMulti: 0, qtMulti: 0 };
        porLojaMap[loja].total++;
        if (/^(sim|yes|aprovado)$/i.test(a.aprovado.trim())) porLojaMap[loja].aprovados++;
        const multi = parseFloat(a.multiplicador);
        if (!isNaN(multi)) { porLojaMap[loja].somaMulti += multi; porLojaMap[loja].qtMulti++; }
    });
    const porLoja = Object.values(porLojaMap).map(l => ({
        ...l,
        mediaMulti:   l.qtMulti > 0 ? +(l.somaMulti / l.qtMulti).toFixed(1) : null,
        pctAprovados: l.total   > 0 ? +((l.aprovados / l.total) * 100).toFixed(0) : 0,
    })).sort((a, b) => b.total - a.total);

    // Por mês
    const porMesMap = {};
    for (let i = 1; i <= 12; i++) porMesMap[i] = {
        ordem: i, mes: MESES_NOMES[i], total: 0,
        aprovados: 0, reprovados: 0, somaMulti: 0, qtMulti: 0,
    };
    filtrado.forEach(a => {
        const p = (a.fimTrein || a.inicioTrein || '').split('/');
        if (p.length !== 3) return;
        const m = parseInt(p[1]);
        if (m < 1 || m > 12) return;
        porMesMap[m].total++;
        if (/^(sim|yes|aprovado)$/i.test(a.aprovado.trim())) porMesMap[m].aprovados++;
        else if (a.aprovado.trim()) porMesMap[m].reprovados++;
        const multi = parseFloat(a.multiplicador);
        if (!isNaN(multi)) { porMesMap[m].somaMulti += multi; porMesMap[m].qtMulti++; }
    });
    const porMes = Object.values(porMesMap)
        .filter(m => m.total > 0)
        .map(m => ({
            ...m,
            mediaMulti: m.qtMulti > 0 ? +(m.somaMulti / m.qtMulti).toFixed(1) : null,
        }));

    return {
        ano,
        mes: mes || null,
        total,
        resumo: {
            total, aprovados, reprovados,
            pendentes:  total - aprovados - reprovados,
            checkpoints,
            pctAprovados: total > 0 ? +((aprovados / total) * 100).toFixed(1) : 0,
        },
        medias,
        porLoja,
        porMes,
        registros: mesFiltrado,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS — espelho de sheets.js
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = {
    // Leitura
    getAvaliacoesData,
    getRows,
    getAvaliacaoPorRowIndex,
    buscarAvaliacoes,

    // Escrita
    atualizarCelula,
    editarAvaliacao,
    excluirAvaliacao,
    marcarInseridoSistema,
    marcarCheckpoint,

    // Dashboard / KPI
    getDashboardData,
    getKpiAvaliacoes,

    // Constantes úteis para outros serviços
    CAMPOS,
    SPREADSHEET_ID,
    ABA,
    HEADER_OFFSET,
};