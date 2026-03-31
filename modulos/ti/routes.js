'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');

const PUBLIC_DIR = path.join(__dirname, 'public');
const pub = f => path.join(PUBLIC_DIR, f);

// ─── Multer — memória, sem disco ──────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 50 * 1024 * 1024 }, // 50 MB
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

const {
    listarPastas,
    criarPasta,
    uploadArquivo,
    listarArquivos,
    deletarArquivo,
    PASTA_RAIZ_ID,
} = require('./services/drive');

// ─── Inicializar caches ───────────────────────────────────────
tiUploadsCache.inicializar().catch(e => console.error('[TI-UPLOADS] Cache init falhou:', e.message));
checkoutCache.inicializar().catch(e => console.error('[CHECKOUT-CACHE] Cache init falhou:', e.message));

// ─── Autorização: localhost OU usuário autenticado com permissão ──────────────
const apenasAutorizado = (req, res, next) => {
    // Em dev local, passa direto
    const ip = req.ip || req.connection.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (isLocal) return next();

    // Em produção, exige sessão autenticada com permissão
    if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ ok: false, erro: 'Sessão expirada. Faça login.' });
    }
    if (!req.user?.isMaster && !req.user?.isGestor) {
        return res.status(403).json({ ok: false, erro: 'Sem permissão para esta ação.' });
    }
    return next();
};

// ─── DEBUG ───────────────────────────────────────────────────
router.use((req, res, next) => {
    console.log(`\x1b[34m[TI ROUTER]\x1b[0m ${req.method} ${req.originalUrl} | path=${req.path}`);
    next();
});

// ─── Estáticos ───────────────────────────────────────────────
router.use(express.static(PUBLIC_DIR));

// ─── Helper para servir HTML ─────────────────────────────────
function servirHtml(nomeArquivo) {
    return (req, res) => {
        const arquivo = pub(nomeArquivo);
        const existe  = fs.existsSync(arquivo);
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

router.get('/ativos.html',                    servirHtml('ativos.html'));
router.get('/controle-equipamentos.html',     servirHtml('controle-equipamentos.html'));
router.get('/migracao.html',                  servirHtml('migracao.html'));
router.get('/projetos.html',                  servirHtml('projetos.html'));
router.get('/chamados.html',                  servirHtml('chamados.html'));
router.get('/pix.html',                       servirHtml('pix.html'));
router.get('/linkexterno.html',               servirHtml('linkexterno.html'));
router.get('/uploads.html',                   servirHtml('uploads.html'));
router.get('/relatorioCheckoutConsultores.html', servirHtml('relatorioCheckoutConsultores.html'));
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

// ─── Pix ─────────────────────────────────────────────────────
router.post('/api/pix/sincronizar', apenasAutorizado, async (req, res) => {
    req.url = '/sincronizar';
    pixRoutes(req, res, (err) => {
        if (err) res.json({ ok: false, erro: err.message });
    });
});
router.use('/api/pix', pixRoutes);

// ─── Controle de equipamentos ─────────────────────────────────
const controleEquipamentosRoutes = require('./services/controleEquipamentosService');
router.use('/api/controle-equipamentos', controleEquipamentosRoutes);
console.log('\x1b[32m[TI]\x1b[0m controleEquipamentosService carregado');

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
    try { res.json(chamadosCache.getStatus()); }
    catch (e) { res.json({ erro: e.message }); }
});

router.post('/api/chamados/sincronizar/completo', apenasAutorizado, async (req, res) => {
    try {
        const d = await chamadosCache.sincronizarEAtualizar('completo');
        res.json({ ok: true, totalTI: d.totalTI });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

router.post('/api/chamados/sincronizar', apenasAutorizado, async (req, res) => {
    try {
        const d = await chamadosCache.sincronizarEAtualizar('manual');
        res.json({ ok: true, totalTI: d.totalTI });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
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
        if (!d) return res.json({ ok: false, erro: 'Sem dados — clique em Sincronizar.', avaliacoes: [] });
        res.json({ ok: true, ...d });
    } catch (e) {
        res.json({ ok: false, erro: e.message, avaliacoes: [] });
    }
});

router.get('/api/relatorio-checkout/status', (req, res) => {
    try { res.json(checkoutCache.getStatus()); }
    catch (e) { res.json({ erro: e.message }); }
});

router.post('/api/relatorio-checkout/sincronizar', apenasAutorizado, async (req, res) => {
    try {
        const { dias, dtStart, dtEnd } = req.body;

        let opcoes;
        if (dtStart && dtEnd) {
            opcoes = { dtStart, dtEnd };
        } else {
            opcoes = Number(dias) || 30;
        }

        // Dispara sem await — responde imediatamente, processa em background
        checkoutCache.sincronizarEAtualizar('manual', opcoes).catch(e =>
            console.error('[CHECKOUT] Erro na sync:', e.message)
        );

        res.json({ ok: true, mensagem: dtStart ? `Sincronização iniciada — ${dtStart} → ${dtEnd}` : `Sincronização iniciada — últimos ${opcoes} dias.` });
    } catch (e) {
        res.json({ ok: false, erro: e.message });
    }
});

// Streaming ao vivo — registros já processados desde um offset
router.get('/api/relatorio-checkout/ao-vivo', (req, res) => {
    try {
        const offset = parseInt(req.query.offset) || 0;
        const aoVivo = checkoutCache.getStatus().registrosAoVivo || [];
        res.json({ ok: true, registros: aoVivo.slice(offset), total: aoVivo.length });
    } catch (e) {
        res.json({ ok: false, registros: [], erro: e.message });
    }
});

router.post('/api/relatorio-checkout/geocodificar-pendentes', async (req, res) => {
    try {
        const resultado = await checkoutCache.geocodificarPendentes();
        res.json({ ok: true, ...resultado });
    } catch (e) {
        res.json({ ok: false, erro: e.message });
    }
});

router.delete('/api/relatorio-checkout/cache', apenasAutorizado, (req, res) => {
    try { res.json(checkoutCache.limparCache()); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});

router.delete('/api/relatorio-checkout/geo-cache', apenasAutorizado, (req, res) => {
    try { res.json(checkoutCache.limparGeoCache()); }
    catch (e) { res.json({ ok: false, erro: e.message }); }
});

console.log('\x1b[32m[TI]\x1b[0m relatorioCheckoutCache carregado');

// ═══════════════════════════════════════════════════════════════
// UPLOADS — Google Drive (TI)
// ═══════════════════════════════════════════════════════════════

router.get('/uploads/status', (req, res) => {
    res.json({ ok: true, ...tiUploadsCache.getStatus() });
});

router.post('/uploads/sincronizar', async (req, res) => {
    try {
        const dados = await tiUploadsCache.sincronizarEAtualizar('manual');
        res.json({ ok: true, totalPastas: dados.totalPastas, sincronizadoEm: dados.sincronizadoEm });
    } catch (e) {
        res.status(500).json({ ok: false, erro: e.message });
    }
});

router.get('/uploads/pastas', async (req, res) => {
    try {
        const { pastaId } = req.query;
        if (!pastaId || pastaId === PASTA_RAIZ_ID) {
            let dados = tiUploadsCache.getDados();
            if (!dados) dados = await tiUploadsCache.sincronizarEAtualizar('auto');
            if (!dados) return res.json({ ok: true, pastas: [], cache: true });
            return res.json({ ok: true, pastas: dados.pastas, cache: true });
        }
        const pastas = await listarPastas(pastaId);
        res.json({ ok: true, pastas });
    } catch (e) {
        console.error('[TI-UPLOADS] Erro ao listar pastas:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

router.post('/uploads/pastas', async (req, res) => {
    try {
        const { nome, pastaId } = req.body;
        if (!nome || !nome.trim()) return res.status(400).json({ ok: false, erro: 'Nome da pasta é obrigatório' });
        const pasta = await criarPasta(nome.trim(), pastaId || PASTA_RAIZ_ID);
        await tiUploadsCache.sincronizarEAtualizar('nova-pasta').catch(() => {});
        res.json({ ok: true, pasta });
    } catch (e) {
        console.error('[TI-UPLOADS] Erro ao criar pasta:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

router.get('/uploads/arquivos', async (req, res) => {
    try {
        const { pastaId } = req.query;
        const arquivos = await listarArquivos(pastaId || PASTA_RAIZ_ID);
        res.json({ ok: true, arquivos });
    } catch (e) {
        console.error('[TI-UPLOADS] Erro ao listar arquivos:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

router.post('/uploads/arquivo', upload.array('arquivos', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0)
            return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado' });

        const { pastaId } = req.body;
        const destino     = pastaId || PASTA_RAIZ_ID;
        const resultados  = [];
        const erros       = [];

        for (const file of req.files) {
            try {
                const arquivo = await uploadArquivo({
                    nomeArquivo: file.originalname,
                    mimeType:    file.mimetype,
                    buffer:      file.buffer,
                    pastaId:     destino,
                });
                resultados.push(arquivo);
                console.log(`[TI-UPLOADS] ✅ ${file.originalname} → Drive (${arquivo.id})`);
            } catch (e) {
                console.error(`[TI-UPLOADS] ❌ ${file.originalname}:`, e.message);
                erros.push({ nome: file.originalname, erro: e.message });
            }
        }

        res.json({
            ok:       erros.length === 0,
            enviados: resultados.length,
            arquivos: resultados,
            erros:    erros.length ? erros : undefined,
        });
    } catch (e) {
        console.error('[TI-UPLOADS] Erro no upload:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

router.delete('/uploads/arquivos/:fileId', async (req, res) => {
    try {
        await deletarArquivo(req.params.fileId);
        res.json({ ok: true });
    } catch (e) {
        console.error('[TI-UPLOADS] Erro ao deletar:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// IA TI — Gemini
// ═══════════════════════════════════════════════════════════════
router.post('/ia-ti/perguntar', async (req, res) => {
    try {
        const { pergunta, contexto } = req.body;
        const usuario = req.user?.nome || req.user?.email || '';

        if (!pergunta) {
            return res.status(400).json({ ok: false, erro: 'Campo "pergunta" é obrigatório.' });
        }

        const resposta = await perguntarTI({ pergunta, contexto, usuario });
        res.json({ ok: true, resposta });

    } catch (e) {
        console.error('[IA-TI] Erro:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ─── Health ──────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({
    modulo: 'ti',
    status: 'online',
    uploads: tiUploadsCache.getStatus(),
    checkout: checkoutCache.getStatus(),
}));

module.exports = router;