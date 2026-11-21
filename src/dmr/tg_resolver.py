"""
DMR TalkGroup Resolver for ProxDMR
Provides fast in-memory and persistent disk caching for DMR TalkGroup names,
automatic synchronization with BrandMeister talkgroup catalog, on-demand online lookup,
and intelligent ITU/MCC country & regional identification.
"""

import asyncio
import json
import logging
import re
import ssl
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from i18n_backend import tr as _tr, country_name as _i18n_country_name, tg_special_name as _tg_special_name
except ImportError:
    from src.i18n_backend import tr as _tr, country_name as _i18n_country_name, tg_special_name as _tg_special_name

logger = logging.getLogger("proxdmr.tg_resolver")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TG_CACHE_FILE = DATA_DIR / "tg_names_cache.json"
TGIF_CACHE_FILE = DATA_DIR / "tgif_tg_names_cache.json"
FREEDMR_CACHE_FILE = DATA_DIR / "freedmr_tg_names_cache.json"
FREEDMR_CATALOG_URL = "http://downloads.freedmr.uk/downloads/talkgroup_ids.json"
ADN_CACHE_FILE = DATA_DIR / "adn_tg_names_cache.json"
ADN_TALKGROUPS_API_URL = "https://adn.systems/api/talkgroups"
ADN_TALKGROUPS_PAGE_URL = "https://adn.systems/talkgroups"
ADN_TG_TTL_SEC = 24 * 3600
ADN_TG_RETRY_COOLDOWN_SEC = 120.0

SEED_TGIF_TALKGROUPS = {
    777: "TGIF Multi-Lang",
    31665: "TGIF The Mothership",
    2501: "Russia",
    250: "CCARS",
    91: "World-Wide",
    9990: "Parrot (Echo Test)",
    4000: "Unlink (Disconnect)",
}

SEED_FREEDMR_TALKGROUPS = {
    91: "Worldwide",
    92: "Europe",
    250: "Russia",
    2501: "Russia 1",
    2502: "Russia 2",
    2503: "Russia 3",
    2505: "Russia South",
    4000: "Unlink (Disconnect)",
    9990: "Parrot (Echo Test)",
}

SEED_ADN_TALKGROUPS = {
    91: "Worldwide",
    92: "Europe",
    93: "North America",
    94: "International",
    202: "Greece",
    204: "Netherlands",
    206: "Belgium",
    208: "France",
    214: "Spain",
    222: "Italy",
    248: "Estonia",
    250: "Russia National",
    2501: "Russia Central",
    2502: "Russia Northwest",
    2503: "Russia Volga",
    2504: "Russia Urals",
    2505: "Russia South",
    255: "Ukraine",
    262: "Germany",
    284: "Bulgaria",
    334: "Mexico",
    712: "Costa Rica",
    724: "Brazil",
    730: "Chile",
    732: "Colombia",
    740: "Ecuador",
    3100: "USA Nationwide",
    3103: "USA Mid-Atlantic",
    4000: "Unlink (Disconnect)",
    9990: "Parrot (Echo Test)",
}

# ITU / Mobile Country Code (MCC) DMR 3-digit prefixes to Country Names
MCC_COUNTRIES = {
    204: "Netherlands",
    206: "Belgium",
    208: "France",
    214: "Spain",
    216: "Hungary",
    222: "Italy",
    226: "Romania",
    228: "Switzerland",
    230: "Czech Republic",
    231: "Slovakia",
    232: "Austria",
    234: "United Kingdom",
    235: "United Kingdom",
    238: "Denmark",
    240: "Sweden",
    242: "Norway",
    244: "Finland",
    246: "Lithuania",
    247: "Latvia",
    248: "Estonia",
    250: "Russia",
    255: "Ukraine",
    257: "Belarus",
    259: "Moldova",
    260: "Poland",
    262: "Germany",
    268: "Portugal",
    270: "Luxembourg",
    272: "Ireland",
    274: "Iceland",
    276: "Albania",
    278: "Malta",
    280: "Cyprus",
    282: "Georgia",
    283: "Armenia",
    284: "Bulgaria",
    286: "Turkey",
    288: "Faroe Islands",
    293: "Slovenia",
    294: "North Macedonia",
    295: "Liechtenstein",
    302: "Canada",
    310: "United States",
    311: "United States",
    312: "United States",
    313: "United States",
    314: "United States",
    315: "United States",
    316: "United States",
    334: "Mexico",
    401: "Kazakhstan",
    428: "Tajikistan",
    434: "Uzbekistan",
    436: "Azerbaijan",
    437: "Kyrgyzstan",
    438: "Turkmenistan",
    440: "Japan",
    450: "South Korea",
    460: "China",
    502: "Malaysia",
    505: "Australia",
    515: "Philippines",
    520: "Thailand",
    525: "Singapore",
    530: "New Zealand",
    602: "Egypt",
    655: "South Africa",
    724: "Brazil",
    730: "Chile",
    736: "Bolivia",
    748: "Uruguay",
    722: "Argentina",
}

MCC_ISO_MAP = {
    204: "NL", 206: "BE", 208: "FR", 214: "ES", 216: "HU", 222: "IT",
    226: "RO", 228: "CH", 230: "CZ", 231: "SK", 232: "AT", 234: "GB",
    235: "GB", 238: "DK", 240: "SE", 242: "NO", 244: "FI", 246: "LT",
    247: "LV", 248: "EE", 250: "RU", 255: "UA", 257: "BY", 259: "MD",
    260: "PL", 262: "DE", 268: "PT", 270: "LU", 272: "IE", 274: "IS",
    276: "AL", 278: "MT", 280: "CY", 282: "GE", 283: "AM", 284: "BG",
    286: "TR", 288: "FO", 293: "SI", 294: "MK", 295: "LI", 302: "CA",
    310: "US", 311: "US", 312: "US", 313: "US", 314: "US", 315: "US",
    316: "US", 334: "MX", 401: "KZ", 428: "TJ", 434: "UZ", 436: "AZ",
    437: "KG", 438: "TM", 440: "JP", 450: "KR", 460: "CN", 502: "MY",
    505: "AU", 515: "PH", 520: "TH", 525: "SG", 530: "NZ", 602: "EG",
    655: "ZA", 724: "BR", 730: "CL", 736: "BO", 748: "UY", 722: "AR",
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
    "тель-авив": [425],
    "коми": [250011],
    "рязань": [250659],
    "иваново": [250600],
    "белгород": [250648],
    "ярославль": [250643],
    "брянск": [250032],
    "владимир": [250033],
    "калуга": [250040],
    "киров": [250043],
    "липецк": [250048],
    "оренбург": [250056],
    "смоленск": [250667, 250067],
    "тверь": [250637, 250069],
    "томск": [250070],
    "тула": [250071],
    "ульяновск": [250073],
    "челябинск": [250351],
    "кемерово": [250942, 250142],
}

# Curated well-known seeds and DMR regions
SEED_TALKGROUPS = {
    1: "Local Net",
    2: "Cluster",
    8: "Regional Net",
    9: "Local (Slot-Local)",
    91: "Worldwide",
    92: "Europe",
    93: "North America",
    94: "Asia, Middle East",
    95: "Australia, NZ (Oceania)",
    98: "Radio Test",
    113: "English Worldwide",
    250: "Russia (General / CIS)",
    2501: "Russia 1 (National)",
    2502: "Moscow & Moscow Region",
    2503: "St. Petersburg & NWFD",
    2504: "Central FD",
    2505: "Southern & Caucasus FD",
    2506: "Volga FD",
    2507: "Ural FD",
    2508: "Siberian FD",
    2509: "Far Eastern FD",
    25011: "Kaliningrad Region",
    25020: "ROSHAM Conference",
    25033: "Leningrad Region",
    250011: "Russia / Komi",
    250013: "Russia / Saransk",
    250014: "Russia / Khabarovsk",
    250015: "Russia / Truckers",
    250016: "Russia / Nizhnekamsk",
    250021: "Russia / Cheboksary",
    250024: "Russia / Krasnoyarsk Krai",
    250029: "Russia / Arkhangelsk Region",
    250030: "Russia / Astrakhan",
    250032: "Russia / Bryansk",
    250033: "Russia / Vladimir",
    250037: "Russia / Chaykovsky (Perm)",
    250039: "Russia / Kaliningrad",
    250040: "Russia / Kaluga",
    250042: "Russia / Seversk",
    250043: "Russia / Kirov",
    250048: "Russia / Lipetsk",
    250051: "Russia / Murmansk Region",
    250052: "Russia / Nizhny Novgorod",
    250056: "Russia / Orenburg",
    250067: "Russia / Smolensk Region",
    250069: "Russia / Tver Region",
    250070: "Russia / Tomsk",
    250071: "Russia / Tula",
    250073: "Russia / Ulyanovsk",
    250078: "Russia / 4POC",
    250084: "Russia / Norilsk",
    250096: "Russia / Yekaterinburg",
    250100: "Russia / Satellites",
    250111: "Russia / Chat Lounge",
    250112: "Russia / ROSSOYUZSPAS Rescue",
    250116: "Russia / Kazan",
    250125: "Russia / Ussuriysk",
    250142: "Russia / Kuzbass",
    250159: "Russia / Perm Krai",
    250163: "Russia / Samara",
    250164: "Russia / Saratov Region",
    250212: "Russia / Yoshkar-Ola (Mari El)",
    250246: "Russia / Ramenskoye",
    250250: "Motorola Users RF",
    250351: "Russia / Chelyabinsk",
    250500: "Russia / Rostov-on-Don",
    250505: "Russia / Chekhov",
    250600: "Russia / Ivanovo",
    250601: "Russia / Volgograd Region",
    250602: "Russia / Rostov Region",
    250603: "Armenia / Repeater",
    250605: "Russia / Yekaterinburg Radio Club",
    250607: "Russia / Verkhnyaya Pyshma",
    250608: "Russia / Sochi",
    250609: "Russia / Syktyvkar",
    250610: "Russia / Vladivostok",
    250611: "Russia / Moscow (RD3ANL)",
    250612: "Russia / Omsk",
    250613: "Russia / Dorokhovo",
    250614: "Russia / Domodedovo",
    250615: "Russia / Podolsk",
    250616: "Russia / Rostov Region",
    250617: "Russia / North Caucasus",
    250618: "Russia / Moscow Tushino",
    250619: "Russia / Volgodonsk",
    250620: "Russia / Moscow R2AJV",
    250621: "Russia / Moscow",
    250622: "Russia / Krasnoyarsk",
    250623: "Russia / Selyatino",
    250624: "Russia / Mozhaysk",
    250625: "Russia / Krasnogorsk",
    250626: "Russia / Naro-Fominsk",
    250627: "Russia / Krasnodar",
    250628: "Russia / Yegoryevsk",
    250629: "Russia / Oryol",
    250630: "Russia / Sergiyev Posad",
    250631: "Russia / Uglich",
    250632: "Russia / Siberia & Far East",
    250633: "Russia / Ufa (Bashkortostan)",
    250634: "Russia / Kurganinsk",
    250635: "Russia / Irkutsk, Chita",
    250636: "Russia / Sarov",
    250637: "Russia / Tver",
    250638: "Russia / Crimea",
    250639: "Russia / Primorsky Krai",
    250640: "Russia / Maykop (Adygea)",
    250641: "Russia / Krasnodar Krai",
    250642: "Russia / Snezhinsk",
    250643: "Russia / Yaroslavl Region",
    250644: "Russia / Novosibirsk",
    250645: "Russia / Mytishchi",
    250646: "Russia / Veliky Novgorod",
    250647: "Russia / Stavropol Krai",
    250648: "Russia / Belgorod Region",
    250649: "Russia / Shakhty",
    250650: "Russia / Voronezh",
    250651: "Russia / Tyumen",
    250652: "Russia / Ulan-Ude (Buryatia)",
    250653: "Russia / Stupino",
    250654: "Russia / Shatura",
    250655: "Russia / Obninsk",
    250656: "Russia / Altai Krai",
    250657: "Russia / Balabanovo",
    250658: "Russia / Izhevsk (Udmurtia)",
    250659: "Russia / Ryazan",
    250660: "Russia / Local R2AWN",
    250661: "Russia / LizaAlert Search",
    250662: "Russia / Hytera RU",
    250663: "Russia / Zelenograd",
    250667: "Russia / Smolensk",
    250668: "Russia / Nalchik (KBR)",
    250700: "Russia / Klimovsk",
    250707: "Russia / Sevastopol",
    250716: "Russia / Almetyevsk",
    250777: "Russia / Kaliningrad",
    250800: "WorldWide Mobile",
    250812: "Russia / St. Petersburg",
    250813: "Russia / SPb R7",
    250888: "Russia / Shumerlya (Chuvashia)",
    250907: "Russia / Primorsky Krai (JOTA)",
    250942: "Russia / Kemerovo",
    262: "Germany (National)",
    310: "United States (TAC 310)",
    4000: "Unlink (Disconnect)",
    9990: "Parrot (Echo Test)",
}


# Official DMR+ / IPSC2 Reflectors (4001–4999) and core TS1 TalkGroups
DMRPLUS_SPECIAL_CATALOG: Dict[int, tuple] = {
    4001: ("Reflector 4001 DL (Germany General)", "DMR+ Reflector TS2", "4001 dl germany deutschland германия"),
    4002: ("Reflector 4002 DL (Bavaria / Oberbayern)", "DMR+ Reflector TS2", "4002 dl bavaria bayern бавария"),
    4003: ("Reflector 4003 DL (Baden-Württemberg)", "DMR+ Reflector TS2", "4003 dl baden wuerttemberg"),
    4004: ("Reflector 4004 DL (Berlin / Brandenburg)", "DMR+ Reflector TS2", "4004 dl berlin brandenburg"),
    4005: ("Reflector 4005 DL (Nord / Hamburg)", "DMR+ Reflector TS2", "4005 dl hamburg nord"),
    4006: ("Reflector 4006 DL (Hessen / Rheinland)", "DMR+ Reflector TS2", "4006 dl hessen"),
    4007: ("Reflector 4007 DL (NRW / Ruhrgebiet)", "DMR+ Reflector TS2", "4007 dl nrw ruhr"),
    4008: ("Reflector 4008 DL (Franken / Sachsen)", "DMR+ Reflector TS2", "4008 dl sachsen franken"),
    4009: ("Reflector 4009 DL (Schwaben / Allgäu)", "DMR+ Reflector TS2", "4009 dl schwaben"),
    4010: ("Reflector 4010 DL (Westfalen / Niedersachsen)", "DMR+ Reflector TS2", "4010 dl westfalen"),
    4020: ("Reflector 4020 HB9 (Switzerland German)", "DMR+ Reflector TS2", "4020 hb hb9 switzerland swiss швейцария"),
    4021: ("Reflector 4021 HB9 (Switzerland Romandie)", "DMR+ Reflector TS2", "4021 hb9 romandie francais"),
    4022: ("Reflector 4022 HB9 (Switzerland Ticino)", "DMR+ Reflector TS2", "4022 hb9 ticino"),
    4030: ("Reflector 4030 OE (Austria National)", "DMR+ Reflector TS2", "4030 oe austria австрия"),
    4031: ("Reflector 4031 OE (Wien / Lower Austria)", "DMR+ Reflector TS2", "4031 oe wien"),
    4032: ("Reflector 4032 OE (Steiermark / Kärnten)", "DMR+ Reflector TS2", "4032 oe steiermark"),
    4033: ("Reflector 4033 OE (Tirol / Vorarlberg)", "DMR+ Reflector TS2", "4033 oe tirol"),
    4150: ("Reflector 4150 PA (Netherlands General)", "DMR+ Reflector TS2", "4150 pa netherlands holland нидерланды"),
    4151: ("Reflector 4151 PA (Netherlands North)", "DMR+ Reflector TS2", "4151 pa netherlands north"),
    4180: ("Reflector 4180 ON (Belgium General)", "DMR+ Reflector TS2", "4180 on belgium belgie бельгия"),
    4200: ("Reflector 4200 SV (Greece / Hellas)", "DMR+ Reflector TS2", "4200 sv greece hellas греция"),
    4220: ("Reflector 4220 YU (Serbia)", "DMR+ Reflector TS2", "4220 yu serbia сербия"),
    4240: ("Reflector 4240 SP (Poland National)", "DMR+ Reflector TS2", "4240 sp poland polska польша"),
    4250: ("Reflector 4250 LZ (Bulgaria)", "DMR+ Reflector TS2", "4250 lz bulgaria болгария"),
    4260: ("Reflector 4260 OK (Czech Republic)", "DMR+ Reflector TS2", "4260 ok czech чехия"),
    4270: ("Reflector 4270 HA (Hungary)", "DMR+ Reflector TS2", "4270 ha hungary венгрия"),
    4280: ("Reflector 4280 YO (Romania)", "DMR+ Reflector TS2", "4280 yo romania румыния"),
    4300: ("Reflector 4300 F (France National)", "DMR+ Reflector TS2", "4300 f france франция"),
    4301: ("Reflector 4301 F (France Francophonie)", "DMR+ Reflector TS2", "4301 f francophonie"),
    4350: ("Reflector 4350 I (Italy National)", "DMR+ Reflector TS2", "4350 italy italia италия"),
    4351: ("Reflector 4351 I (Italy Nord)", "DMR+ Reflector TS2", "4351 italy nord"),
    4352: ("Reflector 4352 I (Italy Sud)", "DMR+ Reflector TS2", "4352 italy sud"),
    4400: ("Reflector 4400 UK (United Kingdom Call)", "DMR+ Reflector TS2", "4400 uk gb united kingdom великобритания"),
    4401: ("Reflector 4401 UK (England Regional)", "DMR+ Reflector TS2", "4401 uk england"),
    4402: ("Reflector 4402 UK (Scotland)", "DMR+ Reflector TS2", "4402 uk scotland шотландия"),
    4403: ("Reflector 4403 UK (Wales / Cymru)", "DMR+ Reflector TS2", "4403 uk wales cymru"),
    4450: ("Reflector 4450 OZ (Denmark)", "DMR+ Reflector TS2", "4450 oz denmark дания"),
    4460: ("Reflector 4460 SM (Sweden)", "DMR+ Reflector TS2", "4460 sm sweden швеция"),
    4470: ("Reflector 4470 LA (Norway)", "DMR+ Reflector TS2", "4470 la norway норвегия"),
    4480: ("Reflector 4480 OH (Finland)", "DMR+ Reflector TS2", "4480 oh finland финляндия"),
    4500: ("Reflector 4500 EA (Spain National)", "DMR+ Reflector TS2", "4500 ea spain испания"),
    4501: ("Reflector 4501 EA (Catalunya)", "DMR+ Reflector TS2", "4501 ea catalunya"),
    4502: ("Reflector 4502 EA (Andalucia)", "DMR+ Reflector TS2", "4502 ea andalucia"),
    4510: ("Reflector 4510 CT (Portugal)", "DMR+ Reflector TS2", "4510 ct portugal португалия"),
    4530: ("Reflector 4530 RU (Russia / CIS)", "DMR+ Reflector TS2", "4530 ru russia cis россия снг"),
    4531: ("Reflector 4531 RU (Russia Regional 1)", "DMR+ Reflector TS2", "4531 ru russia регион"),
    4540: ("Reflector 4540 UR (Ukraine)", "DMR+ Reflector TS2", "4540 ur ukraine украина"),
    4550: ("Reflector 4550 TA (Turkey)", "DMR+ Reflector TS2", "4550 ta turkey турция"),
    4600: ("Reflector 4600 VK (Australia National)", "DMR+ Reflector TS2", "4600 vk australia австралия"),
    4620: ("Reflector 4620 ZL (New Zealand)", "DMR+ Reflector TS2", "4620 zl new zealand"),
    4650: ("Reflector 4650 JA (Japan)", "DMR+ Reflector TS2", "4650 ja japan япония"),
    4700: ("Reflector 4700 US (North America)", "DMR+ Reflector TS2", "4700 us usa north america америка сша"),
    4701: ("Reflector 4701 US (East Coast)", "DMR+ Reflector TS2", "4701 us east"),
    4702: ("Reflector 4702 US (Midwest)", "DMR+ Reflector TS2", "4702 us midwest"),
    4703: ("Reflector 4703 US (West Coast)", "DMR+ Reflector TS2", "4703 us west"),
    4704: ("Reflector 4704 US (TAC 1)", "DMR+ Reflector TS2", "4704 us tac"),
    4750: ("Reflector 4750 VE (Canada)", "DMR+ Reflector TS2", "4750 ve canada канада"),
    4770: ("Reflector 4770 XE (Mexico)", "DMR+ Reflector TS2", "4770 xe mexico мексика"),
    4800: ("Reflector 4800 PY (Brazil National)", "DMR+ Reflector TS2", "4800 py pt brazil бразилия"),
    4820: ("Reflector 4820 LU (Argentina)", "DMR+ Reflector TS2", "4820 lu argentina аргентина"),
    4850: ("Reflector 4850 CE (Chile)", "DMR+ Reflector TS2", "4850 ce chile чили"),
    4900: ("Reflector 4900 ZS (South Africa)", "DMR+ Reflector TS2", "4900 zs south africa"),
}


class TGResolver:
    """
    Resolves TalkGroup numbers to human-readable names and descriptions.
    Maintains persistent storage in tg_names_cache.json, automatically fetches
    the master catalog from BrandMeister, and provides fallback by country MCC.
    """

    def __init__(self):
        self.cache: Dict[int, str] = dict(SEED_TALKGROUPS)
        self.tgif_cache: Dict[int, str] = dict(SEED_TGIF_TALKGROUPS)
        self.freedmr_cache: Dict[int, str] = dict(SEED_FREEDMR_TALKGROUPS)
        self.adn_cache: Dict[int, str] = dict(SEED_ADN_TALKGROUPS)
        self._adn_last_sync_ts: float = 0.0
        self._adn_last_failed_ts: float = 0.0
        self._adn_bg_sync_task: Optional[asyncio.Task] = None
        self._adn_fetch_lock: Optional[asyncio.Lock] = None
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._load_cache()
        self._load_tgif_cache()
        self._load_freedmr_cache()
        self._load_adn_cache()
        # Seed MCC country names if not already present
        for mcc, cname in MCC_COUNTRIES.items():
            if mcc not in self.cache:
                self.cache[mcc] = cname
        self._last_check_time = time.time() if (len(self.cache) > 100 and len(self.tgif_cache) > 50 and len(self.freedmr_cache) > 5) else 0

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

    def _load_tgif_cache(self):
        if TGIF_CACHE_FILE.exists():
            try:
                with open(TGIF_CACHE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        try:
                            self.tgif_cache[int(k)] = str(v).strip()
                        except (ValueError, TypeError):
                            pass
                logger.info(f"[TG_RESOLVER] Loaded {len(self.tgif_cache)} cached TGIF TG names from {TGIF_CACHE_FILE}")
            except Exception as e:
                logger.warning(f"[TG_RESOLVER] Could not read TGIF cache file: {e}")

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

    def save_tgif_cache(self):
        try:
            temp_file = TGIF_CACHE_FILE.with_suffix(".tmp")
            out_data = {str(k): v for k, v in sorted(self.tgif_cache.items())}
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(out_data, f, ensure_ascii=False, indent=2)
            temp_file.replace(TGIF_CACHE_FILE)
            logger.info(f"[TG_RESOLVER] Saved {len(self.tgif_cache)} TGIF TG names to {TGIF_CACHE_FILE}")
        except Exception as e:
            logger.error(f"[TG_RESOLVER] Failed to save TGIF cache: {e}")

    async def fetch_tgif_catalog(self) -> int:
        """
        Downloads all talkgroups from TGIF API (https://api.tgif.network/dmr/talkgroups/json
        with fallback to https://api.tgif.network/dmr/talkgroups/csv) and saves to local cache.
        """
        def _fetch():
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            headers = {
                "User-Agent": "ProxDMR/0.1",
                "Accept": "application/json, text/plain, */*"
            }
            try:
                req = urllib.request.Request("https://api.tgif.network/dmr/talkgroups/json", headers=headers)
                with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
                    raw = resp.read().decode("utf-8", errors="replace")
                    data = json.loads(raw)
                    if isinstance(data, list):
                        parsed = {}
                        for item in data:
                            if isinstance(item, dict) and "id" in item and "name" in item:
                                try:
                                    tg_id = int(str(item["id"]).strip())
                                    name = str(item["name"]).strip()
                                    if tg_id > 0 and name:
                                        parsed[tg_id] = name
                                except (ValueError, TypeError):
                                    continue
                        if parsed:
                            return parsed
            except Exception as e:
                logger.warning(f"[TG_RESOLVER] TGIF JSON catalog fetch failed, trying CSV: {e}")

            try:
                req_csv = urllib.request.Request("https://api.tgif.network/dmr/talkgroups/csv", headers=headers)
                with urllib.request.urlopen(req_csv, context=ctx, timeout=10) as resp:
                    raw_csv = resp.read().decode("utf-8", errors="replace")
                    parsed = {}
                    for line in raw_csv.splitlines():
                        parts = line.strip().split(",", 2)
                        if len(parts) >= 2:
                            try:
                                tg_id = int(parts[0].strip())
                                name = parts[1].strip()
                                if tg_id > 0 and name:
                                    parsed[tg_id] = name
                            except (ValueError, TypeError):
                                continue
                    return parsed
            except Exception as e:
                logger.warning(f"[TG_RESOLVER] Failed to download TGIF CSV catalog: {e}")
                return None

        parsed_map = await asyncio.to_thread(_fetch)
        if not parsed_map or not isinstance(parsed_map, dict):
            return 0

        updated_count = 0
        for tg_id, name in parsed_map.items():
            if name and self.tgif_cache.get(tg_id) != name:
                self.tgif_cache[tg_id] = name
                updated_count += 1

        if updated_count > 0 or not TGIF_CACHE_FILE.exists():
            self.save_tgif_cache()
            logger.info(f"[TG_RESOLVER] Synchronized {len(self.tgif_cache)} talkgroups from TGIF catalog ({updated_count} updated)")
        return len(self.tgif_cache)

    def _load_freedmr_cache(self):
        if FREEDMR_CACHE_FILE.exists():
            try:
                with open(FREEDMR_CACHE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        try:
                            self.freedmr_cache[int(k)] = str(v).strip()
                        except (ValueError, TypeError):
                            pass
                logger.info(f"[TG_RESOLVER] Loaded {len(self.freedmr_cache)} cached FreeDMR TG names from {FREEDMR_CACHE_FILE}")
            except Exception as e:
                logger.warning(f"[TG_RESOLVER] Could not read FreeDMR cache file: {e}")

    def save_freedmr_cache(self):
        try:
            temp_file = FREEDMR_CACHE_FILE.with_suffix(".tmp")
            out_data = {str(k): v for k, v in sorted(self.freedmr_cache.items())}
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(out_data, f, ensure_ascii=False, indent=2)
            temp_file.replace(FREEDMR_CACHE_FILE)
            logger.info(f"[TG_RESOLVER] Saved {len(self.freedmr_cache)} FreeDMR TG names to {FREEDMR_CACHE_FILE}")
        except Exception as e:
            logger.error(f"[TG_RESOLVER] Failed to save FreeDMR cache: {e}")

    async def fetch_freedmr_catalog(self) -> int:
        """Downloads all talkgroups from FreeDMR JSON catalog (http://downloads.freedmr.uk/downloads/talkgroup_ids.json)."""
        req = urllib.request.Request(
            FREEDMR_CATALOG_URL,
            headers={"User-Agent": "ProxDMR/1.1", "Accept": "application/json"}
        )

        def _fetch():
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw = resp.read().decode("utf-8", errors="ignore")
                    data = json.loads(raw)
                    items = data.get("results", []) if isinstance(data, dict) else data
                    parsed = {}
                    if isinstance(items, list):
                        for item in items:
                            try:
                                tg_id = int(item.get("tgid") or item.get("id") or 0)
                                name = str(item.get("callsign") or item.get("name") or "").strip()
                                if tg_id > 0 and name:
                                    parsed[tg_id] = name
                            except (ValueError, TypeError):
                                continue
                    return parsed
            except Exception as e:
                logger.warning(f"[TG_RESOLVER] Failed to download FreeDMR JSON catalog: {e}")
                return None

        parsed_map = await asyncio.to_thread(_fetch)
        if not parsed_map or not isinstance(parsed_map, dict):
            return 0

        updated_count = 0
        for tg_id, name in parsed_map.items():
            if name and self.freedmr_cache.get(tg_id) != name:
                self.freedmr_cache[tg_id] = name
                updated_count += 1

        if updated_count > 0 or not FREEDMR_CACHE_FILE.exists():
            self.save_freedmr_cache()
            logger.info(f"[TG_RESOLVER] Synchronized {len(self.freedmr_cache)} talkgroups from FreeDMR catalog ({updated_count} updated)")
        return len(self.freedmr_cache)

    def _get_adn_lock(self) -> asyncio.Lock:
        if self._adn_fetch_lock is None:
            self._adn_fetch_lock = asyncio.Lock()
        return self._adn_fetch_lock

    def _load_adn_cache(self):
        if ADN_CACHE_FILE.exists():
            try:
                with open(ADN_CACHE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                tgs_raw = data.get("talkgroups") if (isinstance(data, dict) and isinstance(data.get("talkgroups"), dict)) else data
                loaded_count = 0
                if isinstance(tgs_raw, dict):
                    for k, v in tgs_raw.items():
                        try:
                            tg_id = int(k)
                            name = str(v).strip()
                            if tg_id > 0 and name:
                                self.adn_cache[tg_id] = name
                                loaded_count += 1
                        except (ValueError, TypeError):
                            pass
                updated_at = float(data.get("updated_at") or 0) if isinstance(data, dict) else 0.0
                if updated_at <= 0 and loaded_count >= 50:
                    updated_at = ADN_CACHE_FILE.stat().st_mtime
                if loaded_count >= 50 and updated_at > 0:
                    self._adn_last_sync_ts = updated_at
                    logger.info(f"[TG_RESOLVER] Loaded {len(self.adn_cache)} cached ADN TG names from {ADN_CACHE_FILE} (updated: {time.ctime(updated_at)})")
                else:
                    self._adn_last_sync_ts = 0.0
            except Exception as e:
                logger.warning(f"[TG_RESOLVER] Could not read ADN cache file: {e}")

    def save_adn_cache(self, sync_ts: Optional[float] = None):
        try:
            ts_val = float(sync_ts if sync_ts is not None else time.time())
            temp_file = ADN_CACHE_FILE.with_suffix(".tmp")
            payload = {
                "status": "ok",
                "source": "live",
                "updated_at": int(ts_val),
                "updated_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts_val)),
                "count": len(self.adn_cache),
                "talkgroups": {str(k): v for k, v in sorted(self.adn_cache.items())},
            }
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            temp_file.replace(ADN_CACHE_FILE)
            logger.info(f"[TG_RESOLVER] Saved {len(self.adn_cache)} ADN TG names to {ADN_CACHE_FILE}")
        except Exception as e:
            logger.error(f"[TG_RESOLVER] Failed to save ADN cache: {e}")

    def needs_adn_sync(self, now: Optional[float] = None) -> bool:
        """Returns True if ADN talkgroups have never been synced or >24h elapsed since last successful sync."""
        ts_now = now if now is not None else time.time()
        if not ADN_CACHE_FILE.exists() or self._adn_last_sync_ts <= 0:
            return True
        if len(self.adn_cache) < 50:
            return True
        return (ts_now - self._adn_last_sync_ts) >= ADN_TG_TTL_SEC

    def is_adn_sync_running(self) -> bool:
        return bool(self._adn_bg_sync_task and not self._adn_bg_sync_task.done())

    def ensure_adn_fresh_background(self) -> bool:
        """
        Non-blocking check on ADN hotspot entry:
        if >24h passed since last successful ADN TG sync (or cache empty), starts background sync.
        """
        now = time.time()
        if not self.needs_adn_sync(now):
            return False
        if self.is_adn_sync_running():
            return True
        if self._adn_last_failed_ts > 0 and (now - self._adn_last_failed_ts) < ADN_TG_RETRY_COOLDOWN_SEC:
            return False
        try:
            loop = asyncio.get_running_loop()
            self._adn_bg_sync_task = loop.create_task(self.fetch_adn_catalog(force=True))
            return True
        except RuntimeError:
            return False

    async def fetch_adn_catalog(self, force: bool = False) -> int:
        """
        Downloads and parses all ADN Systems talkgroups from https://adn.systems/api/talkgroups
        (with HTML fallback to https://adn.systems/talkgroups).
        Updates timestamp and saves adn_tg_names_cache.json ONLY after successful parse.
        """
        now = time.time()
        if not force and not self.needs_adn_sync(now):
            return len(self.adn_cache)

        async with self._get_adn_lock():
            now = time.time()
            if not force and not self.needs_adn_sync(now):
                return len(self.adn_cache)

            def _fetch() -> Optional[Dict[int, str]]:
                headers = {
                    "User-Agent": "ProxDMR/1.2 (+https://github.com/proxDMR)",
                    "Accept": "application/json, text/html, */*",
                }

                def _read_url(u: str) -> Optional[str]:
                    req = urllib.request.Request(u, headers=headers)
                    try:
                        ctx = ssl.create_default_context()
                        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
                            return resp.read().decode("utf-8", errors="ignore")
                    except Exception:
                        try:
                            ctx_nv = ssl.create_default_context()
                            ctx_nv.check_hostname = False
                            ctx_nv.verify_mode = ssl.CERT_NONE
                            with urllib.request.urlopen(req, context=ctx_nv, timeout=15) as resp:
                                return resp.read().decode("utf-8", errors="ignore")
                        except Exception as e2:
                            logger.warning(f"[TG_RESOLVER] ADN download failed ({u}): {e2}")
                            return None

                parsed: Dict[int, str] = {}
                raw_json = _read_url(ADN_TALKGROUPS_API_URL)
                if raw_json:
                    try:
                        data = json.loads(raw_json)
                        items = data.get("talkgroups", data.get("results", data)) if isinstance(data, dict) else data
                        if isinstance(items, list):
                            for item in items:
                                if not isinstance(item, dict):
                                    continue
                                try:
                                    tg_id = int(str(item.get("tgid") or item.get("tg") or item.get("id") or 0).strip())
                                    name = str(item.get("name") or item.get("description") or "").strip()
                                    if tg_id > 0 and name:
                                        parsed[tg_id] = name
                                except (ValueError, TypeError):
                                    continue
                        elif isinstance(items, dict):
                            for k, v in items.items():
                                try:
                                    tg_id = int(str(k).strip())
                                    name = str(v).strip()
                                    if tg_id > 0 and name:
                                        parsed[tg_id] = name
                                except (ValueError, TypeError):
                                    continue
                    except Exception as e:
                        logger.warning(f"[TG_RESOLVER] Failed to parse ADN talkgroups JSON: {e}")

                if len(parsed) < 20:
                    raw_html = _read_url(ADN_TALKGROUPS_PAGE_URL)
                    if raw_html:
                        for tr_html in re.findall(r"<tr[^>]*>(.*?)</tr>", raw_html, flags=re.IGNORECASE | re.DOTALL):
                            cells = [
                                re.sub(r"<[^>]+>", "", c).strip()
                                for c in re.findall(r"<td[^>]*>(.*?)</td>", tr_html, flags=re.IGNORECASE | re.DOTALL)
                            ]
                            if len(cells) >= 2 and cells[0].isdigit() and cells[1]:
                                tg_id = int(cells[0])
                                if tg_id > 0:
                                    parsed[tg_id] = cells[1]

                return parsed if len(parsed) >= 20 else None

            parsed_map = await asyncio.to_thread(_fetch)
            if not parsed_map or not isinstance(parsed_map, dict) or len(parsed_map) < 20:
                self._adn_last_failed_ts = time.time()
                return 0

            # Replace live dictionary while preserving critical control TGs 4000 / 9990 if absent
            new_cache: Dict[int, str] = dict(parsed_map)
            for req_tg, req_name in ((4000, "Unlink (Disconnect)"), (9990, "Parrot (Echo Test)")):
                new_cache.setdefault(req_tg, req_name)
            self.adn_cache = new_cache
            success_ts = time.time()
            self._adn_last_sync_ts = success_ts
            self._adn_last_failed_ts = 0.0
            self.save_adn_cache(success_ts)
            logger.info(f"[TG_RESOLVER] Synchronized {len(self.adn_cache)} talkgroups from adn.systems; timestamp reset to {int(success_ts)}")
            return len(self.adn_cache)

    def get_name(self, tg: int, network_type: str = "bm") -> str:
        """
        Returns the resolved name for a talkgroup synchronously according to network_type.
        """
        net = (network_type or "bm").strip().lower()
        if net == "tgif":
            if tg == 4000:
                return _tg_special_name(4000, fallback="Unlink (Disconnect)")
            if tg == 9990:
                return _tg_special_name(9990, fallback="Parrot (Echo Test)")
            if tg in self.tgif_cache and self.tgif_cache[tg]:
                return self.tgif_cache[tg]
            return f"TG {tg}"

        if net == "freedmr":
            if tg == 4000:
                return _tg_special_name(4000, fallback="Unlink (Disconnect)")
            if tg == 9990:
                return _tg_special_name(9990, fallback="Parrot (Echo Test)")
            if tg in self.freedmr_cache and self.freedmr_cache[tg]:
                return self.freedmr_cache[tg]
            if tg in SEED_TALKGROUPS:
                return _tr(f"tg_catalog.tg_{tg}", fallback=SEED_TALKGROUPS[tg])
            if tg in self.cache and self.cache[tg]:
                return self.cache[tg]
            return self._resolve_by_mcc(tg) or f"TG {tg}"

        if net == "adn":
            self.ensure_adn_fresh_background()
            if tg == 4000:
                return _tg_special_name(4000, fallback="Unlink (Disconnect)")
            if tg == 9990:
                return _tg_special_name(9990, fallback="Parrot (Echo Test)")
            if tg in self.adn_cache and self.adn_cache[tg]:
                return self.adn_cache[tg]
            if tg in SEED_ADN_TALKGROUPS:
                return _tr(f"tg_catalog.tg_{tg}", fallback=SEED_ADN_TALKGROUPS[tg])
            return self._resolve_by_mcc(tg) or f"TG {tg}"

        if net == "xlx":
            if 4001 <= tg <= 4026:
                return _tr("tg_resolver.xlx_module", fallback="Module {letter}", letter=chr(65 + tg - 4001))
            if tg == 4000:
                return _tg_special_name(4000, fallback="Unlink (Disconnect)")
            if tg == 9:
                return _tr("tg_resolver.xlx_reflector_ts2", fallback="Reflector Call (TS2)")
            if tg == 9990:
                return _tg_special_name(9990, fallback="Parrot (Echo Test)")
            return f"TG {tg}"

        if net == "dmrplus":
            if tg in (4000, 5000, 1, 2, 8, 9, 20, 250):
                dmrplus_core = {
                    4000: "Unlink (Disconnect)",
                    5000: "Status (Status Check)",
                    1: "Worldwide",
                    2: "Europe",
                    8: "Regional Net",
                    9: "Local (Voice / Reflector)",
                    20: "DACH (DE/AT/CH)",
                    250: "Russia",
                }
                return _tg_special_name(tg, fallback=dmrplus_core[tg])
            if tg in DMRPLUS_SPECIAL_CATALOG:
                return DMRPLUS_SPECIAL_CATALOG[tg][0]
            dmrplus_countries = {
                262: ("DE", "Germany"),
                208: ("FR", "France"),
                222: ("IT", "Italy"),
                235: ("GB", "United Kingdom"),
                214: ("ES", "Spain"),
                232: ("AT", "Austria"),
                228: ("CH", "Switzerland"),
                260: ("PL", "Poland"),
                204: ("NL", "Netherlands"),
                206: ("BE", "Belgium"),
                202: ("GR", "Greece"),
                284: ("BG", "Bulgaria"),
                255: ("UA", "Ukraine"),
            }
            if tg in dmrplus_countries:
                iso, fb = dmrplus_countries[tg]
                return _i18n_country_name(iso, fallback=fb)
            if tg == 13:
                return _tr("tg_catalog.tg_13", fallback="Worldwide English")
            if 4001 <= tg <= 4999:
                return _tr("tg_resolver.reflector_num", fallback="Reflector {tg}", tg=tg)
            if tg in self.cache and self.cache[tg] and not self.cache[tg].startswith("TG "):
                return self.cache[tg]
            return self._resolve_by_mcc(tg) or f"TG {tg}"

        if tg in SEED_TALKGROUPS:
            return _tr(f"tg_catalog.tg_{tg}", fallback=SEED_TALKGROUPS[tg])

        if tg in self.cache and self.cache[tg]:
            cached = self.cache[tg]
            # Dynamic re-resolution if a stale localized region fallback was persisted on disk
            if not any(
                cached.startswith(p)
                for p in (
                    "Литва / Регион (",
                    "Латвия / Регион (",
                    "Эстония / Регион (",
                    "Украина / Регион (",
                    "Беларусь / Регион (",
                    "Россия / Регион (",
                )
            ):
                if len(str(tg)) == 3 and tg in MCC_ISO_MAP and cached == MCC_COUNTRIES.get(tg):
                    return _i18n_country_name(MCC_ISO_MAP[tg], fallback=cached)
                return cached

        # Check ITU / MCC country resolution dynamically per request language
        name = self._resolve_by_mcc(tg)
        if name:
            return name

        return f"TG {tg}"

    def _resolve_by_mcc(self, tg: int) -> Optional[str]:
        """Resolves country/region by ITU/MCC prefix."""
        s = str(tg)
        # Check 3-digit MCC exact match
        if len(s) == 3 and tg in MCC_COUNTRIES:
            iso = MCC_ISO_MAP.get(tg, "")
            return _i18n_country_name(iso, fallback=MCC_COUNTRIES[tg]) if iso else MCC_COUNTRIES[tg]

        # Check 3-digit prefix for longer TGs (e.g. 2461 -> Lithuania Regional)
        if len(s) >= 4:
            try:
                mcc = int(s[:3])
                if mcc in MCC_COUNTRIES:
                    iso = MCC_ISO_MAP.get(mcc, "")
                    fb_name = MCC_COUNTRIES[mcc].split(" (")[0]
                    cname = _i18n_country_name(iso, fallback=fb_name) if iso else fb_name
                    if mcc in (246, 247, 248, 255, 257, 250):
                        return _tr("tg_resolver.region_tg", fallback="{country} / Region ({tg})", country=cname, tg=tg)
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

    async def resolve_many(self, tgs: List[int], network_type: str = "bm") -> Dict[int, str]:
        """
        Resolves a list of TalkGroups according to network_type.
        """
        net = (network_type or "bm").strip().lower()
        if net == "tgif":
            if len(self.tgif_cache) < 50:
                await self.fetch_tgif_catalog()
            return {tg: self.get_name(tg, "tgif") for tg in tgs}
        if net == "freedmr":
            if len(self.freedmr_cache) < 50:
                await self.fetch_freedmr_catalog()
            return {tg: self.get_name(tg, "freedmr") for tg in tgs}
        if net == "adn":
            if len(self.adn_cache) < 50:
                await self.fetch_adn_catalog(force=True)
            else:
                self.ensure_adn_fresh_background()
            return {tg: self.get_name(tg, "adn") for tg in tgs}
        if net in ("xlx", "dmrplus"):
            return {tg: self.get_name(tg, net) for tg in tgs}

        results = {}
        missing = []
        stale_region_prefixes = (
            "Литва / Регион (",
            "Латвия / Регион (",
            "Эстония / Регион (",
            "Украина / Регион (",
            "Беларусь / Регион (",
            "Россия / Регион (",
        )
        for tg in tgs:
            if tg in SEED_TALKGROUPS:
                results[tg] = _tr(f"tg_catalog.tg_{tg}", fallback=SEED_TALKGROUPS[tg])
            elif tg in self.cache and self.cache[tg] and not self.cache[tg].startswith("TG ") and not any(self.cache[tg].startswith(p) for p in stale_region_prefixes):
                cached = self.cache[tg]
                if len(str(tg)) == 3 and tg in MCC_ISO_MAP and cached == MCC_COUNTRIES.get(tg):
                    results[tg] = _i18n_country_name(MCC_ISO_MAP[tg], fallback=cached)
                else:
                    results[tg] = cached
            else:
                mcc_name = self._resolve_by_mcc(tg)
                if mcc_name:
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
                    fallback = self._resolve_by_mcc(tg)
                    if fallback:
                        results[tg] = fallback
                    else:
                        placeholder = f"TG {tg}"
                        self.cache[tg] = placeholder
                        results[tg] = placeholder

            self.save_cache()

        return results

    def get_all_names(self, network_type: str = "bm") -> Dict[str, str]:
        """Returns all cached TalkGroup mappings as string keys for JSON serialization."""
        net = (network_type or "bm").strip().lower()
        if net == "tgif":
            out = {str(k): (_tg_special_name(k, fallback=v) if k in (4000, 9990) else v) for k, v in self.tgif_cache.items()}
            out.setdefault("4000", _tg_special_name(4000, fallback="Unlink (Disconnect)"))
            out.setdefault("9990", _tg_special_name(9990, fallback="Parrot (Echo Test)"))
            return out
        if net == "freedmr":
            out = {str(k): (_tg_special_name(k, fallback=v) if k in (4000, 9990) else v) for k, v in self.freedmr_cache.items()}
            out.setdefault("4000", _tg_special_name(4000, fallback="Unlink (Disconnect)"))
            out.setdefault("9990", _tg_special_name(9990, fallback="Parrot (Echo Test)"))
            return out
        if net == "adn":
            self.ensure_adn_fresh_background()
            out = {str(k): (_tg_special_name(k, fallback=v) if k in (4000, 9990) else v) for k, v in SEED_ADN_TALKGROUPS.items()}
            for k, v in self.adn_cache.items():
                if v:
                    out[str(k)] = _tg_special_name(k, fallback=v) if k in (4000, 9990) else v
            out.setdefault("4000", _tg_special_name(4000, fallback="Unlink (Disconnect)"))
            out.setdefault("9990", _tg_special_name(9990, fallback="Parrot (Echo Test)"))
            return out
        if net == "xlx":
            xlx_map = {str(4001 + i): _tr("tg_resolver.xlx_module", fallback="Module {letter}", letter=chr(65 + i)) for i in range(26)}
            xlx_map["9"] = _tr("tg_resolver.xlx_reflector_ts2", fallback="Reflector Call (TS2)")
            xlx_map["4000"] = _tg_special_name(4000, fallback="Unlink (Disconnect)")
            xlx_map["9990"] = _tg_special_name(9990, fallback="Parrot (Echo Test)")
            return xlx_map
        if net == "dmrplus":
            dmrplus_map = {
                "1": _tg_special_name(1, fallback="Worldwide"),
                "2": _tg_special_name(2, fallback="Europe"),
                "8": _tg_special_name(8, fallback="Regional Net"),
                "9": _tg_special_name(9, fallback="Local (Voice / Reflector)"),
                "13": _tr("tg_catalog.tg_13", fallback="Worldwide English"),
                "20": _tg_special_name(20, fallback="DACH (DE/AT/CH)"),
                "250": _tg_special_name(250, fallback="Russia"),
                "262": _i18n_country_name("DE", fallback="Germany"),
                "208": _i18n_country_name("FR", fallback="France"),
                "222": _i18n_country_name("IT", fallback="Italy"),
                "235": _i18n_country_name("GB", fallback="United Kingdom"),
                "4000": _tg_special_name(4000, fallback="Unlink (Disconnect)"),
                "5000": _tg_special_name(5000, fallback="Status (Status Check)"),
                "9990": _tg_special_name(9990, fallback="Parrot (Echo Test)"),
            }
            for r_tg, (r_name, _, _) in DMRPLUS_SPECIAL_CATALOG.items():
                dmrplus_map[str(r_tg)] = r_name
            return dmrplus_map
        return {str(k): self.get_name(k, "bm") for k in self.cache}

    def search_talkgroups(self, query: str, limit: int = 50, network_type: str = "bm") -> List[Dict[str, Any]]:
        """
        Searches TalkGroups by TG number, Russian/English name, country, city or alias.
        Adapts catalog to network_type ('bm', 'tgif', 'xlx', 'dmrplus', 'freedmr').
        """
        net = (network_type or "bm").strip().lower()
        q = query.strip().lower()

        if net == "tgif":
            if not q:
                top_tgs = [31665, 777, 2501, 250, 91, 9990, 4000]
                return [
                    {
                        "tg": tg,
                        "name": self.get_name(tg, "tgif"),
                        "country": _tr("tg_resolver.tgif_net", fallback="TGIF Network"),
                        "is_direct": True
                    }
                    for tg in top_tgs
                ]
            exact_m, prefix_m, contains_m = [], [], []
            seen = set()
            if q.isdigit():
                q_num = int(q)
                if q_num in self.tgif_cache:
                    exact_m.append(q_num)
                    seen.add(q_num)
                for tg in self.tgif_cache:
                    if tg in seen:
                        continue
                    s_tg = str(tg)
                    if s_tg.startswith(q):
                        prefix_m.append(tg)
                        seen.add(tg)
                    elif q in s_tg:
                        contains_m.append(tg)
                        seen.add(tg)
            for tg, name in self.tgif_cache.items():
                if tg in seen:
                    continue
                nl = name.lower()
                loc_nl = self.get_name(tg, "tgif").lower()
                if q == nl or q == loc_nl:
                    exact_m.append(tg)
                    seen.add(tg)
                elif nl.startswith(q) or loc_nl.startswith(q):
                    prefix_m.append(tg)
                    seen.add(tg)
                elif q in nl or q in loc_nl:
                    contains_m.append(tg)
                    seen.add(tg)
            matched = exact_m + prefix_m + contains_m
            return [
                {
                    "tg": tg,
                    "name": self.get_name(tg, "tgif"),
                    "country": _tr("tg_resolver.tgif_net", fallback="TGIF Network"),
                    "is_direct": True
                }
                for tg in matched[:limit]
            ]

        if net == "freedmr":
            if not q:
                top_tgs = [91, 92, 250, 2501, 2502, 2503, 2505, 4000, 9990]
                return [
                    {
                        "tg": tg,
                        "name": self.get_name(tg, "freedmr"),
                        "country": _tr("tg_resolver.freedmr_net", fallback="FreeDMR Network"),
                        "is_direct": True
                    }
                    for tg in top_tgs
                ]
            exact_m, prefix_m, contains_m = [], [], []
            seen = set()
            if q.isdigit():
                q_num = int(q)
                if q_num in self.freedmr_cache:
                    exact_m.append(q_num)
                    seen.add(q_num)
                for tg in self.freedmr_cache:
                    if tg in seen:
                        continue
                    s_tg = str(tg)
                    if s_tg.startswith(q):
                        prefix_m.append(tg)
                        seen.add(tg)
                    elif q in s_tg:
                        contains_m.append(tg)
                        seen.add(tg)
            for tg, name in self.freedmr_cache.items():
                if tg in seen:
                    continue
                nl = name.lower()
                loc_nl = self.get_name(tg, "freedmr").lower()
                if q == nl or q == loc_nl:
                    exact_m.append(tg)
                    seen.add(tg)
                elif nl.startswith(q) or loc_nl.startswith(q):
                    prefix_m.append(tg)
                    seen.add(tg)
                elif q in nl or q in loc_nl:
                    contains_m.append(tg)
                    seen.add(tg)
            matched = exact_m + prefix_m + contains_m
            return [
                {
                    "tg": tg,
                    "name": self.get_name(tg, "freedmr"),
                    "country": _tr("tg_resolver.freedmr_net", fallback="FreeDMR Network"),
                    "is_direct": True
                }
                for tg in matched[:limit]
            ]

        if net == "adn":
            self.ensure_adn_fresh_background()
            if not q:
                top_tgs = [91, 92, 93, 250, 2501, 2502, 2503, 2504, 2505, 4000, 9990, 262, 3100]
                return [
                    {
                        "tg": tg,
                        "name": self.get_name(tg, "adn"),
                        "country": _tr("tg_resolver.adn_net", fallback="ADN Systems"),
                        "is_direct": True
                    }
                    for tg in top_tgs
                ]
            exact_m, prefix_m, contains_m = [], [], []
            seen = set()
            pool_dict = dict(SEED_ADN_TALKGROUPS)
            pool_dict.update(self.adn_cache)
            if q.isdigit():
                q_num = int(q)
                if q_num in pool_dict:
                    exact_m.append(q_num)
                    seen.add(q_num)
                for tg in pool_dict:
                    if tg in seen:
                        continue
                    s_tg = str(tg)
                    if s_tg.startswith(q):
                        prefix_m.append(tg)
                        seen.add(tg)
                    elif q in s_tg:
                        contains_m.append(tg)
                        seen.add(tg)
            for tg, name in pool_dict.items():
                if tg in seen:
                    continue
                nl = name.lower()
                loc_nl = self.get_name(tg, "adn").lower()
                if q == nl or q == loc_nl:
                    exact_m.append(tg)
                    seen.add(tg)
                elif nl.startswith(q) or loc_nl.startswith(q):
                    prefix_m.append(tg)
                    seen.add(tg)
                elif q in nl or q in loc_nl:
                    contains_m.append(tg)
                    seen.add(tg)
            matched = exact_m + prefix_m + contains_m
            return [
                {
                    "tg": tg,
                    "name": self.get_name(tg, "adn"),
                    "country": _tr("tg_resolver.adn_net", fallback="ADN Systems"),
                    "is_direct": True
                }
                for tg in matched[:limit]
            ]

        if net == "xlx":
            xlx_items = [
                (9, _tr("tg_resolver.xlx_reflector_ts2", fallback="Reflector Call (TS2)"), "reflector call (ts2)"),
                (4000, _tg_special_name(4000, fallback="Unlink (Disconnect)"), "unlink отключение disconnect"),
            ] + [
                (4001 + i, _tr("tg_resolver.xlx_module", fallback="Module {letter}", letter=chr(65 + i)), f"module {chr(65 + i).lower()}")
                for i in range(26)
            ]
            xlx_country = _tr("tg_resolver.xlx_reflector", fallback="XLX Reflector")
            results = []
            for tg, name, raw_kw in xlx_items:
                if not q or q in str(tg) or q in name.lower() or q in raw_kw:
                    results.append({
                        "tg": tg,
                        "name": name,
                        "country": xlx_country,
                        "is_direct": True
                    })
            return results[:limit]

        if net == "dmrplus":
            cat_refl_ts2 = _tr("tg_resolver.dmrplus_refl_ts2", fallback="DMR+ Reflector TS2")
            cat_ts1 = _tr("tg_resolver.dmrplus_ts1", fallback="DMR+ TS1")
            cat_local = _tr("tg_resolver.dmrplus_local", fallback="DMR+ Local")
            cat_net = _tr("tg_resolver.dmrplus_net", fallback="DMR+ Network")
            dmrplus_items = [
                (4530, DMRPLUS_SPECIAL_CATALOG[4530][0], cat_refl_ts2, DMRPLUS_SPECIAL_CATALOG[4530][2]),
                (4001, DMRPLUS_SPECIAL_CATALOG[4001][0], cat_refl_ts2, DMRPLUS_SPECIAL_CATALOG[4001][2]),
                (4030, DMRPLUS_SPECIAL_CATALOG[4030][0], cat_refl_ts2, DMRPLUS_SPECIAL_CATALOG[4030][2]),
                (4020, DMRPLUS_SPECIAL_CATALOG[4020][0], cat_refl_ts2, DMRPLUS_SPECIAL_CATALOG[4020][2]),
                (4400, DMRPLUS_SPECIAL_CATALOG[4400][0], cat_refl_ts2, DMRPLUS_SPECIAL_CATALOG[4400][2]),
                (4500, DMRPLUS_SPECIAL_CATALOG[4500][0], cat_refl_ts2, DMRPLUS_SPECIAL_CATALOG[4500][2]),
                (4700, DMRPLUS_SPECIAL_CATALOG[4700][0], cat_refl_ts2, DMRPLUS_SPECIAL_CATALOG[4700][2]),
                (4800, DMRPLUS_SPECIAL_CATALOG[4800][0], cat_refl_ts2, DMRPLUS_SPECIAL_CATALOG[4800][2]),
                (4000, _tg_special_name(4000, fallback="Unlink (Disconnect)"), cat_refl_ts2, "unlink disconnect отключение рефлектора"),
                (5000, _tg_special_name(5000, fallback="Status (Status Check)"), cat_refl_ts2, "status check проверка статуса"),
                (1, _tg_special_name(1, fallback="Worldwide"), cat_ts1, "worldwide"),
                (2, _tg_special_name(2, fallback="Europe"), cat_ts1, "europe"),
                (13, _tr("tg_catalog.tg_13", fallback="Worldwide English"), cat_ts1, "worldwide english"),
                (20, _tg_special_name(20, fallback="DACH (DE/AT/CH)"), cat_ts1, "dach germany austria switzerland германия австрия швейцария"),
                (250, _tg_special_name(250, fallback="Russia"), cat_ts1, "russia россия национальная группа"),
                (262, _i18n_country_name("DE", fallback="Germany"), cat_ts1, "germany"),
                (208, _i18n_country_name("FR", fallback="France"), cat_ts1, "france"),
                (222, _i18n_country_name("IT", fallback="Italy"), cat_ts1, "italy"),
                (235, _i18n_country_name("GB", fallback="United Kingdom"), cat_ts1, "united kingdom"),
                (8, _tg_special_name(8, fallback="Regional Net"), cat_ts1, "regional net"),
                (9, _tg_special_name(9, fallback="Local (Voice / Reflector)"), cat_local, "local voice ts2 ts1 reflector"),
                (9990, _tg_special_name(9990, fallback="Parrot (Echo Test)"), cat_local, "parrot echo тест"),
            ]
            seen_dmrp = {row[0] for row in dmrplus_items}
            for r_tg, (r_name, _, r_kw) in DMRPLUS_SPECIAL_CATALOG.items():
                if r_tg not in seen_dmrp:
                    dmrplus_items.append((r_tg, r_name, cat_refl_ts2, r_kw))
                    seen_dmrp.add(r_tg)
            results = []
            for tg, name, cat, raw_kw in dmrplus_items:
                if not q or q in str(tg) or q in name.lower() or q in raw_kw:
                    results.append({
                        "tg": tg,
                        "name": name,
                        "country": cat,
                        "is_direct": True
                    })
            if q and q.isdigit():
                q_num = int(q)
                if not any(r["tg"] == q_num for r in results):
                    res_name = self.get_name(q_num, "dmrplus")
                    cat = cat_refl_ts2 if 4001 <= q_num <= 4999 else cat_net
                    results.insert(0, {
                        "tg": q_num,
                        "name": res_name,
                        "country": cat,
                        "is_direct": True
                    })
            return results[:limit]

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
            if q_num in self.cache or q_num in SEED_TALKGROUPS:
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

        # Check textual names in cache, localized catalog & MCC countries
        for tg, name in self.cache.items():
            if tg in seen_tgs:
                continue
            nl = name.lower()
            loc_nl = _tr(f"tg_catalog.tg_{tg}", fallback=SEED_TALKGROUPS[tg]).lower() if tg in SEED_TALKGROUPS else nl
            country_name = self._get_country_name(tg).lower()
            if q == nl or q == loc_nl or q == country_name:
                exact_matches.append(tg)
                seen_tgs.add(tg)
            elif nl.startswith(q) or loc_nl.startswith(q) or country_name.startswith(q):
                prefix_matches.append(tg)
                seen_tgs.add(tg)
            elif q in nl or q in loc_nl or q in country_name:
                contains_matches.append(tg)
                seen_tgs.add(tg)

        # Check MCC Countries mapping directly
        for mcc, cname in MCC_COUNTRIES.items():
            if mcc in seen_tgs:
                continue
            cnl = cname.lower()
            iso = MCC_ISO_MAP.get(mcc, "")
            loc_cnl = _i18n_country_name(iso, fallback=cname).lower() if iso else cnl
            if q in cnl or q in loc_cnl:
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
            return _tr("tg_resolver.global", fallback="International (Global)")
        if tg == 9990:
            return _tr("tg_resolver.service_audio_test", fallback="Service (Audio Test)")
        if len(s) == 3 and tg in MCC_COUNTRIES:
            iso = MCC_ISO_MAP.get(tg, "")
            return _i18n_country_name(iso, fallback=MCC_COUNTRIES[tg]) if iso else MCC_COUNTRIES[tg]
        if len(s) >= 4:
            try:
                mcc = int(s[:3])
                if mcc in MCC_COUNTRIES:
                    iso = MCC_ISO_MAP.get(mcc, "")
                    return _i18n_country_name(iso, fallback=MCC_COUNTRIES[mcc]) if iso else MCC_COUNTRIES[mcc]
            except Exception:
                pass
        return ""

    async def check_and_update(self, interval_seconds: int = 10800) -> bool:
        """
        Periodically checks and refreshes BrandMeister, TGIF, FreeDMR, and (when already initialized) stale ADN catalogs.
        """
        now = time.time()
        if not hasattr(self, "_last_check_time"):
            self._last_check_time = 0
        adn_stale = ADN_CACHE_FILE.exists() and self.needs_adn_sync(now)
        if (now - self._last_check_time) >= interval_seconds or len(self.tgif_cache) < 50 or len(self.freedmr_cache) < 50 or adn_stale:
            logger.info("[TG_RESOLVER] Performing scheduled check of BrandMeister, TGIF, FreeDMR and ADN catalogs...")
            try:
                count_bm = await self.fetch_master_catalog()
                count_tgif = await self.fetch_tgif_catalog()
                count_freedmr = await self.fetch_freedmr_catalog()
                count_adn = await self.fetch_adn_catalog(force=False) if adn_stale else 0
                self._last_check_time = now
                return (count_bm + count_tgif + count_freedmr + count_adn) > 0
            except Exception as e:
                logger.error(f"[TG_RESOLVER] Failed scheduled check: {e}")
                self._last_check_time = now
                return False
        return False

    def get_stats(self, network_type: str = "bm") -> Dict[str, Any]:
        net = (network_type or "bm").strip().lower()
        if net == "xlx":
            return {
                "count": 28,
                "network": "xlx",
                "updated_ts": time.time(),
                "updated_str": _tr("tg_resolver.xlx_modules", fallback="XLX Modules A–Z (4001–4026)")
            }
        if net == "dmrplus":
            return {
                "count": len(DMRPLUS_SPECIAL_CATALOG) + 14,
                "network": "dmrplus",
                "updated_ts": time.time(),
                "updated_str": _tr("tg_resolver.dmrplus_catalog", fallback="DMR+ / IPSC2 Reflectors & TG")
            }
        if net == "freedmr":
            count = len(self.freedmr_cache)
            updated_ts = 0.0
            if FREEDMR_CACHE_FILE.exists():
                try:
                    updated_ts = FREEDMR_CACHE_FILE.stat().st_mtime
                except Exception:
                    pass
            return {
                "count": count,
                "network": "freedmr",
                "updated_ts": updated_ts,
                "updated_str": time.strftime("%d.%m.%Y %H:%M", time.localtime(updated_ts)) if updated_ts else _tr("tg_resolver.freedmr_db", fallback="FreeDMR DB")
            }
        if net == "adn":
            self.ensure_adn_fresh_background()
            count = len(set(list(self.adn_cache.keys()) + list(SEED_ADN_TALKGROUPS.keys())))
            updated_ts = float(self._adn_last_sync_ts or 0.0)
            if updated_ts <= 0 and ADN_CACHE_FILE.exists():
                try:
                    updated_ts = ADN_CACHE_FILE.stat().st_mtime
                except Exception:
                    pass
            return {
                "count": count,
                "network": "adn",
                "updated_ts": updated_ts,
                "sync_in_progress": self.is_adn_sync_running(),
                "updated_str": time.strftime("%d.%m.%Y %H:%M", time.localtime(updated_ts)) if updated_ts else _tr("tg_resolver.adn_db", fallback="ADN / HBlink DB")
            }
        if net == "tgif":
            count = len(self.tgif_cache)
            updated_ts = 0.0
            if TGIF_CACHE_FILE.exists():
                try:
                    updated_ts = TGIF_CACHE_FILE.stat().st_mtime
                except Exception:
                    pass
            return {
                "count": count,
                "network": "tgif",
                "updated_ts": updated_ts,
                "updated_str": time.strftime("%d.%m.%Y %H:%M", time.localtime(updated_ts)) if updated_ts else _tr("tg_resolver.tgif_db", fallback="TGIF DB")
            }
        count = len(self.cache)
        updated_ts = 0.0
        if TG_CACHE_FILE.exists():
            try:
                updated_ts = TG_CACHE_FILE.stat().st_mtime
            except Exception:
                pass
        return {
            "count": count,
            "network": net,
            "updated_ts": updated_ts,
            "updated_str": time.strftime("%d.%m.%Y %H:%M", time.localtime(updated_ts)) if updated_ts else _tr("tg_resolver.builtin_db", fallback="Built-in DB")
        }


# Global singleton instance
tg_resolver = TGResolver()
