"""
DMR TalkGroup Resolver for ProxDMR
Provides fast in-memory and persistent disk caching for DMR TalkGroup names,
automatic synchronization with BrandMeister talkgroup catalog, on-demand online lookup,
and intelligent ITU/MCC country & regional identification.
"""

import asyncio
import json
import logging
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("proxdmr.tg_resolver")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TG_CACHE_FILE = DATA_DIR / "tg_names_cache.json"

# ITU / Mobile Country Code (MCC) DMR 3-digit prefixes to Country Names
MCC_COUNTRIES = {
    204: "Нидерланды (Netherlands)",
    206: "Бельгия (Belgium)",
    208: "Франция (France)",
    214: "Испания (Spain)",
    216: "Венгрия (Hungary)",
    222: "Италия (Italy)",
    226: "Румыния (Romania)",
    228: "Швейцария (Switzerland)",
    230: "Чехия (Czech Republic)",
    231: "Словакия (Slovakia)",
    232: "Австрия (Austria)",
    234: "Великобритания (United Kingdom)",
    235: "Великобритания (United Kingdom)",
    238: "Дания (Denmark)",
    240: "Швеция (Sweden)",
    242: "Норвегия (Norway)",
    244: "Финляндия (Finland)",
    246: "Литва (Lithuania)",
    247: "Латвия (Latvia)",
    248: "Эстония (Estonia)",
    250: "Россия (Общий / CIS)",
    255: "Украина (Ukraine)",
    257: "Беларусь (Belarus)",
    259: "Молдова (Moldova)",
    260: "Польша (Poland)",
    262: "Германия (Germany)",
    268: "Португалия (Portugal)",
    270: "Люксембург (Luxembourg)",
    272: "Ирландия (Ireland)",
    274: "Исландия (Iceland)",
    276: "Албания (Albania)",
    278: "Мальта (Malta)",
    280: "Кипр (Cyprus)",
    282: "Грузия (Georgia)",
    283: "Армения (Armenia)",
    284: "Болгария (Bulgaria)",
    286: "Турция (Turkey)",
    288: "Фарерские о-ва (Faroe Islands)",
    293: "Словения (Slovenia)",
    294: "Сев. Македония (North Macedonia)",
    295: "Лихтенштейн (Liechtenstein)",
    302: "Канада (Canada)",
    310: "США (United States TAC 310)",
    311: "США (United States)",
    312: "США (United States)",
    313: "США (United States)",
    314: "США (United States)",
    315: "США (United States)",
    316: "США (United States)",
    334: "Мексика (Mexico)",
    401: "Казахстан (Kazakhstan)",
    428: "Таджикистан (Tajikistan)",
    434: "Узбекистан (Uzbekistan)",
    436: "Азербайджан (Azerbaijan)",
    437: "Кыргызстан (Kyrgyzstan)",
    438: "Туркменистан (Turkmenistan)",
    440: "Япония (Japan)",
    450: "Южная Корея (South Korea)",
    460: "Китай (China)",
    502: "Малайзия (Malaysia)",
    505: "Австралия (Australia)",
    515: "Филиппины (Philippines)",
    520: "Таиланд (Thailand)",
    525: "Сингапур (Singapore)",
    530: "Новая Зеландия (New Zealand)",
    602: "Египет (Egypt)",
    655: "ЮАР (South Africa)",
    724: "Бразилия (Brazil)",
    730: "Чили (Chile)",
    736: "Боливия (Bolivia)",
    748: "Уругвай (Uruguay)",
    722: "Аргентина (Argentina)",
}


# Bilingual search aliases for cities, countries, and regional hubs (Russian <-> English)
BILINGUAL_ALIASES = {
    # Cities & Regions
    "москва": [250077, 2501, 250],
    "moscow": [250077, 2501, 250],
    "санкт-петербург": [250078, 25033],
    "петербург": [250078, 25033],
    "питер": [250078, 25033],
    "spb": [250078, 25033],
    "saint petersburg": [250078, 25033],
    "st petersburg": [250078, 25033],
    "екатеринбург": [250066],
    "yekaterinburg": [250066],
    "свердловск": [250066],
    "новосибирск": [250054],
    "novosibirsk": [250054],
    "нижний новгород": [250052],
    "nizhny novgorod": [250052],
    "казань": [250016],
    "kazan": [250016],
    "самара": [250063],
    "samara": [250063],
    "ростов": [250061],
    "rostov": [250061],
    "краснодар": [250023],
    "krasnodar": [250023],
    "кубань": [250023],
    "владивосток": [250025, 2509],
    "vladivostok": [250025, 2509],
    "хабаровск": [250014, 2509],
    "khabarovsk": [250014, 2509],
    "красноярск": [250024],
    "krasnoyarsk": [250024],
    "калининград": [25011],
    "kaliningrad": [25011],
    "крым": [250082],
    "crimea": [250082],
    "севастополь": [250082],
    "sevastopol": [250082],
    "иркутск": [250038],
    "irkutsk": [250038],
    "уфа": [250002],
    "ufa": [250002],
    "пермь": [250059],
    "perm": [250059],
    "волгоград": [250034],
    "volgograd": [250034],
    "воронеж": [250036],
    "voronezh": [250036],
    "саратов": [250064],
    "saratov": [250064],
    "тюмень": [250072],
    "tyumen": [250072],
    "омск": [250055],
    "omsk": [250055],
    "барнаул": [250022],
    "barnaul": [250022],
    "алтай": [250022],
    "altai": [250022],
    "камчатка": [250041],
    "kamchatka": [250041],
    "сахалин": [250065],
    "sakhalin": [250065],
    "якутск": [250014],
    "yakutsk": [250014],
    "мурманск": [250051],
    "murmansk": [250051],
    "архангельск": [250029],
    "arkhangelsk": [250029],
    "сочи": [250023],
    "sochi": [250023],

    # CIS / Neighboring Countries & Capitals
    "алматы": [401, 40101],
    "almaty": [401, 40101],
    "алма-ата": [401, 40101],
    "астана": [401],
    "astana": [401],
    "нур-султан": [401],
    "казахстан": [401],
    "kazakhstan": [401],
    "минск": [257, 2571],
    "minsk": [257, 2571],
    "беларусь": [257],
    "belarus": [257],
    "белоруссия": [257],
    "киев": [255, 2551],
    "kiev": [255, 2551],
    "kyiv": [255, 2551],
    "украина": [255],
    "ukraine": [255],
    "ереван": [283],
    "yerevan": [283],
    "армения": [283],
    "armenia": [283],
    "тбилиси": [282],
    "tbilisi": [282],
    "грузия": [282],
    "georgia": [282],
    "баку": [436],
    "baku": [436],
    "азербайджан": [436],
    "azerbaijan": [436],
    "ташкент": [434],
    "tashkent": [434],
    "узбекистан": [434],
    "uzbekistan": [434],
    "бишкек": [437],
    "bishkek": [437],
    "кыргызстан": [437],
    "kyrgyzstan": [437],
    "киргизия": [437],
    "душанбе": [428],
    "dushanbe": [428],
    "таджикистан": [428],
    "tajikistan": [428],
    "ашхабад": [438],
    "ashgabat": [438],
    "туркменистан": [438],
    "turkmenistan": [438],
    "туркмения": [438],
    "кишинев": [259],
    "chisinau": [259],
    "kishinev": [259],
    "молдова": [259],
    "moldova": [259],
    "вильнюс": [246, 2461],
    "vilnius": [246, 2461],
    "литва": [246],
    "lithuania": [246],
    "рига": [247, 2471],
    "riga": [247, 2471],
    "латвия": [247],
    "latvia": [247],
    "таллин": [248, 2481],
    "таллинн": [248, 2481],
    "tallinn": [248, 2481],
    "эстония": [248],
    "estonia": [248],

    # World Capitals / Popular
    "берлин": [262],
    "berlin": [262],
    "германия": [262],
    "germany": [262],
    "лондон": [234, 235],
    "london": [234, 235],
    "великобритания": [234, 235],
    "англия": [234, 235],
    "uk": [234, 235],
    "united kingdom": [234, 235],
    "париж": [208],
    "paris": [208],
    "франция": [208],
    "france": [208],
    "рим": [222],
    "rome": [222],
    "италия": [222],
    "italy": [222],
    "мадрид": [214],
    "madrid": [214],
    "испания": [214],
    "spain": [214],
    "варшава": [260],
    "warsaw": [260],
    "польша": [260],
    "poland": [260],
    "хельсинки": [244],
    "helsinki": [244],
    "финляндия": [244],
    "finland": [244],
    "суоми": [244],
    "стокгольм": [240],
    "stockholm": [240],
    "швеция": [240],
    "sweden": [240],
    "прага": [230],
    "prague": [230],
    "чехия": [230],
    "czech": [230],
    "вена": [232],
    "vienna": [232],
    "австрия": [232],
    "austria": [232],
    "токио": [440],
    "tokyo": [440],
    "япония": [440],
    "japan": [440],
    "пекин": [460],
    "beijing": [460],
    "китай": [460],
    "china": [460],
    "сша": [310, 311, 312],
    "usa": [310, 311, 312],
    "united states": [310, 311, 312],
    "нью-йорк": [310, 3136],
    "new york": [310, 3136],
    "калифорния": [3106],
    "california": [3106],
    "канада": [302],
    "canada": [302],
    "израиль": [425],
    "israel": [425],
    "теflush": [425],
    "тел-авив": [425],
    "tel aviv": [425],

    # Special / Service
    "эхо": [9990],
    "попугай": [9990],
    "echo": [9990],
    "parrot": [9990],
    "мир": [91],
    "весь мир": [91],
    "worldwide": [91],
    "global": [91],
    "европа": [92],
    "europe": [92],
    "снг": [250],
    "cis": [250],
    "россия": [250, 2501, 2502, 2503],
    "russia": [250, 2501, 2502, 2503],
}

# Curated well-known seeds and Russian DMR regions
SEED_TALKGROUPS = {
    1: "Local (Локальная сеть)",
    2: "Cluster (Кластер)",
    8: "Regional (Региональная)",
    9: "Local (Слот-Локальная)",
    91: "Worldwide (Весь мир)",
    92: "Europe (Европа)",
    93: "North America (Сев. Америка)",
    94: "Asia, Middle East (Азия)",
    95: "Australia, NZ (Австралия/Океания)",
    98: "Radio Test (Тестовая)",
    113: "English WW (Англоязычная)",
    250: "Россия (Общий / CIS)",
    2501: "Россия 1 (National)",
    2502: "Москва и Московская обл.",
    2503: "Санкт-Петербург и СЗФО",
    2504: "Центральный ФО",
    2505: "Южный & Кавказский ФО",
    2506: "Приволжский ФО",
    2507: "Уральский ФО",
    2508: "Сибирский ФО",
    2509: "Дальневосточный ФО",
    25011: "Калининградская обл.",
    25020: "Конференция РОСХАМ",
    25033: "Ленинградская обл.",
    250011: "Россия / Коми",
    250013: "Россия / Саранск",
    250014: "Россия / Хабаровск",
    250015: "Россия / Дальнобойщики",
    250016: "Россия / Нижнекамск",
    250021: "Россия / Чебоксары",
    250024: "Россия / Красноярский край",
    250029: "Россия / Архангельская обл.",
    250030: "Россия / Астрахань",
    250032: "Россия / Брянск",
    250033: "Россия / Владимир",
    250037: "Россия / Чайковский (Пермь)",
    250039: "Россия / Калининград",
    250040: "Россия / Калуга",
    250042: "Россия / Северск",
    250043: "Россия / Киров",
    250048: "Россия / Липецк",
    250051: "Россия / Мурманская обл.",
    250052: "Россия / Нижний Новгород",
    250056: "Россия / Оренбург",
    250067: "Россия / Смоленская обл.",
    250069: "Россия / Тверская обл.",
    250070: "Россия / Томск",
    250071: "Россия / Тула",
    250073: "Россия / Ульяновск",
    250078: "Россия / 4POC",
    250084: "Россия / Норильск",
    250096: "Россия / Екатеринбург",
    250100: "Россия / Спутники",
    250111: "Россия / Курилка",
    250112: "Россия / Спасатели РОССОЮЗСПАС",
    250116: "Россия / Казань",
    250125: "Россия / Уссурийск",
    250142: "Россия / Кузбасс",
    250159: "Россия / Пермский край",
    250163: "Россия / Самара",
    250164: "Россия / Саратовская обл.",
    250212: "Россия / Йошкар-Ола (Марий Эл)",
    250246: "Россия / Раменское",
    250250: "Motorola Users RF",
    250351: "Россия / Челябинск",
    250500: "Россия / Ростов-на-Дону",
    250505: "Россия / Чехов",
    250600: "Россия / Иваново",
    250601: "Россия / Волгоградская обл.",
    250602: "Россия / Ростовская обл.",
    250603: "Армения / Репитер",
    250605: "Россия / Екатеринбург Радиоклуб",
    250607: "Россия / Верхняя Пышма",
    250608: "Россия / Сочи",
    250609: "Россия / Сыктывкар",
    250610: "Россия / Владивосток",
    250611: "Россия / Москва (RD3ANL)",
    250612: "Россия / Омск",
    250613: "Россия / Дорохово",
    250614: "Россия / Домодедово",
    250615: "Россия / Подольск",
    250616: "Россия / Ростовская область",
    250617: "Россия / Северный Кавказ",
    250618: "Россия / Москва Тушино",
    250619: "Россия / Волгодонск",
    250620: "Россия / Москва R2AJV",
    250621: "Россия / Москва",
    250622: "Россия / Красноярск",
    250623: "Россия / Селятино",
    250624: "Россия / Можайск",
    250625: "Россия / Красногорск",
    250626: "Россия / Наро-Фоминск",
    250627: "Россия / Краснодар",
    250628: "Россия / Егорьевск",
    250629: "Россия / Орел",
    250630: "Россия / Сергиев Посад",
    250631: "Россия / Углич",
    250632: "Россия / Сибирь и Дальний Восток",
    250633: "Россия / Уфа (Башкортостан)",
    250634: "Россия / Курганинск",
    250635: "Россия / Иркутск, Чита",
    250636: "Россия / Саров",
    250637: "Россия / Тверь",
    250638: "Россия / Крым",
    250639: "Россия / Приморский край",
    250640: "Россия / Майкоп (Адыгея)",
    250641: "Россия / Краснодарский край",
    250642: "Россия / Снежинск",
    250643: "Россия / Ярославская обл.",
    250644: "Россия / Новосибирск",
    250645: "Россия / Мытищи",
    250646: "Россия / Великий Новгород",
    250647: "Россия / Ставропольский край",
    250648: "Россия / Белгородская обл.",
    250649: "Россия / Шахты",
    250650: "Россия / Воронеж",
    250651: "Россия / Тюмень",
    250652: "Россия / Улан-Удэ (Бурятия)",
    250653: "Россия / Ступино",
    250654: "Россия / Шатура",
    250655: "Россия / Обнинск",
    250656: "Россия / Алтайский край",
    250657: "Россия / Балабаново",
    250658: "Россия / Ижевск (Удмуртия)",
    250659: "Россия / Рязань",
    250660: "Россия / Local R2AWN",
    250661: "Россия / ЛизаАлерт Поиск",
    250662: "Россия / Hytera RU",
    250663: "Россия / Зеленоград",
    250667: "Россия / Смоленск",
    250668: "Россия / Нальчик (КБР)",
    250700: "Россия / Климовск",
    250707: "Россия / Севастополь",
    250716: "Россия / Альметьевск",
    250777: "Россия / Калининград",
    250800: "WorldWide Mobile",
    250812: "Россия / Санкт-Петербург",
    250813: "Россия / СПб R7",
    250888: "Россия / Шумерля (Чувашия)",
    250907: "Россия / Приморский край (JOTA)",
    250942: "Россия / Кемерово",
    262: "Германия (National)",
    310: "США (TAC 310)",
    4000: "Unlink (Отключение)",
    9990: "Parrot (Эхо-тест)",
}


class TGResolver:
    """
    Resolves TalkGroup numbers to human-readable names and descriptions.
    Maintains persistent storage in tg_names_cache.json, automatically fetches
    the master catalog from BrandMeister, and provides fallback by country MCC.
    """

    def __init__(self):
        self.cache: Dict[int, str] = dict(SEED_TALKGROUPS)
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._load_cache()
        # Seed MCC country names if not already present
        for mcc, cname in MCC_COUNTRIES.items():
            if mcc not in self.cache:
                self.cache[mcc] = cname
        self._last_check_time = time.time() if len(self.cache) > 100 else 0

    def _load_cache(self):
        if TG_CACHE_FILE.exists():
            try:
                with open(TG_CACHE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        try:
                            self.cache[int(k)] = str(v).strip()
                        except (ValueError, TypeError):
                            pass
                logger.info(f"[TG_RESOLVER] Loaded {len(self.cache)} cached TG names from {TG_CACHE_FILE}")
            except Exception as e:
                logger.warning(f"[TG_RESOLVER] Could not read cache file: {e}")

    def save_cache(self):
        try:
            temp_file = TG_CACHE_FILE.with_suffix(".tmp")
            out_data = {str(k): v for k, v in sorted(self.cache.items())}
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(out_data, f, ensure_ascii=False, indent=2)
            temp_file.replace(TG_CACHE_FILE)
            logger.info(f"[TG_RESOLVER] Saved {len(self.cache)} TG names to {TG_CACHE_FILE}")
        except Exception as e:
            logger.error(f"[TG_RESOLVER] Failed to save cache: {e}")

    def get_name(self, tg: int) -> str:
        """
        Returns the resolved name for a talkgroup synchronously.
        If unknown, uses intelligent ITU/MCC prefix resolution.
        """
        if tg in self.cache and self.cache[tg]:
            return self.cache[tg]

        # Check ITU / MCC country resolution
        name = self._resolve_by_mcc(tg)
        if name:
            self.cache[tg] = name
            return name

        return f"TG {tg}"

    def _resolve_by_mcc(self, tg: int) -> Optional[str]:
        """Resolves country/region by ITU/MCC prefix."""
        s = str(tg)
        # Check 3-digit MCC exact match
        if len(s) == 3 and tg in MCC_COUNTRIES:
            return MCC_COUNTRIES[tg]

        # Check 3-digit prefix for longer TGs (e.g. 2461 -> Lithuania Regional)
        if len(s) >= 4:
            try:
                mcc = int(s[:3])
                if mcc in MCC_COUNTRIES:
                    cname = MCC_COUNTRIES[mcc].split(" (")[0]
                    if mcc == 246:
                        return f"Литва / Регион ({tg})"
                    elif mcc == 247:
                        return f"Латвия / Регион ({tg})"
                    elif mcc == 248:
                        return f"Эстония / Регион ({tg})"
                    elif mcc == 255:
                        return f"Украина / Регион ({tg})"
                    elif mcc == 257:
                        return f"Беларусь / Регион ({tg})"
                    elif mcc == 250:
                        return f"Россия / Регион ({tg})"
                    return f"{cname} / TG {tg}"
            except Exception:
                pass
        return None

    async def fetch_master_catalog(self) -> int:
        """
        Downloads all talkgroups from BrandMeister API (v2/talkgroup)
        and merges into local cache without overriding Russian curated names.
        """
        url = "https://api.brandmeister.network/v2/talkgroup/"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "ProxDMR/0.1",
                "Accept": "application/json"
            }
        )

        def _fetch():
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            try:
                with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
                    raw = resp.read().decode("utf-8")
                    return json.loads(raw)
            except Exception as e:
                logger.warning(f"[TG_RESOLVER] Failed to download BM catalog: {e}")
                return None

        data = await asyncio.to_thread(_fetch)
        if not data or not isinstance(data, dict):
            return 0

        updated_count = 0
        for k, v in data.items():
            try:
                tg_id = int(k)
                name = str(v).strip()
                if name and (tg_id not in self.cache or self.cache[tg_id].startswith("TG ")):
                    self.cache[tg_id] = name
                    updated_count += 1
            except (ValueError, TypeError):
                continue

        if updated_count > 0:
            self.save_cache()
            logger.info(f"[TG_RESOLVER] Imported {updated_count} talkgroups from BrandMeister catalog")
        return updated_count

    async def lookup_online(self, tg: int) -> Optional[str]:
        """Queries BrandMeister API for a single talkgroup."""
        url = f"https://api.brandmeister.network/v2/talkgroup/{tg}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "ProxDMR/0.1",
                "Accept": "application/json"
            }
        )

        def _fetch():
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            try:
                with urllib.request.urlopen(req, context=ctx, timeout=4) as resp:
                    raw = resp.read().decode("utf-8")
                    data = json.loads(raw)
                    return data.get("Name") or data.get("name")
            except urllib.error.HTTPError:
                return None
            except Exception as e:
                logger.debug(f"[TG_RESOLVER] Error looking up TG {tg}: {e}")
                return None

        name = await asyncio.to_thread(_fetch)
        if name and str(name).strip():
            self.cache[tg] = str(name).strip()
            return self.cache[tg]
        return None

    async def resolve_many(self, tgs: List[int]) -> Dict[int, str]:
        """
        Resolves a list of TalkGroups.
        First checks local cache; for missing items, queries BM API or uses MCC rule.
        Saves updated cache to disk.
        """
        results = {}
        missing = []
        for tg in tgs:
            if tg in self.cache and self.cache[tg] and not self.cache[tg].startswith("TG "):
                results[tg] = self.cache[tg]
            else:
                mcc_name = self._resolve_by_mcc(tg)
                if mcc_name:
                    self.cache[tg] = mcc_name
                    results[tg] = mcc_name
                else:
                    missing.append(tg)

        if missing:
            sem = asyncio.Semaphore(5)
            async def _limited_lookup(tg):
                async with sem:
                    return await self.lookup_online(tg)
            tasks = [_limited_lookup(tg) for tg in missing[:30]]
            online_results = await asyncio.gather(*tasks, return_exceptions=True)
            for tg, res in zip(missing[:30], online_results):
                if isinstance(res, str) and res:
                    results[tg] = res
                else:
                    fallback = self._resolve_by_mcc(tg) or f"TG {tg}"
                    self.cache[tg] = fallback
                    results[tg] = fallback

            self.save_cache()

        return results

    def get_all_names(self) -> Dict[str, str]:
        """Returns all cached TalkGroup mappings as string keys for JSON serialization."""
        return {str(k): v for k, v in self.cache.items()}



    def search_talkgroups(self, query: str, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Searches TalkGroups by TG number, Russian/English name, country, city or alias.
        Returns ranked list of matching items:
        [{"tg": int, "name": str, "country": str, "details": str}, ...]
        """
        q = query.strip().lower()
        if not q:
            # Return popular top talkgroups if empty query
            top_tgs = [91, 92, 250, 2501, 2502, 2503, 246, 247, 248, 255, 257, 401, 9990]
            results = []
            for tg in top_tgs:
                results.append({
                    "tg": tg,
                    "name": self.get_name(tg),
                    "country": self._get_country_name(tg),
                    "is_direct": True
                })
            return results

        exact_matches = []
        prefix_matches = []
        contains_matches = []
        alias_matches = []
        seen_tgs = set()

        # Check numeric search
        if q.isdigit():
            q_num = int(q)
            if q_num in self.cache:
                exact_matches.append(q_num)
                seen_tgs.add(q_num)
            for tg in self.cache:
                if tg in seen_tgs:
                    continue
                s_tg = str(tg)
                if s_tg.startswith(q):
                    prefix_matches.append(tg)
                    seen_tgs.add(tg)
                elif q in s_tg:
                    contains_matches.append(tg)
                    seen_tgs.add(tg)

        # Check bilingual aliases
        for alias_key, tg_list in BILINGUAL_ALIASES.items():
            if q == alias_key or q in alias_key or alias_key in q:
                for tg in tg_list:
                    if tg not in seen_tgs:
                        alias_matches.append(tg)
                        seen_tgs.add(tg)

        # Check textual names in cache & MCC countries
        for tg, name in self.cache.items():
            if tg in seen_tgs:
                continue
            nl = name.lower()
            country_name = self._get_country_name(tg).lower()
            if q == nl or q == country_name:
                exact_matches.append(tg)
                seen_tgs.add(tg)
            elif nl.startswith(q) or country_name.startswith(q):
                prefix_matches.append(tg)
                seen_tgs.add(tg)
            elif q in nl or q in country_name:
                contains_matches.append(tg)
                seen_tgs.add(tg)

        # Check MCC Countries mapping directly
        for mcc, cname in MCC_COUNTRIES.items():
            if mcc in seen_tgs:
                continue
            cnl = cname.lower()
            if q in cnl:
                contains_matches.append(mcc)
                seen_tgs.add(mcc)

        # Merge in order of priority
        all_matched_tgs = exact_matches + alias_matches + prefix_matches + contains_matches
        results = []
        for tg in all_matched_tgs[:limit]:
            results.append({
                "tg": tg,
                "name": self.get_name(tg),
                "country": self._get_country_name(tg),
                "is_direct": True
            })

        return results

    def _get_country_name(self, tg: int) -> str:
        """Helper to extract country or category for a talkgroup."""
        s = str(tg)
        if tg in (91, 92, 93, 94, 95, 98):
            return "Международная (Global)"
        if tg == 9990:
            return "Служебная (Audio Test)"
        if len(s) == 3 and tg in MCC_COUNTRIES:
            return MCC_COUNTRIES[tg]
        if len(s) >= 4:
            try:
                mcc = int(s[:3])
                if mcc in MCC_COUNTRIES:
                    return MCC_COUNTRIES[mcc]
            except Exception:
                pass
        return ""

    async def check_and_update(self, interval_seconds: int = 10800) -> bool:
        """
        Periodically (every 3 hours / 10800s) checks and refreshes the BrandMeister catalog.
        """
        now = time.time()
        if not hasattr(self, "_last_check_time"):
            self._last_check_time = 0
        if (now - self._last_check_time) >= interval_seconds:
            logger.info("[TG_RESOLVER] Performing scheduled 3-hour check of BrandMeister catalog...")
            try:
                count = await self.fetch_master_catalog()
                self._last_check_time = now
                return count > 0
            except Exception as e:
                logger.error(f"[TG_RESOLVER] Failed scheduled check: {e}")
                self._last_check_time = now
                return False
        return False

    def get_stats(self) -> Dict[str, Any]:
        count = len(self.cache)
        updated_ts = 0.0
        if TG_CACHE_FILE.exists():
            try:
                updated_ts = TG_CACHE_FILE.stat().st_mtime
            except Exception:
                pass
        return {
            "count": count,
            "updated_ts": updated_ts,
            "updated_str": time.strftime("%d.%m.%Y %H:%M", time.localtime(updated_ts)) if updated_ts else "Встроенная база"
        }


# Global singleton instance
tg_resolver = TGResolver()
