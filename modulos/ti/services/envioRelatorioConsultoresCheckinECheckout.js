'use strict';

// ═══════════════════════════════════════════════════════════════
//  envioRelatorioConsultoresCheckinECheckout.js
//
//  FLUXO CORRETO:
//  1. Sincroniza API SULTS UMA SÓ VEZ (cache compartilhado)
//  2. Filtra dados para Grupo A (Qualidade) → envia e-mail A
//  3. Filtra dados para Grupo B (Campo)     → envia e-mail B
//
//  GRUPO A — Qualidade & Gastronomia
//    Destino : luciano.aquino | fernando.clemente | bruno.souza
//
//  GRUPO B — Campo & Delivery
//    Destino : anderson.silva | fernando.clemente | bruno.souza
//
//  Agendamento : Todo dia 06 às 06:00 BRT
//  Distância   : > 1.000 m
// ═══════════════════════════════════════════════════════════════

const path       = require('path');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const checkoutCache = require('./relatoriocheckoutCache');

// ─── Configurações ────────────────────────────────────────────
const DISTANCIA_MINIMA_METROS = 1000;
const SPREADSHEET_ID = '1yYmceSQhnEESyfI8DjgnLLeags5THHHONeZMNyrXLuI';
const EMAIL_FROM     = 'fernando.clemente@divinofogao.com.br';

const GRUPOS = {
    qualidade: {
        id:    'qualidade',
        nome:  'Qualidade & Gastronomia',
        emoji: '🧪',
        modelosIncluidos: [
            'qualidade e segurança dos alimentos',
            'qualidade e segurança',
            'gastronomia - consultoria presencial',
            'gastronomia',
        ],
        destinatarios: [
            'luciano.aquino@divinofogao.com.br',
            'fernando.clemente@divinofogao.com.br',
            'bruno.souza@divinofogao.com.br',
        ],
    },
    campo: {
        id:    'campo',
        nome:  'Campo & Delivery',
        emoji: '🚗',
        modelosIncluidos: [
            'consultoria em delivery',
            'consultoria de campo - visita não avaliativa',
            'consultoria de campo - pré inauguração',
            'consultoria de campo - pré inauguracao',
            'consultoria de campo - reabertura',
            'consultoria de campo',
        ],
        destinatarios: [
            'anderson.silva@divinofogao.com.br',
            'fernando.clemente@divinofogao.com.br',
            'bruno.souza@divinofogao.com.br',
        ],
    },
};

// ─── Estado global (1 estado só — não por grupo) ─────────────
// Isso evita conflito: só uma execução por vez, compartilhada
let _estado = {
    executando:   false,
    fase:         'idle',   // idle | sincronizando | filtrando | enviando | concluido | erro
    etapa:        'Aguardando...',
    sincAtual:    0,
    sincTotal:    0,
    grupos: {
        qualidade: { status: 'idle', filtrados: 0, emailId: null, erro: null, ultimoEnvio: null },
        campo:     { status: 'idle', filtrados: 0, emailId: null, erro: null, ultimoEnvio: null },
    },
    ultimoErro:   null,
    ultimoCronDia: null,
};

let _cronHandle = null;

function _log(msg) { console.log(`[ENVIO] ${msg}`); }

function _setFase(fase, etapa) {
    _estado.fase  = fase;
    _estado.etapa = etapa || fase;
    _log(etapa || fase);
}

// ─── Auth / Transporter ───────────────────────────────────────
function getSheetAuth() {
    const keyFile = process.env.GOOGLE_KEY_FILE || './minha-chave.json';
    const keyPath = path.isAbsolute(keyFile) ? keyFile : path.join(process.cwd(), keyFile);
    return new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
    });
}

function _criarTransporter() {
    return nodemailer.createTransport({
        host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
        port:   parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER_TI || process.env.SMTP_USER || EMAIL_FROM,
            pass: process.env.SMTP_PASS_TI || process.env.SMTP_PASS || '',
        },
        tls: { rejectUnauthorized: false },
    });
}

// ─── Helpers ─────────────────────────────────────────────────
function _pad(n) { return String(n).padStart(2, '0'); }

function _nomeAba(grupoId, dt) {
    return `email_${grupoId}_${dt.getFullYear()}-${_pad(dt.getMonth()+1)}-${_pad(dt.getDate())}_${_pad(dt.getHours())}${_pad(dt.getMinutes())}`;
}

function _formatarDistancia(metros) {
    if (metros == null) return '—';
    if (metros >= 1000) return `${(metros / 1000).toFixed(2).replace('.', ',')} km`;
    return `${metros.toLocaleString('pt-BR')} m`;
}

function _esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Filtrar registros de um grupo ────────────────────────────
function _filtrarGrupo(avaliacoes, grupo, distMinima) {
    const limite = distMinima != null ? distMinima : DISTANCIA_MINIMA_METROS;
    return (avaliacoes || []).filter(r => {
        if (!r.modelo) return false;
        const m = r.modelo.toLowerCase();
        if (!grupo.modelosIncluidos.some(inc => m.includes(inc.toLowerCase()))) return false;
        if (r.distancia == null || r.distancia <= limite) return false;
        return true;
    }).sort((a, b) => (b.distancia || 0) - (a.distancia || 0));
}

// ─── HTML do e-mail ───────────────────────────────────────────
function _montarHtml(registros, grupo, dataRef, totalSincronizado) {
    const hoje          = dataRef || new Date();
    const dataFormatada = hoje.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
    const horaFormatada = hoje.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });

    const linhas = registros.map(r => {
        const dist = r.distancia >= 1000
            ? `<strong style="color:#c8102e;">${(r.distancia/1000).toFixed(2).replace('.',',')} km</strong>`
            : `${r.distancia.toLocaleString('pt-BR')} m`;
        const bg = r.distancia >= 5000 ? '#fff0f2' : '#ffffff';
        return `<tr style="background:${bg};">
          <td style="padding:10px 14px;border-bottom:1px solid #e8e2d9;font-family:'Courier New',monospace;font-size:13px;color:#8a7f74;">${r.id}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e8e2d9;font-size:13px;font-weight:600;">${_esc(r.unidade||'—')}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e8e2d9;font-size:13px;">${_esc(r.consultor||'—')}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e8e2d9;font-size:11px;color:#8a7f74;">${_esc(r.modelo||'—')}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e8e2d9;font-size:13px;text-align:right;">${dist}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e8e2d9;font-size:11px;color:#8a7f74;font-family:'Courier New',monospace;">${_esc(r.data||'—')}</td>
        </tr>`;
    }).join('');

    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório Check-in/Check-out — ${_esc(grupo.nome)}</title></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:32px 16px;">
<tr><td align="center">
<table width="700" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);">
  <tr><td style="background:linear-gradient(135deg,#c8102e,#a50d25);padding:28px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><div style="font-size:22px;font-weight:900;color:#fff;">🍽️ Divino Fogão — T.I.</div>
          <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:4px;font-weight:600;">Relatório Automático · ${grupo.emoji} ${_esc(grupo.nome)}</div></td>
      <td align="right"><div style="background:rgba(255,255,255,.15);border-radius:10px;padding:8px 14px;display:inline-block;text-align:center;">
        <div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:1px;font-weight:800;">Gerado em</div>
        <div style="font-size:12px;color:#fff;font-weight:700;margin-top:2px;">${dataFormatada} · ${horaFormatada}</div>
      </div></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:24px 32px 0;">
    <h2 style="margin:0;font-size:18px;font-weight:900;color:#1e1a16;">📋 Check-in / Check-out fora do local</h2>
    <p style="margin:8px 0 0;font-size:13px;color:#8a7f74;line-height:1.6;">
      Registros dos últimos <strong>30 dias</strong> onde a distância entre check-in e check-out
      é <strong>superior a 1.000 metros</strong>.<br>
      Modelos de consultoria online e buffet noturno foram excluídos desta análise.
    </p>
  </td></tr>
  <tr><td style="padding:20px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="32%" style="text-align:center;background:#fff0f2;border-radius:12px;padding:14px 8px;">
        <div style="font-size:28px;font-weight:900;color:#c8102e;font-family:'Courier New',monospace;">${registros.length}</div>
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;margin-top:4px;">Divergências &gt;1km</div>
      </td><td width="4px"></td>
      <td width="32%" style="text-align:center;background:#f0f9ff;border-radius:12px;padding:14px 8px;">
        <div style="font-size:28px;font-weight:900;color:#0369a1;font-family:'Courier New',monospace;">${totalSincronizado}</div>
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;margin-top:4px;">Total Sincronizado</div>
      </td><td width="4px"></td>
      <td width="32%" style="text-align:center;background:#fef9c3;border-radius:12px;padding:14px 8px;">
        <div style="font-size:28px;font-weight:900;color:#d97706;font-family:'Courier New',monospace;">${totalSincronizado > 0 ? ((registros.length/totalSincronizado)*100).toFixed(1) : '0.0'}%</div>
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;margin-top:4px;">Taxa Divergência</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:0 32px 24px;">
    ${registros.length === 0
      ? `<div style="text-align:center;padding:40px 20px;color:#8a7f74;font-size:14px;">✅ Nenhuma divergência encontrada neste grupo.</div>`
      : `<table width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #e8e2d9;border-radius:12px;overflow:hidden;">
          <thead><tr style="background:#faf8f5;">
            <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;border-bottom:2px solid #e8e2d9;">ID</th>
            <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;border-bottom:2px solid #e8e2d9;">Loja</th>
            <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;border-bottom:2px solid #e8e2d9;">Consultor</th>
            <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;border-bottom:2px solid #e8e2d9;">Modelo</th>
            <th style="padding:10px 14px;text-align:right;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;border-bottom:2px solid #e8e2d9;">Distância</th>
            <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;border-bottom:2px solid #e8e2d9;">Data</th>
          </tr></thead>
          <tbody>${linhas}</tbody>
         </table>`}
  </td></tr>
  <tr><td style="background:#faf8f5;padding:18px 32px;border-top:1px solid #e8e2d9;">
    <p style="margin:0;font-size:11px;color:#8a7f74;line-height:1.6;">
      📧 Enviado automaticamente todo dia <strong>06 de cada mês às 06:00</strong>.<br>
      🔍 Registros com distância <strong>&gt; 1.000 m</strong> entre check-in e check-out.<br>
      🚫 Modelos excluídos: Consultoria Online, Buffet Noite e variantes.<br>
      📋 Grupo: <strong>${_esc(grupo.nome)}</strong>
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ─── Gravar aba Sheets ────────────────────────────────────────
async function _gravarAba(registros, nomeAba, grupo, dataRef) {
    try {
        const auth   = getSheetAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { requests: [{ addSheet: { properties: { title: nomeAba } } }] },
        });
        const cab  = ['ID','Loja/Unidade','Consultor','Modelo','Data','Distância (m)','Distância Formatada','Grupo','Gerado Em'];
        const agora = dataRef ? dataRef.toISOString() : new Date().toISOString();
        const rows  = registros.map(r => [r.id, r.unidade||'', r.consultor||'', r.modelo||'', r.data||'',
            r.distancia != null ? r.distancia : '', _formatarDistancia(r.distancia), grupo.nome, agora]);
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${nomeAba}'!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: [cab, ...rows] },
        });
        _log(`✅ Aba "${nomeAba}" gravada — ${registros.length} registros`);
        return { ok: true };
    } catch (e) {
        _log(`❌ Sheets erro: ${e.message}`);
        return { ok: false, erro: e.message };
    }
}

// ─── EXECUÇÃO PRINCIPAL — Sync única + 2 e-mails ─────────────
async function executarEnvio(opcoes) {
    opcoes = opcoes || {};

    if (_estado.executando) {
        // Reset automático se travado
        console.warn('[ENVIO] ⚠️ Estado travado — resetando.');
        _estado.executando = false;
    }

    _estado.executando = true;
    _estado.fase       = 'iniciando';
    _estado.etapa      = 'Inicializando...';
    _estado.sincAtual  = 0;
    _estado.sincTotal  = 0;
    _estado.ultimoErro = null;
    _estado.grupos     = {
        qualidade: { status: 'aguardando', filtrados: 0, emailId: null, erro: null, ultimoEnvio: _estado.grupos.qualidade.ultimoEnvio },
        campo:     { status: 'aguardando', filtrados: 0, emailId: null, erro: null, ultimoEnvio: _estado.grupos.campo.ultimoEnvio },
    };

    const agora      = opcoes.dataRef        || new Date();
    const distMinima = opcoes.distanciaMinima != null ? opcoes.distanciaMinima : DISTANCIA_MINIMA_METROS;

    // Destinatários: por grupo ou override de teste
    const emailQ = opcoes.emailsQualidade || GRUPOS.qualidade.destinatarios;
    const emailC = opcoes.emailsCampo     || GRUPOS.campo.destinatarios;

    // Timeout 90min
    const _tmout = setTimeout(() => {
        if (_estado.executando) {
            _estado.executando = false;
            _setFase('erro', 'Timeout de segurança (90min)');
        }
    }, 90 * 60 * 1000);

    try {
        // ── ETAPA 1: Sincronizar (UMA VEZ SÓ) ──────────────────
        _setFase('sincronizando', '🔄 Sincronizando API SULTS (30 dias)...');

        const dtEnd   = new Date(agora);
        const dtStart = new Date(agora);
        dtStart.setDate(dtEnd.getDate() - 30);

        const dados = await checkoutCache.sincronizarEAtualizar('auto', {
            dtStart: dtStart.toISOString().split('.')[0] + 'Z',
            dtEnd:   dtEnd.toISOString().split('.')[0]   + 'Z',
        });

        const avaliacoes        = dados.avaliacoes || [];
        const totalSincronizado = avaliacoes.length;
        _estado.sincAtual       = totalSincronizado;
        _estado.sincTotal       = totalSincronizado;
        _setFase('sincronizando', `✅ ${totalSincronizado} registros sincronizados`);

        // ── ETAPA 2: Filtrar Grupo A (Qualidade) ────────────────
        _setFase('filtrando', '🔍 Filtrando Qualidade & Gastronomia...');
        const filtQ = _filtrarGrupo(avaliacoes, GRUPOS.qualidade, distMinima);
        _estado.grupos.qualidade.filtrados = filtQ.length;
        _log(`🧪 Qualidade: ${filtQ.length} divergências encontradas`);

        // ── ETAPA 3: Filtrar Grupo B (Campo) ────────────────────
        _setFase('filtrando', '🔍 Filtrando Campo & Delivery...');
        const filtC = _filtrarGrupo(avaliacoes, GRUPOS.campo, distMinima);
        _estado.grupos.campo.filtrados = filtC.length;
        _log(`🚗 Campo: ${filtC.length} divergências encontradas`);

        // ── ETAPA 4: Gravar Sheets (Qualidade) ──────────────────
        _setFase('gravando', '📊 Gravando aba Qualidade na planilha...');
        _estado.grupos.qualidade.status = 'gravando';
        const nomeAbaQ = _nomeAba('qualidade', agora);
        await _gravarAba(filtQ, nomeAbaQ, GRUPOS.qualidade, agora);

        // ── ETAPA 5: Gravar Sheets (Campo) ──────────────────────
        _setFase('gravando', '📊 Gravando aba Campo na planilha...');
        _estado.grupos.campo.status = 'gravando';
        const nomeAbaC = _nomeAba('campo', agora);
        await _gravarAba(filtC, nomeAbaC, GRUPOS.campo, agora);

        // ── ETAPA 6: Enviar e-mail Qualidade ────────────────────
        _setFase('enviando', `📧 Enviando e-mail Qualidade para ${emailQ.length} destinatário(s)...`);
        _estado.grupos.qualidade.status = 'enviando';
        const transporter = _criarTransporter();

        try {
            const infoQ = await transporter.sendMail({
                from:    `"Divino Fogão — T.I." <${EMAIL_FROM}>`,
                to:      emailQ.join(', '),
                subject: `🧪 Relatório Qualidade & Gastronomia — ${agora.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})} | ${filtQ.length} divergências >1km`,
                html:    _montarHtml(filtQ, GRUPOS.qualidade, agora, totalSincronizado),
            });
            _estado.grupos.qualidade.status    = 'ok';
            _estado.grupos.qualidade.emailId   = infoQ.messageId;
            _estado.grupos.qualidade.ultimoEnvio = agora.toISOString();
            _log(`✅ E-mail Qualidade enviado: ${infoQ.messageId}`);
        } catch (e) {
            _estado.grupos.qualidade.status = 'erro';
            _estado.grupos.qualidade.erro   = e.message;
            _log(`❌ Erro e-mail Qualidade: ${e.message}`);
        }

        // ── ETAPA 7: Enviar e-mail Campo ─────────────────────────
        _setFase('enviando', `📧 Enviando e-mail Campo para ${emailC.length} destinatário(s)...`);
        _estado.grupos.campo.status = 'enviando';

        try {
            const infoC = await transporter.sendMail({
                from:    `"Divino Fogão — T.I." <${EMAIL_FROM}>`,
                to:      emailC.join(', '),
                subject: `🚗 Relatório Campo & Delivery — ${agora.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})} | ${filtC.length} divergências >1km`,
                html:    _montarHtml(filtC, GRUPOS.campo, agora, totalSincronizado),
            });
            _estado.grupos.campo.status    = 'ok';
            _estado.grupos.campo.emailId   = infoC.messageId;
            _estado.grupos.campo.ultimoEnvio = agora.toISOString();
            _log(`✅ E-mail Campo enviado: ${infoC.messageId}`);
        } catch (e) {
            _estado.grupos.campo.status = 'erro';
            _estado.grupos.campo.erro   = e.message;
            _log(`❌ Erro e-mail Campo: ${e.message}`);
        }

        _setFase('concluido', `✅ Concluído — Q:${filtQ.length} C:${filtC.length} divergências`);

        return {
            ok:               true,
            totalSincronizado,
            qualidade:        { filtrados: filtQ.length, nomeAba: nomeAbaQ, emailId: _estado.grupos.qualidade.emailId },
            campo:            { filtrados: filtC.length, nomeAba: nomeAbaC, emailId: _estado.grupos.campo.emailId },
        };

    } catch (e) {
        _log(`❌ Erro geral: ${e.message}`);
        _estado.ultimoErro = e.message;
        _setFase('erro', '❌ ' + e.message);
        throw e;
    } finally {
        clearTimeout(_tmout);
        _estado.executando = false;
    }
}

// ─── Agendador ────────────────────────────────────────────────
function _verificarCron() {
    const agora = new Date();
    const brt   = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
    if (brt.getUTCDate() !== 6 || brt.getUTCHours() !== 6 || brt.getUTCMinutes() > 4) return;
    const chave = `${brt.getUTCFullYear()}-${brt.getUTCMonth()}-6`;
    if (_estado.ultimoCronDia === chave) return;
    _estado.ultimoCronDia = chave;
    _log('⏰ Cron dia 06 06:00 BRT — disparando');
    executarEnvio().catch(e => _log(`❌ Cron erro: ${e.message}`));
}

function iniciarAgendador() {
    if (_cronHandle) return;
    _cronHandle = setInterval(_verificarCron, 5 * 60 * 1000);
    _log('✅ Agendador iniciado. Executa todo dia 06 às 06:00 BRT.');
}

function pararAgendador() {
    if (_cronHandle) { clearInterval(_cronHandle); _cronHandle = null; }
}

// ─── Status (endpoint único — sem /status/:grupoId) ──────────
function getStatus() {
    return {
        executando:    _estado.executando,
        fase:          _estado.fase,
        etapa:         _estado.etapa,
        sincAtual:     _estado.sincAtual,
        sincTotal:     _estado.sincTotal,
        ultimoErro:    _estado.ultimoErro,
        agendadorAtivo: !!_cronHandle,
        grupos:        _estado.grupos,
    };
}

// ─── Preview ─────────────────────────────────────────────────
function _gerarHtmlPreview(grupoId, registros, totalSincronizado, ficticio) {
    const grupo = GRUPOS[grupoId] || GRUPOS.qualidade;
    const aviso = ficticio
        ? `<div style="background:#fef9c3;border:1.5px solid #d97706;border-radius:8px;padding:10px 16px;margin:0 32px 8px;font-size:12px;color:#92400e;font-weight:700;">⚠️ Dados fictícios — sincronize primeiro.</div>`
        : '';
    return aviso + _montarHtml(registros, grupo, new Date(), totalSincronizado);
}

// ─── Exports ─────────────────────────────────────────────────
module.exports = {
    iniciarAgendador,
    pararAgendador,
    executarEnvio,
    getStatus,
    _gerarHtmlPreview,
    GRUPOS,
    DISTANCIA_MINIMA_METROS,
};