// src/App.jsx
import { useContext } from 'react';
import { AuthProvider, AuthContext } from './context/AuthContext';
import Dashboard from './components/Dashboard';
import Login from './components/Login';

function AppContent() {
  const { user } = useContext(AuthContext);

  // Simple routing: if not logged in, force them to the login screen
  if (!user) {
    return <Login />;
  }

  return <Dashboard />;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;