#!/usr/bin/env bash
# Regra do CLAUDE.md: todo PR que altera código de um serviço atualiza o CHANGELOG.md desse serviço.
# Uso: checar-changelog.sh <commit-base> <commit-cabeça>   (roda dentro do repositório git)
# Arquivos .md do serviço (documentação, TAREFAS, README) não contam como código; PR só de docs passa.
set -euo pipefail

base="${1:?informe o commit base}"
cabeca="${2:?informe o commit cabeça}"
servicos=(frontend backend proxy scripts tests-nfr)

mapfile -t alterados < <(git diff --name-only --diff-filter=ACMRD "$base...$cabeca")

falhas=()
for servico in "${servicos[@]}"; do
  codigo=0
  changelog=0
  for arquivo in "${alterados[@]}"; do
    case "$arquivo" in
      "$servico/CHANGELOG.md") changelog=1 ;;
      "$servico"/*.md) ;;
      "$servico"/*) codigo=1 ;;
    esac
  done
  if [ "$codigo" = 1 ] && [ "$changelog" = 0 ]; then
    falhas+=("$servico")
  fi
done

if ((${#falhas[@]})); then
  for servico in "${falhas[@]}"; do
    echo "::error::O PR altera código em '$servico/' mas não atualiza '$servico/CHANGELOG.md'. Adicione uma entrada (data, descrição e UC/RF/RNF) em [Não lançado]."
  done
  exit 1
fi
echo "CHANGELOG em dia: todo serviço com código alterado tem entrada no seu CHANGELOG.md."
