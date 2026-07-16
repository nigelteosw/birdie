import { BookOpen, ClipboardCheck, Feather, Moon, Plus, Sparkles, Sun, Users } from 'lucide-react';
import { useState } from 'react';
import CaptureForm from './CaptureForm.js';
import KnowledgeBase from './KnowledgeBase.js';
import MyLessons from './MyLessons.js';
import ReviewList from './ReviewList.js';
import { Button } from './components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs.js';
import AccountMenu from './AccountMenu.js';
import UserManagement from './UserManagement.js';
import type { SessionUser } from './auth-client.js';
import { applyTheme, getCurrentTheme } from './theme.js';

type Tab = 'review' | 'mine' | 'knowledge' | 'users';

const tabs = [
  { value: 'review', label: 'Review queue', icon: ClipboardCheck },
  { value: 'mine', label: 'My lessons', icon: Feather },
  { value: 'knowledge', label: 'Knowledge base', icon: BookOpen },
] as const;

export default function App({ user }: { user: SessionUser }) {
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [tab, setTab] = useState<Tab>('review');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [theme, setTheme] = useState(getCurrentTheme);

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    setTheme(next);
  }

  function handleCaptured() {
    setRefreshSignal((value) => value + 1);
    setCaptureOpen(false);
    setTab('review');
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark">
            <img src="/birdie-mascot.png" alt="" />
          </div>
          <div>
            <div className="eyebrow">Knowledge operations</div>
            <h1>Birdie</h1>
          </div>
        </div>
        <div className="header-actions">
          <div className="header-note">
            <Sparkles size={15} />
            <span>Turn experience into trusted guidance</span>
          </div>
          <Button onClick={() => setCaptureOpen(true)}>
            <Plus size={17} />
            Capture example
          </Button>
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle color theme">
            <Sun size={18} className="icon-sun" />
            <Moon size={18} className="icon-moon" />
          </button>
          <AccountMenu user={user} />
        </div>
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="workspace-tabs">
        <TabsList aria-label="Birdie workspace">
          {tabs.map(({ value, label, icon: Icon }) => (
            <TabsTrigger value={value} key={value}>
              <Icon size={16} />
              {label}
            </TabsTrigger>
          ))}
          {String(user.role ?? '').split(',').includes('admin') && <TabsTrigger value="users"><Users size={16} />Users</TabsTrigger>}
        </TabsList>
        <TabsContent value="review">
          <ReviewList refreshSignal={refreshSignal} onCapture={() => setCaptureOpen(true)} />
        </TabsContent>
        <TabsContent value="mine">
          <MyLessons />
        </TabsContent>
        <TabsContent value="knowledge">
          <KnowledgeBase />
        </TabsContent>
        <TabsContent value="users">
          <UserManagement />
        </TabsContent>
      </Tabs>

      <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
        <DialogContent className="capture-dialog">
          <DialogHeader>
            <DialogTitle>Capture an example</DialogTitle>
            <DialogDescription>
              Add the before-and-after context now. Birdie can turn it into a reviewable lesson in chat.
            </DialogDescription>
          </DialogHeader>
          <CaptureForm onCaptured={handleCaptured} />
        </DialogContent>
      </Dialog>
    </main>
  );
}
