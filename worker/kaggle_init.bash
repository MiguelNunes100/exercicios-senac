#!/bin/bash
# Script to be run on Kaggle kernel startup

echo "Installing dependencies..."
pip install -r requirements.txt

# Start Tailscale if TAILSCALE_AUTHKEY is provided
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "Starting Tailscale..."
    curl -fsSL https://tailscale.com/install.sh > install.sh
    bash install.sh
    sudo tailscaled &
    sudo tailscale up --authkey=${TAILSCALE_AUTHKEY} --hostname=kaggle-worker-${KAGGLE_USERNAME} &
fi

# Start the python worker
echo "Starting worker..."
python main.py
