const { GoogleGenAI } = require('@google/genai');
const { getSheetsData } = require('./sheets');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CACHE_FILE =
  process.env.CACHE_FILE_PATH || path.join(__dirname, '../cache/embeddings_cache.json');

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY não definida no .env');
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function gerarEmbedding(texto) {
  const result = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: texto,
  });

  const embedding =
    result.embeddings?.[0]?.values ||
    result.embeddings?.[0]?.embedding?.values ||
    result.embedding?.values;

  if (!embedding) {
    throw new Error('Não foi possível obter embedding da resposta da Gemini API.');
  }

  return embedding;
}

function calcularSimilaridade(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * (vecB[i] || 0), 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / Math.max(magnitudeA * magnitudeB, 1e-12);
}

function hashLinha(row) {
  const chave = [row[2], row[1], row[5], row[12], row[13], row[14], row[15]].join('|');
  return crypto.createHash('md5').update(chave).digest('hex');
}

function rowParaObj(row, index, vetor, hash) {
  return {
    vetor, hash, rowIndex: index,
    numero:      row[0]  || '',
    loja:        row[1]  || '',
    nome:        row[2]  || '',
    cpf:         row[3]  || '',
    rg:          row[4]  || '',
    funcao:      row[5]  || '',
    turno:       row[6]  || '',
    email:       row[12] || '',
    telefone:    row[13] || '',
    inicioTrein: row[14] || '',
    fimTrein:    row[15] || '',
    avaliacao:   row[25] || '',
    avaliadoOk:  row[33] || '',
    lembrete:    row[34] || '',
  };
}

function lerCacheDisco() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log(`💾 Cache do disco: ${data.length} entradas`);
      return data;
    }
  } catch (e) {
    console.warn('⚠️ Erro ao ler cache:', e.message);
  }
  return [];
}

function salvarCacheDisco(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    console.log(`💾 Cache salvo: ${cache.length} entradas`);
  } catch (e) {
    console.warn('⚠️ Erro ao salvar cache:', e.message);
  }
}

let CACHE = [];
let _cacheStatus = 'vazio';
let _ultimaAtualizacao = null;
let _ultimoLog = { adicionados: 0, atualizados: 0, removidos: 0, inalterados: 0 };

async function carregarCache(forcarCompleto = false) {
  console.log('\n📊 Iniciando carregamento do cache...');
  _cacheStatus = 'carregando';

  const rows = await getSheetsData();
  const rowsValidas = rows.map((row, i) => ({ row, i })).filter(({ row }) => row[2]);
  const cacheDisco = forcarCompleto ? [] : lerCacheDisco();
  const cacheMap = new Map(cacheDisco.map(c => [c.rowIndex, c]));

  let adicionados = 0, atualizados = 0, inalterados = 0, removidos = 0;
  const novoCache = [];
  const aProcessar = [];

  rowsValidas.forEach(({ row, i }) => {
    const hash = hashLinha(row);
    const existente = cacheMap.get(i);

    if (!existente) {
      aProcessar.push({ row, index: i, hash, tipo: 'novo' });
    } else if (existente.hash !== hash) {
      aProcessar.push({ row, index: i, hash, tipo: 'atualizado' });
    } else {
      novoCache.push(existente);
      inalterados++;
    }
  });

  cacheMap.forEach((_, idx) => {
    if (!rowsValidas.some(({ i }) => i === idx)) removidos++;
  });

  console.log(`\n📋 Diff: ✅${inalterados} ➕${aProcessar.filter(x => x.tipo === 'novo').length} ✏️${aProcessar.filter(x => x.tipo === 'atualizado').length} 🗑️${removidos}`);

  if (aProcessar.length === 0) {
    CACHE = novoCache.sort((a, b) => a.rowIndex - b.rowIndex);
    _cacheStatus = 'pronto';
    _ultimaAtualizacao = new Date();
    _ultimoLog = { adicionados, atualizados, removidos, inalterados };
    console.log('✅ Cache já atualizado!');
    return;
  }

  console.log(`\n🧠 Gerando embeddings para ${aProcessar.length} linha(s)...`);

  for (let i = 0; i < aProcessar.length; i++) {
    const { row, index, hash, tipo } = aProcessar[i];
    process.stdout.write(`\r[${i + 1}/${aProcessar.length}] ${tipo === 'novo' ? '➕' : '✏️ '} ${(row[2] || '').padEnd(45)}`);

    const textoBase = [
      `Nome: ${row[2] || ''}`,
      `Loja: ${row[1] || ''}`,
      `Função: ${row[5] || ''}`,
      `Turno: ${row[6] || ''}`,
      `Email: ${row[12] || ''}`,
      `Telefone: ${row[13] || ''}`,
    ].join(' | ');

    const vetor = await gerarEmbedding(textoBase);
    novoCache.push(rowParaObj(row, index, vetor, hash));

    if (tipo === 'novo') adicionados++;
    else atualizados++;
  }

  CACHE = novoCache.sort((a, b) => a.rowIndex - b.rowIndex);
  salvarCacheDisco(CACHE);
  _ultimaAtualizacao = new Date();
  _ultimoLog = { adicionados, atualizados, removidos, inalterados };
  _cacheStatus = 'pronto';
  console.log(`\n✅ Cache pronto! ${CACHE.length} total`);
}

async function buscarPorNome(pergunta) {
  const vetorPergunta = await gerarEmbedding(pergunta);

  const resultados = CACHE.map(doc => ({
    ...doc,
    similaridade: calcularSimilaridade(vetorPergunta, doc.vetor),
  }));

  resultados.sort((a, b) => b.similaridade - a.similaridade);

  if (resultados[0]?.similaridade >= 0.999) return [resultados[0]];
  return resultados.slice(0, 5);
}

async function analisarComGemini(prompt, contexto, perfil = 'gestor') {
  const personas = {
    gestor: `Você é um assistente inteligente do sistema de treinamentos da rede Divino Fogão.
REGRAS OBRIGATÓRIAS:
- Responda SEMPRE com base nos dados reais da planilha fornecidos abaixo.
- NUNCA invente dados, nomes, lojas ou notas que não estejam na lista.
- Se a pergunta for sobre uma pessoa específica, procure pelo nome exato na lista e retorne os dados dela.
- Se a pergunta for sobre uma loja, filtre todos os colaboradores daquela loja.
- Responda em português, de forma clara e objetiva, com dados concretos.
- Para listas, mostre nome, loja, função, datas e nota quando disponível.`,

    franqueado: `Você é o assistente do Franqueado da rede Divino Fogão.
REGRAS OBRIGATÓRIAS:
- Responda SEMPRE com base nos dados reais da planilha fornecidos abaixo.
- NUNCA invente dados.
- Para qualquer pergunta sobre quem compareceu, use a lista real de colaboradores.
- Mostre nome completo, função, data de início e fim, nota de avaliação quando houver.
- Se perguntado sobre uma loja específica, liste TODOS os colaboradores daquela loja que constam nos dados.
- Responda de forma completa sem omitir nenhum colaborador relevante.`,

    colaborador: `Você é o assistente do Colaborador da rede Divino Fogão.
REGRAS OBRIGATÓRIAS:
- Responda SEMPRE com base nos dados reais do colaborador fornecidos abaixo.
- Informe a loja exata onde ele deve ir, função, turno, datas de início e fim.
- Seja acolhedor e claro.
- Não divulgue dados de outros colaboradores.`,
  };

  const systemPrompt = personas[perfil] || personas.gestor;

  const listaColaboradores = CACHE.map((c, i) =>
    `${i + 1}. Nome: ${c.nome} | Loja: ${c.loja} | Função: ${c.funcao} | Turno: ${c.turno} | Início: ${c.inicioTrein} | Fim: ${c.fimTrein} | Email: ${c.email} | Tel: ${c.telefone} | Nota: ${c.avaliacao || 'sem nota'} | Avaliado: ${c.avaliadoOk ? 'Sim' : 'Não'}`
  ).join('\n');

  const dadosPlanilha = perfil === 'colaborador' && contexto.colaborador
    ? `DADOS DO COLABORADOR:\n${JSON.stringify(contexto.colaborador, null, 2)}`
    : `PLANILHA COMPLETA (${CACHE.length} colaboradores):\n${listaColaboradores}`;

  const dadosExtra = contexto.dashboard
    ? `\nRESUMO GERAL: Total ${contexto.dashboard.total} | Com lembrete ${contexto.dashboard.comLembrete} | Avaliados ${contexto.dashboard.comAvaliacao || 0}`
    : '';

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `${systemPrompt}

${dadosPlanilha}${dadosExtra}

PERGUNTA: ${prompt}`,
  });

  return response.text;
}

module.exports = {
  carregarCache,
  buscarPorNome,
  analisarComGemini,
  cacheStatus:       () => _cacheStatus,
  cacheTotal:        () => CACHE.length,
  ultimaAtualizacao: () => _ultimaAtualizacao,
  ultimoLog:         () => _ultimoLog,
  getCache:          () => CACHE,
};