/**
 * services/avaliacao.js — CORRIGIDO
 *
 * ★ MAPEAMENTO ATUALIZADO — aba "Respostas ao formulário 1":
 *
 *   A  = DATA_REGISTRO
 *   C  = TREINADOR_NOME_FUNCAO
 *   D  = UNIDADE_TREINAMENTO
 *   E  = COLABORADOR_AVALIADO
 *   F  = FUNCAO_COLABORADOR
 *   G  = LOJA_TREINADA
 *   H  = DATA_INICIO
 *   I  = DATA_FIM_TREINAMENTO
 *   J  = QTDE_REFEICOES  (formato: "X refeições")
 *   K  = CONSUMO_BEBIDAS
 *   L  = COMPREENSAO_TREINAMENTO  ★ TEXTO por extenso (era nota 1-5)
 *   M  = HABILIDADES_TECNICAS     ★ TEXTO por extenso (era nota 1-5)
 *   N  = ATITUDES_COMPORTAMENTO   ★ TEXTO por extenso (era nota 1-5)
 *   O  = RESOLUCAO_PROBLEMAS      ★ TEXTO por extenso (era nota 1-5)
 *   P  = TRABALHO_EQUIPE          ★ TEXTO por extenso (era nota 1-5)
 *   Q  = ADESAO_PADROES           ★ TEXTO por extenso (era nota 1-5)
 *   R  = FEEDBACK_MELHORIA        ★ TEXTO por extenso (era nota 1-5)
 *   S  = CONFIANCA_AUTONOMIA      ★ TEXTO por extenso (era nota 1-5)
 *   T  = DESTAQUE_IMPORTANTE      TEXTO
 *   U  = AVALIACAO_COMPORTAMENTO  nota 1-5
 *   V  = ENTENDIMENTO_CONTEUDO    nota 1-5
 *   W  = PRONTO_FUNCAO            nota 1-5
 *   X  = MULTIPLICADOR_NOTA       nota 0-10
 *   Y  = FOTO_TRABALHO            link
 *   Z  = APROVADO                 ★ Select: SIM / NÃO / PREFIRO NÃO RESPONDER
 *   AA = CHECKPOINT_LOJA          TEXTO
 *   AB = INSERIDO_SISTEMA
 *
 *   ★ COLUNAS AC-AI REMOVIDAS (texto agora vai direto em L-S)
 */

const { Router } = require('express');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const multer     = require('multer');
const { google } = require('googleapis');

const {
    getFuncionarioPorRowIndex,
    preencherAvaliacao,
    preencherAvaliacaoTreinadora,
    preencherAvaliacaoCompleta,
} = require('./sheets');
const { enviarEmailResultadoAvaliacao } = require('./email');

// ─── MULTER (upload temporário) ───────────────────────────────────────────────
const uploadDir = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── GOOGLE DRIVE — pasta de destino das fotos ───────────────────────────────
const DRIVE_FOLDER_ID = '11X0gA-ma-rsbfRiw0osZEFxnZyAzAn04';
const KEY_FILE        = process.env.GOOGLE_KEY_FILE;

/**
 * ★ OBRIGATÓRIO — email do usuário real do Google Workspace que será impersonado.
 *   A Service Account não tem quota de armazenamento no Drive.
 *   Ela precisa agir em nome de um usuário real.
 *
 *   Exemplo: treinamentos@divinofogao.com.br
 *
 *   Configure no .env: GOOGLE_DRIVE_USER=treinamentos@divinofogao.com.br
 *
 *   PRÉ-REQUISITO (feito uma vez pelo admin do Google Workspace):
 *   1. Admin Console → Security → API Controls → Domain-wide delegation
 *   2. Adicione o Client ID da Service Account
 *   3. Escopos: https://www.googleapis.com/auth/drive
 */
const DRIVE_DELEGATED_USER = process.env.GOOGLE_DRIVE_USER || '';

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

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function dataHojeBR() {
    const now = new Date();
    const dia  = String(now.getDate()).padStart(2, '0');
    const mes  = String(now.getMonth() + 1).padStart(2, '0');
    const ano  = now.getFullYear();
    const hora = now.toTimeString().slice(0, 8);
    return `${dia}/${mes}/${ano} ${hora}`;
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
const router = Router();

router.get('/dados', async (req, res) => {
    const { token } = req.query;
    const entry = validarToken(token);
    if (!entry) return res.status(401).json({ erro: 'Token inválido ou expirado.' });
    try {
        const funcionario = await getFuncionarioPorRowIndex(entry.rowIndex);
        if (!funcionario) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
        res.json({ ...funcionario, tipoAvaliador: entry.tipo || 'origem' });
    } catch (e) {
        console.error('Erro /avaliacao/dados:', e.message);
        res.status(500).json({ erro: e.message });
    }
});

/**
 * POST /avaliacao/registrar
 *
 * ★ MAPEAMENTO ATUALIZADO:
 *   L-S  → TEXTO por extenso (eram notas 1-5)
 *   U,V,W → notas 1-5
 *   X    → nota 0-10
 *   J    → "X refeições" (string formatada)
 *   Z    → TEXTO por extenso (era SIM/NÃO)
 *   AC-AI → ELIMINADAS
 */
router.post('/registrar', async (req, res) => {
    const {
        token,
        tipo: tipoBody,

        treinadorNomeFuncao,
        unidadeTreinamento,
        lojaTreinada,
        dataInicio,
        dataFim,
        qtdeRefeicoes,       // ★ já vem como "X refeições" do front
        consumoBebidas,

        // ★ L a S — TEXTO por extenso
        compreensaoTreinamento,   // col L — texto
        habilidadesTecnicas,      // col M — texto
        atitudesComportamento,    // col N — texto
        resolucaoProblemas,       // col O — texto
        trabalhoEquipe,           // col P — texto
        adesaoPadroes,            // col Q — texto
        feedbackMelhoria,         // col R — texto
        confiancaAutonomia,       // col S — texto

        // T — texto
        destaqueImportante,

        // U, V, W — notas 1-5
        avaliacaoComportamento,
        entendimentoConteudo,
        prontoFuncao,

        // X — nota 0-10
        multiplicadorNota,

        // Y — foto link
        fotoTrabalho,

        // ★ Z — TEXTO por extenso (era SIM/NÃO)
        aprovado,

        // AA — texto
        checkpointLoja,

        // Compatibilidade com chamadas antigas
        nota: notaLegado,
        observacoes: obsLegado,
    } = req.body;

    const entry = validarToken(token);
    if (!entry) return res.status(401).json({ sucesso: false, erro: 'Token inválido ou expirado.' });

    const tipo = tipoBody || entry.tipo || 'origem';

    const notaFinal = multiplicadorNota !== undefined ? Number(multiplicadorNota) : Number(notaLegado);
    if (isNaN(notaFinal) || notaFinal < 0 || notaFinal > 10)
        return res.status(400).json({ sucesso: false, erro: 'Nota (multiplicador) deve ser entre 0 e 10.' });

    if (tipo === 'treinadora' && !dataFim)
        return res.status(400).json({ sucesso: false, erro: 'Data de fim é obrigatória para a loja treinadora.' });

    let funcionario;
    try {
        funcionario = await getFuncionarioPorRowIndex(entry.rowIndex);
        if (!funcionario) return res.status(404).json({ sucesso: false, erro: 'Colaborador não encontrado.' });
    } catch (e) {
        return res.status(500).json({ sucesso: false, erro: e.message });
    }

    const agora = dataHojeBR();

    // ★ MAPEAMENTO: col A=1 ... col AB=28 (sem AC-AI)
    const COLS = {
        A:  1,  C:  3,  D:  4,  E:  5,  F:  6,  G:  7,
        H:  8,  I:  9,  J: 10,  K: 11,
        L: 12,  M: 13,  N: 14,  O: 15,  P: 16,  Q: 17,
        R: 18,  S: 19,  T: 20,  U: 21,  V: 22,  W: 23,
        X: 24,  Y: 25,  Z: 26, AA: 27, AB: 28,
    };

    const dados = {
        [COLS.A]:  agora,
        [COLS.C]:  treinadorNomeFuncao  || '',
        [COLS.D]:  unidadeTreinamento   || '',
        [COLS.E]:  funcionario.nome     || '',
        [COLS.F]:  funcionario.funcao   || '',
        [COLS.G]:  lojaTreinada         || funcionario.loja || '',
        [COLS.H]:  dataInicio           || '',
        [COLS.I]:  (tipo === 'treinadora' ? (dataFim || '') : ''),

        // ★ J — já vem formatado como "X refeições"
        [COLS.J]:  qtdeRefeicoes        || '',
        [COLS.K]:  consumoBebidas       || '',

        // ★ L a S — TEXTO por extenso
        [COLS.L]:  compreensaoTreinamento  || '',
        [COLS.M]:  habilidadesTecnicas     || '',
        [COLS.N]:  atitudesComportamento   || '',
        [COLS.O]:  resolucaoProblemas      || '',
        [COLS.P]:  trabalhoEquipe          || '',
        [COLS.Q]:  adesaoPadroes           || '',
        [COLS.R]:  feedbackMelhoria        || '',
        [COLS.S]:  confiancaAutonomia      || '',

        // T — texto
        [COLS.T]:  destaqueImportante      || obsLegado || '',

        // U, V, W — notas 1-5
        [COLS.U]:  avaliacaoComportamento  || '',
        [COLS.V]:  entendimentoConteudo    || '',
        [COLS.W]:  prontoFuncao            || '',

        // X — nota 0-10
        [COLS.X]:  notaFinal,

        // Y — foto
        [COLS.Y]:  fotoTrabalho            || '',

        // ★ Z — TEXTO por extenso
        [COLS.Z]:  aprovado                || '',

        // AA — checkpoint
        [COLS.AA]: checkpointLoja          || '',

        // AB — sistema
        [COLS.AB]: 'SIM',
    };

    try {
        await preencherAvaliacaoCompleta(dados);

        if (tipo === 'treinadora') {
            await preencherAvaliacaoTreinadora(entry.rowIndex, notaFinal, dataFim, destaqueImportante || obsLegado);
        } else {
            await preencherAvaliacao(entry.rowIndex, notaFinal, null, destaqueImportante || obsLegado);
        }

        enviarEmailResultadoAvaliacao(funcionario, notaFinal, dataFim, destaqueImportante || obsLegado, tipo)
            .then(() => console.log(`✅ Email resultado [${tipo}] enviado — ${funcionario.nome} nota ${notaFinal}`))
            .catch(err => console.error('⚠️  Falha no email resultado:', err.message));

        console.log(`✅ Avaliação [${tipo}] registrada: rowIndex=${entry.rowIndex} nota=${notaFinal} fim=${dataFim || '(não aplicável)'}`);
        res.json({ sucesso: true, nota: notaFinal, dataFim: dataFim || null, tipo });

    } catch (e) {
        console.error('Erro /avaliacao/registrar:', e.message);
        res.status(500).json({ sucesso: false, erro: e.message });
    }
});

/**
 * POST /avaliacao/upload-foto
 *
 * Recebe a foto via multipart/form-data, faz upload para o Google Drive
 * na pasta 132bmqewsgB9ZWisYIO0gMKL7Mrf3ScKy com o nome:
 *   data_FUNCIONARIO_avaliacao_de_LOJA.ext
 *
 * ★ Usa delegação de domínio: a Service Account impersona um usuário real
 *   (definido em GOOGLE_DRIVE_USER) que tem quota no Drive.
 *
 * Retorna { sucesso: true, link: "https://drive.google.com/file/d/..." }
 */
router.post('/upload-foto', upload.single('foto'), async (req, res) => {
    const { token, nomeArquivo } = req.body;

    // Valida token
    const entry = validarToken(token);
    if (!entry) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(401).json({ sucesso: false, erro: 'Token inválido ou expirado.' });
    }

    if (!req.file) {
        return res.status(400).json({ sucesso: false, erro: 'Nenhuma foto enviada.' });
    }

    if (!DRIVE_DELEGATED_USER) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(500).json({
            sucesso: false,
            erro: 'GOOGLE_DRIVE_USER não configurado no .env. Necessário para upload de fotos.',
        });
    }

    try {
        // ★ Autenticação via JWT com delegação de domínio (impersona usuário real)
        const keyData   = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
        const jwtClient = new google.auth.JWT({
            email:   keyData.client_email,
            key:     keyData.private_key,
            scopes:  ['https://www.googleapis.com/auth/drive'],
            subject: DRIVE_DELEGATED_USER,  // ★ Impersona este usuário
        });
        await jwtClient.authorize();

        const drive = google.drive({ version: 'v3', auth: jwtClient });

        // Detecta o mimeType
        const mimeMap = {
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'png': 'image/png',  'webp': 'image/webp',
        };
        const ext  = (nomeArquivo || req.file.originalname || 'foto.jpg').split('.').pop().toLowerCase();
        const mime = mimeMap[ext] || 'image/jpeg';

        // Upload para o Google Drive
        const driveResp = await drive.files.create({
            supportsAllDrives: true,
            requestBody: {
                name:    nomeArquivo || req.file.originalname,
                parents: [DRIVE_FOLDER_ID],
            },
            media: {
                mimeType: mime,
                body: fs.createReadStream(req.file.path),
            },
            fields: 'id, webViewLink',
        });

        const fileId = driveResp.data.id;
        const link   = driveResp.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

        // Torna o arquivo acessível via link (anyone with link)
        await drive.permissions.create({
            fileId,
            supportsAllDrives: true,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        // Remove arquivo temporário
        fs.unlinkSync(req.file.path);

        console.log(`📸 Foto enviada ao Drive: ${nomeArquivo} → ${link}`);
        res.json({ sucesso: true, link, fileId });

    } catch (e) {
        // Remove arquivo temporário em caso de erro
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('Erro /avaliacao/upload-foto:', e.message);
        res.status(500).json({ sucesso: false, erro: 'Erro ao enviar foto: ' + e.message });
    }
});

module.exports = { router, gerarLinkAvaliacao };