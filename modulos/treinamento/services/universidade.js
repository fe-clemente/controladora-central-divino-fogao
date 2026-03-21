'use strict';
const { google } = require('googleapis');

// ─── Config ───────────────────────────────────────────────────────────────────
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const KEY_FILE       = process.env.KEY_FILE;
const ABA_UNIVERSIDADE = 'Tabela dinâmica 10';
const LINHA_INICIO     = 3;   // primeira linha de dados (ignora cabeçalhos)

// ─── Mapeamento real da Tabela Dinâmica 10 ────────────────────────────────────
// A=0  Unidade
// B=1  Formação Nome
// C=2  Curso Nome
// D=3  ABERTO      ← número
// E=4  ANDAMENTO   ← número
// F=5  CONCLUÍDO   ← número
// G=6  Pendente    ← número
// H=7  Total geral ← número
const COL = {
    unidade:   0,
    formacao:  1,
    curso:     2,
    aberto:    3,
    andamento: 4,
    concluido: 5,
    pendente:  6,
    total:     7,
};

function toInt(v) {
    const n = parseInt(String(v || '').replace(/\D/g, ''), 10);
    return isNaN(n) ? 0 : n;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function getAuth() {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return auth;
}

// ─── Leitura da aba ───────────────────────────────────────────────────────────
async function getUniversidadeData() {
    console.log(`  [UNIVERSIDADE] Lendo aba "${ABA_UNIVERSIDADE}"...`);
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ABA_UNIVERSIDADE}'!A${LINHA_INICIO}:I`,
    });

    const rows = res.data.values || [];
    console.log(`  [UNIVERSIDADE] ${rows.length} linhas brutas lidas`);

    const linhas = rows
        .filter(r => {
            const unidade  = String(r[COL.unidade]  || '').trim();
            const formacao = String(r[COL.formacao] || '').trim();
            const curso    = String(r[COL.curso]    || '').trim();
            // ignora linhas completamente vazias
            if (!unidade && !formacao && !curso) return false;
            // ignora linhas de totais geradas pela tabela dinâmica
            if (!curso && (
                unidade.toLowerCase().includes('total') ||
                formacao.toLowerCase().includes('total')
            )) return false;
            return true;
        })
        .map(r => ({
            unidade:   String(r[COL.unidade]  || '').trim(),
            formacao:  String(r[COL.formacao] || '').trim(),
            curso:     String(r[COL.curso]    || '').trim(),
            aberto:    toInt(r[COL.aberto]),
            andamento: toInt(r[COL.andamento]),
            concluido: toInt(r[COL.concluido]),
            pendente:  toInt(r[COL.pendente]),
            total:     toInt(r[COL.total]),
        }));

    console.log(`  [UNIVERSIDADE] ${linhas.length} linhas válidas processadas`);
    return linhas;
}

// ─── Consolidar ───────────────────────────────────────────────────────────────
async function getUniversidadeConsolidado() {
    const linhas = await getUniversidadeData();

    const unidades  = new Set();
    const formacoes = new Set();
    const totais    = { aberto: 0, andamento: 0, concluido: 0, pendente: 0, total: 0 };

    linhas.forEach(l => {
        totais.aberto    += l.aberto;
        totais.andamento += l.andamento;
        totais.concluido += l.concluido;
        totais.pendente  += l.pendente;
        totais.total     += l.total;
        if (l.unidade)  unidades.add(l.unidade);
        if (l.formacao) formacoes.add(l.formacao);
    });

    return {
        sincronizadoEm: new Date().toISOString(),
        totalLinhas:    linhas.length,
        totalUnidades:  unidades.size,
        totalFormacoes: formacoes.size,
        totais,
        linhas,
    };
}

module.exports = { getUniversidadeData, getUniversidadeConsolidado };