// modulos/treinamento/services/drive.js
'use strict';

const { google } = require('googleapis');
const path = require('path');

// ─── Auth ─────────────────────────────────────────────────────────────────────
function getAuth() {
  const keyFile = process.env.GOOGLE_KEY_FILE || './minha-chave.json';
  const keyPath = path.isAbsolute(keyFile) ? keyFile : path.join(process.cwd(), keyFile);
  return new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

function getDrive() {
  return google.drive({ version: 'v3', auth: getAuth() });
}

// ─── Pasta raiz ───────────────────────────────────────────────────────────────
// ⚠️  Após mover a pasta para o Shared Drive, atualize UPLOADS_PASTA_ID no .env
//     ou substitua o ID abaixo diretamente
const PASTA_RAIZ_ID = process.env.UPLOADS_PASTA_ID_TREINAMENTO || '';

// Parâmetros obrigatórios para Shared Drive
const SD = {
  supportsAllDrives:         true,
  includeItemsFromAllDrives: true,
};

// ─── Listar subpastas ─────────────────────────────────────────────────────────
async function listarPastas(pastaId = PASTA_RAIZ_ID) {
  const drive = getDrive();
  const { data } = await drive.files.list({
    q:        `'${pastaId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields:   'files(id, name, createdTime, modifiedTime)',
    orderBy:  'name',
    pageSize: 100,
    ...SD,
  });
  return (data.files || []).map(f => ({
    id: f.id, nome: f.name,
    criadoEm: f.createdTime, modificadoEm: f.modifiedTime,
  }));
}

// ─── Criar pasta ──────────────────────────────────────────────────────────────
async function criarPasta(nome, pastaId = PASTA_RAIZ_ID) {
  const drive = getDrive();
  const { data } = await drive.files.create({
    requestBody: {
      name: nome,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [pastaId],
    },
    fields: 'id, name',
    ...SD,
  });
  return { id: data.id, nome: data.name };
}

// ─── Upload de arquivo ────────────────────────────────────────────────────────
async function uploadArquivo({ nomeArquivo, mimeType, buffer, pastaId }) {
  const drive   = getDrive();
  const destino = pastaId || PASTA_RAIZ_ID;
  const { Readable } = require('stream');

  const { data } = await drive.files.create({
    requestBody: { name: nomeArquivo, parents: [destino] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, name, size, mimeType, webViewLink, createdTime',
    ...SD,
  });

  return {
    id: data.id, nome: data.name, tamanho: data.size,
    tipo: data.mimeType, link: data.webViewLink, criadoEm: data.createdTime,
  };
}

// ─── Listar arquivos ──────────────────────────────────────────────────────────
async function listarArquivos(pastaId = PASTA_RAIZ_ID) {
  const drive = getDrive();
  const { data } = await drive.files.list({
    q:        `'${pastaId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
    fields:   'files(id, name, size, mimeType, webViewLink, createdTime, modifiedTime)',
    orderBy:  'createdTime desc',
    pageSize: 100,
    ...SD,
  });
  return (data.files || []).map(f => ({
    id: f.id, nome: f.name, tamanho: f.size,
    tipo: f.mimeType, link: f.webViewLink,
    criadoEm: f.createdTime, modificadoEm: f.modifiedTime,
  }));
}

// ─── Deletar arquivo ──────────────────────────────────────────────────────────
async function deletarArquivo(fileId) {
  const drive = getDrive();
  await drive.files.delete({ fileId, ...SD });
  return { ok: true };
}

module.exports = { listarPastas, criarPasta, uploadArquivo, listarArquivos, deletarArquivo, PASTA_RAIZ_ID };