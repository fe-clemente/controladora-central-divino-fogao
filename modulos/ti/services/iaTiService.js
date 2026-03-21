'use strict';

require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

if (!GEMINI_API_KEY) {
    console.warn('⚠️ GEMINI_API_KEY não configurada no .env');
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function perguntarTI({ pergunta, contexto = '', usuario = '' }) {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY não configurada');
    }

    const prompt = `
Você é a IA da Central TI do Divino Fogão.

REGRAS:
- Responda sempre em português do Brasil.
- Seja objetivo, técnico e útil.
- Use prioritariamente os dados recebidos no CONTEXTO.
- Se faltar dado, diga claramente que a informação não está disponível no contexto atual.
- Não invente números, lojas, status ou responsáveis.
- Quando fizer sentido, organize a resposta em tópicos curtos.

USUÁRIO LOGADO:
${usuario || 'Não informado'}

CONTEXTO DO SISTEMA:
${contexto || 'Sem contexto adicional.'}

PERGUNTA:
${pergunta}
`.trim();

    const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt
    });

    return response.text || 'Sem resposta.';
}

module.exports = { perguntarTI };