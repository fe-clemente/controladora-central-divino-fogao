// core/avisosService.js
'use strict';

const express    = require('express');
const router     = express.Router();
const { google } = require('googleapis');

const SHEET_ID  = process.env.USUARIOS_SHEET_ID || '1l3U369m_jss0n1rBrQzfubm7k5kme73O--urJxme6aU';
const ABA_AVISO = 'Avisos';

const COL = { id: 0, setor: 1, tipo: 2, titulo: 3, texto: 4, ativo: 5, data: 6 };

async function getSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_KEY_FILE || './minha-chave.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

// Cache simples (5 minutos) para não bater na planilha toda requisição
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function lerAvisos(forcar = false) {
    if (!forcar && _cache && (Date.now() - _cacheAt) < CACHE_TTL) return _cache;

    const sheets = await getSheets();
    const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${ABA_AVISO}'`,
    });
    const rows = (r.data.values || []).slice(1); // pula cabeçalho
    _cache = rows.map((row, i) => ({
        rowIndex: i + 2,
        id:     String(row[COL.id]     || '').trim(),
        setor:  String(row[COL.setor]  || '').toLowerCase().trim(),
        tipo:   String(row[COL.tipo]   || 'info').toLowerCase().trim(),
        titulo: String(row[COL.titulo] || '').trim(),
        texto:  String(row[COL.texto]  || '').trim(),
        ativo:  String(row[COL.ativo]  || '').toUpperCase() === 'SIM',
        data:   String(row[COL.data]   || '').trim(),
    })).filter(a => a.titulo);
    _cacheAt = Date.now();
    return _cache;
}

// ─── GET /avisos?setor=treinamento ───────────────────────────────────────────
// Retorna avisos ativos do setor + avisos com setor='todos'
router.get('/', async (req, res) => {
    try {
        const setor = String(req.query.setor || '').toLowerCase().trim();
        const todos = await lerAvisos();
        const filtrado = todos.filter(a =>
            a.ativo && (a.setor === setor || a.setor === 'todos')
        );
        res.json({ ok: true, avisos: filtrado });
    } catch (e) {
        console.error('[avisos] GET erro:', e.message);
        res.json({ ok: false, erro: e.message, avisos: [] });
    }
});

// ─── GET /avisos/todos — painel master (sem filtro de ativo/setor) ───────────
router.get('/todos', async (req, res) => {
    try {
        const avisos = await lerAvisos(true);
        res.json({ ok: true, avisos });
    } catch (e) {
        res.json({ ok: false, erro: e.message, avisos: [] });
    }
});

// ─── POST /avisos/inserir ────────────────────────────────────────────────────
// Body: { setor, tipo, titulo, texto, ativo }
router.post('/inserir', async (req, res) => {
    try {
        const { setor, tipo, titulo, texto, ativo } = req.body;
        if (!titulo) return res.status(400).json({ ok: false, erro: 'Título obrigatório.' });

        const sheets  = await getSheets();
        const atual   = await lerAvisos(true);
        const novoId  = `AV${String(atual.length + 1).padStart(3, '0')}`;
        const proxLinha = atual.length + 2; // +2 porque linha 1 é cabeçalho
        const dataHoje  = new Date().toLocaleDateString('pt-BR');

        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `'${ABA_AVISO}'!A${proxLinha}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[
                novoId,
                String(setor  || 'todos').toLowerCase().trim(),
                String(tipo   || 'info').toLowerCase().trim(),
                titulo.trim(),
                String(texto  || '').trim(),
                ativo === false ? 'NÃO' : 'SIM',
                dataHoje,
            ]] },
        });

        _cache = null;
        console.log(`[avisos] Inserido: ${novoId} → ${setor} | ${titulo}`);
        res.json({ ok: true, id: novoId, linha: proxLinha });
    } catch (e) {
        console.error('[avisos] inserir erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ─── PATCH /avisos/editar ────────────────────────────────────────────────────
// Body: { rowIndex, setor, tipo, titulo, texto, ativo }
router.patch('/editar', async (req, res) => {
    try {
        const { rowIndex, setor, tipo, titulo, texto, ativo } = req.body;
        if (!rowIndex) return res.status(400).json({ ok: false, erro: 'rowIndex obrigatório.' });

        const sheets = await getSheets();
        const atual  = await lerAvisos(true);
        const aviso  = atual.find(a => a.rowIndex === Number(rowIndex));
        if (!aviso) return res.status(404).json({ ok: false, erro: 'Aviso não encontrado.' });

        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `'${ABA_AVISO}'!B${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[
                String(setor  ?? aviso.setor).toLowerCase().trim(),
                String(tipo   ?? aviso.tipo).toLowerCase().trim(),
                String(titulo ?? aviso.titulo).trim(),
                String(texto  ?? aviso.texto).trim(),
                (ativo === false || ativo === 'false') ? 'NÃO' : 'SIM',
            ]] },
        });

        _cache = null;
        res.json({ ok: true });
    } catch (e) {
        console.error('[avisos] editar erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ─── POST /avisos/recarregar — limpa o cache ─────────────────────────────────
router.post('/recarregar', async (req, res) => {
    try {
        _cache = null;
        const avisos = await lerAvisos(true);
        res.json({ ok: true, total: avisos.length });
    } catch (e) {
        res.json({ ok: false, erro: e.message });
    }
});

module.exports = router;