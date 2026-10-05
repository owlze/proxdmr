#!/usr/bin/env bash
set -e

echo "=========================================="
echo "         ProxDMR — Setup & Deploy         "
echo "=========================================="

# 1. Verify Docker
if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker is not installed! Please install Docker and Docker Compose."
    exit 1
fi

# 2. Prepare .env
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "[+] Created .env from template"
    else
        touch .env
    fi
fi

# Function to set key=value in .env
set_env_val() {
    local key="$1"
    local val="$2"
    if grep -q "^${key}=" .env; then
        sed -i "s|^${key}=.*|${key}=${val}|" .env
    else
        echo "${key}=${val}" >> .env
    fi
}

# 3. Detect Host IP for SSL
AUTO_IP=""
if command -v ip &> /dev/null; then
    AUTO_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+')
fi
if [ -z "$AUTO_IP" ] && command -v hostname &> /dev/null; then
    AUTO_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$AUTO_IP" ]; then
    AUTO_IP="127.0.0.1"
fi

echo ""
echo "--- 1. Network Settings ---"
read -r -p "Host IP or domain for SSL certificate [$AUTO_IP]: " INPUT_IP || true
CHOSEN_IP="${INPUT_IP:-$AUTO_IP}"

read -r -p "Web interface port HTTP/HTTPS [8266]: " INPUT_PORT || true
CHOSEN_PORT="${INPUT_PORT:-8266}"

echo ""
echo "--- 2. Administrator Account ---"
read -r -p "Admin username or callsign [admin]: " INPUT_USER || true
ADMIN_USER="${INPUT_USER:-admin}"

read -r -p "Admin password [proxdmr123]: " INPUT_PASS || true
ADMIN_PASSWORD="${INPUT_PASS:-proxdmr123}"

echo ""
echo "--- 3. Security & Open Registration ---"
read -r -p "Disable public user registration (recommended)? [Y/n]: " REG_CHOICE || true
case "$REG_CHOICE" in
    [nN][oO]|[nN])
        ALLOW_REG="true"
        ;;
    *)
        ALLOW_REG="false"
        ;;
esac

# Save to .env
set_env_val "HOST_IP" "$CHOSEN_IP"
set_env_val "PORT" "$CHOSEN_PORT"
set_env_val "ADMIN_USER" "$ADMIN_USER"
set_env_val "ADMIN_PASSWORD" "$ADMIN_PASSWORD"
set_env_val "ALLOW_REGISTRATION" "$ALLOW_REG"

echo ""
echo "[+] Configuration saved to .env"

# 4. Build and start container
echo ""
echo "[*] Building and starting ProxDMR container..."
if docker compose version &> /dev/null; then
    docker compose up -d --build
else
    docker-compose up -d --build
fi

echo ""
echo "=========================================="
echo " ProxDMR successfully deployed and running!"
echo "------------------------------------------"
echo " Web UI:          https://${CHOSEN_IP}:${CHOSEN_PORT}"
echo " Admin Login:     ${ADMIN_USER}"
echo " Admin Password:  ${ADMIN_PASSWORD}"
echo " Registration:    $([ "$ALLOW_REG" = "true" ] && echo "Allowed (Open)" || echo "Disabled (Private access)")"
echo "------------------------------------------"
echo " (accept the self-signed SSL certificate on first browser access)"
echo "=========================================="
