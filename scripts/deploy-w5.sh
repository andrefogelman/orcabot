#!/bin/bash
# Deploy OrcaBot to W5
set -e
W5="openclaw@100.66.83.22"

echo "Syncing to W5..."
rsync -avz --exclude node_modules --exclude .git --exclude dist \
  ~/orcabot/ $W5:~/orcabot/

echo "Building on W5..."
ssh $W5 "cd ~/orcabot && docker compose build && docker compose up -d"

echo "Done. Check: ssh $W5 'docker compose -f ~/orcabot/docker-compose.yml logs -f'"
