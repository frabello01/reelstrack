import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardPage from './pages/DashboardPage';
import ListsPage from './pages/ListsPage';
import ListDetailPage from './pages/ListDetailPage';
import TodosPage from './pages/TodosPage';
import TodoDetailPage from './pages/TodoDetailPage';
import PublicTodoPage from './pages/PublicTodoPage';
import MyAccountsPage from './pages/MyAccountsPage';
import MyAccountDetailPage from './pages/MyAccountDetailPage';
import TalentsPage from './pages/TalentsPage';
import TalentDetailPage from './pages/TalentDetailPage';
import ConverterPage from './pages/ConverterPage';
import SettingsPage from './pages/SettingsPage';
import MyDayPage from './pages/MyDayPage';
import GuidesPage from './pages/GuidesPage';
import GuideDetailPage from './pages/GuideDetailPage';
import LessonDetailPage from './pages/LessonDetailPage';
import ImageCleanerPage from './pages/ImageCleanerPage';
import BatchCleanerPage from './pages/BatchCleanerPage';
import StudioPage from './pages/StudioPage';
import ExplorePage from './pages/ExplorePage';
import LandingsPage from './pages/LandingsPage';
import LandingEditorPage from './pages/LandingEditorPage';
import PublicLandingPage from './pages/PublicLandingPage';
import TeamPage from './pages/TeamPage';
import LogPage from './pages/LogPage';
import Layout from './components/Layout';
import './index.css';

function ProtectedRoute({ children }) {
  const { user, profile, loading, profileError, signOut } = useAuth();
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) {
    return (
      <div className="loading-screen" style={{ flexDirection: 'column', gap: 16 }}>
        <div style={{ maxWidth: 380, textAlign: 'center', color: 'rgba(255,255,255,0.85)', padding: '0 24px' }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', marginBottom: 8 }}>Account not active</h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.55 }}>
            {profileError || 'Your team membership is not active. Ask the admin to re-invite or reactivate you.'}
          </p>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 16 }}
            onClick={() => signOut().then(() => window.location.assign('/login'))}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }
  return children;
}

function AdminRoute({ children }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

// Hostname check: any host that is NOT our admin app or localhost is treated
// as a "landing-only" deployment — only the public PublicLandingPage renders,
// the admin app is never even mounted. This makes it safe to point arbitrary
// customer domains at the same Vercel project.
const ADMIN_HOSTS = new Set(['app.reelstrack.io', 'localhost', '127.0.0.1']);
const currentHost = (typeof window !== 'undefined' ? window.location.hostname : '').toLowerCase();
const IS_LANDING_ONLY_HOST = !ADMIN_HOSTS.has(currentHost);

function LandingOnlyApp() {
  return (
    <BrowserRouter>
      <Routes>
        {/* On a custom domain, any path is interpreted as a landing slug. */}
        <Route path="/:slug" element={<PublicLandingPage />} />
        <Route path="/p/:slug" element={<PublicLandingPage />} />
        {/* Root and unknown paths fall back to a generic 404-ish landing render
            (we pass an empty slug — the renderer will show its "not found" state). */}
        <Route path="*" element={<PublicLandingPage />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {IS_LANDING_ONLY_HOST ? (
      <LandingOnlyApp />
    ) : (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/share/:token" element={<PublicTodoPage />} />
          {/* Public landing pages — also accessible on the admin host under /p/:slug */}
          <Route path="/p/:slug" element={<PublicLandingPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="lists" element={<ListsPage />} />
            <Route path="lists/:id" element={<ListDetailPage />} />
            <Route path="explore" element={<ExplorePage />} />
            <Route path="landings" element={<LandingsPage />} />
            <Route path="landings/:id" element={<LandingEditorPage />} />
            <Route path="todos" element={<TodosPage />} />
            <Route path="todos/:id" element={<TodoDetailPage />} />
            <Route path="my-accounts" element={<MyAccountsPage />} />
            <Route path="my-accounts/:id" element={<MyAccountDetailPage />} />
            <Route path="my-creators" element={<TalentsPage />} />
            <Route path="my-creators/:id" element={<TalentDetailPage />} />
            <Route path="converter" element={<ConverterPage />} />
            <Route path="my-day" element={<MyDayPage />} />
            <Route path="guides" element={<GuidesPage />} />
            <Route path="guides/:id" element={<GuideDetailPage />} />
            <Route path="lessons" element={<Navigate to="/guides" replace />} />
            <Route path="lessons/:id" element={<LessonDetailPage />} />
            <Route path="image-cleaner" element={<ImageCleanerPage />} />
            <Route path="batch-cleaner" element={<BatchCleanerPage />} />
            <Route path="studio" element={<StudioPage />} />
            <Route path="settings" element={<SettingsPage />} />

            {/* Admin only */}
            <Route path="team" element={<AdminRoute><TeamPage /></AdminRoute>} />
            <Route path="log" element={<AdminRoute><LogPage /></AdminRoute>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    )}
  </React.StrictMode>
);
