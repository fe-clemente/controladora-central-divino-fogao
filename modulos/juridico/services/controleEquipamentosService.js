// services/controleEquipamentosService.js — Divino Fogão T.I.
// MULTI-EQUIPAMENTO + GOOGLE DRIVE + LOG DE AÇÕES + EXCLUSÃO
'use strict';

const express    = require('express');
const router     = express.Router();
const { google } = require('googleapis');
const fs         = require('fs');
const path       = require('path');
const multer     = require('multer');
const stream     = require('stream');

// ─── Auth ─────────────────────────────────────────────────────────────────────
function getAuth() {
    const keyFile = process.env.GOOGLE_KEY_FILE || './minha-chave.json';
    const keyPath = path.isAbsolute(keyFile) ? keyFile : path.join(process.cwd(), keyFile);
    return new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: [
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/spreadsheets',
        ],
    });
}

const SD = {
    supportsAllDrives:         true,
    includeItemsFromAllDrives: true,
};

function getDriveClient() {
    return google.drive({ version: 'v3', auth: getAuth() });
}
async function getSheets() {
    return google.sheets({ version: 'v4', auth: getAuth() });
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
});

// ─── CONFIGURAÇÃO ─────────────────────────────────────────────────────────────
const SHEET_ID             = process.env.ATIVOS_SHEET_ID || '';
const DRIVE_ROOT_FOLDER_ID = process.env.DRIVE_EQUIPAMENTOS_FOLDER_ID || '';

const ABA = {
    nome:   'CONTROLE T.I',
    inicio: 2,
    colunas: {
        etiqueta:        0,  // A
        funcionario:     1,  // B
        setor:           2,  // C
        contato:         3,  // D
        tipoAparelho:    4,  // E
        modelo:          5,  // F
        local:           6,  // G
        dtEntrega:       7,  // H
        valor:           8,  // I
        estadoEntrega:   9,  // J
        assinouComodato: 10, // K
        numSerie:        11, // L
        statusAtual:     12, // M
        dtDevolucao:     13, // N
        estadoDevolucao: 14, // O
        valorCobrado:    15, // P
        motivoDevTroca:  16, // Q
        obs:             17, // R
        driveLink:       18, // S
        dtImportacao:    19, // T
    },
};

const ABA_HIST    = { nome: 'CONTROLE T.I HISTORICO', inicio: 2 };

// ─── NOVA ABA: LOG DE AÇÕES ────────────────────────────────────────────────────
// Colunas: A=DataHora, B=Usuário, C=Ação, D=Funcionário, E=Equipamento,
//          F=Etiqueta, G=Detalhes, H=IP, I=RowIndex
const ABA_LOG = { nome: 'log_acoes', inicio: 2 };

const COL_MAP = {
    etiqueta:        'A', funcionario:     'B', setor:           'C',
    contato:         'D', tipoAparelho:    'E', modelo:          'F',
    local:           'G', dtEntrega:       'H', valor:           'I',
    estadoEntrega:   'J', assinouComodato: 'K', numSerie:        'L',
    statusAtual:     'M', dtDevolucao:     'N', estadoDevolucao: 'O',
    valorCobrado:    'P', motivoDevTroca:  'Q', obs:             'R',
    driveLink:       'S', dtImportacao:    'T',
};

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_DIR = path.join(__dirname, '../../ti/cache');
const CACHE_FILE       = path.join(CACHE_DIR, 'controle_equipamentos_cache.json');
const CACHE_HIST       = path.join(CACHE_DIR, 'controle_historico_cache.json');
const CACHE_DRIVE_FILE = path.join(CACHE_DIR, 'drive_pastas_equip_cache.json');
const CACHE_LOG_FILE   = path.join(CACHE_DIR, 'controle_log_cache.json');

let _mem = null, _memHist = null, _memDrive = null, _memLog = null;

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
    } catch (e) { console.error('[controleEquip] cache write:', e.message); }
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
    } catch (e) { console.error('[historico] cache write:', e.message); }
}
function lerCacheDrive() {
    if (_memDrive) return _memDrive;
    try {
        if (!fs.existsSync(CACHE_DRIVE_FILE)) { _memDrive = {}; return _memDrive; }
        _memDrive = JSON.parse(fs.readFileSync(CACHE_DRIVE_FILE, 'utf8'));
        return _memDrive;
    } catch { _memDrive = {}; return _memDrive; }
}
function salvarCacheDrive() {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(CACHE_DRIVE_FILE, JSON.stringify(_memDrive || {}, null, 2));
    } catch (e) { console.error('[drive] cache write:', e.message); }
}
function lerCacheLog() {
    if (_memLog) return _memLog;
    try {
        if (!fs.existsSync(CACHE_LOG_FILE)) { _memLog = { logs: [] }; return _memLog; }
        _memLog = JSON.parse(fs.readFileSync(CACHE_LOG_FILE, 'utf8'));
        return _memLog;
    } catch { _memLog = { logs: [] }; return _memLog; }
}
function salvarCacheLog(dados) {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(CACHE_LOG_FILE, JSON.stringify(dados, null, 2));
        _memLog = dados;
    } catch (e) { console.error('[log] cache write:', e.message); }
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
const get  = (row, idx) => (idx !== undefined && row[idx] !== undefined) ? row[idx].toString().trim() : '';
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();

function normalizarNomePasta(nome) {
    return (nome || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[<>:"/\\|?*]/g,'')
        .replace(/\s+/g,' ').trim().substring(0,100);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG DE AÇÕES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrai o usuário logado da requisição.
 * Adapte conforme seu sistema de autenticação (session, JWT, etc.).
 */
function extrairUsuario(req) {
    // Tenta pegar do session (express-session / passport)
    if (req.user) {
        return req.user.nome || req.user.name || req.user.email || req.user.username || 'Usuário';
    }
    if (req.session && req.session.usuario) {
        return req.session.usuario.nome || req.session.usuario.email || 'Usuário';
    }
    // Header customizado (fallback para dev/proxy)
    if (req.headers['x-usuario']) return req.headers['x-usuario'];
    return 'Sistema';
}

function extrairIP(req) {
    return (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip || '').split(',')[0].trim();
}

/**
 * Registra uma ação na aba log_acoes da planilha e no cache local.
 * @param {Object} params
 * @param {string} params.usuario
 * @param {string} params.acao        — ex: 'INSERIU', 'EDITOU', 'EXCLUIU', 'DEVOLVEU', 'TROCOU', 'IMPORTOU'
 * @param {string} params.funcionario
 * @param {string} params.equipamento — ex: 'Notebook Dell Inspiron'
 * @param {string} params.etiqueta
 * @param {string} params.detalhes    — texto livre com contexto adicional
 * @param {string} params.ip
 * @param {number} params.rowIndex
 */
async function registrarLog({ usuario, acao, funcionario, equipamento, etiqueta, detalhes, ip, rowIndex }) {
    const agora    = new Date();
    const dataHora = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const entrada  = {
        dataHora, usuario: usuario || 'Sistema', acao: acao || '—',
        funcionario: funcionario || '—',
        equipamento: equipamento || '—',
        etiqueta:    etiqueta    || '—',
        detalhes:    detalhes    || '',
        ip:          ip          || '—',
        rowIndex:    rowIndex    || '',
    };

    // 1. Persiste no cache local (imediato)
    const cacheLog = lerCacheLog();
    cacheLog.logs = cacheLog.logs || [];
    cacheLog.logs.unshift(entrada); // mais recente primeiro
    if (cacheLog.logs.length > 2000) cacheLog.logs = cacheLog.logs.slice(0, 2000);
    salvarCacheLog(cacheLog);

    // 2. Grava na planilha (assíncrono, não bloqueia a resposta)
    setImmediate(async () => {
        try {
            const sheets = await getSheets();

            // Garante que a aba existe; se não, cria com cabeçalho
            let existeAba = false;
            try {
                const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
                existeAba = (meta.data.sheets || []).some(s => s.properties.title === ABA_LOG.nome);
            } catch {}

            if (!existeAba) {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SHEET_ID,
                    requestBody: {
                        requests: [{
                            addSheet: {
                                properties: { title: ABA_LOG.nome, gridProperties: { frozenRowCount: 1 } },
                            },
                        }],
                    },
                });
                // Cabeçalho
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SHEET_ID,
                    range: `'${ABA_LOG.nome}'!A1:I1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [['Data/Hora', 'Usuário', 'Ação', 'Funcionário', 'Equipamento', 'Etiqueta', 'Detalhes', 'IP', 'Linha Planilha']] },
                });
            }

            // Busca próxima linha
            let proximaLinha = 2;
            try {
                const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${ABA_LOG.nome}'!A:A` });
                proximaLinha = Math.max((r.data.values || []).length + 1, 2);
            } catch {}

            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `'${ABA_LOG.nome}'!A${proximaLinha}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[
                    entrada.dataHora,
                    entrada.usuario,
                    entrada.acao,
                    entrada.funcionario,
                    entrada.equipamento,
                    entrada.etiqueta,
                    entrada.detalhes,
                    entrada.ip,
                    entrada.rowIndex,
                ]] },
            });
            console.log(`[log_acoes] ${entrada.acao} · ${entrada.usuario} · ${entrada.funcionario}`);
        } catch (e) {
            console.error('[log_acoes] Erro ao gravar na planilha:', e.message);
        }
    });
}

// ─── GOOGLE DRIVE ─────────────────────────────────────────────────────────────
async function obterOuCriarPasta(nomeFuncionario) {
    if (!DRIVE_ROOT_FOLDER_ID)
        throw new Error('DRIVE_EQUIPAMENTOS_FOLDER_ID não configurado no .env');

    const drive     = getDriveClient();
    const chave     = norm(nomeFuncionario);
    const nomePasta = normalizarNomePasta(nomeFuncionario);
    const cache     = lerCacheDrive();

    if (cache[chave]) {
        console.log(`[drive-equip] Cache hit: ${cache[chave].nome}`);
        return cache[chave];
    }

    console.log(`[drive-equip] Buscando pasta "${nomePasta}" em "${DRIVE_ROOT_FOLDER_ID}"...`);
    const res = await drive.files.list({
        q:      `mimeType='application/vnd.google-apps.folder' and '${DRIVE_ROOT_FOLDER_ID}' in parents and name='${nomePasta.replace(/'/g,"\\'")}' and trashed=false`,
        fields: 'files(id,name,webViewLink)',
        ...SD,
    });

    let pasta;
    if (res.data.files && res.data.files.length > 0) {
        const f = res.data.files[0];
        pasta = { id: f.id, nome: f.name, link: f.webViewLink };
    } else {
        const created = await drive.files.create({
            requestBody: {
                name:     nomePasta,
                mimeType: 'application/vnd.google-apps.folder',
                parents:  [DRIVE_ROOT_FOLDER_ID],
            },
            fields: 'id,name,webViewLink',
            ...SD,
        });
        pasta = { id: created.data.id, nome: created.data.name, link: created.data.webViewLink };
        console.log(`[drive-equip] Pasta criada: ${pasta.nome} (${pasta.id})`);
    }

    _memDrive[chave] = pasta;
    salvarCacheDrive();
    return pasta;
}

async function listarFotosPasta(pastaId) {
    const drive = getDriveClient();
    try {
        const res = await drive.files.list({
            q:        `'${pastaId}' in parents and mimeType contains 'image/' and trashed=false`,
            fields:   'files(id,name,webViewLink,thumbnailLink,createdTime)',
            orderBy:  'createdTime desc',
            pageSize: 50,
            ...SD,
        });
        return (res.data.files || []).map(f => ({
            id: f.id, nome: f.name,
            webViewLink: f.webViewLink,
            thumbnailLink: f.thumbnailLink,
            link: f.webViewLink,
        }));
    } catch (e) {
        console.warn('[drive-equip] listarFotos falhou:', e.message);
        return [];
    }
}

async function uploadFotoDrive(pastaId, nomeArquivo, mimetype, buffer) {
    const drive     = getDriveClient();
    const ext       = path.extname(nomeArquivo) || '.jpg';
    const baseName  = path.basename(nomeArquivo, ext);
    const timestamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const nomeUnico = `${baseName}_${timestamp}${ext}`;
    const bufStream = new stream.PassThrough();
    bufStream.end(buffer);

    const res = await drive.files.create({
        requestBody: { name: nomeUnico, parents: [pastaId] },
        media:       { mimeType: mimetype, body: bufStream },
        fields:      'id,name,webViewLink',
        ...SD,
    });
    return { id: res.data.id, nome: res.data.name, webViewLink: res.data.webViewLink };
}

async function gravarDriveLinkNasPlanilhas(nomeFuncionario, driveLink) {
    const cache = lerCache();
    if (!cache || !cache.equipamentos) return;
    const linhas = cache.equipamentos
        .filter(e => norm(e.funcionario) === norm(nomeFuncionario))
        .map(e => e.rowIndex);
    if (!linhas.length) return;
    const sheets = await getSheets();
    const data   = linhas.map(row => ({ range: `'${ABA.nome}'!S${row}`, values: [[driveLink]] }));
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody:   { valueInputOption: 'USER_ENTERED', data },
    }).catch(e => console.warn('[drive-equip] gravarLink falhou:', e.message));
}

// ─── Parsers ──────────────────────────────────────────────────────────────────
function parseEquipamentos(rows) {
    if (!rows || !rows.length) return [];
    const drivePastas = lerCacheDrive();
    let descartadas   = 0;
    const resultado   = rows.slice(ABA.inicio - 1).map((row, i) => {
        const c           = ABA.colunas;
        const funcionario = get(row, c.funcionario);
        const etiqueta    = get(row, c.etiqueta);
        if (!funcionario && !etiqueta) { descartadas++; return null; }
        const valor        = parseValor(get(row, c.valor));
        const valorCobrado = parseValor(get(row, c.valorCobrado));
        const chave        = norm(funcionario);
        const pastaCache   = drivePastas[chave];
        const pastaLink    = pastaCache?.link || get(row, c.driveLink) || '';
        return {
            rowIndex: i + ABA.inicio,
            etiqueta, funcionario: funcionario || '(sem nome)',
            setor:           get(row, c.setor),
            contato:         get(row, c.contato),
            tipoAparelho:    get(row, c.tipoAparelho),
            modelo:          get(row, c.modelo),
            local:           get(row, c.local),
            dtEntrega:       parseData(get(row, c.dtEntrega)),
            dtEntregaOriginal: get(row, c.dtEntrega),
            valor, valorFormatado: fmtValor(valor),
            estadoEntrega:   get(row, c.estadoEntrega),
            assinouComodato: get(row, c.assinouComodato) || 'Não',
            numSerie:        get(row, c.numSerie),
            statusAtual:     get(row, c.statusAtual) || 'Sem equipamento',
            dtDevolucao:     parseData(get(row, c.dtDevolucao)),
            dtDevolucaoOriginal: get(row, c.dtDevolucao),
            estadoDevolucao: get(row, c.estadoDevolucao),
            valorCobrado, valorCobradoFormatado: fmtValor(valorCobrado),
            motivoDevTroca:  get(row, c.motivoDevTroca),
            obs:             get(row, c.obs),
            dtImportacao:    get(row, c.dtImportacao),
            driveLink:       pastaLink,
            pastaId:         pastaCache?.id || null,
            pastaLink,
            totalFotos:      0,
        };
    }).filter(Boolean);
    console.log(`[controleEquip] ${resultado.length} linhas | ${descartadas} descartadas`);
    return resultado;
}

function parseHistorico(rows) {
    if (!rows || rows.length < 2) return [];
    return rows.slice(1).map((row, i) => {
        if (!get(row,1)) return null;
        const valor        = parseValor(get(row,12));
        const valorCobrado = parseValor(get(row,13));
        return {
            rowIndex: i+2, dataRegistro: get(row,0), funcionario: get(row,1),
            setor: get(row,2), etiqueta: get(row,3), tipoAparelho: get(row,4),
            modelo: get(row,5), numSerie: get(row,6), local: get(row,7),
            dtEntrega: get(row,8), dtDevolucao: get(row,9),
            estadoDevolucao: get(row,10), motivo: get(row,11),
            valor, valorFormatado: fmtValor(valor),
            valorCobrado, valorCobradoFormatado: fmtValor(valorCobrado),
            pagoPeloFuncionario: get(row,14) || 'Não', obs: get(row,15),
        };
    }).filter(Boolean);
}

function calcStats(lista) {
    const valorTotal = lista.reduce((s,i) => s+(i.valor||0), 0);
    const n = s => norm(s);
    return {
        total: lista.length, valorTotal,
        valorTotalFormatado: fmtValor(valorTotal) || '—',
        emUso:       lista.filter(i => ['funcionando','novo','em uso','sem equipamento'].includes(n(i.statusAtual))).length,
        manutencao:  lista.filter(i => n(i.statusAtual).includes('manut')).length,
        desligados:  lista.filter(i => n(i.statusAtual).includes('deslig')).length,
        semComodato: lista.filter(i => i.assinouComodato !== 'Sim' && (i.tipoAparelho||i.modelo)).length,
    };
}

async function sincronizar() {
    console.log('[controleEquip] Sincronizando:', ABA.nome);
    const sheets = await getSheets();
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${ABA.nome}'` });
    const equipamentos = parseEquipamentos(r.data.values || []);
    const stats        = calcStats(equipamentos);
    const dados        = { equipamentos, stats, sincronizadoEm: new Date().toISOString() };
    salvarCache(dados);
    return dados;
}

async function sincronizarHistorico() {
    const sheets = await getSheets();
    try {
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${ABA_HIST.nome}'` });
        const historico = parseHistorico(r.data.values || []);
        salvarCacheHist({ historico, sincronizadoEm: new Date().toISOString() });
        return historico;
    } catch (e) { console.warn('[historico] Falha:', e.message); return []; }
}

async function sincronizarLog() {
    const sheets = await getSheets();
    try {
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${ABA_LOG.nome}'` });
        const rows = (r.data.values || []).slice(1); // pula cabeçalho
        const logs = rows.reverse().map((row, i) => ({ // mais recente primeiro
            dataHora:    row[0] || '',
            usuario:     row[1] || '',
            acao:        row[2] || '',
            funcionario: row[3] || '',
            equipamento: row[4] || '',
            etiqueta:    row[5] || '',
            detalhes:    row[6] || '',
            ip:          row[7] || '',
            rowIndex:    row[8] || '',
        }));
        salvarCacheLog({ logs, sincronizadoEm: new Date().toISOString() });
        return logs;
    } catch (e) {
        console.warn('[log_acoes] Falha ao sincronizar:', e.message);
        return [];
    }
}

async function inserirLinha(body) {
    const sheets = await getSheets();
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${ABA.nome}'` });
    const proximaLinha = Math.max((r.data.values||[]).length + 1, ABA.inicio);
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `'${ABA.nome}'!A${proximaLinha}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[
            body.etiqueta||'', body.funcionario||'', body.setor||'', body.contato||'',
            body.tipoAparelho||'', body.modelo||'', body.local||'', body.dtEntrega||'',
            body.valor||'', body.estadoEntrega||'', body.assinouComodato||'Não',
            body.numSerie||'', body.statusAtual||'Sem equipamento', body.dtDevolucao||'',
            body.estadoDevolucao||'', body.valorCobrado||'', body.motivoDevTroca||'',
            body.obs||'', body.driveLink||'', body.dtImportacao||'',
        ]] },
    });
    return proximaLinha;
}

async function atualizarLinha(rowIndex, body) {
    const sheets = await getSheets();
    const data = Object.entries(COL_MAP)
        .filter(([k]) => body[k] !== undefined && body[k] !== null)
        .map(([k, col]) => ({ range: `'${ABA.nome}'!${col}${rowIndex}`, values: [[body[k]]] }));
    if (!data.length) return;
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
}

/**
 * Apaga o conteúdo de uma linha na planilha (limpa as células, sem deletar a linha física).
 * A linha fica em branco e é ignorada pelo parser na próxima sincronização.
 */
async function limparLinha(rowIndex) {
    const sheets = await getSheets();
    // Limpa colunas A a T (todas as colunas mapeadas)
    await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `'${ABA.nome}'!A${rowIndex}:T${rowIndex}`,
    });
}

async function inserirHistorico(item, motivo, valorCobrado, pagoPeloFuncionario, obs) {
    const sheets = await getSheets();
    let proximaLinha = 2;
    try {
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${ABA_HIST.nome}'` });
        proximaLinha = Math.max((r.data.values||[]).length + 1, 2);
    } catch {}
    const hoje = new Date().toLocaleDateString('pt-BR');
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `'${ABA_HIST.nome}'!A${proximaLinha}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[
            hoje, item.funcionario||'', item.setor||'', item.etiqueta||'',
            item.tipoAparelho||'', item.modelo||'', item.numSerie||'',
            item.local||'', item.dtEntregaOriginal||'', hoje,
            item.estadoDevolucao||'', motivo||'',
            item.valor > 0 ? item.valorFormatado : '',
            valorCobrado||'', pagoPeloFuncionario||'Não', obs||'',
        ]] },
    });
    return proximaLinha;
}

function patchCache(rowIndex, campos) {
    const c = lerCache();
    if (!c || !c.equipamentos) return;
    const idx = c.equipamentos.findIndex(i => i.rowIndex === rowIndex);
    if (idx < 0) return;
    Object.assign(c.equipamentos[idx], campos);
    if (campos.valor !== undefined) {
        const v = parseValor(campos.valor);
        c.equipamentos[idx].valor          = v;
        c.equipamentos[idx].valorFormatado = fmtValor(v);
    }
    c.stats = calcStats(c.equipamentos);
    salvarCache(c);
}

function removerDoCache(rowIndex) {
    const c = lerCache();
    if (!c || !c.equipamentos) return;
    c.equipamentos = c.equipamentos.filter(i => i.rowIndex !== rowIndex);
    c.stats = calcStats(c.equipamentos);
    salvarCache(c);
}

// ─── SULTS ────────────────────────────────────────────────────────────────────
const SULTS_BASE       = 'https://api.sults.com.br/v1';
const SULTS_TOKEN      = process.env.SULTS_TOKEN || '';
const SULTS_LIMIT      = 100;
const DIVINO_FOGAO_ID  = process.env.SULTS_EMPRESA_ID ? parseInt(process.env.SULTS_EMPRESA_ID) : 65;
const SULTS_CACHE_FILE = path.join(CACHE_DIR, 'sults_pessoas_cache.json');
const SULTS_TTL_MS     = 30 * 60 * 1000;
let _sultsMem = null, _sultsCacheAt = 0;

function lerCacheSults() {
    if (_sultsMem && (Date.now()-_sultsCacheAt) < SULTS_TTL_MS) return _sultsMem;
    try {
        if (!fs.existsSync(SULTS_CACHE_FILE)) return null;
        _sultsMem    = JSON.parse(fs.readFileSync(SULTS_CACHE_FILE,'utf8'));
        _sultsCacheAt = Date.now();
        return _sultsMem;
    } catch { return null; }
}
function salvarCacheSults(dados) {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR,{recursive:true});
        const payload = { ...dados, _at: new Date().toISOString() };
        fs.writeFileSync(SULTS_CACHE_FILE, JSON.stringify(payload,null,2));
        _sultsMem = payload; _sultsCacheAt = Date.now();
    } catch (e) { console.error('[sults] cache write:',e.message); }
}
function normalizarPessoa(p) {
    const empresa = (p.empresa||[]).find(e=>e.id===DIVINO_FOGAO_ID)||(p.empresa||[])[0]||{};
    const celular  = (p.celular||[])[0]||(p.telefone||[])[0]||'';
    return { id:p.id, nome:p.nome||'', thumbnail:p.thumbnail||'',
        cargo:empresa.cargo?.nome||'', unidade:empresa.nomeFantasia||'',
        setor:empresa.cargo?.nome||'', contato:celular, celular,
        email:(p.email||[])[0]||'' };
}
async function sincronizarSults() {
    const todas=[]; let page=0, continua=true;
    while(continua) {
        const res = await fetch(`${SULTS_BASE}/pessoas?start=${page}&limit=${SULTS_LIMIT}`,{ headers:{'Authorization':SULTS_TOKEN} });
        if(!res.ok) throw new Error(`SULTS ${res.status}`);
        const lote = await res.json();
        if(!Array.isArray(lote)||!lote.length){continua=false;}
        else{todas.push(...lote); if(lote.length<SULTS_LIMIT)continua=false; else page++;}
    }
    const pessoas = todas.filter(p=>(p.empresa||[]).some(e=>e.id===DIVINO_FOGAO_ID)).map(normalizarPessoa);
    salvarCacheSults({pessoas, total:pessoas.length, sincronizadoEm:new Date().toISOString()});
    return pessoas;
}
async function inicializarSults() {
    try {
        const c = lerCacheSults();
        if(c?.pessoas?.length){ console.log(`[sults] Cache: ${c.pessoas.length}`); return; }
        await sincronizarSults();
    } catch(e){ console.warn('[sults] init falhou:',e.message); }
}
function buscarPessoasLocal(q) {
    const c = lerCacheSults();
    if(!c?.pessoas) return [];
    if(!q) return c.pessoas.slice(0,50);
    const t = norm(q);
    return c.pessoas.filter(p=>norm(p.nome).includes(t)).slice(0,30);
}
function parsePessoasXlsx(buffer) {
    const XLSX = require('xlsx');
    const wb   = XLSX.read(buffer,{type:'buffer',cellDates:true});
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
    return rows.slice(1).filter(r=>r[4]).map(r=>({
        id:r[3]||null, nome:String(r[4]||'').trim(),
        unidadeId:r[0]||null, unidade:String(r[1]||'').trim(),
        setor:String(r[21]||'').trim(), cargo:String(r[21]||'').trim(),
        contato:String(r[17]||'').trim(), celular:String(r[17]||'').trim(),
        email:String(r[18]||'').trim(), thumbnail:'',
    }));
}

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS
// ══════════════════════════════════════════════════════════════════════════════

router.get('/', (req, res) => {
    try {
        const c = lerCache();
        if(!c) return res.json({ok:false, erro:'Sem dados. Clique em Sincronizar.'});
        res.json({ok:true, equipamentos:c.equipamentos||[], stats:c.stats||{}, sincronizadoEm:c.sincronizadoEm});
    } catch(e){ res.json({ok:false, erro:e.message}); }
});

router.post('/sincronizar', async (req, res) => {
    try {
        const d    = await sincronizar();
        const hist = await sincronizarHistorico();
        await sincronizarLog();
        res.json({ok:true, total:d.equipamentos.length, totalHistorico:hist.length, sincronizadoEm:d.sincronizadoEm});
    } catch(e){ res.json({ok:false, erro:e.message}); }
});

router.get('/historico/:funcionario', (req, res) => {
    try {
        const c     = lerCacheHist();
        const q     = norm(req.params.funcionario);
        const itens = (c.historico||[]).filter(i=>norm(i.funcionario).includes(q));
        res.json({ok:true, funcionario:req.params.funcionario, itens, total:itens.length});
    } catch(e){ res.json({ok:false, erro:e.message}); }
});

router.get('/historico-stats', (req, res) => {
    try {
        const c    = lerCacheHist();
        const hist = c.historico||[];
        const totalRestituido = hist.reduce((s,i)=>s+(i.valorCobrado||0),0);
        res.json({
            ok:true, totalTrocas:hist.length, totalRestituido,
            totalRestituidoFormatado:fmtValor(totalRestituido),
            pagos:    hist.filter(i=>i.pagoPeloFuncionario==='Sim').length,
            naoPagos: hist.filter(i=>i.pagoPeloFuncionario!=='Sim').length,
        });
    } catch(e){ res.json({ok:false, erro:e.message}); }
});

// ─── ROTAS DE LOG ─────────────────────────────────────────────────────────────

// GET /log — retorna todos os logs (com filtros opcionais)
router.get('/log', (req, res) => {
    try {
        const cache  = lerCacheLog();
        let logs     = cache.logs || [];
        const { q, acao, funcionario, usuario, limite } = req.query;

        if (q) {
            const t = norm(q);
            logs = logs.filter(l =>
                norm(l.funcionario).includes(t) ||
                norm(l.equipamento).includes(t) ||
                norm(l.usuario).includes(t) ||
                norm(l.detalhes).includes(t) ||
                norm(l.acao).includes(t)
            );
        }
        if (acao)        logs = logs.filter(l => norm(l.acao).includes(norm(acao)));
        if (funcionario) logs = logs.filter(l => norm(l.funcionario).includes(norm(funcionario)));
        if (usuario)     logs = logs.filter(l => norm(l.usuario).includes(norm(usuario)));

        const max = parseInt(limite) || 200;
        res.json({ ok: true, logs: logs.slice(0, max), total: logs.length });
    } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// GET /log/funcionario/:nome — logs de um funcionário específico
router.get('/log/funcionario/:nome', (req, res) => {
    try {
        const cache = lerCacheLog();
        const q     = norm(decodeURIComponent(req.params.nome));
        const logs  = (cache.logs || []).filter(l => norm(l.funcionario).includes(q));
        res.json({ ok: true, logs, total: logs.length });
    } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// POST /log/sincronizar — força re-leitura do log da planilha
router.post('/log/sincronizar', async (req, res) => {
    try {
        const logs = await sincronizarLog();
        res.json({ ok: true, total: logs.length });
    } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// ─── DRIVE ────────────────────────────────────────────────────────────────────
router.get('/drive/pasta/:funcionario', async (req, res) => {
    try {
        const nome  = decodeURIComponent(req.params.funcionario);
        const chave = norm(nome);
        const cache = lerCacheDrive();

        if (cache[chave]) {
            const fotos = await listarFotosPasta(cache[chave].id);
            return res.json({ok:true, pasta:cache[chave], fotos, totalFotos:fotos.length});
        }

        if (!DRIVE_ROOT_FOLDER_ID)
            return res.json({ok:true, pasta:null, fotos:[], totalFotos:0});

        const drive     = getDriveClient();
        const nomePasta = normalizarNomePasta(nome);
        const r         = await drive.files.list({
            q:      `mimeType='application/vnd.google-apps.folder' and '${DRIVE_ROOT_FOLDER_ID}' in parents and name='${nomePasta.replace(/'/g,"\\'")}' and trashed=false`,
            fields: 'files(id,name,webViewLink)',
            ...SD,
        });

        if (r.data.files && r.data.files.length > 0) {
            const f     = r.data.files[0];
            const pasta = {id:f.id, nome:f.name, link:f.webViewLink};
            _memDrive[chave] = pasta;
            salvarCacheDrive();
            const fotos = await listarFotosPasta(pasta.id);
            return res.json({ok:true, pasta, fotos, totalFotos:fotos.length});
        }

        res.json({ok:true, pasta:null, fotos:[], totalFotos:0});
    } catch(e) {
        console.error('[drive-equip] pasta GET:', e.message);
        res.json({ok:false, erro:e.message});
    }
});

router.post('/drive/upload-foto', upload.single('foto'), async (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ok:false, erro:'Nenhuma foto enviada.'});
        if (!req.file.mimetype.startsWith('image/'))
            return res.status(400).json({ok:false, erro:'Apenas imagens são aceitas.'});

        const nomeFuncionario = (req.body.funcionario||'').trim();
        const rowIndex        = parseInt(req.body.rowIndex)||0;
        const prefixo         = (req.body.prefixo||'foto').replace(/[<>:"/\\|?*\s]+/g,'_');

        if (!nomeFuncionario)
            return res.status(400).json({ok:false, erro:'Nome do funcionário é obrigatório.'});
        if (!DRIVE_ROOT_FOLDER_ID)
            return res.status(500).json({ok:false, erro:'DRIVE_EQUIPAMENTOS_FOLDER_ID não configurado no .env'});

        const pasta   = await obterOuCriarPasta(nomeFuncionario);
        const ext     = path.extname(req.file.originalname)||'.jpg';
        const arquivo = await uploadFotoDrive(pasta.id, `${prefixo}${ext}`, req.file.mimetype, req.file.buffer);

        gravarDriveLinkNasPlanilhas(nomeFuncionario, pasta.link)
            .catch(e => console.warn('[drive-equip] gravarLink:', e.message));

        if (rowIndex > 0)
            patchCache(rowIndex, {driveLink:pasta.link, pastaLink:pasta.link, pastaId:pasta.id});

        // Log
        const cache   = lerCache();
        const item    = (cache?.equipamentos||[]).find(i=>i.rowIndex===rowIndex);
        await registrarLog({
            usuario:     extrairUsuario(req),
            acao:        'ENVIOU FOTO',
            funcionario: nomeFuncionario,
            equipamento: item ? [item.tipoAparelho, item.modelo].filter(Boolean).join(' ') : '',
            etiqueta:    item?.etiqueta || '',
            detalhes:    `Arquivo: ${arquivo.nome}`,
            ip:          extrairIP(req),
            rowIndex,
        });

        res.json({ok:true, arquivo, pasta});
    } catch(e) {
        console.error('[drive-equip] upload-foto ERRO:', e.message);
        res.status(500).json({ok:false, erro:e.message});
    }
});

// ─── CRUD PRINCIPAL ───────────────────────────────────────────────────────────

router.post('/inserir', async (req, res) => {
    try {
        const chave = norm(req.body.funcionario||'');
        if (chave) {
            const c = lerCacheDrive();
            if (c[chave]) req.body.driveLink = c[chave].link;
        }
        const linha = await inserirLinha(req.body);
        _mem = null;

        const temEquip = !!(req.body.tipoAparelho || req.body.modelo || req.body.etiqueta);
        await registrarLog({
            usuario:     extrairUsuario(req),
            acao:        temEquip ? 'INSERIU EQUIPAMENTO' : 'CADASTROU FUNCIONÁRIO',
            funcionario: req.body.funcionario || '',
            equipamento: [req.body.tipoAparelho, req.body.modelo].filter(Boolean).join(' '),
            etiqueta:    req.body.etiqueta || '',
            detalhes:    temEquip
                ? `Etiqueta: ${req.body.etiqueta||'—'} · Modelo: ${req.body.modelo||'—'} · Local: ${req.body.local||'—'}`
                : `Setor: ${req.body.setor||'—'} · Local: ${req.body.local||'—'}`,
            ip:          extrairIP(req),
            rowIndex:    linha,
        });

        res.json({ok:true, linha});
    } catch(e){ res.status(500).json({ok:false, erro:e.message}); }
});

router.patch('/:rowIndex', async (req, res) => {
    try {
        const row = parseInt(req.params.rowIndex);
        if (isNaN(row)||row<ABA.inicio) return res.status(400).json({ok:false, erro:'rowIndex inválido.'});

        const cacheAntes = lerCache();
        const itemAntes  = (cacheAntes?.equipamentos||[]).find(i=>i.rowIndex===row);

        await atualizarLinha(row, req.body);
        patchCache(row, req.body);

        await registrarLog({
            usuario:     extrairUsuario(req),
            acao:        'EDITOU',
            funcionario: itemAntes?.funcionario || req.body.funcionario || '',
            equipamento: [itemAntes?.tipoAparelho||req.body.tipoAparelho, itemAntes?.modelo||req.body.modelo].filter(Boolean).join(' '),
            etiqueta:    itemAntes?.etiqueta || req.body.etiqueta || '',
            detalhes:    `Campos alterados: ${Object.keys(req.body).join(', ')}`,
            ip:          extrairIP(req),
            rowIndex:    row,
        });

        res.json({ok:true});
    } catch(e){ res.status(500).json({ok:false, erro:e.message}); }
});

// ─── EXCLUSÃO ─────────────────────────────────────────────────────────────────
// DELETE /:rowIndex
// 1. Registra no histórico (como devolução/exclusão)
// 2. Grava no log_acoes com o motivo
// 3. Limpa a linha na planilha principal
// 4. Remove do cache
router.delete('/:rowIndex', async (req, res) => {
    try {
        const row = parseInt(req.params.rowIndex);
        if (isNaN(row)||row<ABA.inicio)
            return res.status(400).json({ok:false, erro:'rowIndex inválido.'});

        const cache = lerCache();
        const item  = (cache?.equipamentos||[]).find(i=>i.rowIndex===row);
        if (!item)
            return res.status(404).json({ok:false, erro:'Registro não encontrado no cache. Sincronize e tente novamente.'});

        const { motivo, obs } = req.body || {};
        const usuario = extrairUsuario(req);
        const ip      = extrairIP(req);

        // 1. Se tinha equipamento, registra no histórico antes de excluir
        if (item.tipoAparelho || item.modelo || item.etiqueta) {
            item.estadoDevolucao = 'Excluído';
            await inserirHistorico(
                item,
                motivo || 'Exclusão manual',
                '', // sem valor cobrado
                'Não',
                obs || `Excluído por ${usuario}`
            );
            _memHist = null;
        }

        // 2. Log de ação
        await registrarLog({
            usuario,
            acao:        'EXCLUIU',
            funcionario: item.funcionario || '',
            equipamento: [item.tipoAparelho, item.modelo].filter(Boolean).join(' '),
            etiqueta:    item.etiqueta || '',
            detalhes:    `Motivo: ${motivo||'não informado'} | Obs: ${obs||'—'} | Nº Série: ${item.numSerie||'—'} | Valor: ${item.valorFormatado||'—'}`,
            ip,
            rowIndex:    row,
        });

        // 3. Limpa a linha na planilha
        await limparLinha(row);

        // 4. Remove do cache local
        removerDoCache(row);

        res.json({ok:true, mensagem:`Equipamento excluído e registrado no histórico. Linha ${row} limpa.`});
    } catch(e) {
        console.error('[controleEquip] delete:', e.message);
        res.status(500).json({ok:false, erro:e.message});
    }
});

router.post('/:rowIndex/trocar', async (req, res) => {
    try {
        const row       = parseInt(req.params.rowIndex);
        if (isNaN(row)||row<ABA.inicio) return res.status(400).json({ok:false, erro:'rowIndex inválido.'});
        const cache     = lerCache();
        const itemAtual = (cache?.equipamentos||[]).find(i=>i.rowIndex===row);
        if (!itemAtual) return res.status(404).json({ok:false, erro:'Registro não encontrado.'});
        const { motivoDevolucao,estadoDevolucao,valorCobrado,pagoPeloFuncionario,obsDevolucao,
                novaEtiqueta,novoTipo,novoModelo,novoNumSerie,novoLocal,
                novoValor,novoEstadoEntrega,novoAssinouComodato,novaObs } = req.body;
        if (itemAtual.tipoAparelho||itemAtual.modelo||itemAtual.etiqueta) {
            itemAtual.estadoDevolucao = estadoDevolucao||'';
            await inserirHistorico(itemAtual,motivoDevolucao,valorCobrado,pagoPeloFuncionario,obsDevolucao);
            _memHist = null;
        }
        const hoje        = new Date().toLocaleDateString('pt-BR');
        const novosCampos = {
            etiqueta:novaEtiqueta||'', tipoAparelho:novoTipo||'', modelo:novoModelo||'',
            numSerie:novoNumSerie||'', local:novoLocal||'', dtEntrega:hoje,
            valor:novoValor||'', estadoEntrega:novoEstadoEntrega||'',
            assinouComodato:novoAssinouComodato||'Não',
            statusAtual:novoTipo?'Funcionando':'Sem equipamento',
            dtDevolucao:'', estadoDevolucao:'', valorCobrado:'', motivoDevTroca:'',
            obs:novaObs||'', driveLink:itemAtual.driveLink||itemAtual.pastaLink||'',
        };
        await atualizarLinha(row, novosCampos);
        patchCache(row, novosCampos);

        await registrarLog({
            usuario:     extrairUsuario(req),
            acao:        'TROCOU EQUIPAMENTO',
            funcionario: itemAtual.funcionario || '',
            equipamento: [itemAtual.tipoAparelho, itemAtual.modelo].filter(Boolean).join(' '),
            etiqueta:    itemAtual.etiqueta || '',
            detalhes:    `Motivo: ${motivoDevolucao||'—'} · Novo: ${[novoTipo,novoModelo].filter(Boolean).join(' ')||'—'} · Etiqueta nova: ${novaEtiqueta||'—'}`,
            ip:          extrairIP(req),
            rowIndex:    row,
        });

        res.json({ok:true, dtEntrega:hoje});
    } catch(e){
        console.error('[controleEquip] trocar:',e.message);
        res.status(500).json({ok:false, erro:e.message});
    }
});

router.post('/:rowIndex/devolver', async (req, res) => {
    try {
        const row       = parseInt(req.params.rowIndex);
        const cache     = lerCache();
        const itemAtual = (cache?.equipamentos||[]).find(i=>i.rowIndex===row);
        if (itemAtual&&(itemAtual.tipoAparelho||itemAtual.modelo)) {
            itemAtual.estadoDevolucao = req.body.estadoDevolucao||'';
            await inserirHistorico(itemAtual,req.body.motivo,req.body.valorCobrado,req.body.pagoPeloFuncionario,req.body.obs);
            _memHist = null;
        }
        const hoje   = new Date().toLocaleDateString('pt-BR');
        const campos = {
            dtDevolucao:hoje, estadoDevolucao:req.body.estadoDevolucao||'',
            motivoDevTroca:req.body.motivo||'', valorCobrado:req.body.valorCobrado||'',
            statusAtual:'Sem equipamento', obs:req.body.obs||'',
            tipoAparelho:'', modelo:'', numSerie:'', etiqueta:'',
            local:'', dtEntrega:'', valor:'', estadoEntrega:'', assinouComodato:'Não',
            driveLink:itemAtual?.driveLink||itemAtual?.pastaLink||'',
        };
        await atualizarLinha(row, campos);
        patchCache(row, campos);

        await registrarLog({
            usuario:     extrairUsuario(req),
            acao:        'DEVOLVEU',
            funcionario: itemAtual?.funcionario || '',
            equipamento: [itemAtual?.tipoAparelho, itemAtual?.modelo].filter(Boolean).join(' '),
            etiqueta:    itemAtual?.etiqueta || '',
            detalhes:    `Motivo: ${req.body.motivo||'—'} · Estado: ${req.body.estadoDevolucao||'—'} · Cobrado: ${req.body.valorCobrado||'0'}`,
            ip:          extrairIP(req),
            rowIndex:    row,
        });

        res.json({ok:true, dtDevolucao:hoje});
    } catch(e){
        console.error('[controleEquip] devolver:',e.message);
        res.status(500).json({ok:false, erro:e.message});
    }
});

// ─── SULTS ────────────────────────────────────────────────────────────────────
router.get('/sults/pessoas', (req,res) => {
    try { res.json({ok:true, pessoas:buscarPessoasLocal(req.query.q||''), total:0}); }
    catch(e){ res.json({ok:false, erro:e.message}); }
});
router.post('/sults/sincronizar', async (req,res) => {
    try { const p=await sincronizarSults(); res.json({ok:true, total:p.length}); }
    catch(e){ res.json({ok:false, erro:e.message}); }
});
router.get('/sults/status', (req,res) => {
    const c=lerCacheSults();
    res.json({ok:!!c, total:c?.total||0, sincronizadoEm:c?.sincronizadoEm||null});
});
router.post('/sults/upload', upload.single('arquivo'), (req,res) => {
    try {
        if (!req.file) return res.status(400).json({ok:false, erro:'Nenhum arquivo enviado.'});
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!['.xlsx','.xls'].includes(ext)) return res.status(400).json({ok:false, erro:'Envie .xlsx ou .xls.'});
        const pessoas = parsePessoasXlsx(req.file.buffer);
        if (!pessoas.length) return res.status(400).json({ok:false, erro:'Nenhuma pessoa encontrada.'});
        salvarCacheSults({pessoas, total:pessoas.length, sincronizadoEm:new Date().toISOString(), fonte:'xlsx_upload', arquivo:req.file.originalname});
        res.json({ok:true, total:pessoas.length});
    } catch(e){ res.status(500).json({ok:false, erro:e.message}); }
});

router.post('/importar-colaboradores', upload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ok:false, erro:'Nenhum arquivo enviado.'});
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!['.xlsx','.xls'].includes(ext)) return res.status(400).json({ok:false, erro:'Envie .xlsx ou .xls.'});
        const pessoasNovas = parsePessoasXlsx(req.file.buffer);
        if (!pessoasNovas.length) return res.status(400).json({ok:false, erro:'Nenhuma pessoa encontrada.'});
        _mem = null;
        const dadosAtuais     = await sincronizar();
        const nomesNaPlanilha = new Set((dadosAtuais.equipamentos||[]).map(i=>norm(i.funcionario)));
        const novos           = pessoasNovas.filter(p=>!nomesNaPlanilha.has(norm(p.nome)));
        const hoje            = new Date().toLocaleDateString('pt-BR');
        for (const p of novos) {
            const driveLink = lerCacheDrive()[norm(p.nome)]?.link||'';
            await inserirLinha({
                etiqueta:'', funcionario:p.nome, setor:p.setor||p.cargo||'',
                contato:p.contato||'', local:p.unidade||'',
                tipoAparelho:'', modelo:'', numSerie:'', dtEntrega:'',
                estadoEntrega:'', assinouComodato:'Não', statusAtual:'Sem equipamento',
                dtDevolucao:'', estadoDevolucao:'', valor:'', valorCobrado:'',
                motivoDevTroca:'', obs:'', driveLink, dtImportacao:hoje,
            });
        }
        salvarCacheSults({pessoas:pessoasNovas, total:pessoasNovas.length,
            sincronizadoEm:new Date().toISOString(), fonte:'xlsx_upload', arquivo:req.file.originalname});
        _mem = null;
        const dadosFinais = await sincronizar();

        await registrarLog({
            usuario:     extrairUsuario(req),
            acao:        'IMPORTOU COLABORADORES',
            funcionario: '(lote)',
            equipamento: '',
            etiqueta:    '',
            detalhes:    `Arquivo: ${req.file.originalname} · ${novos.length} novos · ${pessoasNovas.length - novos.length} já existiam`,
            ip:          extrairIP(req),
            rowIndex:    '',
        });

        res.json({ok:true, adicionados:novos.length, jaExistiam:(dadosAtuais.equipamentos||[]).length,
            total:pessoasNovas.length, sincronizadoEm:dadosFinais.sincronizadoEm,
            equipamentos:dadosFinais.equipamentos, stats:dadosFinais.stats});
    } catch(e){
        console.error('[importar-colaboradores]',e.message);
        res.status(500).json({ok:false, erro:e.message});
    }
});

module.exports = router;
module.exports.inicializarSults     = inicializarSults;
module.exports.sincronizarHistorico = sincronizarHistorico;