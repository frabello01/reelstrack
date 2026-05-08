import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LayoutDashboard, ListVideo, LogOut, CheckSquare, Menu, X, BarChart3 } from 'lucide-react';
import FetchProgress from './FetchProgress';
import './Layout.css';

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close sidebar when navigating on mobile
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Lock body scroll when sidebar is open on mobile
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="layout">
      {/* Mobile top bar */}
      <header className="mobile-topbar">
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
        <img src="/logo.png" alt="Creator Advisor" className="mobile-logo" />
        <div style={{ width: 40 }} /> {/* spacer for balance */}
      </header>

      {/* Backdrop when sidebar is open on mobile */}
      {mobileOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <img src="/logo.png" alt="Creator Advisor" />
          <button
            className="sidebar-close-btn"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <LayoutDashboard size={18} />
            Dashboard
          </NavLink>
          <NavLink to="/lists" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <ListVideo size={18} />
            Creator Lists
          </NavLink>
          <NavLink to="/todos" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <CheckSquare size={18} />
            To-Do Lists
          </NavLink>
          <NavLink to="/my-accounts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <BarChart3 size={18} />
            My Accounts
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{user?.email?.[0].toUpperCase()}</div>
            <span className="user-email">{user?.email}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleSignOut} aria-label="Sign out">
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>

      {/* Floating progress bar — shows whenever a fetch job is running */}
      <FetchProgress />
    </div>
  );
}
