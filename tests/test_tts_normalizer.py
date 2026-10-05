import unittest
from src.tts_normalizer import normalize_callsign_ru, normalize_for_russian_tts


class TestTtsNormalizer(unittest.TestCase):
    def test_callsign_normalization(self):
        self.assertEqual(
            normalize_callsign_ru("R3ABC"),
            "Ро́мио три А́льфа Бра́во Ча́рли"
        )
        self.assertEqual(
            normalize_callsign_ru("UA3AAA/P"),
            "Ю́ниформ А́льфа три А́льфа А́льфа А́льфа дробь Папа́"
        )
        self.assertEqual(
            normalize_callsign_ru("DL1ABC/M"),
            "Дэ́льта Ли́ма один А́льфа Бра́во Ча́рли дробь Майк"
        )

    def test_q_codes_and_abbreviations(self):
        text = "Мой QTH Dilijan, спасибо за QSO и QSL, всем 73 и 88"
        norm = normalize_for_russian_tts(text)
        self.assertIn("Кю-Ти-Эйч", norm)
        self.assertIn("Кю-Эс-О", norm)
        self.assertIn("Кю-Эс-Эл", norm)
        self.assertIn("Семьдесят три", norm)
        self.assertIn("Восемьдесят восемь", norm)

    def test_full_sentence_with_callsign(self):
        text = "Всем 73 от R3ABC, спасибо за QSO!"
        norm = normalize_for_russian_tts(text)
        self.assertEqual(
            norm,
            "Всем Семьдесят три от Ро́мио три А́льфа Бра́во Ча́рли, спасибо за Кю-Эс-О!"
        )

    def test_sheet_q_codes_and_abbreviations(self):
        test_cases = {
            "QTH": "Кю-Ти-Эйч",
            "QSL": "Кю-Эс-Эл",
            "QSO": "Кю-Эс-О",
            "QRZ": "Кю-Эр-Зет",
            "QRM": "Кю-Эр-Эм",
            "QRN": "Кю-Эр-Эн",
            "QRO": "Кю-Эр-О",
            "QRP": "Кю-Эр-Пи",
            "QRT": "Кю-Эр-Ти",
            "QRX": "Кю-Эр-Икс",
            "QRV": "Кю-Эр-Ви",
            "QSY": "Кю-Эс-Вай",
            "QSB": "Кю-Эс-Би",
            "CQ": "Цэ-Кю",
        }
        for code, expected in test_cases.items():
            self.assertEqual(
                normalize_for_russian_tts(f"Передаю {code} на частоте"),
                f"Передаю {expected} на частоте"
            )

    def test_frequencies(self):
        text = "Переходим на 14.150 MHz или 433.500 МГц"
        norm = normalize_for_russian_tts(text)
        self.assertIn("14 точка 150 мегагерц", norm)
        self.assertIn("433 точка 500 мегагерц", norm)

    def test_strip_stress_marks(self):
        from src.tts_normalizer import strip_stress_marks
        self.assertEqual(
            strip_stress_marks("Д+обрый в+ечер, м+ой др+уг, тв+ой сигн+ал 59+20 зд+есь в Чик+аго, мен+я зов+ут Дж+он, 73!"),
            "Добрый вечер, мой друг, твой сигнал 59+20 здесь в Чикаго, меня зовут Джон, 73!"
        )
        self.assertEqual(
            strip_stress_marks("до\u0301брый ве\u0301чер"),
            "добрый вечер"
        )
        self.assertEqual(
            strip_stress_marks("+имя и +я"),
            "имя и я"
        )
        self.assertEqual(
            strip_stress_marks("приві́т, дя́кую, 59+20!"),
            "привіт, дякую, 59+20!"
        )
        self.assertEqual(
            strip_stress_marks("прив+іт, д+якую, 59+20!"),
            "привіт, дякую, 59+20!"
        )

    def test_convert_plus_stress_to_acute(self):
        from src.tts_normalizer import convert_plus_stress_to_acute
        res = convert_plus_stress_to_acute("д+обрый в+ечер, как дел+а? з+амок и зам+ок, 59+20, +ясно")
        self.assertEqual(res, "до\u0301брый ве\u0301чер, как дела\u0301? за\u0301мок и замо\u0301к, 59+20, я\u0301сно")
        # Ukrainian phrases
        uk_res = convert_plus_stress_to_acute("д+обрий в+ечір, д+якую, прив+іт! 59+20")
        self.assertEqual(uk_res, "до\u0301брий ве\u0301чір, дя\u0301кую, приві\u0301т! 59+20")
        # Ensure accidental '+' before consonants is cleanly removed
        self.assertEqual(convert_plus_stress_to_acute("+вместе"), "вместе")

    def test_strip_callsigns_for_tts(self):
        from src.tts_normalizer import strip_callsigns_for_tts
        self.assertEqual(
            strip_callsigns_for_tts("<call>K9CJD</call>: Д+обрый в+ечер, 73!", callsign="K9CJD"),
            "Д+обрый в+ечер, 73!"
        )
        self.assertEqual(
            strip_callsigns_for_tts("Д+обрый в+ечер, 73! <call>R3ABC</call>"),
            "Д+обрый в+ечер, 73!"
        )
        self.assertEqual(
            strip_callsigns_for_tts("<call>KD9CRD</call>"),
            ""
        )
        self.assertEqual(
            strip_callsigns_for_tts("Всем привет от UA0AAA, 73!", callsign="UA0AAA"),
            "Всем привет от, 73!"
        )

    def test_normalize_for_russian_tts_with_callsign_strip(self):
        text = "<call>K9CJD</call>: Д+обрый в+ечер, 59 в Чик+аго, 73!"
        norm = normalize_for_russian_tts(text, strip_callsigns=True, callsign="K9CJD")
        self.assertNotIn("K9CJD", norm)
        self.assertNotIn("Ки́ло", norm)
        self.assertNotIn("Кило", norm)
        self.assertIn("Д+обрый в+ечер", norm)
        self.assertIn("пять девять", norm)
        self.assertIn("Семьдесят три", norm)

    def test_filter_hesitation_fillers(self):
        from src.tts_normalizer import filter_hesitation_fillers
        self.assertEqual(filter_hesitation_fillers("Э, добрый вечер!"), "Добрый вечер!")
        self.assertEqual(filter_hesitation_fillers("Э-э, как слышно?"), "Как слышно?")
        self.assertEqual(filter_hesitation_fillers("Э-Э, как слышно?"), "Как слышно?")
        self.assertEqual(filter_hesitation_fillers("э-Э, приём"), "Приём")
        self.assertEqual(filter_hesitation_fillers("э–э, приём"), "Приём")
        self.assertEqual(filter_hesitation_fillers("э—э, приём"), "Приём")
        self.assertEqual(filter_hesitation_fillers("Привет, э, как дела?"), "Привет, как дела?")
        self.assertEqual(filter_hesitation_fillers("Привет, э-э, как дела?"), "Привет, как дела?")
        self.assertEqual(filter_hesitation_fillers("Привет, э-э... как дела?"), "Привет... Как дела?")
        self.assertEqual(filter_hesitation_fillers("Слышно отлично, э-э."), "Слышно отлично.")
        self.assertEqual(filter_hesitation_fillers("Слышно отлично, э-э"), "Слышно отлично")
        self.assertEqual(filter_hesitation_fillers("Э-э"), "")
        self.assertEqual(filter_hesitation_fillers("Э."), "")
        self.assertEqual(filter_hesitation_fillers("Э-э..."), "")
        self.assertEqual(filter_hesitation_fillers("+э-+э, д+обрый в+ечер"), "Д+обрый в+ечер")
        self.assertEqual(filter_hesitation_fillers("<call>K9CJD</call>: Э-э, добрый вечер, 73!"), "<call>K9CJD</call>: Добрый вечер, 73!")
        self.assertEqual(filter_hesitation_fillers("<call>K9CJD</call>: Э-э"), "")
        self.assertEqual(filter_hesitation_fillers("Понял вас. Э-э, до встречи!"), "Понял вас. До встречи!")

    def test_filter_hesitation_fillers_preserves_real_words(self):
        from src.tts_normalizer import filter_hesitation_fillers
        self.assertEqual(
            filter_hesitation_fillers("Это эхо в эфире, мэр города на связи."),
            "Это эхо в эфире, мэр города на связи."
        )
        self.assertEqual(
            filter_hesitation_fillers("Поэт и дуэт исполнили этот этюд."),
            "Поэт и дуэт исполнили этот этюд."
        )
        self.assertEqual(
            filter_hesitation_fillers("Экраны и электронные приборы настроены."),
            "Экраны и электронные приборы настроены."
        )


    def test_filter_piper_text_by_language_cyrillic_target(self):
        from src.tts_normalizer import filter_piper_text_by_language

        # 1. Short Latin <= 16 chars transliterated to Cyrillic
        self.assertEqual(
            filter_piper_text_by_language("У меня трансивер Yaesu FT-891, приём.", target_lang="ru"),
            "У меня трансивер Яесу ФТ-891, приём."
        )
        self.assertEqual(
            filter_piper_text_by_language("Работает через Wi-Fi и DMR роутер.", target_lang="ru"),
            "Работает через Вай-фай и ДМР роутер."
        )
        self.assertEqual(
            filter_piper_text_by_language("DMR-радиостанция настроена.", target_lang="ru"),
            "ДМР-радиостанция настроена."
        )

        # 2. Long Latin > 16 chars cut out
        text_with_long_foreign = "Всем привет, this is a very long english sentence that must be removed, как слышно?"
        self.assertEqual(
            filter_piper_text_by_language(text_with_long_foreign, target_lang="ru"),
            "Всем привет, как слышно?"
        )

        # 3. Pure long foreign text becomes empty
        pure_foreign = "This is an entirely english sentence with more than sixteen characters."
        self.assertEqual(
            filter_piper_text_by_language(pure_foreign, target_lang="ru"),
            ""
        )

        # 4. Punctuation cleanup when sentence is at the beginning, middle or end
        self.assertEqual(
            filter_piper_text_by_language("This is a long foreign introductory sentence. Всем пока!", target_lang="ru"),
            "Всем пока!"
        )
        self.assertEqual(
            filter_piper_text_by_language("Всем привет! This is a long foreign trailing sentence.", target_lang="ru"),
            "Всем привет!"
        )
        self.assertEqual(
            filter_piper_text_by_language("Всем привет. This is a foreign sentence to cut. До свидания!", target_lang="ru"),
            "Всем привет. До свидания!"
        )
        self.assertEqual(
            filter_piper_text_by_language("Привет this is a foreign sentence to cut. А это русский.", target_lang="ru"),
            "Привет. А это русский."
        )

    def test_filter_piper_text_by_language_latin_target(self):
        from src.tts_normalizer import filter_piper_text_by_language

        # Short Cyrillic <= 16 chars transliterated to Latin
        res = filter_piper_text_by_language("Hello my friend, Спасибо and 73!", target_lang="en")
        self.assertEqual(res, "Hello my friend, Spasibo and 73!")

        # Long Cyrillic > 16 chars cut out
        long_cyr = "Hello everyone, это очень длинное предложение на русском языке которое надо вырезать, over."
        self.assertEqual(
            filter_piper_text_by_language(long_cyr, target_lang="en"),
            "Hello everyone, over."
        )

        # Entirely long Cyrillic becomes empty
        all_cyr = "Это длинное русское предложение полностью на кириллице."
        self.assertEqual(
            filter_piper_text_by_language(all_cyr, target_lang="en"),
            ""
        )

    def test_duplicate_soft_sign_ru(self):
        from src.tts_normalizer import duplicate_soft_sign_ru

        self.assertEqual(duplicate_soft_sign_ru(""), "")
        self.assertIsNone(duplicate_soft_sign_ru(None))
        self.assertEqual(duplicate_soft_sign_ru("Привет всем"), "Привет всем")
        # Soft signs must NOT be doubled anymore
        self.assertEqual(duplicate_soft_sign_ru("День добрый"), "День добрый")
        self.assertEqual(duplicate_soft_sign_ru("только"), "только")
        self.assertEqual(duplicate_soft_sign_ru("дробь"), "дробь")
        self.assertEqual(duplicate_soft_sign_ru("семьдесят восемь"), "семьдесят восемь")
        self.assertEqual(duplicate_soft_sign_ru("А́льфа"), "А́льфа")
        self.assertEqual(duplicate_soft_sign_ru("Дэ́льта Ггольф"), "Дэ́льта Ггольф")
        self.assertEqual(duplicate_soft_sign_ru("ДРОБЬ"), "ДРОБЬ")
        # Idempotency
        s = "День добрый, только семьдесят восемь дробь"
        self.assertEqual(duplicate_soft_sign_ru(s), s)


if __name__ == "__main__":
    unittest.main()

