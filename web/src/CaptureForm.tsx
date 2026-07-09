import { useState } from 'react';
import { captureTrace } from './api.js';

interface Props {
  onCaptured: () => void;
}

export default function CaptureForm({ onCaptured }: Props) {
  const [beforeText, setBeforeText] = useState('');
  const [afterText, setAfterText] = useState('');
  const [submittedBy, setSubmittedBy] = useState('');
  const [playbookRef, setPlaybookRef] = useState('');
  const [playbookText, setPlaybookText] = useState('');
  const [contextNote, setContextNote] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('Saving...');
    try {
      const trace = await captureTrace({
        before_text: beforeText,
        after_text: afterText,
        submitted_by: submittedBy,
        playbook_ref: playbookRef || undefined,
        playbook_text: playbookText || undefined,
        context_note: contextNote || undefined,
      });
      setBeforeText('');
      setAfterText('');
      setContextNote('');
      setStatus(`Saved example ${trace.id}. Ask Birdie in chat to extract a lesson from it.`);
      onCaptured();
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  }

  return (
    <details className="panel capture-panel">
      <summary>Capture an example</summary>
      <form onSubmit={submit} className="capture-grid">
        <label className="wide">
          Before
          <textarea value={beforeText} onChange={(event) => setBeforeText(event.target.value)} required rows={5} />
        </label>
        <label className="wide">
          After
          <textarea value={afterText} onChange={(event) => setAfterText(event.target.value)} required rows={5} />
        </label>
        <label>
          Submitted by
          <input value={submittedBy} onChange={(event) => setSubmittedBy(event.target.value)} required />
        </label>
        <label>
          Playbook ref
          <input value={playbookRef} onChange={(event) => setPlaybookRef(event.target.value)} />
        </label>
        <label className="wide">
          Playbook text
          <textarea value={playbookText} onChange={(event) => setPlaybookText(event.target.value)} rows={3} />
        </label>
        <label className="wide">
          Context
          <textarea value={contextNote} onChange={(event) => setContextNote(event.target.value)} rows={2} />
        </label>
        <div className="actions wide">
          <button type="submit">Capture</button>
          {status && <span className="status">{status}</span>}
        </div>
      </form>
    </details>
  );
}
