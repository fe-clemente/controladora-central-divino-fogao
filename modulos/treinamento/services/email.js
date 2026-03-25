const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    }
});

// ─── EMAIL FIXO — sempre recebe uma cópia de tudo ─────────────────────────────
const EMAIL_FIXO = process.env.SMTP_USER || 'treinamento@divinofogao.com.br';

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

// ─── HTML DO LEMBRETE (compartilhado pelos dois tipos) ────────────────────────
function _htmlLembrete(funcionario, diasTexto, linkAvaliacao, tipo) {
    const tituloBloco = tipo === 'treinadora'
        ? '📋 AVALIAÇÃO DA LOJA TREINADORA'
        : '📋 AVALIAÇÃO DO TREINAMENTO';
    const descBloco = tipo === 'treinadora'
        ? `O colaborador abaixo está vindo para treinamento na sua loja.<br>
           Ao concluir, use o botão abaixo para registrar a <strong>nota, observações e data de término</strong>.`
        : `Após o treinamento, use o botão abaixo para registrar a nota do colaborador (0 a 10).<br>
           <strong>Os dados serão salvos automaticamente na planilha de controle.</strong>`;
    const tituloParagrafo = tipo === 'treinadora'
        ? `Prezado(a) responsável pela loja avaliadora,`
        : `Prezado(a) responsável pela <strong>${funcionario.loja}</strong>,`;

    return `<!DOCTYPE html>
    <html><head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;font-family:'Segoe UI',sans-serif;background:#f4f4f4;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:30px 0;">
          <table width="620" cellpadding="0" cellspacing="0"
                 style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
            <tr>
              <td style="background:linear-gradient(135deg,#c8102e,#8b0000);padding:40px;text-align:center;">
                <h1 style="color:#fff;margin:0;font-size:28px;letter-spacing:2px;">DIVINO FOGÃO</h1>
                <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">Sistema de Treinamentos</p>
              </td>
            </tr>
            <tr><td style="padding:40px 40px 0;">
              <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:15px;border-radius:6px;">
                <p style="margin:0;font-size:18px;font-weight:bold;color:#856404;">
                  🔔 Treinamento começa <span style="color:#c8102e;">${diasTexto}</span>!
                </p>
              </div>
            </td></tr>
            <tr><td style="padding:28px 40px 0;">
              <p style="color:#333;font-size:15px;margin:0 0 8px;">${tituloParagrafo}</p>
              <p style="color:#555;line-height:1.6;font-size:14px;margin:0 0 24px;">
                Este é um lembrete automático sobre o treinamento do colaborador abaixo.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="border-radius:8px;overflow:hidden;border:1px solid #e9ecef;margin-bottom:24px;">
                <tr style="background:#c8102e;">
                  <td colspan="2" style="padding:12px 20px;color:#fff;font-weight:bold;font-size:14px;">
                    👤 DETALHES DO TREINAMENTO
                  </td>
                </tr>
                ${tr2('#fff',    '👤 Nome',    funcionario.nome)}
                ${tr2('#f8f9fa','🏪 Loja',    funcionario.loja)}
                ${tr2('#fff',   '👔 Função',   funcionario.funcao)}
                ${tr2('#f8f9fa','⏰ Turno',    funcionario.turno || '—')}
                ${tr2('#fff',   '📅 Início',   funcionario.inicioTrein)}
                ${tr2('#f8f9fa','📅 Fim',      funcionario.fimTrein || '—')}
              </table>
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:2px solid #16a34a;
                            border-radius:12px;margin-bottom:24px;">
                <tr><td style="padding:28px;text-align:center;">
                  <p style="margin:0 0 6px;font-size:17px;font-weight:bold;color:#15803d;">${tituloBloco}</p>
                  <p style="margin:0 0 20px;color:#166534;font-size:13px;line-height:1.6;">${descBloco}</p>
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
              <div style="background:#fef9e7;border-radius:8px;padding:14px;border-left:4px solid #f59e0b;margin-bottom:28px;">
                <p style="margin:0;color:#92400e;font-size:13px;">
                  ✅ <strong>Importante:</strong> Traga seus documentos e use calçado de segurança.
                </p>
              </div>
            </td></tr>
            <tr>
              <td style="background:#f8f9fa;padding:20px;text-align:center;border-top:1px solid #e9ecef;">
                <p style="margin:0;color:#999;font-size:12px;">Divino Fogão — Departamento de Treinamentos</p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL DE LEMBRETE
// Envia para col M (loja origem) e col AO (loja treinadora) se existir
// Cada uma recebe seu próprio link de avaliação
// ═══════════════════════════════════════════════════════════════════════════════
async function enviarEmailLembrete(funcionario, linkAvaliacaoOrigem, linkAvaliacaoTreinadora) {
    const emailOrigem     = sanitizarEmail(funcionario.email);               // col M
    const emailTreinadora = sanitizarEmail(funcionario.emailLojaAvaliadora); // col AO

    if (!emailOrigem && !emailTreinadora) {
        throw new Error(`Nenhum email válido (col M ou AO) para ${funcionario.nome}`);
    }

    const diasTexto = funcionario.diffDias === 0 ? 'HOJE'
        : funcionario.diffDias === 1 ? 'AMANHÃ'
        : 'em 2 dias';

    const erros = [];

    // ── Envia para loja de ORIGEM (col M) ─────────────────────────────────────
    if (emailOrigem && linkAvaliacaoOrigem) {
        const emailCC    = (emailOrigem !== EMAIL_FIXO) ? EMAIL_FIXO : null;
        const htmlOrigem = _htmlLembrete(funcionario, diasTexto, linkAvaliacaoOrigem, 'origem');
        try {
            await transporter.sendMail({
                from:    '"Divino Fogão Treinamentos" <fernando.clemente@divinofogao.com.br>',
                to:      emailOrigem,
                ...(emailCC ? { cc: emailCC } : {}),
                subject: `🔔 Lembrete: Treinamento ${diasTexto} — ${funcionario.loja} | ${funcionario.nome}`,
                html:    htmlOrigem,
            });
            console.log(`✅ Email lembrete [origem] → ${emailOrigem}`);
        } catch (e) {
            console.error(`❌ Falha email [origem] ${emailOrigem}:`, e.message);
            erros.push(e.message);
        }
    }

    // ── Envia para loja TREINADORA (col AO) ───────────────────────────────────
    if (emailTreinadora && linkAvaliacaoTreinadora) {
        const emailCC2      = (emailTreinadora !== EMAIL_FIXO && emailTreinadora !== sanitizarEmail(funcionario.email))
            ? EMAIL_FIXO : null;
        const htmlTreinadora = _htmlLembrete(funcionario, diasTexto, linkAvaliacaoTreinadora, 'treinadora');
        try {
            await transporter.sendMail({
                from:    '"Divino Fogão Treinamentos" <fernando.clemente@divinofogao.com.br>',
                to:      emailTreinadora,
                ...(emailCC2 ? { cc: emailCC2 } : {}),
                subject: `🔔 Avaliação de Trainee — ${funcionario.nome} | Loja ${funcionario.loja}`,
                html:    htmlTreinadora,
            });
            console.log(`✅ Email lembrete [treinadora] → ${emailTreinadora}`);
        } catch (e) {
            console.error(`❌ Falha email [treinadora] ${emailTreinadora}:`, e.message);
            erros.push(e.message);
        }
    }

    if (erros.length === 2) throw new Error('Falha em ambos os envios: ' + erros.join(' | '));
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL DE RESULTADO — vai para treinamento@divinofogao.com.br
// Disparado após qualquer avaliador registrar a nota no formulário avaliacao.html
// tipo: 'origem' | 'treinadora'
// ═══════════════════════════════════════════════════════════════════════════════
async function enviarEmailResultadoAvaliacao(funcionario, nota, dataFim, observacoes, tipo = 'origem') {
    const corNota   = nota >= 8 ? '#16a34a' : nota >= 6 ? '#d97706' : '#dc2626';
    const emojiNota = nota >= 8 ? '🟢' : nota >= 6 ? '🟡' : '🔴';
    const labelNota = nota >= 8 ? 'Ótimo' : nota >= 6 ? 'Regular' : 'Abaixo do esperado';

    const tipoLabel = tipo === 'treinadora' ? 'Loja Treinadora' : 'Loja de Origem';
    const colsLabel = tipo === 'treinadora' ? 'AN, AQ, AR, P' : 'Z, AH';

    // Sempre vai para EMAIL_FIXO; se col M diferente, coloca como CC também
    const emailColM = sanitizarEmail(funcionario.email);
    const emailTo   = EMAIL_FIXO;
    const emailCC   = (emailColM && emailColM !== EMAIL_FIXO) ? emailColM : null;

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
                <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px;">
                  📋 Resultado de Avaliação — ${tipoLabel}
                </p>
              </td>
            </tr>

            <tr><td style="padding:36px 40px;">

              <p style="color:#333;font-size:15px;margin-bottom:24px;">
                Uma avaliação de treinamento foi registrada pela <strong>${tipoLabel}</strong>:
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
                ${tr2('#fff',    'Nome',                 funcionario.nome)}
                ${tr2('#f8f9fa','🏪 Loja',               funcionario.loja)}
                ${tr2('#fff',   '👔 Função',              funcionario.funcao)}
                ${tr2('#f8f9fa','⏰ Turno',               funcionario.turno || '—')}
                ${tr2('#fff',   '📅 Início Treinamento',  funcionario.inicioTrein || '—')}
                ${tr2('#f8f9fa','📅 Data Fim Registrada',  dataFim || '—')}
                ${tr2('#fff',   '📞 Telefone',            funcionario.telefone || '—')}
                ${tr2('#f8f9fa','✉️ E-mail',               funcionario.email || '—')}
              </table>

              ${observacoes ? `
              <div style="background:#f0f9ff;border-left:4px solid #0ea5e9;border-radius:6px;padding:16px;margin-bottom:20px;">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#0369a1;">Observações</p>
                <p style="margin:0;color:#0c4a6e;font-size:14px;line-height:1.6;">${observacoes}</p>
              </div>` : ''}

              <div style="background:#fef3c7;border-radius:8px;padding:14px;">
                <p style="margin:0;color:#92400e;font-size:12px;">
                  📊 Avaliação [${tipoLabel} → colunas ${colsLabel}] registrada automaticamente na planilha.
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
        from:    '"Divino Fogão Treinamentos" <treinamento@divinofogao.com.br>',
        to:      emailTo,
        ...(emailCC ? { cc: emailCC } : {}),
        subject: `📋 Avaliação [${tipoLabel}] — ${funcionario.nome} | ${funcionario.loja} | Nota: ${nota}/10`,
        html,
    });

    console.log(`✅ Email resultado [${tipoLabel}] → ${emailTo}${emailCC ? ' CC: ' + emailCC : ''} | ${funcionario.nome} nota ${nota}`);
}

module.exports = { enviarEmailLembrete, enviarEmailResultadoAvaliacao };