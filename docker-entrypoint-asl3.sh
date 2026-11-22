#!/bin/bash
set -e

# Prepare Asterisk runtime directories
mkdir -p /var/log/asterisk /var/spool/asterisk /var/lib/asterisk /var/run/asterisk /etc/asterisk
chown -R asterisk:asterisk /var/log/asterisk /var/spool/asterisk /var/lib/asterisk /var/run/asterisk 2>/dev/null || true
chmod -R a+rX /etc/asterisk 2>/dev/null || true

exec "$@"
