// src/services/api.js
const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : 'https://inveniops-be.duckdns.org';

// Helper function to grab the token and format the header
const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
};

export const loginUser = async (credentials) => {
    const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
    });
    if (!response.ok) throw new Error('Invalid credentials');
    return response.json();
};

export const fetchIncidents = async () => {
    const response = await fetch(`${API_URL}/incidents`, {
        headers: getAuthHeaders(),
    });
    if (!response.ok) {
        if (response.status === 401) throw new Error('Unauthorized');
        throw new Error('Failed to fetch incidents');
    }
    return response.json();
};

export const closeIncident = async (id, rcaData) => {
    const response = await fetch(`${API_URL}/incidents/${id}/close`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(rcaData),
    });
    if (!response.ok) throw new Error('Failed to close incident. Admins only.');
    return response.json();
};