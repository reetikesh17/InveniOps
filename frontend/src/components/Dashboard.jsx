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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function Dashboard() {
    const [incidents, setIncidents] = useState([]);
    const [selectedIncident, setSelectedIncident] = useState(null);
    const [rcaForm, setRcaForm] = useState({ root_cause_category: 'Database', fix_applied: '', prevention_steps: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { logout, user } = useContext(AuthContext);

    useEffect(() => {
        loadIncidents();
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
        setIsSubmitting(true);
        try {
            await closeIncident(selectedIncident.id, rcaForm);
            setSelectedIncident(null);
            setRcaForm({ root_cause_category: 'Database', fix_applied: '', prevention_steps: '' });
            loadIncidents();
        } catch (error) {
            alert("Failed to submit RCA.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const openIncidents = incidents.filter(i => i.state !== 'CLOSED');
    const closedIncidents = incidents.filter(i => i.state === 'CLOSED');

    // --- Analytics Data Processing ---
    const severityData = [
        { name: 'Critical (P0)', count: incidents.filter(i => i.severity === 'P0').length },
        { name: 'Warning (P2)', count: incidents.filter(i => i.severity !== 'P0').length }
    ];

    const stateData = [
        { name: 'Open', count: incidents.filter(i => i.state === 'OPEN').length },
        { name: 'Closed', count: incidents.filter(i => i.state === 'CLOSED').length }
    ];
    // ---------------------------------

    return (
        <div className="dark min-h-screen bg-background text-foreground">
            {/* Header */}
            <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
                <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-4">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                            IMS
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold tracking-tight">Control Room</h1>
                            <p className="text-xs text-muted-foreground">Real-time incident monitoring</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Badge variant="outline" className="font-mono text-xs">
                            {user?.role || 'UNKNOWN'}
                        </Badge>
                        <Separator orientation="vertical" className="h-6" />
                        <Button variant="ghost" size="sm" onClick={logout} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                            Logout
                        </Button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-7xl px-6 py-8 space-y-10">
                {/* Stats Bar */}
                <div className="grid grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="text-2xl font-bold">{incidents.length}</div>
                            <p className="text-xs text-muted-foreground mt-1">Total Incidents</p>
                        </CardContent>
                    </Card>
                    <Card className="border-orange-500/30">
                        <CardContent className="pt-6">
                            <div className="text-2xl font-bold text-orange-400">{openIncidents.length}</div>
                            <p className="text-xs text-muted-foreground mt-1">Open</p>
                        </CardContent>
                    </Card>
                    <Card className="border-green-500/30">
                        <CardContent className="pt-6">
                            <div className="text-2xl font-bold text-green-400">{closedIncidents.length}</div>
                            <p className="text-xs text-muted-foreground mt-1">Resolved</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Real-Time Analytics Command Center */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Severity Bar Chart */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-lg h-72 flex flex-col">
                        <h3 className="text-sm font-medium text-gray-400 mb-4 uppercase tracking-wider">Active Incident Severity</h3>
                        <div className="flex-1">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={severityData}>
                                    <XAxis dataKey="name" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <Tooltip 
                                        cursor={{fill: '#1f2937'}}
                                        contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6', borderRadius: '8px' }} 
                                    />
                                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                        {severityData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.name.includes('P0') ? '#ef4444' : '#f97316'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Resolution Donut Chart */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-lg h-72 flex flex-col">
                        <h3 className="text-sm font-medium text-gray-400 mb-4 uppercase tracking-wider">Resolution Burn-Down</h3>
                        <div className="flex-1">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={stateData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="count"
                                        stroke="none"
                                    >
                                        {stateData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.name === 'Open' ? '#3b82f6' : '#22c55e'} />
                                        ))}
                                    </Pie>
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6', borderRadius: '8px' }} 
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Upgraded shadcn/ui Data Table */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden shadow-xl">
                    <Table>
                        <TableHeader className="bg-gray-900">
                            <TableRow className="border-gray-800 hover:bg-transparent">
                                <TableHead className="w-[100px] text-gray-400">Severity</TableHead>
                                <TableHead className="text-gray-400">Component</TableHead>
                                <TableHead className="text-gray-400">Alert Message</TableHead>
                                <TableHead className="text-gray-400">Status</TableHead>
                                <TableHead className="text-right text-gray-400">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {incidents.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                                        No active incidents. System is healthy.
                                    </TableCell>
                                </TableRow>
                            )}
                            {incidents.map((inc) => (
                                <TableRow key={inc.id} className="border-gray-800 hover:bg-gray-800/50 transition-colors">
                                    <TableCell className="font-medium">
                                        <Badge className={`${inc.severity === 'P0' ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-orange-500 hover:bg-orange-600 text-white'}`}>
                                            {inc.severity}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="font-mono text-sm text-gray-300">{inc.component_id}</TableCell>
                                    <TableCell className="text-gray-400 max-w-md truncate">{inc.message}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={`${inc.state === 'OPEN' ? 'text-blue-400 border-blue-400/50 bg-blue-400/10' : 'text-green-400 border-green-400/50 bg-green-400/10'}`}>
                                            {inc.state}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {inc.state !== 'CLOSED' ? (
                                            <button
                                                onClick={() => setSelectedIncident(inc)}
                                                className="text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors px-3 py-1 rounded hover:bg-blue-500/10"
                                            >
                                                Resolve
                                            </button>
                                        ) : (
                                            <span className="text-sm text-gray-600 italic px-3 py-1">Archived</span>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </main>

            {/* RCA Dialog */}
            <Dialog
                open={!!selectedIncident}
                onOpenChange={(open) => { if (!open) setSelectedIncident(null); }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Mandatory RCA Submission</DialogTitle>
                        <DialogDescription>
                            Closing ticket: <span className="font-mono text-foreground">{selectedIncident?.id}</span>
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleCloseSubmit} className="space-y-4 mt-2">
                        <div className="space-y-2">
                            <Label htmlFor="rca-category">Root Cause Category</Label>
                            <Select
                                value={rcaForm.root_cause_category}
                                onValueChange={(value) => setRcaForm({ ...rcaForm, root_cause_category: value })}
                            >
                                <SelectTrigger id="rca-category">
                                    <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Database">Database</SelectItem>
                                    <SelectItem value="Network">Network</SelectItem>
                                    <SelectItem value="Code / Deployment">Code / Deployment</SelectItem>
                                    <SelectItem value="Infrastructure">Infrastructure</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="fix-applied">Fix Applied</Label>
                            <Textarea
                                id="fix-applied"
                                required
                                placeholder="Describe what was done to fix the issue..."
                                value={rcaForm.fix_applied}
                                onChange={(e) => setRcaForm({ ...rcaForm, fix_applied: e.target.value })}
                                className="min-h-[80px] resize-none"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="prevention-steps">Prevention Steps</Label>
                            <Textarea
                                id="prevention-steps"
                                required
                                placeholder="How to prevent this in the future..."
                                value={rcaForm.prevention_steps}
                                onChange={(e) => setRcaForm({ ...rcaForm, prevention_steps: e.target.value })}
                                className="min-h-[80px] resize-none"
                            />
                        </div>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setSelectedIncident(null)}
                                disabled={isSubmitting}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting ? 'Submitting...' : 'Submit & Close'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}