const fetch = require('node-fetch');

const INSTANCE_ID  = process.env.ZAPI_INSTANCE_ID;
const TOKEN        = process.env.ZAPI_TOKEN;
const CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN;
const ZAPI_URL     = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/send-text`;

const CONTATO_TREINAMENTOS_NUMERO = '5511945098909';
const CONTATO_TREINAMENTOS_NOME   = 'Setor de Treinamentos Divino Fogão';
const LINK_CONTATO_TREINAMENTOS   = `https://wa.me/${CONTATO_TREINAMENTOS_NUMERO}?text=Ol%C3%A1%2C+tenho+uma+d%C3%BAvida+sobre+meu+treinamento.`;

function limparTelefone(tel) {
    let numero = String(tel || '').replace(/\D/g, '');
    if (!numero) throw new Error('Telefone vazio ou inválido.');
    if (numero.startsWith('0')) numero = numero.slice(1);
    if (!numero.startsWith('55')) numero = `55${numero}`;
    return numero;
}

async function enviarWhatsAppLembrete(funcionario) {
    try {
        const numero = limparTelefone(funcionario.telefone);

        const diasTexto =
            funcionario.diffDias === 0 ? '*HOJE*' :
            funcionario.diffDias === 1 ? '*amanhã*' :
            '*em 2 dias*';

        const mensagem =
`🍽️ *DIVINO FOGÃO — Lembrete de Treinamento*

Olá, *${funcionario.nome}*! 👋

Seu treinamento está agendado para ${diasTexto}.

━━━━━━━━━━━━━━━━━━━━
📋 *DETALHES*
━━━━━━━━━━━━━━━━━━━━
🏪 *Loja:* ${funcionario.loja}
👔 *Função:* ${funcionario.funcao}
⏰ *Turno:* ${funcionario.turno}
📅 *Início:* ${funcionario.inicioTrein}
📅 *Fim previsto:* ${funcionario.fimTrein || '—'}
━━━━━━━━━━━━━━━━━━━━

⚠️ *Importante:* Use calçado de segurança obrigatoriamente e traga seus documentos pessoais.

❓ *Dúvidas?* Entre em contato com o ${CONTATO_TREINAMENTOS_NOME}:
👉 ${LINK_CONTATO_TREINAMENTOS}

Atenciosamente,
*Equipe Divino Fogão* 🤝`;

        const response = await fetch(ZAPI_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Client-Token': CLIENT_TOKEN
            },
            body: JSON.stringify({ phone: numero, message: mensagem })
        });

        const texto = await response.text();
        let data;
        try { data = JSON.parse(texto); } catch { data = { raw: texto }; }

        if (!response.ok) {
            throw new Error(`Erro Z-API ${response.status}: ${JSON.stringify(data)}`);
        }

        console.log(`✅ WhatsApp enviado para ${funcionario.nome} (${numero})`, data);
        return data;

    } catch (error) {
        console.error(`❌ Falha ao enviar WhatsApp para ${funcionario?.nome}:`, error.message);
        throw error;
    }
}

module.exports = { enviarWhatsAppLembrete };