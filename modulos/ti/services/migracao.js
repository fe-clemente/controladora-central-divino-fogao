// services/migracao.js
'use strict';

const express    = require('express');
const router     = express.Router();
const { google } = require('googleapis');
const https      = require('https');
const fs         = require('fs');
const path       = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const SHEET_ID      = process.env.MIG_SHEET_ID      || '1O7Q_075UydHjpSQ5cyQumwl3P8yvKHV5cE_8fNiDWzE';
const ABA_PRINCIPAL = process.env.MIG_ABA_PRINCIPAL || 'Página1';
const SULTS_TOKEN   = process.env.SULTS_TOKEN        || 'O2Rpdmlub2ZvZ2FvOzE3NDMxOTI0NDExMDU=';
const SULTS_HOST    = 'api.sults.com.br';

// Coluna E = observações (índice 4, base-0)
const COL_OBS = 'E';  // ← coluna E da Página1

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_DIR  = path.join(__dirname, '../cache');
const CACHE_FILE = path.join(CACHE_DIR, 'migracao_cache.json');

// Cache LOCAL de observações inseridas pelo operador.
// Persiste mesmo após re-sync da planilha.
const CACHE_OBS  = path.join(CACHE_DIR, 'migracao_obs.json');

function lerCache(arquivo) {
    try {
        const f = arquivo || CACHE_FILE;
        if (!fs.existsSync(f)) return null;
        return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch { return null; }
}

function salvarCache(dados, arquivo) {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(arquivo || CACHE_FILE,
            JSON.stringify({ ...dados, _at: new Date().toISOString() }, null, 2));
    } catch (e) { console.error('[migCache]', e.message); }
}

// ─── Cache de observações locais (por código de loja) ─────────────────────────
// Estrutura: { "1281": { obs: "texto", status: "Em Andamento", updatedAt: "..." }, ... }
function lerObs() {
    try {
        if (!fs.existsSync(CACHE_OBS)) return {};
        return JSON.parse(fs.readFileSync(CACHE_OBS, 'utf8'));
    } catch { return {}; }
}

function salvarObs(mapa) {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(CACHE_OBS, JSON.stringify(mapa, null, 2));
    } catch (e) { console.error('[migObs]', e.message); }
}

// ─── Google Sheets auth ───────────────────────────────────────────────────────
async function getSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_KEY_FILE || 'minha-chave.json',
        scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

async function listarAbas(sheets) {
    const meta = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: 'sheets.properties.title',
    });
    return meta.data.sheets.map(s => s.properties.title);
}

async function lerAba(sheets, nome, abas) {
    if (!nome) return [];
    if (abas && !abas.includes(nome)) {
        console.warn(`[mig] Aba "${nome}" não existe. Disponíveis: ${abas.join(', ')}`);
        return [];
    }
    try {
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: nome });
        return r.data.values || [];
    } catch (e) { console.warn(`[mig] Erro ao ler "${nome}": ${e.message}`); return []; }
}

// ─── HTTP nativo ──────────────────────────────────────────────────────────────
function httpsGet(host, urlPath, headers) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            { hostname: host, path: urlPath, method: 'GET',
              headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) },
            res => {
                let raw = '';
                res.on('data', c => raw += c);
                res.on('end',  () => resolve({ status: res.statusCode, body: raw }));
            }
        );
        req.on('error', reject);
        req.setTimeout(20000, () => req.destroy(new Error('SULTS timeout')));
        req.end();
    });
}

// ─── SULTS — busca TODAS as unidades (ativas + implantação) ──────────────────
// O parâmetro `start` é número de PÁGINA (0, 1, 2...), não offset.
// Buscamos com ativo=true (retorna situacaoId 1 = ativas e 3 = implantação).
// situacaoId conhecido:
//   1 = Ativa (em operação)
//   3 = Em Implantação / Inauguração pendente
//   outros = inativas (ignoradas)
async function fetchSultsUnidades() {
    const todas = [];
    let pagina  = 0;
    const limit = 100;
    console.log('[SULTS] Buscando unidades (todas as páginas)...');

    while (true) {
        // ativo=true traz situacaoId 1 e 3
        const qs  = `/v1/empresas?start=${pagina}&limit=${limit}&ativo=true`;
        const res = await httpsGet(SULTS_HOST, qs, { Authorization: SULTS_TOKEN });

        if (res.status !== 200)
            throw new Error(`SULTS HTTP ${res.status}: ${res.body.slice(0, 300)}`);

        let page;
        try { page = JSON.parse(res.body); }
        catch { throw new Error(`SULTS JSON inválido: ${res.body.slice(0, 200)}`); }

        if (!Array.isArray(page) || page.length === 0) break;

        todas.push(...page);
        console.log(`  [SULTS] pág ${pagina} → ${page.length} unids | total: ${todas.length}`);

        if (page.length < limit) break;
        pagina++;
    }

    const ativas       = todas.filter(u => u.situacaoId === 1).length;
    const implantacao  = todas.filter(u => u.situacaoId === 3).length;
    const outros       = todas.filter(u => u.situacaoId !== 1 && u.situacaoId !== 3).length;
    console.log(`[SULTS] ✅ Total: ${todas.length} | Ativas: ${ativas} | Implantação: ${implantacao} | Outros: ${outros}`);
    return todas;
}

// ─── Parser da planilha ───────────────────────────────────────────────────────
function nh(s) {   // normaliza header
    return (s || '').toString().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ').trim();
}

function parseAba(rows) {
    if (!rows || !rows.length) return [];
    const header = rows[0].map(nh);

    return rows.slice(1).map((row, i) => {
        const obj = { rowIndex: i + 2 };
        header.forEach((col, ci) => { obj[col] = (row[ci] || '').toString().trim(); });

        obj.codigo        = obj['codigo']         || obj['id loja']      || obj['id']   || obj['cod'] || '';
        obj.loja          = obj['loja']           || obj['nome da loja'] || obj['nome'] || '';
        obj.softwareHouse = obj['software house'] || obj['softhouse']    || obj['softhouse atual']
                          || obj['sistema atual'] || obj['sw atual']     || obj['sistema'] || '';
        obj.observacoes   = obj['observacao']     || obj['observacoes']  || obj['observações']
                          || obj['obs']           || '';
        obj.uf            = obj['uf'] || obj['estado'] || '';

        // Extrai UF do nome quando não há coluna (ex: "AL - Maceió - Centro")
        if (!obj.uf && obj.loja) {
            const m = obj.loja.match(/^([A-Z]{2})\s*[-–]/);
            if (m) obj.uf = m[1];
        }

        return obj;
    }).filter(r => r.codigo || r.loja);
}

// ─── Mescla observações locais na lista de lojas ──────────────────────────────
// As obs locais têm prioridade sobre o que está na planilha.
// Quando houver re-sync, as obs locais são gravadas na planilha E mantidas no cache local.
function mesclarObs(lojas, obsCache) {
    return lojas.map(l => {
        const local = obsCache[l.codigo] || obsCache[l.rowIndex] || null;
        if (local) {
            return {
                ...l,
                observacoes:      local.obs    || l.observacoes,
                statusMigracao:   local.status || l.statusMigracao || '',
                _obsLocal:        true,
                _obsUpdatedAt:    local.updatedAt,
            };
        }
        return l;
    });
}

// ─── Estatísticas ─────────────────────────────────────────────────────────────
// sultsUnidades = array completo da API (com situacaoId)
// lojasSW       = array parseado da planilha
function gerarStats(lojasSW, sultsUnidades) {
    const sultsTotal      = sultsUnidades.length;
    // situacaoId: 1=Ativa, 3=Implantação/Inauguração pendente
    const sultsAtivas     = sultsUnidades.filter(u => u.situacaoId === 1).length;
    const sultsImplantacao= sultsUnidades.filter(u => u.situacaoId === 3).length;
    const sultsOutros     = sultsUnidades.filter(u => u.situacaoId !== 1 && u.situacaoId !== 3).length;

    const total    = lojasSW.length;
    const comSW    = lojasSW.filter(l => (l.softwareHouse || '').trim().toUpperCase() === 'SW').length;
    const semInfo  = lojasSW.filter(l => {
        const s = (l.softwareHouse || '').trim().toLowerCase();
        return !s || s === 'não informado' || s === 'nao informado';
    }).length;
    const outrosSW = total - comSW - semInfo;  // Totvs, LinxD, etc.
    const pendentes = sultsTotal ? sultsTotal - comSW : total - comSW;

    const porSW = {};
    const porUF = {};
    lojasSW.forEach(l => {
        const sw = l.softwareHouse || 'Não Informado';
        porSW[sw] = (porSW[sw] || 0) + 1;
        const uf = l.uf || '??';
        porUF[uf] = (porUF[uf] || 0) + 1;
    });

    return {
        // Planilha
        totalPlanilha:    total,
        comSW,
        outrosSW,
        semInfo,
        pendentes,
        pctMigrado: sultsTotal ? +((comSW / sultsTotal) * 100).toFixed(1) : 0,
        // SULTS breakdown por situação
        sultsTotal,
        sultsAtivas,
        sultsImplantacao,  // em inauguração / pendentes
        sultsOutros,
        porSoftwareHouse: Object.entries(porSW)
            .sort((a, b) => b[1] - a[1])
            .map(([nome, qtd]) => ({ nome, qtd, pct: +((qtd / total) * 100).toFixed(1) })),
        porUF: Object.entries(porUF)
            .sort((a, b) => b[1] - a[1])
            .map(([uf, qtd]) => ({ uf, qtd, pct: +((qtd / total) * 100).toFixed(1) })),
    };
}

// ─── Cross-reference SULTS ↔ Planilha ────────────────────────────────────────
function normStr(s) {
    return (s || '').toString().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function cruzarDados(sultsUnidades, planilhaLojas, obsCache) {
    const mapaCod  = {};
    const mapaNome = {};
    planilhaLojas.forEach(l => {
        const c = normStr(l.codigo || '');
        const n = normStr(l.loja   || '');
        if (c) mapaCod[c]  = l;
        if (n) mapaNome[n] = l;
    });

    const lojasCruzadas = sultsUnidades.map(u => {
        const c    = normStr(String(u.id));
        const n    = normStr(u.nomeFantasia || '');
        const plan = mapaCod[c] || mapaNome[n] || null;

        // Observação local tem prioridade
        const obsLocal = obsCache[String(u.id)] || (plan ? obsCache[plan.rowIndex] : null) || null;

        return {
            sultsId:       u.id,
            nomeFantasia:  u.nomeFantasia         || '',
            razaoSocial:   u.razaoSocial          || '',
            cidade:        u.endereco?.cidade     || '',
            uf:            u.endereco?.uf         || '',
            ativo:         u.ativo,
            dtCadastro:    u.dtCadastro           || '',
            dtInauguracao: u.dtInauguracao        || '',
            rowIndex:      plan?.rowIndex         || null,
            softwareHouse: plan?.softwareHouse    || '',
            observacoes:   obsLocal?.obs          || plan?.observacoes || '',
            statusMigracao: obsLocal?.status      || '',
            _planilhaEncontrada: !!plan,
            _obsLocal:     !!obsLocal,
        };
    });

    // Agrupa por software house (apenas lojas DA PLANILHA)
    const shMap = {};
    planilhaLojas.forEach(l => {
        const sw = l.softwareHouse || 'Não Informado';
        if (!shMap[sw]) shMap[sw] = { nome: sw, totalLojas: 0, lojas: [] };
        shMap[sw].totalLojas++;
        shMap[sw].lojas.push({ codigo: l.codigo, nome: l.loja, uf: l.uf });
    });

    const softhouses = Object.values(shMap)
        .sort((a, b) => b.totalLojas - a.totalLojas);

    return { lojasCruzadas, softhouses };
}

// ─── Gravar obs pendentes na planilha ─────────────────────────────────────────
// Chamado durante o sync: obs que foram salvas localmente são gravadas na planilha
async function gravarObsPendentes(sheets, lojasSW, obsCache) {
    const pendentes = Object.entries(obsCache).filter(([, v]) => v._pendente);
    if (!pendentes.length) return;

    console.log(`[mig] Gravando ${pendentes.length} observações pendentes na planilha...`);

    const data = [];
    for (const [chave, v] of pendentes) {
        // Encontra a linha pelo código ou rowIndex
        const loja = lojasSW.find(l => l.codigo === chave || String(l.rowIndex) === chave);
        if (!loja) continue;

        data.push({
            range:  `${ABA_PRINCIPAL}!${COL_OBS}${loja.rowIndex}`,
            values: [[v.obs || '']],
        });
    }

    if (!data.length) return;

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody:   { valueInputOption: 'USER_ENTERED', data },
    });

    // Marca como gravado (remove flag _pendente)
    for (const [chave] of pendentes) {
        if (obsCache[chave]) delete obsCache[chave]._pendente;
    }
    salvarObs(obsCache);
    console.log('[mig] Observações gravadas na planilha ✅');
}

// ─── Sincronizar ──────────────────────────────────────────────────────────────
async function sincronizar() {
    console.log('[mig] Iniciando sincronização...');

    const [sultsUnidades, sheets] = await Promise.all([
        fetchSultsUnidades(),
        getSheets(),
    ]);

    const abas    = await listarAbas(sheets);
    console.log('[mig] Abas:', abas.join(' | '));

    const rows    = await lerAba(sheets, ABA_PRINCIPAL, abas);
    const lojasSW = parseAba(rows);
    console.log(`[mig] Planilha "${ABA_PRINCIPAL}": ${lojasSW.length} lojas`);

    // Carrega obs locais e grava as pendentes na planilha
    const obsCache = lerObs();
    await gravarObsPendentes(sheets, lojasSW, obsCache);

    // Mescla obs locais nas lojas
    const lojasMescladas = mesclarObs(lojasSW, obsCache);

    const { lojasCruzadas, softhouses } = cruzarDados(sultsUnidades, lojasMescladas, obsCache);
    const stats = gerarStats(lojasMescladas, sultsUnidades);  // ← passa o array completo

    const dados = {
        abas,
        abaUsada:           ABA_PRINCIPAL,
        lojasSW:            lojasMescladas,
        lojasCruzadas,
        softhouses,
        stats,
        sultsTotal:         sultsUnidades.length,
        planilhaLojasTotal: lojasSW.length,
        sincronizadoEm:     new Date().toISOString(),
    };

    salvarCache(dados, CACHE_FILE);

    console.log(`[mig] ✅ Sync concluído`
        + ` | SULTS total: ${sultsUnidades.length}`
        + ` | Ativas: ${stats.sultsAtivas}`
        + ` | Implantação: ${stats.sultsImplantacao}`
        + ` | Planilha: ${lojasSW.length}`
        + ` | SW: ${stats.comSW}`
        + ` | Outros SW: ${stats.outrosSW}`
        + ` | Sem info: ${stats.semInfo}`);

    return dados;
}

// ─── Atualizar coluna E (obs) na planilha ────────────────────────────────────
async function gravarObsNaPlanilha(rowIndex, texto) {
    const sheets = await getSheets();
    await sheets.spreadsheets.values.update({
        spreadsheetId:     SHEET_ID,
        range:             `${ABA_PRINCIPAL}!${COL_OBS}${rowIndex}`,
        valueInputOption:  'USER_ENTERED',
        requestBody:       { values: [[texto]] },
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// GET /migracao/abas
router.get('/abas', async (req, res) => {
    try {
        const s = await getSheets();
        const a = await listarAbas(s);
        res.json({ ok: true, abas: a, abaConfigurada: ABA_PRINCIPAL });
    } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// GET /migracao/dados
router.get('/dados', (req, res) => {
    try {
        const c = lerCache(CACHE_FILE);
        if (!c) return res.json({ ok: false, erro: 'Sem cache — clique em Sincronizar.' });
        res.json({
            ok:                 true,
            abaUsada:           c.abaUsada           || ABA_PRINCIPAL,
            abas:               c.abas               || [],
            lojasSW:            c.lojasSW            || [],
            lojasCruzadas:      c.lojasCruzadas      || [],
            softhouses:         c.softhouses         || [],
            stats:              c.stats              || {},
            sultsTotal:         c.sultsTotal         || 0,
            planilhaLojasTotal: c.planilhaLojasTotal || 0,
            sincronizadoEm:     c.sincronizadoEm,
        });
    } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// GET /migracao/lojas-sw  — API pública para outros projetos
// ?sw=Totvs  ?uf=SP  ?q=brasilia  ?format=minimal
router.get('/lojas-sw', (req, res) => {
    try {
        const c = lerCache(CACHE_FILE);
        if (!c) return res.json({ ok: false, erro: 'Sem dados — sincronize primeiro.' });

        let lojas = c.lojasSW || [];
        const { sw, uf, q, format } = req.query;

        if (sw) lojas = lojas.filter(l => normStr(l.softwareHouse).includes(normStr(sw)));
        if (uf) lojas = lojas.filter(l => (l.uf || '').toUpperCase() === uf.toUpperCase());
        if (q)  lojas = lojas.filter(l => normStr(l.loja + ' ' + l.codigo).includes(normStr(q)));

        if (format === 'minimal')
            lojas = lojas.map(l => ({ codigo: l.codigo, loja: l.loja, softwareHouse: l.softwareHouse, uf: l.uf }));

        res.json({ ok: true, total: lojas.length, lojas, stats: c.stats || {}, sincronizadoEm: c.sincronizadoEm });
    } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// GET /migracao/lojas-sw/stats
router.get('/lojas-sw/stats', (req, res) => {
    try {
        const c = lerCache(CACHE_FILE);
        if (!c) return res.json({ ok: false, erro: 'Sem dados — sincronize primeiro.' });
        res.json({ ok: true, ...c.stats, sincronizadoEm: c.sincronizadoEm });
    } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// POST /migracao/sincronizar
router.post('/ti/sincronizar', async (req, res) => {
    try {
        const d = await sincronizar();
        res.json({
            ok:              true,
            abaUsada:        d.abaUsada,
            totalLojasSW:    d.lojasSW.length,
            totalSults:      d.sultsTotal,
            totalSofthouses: d.softhouses.length,
            stats:           d.stats,
        });
    } catch(e) {
        console.error('[mig] sincronizar erro:', e.message);
        res.json({ ok: false, erro: e.message });
    }
});

// ✅ POST /migracao/observacao
// Body: { codigo, rowIndex, obs, status }
// Salva obs na planilha (coluna E) E no cache local.
// O cache local persiste entre syncs para não perder informações.
router.post('/observacao', async (req, res) => {
    try {
        const { codigo, rowIndex, obs, status } = req.body;
        if (!codigo && !rowIndex)
            return res.json({ ok: false, erro: 'Informe codigo ou rowIndex da loja.' });
        if (obs === undefined)
            return res.json({ ok: false, erro: 'Informe o campo obs.' });

        const chave = String(codigo || rowIndex);

        // 1. Salva no cache local imediatamente
        const obsCache = lerObs();
        obsCache[chave] = {
            obs:       obs.trim(),
            status:    status || '',
            updatedAt: new Date().toISOString(),
            _pendente: false,   // vai tentar gravar na planilha agora
        };
        salvarObs(obsCache);

        // 2. Grava na planilha (coluna E)
        const row = parseInt(rowIndex);
        if (row) {
            try {
                await gravarObsNaPlanilha(row, obs.trim());
                console.log(`[mig] Obs gravada na planilha linha ${row}: "${obs.trim()}"`);
            } catch(e) {
                // Se falhar (ex: sem rede), marca como pendente para gravar no próximo sync
                obsCache[chave]._pendente = true;
                salvarObs(obsCache);
                console.warn(`[mig] Falha ao gravar na planilha, marcado como pendente: ${e.message}`);
            }
        }

        // 3. Atualiza cache principal
        const c = lerCache(CACHE_FILE);
        if (c && c.lojasSW) {
            const idx = c.lojasSW.findIndex(l =>
                l.codigo === String(codigo) || l.rowIndex === row
            );
            if (idx >= 0) {
                c.lojasSW[idx].observacoes    = obs.trim();
                c.lojasSW[idx].statusMigracao = status || c.lojasSW[idx].statusMigracao || '';
                c.lojasSW[idx]._obsLocal      = true;
                salvarCache(c, CACHE_FILE);
            }
        }

        res.json({ ok: true, gravadoPlanilha: !obsCache[chave]?._pendente });
    } catch(e) {
        console.error('[mig] obs erro:', e.message);
        res.json({ ok: false, erro: e.message });
    }
});

// ✅ PATCH /migracao/status/:codigo
// Body: { status: "Em Andamento" }
// Marca a loja como "Em Andamento" com um simples check
router.patch('/status/:codigo', async (req, res) => {
    try {
        const codigo = req.params.codigo;
        const status = req.body.status || 'Em Andamento';

        const obsCache = lerObs();
        if (!obsCache[codigo]) obsCache[codigo] = {};
        obsCache[codigo].status    = status;
        obsCache[codigo].updatedAt = new Date().toISOString();
        salvarObs(obsCache);

        // Atualiza cache principal
        const c = lerCache(CACHE_FILE);
        if (c && c.lojasSW) {
            const idx = c.lojasSW.findIndex(l => l.codigo === codigo);
            if (idx >= 0) {
                c.lojasSW[idx].statusMigracao = status;
                c.lojasSW[idx]._obsLocal      = true;
                salvarCache(c, CACHE_FILE);
            }
        }

        res.json({ ok: true, status });
    } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// GET /migracao/observacoes — retorna todo o cache de obs (para debug)
router.get('/observacoes', (req, res) => {
    try { res.json({ ok: true, observacoes: lerObs() }); }
    catch(e) { res.json({ ok: false, erro: e.message }); }
});

module.exports = router;