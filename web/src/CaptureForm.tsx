import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { captureTrace } from './api.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';
import { Textarea } from './components/ui/textarea.js';

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
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus(null);
    setIsSaving(true);
    try {
      await captureTrace({
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
      onCaptured();
    } catch (err) {
      setStatus(`Could not save this example: ${(err as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="capture-form">
      <div className="capture-form__grid">
        <Field label="Before" hint="What was happening before the change?" className="span-full">
          <Textarea value={beforeText} onChange={(event) => setBeforeText(event.target.value)} required rows={5} />
        </Field>
        <Field label="After" hint="What changed or worked better?" className="span-full">
          <Textarea value={afterText} onChange={(event) => setAfterText(event.target.value)} required rows={5} />
        </Field>
        <Field label="Submitted by">
          <Input value={submittedBy} onChange={(event) => setSubmittedBy(event.target.value)} placeholder="e.g. Jane" required />
        </Field>
        <Field label="Playbook reference" optional>
          <Input value={playbookRef} onChange={(event) => setPlaybookRef(event.target.value)} placeholder="e.g. Intake guide §3" />
        </Field>
        <Field label="Playbook text" optional className="span-full">
          <Textarea value={playbookText} onChange={(event) => setPlaybookText(event.target.value)} rows={3} />
        </Field>
        <Field label="Helpful context" optional className="span-full">
          <Textarea value={contextNote} onChange={(event) => setContextNote(event.target.value)} rows={2} />
        </Field>
      </div>
      {status && <p className="form-error">{status}</p>}
      <div className="capture-form__footer">
        <p>Your example stays in the review queue until a lesson is promoted.</p>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}
          {isSaving ? 'Saving example' : 'Save example'}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  optional = false,
  className,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span className="field__label">
        {label}
        {optional && <em>Optional</em>}
      </span>
      {hint && <span className="field__hint">{hint}</span>}
      {children}
    </label>
  );
}
