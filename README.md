# QMS Quebra · Gestão de Turno

Aplicativo web (PWA) para conduzir o **turno inteiro** da Quebra de Canais e Jato da Fundição, em substituição ao preenchimento manual da planilha QMS. Funciona no celular, no tablet e no computador, offline, e gera o arquivo oficial `.xlsx` exatamente no layout do modelo da Qualidade.

> Planilha oficial: `Itens Quebra de Canal_2º Turno-WGerett.xlsx` — aba **PRODUÇÃO DIÁRIA QMS**.

---

## O que o app faz

- **Preenchimento guiado em 6 etapas**: identificação do turno, produção, refugo, paradas, acabamento e revisão.
- **Turno completo**: as 4 máquinas da área em um único registro — HWS-01 (linhas 01 e 02), HWS-02 (linhas 03 e 04), HUNTER (linha 02) e EUROMAQ (linha 01).
- **Autosave** em IndexedDB conforme se digita; pode fechar o app e continuar depois.
- **Validação em tempo real** com erros que bloqueiam a exportação e avisos que apenas alertam.
- **Pendências explícitas** na revisão (item, quantidade, motivo etc.).
- **Exportação fiel** ao modelo: mesclagens, cores, bordas, larguras, fórmulas e nome do arquivo preservados.
- **Compartilhamento** do `.xlsx` pelo menu nativo do celular (Teams, e-mail, WhatsApp).
- **Backup e restauração** de todos os turnos em JSON.
- **Registros** com busca, filtro por período, duplicação e exclusão.
- **Instalável** na tela inicial e funcional sem internet após o primeiro acesso.

---

## Regras de preenchimento

| Regra | Comportamento |
|---|---|
| Datas | `DD/MM/AAAA`, gravadas como **data real** do Excel |
| Quantidades | Inteiras e maiores que zero |
| Item e motivo | Convertidos para **MAIÚSCULAS** |
| Data de fusão | Texto livre, exatamente como digitado |
| Motivo de refugo ausente | Exportado como `A INFORMAR` e listado nas pendências |
| Sem paradas no turno | Botão grava `SEM PARADAS` em todas as máquinas |
| Limites | 66 linhas de produção, 8 de refugo e 2 de paradas por máquina |
| Parcial | Soma acumulada do mesmo item na máquina (cálculo por botão) |
| Dados inventados | Nunca — células vazias permanecem vazias |

### Mapa da planilha

| Conteúdo | Células |
|---|---|
| Segurança (dias sem acidentes) | `A2` |
| Produção HWS-01 | `B5:F70` |
| Produção HWS-02 | `H5:L70` |
| Produção HUNTER | `N5:R70` |
| Produção EUROMAQ | `T5:X70` |
| Refugo (4 máquinas) | linhas `73` a `80` (blocos B–F, H–L, N–R, T–X) |
| Paradas (4 máquinas) | linhas `82` e `83` |
| Caixas vazias | `E92` |
| Aramados vazios | `E95` |

---

## Como rodar localmente

Não há build nem dependências de instalação. Basta servir a pasta com qualquer servidor HTTP:

```powershell
# na raiz do projeto
python -m http.server 8123 --bind 127.0.0.1
```

Abra `http://127.0.0.1:8123/`.

> O service worker e o modo offline exigem `http://` ou `https://`; abrir o `index.html` direto pelo sistema de arquivos (`file://`) desativa o PWA.

---

## Deploy na Vercel

O projeto é 100% estático.

```powershell
npm i -g vercel   # se ainda não tiver
vercel login
vercel --prod
```

O `vercel.json` já configura cabeçalhos de cache para `sw.js`, `manifest.json` e `index.html`, garantindo atualização correta do PWA.

---

## Estrutura

```
.
├── index.html                 # 5 telas, modal, toasts e sprite SVG
├── manifest.json              # PWA: ícones, atalhos e cores
├── sw.js                      # cache do app shell + offline
├── vercel.json                # cabeçalhos de cache
├── css/
│   └── estilos.css            # design system, responsividade e acessibilidade
├── js/
│   ├── app.js                 # estado, rotas, etapas, tabelas e validações
│   ├── db.js                  # IndexedDB, backup e restauração
│   ├── export.js              # preenchimento fiel do modelo .xlsx
│   ├── modelo.js              # modelo oficial embutido em base64
│   ├── share.js               # Web Share com fallback para download
│   ├── utils.js               # datas sem fuso, números, toasts e modal
│   └── vendor/
│       └── exceljs.min.js     # geração do .xlsx (carregado sob demanda)
├── img/                       # logo, ícones PWA e favicon
└── Itens Quebra de Canal_2º Turno-WGerett.xlsx   # modelo oficial
```

---

## Dados e privacidade

- Todos os turnos ficam **somente no aparelho** (IndexedDB). Nada é enviado a servidores.
- O backup JSON é a única forma de transferir dados entre aparelhos.
- Apagar os dados do navegador também apaga os turnos — gere backup antes.

---

## Verificações já executadas

- Exportação validada com `openpyxl`: **32 mesclagens idênticas**, estilos, bordas, fontes e larguras preservados; datas como data real; itens em maiúsculas; `A INFORMAR` e `SEM PARADAS` corretos; `E92`/`E95` preenchidos.
- Testes de interface com Playwright (390×844 e 1440×900): fluxo completo das 6 etapas, parciais, pendências, download, persistência, registros, duplicação, exclusão, ajustes, backup/restauração, filtros e exportação pela tela Exportar.
- **35/35 verificações** de layout e acessibilidade: sem overflow horizontal, alvos de toque ≥ 44 px, sem truncamento e conteúdo livre da navegação fixa.
- Limites validados: 66 linhas de produção, 8 de refugo e 2 de paradas por máquina, com bloqueio do botão ao atingir o teto.
- **0 violações WCAG A/AA** no axe-core nas 5 telas.
- Zero erros de console.

---

## Tecnologias

HTML, CSS e JavaScript puros (sem framework) · IndexedDB · Service Worker · Web App Manifest · ExcelJS (vendorizado) · Web Share API.
