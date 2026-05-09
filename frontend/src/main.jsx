import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
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
import Layout from './components/Layout';
import './index.css';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/share/:token" element={<PublicTodoPage />} />
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
            <Route path="todos" element={<TodosPage />} />
            <Route path="todos/:id" element={<TodoDetailPage />} />
            <Route path="my-accounts" element={<MyAccountsPage />} />
            <Route path="my-accounts/:id" element={<MyAccountDetailPage />} />
            <Route path="my-creators" element={<TalentsPage />} />
            <Route path="my-creators/:id" element={<TalentDetailPage />} />
            <Route path="converter" element={<ConverterPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
