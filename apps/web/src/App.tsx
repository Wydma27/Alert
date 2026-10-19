import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import type { Role } from '@alert/shared';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { AccountPage } from './pages/Account';
import { AlertHistoryPage } from './pages/AlertHistory';
import { AssemblyPointsPage } from './pages/AssemblyPoints';
import { AttendanceClassPage, AttendancePage } from './pages/Attendance';
import { AuditLogPage } from './pages/AuditLog';
import { ClassesPage } from './pages/Classes';
import { CommandCenterPage } from './pages/CommandCenter';
import { DashboardPage } from './pages/Dashboard';
import { ImportPage } from './pages/Import';
import { LoginPage } from './pages/Login';
import { NewAlertPage } from './pages/NewAlert';
import { SchoolPage } from './pages/School';
import { StudentDetailPage } from './pages/StudentDetail';
import { StudentsPage } from './pages/Students';
import { TemplatesPage } from './pages/Templates';
import { TestSmsPage } from './pages/TestSms';
import { TwoFactorPage } from './pages/TwoFactor';
import { UsersPage } from './pages/Users';

function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { hasRole } = useAuth();
  return hasRole(...roles) ? children : <Navigate to="/" replace />;
}

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;

  // Niezalogowany albo w trakcie logowania (2FA) – tylko ekrany logowania.
  if (!me) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  if (me.mfa !== 'ok') {
    return (
      <Routes>
        <Route path="*" element={<TwoFactorPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="alarm/nowy" element={<RoleGate roles={['ADMIN', 'DYREKCJA']}><NewAlertPage /></RoleGate>} />
        <Route path="alarm/:id" element={<RoleGate roles={['ADMIN', 'DYREKCJA']}><CommandCenterPage /></RoleGate>} />
        <Route path="alerty" element={<RoleGate roles={['ADMIN', 'DYREKCJA']}><AlertHistoryPage /></RoleGate>} />
        <Route path="obecnosc" element={<AttendancePage />} />
        <Route path="obecnosc/:alertClassId" element={<AttendanceClassPage />} />
        <Route path="szablony" element={<RoleGate roles={['ADMIN', 'DYREKCJA']}><TemplatesPage /></RoleGate>} />
        <Route path="uczniowie" element={<RoleGate roles={['ADMIN', 'DYREKCJA']}><StudentsPage /></RoleGate>} />
        <Route path="uczniowie/:id" element={<RoleGate roles={['ADMIN', 'DYREKCJA']}><StudentDetailPage /></RoleGate>} />
        <Route path="klasy" element={<RoleGate roles={['ADMIN', 'DYREKCJA']}><ClassesPage /></RoleGate>} />
        <Route path="punkty-zbiorki" element={<RoleGate roles={['ADMIN', 'DYREKCJA']}><AssemblyPointsPage /></RoleGate>} />
        <Route path="test-sms" element={<RoleGate roles={['ADMIN', 'DYREKCJA']}><TestSmsPage /></RoleGate>} />
        <Route path="import" element={<RoleGate roles={['ADMIN']}><ImportPage /></RoleGate>} />
        <Route path="szkola" element={<RoleGate roles={['ADMIN']}><SchoolPage /></RoleGate>} />
        <Route path="uzytkownicy" element={<RoleGate roles={['ADMIN']}><UsersPage /></RoleGate>} />
        <Route path="dziennik" element={<RoleGate roles={['ADMIN', 'DYREKCJA']}><AuditLogPage /></RoleGate>} />
        <Route path="konto" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
