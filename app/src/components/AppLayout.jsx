import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Store, BarChart3, Package, Boxes, LogOut, Archive,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';

const navItems = [
  { to: '/inventory', label: 'Daily Stock In', Icon: Boxes },
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/buyers',    label: 'Buyers',    Icon: Users },
  { to: '/buyers/deleted', label: 'Archived Customers', Icon: Archive },
  { to: '/retail',    label: 'Retail',    Icon: Store },
  { to: '/reports',   label: 'Reports',   Icon: BarChart3 },
  { to: '/products',  label: 'Products',  Icon: Package },
];

const mobileNavItems = [
  { to: '/dashboard', label: 'Home', Icon: LayoutDashboard },
  { to: '/buyers', label: 'Buyers', Icon: Users },
  { to: '/retail', label: 'Retail', Icon: Store },
  { to: '/reports', label: 'Reports', Icon: BarChart3 },
  { to: '/inventory', label: 'Stock', Icon: Boxes },
];

function LeafLogo({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none">
      <rect width="64" height="64" rx="16" fill="#05df72" />
      <path
        d="M40 18c-8 0-14 6-14 14 0 8 6 14 14 14 2 0 4-.4 5.6-1.2C42 45 36 40 34 32c-2-8 2-14 6-14zm-2 4c-3 1-5 5-4 10 1 5 4 8 7 9-1-4-1-13-3-19z"
        stroke="#0f3460"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M28 46c7 4 14 4 18 0" stroke="#0f3460" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function NavList() {
  return (
    <nav className="flex flex-col gap-1">
      {navItems.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <Icon className="w-5 h-5 shrink-0" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppLayout({ children }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const doLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-ink-50 flex">
      <aside className="hidden lg:flex flex-col w-64 shrink-0 bg-sidebar text-white sticky top-0 h-screen border-r border-white/5">
        <div className="px-5 py-5 flex items-center gap-3 border-b border-white/10">
          <LeafLogo className="w-9 h-9" />
          <div className="font-bold text-lg tracking-tight">GSM Traders</div>
        </div>
        <div className="px-3 py-4 flex-1 overflow-y-auto">
          <NavList />
        </div>
        <div className="px-3 py-4 border-t border-white/10">
          <button onClick={doLogout} className="nav-link">
            <LogOut className="w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/10 bg-sidebar px-4 py-3 text-white lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <LeafLogo className="h-10 w-10 shrink-0" />
            <span className="truncate text-lg font-bold tracking-tight">GSM Traders</span>
          </div>
          <div className="ml-3 flex shrink-0 items-center gap-1">
            <NavLink
              to="/products"
              aria-label="Product catalog"
              title="Product catalog"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <Package className="h-5 w-5" />
            </NavLink>
            <button
              type="button"
              onClick={doLogout}
              aria-label="Log out"
              title="Log out"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 pb-28 sm:py-6 sm:pb-28 md:px-8 lg:py-8 lg:pb-8">
          {children}
        </main>
      </div>

      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-ink-100 bg-white/95 px-1 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(16,24,40,0.08)] backdrop-blur lg:hidden"
      >
        {mobileNavItems.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-semibold transition ${
              isActive ? 'text-sidebar-accent' : 'text-ink-400 hover:text-ink-700'
            }`}
          >
            {({ isActive }) => (
              <>
                <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
                <span>{label}</span>
                {isActive && <span className="absolute bottom-1 h-0.5 w-6 rounded-full bg-sidebar-accent" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
