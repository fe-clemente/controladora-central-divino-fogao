/* ═══════════════════════════════════════════════════════════════════════
   turnover.js — Leitura e escrita de dados de Turnover
   Planilha: Cadastral 2026
     AJ (col 35) = Data Início Trabalho
     AK (col 36) = Data Desligamento
     AL (col 37) = Motivo do Desligamento
   ═══════════════════════════════════════════════════════════════════════ */

const { getSheetsData } = require('./sheets');
const { google }        = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const KEY_FILE       = process.env.KEY_FILE;
const ABA_CADASTRAL  = 'Cadastral 2026';

async function getAuth() {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return auth;
}

// ─── Helper: parse de data DD/MM/YYYY ou YYYY-MM-DD ─────────────────────────
function parseD(v) {
    if (!v) return null;
    const m1 = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m1) return new Date(+m1[3], +m1[2] - 1, +m1[1]);
    const m2 = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3]);
    return null;
}

// ─── getTurnoverCadastral(ano) ───────────────────────────────────────────────
async function getTurnoverCadastral(ano) {
    const rows = await getSheetsData();
    const anoFiltro = ano ? String(ano) : null;

    const todos     = rows.filter(r => r && r[2]);
    const ativos     = todos.filter(r => !String(r[36]||'').trim());
    const desligados = todos.filter(r =>  String(r[36]||'').trim());

    const desligAno = anoFiltro
        ? desligados.filter(r => {
            const d = parseD(r[36]);
            return d && String(d.getFullYear()) === anoFiltro;
          })
        : desligados;

    const cadastradosAno = anoFiltro
        ? todos.filter(r => {
            const d = parseD(r[35]);
            return d && String(d.getFullYear()) === anoFiltro;
          })
        : todos;

    const totalGeral  = todos.length;
    const pctTurnover = totalGeral > 0
        ? +((desligAno.length / totalGeral) * 100).toFixed(1)
        : 0;

    // Motivos
    const motivosMap = {};
    desligAno.forEach(r => {
        const mot = String(r[37]||'').trim() || 'Não informado';
        motivosMap[mot] = (motivosMap[mot]||0) + 1;
    });
    const motivos = Object.entries(motivosMap)
        .sort(([,a],[,b]) => b - a)
        .map(([motivo, qtd]) => ({ motivo, qtd }));

    // Por loja
    const lojaMap = {};
    todos.forEach(r => {
        const loja = String(r[1]||'—').trim();
        if (!lojaMap[loja]) lojaMap[loja] = { total: 0, desligados: 0 };
        lojaMap[loja].total++;
    });
    desligAno.forEach(r => {
        const loja = String(r[1]||'—').trim();
        if (!lojaMap[loja]) lojaMap[loja] = { total: 0, desligados: 0 };
        lojaMap[loja].desligados++;
    });
    const porLoja = Object.entries(lojaMap)
        .filter(([,v]) => v.desligados > 0)
        .map(([loja, v]) => ({
            loja,
            total:      v.total,
            desligados: v.desligados,
            pct:        +((v.desligados / v.total) * 100).toFixed(1),
        }))
        .sort((a, b) => b.pct - a.pct);

    // Por mês
    const MESES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const mesMap = {};
    desligAno.forEach(r => {
        const d = parseD(r[36]);
        if (!d) return;
        const m = d.getMonth() + 1;
        if (!mesMap[m]) mesMap[m] = { mes: MESES[m], ordem: m, desligados: 0 };
        mesMap[m].desligados++;
    });
    const porMes = Object.values(mesMap).sort((a, b) => a.ordem - b.ordem);

    // Anos disponíveis
    const anosSet = new Set();
    desligados.forEach(r => { const d = parseD(r[36]); if (d) anosSet.add(d.getFullYear()); });
    todos.forEach(r => { const d = parseD(r[35]); if (d) anosSet.add(d.getFullYear()); });
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

// ─── getTurnoverRegistros(ano) ───────────────────────────────────────────────
async function getTurnoverRegistros(ano) {
    const rows = await getSheetsData();

    const registros = rows
        .filter(r => r && r[2])
        .map((r, i) => {
            const dDeslig = parseD(r[36]);
            const dInicio = parseD(r[35]);
            return {
                rowIndex:   i,
                num:        r[0]  || '',
                loja:       r[1]  || '',
                nome:       r[2]  || '',
                funcao:     r[5]  || '',
                inicioTrab: r[35] || '',
                dataDeslig: r[36] || '',
                motivo:     r[37] || '',
                anoDeslig:  dDeslig ? dDeslig.getFullYear() : null,
                anoInicio:  dInicio ? dInicio.getFullYear() : null,
            };
        });

    const filtrado = ano
        ? registros.filter(r =>
            r.dataDeslig
                ? String(r.anoDeslig) === String(ano)
                : true
          )
        : registros;

    return { registros: filtrado };
}

// ─── gravarDesligamento(rowIndex, dataDeslig, motivo) ────────────────────────
// rowIndex = índice 0 do array → linha real na planilha = rowIndex + 9
async function gravarDesligamento(rowIndex, dataDeslig, motivo) {
    const auth      = await getAuth();
    const sheets    = google.sheets({ version: 'v4', auth });
    const linhaReal = rowIndex + 9;
    await sheets.spreadsheets.values.update({
        spreadsheetId:    SPREADSHEET_ID,
        range:            `'${ABA_CADASTRAL}'!AK${linhaReal}:AL${linhaReal}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[dataDeslig || '', motivo || '']],
        },
    });
}

// ─── getResumoTurnover() ─────────────────────────────────────────────────────
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
    getResumoTurnover,
};