import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { ROLE_LABELS, type Role } from '@alert/shared';
import { useAuth } from '../lib/auth';
import { formatTime, useActiveAlert, useServerHealth } from '../lib/hooks';

const NAV: { to: string; label: string; roles: Role[] }[] = [
  { to: '/', label: 'Pulpit', roles: ['ADMIN', 'DYREKCJA', 'NAUCZYCIEL'] },
  { to: '/wiadomosci/nowa', label: 'Wyślij SMS', roles: ['ADMIN', 'DYREKCJA'] },
  { to: '/wiadomosci', label: 'Wiadomości i raporty', roles: ['ADMIN', 'DYREKCJA'] },
  { to: '/obecnosc', label: 'Lista obecności', roles: ['ADMIN', 'DYREKCJA', 'NAUCZYCIEL'] },
  { to: '/alerty', label: 'Historia alertów', roles: ['ADMIN', 'DYREKCJA'] },
  { to: '/nauczyciele', label: 'Nauczyciele', roles: ['ADMIN', 'DYREKCJA'] },
  { to: '/uczniowie', label: 'Uczniowie i rodzice', roles: ['ADMIN', 'DYREKCJA'] },
  { to: '/klasy', label: 'Klasy', roles: ['ADMIN', 'DYREKCJA'] },
  { to: '/punkty-zbiorki', label: 'Punkty zbiórki', roles: ['ADMIN', 'DYREKCJA'] },
  { to: '/szablony', label: 'Szablony SMS', roles: ['ADMIN', 'DYREKCJA'] },
  { to: '/test-sms', label: 'Test SMS', roles: ['ADMIN', 'DYREKCJA'] },
  { to: '/import', label: 'Import danych', roles: ['ADMIN'] },
  { to: '/szkola', label: 'Dane szkoły', roles: ['ADMIN'] },
  { to: '/uzytkownicy', label: 'Użytkownicy', roles: ['ADMIN'] },
  { to: '/dziennik', label: 'Dziennik zdarzeń', roles: ['ADMIN', 'DYREKCJA'] },
  { to: '/awaryjny', label: 'Tryb awaryjny', roles: ['ADMIN', 'DYREKCJA'] },
  { to: '/konto', label: 'Moje konto', roles: ['ADMIN', 'DYREKCJA', 'NAUCZYCIEL'] },
];

export function Layout() {
  const { me, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const role = me!.user.role;
  const items = NAV.filter((n) => n.roles.includes(role));
  const active = useActiveAlert();
  const health = useServerHealth();
  const commander = role === 'ADMIN' || role === 'DYREKCJA';
  const dbDown = health.data?.db === false;
  const serverDown = health.isError;

  const nav = (
    <nav aria-label="Menu główne" className="flex flex-col gap-1">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/' || item.to === '/wiadomosci'}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) =>
            `flex min-h-12 items-center rounded-lg px-3 font-semibold ${isActive ? 'bg-ink text-white' : 'text-ink hover:bg-neutral-200'}`
          }
        >
          {item.label}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={() => void logout()}
        className="mt-3 flex min-h-12 items-center rounded-lg border-2 border-ink px-3 text-left font-semibold hover:bg-neutral-200"
      >
        Wyloguj
      </button>
    </nav>
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b-4 border-alarm bg-ink px-4 py-3 text-white">
        <div className="min-w-0">
          <div className="text-lg font-bold leading-tight">Alert Szkolny</div>
          <div className="truncate text-sm text-neutral-300">
            {me!.user.fullName} · {ROLE_LABELS[role]}
          </div>
        </div>
        <button
          type="button"
          className="min-h-12 rounded-lg border-2 border-white px-4 font-semibold lg:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? 'Zamknij' : 'Menu'}
        </button>
      </header>

      {(dbDown || serverDown) && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 bg-alarm-dark px-4 py-2 font-bold text-white">
          <span>{serverDown ? 'Brak połączenia z serwerem.' : 'Baza danych nie odpowiada.'} Dane mogą się nie zapisywać.</span>
          {commander && (
            <NavLink to="/awaryjny" className="rounded-lg border-2 border-white px-3 py-1">
              Tryb awaryjny – wyślij SMS
            </NavLink>
          )}
        </div>
      )}

      {active.data && (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 font-bold text-white ${active.data.mode === 'DRILL' ? 'bg-warn' : 'bg-alarm'}`}
        >
          <span>
            {active.data.mode === 'DRILL' ? 'ĆWICZENIA' : 'ALARM'}: {active.data.eventLabel} · od {formatTime(active.data.startedAt)}
          </span>
          <span className="flex gap-2">
            {commander && (
              <NavLink to={`/alarm/${active.data.id}`} className="rounded-lg border-2 border-white px-3 py-1">
                Centrum alertu
              </NavLink>
            )}
            <NavLink to="/obecnosc" className="rounded-lg border-2 border-white px-3 py-1">
              Lista obecności
            </NavLink>
          </span>
        </div>
      )}

      {menuOpen && (
        <div id="mobile-nav" className="border-b-2 border-line bg-surface p-3 lg:hidden">
          {nav}
        </div>
      )}

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-5 lg:px-6">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-24">{nav}</div>
        </aside>
        <main className="min-w-0 flex-1" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
