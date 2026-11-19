# 🛵 Pediu Chegou — MVP de plataforma de entregas (comida + pacotes)

Aplicativo web responsivo (funciona no navegador do celular, sem precisar de App Store/Play Store) com **4 perfis independentes**:

| Perfil | O que pode fazer |
|---|---|
| 🧑 **Cliente** | Ver lojas, buscar, ver cardápio, adicionar ao carrinho, fazer pedido, acompanhar o status em tempo real, cancelar antes da confirmação. |
| 🏪 **Loja / Restaurante** | Gerenciar sua loja (abrir/fechar, dados, taxa de entrega), gerenciar produtos (CRUD), receber e avançar pedidos: confirmar → preparando → pronto. |
| 🛵 **Entregador** | Ver pedidos prontos para retirar, aceitar entrega, marcar como entregue, ver seus ganhos acumulados. Precisa ser aprovado pelo admin. |
| 👑 **Administrador (você)** | Estatísticas da plataforma, aprovar/reprovar entregadores e lojas, bloquear usuários, ver todos os pedidos, usuários e lojas. |

## ✨ Diferenciais em relação a iFood/99 já integrados
- **Aprovação manual** de entregadores e lojas (controle de qualidade — ninguém entra sem sua aprovação).
- **Bloqueio de usuários** com um clique.
- **Taxa de entrega creditada automaticamente** ao entregador ao finalizar cada entrega (painel de ganhos).
- **Denúncia de atraso** — o entregador pode reportar (com foto) que uma loja marcou "pronto" sem estar. O admin recebe a denúncia e pode enviar à loja um **aviso amigável** (nunca intimidador: "pode ter sido um engano, ajuste o status da próxima vez").
- **Autocorreção para a loja** — se marcou "pronto" por engano, pode voltar para "preparando" e o tempo real é recalculado (não prejudica o entregador).
- **Painel financeiro** — comissão da plataforma, quanto você deve a cada loja e entregador, liquidação com um clique.
- **Taxa mínima de entrega R$ 8,00** (configurável pelo admin).
- **Gorjeta para o entregador**: R$5 / R$10 / R$20 / valor inteiro personalizado — vai 100% para o entregador.
- **Antecipações**: o entregador pode solicitar adiantamento do saldo (não espera a semana); paga-se via Pix e desconta-se do saldo. Requer chave Pix cadastrada.
- **Caixa de sugestões**: feedback honesto dos usuários (com nome ou anônimo), visível só para o admin.
- **Avaliações 1–5 estrelas + tags**: entregador avalia a loja ao coletar; cliente avalia o entregador ao receber, podendo selecionar tags (pontual, responsável, cuidadoso com o pedido, boa comunicação, simpático).
- **Chat por pedido**: mensagens entre loja + cliente + entregador (grupo ou direto). O admin pode ver tudo e intervir.
- **GPS + temporizadores**: botão "Cheguei na loja" (verifica proximidade por GPS, 10 min com reporte aos 4 min e cancelamento aos 10); botão "Cheguei no endereço do cliente" (10 min + 5 extras; se o cliente não responder, aparece no painel de suporte do admin para ligar).
- **Números protegidos**: os telefones aparecem mascarados; só admin/suporte vê o número completo para ligar. *(O mascaramento real de chamadas requer um relé telefônico tipo Twilio — veja abaixo.)*
- **Um único app** para os 4 perfis — o usuário só faz login e vê sua própria tela.

> **Nota sobre mascaramento de chamadas (código cifrado):** para que uma ligação entre entregador e cliente NÃO revele o número real, precisa de um provedor de relé telefônico (Twilio, Vonage ou Voximplant). O app já oculta os números na interface e mostra "Ligar (número protegido)"; para ativar o relé real, crie uma conta no Twilio (~USD 0,0075/min) e conecte o endpoint de chamadas. Enquanto isso, os contatos acontecem pelo chat integrado.

## 💰 Modelo de negócio (como você ganha e como cada um recebe)
- **Seu ganho (plataforma):** comissão `%` sobre o valor dos *produtos* (não sobre a taxa de entrega). Vem em **15%** por padrão, configurável em Admin → Financeiro. (iFood cobra entre 12% e 27%.)
- **Entregador:** recebe **100% da taxa de entrega** (mínimo R$ 8,00). É creditado no saldo ao entregar.
- **Loja:** recebe `valor dos produtos − comissão`. Acumula no saldo (a pagar por você semanalmente).
- **Fluxo do dinheiro:**
  - *Pagamento online (Pix):* o cliente paga a você (plataforma). Você fica com a comissão, deve à loja o valor líquido e ao entregador a taxa.
  - *Pagamento em dinheiro:* o entregador cobra o total do cliente. Ele fica com a taxa de entrega e **deve entregar a você o valor dos produtos** (o saldo dele fica negativo até pagar). Você paga a loja.
  - *Liquidação:* em Admin → Financeiro você vê quanto deve e quanto devem a você; com um clique marca cada conta como liquidada. Tudo fica registrado na tabela de transações (auditoria).
- **Para integrar pagamentos reais:** Mercado Pago / PicPay / Stripe. Enquanto isso, funciona com dinheiro e liquidação manual.

## 🚀 Como rodar no seu computador (1 minuto)

Requisitos: ter o [Node.js](https://nodejs.org) v18 ou superior instalado.

```bash
# 1. Descompacte o zip e entre na pasta
cd pediu-chegou

# 2. Instale as dependências (só uma vez)
npm install

# 3. Ligue o servidor
npm start
```

Abra no navegador: **http://localhost:3000**

### Modo demonstração (contas de teste) — opcional, desligado por padrão
Por padrão **não** são criadas contas de teste (assim você pode compartilhar o link sem que usuários reais vejam/entrem com dados de exemplo). Para testar localmente, apague o banco (`entregapp.db`) e inicie com:
```bash
SEED_DEMO=1 npm start
```
Aí sim, com o banco vazio, estas contas são criadas:

| Perfil | E-mail | Senha |
|---|---|---|
| 👑 Administrador | `admin@entregapp.com` | `admin123` |
| 🏪 Loja (Pizzaria do Zé) | `loja@exemplo.com` | `loja123` |
| 🛵 Entregador (aprovado) | `motoboy@exemplo.com` | `moto123` |
| 🧑 Cliente | `cliente@exemplo.com` | `cli123` |

> Para testar o fluxo completo: entre como **cliente** e faça um pedido → entre como **loja** e confirme/prepare → entre como **entregador** e aceite/entregue → entre como **admin** e veja os relatórios.

### Administrador em produção (sempre existe)
O sistema garante pelo menos um administrador. Defina no ambiente:
```bash
ADMIN_EMAIL=voce@seuemail.com
ADMIN_PASSWORD=suaSenhaForte123
NODE_ENV=production npm start
```
Se `ADMIN_PASSWORD` não for informada, uma senha aleatória é gerada e **impressa no console do servidor** (troque-a no primeiro acesso). Com `NODE_ENV=production`, o código de verificação de e-mail **não** é devolvido pela API (só chega por e-mail).

## 🏗️ Arquitetura (simples e econômica)
- **Backend:** Node.js + Express (um único processo, bem leve).
- **Banco de dados:** SQLite (um arquivo, sem servidor de BD para pagar). Aguenta tranquilo até ~10.000 usuários; quando crescer, migra para PostgreSQL trocando só o `db.js`.
- **Auth:** JWT (token seguro, sem sessões no servidor).
- **Frontend:** HTML/CSS/JS puro (SPA), mobile-first, sem frameworks de compilação — abre em qualquer celular.

## ☁️ Como colocar no ar por ~5 USD/mês (aguenta 500–1000 entregadores)

Um VPS de 1GB RAM / 1 CPU é mais que suficiente para esta fase. Opções:
- **Oracle Cloud Free Tier** — de graça para sempre (instância Always Free de 1GB RAM).
- **DigitalOcean / Hetzner / Hostinger** — ~4–6 USD/mês.
- **Railway / Render** — plano pago a partir de ~5 USD/mês, deploy com um clique (você conecta o repositório).

### Passos num VPS Ubuntu/Debian:
```bash
# Instalar o Node
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Subir o código (scp ou git clone), depois:
cd pediu-chegou && npm install

# Instalar o PM2 para rodar sempre e reiniciar sozinho
sudo npm install -g pm2
pm2 start server.js --name pediu-chegou
pm2 startup && pm2 save

# (Opcional) Nginx como proxy reverso + domínio + SSL grátis com Certbot
sudo apt install -y nginx certbot python3-certbot-nginx
# Aponte seu domínio para o IP do servidor e rode: certbot --nginx
```

**Troque o segredo JWT** antes de produzir: crie um arquivo `.env` com `JWT_SECRET=...` ou edite `middleware.js` (`SECRET`).

## 📈 Próximos passos (quando validar a ideia)
1. **Pagamentos online** — integrar Stripe / Mercado Pago / PicPay.
2. **Rastreio GPS ao vivo** — WebSocket (Socket.IO) para o cliente ver o entregador no mapa.
3. **Notificações push** — OneSignal ou Firebase Cloud Messaging (grátis até certo volume).
4. **Apps nativos** — empacotar a web em Capacitor para publicar na Play Store/App Store sem reescrever nada.
5. **Migrar para PostgreSQL** — quando passar de ~10 mil pedidos/dia.

## 📁 Estrutura do projeto
```
pediu-chegou/
├── server.js            # Servidor Express (ponto de entrada)
├── db.js                # Banco SQLite + esquema + (opcional) dados demo
├── middleware.js        # Autenticação JWT + permissões por perfil
├── routes/
│   ├── auth.js          # Cadastro / login / perfil
│   ├── stores.js        # Lojas + produtos (catálogo e gestão)
│   ├── orders.js        # Pedidos (todo o fluxo de status)
│   ├── extras.js        # Avaliações, chat, sugestões, antecipações
│   ├── reports.js       # Denúncias de atraso e avisos à loja
│   └── admin.js         # Painel de administração
└── public/              # Frontend (servido diretamente)
    ├── index.html
    ├── css/styles.css
    └── js/ (api.js + app.js)
```

---
Feito com ❤️ como MVP funcional. Todo o código é seu — modifique, venda, escale.
