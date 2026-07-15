import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listLessons, type Lesson } from './api.js';
import { Card, CardContent, CardDescription, CardTitle } from './components/ui/card.js';
import PromotedLessonCard from './PromotedLessonCard.js';
import { useDeleteLesson } from './useDeleteLesson.js';

export default function MyLessons() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const handleDelete = useDeleteLesson(setLessons, setMessage);

  useEffect(() => {
    listLessons({ status: 'promoted', mine: true })
      .then((result) => { setLessons(result); setMessage(null); })
      .catch((error) => setMessage(`Could not load your lessons: ${(error as Error).message}`));
  }, []);

  return <section className="workspace-section" aria-labelledby="my-lessons-title">
    <div className="section-intro"><div><p className="eyebrow">Personal library</p><h2 id="my-lessons-title">Lessons you have helped shape.</h2><p>Your signed-in account determines this view, even if your display name changes later.</p></div></div>
    {message && <div className="feedback-message" role="status">{message}</div>}
    {lessons.length === 0 && !message ? <EmptyState title="No lessons here yet" description="Lessons promoted from examples you captured will appear here." /> : null}
    {lessons.length > 0 && <div className="lesson-library">{lessons.map((lesson) => <PromotedLessonCard key={lesson.id} lesson={lesson} onDelete={handleDelete} />)}</div>}
  </section>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <Card className="empty-state empty-state--compact"><CardContent><div className="empty-state__mark"><ArrowRight size={21} /></div><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div></CardContent></Card>;
}
