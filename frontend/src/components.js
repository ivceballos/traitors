import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Minus, Plus } from '@phosphor-icons/react';
import { photoSrc, resizePhoto, socket } from './api';

export const ICON = { size: 20, weight: 'regular' };

export function Avatar({ player, size = 56, className = '' }) {
    const [broken, setBroken] = useState(false);
    const style = { '--size': `${size}px` };
    const dead = player.alive === false ? 'dead' : '';
    const src = photoSrc(player.photo);
    if (src && !broken) {
        return <img className={`avatar ${dead} ${className}`} style={style} src={src} alt="" onError={() => setBroken(true)} />;
    }
    return <span className={`avatar ${dead} ${className}`} style={style} aria-hidden="true">{player.name.charAt(0).toUpperCase()}</span>;
}

export function RoleTag({ role, factions }) {
    if (!role) return null;
    return <span className={`tag ${role === 'traitor' ? 'accent' : ''}`}>{role === 'traitor' ? factions.traitor : factions.loyal}</span>;
}

export function useToasts(timeout = 6000) {
    const [toasts, setToasts] = useState([]);
    const push = useCallback((text, kind = 'info') => {
        const id = Math.random().toString(36).slice(2);
        setToasts(t => [...t.slice(-2), { id, text, kind }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), timeout);
    }, [timeout]);
    const dismiss = id => setToasts(t => t.filter(x => x.id !== id));
    return { toasts, push, dismiss };
}

export function Toasts({ toasts, dismiss }) {
    return (
        <div className="toasts" role="status" aria-live="polite">
            {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>{t.text}</div>)}
        </div>
    );
}

// Solo avisa de la desconexión cuando de verdad se pierde (no mientras conecta por primera vez)
export function useConnection() {
    const [connected, setConnected] = useState(true);
    useEffect(() => {
        const on = () => setConnected(true);
        const off = () => setConnected(false);
        socket.on('connect', on);
        socket.on('disconnect', off);
        socket.on('connect_error', off);
        return () => { socket.off('connect', on); socket.off('disconnect', off); socket.off('connect_error', off); };
    }, []);
    return connected;
}

// Suscripción a eventos del socket con limpieza automática
export function useSocketEvent(event, handler) {
    const ref = useRef(handler);
    ref.current = handler;
    useEffect(() => {
        const fn = (...args) => ref.current(...args);
        socket.on(event, fn);
        return () => socket.off(event, fn);
    }, [event]);
}

export function OfflineBanner({ connected }) {
    if (connected) return null;
    return <div className="offline">Sin conexión. Reconectando…</div>;
}

export function Loading({ text }) {
    return (
        <div className="loading">
            <img className="logo" src={`${process.env.PUBLIC_URL}/img/logo.webp`} alt="Fieles y Felones" width="120" height="120" />
            {text && <span className="small">{text}</span>}
        </div>
    );
}

export function Modal({ children, onClose }) {
    return (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && onClose) onClose(); }}>
            <div className="modal" role="dialog" aria-modal="true">{children}</div>
        </div>
    );
}

export function PhotoPicker({ value, onChange, onError, size = 96, label = 'Hacer foto' }) {
    const input = useRef(null);
    const pick = async e => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            onChange(await resizePhoto(file));
        } catch (err) {
            if (onError) onError(err.message);
        }
    };
    return (
        <button type="button" className="row nowrap" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', gap: 14 }} onClick={() => input.current.click()}>
            {value
                ? <img className="avatar" style={{ '--size': `${size}px` }} src={value} alt="Tu foto" />
                : <span className="avatar" style={{ '--size': `${size}px` }}><Camera size={size * 0.34} /></span>}
            <span className="small muted">{label}</span>
            <input ref={input} type="file" accept="image/*" capture="user" hidden onChange={pick} />
        </button>
    );
}

export function Stepper({ value, min = 0, max = 10, onChange, label }) {
    return (
        <span className="stepper" aria-label={label}>
            <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Menos"><Minus size={16} /></button>
            <span>{value}</span>
            <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Más"><Plus size={16} /></button>
        </span>
    );
}

export function Segmented({ options, value, onChange }) {
    return (
        <div className="segmented" role="radiogroup">
            {options.map(o => (
                <button type="button" role="radio" aria-checked={value === o.value} key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
                    {o.icon}{o.label}
                </button>
            ))}
        </div>
    );
}

export function CopyBox({ value, label = 'Copiar' }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            if (navigator.share && /Mobi/i.test(navigator.userAgent)) await navigator.share({ url: value });
            else {
                await navigator.clipboard.writeText(value);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }
        } catch (_) { /* cancelado */ }
    };
    return (
        <div className="share-box">
            <code>{value}</code>
            <button type="button" className="btn sm" onClick={copy}>{copied ? 'Copiado' : label}</button>
        </div>
    );
}

// Umbrales de calaveras de los Fantasmas: el alcanzado se ilumina
export function Thresholds({ skulls, thresholds }) {
    return (
        <div className="thresholds">
            {thresholds.map(t => (
                <div key={t.skulls} className={skulls >= t.skulls ? 'reached' : ''}>
                    <div className="display">{t.percent}%</div>
                    <div className="tiny muted">con {t.skulls} calaveras</div>
                </div>
            ))}
        </div>
    );
}

const fmt = n => n.toLocaleString('es-ES');

export function TestsTable({ tests }) {
    if (tests.length === 0) return <p className="muted small m0">Todavía no hay pruebas.</p>;
    return (
        <table className="table">
            <thead>
                <tr><th>Prueba</th><th className="r">Oro</th><th className="r">Máximo</th></tr>
            </thead>
            <tbody>
                {tests.map(t => (
                    <tr key={t.id}>
                        <td>
                            {t.name}
                            {t.status === 'active' && <span className="tag accent" style={{ marginLeft: 8 }}>En juego</span>}
                        </td>
                        <td className="r">{t.score === null ? <span className="faint">Pendiente</span> : fmt(t.score)}</td>
                        <td className="r muted">{t.max ? fmt(t.max) : ''}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

// Fondo de castillo con niebla y antorchas (va detrás de todas las pantallas)
export function Atmosphere() {
    return (
        <>
            <div className="atmosphere" aria-hidden="true" style={{
                '--castle-v': `url(${process.env.PUBLIC_URL}/img/castillo-vertical.jpg)`,
                '--castle-h': `url(${process.env.PUBLIC_URL}/img/castillo-horizontal.jpg)`
            }}>
                <div className="castle" />
                <div className="torch left" />
                <div className="torch right" />
                <div className="fog" />
                <div className="vignette" />
            </div>
            <div className="grain" aria-hidden="true" />
        </>
    );
}

// Ilustración opcional de /public/img: si el archivo no existe, desaparece sin dejar hueco
export function Art({ name, className = '', alt = '' }) {
    const [missing, setMissing] = useState(false);
    if (missing) return null;
    return <img className={`art ${className}`} src={`${process.env.PUBLIC_URL}/img/${name}`} alt={alt} onError={() => setMissing(true)} decoding="async" />;
}
