import { createContext, useState } from 'react';
import type { ReactNode } from 'react';

export interface AuthContextType {
  isLoggedIn: boolean;
  user: { name: string } | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    try {
      return localStorage.getItem('nw_auth_locked') === 'unlocked';
    } catch {
      return false;
    }
  });

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