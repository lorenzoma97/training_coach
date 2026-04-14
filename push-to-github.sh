#!/usr/bin/env bash
# Script di setup git + push iniziale verso GitHub.
#
# PREREQUISITO: crea un repo VUOTO su https://github.com/new
#   - Nome suggerito: diario-coach
#   - NON spuntare "Add README" / "Add .gitignore" / "Add license" (deve restare vuoto)
#   - Visibilità: Public (per GitHub Pages gratuito)
#
# Poi lancia questo script da git-bash nella cartella diario-coach:
#   bash push-to-github.sh
#
# Alla prima esecuzione Git Credential Manager potrebbe aprire il browser per login.

set -e

# ─── Configurazione ───────────────────────────────────────
GITHUB_USER="lorenzoma97"
REPO_NAME="${1:-training_coach}"   # override con: bash push-to-github.sh nome-custom
BRANCH="main"
COMMIT_MSG="initial commit: diario + coach AI (Gemini Flash)"
REMOTE_URL="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"
# ──────────────────────────────────────────────────────────

echo "→ Repo target: ${REMOTE_URL}"
echo "→ Branch: ${BRANCH}"
echo

if [ -d ".git" ]; then
  echo "✓ Repository git già inizializzato"
else
  echo "→ git init"
  git init -b "${BRANCH}"
fi

echo "→ git add ."
git add .

# Evita errore se non c'è nulla da committare
if git diff --cached --quiet; then
  echo "ℹ Niente di nuovo da committare"
else
  echo "→ git commit"
  git commit -m "${COMMIT_MSG}"
fi

# Imposta/aggiorna il remote
if git remote | grep -q "^origin$"; then
  echo "→ aggiorno remote origin → ${REMOTE_URL}"
  git remote set-url origin "${REMOTE_URL}"
else
  echo "→ aggiungo remote origin → ${REMOTE_URL}"
  git remote add origin "${REMOTE_URL}"
fi

# Assicura branch corretto
git branch -M "${BRANCH}"

echo "→ git push -u origin ${BRANCH}"
git push -u origin "${BRANCH}"

echo
echo "✓ Push completato."
echo
echo "Prossimi passi (una tantum):"
echo "  1. https://github.com/${GITHUB_USER}/${REPO_NAME}/settings/pages"
echo "  2. In 'Source' seleziona 'GitHub Actions'"
echo "  3. Controlla il build su:"
echo "     https://github.com/${GITHUB_USER}/${REPO_NAME}/actions"
echo "  4. L'app sarà disponibile su:"
echo "     https://${GITHUB_USER}.github.io/${REPO_NAME}/"
echo
echo "Per aggiornamenti futuri: modifica i file, poi"
echo "     git add . && git commit -m 'descrizione' && git push"
