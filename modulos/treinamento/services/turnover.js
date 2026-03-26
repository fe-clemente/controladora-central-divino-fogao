/* ═══════════════════════════════════════════════════════════════════════
   turnover.js — Leitura e escrita de dados de Turnover
   Planilha: aba "Controle TurnOver" (dados a partir da linha 9)

   MAPEAMENTO — Controle TurnOver:
     A  = 0   Nº (auto-incremento)
     B  = 1   Nome completo
     F  = 5   Função
     N  = 13  Telefone
     O  = 14  Início treinamento
     P  = 15  Fim treinamento
     S  = 18  Loja do treinamento
     X  = 23  Modelo treinamento
     Y  = 24  Email avaliação enviado (SIM/NÃO)
     AE = 30  Mês treinamento (numeral)
     AF = 31  Continua na empresa (SIM/NÃO — vazio = SIM)
     AG = 32  Continua no mesmo cargo (SIM/NÃO — vazio = SIM)
     AH = 33  Motivo desligamento
     AJ = 35  Mês (numeral)
     AK = 36  Ano

   Importação automática da Cadastral 2026 ao cadastrar:
     Campos copiados: loja, nome, função, telefone,
     início trein, fim trein, modelo, email avaliação
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

const { google } = require('googleapis');

const SPREADSHEET_ID  = process.env.SPREADSHEET_ID;
const KEY_FILE        = process.env.GOOGLE_KEY_FILE;
const ABA_TURNOVER    = 'Controle TurnOver';
const ABA_CADASTRAL   = 'Cadastral 2026';
const LINHA_INICIO    = 9; // dados começam na linha 9

async function getAuth() {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return auth;
}

// ─── Helper: converte índice 0-based → linha real ────────────────────────────
function linhaReal(idx) {
    return idx + LINHA_INICIO;
}

// ─── Helper: parse de data ───────────────────────────────────────────────────
function parseD(v) {
    if (!v) return null;
    const m1 = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m1) return new Date(+m1[3], +m1[2] - 1, +m1[1]);
    const m2 = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3]);
    return null;
}

// ─── Helper: normaliza SIM/NÃO com fallback ──────────────────────────────────
function simNao(val, fallback = 'SIM') {
    const v = String(val || '').trim().toUpperCase();
    if (v === 'SIM' || v === 'S') return 'SIM';
    if (v === 'NÃO' || v === 'NAO' || v === 'N') return 'NÃO';
    return fallback; // vazio = fallback
}

// ─── LEITURA — aba Controle TurnOver ────────────────────────────────────────
async function getTurnoverRows() {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const res    = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_TURNOVER}'!A${LINHA_INICIO}:AK`,
    });
    return res.data.values || [];
}

// ─── getTurnoverRegistros() — lista completa para a tabela ──────────────────
async function getTurnoverRegistros(ano) {
    const rows = await getTurnoverRows();

    const registros = rows
        .filter(r => r && r[1]) // precisa ter nome
        .map((r, i) => {
            const continua   = simNao(r[31]);        // AF
            const mesmoCargo = simNao(r[32]);        // AG
            const motivo     = (r[33] || '').trim(); // AH
            const anoReg     = (r[36] || '').trim(); // AK
            const mesReg     = (r[35] || '').trim(); // AJ

            return {
                rowIndex:     i,                     // 0-based
                linhaReal:    linhaReal(i),
                num:          r[0]  || '',
                nome:         r[1]  || '',
                funcao:       r[5]  || '',
                telefone:     r[13] || '',
                inicioTrein:  r[14] || '',
                fimTrein:     r[15] || '',
                loja:         r[18] || '',
                modelo:       r[23] || '',
                emailAval:    r[24] || '',
                mesTrein:     r[30] || '',           // AE
                continua,                            // AF (vazio = SIM)
                mesmoCargo,                          // AG (vazio = SIM)
                motivo,                              // AH
                mes:          mesReg,                // AJ
                ano:          anoReg,                // AK
                ativo:        continua === 'SIM',
            };
        });

    // Filtro por ano se informado
    const filtrado = ano
        ? registros.filter(r => String(r.ano) === String(ano))
        : registros;

    return { registros: filtrado };
}

// ─── getTurnoverCadastral(ano) — dados consolidados para dashboard ───────────
async function getTurnoverCadastral(ano) {
    const rows = await getTurnoverRows();
    const anoFiltro = ano ? String(ano) : null;

    const todos = rows.filter(r => r && r[1]);

    // Ativos: AF vazia ou SIM
    const ativos     = todos.filter(r => simNao(r[31]) === 'SIM');
    const desligados = todos.filter(r => simNao(r[31]) === 'NÃO');

    // Filtro por ano (coluna AK)
    const desligAno = anoFiltro
        ? desligados.filter(r => String(r[36] || '').trim() === anoFiltro)
        : desligados;

    const cadastradosAno = anoFiltro
        ? todos.filter(r => String(r[36] || '').trim() === anoFiltro)
        : todos;

    const totalGeral  = todos.length;
    const pctTurnover = totalGeral > 0
        ? +((desligAno.length / totalGeral) * 100).toFixed(1)
        : 0;

    // Motivos
    const motivosMap = {};
    desligAno.forEach(r => {
        const mot = (r[33] || '').trim() || 'Não informado';
        motivosMap[mot] = (motivosMap[mot] || 0) + 1;
    });
    const motivos = Object.entries(motivosMap)
        .sort(([, a], [, b]) => b - a)
        .map(([motivo, qtd]) => ({ motivo, qtd }));

    // Por loja (coluna S = índice 18)
    const lojaMap = {};
    todos.forEach(r => {
        const loja = (r[18] || '—').trim();
        if (!lojaMap[loja]) lojaMap[loja] = { total: 0, desligados: 0 };
        lojaMap[loja].total++;
    });
    desligAno.forEach(r => {
        const loja = (r[18] || '—').trim();
        if (!lojaMap[loja]) lojaMap[loja] = { total: 0, desligados: 0 };
        lojaMap[loja].desligados++;
    });
    const porLoja = Object.entries(lojaMap)
        .filter(([, v]) => v.desligados > 0)
        .map(([loja, v]) => ({
            loja,
            total:      v.total,
            desligados: v.desligados,
            pct:        +((v.desligados / v.total) * 100).toFixed(1),
        }))
        .sort((a, b) => b.pct - a.pct);

    // Por mês (coluna AJ = índice 35)
    const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                   'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const mesMap = {};
    desligAno.forEach(r => {
        const m = parseInt(r[35] || '0');
        if (!m || m < 1 || m > 12) return;
        if (!mesMap[m]) mesMap[m] = { mes: MESES[m], ordem: m, desligados: 0 };
        mesMap[m].desligados++;
    });
    const porMes = Object.values(mesMap).sort((a, b) => a.ordem - b.ordem);

    // Anos disponíveis (coluna AK = índice 36)
    const anosSet = new Set();
    todos.forEach(r => {
        const a = String(r[36] || '').trim();
        if (a && !isNaN(+a)) anosSet.add(+a);
    });
    // Garante anos padrão sempre presentes
    [2024, 2025, 2026].forEach(a => anosSet.add(a));
    const anos = [...anosSet].sort();

    return {
        ano:             anoFiltro || 'todos',
        totalGeral,
        totalAtivos:     ativos.length,
        totalDesligados: desligados.length,
        desligadosAno:   desligAno.length,
        cadastradosAno:  cadastradosAno.length,
        pctTurnover,
        motivos,
        porLoja,
        porMes,
        anos,
    };
}

// ─── gravarDesligamento(rowIndex, continua, mesmoCargo, motivo) ──────────────
// rowIndex: 0-based
// Grava AF (continua), AG (mesmoCargo), AH (motivo)
async function gravarDesligamento(rowIndex, continua, mesmoCargo, motivo) {
    const auth    = await getAuth();
    const sheets  = google.sheets({ version: 'v4', auth });
    const linha   = linhaReal(rowIndex);

    await sheets.spreadsheets.values.update({
        spreadsheetId:    SPREADSHEET_ID,
        range:            `'${ABA_TURNOVER}'!AF${linha}:AH${linha}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[
                continua   || '',
                mesmoCargo || '',
                motivo     || '',
            ]],
        },
    });

    console.log(`[turnover] gravarDesligamento → linha ${linha} AF=${continua} AG=${mesmoCargo} AH=${motivo}`);
}

// ─── importarDaCadastral(dadosCadastral) ─────────────────────────────────────
// Chamado automaticamente ao cadastrar na Cadastral 2026.
// Insere uma nova linha na aba Controle TurnOver com os dados básicos.
// dadosCadastral: objeto com campos da Cadastral 2026
async function importarDaCadastral(dados) {
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Busca o próximo número sequencial
    const rows  = await getTurnoverRows();
    const nums  = rows.map(r => parseInt(r[0] || '0')).filter(n => !isNaN(n));
    const proximo = nums.length ? Math.max(...nums) + 1 : 1;

    // Monta linha com 37 colunas (A até AK)
    const row = new Array(37).fill('');

    row[0]  = proximo;                    // A  — Nº
    row[1]  = dados.nome        || '';    // B  — Nome completo
    row[5]  = dados.funcao      || '';    // F  — Função
    row[13] = dados.telefone    || '';    // N  — Telefone
    row[14] = dados.inicioTrein || '';    // O  — Início treinamento
    row[15] = dados.fimTrein    || '';    // P  — Fim treinamento
    row[18] = dados.loja        || '';    // S  — Loja do treinamento
    row[23] = dados.modelo      || '';    // X  — Modelo treinamento
    row[24] = dados.emailAvaliacao || ''; // Y  — Email avaliação enviado
    row[30] = dados.mes         || '';    // AE — Mês treinamento (numeral)
    // AF, AG, AH deixa vazio (= SIM por padrão)
    row[35] = dados.mes         || '';    // AJ — Mês
    row[36] = dados.ano         || String(new Date().getFullYear()); // AK — Ano

    await sheets.spreadsheets.values.append({
        spreadsheetId:    SPREADSHEET_ID,
        range:            `'${ABA_TURNOVER}'!A${LINHA_INICIO}:AK`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody:      { values: [row] },
    });

    console.log(`[turnover] importarDaCadastral → ${dados.nome} importado para Controle TurnOver`);
    return { sucesso: true, numero: proximo };
}

// ─── getResumoTurnover() — para barra de status ──────────────────────────────
async function getResumoTurnover() {
    const anoAtual = String(new Date().getFullYear());
    const d = await getTurnoverCadastral(anoAtual);
    return {
        ano:           d.ano,
        pctTurnover:   d.pctTurnover,
        totalAtivos:   d.totalAtivos,
        desligadosAno: d.desligadosAno,
        totalGeral:    d.totalGeral,
    };
}

module.exports = {
    getTurnoverCadastral,
    getTurnoverRegistros,
    gravarDesligamento,
    importarDaCadastral,
    getResumoTurnover,
};