<!-- lang:en -->
# ProxDMR v2.20

ProxDMR is a multi-protocol client-server amateur radio transceiver for web browsers and Android smartphones — powered by 100% software vocoders with no physical radio, MMDVM hotspot, or USB vocoder required.

Live Demo (listen-only): https://proxdmr.duckdns.org

## Key Capabilities

- **100% Software Vocoders:** Server-side AMBE+2 (`mbelib-neo`), Codec2, and Opus encoding/decoding.
- **Multi-Protocol & Multi-Hotspot:** Run multiple independent virtual gateways simultaneously across DMR (BrandMeister, TGIF, FreeDMR, ADN, DMR+ / IPSC2), YSF, D-STAR, M17, SVXLink, XLX Reflectors, and AllStarLink v3 (ASL3), with direct BM/TGIF API talkgroup control, live reflector catalogs, favorites, and scanning.
- **Web & Android Clients (APK v1.36):** Low-latency streaming in any modern browser or via the native Android app with background reception and Tailscale VPN support.
- **Live Transcription, Translation & Neural TTS:** Real-time QSO speech-to-text, automatic language detection, multi-language translation, and voice readout via cloud APIs (Groq, Gemini) or fully offline local AI (local ASR, FastLID, Qwen 2.5, and Piper TTS with amateur radio phonetics).
- **RX/TX Audio DSP & Safety:** 10-band RX equalizer with presets, AGC, limiter, adaptive jitter buffer, AMBE vocoder tuning, L/R timeslot panning, TX microphone DSP (EQ, HPF, noise gate, AGC), and configurable TOT.
- **Diagnostics, Archive & Multi-User:** Master server probe (ping/jitter/packet loss), built-in `.wav` QSO recorder with RadioID sync (300,000+ callsigns), SQLite multi-user accounts, SWL/guest demo mode, backup/restore, 8-language UI, watchdog with Telegram alerts, and 1-click updates.

## Quick Install & Upgrade Note

- **Docker Image (x86_64 / ARM64):** `ghcr.io/owlze/proxdmr:latest` or `andrelli/proxdmr:latest` (mount `./config:/app/config` and `./data:/app/src/data`).
- **Interactive Setup:** Extract `ProxDMR-Release.tar.gz` / `ProxDMR-Release.zip` and run `./setup.sh` (Linux/NAS/RPi) or `setup.bat` / `setup.ps1` (Windows).
- **Upgrading from v2.18 or earlier:** Because v2.20 adds new system and Python dependencies (`libcodec2-dev`, `libopus0`, `fasttext-numpy2-wheel`, `llama-cpp-python`), pull the new Docker image (`docker compose pull && docker compose up -d`) or rebuild your container (`docker compose up -d --build`) to enable M17 Codec2 audio, FastLID, and local Qwen translation.

<!-- lang:ru -->
# ProxDMR v2.20

ProxDMR — мультипротокольный клиент-серверный радиолюбительский трансивер для веб-браузера и Android-смартфона со 100% программными вокодерами: без физической рации, MMDVM-хотспота или USB-вокодера.

Живое демо (только приём): https://proxdmr.duckdns.org

## Основные возможности

- **100% программные вокодеры:** серверное кодирование и декодирование AMBE+2 (`mbelib-neo`), Codec2 и Opus.
- **Мультипротокол и мультихотспот:** одновременная работа независимых виртуальных шлюзов в сетях DMR (BrandMeister, TGIF, FreeDMR, ADN, DMR+ / IPSC2), YSF, D-STAR, M17, SVXLink, XLX и AllStarLink v3 (ASL3), управление TG через API BM/TGIF, живые каталоги рефлекторов, избранное и сканер.
- **Веб и Android-клиент (APK v1.36):** голосовая связь с минимальной задержкой в браузере и нативном Android-приложении с фоновым приёмом и поддержкой Tailscale VPN.
- **Транскрибация, перевод и нейронный TTS:** распознавание QSO в реальном времени, автоопределение языка, перевод и озвучка — через облачные API (Groq, Gemini) или полностью офлайн локально (локальный ASR, FastLID, Qwen 2.5 и Piper TTS с радиофонетикой).
- **RX/TX аудио-DSP и защита:** 10-полосный RX-эквалайзер с пресетами, AGC, лимитер, адаптивный jitter-буфер, тюнинг вокодера AMBE, панорамирование таймслотов L/R, микрофонный TX-DSP (EQ, HPF, шумоподавитель, AGC) и таймер передачи TOT.
- **Диагностика, архив и многопользовательность:** проба мастер-серверов (ping/jitter/потери), встроенный `.wav`-рекордер с синхронизацией RadioID (300 000+ позывных), многопользовательский режим на SQLite, SWL и гостевой демо-режим, бэкап/восстановление, 8 языков интерфейса, Watchdog с Telegram-уведомлениями и обновление в 1 клик.

## Быстрая установка и важное при обновлении

- **Готовый Docker-образ (x86_64 / ARM64):** `ghcr.io/owlze/proxdmr:latest` или `andrelli/proxdmr:latest` (монтировать `./config:/app/config` и `./data:/app/src/data`).
- **Интерактивная установка:** распакуйте `ProxDMR-Release.tar.gz` / `ProxDMR-Release.zip` и запустите `./setup.sh` (Linux/NAS/RPi) или `setup.bat` / `setup.ps1` (Windows).
- **Обновление с v2.18 и ниже:** в v2.20 добавлены новые системные и Python-зависимости (`libcodec2-dev`, `libopus0`, `fasttext-numpy2-wheel`, `llama-cpp-python`), поэтому для работы звука M17 (Codec2), FastLID и локального перевода Qwen обновите Docker-образ (`docker compose pull && docker compose up -d`) или пересоберите контейнер (`docker compose up -d --build`).

<!-- lang:uk -->
# ProxDMR v2.20

ProxDMR — мультипротокольний клієнт-серверний радіоаматорський трансивер для веб-браузера та Android-смартфона зі 100% програмними вокодерами: без фізичної радіостанції, MMDVM-хотспота чи USB-вокодера.

Живе демо (лише прийом): https://proxdmr.duckdns.org

## Основні можливості

- **100% програмні вокодери:** серверне кодування та декодування AMBE+2 (`mbelib-neo`), Codec2 та Opus.
- **Мультипротокол і мультихотспот:** одночасна робота незалежних віртуальних шлюзів у мережах DMR (BrandMeister, TGIF, FreeDMR, ADN, DMR+ / IPSC2), YSF, D-STAR, M17, SVXLink, XLX та AllStarLink v3 (ASL3), керування TG через API BM/TGIF, живі каталоги рефлекторів, обране та сканер.
- **Веб та Android-клієнт (APK v1.36):** голосовий зв'язок із мінімальною затримкою у браузері та нативному Android-додатку з фоновим прийомом і підтримкою Tailscale VPN.
- **Транскрибація, переклад і нейронний TTS:** розпізнавання QSO в реальному часі, автовизначення мови, переклад та озвучення — через хмарні API (Groq, Gemini) або повністю офлайн локально (локальний ASR, FastLID, Qwen 2.5 та Piper TTS із радіофонетикою).
- **RX/TX аудіо-DSP і захист:** 10-смуговий RX-еквалайзер із пресетами, AGC, лімітер, адаптивний jitter-буфер, тюнінг вокодера AMBE, панорамування таймслотів L/R, мікрофонний TX-DSP (EQ, HPF, шумоподавлювач, AGC) і таймер передачі TOT.
- **Діагностика, архів і багатокористувацький режим:** проба мастер-серверів (ping/jitter/втрати), вбудований `.wav`-рекордер із синхронізацією RadioID (300 000+ позивних), облікові записи на SQLite, SWL та гостьовий демо-режим, резервне копіювання, 8 мов інтерфейсу, Watchdog із Telegram-сповіщеннями та оновлення в 1 клік.

## Швидке встановлення та оновлення

- **Готовий Docker-образ (x86_64 / ARM64):** `ghcr.io/owlze/proxdmr:latest` або `andrelli/proxdmr:latest` (монтувати `./config:/app/config` та `./data:/app/src/data`).
- **Інтерактивне встановлення:** розпакуйте `ProxDMR-Release.tar.gz` / `ProxDMR-Release.zip` та запустіть `./setup.sh` (Linux/NAS/RPi) або `setup.bat` / `setup.ps1` (Windows).
- **Оновлення з v2.18 або старішої:** версія v2.20 додає нові системні та Python-залежності (`libcodec2-dev`, `libopus0`, `fasttext-numpy2-wheel`, `llama-cpp-python`), тому для роботи M17 Codec2, FastLID та локального перекладу Qwen оновіть Docker-образ (`docker compose pull && docker compose up -d`) або перезберіть контейнер (`docker compose up -d --build`).

<!-- lang:de -->
# ProxDMR v2.20

ProxDMR ist ein Multiprotokoll-Client-Server-Amateurfunk-Transceiver für Webbrowser und Android-Smartphones mit 100 % Software-Vocodern — ganz ohne physisches Funkgerät, MMDVM-Hotspot oder USB-Vocoder.

Live-Demo (nur Empfang): https://proxdmr.duckdns.org

## Hauptfunktionen

- **100 % Software-Vocoder:** Serverseitiges AMBE+2 (`mbelib-neo`), Codec2 und Opus Encoding/Decoding.
- **Multiprotokoll & Multi-Hotspot:** Mehrere unabhängige virtuelle Gateways gleichzeitig für DMR (BrandMeister, TGIF, FreeDMR, ADN, DMR+ / IPSC2), YSF, D-STAR, M17, SVXLink, XLX-Reflektoren und AllStarLink v3 (ASL3) mit BM/TGIF-API-Steuerung, Live-Reflektorkatalogen, Favoriten und Scanner.
- **Web- & Android-Client (APK v1.36):** Sprachübertragung mit geringer Latenz im Browser oder in der nativen Android-App mit Hintergrundempfang und Tailscale-VPN-Unterstützung.
- **Live-Transkription, Übersetzung & Neural-TTS:** QSO-Spracherkennung in Echtzeit, automatische Spracherkennung, Übersetzung und Sprachausgabe über Cloud-APIs (Groq, Gemini) oder vollständig offline lokal (lokales ASR, FastLID, Qwen 2.5 und Piper TTS mit Amateurfunk-Phonetik).
- **RX/TX-Audio-DSP & Sicherheit:** 10-Band-RX-Equalizer mit Presets, AGC, Limiter, adaptiver Jitter-Buffer, AMBE-Vocoder-Tuning, L/R-Zeitschlitz-Panning, TX-Mikrofon-DSP (EQ, HPF, Noise Gate, AGC) und konfigurierbarer TOT.
- **Diagnose, Archiv & Mehrbenutzer:** Master-Server-Probe (Ping/Jitter/Paketverlust), integrierter `.wav`-QSO-Rekorder mit RadioID-Sync (300.000+ Rufzeichen), SQLite-Benutzerkonten, SWL/Gast-Demo-Modus, Backup/Restore, 8 UI-Sprachen, Watchdog mit Telegram-Alarmen und 1-Klick-Updates.

## Schnellinstallation & Update-Hinweis

- **Docker-Image (x86_64 / ARM64):** `ghcr.io/owlze/proxdmr:latest` oder `andrelli/proxdmr:latest` (`./config:/app/config` und `./data:/app/src/data` einbinden).
- **Interaktives Setup:** `ProxDMR-Release.tar.gz` / `ProxDMR-Release.zip` entpacken und `./setup.sh` (Linux/NAS/RPi) oder `setup.bat` / `setup.ps1` (Windows) ausführen.
- **Upgrade von v2.18 oder älter:** v2.20 fügt neue System- und Python-Abhängigkeiten hinzu (`libcodec2-dev`, `libopus0`, `fasttext-numpy2-wheel`, `llama-cpp-python`). Bitte das Docker-Image aktualisieren (`docker compose pull && docker compose up -d`) oder neu bauen (`docker compose up -d --build`), um M17-Codec2-Audio, FastLID und lokale Qwen-Übersetzung zu aktivieren.

<!-- lang:es -->
# ProxDMR v2.20

ProxDMR es un transceptor de radioaficionado cliente-servidor multiprotocolo para navegador web y smartphone Android con vocoders 100 % por software, sin necesidad de radio física, hotspot MMDVM ni vocoder USB.

Demo en vivo (solo escucha): https://proxdmr.duckdns.org

## Funciones principales

- **Vocoders 100 % por software:** Codificación y decodificación en servidor de AMBE+2 (`mbelib-neo`), Codec2 y Opus.
- **Multiprotocolo y multi-hotspot:** Ejecuta múltiples pasarelas virtuales independientes en DMR (BrandMeister, TGIF, FreeDMR, ADN, DMR+ / IPSC2), YSF, D-STAR, M17, SVXLink, reflectores XLX y AllStarLink v3 (ASL3), con control de TG vía API BM/TGIF, catálogos en vivo, favoritos y escáner.
- **Clientes Web y Android (APK v1.36):** Audio de baja latencia en cualquier navegador moderno o mediante la app nativa de Android con recepción en segundo plano y soporte de Tailscale VPN.
- **Transcripción, traducción y TTS neuronal:** Reconocimiento de voz en tiempo real, detección automática de idioma, traducción y lectura por voz mediante APIs en la nube (Groq, Gemini) o IA local totalmente offline (ASR local, FastLID, Qwen 2.5 y Piper TTS con fonética de radioaficionado).
- **DSP de audio RX/TX y seguridad:** Ecualizador RX de 10 bandas con presets, AGC, limitador, buffer jitter adaptativo, ajuste del vocoder AMBE, paneo L/R por timeslot, DSP de micrófono TX (EQ, HPF, puerta de ruido, AGC) y TOT configurable.
- **Diagnóstico, archivo y multiusuario:** Sonda de servidores maestros (ping/jitter/pérdida de paquetes), grabador `.wav` con sincronización RadioID (300.000+ indicativos), cuentas SQLite, modo SWL/demo, copias de seguridad, interfaz en 8 idiomas, Watchdog con alertas de Telegram y actualizaciones en 1 clic.

## Instalación rápida y nota de actualización

- **Imagen Docker (x86_64 / ARM64):** `ghcr.io/owlze/proxdmr:latest` o `andrelli/proxdmr:latest` (montar `./config:/app/config` y `./data:/app/src/data`).
- **Instalación interactiva:** Extraiga `ProxDMR-Release.tar.gz` / `ProxDMR-Release.zip` y ejecute `./setup.sh` (Linux/NAS/RPi) o `setup.bat` / `setup.ps1` (Windows).
- **Actualización desde v2.18 o anterior:** v2.20 añade nuevas dependencias de sistema y Python (`libcodec2-dev`, `libopus0`, `fasttext-numpy2-wheel`, `llama-cpp-python`), por lo que es necesario actualizar la imagen Docker (`docker compose pull && docker compose up -d`) o reconstruir el contenedor (`docker compose up -d --build`) para habilitar audio M17 Codec2, FastLID y traducción local con Qwen.

<!-- lang:fr -->
# ProxDMR v2.20

ProxDMR est un émetteur-récepteur radioamateur client-serveur multiprotocole pour navigateur web et smartphone Android, équipé de vocodeurs 100 % logiciels — sans radio physique, hotspot MMDVM ni clé vocodeur USB.

Démo en ligne (écoute seule) : https://proxdmr.duckdns.org

## Fonctionnalités principales

- **Vocodeurs 100 % logiciels :** Encodage/décodage serveur AMBE+2 (`mbelib-neo`), Codec2 et Opus.
- **Multiprotocole et multi-hotspot :** Plusieurs passerelles virtuelles indépendantes sur un seul écran pour DMR (BrandMeister, TGIF, FreeDMR, ADN, DMR+ / IPSC2), YSF, D-STAR, M17, SVXLink, réflecteurs XLX et AllStarLink v3 (ASL3), avec contrôle API BM/TGIF, catalogues de réflecteurs en direct, favoris et scanner.
- **Clients Web et Android (APK v1.36) :** Audio faible latence dans tout navigateur moderne ou via l'application Android dédiée avec réception en arrière-plan et prise en charge de Tailscale VPN.
- **Transcription, traduction et TTS neuronal :** Reconnaissance vocale en temps réel, détection automatique de la langue, traduction multilingue et synthèse vocale via API cloud (Groq, Gemini) ou IA locale 100 % hors ligne (ASR local, FastLID, Qwen 2.5 et Piper TTS avec phonétique radioamateur).
- **DSP audio RX/TX et sécurité :** Égaliseur RX 10 bandes avec préréglages, AGC, limiteur, tampon jitter adaptatif, réglage du vocodeur AMBE, panoramique L/R des timeslots, DSP microphone TX (EQ, HPF, noise gate, AGC) et TOT configurable.
- **Diagnostics, archive et multi-utilisateurs :** Sonde de serveurs maîtres (ping/jitter/perte), enregistreur `.wav` avec synchronisation RadioID (300 000+ indicatifs), comptes SQLite, mode SWL/démo, sauvegarde/restauration, interface en 8 langues, Watchdog avec alertes Telegram et mises à jour en 1 clic.

## Installation rapide et note de mise à niveau

- **Image Docker (x86_64 / ARM64) :** `ghcr.io/owlze/proxdmr:latest` ou `andrelli/proxdmr:latest` (monter `./config:/app/config` et `./data:/app/src/data`).
- **Installation interactive :** Extrayez `ProxDMR-Release.tar.gz` / `ProxDMR-Release.zip` et lancez `./setup.sh` (Linux/NAS/RPi) ou `setup.bat` / `setup.ps1` (Windows).
- **Mise à niveau depuis v2.18 ou antérieure :** v2.20 ajoute de nouvelles dépendances système et Python (`libcodec2-dev`, `libopus0`, `fasttext-numpy2-wheel`, `llama-cpp-python`). Veuillez mettre à jour l'image Docker (`docker compose pull && docker compose up -d`) ou reconstruire le conteneur (`docker compose up -d --build`) pour activer l'audio M17 Codec2, FastLID et la traduction locale Qwen.

<!-- lang:it -->
# ProxDMR v2.20

ProxDMR è un ricetrasmettitore radioamatoriale client-server multiprotocollo per browser web e smartphone Android con vocoder 100% software, senza bisogno di radio fisica, hotspot MMDVM o chiavetta vocoder USB.

Demo dal vivo (solo ascolto): https://proxdmr.duckdns.org

## Funzionalità principali

- **Vocoder 100% software:** Codifica e decodifica lato server AMBE+2 (`mbelib-neo`), Codec2 e Opus.
- **Multiprotocollo e multi-hotspot:** Gestisci più gateway virtuali indipendenti su un'unica schermata per DMR (BrandMeister, TGIF, FreeDMR, ADN, DMR+ / IPSC2), YSF, D-STAR, M17, SVXLink, riflettori XLX e AllStarLink v3 (ASL3), con controllo TG via API BM/TGIF, cataloghi riflettori live, preferiti e scanner.
- **Client Web e Android (APK v1.36):** Streaming vocale a bassa latenza su browser o tramite app Android nativa con ricezione in background e supporto Tailscale VPN.
- **Trascrizione, traduzione e TTS neurale:** Riconoscimento vocale in tempo reale, rilevamento automatico della lingua, traduzione multilingue e lettura vocale tramite API cloud (Groq, Gemini) o IA locale completamente offline (ASR locale, FastLID, Qwen 2.5 e Piper TTS con fonetica radioamatoriale).
- **DSP audio RX/TX e sicurezza:** Equalizzatore RX a 10 bande con preset, AGC, limiter, jitter buffer adattivo, regolazione vocoder AMBE, panning L/R dei timeslot, DSP microfono TX (EQ, HPF, noise gate, AGC) e TOT configurabile.
- **Diagnostica, archivio e multiutente:** Test server master (ping/jitter/perdita pacchetti), registratore `.wav` con sincronizzazione RadioID (300.000+ nominativi), account SQLite, modalità SWL/demo, backup/ripristino, interfaccia in 8 lingue, Watchdog con avvisi Telegram e aggiornamenti in 1 clic.

## Installazione rapida e nota di aggiornamento

- **Immagine Docker (x86_64 / ARM64):** `ghcr.io/owlze/proxdmr:latest` o `andrelli/proxdmr:latest` (montare `./config:/app/config` e `./data:/app/src/data`).
- **Installazione interattiva:** Estrai `ProxDMR-Release.tar.gz` / `ProxDMR-Release.zip` ed esegui `./setup.sh` (Linux/NAS/RPi) o `setup.bat` / `setup.ps1` (Windows).
- **Aggiornamento da v2.18 o precedente:** v2.20 introduce nuove dipendenze di sistema e Python (`libcodec2-dev`, `libopus0`, `fasttext-numpy2-wheel`, `llama-cpp-python`). Aggiorna l'immagine Docker (`docker compose pull && docker compose up -d`) o ricompila il container (`docker compose up -d --build`) per abilitare audio M17 Codec2, FastLID e traduzione locale Qwen.

<!-- lang:nl -->
# ProxDMR v2.20

ProxDMR is een multiprotocol client-server radioamateur-transceiver voor webbrowsers en Android-smartphones met 100% software-vocoders — zonder fysieke portofoon, MMDVM-hotspot of USB-vocoder.

Live demo (alleen luisteren): https://proxdmr.duckdns.org

## Belangrijkste functies

- **100% software-vocoders:** Server-side AMBE+2 (`mbelib-neo`), Codec2 en Opus codering/decodering.
- **Multiprotocol & multi-hotspot:** Draai meerdere onafhankelijke virtuele gateways tegelijk op één scherm voor DMR (BrandMeister, TGIF, FreeDMR, ADN, DMR+ / IPSC2), YSF, D-STAR, M17, SVXLink, XLX-reflectoren en AllStarLink v3 (ASL3), met BM/TGIF API-talkgroupbeheer, live reflectorcatalogi, favorieten en scanner.
- **Web- en Android-client (APK v1.36):** Spraakstreaming met lage latentie in elke moderne browser of via de Android-app met achtergrondontvangst en Tailscale VPN-ondersteuning.
- **Live transcriptie, vertaling & neurale TTS:** Realtime spraak-naar-tekst, automatische taaldetectie, vertaling en voorlezen via cloud-API's (Groq, Gemini) of volledig offline lokale AI (lokale ASR, FastLID, Qwen 2.5 en Piper TTS met radiofonetiek).
- **RX/TX audio-DSP & beveiliging:** 10-bands RX-equalizer met presets, AGC, limiter, adaptieve jitterbuffer, AMBE-vocoderafstelling, L/R timeslot-panning, TX-microfoon-DSP (EQ, HPF, noise gate, AGC) en instelbare TOT.
- **Diagnostiek, archief & multi-user:** Masterserver-probe (ping/jitter/pakketverlies), ingebouwde `.wav`-recorder met RadioID-sync (300.000+ roepnamen), SQLite-gebruikersaccounts, SWL/gast-demomodus, back-up/herstel, 8 talen, Watchdog met Telegram-meldingen en updates in 1 klik.

## Snelle installatie & upgrade-opmerking

- **Docker-image (x86_64 / ARM64):** `ghcr.io/owlze/proxdmr:latest` of `andrelli/proxdmr:latest` (koppel `./config:/app/config` en `./data:/app/src/data`).
- **Interactieve installatie:** Pak `ProxDMR-Release.tar.gz` / `ProxDMR-Release.zip` uit en start `./setup.sh` (Linux/NAS/RPi) of `setup.bat` / `setup.ps1` (Windows).
- **Upgraden vanaf v2.18 of ouder:** v2.20 voegt nieuwe systeem- en Python-afhankelijkheden toe (`libcodec2-dev`, `libopus0`, `fasttext-numpy2-wheel`, `llama-cpp-python`). Haal de nieuwe Docker-image op (`docker compose pull && docker compose up -d`) of bouw de container opnieuw (`docker compose up -d --build`) om M17 Codec2-audio, FastLID en lokale Qwen-vertaling in te schakelen.
