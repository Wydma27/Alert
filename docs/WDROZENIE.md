# Wdrożenie w szkole – instrukcja dla osoby wdrażającej

Alert Szkolny wysyła rodzicom SMS-y o ewakuacji uczniów (gdzie jest dziecko, jak je odebrać), pozwala dyrekcji
śledzić doręczenia i telefonować tam, gdzie SMS nie dotarł, a nauczycielom odhaczać uczniów w punkcie zbiórki
na telefonie – także bez zasięgu. Opis funkcji: [README](../README.md), szczegóły techniczne: [ARCHITEKTURA](ARCHITEKTURA.md).

## Zanim zaczniesz

- **Repozytorium nie zawiera żadnych sekretów ani danych.** Każda instalacja tworzy własny plik `.env`
  (klucze szyfrowania, hasła, klucz bramki SMS) poleceniem `npm run setup`. Pliku `.env` nigdy nie wysyłaj
  i nie dodawaj do repozytorium.
- **Konto w bramce SMS musi należeć do szkoły.** Aplikacja obsługuje SMS-fly (sms-fly.pl), SMSAPI i SerwerSMS.
- **Klucze szyfrowania z `.env` są niezbędne do odczytu numerów telefonów.** Ich utrata = utrata numerów.
  Przechowuj kopię klucza oddzielnie od kopii bazy.

## 1. Uruchomienie próbne (laptop, ok. 15 minut)

Wymagany Node.js 22 lub nowszy. Działa na Windows, macOS i Linux; nie wymaga Dockera ani instalacji PostgreSQL.

```bash
npm install
npm run setup        # tworzy .env
npm run db:local     # osobny terminal – lokalna baza, zostaw włączoną
npm run db:deploy
npm run db:seed      # fikcyjna szkoła do testów
npm run dev          # http://localhost:5180
```

Konta testowe: `admin@szkola.test`, `dyrektor@szkola.test`, `nauczyciel@szkola.test`, hasło w `.env`
(`SEED_PASSWORD`). Administrator i dyrekcja logują się z kodem z aplikacji w telefonie (Google/Microsoft
Authenticator) – skonfigurujesz ją przy pierwszym logowaniu.

W tym trybie SMS-y **nie wychodzą** (`SMS_PROVIDER=fake`) – można bezpiecznie przejść cały alarm i ćwiczenia.

## 2. Gdzie uruchomić na stałe

**Na serwerze poza budynkiem szkoły** (np. VPS w Polsce/UE). Komputer w szkole w czasie ewakuacji może zostać
bez prądu albo w zamkniętym budynku – wtedy alarmu nie da się wysłać ani śledzić. Komputer w szkole nadaje się
tylko do pilotażu.

Przykładowa instalacja na serwerze z Linuksem (Ubuntu/Debian). **Ten przepis nie był jeszcze sprawdzony
na serwerze – przejdź go najpierw na serwerze testowym.**

1. Zainstaluj Node.js 22+, PostgreSQL 16 i serwer HTTPS (np. Caddy).
2. Utwórz bazę i użytkownika w PostgreSQL.
3. Skopiuj repozytorium, potem:
   ```bash
   npm ci
   npm run setup
   ```
4. W `.env` ustaw:
   ```env
   NODE_ENV=production
   DATABASE_URL=postgresql://UŻYTKOWNIK:HASŁO@127.0.0.1:5432/alert
   APP_URL=https://alert.twojaszkola.pl
   API_HOST=127.0.0.1
   ```
5. Utwórz tabele i zbuduj aplikację:
   ```bash
   npm run db:deploy
   npm run build
   npm start            # docelowo jako usługa systemd z automatycznym restartem
   ```
6. HTTPS przez Caddy (`/etc/caddy/Caddyfile`):
   ```
   alert.twojaszkola.pl {
       reverse_proxy 127.0.0.1:3000
   }
   ```
7. **Kopie zapasowe**: codziennie `pg_dump` bazy na inny serwer, zaszyfrowane (np. `pg_dump … | gpg -c`),
   + jednorazowo bezpieczna kopia pliku `.env` (osobno od kopii bazy).
8. **Szyfrowanie dysku** serwera (LUKS albo szyfrowany wolumin u dostawcy VPS) – numery telefonów są szyfrowane
   przez aplikację, a szyfrowany dysk chroni też pozostałe dane (imiona, nazwiska, klasy) „w spoczynku”.
9. Monitoring: zewnętrzne sprawdzanie adresu `https://…/api/health` (np. co 5 minut) z powiadomieniem.
   Odpowiedź `"db":false` = baza nie działa, aplikacja jest w trybie awaryjnym.
10. Katalog `.data/emergency` (kopia awaryjna kontaktów i dziennik wysyłek bez bazy, zaszyfrowane) musi być na
    dysku serwera aplikacji – ustawienie `EMERGENCY_DATA_DIR`.

Na serwerze **nie uruchamiaj `npm run db:seed`** (czyści dane; przy `NODE_ENV=production` jest zablokowany)
ani `npm run db:local` (to baza tylko do testów).

## 3. Konfiguracja aplikacji (w tej kolejności)

1. Utwórz pierwsze konto administratora (na serwerze):
   ```bash
   npm run admin:create -- jan.kowalski@szkola.pl "Jan Kowalski"
   ```
   Polecenie wypisze hasło tymczasowe. Zaloguj się, skonfiguruj 2FA, zmień hasło i ustaw PIN w „Moje konto”.
   Kolejne konta (dyrekcja, nauczyciele) dodasz już w aplikacji: **Użytkownicy**.
2. **Dane szkoły** – krótka nazwa do SMS, telefon kontaktowy (taki, który ktoś odbierze w czasie ewakuacji),
   nazwa nadawcy SMS (musi być zatwierdzona w bramce).
3. **Punkty zbiórki** – nazwa i adres, tak by rodzic trafił bez mapy.
4. **Import danych** (CSV/XLSX; PESEL, adresy i e-maile są automatycznie pomijane):
   - „Uczniowie i rodzice” – eksport uczniów z klasą i telefonami rodziców z dziennika; jeśli starsze klasy mają
     własne telefony, dodaj kolumnę „Telefon ucznia” (grupa „Uczniowie”),
   - „Nauczyciele i pracownicy” – imię, nazwisko, telefon, opcjonalnie funkcja (wzór: `sample-data/nauczyciele_przyklad.csv`).
   Przed zapisem zobaczysz raport błędnych numerów (można go pobrać jako CSV i poprawić plik).
5. **Klasy** – domyślny punkt zbiórki dla każdej klasy.
6. **Użytkownicy** – konta dyrekcji (wysyłają SMS-y i alarm) i nauczycieli (lista obecności). Każdy zmienia hasło,
   dyrekcja konfiguruje 2FA i **PIN alarmowy** w „Moje konto”.
7. **Kopia kontaktów w urządzeniu** – każda osoba z dyrekcji na swoim telefonie (i komputerze):
   „Moje konto” → „Kopia kontaktów w tym urządzeniu” → hasło do konta. Działa tylko przez HTTPS.
8. **Szablony SMS** – przeczytaj i dostosuj treści alarmu ewakuacyjnego.
9. **Test SMS** – dodaj numery testowe (telefony dyrekcji).
10. **Bramka SMS** (przykład SMS-fly):
   - załóż konto szkoły, poproś pomoc techniczną o aktywację API, zgłoś nazwę nadawcy,
   - w panelu: Integracja / Ustawienia interfejsu API → włącz „HTTP protokół”, wygeneruj klucz,
   - w `.env`: `SMS_PROVIDER=smsfly`, `SMSFLY_API_KEY=…`, uruchom aplikację ponownie,
   - w „Test SMS” sprawdź saldo i zatwierdzone nazwy nadawcy, wyślij SMS na swój numer.

   SMSAPI: `SMS_PROVIDER=smsapi`, `SMSAPI_TOKEN=…` (token OAuth z panelu, uprawnienia „SMS” i „Nazwy nadawcy”).
   Wiadomości do grup idą tam paczkami po `SMS_BATCH_SIZE` numerów (domyślnie 500) – jedno zapytanie na paczkę.
   `SMS_RATE_PER_SECOND` (zapytania/s) i `SMS_CONCURRENCY` (zapytania naraz) dopasuj do limitów konta.

## 4. Przed pierwszym prawdziwym użyciem – lista kontrolna

- [ ] Aplikacja działa na serwerze poza szkołą, z HTTPS, kopiami zapasowymi i monitoringiem.
- [ ] Konto w bramce SMS **doładowane** – zapas na co najmniej dwa pełne alarmy (liczba rodziców × 2 części SMS × 2).
- [ ] Nazwa nadawcy zatwierdzona w bramce i wpisana w „Dane szkoły”.
- [ ] (Zalecane) druga bramka jako zapasowa: `SMS_BACKUP_PROVIDER`.
- [ ] Prawdziwe dane zaimportowane; **brak danych demonstracyjnych** (aplikacja blokuje prawdziwy alarm,
      dopóki w bazie są numery demo).
- [ ] Dyrekcja ma 2FA i PIN; nauczyciele są zalogowani na swoich telefonach (aplikacja dodana do ekranu głównego).
- [ ] Dyrekcja ma włączoną **kopię kontaktów w telefonie** i sprawdziła, że otwiera ją w „Tryb awaryjny”.
- [ ] Nauczyciele zaimportowani; w „Wiadomości → Numery do poprawy” nie ma błędnych numerów.
- [ ] Przeprowadzone **ćwiczenia** (tryb ĆWICZENIA – rodzice nic nie dostają) z udziałem nauczycieli.
- [ ] RODO: zgoda/opinia Inspektora Ochrony Danych szkoły, umowa powierzenia przetwarzania z operatorem bramki
      SMS, informacja dla rodziców o celu i zakresie przetwarzania numerów, ustalony okres retencji
      (`ALERT_RETENTION_DAYS`, domyślnie 365 dni).
- [ ] Zgodność z obowiązującymi w szkole wytycznymi dotyczącymi powiadamiania o ewakuacji.

## 5. Ćwiczenia – jak je przeprowadzić

1. Pulpit → **ĆWICZENIA** → zdarzenie → zakres → punkty zbiórki → podgląd → PIN.
2. Rodzice nic nie dostają (symulacja); przykładowy SMS z dopiskiem „CWICZENIA” trafia na numery testowe.
3. Nauczyciele: telefon → **Lista obecności** → klasa → dotykają uczniów („Więcej”: nieobecny, nieodnaleziony,
   odebrany przez upoważnioną osobę).
4. Dyrekcja: **Centrum alertu** – doręczenia, „nie dotarło” (telefon do rodzica), zmiana punktu zbiórki,
   zakończenie. Raport CSV zostaje w historii.

## 6. Gdy baza danych albo serwer nie działają

Na górze aplikacji pojawia się czerwony pasek „Baza danych nie odpowiada” z przyciskiem **Tryb awaryjny**
(adres `/awaryjny` – działa też bez logowania i bez internetu, jeśli aplikacja była wcześniej otwierana na tym urządzeniu).

| Sytuacja | Co robić |
|---|---|
| Baza nie działa, serwer tak | Tryb awaryjny → **A. Wyślij przez bramkę SMS**. Odbiorcy z kopii na serwerze (najwyżej 5 minut stara), PIN alarmowy. Po powrocie bazy wysyłka pojawi się w „Wiadomości” z oznaczeniem „tryb awaryjny” – tam raport i ponowienie nieudanych. |
| Serwer nie działa / brak internetu na serwerze | Tryb awaryjny → **B. Kopia w tym urządzeniu** → hasło do konta. Na telefonie: paczki po 20 numerów otwierają aplikację SMS (SMS-y idą z Twojego numeru). Na komputerze: „Kopiuj numery” / „Pobierz CSV” i wysyłka z panelu bramki SMS. Mało osób – lista do dzwonienia. |
| Alarm ewakuacyjny trwa, a serwer padł | Nauczyciele dalej odhaczają obecność (zapis w telefonie, wysyłka po powrocie). Komunikaty do rodziców – jak wyżej. |

Wszystkie wysyłki awaryjne trafiają do dziennika zdarzeń (z telefonu – po odzyskaniu połączenia).
Ćwicz ten scenariusz razem z ćwiczeniami ewakuacyjnymi.

## 7. Znane ograniczenia

- Przepis instalacji serwerowej (punkt 2) nie był jeszcze sprawdzony na serwerze.
- Import: stary format **.xls** nie jest obsługiwany – zapisz plik jako .xlsx lub CSV.
- Wysyłka pulami do SMSAPI i SerwerSMS nie była testowana na prawdziwym koncie (tylko testy automatyczne).
- Kopia w urządzeniu wymaga HTTPS (na `http://adres-IP` w sieci szkolnej nie działa). Jest zabezpieczona hasłem
  z chwili włączenia – po zmianie hasła na innym urządzeniu otwiera ją poprzednie hasło (albo włącz kopię ponownie).
- Wysyłka z aplikacji SMS telefonu: część telefonów wysyła wiadomość do wielu osób jako MMS grupowy – sprawdź
  to na ćwiczeniach; bezpieczniej wkleić numery w panelu bramki SMS.
- Logowanie w trybie awaryjnym działa tylko dla sesji zalogowanych wcześniej (nowe logowanie wymaga bazy).
- Brak ostrzeżenia o niskim saldzie bramki na pulpicie – saldo widać w „Test SMS”.
- Nauczyciel musi być wcześniej zalogowany na telefonie (link logowania SMS-em – planowany po wdrożeniu na serwer).
- Statusy doręczeń: SMS-fly – odpytywane automatycznie; SMSAPI i SerwerSMS – wymagają publicznego adresu HTTPS
  (`SMS_CALLBACK_BASE_URL`).
- Bramki SMSAPI i SerwerSMS są zaimplementowane według dokumentacji, ale nie były testowane na prawdziwych kontach;
  SMS-fly – przetestowana prawdziwą wysyłką.
- Jeden proces serwera (wystarcza dla jednej szkoły).

## 8. Polecenia serwisowe

| Polecenie | Co robi |
|---|---|
| `npm test` | testy automatyczne |
| `npm run admin:create -- e-mail "Imię Nazwisko"` | tworzy konto administratora (hasło tymczasowe w odpowiedzi) |
| `npm run audit:verify` | sprawdza, czy dziennik zdarzeń nie był modyfikowany |
| `npm run db:deploy` | wgrywa zmiany struktury bazy po aktualizacji aplikacji |
| `npm run build && npm start` | wersja produkcyjna (port 3000) |
