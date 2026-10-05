#!/usr/bin/env bash
set -e

echo "=========================================="
echo "      ProxDMR — Развертывание сервиса     "
echo "=========================================="

# 1. Проверка Docker
if ! command -v docker &> /dev/null; then
    echo "[ОШИБКА] Docker не установлен! Установите Docker и Docker Compose."
    exit 1
fi

# 2. Подготовка .env
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "[+] Создан файл .env из .env.example"
    else
        touch .env
    fi
fi

# Функция установки переменной в .env
set_env_val() {
    local key="$1"
    local val="$2"
    if grep -q "^${key}=" .env; then
        sed -i "s|^${key}=.*|${key}=${val}|" .env
    else
        echo "${key}=${val}" >> .env
    fi
}

# 3. Определение сетевого IP для SSL
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
echo "--- 1. Сетевые настройки ---"
read -r -p "IP-адрес или домен хоста для SSL-сертификата [$AUTO_IP]: " INPUT_IP || true
CHOSEN_IP="${INPUT_IP:-$AUTO_IP}"

read -r -p "Порт веб-интерфейса HTTP/HTTPS [8266]: " INPUT_PORT || true
CHOSEN_PORT="${INPUT_PORT:-8266}"

echo ""
echo "--- 2. Учетная запись администратора ---"
read -r -p "Логин администратора (или ваш позывной) [admin]: " INPUT_USER || true
ADMIN_USER="${INPUT_USER:-admin}"

read -r -p "Пароль администратора [proxdmr123]: " INPUT_PASS || true
ADMIN_PASSWORD="${INPUT_PASS:-proxdmr123}"

echo ""
echo "--- 3. Безопасность и открытая регистрация ---"
read -r -p "Запретить регистрацию посторонних пользователей (рекомендуется для белых IP)? [Y/n]: " REG_CHOICE || true
case "$REG_CHOICE" in
    [nN][oO]|[nN])
        ALLOW_REG="true"
        ;;
    *)
        ALLOW_REG="false"
        ;;
esac

# Сохранение в .env
set_env_val "HOST_IP" "$CHOSEN_IP"
set_env_val "PORT" "$CHOSEN_PORT"
set_env_val "ADMIN_USER" "$ADMIN_USER"
set_env_val "ADMIN_PASSWORD" "$ADMIN_PASSWORD"
set_env_val "ALLOW_REGISTRATION" "$ALLOW_REG"

echo ""
echo "[+] Настройки успешно сохранены в .env"

# 4. Запуск сборки и контейнера
echo ""
echo "[*] Сборка и запуск контейнера ProxDMR..."
if docker compose version &> /dev/null; then
    docker compose up -d --build
else
    docker-compose up -d --build
fi

echo ""
echo "=========================================="
echo " ProxDMR успешно развернут и запущен!"
echo "------------------------------------------"
echo " Веб-интерфейс:   https://${CHOSEN_IP}:${CHOSEN_PORT}"
echo " Логин админа:    ${ADMIN_USER}"
echo " Пароль админа:   ${ADMIN_PASSWORD}"
echo " Регистрация:     $([ "$ALLOW_REG" = "true" ] && echo "Разрешена для всех" || echo "Отключена (закрытый доступ)")"
echo "------------------------------------------"
echo " (при первом открытии в браузере подтвердите самоподписанный SSL-сертификат)"
echo "=========================================="
