  // --- Country & Callsign Flag Resolution (Full ITU Appendix 42 + E.212 MCC + Name Fallback) ---
  const GLOBAL_COUNTRY_INFO = { name: "Global", name_en: "", flag: "🌐" };

  function _isoToRegionFlag(isoCode) {
    const clean = String(isoCode || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(clean)) return "🌐";
    try {
      return String.fromCodePoint(127397 + clean.charCodeAt(0), 127397 + clean.charCodeAt(1));
    } catch (_) {
      return "🌐";
    }
  }

  export const ITU_COUNTRY_META = {
    ad: { ru: "Андорра", en: "Andorra" },
    ae: { ru: "ОАЭ", en: "United Arab Emirates" },
    af: { ru: "Афганистан", en: "Afghanistan" },
    ag: { ru: "Антигуа и Барбуда", en: "Antigua and Barbuda" },
    ai: { ru: "Ангилья", en: "Anguilla" },
    al: { ru: "Албания", en: "Albania" },
    am: { ru: "Армения", en: "Armenia" },
    ao: { ru: "Ангола", en: "Angola" },
    aq: { ru: "Антарктида", en: "Antarctica" },
    ar: { ru: "Аргентина", en: "Argentina" },
    as: { ru: "Американское Самоа", en: "American Samoa" },
    at: { ru: "Австрия", en: "Austria" },
    au: { ru: "Австралия", en: "Australia" },
    aw: { ru: "Аруба", en: "Aruba" },
    ax: { ru: "Аландские о-ва", en: "Åland Islands" },
    az: { ru: "Азербайджан", en: "Azerbaijan" },
    ba: { ru: "Босния и Герцеговина", en: "Bosnia and Herzegovina" },
    bb: { ru: "Барбадос", en: "Barbados" },
    bd: { ru: "Бангладеш", en: "Bangladesh" },
    be: { ru: "Бельгия", en: "Belgium" },
    bf: { ru: "Буркина-Фасо", en: "Burkina Faso" },
    bg: { ru: "Болгария", en: "Bulgaria" },
    bh: { ru: "Бахрейн", en: "Bahrain" },
    bi: { ru: "Бурунди", en: "Burundi" },
    bj: { ru: "Бенин", en: "Benin" },
    bl: { ru: "Сен-Бартелеми", en: "Saint Barthélemy" },
    bm: { ru: "Бермуды", en: "Bermuda" },
    bn: { ru: "Бруней", en: "Brunei" },
    bo: { ru: "Боливия", en: "Bolivia" },
    bq: { ru: "Бонэйр, Синт-Эстатиус и Саба", en: "Caribbean Netherlands" },
    br: { ru: "Бразилия", en: "Brazil" },
    bs: { ru: "Багамы", en: "Bahamas" },
    bt: { ru: "Бутан", en: "Bhutan" },
    bv: { ru: "Остров Буве", en: "Bouvet Island" },
    bw: { ru: "Ботсвана", en: "Botswana" },
    by: { ru: "Беларусь", en: "Belarus" },
    bz: { ru: "Белиз", en: "Belize" },
    ca: { ru: "Канада", en: "Canada" },
    cc: { ru: "Кокосовые о-ва", en: "Cocos (Keeling) Islands" },
    cd: { ru: "ДР Конго", en: "DR Congo" },
    cf: { ru: "ЦАР", en: "Central African Republic" },
    cg: { ru: "Республика Конго", en: "Republic of the Congo" },
    ch: { ru: "Швейцария", en: "Switzerland" },
    ci: { ru: "Кот-д'Ивуар", en: "Côte d'Ivoire" },
    ck: { ru: "Острова Кука", en: "Cook Islands" },
    cl: { ru: "Чили", en: "Chile" },
    cm: { ru: "Камерун", en: "Cameroon" },
    cn: { ru: "Китай", en: "China" },
    co: { ru: "Колумбия", en: "Colombia" },
    cr: { ru: "Коста-Рика", en: "Costa Rica" },
    cu: { ru: "Куба", en: "Cuba" },
    cv: { ru: "Кабо-Верде", en: "Cabo Verde" },
    cw: { ru: "Кюрасао", en: "Curaçao" },
    cx: { ru: "Остров Рождества", en: "Christmas Island" },
    cy: { ru: "Кипр", en: "Cyprus" },
    cz: { ru: "Чехия", en: "Czechia" },
    de: { ru: "Германия", en: "Germany" },
    dj: { ru: "Джибути", en: "Djibouti" },
    dk: { ru: "Дания", en: "Denmark" },
    dm: { ru: "Доминика", en: "Dominica" },
    do: { ru: "Доминикана", en: "Dominican Republic" },
    dz: { ru: "Алжир", en: "Algeria" },
    ec: { ru: "Эквадор", en: "Ecuador" },
    ee: { ru: "Эстония", en: "Estonia" },
    eg: { ru: "Египет", en: "Egypt" },
    eh: { ru: "Западная Сахара", en: "Western Sahara" },
    er: { ru: "Эритрея", en: "Eritrea" },
    es: { ru: "Испания", en: "Spain" },
    et: { ru: "Эфиопия", en: "Ethiopia" },
    fi: { ru: "Финляндия", en: "Finland" },
    fj: { ru: "Фиджи", en: "Fiji" },
    fk: { ru: "Фолклендские о-ва", en: "Falkland Islands" },
    fm: { ru: "Микронезия", en: "Micronesia" },
    fo: { ru: "Фарерские о-ва", en: "Faroe Islands" },
    fr: { ru: "Франция", en: "France" },
    ga: { ru: "Габон", en: "Gabon" },
    gb: { ru: "Великобритания", en: "United Kingdom" },
    gd: { ru: "Гренада", en: "Grenada" },
    ge: { ru: "Грузия", en: "Georgia" },
    gf: { ru: "Французская Гвиана", en: "French Guiana" },
    gg: { ru: "Гернси", en: "Guernsey" },
    gh: { ru: "Гана", en: "Ghana" },
    gi: { ru: "Гибралтар", en: "Gibraltar" },
    gl: { ru: "Гренландия", en: "Greenland" },
    gm: { ru: "Гамбия", en: "Gambia" },
    gn: { ru: "Гвинея", en: "Guinea" },
    gp: { ru: "Гваделупа", en: "Guadeloupe" },
    gq: { ru: "Экваториальная Гвинея", en: "Equatorial Guinea" },
    gr: { ru: "Греция", en: "Greece" },
    gs: { ru: "Южная Георгия", en: "South Georgia & South Sandwich Islands" },
    gt: { ru: "Гватемала", en: "Guatemala" },
    gu: { ru: "Гуам", en: "Guam" },
    gw: { ru: "Гвинея-Бисау", en: "Guinea-Bissau" },
    gy: { ru: "Гайана", en: "Guyana" },
    hk: { ru: "Гонконг", en: "Hong Kong" },
    hm: { ru: "Острова Херд и Макдональд", en: "Heard & McDonald Islands" },
    hn: { ru: "Гондурас", en: "Honduras" },
    hr: { ru: "Хорватия", en: "Croatia" },
    ht: { ru: "Гаити", en: "Haiti" },
    hu: { ru: "Венгрия", en: "Hungary" },
    id: { ru: "Индонезия", en: "Indonesia" },
    ie: { ru: "Ирландия", en: "Ireland" },
    il: { ru: "Израиль", en: "Israel" },
    im: { ru: "Остров Мэн", en: "Isle of Man" },
    in: { ru: "Индия", en: "India" },
    io: { ru: "Брит. терр. в Инд. океане", en: "British Indian Ocean Territory" },
    iq: { ru: "Ирак", en: "Iraq" },
    ir: { ru: "Иран", en: "Iran" },
    is: { ru: "Исландия", en: "Iceland" },
    it: { ru: "Италия", en: "Italy" },
    je: { ru: "Джерси", en: "Jersey" },
    jm: { ru: "Ямайка", en: "Jamaica" },
    jo: { ru: "Иордания", en: "Jordan" },
    jp: { ru: "Япония", en: "Japan" },
    ke: { ru: "Кения", en: "Kenya" },
    kg: { ru: "Кыргызстан", en: "Kyrgyzstan" },
    kh: { ru: "Камбоджа", en: "Cambodia" },
    ki: { ru: "Кирибати", en: "Kiribati" },
    km: { ru: "Коморы", en: "Comoros" },
    kn: { ru: "Сент-Китс и Невис", en: "Saint Kitts and Nevis" },
    kp: { ru: "КНДР", en: "North Korea" },
    kr: { ru: "Южная Корея", en: "South Korea" },
    kw: { ru: "Кувейт", en: "Kuwait" },
    ky: { ru: "Каймановы о-ва", en: "Cayman Islands" },
    kz: { ru: "Казахстан", en: "Kazakhstan" },
    la: { ru: "Лаос", en: "Laos" },
    lb: { ru: "Ливан", en: "Lebanon" },
    lc: { ru: "Сент-Люсия", en: "Saint Lucia" },
    li: { ru: "Лихтенштейн", en: "Liechtenstein" },
    lk: { ru: "Шри-Ланка", en: "Sri Lanka" },
    lr: { ru: "Либерия", en: "Liberia" },
    ls: { ru: "Лесото", en: "Lesotho" },
    lt: { ru: "Литва", en: "Lithuania" },
    lu: { ru: "Люксембург", en: "Luxembourg" },
    lv: { ru: "Латвия", en: "Latvia" },
    ly: { ru: "Ливия", en: "Libya" },
    ma: { ru: "Марокко", en: "Morocco" },
    mc: { ru: "Монако", en: "Monaco" },
    md: { ru: "Молдова", en: "Moldova" },
    me: { ru: "Черногория", en: "Montenegro" },
    mf: { ru: "Сен-Мартен", en: "Saint Martin" },
    mg: { ru: "Мадагаскар", en: "Madagascar" },
    mh: { ru: "Маршалловы Острова", en: "Marshall Islands" },
    mk: { ru: "Северная Македония", en: "North Macedonia" },
    ml: { ru: "Мали", en: "Mali" },
    mm: { ru: "Мьянма", en: "Myanmar" },
    mn: { ru: "Монголия", en: "Mongolia" },
    mo: { ru: "Макао", en: "Macau" },
    mp: { ru: "Северные Марианские о-ва", en: "Northern Mariana Islands" },
    mq: { ru: "Мартиника", en: "Martinique" },
    mr: { ru: "Мавритания", en: "Mauritania" },
    ms: { ru: "Монтсеррат", en: "Montserrat" },
    mt: { ru: "Мальта", en: "Malta" },
    mu: { ru: "Маврикий", en: "Mauritius" },
    mv: { ru: "Мальдивы", en: "Maldives" },
    mw: { ru: "Малави", en: "Malawi" },
    mx: { ru: "Мексика", en: "Mexico" },
    my: { ru: "Малайзия", en: "Malaysia" },
    mz: { ru: "Мозамбик", en: "Mozambique" },
    na: { ru: "Намибия", en: "Namibia" },
    nc: { ru: "Новая Каледония", en: "New Caledonia" },
    ne: { ru: "Нигер", en: "Niger" },
    nf: { ru: "Остров Норфолк", en: "Norfolk Island" },
    ng: { ru: "Нигерия", en: "Nigeria" },
    ni: { ru: "Никарагуа", en: "Nicaragua" },
    nl: { ru: "Нидерланды", en: "Netherlands" },
    no: { ru: "Норвегия", en: "Norway" },
    np: { ru: "Непал", en: "Nepal" },
    nr: { ru: "Науру", en: "Nauru" },
    nu: { ru: "Ниуэ", en: "Niue" },
    nz: { ru: "Новая Зеландия", en: "New Zealand" },
    om: { ru: "Оман", en: "Oman" },
    pa: { ru: "Панама", en: "Panama" },
    pe: { ru: "Перу", en: "Peru" },
    pf: { ru: "Французская Полинезия", en: "French Polynesia" },
    pg: { ru: "Папуа — Новая Гвинея", en: "Papua New Guinea" },
    ph: { ru: "Филиппины", en: "Philippines" },
    pk: { ru: "Пакистан", en: "Pakistan" },
    pl: { ru: "Польша", en: "Poland" },
    pm: { ru: "Сен-Пьер и Микелон", en: "Saint Pierre and Miquelon" },
    pn: { ru: "Острова Питкэрн", en: "Pitcairn Islands" },
    pr: { ru: "Пуэрто-Рико", en: "Puerto Rico" },
    ps: { ru: "Палестина", en: "Palestine" },
    pt: { ru: "Португалия", en: "Portugal" },
    pw: { ru: "Палау", en: "Palau" },
    py: { ru: "Парагвай", en: "Paraguay" },
    qa: { ru: "Катар", en: "Qatar" },
    re: { ru: "Реюньон", en: "Réunion" },
    ro: { ru: "Румыния", en: "Romania" },
    rs: { ru: "Сербия", en: "Serbia" },
    ru: { ru: "Россия", en: "Russia" },
    rw: { ru: "Руанда", en: "Rwanda" },
    sa: { ru: "Саудовская Аравия", en: "Saudi Arabia" },
    sb: { ru: "Соломоновы Острова", en: "Solomon Islands" },
    sc: { ru: "Сейшелы", en: "Seychelles" },
    sd: { ru: "Судан", en: "Sudan" },
    se: { ru: "Швеция", en: "Sweden" },
    sg: { ru: "Сингапур", en: "Singapore" },
    sh: { ru: "О-ва Св. Елены, Вознес. и Тристан", en: "Saint Helena" },
    si: { ru: "Словения", en: "Slovenia" },
    sj: { ru: "Шпицберген и Ян-Майен", en: "Svalbard and Jan Mayen" },
    sk: { ru: "Словакия", en: "Slovakia" },
    sl: { ru: "Сьерра-Леоне", en: "Sierra Leone" },
    sm: { ru: "Сан-Марино", en: "San Marino" },
    sn: { ru: "Сенегал", en: "Senegal" },
    so: { ru: "Сомали", en: "Somalia" },
    sr: { ru: "Суринам", en: "Suriname" },
    ss: { ru: "Южный Судан", en: "South Sudan" },
    st: { ru: "Сан-Томе и Принсипи", en: "São Tomé and Príncipe" },
    sv: { ru: "Сальвадор", en: "El Salvador" },
    sx: { ru: "Синт-Мартен", en: "Sint Maarten" },
    sy: { ru: "Сирия", en: "Syria" },
    sz: { ru: "Эсватини", en: "Eswatini" },
    tc: { ru: "Теркс и Кайкос", en: "Turks and Caicos Islands" },
    td: { ru: "Чад", en: "Chad" },
    tf: { ru: "Франц. Южные и Антаркт. терр.", en: "French Southern Territories" },
    tg: { ru: "Того", en: "Togo" },
    th: { ru: "Таиланд", en: "Thailand" },
    tj: { ru: "Таджикистан", en: "Tajikistan" },
    tk: { ru: "Токелау", en: "Tokelau" },
    tl: { ru: "Восточный Тимор", en: "Timor-Leste" },
    tm: { ru: "Туркменистан", en: "Turkmenistan" },
    tn: { ru: "Тунис", en: "Tunisia" },
    to: { ru: "Тонга", en: "Tonga" },
    tr: { ru: "Турция", en: "Turkey" },
    tt: { ru: "Тринидад и Тобаго", en: "Trinidad and Tobago" },
    tv: { ru: "Тувалу", en: "Tuvalu" },
    tw: { ru: "Тайвань", en: "Taiwan" },
    tz: { ru: "Танзания", en: "Tanzania" },
    ua: { ru: "Украина", en: "Ukraine" },
    ug: { ru: "Уганда", en: "Uganda" },
    un: { ru: "ООН (UN)", en: "United Nations" },
    us: { ru: "США", en: "USA" },
    uy: { ru: "Уругвай", en: "Uruguay" },
    uz: { ru: "Узбекистан", en: "Uzbekistan" },
    va: { ru: "Ватикан", en: "Vatican City" },
    vc: { ru: "Сент-Винсент и Гренадины", en: "Saint Vincent and the Grenadines" },
    ve: { ru: "Венесуэла", en: "Venezuela" },
    vg: { ru: "Британские Виргинские о-ва", en: "British Virgin Islands" },
    vi: { ru: "Американские Виргинские о-ва", en: "US Virgin Islands" },
    vn: { ru: "Вьетнам", en: "Vietnam" },
    vu: { ru: "Вануату", en: "Vanuatu" },
    wf: { ru: "Уоллис и Футуна", en: "Wallis and Futuna" },
    ws: { ru: "Самоа", en: "Samoa" },
    xk: { ru: "Косово", en: "Kosovo" },
    ye: { ru: "Йемен", en: "Yemen" },
    yt: { ru: "Майотта", en: "Mayotte" },
    za: { ru: "ЮАР", en: "South Africa" },
    zm: { ru: "Замбия", en: "Zambia" },
    zw: { ru: "Зимбабве", en: "Zimbabwe" }
  };

  const _COUNTRY_ENTRY_BY_ISO = (() => {
    const map = Object.create(null);
    for (const [iso, meta] of Object.entries(ITU_COUNTRY_META)) {
      map[iso] = {
        iso,
        name: meta.ru,
        name_en: meta.en,
        flag: _isoToRegionFlag(iso)
      };
    }
    return map;
  })();

  const _MCC_ISO_CODES = {
    "202": "gr", "204": "nl", "206": "be", "208": "fr", "212": "mc", "213": "ad", "214": "es",
    "216": "hu", "218": "ba", "219": "hr", "220": "rs", "221": "xk", "222": "it", "225": "va",
    "226": "ro", "228": "ch", "230": "cz", "231": "sk", "232": "at", "234": "gb", "235": "gb",
    "238": "dk", "239": "gr", "240": "se", "242": "no", "244": "fi", "246": "lt", "247": "lv",
    "248": "ee", "250": "ru", "255": "ua", "257": "by", "259": "md", "260": "pl", "262": "de",
    "263": "de", "264": "de", "265": "de", "266": "gi", "268": "pt", "270": "lu", "272": "ie",
    "274": "is", "276": "al", "278": "mt", "280": "cy", "282": "ge", "283": "am", "284": "bg",
    "286": "tr", "288": "fo", "290": "gl", "292": "sm", "293": "si", "294": "mk", "295": "li",
    "297": "me", "302": "ca", "308": "pm", "310": "us", "311": "us", "312": "us", "313": "us",
    "314": "us", "315": "us", "316": "us", "330": "pr", "332": "vi", "334": "mx", "338": "jm",
    "340": "gp", "342": "bb", "344": "ag", "346": "ky", "348": "vg", "350": "bm", "352": "gd",
    "354": "ms", "356": "kn", "358": "lc", "360": "vc", "362": "cw", "363": "aw", "364": "bs",
    "365": "ai", "366": "dm", "368": "cu", "370": "do", "372": "ht", "374": "tt", "376": "tc",
    "400": "az", "401": "kz", "402": "bt", "404": "in", "405": "in", "406": "in", "410": "pk",
    "412": "af", "413": "lk", "414": "mm", "415": "lb", "416": "jo", "417": "sy", "418": "iq",
    "419": "kw", "420": "sa", "421": "ye", "422": "om", "424": "ae", "425": "il", "426": "bh",
    "427": "qa", "428": "mn", "429": "np", "430": "ae", "431": "ae", "432": "ir", "434": "uz",
    "436": "tj", "437": "kg", "438": "tm", "440": "jp", "441": "jp", "450": "kr", "452": "vn",
    "454": "hk", "455": "mo", "456": "kh", "457": "la", "460": "cn", "461": "cn", "466": "tw",
    "467": "kp", "470": "bd", "472": "mv", "502": "my", "505": "au", "510": "id", "514": "tl",
    "515": "ph", "520": "th", "525": "sg", "528": "bn", "530": "nz", "536": "nr", "537": "pg",
    "539": "to", "540": "sb", "541": "vu", "542": "fj", "543": "wf", "544": "as", "545": "ki",
    "546": "nc", "547": "pf", "548": "ck", "549": "ws", "550": "fm", "551": "mh", "552": "pw",
    "553": "tv", "554": "tk", "555": "nu", "602": "eg", "603": "dz", "604": "ma", "605": "tn",
    "606": "ly", "607": "gm", "608": "sn", "609": "mr", "610": "ml", "611": "gn", "612": "ci",
    "613": "bf", "614": "ne", "615": "tg", "616": "bj", "617": "mu", "618": "lr", "619": "sl",
    "620": "gh", "621": "ng", "622": "td", "623": "cf", "624": "cm", "625": "cv", "626": "st",
    "627": "gq", "628": "ga", "629": "cg", "630": "cd", "631": "ao", "632": "gw", "633": "sc",
    "634": "sd", "635": "rw", "636": "et", "637": "so", "638": "dj", "639": "ke", "640": "tz",
    "641": "ug", "642": "bi", "643": "mz", "645": "zm", "646": "mg", "647": "re", "648": "zw",
    "649": "na", "650": "mw", "651": "ls", "652": "bw", "653": "sz", "654": "km", "655": "za",
    "657": "er", "658": "sh", "659": "ss", "702": "bz", "704": "gt", "706": "sv", "708": "hn",
    "710": "ni", "712": "cr", "714": "pa", "716": "pe", "722": "ar", "724": "br", "730": "cl",
    "732": "co", "734": "ve", "736": "bo", "738": "gy", "740": "ec", "742": "gf", "744": "py",
    "746": "sr", "748": "uy", "750": "fk"
  };

  export const DMR_MCC_MAP = (() => {
    const map = {};
    for (const [mcc, iso] of Object.entries(_MCC_ISO_CODES)) {
      if (_COUNTRY_ENTRY_BY_ISO[iso]) {
        map[mcc] = _COUNTRY_ENTRY_BY_ISO[iso];
      }
    }
    return map;
  })();

  export const ITU_ISO_PREFIXES = {
    ad: "C3", ae: "A6", af: "YA,T6", ag: "V2", ai: "VP2E", al: "ZA", am: "EK",
    ao: "D2,D3", ar: "AY,AZ,LO-LW,L2-L9", as: "KH8,NH8,WH8,AH8", at: "OE",
    au: "AX,VH-VN,VZ", aw: "P4", ax: "OH0,OF0,OG0,OI0", az: "4J,4K", ba: "E7,T9",
    bb: "8P", bd: "S2,S3", be: "ON-OT", bf: "XT", bg: "LZ", bh: "A9", bi: "9U",
    bj: "TY", bl: "FJ", bm: "VP9", bn: "V8", bo: "CP", bq: "PJ4,PJ5,PJ6",
    br: "PP-PY,ZV-ZZ", bs: "C6", bt: "A5", bv: "3Y", bw: "A2,8O", by: "EU,EV,EW",
    bz: "V3", ca: "CF-CK,CY,CZ,VA-VG,VO,VX,VY,XJ-XO", cc: "VK9C", cd: "9O-9T",
    cf: "TL", cg: "TN", ch: "HB,HE", ci: "TU", ck: "E5,ZK1",
    cl: "3G,CA-CE,XQ,XR", cm: "TJ", cn: "B,3H-3U,XS", co: "5J,5K,HJ,HK", cr: "TE,TI",
    cu: "CL,CM,CO,T4", cv: "D4", cw: "PJ2,PJ", cx: "VK9X", cy: "5B,C4,H2,P3",
    cz: "OK,OL", de: "DA-DR", dj: "J2", dk: "5P,5Q,OU-OW,OZ", dm: "J7", do: "HI",
    dz: "7R,7T-7Y", ec: "HC,HD", ee: "ES", eg: "6A,6B,SU,SSA-SSM", eh: "S0",
    er: "E3", es: "AM-AO,EA-EH", et: "9E,9F,ET", fi: "OF-OJ", fj: "3D2,3DN-3DZ",
    fk: "VP8", fm: "V6", fo: "OY", fr: "F,HW-HY,TK,TM,TO,TP,TQ,TV,TW,TX",
    ga: "TR", gb: "G,M,2A-2C,2E-2I,2K-2T,2V-2Z,VP,VQ,VS,ZC,ZD,ZN,ZO,ZQ", gd: "J3",
    ge: "4L", gf: "FY", gg: "2U,GP,GU,MP,MU", gh: "9G", gi: "ZB,ZB2", gl: "OX,XP",
    gm: "C5", gn: "3X", gp: "FG", gq: "3C", gr: "J4,SV-SZ", gs: "VP8G", gt: "TD,TG",
    gu: "KH2,NH2,WH2,AH2", gw: "J5", gy: "8R", hk: "VR,VR2", hm: "VK0H",
    hn: "HQ,HR", hr: "9A", ht: "4V,HH", hu: "HA,HG", id: "7A-7I,8A-8I,JZ,PK-PO,YB-YH",
    ie: "EI,EJ", il: "4X,4Z", im: "2D,GD,GT,MD,MT", in: "8T-8Y,AT-AW,VT-VW,VU",
    io: "VQ9", iq: "YI,HN", ir: "9B-9D,EP,EQ", is: "TF", it: "I", je: "2J,GH,GJ,MH,MJ",
    jm: "6Y", jo: "JY", jp: "7J-7N,8J-8N,JA-JS", ke: "5Y,5Z", kg: "EX", kh: "XU",
    ki: "T3", km: "D6", kn: "V4", kp: "HM,P5-P9", kr: "6K-6N,D7-D9,DS,DT,HL",
    kw: "9K", ky: "ZF", kz: "UN-UQ", la: "XW", lb: "OD", lc: "J6", li: "HB0",
    lk: "4P-4S", lr: "5L,5M,6Z,A8,D5,EL", ls: "7P", lt: "LY", lu: "LX", lv: "YL",
    ly: "5A", ma: "5C-5G,CN", mc: "3A", md: "ER", me: "4O", mf: "FS",
    mg: "5R,5S,6X", mh: "V7", mk: "Z3", ml: "TZ", mm: "XY,XZ", mn: "JT-JV",
    mo: "XX", mp: "KH0,NH0,WH0,AH0", mq: "FM", mr: "5T", ms: "VP2M", mt: "9H",
    mu: "3B", mv: "8Q", mw: "7Q", mx: "4A-4C,6D-6J,XA-XI", my: "9M,9W", mz: "C8,C9",
    na: "V5", nc: "FK", ne: "5U", nf: "VK9N", ng: "5N,5O", ni: "H6,H7,HT,YN",
    nl: "PA-PI", no: "LA-LN", np: "9N", nr: "C2", nu: "E6,ZK2",
    nz: "ZK,ZL,ZM", om: "A4", pa: "3E,3F,H3,H8,H9,HO,HP", pe: "4T,OA-OC", pf: "FO",
    pg: "P2", ph: "4D-4I,DU-DZ", pk: "6P-6S,AP-AS", pl: "3Z,HF,SN-SR", pm: "FP",
    pn: "VP6,VR6", pr: "KP3,KP4,KP5,NP3,NP4,NP5,WP3,WP4,WP5", ps: "E4", pt: "CQ-CU",
    pw: "T8", py: "ZP", qa: "A7", re: "FR", ro: "YO-YR", rs: "YT,YU,YZ",
    ru: "R,UA-UI", rw: "9X", sa: "7Z,8Z,HZ", sb: "H4", sc: "S7",
    sd: "6T,6U,SSN-SSZ,ST", se: "7S,8S,SA-SM", sg: "9V,S6", sh: "ZD7,ZD8,ZD9",
    si: "S5", sj: "JW,JX", sk: "OM", sl: "9L", sm: "T7", sn: "6V,6W", so: "6O,T5",
    sr: "PZ", ss: "Z8", st: "S9", sv: "HU,YS", sx: "PJ7,PJ8", sy: "6C,YK", sz: "3DA-3DM",
    tc: "VP5,VQ5", td: "TT", tf: "FT", tg: "5V", th: "E2,HS", tj: "EY",
    tk: "ZK3", tl: "4W", tm: "EZ", tn: "3V,TS", to: "A3", tr: "TA-TC,YM",
    tt: "9Y,9Z", tv: "T2", tw: "BM-BQ,BU-BX", tz: "5H,5I", ua: "EM-EO,UR-UZ",
    ug: "5X", un: "4U", us: "K,N,W,AA-AL", uy: "CV-CX", uz: "UJ-UM", va: "HV",
    vc: "J8", ve: "4M,YV-YY", vg: "VP2V", vi: "KP2,NP2,WP2", vn: "3W,XV",
    vu: "YJ", wf: "FW", ws: "5W", xk: "Z6", ye: "7O", yt: "FH", za: "S8,ZR-ZU",
    zm: "9I,9J", zw: "Z2"
  };

  function _expandItuPrefixSpec(spec) {
    const out = [];
    for (const raw of String(spec || "").split(",")) {
      const part = raw.trim().toUpperCase();
      if (!part) continue;
      const dashIdx = part.indexOf("-");
      if (dashIdx > 0) {
        const a = part.slice(0, dashIdx);
        const b = part.slice(dashIdx + 1);
        if (a.length === b.length && a.slice(0, -1) === b.slice(0, -1)) {
          const base = a.slice(0, -1);
          const c1 = a.charCodeAt(a.length - 1);
          const c2 = b.charCodeAt(b.length - 1);
          for (let code = c1; code <= c2; code++) {
            out.push(base + String.fromCharCode(code));
          }
          continue;
        }
      }
      out.push(part);
    }
    return out;
  }

  const _ITU_PREFIX_TO_ISO = (() => {
    const pairs = [];
    for (const [iso, spec] of Object.entries(ITU_ISO_PREFIXES)) {
      for (const prefix of _expandItuPrefixSpec(spec)) {
        pairs.push([prefix, iso]);
      }
    }
    // Shorter/base allocations first, longer specific territory prefixes override if overlapping
    pairs.sort((a, b) => (a[0].length - b[0].length) || a[0].localeCompare(b[0]));
    const map = Object.create(null);
    for (const [prefix, iso] of pairs) {
      map[prefix] = iso;
    }
    return map;
  })();

  export const CALLSIGN_PREFIX_MAP = (() => {
    const byIso = Object.create(null);
    for (const [prefix, iso] of Object.entries(_ITU_PREFIX_TO_ISO)) {
      if (!byIso[iso]) byIso[iso] = [];
      byIso[iso].push(prefix);
    }
    const items = [];
    for (const [iso, list] of Object.entries(byIso)) {
      const entry = _COUNTRY_ENTRY_BY_ISO[iso];
      if (!entry) continue;
      list.sort((a, b) => (b.length - a.length) || a.localeCompare(b));
      const maxLen = list[0].length;
      items.push({
        maxLen,
        iso,
        prefix: new RegExp("^(?:" + list.join("|") + ")", "i"),
        name: entry.name,
        name_en: entry.name_en,
        flag: entry.flag
      });
    }
    items.sort((a, b) => (b.maxLen - a.maxLen) || a.iso.localeCompare(b.iso));
    return items.map(({ maxLen, ...rest }) => rest);
  })();

  const COUNTRY_NAME_TO_ISO = (() => {
    const map = Object.create(null);
    const add = (label, iso) => {
      const norm = String(label || "").toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ").trim();
      if (norm && _COUNTRY_ENTRY_BY_ISO[iso] && !map[norm]) {
        map[norm] = iso;
      }
    };
    for (const [iso, meta] of Object.entries(ITU_COUNTRY_META)) {
      add(meta.en, iso);
      add(meta.ru, iso);
    }
    const aliases = {
      us: ["united states", "united states of america", "usa", "u.s.a.", "u.s."],
      gb: ["united kingdom", "uk", "great britain", "england", "scotland", "wales", "northern ireland", "великобритания"],
      ru: ["russia", "russian federation", "россия", "рф"],
      ua: ["ukraine", "украина", "україна"],
      by: ["belarus", "беларусь", "белоруссия"],
      kz: ["kazakhstan", "казахстан"],
      uz: ["uzbekistan", "узбекистан"],
      kg: ["kyrgyzstan", "киргизия", "кыргызстан"],
      md: ["moldova", "moldova, republic of", "republic of moldova", "молдова", "молдавия"],
      cz: ["czechia", "czech republic", "чехия"],
      sk: ["slovakia", "slovak republic", "словакия"],
      kr: ["south korea", "korea", "korea, republic of", "republic of korea", "южная корея", "корея"],
      kp: ["north korea", "dprk", "korea, democratic people's republic of", "кндр", "северная корея"],
      cn: ["china", "people's republic of china", "prc", "китай"],
      tw: ["taiwan", "taiwan, province of china", "chinese taipei", "тайвань"],
      hk: ["hong kong", "hong kong sar", "гонконг"],
      mo: ["macau", "macao", "macao sar", "макао"],
      ae: ["united arab emirates", "uae", "u.a.e.", "оаэ"],
      za: ["south africa", "юар"],
      tr: ["turkey", "turkiye", "türkiye", "турция"],
      nl: ["netherlands", "the netherlands", "holland", "нидерланды", "голландия"],
      ba: ["bosnia and herzegovina", "bosnia-herzegovina", "босния и герцеговина"],
      mk: ["north macedonia", "macedonia", "fyr macedonia", "северная македония", "македония"],
      cd: ["dr congo", "democratic republic of the congo", "congo, democratic republic of the", "drc", "др конго"],
      cg: ["republic of the congo", "congo", "congo republic", "республика конго"],
      ci: ["cote d'ivoire", "côte d'ivoire", "ivory coast", "кот-д'ивуар"],
      cv: ["cabo verde", "cape verde", "кабо-верде"],
      sz: ["eswatini", "swaziland", "эсватини", "свазиленд"],
      mm: ["myanmar", "burma", "мьянма"],
      tl: ["timor-leste", "east timor", "восточный тимор"],
      vn: ["vietnam", "viet nam", "вьетнам"],
      bn: ["brunei", "brunei darussalam", "бруней"],
      la: ["laos", "lao people's democratic republic", "лаос"],
      ir: ["iran", "iran, islamic republic of", "иран"],
      sy: ["syria", "syrian arab republic", "сирия"],
      ps: ["palestine", "palestine, state of", "palestinian territory", "палестина"],
      tz: ["tanzania", "tanzania, united republic of", "танзания"],
      ve: ["venezuela", "venezuela, bolivarian republic of", "венесуэла"],
      bo: ["bolivia", "bolivia, plurinational state of", "боливия"],
      fm: ["micronesia", "federated states of micronesia", "micronesia, federated states of", "микронезия"],
      fk: ["falkland islands", "falkland islands (malvinas)", "фолклендские о-ва"],
      va: ["vatican city", "vatican", "holy see", "ватикан"],
      ax: ["åland islands", "aland islands", "аландские о-ва"],
      re: ["réunion", "reunion", "реюньон"],
      cw: ["curaçao", "curacao", "netherlands antilles", "кюрасао"],
      bl: ["saint barthélemy", "saint barthelemy", "st. barths", "st barths", "сен-бартелеми"],
      mf: ["saint martin", "st. martin", "сен-мартен"],
      sx: ["sint maarten", "st. maarten", "синт-маартен"],
      kn: ["saint kitts and nevis", "st. kitts and nevis", "st kitts and nevis", "сент-китс и невис"],
      lc: ["saint lucia", "st. lucia", "st lucia", "сент-люсия"],
      vc: ["saint vincent and the grenadines", "st. vincent and the grenadines", "st vincent and the grenadines", "сент-винсент и гренадины"],
      pm: ["saint pierre and miquelon", "st. pierre and miquelon", "сен-пьер и микелон"],
      sh: ["saint helena", "st. helena", "о-ва св. елены"],
      st: ["são tomé and príncipe", "sao tome and principe", "сан-томе и принсипи"],
      vg: ["british virgin islands", "virgin islands, british", "британские виргинские о-ва"],
      vi: ["us virgin islands", "u.s. virgin islands", "virgin islands, u.s.", "американские виргинские о-ва"],
      pe: ["peru", "perú", "перу"],
      bh: ["bahrain", "bahrein", "бахрейн"],
      do: ["dominican republic", "доминиканская республика", "доминикана"]
    };
    for (const [iso, list] of Object.entries(aliases)) {
      for (const label of list) add(label, iso);
    }
    return map;
  })();

  function _normalizeCountryLookupKey(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lookupCountryByTextName(rawCountry) {
    const raw = String(rawCountry || "").trim();
    if (!raw) return null;
    const exactNorm = raw.toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ").trim();
    if (exactNorm === "gl" || exactNorm === "global" || exactNorm === "worldwide" || exactNorm === "xx" || exactNorm === "int" || exactNorm === "local") {
      return null;
    }
    if (COUNTRY_NAME_TO_ISO[exactNorm]) {
      return _COUNTRY_ENTRY_BY_ISO[COUNTRY_NAME_TO_ISO[exactNorm]];
    }
    const cleaned = _normalizeCountryLookupKey(raw);
    if (cleaned && COUNTRY_NAME_TO_ISO[cleaned]) {
      return _COUNTRY_ENTRY_BY_ISO[COUNTRY_NAME_TO_ISO[cleaned]];
    }
    if (/^[a-z]{2}$/.test(exactNorm) && exactNorm !== "gl" && exactNorm !== "xx" && _COUNTRY_ENTRY_BY_ISO[exactNorm]) {
      return _COUNTRY_ENTRY_BY_ISO[exactNorm];
    }
    return null;
  }

  function matchItuCallsignPrefix(rawPrefixOrCall) {
    const clean = String(rawPrefixOrCall || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!clean || /^\d{2}/.test(clean)) return null;
    for (let len = Math.min(4, clean.length); len >= 1; len--) {
      const iso = _ITU_PREFIX_TO_ISO[clean.slice(0, len)];
      if (iso && _COUNTRY_ENTRY_BY_ISO[iso]) {
        return _COUNTRY_ENTRY_BY_ISO[iso];
      }
    }
    return null;
  }

  // Радиолюбительский позывной ОБЯЗАТЕЛЬНО содержит цифру района (EA1AMF, WB8FWB, 7Z1AJ, 9Y4QA)
  // и оканчивается на букву. Имена хабов ASL (например EASTC) или числа без букв отсекаются.
  const HAM_CALLSIGN_SHAPE = /^[A-Z0-9]{1,4}\d[A-Z0-9]{0,6}[A-Z]$/;
  const _CALLSIGN_SLASH_MODIFIERS = new Set([
    "P", "M", "MM", "AM", "QRP", "LH", "HS", "PORT", "MOB", "FIX",
    "DMR", "YSF", "M17", "DSTAR", "C4FM", "SVX", "ASL", "ECHO",
    "A", "B", "C", "D", "E", "J", "L", "R", "S", "T"
  ]);

  function _stripCallsignSsid(tok) {
    return String(tok || "").trim().toUpperCase().replace(/-(?:[A-Z]|\d{1,2})$/, "");
  }

  function _resolveCallsignToken(rawToken) {
    const token = _stripCallsignSsid(rawToken).replace(/^[^A-Z0-9/]+|[^A-Z0-9/]+$/g, "");
    if (!token || token === "---" || token.startsWith("ID:")) return null;

    if (!token.includes("/")) {
      if (/^\d{2}/.test(token) || !HAM_CALLSIGN_SHAPE.test(token)) return null;
      return matchItuCallsignPrefix(token);
    }

    const parts = token.split("/").filter(Boolean);
    while (parts.length > 1) {
      const tail = parts[parts.length - 1];
      if (_CALLSIGN_SLASH_MODIFIERS.has(tail) || /^[0-9]{1,2}$/.test(tail)) {
        parts.pop();
      } else {
        break;
      }
    }
    if (parts.length === 1) {
      const base = _stripCallsignSsid(parts[0]);
      if (!base || /^\d{2}/.test(base) || !HAM_CALLSIGN_SHAPE.test(base)) return null;
      return matchItuCallsignPrefix(base);
    }
    if (parts.length >= 2) {
      const p0 = _stripCallsignSsid(parts[0]);
      const p1 = _stripCallsignSsid(parts[1]);
      // Reciprocal/CEPT prefix first: e.g. DL/9Y4QA, EA8/G4XYZ, HB0/DL1ABC, VP2E/K1ABC, F/G3XYZ
      if (p0.length <= 4 && !/^\d{2}/.test(p0) && HAM_CALLSIGN_SHAPE.test(p1) && !_CALLSIGN_SLASH_MODIFIERS.has(p0)) {
        const visited = matchItuCallsignPrefix(p0);
        if (visited) return visited;
      }
      // Reciprocal suffix form: e.g. G4XYZ/EA8
      if (HAM_CALLSIGN_SHAPE.test(p0) && p1.length >= 2 && p1.length <= 4 && !/^\d{2}/.test(p1) && !_CALLSIGN_SLASH_MODIFIERS.has(p1)) {
        const visited = matchItuCallsignPrefix(p1);
        if (visited) return visited;
      }
      // Fallback: longest valid full ham callsign part
      const sorted = [...parts].sort((a, b) => b.length - a.length);
      for (const cand of sorted) {
        const clean = _stripCallsignSsid(cand);
        if (clean && !/^\d{2}/.test(clean) && HAM_CALLSIGN_SHAPE.test(clean)) {
          const hit = matchItuCallsignPrefix(clean);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  function lookupCountryByHamCallsign(rawCallsign, rawTalkerAlias = "") {
    for (const source of [rawCallsign, rawTalkerAlias]) {
      const str = String(source || "").trim();
      if (!str || str === "---") continue;
      // Direct single token or delimited words (e.g. "9Y4QA Noel", "9Y4QA  D", "🎙️ 9Y4QA · Noel", "Noel 9Y4QA")
      const tokens = str.split(/[\s,;|·•()[\]]+/).filter(Boolean);
      for (const tok of tokens) {
        if (/^ID:?\d*$/i.test(tok)) continue;
        const resolved = _resolveCallsignToken(tok);
        if (resolved) return resolved;
      }
    }
    return null;
  }

  export function getCountryInfo(dmrId, callsign = "", countryName = "", talkerAlias = "") {
    const idStr = dmrId != null ? String(dmrId).trim() : "";
    if (idStr === "4000" || idStr === "9990") {
      return GLOBAL_COUNTRY_INFO;
    }

    const cachedUser = (dmrId && typeof window !== "undefined" && window.USER_CALLSIGNS && window.USER_CALLSIGNS[dmrId]) || null;
    let cs = String(callsign || "").trim();
    if ((!cs || cs === "---" || cs.startsWith("ID:")) && cachedUser && cachedUser.callsign) {
      cs = String(cachedUser.callsign).trim();
    }

    // Layer 1: Explicit station callsign -> full ITU Appendix 42 + DXCC prefix lookup
    if (cs && cs !== "---" && !cs.startsWith("ID:")) {
      const byCall = lookupCountryByHamCallsign(cs);
      if (byCall) return byCall;
    }

    // Layer 2: Numeric DMR ID / Country TalkGroup -> full 3-digit E.212 MCC lookup
    if (idStr && idStr.length >= 3 && /^\d+$/.test(idStr)) {
      const mcc = idStr.substring(0, 3);
      if (DMR_MCC_MAP[mcc]) {
        return DMR_MCC_MAP[mcc];
      }
    }

    // Layer 3: Fallback extraction from Talker Alias / caller_display / src_name (e.g. "9Y4QA Noel")
    const ta = String(talkerAlias || "").trim();
    if (ta) {
      const byAlias = lookupCountryByHamCallsign("", ta);
      if (byAlias) return byAlias;
    }

    // Layer 4: Country text name from caller metadata or RadioID/HamQTH cache
    const uCountry = countryName || (cachedUser && cachedUser.country) || "";
    if (uCountry) {
      const byName = lookupCountryByTextName(uCountry);
      if (byName) return byName;
    }

    // Layer 5: Safe segment-based lookup in TG_NAMES (avoids false substring matches on short names)
    if (idStr) {
      const tgName = (typeof window !== "undefined" && window.TG_NAMES && window.TG_NAMES[dmrId]) || "";
      if (tgName) {
        const chunks = String(tgName).split(/[\/,|:\[\]()]+/).map(s => s.trim()).filter(Boolean);
        for (const chunk of chunks) {
          const byChunk = lookupCountryByTextName(chunk);
          if (byChunk) return byChunk;
        }
      }
    }

    return GLOBAL_COUNTRY_INFO;
  }

  function getAslIsoCountryInfo(rawIso) {
    const iso = String(rawIso || "").trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(iso) || iso === "gl" || iso === "xx") return null;
    const upper = iso.toUpperCase();
    return {
      iso,
      name: getLocalizedCountryName(upper, upper),
      name_en: getLocalizedCountryName(upper, upper, "en"),
      flag: isoToEmoji(upper)
    };
  }

  function findAslDirectoryNode(nodeStr) {
    if (!nodeStr || typeof window === "undefined") return null;
    const n = String(nodeStr).trim();
    if (!n) return null;
    if (window._aslNodeInfoMap && window._aslNodeInfoMap[n]) {
      return window._aslNodeInfoMap[n];
    }
    try {
      const rawDir = localStorage.getItem("proxdmr_allstar_directory");
      if (rawDir) {
        const list = JSON.parse(rawDir);
        if (Array.isArray(list)) {
          const found = list.find(it => it && String(it.node).trim() === n);
          if (found) {
            if (!window._aslNodeInfoMap) window._aslNodeInfoMap = {};
            window._aslNodeInfoMap[n] = found;
            return found;
          }
        }
      }
    } catch (_) {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("proxdmr_asl_quick_nodes_")) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
              const found = list.find(it => it && String(it.node).trim() === n);
              if (found && found.flag && found.flag !== "➕") {
                if (!window._aslNodeInfoMap) window._aslNodeInfoMap = {};
                window._aslNodeInfoMap[n] = found;
                return found;
              }
            }
          }
        }
      }
    } catch (_) {}
    const POPULAR_ASL = [
      { node: "1999", flag: "🦜", country: "LOCAL" },
      { node: "41522", flag: "🇬🇧", country: "GB" },
      { node: "27339", flag: "🇺🇸", country: "US" },
      { node: "2143", flag: "🇺🇸", country: "US" },
      { node: "9999", flag: "🦜", country: "GLOBAL" },
      { node: "51010", flag: "🌐", country: "GLOBAL" },
      { node: "28554", flag: "🇷🇺", country: "RU" },
      { node: "52495", flag: "🇩🇪", country: "DE" },
      { node: "2000", flag: "🇺🇸", country: "US" },
      { node: "43393", flag: "🇦🇺", country: "AU" }
    ];
    const popFound = POPULAR_ASL.find(it => it.node === n);
    if (popFound) {
      if (!window._aslNodeInfoMap) window._aslNodeInfoMap = {};
      window._aslNodeInfoMap[n] = popFound;
      return popFound;
    }
    return null;
  }

  export function getCallCountryInfo(call, legacyCountryHint = "") {
    if (!call) return GLOBAL_COUNTRY_INFO;
    const callIdStr = String(call.id || call.call_id || "");
    const isAslCall = call.network_type === "allstar" || callIdStr.startsWith("asl_")
      || (typeof window !== "undefined" && typeof window.getHotspotNetworkType === "function" && window.getHotspotNetworkType(call.hotspot_id) === "allstar");
    if (!isAslCall) {
      const myCall = (typeof window !== "undefined" && window.radioState && window.radioState.callsign)
        ? String(window.radioState.callsign).trim().toUpperCase()
        : "";
      const myDmrId = (typeof window !== "undefined" && window.radioState && window.radioState.dmr_id) || "";
      const isForeign = !call.is_tx && Boolean(call.src_id && myDmrId && String(call.src_id) !== String(myDmrId));
      let rawTa = String(call.talker_alias || "").trim();
      if (isForeign && myCall && (rawTa.toUpperCase() === myCall || rawTa.toUpperCase().startsWith(myCall + " "))) {
        rawTa = "";
      }
      const aliasOrDisplay = rawTa || String(call.caller_display || call.src_name || "").trim();
      const countryHint = legacyCountryHint || call.country || "";
      return getCountryInfo(call.src_id, call.src_callsign, countryHint, aliasOrDisplay);
    }
    // 1) Если оператор назвал реальный радиолюбительский позывной в эфире (через микрофон):
    const alias = String(call.talker_alias || "");
    const spoken = alias.match(/^\s*\u{1F399}\uFE0F?\s*([A-Za-z0-9\/]{3,12})/u);
    if (spoken) {
      const hamCountry = lookupCountryByHamCallsign(spoken[1]);
      if (hamCountry) return hamCountry;
    }
    const opMatch = alias.match(/^([A-Za-z0-9\/]{3,10})\s*[·•-]/);
    if (opMatch) {
      const hamCountry = lookupCountryByHamCallsign(opMatch[1]);
      if (hamCountry) return hamCountry;
    }
    // 2) Если у вызова уже передан флаг/страна из БД нод (allstar_directory):
    if (call.flag && call.flag !== "🌐" && call.flag !== "➕") {
      const iso = emojiToIso(call.flag) || (call.country && call.country !== "INT" ? call.country : null);
      if (iso) {
        const isoInfo = getAslIsoCountryInfo(iso);
        if (isoInfo) return isoInfo;
      }
      return {
        name: call.country || "AllStarLink",
        name_en: call.country || "AllStarLink",
        flag: call.flag
      };
    }
    if (call.country && call.country !== "INT" && call.country !== "LOCAL") {
      const isoInfo = getAslIsoCountryInfo(call.country);
      if (isoInfo) return isoInfo;
    }
    // 3) Поиск узла в локальном справочнике нод ASL (contacts / DEFAULT_ASL_DIRECTORY / quick_nodes):
    const nodeNum = String(call.src_id || call.node || (callIdStr.startsWith("asl_") ? callIdStr.split("_").pop() : "") || "").trim();
    if (nodeNum && nodeNum !== "0") {
      const dirNode = findAslDirectoryNode(nodeNum);
      if (dirNode && dirNode.flag && dirNode.flag !== "🌐") {
        const iso = dirNode.country || emojiToIso(dirNode.flag);
        if (iso) {
          const isoInfo = getAslIsoCountryInfo(iso);
          if (isoInfo) return isoInfo;
        }
        return {
          name: dirNode.country || dirNode.name || "AllStarLink",
          name_en: dirNode.country || dirNode.name || "AllStarLink",
          flag: dirNode.flag
        };
      }
    }
    // Для узлов AllStarLink КАТЕГОРИЧЕСКИ НЕ вызываем CALLSIGN_PREFIX_MAP по имени хаба (например EASTC),
    // так как имя узла — это не радиолюбительский позывной, а идентификатор из БД нод.
    return GLOBAL_COUNTRY_INFO;
  }

  export function emojiToIso(flagEmoji) {
    if (!flagEmoji || typeof flagEmoji !== "string") return null;
    const chars = [...flagEmoji];
    if (chars.length === 2) {
      const c1 = chars[0].codePointAt(0) - 0x1F1E6;
      const c2 = chars[1].codePointAt(0) - 0x1F1E6;
      if (c1 >= 0 && c1 < 26 && c2 >= 0 && c2 < 26) {
        return String.fromCharCode(97 + c1, 97 + c2);
      }
    }
    return null;
  }

  export function isoToEmoji(isoCode) {
    if (!isoCode || typeof isoCode !== "string") return "🌐";
    const clean = isoCode.trim().toUpperCase();
    if (clean.length !== 2 || clean === "GL") return "🌐";
    try {
      return String.fromCodePoint(...[...clean].map(c => 127397 + c.charCodeAt(0)));
    } catch (_) {
      return "🌐";
    }
  }

  export function getLocalizedCountryName(isoCode, fallbackName = "", lang = null) {
    const curLang = lang || (typeof window !== "undefined" && window.I18N && (typeof window.I18N.getLanguage === "function" ? window.I18N.getLanguage() : (window.I18N.currentLanguage || window.I18N.currentLang))) || (typeof localStorage !== "undefined" && localStorage.getItem("proxdmr_language")) || "ru";
    if (isoCode && typeof isoCode === "string") {
      const clean = isoCode.trim().toUpperCase();
      if (clean.length === 2 && clean !== "GL") {
        if (typeof window !== "undefined" && typeof window.t === "function") {
          const tKey = `countries.${clean.toLowerCase()}`;
          const tVal = window.t(tKey, {}, "");
          if (tVal && tVal !== tKey) return tVal;
        }
        try {
          const regionNames = new Intl.DisplayNames([curLang], { type: 'region' });
          const dn = regionNames.of(clean);
          if (dn) return dn;
        } catch (_) {}
      }
    }
    return fallbackName || isoCode || "BM";
  }

  export function resolveCountryDisplayName(countryInfo, lang = null) {
    if (!countryInfo) return "";
    if (typeof countryInfo === "string") return countryInfo.trim();
    const curLang = lang || getActiveLang();
    if (countryInfo.name === "Global" || (countryInfo.flag === "🌐" && !countryInfo.iso && !countryInfo.name_en)) {
      return (typeof window !== "undefined" && typeof window.t === "function") ? window.t("common.global", {}, "Global") : "Global";
    }
    const iso = countryInfo.iso || emojiToIso(countryInfo.flag);
    const isCyr = (curLang === "ru" || curLang === "uk");
    const fb = isCyr ? (countryInfo.name || countryInfo.name_en || "") : (countryInfo.name_en || countryInfo.name || "");
    if (iso) {
      return getLocalizedCountryName(iso, fb, curLang);
    }
    return fb;
  }

  export function getFlagBadgeHtml(countryInfo, isParrot = false, fallbackEmoji = "") {
    if (isParrot) {
      const parrotTitle = (typeof window !== "undefined" && typeof window.t === "function")
        ? window.t("tg_special.9990", {}, "Parrot / Echo")
        : "Parrot / Echo";
      return `<span class="flag-badge parrot-badge" title="${safeEscapeHtml(parrotTitle)}">🦜</span>`;
    }
    const name = resolveCountryDisplayName(countryInfo) || ((countryInfo && countryInfo.name) ? countryInfo.name : "");
    const flag = (countryInfo && countryInfo.flag) ? countryInfo.flag : fallbackEmoji;

    // Global / Worldwide / Standby
    if (!flag || flag === "🌐" || name.toLowerCase().includes("global") || name.toLowerCase().includes("worldwide")) {
      const globalTitle = (typeof window !== "undefined" && typeof window.t === "function")
        ? window.t("common.global", {}, "Global")
        : "Global";
      return `<span class="flag-badge flag-global" title="${safeEscapeHtml(globalTitle)}"><svg viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>`;
    }

    const iso = (countryInfo && countryInfo.iso) || emojiToIso(flag) || emojiToIso(fallbackEmoji);
    if (iso) {
      const safeName = safeEscapeHtml(name);
      return `<span class="flag-badge flag-${iso}" title="${safeName}"><img src="/static/flags/${iso}.svg" alt="${safeName}" class="flag-img" loading="eager" decoding="sync" onerror="this.parentElement.innerHTML='${flag}'" /></span>`;
    }

    // Other unicode emojis
    return `<span class="flag-badge" title="${safeEscapeHtml(name)}">${flag}</span>`;
  }

  export function updateFlagElement(el, countryInfo, isParrot = false, fallbackEmoji = "") {
    if (!el) return;
    const isParrotBool = Boolean(isParrot);
    const key = isParrotBool ? "parrot" : ((countryInfo && (countryInfo.iso || countryInfo.name)) || fallbackEmoji || "global");
    if (el._currentFlagKey === key) {
      return;
    }
    el._currentFlagKey = key;
    el.innerHTML = getFlagBadgeHtml(countryInfo, isParrotBool, fallbackEmoji);
  }

  export function cleanName(name) {
    if (!name) return "";
    const n = name.trim();
    const nl = n.toLowerCase();
    if (nl.includes("ask admin") || nl === "none" || nl === "no name" || nl === "unknown") {
      return "";
    }
    return n;
  }

  export function formatCallerDisplay(callsign, name, talkerAlias, dmrId, rawCallerDisplay = "") {
    const isDemo = typeof window !== "undefined" && ((typeof window.isDemoMode === "function") ? window.isDemoMode() : Boolean(window.isDemoMode));
    if (isDemo && typeof window.localizeDemoText === "function") {
      callsign = window.localizeDemoText(callsign);
      name = window.localizeDemoText(name);
      talkerAlias = window.localizeDemoText(talkerAlias);
      rawCallerDisplay = window.localizeDemoText(rawCallerDisplay);
    }
    let main = "";
    const myCall = ((typeof window !== "undefined" && window.radioState && window.radioState.callsign) || "").trim().toUpperCase();
    const myDmrId = (typeof window !== "undefined" && window.radioState && window.radioState.dmr_id) || "";
    const isForeign = Boolean(dmrId && myDmrId && String(dmrId) !== String(myDmrId));
    let validTa = talkerAlias ? talkerAlias.trim() : "";
    if (isForeign && myCall && validTa && (validTa.toUpperCase() === myCall || validTa.toUpperCase().startsWith(myCall + " "))) {
      validTa = "";
    }
    if (validTa) {
      main = validTa;
    } else if (callsign && callsign.trim() && callsign !== "---" && !callsign.startsWith("ID:")) {
      const call = callsign.trim().toUpperCase();
      const cName = cleanName(name);
      main = (cName && cName.toUpperCase() !== call) ? `${call} ${cName}` : call;
    } else if (rawCallerDisplay && rawCallerDisplay.trim() && rawCallerDisplay !== "---") {
      let raw = rawCallerDisplay.trim();
      if (raw.includes("dmr-id-text")) raw = raw.replace(/<[^>]*>/g, "").trim();

      const mParen = raw.match(/^(.*?)\s*\(\s*(\d{3,8})\s*\)$/);
      if (mParen) {
        main = mParen[1].trim();
        if (!dmrId) dmrId = mParen[2];
      } else {
        const mIdOnly = raw.match(/^ID:\s*(\d{3,8})$/i);
        if (mIdOnly) {
          if (!dmrId) dmrId = mIdOnly[1];
        } else {
          main = raw;
        }
      }
    }

    // Strip trailing (digits) from main if already present, to avoid duplicates
    if (main) {
      main = main.replace(/\s*\(\s*\d{3,8}\s*\)$/, "").trim();
    }

    const validId = dmrId && String(dmrId) !== "0" && String(dmrId) !== "---" ? String(dmrId).replace(/[^0-9A-Za-z]/g, "") : "";
    // Экранируем всё, что пришло из эфира (talker alias) / справочников — вывод идёт в innerHTML и атрибуты.
    main = String(main || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    if (main && validId) {
      return `${main} (<span class="dmr-id-text">${validId}</span>)`;
    } else if (main) {
      return main;
    } else if (validId) {
      return `ID: <span class="dmr-id-text">${validId}</span>`;
    }
    return "---";
  }

  // BrandMeister Russian regional talkgroup codes (250001 - 250099)
  const BM_RUSSIA_REGIONS = {
    "01": "Republic of Adygea",
    "02": "Bashkortostan",
    "03": "Buryatia",
    "04": "Altai Republic",
    "05": "Dagestan",
    "06": "Ingushetia",
    "07": "Kabardino-Balkaria",
    "08": "Kalmykia",
    "09": "Karachay-Cherkessia",
    "10": "Karelia",
    "11": "Komi Republic",
    "12": "Mari El",
    "13": "Mordovia",
    "14": "Yakutia (Sakha)",
    "15": "North Ossetia",
    "16": "Tatarstan",
    "17": "Tuva",
    "18": "Udmurtia",
    "19": "Khakassia",
    "20": "Chechnya",
    "21": "Chuvashia",
    "22": "Altai Krai",
    "23": "Krasnodar Krai",
    "24": "Krasnoyarsk Krai",
    "25": "Primorsky Krai",
    "26": "Stavropol Krai",
    "27": "Khabarovsk Krai",
    "28": "Amur Oblast",
    "29": "Arkhangelsk Oblast",
    "30": "Astrakhan Oblast",
    "31": "Belgorod Oblast",
    "32": "Bryansk Oblast",
    "33": "Vladimir Oblast",
    "34": "Volgograd Oblast",
    "35": "Vologda Oblast",
    "36": "Voronezh Oblast",
    "37": "Ivanovo Oblast",
    "38": "Irkutsk Oblast",
    "39": "Kaliningrad Oblast",
    "40": "Kaluga Oblast",
    "41": "Kamchatka Krai",
    "42": "Kemerovo Oblast",
    "43": "Kirov Oblast",
    "44": "Kostroma Oblast",
    "45": "Kurgan Oblast",
    "46": "Kursk Oblast",
    "47": "Leningrad Oblast",
    "48": "Lipetsk Oblast",
    "49": "Magadan Oblast",
    "50": "Moscow Oblast",
    "51": "Murmansk Oblast",
    "52": "Nizhny Novgorod Oblast",
    "53": "Novgorod Oblast",
    "54": "Novosibirsk Oblast",
    "55": "Omsk Oblast",
    "56": "Orenburg Oblast",
    "57": "Oryol Oblast",
    "58": "Penza Oblast",
    "59": "Perm Krai",
    "60": "Pskov Oblast",
    "61": "Rostov Oblast",
    "62": "Ryazan Oblast",
    "63": "Samara Oblast",
    "64": "Saratov Oblast",
    "65": "Sakhalin Oblast",
    "66": "Sverdlovsk Oblast",
    "67": "Smolensk Oblast",
    "68": "Tambov Oblast",
    "69": "Tver Oblast",
    "70": "Tomsk Oblast",
    "71": "Tula Oblast",
    "72": "Tyumen Oblast",
    "73": "Ulyanovsk Oblast",
    "74": "Chelyabinsk Oblast",
    "75": "Zabaykalsky Krai",
    "76": "Yaroslavl Oblast",
    "77": "Moscow",
    "78": "St. Petersburg",
    "79": "Jewish Autonomous Oblast",
    "80": "Zabaykalsky Krai",
    "82": "Crimea",
    "83": "Nenets AO",
    "84": "Taymyr AO",
    "85": "Ust-Orda Buryat AO",
    "86": "Khanty-Mansiysk AO (Yugra)",
    "87": "Chukotka AO",
    "88": "Evenk AO",
    "89": "Yamalo-Nenets AO",
    "92": "Sevastopol",
    "94": "Baikonur"
  };

  const GLOBAL_TG_MAP = {
    "91": { en: "Worldwide", ru: "Весь мир", uk: "Весь світ", de: "Weltweit", es: "Mundial", fr: "Monde entier", it: "Mondiale", nl: "Wereldwijd" },
    "92": { en: "Europe", ru: "Европа", uk: "Європа", de: "Europa", es: "Europa", fr: "Europe", it: "Europa", nl: "Europa" },
    "93": { en: "North America", ru: "Северная Америка", uk: "Північна Америка", de: "Nordamerika", es: "Norteamérica", fr: "Amérique du Nord", it: "Nord America", nl: "Noord-Amerika" },
    "94": { en: "South America", ru: "Южная Америка", uk: "Південна Америка", de: "Südamerika", es: "Sudamérica", fr: "Amérique du Sud", it: "Sud America", nl: "Zuid-Amerika" },
    "95": { en: "Asia", ru: "Азия", uk: "Азія", de: "Asien", es: "Asia", fr: "Asie", it: "Asia", nl: "Azië" },
    "96": { en: "Oceania", ru: "Океания", uk: "Океанія", de: "Ozeanien", es: "Oceanía", fr: "Océanie", it: "Oceania", nl: "Oceanië" },
    "97": { en: "Africa", ru: "Африка", uk: "Африка", de: "Afrika", es: "África", fr: "Afrique", it: "Africa", nl: "Afrika" },
    "113": { en: "English WW", ru: "English WW", uk: "English WW", de: "English WW", es: "English WW", fr: "English WW", it: "English WW", nl: "English WW" },
    "98": { en: "Radio Test", ru: "Radio Test (Тестовая)", uk: "Radio Test (Тестова)", de: "Funktest (Radio Test)", es: "Prueba de radio", fr: "Test radio", it: "Test radio", nl: "Radiotest" },
    "250": { en: "Russia (General / CIS)", ru: "Россия (Общий / CIS)", uk: "Росія (Загальний / CIS)", de: "Russland (Allgemein / GUS)", es: "Rusia (General / CEI)", fr: "Russie (Général / CEI)", it: "Russia (Generale / CSI)", nl: "Rusland (Algemeen / GOS)" },
    "2501": { en: "Russia 1 (National)", ru: "Россия 1 (National)", uk: "Росія 1 (National)", de: "Russland 1 (National)", es: "Rusia 1 (Nacional)", fr: "Russie 1 (National)", it: "Russia 1 (Nazionale)", nl: "Rusland 1 (Nationaal)" },
    "2502": { en: "Moscow & Moscow Region", ru: "Москва и Московская обл.", uk: "Москва та Московська обл.", de: "Moskau & Gebiet Moskau", es: "Moscú y Región de Moscú", fr: "Moscou et Région de Moscou", it: "Mosca e Regione di Mosca", nl: "Moskou en regio Moskou" },
    "2503": { en: "St. Petersburg & NWFO", ru: "Санкт-Петербург и СЗФО", uk: "Санкт-Петербург та ПЗФО", de: "St. Petersburg & NWFO", es: "San Petersburgo y NWFO", fr: "Saint-Pétersbourg et NWFO", it: "San Pietroburgo e NWFO", nl: "Sint-Petersburg en NWFO" },
    "2504": { en: "Central Federal District (RU)", ru: "Центральный ФО", uk: "Центральний ФО", de: "Zentraler Föderationskreis (RU)", es: "Distrito Federal Central (RU)", fr: "District fédéral central (RU)", it: "Circondario federale centrale (RU)", nl: "Centraal Federaal District (RU)" },
    "2505": { en: "Southern & Caucasian FD (RU)", ru: "Южный & Кавказский ФО", uk: "Південний та Кавказький ФО", de: "Südlicher & Kaukasischer FK (RU)", es: "Distrito Federal Sur y Cáucaso (RU)", fr: "District fédéral du Sud et Caucase (RU)", it: "Circondario federale meridionale (RU)", nl: "Zuidelijk & Kaukasisch FD (RU)" },
    "2506": { en: "Volga Federal District (RU)", ru: "Приволжский ФО", uk: "Приволзький ФО", de: "Föderationskreis Wolga (RU)", es: "Distrito Federal del Volga (RU)", fr: "District fédéral de la Volga (RU)", it: "Circondario federale del Volga (RU)", nl: "Federaal District Wolga (RU)" },
    "2507": { en: "Ural Federal District (RU)", ru: "Уральский ФО", uk: "Уральський ФО", de: "Föderationskreis Ural (RU)", es: "Distrito Federal de los Urales (RU)", fr: "District fédéral de l'Oural (RU)", it: "Circondario federale degli Urali (RU)", nl: "Federaal District Oeral (RU)" },
    "2508": { en: "Siberian Federal District (RU)", ru: "Сибирский ФО", uk: "Сибірський ФО", de: "Föderationskreis Sibirien (RU)", es: "Distrito Federal de Siberia (RU)", fr: "District fédéral de Sibérie (RU)", it: "Circondario federale siberiano (RU)", nl: "Federaal District Siberië (RU)" },
    "2509": { en: "Far Eastern Federal District (RU)", ru: "Дальневосточный ФО", uk: "Далекосхідний ФО", de: "Fernöstlicher Föderationskreis (RU)", es: "Distrito Federal del Lejano Oriente (RU)", fr: "District fédéral extrême-oriental (RU)", it: "Circondario federale dell'Estremo Oriente (RU)", nl: "Federaal District Verre Oosten (RU)" },
    "9990": { en: "Parrot (Echo)", ru: "Parrot (Эхо-тест)", uk: "Parrot (Ехо-тест)", de: "Parrot (Echo-Test)", es: "Parrot (Eco)", fr: "Parrot (Écho)", it: "Parrot (Echo)", nl: "Parrot (Echo)" },
    "4000": { en: "Unlink", ru: "Отключение (Unlink)", uk: "Відключення (Unlink)", de: "Trennen (Unlink)", es: "Desconectar (Unlink)", fr: "Déconnexion (Unlink)", it: "Disconnetti (Unlink)", nl: "Loskoppelen (Unlink)" }
  };

  function resolveRussiaRegionName(code, lang = null) {
    const fb = BM_RUSSIA_REGIONS[code] || "";
    if (!fb) return "";
    if (typeof window !== "undefined" && typeof window.t === "function") {
      const key = `tg_regions.${code}`;
      const val = window.t(key, {}, fb);
      if (val && val !== key) return val;
    }
    return fb;
  }

  function resolveCommonTgName(sTg, lang = null) {
    const fb = BM_COMMON_TG_MAP[sTg] || "";
    if (!fb) return "";
    if (typeof window !== "undefined" && typeof window.t === "function") {
      const key = `tg_common.${sTg}`;
      const val = window.t(key, {}, fb);
      if (val && val !== key) return val;
    }
    return fb;
  }

  function getActiveLang() {
    return (typeof window !== "undefined" && window.I18N && (typeof window.I18N.getLanguage === "function" ? window.I18N.getLanguage() : (window.I18N.currentLanguage || window.I18N.currentLang))) ||
           (typeof localStorage !== "undefined" && localStorage.getItem("proxdmr_language")) ||
           "ru";
  }

  function localizeBilingualText(text, lang) {
    if (!text || typeof text !== "string") return "";
    let clean = text.trim();
    while ((clean.startsWith("(") && clean.endsWith(")")) || (clean.startsWith("[") && clean.endsWith("]"))) {
      clean = clean.slice(1, -1).trim();
    }
    const isCyr = (lang === "ru" || lang === "uk");
    const m = clean.match(/^([^(]+)\s*\(([^)]+)\)$/);
    if (m) {
      const p1 = m[1].trim();
      const p2 = m[2].trim();
      const hasCyr1 = /[а-яА-ЯёЁіІїЇєЄґҐ]/.test(p1);
      const hasLat1 = /[a-zA-Z]/.test(p1);
      const hasCyr2 = /[а-яА-ЯёЁіІїЇєЄґҐ]/.test(p2);
      const hasLat2 = /[a-zA-Z]/.test(p2);

      if (isCyr) {
        if (hasCyr1 && !hasLat1) return p1;
        if (hasCyr2 && !hasLat2) return p2;
        return p1;
      } else {
        if (hasLat2 && !hasCyr2) return p2;
        if (hasLat1 && !hasCyr1) return p1;
        return p2;
      }
    }
    const slashParts = clean.split(/\s*[\/|]\s*/);
    if (slashParts.length === 2) {
      const p1 = slashParts[0].trim();
      const p2 = slashParts[1].trim();
      const hasCyr1 = /[а-яА-ЯёЁіІїЇєЄґҐ]/.test(p1);
      const hasLat1 = /[a-zA-Z]/.test(p1);
      const hasCyr2 = /[а-яА-ЯёЁіІїЇєЄґҐ]/.test(p2);
      const hasLat2 = /[a-zA-Z]/.test(p2);

      // Only treat as bilingual if ONE part has Cyrillic and the other has Latin (translation pair)
      if ((hasCyr1 && hasLat2 && !hasLat1 && !hasCyr2) || (hasLat1 && hasCyr2 && !hasCyr1 && !hasLat2)) {
        if (isCyr) {
          return hasCyr1 ? p1 : p2;
        } else {
          return hasLat1 ? p1 : p2;
        }
      }
    }
    return clean;
  }

  export const CITY_LOCALIZATIONS = {
    "kaliningrad": "Калининград",
    "moscow": "Москва",
    "saint petersburg": "Санкт-Петербург",
    "st petersburg": "Санкт-Петербург",
    "st. petersburg": "Санкт-Петербург",
    "saint-petersburg": "Санкт-Петербург",
    "spb": "Санкт-Петербург",
    "novosibirsk": "Новосибирск",
    "yekaterinburg": "Екатеринбург",
    "ekaterinburg": "Екатеринбург",
    "nizhny novgorod": "Нижний Новгород",
    "kazan": "Казань",
    "chelyabinsk": "Челябинск",
    "omsk": "Омск",
    "samara": "Самара",
    "rostov-on-don": "Ростов-на-Дону",
    "rostov on don": "Ростов-на-Дону",
    "rostov": "Ростов-на-Дону",
    "ufa": "Уфа",
    "krasnoyarsk": "Красноярск",
    "voronezh": "Воронеж",
    "perm": "Пермь",
    "volgograd": "Волгоград",
    "krasnodar": "Краснодар",
    "saratov": "Саратов",
    "tyumen": "Тюмень",
    "tolyatti": "Тольятти",
    "izhevsk": "Ижевск",
    "barnaul": "Барнаул",
    "ulyanovsk": "Ульяновск",
    "irkutsk": "Иркутск",
    "khabarovsk": "Хабаровск",
    "yaroslavl": "Ярославль",
    "vladivostok": "Владивосток",
    "makhachkala": "Махачкала",
    "tomsk": "Томск",
    "orenburg": "Оренбург",
    "kemerovo": "Кемерово",
    "novokuznetsk": "Новокузнецк",
    "ryazan": "Рязань",
    "astrakhan": "Астрахань",
    "penza": "Пенза",
    "naberezhnye chelny": "Набережные Челны",
    "lipetsk": "Липецк",
    "tula": "Тула",
    "kirov": "Киров",
    "cheboksary": "Чебоксары",
    "kaluga": "Калуга",
    "bryansk": "Брянск",
    "kursk": "Курск",
    "ivanovo": "Иваново",
    "magnitogorsk": "Магнитогорск",
    "tver": "Тверь",
    "stavropol": "Ставрополь",
    "simferopol": "Симферополь",
    "sevastopol": "Севастополь",
    "sochi": "Сочи",
    "belgorod": "Белгород",
    "vladimir": "Владимир",
    "arhangelsk": "Архангельск",
    "arkhangelsk": "Архангельск",
    "chita": "Чита",
    "smolensk": "Смоленск",
    "kurgan": "Курган",
    "cherepovets": "Череповец",
    "vologda": "Вологда",
    "saransk": "Саранск",
    "orel": "Орёл",
    "oryol": "Орёл",
    "yakutsk": "Якутск",
    "vladikavkaz": "Владикавказ",
    "grozny": "Грозный",
    "murmansk": "Мурманск",
    "tambov": "Тамбов",
    "petrozavodsk": "Петрозаводск",
    "kostroma": "Кострома",
    "taganrog": "Таганрог",
    "sterlitamak": "Стерлитамак",
    "petropavlovsk-kamchatsky": "Петропавловск-Камчатский",
    "viluchinsk": "Вилючинск",
    "vilyuchinsk": "Вилючинск",
    "nalchik": "Нальчик",
    "minsk": "Минск",
    "almaty": "Алматы",
    "astana": "Астана",
    "yerevan": "Ереван",
    "tbilisi": "Тбилиси",
    "baku": "Баку",
    "tashkent": "Ташкент",
    "bishkek": "Бишкек",
    "dushanbe": "Душанбе",
    "ashgabat": "Ашхабад",
    "chisinau": "Кишинёв",
    "kiev": "Киев",
    "kyiv": "Киев"
  };

  const CITY_CANONICAL_SLUGS = {
    "st petersburg": "saint_petersburg",
    "st. petersburg": "saint_petersburg",
    "saint-petersburg": "saint_petersburg",
    "spb": "saint_petersburg",
    "ekaterinburg": "yekaterinburg",
    "rostov-on-don": "rostov_on_don",
    "rostov on don": "rostov_on_don",
    "rostov": "rostov_on_don",
    "arhangelsk": "arkhangelsk",
    "orel": "oryol",
    "viluchinsk": "vilyuchinsk",
    "petropavlovsk-kamchatsky": "petropavlovsk_kamchatsky",
    "kiev": "kyiv",
    "chisinau": "chisinau"
  };

  const CYR_CITY_TO_SLUG = (() => {
    const map = {};
    for (const [k, ruVal] of Object.entries(CITY_LOCALIZATIONS)) {
      const slug = CITY_CANONICAL_SLUGS[k] || k.replace(/[\s\-]+/g, "_");
      const ruLower = String(ruVal || "").toLowerCase().trim();
      if (ruLower && !map[ruLower]) map[ruLower] = slug;
    }
    return map;
  })();

  export function resolveCityName(city, lang = null) {
    const raw = String(city || "").trim();
    if (!raw) return "";
    const curLang = lang || getActiveLang();
    const isCyr = (curLang === "ru" || curLang === "uk");
    const lower = raw.toLowerCase();
    const slug = CITY_CANONICAL_SLUGS[lower] || (CITY_LOCALIZATIONS[lower] ? lower.replace(/[\s\-]+/g, "_") : null) || CYR_CITY_TO_SLUG[lower] || null;
    if (slug && typeof window !== "undefined" && typeof window.t === "function") {
      const key = `cities.${slug}`;
      const val = window.t(key, {}, "");
      if (val && val !== key) return val;
    }
    if (isCyr && CITY_LOCALIZATIONS[lower]) {
      return CITY_LOCALIZATIONS[lower];
    }
    return raw;
  }

  export function formatCallerLocation(countryInfo, city = "", lang = null) {
    const curLang = lang || getActiveLang();
    let cName = "";
    if (countryInfo && typeof countryInfo === "object") {
      cName = resolveCountryDisplayName(countryInfo, curLang);
    } else if (typeof countryInfo === "string") {
      cName = countryInfo.trim();
    }
    let cCity = (city || "").trim();
    const cCityLower = cCity.toLowerCase();
    if (cCityLower === "none" || cCityLower === "unknown" || cCityLower === "n/a" || cCityLower.includes("ask admin")) {
      cCity = "";
    }
    if (cCity) {
      cCity = resolveCityName(cCity, curLang);
    }
    if (cName && cCity) {
      if (cCity.toLowerCase() === cName.toLowerCase()) {
        return cName;
      }
      return `${cName}, ${cCity}`;
    }
    return cName || cCity || "";
  }

  const BM_COMMON_TG_MAP = {
    250: "Russia (General / CIS)",
    2501: "Russia 1 (National)",
    2502: "Moscow & Moscow Region",
    2503: "St. Petersburg & NWFD",
    2504: "Central Federal District",
    2505: "Southern & Caucasus FD",
    2506: "Volga Federal District",
    2507: "Ural Federal District",
    2508: "Siberian Federal District",
    2509: "Far Eastern Federal District",
    25011: "Kaliningrad Oblast",
    25020: "ROSHAM Conference",
    25033: "Leningrad Oblast",
    250002: "Russia / Ufa",
    250016: "Russia / Nizhnekamsk",
    250023: "Russia / Krasnodar",
    250024: "Russia / Krasnoyarsk",
    250025: "Russia / Vladivostok",
    250034: "Russia / Volgograd",
    250036: "Russia / Voronezh",
    250039: "Russia / Kaliningrad",
    250052: "Russia / Nizhny Novgorod",
    250054: "Russia / Novosibirsk",
    250055: "Russia / Omsk",
    250059: "Russia / Perm",
    250061: "Russia / Rostov-on-Don",
    250063: "Russia / Samara",
    250064: "Russia / Saratov",
    250066: "Russia / Yekaterinburg",
    250070: "Russia / Tomsk",
    250072: "Russia / Tyumen",
    250074: "Russia / Chelyabinsk",
    250082: "Russia / Crimea",
    250351: "Russia / Chelyabinsk",
    250601: "Volgograd Oblast",
    250602: "Rostov Oblast",
    250603: "Armenia / Repeater",
    250608: "Russia / Sochi",
    250621: "Russia / Moscow",
    250641: "Krasnodar Krai",
    250647: "Stavropol Krai",
    250707: "Russia / Sevastopol",
    250777: "Russia / Kaliningrad",
    250812: "Russia / St. Petersburg",
    250907: "Primorsky Krai",
    91: "Worldwide",
    92: "Europe",
    113: "English WW",
    262: "Germany",
    310: "TAC 310",
    9990: "Parrot (Echo Test)",
    4000: "Disconnect (Unlink)"
  };

  export function getHotspotNetworkType(hidOrCard = null) {
    if (typeof window === "undefined") return "bm";
    let hid = null;
    let cardEl = null;
    if (hidOrCard && typeof hidOrCard === "object" && hidOrCard.dataset) {
      cardEl = hidOrCard;
      hid = hidOrCard.dataset.hotspotId;
    } else if (typeof hidOrCard === "string" && hidOrCard.trim()) {
      hid = hidOrCard.trim();
    }
    if (!hid) {
      hid = window.activeHotspotId || "default";
    }
    const resolveFn = typeof window.resolveHotspotId === "function" ? window.resolveHotspotId : (x => x || "default");
    const resolved = resolveFn(hid);
    const list = Array.isArray(window.currentHotspots) ? window.currentHotspots : [];
    const hs = list.find(h => h && (h.id === resolved || h.id === hid)) || (resolved === "default" ? list[0] : null);
    if (hs && hs.network_type) {
      return String(hs.network_type).toLowerCase();
    }
    if (!cardEl && typeof document !== "undefined") {
      cardEl = document.querySelector(`.radio-container[data-hotspot-id="${resolved}"]`)
        || (resolved !== hid ? document.querySelector(`.radio-container[data-hotspot-id="${hid}"]`) : null);
    }
    if (cardEl && cardEl.classList) {
      if (cardEl.classList.contains("card-net-ysf")) return "ysf";
      if (cardEl.classList.contains("card-net-m17")) return "m17";
      if (cardEl.classList.contains("card-net-allstar")) return "allstar";
      if (cardEl.classList.contains("card-net-xlx")) return "xlx";
      if (cardEl.classList.contains("card-net-tgif")) return "tgif";
      if (cardEl.classList.contains("card-net-freedmr")) return "freedmr";
      if (cardEl.classList.contains("card-net-dmrplus")) return "dmrplus";
      if (cardEl.classList.contains("card-net-adn")) return "adn";
      const dsNet = String((cardEl.dataset && cardEl.dataset.networkType) || "").toLowerCase();
      if (dsNet && dsNet !== "bm") return dsNet;
    }
    try {
      const cachedNet = localStorage.getItem(`proxdmr_net_type_${resolved}`) || (hid ? localStorage.getItem(`proxdmr_net_type_${hid}`) : "");
      if (cachedNet) return String(cachedNet).toLowerCase();
    } catch (_) {}
    if (cardEl && cardEl.dataset && cardEl.dataset.networkType) {
      return String(cardEl.dataset.networkType).toLowerCase();
    }
    return "bm";
  }

  export function getNetworkRawTgName(tg, networkType = null) {
    const sTg = String(tg || "").trim();
    if (!sTg) return "";
    const nTg = parseInt(sTg, 10);
    const net = (networkType || getHotspotNetworkType()).toLowerCase();
    if (net === "tgif") {
      if (nTg === 4000) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.4000_short", {}, "Disconnect (Unlink)") : "Disconnect (Unlink)";
      if (nTg === 9990) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.9990", {}, "Parrot (Echo)") : "Parrot (Echo)";
      const tgifMap = (typeof window !== "undefined" && window.TGIF_TG_NAMES) || {};
      if (tgifMap[sTg]) return String(tgifMap[sTg]).trim();
      if (nTg === 31665) return "TGIF The Mothership";
      if (nTg === 777) return "TGIF Multi-Lang";
      return "";
    }
    if (net === "xlx") {
      if (nTg === 4000) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.4000", {}, "Unlink") : "Unlink";
      if (nTg === 9) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.xlx_reflector_call_ts2", {}, "Reflector Call (TS2)") : "Reflector Call (TS2)";
      if (nTg >= 4001 && nTg <= 4026) {
        const modLetter = String.fromCharCode(65 + (nTg - 4001));
        return (typeof window !== "undefined" && window.t) ? window.t("tg_special.xlx_module", { mod: modLetter }, `Module ${modLetter}`) : `Module ${modLetter}`;
      }
      return "";
    }
    if (net === "dmrplus") {
      if (nTg === 4000) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.4000", {}, "Unlink") : "Unlink";
      if (nTg === 9990) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.9990", {}, "Parrot (Echo)") : "Parrot (Echo)";
      if (nTg >= 4001 && nTg <= 4999) {
        return (typeof window !== "undefined" && window.t) ? window.t("tg_special.dmrplus_reflector", { id: nTg }, `Reflector ${nTg}`) : `Reflector ${nTg}`;
      }
    }
    if (net === "adn") {
      if (nTg === 4000) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.4000_short", {}, "Disconnect (Unlink)") : "Disconnect (Unlink)";
      if (nTg === 9990) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.9990", {}, "Parrot (Echo)") : "Parrot (Echo)";
      const adnMap = (typeof window !== "undefined" && window.ADN_TG_NAMES) || {};
      if (adnMap[sTg]) return String(adnMap[sTg]).trim();
      const fdmrMap = (typeof window !== "undefined" && window.FREEDMR_TG_NAMES) || {};
      if (fdmrMap[sTg]) return String(fdmrMap[sTg]).trim();
      const bmMap = (typeof window !== "undefined" && window.TG_NAMES) || {};
      return bmMap[sTg] ? String(bmMap[sTg]).trim() : "";
    }
    if (net === "freedmr") {
      if (nTg === 4000) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.4000_short", {}, "Disconnect (Unlink)") : "Disconnect (Unlink)";
      if (nTg === 9990) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.9990", {}, "Parrot (Echo)") : "Parrot (Echo)";
      const fdmrMap = (typeof window !== "undefined" && window.FREEDMR_TG_NAMES) || {};
      if (fdmrMap[sTg]) return String(fdmrMap[sTg]).trim();
      const bmMap = (typeof window !== "undefined" && window.TG_NAMES) || {};
      return bmMap[sTg] ? String(bmMap[sTg]).trim() : "";
    }
    if (net === "ysf" || net === "allstar" || net === "m17") {
      return "";
    }
    const bmMap = (typeof window !== "undefined" && window.TG_NAMES) || {};
    return bmMap[sTg] ? String(bmMap[sTg]).trim() : "";
  }

  export function getCleanTgDesc(tg, rawName, lang = null, networkType = null) {
    const sTg = String(tg || "").trim();
    let str = String(rawName || "").trim();
    const curLang = lang || getActiveLang();
    const isCyr = (curLang === "ru" || curLang === "uk");
    const net = networkType ? String(networkType).toLowerCase() : "";

    const stripOuterBrackets = (s) => {
      let r = String(s || "").trim();
      while ((r.startsWith("(") && r.endsWith(")")) || (r.startsWith("[") && r.endsWith("]"))) {
        r = r.slice(1, -1).trim();
      }
      return r;
    };

    // Network-specific handling for TGIF, XLX, DMR+
    if (net === "tgif") {
      if (sTg === "4000") return (typeof window !== "undefined" && window.t) ? window.t("tg_special.4000_short", {}, "Disconnect") : "Disconnect";
      if (sTg === "9990") return (typeof window !== "undefined" && window.t) ? window.t("tg_special.9990_short", {}, "Parrot") : "Parrot";
      const tgifMap = (typeof window !== "undefined" && window.TGIF_TG_NAMES) || {};
      const officialTgif = tgifMap[sTg]
        ? String(tgifMap[sTg]).trim()
        : (sTg === "31665" ? "TGIF The Mothership" : (sTg === "777" ? "TGIF Multi-Lang" : ""));
      // If TG exists in TGIF catalog, always prefer TGIF name over any cached BM name
      if (officialTgif) {
        str = officialTgif;
      }
      if (!str) return "";
      str = stripOuterBrackets(str);
      if (sTg) {
        const parenRegex = new RegExp(`\\s*[\\(\\[]\\s*(?:tg|id|call)?[\\s\\-_#:]*${sTg}\\s*[\\)\\]]`, "gi");
        str = str.replace(parenRegex, "").trim();
        const prefixRegex = new RegExp(`^(?:tg|call|unit|id)?[\\s\\-_#:]*${sTg}[\\s\\-_/:]*`, "i");
        str = str.replace(prefixRegex, "").trim();
      }
      const lowerTgif = str.toLowerCase();
      if (!str || lowerTgif === "talkgroup" || lowerTgif === "tg" || lowerTgif === "unknown" || lowerTgif === "неизвестно" || lowerTgif === "невідомо") {
        return "";
      }
      return str;
    }

    if (net === "xlx") {
      const nTg = parseInt(sTg, 10);
      if (nTg === 4000) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.4000", {}, "Unlink") : "Unlink";
      if (nTg === 9) return (typeof window !== "undefined" && window.t) ? window.t("tg_special.xlx_reflector_call", {}, "Reflector Call") : "Reflector Call";
      if (nTg >= 4001 && nTg <= 4026) {
        const modLetter = String.fromCharCode(65 + (nTg - 4001));
        return (typeof window !== "undefined" && window.t) ? window.t("tg_special.xlx_module", { mod: modLetter }, `Module ${modLetter}`) : `Module ${modLetter}`;
      }
    }

    if (net === "dmrplus") {
      const nTg = parseInt(sTg, 10);
      if (nTg >= 4001 && nTg <= 4999) {
        return (typeof window !== "undefined" && window.t) ? window.t("tg_special.dmrplus_reflector", { id: nTg }, `Reflector ${nTg}`) : `Reflector ${nTg}`;
      }
    }

    if (net === "ysf" || net === "m17") {
      if (!str || str === sTg || str.toLowerCase() === "unknown" || str.toLowerCase() === "неизвестно" || str.toLowerCase() === "невідомо") {
        return "";
      }
      return stripOuterBrackets(str);
    }

    // 1. Resolve well-known worldwide / system TalkGroups
    if (sTg && GLOBAL_TG_MAP[sTg]) {
      const fbGlobal = GLOBAL_TG_MAP[sTg][curLang] || GLOBAL_TG_MAP[sTg].en || GLOBAL_TG_MAP[sTg].ru || "";
      if (typeof window !== "undefined" && typeof window.t === "function") {
        const gKey = `tg_special.${sTg}`;
        const gT = window.t(gKey, {}, fbGlobal);
        if (gT && gT !== gKey) return stripOuterBrackets(gT);
      }
      return stripOuterBrackets(fbGlobal);
    }

    // 2. Resolve 3-digit Country TalkGroups (e.g. 255 -> Ukraine, 401 -> Kazakhstan, 283 -> Armenia, 262 -> Germany, etc.)
    if (sTg && sTg.length === 3 && DMR_MCC_MAP[sTg]) {
      const mcc = DMR_MCC_MAP[sTg];
      const iso = emojiToIso(mcc.flag);
      if (iso) {
        const locName = getLocalizedCountryName(iso, isCyr ? mcc.name : mcc.name_en, curLang);
        if (locName) return stripOuterBrackets(locName);
      }
      return stripOuterBrackets(isCyr ? mcc.name : (mcc.name_en || mcc.name));
    }

    // 3. Resolve region for Russian TG 250001 - 250099
    let knownRegion = null;
    if (sTg && sTg.length === 6 && sTg.startsWith("2500")) {
      const code = sTg.slice(4);
      if (BM_RUSSIA_REGIONS[code]) {
        knownRegion = resolveRussiaRegionName(code, curLang);
      }
    } else if (sTg && BM_COMMON_TG_MAP[sTg]) {
      knownRegion = resolveCommonTgName(sTg, curLang);
    } else if (sTg && (window.TG_NAMES || {})[sTg]) {
      const predefined = String((window.TG_NAMES || {})[sTg]).trim();
      if (predefined && !predefined.toLowerCase().includes("регион") && predefined !== `TG ${sTg}`) {
        knownRegion = predefined;
      }
    }

    if (knownRegion) {
      knownRegion = stripOuterBrackets(localizeBilingualText(knownRegion, curLang));
    }

    // If no raw name provided but region is known, return region
    if (!str && knownRegion) return knownRegion;
    if (!str) return "";

    str = stripOuterBrackets(localizeBilingualText(str, curLang));

    const lower = str.toLowerCase();

    // Exact match with TG/ID number or "TG 250061"
    if (sTg && (str === sTg || lower === `tg ${sTg.toLowerCase()}` || lower === `id ${sTg.toLowerCase()}`)) {
      return knownRegion || "";
    }

    // Generic placeholder strings with no actual meaningful name
    if (
      lower === "talkgroup" ||
      lower === "talk group" ||
      lower === "tg" ||
      lower === "unknown" ||
      lower === "неизвестно" ||
      lower === "личный dmr id" ||
      lower === "dmr id" ||
      lower === "id" ||
      lower === "группа brandmeister" ||
      lower === "brandmeister group" ||
      lower === "группа bm" ||
      lower === "bm group"
    ) {
      return knownRegion || "";
    }

    // Strip outer parentheses or brackets
    str = stripOuterBrackets(str);

    // Strip redundant occurrences of sTg: "(250061)", "[250061]", "TG 250061", etc.
    if (sTg) {
      const parenRegex = new RegExp(`\\s*[\\(\\[]\\s*(?:tg|id|call|регион|region)?[\\s\\-_#:]*${sTg}\\s*[\\)\\]]`, "gi");
      str = str.replace(parenRegex, "").trim();

      const prefixRegex = new RegExp(`^(?:tg|call|unit|id)?[\\s\\-_#:]*${sTg}[\\s\\-_/:]*`, "i");
      str = str.replace(prefixRegex, "").trim();

      const suffixRegex = new RegExp(`[\\s\\-_/:]+${sTg}$`, "i");
      str = str.replace(suffixRegex, "").trim();
    }

    // If str contains generic "Регион" or "Россия / Регион"
    const hasGenericRegion = /\bрегион\b/i.test(str);
    if (hasGenericRegion && knownRegion) {
      return knownRegion;
    }

    // Remove meaningless generic "Регион <digits>" or isolated "Регион"
    str = str.replace(/(?:^|[\/\-])\s*регион(?:\s+\d+|\s*\(\d+\))?\s*(?:[\/\-]|$)/gi, " ");
    str = str.replace(/^\s*регион\s*$/gi, "");

    // Format Country and City/Region: Option 2 (Country in text AND City in text)
    const countrySlashRegex = /^(?:россия|russia)\s*[\/\-]\s*(.+)$/i;
    let matchCountrySlash = str.match(countrySlashRegex);
    if (!matchCountrySlash && knownRegion) {
      matchCountrySlash = knownRegion.match(countrySlashRegex);
    }
    if (matchCountrySlash) {
      const regionPart = resolveCityName(matchCountrySlash[1].trim(), curLang);
      const cLabel = getLocalizedCountryName("RU", "Russia", curLang);
      return `${cLabel}, ${regionPart}`;
    }

    // Strip leftover punctuation/slashes from start and end
    str = str.replace(/^\s*[\/\-:#]+\s*|\s*[\/\-:#]+\s*$/g, "").trim();

    // Check if what remains is empty or generic
    const cleanLower = str.toLowerCase();
    if (
      !str ||
      cleanLower === "talkgroup" ||
      cleanLower === "tg" ||
      cleanLower === "unknown" ||
      cleanLower === "личный dmr id" ||
      cleanLower === "id" ||
      cleanLower === "регион"
    ) {
      str = knownRegion || "";
    }

    // If string is literally just "Россия", but we know the specific region:
    if (cleanLower === "россия" && knownRegion) {
      str = knownRegion;
    }

    // Re-check countrySlashRegex in case knownRegion was substituted
    const mRegionSlash = str.match(countrySlashRegex);
    if (mRegionSlash) {
      const rPart = resolveCityName(mRegionSlash[1].trim(), curLang);
      const cLabel = getLocalizedCountryName("RU", isCyr ? "Россия" : "Russia", curLang);
      return `${cLabel}, ${rPart}`;
    }

    // Must contain at least one meaningful letter
    const letters = str.replace(/[^\p{L}]/gu, "");
    if (letters.length === 0) {
      return knownRegion || "";
    }

    str = stripOuterBrackets(localizeBilingualText(str, curLang));

    // If str does not contain country prefix yet, prepend country if known
    const cInfo = getCountryInfo(sTg);
    if (cInfo && cInfo.name && cInfo.name !== "Global") {
      const cName = resolveCountryDisplayName(cInfo, curLang);
      if (cName && !str.toLowerCase().includes(cName.toLowerCase())) {
        const cityPart = resolveCityName(str, curLang);
        return `${cName}, ${cityPart}`;
      }
    }

    return str;
  }

  // Canvas context for sub-pixel text measurement
  let _pttMeasureCanvas = null;

  /**
   * Dynamically adjust font size of PTT button subtitle (.ptt-target-desc)
   * Rules:
   * 1. Subtitle font size must be calm and non-aggressive (never compete with main PTT / TG title).
   * 2. Non-aggressive bounds:
   *    - Desktop: max ~10.5px, min ~7.2px
   *    - Mobile: max ~8.2px, min ~6.5px
   * 3. Sizing requirement: at least 90% of the string must fit within available button width.
   *    If 100% fits at >= minPx, scale to fit 100% (capped at maxPx to stay non-aggressive).
   *    If 100% cannot fit at minPx, scale so that at least 90% of the string fits.
   */
  export function adjustPttDescFontSize(descEl, infoEl, text) {
    if (!descEl) return;
    const str = String(text || "").trim();
    if (!str) {
      descEl.style.removeProperty("font-size");
      return;
    }

    const isMobile = window.innerWidth <= 480;

    // 1. Determine font size of text above PTT (.ptt-target-info)
    let baseInfoPx = isMobile ? 10.56 : 14.08;
    if (infoEl) {
      const comp = window.getComputedStyle(infoEl);
      const parsed = parseFloat(comp.fontSize);
      if (!isNaN(parsed) && parsed > 0) {
        baseInfoPx = parsed;
      }
    }

    // 2. Non-aggressive bounds for subtitle font size
    const maxPx = isMobile ? Math.min(8.2, baseInfoPx * 0.78) : Math.min(10.5, baseInfoPx * 0.75);
    const minPx = isMobile ? Math.max(6.5, baseInfoPx * 0.60) : Math.max(7.2, baseInfoPx * 0.50);

    // 3. Determine available width inside PTT button
    let availW = descEl.clientWidth;
    if (!availW || availW < 30) {
      const btn = descEl.closest(".ptt-button");
      availW = btn ? (btn.clientWidth - 14) : (isMobile ? 96 : 120);
    }
    availW = Math.max(30, availW - 4); // 4px safe margin to prevent subpixel ellipsis clipping

    // 4. Measure text width using Canvas 2D
    if (!_pttMeasureCanvas) {
      _pttMeasureCanvas = document.createElement("canvas");
    }
    const ctx = _pttMeasureCanvas.getContext("2d");
    const measure = (t, px) => {
      ctx.font = `600 ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
      return ctx.measureText(t).width;
    };

    // Calculate font size needed to fit 100% of string
    const wFull1px = measure(str, 1.0);
    const fitFullPx = wFull1px > 0 ? (availW / wFull1px) : maxPx;

    // Calculate font size needed to fit at least 90% of string
    const len90 = Math.max(1, Math.ceil(str.length * 0.90));
    const str90 = str.slice(0, len90);
    const w90_1px = measure(str90, 1.0);
    const fit90Px = w90_1px > 0 ? (availW / w90_1px) : maxPx;

    let chosenPx;
    if (fitFullPx >= minPx) {
      // 100% of the string can fit within [minPx, maxPx]!
      // Capped at maxPx so short text does not become aggressive/loud
      chosenPx = Math.min(maxPx, fitFullPx);
    } else {
      // Full string cannot fit at minPx: scale so that at least 90% of the string fits
      chosenPx = Math.min(maxPx, Math.max(minPx, fit90Px));
    }

    // Apply font-size
    descEl.style.setProperty("font-size", `${chosenPx.toFixed(1)}px`, "important");
  }

  export function renderTgTextHtml(tg, prefix, rawName, title, networkType = null) {
    let cleanDesc = getCleanTgDesc(tg, rawName, null, networkType);
    while (cleanDesc && ((cleanDesc.startsWith("(") && cleanDesc.endsWith(")")) || (cleanDesc.startsWith("[") && cleanDesc.endsWith("]")))) {
      cleanDesc = cleanDesc.slice(1, -1).trim();
    }
    const descHtml = cleanDesc ? ` <span class="vfo-tg-desc ts-tg-desc">(${cleanDesc})</span>` : "";
    const pfx = prefix ? (prefix === "#" ? "#" : `${prefix} `) : "";
    const isId = prefix && (prefix.toUpperCase().includes("ID") || prefix.toUpperCase().includes("CALL") || prefix.toUpperCase().includes("UNIT"));
    const typeClass = isId ? "is-id" : "is-tg";
    const valHtml = isId ? `<span class="dmr-id-text">${tg}</span>` : tg;
    return `<span class="vfo-tg-pill ts-tg-pill ${typeClass}" data-tg="${tg}" title="${title}">${pfx}${valHtml}</span>${descHtml}`;
  }

  // --- History Time Zone Display (LOC vs UTC) ---
  export function getHistoryTimeMode() {
    if (typeof window !== "undefined" && (window.__proxdmr_history_time_mode === "UTC" || window.__proxdmr_history_time_mode === "LOC")) {
      return window.__proxdmr_history_time_mode;
    }
    if (typeof localStorage !== "undefined") {
      try {
        const saved = localStorage.getItem("proxdmr_history_time_mode");
        if (saved === "UTC" || saved === "LOC") {
          if (typeof window !== "undefined") window.__proxdmr_history_time_mode = saved;
          return saved;
        }
      } catch (_) {}
    }
    return "LOC";
  }

  export function setHistoryTimeMode(mode) {
    const val = (mode === "UTC") ? "UTC" : "LOC";
    if (typeof window !== "undefined") {
      window.__proxdmr_history_time_mode = val;
    }
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem("proxdmr_history_time_mode", val);
      } catch (_) {}
    }
    updateClockBarActiveState();
    return val;
  }

  export function formatHistoryTime(timestamp, customMode = null) {
    if (timestamp === undefined || timestamp === null || timestamp === "") return "--:--:--";
    const mode = customMode || getHistoryTimeMode();
    let sec = Number(timestamp);
    let ms;
    if (isNaN(sec) || sec <= 0) {
      const parsed = Date.parse(timestamp);
      if (!isNaN(parsed) && parsed > 0) {
        ms = parsed;
      } else {
        return typeof timestamp === "string" && timestamp.includes(":") ? timestamp : "--:--:--";
      }
    } else {
      ms = sec > 1e11 ? sec : sec * 1000;
    }
    const d = new Date(ms);
    if (isNaN(d.getTime())) return "--:--:--";

    if (mode === "UTC") {
      const h = String(d.getUTCHours()).padStart(2, "0");
      const m = String(d.getUTCMinutes()).padStart(2, "0");
      const s = String(d.getUTCSeconds()).padStart(2, "0");
      return `${h}:${m}:${s}`;
    } else {
      const h = String(d.getHours()).padStart(2, "0");
      const m = String(d.getMinutes()).padStart(2, "0");
      const s = String(d.getSeconds()).padStart(2, "0");
      return `${h}:${m}:${s}`;
    }
  }

  export function updateClockBarActiveState() {
    const mode = getHistoryTimeMode();
    document.querySelectorAll(".screen-clock-loc").forEach(el => {
      el.classList.toggle("active", mode === "LOC");
      el.setAttribute("data-time-mode", "LOC");
      el.title = mode === "LOC" 
        ? (window.t ? window.t("log.time_loc_active", {}, "Местное время (LOC) — активно в истории") : "Местное время (LOC) — активно в истории") 
        : (window.t ? window.t("log.time_loc_switch", {}, "Местное время (LOC) — кликните для переключения истории на LOC") : "Местное время (LOC) — кликните для переключения истории на LOC");
    });
    document.querySelectorAll(".screen-clock-utc").forEach(el => {
      el.classList.toggle("active", mode === "UTC");
      el.setAttribute("data-time-mode", "UTC");
      el.title = mode === "UTC" 
        ? (window.t ? window.t("log.time_utc_active", {}, "Время по Гринвичу (UTC) — активно в истории") : "Время по Гринвичу (UTC) — активно в истории") 
        : (window.t ? window.t("log.time_utc_switch", {}, "Время по Гринвичу (UTC) — кликните для переключения истории на UTC") : "Время по Гринвичу (UTC) — кликните для переключения истории на UTC");
    });
    const summaryTimeBadge = document.getElementById("logTxSummaryTimeBadge");
    if (summaryTimeBadge) {
      summaryTimeBadge.textContent = mode;
      summaryTimeBadge.className = `log-tx-summary-time-badge is-${mode.toLowerCase()}`;
      summaryTimeBadge.title = window.t
        ? window.t("log.time_badge_title", { mode: mode }, `Время в истории: ${mode}. Кликните для переключения LOC ↔ UTC`)
        : `Время в истории: ${mode}. Кликните для переключения LOC ↔ UTC`;
    }
    const colDurBadge = document.getElementById("logColDurModeBadge");
    if (colDurBadge) {
      colDurBadge.textContent = mode;
      colDurBadge.className = `log-col-dur-mode-badge is-${mode.toLowerCase()}`;
    }
  }

  if (typeof window !== "undefined") {
    window.getHistoryTimeMode = getHistoryTimeMode;
    window.setHistoryTimeMode = setHistoryTimeMode;
    window.formatHistoryTime = formatHistoryTime;
    window.updateClockBarActiveState = updateClockBarActiveState;
    window.adjustPttDescFontSize = adjustPttDescFontSize;
    window.getHotspotNetworkType = getHotspotNetworkType;
    window.getNetworkRawTgName = getNetworkRawTgName;
    window.getCleanTgDesc = getCleanTgDesc;
    window.renderTgTextHtml = renderTgTextHtml;
    window.resolveCountryDisplayName = resolveCountryDisplayName;
    window.resolveCityName = resolveCityName;
  }

export function safeEscapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
export const escapeHtml = safeEscapeHtml;

export function attachTgLivePreview(inputEl, opts = {}) {
  if (!inputEl || inputEl._tgLivePreviewAttached) return inputEl?._tgLivePreviewCtrl || null;
  inputEl._tgLivePreviewAttached = true;

  const anchorEl = opts.anchorEl || inputEl.parentElement;
  if (!anchorEl) return null;
  anchorEl.style.position = "relative";
  anchorEl.style.overflow = "visible";

  let previewPopup = anchorEl.querySelector(".quick-tg-preview-popup");
  if (!previewPopup) {
    previewPopup = document.createElement("div");
    previewPopup.className = "quick-tg-preview-popup" + (opts.popupClass ? ` ${opts.popupClass}` : "");
    previewPopup.setAttribute("aria-live", "polite");
    anchorEl.appendChild(previewPopup);
  }

  let previewDebounceTimer = null;
  let previewBlurTimer = null;
  let lastRenderedInfo = null;
  if (typeof window !== "undefined" && !window._quickTgPreviewCache) {
    window._quickTgPreviewCache = {};
  }

  const hidePreview = () => {
    if (previewDebounceTimer) {
      clearTimeout(previewDebounceTimer);
      previewDebounceTimer = null;
    }
    if (previewPopup) {
      previewPopup.classList.remove("visible");
    }
  };

  const renderPreview = () => {
    if (!inputEl || !previewPopup) return;
    const rawVal = String(inputEl.value || "");
    const cleanDigits = rawVal.replace(/\D/g, "");
    const num = parseInt(cleanDigits, 10);
    const maxVal = opts.max || 99999999;
    if (!cleanDigits || isNaN(num) || num <= 0 || num > maxVal) {
      lastRenderedInfo = null;
      hidePreview();
      return;
    }

    const cache = (typeof window !== "undefined" && window._quickTgPreviewCache) || {};
    const userCalls = (typeof window !== "undefined" && window.USER_CALLSIGNS) || {};
    const u = userCalls[num];
    const mode = opts.mode || "auto";
    const isPrivate = mode === "id" ? true : (mode === "tg" ? false : Boolean(u || num > 999999));

    const formatUserLoc = (usr) => {
      if (!usr) return "";
      const parts = [];
      if (usr.city) parts.push(usr.city);
      if (usr.state && usr.state !== usr.city) parts.push(usr.state);
      if (usr.country && usr.country !== usr.state && usr.country !== usr.city) parts.push(usr.country);
      return parts.join(", ");
    };

    const formatUserPrefixHint = (usr) => {
      if (!usr) return "";
      const uid = usr.radio_id !== undefined ? usr.radio_id : usr.id;
      const cs = (usr.callsign || "").trim();
      const nm = (usr.name || "").trim();
      const loc = [usr.city, usr.country].filter(Boolean).join(", ");
      const details = [nm, loc].filter(Boolean).join(", ");
      const egPfx = (typeof window !== "undefined" && typeof window.t === "function") ? window.t("tgtx.example_prefix", {}, "↳ Напр.:") : "↳ Напр.:";
      return `<span class="quick-tg-pop-sub">${safeEscapeHtml(egPfx)} <b>ID ${safeEscapeHtml(String(uid))}</b> — <strong>${safeEscapeHtml(cs)}</strong>${details ? ` (${safeEscapeHtml(details)})` : ""}</span>`;
    };

    if (isPrivate) {
      let quoteHtml = "";
      let isKnown = false;
      const idCacheEntry = cache["id_" + num];
      const isIdNotFound = (idCacheEntry === "not_found" || (idCacheEntry && idCacheEntry.status === "not_found"));

      if (u && (u.callsign || u.name)) {
        isKnown = true;
        const cs = (u.callsign || "").trim();
        const nm = (u.name || "").trim();
        const loc = formatUserLoc(u);
        quoteHtml = `<span class="quick-tg-pop-main"><strong>${safeEscapeHtml(cs)}</strong>${nm ? ` — ${safeEscapeHtml(nm)}` : ""}</span>` +
          (loc ? `<span class="quick-tg-pop-sub">${safeEscapeHtml(loc)}</span>` : "");
      } else if (isIdNotFound) {
        const notFoundTxt = (typeof window !== "undefined" && window.t) ? window.t("tgtx.private_id_custom", {}, "Личный вызов DMR ID (нет в базе RadioID)") : "Личный вызов DMR ID (нет в базе RadioID)";
        quoteHtml = `<span class="quick-tg-pop-main">${safeEscapeHtml(notFoundTxt)}</span>`;
      } else {
        const searchTxt = (typeof window !== "undefined" && window.t) ? window.t("tgtx.private_id_searching", {}, "Личный вызов DMR ID • поиск позывного...") : "Личный вызов DMR ID • поиск позывного...";
        quoteHtml = `<span class="quick-tg-pop-main">${safeEscapeHtml(searchTxt)}</span>`;
        if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
        previewDebounceTimer = setTimeout(async () => {
          try {
            const res = await fetch(`/api/dmr/users/search?q=${encodeURIComponent(String(num))}&limit=8`);
            const data = await res.json();
            const list = (data && data.results) || [];
            const getUid = (it) => Number(it && (it.radio_id !== undefined ? it.radio_id : it.id));
            const exact = list.find(it => getUid(it) === num);
            if (exact) {
              const normUser = Object.assign({}, exact, { id: num, radio_id: num });
              if (typeof window !== "undefined") {
                if (!window.USER_CALLSIGNS) window.USER_CALLSIGNS = {};
                window.USER_CALLSIGNS[num] = normUser;
                try { localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify(window.USER_CALLSIGNS)); } catch (_) {}
              }
              cache["id_" + num] = { status: "found", prefixUser: null };
            } else {
              cache["id_" + num] = { status: "not_found", prefixUser: null };
            }
          } catch (_) {
            cache["id_" + num] = { status: "not_found", prefixUser: null };
          }
          if (inputEl && String(inputEl.value || "").replace(/\D/g, "") === String(num)) {
            renderPreview();
          }
        }, 120);
      }

      const cInfo = (isKnown || String(num).length >= 7)
        ? getCountryInfo(num, u?.callsign || "", u?.country || "")
        : { name: "Global", name_en: "", flag: "🌐" };
      const flagHtml = getFlagBadgeHtml(cInfo, false);
      const cResolved = (cInfo && cInfo.name && cInfo.name !== "Global") ? resolveCountryDisplayName(cInfo) : "";
      const cLabel = cResolved || "DMR ID";

      lastRenderedInfo = {
        num,
        isPrivate: true,
        isKnown,
        user: u || null,
        cleanDesc: u ? [u.callsign, u.name].filter(Boolean).join(" ").trim() : "",
        country: cResolved
      };

      const hintText = typeof opts.actionHint === "function"
        ? opts.actionHint(lastRenderedInfo)
        : (opts.actionHint !== undefined ? opts.actionHint : "TX ⏎");

      previewPopup.innerHTML = `
        <div class="quick-tg-pop-header">
          <span class="quick-tg-pop-flag">${flagHtml}</span>
          <span class="quick-tg-pop-badge is-id">ID ${num}</span>
          <span class="quick-tg-pop-country">${safeEscapeHtml(cLabel)}</span>
          ${hintText ? `<span class="quick-tg-pop-tx-hint">${safeEscapeHtml(hintText)}</span>` : ""}
        </div>
        <div class="quick-tg-pop-quote ${isKnown ? "is-known" : "is-unknown"}">
          ${quoteHtml}
        </div>
      `;
      previewPopup.classList.add("visible");
      return;
    }

    // TalkGroup (network-aware, exact typed number only)
    const isParrot = (num === 9990);
    const isUnlink = (num === 4000);
    const cardEl = inputEl && inputEl.closest ? inputEl.closest(".radio-container") : null;
    const netType = getHotspotNetworkType(cardEl || opts.hotspotId);
    const parrotFullFallback = (typeof window !== "undefined" && window.t) ? window.t("tg_special.parrot_echo_full", {}, "Parrot / Echo (Эхо-тест)") : "Parrot / Echo (Эхо-тест)";
    const rawName = getNetworkRawTgName(num, netType) || (isParrot ? parrotFullFallback : "");
    let cleanDesc = getCleanTgDesc(num, rawName, null, netType);
    const isNonMccNet = (netType === "tgif" || netType === "xlx");
    const tgCacheKey = `tg_${netType}_${num}`;

    let quoteHtml = "";
    let isKnown = false;

    if (cleanDesc) {
      isKnown = true;
      quoteHtml = `<span class="quick-tg-pop-main">«${safeEscapeHtml(cleanDesc)}»</span>`;
    } else if (cache[tgCacheKey]) {
      const cached = cache[tgCacheKey];
      if (cached.exactName) {
        isKnown = true;
        cleanDesc = cached.exactName;
        quoteHtml = `<span class="quick-tg-pop-main">«${safeEscapeHtml(cached.exactName)}»</span>`;
      } else {
        const customTxt = (typeof window !== "undefined" && window.t) ? window.t("tgtx.custom_group_hint", { tg: num }, `Группа TG ${num} (вне справочника)`) : `Группа TG ${num} (вне справочника)`;
        quoteHtml = `<span class="quick-tg-pop-main">${safeEscapeHtml(customTxt)}</span>`;
      }
    } else {
      const typingTxt = (typeof window !== "undefined" && window.t) ? window.t("tgtx.typing_group_hint", { tg: num }, `Группа TG ${num} • проверка...`) : `Группа TG ${num} • проверка...`;
      quoteHtml = `<span class="quick-tg-pop-main">${safeEscapeHtml(typingTxt)}</span>`;
      if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
      previewDebounceTimer = setTimeout(async () => {
        try {
          const promises = [
            fetch(`/api/tg/search?q=${encodeURIComponent(String(num))}&limit=8&network=${encodeURIComponent(netType)}`).then(r => r.json()).catch(() => null)
          ];
          if (mode === "auto" && num >= 100) {
            promises.push(
              fetch(`/api/dmr/users/search?q=${encodeURIComponent(String(num))}&limit=5`).then(r => r.json()).catch(() => null)
            );
          }
          const [data, userData] = await Promise.all(promises);
          const list = (data && data.results) || [];
          const exact = list.find(r => Number(r.tg) === num);
          let exactClean = "";
          if (exact && exact.name) {
            exactClean = getCleanTgDesc(num, exact.name, null, netType) || exact.name;
            if (typeof window !== "undefined") {
              if (netType === "tgif") {
                if (!window.TGIF_TG_NAMES) window.TGIF_TG_NAMES = {};
                window.TGIF_TG_NAMES[num] = exact.name;
              } else if (netType === "freedmr") {
                if (!window.FREEDMR_TG_NAMES) window.FREEDMR_TG_NAMES = {};
                window.FREEDMR_TG_NAMES[num] = exact.name;
              } else if (netType === "adn") {
                if (!window.ADN_TG_NAMES) window.ADN_TG_NAMES = {};
                window.ADN_TG_NAMES[num] = exact.name;
              } else {
                if (!window.TG_NAMES) window.TG_NAMES = {};
                window.TG_NAMES[num] = exact.name;
              }
            }
          }
          if (userData && Array.isArray(userData.results)) {
            const getUid = (it) => Number(it && (it.radio_id !== undefined ? it.radio_id : it.id));
            const exactUser = userData.results.find(it => getUid(it) === num);
            if (exactUser && !exactClean) {
              const normUser = Object.assign({}, exactUser, { id: num, radio_id: num });
              if (typeof window !== "undefined") {
                if (!window.USER_CALLSIGNS) window.USER_CALLSIGNS = {};
                window.USER_CALLSIGNS[num] = normUser;
                try { localStorage.setItem("proxdmr_user_callsigns_cache", JSON.stringify(window.USER_CALLSIGNS)); } catch (_) {}
              }
            }
          }
          cache[tgCacheKey] = { exactName: exactClean, prefix: null, prefixUser: null };
        } catch (_) {
          cache[tgCacheKey] = { exactName: "", prefix: null, prefixUser: null };
        }
        if (inputEl && String(inputEl.value || "").replace(/\D/g, "") === String(num)) {
          renderPreview();
        }
      }, 120);
    }

    const canResolveMccCountry = !isNonMccNet && !isParrot && !isUnlink && (isKnown || (String(num).length === 3 && Boolean(DMR_MCC_MAP[String(num)])));
    const cInfo = isNonMccNet
      ? { name: netType.toUpperCase(), name_en: netType.toUpperCase(), flag: "🌐" }
      : (canResolveMccCountry ? getCountryInfo(num, "", "") : { name: "Global", name_en: "", flag: "🌐" });
    const flagHtml = getFlagBadgeHtml(cInfo, isParrot);
    const cResolved = (!isNonMccNet && cInfo && cInfo.name && cInfo.name !== "Global") ? resolveCountryDisplayName(cInfo) : "";
    const parrotShortLbl = (typeof window !== "undefined" && window.t) ? window.t("tg_special.9990_short", {}, "Эхо-тест") : "Эхо-тест";
    const cLabel = isParrot ? parrotShortLbl : (isNonMccNet ? netType.toUpperCase() : (cResolved || "TalkGroup"));

    lastRenderedInfo = {
      num,
      isPrivate: false,
      isKnown,
      user: null,
      cleanDesc: cleanDesc || "",
      country: cResolved
    };

    const hintText = typeof opts.actionHint === "function"
      ? opts.actionHint(lastRenderedInfo)
      : (opts.actionHint !== undefined ? opts.actionHint : "TX ⏎");

    previewPopup.innerHTML = `
      <div class="quick-tg-pop-header">
        <span class="quick-tg-pop-flag">${flagHtml}</span>
        <span class="quick-tg-pop-badge is-tg">TG ${num}</span>
        <span class="quick-tg-pop-country">${safeEscapeHtml(cLabel)}</span>
        ${hintText ? `<span class="quick-tg-pop-tx-hint">${safeEscapeHtml(hintText)}</span>` : ""}
      </div>
      <div class="quick-tg-pop-quote ${isKnown ? "is-known" : "is-unknown"}">
        ${quoteHtml}
      </div>
    `;
    previewPopup.classList.add("visible");
  };

  previewPopup.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof opts.onAction === "function") {
      opts.onAction(lastRenderedInfo);
    }
    hidePreview();
  });

  inputEl.addEventListener("input", () => {
    if (previewBlurTimer) {
      clearTimeout(previewBlurTimer);
      previewBlurTimer = null;
    }
    renderPreview();
  });

  inputEl.addEventListener("focus", () => {
    if (previewBlurTimer) {
      clearTimeout(previewBlurTimer);
      previewBlurTimer = null;
    }
    if (String(inputEl.value || "").trim()) {
      renderPreview();
    }
  });

  inputEl.addEventListener("blur", () => {
    previewBlurTimer = setTimeout(() => {
      hidePreview();
    }, 160);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Enter") {
      hidePreview();
    }
  });

  const ctrl = { hidePreview, renderPreview };
  inputEl._tgLivePreviewCtrl = ctrl;
  return ctrl;
}

if (typeof window !== "undefined") {
  window.safeEscapeHtml = safeEscapeHtml;
  window.escapeHtml = safeEscapeHtml;
  window.attachTgLivePreview = attachTgLivePreview;
}
