<!-- lang:en -->
# ProxDMR v2.21

## What's New

- **Supertonic 3 Local ONNX TTS Engine:** Added a new fully offline multilingual neural speech synthesis engine (`supertonic_service.py`) supporting 31 languages at 44.1 kHz WAV with 10 selectable voice styles (`F1`-`F5`, `M1`-`M5`), on-demand download of the ONNX core (~380 MB) and lightweight voice profiles (~0.3 MB) into persistent `config/supertonic3/`, automatic readiness checks, and fallback prompts for unsupported languages.
- **Automatic Stress & Homograph Disambiguation (Silero Stress):** Integrated `silero-stress` (`stress_service.py`) for automatic Unicode stress placement (`U+0301`) across Russian, Ukrainian, Belarusian (neural accentors), and 8 additional Cyrillic languages — active for both Supertonic 3 TTS and Piper TTS (with a dedicated toggle in Transcriber Settings and Quick Settings).
- **Smooth Audio Mute Fade & Upgraded AudioWorklet Engine:** Added configurable smooth fade-in/fade-out (`0.1`-`2.0 s`, default `0.3 s`, toggleable in General Settings) for global, per-hotspot, single-hotspot, and per-slot mute/unmute. Muted slots stay warm in the AudioWorklet ring buffer for click-free transitions and timeslot switching without double-fading archive recordings.
- **Virtualized Call History Log:** Rebuilt the QSO call history table with pixel-exact virtual scrolling (`O(1)` DOM rendering), a single delegated click handler, anchor-preserving live updates, removal of the 24-hour cutoff, and zero background DOM overhead when the History panel is closed — smoothly handling tens of thousands of entries.
- **Real-Time Server CPU & RAM Indicator:** Added a live server CPU load and RAM utilization badge in the top header with threshold coloring (`<=75%` green, `76-90%` yellow, `91%+` red) and a detailed breakdown toast on click.
- **UI, UX & Localization Polish:** Refined Dedicated Channel workflow and labels, added a TTS model list refresh action, smoothed About credits scrolling, improved `pxi-select` / `marquee` behavior, and updated all 8 UI locales (`en`, `ru`, `uk`, `de`, `es`, `fr`, `it`, `nl`).

## Upgrade Note

- **Upgrading from v2.20 or earlier:** Because v2.21 adds new Python dependencies (`supertonic>=1.3.1`, `silero-stress>=1.5`), pull the updated Docker image (`docker compose pull && docker compose up -d`) or rebuild your container (`docker compose up -d --build`) to enable Supertonic 3 TTS and Silero Stress.
- **Android APK:** Remains at **v1.36** (`ProxDMR-1.36.apk`).

<!-- lang:ru -->
# ProxDMR v2.21

## Что нового

- **Локальный ONNX-движок Supertonic 3 TTS:** добавлен полностью офлайн многоязычный нейронный синтез речи (`supertonic_service.py`) с поддержкой 31 языка (44.1 кГц WAV) и 10 стилей голосов (`F1`-`F5`, `M1`-`M5`), загрузкой ONNX-ядра (~380 МБ) и лёгких голосовых стилей (~0.3 МБ) по запросу в постоянную папку `config/supertonic3/`, проверкой готовности и подсказками переключения для неподдерживаемых языков.
- **Автоматическая расстановка ударений и омографов (Silero Stress):** интегрирован модуль `silero-stress` (`stress_service.py`) с простановкой ударений Unicode (`U+0301`) для русского, украинского, белорусского (нейронные модели) и ещё 8 языков — работает как для Supertonic 3 TTS, так и для Piper TTS (с отдельным переключателем в настройках транскрибатора и быстром меню).
- **Плавное затухание звука при Mute и обновлённый AudioWorklet:** добавлено настраиваемое плавное затухание и нарастание звука (`0.1`-`2.0 с`, по умолчанию `0.3 с`, включается в Общих настройках) для глобального Mute, отдельных хотспотов, режима одного хотспота и таймслотов. Приглушённые слоты остаются активными в кольцевом буфере AudioWorklet для переключений без щелчков и без двойного затухания при воспроизведении записей.
- **Виртуализация журнала истории вызовов:** таблица истории QSO переведена на виртуальный скроллинг (`O(1)` по узлам DOM) с единым делегированным обработчиком кликов, сохранением позиции при поступлении новых вызовов, снятием суточного ограничения и нулевой нагрузкой на DOM при закрытой панели истории — десятки тысяч записей работают мгновенно.
- **Индикатор CPU и RAM сервера в шапке:** добавлен живой индикатор загрузки процессора и памяти сервера в верхней панели с цветовой индикацией (`<=75%` зелёный, `76-90%` жёлтый, `91%+` красный) и подробной сводкой по нажатию.
- **Улучшения интерфейса и локализаций:** уточнена терминология «Выделенный канал», добавлена кнопка обновления списка моделей TTS, плавная прокрутка титров «О программе», доработки `pxi-select` / `marquee` и синхронный перевод всех 8 языков интерфейса (`ru`, `en`, `uk`, `de`, `es`, `fr`, `it`, `nl`).

## Важно при обновлении

- **Обновление с v2.20 и ниже:** в v2.21 добавлены новые Python-зависимости (`supertonic>=1.3.1`, `silero-stress>=1.5`), поэтому для работы Supertonic 3 TTS и Silero Stress обновите Docker-образ (`docker compose pull && docker compose up -d`) или пересоберите контейнер (`docker compose up -d --build`).
- **Android APK:** актуальная версия остаётся **v1.36** (`ProxDMR-1.36.apk`).

<!-- lang:uk -->
# ProxDMR v2.21

## Що нового

- **Локальний ONNX-рушій Supertonic 3 TTS:** додано повністю офлайн багатомовний нейронний синтез мовлення (`supertonic_service.py`) із підтримкою 31 мови (44.1 кГц WAV) і 10 стилів голосів (`F1`-`F5`, `M1`-`M5`), завантаженням ONNX-ядра (~380 МБ) та стилів (~0.3 МБ) за запитом у `config/supertonic3/`, перевіркою готовності та підказками для непідтримуваних мов.
- **Автоматична розстановка наголосів та омографів (Silero Stress):** інтегровано `silero-stress` (`stress_service.py`) із наголосами Unicode (`U+0301`) для української, російської, білоруської (нейронні моделі) та ще 8 мов — працює для Supertonic 3 TTS і Piper TTS (з окремим перемикачем у налаштуваннях транскрибатора та швидкому меню).
- **Плавне затухання звуку при Mute та оновлений AudioWorklet:** додано налаштовуване плавне затухання/наростання (`0.1`-`2.0 с`, за замовчуванням `0.3 с`) для глобального Mute, окремих хотспотів, режиму одного хотспота та таймслотів без клацань і без подвійного затухання записів.
- **Віртуалізація журналу історії викликів:** перероблено таблицю QSO з піксельно точним віртуальним скролінгом (`O(1)` DOM), знято 24-годинне обмеження та прибрано фонове навантаження DOM при закритій панелі історії.
- **Індикатор CPU та RAM сервера у шапці:** відображення завантаження CPU і RAM у реальному часі з колірними порогами (`<=75%`, `76-90%`, `91%+`) та детальною підказкою при натисканні.
- **Покращення інтерфейсу та локалізацій:** оновлено термінологію «Виділений канал», додано кнопку оновлення списку моделей TTS, плавну прокрутку вікна «Про програму», правки `pxi-select` / `marquee` та повний переклад усіх 8 мов інтерфейсу.

## Важливо при оновленні

- **Оновлення з v2.20 або старішої:** v2.21 додає нові Python-залежності (`supertonic>=1.3.1`, `silero-stress>=1.5`), тому оновіть Docker-образ (`docker compose pull && docker compose up -d`) або перезберіть контейнер (`docker compose up -d --build`).
- **Android APK:** актуальна версія залишається **v1.36** (`ProxDMR-1.36.apk`).

<!-- lang:de -->
# ProxDMR v2.21

## Neuheiten

- **Lokale ONNX-TTS-Engine Supertonic 3:** Neue vollständig offline arbeitende mehrsprachige neuronale Sprachsynthese (`supertonic_service.py`) für 31 Sprachen (44,1 kHz WAV) mit 10 Stimmen (`F1`-`F5`, `M1`-`M5`), On-Demand-Download des ONNX-Kerns (~380 MB) und leichter Stimmprofile (~0,3 MB) in `config/supertonic3/` sowie automatischen Bereitschaftsprüfungen.
- **Automatische Betonung & Homographen-Auflösung (Silero Stress):** Integration von `silero-stress` (`stress_service.py`) mit automatischer Unicode-Betonung (`U+0301`) für Russisch, Ukrainisch, Belarussisch (neuronale Modelle) und 8 weitere Sprachen — aktiv für Supertonic 3 TTS und Piper TTS (mit eigenem Schalter in den Einstellungen).
- **Sanftes Audio-Mute-Fade & verbesserte AudioWorklet-Engine:** Konfigurierbares sanftes Ein-/Ausblenden (`0,1`-`2,0 s`, Standard `0,3 s`) für globales Mute, einzelne Hotspots, Einzel-Hotspot-Modus und Zeitschlitze — knackfreie Übergänge ohne doppeltes Fading bei Aufnahmen.
- **Virtualisierte Rufhistorie:** Neu entwickelte QSO-Verlaufstabelle mit Virtual Scrolling (`O(1)` DOM), ohne 24-Stunden-Grenze und ohne DOM-Last bei geschlossenem Verlaufsfenster — verarbeitet flüssig zehntausende Einträge.
- **Echtzeit-CPU- & RAM-Anzeige im Header:** Live-Indikator für Server-CPU- und RAM-Auslastung mit Farbschwellen (`<=75%` grün, `76-90%` gelb, `91%+` rot) und Detail-Toast beim Klick.
- **UI-, UX- & Lokalisierungs-Feinschliff:** Verfeinerte Benennung für dedizierte Kanäle, Schaltfläche zum Aktualisieren der TTS-Modellliste, ruhigerer Abspann im Info-Dialog, `pxi-select`/`marquee`-Verbesserungen und aktualisierte Übersetzungen in allen 8 Sprachen.

## Update-Hinweis

- **Upgrade von v2.20 oder älter:** v2.21 fügt neue Python-Abhängigkeiten hinzu (`supertonic>=1.3.1`, `silero-stress>=1.5`). Bitte das Docker-Image aktualisieren (`docker compose pull && docker compose up -d`) oder neu bauen (`docker compose up -d --build`).
- **Android APK:** Bleibt bei **v1.36** (`ProxDMR-1.36.apk`).

<!-- lang:es -->
# ProxDMR v2.21

## Novedades

- **Motor TTS local ONNX Supertonic 3:** Nuevo motor neuronal multilingüe totalmente offline (`supertonic_service.py`) compatible con 31 idiomas en WAV a 44,1 kHz y 10 estilos de voz (`F1`-`F5`, `M1`-`M5`), descarga bajo demanda del núcleo ONNX (~380 MB) y perfiles de voz (~0,3 MB) en `config/supertonic3/`, comprobaciones de disponibilidad y aviso de cambio para idiomas no compatibles.
- **Acentuación automática y desambiguación de homógrafos (Silero Stress):** Integración de `silero-stress` (`stress_service.py`) con acentuación Unicode (`U+0301`) para ruso, ucraniano, bielorruso (modelos neuronales) y 8 idiomas adicionales, compatible tanto con Supertonic 3 TTS como con Piper TTS (con interruptor dedicado).
- **Fundido suave de silencio (Mute Fade) y motor AudioWorklet mejorado:** Fundido de entrada/salida configurable (`0,1`-`2,0 s`, por defecto `0,3 s`) para silencio global, por hotspot, modo de hotspot único y por timeslot, evitando chasquidos y doble atenuación en grabaciones.
- **Historial de llamadas virtualizado:** Tabla de historial QSO reconstruida con desplazamiento virtual (`O(1)` DOM), sin límite de 24 horas y con coste nulo en segundo plano cuando el panel está cerrado, manejando decenas de miles de registros con fluidez.
- **Indicador de CPU y RAM del servidor en la cabecera:** Insignia en tiempo real con umbrales de color (`<=75%` verde, `76-90%` amarillo, `91%+` rojo) y resumen detallado al pulsar.
- **Mejoras de interfaz y traducciones:** Flujo y etiquetas refinados para Canal Dedicado, botón de actualización de modelos TTS, desplazamiento más suave en Acerca de, mejoras en `pxi-select` / `marquee` y actualización completa en los 8 idiomas de la interfaz.

## Nota de actualización

- **Actualización desde v2.20 o anterior:** v2.21 añade nuevas dependencias de Python (`supertonic>=1.3.1`, `silero-stress>=1.5`). Actualice la imagen Docker (`docker compose pull && docker compose up -d`) o reconstruya el contenedor (`docker compose up -d --build`).
- **Android APK:** Se mantiene en **v1.36** (`ProxDMR-1.36.apk`).

<!-- lang:fr -->
# ProxDMR v2.21

## Nouveautés

- **Moteur TTS local ONNX Supertonic 3 :** Ajout d'un moteur neuronal multilingue 100 % hors ligne (`supertonic_service.py`) prenant en charge 31 langues en WAV 44,1 kHz avec 10 styles de voix (`F1`-`F5`, `M1`-`M5`), téléchargement à la demande du noyau ONNX (~380 Mo) et des styles (~0,3 Mo) dans `config/supertonic3/`, vérification de disponibilité et bascule guidée pour les langues non prises en charge.
- **Accentuation automatique et désambiguïsation des homographes (Silero Stress) :** Intégration de `silero-stress` (`stress_service.py`) avec accentuation Unicode (`U+0301`) pour le russe, l'ukrainien, le biélorusse (modèles neuronaux) et 8 autres langues — actif pour Supertonic 3 TTS et Piper TTS (avec option dédiée).
- **Fondu sonore progressif (Mute Fade) et moteur AudioWorklet amélioré :** Fondu configurable (`0,1`-`2,0 s`, par défaut `0,3 s`) pour le mode muet global, par hotspot, hotspot unique et par timeslot, garantissant des transitions sans clic et sans double atténuation des enregistrements.
- **Historique d'appels virtualisé :** Tableau QSO reconstruit avec défilement virtuel (`O(1)` DOM), suppression de la limite de 24 h et coût DOM nul lorsque le panneau est fermé — gère aisément des dizaines de milliers d'entrées.
- **Indicateur CPU et RAM du serveur en temps réel :** Badge dans l'en-tête avec seuils de couleur (`<=75%` vert, `76-90%` jaune, `91%+` rouge) et notification détaillée au clic.
- **Finitions UI, UX et traductions :** Terminologie affinée pour le canal dédié, bouton d'actualisation des modèles TTS, défilement plus fluide dans À propos, améliorations `pxi-select` / `marquee` et mise à jour complète des 8 langues d'interface.

## Note de mise à jour

- **Mise à jour depuis v2.20 ou antérieure :** v2.21 ajoute de nouvelles dépendances Python (`supertonic>=1.3.1`, `silero-stress>=1.5`). Mettez à jour l'image Docker (`docker compose pull && docker compose up -d`) ou reconstruisez le conteneur (`docker compose up -d --build`).
- **APK Android :** Reste en **v1.36** (`ProxDMR-1.36.apk`).

<!-- lang:it -->
# ProxDMR v2.21

## Novità

- **Motore TTS locale ONNX Supertonic 3:** Nuovo motore neurale multilingua completamente offline (`supertonic_service.py`) per 31 lingue in WAV a 44,1 kHz con 10 stili vocali (`F1`-`F5`, `M1`-`M5`), download su richiesta del core ONNX (~380 MB) e dei profili vocali (~0,3 MB) in `config/supertonic3/`, controlli automatici di disponibilità e suggerimenti di fallback.
- **Accentuazione automatica e disambiguazione omografi (Silero Stress):** Integrazione di `silero-stress` (`stress_service.py`) con accenti Unicode (`U+0301`) per russo, ucraino, bielorusso (modelli neurali) e altre 8 lingue — attivo sia per Supertonic 3 TTS che per Piper TTS (con interruttore dedicato).
- **Dissolvenza audio Mute (Mute Fade) e motore AudioWorklet aggiornato:** Dissolvenza in ingresso/uscita configurabile (`0,1`-`2,0 s`, predefinito `0,3 s`) per mute globale, per hotspot, modalità singolo hotspot e timeslot, eliminando clic e doppie dissolvenze nelle registrazioni.
- **Cronologia chiamate virtualizzata:** Tabella QSO ricostruita con scorrimento virtuale (`O(1)` DOM), rimozione del limite di 24 ore e carico DOM nullo a pannello chiuso — gestisce fluidamente decine di migliaia di voci.
- **Indicatore CPU e RAM del server nell'intestazione:** Badge in tempo reale con soglie cromatiche (`<=75%` verde, `76-90%` giallo, `91%+` rosso) e riepilogo dettagliato al clic.
- **Rifiniture UI, UX e localizzazione:** Flusso e testi perfezionati per Canale Dedicato, pulsante di aggiornamento modelli TTS, scorrimento crediti più fluido in Informazioni, miglioramenti `pxi-select` / `marquee` e traduzioni aggiornate in tutte le 8 lingue.

## Nota di aggiornamento

- **Aggiornamento da v2.20 o precedente:** v2.21 aggiunge nuove dipendenze Python (`supertonic>=1.3.1`, `silero-stress>=1.5`). Aggiorna l'immagine Docker (`docker compose pull && docker compose up -d`) o ricostruisci il container (`docker compose up -d --build`).
- **APK Android:** Rimane alla **v1.36** (`ProxDMR-1.36.apk`).

<!-- lang:nl -->
# ProxDMR v2.21

## Nieuw in deze versie

- **Lokale ONNX-TTS-engine Supertonic 3:** Nieuwe volledig offline meertalige neurale spraaksynthese (`supertonic_service.py`) voor 31 talen in 44,1 kHz WAV met 10 stemstijlen (`F1`-`F5`, `M1`-`M5`), on-demand download van de ONNX-kern (~380 MB) en stemprofielen (~0,3 MB) in `config/supertonic3/`, automatische gereedheidscontroles en fallback-meldingen.
- **Automatische klemtoon & homograaf-onderscheid (Silero Stress):** Integratie van `silero-stress` (`stress_service.py`) met Unicode-klemtonen (`U+0301`) voor Russisch, Oekraïens, Wit-Russisch (neurale modellen) en 8 extra talen — actief voor zowel Supertonic 3 TTS als Piper TTS (met eigen schakelaar).
- **Vloeiende audio-mute-fade & vernieuwde AudioWorklet-engine:** Instelbare vloeiende fade-in/fade-out (`0,1`-`2,0 s`, standaard `0,3 s`) voor globale mute, per hotspot, enkele-hotspot-modus en timeslots zonder klikken of dubbele fade op opnames.
- **Gevirtualiseerde oproepgeschiedenis:** Vernieuwde QSO-tabel met virtual scrolling (`O(1)` DOM), zonder 24-uurslimiet en zonder DOM-belasting wanneer het paneel gesloten is — verwerkt moeiteloos tienduizenden rijen.
- **Realtime server-CPU- & RAM-indicator in de header:** Live-badge met kleurdrempels (`<=75%` groen, `76-90%` geel, `91%+` rood) en uitgebreid overzicht bij klikken.
- **UI-, UX- & vertaalverbeteringen:** Verfijnde benaming voor Toegewezen kanaal, knop om TTS-modellen te verversen, rustiger scrollen in Over, verbeteringen in `pxi-select` / `marquee` en bijgewerkte vertalingen voor alle 8 talen.

## Upgrademelding

- **Upgraden vanaf v2.20 of ouder:** v2.21 voegt nieuwe Python-afhankelijkheden toe (`supertonic>=1.3.1`, `silero-stress>=1.5`). Werk het Docker-image bij (`docker compose pull && docker compose up -d`) of bouw de container opnieuw (`docker compose up -d --build`).
- **Android APK:** Blijft op **v1.36** (`ProxDMR-1.36.apk`).
