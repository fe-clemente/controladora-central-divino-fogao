'use strict';
const fs   = require('fs');
const path = require('path');
const { getUniversidadeConsolidado } = require('./universidade');

// ─── Config ───────────────────────────────────────────────────────────────────
const CACHE_FILE     = path.join(__dirname, '../cache/universidade_cache.json');
const CHECK_INTERVAL = 30 * 60 * 1000;        // verifica a cada 30min
const CACHE_MAX_AGE  = 24 * 60 * 60 * 1000;   // força re-sync se cache > 24h

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
        console.log(`  [UNIV CACHE] Carregado — ${json.dados?.totalLinhas} linhas, ${json.dados?.totalUnidades} unidades`);
        console.log(`  [UNIV CACHE] Última sync: ${json.sincronizadoEm}`);
        return json;
    } catch (e) {
        console.warn('  [UNIV CACHE] Falha ao ler:', e.message);
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
        console.log(`  [UNIV CACHE] Salvo — ${dados.totalLinhas} linhas, ${dados.totalUnidades} unidades`);
    } catch (e) {
        console.warn('  [UNIV CACHE] Falha ao salvar:', e.message);
    }
}

function getFingerprintLocal(dados) {
    if (!dados) return null;
    return `linhas:${dados.totalLinhas || 0}_unidades:${dados.totalUnidades || 0}_formacoes:${dados.totalFormacoes || 0}`;
}

// ─── Sync completo + atualiza cache ──────────────────────────────────────────
async function sincronizarEAtualizar(motivo) {
    motivo = motivo || '';
    if (syncEmAndamento) {
        console.log('  [UNIV CACHE] Sync já em andamento, aguardando...');
        while (syncEmAndamento) await new Promise(r => setTimeout(r, 500));
        return dadosEmMemoria;
    }

    syncEmAndamento = true;
    console.log(`🔄 [UNIVERSIDADE] Iniciando sync${motivo ? ' — ' + motivo : ''}...`);

    try {
        const dados       = await getUniversidadeConsolidado();
        const fingerprint = getFingerprintLocal(dados);
        salvarCache(dados, fingerprint);
        dadosEmMemoria    = dados;
        ultimaVerificacao = Date.now();
        console.log(`✅ [UNIVERSIDADE] Sync concluído — ${dados.totalLinhas} linhas, ${dados.totalUnidades} unidades`);
        return dados;
    } catch (e) {
        console.error('❌ [UNIVERSIDADE] Sync falhou:', e.message);
        throw e;
    } finally {
        syncEmAndamento = false;
    }
}

// ─── Verificação periódica (baseada em idade do cache) ────────────────────────
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
        console.log('  [UNIV CACHE] Cache com mais de 24h — re-sincronizando...');
        await sincronizarEAtualizar('cache expirado');
    } else {
        const minutosRestantes = Math.round((CACHE_MAX_AGE - idadeCache) / 60000);
        console.log(`  [UNIV CACHE] Cache válido — próxima sync em ~${minutosRestantes}min ✓`);
        ultimaVerificacao = agora;
    }
}

// ─── Inicialização ────────────────────────────────────────────────────────────
async function inicializar() {
    console.log('🎓 [UNIVERSIDADE] Inicializando cache...');
    const cache = lerCache();

    if (cache && cache.dados) {
        dadosEmMemoria    = cache.dados;
        ultimaVerificacao = Date.now();
        console.log('⚡ [UNIVERSIDADE] Dados carregados do cache — servidor pronto imediatamente!');

        // Verifica mudanças em background após 10s (sem travar o boot)
        setTimeout(async () => {
            try { await verificarMudancas(); } catch(e) {
                console.warn('  [UNIVERSIDADE] Verificação background falhou:', e.message);
            }
        }, 10000);
    } else {
        console.log('  [UNIVERSIDADE] Sem cache — fazendo sync inicial...');
        try {
            await sincronizarEAtualizar('primeira inicialização');
        } catch(e) {
            console.error('❌ [UNIVERSIDADE] Sync inicial falhou:', e.message);
        }
    }

    // Agenda verificações periódicas a cada 30min
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = setInterval(async () => {
        try { await verificarMudancas(); } catch(e) {
            console.warn('  [UNIV CACHE] Verificação periódica falhou:', e.message);
        }
    }, CHECK_INTERVAL);

    console.log(`⏰ [UNIVERSIDADE] Verificação automática a cada ${CHECK_INTERVAL / 60000} minutos`);
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
        totalLinhas:       dadosEmMemoria?.totalLinhas    || 0,
        totalUnidades:     dadosEmMemoria?.totalUnidades  || 0,
        totalFormacoes:    dadosEmMemoria?.totalFormacoes || 0,
        ultimaVerificacao: ultimaVerificacao ? new Date(ultimaVerificacao).toISOString() : null,
        syncEmAndamento,
        proximaVerificacao: ultimaVerificacao
            ? new Date(ultimaVerificacao + CHECK_INTERVAL).toISOString()
            : null,
        cacheFile:  CACHE_FILE,
        idadeCache: cache
            ? Math.round((Date.now() - new Date(cache.sincronizadoEm).getTime()) / 60000) + ' min'
            : null,
    };
}

module.exports = { inicializar, getDados, getStatus, sincronizarEAtualizar };