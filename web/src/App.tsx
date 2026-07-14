import { useState } from 'react';
import CaptureForm from './CaptureForm.js';
import ReviewList from './ReviewList.js';
import MyLessons from './MyLessons.js';
import KnowledgeBase from './KnowledgeBase.js';

type Tab = 'review' | 'mine' | 'knowledge';

export default function App() {
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [tab, setTab] = useState<Tab>('review');

  return (
    <main className="shell">
      <header className="topbar">
        <img src="/birdie-mascot.png" alt="Birdie" className="mascot" />
        <div>
          <h1>Birdie</h1>
          <p>Capture examples. Review lessons. Add only confirmed guidance to the knowledge base.</p>
        </div>
      </header>
      <nav className="tabs">
        <button type="button" className={tab === 'review' ? 'tab tab--active' : 'tab'} onClick={() => setTab('review')}>
          Review
        </button>
        <button type="button" className={tab === 'mine' ? 'tab tab--active' : 'tab'} onClick={() => setTab('mine')}>
          My Lessons
        </button>
        <button type="button" className={tab === 'knowledge' ? 'tab tab--active' : 'tab'} onClick={() => setTab('knowledge')}>
          Knowledge Base
        </button>
      </nav>
      {tab === 'review' && (
        <>
          <CaptureForm onCaptured={() => setRefreshSignal((value) => value + 1)} />
          <ReviewList refreshSignal={refreshSignal} />
        </>
      )}
      {tab === 'mine' && <MyLessons />}
      {tab === 'knowledge' && <KnowledgeBase />}
    </main>
  );
}
