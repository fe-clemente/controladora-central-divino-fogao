/**
 * gerarPdfAvaliacao.js
 * Gera PDF da avaliação de treinamento — layout idêntico ao formulário Divino Fogão.
 *
 * Dependência (CDN, já incluso no HTML via <script>):
 *   https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
 *
 * Uso:
 *   import { gerarPdfAvaliacao } from './gerarPdfAvaliacao.js';
 *   await gerarPdfAvaliacao(avaliacao);   // avaliacao = objeto da buscaAvaliacoes
 *
 * Ou via tag <script> no HTML (sem módulos):
 *   gerarPdfAvaliacao(avaliacao);
 */

(function (global) {
    'use strict';

    // ── Paleta de cores (extraída do formulário) ──────────────────────────────
    const COR = {
        vermelho:      [200, 16,  46],   // cabeçalho Divino Fogão
        vermelhoClaro: [220, 60,  60],   // escala baixa (nota 1-2)
        laranja:       [230, 140,  30],  // escala média (nota 3)
        verde:         [21,  128,  61],  // aprovado SIM
        amarelo:       [245, 200,   0],  // destaques
        cinzaClaro:    [245, 245, 245],  // fundo campos resposta
        cinzaMedio:    [200, 200, 200],  // bordas
        cinzaEscuro:   [100, 100, 100],  // texto secundário
        branco:        [255, 255, 255],
        preto:         [  0,   0,   0],
        fundoLabel:    [240, 240, 240],  // fundo das colunas de perguntas
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    function corEscala(nota) {
        const n = parseFloat(nota);
        if (isNaN(n)) return COR.cinzaClaro;
        if (n <= 2)   return COR.vermelhoClaro;
        if (n <= 3)   return COR.laranja;
        return COR.verde;
    }

    function corAprovado(v) {
        const u = String(v || '').toUpperCase().trim();
        if (u === 'SIM' || u === 'YES' || u === 'APROVADO') return COR.verde;
        if (u === 'NÃO' || u === 'NAO' || u === 'NO')       return COR.vermelho;
        return COR.laranja;
    }

    function txtAprovado(v) {
        const u = String(v || '').toUpperCase().trim();
        if (u === 'SIM' || u === 'YES' || u === 'APROVADO') return 'SIM';
        if (u === 'NÃO' || u === 'NAO' || u === 'NO')       return 'NÃO';
        return v || '—';
    }

    function safe(v) { return String(v || '—').trim() || '—'; }

    /**
     * Quebra texto longo em linhas respeitando largura máxima.
     * Retorna array de strings.
     */
    function quebrarTexto(doc, texto, larguraMax, fontSize) {
        doc.setFontSize(fontSize);
        return doc.splitTextToSize(String(texto || ''), larguraMax);
    }

    /**
     * Desenha retângulo com borda e fundo.
     */
    function rect(doc, x, y, w, h, fillRgb, borderRgb) {
        if (fillRgb) {
            doc.setFillColor(...fillRgb);
            doc.rect(x, y, w, h, 'F');
        }
        if (borderRgb) {
            doc.setDrawColor(...borderRgb);
            doc.setLineWidth(0.3);
            doc.rect(x, y, w, h, 'S');
        }
    }

    /**
     * Escreve texto centralizado dentro de um bloco (x, y, w, h).
     */
    function textoCentrado(doc, texto, x, y, w, h, fontSize, bold, corRgb) {
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setTextColor(...(corRgb || COR.preto));
        const linhas = quebrarTexto(doc, texto, w - 4, fontSize);
        const altTotal = linhas.length * (fontSize * 0.35);
        const yInicio  = y + h / 2 - altTotal / 2 + fontSize * 0.3;
        linhas.forEach((linha, i) => {
            doc.text(linha, x + w / 2, yInicio + i * fontSize * 0.38, { align: 'center' });
        });
    }

    /**
     * Escreve texto alinhado à esquerda dentro de um bloco.
     * Retorna a altura real ocupada.
     */
    function textoBloco(doc, texto, x, y, w, fontSize, bold, corRgb, paddingX, paddingY) {
        paddingX = paddingX || 3;
        paddingY = paddingY || 3;
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setTextColor(...(corRgb || COR.preto));
        const linhas = quebrarTexto(doc, texto, w - paddingX * 2, fontSize);
        linhas.forEach((linha, i) => {
            doc.text(linha, x + paddingX, y + paddingY + i * fontSize * 0.38);
        });
        return linhas.length * fontSize * 0.38 + paddingY * 2;
    }

    /**
     * Desenha uma linha de critério:
     * [ LABEL esquerda ] [ PERGUNTA centro ] Resposta: [ RESPOSTA direita ]
     * Retorna a altura usada.
     */
    function linhaCriterio(doc, y, label, pergunta, resposta, pageW, margin) {
        const usableW   = pageW - margin * 2;
        const wLabel    = 38;
        const wPergunta = 75;
        const wResposta = usableW - wLabel - wPergunta;
        const minH      = 18;
        const fontSize  = 7.5;

        // Calcular altura necessária para a resposta
        const linhasResp = quebrarTexto(doc, safe(resposta), wResposta - 8, fontSize);
        const altResp    = Math.max(minH, linhasResp.length * fontSize * 0.38 + 8);
        const linhasPerb = quebrarTexto(doc, pergunta, wPergunta - 6, 6.5);
        const altPerb    = Math.max(minH, linhasPerb.length * 6.5 * 0.38 + 8);
        const h          = Math.max(altResp, altPerb, minH);

        const x = margin;

        // Label (coluna esquerda — fundo acinzentado)
        rect(doc, x,              y, wLabel,    h, COR.fundoLabel, COR.cinzaMedio);
        // Pergunta (coluna central)
        rect(doc, x + wLabel,     y, wPergunta, h, COR.branco,     COR.cinzaMedio);
        // Resposta (coluna direita — fundo cinza claro)
        rect(doc, x + wLabel + wPergunta, y, wResposta, h, COR.cinzaClaro, COR.cinzaMedio);

        // Textos
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COR.cinzaEscuro);
        const labLines = doc.splitTextToSize(label, wLabel - 4);
        labLines.forEach((l, i) => doc.text(l, x + 2, y + 5 + i * 7 * 0.38));

        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COR.preto);
        linhasPerb.forEach((l, i) => doc.text(l, x + wLabel + 3, y + 5 + i * 6.5 * 0.38));

        // "Resposta:" label
        doc.setFontSize(6);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(...COR.cinzaEscuro);
        doc.text('Resposta:', x + wLabel + wPergunta + 2, y + 4.5);

        // Texto da resposta
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COR.preto);
        linhasResp.forEach((l, i) => {
            doc.text(l, x + wLabel + wPergunta + 4, y + 9 + i * fontSize * 0.38);
        });

        return h;
    }

    /**
     * Desenha bloco de escala numérica colorida (comportamento, entendimento, etc.)
     */
    function linhaEscala(doc, y, label, valor, pageW, margin) {
        const usableW = pageW - margin * 2;
        const wLabel  = 120;
        const wValor  = usableW - wLabel;
        const h       = 12;
        const x       = margin;
        const cor     = corEscala(valor);

        rect(doc, x,          y, wLabel, h, COR.fundoLabel, COR.cinzaMedio);
        rect(doc, x + wLabel, y, wValor, h, cor,            COR.cinzaMedio);

        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COR.preto);
        const labLines = doc.splitTextToSize(label, wLabel - 4);
        labLines.forEach((l, i) => doc.text(l, x + 2, y + 4.5 + i * 7 * 0.38));

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COR.branco);
        doc.text(safe(valor), x + wLabel + wValor / 2, y + 8, { align: 'center' });

        return h;
    }

    // ── Função principal ──────────────────────────────────────────────────────
    async function gerarPdfAvaliacao(a) {
        // Garante que jsPDF está disponível
        const { jsPDF } = window.jspdf || window;
        if (!jsPDF) {
            alert('Biblioteca jsPDF não carregada. Inclua o script CDN no HTML.');
            return;
        }

        const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW  = doc.internal.pageSize.getWidth();
        const pageH  = doc.internal.pageSize.getHeight();
        const margin = 10;
        let   y      = margin;

        // ── CABEÇALHO ─────────────────────────────────────────────────────────
        // Fundo vermelho topo
        rect(doc, margin, y, pageW - margin * 2, 18, COR.vermelho, null);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COR.branco);
        doc.text('AVALIAÇÃO TREINAMENTO PRESENCIAL', pageW / 2, y + 11, { align: 'center' });
        y += 19;

        // Logo / subtítulo
        rect(doc, margin, y, pageW - margin * 2, 8, COR.branco, COR.cinzaMedio);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COR.vermelho);
        doc.text('DIVINO FOGÃO', pageW / 2, y + 5.5, { align: 'center' });
        y += 9;

        // ── DADOS DO COLABORADOR ──────────────────────────────────────────────
        const usableW   = pageW - margin * 2;
        const col4      = usableW / 4;
        const hDados    = 8;

        // Linha 1 — labels
        const labelsL1 = ['Nome Colaborador(a) Avaliado(a):', 'Função do Colaborador(a):', 'Qtd de refeições', 'Nome e unidade'];
        labelsL1.forEach((lbl, i) => {
            rect(doc, margin + i * col4, y, col4, hDados, COR.fundoLabel, COR.cinzaMedio);
            doc.setFontSize(6.5);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...COR.cinzaEscuro);
            doc.text(lbl, margin + i * col4 + 2, y + 5);
        });
        y += hDados;

        // Linha 2 — valores
        const valsL2 = [
            safe(a.colaborador),
            safe(a.funcaoColab),
            safe(a.refeicoes),
            safe(a.avaliador),
        ];
        valsL2.forEach((val, i) => {
            rect(doc, margin + i * col4, y, col4, hDados, COR.branco, COR.cinzaMedio);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...COR.preto);
            const linhas = doc.splitTextToSize(val, col4 - 4);
            doc.text(linhas[0] || val, margin + i * col4 + col4 / 2, y + 5, { align: 'center' });
        });
        y += hDados;

        // Linha 3 — loja / datas / bebidas / unidade
        const col3w   = [col4, col4 / 2, col4 / 2, col4];
        const col3v   = [safe(a.lojaTreinada), safe(a.inicioTrein), safe(a.fimTrein), safe(a.unidade)];
        const col3lbl = ['', '', '', ''];
        let xOff = margin;
        col3w.forEach((w, i) => {
            rect(doc, xOff, y, w, hDados, COR.cinzaClaro, COR.cinzaMedio);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...COR.preto);
            doc.text(col3v[i], xOff + w / 2, y + 5, { align: 'center' });
            xOff += w;
        });
        y += hDados + 3;

        // ── LINHA AVALIADOR ───────────────────────────────────────────────────
        rect(doc, margin, y, usableW, 7, COR.fundoLabel, COR.cinzaMedio);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COR.cinzaEscuro);
        doc.text('Avaliado por:', margin + 2, y + 4.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COR.preto);
        doc.text(safe(a.avaliador) + '   |   Treinador(a): ' + safe(a.treinadorFuncao), margin + 28, y + 4.5);
        y += 8;

        // ── CRITÉRIOS DE AVALIAÇÃO ────────────────────────────────────────────
        const criterios = [
            {
                label:    'Compreensão do\nTreinamento:',
                pergunta: 'O colaborador entendeu os conceitos e procedimentos do treinamento?',
                resp:     a.compreensao,
            },
            {
                label:    'Habilidades\nTécnicas:',
                pergunta: 'Nos envio foto do trabalho do colaborador. Exemplos: Montagem do Bufê (quente ou fria), manipulando o equipamento, finalizando um prato, entre outros...',
                resp:     a.fotoTecnica || a.habilidadesTec,
            },
            {
                label:    'Habilidades\nTécnicas:',
                pergunta: 'O colaborador demonstrou as habilidades técnicas necessárias para a função? (como manipular alimentos, atender clientes e operar equipamentos)?',
                resp:     a.habilidadesTec,
            },
            {
                label:    'Atitudes e\nComportamento:',
                pergunta: 'Como foi a atitude do(a) colaborador(a) durante o treinamento? Ele(a) estava disposto(a) a aprender e melhorar? Foi pró-ativo(a), questionador(a), ou demonstrou outras qualidades?',
                resp:     a.atitudes,
            },
            {
                label:    'Capacidade de\nResolução de\nProblemas:',
                pergunta: 'O(a) colaborador(a) conseguiu lidar com situações inesperadas ou resolver problemas durante o treinamento? Mostrou iniciativa?',
                resp:     a.resolucaoProb,
            },
            {
                label:    'Trabalho em\nEquipe:',
                pergunta: 'Como foi a participação do colaborador(a) com outros membros da equipe durante o treinamento? (Comunicação, ajuda, participação em situações inapropriadas)',
                resp:     a.trabalhoEquipe,
            },
            {
                label:    'Adesão aos\nPadrões e\nProcedimentos:',
                pergunta: 'Demonstrou entendimento e seguiu as políticas da empresa (Ex.: Compreensão do cardápio, uso do nosso tempero, montagem do bufê, entre outros)?',
                resp:     a.adesaoPadroes,
            },
            {
                label:    'Feedback e\nMelhoria\nContínua:',
                pergunta: 'Descreva como o colaborador reagiu ao feedback recebido durante o treinamento?',
                resp:     a.feedbackMelhoria,
            },
            {
                label:    'Descreva como o\ncolaborador reagiu\nao feedback:',
                pergunta: 'O colaborador se sente confiante para desempenhar suas funções de forma independente após o treinamento?',
                resp:     a.confiancaAutonomia,
            },
        ];

        for (const c of criterios) {
            // Verificar se precisa de nova página
            if (y > pageH - 30) {
                doc.addPage();
                y = margin;
            }
            const hUsado = linhaCriterio(doc, y, c.label, c.pergunta, c.resp, pageW, margin);
            y += hUsado;
        }

        // ── DESTAQUE IMPORTANTE ───────────────────────────────────────────────
        if (y > pageH - 40) { doc.addPage(); y = margin; }

        rect(doc, margin, y, usableW, 7, COR.fundoLabel, COR.cinzaMedio);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COR.preto);
        doc.text('Destaque importante:', margin + 2, y + 5);
        y += 7;

        const linhasDestaque = quebrarTexto(doc, safe(a.destaque), usableW - 6, 8);
        const hDestaque = Math.max(12, linhasDestaque.length * 8 * 0.38 + 8);
        rect(doc, margin, y, usableW, hDestaque, COR.cinzaClaro, COR.cinzaMedio);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COR.preto);
        linhasDestaque.forEach((l, i) => doc.text(l, margin + 3, y + 6 + i * 8 * 0.38));
        y += hDestaque + 3;

        // ── ESCALAS NUMÉRICAS ─────────────────────────────────────────────────
        if (y > pageH - 60) { doc.addPage(); y = margin; }

        const escalas = [
            { label: 'Usando uma escala de 01 à 05, avalie o comportamento do colaborador mediante as informações passadas:', valor: a.comportamento },
            { label: 'Usando uma escala de 01 à 05, como você avalia o entendimento do colaborador quanto ao conteúdo apresentado?', valor: a.entendimentoConteudo },
            { label: 'Na escala de 01 à 05, como avalia que o colaborador está pronto para desempenhar a sua função?', valor: a.prontidaoFuncao },
            { label: 'Em uma escala de 0 a 10, o quanto você acredita que esse colaborador(a) será um multiplicador deste treinamento?', valor: a.multiplicador },
        ];

        for (const e of escalas) {
            if (y > pageH - 15) { doc.addPage(); y = margin; }
            y += linhaEscala(doc, y, e.label, e.valor, pageW, margin);
            y += 1;
        }

        y += 3;

        // ── APROVADO ──────────────────────────────────────────────────────────
        if (y > pageH - 20) { doc.addPage(); y = margin; }

        const usableW2 = pageW - margin * 2;
        const wAprLbl  = 100;
        const wAprVal  = usableW2 - wAprLbl;
        const hApr     = 14;
        const corApr   = corAprovado(a.aprovado);

        rect(doc, margin,           y, wAprLbl, hApr, COR.fundoLabel, COR.cinzaMedio);
        rect(doc, margin + wAprLbl, y, wAprVal, hApr, corApr,         COR.cinzaMedio);

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COR.preto);
        doc.text('Para finalizar, você considera que o colaborador esteja aprovado?', margin + 2, y + 8);

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COR.branco);
        doc.text(txtAprovado(a.aprovado), margin + wAprLbl + wAprVal / 2, y + 9.5, { align: 'center' });
        y += hApr + 3;

        // ── CHECKPOINT ───────────────────────────────────────────────────────
        if (a.checkpointLoja && a.checkpointLoja.trim()) {
            if (y > pageH - 20) { doc.addPage(); y = margin; }
            rect(doc, margin, y, usableW2, 7, COR.fundoLabel, COR.cinzaMedio);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...COR.cinzaEscuro);
            doc.text('Necessário check-point loja treinadora:', margin + 2, y + 4.5);
            y += 7;
            const linhasChk = quebrarTexto(doc, a.checkpointLoja, usableW2 - 6, 7.5);
            const hChk = Math.max(10, linhasChk.length * 7.5 * 0.38 + 6);
            rect(doc, margin, y, usableW2, hChk, COR.cinzaClaro, COR.cinzaMedio);
            doc.setFontSize(7.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...COR.preto);
            linhasChk.forEach((l, i) => doc.text(l, margin + 3, y + 5 + i * 7.5 * 0.38));
            y += hChk + 3;
        }

        // ── RODAPÉ ────────────────────────────────────────────────────────────
        if (y > pageH - 20) { doc.addPage(); y = margin; }

        // Linha separadora
        doc.setDrawColor(...COR.cinzaMedio);
        doc.setLineWidth(0.4);
        doc.line(margin, y, pageW - margin, y);
        y += 5;

        const msgFinal = 'Estamos aqui não só para ensinar, mas também para incentivá-los a fazer o melhor durante toda a sua jornada! Sinta orgulho em fazer parte dessa Rede! Desejamos muita Sorte e SUCESSO!';
        const linhasMsg = quebrarTexto(doc, msgFinal, usableW2, 7.5);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COR.preto);
        linhasMsg.forEach((l, i) => {
            doc.text(l, pageW / 2, y + i * 7.5 * 0.38, { align: 'center' });
        });

        // Número de páginas
        const totalPgs = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPgs; p++) {
            doc.setPage(p);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...COR.cinzaEscuro);
            doc.text(
                `Avaliação — ${safe(a.colaborador)} — ${safe(a.dataHora)}   |   Pág. ${p}/${totalPgs}`,
                pageW / 2,
                pageH - 5,
                { align: 'center' }
            );
        }

        // ── SALVAR ────────────────────────────────────────────────────────────
        const nomeArq = `avaliacao_${(a.colaborador || 'colaborador').replace(/\s+/g, '_').toLowerCase()}_${(a.dataHora || '').split(' ')[0].replace(/\//g, '-')}.pdf`;
        doc.save(nomeArq);
    }

    // Exporta para uso como módulo ES e como global
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { gerarPdfAvaliacao };
    } else {
        global.gerarPdfAvaliacao = gerarPdfAvaliacao;
    }

})(typeof window !== 'undefined' ? window : global);