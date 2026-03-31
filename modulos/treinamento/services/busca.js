'use strict';

// ─── services/busca.js ───────────────────────────────────────────────────────

const express    = require('express');
const router     = express.Router();
const { google } = require('googleapis');
const buscaCache = require('./buscaCache');
const { perguntarTreinamento } = require('./iaTreinamentoService');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const KEY_FILE       = process.env.GOOGLE_KEY_FILE;
const ABA_CADASTRAL  = 'Cadastral 2026';
const HEADER_OFFSET  = 9; // dados começam na linha 9

async function getAuth() {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return auth;
}

// Converte índice de coluna (0-based) para letra(s) do Sheets
// 0=A, 25=Z, 26=AA, 51=AZ ...
function colIndexToLetter(index) {
    let letter = '';
    let n = index;
    while (n >= 0) {
        letter = String.fromCharCode((n % 26) + 65) + letter;
        n = Math.floor(n / 26) - 1;
    }
    return letter;
}

// Espelho do CAMPO_COLUNA do frontend
const CAMPO_COLUNA_MAP = {
    numero:0, loja:1, nome:2, cpf:3, rg:4, funcao:5, turno:6,
    email:12, telefone:13,
    inicioTrein:14, fimTrein:15, diasTreinados:16, solicitadoPor:17,
    local:18, treinador:19, modelo:23,
    emailAvaliacaoLoja:24, avaliacaoOk:25, pago:26,
    valorPremio:27, valorRefeicao:28, valorTotal:29,
    mes:30, ano:31, aprovado:32, nota:33,
    lembreteEnviado:35, avaliacaoEnviadaLojas:36, whatsappAvaliacaoFunc:37,
    cepLojaTreinadora:38, lojaTreinadoraAvaliou:39, emailLojaAvaliadora:40,
    nomeLojaTreinadora:41, enderecoLojaTreinadora:42, notaLojaTreinadora:43,
    obsLojaTreinadora:44, lembrete2Dias:49, lembreteHoje:50,
};

// ─── GET /busca-api/status ────────────────────────────────────────────────────
router.get('/status', (req, res) => {
    res.json(buscaCache.getStatus());
});

// ─── POST /busca-api/sincronizar ──────────────────────────────────────────────
router.post('/sincronizar', async (req, res) => {
    try {
        await buscaCache.sincronizar('manual');
        res.json({ ok: true, ...buscaCache.getStatus() });
    } catch (e) {
        res.status(500).json({ ok: false, erro: e.message });
    }
});

// ─── GET /busca-api/cache ─────────────────────────────────────────────────────
router.get('/cache', (req, res) => {
    try {
        const { q, pagina, porPagina } = req.query;
        const resultado = buscaCache.buscarNoCache(
            q || '',
            parseInt(pagina   || '1',  10),
            parseInt(porPagina || '20', 10),
        );
        res.json(resultado);
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// ─── GET /busca-api/todos ─────────────────────────────────────────────────────
router.get('/todos', (req, res) => {
    try {
        const { pagina, porPagina } = req.query;
        const resultado = buscaCache.buscarNoCache(
            '',
            parseInt(pagina    || '1',  10),
            parseInt(porPagina || '20', 10),
        );
        res.json(resultado);
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// ─── POST /busca-api/excluir ──────────────────────────────────────────────────
router.post('/excluir', async (req, res) => {
    try {
        const { rowIndex } = req.body;

        if (rowIndex === undefined || rowIndex === null) {
            return res.status(400).json({ ok: false, erro: 'rowIndex obrigatório' });
        }

        const linhaReal    = parseInt(rowIndex, 10) + HEADER_OFFSET;
        const totalColunas = 51;
        const colunaInicio = colIndexToLetter(0);
        const colunaFim    = colIndexToLetter(totalColunas - 1);
        const range        = `'${ABA_CADASTRAL}'!${colunaInicio}${linhaReal}:${colunaFim}${linhaReal}`;

        const auth   = await getAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range,
        });

        buscaCache.removerDoCache(rowIndex);

        console.log(`[BUSCA] 🗑️ rowIndex=${rowIndex} → linha ${linhaReal} apagada (${range})`);
        res.json({ ok: true, linhaReal, range });

    } catch (e) {
        console.error('[BUSCA] ❌ Erro ao excluir:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

module.exports = router;

// ─── POST /busca-api/ia ───────────────────────────────────────────────────────
router.post('/ia', async (req, res) => {
    try {
        const { pergunta } = req.body;
        if (!pergunta) return res.status(400).json({ erro: 'pergunta obrigatória' });

        const usuario = req.user?.nome || req.user?.email || '';
        const dados   = buscaCache.getDados();
        const amostra = dados.slice(0, 300).map(c =>
            `#${c.numero} ${c.nome} | Loja: ${c.loja} | Função: ${c.funcao} | ` +
            `Início: ${c.inicioTrein} | Fim: ${c.fimTrein} | Nota: ${c.nota || '—'} | ` +
            `Pago: ${c.pago || '—'} | Aprovado: ${c.aprovado || '—'}`
        ).join('\n');

        const contexto = `BASE DE COLABORADORES (${dados.length} registros, amostra de ${Math.min(300, dados.length)}):\n${amostra}`;
        const resposta = await perguntarTreinamento({ pergunta, contexto, usuario });
        res.json({ ok: true, resposta, totalBase: dados.length });
    } catch (e) {
        const isQuota = String(e.message).toLowerCase().includes('cota') || String(e.message).toLowerCase().includes('quota');
        res.status(isQuota ? 429 : 500).json({ ok: false, erro: e.message });
    }
});

// ─── GET /busca-api/colaborador/:rowIndex ─────────────────────────────────────
router.get('/colaborador/:rowIndex', (req, res) => {
    try {
        const idx   = parseInt(req.params.rowIndex, 10);
        const dados = buscaCache.getDados();
        const c     = dados.find(d => d.rowIndex === idx);
        if (!c) return res.status(404).json({ erro: 'Não encontrado' });
        res.json(c);
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// ─── POST /busca-api/editar ───────────────────────────────────────────────────
// Body: { rowIndex: number, alteracoes: { [campo: string]: string } }
//
// rowIndex   = índice 0-based no array de dados (sem contar o cabeçalho)
// alteracoes = { nomeDoCampo: novoValor }  ex: { "nome": "João", "pago": "SIM" }
//
// Linha real na planilha = rowIndex + HEADER_OFFSET (9)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/editar', async (req, res) => {
    try {
        const { rowIndex, alteracoes } = req.body;

        if (rowIndex === undefined || rowIndex === null) {
            return res.status(400).json({ ok: false, erro: 'rowIndex obrigatório' });
        }
        if (!alteracoes || typeof alteracoes !== 'object' || Object.keys(alteracoes).length === 0) {
            return res.status(400).json({ ok: false, erro: 'alteracoes não pode ser vazio' });
        }

        // Linha real na planilha (1-indexed)
        const linhaReal = parseInt(rowIndex, 10) + HEADER_OFFSET;

        // Monta ranges para batchUpdate
        const data = [];
        for (const [chave, valor] of Object.entries(alteracoes)) {
            let colIndex;

            // Aceita tanto nome de campo ("nome") quanto índice numérico (2)
            const comoNum = parseInt(chave, 10);
            if (!isNaN(comoNum) && String(comoNum) === String(chave)) {
                colIndex = comoNum;
            } else {
                colIndex = CAMPO_COLUNA_MAP[chave];
            }

            if (colIndex === undefined || colIndex === null) {
                console.warn(`[BUSCA/editar] Campo desconhecido ignorado: "${chave}"`);
                continue;
            }

            data.push({
                range:  `'${ABA_CADASTRAL}'!${colIndexToLetter(colIndex)}${linhaReal}`,
                values: [[valor]],
            });
        }

        if (data.length === 0) {
            return res.status(400).json({ ok: false, erro: 'Nenhum campo válido para atualizar' });
        }

        // Autenticação — mesmo padrão do sheets.js do projeto
        const auth   = await getAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data,
            },
        });

        // Atualiza o cache em memória imediatamente (sem precisar resincronizar)
        const dados = buscaCache.getDados();
        const colab = dados.find(d => d.rowIndex === parseInt(rowIndex, 10));
        if (colab) {
            const COLUNA_PARA_CAMPO = {};
            for (const [campo, col] of Object.entries(CAMPO_COLUNA_MAP)) {
                COLUNA_PARA_CAMPO[col] = campo;
            }
            for (const [chave, valor] of Object.entries(alteracoes)) {
                if (CAMPO_COLUNA_MAP[chave] !== undefined) {
                    // chave é nome de campo
                    colab[chave] = valor;
                } else {
                    // chave é índice numérico → resolve nome do campo
                    const campo = COLUNA_PARA_CAMPO[parseInt(chave, 10)];
                    if (campo) colab[campo] = valor;
                }
            }
        }

        console.log(`[BUSCA] ✏️ rowIndex=${rowIndex} → linha ${linhaReal} — ${data.length} campo(s): ${data.map(d => d.range).join(', ')}`);
        res.json({ ok: true, linhaReal, totalAlteracoes: data.length });

    } catch (e) {
        console.error('[BUSCA] ❌ Erro ao editar:', e.message);
        res.status(500).json({ ok: false, erro: e.message });
    }
});

module.exports = router;