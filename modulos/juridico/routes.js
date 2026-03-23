'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { perguntarJuridico } = require('./services/iaJuridicoService');

// ─── Body parser do módulo ───────────────────────────────────
router.use(express.json({ limit: '2mb' }));
router.use(express.urlencoded({ extended: true }));

// ─── Multer — memória, sem disco ─────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ─── Services ────────────────────────────────────────────────
const ativosService   = require('./services/ativosService');
const jurUploadsCache = require('./services/uploadsCache');
const {
    listarPastas,
    criarPasta,
    uploadArquivo,
    listarArquivos,
    deletarArquivo,
    PASTA_RAIZ_ID,
} = require('./services/drive');

// ─── Inicializar cache de uploads ────────────────────────────
jurUploadsCache.inicializar().catch(e =>
    console.error('[JURIDICO-UPLOADS] Cache init falhou:', e.message)
);

// ─── Arquivos estáticos ──────────────────────────────────────
router.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════════════════
// PÁGINAS HTML
// ══════════════════════════════════════════════════════════════
router.get('/', (req, res) => {
    const index  = path.join(__dirname, 'public', 'index.html');
    const ativos = path.join(__dirname, 'public', 'ativos.html');
    if (fs.existsSync(index)) return res.sendFile(index);
    return res.sendFile(ativos);
});

router.get('/ativos',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'ativos.html')));
router.get('/ativos.html',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'ativos.html')));
router.get('/uploads',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'uploads.html')));
router.get('/uploads.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'uploads.html')));

// opcional, caso você crie uma página própria da IA
router.get('/iajuridico', (req, res) => {
    const paginaIA = path.join(__dirname, 'public', 'iajuridico.html');
    if (!fs.existsSync(paginaIA)) {
        return res.status(404).send('Página iajuridico.html não encontrada.');
    }
    return res.sendFile(paginaIA);
});

router.get('/iajuridico.html', (req, res) => {
    const paginaIA = path.join(__dirname, 'public', 'iajuridico.html');
    if (!fs.existsSync(paginaIA)) {
        return res.status(404).send('Página iajuridico.html não encontrada.');
    }
    return res.sendFile(paginaIA);
});

// ══════════════════════════════════════════════════════════════
// API DE ATIVOS
// ══════════════════════════════════════════════════════════════
router.use('/api/ativos', ativosService);

// ══════════════════════════════════════════════════════════════
// IA DO JURÍDICO
// ══════════════════════════════════════════════════════════════
async function responderIA(req, res) {
    try {
        const pergunta = String(req.body?.pergunta || '').trim();

        const contexto = typeof req.body?.contexto === 'string'
            ? req.body.contexto
            : JSON.stringify(req.body?.contexto || {});

        const usuario =
            req.user?.email ||
            req.user?.displayName ||
            req.session?.user?.email ||
            req.session?.user?.nome ||
            'Não informado';

        if (!pergunta) {
            return res.status(400).json({
                ok: false,
                erro: 'Pergunta não informada.',
            });
        }

        const resposta = await perguntarJuridico({
            pergunta,
            contexto,
            usuario,
        });

        return res.json({
            ok: true,
            resposta: resposta || 'Sem resposta.',
        });
    } catch (e) {
        console.error('[JURIDICO-IA] Erro ao responder:', e.message);
        return res.status(500).json({
            ok: false,
            erro: e.message || 'Erro interno ao processar a IA.',
        });
    }
}

// rota principal usada pela index
router.post('/ia/analisar', responderIA);

// aliases de compatibilidade
router.post('/ia', responderIA);
router.post('/ia-juridico/perguntar', responderIA);

// health da IA
router.get('/ia/health', (req, res) => {
    res.json({
        ok: true,
        modulo: 'juridico',
        ia: 'online',
    });
});

// ══════════════════════════════════════════════════════════════
// UPLOADS — Google Drive (Jurídico)
// ══════════════════════════════════════════════════════════════
router.get('/uploads/status', (req, res) => {
    res.json({ ok: true, ...jurUploadsCache.getStatus() });
});

router.post('/uploads/sincronizar', async (req, res) => {
    try {
        const dados = await jurUploadsCache.sincronizarEAtualizar('manual');
        res.json({
            ok: true,
            totalPastas: dados.totalPastas,
            sincronizadoEm: dados.sincronizadoEm,
        });
    } catch (e) {
        res.status(500).json({ ok: false, erro: e.message });
    }
});

router.get('/uploads/pastas', async (req, res) => {
    try {
        const { pastaId } = req.query;

        if (!pastaId || pastaId === PASTA_RAIZ_ID) {
            let dados = jurUploadsCache.getDados();
            if (!dados) dados = await jurUploadsCache.sincronizarEAtualizar('auto');
            if (!dados) return res.json({ ok: true, pastas: [], cache: true });

            return res.json({
                ok: true,
                pastas: dados.pastas,
                cache: true,
            });
        }

        const pastas = await listarPastas(pastaId);
        res.json({ ok: true, pastas });
    } catch (e) {
        console.error('[JURIDICO-UPLOADS] Erro ao listar pastas:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

router.post('/uploads/pastas', async (req, res) => {
    try {
        const { nome, pastaId } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({
                ok: false,
                erro: 'Nome da pasta é obrigatório',
            });
        }

        const pasta = await criarPasta(nome.trim(), pastaId || PASTA_RAIZ_ID);
        await jurUploadsCache.sincronizarEAtualizar('nova-pasta').catch(() => {});

        res.json({ ok: true, pasta });
    } catch (e) {
        console.error('[JURIDICO-UPLOADS] Erro ao criar pasta:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

router.get('/uploads/arquivos', async (req, res) => {
    try {
        const { pastaId } = req.query;
        const arquivos = await listarArquivos(pastaId || PASTA_RAIZ_ID);
        res.json({ ok: true, arquivos });
    } catch (e) {
        console.error('[JURIDICO-UPLOADS] Erro ao listar arquivos:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

router.post('/uploads/arquivo', upload.array('arquivos', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                ok: false,
                erro: 'Nenhum arquivo enviado',
            });
        }

        const { pastaId } = req.body;
        const destino     = pastaId || PASTA_RAIZ_ID;
        const resultados  = [];
        const erros       = [];

        for (const file of req.files) {
            try {
                const arquivo = await uploadArquivo({
                    nomeArquivo: file.originalname,
                    mimeType: file.mimetype,
                    buffer: file.buffer,
                    pastaId: destino,
                });

                resultados.push(arquivo);
                console.log(`[JURIDICO-UPLOADS] ✅ ${file.originalname} → Drive (${arquivo.id})`);
            } catch (e) {
                console.error(`[JURIDICO-UPLOADS] ❌ ${file.originalname}:`, e.message);
                erros.push({ nome: file.originalname, erro: e.message });
            }
        }

        res.json({
            ok: erros.length === 0,
            enviados: resultados.length,
            arquivos: resultados,
            erros: erros.length ? erros : undefined,
        });
    } catch (e) {
        console.error('[JURIDICO-UPLOADS] Erro no upload:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

router.delete('/uploads/arquivos/:fileId', async (req, res) => {
    try {
        await deletarArquivo(req.params.fileId);
        res.json({ ok: true });
    } catch (e) {
        console.error('[JURIDICO-UPLOADS] Erro ao deletar:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ─── Health ──────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({
    modulo: 'juridico',
    status: 'online',
    ia: true,
    uploads: jurUploadsCache.getStatus(),
}));

module.exports = router;