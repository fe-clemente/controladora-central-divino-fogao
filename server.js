// ============================================================
//  server.js — Divino Fogão · Central de Sistemas
// ============================================================
'use strict';

require('dotenv').config();

// ─── Google Application Credentials ─────────────────────────────────────────
if (process.env.GOOGLE_KEY_FILE) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_KEY_FILE;
}

const express  = require('express');
const path     = require('path');
const cors     = require('cors');
const session  = require('express-session');
const passport = require('./core/auth');
const { middlewarePerfil, exigirModulo, exigirMaster } = require('./core/permissoes');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middlewares base ────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
    secret:            process.env.SESSION_SECRET || 'divino-central-secret',
    resave:            false,
    saveUninitialized: false,
    cookie:            { maxAge: 24 * 60 * 60 * 1000 },
}));

app.use(passport.initialize());
app.use(passport.session());

// ─── Log de requisições (DEBUG) ──────────────────────────────
app.use((req, res, next) => {
    const cor = req.method === 'POST'   ? '\x1b[33m'
              : req.method === 'GET'    ? '\x1b[36m'
              : req.method === 'PATCH'  ? '\x1b[35m'
              : req.method === 'DELETE' ? '\x1b[31m'
              : '\x1b[37m';
    console.log(cor + '[' + new Date().toLocaleTimeString('pt-BR') + '] ' +
        req.method.padEnd(6) + ' ' + req.originalUrl + '\x1b[0m');
    next();
});

// ─── DEBUG: mostra todas as rotas registradas no boot ────────
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

// Injeta perfil em todas as rotas
app.use(middlewarePerfil);

// Estáticos públicos (login.html, logo, etc.)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ─── Auth Google ─────────────────────────────────────────────
app.get('/login', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.get('/auth/google',
    passport.authenticate('google', {
        scope: ['profile', 'email'], prompt: 'select_account', hd: 'divinofogao.com.br',
    })
);

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?erro=acesso' }),
    (req, res) => res.redirect('/')
);

app.get('/logout', (req, res) => req.logout(() => res.redirect('/login')));

app.get('/auth/me', (req, res) => {
    if (!req.isAuthenticated?.()) return res.status(401).json({ logado: false });
    res.json({ logado: true, usuario: req.user });
});

// ─── Middleware de login ──────────────────────────────────────
function exigirLogin(req, res, next) {
    if (req.isAuthenticated?.()) return next();
    const isApi = req.xhr ||
        req.headers.accept?.includes('application/json') ||
        req.method !== 'GET';
    console.log(`\x1b[31m[AUTH] Bloqueado: ${req.method} ${req.originalUrl} | autenticado: false\x1b[0m`);
    return isApi
        ? res.status(401).json({ ok: false, erro: 'Sessão expirada. Faça login.' })
        : res.redirect('/login');
}

// ─── Middleware localhost — permite sync sem login ────────────
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
//  MÓDULOS
// ═════════════════════════════════════════════════════════════

const modulos = ['ti', 'treinamento', 'suprimentos', 'marketing', 'juridico'];

// ─── Arquivo raiz de cada módulo (evita hardcode de index.html) ──
const moduloIndex = {
    ti:          'index.html',
    treinamento: 'dashborard-treinamento.html',
    suprimentos: 'index.html',
    marketing:   'index.html',
    juridico:    'ativos.html',
};

// ─── Rota raiz de cada módulo (/ti, /treinamento, etc.) ──────
modulos.forEach(mod => {
    app.get(`/${mod}`, exigirLogin, exigirModulo(mod), (req, res) => {
        const arquivo = moduloIndex[mod] || 'index.html';
        const file = path.join(__dirname, `modulos/${mod}/public`, arquivo);
        console.log(`\x1b[32m[MÓDULO] Servindo raiz /${mod} → ${file}\x1b[0m`);
        res.sendFile(file);
    });
});

// ─── Carrega rotas dos módulos ANTES de registrar rotas locais ───
// FIX: declarar as variáveis aqui para uso nas rotas apenasLocal abaixo
const tiRoutes          = require('./modulos/ti/routes');
const treinamentoRoutes = require('./modulos/treinamento/routes');
const juridicoRoutes    = require('./modulos/juridico/routes');

// ─── Rotas de sync liberadas para localhost (ANTES do exigirLogin) ───
app.post('/ti/api/pix/sincronizar',              apenasLocal, (req, res, next) => { req.url = '/api/pix/sincronizar';              tiRoutes(req, res, next); });
app.post('/ti/api/chamados/sincronizar',          apenasLocal, (req, res, next) => { req.url = '/api/chamados/sincronizar';          tiRoutes(req, res, next); });
app.post('/ti/api/chamados/sincronizar/completo', apenasLocal, (req, res, next) => { req.url = '/api/chamados/sincronizar/completo'; tiRoutes(req, res, next); });

// ─── Rotas de sync do treinamento liberadas para localhost ───────
app.post('/treinamento/sults/sincronizar',        apenasLocal, (req, res, next) => { req.url = '/sults/sincronizar';        treinamentoRoutes(req, res, next); });
app.post('/treinamento/chamados/sincronizar',     apenasLocal, (req, res, next) => { req.url = '/chamados/sincronizar';     treinamentoRoutes(req, res, next); });
app.post('/treinamento/turnover/sincronizar',     apenasLocal, (req, res, next) => { req.url = '/turnover/sincronizar';     treinamentoRoutes(req, res, next); });
app.post('/treinamento/universidade/sincronizar', apenasLocal, (req, res, next) => { req.url = '/universidade/sincronizar'; treinamentoRoutes(req, res, next); });

// ─── Rotas e APIs de cada módulo ─────────────────────────────
// FIX: usa as variáveis já carregadas acima para ti, treinamento e juridico
const rotasModulos = { ti: tiRoutes, treinamento: treinamentoRoutes, juridico: juridicoRoutes };

for (const mod of modulos) {
    try {
        const routes = rotasModulos[mod] || require(`./modulos/${mod}/routes`);
        app.use(`/${mod}`, exigirLogin, exigirModulo(mod), routes);
        console.log(`  ✅ Módulo ${mod} carregado`);
    } catch (e) {
        console.error(`  ❌ Módulo ${mod} ERRO:`, e);
    }
}

// ═════════════════════════════════════════════════════════════

// ─── Health ──────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
    status: 'online',
    uptime: Math.floor(process.uptime()) + 's',
    hora:   new Date().toLocaleString('pt-BR'),
    modulos,
}));

// ─── 404 / Erro ──────────────────────────────────────────────
app.use((req, res) => {
    console.log(`\x1b[31m[404] Rota não encontrada: ${req.method} ${req.originalUrl}\x1b[0m`);
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