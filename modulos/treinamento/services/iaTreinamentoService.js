'use strict';

require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

if (!GEMINI_API_KEY) {
    console.warn('⚠️ GEMINI_API_KEY não configurada no .env');
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function perguntarTreinamento({ pergunta, contexto = '', usuario = '' }) {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY não configurada');
    }

    const prompt = `
Você é a IA da Central de Treinamento do Divino Fogão.

REGRAS:
- Responda sempre em português do Brasil.
- Seja objetivo, claro e útil.
- Use prioritariamente os dados recebidos no CONTEXTO.
- Se faltar dado, diga claramente que a informação não está disponível no contexto atual.
- Não invente números, lojas, status, notas ou colaboradores.
- Quando fizer sentido, organize a resposta em tópicos curtos.

ÁREAS QUE VOCÊ CONHECE:
- Dashboard de treinamentos: lojas treinadas por mês, perfil de desenvolvimento, dados cadastrais.
- Avaliações: notas, aprovações, lembretes enviados, status por colaborador.
- Cadastro de funcionários: dados pessoais, loja, função, turno, período de treinamento.
- SULTS: unidades, total de funcionários, status de implantação.
- Turnover: percentual, desligamentos, motivos, comparativo por loja.
- Chamados de Treinamento (TD): abertos, fechados, totais.
- Universidade Corporativa: linhas de conteúdo, status.
- Valores: treinamentos pagos/pendentes, prêmio refeição por mês.
- Uploads: arquivos e pastas no Google Drive do módulo.

USUÁRIO LOGADO:
${usuario || 'Não informado'}

CONTEXTO DO SISTEMA:
${contexto || 'Sem contexto adicional.'}

PERGUNTA:
${pergunta}
`.trim();

    const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
    });

    return response.text || 'Sem resposta.';
}

module.exports = { perguntarTreinamento };