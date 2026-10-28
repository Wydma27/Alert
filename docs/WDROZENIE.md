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

**Na serwerze poza budynkiem szkoły** (VPS w Polsce/UE). Komputer w szkole w czasie ewakuacji może zostać
bez prądu albo w zamkniętym budynku – wtedy alarmu nie da się wysłać ani śledzić. Nauczyciele w punkcie zbiórki
korzystają z internetu komórkowego, więc serwer musi być dostępny z internetu. Komputer w szkole nadaje się
tylko do pilotażu.

Pliki konfiguracyjne są w katalogu [`deploy/`](../deploy). Przepis zakłada **Ubuntu 24.04** i był sprawdzony
lokalnie w wersji produkcyjnej (zbudowana aplikacja, `NODE_ENV=production`), ale **jeszcze nie na prawdziwym
serwerze** – przejdź go najpierw na serwerze testowym albo przy pilotażu.

### 2.1. Co przygotować

- **VPS**: 2 GB RAM, 1–2 vCPU, 20 GB dysku wystarczy dla jednej szkoły. Centrum danych w Polsce lub UE,
  z opcją szyfrowania dysku i z **umową powierzenia przetwarzania danych** (RODO, patrz [RODO.md](RODO.md)).
- **Adres**, np. `alert.twojaszkola.pl` – osoba od domeny szkoły dodaje rekord **A** (i ewentualnie AAAA)
  wskazujący na adres IP serwera.
- Dostęp **SSH kluczem** (nie hasłem).

### 2.2. Przygotowanie serwera

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades ufw git rsync gnupg postgresql caddy
sudo dpkg-reconfigure -plow unattended-upgrades     # automatyczne poprawki bezpieczeństwa

# Zapora: tylko SSH i WWW
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable

# Node.js 22 (LTS) – wersja z Ubuntu jest za stara
curl -fsSL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh
sudo -E bash nodesource_setup.sh && sudo apt install -y nodejs
node --version                                       # v22.x lub nowszy
```

W `/etc/ssh/sshd_config` ustaw `PasswordAuthentication no` i `PermitRootLogin no`, potem `sudo systemctl restart ssh`
(najpierw sprawdź, że logowanie kluczem działa!).

### 2.3. Baza danych

```bash
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=')
sudo -u postgres psql -c "CREATE USER alert WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -c "CREATE DATABASE alert OWNER alert;"
echo "$DB_PASS"    # wpiszesz je do .env (DATABASE_URL)
```

PostgreSQL z Ubuntu słucha tylko na `localhost` – tak ma zostać.

### 2.4. Aplikacja

Kod trafia na serwer z repozytorium Git: najprościej z **prywatnego** repozytorium (GitHub/GitLab), albo bez
serwisu zewnętrznego – na komputerze `git bundle create alert.bundle --all`, skopiuj plik `scp`-em i na serwerze
`git clone alert.bundle alert-szkolny`.

```bash
sudo useradd --system --create-home --home-dir /var/lib/alert-szkolny --shell /usr/sbin/nologin alert
sudo mkdir /opt/alert-szkolny && sudo chown alert:alert /opt/alert-szkolny
sudo -u alert git clone <ADRES_REPOZYTORIUM> /opt/alert-szkolny
cd /opt/alert-szkolny
sudo -u alert npm ci
sudo -u alert npm run setup          # tworzy .env z nowymi kluczami
sudo chmod 600 .env
sudo -u alert nano .env              # zmiany poniżej
```

W `/opt/alert-szkolny/.env` zmień:

```env
NODE_ENV=production
DATABASE_URL=postgresql://alert:HASŁO_Z_KROKU_2.3@127.0.0.1:5432/alert
API_HOST=127.0.0.1
API_PORT=3000
TRUST_PROXY=loopback
APP_URL=https://alert.twojaszkola.pl
SMS_PROVIDER=smsfly
SMSFLY_API_KEY=…                      # klucz z panelu bramki
SMS_CALLBACK_BASE_URL=https://alert.twojaszkola.pl   # raporty doręczeń (SMSAPI, SerwerSMS)
```

**Przenosisz dane z komputera (pilotaż)?** Numery są zaszyfrowane kluczami z `.env` – na serwerze muszą być
**te same** `ENCRYPTION_KEYS`, `ENCRYPTION_ACTIVE_KEY_ID` i `BLIND_INDEX_KEY` co na komputerze, a bazę przenosisz
`pg_dump`/`pg_restore`. Prościej: zacząć na serwerze od czystej bazy i zaimportować dane z dziennika jeszcze raz.

```bash
sudo -u alert npm run db:deploy      # tabele
sudo -u alert npm run build          # frontend + serwer
sudo -u alert mkdir -p .data/emergency
```

### 2.5. Usługa i HTTPS

```bash
sudo cp deploy/alert-szkolny.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now alert-szkolny
curl -s http://127.0.0.1:3000/api/health          # {"ok":true,"db":true}

sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile                     # wpisz swój adres zamiast alert.twojaszkola.pl
sudo systemctl reload caddy
```

Otwórz `https://alert.twojaszkola.pl` – kłódka w przeglądarce oznacza, że certyfikat działa (Caddy pobiera
i odnawia go sam). Logi aplikacji: `journalctl -u alert-szkolny -f`.

### 2.6. Kopie zapasowe (codziennie, zaszyfrowane)

```bash
sudo mkdir -p /etc/alert-szkolny
sudo sh -c 'openssl rand -base64 32 > /etc/alert-szkolny/backup.pass' && sudo chmod 600 /etc/alert-szkolny/backup.pass
sudo chmod +x /opt/alert-szkolny/deploy/backup.sh
sudo cp deploy/alert-backup.service deploy/alert-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now alert-backup.timer
sudo systemctl start alert-backup && journalctl -u alert-backup -n 5    # pierwsza kopia od razu
```

- Kopie: `/var/backups/alert-szkolny`, 30 dni. **Kopia musi też trafiać poza ten serwer**: w
  `/etc/alert-szkolny/backup.env` wpisz `REMOTE=użytkownik@inny-serwer:/katalog` (rsync przez SSH, klucz bez hasła
  dla roota) albo pobieraj pliki regularnie na zaszyfrowany dysk szkoły.
- **Hasło kopii** (`backup.pass`) i **plik `.env`** zapisz w bezpiecznym miejscu poza serwerem (np. menedżer haseł
  dyrekcji) – bez nich kopia jest bezużyteczna. Trzymaj je osobno od samych kopii.
- **Sprawdź odtworzenie** przynajmniej raz (polecenia na początku `deploy/backup.sh`) – na osobnej bazie.

### 2.7. Monitoring

Zewnętrzna usługa sprawdzająca co 5 minut `https://alert.twojaszkola.pl/api/health` z powiadomieniem e-mail/SMS
do administratora (np. darmowy plan UptimeRobot lub Better Stack). Odpowiedź `"db":false` = baza nie działa,
aplikacja jest w trybie awaryjnym. Raz w miesiącu: saldo bramki SMS („Test SMS”) i `npm run audit:verify`.

### 2.8. Aktualizacja aplikacji

```bash
cd /opt/alert-szkolny
sudo systemctl start alert-backup                  # najpierw kopia
sudo -u alert git pull
sudo -u alert npm ci
sudo -u alert npm run db:deploy
sudo -u alert npm run build
sudo systemctl restart alert-szkolny
```

Nie aktualizuj w trakcie ćwiczeń ani tuż przed nimi.

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
   dyrekcja konfiguruje 2FA i **PIN alarmowy** w „Moje konto”. Nauczyciel loguje się **raz na swoim telefonie** –
   sesja trwa rok od ostatniego użycia (`TEACHER_SESSION_TTL_DAYS`), więc w dniu alarmu nie musi pamiętać hasła.
   Zgubiony telefon: „Użytkownicy” → nowe hasło albo wyłączenie konta (wylogowuje ze wszystkich urządzeń).
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
- [ ] Przeprowadzone **ćwiczenia** (tryb ĆWICZENIA – rodzice nic nie dostają) z udziałem nauczycieli – plan: [PILOTAZ.md](PILOTAZ.md).
- [ ] RODO ([RODO.md](RODO.md)): zgoda/opinia Inspektora Ochrony Danych szkoły, umowa powierzenia przetwarzania z operatorem bramki
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

- Przepis instalacji serwerowej (punkt 2, pliki w `deploy/`) był sprawdzony lokalnie w wersji produkcyjnej, ale jeszcze nie na serwerze z Linuksem.
- Import: stary format **.xls** nie jest obsługiwany – zapisz plik jako .xlsx lub CSV.
- Wysyłka pulami do SMSAPI i SerwerSMS nie była testowana na prawdziwym koncie (tylko testy automatyczne).
- Kopia w urządzeniu wymaga HTTPS (na `http://adres-IP` w sieci szkolnej nie działa). Jest zabezpieczona hasłem
  z chwili włączenia – po zmianie hasła na innym urządzeniu otwiera ją poprzednie hasło (albo włącz kopię ponownie).
- Wysyłka z aplikacji SMS telefonu: część telefonów wysyła wiadomość do wielu osób jako MMS grupowy – sprawdź
  to na ćwiczeniach; bezpieczniej wkleić numery w panelu bramki SMS.
- Logowanie w trybie awaryjnym działa tylko dla sesji zalogowanych wcześniej (nowe logowanie wymaga bazy).
- Brak ostrzeżenia o niskim saldzie bramki na pulpicie – saldo widać w „Test SMS”.
- Nauczyciel musi raz zalogować się na telefonie (sesja trwa rok od ostatniego użycia; link logowania SMS-em – planowany
  po wdrożeniu na serwer). Kto nie otwierał aplikacji ponad rok – zaloguje się ponownie, np. na ćwiczeniach.
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
