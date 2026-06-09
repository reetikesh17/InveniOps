// src/components/Dashboard.jsx
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useState, useEffect, useContext } from 'react';
import { fetchIncidents, closeIncident } from '../services/api';
import { AuthContext } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Activity,
    Database,
    Cpu,
    Radio,
    Clock,
    User,
    LogOut,
    CheckCircle2,
    AlertTriangle,
    ShieldAlert,
    Terminal as TerminalIcon,
    Flame,
    Check
} from 'lucide-react';

const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : `http://${window.location.hostname}:8000`;

export default function Dashboard() {
    const [incidents, setIncidents] = useState([]);
    const [selectedIncident, setSelectedIncident] = useState(null);
    const [rcaForm, setRcaForm] = useState({ root_cause_category: 'Database', fix_applied: '', prevention_steps: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [acknowledgedIds, setAcknowledgedIds] = useState(new Set());
    const [systemHealth, setSystemHealth] = useState({
        api: 'CHECKING',
        db: 'CHECKING',
        redis: 'CHECKING',
        rabbitmq: 'CHECKING',
        workers: 'CHECKING'
    });
    const [uptime, setUptime] = useState(0);

    const { logout, user } = useContext(AuthContext);

    useEffect(() => {
        loadIncidents();
        checkSystemHealth();

        const incidentInterval = setInterval(loadIncidents, 5000);
        const healthInterval = setInterval(checkSystemHealth, 8000);
        const uptimeInterval = setInterval(() => setUptime(prev => prev + 1), 1000);

        return () => {
            clearInterval(incidentInterval);
            clearInterval(healthInterval);
            clearInterval(uptimeInterval);
        };
    }, []);

    const loadIncidents = async () => {
        try {
            const data = await fetchIncidents();
            setIncidents(data.incidents);
        } catch (error) {
            console.error(error);
        }
    };

    const checkSystemHealth = async () => {
        try {
            const res = await fetch(`${API_URL}/health`);
            if (res.ok) {
                setSystemHealth({
                    api: 'UP',
                    db: 'UP',
                    redis: 'UP',
                    rabbitmq: 'UP',
                    workers: 'ACTIVE'
                });
            } else {
                throw new Error();
            }
        } catch (err) {
            setSystemHealth({
                api: 'DOWN',
                db: 'DOWN',
                redis: 'DOWN',
                rabbitmq: 'DOWN',
                workers: 'INACTIVE'
            });
        }
    };

    const handleAcknowledge = (id) => {
        setAcknowledgedIds(prev => {
            const next = new Set(prev);
            next.add(id);
            return next;
        });
    };

    const handleCloseSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await closeIncident(selectedIncident.id, rcaForm);
            setSelectedIncident(null);
            setRcaForm({ root_cause_category: 'Database', fix_applied: '', prevention_steps: '' });
            loadIncidents();
        } catch (error) {
            alert(error.message || "Failed to submit RCA.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const openIncidents = incidents.filter(i => i.state !== 'CLOSED');
    const closedIncidents = incidents.filter(i => i.state === 'CLOSED');

    const formatUptime = (sec) => {
        const h = Math.floor(sec / 3600).toString().padStart(2, '0');
        const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
        const s = (sec % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    };

    // --- Analytics Data Processing ---
    const severityData = [
        { name: 'Critical (P0)', count: incidents.filter(i => i.severity === 'P0' && i.state !== 'CLOSED').length },
        { name: 'Major (P1)', count: incidents.filter(i => i.severity === 'P1' && i.state !== 'CLOSED').length },
        { name: 'Minor (P2)', count: incidents.filter(i => i.severity === 'P2' && i.state !== 'CLOSED').length }
    ];

    const stateData = [
        { name: 'Active', count: openIncidents.length },
        { name: 'Resolved', count: closedIncidents.length }
    ];

    const getStatusBeaconColor = (status) => {
        if (status === 'UP' || status === 'ACTIVE') return 'bg-success-green';
        if (status === 'DOWN' || status === 'INACTIVE') return 'bg-alert-red animate-pulse';
        return 'bg-warn-orange animate-pulse';
    };

    const getStatusTextColor = (status) => {
        if (status === 'UP' || status === 'ACTIVE') return 'text-success-green';
        if (status === 'DOWN' || status === 'INACTIVE') return 'text-alert-red';
        return 'text-warn-orange';
    };

    return (
        <div className="dark min-h-screen bg-[#090d16] text-foreground font-sans flex overflow-hidden">

            {/* 1. Persistent Health Monitor Sidebar */}
            <aside className="w-72 bg-[#0b0e14] border-r border-[#1e2430] flex flex-col justify-between h-screen sticky top-0 shrink-0 hidden md:flex z-20">
                <div className="flex flex-col">
                    {/* Sidebar Brand Header */}
                    <div className="p-6 border-b border-[#1e2430] flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-cyber-blue/10 border border-cyber-blue/40 flex items-center justify-center">
                            <Activity className="w-5 h-5 text-cyber-blue" />
                        </div>
                        <div>
                            <h2 className="text-md font-bold tracking-tight text-white uppercase font-sans">InveniOps</h2>
                            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">SRE Control Room</p>
                        </div>
                    </div>

                    {/* Live Health Beacons */}
                    <div className="p-6 space-y-6">
                        <h3 className="text-xs font-semibold font-mono text-gray-400 uppercase tracking-wider">Infrastructure Beacons</h3>
                        <div className="space-y-4">
                            {/* API Status */}
                            <div className="flex items-center justify-between p-3 rounded-lg bg-[#121824]/50 border border-[#1e2430] transition hover:border-[#1e2430]/80">
                                <div className="flex items-center gap-2.5">
                                    <Cpu className="w-4 h-4 text-gray-400" />
                                    <span className="text-xs font-semibold text-gray-300 font-mono">INGESTION_API</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${getStatusBeaconColor(systemHealth.api)}`}></span>
                                    <span className={`text-[10px] font-bold font-mono ${getStatusTextColor(systemHealth.api)}`}>{systemHealth.api}</span>
                                </div>
                            </div>

                            {/* DB Status */}
                            <div className="flex items-center justify-between p-3 rounded-lg bg-[#121824]/50 border border-[#1e2430] transition hover:border-[#1e2430]/80">
                                <div className="flex items-center gap-2.5">
                                    <Database className="w-4 h-4 text-gray-400" />
                                    <span className="text-xs font-semibold text-gray-300 font-mono">POSTGRES_DB</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${getStatusBeaconColor(systemHealth.db)}`}></span>
                                    <span className={`text-[10px] font-bold font-mono ${getStatusTextColor(systemHealth.db)}`}>{systemHealth.db}</span>
                                </div>
                            </div>

                            {/* Redis Status */}
                            <div className="flex items-center justify-between p-3 rounded-lg bg-[#121824]/50 border border-[#1e2430] transition hover:border-[#1e2430]/80">
                                <div className="flex items-center gap-2.5">
                                    <Activity className="w-4 h-4 text-gray-400" />
                                    <span className="text-xs font-semibold text-gray-300 font-mono">REDIS_DEBOUNCE</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${getStatusBeaconColor(systemHealth.redis)}`}></span>
                                    <span className={`text-[10px] font-bold font-mono ${getStatusTextColor(systemHealth.redis)}`}>{systemHealth.redis}</span>
                                </div>
                            </div>

                            {/* RabbitMQ Status */}
                            <div className="flex items-center justify-between p-3 rounded-lg bg-[#121824]/50 border border-[#1e2430] transition hover:border-[#1e2430]/80">
                                <div className="flex items-center gap-2.5">
                                    <Radio className="w-4 h-4 text-gray-400" />
                                    <span className="text-xs font-semibold text-gray-300 font-mono">RABBIT_BROKER</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${getStatusBeaconColor(systemHealth.rabbitmq)}`}></span>
                                    <span className={`text-[10px] font-bold font-mono ${getStatusTextColor(systemHealth.rabbitmq)}`}>{systemHealth.rabbitmq}</span>
                                </div>
                            </div>

                            {/* Workers Status */}
                            <div className="flex items-center justify-between p-3 rounded-lg bg-[#121824]/50 border border-[#1e2430] transition hover:border-[#1e2430]/80">
                                <div className="flex items-center gap-2.5">
                                    <Cpu className="w-4 h-4 text-gray-400" />
                                    <span className="text-xs font-semibold text-gray-300 font-mono">QUEUE_WORKERS</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${getStatusBeaconColor(systemHealth.workers)}`}></span>
                                    <span className={`text-[10px] font-bold font-mono ${getStatusTextColor(systemHealth.workers)}`}>{systemHealth.workers}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sidebar Footer Metadata */}
                <div className="p-6 border-t border-[#1e2430] space-y-3 font-mono text-[11px] text-gray-500 bg-[#090d16]/30">
                    <div className="flex items-center justify-between">
                        <span>OPERATOR:</span>
                        <span className="text-cyber-blue font-bold uppercase">{user?.username || 'GUEST'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span>SESSION_UP:</span>
                        <span className="text-white font-bold">{formatUptime(uptime)}</span>
                    </div>
                </div>
            </aside>

            {/* 2. Main Scrollable Container */}
            <div className="flex-1 flex flex-col h-screen overflow-y-auto relative z-10">
                {/* Top Control Panel Header */}
                <header className="sticky top-0 z-30 border-b border-[#1e2430] bg-[#090d16]/85 backdrop-blur-md px-8 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="md:hidden flex h-8 w-8 items-center justify-center rounded bg-cyber-blue/10 border border-cyber-blue/40">
                            <Activity className="w-4 h-4 text-cyber-blue" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold tracking-tight text-white font-sans uppercase">Dashboard</h1>
                            <p className="text-xs text-gray-500 font-mono">Real-time signal ingestion logs & resolution logs</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 bg-[#121824] border border-[#1e2430] px-3 py-1.5 rounded-lg">
                            <User className="w-3.5 h-3.5 text-cyber-blue" />
                            <span className="font-mono text-xs text-gray-300 font-bold uppercase tracking-wide">{user?.role || 'OPERATOR'}</span>
                        </div>
                        <Separator orientation="vertical" className="h-5 bg-[#1e2430]" />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={logout}
                            className="text-alert-red hover:text-white hover:bg-alert-red/20 font-mono text-xs border border-transparent hover:border-alert-red/30 gap-1.5"
                        >
                            <LogOut className="w-3.5 h-3.5" />
                            DISCONNECT
                        </Button>
                    </div>
                </header>

                <main className="p-8 space-y-8 max-w-7xl w-full mx-auto">
                    {/* Grafana-style Stats Panel */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                        {/* Total Alerts panel */}
                        <Card className="bg-[#121824] border border-[#1e2430] relative overflow-hidden transition duration-300 hover:border-[#1e2430]/80">
                            <CardContent className="p-6 flex items-center justify-between">
                                <div>
                                    <div className="text-3xl font-extrabold font-mono tracking-tight text-white">{incidents.length}</div>
                                    <p className="text-xs font-mono text-gray-400 mt-1 uppercase tracking-wider">Total Signals Ingested</p>
                                </div>
                                <div className="p-3 bg-gray-800/40 rounded-lg border border-[#1e2430]">
                                    <TerminalIcon className="w-5 h-5 text-gray-400" />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Active Alerts Panel */}
                        <Card className="bg-[#121824] border border-alert-red/30 relative overflow-hidden transition duration-300 hover:border-alert-red/50 shadow-[0_0_20px_rgba(255,51,102,0.02)]">
                            <CardContent className="p-6 flex items-center justify-between">
                                <div>
                                    <div className="text-3xl font-extrabold font-mono tracking-tight text-alert-red">{openIncidents.length}</div>
                                    <p className="text-xs font-mono text-gray-400 mt-1 uppercase tracking-wider">Unresolved Incidents</p>
                                </div>
                                <div className={`p-3 bg-alert-red/10 border border-alert-red/30 rounded-lg ${openIncidents.length > 0 ? 'animate-pulse' : ''}`}>
                                    <Flame className={`w-5 h-5 text-alert-red`} />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Resolved Panel */}
                        <Card className="bg-[#121824] border border-success-green/30 relative overflow-hidden transition duration-300 hover:border-success-green/50">
                            <CardContent className="p-6 flex items-center justify-between">
                                <div>
                                    <div className="text-3xl font-extrabold font-mono tracking-tight text-success-green">{closedIncidents.length}</div>
                                    <p className="text-xs font-mono text-gray-400 mt-1 uppercase tracking-wider">Incidents Resolved</p>
                                </div>
                                <div className="p-3 bg-success-green/10 border border-success-green/30 rounded-lg">
                                    <CheckCircle2 className="w-5 h-5 text-success-green" />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* SRE Analytics Command Center */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                        {/* Bar Chart Panel */}
                        <div className="bg-[#121824] border border-[#1e2430] rounded-xl p-6 shadow-xl h-80 flex flex-col">
                            <div className="flex items-center gap-2 mb-6">
                                <ShieldAlert className="w-4 h-4 text-cyber-blue" />
                                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-mono">Active Outages by Severity</h3>
                            </div>
                            <div className="flex-1">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={severityData}>
                                        <XAxis dataKey="name" stroke="#475569" fontSize={11} tickLine={false} axisLine={false} fontClassName="font-mono" />
                                        <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} fontClassName="font-mono" />
                                        <Tooltip
                                            cursor={{ fill: '#1e2430' }}
                                            contentStyle={{ backgroundColor: '#0b0e14', borderColor: '#1e2430', color: '#f8fafc', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px' }}
                                        />
                                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                            {severityData.map((entry, index) => {
                                                let color = '#ffa726'; // P1
                                                if (entry.name.includes('P0')) color = '#ff3366'; // P0
                                                if (entry.name.includes('P2')) color = '#00e5ff'; // P2
                                                return <Cell key={`cell-${index}`} fill={color} />;
                                            })}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Donut Chart Panel */}
                        <div className="bg-[#121824] border border-[#1e2430] rounded-xl p-6 shadow-xl h-80 flex flex-col">
                            <div className="flex items-center gap-2 mb-6">
                                <CheckCircle2 className="w-4 h-4 text-cyber-blue" />
                                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-mono">System Resolution Burn-down</h3>
                            </div>
                            <div className="flex-1 relative flex items-center justify-center">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={stateData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={6}
                                            dataKey="count"
                                            stroke="none"
                                        >
                                            {stateData.map((entry, index) => {
                                                const color = entry.name === 'Active' ? '#ff3366' : '#00e676';
                                                return <Cell key={`cell-${index}`} fill={color} />;
                                            })}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#0b0e14', borderColor: '#1e2430', color: '#f8fafc', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px' }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>

                                {/* Donut Center Metrics */}
                                <div className="absolute text-center flex flex-col pointer-events-none">
                                    <span className="text-2xl font-bold font-mono text-white">
                                        {incidents.length > 0 ? Math.round((closedIncidents.length / incidents.length) * 100) : 100}%
                                    </span>
                                    <span className="text-[9px] font-mono text-gray-500 uppercase tracking-wider">Clear Rate</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* SRE Terminal Logs Incident Feed */}
                    <div className="bg-[#0b0e14] border border-[#1e2430] rounded-xl overflow-hidden shadow-2xl">
                        {/* Terminal Feed Header */}
                        <div className="bg-[#090d16]/80 px-5 py-3 border-b border-[#1e2430] flex items-center justify-between">
                            <div className="flex items-center gap-2 font-mono text-xs text-gray-400">
                                <span className="text-success-green">$</span>
                                <span>cat incident_feed.log</span>
                                <span className="w-1.5 h-3 bg-cyber-blue animate-terminal-blink inline-block ml-0.5"></span>
                            </div>
                            <span className="font-mono text-[10px] text-gray-500 uppercase">SYS_MON_TICKET_FEED</span>
                        </div>

                        {/* Log Stream Body */}
                        <div className="p-6 space-y-4 max-h-[600px] overflow-y-auto font-mono">
                            {incidents.length === 0 ? (
                                <div className="text-center py-12 text-gray-600 flex flex-col items-center gap-3">
                                    <CheckCircle2 className="w-8 h-8 text-success-green/30" />
                                    <span className="text-xs">SYSTEM STATUS: NOMINAL. NO ACTIVE OUTAGES FOUND.</span>
                                </div>
                            ) : (
                                incidents.map((inc) => {
                                    const isClosed = inc.state === 'CLOSED';
                                    const isAcked = acknowledgedIds.has(inc.id);

                                    // Border & text highlights based on status
                                    let borderStyle = 'border-l-4 border-l-[#ff3366]'; // P0 (Critical)
                                    let severityColor = 'text-alert-red';

                                    if (inc.severity === 'P1') {
                                        borderStyle = 'border-l-4 border-l-[#ffa726]';
                                        severityColor = 'text-warn-orange';
                                    } else if (inc.severity === 'P2') {
                                        borderStyle = 'border-l-4 border-l-[#00e5ff]';
                                        severityColor = 'text-cyber-blue';
                                    }

                                    if (isClosed) {
                                        borderStyle = 'border-l-4 border-l-success-green opacity-65';
                                        severityColor = 'text-success-green';
                                    }

                                    return (
                                        <div
                                            key={inc.id}
                                            className={`bg-[#121824]/40 border border-[#1e2430] rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 hover:border-[#1e2430]/90 hover:bg-[#121824]/60 ${borderStyle}`}
                                        >
                                            {/* Log Content */}
                                            <div className="space-y-2.5 max-w-2xl">
                                                {/* Meta Row */}
                                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                                    <span className="text-gray-500 font-mono">[{new Date(inc.created_at || Date.now()).toLocaleTimeString()}]</span>
                                                    <span className="bg-gray-800/80 border border-gray-700/50 px-2 py-0.5 rounded text-[10px] text-gray-300 font-semibold">{inc.component_id}</span>
                                                    <span className={`font-bold ${severityColor}`}>{inc.severity}</span>
                                                    <span className="text-gray-600">|</span>
                                                    <span className="text-gray-500">ID: {inc.id}</span>
                                                </div>

                                                {/* Log Message */}
                                                <div className={`text-sm tracking-wide ${isClosed ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                                                    {inc.message}
                                                </div>

                                                {/* RCA tags for resolved cases */}
                                                {isClosed && inc.rca && (
                                                    <div className="text-[11px] text-success-green/80 flex flex-wrap gap-x-3 gap-y-1 bg-success-green/5 border border-success-green/10 rounded px-2.5 py-1.5">
                                                        <span><strong>[RCA_CAT]</strong>: {inc.rca.root_cause_category}</span>
                                                        <span><strong>[FIX]</strong>: {inc.rca.fix_applied}</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Log Action Triggers */}
                                            <div className="flex items-center gap-2.5 self-end md:self-auto shrink-0">
                                                {isClosed ? (
                                                    <span className="text-xs text-success-green/60 font-semibold border border-success-green/20 bg-success-green/5 px-2.5 py-1 rounded flex items-center gap-1">
                                                        <Check className="w-3.5 h-3.5" />
                                                        ARCHIVED
                                                    </span>
                                                ) : (
                                                    <>
                                                        {isAcked ? (
                                                            <span className="text-xs text-warn-orange/70 font-semibold border border-warn-orange/20 bg-warn-orange/5 px-2.5 py-1 rounded">
                                                                ACKNOWLEDGED
                                                            </span>
                                                        ) : (
                                                            <button
                                                                onClick={() => handleAcknowledge(inc.id)}
                                                                className="text-xs font-semibold text-warn-orange hover:text-white border border-warn-orange/30 hover:bg-warn-orange/20 px-3 py-1.5 rounded transition-all cursor-pointer"
                                                            >
                                                                [ ACK ]
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => setSelectedIncident(inc)}
                                                            className="text-xs font-semibold text-cyber-blue hover:text-white border border-cyber-blue/30 hover:bg-cyber-blue/20 px-3 py-1.5 rounded transition-all cursor-pointer"
                                                        >
                                                            [ RESOLVE ]
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </main>
            </div>

            {/* RCA Dialog Overhaul */}
            <Dialog
                open={!!selectedIncident}
                onOpenChange={(open) => { if (!open) setSelectedIncident(null); }}
            >
                <DialogContent className="sm:max-w-md bg-[#121824] border border-[#1e2430] text-foreground font-sans">
                    <DialogHeader>
                        <DialogTitle className="text-white flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4 text-alert-red" />
                            Submit RCA & Close Ticket
                        </DialogTitle>
                        <DialogDescription className="text-gray-400 font-mono text-xs mt-1">
                            LOG_CLOSE_HANDSHAKE: <span className="text-cyber-blue">{selectedIncident?.id}</span>
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleCloseSubmit} className="space-y-4 mt-4 font-mono text-xs">
                        <div className="space-y-2">
                            <Label htmlFor="rca-category" className="text-gray-400 text-[11px] font-semibold uppercase tracking-wider">Root Cause Category</Label>
                            <Select
                                value={rcaForm.root_cause_category}
                                onValueChange={(value) => setRcaForm({ ...rcaForm, root_cause_category: value })}
                            >
                                <SelectTrigger id="rca-category" className="bg-[#090d16] border border-[#1e2430] text-gray-200 text-xs">
                                    <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent className="bg-[#121824] border border-[#1e2430] text-gray-300">
                                    <SelectItem value="Database" className="hover:bg-[#1f2937] focus:bg-[#1f2937]">Database</SelectItem>
                                    <SelectItem value="Network" className="hover:bg-[#1f2937] focus:bg-[#1f2937]">Network</SelectItem>
                                    <SelectItem value="Code / Deployment" className="hover:bg-[#1f2937] focus:bg-[#1f2937]">Code / Deployment</SelectItem>
                                    <SelectItem value="Infrastructure" className="hover:bg-[#1f2937] focus:bg-[#1f2937]">Infrastructure</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="fix-applied" className="text-gray-400 text-[11px] font-semibold uppercase tracking-wider">Fix Applied</Label>
                            <Textarea
                                id="fix-applied"
                                required
                                placeholder="Details of repair workflow executed..."
                                value={rcaForm.fix_applied}
                                onChange={(e) => setRcaForm({ ...rcaForm, fix_applied: e.target.value })}
                                className="min-h-[80px] bg-[#090d16] border border-[#1e2430] text-gray-200 placeholder:text-gray-600 text-xs resize-none"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="prevention-steps" className="text-gray-400 text-[11px] font-semibold uppercase tracking-wider">Prevention Steps</Label>
                            <Textarea
                                id="prevention-steps"
                                required
                                placeholder="Strategies deployed to prevent reoccurrence..."
                                value={rcaForm.prevention_steps}
                                onChange={(e) => setRcaForm({ ...rcaForm, prevention_steps: e.target.value })}
                                className="min-h-[80px] bg-[#090d16] border border-[#1e2430] text-gray-200 placeholder:text-gray-600 text-xs resize-none"
                            />
                        </div>

                        <DialogFooter className="mt-6 gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setSelectedIncident(null)}
                                disabled={isSubmitting}
                                className="border-[#1e2430] text-gray-400 hover:text-white hover:bg-[#1e2430]"
                            >
                                CANCEL
                            </Button>
                            <Button
                                type="submit"
                                disabled={isSubmitting}
                                className="bg-gradient-to-r from-blue-600 to-cyber-blue hover:from-blue-500 hover:to-[#00f0ff] text-white font-bold"
                            >
                                {isSubmitting ? 'SUBMITTING...' : 'SUBMIT_AND_CLOSE'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}