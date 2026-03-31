// ============================================================
//  relatorioControleAcessosSultsCache.js
//  Cache backend — Chamados abertos (SULTS)
//
//  ESTRATÉGIA:
//  • Cache persiste em arquivo JSON (survives server restart)
//  • Sync incremental: usa ultimaAlteracaoStart para buscar SOMENTE
//    chamados alterados desde a última sync
//  • Filtros de dias ficam 100% no frontend
//  • Progresso granular via getProgresso() para barra no frontend
//  • Auto-sync semanal via setInterval
// ============================================================
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TOKEN           = process.env.SULTS_TOKEN || '';
const BASE_URL        = 'api.sults.com.br';
const DELAY           = 600;
const JANELA_MAX_DIAS = 180;
const INTERVALO_AUTO_SYNC_MS = 7 * 24 * 60 * 60 * 1000;

// Arquivo de persistência — mesma pasta cache/ usada pelos outros serviços
const CACHE_FILE = path.join(__dirname, '../cache/relatorio_sults_cache.json');

const SITUACOES_ABERTO = [4, 5, 6];
const SITUACAO_LABEL = {
    1: 'Novo Chamado', 2: 'Concluído', 3: 'Resolvido',
    4: 'Em Andamento', 5: 'Aguardando Solicitante', 6: 'Aguardando Responsável'
};

// ─── ESTADO ─────────────────────────────────────────────────
let _cache        = null;
let _fingerprints = {};
let _autoSyncTimer = null;

let _status = {
    ultimaSync: null, sincronizando: false, totalChamados: 0,
    erro: null, proximaSync: null, modoUltimaSync: null,
    etapa: '', paginaAtual: 0, totalPaginas: 0,
    chamadosBuscados: 0, novos: 0, alterados: 0, removidos: 0,
    percentual: 0, mensagem: ''
};

// ─── HELPERS DE ARQUIVO ──────────────────────────────────────
function garantirPasta() {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function salvarArquivo() {
    try {
        garantirPasta();
        const payload = {
            salvoEm:      new Date().toISOString(),
            cache:        _cache,
            fingerprints: _fingerprints
        };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), 'utf8');
        console.log(`[SULTS-CTRL] 💾 Cache salvo — ${_cache?.chamados?.length || 0} chamados`);
    } catch (e) {
        console.warn('[SULTS-CTRL] ⚠️ Falha ao salvar cache em disco:', e.message);
    }
}

function lerArquivo() {
    try {
        if (!fs.existsSync(CACHE_FILE)) return null;
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) {
        console.warn('[SULTS-CTRL] ⚠️ Falha ao ler cache do disco:', e.message);
        return null;
    }
}

// ─── HELPERS ────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function diasEntre(dataISO) {
    return Math.floor((Date.now() - new Date(dataISO)) / 86400000);
}

function setProg(patch) {
    Object.assign(_status, patch);
    if (patch.paginaAtual !== undefined && _status.totalPaginas > 0) {
        _status.percentual = Math.min(95, Math.round(
            (_status.paginaAtual / _status.totalPaginas) * 90
        ));
    }
    if (patch.mensagem) console.log(`[SULTS-CTRL] ${patch.mensagem}`);
}

// ─── HTTP GET com retry ──────────────────────────────────────
function sultsGET(path, tentativa = 1) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: BASE_URL, path: '/api' + path, method: 'GET',
            headers: { 'Authorization': TOKEN, 'Content-Type': 'application/json;charset=UTF-8' }
        }, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                if (res.statusCode === 429 && tentativa <= 3) {
                    const w = DELAY * tentativa * 3;
                    return sleep(w).then(() => sultsGET(path, tentativa + 1)).then(resolve).catch(reject);
                }
                if (res.statusCode >= 400)
                    return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
    });
}

// ─── BUSCAR COM PAGINAÇÃO ────────────────────────────────────
async function buscarPaginado(abertoEnd, ultimaAlteracaoStart = null) {
    let baseUrl = `/v1/chamado/ticket?start=0&limit=100&abertoEnd=${abertoEnd}`;
    if (ultimaAlteracaoStart) baseUrl += `&ultimaAlteracaoStart=${ultimaAlteracaoStart}`;

    setProg({ etapa: 'buscando', paginaAtual: 0, mensagem: 'Verificando volume de dados...' });

    const primeira = await sultsGET(baseUrl);
    const totalPaginas = primeira.totalPage || 1;

    setProg({ totalPaginas, paginaAtual: 1,
        mensagem: `Página 1/${totalPaginas} — ${(primeira.data||[]).length} chamados` });

    let todos = [...(primeira.data || [])];

    for (let page = 1; page < totalPaginas; page++) {
        await sleep(DELAY);
        const url = baseUrl.replace('start=0', `start=${page}`);
        setProg({ paginaAtual: page + 1,
            mensagem: `Página ${page + 1}/${totalPaginas} — ${todos.length} acumulados` });
        const r = await sultsGET(url);
        todos = todos.concat(r.data || []);
    }

    setProg({ chamadosBuscados: todos.length, mensagem: `${todos.length} registros recebidos da API` });
    return todos;
}

// ─── PROCESSAR CHAMADO ───────────────────────────────────────
function processar(c) {
    return {
        id:                 c.id,
        titulo:             c.titulo || '',
        diasAberto:         diasEntre(c.aberto),
        aberto:             c.aberto,
        ultimaAlteracao:    c.ultimaAlteracao || null,
        situacao:           c.situacao,
        situacaoLabel:      SITUACAO_LABEL[c.situacao] || 'Desconhecido',
        departamentoId:     c.departamento?.id   ?? null,
        departamentoNome:   c.departamento?.nome ?? 'Sem Departamento',
        solicitante:        c.solicitante?.nome  ?? '—',
        solicitanteId:      c.solicitante?.id    ?? null,
        responsavel:        c.responsavel?.nome  ?? 'Em fila',
        responsavelId:      c.responsavel?.id    ?? null,
        unidade:            c.unidade?.nome      ?? '—',
        unidadeId:          c.unidade?.id        ?? null,
        assunto:            c.assunto?.nome      ?? '—',
        tipo:               c.tipo,
        etiquetas:          (c.etiqueta || []).map(e => ({ nome: e.nome, cor: e.cor })),
        interacoesPublicas: c.countInteracaoPublico || 0,
        interacoesInternas: c.countInteracaoInterno || 0
    };
}

// ─── MONTAR ESTRUTURA DO CACHE ───────────────────────────────
function montarCache(processados) {
    processados.sort((a, b) => b.diasAberto - a.diasAberto);

    // Por departamento
    const deptMap = {};
    processados.forEach(c => {
        const key = c.departamentoId ?? 'sem';
        if (!deptMap[key]) deptMap[key] = {
            departamentoId: c.departamentoId, departamentoNome: c.departamentoNome,
            chamados: [], total: 0
        };
        deptMap[key].chamados.push(c);
        deptMap[key].total++;
    });
    const porDepartamento = Object.values(deptMap).sort((a, b) => b.total - a.total);

    // Por pessoa (aba Acessos)
    const agora     = new Date();
    const mesAtual  = agora.getMonth();
    const anoAtual  = agora.getFullYear();
    const pessoaMap = {};

    processados.forEach(c => {
        const pid  = c.responsavelId;
        const nome = c.responsavel;
        if (!pid || nome === 'Em fila') return;

        if (!pessoaMap[pid]) pessoaMap[pid] = {
            pessoaId: pid, nome,
            departamentoId: c.departamentoId,
            departamentoNome: c.departamentoNome,
            totalChamados: 0, chamadosAbertos: 0,
            ultimaAtividade: null, chamadosNoMes: 0,
            chamadosUltimos7: 0, chamadosList: []
        };

        const p = pessoaMap[pid];
        p.totalChamados++;
        p.chamadosAbertos++;
        p.chamadosList.push(c.id);

        const dataRef = c.ultimaAlteracao
            ? new Date(c.ultimaAlteracao)
            : c.aberto ? new Date(c.aberto) : null;

        if (dataRef) {
            if (!p.ultimaAtividade || dataRef > new Date(p.ultimaAtividade))
                p.ultimaAtividade = dataRef.toISOString();
            if ((agora - dataRef) / 86400000 <= 7) p.chamadosUltimos7++;
        }

        if (c.aberto) {
            const da = new Date(c.aberto);
            if (da.getMonth() === mesAtual && da.getFullYear() === anoAtual)
                p.chamadosNoMes++;
        }
    });

    const pessoas = Object.values(pessoaMap).map(p => ({
        ...p,
        diasSemAtividade: p.ultimaAtividade
            ? Math.floor((agora - new Date(p.ultimaAtividade)) / 86400000)
            : 999,
        alerta: !p.ultimaAtividade ||
            ((agora - new Date(p.ultimaAtividade)) / 86400000) > 14
    })).sort((a, b) => a.diasSemAtividade - b.diasSemAtividade);

    // Acessos agrupados por departamento
    const acessosDeptMap = {};
    pessoas.forEach(p => {
        const key = p.departamentoId ?? 'sem';
        if (!acessosDeptMap[key]) acessosDeptMap[key] = {
            departamentoId: p.departamentoId,
            departamentoNome: p.departamentoNome,
            pessoas: []
        };
        acessosDeptMap[key].pessoas.push(p);
    });
    const acessosPorDept = Object.values(acessosDeptMap)
        .sort((a, b) => b.pessoas.length - a.pessoas.length);

    const mediaAberto = processados.length > 0
        ? Math.round(processados.reduce((s, c) => s + c.diasAberto, 0) / processados.length)
        : 0;

    return {
        chamados: processados,
        porDepartamento,
        departamentos: porDepartamento.map(g => ({ id: g.departamentoId, nome: g.departamentoNome })),
        pessoas,
        acessosPorDept,
        resumo: {
            total: processados.length,
            departamentos: porDepartamento.length,
            mediaAberto,
            acimaDe90: processados.filter(c => c.diasAberto >= 90).length,
            acimaDe60: processados.filter(c => c.diasAberto >= 60).length,
            acimaDe30: processados.filter(c => c.diasAberto >= 30).length,
            janelaMaxDias: JANELA_MAX_DIAS,
            totalPessoas: pessoas.length,
            pessoasAlerta: pessoas.filter(p => p.alerta).length
        },
        sincronizadoEm: new Date().toISOString(),
        janelaMaxDias:  JANELA_MAX_DIAS
    };
}

// ─── SYNC COMPLETO ───────────────────────────────────────────
async function _syncCompleto(modo) {
    setProg({ etapa: 'buscando', novos: 0, alterados: 0, removidos: 0,
        mensagem: `Sync ${modo} — janela de ${JANELA_MAX_DIAS} dias` });

    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - JANELA_MAX_DIAS);
    const abertoEnd = dataLimite.toISOString().replace(/\.\d{3}Z$/, 'Z');

    const todosRaw = await buscarPaginado(abertoEnd);
    const abertos  = todosRaw.filter(c => SITUACOES_ABERTO.includes(c.situacao));

    setProg({ etapa: 'processando', mensagem: `Processando ${abertos.length} chamados...` });
    const processados = abertos.map(processar);

    _fingerprints = {};
    abertos.forEach(c => { _fingerprints[c.id] = c.ultimaAlteracao || ''; });

    _cache = montarCache(processados);
    salvarArquivo();
}

// ─── SYNC INCREMENTAL ────────────────────────────────────────
async function _syncIncremental() {
    if (!_cache || !_status.ultimaSync) return _syncCompleto('fallback');

    const desde = new Date(_status.ultimaSync);
    desde.setMinutes(desde.getMinutes() - 10);
    const ultimaAlteracaoStart = desde.toISOString().replace(/\.\d{3}Z$/, 'Z');

    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - JANELA_MAX_DIAS);
    const abertoEnd = dataLimite.toISOString().replace(/\.\d{3}Z$/, 'Z');

    setProg({ etapa: 'buscando', novos: 0, alterados: 0, removidos: 0,
        mensagem: `Incremental — alterações desde ${desde.toLocaleString('pt-BR')}` });

    const alteradosRaw = await buscarPaginado(abertoEnd, ultimaAlteracaoStart);

    setProg({ etapa: 'processando',
        mensagem: `Mesclando ${alteradosRaw.length} chamados alterados com cache...` });

    const alteradosAbertos = alteradosRaw.filter(c => SITUACOES_ABERTO.includes(c.situacao));
    const fechadosIds = new Set(
        alteradosRaw.filter(c => !SITUACOES_ABERTO.includes(c.situacao)).map(c => c.id)
    );

    const alteradosMap = {};
    let novos = 0, alterados = 0;
    alteradosAbertos.forEach(c => {
        alteradosMap[c.id] = processar(c);
        if (_fingerprints[c.id] === undefined) novos++;
        else alterados++;
        _fingerprints[c.id] = c.ultimaAlteracao || '';
    });

    let removidos = 0;
    const base = _cache.chamados
        .filter(c => {
            if (fechadosIds.has(c.id)) { removidos++; delete _fingerprints[c.id]; return false; }
            if (alteradosMap[c.id])    return false;
            return true;
        })
        .map(c => ({ ...c, diasAberto: diasEntre(c.aberto) }));

    const mergedFinal = [...base, ...Object.values(alteradosMap)];

    setProg({ novos, alterados, removidos,
        mensagem: `Merge: +${novos} novos, ~${alterados} alterados, -${removidos} removidos = ${mergedFinal.length} total` });

    _cache = montarCache(mergedFinal);
    salvarArquivo();
}

// ─── SINCRONIZAR (público) ───────────────────────────────────
async function sincronizarEAtualizar(modo = 'manual') {
    if (_status.sincronizando) throw new Error('Sincronização já em andamento.');

    _status.sincronizando  = true;
    _status.erro           = null;
    _status.modoUltimaSync = modo;
    _status.percentual     = 0;
    _status.etapa          = 'iniciando';

    try {
        const incremental = _cache && modo !== 'completo';
        if (incremental) await _syncIncremental();
        else             await _syncCompleto(modo);

        _status.ultimaSync    = _cache.sincronizadoEm;
        _status.totalChamados = _cache.chamados.length;
        _status.percentual    = 100;
        _status.etapa         = 'concluido';
        _status.mensagem      = `Concluído — ${_cache.chamados.length} chamados em aberto`;

        return _cache;
    } catch (err) {
        _status.erro     = err.message;
        _status.etapa    = 'erro';
        _status.mensagem = 'Erro: ' + err.message;
        throw err;
    } finally {
        _status.sincronizando = false;
    }
}

// ─── BUSCAR TIMELINE ────────────────────────────────────────
async function buscarTimeline(chamadoId) {
    return sultsGET(`/v1/chamado/ticket/${chamadoId}/timeline`);
}

// ─── GETTERS ────────────────────────────────────────────────
function getDados()  { return _cache; }
function getStatus() { return { ..._status }; }
function getProgresso() {
    return {
        sincronizando: _status.sincronizando, etapa: _status.etapa,
        mensagem: _status.mensagem, percentual: _status.percentual,
        paginaAtual: _status.paginaAtual, totalPaginas: _status.totalPaginas,
        chamadosBuscados: _status.chamadosBuscados,
        novos: _status.novos, alterados: _status.alterados, removidos: _status.removidos,
        erro: _status.erro
    };
}

// ─── AUTO-SYNC SEMANAL ───────────────────────────────────────
function agendarProximaSync() {
    if (_autoSyncTimer) clearTimeout(_autoSyncTimer);
    const proxima = new Date(Date.now() + INTERVALO_AUTO_SYNC_MS);
    _status.proximaSync = proxima.toISOString();
    console.log(`[SULTS-CTRL] Próxima auto-sync: ${proxima.toLocaleString('pt-BR')}`);

    _autoSyncTimer = setTimeout(async () => {
        console.log('[SULTS-CTRL] ⏰ Auto-sync semanal...');
        try { await sincronizarEAtualizar('auto'); }
        catch (e) { console.error('[SULTS-CTRL] Auto-sync falhou:', e.message); }
        agendarProximaSync();
    }, INTERVALO_AUTO_SYNC_MS);

    if (_autoSyncTimer.unref) _autoSyncTimer.unref();
}

// ─── INICIALIZAR (carrega do disco se existir) ───────────────
async function inicializar() {
    console.log('[SULTS-CTRL] Inicializando cache...');

    const salvo = lerArquivo();
    if (salvo && salvo.cache && salvo.cache.chamados?.length) {
        _cache        = salvo.cache;
        _fingerprints = salvo.fingerprints || {};
        _status.ultimaSync    = salvo.cache.sincronizadoEm;
        _status.totalChamados = salvo.cache.chamados.length;

        const dt = new Date(salvo.salvoEm).toLocaleString('pt-BR');
        console.log(`[SULTS-CTRL] ⚡ Cache carregado do disco — ${_cache.chamados.length} chamados · salvo em ${dt}`);
    } else {
        console.log('[SULTS-CTRL] Sem cache em disco. Aguardando sincronização manual.');
    }

    agendarProximaSync();
}

// ─── LIMPAR CACHE ───────────────────────────────────────────
function limparCache() {
    _cache = null; _fingerprints = {};
    Object.assign(_status, {
        ultimaSync: null, sincronizando: false, totalChamados: 0,
        erro: null, modoUltimaSync: null,
        etapa: '', paginaAtual: 0, totalPaginas: 0, chamadosBuscados: 0,
        novos: 0, alterados: 0, removidos: 0, percentual: 0, mensagem: ''
    });
    // Remove arquivo do disco também
    try { if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE); } catch {}
    console.log('[SULTS-CTRL] Cache limpo (memória + disco).');
    return { ok: true, mensagem: 'Cache limpo com sucesso.' };
}

module.exports = {
    inicializar, sincronizarEAtualizar, buscarTimeline,
    getDados, getStatus, getProgresso, limparCache, JANELA_MAX_DIAS
};