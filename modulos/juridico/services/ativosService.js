// modulos/juridico/services/ativosService.js
'use strict';

const express    = require('express');
const router     = express.Router();
const { google } = require('googleapis');
const fs         = require('fs');
const path       = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
// Reutiliza a mesma planilha do T.I.
const SHEET_ID = process.env.ATIVOS_SHEET_ID;

const ABAS = {
    ativos: {
        nome:   'Ativos',
        inicio: 3,
        colunas: {
            comodatario: 0,  // A
            aparelho:    1,  // B
            modelo:      2,  // C
            valor:       5,  // F
            assinatura:  6,  // G
            etiqueta:    7,  // H
            obs:         8,  // I
        },
    },
    distratados: {
        nome:   'DISTRATADOS - ATIVOS',
        inicio: 3,
        colunas: {
            comodatario: 0,  // A
            aparelho:    1,  // B
            modelo:      2,  // C
            numLinha:    3,  // D
            valor:       4,  // E
            assinatura:  5,  // F
            distrato:    6,  // G
            obs:         7,  // H
        },
    },
    desligados: {
        nome:   'Desligados',
        inicio: 2,
        colunas: {
            comodatario: 0,  // A
            aparelho:    1,  // B
            numLinha:    2,  // C
            modelo:      3,  // D
            valor:       4,  // E
            assinatura:  5,  // F
            distrato:    6,  // G
            obs:         7,  // H
        },
    },
};

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_DIR  = path.join(__dirname, '../cache');
const CACHE_FILE = path.join(CACHE_DIR, 'ativos_cache.json');

let _mem = null;

function lerCache() {
    if (_mem) return _mem;
    try {
        if (!fs.existsSync(CACHE_FILE)) return null;
        _mem = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        return _mem;
    } catch { return null; }
}
function salvarCache(dados) {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        const payload = { ...dados, _at: new Date().toISOString() };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));
        _mem = payload;
    } catch (e) { console.error('[juridico/ativosCache]', e.message); }
}

// ─── Google Sheets Auth ───────────────────────────────────────────────────────
async function getSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_KEY_FILE || 'minha-chave.json',
        scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseValor(v) {
    if (!v) return 0;
    const s = v.toString().replace(/R\$\s*/i,'').replace(/\./g,'').replace(',','.').trim();
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}
function fmtValor(v) {
    if (!v) return '—';
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}
const get = (row, idx) => (idx !== undefined && row[idx] !== undefined) ? row[idx].toString().trim() : '';

// ─── Parsers ──────────────────────────────────────────────────────────────────
function parseAtivos(rows) {
    const cfg = ABAS.ativos;
    if (!rows || rows.length < cfg.inicio) return [];
    return rows.slice(cfg.inicio - 1).map((row, i) => {
        const c = cfg.colunas;
        const comodatario = get(row, c.comodatario);
        const aparelho    = get(row, c.aparelho);
        if (!comodatario && !aparelho) return null;
        const valor = parseValor(get(row, c.valor));
        return {
            rowIndex:       i + cfg.inicio,
            comodatario:    comodatario || '—',
            aparelho:       aparelho    || '—',
            modelo:         get(row, c.modelo)     || '—',
            valor,
            valorFormatado: fmtValor(valor),
            assinatura:     get(row, c.assinatura) || '',
            etiqueta:       get(row, c.etiqueta)   || '',
            obs:            get(row, c.obs)        || '',
        };
    }).filter(Boolean);
}

function parseDistratados(rows) {
    const cfg = ABAS.distratados;
    if (!rows || rows.length < cfg.inicio) return [];
    return rows.slice(cfg.inicio - 1).map((row, i) => {
        const c = cfg.colunas;
        const comodatario = get(row, c.comodatario);
        const aparelho    = get(row, c.aparelho);
        if (!comodatario && !aparelho) return null;
        const valor = parseValor(get(row, c.valor));
        return {
            rowIndex:       i + cfg.inicio,
            comodatario:    comodatario || '—',
            aparelho:       aparelho    || '—',
            modelo:         get(row, c.modelo)    || '—',
            numLinha:       get(row, c.numLinha)  || '',
            valor,
            valorFormatado: fmtValor(valor),
            assinatura:     get(row, c.assinatura)|| '',
            distrato:       get(row, c.distrato)  || '',
            obs:            get(row, c.obs)       || '',
        };
    }).filter(Boolean);
}

function parseDesligados(rows) {
    const cfg = ABAS.desligados;
    if (!rows || rows.length < cfg.inicio) return [];
    return rows.slice(cfg.inicio - 1).map((row, i) => {
        const c = cfg.colunas;
        const comodatario = get(row, c.comodatario);
        const aparelho    = get(row, c.aparelho);
        if (!comodatario && !aparelho) return null;
        const valor = parseValor(get(row, c.valor));
        return {
            rowIndex:       i + cfg.inicio,
            comodatario:    comodatario || '—',
            aparelho:       aparelho    || '—',
            numLinha:       get(row, c.numLinha)  || '',
            modelo:         get(row, c.modelo)    || '—',
            valor,
            valorFormatado: fmtValor(valor),
            assinatura:     get(row, c.assinatura)|| '',
            distrato:       get(row, c.distrato)  || '',
            obs:            get(row, c.obs)       || '',
        };
    }).filter(Boolean);
}

// ─── Estatísticas ─────────────────────────────────────────────────────────────
function statsComodato(lista) {
    const total      = lista.length;
    const valorTotal = lista.reduce((s, i) => s + (i.valor || 0), 0);
    const porAparelho = {}, porComodatario = {};
    lista.forEach(i => {
        const a = i.aparelho || 'Outros';
        porAparelho[a] = (porAparelho[a] || 0) + 1;
        const c = i.comodatario || '—';
        porComodatario[c] = (porComodatario[c] || 0) + 1;
    });
    return {
        total, valorTotal,
        valorTotalFormatado: fmtValor(valorTotal),
        porAparelho: Object.entries(porAparelho).sort((a,b) => b[1]-a[1])
            .map(([aparelho, qtd]) => ({ aparelho, qtd, pct: +((qtd/total)*100).toFixed(1) })),
        topComodatarios: Object.entries(porComodatario).sort((a,b) => b[1]-a[1]).slice(0,10)
            .map(([nome, qtd]) => ({ nome, qtd })),
    };
}

// ─── Sincronizar ──────────────────────────────────────────────────────────────
async function sincronizar() {
    console.log('[juridico/ativos] Sincronizando...');
    const sheets = await getSheets();

    async function lerAba(nome) {
        try {
            const r = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: `'${nome}'`,
            });
            return r.data.values || [];
        } catch (e) {
            console.warn(`[juridico/ativos] Erro ao ler "${nome}": ${e.message}`);
            return [];
        }
    }

    const [rowsA, rowsD, rowsDes] = await Promise.all([
        lerAba(ABAS.ativos.nome),
        lerAba(ABAS.distratados.nome),
        lerAba(ABAS.desligados.nome),
    ]);

    const ativos      = parseAtivos(rowsA);
    const distratados = parseDistratados(rowsD);
    const desligados  = parseDesligados(rowsDes);

    console.log(`[juridico/ativos] Ativos:${ativos.length} Distratados:${distratados.length} Desligados:${desligados.length}`);

    const dados = {
        ativos,      statsAtivos:      statsComodato(ativos),
        distratados, statsDistratados: statsComodato(distratados),
        desligados,  statsDesligados:  statsComodato(desligados),
        sincronizadoEm: new Date().toISOString(),
    };
    salvarCache(dados);
    return dados;
}

// ─── Inserir nova linha ────────────────────────────────────────────────────────
async function inserirLinha(nomeAba, valores) {
    const sheets = await getSheets();
    const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${nomeAba}'`,
    });
    const rows = r.data.values || [];
    const proximaLinha = rows.length + 1;

    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `'${nomeAba}'!A${proximaLinha}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [valores] },
    });

    console.log(`[juridico/ativos] Inserido em "${nomeAba}" linha ${proximaLinha}`);
    return proximaLinha;
}

// ─── Atualizar linha existente ────────────────────────────────────────────────
async function atualizarLinha(nomeAba, rowIndex, body) {
    const sheets = await getSheets();
    let mapa = {};

    if (nomeAba === ABAS.ativos.nome) {
        mapa = { aparelho: 'B', modelo: 'C', valor: 'F', assinatura: 'G', etiqueta: 'H', obs: 'I' };
    } else if (nomeAba === ABAS.distratados.nome) {
        mapa = { aparelho: 'B', modelo: 'C', numLinha: 'D', valor: 'E', assinatura: 'F', distrato: 'G', obs: 'H' };
    } else if (nomeAba === ABAS.desligados.nome) {
        mapa = { aparelho: 'B', numLinha: 'C', modelo: 'D', valor: 'E', assinatura: 'F', distrato: 'G', obs: 'H' };
    }

    const data = Object.entries(mapa)
        .filter(([k]) => body[k] !== undefined)
        .map(([k, col]) => ({
            range:  `'${nomeAba}'!${col}${rowIndex}`,
            values: [[body[k]]],
        }));

    if (!data.length) return;
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS
// ══════════════════════════════════════════════════════════════════════════════

// GET /juridico/api/ativos
router.get('/', (req, res) => {
    try {
        const c = lerCache();
        if (!c) return res.json({ ok: false, erro: 'Sem dados — clique em Sincronizar.' });
        res.json({
            ok: true,
            ativos:           c.ativos          || [],
            statsAtivos:      c.statsAtivos      || {},
            distratados:      c.distratados      || [],
            statsDistratados: c.statsDistratados || {},
            desligados:       c.desligados       || [],
            statsDesligados:  c.statsDesligados  || {},
            sincronizadoEm:   c.sincronizadoEm,
        });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// POST /juridico/api/ativos/sincronizar
router.post('/sincronizar', async (req, res) => {
    try {
        const d = await sincronizar();
        res.json({
            ok: true,
            totais: {
                ativos:      d.ativos.length,
                distratados: d.distratados.length,
                desligados:  d.desligados.length,
            },
        });
    } catch (e) {
        console.error('[juridico/ativos] sincronizar erro:', e.message);
        res.json({ ok: false, erro: e.message });
    }
});

// POST /juridico/api/ativos/inserir?aba=ativos|distratados|desligados
router.post('/inserir', async (req, res) => {
    try {
        const aba  = req.query.aba || 'ativos';
        const body = req.body;
        let nomeAba, valores;

        if (aba === 'ativos') {
            nomeAba = ABAS.ativos.nome;
            valores = [
                body.comodatario || '',
                body.aparelho    || '',
                body.modelo      || '',
                '', '',
                body.valor       || '',
                body.assinatura  || '',
                body.etiqueta    || '',
                body.obs         || '',
            ];
        } else if (aba === 'distratados') {
            nomeAba = ABAS.distratados.nome;
            valores = [
                body.comodatario || '',
                body.aparelho    || '',
                body.modelo      || '',
                body.numLinha    || '',
                body.valor       || '',
                body.assinatura  || '',
                body.distrato    || '',
                body.obs         || '',
            ];
        } else if (aba === 'desligados') {
            nomeAba = ABAS.desligados.nome;
            valores = [
                body.comodatario || '',
                body.aparelho    || '',
                body.numLinha    || '',
                body.modelo      || '',
                body.valor       || '',
                body.assinatura  || '',
                body.distrato    || '',
                body.obs         || '',
            ];
        } else {
            return res.status(400).json({ ok: false, erro: 'Aba inválida: ' + aba });
        }

        const linha = await inserirLinha(nomeAba, valores);
        _mem = null;
        res.json({ ok: true, linha, aba: nomeAba });
    } catch (e) {
        console.error('[juridico/ativos] inserir erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// PATCH /juridico/api/ativos/:rowIndex?aba=ativos|distratados|desligados
router.patch('/:rowIndex', async (req, res) => {
    try {
        const row     = parseInt(req.params.rowIndex);
        const abaKey  = req.query.aba || 'ativos';
        const nomeAba = ABAS[abaKey]?.nome || ABAS.ativos.nome;

        await atualizarLinha(nomeAba, row, req.body);

        const c = lerCache();
        if (c && c[abaKey]) {
            const idx = c[abaKey].findIndex(i => i.rowIndex === row);
            if (idx >= 0) { Object.assign(c[abaKey][idx], req.body); salvarCache(c); }
        }
        res.json({ ok: true });
    } catch (e) {
        console.error('[juridico/ativos] patch erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

module.exports = router;