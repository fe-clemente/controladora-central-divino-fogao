// modulos/ti/services/ativosService.js
'use strict';

const express    = require('express');
const router     = express.Router();
const { google } = require('googleapis');
const fs         = require('fs');
const path       = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const SHEET_ID = process.env.ATIVOS_SHEET_ID || '1_4B7EGCpmgDMVjk87mYIL5wY1TqB9fn9';

const ABAS = {
    ativos: {
        nome:   'Ativos',
        inicio: 3,   // linha 1=vazia, linha 2=cabeçalho, dados a partir da 3
        colunas: {
            comodatario: 0,  // A = COMODATÁRIO
            aparelho:    1,  // B = APARELHO
            modelo:      2,  // C = MODELO
            // D = NOVO (não lido)
            numLinha:    4,  // E = Nº Linha
            valor:       5,  // F = VALOR
            assinatura:  6,  // G = ASSINATURA
            etiqueta:    7,  // H = VERIFICAÇÃO COM ETIQUETA
            obs:         8,  // I = Observação
        },
    },
    distratados: {
        nome:   'DISTRATADOS - ATIVOS',
        inicio: 3,
        colunas: {
            comodatario: 0,  // A = COMODATÁRIO
            aparelho:    1,  // B = APARELHO
            modelo:      2,  // C = MODELO
            numLinha:    3,  // D = Nº Linha
            valor:       4,  // E = VALOR
            assinatura:  5,  // F = ASSINATURA
            distrato:    6,  // G = DISTRATO
            obs:         7,  // H = Observação
        },
    },
    desligados: {
        nome:   'Desligados',
        inicio: 2,   // cabeçalho na linha 1
        colunas: {
            comodatario: 0,  // A = COMODATÁRIO
            aparelho:    1,  // B = APARELHO
            numLinha:    2,  // C = Nº Linha
            modelo:      3,  // D = MODELO
            valor:       4,  // E = VALOR
            assinatura:  5,  // F = ASSINATURA
            distrato:    6,  // G = DISTRATO
            // H = Observação (não mapeada na planilha)
        },
    },
    ti: {
        nome:   'T.I',
        inicio: 2,
        colunas: {
            numero:      0,  // A = Nº Equipamento
            equipamento: 1,  // B = Equipamento
            marca:       2,  // C = Marca
            modelo:      3,  // D = Modelo
            local:       4,  // E = Local
            estado:      5,  // F = Estado
            dtCompra:    6,  // G = Dt_Compra
            valor:       7,  // H = Valor
            obs:         8,  // I = Obs
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
    } catch (e) { console.error('[ativosCache]', e.message); }
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
function parseData(v) {
    if (!v) return '';
    v = v.toString().trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
        const [d,m,a] = v.split('/');
        return `${a}-${m}-${d}`;
    }
    return v;
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
            aba:            'Ativos',
            comodatario:    comodatario || '—',
            aparelho:       aparelho    || '—',
            modelo:         get(row, c.modelo)     || '—',
            numLinha:       get(row, c.numLinha)   || '',
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
            aba:            'DISTRATADOS - ATIVOS',
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
            aba:            'Desligados',
            comodatario:    comodatario || '—',
            aparelho:       aparelho    || '—',
            numLinha:       get(row, c.numLinha)  || '',
            modelo:         get(row, c.modelo)    || '—',
            valor,
            valorFormatado: fmtValor(valor),
            assinatura:     get(row, c.assinatura)|| '',
            distrato:       get(row, c.distrato)  || '',
            obs:            '',  // sem coluna obs na planilha
        };
    }).filter(Boolean);
}

function parseTI(rows) {
    const cfg = ABAS.ti;
    if (!rows || rows.length < cfg.inicio) return [];
    return rows.slice(cfg.inicio - 1).map((row, i) => {
        const c = cfg.colunas;
        const numero      = get(row, c.numero);
        const equipamento = get(row, c.equipamento);
        if (!numero && !equipamento) return null;
        const valor = parseValor(get(row, c.valor));
        return {
            rowIndex:        i + cfg.inicio,
            aba:             'T.I',
            numero:          numero      || String(i + 1),
            equipamento:     equipamento || '—',
            marca:           get(row, c.marca)   || '—',
            modelo:          get(row, c.modelo)  || '—',
            local:           get(row, c.local)   || '—',
            estado:          get(row, c.estado)  || '—',
            dtCompra:        parseData(get(row, c.dtCompra)),
            dtCompraOriginal:get(row, c.dtCompra)|| '',
            valor,
            valorFormatado:  fmtValor(valor),
            obs:             get(row, c.obs)     || '',
        };
    }).filter(Boolean);
}

// ─── Estatísticas ─────────────────────────────────────────────────────────────
function statsComodato(lista) {
    const total      = lista.length;
    const valorTotal = lista.reduce((s,i) => s + (i.valor||0), 0);
    const porAparelho = {}, porComodatario = {};
    lista.forEach(i => {
        const a = i.aparelho || 'Outros';
        porAparelho[a] = (porAparelho[a]||0) + 1;
        const c = i.comodatario || '—';
        porComodatario[c] = (porComodatario[c]||0) + 1;
    });
    return {
        total, valorTotal,
        valorTotalFormatado: fmtValor(valorTotal),
        porAparelho: Object.entries(porAparelho).sort((a,b)=>b[1]-a[1])
            .map(([aparelho,qtd]) => ({ aparelho, qtd, pct: +((qtd/total)*100).toFixed(1) })),
        topComodatarios: Object.entries(porComodatario).sort((a,b)=>b[1]-a[1]).slice(0,10)
            .map(([nome,qtd]) => ({ nome, qtd })),
    };
}

function statsTI(lista) {
    const total      = lista.length;
    const valorTotal = lista.reduce((s,i) => s + (i.valor||0), 0);
    const porEquip = {}, porLocal = {}, porEstado = {}, valorPorLocal = {};
    lista.forEach(i => {
        const e = i.equipamento || 'Outros';
        porEquip[e] = (porEquip[e]||0) + 1;
        const l = i.local || 'Não informado';
        porLocal[l] = (porLocal[l]||0) + 1;
        valorPorLocal[l] = (valorPorLocal[l]||0) + (i.valor||0);
        const s = i.estado || 'Não informado';
        porEstado[s] = (porEstado[s]||0) + 1;
    });
    const emBomEstado = lista.filter(i => {
        const e = (i.estado||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        return ['novo','bom','otimo','funcionando','em uso'].includes(e);
    }).length;
    return {
        total, valorTotal,
        valorTotalFormatado: fmtValor(valorTotal),
        emBomEstado,
        porEquipamento: Object.entries(porEquip).sort((a,b)=>b[1]-a[1]).map(([tipo,qtd])=>({tipo,qtd})),
        porLocal:       Object.entries(porLocal).sort((a,b)=>b[1]-a[1]).map(([local,qtd])=>({local,qtd})),
        porEstado:      Object.entries(porEstado).sort((a,b)=>b[1]-a[1]).map(([estado,qtd])=>({estado,qtd,pct:+((qtd/total)*100).toFixed(1)})),
        valorPorLocal:  Object.entries(valorPorLocal).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([local,valor])=>({local,valor,valorFormatado:fmtValor(valor)})),
    };
}

// ─── Sincronizar ──────────────────────────────────────────────────────────────
async function sincronizar() {
    console.log('[ativos] Sincronizando...');
    const sheets = await getSheets();

    async function lerAba(nome) {
        try {
            const r = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: `'${nome}'`,
            });
            return r.data.values || [];
        } catch (e) {
            console.warn(`[ativos] Erro ao ler "${nome}": ${e.message}`);
            return [];
        }
    }

    const [rowsA, rowsD, rowsDes, rowsTI] = await Promise.all([
        lerAba(ABAS.ativos.nome),
        lerAba(ABAS.distratados.nome),
        lerAba(ABAS.desligados.nome),
        lerAba(ABAS.ti.nome),
    ]);

    const ativos      = parseAtivos(rowsA);
    const distratados = parseDistratados(rowsD);
    const desligados  = parseDesligados(rowsDes);
    const ti          = parseTI(rowsTI);

    console.log(`[ativos] Ativos:${ativos.length} Distratados:${distratados.length} Desligados:${desligados.length} T.I:${ti.length}`);

    const dados = {
        ativos,      statsAtivos:      statsComodato(ativos),
        distratados, statsDistratados: statsComodato(distratados),
        desligados,  statsDesligados:  statsComodato(desligados),
        ti,          statsTI:          statsTI(ti),
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

    console.log(`[ativos] Inserido em "${nomeAba}" linha ${proximaLinha}`);
    return proximaLinha;
}

// ─── Atualizar linha existente ────────────────────────────────────────────────
async function atualizarLinha(nomeAba, rowIndex, body) {
    const sheets = await getSheets();
    let mapa = {};

    if (nomeAba === ABAS.ti.nome) {
        // A=Nº B=Equip C=Marca D=Modelo E=Local F=Estado G=DtCompra H=Valor I=Obs
        mapa = { equipamento:'B', marca:'C', modelo:'D', local:'E', estado:'F', dtCompra:'G', valor:'H', obs:'I' };
    } else if (nomeAba === ABAS.ativos.nome) {
        // A=Comod B=Aparelho C=Modelo D=Novo E=NºLinha F=Valor G=Assinatura H=Etiqueta I=Obs
        mapa = { aparelho:'B', modelo:'C', numLinha:'E', valor:'F', assinatura:'G', etiqueta:'H', obs:'I' };
    } else if (nomeAba === ABAS.distratados.nome) {
        // A=Comod B=Aparelho C=Modelo D=NºLinha E=Valor F=Assinatura G=Distrato H=Obs
        mapa = { aparelho:'B', modelo:'C', numLinha:'D', valor:'E', assinatura:'F', distrato:'G', obs:'H' };
    } else if (nomeAba === ABAS.desligados.nome) {
        // A=Comod B=Aparelho C=NºLinha D=Modelo E=Valor F=Assinatura G=Distrato
        mapa = { aparelho:'B', numLinha:'C', modelo:'D', valor:'E', assinatura:'F', distrato:'G' };
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

// GET /ti/api/ativos
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
            ti:               c.ti               || [],
            statsTI:          c.statsTI          || {},
            sincronizadoEm:   c.sincronizadoEm,
            totalAtivos: (c.ativos||[]).length,
            valorTotal:  (c.statsAtivos?.valorTotal||0) + (c.statsTI?.valorTotal||0),
        });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// POST /ti/api/ativos/sincronizar
router.post('/sincronizar', async (req, res) => {
    try {
        const d = await sincronizar();
        res.json({
            ok: true,
            totais: {
                ativos:      d.ativos.length,
                distratados: d.distratados.length,
                desligados:  d.desligados.length,
                ti:          d.ti.length,
            },
        });
    } catch (e) {
        console.error('[ativos] sincronizar erro:', e.message);
        res.json({ ok: false, erro: e.message });
    }
});

// POST /ti/api/ativos/inserir?aba=ativos|distratados|desligados|ti
router.post('/inserir', async (req, res) => {
    try {
        const aba  = req.query.aba || 'ativos';
        const body = req.body;
        let nomeAba, valores;

        if (aba === 'ativos') {
            nomeAba = ABAS.ativos.nome;
            // A=Comod B=Aparelho C=Modelo D=Novo(vazio) E=NºLinha F=Valor G=Assinatura H=Etiqueta I=Obs
            valores = [
                body.comodatario || '',  // A
                body.aparelho    || '',  // B
                body.modelo      || '',  // C
                '',                      // D = NOVO (vazio)
                body.numLinha    || '',  // E = Nº Linha
                body.valor       || '',  // F = VALOR
                body.assinatura  || '',  // G = ASSINATURA
                body.etiqueta    || '',  // H = VERIFICAÇÃO COM ETIQUETA
                body.obs         || '',  // I = OBSERVAÇÃO
            ];
        } else if (aba === 'distratados') {
            nomeAba = ABAS.distratados.nome;
            // A=Comod B=Aparelho C=Modelo D=NºLinha E=Valor F=Assinatura G=Distrato H=Obs
            valores = [
                body.comodatario || '',  // A
                body.aparelho    || '',  // B
                body.modelo      || '',  // C
                body.numLinha    || '',  // D
                body.valor       || '',  // E
                body.assinatura  || '',  // F
                body.distrato    || '',  // G
                body.obs         || '',  // H
            ];
        } else if (aba === 'desligados') {
            nomeAba = ABAS.desligados.nome;
            // A=Comod B=Aparelho C=NºLinha D=Modelo E=Valor F=Assinatura G=Distrato
            valores = [
                body.comodatario || '',  // A
                body.aparelho    || '',  // B
                body.numLinha    || '',  // C
                body.modelo      || '',  // D
                body.valor       || '',  // E
                body.assinatura  || '',  // F
                body.distrato    || '',  // G
            ];
        } else if (aba === 'ti') {
            nomeAba = ABAS.ti.nome;
            // A=Nº B=Equip C=Marca D=Modelo E=Local F=Estado G=DtCompra H=Valor I=Obs
            valores = [
                body.numero      || '',  // A
                body.equipamento || '',  // B
                body.marca       || '',  // C
                body.modelo      || '',  // D
                body.local       || '',  // E
                body.estado      || '',  // F
                body.dtCompra    || '',  // G
                body.valor       || '',  // H
                body.obs         || '',  // I
            ];
        } else {
            return res.status(400).json({ ok: false, erro: 'Aba inválida: ' + aba });
        }

        const linha = await inserirLinha(nomeAba, valores);
        _mem = null; // invalida cache
        res.json({ ok: true, linha, aba: nomeAba });
    } catch (e) {
        console.error('[ativos] inserir erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// PATCH /ti/api/ativos/:rowIndex?aba=ativos|distratados|desligados|ti
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
        console.error('[ativos] patch erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

module.exports = router;