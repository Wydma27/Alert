# Wytyczne a aplikacja – zestawienie

Wytyczne: „Aplikacja do wysyłania powiadomień SMS w razie zagrożenia” (9 punktów).
Stan na 26.10.2026. Szczegóły techniczne: [ARCHITEKTURA.md](ARCHITEKTURA.md), wdrożenie: [WDROZENIE.md](WDROZENIE.md).

| # | Wytyczna | Status | Jak jest zrobione |
|---|---|:-:|---|
| 1 | Logowanie i przechowywanie danych, najlepiej baza zaszyfrowana | ✔ | Logowanie hasłem (argon2id) + kod z aplikacji w telefonie (2FA, obowiązkowe dla dyrekcji), blokady po błędach, PIN do wysyłki. **Wszystkie numery telefonów** (nauczyciele, uczniowie, rodzice) zaszyfrowane w bazie AES-256-GCM, na ekranie maskowane. Kopia awaryjna na serwerze i kopia w telefonie – też szyfrowane. Dziennik zdarzeń nie do zmiany. |
| 2 | Działa na telefonach i komputerze | ✔ | Aplikacja w przeglądarce, układ dopasowany do telefonu; można ją dodać do ekranu głównego (PWA). Bez instalowania ze sklepu. |
| 3 | Odporna na niedziałanie bazy danych, najlepiej synchronizacja do urządzenia | ✔ | **Trzy poziomy.** (a) Baza nie działa, serwer tak: serwer pracuje na zaszyfrowanej kopii kontaktów i sesji (odświeżanej co 5 min) – logowanie trwa, SMS-y wychodzą przez bramkę, a po powrocie bazy wysyłki są dopisywane do historii. (b) Serwer nie działa: **kopia kontaktów w telefonie/komputerze dyrekcji** (synchronizowana co 15 min, szyfrowana hasłem do konta) – SMS z aplikacji SMS telefonu, numery do wklejenia w panelu bramki, lista do dzwonienia. (c) Lista obecności nauczyciela działa bez zasięgu. |
| 4 | Dane wprowadzane z xls/csv | ✔ (xlsx, csv) | Import CSV (UTF-8, Windows-1250, średnik/przecinek) i Excel **.xlsx**: uczniowie z klasą, telefony rodziców (do 3), **telefon ucznia**; osobno **nauczyciele** (imię, nazwisko, funkcja, telefon). Automatyczne dopasowanie kolumn, podgląd zmian przed zapisem, raport błędnych numerów. Stary format **.xls** – trzeba zapisać jako .xlsx/CSV (patrz „Otwarte”). |
| 5 | Synchronizacja z główną bazą i pobieranie z niej | ✔ | Baza główna (PostgreSQL) jest źródłem danych. Urządzenia **pobierają** z niej kopię kontaktów (co 15 min i na żądanie) i **odsyłają** do niej: zmiany obecności zapisane bez zasięgu, wysyłki wykonane awaryjnie (bez bazy / bez serwera). Import w trybie „pełna synchronizacja” uzgadnia bazę z plikiem z dziennika. |
| 6 | Grupy: nauczyciele / uczniowie / rodzice | ✔ | Trzy grupy w książce kontaktów; uczniowie i rodzice powiązani z klasami (rodzic kilkorga dzieci – we wszystkich ich klasach). |
| 7 | SMS przez SMSAPI, pulami, jak najszybciej | ✔ | Bramki: **SMSAPI**, SMS-fly, SerwerSMS (+ zapasowa z automatycznym przełączeniem). **Pule**: ta sama treść idzie jednym zapytaniem do wielu numerów (SMSAPI: do 10 000, ustawiane `SMS_BATCH_SIZE`), kilka zapytań równolegle (`SMS_CONCURRENCY`), limit zapytań/s. Alarm ma pierwszeństwo przed zwykłymi wiadomościami. Test: 225 SMS-ów do trzech grup opuściło kolejkę w ok. 2 s (bramka testowa). |
| 8 | Wybór nadawcy, treści, osób lub całych grup | ✔ | „Wyślij SMS”: całe grupy, wybrane klasy (uczniowie i/lub rodzice), pojedyncze osoby z wyszukiwarki – dowolnie łączone, wspólne numery dostają jeden SMS. Dowolna treść z licznikiem znaków i opcją „bez polskich znaków”. **Nadawca** z listy nazw zatwierdzonych w bramce (albo wpisany). Podgląd: liczba odbiorców, koszt w SMS-ach, osoby bez numeru. Potwierdzenie PIN-em. |
| 9 | Raport o nieudanym wysyłaniu i błędnych numerach | ✔ | Przy każdej wiadomości: doręczone / wysłane / nie dotarło / **błędne numery** (odrzucone przez bramkę) z przyczyną, ponowienie nieudanych, **raport CSV**. Zbiorczo: „**Numery do poprawy**” (90 dni, z linkiem do poprawy kontaktu, CSV). Przy imporcie: lista wierszy z błędnymi numerami (do pobrania). |

Poza wytycznymi aplikacja ma też **alarm ewakuacyjny** (SMS do rodziców z miejscem zbiórki, lista obecności
na telefonie nauczyciela, potwierdzenia i odbiór dziecka, ćwiczenia bez SMS-ów do rodziców).

## Otwarte / do decyzji

- **Pliki .xls (Excel 97–2003)** – obsługa wymaga biblioteki SheetJS z jej oficjalnego źródła (cdn.sheetjs.com;
  wersja w rejestrze npm ma znane luki). Do decyzji, czy ją dodać. Do tego czasu: „Zapisz jako” .xlsx lub CSV.
- **SMSAPI** – wysyłka pulami zrobiona według dokumentacji i przetestowana automatycznie, ale nie na prawdziwym
  koncie SMSAPI (szkoła używa SMS-fly, ta bramka jest sprawdzona prawdziwą wysyłką). Przed wdrożeniem z SMSAPI:
  token w `.env`, „Test SMS”, jedna próbna wiadomość do grupy.
- **Szyfrowanie całej bazy** – numery telefonów są szyfrowane w aplikacji; imiona, nazwiska i klasy są w bazie
  jawne (potrzebne do wyszukiwania i list obecności). Pełne szyfrowanie „w spoczynku” zapewnia szyfrowany dysk
  serwera (np. LUKS / szyfrowany wolumin u dostawcy VPS) i szyfrowane kopie zapasowe – opis w WDROZENIE.md.
- Wytyczne „mogą ulec zmianie” – po ich doprecyzowaniu sprawdzić szablony SMS, uprawnienia ról i czas
  przechowywania danych (`ALERT_RETENTION_DAYS`).
