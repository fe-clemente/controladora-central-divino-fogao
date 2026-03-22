// modulos/juridico/services/drive.js
'use strict';

const { google } = require('googleapis');
const path = require('path');

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

// ⚠️  Defina JURIDICO_UPLOADS_PASTA_ID no .env com o ID da pasta do Drive do Jurídico
const PASTA_RAIZ_ID = process.env.UPLOADS_PASTA_ID_JURIDICO || '';

const SD = {
  supportsAllDrives:         true,
  includeItemsFromAllDrives: true,
};

async function listarPastas(pastaId = PASTA_RAIZ_ID) {
  if (!pastaId) throw new Error('JURIDICO__PASTA_ID não configurado no .env');
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

async function criarPasta(nome, pastaId = PASTA_RAIZ_ID) {
  if (!pastaId) throw new Error('JURIDICO_UPLOADS_PASTA_ID não configurado no .env');
  const drive = getDrive();
  const { data } = await drive.files.create({
    requestBody: { name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [pastaId] },
    fields: 'id, name',
    ...SD,
  });
  return { id: data.id, nome: data.name };
}

async function uploadArquivo({ nomeArquivo, mimeType, buffer, pastaId }) {
  if (!PASTA_RAIZ_ID) throw new Error('JURIDICO_UPLOADS_PASTA_ID não configurado no .env');
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

async function listarArquivos(pastaId = PASTA_RAIZ_ID) {
  if (!pastaId) throw new Error('JURIDICO_UPLOADS_PASTA_ID não configurado no .env');
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

async function deletarArquivo(fileId) {
  const drive = getDrive();
  await drive.files.delete({ fileId, ...SD });
  return { ok: true };
}

module.exports = { listarPastas, criarPasta, uploadArquivo, listarArquivos, deletarArquivo, PASTA_RAIZ_ID };