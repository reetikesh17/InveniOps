// src/components/Login.jsx
import { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { loginUser } from '../services/api';

export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const { login } = useContext(AuthContext);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const data = await loginUser({ username, password });
            login(data.access_token, data.role);
        } catch (err) {
            setError('Invalid username or password');
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-md w-full shadow-2xl">
                <h1 className="text-2xl font-bold text-white mb-2">IMS Secure Login</h1>
                <p className="text-gray-400 mb-6 text-sm">Please authenticate to access the control room.</p>

                {error && <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded mb-4 text-sm">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Username</label>
                        <input
                            type="text"
                            required
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white outline-none focus:border-blue-500"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
                        <input
                            type="password"
                            required
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white outline-none focus:border-blue-500"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    <button type="submit" className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 rounded transition">
                        Authenticate
                    </button>
                </form>
            </div>
        </div>
    );
}