# Architektura – Alert Szkolny

## Decyzje

| Temat | Decyzja |
|---|---|
| Zakres instalacji | **Jedna szkoła** na instalację (tabela `school` ma zawsze jeden wiersz). |
| Środowisko | Najpierw **lokalnie**, hosting później. Lokalna baza bez Dockera: `embedded-postgres`. |
| Stos | TypeScript: Fastify + Prisma + PostgreSQL 16, React + Vite + Tailwind. Wspólny pakiet `@alert/shared` (ten sam kod liczy podgląd SMS w przeglądarce i treść wysyłaną przez serwer). |
| Bramki SMS | `fake` (domyślnie, nic nie wychodzi), **SMS-fly.pl** (bramka używana przez szkołę; REST API v2.04, statusy odpytywane), SMSAPI.pl, SerwerSMS.pl; główna + zapasowa z automatycznym przełączeniem. |
| Treść SMS | Start: „jest ewakuowane do…”, potwierdzenie „jest obecne w punkcie zbiórki” wysyłane dopiero po odhaczeniu przez nauczyciela. Szablony edytowalne. |
| Komunikaty | START, UPDATE (zmiana punktu), CANCEL (odwołanie alarmu / powrót do szkoły), CONFIRM (obecność), PICKUP (odbiór – do pozostałych opiekunów). |
| Rodzeństwo | Osobny SMS na każde dziecko. |
| Ćwiczenia | Pełny przebieg na prawdziwych danych; SMS-y do rodziców symulowane; prawdziwy przykład na numery testowe; dopisek „CWICZENIA:”. |
| Nauczyciele | Logowanie hasłem raz na telefonie – sesja przesuwna 365 dni (`TEACHER_SESSION_TTL_DAYS`; dyrekcja 14 dni), odświeżana w bazie i w ciasteczku. Link jednorazowy SMS-em do listy obecności – **odłożony do wdrożenia na serwer** (wymaga publicznego adresu). |
| Grupy odbiorców | Nauczyciele (osobna tabela kontaktów, niezależna od kont), uczniowie (własny numer, opcjonalny), rodzice (opiekunowie z „dostaje SMS”). Wybór: całe grupy, klasy × (uczniowie/rodzice), pojedyncze osoby; jeden SMS na numer. Ten sam kod wyboru (`@alert/shared`) działa na serwerze, w trybie awaryjnym i w telefonie. |
| Wiadomości do grup | Dowolna treść, nadawca z listy zatwierdzonych w bramce, PIN; ta sama kolejka co alarm, niższy priorytet. |
| Pule | Ta sama treść + nadawca → jedno zapytanie z wieloma numerami (SMSAPI `to` po przecinku, SerwerSMS `phone[]`); SMS-fly – równoległe pojedyncze zapytania. |
| Odporność na awarię bazy | Kopia awaryjna na serwerze (kontakty, konta, sesje – zaszyfrowane, co 5 min) + dziennik wysyłek bez bazy, dopisywany po powrocie bazy. Kopia kontaktów w urządzeniu (IndexedDB, WebCrypto, klucz z hasła do konta). |
| Otwarte | Wytyczne „mogą ulec zmianie” (szablony, uprawnienia, retencja). Import .xls – wymaga SheetJS z cdn.sheetjs.com (decyzja). |

Hosting docelowo **poza budynkiem szkoły** (VPS w PL/UE): serwer w szkole może zostać bez prądu w trakcie
ewakuacji, a raporty doręczeń z bramek wymagają publicznego HTTPS.

## Komponenty

```
[Telefon/PC dyrekcji]            [Telefon nauczyciela – PWA, kolejka offline]
            \                          /
             ▼                        ▼
       web: React SPA  ──(REST + SSE)──▶  api: Fastify
   (kopia kontaktów w IndexedDB,           │   ├─ worker kolejki SMS (w tym samym procesie)
    szyfrowana; tryb awaryjny)             │   ├─ monitor bazy (co 5 s) → tryb awaryjny
                                           │   ├─ kopia awaryjna + dziennik wysyłek (.data/emergency, szyfrowane)
                                           │   └─ /api/webhooks/* ◀── raporty doręczeń z bramek
                                           ▼
                                     PostgreSQL 16
                       (dane · kolejka = tabela sms_deliveries · audit log)
                                           │
              worker / tryb awaryjny ──▶ SMS-fly / SMSAPI / SerwerSMS (główna → zapasowa, pule)
```

### Wysyłka

- `sms_deliveries` to jednocześnie historia i kolejka. Worker pobiera partie przez
  `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` – bezpieczne także przy kilku procesach.
- Kolejność: START (priorytet 1) → UPDATE → CANCEL i wiadomości do grup (3) → potwierdzenia/odbiory.
- Partia do 200 wiadomości; w niej grupy z tą samą treścią i nadawcą, cięte na paczki `SMS_BATCH_SIZE`.
  Paczka → `sendBatch` łańcucha bramek: bramka z pulami dostaje jedno zapytanie, bez pul – `SMS_CONCURRENCY`
  pojedynczych zapytań naraz. Limit `SMS_RATE_PER_SECOND` liczy zapytania (paczka = jedno).
- Wynik dopasowany do numeru (SMSAPI: `list[].number`, odrzucone w `invalid_numbers`; SerwerSMS: `items[].phone`).
  Numer odrzucony przez bramkę → `bad_number`, bez ponowień, w raporcie „Numery do poprawy”.
- Ponowienia błędów przejściowych: 2 s, 5 s, 15 s, 30 s, 60 s → `FAILED`.
- Failover: błąd „po stronie bramki” (token, środki, nadawca, sieć, 5xx) → następna bramka (dla paczki – tylko numery
  z takim błędem); bezpiecznik po 3 awariach z rzędu wyłącza bramkę na 60 s. Błąd odbiorcy (zły numer) nie przełącza. Przy przekroczeniu czasu możliwy duplikat –
  świadomie (lepiej 2 SMS-y niż 0).
- Po restarcie wiadomości przerwane w trakcie (`SENDING`) wracają do kolejki.
- Raporty doręczeń: SMSAPI – callback GET (`MsgId`, `status` 401–412, odpowiedź `OK`); SerwerSMS – `dlr_url`
  z `#SMSID#`/`#STAN#`. Zabezpieczone tokenem `SMS_WEBHOOK_TOKEN`. Tryb fake symuluje raporty.
- Idempotencja: klucz w żądaniu startu (podwójne kliknięcie = ten sam alert), indeks częściowy w bazie
  (najwyżej jeden aktywny alert), unikalność (komunikat, uczeń, opiekun) – bez duplikatów potwierdzeń.

### Na żywo i offline

- SSE `/api/alerts/:id/events` – „coś się zmieniło”, interfejs odświeża dane (najwyżej kilka razy na sekundę);
  dodatkowo odświeżanie co kilka sekund. Jeden proces – przy kilku instancjach trzeba dołożyć Postgres LISTEN/NOTIFY.
- Lista obecności: zmiany do kolejki w `localStorage`, wysyłka po odzyskaniu sieci; serwer przyjmuje zmianę tylko,
  jeśli jest nowsza niż zapisana (czas z telefonu). Ostatnia lista w pamięci telefonu. Service worker (wersja zbudowana)
  pozwala otworzyć aplikację bez sieci.

### Odporność na awarię bazy i serwera

- `lib/dbHealth` – `SELECT 1` co 5 s (limit 4 s); błędy połączenia w zapytaniach też przełączają stan. Połączenie
  z bazą ma krótkie limity (`connect_timeout`, `pool_timeout` = 5 s), żeby awaria była widoczna od razu.
- `emergency/snapshot` – kopia: kontakty z numerami, konta (bez haseł), sesje po 2FA; AES-256-GCM kluczem z `.env`,
  zapis atomowy. Sesje sprawdzone w bazie są dopisywane do kopii w pamięci (zapis co minutę), wylogowanie
  i dezaktywacja usuwają je z kopii. Bez bazy: sesja i PIN sprawdzane z kopii (blokada PIN-u w pamięci).
- `emergency/journal` – wysyłka bez bazy: od razu do bramki (pule, 3 rundy ponowień), przebieg w zaszyfrowanym pliku.
  Po powrocie bazy (lub co minutę, gdy działa) → `notices` (`emergency = true`) + `sms_deliveries` ze statusami
  + wpis `emergency.send` w dzienniku; klucz idempotencji `emergency:<id>`. Przerwane wysyłki – pozycje „FAILED”
  do ponowienia.
- Start serwera bez bazy: kopia z dysku, kolejka czeka; po powrocie bazy: szablony, przywrócenie przerwanych
  wysyłek, dziennik awaryjny, nowa kopia, retencja.
- Urządzenie (`web/lib/offline`): para RSA-OAEP; klucz prywatny zaszyfrowany kluczem z hasła do konta (PBKDF2-SHA256,
  600 000 iteracji); każda synchronizacja (co 15 min, w tle, bez hasła) szyfruje kontakty nowym kluczem AES-GCM
  zawiniętym kluczem publicznym. Odczyt tylko z hasłem. Pobranie (`/api/offline/directory`) i działania offline
  (`/api/offline/journal`) są w dzienniku zdarzeń.

## Model danych

| Tabela | Zawartość |
|---|---|
| `school` | nazwa, krótka nazwa do SMS, adres, telefon kontaktowy, nadawca SMS |
| `users` | e-mail, rola, hash hasła, sekret TOTP (szyfrowany), hash PIN-u + licznik błędów, blokady |
| `sessions`, `user_recovery_codes` | sesje (hash tokenu, `mfa_ok`), kody zapasowe 2FA |
| `assembly_points`, `classes`, `students` | punkty zbiórki, klasy z domyślnym punktem, uczniowie (bez PESEL) |
| `guardians`, `student_guardians` | numer szyfrowany + HMAC; kolejność, „dostaje SMS”, „może odebrać dziecko” |
| `teachers` | nauczyciele i pracownicy: imię, nazwisko, funkcja, numer szyfrowany + HMAC (unikalny) |
| `students.phone_enc/phone_hmac` | własny numer ucznia (opcjonalny) |
| `notices` | wiadomości do grup: treść, nadawca, wybór odbiorców (JSON), opis, liczby, tryb awaryjny, retencja |
| `test_numbers` | numery do SMS-ów testowych i ćwiczeń (szyfrowane) |
| `event_types`, `sms_templates` | typy zdarzeń, szablony (wersja, kto zmienił) |
| `alerts` | tryb, status, zdarzenie, instrukcja odbioru, zakres, kto i kiedy, klucz idempotencji, retencja |
| `alert_classes`, `alert_students` | kopia klas i uczniów z chwili alertu, punkt zbiórki, obecność, odbiór |
| `alert_messages` | fale komunikatów z treścią szablonu |
| `sms_deliveries`, `delivery_events` | każdy SMS (alert albo wiadomość – CHECK): odbiorca (numer szyfrowany, `contact_key`, grupa), treść, nadawca, status, `bad_number`, bramka, próby, historia statusów |
| `call_attempts` | telefony do rodziców, do których SMS nie dotarł |
| `import_jobs` | podsumowania importów (bez danych z pliku) |
| `audit_log` | dziennik zdarzeń – tylko do zapisu, łańcuch hashy |

Historia alertu (`alert_*`, `sms_deliveries`) celowo nie ma kluczy obcych do uczniów i opiekunów – przetrwa usunięcie
ich danych; dane osobowe w historii usuwa retencja.

### Dziennik zdarzeń

- Trigger `BEFORE INSERT` pod blokadą doradczą nadaje `id` i liczy `hash = sha256(prev_hash | treść)`.
  Identyfikatory mają przerwy (sekwencja pobierana dwa razy) – zamierzone.
- Triggery blokują `UPDATE`, `DELETE`, `TRUNCATE`; `npm run audit:verify` (lub przycisk) przelicza łańcuch.
- Ograniczenie: osoba z pełnym dostępem do bazy może wyłączyć triggery i przeliczyć łańcuch – przy hostingu warto
  okresowo zapisywać ostatni hash poza serwerem.

## Role

| Uprawnienie | Admin | Dyrekcja | Nauczyciel |
|---|:-:|:-:|:-:|
| Start / zmiana punktu / zakończenie alertu (PIN) | ✔ | ✔ | – |
| Centrum alertu, „nie dotarło”, telefony, raport, historia | ✔ | ✔ | – |
| Lista obecności, odbiór dziecka | ✔ | ✔ | ✔ |
| Wiadomości SMS do grup (PIN), raporty, numery do poprawy | ✔ | ✔ | – |
| Tryb awaryjny, kopia kontaktów w urządzeniu | ✔ | ✔ | – |
| Podgląd uczniów, opiekunów, nauczycieli, klas, punktów, szablonów | ✔ | ✔ | – |
| Edycja danych, import, szablony, typy zdarzeń, numery testowe | ✔ | – | – |
| Użytkownicy | ✔ | – | – |
| Dziennik zdarzeń | ✔ | podgląd | – |
| 2FA | obowiązkowe | obowiązkowe | opcjonalne |

## Import

CSV (UTF-8/UTF-16/Windows-1250, separator wykrywany) lub XLSX; dwa rodzaje: uczniowie z rodzicami (i telefonem
ucznia) albo nauczyciele; kolumny PESEL/adres/e-mail wycinane od razu; podpowiedź mapowania; walidacja numerów
(tylko komórkowe, także zagraniczne); scalanie wierszy ucznia; podgląd zmian z raportem błędów (CSV); zapis w jednej
transakcji; plik tylko w pamięci (30 min); po zapisie odświeżana kopia awaryjna.

## Treść SMS – liczby

Przykład z szablonu (ok. 240–300 znaków): bez polskich znaków (GSM-7) = 2 części, z polskimi znakami (UCS-2) = 4–5.
Licznik wskazuje znaki psujące kodowanie (myślnik „–”, cudzysłowy z Worda); tryb „bez polskich znaków” zamienia je
automatycznie.
