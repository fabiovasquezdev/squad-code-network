---
name: stitch-design-reference
description: Use before implementing or restyling any screen, page or UI component (mobile or web) in this project, whenever Stitch MCP tools are available. Pulls the project's actual design reference — screens, style tokens, layout — instead of inventing the look from scratch.
---

# Referência de design via Stitch

Antes de desenhar uma tela ou componente do zero, confira se existe uma referência real no
Stitch para esta operação (ferramentas `mcp__stitch__*`, se conectadas). Stitch guarda os
projetos de design e o estilo (`list_projects`, `get_project`, `list_screens`, `get_screen`),
mas **não gera Flutter/Dart nem o código final de nenhuma plataforma nativa** — só HTML,
screenshots e metadados de design (cores, tipografia, espaçamento, estrutura). Trate isso como
referência visual, nunca como código pronto para colar.

## Como usar

1. Se o projeto tiver um Stitch configurado, liste os projetos/telas disponíveis e procure a
   que corresponde à feature atual (pelo nome da tela, da feature ou do fluxo).
2. Leia o HTML/screenshot e os metadados de estilo (paleta, tipografia, raio de borda,
   espaçamento, hierarquia visual) — não copie o HTML literalmente.
3. Traduza essas decisões de estilo para a plataforma real do projeto:
   - **Flutter/mobile**: widgets, `ThemeData`, tokens de cor/tipografia equivalentes,
     respeitando convenções de Material/Cupertino quando fizer sentido.
   - **Web/frontend**: componentes reais do projeto (não recrie o HTML do Stitch; use-o só
     como referência de layout e estilo).
4. Se não existir referência no Stitch para esta tela, ou as ferramentas `mcp__stitch__*` não
   estiverem disponíveis, prossiga com seu próprio critério de design — não bloqueie o trabalho
   por falta de referência.
5. Nunca declare que usou uma referência do Stitch que não consultou de fato.
