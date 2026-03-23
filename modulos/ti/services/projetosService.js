// services/projetosService.js — Módulo de Projetos T.I. (Express Router)
'use strict';
const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');
const { lerCache, salvarCache } = require('./tiCache');

const SHEET_PROJETOS = process.env.PROJ_SHEET_ID || '1O0dCvn7vs6PevBIKhEJeerh0h2pLz0izZ9dZIGuZZVs';
const ABA_PROJETOS   = process.env.TI_ABA_PROJETOS || 'STATUS DOS PROJETOS';
const aba = nome => `'${nome}'`;

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
 * Layout fixo (linha 1 = título, linha 2 = cabeçalho, linha 3+ = dados):
 * A=Projeto  B=Total Tarefas  C=Concluídas  D=% Concluído
 * E=Em Validação  F=Pendentes  G=Atraso  H=Pausado/Congelado  I=Última Movimentação
 *
 * Regra: se H contém 1 ou "sim" → projeto é PAUSADO → todos os campos
 * numéricos são zerados na exibição (independente do valor real na planilha).
 */
function parseProjetos(rows = []) {
    if (!rows.length) return [];

    // Usa índices fixos baseados no layout documentado.
    // Pula linhas até encontrar a que tem "Projeto" na col A (cabeçalho)
    // ou até a primeira linha com dado real (colB numérico).
    let dataStart = 2; // padrão: linha 3 (índice 2)
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
        const a = String(rows[i][0] || '').trim().toLowerCase();
        if (a === 'projeto') { dataStart = i + 1; break; }
    }

    console.log('[Projetos] dataStart =', dataStart, '| total rows =', rows.length);

    return rows.slice(dataStart).map((row, i) => {
        // Lê célula pelo índice — ignora erros de fórmula (#N/A etc)
        const cel = idx => {
            const v = String(row[idx] ?? '').trim();
            return /^#/.test(v) ? '' : v;
        };

        const nome = cel(0);
        if (!nome) return null;

        // ── Coluna H (índice 7) = Pausado/Congelado ──
        // Aceita: "1" ou "sim" (case-insensitive)
        const hRaw   = cel(7);
        const pausado = /^(1|sim)$/i.test(hRaw);

        console.log(`[Projetos] linha ${dataStart + i + 1}: nome="${nome}" H="${hRaw}" pausado=${pausado}`);

        // Se pausado, zera todos os valores numéricos na exibição
        const totalTarefas = pausado ? 0 : (parseInt(cel(1)) || 0);
        const concluidas   = pausado ? 0 : (parseInt(cel(2)) || 0);
        const pctConcluido = pausado ? 0 : (parseFloat(cel(3).replace('%','').replace(',','.')) || 0);
        const emValidacao  = pausado ? 0 : (parseInt(cel(4)) || 0);
        const pendentes    = pausado ? 0 : (parseInt(cel(5)) || 0);
        const atraso       = pausado ? 0 : (parseInt(cel(6)) || 0);
        const ultimaMoviment = cel(8) || cel(7).match(/\d{2}\/\d{2}\/\d{4}/) ? cel(8) || cel(7) : '';

        return {
            rowIndex: dataStart + i + 1,
            nome,
            totalTarefas,
            concluidas,
            pctConcluido,
            emValidacao,
            pendentes,
            atraso,
            pausado,
            ultimaMoviment: cel(8),
        };
    }).filter(Boolean);
}

// ─── Sincronizar ─────────────────────────────────────────────────────────────
async function sincronizar() {
    const sheets = await getSheets();
    console.log('[Projetos] Sincronizando ->', SHEET_PROJETOS, '/', ABA_PROJETOS);
    const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_PROJETOS,
        range:         aba(ABA_PROJETOS),
    });
    const rawRows = r.data.values || [];
    console.log('[Projetos] rawRows.length =', rawRows.length);
    rawRows.slice(0, 4).forEach((row, i) => console.log(`  row[${i}]:`, JSON.stringify(row)));
    const projetos = parseProjetos(rawRows);
    const agora = new Date().toISOString();
    salvarCache('projetos', { projetos, sincronizadoEm: agora });
    return projetos;
}

// ─── Routes ──────────────────────────────────────────────────────────────────
router.get('/dados', (req, res) => {
    try {
        const c = lerCache('projetos');
        res.json({ ok: true, projetos: c?.projetos || [], sincronizadoEm: c?.sincronizadoEm });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

router.get('/status', (req, res) => {
    const c = lerCache('projetos');
    if (!c) return res.json({ status: 'sem_dados' });
    res.json({
        status: 'pronto',
        total: c.projetos?.length || 0,
        pausados: c.projetos?.filter(p => p.pausado).length || 0,
        sincronizadoEm: c.sincronizadoEm,
    });
});

router.post('/sincronizar', async (req, res) => {
    try {
        const projetos = await sincronizar();
        res.json({ ok: true, total: projetos.length });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

router.patch('/:rowIndex', async (req, res) => {
    try {
        const rowIndex = parseInt(req.params.rowIndex);
        const { observacoes, pausado } = req.body;
        const sheets = await getSheets();
        const data = [];
        if (observacoes !== undefined)
            data.push({ range: `${aba(ABA_PROJETOS)}!J${rowIndex}`, values: [[observacoes]] });
        if (pausado !== undefined)
            data.push({ range: `${aba(ABA_PROJETOS)}!H${rowIndex}`, values: [[pausado ? 1 : 0]] });
        if (data.length) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SHEET_PROJETOS,
                requestBody: { valueInputOption: 'USER_ENTERED', data },
            });
        }
        const c = lerCache('projetos');
        if (c?.projetos) {
            const idx = c.projetos.findIndex(p => p.rowIndex === rowIndex);
            if (idx >= 0) { Object.assign(c.projetos[idx], req.body); salvarCache('projetos', c); }
        }
        res.json({ ok: true });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

module.exports = router;