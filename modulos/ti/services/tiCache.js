// services/tiCache.js — Cache em arquivo para todos os módulos T.I.
'use strict';
const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../cache');

// Mapa de chaves conhecidas → arquivo de cache
// Chaves dinâmicas (ex: ativos_computadores) usam arquivo genérico
const ARQUIVOS = {
    ativos:   path.join(DIR, 'ativos_cache.json'),      // ← era 'ti_ativos_cache.json'
    projetos: path.join(DIR, 'ti_projetos_cache.json'),
    migracao: path.join(DIR, 'ti_migracao_cache.json'),
};

function _arquivo(tipo) {
    if (ARQUIVOS[tipo]) return ARQUIVOS[tipo];
    // Chaves dinâmicas do ativosService (ex: "ativos_computadores")
    const nome = tipo.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(DIR, `ti_${nome}_cache.json`);
}

function lerCache(tipo) {
    try {
        const f = _arquivo(tipo);
        if (!fs.existsSync(f)) return null;
        const raw = fs.readFileSync(f, 'utf8');
        if (!raw || !raw.trim()) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.error('[tiCache] erro ao ler:', tipo, e.message);
        return null;
    }
}

function salvarCache(tipo, dados) {
    try {
        if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
        const f = _arquivo(tipo);
        // Se dados for null/undefined, remove o arquivo (invalida cache)
        if (dados == null) {
            if (fs.existsSync(f)) fs.unlinkSync(f);
            return;
        }
        fs.writeFileSync(f, JSON.stringify(
            { ...dados, _savedAt: new Date().toISOString() },
            null, 2
        ));
    } catch (e) {
        console.error('[tiCache] erro ao salvar:', tipo, e.message);
    }
}

function limparCache(tipo) {
    try {
        if (tipo) {
            const f = _arquivo(tipo);
            if (fs.existsSync(f)) fs.unlinkSync(f);
        } else {
            // Sem argumento: limpa todos os caches da pasta
            if (!fs.existsSync(DIR)) return;
            fs.readdirSync(DIR)
                .filter(n => n.startsWith('ti_') && n.endsWith('_cache.json'))
                .forEach(n => fs.unlinkSync(path.join(DIR, n)));
        }
    } catch (e) {
        console.error('[tiCache] erro ao limpar:', e.message);
    }
}

module.exports = { lerCache, salvarCache, limparCache };