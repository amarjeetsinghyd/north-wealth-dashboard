import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface AuthContextType {
  isLoggedIn: boolean;
  user: { name: string } | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check local storage for persistent login
    const loggedIn = localStorage.getItem('nw_auth_locked') === 'unlocked';
    setIsLoggedIn(loggedIn);
    setIsLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    // Simple local hardcoded check (acts as a screen lock)
    if (username === 'northwealthportfolio' && password === 'Inv@2026') {
      localStorage.setItem('nw_auth_locked', 'unlocked');
      setIsLoggedIn(true);
      return true;
    }
    return false;
  };

  const logout = async (): Promise<void> => {
    localStorage.removeItem('nw_auth_locked');
    setIsLoggedIn(false);
  };

  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#000', color: '#C9A84C',
        fontFamily: 'Inter, sans-serif', fontSize: 14, gap: 12,
      }}>
        <div style={{
          width: 20, height: 20, border: '2px solid #333',
          borderTopColor: '#C9A84C', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        Loading…
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ 
      isLoggedIn, 
      user: isLoggedIn ? { name: 'Admin' } : null, 
      login, 
      logout 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
