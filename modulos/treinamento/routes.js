// modulos/treinamento/routes.js
'use strict';

const express = require('express');
const path    = require('path');
const multer  = require('multer');
const router  = express.Router();
const { perguntarTreinamento } = require('./services/iaTreinamentoService');

const PUBLIC = path.join(__dirname, 'public');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ─── Services ────────────────────────────────────────────────────────────────
const sultsCache        = require('./services/sultsCache');
const chamadosCache     = require('./services/chamadosCache');
const turnoverCache     = require('./services/turnoverCache');
const universidadeCache = require('./services/universidadeCache');
const uploadsCache      = require('./services/uploadsCache');
const lembretesCache    = require('./services/lembretesCache');
const { gravarSultsNaPlanilha }  = require('./services/gravarSultsPlanilha');
const { enviarWhatsAppLembrete } = require('./services/whatsapp');
const { enviarEmailLembrete, enviarEmailLembreteSimples, enviarEmailAvaliacao, enviarWhatsAppAvaliacaoFuncionario } = require('./services/email');
const linksTreinamentoService = require('./services/linksTreinamentoService');
const kpiAvaliacoesService = require('./services/kpiAvalicoesService');

// ★ NOVO — busca separada com cache
const buscaCache   = require('./services/buscaCache');
const buscaService = require('./services/busca');

// ★ NOVO — cache de lembretes de avaliação
const avaliacaoLembretesCache = require('./services/avaliacaoLembretesCache');

const {
  listarPastas,
  criarPasta,
  uploadArquivo,
  listarArquivos,
  deletarArquivo,
  PASTA_RAIZ_ID,
} = require('./services/drive');

const {
  getSheetsData,
  atualizarCelula,
  marcarLembreteEnviado,
  marcarEmailAvaliacaoEnviado,
  preencherAvaliacao,
  gravarAvaliacao,
  buscarColaboradorExato,
  getFuncionariosParaLembrete,
  getHistoricoLembretes,
  getDashboardData,
  getFuncionarioPorRowIndex,
  getOpcoesListas,
  cadastrarFuncionario,
  getLojasTrinadasPorMes,
  getPremioRefeicaoPorMes,
  getPerfilDesenvolvimento,
  getValoresData,
  getDashboardValores,
  getValoresPeriodos,
  getCadastralDashboardData,
  // ★ NOVAS FUNÇÕES do sheets.js
  marcarAvaliacaoEnviadaLojas,
  marcarWhatsappAvaliacaoFunc,
  getFuncionariosParaAvaliacaoLembrete,
  getHistoricoAvaliacaoLembretes,
} = require('./services/sheets');

// ─── Inicializar caches ───────────────────────────────────────────────────────
sultsCache.inicializar().catch(e => console.error('SULTS init falhou:', e.message));
chamadosCache.inicializar().catch(e => console.error('CHAMADOS init falhou:', e.message));
universidadeCache.inicializar().catch(e => console.error('Universidade init falhou:', e.message));
turnoverCache.inicializar().catch(e => console.error('TURNOVER init falhou:', e.message));
uploadsCache.inicializar().catch(e => console.error('UPLOADS init falhou:', e.message));
lembretesCache.inicializar().catch(e => console.error('LEMBRETES init falhou:', e.message));
buscaCache.inicializar().catch(e => console.error('BUSCA-CACHE init falhou:', e.message));
// ★ NOVO
avaliacaoLembretesCache.inicializar().catch(e => console.error('AVALIACAO-LEMBRETES init falhou:', e.message));

const { router: avaliacaoRouter, gerarLinkAvaliacao } = require('./services/avaliacao');
router.use('/avaliacao', avaliacaoRouter);

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINAS HTML
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/', (req, res) =>
  res.sendFile(path.join(PUBLIC, 'dashborard-treinamento.html'))
);
router.get('/avaliacao',    (req, res) => res.sendFile(path.join(PUBLIC, 'avaliacao.html')));
router.get('/chamados',     (req, res) => res.sendFile(path.join(PUBLIC, 'chamados.html')));
router.get('/sults',        (req, res) => res.sendFile(path.join(PUBLIC, 'sults.html')));
router.get('/turnover',     (req, res) => res.sendFile(path.join(PUBLIC, 'turnover.html')));
router.get('/universidade', (req, res) => res.sendFile(path.join(PUBLIC, 'universidade.html')));
router.get('/valores',      (req, res) => res.sendFile(path.join(PUBLIC, 'valores.html')));
router.get('/uploads',      (req, res) => res.sendFile(path.join(PUBLIC, 'uploads.html')));
router.get('/cadastro',     (req, res) => res.sendFile(path.join(PUBLIC, 'cadastro.html')));
router.get('/links', (req, res) => res.sendFile(path.join(PUBLIC, 'links.html')));
router.get('/kpi-avaliacoes', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'avaliacoesKPI.html'))
);
router.get('/busca', (req, res) => res.sendFile(path.join(PUBLIC, 'busca.html')));

router.use('/busca-api', buscaService);
router.use('/links-api', linksTreinamentoService);
router.use('/kpi-avaliacoes', kpiAvaliacoesService);
router.use('/busca-api', buscaService);
// ─── Arquivos estáticos ───────────────────────────────────────────────────────
router.use(express.static(PUBLIC, { index: false, extensions: false }));

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS / CACHE
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/status', async (req, res) => {
  try {
    const rows = await getSheetsData();
    res.json({ status: 'pronto', total: rows.filter(r => r[2]).length, ultimaAtualizacao: new Date().toISOString() });
  } catch (e) { res.json({ status: 'erro', total: 0, erro: e.message }); }
});

router.get('/cache/progresso', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  req.on('close', () => {});
});

router.post('/recarregar-cache', async (req, res) => {
  try {
    const rows = await getSheetsData();
    res.json({ sucesso: true, total: rows.filter(r => r[2]).length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/dashboard', async (req, res) => {
  try { res.json(await getDashboardData()); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/dashboard/lojas', async (req, res) => {
  try {
    const ano = req.query.ano || '2026';
    res.json({ ano, meses: await getLojasTrinadasPorMes(ano) });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/dashboard/cadastral', async (req, res) => {
  try { res.json(await getCadastralDashboardData(req.query.ano || '2026')); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/dashboard/perfil-desenvolvimento', async (req, res) => {
  try { res.json(await getPerfilDesenvolvimento(req.query.ano || '2026')); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AVALIAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/avaliacao/gravar', async (req, res) => {
  try {
    const { rowIndex, nota, dataFim } = req.body;
    if (rowIndex === undefined) return res.status(400).json({ erro: 'rowIndex obrigatório' });
    await preencherAvaliacao(rowIndex, nota, dataFim || null);
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/avaliacao/responder', async (req, res) => {
  try {
    const { rowIndex, nota } = req.body;
    if (rowIndex === undefined || nota === undefined)
      return res.status(400).json({ erro: 'rowIndex e nota obrigatórios' });
    await gravarAvaliacao(Number(rowIndex), nota);
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CADASTRO
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/cadastro/opcoes', async (req, res) => {
  try { res.json(await getOpcoesListas()); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/cadastro/buscar', async (req, res) => {
  try {
    const { cpf, nome } = req.query;
    if (!cpf && !nome) return res.status(400).json({ erro: 'CPF ou nome obrigatório' });
    const colaborador = await buscarColaboradorExato({ cpf, nome });
    if (!colaborador) return res.status(404).json({ erro: 'Não encontrado' });
    res.json(colaborador);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/cadastro/funcionario/:rowIndex', async (req, res) => {
  try {
    const funcionario = await getFuncionarioPorRowIndex(parseInt(req.params.rowIndex, 10));
    if (!funcionario) return res.status(404).json({ erro: 'Não encontrado' });
    res.json(funcionario);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/cadastro',  async (req, res) => _cadastrar(req, res));
router.post('/cadastrar', async (req, res) => _cadastrar(req, res));

async function _cadastrar(req, res) {
  try {
    const dados = req.body;
    if (!dados.nome) return res.status(400).json({ erro: 'Nome obrigatório' });
    res.json(await cadastrarFuncionario(dados));
  } catch (e) { res.status(500).json({ erro: e.message }); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUSCA
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/busca', async (req, res) => {
  try {
    const { q, loja, funcao } = req.query;
    const rows = await getSheetsData();
    let resultado = rows.map((row, index) => ({
      rowIndex: index, linhaReal: index + 9,
      numero: row[0] || '', loja: row[1] || '', nome: row[2] || '',
      cpf: row[3] || '', rg: row[4] || '', funcao: row[5] || '',
      turno: row[6] || '', email: row[12] || '', telefone: row[13] || '',
      inicioTrein: row[14] || '', fimTrein: row[15] || '',
      modelo: row[23] || '', pago: row[26] || '',
      mes: row[30] || '', ano: row[31] || '',
      aprovado: row[32] || '', nota: row[33] || '',
    })).filter(r => r.nome);
    if (q) {
      const term = q.toLowerCase().trim();
      resultado = resultado.filter(r =>
        r.nome.toLowerCase().includes(term) || r.cpf.includes(term) ||
        r.loja.toLowerCase().includes(term) || r.funcao.toLowerCase().includes(term)
      );
    }
    if (loja)   resultado = resultado.filter(r => r.loja === loja);
    if (funcao) resultado = resultado.filter(r => r.funcao === funcao);
    res.json({ total: resultado.length, resultado });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/buscar', async (req, res) => {
  try {
    const { pergunta } = req.body;
    if (!pergunta) return res.json([]);
    const rows = await getSheetsData();
    const term = pergunta.toLowerCase().trim();
    const resultado = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row[2])
      .filter(({ row }) => {
        const nome   = (row[2] || '').toLowerCase();
        const loja   = (row[1] || '').toLowerCase();
        const funcao = (row[5] || '').toLowerCase();
        const cpf    = row[3] || '';
        return nome.includes(term) || loja.includes(term) || funcao.includes(term) || cpf.includes(term);
      })
      .slice(0, 20)
      .map(({ row, index }) => ({
        rowIndex: index,
        nome: row[2] || '', loja: row[1] || '', funcao: row[5] || '',
        turno: row[6] || '', cpf: row[3] || '', email: row[12] || '',
        telefone: row[13] || '', inicioTrein: row[14] || '', fimTrein: row[15] || '',
        similaridade: (() => {
          const n = (row[2] || '').toLowerCase();
          return n === term ? 1 : n.startsWith(term) ? 0.95 : n.includes(term) ? 0.8 : 0.5;
        })(),
      }))
      .sort((a, b) => b.similaridade - a.similaridade);
    res.json(resultado);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LEMBRETES
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/lembretes', async (req, res) => {
  const accept = req.headers.accept || '';
  const isHtmlRequest = accept.includes('text/html') && !accept.includes('application/json');
  if (isHtmlRequest) {
    return res.sendFile(path.join(PUBLIC, 'lembretes.html'));
  }
  try {
    const lista     = await getFuncionariosParaLembrete();
    const historico = lembretesCache.getDados()?.historico || [];
    lembretesCache.setDados(lista, historico);
    res.json(lista);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/lembretes/status', (req, res) => {
  res.json(lembretesCache.getStatus());
});

router.get('/lembretes/historico', async (req, res) => {
  try {
    const { inicio, fim, mes, ano } = req.query;
    let historico = await getHistoricoLembretes();

    function parseDMY(str) {
      if (!str) return null;
      const p = String(str).trim().split('/');
      if (p.length === 3) {
        const dt = new Date(+p[2], +p[1] - 1, +p[0], 0, 0, 0, 0);
        return isNaN(dt.getTime()) ? null : dt;
      }
      return null;
    }

    if (inicio || fim) {
      const dtInicio = parseDMY(inicio);
      const dtFim    = parseDMY(fim);
      historico = historico.filter(h => {
        const dt = parseDMY(h.inicioTrein);
        if (!dt) return false;
        if (dtInicio && dt < dtInicio) return false;
        if (dtFim    && dt > dtFim)    return false;
        return true;
      });
    }

    if (mes) {
      const mesN = parseInt(mes, 10);
      historico = historico.filter(h => {
        const dt = parseDMY(h.inicioTrein);
        return dt && (dt.getMonth() + 1) === mesN;
      });
    }

    if (ano) {
      const anoN = parseInt(ano, 10);
      historico = historico.filter(h => {
        const dt = parseDMY(h.inicioTrein);
        return dt && dt.getFullYear() === anoN;
      });
    }

    const lista = lembretesCache.getDados()?.lista || [];
    lembretesCache.setDados(lista, historico);
    res.json({ total: historico.length, historico });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ★ POST /enviar-lembrete — ALTERADO: SEM link de avaliação
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/enviar-lembrete', async (req, res) => {
  try {
    const f = req.body;
    if (f.rowIndex === undefined)
      return res.status(400).json({ sucesso: false, erro: 'rowIndex obrigatório.' });
    if (!['5dias', '2dias', 'hoje'].includes(f.tipo))
      return res.status(400).json({ sucesso: false, erro: 'tipo deve ser: 5dias, 2dias ou hoje.' });

    const dataHora = new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const textoLembrete = `Lembrete enviado em ${dataHora}`;
    const colunaMap = {
      '5dias': 'lembrete5Dias',
      '2dias': 'lembrete2Dias',
      'hoje':  'lembreteHoje',
    };

    await atualizarCelula(f.rowIndex, colunaMap[f.tipo], textoLembrete);
    lembretesCache.marcarEnviado(f.rowIndex, f.tipo);

    res.json({ sucesso: true, lembrete: textoLembrete, tipo: f.tipo });

    if (f.telefone) {
      enviarWhatsAppLembrete({ ...f, diffDias: f.diffDias ?? 0 })
        .catch(e => console.error('[LEMBRETE] WhatsApp:', e.message));
    }

    if (f.email || f.emailLojaAvaliadora) {
      enviarEmailLembreteSimples(f)
        .catch(e => console.error('[LEMBRETE] Email simples:', e.message));
    }

  } catch (e) {
    console.error('[LEMBRETE] Erro:', e.message);
    if (!res.headersSent) res.status(500).json({ sucesso: false, erro: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ★ NOVAS ROTAS — LEMBRETES DE AVALIAÇÃO (fimTrein = hoje)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /lembretes-avaliacao
 * Lista funcionários cujo fimTrein (col P) = hoje
 * e email de avaliação ainda não foi enviado (col AK vazia)
 */
router.get('/lembretes-avaliacao', async (req, res) => {
  try {
    const lista = await getFuncionariosParaAvaliacaoLembrete();
    const pendentes = lista.filter(f => !f.emailAvaliacaoEnviado).length;
    avaliacaoLembretesCache.setDados(lista, avaliacaoLembretesCache.getDados()?.historico || []);
    res.json({ lista, total: lista.length, pendentes });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/**
 * GET /lembretes-avaliacao/status
 */
router.get('/lembretes-avaliacao/status', (req, res) => {
  res.json(avaliacaoLembretesCache.getStatus());
});

/**
 * GET /lembretes-avaliacao/historico
 * Histórico de emails de avaliação já enviados (col AK preenchida)
 */
router.get('/lembretes-avaliacao/historico', async (req, res) => {
  try {
    const { mes, ano } = req.query;
    let historico = await getHistoricoAvaliacaoLembretes();

    function parseDMY(str) {
      if (!str) return null;
      const p = String(str).trim().split('/');
      if (p.length === 3) {
        const dt = new Date(+p[2], +p[1] - 1, +p[0], 0, 0, 0, 0);
        return isNaN(dt.getTime()) ? null : dt;
      }
      return null;
    }

    if (mes) {
      const mesN = parseInt(mes, 10);
      historico = historico.filter(h => {
        const dt = parseDMY(h.fimTrein);
        return dt && (dt.getMonth() + 1) === mesN;
      });
    }
    if (ano) {
      const anoN = parseInt(ano, 10);
      historico = historico.filter(h => {
        const dt = parseDMY(h.fimTrein);
        return dt && dt.getFullYear() === anoN;
      });
    }

    avaliacaoLembretesCache.setDados(
      avaliacaoLembretesCache.getDados()?.lista || [],
      historico
    );
    res.json({ total: historico.length, historico });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/**
 * POST /enviar-lembrete-avaliacao
 * Envia email COM link de avaliação para as lojas (dia final do treinamento)
 * Body: { rowIndex, nome, loja, funcao, email, emailLojaAvaliadora, inicioTrein, fimTrein, ... }
 */
router.post('/enviar-lembrete-avaliacao', async (req, res) => {
  try {
    const f = req.body;
    if (f.rowIndex === undefined)
      return res.status(400).json({ sucesso: false, erro: 'rowIndex obrigatório.' });

    const baseUrl = (process.env.BASE_URL || 'http://localhost:3000') + '/treinamento';

    const linkOrigem     = gerarLinkAvaliacao(f.rowIndex, baseUrl, 'origem');
    const linkTreinadora = gerarLinkAvaliacao(f.rowIndex, baseUrl, 'treinadora');

    await enviarEmailAvaliacao(f, linkOrigem, linkTreinadora);
    await marcarAvaliacaoEnviadaLojas(f.rowIndex);
    avaliacaoLembretesCache.marcarEnviado(f.rowIndex);

    console.log(`✅ Email avaliação enviado: ${f.nome} (row ${f.rowIndex})`);
    res.json({ sucesso: true, linkOrigem, linkTreinadora });

  } catch (e) {
    console.error('[LEMBRETE-AVALIACAO] Erro:', e.message);
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

/**
 * POST /enviar-whatsapp-avaliacao-funcionario
 * Envia WhatsApp para o funcionário avaliar a loja (após ambas lojas avaliarem)
 * Body: { rowIndex, nome, telefone, loja, ... }
 */
router.post('/enviar-whatsapp-avaliacao-funcionario', async (req, res) => {
  try {
    const f = req.body;
    if (f.rowIndex === undefined)
      return res.status(400).json({ sucesso: false, erro: 'rowIndex obrigatório.' });
    if (!f.telefone)
      return res.status(400).json({ sucesso: false, erro: 'Telefone obrigatório.' });

    const baseUrl = (process.env.BASE_URL || 'http://localhost:3000') + '/treinamento';

    const linkFuncionario = gerarLinkAvaliacao(f.rowIndex, baseUrl, 'funcionario');

    await enviarWhatsAppAvaliacaoFuncionario({
      ...f,
      linkAvaliacao: linkFuncionario,
    });

    await marcarWhatsappAvaliacaoFunc(f.rowIndex);
    avaliacaoLembretesCache.marcarWhatsappFuncEnviado(f.rowIndex);

    console.log(`✅ WhatsApp avaliação funcionário: ${f.nome} (row ${f.rowIndex})`);
    res.json({ sucesso: true, linkFuncionario });

  } catch (e) {
    console.error('[WHATSAPP-AVALIACAO] Erro:', e.message);
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HISTÓRICO (legado)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/historico', async (req, res) => {
  try {
    const { loja, mes, ano } = req.query;
    const rows = await getSheetsData();
    let resultado = rows.map((row, index) => ({
      rowIndex: index, linhaReal: index + 9,
      loja: row[1] || '', nome: row[2] || '', cpf: row[3] || '',
      funcao: row[5] || '', inicioTrein: row[14] || '', fimTrein: row[15] || '',
      lembrete: row[34] ? 'Lembrete enviado em ' + row[34] : '',
      emailAvaliacao: row[24] || '', notaAvaliacao: row[33] || '',
      mes: row[30] || '', ano: row[31] || '',
    })).filter(r => r.nome && r.lembrete);
    if (loja) resultado = resultado.filter(r => r.loja === loja);
    if (mes)  resultado = resultado.filter(r => String(r.mes) === String(mes));
    if (ano)  resultado = resultado.filter(r => String(r.ano) === String(ano));
    res.json(resultado);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// VALORES
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/valores/dashboard', async (req, res) => {
  try { res.json(await getDashboardValores(req.query.mes || null, req.query.ano || '2026')); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/valores/detalhes', async (req, res) => {
  try {
    const { mes, ano, pago, aprovado, loja } = req.query;
    let dados = await getValoresData();
    if (mes)      dados = dados.filter(r => String(r.mesTreinamento) === String(mes));
    if (ano)      dados = dados.filter(r => String(r.anoTreinamento) === String(ano));
    if (loja)     dados = dados.filter(r => r.loja === loja);
    if (pago)     dados = dados.filter(r => String(r.pago).toUpperCase() === pago.toUpperCase());
    if (aprovado) dados = dados.filter(r => String(r.aprovado).toUpperCase() === aprovado.toUpperCase());
    res.json({ total: dados.length, dados });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/valores/periodos', async (req, res) => {
  try { res.json(await getValoresPeriodos()); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/valores/premio-refeicao', async (req, res) => {
  try { res.json(await getPremioRefeicaoPorMes(req.query.mes || null, req.query.ano || '2026')); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TURNOVER
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/turnover/dados', async (req, res) => {
  try {
    const { ano } = req.query;
    const cache = turnoverCache.getDados();
    if (ano && cache && String(cache.ano) !== String(ano)) {
      const { getTurnoverCadastral } = require('./services/turnover');
      const data = await getTurnoverCadastral(ano);
      if (cache.anos && cache.anos.length) data.anos = cache.anos;
      return res.json(data);
    }
    if (cache) return res.json(cache);
    const { getTurnoverCadastral } = require('./services/turnover');
    res.json(await getTurnoverCadastral(ano || null));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/turnover/registros', async (req, res) => {
  try {
    const { ano } = req.query;
    const { getTurnoverRegistros } = require('./services/turnover');
    res.json(await getTurnoverRegistros(ano || null));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/turnover/status',  (req, res) => res.json(turnoverCache.getStatus()));

router.get('/turnover/resumo', (req, res) => {
  const dados = turnoverCache.getDados();
  if (!dados) return res.status(503).json({ erro: 'Cache ainda carregando...' });
  res.json({
    ano:           dados.ano,
    pctTurnover:   dados.pctTurnover,
    totalAtivos:   dados.totalAtivos,
    desligadosAno: dados.desligadosAno,
    totalGeral:    dados.totalGeral,
    sincronizadoEm: dados.sincronizadoEm,
  });
});

router.post('/turnover/sincronizar', async (req, res) => {
  try {
    const dados = await turnoverCache.sincronizarEAtualizar('manual');
    res.json({ ok: true, pctTurnover: dados.pctTurnover, sincronizadoEm: dados.sincronizadoEm });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

router.patch('/turnover/:rowIndex', async (req, res) => {
  try {
    const rowIndex = parseInt(req.params.rowIndex, 10);
    if (isNaN(rowIndex)) return res.status(400).json({ erro: 'rowIndex inválido' });
    const { continua, mesmoCargo, motivo } = req.body;
    const { gravarDesligamento } = require('./services/turnover');
    await gravarDesligamento(rowIndex, continua, mesmoCargo, motivo);
    await turnoverCache.sincronizarEAtualizar('patch');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/turnover/importar', async (req, res) => {
  try {
    const { importarDaCadastral } = require('./services/turnover');
    const resultado = await importarDaCadastral(req.body);
    res.json(resultado);
  } catch (e) { res.status(500).json({ sucesso: false, erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHAMADOS
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/chamados/dados', (req, res) => {
  const dados = chamadosCache.getDados();
  if (!dados) return res.json({ erro: 'Cache ainda não disponível. Clique em Sincronizar.', chamados: [], totalTD: 0 });
  res.json(dados);
});

router.get('/chamados/resumo', (req, res) => {
  const dados = chamadosCache.getDados();
  if (!dados) return res.json({ totalTD: 0, totalAbertos: 0, totalFechados: 0 });
  res.json({ totalTD: dados.totalTD, totalAbertos: dados.totalAbertos, totalFechados: dados.totalFechados, salvoEm: dados.sincronizadoEm });
});

router.get('/chamados/status', (req, res) => res.json(chamadosCache.getStatus()));

router.post('/chamados/sincronizar', async (req, res) => {
  try {
    const dados = await chamadosCache.sincronizarEAtualizar('manual');
    res.json({ ok: true, totalTD: dados.totalTD, sincronizadoEm: dados.sincronizadoEm });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

router.put('/chamados/:id/concluir', async (req, res) => {
  const { id } = req.params;
  const { pessoaId, nota, observacao } = req.body;
  if (!pessoaId) return res.status(400).json({ ok: false, erro: 'pessoaId é obrigatório' });
  try {
    res.json({ ok: true, result: await chamadosCache.concluir(id, pessoaId, nota, observacao) });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SULTS
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/sults/dados', async (req, res) => {
  try {
    let dados = sultsCache.getDados();
    if (!dados) dados = await sultsCache.sincronizarEAtualizar('auto');
    if (!dados) return res.status(503).json({ erro: 'Dados indisponíveis' });
    res.json(dados);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/sults/resumo', async (req, res) => {
  try {
    let dados = sultsCache.getDados();
    if (!dados) dados = await sultsCache.sincronizarEAtualizar('auto');
    if (!dados) return res.status(503).json({ erro: 'Dados indisponíveis' });
    res.json({
      totalUnidades:     dados.totalUnidades,
      totalFuncionarios: dados.totalFuncionarios,
      totalImplantacao:  dados.totalUnidadesImplantacao,
      sincronizadoEm:    dados.sincronizadoEm,
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/sults/unidade/:id', async (req, res) => {
  try {
    let dados = sultsCache.getDados();
    if (!dados) dados = await sultsCache.sincronizarEAtualizar('auto');
    if (!dados) return res.status(503).json({ erro: 'Dados indisponíveis' });
    const unidade = dados.unidades?.find(u => String(u.id) === String(req.params.id));
    if (!unidade) return res.status(404).json({ erro: 'Unidade não encontrada' });
    res.json(unidade);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/sults/status', (req, res) => res.json(sultsCache.getStatus()));

router.post('/sults/sincronizar', async (req, res) => {
  try {
    const dados = await sultsCache.sincronizarEAtualizar('manual');
    try { await gravarSultsNaPlanilha(dados); }
    catch (errPlan) { console.error('❌ ERRO AO GRAVAR PLANILHA:', errPlan.message); }
    res.json({ sucesso: true, totalUnidades: dados.totalUnidades, totalFuncionarios: dados.totalFuncionarios, sincronizadoEm: dados.sincronizadoEm });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIVERSIDADE
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/universidade/dados', async (req, res) => {
  try {
    let dados = universidadeCache.getDados();
    if (!dados || dados.totalLinhas === 0 || req.query.forcar === '1') {
      dados = await universidadeCache.sincronizarEAtualizar(
        req.query.forcar === '1' ? 'manual' : 'cache vazio'
      );
    }
    res.json(dados);
  } catch (e) {
    const dados = universidadeCache.getDados();
    if (dados) return res.json({ ...dados, erro: e.message });
    res.status(500).json({ erro: e.message, linhas: [] });
  }
});

router.get('/universidade/status', (req, res) => res.json(universidadeCache.getStatus()));

router.post('/universidade/sincronizar', async (req, res) => {
  try {
    const dados = await universidadeCache.sincronizarEAtualizar('manual');
    res.json({ ok: true, totalLinhas: dados.totalLinhas, sincronizadoEm: dados.sincronizadoEm });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOADS — Google Drive
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/uploads/status', (req, res) => {
  res.json({ ok: true, ...uploadsCache.getStatus() });
});

router.post('/uploads/sincronizar', async (req, res) => {
  try {
    const dados = await uploadsCache.sincronizarEAtualizar('manual');
    res.json({ ok: true, totalPastas: dados.totalPastas, sincronizadoEm: dados.sincronizadoEm });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

router.get('/uploads/pastas', async (req, res) => {
  try {
    const { pastaId } = req.query;
    if (!pastaId || pastaId === PASTA_RAIZ_ID) {
      let dados = uploadsCache.getDados();
      if (!dados) dados = await uploadsCache.sincronizarEAtualizar('auto');
      return res.json({ ok: true, pastas: dados.pastas, cache: true });
    }
    const pastas = await listarPastas(pastaId);
    res.json({ ok: true, pastas });
  } catch (e) {
    console.error('[UPLOADS] Erro ao listar pastas:', e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.post('/uploads/pastas', async (req, res) => {
  try {
    const { nome, pastaId } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ ok: false, erro: 'Nome da pasta é obrigatório' });
    const pasta = await criarPasta(nome.trim(), pastaId || PASTA_RAIZ_ID);
    await uploadsCache.sincronizarEAtualizar('nova-pasta').catch(() => {});
    res.json({ ok: true, pasta });
  } catch (e) {
    console.error('[UPLOADS] Erro ao criar pasta:', e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.get('/uploads/arquivos', async (req, res) => {
  try {
    const { pastaId } = req.query;
    const arquivos = await listarArquivos(pastaId || PASTA_RAIZ_ID);
    res.json({ ok: true, arquivos });
  } catch (e) {
    console.error('[UPLOADS] Erro ao listar arquivos:', e.message);
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
        console.log(`[UPLOADS] ✅ ${file.originalname} → Drive (${arquivo.id})`);
      } catch (e) {
        console.error(`[UPLOADS] ❌ ${file.originalname}:`, e.message);
        erros.push({ nome: file.originalname, erro: e.message });
      }
    }
    res.json({ ok: erros.length === 0, enviados: resultados.length, arquivos: resultados, erros: erros.length ? erros : undefined });
  } catch (e) {
    console.error('[UPLOADS] Erro no upload:', e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.delete('/uploads/arquivos/:fileId', async (req, res) => {
  try {
    await deletarArquivo(req.params.fileId);
    res.json({ ok: true });
  } catch (e) {
    console.error('[UPLOADS] Erro ao deletar arquivo:', e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// IA — Treinamento
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/ia-treinamento/perguntar', async (req, res) => {
  try {
    const { pergunta, contexto = '' } = req.body;
    const usuario = req.user?.nome || req.user?.email || '';
    if (!pergunta) return res.status(400).json({ ok: false, erro: 'Campo "pergunta" é obrigatório.' });
    const resposta = await perguntarTreinamento({ pergunta, contexto, usuario });
    return res.json({ ok: true, resposta });
  } catch (e) {
    console.error('[IA-TREINAMENTO] Erro:', e.message);
    const isQuota = String(e.message).toLowerCase().includes('cota') || String(e.message).toLowerCase().includes('quota');
    return res.status(isQuota ? 429 : 500).json({ ok: false, erro: e.message });
  }
});

router.post('/ia/analisar', async (req, res) => {
  try {
    const { pergunta, contexto = '', ano } = req.body;
    const usuario = req.user?.nome || req.user?.email || '';
    if (!pergunta) return res.status(400).json({ erro: 'pergunta obrigatória', resposta: '❌ Erro: pergunta obrigatória' });
    const contextoFinal = contexto || ('Ano de referência: ' + String(ano || new Date().getFullYear()));
    const resposta = await perguntarTreinamento({ pergunta, contexto: contextoFinal, usuario });
    return res.json({ resposta });
  } catch (e) {
    console.error('[IA-ANALISAR] Erro:', e.message);
    const isQuota = String(e.message).toLowerCase().includes('cota') || String(e.message).toLowerCase().includes('quota');
    return res.status(isQuota ? 429 : 500).json({ erro: e.message, resposta: '❌ Erro: ' + e.message });
  }
});

router.post('/ia', async (req, res) => {
  try {
    const { pergunta, contexto = '', ano } = req.body;
    const usuario = req.user?.nome || req.user?.email || '';
    if (!pergunta) return res.status(400).json({ erro: 'pergunta obrigatória', resposta: '❌ Erro: pergunta obrigatória' });
    const contextoFinal = contexto || ('Ano de referência: ' + String(ano || new Date().getFullYear()));
    const resposta = await perguntarTreinamento({ pergunta, contexto: contextoFinal, usuario });
    return res.json({ resposta });
  } catch (e) {
    console.error('[IA] Erro:', e.message);
    const isQuota = String(e.message).toLowerCase().includes('cota') || String(e.message).toLowerCase().includes('quota');
    return res.status(isQuota ? 429 : 500).json({ erro: e.message, resposta: '❌ Erro: ' + e.message });
  }
});

router.post('/ia/turnover', async (req, res) => {
  try {
    const { pergunta } = req.body;
    const usuario = req.user?.nome || req.user?.email || '';
    if (!pergunta) return res.status(400).json({ erro: 'pergunta obrigatória', resposta: '❌ Erro: pergunta obrigatória' });
    const cache = turnoverCache.getDados();
    const contexto = cache
      ? `DADOS DE TURNOVER:\nAno: ${cache.ano}\nTurnover: ${cache.pctTurnover}%\nAtivos: ${cache.totalAtivos}\nDesligados no ano: ${cache.desligadosAno}\nTotal geral: ${cache.totalGeral}\nMotivos: ${JSON.stringify(cache.motivos || [])}\nPor loja: ${JSON.stringify(cache.porLoja || [])}`
      : 'Dados de turnover não disponíveis.';
    const resposta = await perguntarTreinamento({ pergunta, contexto, usuario });
    return res.json({ resposta });
  } catch (e) {
    console.error('[IA-TURNOVER] Erro:', e.message);
    const isQuota = String(e.message).toLowerCase().includes('cota') || String(e.message).toLowerCase().includes('quota');
    return res.status(isQuota ? 429 : 500).json({ erro: e.message, resposta: '❌ Erro: ' + e.message });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({
  modulo:    'treinamento',
  status:    'online',
  lembretes: lembretesCache.getStatus(),
  avaliacaoLembretes: avaliacaoLembretesCache.getStatus(),
  ia:        process.env.GEMINI_API_KEY ? 'configurada' : 'sem GEMINI_API_KEY',
  model:     process.env.GEMINI_MODEL || 'gemini-2.0-flash',
}));

module.exports = router;