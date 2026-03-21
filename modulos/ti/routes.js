'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

const PUBLIC_DIR = path.join(__dirname, 'public');
const pub = f => path.join(PUBLIC_DIR, f);

// ─── SERVICES: SEMPRE ANTES DE USAR ──────────────────────────
const tiDashRoutes   = require('./services/tiDashboardService');
const projetosRoutes = require('./services/projetosService');
const migracaoRoutes = require('./services/migracao');
const ativosRoutes   = require('./services/ativosService');
const chamadosCache  = require('./services/chamadosTiCache');
const pixRoutes      = require('./services/pixService');
const linksRoutes    = require('./services/linksexternosservice');

// ─── Permite sync sem login quando vem do próprio servidor ───
const apenasLocal = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (isLocal) return next();
    return res.status(401).json({ ok: false, erro: 'Sessão expirada. Faça login.' });
};

// ─── DEBUG ───────────────────────────────────────────────────
router.use((req, res, next) => {
    console.log(`\x1b[34m[TI ROUTER]\x1b[0m ${req.method} ${req.originalUrl} | path=${req.path}`);
    next();
});

// ─── Estáticos ───────────────────────────────────────────────
router.use(express.static(PUBLIC_DIR));

// ─── Helper para servir HTML com debug ───────────────────────
function servirHtml(nomeArquivo) {
    return (req, res) => {
        const arquivo = pub(nomeArquivo);
        const existe = fs.existsSync(arquivo);

        console.log(`\x1b[36m[TI HTML]\x1b[0m ${req.originalUrl}`);
        console.log(`   arquivo: ${arquivo}`);
        console.log(`   existe: ${existe ? 'SIM' : 'NÃO'}`);

        if (!existe) {
            return res.status(404).json({
                erro: `Arquivo HTML não encontrado: ${nomeArquivo}`,
                caminho: arquivo
            });
        }

        res.sendFile(arquivo);
    };
}

// ─── PÁGINAS ─────────────────────────────────────────────────
router.get('/',           servirHtml('index.html'));
router.get('/index.html', servirHtml('index.html'));

router.get('/ativos',                 servirHtml('ativos.html'));
router.get('/controle-equipamentos',  servirHtml('controle-equipamentos.html'));
router.get('/migracao',               servirHtml('migracao.html'));
router.get('/projetos',               servirHtml('projetos.html'));
router.get('/chamados',               servirHtml('chamados.html'));
router.get('/pix',                    servirHtml('pix.html'));
router.get('/linkexterno',            servirHtml('linkexterno.html'));

router.get('/ativos.html',                servirHtml('ativos.html'));
router.get('/controle-equipamentos.html', servirHtml('controle-equipamentos.html'));
router.get('/migracao.html',              servirHtml('migracao.html'));
router.get('/projetos.html',              servirHtml('projetos.html'));
router.get('/chamados.html',              servirHtml('chamados.html'));
router.get('/pix.html',                   servirHtml('pix.html'));
router.get('/linkexterno.html',           servirHtml('linkexterno.html'));

// ─── APIs ────────────────────────────────────────────────────
router.use('/api/dashboard', tiDashRoutes);
router.use('/api/projetos',  projetosRoutes);
router.use('/api/migracao',  migracaoRoutes);
router.use('/api/ativos',    ativosRoutes);
router.use('/api/links',     linksRoutes);

// ─── Pix — sync liberado para localhost, resto normal ────────
router.post('/api/pix/sincronizar', apenasLocal, async (req, res) => {
    // repassa para o pixRoutes internamente
    req.url = '/sincronizar';
    pixRoutes(req, res, (err) => {
        if (err) res.json({ ok: false, erro: err.message });
    });
});
router.use('/api/pix', pixRoutes);

// ─── Controle de equipamentos ────────────────────────────────
try {
    const controleEquipamentosRoutes = require('./services/controleEquipamentosService');
    router.use('/api/controle-equipamentos', controleEquipamentosRoutes);
    console.log('\x1b[32m[TI]\x1b[0m controleEquipamentosService carregado');
} catch (e) {
    console.warn('\x1b[33m[TI AVISO]\x1b[0m controleEquipamentosService não carregado:', e.message);
}

// ─── Chamados ────────────────────────────────────────────────
router.use('/chamados', (req, res, next) => {
    console.log(`[chamados DEBUG] ${req.method} ${req.path}`);
    next();
});

router.get('/api/chamados/dados', (req, res) => {
    try {
        const d = chamadosCache.getDados();
        if (!d) return res.json({ ok: true, erro: 'Sem dados — clique em Sincronizar.', chamados: [] });
        res.json({ ok: true, ...d, sincronizadoEm: chamadosCache.getStatus().ultimaSync });
    } catch (e) {
        res.json({ ok: false, erro: e.message, chamados: [] });
    }
});

router.get('/api/chamados/status', (req, res) => {
    try {
        res.json(chamadosCache.getStatus());
    } catch (e) {
        res.json({ erro: e.message });
    }
});

router.post('/api/chamados/sincronizar/completo', apenasLocal, async (req, res) => {
    try {
        const d = await chamadosCache.sincronizarEAtualizar('completo');
        res.json({ ok: true, totalTI: d.totalTI });
    } catch (e) {
        res.json({ ok: false, erro: e.message });
    }
});

router.post('/api/chamados/sincronizar', apenasLocal, async (req, res) => {
    try {
        const d = await chamadosCache.sincronizarEAtualizar('manual');
        res.json({ ok: true, totalTI: d.totalTI });
    } catch (e) {
        res.json({ ok: false, erro: e.message });
    }
});

router.put('/api/chamados/:id/concluir', async (req, res) => {
    try {
        const { pessoaId, nota, observacao } = req.body;
        if (!pessoaId) return res.json({ ok: false, erro: 'pessoaId obrigatório' });
        await chamadosCache.concluir(req.params.id, pessoaId, nota, observacao);
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: false, erro: e.message });
    }
});

router.get('/health', (req, res) => res.json({ modulo: 'ti', status: 'online' }));

module.exports = router;