#!/usr/bin/env bash
# Sobe proxy (3001) e backend (3000) locais. Requer proxy/.env e backend/.env (veja README.md).
# Uso: tests-nfr/subir-ambiente.sh [parar]
cd "$(dirname "$0")/.."
if [ "$1" = "parar" ]; then
  for p in 3000 3001; do
    pid=$(netstat -ano 2>/dev/null | grep ":$p " | grep LISTENING | awk '{print $5}' | head -1)
    [ -n "$pid" ] && taskkill //PID "$pid" //F >/dev/null 2>&1
  done; exit 0
fi
(cd proxy && nohup npx tsx --env-file=.env src/index.ts > ../tests-nfr/proxy.log 2>&1 &)
sleep 4
(cd backend && nohup npx tsx --env-file=.env src/index.ts > ../tests-nfr/backend.log 2>&1 &)
sleep 5
curl -s localhost:3001/saude; echo; curl -s localhost:3000/saude; echo
