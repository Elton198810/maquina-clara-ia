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


## Backend e pagamentos (preparação — ainda não ativados)
O diretório raiz agora contém uma API Node.js separada do site estático:
- `GET /health`: verifica se a API está ativa e informa se as variáveis de pagamento foram configuradas.
- `POST /api/checkout`: cria pedido de R$ 19,90 no Checkout Pro do Mercado Pago, com preço fixo no servidor.
- `POST /api/webhooks/mercadopago`: valida assinatura HMAC e consulta o pagamento diretamente à API do Mercado Pago antes de atualizar o pedido.
- `GET /api/orders/:id`: consulta o estado do pedido.

### Deploy da API no Render
Criar um serviço **Web Service** separado usando este mesmo repositório:
- Branch: `main`
- Root Directory: vazio
- Build Command: `npm install`
- Start Command: `npm start`
- Adicionar um PostgreSQL no Render e copiar sua Internal Database URL para `DATABASE_URL`.

Configurar as variáveis no serviço Web:
- `MP_ACCESS_TOKEN`: Access Token privado da aplicação Mercado Pago.
- `MP_WEBHOOK_SECRET`: chave secreta da configuração de Webhooks do Mercado Pago.
- `PUBLIC_SITE_URL`: endereço público do site estático.
- `API_PUBLIC_URL`: endereço HTTPS do Web Service.

**Não aceitar pagamentos reais ainda.** A API é apenas a base técnica: falta configurar credenciais, banco, webhook, conectar o formulário do site e testar pagamentos de ponta a ponta em modo de teste. Não coloque tokens no repositório nem no navegador. O dossiê atual continua sendo preliminar e não é laudo técnico.
