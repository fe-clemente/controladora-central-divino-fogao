/* ═══════════════════════════════════════════════════════════════════════
   turnoverCache.js — Cache em memória para dados de Turnover
   Fonte: aba "Controle TurnOver"
   Auto-refresh a cada 2 horas.
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

const { getTurnoverCadastral, getTurnoverRegistros } = require('./turnover');

const INTERVALO_MS = 2 * 60 * 60 * 1000; // 2 horas

let _cache      = null;
let _ultimaSync = null;
let _status     = 'aguardando'; // 'aguardando' | 'sincronizando' | 'pronto' | 'erro'
let _erroMsg    = null;

// ─── sincronizarEAtualizar() ────────────────────────────────────────────────
async function sincronizarEAtualizar(origem) {
    origem = origem || 'auto';
    console.log(`🔄 TurnoverCache: sincronizando (${origem})...`);
    _status = 'sincronizando';

    try {
        const anoAtual = String(new Date().getFullYear());

        // Dados consolidados do ano atual + anos disponíveis
        const dados     = await getTurnoverCadastral(anoAtual);
        const dadosTodos = await getTurnoverCadastral(null);

        // Garante que a lista de anos sempre tem os padrões
        const anosSet = new Set(dadosTodos.anos || []);
        [2024, 2025, 2026].forEach(a => anosSet.add(a));
        dados.anos = [...anosSet].sort();

        // Registros individuais (todos os anos para a tabela)
        const { registros } = await getTurnoverRegistros(null);

        _cache = {
            ...dados,
            registros,
            sincronizadoEm: new Date().toISOString(),
        };

        _ultimaSync = Date.now();
        _status     = 'pronto';
        _erroMsg    = null;

        console.log(`✅ TurnoverCache OK — ${registros.length} registros · ${dados.desligadosAno} desligamentos · ${dados.pctTurnover}% turnover`);
        return _cache;
    } catch (e) {
        _status  = 'erro';
        _erroMsg = e.message;
        console.error('❌ TurnoverCache falhou:', e.message);
        throw e;
    }
}

// ─── inicializar() ───────────────────────────────────────────────────────────
async function inicializar() {
    await sincronizarEAtualizar('boot');
    setInterval(function () {
        sincronizarEAtualizar('auto').catch(function () {});
    }, INTERVALO_MS);
}

// ─── getDados() ──────────────────────────────────────────────────────────────
function getDados() { return _cache; }

// ─── getStatus() ─────────────────────────────────────────────────────────────
function getStatus() {
    return {
        status:         _status,
        ultimaSync:     _ultimaSync ? new Date(_ultimaSync).toISOString() : null,
        sincronizadoEm: _cache ? _cache.sincronizadoEm : null,
        totalRegistros: _cache ? (_cache.registros || []).length : 0,
        pctTurnover:    _cache ? _cache.pctTurnover : null,
        erro:           _erroMsg || null,
    };
}

module.exports = {
    inicializar,
    sincronizarEAtualizar,
    getDados,
    getStatus,
};