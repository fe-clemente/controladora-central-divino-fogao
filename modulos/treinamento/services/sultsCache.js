'use strict';
const fs   = require('fs');
const path = require('path');
// FIX: sults.js não exporta sultsGET — removido da desestruturação
const { getSultsConsolidado } = require('./sults');

// ─── Config ───────────────────────────────────────────────────────────────────
const CACHE_FILE      = path.join(__dirname, '../cache/sults_cache.json');
const CHECK_INTERVAL  = 30 * 60 * 1000;   // verifica a cada 30min
const CACHE_MAX_AGE   = 24 * 60 * 60 * 1000; // força re-sync se cache > 24h

// ─── Memória ──────────────────────────────────────────────────────────────────
let dadosEmMemoria    = null;
let ultimaVerificacao = 0;
let syncEmAndamento   = false;
let checkTimer        = null;

// ─── Helpers de arquivo ───────────────────────────────────────────────────────
function garantirPasta() {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function lerCache() {
    try {
        if (!fs.existsSync(CACHE_FILE)) return null;
        const raw  = fs.readFileSync(CACHE_FILE, 'utf8');
        const json = JSON.parse(raw);
        console.log(`  [SULTS CACHE] Carregado — ${json.dados?.totalUnidades} unidades, ${json.dados?.totalFuncionarios} funcionários`);
        console.log(`  [SULTS CACHE] Última sync: ${json.sincronizadoEm}`);
        return json;
    } catch (e) {
        console.warn('  [SULTS CACHE] Falha ao ler:', e.message);
        return null;
    }
}

function salvarCache(dados, fingerprint) {
    try {
        garantirPasta();
        const payload = {
            sincronizadoEm: new Date().toISOString(),
            fingerprint,
            dados,
        };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
        console.log(`  [SULTS CACHE] Salvo — ${dados.totalUnidades} unidades, ${dados.totalFuncionarios} funcionários`);
    } catch (e) {
        console.warn('  [SULTS CACHE] Falha ao salvar:', e.message);
    }
}

// ─── Fingerprint baseado nos dados já baixados (sem chamada extra à API) ─────
// FIX: antes tentava usar sultsGET que não existe → agora usa dados em memória
function getFingerprintLocal(dados) {
    if (!dados) return null;
    return `emp:${(dados.totalUnidades || 0) + (dados.totalUnidadesImplantacao || 0)}_pes:${dados.totalFuncionarios || 0}`;
}

// ─── Sync completo + atualiza cache ──────────────────────────────────────────
async function sincronizarEAtualizar(motivo = '') {
    if (syncEmAndamento) {
        console.log('  [SULTS CACHE] Sync já em andamento, aguardando...');
        while (syncEmAndamento) await new Promise(r => setTimeout(r, 500));
        return dadosEmMemoria;
    }

    syncEmAndamento = true;
    console.log(`🔄 [SULTS] Iniciando sync completo${motivo ? ' — '+motivo : ''}...`);

    try {
        const dados       = await getSultsConsolidado();
        const fingerprint = getFingerprintLocal(dados);
        salvarCache(dados, fingerprint);
        dadosEmMemoria    = dados;
        ultimaVerificacao = Date.now();
        console.log(`✅ [SULTS] Sync concluído — ${dados.totalUnidades} unidades, ${dados.totalFuncionarios} funcionários`);
        return dados;
    } catch (e) {
        console.error('❌ [SULTS] Sync falhou:', e.message);
        throw e;
    } finally {
        syncEmAndamento = false;
    }
}

// ─── Verificação periódica (baseada em idade do cache) ────────────────────────
// FIX: removida a verificação por fingerprint via API (causava erro sultsGET)
// Agora verifica apenas por tempo — re-sync se cache > 24h
async function verificarMudancas() {
    if (syncEmAndamento) return;

    const cache = lerCache();
    const agora = Date.now();

    if (!cache) {
        await sincronizarEAtualizar('sem cache');
        return;
    }

    const idadeCache = agora - new Date(cache.sincronizadoEm).getTime();
    if (idadeCache > CACHE_MAX_AGE) {
        console.log('  [SULTS CACHE] Cache com mais de 24h — re-sincronizando...');
        await sincronizarEAtualizar('cache expirado');
    } else {
        const minutosRestantes = Math.round((CACHE_MAX_AGE - idadeCache) / 60000);
        console.log(`  [SULTS CACHE] Cache válido — próxima sync em ~${minutosRestantes}min ✓`);
        ultimaVerificacao = agora;
    }
}

// ─── Inicialização ────────────────────────────────────────────────────────────
async function inicializar() {
    console.log('🏪 [SULTS] Inicializando cache...');
    const cache = lerCache();

    if (cache && cache.dados) {
        dadosEmMemoria    = cache.dados;
        ultimaVerificacao = Date.now();
        console.log('⚡ [SULTS] Dados carregados do cache — servidor pronto imediatamente!');

        // Verifica mudanças em background após 10s (sem travar o boot)
        setTimeout(async () => {
            try { await verificarMudancas(); } catch(e) {
                console.warn('  [SULTS] Verificação background falhou:', e.message);
            }
        }, 10000);
    } else {
        console.log('  [SULTS] Sem cache — fazendo sync inicial (pode demorar ~40s)...');
        try {
            await sincronizarEAtualizar('primeira inicialização');
        } catch(e) {
            console.error('❌ [SULTS] Sync inicial falhou:', e.message);
        }
    }

    // Agenda verificações periódicas a cada 30min
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = setInterval(async () => {
        try { await verificarMudancas(); } catch(e) {
            console.warn('  [SULTS CACHE] Verificação periódica falhou:', e.message);
        }
    }, CHECK_INTERVAL);

    console.log(`⏰ [SULTS] Verificação automática a cada ${CHECK_INTERVAL/60000} minutos`);
}

// ─── Acesso aos dados ─────────────────────────────────────────────────────────
function getDados() {
    return dadosEmMemoria;
}

function getStatus() {
    const cache = lerCache();
    return {
        temCache:          !!dadosEmMemoria,
        sincronizadoEm:    dadosEmMemoria?.sincronizadoEm || null,
        totalUnidades:     dadosEmMemoria?.totalUnidades || 0,
        totalFuncionarios: dadosEmMemoria?.totalFuncionarios || 0,
        ultimaVerificacao: ultimaVerificacao ? new Date(ultimaVerificacao).toISOString() : null,
        syncEmAndamento,
        proximaVerificacao: ultimaVerificacao
            ? new Date(ultimaVerificacao + CHECK_INTERVAL).toISOString()
            : null,
        cacheFile: CACHE_FILE,
        idadeCache: cache ? Math.round((Date.now() - new Date(cache.sincronizadoEm).getTime()) / 60000) + ' min' : null,
    };
}

module.exports = { inicializar, getDados, getStatus, sincronizarEAtualizar };