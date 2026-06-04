// src/components/Dashboard.jsx
import { useState, useEffect, useContext } from 'react';
import { fetchIncidents, closeIncident } from '../services/api';
import { AuthContext } from '../context/AuthContext';

export default function Dashboard() {
    const [incidents, setIncidents] = useState([]);
    const [selectedIncident, setSelectedIncident] = useState(null);
    const [rcaForm, setRcaForm] = useState({ root_cause_category: 'Database', fix_applied: '', prevention_steps: '' });

    const { logout, user } = useContext(AuthContext);

    useEffect(() => {
        loadIncidents();
        // Auto-refresh the dashboard every 5 seconds
        const interval = setInterval(loadIncidents, 5000);
        return () => clearInterval(interval);
    }, []);

    const loadIncidents = async () => {
        try {
            const data = await fetchIncidents();
            setIncidents(data.incidents);
        } catch (error) {
            console.error(error);
        }
    };

    const handleCloseSubmit = async (e) => {
        e.preventDefault();
        try {
            await closeIncident(selectedIncident.id, rcaForm);
            setSelectedIncident(null);
            setRcaForm({ root_cause_category: 'Database', fix_applied: '', prevention_steps: '' });
            loadIncidents();
        } catch (error) {
            alert("Failed to submit RCA.");
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
            <header className="mb-8 border-b border-gray-800 pb-4 flex justify-between items-start">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white">IMS Control Room</h1>
                    <p className="text-gray-400 mt-1">Real-time incident monitoring and remediation</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <span className="text-xs font-mono bg-gray-800 text-gray-400 px-2 py-1 rounded">
                        Role: {user?.role || 'UNKNOWN'}
                    </span>
                    <button 
                        onClick={logout} 
                        className="text-sm font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-4 py-2 rounded transition-colors"
                    >
                        Secure Logout
                    </button>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {incidents.map((inc) => (
                    <div key={inc.id} className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-lg flex flex-col justify-between">
                        <div>
                            <div className="flex justify-between items-start mb-4">
                                <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${inc.severity === 'P0' ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400'}`}>
                                    {inc.severity}
                                </span>
                                <span className={`text-xs font-medium px-2 py-1 rounded ${inc.state === 'OPEN' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                                    {inc.state}
                                </span>
                            </div>
                            <h3 className="text-lg font-semibold text-gray-200 mb-1">{inc.component_id}</h3>
                            <p className="text-sm text-gray-400 mb-4">{inc.message}</p>
                        </div>

                        {inc.state !== 'CLOSED' && (
                            <button
                                onClick={() => setSelectedIncident(inc)}
                                className="w-full mt-4 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium py-2 px-4 rounded transition-colors"
                            >
                                Resolve & Submit RCA
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* RCA Modal */}
            {selectedIncident && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
                    <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-md w-full p-6 shadow-2xl">
                        <h2 className="text-xl font-bold mb-4">Mandatory RCA</h2>
                        <p className="text-sm text-gray-400 mb-6">Closing ticket: <span className="text-gray-200">{selectedIncident.id}</span></p>

                        <form onSubmit={handleCloseSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Root Cause Category</label>
                                <select
                                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white outline-none focus:border-blue-500"
                                    value={rcaForm.root_cause_category}
                                    onChange={(e) => setRcaForm({ ...rcaForm, root_cause_category: e.target.value })}
                                >
                                    <option>Database</option>
                                    <option>Network</option>
                                    <option>Code / Deployment</option>
                                    <option>Infrastructure</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Fix Applied</label>
                                <textarea
                                    required
                                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white outline-none focus:border-blue-500 min-h-[80px]"
                                    onChange={(e) => setRcaForm({ ...rcaForm, fix_applied: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Prevention Steps</label>
                                <textarea
                                    required
                                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white outline-none focus:border-blue-500 min-h-[80px]"
                                    onChange={(e) => setRcaForm({ ...rcaForm, prevention_steps: e.target.value })}
                                />
                            </div>
                            <div className="flex gap-3 mt-6">
                                <button type="button" onClick={() => setSelectedIncident(null)} className="flex-1 py-2 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition">Cancel</button>
                                <button type="submit" className="flex-1 py-2 rounded bg-blue-600 text-white hover:bg-blue-500 transition font-medium">Submit & Close</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}