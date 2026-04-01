'use strict';

// ─── services/buscaAvaliacoesCache.js ────────────────────────────────────────
// Cache em memória para avaliações de treinamento.
// Usa sheetsAvaliacao.js para acesso à planilha — espelho de buscaCache.js.
// ─────────────────────────────────────────────────────────────────────────────

const sheetsAvaliacao = require('./sheetsAvaliacao');

const INTERVALO_SYNC = 30 * 60 * 1000; // 30 min

// ── Estado interno ────────────────────────────────────────────────────────────
let _dados         = [];
let _ultimaSync    = null;
let _proxSync      = null;
let _sincronizando = false;
let _erro          = null;
let _timer         = null;

// ── Sincronização ─────────────────────────────────────────────────────────────
async function sincronizar(motivo = 'auto') {
    if (_sincronizando) {
        console.log('[BUSCA-AVAL-CACHE] ⏳ Já sincronizando, aguardando...');
        return;
    }
    _sincronizando = true;
    _erro = null;
    console.log(`[BUSCA-AVAL-CACHE] 🔄 Sincronizando (${motivo})...`);

    try {
        const dados = await sheetsAvaliacao.getRows();
        _dados      = dados;
        _ultimaSync = new Date();
        _proxSync   = new Date(Date.now() + INTERVALO_SYNC);
        console.log(`[BUSCA-AVAL-CACHE] ✅ ${dados.length} avaliações carregadas`);
    } catch (e) {
        _erro = e.message;
        console.error('[BUSCA-AVAL-CACHE] ❌ Erro na sincronização:', e.message);
        throw e;
    } finally {
        _sincronizando = false;
    }
}

// ── Inicializa e agenda re-sincronização periódica ────────────────────────────
async function inicializar() {
    await sincronizar('inicialização');

    function agendar() {
        _timer = setTimeout(async () => {
            try   { await sincronizar('agendado'); }
            catch (e) { /* já logou */ }
            agendar();
        }, INTERVALO_SYNC);
    }
    agendar();
}

// ── Busca filtrada + paginada no cache ────────────────────────────────────────
function buscarNoCache(q = '', pagina = 1, porPagina = 20) {
    let resultado = _dados;

    if (q && q.trim()) {
        const t = q.trim().toLowerCase();
        resultado = resultado.filter(a =>
            (a.colaborador     && a.colaborador.toLowerCase().includes(t))     ||
            (a.avaliador       && a.avaliador.toLowerCase().includes(t))       ||
            (a.lojaTreinada    && a.lojaTreinada.toLowerCase().includes(t))    ||
            (a.funcaoColab     && a.funcaoColab.toLowerCase().includes(t))     ||
            (a.unidade         && a.unidade.toLowerCase().includes(t))         ||
            (a.treinadorFuncao && a.treinadorFuncao.toLowerCase().includes(t))
        );
    }

    const total  = resultado.length;
    const inicio = (pagina - 1) * porPagina;
    const itens  = resultado.slice(inicio, inicio + porPagina);

    return {
        total,
        pagina,
        porPagina,
        totalPaginas: Math.ceil(total / porPagina) || 1,
        itens,
    };
}

// ── Remove do cache (após excluirAvaliacao na planilha) ───────────────────────
function removerDoCache(rowIndex) {
    const idx = parseInt(rowIndex, 10);
    _dados = _dados.filter(a => a.rowIndex !== idx);
    console.log(`[BUSCA-AVAL-CACHE] 🗑️ rowIndex=${idx} removido do cache`);
}

// ── Atualiza item no cache em memória (após editarAvaliacao) ──────────────────
function atualizarNoCache(rowIndex, alteracoes) {
    const idx  = parseInt(rowIndex, 10);
    const aval = _dados.find(a => a.rowIndex === idx);
    if (aval) Object.assign(aval, alteracoes);
}

// ── Status público ────────────────────────────────────────────────────────────
function getStatus() {
    return {
        ok:            !_erro && _dados.length > 0,
        total:         _dados.length,
        ultimaSync:    _ultimaSync?.toISOString() || null,
        proximaSync:   _proxSync?.toISOString()   || null,
        sincronizando: _sincronizando,
        erro:          _erro,
    };
}

// ── Acesso direto ao array completo (usado pela IA) ───────────────────────────
function getDados() {
    return _dados;
}

module.exports = {
    inicializar,
    sincronizar,
    buscarNoCache,
    removerDoCache,
    atualizarNoCache,
    getStatus,
    getDados,
};