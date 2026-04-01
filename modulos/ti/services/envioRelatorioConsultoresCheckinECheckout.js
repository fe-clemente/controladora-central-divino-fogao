'use strict';

// ═══════════════════════════════════════════════════════════════
//  envioRelatorioConsultoresCheckinECheckout.js
//  Agendamento: Todo dia 06 de cada mês, às 06:00 BRT
//  — Sincroniza últimos 30 dias da API SULTS
//  — Filtra registros com distância > 1000 m
//  — Exclui modelos de consultoria online / buffet etc.
//  — Envia e-mail HTML (ID | Loja | Consultor | Distância)
//  — Grava resultado em nova aba na planilha Google Sheets
// ═══════════════════════════════════════════════════════════════

const path       = require('path');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

// ─── Referência ao cache já existente ────────────────────────
const checkoutCache = require('./relatoriocheckoutCache');

// ─── Configurações ───────────────────────────────────────────
const DISTANCIA_MINIMA_METROS = 1000;
const SPREADSHEET_ID = '1yYmceSQhnEESyfI8DjgnLLeags5THHHONeZMNyrXLuI';

// Modelos ignorados (parcial, case-insensitive)
const MODELOS_IGNORADOS = [
    'consultoria online',
    'buffet noite',
    'consultoria online – q&s',
    'consultoria online - q&s',
    'q&s dos alimentos',
    'q&s alimentos',
];

// Destinatários automáticos reais
const EMAILS_DESTINO = [
    'bruno.souza@divinofogao.com.br',
    'anderson.silva@divinofogao.com.br',
    'marcos.bonadias@divinofogao.com.br',
    'fernando.clemente@divinofogao.com.br',
];

// Remetente
const EMAIL_FROM = 'fernando.clemente@divinofogao.com.br';

// ─── Estado ──────────────────────────────────────────────────
let _ultimoEnvio  = null;
let _ultimoStatus = null;   // 'ok' | 'erro' | null
let _ultimoErro   = null;
let _executando   = false;
let _cronHandle   = null;

// Progresso próprio do envio
let _progresso = {
    etapa:  'idle',
    fase:   'idle',   // idle | sincronizando | filtrando | gravando | enviando | concluido | erro
    atual:  0,
    total:  0,
    detalhe: '',
};

function _setProgresso(fase, etapa, atual, total, detalhe) {
    _progresso = { fase, etapa: etapa || fase, atual: atual || 0, total: total || 0, detalhe: detalhe || '' };
}

// ─── Sheets Auth ─────────────────────────────────────────────
function getSheetAuth() {
    const keyFile = process.env.GOOGLE_KEY_FILE || './minha-chave.json';
    const keyPath = path.isAbsolute(keyFile) ? keyFile : path.join(process.cwd(), keyFile);
    return new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ],
    });
}

// ─── Nodemailer Transporter ──────────────────────────────────
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
function _modeloIgnorado(modelo) {
    if (!modelo) return false;
    const m = modelo.toLowerCase();
    return MODELOS_IGNORADOS.some(ig => m.includes(ig.toLowerCase()));
}

function _pad(n) { return String(n).padStart(2, '0'); }

function _nomeAba(dt) {
    return `email_${dt.getFullYear()}-${_pad(dt.getMonth()+1)}-${_pad(dt.getDate())}_${_pad(dt.getHours())}${_pad(dt.getMinutes())}`;
}

function _formatarDistancia(metros) {
    if (metros == null) return '—';
    if (metros >= 1000) return `${(metros / 1000).toFixed(2).replace('.', ',')} km`;
    return `${metros.toLocaleString('pt-BR')} m`;
}

function _esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── Filtrar registros ───────────────────────────────────────
function _filtrarRegistros(avaliacoes, distMinima) {
    const limite = distMinima != null ? distMinima : DISTANCIA_MINIMA_METROS;
    return (avaliacoes || []).filter(r => {
        if (_modeloIgnorado(r.modelo)) return false;
        if (r.distancia == null) return false;
        if (r.distancia <= limite) return false;
        return true;
    }).sort((a, b) => (b.distancia || 0) - (a.distancia || 0));
}

// ─── Montar HTML do e-mail ───────────────────────────────────
function _montarEmailHtml(registros, dataRef, totalSincronizado) {
    const hoje = dataRef || new Date();
    const dataFormatada = hoje.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
    const horaFormatada = hoje.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });

    const linhas = registros.map(r => {
        const distKm = r.distancia >= 1000
            ? `<strong style="color:#c8102e;">${(r.distancia/1000).toFixed(2).replace('.',',')} km</strong>`
            : `${r.distancia.toLocaleString('pt-BR')} m`;
        const corLinha = r.distancia >= 5000 ? '#fff0f2' : '#ffffff';
        return `
        <tr style="background:${corLinha};">
            <td style="padding:10px 14px;border-bottom:1px solid #e8e2d9;font-family:'Courier New',monospace;font-size:13px;color:#8a7f74;">${r.id}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e8e2d9;font-size:13px;font-weight:600;color:#1e1a16;">${_esc(r.unidade || '—')}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1e1a16;">${_esc(r.consultor || '—')}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e8e2d9;font-size:13px;text-align:right;">${distKm}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e8e2d9;font-size:11px;color:#8a7f74;font-family:'Courier New',monospace;">${_esc(r.data || '—')}</td>
        </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Relatório Check-in/Check-out — Consultores</title></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Nunito',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:32px 16px;">
<tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
  <tr>
    <td style="background:linear-gradient(135deg,#c8102e,#a50d25);padding:28px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:22px;font-weight:900;color:#ffffff;">🍽️ Divino Fogão</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;font-weight:600;">Central de T.I. — Relatório Automático</div>
          </td>
          <td align="right">
            <div style="background:rgba(255,255,255,0.15);border-radius:10px;padding:8px 14px;display:inline-block;">
              <div style="font-size:10px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:1px;font-weight:800;">Gerado em</div>
              <div style="font-size:12px;color:#fff;font-weight:700;margin-top:2px;">${dataFormatada}</div>
              <div style="font-size:12px;color:#fff;font-weight:700;">${horaFormatada}</div>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <!-- Título e descrição -->
  <tr>
    <td style="padding:24px 32px 0;">
      <h2 style="margin:0;font-size:18px;font-weight:900;color:#1e1a16;">📋 Check-in / Check-out fora do local</h2>
      <p style="margin:8px 0 0;font-size:13px;color:#8a7f74;line-height:1.6;">
        Registros dos últimos <strong>30 dias</strong> onde a distância entre check-in e check-out
        é <strong>superior a 1.000 metros</strong>.<br>
        Modelos de consultoria online e buffet noturno foram excluídos desta análise.
      </p>
    </td>
  </tr>
  <!-- KPIs -->
  <tr>
    <td style="padding:20px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="33%" style="text-align:center;background:#fff0f2;border-radius:12px;padding:14px 8px;">
            <div style="font-size:28px;font-weight:900;color:#c8102e;font-family:'Courier New',monospace;">${registros.length}</div>
            <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;margin-top:4px;">Registros &gt;1km</div>
          </td>
          <td width="4px"></td>
          <td width="33%" style="text-align:center;background:#f0f9ff;border-radius:12px;padding:14px 8px;">
            <div style="font-size:28px;font-weight:900;color:#0369a1;font-family:'Courier New',monospace;">${totalSincronizado}</div>
            <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;margin-top:4px;">Total Sincronizado</div>
          </td>
          <td width="4px"></td>
          <td width="33%" style="text-align:center;background:#fef9c3;border-radius:12px;padding:14px 8px;">
            <div style="font-size:28px;font-weight:900;color:#d97706;font-family:'Courier New',monospace;">${totalSincronizado > 0 ? ((registros.length/totalSincronizado)*100).toFixed(1) : '0.0'}%</div>
            <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;margin-top:4px;">Taxa de Divergência</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <!-- Tabela -->
  <tr>
    <td style="padding:0 32px 24px;">
      ${registros.length === 0 ? `
        <div style="text-align:center;padding:40px 20px;color:#8a7f74;font-size:14px;">
          ✅ Nenhum registro com distância superior a 1.000 m encontrado.
        </div>
      ` : `
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #e8e2d9;border-radius:12px;overflow:hidden;">
        <thead>
          <tr style="background:#faf8f5;">
            <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;border-bottom:2px solid #e8e2d9;">ID</th>
            <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;border-bottom:2px solid #e8e2d9;">Loja / Unidade</th>
            <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;border-bottom:2px solid #e8e2d9;">Consultor</th>
            <th style="padding:10px 14px;text-align:right;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;border-bottom:2px solid #e8e2d9;">Distância</th>
            <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#8a7f74;border-bottom:2px solid #e8e2d9;">Data</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      `}
    </td>
  </tr>
  <!-- Rodapé -->
  <tr>
    <td style="background:#faf8f5;padding:20px 32px;border-top:1px solid #e8e2d9;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <p style="margin:0;font-size:11px;color:#8a7f74;line-height:1.6;">
              📧 Este e-mail é gerado automaticamente todo dia <strong>06 de cada mês às 06:00</strong>.<br>
              🔍 Registros com distância <strong>&gt; 1.000 m</strong> entre check-in e check-out.<br>
              🚫 Modelos excluídos: Consultoria Online, Buffet Noite e variantes.
            </p>
          </td>
          <td align="right" style="vertical-align:bottom;">
            <span style="font-size:11px;color:#c0b9b0;font-weight:700;">Divino Fogão — T.I.</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Gravar aba no Sheets ────────────────────────────────────
async function _gravarAbaSheets(registros, nomeAba, dataRef) {
    try {
        const auth   = getSheetAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { requests: [{ addSheet: { properties: { title: nomeAba } } }] },
        });

        const cabecalho = ['ID','Loja / Unidade','Consultor','Modelo','Data','Distância (m)','Distância Formatada','Gerado Em'];
        const agora = dataRef ? dataRef.toISOString() : new Date().toISOString();
        const linhas = registros.map(r => [
            r.id, r.unidade||'', r.consultor||'', r.modelo||'', r.data||'',
            r.distancia != null ? r.distancia : '',
            _formatarDistancia(r.distancia), agora,
        ]);

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${nomeAba}'!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: [cabecalho, ...linhas] },
        });

        // Negrito + freeze
        const info    = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const abaInfo = info.data.sheets.find(s => s.properties.title === nomeAba);
        const sheetId = abaInfo ? abaInfo.properties.sheetId : null;
        if (sheetId !== null) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    requests: [
                        {
                            repeatCell: {
                                range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                                cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red:0.98, green:0.97, blue:0.96 } } },
                                fields: 'userEnteredFormat(textFormat,backgroundColor)',
                            },
                        },
                        {
                            updateSheetProperties: {
                                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                                fields: 'gridProperties.frozenRowCount',
                            },
                        },
                    ],
                },
            });
        }

        console.log(`[ENVIO-RELATORIO] ✅ Aba "${nomeAba}" gravada com ${registros.length} registros.`);
        return { ok: true, aba: nomeAba };
    } catch (e) {
        console.error(`[ENVIO-RELATORIO] ❌ Erro ao gravar Sheets: ${e.message}`);
        return { ok: false, erro: e.message };
    }
}

// ─── Preview HTML (exportada para o endpoint /preview-email) ─
function _gerarHtmlPreview(registros, totalSincronizado, ficticio) {
    const aviso = ficticio
        ? `<div style="background:#fef9c3;border:1.5px solid #d97706;border-radius:8px;padding:10px 16px;margin:0 32px 16px;font-size:12px;color:#92400e;font-weight:700;">
            ⚠️ Preview com dados fictícios — sincronize primeiro para ver dados reais.
           </div>`
        : '';
    const baseHtml = _montarEmailHtml(registros, new Date(), totalSincronizado);
    return baseHtml.replace('<!-- Título e descrição -->', aviso + '<!-- Título e descrição -->');
}

// ─── Rotina Principal ────────────────────────────────────────
async function executarEnvioRelatorio(opcoes) {
    opcoes = opcoes || {};

    // ── Proteção: se _executando por mais de 30 min, reseta automaticamente ──
    if (_executando) {
        // Verifica se há um timeout de segurança em andamento — se não, força reset
        console.warn('[ENVIO-RELATORIO] ⚠️ _executando=true, mas nova solicitação chegou. Forçando reset.');
        _executando = false;
        _setProgresso('idle', 'Resetado por nova solicitação', 0, 0);
    }

    _executando = true;
    _ultimoErro = null;
    _setProgresso('iniciando', 'Inicializando...', 0, 0);

    const agora      = opcoes.dataRef       || new Date();
    const emailTo    = opcoes.emailsDestino || EMAILS_DESTINO;
    const distMinima = opcoes.distanciaMinima != null ? opcoes.distanciaMinima : DISTANCIA_MINIMA_METROS;

    // Timeout de segurança: força _executando=false após 60 minutos
    const _timeout = setTimeout(() => {
        if (_executando) {
            console.warn('[ENVIO-RELATORIO] ⏰ Timeout de segurança — forçando _executando=false');
            _executando = false;
            _setProgresso('erro', 'Timeout de segurança (60min)', 0, 0);
        }
    }, 60 * 60 * 1000);

    console.log(`[ENVIO-RELATORIO] 🚀 Iniciando — ${agora.toLocaleString('pt-BR')}`);

    try {
        // 1. Sincronizar últimos 30 dias
        _setProgresso('sincronizando', '🔄 Sincronizando últimos 30 dias da API SULTS...', 0, 0);
        console.log('[ENVIO-RELATORIO] Sincronizando últimos 30 dias...');

        const dtEnd   = new Date(agora);
        const dtStart = new Date(agora);
        dtStart.setDate(dtEnd.getDate() - 30);

        const MAX_WAIT = 5 * 60 * 1000;
        const INTERVALO = 5000;
        let esperado = 0;
        while (checkoutCache.isSincronizando() && esperado < MAX_WAIT) {
            _setProgresso('sincronizando', '⏳ Aguardando sincronização em andamento...', 0, 0);
            console.log('[ENVIO-RELATORIO] ⏳ Cache ocupado, aguardando... ' + (esperado/1000) + 's');
            await new Promise(r => setTimeout(r, INTERVALO));
            esperado += INTERVALO;
        }

        const dados = await checkoutCache.sincronizarEAtualizar('auto', {
            dtStart: dtStart.toISOString().split('.')[0] + 'Z',
            dtEnd:   dtEnd.toISOString().split('.')[0]   + 'Z',
        });

        const avaliacoes        = dados.avaliacoes || [];
        const totalSincronizado = avaliacoes.length;
        console.log(`[ENVIO-RELATORIO] ${totalSincronizado} registros sincronizados.`);

        _setProgresso('sincronizando', `✅ ${totalSincronizado} registros sincronizados`, totalSincronizado, totalSincronizado);

        // 2. Filtrar
        _setProgresso('filtrando', `🔍 Filtrando divergências > ${distMinima} m...`, totalSincronizado, totalSincronizado);
        const filtrados = _filtrarRegistros(avaliacoes, distMinima);
        console.log(`[ENVIO-RELATORIO] ${filtrados.length} registros filtrados (>${distMinima}m).`);

        _setProgresso('filtrando', `🔍 ${filtrados.length} divergências encontradas`, totalSincronizado, totalSincronizado);

        // 3. Gravar na planilha
        const nomeAba = _nomeAba(agora);
        _setProgresso('gravando', `📊 Gravando aba "${nomeAba}" na planilha...`, totalSincronizado, totalSincronizado);
        const resSheets = await _gravarAbaSheets(filtrados, nomeAba, agora);

        // 4. Enviar e-mail
        _setProgresso('enviando', `📧 Enviando e-mail para ${emailTo.length} destinatário(s)...`, totalSincronizado, totalSincronizado);
        const htmlEmail   = _montarEmailHtml(filtrados, agora, totalSincronizado);
        const transporter = _criarTransporter();
        const mailOptions = {
            from:    `"Divino Fogão — T.I." <${EMAIL_FROM}>`,
            to:      emailTo.join(', '),
            subject: `📋 Relatório Check-in/Check-out — ${agora.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' })} | ${filtrados.length} divergências >1km`,
            html:    htmlEmail,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`[ENVIO-RELATORIO] ✅ E-mail enviado: ${info.messageId}`);

        _ultimoEnvio  = agora.toISOString();
        _ultimoStatus = 'ok';
        _setProgresso('concluido', `✅ Concluído! ${filtrados.length} divergências enviadas.`, totalSincronizado, totalSincronizado);

        return {
            ok:              true,
            totalSincronizado,
            totalFiltrado:   filtrados.length,
            nomeAba,
            sheetsOk:        resSheets.ok,
            emailId:         info.messageId,
            dataEnvio:       agora.toISOString(),
        };

    } catch (e) {
        console.error(`[ENVIO-RELATORIO] ❌ Erro: ${e.message}`);
        _ultimoStatus = 'erro';
        _ultimoErro   = e.message;
        _setProgresso('erro', '❌ ' + e.message, 0, 0);
        throw e;
    } finally {
        clearTimeout(_timeout);
        _executando = false;
    }
}

// ─── Agendador (Cron manual — sem dependência externa) ────────
function _verificarCron() {
    const agora = new Date();
    const brt   = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
    const dia   = brt.getUTCDate();
    const hora  = brt.getUTCHours();
    const min   = brt.getUTCMinutes();

    if (dia !== 6)  return;
    if (hora !== 6) return;
    if (min  > 4)   return;

    if (_ultimoEnvio) {
        const ult    = new Date(_ultimoEnvio);
        const ultBrt = new Date(ult.getTime() - 3 * 60 * 60 * 1000);
        if (
            ultBrt.getUTCFullYear() === brt.getUTCFullYear() &&
            ultBrt.getUTCMonth()    === brt.getUTCMonth()    &&
            ultBrt.getUTCDate()     === brt.getUTCDate()
        ) return;
    }

    console.log('[ENVIO-RELATORIO] ⏰ Disparando envio automático — dia 06, 06:00 BRT');
    executarEnvioRelatorio().catch(e =>
        console.error('[ENVIO-RELATORIO] ❌ Erro no cron automático:', e.message));
}

function iniciarAgendador() {
    if (_cronHandle) return;
    _cronHandle = setInterval(_verificarCron, 5 * 60 * 1000);
    console.log('[ENVIO-RELATORIO] ✅ Agendador iniciado. Executa todo dia 06 às 06:00 BRT.');
}

function pararAgendador() {
    if (_cronHandle) { clearInterval(_cronHandle); _cronHandle = null; }
}

// ─── Getters de status ────────────────────────────────────────
function getStatus() {
    return {
        executando:    _executando,
        ultimoEnvio:   _ultimoEnvio,
        ultimoStatus:  _ultimoStatus,
        ultimoErro:    _ultimoErro,
        agendadorAtivo: !!_cronHandle,
        progresso:     { ..._progresso },
        configuracao: {
            dia:              6,
            hora:             '06:00 BRT',
            distanciaMinima:  `${DISTANCIA_MINIMA_METROS} m`,
            destinatarios:    EMAILS_DESTINO,
            remetente:        EMAIL_FROM,
            modelosIgnorados: MODELOS_IGNORADOS,
        },
    };
}

// ─── Exports ─────────────────────────────────────────────────
module.exports = {
    iniciarAgendador,
    pararAgendador,
    executarEnvioRelatorio,
    getStatus,
    _gerarHtmlPreview,
    DISTANCIA_MINIMA_METROS,
    MODELOS_IGNORADOS,
    EMAILS_DESTINO,
};