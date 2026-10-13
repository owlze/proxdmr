<!-- lang:ru -->
# ProxDMR v1.42 — Список изменений

### Радио и аудио
* **Live-подсказки TalkGroup**: всплывающее превью страны, флага и описания группы при вводе номера TG.
* **TS Doubl (одновременный прием)**: исправлена изоляция звуковых потоков и маршрутизация при приеме двух слотов.
* **VFO-память**: сохранение данных последнего корреспондента при простое более 30 сек.

### AI и синтез речи (ASR / TTS)
* **Автономный TTS**: переход на оффлайн-движки Silero v5 и Piper TTS, исключен внешний Edge TTS.
* **Groq Cloud & Gemini**: быстрое распознавание (Whisper-large-v3) и перевод (Llama 3.3 70B / Gemini).
* **Приоритет озвучки**: временный Solo Mute других каналов при активном синтезе, автосброс кнопок при обрыве связи.

### Обновление программы
* **Обновление в 1 клик**: проверка релизов с GitHub, автобэкап файлов и конфига, перезапуск службы.
* **Исправление проверки бета-версий**: корректное получение предрелизных обновлений и полного списка изменений.
* **Мультиязычный чейнджлог**: модальное окно на 7 языках в едином стиле приложения.

### Интерфейс и локализация
* **7 языков (i18n)**: перевод плейсхолдеров паролей, тултипов и статусов загрузки (ru, en, uk, de, es, fr, it).
* **Кэш-бастинг ресурсов**: мгновенное обновление клиентских скриптов без ручной очистки кэша браузера.
* **Визуальный отклик**: анимация подтверждения при сохранении настроек, шкала пинга с цветовой градацией.

<!-- lang:en -->
# ProxDMR v1.42 — Release Notes

### Radio & Audio
* **Live TalkGroup Tooltips**: Instant popup with country name, flag, and group description while typing a TG number.
* **TS Doubl Mode**: Fixed audio stream isolation and routing during concurrent two-slot reception.
* **VFO Standby Memory**: Preserves last correspondent info after 30 seconds of inactivity.

### AI & Speech Synthesis (ASR / TTS)
* **Offline TTS Engines**: Full migration to local Silero v5 and Piper TTS, removed external Edge TTS dependency.
* **Groq Cloud & Gemini**: High-speed speech recognition (Whisper-large-v3) and translation (Llama 3.3 70B / Gemini).
* **Playback Priority**: Temporary Solo Mute for other channels during synthesis, auto-reset of buttons on disconnect.

### Application Updates
* **1-Click Seamless Update**: Background GitHub release checks, automated code and config backup, safe restart.
* **Pre-Release Beta Support**: Fixed release fetching and changelog display for beta releases.
* **Multilingual Changelog**: Modal dialog with instant switching across 7 supported languages.

### UI & Localization
* **Full i18n (7 Languages)**: Localized password placeholders, loading tooltips, and status hints.
* **Asset Cache-Busting**: Immediate client script and style refreshes without manual browser cache clearing.
* **Visual Polish**: Glowing save confirmation animation, latency indicator color scale.

<!-- lang:uk -->
# ProxDMR v1.42 — Список змін

### Радіо та аудіо
* **Live-підказки TalkGroup**: спливаюче прев'ю країни, прапора та опису групи під час введення номера TG.
* **TS Doubl (одночасний прийом)**: виправлено ізоляцію звукових потоків та маршрутизацію під час прийому двох слотів.
* **VFO-пам'ять**: збереження даних останнього кореспондента у режимі очікування понад 30 сек.

### AI та синтез мовлення (ASR / TTS)
* **Автономний TTS**: перехід на оффлайн-рушії Silero v5 та Piper TTS, видалено зовнішній Edge TTS.
* **Groq Cloud & Gemini**: швидке розпізнавання (Whisper-large-v3) та переклад (Llama 3.3 70B / Gemini).
* **Пріоритет озвучення**: тимчасовий Solo Mute інших каналів під час активного синтезу, автоскидання кнопок при обриві зв'язку.

### Оновлення програми
* **Оновлення в 1 клік**: перевірка релізів з GitHub, автобекап файлів і конфігурації, перезапуск служби.
* **Підтримка бета-релізів**: виправлено отримання передрелізних оновлень та повного списку змін.
* **Багатомовний чейнджлог**: модальне вікно 7 мовами у єдиному стилі інтерфейсу.

### Інтерфейс та локалізація
* **7 мов (i18n)**: переклад плейсхолдерів паролів, підказок завантаження та статусів (ru, en, uk, de, es, fr, it).
* **Кеш-бастинг ресурсів**: миттєве оновлення клієнтських скриптів без ручного очищення кешу браузера.
* **Візуальний відгук**: анімація підтвердження збереження налаштувань, колірна шкала пінгу.

<!-- lang:de -->
# ProxDMR v1.42 — Änderungsprotokoll

### Funk & Audio
* **Live-TalkGroup-Vorschau**: Direktes Popup mit Ländernamen, Flagge und Gruppenbeschreibung bei TG-Eingabe.
* **TS Doubl Modus**: Isolierung der Audioströme und Routing bei simultanem Empfang beider Zeitschlitze behoben.
* **VFO-Standby-Speicher**: Erhaltung der letzten Gegenstationsdaten nach mehr als 30 Sekunden Inaktivität.

### KI & Sprachsynthese (ASR / TTS)
* **Autonome TTS-Engines**: Vollständiger Wechsel zu lokalen Silero v5 und Piper TTS, externe Edge TTS entfernt.
* **Groq Cloud & Gemini**: Schnelle Spracherkennung (Whisper-large-v3) und Übersetzung (Llama 3.3 70B / Gemini).
* **Wiedergabepriorität**: Temporäres Solo-Mute anderer Kanäle während Sprachausgabe, Auto-Reset bei Verbindungsabbruch.

### Programm-Aktualisierung
* **1-Klick-Update**: GitHub-Release-Prüfung, automatische Sicherung von Dateien und Konfiguration, sicherer Neustart.
* **Beta-Release-Unterstützung**: Erkennung von Vorabversionen und vollständige Changelog-Anzeige korrigiert.
* **Mehrsprachiges Änderungsprotokoll**: Vollbild-Modal mit 7 unterstützten Sprachen im einheitlichen Design.

### Oberfläche & Lokalisierung
* **7 Sprachen (i18n)**: Lokalisierte Passwort-Platzhalter, Lade-Tooltips und Statusmeldungen (ru, en, uk, de, es, fr, it).
* **Cache-Busting für Skripte**: Sofortige Aktualisierung der Skripte ohne manuelles Leeren des Browser-Caches.
* **Visuelle Rückmeldung**: Leuchtanimation beim Speichern von Einstellungen, farbige Ping-Skala.

<!-- lang:es -->
# ProxDMR v1.42 — Registro de cambios

### Radio y audio
* **Vista previa TalkGroup en vivo**: Mensaje emergente con país, bandera y descripción del grupo al escribir el TG.
* **Modo TS Doubl**: Corregido el aislamiento de canales y enrutamiento de audio durante la recepción simultánea de dos ranuras.
* **Memoria de reposo VFO**: Conservación de datos del último corresponsal tras 30 segundos de inactividad.

### IA y síntesis de voz (ASR / TTS)
* **Motores TTS locales**: Transición completa a Silero v5 y Piper TTS sin conexión, eliminada la dependencia de Edge TTS.
* **Groq Cloud & Gemini**: Reconocimiento ultrarrápido (Whisper-large-v3) y traducción (Llama 3.3 70B / Gemini).
* **Prioridad de reproducción**: Solo Mute temporal para otros canales durante la locución, reinicio de botones al desconectar.

### Actualización del sistema
* **Actualización en 1 clic**: Detección de versiones en GitHub, copia de seguridad automática y reinicio seguro.
* **Soporte de versiones Beta**: Corrección en la obtención de actualizaciones previas y visualización del registro de cambios.
* **Historial multilingüe**: Ventana modal en 7 idiomas adaptada al diseño de la aplicación.

### Interfaz y localización
* **7 idiomas (i18n)**: Traducción de marcadores de posición de contraseñas, avisos de carga y estados.
* **Actualización inmediata de recursos**: Renovación automática de scripts de cliente sin limpiar caché del navegador.
* **Respuesta visual**: Animación luminosa de confirmación al guardar ajustes, escala cromática de latencia.

<!-- lang:fr -->
# ProxDMR v1.42 — Notes de version

### Radio et audio
* **Aperçu TalkGroup en direct**: Infobulle instantanée avec pays, drapeau et description du groupe lors de la saisie d'un TG.
* **Mode TS Doubl**: Correction de l'isolation des flux audio et du routage lors de la réception simultanée de deux slots.
* **Mémoire VFO en veille**: Préservation des données du dernier correspondant après 30 secondes d'inactivité.

### IA et synthèse vocale (ASR / TTS)
* **Moteurs TTS autonomes**: Migration complète vers Silero v5 et Piper TTS hors-ligne, suppression d'Edge TTS.
* **Groq Cloud & Gemini**: Transcription rapide (Whisper-large-v3) et traduction (Llama 3.3 70B / Gemini).
* **Priorité de diffusion**: Solo Mute temporaire des autres canaux pendant la synthèse, réinitialisation des boutons à la déconnexion.

### Mise à jour du système
* **Mise à jour en 1 clic**: Détection des versions GitHub, sauvegarde automatique des fichiers et réglages, redémarrage propre.
* **Support des versions bêta**: Correction de la récupération des préversions et affichage complet des notes.
* **Journal multilingue**: Fenêtre modale disponible en 7 langues dans le style natif de l'application.

### Interface et localisation
* **7 langues (i18n)**: Traduction des textes indicatifs de mots de passe, infobulles de chargement et statuts.
* **Rafraîchissement des scripts**: Mise à jour immédiate des scripts clients sans vider manuellement le cache.
* **Retour visuel**: Animation lumineuse lors de l'enregistrement des réglages, échelle colorée de latence réseau.

<!-- lang:it -->
# ProxDMR v1.42 — Registro delle modifiche

### Radio e audio
* **Anteprima TalkGroup in tempo reale**: Finestra a comparsa con paese, bandiera e descrizione del gruppo digitando il TG.
* **Modalità TS Doubl**: Corretto l'isolamento dei flussi audio e l'instradamento durante la ricezione simultanea di due slot.
* **Memoria standby VFO**: Conservazione delle informazioni dell'ultimo corrispondente dopo 30 secondi di inattività.

### IA e sintesi vocale (ASR / TTS)
* **Motori TTS autonomi**: Passaggio completo a Silero v5 e Piper TTS offline, rimossa la dipendenza da Edge TTS.
* **Groq Cloud & Gemini**: Trascrizione ad alta velocità (Whisper-large-v3) e traduzione (Llama 3.3 70B / Gemini).
* **Priorità vocale**: Solo Mute temporaneo degli altri canali durante la sintesi, ripristino automatico pulsanti alla disconnessione.

### Aggiornamento del programma
* **Aggiornamento con 1 clic**: Controllo release da GitHub, backup automatico di codice e configurazioni, riavvio sicuro.
* **Supporto versioni beta**: Corretto il rilevamento degli aggiornamenti prerelease e la visualizzazione del changelog.
* **Changelog multilingue**: Finestra modale con passaggio istantaneo tra le 7 lingue supportate.

### Interfaccia e localizzazione
* **7 lingue (i18n)**: Traduzione dei segnaposto password, suggerimenti di caricamento e stati.
* **Aggiornamento immediato script**: Cache-busting per script e stili senza cancellazione manuale della cache del browser.
* **Riscontro visivo**: Animazione luminosa al salvataggio impostazioni, scala colori per il ping di rete.
