/**
 * services/avaliacao.js
 *
 * Responsável por:
 *  - Gerar tokens seguros para links de avaliação
 *  - Expor o Express Router com as rotas:
 *      GET  /avaliacao/dados?token=xxx     → retorna dados do funcionário
 *      POST /avaliacao/registrar           → salva nota + dataFim + envia email resultado
 */

const { Router } = require('express');
const crypto     = require('crypto');

const { getFuncionarioPorRowIndex, preencherAvaliacao } = require('./sheets');
const { enviarEmailResultadoAvaliacao }                 = require('./email');

// ─── STORE DE TOKENS ─────────────────────────────────────────────────────────
// Mapa em memória: token → { rowIndex, criadoEm }
// Tokens expiram em 30 dias. Em produção, substitua por Redis ou banco.
const tokenStore = new Map();
const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

// ─── GERA TOKEN E LINK ───────────────────────────────────────────────────────
function gerarLinkAvaliacao(rowIndex, baseUrl) {
    const token = crypto.randomBytes(24).toString('hex');
    tokenStore.set(token, {
        rowIndex,
        criadoEm: Date.now(),
    });
    return `${baseUrl}/avaliacao.html?token=${token}`;
}

// ─── VALIDA TOKEN ────────────────────────────────────────────────────────────
function validarToken(token) {
    if (!token) return null;
    const entry = tokenStore.get(token);
    if (!entry) return null;
    if (Date.now() - entry.criadoEm > TRINTA_DIAS_MS) {
        tokenStore.delete(token);
        return null;
    }
    return entry;
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────
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
 *  3. Envia email de resultado para fernando.clemente@hotmail.com
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
        // 1. Atualiza colunas AH (nota) e P (dataFim) na planilha
        await preencherAvaliacao(entry.rowIndex, notaNum, dataFim);

        // 2. Busca dados completos do funcionário para o email
        const funcionario = await getFuncionarioPorRowIndex(entry.rowIndex);

        // 3. Envia email de resultado para o RH (não bloqueia se falhar)
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