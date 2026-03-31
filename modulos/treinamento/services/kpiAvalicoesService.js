'use strict';

// ============================================================
//  kpiAvaliacoesService.js
//  Lê da aba "Respostas ao formulário 1" da planilha AVALIACAO_SHEET_ID
//  e compila KPIs de aprovação, notas e aderência por mês.
// ============================================================

const { Router }     = require('express');
const { google }     = require('googleapis');

const router = Router();

const ABA         = 'Respostas ao formulário 1';
const KEY_FILE    = process.env.GOOGLE_KEY_FILE;
const SHEET_ID    = process.env.AVALIACAO_SHEET_ID;

// ─── Mapeamento de colunas (0-based) ─────────────────────────
// A=0  Data/hora registro
// C=2  Treinador nome+função
// D=3  Unidade treinamento
// E=4  Colaborador avaliado
// F=5  Função colaborador
// G=6  Loja treinada
// H=7  Data início treinamento  (DD/MM/YYYY)
// I=8  Data fim treinamento     (DD/MM/YYYY)
// U=20 Avaliação comportamento  (1-5)
// V=21 Entendimento conteúdo    (1-5)
// W=22 Pronto para função       (1-5)
// X=23 Multiplicador / nota     (0-10)
// Z=25 Aprovado                 (SIM / NÃO / PREFIRO NÃO RESPONDER)
// AA=26 Checkpoint loja treinadora

const COL = {
    dataRegistro:  0,   // A
    treinador:     2,   // C
    unidade:       3,   // D
    colaborador:   4,   // E
    funcao:        5,   // F
    loja:          6,   // G
    dataInicio:    7,   // H
    dataFim:       8,   // I
    comportamento: 20,  // U
    entendimento:  21,  // V
    prontoFuncao:  22,  // W
    nota:          23,  // X
    aprovado:      25,  // Z
    checkpoint:    26,  // AA
};

const MESES_NOMES = [
    '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// ─── Auth Google ──────────────────────────────────────────────
async function getAuth() {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return auth;
}

// ─── Lê todas as linhas da aba ────────────────────────────────
async function lerRespostas() {
    if (!SHEET_ID) throw new Error('AVALIACAO_SHEET_ID não configurado no .env');
    const auth   = await getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const res    = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${ABA}'!A2:AB`,   // pula cabeçalho (linha 1)
    });
    return res.data.values || [];
}

// ─── Parse de data DD/MM/YYYY ou DD/MM/YYYY HH:MM:SS ─────────
function parseData(str) {
    if (!str) return null;
    const s = String(str).trim();
    // formato: DD/MM/YYYY ou DD/MM/YYYY HH:MM:SS
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    // formato ISO: YYYY-MM-DD
    const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3]);
    return null;
}

// ─── Normaliza status de aprovação ───────────────────────────
function normAprovado(val) {
    const v = String(val || '').trim().toUpperCase();
    if (v === 'SIM')    return 'SIM';
    if (v === 'NÃO' || v === 'NAO') return 'NAO';
    if (v.includes('NÃO RESPONDER') || v.includes('NAO RESPONDER') || v.includes('PREFIRO')) return 'PNAO';
    if (v === '') return null;
    return 'OUTRO';
}

// ─── Compila KPIs ─────────────────────────────────────────────
function compilarKpi(rows, ano, mes) {
    const anoStr = String(ano);

    // Estrutura por mês: 1-12
    const mapa = {};
    for (let i = 1; i <= 12; i++) {
        mapa[i] = {
            ordem: i,
            mes: MESES_NOMES[i],
            total: 0,
            sim: 0,
            nao: 0,
            pnao: 0,
            somaNota: 0,
            qtNota: 0,
            somaW: 0,    // pronto para função
            qtW: 0,
            lojas: {},   // ranking de lojas
            itens: [],   // detalhe linha a linha
        };
    }

    rows.forEach(row => {
        // Usa data fim do treinamento (col I) para agrupar por mês.
        // Fallback para data de registro (col A).
        const dtFim     = parseData(row[COL.dataFim]);
        const dtReg     = parseData(row[COL.dataRegistro]);
        const dt        = dtFim || dtReg;
        if (!dt) return;

        const anoRow = String(dt.getFullYear());
        const mesRow = dt.getMonth() + 1;

        if (anoRow !== anoStr) return;
        if (mes && String(mesRow) !== String(mes)) return;
        if (mesRow < 1 || mesRow > 12) return;

        const m   = mapa[mesRow];
        const ap  = normAprovado(row[COL.aprovado]);
        const nota = parseFloat(row[COL.nota]);
        const w    = parseFloat(row[COL.prontoFuncao]);
        const loja = (row[COL.loja] || '').trim() || 'Não informado';

        m.total++;
        if (ap === 'SIM')  m.sim++;
        if (ap === 'NAO')  m.nao++;
        if (ap === 'PNAO') m.pnao++;

        if (!isNaN(nota) && nota >= 0 && nota <= 10) {
            m.somaNota += nota;
            m.qtNota++;
        }
        if (!isNaN(w) && w >= 1 && w <= 5) {
            m.somaW += w;
            m.qtW++;
        }

        // Ranking de lojas
        if (!m.lojas[loja]) m.lojas[loja] = { loja, total: 0, sim: 0, nao: 0, pnao: 0, somaNota: 0, qtNota: 0 };
        m.lojas[loja].total++;
        if (ap === 'SIM')  m.lojas[loja].sim++;
        if (ap === 'NAO')  m.lojas[loja].nao++;
        if (ap === 'PNAO') m.lojas[loja].pnao++;
        if (!isNaN(nota) && nota >= 0 && nota <= 10) {
            m.lojas[loja].somaNota += nota;
            m.lojas[loja].qtNota++;
        }

        m.itens.push({
            colaborador:  (row[COL.colaborador] || '').trim(),
            funcao:       (row[COL.funcao]       || '').trim(),
            loja,
            treinador:    (row[COL.treinador]    || '').trim(),
            unidade:      (row[COL.unidade]      || '').trim(),
            dataInicio:   (row[COL.dataInicio]   || '').trim(),
            dataFim:      (row[COL.dataFim]      || '').trim(),
            aprovado:     ap,
            aprovadoRaw:  (row[COL.aprovado]     || '').trim(),
            nota:         isNaN(nota) ? null : nota,
            prontoFuncao: isNaN(w)    ? null : w,
            checkpoint:   (row[COL.checkpoint]   || '').trim(),
        });
    });

    // Serializa e agrega
    const porMes = Object.values(mapa)
        .filter(m => m.total > 0)
        .map(m => {
            const pctSim  = m.total > 0 ? +((m.sim  / m.total) * 100).toFixed(1) : 0;
            const pctNao  = m.total > 0 ? +((m.nao  / m.total) * 100).toFixed(1) : 0;
            const pctPnao = m.total > 0 ? +((m.pnao / m.total) * 100).toFixed(1) : 0;
            const mediaNota = m.qtNota > 0 ? +(m.somaNota / m.qtNota).toFixed(1) : null;
            const mediaW    = m.qtW    > 0 ? +(m.somaW    / m.qtW   ).toFixed(1) : null;

            // Ranking lojas do mês
            const rankingLojas = Object.values(m.lojas).map(l => ({
                ...l,
                mediaNota: l.qtNota > 0 ? +(l.somaNota / l.qtNota).toFixed(1) : null,
                pctSim:    l.total  > 0 ? +((l.sim  / l.total) * 100).toFixed(1) : 0,
            })).sort((a, b) => b.total - a.total);

            return {
                ordem: m.ordem,
                mes:   m.mes,
                total: m.total,
                sim:   m.sim,
                nao:   m.nao,
                pnao:  m.pnao,
                pctSim,
                pctNao,
                pctPnao,
                mediaNota,
                mediaW,
                rankingLojas,
                itens: m.itens,
            };
        });

    // Totais gerais
    const totSim   = porMes.reduce((s, m) => s + m.sim,   0);
    const totNao   = porMes.reduce((s, m) => s + m.nao,   0);
    const totPnao  = porMes.reduce((s, m) => s + m.pnao,  0);
    const totTotal = porMes.reduce((s, m) => s + m.total, 0);
    const somaNT   = porMes.reduce((s, m) => s + (m.mediaNota != null ? m.mediaNota * (m.qtNota || 0) : 0), 0);
    const qtNT     = porMes.reduce((s, m) => s + (m.qtNota || m.total), 0);

    // Ranking geral de lojas (todos os meses filtrados)
    const lojaGeral = {};
    porMes.forEach(m => {
        m.rankingLojas.forEach(l => {
            if (!lojaGeral[l.loja]) lojaGeral[l.loja] = { loja: l.loja, total: 0, sim: 0, nao: 0, pnao: 0, somaNota: 0, qtNota: 0 };
            lojaGeral[l.loja].total    += l.total;
            lojaGeral[l.loja].sim      += l.sim;
            lojaGeral[l.loja].nao      += l.nao;
            lojaGeral[l.loja].pnao     += l.pnao;
            lojaGeral[l.loja].somaNota += l.somaNota;
            lojaGeral[l.loja].qtNota   += l.qtNota;
        });
    });
    const rankingGeral = Object.values(lojaGeral).map(l => ({
        ...l,
        mediaNota: l.qtNota > 0 ? +(l.somaNota / l.qtNota).toFixed(1) : null,
        pctSim:    l.total  > 0 ? +((l.sim  / l.total) * 100).toFixed(1) : 0,
        pctNao:    l.total  > 0 ? +((l.nao  / l.total) * 100).toFixed(1) : 0,
        pctPnao:   l.total  > 0 ? +((l.pnao / l.total) * 100).toFixed(1) : 0,
    })).sort((a, b) => b.total - a.total);

    return {
        ano: anoStr,
        mes: mes || null,
        totais: {
            total: totTotal,
            sim:   totSim,
            nao:   totNao,
            pnao:  totPnao,
            pctSim:  totTotal > 0 ? +((totSim  / totTotal) * 100).toFixed(1) : 0,
            pctNao:  totTotal > 0 ? +((totNao  / totTotal) * 100).toFixed(1) : 0,
            pctPnao: totTotal > 0 ? +((totPnao / totTotal) * 100).toFixed(1) : 0,
            mediaNota: qtNT > 0 ? +(somaNT / qtNT).toFixed(1) : null,
        },
        porMes,
        rankingGeral,
    };
}

// ─── ROTA GET /kpi-avaliacoes/dados ──────────────────────────
router.get('/dados', async (req, res) => {
    try {
        const ano = req.query.ano || new Date().getFullYear();
        const mes = req.query.mes || null;
        const rows = await lerRespostas();
        const kpi  = compilarKpi(rows, ano, mes);
        res.json({ ok: true, ...kpi });
    } catch (e) {
        console.error('[KPI-AVALIACOES] Erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

module.exports = router;