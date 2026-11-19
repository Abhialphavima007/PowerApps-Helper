import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function SignInPrompt({ progress, onCancel }) {
  const dialogRef = useRef(null);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState('');
  const deviceCode = progress.method === 'deviceCode';
  const secondsLeft = Math.max(0, Math.ceil((progress.expiresAt - now) / 1000));

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      if (dialog.open) dialog.close();
    };
  }, []);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(progress.userCode);
      setMessage('Code copied.');
    } catch { setMessage('Select the code above and copy it manually.'); }
  };
  const openSignIn = async () => {
    try {
      const result = await api.util.openExternal(progress.verificationUri);
      if (result?.ok === false) setMessage('Open the Microsoft address shown above in your browser.');
    } catch { setMessage('Open the Microsoft address shown above in your browser.'); }
  };

  return <dialog ref={dialogRef} className="sign-in-dialog" aria-labelledby="sign-in-heading" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id="sign-in-heading">{deviceCode ? 'Sign in with device code' : 'Microsoft sign-in'}</h2>
    {progress.loginHint && <p>Use <strong>{progress.loginHint}</strong> to continue.</p>}
    {deviceCode ? progress.userCode ? <>
      <p>Open the Microsoft sign-in page and enter this code:</p>
      <div className="sign-in-code" aria-label="Sign-in code" role="status">{progress.userCode}</div>
      <p className="sign-in-address">{progress.verificationUri}</p>
      <p className="muted">{secondsLeft > 0 ? `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}.` : 'Code expired. Cancel and try again for a new code.'}</p>
      <div className="sign-in-actions">
        <button className="btn secondary" onClick={copyCode} disabled={!secondsLeft}>Copy code</button>
        <button className="btn" onClick={openSignIn} disabled={!secondsLeft}>Open Microsoft sign-in</button>
      </div>
    </> : <p role="status"><span className="spin" /> Getting your sign-in code…</p>
      : <p>Complete sign-in in your browser, then return to PowerApps Helper.</p>}
    <p className="muted">Your organization may require administrator approval for this app.</p>
    {message && <p role="status">{message}</p>}
    <div className="sign-in-actions"><button className="btn secondary" onClick={onCancel}>Cancel sign-in</button></div>
  </dialog>;
}
