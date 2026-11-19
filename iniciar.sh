#!/bin/bash
# Iniciar Pediu Chegou (PostgreSQL local + aplicativo)
# Uso: ./iniciar.sh
set -e
cd "$(dirname "$0")"

# 1. Garantir que o PostgreSQL esteja rodando
if ! pg_isready -q 2>/dev/null; then
  echo "→ Iniciando PostgreSQL..."
  sudo service postgresql start 2>/dev/null || sudo systemctl start postgresql 2>/dev/null || true
  sleep 2
fi

# 2. Criar usuário/banco na primeira vez (se não existirem)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='pediu'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER pediu WITH PASSWORD 'pediu123';" >/dev/null
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='pediuchegou'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE pediuchegou OWNER pediu;" >/dev/null

# 3. Instalar dependências na primeira vez
[ -d node_modules ] || npm install

# 4. Iniciar o aplicativo
echo "→ Pediu Chegou em http://localhost:3000 (Ctrl+C para sair)"
node server.js
