// services/pixService.js
// Montar no server.js: app.use('/pix', require('./services/pixService'));
//
// Planilha: https://docs.google.com/spreadsheets/d/1-61H_O1t1Y9ulxbrakM3kmtfFb8JoIW9qOEmz_p2_Pg
// Aba: Controle Implantação Pix TEF Divino Fogão
// Colunas:
//   A=Estado  B=Cidade  C=Unidade/Shopping  D=Razão Social
//   E=Status Atual  F=Responsável TI  G=Data de Conclusão  H=Observações
'use strict';



const express    = require('express');
const router     = express.Router();
const { google } = require('googleapis');
const fs         = require('fs');
const path       = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const SHEET_ID = process.env.PIX_SHEET_ID || '1-61H_O1t1Y9ulxbrakM3kmtfFb8JoIW9qOEmz_p2_Pg';
const ABA      = process.env.PIX_ABA      || 'Controle Implantação Pix TEF Divino Fogão';

// Mapeamento colunas editáveis → letra
const COL_EDIT = {
    status:       'E',
    responsavel:  'F',
    dataConclusao:'G',
    observacoes:  'H',
};

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_DIR  = path.join(__dirname, '../cache');
const CACHE_FILE = path.join(CACHE_DIR, 'pix_cache.json');

function lerCache() {
    try {
        if (!fs.existsSync(CACHE_FILE)) return null;
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch { return null; }
}
function salvarCache(dados) {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...dados, _at: new Date().toISOString() }, null, 2));
    } catch (e) { console.error('[pixCache]', e.message); }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function getSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_KEY_FILE || 'minha-chave.json',
        scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

// ─── Parser ───────────────────────────────────────────────────────────────────
function normStr(s) {
    return (s || '').toString().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function parseData(v) {
    if (!v) return '';
    v = v.toString().trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
        const [d, m, a] = v.split('/');
        return `${a}-${m}-${d}`;
    }
    return v;
}

function parseLinhas(rows) {
    if (!rows || rows.length < 2) return [];
    // Linha 1 = cabeçalho
    return rows.slice(1).map((row, i) => {
        const estado        = (row[0] || '').toString().trim();
        const cidade        = (row[1] || '').toString().trim();
        const unidade       = (row[2] || '').toString().trim();
        const razaoSocial   = (row[3] || '').toString().trim();
        const status        = (row[4] || '').toString().trim();
        const responsavel   = (row[5] || '').toString().trim();
        const dataConclusao = parseData(row[6] || '');
        const dataConclusaoOriginal = (row[6] || '').toString().trim();
        const observacoes   = (row[7] || '').toString().trim();

        if (!estado && !cidade && !unidade && !razaoSocial) return null;

        return {
            rowIndex:    i + 2,   // linha real na planilha
            estado,
            cidade,
            unidade,
            razaoSocial,
            status,
            responsavel,
            dataConclusao,
            dataConclusaoOriginal,
            observacoes,
        };
    }).filter(Boolean);
}

// ─── Normaliza status para classificação ──────────────────────────────────────
function normStatus(s) {
    const n = normStr(s);
    if (n.includes('conclu'))                            return 'Concluído';
    if (n.includes('impedi') || n.includes('bloqueado')) return 'Impedido';
    if (n.includes('aguard'))                            return 'Aguardar';
    if (n.includes('andamento'))                         return 'Em Andamento';
    if (n.includes('pendente') || n === '')              return 'Pendente';
    return s || 'Pendente';
}

// ─── Estatísticas ─────────────────────────────────────────────────────────────
function gerarStats(lojas) {
    const total     = lojas.length;
    const porStatus = {};
    const porEstado = {};
    const porResp   = {};

    lojas.forEach(l => {
        const st = normStatus(l.status);
        porStatus[st] = (porStatus[st] || 0) + 1;

        const uf = l.estado || '??';
        porEstado[uf] = (porEstado[uf] || 0) + 1;

        const resp = l.responsavel || 'Não atribuído';
        porResp[resp] = (porResp[resp] || 0) + 1;
    });

    const concluidos  = porStatus['Concluído']    || 0;
    const impedidos   = porStatus['Impedido']     || 0;
    const pendentes   = porStatus['Pendente']     || 0;
    const aguardar    = porStatus['Aguardar']     || 0;
    const andamento   = porStatus['Em Andamento'] || 0;

    return {
        total,
        concluidos,
        impedidos,
        pendentes,
        aguardar,
        andamento,
        pctConcluido: total ? +((concluidos / total) * 100).toFixed(1) : 0,
        porStatus: Object.entries(porStatus)
            .sort((a, b) => b[1] - a[1])
            .map(([status, qtd]) => ({ status, qtd, pct: +((qtd / total) * 100).toFixed(1) })),
        porEstado: Object.entries(porEstado)
            .sort((a, b) => b[1] - a[1])
            .map(([estado, qtd]) => ({ estado, qtd })),
        porResponsavel: Object.entries(porResp)
            .filter(([k]) => k !== 'Não atribuído')
            .sort((a, b) => b[1] - a[1])
            .map(([nome, qtd]) => ({ nome, qtd })),
    };
}

// ─── Sincronizar ──────────────────────────────────────────────────────────────
async function sincronizar() {
    console.log('[pix] Sincronizando...');
    const sheets = await getSheets();
    const res    = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range:         ABA,
    });

    const lojas = parseLinhas(res.data.values || []);
    const stats = gerarStats(lojas);

    console.log(`[pix] ✅ ${lojas.length} lojas | Concluídas: ${stats.concluidos} | Pendentes: ${stats.pendentes} | Impedidas: ${stats.impedidos}`);

    const dados = { lojas, stats, sincronizadoEm: new Date().toISOString() };
    salvarCache(dados);
    return dados;
}

// ─── Atualizar linha ──────────────────────────────────────────────────────────
async function atualizarLinha(rowIndex, body) {
    const sheets = await getSheets();

    const data = Object.entries(COL_EDIT)
        .filter(([k]) => body[k] !== undefined && body[k] !== null)
        .map(([k, col]) => ({
            range:  `'${ABA}'!${col}${rowIndex}`,
            values: [[body[k]]],
        }));

    if (!data.length) return;

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody:   { valueInputOption: 'USER_ENTERED', data },
    });

    console.log(`[pix] Linha ${rowIndex} atualizada: ${JSON.stringify(body)}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════════
router.use((req, res, next) => {
    console.log(`[pix DEBUG] ${req.method} ${req.path} | query: ${JSON.stringify(req.query)}`);
    next();
});
// GET /pix/dados
router.get('/dados', (req, res) => {
    try {
        const c = lerCache();
        if (!c) return res.json({ ok: false, erro: 'Sem dados — clique em Sincronizar.' });
        res.json({ ok: true, lojas: c.lojas || [], stats: c.stats || {}, sincronizadoEm: c.sincronizadoEm });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// GET /pix/stats — só os números (para o dashboard)
router.get('/stats', (req, res) => {
    try {
        const c = lerCache();
        if (!c) return res.json({ ok: false, erro: 'Sem dados.' });
        res.json({ ok: true, ...c.stats, sincronizadoEm: c.sincronizadoEm });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// POST /pix/sincronizar
router.post('/sincronizar', async (req, res) => {
    try {
        const d = await sincronizar();
        res.json({ ok: true, total: d.lojas.length, stats: d.stats });
    } catch (e) {
        console.error('[pix] sincronizar erro:', e.message);
        res.json({ ok: false, erro: e.message });
    }
});

// PATCH /pix/:rowIndex — edita status, responsável, dataConclusao, observações
router.patch('/:rowIndex', async (req, res) => {
    try {
        const row = parseInt(req.params.rowIndex);
        if (isNaN(row) || row < 2) return res.json({ ok: false, erro: 'rowIndex inválido.' });

        await atualizarLinha(row, req.body);

        // Atualiza cache local sem precisar re-sincronizar tudo
        const c = lerCache();
        if (c?.lojas) {
            const idx = c.lojas.findIndex(l => l.rowIndex === row);
            if (idx >= 0) {
                Object.assign(c.lojas[idx], req.body);
                // Recalcula status normalizado
                c.lojas[idx].status = req.body.status || c.lojas[idx].status;
                c.stats = gerarStats(c.lojas);
                salvarCache(c);
            }
        }
        res.json({ ok: true });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

module.exports = router;
module.exports.sincronizar = sincronizar;