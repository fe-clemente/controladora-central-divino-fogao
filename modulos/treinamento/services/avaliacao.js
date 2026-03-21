/**
 * services/avaliacao.js
 *
 * Responsável por:
 *  - Gerar tokens seguros para links de avaliação (persistidos em disco)
 *  - Expor o Express Router com as rotas:
 *      GET  /avaliacao/dados?token=xxx     → retorna dados do funcionário
 *      POST /avaliacao/registrar           → salva nota + dataFim + envia email resultado
 */

const { Router } = require('express');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');

const { getFuncionarioPorRowIndex, preencherAvaliacao } = require('./sheets');
const { enviarEmailResultadoAvaliacao }                 = require('./email');

// ─── ARQUIVO DE PERSISTÊNCIA ──────────────────────────────────────────────────
const TOKEN_FILE     = path.join(__dirname, '..', 'data', 'tokens.json');
const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

// Garante que a pasta data/ existe
const dataDir = path.dirname(TOKEN_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ─── LOAD / SAVE ──────────────────────────────────────────────────────────────
function carregarTokens() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
            return new Map(Object.entries(JSON.parse(raw)));
        }
    } catch (e) {
        console.error('⚠️  Erro ao carregar tokens.json:', e.message);
    }
    return new Map();
}

function salvarTokens(store) {
    try {
        const obj = Object.fromEntries(store);
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
        console.error('⚠️  Erro ao salvar tokens.json:', e.message);
    }
}

// Mapa em memória sincronizado com disco
const tokenStore = carregarTokens();

// Limpa tokens expirados do arquivo ao iniciar
(function limparExpirados() {
    let removidos = 0;
    for (const [token, entry] of tokenStore) {
        if (Date.now() - entry.criadoEm > TRINTA_DIAS_MS) {
            tokenStore.delete(token);
            removidos++;
        }
    }
    if (removidos > 0) {
        salvarTokens(tokenStore);
        console.log(`🧹 ${removidos} token(s) expirado(s) removido(s)`);
    }
})();

// ─── GERA TOKEN E LINK ────────────────────────────────────────────────────────
function gerarLinkAvaliacao(rowIndex, baseUrl) {
    const token = crypto.randomBytes(24).toString('hex');
    tokenStore.set(token, { rowIndex, criadoEm: Date.now() });
    salvarTokens(tokenStore);
    return `${baseUrl}/avaliacao?token=${token}`;
}

// ─── VALIDA TOKEN ─────────────────────────────────────────────────────────────
function validarToken(token) {
    if (!token) return null;
    const entry = tokenStore.get(token);
    if (!entry) return null;
    if (Date.now() - entry.criadoEm > TRINTA_DIAS_MS) {
        tokenStore.delete(token);
        salvarTokens(tokenStore);
        return null;
    }
    return entry;
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
const router = Router();

/**
 * GET /avaliacao/dados?token=xxx
 * Retorna dados do funcionário para preencher o formulário
 */
router.get('/dados', async (req, res) => {
    const { token } = req.query;
    const entry = validarToken(token);
    if (!entry) {
        return res.status(401).json({ erro: 'Token inválido ou expirado.' });
    }
    try {
        const funcionario = await getFuncionarioPorRowIndex(entry.rowIndex);
        if (!funcionario) {
            return res.status(404).json({ erro: 'Colaborador não encontrado.' });
        }
        res.json(funcionario);
    } catch (e) {
        console.error('Erro /avaliacao/dados:', e.message);
        res.status(500).json({ erro: e.message });
    }
});

/**
 * POST /avaliacao/registrar
 * Body: { token, nota (0-10), dataFim (DD/MM/YYYY), observacoes? }
 *
 * Ações:
 *  1. Valida token
 *  2. Salva nota na col AH e dataFim na col P da planilha
 *  3. Envia email de resultado
 */
router.post('/registrar', async (req, res) => {
    const { token, nota, dataFim, observacoes } = req.body;

    // Valida token
    const entry = validarToken(token);
    if (!entry) {
        return res.status(401).json({ sucesso: false, erro: 'Token inválido ou expirado.' });
    }

    // Valida nota
    if (nota === undefined || nota === null || nota === '') {
        return res.status(400).json({ sucesso: false, erro: 'Nota é obrigatória.' });
    }
    const notaNum = Number(nota);
    if (isNaN(notaNum) || notaNum < 0 || notaNum > 10) {
        return res.status(400).json({ sucesso: false, erro: 'Nota deve ser entre 0 e 10.' });
    }

    // Valida dataFim
    if (!dataFim) {
        return res.status(400).json({ sucesso: false, erro: 'Data de fim é obrigatória.' });
    }

    try {
        // 1. Atualiza colunas AH (nota), Z (SIM), P (dataFim) na planilha
        await preencherAvaliacao(entry.rowIndex, notaNum, dataFim, observacoes);

        // 2. Busca dados completos do funcionário para o email
        const funcionario = await getFuncionarioPorRowIndex(entry.rowIndex);

        // 3. Envia email de resultado (não bloqueia se falhar)
        enviarEmailResultadoAvaliacao(funcionario, notaNum, dataFim, observacoes)
            .then(() => console.log(`✅ Email resultado enviado — ${funcionario.nome} nota ${notaNum}`))
            .catch(err => console.error('⚠️  Falha no email resultado:', err.message));

        console.log(`✅ Avaliação registrada: rowIndex=${entry.rowIndex} nota=${notaNum} fim=${dataFim}`);

        res.json({ sucesso: true, nota: notaNum, dataFim });

    } catch (e) {
        console.error('Erro /avaliacao/registrar:', e.message);
        res.status(500).json({ sucesso: false, erro: e.message });
    }
});

module.exports = { router, gerarLinkAvaliacao };