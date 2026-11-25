<!-- lang:en -->
## Additions and Fixes

- **Semantic optimization (speech smoothing) and QSO context:** An optional mode has been added to correct typical ASR/vocoder errors by taking into account the sliding context of the last 3 slot replies (over 180 seconds). Works for cloud translation, local Qwen (lightweight processing), and "No Translation" mode / language matching.
- **Adaptive playback speed (live broadcast catch-up):** Monitors the playback queue's lag relative to slots, trims silence at the edges of WAV files, and smoothly accelerates speech as the queue builds up while preserving voice tone (WSOLA for Silero/Gemini/Groq and native acceleration for Piper/Supertonic).
- **Dynamic language selection and ASR fallback:** The list of source languages dynamically adapts to the capabilities of the selected translator.
- **Voices by engine and button indicators:** Added separate saving of the selected voice for each TTS engine.
- **Queue and LLM stability:** Valid empty LLM responses when filtering out interjections are no longer considered an API error; pressing PTT or Mute now guarantees that the delayed TTS inter-replica pause timer is canceled.
- **New server hardware load widget in the hotspot header:** Two vertical bar gauges (RAM and CPU) and a line graph showing load history.
- **"What's New" window and release parser:** The "What's New" button is now always visible next to "Check for Updates" and loads release notes from GitHub as needed.
- **Atomic history writing and record isolation:** Saving `calls_history` has been converted to a thread-safe atomic write.
- **Refactoring and tests.**
- **Minor UI tweaks.**

<details>
<summary>Other languages (RU / UK / DE / ES / FR / IT / NL)</summary>

<!-- lang:ru -->
## Новые функции и исправления

- **Семантическая оптимизация (сглаживание речи) и контекст QSO:** добавлен опциональный режим исправления типовых ошибок ASR/вокодера с учётом скользящего контекста последних 3 реплик слота (за 180 секунд). Работает для облачного перевода, локального Qwen (облегчённая обработка) и режима «Без перевода» / совпадения языков.
- **Адаптивная скорость воспроизведения (догон прямого эфира):** отслеживает отставание очереди воспроизведения от слотов, обрезает тишину по краям WAV-файлов и плавно ускоряет речь по мере накопления очереди с сохранением тембра голоса (WSOLA для Silero/Gemini/Groq и нативное ускорение для Piper/Supertonic).
- **Динамический выбор языков и fallback ASR:** список исходных языков динамически подстраивается под возможности выбранного переводчика.
- **Голоса по движкам и индикаторы кнопок:** добавлено раздельное сохранение выбранного голоса для каждого TTS-движка.
- **Стабильность очереди и LLM:** корректные пустые ответы LLM при отсеивании междометий больше не считаются ошибкой API; нажатие PTT или Mute теперь гарантированно отменяет отложенный таймер паузы между репликами TTS.
- **Новый виджет нагрузки сервера в шапке хотспота:** два вертикальных столбиковых индикатора (RAM и CPU) и линейный график истории нагрузки.
- **Окно «Что нового» и парсер релизов:** кнопка «Что нового» теперь всегда отображается рядом с «Проверить обновления» и при необходимости подгружает текст релиза с GitHub.
- **Атомарная запись истории и изоляция записей:** сохранение `calls_history` переведено на потокобезопасную атомарную запись.
- **Рефакторинг и тесты.**
- **Небольшие доработки интерфейса.**

<!-- lang:uk -->
## Нові функції та виправлення

- **Семантична оптимізація (згладжування мовлення) та контекст QSO:** додано опціональний режим виправлення типових помилок ASR/вокодера з урахуванням ковзного контексту останніх 3 реплік слота (за 180 секунд). Працює для хмарного перекладу, локального Qwen (полегшена обробка) та режиму «Без перекладу» / збігу мов.
- **Адаптивна швидкість відтворення (наздоганяння прямого ефіру):** відстежує відставання черги відтворення від слотів, обрізає тишу на краях WAV-файлів і плавно прискорює мовлення в міру накопичення черги зі збереженням тембру голосу (WSOLA для Silero/Gemini/Groq і нативне прискорення для Piper/Supertonic).
- **Динамічний вибір мов і fallback ASR:** список вихідних мов динамічно адаптується до можливостей обраного перекладача.
- **Голоси за рушіями та індикатори кнопок:** додано окреме збереження вибраного голосу для кожного TTS-рушія.
- **Стабільність черги та LLM:** коректні порожні відповіді LLM при відсіюванні вигуків більше не вважаються помилкою API; натискання PTT або Mute тепер гарантовано скасовує відкладений таймер паузи між репліками TTS.
- **Новий віджет навантаження сервера у шапці хотспота:** два вертикальних стовпчикових індикатори (RAM і CPU) та лінійний графік історії навантаження.
- **Вікно «Що нового» та парсер релізів:** кнопка «Що нового» тепер завжди видима поруч із «Перевірити оновлення» і за потреби підвантажує текст із GitHub.
- **Атомарний запис історії та ізоляція записів:** збереження `calls_history` переведено на потокобезпечний атомарний запис.
- **Рефакторинг і тести.**
- **Незначні доопрацювання інтерфейсу.**

<!-- lang:de -->
## Neuerungen und Fehlerbehebungen

- **Semantische Optimierung (Sprachglättung) und QSO-Kontext:** Ein optionaler Modus zur Korrektur typischer ASR-/Vocoder-Fehler anhand des gleitenden Kontexts der letzten 3 Slot-Antworten (über 180 Sekunden) wurde hinzugefügt. Funktioniert für Cloud-Übersetzung, lokales Qwen (schlanke Verarbeitung) sowie den Modus „Keine Übersetzung“ / Sprachübereinstimmung.
- **Adaptive Wiedergabegeschwindigkeit (Live-Aufholmodus):** Überwacht den Rückstand der Wiedergabewarteschlange gegenüber den Slots, entfernt Stille an den Rändern von WAV-Dateien und beschleunigt die Sprache bei wachsender Warteschlange sanft unter Beibehaltung der Stimmfarbe (WSOLA für Silero/Gemini/Groq und native Beschleunigung für Piper/Supertonic).
- **Dynamische Sprachauswahl und ASR-Fallback:** Die Liste der Quellsprachen passt sich dynamisch an die Fähigkeiten des gewählten Übersetzers an.
- **Stimmen pro Engine und Schaltflächenindikatoren:** Getrenntes Speichern der gewählten Stimme für jede TTS-Engine hinzugefügt.
- **Warteschlangen- und LLM-Stabilität:** Gültige leere LLM-Antworten beim Herausfiltern von Fülllauten gelten nicht mehr als API-Fehler; das Drücken von PTT oder Mute bricht nun garantiert den verzögerten TTS-Pausentimer zwischen Antworten ab.
- **Neues Server-Hardware-Last-Widget im Hotspot-Header:** Zwei vertikale Balkenanzeigen (RAM und CPU) sowie ein Liniendiagramm für den Lastverlauf.
- **„Was ist neu“-Fenster und Release-Parser:** Die Schaltfläche „Was ist neu“ ist nun immer neben „Nach Updates suchen“ sichtbar und lädt Release-Notes bei Bedarf direkt von GitHub.
- **Atomares Schreiben der Historie und Datensatz-Isolation:** Das Speichern von `calls_history` wurde auf thread-sicheres atomares Schreiben umgestellt.
- **Refactoring und Tests.**
- **Kleinere UI-Anpassungen.**

<!-- lang:es -->
## Novedades y correcciones

- **Optimización semántica (suavizado del habla) y contexto QSO:** Se añadió un modo opcional para corregir errores típicos de ASR/vocoder teniendo en cuenta el contexto deslizante de las últimas 3 respuestas del slot (durante 180 segundos). Funciona con traducción en la nube, Qwen local (procesamiento ligero) y el modo «Sin traducción» / coincidencia de idioma.
- **Velocidad de reproducción adaptativa (alcance de emisión en directo):** Supervisa el retraso de la cola de reproducción respecto a los slots, recorta el silencio en los extremos de los archivos WAV y acelera suavemente el habla conforme crece la cola preservando el tono de voz (WSOLA para Silero/Gemini/Groq y aceleración nativa para Piper/Supertonic).
- **Selección dinámica de idiomas y respaldo ASR:** La lista de idiomas de origen se adapta dinámicamente a las capacidades del traductor seleccionado.
- **Voces por motor e indicadores de botones:** Se añadió el guardado independiente de la voz seleccionada para cada motor TTS.
- **Estabilidad de la cola y LLM:** Las respuestas vacías válidas del LLM al filtrar interjecciones ya no se consideran un error de API; pulsar PTT o Mute ahora cancela de forma garantizada el temporizador de pausa entre réplicas TTS.
- **Nuevo widget de carga de hardware del servidor en la cabecera del hotspot:** Dos barras verticales (RAM y CPU) y una gráfica de líneas con el historial de carga.
- **Ventana «Novedades» y analizador de versiones:** El botón «Novedades» ahora es siempre visible junto a «Buscar actualizaciones» y carga el texto desde GitHub cuando hace falta.
- **Escritura atómica del historial y aislamiento de registros:** El guardado de `calls_history` se ha convertido en una escritura atómica segura para hilos.
- **Refactorización y pruebas.**
- **Pequeños ajustes de interfaz.**

<!-- lang:fr -->
## Ajouts et corrections

- **Optimisation sémantique (lissage vocal) et contexte QSO :** Ajout d'un mode optionnel pour corriger les erreurs typiques d'ASR/vocodeur en tenant compte du contexte glissant des 3 dernières répliques du slot (sur 180 secondes). Fonctionne pour la traduction cloud, Qwen local (traitement léger) et le mode « Sans traduction » / correspondance de langue.
- **Vitesse de lecture adaptative (rattrapage du direct) :** Surveille le retard de la file de lecture par rapport aux slots, supprime les silences aux extrémités des fichiers WAV et accélère progressivement la parole lorsque la file grossit tout en préservant le timbre de la voix (WSOLA pour Silero/Gemini/Groq et accélération native pour Piper/Supertonic).
- **Sélection dynamique des langues et repli ASR :** La liste des langues sources s'adapte dynamiquement aux capacités du traducteur sélectionné.
- **Voix par moteur et indicateurs de boutons :** Enregistrement distinct de la voix choisie pour chaque moteur TTS.
- **Stabilité de la file et du LLM :** Les réponses vides valides du LLM lors du filtrage des interjections ne sont plus considérées comme une erreur API ; l'appui sur PTT ou Mute garantit désormais l'annulation du minuteur de pause entre répliques TTS.
- **Nouveau widget de charge matérielle serveur dans l'en-tête du hotspot :** Deux jauges verticales (RAM et CPU) et un graphique linéaire d'historique de charge.
- **Fenêtre « Nouveautés » et analyseur de versions :** Le bouton « Nouveautés » est désormais toujours visible à côté de « Vérifier les mises à jour » et charge les notes depuis GitHub au besoin.
- **Écriture atomique de l'historique et isolation des enregistrements :** L'enregistrement de `calls_history` utilise désormais une écriture atomique thread-safe.
- **Refactorisation et tests.**
- **Ajustements mineurs de l'interface.**

<!-- lang:it -->
## Aggiunte e correzioni

- **Ottimizzazione semantica (fluidità del parlato) e contesto QSO:** Aggiunta una modalità opzionale per correggere i tipici errori ASR/vocoder tenendo conto del contesto scorrevole delle ultime 3 risposte dello slot (su 180 secondi). Funziona con traduzione cloud, Qwen locale (elaborazione leggera) e modalità «Nessuna traduzione» / corrispondenza lingua.
- **Velocità di riproduzione adattiva (recupero della diretta):** Monitora il ritardo della coda di riproduzione rispetto agli slot, taglia il silenzio ai bordi dei file WAV e accelera gradualmente il parlato all'aumentare della coda preservando il timbro vocale (WSOLA per Silero/Gemini/Groq e accelerazione nativa per Piper/Supertonic).
- **Selezione dinamica della lingua e fallback ASR:** L'elenco delle lingue di origine si adatta dinamicamente alle capacità del traduttore selezionato.
- **Voci per motore e indicatori dei pulsanti:** Aggiunto il salvataggio separato della voce selezionata per ciascun motore TTS.
- **Stabilità della coda e dell'LLM:** Le risposte vuote valide dell'LLM durante il filtraggio delle interiezioni non sono più trattate come errori API; la pressione di PTT o Mute garantisce ora l'annullamento del timer di pausa tra le repliche TTS.
- **Nuovo widget carico hardware del server nell'intestazione hotspot:** Due barre verticali (RAM e CPU) e un grafico a linee con la cronologia del carico.
- **Finestra «Novità» e parser dei rilasci:** Il pulsante «Novità» è ora sempre visibile accanto a «Controlla aggiornamenti» e carica le note da GitHub quando necessario.
- **Scrittura atomica della cronologia e isolamento dei record:** Il salvataggio di `calls_history` è stato convertito in scrittura atomica thread-safe.
- **Refactoring e test.**
- **Piccoli ritocchi all'interfaccia.**

<!-- lang:nl -->
## Toevoegingen en verbeteringen

- **Semantische optimalisatie (spraakverzachting) en QSO-context:** Optionele modus toegevoegd om typische ASR-/vocoderfouten te corrigeren op basis van de schuivende context van de laatste 3 slot-reacties (over 180 seconden). Werkt voor cloudvertaling, lokale Qwen (lichte verwerking) en de modus «Geen vertaling» / taalovereenkomst.
- **Adaptieve afspeelsnelheid (live-inhaalmodus):** Bewaakt de achterstand van de afspeelwachtrij ten opzichte van de slots, knipt stilte aan de randen van WAV-bestanden weg en versnelt spraak geleidelijk naarmate de wachtrij groeit met behoud van stemklank (WSOLA voor Silero/Gemini/Groq en native versnelling voor Piper/Supertonic).
- **Dynamische taalselectie en ASR-fallback:** De lijst met brontalen past zich dynamisch aan de mogelijkheden van de gekozen vertaler aan.
- **Stemmen per engine en knopindicatoren:** Aparte opslag toegevoegd van de geselecteerde stem voor elke TTS-engine.
- **Stabiliteit van wachtrij en LLM:** Geldige lege LLM-antwoorden bij het filteren van tussenwerpsels gelden niet langer als API-fout; het indrukken van PTT of Mute annuleert nu gegarandeerd de vertraagde TTS-pauzetimer tussen berichten.
- **Nieuwe server-hardwarebelastingwidget in de hotspot-header:** Twee verticale balkmeters (RAM en CPU) en een lijngrafiek met de belastingsgeschiedenis.
- **Venster «Wat is nieuw» en release-parser:** De knop «Wat is nieuw» is nu altijd zichtbaar naast «Controleren op updates» en laadt releasenotes zo nodig rechtstreeks van GitHub.
- **Atomaire geschiedenisopslag en recordisolatie:** Het opslaan van `calls_history` is omgezet naar thread-safe atomaire opslag.
- **Refactoring en tests.**
- **Kleine UI-aanpassingen.**

</details>
