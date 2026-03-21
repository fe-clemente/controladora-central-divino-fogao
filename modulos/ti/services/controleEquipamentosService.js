// services/controleEquipamentosService.js — Divino Fogão T.I.
'use strict';

const express    = require('express');
const router     = express.Router();
const { google } = require('googleapis');
const fs         = require('fs');
const path       = require('path');
const multer     = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const SHEET_ID = process.env.ATIVOS_SHEET_ID || 'SEU_SHEET_ID_AQUI';

// ─── Abas ─────────────────────────────────────────────────────────────────────
const ABA = {
    nome:   'CONTROLE T.I',
    inicio: 2,
    colunas: {
        etiqueta:        0,
        funcionario:     1,
        setor:           2,
        contato:         3,
        tipoAparelho:    4,
        modelo:          5,
        local:           6,
        dtEntrega:       7,
        valor:           8,
        estadoEntrega:   9,
        assinouComodato: 10,
        numSerie:        11,
        statusAtual:     12,
        dtDevolucao:     13,
        estadoDevolucao: 14,
        valorCobrado:    15,
        motivoDevTroca:  16,
        obs:             17,
        dtImportacao:    19,
    },
};

const ABA_HIST = {
    nome:   'CONTROLE T.I HISTORICO',
    inicio: 2,
    // Colunas A–P (cabeçalho na linha 1)
    // A=dataRegistro B=funcionario C=setor D=etiqueta E=tipo F=modelo
    // G=numSerie H=local I=dtEntrega J=dtDevolucao K=estadoDevolucao
    // L=motivo M=valorEquipamento N=valorCobrado O=pagoPeloFuncionario P=obs
};

const COL_MAP = {
    etiqueta:        'A',
    funcionario:     'B',
    setor:           'C',
    contato:         'D',
    tipoAparelho:    'E',
    modelo:          'F',
    local:           'G',
    dtEntrega:       'H',
    valor:           'I',
    estadoEntrega:   'J',
    assinouComodato: 'K',
    numSerie:        'L',
    statusAtual:     'M',
    dtDevolucao:     'N',
    estadoDevolucao: 'O',
    valorCobrado:    'P',
    motivoDevTroca:  'Q',
    obs:             'R',
    dtImportacao:    'T',
};

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_DIR      = path.join(__dirname, '../cache');
const CACHE_FILE     = path.join(CACHE_DIR, 'controle_equipamentos_cache.json');
const CACHE_HIST     = path.join(CACHE_DIR, 'controle_historico_cache.json');
let _mem = null;
let _memHist = null;

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
    } catch (e) { console.error('[controleEquip] cache write error:', e.message); }
}
function lerCacheHist() {
    if (_memHist) return _memHist;
    try {
        if (!fs.existsSync(CACHE_HIST)) return { historico: [] };
        _memHist = JSON.parse(fs.readFileSync(CACHE_HIST, 'utf8'));
        return _memHist;
    } catch { return { historico: [] }; }
}
function salvarCacheHist(dados) {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(CACHE_HIST, JSON.stringify(dados, null, 2));
        _memHist = dados;
    } catch (e) { console.error('[historico] cache write error:', e.message); }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
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
    if (!v) return '';
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
const get = (row, idx) =>
    (idx !== undefined && row[idx] !== undefined) ? row[idx].toString().trim() : '';
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

// ─── Parser CONTROLE T.I ──────────────────────────────────────────────────────
function parseEquipamentos(rows) {
    if (!rows || !rows.length) return [];
    console.log(`[controleEquip] Total linhas brutas: ${rows.length} | Início: linha ${ABA.inicio}`);
    const linhasUteis = rows.slice(ABA.inicio - 1);
    let descartadas = 0;
    const resultado = linhasUteis.map((row, i) => {
        const c = ABA.colunas;
        const funcionario = get(row, c.funcionario);
        const etiqueta    = get(row, c.etiqueta);
        if (!funcionario && !etiqueta) { descartadas++; return null; }
        const valor        = parseValor(get(row, c.valor));
        const valorCobrado = parseValor(get(row, c.valorCobrado));
        return {
            rowIndex:            i + ABA.inicio,
            etiqueta:            etiqueta                       || '',
            funcionario:         funcionario                    || '(sem nome)',
            setor:               get(row, c.setor)             || '',
            contato:             get(row, c.contato)           || '',
            tipoAparelho:        get(row, c.tipoAparelho)      || '',
            modelo:              get(row, c.modelo)            || '',
            local:               get(row, c.local)             || '',
            dtEntrega:           parseData(get(row, c.dtEntrega)),
            dtEntregaOriginal:   get(row, c.dtEntrega)         || '',
            valor,
            valorFormatado:      fmtValor(valor),
            estadoEntrega:       get(row, c.estadoEntrega)     || '',
            assinouComodato:     get(row, c.assinouComodato)   || 'Não',
            numSerie:            get(row, c.numSerie)          || '',
            statusAtual:         get(row, c.statusAtual)       || 'Sem equipamento',
            dtDevolucao:         parseData(get(row, c.dtDevolucao)),
            dtDevolucaoOriginal: get(row, c.dtDevolucao)       || '',
            estadoDevolucao:     get(row, c.estadoDevolucao)   || '',
            valorCobrado,
            valorCobradoFormatado: fmtValor(valorCobrado),
            motivoDevTroca:      get(row, c.motivoDevTroca)    || '',
            obs:                 get(row, c.obs)               || '',
            dtImportacao:        get(row, c.dtImportacao)      || '',
        };
    }).filter(Boolean);
    console.log(`[controleEquip] Descartadas: ${descartadas} | Aproveitadas: ${resultado.length}`);
    return resultado;
}

// ─── Parser HISTORICO ─────────────────────────────────────────────────────────
function parseHistorico(rows) {
    if (!rows || rows.length < 2) return [];
    return rows.slice(1).map((row, i) => {
        if (!get(row, 1)) return null; // precisa ter funcionário
        const valor        = parseValor(get(row, 12));
        const valorCobrado = parseValor(get(row, 13));
        return {
            rowIndex:            i + 2,
            dataRegistro:        get(row, 0)  || '',
            funcionario:         get(row, 1)  || '',
            setor:               get(row, 2)  || '',
            etiqueta:            get(row, 3)  || '',
            tipoAparelho:        get(row, 4)  || '',
            modelo:              get(row, 5)  || '',
            numSerie:            get(row, 6)  || '',
            local:               get(row, 7)  || '',
            dtEntrega:           get(row, 8)  || '',
            dtDevolucao:         get(row, 9)  || '',
            estadoDevolucao:     get(row, 10) || '',
            motivo:              get(row, 11) || '',
            valor,
            valorFormatado:      fmtValor(valor),
            valorCobrado,
            valorCobradoFormatado: fmtValor(valorCobrado),
            pagoPeloFuncionario: get(row, 14) || 'Não',
            obs:                 get(row, 15) || '',
        };
    }).filter(Boolean);
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function calcStats(lista) {
    const total      = lista.length;
    const valorTotal = lista.reduce((s, i) => s + (i.valor || 0), 0);
    const valorRestituido = lista.reduce((s, i) => s + (i.valorCobrado || 0), 0);
    const porTipo = {}, porLocal = {}, porStatus = {}, porSetor = {};
    lista.forEach(i => {
        const tipo  = i.tipoAparelho || 'Sem tipo';
        const local = i.local        || 'Não informado';
        const stat  = i.statusAtual  || 'Não informado';
        const setor = i.setor        || 'Não informado';
        porTipo[tipo]   = (porTipo[tipo]   || 0) + 1;
        porLocal[local] = (porLocal[local] || 0) + 1;
        porStatus[stat] = (porStatus[stat] || 0) + 1;
        porSetor[setor] = (porSetor[setor] || 0) + 1;
    });
    const n = s => norm(s);
    return {
        total,
        valorTotal,
        valorTotalFormatado: fmtValor(valorTotal) || '—',
        valorRestituido,
        valorRestituidoFormatado: fmtValor(valorRestituido) || '—',
        emUso:       lista.filter(i => ['funcionando','novo','em uso','sem equipamento'].includes(n(i.statusAtual))).length,
        manutencao:  lista.filter(i => n(i.statusAtual).includes('manut')).length,
        desligados:  lista.filter(i => n(i.statusAtual).includes('deslig')).length,
        semComodato: lista.filter(i => i.assinouComodato !== 'Sim').length,
        devolvidos:  lista.filter(i => !!i.dtDevolucao).length,
        porTipo:   Object.entries(porTipo).sort((a,b)=>b[1]-a[1]).map(([tipo,qtd])=>({tipo,qtd,pct:+((qtd/total)*100).toFixed(1)})),
        porLocal:  Object.entries(porLocal).sort((a,b)=>b[1]-a[1]).map(([local,qtd])=>({local,qtd})),
        porStatus: Object.entries(porStatus).sort((a,b)=>b[1]-a[1]).map(([status,qtd])=>({status,qtd})),
        porSetor:  Object.entries(porSetor).sort((a,b)=>b[1]-a[1]).map(([setor,qtd])=>({setor,qtd})),
    };
}

// ─── Sincronizar controle ─────────────────────────────────────────────────────
async function sincronizar() {
    console.log('[controleEquip] Sincronizando aba:', ABA.nome);
    const sheets = await getSheets();
    const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${ABA.nome}'`,
    });
    const rows         = r.data.values || [];
    const equipamentos = parseEquipamentos(rows);
    const stats        = calcStats(equipamentos);
    console.log(`[controleEquip] ${equipamentos.length} registros carregados`);
    const dados = { equipamentos, stats, sincronizadoEm: new Date().toISOString() };
    salvarCache(dados);
    return dados;
}

// ─── Sincronizar histórico ────────────────────────────────────────────────────
async function sincronizarHistorico() {
    console.log('[historico] Sincronizando aba:', ABA_HIST.nome);
    const sheets = await getSheets();
    try {
        const r = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `'${ABA_HIST.nome}'`,
        });
        const rows     = r.data.values || [];
        const historico = parseHistorico(rows);
        console.log(`[historico] ${historico.length} registros`);
        const dados = { historico, sincronizadoEm: new Date().toISOString() };
        salvarCacheHist(dados);
        return historico;
    } catch (e) {
        console.warn('[historico] Falha ao ler aba histórico:', e.message);
        return [];
    }
}

// ─── Inserir linha CONTROLE T.I ───────────────────────────────────────────────
async function inserirLinha(body) {
    const sheets = await getSheets();
    const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${ABA.nome}'`,
    });
    const rows         = r.data.values || [];
    const proximaLinha = Math.max(rows.length + 1, ABA.inicio);
    const valores = [
        body.etiqueta        || '',
        body.funcionario     || '',
        body.setor           || '',
        body.contato         || '',
        body.tipoAparelho    || '',
        body.modelo          || '',
        body.local           || '',
        body.dtEntrega       || '',
        body.valor           || '',
        body.estadoEntrega   || '',
        body.assinouComodato || 'Não',
        body.numSerie        || '',
        body.statusAtual     || 'Sem equipamento',
        body.dtDevolucao     || '',
        body.estadoDevolucao || '',
        body.valorCobrado    || '',
        body.motivoDevTroca  || '',
        body.obs             || '',
        '',
        body.dtImportacao    || '',
    ];
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `'${ABA.nome}'!A${proximaLinha}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [valores] },
    });
    console.log(`[controleEquip] Inserido linha ${proximaLinha}: ${body.funcionario}`);
    return proximaLinha;
}

// ─── Atualizar linha CONTROLE T.I ─────────────────────────────────────────────
async function atualizarLinha(rowIndex, body) {
    const sheets = await getSheets();
    const data = Object.entries(COL_MAP)
        .filter(([k]) => body[k] !== undefined && body[k] !== null)
        .map(([k, col]) => ({
            range:  `'${ABA.nome}'!${col}${rowIndex}`,
            values: [[body[k]]],
        }));
    if (!data.length) return;
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
    console.log(`[controleEquip] Linha ${rowIndex} atualizada`);
}

// ─── Inserir no HISTORICO ─────────────────────────────────────────────────────
async function inserirHistorico(item, motivo, valorCobrado, pagoPeloFuncionario, obs) {
    const sheets = await getSheets();
    // descobre próxima linha livre no histórico
    let proximaLinha = 2;
    try {
        const r = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `'${ABA_HIST.nome}'`,
        });
        proximaLinha = Math.max((r.data.values || []).length + 1, 2);
    } catch (e) {
        console.warn('[historico] Não foi possível ler aba para descobrir próxima linha:', e.message);
    }

    const hoje = new Date().toLocaleDateString('pt-BR');
    const valores = [
        hoje,                              // A dataRegistro
        item.funcionario      || '',       // B
        item.setor            || '',       // C
        item.etiqueta         || '',       // D
        item.tipoAparelho     || '',       // E
        item.modelo           || '',       // F
        item.numSerie         || '',       // G
        item.local            || '',       // H
        item.dtEntregaOriginal|| '',       // I
        hoje,                              // J dtDevolucao
        item.estadoDevolucao  || '',       // K
        motivo                || '',       // L
        item.valor > 0 ? item.valorFormatado : '', // M valorEquipamento
        valorCobrado          || '',       // N
        pagoPeloFuncionario   || 'Não',   // O
        obs                   || '',       // P
    ];

    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `'${ABA_HIST.nome}'!A${proximaLinha}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [valores] },
    });
    console.log(`[historico] Registrado linha ${proximaLinha}: ${item.funcionario} — ${item.modelo || item.tipoAparelho}`);
    return proximaLinha;
}

// ─── Patch cache ──────────────────────────────────────────────────────────────
function patchCache(rowIndex, campos) {
    const c = lerCache();
    if (!c || !c.equipamentos) return;
    const idx = c.equipamentos.findIndex(i => i.rowIndex === rowIndex);
    if (idx < 0) return;
    Object.assign(c.equipamentos[idx], campos);
    if (campos.valor !== undefined) {
        const v = parseValor(campos.valor);
        c.equipamentos[idx].valor         = v;
        c.equipamentos[idx].valorFormatado = fmtValor(v);
    }
    c.stats = calcStats(c.equipamentos);
    salvarCache(c);
}

// ══════════════════════════════════════════════════════════════════════════════
// SULTS
// ══════════════════════════════════════════════════════════════════════════════
const SULTS_BASE       = 'https://api.sults.com.br/v1';
const SULTS_TOKEN      = process.env.SULTS_TOKEN || 'SEU_TOKEN_AQUI';
const SULTS_LIMIT      = 100;
const DIVINO_FOGAO_ID  = process.env.SULTS_EMPRESA_ID ? parseInt(process.env.SULTS_EMPRESA_ID) : 65;
const SULTS_CACHE_FILE = path.join(CACHE_DIR, 'sults_pessoas_cache.json');
const SULTS_TTL_MS     = 30 * 60 * 1000;
let _sultsMem = null, _sultsCacheAt = 0;

function lerCacheSults() {
    if (_sultsMem && (Date.now() - _sultsCacheAt) < SULTS_TTL_MS) return _sultsMem;
    try {
        if (!fs.existsSync(SULTS_CACHE_FILE)) return null;
        _sultsMem = JSON.parse(fs.readFileSync(SULTS_CACHE_FILE, 'utf8'));
        _sultsCacheAt = Date.now();
        return _sultsMem;
    } catch { return null; }
}
function salvarCacheSults(dados) {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        const payload = { ...dados, _at: new Date().toISOString() };
        fs.writeFileSync(SULTS_CACHE_FILE, JSON.stringify(payload, null, 2));
        _sultsMem = payload; _sultsCacheAt = Date.now();
    } catch (e) { console.error('[sults] cache write:', e.message); }
}
function normalizarPessoa(p) {
    const empresa = (p.empresa || []).find(e => e.id === DIVINO_FOGAO_ID) || (p.empresa || [])[0] || {};
    const celular = (p.celular || [])[0] || (p.telefone || [])[0] || '';
    return { id: p.id, nome: p.nome || '', thumbnail: p.thumbnail || '', cargo: empresa.cargo?.nome || '', unidade: empresa.nomeFantasia || '', setor: empresa.cargo?.nome || '', contato: celular, celular, email: (p.email || [])[0] || '' };
}
async function sincronizarSults() {
    const todas = []; let page = 0, continua = true;
    while (continua) {
        const res = await fetch(`${SULTS_BASE}/pessoas?start=${page}&limit=${SULTS_LIMIT}`, { headers: { 'Authorization': SULTS_TOKEN } });
        if (!res.ok) throw new Error(`SULTS ${res.status}`);
        const lote = await res.json();
        if (!Array.isArray(lote) || !lote.length) { continua = false; }
        else { todas.push(...lote); if (lote.length < SULTS_LIMIT) continua = false; else page++; }
    }
    const doDivino = todas.filter(p => (p.empresa || []).some(e => e.id === DIVINO_FOGAO_ID));
    const pessoas  = doDivino.map(normalizarPessoa);
    salvarCacheSults({ pessoas, total: pessoas.length, sincronizadoEm: new Date().toISOString() });
    return pessoas;
}
async function inicializarSults() {
    try {
        const c = lerCacheSults();
        if (c?.pessoas?.length) { console.log(`[sults] Cache: ${c.pessoas.length} colaboradores`); return; }
        await sincronizarSults();
    } catch (e) { console.warn('[sults] init falhou:', e.message); }
}
function buscarPessoasLocal(q) {
    const c = lerCacheSults();
    if (!c?.pessoas) return [];
    if (!q) return c.pessoas.slice(0, 50);
    const t = norm(q);
    return c.pessoas.filter(p => norm(p.nome).includes(t)).slice(0, 30);
}
function parsePessoasXlsx(buffer) {
    const XLSX = require('xlsx');
    const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return rows.slice(1).filter(r => r[4]).map(r => ({
        id: r[3] || null, nome: String(r[4] || '').trim(),
        unidadeId: r[0] || null, unidade: String(r[1] || '').trim(),
        setor: String(r[21] || '').trim(), cargo: String(r[21] || '').trim(),
        contato: String(r[17] || '').trim(), celular: String(r[17] || '').trim(),
        email: String(r[18] || '').trim(), thumbnail: '',
    }));
}

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS
// ══════════════════════════════════════════════════════════════════════════════

// GET /controle-equipamentos
router.get('/', (req, res) => {
    try {
        const c = lerCache();
        if (!c) return res.json({ ok: false, erro: 'Sem dados. Clique em Sincronizar.' });
        res.json({ ok: true, equipamentos: c.equipamentos || [], stats: c.stats || {}, sincronizadoEm: c.sincronizadoEm });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// POST /controle-equipamentos/sincronizar
router.post('/sincronizar', async (req, res) => {
    try {
        const d    = await sincronizar();
        const hist = await sincronizarHistorico();
        res.json({ ok: true, total: d.equipamentos.length, totalHistorico: hist.length, sincronizadoEm: d.sincronizadoEm });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// GET /controle-equipamentos/historico/:funcionario — histórico de um funcionário
router.get('/historico/:funcionario', (req, res) => {
    try {
        const c = lerCacheHist();
        const q = norm(req.params.funcionario);
        const itens = (c.historico || []).filter(i => norm(i.funcionario).includes(q));
        res.json({ ok: true, funcionario: req.params.funcionario, itens, total: itens.length });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// GET /controle-equipamentos/historico-stats — stats do histórico para o card
router.get('/historico-stats', (req, res) => {
    try {
        const c = lerCacheHist();
        const hist = c.historico || [];
        const totalRestituido = hist.reduce((s, i) => s + (i.valorCobrado || 0), 0);
        const pagos    = hist.filter(i => i.pagoPeloFuncionario === 'Sim').length;
        const naoPagos = hist.filter(i => i.pagoPeloFuncionario !== 'Sim').length;
        res.json({ ok: true, totalTrocas: hist.length, totalRestituido, totalRestituidoFormatado: fmtValor(totalRestituido), pagos, naoPagos });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// GET /controle-equipamentos/funcionario/:nome
router.get('/funcionario/:nome', (req, res) => {
    try {
        const c = lerCache();
        if (!c) return res.json({ ok: false, erro: 'Sem dados.' });
        const q     = norm(req.params.nome);
        const itens = c.equipamentos.filter(i => norm(i.funcionario).includes(q));
        res.json({ ok: true, funcionario: req.params.nome, itens, total: itens.length });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// POST /controle-equipamentos/inserir
router.post('/inserir', async (req, res) => {
    try {
        const linha = await inserirLinha(req.body);
        _mem = null;
        res.json({ ok: true, linha });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// POST /controle-equipamentos/sults/...
router.get('/sults/pessoas', (req, res) => {
    try {
        const pessoas = buscarPessoasLocal(req.query.q || '');
        res.json({ ok: true, pessoas, total: pessoas.length });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});
router.post('/sults/sincronizar', async (req, res) => {
    try { const pessoas = await sincronizarSults(); res.json({ ok: true, total: pessoas.length }); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});
router.get('/sults/status', (req, res) => {
    const c = lerCacheSults();
    res.json({ ok: !!c, total: c?.total || 0, sincronizadoEm: c?.sincronizadoEm || null });
});
router.post('/sults/upload', upload.single('arquivo'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' });
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!['.xlsx', '.xls'].includes(ext)) return res.status(400).json({ ok: false, erro: 'Envie .xlsx ou .xls.' });
        const pessoas = parsePessoasXlsx(req.file.buffer);
        if (!pessoas.length) return res.status(400).json({ ok: false, erro: 'Nenhuma pessoa encontrada.' });
        salvarCacheSults({ pessoas, total: pessoas.length, sincronizadoEm: new Date().toISOString(), fonte: 'xlsx_upload', arquivo: req.file.originalname });
        res.json({ ok: true, total: pessoas.length });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// POST /controle-equipamentos/importar-colaboradores
router.post('/importar-colaboradores', upload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado.' });
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!['.xlsx', '.xls'].includes(ext)) return res.status(400).json({ ok: false, erro: 'Envie .xlsx ou .xls.' });
        const pessoasNovas = parsePessoasXlsx(req.file.buffer);
        if (!pessoasNovas.length) return res.status(400).json({ ok: false, erro: 'Nenhuma pessoa encontrada.' });
        _mem = null;
        const dadosAtuais     = await sincronizar();
        const listaAtual      = dadosAtuais.equipamentos || [];
        const nomesNaPlanilha = new Set(listaAtual.map(i => norm(i.funcionario)));
        const novos           = pessoasNovas.filter(p => !nomesNaPlanilha.has(norm(p.nome)));
        const hoje            = new Date().toLocaleDateString('pt-BR');
        for (const p of novos) {
            await inserirLinha({ etiqueta: '', funcionario: p.nome, setor: p.setor || p.cargo || '', contato: p.contato || '', local: p.unidade || '', tipoAparelho: '', modelo: '', numSerie: '', dtEntrega: '', estadoEntrega: '', assinouComodato: 'Não', statusAtual: 'Sem equipamento', dtDevolucao: '', estadoDevolucao: '', valor: '', valorCobrado: '', motivoDevTroca: '', obs: '', dtImportacao: hoje });
        }
        salvarCacheSults({ pessoas: pessoasNovas, total: pessoasNovas.length, sincronizadoEm: new Date().toISOString(), fonte: 'xlsx_upload', arquivo: req.file.originalname });
        _mem = null;
        const dadosFinais = await sincronizar();
        res.json({ ok: true, adicionados: novos.length, jaExistiam: listaAtual.length, total: pessoasNovas.length, sincronizadoEm: dadosFinais.sincronizadoEm, equipamentos: dadosFinais.equipamentos, stats: dadosFinais.stats });
    } catch (e) {
        console.error('[importar-colaboradores] erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ── PATCH /:rowIndex — atualizar campos
router.patch('/:rowIndex', async (req, res) => {
    try {
        const row = parseInt(req.params.rowIndex);
        if (isNaN(row) || row < ABA.inicio) return res.status(400).json({ ok: false, erro: 'rowIndex inválido.' });
        await atualizarLinha(row, req.body);
        patchCache(row, req.body);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// POST /:rowIndex/trocar — registra histórico e atualiza linha com novo equipamento
router.post('/:rowIndex/trocar', async (req, res) => {
    try {
        const row = parseInt(req.params.rowIndex);
        if (isNaN(row) || row < ABA.inicio) return res.status(400).json({ ok: false, erro: 'rowIndex inválido.' });

        const {
            // Dados da devolução do equipamento atual
            motivoDevolucao, estadoDevolucao, valorCobrado, pagoPeloFuncionario, obsDevolucao,
            // Dados do novo equipamento
            novaEtiqueta, novoTipo, novoModelo, novoNumSerie, novoLocal,
            novoValor, novoEstadoEntrega, novoAssinouComodato, novaObs,
        } = req.body;

        // 1. Busca o item atual no cache
        const cache = lerCache();
        const itemAtual = (cache?.equipamentos || []).find(i => i.rowIndex === row);
        if (!itemAtual) return res.status(404).json({ ok: false, erro: 'Registro não encontrado.' });

        // 2. Registra o equipamento atual no HISTÓRICO (apenas se tiver equipamento)
        if (itemAtual.tipoAparelho || itemAtual.modelo || itemAtual.etiqueta) {
            itemAtual.estadoDevolucao = estadoDevolucao || '';
            await inserirHistorico(itemAtual, motivoDevolucao, valorCobrado, pagoPeloFuncionario, obsDevolucao);
            _memHist = null; // limpa cache do histórico
        }

        // 3. Atualiza a linha com o novo equipamento
        const hoje = new Date().toLocaleDateString('pt-BR');
        const novosCampos = {
            etiqueta:        novaEtiqueta        || '',
            tipoAparelho:    novoTipo            || '',
            modelo:          novoModelo          || '',
            numSerie:        novoNumSerie        || '',
            local:           novoLocal           || '',
            dtEntrega:       hoje,
            valor:           novoValor           || '',
            estadoEntrega:   novoEstadoEntrega   || '',
            assinouComodato: novoAssinouComodato || 'Não',
            statusAtual:     novoTipo ? 'Funcionando' : 'Sem equipamento',
            dtDevolucao:     '',
            estadoDevolucao: '',
            valorCobrado:    '',
            motivoDevTroca:  '',
            obs:             novaObs             || '',
        };
        await atualizarLinha(row, novosCampos);
        patchCache(row, novosCampos);

        res.json({ ok: true, dtEntrega: hoje });
    } catch (e) {
        console.error('[controleEquip] trocar:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// POST /:rowIndex/devolver
router.post('/:rowIndex/devolver', async (req, res) => {
    try {
        const row    = parseInt(req.params.rowIndex);
        const cache  = lerCache();
        const itemAtual = (cache?.equipamentos || []).find(i => i.rowIndex === row);

        // Registra no histórico se tiver equipamento
        if (itemAtual && (itemAtual.tipoAparelho || itemAtual.modelo)) {
            itemAtual.estadoDevolucao = req.body.estadoDevolucao || '';
            await inserirHistorico(itemAtual, req.body.motivo, req.body.valorCobrado, req.body.pagoPeloFuncionario, req.body.obs);
            _memHist = null;
        }

        const hoje   = new Date().toLocaleDateString('pt-BR');
        const campos = {
            dtDevolucao:     hoje,
            estadoDevolucao: req.body.estadoDevolucao || '',
            motivoDevTroca:  req.body.motivo          || '',
            valorCobrado:    req.body.valorCobrado     || '',
            statusAtual:     'Aguardando descarte',
            obs:             req.body.obs             || '',
            // Limpa os campos do equipamento pois foi devolvido
            tipoAparelho:    '',
            modelo:          '',
            numSerie:        '',
            etiqueta:        '',
            local:           '',
            dtEntrega:       '',
            valor:           '',
        };
        await atualizarLinha(row, campos);
        patchCache(row, campos);
        res.json({ ok: true, dtDevolucao: hoje });
    } catch (e) {
        console.error('[controleEquip] devolver:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

module.exports = router;
module.exports.inicializarSults = inicializarSults;
module.exports.sincronizarHistorico = sincronizarHistorico;