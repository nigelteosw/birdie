import { ArrowRight, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listLessons, type Lesson } from './api.js';
import { Button } from './components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card.js';
import { Input } from './components/ui/input.js';
import PromotedLessonCard from './PromotedLessonCard.js';
import { useDeleteLesson } from './useDeleteLesson.js';

const NAME_KEY = 'birdie.myName';

export default function MyLessons() {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const handleDelete = useDeleteLesson(setLessons, setMessage);
  const trimmedName = name.trim();

  useEffect(() => {
    localStorage.setItem(NAME_KEY, name);
    if (!trimmedName) {
      setLessons([]);
      setMessage(null);
      return;
    }
    listLessons({ status: 'promoted', submitted_by: trimmedName })
      .then((result) => {
        setLessons(result);
        setMessage(null);
      })
      .catch((err) => setMessage(`Could not load your lessons: ${(err as Error).message}`));
  }, [name, trimmedName]);

  return (
    <section className="workspace-section" aria-labelledby="my-lessons-title">
      <div className="section-intro">
        <div>
          <p className="eyebrow">Personal library</p>
          <h2 id="my-lessons-title">Lessons you have helped shape.</h2>
          <p>A quiet, personal view of the guidance promoted from examples you submitted.</p>
        </div>
      </div>

      <Card className="filter-card">
        <CardHeader>
          <div className="filter-card__title">
            <div className="filter-card__icon"><UserRound size={18} /></div>
            <div>
              <CardTitle>Find your contribution history</CardTitle>
              <CardDescription>Your name is remembered on this device.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <label className="field filter-input">
            <span className="field__label">Your name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Jane" />
          </label>
        </CardContent>
      </Card>

      {message && <div className="feedback-message" role="status">{message}</div>}
      {!trimmedName ? <EmptyState title="Start with your name" description="Enter the name used when examples were captured to see your promoted lessons." /> : null}
      {trimmedName && lessons.length === 0 && !message ? <EmptyState title="No lessons here yet" description={`Promoted lessons from ${trimmedName} will appear here as they are reviewed.`} /> : null}
      {lessons.length > 0 && <div className="lesson-library">{lessons.map((lesson) => <PromotedLessonCard key={lesson.id} lesson={lesson} onDelete={handleDelete} />)}</div>}
    </section>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="empty-state empty-state--compact">
      <CardContent>
        <div className="empty-state__mark"><ArrowRight size={21} /></div>
        <div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div>
      </CardContent>
    </Card>
  );
}
