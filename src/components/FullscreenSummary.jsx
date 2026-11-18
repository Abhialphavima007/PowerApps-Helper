import React, { useEffect, useRef } from 'react';

function SummaryContent({ value }) {
  if (!value) return <p>No change summary yet.</p>;
  return value.split(/\n+/).map((part, index) => {
    const line = part.trim();
    if (!line) return null;
    if (/^─{5,}$/.test(line)) return <hr key={index} />;
    if (/^Story AB#\d+:/.test(line)) return <h3 key={index}>{line}</h3>;
    if (/^Story status:/.test(line)) return <p className="muted" key={index}>{line}</p>;
    const section = line.match(/^(Problem|How it was addressed and tracked|Outcome and remaining work):\s*(.*)$/);
    return section
      ? <p key={index}><strong>{section[1]}:</strong> {section[2]}</p>
      : <p key={index}>{line}</p>;
  });
}

export default function FullscreenSummary({ value, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return <dialog ref={dialogRef} className="summary-dialog" aria-label="Change summary" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="summary-dialog-layout">
      <header className="summary-dialog-header">
        <div><h2>Change summary</h2><span className="muted">Review each story's problem, work, and outcome.</span></div>
        <button className="btn secondary" onClick={onClose} aria-label="Close full-screen summary">Close</button>
      </header>
      <div className="summary-dialog-body">
        <article className="summary-dialog-preview"><SummaryContent value={value} /></article>
      </div>
      <footer className="summary-dialog-footer">
        <button className="btn" onClick={onClose}>Done</button>
      </footer>
    </div>
  </dialog>;
}
