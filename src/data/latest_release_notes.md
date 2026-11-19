<!-- lang:en -->
# ProxDMR v2.17.1b — Release Notes

List of Changes

1. Support for Yaesu System Fusion (YSF / C4FM). A full-featured network client for YSF repeaters, a global room directory with background online monitoring, support for FCS/YCS multi-room hubs, and DG-ID selector control.

2. Integration with the Amateur Digital Network (ADN). An ADN server network module with a built-in TG directory.

3. Interface changes: Creation of a universal hotspot manager toolbar with a comprehensive system for switching between hotspots, enabling/disabling them, changing their status, etc.

4. Implementation of a local echo repeater with audio passing entirely through the encoder-decoder for a comprehensive assessment of the quality, spectrum, and signal level of one's microphone. Modification and optimization of audio processing for transmission (microphone, DSP, codec).

5. Complete isolation of contact lists across networks. Each digital network (BM, TGIF, FreeDMR, DMR+, XLX, ADN, YSF, ASL) has its own isolated address book while maintaining cross-network call sign search.

6. Speech deduplication in TTS and independent HAM settings: An algorithm for suppressing cyclic phrase repetitions in the transcriber and speech synthesizer.

7. Updated user interface and localization into 8 languages

8. New feature: playing recorded audio clips to on air.

9. Update to mbelib-neo (ambe+2 decoder/encoder)

10. Fixes in the Android APK client—a modification related to configuring and using the smartphone's hardware button as a PTT.

11. A host of minor conflicts, bugs, unclear program behaviors, etc.

I also ask everyone who uses this program to be understanding regarding any bugs and unstable program features; I'm just a hobbyist coder with limited programming experience, and this is a completely amateur project. In any case, if you'd like, feel free to email me at the address listed in the "About" section of the program.

<!-- lang:ru -->
# ProxDMR v2.17.1b — Список изменений

Список изменений

1. Поддержка Yaesu System Fusion (YSF / C4FM). Полнофункциональный сетевой клиент для репитеров и рефлекторов YSF, глобальный каталог комнат с фоновым мониторингом онлайна, поддержка мультикомнатных хабов FCS/YCS и управление селектором DG-ID.

2. Интеграция с Amateur Digital Network (ADN). Модуль сети серверов ADN со встроенным справочником разговорных групп (TG).

3. Изменения интерфейса: создан универсальный тулбар управления хотспотами с комплексной системой переключения между хотспотами, их включения/выключения, смены статуса и др.

4. Реализация локального эхо-репитера («Попугай») с полным прохождением звука через кодер-декодер для комплексной оценки качества, спектра и уровня сигнала собственного микрофона. Модификация и оптимизация обработки звука при передаче (микрофон, DSP, кодек).

5. Полная изоляция списков контактов по сетям. Каждая цифровая сеть (BM, TGIF, FreeDMR, DMR+, XLX, ADN, YSF, ASL) имеет собственную изолированную адресную книгу с сохранением сквозного поиска по позывным между сетями.

6. Дедупликация речи в TTS и независимые настройки HAM: алгоритм подавления циклических повторений фраз в транскрибере и синтезаторе речи.

7. Обновлённый пользовательский интерфейс и локализация на 8 языков.

8. Новая функция: воспроизведение записанных аудиоклипов в эфир.

9. Обновление mbelib-neo (декодер/кодер AMBE+2).

10. Исправления в Android APK-клиенте — доработка настройки и использования аппаратной кнопки смартфона в качестве PTT.

11. Множество мелких исправлений конфликтов, багов, неясного поведения программы и прочих улучшений.

Также прошу всех пользователей программы с пониманием относиться к возможным ошибкам и нестабильной работе отдельных функций — я всего лишь программист-любитель с небольшим опытом, и это полностью любительский проект. В любом случае, при желании вы всегда можете написать мне на электронную почту, указанную в разделе «О программе».

<!-- lang:uk -->
# ProxDMR v2.17.1b — Список змін

Список змін

1. Підтримка Yaesu System Fusion (YSF / C4FM). Повнофункціональний мережевий клієнт для репітерів та рефлекторів YSF, глобальний каталог кімнат із фоновим моніторингом онлайну, підтримка мультикімнатних хабів FCS/YCS і керування селектором DG-ID.

2. Інтеграція з Amateur Digital Network (ADN). Мережевий модуль серверів ADN із вбудованим довідником розмовних груп (TG).

3. Зміни інтерфейсу: створено універсальний тулбар керування хотспотами з комплексною системою перемикання між хотспотами, їх увімкнення/вимкнення, зміни статусу тощо.

4. Реалізація локального ехо-репітера («Папуга») із повним проходженням звуку через кодер-декодер для комплексної оцінки якості, спектра та рівня сигналу власного мікрофона. Модифікація та оптимізація обробки звуку під час передачі (мікрофон, DSP, кодек).

5. Повна ізоляція списків контактів між мережами. Кожна цифрова мережа (BM, TGIF, FreeDMR, DMR+, XLX, ADN, YSF, ASL) має власну ізольовану адресну книгу зі збереженням наскрізного пошуку за позивними між мережами.

6. Дедуплікація мовлення в TTS та незалежні налаштування HAM: алгоритм придушення циклічних повторів фраз у транскрибері та синтезаторі мовлення.

7. Оновлений інтерфейс користувача та локалізація 8 мовами.

8. Нова функція: відтворення записаних аудіокліпів в ефір.

9. Оновлення mbelib-neo (декодер/кодер AMBE+2).

10. Виправлення в Android APK-клієнті — доопрацювання налаштування та використання апаратної кнопки смартфона як PTT.

11. Багато дрібних виправлень конфліктів, помилок, незрозумілої поведінки програми тощо.

Також прошу всіх користувачів програми із розумінням ставитися до можливих помилок і нестабільної роботи окремих функцій; я лише програміст-аматор із невеликим досвідом, і це повністю аматорський проєкт. У будь-якому разі, за бажання, можете написати мені на електронну пошту, зазначену в розділі «Про програму».

<!-- lang:de -->
# ProxDMR v2.17.1b — Änderungsprotokoll

Liste der Änderungen

1. Unterstützung für Yaesu System Fusion (YSF / C4FM). Ein vollwertiger Netzwerk-Client für YSF-Repeater, ein globales Raumverzeichnis mit Hintergrund-Online-Monitoring, Unterstützung für FCS/YCS-Multiraum-Hubs und DG-ID-Auswahlsteuerung.

2. Integration mit dem Amateur Digital Network (ADN). Ein ADN-Server-Netzwerkmodul mit integriertem TG-Verzeichnis.

3. Änderungen der Benutzeroberfläche: Erstellung einer universellen Hotspot-Manager-Symbolleiste mit umfassendem System zum Wechseln zwischen Hotspots, Aktivieren/Deaktivieren, Statusänderung usw.

4. Implementierung eines lokalen Echo-Repeaters, bei dem das Audio vollständig durch den Encoder-Decoder läuft, um Qualität, Spektrum und Signalpegel des eigenen Mikrofons umfassend zu beurteilen. Anpassung und Optimierung der Audioverarbeitung für das Senden (Mikrofon, DSP, Codec).

5. Vollständige Isolierung der Kontaktlisten nach Netzwerken. Jedes digitale Netzwerk (BM, TGIF, FreeDMR, DMR+, XLX, ADN, YSF, ASL) besitzt sein eigenes isoliertes Adressbuch bei gleichzeitiger netzwerkübergreifender Rufzeichensuche.

6. Sprachdeduplizierung im TTS und unabhängige HAM-Einstellungen: Ein Algorithmus zur Unterdrückung zyklischer Phrasenwiederholungen im Transkriptor und Sprachsynthesizer.

7. Aktualisierte Benutzeroberfläche und Lokalisierung in 8 Sprachen.

8. Neue Funktion: Wiedergabe aufgenommener Audioclips auf Sendung (On Air).

9. Aktualisierung auf mbelib-neo (AMBE+2 Decoder/Encoder).

10. Korrekturen im Android-APK-Client — Anpassung zur Konfiguration und Nutzung der Hardware-Taste des Smartphones als PTT.

11. Zahlreiche kleinere Behebungen von Konflikten, Fehlern und unklarem Programmverhalten.

Ich bitte außerdem alle Nutzer dieses Programms um Verständnis für eventuelle Fehler und instabile Funktionen; ich bin nur ein Hobbyprogrammierer mit begrenzter Erfahrung, und dies ist ein reines Amateurprojekt. Bei Interesse können Sie mir gerne an die im Abschnitt „Über das Programm“ angegebene E-Mail-Adresse schreiben.

<!-- lang:es -->
# ProxDMR v2.17.1b — Registro de cambios

Lista de cambios

1. Soporte para Yaesu System Fusion (YSF / C4FM). Cliente de red completo para repetidores YSF, directorio global de salas con monitoreo en segundo plano, soporte para concentradores multisala FCS/YCS y control del selector DG-ID.

2. Integración con Amateur Digital Network (ADN). Módulo de red de servidores ADN con directorio de grupos (TG) integrado.

3. Cambios en la interfaz: creación de una barra de herramientas universal para gestionar hotspots con un sistema completo para alternar entre hotspots, activarlos/desactivarlos, cambiar su estado, etc.

4. Implementación de un repetidor de eco local con paso íntegro del audio por el codificador-decodificador para evaluar la calidad, el espectro y el nivel de señal del micrófono. Modificación y optimización del procesamiento de audio en transmisión (micrófono, DSP, códec).

5. Aislamiento completo de las listas de contactos por red. Cada red digital (BM, TGIF, FreeDMR, DMR+, XLX, ADN, YSF, ASL) dispone de su propia agenda aislada manteniendo la búsqueda de indicativos entre redes.

6. Deduplicación de voz en TTS y ajustes HAM independientes: algoritmo para suprimir repeticiones cíclicas de frases en el transcriptor y sintetizador de voz.

7. Interfaz de usuario actualizada y localización en 8 idiomas.

8. Nueva función: reproducción de clips de audio grabados al aire.

9. Actualización de mbelib-neo (decodificador/codificador AMBE+2).

10. Correcciones en el cliente Android APK: modificación para configurar y utilizar el botón físico del teléfono como PTT.

11. Numerosas correcciones menores de conflictos, errores y comportamientos poco claros del programa.

También pido comprensión a quienes utilicen este programa ante posibles errores y funciones inestables; soy solo un programador aficionado con experiencia limitada y este es un proyecto completamente amateur. En cualquier caso, si lo desean, pueden escribirme al correo indicado en la sección «Acerca de».

<!-- lang:fr -->
# ProxDMR v2.17.1b — Notes de version

Liste des modifications

1. Prise en charge de Yaesu System Fusion (YSF / C4FM). Client réseau complet pour répéteurs YSF, annuaire mondial des salons avec surveillance en ligne en arrière-plan, prise en charge des hubs multisalons FCS/YCS et contrôle du sélecteur DG-ID.

2. Intégration d'Amateur Digital Network (ADN). Module réseau pour serveurs ADN avec annuaire TG intégré.

3. Évolutions de l'interface : création d'une barre d'outils universelle de gestion des hotspots offrant basculement entre hotspots, activation/désactivation, changement d'état, etc.

4. Mise en œuvre d'un répéteur d'écho local faisant passer intégralement l'audio par le codeur-décodeur pour évaluer la qualité, le spectre et le niveau du microphone. Modification et optimisation du traitement audio à l'émission (microphone, DSP, codec).

5. Isolation complète des listes de contacts par réseau. Chaque réseau numérique (BM, TGIF, FreeDMR, DMR+, XLX, ADN, YSF, ASL) possède son propre carnet d'adresses isolé tout en conservant la recherche d'indicatifs inter-réseaux.

6. Déduplication vocale dans le TTS et réglages HAM indépendants : algorithme de suppression des répétitions cycliques de phrases dans le transcripteur et le synthétiseur vocal.

7. Interface utilisateur mise à jour et localisation en 8 langues.

8. Nouvelle fonctionnalité : lecture à l'antenne de clips audio enregistrés.

9. Mise à jour vers mbelib-neo (décodeur/encodeur AMBE+2).

10. Correctifs dans le client Android APK — modification liée à la configuration et à l'utilisation du bouton matériel du smartphone comme PTT.

11. Diverses corrections mineures de conflits, bogues et comportements imprécis.

Je demande également à tous les utilisateurs de faire preuve de compréhension face aux éventuels bogues et fonctionnalités instables ; je suis un développeur amateur avec une expérience limitée et ce projet est entièrement bénévole. N'hésitez pas à m'écrire à l'adresse e-mail indiquée dans la section « À propos » du programme.

<!-- lang:it -->
# ProxDMR v2.17.1b — Registro delle modifiche

Elenco delle modifiche

1. Supporto per Yaesu System Fusion (YSF / C4FM). Client di rete completo per ripetitori YSF, directory globale delle stanze con monitoraggio online in background, supporto per hub multistanza FCS/YCS e controllo del selettore DG-ID.

2. Integrazione con Amateur Digital Network (ADN). Modulo di rete per server ADN con directory TG integrata.

3. Modifiche all'interfaccia: creazione di una barra degli strumenti universale per gestire gli hotspot con sistema completo per passare da un hotspot all'altro, attivarli/disattivarli, cambiarne lo stato, ecc.

4. Implementazione di un ripetitore di eco locale con audio che attraversa interamente il codificatore-decodificatore per valutare qualità, spettro e livello del segnale del microfono. Modifica e ottimizzazione dell'elaborazione audio in trasmissione (microfono, DSP, codec).

5. Isolamento completo degli elenchi contatti tra reti. Ogni rete digitale (BM, TGIF, FreeDMR, DMR+, XLX, ADN, YSF, ASL) dispone di una propria rubrica isolata mantenendo la ricerca dei nominativi tra reti.

6. Deduplicazione vocale nel TTS e impostazioni HAM indipendenti: algoritmo per sopprimere ripetizioni cicliche di frasi nel trascrittore e nel sintetizzatore vocale.

7. Interfaccia utente aggiornata e localizzazione in 8 lingue.

8. Nuova funzione: riproduzione in onda di clip audio registrate.

9. Aggiornamento a mbelib-neo (decoder/encoder AMBE+2).

10. Correzioni nel client Android APK — modifica relativa alla configurazione e all'uso del tasto fisico dello smartphone come PTT.

11. Numerose correzioni minori di conflitti, bug e comportamenti poco chiari del programma.

Chiedo inoltre comprensione a chiunque utilizzi questo programma per eventuali bug o funzioni instabili; sono solo un programmatore per hobby con esperienza limitata e questo è un progetto amatoriale. In ogni caso, potete scrivermi all'indirizzo e-mail indicato nella sezione « Informazioni ».

<!-- lang:nl -->
# ProxDMR v2.17.1b — Wijzigingslogboek

Lijst met wijzigingen

1. Ondersteuning voor Yaesu System Fusion (YSF / C4FM). Volwaardige netwerkclient voor YSF-repeaters, wereldwijde roomdirectory met online achtergrondmonitoring, ondersteuning voor FCS/YCS multi-room hubs en DG-ID selectorbediening.

2. Integratie met het Amateur Digital Network (ADN). Een ADN-servernetwerkmodule met ingebouwde TG-directory.

3. Interfacewijzigingen: universele werkbalk voor hotspotbeheer met uitgebreid systeem om tussen hotspots te schakelen, ze in/uit te schakelen, status te wijzigen, enz.

4. Implementatie van een lokale echorepeater waarbij audio volledig door de encoder-decoder gaat voor een uitgebreide beoordeling van de kwaliteit, het spectrum en het signaalniveau van de microfoon. Aanpassing en optimalisatie van audioverwerking voor zenden (microfoon, DSP, codec).

5. Volledige isolatie van contactlijsten per netwerk. Elk digitaal netwerk (BM, TGIF, FreeDMR, DMR+, XLX, ADN, YSF, ASL) heeft een eigen geïsoleerd adresboek met behoud van netwerkoverschrijdend zoeken op roepnaam.

6. Spraakdeduplicatie in TTS en onafhankelijke HAM-instellingen: algoritme voor het onderdrukken van cyclische zins-herhalingen in de transcriber en spraaksynthesizer.

7. Vernieuwde gebruikersinterface en lokalisatie in 8 talen.

8. Nieuwe functie: opgenomen audioclips uitzenden via de ether (On Air).

9. Update naar mbelib-neo (AMBE+2 decoder/encoder).

10. Oplossingen in de Android APK-client — een wijziging voor het configureren en gebruiken van de hardwareknop van de smartphone als PTT.

11. Diverse kleine conflicten, bugs en onduidelijk programmagedrag opgelost.

Ik vraag iedereen die dit programma gebruikt begrip voor eventuele bugs en onstabiele functies; ik ben slechts een hobbyprogrammeerder met beperkte ervaring en dit is een volledig amateurproject. U kunt mij gerust mailen op het adres dat vermeld staat in de sectie "Over" van het programma.
