import type { Lesson } from './api.js';

interface Props {
  lesson: Lesson;
  onDelete?: (lesson: Lesson) => void;
}

export default function PromotedLessonCard({ lesson, onDelete }: Props) {
  return (
    <article className="lesson-card lesson-card--readonly">
      <div className="meta">
        <span>Submitted by: {lesson.submitted_by}</span>
        {lesson.reviewer && <span>Reviewed by: {lesson.reviewer}</span>}
        {lesson.playbook_ref && <span>Playbook: {lesson.playbook_ref}</span>}
      </div>
      <blockquote className="quote">{lesson.quote}</blockquote>
      <p className="what-changed">{lesson.what_changed}</p>
      <p className="why-it-matters">{lesson.why_it_matters}</p>
      {onDelete && (
        <div className="actions">
          <button type="button" className="danger" onClick={() => handleDeleteClick(lesson, onDelete)}>
            Delete
          </button>
        </div>
      )}
    </article>
  );
}

function handleDeleteClick(lesson: Lesson, onDelete: (lesson: Lesson) => void): void {
  if (window.confirm('Delete this lesson from the knowledge base? This cannot be undone.')) {
    onDelete(lesson);
  }
}
