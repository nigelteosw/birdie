import { Check, ChevronRight, FileEdit, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listLessons, promoteLesson, reviewLesson, type Lesson } from './api.js';
import { Badge } from './components/ui/badge.js';
import { Button } from './components/ui/button.js';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card.js';
import { Textarea } from './components/ui/textarea.js';

interface Props {
  refreshSignal: number;
  onCapture: () => void;
}

export default function ReviewList({ refreshSignal, onCapture }: Props) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  async function refresh() {
    const pending = await listLessons({ status: 'pending_review' });
    setLessons(pending);
  }

  useEffect(() => {
    refresh().catch((err) => setMessage(`Could not load the queue: ${(err as Error).message}`));
  }, [refreshSignal]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (editingId) return;
      refresh().catch((err) => setMessage(`Could not load the queue: ${(err as Error).message}`));
    }, 5000);
    return () => clearInterval(interval);
  }, [editingId]);

  async function handleSaveDraft(lesson: Lesson) {
    await act(lesson.id, async () => {
      await reviewLesson(lesson.id, editableFields(lesson));
      setEditingId(null);
      setMessage('Draft saved. It is still waiting for a final review.');
    });
  }

  async function handlePromote(lesson: Lesson) {
    await act(lesson.id, async () => {
      await promoteLesson(lesson.id, editableFields(lesson));
      setMessage('Lesson added to the knowledge base.');
    });
  }

  async function handleReject(lesson: Lesson) {
    await act(lesson.id, async () => {
      await reviewLesson(lesson.id, { reject: true });
      setMessage('Lesson rejected and removed from the queue.');
    });
  }

  async function act(id: string, fn: () => Promise<void>) {
    setWorkingId(id);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setMessage(`Could not update the lesson: ${(err as Error).message}`);
    } finally {
      setWorkingId(null);
    }
  }

  function updateField(id: string, field: 'quote' | 'what_changed' | 'why_it_matters', value: string) {
    setLessons((prev) => prev.map((lesson) => (lesson.id === id ? { ...lesson, [field]: value } : lesson)));
  }

  return (
    <section className="workspace-section" aria-labelledby="review-title">
      <div className="section-intro">
        <div>
          <p className="eyebrow">Review workflow</p>
          <h2 id="review-title">Keep only the guidance you trust.</h2>
          <p>Check the proposed lesson, tune the wording, then promote it when it is ready to be shared.</p>
        </div>
        <div className="section-intro__actions">
          <Button variant="outline" size="sm" onClick={() => refresh()}>
            <RefreshCw size={15} />
            Refresh
          </Button>
          <Button size="sm" onClick={onCapture}>
            Capture example <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {message && <div className="feedback-message" role="status"><Check size={16} />{message}</div>}

      {lessons.length === 0 ? (
        <Card className="empty-state">
          <CardContent>
            <div className="empty-state__mark"><Check size={22} /></div>
            <div>
              <CardTitle>All caught up</CardTitle>
              <CardDescription>There are no lessons waiting for review. Capture a useful example when the next one comes along.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={onCapture}>Capture an example</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="review-list">
          {lessons.map((lesson, index) => {
            const editing = editingId === lesson.id;
            const working = workingId === lesson.id;
            return (
              <Card key={lesson.id} className="review-card">
                <CardHeader>
                  <div className="review-card__heading">
                    <span className="queue-number">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <p className="overline">Submitted by {lesson.submitted_by}</p>
                      <CardTitle>Proposed lesson</CardTitle>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(editing ? null : lesson.id)}>
                    <FileEdit size={15} />
                    {editing ? 'Done editing' : 'Edit'}
                  </Button>
                </CardHeader>
                <CardContent className="review-card__content">
                  <div className="badge-row">
                    {!lesson.quote_verified && <Badge variant="warning"><ShieldAlert size={13} /> Verify quote</Badge>}
                  </div>

                  {editing ? (
                    <div className="lesson-editor">
                      <EditableField label="Quote"><Textarea value={lesson.quote} rows={2} onChange={(event) => updateField(lesson.id, 'quote', event.target.value)} /></EditableField>
                      <EditableField label="What changed"><Textarea value={lesson.what_changed} rows={2} onChange={(event) => updateField(lesson.id, 'what_changed', event.target.value)} /></EditableField>
                      <EditableField label="Why it matters"><Textarea value={lesson.why_it_matters} rows={3} onChange={(event) => updateField(lesson.id, 'why_it_matters', event.target.value)} /></EditableField>
                    </div>
                  ) : (
                    <LessonPreview lesson={lesson} />
                  )}
                </CardContent>
                <CardFooter className="review-card__footer">
                  <p className="privacy-note">Remove client or matter details before sharing.</p>
                  <div className="card-actions">
                    {editing && <Button type="button" variant="outline" size="sm" disabled={working} onClick={() => handleSaveDraft(lesson)}>Save draft</Button>}
                    <Button type="button" size="sm" disabled={working} onClick={() => handlePromote(lesson)}><Check size={16} /> Promote</Button>
                    <Button type="button" variant="destructive" size="icon" disabled={working} onClick={() => handleReject(lesson)} aria-label="Reject lesson"><X size={16} /></Button>
                  </div>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LessonPreview({ lesson }: { lesson: Lesson }) {
  return (
    <div className="lesson-preview">
      <blockquote>{lesson.quote}</blockquote>
      <div className="lesson-preview__detail">
        <span>What changed</span>
        <p>{lesson.what_changed}</p>
      </div>
      <div className="lesson-preview__detail">
        <span>Why it matters</span>
        <p>{lesson.why_it_matters}</p>
      </div>
    </div>
  );
}

function EditableField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span className="field__label">{label}</span>{children}</label>;
}

function editableFields(lesson: Lesson) {
  return { quote: lesson.quote, what_changed: lesson.what_changed, why_it_matters: lesson.why_it_matters };
}
