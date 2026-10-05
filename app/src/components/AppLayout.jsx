import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Store, BarChart3, Package, LogOut,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/buyers',    label: 'Buyers',    Icon: Users },
  { to: '/retail',    label: 'Retail',    Icon: Store },
  { to: '/reports',   label: 'Reports',   Icon: BarChart3 },
  { to: '/products',  label: 'Products',  Icon: Package },
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
      <aside className="flex flex-col w-64 shrink-0 bg-sidebar text-white sticky top-0 h-screen border-r border-white/5">
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
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
