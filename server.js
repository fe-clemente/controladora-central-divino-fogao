// ============================================================
//  server.js — Divino Fogão · Central de Sistemas
// ============================================================
'use strict';

require('dotenv').config();

if (process.env.GOOGLE_KEY_FILE) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_KEY_FILE;
}

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const cors     = require('cors');
const session  = require('express-session');
const passport = require('./core/auth');
const { middlewarePerfil, exigirModulo, exigirMaster } = require('./core/permissoes');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'divino-central-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' },
}));
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
    const cor = req.method === 'POST'   ? '\x1b[33m'
              : req.method === 'GET'    ? '\x1b[36m'
              : req.method === 'PATCH'  ? '\x1b[35m'
              : req.method === 'DELETE' ? '\x1b[31m' : '\x1b[37m';
    console.log(cor + '[' + new Date().toLocaleTimeString('pt-BR') + '] ' +
        req.method.padEnd(6) + ' ' + req.originalUrl + '\x1b[0m');
    next();
});

function debugRotas(app) {
    console.log('\n\x1b[35m[DEBUG] Rotas registradas:\x1b[0m');
    app._router.stack.forEach(layer => {
        if (layer.route) {
            const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
            console.log(`  \x1b[36m${methods.padEnd(6)}\x1b[0m ${layer.route.path}`);
        } else if (layer.name === 'router' && layer.regexp) {
            console.log(`  \x1b[33mROUTER\x1b[0m  ${layer.regexp}`);
        }
    });
    console.log('');
}

app.use(middlewarePerfil);
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ─── Auth ────────────────────────────────────────────────────
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/auth/google', passport.authenticate('google', {
    scope: ['profile', 'email'], prompt: 'select_account', hd: 'divinofogao.com.br',
}));
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?erro=acesso' }),
    (req, res) => res.redirect('/')
);
app.get('/logout', (req, res) => req.logout(() => res.redirect('/login')));
app.get('/auth/me', (req, res) => {
    if (!req.isAuthenticated?.()) return res.status(401).json({ logado: false });
    res.json({ logado: true, usuario: req.user });
});

function exigirLogin(req, res, next) {
    if (req.isAuthenticated?.()) return next();
    const isApi = req.xhr || req.headers.accept?.includes('application/json') || req.method !== 'GET';
    console.log(`\x1b[31m[AUTH] Bloqueado: ${req.method} ${req.originalUrl}\x1b[0m`);
    return isApi
        ? res.status(401).json({ ok: false, erro: 'Sessão expirada. Faça login.' })
        : res.redirect('/login');
}

const apenasLocal = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (isLocal) return next();

    return res.status(401).json({ ok: false, erro: 'Sessão expirada. Faça login.' });
};

// ─── Páginas globais ─────────────────────────────────────────
app.get('/',           exigirLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/index.html', exigirLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/sem-acesso',              (req, res) => res.sendFile(path.join(__dirname, 'public', 'sem-acesso.html')));

// ─── Master ──────────────────────────────────────────────────
const masterRoutes = require('./core/masterService');
app.get('/master.html', exigirLogin, exigirMaster,
    (req, res) => res.sendFile(path.join(__dirname, 'public', 'master.html')));
app.use('/master', exigirLogin, exigirMaster, masterRoutes);

// ═════════════════════════════════════════════════════════════
//  MÓDULOS — auto-detecção via filesystem
// ═════════════════════════════════════════════════════════════
const MODULOS_DIR = path.join(__dirname, 'modulos');

// Detecta automaticamente qualquer pasta com routes.js
const modulos = fs.readdirSync(MODULOS_DIR).filter(nome => {
    try {
        return fs.statSync(path.join(MODULOS_DIR, nome)).isDirectory()
            && fs.existsSync(path.join(MODULOS_DIR, nome, 'routes.js'));
    } catch { return false; }
});
console.log(`\n\x1b[35m[MÓDULOS] Detectados: ${modulos.join(', ')}\x1b[0m`);

// Resolve arquivo raiz — prioridade:
// 1. Campo "raiz" no modulo.json do módulo
// 2. index.html
// 3. dashboard.html / ativos.html
// 4. Primeiro .html encontrado na pasta public/
function resolverArquivoRaiz(mod) {
    const pubDir  = path.join(MODULOS_DIR, mod, 'public');
    const jsonPath = path.join(MODULOS_DIR, mod, 'modulo.json');

    // 1. modulo.json define explicitamente o arquivo raiz
    try {
        const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (meta.raiz && fs.existsSync(path.join(pubDir, meta.raiz))) return meta.raiz;
    } catch {}

    if (!fs.existsSync(pubDir)) return 'index.html';

    // 2. Candidatos padrão
    for (const c of ['index.html', 'dashboard.html', 'dashborard-treinamento.html', 'ativos.html']) {
        if (fs.existsSync(path.join(pubDir, c))) return c;
    }

    // 3. Fallback: primeiro .html (excluindo arquivos de formulário/avaliação)
    const htmls = fs.readdirSync(pubDir)
        .filter(f => f.endsWith('.html') && !f.includes('avalia') && !f.includes('form'));
    return htmls[0] || 'index.html';
}

// Rota raiz de cada módulo
modulos.forEach(mod => {
    app.get(`/${mod}`, exigirLogin, exigirModulo(mod), (req, res) => {
        const arquivo = resolverArquivoRaiz(mod);
        const file = path.join(MODULOS_DIR, mod, 'public', arquivo);
        console.log(`\x1b[32m[MÓDULO] /${mod} → ${arquivo}\x1b[0m`);
        res.sendFile(file);
    });
});

// Cache de routes já carregados
const rotasCache = {};
function getRoutes(mod) {
    if (!rotasCache[mod]) rotasCache[mod] = require(path.join(MODULOS_DIR, mod, 'routes'));
    return rotasCache[mod];
}

// Pré-carrega módulos com rotas apenasLocal
const tiRoutes          = getRoutes('ti');
const treinamentoRoutes = getRoutes('treinamento');

// Rotas de sync localhost (TI)
app.post('/ti/api/pix/sincronizar',              exigirLogin, (req, res, next) => { req.url = '/api/pix/sincronizar';              tiRoutes(req, res, next); });
app.post('/ti/api/chamados/sincronizar',          exigirLogin, (req, res, next) => { req.url = '/api/chamados/sincronizar';          tiRoutes(req, res, next); });
app.post('/ti/api/chamados/sincronizar/completo', exigirLogin, (req, res, next) => { req.url = '/api/chamados/sincronizar/completo'; tiRoutes(req, res, next); });

// Rotas de sync localhost (Treinamento)
app.post('/treinamento/sults/sincronizar',        apenasLocal, (req, res, next) => { req.url = '/sults/sincronizar';        treinamentoRoutes(req, res, next); });
app.post('/treinamento/chamados/sincronizar',     apenasLocal, (req, res, next) => { req.url = '/chamados/sincronizar';     treinamentoRoutes(req, res, next); });
app.post('/treinamento/turnover/sincronizar',     apenasLocal, (req, res, next) => { req.url = '/turnover/sincronizar';     treinamentoRoutes(req, res, next); });
app.post('/treinamento/universidade/sincronizar', apenasLocal, (req, res, next) => { req.url = '/universidade/sincronizar'; treinamentoRoutes(req, res, next); });

// ─── ROTAS PÚBLICAS — sem autenticação ───────────────────────
// Avaliação de treinamento: acessível por franqueados externos
app.get('/treinamento/avaliacao',         (req, res, next) => { req.url = '/avaliacao';         treinamentoRoutes(req, res, next); });
app.get('/treinamento/avaliacao/dados',   (req, res, next) => { req.url = '/avaliacao/dados';   treinamentoRoutes(req, res, next); });
app.post('/treinamento/avaliacao/registrar', (req, res, next) => { req.url = '/avaliacao/registrar'; treinamentoRoutes(req, res, next); });
// Registra todos os módulos detectados
for (const mod of modulos) {
    try {
        app.use(`/${mod}`, exigirLogin, exigirModulo(mod), getRoutes(mod));
        console.log(`  ✅ Módulo ${mod} carregado`);
    } catch (e) {
        console.error(`  ❌ Módulo ${mod} ERRO:`, e.message);
    }
}

// ─── API de módulos (consumida pelo master e index) ──────────
app.get('/api/modulos', exigirLogin, (req, res) => {
    const lista = modulos.map(mod => {
        const jsonPath = path.join(MODULOS_DIR, mod, 'modulo.json');
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch {}
        return {
            id:     mod,
            nome:   meta.nome   || mod.charAt(0).toUpperCase() + mod.slice(1),
            desc:   meta.desc   || `Módulo ${mod}.`,
            icon:   meta.icon   || '📦',
            tag:    meta.tag    || mod,
            accent: meta.accent || '#7c3aed',
            href:   `/${mod}`,
        };
    });
    res.json({ ok: true, modulos: lista });
});

// ─── Health ──────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
    ok: true,
    status: 'online',
    uptime: Math.floor(process.uptime()) + 's',
    hora:   new Date().toLocaleString('pt-BR'),
    modulos,
}));

// ─── 404 / Erro ──────────────────────────────────────────────
app.use((req, res) => {
    console.log(`\x1b[31m[404] ${req.method} ${req.originalUrl}\x1b[0m`);
    res.status(404).json({ erro: 'Rota não encontrada: ' + req.originalUrl });
});
app.use((err, req, res, next) => {
    console.error('[Erro]', err.message);
    res.status(500).json({ erro: err.message });
});

// ─── Start ───────────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log('');
    console.log('  🍽️  Divino Fogão — Central de Sistemas');
    console.log(`  🚀  http://localhost:${PORT}`);
    console.log(`  🔐  Login:  http://localhost:${PORT}/login`);
    console.log(`  ⚡  Master: http://localhost:${PORT}/master.html`);
    console.log('');
    debugRotas(app);
});

server.timeout = 120000;
server.keepAliveTimeout = 120000;