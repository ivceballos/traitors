import React, { useEffect, useState } from 'react';

export function Avatar({ player }) {
    const [broken, setBroken] = useState(false);
    if (player.photo && !broken) {
        return <img className="avatar" src={player.photo} alt="" onError={() => setBroken(true)} />;
    }
    return <span className="avatar">{player.name.charAt(0).toUpperCase()}</span>;
}

export function RoleBadge({ role }) {
    if (!role) return null;
    return <span className={`badge ${role}`}>{role === 'traidor' ? 'Traidor' : 'Fiel'}</span>;
}

// Mensajes temporales; se cierran solos o al tocarlos
export function useToasts(timeout = 6000) {
    const [toasts, setToasts] = useState([]);
    const push = (text, kind = 'info') => {
        const id = Math.random().toString(36).slice(2);
        setToasts(t => [...t.slice(-3), { id, text, kind }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), timeout);
    };
    const dismiss = id => setToasts(t => t.filter(x => x.id !== id));
    return { toasts, push, dismiss };
}

export function Toasts({ toasts, dismiss }) {
    return (
        <div className="toasts">
            {toasts.map(t => (
                <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>{t.text}</div>
            ))}
        </div>
    );
}

export function useConnection(socket) {
    const [connected, setConnected] = useState(socket.connected);
    useEffect(() => {
        const on = () => setConnected(true);
        const off = () => setConnected(false);
        socket.on('connect', on);
        socket.on('disconnect', off);
        return () => {
            socket.off('connect', on);
            socket.off('disconnect', off);
        };
    }, [socket]);
    return connected;
}
