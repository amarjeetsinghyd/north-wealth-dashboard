import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/authContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { ClientsPage } from './pages/ClientsPage';
import { ClientPortfolioPage } from './pages/ClientPortfolioPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { PortfolioDashboardPage } from './pages/PortfolioDashboardPage';

function AppRoutes() {
  const { isLoggedIn } = useAuth();

  if (!isLoggedIn) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ClientsPage />} />
        <Route path="/client/:id" element={<ClientPortfolioPage />} />
        <Route path="/client/:id/dashboard" element={<PortfolioDashboardPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
