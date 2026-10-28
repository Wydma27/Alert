# Alert Szkolny

Aplikacja do wysyłania powiadomień SMS w szkole w razie zagrożenia: wiadomości do **nauczycieli, uczniów
i rodziców** (całe grupy, klasy albo wybrane osoby) oraz alarm ewakuacyjny w stylu alertu RCB – rodzic od razu
wie, gdzie jest dziecko. Działa także przy awarii bazy danych lub serwera (tryb awaryjny).

**Wdrażasz w szkole? Zacznij od [docs/WDROZENIE.md](docs/WDROZENIE.md).**
Zgodność z wytycznymi (9 punktów): [docs/WYMAGANIA.md](docs/WYMAGANIA.md).
Architektura, model danych i decyzje: [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md).
Pierwsze ćwiczenia z nauczycielami: [docs/PILOTAZ.md](docs/PILOTAZ.md). Materiał dla IOD: [docs/RODO.md](docs/RODO.md).

## Co potrafi

| Obszar | Funkcje |
|---|---|
| Dane | grupy **nauczyciele / uczniowie / rodzice**, klasy, punkty zbiórki; wszystkie numery szyfrowane; import CSV/XLSX (uczniowie z rodzicami, nauczyciele) z raportem błędnych numerów |
| Wiadomości SMS | całe grupy, klasy (uczniowie i/lub rodzice), pojedyncze osoby; dowolna treść; wybór **nadawcy** (lista zatwierdzonych w bramce); podgląd liczby odbiorców i kosztu; PIN |
| Raporty | przy każdej wiadomości: doręczone / nie dotarło / **błędne numery**, ponowienie nieudanych, CSV; zbiorczo „Numery do poprawy” |
| Tryb awaryjny | baza nie działa → serwer wysyła z zaszyfrowanej kopii kontaktów i dopisuje wysyłki po powrocie bazy; serwer nie działa → **kopia kontaktów w telefonie** (hasło do konta): SMS z telefonu, numery do panelu bramki |
| Szablony SMS | 5 rodzajów komunikatów, edytor ze znacznikami, podgląd na żywo, licznik znaków i części, tryb bez polskich znaków |
| Alarm | kreator w 4 krokach (zdarzenie → zakres → punkty zbiórki → podgląd), PIN alarmowy, cała szkoła / klasy / uczniowie, różne punkty dla klas |
| Kolejne komunikaty | zmiana punktu zbiórki, odwołanie alarmu, automatyczne potwierdzenie obecności, informacja o odbiorze dziecka |
| Wysyłka | **pule**: ta sama treść do wielu numerów jednym zapytaniem (SMSAPI, SerwerSMS), zapytania równolegle; kolejka z ponawianiem i priorytetami (alarm pierwszy), bramka zapasowa z automatycznym przełączeniem, statusy doręczeń |
| Monitoring | centrum alertu na żywo, lista „nie dotarło” z ponowną wysyłką i telefonem do rodzica, raport CSV, historia |
| Lista obecności | na telefonie nauczyciela, duże kafelki, odbiór tylko przez upoważnione osoby, **działa bez zasięgu** |
| Ćwiczenia | cały przebieg na prawdziwych danych, SMS-y do rodziców tylko symulowane, przykład na numery testowe |
| Bezpieczeństwo, RODO | 2FA, role, szyfrowanie numerów, dziennik zdarzeń nie do zmiany, retencja danych alertów, minimalizacja przy imporcie |

## Wymagania

- **Node.js 22 lub nowszy** (sprawdzone na 24).
- Baza PostgreSQL – bez instalacji: `npm run db:local` (PostgreSQL 16 z pakietu npm). Alternatywnie Docker: `npm run db:up`.

## Uruchomienie lokalne

Pierwszy raz:

```bash
npm install          # zależności + generowanie klienta bazy
npm run setup        # .env z losowymi kluczami (szyfrowanie, hasło kont demo, token raportów)
```

```bash
npm run db:local     # terminal 1: baza (zostaw włączoną)
npm run db:deploy    # terminal 2: tabele
npm run db:seed      # fikcyjna szkoła: 10 klas, 121 uczniów, 13 nauczycieli, 3 punkty zbiórki, 3 konta
npm run dev          # API (port 3000) + interfejs (port 5180)
```

Otwórz **http://localhost:5180**. Kolejne uruchomienia: `npm run dev:all` (baza + API + interfejs naraz).

### Konta demonstracyjne

| E-mail | Rola | Logowanie |
|---|---|---|
| `admin@szkola.test` | Administrator | hasło + kod z aplikacji (konfiguracja przy pierwszym logowaniu) |
| `dyrektor@szkola.test` | Dyrekcja | hasło + kod z aplikacji |
| `nauczyciel@szkola.test` | Nauczyciel | samo hasło (2FA opcjonalne) |

Hasło wszystkich kont: `SEED_PASSWORD` w pliku `.env`. Do 2FA potrzebna aplikacja w telefonie
(Google Authenticator, Microsoft Authenticator lub podobna). Zapisz kody zapasowe.

## Jak przeprowadzić ćwiczenia (zalecane na start)

1. **Moje konto** → ustaw **PIN alarmowy** (administrator i dyrekcja).
2. **Test SMS** → dodaj swój numer jako numer testowy.
3. **Pulpit** → **ĆWICZENIA** → wybierz zdarzenie, zakres, punkty zbiórki → podgląd → PIN.
4. Rodzice nic nie dostają (symulacja), a przykładowy SMS z dopiskiem „CWICZENIA” idzie na numery testowe.
5. Nauczyciel loguje się na telefonie → **Lista obecności** → klasa → dotyka uczniów. „Więcej”: nieobecny,
   nieodnaleziony, odebrany przez opiekuna (tylko upoważnione osoby).
6. Dyrekcja w **Centrum alertu** widzi wszystko na żywo, może zmienić punkt zbiórki, zadzwonić do rodziców,
   do których SMS nie dotarł, i zakończyć alarm. Raport CSV i historia zostają.

W trybie `fake` około 5% SMS-ów jest celowo „niedoręczanych” (`FAKE_FAILURE_RATE`), żeby przećwiczyć listę „nie dotarło”.

## Bramki SMS

Domyślnie `SMS_PROVIDER=fake` – **nic nie wychodzi na zewnątrz**. Obsługiwane bramki: **SMS-fly** (sms-fly.pl),
SMSAPI, SerwerSMS. Przykład dla SMS-fly, w `.env`:

```env
SMS_PROVIDER=smsfly
SMSFLY_API_KEY=…                 # panel SMS-fly → Integracja / Ustawienia API → klucz API
SMSFLY_API_URL=https://sms-fly.pl/api/v2/api.php   # adres z tego samego miejsca w panelu
SMS_BACKUP_PROVIDER=none         # opcjonalnie druga bramka: smsapi / serwersms (z jej tokenem)
SMS_USE_DEFAULT_SENDER=true      # dopóki nazwa nadawcy szkoły nie jest zatwierdzona w bramce
```

Potem uruchom serwer ponownie i sprawdź połączenie w **Test SMS** – pokaże saldo i zatwierdzone na koncie nazwy nadawcy.
„Nadawca SMS” w „Dane szkoły” musi być jedną z nich (albo `SMS_USE_DEFAULT_SENDER=true` – wtedy pierwsza zatwierdzona).

SMS-fly pozwala odpytywać statusy, więc **„doręczono / nie doręczono” działa także lokalnie** (sprawdzane co 15 s).

- **Pule**: SMS-y z tą samą treścią i nadawcą idą jednym zapytaniem do wielu numerów – SMSAPI i SerwerSMS
  (`SMS_BATCH_SIZE`, domyślnie 500). SMS-fly przyjmuje jeden numer na zapytanie – wtedy zapytania idą równolegle.
  `SMS_CONCURRENCY` – ile zapytań naraz, `SMS_RATE_PER_SECOND` – limit zapytań na sekundę.
- **Nadawca**: w „Wyślij SMS” lista nazw zatwierdzonych w bramce (SMSAPI, SMS-fly); bez wyboru – nadawca z „Dane szkoły”.
- **Błędne numery**: numer odrzucony przez bramkę jest oznaczany i nie jest ponawiany – trafia do „Numery do poprawy”.

- **Failover**: błąd bramki (token, brak środków, awaria, sieć) → kolejna próba przez zapasową; po 3 awariach z rzędu
  główna jest pomijana przez minutę. Zły numer odbiorcy nie powoduje przełączenia.
- **Ponowienia**: błędy przejściowe ponawiane po 2 s, 5 s, 15 s, 30 s, 60 s, potem status „błąd” i lista „nie dotarło”.
- **Raporty doręczeń** dla SMSAPI i SerwerSMS wymagają publicznego adresu HTTPS (`SMS_CALLBACK_BASE_URL`, po wdrożeniu
  na serwer) – lokalnie kończą na „wysłano”. SMS-fly nie wymaga tego (statusy są odpytywane).
- **Ochrona danych demo**: prawdziwego alarmu nie da się wysłać, dopóki w bazie są numery z danych demonstracyjnych
  (`+48 790 00x xxx` – mogą należeć do obcych osób). Usuń dane demo i zaimportuj prawdziwe.

## Tryb awaryjny (awaria bazy lub serwera)

- Serwer co 5 minut zapisuje **zaszyfrowaną kopię** kontaktów, kont i sesji (`EMERGENCY_DATA_DIR`). Gdy baza nie
  odpowiada (sprawdzane co 5 s), zalogowani pracują dalej, a **Tryb awaryjny** (`/awaryjny`) wysyła SMS-y prosto
  przez bramkę. Przebieg zapisuje się w zaszyfrowanym dzienniku i po powrocie bazy trafia do „Wiadomości”
  (z raportem i ponowieniem) oraz do dziennika zdarzeń. Serwer startuje także bez bazy.
- **Kopia w urządzeniu** („Moje konto”): kontakty szyfrowane w przeglądarce (WebCrypto) kluczem z hasła do konta,
  odświeżane co 15 minut. Bez serwera: SMS z aplikacji SMS telefonu (paczki po 20 numerów), kopiowanie numerów
  lub plik CSV do panelu bramki, lista do dzwonienia. Działania wracają do dziennika zdarzeń po odzyskaniu sieci.
  Wymaga HTTPS (lokalnie: `localhost`).

## Lista obecności bez zasięgu

- Zmiany zapisują się w telefonie i wysyłają same po odzyskaniu sieci (starsza zmiana nie nadpisze nowszej).
- Ostatnio pobrana lista jest pamiętana w telefonie.
- Żeby strona otwierała się bez sieci, użyj wersji zbudowanej (`npm run build && npm start`, poniżej) i dodaj ją do ekranu
  głównego telefonu. W trybie `npm run dev` działa kolejka zmian, ale nie otwieranie strony offline.

## Test na telefonie (ta sama sieć Wi-Fi)

```bash
npm run build
```

W `.env` ustaw `API_HOST=0.0.0.0`, potem `npm start` i otwórz na telefonie `http://<adres-IP-komputera>:3000`
(adres: `ipconfig`). Windows może zapytać o zgodę zapory. Po teście przywróć `API_HOST=127.0.0.1`.
Bez HTTPS telefon nie włączy pracy bez zasięgu ani kopii kontaktów w urządzeniu – to sprawdzisz dopiero na serwerze.

## Przydatne polecenia

| Polecenie | Co robi |
|---|---|
| `npm test` | testy jednostkowe (2FA, szyfrowanie, numery, import, grupy odbiorców, treść SMS, bramki, pule, failover) |
| `npm run typecheck` | sprawdzenie typów we wszystkich pakietach |
| `npm run audit:verify` | weryfikacja integralności dziennika zdarzeń |
| `npm run db:seed` | **czyści** dane szkoły, konta i alerty, wgrywa dane demo (zablokowane przy `NODE_ENV=production`) |
| `npm run db:reset` | usuwa całą bazę i tworzy tabele od nowa (także dziennik) |
| `npm run db:migrate` | nowa migracja po zmianie `apps/api/prisma/schema.prisma` |

## Bezpieczeństwo i RODO

- **Numery telefonów** (nauczyciele, uczniowie, rodzice) szyfrowane w bazie (AES-256-GCM, osobny kontekst dla każdej
  grupy, numerów testowych i kolejki); wyszukiwanie przez HMAC. W interfejsie maskowane, pełny numer na żądanie –
  zawsze z wpisem w dzienniku. Imiona, nazwiska i klasy są jawne (wyszukiwanie) – na serwerze używaj szyfrowanego dysku.
- **Kopie awaryjne** (na serwerze i w urządzeniach) szyfrowane; każde pobranie kopii do urządzenia jest w dzienniku.
- **SMS** zawiera tylko imię dziecka i klasę (bez nazwiska).
- **Logowanie**: argon2id + TOTP (obowiązkowe dla administratora i dyrekcji), kody zapasowe, blokady po błędnych próbach.
- **PIN alarmowy** (osobny od hasła) przy starcie, zmianie punktu i zakończeniu alertu; 5 błędów = blokada 5 minut.
- **Role**: nauczyciel widzi tylko listę obecności (imiona i nazwiska, osoby upoważnione do odbioru) – bez numerów.
- **Dziennik zdarzeń**: kto, kiedy, co (start alertu, każdy komunikat, obecność, telefony, odsłonięcia numerów, zmiany
  szablonów z treścią przed/po). Trigger w bazie blokuje zmiany, łańcuch hashy wykrywa manipulację.
  Pełna lista „do kogo i jaką treść” jest w historii alertu (tabela wysyłek).
- **Retencja**: po `ALERT_RETENTION_DAYS` (domyślnie 365) od zakończenia alertu (i od wysłania wiadomości) usuwane są
  z historii nazwiska, numery i treści SMS; zostają liczby i przebieg.
- **Minimalizacja**: import pomija PESEL, adresy, e-maile; plik importu nie jest zapisywany; usunięcie ucznia usuwa
  numery opiekunów bez innych dzieci w szkole.

### Klucze

`.env` zawiera klucze szyfrowania. **Utrata klucza = utrata numerów telefonów.** Trzymaj kopię klucza oddzielnie
od kopii bazy. `.env` jest w `.gitignore`. Rotacja: dopisz nowy klucz (`v1:…,v2:…`) i ustaw `ENCRYPTION_ACTIVE_KEY_ID=v2`.

## Struktura

```
apps/api        serwer: Fastify, Prisma, PostgreSQL; kolejka SMS i bramki w src/sms, alert w src/alerts,
                wiadomości do grup w src/notices, tryb awaryjny (kopia, dziennik) w src/emergency
apps/web        interfejs: React, Vite, Tailwind; service worker w public/sw.js
packages/shared treść SMS (licznik, szablony), grupy i wybór odbiorców, typy wspólne dla serwera i interfejsu
scripts         generator .env, lokalna baza
sample-data     przykładowy plik do importu
docs            architektura i decyzje
```
