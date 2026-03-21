// services/permissoes.js — Controle de acesso via Google Sheets
// Planilha: https://docs.google.com/spreadsheets/d/1l3U369m_jss0n1rBrQzfubm7k5kme73O--urJxme6aU
// Aba: Gestao_Login
// Colunas: Email | Nome | Modulos | Ativo
'use strict';

const { google } = require('googleapis');
const path = require('path');

const SHEET_ID  = process.env.USUARIOS_SHEET_ID || '1l3U369m_jss0n1rBrQzfubm7k5kme73O--urJxme6aU';
const ABA       = process.env.USUARIOS_ABA      || 'Gestao_Login';
const MASTER    = (process.env.MASTER_EMAIL     || 'fernando.clemente@divinofogao.com.br').toLowerCase();

// Cache em memória — recarrega a cada 5 minutos
let _cache     = null;
let _cacheTime = 0;
const TTL      = 5 * 60 * 1000;

async function getSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_KEY_FILE || './minha-chave.json',
        scopes:  ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

async function carregarUsuarios(forcar = false) {
    if (!forcar && _cache && (Date.now() - _cacheTime) < TTL) return _cache;

    try {
        const sheets = await getSheets();
        const r = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range:         `'${ABA}'`,
        });

        const rows = r.data.values || [];
        // Pula cabeçalho (linha 1)
        _cache = rows.slice(1)
            .filter(row => row[0] && row[3] && String(row[3]).toUpperCase() === 'SIM')
            .map(row => ({
                email:   String(row[0] || '').toLowerCase().trim(),
                nome:    row[1] || '',
                modulos: String(row[2] || '').toLowerCase().split(',').map(m => m.trim()).filter(Boolean),
                ativo:   String(row[3] || '').toUpperCase() === 'SIM',
            }));

        _cacheTime = Date.now();
        console.log(`[Permissões] ${_cache.length} usuários carregados da planilha`);
    } catch (e) {
        console.error('[Permissões] Erro ao carregar usuários:', e.message);
        if (!_cache) _cache = [];
    }

    return _cache;
}

async function buscarUsuario(email) {
    const emailLower = String(email || '').toLowerCase().trim();

    // Master sempre tem acesso total — não precisa estar na planilha
    if (emailLower === MASTER) {
        return {
            email:   emailLower,
            nome:    'Fernando',
            modulos: ['master'],
            ativo:   true,
            isMaster: true,
        };
    }

    const usuarios = await carregarUsuarios();
    return usuarios.find(u => u.email === emailLower) || null;
}

function temAcesso(usuario, modulo) {
    if (!usuario) return false;
    if (usuario.isMaster || usuario.modulos.includes('master')) return true;
    return usuario.modulos.includes(modulo.toLowerCase());
}

// Middleware — injeta req.perfil com dados do usuário logado
async function middlewarePerfil(req, res, next) {
    if (!req.isAuthenticated || !req.isAuthenticated()) return next();
    try {
        const perfil = await buscarUsuario(req.user?.email);
        req.perfil = perfil;
    } catch { req.perfil = null; }
    next();
}

// Middleware — exige acesso a um módulo específico
function exigirModulo(modulo) {
    return async (req, res, next) => {
        if (!req.isAuthenticated || !req.isAuthenticated()) {
            return req.headers.accept?.includes('application/json')
                ? res.status(401).json({ ok: false, erro: 'Não autenticado' })
                : res.redirect('/login');
        }
        const perfil = req.perfil || await buscarUsuario(req.user?.email);
        if (!perfil || !temAcesso(perfil, modulo)) {
            return req.headers.accept?.includes('application/json')
                ? res.status(403).json({ ok: false, erro: 'Sem permissão para este módulo' })
                : res.redirect('/sem-acesso');
        }
        req.perfil = perfil;
        next();
    };
}

// Middleware — exige ser master
function exigirMaster(req, res, next) {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ ok: false, erro: 'Não autenticado' });
    }
    const email = String(req.user?.email || '').toLowerCase();
    const isMaster = email === MASTER ||
        (req.perfil?.modulos || []).includes('master');

    if (!isMaster) {
        return res.status(403).json({ ok: false, erro: 'Acesso restrito ao master' });
    }
    next();
}

module.exports = {
    carregarUsuarios,
    buscarUsuario,
    temAcesso,
    middlewarePerfil,
    exigirModulo,
    exigirMaster,
};
