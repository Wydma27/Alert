import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { ROLE_LABELS, type Role } from '@alert/shared';
import { useAuth } from '../lib/auth';
import { formatTime, useActiveAlert, useServerHealth } from '../lib/hooks';
import { Icon, type IconName } from './icons';

const ALL: Role[] = ['ADMIN', 'DYREKCJA', 'NAUCZYCIEL'];
const COMMANDERS: Role[] = ['ADMIN', 'DYREKCJA'];
const ADMIN: Role[] = ['ADMIN'];

type NavItem = { to: string; label: string; icon: IconName; roles: Role[] };

const NAV: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '/', label: 'Pulpit', icon: 'home', roles: ALL },
      { to: '/obecnosc', label: 'Lista obecności', icon: 'clipboard', roles: ALL },
    ],
  },
  {
    title: 'Wiadomości',
    items: [
      { to: '/wiadomosci/nowa', label: 'Wyślij SMS', icon: 'send', roles: COMMANDERS },
      { to: '/wiadomosci', label: 'Wiadomości i raporty', icon: 'inbox', roles: COMMANDERS },
      { to: '/szablony', label: 'Szablony SMS', icon: 'template', roles: COMMANDERS },
      { to: '/test-sms', label: 'Test SMS', icon: 'phone', roles: COMMANDERS },
    ],
  },
  {
    title: 'Alarmy',
    items: [
      { to: '/alerty', label: 'Historia alertów', icon: 'history', roles: COMMANDERS },
      { to: '/awaryjny', label: 'Tryb awaryjny', icon: 'lifebuoy', roles: COMMANDERS },
    ],
  },
  {
    title: 'Kontakty',
    items: [
      { to: '/nauczyciele', label: 'Nauczyciele', icon: 'teacher', roles: COMMANDERS },
      { to: '/uczniowie', label: 'Uczniowie i rodzice', icon: 'students', roles: COMMANDERS },
      { to: '/klasy', label: 'Klasy', icon: 'grid', roles: COMMANDERS },
      { to: '/punkty-zbiorki', label: 'Punkty zbiórki', icon: 'pin', roles: COMMANDERS },
      { to: '/import', label: 'Import danych', icon: 'upload', roles: ADMIN },
    ],
  },
  {
    title: 'Administracja',
    items: [
      { to: '/szkola', label: 'Dane szkoły', icon: 'school', roles: ADMIN },
      { to: '/uzytkownicy', label: 'Użytkownicy', icon: 'key', roles: ADMIN },
      { to: '/dziennik', label: 'Dziennik zdarzeń', icon: 'list', roles: COMMANDERS },
    ],
  },
];

const ACCOUNT: NavItem = { to: '/konto', label: 'Moje konto', icon: 'user', roles: ALL };

function initials(fullName: string) {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export function Layout() {
  const { me, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const role = me!.user.role;
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => n.roles.includes(role)) })).filter((g) => g.items.length > 0);
  const active = useActiveAlert();
  const health = useServerHealth();
  const commander = role === 'ADMIN' || role === 'DYREKCJA';
  const dbDown = health.data?.db === false;
  const serverDown = health.isError;

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const link = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/' || item.to === '/wiadomosci'}
      onClick={() => setMenuOpen(false)}
      className={({ isActive }) =>
        `group flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold transition-colors lg:min-h-10 ${isActive ? 'bg-ink text-white shadow-card' : 'text-ink hover:bg-slate-200/70'}`
      }
    >
      {({ isActive }) => (
        <>
          <Icon name={item.icon} className={`size-5 ${isActive ? 'text-white' : 'text-muted group-hover:text-ink'}`} />
          {item.label}
        </>
      )}
    </NavLink>
  );

  const nav = (
    <nav aria-label="Menu główne" className="flex flex-col gap-0.5">
      {groups.map((g, i) => (
        <div key={g.title ?? i} className="flex flex-col gap-0.5">
          {g.title && <div className="px-3 pt-3.5 pb-1 text-xs font-bold uppercase tracking-wider text-muted">{g.title}</div>}
          {g.items.map(link)}
        </div>
      ))}
      <div className="mt-4 flex flex-col gap-0.5 border-t border-line pt-3">
        {link(ACCOUNT)}
        {/* Na komputerze „Wyloguj” jest w górnym pasku. */}
        <button
          type="button"
          onClick={() => void logout()}
          className="group flex min-h-12 items-center gap-3 rounded-xl px-3 text-left font-semibold text-ink transition-colors hover:bg-slate-200/70 lg:hidden"
        >
          <Icon name="logout" className="size-5 text-muted group-hover:text-ink" />
          Wyloguj
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 bg-ink text-white">
        <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-3 rounded-lg">
            <img src="/icon.svg" alt="" className="size-9 shrink-0 rounded-[0.6rem]" />
            <span className="min-w-0">
              <span className="block text-lg font-bold leading-tight tracking-tight">Alert Szkolny</span>
              <span className="block truncate text-sm text-slate-300 lg:hidden">
                {me!.user.fullName} · {ROLE_LABELS[role]}
              </span>
            </span>
          </Link>
          <div className="hidden items-center gap-2 lg:flex">
            <Link to="/konto" className="flex items-center gap-3 rounded-xl px-2 py-1 hover:bg-white/10">
              <span className="text-right leading-tight">
                <span className="block font-semibold">{me!.user.fullName}</span>
                <span className="block text-sm text-slate-300">{ROLE_LABELS[role]}</span>
              </span>
              <span aria-hidden className="grid size-10 place-items-center rounded-full bg-white/15 font-bold">
                {initials(me!.user.fullName)}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-white/40 px-3 font-semibold hover:border-white hover:bg-white/10"
            >
              <Icon name="logout" className="size-5" />
              Wyloguj
            </button>
          </div>
          <button
            type="button"
            className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border-2 border-white/70 px-3 font-semibold hover:bg-white/10 lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} className="size-5" />
            {menuOpen ? 'Zamknij' : 'Menu'}
          </button>
        </div>
        <div className="h-[3px] bg-alarm" />
        {menuOpen && (
          <div id="mobile-nav" className="absolute inset-x-0 top-full h-[calc(100dvh-4.2rem)] overflow-y-auto bg-page px-4 pt-2 pb-8 text-ink lg:hidden">
            {nav}
          </div>
        )}
      </header>

      {(dbDown || serverDown) && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 bg-alarm-dark px-4 py-2.5 font-bold text-white lg:px-6">
          <span className="flex items-center gap-2">
            <Icon name="warning" className="size-5" />
            {serverDown ? 'Brak połączenia z serwerem.' : 'Baza danych nie odpowiada.'} Dane mogą się nie zapisywać.
          </span>
          {commander && (
            <NavLink to="/awaryjny" className="rounded-lg border-2 border-white px-3 py-1 hover:bg-white/10">
              Tryb awaryjny – wyślij SMS
            </NavLink>
          )}
        </div>
      )}

      {active.data && (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 font-bold text-white lg:px-6 ${active.data.mode === 'DRILL' ? 'bg-warn' : 'bg-alarm'}`}
        >
          <span className="flex items-center gap-2">
            <Icon name="siren" className="size-5" />
            {active.data.mode === 'DRILL' ? 'ĆWICZENIA' : 'ALARM'}: {active.data.eventLabel} · od {formatTime(active.data.startedAt)}
          </span>
          <span className="flex flex-wrap gap-2">
            {commander && (
              <NavLink to={`/alarm/${active.data.id}`} className="rounded-lg border-2 border-white px-3 py-1 hover:bg-white/10">
                Centrum alertu
              </NavLink>
            )}
            <NavLink to="/obecnosc" className="rounded-lg border-2 border-white px-3 py-1 hover:bg-white/10">
              Lista obecności
            </NavLink>
          </span>
        </div>
      )}

      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6 lg:px-8">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-[5.2rem] max-h-[calc(100dvh-6rem)] overflow-y-auto pb-4">{nav}</div>
        </aside>
        <main className="min-w-0 flex-1 pb-10" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
