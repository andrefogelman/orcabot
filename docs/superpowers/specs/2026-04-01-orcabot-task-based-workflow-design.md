# OrcaBot — Task-Based Workflow Design Spec

Mudança no modelo de operação: de processamento autônomo em lote para workflow guiado pelo usuário, um arquivo de cada vez, via chat.

## Contexto

**Antes (v1 — autônomo):** Usuário sobe todos os PDFs de uma vez → sistema processa tudo automaticamente → entrega planilha pronta. Problemas: falta de controle, erros se acumulam, difícil saber o que o sistema fez.

**Agora (task-based):** Usuário interage com o agente orçamentista via chat, um arquivo de cada vez. O agente guia o processo, pede confirmações, e o usuário tem controle total do ritmo e das decisões.

## Filosofia

O orçamentista digital trabalha como um orçamentista humano:
1. Recebe um arquivo
2. Analisa, pergunta dúvidas
3. Extrai quantidades, mostra ao cliente
4. Cliente valida ou corrige
5. Só então avança para o próximo arquivo

O chat é a interface principal. A planilha é o resultado construído incrementalmente.

## Fluxo de Trabalho

```
1. Usuário cria projeto (premissas: UF, tipo obra, Adm% padrão)
2. Usuário abre o chat com o Orçamentista
3. Usuário sobe UM arquivo (PDF, DWG ou DXF)
4. Orçamentista analisa:
   - "Recebi o arquivo ARQ-01-PLANTA-BAIXA.pdf"
   - "Identifiquei: planta baixa do pavimento térreo"
   - "Encontrei 8 ambientes. Vou listar os quantitativos:"
   - [mostra tabela com áreas, perímetros, acabamentos]
   - "Está correto? Alguma correção?"
5. Usuário revisa e ajusta no chat:
   - "A área da sala é 20m², não 18.5"
   - "O piso da cozinha é porcelanato 80x80, não 60x60"
6. Orçamentista corrige e confirma
7. Orçamentista pergunta: "Posso adicionar esses itens à planilha?"
8. Usuário confirma → itens entram na planilha
9. Orçamentista: "Pronto. Próximo arquivo?"
10. Usuário sobe o próximo arquivo → repete o ciclo
```

## Modelo de Tasks

Cada interação arquivo → quantitativo → planilha é uma **task** rastreável.

### Tabela: ob_tasks

```sql
CREATE TABLE ob_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES ob_projects(id) ON DELETE CASCADE,
  file_id uuid REFERENCES ob_project_files(id),
  tipo text NOT NULL CHECK (tipo IN (
    'analisar_arquivo',      -- processar PDF/DWG e extrair quantidades
    'revisar_quantitativos', -- usuário revisando itens extraídos
    'adicionar_planilha',    -- confirmar e inserir itens no orçamento
    'buscar_precos',         -- buscar preços SINAPI/mercado para itens
    'calcular_subtotais',    -- recalcular subtotais e Adm
    'exportar',              -- gerar Excel
    'consulta_geral'         -- pergunta livre ao agente
  )),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'waiting_user', 'completed', 'cancelled')),
  input jsonb NOT NULL DEFAULT '{}',
  output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
```

### Estados de uma task

```
pending → in_progress → waiting_user → in_progress → completed
                                    ↘ cancelled
```

- **pending**: task criada, aguardando processamento
- **in_progress**: agente trabalhando (processando PDF, extraindo dados)
- **waiting_user**: agente terminou, aguarda validação/resposta do usuário
- **completed**: usuário confirmou, dados gravados
- **cancelled**: usuário cancelou ou pulou

## Comportamento do Agente Orçamentista

### Ao receber um arquivo

1. Cria task tipo `analisar_arquivo`
2. Processa via pdf-pipeline ou dwg-pipeline
3. Apresenta resultado no chat:
   - Tipo de prancha identificado
   - Lista de ambientes/elementos encontrados
   - Quantidades extraídas em formato tabular
   - Itens de baixa confiança destacados
4. Muda task para `waiting_user`
5. Aguarda resposta do usuário

### Ao receber correção do usuário

1. Atualiza os dados corrigidos
2. Mostra versão corrigida
3. Pergunta: "Está correto agora?"
4. Se sim → cria task `adicionar_planilha`

### Ao confirmar adição à planilha

1. Insere itens em `ob_quantitativos` e `ob_orcamento_items`
2. Recalcula subtotais
3. Mostra resumo: "Adicionados X itens. Custo parcial da obra: R$ Y"
4. Pergunta: "Próximo arquivo?"

### Ao receber pergunta livre

1. Cria task tipo `consulta_geral`
2. Responde usando contexto do projeto (premissas, quantitativos já levantados)
3. Exemplos:
   - "Qual o custo SINAPI para alvenaria de vedação?"
   - "Quanto temos acumulado na etapa 06?"
   - "Qual a área total de piso cerâmico?"

### Comandos especiais no chat

| Comando | Ação |
|---------|------|
| "próximo" / "next" | Aguarda próximo arquivo |
| "refazer" / "redo" | Reprocessa último arquivo |
| "pular" / "skip" | Cancela task atual, pula para próximo |
| "resumo" | Mostra resumo acumulado da planilha |
| "exportar" | Gera Excel com o estado atual |
| "preços" | Busca preços SINAPI para itens sem preço |
| "delegar estrutural" | Envia para agente estrutural |
| "delegar hidráulico" | Envia para agente hidráulico |
| "delegar elétrico" | Envia para agente eletricista |

## Formato das Mensagens do Agente

### Ao apresentar quantitativos

```
📋 Análise: ARQ-01-PLANTA-BAIXA.pdf
Tipo: Planta Baixa — Pavimento Térreo
Confiança geral: 92%

┌─────────────┬──────────┬──────────┬────────┬───────────────────────┐
│ Ambiente     │ Área m²  │ Perim. m │ PD m   │ Piso                  │
├─────────────┼──────────┼──────────┼────────┼───────────────────────┤
│ Sala         │ 18.50    │ 17.40    │ 2.80   │ porcelanato 60x60     │
│ Cozinha      │ 12.30    │ 14.20    │ 2.80   │ porcelanato 60x60     │
│ Quarto 1     │ 11.00    │ 13.40    │ 2.80   │ laminado              │
│ Banheiro     │ 4.20     │ 8.40     │ 2.50   │ cerâmico 30x30       │
└─────────────┴──────────┴──────────┴────────┴───────────────────────┘

⚠️ Item para revisão:
  - Banheiro: cota de largura ilegível (confiança 45%)

Está correto? Alguma correção?
```

### Ao confirmar adição

```
✅ 4 ambientes adicionados à planilha

Resumo parcial:
  Etapa 09 — Revestimento de Pisos: R$ 0 (preços pendentes)
  Etapa 11 — Pintura: R$ 0 (preços pendentes)

Custo direto acumulado: R$ 0 (sem preços ainda)
Próximo arquivo?
```

## Delegação para Especialistas

Quando o usuário sobe uma prancha de disciplina específica (estrutural, hidráulica, elétrica), o orçamentista pode:

1. Processar sozinho (levantamento básico) — padrão
2. Delegar para o especialista se o usuário pedir ("delegar estrutural")
3. O especialista analisa e retorna quantitativos ao orçamentista
4. Orçamentista apresenta ao usuário para validação

A delegação é **explícita** (o usuário pede), não automática. O orçamentista sempre pode fazer um levantamento básico sozinho.

## Mudanças Necessárias

### Backend
- Nova tabela `ob_tasks` (migration)
- Modificar fluxo do orçamentista: de batch processing para conversacional
- Chat precisa ter estado (qual task está ativa, qual arquivo está sendo analisado)
- Agente precisa saber "pausar" e aguardar resposta do usuário

### Frontend
- Chat sidebar vira a interface principal (não mais secondary)
- Upload de arquivo pode ser feito direto no chat (drag-and-drop no chat input)
- Task tracker: barra lateral mostrando tasks do projeto (pending, in_progress, completed)
- Planilha atualiza em tempo real conforme tasks são completadas

### Agentes
- Orçamentista: reformular CLAUDE.md para workflow conversacional
- Remover lógica de processamento em lote
- Adicionar context tracking (qual task ativa, qual arquivo, quais itens pendentes)

## O Que NÃO Muda

- PDF pipeline (continua processando, mas agora triggered por task)
- DWG pipeline (idem)
- Formato da planilha (mesmo ANF)
- Export Excel
- Base SINAPI
- Agentes especialistas (estrutural, hidráulico, eletricista)
- Modelo de dados de quantitativos e orçamento
- RLS e auth
