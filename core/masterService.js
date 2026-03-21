// core/masterService.js — Rotas do painel master
'use strict';

const express    = require('express');
const router     = express.Router();
const { google } = require('googleapis');

// ─── Config ───────────────────────────────────────────────────────────────────
const SHEET_ID   = process.env.USUARIOS_SHEET_ID || '1l3U369m_jss0n1rBrQzfubm7k5kme73O--urJxme6aU';
const ABA        = process.env.USUARIOS_ABA      || 'Gestao_Login';
const ABA_LOG    = process.env.LOG_ABA            || 'Log_Acesso';

// Planilha Gestao_Login: A=Email | B=Nome | C=Modulos | D=Ativo (SIM/NÃO)
const COL = { email: 0, nome: 1, modulos: 2, ativo: 3 };

// Planilha Log_Acesso: A=Data/Hora | B=Email | C=Ação | D=Módulo | E=IP
const COL_LOG = { hora: 0, email: 1, acao: 2, modulo: 3, ip: 4 };

// ─── Google Sheets Auth (leitura + escrita) ───────────────────────────────────
async function getSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_KEY_FILE || './minha-chave.json',
        scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

// ─── Cache de usuários ────────────────────────────────────────────────────────
let _cache = null;

async function lerPlanilha() {
    const sheets = await getSheets();
    const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${ABA}'`,
    });
    return r.data.values || [];
}

async function getUsuarios(forcar = false) {
    if (!forcar && _cache) return _cache;
    const rows = await lerPlanilha();
    // Linha 1 = cabeçalho, dados a partir da linha 2
    _cache = rows.slice(1)
        .map((row, i) => ({
            rowIndex: i + 2,
            email:    String(row[COL.email]   || '').toLowerCase().trim(),
            nome:     String(row[COL.nome]    || '').trim(),
            modulos:  String(row[COL.modulos] || '').toLowerCase()
                        .split(',').map(m => m.trim()).filter(Boolean),
            ativo:    String(row[COL.ativo]   || '').toUpperCase() === 'SIM',
        }))
        .filter(u => u.email);
    return _cache;
}

// ─── GET /master/usuarios ─────────────────────────────────────────────────────
router.get('/usuarios', async (req, res) => {
    try {
        const usuarios = await getUsuarios();
        res.json({ ok: true, usuarios });
    } catch (e) {
        console.error('[master] usuarios erro:', e.message);
        res.json({ ok: false, erro: e.message });
    }
});

// ─── POST /master/usuarios/recarregar ─────────────────────────────────────────
router.post('/usuarios/recarregar', async (req, res) => {
    try {
        _cache = null;
        const usuarios = await getUsuarios(true);
        res.json({ ok: true, total: usuarios.length });
    } catch (e) {
        res.json({ ok: false, erro: e.message });
    }
});

// ─── POST /master/usuarios/inserir ───────────────────────────────────────────
// Body: { email, nome, modulos: ['ti','juridico',...], ativo: true|false }
router.post('/usuarios/inserir', async (req, res) => {
    try {
        const { email, nome, modulos, ativo } = req.body;
        if (!email) return res.status(400).json({ ok: false, erro: 'Email obrigatório.' });

        // Verifica duplicata
        const lista = await getUsuarios();
        const jaExiste = lista.find(u => u.email === email.toLowerCase().trim());
        if (jaExiste) return res.status(400).json({ ok: false, erro: `Usuário já existe na linha ${jaExiste.rowIndex}.` });

        const sheets = await getSheets();
        const rows   = await lerPlanilha();
        const proximaLinha = rows.length + 1;

        const modulosStr = Array.isArray(modulos)
            ? modulos.map(m => m.trim().toLowerCase()).filter(Boolean).join(',')
            : String(modulos || '');

        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `'${ABA}'!A${proximaLinha}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[
                email.trim().toLowerCase(),       // A = Email
                nome ? nome.trim() : '',           // B = Nome
                modulosStr,                        // C = Módulos
                ativo === false ? 'NÃO' : 'SIM',  // D = Ativo
            ]] },
        });

        _cache = null;
        await gravarLog(req, email, 'Usuário inserido', 'master');
        console.log(`[master] Usuário inserido: ${email} → linha ${proximaLinha}`);
        res.json({ ok: true, linha: proximaLinha });
    } catch (e) {
        console.error('[master] inserir erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ─── POST /master/usuarios/desativar ─────────────────────────────────────────
router.post('/usuarios/desativar', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ ok: false, erro: 'Email obrigatório.' });

        const lista   = await getUsuarios();
        const usuario = lista.find(u => u.email === email.toLowerCase().trim());
        if (!usuario) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

        const sheets = await getSheets();
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `'${ABA}'!D${usuario.rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['NÃO']] },
        });

        _cache = null;
        await gravarLog(req, email, 'Usuário desativado', 'master');
        res.json({ ok: true });
    } catch (e) {
        console.error('[master] desativar erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ─── POST /master/usuarios/reativar ──────────────────────────────────────────
router.post('/usuarios/reativar', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ ok: false, erro: 'Email obrigatório.' });

        const lista   = await getUsuarios();
        const usuario = lista.find(u => u.email === email.toLowerCase().trim());
        if (!usuario) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

        const sheets = await getSheets();
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `'${ABA}'!D${usuario.rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['SIM']] },
        });

        _cache = null;
        await gravarLog(req, email, 'Usuário reativado', 'master');
        res.json({ ok: true });
    } catch (e) {
        console.error('[master] reativar erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ─── PATCH /master/usuarios/permissoes ───────────────────────────────────────
// Body: { email, modulos: ['ti','juridico',...] }
router.patch('/usuarios/permissoes', async (req, res) => {
    try {
        const { email, modulos } = req.body;
        if (!email) return res.status(400).json({ ok: false, erro: 'Email obrigatório.' });

        const lista   = await getUsuarios();
        const usuario = lista.find(u => u.email === email.toLowerCase().trim());
        if (!usuario) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

        const modulosStr = Array.isArray(modulos)
            ? modulos.map(m => m.trim().toLowerCase()).filter(Boolean).join(',')
            : String(modulos || '');

        const sheets = await getSheets();
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `'${ABA}'!C${usuario.rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[modulosStr]] },
        });

        _cache = null;
        await gravarLog(req, email, `Permissões alteradas: ${modulosStr}`, 'master');
        res.json({ ok: true });
    } catch (e) {
        console.error('[master] permissoes erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
//  LOGS — persistidos na aba Log_Acesso da planilha
// ═════════════════════════════════════════════════════════════════════════════

// Fila para gravar logs em batch (evita muitas chamadas simultâneas)
const _logQueue = [];
let _logTimer   = null;

async function flushLogs() {
    if (!_logQueue.length) return;
    const lote = _logQueue.splice(0, _logQueue.length);
    try {
        const sheets = await getSheets();
        // Descobre próxima linha
        const r = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `'${ABA_LOG}'!A:A`,
        });
        const proximaLinha = (r.data.values || []).length + 1;
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `'${ABA_LOG}'!A${proximaLinha}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: lote },
        });
    } catch (e) {
        console.error('[master/log] Erro ao gravar logs:', e.message);
    }
}

// Grava um log — coloca na fila e agenda flush em 3s
async function gravarLog(req, email, acao, modulo = '') {
    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const ip    = req?.ip || req?.connection?.remoteAddress || '';
    _logQueue.push([agora, email, acao, modulo, ip]);

    clearTimeout(_logTimer);
    _logTimer = setTimeout(flushLogs, 3000);
}

// Também exporta para uso externo (ex: middlewarePerfil pode chamar)
module.exports.gravarLog = gravarLog;

// ─── GET /master/logs ─────────────────────────────────────────────────────────
router.get('/logs', async (req, res) => {
    try {
        const sheets = await getSheets();
        const r = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `'${ABA_LOG}'`,
        });
        const rows = r.data.values || [];
        // Linha 1 pode ser cabeçalho — pega as últimas 100 entradas, mais recentes primeiro
        const dados = rows.slice(1).slice(-100).reverse().map(row => ({
            hora:   row[COL_LOG.hora]   || '',
            email:  row[COL_LOG.email]  || '',
            acao:   row[COL_LOG.acao]   || '',
            modulo: row[COL_LOG.modulo] || '',
            ip:     row[COL_LOG.ip]     || '',
        }));
        res.json({ ok: true, logs: dados });
    } catch (e) {
        console.error('[master/log] GET logs erro:', e.message);
        res.json({ ok: false, erro: e.message, logs: [] });
    }
});

module.exports = router;