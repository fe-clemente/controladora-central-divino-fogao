// services/projetosService.js — Módulo de Projetos T.I. (Express Router)
// Montar no server.js: app.use('/projetos', require('./services/projetosService'));
'use strict';
const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');
const { lerCache, salvarCache } = require('./tiCache');

// ─── Configuração ────────────────────────────────────────────────────────────
const SHEET_PROJETOS = process.env.PROJ_SHEET_ID || '1O0dCvn7vs6PevBIKhEJeerh0h2pLz0izZ9dZIGuZZVs';
const ABA_PROJETOS   = process.env.TI_ABA_PROJETOS || 'STATUS DOS PROJETOS';

// Helper: envolve nome de aba em aspas simples (obrigatório quando há espaços)
const aba = nome => `'${nome}'`;

// ─── Auth Google ─────────────────────────────────────────────────────────────
async function getSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_KEY_FILE || 'minha-chave.json',
        scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}

// ─── Parser ──────────────────────────────────────────────────────────────────
/*
 * Aba "STATUS DOS PROJETOS" — colunas:
 * Linha 1: título mesclado "PROJETOS EM ANDAMENTO" (ignorar)
 * Linha 2: cabeçalhos (ignorar)
 * A=Projeto  B=Total Tarefas  C=Concluídas  D=% Concluído
 * E=Em Validação  F=Pendentes  G=Atraso  H=Última Movimentação
 */
function parseProjetos(rows = []) {
    // Pula linhas iniciais que não são dados reais.
    // Uma linha é "dado real" quando a coluna B (Total Tarefas) contém um número inteiro.
    let startIndex = 0;
    for (let i = 0; i < rows.length; i++) {
        const colB = String(rows[i][1] || '').trim();
        if (/^\d+$/.test(colB)) { startIndex = i; break; }
    }

    return rows.slice(startIndex).map((row, i) => ({
        rowIndex:       startIndex + i + 1,
        nome:           row[0] || '',
        totalTarefas:   parseInt(row[1]) || 0,
        concluidas:     parseInt(row[2]) || 0,
        pctConcluido:   parseFloat(String(row[3] || '0').replace('%', '')) || 0,
        emValidacao:    parseInt(row[4]) || 0,
        pendentes:      parseInt(row[5]) || 0,
        atraso:         parseInt(row[6]) || 0,
        ultimaMoviment: row[7] || '',
    })).filter(p => p.nome && p.nome.trim() !== '');
}

// ─── Sincronizar ─────────────────────────────────────────────────────────────
async function sincronizar() {
    const sheets = await getSheets();
    console.log('[Projetos] Sincronizando ->', SHEET_PROJETOS, '/', ABA_PROJETOS);

    const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_PROJETOS,
        range:         aba(ABA_PROJETOS),
    });

    const projetos = parseProjetos(r.data.values || []);
    const agora    = new Date().toISOString();
    salvarCache('projetos', { projetos, sincronizadoEm: agora });
    return projetos;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /projetos/dados
router.get('/dados', (req, res) => {
    try {
        const c = lerCache('projetos');
        res.json({ ok: true, projetos: c?.projetos || [], sincronizadoEm: c?.sincronizadoEm });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// GET /projetos/status
router.get('/status', (req, res) => {
    const c = lerCache('projetos');
    if (!c) return res.json({ status: 'sem_dados' });
    res.json({
        status:        'pronto',
        total:         c.projetos?.length || 0,
        sincronizadoEm: c.sincronizadoEm,
    });
});

// POST /projetos/sincronizar
router.post('/sincronizar', async (req, res) => {
    try {
        const projetos = await sincronizar();
        res.json({ ok: true, total: projetos.length });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// PATCH /projetos/:rowIndex
router.patch('/:rowIndex', async (req, res) => {
    try {
        const rowIndex = parseInt(req.params.rowIndex);
        const { observacoes } = req.body; // extensível: adicione campos conforme necessário
        const sheets = await getSheets();
        const data   = [];

        if (observacoes !== undefined) data.push({ range: `${aba(ABA_PROJETOS)}!I${rowIndex}`, values: [[observacoes]] });

        if (data.length) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SHEET_PROJETOS,
                requestBody:   { valueInputOption: 'USER_ENTERED', data },
            });
        }

        // Atualiza cache local imediatamente
        const c = lerCache('projetos');
        if (c?.projetos) {
            const idx = c.projetos.findIndex(p => p.rowIndex === rowIndex);
            if (idx >= 0) { Object.assign(c.projetos[idx], req.body); salvarCache('projetos', c); }
        }
        res.json({ ok: true });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

module.exports = router;