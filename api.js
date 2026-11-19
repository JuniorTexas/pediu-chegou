// api.js — Cliente HTTP con JWT
const API = {
  token: () => localStorage.getItem('entregapp_token'),
  setToken: (t) => t ? localStorage.setItem('entregapp_token', t) : localStorage.removeItem('entregapp_token'),
  user: () => { try { return JSON.parse(localStorage.getItem('entregapp_user') || 'null'); } catch { return null; } },
  setUser: (u) => u ? localStorage.setItem('entregapp_user', JSON.stringify(u)) : localStorage.removeItem('entregapp_user'),

  async req(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    const t = this.token();
    if (t) opts.headers['Authorization'] = 'Bearer ' + t;
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) { this.setToken(null); this.setUser(null); }
      throw new Error(data.error || 'Erro de conexão');
    }
    return data;
  },
  get: (p) => API.req('GET', p),
  post: (p, b) => API.req('POST', p, b),
  put: (p, b) => API.req('PUT', p, b),
  patch: (p, b) => API.req('PATCH', p, b),
  del: (p) => API.req('DELETE', p),
};

function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  setTimeout(() => el.classList.add('hidden'), 2800);
}

function money(n) {
  return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
}

const STATUS_LABEL = {
  pendente: 'Pendente', confirmado: 'Confirmado', preparando: 'Preparando', pronto: 'Pronto p/ retirar',
  a_caminho: 'A caminho', entregue: 'Entregue', cancelado: 'Cancelado'
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Botones clicables de Llamar (tel:) y WhatsApp (wa.me) para un número de teléfono.
// Si el número tiene 10/11 dígitos (formato brasileño con DDD), se le antepone el código de país 55.
function phoneButtons(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  let full = digits;
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) full = '55' + digits;
  return ` <span class="phone-links">
    <a href="tel:+${full}" class="phone-btn" title="Ligar">📞 Ligar</a>
    <a href="https://wa.me/${full}" target="_blank" rel="noopener" class="phone-btn whats" title="Abrir WhatsApp">💬 Zap</a>
  </span>`;
}
