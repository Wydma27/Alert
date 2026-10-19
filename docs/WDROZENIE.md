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
7. **Kopie zapasowe**: codziennie `pg_dump` bazy na inny serwer + jednorazowo bezpieczna kopia pliku `.env`.
8. Monitoring: zewnętrzne sprawdzanie adresu `https://…/api/health` (np. co 5 minut) z powiadomieniem.

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
4. **Import danych** – eksport uczniów i telefonów rodziców z dziennika (CSV/XLSX). PESEL, adresy i e-maile
   są automatycznie pomijane.
5. **Klasy** – domyślny punkt zbiórki dla każdej klasy.
6. **Użytkownicy** – konta dyrekcji (uruchamiają alarm) i nauczycieli (lista obecności). Każdy zmienia hasło,
   dyrekcja konfiguruje 2FA i **PIN alarmowy** w „Moje konto”.
7. **Szablony SMS** – przeczytaj i dostosuj treści.
8. **Test SMS** – dodaj numery testowe (telefony dyrekcji).
9. **Bramka SMS** (przykład SMS-fly):
   - załóż konto szkoły, poproś pomoc techniczną o aktywację API, zgłoś nazwę nadawcy,
   - w panelu: Integracja / Ustawienia interfejsu API → włącz „HTTP protokół”, wygeneruj klucz,
   - w `.env`: `SMS_PROVIDER=smsfly`, `SMSFLY_API_KEY=…`, uruchom aplikację ponownie,
   - w „Test SMS” sprawdź saldo i zatwierdzone nazwy nadawcy, wyślij SMS na swój numer.

## 4. Przed pierwszym prawdziwym użyciem – lista kontrolna

- [ ] Aplikacja działa na serwerze poza szkołą, z HTTPS, kopiami zapasowymi i monitoringiem.
- [ ] Konto w bramce SMS **doładowane** – zapas na co najmniej dwa pełne alarmy (liczba rodziców × 2 części SMS × 2).
- [ ] Nazwa nadawcy zatwierdzona w bramce i wpisana w „Dane szkoły”.
- [ ] (Zalecane) druga bramka jako zapasowa: `SMS_BACKUP_PROVIDER`.
- [ ] Prawdziwe dane zaimportowane; **brak danych demonstracyjnych** (aplikacja blokuje prawdziwy alarm,
      dopóki w bazie są numery demo).
- [ ] Dyrekcja ma 2FA i PIN; nauczyciele są zalogowani na swoich telefonach (aplikacja dodana do ekranu głównego).
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

## 6. Znane ograniczenia

- Przepis instalacji serwerowej (punkt 2) nie był jeszcze sprawdzony na serwerze.
- Brak ostrzeżenia o niskim saldzie bramki na pulpicie – saldo widać w „Test SMS”.
- Nauczyciel musi być wcześniej zalogowany na telefonie (link logowania SMS-em – planowany po wdrożeniu na serwer).
- Statusy doręczeń: SMS-fly – odpytywane automatycznie; SMSAPI i SerwerSMS – wymagają publicznego adresu HTTPS
  (`SMS_CALLBACK_BASE_URL`).
- Bramki SMSAPI i SerwerSMS są zaimplementowane według dokumentacji, ale nie były testowane na prawdziwych kontach;
  SMS-fly – przetestowana prawdziwą wysyłką.
- Jeden proces serwera (wystarcza dla jednej szkoły).

## 7. Polecenia serwisowe

| Polecenie | Co robi |
|---|---|
| `npm test` | testy automatyczne |
| `npm run admin:create -- e-mail "Imię Nazwisko"` | tworzy konto administratora (hasło tymczasowe w odpowiedzi) |
| `npm run audit:verify` | sprawdza, czy dziennik zdarzeń nie był modyfikowany |
| `npm run db:deploy` | wgrywa zmiany struktury bazy po aktualizacji aplikacji |
| `npm run build && npm start` | wersja produkcyjna (port 3000) |
