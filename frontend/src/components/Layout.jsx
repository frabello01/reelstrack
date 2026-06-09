import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LayoutDashboard, ListVideo, LogOut, CheckSquare, Menu, X, BarChart3, Music, Sparkles, BookOpen, Layers, Film, Users, ScrollText, Compass, Globe, Clapperboard, Link2 } from 'lucide-react';
import FetchProgress from './FetchProgress';
import './Layout.css';

export default function Layout() {
  const { user, displayName, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

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
      <header className="mobile-topbar">
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
        <img src="/logo.png" alt="Creator Advisor" className="mobile-logo" />
        <div style={{ width: 40 }} />
      </header>

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
          <NavLink to="/my-day" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Sparkles size={18} />
            My Day
          </NavLink>
          <NavLink to="/lists" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <ListVideo size={18} />
            Creator Lists
          </NavLink>
          <NavLink to="/explore" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Compass size={18} />
            Explore Creators
          </NavLink>
          <NavLink to="/todos" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <CheckSquare size={18} />
            To-Do Lists
          </NavLink>
          <NavLink to="/my-creators" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <BarChart3 size={18} />
            My Creators
          </NavLink>
          <NavLink to="/landings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Globe size={18} />
            Landing Pages
          </NavLink>
          <NavLink to="/redirects" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Link2 size={18} />
            Redirect Links
          </NavLink>
          <NavLink to="/converter" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Music size={18} />
            Reel Converter
          </NavLink>
          <NavLink to="/batch-cleaner" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Layers size={18} />
            Batch Cleaner
          </NavLink>
          <NavLink to="/studio" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Film size={18} />
            Studio
          </NavLink>
          <NavLink to="/video-studio" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Clapperboard size={18} />
            Video Studio
          </NavLink>
          <NavLink to="/guides" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <BookOpen size={18} />
            Guides
          </NavLink>

          {/* Admin-only section */}
          {isAdmin && (
            <>
              <div className="nav-divider" />
              <NavLink to="/team" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Users size={18} />
                Team
              </NavLink>
              <NavLink to="/log" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <ScrollText size={18} />
                Log
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item user-info-link ${isActive ? 'active' : ''}`}
            title="Settings"
          >
            <div className="user-avatar">{(displayName || user?.email || '?')[0].toUpperCase()}</div>
            <span className="user-email">{displayName || user?.email}</span>
          </NavLink>
          <button
            className="nav-item nav-item-button"
            onClick={handleSignOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>

      <FetchProgress />
    </div>
  );
}
