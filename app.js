// app.js — SPA Pediu Chegou: router + vistas para los 4 roles
const App = {
  route: 'login',
  cart: { store_id: null, items: [], tip: 0 }, // items: {product_id, name, price, qty}
  storeCache: null,
  _reg: { step: 1, data: {}, dev_email_code: null }, // wizard de entregador
  _gpsTimer: null,

  // ---------- Router ----------
  navigate(route, param) {
    if (route === 'store') App._navStoreId = param;
    if (route === 'pedido') App._navOrderId = param;
    this.route = route;
    const user = API.user();
    if (!['login', 'verificar-email', 'termos'].includes(route) && !user) { route = 'login'; this.route = 'login'; }
    if (this._gpsTimer) { clearInterval(this._gpsTimer); this._gpsTimer = null; }
    this.renderChrome();
    const view = document.getElementById('view');
    view.innerHTML = '<div class="empty"><span class="big">⏳</span>Carregando...</div>';
    const fn = this.routes[route] || (() => view.innerHTML = '<div class="empty">Vista não encontrada.</div>');
    Promise.resolve(fn.call(this, view)).catch(e => {
      view.innerHTML = `<div class="empty"><span class="big">⚠️</span>${esc(e.message)}</div>`;
    });
  },

  routes: {
    'login': App_renderLogin,
    'verificar-email': App_renderVerificarEmail,
    'pendente': App_renderPendente,
    'termos': App_renderTermos,
    'face-verify': App_renderFaceVerify,
    // Cliente
    'home': App_renderClienteHome,
    'store': App_renderStoreDetail,
    'cart': App_renderCart,
    'meus-pedidos': App_renderClienteOrders,
    'pedido': App_renderOrderDetail,
    // Loja
    'loja-pedidos': App_renderLojaOrders,
    'loja-produtos': App_renderLojaProducts,
    'loja-loja': App_renderLojaStore,
    // Entregador
    'entregador': App_renderEntregador,
    // Admin
    'admin': App_renderAdminHome,
    'admin-usuarios': App_renderAdminUsers,
    'admin-lojas': App_renderAdminStores,
    'admin-pedidos': App_renderAdminOrders,
    'admin-denuncias': App_renderAdminDenuncias,
    'admin-financeiro': App_renderAdminFinanceiro,
    'admin-feedback': App_renderAdminFeedback,
    'admin-antecipos': App_renderAdminAntecipos,
    'admin-espera': App_renderAdminEspera,
  },

  renderChrome() {
    const user = API.user();
    const topbar = document.getElementById('topbar');
    const bnav = document.getElementById('bottomnav');
    if (!user || ['login', 'verificar-email', 'pendente', 'termos', 'face-verify'].includes(this.route)) {
      topbar.classList.add('hidden'); bnav.classList.add('hidden'); return;
    }
    topbar.classList.remove('hidden');
    const roleLabel = { cliente: 'Cliente', loja: 'Loja/Restaurante', admin: 'Administrador', entregador: 'Entregador' }[user.role];
    const displayName = user.social_name || user.name;
    topbar.innerHTML = `
      <div class="brand"><img src="/img/logo.png" class="brand-logo" alt="Pediu Chegou"><small>${esc(roleLabel)}</small></div>
      <div class="user"><b>${esc(displayName.split(' ')[0])}</b>
        <button onclick="App.logout()">Sair</button></div>`;

    const navs = {
      cliente: [['home', '🏪', 'Lojas'], ['meus-pedidos', '📦', 'Meus pedidos']],
      loja: [['loja-pedidos', '📋', 'Pedidos'], ['loja-produtos', '🍕', 'Produtos'], ['loja-loja', '🏪', 'Minha loja']],
      entregador: [['entregador', '🛵', 'Entregas']],
      admin: [['admin', '📊', 'Geral'], ['admin-usuarios', '👥', 'Usuários'], ['admin-lojas', '🏪', 'Lojas'], ['admin-pedidos', '📦', 'Pedidos']],
    };
    const items = navs[user.role] || [];
    bnav.classList.remove('hidden');
    bnav.innerHTML = items.map(([r, ico, lbl]) =>
      `<button class="${this.route === r ? 'active' : ''}" onclick="App.navigate('${r}')"><span class="ico">${ico}</span>${lbl}</button>`).join('');
  },

  logout() { API.setToken(null); API.setUser(null); this.cart = { store_id: null, items: [], tip: 0 }; this.navigate('login'); },

  // ---------- Carrito ----------
  addToCart(product, storeId) {
    if (this.cart.store_id && this.cart.store_id !== storeId) {
      if (!confirm('Seu carrinho tem itens de outra loja. Deseja limpar e começar um novo pedido?')) return;
      this.cart = { store_id: null, items: [], tip: 0 };
    }
    this.cart.store_id = storeId;
    const it = this.cart.items.find(i => i.product_id === product.id);
    if (it) it.qty++; else this.cart.items.push({ product_id: product.id, name: product.name, price: product.price, qty: 1 });
    toast(`${product.name} adicionado! (${this.cartTotalQty()} itens)`);
    this.renderCartBar();
    this._refreshProductList();
  },
  adjustQty(productId, delta) {
    const it = this.cart.items.find(i => i.product_id === productId);
    if (!it && delta > 0) {
      // agregar desde cero
      const p = (this.storeCache?.products || []).find(x => x.id === productId);
      if (p) this.addToCart(p, this.storeCache.id);
      return;
    }
    if (!it) return;
    it.qty += delta;
    if (it.qty <= 0) this.cart.items = this.cart.items.filter(i => i.product_id !== productId);
    if (this.cart.items.length === 0) this.cart.store_id = null;
    this.renderCartBar();
    this._refreshProductList();
  },
  changeQty(productId, delta) { // usado no carrinho (navega para o carrinho)
    const it = this.cart.items.find(i => i.product_id === productId);
    if (!it) return;
    it.qty += delta;
    if (it.qty <= 0) this.cart.items = this.cart.items.filter(i => i.product_id !== productId);
    if (this.cart.items.length === 0) this.cart.store_id = null;
    this.navigate('cart');
  },
  _refreshProductList() {
    const el = document.getElementById('produtos-container');
    if (el && this.storeCache) el.innerHTML = renderProducts(this.storeCache);
  },
  cartTotalQty() { return this.cart.items.reduce((s, i) => s + i.qty, 0); },
  cartSubtotal() { return this.cart.items.reduce((s, i) => s + i.qty * i.price, 0); },
  renderCartBar() {
    let bar = document.getElementById('cart-bar');
    if (this.cart.items.length === 0 || !API.user() || API.user().role !== 'cliente') {
      if (bar) bar.remove(); return;
    }
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'cart-bar'; bar.className = 'cart-bar';
      bar.onclick = () => App.navigate('cart');
      document.body.appendChild(bar);
    }
    bar.innerHTML = `<span>🛒 ${this.cartTotalQty()} item(ns)</span><span>${money(this.cartSubtotal())}  Ver pedido ›</span>`;
  },
};

// ==================== HELPERS ====================
function readFileBase64(inputId, cb) {
  const f = document.getElementById(inputId)?.files?.[0];
  if (!f) { cb(null); return; }
  const r = new FileReader();
  r.onload = () => cb(r.result);
  r.readAsDataURL(f);
}
function homeForRole(role) {
  return { cliente: 'home', loja: 'loja-pedidos', entregador: 'entregador', admin: 'admin' }[role] || 'home';
}
// Modal de navegação GPS: Waze (se tiver instalado abre o app) ou Google Maps
App.modalNav = function (lat, lng, address, label) {
  const q = encodeURIComponent(address || '');
  const waze = (lat && lng) ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` : `https://waze.com/ul?q=${q}&navigate=yes`;
  const google = (lat && lng) ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
  const box = document.getElementById('modal-box');
  document.getElementById('modal').classList.remove('hidden');
  box.innerHTML = `
    <h3>🗺️ Como chegar — ${esc(label || '')}</h3>
    <p class="muted" style="margin-bottom:12px">Escolha o navegador:</p>
    <a class="btn primary" target="_blank" rel="noopener" href="${waze}" onclick="App.fecharModal()">Abrir com Waze</a>
    <div style="height:8px"></div>
    <a class="btn ghost" target="_blank" rel="noopener" href="${google}" onclick="App.fecharModal()">Abrir com Google Maps</a>
    <div style="height:8px"></div>
    <button class="btn ghost small" style="width:auto" onclick="App.fecharModal()">Cancelar</button>`;
};
App.fecharModal = () => document.getElementById('modal').classList.add('hidden');

// ==================== AUTENTICAÇÃO ====================
function App_renderLogin(view) {
  App._loginMode = App._loginMode || 'login';
  App._role = App._role || 'cliente';
  const draw = () => {
    const mode = App._loginMode;
    const role = App._role;
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-logo"><img src="/img/logo.png" class="logo-img" alt="Pediu Chegou"><p>Pedidos de comida e bebidas com entrega rápida</p></div>
        <div class="tabs">
          <button class="${mode === 'login' ? 'active' : ''}" onclick="App._loginMode='login';App._drawLogin()">Entrar</button>
          <button class="${mode === 'register' ? 'active' : ''}" onclick="App._loginMode='register';App._drawLogin()">Criar conta</button>
        </div>
        ${mode === 'login' ? `
          <div class="card">
            <div class="form-group"><label>Usuário (e-mail, CPF ou nome de usuário)</label><input id="f-email" placeholder="voce@email.com"></div>
            <div class="form-group"><label>Senha</label><input id="f-senha" type="password" placeholder="••••••"></div>
            <button class="btn primary" onclick="App.doLogin()">Entrar</button>
          </div>` : `
          <div class="card">
            <div class="role-pick">
              <button class="${role === 'cliente' ? 'active' : ''}" onclick="App._role='cliente';App._drawLogin()"><span class="emoji">🧑</span>Cliente</button>
              <button class="${role === 'loja' ? 'active' : ''}" onclick="App._role='loja';App._drawLogin()"><span class="emoji">🏪</span>Loja/Restaurante</button>
              <button class="${role === 'entregador' ? 'active' : ''}" onclick="App._iniciarCadastroEntregador()"><span class="emoji">🛵</span>Entregador</button>
            </div>
            ${role === 'entregador' ? '<div class="muted" style="text-align:center;margin-bottom:10px">Para entregador usamos um cadastro em etapas. Toque no botão acima.</div>' : `
            <div class="form-group"><label>Nome completo</label><input id="r-nome"></div>
            <div class="form-group"><label>CPF (opcional)</label><input id="r-cpf"></div>
            <div class="form-group"><label>E-mail</label><input id="r-email" type="email"></div>
            <div class="form-group"><label>Telefone (com DDD)</label><input id="r-fone"></div>
            <div class="form-group"><label>Senha <span class="muted">(mín. 8 caracteres: 2 números, 1 maiúscula, 5 minúsculas)</span></label><input id="r-senha" type="password"></div>
            ${role === 'cliente' ? '<div class="form-group"><label>Endereço de entrega</label><input id="r-end"></div>' : ''}
            ${role === 'loja' ? '<div class="muted" style="margin-bottom:10px">Após o cadastro, você cria sua loja e o admin aprova.</div>' : ''}
            <div class="form-group"><label><input type="checkbox" id="r-termos"> Li e aceito os <a href="#" onclick="App.modalTermos();return false;" style="color:var(--primary-dark);font-weight:700">Termos e Condições</a> de uso da plataforma</label></div>
            <button class="btn primary" onclick="App.doRegister()">Criar conta</button>
            <div class="muted" style="margin-top:8px;text-align:center">Lojas passam por aprovação do administrador.</div>`}
          </div>`}
          <div style="text-align:center;margin-top:14px">
            <a href="#" onclick="App.navigate('termos');return false;" style="color:var(--primary-dark);font-size:12px;font-weight:600">📜 Ler Termos e Condições completos</a>
          </div>
      </div>`;
  };
  App._drawLogin = () => { draw(); };
  draw();
}

App.doLogin = async function () {
  try {
    const email = document.getElementById('f-email').value.trim();
    const password = document.getElementById('f-senha').value;
    const { token, user, pending, needs_email_verification, needs_face_verification } = await API.post('/auth/login', { email, password });
    API.setToken(token); API.setUser(user);
    if (needs_email_verification) { App.navigate('verificar-email'); return; }
    if (pending) { App.navigate('pendente'); return; }
    // Entregador: validar o rosto em cada login (conta pessoal e intransferível)
    if (needs_face_verification) { App.navigate('face-verify'); return; }
    toast(`Bem-vindo, ${(user.social_name || user.name).split(' ')[0]}!`);
    App.navigate(homeForRole(user.role));
  } catch (e) { toast(e.message, true); }
};

App.doRegister = async function () {
  try {
    const termos = document.getElementById('r-termos')?.checked;
    if (!termos) { toast('Você deve aceitar os Termos e Condições de uso.', true); return; }
    const body = {
      name: document.getElementById('r-nome').value.trim(),
      cpf: document.getElementById('r-cpf')?.value || '',
      email: document.getElementById('r-email').value.trim(),
      phone: document.getElementById('r-fone')?.value || '',
      password: document.getElementById('r-senha').value,
      role: App._role,
      address: document.getElementById('r-end')?.value || '',
      terms_accepted: true,
    };
    if (!body.name || !body.email || !body.password) { toast('Preencha nome, e-mail e senha.', true); return; }
    const { token, user, message, dev_email_code } = await API.post('/auth/register', body);
    API.setToken(token); API.setUser(user);
    App._reg.dev_email_code = dev_email_code;
    toast(message);
    App.navigate('verificar-email');
  } catch (e) { toast(e.message, true); }
};

// ---------- Wizard de entregador ----------
App._iniciarCadastroEntregador = function () {
  App._reg = { step: 1, data: {}, dev_email_code: null };
  App._role = 'entregador';
  App_renderCadastroEntregador(document.getElementById('view'));
};
function App_renderCadastroEntregador(view) {
  const step = App._reg.step;
  const d = App._reg.data;
  let body = '';
  if (step === 1) {
    body = `
      <h1>Cadastro de entregador — Etapa 1</h1>
      <p class="sub">Dados pessoais e foto do rosto</p>
      <div class="card">
        <div class="form-group"><label>Nome</label><input id="ce-nome" value="${esc(d.nome || '')}"></div>
        <div class="form-group"><label>Sobrenome</label><input id="ce-sobrenome" value="${esc(d.sobrenome || '')}"></div>
        <div class="form-group"><label>Nome social (opcional — aparece no perfil público)</label><input id="ce-social" value="${esc(d.social || '')}"></div>
        <div class="form-group"><label>CPF</label><input id="ce-cpf" value="${esc(d.cpf || '')}" placeholder="000.000.000-00"></div>
        <div class="form-group"><label>Data de nascimento</label><input id="ce-nasc" type="date" value="${esc(d.nasc || '')}"></div>
        <div class="form-group"><label>E-mail</label><input id="ce-email" type="email" value="${esc(d.email || '')}"></div>
        <div class="form-group"><label>Telefone (com DDD)</label><input id="ce-fone" value="${esc(d.fone || '')}"></div>
        <div class="form-group"><label>Foto do rosto (obrigatória: sem óculos, sem boné, sem chapéu)</label>
          <input type="file" id="ce-foto" accept="image/*">
          ${d.foto ? `<img src="${d.foto}" class="avatar-preview">` : ''}</div>
        <button class="btn primary" onclick="App.cePasso1()">Próximo ›</button>
      </div>`;
  } else if (step === 2) {
    const vt = d.vehicle_type || 'bicicleta';
    body = `
      <h1>Cadastro de entregador — Etapa 2</h1>
      <p class="sub">Seu veículo de entrega</p>
      <div class="card">
        <div class="role-pick" style="grid-template-columns:repeat(2,1fr)">
          <button class="${vt === 'bicicleta' ? 'active' : ''}" onclick="App.ceSetVeiculo('bicicleta')"><span class="emoji">🚲</span>Bicicleta</button>
          <button class="${vt === 'moto' ? 'active' : ''}" onclick="App.ceSetVeiculo('moto')"><span class="emoji">🏍️</span>Moto</button>
        </div>
        ${vt === 'bicicleta' ? `
          <div class="form-group"><label>Número de identificação da bicicleta</label><input id="ce-bike-num" value="${esc(d.bike_number || '')}"></div>
          <div class="form-group"><label>Cor</label><input id="ce-bike-cor" value="${esc(d.bike_color || '')}"></div>
          <div class="form-group"><label>Aro (tamanho da roda)</label>
            <select id="ce-bike-aro"><option value="24" ${d.bike_wheel_size === '24' ? 'selected' : ''}>Aro 24</option><option value="26" ${d.bike_wheel_size === '26' ? 'selected' : ''}>Aro 26</option></select></div>
          <div class="form-group"><label><input type="checkbox" id="ce-bike-eletrica" ${d.bike_electric ? 'checked' : ''}> É bicicleta elétrica?</label></div>
          <div class="muted">Você poderá editar os dados da bicicleta quando quiser, sem autorização da plataforma.</div>` : `
          <div class="form-group"><label>CNH (frente) — provisória vale</label><input type="file" id="ce-cnh-frente" accept="image/*">${d.cnh_front ? '<div class="muted">✓ Foto da frente enviada</div>' : ''}</div>
          <div class="form-group"><label>CNH (verso)</label><input type="file" id="ce-cnh-verso" accept="image/*">${d.cnh_back ? '<div class="muted">✓ Foto do verso enviada</div>' : ''}</div>
          <div class="form-group"><label>Documento da moto</label><input type="file" id="ce-doc-moto" accept="image/*">${d.moto_doc ? '<div class="muted">✓ Documento enviado</div>' : ''}</div>
          <div class="form-group"><label>RENAVAM (para verificação)</label><input id="ce-renavam" value="${esc(d.renavam || '')}"></div>
          <div class="muted" style="margin-bottom:8px">Dados da moto (pré-preenchidos pelo RENAVAM — confira e edite se precisar):</div>
          <div class="form-group"><label>Marca</label><input id="ce-moto-marca" value="${esc(d.moto_brand || '')}"></div>
          <div class="form-group"><label>Modelo</label><input id="ce-moto-modelo" value="${esc(d.moto_model || '')}"></div>
          <div class="form-group"><label>Cor</label><input id="ce-moto-cor" value="${esc(d.moto_color || '')}"></div>
          <div class="form-group"><label>Cilindrada</label><input id="ce-moto-cil" value="${esc(d.moto_cyl || '')}" placeholder="Ex: 150cc"></div>`}
        <div class="btn-row" style="margin-top:12px">
          <button class="btn ghost" onclick="App.ceVoltar(1)">‹ Voltar</button>
          <button class="btn primary" onclick="App.cePasso2()">Próximo ›</button>
        </div>
      </div>`;
  } else {
    body = `
      <h1>Cadastro de entregador — Etapa 3</h1>
      <p class="sub">Usuário, senha e termos</p>
      <div class="card">
        <div class="form-group"><label>Usuário (use CPF ou e-mail)</label><input id="ce-usuario" value="${esc(d.usuario || d.cpf || d.email || '')}"></div>
        <div class="form-group"><label>Senha</label><input id="ce-senha" type="password" placeholder="Mín. 8 caracteres: 2 números, 1 maiúscula, 5 minúsculas" oninput="App.ceValidarSenha(this.value)">
          <div id="ce-senha-msg" class="muted" style="margin-top:4px"></div></div>
        <div class="muted" style="margin-bottom:8px">A senha NÃO pode ser seu CPF, data de nascimento ou número do RENAVAM. Se detectado, você recebe um aviso e pode tentar outra na hora (sem penalidade).</div>
        <div class="form-group"><label><input type="checkbox" id="ce-termos"> Li e aceito os <a href="#" onclick="App.modalTermos();return false;" style="color:var(--primary-dark);font-weight:700">Termos e Condições</a> de uso da plataforma Pediu Chegou</label></div>
        <div class="btn-row">
          <button class="btn ghost" onclick="App.ceVoltar(2)">‹ Voltar</button>
          <button class="btn primary" onclick="App.ceFinalizar()">Finalizar cadastro</button>
        </div>
      </div>`;
  }
  view.innerHTML = `<button class="btn ghost small" style="width:auto;margin-bottom:10px" onclick="App.navigate('login')">‹ Voltar ao login</button>` + body;
}
App.ceSetVeiculo = function (v) {
  App._guardarCamposEtapa2();
  App._reg.data.vehicle_type = v;
  App_renderCadastroEntregador(document.getElementById('view'));
};
App.ceVoltar = function (passo) {
  if (passo === 1) { /* da etapa 2 para 1 */ }
  App._guardarCamposEtapa2();
  App._reg.step = passo;
  App_renderCadastroEntregador(document.getElementById('view'));
};
App.cePasso1 = function () {
  const d = App._reg.data;
  d.nome = document.getElementById('ce-nome').value.trim();
  d.sobrenome = document.getElementById('ce-sobrenome').value.trim();
  d.social = document.getElementById('ce-social').value.trim();
  d.cpf = document.getElementById('ce-cpf').value.trim();
  d.nasc = document.getElementById('ce-nasc').value;
  d.email = document.getElementById('ce-email').value.trim();
  d.fone = document.getElementById('ce-fone').value.trim();
  readFileBase64('ce-foto', (b64) => {
    if (b64) d.foto = b64;
    if (!d.nome || !d.sobrenome || !d.cpf || !d.nasc || !d.email) { toast('Preencha nome, sobrenome, CPF, data de nascimento e e-mail.', true); return; }
    if (!d.foto) { toast('A foto do rosto é obrigatória (sem óculos, boné ou chapéu).', true); return; }
    App._reg.step = 2;
    App_renderCadastroEntregador(document.getElementById('view'));
  });
};
App._guardarCamposEtapa2 = function () {
  const d = App._reg.data;
  if (document.getElementById('ce-bike-num')) {
    d.bike_number = document.getElementById('ce-bike-num').value.trim();
    d.bike_color = document.getElementById('ce-bike-cor').value.trim();
    d.bike_wheel_size = document.getElementById('ce-bike-aro').value;
    d.bike_electric = document.getElementById('ce-bike-eletrica').checked;
  }
  if (document.getElementById('ce-renavam')) {
    d.renavam = document.getElementById('ce-renavam').value.trim();
    d.moto_brand = document.getElementById('ce-moto-marca').value.trim();
    d.moto_model = document.getElementById('ce-moto-modelo').value.trim();
    d.moto_color = document.getElementById('ce-moto-cor').value.trim();
    d.moto_cyl = document.getElementById('ce-moto-cil').value.trim();
  }
};
App.cePasso2 = function () {
  App._guardarCamposEtapa2();
  const d = App._reg.data;
  const vt = d.vehicle_type || 'bicicleta';
  // ler arquivos de moto (se houver)
  const finalizar = () => {
    if (vt === 'bicicleta') {
      if (!d.bike_number || !d.bike_color || !['24', '26'].includes(String(d.bike_wheel_size))) {
        toast('Informe número, cor e aro (24 ou 26) da bicicleta.', true); return;
      }
    } else {
      if (!d.cnh_front || !d.cnh_back) { toast('Envie a CNH dos dois lados.', true); return; }
      if (!d.moto_doc || !d.renavam) { toast('Envie o documento da moto e o RENAVAM.', true); return; }
      if (!d.moto_brand || !d.moto_model || !d.moto_color || !d.moto_cyl) { toast('Confira marca, modelo, cor e cilindrada da moto.', true); return; }
    }
    App._reg.step = 3;
    App_renderCadastroEntregador(document.getElementById('view'));
  };
  if (vt === 'moto') {
    let pend = 3;
    const done = () => { if (--pend === 0) finalizar(); };
    readFileBase64('ce-cnh-frente', (b) => { if (b) d.cnh_front = b; done(); });
    readFileBase64('ce-cnh-verso', (b) => { if (b) d.cnh_back = b; done(); });
    readFileBase64('ce-doc-moto', (b) => { if (b) d.moto_doc = b; done(); });
  } else {
    finalizar();
  }
};
App.ceValidarSenha = function (pw) {
  const el = document.getElementById('ce-senha-msg');
  if (!el) return;
  const d = App._reg.data;
  const digits = (pw.match(/\d/g) || []).length, upper = (pw.match(/[A-Z]/g) || []).length, lower = (pw.match(/[a-z]/g) || []).length;
  const norm = (s) => String(s || '').replace(/\D/g, '');
  const proibido = [norm(d.cpf), norm(d.nasc), norm(d.renavam)].filter(x => x.length >= 4).some(f => norm(pw) === f || pw.includes(f));
  if (pw.length < 8) { el.textContent = 'Mínimo 8 caracteres.'; el.style.color = 'var(--danger)'; return; }
  if (digits < 2) { el.textContent = 'Faltam números (mín. 2).'; el.style.color = 'var(--danger)'; return; }
  if (upper < 1) { el.textContent = 'Falta 1 letra maiúscula.'; el.style.color = 'var(--danger)'; return; }
  if (lower < 5) { el.textContent = 'Faltam letras minúsculas (mín. 5).'; el.style.color = 'var(--danger)'; return; }
  if (proibido) { el.textContent = 'Não use CPF, data de nascimento ou RENAVAM como senha.'; el.style.color = 'var(--danger)'; return; }
  el.textContent = '✓ Senha válida.'; el.style.color = 'var(--primary)';
};
App.ceFinalizar = async function () {
  try {
    const d = App._reg.data;
    const senha = document.getElementById('ce-senha').value;
    const termos = document.getElementById('ce-termos').checked;
    if (!termos) { toast('Você deve aceitar os termos e condições.', true); return; }
    const body = {
      name: d.nome, surname: d.sobrenome, social_name: d.social, cpf: d.cpf, birth_date: d.nasc,
      email: d.email, phone: d.fone, password: senha, vehicle_type: d.vehicle_type,
      bike_number: d.bike_number, bike_color: d.bike_color, bike_wheel_size: d.bike_wheel_size, bike_electric: d.bike_electric,
      photo: d.foto, cnh_front: d.cnh_front, cnh_back: d.cnh_back, moto_doc: d.moto_doc,
      renavam: d.renavam, moto_brand: d.moto_brand, moto_model: d.moto_model, moto_color: d.moto_color, moto_cyl: d.moto_cyl,
      terms_accepted: true,
    };
    const { token, user, message, dev_email_code } = await API.post('/auth/register-entregador', body);
    API.setToken(token); API.setUser(user);
    App._reg.dev_email_code = dev_email_code;
    toast(message);
    App.navigate('verificar-email');
  } catch (e) { toast(e.message, true); }
};

// ---------- Verificar e-mail ----------
function App_renderVerificarEmail(view) {
  const user = API.user();
  view.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo"><img src="/img/logo.png" class="logo-img" alt="Pediu Chegou"><p>Confirme seu e-mail</p></div>
      <div class="card">
        <p style="margin-bottom:10px">Enviamos um código de 6 dígitos para <b>${esc(user?.email || 'seu e-mail')}</b>.</p>
        ${App._reg.dev_email_code ? `<div class="demo-hint"><b>Modo demonstração:</b> código = <b>${App._reg.dev_email_code}</b> (em produção ele chega por e-mail).</div>` : ''}
        <div class="form-group"><label>Código de verificação</label><input id="ve-code" maxlength="6" placeholder="000000"></div>
        <button class="btn primary" onclick="App.verificarEmail()">Confirmar e-mail</button>
        <div style="height:8px"></div>
        <button class="btn ghost" onclick="App.reenviarCodigo()">Reenviar código</button>
        <div style="height:8px"></div>
        <button class="btn ghost small" style="width:auto" onclick="App.logout()">Sair</button>
      </div>
    </div>`;
}
App.verificarEmail = async function () {
  try {
    const { user } = await API.post('/auth/verify-email', { code: document.getElementById('ve-code').value.trim() });
    API.setUser(user);
    toast('E-mail confirmado!');
    App.navigate(user.status === 'pendente' ? 'pendente' : homeForRole(user.role));
  } catch (e) { toast(e.message, true); }
};
App.reenviarCodigo = async function () {
  try {
    const r = await API.post('/auth/resend-email-code', {});
    App._reg.dev_email_code = r.dev_email_code;
    toast(r.message);
    App.navigate('verificar-email');
  } catch (e) { toast(e.message, true); }
};

function App_renderPendente(view) {
  const user = API.user();
  view.innerHTML = `
    <div class="empty" style="padding-top:80px">
      <span class="big">⏳</span>
      <h2 style="margin-bottom:8px">Conta em análise</h2>
      <p style="max-width:300px;margin:0 auto">Olá <b>${esc(user.social_name || user.name)}</b>, seu cadastro foi recebido e está aguardando aprovação do administrador. Você receberá acesso assim que for aprovado.</p>
      <div style="margin-top:20px"><button class="btn ghost small" onclick="App.refreshMe()">Verificar novamente</button></div>
      <div style="margin-top:10px"><button class="btn ghost small" onclick="App.logout()">Sair</button></div>
    </div>`;
}
App.refreshMe = async function () {
  try {
    const { user } = await API.get('/auth/me');
    API.setUser(user);
    if (!user.email_verified) { App.navigate('verificar-email'); return; }
    if (user.status === 'ativo') { toast('Aprovado!'); App.navigate(homeForRole(user.role)); }
    else toast('Ainda pendente de aprovação.');
  } catch (e) { toast(e.message, true); }
};

// ==================== CLIENTE: Home ====================
async function App_renderClienteHome(view) {
  const { stores } = await API.get('/stores');
  const user = API.user();
  const temCodigo = !!(user.delivery_code && String(user.delivery_code).trim());
  view.innerHTML = `
    <h1>Olá, ${esc((user.social_name || user.name).split(' ')[0])} 👋</h1>
    <p class="sub">O que você quer pedir hoje?</p>
    ${temCodigo ? '' : `<div class="card" style="border-left:4px solid var(--accent)">
      <b>🔑 Cadastre seu código de entrega</b>
      <div class="muted">É com ele que o entregador finaliza a entrega. Você pode trocá-lo quando quiser.</div>
      <button class="btn primary small" style="margin-top:8px" onclick="App.modalCodigoCliente()">Cadastrar código agora</button>
    </div>`}
    <div class="btn-row" style="margin-bottom:10px">
      <button class="btn ghost small" onclick="App.modalCodigoCliente()">🔑 Meu código de entrega</button>
    </div>
    <div class="form-group"><input id="busca" placeholder="🔍 Buscar loja ou categoria..." oninput="App.buscaLojas(this.value)"></div>
    <div id="lista-lojas">${renderStoreList(stores)}</div>`;
  App.renderCartBar();
}
App.buscaLojas = async function (q) {
  const { stores } = await API.get('/stores' + (q ? '?q=' + encodeURIComponent(q) : ''));
  document.getElementById('lista-lojas').innerHTML = renderStoreList(stores);
};
function renderStoreList(stores) {
  if (!stores.length) return '<div class="empty"><span class="big">🏪</span>Nenhuma loja encontrada.</div>';
  return stores.map(s => `
    <div class="card clickable store-card" onclick="App.navigate('store', ${s.id})">
      ${s.image ? `<img src="${s.image}" class="store-thumb">` : `<div class="thumb">${s.category === 'Pizza' ? '🍕' : s.category === 'Saudável' ? '🥗' : '🏪'}</div>`}
      <div class="info">
        <h3>${esc(s.name)}</h3>
        <div class="meta">${esc(s.category || '')} • ${esc(s.delivery_time || '')} • ${money(s.delivery_fee)} entrega</div>
        <div class="meta">${s.is_open ? '<span class="tag">Aberto</span>' : '<span class="tag" style="background:#fee2e2;color:#991b1b">Fechado</span>'} ${esc(s.city || '')}</div>
      </div>
      <div style="color:var(--muted)">›</div>
    </div>`).join('');
}

// ==================== CLIENTE: Detalhe da loja + cardápio (com fotos e +/-) ====================
async function App_renderStoreDetail(view) {
  const id = App._navStoreId;
  const { store } = await API.get('/stores/' + id);
  App.storeCache = store;
  view.innerHTML = `
    <button class="btn ghost small" style="width:auto;margin-bottom:10px" onclick="App.navigate('home')">‹ Voltar</button>
    <div class="card">
      <div class="row"><h3 style="font-size:18px">${esc(store.name)}</h3>
        ${store.is_open ? '<span class="badge ativo">Aberto</span>' : '<span class="badge bloqueado">Fechado</span>'}</div>
      <div class="meta">${esc(store.description || '')}</div>
      <div class="meta" style="margin-top:6px"><span class="tag">${esc(store.category || '')}</span>
        <span class="tag">${esc(store.delivery_time || '')}</span>
        <span class="tag">Entrega ${money(store.delivery_fee)}</span></div>
    </div>
    <div class="section-title">Cardápio</div>
    <div class="card" id="produtos-container">${renderProducts(store)}</div>`;
  App.renderCartBar();
}
function renderProducts(store) {
  if (!store.products.length) return '<div class="muted">Nenhum produto cadastrado.</div>';
  return store.products.map(p => {
    const noCarrinho = App.cart.store_id === store.id ? (App.cart.items.find(i => i.product_id === p.id)?.qty || 0) : 0;
    const pJson = JSON.stringify(p).replace(/'/g, '&#39;');
    return `
      <div class="product-item">
        ${p.image ? `<img src="${p.image}" class="prod-img" alt="${esc(p.name)}">` : ''}
        <div class="p-info"><div class="p-name">${esc(p.name)}</div>
          <div class="p-desc">${esc(p.description || '')}</div>
          <div class="price">${money(p.price)}</div></div>
        ${p.available ? (noCarrinho === 0
          ? `<button class="btn primary small qty-add" onclick='App.addToCart(${pJson}, ${store.id})'>+ Adicionar</button>`
          : `<div class="qty-ctl">
               <button onclick="App.adjustQty(${p.id}, -1)">−</button><span>${noCarrinho}</span>
               <button onclick="App.adjustQty(${p.id}, 1)">+</button>
             </div>`)
          : '<span class="muted">Indisponível</span>'}
      </div>`;
  }).join('');
}

// ==================== CLIENTE: Carrinho / checkout (só Pix e Dinheiro) ====================
function App_renderCart(view) {
  const store = App.storeCache;
  const items = App.cart.items;
  if (!items.length) { view.innerHTML = '<div class="empty"><span class="big">🛒</span>Carrinho vazio.<br><br><button class="btn ghost small" style="width:auto" onclick="App.navigate(\'home\')">Ver lojas</button></div>'; App.renderCartBar(); return; }
  const subtotal = App.cartSubtotal();
  const fee = store ? store.delivery_fee : 0;
  const user = API.user();
  view.innerHTML = `
    <h1>Seu pedido</h1>
    <p class="sub">${esc(store ? store.name : 'Loja')}</p>
    <div class="card">
      ${items.map(i => `
        <div class="product-item">
          <div class="p-info"><div class="p-name">${esc(i.name)}</div><div class="price">${money(i.price * i.qty)}</div></div>
          <div class="qty-ctl">
            <button onclick="App.changeQty(${i.product_id}, -1)">−</button><span>${i.qty}</span>
            <button onclick="App.changeQty(${i.product_id}, 1)">+</button>
          </div>
        </div>`).join('')}
      <div class="divider"></div>
      <div class="row"><span class="muted">Subtotal</span><span>${money(subtotal)}</span></div>
      <div class="row"><span class="muted">Taxa de entrega</span><span>${money(fee)}</span></div>
      <div class="row"><span class="muted">Gorjeta para o entregador</span><span>${money(App.cart.tip || 0)}</span></div>
      <div class="row" style="margin-top:8px"><b>Total</b><b class="price" style="font-size:18px">${money(subtotal + fee + (App.cart.tip || 0))}</b></div>
    </div>
    <div class="card">
      <div class="section-title" style="margin-top:0">Gorjeta para o entregador (valor inteiro)</div>
      <div class="btn-row" style="margin-bottom:8px">
        ${[5, 10, 20].map(v => `<button class="btn ${(App.cart.tip || 0) === v ? 'primary' : 'ghost'} small" onclick="App.setTip(${v})">R$ ${v}</button>`).join('')}
      </div>
      <div class="form-group"><label>Outro valor (inteiro)</label>
        <input id="tip-outro" type="number" min="0" step="1" placeholder="Ex: 15" value="${(App.cart.tip || 0) > 20 ? App.cart.tip : ''}" onchange="App.setTip(parseInt(this.value) || 0)"></div>
      <div class="form-group"><label>Endereço de entrega</label>
        <input id="end-entrega" value="${esc(user.address || '')}" placeholder="Rua, número, complemento"></div>
      <div class="form-group"><label>Forma de pagamento</label>
        <select id="pagamento"><option>Pix</option><option>Dinheiro</option></select>
        <div class="muted" style="margin-top:4px">Aceitamos apenas Pix e Dinheiro.</div></div>
      <div class="form-group"><label>Observações (opcional)</label><textarea id="obs" rows="2" placeholder="Ex: sem cebola, ponto de referência..."></textarea></div>
      <button class="btn primary" onclick="App.fazerPedido()">Confirmar pedido • ${money(subtotal + fee + (App.cart.tip || 0))}</button>
    </div>`;
  App.renderCartBar();
}
App.setTip = function (v) {
  App.cart.tip = (Number.isInteger(v) && v >= 0) ? v : 0;
  App.navigate('cart');
};
App.fazerPedido = async function () {
  try {
    const body = {
      store_id: App.cart.store_id,
      items: App.cart.items.map(i => ({ product_id: i.product_id, quantity: i.qty })),
      delivery_address: document.getElementById('end-entrega').value.trim(),
      payment_method: document.getElementById('pagamento').value,
      notes: document.getElementById('obs').value.trim(),
      tip: App.cart.tip || 0,
    };
    const { order, message } = await API.post('/orders', body);
    toast(message);
    App.cart = { store_id: null, items: [], tip: 0 };
    const bar = document.getElementById('cart-bar'); if (bar) bar.remove();
    App._navOrderId = order.id;
    App.navigate('pedido');
  } catch (e) { toast(e.message, true); }
};

// Código pessoal do cliente (editável quantas vezes quiser; visível só para cliente e admin)
App.modalCodigoCliente = function () {
  const u = API.user();
  const box = document.getElementById('modal-box');
  document.getElementById('modal').classList.remove('hidden');
  box.innerHTML = `
    <h3>🔑 Meu código de entrega</h3>
    <p class="muted" style="margin-bottom:12px">É com este código que o entregador finaliza sua entrega. Você pode trocá-lo quando quiser. Ele só é visível para você e para a administração.</p>
    ${u.delivery_code ? `<div class="card" style="background:var(--primary-light);text-align:center"><div class="muted">Seu código atual:</div><div style="font-size:28px;font-weight:900;letter-spacing:4px;color:var(--primary-dark)">${esc(u.delivery_code)}</div></div>` : ''}
    <div class="form-group"><label>Novo código (4 a 6 dígitos)</label><input id="cc-codigo" maxlength="6" placeholder="Ex: 1234" value="${esc(u.delivery_code || '')}"></div>
    <div class="btn-row"><button class="btn ghost" onclick="App.fecharModal()">Cancelar</button>
      <button class="btn primary" onclick="App.salvarCodigoCliente()">Salvar código</button></div>`;
};
App.salvarCodigoCliente = async function () {
  try {
    const code = document.getElementById('cc-codigo').value.trim();
    if (code && (code.length < 4 || !/^\d+$/.test(code))) { toast('Use 4 a 6 dígitos numéricos.', true); return; }
    const { user } = await API.patch('/auth/me', { delivery_code: code || null });
    API.setUser(user);
    toast(code ? 'Código salvo!' : 'Código removido.');
    App.fecharModal();
    App.navigate(App.route);
  } catch (e) { toast(e.message, true); }
};

// ==================== CLIENTE: Meus pedidos ====================
async function App_renderClienteOrders(view) {
  const { orders } = await API.get('/orders');
  view.innerHTML = `<h1>Meus pedidos</h1><p class="sub">Acompanhe o status dos seus pedidos</p>
    <div id="lista-pedidos">${renderOrderList(orders, 'pedido')}</div>`;
}
function renderOrderList(orders, route) {
  if (!orders.length) return '<div class="empty"><span class="big">📦</span>Nenhum pedido ainda.</div>';
  return orders.map(o => `
    <div class="card clickable" onclick="App.navigate('${route}', ${o.id})">
      <div class="row"><h3>Pedido #${o.id} • ${esc(o.store_name || '')}</h3>
        <span class="badge ${o.status}">${STATUS_LABEL[o.status] || o.status}</span></div>
      <div class="meta" style="margin-top:4px">${money(o.total)} • ${new Date(o.created_at).toLocaleString('pt-BR')}</div>
    </div>`).join('');
}

// ==================== Detalhe do pedido (todos os roles) ====================
async function App_renderOrderDetail(view) {
  const id = App._navOrderId;
  const { order } = await API.get('/orders/' + id);
  const role = API.user().role;
  const me = API.user();
  let actions = '';

  if (role === 'loja') {
    if (order.status === 'pendente') {
      actions = `<button class="btn primary" onclick="App.mudarStatus(${order.id}, 'confirmado')">✅ Aceitar pedido</button>
        <div style="margin-top:8px"><button class="btn danger small" onclick="App.mudarStatus(${order.id}, 'cancelado')">✖ Recusar pedido</button></div>`;
    } else {
      const next = { confirmado: ['preparando', 'Marcar preparando'], preparando: ['pronto', 'Pronto p/ entrega'] }[order.status];
      if (next) actions = `<button class="btn primary" onclick="App.mudarStatus(${order.id}, '${next[0]}')">${next[1]}</button>`;
      if (['confirmado', 'preparando', 'pronto'].includes(order.status))
        actions += `<div style="margin-top:8px"><button class="btn danger small" onclick="App.mudarStatus(${order.id}, 'cancelado')">Cancelar pedido</button></div>`;
      if (order.status === 'pronto')
        actions += `<div style="margin-top:8px"><button class="btn ghost small" onclick="App.mudarStatus(${order.id}, 'preparando')">↩️ Ainda estou preparando</button></div>`;
    }
    // Código de coleta para a loja verificar o entregador
    if (order.coleta_code) {
      actions = (actions || '') + `<div class="card" style="border-left:4px solid var(--accent);margin:10px 0 0">
        <b>🏷️ Código de coleta do entregador: <span style="font-size:20px;letter-spacing:2px">${esc(order.coleta_code)}</span></b>
        <div class="muted">Peça ao entregador este código + o Nº do pedido #${order.id} + nome do cliente antes de entregar o pedido.</div>
      </div>`;
    }
  }

  if (role === 'entregador') {
    const souEu = order.delivery_person_id === me.id;
    if (!order.delivery_person_id && ['confirmado', 'preparando', 'pronto'].includes(order.status)) {
      actions = `<button class="btn primary" onclick="App.aceitarPedido(${order.id})">🛵 Aceitar entrega (ir até a loja)</button>
        <div class="muted" style="margin-top:6px;text-align:center">A loja já aceitou este pedido. Você pode ir agora, não espera ficar pronto.</div>`;
    }
    if (souEu && !order.coletado_at) {
      actions = (actions || '') + `
        <button class="btn ghost" onclick="App.modalNav(${order.store_lat || 'null'}, ${order.store_lng || 'null'}, '${esc(order.store_address || '')}', 'à loja')">🗺️ Como chegar à loja (Waze/Google)</button>
        <div style="height:8px"></div>
        <button class="btn primary" id="btn-cheguei" disabled>📍 Cheguei na loja</button>
        <div class="muted" id="cheguei-msg" style="margin-top:6px;text-align:center">Aproxime-se a até 100 m da loja — o botão libera sozinho.</div>
        ${order.arrived_at ? `<div class="card" style="border-left:4px solid var(--primary);margin-top:10px">
          <b>Nº do pedido para a loja: <span style="font-size:22px">#${order.id}</span></b>
          <div class="muted">Informe à loja este número. Quando o pedido estiver pronto, toque em "Coletar pedido".</div>
        </div>` : ''}
        ${order.status === 'pronto' && order.arrived_at ? `<button class="btn accent" style="margin-top:10px" onclick="App.coletarPedido(${order.id})">✅ Coletar pedido</button>
          <div class="muted" style="margin-top:6px;text-align:center">Após coletar, não será possível voltar atrás — a responsabilidade passa a ser sua.</div>` : ''}
        ${order.status !== 'pronto' && order.arrived_at ? `<div class="muted" style="margin-top:8px;text-align:center">⏳ Aguardando a loja marcar como pronto...</div>` : ''}
        <div style="text-align:center;margin-top:8px"><button class="btn ghost small" style="width:auto" onclick="App.modalDenuncia(${order.id})">⚠️ Não está pronto? Denunciar</button></div>`;
      // GPS watch para liberar o botão a ≤100m
      App._iniciarGpsCheguei(order);
    }
    if (souEu && order.coletado_at) {
      actions = (actions || '') + `
        <div class="card" style="border-left:4px solid var(--accent);margin-bottom:10px">
          <b>✅ Pedido coletado!</b>
          <div class="meta">Nº do pedido: <b>#${order.id}</b> • Código de coleta: <b>${esc(order.coleta_code || '—')}</b></div>
          <div class="muted">Responsabilidade: sua. Siga até o cliente.</div>
        </div>
        <button class="btn ghost" onclick="App.modalNav(null, null, '${esc(order.delivery_address || '')}', 'ao cliente')">🗺️ Ir até o cliente (Waze/Google)</button>
        <div style="height:8px"></div>
        <button class="btn primary" onclick="App.chegueiNoCliente(${order.id})">📍 Cheguei no endereço do cliente</button>
        ${order.customer_arrived_at ? `<div style="margin-top:8px"><button class="btn accent" onclick="App.modalFinalizar(${order.id})">🔑 Finalizar entrega (digite o código do cliente)</button></div>
          <div class="muted" style="margin-top:6px;text-align:center">Peça ao cliente o código cadastrado no perfil dele.</div>` : ''}
        ${!order.rated_store ? `<div style="margin-top:8px"><button class="btn ghost small" onclick="App.modalAvaliar(${order.id}, 'loja')">⭐ Avaliar a loja</button></div>` : ''}`;
    }
  }

  if (role === 'cliente') {
    if (order.status === 'a_caminho' && order.customer_arrived_at && !order.customer_responded)
      actions = `<div class="card" style="border-left:4px solid var(--accent);margin:0 0 10px"><b>🛵 O entregador chegou!</b>
        <div class="muted">Informe seu código de entrega a ele.</div>
        ${order.customer_delivery_code ? `<div style="margin-top:6px;font-size:22px;font-weight:900;letter-spacing:4px;color:var(--primary-dark)">${esc(order.customer_delivery_code)}</div>` : '<button class="btn primary small" style="margin-top:6px" onclick="App.modalCodigoCliente()">Cadastrar meu código</button>'}
        <button class="btn primary" style="margin-top:8px" onclick="App.clienteRespondeu(${order.id})">Confirmar recebimento</button></div>`;
    if (order.status === 'entregue' && !order.rated_delivery)
      actions = (actions || '') + `<button class="btn accent" style="margin-top:8px" onclick="App.modalAvaliar(${order.id}, 'entregador')">⭐ Avaliar o entregador</button>`;
    if (order.status === 'pendente')
      actions = `<button class="btn danger" onclick="App.mudarStatus(${order.id}, 'cancelado')">Cancelar pedido</button>`;
  }

  actions = (actions || '') + `<div style="margin-top:10px"><button class="btn ghost" onclick="App.modalChat(${order.id})">💬 Abrir chat (loja + cliente + entregador)</button></div>`;

  const steps = ['pendente', 'confirmado', 'preparando', 'pronto', 'a_caminho', 'entregue'];
  const stepIdx = order.status === 'cancelado' ? -1 : steps.indexOf(order.status);
  const timeline = order.status === 'cancelado' ? '<span class="badge cancelado">Cancelado</span>' :
    steps.map((s, i) => `<span class="tag" style="${i <= stepIdx ? '' : 'opacity:.4'}">${STATUS_LABEL[s]}</span>`).join(' › ');

  // Perfil público do entregador: nome + foto
  const entregaBlock = order.delivery_name ? `
      <div class="meta">🛵 Entregador: ${order.delivery_photo ? `<img src="${order.delivery_photo}" class="avatar-mini">` : ''} <b>${esc(order.delivery_social_name || order.delivery_name)}</b>${order.delivery_phone ? ` • ${esc(order.delivery_phone)}${phoneButtons(order.delivery_phone)}` : ''}</div>`
    : '<div class="meta">🛵 Aguardando entregador...</div>';

  view.innerHTML = `
    <button class="btn ghost small" style="width:auto;margin-bottom:10px" onclick="App.navigate('${homeForRole(role)}')">‹ Voltar</button>
    <div class="card">
      <div class="row"><h3>Pedido #${order.id}</h3><span class="badge ${order.status}">${STATUS_LABEL[order.status] || order.status}</span></div>
      <div class="meta" style="margin:8px 0">${timeline}</div>
      <div class="divider"></div>
      ${order.items.map(i => `<div class="row"><span>${i.quantity}x ${esc(i.product_name)}</span><span>${money(i.unit_price * i.quantity)}</span></div>`).join('')}
      <div class="divider"></div>
      <div class="row"><span class="muted">Subtotal</span><span>${money(order.subtotal)}</span></div>
      <div class="row"><span class="muted">Taxa de entrega</span><span>${money(order.delivery_fee)}</span></div>
      <div class="row" style="margin-top:6px"><b>Total</b><b class="price">${money(order.total)}</b></div>
    </div>
    <div class="card">
      <div class="section-title" style="margin-top:0">Entrega</div>
      <div class="meta">📍 ${esc(order.delivery_address)}</div>
      <div class="meta">💳 ${esc(order.payment_method || '')}</div>
      ${order.notes ? `<div class="meta">📝 ${esc(order.notes)}</div>` : ''}
      <div class="divider"></div>
      <div class="meta">🏪 ${esc(order.store_name)} — ${esc(order.store_address || '')}</div>
      <div class="meta">👤 Cliente: ${esc(order.customer_name)}${order.customer_phone ? ` • ${esc(order.customer_phone)}${phoneButtons(order.customer_phone)}` : ''}</div>
      ${entregaBlock}
    </div>
    ${actions ? `<div class="card">${actions}</div>` : ''}
    <div style="text-align:center;margin-top:10px"><button class="btn ghost small" style="width:auto" onclick="App.refreshPedido(${order.id})">🔄 Atualizar</button></div>`;
}
App.refreshPedido = function (id) { App._navOrderId = id; App.navigate('pedido'); };
App.mudarStatus = async function (id, status) {
  try {
    await API.patch('/orders/' + id + '/status', { status });
    toast('Status atualizado!');
    App.refreshPedido(id);
  } catch (e) { toast(e.message, true); }
};
App.aceitarPedido = async function (id) {
  try {
    const r = await API.patch('/orders/' + id + '/aceitar', {});
    toast(r.message);
    App.refreshPedido(id);
  } catch (e) { toast(e.message, true); }
};
App.coletarPedido = async function (id) {
  if (!confirm('Tem certeza que deseja coletar o pedido AGORA?\n\nApós confirmar, NÃO será possível voltar atrás. A responsabilidade pelo pedido passa a ser sua.')) return;
  try {
    const r = await API.patch('/orders/' + id + '/coletar', {});
    toast('Pedido coletado! Vá até o cliente.');
    App.refreshPedido(id);
  } catch (e) { toast(e.message, true); }
};
App.modalFinalizar = function (orderId) {
  const box = document.getElementById('modal-box');
  document.getElementById('modal').classList.remove('hidden');
  box.innerHTML = `
    <h3>🔑 Finalizar entrega</h3>
    <p class="muted" style="margin-bottom:12px">Peça ao cliente o código pessoal dele (cadastrado no perfil) e digite abaixo. Sem o código correto a entrega não é finalizada.</p>
    <div class="form-group"><label>Código do cliente</label><input id="fin-codigo" maxlength="6" placeholder="000000"></div>
    <div class="btn-row"><button class="btn ghost" onclick="App.fecharModal()">Cancelar</button>
      <button class="btn primary" onclick="App.finalizarEntrega(${orderId})">Finalizar entrega</button></div>`;
};
App.finalizarEntrega = async function (orderId) {
  try {
    const r = await API.patch('/orders/' + orderId + '/finalizar', { delivery_code: document.getElementById('fin-codigo').value.trim() });
    toast(r.message);
    App.fecharModal();
    App.refreshPedido(orderId);
  } catch (e) { toast(e.message, true); }
};

// GPS: libera o botão "Cheguei na loja" automaticamente a ≤100m
App._iniciarGpsCheguei = function (order) {
  const btn = document.getElementById('btn-cheguei');
  const msg = document.getElementById('cheguei-msg');
  if (!btn) return;
  if (!order.store_lat || !order.store_lng || !navigator.geolocation) {
    btn.disabled = false; btn.textContent = '📍 Cheguei na loja';
    if (msg) msg.textContent = 'Toque ao chegar na loja.';
    btn.onclick = () => App.chegueiNaLoja(order.id);
    return;
  }
  btn.onclick = () => App.chegueiNaLoja(order.id);
  const checar = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const dist = haversineJs(pos.coords.latitude, pos.coords.longitude, order.store_lat, order.store_lng);
        if (dist <= 0.1) {
          btn.disabled = false; btn.textContent = '📍 Cheguei na loja';
          if (msg) msg.textContent = '✓ Você está a até 100 m da loja. Toque em "Cheguei na loja".';
        } else {
          btn.disabled = true; btn.textContent = `📍 A ${Math.round(dist * 1000)} m da loja`;
          if (msg) msg.textContent = 'Aproxime-se a até 100 m da loja — o botão libera sozinho.';
        }
      },
      () => { btn.disabled = false; btn.textContent = '📍 Cheguei na loja'; if (msg) msg.textContent = 'Não foi possível usar o GPS. Toque ao chegar.'; },
      { timeout: 8000 }
    );
  };
  checar();
  this._gpsTimer = setInterval(checar, 5000);
};
function haversineJs(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
App.chegueiNaLoja = function (orderId) {
  if (!navigator.geolocation) { App._cheguei(orderId, null, null); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => App._cheguei(orderId, pos.coords.latitude, pos.coords.longitude),
    () => App._cheguei(orderId, null, null),
    { timeout: 8000 }
  );
};
App._cheguei = async function (orderId, lat, lng) {
  try {
    const r = await API.patch('/orders/' + orderId + '/cheguei', { lat, lng });
    toast(r.message); App.refreshPedido(orderId);
  } catch (e) { toast(e.message, true); }
};
App.chegueiNoCliente = async function (orderId) {
  try {
    const r = await API.patch('/orders/' + orderId + '/cheguei-cliente', {});
    toast(r.message); App.refreshPedido(orderId);
  } catch (e) { toast(e.message, true); }
};
App.clienteRespondeu = async function (orderId) {
  try { await API.patch('/orders/' + orderId + '/cliente-respondeu', {}); toast('Registrado.'); App.refreshPedido(orderId); }
  catch (e) { toast(e.message, true); }
};

// ==================== LOJA: Pedidos recebidos ====================
async function App_renderLojaOrders(view) {
  const [{ orders }, { warnings, unread }, { user }] = await Promise.all([
    API.get('/orders'),
    API.get('/reports/warnings/mine').catch(() => ({ warnings: [], unread: 0 })),
    API.get('/auth/me'),
  ]);
  API.setUser(user);
  const active = orders.filter(o => !['entregue', 'cancelado'].includes(o.status));
  const done = orders.filter(o => ['entregue', 'cancelado'].includes(o.status)).slice(0, 20);
  view.innerHTML = `
    <h1>Pedidos da loja</h1>
    <p class="sub">${active.length} pedido(s) em andamento • 💰 A receber: <b>${money(user.balance)}</b></p>
    ${unread > 0 ? `<div class="card" style="border-left:4px solid var(--accent)">
      <h3>🔔 Você tem ${unread} aviso(s) da equipe</h3>
      ${warnings.filter(w => !w.read).slice(0, 2).map(w => `<div class="meta" style="margin:6px 0">"${esc(w.message)}"</div>`).join('')}
      <button class="btn ghost small" style="margin-top:6px" onclick="App.lerAvisos()">Tudo bem, entendi ✓</button>
    </div>` : ''}
    <div class="section-title">Em andamento</div>
    ${active.length ? active.map(o => lojaOrderCard(o)).join('') : '<div class="empty">Nenhum pedido ativo.</div>'}
    <div class="section-title">Finalizados</div>
    ${done.length ? done.map(o => lojaOrderCard(o)).join('') : '<div class="muted">Nenhum.</div>'}`;
}
function lojaOrderCard(o) {
  const next = { pendente: ['confirmado', 'Aceitar pedido'], confirmado: ['preparando', 'Preparando'], preparando: ['pronto', 'Pronto'] }[o.status];
  return `<div class="card">
    <div class="row"><h3>#${o.id} • ${esc(o.customer_name || '')}</h3><span class="badge ${o.status}">${STATUS_LABEL[o.status]}</span></div>
    <div class="meta">${money(o.total)} • ${new Date(o.created_at).toLocaleString('pt-BR')}</div>
    <div class="meta" style="margin:4px 0">📍 ${esc(o.delivery_address)}</div>
    ${o.coleta_code ? `<div class="meta">🏷️ Código de coleta do entregador: <b>${esc(o.coleta_code)}</b></div>` : ''}
    ${next ? `<button class="btn primary small" style="margin-top:8px" onclick="App.mudarStatus(${o.id}, '${next[0]}')">${next[1]}</button>` : ''}
    ${o.status === 'pendente' ? ` <button class="btn danger small" style="margin-top:8px" onclick="App.mudarStatus(${o.id}, 'cancelado')">Recusar</button>` : ''}
    ${o.status === 'pronto' ? `<button class="btn ghost small" style="margin-top:8px" onclick="App.mudarStatus(${o.id}, 'preparando')">↩️ Ainda preparando</button>` : ''}
    ${['confirmado', 'preparando'].includes(o.status) ? ` <button class="btn danger small" style="margin-top:8px" onclick="App.mudarStatus(${o.id}, 'cancelado')">Cancelar</button>` : ''}
  </div>`;
}

// ==================== LOJA: Produtos (com foto) ====================
async function App_renderLojaProducts(view) {
  const { store } = await API.get('/stores/mine/store');
  if (!store) {
    view.innerHTML = `<div class="empty"><span class="big">🏪</span>Você ainda não criou sua loja.<br><br>
      <button class="btn primary small" style="width:auto" onclick="App.navigate('loja-loja')">Criar minha loja</button></div>`;
    return;
  }
  view.innerHTML = `
    <div class="row"><h1>Produtos</h1><button class="btn primary small" onclick="App.modalProduto()">+ Adicionar</button></div>
    <p class="sub">${esc(store.name)} ${store.is_approved ? '' : '• ⚠️ aguardando aprovação do admin'}</p>
    <div class="card">${store.products.length ? store.products.map(p => `
      <div class="product-item">
        ${p.image ? `<img src="${p.image}" class="prod-img">` : ''}
        <div class="p-info"><div class="p-name">${esc(p.name)} ${p.available ? '' : '<span class="tag" style="background:#fee2e2;color:#991b1b">off</span>'}</div>
          <div class="p-desc">${esc(p.description || '')}</div><div class="price">${money(p.price)}</div></div>
        <div class="btn-row"><button class="btn ghost small" onclick='App.modalProduto(${JSON.stringify(p).replace(/'/g, "&#39;")})'>Editar</button>
          <button class="btn danger small" onclick="App.delProduto(${p.id})">Excluir</button></div>
      </div>`).join('') : '<div class="muted">Nenhum produto. Clique em "+ Adicionar" e inclua uma foto do prato/bebida/sobremesa.</div>'}</div>`;
}
App.modalProduto = function (p) {
  App._prodFoto = p?.image || null;
  const box = document.getElementById('modal-box');
  document.getElementById('modal').classList.remove('hidden');
  box.innerHTML = `
    <h3>${p ? 'Editar produto' : 'Novo produto'}</h3>
    <div class="form-group"><label>Foto do prato/bebida/sobremesa (opcional, mas recomendada)</label>
      <input type="file" id="mp-foto" accept="image/*" onchange="App._lerFotoProduto(this)">
      ${App._prodFoto ? `<img src="${App._prodFoto}" class="avatar-preview">` : ''}</div>
    <div class="form-group"><label>Nome</label><input id="mp-nome" value="${esc(p?.name || '')}"></div>
    <div class="form-group"><label>Descrição</label><input id="mp-desc" value="${esc(p?.description || '')}"></div>
    <div class="form-group"><label>Preço (R$)</label><input id="mp-preco" type="number" step="0.01" value="${p?.price ?? ''}"></div>
    <div class="form-group"><label>Categoria</label><input id="mp-cat" value="${esc(p?.category || '')}" placeholder="Ex: Pratos, Bebidas, Sobremesas..."></div>
    <div class="form-group"><label><input type="checkbox" id="mp-ativo" ${p?.available === false ? '' : 'checked'}> Disponível</label></div>
    <div class="btn-row"><button class="btn ghost" onclick="App.fecharModal()">Cancelar</button>
      <button class="btn primary" onclick="App.salvarProduto(${p?.id || 'null'})">Salvar</button></div>`;
};
App._lerFotoProduto = function (input) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    App._prodFoto = r.result;
    let prev = document.getElementById('mp-foto-preview');
    if (!prev) {
      prev = document.createElement('img');
      prev.id = 'mp-foto-preview';
      prev.className = 'avatar-preview';
      input.parentNode.insertBefore(prev, input.nextSibling);
    }
    prev.src = r.result;
  };
  r.readAsDataURL(f);
};
App.salvarProduto = async function (id) {
  try {
    const body = {
      name: document.getElementById('mp-nome').value.trim(),
      description: document.getElementById('mp-desc').value.trim(),
      price: parseFloat(document.getElementById('mp-preco').value),
      category: document.getElementById('mp-cat').value.trim(),
      available: document.getElementById('mp-ativo').checked,
      image: App._prodFoto || null,
    };
    if (!body.name || isNaN(body.price)) { toast('Nome e preço são obrigatórios.', true); return; }
    if (id) await API.put('/stores/mine/products/' + id, body);
    else await API.post('/stores/mine/products', body);
    toast('Produto salvo!'); App.fecharModal(); App.navigate('loja-produtos');
  } catch (e) { toast(e.message, true); }
};
App.delProduto = async function (id) {
  if (!confirm('Excluir este produto?')) return;
  try { await API.del('/stores/mine/products/' + id); toast('Excluído.'); App.navigate('loja-produtos'); }
  catch (e) { toast(e.message, true); }
};

// ==================== LOJA: Dados da loja (com localização) ====================
async function App_renderLojaStore(view) {
  const { store } = await API.get('/stores/mine/store');
  view.innerHTML = `
    <h1>Minha loja</h1>
    <p class="sub">${store ? (store.is_approved ? 'Aprovada e no ar' : 'Pendente de aprovação do administrador') : 'Crie sua loja para começar a vender'}</p>
    <div class="card">
      <div class="form-group"><label>Nome da loja</label><input id="ls-nome" value="${esc(store?.name || '')}"></div>
      <div class="form-group"><label>Descrição</label><input id="ls-desc" value="${esc(store?.description || '')}"></div>
      <div class="form-group"><label>Categoria</label><input id="ls-cat" value="${esc(store?.category || '')}" placeholder="Ex: Pizza, Açaí, Doces..."></div>
      <div class="form-group"><label>Endereço</label><input id="ls-end" value="${esc(store?.address || '')}"></div>
      <div class="form-group"><label>Cidade</label><input id="ls-cidade" value="${esc(store?.city || '')}"></div>
      <div class="form-group"><label>Taxa de entrega (R$)</label><input id="ls-taxa" type="number" step="0.01" value="${store?.delivery_fee ?? 0}"></div>
      <div class="form-group"><label>Tempo de entrega</label><input id="ls-tempo" value="${esc(store?.delivery_time || '')}" placeholder="30-45 min"></div>
      <div class="form-group"><label>Localização (latitude, longitude) — para o entregador encontrar a loja</label>
        <div style="display:flex;gap:8px"><input id="ls-lat" placeholder="-23.5505" value="${store?.lat ?? ''}" style="flex:1"><input id="ls-lng" placeholder="-46.6333" value="${store?.lng ?? ''}" style="flex:1"></div>
        <button type="button" class="btn ghost small" style="width:auto;margin-top:6px" onclick="App.usarMinhaLocalizacaoLoja()">📍 Usar minha localização atual</button></div>
      <div class="form-group"><label><input type="checkbox" id="ls-aberto" ${store?.is_open ? 'checked' : ''}> Loja aberta agora</label></div>
      <button class="btn primary" onclick="App.salvarLoja()">Salvar loja</button>
    </div>`;
}
App.usarMinhaLocalizacaoLoja = function () {
  if (!navigator.geolocation) { toast('GPS não disponível.', true); return; }
  navigator.geolocation.getCurrentPosition((pos) => {
    document.getElementById('ls-lat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('ls-lng').value = pos.coords.longitude.toFixed(6);
    toast('Localização preenchida!');
  }, () => toast('Não foi possível obter localização.', true), { timeout: 8000 });
};
App.salvarLoja = async function () {
  try {
    const body = {
      name: document.getElementById('ls-nome').value.trim(),
      description: document.getElementById('ls-desc').value.trim(),
      category: document.getElementById('ls-cat').value.trim(),
      address: document.getElementById('ls-end').value.trim(),
      city: document.getElementById('ls-cidade').value.trim(),
      delivery_fee: parseFloat(document.getElementById('ls-taxa').value) || 0,
      delivery_time: document.getElementById('ls-tempo').value.trim(),
      is_open: document.getElementById('ls-aberto').checked,
      lat: document.getElementById('ls-lat').value || null,
      lng: document.getElementById('ls-lng').value || null,
    };
    if (!body.name) { toast('Nome da loja é obrigatório.', true); return; }
    const r = await API.post('/stores/mine', body);
    toast(r.message || 'Loja salva!'); App.navigate('loja-loja');
  } catch (e) { toast(e.message, true); }
};

App.lerAvisos = async function () {
  try {
    const { warnings } = await API.get('/reports/warnings/mine');
    for (const w of warnings.filter(w => !w.read)) await API.patch('/reports/warnings/' + w.id + '/read');
    toast('Avisos marcados como lidos.'); App.navigate('loja-pedidos');
  } catch (e) { toast(e.message, true); }
};

// ==================== ENTREGADOR ====================
async function App_renderEntregador(view) {
  const me = API.user();
  // Atualiza localização para matching com o entregador mais próximo
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => API.post('/auth/location', { lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => { }),
      () => { }, { timeout: 8000 }
    );
  }
  const { orders: available, minha_localizacao } = await API.get('/orders/available').catch(e => ({ orders: [], minha_localizacao: false }));
  const { orders: all } = await API.get('/orders');
  const minhas = all.filter(o => o.delivery_person_id === me.id && !['entregue', 'cancelado'].includes(o.status));
  const concluidas = all.filter(o => o.delivery_person_id === me.id && o.status === 'entregue');
  const { user } = await API.get('/auth/me');
  API.setUser(user);

  view.innerHTML = `
    <h1>Olá, ${esc((user.social_name || user.name).split(' ')[0])} 🛵</h1>
    <div class="card">
      <div class="row"><div><div class="muted">Ganhos acumulados</div>
        <div style="font-size:24px;font-weight:800;color:var(--primary)">${money(user.balance)}</div></div>
        <div style="text-align:right"><div class="muted">Entregas feitas</div>
        <div style="font-size:24px;font-weight:800">${concluidas.length}</div></div></div>
    </div>
    <div class="btn-row" style="margin-bottom:12px">
      <button class="btn ghost small" onclick="App.modalPix()">💳 ${user.pix_key ? 'Meu Pix' : 'Cadastrar Pix'}</button>
      <button class="btn ghost small" onclick="App.modalAntecip()">💸 Antecipar</button>
      <button class="btn ghost small" onclick="App.modalFeedback()">📬 Opinião</button>
    </div>
    ${minhas.length ? `<div class="section-title">Sua entrega atual</div>
      ${minhas.map(o => `<div class="card clickable" onclick="App.navigate('pedido', ${o.id})">
        <div class="row"><h3>Pedido #${o.id}</h3><span class="badge ${o.status}">${STATUS_LABEL[o.status]}</span></div>
        <div class="meta">🏪 ${esc(o.store_name || '')}</div>
        <div class="meta">📍 ${esc(o.delivery_address)}</div>
        <div class="meta">💰 Ganho: ${money(o.delivery_fee)}</div>
      </div>`).join('')}
    ` : ''}
    <div class="section-title">Pedidos aceitos pela loja — disponíveis para você (${available.length})</div>
    ${available.length ? available.map(o => `<div class="card">
      <div class="row"><h3>Pedido #${o.id}</h3><span class="badge ${o.status}">${STATUS_LABEL[o.status]}</span></div>
      <div class="meta">🏪 ${esc(o.store_name)} — ${esc(o.store_address || '')}</div>
      ${o.distancia_km != null ? `<div class="meta">📏 Distância até a loja: ${(o.distancia_km < 1 ? Math.round(o.distancia_km * 1000) + ' m' : o.distancia_km.toFixed(1) + ' km')}</div>` : ''}
      <div class="meta">📍 Entrega: ${esc(o.delivery_address)}</div>
      <div class="meta">💰 Ganho: ${money(o.delivery_fee)}</div>
      <button class="btn primary" style="margin-top:8px" onclick="App.aceitarPedido(${o.id})">Aceitar entrega</button>
    </div>`).join('') : `<div class="empty"><span class="big">🛵</span>Nenhum pedido disponível no momento.<br>Atualize em breve.</div>`}
    <div style="text-align:center;margin-top:10px"><button class="btn ghost small" style="width:auto" onclick="App.navigate('entregador')">🔄 Atualizar</button></div>`;
}

// ==================== ADMIN ====================
async function App_renderAdminHome(view) {
  const [stats, { users }, { stores }, { reports }, fin, fb, adv, wait] = await Promise.all([
    API.get('/admin/stats'), API.get('/admin/users?status=pendente'), API.get('/admin/stores'),
    API.get('/reports?status=aberto').catch(() => ({ reports: [] })),
    API.get('/admin/finance').catch(() => null),
    API.get('/feedback').catch(() => ({ unread: 0 })),
    API.get('/advances').catch(() => ({ advances: [] })),
    API.get('/admin/waiting').catch(() => ({ total: 0 })),
  ]);
  const lojasPendentes = stores.filter(s => !s.is_approved);
  const abertas = reports.length;
  const pendAdv = (adv.advances || []).filter(a => a.status === 'pendente').length;
  view.innerHTML = `
    <h1>Painel administrativo</h1>
    <p class="sub">Visão geral da plataforma Pediu Chegou</p>
    <div class="stats-grid">
      <div class="stat"><div class="num">${stats.users}</div><div class="lbl">Usuários totais</div></div>
      <div class="stat"><div class="num">${stats.entregadores}</div><div class="lbl">Entregadores</div></div>
      <div class="stat"><div class="num">${stats.lojas}</div><div class="lbl">Lojas</div></div>
      <div class="stat"><div class="num">${stats.orders}</div><div class="lbl">Pedidos</div></div>
      <div class="stat"><div class="num">${money(fin ? fin.commission_earned : 0)}</div><div class="lbl">Comissão recebida (${fin ? fin.commission_pct : 15}%)</div></div>
      <div class="stat warn"><div class="num">${stats.pending_approvals}</div><div class="lbl">Pendentes de aprovação</div></div>
    </div>
    <div class="card clickable" onclick="App.navigate('admin-denuncias')">
      <div class="row"><div><h3>⚠️ Denúncias de atraso</h3>
        <div class="meta">Entregadores relatam lojas que marcaram "pronto" antes da hora</div></div>
      <span class="badge ${abertas ? 'pendente' : 'ativo'}">${abertas} aberta(s)</span></div>
    </div>
    <div class="card clickable" onclick="App.navigate('admin-financeiro')">
      <div class="row"><div><h3>💰 Financeiro e liquidação</h3>
        <div class="meta">A pagar: ${money(fin?.a_pagar || 0)} • A receber (entregadores em dinheiro): ${money(fin?.a_receber || 0)}</div></div>
      <span style="color:var(--muted)">›</span></div>
    </div>
    <div class="card clickable" onclick="App.navigate('admin-espera')">
      <div class="row"><div><h3>📞 Suporte — entregadores esperando</h3></div>
      <span class="badge ${wait.total ? 'pendente' : 'ativo'}">${wait.total || 0}</span></div>
    </div>
    <div class="card clickable" onclick="App.navigate('admin-antecipos')">
      <div class="row"><div><h3>💸 Antecipos solicitados</h3></div>
      <span class="badge ${pendAdv ? 'pendente' : 'ativo'}">${pendAdv}</span></div>
    </div>
    <div class="card clickable" onclick="App.navigate('admin-feedback')">
      <div class="row"><div><h3>📬 Caixa de opiniões</h3></div>
      <span class="badge ${fb.unread ? 'pendente' : 'ativo'}">${fb.unread || 0}</span></div>
    </div>
    <div class="section-title">Aprovações pendentes</div>
    ${users.length || lojasPendentes.length ? `
      ${users.map(u => `<div class="card"><div class="row"><div>
        ${u.photo ? `<img src="${u.photo}" class="avatar-mini">` : ''}<h3>${esc(u.social_name || u.name)} ${u.surname ? esc(' ' + u.surname) : ''}</h3>
        <div class="meta">${esc(u.role)} • ${esc(u.email)} • CPF ${esc(u.cpf || '—')}</div>
        <div class="meta">${u.vehicle_type === 'bicicleta' ? `🚲 Bike ${esc(u.bike_color || '')} aro ${esc(u.bike_wheel_size || '')} ${u.bike_electric ? '(elétrica)' : ''}` : u.vehicle_type === 'moto' ? `🏍️ ${esc(u.moto_brand || '')} ${esc(u.moto_model || '')} ${esc(u.moto_color || '')} ${esc(u.moto_cyl || '')} • RENAVAM ${esc(u.renavam || '—')}` : esc(u.vehicle || '')}</div>
        ${u.cnh_front ? `<img src="${u.cnh_front}" class="doc-img" title="CNH frente">` : ''}
        ${u.cnh_back ? `<img src="${u.cnh_back}" class="doc-img" title="CNH verso">` : ''}
        ${u.moto_doc ? `<img src="${u.moto_doc}" class="doc-img" title="Documento da moto">` : ''}
      </div>
      <div class="btn-row"><button class="btn primary small" onclick="App.adminUserStatus(${u.id}, 'ativo')">Aprovar</button>
        <button class="btn danger small" onclick="App.adminUserStatus(${u.id}, 'bloqueado')">Bloquear</button></div></div></div>`).join('')}
      ${lojasPendentes.map(s => `<div class="card"><div class="row"><div><h3>🏪 ${esc(s.name)}</h3>
        <div class="meta">Dono: ${esc(s.owner_name)} • ${esc(s.category || '')} • ${esc(s.city || '')}</div></div>
        <div class="btn-row"><button class="btn primary small" onclick="App.adminStore(${s.id}, true)">Aprovar</button>
        <button class="btn danger small" onclick="App.adminStore(${s.id}, false)">Rejeitar</button></div></div></div>`).join('')}
    ` : '<div class="empty"><span class="big">✅</span>Nenhuma aprovação pendente.</div>'}`;
}
App.adminUserStatus = async function (id, status) {
  try { await API.patch('/admin/users/' + id, { status }); toast('Usuário atualizado.'); App.navigate('admin'); }
  catch (e) { toast(e.message, true); }
};
App.adminStore = async function (id, approve) {
  try { await API.patch('/admin/stores/' + id, { is_approved: approve, is_open: approve ? 1 : 0 }); toast(approve ? 'Loja aprovada!' : 'Loja rejeitada.'); App.navigate('admin'); }
  catch (e) { toast(e.message, true); }
};

async function App_renderAdminUsers(view) {
  const { users } = await API.get('/admin/users');
  view.innerHTML = `<h1>Usuários</h1><p class="sub">${users.length} cadastros</p>
    ${users.map(u => `<div class="card"><div class="row"><div>
      ${u.photo ? `<img src="${u.photo}" class="avatar-mini">` : ''}<h3>${esc(u.social_name || u.name)}</h3>
      <div class="meta">${esc(u.role)} • ${esc(u.email)} • ${esc(u.phone || '')}${phoneButtons(u.phone)}</div>
      <div class="meta">${esc(u.city || '')} ${u.vehicle ? '• ' + esc(u.vehicle) + ' ' + esc(u.plate || '') : ''} ${u.balance ? '• R$ ' + Number(u.balance).toFixed(2).replace('.', ',') : ''}</div></div>
      <div><span class="badge ${u.status}">${u.status}</span>
      ${u.role !== 'admin' ? `<div class="btn-row" style="margin-top:6px">
        ${u.status !== 'ativo' ? `<button class="btn primary small" onclick="App.adminUserStatus(${u.id}, 'ativo')">Liberar</button>` : ''}
        ${u.status !== 'bloqueado' ? `<button class="btn danger small" onclick="App.adminUserStatus(${u.id}, 'bloqueado')">Bloquear</button>` : ''}
      </div>` : ''}</div></div></div>`).join('')}`;
}

async function App_renderAdminStores(view) {
  const { stores } = await API.get('/admin/stores');
  view.innerHTML = `<h1>Lojas</h1><p class="sub">${stores.length} lojas cadastradas</p>
    ${stores.map(s => `<div class="card"><div class="row"><div><h3>${esc(s.name)}</h3>
      <div class="meta">${esc(s.category || '')} • ${esc(s.city || '')} • Dono: ${esc(s.owner_name)}</div>
      <div class="meta">Taxa ${money(s.delivery_fee)} • ${s.is_open ? 'Aberta' : 'Fechada'}</div></div>
      <div>${s.is_approved ? '<span class="badge ativo">Aprovada</span>' : '<span class="badge pendente">Pendente</span>'}
      <div class="btn-row" style="margin-top:6px">
        <button class="btn ${s.is_approved ? 'ghost' : 'primary'} small" onclick="App.adminStore(${s.id}, ${!s.is_approved})">${s.is_approved ? 'Suspender' : 'Aprovar'}</button>
      </div></div></div></div>`).join('')}`;
}

async function App_renderAdminOrders(view) {
  const { orders } = await API.get('/admin/orders');
  view.innerHTML = `<h1>Pedidos</h1><p class="sub">Últimos ${orders.length} pedidos</p>
    <div id="lista-pedidos">${renderOrderList(orders, 'pedido')}</div>`;
}

// ==================== DENÚNCIAS ====================
App.modalDenuncia = function (orderId) {
  const box = document.getElementById('modal-box');
  document.getElementById('modal').classList.remove('hidden');
  box.innerHTML = `
    <h3>⚠️ O pedido não estava pronto?</h3>
    <p class="muted" style="margin-bottom:12px">Conte o que aconteceu. Se quiser, envie uma foto. Você NÃO será prejudicado.</p>
    <div class="form-group"><label>O que aconteceu?</label>
      <textarea id="den-motivo" rows="3" placeholder="Ex: Cheguei na loja e ainda estavam preparando..."></textarea></div>
    <div class="form-group"><label>Foto (opcional)</label><input type="file" id="den-foto" accept="image/*"></div>
    <div class="btn-row"><button class="btn ghost" onclick="App.fecharModal()">Cancelar</button>
      <button class="btn primary" onclick="App.enviarDenuncia(${orderId})">Enviar denúncia</button></div>`;
};
App.enviarDenuncia = async function (orderId) {
  try {
    const reason = document.getElementById('den-motivo').value.trim();
    if (!reason) { toast('Conte o que aconteceu.', true); return; }
    const file = document.getElementById('den-foto').files[0];
    let photo = null;
    if (file) photo = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    const r = await API.post('/reports', { order_id: orderId, reason, photo });
    toast(r.message); App.fecharModal(); App.navigate('entregador');
  } catch (e) { toast(e.message, true); }
};

async function App_renderAdminDenuncias(view) {
  const { reports } = await API.get('/reports');
  view.innerHTML = `
    <button class="btn ghost small" style="width:auto;margin-bottom:10px" onclick="App.navigate('admin')">‹ Voltar</button>
    <h1>Denúncias de atraso</h1>
    ${reports.length ? reports.map(r => `
      <div class="card">
        <div class="row"><h3>Pedido #${r.order_id} — ${esc(r.store_name)}</h3>
          <span class="badge ${r.status === 'aberto' ? 'pendente' : 'ativo'}">${r.status === 'aberto' ? 'Aberta' : 'Resolvida'}</span></div>
        <div class="meta">Entregador: ${esc(r.delivery_name)} • ${new Date(r.created_at).toLocaleString('pt-BR')}</div>
        <div style="margin:8px 0;padding:10px;background:var(--bg);border-radius:8px;font-size:13px">"${esc(r.reason)}"</div>
        ${r.photo ? `<img src="${r.photo}" style="max-width:100%;border-radius:8px;margin-bottom:8px;max-height:200px;object-fit:cover">` : ''}
        ${r.resolution ? `<div class="muted">Resolução: ${esc(r.resolution)}</div>` : `
        <div class="btn-row" style="margin-top:8px">
          <button class="btn primary small" onclick="App.resolverDenuncia(${r.id}, true)">Enviar aviso amigável à loja</button>
          <button class="btn ghost small" onclick="App.resolverDenuncia(${r.id}, false)">Arquivar</button>
        </div>`}
      </div>`).join('') : '<div class="empty"><span class="big">✅</span>Nenhuma denúncia.</div>'}`;
}
App.resolverDenuncia = async function (id, warn) {
  try {
    const r = await API.patch('/reports/' + id, { warn_loja: warn, resolution: warn ? 'Aviso amigável enviado à loja.' : 'Arquivado pela equipe.' });
    toast(r.message); App.navigate('admin-denuncias');
  } catch (e) { toast(e.message, true); }
};

// ==================== FINANCEIRO ====================
async function App_renderAdminFinanceiro(view) {
  const fin = await API.get('/admin/finance');
  const set = await API.get('/admin/settings');
  view.innerHTML = `
    <button class="btn ghost small" style="width:auto;margin-bottom:10px" onclick="App.navigate('admin')">‹ Voltar</button>
    <h1>Financeiro</h1>
    <div class="stats-grid">
      <div class="stat"><div class="num">${money(fin.commission_earned)}</div><div class="lbl">Comissão acumulada (${fin.commission_pct}%)</div></div>
      <div class="stat warn"><div class="num">${money(fin.a_pagar)}</div><div class="lbl">A pagar (lojas + entregadores)</div></div>
      <div class="stat"><div class="num">${money(fin.a_receber)}</div><div class="lbl">A receber (entregadores em dinheiro)</div></div>
      <div class="stat"><div class="num">${fin.lojas.length + fin.entregadores.length}</div><div class="lbl">Contas com saldo</div></div>
    </div>
    <div class="section-title">A pagar às lojas</div>
    ${fin.lojas.length ? fin.lojas.map(u => `<div class="card"><div class="row"><div><h3>${esc(u.name)}</h3><div class="meta">${esc(u.email)} • ${esc(u.phone || '')}${phoneButtons(u.phone)}</div></div>
      <div><div class="price" style="font-size:18px">${money(u.balance)}</div>
      <button class="btn primary small" style="margin-top:6px" onclick="App.liquidar(${u.id})">Pagar</button></div></div></div>`).join('') : '<div class="muted">Nada a pagar.</div>'}
    <div class="section-title">Entregadores</div>
    ${fin.entregadores.length ? fin.entregadores.map(u => `<div class="card"><div class="row"><div><h3>${esc(u.name)}</h3>
      <div class="meta">${esc(u.vehicle || '')} • ${esc(u.phone || '')}${phoneButtons(u.phone)}</div></div>
      <div><div class="price" style="font-size:18px;color:${u.balance < 0 ? 'var(--danger)' : 'var(--primary-dark)'}">${money(u.balance)}</div>
      <button class="btn ${u.balance < 0 ? 'accent' : 'primary'} small" style="margin-top:6px" onclick="App.liquidar(${u.id})">${u.balance < 0 ? 'Receber' : 'Pagar'}</button></div></div></div>`).join('') : '<div class="muted">Nenhum saldo.</div>'}
    <div class="section-title">Configurações</div>
    <div class="card">
      <div class="form-group"><label>Comissão da plataforma sobre as vendas (%)</label>
        <input id="set-comissao" type="number" value="${set.commission_pct}"></div>
      <div class="form-group"><label>Taxa de entrega mínima (R$)</label>
        <input id="set-min" type="number" step="0.01" value="${set.min_delivery_fee}"></div>
      <button class="btn primary" onclick="App.salvarSettings()">Salvar configurações</button>
    </div>`;
}
App.liquidar = async function (id) {
  if (!confirm('Confirmar liquidação deste saldo?')) return;
  try { const r = await API.post('/admin/settle/' + id); toast(r.message); App.navigate('admin-financeiro'); }
  catch (e) { toast(e.message, true); }
};
App.salvarSettings = async function () {
  try {
    await API.patch('/admin/settings', {
      commission_pct: parseFloat(document.getElementById('set-comissao').value),
      min_delivery_fee: parseFloat(document.getElementById('set-min').value),
    });
    toast('Configurações salvas!');
  } catch (e) { toast(e.message, true); }
};

// ==================== PIX / ANTECIPOS / OPINIÃO ====================
App.modalPix = function () {
  const u = API.user();
  const box = document.getElementById('modal-box');
  document.getElementById('modal').classList.remove('hidden');
  box.innerHTML = `<h3>💳 Minha chave Pix</h3>
    <div class="form-group"><label>Chave Pix (CPF, email, telefone ou aleatória)</label>
      <input id="pix-chave" value="${esc(u.pix_key || '')}" placeholder="000.000.000-00"></div>
    <div class="btn-row"><button class="btn ghost" onclick="App.fecharModal()">Cancelar</button>
      <button class="btn primary" onclick="App.salvarPix()">Salvar</button></div>`;
};
App.salvarPix = async function () {
  try {
    const { user } = await API.patch('/auth/me', { pix_key: document.getElementById('pix-chave').value.trim() });
    API.setUser(user); toast('Pix salvo!'); App.fecharModal(); App.navigate('entregador');
  } catch (e) { toast(e.message, true); }
};
App.modalAntecip = function () {
  const u = API.user();
  const box = document.getElementById('modal-box');
  document.getElementById('modal').classList.remove('hidden');
  box.innerHTML = `<h3>💸 Solicitar antecipação</h3>
    <p class="muted" style="margin-bottom:12px">Saldo disponível: <b>${money(u.balance)}</b>${u.pix_key ? '' : ' — cadastre seu Pix primeiro.'}</p>
    <div class="form-group"><label>Valor (até seu saldo)</label><input id="ant-valor" type="number" step="0.01"></div>
    <div class="btn-row"><button class="btn ghost" onclick="App.fecharModal()">Cancelar</button>
      <button class="btn primary" onclick="App.enviarAntecip()">Solicitar</button></div>`;
};
App.enviarAntecip = async function () {
  try {
    const r = await API.post('/advances', { amount: parseFloat(document.getElementById('ant-valor').value) });
    toast(r.message); App.fecharModal(); App.navigate('entregador');
  } catch (e) { toast(e.message, true); }
};
App.modalFeedback = function () {
  const box = document.getElementById('modal-box');
  document.getElementById('modal').classList.remove('hidden');
  box.innerHTML = `<h3>📬 Caixa de opiniões</h3>
    <div class="form-group"><label>Nome (opcional)</label><input id="fb-nome" value="${esc(API.user().name)}"></div>
    <div class="form-group"><label>Sua opinião</label><textarea id="fb-msg" rows="4" placeholder="Conte o que quiser melhorar..."></textarea></div>
    <div class="btn-row"><button class="btn ghost" onclick="App.fecharModal()">Cancelar</button>
      <button class="btn primary" onclick="App.enviarFeedback()">Enviar</button></div>`;
};
App.enviarFeedback = async function () {
  try {
    const r = await API.post('/feedback', { message: document.getElementById('fb-msg').value, name: document.getElementById('fb-nome').value.trim() });
    toast(r.message); App.fecharModal();
  } catch (e) { toast(e.message, true); }
};

// ==================== AVALIAÇÕES ====================
App.modalAvaliar = function (orderId, que) {
  App._avaliarOrder = orderId;
  App._avaliarQue = que;
  const box = document.getElementById('modal-box');
  document.getElementById('modal').classList.remove('hidden');
  const tagsEntregador = ['Pontual (chegou na hora)', 'Responsável', 'Teve cuidado com o pedido', 'Boa comunicação', 'Simpático'];
  const tagsHtml = que === 'entregador' ? `
    <div class="section-title" style="margin-top:0">O que você achou do entregador? (selecione todas que quiser)</div>
    <div class="tags-pick">
      ${tagsEntregador.map((t, i) => `<label class="tag-chip"><input type="checkbox" class="av-tag" value="${esc(t)}"> ${esc(t)}</label>`).join('')}
    </div>` : '';
  box.innerHTML = `<h3>⭐ Avaliar ${que === 'loja' ? 'a loja' : 'o entregador'}</h3>
    <div class="muted" style="text-align:center;margin-bottom:4px">1 estrela = pior • 5 estrelas = melhor</div>
    <div style="text-align:center;margin:12px 0;font-size:36px" id="estrelas">
      ${[1, 2, 3, 4, 5].map(n => `<span style="cursor:pointer;opacity:.3" onclick="App.setStars(${n})">★</span>`).join('')}
    </div>
    ${tagsHtml}
    <div class="form-group"><label>Comentário (opcional)</label><input id="av-coment"></div>
    <div class="btn-row"><button class="btn ghost" onclick="App.fecharModal()">Depois</button>
      <button class="btn primary" onclick="App.enviarAvaliacao(${orderId})">Enviar avaliação</button></div>`;
};
App._stars = 0;
App.setStars = function (n) {
  App._stars = n;
  document.querySelectorAll('#estrelas span').forEach((el, i) => { el.style.opacity = i < n ? '1' : '.3'; el.style.color = '#f59e0b'; });
};
App.enviarAvaliacao = async function (orderId) {
  if (!App._stars) { toast('Escolha de 1 a 5 estrelas.', true); return; }
  try {
    const tags = Array.from(document.querySelectorAll('.av-tag:checked')).map(el => el.value).join(', ');
    const r = await API.post('/ratings', { order_id: orderId, stars: App._stars, comment: document.getElementById('av-coment').value.trim(), tags: tags || null });
    App._stars = 0; toast(r.message); App.fecharModal(); App.refreshPedido(orderId);
  } catch (e) { toast(e.message, true); }
};

// ==================== CHAT ====================
App.modalChat = async function (orderId) {
  App._chatOrder = orderId;
  const box = document.getElementById('modal-box');
  document.getElementById('modal').classList.remove('hidden');
  box.innerHTML = `<h3>💬 Chat do pedido #${orderId}</h3>
    <div class="muted" style="margin-bottom:8px">Participam: loja, cliente e entregador.</div>
    <div id="chat-msgs" style="max-height:280px;overflow-y:auto;background:var(--bg);border-radius:10px;padding:10px;margin-bottom:10px;min-height:120px">⏳ Carregando...</div>
    <div class="form-group"><label>Enviar a:</label>
      <select id="chat-to"><option value="todos">Todos (grupo)</option><option value="cliente">Só cliente</option><option value="loja">Só loja</option><option value="entregador">Só entregador</option></select></div>
    <div style="display:flex;gap:8px"><input id="chat-texto" placeholder="Escreva uma mensagem..." style="flex:1;padding:10px;border:1px solid var(--border);border-radius:10px">
      <button class="btn primary small" style="width:auto" onclick="App.enviarMensagem()">Enviar</button></div>`;
  App.carregarChat();
};
App.carregarChat = async function () {
  try {
    const { messages } = await API.get('/messages/' + App._chatOrder);
    const el = document.getElementById('chat-msgs');
    if (!el) return;
    el.innerHTML = messages.length ? messages.map(m => `
      <div style="margin-bottom:8px"><b style="font-size:12px;color:var(--primary-dark)">${esc(m.sender_name)}${m.recipient_id ? ' (direto)' : ' (grupo)'}</b>
        <div style="background:#fff;padding:8px 10px;border-radius:8px;font-size:13px;display:inline-block">${esc(m.text)}</div>
        <div style="font-size:10px;color:var(--muted)">${new Date(m.created_at).toLocaleTimeString('pt-BR')}</div></div>`).join('')
      : '<div class="muted">Sem mensagens ainda.</div>';
    el.scrollTop = el.scrollHeight;
  } catch (e) { document.getElementById('chat-msgs').innerHTML = '<div class="muted">Erro ao carregar.</div>'; }
};
App.enviarMensagem = async function () {
  const texto = document.getElementById('chat-texto').value.trim();
  if (!texto) return;
  try {
    const to = document.getElementById('chat-to').value;
    let recipient_id = null;
    if (to !== 'todos') {
      const { order } = await API.get('/orders/' + App._chatOrder);
      const map = { cliente: order.customer_id, entregador: order.delivery_person_id };
      if (to === 'loja') { const { store } = await API.get('/stores/' + order.store_id); recipient_id = store.owner_id; }
      else recipient_id = map[to];
    }
    await API.post('/messages', { order_id: App._chatOrder, text: texto, to_group: to === 'todos', recipient_id });
    document.getElementById('chat-texto').value = '';
    App.carregarChat();
  } catch (e) { toast(e.message, true); }
};

// ==================== ADMIN: Feedback, Antecipos, Espera ====================
async function App_renderAdminFeedback(view) {
  const { feedback, unread } = await API.get('/feedback');
  view.innerHTML = `<button class="btn ghost small" style="width:auto;margin-bottom:10px" onclick="App.navigate('admin')">‹ Voltar</button>
    <h1>Caixa de opiniões</h1><p class="sub">${unread} sem ler</p>
    ${feedback.length ? feedback.map(f => `<div class="card" style="${f.read ? '' : 'border-left:4px solid var(--primary)'}">
      <div class="row"><h3>${esc(f.name || 'Anônimo')}</h3><span class="muted">${new Date(f.created_at).toLocaleString('pt-BR')}</span></div>
      <div class="meta">${esc(f.role || '')} ${f.email ? '• ' + esc(f.email) : ''}</div>
      <div style="margin-top:6px">"${esc(f.message)}"</div>
      ${f.read ? '' : `<button class="btn ghost small" style="margin-top:8px" onclick="App.lerFeedback(${f.id})">Marcar como lido</button>`}
    </div>`).join('') : '<div class="empty"><span class="big">📬</span>Sem opiniões ainda.</div>'}`;
}
App.lerFeedback = async function (id) { await API.patch('/feedback/' + id + '/read'); App.navigate('admin-feedback'); };

async function App_renderAdminAntecipos(view) {
  const { advances } = await API.get('/advances');
  view.innerHTML = `<button class="btn ghost small" style="width:auto;margin-bottom:10px" onclick="App.navigate('admin')">‹ Voltar</button>
    <h1>Solicitações de antecipação</h1>
    ${advances.length ? advances.map(a => `<div class="card">
      <div class="row"><h3>${esc(a.name)}</h3><span class="badge ${a.status === 'pendente' ? 'pendente' : a.status === 'aprovado' ? 'ativo' : 'cancelado'}">${a.status}</span></div>
      <div class="meta">Pix: ${esc(a.pix_key || '—')} • ${esc(a.phone || '')}${phoneButtons(a.phone)}</div>
      <div class="price" style="font-size:18px;margin:6px 0">${money(a.amount)}</div>
      ${a.status === 'pendente' ? `<div class="btn-row">
        <button class="btn primary small" onclick="App.aprovarAntecip(${a.id},'aprovado')">Pagar via Pix ✓</button>
        <button class="btn danger small" onclick="App.aprovarAntecip(${a.id},'rejeitado')">Rejeitar</button></div>` : ''}
    </div>`).join('') : '<div class="empty"><span class="big">💸</span>Nenhuma solicitação.</div>'}`;
}
App.aprovarAntecip = async function (id, status) {
  try { const r = await API.patch('/advances/' + id, { status }); toast(r.message); App.navigate('admin-antecipos'); }
  catch (e) { toast(e.message, true); }
};

async function App_renderAdminEspera(view) {
  const w = await API.get('/admin/waiting');
  view.innerHTML = `<button class="btn ghost small" style="width:auto;margin-bottom:10px" onclick="App.navigate('admin')">‹ Voltar</button>
    <h1>Suporte — entregadores esperando</h1>
    <div class="section-title">Esperando na loja (${w.waiting_at_store.length})</div>
    ${w.waiting_at_store.length ? w.waiting_at_store.map(o => `<div class="card">
      <div class="row"><h3>Pedido #${o.id} — ${esc(o.store_name)}</h3><span class="badge ${o.minutos_espera > 10 ? 'cancelado' : 'pendente'}">${o.minutos_espera} min</span></div>
      <div class="meta">Entregador: ${esc(o.delivery_name)}${o.delivery_phone ? ` • ${esc(o.delivery_phone)}${phoneButtons(o.delivery_phone)}` : ''}</div>
      <button class="btn ghost small" style="margin-top:6px" onclick="App.navigate('pedido', ${o.id})">Ver pedido</button></div>`).join('') : '<div class="muted">Nenhum.</div>'}
    <div class="section-title">Esperando o cliente (${w.waiting_at_customer.length})</div>
    ${w.waiting_at_customer.length ? w.waiting_at_customer.map(o => `<div class="card" style="${o.minutos_espera > 10 ? 'border-left:4px solid var(--danger)' : ''}">
      <div class="row"><h3>Pedido #${o.id} — ${esc(o.customer_name)}</h3><span class="badge ${o.minutos_espera > 10 ? 'cancelado' : 'pendente'}">${o.minutos_espera} min</span></div>
      <div class="meta">📍 ${esc(o.delivery_address)}</div>
      <button class="btn ghost small" style="margin-top:6px" onclick="App.navigate('pedido', ${o.id})">Ver pedido</button></div>`).join('') : '<div class="muted">Nenhum.</div>'}`;
}

// ==================== TERMOS E CONDIÇÕES ====================
const TERMOS_HTML = `
<div class="termos-meta"><b>Versão vigente:</b> 1.0 (novembro/2026). Ao se cadastrar ou usar a plataforma Pediu Chegou, você concorda com estes termos.</div>
<div class="termos-body">
<h3>1. Do aceite</h3>
<p>Ao criar uma conta na plataforma <b>Pediu Chegou</b> ou ao utilizar qualquer de seus serviços, você declara ter lido, compreendido e aceito integralmente estes Termos e Condições de Uso, além da Política de Privacidade. Se não concordar, não utilize a plataforma.</p>

<h3>2. Das contas e perfis</h3>
<p>A plataforma possui quatro perfis: <b>cliente</b> (quem pede), <b>loja/restaurante</b> (quem vende), <b>entregador</b> (quem entrega) e <b>administrador</b> (operador da plataforma). Cada conta é <b>pessoal e intransferível</b>. Você é responsável por manter sua senha em segredo e por toda atividade realizada em sua conta.</p>
<ul>
<li>Lojas e entregadores passam por aprovação manual do administrador antes de ficarem ativos.</li>
<li>Os dados cadastrais devem ser verdadeiros, completos e atualizados. Dados falsos podem resultar em bloqueio imediato.</li>
<li>É proibido compartilhar login e senha com terceiros. Em caso de suspeita de uso não autorizado, notifique o administrador imediatamente.</li>
</ul>

<h3>3. Do entregador — identificação e reconhecimento facial</h3>
<p>Para garantir a segurança de clientes e lojas e evitar que terceiros usem a conta de um entregador, <b>todo entregador deve validar seu rosto por reconhecimento facial em TODOS os logins</b> (sempre que se desconectar e voltar a entrar). O rosto capturado é comparado com a foto cadastrada no ato do cadastro. Sem essa validação, o entregador não pode aceitar, coletar ou finalizar entregas, nem atualizar sua localização.</p>
<ul>
<li>A foto do rosto cadastrada (sem óculos, boné ou chapéu) é a referência biométrica. Se trocar de rosto aparente significativamente, contate o administrador para atualizá-la.</li>
<li>Cada validação facial é registrada (data/hora e imagem capturada) para auditoria e segurança.</li>
<li>Permitir que outra pessoa faça login ou realize entregas em sua conta constitui violação grave, sujeita a bloqueio e responsabilização civil/criminal.</li>
<li>Contas antigas sem foto de referência farão o cadastro do rosto no primeiro login após esta atualização.</li>
</ul>

<h3>4. Dos pagamentos e taxas</h3>
<p>Aceitam-se apenas <b>Pix e dinheiro</b> (cartões não são aceitos). A plataforma cobra comissão percentual sobre o valor dos produtos (não sobre a taxa de entrega), atualmente em 15%, ajustável pelo administrador. O entregador recebe 100% da taxa de entrega (mínimo R$ 8,00) e 100% das gorjetas. A loja recebe o valor dos produtos descontada a comissão. Liquidações e antecipações são gerenciadas no painel financeiro do administrador.</p>
<ul>
<li>Em pagamentos em dinheiro, o entregador cobra o valor total do cliente, fica com a taxa de entrega e deve repassar à plataforma o valor dos produtos (seu saldo fica negativo até o repasse).</li>
<li>Antecipações de saldo exigem chave Pix cadastrada e estão sujeitas à aprovação do administrador.</li>
</ul>

<h3>5. Do fluxo de entrega e responsabilidades</h3>
<p>O cliente confirma o pedido; a loja aceita ou recusa; o entregador aceita a entrega, coleta na loja (mediante código de coleta) e finaliza mediante o código pessoal do cliente. A responsabilidade pelo pedido passa da loja ao entregador no momento da coleta, ato irreversível. O entregador deve usar os botões de GPS ("Cheguei na loja", "Cheguei no endereço") e respeitar os tempos de espera.</p>

<h3>6. Avaliações e conduta</h3>
<p>Clientes avaliam entregadores e entregadores avaliam lojas (1–5 estrelas, com comentários e tags). É proibido: assédio, linguagem ofensiva, fraude, furto, falsificação de status, cobrança de valores fora da plataforma, ou qualquer conduta que prejudique outros usuários. Violações resultam em bloqueio e, quando cabível, em medidas legais.</p>

<h3>7. Cancelamentos e reembolsos</h3>
<p>O cliente pode cancelar antes da confirmação da loja. Após a confirmação, cancelamentos estão sujeitos à análise do administrador. Reembolsos em Pix são processados pela administração dentro do prazo de até 5 dias úteis.</p>

<h3>8. Privacidade e proteção de dados (LGPD)</h3>
<p>A plataforma coleta dados cadastrais, foto do rosto (entregadores), localização GPS (entregadores, apenas em atividade), registros de pedidos e validações faciais, para fins de operação, segurança e auditoria. Números de telefone são mascarados na interface; apenas a administração pode vê-los para contato de suporte. As imagens faciais são armazenadas criptografadas em nossos servidores e não são compartilhadas com terceiros. Você pode solicitar atualização ou exclusão de seus dados junto ao administrador.</p>

<h3>9. Limitação de responsabilidade</h3>
<p>A plataforma atua como intermediária entre cliente, loja e entregador, não sendo proprietária dos produtos nem responsável direta pela qualidade dos alimentos ou pela conduta individual dos parceiros, sem prejuízo de sua obrigação de gestão e moderação. A plataforma não se responsabiliza por instabilidade de GPS, internet ou falhas de dispositivos do usuário.</p>

<h3>10. Suspensão e encerramento</h3>
<p>O administrador pode bloquear contas que violem estes termos, sem aviso prévio quando houver risco à segurança ou à operação. O usuário pode encerrar sua conta a qualquer momento mediante solicitação.</p>

<h3>11. Alterações dos termos</h3>
<p>Estes termos podem ser atualizados. As mudanças entrarão em vigor após aviso na plataforma ou por e-mail. O uso continuado após a alteração implica aceite.</p>

<h3>12. Contato e lei aplicável</h3>
<p>Para questões sobre estes termos, contate a administração pelo painel de suporte. Estes termos são regidos pelas leis da República Federativa do Brasil, com foro do município de domicílio do operador da plataforma.</p>
</div>`;

function App_renderTermos(view) {
  view.innerHTML = `
    <button class="btn ghost small" style="width:auto;margin-bottom:10px" onclick="App.navigate('login')">‹ Voltar</button>
    <h1>📜 Termos e Condições</h1>
    <p class="sub">Plataforma Pediu Chegou</p>
    <div class="card">${TERMOS_HTML}</div>
    <button class="btn ghost small" style="width:auto;margin-bottom:20px" onclick="App.navigate('login')">‹ Voltar ao login</button>`;
}
App.modalTermos = function () {
  const box = document.getElementById('modal-box');
  document.getElementById('modal').classList.remove('hidden');
  box.innerHTML = `
    <h3>📜 Termos e Condições</h3>
    <div style="max-height:55vh;overflow-y:auto;padding-right:4px">${TERMOS_HTML}</div>
    <div style="height:12px"></div>
    <button class="btn primary" onclick="App.fecharModal()">Entendi — fechar</button>`;
};

// ==================== RECONHECIMENTO FACIAL (entregador, em cada login) ====================
App._faceStream = null;
App._faceApiReady = null; // null = não carregado, true/false = resultado
App._faceAttempts = 0;
App._pararCameraFace = function () {
  if (App._faceStream) {
    App._faceStream.getTracks().forEach(t => t.stop());
    App._faceStream = null;
  }
};
App._carregarFaceApi = async function () {
  if (App._faceApiReady !== null) return App._faceApiReady;
  try {
    await new Promise((res, rej) => {
      if (window.faceapi) return res();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.min.js';
      s.onload = () => res();
      s.onerror = () => rej(new Error('falha ao carregar biblioteca'));
      document.head.appendChild(s);
    });
    const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    App._faceApiReady = true;
  } catch (e) {
    console.warn('face-api indisponível (modo fallback):', e.message);
    App._faceApiReady = false;
  }
  return App._faceApiReady;
};

function App_renderFaceVerify(view) {
  const user = API.user();
  App._faceAttempts = 0;
  const temRef = !!(user && user.photo);
  view.innerHTML = `
    <div class="auth-wrap face-wrap">
      <div class="auth-logo"><img src="/img/logo.png" class="logo-img" alt="Pediu Chegou"></div>
      <h1 style="font-size:18px;margin-bottom:4px">🛡️ Verificação facial obrigatória</h1>
      <p class="sub" style="margin-bottom:14px">
        ${temRef
          ? `Olá, <b>${esc((user.social_name || user.name).split(' ')[0])}</b>! Para entrar, valide que é você mesmo.<br>
             Sua foto de referência: <img src="${user.photo}" class="face-ref"> Posicione seu rosto na câmera.`
          : `Primeiro acesso com reconhecimento facial. Vamos cadastrar seu rosto como referência agora.<br>
             <span class="muted">Nos próximos logins ele será comparado automaticamente.</span>`}
      </p>
      <div class="card">
        <video id="face-video" autoplay playsinline muted></video>
        <canvas id="face-canvas" class="face-canvas"></canvas>
        <div id="face-status" class="muted" style="margin-top:10px">Aguardando câmera... (permita o acesso à câmera quando solicitado)</div>
        <div style="height:10px"></div>
        <button class="btn primary" id="face-capturar" onclick="App.capturarRosto()" disabled>📸 Validar meu rosto</button>
        <div style="height:8px"></div>
        <button class="btn ghost small" style="width:auto" onclick="App._pararCameraFace();App.logout()">Sair (voltar ao login)</button>
        <div class="face-attempts" id="face-tentativas"></div>
      </div>
      <div class="muted" style="font-size:11px;margin-top:10px">
        Sua conta é pessoal e intransferível. Essa validação impede que outras pessoas entrem com seu login.
      </div>
    </div>`;

  // Iniciar câmera
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
      .then((stream) => {
        App._faceStream = stream;
        const video = document.getElementById('face-video');
        if (video) { video.srcObject = stream; video.play(); }
        const btn = document.getElementById('face-capturar');
        const st = document.getElementById('face-status');
        if (btn) btn.disabled = false;
        if (st) st.textContent = 'Câmera pronta. Centralize seu rosto e toque em "Validar meu rosto".';
        // Carrega a biblioteca de reconhecimento em paralelo (não trava a câmera)
        App._carregarFaceApi();
      })
      .catch(() => {
        const st = document.getElementById('face-status');
        if (st) st.innerHTML = '<span style="color:var(--danger)">Não foi possível acessar a câmera. Verifique as permissões do navegador (é preciso estar em https ou localhost).</span>';
      });
  } else {
    const st = document.getElementById('face-status');
    if (st) st.innerHTML = '<span style="color:var(--danger)">Seu navegador não suporta câmera. Use um navegador moderno (Chrome/Safari) em https.</span>';
  }
}

App.capturarRosto = async function () {
  const btn = document.getElementById('face-capturar');
  const st = document.getElementById('face-status');
  const tent = document.getElementById('face-tentativas');
  if (btn) btn.disabled = true;
  const user = API.user();
  const temRef = !!(user && user.photo);

  try {
    const video = document.getElementById('face-video');
    const canvas = document.getElementById('face-canvas');
    if (!video || !video.videoWidth) { if (st) st.textContent = 'Câmera ainda não está pronta. Aguarde um instante e tente novamente.'; if (btn) btn.disabled = false; return; }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const photo = canvas.toDataURL('image/jpeg', 0.8);

    if (st) st.textContent = 'Analisando rosto...';
    const pronto = await App._carregarFaceApi();

    let matchScore = null;
    let enrolled = false;
    if (pronto && window.faceapi && temRef) {
      // Comparação real: descritor da referência vs. descritor da captura
      const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      const refImg = await faceapi.fetchImage(user.photo);
      const refDet = await faceapi.detectSingleFace(refImg, opts).withFaceLandmarks().withFaceDescriptor();
      const capDet = await faceapi.detectSingleFace(canvas, opts).withFaceLandmarks().withFaceDescriptor();
      if (!capDet) {
        App._faceAttempts++;
        if (tent) tent.textContent = `Tentativa ${App._faceAttempts}/5 — não foi possível detectar um rosto na imagem. Melhore a iluminação e centralize o rosto.`;
        if (App._faceAttempts >= 5) { App._travarFace(); return; }
        if (st) st.textContent = 'Não detectei um rosto. Centralize seu rosto, melhore a luz e tente novamente.';
        if (btn) btn.disabled = false;
        return;
      }
      if (!refDet) {
        // Referência ruim: trata como primeiro cadastro (enroll)
        enrolled = true;
      } else {
        const dist = faceapi.euclideanDistance(refDet.descriptor, capDet.descriptor);
        matchScore = +dist.toFixed(3);
        if (dist > 0.6) {
          App._faceAttempts++;
          if (tent) tent.textContent = `Tentativa ${App._faceAttempts}/5 — rosto não confere com a foto cadastrada (distância ${matchScore}).`;
          if (App._faceAttempts >= 5) { App._travarFace(); return; }
          if (st) st.textContent = '❌ O rosto não confere com a foto cadastrada. Tente novamente (sem óculos/boné, boa iluminação).';
          if (btn) btn.disabled = false;
          return;
        }
      }
    } else if (!temRef) {
      enrolled = true; // primeira vez: cadastra a referência
    }

    // Enviar ao servidor (registra auditoria e emite token com face_verified=true)
    const { token, user: novoUser, message } = await API.post('/auth/face-verify', { photo, match_score: matchScore, enrolled });
    App._pararCameraFace();
    API.setToken(token);
    API.setUser(novoUser); // já vem com face_verified=true
    toast(message);
    App.navigate(homeForRole('entregador'));
  } catch (e) {
    if (st) st.textContent = 'Erro: ' + esc(e.message);
    if (btn) btn.disabled = false;
  }
};

App._travarFace = function () {
  App._pararCameraFace();
  alert('Muitas tentativas sem êxito. Por segurança, sua sessão foi encerrada. Contate o administrador da plataforma se precisar de ajuda.');
  App.logout();
};

// ==================== Inicialização ====================
document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') App.fecharModal();
});
window.addEventListener('DOMContentLoaded', () => {
  const user = API.user();
  let route = 'login';
  if (user) {
    if (!user.email_verified) route = 'verificar-email';
    else if (user.status === 'pendente') route = 'pendente';
    else if (user.role === 'entregador' && !user.face_verified) route = 'face-verify';
    else route = homeForRole(user.role);
  }
  App.navigate(route);
});
