const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    }
});

// ─── EMAIL FIXO — sempre recebe uma cópia de tudo ─────────────────────────────
const EMAIL_FIXO = process.env.SMTP_USER || 'fernando.clemente@divinofogao.com.br';

// ─── SANITIZA EMAIL ───────────────────────────────────────────────────────────
function sanitizarEmail(email) {
    if (!email) return null;
    const limpo = email.trim().toLowerCase();
    const valido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo);
    return valido ? limpo : null;
}

// Helper: linha de tabela com 2 colunas
function tr2(bg, label, val) {
    return `<tr style="background:${bg};">
        <td style="padding:10px 18px;color:#6b7280;font-size:13px;width:42%;border-bottom:1px solid #f0f0f0;">${label}</td>
        <td style="padding:10px 18px;color:#111827;font-weight:600;font-size:13px;border-bottom:1px solid #f0f0f0;">${val}</td>
    </tr>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL DE LEMBRETE — vai para o email da coluna M (franqueado/responsável)
// Sempre envia cópia para EMAIL_FIXO (fernando.clemente@divinofogao.com.br)
// Contém botão verde de avaliação com link único por colaborador
// ═══════════════════════════════════════════════════════════════════════════════
async function enviarEmailLembrete(funcionario, linkAvaliacao) {
    // Email da coluna M = destinatário principal
    const emailColM = sanitizarEmail(funcionario.email);

    if (!emailColM) {
        throw new Error(`Email inválido ou vazio na coluna M para ${funcionario.nome}`);
    }

    // Se o email da coluna M for diferente do fixo, o fixo vai como CC
    const emailCC = (emailColM !== EMAIL_FIXO) ? EMAIL_FIXO : null;

    const diasTexto = funcionario.diffDias === 0 ? 'HOJE'
        : funcionario.diffDias === 1 ? 'AMANHÃ'
        : 'em 2 dias';

    const diasTextoAssunto = funcionario.diffDias === 0 ? 'HOJE'
        : funcionario.diffDias === 1 ? 'AMANHÃ'
        : 'em 2 dias';

    console.log(`📧 Enviando lembrete para: ${emailColM}${emailCC ? ' (CC: ' + emailCC + ')' : ''}`);
    console.log(`🔗 Link de avaliação: ${linkAvaliacao}`);

    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;font-family:'Segoe UI',sans-serif;background:#f4f4f4;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:30px 0;">
          <table width="620" cellpadding="0" cellspacing="0"
                 style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">

            <!-- HEADER -->
            <tr>
              <td style="background:linear-gradient(135deg,#c8102e,#8b0000);padding:40px;text-align:center;">
                <h1 style="color:#fff;margin:0;font-size:28px;letter-spacing:2px;">DIVINO FOGÃO</h1>
                <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">Sistema de Treinamentos</p>
              </td>
            </tr>

            <!-- ALERTA -->
            <tr><td style="padding:40px 40px 0;">
              <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:15px;border-radius:6px;">
                <p style="margin:0;font-size:18px;font-weight:bold;color:#856404;">
                  🔔 Treinamento começa <span style="color:#c8102e;">${diasTexto}</span>!
                </p>
              </div>
            </td></tr>

            <!-- BODY -->
            <tr><td style="padding:28px 40px 0;">
              <p style="color:#333;font-size:15px;margin:0 0 8px;">
                Prezado(a) responsável pela <strong>${funcionario.loja}</strong>,
              </p>
              <p style="color:#555;line-height:1.6;font-size:14px;margin:0 0 24px;">
                Este é um lembrete automático sobre o treinamento do colaborador abaixo.
                Após o treinamento, use o botão verde para registrar a avaliação diretamente na planilha.
              </p>

              <!-- DADOS COLABORADOR -->
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="border-radius:8px;overflow:hidden;border:1px solid #e9ecef;margin-bottom:24px;">
                <tr style="background:#c8102e;">
                  <td colspan="2" style="padding:12px 20px;color:#fff;font-weight:bold;font-size:14px;">
                    👤 DETALHES DO TREINAMENTO
                  </td>
                </tr>
                ${tr2('#fff',     '🏪 Loja',             funcionario.loja)}
                ${tr2('#f8f9fa',  '👔 Função',            funcionario.funcao)}
                ${tr2('#fff',     '⏰ Turno',             funcionario.turno || '—')}
                ${tr2('#f8f9fa',  '📅 Início',            funcionario.inicioTrein)}
                ${tr2('#fff',     '📅 Fim',               funcionario.fimTrein || '—')}
              </table>

              <!-- BLOCO AVALIAÇÃO COM LINK -->
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:2px solid #16a34a;
                            border-radius:12px;margin-bottom:24px;">
                <tr><td style="padding:28px;text-align:center;">
                  <p style="margin:0 0 6px;font-size:17px;font-weight:bold;color:#15803d;">
                    📋 AVALIAÇÃO DO TREINAMENTO
                  </p>
                  <p style="margin:0 0 20px;color:#166534;font-size:13px;line-height:1.6;">
                    Ao concluir o treinamento, clique no botão abaixo para registrar a nota do colaborador
                    (0 a 10) e confirmar a data de término.<br>
                    <strong>Os dados serão salvos automaticamente na planilha de controle.</strong>
                  </p>
                  <a href="${linkAvaliacao}"
                     style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;
                            padding:16px 36px;border-radius:10px;font-size:16px;font-weight:bold;
                            letter-spacing:0.3px;box-shadow:0 4px 14px rgba(22,163,74,0.4);">
                    ✅ &nbsp; Avaliar Colaborador Agora
                  </a>
                  <p style="margin:14px 0 0;font-size:11px;color:#6b7280;">
                    Se o botão não funcionar, copie e cole este link no navegador:<br>
                    <a href="${linkAvaliacao}" style="color:#16a34a;word-break:break-all;">${linkAvaliacao}</a>
                  </p>
                </td></tr>
              </table>

              <!-- AVISO -->
              <div style="background:#fef9e7;border-radius:8px;padding:14px;border-left:4px solid #f59e0b;margin-bottom:28px;">
                <p style="margin:0;color:#92400e;font-size:13px;">
                  ✅ <strong>Importante:</strong> Traga seus documentos e use calçado de segurança.
                </p>
              </div>
            </td></tr>

            <!-- FOOTER -->
            <tr>
              <td style="background:#f8f9fa;padding:20px;text-align:center;border-top:1px solid #e9ecef;">
                <p style="margin:0;color:#999;font-size:12px;">Divino Fogão — Departamento de Treinamentos</p>
                <p style="margin:5px 0 0;color:#999;font-size:12px;">E-mail automático. Para dúvidas responda este e-mail.</p>
              </td>
            </tr>

          </table>
        </td></tr>
      </table>
    </body>
    </html>`;

    await transporter.sendMail({
        from: '"Divino Fogão Treinamentos" <fernando.clemente@divinofogao.com.br>',
        to: emailColM,
        ...(emailCC ? { cc: emailCC } : {}),
        subject: `🔔 Lembrete: Treinamento ${diasTextoAssunto} — ${funcionario.loja} | ${funcionario.nome}`,
        html
    });

    console.log(`✅ Email lembrete enviado → ${emailColM}${emailCC ? ' CC: ' + emailCC : ''}`);
    console.log(`🔗 Link de avaliação no email: ${linkAvaliacao}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL DE RESULTADO — vai para o email da coluna M (mesmo do lembrete)
// + cópia para EMAIL_FIXO se diferente
// Disparado após o franqueado registrar a nota no formulário avaliacao.html
// ═══════════════════════════════════════════════════════════════════════════════
async function enviarEmailResultadoAvaliacao(funcionario, nota, dataFim, observacoes) {
    const corNota   = nota >= 8 ? '#16a34a' : nota >= 6 ? '#d97706' : '#dc2626';
    const emojiNota = nota >= 8 ? '🟢' : nota >= 6 ? '🟡' : '🔴';
    const labelNota = nota >= 8 ? 'Ótimo' : nota >= 6 ? 'Regular' : 'Abaixo do esperado';

    // Destinatário principal = email da coluna M
    const emailColM = sanitizarEmail(funcionario.email);
    const emailCC   = (emailColM && emailColM !== EMAIL_FIXO) ? EMAIL_FIXO : null;

    // Se a coluna M estiver vazia, garante que ao menos EMAIL_FIXO recebe
    const emailTo = emailColM || EMAIL_FIXO;

    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;font-family:'Segoe UI',sans-serif;background:#f4f4f4;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:30px 0;">
          <table width="580" cellpadding="0" cellspacing="0"
                 style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">

            <tr>
              <td style="background:linear-gradient(135deg,#c8102e,#8b0000);padding:36px 40px;text-align:center;">
                <h1 style="color:#fff;margin:0;font-size:26px;letter-spacing:2px;">DIVINO FOGÃO</h1>
                <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px;">📋 Resultado de Avaliação de Treinamento</p>
              </td>
            </tr>

            <tr><td style="padding:36px 40px;">

              <p style="color:#333;font-size:15px;margin-bottom:24px;">
                Uma avaliação de treinamento foi registrada:
              </p>

              <!-- NOTA DESTAQUE -->
              <div style="text-align:center;margin-bottom:28px;padding:24px;background:#f9fafb;border-radius:10px;border:1.5px solid #e5e7eb;">
                <p style="margin:0 0 6px;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Nota Final</p>
                <div style="font-size:60px;font-weight:900;color:${corNota};line-height:1;">
                  ${nota}<span style="font-size:22px;color:#9ca3af;">/10</span>
                </div>
                <p style="margin:8px 0 0;font-size:15px;font-weight:700;color:${corNota};">${emojiNota} ${labelNota}</p>
              </div>

              <!-- DADOS -->
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="margin-bottom:24px;border-radius:8px;overflow:hidden;border:1px solid #e9ecef;">
                <tr style="background:#1e293b;">
                  <td colspan="2" style="padding:12px 18px;color:#fff;font-weight:bold;font-size:13px;">👤 DADOS DO COLABORADOR</td>
                </tr>
                ${tr2('#fff',    'Nome',                funcionario.nome)}
                ${tr2('#f8f9fa','🏪 Loja',              funcionario.loja)}
                ${tr2('#fff',   '👔 Função',             funcionario.funcao)}
                ${tr2('#f8f9fa','⏰ Turno',              funcionario.turno || '—')}
                ${tr2('#fff',   '📅 Início Treinamento', funcionario.inicioTrein || '—')}
                ${tr2('#f8f9fa','📅 Data Fim Registrada', dataFim || '—')}
                ${tr2('#fff',   '📞 Telefone',           funcionario.telefone || '—')}
                ${tr2('#f8f9fa','✉️ E-mail',              funcionario.email || '—')}
              </table>

              ${observacoes ? `
              <div style="background:#f0f9ff;border-left:4px solid #0ea5e9;border-radius:6px;padding:16px;margin-bottom:20px;">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#0369a1;">Observações</p>
                <p style="margin:0;color:#0c4a6e;font-size:14px;line-height:1.6;">${observacoes}</p>
              </div>` : ''}

              <div style="background:#fef3c7;border-radius:8px;padding:14px;">
                <p style="margin:0;color:#92400e;font-size:12px;">
                  📊 Avaliação registrada automaticamente na planilha (colunas AH e P).
                </p>
              </div>

            </td></tr>

            <tr>
              <td style="background:#f8f9fa;padding:18px 40px;text-align:center;border-top:1px solid #e9ecef;">
                <p style="margin:0;color:#9ca3af;font-size:11px;">Divino Fogão — Sistema Automático de Treinamentos</p>
              </td>
            </tr>

          </table>
        </td></tr>
      </table>
    </body>
    </html>`;

    await transporter.sendMail({
        from: '"Divino Fogão Treinamentos" <fernando.clemente@divinofogao.com.br>',
        to: emailTo,
        ...(emailCC ? { cc: emailCC } : {}),
        subject: `📋 Avaliação Concluída — ${funcionario.nome} | ${funcionario.loja} | Nota: ${nota}/10`,
        html
    });

    console.log(`✅ Email resultado enviado → ${emailTo}${emailCC ? ' CC: ' + emailCC : ''} | ${funcionario.nome} nota ${nota}`);
}

module.exports = { enviarEmailLembrete, enviarEmailResultadoAvaliacao };