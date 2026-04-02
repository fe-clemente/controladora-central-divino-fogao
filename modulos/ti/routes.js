'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');

const PUBLIC_DIR = path.join(__dirname, 'public');
const pub = f => path.join(PUBLIC_DIR, f);

const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 50 * 1024 * 1024 },
});

// ─── SERVICES ────────────────────────────────────────────────
const tiDashRoutes   = require('./services/tiDashboardService');
const projetosRoutes = require('./services/projetosService');
const migracaoRoutes = require('./services/migracao');
const ativosRoutes   = require('./services/ativosService');
const chamadosCache  = require('./services/chamadosTiCache');
const pixRoutes      = require('./services/pixService');
const linksRoutes    = require('./services/linksExternosService');
const tiUploadsCache = require('./services/uploadsCache');
const { perguntarTI } = require('./services/iaTiService');
const checkoutCache  = require('./services/relatoriocheckoutCache');
const relatorioSultsCache = require('./services/relatorioControleAcessosSultsCache');
const envioRelatorioService = require('./services/envioRelatorioConsultoresCheckinECheckout');

const { listarPastas, criarPasta, uploadArquivo, listarArquivos, deletarArquivo, PASTA_RAIZ_ID } = require('./services/drive');

// ─── Inicializar caches ───────────────────────────────────────
tiUploadsCache.inicializar().catch(e => console.error('[TI-UPLOADS] Cache init falhou:', e.message));
checkoutCache.inicializar().catch(e => console.error('[CHECKOUT-CACHE] Cache init falhou:', e.message));
relatorioSultsCache.inicializar().catch(e => console.error('[SULTS-CTRL] Cache init falhou:', e.message));
envioRelatorioService.iniciarAgendador();

// ─── Autorização ─────────────────────────────────────────────
const apenasAutorizado = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (isLocal) return next();
    if (!req.isAuthenticated || !req.isAuthenticated())
        return res.status(401).json({ ok: false, erro: 'Sessão expirada. Faça login.' });
    if (!req.user?.isMaster && !req.user?.isGestor)
        return res.status(403).json({ ok: false, erro: 'Sem permissão para esta ação.' });
    return next();
};

// ─── DEBUG (silencia polling frequente) ──────────────────────
const _rotasSilenciosas = [
    '/api/envio-relatorio-checkout/status',
    '/api/relatorio-checkout/status',
];
router.use((req, res, next) => {
    const url = req.originalUrl.replace(/^\/ti/, '');
    if (!_rotasSilenciosas.some(s => url.includes(s))) {
        console.log(`\x1b[34m[TI ROUTER]\x1b[0m ${req.method} ${req.originalUrl}`);
    }
    next();
});

router.use(express.static(PUBLIC_DIR));

// ─── servirHtml — DEVE ser definida ANTES de ser usada ───────
function servirHtml(nomeArquivo) {
    return (req, res) => {
        const arquivo = pub(nomeArquivo);
        if (!fs.existsSync(arquivo))
            return res.status(404).json({ erro: `HTML não encontrado: ${nomeArquivo}` });
        res.sendFile(arquivo);
    };
}

// ═══════════════════════════════════════════════════════════════
// PÁGINAS HTML
// ═══════════════════════════════════════════════════════════════
router.get('/',           servirHtml('index.html'));
router.get('/index.html', servirHtml('index.html'));
router.get('/ativos',                servirHtml('ativos.html'));
router.get('/controle-equipamentos', servirHtml('controle-equipamentos.html'));
router.get('/migracao',              servirHtml('migracao.html'));
router.get('/projetos',              servirHtml('projetos.html'));
router.get('/chamados',              servirHtml('chamados.html'));
router.get('/pix',                   servirHtml('pix.html'));
router.get('/linkexterno',           servirHtml('linkexterno.html'));
router.get('/uploads',               servirHtml('uploads.html'));
router.get('/relatorio-checkout',    servirHtml('relatorioCheckoutConsultores.html'));
router.get('/relatorio-sults',       servirHtml('relatorioControleAcessosSults.html'));
router.get('/envio-relatorio-checkout', servirHtml('envioRelatorioConsultoresCheckinECheckout.html'));

router.get('/ativos.html',                       servirHtml('ativos.html'));
router.get('/controle-equipamentos.html',        servirHtml('controle-equipamentos.html'));
router.get('/migracao.html',                     servirHtml('migracao.html'));
router.get('/projetos.html',                     servirHtml('projetos.html'));
router.get('/chamados.html',                     servirHtml('chamados.html'));
router.get('/pix.html',                          servirHtml('pix.html'));
router.get('/linkexterno.html',                  servirHtml('linkexterno.html'));
router.get('/uploads.html',                      servirHtml('uploads.html'));
router.get('/relatorioCheckoutConsultores.html', servirHtml('relatorioCheckoutConsultores.html'));
router.get('/relatorioControleAcessosSults.html', servirHtml('relatorioControleAcessosSults.html'));
router.get('/envioRelatorioConsultoresCheckinECheckout.html', servirHtml('envioRelatorioConsultoresCheckinECheckout.html'));

router.get('/relatorioControleAcessosSults.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'services', 'relatorioControleAcessosSults.js'));
});
router.get('/relatorioCheckoutConsultores.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'services', 'relatorioCheckout.js'));
});

// ═══════════════════════════════════════════════════════════════
// APIs EXISTENTES
// ═══════════════════════════════════════════════════════════════
router.use('/api/dashboard', tiDashRoutes);
router.use('/api/projetos',  projetosRoutes);
router.use('/api/migracao',  migracaoRoutes);
router.use('/api/ativos',    ativosRoutes);
router.use('/api/links',     linksRoutes);

router.post('/api/pix/sincronizar', apenasAutorizado, async (req, res) => {
    req.url = '/sincronizar';
    pixRoutes(req, res, err => { if (err) res.json({ ok: false, erro: err.message }); });
});
router.use('/api/pix', pixRoutes);

const controleEquipamentosRoutes = require('./services/controleEquipamentosService');
router.use('/api/controle-equipamentos', controleEquipamentosRoutes);

// ─── Chamados ────────────────────────────────────────────────
router.get('/api/chamados/dados', (req, res) => {
    try {
        const d = chamadosCache.getDados();
        if (!d) return res.json({ ok: true, erro: 'Sem dados — clique em Sincronizar.', chamados: [] });
        res.json({ ok: true, ...d, sincronizadoEm: chamadosCache.getStatus().ultimaSync });
    } catch (e) { res.json({ ok: false, erro: e.message, chamados: [] }); }
});
router.get('/api/chamados/status', (req, res) => {
    try { res.json(chamadosCache.getStatus()); }
    catch (e) { res.json({ erro: e.message }); }
});
router.post('/api/chamados/sincronizar/completo', apenasAutorizado, async (req, res) => {
    try { const d = await chamadosCache.sincronizarEAtualizar('completo'); res.json({ ok: true, totalTI: d.totalTI }); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});
router.post('/api/chamados/sincronizar', apenasAutorizado, async (req, res) => {
    try { const d = await chamadosCache.sincronizarEAtualizar('manual'); res.json({ ok: true, totalTI: d.totalTI }); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});
router.put('/api/chamados/:id/concluir', async (req, res) => {
    try {
        const { pessoaId, nota, observacao } = req.body;
        if (!pessoaId) return res.json({ ok: false, erro: 'pessoaId obrigatório' });
        await chamadosCache.concluir(req.params.id, pessoaId, nota, observacao);
        res.json({ ok: true });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// RELATÓRIO CHECKIN / CHECKOUT
// ═══════════════════════════════════════════════════════════════
router.get('/api/relatorio-checkout/dados', (req, res) => {
    try {
        const d = checkoutCache.getDados();
        if (!d) return res.json({ ok: false, erro: 'Sem dados.', avaliacoes: [] });
        res.json({ ok: true, ...d });
    } catch (e) { res.json({ ok: false, erro: e.message, avaliacoes: [] }); }
});
router.get('/api/relatorio-checkout/status', (req, res) => {
    try { res.json(checkoutCache.getStatus()); }
    catch (e) { res.json({ erro: e.message }); }
});
router.post('/api/relatorio-checkout/sincronizar', apenasAutorizado, async (req, res) => {
    try {
        const { dias, dtStart, dtEnd } = req.body;
        const opcoes = (dtStart && dtEnd) ? { dtStart, dtEnd } : (Number(dias) || 30);
        checkoutCache.sincronizarEAtualizar('manual', opcoes).catch(e =>
            console.error('[CHECKOUT] Erro na sync:', e.message));
        res.json({ ok: true, mensagem: dtStart ? `${dtStart} → ${dtEnd}` : `Últimos ${opcoes} dias.` });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});
router.get('/api/relatorio-checkout/ao-vivo', (req, res) => {
    try {
        const offset = parseInt(req.query.offset) || 0;
        const aoVivo = checkoutCache.getStatus().registrosAoVivo || [];
        res.json({ ok: true, registros: aoVivo.slice(offset), total: aoVivo.length });
    } catch (e) { res.json({ ok: false, registros: [], erro: e.message }); }
});
router.post('/api/relatorio-checkout/geocodificar-pendentes', async (req, res) => {
    try { res.json({ ok: true, ...await checkoutCache.geocodificarPendentes() }); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});
router.delete('/api/relatorio-checkout/cache', apenasAutorizado, (req, res) => {
    try { res.json(checkoutCache.limparCache()); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});
router.delete('/api/relatorio-checkout/geo-cache', apenasAutorizado, (req, res) => {
    try { res.json(checkoutCache.limparGeoCache()); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// RELATÓRIO CONTROLE ACESSOS SULTS
// ═══════════════════════════════════════════════════════════════
router.get('/api/relatorio-sults/dados', (req, res) => {
    try {
        const d = relatorioSultsCache.getDados();
        if (!d) return res.json({ ok: false, erro: 'Sem dados — clique em Sincronizar.', chamados: [] });
        res.json({ ok: true, ...d });
    } catch (e) { res.json({ ok: false, erro: e.message, chamados: [] }); }
});
router.get('/api/relatorio-sults/status', (req, res) => {
    try { res.json(relatorioSultsCache.getStatus()); }
    catch (e) { res.json({ erro: e.message }); }
});
router.get('/api/relatorio-sults/progresso', (req, res) => {
    try { res.json(relatorioSultsCache.getProgresso()); }
    catch (e) { res.json({ erro: e.message }); }
});
router.post('/api/relatorio-sults/sincronizar', apenasAutorizado, async (req, res) => {
    try {
        relatorioSultsCache.sincronizarEAtualizar('manual').catch(e =>
            console.error('[SULTS-CTRL] Erro na sync:', e.message));
        res.json({ ok: true, mensagem: 'Sincronização incremental iniciada.' });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});
router.post('/api/relatorio-sults/sincronizar-completo', apenasAutorizado, async (req, res) => {
    try {
        relatorioSultsCache.sincronizarEAtualizar('completo').catch(e =>
            console.error('[SULTS-CTRL] Erro na sync completa:', e.message));
        res.json({ ok: true, mensagem: `Sync completa iniciada (${relatorioSultsCache.JANELA_MAX_DIAS} dias).` });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});
router.get('/api/relatorio-sults/timeline/:chamadoId', async (req, res) => {
    try { res.json({ ok: true, ...await relatorioSultsCache.buscarTimeline(req.params.chamadoId) }); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});
router.delete('/api/relatorio-sults/cache', apenasAutorizado, (req, res) => {
    try { res.json(relatorioSultsCache.limparCache()); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});

console.log('\x1b[32m[TI]\x1b[0m relatorioControleAcessosSultsCache carregado');

// ═══════════════════════════════════════════════════════════════
// ENVIO AUTOMÁTICO — 1 sync, 2 grupos, 2 e-mails (dia 06)
// ═══════════════════════════════════════════════════════════════

// ── Status unificado ─────────────────────────────────────────
router.get('/api/envio-relatorio-checkout/status', (req, res) => {
    try { res.json(envioRelatorioService.getStatus()); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});

// ── Simular (teste) — 1 request, 2 e-mails ───────────────────
router.post('/api/envio-relatorio-checkout/simular', apenasAutorizado, async (req, res) => {
    try {
        const { emailsQualidade, emailsCampo, distanciaMinima } = req.body;
        const resultado = await envioRelatorioService.executarEnvio({
            emailsQualidade: emailsQualidade && emailsQualidade.length ? emailsQualidade : undefined,
            emailsCampo:     emailsCampo     && emailsCampo.length     ? emailsCampo     : undefined,
            distanciaMinima: distanciaMinima || 1000,
        });
        res.json({ ok: true, ...resultado });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// ── Executar com destinatários reais (sem modo teste) ─────────
router.post('/api/envio-relatorio-checkout/executar-agora', apenasAutorizado, async (req, res) => {
    try {
        const resultado = await envioRelatorioService.executarEnvio();
        res.json({ ok: true, ...resultado });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// ── Preview e-mail de um grupo (sem enviar) ───────────────────
router.get('/api/envio-relatorio-checkout/preview-email', async (req, res) => {
    try {
        const grupoId         = req.query.grupoId || 'qualidade';
        const distanciaMinima = parseInt(req.query.distanciaMinima) || 1000;
        const dados           = checkoutCache.getDados();
        const grupo           = envioRelatorioService.GRUPOS[grupoId];

        if (!grupo) return res.json({ ok: false, erro: `Grupo inválido: ${grupoId}` });

        if (!dados || !dados.avaliacoes) {
            const ficticios = [
                { id: 1001, unidade: 'DF — Asa Norte',      consultor: 'João Silva',    modelo: grupoId === 'qualidade' ? 'Consultoria em Qualidade e Segurança dos Alimentos' : 'Consultoria de Campo', data: '05/06/2025', distancia: 2340 },
                { id: 1002, unidade: 'GO — Goiânia Centro', consultor: 'Maria Oliveira', modelo: grupoId === 'qualidade' ? 'Gastronomia - Consultoria Presencial'               : 'Consultoria em Delivery', data: '04/06/2025', distancia: 5100 },
            ];
            const html = envioRelatorioService._gerarHtmlPreview(grupoId, ficticios, 2, true);
            return res.json({ ok: true, html, aviso: 'Dados fictícios — sincronize primeiro.' });
        }

        const filtrados = dados.avaliacoes.filter(r => {
            if (!r.distancia || r.distancia <= distanciaMinima || !r.modelo) return false;
            const m = r.modelo.toLowerCase();
            return grupo.modelosIncluidos.some(inc => m.includes(inc.toLowerCase()));
        }).sort((a, b) => (b.distancia || 0) - (a.distancia || 0));

        const html = envioRelatorioService._gerarHtmlPreview(grupoId, filtrados, dados.avaliacoes.length, false);
        res.json({ ok: true, html });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

console.log('\x1b[32m[TI]\x1b[0m envioRelatorioConsultoresCheckinECheckout carregado (sync única → 2 grupos)');

// ═══════════════════════════════════════════════════════════════
// UPLOADS — Google Drive
// ═══════════════════════════════════════════════════════════════
router.get('/uploads/status', (req, res) => res.json({ ok: true, ...tiUploadsCache.getStatus() }));
router.post('/uploads/sincronizar', async (req, res) => {
    try {
        const dados = await tiUploadsCache.sincronizarEAtualizar('manual');
        res.json({ ok: true, totalPastas: dados.totalPastas, sincronizadoEm: dados.sincronizadoEm });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
router.get('/uploads/pastas', async (req, res) => {
    try {
        const { pastaId } = req.query;
        if (!pastaId || pastaId === PASTA_RAIZ_ID) {
            let dados = tiUploadsCache.getDados();
            if (!dados) dados = await tiUploadsCache.sincronizarEAtualizar('auto');
            return res.json({ ok: true, pastas: dados?.pastas || [], cache: true });
        }
        res.json({ ok: true, pastas: await listarPastas(pastaId) });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
router.post('/uploads/pastas', async (req, res) => {
    try {
        const { nome, pastaId } = req.body;
        if (!nome?.trim()) return res.status(400).json({ ok: false, erro: 'Nome obrigatório' });
        const pasta = await criarPasta(nome.trim(), pastaId || PASTA_RAIZ_ID);
        await tiUploadsCache.sincronizarEAtualizar('nova-pasta').catch(() => {});
        res.json({ ok: true, pasta });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
router.get('/uploads/arquivos', async (req, res) => {
    try { res.json({ ok: true, arquivos: await listarArquivos(req.query.pastaId || PASTA_RAIZ_ID) }); }
    catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
router.post('/uploads/arquivo', upload.array('arquivos', 20), async (req, res) => {
    try {
        if (!req.files?.length) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado' });
        const destino = req.body.pastaId || PASTA_RAIZ_ID;
        const resultados = [], erros = [];
        for (const file of req.files) {
            try {
                const arquivo = await uploadArquivo({ nomeArquivo: file.originalname, mimeType: file.mimetype, buffer: file.buffer, pastaId: destino });
                resultados.push(arquivo);
            } catch (e) { erros.push({ nome: file.originalname, erro: e.message }); }
        }
        res.json({ ok: erros.length === 0, enviados: resultados.length, arquivos: resultados, erros: erros.length ? erros : undefined });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});
router.delete('/uploads/arquivos/:fileId', async (req, res) => {
    try { await deletarArquivo(req.params.fileId); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// IA TI
// ═══════════════════════════════════════════════════════════════
router.post('/ia-ti/perguntar', async (req, res) => {
    try {
        const { pergunta, contexto } = req.body;
        if (!pergunta) return res.status(400).json({ ok: false, erro: '"pergunta" é obrigatório.' });
        const resposta = await perguntarTI({ pergunta, contexto, usuario: req.user?.nome || '' });
        res.json({ ok: true, resposta });
    } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// ─── Health ──────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({
    modulo:         'ti',
    status:         'online',
    uploads:        tiUploadsCache.getStatus(),
    checkout:       checkoutCache.getStatus(),
    relatorioSults: relatorioSultsCache.getStatus(),
    envioRelatorio: envioRelatorioService.getStatus(),
}));

module.exports = router;