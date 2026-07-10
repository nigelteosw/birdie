import { useEffect, useState } from 'react';
import { getDomainProfile, listLessons, promoteLesson, reviewLesson, type Lesson } from './api.js';

interface Props {
  refreshSignal: number;
}

export default function ReviewList({ refreshSignal }: Props) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [typologies, setTypologies] = useState<string[]>([]);
  const [reviewerById, setReviewerById] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const [profile, pending] = await Promise.all([getDomainProfile(), listLessons({ status: 'pending_review' })]);
    setTypologies(profile.typology_categories);
    setLessons(pending);
  }

  useEffect(() => {
    refresh().catch((err) => setMessage((err as Error).message));
  }, [refreshSignal]);

  async function handleSaveDraft(lesson: Lesson) {
    await act(async () => {
      await reviewLesson(lesson.id, editableFields(lesson));
      setMessage('Draft saved.');
    });
  }

  async function handlePromote(lesson: Lesson) {
    const reviewer = reviewerById[lesson.id]?.trim();
    if (!reviewer) {
      setMessage('Enter a reviewer name first.');
      return;
    }
    await act(async () => {
      await promoteLesson(lesson.id, { reviewer, ...editableFields(lesson) });
      setMessage('Added to the shared library.');
    });
  }

  async function handleReject(lesson: Lesson) {
    await act(async () => {
      await reviewLesson(lesson.id, { reject: true });
      setMessage('Rejected.');
    });
  }

  async function act(fn: () => Promise<void>) {
    try {
      await fn();
      await refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    }
  }

  function updateField(id: string, field: 'quote' | 'what_changed' | 'why_it_matters' | 'typology', value: string) {
    setLessons((prev) => prev.map((lesson) => (lesson.id === id ? { ...lesson, [field]: value } : lesson)));
  }

  return (
    <section className="panel">
      <div className="section-header">
        <h2>Review queue</h2>
        <button type="button" className="secondary" onClick={() => refresh()}>
          Refresh
        </button>
      </div>
      {message && <p className="status">{message}</p>}
      {lessons.length === 0 && <p className="empty">Nothing waiting for review.</p>}
      <div className="lesson-list">
        {lessons.map((lesson) => (
          <article key={lesson.id} className="lesson-card">
            <div className="meta">
              <span>Submitted by: {lesson.submitted_by}</span>
              {lesson.playbook_ref && <span>Playbook: {lesson.playbook_ref}</span>}
            </div>
            {!lesson.quote_verified && <p className="warning">We could not find this exact wording in the original. Please check it.</p>}
            {lesson.playbook_alignment === 'diverges' && (
              <p className="warning">This differs from your playbook. {lesson.playbook_note}</p>
            )}
            <label>
              Quote
              <textarea value={lesson.quote} rows={2} onChange={(event) => updateField(lesson.id, 'quote', event.target.value)} />
            </label>
            <label>
              What changed
              <textarea
                value={lesson.what_changed}
                rows={2}
                onChange={(event) => updateField(lesson.id, 'what_changed', event.target.value)}
              />
            </label>
            <label>
              Why it matters
              <textarea
                value={lesson.why_it_matters}
                rows={3}
                onChange={(event) => updateField(lesson.id, 'why_it_matters', event.target.value)}
              />
            </label>
            <label>
              Category
              <select value={lesson.typology} onChange={(event) => updateField(lesson.id, 'typology', event.target.value)}>
                {typologies.map((typology) => (
                  <option key={typology} value={typology}>
                    {typology}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reviewer
              <input
                value={reviewerById[lesson.id] ?? ''}
                onChange={(event) => setReviewerById((prev) => ({ ...prev, [lesson.id]: event.target.value }))}
              />
            </label>
            <p className="privacy">Remove client names, matter names, and other private details before adding this lesson.</p>
            <div className="actions">
              <button type="button" onClick={() => handlePromote(lesson)}>
                Add to shared library
              </button>
              <button type="button" className="secondary" onClick={() => handleSaveDraft(lesson)}>
                Save as Draft
              </button>
              <button type="button" className="danger" onClick={() => handleReject(lesson)}>
                Reject
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function editableFields(lesson: Lesson) {
  return {
    quote: lesson.quote,
    what_changed: lesson.what_changed,
    why_it_matters: lesson.why_it_matters,
    typology: lesson.typology,
  };
}
