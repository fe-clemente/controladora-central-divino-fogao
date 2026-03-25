/**
 * services/avaliacao.js
 * Dois tipos de avaliador:
 *   tipo=origem     → preenche Z (SIM) + AH (nota) — NÃO preenche P
 *   tipo=treinadora → preenche AN (SIM) + AQ (nota) + AR (obs) + P (data fim)
 */

const { Router } = require('express');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');

const {
    getFuncionarioPorRowIndex,
    preencherAvaliacao,
    preencherAvaliacaoTreinadora,
} = require('./sheets');
const { enviarEmailResultadoAvaliacao } = require('./email');

// ─── PERSISTÊNCIA ─────────────────────────────────────────────────────────────
const TOKEN_FILE     = path.join(__dirname, '..', 'data', 'tokens.json');
const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

const dataDir = path.dirname(TOKEN_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function carregarTokens() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
            return new Map(Object.entries(JSON.parse(raw)));
        }
    } catch (e) { console.error('⚠️  Erro ao carregar tokens.json:', e.message); }
    return new Map();
}

function salvarTokens(store) {
    try {
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(Object.fromEntries(store), null, 2), 'utf8');
    } catch (e) { console.error('⚠️  Erro ao salvar tokens.json:', e.message); }
}

const tokenStore = carregarTokens();

// Limpa expirados ao iniciar
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

// ─── GERA TOKEN ───────────────────────────────────────────────────────────────
// tipo: 'origem' | 'treinadora'
function gerarLinkAvaliacao(rowIndex, baseUrl, tipo = 'origem') {
    const token = crypto.randomBytes(24).toString('hex');
    tokenStore.set(token, { rowIndex, tipo, criadoEm: Date.now() });
    salvarTokens(tokenStore);
    return `${baseUrl}/avaliacao?token=${token}`;
}

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
 * Retorna dados do funcionário + tipo de avaliador (origem ou treinadora)
 */
router.get('/dados', async (req, res) => {
    const { token } = req.query;
    const entry = validarToken(token);
    if (!entry) return res.status(401).json({ erro: 'Token inválido ou expirado.' });
    try {
        const funcionario = await getFuncionarioPorRowIndex(entry.rowIndex);
        if (!funcionario) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
        // Retorna o tipo para o HTML saber o que mostrar
        res.json({ ...funcionario, tipoAvaliador: entry.tipo || 'origem' });
    } catch (e) {
        console.error('Erro /avaliacao/dados:', e.message);
        res.status(500).json({ erro: e.message });
    }
});

/**
 * POST /avaliacao/registrar
 * Body: { token, nota, dataFim (só treinadora), observacoes }
 *
 * origem     → Z=SIM, AH=nota
 * treinadora → AN=SIM, AQ=nota, AR=obs, P=dataFim
 */
router.post('/registrar', async (req, res) => {
    const { token, nota, dataFim, observacoes } = req.body;

    const entry = validarToken(token);
    if (!entry) return res.status(401).json({ sucesso: false, erro: 'Token inválido ou expirado.' });

    if (nota === undefined || nota === null || nota === '')
        return res.status(400).json({ sucesso: false, erro: 'Nota é obrigatória.' });

    const notaNum = Number(nota);
    if (isNaN(notaNum) || notaNum < 0 || notaNum > 10)
        return res.status(400).json({ sucesso: false, erro: 'Nota deve ser entre 0 e 10.' });

    const tipo = entry.tipo || 'origem';

    // Loja treinadora OBRIGA data fim; loja origem NÃO preenche
    if (tipo === 'treinadora' && !dataFim)
        return res.status(400).json({ sucesso: false, erro: 'Data de fim é obrigatória para a loja treinadora.' });

    try {
        if (tipo === 'treinadora') {
            await preencherAvaliacaoTreinadora(entry.rowIndex, notaNum, dataFim, observacoes);
        } else {
            // origem: passa dataFim=null para NÃO sobrescrever col P
            await preencherAvaliacao(entry.rowIndex, notaNum, null, observacoes);
        }

        const funcionario = await getFuncionarioPorRowIndex(entry.rowIndex);

        enviarEmailResultadoAvaliacao(funcionario, notaNum, dataFim, observacoes, tipo)
            .then(() => console.log(`✅ Email resultado [${tipo}] enviado — ${funcionario.nome} nota ${notaNum}`))
            .catch(err => console.error('⚠️  Falha no email resultado:', err.message));

        console.log(`✅ Avaliação [${tipo}] registrada: rowIndex=${entry.rowIndex} nota=${notaNum} fim=${dataFim || '(não aplicável)'}`);
        res.json({ sucesso: true, nota: notaNum, dataFim: dataFim || null, tipo });

    } catch (e) {
        console.error('Erro /avaliacao/registrar:', e.message);
        res.status(500).json({ sucesso: false, erro: e.message });
    }
});

module.exports = { router, gerarLinkAvaliacao };