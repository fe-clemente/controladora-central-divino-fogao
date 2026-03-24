// services/linksExternosService.js
// Montar no server.js: app.use('/links', require('./services/linksExternosService'));
// Dependências: npm install googleapis
'use strict';

const express   = require('express');
const router    = express.Router();
const fs        = require('fs');
const path      = require('path');
const { google } = require('googleapis');

// ── Configuração Google Sheets ─────────────────────────────────────────────────
const SHEET_ID  = '1HCv-aizjWCU9AfA_cdmCXkSEd5Vtkwi7Ga-tmteJyZs';
const SHEET_TAB = 'LINKS_GERAL';

// Inicializa o cliente Google
// Prioridade de autenticação:
//   1. GOOGLE_SHEETS_CLIENT_EMAIL + GOOGLE_SHEETS_PRIVATE_KEY  (variáveis .env — recomendado)
//   2. GOOGLE_SA_KEY                                            (JSON inteiro stringificado)
//   3. GOOGLE_APPLICATION_CREDENTIALS                          (path para arquivo .json)
//   4. credentials/google-sa.json                              (arquivo local fallback)
async function getSheetClient() {
    let auth;

    if (process.env.GOOGLE_SHEETS_CLIENT_EMAIL && process.env.GOOGLE_SHEETS_PRIVATE_KEY) {
        // ── Opção 1: variáveis separadas no .env (mais simples) ──
        auth = new google.auth.GoogleAuth({
            credentials: {
                type: 'service_account',
                client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
                // O .env pode guardar \n como literal — converte de volta
                private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

    } else if (process.env.GOOGLE_SA_KEY) {
        // ── Opção 2: JSON inteiro como string no .env ──
        auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SA_KEY),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

    } else {
        // ── Opção 3/4: arquivo físico ──
        const keyFile = process.env.GOOGLE_KEY_FILE
            || path.resolve(process.cwd(), 'minha-chave.json');
        console.log('[links-sheets] Usando keyFile:', keyFile);
        auth = new google.auth.GoogleAuth({
            keyFile,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
    }

    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}

// ── Cache local (fallback) ─────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, '../cache');
const DATA_FILE = path.join(DATA_DIR, 'links_externos.json');

// ── Seed de links ──────────────────────────────────────────────────────────────
const LINKS_INICIAIS = [

    // ══════════════════════════════════════════
    // SISTEMAS INTERNOS
    // ══════════════════════════════════════════
    { id:1,  nome:'Ordem de Pagamento',         url:'https://intra.dvsi.com.br/',                                                                                grupo:'Sistemas Internos', tipo:'sistema', descricao:'Portal interno DVSI — ordens de pagamento' },
    { id:2,  nome:'Controle de Implantação',    url:'https://controleimplantacao.dvsi.com.br/login',                                                             grupo:'Sistemas Internos', tipo:'sistema', descricao:'Controle de implantação DVSI' },
    { id:3,  nome:'SISCAD',                     url:'https://dvsi.com.br/siscad/siscad/login.php',                                                               grupo:'Sistemas Internos', tipo:'sistema', descricao:'Sistema de cadastro DVSI' },
    { id:4,  nome:'ERP',                        url:'https://dvsi.com.br/erp/index.php',                                                                         grupo:'Sistemas Internos', tipo:'sistema', descricao:'ERP DVSI' },
    { id:14, nome:'ERP Associação',             url:'https://associacao.dvsi.com.br/erp/index.php',                                                              grupo:'Sistemas Internos', tipo:'sistema', descricao:'ERP da Associação DVSI' },
    { id:15, nome:'Consultoria',                url:'https://dvsi.com.br/consultoria/',                                                                          grupo:'Sistemas Internos', tipo:'sistema', descricao:'Portal de consultoria DVSI' },

    // ══════════════════════════════════════════
    // SISTEMAS EXTERNOS
    // ══════════════════════════════════════════
    { id:5,  nome:'TOTVS Chef Web',             url:'https://chefwebcloud.chef.totvs.com.br/Login/?ReturnUrl=%2f',                                               grupo:'Sistemas Externos', tipo:'sistema', descricao:'TOTVS Chef Web Cloud' },
    { id:6,  nome:'Google Admin — E-mails',     url:'https://admin.google.com/',                                                                                 grupo:'Sistemas Externos', tipo:'sistema', descricao:'Gestão de e-mails e usuários Google Workspace' },
    { id:7,  nome:'SULTS',                      url:'https://divinofogao.sults.com.br/solucoes',                                                                 grupo:'Sistemas Externos', tipo:'sistema', descricao:'Plataforma SULTS — Divino Fogão' },
    { id:8,  nome:'SULTS API Developers',       url:'https://developers.sults.com.br/',                                                                          grupo:'Sistemas Externos', tipo:'sistema', descricao:'Documentação da API SULTS' },
    { id:16, nome:'ClickUp',                    url:'https://app.clickup.com/90133044789/v/l/li/901325450229',                                                   grupo:'Sistemas Externos', tipo:'sistema', descricao:'Gestão de tarefas e projetos — ClickUp' },
    { id:17, nome:'Kaspersky',                  url:'https://my.kaspersky.com/?returnUrl=%2FMyLicenses#/auth/layout/main',                                       grupo:'Sistemas Externos', tipo:'sistema', descricao:'Gestão de licenças Kaspersky' },
    { id:18, nome:'Linx — Área do Cliente',     url:'https://www.linx.com.br/area-do-cliente-e-suporte/',                                                        grupo:'Sistemas Externos', tipo:'sistema', descricao:'Área do cliente e suporte Linx' },
    { id:19, nome:'Algar — Área do Cliente',    url:'https://algar.com.br/AreaClienteCorporativo',                                                               grupo:'Sistemas Externos', tipo:'sistema', descricao:'Área do cliente corporativo Algar Telecom' },

    // ══════════════════════════════════════════
    // PLANILHAS GOOGLE
    // ══════════════════════════════════════════
    { id:9,  nome:'Pix TEF — Controle de Implantação',          url:'https://docs.google.com/spreadsheets/d/1-61H_O1t1Y9ulxbrakM3kmtfFb8JoIW9qOEmz_p2_Pg/edit?gid=244003848#gid=244003848', grupo:'Planilhas Google', tipo:'planilha', descricao:'Controle de implantação Pix TEF por loja' },
    { id:20, nome:'Controle de Projetos',                        url:'https://docs.google.com/spreadsheets/d/1O0dCvn7vs6PevBIKhEJeerh0h2pLz0izZ9dZIGuZZVs/edit?gid=368710133#gid=368710133', grupo:'Planilhas Google', tipo:'planilha', descricao:'Controle geral de projetos T.I.' },
    { id:21, nome:'Controle de OP',                              url:'https://docs.google.com/spreadsheets/d/1uDne5khXSNf723joyiUWYQjAc7M5vZfekqlP-HYvV-k/edit?gid=238345264#gid=238345264', grupo:'Planilhas Google', tipo:'planilha', descricao:'Controle de Ordem de Pagamento' },
    { id:22, nome:'Planilha de Migração',                        url:'https://docs.google.com/spreadsheets/d/1aqS-In7hzRP3jay6QbLOq5SLH9Q434vi5qZjOKo1tnI/edit?gid=1348630875#gid=1348630875', grupo:'Planilhas Google', tipo:'planilha', descricao:'Planilha de migração de lojas' },
    { id:32, nome:'Cotação TI',                                  url:'https://docs.google.com/spreadsheets/d/14e70ULnkucdNDWl6oJlVozxwwEZ8oda_ev5Z_-38p-Q/edit?gid=0#gid=0',               grupo:'Planilhas Google', tipo:'planilha', descricao:'Planilha de cotação de equipamentos e serviços de TI' },

    // ══════════════════════════════════════════
    // MANUAIS GERAIS
    // ══════════════════════════════════════════
    { id:10, nome:'Manual — Extração XML SAT e NFCE',           url:'https://docs.google.com/document/d/1_ILg2QDP0KyPH8JRZJEjfpyHeZrIHBQ8UCzsQugwd5E/edit?tab=t.0',                        grupo:'Manuais', tipo:'manual', descricao:'#E0008 — Manual de extração XML SAT e NFCE' },
    { id:11, nome:'Manual — Cadastro de Novo Colaborador',      url:'https://docs.google.com/document/d/1QdDC8fiQvdjIQDutfZgP1w82ZaGoeneeYUWtVPYT0gk/edit?tab=t.0',                        grupo:'Manuais', tipo:'manual', descricao:'Cadastro de novo colaborador — e-mail e SULTS' },
    { id:12, nome:'Manual — Isenção de Pagamentos fora do Prazo', url:'https://docs.google.com/document/d/1mELXPwHzH9XHrNHcCKU26C46h_XSEbsdVCdAu2JndQY/edit?tab=t.0',                   grupo:'Manuais', tipo:'manual', descricao:'Manual da ferramenta de isenção de pagamentos' },
    { id:13, nome:'Manual — Desligamento de Colaborador',       url:'https://docs.google.com/document/d/15ODyIlvdsVXc7bE1pXv0kG3qUe_X9UylKy3X2o0pvH0/edit?tab=t.0',                       grupo:'Manuais', tipo:'manual', descricao:'Manual de desligamento de colaborador' },
    { id:23, nome:'Manual — Controle de Implantação',           url:'https://docs.google.com/document/d/1G68caFP1KZibVp1b30FihiIWWoqzvgAWDmzwd3zotBI/edit?tab=t.0',                        grupo:'Manuais', tipo:'manual', descricao:'Manual de controle de implantação' },
    { id:24, nome:'Manual — OP Financeiro',                     url:'https://docs.google.com/document/d/1evLGJGXgCpAOwCJK36IAG1BmRA97oaRTsEBxBDPALVA/edit?tab=t.0',                        grupo:'Manuais', tipo:'manual', descricao:'Manual de Ordem de Pagamento — Financeiro' },
    { id:25, nome:'Manual — OP Controladoria',                  url:'https://docs.google.com/document/d/1DDGCAnhXs4NVkPH8DZBSPJSf0iA-Kw70CfDLCzyba-4/edit?tab=t.0',                        grupo:'Manuais', tipo:'manual', descricao:'Manual de Ordem de Pagamento — Controladoria' },
    { id:26, nome:'Manual — OP Acesso Gestor',                  url:'https://docs.google.com/document/d/1rR4phhDqkrswSE7jVXdcL-Ictn6l-54yvwe2B5vjfBE/edit?tab=t.0',                        grupo:'Manuais', tipo:'manual', descricao:'Manual de acesso gestor — OP' },
    { id:27, nome:'Manual — Instalação Kaspersky',              url:'https://docs.google.com/document/d/1ENUFupnOFJ_e6NJG6UGQ3ZEwGrnK2zYRWShIw9-itDg/edit?tab=t.0',                        grupo:'Manuais', tipo:'manual', descricao:'Manual de instalação do Kaspersky' },
    { id:28, nome:'Manual — Áudio e Vídeo USB-C',              url:'https://docs.google.com/document/d/1paaQLOcHIi1-RYfP3N6bCoMZ3QkzuXuKzHwRNxPg5Tc/edit?tab=t.0',                         grupo:'Manuais', tipo:'manual', descricao:'Manual de conexão USB-C' },
    { id:29, nome:'Pasta — Manuais de Arquitetura',             url:'https://drive.google.com/drive/folders/1aSpIrBkVzupCHOLDR2oGYR0JKkS6AOgX',                                            grupo:'Manuais', tipo:'drive',  descricao:'Pasta com manuais de arquitetura' },
    { id:30, nome:'Manual — Cadastro Reconhecimento Facial',    url:'https://docs.google.com/document/d/1VoyW5qW4XO4aR6tvRzossKN41q4uZ3jgJspc8RZnJ3w/edit?tab=t.0',                        grupo:'Manuais', tipo:'manual', descricao:'#E0024 — Cadastro reconhecimento facial' },
    { id:31, nome:'Manual — Troca Regime Fiscal TOTVS',         url:'https://docs.google.com/document/d/1Mni_AwXRFkMp5sAnqUt4P9JivGKTlT1sJ4Ig5Xe9GK4/edit?tab=t.0',                       grupo:'Manuais', tipo:'manual', descricao:'#E0010 — Troca regime fiscal' },

    // ══════════════════════════════════════════
    // TOTVS — Cadastro
    // ══════════════════════════════════════════
    { id:101, nome:'Cadastros de Produto',                              url:'https://docs.google.com/document/d/1dAu1HrnIG0VNV2Qdii6rR06LDdZKCzN0j2Efg8D3gtE/edit?usp=sharing',           grupo:'Totvs — Cadastro', tipo:'manual', descricao:'#E0001 — Cadastro de produto no Totvs' },
    { id:102, nome:'Cadastrar Operador Caixa PDV',                      url:'https://docs.google.com/document/d/14UJEANwPOmQgpzOvXS2rkd3eJnBkPzWNB7wh4EhyRj4/edit?usp=sharing',           grupo:'Totvs — Cadastro', tipo:'manual', descricao:'#E0002 — Cadastrar operador no PDV' },
    { id:103, nome:'Criar Plano de Contas e Conta Depósito',            url:'https://docs.google.com/document/d/1GmwPZdp8YZ7ZtaKcqsloYfwx6BHeh72TNSBulhArXrw/edit?usp=sharing',           grupo:'Totvs — Cadastro', tipo:'manual', descricao:'#E0003 — Plano de contas e conta depósito' },
    { id:104, nome:'Criação de Produtos — Delivery',                    url:'https://drive.google.com/file/d/1fh8u2qz_5DrDcZjP-FLEUhZAo-_CWDbu/view?usp=drive_link',                       grupo:'Totvs — Cadastro', tipo:'drive',  descricao:'#V0004 — Criação de produtos delivery (vídeo)' },
    { id:105, nome:'Entrada de Notas Compra',                           url:'https://docs.google.com/document/d/12V53rjuNHnKa1Nf7Ly4PcG0dvrumSLfITWzVeiewAZ8/edit?usp=sharing',           grupo:'Totvs — Cadastro', tipo:'manual', descricao:'#E0004 — Entrada de notas de compra' },
    { id:106, nome:'Ocultar/Inativar produto cadastrado',               url:'https://docs.google.com/document/d/1mI5CrOw__q8rlxeuKlltnGRGjS3apzDUIdMTI1c8Skw/edit?usp=sharing',           grupo:'Totvs — Cadastro', tipo:'manual', descricao:'#E0056 — Ocultar ou inativar produtos' },

    // ══════════════════════════════════════════
    // TOTVS — Consulta
    // ══════════════════════════════════════════
    { id:107, nome:'Pegar Cupom',                                       url:'https://docs.google.com/document/d/1IK9nutfj3rBw0ugPahqNnjOnt99guYp4uElhNUGIw-E/edit?usp=sharing',           grupo:'Totvs — Consulta', tipo:'manual', descricao:'#E0005 — Como pegar cupom no Totvs' },
    { id:108, nome:'Lista de Relatórios mais Utilizados Chefweb',       url:'https://docs.google.com/document/d/1OsypWuwZzGfallaBj4R9YUxXNM7Mqi0kVn2IZJ0AF9s/edit?usp=drive_link',        grupo:'Totvs — Consulta', tipo:'manual', descricao:'#E0006 — Relatórios mais usados no Chefweb' },
    { id:109, nome:'Valores de Produtos por Loja',                      url:'https://docs.google.com/document/d/1ReV_YG5oxVd8yXBaahuANTOPP5MLLZ5JWFL5g-9K2eg/edit?usp=sharing',           grupo:'Totvs — Consulta', tipo:'manual', descricao:'#0074 — Valores de produtos por loja' },

    // ══════════════════════════════════════════
    // TOTVS — Fiscal
    // ══════════════════════════════════════════
    { id:110, nome:'Dados Fiscais Produtos',                            url:'https://docs.google.com/document/d/1mCuMjhDVcplUNaMbu9hAM5H5ZYKQYkV2vCsSJ7196Go/edit?usp=sharing',           grupo:'Totvs — Fiscal', tipo:'manual', descricao:'#E0007 — Dados fiscais de produtos' },
    { id:111, nome:'Extração de XML — SAT e NFCe',                     url:'https://docs.google.com/document/d/1_ILg2QDP0KyPH8JRZJEjfpyHeZrIHBQ8UCzsQugwd5E/edit',                        grupo:'Totvs — Fiscal', tipo:'manual', descricao:'#E0008 — Extração de XML SAT e NFCe' },
    { id:112, nome:'Manutenção em Massa (dados fiscais)',               url:'https://docs.google.com/document/d/1oBXHyl3e2I8eZXuDRCLRvzU6C8b-vakTzsNXShaCZrg/edit?usp=sharing',           grupo:'Totvs — Fiscal', tipo:'manual', descricao:'#E0009 — Alterar dados fiscais em massa' },
    { id:113, nome:'Troca de Regime Fiscal',                            url:'https://docs.google.com/document/d/1Mni_AwXRFkMp5sAnqUt4P9JivGKTlT1sJ4Ig5Xe9GK4/edit?usp=drive_link',       grupo:'Totvs — Fiscal', tipo:'manual', descricao:'#E0010 — Troca regime fiscal' },
    { id:114, nome:'Relatório de Produtos x Dados Fiscais',             url:'https://docs.google.com/document/d/1TavIwRo7QiOS3bKRxB1ezKSiEahnPjtdmU80PamqTn8/edit?usp=sharing',           grupo:'Totvs — Fiscal', tipo:'manual', descricao:'#E0055 — Relatório produtos x dados fiscais' },

    // ══════════════════════════════════════════
    // TOTVS — Configuração PDV
    // ══════════════════════════════════════════
    { id:115, nome:'Retirar Opção à Vista e Parcelado do PDV',          url:'https://docs.google.com/document/d/116R1lImqUHyWHtDP7CtdqauUpAjb8SCb3d2yVTp28WI/edit?usp=drive_link',       grupo:'Totvs — Config PDV', tipo:'manual', descricao:'#E0011 — Retirar opções de pagamento do PDV' },
    { id:116, nome:'Implantação Lojas Novas — Totvs',                   url:'https://docs.google.com/document/d/1w7l-oledhgMoBbYEj2HOlhWTGv8s-AKfIRaJVaWpjkA/edit?tab=t.0',              grupo:'Totvs — Config PDV', tipo:'manual', descricao:'#E0064 — Implantação de lojas novas no Totvs' },

    // ══════════════════════════════════════════
    // TOTVS — Informações
    // ══════════════════════════════════════════
    { id:117, nome:'Contatos do Suporte Chef/Food e TEF',               url:'https://docs.google.com/document/d/1t4072xywQc0ZH4zYpquGvGDApsu46x5DDsTP78OM9xU/edit?usp=sharing',           grupo:'Totvs — Informações', tipo:'manual', descricao:'#E0052 — Contatos suporte Chef/Food e TEF' },
    { id:118, nome:'Custo de Implantação Loja Nova',                    url:'https://docs.google.com/document/d/1Zo6SOtow65Lppy0m59x_Um8JHtenJ19J3_bqKYLKKUo/edit?usp=sharing',           grupo:'Totvs — Informações', tipo:'manual', descricao:'#E0053 — Custo de implantação loja nova' },
    { id:119, nome:'Custo implantação loja com troca de sistema',       url:'https://docs.google.com/document/d/1AZDz9crlDaWRPP-TdcD05KLCYqDc0HcVE7lpoSZNTdY/edit?usp=sharing',           grupo:'Totvs — Informações', tipo:'manual', descricao:'#E0054 — Custo troca de sistema (ex: vindo de Linx)' },

    // ══════════════════════════════════════════
    // LINX — Cadastro
    // ══════════════════════════════════════════
    { id:201, nome:'Cadastro de Produto',                               url:'https://drive.google.com/file/d/1dSTUePS0K6QWd0GuMTb_mk2Q60fF4Yzg/view?usp=drive_link',                       grupo:'Linx — Cadastro', tipo:'drive',  descricao:'#V0012 — Cadastro de produto (vídeo)' },
    { id:202, nome:'Cadastrar Usuário Degust Web',                      url:'https://docs.google.com/document/d/1uW8ca_ZyzfAyUyygdtdZwTBnoL2QvW70GJp9uCSyss0/edit?usp=drive_link',        grupo:'Linx — Cadastro', tipo:'manual', descricao:'#E0013 — Cadastrar usuário no Degust Web' },
    { id:203, nome:'Cadastrar Caixa PDV',                               url:'https://docs.google.com/document/d/1aBbxM-kTs9ThdnmGmK_A-wENAL7qqFlc05cj8qE9EOM/edit?usp=drive_link',        grupo:'Linx — Cadastro', tipo:'manual', descricao:'#E0014 — Cadastrar caixa PDV na Linx' },
    { id:204, nome:'Criação de Ambiente Loja',                          url:'https://drive.google.com/file/d/1k6AWEvLs5toOjCo3KYmKOqKyFkN4na6E/view?usp=drive_link',                       grupo:'Linx — Cadastro', tipo:'drive',  descricao:'#V0015 — Criação de ambiente loja (vídeo)' },

    // ══════════════════════════════════════════
    // LINX — Consulta
    // ══════════════════════════════════════════
    { id:205, nome:'Lista de Relatórios mais Utilizados',               url:'https://docs.google.com/document/d/1Vtj5JjmIZj-n4NWofmQuHspP9bIgSmwk1EkKM3vwXbs/edit?usp=drive_link',        grupo:'Linx — Consulta', tipo:'manual', descricao:'#E0016 — Relatórios mais usados na Linx' },

    // ══════════════════════════════════════════
    // LINX — Fiscal
    // ══════════════════════════════════════════
    { id:206, nome:'Dados Fiscais Produtos',                            url:'https://drive.google.com/file/d/10_8UlZR0FL_cXs6lSKkCvit9FvHATkVY/view?usp=drive_link',                       grupo:'Linx — Fiscal', tipo:'drive',  descricao:'#V0017 — Dados fiscais de produtos (vídeo)' },
    { id:207, nome:'Troca Regime Fiscal',                               url:'https://docs.google.com/document/d/19rjbN4WeoGaYm48-uSS4zdMqWMjyVEmJVrznNHQSxrw/edit?usp=drive_link',        grupo:'Linx — Fiscal', tipo:'manual', descricao:'#E0018 — Troca regime fiscal Linx' },
    { id:208, nome:'Dados Fiscais Produtos — Loja',                     url:'https://docs.google.com/document/d/1uxbGyw8Y03A26pf35oJpIUjHCpIzC5UsYR0mMQh366M/edit?usp=sharing',           grupo:'Linx — Fiscal', tipo:'manual', descricao:'#E0060 — Dados fiscais produtos por loja' },

    // ══════════════════════════════════════════
    // LINX — Configuração PDV
    // ══════════════════════════════════════════
    { id:209, nome:'Forçar Atualização PDV',                            url:'https://docs.google.com/document/d/1FxphTwgem_aJDnJC6IHlsJeKBotF8ZjMxTCxM1t_7Fk/edit?usp=drive_link',       grupo:'Linx — Config PDV', tipo:'manual', descricao:'#E0019 — Forçar atualização do PDV Linx' },
    { id:210, nome:'Implantações — Novas Lojas Linx',                   url:'https://docs.google.com/document/d/1WtLXLS3Ql_LhM5fBWPgq2zEvTrjyq9jzaco8H6c76QI/edit?usp=sharing',           grupo:'Linx — Config PDV', tipo:'manual', descricao:'#E0065 — Implantação de novas lojas Linx' },
    { id:211, nome:'Alteração de Preço — Frente de Caixa Linx',        url:'https://docs.google.com/document/d/11_m6YghgeTGFvlv9838nt8flNntNleEk4pzDqQRQMPs/edit?usp=sharing',           grupo:'Linx — Config PDV', tipo:'manual', descricao:'#E0072 — Alteração de preço frente de caixa' },

    // ══════════════════════════════════════════
    // LINX — Informações
    // ══════════════════════════════════════════
    { id:212, nome:'Contatos do Suporte Degust e TEF',                  url:'https://docs.google.com/document/d/1-ch2QriFECHm9KkCNwyAmim8402b0P5pECoupt1NjGM/edit?usp=sharing',           grupo:'Linx — Informações', tipo:'manual', descricao:'#E0049 — Contatos suporte Degust e TEF' },
    { id:213, nome:'Custo de implantação loja nova Linx',               url:'https://docs.google.com/document/d/1vqjRgMi2cXlHuz_D02CErIKPX0GlRXyjOLgqiXpGiLI/edit?usp=sharing',           grupo:'Linx — Informações', tipo:'manual', descricao:'#E0051 — Custo de implantação loja nova Linx' },

    // ══════════════════════════════════════════
    // SWFAST — Retaguarda
    // ══════════════════════════════════════════
    { id:301, nome:'Treinamento Geral Retaguarda',                      url:'https://drive.google.com/file/d/1GqUouERS_v3Rr8ES5Sef1xoHwgnkpvZ8/view?usp=drive_link',                       grupo:'SwFast — Retaguarda', tipo:'drive',  descricao:'#V0071 — Treinamento geral retaguarda (vídeo)' },
    { id:302, nome:'Alterar Preço SW',                                  url:'https://docs.google.com/document/d/1ejM1ofl5DLAiplBk6eLDvCHsSXIxrsgLackrXWscPw0/edit?usp=sharing',           grupo:'SwFast — Retaguarda', tipo:'manual', descricao:'#E0073 — Alterar preço no SW' },
    { id:303, nome:'Dados Fiscais SW',                                  url:'https://docs.google.com/document/d/1rGuApebgdjKC11wH-yrp0mJijR7Fz1lgnYiE5fUEfgI/edit?usp=sharing',           grupo:'SwFast — Retaguarda', tipo:'manual', descricao:'#E0074 — Dados fiscais no SW' },
    { id:304, nome:'Canais de Suporte',                                 url:'https://docs.google.com/document/d/15Dnzflzi7jj4O5NGgSdnOxaBgtBSHmLARf5DV6f44EE/edit?usp=sharing',           grupo:'SwFast — Retaguarda', tipo:'manual', descricao:'#E0068 — Canais de suporte SwFast' },
    { id:305, nome:'Relatórios Mais úteis',                             url:'https://docs.google.com/document/d/1QUJj8S5owewWSYFfOo5JiCTYvw0kN2WaiyPo6i4nqE8/edit?usp=sharing',           grupo:'SwFast — Retaguarda', tipo:'manual', descricao:'#E0070 — Relatórios mais úteis SwFast' },
    { id:306, nome:'Custo e contato comercial',                         url:'https://docs.google.com/document/d/1T-uCpcbJnXeZsktDA1S7kEnERczvbnTbsBh6NdcDTvc/edit?usp=sharing',           grupo:'SwFast — Retaguarda', tipo:'manual', descricao:'#E0069 — Custo e contato comercial SwFast' },
    { id:307, nome:'Verificar Fechamentos de Caixa',                    url:'https://docs.google.com/document/d/1lgR9-UVVUJC_dhL3lK93gtv_JXPoir5GUy1VViZfngM/edit?usp=sharing',           grupo:'SwFast — Retaguarda', tipo:'manual', descricao:'#E0076 — Verificar fechamentos de caixa' },
    { id:308, nome:'Contratar SWFast — Loja',                          url:'https://docs.google.com/document/d/18BPaUX5Fv3Fh8SoPi2GptsoLSb5YH2oUOyGjkOI74tk/edit?usp=sharing',           grupo:'SwFast — Retaguarda', tipo:'manual', descricao:'#E0079 — Como contratar SwFast para loja' },
    { id:309, nome:'Preencher dados fiscais',                           url:'https://docs.google.com/document/d/1-Ii9HKB_Y0VHTCKGogKJdC69CiSz-vzoscSIeLWwx4w/edit?usp=sharing',           grupo:'SwFast — Retaguarda', tipo:'manual', descricao:'#E0080 — Preencher dados fiscais SwFast' },

    // ══════════════════════════════════════════
    // SWFAST — Cadastros
    // ══════════════════════════════════════════
    { id:310, nome:'Cadastro de Grupos e Subgrupos SW',                 url:'https://docs.google.com/document/d/1FIYYBQ0icYjYsUUepNVPE0cFzj5BGUMIA1O8U0SXwXs/edit?usp=sharing',           grupo:'SwFast — Cadastros', tipo:'manual', descricao:'#E0076 — Cadastro de grupos e subgrupos SW' },

    // ══════════════════════════════════════════
    // SWFAST — Config PDV
    // ══════════════════════════════════════════
    { id:311, nome:'Implantações — Novas Lojas SW',                     url:'https://docs.google.com/document/d/1rdZa9aBnnCGxGJBsfOWEu3aNXiQUxHL7xx8NXen1HSw/edit?usp=sharing',           grupo:'SwFast — Config PDV', tipo:'manual', descricao:'#E0067 — Implantação de novas lojas SW' },
    { id:312, nome:'Correção Tela de caixa não abre completamente',     url:'https://docs.google.com/document/d/1vTeU9sQVNynnNqeKJB_yj2-SAn3EwoLXtANmv219DlQ/edit?usp=sharing',           grupo:'SwFast — Config PDV', tipo:'manual', descricao:'#E0082 — Correção da tela de caixa SW' },

    // ══════════════════════════════════════════
    // TEF
    // ══════════════════════════════════════════
    { id:401, nome:'Liberar Vendas paradas no Sitef',                   url:'https://docs.google.com/document/d/1t7mz3SsfAqildUFiA93lJIv0Uklo_1V4sqp654P-EyQ/edit?tab=t.0',              grupo:'TEF', tipo:'manual', descricao:'#E0081 — Liberar vendas paradas no Sitef' },

    // ══════════════════════════════════════════
    // CENTRAL (TI Geral) — Manutenção
    // ══════════════════════════════════════════
    { id:501, nome:'Ativando Office e Windows',                         url:'https://docs.google.com/document/d/1kH3hO-3NiByowWE0Q9AGUgR2a-bzD93-OFIq7SNh93Q/edit?usp=sharing',           grupo:'Central — Manutenção', tipo:'manual', descricao:'#E0020 — Ativar Office e Windows' },
    { id:502, nome:'Instalar Impressora',                               url:'https://docs.google.com/document/d/12e1K6IP73WSlZazWEHTGx-uC5ARPQ-wx4Eel7cWt7Q0/edit?usp=sharing',           grupo:'Central — Manutenção', tipo:'manual', descricao:'#E0021 — Instalação de impressora' },
    { id:503, nome:'Arquivos Usados Com Frequência',                    url:'https://docs.google.com/document/d/1Idvli-79KvXhgN6cbdHAB7qZhjAZvnEnWxWlHzkjpAU/edit?usp=sharing',           grupo:'Central — Manutenção', tipo:'manual', descricao:'#E0022 — Arquivos usados com frequência' },
    { id:504, nome:'Instalação Certificado A1',                         url:'https://docs.google.com/document/d/1F2NiqFP-mN1WJhIk3TJYLGmlvsxsZ4_HF1UNpbjIyl8/edit?usp=drive_link',       grupo:'Central — Manutenção', tipo:'manual', descricao:'#E0023 — Instalação do certificado A1' },

    // ══════════════════════════════════════════
    // CENTRAL — Cadastro
    // ══════════════════════════════════════════
    { id:505, nome:'Manual — Cadastro de Biometria',                    url:'https://docs.google.com/document/d/1VoyW5qW4XO4aR6tvRzossKN41q4uZ3jgJspc8RZnJ3w/edit?usp=drive_link',       grupo:'Central — Cadastro', tipo:'manual', descricao:'#E0024 — Cadastro de biometria' },
    { id:506, nome:'Manual — Cadastro Key Access (Catracas QR Code)',   url:'https://docs.google.com/document/d/1o4w_n_t_3iWEHP7WliLNXUcLeLbbygkd0SgLrDC9eFQ/edit?usp=sharing',           grupo:'Central — Cadastro', tipo:'manual', descricao:'#E0047 — Cadastro Key Access catracas' },
    { id:507, nome:'Comodatos — notebooks e celulares',                 url:'https://docs.google.com/document/d/1A_Drc1h9cobPFsfo_tNVHWFIiS2vwf_0H0Rcvjgwwa4/edit?usp=sharing',           grupo:'Central — Cadastro', tipo:'manual', descricao:'#E0059 — Controle de comodatos' },
    { id:508, nome:'Transferir conteúdo de conta Google',               url:'https://docs.google.com/document/d/1mGi97KrV640G9F-Lkzx56HutqjWuyjNq-7zRCc_cjsg/edit?usp=sharing',           grupo:'Central — Cadastro', tipo:'manual', descricao:'#E0064 — Transferir conta Google entre colaboradores' },
    { id:509, nome:'Novo colaborador — Cadastro Google e Sults',        url:'https://docs.google.com/document/d/1xA-SWOpll6CE6ttBX-YqK-XeCSj0nhbiuPusvwtMbsU/edit?usp=sharing',           grupo:'Central — Cadastro', tipo:'manual', descricao:'#E0066 — Cadastro de novo colaborador' },

    // ══════════════════════════════════════════
    // CENTRAL — Rotinas
    // ══════════════════════════════════════════
    { id:510, nome:'Faturamento Mensal ★',                              url:'https://docs.google.com/document/d/1naeFKmP_vF1uA99qn_vIKncj3Vu1_MvaSGThBqkO9gU/edit?usp=sharing',           grupo:'Central — Rotinas', tipo:'manual', descricao:'#E0036 — Faturamento mensal' },
    { id:511, nome:'Relatório de Lojas x Sistemas (envio mensal)',      url:'https://dvsi.com.br/siscad/siscad/Presentation/teste.php',                                                    grupo:'Central — Rotinas', tipo:'sistema', descricao:'#E0037 — Link do relatório mensal de lojas x sistemas' },

    // ══════════════════════════════════════════
    // CENTRAL — Infra e Softwares
    // ══════════════════════════════════════════
    { id:512, nome:'Empresas e informações de Links de Telecom ★',     url:'https://docs.google.com/document/d/1lc44nIinMZpGTJRhRoYuh1-yrhLYoOzBHje5OWvsAnE/edit?usp=sharing',           grupo:'Central — Infra', tipo:'manual',   descricao:'#E0041 — Links de telecom por empresa' },
    { id:513, nome:'Prestadores de Serviço Central e Loja ★',          url:'https://docs.google.com/document/d/1Ow_2RQg62BUeqKq0FqbAVrcmJO_O5KRsmauxqFrUPXo/edit?usp=sharing',           grupo:'Central — Infra', tipo:'manual',   descricao:'#E0042 — Prestadores de serviço' },
    { id:514, nome:'Acesso às Câmeras',                                 url:'https://docs.google.com/spreadsheets/d/14qxlpmSrFi6HHhW_-kMMZNC2JefX44I6g8j572gwpHI/edit?usp=sharing',       grupo:'Central — Infra', tipo:'planilha', descricao:'#E0043 — Planilha de acesso às câmeras' },
    { id:515, nome:'Lista de Comodatos Colaboradores e Externos',       url:'https://docs.google.com/spreadsheets/d/1pbJCNgIsUAobTE2lmOdHaqjmXHxfirJw/edit?usp=sharing',                   grupo:'Central — Infra', tipo:'planilha', descricao:'#E0044 — Lista de comodatos' },
    { id:516, nome:'Lista de Ramais Digitais 11-3811-1560',             url:'https://docs.google.com/spreadsheets/d/1kxHm3bU4MJFUm9O6DX0ljRxo6Dxy8oYEian1izYudNA/edit?usp=sharing',       grupo:'Central — Infra', tipo:'planilha', descricao:'#E0045 — Ramais digitais' },

    // ══════════════════════════════════════════
    // IMPLANTAÇÕES LOJAS NOVAS
    // ══════════════════════════════════════════
    { id:601, nome:'Lista de Equipamentos Totvs e Linx',                url:'https://docs.google.com/document/d/1EMe3uSSFKQwYx4itKxhTIyGkX8gCVmyreK_o-EVFxAw/edit?usp=sharing',           grupo:'Implantações — Infraestrutura', tipo:'manual', descricao:'#E0031 — Lista de equipamentos Totvs e Linx' },
    { id:602, nome:'CheckList Implantação — TI',                        url:'https://docs.google.com/document/d/1_mZQ6vqHpotbKyr0Ftwh8OwCq3afTGpiWG3lwQ4Eo4Q/edit?usp=drive_link',       grupo:'Implantações — Checklists', tipo:'manual', descricao:'#E0025 — Checklist de implantação TI' },
    { id:603, nome:'Checklist Implantação — Loja',                      url:'https://docs.google.com/document/d/1ihELLDk8VGyIcSEPjd84_cdq3KYHf4chW212uAK6i0M/edit?usp=drive_link',       grupo:'Implantações — Checklists', tipo:'manual', descricao:'#E0026 — Checklist de implantação loja' },
    { id:604, nome:'Liberar Dossiê de Vendas Lojas Novas',              url:'https://docs.google.com/document/d/1iYCjQQKTm0h-4Uj_J8VdW2ppRPminDQMPY7IX7NFYuw/edit?usp=drive_link',       grupo:'Implantações — Relatórios', tipo:'manual', descricao:'#E0027 — Liberar dossiê de vendas' },

    // ══════════════════════════════════════════
    // ERP
    // ══════════════════════════════════════════
    { id:701, nome:'Entrada de Notas — Correção de vínculo de produtos', url:'https://drive.google.com/file/d/1k_crVhoy-Hq0GzTW7bXqt513iAlMCkSD/view?usp=sharing',                        grupo:'ERP — Financeiro', tipo:'drive',  descricao:'#V0057 — Correção de vínculo de produtos (vídeo)' },
    { id:702, nome:'Lançamento de Contagem de Cofre — Perfil Franqueado', url:'https://docs.google.com/document/d/1Me3gnPvdA2P7Nj7-WLnOpzgHQ6nb1-',                                      grupo:'ERP — Financeiro', tipo:'manual', descricao:'#E0062 — Lançamento contagem de cofre' },
];

// ── Helpers cache local ────────────────────────────────────────────────────────
function lerLinksCache() {
    try { if (!fs.existsSync(DATA_FILE)) return null; return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch { return null; }
}
function salvarLinksCache(links) {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(links, null, 2)); }
    catch (e) { console.error('[links-cache]', e.message); }
}
function getLinksCache() {
    const salvo = lerLinksCache();
    if (salvo) {
        const ids = new Set(salvo.map(l => l.id));
        const novos = LINKS_INICIAIS.filter(l => !ids.has(l.id));
        if (novos.length) { const merged = [...salvo, ...novos]; salvarLinksCache(merged); return merged; }
        return salvo;
    }
    salvarLinksCache(LINKS_INICIAIS);
    return LINKS_INICIAIS;
}
function proximoId(links) { return links.length ? Math.max(...links.map(l => l.id)) + 1 : 1; }
function detectarTipo(url) {
    if (!url) return 'link';
    const u = url.toLowerCase();
    if (u.includes('docs.google.com/spreadsheets')) return 'planilha';
    if (u.includes('docs.google.com/document'))     return 'manual';
    if (u.includes('docs.google.com/presentation')) return 'apresentacao';
    if (u.includes('docs.google.com/forms'))        return 'formulario';
    if (u.includes('drive.google.com'))              return 'drive';
    return 'sistema';
}
function formatarDataBR(iso) {
    if (!iso) return new Date().toLocaleDateString('pt-BR');
    return new Date(iso).toLocaleDateString('pt-BR');
}

// ── Google Sheets helpers ──────────────────────────────────────────────────────

// Lê todos os links da planilha (linhas 2+; linha 1 é cabeçalho)
// Retorna array de { id, nome, url, tipo, criadoEm, grupo }
async function lerLinksSheet() {
    try {
        const sheets = await getSheetClient();
        const resp = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_TAB}!A:F`,
        });
        const rows = resp.data.values || [];
        if (rows.length <= 1) return []; // só cabeçalho ou vazio
        return rows.slice(1).filter(r => r[0]).map((r, i) => ({
            id:        parseInt(r[5]) || (i + 1),
            nome:      r[0] || '',
            url:       r[1] || '',
            tipo:      r[2] || 'link',
            criadoEm:  r[3] || new Date().toISOString(),
            grupo:     r[4] || 'Outros',
            descricao: '',
        }));
    } catch (e) {
        console.error('[links-sheet] Erro ao ler planilha:', e.message);
        return null; // null = falha na leitura
    }
}

// Reescreve TODA a aba com os links fornecidos (preserva cabeçalho)
async function salvarTodosLinksSheet(links) {
    const sheets = await getSheetClient();

    // Garante cabeçalho
    const header = [['Nome do Link', 'Link', 'Tipo', 'Data de Insert', 'Grupo', 'ID']];
    const rows = links.map(l => [
        l.nome      || '',
        l.url       || '',
        l.tipo      || 'link',
        formatarDataBR(l.criadoEm),
        l.grupo     || 'Outros',
        String(l.id || ''),
    ]);

    await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_TAB}!A:F`,
    });

    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_TAB}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [...header, ...rows] },
    });
}

// Adiciona uma única linha no final da planilha
async function appendLinkSheet(link) {
    const sheets = await getSheetClient();
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_TAB}!A:F`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
            values: [[
                link.nome      || '',
                link.url       || '',
                link.tipo      || 'link',
                formatarDataBR(link.criadoEm),
                link.grupo     || 'Outros',
                String(link.id || ''),
            ]],
        },
    });
}

// Função principal: retorna links priorizando planilha
// Se planilha vazia → auto-popula com seed (sem precisar de botão)
async function getLinks() {
    const sheetLinks = await lerLinksSheet();
    if (sheetLinks !== null && sheetLinks.length > 0) {
        salvarLinksCache(sheetLinks);
        return sheetLinks;
    }
    const cacheLinks = getLinksCache();
    if (sheetLinks !== null && sheetLinks.length === 0) {
        // Planilha acessível mas vazia → auto-popula imediatamente
        console.log('[links] Planilha vazia detectada — populando automaticamente com', cacheLinks.length, 'links...');
        try {
            await salvarTodosLinksSheet(cacheLinks);
            console.log('[links] ✅ Planilha populada automaticamente com', cacheLinks.length, 'links.');
        } catch (e) {
            console.error('[links] ❌ Erro ao auto-popular planilha:', e.message);
        }
    }
    return cacheLinks;
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// GET /links/ — retorna todos
router.get('/', async (req, res) => {
    try {
        const links  = await getLinks();
        const grupos = {};
        links.forEach(l => { const g = l.grupo || 'Outros'; if (!grupos[g]) grupos[g] = []; grupos[g].push(l); });
        res.json({ ok: true, links, grupos, total: links.length });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// POST /links/ — cria novo link (cache + planilha)
router.post('/', async (req, res) => {
    try {
        const { nome, url, descricao, grupo } = req.body;
        if (!nome || !url) return res.json({ ok: false, erro: 'nome e url são obrigatórios.' });
        const links = getLinksCache();
        const novo  = {
            id:        proximoId(links),
            nome:      nome.trim(),
            url:       url.trim(),
            tipo:      req.body.tipo || detectarTipo(url),
            grupo:     (grupo || 'Outros').trim(),
            descricao: (descricao || '').trim(),
            criadoEm:  new Date().toISOString(),
        };
        links.push(novo);
        salvarLinksCache(links);
        // Adiciona na planilha
        try { await appendLinkSheet(novo); }
        catch (e) { console.warn('[links] Não foi possível salvar na planilha:', e.message); }
        res.json({ ok: true, link: novo });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// PATCH /links/:id — edita
router.patch('/:id', async (req, res) => {
    try {
        const id    = parseInt(req.params.id);
        const links = getLinksCache();
        const idx   = links.findIndex(l => l.id === id);
        if (idx < 0) return res.json({ ok: false, erro: 'Link não encontrado.' });
        ['nome','url','tipo','grupo','descricao'].forEach(k => { if (req.body[k] !== undefined) links[idx][k] = req.body[k]; });
        links[idx].atualizadoEm = new Date().toISOString();
        salvarLinksCache(links);
        // Reescreve planilha
        try { await salvarTodosLinksSheet(links); }
        catch (e) { console.warn('[links] Não foi possível atualizar planilha:', e.message); }
        res.json({ ok: true, link: links[idx] });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// DELETE /links/:id
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        let links = getLinksCache();
        const antes = links.length;
        links = links.filter(l => l.id !== id);
        if (links.length === antes) return res.json({ ok: false, erro: 'Link não encontrado.' });
        salvarLinksCache(links);
        try { await salvarTodosLinksSheet(links); }
        catch (e) { console.warn('[links] Não foi possível atualizar planilha:', e.message); }
        res.json({ ok: true });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// GET /links/grupos
router.get('/grupos', async (req, res) => {
    try {
        const links  = await getLinks();
        const grupos = [...new Set(links.map(l => l.grupo || 'Outros'))].sort();
        res.json({ ok: true, grupos });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

// POST /links/sincronizar
// Comportamento: lê da planilha (se tiver dados) OU popula com seed,
// sempre garantindo planilha atualizada ao final
router.post('/sincronizar', async (req, res) => {
    try {
        // 1. Garante que cache local tem o seed completo
        const cacheLinks = getLinksCache();

        // 2. Verifica planilha
        const sheetLinks = await lerLinksSheet();

        let linksFinais;
        if (sheetLinks !== null && sheetLinks.length > 0) {
            // Planilha já tem dados → usa ela como fonte de verdade
            salvarLinksCache(sheetLinks);
            linksFinais = sheetLinks;
            console.log('[links] Sincronizar: planilha tinha', sheetLinks.length, 'links, usando como fonte.');
        } else {
            // Planilha vazia ou inacessível → escreve o seed na planilha
            linksFinais = cacheLinks;
            await salvarTodosLinksSheet(cacheLinks);
            console.log('[links] Sincronizar: planilha vazia → populada com', cacheLinks.length, 'links do seed.');
        }

        res.json({ ok: true, total: linksFinais.length, msg: `Sincronizado: ${linksFinais.length} links na planilha.` });
    } catch (e) {
        console.error('[links] Erro no sincronizar:', e.message);
        // Mesmo com erro na planilha, retorna os dados do cache
        const fallback = getLinksCache();
        res.json({ ok: true, total: fallback.length, msg: `Cache: ${fallback.length} links (planilha indisponível: ${e.message})` });
    }
});

// POST /links/popular-planilha — força re-seed completo (mantido para compatibilidade)
router.post('/popular-planilha', async (req, res) => {
    try {
        salvarLinksCache(LINKS_INICIAIS);
        await salvarTodosLinksSheet(LINKS_INICIAIS);
        console.log('[links] popular-planilha: seed completo gravado.', LINKS_INICIAIS.length, 'links.');
        res.json({ ok: true, total: LINKS_INICIAIS.length, msg: `Planilha populada com ${LINKS_INICIAIS.length} links.` });
    } catch (e) { res.json({ ok: false, erro: e.message }); }
});

module.exports = router;