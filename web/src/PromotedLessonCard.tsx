import { CalendarDays, CheckCircle2, Quote, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import type { Lesson } from './api.js';
import { Badge } from './components/ui/badge.js';
import { Button } from './components/ui/button.js';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './components/ui/card.js';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './components/ui/dialog.js';

interface Props {
  lesson: Lesson;
  onDelete?: (lesson: Lesson) => void;
}

export default function PromotedLessonCard({ lesson, onDelete }: Props) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <Card className="library-card">
        <CardHeader>
          <div className="library-card__heading">
            <div className="library-card__icon"><Quote size={17} /></div>
            <div><p className="overline">Trusted guidance</p><CardTitle>{lesson.playbook_ref ?? 'Promoted lesson'}</CardTitle></div>
          </div>
          <Badge variant="success"><CheckCircle2 size={13} /> Promoted</Badge>
        </CardHeader>
        <CardContent>
          <blockquote className="library-card__quote">{lesson.quote}</blockquote>
          <div className="library-card__body">
            <div><span>What changed</span><p>{lesson.what_changed}</p></div>
            <div><span>Why it matters</span><p>{lesson.why_it_matters}</p></div>
          </div>
        </CardContent>
        <CardFooter className="library-card__footer">
          <div className="library-card__meta">
            <span><UserRound size={14} /> {lesson.submitted_by}</span>
            {lesson.reviewer && <span><CheckCircle2 size={14} /> Reviewed by {lesson.reviewer}</span>}
            {lesson.promoted_at && <span><CalendarDays size={14} /> {formatDate(lesson.promoted_at)}</span>}
          </div>
          {onDelete && <Button type="button" variant="ghost" size="icon" className="delete-button" aria-label="Delete lesson" onClick={() => setDeleteOpen(true)}><Trash2 size={16} /></Button>}
        </CardFooter>
      </Card>
      {onDelete && (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="confirm-dialog">
            <DialogHeader><DialogTitle>Delete this lesson?</DialogTitle><DialogDescription>This removes it from the knowledge base. This action cannot be undone.</DialogDescription></DialogHeader>
            <div className="dialog-actions"><DialogClose asChild><Button variant="outline">Keep lesson</Button></DialogClose><Button variant="destructive" onClick={() => { onDelete(lesson); setDeleteOpen(false); }}>Delete lesson</Button></div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
