// src/components/Login.jsx
import { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { loginUser, registerUser, resetPassword } from '../services/api';
import { ShieldCheck, ShieldAlert, Terminal as TerminalIcon, UserPlus, KeyRound } from 'lucide-react';

export default function Login() {
    const [mode, setMode] = useState('LOGIN'); // 'LOGIN' | 'REGISTER' | 'FORGOT'
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('SRE_USER'); // 'SRE_USER' | 'ADMIN'
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { login } = useContext(AuthContext);

    const handleModeChange = (newMode) => {
        setMode(newMode);
        setError('');
        setSuccess('');
        setPassword('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setIsSubmitting(true);

        try {
            if (mode === 'LOGIN') {
                const data = await loginUser({ username, password });
                login(data.access_token, data.role, data.username);
            } else if (mode === 'REGISTER') {
                await registerUser({ username, password, role });
                setSuccess('REGISTRATION_SUCCESS: Operator registered. Please login.');
                setMode('LOGIN');
                setPassword('');
            } else if (mode === 'FORGOT') {
                await resetPassword({ username, password });
                setSuccess('PASSWORD_RESET_SUCCESS: Credentials updated. Please login.');
                setMode('LOGIN');
                setPassword('');
            }
        } catch (err) {
            if (mode === 'LOGIN') {
                setError('ACCESS_DENIED: Invalid operator credentials');
            } else if (mode === 'REGISTER') {
                setError(`REGISTRATION_FAILED: ${err.message}`);
            } else {
                setError(`PASSWORD_RESET_FAILED: ${err.message}`);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="dark min-h-screen bg-[#090d16] flex items-center justify-center p-4 font-sans relative overflow-hidden">
            {/* Cyber Grid Background */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293710_1px,transparent_1px),linear-gradient(to_bottom,#1f293710_1px,transparent_1px)] bg-[size:24px_24px]"></div>
            <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-cyber-blue/5 rounded-full filter blur-[120px] pointer-events-none"></div>
            <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-alert-red/5 rounded-full filter blur-[120px] pointer-events-none"></div>

            {/* Auth Box */}
            <div className="relative w-full max-w-md bg-[#121824] border border-[#1e2430] rounded-xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)] z-10 transition-all duration-300 hover:border-cyber-blue/30">
                {/* Terminal Header */}
                <div className="bg-[#0b0e14] border-b border-[#1e2430] px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <TerminalIcon className="w-4 h-4 text-cyber-blue" />
                        <span className="font-mono text-xs text-gray-400 tracking-wider font-semibold">
                            {mode === 'LOGIN' && 'INVENIOPS_SECURE_AUTH_v1.0.4'}
                            {mode === 'REGISTER' && 'INVENIOPS_OPERATOR_SIGN_UP'}
                            {mode === 'FORGOT' && 'INVENIOPS_PASSWORD_RECOVERY'}
                        </span>
                    </div>
                    <div className="flex gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-alert-red/40"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-warn-orange/40"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-success-green/40"></span>
                    </div>
                </div>

                {/* Body */}
                <div className="p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-lg bg-cyber-blue/10 border border-cyber-blue/30 flex items-center justify-center">
                            {mode === 'LOGIN' && <ShieldCheck className="w-5 h-5 text-cyber-blue" />}
                            {mode === 'REGISTER' && <UserPlus className="w-5 h-5 text-cyber-blue" />}
                            {mode === 'FORGOT' && <KeyRound className="w-5 h-5 text-cyber-blue" />}
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-white font-sans">
                                {mode === 'LOGIN' && 'Sign in'}
                                {mode === 'REGISTER' && 'Register Operator'}
                                {mode === 'FORGOT' && 'Reset Credentials'}
                            </h1>
                            <p className="text-gray-400 text-xs mt-0.5">
                                {mode === 'LOGIN' && 'Please authenticate to establish session.'}
                                {mode === 'REGISTER' && 'Create a new operator account.'}
                                {mode === 'FORGOT' && 'Reset your operator password.'}
                            </p>
                        </div>
                    </div>

                    {/* Terminal Prompt Mock */}
                    <div className="bg-[#090d16] border border-[#1e2430] rounded p-3 mb-6 font-mono text-xs text-cyber-blue/80 flex items-center gap-2">
                        <span className="text-gray-500">[sre-auth@inveniops-node-01]:~$</span>
                        <span className="text-white animate-pulse">
                            {mode === 'LOGIN' && 'run_authentication.sh'}
                            {mode === 'REGISTER' && 'register_operator.sh'}
                            {mode === 'FORGOT' && 'reset_password.sh'}
                        </span>
                    </div>

                    {error && (
                        <div className="font-mono bg-alert-red/10 border border-alert-red/30 text-alert-red p-3 rounded-lg mb-6 text-xs flex flex-col gap-1">
                            <span className="font-bold">&gt;&gt; ERROR: FAILED</span>
                            <span>{error}</span>
                        </div>
                    )}

                    {success && (
                        <div className="font-mono bg-success-green/10 border border-success-green/30 text-success-green p-3 rounded-lg mb-6 text-xs flex flex-col gap-1">
                            <span className="font-bold">&gt;&gt; SUCCESS: OK</span>
                            <span>{success}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 font-mono">Operator Username</label>
                            <input
                                type="text"
                                required
                                placeholder="e.g. junior_sre"
                                className="w-full bg-[#090d16] border border-[#1e2430] rounded-lg px-3 py-2.5 text-sm text-white outline-none transition-all focus:border-cyber-blue focus:ring-1 focus:ring-cyber-blue/20 placeholder:text-gray-600"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 font-mono">
                                {mode === 'FORGOT' ? 'New Security Password' : 'Security Password'}
                            </label>
                            <input
                                type="password"
                                required
                                placeholder="••••••••"
                                className="w-full bg-[#090d16] border border-[#1e2430] rounded-lg px-3 py-2.5 text-sm text-white outline-none transition-all focus:border-cyber-blue focus:ring-1 focus:ring-cyber-blue/20 placeholder:text-gray-600"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>

                        {mode === 'REGISTER' && (
                            <div className="space-y-1.5">
                                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 font-mono">Operator Role</label>
                                <select
                                    value={role}
                                    onChange={(e) => setRole(e.target.value)}
                                    className="w-full bg-[#090d16] border border-[#1e2430] rounded-lg px-3 py-2.5 text-sm text-white outline-none transition-all focus:border-cyber-blue focus:ring-1 focus:ring-cyber-blue/20"
                                >
                                    <option value="SRE_USER">SRE Operator (SRE_USER)</option>
                                    <option value="ADMIN">System Administrator (ADMIN)</option>
                                </select>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full mt-2 bg-gradient-to-r from-blue-600 to-cyber-blue hover:from-blue-500 hover:to-[#00f0ff] text-white font-semibold py-2.5 rounded-lg transition-all duration-300 shadow-[0_0_20px_rgba(0,82,255,0.2)] hover:shadow-[0_0_25px_rgba(0,229,255,0.4)] disabled:opacity-50 disabled:pointer-events-none cursor-pointer flex items-center justify-center"
                        >
                            {isSubmitting && 'PROCESSING_REQUEST...'}
                            {!isSubmitting && mode === 'LOGIN' && 'AUTHENTICATE'}
                            {!isSubmitting && mode === 'REGISTER' && 'CREATE OPERATOR'}
                            {!isSubmitting && mode === 'FORGOT' && 'RESET PASSWORD'}
                        </button>
                    </form>

                    {/* Mode Toggles */}
                    <div className="mt-6 flex flex-col gap-2.5 text-center text-xs font-mono">
                        {mode === 'LOGIN' && (
                            <>
                                <button
                                    onClick={() => handleModeChange('REGISTER')}
                                    className="text-cyber-blue hover:underline cursor-pointer transition"
                                >
                                    &gt; Create operator account (Sign Up)
                                </button>
                                <button
                                    onClick={() => handleModeChange('FORGOT')}
                                    className="text-gray-400 hover:text-white cursor-pointer transition"
                                >
                                    &gt; Forgot operator password?
                                </button>
                            </>
                        )}
                        {(mode === 'REGISTER' || mode === 'FORGOT') && (
                            <button
                                onClick={() => handleModeChange('LOGIN')}
                                className="text-cyber-blue hover:underline cursor-pointer transition"
                            >
                                &gt; Back to secure login (Sign In)
                            </button>
                        )}
                    </div>
                </div>

                {/* Footer Security Note */}
                <div className="bg-[#0b0e14] border-t border-[#1e2430] px-8 py-3 text-center">
                    <span className="font-mono text-[10px] text-success-green/80 uppercase tracking-widest font-semibold flex items-center justify-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-success-green animate-ping"></span>
                        SECURE_CONNECTION : ACTIVE (TLS_1.3)
                    </span>
                </div>
            </div>
        </div>
    );
}