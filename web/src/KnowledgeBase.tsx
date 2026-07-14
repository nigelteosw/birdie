import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listLessons, type Lesson } from './api.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card.js';
import { Input } from './components/ui/input.js';
import PromotedLessonCard from './PromotedLessonCard.js';
import { EmptyState } from './MyLessons.js';
import { useDeleteLesson } from './useDeleteLesson.js';

export default function KnowledgeBase() {
  const [keyword, setKeyword] = useState('');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const handleDelete = useDeleteLesson(setLessons, setMessage);

  useEffect(() => {
    listLessons({ status: 'promoted', q: keyword.trim() || undefined })
      .then((result) => {
        setLessons(result);
        setMessage(null);
      })
      .catch((err) => setMessage(`Could not load the knowledge base: ${(err as Error).message}`));
  }, [keyword]);

  return (
    <section className="workspace-section" aria-labelledby="knowledge-base-title">
      <div className="section-intro">
        <div>
          <p className="eyebrow">Shared guidance</p>
          <h2 id="knowledge-base-title">A library built from real work.</h2>
          <p>Search the lessons that have been reviewed and promoted for everyone to use.</p>
        </div>
      </div>
      <Card className="filter-card filter-card--search">
        <CardHeader>
          <div>
            <CardTitle>Search the knowledge base</CardTitle>
            <CardDescription>Look across the quote, the change, and why it matters.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <label className="search-input">
            <Search size={18} />
            <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Search lessons" />
          </label>
        </CardContent>
      </Card>

      {message && <div className="feedback-message" role="status">{message}</div>}
      {lessons.length === 0 && !message && <EmptyState title="No matching lessons" description={keyword ? 'Try a broader phrase or clear the search to browse all shared guidance.' : 'Promoted lessons will appear here once they are ready to share.'} />}
      {lessons.length > 0 && <div className="lesson-library">{lessons.map((lesson) => <PromotedLessonCard key={lesson.id} lesson={lesson} onDelete={handleDelete} />)}</div>}
    </section>
  );
}
