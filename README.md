# Máquina Clara IA

Plataforma inicial para organizar informações de máquinas e equipamentos usados e gerar um dossiê preliminar de compra.

## O que esta versão faz
- Cadastro de tipo, marca, modelo, ano, horímetro, preço, localização e link do anúncio.
- Seleção local de fotos com pré-visualização.
- Geração de relatório preliminar baseado nos campos preenchidos.
- Lista de pontos de atenção e roteiro de inspeção presencial.
- Impressão / salvar como PDF pelo navegador.

## Limites importantes
Esta versão é um protótipo funcional de front-end. Não possui backend, autenticação, pagamentos, armazenamento remoto, consulta a bases oficiais, extração automática de anúncios ou diagnóstico por IA. O relatório é gerado localmente por regras simples e não certifica o estado do equipamento. Não insira dados pessoais sensíveis.

## Publicação
O site é estático: pode ser publicado pelo GitHub Pages, Render Static Site ou outro serviço de hospedagem estática apontando para a branch `main` e a raiz do repositório.

## Próximas etapas
1. Validar o fluxo com compradores e profissionais de inspeção.
2. Integrar backend seguro e armazenamento consentido.
3. Adicionar extração de dados de anúncios apenas por fontes permitidas.
4. Integrar serviço de IA com limites claros, fontes e trilha de auditoria.
5. Implementar conta, cobrança, privacidade e termos antes de comercializar.
