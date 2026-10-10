<!-- lang:ru -->
# ProxDMR v1.41 — Список изменений и нововведений

Комплексное обновление системы за последние 3 дня: новый встроенный механизм автообновления, модульная поддержка облачного AI-движка транскрибации и перевода Groq Cloud, локальный синтез Piper TTS с голосом Terra по умолчанию, автоматический сброс транскрибации/озвучки при обрыве связи, интеллектуальное управление таймслотами TS1/TS2 (Solo, Doubl, Auto), умный VFO-дисплей и улучшенная эргономика интерфейса.

### 🚀 Система обновления программы («Обновление ProxDMR»)
* **Автоматическая проверка обновлений**: Встроенный фоновый опрос репозитория GitHub на наличие свежих релизов и тегов.
* **Сворачиваемый блок настроек**: В «Общих настройках» появился специальный блок с бейджем актуальности версии, кнопкой ручной проверки и прямой установкой.
* **Глобальное управление оповещениями**: Добавлена опция «Не оповещать об обновлениях» (отключает всплывающие уведомления, сохраняя индикацию внутри настроек).
* **Ненавязчивый баннер**: Оповещение показывается не чаще 1 раза в сутки с возможностью «Не оповещать до следующей версии».
* **Интерактивный список изменений (Changelog)**: Адаптивное модальное окно на весь экран смартфона или ПК с автоматическим выбором языка интерфейса и переключением между 7 языками.
* **Безопасное обновление в 1 клик**: Сервер автоматически загружает релиз, создает резервную копию конфигурации и исходников, разворачивает файлы и перезапускает систему без потери данных.

### 🎙️ AI Транскрибатор речи и Синтез (ASR / TTS)
* **Интеграция Groq Cloud и локального Piper TTS**:
  - Быстрое распознавание речи через Groq API (Whisper-large-v3) параллельно с Google Gemini.
  - Движки перевода: поддержка Groq (Llama 3.3 70B) и Google Gemini с опцией «Результат распознавания без перевода».
  - Синтез речи (TTS): интеграция Groq TTS (Orpheus) и локального движка Piper TTS с качественными оффлайн-голосами.
  - Дефолтная связка для новых аккаунтов: Groq (распознавание) / Groq (перевод) / Piper TTS голос Terra (для русского языка).
* **Приоритет прямого синтеза речи и временный Solo Mute**:
  - При включении транскрибации с озвучкой на таймслоте любой другой синтез речи (другие слоты, чтение стенограммы лога, плеер записей) немедленно останавливается, а хотспот автоматически переходит в режим Solo с активацией рабочего TS.
  - Приглушение остальных звуковых каналов во время озвучки действует строго временно и не перезаписывает постоянный статус Mute пользователя в базе данных и `localStorage`.
* **Автосброс при обрыве сессии**: При любом разрыве соединения с сервером или потере сети кнопки TXT и синтеза речи автоматически сбрасываются в состояние «Выключено».
* **Лаконичное мини-меню кнопки «TXT»**: Быстрое всплывающее меню по клику на кнопку «TXT» для оперативной смены движков и моделей; поля ввода ключей убраны и безопасно сосредоточены в настройках.
* **Интеллектуальный транслитератор латиницы**: Автоматическая адаптация латинских названий в кириллицу для Piper TTS с сохранением позывных (Callsign) и оригинального текста в логе.
* **Регулятор скорости речи**: Независимая регулировка скорости воспроизведения синтезатора (`tts_speed`) с быстрым сохранением и корректным дакингом звука.

### 🔊 Аудиосистема и управление таймслотами (TS1 / TS2)
* **Трехпозиционный переключатель режимов прослушивания**:
  - **TS1/2 Solo 🔊**: в эфире звучит только один выбранный таймслот (таймслоты всегда имеют противоположные статусы Mute).
  - **TS1/2 Doubl 🔊**: одновременное воспроизведение обоих таймслотов в любой комбинации Mute.
  - **TS1/2 Auto 🔊**: автоматическое переключение звука на активный таймслот (первый зазвучавший таймслот блокирует второй; сброс флага через 2 сек после окончания передачи при тишине на втором канале).
* **Персональное сохранение**: Режим воспроизведения и индивидуальные кнопки Mute надежно сохраняются в профиле каждого хотспота.
* **Калибровка уровней**: Перекалибровано соотношение громкости эфира и плеера QSO-записей (-9 дБ), регулятор переименован в «Общее усиление по выходу НЧ».

### 📺 VFO Дисплей, графики сети и визуальные улучшения
* **Интеллектуальная память VFO**: При отсутствии вызова более 30 сек дисплей сохраняет данные последнего корреспондента (позывной, имя, страна, город) в приглушенных обесцвеченных тонах вместо стандартной надписи «Ожидание вызова».
* **Расширенная геолокация**: Для радиолюбительских разговорных групп отображается флаг, страна и город корреспондента.
* **Новая палитра графиков пинга**: Наглядная цветовая шкала латентности: зеленый (<100 мс), желтый (100–170 мс), средний красный (170–250 мс) и ярко-алый (>250 мс).
* **Световое подтверждение сохранения**: Зеленая анимация по контуру модального окна (`modal-save-pulse`) при сохранении настроек с последующим автоматическим закрытием окна.

### 🛡️ DMR, PTT и надежность
* **Защита PTT (Safety Guard)**: Блокировка случайной передачи при отсутствии стабильного соединения с Homebrew Gateway или BrandMeister.
* **Удержание Roger Beep**: Корректное продление передачи на длительность сигнала Roger Beep + задержка в 1 секунду до опускания PTT.
* **Менеджер порядка хотспотов**: Возможность переставлять виртуальные хотспоты в удобном порядке (основной хотспот фиксирован).
* **Экспорт и импорт конфигурации**: Полноценное резервное копирование всех оперативных параметров с разграничением прав суперадмина и пользователей.

---

<!-- lang:en -->
# ProxDMR v1.41 — Release Notes & Changelog

Comprehensive system update over the last 3 days: built-in auto-update system, modular cloud AI speech transcription and translation via Groq Cloud, local Piper TTS with Terra voice by default, automatic reset of transcription and TTS buttons upon disconnect, intelligent timeslot management (TS Solo, Doubl, Auto), smart VFO standby memory, and enhanced UI ergonomics.

### 🚀 ProxDMR Update Subsystem
* **Automatic GitHub Update Checks**: Background polling of the official GitHub repository for new releases and tags.
* **Collapsible Settings Block**: Dedicated «ProxDMR Update» card in General Settings with live version status, manual check button, and one-click update trigger.
* **Global Notifications Toggle**: New «Do not notify about updates» option (suppresses banners while keeping status & update buttons accessible in settings).
* **Unobtrusive 24h Notification Banner**: Appears no more than once every 24 hours with a «Do not notify until next version» dismissal checkbox.
* **Interactive Responsive Changelog**: Fullscreen modal dialog tailored for smartphones and desktop screens, automatically displayed in the application's active language across 7 supported locales.
* **1-Click Seamless Update**: Server safely downloads the release tarball, creates an automated source code backup, applies updates, and restarts the service without losing user configuration.

### 🎙️ AI Speech Transcriber & Synthesis (ASR / TTS)
* **Groq Cloud AI & Local Piper TTS**:
  - High-speed speech-to-text via Groq Cloud API (Whisper-large-v3) alongside Google Gemini.
  - Translation engines: support for Groq (Llama 3.3 70B) and Google Gemini, with an option to bypass translation («Recognition result without translation»).
  - Speech Synthesis (TTS): integrated Groq TTS (Orpheus) alongside local offline Piper TTS.
  - Default combination for new accounts: Groq (recognition) / Groq (translation) / Piper TTS Terra voice (for Russian).
* **Auto-Reset on Disconnect**: On connection drop or network loss, TXT and TTS buttons automatically revert to their default OFF state.
* **Streamlined «TXT» Quick Menu**: Popup menu accessible directly from the «TXT» button to switch engines and models; API key inputs moved strictly to General Settings.
* **Smart Latin Transliteration**: Automatic pronunciation preprocessing for Piper TTS converts Latin technical terms into Cyrillic phonetics while keeping callsigns and original logs untouched.
* **Speech Playback Speed Slider**: Dedicated quick-speed control (`tts_speed`) with instant persistence and audio ducking synchronization.

### 🔊 Audio Pipeline & Timeslot Routing (TS1 / TS2)
* **Three-Position Timeslot Mode Switcher**:
  - **TS1/2 Solo 🔊**: Only one selected timeslot is unmuted at any time (timeslots always maintain opposite mute states).
  - **TS1/2 Doubl 🔊**: Both timeslots can play concurrently in any custom user mute combination.
  - **TS1/2 Auto 🔊**: Automatic audio routing to the active timeslot (first incoming transmission captures the audio channel; resets 2s after transmission ends if the second TS is quiet).
* **Per-Hotspot State Persistence**: Audio routing modes and individual mute buttons are stored per virtual hotspot.
* **Audio Gain Calibration**: Equalized volume levels between live air audio and recorded QSO player (-9 dB attenuation calibration); renamed to «Overall AF Output Gain».

### 📺 VFO Display, Network Diagnostics & Visual Polish
* **Smart VFO Standby Memory**: When idle for >30 seconds, the display preserves the last active correspondent details (callsign, name, country, city) in a dim gray style instead of generic «Waiting for call».
* **Enriched Location Data**: Amateur radio talkgroups now display flags, country names, and city information.
* **Network Ping Palette**: Intuitive color-coded latency indicators: green (<100 ms), yellow (100–170 ms), medium red (170–250 ms), and bright red (>250 ms).
* **Modal Save Glow Pulse**: Glowing green contour feedback (`modal-save-pulse`) on saving settings, followed by automatic smooth modal dismissal.

### 🛡️ DMR, PTT & System Reliability
* **PTT Safety Guard**: Prevents accidental transmission when disconnected from Gateway or BrandMeister master.
* **Roger Beep Hold-Time**: Extended TX keying matching Roger Beep duration plus a 1-second release buffer to eliminate clipped tail tones.
* **Hotspot Sequence Ordering**: Easy reordering of secondary virtual hotspots while keeping the primary hotspot anchored.
* **Complete Config Backup & Restore**: Robust export and import of all operational parameters with superadmin role segregation.

---

<!-- lang:uk -->
# ProxDMR v1.41 — Список змін та нововведень

Комплексне оновлення системи за останні 3 дні: вбудований механізм автоматичного оновлення, модульна підтримка хмарного AI-рушія транскрибації та перекладу Groq Cloud, локальний синтез Piper TTS із голосом Terra за замовчуванням, автоматичне скидання транскрибації/озвучення при обриві зв'язку, інтелектуальне керування таймслотами TS1/TS2 (Solo, Doubl, Auto), розумний VFO-дисплей та покращена ергономіка інтерфейсу.

### 🚀 Система оновлення програми («Оновлення ProxDMR»)
* **Автоматична перевірка оновлень**: Фонове опитування офіційного репозиторію GitHub щодо наявності нових релізів і тегів.
* **Блок налаштувань, що згортається**: У «Загальних налаштуваннях» додано картку з індикатором актуальності, кнопкою ручної перевірки та запуском оновлення.
* **Глобальне керування сповіщеннями**: Опція «Не сповіщати про оновлення» (вимикає банери, залишаючи статус та кнопку в налаштуваннях).
* **Ненав'язливий банер оновлень**: З'являється не частіше 1 разу на добу з можливістю «Не сповіщати до наступної версії».
* **Інтерактивний список змін (Changelog)**: Адаптивне модальне вікно для смартфонів та ПК з автовибором мови інтерфейсу та вибором серед 7 мов.
* **Безпечне оновлення в 1 клік**: Сервер завантажує реліз, створює резервну копію конфігурації та файлів, розгортає оновлення та перезапускає систему без втрати даних.

### 🎙️ AI Транскрибатор мовлення та Синтез (ASR / TTS)
* **Інтеграція Groq Cloud та локального Piper TTS**:
  - Швидке розпізнавання мовлення через Groq API (Whisper-large-v3) поруч із Google Gemini.
  - Рушії перекладу: підтримка Groq (Llama 3.3 70B) та Google Gemini з можливістю вимкнення перекладу («Результат розпізнавання без перекладу»).
  - Синтез мовлення (TTS): інтеграція Groq TTS (Orpheus) на додаток до локального оффлайн-рушія Piper TTS.
  - Комбінація за замовчуванням для нових облікових записів: Groq (розпізнавання) / Groq (переклад) / Piper TTS голос Terra (для української/російської).
* **Автоскидання при обриві сесії**: У разі втрати зв'язку із сервером кнопки TXT та озвучення скидаються у стан «Вимкнено».
* **Лаконічне міні-меню кнопки «TXT»**: Швидке спливаюче меню за натисканням на кнопку «TXT» для зміни моделей; поля введення ключів зосереджені виключно у загальних налаштуваннях.
* **Інтелектуальний транслітератор латиниці**: Автоматична адаптація термінів для Piper TTS зі збереженням позивних та оригіналу в лозі.
* **Регулятор швидкості мовлення**: Швидке налаштування швидкості синтезу (`tts_speed`) із миттєвим збереженням та дакінгом звуку.

### 🔊 Аудіосистема та керування таймслотами (TS1 / TS2)
* **Трьохпозиційний перемикач режимів прослуховування**:
  - **TS1/2 Solo 🔊**: звучить лише один обраний таймслот (інший автоматично приглушується).
  - **TS1/2 Doubl 🔊**: одночасне відтворення обох таймслотів у довільній комбінації Mute.
  - **TS1/2 Auto 🔊**: автоматичне перемикання звуку на активний таймслот із поверненням у нейтральний стан через 2 секунди тиші.
* **Персональне збереження**: Режим відтворення та кнопки Mute зберігаються індивідуально для кожного хотспота.
* **Калібрування звуку**: Вирівняно гучність ефіру та плеєра записів QSO (-9 дБ), регулятор перейменовано на «Загальне підсилення виходу НЧ».

### 📺 VFO Дисплей, графіки мережі та візуальні вдосконалення
* **Пам'ять чергового режиму VFO**: Після 30 секунд тиші дисплей зберігає дані останнього кореспондента у приглушених тонах замість напису «Очікування виклику».
* **Геолокація кореспондентів**: Відображення прапора, назви країни та міста для радіоаматорських груп.
* **Колірна палітра пінгу**: Зручна шкала затримки: зелений (<100 мс), жовтий (100–170 мс), червоний (170–250 мс) та яскраво-червоний (>250 мс).
* **Світлове підтвердження збереження**: Зелена пульсація контуру вікна (`modal-save-pulse`) під час збереження налаштувань із наступним закриттям вікна.

### 🛡️ DMR, PTT та стабільність
* **Захист PTT**: Блокування випадкової передачі за відсутності з'єднання з Gateway або BrandMeister.
* **Утримання Roger Beep**: Подовження передачі на тривалість Roger Beep + затримка 1 сек перед вимкненням PTT.
* **Керування порядком хотспотів**: Зручне сортування другорядних віртуальних хотспотів.
* **Резервне копіювання**: Надійний експорт та імпорт конфігурації із розмежуванням прав суперадміна та користувачів.

---

<!-- lang:de -->
# ProxDMR v1.41 — Änderungsprotokoll & Neuerungen

Umfassendes System-Update der letzten 3 Tage: integrierter Auto-Updater, modulare Cloud-KI-Sprachtranskription und -Übersetzung über Groq Cloud, lokale Piper-TTS mit Terra-Stimme als Standard, automatische Deaktivierung von Transkription und TTS bei Verbindungsabbruch, intelligente Zeitschlitz-Steuerung TS1/TS2 (Solo, Doubl, Auto), intelligenter VFO-Standby-Speicher und verbesserte Benutzeroberfläche.

### 🚀 ProxDMR Update-System
* **Automatische GitHub-Prüfung**: Regelmäßige Hintergrundabfrage des offiziellen GitHub-Repositorys nach neuen Releases und Tags.
* **Einklappbarer Einstellungsbereich**: Neuer Bereich «ProxDMR-Aktualisierung» in den allgemeinen Einstellungen mit Statusanzeige, manueller Prüfung und 1-Klick-Installation.
* **Globale Benachrichtigungssteuerung**: Neue Option «Nicht über Updates benachrichtigen» (unterdrückt Banner, hält Anzeige in den Einstellungen aktiv).
* **Dezentes 24h-Hinweisbanner**: Erscheint maximal einmal alle 24 Stunden mit der Option «Bis zur nächsten Version nicht mehr erinnern».
* **Interaktives Änderungsprotokoll**: Vollbild-Modal für Smartphones und PCs mit automatischer Spracherkennung und Umschaltung zwischen 7 Sprachen.
* **Sicheres 1-Klick-Update**: Der Server lädt das Release herunter, erstellt ein Backup, aktualisiert Dateien und startet den Dienst unterbrechungsfrei neu.

### 🎙️ KI-Sprachtranskription & Sprachsynthese (ASR / TTS)
* **Groq Cloud KI & lokale Piper TTS**:
  - Hochgeschwindigkeits-Spracherkennung über Groq Cloud API (Whisper-large-v3) neben Google Gemini.
  - Übersetzungs-Engines: Unterstützung für Groq (Llama 3.3 70B) und Google Gemini mit Option zur Deaktivierung («Erkennung ohne Übersetzung»).
  - Sprachsynthese (TTS): Integration von Groq TTS (Orpheus) zusätzlich zur lokalen Piper TTS.
  - Standardkombination für neue Konten: Groq (Erkennung) / Groq (Übersetzung) / Piper TTS Terra-Stimme.
* **Automatischer Reset bei Verbindungsabbruch**: Bei Abbruch der Server- oder Netzverbindung werden TXT und TTS automatisch auf AUS zurückgesetzt.
* **Kompaktes «TXT»-Schnellmenü**: Direktes Popup-Menü an der TXT-Taste zum schnellen Umschalten von Modellen; API-Schlüsselfelder verbleiben sicher in den Haupteinstellungen.
* **Intelligente Transliteration**: Automatische Aussprache-Optimierung für Piper TTS bei lateinischen Begriffen mit Schutz für Rufzeichen.
* **Wiedergabegeschwindigkeit-Regler**: Schneller Schieberegler für die Sprachgeschwindigkeit (`tts_speed`) mit sofortiger Speicherung und Audio-Ducking.

### 🔊 Audiosystem & Zeitschlitz-Routing (TS1 / TS2)
* **Dreistufiger Zeitschlitz-Umschalter**:
  - **TS1/2 Solo 🔊**: Nur ein ausgewählter Zeitschlitz ist aktiv (gegenseitige Stummschaltung).
  - **TS1/2 Doubl 🔊**: Gleichzeitige Wiedergabe beider Zeitschlitze in beliebiger Mute-Kombination.
  - **TS1/2 Auto 🔊**: Automatische Audio-Umschaltung auf den aktiven Zeitschlitz mit Rückkehr nach 2 Sekunden Stille.
* **Persistente Hotspot-Profile**: Modus und Stummschaltungsstatus werden pro virtuellem Hotspot gespeichert.
* **Audiopegel-Kalibrierung**: Angeglichene Lautstärke zwischen Live-Empfang und QSO-Player (-9 dB Dämpfung); umbenannt in «Gesamtverstärkung NF-Ausgang».

### 📺 VFO-Anzeige, Netzwerkdiagnose & Ergonomie
* **Intelligenter VFO-Standby**: Nach 30 Sekunden Inaktivität bleiben Rufzeichen, Name, Land und Stadt des letzten Kontakts abgedunkelt sichtbar.
* **Erweiterte Standortdaten**: Anzeige von Flaggen, Ländernamen und Städten für DMR-Gesprächsgruppen.
* **Netzwerk-Ping-Farbskala**: Intuitive Latenzfarben: Grün (<100 ms), Gelb (100–170 ms), Rot (170–250 ms) und Hellrot (>250 ms).
* **Visuelle Speicherbestätigung**: Grüner Leuchtimpuls am Fensterrand (`modal-save-pulse`) beim Speichern von Einstellungen mit anschließendem automatischem Schließen.

### 🛡️ DMR, PTT & Betriebssicherheit
* **PTT-Schutzfunktion**: Verhindert versehentliches Senden bei fehlender Verbindung zum Gateway oder BrandMeister.
* **Roger-Beep-Verzögerung**: Sendeverlängerung um die Dauer des Roger-Beeps plus 1 Sekunde Puffer vor dem PTT-Abfall.
* **Hotspot-Reihenfolge**: Flexible Neuanordnung sekundärer virtueller Hotspots.
* **Vollständiges Backup**: Export und Import aller Einstellungen mit Rollentrennung zwischen Superadmin und Benutzern.

---

<!-- lang:es -->
# ProxDMR v1.41 — Registro de cambios y novedades

Actualización integral del sistema durante los últimos 3 días: nuevo sistema de actualización automática integrado, soporte modular para IA en la nube Groq Cloud, síntesis local Piper TTS con voz Terra por defecto, restablecimiento automático de transcripción y TTS al desconectarse, gestión inteligente de ranuras temporales TS1/TS2 (Solo, Doubl, Auto), pantalla VFO con memoria en reposo y ergonomía visual perfeccionada.

### 🚀 Sistema de actualización ProxDMR
* **Verificación automática con GitHub**: Consulta periódica en segundo plano al repositorio oficial en busca de nuevas versiones y etiquetas.
* **Bloque desplegable en ajustes**: Nueva sección «Actualización de ProxDMR» en los ajustes generales con estado de versión, comprobación manual e instalación en 1 clic.
* **Control global de notificaciones**: Opción «No avisar sobre actualizaciones» (desactiva avisos emergentes sin ocultar el botón en ajustes).
* **Aviso discreto cada 24 horas**: Aparece como máximo una vez al día con la opción «No volver a avisar para esta versión».
* **Historial de cambios interactivo**: Ventana modal a pantalla completa para móviles y PC con detección automática del idioma entre los 7 idiomas disponibles.
* **Actualización segura en 1 clic**: El servidor descarga el paquete, genera una copia de seguridad, actualiza los archivos y reinicia el servicio sin perder datos.

### 🎙️ Transcriptor de voz IA y Síntesis (ASR / TTS)
* **Integración de Groq Cloud y Piper TTS local**:
  - Transcripción ultrarrápida mediante Groq Cloud API (Whisper-large-v3) junto a Google Gemini.
  - Motores de traducción: soporte para Groq (Llama 3.3 70B) y Google Gemini, con opción de omitir traducción («Resultado sin traducción»).
  - Síntesis de voz (TTS): integración de Groq TTS (Orpheus) junto con el motor local Piper TTS.
  - Combinación predeterminada para nuevas cuentas: Groq (reconocimiento) / Groq (traducción) / Piper TTS voz Terra.
* **Restablecimiento por desconexión**: Ante caídas de conexión o pérdida de red, los botones TXT y TTS vuelven automáticamente al estado APAGADO.
* **Menú emergente «TXT» simplificado**: Acceso rápido desde el botón «TXT» para cambiar de motor y modelo; campos de clave API ubicados exclusivamente en Ajustes Generales.
* **Transliteración inteligente**: Adaptación fonética automática para Piper TTS de palabras en caracteres latinos manteniendo intactos los indicativos y registros originales.
* **Control deslizante de velocidad de voz**: Ajuste rápido de la velocidad de reproducción (`tts_speed`) con guardado inmediato y atenuación automática (ducking).

### 🔊 Canal de audio y enrutamiento de ranuras (TS1 / TS2)
* **Conmutador de ranuras temporales de 3 posiciones**:
  - **TS1/2 Solo 🔊**: Solo suena una ranura temporal seleccionada (estados de silenciamiento opuestos).
  - **TS1/2 Doubl 🔊**: Reproducción simultánea de ambas ranuras en cualquier combinación de mute.
  - **TS1/2 Auto 🔊**: Conmutación automática hacia la ranura activa con restablecimiento tras 2 segundos de silencio.
* **Persistencia por Hotspot**: La configuración de modo y botones de silenciamiento se guarda de forma independiente para cada hotspot virtual.
* **Calibración de volumen**: Nivelación óptima entre el audio en directo y el reproductor de QSO (-9 dB de atenuación); renombrado a «Ganancia general de salida de audio».

### 📺 Pantalla VFO, diagnóstico de red y mejoras visuales
* **Memoria inteligente de VFO en reposo**: Tras 30 segundos de inactividad, se conservan los datos del último corresponsal (indicativo, nombre, país, ciudad) atenuados en lugar del texto genérico «Esperando llamada».
* **Datos geográficos completos**: Indicación de bandera, país y ciudad en los grupos de conversación de radioaficionados.
* **Escala de colores para el Ping**: Verde (<100 ms), amarillo (100–170 ms), rojo medio (170–250 ms) y rojo vivo (>250 ms).
* **Confirmación visual de guardado**: Destello verde en el contorno de la ventana (`modal-save-pulse`) al guardar ajustes, con cierre suave automático.

### 🛡️ DMR, PTT y fiabilidad
* **Protección de PTT**: Bloquea la transmisión accidental si se pierde la conexión con el Gateway o el máster BrandMeister.
* **Retención de Roger Beep**: Extensión del tiempo de transmisión según la duración del Roger Beep más 1 segundo de margen antes de liberar el PTT.
* **Organizador de hotspots**: Reordenación intuitiva de los hotspots virtuales secundarios.
* **Copia de seguridad completa**: Exportación e importación segura de configuraciones con diferenciación de permisos entre superadministrador y usuarios.

---

<!-- lang:fr -->
# ProxDMR v1.41 — Notes de version et nouveautés

Mise à jour majeure du système au cours des 3 derniers jours : système de mise à jour automatique intégré, transcription et traduction IA modulaires dans le cloud via Groq Cloud, synthèse vocale locale Piper TTS avec voix Terra par défaut, réinitialisation automatique de la transcription et de la voix en cas de déconnexion, gestion intelligente des créneaux TS1/TS2 (Solo, Doubl, Auto), mémoire VFO en veille et ergonomie optimisée.

### 🚀 Sous-système de mise à jour ProxDMR
* **Vérification automatique GitHub** : Scrutation en arrière-plan du dépôt officiel pour détecter les nouvelles versions et balises.
* **Section repliable dans les paramètres** : Nouvel encart « Mise à jour ProxDMR » dans les paramètres généraux avec état de version, vérification manuelle et installation en 1 clic.
* **Gestion globale des notifications** : Option « Ne pas avertir des mises à jour » (masque les bannières tout en conservant le bouton dans les paramètres).
* **Bannière discrète quotidienne** : Affichée au maximum une fois toutes les 24 heures avec possibilité de masquer jusqu'à la prochaine version.
* **Journal des modifications interactif** : Fenêtre plein écran adaptée aux smartphones et ordinateurs, affichée automatiquement dans la langue de l'application parmi les 7 langues supportées.
* **Mise à jour sécurisée en un clic** : Le serveur télécharge le paquet, effectue une sauvegarde complète, met à jour les fichiers et redémarre sans perte de configuration.

### 🎙️ Transcription vocale IA & Synthèse (ASR / TTS)
* **Groq Cloud IA & Piper TTS local** :
  - Transcription ultra-rapide via l'API Groq Cloud (Whisper-large-v3) aux côtés de Google Gemini.
  - Moteurs de traduction : prise en charge de Groq (Llama 3.3 70B) et Google Gemini avec option de désactivation (« Résultat sans traduction »).
  - Synthèse vocale (TTS) : intégration de Groq TTS (Orpheus) en complément du moteur local offline Piper TTS.
  - Combinaison par défaut pour les nouveaux comptes : Groq (reconnaissance) / Groq (traduction) / Piper TTS voix Terra.
* **Réinitialisation automatique lors de la déconnexion** : En cas de coupure de liaison ou de réseau, les boutons TXT et voix repassent automatiquement à l'état DÉSACTIVÉ.
* **Menu rapide « TXT » épuré** : Menu contextuel accessible directement sur le bouton « TXT » pour permuter moteurs et modèles ; champs de saisie des clés API conservés uniquement dans les paramètres généraux.
* **Translittération intelligente** : Adaptation phonétique automatique pour Piper TTS des termes en caractères latins tout en préservant les indicatifs et les journaux bruts.
* **Curseur de vitesse vocale** : Réglage rapide de la vitesse de restitution (`tts_speed`) avec sauvegarde instantanée et synchronisation de l'atténuation audio (ducking).

### 🔊 Traitement audio & Routage des slots (TS1 / TS2)
* **Sélecteur de mode de créneau à 3 positions** :
  - **TS1/2 Solo 🔊** : Seul le créneau temporel sélectionné est diffusé (états muets opposés).
  - **TS1/2 Doubl 🔊** : Écoute simultanée des deux créneaux dans n'importe quelle configuration.
  - **TS1/2 Auto 🔊** : Basculement automatique sur le créneau actif avec retour en veille après 2 secondes de silence.
* **Persistance par Hotspot** : Le mode de diffusion et les boutons de coupure du son sont mémorisés pour chaque hotspot virtuel.
* **Étalonnage des gains audio** : Niveau sonore équilibré entre le flux direct et le lecteur d'enregistrements QSO (-9 dB d'atténuation) ; renommé « Gain général sortie BF ».

### 📺 Affichage VFO, métriques réseau et finitions visuelles
* **Mémoire VFO intelligente** : Après 30 secondes d'inactivité, l'écran conserve les données du dernier correspondant (indicatif, nom, pays, ville) en gris estompé à la place du message « En attente d'appel ».
* **Géolocalisation enrichie** : Affichage du drapeau, du pays et de la ville sur les groupes de discussion radioamateurs.
* **Palette colorée du Ping** : Vert (<100 ms), jaune (100–170 ms), rouge moyen (170–250 ms) et rouge vif (>250 ms).
* **Impulsion lumineuse de validation** : Halo vert sur le pourtour de la modale (`modal-save-pulse`) lors de l'enregistrement des paramètres, suivi de la fermeture automatique.

### 🛡️ DMR, PTT et fiabilité opérationnelle
* **Sécurité PTT** : Blocage de l'émission accidentelle en cas de perte de liaison avec la passerelle ou le serveur BrandMeister.
* **Maintien du Roger Beep** : Prolongation de la transmission de la durée du Roger Beep + 1 seconde de sécurité avant le relâchement du PTT.
* **Réorganisation des hotspots** : Réagencement simplifié de la séquence des hotspots secondaires.
* **Sauvegarde intégrale** : Exportation et importation complètes des réglages avec séparation des privilèges superadministrateur et utilisateurs.

---

<!-- lang:it -->
# ProxDMR v1.41 — Registro delle modifiche e novità

Aggiornamento completo del sistema degli ultimi 3 giorni: nuovo sistema di aggiornamento automatico integrato, motori IA modulari su cloud per trascrizione e traduzione Groq Cloud, sintesi vocale locale Piper TTS con voce Terra per impostazione predefinita, ripristino automatico di trascrizione e sintesi in caso di disconnessione, gestione intelligente dei timeslot TS1/TS2 (Solo, Doubl, Auto), display VFO con memoria standby ed ergonomia perfezionata.

### 🚀 Sistema di aggiornamento ProxDMR
* **Controllo automatico da GitHub**: Scansione in background del repository ufficiale per rilevare nuove versioni e tag.
* **Pannello a scomparsa nelle impostazioni**: Nuova sezione «Aggiornamento ProxDMR» nelle impostazioni generali con stato della versione, verifica manuale e installazione con un clic.
* **Gestione globale delle notifiche**: Nuova opzione «Non notificare aggiornamenti» (disattiva i banner mantenendo attiva l'indicazione nelle impostazioni).
* **Banner discreto ogni 24 ore**: Mostrato al massimo una volta al giorno con possibilità di silenziare fino alla versione successiva.
* **Changelog interattivo**: Finestra modale a schermo intero per smartphone e PC con selezione automatica della lingua tra le 7 supportate.
* **Aggiornamento sicuro con 1 clic**: Il server scarica il pacchetto, esegue un backup completo, aggiorna i file e riavvia il servizio preservando tutte le configurazioni.

### 🎙️ Trascrizione vocale IA e Sintesi (ASR / TTS)
* **Motori IA Groq Cloud e Piper TTS locale**:
  - Trascrizione ad altissima velocità tramite Groq Cloud API (Whisper-large-v3) affiancata a Google Gemini.
  - Motori di traduzione: supporto per Groq (Llama 3.3 70B) e Google Gemini con opzione per disattivare la traduzione («Risultato senza traduzione»).
  - Sintesi vocale (TTS): integrazione di Groq TTS (Orpheus) insieme al motore locale offline Piper TTS.
  - Combinazione predefinita per i nuovi account: Groq (riconoscimento) / Groq (traduzione) / Piper TTS voce Terra.
* **Ripristino automatico alla disconnessione**: In caso di perdita di connessione al server o alla rete, i pulsanti TXT e sintesi vocale tornano automaticamente su SPENTO.
* **Menu rapido «TXT» pulito**: Finestra popup accessibile direttamente dal pulsante «TXT» per cambiare motori e modelli; i campi per le chiavi API rimangono custoditi solo nelle Impostazioni Generali.
* **Traslitterazione intelligente**: Conversione fonetica automatica per Piper TTS dei termini latini preservando nominativi radio (Callsign) e testo originale nei registri.
* **Regolatore di velocità vocale**: Controllo rapido della velocità di riproduzione (`tts_speed`) con salvataggio immediato e dissolvenza audio sincronizzata (ducking).

### 🔊 Pipeline audio e instradamento timeslot (TS1 / TS2)
* **Selettore a 3 vie per i timeslot**:
  - **TS1/2 Solo 🔊**: È attivo solo il timeslot selezionato (stati di muto alternati).
  - **TS1/2 Doubl 🔊**: Riproduzione simultanea di entrambi i timeslot in qualsiasi configurazione di muto.
  - **TS1/2 Auto 🔊**: Passaggio automatico dell'audio al timeslot attivo con ritorno in standby dopo 2 secondi di silenzio.
* **Persistenza per Hotspot**: Modalità di ascolto e pulsanti di muto memorizzati individualmente per ciascun hotspot virtuale.
* **Calibrazione dei livelli audio**: Volume uniformato tra diretta radio e riproduttore registrazioni QSO (-9 dB di attenuazione); rinominato in «Guadagno generale uscita BF».

### 📺 Display VFO, telemetria di rete e rifiniture grafiche
* **Memoria standby intelligente del VFO**: Dopo 30 secondi di inattività, il display conserva i dati dell'ultimo corrispondente (nominativo, nome, paese, città) in grigio sfumato anziché mostrare la scritta generica «In attesa di chiamata».
* **Geolocalizzazione avanzata**: Visualizzazione di bandiera, nazione e città per i gruppi di conversazione radioamatoriali.
* **Scala colori del Ping**: Verde (<100 ms), giallo (100–170 ms), rosso medio (170–250 ms) e rosso intenso (>250 ms).
* **Impulso verde di conferma salvataggio**: Bagliore verde sul contorno della finestra (`modal-save-pulse`) al salvataggio delle impostazioni, con chiusura automatica regolare.

### 🛡️ DMR, PTT e affidabilità
* **Protezione PTT**: Inibizione della trasmissione in caso di assenza di connessione con il Gateway o con il master BrandMeister.
* **Mantenimento Roger Beep**: Prolungamento della trasmissione per tutta la durata del Roger Beep più 1 secondo di margine prima del rilascio del PTT.
* **Gestione ordine hotspot**: Riordino intuitivo degli hotspot virtuali secondari.
* **Backup completo**: Esportazione e importazione affidabile di tutti i parametri operativi con separazione dei ruoli tra superadmin e utenti normali.
