/* ═══════════════════════════════════════════════════════════════════════
   turnoverCache.js — Cache em memória para dados de Turnover
   Padrão idêntico ao sultsCache.js
   Auto-refresh a cada 2 horas.
   ═══════════════════════════════════════════════════════════════════════ */

const { getTurnoverCadastral, getTurnoverRegistros } = require('./turnover');

const INTERVALO_MS = 2 * 60 * 60 * 1000; // 2 horas

let _cache       = null;
let _ultimaSync  = null;
let _status      = 'aguardando'; // 'aguardando' | 'sincronizando' | 'pronto' | 'erro'
let _erroMsg     = null;

// ─── sincronizarEAtualizar() ────────────────────────────────────────────────
async function sincronizarEAtualizar(origem) {
    origem = origem || 'auto';
    console.log(`🔄 TurnoverCache: sincronizando (${origem})...`);
    _status = 'sincronizando';

    try {
        const anoAtual = String(new Date().getFullYear());

        // Busca dados consolidados do ano atual
const dados = await getTurnoverCadastral(anoAtual);
const dadosTodos = await getTurnoverCadastral(null);

// Garante que o ano atual sempre aparece no seletor,
// mesmo que ninguém tenha data preenchida nas colunas AJ/AK
const anosSet = new Set(dadosTodos.anos || []);
anosSet.add(parseInt(anoAtual));
// Adiciona também anos anteriores como fallback
anosSet.add(2024);
anosSet.add(2025);
anosSet.add(2026);
dados.anos = [...anosSet].sort();
        // Busca registros individuais (tabela completa)
        const { registros } = await getTurnoverRegistros(null); // todos os anos

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

    // Auto-refresh a cada 2 horas
    setInterval(function () {
        sincronizarEAtualizar('auto').catch(function () {});
    }, INTERVALO_MS);
}

// ─── getDados() ──────────────────────────────────────────────────────────────
function getDados() {
    return _cache;
}

// ─── getStatus() ─────────────────────────────────────────────────────────────
function getStatus() {
    return {
        status:        _status,
        ultimaSync:    _ultimaSync ? new Date(_ultimaSync).toISOString() : null,
        sincronizadoEm: _cache ? _cache.sincronizadoEm : null,
        totalRegistros: _cache ? (_cache.registros || []).length : 0,
        pctTurnover:   _cache ? _cache.pctTurnover : null,
        erro:          _erroMsg || null,
    };
}

module.exports = {
    inicializar,
    sincronizarEAtualizar,
    getDados,
    getStatus,
};